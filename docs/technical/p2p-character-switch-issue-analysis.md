# P2P 连接下角色切换"已离开"问题技术分析

## 问题概述

在同一 WiFi 环境下使用 P2P 连接时，角色切换功能出现两个异常现象：

1. **点开管理准备切换角色时，当前角色显示"已离开"**
2. **切换后的角色语音聊天几句后也会显示"已离开"**

本文档详细分析问题根因并提供修复建议。

---

## 架构背景

### P2P 连接架构

```
┌─────────────────┐      P2P WebSocket      ┌─────────────────┐
│   手机 App      │ ◄──────────────────────► │   LAN Proxy     │
│  (React Native) │   ws://lan_ip:48920/ws   │   (lan_proxy.py)│
└─────────────────┘                         └────────┬────────┘
                                                     │
                                                     │ 本地转发
                                                     ▼
                                            ┌─────────────────┐
                                            │   Main Server   │
                                            │  (FastAPI)      │
                                            └─────────────────┘
                                                     ▲
                                                     │ 本地 WebSocket
                                            ┌────────┴────────┐
                                            │   Web 前端      │
                                            │  (桌面浏览器)   │
                                            └─────────────────┘
```

### 关键组件

| 组件 | 文件路径 | 职责 |
|------|---------|------|
| LAN Proxy | `lan_proxy.py` | P2P 连接的反向代理服务器 |
| WebSocket Router | `main_routers/websocket_router.py` | WebSocket 连接管理 |
| Characters Router | `main_routers/characters_router.py` | 角色切换 API |
| Session Manager | `main_logic/core.py` | 会话状态管理 |
| 初始化函数 | `main_server.py:272` | `initialize_character_data()` 角色数据初始化 |
| RN App | `N.E.K.O.-RN/app/(tabs)/main.tsx` | 手机端主页面 |
| Web App | `static/app.js` | 桌面端主页面 |

---

## 已有的保护机制

在分析问题之前，需要了解代码中**已有的保护措施**，这些机制在一定程度上缓解了部分问题：

### 1. session_id 互斥机制

**代码位置**: `main_routers/websocket_router.py:62-66, 81-84`

```python
# 每次新连接分配唯一 session_id
this_session_id = uuid.uuid4()
async with _lock:
    session_id[lanlan_name] = this_session_id  # 覆盖旧的

# 旧连接在下次收消息时检测到 session_id 不匹配
if session_id[lanlan_name] != this_session_id:
    await session_manager[lanlan_name].send_status(f"{lanlan_name}正在前往另一个终端...")
    await websocket.close()
    break
```

**效果**: 同一角色只允许一个活跃 WebSocket 连接，后连接的会顶替先连接的。这是**有意的单连接设计**。

### 2. cleanup 竞态条件保护

**代码位置**: `main_logic/core.py:2334-2347`

```python
async def cleanup(self, expected_websocket=None):
    # 如果 websocket 已被新连接替换，跳过 cleanup
    if expected_websocket is not None and self.websocket is not None:
        if self.websocket != expected_websocket:
            logger.info("⏭️ cleanup 跳过：当前 websocket 已被新连接替换")
            return
    await self.end_session(by_server=True)  # 注意：by_server=True
```

**效果**: 旧连接断开时，如果 WebSocket 已被新连接替换，会跳过 cleanup，不会误清理新连接的资源。

### 3. cleanup 调用 end_session(by_server=True) 不发送"已离开"

**代码位置**: `main_logic/core.py:2329-2331`

```python
if not by_server:  # cleanup 传入 by_server=True，此条件为 False
    await self.send_status(f"{self.lanlan_name}已离开。")
```

**效果**: 通过 `cleanup()` 路径触发的 `end_session` **不会发送"已离开"消息**。"已离开"只在客户端主动发送 `{"action": "end_session"}` 时触发（`by_server=False`）。

### 4. initialize_character_data() 保留 WebSocket 引用

**代码位置**: `main_server.py:302-366`

```python
# 有活跃 session 时：只更新配置，不重建 session_manager
if has_active_session:
    old_mgr.lanlan_prompt = lanlan_prompt[k].replace(...)
    old_mgr.voice_id = get_reserved(...)
    # 不重建，保留所有连接

# 无活跃 session 时：重建 session_manager，但保留 WebSocket
else:
    old_websocket = session_manager[k].websocket if k in session_manager else None
    session_manager[k] = core.LLMSessionManager(...)
    if old_websocket:
        session_manager[k].websocket = old_websocket  # 恢复 WebSocket
```

