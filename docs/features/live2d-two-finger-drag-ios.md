# Live2D 双指手势操作（iOS 端实现）

> 参考 Android 端实现，为 iOS 端增加双指长按拖动平移模型、双指捏合/张开缩放模型功能

---

## 功能概述

### 双指拖动
用户在 Live2D 舞台区域用两根手指按住屏幕约 500ms 后，进入拖动模式，移动手指即可平移模型。松手后退出拖动模式。

### 双指缩放
用户在 Live2D 舞台区域用两根手指进行捏合（靠近）或张开（远离）操作，可缩放模型大小。

本文档描述如何在 iOS 端实现与 Android 端相同的功能。

---

## ⚠️ 重要前置条件

### iOS 端 Live2D 基础功能未实现

当前 iOS 端代码（[ReactNativeLive2dView.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dView.swift)）**只是一个 WebView 模板**，尚未实现 Live2D 渲染能力：

| 功能 | Android | iOS |
|------|---------|-----|
| 加载模型 (`modelPath`) | ✅ 已实现 | ❌ **未实现** |
| 播放动作 (`motionGroup`) | ✅ 已实现 | ❌ **未实现** |
| 设置表情 (`expression`) | ✅ 已实现 | ❌ **未实现** |
| 设置缩放 (`scale`) | ✅ 已实现 | ❌ **未实现** |
| 设置位置 (`position`) | ✅ 已实现 | ❌ **未实现** |
| 点击事件 (`onTap`) | ✅ 已实现 | ❌ **未实现** |

**在实现本文档描述的手势功能前，必须先完成 iOS 端 Live2D 基础渲染功能。**

### 实现iOS 端 Live2D 基础功能的两种路径

1. **WebView 方案**：在 WKWebView 中加载 Live2D SDK 的 HTML 页面，通过 JavaScript 调用 Live2D API
2. **原生方案**：使用 Swift 实现与 Android 端类似的原生 Live2D 渲染（需要集成 Cubism SDK）

---

## 当前架构差异

| 平台 | 渲染方式 | 手势处理 |
|------|----------|----------|
| Android | 原生 Kotlin + OpenGL | View.onTouchEvent |
| iOS | WKWebView + JavaScript（待实现） | UIGestureRecognizer |

---

## 前置条件

### GestureHandlerRootView

`react-native-gesture-handler` v2 要求整个应用根节点被 `GestureHandlerRootView` 包裹，否则所有手势均不生效。

当前 [app/_layout.tsx](../../app/_layout.tsx) **已完成包裹**（与 Android 端共用）：

```tsx
// app/_layout.tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider ...>
        <Stack>...</Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
```

---

## 实现方案

### 方案概述

由于 iOS 端使用 WKWebView 渲染，有两种实现路径：

#### 方案 A：Native 模块直调（推荐）

在 Swift 层新增 `setViewPosition` 和 `setViewScale` 方法，通过 JavaScript 注入到 WebView 执行，实现与 Android 端一致的调用接口。

#### 方案 B：纯 JS 侧实现

直接在 WebView 层之上叠加手势层，通过 `injectJavaScript` 调用 WebView 内部的 Live2D API。

**推荐方案 A**，与 Android 端保持接口一致，便于维护。

---

## 坐标系说明

iOS 端需与 Android 端保持一致的坐标系定义：

- **原点**：屏幕中心，**X 向右为正，Y 向上为正**（与屏幕像素坐标 Y 轴相反）
- **逻辑视图范围**：`±1.0`
- **最大可移动范围**：`±2.0`（超出后模型完全移出屏幕）

### Y 轴取反

GestureHandler 的 `translationY` 向下为正，Live2D 坐标系 Y 向上为正，**必须取反**：

```text
// sensitivity = 1.0（可调整，值越小灵敏度越低）
modelX = startModelX + (translationX / screenWidth) * sensitivity
modelY = startModelY - (translationY / screenHeight) * sensitivity   ← 注意负号
```

