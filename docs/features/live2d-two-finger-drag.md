# Live2D 双指手势操作

> 双指长按拖动平移模型，双指捏合/张开缩放模型（仅 Android）

---

## 功能概述

### 双指拖动
用户在 Live2D 舞台区域用两根手指按住屏幕约 500ms 后，进入拖动模式，移动手指即可平移模型。松手后退出拖动模式。

### 双指缩放
用户在 Live2D 舞台区域用两根手指进行捏合（靠近）或张开（远离）操作，可缩放模型大小。

iOS 端暂不实现，本文档仅涉及 Android。

---

## 前置条件

### GestureHandlerRootView

`react-native-gesture-handler` v2 要求整个应用根节点被 `GestureHandlerRootView` 包裹，否则所有手势均不生效。

当前 [app/_layout.tsx](../../app/_layout.tsx) **已完成包裹**，实现如下：

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

## 坐标系说明

Android 端 `setViewPosition(x, y)` 最终调用 `LAppLive2DManager.setUserPosition(x, y)`，作用于投影矩阵平移（见 [LAppLive2DManager.kt](../../packages/react-native-live2d/android/src/main/java/com/live2d/kotlin/LAppLive2DManager.kt):111）：

```kotlin
projection.translateRelative(userOffsetX, userOffsetY)
```

- **原点**：屏幕中心，**X 向右为正，Y 向上为正**（与屏幕像素坐标 Y 轴相反）
- **逻辑视图范围**：`±1.0`（见 `LAppDefine.LogicalView`）
- **最大可移动范围**：`±2.0`（见 `LAppDefine.MaxLogicalView`，超出后模型完全移出屏幕）

### Y 轴取反

GestureHandler 的 `translationY` 向下为正，native 坐标系 Y 向上为正，**必须取反**：

```text
// sensitivity = 1.0（可调整，值越小灵敏度越低）
modelX = startModelX + (translationX / screenWidth) * sensitivity
modelY = startModelY - (translationY / screenHeight) * sensitivity   ← 注意负号
```

> **灵敏度说明**：`sensitivity = 0.005`（代码中实际使用的值）表示手指移动整个屏幕距离，模型仅移动 0.005 个逻辑单位。值越小灵敏度越低，需要更大幅度的拖动才能移动模型。

---

## 边界保护

逻辑视图范围为 `±1.0`（模型完全可见）。设置安全边界 `POSITION_LIMIT = 0.9`，确保模型始终大部分在屏幕内。

> `setUserPosition` native 侧无 clamp，JS 侧是唯一保护。

若模型已处于越界状态（历史数据异常），在拖动开始时检测并重置为 `(0, 0)`。

**重要**：由于 `setPosition` 直接调用 native module 不会触发 React 状态更新，必须使用独立的 ref 跟踪当前位置，而不是依赖 React 状态。否则每次拖动都会从 `(0, 0)` 开始。

---

## 手势与 Native 触摸的冲突

**Android**：[ReactNativeLive2dView.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dView.kt):878 的 `onTouchEvent` 返回 `true`，消费所有触摸事件。

**解决方案**：在 Live2D View **之上**叠加透明 overlay 承载手势，overlay 不设置 `pointerEvents`（默认 `auto`）。RNGH v2 的 Pan 手势在未激活期间不独占事件，单指短按可以穿透到 Live2D View 的 native touch handler；双指长按激活后才独占后续事件。

### onTap 副作用

`onTouchEvent` 使用 `event.action`（非 `event.actionMasked`），仅 `ACTION_DOWN`（值 0）触发 `onTap`；第二根手指按下产生 `ACTION_POINTER_DOWN`（值 0x105），不匹配，**不会触发第二次 onTap**。双指长按只产生 **1 次 onTap**（第一根手指按下时），影响极小，通常无需处理。

若需完全屏蔽，在 `handleLive2DTap` 内加防抖：

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

## 关键问题：拖动时模型消失

### 原因

直接使用 `live2d.setModelPosition(x, y)` 会触发以下链路：

