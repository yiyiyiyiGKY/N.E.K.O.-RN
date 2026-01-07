# N.E.K.O. - React Native

🐱 一个基于 React Native 和 Live2D 的虚拟角色交互应用

## 项目简介

N.E.K.O. (NEural Knowledge Oriented) 是一个创新的跨平台虚拟角色应用，集成了：

- 🎭 **Live2D 角色渲染** - 流畅的 2D 角色动画
- 🎤 **实时语音交互** - PCM 音频流处理
- 💬 **WebSocket 通信** - 低延迟实时对话
- 👄 **唇形同步** - 音频驱动的唇形动画
- 📱 **跨平台支持** - iOS / Android / Web

## 技术栈

- **框架**: React Native 0.81.4 + Expo 54
- **语言**: TypeScript
- **架构**: React New Architecture
- **路由**: Expo Router (文件路由)
- **文档**: [📚 规范文档中心 (SDD)](./docs/README.md)

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- Expo CLI
- 对于 iOS: Xcode 15+
- 对于 Android: Android Studio

### 安装依赖

```bash
npm install
```

### 运行项目

```bash
# 启动开发服务器
npx expo start

# Android
npx expo run:android

# iOS
npx expo run:ios

# Web
npx expo start --web
```

## 项目结构

```
├── app/              # 路由页面（Expo Router）
├── components/       # 可复用组件
├── hooks/           # React Hooks
├── services/        # 核心服务层
├── utils/           # 工具函数
├── assets/          # 静态资源
├── public/          # 公共资源
└── packages/        # 自定义原生模块（Submodules）
    ├── react-native-live2d/        # Live2D SDK 封装
    └── react-native-pcm-stream/    # PCM 音频流播放
```

## 核心功能模块

### Services
- `AudioService.ts` - 音频处理服务
- `Live2DService.ts` - Live2D 渲染服务
- `LipSyncService.ts` - 唇形同步服务
- `wsService.ts` - WebSocket 通信服务

### Hooks
- `useAudio` - 音频管理
- `useLive2D` - Live2D 控制
- `useLipSync` - 唇形同步
- `useChatMessages` - 聊天消息管理

## 开发

### 克隆项目

```bash
# 克隆包含 submodules
git clone --recurse-submodules https://github.com/Project-N-E-K-O/N.E.K.O.-RN.git

# 或者先克隆再初始化 submodules
git clone https://github.com/Project-N-E-K-O/N.E.K.O.-RN.git
cd N.E.K.O.-RN
git submodule init
git submodule update
```

### 构建

```bash
# Android
npm run android

# iOS
npm run ios
```

## License

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
