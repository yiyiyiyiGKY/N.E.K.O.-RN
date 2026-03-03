# 角色切换加载状态

> 角色切换期间的全屏加载遮罩与完成提示设计

---

## 功能概述

当用户触发角色切换时，切换过程涉及多个异步步骤（Live2D 模型加载、配置保存、WebSocket 重连、音色重载），整个过程可能持续数秒。此功能在切换期间显示全屏加载遮罩阻止误操作，完成后将遮罩替换为短暂的提示条，告知用户切换结果。

---

## 触发时机

角色切换由两个入口触发，均走同一套加载状态逻辑：

1. **本地切换**：用户在主界面角色选择 Modal 中点击角色名
   - 位置：[app/(tabs)/main.tsx:550](../../app/(tabs)/main.tsx) `handleSwitchCharacter`
2. **远端广播**：服务端推送 `catgirl_switched` WebSocket 消息
   - 位置：[app/(tabs)/main.tsx:299](../../app/(tabs)/main.tsx) `onMessage` 处理

---

## 完整切换流程

```text
用户点击角色 / 收到 catgirl_switched 消息
          │
          ▼
  characterLoading = true        ← 显示全屏加载遮罩
  isSwitchingCharacterRef = true ← 标记切换中，屏蔽断连错误
  isChatForceCollapsed = true    ← 收起聊天面板
          │
          ├─ setConfig(characterName)   保存角色配置
          ├─ syncLive2dModel()          加载 Live2D 模型 + 贴图
          └─ WebSocket 断开重连         重新建立音频连接
                    │
          ┌─────────┴──────────┐
          │ 成功               │ 失败（API 报错 / 网络异常）
          ▼                    ▼
  onConnectionChange        characterLoading = false
  (connected=true)          Alert.alert('切换失败', ...)
          │
  ├─ 发送 start_session
  ├─ isSwitchingRef = false      ← 立即重置（非延迟）
  ├─ characterLoading = false    ← 隐藏加载遮罩
  ├─ isChatForceCollapsed = false
  └─ setSwitchedCharacterName(currentCatgirl)  ← 触发提示条
          │
          ▼
  显示提示条："已切换为 [角色名]"（2500ms 后自动消失）
  setTimeout(2500): setSwitchedCharacterName(null)
```

---

## 状态变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `characterLoading` | `boolean` | 控制全屏加载遮罩的显示，现有变量 |
| `switchedCharacterName` | `string \| null` | 新增，保存切换完成的角色名，用于驱动提示条显示；`null` 时不显示 |
| `currentCatgirlRef` | `MutableRefObject<string \| null>` | 新增 ref，与 `currentCatgirl` state 同步，供 `onConnectionChange` 闭包安全读取 |
| `isSwitchingCharacterRef` | `MutableRefObject<boolean>` | 现有 ref，切换期间屏蔽 WebSocket 断连错误 |

> 为什么需要 `currentCatgirlRef`：`useAudio` 的 `useEffect` 依赖是 `[config.host, config.port, config.characterName]`，`onConnectionChange` 不在依赖里，`AudioService` 创建后回调是固定闭包。虽然 `config.characterName` 变化会触发 `useEffect` 重新运行，但 React state 批处理顺序不保证 `currentCatgirl` 与新 `AudioService` 的 `onConnectionChange` 同步。用 ref 可绝对避免旧值问题，与代码中已有的 `live2dModelRef` 模式一致。

---

## UI 组件

### 全屏加载遮罩

条件：`characterLoading === true`

```text
┌─────────────────────────────┐
│                             │
│                             │
│        ⟳  （旋转圈）        │
│     正在切换角色...          │
│                             │
│                             │
└─────────────────────────────┘
```

- 全屏半透明黑色遮罩（`rgba(0,0,0,0.7)`）
- `ActivityIndicator` + 文字
- `pointerEvents="none"` 以外的区域不可点击（整个遮罩拦截触摸）
- 位于 Live2D 视图和工具栏之上（z-index 最高）

### 完成提示条

条件：`switchedCharacterName !== null`

复用现有 `showToast` 机制：

```typescript
showToast(`已切换为 ${switchedCharacterName}`)
```

- 显示时长：2500ms
- 显示完毕后将 `switchedCharacterName` 重置为 `null`
- 替换原有的 `Alert.alert('切换成功', ...)` 调用

---

## 需要修改的代码

### 1. 新增状态变量和 ref

文件：[app/(tabs)/main.tsx](../../app/(tabs)/main.tsx)

在现有 `characterLoading` 声明附近添加：

