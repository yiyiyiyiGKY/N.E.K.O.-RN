# 角色管理功能

> 在 N.E.K.O.-RN 中管理和切换 AI 虚拟角色

---

## 功能概述

角色管理功能让你可以：

- 查看所有可用角色
- 切换当前使用的角色
- 创建新角色
- 编辑角色属性
- 删除角色

---

## 访问方式

### 方式 1：从主界面快速切换

适用于：只想切换当前角色，无需编辑

1. 在主界面（Live2D 页面）点击右上角 **设置图标** ⚙️
2. 在弹出菜单中点击 **"角色管理"**
3. 在角色列表中点击想要使用的角色
4. 切换成功后会显示提示

### 方式 2：从首页进入管理页面

适用于：需要创建、编辑或删除角色

1. 打开 App，在首页找到 **"⚙️ 管理页面"** 区域
2. 点击 **"🐱 角色管理"**
3. 进入完整的角色管理界面

---

## 角色属性说明

每个猫娘角色包含以下属性：

| 属性 | 说明 | 示例 |
|------|------|------|
| **档案名** | 角色唯一标识（必填） | `test`, `miku`, `catgirl_01` |
| **昵称** | 显示名称（可选） | `小樱`, `初音未来` |
| **性别** | 角色性别（可选） | `女`, `男`, `未知` |
| **年龄** | 角色年龄（可选） | `18`, `未知` |
| **性格** | 性格描述（可选） | `温柔体贴`, `活泼开朗` |
| **背景故事** | 角色背景（可选） | 来自未来世界的 AI 猫娘... |
| **System Prompt** | AI 系统提示词（可选） | 你是一个温柔的女仆... |
| **Live2D 模型** | 模型路径（可选） | `mao_pro`, `haru` |
| **Voice ID** | 语音 ID（可选） | 选择使用的音色 |

### 主人档案

除了猫娘角色，还可以设置主人（用户）信息：

| 属性 | 说明 | 示例 |
|------|------|------|
| **档案名** | 用户名称 | `Master`, `主人` |
| **昵称** | 显示昵称 | `小明` |
| **性别** | 用户性别 | `男`, `女` |

---

## 操作指南

### 切换当前角色

**方法 1：快速切换**

1. 在主界面点击右上角设置 → 角色管理
2. 点击角色名称
3. 看到提示 "已切换到角色: XXX"

**方法 2：从管理页面**

1. 进入角色管理页面
2. 点击角色卡片左侧的 **⭐ 星星图标**
3. 当前角色会显示星标

### 创建新角色

1. 进入角色管理页面
2. 点击右上角 **"+"** 按钮
3. 填写角色信息：
   - **必填**：档案名（唯一标识）
   - **可选**：昵称、性别、年龄、性格等
4. 点击 **"✓ 保存"** 完成

### 编辑角色

1. 进入角色管理页面
2. 点击角色卡片右侧的 **"✏️ 编辑"** 按钮
3. 修改想要更改的属性
4. 点击 **"✓ 保存"** 完成

### 删除角色

1. 进入角色管理页面
2. 点击角色卡片右侧的 **"🗑️ 删除"** 按钮
3. 确认删除操作
4. ⚠️ **注意**：删除后无法恢复

---

## API 参考

角色管理功能基于 REST API，后端路由：`main_routers/characters_router.py`

### 端点列表

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/characters/` | 获取所有角色数据 |
| POST | `/api/characters/master` | 更新主人档案 |
| POST | `/api/characters/catgirl` | 添加新猫娘 |
| PUT | `/api/characters/catgirl/:name` | 更新猫娘信息 |
| DELETE | `/api/characters/catgirl/:name` | 删除猫娘 |
| POST | `/api/characters/catgirl/:old_name/rename` | 重命名猫娘 |
| GET | `/api/characters/current_catgirl` | 获取当前猫娘 |
| POST | `/api/characters/current_catgirl` | 设置当前猫娘 |

### 使用示例

```typescript
import { createCharactersApiClient, buildHttpBaseURL } from '@/services/api/characters';

// 创建 API 客户端
const apiBase = `${buildHttpBaseURL(config)}/api`;
const client = createCharactersApiClient(apiBase);

// 获取所有角色
const data = await client.getCharacters();

// 切换当前角色
await client.setCurrentCatgirl('miku');

// 添加新角色
await client.addCatgirl({
  档案名: 'new_catgirl',
  昵称: '小花',
  性格: '活泼可爱',
});

// 更新角色
await client.updateCatgirl('new_catgirl', {
  年龄: '16',
  背景故事: '来自异世界的冒险家',
});
```

---

## 常见问题

### Q: 角色信息存储在哪里？

A: 角色数据存储在后端服务器（N.E.K.O 主项目），不在手机本地。这意味着：
- ✅ 多设备同步（使用相同后端）
- ✅ 数据持久化
- ❌ 离线无法修改角色

### Q: 可以创建多少个角色？

A: 理论上无限制，但建议保持在 10 个以内以便管理。

### Q: 删除角色后可以恢复吗？

A: 不可以，删除操作是永久性的。建议删除前先备份重要的角色设置。

### Q: 为什么切换角色后 Live2D 模型没变？

A: 角色的 `live2d` 属性只是模型路径配置，实际加载需要：
1. 模型文件存在于项目中
2. 调用 Live2D 加载 API

目前主界面默认加载 `mao_pro` 模型，暂未实现自动切换。

### Q: System Prompt 是什么？

A: System Prompt 是给 AI 的系统级提示词，用于定义角色的：
- 说话风格
- 性格特点
- 行为模式
- 回答方式

示例：
```
你是一个温柔体贴的猫娘，说话时会加上"喵～"的口癖。
你喜欢用可爱的语气和主人交流，会在适当的时候撒娇。
当主人生气时，你会担心地询问原因。
```

### Q: 如何让角色使用不同的语音？

A: 设置角色的 `voice_id` 属性为后端支持的语音 ID，具体可用语音取决于后端的 TTS 配置。

---

## 开发者注意事项

### 前端实现

- **快速切换**：[app/(tabs)/main.tsx](../../app/(tabs)/main.tsx) - Modal 弹窗
- **完整管理**：[app/character-manager.tsx](../../app/character-manager.tsx) - 管理页面
- **API 服务**：[services/api/characters.ts](../../services/api/characters.ts) - 客户端

### 后端对接

确保后端服务正常运行：

```bash
# 启动后端（在 N.E.K.O 主项目）
python main.py

# 检查 API 是否可用
curl http://localhost:48911/api/characters/
```

### 测试建议

1. **功能测试**：
   - 创建、编辑、删除角色
   - 切换当前角色
   - 查看角色列表

2. **边界测试**：
   - 空字段处理
   - 超长文本
   - 特殊字符

3. **网络测试**：
   - 离线场景
   - 网络超时
   - 服务器错误

---

## 更新历史

- **2026-02-25**：合并 RN 分支到 main，角色管理功能完整可用
- **2026-01-XX**：实现角色管理 API 客户端
- **2026-01-XX**：创建角色管理页面 UI

---

## 相关文档

- [新人上手指南](../guides/onboarding.md)
- [跨平台组件策略](../strategy/cross-platform-components.md)
- [WebSocket 协议规范](../specs/websocket.md)
- [API 集成架构](../arch/cross-project-integration.md)
