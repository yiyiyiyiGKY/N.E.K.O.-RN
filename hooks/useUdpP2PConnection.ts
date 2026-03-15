/**
 * UDP P2P 连接 Hook
 *
 * 自动处理 UDP P2P 三层连接，并更新 config 中的 host 和 port
 */

import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { UdpP2PClient, type TcpEndpoint } from '@/services/UdpP2PClient';
import type { DevConnectionConfig } from '@/utils/devConnectionConfig';

export type UdpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed';

export function useUdpP2PConnection(
  config: DevConnectionConfig,
  isConfigLoaded: boolean,
  setConfig: (next: Partial<DevConnectionConfig> | ((prev: DevConnectionConfig) => DevConnectionConfig)) => Promise<DevConnectionConfig>,
  refreshFromCloud: () => Promise<boolean>
): {
  status: UdpConnectionStatus;
  endpoint: TcpEndpoint | null;
  layer: number | null;
  isConnecting: boolean;
  logs: string[];
} {
  const [status, setStatus] = useState<UdpConnectionStatus>('idle');
  const [endpoint, setEndpoint] = useState<TcpEndpoint | null>(null);
  const [layer, setLayer] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [...prev.slice(-49), `[${ts}] ${msg}`]);
    console.log(`[useUdpP2PConnection] ${msg}`);
  };

  // 使用 ref 防止重复连接
  const hasAttemptedRef = useRef(false);

  useEffect(() => {
    // 如果配置未加载，跳过
    if (!isConfigLoaded) {
      return;
    }

    // 如果没有 P2P 配置，标记为已连接（普通 HTTP 模式）
    if (!config.p2p || !config.p2p.token) {
      console.log('[useUdpP2PConnection] 没有 P2P 配置，使用普通连接');
      if (status === 'idle') {
        setStatus('connected');
      }
      return;
    }

    // 如果已经尝试过，跳过
    if (hasAttemptedRef.current) {
      return;
    }

    // 开始连接
    const connect = async () => {
      hasAttemptedRef.current = true;
      setStatus('connecting');
      addLog(`开始连接，P2P token: ${config.p2p?.token?.slice(0, 8)}...`);

      // 1. 先尝试 LAN 直连测试（如果在同一 WiFi 环境）
      if (config.p2p?.lanIp && config.p2p?.lanPort) {
        addLog(`第1层：LAN 直连 ${config.p2p.lanIp}:${config.p2p.lanPort}`);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const testResponse = await fetch(
            `http://${config.p2p.lanIp}:${config.p2p.lanPort}/health`,
            { method: 'GET', signal: controller.signal }
          );
          clearTimeout(timeoutId);
          if (testResponse.ok) {
            addLog(`✅ 第1层成功：LAN 直连`);
            setStatus('connected');
            setEndpoint({ ip: config.p2p.lanIp, port: config.p2p.lanPort });
            setLayer(1);
            return;
          }
        } catch (e) {
          addLog(`⏱️ 第1层失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }

      addLog('开始 UDP P2P 连接...');
      try {
        // 2. 先从云端刷新最新配置（如果有 deviceId）
        if (config.p2p?.deviceId) {
          addLog(`从云端刷新配置: ${config.p2p.deviceId}`);
          const refreshed = await refreshFromCloud();
          addLog(refreshed ? '云端刷新成功' : '云端刷新失败，使用本地配置');
        }

        // 3. 创建 UDP 客户端
        const client = new UdpP2PClient({
          token: config.p2p!.token,
          deviceId: config.p2p!.deviceId,
          lanIp: config.p2p!.lanIp,
          lanPort: config.p2p!.lanPort,
          stunIp: config.p2p!.stunIp,
          stunPort: config.p2p!.stunPort,
          frpIp: config.p2p!.frpIp,
          frpPort: config.p2p!.frpPort,
          cloudRegistryUrl: process.env.EXPO_PUBLIC_CLOUD_REGISTRY_URL,
        });

        // 4. 先注册事件监听，再发起连接
        client.on('log', (msg: string) => addLog(`[client] ${msg}`));
        client.on('connected', ({ layer: connectedLayer, method }) => {
          addLog(`✅ 第${connectedLayer}层成功：${method}`);
          setLayer(connectedLayer);
        });

        addLog(`stunIp=${config.p2p!.stunIp} stunPort=${config.p2p!.stunPort}`);
        addLog(`frpIp=${config.p2p!.frpIp} frpPort=${config.p2p!.frpPort}`);

        const tcpEndpoint = await client.connect();

        if (tcpEndpoint) {
          addLog(`连接成功，TCP endpoint: ${tcpEndpoint.ip}:${tcpEndpoint.port}`);
          await setConfig((prev) => ({
            ...prev,
            host: tcpEndpoint.ip,
            port: tcpEndpoint.port,
          }));
          setStatus('connected');
          setEndpoint(tcpEndpoint);
        } else {
          addLog('❌ 所有三层连接方式都失败');
          setStatus('failed');
          setLayer(null);
        }
      } catch (e) {
        addLog(`❌ 连接异常: ${e instanceof Error ? e.message : String(e)}`);
        setStatus('failed');
      }
    };

    // 延迟 1 秒后连接（等待配置稳定）
    const timer = setTimeout(connect, 1000);

    return () => {
      clearTimeout(timer);
    };
  }, [isConfigLoaded, config.p2p?.token]);  // 只在 token 变化时重新连接

  return {
    status,
    endpoint,
    layer,
    isConnecting: status === 'connecting',
    logs,
  };
}
