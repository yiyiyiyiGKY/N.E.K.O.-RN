# 修复：单指触摸注视追踪 - 坐标系问题

> Live2D 模型眼睛/头部不跟随单指触摸位置转动，或转动方向完全不一致

**状态**：🔄 重新分析

---

## 问题现象

单指触摸屏幕时，模型眼睛/头部转向方向与手指位置完全不一致：
- 手指向左移动，模型眼睛向右转
- 手指向上移动，模型眼睛向下看
- 或模型完全不响应

---

## 原理分析

### Web 端（正常工作）

Web 端使用 pixi-live2d-display 库的 `model.focus(x, y)` 方法：

```javascript
// live2d-interaction.js
const onPointerMove = (event) => {
    const pointer = { x: event.clientX, y: event.clientY };  // 屏幕绝对坐标

    if (this.isFocusing) {
        model.focus(pointer.x, pointer.y);  // ✅ 传递屏幕坐标
    }
};
```

**关键点**：`event.clientX/Y` 是相对于**视口**的绝对坐标，库内部处理所有坐标转换。

### RN 端（原生实现）

RN 端需要调用 Native SDK 的坐标转换链：

```
屏幕坐标 (pointX/Y)
    ↓ deviceToScreen.transformX/Y()
逻辑坐标 (screenX/Y)
    ↓ viewMatrix.invertTransformX/Y()
View 坐标 (viewX/Y)
    ↓
LAppLive2DManager.onDrag(viewX, viewY)
```

**原生代码位置**：`LAppView.kt:365-371`

```kotlin
fun onTouchesMoved(pointX: Float, pointY: Float) {
    // 坐标转换链
    val viewX = transformViewX(touchManager.getLastX())  // deviceX → screenX → viewX
    val viewY = transformViewY(touchManager.getLastY())

    touchManager.touchesMoved(pointX, pointY)
    LAppLive2DManager.getInstance().onDrag(viewX, viewY)
}

fun transformViewX(deviceX: Float): Float {
    val screenX = deviceToScreen.transformX(deviceX)  // 设备坐标 → 逻辑坐标
    return viewMatrix.invertTransformX(screenX)        // 逻辑坐标 → View 坐标
}
```

---

## 问题根因

### 1. SDK Bug：坐标获取顺序错误

**位置**：`LAppView.kt:365-370`

```kotlin
// ❌ 错误：先获取旧坐标，再更新
val viewX = transformViewX(touchManager.getLastX())  // 获取的是上一次的坐标！
touchManager.touchesMoved(pointX, pointY)             // 更新在后面

// ✅ 修复：先更新，再获取
touchManager.touchesMoved(pointX, pointY)             // 先更新
val viewX = transformViewX(touchManager.getLastX())   // 再获取当前坐标
```

### 2. RNGH 坐标系问题

RNGH (react-native-gesture-handler) 的 PanGesture 事件坐标：

```typescript
// ❌ 错误理解
.onStart((e) => ReactNativeLive2dModule.onTouchBegan(e.x, e.y))
// e.x, e.y 是相对于 GestureDetector 的坐标，不是屏幕绝对坐标！

// ✅ 正确做法
.onStart((e) => {
    // e.absoluteX, e.absoluteY 是屏幕绝对坐标（相对于屏幕左上角）
    ReactNativeLive2dModule.onTouchBegan(e.absoluteX, e.absoluteY)
})
.onUpdate((e) => {
    ReactNativeLive2dModule.onTouchMoved(e.absoluteX, e.absoluteY)
})
.onEnd((e) => {
    ReactNativeLive2dModule.onTouchEnd(e.absoluteX, e.absoluteY)
})
```

**RNGH 事件坐标说明**：
- `e.x, e.y`：相对于 GestureDetector 的坐标（局部坐标）
- `e.absoluteX, e.absoluteY`：相对于屏幕的绝对坐标

### 3. Y 轴方向问题

某些情况下，RN 和 Native 的 Y 轴方向可能不一致：
- RN：Y 轴向下为正（屏幕坐标系）
- Live2D SDK：可能使用不同的坐标系

需要检查 `deviceToScreen` 矩阵是否正确处理了 Y 轴翻转。

---

## 正确的实施方案

### 1. 修复 SDK Bug（LAppView.kt）

**位置**：`packages/react-native-live2d/android/src/main/java/com/live2d/kotlin/LAppView.kt:365`

```kotlin
fun onTouchesMoved(pointX: Float, pointY: Float) {
    touchManager.touchesMoved(pointX, pointY)  // ✅ 先更新坐标
    val viewX = transformViewX(touchManager.getLastX())
    val viewY = transformViewY(touchManager.getLastY())
    LAppLive2DManager.getInstance().onDrag(viewX, viewY)
}
```

### 2. Native View 方法（ReactNativeLive2dView.kt）

```kotlin
/**
 * 单指注视 - 开始触摸（GL 线程安全）
 * @param x 屏幕绝对 X 坐标
 * @param y 屏幕绝对 Y 坐标
 */
fun onTouchBegan(x: Float, y: Float) {
    glSurfaceView.queueEvent {
        try {
            LAppDelegate.getInstance().onTouchBegan(x, y)
        } catch (e: Exception) {
            Log.e(TAG, "onTouchBegan error: ${e.message}")
        }
    }
}

/**
 * 单指注视 - 移动（GL 线程安全）
 */
fun onTouchMoved(x: Float, y: Float) {
    glSurfaceView.queueEvent {
        try {
            LAppDelegate.getInstance().onTouchMoved(x, y)
        } catch (e: Exception) {
            Log.e(TAG, "onTouchMoved error: ${e.message}")
        }
    }
    glSurfaceView.requestRender()
}

/**
 * 单指注视 - 结束（GL 线程安全）
 */
fun onTouchEnd(x: Float, y: Float) {
    glSurfaceView.queueEvent {
        try {
            LAppDelegate.getInstance().onTouchEnd(x, y)
        } catch (e: Exception) {
            Log.e(TAG, "onTouchEnd error: ${e.message}")
        }
    }
    glSurfaceView.requestRender()
}
```

