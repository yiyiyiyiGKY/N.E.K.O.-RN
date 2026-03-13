/**
 * UDP P2P 客户端 - v3 三层连接回退
 *
 * 工作流程：
 * 1. UDP 探测（NAT 穿透）- 三层回退
 * 2. 获取 TCP endpoint（HTTP 代理地址）
 * 3. 切换到 TCP 连接（标准 HTTP API）
 */

import { Platform } from 'react-native';
import { EventEmitter } from 'events';

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
    console.log('[UDP P2P] 开始三层连接尝试...');

    // 第1层：LAN 直连
    if (this.config.lanIp && this.config.lanPort) {
      console.log(`[UDP P2P] 第1层：尝试 LAN 直连 ${this.config.lanIp}:${this.config.lanPort}`);
      const endpoint = await this._tryConnect(
        this.config.lanIp,
        this.config.lanPort,
        5000,  // 5秒超时
        1,
        'LAN'
      );
      if (endpoint) {
        console.log('✅ [UDP P2P] 第1层成功：LAN 直连');
        this.tcpEndpoint = endpoint;
        this.connected = true;
        return endpoint;
      }
      console.log('⏱️  [UDP P2P] 第1层超时，尝试下一层...');
    }

    // 第2层：STUN 打洞
    if (this.config.stunIp && this.config.stunPort) {
      console.log(`[UDP P2P] 第2层：尝试 STUN 打洞 ${this.config.stunIp}:${this.config.stunPort}`);
      const endpoint = await this._tryConnect(
        this.config.stunIp,
        this.config.stunPort,
        10000,  // 10秒超时
        2,
        'STUN'
      );
      if (endpoint) {
        console.log('✅ [UDP P2P] 第2层成功：STUN 打洞');
        this.tcpEndpoint = endpoint;
        this.connected = true;
        return endpoint;
      }
      console.log('⏱️  [UDP P2P] 第2层超时，尝试下一层...');
    }

    // 第3层：FRP 中转
    if (this.config.frpIp && this.config.frpPort) {
      console.log(`[UDP P2P] 第3层：尝试 FRP 中转 ${this.config.frpIp}:${this.config.frpPort}`);
      const endpoint = await this._tryConnect(
        this.config.frpIp,
        this.config.frpPort,
        10000,  // 10秒超时
        3,
        'FRP'
      );
      if (endpoint) {
        console.log('✅ [UDP P2P] 第3层成功：FRP 中转');
        this.tcpEndpoint = endpoint;
        this.connected = true;
        return endpoint;
      }
      console.log('⏱️  [UDP P2P] 第3层超时');
    }

    console.log('❌ [UDP P2P] 所有连接方式失败');
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
        this.socket = dgram.createSocket('udp4');

        const timer = setTimeout(() => {
          this._closeSocket();
          resolve(null);
        }, timeout);

        // 监听消息
        this.socket.on('message', (data: Buffer) => {
          clearTimeout(timer);
          try {
            const msg = JSON.parse(data.toString());

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

      } catch (e) {
        console.error('[UDP P2P] 连接失败:', e);
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
