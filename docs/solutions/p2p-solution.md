# P2P 网络方案（修订版）

**核心目标**：同WiFi直连，跨网先尝试UPnP打洞，失败就走FRP中继。

---

## 方案概述

主服务绑定 `localhost:48911` 无法直接对外。启动一个轻量代理，绑定当前 WiFi 的局域网 IP（如 `192.168.1.10:48920`），通过 Token 鉴权保证安全。

```
手机连接策略（三层降级）：

同WiFi？ ──► 是 ──► 直连局域网IP（10ms，免费）
              │
              └──► 否 ──► UPnP打洞成功？ ──► 是 ──► P2P直连（30-80ms，免费）
                                    │
                                    └──► 否 ──► FRP中继（100-300ms，付费）
```

| 场景 | 连接方式 | 延迟 | 成本 |
|------|---------|------|------|
| 同WiFi | 局域网直连 | <10ms | 免费 |
| 跨网+UPnP成功 | P2P直连 | 30-80ms | 免费 |
| 跨网+UPnP失败 | FRP中继 | 100-300ms | 按需付费 |

---

## 推荐架构：HTTP/WebSocket 反向代理

### 核心思路

> 代理层说 HTTP/WebSocket 协议（不是 raw TCP），移动端直接用标准 WebSocket，零额外代码。

```
手机                          桌面端
┌──────────────────┐         ┌────────────────────────────┐
│ createNativeReal- │         │    lan_proxy.py             │
│ timeClient        │  WS    │  (HTTP/WS 反向代理)         │
│ (项目已有！)       │────────►│  ① 验证 URL 中的 token      │
│                   │         │  ② WS 升级 → localhost:48911│
│ 标准 WebSocket    │  HTTP   │  ③ HTTP 请求 → localhost:48911│
│ 无需任何修改      │────────►│                              │
└──────────────────┘         └────────────────────────────┘
         ↑ 与普通连接走完全相同的代码路径
```

---

## 同WiFi直连（Layer 1）

```
手机(同一WiFi)           电脑
    │                     │
    │ ① 扫码二维码         │
    │   {ip, port,        │
    │    token, character} │
    │◄────────────────────┤
    │                     │
    │ ② 标准 WebSocket     │
    │   ws://192.168.1.10:48920/ws/test?token=xxx
    │────────────────────►│
    │                     │  HTTP/WS 反向代理
    │ ③ 双向通信           │  → localhost:48911
    │◄───────────────────►│
    │                     │
    │ ④ HTTP API          │
    │   http://192.168.1.10:48920/api/...?token=xxx
    │────────────────────►│
```

**流程**：
1. 桌面端获取本机局域网 IP，启动 HTTP/WS 反向代理绑定 `LAN_IP:48920`，生成随机 Token
2. 二维码包含 `{lan_ip, port, token, character}`（角色名从主服务获取）
3. 手机扫码后用标准 WebSocket 连接 `ws://lan_ip:48920/ws/{character}?token=xxx`
4. 代理验证 token → 剥离 token 参数 → 透明转发到 `ws://localhost:48911/ws/{character}`
5. HTTP API 请求同样通过代理到达主服务

---

## 桌面端代理实现

### 方案选择：aiohttp

项目已使用 asyncio，aiohttp 是最自然的选择，原生支持 WebSocket 反向代理。

