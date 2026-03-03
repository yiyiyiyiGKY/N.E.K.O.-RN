# 退出聊天后浮动按钮（缩小态）消失

## 问题描述

打开聊天面板后再关闭（点击遮罩或返回键），浮动的 💬 按钮在屏幕上找不到，无法再次打开聊天。Android 必现，iOS 不复现。

## 原因

`chatContainerWrapper` 没有 `top`，缩小态时高度坍塌为 0。浮动按钮用 `position: 'absolute'` + `bottom: 16` 定位，超出父容器边界后被 Android 默认的 `overflow: hidden` 裁剪。

## 解决

在 `app/(tabs)/main.tsx` 的 `chatContainerWrapper` 加 `top: 0` 撑满全屏，同时加 `pointerEvents: 'box-none'` 避免透明区域拦截下层触摸事件。

```typescript
chatContainerWrapper: {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  elevation: 100,
  pointerEvents: 'box-none',
},
```
