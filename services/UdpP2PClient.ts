/**
 * UDP P2P 客户端 - v3 三层连接回退
 *
 * 工作流程：
 * 1. UDP 探测（NAT 穿透）- 三层回退
 * 2. 获取 TCP endpoint（HTTP 代理地址）
 * 3. 切换到 TCP 连接（标准 HTTP API）
 */

import { EventEmitter } from 'events';
import { Alert } from 'react-native';

// @ts-ignore - react-native-udp 没有类型定义
import dgram from 'react-native-udp';

export type P2PConfig = {
  token: string;
  deviceId?: string;
  lanIp?: string;
  lanPort?: number;
  stunIp?: string;
  stunPort?: number;
  frpIp?: string;
  frpPort?: number;
  cloudRegistryUrl?: string;  // 云注册中心地址，用于双向打洞协调
};

export type TcpEndpoint = {
  ip: string;
  port: number;
};

export class UdpP2PClient extends EventEmitter {
  private config: P2PConfig;
  private socket: any = null;
  private connected = false;
  private tcpEndpoint: TcpEndpoint | null = null;

  constructor(config: P2PConfig) {
    super();
    this.config = config;
  }

  /**
   * 尝试建立 P2P 连接（三层回退）
   * @returns TCP endpoint（用于后续 HTTP 连接）或 null
   */
  async connect(): Promise<TcpEndpoint | null> {
    this.emit('log', '开始三层连接尝试');

    // 第1层：LAN 直连（由 hook 层处理，这里跳过）

    // 第2层：STUN 双向打洞
    if (this.config.stunIp && this.config.stunPort) {
      this.emit('log', `第2层：STUN 打洞 ${this.config.stunIp}:${this.config.stunPort}`);
      const endpoint = await this._tryConnectWithPunch(
        this.config.stunIp,
        this.config.stunPort,
        10000,
        2,
        'STUN'
      );
      if (endpoint) {
        this.tcpEndpoint = endpoint;
        this.connected = true;
        return endpoint;
      }
      this.emit('log', '⏱️ 第2层超时，尝试 FRP...');
    }

    // 第3层：FRP 中转
    if (this.config.frpIp && this.config.frpPort) {
      this.emit('log', `第3层：FRP 中转 ${this.config.frpIp}:${this.config.frpPort}`);
      const endpoint = await this._tryConnect(
        this.config.frpIp,
        this.config.frpPort,
        10000,
        3,
        'FRP'
      );
      if (endpoint) {
        this.tcpEndpoint = endpoint;
        this.connected = true;
        return endpoint;
      }
      this.emit('log', '⏱️ 第3层超时');
    }

    this.emit('log', '❌ 所有连接方式失败');
    this.emit('failed');
    return null;
  }