```python
# lan_proxy.py - HTTP/WS 反向代理，核心约 120 行

import secrets
import asyncio
from aiohttp import web, ClientSession, WSMsgType

TARGET_HOST = "127.0.0.1"
TARGET_PORT = 48911
TARGET_BASE = f"http://{TARGET_HOST}:{TARGET_PORT}"

class LanProxy:
    def __init__(self):
        self.token = secrets.token_urlsafe(32)
        self.lan_ip = self._get_lan_ip()
        self.character = None  # 从主服务获取

    # ── Token 鉴权中间件 ──
    @web.middleware
    async def token_middleware(self, request, handler):
        token = request.query.get('token') or request.headers.get('X-Proxy-Token')
        if token != self.token:
            raise web.HTTPForbidden(text='Invalid token')
        return await handler(request)

    # ── WebSocket 反向代理 ──
    async def handle_websocket(self, request):
        ws_client = web.WebSocketResponse()
        await ws_client.prepare(request)

        # 构建目标 URL（移除 token 参数）
        params = {k: v for k, v in request.query.items() if k != 'token'}
        target_url = f"ws://{TARGET_HOST}:{TARGET_PORT}{request.path}"
        if params:
            target_url += '?' + '&'.join(f'{k}={v}' for k, v in params.items())

        async with ClientSession() as session:
            async with session.ws_connect(target_url) as ws_server:
                async def forward(src, dst, is_text_fn, send_text, send_bytes):
                    async for msg in src:
                        if msg.type == WSMsgType.TEXT:
                            await send_text(msg.data)
                        elif msg.type == WSMsgType.BINARY:
                            await send_bytes(msg.data)
                        elif msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
                            break

                await asyncio.gather(
                    forward(ws_client, ws_server, None, ws_server.send_str, ws_server.send_bytes),
                    forward(ws_server, ws_client, None, ws_client.send_str, ws_client.send_bytes),
                )
        return ws_client

    # ── HTTP 反向代理 ──
    async def handle_http(self, request):
        params = {k: v for k, v in request.query.items() if k != 'token'}
        target_url = f"{TARGET_BASE}{request.path}"

        async with ClientSession() as session:
            async with session.request(
                request.method, target_url,
                headers={k: v for k, v in request.headers.items()
                         if k.lower() not in ('host', 'x-proxy-token')},
                params=params,
                data=await request.read(),
            ) as resp:
                # 透传响应头（过滤 hop-by-hop）
                headers = {k: v for k, v in resp.headers.items()
                           if k.lower() not in ('transfer-encoding', 'content-encoding')}
                return web.Response(
                    body=await resp.read(),
                    status=resp.status,
                    headers=headers,
                )

    # ── 启动 ──
    async def start(self):
        app = web.Application(middlewares=[self.token_middleware])
        # WebSocket 路由（必须在通配路由之前）
        app.router.add_route('GET', '/ws/{name}', self.handle_websocket)
        # 所有其他请求 → HTTP 反向代理
        app.router.add_route('*', '/{path:.*}', self.handle_http)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.lan_ip, 48920)
        await site.start()

    def get_connection_info(self) -> dict:
        return {
            "lan_ip": self.lan_ip,
            "port": 48920,
            "token": self.token,
            "character": self.character,  # 当前角色名
        }
```

### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Token 传递方式 | URL query `?token=xxx` | WebSocket 不支持自定义 header，query 最通用 |
| Token 生命周期 | proxy 实例生命周期内持续有效 | 支持断线重连；token 本身 256-bit 随机 + 仅局域网内 |
| Token 转发 | 代理层剥离，不转发给主服务 | 主服务无需感知代理层 |
| 响应式路由 | `/ws/*` → WS 代理，其他 → HTTP 代理 | 统一入口，移动端不需要区分端口 |

---

## 移动端改动（极简）

### 核心改动：改 URL，不改代码路径

```typescript
// wsService.ts - P2P 模式仅改变 URL 构造方式

public init(): void {
    this.close();

    // P2P 和标准模式用完全相同的 client
    let wsUrl: string;
    if (this.config.p2p?.token) {
        // P2P: 通过代理连接，token 放 query
        wsUrl = `ws://${this.config.host}:${this.config.port}`
              + `/ws/${this.config.characterName}`
              + `?token=${this.config.p2p.token}`;
    } else {
        wsUrl = `${this.config.protocol}://${this.config.host}:${this.config.port}`
              + `/ws/${this.config.characterName}`;
    }

    // 统一使用标准 WebSocket client
    this.client = createNativeRealtimeClient({
        url: wsUrl,
        heartbeat: { intervalMs: 30_000, payload: { action: 'ping' } },
        reconnect: { enabled: true, maxAttempts: this.maxReconnectAttempts },
        parseJson: true,
    });

    this.setupEventListeners();
    this.client.connect();
}
```

```typescript
// devConnectionConfig.ts - P2P 解析
if (typeof obj.lan_ip === 'string' && typeof obj.token === 'string') {
    out.host = obj.lan_ip.trim();
    out.port = typeof obj.port === 'number' ? obj.port : 48920;
    out.characterName = obj.character || 'test';  // 从二维码获取真实角色名
    out.p2p = { token: obj.token };               // 只需要 token
    return out;
}
```

```typescript
// HTTP API 也直接走代理，无需特殊处理
const apiBase = config.p2p?.token
    ? `http://${config.host}:${config.port}`  // 已指向代理端口
    : `http://${config.host}:${config.port}`;
