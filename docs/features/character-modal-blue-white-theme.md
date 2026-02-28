# 角色选择弹窗蓝白主题统一

## 背景

移动端点击「角色管理」后弹出的选择角色 Modal（位于 `app/(tabs)/main.tsx`）原使用深色背景（`#1a1a2e`），与 N.E.K.O 主项目 Web 端角色管理页面（`CharacterManager.tsx` + `theme.css`）的蓝白风格不一致。

本文档记录已完成的改造，以及设计决策依据。

---

## 参考：主项目设计规范（theme.css）

| Token | 值 | 用途 |
|---|---|---|
| `--neko-primary` | `#40C5F1` | 主色、标题、边框高亮、角色名 |
| `--neko-deep` | `#22b3ff` | 深蓝，当前选中项强调 |
| `--neko-light-bg` | `#e3f4ff` | 浅蓝背景、当前项背景 |
| `--neko-border` | `#b3e5fc` | 卡片边框 |
| `--neko-card-bg` | `#f0f8ff` | 卡片背景 |
| `--neko-white` | `#ffffff` | 主背景 |
| `--neko-text-muted` | `#666` | 次要文字 |

Web 端关键样式：
- `neko-header`：`background: #40C5F1`，白色文字
- `catgirl-header h3`：`color: var(--neko-primary)`（**所有角色名均为蓝色**）
- `catgirl-section .section-header`：`border-left: 4px solid var(--neko-primary)`（左侧蓝色竖线）
- `catgirl-card:hover`：`box-shadow: 0 4px 16px rgba(64, 197, 241, 0.2)`

---

## 已实施的修改

文件：`app/(tabs)/main.tsx`

### 0. 标题文字

Header 标题由「选择角色」改为「角色管理」，与主项目页面标题一致。

### 1. Modal 容器

```ts
characterModalContent: {
  backgroundColor: '#ffffff',
  borderRadius: 20,
  overflow: 'hidden',
  width: '82%',
  maxHeight: '65%',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 20 },
  shadowOpacity: 0.3,
  shadowRadius: 30,
  elevation: 20,
},
```

### 2. 蓝色 Header（对应 neko-header）

Header 右上角加入白色 ✕ 关闭按钮，替代原来的底部取消按钮：

```tsx
<View style={styles.characterModalHeader}>
  <Text style={styles.characterModalTitle}>角色管理</Text>
  <TouchableOpacity
    style={styles.characterModalCloseBtn}
    onPress={() => setCharacterModalVisible(false)}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
  >
    <Text style={styles.characterModalCloseBtnText}>✕</Text>
  </TouchableOpacity>
</View>
```

```ts
characterModalHeader: {
  backgroundColor: '#40C5F1',
  paddingVertical: 18,
  paddingHorizontal: 24,
  alignItems: 'center',
  flexDirection: 'row',
  justifyContent: 'center',
},
characterModalTitle: {
  color: '#ffffff',
  fontSize: 18,
  fontWeight: '600',
  letterSpacing: 1,
},
characterModalCloseBtn: {
  position: 'absolute',
  right: 16,
  top: '50%',
  marginTop: -10,
},
characterModalCloseBtnText: {
  color: '#ffffff',
  fontSize: 18,
  fontWeight: '400',
  lineHeight: 20,
},
```

### 3. 副标题（当前角色名高亮）

「当前:」后的角色名高亮为蓝色，使用嵌套 `<Text>` 实现：

```tsx
<Text style={styles.characterModalSubtitle}>
  当前: <Text style={styles.characterModalSubtitleHighlight}>{currentCatgirl || '未设置'}</Text>
</Text>
```

```ts
characterModalSubtitle: {
  color: '#666',
  fontSize: 13,
  textAlign: 'center',
  marginTop: 12,
  marginBottom: 12,
  paddingHorizontal: 20,
},
characterModalSubtitleHighlight: {
  color: '#40C5F1',   // --neko-primary
  fontWeight: '600',
},
```

### 4. 列表区域

```ts
characterModalList: {
  maxHeight: 300,
  paddingHorizontal: 16,
  paddingBottom: 4,
},
```

### 5. 角色列表项（对应 catgirl-card + section-header border-left）

所有角色名对应 `catgirl-header h3` 均使用 `#40C5F1` 蓝色；左侧 4px 蓝色竖线对应 `catgirl-section .section-header border-left`。每项左侧添加 🐱 图标，角色名居中显示（`flex: 1` + `textAlign: 'center'`），右侧为「当前」徽章或等宽占位。

