# QuickForge 设计语言

本文档总结当前 QuickForge 的界面设计方向，用于后续功能开发、样式调整和组件重构时保持一致。

## 核心关键词

- **轻盈**：减少厚重背景、深色边框和大面积卡片感。
- **克制**：不堆叠过多阴影、边框、渐变和装饰。
- **一致**：左侧功能区、右侧对话区、顶部栏、输入框使用统一的颜色强度和交互反馈。
- **清晰**：信息层级明确，但不依赖强对比或重视觉块。
- **工具感**：保持开发者工具的效率感，不做过度拟物或娱乐化视觉。

---

## 总体原则

### 1. 以对话区为视觉基准

右侧对话区域是整个应用的视觉基准。

其它区域，包括：

- 左侧功能区
- 顶部栏
- 输入框
- 项目列表
- 会话列表
- 操作按钮

都应该向右侧对话区的轻量风格看齐。

避免某一区域比对话区更黑、更重、更抢眼。

---

### 2. 背景保持干净

默认背景优先使用：

```tsx
bg-background
```

只有在需要轻微层次时，才使用非常浅的 muted 背景：

```tsx
bg-muted/15
bg-muted/20
bg-muted/28
```

不建议使用过深的背景，例如：

```tsx
bg-muted/50
bg-secondary
bg-card shadow-sm
```

除非是弹窗、浮层或非常明确的独立容器。

---

### 3. 分割线要统一

主结构分割线应该统一使用同一套强度。

例如：

- 左侧功能区和右侧对话区之间的竖线
- 顶部栏和内容区之间的横线

应该保持一致：

```tsx
border-border
```

不要一个地方 `border-border/15`，另一个地方 `border-border`，否则页面结构会显得不统一。

---

## 颜色语言

### 默认颜色

文字与图标不宜过黑，除非是当前选中项或重要标题。

推荐：

```tsx
text-foreground/85
text-foreground/90
text-muted-foreground/55
text-muted-foreground/60
text-muted-foreground/72
```

### 普通文本

普通列表项：

```tsx
text-muted-foreground/72
```

hover 后：

```tsx
hover:text-foreground/85
```

当前选中项：

```tsx
text-foreground/90
```

---

## 字体层级

### 全局基准

QuickForge 的默认全局基础字号为 **14px**：

```css
html {
  font-size: 14px;
}
```

界面常用正文字号统一使用 `text-sm`，默认映射为 **12px**。以上字号可在设置页的“默认选项 / 字号”中调整。

---

### Section 标题

用于 Projects、Conversations 等分组标题。

```tsx
text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60
```

原则：

- 小
- 轻
- 不抢内容标题
- 主要起组织信息的作用

---

### 列表标题

项目名称、会话标题统一使用：

```tsx
text-sm leading-5
```

其中 `text-sm` 在当前主题中默认是 **12px**，用于保持界面正文紧凑一致。

当前选中项可略微加重：

```tsx
font-medium text-foreground/90
```

不要随意混用：

```tsx
text-sm font-semibold
text-xs
text-base
```

否则左侧列表会显得不齐、不稳。

---

### 辅助信息

时间、说明、空状态使用：

```tsx
text-[11px] text-muted-foreground/55
```

或：

```tsx
text-xs text-muted-foreground/55
```

---

## 布局与对齐

### 统一视觉轴

左侧列表需要保持统一对齐，不要每一层都有不同 padding。

推荐主行样式：

```tsx
rounded-lg px-2 py-1.5
```

主列表行：

```tsx
flex items-center gap-2
```

图标槽：

```tsx
inline-flex size-6 shrink-0 items-center justify-center
```

文本区：

```tsx
min-w-0 flex-1 text-left
```

---

### 子级内容

项目下的会话可以通过缩进表达层级，而不是使用明显竖线。

推荐：

```tsx
pl-8
```

不推荐：

```tsx
border-l-2
border-border/60
```

原因：竖线容易让左侧变得复杂和偏重。

---

## 交互反馈

### Hover 反馈

Hover 需要存在，但不能太重。

推荐列表行 hover：

```tsx
hover:bg-muted/28
hover:text-foreground/85
hover:shadow-[0_10px_26px_-18px_rgb(15_23_42_/_0.48)]
```

原则：

- 背景能被感知
- 阴影轻微
- 不产生明显卡片跳出感

---

### Active 状态

当前选中项使用淡背景和轻微阴影即可。

推荐：

```tsx
bg-muted/28
text-foreground/90
shadow-[0_10px_26px_-20px_rgb(15_23_42_/_0.42)]
```

避免使用：

```tsx
border
shadow-md
bg-secondary
bg-card
```

这些会让列表显得过重。

---

### 图标与文字使用规则

图标可以增强工具感和可操作性，但不应大面积替代文字信息。

推荐原则：

