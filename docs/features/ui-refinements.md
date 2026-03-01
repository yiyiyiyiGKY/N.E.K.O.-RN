# 角色选择弹窗蓝白主题统一

**状态**：✅ 已实施 · **日期**：2026-02-27

角色选择弹窗原为深色背景（`#1a1a2e`），与 Web 端 CharacterManager 蓝白风格不一致。整体与 `theme.css` 设计规范对齐，具体改动：

- **标题**：「选择角色」改为「角色管理」
- **弹窗容器**：深色背景改为白色（`#ffffff`）
- **Header**：新增蓝色顶栏（`#40C5F1`）+ 右上角白色 ✕ 关闭按钮，移除原底部取消按钮
- **副标题**：当前角色名改为蓝色高亮（`#40C5F1` 加粗）
- **列表项**：浅蓝背景（`#f0f8ff`）+ 蓝色边框 + 左侧 4px 蓝线（对应 Web 端 `section-header border-left`）
- **角色名**：改为蓝色（`#40C5F1`）居中显示
- **当前项**：背景加深（`#e3f4ff`）、文字改为深蓝（`#22b3ff`）+ 蓝底白字「当前」胶囊徽章，非当前项右侧等宽占位保持对齐

**关键修改**：[app/(tabs)/main.tsx](../../app/(tabs)/main.tsx)（Modal 样式及 JSX 结构）

---

# 语音系统准备失败提示样式调整

**状态**：✅ 已实施 · **日期**：2026-02-28

语音准备失败时原本静默无提示（遮罩消失、按钮回弹，用户不知发生了什么）。复用现有 `switchError` 状态及 `switchingErrorBanner` 样式，在 `handleToggleMic` catch 块中调用 `setSwitchError('语音系统准备失败')`，3s 后自动消失，与角色切换失败横幅完全一致。同时移除 `AudioService` 内的 `Alert.alert`，统一由上层横幅负责展示错误。

**关键修改**：[app/(tabs)/main.tsx](../../app/(tabs)/main.tsx)（`handleToggleMic` catch 块）、[services/AudioService.ts](../../services/AudioService.ts)（移除内部 Alert）

---

# 工具栏按钮百分比定位

**状态**：✅ 已实施 · **日期**：2026-03-01

右上角浮动工具栏 `top` 从固定 `12px` 改为 `screenHeight * 0.05`（5% 屏幕高度），保证各尺寸屏幕视觉位置一致。同时新增 `screenHeight` state 并在 Dimensions 监听器中同步，支持旋转响应。

**关键修改**：[app/(tabs)/main.tsx:181, 902-905, 1011](../../app/(tabs)/main.tsx)

---

# 语音模式下无法切换角色提示弹窗样式统一

**状态**：✅ 已实施 · **日期**：2026-03-01

语音模式下点击切换角色时，`handleSwitchCharacter` 使用系统原生 `Alert.alert('无法切换角色', ...)` 弹出提示，与项目自定义蓝白主题 Modal 风格不一致。

改为复用现有 `characterModal*` 样式，新增一个独立的 `Modal` 组件：

- **容器**：复用 `characterModalOverlay` + `characterModalContent`，宽度收窄至 `72%`（原角色管理弹窗为 `82%`）
- **Header**：复用 `characterModalHeader` 结构（蓝色顶栏 `#40C5F1`）+ 右上角白色 ✕ 关闭按钮
- **正文**：提示文字蓝色加粗（`#40C5F1`，`fontWeight: '600'`）
- **按钮**：底部蓝底白字「好的」确认按钮（`backgroundColor: '#40C5F1'`，pill 形圆角）
- **触发**：将 `Alert.alert` 替换为 `setVoiceBlockModalVisible(true)`，新增对应 state

**关键修改**：[app/(tabs)/main.tsx](../../app/(tabs)/main.tsx)（`handleSwitchCharacter` + 新增 Modal JSX 及 state）
