import { AudioService, AudioStats } from '@/services/AudioService';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DevConnectionConfig } from '@/utils/devConnectionConfig';

interface UseAudioConfig {
  host: string;
  port: number;
  characterName: string;
  // P2P 配置（可选）
  p2p?: DevConnectionConfig['p2p'];
  // 配置是否已加载完成，为 false 时不初始化连接
  enabled?: boolean;
  onMessage?: (event: MessageEvent) => void;
  onConnectionChange?: (isConnected: boolean) => void;
  // 🔥 新增：角色切换标志 ref，用于在切换期间忽略错误
  isSwitchingRef?: React.RefObject<boolean>;
  // 🔥 新增：应用是否在后台的标志 ref，用于在应用进入后台期间忽略 WebSocket 错误
  isInBackgroundRef?: React.RefObject<boolean>;
}

export interface UseAudioReturn {
  // 状态
  isConnected: boolean;
  isRecording: boolean;
  connectionStatus: string;
  audioStats: AudioStats;

  // 方法
  toggleRecording: () => Promise<void>;
  clearAudioQueue: () => void;
  handleUserSpeechDetection: () => void;
  sendMessage: (message: string | object) => void;
  reconnect: () => void;

  // 原始 Service 引用（供高级用户使用）
  audioService: AudioService | null;

  // 🔥 新增：AudioService 是否完全就绪的 ref（避免闭包引用问题）
  isReadyRef: React.RefObject<boolean>;
}

export const useAudio = (config: UseAudioConfig): UseAudioReturn => {
  // 状态管理
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('未连接');
  const [audioStats, setAudioStats] = useState<AudioStats>({
    audioChunksCount: 0,
    sendCount: 0,
    tempBufferLength: 0,
    isStreaming: false,
    isPlaying: false,
    feedbackControlStatus: '正常',
    isSpeechDetected: false,
  });

  // Service 引用
  const audioServiceRef = useRef<AudioService | null>(null);

  // 🔥 AudioService 是否完全就绪的 ref（避免闭包引用问题）
  const isReadyRef = useRef<boolean>(false);

  // 切换录音状态
  const toggleRecording = async () => {
    if (!audioServiceRef.current) {
      console.warn('⚠️ 音频服务未初始化');
      return;
    }

    await audioServiceRef.current.toggleRecording();
  };

  // 清空音频队列
  const clearAudioQueue = () => {
    audioServiceRef.current?.clearAudioQueue();
  };

  // 处理用户语音检测（打断）
  const handleUserSpeechDetection = () => {
    audioServiceRef.current?.handleUserSpeechDetection();
  };

  // 发送消息
  const sendMessage = (message: string | object) => {
    audioServiceRef.current?.sendMessage(message);
  };

  // 稳定化 P2P token，避免对象引用变化导致不必要的重连
  const p2pToken = config.p2p?.token;

  // 重连 key：递增触发 useEffect 销毁旧连接并重建
  const [reconnectKey, setReconnectKey] = useState(0);

  const reconnect = useCallback(() => {
    console.log('🔄 手动触发重连');
    setReconnectKey(k => k + 1);
  }, []);

  // 组件初始化
  useEffect(() => {
    // 配置未加载完成时不初始化连接，避免用 DEFAULT config 发起无效连接
    if (config.enabled === false) {
      console.log('🎧 useAudio 跳过初始化（配置未就绪）');
      return;
    }

    console.log('🎧 useAudio 初始化中...', {
      host: config.host,
      port: config.port,
      characterName: config.characterName,
      p2pToken: p2pToken ? '***' : undefined,
    });

    // 创建 AudioService
    audioServiceRef.current = new AudioService({
      host: config.host,
      port: config.port,
      characterName: config.characterName,
      p2p: config.p2p,
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        setConnectionStatus(connected ? '已连接' : '未连接');
        config.onConnectionChange?.(connected);
      },
      onMessage: (event) => {
        config.onMessage?.(event);
      },
      onError: (error) => {
        // 🔥 修复：在角色切换期间忽略错误，避免显示"连接错误"
        if (config.isSwitchingRef?.current) {
          console.log('🔄 角色切换中，忽略 WebSocket 错误:', error);
          return;
        }
        // 🔥 修复：在应用进入后台期间忽略错误（如拍照时）
        if (config.isInBackgroundRef?.current) {
          console.log('📷 应用处于后台，忽略 WebSocket 错误:', error);
          return;
        }
        console.warn('⚠️ 音频服务错误:', error);
        setConnectionStatus('连接错误');
      },
      onRecordingStateChange: (recording) => {
        setIsRecording(recording);
      },
      onAudioStatsUpdate: (stats) => {
        setAudioStats(stats);
      },
    });

    // 初始化服务
    audioServiceRef.current.init().catch(error => {
      console.error('❌ AudioService 初始化失败:', error);
      setConnectionStatus('初始化失败');
      isReadyRef.current = false;
    }).then(() => {
      // 🔥 初始化完成后，更新 isReadyRef
      if (audioServiceRef.current?.isReady()) {
        console.log('✅ AudioService 已完全就绪，更新 isReadyRef');
        isReadyRef.current = true;
      }
    });

    // 清理函数
    return () => {
      console.log('🧹 useAudio 清理中...');
      audioServiceRef.current?.destroy();
      audioServiceRef.current = null;
      setIsRecording(false);
      setIsConnected(false);
      // 🔥 修复：清理时重置 isReadyRef，避免 waitForConnection 误判
      isReadyRef.current = false;
    };
  }, [config.host, config.port, config.characterName, p2pToken, config.enabled, reconnectKey]);

  return {
    // 状态
    isConnected,
    isRecording,
    connectionStatus,
    audioStats,

    // 方法
    toggleRecording,
    clearAudioQueue,
    handleUserSpeechDetection,
    sendMessage,
    reconnect,

    // 原始 Service 引用（供高级用户使用）
    audioService: audioServiceRef.current,

    // AudioService 是否完全就绪的 ref（避免闭包引用问题）
    isReadyRef,
  };
};