- **关键操作图标化，核心信息文字化**。
- 高频、明确、空间紧张的操作可以使用 icon-only，例如：新建、删除、设置、折叠 / 展开、发送、关闭、更多、复制、刷新。
- 导航结构、内容标题、状态说明和复杂动作应保留文字，例如：Projects、Conversations、项目名称、会话标题、模型名称、运行状态、生成离线包、打开工作区。
- icon-only 按钮必须提供可访问名称，例如 `aria-label`；必要时配合 tooltip。
- 图标默认应弱化，不要比文字更黑或更抢眼。
- hover / active 时可以强化图标颜色和背景反馈，但保持克制。
- 危险操作图标不要默认红色，只在 hover 或确认语境中变红。
- 不要为了“高级感”或“拟物感”堆叠图标；图标数量过多会降低阅读效率。

判断标准：

> 如果用户不看说明也能稳定理解该操作，可以 icon-only；如果理解依赖上下文、业务语义或状态信息，应保留文字。

目标不是强拟物化，而是让界面保持轻量工具感：可点击区域清晰、操作反馈明确，同时不牺牲信息可读性。

---

### 图标按钮

图标按钮需要有可点击反馈，但不能像实体按钮一样厚重。

推荐：

```tsx
size-7 rounded-full text-muted-foreground/55
hover:bg-muted/30 hover:text-foreground/85
```

危险操作 hover：

```tsx
hover:bg-destructive/12 hover:text-destructive/90
```

原则：

- 默认弱化
- hover 明确
- 删除操作只在 hover 时变红
- 不默认显示红色，避免视觉噪音

---

## 输入框设计语言

输入框是主要交互入口，需要比普通列表更有存在感，但仍保持克制。

### 推荐方向

- 圆角卡片
- 轻阴影
- 柔和边框
- 发送按钮明确
- 聚焦状态不要有大灰色外圈

### 避免

- 背景渐变过强
- 聚焦时大面积灰色 ring
- 输入框尺寸过大
- 图标不居中

### 发送按钮

发送按钮应使用居中的箭头图标，而不是旋转后不居中的小飞机图标。

推荐：

```tsx
size-8 rounded-full bg-primary text-primary-foreground
```

图标需居中：

```tsx
inline-flex items-center justify-center
```

---

## 左侧功能区设计语言

左侧功能区不应被设计成强卡片区，而应像轻量导航。

### 应该

- 背景与右侧保持一致
- 文字颜色更轻
- 当前项用淡背景表达
- hover 有清晰但克制的反馈
- 操作按钮默认弱化，hover 显示
- Projects / Conversations 对齐统一

### 不应该

- 大面积灰背景
- 每一项都有边框
- 每一项都有明显阴影
- section header 像按钮一样厚重
- 图标太多、太黑
- 子级层级线太明显

---

## 空状态

空状态不需要卡片化。

推荐：

```tsx
px-3 py-3 text-xs text-muted-foreground/55
```

避免：

```tsx
border border-dashed bg-muted/20 rounded-xl
```

除非该区域确实需要引导操作。

---

## 阴影使用规则

阴影只用于：

- 输入框
- hover 反馈
- active 轻反馈
- 浮层 / 弹窗

普通列表、section、空状态不默认使用阴影。

推荐轻阴影：

```tsx
shadow-[0_10px_26px_-18px_rgb(15_23_42_/_0.48)]
```

避免：

```tsx
shadow-md
shadow-lg
shadow-xl
```

---

## 圆角规则

整体使用中等圆角，不要过度圆润。

推荐：

```tsx
rounded-lg
rounded-xl
rounded-full // 仅图标按钮或状态点
```

列表项优先：

```tsx
rounded-lg
```

输入框可以更圆：

```tsx
rounded-2xl
```

---

## 设计禁忌

避免以下做法：

1. 颜色过深，导致左侧比右侧抢眼。
2. 列表项大量使用 border + shadow，形成重卡片感。
3. 不同列表层级使用不同字号、不同 padding。
4. hover 完全无反馈，导致可点击性不明显。
5. hover 反馈过重，导致界面跳动。
6. 图标默认太黑或太多，干扰文本阅读。
7. 分割线颜色不统一。
8. 为了“高级感”加入不必要的渐变。

---

## 当前推荐 Tailwind 片段

### Sidebar

```tsx
<aside className="border-r border-border bg-background">
```

### Section header

```tsx
'mb-1.5 flex items-center px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60'
```

### Row

```tsx
'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all'
```

### Row inactive

```tsx
'text-muted-foreground/72 hover:bg-muted/28 hover:text-foreground/85'
```

### Row active

```tsx
'bg-muted/28 text-foreground/90 shadow-[0_10px_26px_-20px_rgb(15_23_42_/_0.42)]'
```

### Icon button

```tsx
'size-7 rounded-full text-muted-foreground/55 transition-all hover:bg-muted/30 hover:text-foreground/85'
```

---

## 一句话总结

QuickForge 的设计语言是：

> 以对话区为基准，保持背景干净、线条统一、文字轻量、反馈明确但克制，避免重卡片和强装饰，让整个应用像一个专业、轻盈、可靠的 AI 工作区。