### 3. Native Module Function（ReactNativeLive2dModule.kt）

```kotlin
Function("onTouchBegan") { x: Float, y: Float ->
    ReactNativeLive2dView.getCurrentInstance()?.onTouchBegan(x, y)
}

Function("onTouchMoved") { x: Float, y: Float ->
    ReactNativeLive2dView.getCurrentInstance()?.onTouchMoved(x, y)
}

Function("onTouchEnd") { x: Float, y: Float ->
    ReactNativeLive2dView.getCurrentInstance()?.onTouchEnd(x, y)
}
```

### 4. TypeScript 声明（ReactNativeLive2d.types.ts）

```typescript
export interface Live2DModule {
  // ... 现有声明 ...

  /**
   * 单指注视 - 开始
   * @param x 屏幕绝对 X 坐标
   * @param y 屏幕绝对 Y 坐标
   */
  onTouchBegan(x: number, y: number): void;

  /**
   * 单指注视 - 移动
   */
  onTouchMoved(x: number, y: number): void;

  /**
   * 单指注视 - 结束
   */
  onTouchEnd(x: number, y: number): void;
}
```

### 5. JS 手势（main.tsx）⚠️ 关键修复

```typescript
import { ReactNativeLive2dView, ReactNativeLive2dModule } from 'react-native-live2d';

// 单指注视手势
const gazeGesture = useMemo(() => {
  return Gesture.Pan()
    .maxPointers(1)
    .runOnJS(true)
    .onStart((e) => {
      // ⚠️ 使用 absoluteX/absoluteY（屏幕绝对坐标），不是 x/y（相对坐标）
      ReactNativeLive2dModule.onTouchBegan(e.absoluteX, e.absoluteY);
    })
    .onUpdate((e) => {
      ReactNativeLive2dModule.onTouchMoved(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      ReactNativeLive2dModule.onTouchEnd(e.absoluteX, e.absoluteY);
    });
}, []);

// 组合手势：单指注视 + 双指拖动/缩放
const live2dGesture = useMemo(() => {
  return Gesture.Race(
    Gesture.Simultaneous(dragGesture, pinchGesture),  // 双指操作
    gazeGesture,                                        // 单指注视
  );
}, [dragGesture, pinchGesture, gazeGesture]);
```

---

## 坐标系对照表

| 来源 | 坐标属性 | 坐标系 | 用途 |
|------|----------|--------|------|
| Web `pointermove` | `clientX/Y` | 视口坐标 | ✅ 传给 `model.focus()` |
| RNGH PanGesture | `x/y` | GestureDetector 局部坐标 | ❌ 不能直接用 |
| RNGH PanGesture | `absoluteX/Y` | 屏幕绝对坐标 | ✅ 传给 Native |
| RNGH PanGesture | `translationX/Y` | 相对于起点的偏移 | 用于拖动计算 |
| Native `onTouchesMoved` | `pointX/Y` | 屏幕坐标 | SDK 期望的输入 |

---

## 验证清单

- [ ] SDK Bug 已修复（`onTouchesMoved` 坐标顺序）
- [ ] JS 使用 `e.absoluteX/Y` 而非 `e.x/y`
- [ ] 单指触摸：模型眼睛跟随手指方向一致
- [ ] 手指左移 → 眼睛左看
- [ ] 手指右移 → 眼睛右看
- [ ] 手指上移 → 眼睛上看
- [ ] 手指下移 → 眼睛下看
- [ ] 双指操作：拖动/缩放功能正常
- [ ] 手势切换：单指↔双指过渡流畅

---

## 调试方法

如果方向仍然不一致，添加日志调试：

```kotlin
// LAppView.kt
fun onTouchesMoved(pointX: Float, pointY: Float) {
    touchManager.touchesMoved(pointX, pointY)
    val viewX = transformViewX(touchManager.getLastX())
    val viewY = transformViewY(touchManager.getLastY())

    // 调试日志
    Log.d("LAppView", "Input: ($pointX, $pointY) → View: ($viewX, $viewY)")

    LAppLive2DManager.getInstance().onDrag(viewX, viewY)
}
```

```typescript
// main.tsx
.onUpdate((e) => {
  console.log(`RNGH: x=${e.x}, y=${e.y}, absoluteX=${e.absoluteX}, absoluteY=${e.absoluteY}`);
  ReactNativeLive2dModule.onTouchMoved(e.absoluteX, e.absoluteY);
})
```

---

## 实施历史

| 版本 | 状态 | 问题 |
|------|------|------|
| B1 | ❌ 已回退 | RNGH 拦截导致 Native 无事件 |
| B2 | ❌ 已回退 | SDK 坐标顺序 bug |
| B3 | ❌ 已回退 | 使用 `e.x/y` 而非 `e.absoluteX/Y` |
| **C** | 🔄 待验证 | 使用正确的屏幕绝对坐标 |

---

## 参考：Web 端实现

```javascript
// static/live2d-interaction.js
Live2DManager.prototype.enableMouseTracking = function (model, options = {}) {
    const onPointerMove = (event) => {
        const pointer = { x: event.clientX, y: event.clientY };

        if (distance < threshold) {
            showButtons();
            if (this.isFocusing) {
                model.focus(pointer.x, pointer.y);  // ✅ 屏幕坐标
            }
        }
    };

    window.addEventListener('pointermove', onPointerMove);
};
```
