# 角色切换时的 WebSocket 连接问题修复

**日期**: 2026-02-26（更新）
**影响范围**: React Native 端角色切换功能
**严重程度**: 高 - 影响用户切换角色后的使用体验

## 问题描述

### 症状

用户在 React Native 端切换角色时遇到以下问题：

1. **显示"WS连接错误"**：状态指示器短暂显示红色（断开状态）
2. **切换后无法发送消息**：虽然界面显示连接成功，但 `start_session` 消息丢失
3. **文本聊天无法接收音频信号**：即使连接建立，也无法正常接收音频回复

## 2026-02-26 更新：问题1修复 - WS连接错误弹出

### 问题分析

**根本原因**：`useAudio.ts` 的 `onError` 回调直接设置 `setConnectionStatus('连接错误')`，**没有检查 `isSwitchingCharacterRef`**。

角色切换流程中的问题点：
1. `handleSwitchCharacter` 设置 `isSwitchingCharacterRef.current = true`
2. `applyQrRaw` 更新 config.characterName
3. useAudio useEffect 检测到变化，销毁旧 AudioService
4. **旧 WebSocket 关闭时可能触发 `error` 事件**
5. onError 回调被触发，直接显示"连接错误"

而 `onConnectionChange` 在 main.tsx 中检查了 `isSwitchingCharacterRef`，所以能正确忽略。
但 `onError` 没有检查，导致问题。

### 时序问题（第二次修复）

即使添加了 `isSwitchingRef` 检查，仍然会出现错误，原因：

```typescript
// handleSwitchCharacter 的 finally 块
finally {
  isSwitchingCharacterRef.current = false;  // ← 立即重置
}
```

**问题流程**：
1. 切换完成，显示 Alert
2. finally **立即执行**，`isSwitchingRef = false`
3. 用户看到 Alert
4. 此时旧连接的**延迟 error 事件**到达
5. `onError` 检查 `isSwitchingRef` → 已经是 `false`
6. 显示"连接错误"

### isReadyRef 未重置问题（第三次修复）

日志显示：
```
LOG  ✅ start_session 已调用        ← 发送消息（此时还没连接！）
ERROR WebSocket未连接，无法发送消息  ← 失败
LOG  WebSocket连接已建立            ← 之后才连接成功
```

**根本原因**：useAudio 清理函数中没有重置 `isReadyRef.current = false`：

```typescript
// ❌ 错误的清理函数
return () => {
  audioServiceRef.current?.destroy();
  audioServiceRef.current = null;
  // 缺少：isReadyRef.current = false;
};
```

**问题流程**：
1. 旧 AudioService 已就绪，`isReadyRef.current = true`
2. 角色切换，清理函数执行，销毁旧 AudioService
3. **但 `isReadyRef.current` 还是 `true`**
4. 新 AudioService 开始初始化（异步）
5. `waitForConnection` 检查 `isReadyRef.current` → `true`（旧值）
6. 立即返回，发送 `start_session`
7. **此时新 WebSocket 还没连接，发送失败**

### 完整修复方案

**修改文件 1**: `hooks/useAudio.ts`

```typescript
interface UseAudioConfig {
  // ... 其他属性
  // 🔥 新增：角色切换标志 ref，用于在切换期间忽略错误
  isSwitchingRef?: React.RefObject<boolean>;
}

// 在 AudioService 配置中：
onError: (error) => {
  // 🔥 修复：在角色切换期间忽略错误，避免显示"连接错误"
  if (config.isSwitchingRef?.current) {
    console.log('🔄 角色切换中，忽略 WebSocket 错误:', error);
    return;
  }
  console.error('❌ 音频服务错误:', error);
  setConnectionStatus('连接错误');
},
```

**修改文件 2**: `app/(tabs)/main.tsx`