**效果**: 角色切换调用 `initialize_character_data()` 时，**不会丢失现有的 WebSocket 连接**。

---

## 问题 1：准备切换角色时当前角色显示"已离开"

### 现象描述

在 Web 端点击"管理"准备切换角色时，手机端立即显示当前角色"已离开"。

### 根因分析

> **注意**: 由于已有保护机制的存在，文档之前描述的 `cleanup → end_session → 发送"已离开"` 路径**不成立**（`cleanup` 调用 `end_session(by_server=True)`，不会发送"已离开"）。需要从其他方向排查真正的触发路径。

#### 可能的触发路径 1：客户端主动 end_session

如果 Web 前端在切换/打开管理时发送了 `{"action": "end_session"}` 消息：

**代码位置**: `main_routers/websocket_router.py:112-114`

```python
elif action == "end_session":
    session_manager[lanlan_name].active_session_is_idle = False
    asyncio.create_task(session_manager[lanlan_name].end_session())
    # end_session() 默认 by_server=False → 发送"已离开"
```

**触发链**: Web 前端发送 end_session → `end_session(by_server=False)` → `send_status("已离开")` → 通过当前 WebSocket 发送

**关键问题**: 此时 `session_manager[lanlan_name].websocket` 指向谁？

- 如果 P2P（手机）连接**后于** Web 连接建立，`websocket` 指向 P2P 连接
- 那么"已离开"消息会**通过 P2P 连接发送到手机端**
- 而 Web 端（实际发起者）反而收不到

#### 可能的触发路径 2：session_id 互斥导致的连接中断

**代码位置**: `main_routers/websocket_router.py:81-84`

```python
if session_id[lanlan_name] != this_session_id:
    await session_manager[lanlan_name].send_status(f"{lanlan_name}正在前往另一个终端...")
    await websocket.close()
    break
```

**场景**: Web 前端关闭旧连接后重新建立新 WebSocket（如页面跳转）：
1. 新 Web 连接覆盖 `session_id` 和 `websocket`
2. P2P 连接的 `this_session_id` 与新 `session_id` 不匹配
3. P2P 连接在下次收到消息时被关闭，并收到"正在前往另一个终端..."

#### 可能的触发路径 3：WebSocket 引用覆盖后消息错投

**代码位置**: `main_routers/websocket_router.py:70`

```python
session_manager[lanlan_name].websocket = websocket
```

P2P 连接和本地连接使用**相同的角色名**，`session_manager` 只保存单个 WebSocket 引用。消息会发送到最后一个连接的客户端，导致另一端收不到或收到不该收到的消息。

### 排查建议

**由于当前无法确认确切的触发路径，建议通过日志排查：**

1. 在 `end_session` 入口打印调用栈和 `by_server` 参数值
2. 在 `send_status` 中打印消息内容和目标 WebSocket 客户端地址
3. 监控 P2P 连接和 Web 连接的 `session_id` 变化时序

```python
# main_logic/core.py end_session 入口
import traceback
logger.info(f"end_session called: by_server={by_server}, ws={self.websocket.client if self.websocket else None}")
logger.debug(f"end_session traceback: {''.join(traceback.format_stack()[-5:])}")
```

---

## 问题 2：切换后角色语音聊天几句后显示"已离开"

### 现象描述

成功切换到新角色后，语音聊天几句后手机端显示角色"已离开"。

### 根因分析

#### 2.1 角色名不匹配导致连接被关闭（确认存在）

**代码位置**: `main_routers/websocket_router.py:38-59`

```python
if lanlan_name not in session_manager:
    current_catgirl = next(iter(session_manager))
    if current_catgirl:
        message = {
            "type": "catgirl_switched",
            "new_catgirl": current_catgirl,
            "old_catgirl": lanlan_name
        }
        await websocket.send_text(json.dumps(message))
        await asyncio.sleep(0.5)
    await websocket.close()
    return
```

