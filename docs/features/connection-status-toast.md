# 连接状态 Toast 提示

## 功能概述

将原本显示在聊天框内的系统连接状态消息（"已连接到服务器"/"与服务器断开连接"）改为屏幕顶部浮动 Toast 提示，使聊天界面更加干净，同时提供更直观的连接状态反馈。

## 实现方案

### 方案一：移除系统消息

**问题**：原有的系统状态消息混入聊天记录，污染对话内容。

**解决**：完全移除 `chat.addMessage('已连接到服务器', 'system')` 等系统消息，聊天记录仅保留用户和 AI 的对话内容。

### 方案二：Toast 状态提示

使用 `@project_neko/components` 提供的 `StatusToast` 组件，在屏幕顶部显示浮动提示：

| 场景 | 提示文案 | 持续时间 |
|------|---------|---------|
| 普通连接成功 | 已连接到服务器 | 2秒 |
| 从后台恢复重连成功 | 已恢复连接 | 2秒 |
| 连接断开（前台） | 连接已断开，正在尝试重连... | 3秒 |
| 切后台导致的断开 | 无提示 | - |

## 技术实现

### 核心代码位置

- **主文件**: `app/(tabs)/main.tsx`

### 关键改动

#### 1. 导入 StatusToast
```typescript
import { StatusToast, type StatusToastHandle } from '@project_neko/components';
```

#### 2. 添加状态追踪 Ref
```typescript
// 标记是否从后台恢复，用于区分普通连接和重连
const wasInBackgroundRef = useRef(false);

// StatusToast 控制引用
const statusToastRef = useRef<StatusToastHandle>(null);
```

#### 3. AppState 监听优化
```typescript
useEffect(() => {
  const subscription = AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      isInBackgroundRef.current = true;
    } else if (nextAppState === 'active') {
      // 标记是从后台恢复
      wasInBackgroundRef.current = true;
      setTimeout(() => {
        isInBackgroundRef.current = false;
        wasInBackgroundRef.current = false;
      }, 2000);
    }
  });
  return () => subscription.remove();
}, []);
```

#### 4. 连接状态回调处理
```typescript
onConnectionChange: (connected) => {
  if (connected) {
    // 根据场景显示不同的提示文案
    if (wasInBackgroundRef.current) {
      statusToastRef.current?.show('已恢复连接', 2000);
    } else if (!isSwitchingCharacterRef.current) {
      statusToastRef.current?.show('已连接到服务器', 2000);
    }
    // ... 角色切换逻辑
  } else {
    // 仅在前台状态下显示断开提示
    if (!isInBackgroundRef.current) {
      statusToastRef.current?.show('连接已断开，正在尝试重连...', 3000);
    }
    // ...
  }
}
```

#### 5. 渲染 StatusToast 组件
```tsx
return (
  <View style={styles.container}>
    {/* 状态提示 Toast */}
    <StatusToast ref={statusToastRef} />
    {/* ... 其他组件 */}
  </View>
);
```

## 用户体验优化

### 1. 场景化提示

区分普通连接和后台恢复重连，给用户更准确的反馈：
- 首次启动或手动重连 → "已连接到服务器"
- 切应用/锁屏后回来 → "已恢复连接"

### 2. 后台静音

当用户切到后台（如拍照、回消息）导致的连接断开，不显示错误提示，避免打扰。

### 3. 与 Chat Header 状态互补

Toast 提示负责**状态变化通知**，Chat Header 的小圆点负责**持续状态显示**：
- 🟢 绿色：已连接
- 🟡 黄色：连接中/重连中
- 🔴 红色：已断开

## 后续优化建议

### 可能的扩展

1. **重试次数提示**：当重连多次失败时，提示"连接失败，点击重试"
2. **网络类型变化**：WiFi 切换到移动数据时给出提示
3. **连接质量指示**：显示延迟或丢包率（如果是实时通话场景）

### 相关文件

- `app/(tabs)/main.tsx` - 主界面逻辑
- `packages/project-neko-components/src/StatusToast.native.tsx` - Toast 组件实现
- `packages/project-neko-components/src/chat/ChatContainer.native.tsx` - 聊天容器（含 Header 状态指示）

## 变更记录

| 日期 | 变更内容 | 作者 |
|------|---------|------|
| 2026-03-03 | 初始实现：移除系统消息，添加 Toast 提示 | Claude |
