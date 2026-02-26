import PCMStream from "react-native-pcm-stream";
import { TinyEmitter } from "@project_neko/common";
import { SpeechInterruptController } from "../protocol";
import type { AudioService, AudioServiceEvents, AudioServiceState, NekoWsIncomingJson, RealtimeClientLike } from "../types";

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
      // 打断后屏蔽一段时间，防止缓冲区余音让 isPlaying 保持 true
      if (Date.now() < outputAmpMutedUntil) return;
      const amp = typeof event?.amplitude === "number" ? event.amplitude : 0;
      // onAmplitudeUpdate 来自 PCMStreamPlayer（播放振幅），应映射为 outputAmplitude
      emitter.emit("outputAmplitude", { amplitude: Math.max(0, Math.min(1, amp)) });
    });

    playbackStopSub = PCMStream.addListener("onPlaybackStop", () => {
      // 播放完成：输出 0，方便口型收嘴
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

      // 打断后静音期内丢弃麦克风数据，防止扬声器尾音被当作用户输入
      if (Date.now() < micMutedUntil) return;

      // 与旧版协议一致：stream_data + input_type=audio + data 为 number[]
      try {
        const int16 = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
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
    // 手动打断：丢弃后续飞来的 binary 音频帧，直到新一轮 audio_chunk 到来
    manualInterruptActive = true;
    // 打断后静音麦克风一段时间，避免扬声器尾音被录入
    micMutedUntil = Date.now() + MIC_MUTE_AFTER_INTERRUPT_MS;
    // 打断后屏蔽播放振幅事件，避免缓冲区余音让按钮消不掉
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