  /**
   * 尝试连接到指定端点
   */
  private async _tryConnect(
    ip: string,
    port: number,
    timeout: number,
    layer: number,
    method: string
  ): Promise<TcpEndpoint | null> {
    return new Promise((resolve) => {
      try {
        // 创建 UDP socket
        // @ts-ignore - react-native-udp 类型定义不完整
        this.socket = dgram.createSocket('udp4');

        const timer = setTimeout(() => {
          console.log(`[UDP P2P] 第${layer}层超时 (${timeout}ms)`);
          this._closeSocket();
          resolve(null);
        }, timeout);

        // 监听消息
        this.socket.on('message', (data: Buffer) => {
          console.log(`[UDP P2P] 收到响应，长度: ${data.length} 字节`);
          clearTimeout(timer);
          try {
            const msgText = data.toString();
            console.log(`[UDP P2P] 响应内容: ${msgText}`);
            const msg = JSON.parse(msgText);

            // 检查 ACK 响应
            if (msg.type === 'ACK' && msg.tcp_endpoint) {
              console.log(`[UDP P2P] 收到 ACK，TCP endpoint: ${msg.tcp_endpoint.ip}:${msg.tcp_endpoint.port}`);

              const endpoint: TcpEndpoint = {
                ip: msg.tcp_endpoint.ip,
                port: msg.tcp_endpoint.port,
              };

              this._closeSocket();

              // 触发事件
              this.emit('connected', { layer, method, endpoint });

              resolve(endpoint);
            } else {
              console.warn(`[UDP P2P] 响应格式不正确: type=${msg.type}, has_endpoint=${!!msg.tcp_endpoint}`);
              clearTimeout(timer);
              this._closeSocket();
              resolve(null);
            }
          } catch (e) {
            console.error('[UDP P2P] 解析响应失败:', e);
            clearTimeout(timer);
            this._closeSocket();
            resolve(null);
          }
        });

        // 监听错误
        this.socket.on('error', (err: Error) => {
          console.error('[UDP P2P] Socket 错误:', err);
          clearTimeout(timer);
          this._closeSocket();
          resolve(null);
        });

        // 监听 socket 就绪
        this.socket.on('listening', () => {
          console.log(`[UDP P2P] Socket 已就绪，准备发送到 ${ip}:${port}`);

          // 发送 HELLO 消息
          const hello = JSON.stringify({
            type: 'HELLO',
            token: this.config.token,
            timestamp: Date.now(),
          });

          this.socket.send(hello, 0, hello.length, port, ip, (err: Error | null) => {
            if (err) {
              console.error('[UDP P2P] 发送失败:', err);
              clearTimeout(timer);
              this._closeSocket();
              resolve(null);
            } else {
              console.log(`[UDP P2P] HELLO 已发送到 ${ip}:${port}`);
            }
          });
        });

        // 绑定本地端口（让系统自动分配）
        this.socket.bind(0, () => {
          console.log('[UDP P2P] Socket 绑定成功');
        });

      } catch (e) {
        console.error('[UDP P2P] 连接失败:', e);
        resolve(null);
      }
    });
  }