```typescript
const audio = useAudio({
  host: config.host,
  port: config.port,
  characterName: config.characterName,
  // 🔥 传入角色切换标志，用于在切换期间忽略错误
  isSwitchingRef: isSwitchingCharacterRef,
  // ... 其他配置
});

// handleSwitchCharacter 的 finally 块
finally {
  // 🔥 修复：延迟重置角色切换标志，给旧连接足够时间清理
  // 旧 WebSocket 关闭时可能会延迟触发 error 事件，需要延迟重置标志
  setTimeout(() => {
    isSwitchingCharacterRef.current = false;
    console.log('🔄 角色切换标志已重置');
  }, 2000);  // 延迟 2 秒
  setCharacterLoading(false);
}
```

**修改文件 3**: `hooks/useAudio.ts` - 清理函数重置 isReadyRef

```typescript
// 清理函数
return () => {
  console.log('🧹 useAudio 清理中...');
  audioServiceRef.current?.destroy();
  audioServiceRef.current = null;
  setIsRecording(false);
  setIsConnected(false);
  // 🔥 修复：清理时重置 isReadyRef，避免 waitForConnection 误判
  isReadyRef.current = false;
};
```

## 2026-02-26 更新：问题2分析 - 切换后文本聊天无法播放音频

### 问题分析

经过代码分析，确认消息流转机制：

1. **realtime client 的事件派发**（`client.ts:169-186`）：
   - `message` 事件 → WSService.onMessage → main.tsx
   - `json` 事件 → audioServiceNative.handleIncomingJson
   - `binary` 事件 → audioServiceNative.handleIncomingBinary
   - **三个事件是独立派发的，不会互相拦截**

2. **audioServiceNative 的 handleIncomingJson**：
   - `session_started` 的 `return` 只跳过内部处理
   - **不会阻止** WSService 的 `onMessage` 收到消息

### 可能的原因

1. **服务端问题**：角色切换后，服务端可能没有正确处理 `audio_format` 参数，不返回 PCM 数据
2. **binary 监听器未正确工作**：新实例的 attach() 可能有问题
3. **manualInterruptActive 状态异常**：理论上新实例应该是 false

### 添加的调试日志

在 `audioServiceNative.ts` 的 `handleIncomingBinary` 添加日志：

```typescript
const handleIncomingBinary = (data: unknown) => {
  // 🔍 调试：确认是否收到 binary 数据
  console.log('🎵 audioServiceNative 收到 binary:', {
    type: typeof data,
    isArrayBuffer: data instanceof ArrayBuffer,
    isUint8Array: data instanceof Uint8Array,
    byteLength: (data as any)?.byteLength,
    skipNextBinary: interrupt.getSkipNextBinary(),
    manualInterruptActive,
  });

  if (interrupt.getSkipNextBinary()) {
    console.log('⚠️ binary 被 skipNextBinary 拦截');
    return;
  }
  if (manualInterruptActive) {
    console.log('⚠️ binary 被 manualInterruptActive 拦截');
    return;
  }
  // ...
};
```

### 验证方法

切换角色后发送文本消息，观察日志：
- 如果**没有** `🎵 audioServiceNative 收到 binary` → 服务端没有返回 PCM
- 如果有日志但 `⚠️ binary 被拦截` → 检查拦截原因
- 如果有日志且数据正常 → 检查 PCMStream.playPCMChunk 是否成功

### 根本原因分析

#### 1. 状态指示器显示错误

**问题代码**：
```typescript
const connectionStatus: ConnectionStatus = audio.isConnected ? 'open' : 'closed';
```

**原因**：
- `audio.isConnected` 来自 React state，在 `onConnectionChange` 回调中更新
- 角色切换时，`useAudio` hook 的依赖项（`characterName`）改变，触发 useEffect 清理和重新初始化
- 清理阶段 `audio.isConnected` 短暂变为 `false`，导致状态指示器显示红色

#### 2. start_session 消息丢失

**问题代码**：
```typescript
// 在 waitForConnection 闭包中
const isReady = audio.audioService?.isReady() ?? false;
```

