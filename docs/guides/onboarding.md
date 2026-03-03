# 新成员上手指南

> 本文面向第一天加入的开发者，目标是让你在一天内跑起项目、看懂代码、提交第一个改动。

---

## 第一步：先搞清楚这个项目是什么

N.E.K.O.-RN 是一个 **React Native 移动端应用**，核心功能是：

- 手机上显示一个 Live2D 虚拟角色
- 用户可以**语音**或**文字**与角色对话
- 角色通过 AI 后端生成回复，以**语音**播放，同时驱动角色**口型同步**

它不是独立应用，它是主项目（`N.E.K.O.TONG`，后端 + Web 前端）的移动端客户端。两个项目通过 **WebSocket** 通信。

```
手机（本项目）  ←──WebSocket──→  AI 后端（主项目）
   录音 / 播放                    AI 推理 / TTS
   Live2D 渲染                    角色配置管理
```

---

## 第二步：环境准备

### 必须安装

| 工具 | 版本要求 | 验证命令 |
|------|---------|---------|
| Node.js | `>=20` | `node -v` |
| Android Studio | 最新版 | - |
| JDK | **17**（不能用其他版本） | `java -version` |
| adb | 随 Android Studio 安装 | `adb version` |

### Android SDK 配置

通过 Android Studio → Settings → Android SDK，确保勾选：

- **SDK Platforms**：Android 14（API 34）
- **SDK Tools**：Build-Tools 34、Platform-Tools、Command-line Tools

完整步骤：[android-env-macos.md](./android-env-macos.md)

### 环境变量（写入 `~/.zshrc`）

```bash
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$PATH:$ANDROID_SDK_ROOT/platform-tools"
export PATH="$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin"
export PATH="$PATH:$ANDROID_SDK_ROOT/emulator"
```

写完记得 `source ~/.zshrc`。

---

## 第三步：把项目跑起来

### 3.1 克隆（submodule 必须一起拉）

```bash
git clone --recurse-submodules <仓库地址> -b RN
cd N.E.K.O.-RN
```

> ⚠️ **`--recurse-submodules` 非常关键。**
> `packages/react-native-pcm-stream` 和 `packages/react-native-live2d` 是 git submodule，
> 不带这个参数克隆下来是**空目录**，编译会直接报错。

如果已经克隆但忘了带该参数，补跑：

```bash
git submodule update --init --recursive
```

克隆完成后，验证 pcm-stream 在正确的分支：

```bash
git -C packages/react-native-pcm-stream branch
# 应该显示 * fix-audio-echo
```

如果显示的不是 `fix-audio-echo`，手动切：

```bash
git -C packages/react-native-pcm-stream checkout fix-audio-echo
```

### 3.2 安装依赖

```bash
npm install
```

### 3.3 生成原生工程（首次必做，之后改原生代码时重做）

```bash
npx expo prebuild --platform android --clean
npm install   # prebuild 后再装一次，确保原生依赖同步
```

> 这一步会生成 `android/` 目录（包含 Gradle 工程）。

### 3.4 本地编译 APK

```bash
cd android
./gradlew assembleDebug
cd ..
```

APK 输出在：`android/app/build/outputs/apk/debug/app-debug.apk`

安装到手机：

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

或者直接用项目脚本（会自动卸载旧版再装）：

```bash
bash scripts/install-apk.sh
```

### 3.5 日常开发（无需重新编译 APK）

```bash
# 启动 Metro 开发服务器
npm start
```

手机打开刚安装的 N.E.K.O. App → 扫码 → 连接成功。

之后改 TypeScript/JavaScript 代码，**保存即生效**，无需重新编译 APK。

### 3.6 何时需要重新编译 APK

| 需要重新编译 | 不需要 |
|------------|-------|
| 修改 `android/` 原生代码（Kotlin） | 修改 `app/`、`components/`、`hooks/` |
| 修改 `packages/react-native-*`（原生模块） | 修改 `packages/project-neko-*`（纯 JS 包） |
| `package.json` 新增原生依赖 | 修改 `services/`、`utils/` |
| 修改 `app.config.ts` | 修改样式文件 |

