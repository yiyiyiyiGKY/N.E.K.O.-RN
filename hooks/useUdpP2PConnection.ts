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
} {
  const [status, setStatus] = useState<UdpConnectionStatus>('idle');
  const [endpoint, setEndpoint] = useState<TcpEndpoint | null>(null);
  const [layer, setLayer] = useState<number | null>(null);

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

      // 调试：打印 P2P 配置
      console.log('[useUdpP2PConnection] P2P 配置:', JSON.stringify(config.p2p, null, 2));
      Alert.alert('开始连接', '正在尝试建立 P2P 连接...');

      // 1. 先尝试 LAN 直连测试（如果在同一 WiFi 环境）
      if (config.p2p?.lanIp && config.p2p?.lanPort) {
        try {
          console.log(`[useUdpP2PConnection] 测试 LAN 直连: ${config.p2p.lanIp}:${config.p2p.lanPort}`);
          Alert.alert('第1层', `尝试 LAN 直连: ${config.p2p.lanIp}:${config.p2p.lanPort}`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时（从2秒增加到5秒）

          const testResponse = await fetch(
            `http://${config.p2p.lanIp}:${config.p2p.lanPort}/health`,
            {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
            }
          );
          clearTimeout(timeoutId);

          if (testResponse.ok) {
            console.log('[useUdpP2PConnection] LAN 直连可用，跳过 UDP P2P');
            Alert.alert('✅ 第1层成功', 'LAN 直连可用');
            setStatus('connected');
            setEndpoint({ ip: config.p2p.lanIp, port: config.p2p.lanPort });
            setLayer(1);
            return; // 直接返回，不尝试 UDP P2P
          }
        } catch (e) {
          console.log('[useUdpP2PConnection] LAN 直连不可用，继续尝试 UDP P2P');
          Alert.alert('⏱️ 第1层超时', 'LAN 不可用，尝试 UDP P2P...');
        }
      }

      console.log('[useUdpP2PConnection] 开始 UDP P2P 连接...');

      try {
        // 2. 先从云端刷新最新配置（如果有 deviceId）
        if (config.p2p?.deviceId) {
          console.log(`[useUdpP2PConnection] 从云端刷新配置: ${config.p2p.deviceId}`);
          const refreshed = await refreshFromCloud();
          if (!refreshed) {
            console.log('[useUdpP2PConnection] 云端刷新失败，使用本地配置');
          }
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
        client.on('connected', ({ layer: connectedLayer }) => {
          console.log(`[useUdpP2PConnection] 连接层级: ${connectedLayer}`);
          setLayer(connectedLayer);
        });

        const tcpEndpoint = await client.connect();

        if (tcpEndpoint) {
          console.log('[useUdpP2PConnection] UDP P2P 连接成功，更新配置...');
          console.log(`[useUdpP2PConnection] TCP endpoint: ${tcpEndpoint.ip}:${tcpEndpoint.port}`);

          // 5. 更新配置（使用 TCP endpoint）
          await setConfig((prev) => ({
            ...prev,
            host: tcpEndpoint.ip,
            port: tcpEndpoint.port,
          }));

          setStatus('connected');
          setEndpoint(tcpEndpoint);

          Alert.alert(
            '✅ 连接成功',
            `已通过 UDP P2P 连接\n地址: ${tcpEndpoint.ip}:${tcpEndpoint.port}\n层级: ${layer || '未知'}`
          );
        } else {
          console.error('[useUdpP2PConnection] UDP P2P 连接失败');
          setStatus('failed');
          setLayer(null);

          Alert.alert(
            '❌ 连接失败',
            '所有三层连接方式都失败了，请检查网络环境'
          );
        }
      } catch (e) {
        console.error('[useUdpP2PConnection] 连接异常:', e);
        setStatus('failed');

        Alert.alert(
          '连接失败',
          `连接异常: ${e instanceof Error ? e.message : String(e)}`
        );
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
  };
}
