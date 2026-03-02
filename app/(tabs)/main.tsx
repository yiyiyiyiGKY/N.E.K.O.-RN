import { createCharactersApiClient } from '@/services/api/characters';
import type { CharactersData } from '@/services/api/characters';
import { buildHttpBaseURL } from '@/utils/devConnectionConfig';
import { useAudio } from '@/hooks/useAudio';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useDevConnectionConfig } from '@/hooks/useDevConnectionConfig';
import { useLipSync } from '@/hooks/useLipSync';
import { useLive2D } from '@/hooks/useLive2D';
import { useLive2DAgentBackend } from '@/hooks/useLive2DAgentBackend';
import { useLive2DPreferences } from '@/hooks/useLive2DPreferences';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useCamera } from '@/hooks/useCamera';
import { ImageMessageService } from '@/services/imageMessage';
import { mainManager } from '@/utils/MainManager';
import { VoicePrepareOverlay } from '@/components/VoicePrepareOverlay';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert, AppState, Dimensions, Image, Modal, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
import { ReactNativeLive2dView } from 'react-native-live2d';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Live2DRightToolbar,
  ChatContainer,
  type Live2DRightToolbarPanel,
  type Live2DSettingsToggleId,
  type Live2DSettingsState,
  type Live2DAgentToggleId,
  type ConnectionStatus,
} from '@project_neko/components';

type MainUIScreenProps = {}

// 边界保护：逻辑视图范围为 ±1.0，设置为 0.9 确保模型始终大部分在屏幕内
const POSITION_LIMIT = 0.9;
const clampPos = (v: number) => Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, v));

// 缩放范围限制
const SCALE_MIN = 0.3;
const SCALE_MAX = 2.0;
const clampScale = (v: number) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));

// 生成消息 ID
function generateMessageId(counter: number): string {
  return `msg-${Date.now()}-${counter}`;
}

