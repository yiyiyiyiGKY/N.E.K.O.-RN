import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { ReactNativeLive2dModule } from 'react-native-live2d';
import { createLive2DService } from '@project_neko/live2d-service';
import type {
  ExpressionRef,
  Live2DAdapter,
  Live2DError,
  Live2DService as CoreLive2DService,
  Live2DState,
  ModelRef,
  MotionRef,
  Transform,
  Vec2,
} from '@project_neko/live2d-service';

import { downloadDependenciesFromLocalModel, removeDownloadedModel } from '../utils/live2dDownloader';

/**
 * Live2D 服务配置接口
 */
export interface Live2DServiceConfig {
  modelName: string;
  backendHost: string;
  backendPort: number;
  backendScheme?: 'http' | 'https';
  live2dPath?: string;
  /** 若提供，直接使用该 URL 作为 model3.json 远端地址，跳过自动拼接 */
  modelUrl?: string;
  onModelLoaded?: () => void;
  onModelError?: (error: string) => void;
  onLoadingStateChange?: (isLoading: boolean) => void;
  onModelStateChange?: (state: ModelState) => void;
  onTransformStateChange?: (state: TransformState) => void;
  onAnimationStateChange?: (state: AnimationState) => void;
}

/**
 * 模型状态接口
 */
export interface ModelState {
  path: string | undefined;
  isReady: boolean;
  isLoading: boolean;
}

/**
 * 模型变换状态
 */
export interface TransformState {
  scale: number;
  position: { x: number; y: number };
}

/**
 * 动画状态
 */
export interface AnimationState {
  currentMotion: string;
  currentExpression: string;
  autoBreath: boolean;
  autoBlink: boolean;
}

/**
 * Live2D 视图属性（可直接传递给 ReactNativeLive2dView）
 */
export interface Live2DViewProps {
  modelPath: string | undefined;
  motionGroup: string;
  expression: string;
  scale: number;
  position: { x: number; y: number };
  autoBreath: boolean;
  autoBlink: boolean;
}

/**
 * Live2DService - Live2D 模型服务
 * 
 * 职责：
 * - 管理 Live2D 模型的加载和卸载
 * - 控制动作/表情/变换
 * - 处理模型文件的下载与校验
 *
 * 重要：该类现在会 **复用跨平台内核** `@project_neko/live2d-service`：
 * - 本文件仍负责“RN/Expo 资源管线（download/cache）”与“props 聚合”
 * - 状态机/事件语义统一交给 `createLive2DService(adapter)`（便于未来与 Web 对齐）
 */
export class Live2DService {
  private config: Live2DServiceConfig;
  private modelState: ModelState;
  private transformState: TransformState;
  private animationState: AnimationState;
  private isInitialized: boolean = false;
  private modelBaseUrl: string;
  private core: CoreLive2DService;
  private lastLoadingFlag: boolean | null = null;
  private hasWarnedAboutSetViewPosition: boolean = false;
  private hasWarnedAboutSetViewScale: boolean = false;