```
setModelPosition(x, y)
  → Live2DService.setPosition(x, y)
  → this.core.setTransform({ position: { x, y } })
  → notifyTransformStateChange()
  → setTransformState(state)          ← React state 更新
  → live2dProps 重建（position 对象引用变化）
  → ReactNativeLive2dView 重渲染
  → Prop("modelPath") 重新触发 → view.loadModel(path)
  → Prop("motionGroup") 重新触发 → view.startMotion()
```

`onUpdate` 每帧触发，每帧都引发完整 React 重渲染，`modelPath` prop 被重新传入，`loadModel` 被重复调用，模型渲染被打断，视觉上表现为模型消失或闪烁。

### 修复：native module 直达

与 `setMouthValue` 的处理方式相同——新增 `Function("setViewPosition")` native 直达方法，绕过 React prop 链路，不触发任何 React 重渲染。

**需要修改的文件：**

#### 1. [ReactNativeLive2dView.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dView.kt) — companion object 暴露当前实例

在 `companion object` 中添加弱引用，供 module 直接调用 `setPosition`（该方法已有完整的 `queueEvent + requestRender` 逻辑）：

```kotlin
companion object {
    private const val TAG = "ReactNativeLive2dView"
    // ... 现有常量 ...

    // 当前活跃的 View 实例（弱引用，避免内存泄漏）
    // 使用 AtomicReference 确保多线程安全（Module 函数在 JS 线程调用，View 生命周期在 UI 线程）
    private val currentInstanceRef = java.util.concurrent.atomic.AtomicReference<java.lang.ref.WeakReference<ReactNativeLive2dView>?>(null)

    /**
     * 获取当前活跃的 Live2D View 实例
     */
    fun getCurrentInstance(): ReactNativeLive2dView? = currentInstanceRef.get()?.get()

    /**
     * 设置当前活跃的 View 实例（内部使用）
     */
    internal fun setCurrentInstance(view: ReactNativeLive2dView?) {
        currentInstanceRef.set(if (view != null) java.lang.ref.WeakReference(view) else null)
    }

    /**
     * 清除当前实例（仅当传入的 view 是当前实例时才清除）
     */
    internal fun clearCurrentInstance(view: ReactNativeLive2dView) {
        val expected = currentInstanceRef.get()
        expected?.get()?.let { current ->
            if (current === view) {
                currentInstanceRef.compareAndSet(expected, null)
            }
        }
    }
}
```

在 `onAttachedToWindow` 注册，`onDetachedFromWindow` 清除：

```kotlin
override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    setCurrentInstance(this)
    // ... 现有逻辑 ...
}

override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    clearCurrentInstance(this)
    // ... 现有逻辑 ...
}
```

#### 2. [ReactNativeLive2dModule.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dModule.kt) — 新增 setViewPosition 和 setViewScale

在 `getMouthValue` Function 之后、模块定义结束前添加：

```kotlin
/**
 * 直接设置模型位置（绕过 React prop 链路，避免触发重渲染）
 * 与 setMouthValue 同理，用于高频调用场景（如拖动）
 */
Function("setViewPosition") { x: Float, y: Float ->
    try {
        val view = ReactNativeLive2dView.getCurrentInstance()
        if (view != null) {
            view.setPosition(x, y)  // 内部已有 queueEvent + requestRender
        } else {
            Log.w(TAG, "setViewPosition: no active ReactNativeLive2dView instance")
        }
    } catch (e: Exception) {
        Log.e(TAG, "Failed to setViewPosition: ${e.message}")
    }
}

/**
 * 直接设置模型缩放（绕过 React prop 链路，避免触发重渲染）
 * 用于高频调用场景（如双指缩放）
 */
Function("setViewScale") { scale: Float ->
    try {
        val view = ReactNativeLive2dView.getCurrentInstance()
        if (view != null) {
            view.setScale(scale)  // 内部已有 queueEvent + requestRender
        } else {
            Log.w(TAG, "setViewScale: no active ReactNativeLive2dView instance")
        }
    } catch (e: Exception) {
        Log.e(TAG, "Failed to setViewScale: ${e.message}")
    }
}
```