```typescript
const [switchedCharacterName, setSwitchedCharacterName] = useState<string | null>(null);

// ref 持有最新 currentCatgirl，供 onConnectionChange 闭包安全读取（避免 stale closure）
// 与 live2dModelRef 模式一致
const currentCatgirlRef = useRef<string | null>(null);
currentCatgirlRef.current = currentCatgirl;

// 用于清理提示条 timer，防止组件卸载后 setState
const switchedNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// 用于加载遮罩超时保护，防止 catgirl_switched 消息未到达时界面卡死
const characterLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### 2. 修改 `onConnectionChange` 完成回调

位置：第 314 行附近，`isSwitchingCharacterRef.current` 为 true 的分支

将：
```typescript
setCharacterLoading(false);
setIsChatForceCollapsed(false);
Alert.alert('切换成功', `已切换到角色: ${config.characterName}\n\n新的语音已生效！`);
```

改为：
```typescript
setCharacterLoading(false);
setIsChatForceCollapsed(false);
// 清除超时保护 timer
if (characterLoadingTimerRef.current) {
  clearTimeout(characterLoadingTimerRef.current);
  characterLoadingTimerRef.current = null;
}
const name = currentCatgirlRef.current;
setSwitchedCharacterName(name);
// 清除旧 timer 再设新的，防止重复触发
if (switchedNameTimerRef.current) clearTimeout(switchedNameTimerRef.current);
switchedNameTimerRef.current = setTimeout(() => setSwitchedCharacterName(null), 2500);
```

### 2b. 超时保护（两个入口均需添加）

超时保护需要在两处添加，封装为统一逻辑：

**位置 A：`handleSwitchCharacter` 成功分支**（第 563 行，`setCharacterModalVisible(false)` 之后）

**位置 B：`catgirl_switched` 消息处理**（第 308 行，`syncLive2dModel` 之后）

两处使用相同逻辑：

```typescript
// 超时保护：15 秒内若未收到 onConnectionChange(true)，自动解除所有切换状态
if (characterLoadingTimerRef.current) clearTimeout(characterLoadingTimerRef.current);
characterLoadingTimerRef.current = setTimeout(() => {
  setCharacterLoading(false);
  setIsChatForceCollapsed(false);
  isSwitchingCharacterRef.current = false;
  characterLoadingTimerRef.current = null;
}, 15000);
```

### 3. 切换失败路径保持 Alert

位置：`handleSwitchCharacter`（第 566~572 行），失败分支不变：

```typescript
// API 返回失败
setCharacterLoading(false);
Alert.alert('切换失败', res.error || '未知错误');