  constructor(config: Live2DServiceConfig) {
    this.config = {
      backendScheme: 'http',
      live2dPath: 'live2d',
      ...config,
    };

    this.modelBaseUrl = `${this.config.backendScheme}://${this.config.backendHost}:${this.config.backendPort}/${this.config.live2dPath}/${this.config.modelName}`;

    // 初始化状态
    this.modelState = {
      path: undefined,
      isReady: false,
      isLoading: false,
    };

    this.transformState = {
      scale: 0.8,
      position: { x: 0, y: 0 },
    };

    this.animationState = {
      currentMotion: 'Idle',
      currentExpression: 'exp_exp_01',
      autoBreath: true,
      autoBlink: true,
    };

    const adapter: Live2DAdapter = {
      platform: 'native',
      capabilities: { motions: true, expressions: true, mouth: true, transform: true },

      // RN 侧暂不依赖 core 的事件 sink（事件主要由 View callbacks 驱动）；
      // 但保留 setEventSink 以便后续把 onTap/onMotionFinished 等事件统一上报。
      setEventSink: () => {},

      loadModel: async (model: ModelRef) => {
        // Android：显式初始化 Live2D 框架（幂等）
        if (Platform.OS === 'android') {
          try {
            await ReactNativeLive2dModule.initializeLive2D?.();
          } catch (e) {
            // best-effort：初始化失败不应阻断资源下载（但后续渲染可能失败）
            console.warn('⚠️ [Live2DService] initializeLive2D failed, continue:', e);
          }
        }

        // 资源管线：把远端 model3.json + 依赖下载到本地 cache，并产出 file://... 路径
        await this.downloadAndPrepareModel(model.uri);
      },

      unloadModel: async () => {
        // RN 原生 View 会在 prop 变为 undefined 后自行清理（见 ReactNativeLive2dView.kt）
      },

      playMotion: async (motion: MotionRef) => {
        this.animationState.currentMotion = motion.group;
        this.notifyAnimationStateChange();
      },

      setExpression: async (expression: ExpressionRef) => {
        this.animationState.currentExpression = expression.id;
        this.notifyAnimationStateChange();
      },

      setMouthValue: (value: number) => {
        // 口型同步走 native module 直达（避免 React render 链路抖动）
        ReactNativeLive2dModule.setMouthValue(value);
      },

      setTransform: async (transform: Transform) => {
        // position
        if (transform.position && typeof transform.position.x === 'number' && typeof transform.position.y === 'number') {
          this.transformState.position = { x: transform.position.x, y: transform.position.y };
        }

        // scale（优先 number；Vec2 取 x 作为 uniform scale）
        const scale = transform.scale;
        if (typeof scale === 'number' && Number.isFinite(scale)) {
          this.transformState.scale = scale;
        } else if (scale && typeof scale === 'object') {
          const vec = scale as Vec2;
          if (typeof vec.x === 'number' && Number.isFinite(vec.x)) {
            this.transformState.scale = vec.x;
          }
        }

        this.notifyTransformStateChange();
      },

      getViewProps: () => {
        // 允许上层直接拿到“适配 RN View 的 props 快照”
        return this.getViewProps() as any;
      },

      dispose: () => {
        // best-effort：由 Live2DService.destroy() 做统一清理
      },
    };

    this.core = createLive2DService(adapter);

    // 把 core 的状态机同步回旧版 ModelState（供现有 hook/UI 继续使用）
    this.core.on('stateChanged', ({ next }) => {
      this.syncModelStateFromCore(next);
    });

    this.core.on('modelLoaded', () => {
      this.config.onModelLoaded?.();
    });

    this.core.on('error', (err: Live2DError) => {
      this.config.onModelError?.(err.message || 'Live2D error');
    });
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      console.warn('⚠️ Live2DService 已经初始化过了');
      return;
    }

