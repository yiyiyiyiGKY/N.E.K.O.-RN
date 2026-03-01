---
description: N.E.K.O.-RN 项目的规范化提交。遵循项目约定：Conventional Commits 格式、中文描述。覆盖全局 /commit 的行为。
argument-hint: [--no-verify] [--full] [--type=feat|fix|docs|style|refactor|perf|chore|build|ci|revert]
disable-model-invocation: true
---

# /commit — 规范化提交

## 项目约定

- **格式**：`type(scope): 中文描述`，scope 可选
- **语言**：提交描述使用**中文**
- **长度**：标题不超过 72 字符
- **时态**：动词使用现在时（"添加"而非"已添加"）
- **emoji**：不强制，简单 fix/chore 可省略，重要 feat 可加

## 参数

- `--no-verify`：跳过 lint 检查（不推荐，紧急 hotfix 时使用）
- `--full`：生成带 body 的完整提交信息（用于复杂变更）
- `--type=<type>`：手动指定类型，跳过自动推断

## 执行流程

### 1. 检查工作区状态

```bash
git status
git diff --staged
git log --oneline -5   # 参考近期提交风格
```

### 2. 预检（除非 --no-verify）

```bash
npx expo lint
```

Lint 有错误时：列出错误，询问是否继续或先修复。

### 3. 暂存文件

- 若有已 staged 文件：直接使用
- 若无 staged 文件：`git add` 所有相关修改文件（排除 `node_modules/`、`.expo/`、`android/build/`）
- 若变更跨越多个独立模块：建议拆分为多个原子提交

### 4. 分析变更，生成提交信息

#### 类型推断规则

| 变更内容 | 类型 |
|---------|------|
| 新增功能、新增组件/页面 | `feat` |
| 修复 bug、纠正逻辑错误 | `fix` |
| 仅修改 `docs/` | `docs` |
| 格式化、重命名、无逻辑变更 | `style` |
| 重构（行为不变） | `refactor` |
| 性能优化 | `perf` |
| 依赖更新、配置调整、脚本 | `chore` |
| 构建配置（metro、eas、gradle） | `build` |
| CI/CD 相关 | `ci` |
| 回退提交 | `revert` |

#### Scope 推断规则（可选）

| 变更位置 | scope |
|---------|-------|
| `app/` 路由页面 | 路由名（如 `voice`、`settings`） |
| `services/` | 服务名（如 `audio`、`live2d`） |
| `components/` | 组件名 |
| `hooks/` | hook 名 |
| `packages/react-native-live2d` | `live2d` |
| `packages/react-native-pcm-stream` | `pcm` |
| 多处变更 | 省略 scope |

### 5. 提交格式

#### 简洁格式（默认）

```
type(scope): 中文描述
```

示例：
```
feat(voice): 添加语音准备状态脉冲动画
fix(audio): 修复角色切换时音频队列未清空问题
docs: 更新 WebSocket 协议文档
chore: 更新 react-native-live2d 子模块引用
refactor(live2d): 简化手势缩放计算逻辑
```

#### 完整格式（--full 或变更较复杂时）

```
type(scope): 中文描述

详细说明变更内容和原因（可多行）：
- 具体改动点 1
- 具体改动点 2

相关信息（可选）：
Closes: #123
```

### 6. 执行提交

```bash
git commit -m "$(cat <<'EOF'
<生成的提交信息>
EOF
)"
```

### 7. 收尾检查

```bash
git status    # 确认工作区干净
git log --oneline -3   # 确认提交成功
```

### 特殊情况处理

**变更涉及 `@project_neko/*` 内部包**：
提交后提示："检测到内部包变更，如需同步到 N.E.K.O.-RN 请运行 `npm run sync:neko-packages`"

**同时有文档需更新**：
若功能文件有对应的 `docs/features/` 或 `docs/modules/` 文档，提示是否需要一并更新文档再提交。
