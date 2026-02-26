# Live2D 远端下载与角色切换联动

**核心原则：Live2D 模型与角色一一对应，切换角色必须同步切换模型。**

## 一、Live2D 远端下载机制

`Live2DService.loadModel()` 触发下载，流程：
1. 创建本地缓存目录 `{Paths.cache}/live2d/{modelName}/`
2. 下载 `model3.json`（已存在则跳过）
3. 验证关键文件（`model3.json` + `.moc3`），验证失败则并发下载所有依赖（Moc / Textures / Physics / Expressions / Motions）
4. 验证通过后更新 `modelState.path`

远端 URL 优先使用 `config.modelUrl`，未提供则自动拼接 `{host}:{port}/live2d/{modelName}/{modelName}.model3.json`。

## 二、角色切换架构

与主项目对齐：**API 调用只触发切换，UI 和模型更新统一由服务端广播的 `catgirl_switched` 消息驱动**。

```
用户点击切换 → API setCurrentCatgirl()
                      ↓
            服务端广播 catgirl_switched
                      ↓
            onMessage：更新 config、调用 syncLive2dModel()
                      ↓
            GET /api/characters/current_live2d_model → 获取模型路径
                      ↓
            setLive2dModel → useEffect 先 unload 再延帧 load
                      ↓
            useAudio 重连 WebSocket → onConnectionChange 收尾
```

启动时调用 `GET /api/characters/current_catgirl` 以服务端为准同步角色，并同步加载对应模型。

## 三、已修复的 Bug

**Bug 1：多个模型同时显示**
原因：`live2dModelName` 和 `live2dModelUrl` 是两个独立 state，两次 `setState` 触发两次 effect 重建，旧模型未及时清理。
修复：合并为单一对象 state，一次性更新，只触发一次 effect。

**Bug 2：旧模型残留 / 原生层未清理**
原因（JS）：`useLive2D` effect 重建时 `modelState` 不立即重置，旧 path 仍在；`destroy()` 只在 `isReady` 时才 unload，loading 中的旧模型不清理。
原因（原生）：`ReactNativeLive2dView.kt` 的 `releaseAllModel()` 被注释，新模型叠加在旧模型上渲染。
修复：effect 开头立即重置 state；`destroy()` 先清空所有回调再无条件 unload；恢复 `releaseAllModel()`。

**Bug 3：启动时模型与角色不匹配**
原因：`modelName` 和 `backendPort` 硬编码，不随角色和配置变化。
修复：改用动态 state 和 `config.port`。

**Bug 4：角色切换后模型不加载**
原因：`useFocusEffect` 只在失焦→聚焦时触发，页面已聚焦时切换角色不会重新触发。
修复：单独监听 `live2dModel` 变化，先 unload 再延一帧 load，确保原生层收到 `clearModel()` 后再加载新模型。

**Bug 5：启动时加载错误模型**
原因：`useFocusEffect` 在 mount 时立即触发，此时 `syncLive2dModel` 未完成，`url` 为 `undefined`，回退到自拼 URL 加载了默认模型。
修复：用 ref 持有最新 `live2dModel`，`useFocusEffect` 中 `url` 未就绪时跳过，等 `useEffect([live2dModel])` 在 sync 完成后触发。

## 四、关键文件

| 文件 | 改动 |
|------|------|
| `services/Live2DService.ts` | 增加 `modelUrl` 覆盖参数；`destroy()` 先清空回调再无条件 unload |
| `hooks/useLive2D.ts` | 透传 `modelUrl`；effect 重建时立即重置 state |
| `services/api/characters.ts` | 增加 `getCurrentLive2dModel()` 及相关类型 |
| `app/(tabs)/main.tsx` | `live2dModel` 合并 state + ref；`syncLive2dModel` helper；`useFocusEffect` 加 url guard；`useEffect([live2dModel])` 先 unload 再延帧 load |
| `ReactNativeLive2dView.kt` | 恢复 `manager.releaseAllModel()`，加载前先释放旧模型 |