**触发场景**: 角色切换后，手机端 P2P 连接断开后尝试重连，仍使用旧角色名：
1. 手机端持有旧角色名（来源于 QR 码或上一次连接配置）
2. 重连 `/ws/旧角色名`
3. 后端发现旧角色名不在 `session_manager` 中
4. 发送 `catgirl_switched` 通知新角色名，然后关闭连接
5. 手机端收到通知后应更新角色名并重连，但这个过程可能引发短暂的"已离开"

#### 2.2 广播机制在角色切换场景下可能失效

**代码位置**: `main_routers/characters_router.py:970-974, 987-1001`

角色切换的执行顺序：

```python
# 1. 保存新角色配置
characters['当前猫娘'] = catgirl_name
_config_manager.save_characters(characters)

# 2. 重新加载角色数据（会清理旧角色、创建新角色的 session_manager）
await initialize_character_data()

# 3. 广播 catgirl_switched 消息
for lanlan_name, mgr in list(session_manager.items()):
    ws = mgr.websocket
    if ws:
        await ws.send_text(message)
```

**问题**: `initialize_character_data()` 执行后：
- 如果新角色名 ≠ 旧角色名：旧角色的 session_manager 被清理（`main_server.py:407`），新角色的 session_manager 刚创建，**没有 WebSocket 连接**
- 广播遍历的是新的 session_manager，新角色的 `mgr.websocket` 为 `None`
- **结果：广播消息可能发不出去**

不过 RN 端的角色切换主要通过 **HTTP 响应**驱动（`main.tsx:919` 调用 API 后根据 `res.success` 处理），不完全依赖 WebSocket 广播。Web 端的切换也是由前端主动发起。所以广播失效**不是"已离开"问题的直接原因**，但会影响被动端（未发起切换的那一端）的同步。

#### 2.3 LAN Proxy 角色名缓存（影响有限）

**代码位置**: `lan_proxy.py:80, 321`

```python
self.character: str = "test"  # 初始化默认值
# ...
self.character = await self._get_current_character()  # 启动时获取
```

**澄清**: `self.character` 仅用于 `get_connection_info()` 生成 QR 码数据，**不影响 WebSocket 转发**。WebSocket 转发直接使用 `request.path`（`lan_proxy.py:208`），不依赖缓存的角色名。

**实际影响**: 手机端扫码时获取的角色名是启动时的缓存值。如果之后角色被切换，手机端重新扫码连接仍会使用旧角色名。但在已建立连接的场景下，这不是问题。

#### 2.4 WebSocket 心跳与手机后台

**代码位置**: `lan_proxy.py:200-203, 218-221`

```python
ws_client = web.WebSocketResponse(
    heartbeat=30.0,
    autoping=True,
)
# ...
async with session.ws_connect(
    target_url,
    heartbeat=30.0,
    autoping=True,
) as ws_server:
```

LAN Proxy 两端都有 30 秒心跳。但手机端进入后台/锁屏时，React Native 的 WebSocket 可能无法正常响应心跳 Ping，导致 LAN Proxy 客户端侧超时断开，进而触发服务端侧连接关闭。

### 关键时序图

```
时间轴 ─────────────────────────────────────────────────────────►

Web 端              切换角色 (API 调用)
                       │
                       ▼
后端              characters_router.switch_character()
                       │
                       ├── 保存新角色配置
                       │
                       ├── initialize_character_data()
                       │       ├── 旧角色名 session: 被清理（若角色名变化）
                       │       └── 新角色名 session: 新建（无 WebSocket）
                       │
                       ├── 广播 catgirl_switched
                       │       └── 新 session 无 WebSocket → 广播失败
                       │
                       └── 返回 {"success": true}
                                │
              ┌─────────────────┤
              ▼                 ▼
Web 端:  收到 HTTP 成功响应    手机端(P2P): 未收到广播
         关闭旧 WS             连接仍指向旧角色名
         用新角色名重连             │
                                 ▼
                           （某时刻连接断开/重连）
                           用旧角色名连接 /ws/旧角色名
                                 │
                                 ▼
后端:                    角色名不在 session_manager
                                 │
                                 ▼
                         发送 catgirl_switched + 关闭连接
                                 │
                                 ▼
手机端:                   显示"已离开"或连接中断
```

---

## 问题总结

### 确认存在的问题