---

## 边界保护

逻辑视图范围为 `±1.0`（模型完全可见）。设置安全边界 `POSITION_LIMIT = 0.9`，确保模型始终大部分在屏幕内。

**重要**：由于 `setPosition` 直接调用 native module 不会触发 React 状态更新，必须使用独立的 ref 跟踪当前位置。

---

## 手势与 WebView 触摸的冲突

iOS 端 WKWebView 会消费触摸事件。解决方案与 Android 端相同：

在 Live2D View **之上**叠加透明 overlay 承载手势，overlay 不设置 `pointerEvents`（默认 `auto`）。RNGH v2 的 Pan 手势在未激活期间不独占事件，单指短按可以穿透到 WebView；双指长按激活后才独占后续事件。

### onTap 副作用

双指长按时，第一根手指按下可能触发一次 `onTap` 事件。若需完全屏蔽，可在 `handleLive2DTap` 内加防抖：

```typescript
const lastTapTimeRef = useRef(0);

const handleLive2DTap = useCallback(() => {
  const now = Date.now();
  if (now - lastTapTimeRef.current < 100) return;
  lastTapTimeRef.current = now;
  mainManager.onLive2DTap();
}, []);
```

---

## 需要修改的文件

### 1. [ReactNativeLive2dView.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dView.swift)

> ⚠️ 前置条件：需要先实现 iOS 端 Live2D 基础功能（modelPath、motionGroup、scale、position、onTap 等 props）

#### 新增静态实例引用

```swift
class ReactNativeLive2dView: ExpoView {
  let webView = WKWebView()
  let onLoad = EventDispatcher()
  var delegate: WebViewDelegate?

  // 静态引用，供 Module 直接调用
  private static weak var currentInstance: ReactNativeLive2dView?

  static func getCurrentInstance() -> ReactNativeLive2dView? {
    return currentInstance
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    delegate = WebViewDelegate { url in
      self.onLoad(["url": url])
    }
    webView.navigationDelegate = delegate
    addSubview(webView)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      ReactNativeLive2dView.currentInstance = self
    } else if ReactNativeLive2dView.currentInstance === self {
      ReactNativeLive2dView.currentInstance = nil
    }
  }

  override func layoutSubviews() {
    webView.frame = bounds
  }

  // MARK: - 位置与缩放控制

  func setPosition(_ x: Float, _ y: Float) {
    let js = "window.setLive2DPosition(\(x), \(y));"
    webView.evaluateJavaScript(js) { result, error in
      if let error = error {
        print("setPosition error: \(error)")
      }
    }
  }

  func setScale(_ scale: Float) {
    let js = "window.setLive2DScale(\(scale));"
    webView.evaluateJavaScript(js) { result, error in
      if let error = error {
        print("setScale error: \(error)")
      }
    }
  }
}
```

### 2. [ReactNativeLive2dModule.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dModule.swift)

#### 新增 Function 定义

在 `definition()` 的 View 定义之后添加：

```swift
public func definition() -> ModuleDefinition {
  Name("ReactNativeLive2d")

  // ... 现有代码 ...

  View(ReactNativeLive2dView.self) {
    // ... 现有 Props ...

    Events("onLoad")
  }

  // MARK: - Native 直调方法（与 Android 端接口一致）

  /// 直接设置模型位置（绕过 React prop 链路，避免触发重渲染）
  Function("setViewPosition") { (x: Float, y: Float) in
    if let view = ReactNativeLive2dView.getCurrentInstance() {
      view.setPosition(x, y)
    } else {
      print("setViewPosition: no active ReactNativeLive2dView instance")
    }
  }

  /// 直接设置模型缩放（绕过 React prop 链路，避免触发重渲染）
  Function("setViewScale") { (scale: Float) in
    if let view = ReactNativeLive2dView.getCurrentInstance() {
      view.setScale(scale)
    } else {
      print("setViewScale: no active ReactNativeLive2dView instance")
    }
  }
}
```