**原因**：
- `waitForConnection` 是一个闭包，捕获的是**旧的** `audio` 对象引用
- 当 `useAudio` hook 重新初始化 `AudioService` 时，闭包中的 `audio.audioService` 仍然指向**已销毁的旧实例**
- 旧实例的 `isReady()` 返回 `false`（因为 `connectionStatus` 是 `disconnected`）
- 导致 `waitForConnection` 超时，`start_session` 消息从未发送

#### 3. 闭包引用问题详解

```
时间线：
T0: 用户点击切换角色
T1: applyQrRaw() 更新 config.characterName
T2: useAudio useEffect 清理 -> 销毁旧 AudioService
T3: useAudio useEffect 重新执行 -> 创建新 AudioService
T4: waitForConnection 开始轮询（闭包捕获的是 T0 时刻的 audio 对象）
T5: 新 AudioService 初始化完成
T6: waitForConnection 检查 audio.audioService?.isReady()
    -> 访问的是 T0 时刻的旧实例（已销毁）
    -> isReady() 返回 false
T7: 超时，start_session 未发送
```

## 解决方案

### 方案 1: 状态指示器修复（已实施）

**修改文件**: `app/(tabs)/main.tsx`

```typescript
// 将 audio.connectionStatus 映射到 ConnectionStatus 类型
// 在角色切换期间，保持 'open' 状态，避免显示断开错误
const connectionStatus: ConnectionStatus = isSwitchingCharacterRef.current
  ? 'open'
  : (audio.isConnected ? 'open' : 'closed');
```

**原理**：
- 在角色切换期间（`isSwitchingCharacterRef.current = true`），强制状态为 `'open'`
- 避免用户看到短暂的断开状态

### 方案 2: AudioService 就绪检查修复（已实施）

#### 2.1 添加 isReady() 方法

**修改文件**: `services/AudioService.ts`

```typescript
/**
 * 是否已完全初始化
 */
isReady(): boolean {
  return this.isInitialized && this.connectionStatus === ConnectionStatus.CONNECTED;
}
```

**原理**：
- 同时检查 `isInitialized` 和 `connectionStatus`
- 确保不仅 WebSocket 连接，而且 AudioService 内部初始化也完成

#### 2.2 添加 isReadyRef 避免闭包引用问题

**修改文件**: `hooks/useAudio.ts`

```typescript
export interface UseAudioReturn {
  // ... 其他属性

  // AudioService 是否完全就绪的 ref（避免闭包引用问题）
  isReadyRef: React.RefObject<boolean>;
}

export const useAudio = (config: UseAudioConfig): UseAudioReturn => {
  // 🔥 AudioService 是否完全就绪的 ref
  const isReadyRef = useRef<boolean>(false);

  useEffect(() => {
    // 创建 AudioService
    audioServiceRef.current = new AudioService({...});

    // 初始化服务
    audioServiceRef.current.init().catch(error => {
      console.error('❌ AudioService 初始化失败:', error);
      isReadyRef.current = false;
    }).then(() => {
      // 🔥 初始化完成后，更新 isReadyRef
      if (audioServiceRef.current?.isReady()) {
        console.log('✅ AudioService 已完全就绪，更新 isReadyRef');
        isReadyRef.current = true;
      }
    });

    return () => {
      audioServiceRef.current?.destroy();
      isReadyRef.current = false; // 清理时重置
    };
  }, [config.host, config.port, config.characterName]);

  return {
    // ... 其他属性
    isReadyRef,
  };
};
```

**修改文件**: `app/(tabs)/main.tsx`

```typescript
// 🔥 等待连接重建（分两阶段：等待断开 -> 等待重连 + AudioService 完全就绪）
const waitForConnection = (): Promise<boolean> => {
  return new Promise((resolve) => {
    const check = () => {
      if (phase === 'waiting_connect') {
        // 🔥 使用 isReadyRef 避免闭包引用问题
        const isReady = audio.isReadyRef.current;

        if (isReady) {
          console.log('✅ 新连接已建立且 AudioService 已完全初始化');
          resolve(true);
        }
        // ...
      }
    };
    check();
  });
};
```