const MainUIScreen: React.FC<MainUIScreenProps> = () => {

  const [isPageFocused, setIsPageFocused] = useState(true);

  // 角色选择 Modal 状态
  const [characterModalVisible, setCharacterModalVisible] = useState(false);
  const [characterList, setCharacterList] = useState<string[]>([]);
  const [currentCatgirl, setCurrentCatgirl] = useState<string | null>(null);
  const [characterLoading, setCharacterLoading] = useState(false);
  const [switchedCharacterName, setSwitchedCharacterName] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const switchedNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const characterLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isChatForceCollapsed, setIsChatForceCollapsed] = useState(false);
  const [voicePrepareStatus, setVoicePrepareStatus] = useState<'preparing' | 'ready' | null>(null);
  const isSwitchingCharacterRef = useRef(false);
  // 🔥 新增：应用是否在后台的标志 ref，用于在拍照等场景忽略 WebSocket 错误
  const isInBackgroundRef = useRef(false);
  // 合并为单一对象，确保 modelName 和 modelUrl 同步更新，避免两次 setState 触发两次 useLive2D effect
  const [live2dModel, setLive2dModel] = useState<{ name: string; url: string | undefined }>({
    name: 'mao_pro',
    url: undefined,
  });
  // ref 持有最新 currentCatgirl，供 onConnectionChange 闭包安全读取（避免 stale closure）
  const currentCatgirlRef = useRef<string | null>(null);
  currentCatgirlRef.current = currentCatgirl;
  // ref 持有最新值，供 useFocusEffect 闭包读取（避免 stale closure）
  const live2dModelRef = useRef(live2dModel);
  live2dModelRef.current = live2dModel;
  const { config, setConfig, applyQrRaw } = useDevConnectionConfig();
  const params = useLocalSearchParams<{
    qr?: string;
    host?: string;
    port?: string;
    name?: string;
    characterName?: string;
  }>();
  const lastAppliedQrRef = useRef<string | null>(null);

  // 🔥 监听应用状态变化，在应用进入后台时标记状态（如拍照场景）
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('📱 应用进入后台，标记后台状态');
        isInBackgroundRef.current = true;
      } else if (nextAppState === 'active') {
        console.log('📱 应用回到前台，延迟重置后台状态');
        // 延迟重置，给 WebSocket 重连时间，避免显示错误
        setTimeout(() => {
          isInBackgroundRef.current = false;
          console.log('📱 后台状态标志已重置');
        }, 2000);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const qrParam = typeof params.qr === 'string' ? params.qr : undefined;
    let raw: string | null = null;

    if (qrParam) {
      try {
        raw = decodeURIComponent(qrParam);
      } catch {
        raw = qrParam;
      }
    } else {
      const host = typeof params.host === 'string' ? params.host.trim() : '';
      const portStr = typeof params.port === 'string' ? params.port.trim() : '';
      const name =
        typeof params.characterName === 'string'
          ? params.characterName.trim()
          : typeof params.name === 'string'
            ? params.name.trim()
            : '';

      if (host || portStr || name) {
        const payload: { host?: string; port?: number; characterName?: string } = {};
        if (host) payload.host = host;
        if (portStr && /^\d+$/.test(portStr)) payload.port = Number(portStr);
        if (name) payload.characterName = name;
        raw = JSON.stringify(payload);
      }
    }

    if (!raw) return;
    if (lastAppliedQrRef.current === raw) return;
    lastAppliedQrRef.current = raw;

    applyQrRaw(raw).then((res) => {
      if (!res.ok) {
        Alert.alert('二维码内容不可用', res.error);
      }
    });
  }, [applyQrRaw, params.characterName, params.host, params.name, params.port, params.qr]);

  // 从后端获取角色对应的 Live2D 模型信息并更新状态
  const syncLive2dModel = useCallback(async (catgirlName: string) => {
    try {
      const apiBase = `${buildHttpBaseURL(config)}/api`;
      const client = createCharactersApiClient(apiBase);
      const modelRes = await client.getCurrentLive2dModel(catgirlName);
      if (modelRes.success && modelRes.model_info) {
        setLive2dModel({
          name: modelRes.model_info.name,
          url: `${buildHttpBaseURL(config)}${modelRes.model_info.path}`,
        });
      }
    } catch (e) {
      console.warn('[syncLive2dModel] 获取模型信息失败:', e);
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // 启动时从服务端获取当前角色，以服务端为准
  useEffect(() => {
    const syncCurrentCatgirl = async () => {
      try {
        const apiBase = `${buildHttpBaseURL(config)}/api`;
        const client = createCharactersApiClient(apiBase);
        const res = await client.getCurrentCatgirl();
        if (res.current_catgirl) {
          setCurrentCatgirl(res.current_catgirl);
          if (config.characterName !== res.current_catgirl) {
            await setConfig({ ...config, characterName: res.current_catgirl });
          }
          await syncLive2dModel(res.current_catgirl);

          // 发送 start_session 以同步角色音色
          setTimeout(() => {
            if (audio.isConnected) {
              console.log('📤 发送 start_session 以同步角色音色');
              audio.sendMessage({
                action: 'start_session',
                input_type: 'text',
                audio_format: 'PCM_48000HZ_MONO_16BIT',
                new_session: false,
              });
            }
          }, 500);
        }
      } catch {
        // 网络不通时降级：用本地缓存初始化 UI
        if (config.characterName) setCurrentCatgirl(config.characterName);
      }
    };
    syncCurrentCatgirl();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 工具栏状态管理（与 Web 版本一致）
  const [isMobile, setIsMobile] = useState(true); // RN 默认为移动端
  const [toolbarGoodbyeMode, setToolbarGoodbyeMode] = useState(false);
  const [toolbarMicEnabled, setToolbarMicEnabled] = useState(false);
  const [toolbarScreenEnabled, setToolbarScreenEnabled] = useState(false);
  const [toolbarOpenPanel, setToolbarOpenPanel] = useState<Live2DRightToolbarPanel>(null);
  const [toolbarSettings, setToolbarSettings] = useState<Live2DSettingsState>({
    mergeMessages: true,
    allowInterrupt: true,
    proactiveChat: false,
    proactiveVision: false,
  });

  // 消息去重：跟踪已发送消息的 clientMessageId（使用 Map 存储时间戳，支持 TTL 清理）
  // 配置：TTL 5分钟，最大条目数 1000，清理间隔 1分钟
  const DEDUPE_TTL_MS = 5 * 60 * 1000;
  const DEDUPE_MAX_SIZE = 1000;
  const DEDUPE_CLEANUP_INTERVAL_MS = 60 * 1000;
  const sentClientMessageIds = useRef<Map<string, number>>(new Map());
  const messageCounterRef = useRef(0);

  // 定期清理过期的去重条目，防止内存无限增长
  useEffect(() => {
    const cleanup = () => {
      const now = Date.now();
      const map = sentClientMessageIds.current;

      // 删除超过 TTL 的条目
      for (const [id, timestamp] of map) {
        if (now - timestamp > DEDUPE_TTL_MS) {
          map.delete(id);
        }
      }

      // 如果仍超过最大数量，按时间戳淘汰最旧的条目
      if (map.size > DEDUPE_MAX_SIZE) {
        const entries = Array.from(map.entries()).sort((a, b) => a[1] - b[1]);
        const toRemove = entries.slice(0, map.size - DEDUPE_MAX_SIZE);
        for (const [id] of toRemove) {
          map.delete(id);
        }
      }
    };

    const interval = setInterval(cleanup, DEDUPE_CLEANUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Text session 管理（与 Web 端一致）
  const [isTextSessionActive, setIsTextSessionActive] = useState(false);
  const sessionStartedResolverRef = useRef<((value: boolean) => void) | null>(null);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionPromiseRef = useRef<Promise<boolean> | null>(null);

  // Agent Backend 管理（传入 openPanel 以支持动态刷新）
  const { agent, onAgentChange, refreshAgentState } = useLive2DAgentBackend({
    apiBase: `http://${config.host}:${config.port}`,
    showToast: (message, duration) => {
      Alert.alert('提示', message);
    },
    openPanel: toolbarOpenPanel === 'agent' ? 'agent' : null,
  });

  // Live2D Preferences 持久化
  const { repository: preferencesRepository } = useLive2DPreferences();

  const chat = useChatMessages({
    maxMessages: 100,
  });

  // 图片选择器 hook
  const imagePicker = useImagePicker({
    maxSelectionCount: 5,
    allowsMultipleSelection: true,
  });

  // 相机 hook
  const camera = useCamera();

  // 相机拍照结果状态（传递给 ChatContainer 的 externalPendingImages）
  const [cameraPendingImages, setCameraPendingImages] = useState<{ id: string; base64: string }[]>([]);

  // 处理相机拍照结果
  useEffect(() => {
    if (camera.photo) {
      // 将拍照结果添加到待发送列表
      const newImage = {
        id: `camera-${Date.now()}`,
        base64: camera.photo.base64, // 纯 base64，不添加前缀
      };
      setCameraPendingImages(prev => [...prev, newImage].slice(0, 5));
      camera.clearPhoto();
    }
  }, [camera.photo, camera.clearPhoto]);

  const audio = useAudio({
    host: config.host,
    port: config.port,
    characterName: config.characterName,
    isSwitchingRef: isSwitchingCharacterRef,  // 传入角色切换标志，用于在切换期间忽略错误
    isInBackgroundRef: isInBackgroundRef,  // 传入后台标志，用于在拍照等场景忽略错误
    onMessage: async (event) => {
      // 二进制音频数据已由 @project_neko/audio-service 自动播放（通过 Realtime binary 事件接管）
      // 这里仅保留文本消息处理逻辑
      if (typeof event.data !== 'string') return;

      // 检查 clientMessageId 用于去重
      let parsedMsg: any = null;
      try {
        parsedMsg = JSON.parse(event.data);
        const clientMessageId = parsedMsg?.clientMessageId as string | undefined;
        if (clientMessageId && sentClientMessageIds.current.has(clientMessageId)) {
          // 服务器回显，跳过处理
          sentClientMessageIds.current.delete(clientMessageId);
          return;
        }
      } catch {
        // 非 JSON 消息，继续处理
      }

      // 处理 session_started 事件（text session 管理）
      if (parsedMsg?.type === 'session_started') {
        const inputMode = parsedMsg.input_mode as string | undefined;
        console.log('✅ 收到 session_started，input_mode:', inputMode);
        if (inputMode === 'text') {
          setIsTextSessionActive(true);
        } else if (inputMode === 'audio') {
          // audio session 启动意味着 text session 已被替换，重置状态
          setIsTextSessionActive(false);
        }
        if (sessionTimeoutRef.current) {
          clearTimeout(sessionTimeoutRef.current);
          sessionTimeoutRef.current = null;
        }
        if (sessionStartedResolverRef.current) {
          sessionStartedResolverRef.current(true);
          sessionStartedResolverRef.current = null;
        }
        pendingSessionPromiseRef.current = null;
        return;
      }

      // 处理 session_failed 事件
      if (parsedMsg?.type === 'session_failed') {
        console.log('❌ 收到 session_failed，input_mode:', parsedMsg.input_mode);
        setIsTextSessionActive(false);
        if (sessionTimeoutRef.current) {
          clearTimeout(sessionTimeoutRef.current);
          sessionTimeoutRef.current = null;
        }
        if (sessionStartedResolverRef.current) {
          sessionStartedResolverRef.current(false);
          sessionStartedResolverRef.current = null;
        }
        pendingSessionPromiseRef.current = null;
        return;
      }

      // 处理 session_ended_by_server 事件（服务端主动终止 session，如 API 断连）
      if (parsedMsg?.type === 'session_ended_by_server') {
        console.log('⚠️ 收到 session_ended_by_server，input_mode:', parsedMsg.input_mode);
        setIsTextSessionActive(false);
        return;
      }

      // 处理文本消息并通过 MainManager 协调
      const result = await chat.handleWebSocketMessage(event);

      // 根据消息类型，通过 MainManager 触发相应的行为
      if (result?.type === 'gemini_response') {
        mainManager.onGeminiResponse(result.isNewMessage);
      } else if (result?.type === 'user_activity') {
        mainManager.onUserSpeechDetected();
      } else if (result?.type === 'turn_end') {
        mainManager.onTurnEnd(result.fullText);
      } else if (result?.type === 'catgirl_switched' && result.characterName) {
        // 幂等保护：如果已在切换中且目标角色相同，跳过重复处理
        if (isSwitchingCharacterRef.current && currentCatgirlRef.current === result.characterName) {
          console.log('🔄 [catgirl_switched] 已在切换中，跳过重复处理');
          return;
        }

        // 检查是否需要触发 WebSocket 重连
        const needsReconnect = config.characterName !== result.characterName;

        // 本地和远端切换统一由此处驱动
        // 立即停止旧角色的音频播放，防止切换后还听到旧角色的声音
        audio.clearAudioQueue();
        setIsChatForceCollapsed(true);
        setCharacterLoading(true);
        isSwitchingCharacterRef.current = true;
        setCurrentCatgirl(result.characterName);
        // 角色切换时重置 text session 状态，确保下次发送消息时重新初始化 session
        setIsTextSessionActive(false);
        await setConfig({ ...config, characterName: result.characterName });
        await syncLive2dModel(result.characterName);

        // 如果 config.characterName 已经等于新角色名，useAudio effect 不会重新运行
        // 需要手动发送 start_session 并完成切换
        if (!needsReconnect) {
          console.log('📤 [catgirl_switched] config 未变化，手动完成切换');
          // 清除 handleSwitchCharacter 设置的超时 timer
          if (characterLoadingTimerRef.current) {
            clearTimeout(characterLoadingTimerRef.current);
            characterLoadingTimerRef.current = null;
          }
          // 直接发送 start_session
          audio.sendMessage({
            action: 'start_session',
            input_type: 'text',
            audio_format: 'PCM_48000HZ_MONO_16BIT',
            new_session: false,
          });
          // 立即完成切换
          isSwitchingCharacterRef.current = false;
          setCharacterLoading(false);
          setIsChatForceCollapsed(false);
          setSwitchedCharacterName(result.characterName);
          if (switchedNameTimerRef.current) clearTimeout(switchedNameTimerRef.current);
          switchedNameTimerRef.current = setTimeout(() => setSwitchedCharacterName(null), 2500);
          return;
        }

        // 超时保护：15 秒内若未收到 onConnectionChange(true)，自动解除所有切换状态
        // 仅在 timer 未设置时才设置，避免覆盖 handleSwitchCharacter 设置的 timer
        if (!characterLoadingTimerRef.current) {
          characterLoadingTimerRef.current = setTimeout(() => {
            setCharacterLoading(false);
            setIsChatForceCollapsed(false);
            isSwitchingCharacterRef.current = false;
            characterLoadingTimerRef.current = null;
            setSwitchError('连接超时，角色切换失败');
            if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
            switchErrorTimerRef.current = setTimeout(() => setSwitchError(null), 3000);
          }, 15000);
        }
      }
    },
    onConnectionChange: (connected) => {
      if (connected) {
        chat.addMessage('已连接到服务器', 'system');
        if (isSwitchingCharacterRef.current) {
          // 发送 start_session 以重新加载角色音色
          console.log('📤 发送 start_session 以重新加载角色音色');
          audio.sendMessage({
            action: 'start_session',
            input_type: 'text',
            audio_format: 'PCM_48000HZ_MONO_16BIT',
            new_session: false,
          });
          console.log('✅ start_session 已调用');

          // 立即重置角色切换标志，避免后续消息重复触发超时
          isSwitchingCharacterRef.current = false;
          console.log('🔄 角色切换标志已重置');
          setCharacterLoading(false);
          setIsChatForceCollapsed(false);
          // 清除超时保护 timer
          if (characterLoadingTimerRef.current) {
            clearTimeout(characterLoadingTimerRef.current);
            characterLoadingTimerRef.current = null;
          }
          const name = currentCatgirlRef.current;
          setSwitchedCharacterName(name);
          if (switchedNameTimerRef.current) clearTimeout(switchedNameTimerRef.current);
          switchedNameTimerRef.current = setTimeout(() => setSwitchedCharacterName(null), 2500);
        }
      } else {
        chat.addMessage('与服务器断开连接', 'system');
        // 连接断开时重置 text session 状态
        setIsTextSessionActive(false);
      }
    }
  });

  // 将 audio.connectionStatus 映射到 ConnectionStatus 类型
  // 在角色切换期间，保持 'open' 状态，避免显示断开错误
  const connectionStatus: ConnectionStatus = isSwitchingCharacterRef.current
    ? 'open'
    : (audio.isConnected ? 'open' : 'closed');

  const live2d = useLive2D({
    modelName: live2dModel.name,
    modelUrl: live2dModel.url,
    backendHost: config.host,
    backendPort: config.port,
    // 由页面 focus 生命周期触发加载；避免 autoLoad + focus 双重触发导致重复加载
    autoLoad: false,
    // TODO: 集成 preferences repository 到 useLive2D hook
    // 这需要修改 useLive2D 以支持持久化
  });

  // 口型同步 hook（无平滑模式，与 Web 版本一致）
  const lipSync = useLipSync({
    minAmplitude: 0.005,    // 最小振幅阈值（降低以更敏感）
    amplitudeScale: 1.0,    // 振幅缩放（调整嘴巴张开幅度）
    autoStart: false,       // 不自动启动，等待模型加载完成
  });

  useFocusEffect(
    useCallback(() => {
      console.log('Live2D页面获得焦点');

      // 设置页面为焦点状态
      setIsPageFocused(true);

      // 只有 url 已就绪（syncLive2dModel 完成后）才触发加载
      // 避免启动时 url 还是 undefined，回退到自拼 URL 加载错误模型
      if (live2dModelRef.current.url) {
        live2d.loadModel();
      }

      return () => {
        console.log('Live2D页面失去焦点');
        // 停止口型同步（stop 应为幂等；避免把 isActive 放进依赖导致 focus effect 重跑）
        lipSync.stop();
        console.log('👄 口型同步已停止（页面失焦）');
        
        // 设置页面为失去焦点状态
        setIsPageFocused(false);
        // 页面失去焦点时，重置模型状态，避免在重新获得焦点时立即加载模型
        // 这样可以确保 CubismFramework 有足够时间初始化
        // 注意：原生视图会在 onDetachedFromWindow 中自动清理资源
        live2d.unloadModel();
      };
    }, [live2d.loadModel, live2d.unloadModel, lipSync.stop])
  );

  // 角色切换后 modelUrl 变化时，页面已聚焦无法靠 useFocusEffect 触发，需单独监听
  // 先显式 unload 再 load，确保 modelPath = undefined 这一帧被渲染，原生层 clearModel() 被调用
  useEffect(() => {
    if (!isPageFocused || !live2dModel.url) return;
    live2d.unloadModel();
    // 下一帧再 load，确保 unload 的 state 变化（modelPath = undefined）先渲染到原生层
    const timer = setTimeout(() => {
      live2d.loadModel();
    }, 0);
    return () => clearTimeout(timer);
  }, [live2dModel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 初始化 MainManager =====
  useEffect(() => {
    console.log('🚀 主界面初始化');

    mainManager.init();

    if (audio.audioService) {
      mainManager.registerAudioService(audio.audioService);
    }

    if (live2d.live2dService) {
      mainManager.registerLive2DService(live2d.live2dService);
    }

    return () => {
      console.log('🧹 主界面清理');
    };
  }, [audio.audioService, live2d.live2dService]);

  useEffect(() => {
    console.log('live2d.live2dProps', live2d.live2dProps);
  }, [live2d.live2dProps]);

  useEffect(() => {
    console.log('live2d.modelState', live2d.modelState);
  }, [live2d.modelState]);

  // 监听模型状态，自动启动/停止口型同步
  useEffect(() => {
    const jsReady = live2d.modelState.isReady && !!live2d.modelState.path;
    const nativeReady = live2d.isNativeModelLoaded;
    const shouldRun = isPageFocused && jsReady && nativeReady;

    if (shouldRun) {
      if (!lipSync.isActive) {
        console.log('✅ Live2D JS/Native 已就绪，启动口型同步');
        lipSync.start();
        console.log('👄 口型同步已启动');
      }
      return;
    }

    if (lipSync.isActive) {
      console.log('⏹️ Live2D 未就绪或页面失焦，停止口型同步');
      lipSync.stop();
      console.log('👄 口型同步已停止');
    }
  }, [
    isPageFocused,
    live2d.modelState.isReady,
    live2d.modelState.path,
    live2d.isNativeModelLoaded,
    lipSync.isActive,
    lipSync.start,
    lipSync.stop,
  ]);

  const handleLoadModel = useCallback(() => {
    live2d.loadModel();
  }, [live2d.loadModel]);

  const handleRecordingToggle = useCallback(() => {
    mainManager.toggleRecording();
  }, []);

  const handleLive2DTap = useCallback(() => {
    mainManager.onLive2DTap();
  }, []);

  // 双指长按拖动状态
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
  // 使用独立 ref 跟踪当前位置，不依赖 React 状态（因为 setPosition 不会触发 React 更新）
  const currentModelPositionRef = useRef({ x: 0, y: 0 });
  const [isDraggingModel, setIsDraggingModel] = useState(false);

  // 双指缩放状态
  const startScaleRef = useRef<number>(0.8);
  const currentScaleRef = useRef<number>(0.8);
  const [isScalingModel, setIsScalingModel] = useState(false);

  // 拖动手势
  const dragGesture = useMemo(() => {
    let screenWidth = 1;
    let screenHeight = 1;
    return Gesture.Pan()
      .minPointers(2)
      .activateAfterLongPress(500)
      .runOnJS(true)
      .onStart(() => {
        const { width, height } = Dimensions.get('window');
        screenWidth = width;
        screenHeight = height;
        // 使用持久化的位置 ref，而不是 React 状态
        const pos = { ...currentModelPositionRef.current };
        if (Math.abs(pos.x) > POSITION_LIMIT || Math.abs(pos.y) > POSITION_LIMIT) {
          live2d.setModelPosition(0, 0);
          currentModelPositionRef.current = { x: 0, y: 0 };
          pos.x = 0;
          pos.y = 0;
        }
        dragStartPositionRef.current = pos;
        setIsDraggingModel(true);
      })
      .onUpdate((e) => {
        const start = dragStartPositionRef.current;
        if (!start) return;
        // 大幅降低灵敏度：手指移动整个屏幕距离，模型仅移动 0.005 个逻辑单位
        // 乘数越小灵敏度越低，0.005 = 低灵敏度（需要大幅度拖动才能移动模型）
        const sensitivity = 0.005;
        const newX = clampPos(start.x + (e.translationX / screenWidth) * sensitivity);
        const newY = clampPos(start.y - (e.translationY / screenHeight) * sensitivity);
        // 更新当前位置 ref，供下次拖动使用
        currentModelPositionRef.current = { x: newX, y: newY };
        live2d.setModelPosition(newX, newY);
      })
      .onFinalize(() => {
        // 拖动结束时，保存最终位置到 ref（从 dragStartPositionRef 计算最终位置）
        // 这样下次拖动时可以从上次结束的位置开始
        dragStartPositionRef.current = null;
        setIsDraggingModel(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 双指缩放手势（捏合/张开）
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        // 记录开始时的缩放值
        startScaleRef.current = currentScaleRef.current;
        setIsScalingModel(true);
      })
      .onUpdate((e) => {
        // 降低缩放灵敏度：缩放因子变化更平缓
        const scaleSensitivity = 0.5;
        const newScale = clampScale(startScaleRef.current * (1 + (e.scale - 1) * scaleSensitivity));
        currentScaleRef.current = newScale;
        live2d.setModelScale(newScale);
      })
      .onFinalize(() => {
        setIsScalingModel(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 组合手势：同时支持拖动和缩放
  const live2dGesture = useMemo(() => {
    return Gesture.Simultaneous(dragGesture, pinchGesture);
  }, [dragGesture, pinchGesture]);

  // 工具栏事件处理（与 Web 版本一致）
  const handleToolbarSettingsChange = useCallback((id: Live2DSettingsToggleId, next: boolean) => {
    setToolbarSettings((prev) => ({ ...prev, [id]: next }));
  }, []);

  const handleToolbarAgentChange = useCallback((id: Live2DAgentToggleId, next: boolean) => {
    onAgentChange(id, next);
  }, [onAgentChange]);

  const handleToggleMic = useCallback(async (next: boolean) => {
    setToolbarMicEnabled(next);
    if (next) {
      setVoicePrepareStatus('preparing');
      try {
        await mainManager.startRecording();
        setVoicePrepareStatus('ready');
        setTimeout(() => setVoicePrepareStatus(null), 800);
      } catch {
        setVoicePrepareStatus(null);
        setToolbarMicEnabled(false);
      }
    } else {
      mainManager.stopRecording();
      // 语音会话停止后，重置 text session 状态
      // 这样下次发送文本消息时会重新发送 start_session
      setIsTextSessionActive(false);
    }
  }, [mainManager]);

  const handleToggleScreen = useCallback((next: boolean) => {
    setToolbarScreenEnabled(next);
    // TODO: 实现屏幕分享功能
  }, []);

  const handleGoodbye = useCallback(() => {
    // 如果麦克风正在录音，先停止
    if (toolbarMicEnabled) {
      mainManager.stopRecording();
      setToolbarMicEnabled(false);
      // 语音会话停止后，重置 text session 状态
      setIsTextSessionActive(false);
    }
    setToolbarGoodbyeMode(true);
    setToolbarOpenPanel(null);
  }, [mainManager, toolbarMicEnabled]);

  const handleReturn = useCallback(() => {
    setToolbarGoodbyeMode(false);
  }, []);

  const handleSettingsMenuClick = useCallback((id: string) => {
    if (id === 'characterManage') {
      const loadCharacters = async () => {
        try {
          setCharacterLoading(true);
          const apiBase = `${buildHttpBaseURL(config)}/api`;
          const client = createCharactersApiClient(apiBase);
          const data: CharactersData = await client.getCharacters();

          const names = Object.keys(data.猫娘 || {});
          if (names.length === 0) {
            Alert.alert('角色管理', '暂无可用角色');
            return;
          }

          setCharacterList(names);
          setCurrentCatgirl(data.当前猫娘 || null);
          setToolbarOpenPanel(null);
          setCharacterModalVisible(true);
        } catch (err: any) {
          Alert.alert('获取角色列表失败', err.message || '网络错误');
        } finally {
          setCharacterLoading(false);
        }
      };
      loadCharacters();
      return;
    }
    Alert.alert('功能提示', `即将打开: ${id}`);
  }, [config]);

  const handleSwitchCharacter = useCallback(async (name: string) => {
    // 检查是否在语音模式
    if (toolbarMicEnabled) {
      Alert.alert('无法切换角色', '语音模式下无法切换角色，请先停止语音对话后再切换');
      return;
    }

    try {
      setCharacterLoading(true);
      const apiBase = `${buildHttpBaseURL(config)}/api`;
      const client = createCharactersApiClient(apiBase);
      const res = await client.setCurrentCatgirl(name);

      if (res.success) {
        setCharacterModalVisible(false);
        // UI 更新由服务端广播的 catgirl_switched 消息统一驱动
        // 超时保护：15 秒内若未收到 onConnectionChange(true)，自动解除所有切换状态
        if (characterLoadingTimerRef.current) clearTimeout(characterLoadingTimerRef.current);
        characterLoadingTimerRef.current = setTimeout(() => {
          setCharacterLoading(false);
          setIsChatForceCollapsed(false);
          isSwitchingCharacterRef.current = false;
          characterLoadingTimerRef.current = null;
          setSwitchError('连接超时，角色切换失败');
          if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
          switchErrorTimerRef.current = setTimeout(() => setSwitchError(null), 3000);
        }, 15000);
      } else {
        setCharacterLoading(false);
        Alert.alert('切换失败', res.error || '未知错误');
      }
    } catch (err: any) {
      setCharacterLoading(false);
      Alert.alert('切换失败', err.message || '网络错误');
    }
  }, [config, toolbarMicEnabled]);

  // 确保 text session 已启动（与 Web 端一致的 Legacy 协议）
  const ensureTextSession = useCallback(async (): Promise<boolean> => {
    // 如果已经有活跃的 text session，直接返回
    if (isTextSessionActive) {
      return true;
    }

    if (!audio.isConnected) {
      return false;
    }

    // 如果当前正在录音（语音模式），先停止录音并等待服务端清理旧 session，
    // 避免 start_session(text) 与正在启动/活跃的 audio session 产生竞态
    if (audio.isRecording) {
      console.log('🔄 检测到正在录音，先停止录音再切换到文本模式');
      await audio.toggleRecording();
      // 给服务端一点时间完成 end_session 清理
      await new Promise(r => setTimeout(r, 500));
    }

    // 如果已经有一个正在进行的 session 请求，复用该 Promise
    // 这样并发调用会共享同一个 Promise，避免 resolver 被覆盖导致早期 Promise 永不 resolve
    if (pendingSessionPromiseRef.current) {
      return pendingSessionPromiseRef.current;
    }

    const promise = new Promise<boolean>((resolve) => {
      // 清除任何现有的超时
      if (sessionTimeoutRef.current) {
        clearTimeout(sessionTimeoutRef.current);
        sessionTimeoutRef.current = null;
      }

      // 设置 resolver
      sessionStartedResolverRef.current = resolve;

      // 发送 start_session（Legacy 协议）
      console.log('📤 发送 start_session(input_type: text, audio_format: PCM_48000HZ_MONO_16BIT)');
      audio.sendMessage({
        action: 'start_session',
        input_type: 'text',
        audio_format: 'PCM_48000HZ_MONO_16BIT',
        new_session: false,
      });

      // 15 秒超时
      sessionTimeoutRef.current = setTimeout(() => {
        if (sessionStartedResolverRef.current === resolve) {
          sessionStartedResolverRef.current = null;
          pendingSessionPromiseRef.current = null;
          console.log('⏰ start_session 超时');
          resolve(false);
        }
        sessionTimeoutRef.current = null;
      }, 15000);
    });

    pendingSessionPromiseRef.current = promise;
    return promise;
  }, [isTextSessionActive, audio.isConnected, audio.isRecording, audio.sendMessage, audio.toggleRecording]);

  // 图片消息服务
  const imageMessageService = useMemo(() => new ImageMessageService(), []);

  // 处理用户发送消息（文本 + 可选图片）
  // 使用 stream_data action 和 clientMessageId 与 N.E.K.O 协议一致
  const handleSendMessage = useCallback(async (text: string, images?: string[]) => {
    if (!audio.isConnected) {
      Alert.alert('提示', '未连接到服务器');
      return;
    }

    // 确保 text session 已启动（与 Web 端一致）
    const sessionOk = await ensureTextSession();
    if (!sessionOk) {
      Alert.alert('提示', '会话初始化失败，请重试');
      return;
    }

    // 合并图片来源：
    // 1. imagePicker.images - 相册选择的图片（expo-image-picker 返回的 base64）
    // 2. images 参数 - ChatContainer 传入的 pendingScreenshots（相机拍照的 base64）
    const imagesToSend: string[] = [];

    // 处理相册选择的图片（直接使用 base64，不再重新压缩）
    if (imagePicker.images.length > 0) {
      console.log('🖼️ 处理相册图片...');
      for (const img of imagePicker.images) {
        // expo-image-picker 返回的 base64 是纯 base64，需要添加 data URI 前缀
        const mimeType = img.mimeType || 'image/jpeg';
        const base64WithPrefix = img.base64.startsWith('data:')
          ? img.base64
          : `data:${mimeType};base64,${img.base64}`;
        imagesToSend.push(base64WithPrefix);
      }
      console.log(`✅ 相册图片处理完成：${imagePicker.images.length} 张`);
    }

    // 处理传入的图片（相机拍照的，已经是 base64 格式）
    if (images && images.length > 0) {
      console.log('📸 处理相机图片...');
      for (const img of images) {
        // 传入的图片可能已经有前缀，也可能没有
        const base64WithPrefix = img.startsWith('data:')
          ? img
          : `data:image/jpeg;base64,${img}`;
        imagesToSend.push(base64WithPrefix);
      }
      console.log(`✅ 相机图片处理完成：${images.length} 张`);
    }

    // 发送图片
    if (imagesToSend.length > 0) {
      for (const imgBase64 of imagesToSend) {
        messageCounterRef.current += 1;
        const clientMessageId = generateMessageId(messageCounterRef.current);
        sentClientMessageIds.current.set(clientMessageId, Date.now());

        audio.sendMessage({
          action: 'stream_data',
          data: imgBase64,
          input_type: 'camera', // 与 N.E.K.O 主项目兼容
          clientMessageId,
        });
      }
      chat.addMessage(`📸 [已发送${imagesToSend.length}张照片]`, 'user');
    }

    // 再发送文本
    if (text.trim()) {
      messageCounterRef.current += 1;
      const clientMessageId = generateMessageId(messageCounterRef.current);
      sentClientMessageIds.current.set(clientMessageId, Date.now());

      // 添加用户消息到 UI
      chat.addMessage(text, 'user');

      // 通过 WS 发送到后端（使用 stream_data action，与 N.E.K.O 协议一致）
      audio.sendMessage({
        action: 'stream_data',
        data: text.trim(),
        input_type: 'text',
        clientMessageId,
      });

      console.log('📤 发送文本消息:', text.substring(0, 50));
    }

    // 清除已选图片
    imagePicker.clearImages();
    setCameraPendingImages([]);
  }, [audio.isConnected, audio.sendMessage, chat.addMessage, ensureTextSession, imagePicker, imageMessageService, setCameraPendingImages]);

  // 检测屏幕尺寸变化
  useEffect(() => {
    const updateIsMobile = () => {
      const { width } = Dimensions.get('window');
      setIsMobile(width <= 768);
    };

    updateIsMobile();
    const subscription = Dimensions.addEventListener('change', updateIsMobile);
    
    return () => {
      subscription?.remove();
    };
  }, []);

  // 清理切换相关 timer，防止组件卸载后 setState
  useEffect(() => {
    return () => {
      if (switchedNameTimerRef.current) clearTimeout(switchedNameTimerRef.current);
      if (switchErrorTimerRef.current) clearTimeout(switchErrorTimerRef.current);
      if (characterLoadingTimerRef.current) clearTimeout(characterLoadingTimerRef.current);
    };
  }, []);

  // 显示 Agent 状态（调试用）
  useEffect(() => {
    console.log('🤖 Agent 状态:', agent.statusText, {
      master: agent.master,
      keyboard: agent.keyboard,
      mcp: agent.mcp,
      userPlugin: agent.userPlugin,
    });
  }, [agent]);

  return (
    <View style={styles.container}>
      {/* Live2D 舞台区域 */}
      <View style={styles.live2dContainer}>
        {/* 页面获得焦点时渲染 Live2D */}
        {isPageFocused && (
          <ReactNativeLive2dView
            style={styles.live2dView}
            {...live2d.live2dPropsForLipSync}
            onTap={handleLive2DTap}
          />
        )}

        {/* 失去焦点时的显示 */}
        {!isPageFocused && (
          <View style={styles.pausedContainer}>
            <Text style={styles.pausedText}>
              {live2d.live2dProps.modelPath ? 'Live2D 已暂停' : '页面未激活'}
            </Text>
          </View>
        )}

        {/* 手势层：覆盖在 Live2D View 之上，不设 pointerEvents（默认 auto） */}
        <GestureDetector gesture={live2dGesture}>
          <View style={StyleSheet.absoluteFill} />
        </GestureDetector>

        {(isDraggingModel || isScalingModel) && (
          <View style={styles.dragIndicator} pointerEvents="none">
            <Text style={styles.dragIndicatorText}>
              {isDraggingModel && isScalingModel ? '拖动/缩放中' : isDraggingModel ? '拖动中' : '缩放中'}
            </Text>
          </View>
        )}
      </View>

      {/* 
        【跨平台组件】Live2DRightToolbar 右侧工具栏
        
        策略更新（2026-01-11）：
        - 已实现 RN 原生版本（Live2DRightToolbar.native.tsx）
        - 使用共享的类型和业务逻辑（types.ts + hooks.ts）
        - Metro Bundler 自动根据平台选择：
          * Web: Live2DRightToolbar.tsx（HTML/CSS 完整版）
          * Android/iOS: Live2DRightToolbar.native.tsx（Modal 简化版）
        - 详见：docs/strategy/cross-platform-components.md
        
        功能包括：
        - 麦克风/屏幕共享切换
        - Agent 设置面板
        - Settings 面板
        - 设置菜单（Live2D设置、API密钥、角色管理等）
      */}
      <View style={styles.toolbarContainer}>
        <Live2DRightToolbar
          visible
          isMobile={isMobile}
          right={isMobile ? 12 : 24}
          top={isMobile ? 12 : 24}
          micEnabled={toolbarMicEnabled}
          screenEnabled={toolbarScreenEnabled}
          goodbyeMode={toolbarGoodbyeMode}
          openPanel={toolbarOpenPanel}
          onOpenPanelChange={setToolbarOpenPanel}
          settings={toolbarSettings}
          onSettingsChange={handleToolbarSettingsChange}
          agent={agent}
          onAgentChange={handleToolbarAgentChange}
          onToggleMic={handleToggleMic}
          onToggleScreen={handleToggleScreen}
          onGoodbye={handleGoodbye}
          onReturn={handleReturn}
          onSettingsMenuClick={handleSettingsMenuClick}
        />
      </View>

      {/*
        【跨平台组件】ChatContainer 聊天容器

        策略更新（2026-01-11）：
        - ✅ 已实现 RN 原生版本（ChatContainer.native.tsx）
        - ✅ 使用共享的类型和业务逻辑（types.ts + hooks.ts）
        - ✅ 已接入主界面 WS 文本消息数据流（P0-1 & P0-2）
        - Metro Bundler 自动根据平台选择：
          * Web: ChatContainer.tsx（HTML/CSS 完整版，支持截图）
          * Android/iOS: ChatContainer.native.tsx（Modal 简化版）
        - 详见：docs/strategy/cross-platform-components.md

        功能包括：
        - 浮动按钮（缩小态）
        - 聊天面板（展开态）
        - 消息列表（用户/系统/助手角色）- 实时显示 WS 消息
        - 文本输入 - 发送到后端
        - Web 平台支持截图功能
      */}
      <View style={styles.chatContainerWrapper}>
        <ChatContainer
          externalMessages={chat.messages}
          connectionStatus={connectionStatus}
          onSendMessage={handleSendMessage}
          disabled={!audio.isConnected}
          forceCollapsed={isChatForceCollapsed}
          onPickImage={imagePicker.pickImages}
          onTakePhoto={camera.takePhoto}
          cameraEnabled={true}
          externalPendingImages={[
            ...imagePicker.images.map((img, index) => ({
              id: `gallery-${Date.now()}-${index}`,
              base64: img.base64,
            })),
            ...cameraPendingImages,
          ]}
          onClearExternalPendingImages={() => {
            imagePicker.clearImages();
            setCameraPendingImages([]);
          }}
        />
      </View>

      {/* 语音准备状态遮罩 */}
      <VoicePrepareOverlay status={voicePrepareStatus} />

      {/* 角色选择 Modal */}
      <Modal
        visible={characterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCharacterModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setCharacterModalVisible(false)}>
          <View style={styles.characterModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.characterModalContent}>
                {/* Header — 对应 neko-header 蓝色背景 */}
                <View style={styles.characterModalHeader}>
                  <Text style={styles.characterModalTitle}>角色管理</Text>
                  <TouchableOpacity
                    style={styles.characterModalCloseBtn}
                    onPress={() => setCharacterModalVisible(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.characterModalCloseBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.characterModalSubtitle}>
                  <Text style={styles.characterModalSubtitleLabel}>当前: </Text><Text style={styles.characterModalSubtitleHighlight}>{currentCatgirl || '未设置'}</Text>
                </Text>
                <ScrollView style={styles.characterModalList} showsVerticalScrollIndicator={false}>
                  {characterList.map((name) => {
                    const isCurrent = name === currentCatgirl;
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[
                          styles.characterModalItem,
                          isCurrent && styles.characterModalItemCurrent,
                        ]}
                        disabled={isCurrent || characterLoading}
                        activeOpacity={0.7}
                        onPress={() => handleSwitchCharacter(name)}
                      >
                        <Image
                          source={require('@/assets/icons/dropdown_arrow.png')}
                          style={styles.characterModalItemIcon}
                        />
                        <Text style={[
                          styles.characterModalItemText,
                          isCurrent && styles.characterModalItemTextCurrent,
                        ]}>
                          {name}
                        </Text>
                        {isCurrent ? (
                          <View style={styles.characterModalBadgeWrap}>
                            <Text style={styles.characterModalBadge}>当前</Text>
                          </View>
                        ) : (
                          <View style={styles.characterModalBadgePlaceholder} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <Text style={styles.characterModalSubtitle2}></Text>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* 角色切换全屏加载遮罩 */}
      {characterLoading && (
        <View style={styles.switchingOverlay}>
          <ActivityIndicator size="large" color="#40c5f1" />
          <Text style={styles.switchingText}>正在切换角色...</Text>
        </View>
      )}

      {/* 切换成功提示条 */}
      {switchedCharacterName !== null && (
        <View style={styles.switchingSuccessBanner} pointerEvents="none">
          <Text style={styles.switchingSuccessText}>已切换为 {switchedCharacterName}</Text>
        </View>
      )}

      {/* 切换失败提示条 */}
      {switchError !== null && (
        <View style={styles.switchingErrorBanner} pointerEvents="none">
          <Text style={styles.switchingErrorText}>{switchError}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  live2dContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  live2dView: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
  },
  pausedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pausedText: {
    color: '#666',
    fontSize: 16,
  },
  dragIndicator: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(64, 197, 241, 0.25)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(64, 197, 241, 0.6)',
    zIndex: 10,
  },
  dragIndicatorText: {
    color: '#40c5f1',
    fontSize: 13,
  },
  toolbarContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  chatContainerWrapper: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    pointerEvents: 'box-none',
  },
  characterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  characterModalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    width: '82%',
    maxHeight: '65%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 20,
  },
  characterModalHeader: {
    backgroundColor: '#40C5F1',
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  characterModalCloseBtn: {
    position: 'absolute',
    right: 16,
    top: '50%',
    marginTop: -10,
  },
  characterModalCloseBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 20,
  },
  characterModalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1,
  },
  characterModalSubtitle: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
    characterModalSubtitle2: {
    color: '#666',
    fontSize: 6,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  characterModalSubtitleLabel: {
    color: '#40C5F1',
    fontWeight: '600',
    fontSize: 13,
  },
  characterModalSubtitleHighlight: {
    color: '#40C5F1',
    fontWeight: '600',
  },
  characterModalList: {
    maxHeight: 300,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  characterModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 8,
    backgroundColor: '#f0f8ff',
    borderWidth: 2,
    borderColor: '#b3e5fc',
    borderLeftWidth: 4,
    borderLeftColor: '#40C5F1',
  },
  characterModalItemCurrent: {
    backgroundColor: '#e3f4ff',
    borderColor: '#40C5F1',
    borderLeftColor: '#22b3ff',
  },
  characterModalItemIcon: {
    width: 18,
    height: 18,
    marginRight: 10,
    transform: [{ rotate: '-90deg' }],
    tintColor: '#40C5F1',
  },
  characterModalItemText: {
    flex: 1,
    color: '#40C5F1',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  characterModalItemTextCurrent: {
    color: '#22b3ff',
    fontWeight: '700',
  },
  characterModalBadgeWrap: {
    backgroundColor: '#40C5F1',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
  },
  characterModalBadgePlaceholder: {
    width: 38,
  },
  characterModalBadge: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  switchingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  switchingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 12,
  },
  switchingSuccessBanner: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(40, 40, 40, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    zIndex: 9999,
  },
  switchingSuccessText: {
    color: '#40c5f1',
    fontSize: 15,
  },
  switchingErrorBanner: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(40, 40, 40, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    zIndex: 9999,
  },
  switchingErrorText: {
    color: '#f55',
    fontSize: 15,
  },
});

export default MainUIScreen;