// 请求时附带 token：fetch(`${apiBase}/api/xxx?token=${config.p2p.token}`)
```

### 可删除的代码

实施后以下文件可完全移除：

```
删除: services/P2PRealtimeClient.ts        (425 行，手写 WebSocket 协议)
删除: mobile/src/p2p/LanConnection.ts      (raw TCP 连接)
删除: mobile/src/p2p/useLanConnection.ts   (连接 hook)
简化: wsService.ts 中的 P2P 分支           (~30 行 → 5 行 URL 构造)
简化: devConnectionConfig.ts P2P 解析      (~15 行 → 5 行)
移除依赖: react-native-tcp-socket          (减少 native 构建复杂度)
可选删除: app/p2p-connect.tsx              (TCP 测试页面)
```

**净减少约 600+ 行代码，同时修复全部已知 Bug。**

---

## 跨网UPnP直连（Layer 2）

当手机用 4G/5G，电脑在家时：

```
手机(4G/5G)          云服务器          家用路由器          电脑
    │                  │                  │               │
    │ ① 查询公网地址    │                  │               │
    │─────────────────►│                  │               │
    │◄─────────────────│                  │               │
    │   {ip, port,     │                  │ ② UPnP打洞    │
    │    token}        │                  │◄──────────────┤
    │                  │                  │ 映射端口48920 │
    │ ③ 直连公网IP      │                  │               │
    │────────────────────────────────────►┤──────────────►│
    │◄────────────────────────────────────┤◄──────────────┤
```

**流程**：
1. 电脑尝试 UPnP 映射，将内网 `48920` 映射到路由器公网端口
2. 映射成功则上报公网地址+Token到云端
3. 手机查询云端获取地址，直接连接验证 Token

**UPnP 成功率**：约 60%（受CGNAT、路由器不支持等影响）

> 注意：由于代理是标准 HTTP/WS 协议，UPnP 映射后手机仍然用标准 WebSocket 连接，代码路径不变。

---

## FRP中继兜底（Layer 3）

UPnP 失败时（CGNAT、路由器不支持等）：

```
手机(4G/5G) ──► 云服务器(FRP) ──► 电脑
                 转发流量
```

### FRP 架构

后端主服务以 `127.0.0.1:48911` 启动，外部不可直接访问。FRP 对外暴露 `0.0.0.0:48920`，手机通过此端口连接。

```
手机 App ──HTTP/WS──▶ 0.0.0.0:48920 (frps 代理端口)
                           │
                      frps (bindPort=7000, 仅本机)
                           │
                      frpc ──▶ 127.0.0.1:48911 (后端 Main Server)
```

### 配置项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `NEKO_FRP_BIND_PORT` | 7000 | frps 内部通信端口 |
| `NEKO_FRP_PROXY_PORT` | 48920 | 对外代理端口（手机连这个） |
| `NEKO_FRP_TOKEN` | neko-frp-default | FRP 认证 token |

所有端口支持自动冲突检测和 fallback。

### 使用方式

**后端启动**：
```bash
# 直接启动，首次运行会自动下载当前平台的 FRP 二进制
python launcher.py
```

启动成功后会看到：
```
  🎉 所有服务器已启动完成！

  现在你可以：
  1. 启动 lanlan_frd.exe 使用系统
  2. 在浏览器访问 http://localhost:48911
  3. 手机端连接 <电脑IP>:48920
```

**RN App 端**：
在设置页面中，将连接地址设为 `<电脑局域网IP>:48920`。

**收费策略**：
- 免费用户：每月 3 小时额度
- 付费用户：不限时

---

## 移动端连接管理（三层降级）

```typescript
// 三层降级状态机（简化伪代码）
async function connect(config: ConnectionConfig) {
    // 1. 同WiFi → 直连代理
    if (config.p2p?.token) {
        const wsUrl = `ws://${config.host}:${config.port}/ws/${config.character}?token=${config.p2p.token}`;
        return createNativeRealtimeClient({ url: wsUrl, reconnect: { enabled: true } });
    }

    // 2. 从云端获取地址
    const info = await fetchRelayInfo(config.deviceId);

    // 3. 尝试 UPnP 直连
    if (info.upnp_ip) {
        try {
            const wsUrl = `ws://${info.upnp_ip}:${info.upnp_port}/ws/${info.character}?token=${info.token}`;
            return createNativeRealtimeClient({ url: wsUrl, reconnect: { enabled: true } });
        } catch { /* 降级到 FRP */ }
    }

    // 4. FRP 兜底
    return connectViaFRP(config.deviceId);
}
```

> 注意三层都用 `createNativeRealtimeClient`，同一套代码路径，只是 URL 不同。

---

## 云端地址交换（极简版）

```python
# FastAPI + Redis，60秒TTL