**原理**：
- `isReadyRef` 是 React ref，其 `.current` 属性**始终指向最新值**
- 即使闭包捕获的是旧的 `audio` 对象，`audio.isReadyRef.current` 也会返回最新的就绪状态
- 这是因为 ref 本身是一个容器，引用不变，但 `.current` 的值会更新

### 为什么使用 ref 而不是 state？

**State 的问题**：
```typescript
// ❌ 错误示例：使用 state
const [isReady, setIsReady] = useState(false);

// 在闭包中
const check = () => {
  if (isReady) { // <- 捕获的是闭包创建时的值
    resolve(true);
  }
};
```

**Ref 的优势**：
```typescript
// ✅ 正确：使用 ref
const isReadyRef = useRef(false);

// 在闭包中
const check = () => {
  if (isReadyRef.current) { // <- 始终访问最新值
    resolve(true);
  }
};
```

## 验证测试

### 测试场景

1. **正常切换角色**
   - 点击角色管理
   - 选择新角色
   - 观察状态指示器（应保持绿色）
   - 发送文本消息，验证能收到音频回复

2. **快速连续切换**
   - 快速切换多个角色
   - 验证每次切换后都能正常发送消息

3. **网络不稳定情况**
   - 在弱网环境下切换角色
   - 验证超时提示是否正常

### 预期日志

成功切换时应该看到：
```
LOG  🧹 AudioService 销毁中...
LOG  ✅ AudioService 已销毁
LOG  🎧 useAudio 初始化中... {"characterName": "sakura", ...}
LOG  🎧 AudioService 初始化中...
LOG  WebSocket连接已建立: ws://...
LOG  ✅ WebSocket 已连接
LOG  ✅ 音频服务初始化完成
LOG  ✅ AudioService 初始化完成
LOG  ✅ AudioService 已完全就绪，更新 isReadyRef
LOG  ✅ 新连接已建立且 AudioService 已完全初始化
LOG  📤 发送 start_session 以重新加载角色音色
LOG  ✅ start_session 已调用
```

失败情况（超时）：
```
LOG  ❌ 等待连接超时 {"isConnected": true, "isReadyRef": false}
```

## 相关文件

- `app/(tabs)/main.tsx` - 主界面，角色切换逻辑
- `hooks/useAudio.ts` - Audio hook，管理 AudioService 生命周期
- `services/AudioService.ts` - Audio 服务，管理 WebSocket 和音频处理
- `services/wsService.ts` - WebSocket 服务

## 后续优化建议

### 1. 统一状态管理

当前有多个状态源：
- `audio.isConnected` (React state)
- `isConnectedRef.current` (ref)
- `AudioService.isConnected()` (方法)
- `AudioService.isReady()` (方法)

建议统一为一个状态管理方案，减少混淆。

### 2. 改进角色切换体验

- 添加加载动画
- 显示"正在切换角色..."提示
- 切换成功后显示确认消息

### 3. 错误处理增强

- 网络超时时提供重试按钮
- 记录切换失败次数，超过阈值后提示用户检查网络
- 提供手动重连机制

### 4. 代码重构

将 `waitForConnection` 提取为独立的 hook：
```typescript
function useAudioServiceReady() {
  const audio = useAudio();
  const waitForReady = useCallback(() => {...}, []);
  return { waitForReady };
}
```

## 总结

这个问题的核心是 **React 闭包引用陷阱**：
- 在异步回调/闭包中访问外部变量时，捕获的是**创建时的值**
- 使用 **ref** 可以避免这个问题，因为 ref 的 `.current` 始终指向最新值

修复后，角色切换流程更加可靠：
1. ✅ 不再显示错误的断开状态
2. ✅ 确保 AudioService 完全初始化后才发送消息
3. ✅ 使用 ref 避免闭包引用问题

## 参考资料

- [React Hooks 闭包陷阱](https://react.dev/learn/referencing-values-with-refs)
- [ useRef vs useState](https://react.dev/learn/referencing-values-with-refs#differences-between-refs-and-state)
- [Stale Closures in React](https://dmitripavlutin.com/react-hooks-stale-closures/)