### 3. WebView 内部 JavaScript（Live2D SDK HTML）

需要在 WKWebView 加载的 HTML/JS 中提供全局方法供 native 调用。

> ⚠️ **注意**：当前项目中不存在现成的 Live2D HTML 文件，需要新建或使用第三方 SDK。

**方案 1**：使用 PixiJS + pixi-live2d-display（推荐）

```javascript
// 在 Live2D SDK 的 HTML 页面中添加
// 假设使用 pixi-live2d-display 库
const app = new PIXI.Application({...});
const model = await PIXI.live2d.Live2DModel.from('model.json');

window.setLive2DPosition = function(x, y) {
  // 转换坐标系：逻辑坐标 → 屏幕坐标
  model.x = (x + 1) * app.screen.width / 2;
  model.y = (1 - y) * app.screen.height / 2;  // Y 轴取反
};

window.setLive2DScale = function(scale) {
  model.scale.set(scale);
};
```

**方案 2**：使用 Cubism Web Framework

```javascript
// 参考官方 Cubism SDK for Web
window.setLive2DPosition = function(x, y) {
  if (window.live2dManager) {
    window.live2dManager.setUserPosition(x, y);
  }
};

window.setLive2DScale = function(scale) {
  if (window.live2dManager) {
    window.live2dManager.setScale(scale);
  }
};
```

### 4. [ReactNativeLive2d.types.ts](../../packages/react-native-live2d/src/ReactNativeLive2d.types.ts)

在 `Live2DModule` interface 的 `setViewPosition` 之后添加：

```typescript
/**
 * 直接设置模型位置（绕过 React prop 链路，用于拖动等高频场景）
 */
setViewPosition(x: number, y: number): void;

/**
 * 直接设置模型缩放（绕过 React prop 链路，用于缩放等高频场景）
 */
setViewScale(scale: number): void;
```

### 5. [Live2DService.ts](../../services/Live2DService.ts)

修改 `setPosition` 和 `setScale` 方法，改为 native 直达：

```typescript
// 修改前
setPosition(x: number, y: number): void {
  void this.core.setTransform({ position: { x, y } } as Transform);
}

setScale(scale: number): void {
  void this.core.setTransform({ scale } as Transform);
}

// 修改后
setPosition(x: number, y: number): void {
  // 直接调用 native module，不走 setTransform → React 重渲染链路
  ReactNativeLive2dModule.setViewPosition(x, y);
  // 同步更新内部状态
  this.transformState.position = { x, y };
}

setScale(scale: number): void {
  // 直接调用 native module
  ReactNativeLive2dModule.setViewScale(scale);
  // 同步更新内部状态
  this.transformState.scale = scale;
}
```

---

## 🔄 Android 端同步修改

为保持接口一致，**Android 端也需要添加 `setViewScale` Function**（当前只有 `setViewPosition`）：

### [ReactNativeLive2dModule.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dModule.kt)

在 `setViewPosition` Function 之后添加：

```kotlin
/**
 * 直接设置模型缩放（绕过 React prop 链路，避免触发重渲染）
 */
Function("setViewScale") { scale: Float ->
    try {
        val view = ReactNativeLive2dView.getCurrentInstance()
        if (view != null) {
            view.setScale(scale)
        } else {
            Log.w(TAG, "setViewScale: no active ReactNativeLive2dView instance")
        }
    } catch (e: Exception) {
        Log.e(TAG, "Failed to setViewScale: ${e.message}")
    }
}
```

> 注意：`LAppView.kt:496` 已有 `setViewScale` 方法，只需在 Module 中暴露即可。

---

## JS 侧实现（与 Android 端共用）

由于 JS 侧的手势逻辑和 React Native Gesture Handler 是跨平台的，iOS 端可以**直接复用** Android 端的 JS 代码。