  /**
   * 双向打洞版连接：用同一 socket 先查公网地址并上报云端，再发 HELLO
   */
  private async _tryConnectWithPunch(
    ip: string,
    port: number,
    timeout: number,
    layer: number,
    method: string
  ): Promise<TcpEndpoint | null> {
    return new Promise((resolve) => {
      try {
        // @ts-ignore
        this.socket = dgram.createSocket('udp4');

        const timer = setTimeout(() => {
          this.emit('log', `第${layer}层超时 (${timeout}ms)`);
          this._closeSocket();
          resolve(null);
        }, timeout);

        let stunDone = false;

        this.socket.on('message', (data: Buffer) => {
          try {
            const msgText = data.toString();
            const msg = JSON.parse(msgText);

            if (msg.type === 'PUNCH') {
              this.emit('log', '收到后端 PUNCH 包，洞已打通');
              return;
            }

            if (msg.type === 'ACK' && msg.tcp_endpoint) {
              clearTimeout(timer);
              const endpoint: TcpEndpoint = {
                ip: msg.tcp_endpoint.ip,
                port: msg.tcp_endpoint.port,
              };
              this._closeSocket();
              this.emit('connected', { layer, method, endpoint });
              resolve(endpoint);
            }
          } catch {
            // 非 JSON 包忽略
          }
        });

        this.socket.on('error', (err: Error) => {
          this.emit('log', `Socket 错误: ${err.message}`);
          clearTimeout(timer);
          this._closeSocket();
          resolve(null);
        });

        this.socket.on('listening', async () => {
          this.emit('log', 'Socket 就绪，查询公网地址...');

          // 复用 FRP UDP 端口查询公网地址，避免依赖 coturn 3478（可能被 WiFi 封锁）
          const stunServer = this.config.frpIp || ip;
          const stunQueryPort = this.config.frpPort || 48920;
          const myPublicAddr = await this._queryStunAddress(stunServer, stunQueryPort);

          if (myPublicAddr && this.config.deviceId && this.config.cloudRegistryUrl) {
            this.emit('log', `我的公网地址: ${myPublicAddr.ip}:${myPublicAddr.port}`);
            try {
              await fetch(`${this.config.cloudRegistryUrl}/api/punch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  device_id: this.config.deviceId,
                  token: this.config.token,
                  client_ip: myPublicAddr.ip,
                  client_port: myPublicAddr.port,
                }),
              });
              this.emit('log', '公网地址已上报云端，等待后端 PUNCH...');
            } catch (e) {
              this.emit('log', `上报云端失败: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else if (!myPublicAddr) {
            this.emit('log', 'STUN 查询公网地址失败，直接发 HELLO');
          }

          // Step 3: 发 HELLO（无论上报是否成功）
          const hello = JSON.stringify({
            type: 'HELLO',
            token: this.config.token,
            timestamp: Date.now(),
          });
          this.socket.send(hello, 0, hello.length, port, ip, (err: Error | null) => {
            if (err) {
              this.emit('log', `发送 HELLO 失败: ${err.message}`);
              clearTimeout(timer);
              this._closeSocket();
              resolve(null);
            } else {
              this.emit('log', `HELLO 已发送到 ${ip}:${port}，等待 ACK...`);
            }
          });
        });

        this.socket.bind(0);
      } catch (e) {
        this.emit('log', `连接异常: ${e instanceof Error ? e.message : String(e)}`);
        resolve(null);
      }
    });
  }

  /**
   * 用当前 socket 向 STUN 服务器查询自己的公网地址
   * 注意：必须用同一个 socket，否则 NAT 会分配不同端口
   */
  private _queryStunAddress(stunHost: string, stunPort: number): Promise<{ ip: string; port: number } | null> {
    return new Promise((resolve) => {
      try {
        // 构建 STUN Binding Request
        const transactionId = new Uint8Array(12);
        crypto.getRandomValues(transactionId);
        const request = new Uint8Array(20);
        // Message Type: Binding Request (0x0001)
        request[0] = 0x00; request[1] = 0x01;
        // Message Length: 0
        request[2] = 0x00; request[3] = 0x00;
        // Magic Cookie: 0x2112A442
        request[4] = 0x21; request[5] = 0x12; request[6] = 0xA4; request[7] = 0x42;
        request.set(transactionId, 8);

        const stunTimer = setTimeout(() => resolve(null), 3000);

        // 临时监听 STUN 响应（原始 Buffer）
        const onStunMessage = (data: Buffer) => {
          this.emit('log', `STUN收到包: len=${data.length} type=${typeof data} first=${data[0]},${data[1]}`);
          if (data.length < 20) return;
          // 检查是否是 STUN Binding Response (0x0101)
          if (data[0] !== 0x01 || data[1] !== 0x01) return;
          // 检查 Magic Cookie
          if (data[4] !== 0x21 || data[5] !== 0x12 || data[6] !== 0xA4 || data[7] !== 0x42) return;

          clearTimeout(stunTimer);
          this.socket.removeListener('message', onStunMessage);

          // 解析 XOR-MAPPED-ADDRESS (0x0020)
          let offset = 20;
          while (offset + 4 <= data.length) {
            const attrType = (data[offset] << 8) | data[offset + 1];
            const attrLen = (data[offset + 2] << 8) | data[offset + 3];
            if (attrType === 0x0020 && attrLen >= 8) {
              // XOR-MAPPED-ADDRESS IPv4
              const xorPort = ((data[offset + 6] << 8) | data[offset + 7]) ^ 0x2112;
              const xorIp = [
                data[offset + 8] ^ 0x21,
                data[offset + 9] ^ 0x12,
                data[offset + 10] ^ 0xA4,
                data[offset + 11] ^ 0x42,
              ];
              resolve({ ip: xorIp.join('.'), port: xorPort });
              return;
            }
            offset += 4 + attrLen + (attrLen % 4 ? 4 - attrLen % 4 : 0);
          }
          resolve(null);
        };

        this.socket.on('message', onStunMessage);

        const reqBuffer = Buffer.from(request);
        this.socket.send(reqBuffer, 0, reqBuffer.length, stunPort, stunHost, (err: Error | null) => {
          if (err) {
            clearTimeout(stunTimer);
            this.socket.removeListener('message', onStunMessage);
            resolve(null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * 关闭 socket
   */
  private _closeSocket(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // ignore
      }
      this.socket = null;
    }
  }

  /**
   * 获取已连接的 TCP endpoint
   */
  getTcpEndpoint(): TcpEndpoint | null {
    return this.tcpEndpoint;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this._closeSocket();
    this.connected = false;
    this.tcpEndpoint = null;
    this.emit('disconnected');
  }
}