// 网络异常
setCharacterLoading(false);
Alert.alert('切换失败', err.message || '网络错误');
```

### 4. 新增全屏加载遮罩 JSX

位置：return 语句最外层 `<View style={styles.container}>` 内，`</Modal>` 之后、`</View>` 之前

```tsx
{characterLoading && (
  <View style={styles.switchingOverlay}>
    <ActivityIndicator size="large" color="#40c5f1" />
    <Text style={styles.switchingText}>正在切换角色...</Text>
  </View>
)}
```

### 5. 新增完成提示条 JSX

紧接加载遮罩之后：

```tsx
{switchedCharacterName !== null && (
  <View style={styles.switchingSuccessBanner} pointerEvents="none">
    <Text style={styles.switchingSuccessText}>已切换为 {switchedCharacterName}</Text>
  </View>
)}
```

### 6. 新增样式

```typescript
switchingOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 9999,
},
switchingText: {
  color: '#fff',
  fontSize: 16,
  marginTop: 12,
},
switchingSuccessBanner: {
  position: 'absolute',
  bottom: 80,
  alignSelf: 'center',
  backgroundColor: 'rgba(40, 40, 40, 0.9)',
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 20,
  zIndex: 9999,
},
switchingSuccessText: {
  color: '#40c5f1',
  fontSize: 15,
},
```

### 7. 补充 import

`ActivityIndicator` 需添加到第 16 行的 react-native import 列表：

```typescript
import {
  ActivityIndicator,  // ← 新增
  Alert, Dimensions, Modal, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
```

### 8. 清理 timer（组件卸载）

在现有 `useFocusEffect` 或 `useEffect` 清理逻辑附近，添加卸载时的 timer 清理，防止内存泄漏：

```typescript
useEffect(() => {
  return () => {
    if (switchedNameTimerRef.current) clearTimeout(switchedNameTimerRef.current);
    if (characterLoadingTimerRef.current) clearTimeout(characterLoadingTimerRef.current);
  };
}, []);
```

---

## 注意事项

- `characterLoading` 在本地切换入口（`handleSwitchCharacter`）和远端切换入口（`catgirl_switched`）均已设置为 `true`，无需额外处理
- 加载遮罩需覆盖 Live2D 视图，确保 `zIndex` 足够高
- `onConnectionChange` 是 `useAudio` 的固定闭包，必须通过 `currentCatgirlRef` 读取最新角色名，不能用 `currentCatgirl` state 或 `config.characterName`
- 切换失败路径（`handleSwitchCharacter` 的 else/catch 块）保留 `Alert.alert`，不替换
- 成功提示条不使用 `showToast`（其实现是 `Alert.alert` 包装，会阻塞交互），改用独立的 state 驱动 overlay
- 所有 `setTimeout` 必须用 ref 持有并在组件卸载时清理，防止内存泄漏
- 超时保护 timer（15 秒）在 `onConnectionChange` 成功时必须主动 clear，避免误触发
- 超时保护需在两个入口（`handleSwitchCharacter` 成功分支 + `catgirl_switched` 消息处理）均添加，且超时回调必须同时重置 `characterLoading`、`isChatForceCollapsed`、`isSwitchingCharacterRef`，否则聊天面板永久收起且后续 WebSocket 错误被静默忽略

---

## 加载失败处理方案

### 失败场景分类

| 场景 | 入口 | 当前行为 | 问题 |
|------|------|----------|------|
| API 返回失败 | `handleSwitchCharacter` | `Alert.alert('切换失败', ...)` | 有提示，正常 |
| 网络异常（catch） | `handleSwitchCharacter` | `Alert.alert('切换失败', ...)` | 有提示，正常 |
| 超时保护触发（15s） | 两个入口 | 静默重置所有状态 | **无任何提示** |
| WebSocket 重连失败 | 两个入口 | `isSwitchingCharacterRef` 屏蔽错误，15s 后静默重置 | **错误被静默忽略** |

### 修复方案

核心问题：后端连接不畅时，WebSocket 重连失败被 `isSwitchingCharacterRef` 屏蔽，15s 超时静默重置状态，用户看不到任何失败提示。

修复只需在两个超时回调中加入错误提示，无需改动其他逻辑。

#### 1. 新增失败提示状态变量

与 `switchedCharacterName` 同位置添加：

```typescript
const [switchError, setSwitchError] = useState<string | null>(null);
const switchErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

卸载清理（与其他 timer 同处）：

```typescript
if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
```

#### 2. 两个入口的超时回调均添加失败提示

`handleSwitchCharacter` 成功分支（[main.tsx:600](../../app/(tabs)/main.tsx#L600)）和 `catgirl_switched` 消息处理（[main.tsx:319](../../app/(tabs)/main.tsx#L319)）各有一个 15s timer，回调中加入：

```typescript
characterLoadingTimerRef.current = setTimeout(() => {
  setCharacterLoading(false);
  setIsChatForceCollapsed(false);
  isSwitchingCharacterRef.current = false;
  characterLoadingTimerRef.current = null;
  // 新增：超时时显示失败提示
  setSwitchError('连接超时，角色切换失败');
  if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
  switchErrorTimerRef.current = setTimeout(() => setSwitchError(null), 3000);
}, 15000);
```

#### 3. 失败提示条 JSX

紧接成功提示条之后：

```tsx
{switchError !== null && (
  <View style={styles.switchingErrorBanner} pointerEvents="none">
    <Text style={styles.switchingErrorText}>{switchError}</Text>
  </View>
)}
```

新增样式：

```typescript
switchingErrorBanner: {
  position: 'absolute',
  bottom: 80,
  alignSelf: 'center',
  backgroundColor: 'rgba(40, 40, 40, 0.9)',
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 20,
  zIndex: 9999,
},
switchingErrorText: {
  color: '#f55',
  fontSize: 15,
},
```

### 修改后的完整失败流程

```text
切换过程中发生错误
          │
          ├─ API/网络错误（handleSwitchCharacter catch）
          │         └─ Alert.alert('切换失败', message)   ← 保持不变
          │
          └─ 后端连接不畅（WebSocket 重连失败 / 超时）
                    └─ 15s 超时保护触发
                        ├─ 重置 characterLoading / isChatForceCollapsed / isSwitchingCharacterRef
                        └─ setSwitchError('连接超时，角色切换失败')
                            └─ 显示红色提示条 3000ms
```

> `handleSwitchCharacter` 的 API/网络错误保留 `Alert.alert`（阻塞式），超时失败用非阻塞提示条，避免后台切换场景下弹出无法交互的对话框。

---

## 竞态条件修复（2026-02-27）

### 问题描述

实施上述方案后，发现两个问题：

1. **成功切换但仍超时弹出失败**：本地切换成功后，`catgirl_switched` 消息覆盖了 `handleSwitchCharacter` 设置的超时 timer，导致切换成功后仍触发超时失败提示。

2. **远端切换、移动端未切换**：当 `config.characterName` 已经等于新角色名时（如启动时已同步），`useAudio` 的 effect 不会重新运行，`onConnectionChange(true)` 不会被调用，切换状态无法正确完成。

### 根因分析

#### 问题 1：timer 覆盖

```text
handleSwitchCharacter API 成功 → 设置 timer A (15s)
    ↓
catgirl_switched 消息到来 → 设置 timer B (15s) 覆盖 timer A
    ↓
onConnectionChange(true) → 清除 timer B
    ↓
如果有时序问题，timer 可能被再次设置，导致超时触发
```

此外，原实现中 `isSwitchingCharacterRef.current` 延迟 2 秒重置，在此期间如果有重复的 `catgirl_switched` 消息，会触发新的超时。

#### 问题 2：useAudio effect 不触发

`useAudio` 的依赖是 `[config.host, config.port, config.characterName]`。如果 `config.characterName` 已经等于新角色名（远端切换时本地已同步），effect 不会重新运行。

### 修复方案

#### 1. 幂等保护

在 `catgirl_switched` 处理开始时，检查是否已在切换中且目标角色相同：

```typescript
// 幂等保护：如果已在切换中且目标角色相同，跳过重复处理
if (isSwitchingCharacterRef.current && currentCatgirlRef.current === result.characterName) {
  console.log('🔄 [catgirl_switched] 已在切换中，跳过重复处理');
  return;
}
```

#### 2. 检测是否需要 WebSocket 重连

```typescript
// 检查是否需要触发 WebSocket 重连
const needsReconnect = config.characterName !== result.characterName;
```

#### 3. 无需重连时手动完成切换

当 `config.characterName` 已经等于新角色名时，`useAudio` effect 不会重新运行，需要手动完成：

```typescript
if (!needsReconnect) {
  console.log('📤 [catgirl_switched] config 未变化，手动完成切换');
  // 清除 handleSwitchCharacter 设置的超时 timer
  if (characterLoadingTimerRef.current) {
    clearTimeout(characterLoadingTimerRef.current);
    characterLoadingTimerRef.current = null;
  }
  // 直接发送 start_session
  audio.sendMessage({
    action: 'start_session',
    input_type: 'text',
    audio_format: 'PCM_48000HZ_MONO_16BIT',
    new_session: false,
  });
  // 立即完成切换
  isSwitchingCharacterRef.current = false;
  setCharacterLoading(false);
  setIsChatForceCollapsed(false);
  setSwitchedCharacterName(result.characterName);
  if (switchedNameTimerRef.current) clearTimeout(switchedNameTimerRef.current);
  switchedNameTimerRef.current = setTimeout(() => setSwitchedCharacterName(null), 2500);
  return;
}
```

#### 4. 避免覆盖 timer

仅在 timer 未设置时才设置新 timer：

```typescript
// 超时保护：15 秒内若未收到 onConnectionChange(true)，自动解除所有切换状态
// 仅在 timer 未设置时才设置，避免覆盖 handleSwitchCharacter 设置的 timer
if (!characterLoadingTimerRef.current) {
  characterLoadingTimerRef.current = setTimeout(() => {
    // ...
  }, 15000);
}
```

#### 5. 立即重置切换标志

移除原实现中的 2 秒延迟，改为立即重置：

```typescript
// 立即重置角色切换标志，避免后续消息重复触发超时
isSwitchingCharacterRef.current = false;
console.log('🔄 角色切换标志已重置');
```

### 修复后的完整流程

```text
catgirl_switched 消息到来
          │
          ├─ 幂等检查：已在切换中且目标相同？→ 跳过
          │
          ▼
  检查 needsReconnect = (config.characterName !== result.characterName)
          │
          ├─ needsReconnect = false（config 未变化）
          │     │
          │     ├─ 清除已有 timer
          │     ├─ 手动发送 start_session
          │     └─ 立即完成切换，显示成功提示
          │
          └─ needsReconnect = true（正常流程）
                │
                ├─ setConfig → 触发 useAudio effect
                ├─ 仅在 timer 未设置时才设置超时
                └─ onConnectionChange(true) → 清除 timer，完成切换
```

### 修改位置

- `catgirl_switched` 消息处理：[main.tsx:312](../../app/(tabs)/main.tsx#L312)
- `onConnectionChange` 回调：[main.tsx:373](../../app/(tabs)/main.tsx#L373)

---

## 相关文件

- [app/(tabs)/main.tsx](../../app/(tabs)/main.tsx) — 主要修改文件
- [docs/features/character-management.md](./character-management.md) — 角色管理功能总览
- [hooks/useLive2DAgentBackend.ts](../../hooks/useLive2DAgentBackend.ts) — WebSocket 事件处理
- [hooks/useLive2D.ts](../../hooks/useLive2D.ts) — Live2D 模型加载