重新编译（不需要重新 prebuild）：

```bash
cd android && ./gradlew assembleDebug && cd ..
bash scripts/install-apk.sh
```

如果遇到奇怪的编译问题，用完整重建脚本（清缓存 + 重编 + 装机）：

```bash
bash scripts/force-rebuild.sh
```

---

## 第四步：搞懂项目结构

### 目录地图

```
N.E.K.O.-RN/
│
├── app/                        # 页面路由（Expo Router，按文件路由）
│   ├── (tabs)/
│   │   ├── main.tsx            # ⭐ 主界面（Live2D + 语音聊天）
│   │   └── settings.tsx        # 设置页
│   ├── audio-test.tsx          # 音频调试页
│   └── qr-scanner.tsx          # 扫码连接
│
├── components/                 # 本项目专属 UI 组件
├── hooks/                      # React Hooks
│   ├── useAudio.ts             # ⭐ 语音功能入口
│   └── useLipSync.ts           # 口型同步
│
├── services/                   # 核心服务（非 React）
│   ├── AudioService.ts         # 语音会话管理
│   ├── wsService.ts            # ⭐ WebSocket 连接
│   └── android.pcmstream.native.ts  # Android 录音/播放底层
│
├── utils/
│   └── MainManager.ts          # ⭐ 主协调层（连接 Audio + Live2D）
│
├── android/                    # 原生 Android 工程（由 prebuild 生成，不要手改）
│
└── packages/                   # 内部包（部分是 git submodule）
    ├── project-neko-audio-service/   # ⭐ 语音会话核心逻辑
    │   └── src/
    │       ├── native/audioServiceNative.ts  # Android 语音服务
    │       └── protocol.ts                   # 打断状态机
    ├── project-neko-components/      # 跨平台 UI 组件库
    ├── project-neko-realtime/        # WebSocket 封装
    ├── react-native-live2d/          # Live2D 原生模块（submodule → main）
    └── react-native-pcm-stream/      # 音频原生模块（submodule → fix-audio-echo）
```

### 数据流：一次语音对话的完整链路

```
用户说话
  → PCMStream（原生）采集麦克风 PCM 数据
  → audioServiceNative.ts 监听 onAudioFrame
  → 通过 WebSocket 发送 { action: "stream_data", data: [...] }
  → AI 后端处理，返回文字 + 音频

AI 回复
  → WebSocket 收到二进制 PCM 数据
  → audioServiceNative.ts 调用 PCMStream.playPCMChunk()
  → 原生层播放音频，同时触发 onAmplitudeUpdate
  → useLipSync 读取振幅 → 驱动 Live2D 口型
```

---

## 第五步：开发前必读的三个文件

### 1. `packages/project-neko-audio-service/src/native/audioServiceNative.ts`

语音功能的核心。理解这个文件你就理解了 80% 的语音逻辑：
- `handleIncomingJson`：处理服务端的各类消息（session_started / user_activity / audio_chunk）
- `handleIncomingBinary`：接收并播放服务端下发的音频
- `startVoiceSession` / `stopVoiceSession`：语音会话生命周期

### 2. `services/wsService.ts`

WebSocket 连接管理。改连接逻辑看这里。

### 3. `utils/MainManager.ts`

主界面的协调层，把 Audio 服务和 Live2D 服务连接在一起。`onUserSpeechDetected`、`onGeminiResponse`、`onTurnEnd` 等事件都在这里分发。

---

## 第六步：项目当前状态

### 已完成（可以直接用）

- Live2D 角色加载、点击交互、口型同步
- 语音录音 → 发送 → 接收 → 播放完整链路
- 文字聊天
- WebSocket 自动重连、心跳保活
- QR 扫码快速连接后端

