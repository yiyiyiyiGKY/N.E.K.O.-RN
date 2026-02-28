# FRP 反向代理集成

## 背景

后端原先以 `0.0.0.0:48911` 启动，局域网任意设备可直接访问，存在安全隐患。现改为 `127.0.0.1` 监听，通过内置 FRP 反向代理对外暴露服务。用户启动 N.E.K.O. 后手机即可连接，无需额外安装任何工具。

## 架构

```
手机 App ──HTTP/WS──▶ 0.0.0.0:48920 (frps 代理端口)
                           │
                      frps (bindPort=7000, 仅本机)
                           │
                      frpc ──▶ 127.0.0.1:48911 (后端 Main Server)
```

- 后端 Main Server 监听 `127.0.0.1:48911`，外部不可直接访问
- FRP 对外暴露 `0.0.0.0:48920`，手机通过此端口连接
- Memory Server / Agent Server 为内部服务，不对外暴露

## 配置项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `NEKO_FRP_BIND_PORT` | 7000 | frps 内部通信端口 |
| `NEKO_FRP_PROXY_PORT` | 48920 | 对外代理端口（手机连这个） |
| `NEKO_FRP_TOKEN` | neko-frp-default | FRP 认证 token |

所有端口支持自动冲突检测和 fallback。

## 使用方式

### 后端（N.E.K.O.TONG）

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

### RN App 端

在设置页面中，将连接地址设为 `<电脑局域网IP>:48920`。

RN 端代码无需任何改动，`devConnectionConfig.ts` 中的 host/port 解析逻辑已支持自定义端口。

### PyInstaller 打包

FRP 二进制会自动打包进发布包（`specs/launcher.spec` 已配置），用户无需手动操作。

## 后端改动文件

| 文件 | 变更 |
|---|---|
| `frp_manager.py` | 新建 — FRP 生命周期管理（自动下载/启动/停止/健康检查） |
| `config/__init__.py` | 新增 FRP_BIND_PORT、FRP_PROXY_PORT、FRP_TOKEN |
| `launcher.py` | Main Server 改为 127.0.0.1；集成 FRP 启动/清理/监控 |
| `specs/launcher.spec` | 打包时包含 FRP 二进制 + frp_manager hidden import |
| `.gitignore` | 排除 vendor/frp/ |

## 注意事项

- FRP 启动失败不会阻塞后端，仅打印警告。本机浏览器访问不受影响，只是手机无法连接。
- Docker 部署不受影响，Docker 环境使用 Nginx 反向代理，FRP 仅用于本地部署场景。
- 首次启动时自动从 GitHub 下载 FRP 二进制到 `vendor/frp/`，后续启动直接复用。
- `vendor/frp/` 已加入 .gitignore，二进制不入库。
