---
description: 提交前代码审查。检查 staged 变更的质量、架构规范、RN 最佳实践，输出问题列表。在 /commit 前运行以保证代码质量。
---

# /review — 提交前代码审查

对即将提交的变更做系统性检查，避免把问题带入 commit 历史。

## 执行步骤

### 1. 收集变更上下文

```bash
git status                   # 查看 staged / unstaged 文件列表
git diff --staged            # 分析 staged 变更内容
git diff                     # 确认是否有未暂存的相关变更
```

### 2. 运行 Lint

```bash
npx expo lint
```

如有错误，先列出并说明修复方向，再继续后续检查。

### 3. 逐项检查

对每个 staged 文件按下列维度审查，只报告**实际存在的问题**，没有问题的维度跳过。

#### A. TypeScript 类型安全
- 有无 `any` 类型滥用（尤其是 API 响应、事件回调）
- 有无缺失 `undefined` / `null` 处理
- 泛型使用是否合理

#### B. React Native 最佳实践
- StyleSheet 是否在组件外定义（避免每次渲染重建对象）
- 平台差异处理：`Platform.OS` 分支、`.android.tsx` / `.ios.tsx` 文件分离
- `FlatList` 是否提供 `keyExtractor`；长列表是否启用 `getItemLayout`
- 异步操作是否在组件卸载后有 cleanup（防止 `setState` on unmounted）
- 图片资源是否使用 `require()` 而非网络 URI 直接展示静态资产

#### C. 项目架构规范（`docs/arch/design.md`）
- **Service 层**（`services/`）：不得直接依赖 React 组件生命周期；纯 TS Class，无 hooks 调用
- **Hook 桥接层**（`hooks/`）：不得包含业务逻辑，只做事件→状态映射
- **Manager 单例**（MainManager）：跨 Service 协调逻辑统一放在 Manager，不散落到 UI 层
- `components/` 不应直接 import Service 实例，应通过 Hook 消费

#### D. 包依赖边界
- `@project_neko/*` 内部包的修改是否需要同步运行 `npm run sync:neko-packages`
- 有无引入新的外部依赖但未更新 `package.json`

#### E. 遗漏项
- 修改了功能但没有更新对应的 `docs/` 文档
- 有无调试用的 `console.log` / `TODO` 未清理
- 新增文件是否加入了正确的 TypeScript path alias

### 4. 输出格式

```
## 审查结果

### Lint
✅ 无错误  /  ❌ N 个错误（列出文件和行号）

### 问题列表

🔴 [严重] services/AudioService.ts:42
   直接在 Service 内调用了 useState，违反 Service 层规范
   建议：将状态提升到 useAudio hook

🟡 [警告] components/VoiceButton.tsx:18
   StyleSheet 定义在组件函数内部，每次渲染会重建
   建议：移到组件外顶层定义

🔵 [建议] hooks/useLive2D.ts:95
   缺少卸载时的 cleanup，可能导致内存泄漏

### 结论

⛔ 建议修复严重问题后再提交  /  ✅ 可以提交（附注意事项）
```

严重性说明：
- 🔴 严重：架构违规、潜在 crash、类型不安全
- 🟡 警告：性能问题、代码质量问题
- 🔵 建议：可选优化，不阻断提交