| 问题 | 严重程度 | 根因 |
|------|---------|------|
| WebSocket 单连接设计 | 🟡 中 | `session_manager` 只保存单个 WebSocket 引用，P2P 和本地连接互斥 |
| 角色名不匹配关闭连接 | 🔴 高 | 手机端重连时使用旧角色名，被后端拒绝 |
| 广播在角色名变化时失效 | 🟡 中 | 旧角色 session 被清理、新角色 session 无 WebSocket，广播发不出去 |
| 手机后台心跳中断 | 🟡 中 | 手机进入后台后无法响应 WebSocket 心跳 |

### 已有保护机制（无需修复）

| 机制 | 代码位置 | 效果 |
|------|---------|------|
| `cleanup(expected_websocket)` 竞态保护 | `core.py:2334-2347` | 防止旧连接误清理新连接资源 |
| `end_session(by_server=True)` 不发送"已离开" | `core.py:2329-2331` | cleanup 路径不触发"已离开"消息 |
| `initialize_character_data` 保留 WebSocket | `main_server.py:304-366` | 重建 session 时恢复 WebSocket 引用 |
| `websocket_lock` 锁保护 | `core.py:2352-2360` | 防止 cleanup 和 initialize 之间的竞态 |

### 需要进一步排查的问题

| 问题 | 说明 |
|------|------|
| "已离开"的确切触发路径 | 当前分析无法确定是 end_session、session_id 互斥还是其他路径触发。需要添加日志在真机环境复现 |

### 代码位置汇总

| 文件 | 行号 | 说明 |
|------|------|------|
| `main_routers/websocket_router.py` | 70 | WebSocket 引用赋值（单连接设计） |
| `main_routers/websocket_router.py` | 62-66, 81-84 | session_id 互斥机制 |
| `main_routers/websocket_router.py` | 38-59 | 角色名不匹配时关闭连接 |
| `main_routers/characters_router.py` | 970-974 | 角色切换：保存配置 + 重新初始化 |
| `main_routers/characters_router.py` | 987-1001 | 广播 catgirl_switched 消息 |
| `main_server.py` | 272-405 | `initialize_character_data()` 全流程 |
| `main_server.py` | 302-366 | session_manager 重建（保留 WebSocket） |
| `main_server.py` | 406-435 | 清理已删除角色的资源 |
| `lan_proxy.py` | 80, 321 | 角色名缓存（仅用于 QR 码） |
| `lan_proxy.py` | 198-254 | WebSocket 双向转发 |
| `main_logic/core.py` | 2329-2331 | "已离开"消息发送（仅 `by_server=False`） |
| `main_logic/core.py` | 2334-2361 | `cleanup()` 竞态保护 + WebSocket 清理 |

---

## 修复建议

### 短期修复：日志增强 + 精准定位

#### 方案 1：在关键路径添加日志追踪"已离开"来源

```python
# main_logic/core.py end_session 入口
import traceback
async def end_session(self, by_server=False):
    caller_info = ''.join(traceback.format_stack()[-4:-1])
    logger.info(f"end_session: by_server={by_server}, "
                f"ws_client={self.websocket.client if self.websocket else None}\n"
                f"Called from:\n{caller_info}")
    if not by_server:
        logger.warning(f"⚠️ 即将发送'已离开'消息到: {self.websocket.client if self.websocket else 'None'}")
    # ... 原有逻辑
```

#### 方案 2：手机端增强重连逻辑

在 `N.E.K.O.-RN` 重连时，先通过 HTTP API 获取当前角色名：

```typescript
// services/wsService.ts
public async reconnect(): Promise<void> {
    // 重连前通过 HTTP 获取当前角色名
    try {
        const currentCharacter = await this.fetchCurrentCharacter();
        if (currentCharacter && currentCharacter !== this.config.characterName) {
            this.config.characterName = currentCharacter;
        }
    } catch (e) {
        console.warn('获取当前角色名失败，使用缓存值:', e);
    }
    this.init();
}
```

### 中期修复：解决广播失效问题

#### 方案 1：广播前保留旧角色的 WebSocket 引用

```python
# main_routers/characters_router.py
# 在 initialize_character_data() 之前，收集所有活跃的 WebSocket
active_websockets = []
for lanlan_name, mgr in list(session_manager.items()):
    if mgr.websocket:
        active_websockets.append(mgr.websocket)

await initialize_character_data()

# 用保存的 WebSocket 列表广播
message = json.dumps({...})
for ws in active_websockets:
    try:
        await ws.send_text(message)
    except Exception:
        pass
```