> **注意**：`LAppView.kt:496` 已有 `setViewScale` 方法，只需在 Module 中暴露即可。

#### 3. [ReactNativeLive2d.types.ts](../../packages/react-native-live2d/src/ReactNativeLive2d.types.ts) — 新增类型声明

在 `Live2DModule` interface 的 `setMouthValue` 之后添加：

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

#### 4. [Live2DService.ts](../../services/Live2DService.ts) — setPosition/setScale 改为 native 直达

```typescript
// 修改前
setPosition(x: number, y: number): void {
  console.log('📍 设置位置:', x, y);
  void this.core.setTransform({ position: { x, y } } as Transform);
}

setScale(scale: number): void {
  console.log('🔍 设置缩放:', scale);
  void this.core.setTransform({ scale } as Transform);
}

// 修改后
setPosition(x: number, y: number): void {
  // 直接调用 native module，不走 setTransform → React 重渲染链路
  ReactNativeLive2dModule.setViewPosition(x, y);
  // 同步更新内部状态，供 getTransformState() 读取
  this.transformState.position = { x, y };
}

setScale(scale: number): void {
  // 直接调用 native module，不走 setTransform → React 重渲染链路
  ReactNativeLive2dModule.setViewScale(scale);
  // 同步更新内部状态，供 getTransformState() 读取
  this.transformState.scale = scale;
}
```

> `resetTransform` 中的位置/缩放重置仍走 `setTransform`（低频，不在热路径上），无需修改。

---

## 实现（JS 侧）

### 1. 新增 import

```typescript
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
```

React import 补充 `useMemo`：

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

### 2. 模块级常量

```typescript
// main.tsx 组件外
// 边界保护：逻辑视图范围为 ±1.0，设置为 0.9 确保模型始终大部分在屏幕内
const POSITION_LIMIT = 0.9;
const clampPos = (v: number) => Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, v));

// 缩放范围限制
const SCALE_MIN = 0.3;
const SCALE_MAX = 2.0;
const clampScale = (v: number) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));
```

### 3. 状态变量

```typescript
// 拖动相关
const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
// 使用独立 ref 跟踪当前位置，不依赖 React 状态（因为 setPosition 不会触发 React 更新）
const currentModelPositionRef = useRef({ x: 0, y: 0 });
const [isDraggingModel, setIsDraggingModel] = useState(false);

// 缩放相关
const startScaleRef = useRef<number>(0.8);
const currentScaleRef = useRef<number>(0.8);
const [isScalingModel, setIsScalingModel] = useState(false);
```

> **注意**：不能使用 `live2d.position`（React 状态），因为 `setPosition` 直接调用 native module，不会触发 React 状态更新。缩放同理。

### 4. 手势定义（useMemo 避免每次 render 重建）

```typescript
const dragGesture = useMemo(() => {
  let screenWidth = 1;
  let screenHeight = 1;
  return Gesture.Pan()
    .minPointers(2)
    .activateAfterLongPress(500)
    .runOnJS(true)
    .onStart(() => {
      const { width, height } = Dimensions.get('window');
      screenWidth = width;
      screenHeight = height;
      // 使用持久化的位置 ref，而不是 React 状态
      const pos = { ...currentModelPositionRef.current };
      if (Math.abs(pos.x) > POSITION_LIMIT || Math.abs(pos.y) > POSITION_LIMIT) {
        live2d.setModelPosition(0, 0);
        currentModelPositionRef.current = { x: 0, y: 0 };
        pos.x = 0;
        pos.y = 0;
      }
      dragStartPositionRef.current = pos;
      setIsDraggingModel(true);
    })
    .onUpdate((e) => {
      const start = dragStartPositionRef.current;
      if (!start) return;
      // 大幅降低灵敏度：手指移动整个屏幕距离，模型仅移动 0.3 个逻辑单位
      // 乘数越小灵敏度越低，0.3 = 低灵敏度（需要大幅度拖动才能移动模型）
      const sensitivity = 0.3;
      const newX = clampPos(start.x + (e.translationX / screenWidth) * sensitivity);
      const newY = clampPos(start.y - (e.translationY / screenHeight) * sensitivity);
      // 更新当前位置 ref，供下次拖动使用
      currentModelPositionRef.current = { x: newX, y: newY };
      live2d.setModelPosition(newX, newY);
    })
    .onFinalize(() => {
      dragStartPositionRef.current = null;
      setIsDraggingModel(false);
    });
},
// eslint-disable-next-line react-hooks/exhaustive-deps
[], // 手势对象只需创建一次；live2d.setModelPosition 是稳定引用
);
```

