import PCMStream from "react-native-pcm-stream";
import { TinyEmitter } from "@project_neko/common";
import { SpeechInterruptController } from "../protocol";
import type { AudioService, AudioServiceEvents, AudioServiceState, NekoWsIncomingJson, RealtimeClientLike } from "../types";

/** 简单 VAD：基于 RMS 振幅 + 防抖，适用于 React Native */
function calcRMS(int16: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < int16.length; i++) sum += (int16[i] / 32768) ** 2;
  return Math.sqrt(sum / int16.length);
}

interface SimpleVADState {
  isSpeaking: boolean;
  consecutiveSpeechFrames: number;
  consecutiveSilenceFrames: number;
}

function createSimpleVAD(opts: {
  speechThreshold?: number;      // RMS 超过此值认为有语音，默认 0.02
  silenceThreshold?: number;     // RMS 低于此值认为静音，默认 0.01
  minSpeechFrames?: number;      // 连续多少帧才确认语音开始，默认 2
  silenceFrames?: number;        // 连续多少帧静音才确认语音结束，默认 8
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}) {
  let speechThreshold = opts.speechThreshold ?? 0.02;
  let silenceThreshold = opts.silenceThreshold ?? 0.01;
  const minSpeechFrames = opts.minSpeechFrames ?? 2;
  const silenceFrames = opts.silenceFrames ?? 8;

  const state: SimpleVADState = {
    isSpeaking: false,
    consecutiveSpeechFrames: 0,
    consecutiveSilenceFrames: 0,
  };

  function processFrame(int16: Int16Array): boolean {
    const rms = calcRMS(int16);
    if (rms >= speechThreshold) {
      state.consecutiveSpeechFrames++;
      state.consecutiveSilenceFrames = 0;
      if (!state.isSpeaking && state.consecutiveSpeechFrames >= minSpeechFrames) {
        state.isSpeaking = true;
        opts.onSpeechStart?.();
      }
    } else if (rms < silenceThreshold) {
      state.consecutiveSilenceFrames++;
      state.consecutiveSpeechFrames = 0;
      if (state.isSpeaking && state.consecutiveSilenceFrames >= silenceFrames) {
        state.isSpeaking = false;
        opts.onSpeechEnd?.();
      }
    }
    return state.isSpeaking;
  }

  function reset() {
    state.isSpeaking = false;
    state.consecutiveSpeechFrames = 0;
    state.consecutiveSilenceFrames = 0;
  }

  function updateThreshold(threshold: number) {
    speechThreshold = threshold;
    silenceThreshold = threshold * 0.75;
  }

  return { processFrame, reset, updateThreshold, getState: () => ({ ...state }) };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  if (!ms || ms <= 0) return p;
  let timer: any = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function createNativeAudioService(args: {
  client: RealtimeClientLike;
  /**
   * 录音：原生采样率（默认 48000），并由 native module 重采样到 targetRate（默认 16000）
   */
  recordSampleRate?: number;
  recordFrameSize?: number;
  recordTargetRate?: number;
  /**
   * 播放：PCM 采样率（默认 48000）
   */
  playbackSampleRate?: number;
}): AudioService & { on: TinyEmitter<AudioServiceEvents>["on"]; getState: () => AudioServiceState } {
  const emitter = new TinyEmitter<AudioServiceEvents>();
  const interrupt = new SpeechInterruptController();

  // 当前是否正在播放（用于 VAD 门控）
  let isPlaying = false;
  // 动态回声校准
  const CALIBRATION_FRAMES = 10;       // 校准帧数（约 320ms）
  const ECHO_GATE_MULTIPLIER = 1.8;    // 阈值 = 回声均值 × 此倍数
  let calibrationFrames: number[] = [];
  let calibratedThreshold = 0.08;      // 初始默认值

  // 客户端 VAD：过滤回声，只有真正的人声才发给服务器
  const vad = createSimpleVAD({
    speechThreshold: 0.08,
    silenceThreshold: 0.06,
    minSpeechFrames: 2,
    silenceFrames: 6,
    onSpeechStart: () => {
      // 检测到人声立即停止播放，不等服务器 user_activity，消除网络往返延迟
      if (isPlaying) {
        try { PCMStream.stopPlayback(); } catch (_e) {}
        isPlaying = false;
        outputAmpMutedUntil = Date.now() + OUTPUT_AMP_MUTE_AFTER_INTERRUPT_MS;
        emitter.emit("outputAmplitude", { amplitude: 0 });
      }
    },
  });

  let state: AudioServiceState = "idle";
  const setState = (next: AudioServiceState) => {
    if (state === next) return;
    state = next;
    emitter.emit("state", { state: next });
  };

  let offs: (() => void)[] = [];
  let audioFrameSub: { remove: () => void } | null = null;
  let ampSub: { remove: () => void } | null = null;
  let playbackStopSub: { remove: () => void } | null = null;
  let errorSub: { remove: () => void } | null = null;

  let sessionResolver: (() => void) | null = null;
  let recordingReject: ((error: Error) => void) | null = null;
  // 打断后短暂静音：避免扬声器末尾声音被麦克风回收为用户输入
  let micMutedUntil = 0;
  const MIC_MUTE_AFTER_INTERRUPT_MS = 600;
  // 打断后屏蔽 onAmplitudeUpdate：避免缓冲区排空时的余音让按钮消不掉
  let outputAmpMutedUntil = 0;
  const OUTPUT_AMP_MUTE_AFTER_INTERRUPT_MS = 200;
  // 用户手动打断后丢弃后续 binary 帧，直到新一轮 audio_chunk 到来
  let manualInterruptActive = false;

  /** 播放振幅 + 播放停止：attach() 时就挂载，确保 isPlaying 状态正确 */
  const attachPlaybackListeners = () => {
    if (ampSub) return;

    ampSub = PCMStream.addListener("onAmplitudeUpdate", (event: any) => {
      if (Date.now() < outputAmpMutedUntil) return;
      const amp = typeof event?.amplitude === "number" ? event.amplitude : 0;
      if (!isPlaying && amp > 0.01) {
        // 播放刚开始，重置校准
        isPlaying = true;
        calibrationFrames = [];
      }
      isPlaying = amp > 0.01;
      emitter.emit("outputAmplitude", { amplitude: Math.max(0, Math.min(1, amp)) });
    });

    playbackStopSub = PCMStream.addListener("onPlaybackStop", () => {
      isPlaying = false;
      calibrationFrames = [];
      vad.reset();
      emitter.emit("outputAmplitude", { amplitude: 0 });
    });
  };

  /** 录音相关：仅在 startVoiceSession 时挂载 */
  const attachRecordingListeners = () => {
    if (audioFrameSub) return;

    // 🔥 监听原生层错误
    errorSub = PCMStream.addListener("onError", (event: any) => {
      const message = event?.message || "Unknown native error";
      console.error("❌ Native PCMStream error:", message);
      if (recordingReject) {
        const reject = recordingReject;
        recordingReject = null;
        reject(new Error(message));
      }
    });

    audioFrameSub = PCMStream.addListener("onAudioFrame", (event: any) => {
      const pcm: Uint8Array | undefined = event?.pcm;
      if (!pcm) return;

      // 打断后静音期内丢弃麦克风数据
      if (Date.now() < micMutedUntil) return;

      const int16 = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));

      // 播放时前 N 帧用于校准回声阈值，不发送
      if (isPlaying && calibrationFrames.length < CALIBRATION_FRAMES) {
        calibrationFrames.push(calcRMS(int16));
        if (calibrationFrames.length === CALIBRATION_FRAMES) {
          const avg = calibrationFrames.reduce((a, b) => a + b, 0) / CALIBRATION_FRAMES;
          calibratedThreshold = Math.max(0.04, avg * ECHO_GATE_MULTIPLIER);
          vad.updateThreshold(calibratedThreshold);
          console.log(`🎚️ 回声校准完成: 均值=${avg.toFixed(4)} 阈值=${calibratedThreshold.toFixed(4)}`);
        }
        return;
      }

      // 客户端 VAD 门控：播放时只有检测到真实人声才发送，过滤回声
      const isSpeaking = vad.processFrame(int16);
      if (isPlaying && !isSpeaking) return;

      try {
        args.client.sendJson({
          action: "stream_data",
          data: Array.from(int16 as any),
          input_type: "audio",
        });
      } catch (_e) {
        // ignore
      }
    });
  };

  const detachPlaybackListeners = () => {
    try {
      ampSub?.remove();
    } catch (_e) {}
    try {
      playbackStopSub?.remove();
    } catch (_e) {}
    ampSub = null;
    playbackStopSub = null;
  };

  const detachRecordingListeners = () => {
    try {
      audioFrameSub?.remove();
    } catch (_e) {}
    try {
      errorSub?.remove();
    } catch (_e) {}
    audioFrameSub = null;
    errorSub = null;
  };

  const handleIncomingJson = (json: NekoWsIncomingJson) => {
    if (!json || typeof json !== "object") return;
    if ((json as any).type === "session_started") {
      if (sessionResolver) {
        const r = sessionResolver;
        sessionResolver = null;
        r();
      }
      return;
    }
    if ((json as any).type === "user_activity") {
      interrupt.onUserActivity((json as any).interrupted_speech_id);
      stopPlayback();
      return;
    }
    if ((json as any).type === "audio_chunk") {
      interrupt.onAudioChunk((json as any).speech_id);
      // 新一轮语音到来，解除手动打断的屏蔽
      manualInterruptActive = false;
      return;
    }
  };

  const handleIncomingBinary = (data: unknown) => {
    if (interrupt.getSkipNextBinary()) return;
    if (manualInterruptActive) return;

    // Native 侧优先假设服务端下发 PCM16（ArrayBuffer/Uint8Array）
    try {
      const playbackSampleRate = args.playbackSampleRate ?? 48000;
      PCMStream.initPlayer(playbackSampleRate);

      if (data instanceof ArrayBuffer) {
        PCMStream.playPCMChunk(new Uint8Array(data));
        return;
      }
      if (data instanceof Uint8Array) {
        PCMStream.playPCMChunk(data);
        return;
      }
      const anyData: any = data as any;
      if (anyData && anyData.buffer instanceof ArrayBuffer && typeof anyData.byteLength === "number") {
        PCMStream.playPCMChunk(new Uint8Array(anyData.buffer, anyData.byteOffset || 0, anyData.byteLength));
      }
    } catch (_e) {
      // ignore
    }
  };

  const attach = () => {
    if (offs.length) return;
    setState("ready");

    attachPlaybackListeners();

    offs = [
      args.client.on("json", ({ json }) => handleIncomingJson(json as any)),
      args.client.on("binary", ({ data }) => handleIncomingBinary(data)),
    ];
  };

  const detach = () => {
    for (const off of offs) {
      try {
        off();
      } catch (_e) {}
    }
    offs = [];
    sessionResolver = null;
    manualInterruptActive = false;
    interrupt.reset();
    detachRecordingListeners();
    detachPlaybackListeners();
    try {
      PCMStream.stopRecording();
    } catch (_e) {}
    try {
      PCMStream.stopPlayback();
    } catch (_e) {}
    setState("idle");
  };

  const waitSessionStarted = (timeoutMs: number) => {
    return withTimeout(
      new Promise<void>((resolve) => {
        sessionResolver = resolve;
      }),
      timeoutMs,
      `Session start timeout after ${timeoutMs}ms`
    );
  };

  const startVoiceSession: AudioService["startVoiceSession"] = async (opts) => {
    attach();
    setState("starting");

    const timeoutMs = opts?.timeoutMs ?? 10_000;
    attachRecordingListeners();

    return new Promise<void>((resolve, reject) => {
      // 设置录音错误拒绝器
      recordingReject = reject;

      const cleanup = () => {
        recordingReject = null;
      };

      // 超时处理
      const timeoutId = setTimeout(() => {
        cleanup();
        const error = new Error(`Session start timeout after ${timeoutMs}ms`);
        setState("error");
        reject(error);
      }, timeoutMs);

      // 会话启动成功回调
      const sessionP = waitSessionStarted(timeoutMs);

      sessionP.then(() => {
        clearTimeout(timeoutId);
        cleanup();

        try {
          // 🔥 修复：让 PCMStream.startRecording 的错误通过 Promise 捕获
          // 原生层会通过 onError 事件发送错误，我们在 attachRecordingListeners 中处理
          PCMStream.startRecording(
            args.recordSampleRate ?? 48000,
            args.recordFrameSize ?? 1536,
            args.recordTargetRate ?? 16000
          );

          setState("recording");
          resolve();
        } catch (e) {
          cleanup();
          setState("error");
          reject(e);
        }
      }).catch((error) => {
        clearTimeout(timeoutId);
        cleanup();
        setState("error");
        reject(error);
      });

      // 发送启动会话请求
      try {
        args.client.sendJson({ action: "start_session", input_type: "audio", audio_format: "PCM_48000HZ_MONO_16BIT" });
      } catch (e) {
        clearTimeout(timeoutId);
        cleanup();
        setState("error");
        reject(e);
      }
    });
  };

  const stopVoiceSession: AudioService["stopVoiceSession"] = async () => {
    setState("stopping");
    try {
      PCMStream.stopRecording();
    } catch (_e) {}
    try {
      args.client.sendJson({ action: "pause_session" });
    } catch (_e) {}
    setState("ready");
  };

  const stopPlayback: AudioService["stopPlayback"] = () => {
    try {
      PCMStream.stopPlayback();
    } catch (_e) {}
    isPlaying = false;
    calibrationFrames = [];
    vad.reset();
    manualInterruptActive = true;
    micMutedUntil = Date.now() + MIC_MUTE_AFTER_INTERRUPT_MS;
    outputAmpMutedUntil = Date.now() + OUTPUT_AMP_MUTE_AFTER_INTERRUPT_MS;
    emitter.emit("outputAmplitude", { amplitude: 0 });
  };

  return {
    attach,
    detach,
    startVoiceSession,
    stopVoiceSession,
    stopPlayback,
    on: emitter.on.bind(emitter),
    getState: () => state,
  };
}

