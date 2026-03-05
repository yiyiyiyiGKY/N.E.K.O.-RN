import { createNativeRealtimeClient } from '@project_neko/realtime';
import type { DevConnectionConfig } from '@/utils/devConnectionConfig';

export interface WSServiceConfig {
  protocol?: string;
  host: string;
  port: number;
  characterName: string;
  // P2P 配置（可选）
  p2p?: DevConnectionConfig['p2p'];
  onOpen?: () => void;
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onClose?: (event: CloseEvent) => void;
}

export class WSService {
  private client: ReturnType<typeof createNativeRealtimeClient> | null = null;
  private config: WSServiceConfig;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private isP2P: boolean = false;

  constructor(config: WSServiceConfig) {
    this.config = {
      protocol: 'ws',
      ...config
    };
    this.isP2P = !!config.p2p;
  }

  /**
   * 初始化WebSocket连接
   */
  public init(): void {
    // 先断开旧连接（与旧实现一致：init() 代表重新建立连接）
    this.close();

    // 构建 WebSocket URL
    let wsUrl: string;
    console.log('[WSService] init() called, isP2P:', this.isP2P, 'p2p config:', this.config.p2p);
    if (this.isP2P && this.config.p2p) {
      // v2 P2P 模式：通过代理连接，token 放在 URL query 中
      wsUrl = `ws://${this.config.host}:${this.config.port}`
            + `/ws/${this.config.characterName}`
            + `?token=${this.config.p2p.token}`;

      console.log('[WSService] 使用 P2P 模式连接:', {
        host: this.config.host,
        port: this.config.port,
        characterName: this.config.characterName,
        wsUrl: wsUrl.replace(this.config.p2p.token, '***'), // 隐藏 token
      });
    } else {
      wsUrl = `${this.config.protocol}://${this.config.host}:${this.config.port}/ws/${this.config.characterName}`;

      console.log('[WSService] 使用标准 WebSocket 连接:', {
        wsUrl: wsUrl,
        characterName: this.config.characterName,
        timestamp: new Date().toISOString()
      });
    }

    // 统一使用标准 WebSocket client（v2 架构）
    this.client = createNativeRealtimeClient({
      url: wsUrl,
      // 与旧版静态脚本/协议对齐：默认 ping 心跳
      heartbeat: { intervalMs: 30_000, payload: { action: 'ping' } },
      // 复刻旧 WSService 的”固定间隔 + 次数上限”重连策略
      reconnect: {
        enabled: true,
        minDelayMs: this.reconnectDelay,
        maxDelayMs: this.reconnectDelay,
        backoffFactor: 1,
        jitterRatio: 0,
        maxAttempts: this.maxReconnectAttempts,
      },
      // 允许下游（如 @project_neko/audio-service）订阅 json 事件；
      // 上层仍可继续在 MessageEvent 里自己 JSON.parse（互不冲突）
      parseJson: true,
    });

    this.setupEventListeners();
    this.client.connect();
  }

  /**
   * 设置WebSocket事件监听器
   */
  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on('open', () => {
      console.log('WebSocket连接已建立:', this.client?.getUrl());
      this.config.onOpen?.();
    });

    this.client.on('message', (evt: any) => {
      // realtime 只保证 { data } 结构；业务侧主要依赖 event.data
      this.config.onMessage?.(evt?.rawEvent as any);
    });

    this.client.on('error', (evt: any) => {
      // 过滤 1006 异常关闭的错误，避免误导性的错误日志
      const event = evt?.event;
      const isAbnormalClose = event?.code === 1006 ||
        (event?.reason && event.reason.includes('failed to connect'));
      if (isAbnormalClose) {
        console.log('WebSocket连接中断(1006)，将自动重连:', event?.reason || 'abnormal close');
      } else {
        console.warn('WebSocket连接错误:', event);
      }
      this.config.onError?.(event as any);
    });

    this.client.on('close', (evt: any) => {
      console.log('WebSocket连接已关闭:', evt?.event);
      this.config.onClose?.(evt?.event as any);
    });
  }

  /**
   * 发送消息
   */
  public send(data: any): void {
    if (!this.client || this.client.getState() !== 'open') {
      console.warn('WebSocket未连接，无法发送消息');
      return;
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.client.send(message);
    } catch (e) {
      console.warn('发送WebSocket消息失败:', e);
    }
  }

  /**
   * 关闭连接
   */
  public close(): void {
    if (!this.client) return;
    try {
      this.client.disconnect({ code: 1000, reason: '主动关闭' });
    } catch (_e) {
      // ignore
    } finally {
      this.client = null;
    }
  }

  /**
   * 获取连接状态
   */
  public getReadyState(): number | null {
    return this.client?.getSocket()?.readyState ?? null;
  }

  /**
   * 检查是否已连接
   */
  public isConnected(): boolean {
    return this.client?.getState() === 'open';
  }

  /**
   * 获取WebSocket实例（用于需要直接访问的场景）
   * 注意：P2P 模式下返回的是 P2PWebSocket 实例
   */
  public getWebSocket(): WebSocket | any | null {
    return this.client?.getSocket() as any;
  }

  /**
   * 获取底层 RealtimeClient（供 audio-service 等库复用）。
   * 注意：请勿在外部直接改写其内部状态；推荐仅用于订阅事件/sendJson。
   */
  public getRealtimeClient(): ReturnType<typeof createNativeRealtimeClient> | null {
    return this.client;
  }

  /**
   * 检查是否使用 P2P 模式
   */
  public isP2PMode(): boolean {
    return this.isP2P;
  }

  /**
   * 更新配置
   */
  public updateConfig(newConfig: Partial<WSServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 销毁服务
   */
  public destroy(): void {
    this.close();
  }
}