    console.log('🎨 Live2DService 初始化中...');
    this.isInitialized = true;
    console.log('✅ Live2DService 初始化完成');
  }

  /**
   * 验证模型文件是否存在（关键文件：model3.json + moc3）
   */
  private validateModelFiles(): boolean {
    try {
      const modelFile = new File(
        Paths.cache,
        `live2d/${this.config.modelName}/${this.config.modelName}.model3.json`
      );
      const mocFile = new File(
        Paths.cache,
        `live2d/${this.config.modelName}/${this.config.modelName}.moc3`
      );

      const isValid = modelFile.exists && mocFile.exists;

      if (isValid) {
        console.log('✅ 模型文件验证通过');
      } else {
        console.log('❌ 模型文件验证失败');
      }

      return isValid;
    } catch (error) {
      console.error('验证模型文件失败:', error);
      return false;
    }
  }

  /**
   * 下载/补齐依赖并产出本地 model3.json 路径
   */
  private async downloadAndPrepareModel(remoteModel3JsonUrl: string): Promise<void> {
    console.log('🚀 开始准备模型资源:', this.config.modelName);

    // 创建目录结构
    const cacheDir = new Directory(Paths.cache, 'live2d');
    if (!cacheDir.exists) {
      cacheDir.create();
      console.log('📁 创建缓存目录:', cacheDir.uri);
    }

    const modelDir = new Directory(cacheDir, this.config.modelName);
    if (!modelDir.exists) {
      modelDir.create();
      console.log('📁 创建模型目录:', modelDir.uri);
    }

    // 构建本地路径
    const localPath = `${modelDir.uri}${this.config.modelName}.model3.json`;
    console.log('📍 本地模型路径:', localPath);

    // 检查模型文件是否存在
    const modelFile = new File(modelDir, `${this.config.modelName}.model3.json`);

    if (!modelFile.exists) {
      console.log('📥 模型文件不存在，开始下载...');
      await File.downloadFileAsync(remoteModel3JsonUrl, modelDir);
      console.log('✅ 模型文件下载完成');
    } else {
      console.log('✅ 模型文件已存在');
    }

    // 检查依赖文件是否完整
    if (!this.validateModelFiles()) {
      console.log('📥 依赖文件缺失，下载依赖文件...');
      await downloadDependenciesFromLocalModel(localPath, remoteModel3JsonUrl);
      console.log('✅ 依赖文件下载完成');
    } else {
      console.log('✅ 所有关键文件都存在，跳过依赖下载');
    }

    // 最终验证所有文件
    if (!this.validateModelFiles()) {
      throw new Error('模型文件验证失败');
    }

    // 只更新 path：isReady/isLoading 由 core stateChanged 同步
    this.modelState.path = localPath;
    this.notifyModelStateChange();
  }

  private syncModelStateFromCore(next: Live2DState) {
    const prevIsLoading = this.modelState.isLoading;

    this.modelState.isLoading = next.status === 'loading';
    this.modelState.isReady = next.status === 'ready';

    // idle/error 状态下清空 path（避免 RN View 继续持有旧模型）
    if (next.status === 'idle' || next.status === 'error') {
      this.modelState.path = undefined;
    }

    // 通知 loading 变化（保持旧回调契约）
    if (this.lastLoadingFlag === null || this.lastLoadingFlag !== this.modelState.isLoading) {
      this.lastLoadingFlag = this.modelState.isLoading;
      this.config.onLoadingStateChange?.(this.modelState.isLoading);
    } else if (prevIsLoading !== this.modelState.isLoading) {
      // 兜底：理论上不会走到这里
      this.config.onLoadingStateChange?.(this.modelState.isLoading);
    }

    this.notifyModelStateChange();
  }

  /**
   * 加载模型（会走跨平台 core：createLive2DService + native adapter）
   */
  async loadModel(): Promise<void> {
    if (this.modelState.isLoading) {
      console.log('⚠️ 模型正在加载中，跳过重复加载');
      return;
    }

    // 已就绪且文件完整：直接跳过
    if (this.modelState.isReady && this.modelState.path && this.validateModelFiles()) {
      console.log('✅ 模型已就绪，跳过重复加载');
      return;
    }

    const remoteModelUrl = this.config.modelUrl
      ?? `${this.modelBaseUrl}/${this.config.modelName}.model3.json`;
    try {
      await this.core.loadModel({ uri: remoteModelUrl, source: 'url', id: this.config.modelName });
    } catch (error) {
      console.error('❌ [Live2DService] loadModel failed:', error);
      this.config.onModelError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 卸载模型
   */
  unloadModel(): void {
    console.log('🔄 卸载模型');

    // core 会把 state 置回 idle；同时我们清空 path，触发 RN View 释放资源
    void this.core.unloadModel();
  }

  /**
   * 清理模型缓存
   */
  async clearModelCache(): Promise<void> {
    console.log('🧹 清理模型缓存');

    // 先卸载模型
    if (this.modelState.isReady) {
      this.unloadModel();
    }

    // 删除文件
    try {
      await removeDownloadedModel(`live2d/${this.config.modelName}/`);
      console.log('✅ 模型缓存已清理');
    } catch (error) {
      console.error('❌ 清理模型缓存失败:', error);
      throw error;
    }
  }

  /**
   * 播放动作
   */
  playMotion(motionGroup: string): void {
    console.log('🎬 播放动作:', motionGroup);
    void this.core.playMotion({ group: motionGroup } as MotionRef);
  }

  /**
   * 设置表情
   */
  setExpression(expression: string): void {
    console.log('😊 设置表情:', expression);
    void this.core.setExpression({ id: expression } as ExpressionRef);
  }

  /**
   * 设置缩放
   */
  setScale(scale: number): void {
    // 直接调用 native module，不走 setTransform → React 重渲染链路
    // 避免频繁缩放触发 live2dProps 重建导致模型闪烁
    try {
      if (typeof ReactNativeLive2dModule.setViewScale === 'function') {
        ReactNativeLive2dModule.setViewScale(scale);
      } else {
        // 仅首次打印警告，避免每帧重复
        if (!this.hasWarnedAboutSetViewScale) {
          console.warn('⚠️ [Live2DService] setViewScale is not a function, using fallback');
          this.hasWarnedAboutSetViewScale = true;
        }
        void this.core.setTransform({ scale } as Transform);
      }
    } catch (e) {
      // 仅首次打印错误，避免每帧重复
      if (!this.hasWarnedAboutSetViewScale) {
        console.error('❌ [Live2DService] setViewScale error:', e);
        this.hasWarnedAboutSetViewScale = true;
      }
      void this.core.setTransform({ scale } as Transform);
    }
    // 同步更新内部状态，供 getTransformState() 读取
    this.transformState.scale = scale;
  }

  /**
   * 设置位置
   */
  setPosition(x: number, y: number): void {
    // 直接调用 native module，不走 setTransform → React 重渲染链路
    // 避免每帧拖动触发 live2dProps 重建导致模型消失
    try {
      if (typeof ReactNativeLive2dModule.setViewPosition === 'function') {
        ReactNativeLive2dModule.setViewPosition(x, y);
        // 成功时不打印日志，避免拖动时每帧产生 log spam
      } else {
        // 仅首次打印警告，避免每帧重复
        if (!this.hasWarnedAboutSetViewPosition) {
          console.warn('⚠️ [Live2DService] setViewPosition is not a function, using fallback');
          this.hasWarnedAboutSetViewPosition = true;
        }
        // Fallback: 使用旧的 setTransform 方法
        void this.core.setTransform({ position: { x, y } } as Transform);
      }
    } catch (e) {
      // 仅首次打印错误，避免每帧重复
      if (!this.hasWarnedAboutSetViewPosition) {
        console.error('❌ [Live2DService] setViewPosition error:', e);
        this.hasWarnedAboutSetViewPosition = true;
      }
      // Fallback: 使用旧的 setTransform 方法
      void this.core.setTransform({ position: { x, y } } as Transform);
    }
    // 同步更新内部状态，供 getTransformState() 读取
    this.transformState.position = { x, y };
  }

  /**
   * 重置变换
   */
  resetTransform(): void {
    console.log('🔄 重置变换');
    void this.core.setTransform({ position: { x: 0, y: 0 }, scale: 0.8 } as Transform);
  }

  /**
   * 设置自动呼吸
   */
  setAutoBreath(enabled: boolean): void {
    console.log('💨 设置自动呼吸:', enabled);
    this.animationState.autoBreath = enabled;
    this.notifyAnimationStateChange();
  }

  /**
   * 设置自动眨眼
   */
  setAutoBlink(enabled: boolean): void {
    console.log('👁️ 设置自动眨眼:', enabled);
    this.animationState.autoBlink = enabled;
    this.notifyAnimationStateChange();
  }

  /**
   * 获取模型状态
   */
  getModelState(): ModelState {
    return { ...this.modelState };
  }

  /**
   * 获取变换状态
   */
  getTransformState(): TransformState {
    return {
      scale: this.transformState.scale,
      position: { ...this.transformState.position },
    };
  }

  /**
   * 获取动画状态
   */
  getAnimationState(): AnimationState {
    return { ...this.animationState };
  }

  /**
   * 获取 Live2D 视图属性
   */
  getViewProps(): Live2DViewProps {
    return {
      modelPath: this.modelState.isReady ? this.modelState.path : undefined,
      motionGroup: this.animationState.currentMotion,
      expression: this.animationState.currentExpression,
      scale: this.transformState.scale,
      position: this.transformState.position,
      autoBreath: this.animationState.autoBreath,
      autoBlink: this.animationState.autoBlink,
    };
  }

  /**
   * 是否已准备好
   */
  isReady(): boolean {
    return this.modelState.isReady;
  }

  /**
   * 是否正在加载
   */
  isLoading(): boolean {
    return this.modelState.isLoading;
  }

  /**
   * 通知模型状态变化
   */
  private notifyModelStateChange(): void {
    this.config.onModelStateChange?.({ ...this.modelState });
  }

  /**
   * 通知变换状态变化
   */
  private notifyTransformStateChange(): void {
    this.config.onTransformStateChange?.({
      scale: this.transformState.scale,
      position: { ...this.transformState.position },
    });
  }

  /**
   * 通知动画状态变化
   */
  private notifyAnimationStateChange(): void {
    this.config.onAnimationStateChange?.({ ...this.animationState });
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    console.log('🧹 Live2DService 销毁中...');

    // 先清空所有回调，防止 unloadModel/dispose 触发的异步状态事件
    // 污染新 service 的 React state（覆盖掉 useLive2D 的 reset）
    this.config.onModelStateChange = undefined;
    this.config.onLoadingStateChange = undefined;
    this.config.onTransformStateChange = undefined;
    this.config.onAnimationStateChange = undefined;
    this.config.onModelLoaded = undefined;
    this.config.onModelError = undefined;

    // 无论 isReady/isLoading 状态，都强制卸载，避免旧模型残留
    this.unloadModel();

    // 重置状态
    this.isInitialized = false;
    // best-effort dispose（包含 adapter.dispose + unloadModel）
    void this.core.dispose();

    console.log('✅ Live2DService 已销毁');
  }
}