JSX 结构：
```tsx
<TouchableOpacity style={[styles.characterModalItem, isCurrent && styles.characterModalItemCurrent]} ...>
  <Image
    source={require('@/assets/icons/dropdown_arrow.png')}
    style={styles.characterModalItemIcon}
  />
  <Text style={[styles.characterModalItemText, isCurrent && styles.characterModalItemTextCurrent]}>
    {name}
  </Text>
  {isCurrent ? (
    <View style={styles.characterModalBadgeWrap}>
      <Text style={styles.characterModalBadge}>当前</Text>
    </View>
  ) : (
    <View style={styles.characterModalBadgePlaceholder} />
  )}
</TouchableOpacity>
```

```ts
characterModalItem: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: 13,
  paddingHorizontal: 16,
  borderRadius: 20,
  marginBottom: 8,
  backgroundColor: '#f0f8ff',   // --neko-card-bg
  borderWidth: 2,
  borderColor: '#b3e5fc',       // --neko-border
  borderLeftWidth: 4,
  borderLeftColor: '#40C5F1',   // 对应 catgirl-section border-left
},
characterModalItemCurrent: {
  backgroundColor: '#e3f4ff',   // --neko-light-bg
  borderColor: '#40C5F1',
  borderLeftColor: '#22b3ff',   // --neko-deep，当前项更深
},
characterModalItemText: {
  flex: 1,
  color: '#40C5F1',             // 对应 catgirl-header h3
  fontSize: 15,
  fontWeight: '600',
  textAlign: 'center',          // 角色名居中
},
characterModalItemTextCurrent: {
  color: '#22b3ff',             // --neko-deep
  fontWeight: '700',
},
characterModalItemIcon: {
  width: 18,
  height: 18,
  marginRight: 10,
  transform: [{ rotate: '-90deg' }],  // dropdown_arrow.png 逆时针旋转 90°
  tintColor: '#40C5F1',
},
```

### 6. 「当前」徽章 + 占位（胶囊标签）

非当前项右侧用等宽占位 View 保持布局对齐：

```ts
characterModalBadgeWrap: {
  backgroundColor: '#40C5F1',
  borderRadius: 999,
  paddingVertical: 2,
  paddingHorizontal: 10,
},
characterModalBadgePlaceholder: {
  width: 38,
},
characterModalBadge: {
  color: '#ffffff',
  fontSize: 11,
  fontWeight: '600',
},
```

### 7. 取消按钮（对应 neko-btn-primary）

蓝底白字 pill 形按钮：

```ts
characterModalClose: {
  marginTop: 4,
  marginHorizontal: 16,
  marginBottom: 16,
  paddingVertical: 11,
  borderRadius: 999,
  backgroundColor: '#40C5F1',
  alignItems: 'center',
},
characterModalCloseText: {
  color: '#ffffff',
  fontSize: 15,
  fontWeight: '600',
},
```

---

## 视觉效果对比

| 区域 | 修改前 | 修改后 |
|---|---|---|
| 弹窗标题 | 「选择角色」，白色文字无背景 | 「角色管理」，蓝色 Header + 右上角白色 ✕ 关闭按钮 |
| 副标题角色名 | 灰色 `#888` | 「当前:」与角色名均为蓝色 `#40C5F1` 加粗 |
| 列表项背景 | 半透明白色 5% | 浅蓝 `#f0f8ff` + 蓝色边框 + 左侧 4px 蓝线 |
| 列表项图标 | 无 | `dropdown_arrow.png` 逆时针旋转 90°，蓝色 tint |
| 角色名布局 | 左对齐 | 居中（`flex:1` + `textAlign:'center'`） |
| 角色名文字 | 白色 `#fff` | 蓝色 `#40C5F1`（对应 catgirl-header h3） |
| 当前角色项 | 半透明蓝色 15% | `#e3f4ff` 背景 + `#40C5F1` 边框 |
| 当前角色文字 | 蓝色 `#40C5F1` | 深蓝 `#22b3ff`，加粗 |
| 「当前」徽章 | 蓝色文字 | 蓝色胶囊背景 + 白色文字；非当前项有等宽占位保持对齐 |
| 关闭方式 | 底部灰色取消按钮 | Header 右上角白色 ✕ 按钮 |

---

## 相关文件

- 移动端 Modal：[app/(tabs)/main.tsx](../../app/(tabs)/main.tsx)
- Web 端参考页面：`N.E.K.O/frontend/src/web/pages/CharacterManager.tsx`
- Web 端样式：`N.E.K.O/frontend/src/web/pages/CharacterManager.css`
- Web 端主题：`N.E.K.O/frontend/src/web/theme.css`
