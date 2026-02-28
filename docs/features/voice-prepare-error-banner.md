# 语音系统准备失败提示样式调整

> 将语音系统准备失败的错误提示从静默失败改为与角色切换失败一致的底部横幅样式

**状态**：✅ 已实施

> **实施日期**：2026-02-28

---

## 问题描述

当前语音系统准备失败时，用户看不到任何错误提示：

| 场景 | 当前行为 | 问题 |
|------|----------|------|
| 语音准备失败（录音启动异常） | 遮罩静默消失，麦克风按钮回弹 | 用户不知道发生了什么 |
| 麦克风权限被拒（Android） | `Alert.alert` 弹窗，但被 catch 静默吞掉 | 提示被覆盖 |
| 角色切换超时失败 | 底部红色横幅 "连接超时，角色切换失败"，3s 自动消失 | 体验良好 |

目标：语音准备失败时显示与角色切换失败**一致样式**的底部横幅提示。

---

## 现有角色切换失败提示样式（目标样式）

位置：[app/(tabs)/main.tsx:1114-1119](../../app/(tabs)/main.tsx#L1114-L1119)

```tsx
{switchError !== null && (
  <View style={styles.switchingErrorBanner} pointerEvents="none">
    <Text style={styles.switchingErrorText}>{switchError}</Text>
  </View>
)}
```

样式定义：[app/(tabs)/main.tsx:1332-1345](../../app/(tabs)/main.tsx#L1332-L1345)

```typescript
switchingErrorBanner: {
  position: 'absolute',
  bottom: 80,
  alignSelf: 'center',
  backgroundColor: 'rgba(40, 40, 40, 0.9)',   // 深灰半透明背景
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 20,                            // 圆角胶囊形
  zIndex: 9999,
},
switchingErrorText: {
  color: '#f55',                                // 红色文字
  fontSize: 15,
},
```

视觉效果：

```text
┌─────────────────────────────────┐
│                                 │
│         (主界面内容)             │
│                                 │
│  ┌──────────────────────────┐   │
│  │  连接超时，角色切换失败    │   │  ← bottom: 80, 圆角胶囊
│  └──────────────────────────┘   │
│       [工具栏按钮区域]          │
└─────────────────────────────────┘
```

---

## 当前语音准备失败流程

位置：[app/(tabs)/main.tsx:665-683](../../app/(tabs)/main.tsx#L665-L683)

```typescript
const handleToggleMic = useCallback(async (next: boolean) => {
  setToolbarMicEnabled(next);
  if (next) {
    setVoicePrepareStatus('preparing');
    try {
      await mainManager.startRecording();
      setVoicePrepareStatus('ready');
      setTimeout(() => setVoicePrepareStatus(null), 800);
    } catch {
      setVoicePrepareStatus(null);       // ← 遮罩静默消失
      setToolbarMicEnabled(false);       // ← 麦克风按钮回弹
      // ← 没有任何错误提示！
    }
  } else {
    mainManager.stopRecording();
    setIsTextSessionActive(false);
  }
}, [mainManager]);
```

`AudioService.startRecording()` 内部的 `Alert.alert` 调用：

位置：[services/AudioService.ts:258-282](../../services/AudioService.ts#L258-L282)

```typescript
// Android 权限被拒
Alert.alert('需要权限', '需要麦克风权限才能使用语音功能');  // ← 弹出后又被 throw 打断

// 录音启动失败
Alert.alert('错误', '开始录音失败');                      // ← 弹出后被上层 catch 覆盖
throw error;                                             // ← 上层 catch 静默吞掉
```

问题链：`AudioService` 内部虽然调用了 `Alert.alert`，但紧接着 `throw error`，上层 `handleToggleMic` 的 catch 块会在 Alert 显示的同时执行 `setVoicePrepareStatus(null)`，导致 UI 状态混乱。核心问题是上层没有自己的错误提示。

---

## 修改方案

### 方案概述

复用 `switchError` 状态变量和 `switchingErrorBanner` 样式，将其语义扩展为通用的底部错误提示横幅。语音准备失败时设置相同的状态即可获得一致的视觉效果。

### 1. 修改 `handleToggleMic` catch 块

文件：[app/(tabs)/main.tsx:673-675](../../app/(tabs)/main.tsx#L673-L675)

将：
```typescript
catch {
  setVoicePrepareStatus(null);
  setToolbarMicEnabled(false);
}
```

改为：
```typescript
catch {
  setVoicePrepareStatus(null);
  setToolbarMicEnabled(false);
  // 显示与角色切换失败一致的底部错误横幅
  setSwitchError('语音系统准备失败');
  if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
  switchErrorTimerRef.current = setTimeout(() => setSwitchError(null), 3000);
}
```

### 2. （可选）移除 AudioService 中的 Alert.alert

如果不希望同时显示 `Alert.alert` 弹窗和底部横幅，可以移除 `AudioService.startRecording()` 中的 Alert 调用，只保留 `throw`：

文件：[services/AudioService.ts:263](../../services/AudioService.ts#L263)

将：
```typescript
Alert.alert('需要权限', '需要麦克风权限才能使用语音功能');
return;
```

改为：
```typescript
throw new Error('需要麦克风权限才能使用语音功能');
```

文件：[services/AudioService.ts:280](../../services/AudioService.ts#L280)

将：
```typescript
Alert.alert('错误', '开始录音失败');
throw error;
```

改为：
```typescript
throw error;
```

这样错误信息的展示统一由上层 `handleToggleMic` 的底部横幅负责。

### 3. （可选）提取为通用错误横幅方法

如果后续有更多场景需要使用底部错误横幅，可以将设置逻辑提取为一个工具函数：

```typescript
const showErrorBanner = useCallback((message: string, duration = 3000) => {
  setSwitchError(message);
  if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
  switchErrorTimerRef.current = setTimeout(() => setSwitchError(null), duration);
}, []);
```

然后在各处调用：
```typescript
// 角色切换超时
showErrorBanner('连接超时，角色切换失败');

// 语音准备失败
showErrorBanner('语音系统准备失败');
```

如果提取此方法，建议将 `switchError` / `setSwitchError` 重命名为更通用的名称如 `errorBannerText` / `setErrorBannerText`，样式名也对应更新为 `errorBanner` / `errorBannerText`。

---

## 修改后的流程

```text
用户点击麦克风按钮
        │
        ▼
setVoicePrepareStatus('preparing')    ← 显示脉冲动画遮罩
        │
        ▼
await mainManager.startRecording()
        │
   ┌────┴────┐
   │ 成功    │ 失败
   ▼         ▼
 'ready'   setVoicePrepareStatus(null)     ← 隐藏遮罩
 800ms后    setToolbarMicEnabled(false)     ← 麦克风按钮回弹
 消失      setSwitchError('语音系统准备失败') ← 显示底部红色横幅
                    │
                    ▼
               3000ms 后自动消失
```

---

## 样式一致性对照

| 属性 | 角色切换失败横幅 | 语音准备失败横幅（修改后） |
|------|-----------------|--------------------------|
| 位置 | `position: absolute, bottom: 80` | 复用同一组件，完全一致 |
| 背景 | `rgba(40, 40, 40, 0.9)` | 同上 |
| 圆角 | `borderRadius: 20` | 同上 |
| 文字颜色 | `#f55`（红色） | 同上 |
| 字号 | `15` | 同上 |
| 自动消失 | 3000ms | 3000ms |
| 交互 | `pointerEvents="none"` | 同上 |

---

## 无需修改的部分

- **`VoicePrepareOverlay` 组件**（[components/VoicePrepareOverlay.tsx](../../components/VoicePrepareOverlay.tsx)）：仅负责准备中/就绪的动画展示，不涉及失败状态，无需修改
- **底部横幅 JSX 和样式**（`switchingErrorBanner` / `switchingErrorText`）：已存在，直接复用
- **`switchError` 状态和 timer**：已存在，直接复用

---

## 相关文件

- [app/(tabs)/main.tsx](../../app/(tabs)/main.tsx) — 主要修改文件（`handleToggleMic` catch 块）
- [services/AudioService.ts](../../services/AudioService.ts) — 可选修改（移除内部 Alert.alert）
- [components/VoicePrepareOverlay.tsx](../../components/VoicePrepareOverlay.tsx) — 语音准备遮罩组件（无需修改）
- [docs/features/character-switch-loading.md](./character-switch-loading.md) — 角色切换加载状态文档（包含错误横幅的原始设计）