### 正在修复（P0，阻塞内测）

- **语音打断 bug**：AI 说话时打断后有音频残留，麦克风存在死锁问题
  - 设计文档：[specs/voice-interrupt.md](../specs/voice-interrupt.md)

### 接下来要做

- 角色切换（轻量选择器）
- 图片发送（相册 + 拍照）
- 后台音频（切 App 不断话）

---

## 第七步：常用开发命令

```bash
# 日常启动开发服务器
npm start

# 清缓存启动（遇到奇怪问题先试这个）
npx expo start --dev-client --clear

# 本地编译 APK
cd android && ./gradlew assembleDebug && cd ..

# 编译 + 安装一步完成
cd android && ./gradlew assembleDebug && cd .. && bash scripts/install-apk.sh

# 完整重建（清缓存 + 重编 + 装机）
bash scripts/force-rebuild.sh

# 类型检查（提交前跑一下）
npm run typecheck

# 同步主项目的 packages（有上游更新时用）
npm run sync:neko-packages
```

---

## 第八步：连接后端

开发时需要连接 AI 后端（主项目）才能测试完整功能。

**方式 1：扫码连接**（推荐）
- 后端启动后会生成一个 QR 码
- App 进入 QR 扫码页面，扫码后自动配置 host/port/角色名

**方式 2：手动配置**
- 进入 Settings 页面，填写：
  - Host：后端机器的 IP 地址（和手机在同一局域网）
  - Port：默认 `8000`
  - Character Name：角色标识符

> 确保手机和后端机器在同一个 WiFi 下。

---

## 常见问题

### Q：克隆后编译报找不到原生模块？

十有八九是 submodule 没拉下来：

```bash
git submodule update --init --recursive
# 验证
git -C packages/react-native-pcm-stream branch
# 应显示 * fix-audio-echo
```

### Q：音频有问题（播放异常 / 截断 / 回声）？

确认 `react-native-pcm-stream` 在 `fix-audio-echo` 分支，这个分支包含关键音频修复：

```bash
git -C packages/react-native-pcm-stream log --oneline -3
# 第一行应该是 fix: 修复 AI 语音最后几个字被截断并误识别为用户输入的问题
```

如果不是，切过去再重新编译 APK：

```bash
git -C packages/react-native-pcm-stream checkout fix-audio-echo
cd android && ./gradlew assembleDebug && cd ..
bash scripts/install-apk.sh
```

### Q：Metro 报找不到模块？

```bash
npx expo prebuild --platform android --clean
npm install
```

### Q：修改了 `packages/react-native-*` 下的原生代码没生效？

原生模块需要重新编译 APK：

```bash
cd android && ./gradlew assembleDebug && cd ..
bash scripts/install-apk.sh
```

### Q：手机扫码后连不上开发服务器？

1. 手机和电脑必须在同一 WiFi
2. 检查系统防火墙是否放通 8081 端口
3. 换 tunnel 模式：`npx expo start --dev-client --tunnel`

### Q：Gradle 编译报 JDK 版本错误？

必须用 JDK 17，检查：

```bash
java -version   # 应显示 17.x
```

如果不是，在 Android Studio → Settings → Build Tools → Gradle → Gradle JDK 里切换到 17。

---

## 延伸阅读

根据你负责的方向，重点阅读：

| 方向 | 必读文档 |
|------|---------|
| 语音功能 | [specs/websocket.md](../specs/websocket.md)、[specs/voice-interrupt.md](../specs/voice-interrupt.md) |
| UI / 组件 | [strategy/cross-platform-components.md](../strategy/cross-platform-components.md) |
| 环境 / 构建 | [guides/android-env-macos.md](./android-env-macos.md)、[guides/upstream-sync.md](./upstream-sync.md) |
| 整体架构 | [arch/design.md](../arch/design.md) |
| 问题排查 | [troubleshooting/](../troubleshooting/) |