> `runOnJS(true)`：`setModelPosition` 调用 JS 线程的 Service，必须加此标记。
>
> `onFinalize` 同时覆盖正常结束和取消，统一在此清理。

#### 缩放手势

```typescript
const pinchGesture = useMemo(() => {
  return Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      // 记录开始时的缩放值
      startScaleRef.current = currentScaleRef.current;
      setIsScalingModel(true);
    })
    .onUpdate((e) => {
      // 降低缩放灵敏度：缩放因子变化更平缓
      const scaleSensitivity = 0.5;
      const newScale = clampScale(startScaleRef.current * (1 + (e.scale - 1) * scaleSensitivity));
      currentScaleRef.current = newScale;
      live2d.setModelScale(newScale);
    })
    .onFinalize(() => {
      setIsScalingModel(false);
    });
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

> `scaleSensitivity = 0.5`：降低灵敏度，使缩放更平缓可控。

#### 组合手势

```typescript
// 组合手势：同时支持拖动和缩放
const live2dGesture = useMemo(() => {
  return Gesture.Simultaneous(dragGesture, pinchGesture);
}, [dragGesture, pinchGesture]);
```

> 使用 `Gesture.Simultaneous` 组合两个手势，允许同时触发拖动和缩放。

### 5. JSX 结构

**关键设计**：GestureDetector 必须包裹整个 `live2dContainer`，而不是叠加透明层。

这样设计的原因：
1. **单指注视**：Live2D View 的 `onTouchEvent` 直接处理单指触摸，实现眼睛跟随
2. **双指手势**：GestureDetector 检测双指手势，不干扰单指触摸事件

```tsx
// Android 端：GestureDetector 包裹整个容器
{Platform.OS === 'android' ? (
  <GestureDetector gesture={live2dGesture}>
    <View style={styles.live2dContainer}>
      {/* Live2D View - 单指触摸由 native onTouchEvent 处理 */}
      {isPageFocused && (
        <ReactNativeLive2dView
          style={styles.live2dView}
          {...live2d.live2dPropsForLipSync}
          onTap={handleLive2DTap}
        />
      )}

      {/* 失去焦点时的显示 */}
      {!isPageFocused && (
        <View style={styles.pausedContainer}>
          <Text style={styles.pausedText}>
            {live2d.live2dProps.modelPath ? 'Live2D 已暂停' : '页面未激活'}
          </Text>
        </View>
      )}

      {/* 拖动/缩放指示器 */}
      {(isDraggingModel || isScalingModel) && (
        <View style={styles.dragIndicator} pointerEvents="none">
          <Text style={styles.dragIndicatorText}>
            {isDraggingModel && isScalingModel ? '拖动/缩放中' : isDraggingModel ? '拖动中' : '缩放中'}
          </Text>
        </View>
      )}
    </View>
  </GestureDetector>
) : (
  // iOS 端：暂不支持双指手势，直接渲染容器
  <View style={styles.live2dContainer}>
    {isPageFocused && (
      <ReactNativeLive2dView
        style={styles.live2dView}
        {...live2d.live2dPropsForLipSync}
        onTap={handleLive2DTap}
      />
    )}
    {!isPageFocused && (
      <View style={styles.pausedContainer}>
        <Text style={styles.pausedText}>
          {live2d.live2dProps.modelPath ? 'Live2D 已暂停' : '页面未激活'}
        </Text>
      </View>
    )}
  </View>
)}
```

> **为什么不使用透明叠加层？**
>
> 之前尝试在 Live2D View 之上叠加透明 View 承载手势，但这会导致：
> - `pointerEvents="auto"`：双指手势工作，但单指触摸被拦截
> - `pointerEvents="box-none"`：单指触摸穿透，但双指手势也无法检测
> - `pointerEvents="none"`：所有触摸穿透，双指手势不工作
>
> 正确方案是让 GestureDetector 包裹整个容器，RNGH 会正确处理手势检测和事件传递。

### 6. 新增样式

```typescript
dragIndicator: {
  position: 'absolute',
  top: 16,
  alignSelf: 'center',
  backgroundColor: 'rgba(64, 197, 241, 0.25)',
  paddingVertical: 6,
  paddingHorizontal: 16,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: 'rgba(64, 197, 241, 0.6)',
  zIndex: 10,
},
dragIndicatorText: {
  color: '#40c5f1',
  fontSize: 13,
},
```

---

## 与现有手势的兼容

### 手势兼容表

| 手势 | 指针数 | 激活条件 | 实现方式 | 冲突风险 |
|------|--------|----------|----------|----------|
| tap（`onTap`） | 1 | ACTION_DOWN | Native `onTouchEvent` | 无 |
| 单指注视（眼睛跟随） | 1 | 触摸/移动 | Native `onTouchEvent` → `LAppDelegate.onTouchBegan/Moved/End` | 无 |
| 双指长按拖动 | 2 | 长按 500ms | RNGH `Gesture.Pan().minPointers(2)` | 无 |
| 双指缩放 | 2 | 捏合/张开 | RNGH `Gesture.Pinch()` | 无 |

### 单指注视实现原理

单指注视功能由 Native 层直接处理，不经过 RNGH：

1. **触摸事件流**：
   ```text
   用户触摸屏幕
     → Android dispatchTouchEvent
     → ReactNativeLive2dView.onTouchEvent (返回 true)
     → LAppDelegate.onTouchBegan/Moved/End
     → LAppView.onTouchesBegan/Moved/Ended
     → Live2D SDK 设置视线参数
   ```

2. **关键代码**（`ReactNativeLive2dView.kt:912-946`）：
   ```kotlin
   override fun onTouchEvent(event: MotionEvent): Boolean {
       val x = event.x
       val y = event.y

       when (event.action) {
           MotionEvent.ACTION_DOWN -> {
               delegate.onTouchBegan(x, y)  // 开始注视
               dispatchEvent("onTap", mapOf("x" to x, "y" to y))
           }
           MotionEvent.ACTION_MOVE -> {
               delegate.onTouchMoved(x, y)  // 眼睛跟随
           }
           MotionEvent.ACTION_UP -> {
               delegate.onTouchEnd(x, y)    // 结束注视
           }
       }
       return true  // 消费触摸事件
   }
   ```

3. **与 RNGH 的协作**：
   - RNGH 的 `Gesture.Pan().minPointers(2)` 只在双指时激活
   - 单指触摸不会被 Pan 手势拦截
   - 单指事件正常传递到 Native View 的 `onTouchEvent`

---

## 位置持久化

拖动结束后位置不会持久化，重启后恢复默认 `{ x: 0, y: 0 }`。若需持久化，用 `AsyncStorage` 以 `modelName` 为 key 存储，属独立功能，不在本次范围内。

---

## 需要修改的文件汇总

| 文件 | 改动 |
|------|------|
| [app/_layout.tsx](../../app/_layout.tsx) | 新增 `GestureHandlerRootView` 包裹 |
| [app/(tabs)/main.tsx](../../app/(tabs)/main.tsx) | 手势定义、状态变量、JSX 结构、样式 |
| [ReactNativeLive2dView.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dView.kt) | companion object 暴露 `getCurrentInstance()`，`onAttachedToWindow`/`onDetachedFromWindow` 注册/清除 |
| [ReactNativeLive2dModule.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dModule.kt) | 新增 `setViewPosition`/`setViewScale` Function |
| [ReactNativeLive2d.types.ts](../../packages/react-native-live2d/src/ReactNativeLive2d.types.ts) | `Live2DModule` 新增 `setViewPosition`/`setViewScale` 声明 |
| [Live2DService.ts](../../services/Live2DService.ts) | `setPosition`/`setScale` 改为调用 native module，不走 `setTransform` |

---

## 相关功能：单指注视

除双指手势外，Android 端还实现了**单指注视**功能（模型眼睛跟随手指）：

### 自动处理（默认行为）

单指注视功能由 Native View 的 `onTouchEvent` **自动处理**，**无需 JS 侧任何代码**：

```kotlin
// ReactNativeLive2dView.kt:912-946
override fun onTouchEvent(event: MotionEvent): Boolean {
    val x = event.x
    val y = event.y

    when (event.action) {
        MotionEvent.ACTION_DOWN -> {
            delegate.onTouchBegan(x, y)
            dispatchEvent("onTap", mapOf("x" to x, "y" to y))
        }
        MotionEvent.ACTION_MOVE -> {
            delegate.onTouchMoved(x, y)
        }
        MotionEvent.ACTION_UP -> {
            delegate.onTouchEnd(x, y)
        }
    }
    return true  // 消费触摸事件
}
```

当用户单指触摸 Live2D View 时，Native 层自动：
1. `onTouchEvent` 捕获触摸事件
2. 调用 `LAppDelegate.onTouchBegan/Moved/End`
3. 通过 `LAppView.onTouchesBegan/Moved/Ended` 设置 Live2D 视线参数
4. 模型眼睛自动跟随手指

### 与 RNGH 双指手势的协作

| 手势 | 指针数 | 激活条件 | 处理方式 |
|------|--------|----------|----------|
| 单指注视 | 1 | 任意触摸 | Native `onTouchEvent` 自动处理 |
| tap（`onTap`） | 1 | ACTION_DOWN | Native `onTouchEvent` 触发事件 |
| 双指拖动 | 2 | 长按 500ms | RNGH `Gesture.Pan().minPointers(2)` |
| 双指缩放 | 2 | 捏合/张开 | RNGH `Gesture.Pinch()` |

**关键点**：RNGH 的 `Pan().minPointers(2)` 只在双指时激活，单指触摸不会被 RNGH 拦截，正常传递到 Native View 的 `onTouchEvent`。

### 实现位置

- [ReactNativeLive2dView.kt:912-946](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dView.kt) — `onTouchEvent` 处理
- [LAppDelegate.kt:419-455](../../packages/react-native-live2d/android/src/main/java/com/live2d/kotlin/LAppDelegate.kt) — `onTouchBegan/Moved/End` 方法
- [LAppView.kt](../../packages/react-native-live2d/android/src/main/java/com/live2d/kotlin/LAppView.kt) — `onTouchesBegan/Moved/Ended` 调用 Live2D SDK

---

## 相关文件

- [LAppLive2DManager.kt](../../packages/react-native-live2d/android/src/main/java/com/live2d/kotlin/LAppLive2DManager.kt) — `setUserPosition` / 坐标系定义
- [LAppDefine.kt](../../packages/react-native-live2d/android/src/main/java/com/live2d/kotlin/LAppDefine.kt) — `LogicalView = ±1`、`MaxLogicalView = ±2`
- [ReactNativeLive2dView.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dView.kt) — `onTouchEvent`、`setPosition`/`setScale` 实现
- [ReactNativeLive2dModule.kt](../../packages/react-native-live2d/android/src/main/java/expo/modules/live2d/ReactNativeLive2dModule.kt) — Props/Events/Functions
- [hooks/useLive2D.ts](../../hooks/useLive2D.ts) — Live2D 状态与控制
- [services/Live2DService.ts](../../services/Live2DService.ts) — `setPosition`/`setScale`/`resetTransform`
