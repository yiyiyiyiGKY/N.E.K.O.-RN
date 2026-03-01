---
description: 交互式创建新 skill（slash command）。基于 Anthropic 官方规格，引导生成标准 .md 文件并放到正确位置。
argument-hint: [<skill-name>] [--global]
allowed-tools: Read, Write, Edit, Bash(ls:*), Bash(mkdir:*), Bash(cat:*)
---

# /skill-create — Skill 创建向导

基于 [Anthropic 官方 slash commands 规格](https://docs.anthropic.com/en/docs/claude-code/slash-commands) 创建新 skill。

## 官方规格速查

### Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `description` | string | 在 `/help` 中展示的描述，也是 Claude 判断何时调用此 skill 的依据 |
| `argument-hint` | string | 参数语法提示，如 `[--flag] <required>` |
| `allowed-tools` | string | 免审批工具列表，如 `Read, Bash(git commit:*), Grep` |
| `model` | string | 指定模型，如 `claude-haiku-4-5-20251001`（省略则继承当前） |
| `disable-model-invocation` | bool | `true` = 只允许用户手动触发，Claude 不会自主调用（适合 /deploy、/commit 等有副作用的操作） |
| `user-invocable` | bool | `false` = 只允许 Claude 内部调用，不出现在用户命令列表（适合背景知识型 skill） |

### 参数占位符

- `$ARGUMENTS` — 捕获所有参数（`/skill-create my-skill --global` → `"my-skill --global"`）
- `$1`, `$2`, `$3` — 按位置取单个参数

### 文件位置

| 范围 | 路径 | 说明 |
|------|------|------|
| 项目级 | `.claude/commands/<name>.md` | 只在本项目可用，可提交到 git |
| 用户级（全局） | `~/.claude/commands/<name>.md` | 所有项目可用 |

---

## 执行流程

### 1. 确定基本信息

若用户已提供 skill 名称（`$1`），使用该名称；否则询问。

确认以下信息：
- **skill 名称**（即 `/xxx` 的 `xxx`）
- **这个 skill 要做什么**（一句话描述）
- **放置位置**：项目级（`.claude/commands/`）还是全局（`~/.claude/commands/`）
  - 有 `--global` 参数 → 全局
  - 否则 → 项目级（默认）

### 2. 分析需求，规划 Frontmatter

根据用户描述的功能，判断需要哪些 frontmatter 字段：

**`allowed-tools` 选取原则**（只列需要的）：

| 需要做什么 | 对应 tool |
|-----------|-----------|
| 读取文件 | `Read` |
| 搜索文件 | `Glob`, `Grep` |
| 创建/修改文件 | `Write`, `Edit` |
| 运行 git 命令 | `Bash(git <subcmd>:*)` |
| 运行 npm/expo | `Bash(npm run:*)`, `Bash(npx expo:*)` |
| 运行 lint | `Bash(npx expo lint:*)` |
| 通用 shell | `Bash` |
| 网络请求 | `WebFetch` |

**`model` 选取原则**：
- 简单格式化/文本操作 → `claude-haiku-4-5-20251001`（快、省钱）
- 复杂分析/代码审查 → 省略（继承当前，通常是 Sonnet/Opus）
- 重量级架构分析 → `claude-opus-4-6`

**`disable-model-invocation` 何时设为 true**：
- skill 有不可逆副作用（提交、部署、发布、发消息）
- 你不希望 Claude 在对话中自主决定触发它

### 3. 生成 Skill 文件

按以下模板生成，根据实际需求增删章节：

```markdown
---
description: <一句话描述，清晰说明 skill 的触发时机>
argument-hint: <参数语法，无参数时省略>
allowed-tools: <工具列表，无特殊需求时省略>
model: <模型 ID，无特殊需求时省略>
disable-model-invocation: <true/false，默认省略>
---

# /<name> — <标题>

<功能详细说明>

## 参数

（有参数时列出）

## 执行流程

### 1. <第一步>

\`\`\`bash
# 相关命令
\`\`\`

### 2. <第二步>

...

## 输出格式

（如有固定输出格式，在此定义）

## 注意事项

（重要限制或副作用）
```

### 4. 检查目标目录

```bash
ls .claude/commands/       # 项目级
# 或
ls ~/.claude/commands/     # 全局
```

若目录不存在：
```bash
mkdir -p .claude/commands/
# 或
mkdir -p ~/.claude/commands/
```

### 5. 写入文件

将生成的内容写入 `<目录>/<skill-name>.md`。

### 6. 验证并展示结果

```bash
cat <目标路径>
```

输出确认信息：
```
✅ Skill 创建成功

文件路径：.claude/commands/<name>.md
触发方式：/<name>
范围：项目级 / 全局

下次对话即可使用 /<name>
```

若为项目级 skill，提示：
```
提示：可将此文件提交到 git，让团队成员共享这个 skill。
  git add .claude/commands/<name>.md
```