#### 方案 2：LAN Proxy 动态更新角色名

添加通知接口，供后端在角色切换时更新 LAN Proxy 缓存：

```python
# lan_proxy.py
async def handle_character_change(self, request: web.Request):
    """接收来自主服务的角色切换通知"""
    data = await request.json()
    new_character = data.get('character')
    if new_character:
        self.character = new_character
        return web.json_response({"status": "ok"})
    return web.json_response({"status": "error"}, status=400)
```

### 长期修复：支持多客户端连接

#### 方案：区分连接类型，支持多 WebSocket

修改 Session Manager 支持多个 WebSocket 连接：

```python
# main_logic/core.py
class LLMSessionManager:
    def __init__(self):
        self.websocket = None          # 主 WebSocket（用于会话交互）
        self.observer_websockets: set = set()  # 观察者连接（接收状态广播）

    async def broadcast_status(self, message: str):
        """向所有连接广播状态消息"""
        targets = list(self.observer_websockets)
        if self.websocket:
            targets.append(self.websocket)
        for ws in targets:
            try:
                await ws.send_text(json.dumps({"type": "status", "message": message}))
            except Exception:
                self.observer_websockets.discard(ws)
```

在 LAN Proxy 转发时标识连接类型：

```python
# lan_proxy.py handle_websocket
target_url = f"{TARGET_WS_BASE}{request.path}?source=p2p"
```

后端根据来源区分处理：

```python
# websocket_router.py
source = websocket.query_params.get('source', 'direct')
if source == 'p2p':
    session_manager[lanlan_name].observer_websockets.add(websocket)
else:
    session_manager[lanlan_name].websocket = websocket
```

---

## 推荐的修复优先级

### P0（紧急）

1. **添加日志追踪"已离开"的真实触发路径**
   - 影响：确认根因，指导后续修复
   - 方案：在 `end_session`、`send_status` 添加调用栈日志

2. **修复手机端重连使用旧角色名**
   - 影响：角色切换后 P2P 重连失败
   - 方案：重连前通过 HTTP API 获取当前角色名

### P1（重要）

3. **修复广播在角色名变化时失效**
   - 影响：被动端无法收到角色切换通知
   - 方案：广播前保存 WebSocket 引用列表

4. **LAN Proxy 角色名动态更新**
   - 影响：QR 码中的角色名过时
   - 方案：添加通知 API

### P2（优化）

5. **支持多客户端连接架构**
   - 影响：根本解决 P2P 与本地连接互斥的问题
   - 方案：区分主连接与观察者连接

6. **增强手机后台心跳保活**
   - 影响：手机锁屏/后台时连接稳定性
   - 方案：React Native 侧使用后台任务维持心跳

---

## 附录：调试建议

### 关键日志输出

```python
# websocket_router.py - 连接建立
logger.info(f"WebSocket 连接: {lanlan_name}, "
            f"client={websocket.client}, "
            f"session_id={this_session_id}")

# websocket_router.py - session_id 冲突
logger.warning(f"session_id 冲突: {lanlan_name}, "
               f"current={session_id[lanlan_name]}, "
               f"this={this_session_id}, "
               f"client={websocket.client}")

# core.py - end_session
logger.info(f"end_session: by_server={by_server}, "
            f"ws_client={self.websocket.client if self.websocket else None}")

# characters_router.py - 广播结果
logger.info(f"广播切换消息: {old_catgirl} → {catgirl_name}, "
            f"成功={notification_count}, "
            f"总session数={len(session_manager)}")
```

### 复现步骤

1. 启动主服务 + LAN Proxy
2. Web 端连接并建立 WebSocket
3. 手机端扫码通过 P2P 连接
4. 在 Web 端打开角色管理页面 → 观察手机端是否显示"已离开"
5. 在 Web 端切换角色 → 观察手机端是否收到切换通知
6. 切换后在手机端进行几轮对话 → 观察是否出现"已离开"

每步都检查后端日志中 `end_session` 的调用记录和 `by_server` 参数值。

---

*文档版本: 2.0*
*更新日期: 2026-03-04*
*更新说明: 根据实际代码审查修正分析，标注已有保护机制，区分已确认问题与待排查问题*
*相关 Issue: P2P 角色切换"已离开"问题*