详见 [live2d-two-finger-drag.md](./live2d-two-finger-drag.md) 中的「实现（JS 侧）」章节，包括：

1. 模块级常量（`POSITION_LIMIT`、`SCALE_MIN`、`SCALE_MAX`）
2. 状态变量（`currentModelPositionRef`、`currentScaleRef` 等）
3. 手势定义（`dragGesture`、`pinchGesture`、`live2dGesture`）
4. JSX 结构（GestureDetector overlay）
5. 样式（`dragIndicator`）

### main.tsx 平台判断修改

当前代码使用 `Platform.OS === 'android'` 限制手势仅 Android 端生效：

```typescript
// 当前代码（仅 Android）
{Platform.OS === 'android' && (
  <GestureDetector gesture={live2dGesture}>
    <View style={StyleSheet.absoluteFill} />
  </GestureDetector>
)}
```

iOS 端实现完成后，移除平台判断：

```typescript
// 修改后（两端共用）
<GestureDetector gesture={live2dGesture}>
  <View style={StyleSheet.absoluteFill} />
</GestureDetector>

{(isDraggingModel || isScalingModel) && (
  <View style={styles.dragIndicator} pointerEvents="none">
    <Text style={styles.dragIndicatorText}>
      {isDraggingModel && isScalingModel ? '拖动/缩放中' : isDraggingModel ? '拖动中' : '缩放中'}
    </Text>
  </View>
)}
```

---

## 测试要点

1. **双指长按**：确认 500ms 后进入拖动模式，显示「拖动中」提示
2. **拖动范围**：确认模型不会移出 `±0.9` 边界
3. **双指缩放**：确认缩放范围在 `0.3` ~ `2.0` 之间
4. **同时操作**：确认拖动和缩放可同时进行
5. **穿透测试**：确认单指点击仍能触发 Live2D 的 `onTap` 事件
6. **性能测试**：确认高频手势调用不会导致卡顿或模型闪烁

---

## 需要修改的文件汇总

### iOS 端（本文档核心）

| 文件 | 改动 |
|------|------|
| [app/_layout.tsx](../../app/_layout.tsx) | 已完成 `GestureHandlerRootView` 包裹（共用） |
| [app/(tabs)/main.tsx](../../app/(tabs)/main.tsx) | 移除 `Platform.OS === 'android'` 限制 |
| [ReactNativeLive2dView.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dView.swift) | **前置**：实现 Live2D 基础功能；静态实例引用、`setPosition`/`setScale` 方法 |
| [ReactNativeLive2dModule.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dModule.swift) | 新增 `setViewPosition`/`setViewScale` Function |
| Live2D HTML/JS（待创建） | 新增 `window.setLive2DPosition`/`window.setLive2DScale` 全局方法 |
| [ReactNativeLive2d.types.ts](../../packages/react-native-live2d/src/ReactNativeLive2d.types.ts) | `Live2DModule` 新增 `setViewPosition`/`setViewScale` 声明 |
| [Live2DService.ts](../../services/Live2DService.ts) | `setPosition`/`setScale` 改为调用 native module |

### Android 端（同步修改）

| 文件 | 改动 |
|------|------|
| [ReactNativeLive2dModule.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dModule.kt) | 新增 `setViewScale` Function |

---

## 相关文件

- [live2d-two-finger-drag.md](./live2d-two-finger-drag.md) — Android 端实现参考
- [ReactNativeLive2dView.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dView.swift) — iOS View 实现
- [ReactNativeLive2dModule.swift](../../packages/react-native-live2d/ios/ReactNativeLive2dModule.swift) — iOS Module 定义
- [Live2DService.ts](../../services/Live2DService.ts) — JS 侧 Service 层
- [hooks/useLive2D.ts](../../hooks/useLive2D.ts) — Live2D 状态与控制
- [ReactNativeLive2dModule.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dModule.kt) — Android Module 定义
