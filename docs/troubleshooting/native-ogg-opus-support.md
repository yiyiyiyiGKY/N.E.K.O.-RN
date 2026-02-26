# Native 端 OGG/OPUS 音频支持

## 问题

服务端自定义语音通过 WebSocket 下发 OGG/OPUS 格式音频。Web 端能正常播放，RN 端不行。

原因：Web 端有格式检测（`isOggOpus()` 检查 "OggS" 魔数）+ WASM 解码器，Native 端直接把所有数据当 PCM16 播放，没有任何格式判断。

默认 AI 语音（PCM 格式）不受影响。

## 解决方案

| 方案 | 难度 | 改动幅度 | 涉及文件 | 风险 |
|------|------|---------|---------|------|
| A. 服务端格式协商 | 低~中 | 服务端按客户端类型选择格式，需改会话协商 + TTS worker | `websocket_router.py`、`tts_client.py`、`core.py` | 低 |
| B. Android 原生解码 | 中 | Android 原生层新增 ~200 行 Kotlin | `PCMStreamModule.kt`、`PCMStreamPlayer.kt` | 中 |

### A. 服务端格式协商（短期推荐）

客户端建立会话时声明支持的音频格式，服务端按需选择 TTS 输出格式。Web 端继续用 OGG/OPUS（压缩率高），RN 端用 PCM（原生支持）。

**不能直接全局改成 PCM**：Web 端依赖 OGG/OPUS 的压缩优势，全局改 PCM 会导致 Web 端带宽增大约 10 倍。

**实现方式**：

数据流：`WebSocket message → websocket_router.py → core.py start_session → tts_client.py worker → SpeechSynthesizer`

需要改 3 个文件，所有改动都以 OGG/OPUS 为默认值，Web 端不传参数时行为完全不变：

1. `websocket_router.py`（约 1 行）：从 `start_session` 消息中提取 `audio_format`，传给 `start_session()`
2. `core.py`（约 3 行）：`start_session()` 接收 `audio_format` 参数，存到 `self.audio_format`，传给 TTS worker 线程
3. `tts_client.py`（约 5 行）：`cosyvoice_vc_tts_worker()` 接收 `audio_format` 参数，替换两处硬编码的 `AudioFormat.OGG_OPUS_48KHZ_MONO_64KBPS`（776 行和 807 行）

`core.py` 的 `send_speech()` 不需要改，它只负责发 bytes，不关心格式。

**安全性保证**：
- 默认值为 `OGG_OPUS_48KHZ_MONO_64KBPS`，与当前行为一致
- Web 端不传 `audio_format` → 走默认值 → 行为完全不变
- 只有 RN 端显式传 `"pcm16"` 时才切换格式

### A 方案已实施的改动

**RN 客户端**（2 个文件）：
- `types.ts`：`start_session` 类型加 `audio_format?: string` 可选字段
- `audioServiceNative.ts:280`：发送 `audio_format: "PCM_48000HZ_MONO_16BIT"`

**服务端**（3 个文件）：
- `websocket_router.py:102`：提取 `audio_format` 参数，传给 `start_session()`
- `core.py:720`：签名加 `audio_format=None`，存到 `self.audio_format`，传给 `get_tts_worker()`
- `tts_client.py`：
  - `get_tts_worker()` 加 `audio_format` 参数，用 `partial` 绑定给 cosyvoice worker
  - `cosyvoice_vc_tts_worker()` 加 `audio_format` 参数，用 `getattr(AudioFormat, audio_format)` 解析枚举名
  - 两处 `SpeechSynthesizer` 创建改为使用解析后的格式变量

### B. Android 原生层解码（中期）

在 `PCMStreamModule.kt` 中加格式检测，用 Android `MediaCodec` 原生解码 OPUS（无需第三方库）。

- 改动集中在 `PCMStreamModule.kt` 和 `PCMStreamPlayer.kt`，新增约 200 行
- 主要工作量在 OGG 容器解析（提取 OPUS 帧）+ MediaCodec 解码管线搭建
- 现有 Android 模块基础完善（状态管理、振幅追踪、回声消除），扩展自然
- 需要充分测试不同采样率、不同 chunk 大小的边界情况

## 潜在问题

- 解码后采样率可能与播放器配置不一致，需动态调整或重采样
- OGG/OPUS 解压后数据量约 10 倍，应流式解码避免内存累积
- 解码失败时应静默跳过该 chunk，不影响后续播放

## 相关文件

| 文件 | 说明 |
|------|------|
| `packages/project-neko-audio-service/src/native/audioServiceNative.ts` | Native 端音频服务（需修改） |
| `packages/project-neko-audio-service/src/web/player.ts` | Web 端播放器（参考实现） |
| `packages/project-neko-audio-service/src/web/oggOpusGlobalDecoder.ts` | WASM 解码器封装 |
| `packages/react-native-pcm-stream/android/.../PCMStreamModule.kt` | Android 原生模块 |
| `packages/react-native-pcm-stream/android/.../PCMStreamPlayer.kt` | Android 播放器 |
| `N.E.K.O.TONG/main_logic/tts_client.py` | TTS 工作线程，CosyVoice 格式配置在约 776 行 |
| `N.E.K.O.TONG/main_routers/websocket_router.py` | WebSocket 会话管理 |
| `N.E.K.O.TONG/main_logic/core.py` | `send_speech()` 二进制音频发送 |
