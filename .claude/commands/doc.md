---
description: 文档生成与同步。根据代码变更自动更新或生成对应的 docs/ 文档，保持代码与文档一致。
argument-hint: [<文件路径>] [--all] [--module=<模块名>] [--dry-run]
---

# /doc — 文档生成与同步

根据代码变更（或指定文件），生成或更新 `docs/` 下的对应文档。

## 参数

- `<文件路径>`：为指定文件生成文档（如 `/doc services/AudioService.ts`）
- `--all`：扫描所有 staged 变更文件，批量更新相关文档
- `--module=<模块名>`：指定模块（如 `--module=audio`），更新对应 `docs/modules/<模块>.md`
- `--dry-run`：预览将要生成/更新的文档内容，不实际写入

## 文档目录结构

```
docs/
├── arch/        # 整体架构设计（手动维护，不自动生成）
├── features/    # 功能说明（新功能时生成）
├── modules/     # 模块接口文档（代码变更时同步）
│   ├── audio.md
│   ├── live2d.md
│   └── coordination.md
├── specs/       # 协议规范（手动维护）
└── releases/    # 版本记录（手动维护）
```

## 执行流程

### 1. 识别目标文档

**有参数时**：直接处理指定文件或模块。

**无参数时**：读取 `git diff --staged --name-only`，按路径映射到文档：

| 代码路径 | 文档目标 |
|---------|---------|
| `services/AudioService.ts` | `docs/modules/audio.md` |
| `services/Live2DService.ts` | `docs/modules/live2d.md` |
| `services/*.ts` | `docs/modules/<serviceName>.md` |
| `hooks/use*.ts` | 对应模块的 hooks 章节 |
| `packages/react-native-live2d/` | `packages/react-native-live2d/README.md` |
| `packages/react-native-pcm-stream/` | `packages/react-native-pcm-stream/README.md` |
| 新增 `app/<route>/` 页面 | `docs/features/<feature>.md`（新建） |
| `constants/`、`types/` | 对应模块文档的类型章节 |

### 2. 读取现有文档

读取目标文档的当前内容，了解格式和已有章节结构，确保更新风格一致。

### 3. 读取源代码

读取对应源文件，提取：
- 导出的 Class / function / type / interface
- 公开方法的参数和返回类型
- 重要的枚举和常量定义
- 注释中的业务说明

### 4. 生成 / 更新内容

#### 模块文档格式（`docs/modules/*.md`）

```markdown
# <模块名>

> 最后更新：YYYY-MM-DD

## 职责

一句话描述该模块的核心职责。

## 架构层级

说明该模块属于哪一层（Service / Hook / Manager）及其与其他层的关系。

## 核心 API

### `<ClassName>`

**构造参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| ... | ... | ... |

**方法**

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| ... | ... | ... | ... |

**事件 / 回调**

| 事件 | 类型 | 触发时机 |
|------|------|---------|
| ... | ... | ... |

## 使用示例

\`\`\`typescript
// 典型使用方式
\`\`\`

## 注意事项

- 重要限制或副作用
```

#### 功能文档格式（`docs/features/*.md`）新建时使用

```markdown
# <功能名>

> 创建日期：YYYY-MM-DD

## 功能描述

## 涉及模块

## 用户交互流程

## 关键实现

## 已知限制
```

### 5. 差异确认

展示文档变更的 diff，询问是否确认写入：
- `--dry-run` 模式：只展示，不写入
- 正常模式：展示后确认写入

### 6. 写入文档

使用 Edit 工具（更新）或 Write 工具（新建）写入对应文件。

### 7. 提示后续操作

文档更新完成后提示：
```
文档已更新：
  - docs/modules/audio.md（已更新 API 章节）

建议将文档变更一并纳入本次提交：
  git add docs/modules/audio.md
```