@app.post("/register")
def register(device_id: str, lan_ip: str, upnp_ip: Optional[str], token: str):
    """桌面端上报地址"""
    redis.setex(f"device:{device_id}", 60, {
        "lan_ip": lan_ip,
        "upnp_ip": upnp_ip,
        "token": token
    })

@app.get("/lookup")
def lookup(device_id: str):
    """手机查询地址（阅后即焚）"""
    data = redis.get(f"device:{device_id}")
    if data:
        redis.delete(f"device:{device_id}")
    return data
```

---

## 安全设计

| 措施 | 说明 |
|------|------|
| **Token鉴权** | 32位随机 Token，每个请求通过 URL query 或 header 验证 |
| **Token不转发** | 代理层剥离 token，主服务不感知 |
| **绑定LAN IP** | 代理只绑定WiFi网卡IP，不监听0.0.0.0 |
| **云端阅后即焚** | 地址查询后立即删除，60秒TTL兜底 |
| **Token可重用** | 允许断线重连（安全性由 256-bit 随机值 + 局域网限制保证） |

**Token验证流程**：
```
手机 ──► ws://ip:48920/ws/test?token=xxx ──► 代理
                                              │
                                              ▼
                                        token 匹配？
                                       /          \
                                     是            否
                                    /               \
                                剥离 token         HTTP 403
                                转发到主服务
```

---

## 连接生命周期

### 断线重连

由 `createNativeRealtimeClient` 内置的重连逻辑自动处理：
- 指数退避（3s → 30s）
- 可配置最大重连次数
- Token 持续有效，重连无障碍

### 网络切换（WiFi↔4G）

```
1. 连接断开检测（WebSocket onclose）
2. 自动重连（realtime 库内置）
3. 若 WiFi → 4G：重连到代理失败 → 查云端 → UPnP/FRP
4. 若 4G → WiFi：重连到代理成功 → 直连恢复
```

### 心跳保活

由 `createNativeRealtimeClient` 自动发送 `{ action: "ping" }` 心跳（30s 间隔），无需额外实现。

---

## 代码量估算

| 模块 | 行数 | 说明 |
|------|------|------|
| HTTP/WS 反向代理 | ~120行 | aiohttp 实现，含 token 中间件 |
| UPnP映射+续期 | ~200行 | 端口映射、心跳 |
| 云端API | ~100行 | FastAPI+Redis |
| 移动端改动 | ~20行 | URL 构造 + config 解析 |
| **合计** | **~440行** | 不含FRP集成 |

---

## 实施路径

### Phase 1：同WiFi直连（MVP）

重写 `lan_proxy.py` 为 HTTP/WS 反向代理：

| 步骤 | 任务 | 改动文件 |
|------|------|----------|
| 1 | 重写 lan_proxy.py 为 aiohttp 反向代理 | `lan_proxy.py` |
| 2 | 二维码数据加入 character 字段 | `lan_proxy.py`, `pages_router.py` |
| 3 | 移动端 devConnectionConfig 解析修正 | `devConnectionConfig.ts` |
| 4 | wsService 统一用标准 WebSocket | `wsService.ts` |
| 5 | 删除 P2PRealtimeClient 及相关代码 | 多文件删除 |
| 6 | 联调测试 | - |

**验收标准**：
- [ ] 同WiFi环境下，扫码后 3 秒内建立 WebSocket 连接
- [ ] 音频双向传输正常
- [ ] HTTP API（获取角色、模型信息等）通过代理可达
- [ ] 断线自动重连成功
- [ ] Token 错误时返回 403

### Phase 2：UPnP+云端
- UPnP映射实现
- 云端地址交换
- 移动端降级连接（URL 不同，client 相同）

### Phase 3：FRP兜底
- FRP集成
- 付费套餐

---

## 与原版对比

| | 原版四层 | 当前三层方案 |
|--|---------|-------------|
| 代理协议 | - | HTTP/WebSocket |
| 移动端额外代码 | - | ~20行 |
| 额外 native 依赖 | - | 无 |
| HTTP API 可达 | - | 可达 |
| WebSocket 协议实现 | - | RN 内置 |
| 重连支持 | - | 完整（realtime 库） |
