# 修复：切换角色后 Chat 不随之切换

## 核心设计

与主项目对齐：**API 调用只触发切换，UI 更新完全由服务端广播的 `catgirl_switched` 消息驱动**，本地切换和远端切换走同一路径。

```
用户点击切换 → API setCurrentCatgirl()
                      ↓
            服务端广播 catgirl_switched
                      ↓
            onMessage：清空消息、关闭 chat、显示 overlay、更新 config
                      ↓
            useAudio useEffect 重连 WebSocket
                      ↓
            onConnectionChange(true)：隐藏 overlay、弹窗提示
```

## 问题与修复

### 问题一：本地切换后 Chat 未同步

原因：`handleSwitchCharacter` 只更新 UI state，未更新 `config.characterName`，导致 WebSocket 不重连、消息不清空。

已被问题二的统一方案取代。

### 问题二：远端切换后 UI 未同步 + 统一切换流程

原因：`useChatMessages` 未处理 `catgirl_switched` 消息，UI 角色显示和 WebSocket 均未更新。

修复：
- `useChatMessages`：解析 `catgirl_switched`，清空消息并返回新角色名
- `ChatContainer`：新增 `forceCollapsed` prop，切换时强制折叠
- `main.tsx`：`handleSwitchCharacter` 只调 API；`onMessage` 统一处理切换（折叠 chat、显示 loading、更新 config）；`onConnectionChange` 重连完成后收尾

### 问题三：启动时角色与服务端不匹配

原因：`config.characterName` 是本地缓存，可能与服务端当前角色不符。

修复：挂载时调用 `GET /api/characters/current_catgirl`，以服务端为准更新本地 config，失败则降级用本地缓存。

## 已知边界情况

- **loading 卡死**：API 成功后若服务端未广播 `catgirl_switched`，overlay 会卡住。可加超时兜底强制清除 loading。
- **`onConnectionChange` 角色名**：Alert 显示的名称依赖 `useAudio` 重建时捕获的闭包值，行为正确但需注意时序。
