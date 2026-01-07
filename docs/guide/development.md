# 开发与入门指南 (Get Started & Dev Guide)

本文档旨在帮助开发者快速搭建 N.E.K.O.-RN 的环境并开始开发。

## 1. 代码拉取 (Cloning)

由于项目包含自研原生模块子模块，请务必使用 `--recurse-submodules` 进行克隆：

```bash
# 克隆主项目及其所有子模块
git clone --recurse-submodules https://github.com/Project-N-E-K-O/N.E.K.O.-RN.git

# 如果已经克隆了但没有加载子模块，请运行：
git submodule update --init --recursive
```

## 2. 环境准备 (Environment)

### 2.1 基础环境
- **Node.js**: v18.0 或更高（建议 v20+）。
- **包管理器**: `npm` (项目使用 `package-lock.json`)。
- **Expo CLI**: `npm install -g expo-cli` (虽然现在通常使用 `npx expo`)。

### 2.2 Android 开发环境
- **Android Studio**: 安装最新版本。
- **Android SDK**: 确保安装了 API 34+。
- **Java (JDK)**: **JDK 17** (React Native 0.73+ 的强制要求)。建议使用 SDKMAN 或 Homebrew 安装。
- **环境变量**: 确保 `ANDROID_HOME` 和 `JAVA_HOME` 已正确配置。

```bash
# macOS 示例 ~/.zshrc
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

## 3. 项目初始化 (Initialization)

```bash
# 安装依赖
npm install

# (仅 iOS) 安装 CocoaPods
# cd ios && pod install && cd ..
```

## 4. 构建与运行 (Build & Run)

### 4.1 Android 构建运行
本项目依赖原生模块，因此不能使用 Expo Go，必须进行原生构建（创建 Development Build）：

```bash
# 启动 Android 构建（会自动安装到连接的设备或模拟器）
npx expo run:android

# 或者使用 npm 脚本
npm run android
```

### 4.2 iOS 构建运行 (需 Mac)
```bash
npx expo run:ios
```

## 5. 真机调试 (Real-Device Debugging)

由于我们需要原生音频流和 Live2D 性能支持，**真机调试是推荐且必须的方案**。

### 5.1 使用 Development Build (Dev Client)
1. 确保手机与电脑在 **同一局域网**。
2. 运行 `npx expo start` 启动开发服务器。
3. 如果尚未安装，首次构建时运行 `npx expo run:android` 会将一个名为 `neko-rn` 的开发端安装到手机。
4. 打开手机上的 App，扫描终端输出的二维码。

### 5.2 网络配置 (关键)
目前音频服务和模型下载依赖局域网通信：
- 修改 `app/(tabs)/main.tsx` 中的 `host` 为你电脑的 **局域网 IP**。
- 确保电脑防火墙允许 48911 (WS) 和 8081 (HTTP) 端口通过。

## 6. 开发辅助页面
- `/pcmstream-test`: 用于单独测试原生音频流录制与播放。
- `/qr-scanner`: 专门用于配置服务器地址的扫码实验室。

---

## 7. 验收清单 (Checklist)
1. **录音校验**：使用 `pcmstream-test.tsx` 页面确认 16kHz 采样是否有噪音。
2. **打断校验**：在 AI 说话时大声出声，Live2D 画面应立即刷新且声音停止。
3. **加载校验**：模型下载成功后应有本地缓存，二次加载应为秒开。

---

## 8. 附录：常用指令
- `npm start`: 启动 Metro Bundler。
- `npm run clean`: 清除缓存并重置项目（由 `react-native-clean-project` 提供）。
- `npx expo install <package>`: 使用 Expo 兼容版本安装包。
