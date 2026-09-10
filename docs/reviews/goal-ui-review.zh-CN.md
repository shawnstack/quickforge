# Goal 功能 UI 完整评审报告

> **评审对象**：Goal 模式全部四个前端 surface —— ① 右侧边栏 Goal Inspector（`GoalInspectorContent`）、② 置顶摘要 Goal 分区（`GoalSummarySection`）、③ 输入框上方控制条（`goal-control-strip`）、④ 聊天 Goal 卡（`goal-card`）。
> **触发背景**：用户浏览器验收反馈「存在大量样式问题，尤其在右边的侧边栏展示；同时有过多说明性文字」。
> **方法**：三路只读调研（侧栏实现细节 / 全 surface 形态对比 / i18n 文案规模与设计规范）+ 逐条文件行号人工复核。本报告所有 `文件:行号` 引用均经过亲自读取核实。
> **基线**：`DESIGN_LANGUAGE.md`（全文 268 行已核对）。
> **性质**：静态代码评审 + 配套优化示例（`design-mockups/goal-inspector-optimization.html`）。不含真实浏览器截图，视觉结论以优化示例与用户验收为准。

---

## 一、总体结论

用户反馈的两类问题均被代码证据证实，且**右侧边栏是重灾区**：

| 维度 | 结论 |
|---|---|
| 样式问题 | 右侧边栏存在 3 个高优先级、8 个中优先级、5 个低优先级问题（G-01~G-16）。最严重的是**内容区整条链路无垂直滚动**——长内容被直接裁剪且无法查看，属功能性缺陷而非美观问题 |
| 说明性文字 | goal i18n 每语言 100 条 key 中 25 条（1/4）是说明性文字，其中 10 条为 ≥25 字的长句；`paused`/`blocked`/`needs_review` 状态下侧栏最多 **3 条 Note 连排**，且因聊天卡与侧栏共用同一 view model，**同一批 Note 在两处同屏各显示一遍**。直接违反 `DESIGN_LANGUAGE.md` L187-191「大段辅助说明不应长期平铺，应收拢到 `?` 浮层」 |
| 一致性 | Goal Inspector 是全仓库**唯一**使用独立 CSS 文件的 Workspace Inspector 内容组件（`src/components` 下仅有的两个 `import './x.css'` 全部是 Goal 组件）；字号 16/13/12 混用、间距 14/18px 脱离 4px 刻度、按钮与全应用 shadcn Button 体系脱节 |
| 文档漂移 | 控制条实现与其自身设计注释矛盾：`.ts` 头注释与 `index.css` 注释都声称「只渲染状态 icon + 短标签 + 至多两个 icon 按钮，objective 归摘要视图」，实现却在单行内渲染目标全文 + 已记录时长 + 错误 + 内联取消三连按钮（C-02） |

**问题总账**：高 3 · 中 12 · 低 11（另有 1 条正面记录、1 组外壳问题仅记录不扩范围），详见第八节路线图。

---

## 二、Surface ①：右侧边栏 Goal Inspector（重点）

### 2.1 现状结构

```
<aside> WorkspaceInspector.tsx:1929-1938        overflow-hidden, bg-background, 内联 width(340~1200px)
├─ Tab 头部 h-14                                WorkspaceInspector.tsx:1954
└─ <div class="flex min-h-0 flex-1">            WorkspaceInspector.tsx:2209  ⚠ 无 overflow
    └─ <section class="quickforge-goal-inspector">  GoalInspectorContent.tsx:118
        ├─ nav：进度/编辑目标 两个 aria-pressed 按钮   :119-122
        ├─ 状态行 text-xs                          :123
        ├─ edit 视图：textarea + 冲突/只读提示 + 暂停确认 + footer  :125-136
        └─ progress 视图：目标原文 h2 + blocker + summary
           + 验收标准(含证据 details) + 范围·预算 details
           + 预算追加确认组 + noteKeys 平铺 + 动作按钮行  :137-160
```

`goal-inspector.css` 全部 8 条规则：容器 `gap:14px; padding:18px; font-size:13px; overflow-wrap:anywhere`、按钮 `padding:5px 9px; border-radius:7px; font-size:12px; background:color-mix(var(--muted) 40%, transparent)`、`button[aria-pressed=true]`、`button:disabled`、`textarea`（`min-height:260px` 等）、`summary`、`details p`、`focus-visible`。**无 hover、无 transition、无 media query。**

### 2.2 高优先级（P0）

#### G-01 内容区整条链路无垂直滚动，长内容被裁剪

- **证据链**：`WorkspaceInspector.tsx:1932` aside `overflow-hidden` → `:2209` 内容容器 `flex min-h-0 flex-1`（无 overflow）→ `goal-inspector.css:1` `.quickforge-goal-inspector { min-height: 100% }`（无 overflow）。三层均不承接滚动。
- **后果**：progress 视图天然超高（目标原文 + blocker + summary + 每条准则及其证据折叠 + 范围预算 + 预算确认 + Note + 按钮），超出部分**被直接裁掉，无法滚动查看**——准则、证据、动作按钮在真实使用中很可能根本看不到。
- **对照**：同容器的 subagent 详情 Tab 顶层即 `min-h-0 flex-1 overflow-y-auto`（`SubagentRunDetailContent.tsx:24`），滚动责任下放给各 Tab 内容组件是既有模式，Goal 是唯一未遵守者。
- **附带**：`min-height:100%` 在 flex 拉伸父容器中基本无效，属冗余；修复时应改为 `flex-1 min-h-0 overflow-y-auto` 模式。
- **违反**：设计语言「清晰：信息层级明确」；同容器一致性。

#### G-03 按钮体系与全应用 Button 脱节

- **证据**：`goal-inspector.css:2-4` 按钮统一为裸样式：无边框、无 hover、无 transition、无 `:active` 回缩、`opacity:.4` 禁用。同屏外壳按钮全部是 shadcn `Button`/`rounded-xl`/hover 变色（`WorkspaceInspector.tsx` Tab 头部按钮组）。
- **违反**：设计语言 L106-131「Hover：有感知，不跳动」（当前**完全无反馈**）、L156「按钮 `:active` 时 scale(0.97) 回缩」、L21-27「以对话区为基准……其他区域应向其看齐」。
- **方向**：接入现有 Button 变体（ghost/outline/primary 分层），或按 token 重写并为导航切换（aria-pressed）与动作按钮建立两档视觉。

#### G-04 textarea `min-height:260px` 硬编码，矮视口下不可收缩

- **证据**：`goal-inspector.css:5` `min-height:260px`；`GoalInspectorContent.tsx:126` edit 视图 label 为 `flex min-h-0 flex-1 flex-col`，textarea `flex:1`。
- **后果**：视口可用高度 < 约 420px 时（矮窗口、全屏 overlay、移动端 `<1024px` 切换为 `position:fixed` 全屏后）textarea 无法收缩，叠加 G-01 无外层滚动 → 编辑区溢出、footer 按钮不可见。
- **方向**：`min-height` 改为视口相关（如 `min(260px, 40vh)`）或交由外层滚动容器承接。

### 2.3 中优先级（P1）

#### G-02 动作按钮行无换行保护，容器级 `overflow-wrap:anywhere` 侵入按钮文本（健壮性）

- **证据**：`GoalInspectorContent.tsx:159` 动作行 `<div className="flex gap-2">` 无 `flex-wrap`（同文件 `:133`、`:136` 的组都有）；容器 `overflow-wrap:anywhere`（`goal-inspector.css:1`）作用于所有子节点含按钮文本。
- **核实说明（修正初稿）**：经 `src/lib/goal.ts:280-294` 谓词核实，当前状态机下该行最多同屏 2 个按钮（`awaiting_confirmation` 仅「确认目标」；`needs_review` 为「验收通过」+「追加预算并继续」，按 12px 字号估算总宽约 176px），**340px 最窄面板下并不实际溢出**。初稿按「三按钮必溢出」定为高危不成立，下调为中优先级健壮性问题。
- **真实风险**：① 未来新增动作按钮或更长文案（英文 "Add budget and continue"）即溢出且无换行兜底；② `overflow-wrap:anywhere` 会让按钮文字在单词中间任意断行，英文标签尤甚；③ 与同文件其他组的 `flex-wrap` 写法不一致。
- **方向**：动作行加 `flex-wrap`；按钮文本改 `white-space:nowrap`（或 `overflow-wrap:break-word`），把 `anywhere` 收敛到确需断行的长串正文节点。

#### G-05 导航切换与动作按钮同一样式，语义不分层

`GoalInspectorContent.tsx:119-122` 的「进度/编辑目标」视图切换（aria-pressed）与 `:159` 的「确认目标/验收通过」阶段动作按钮共享同一条 `.quickforge-goal-inspector button` 规则（`goal-inspector.css:2`），仅 pressed 态背景略有差异。导航（segmented control）与动作（action button）是两种交互语义，应分为两档样式。

#### G-06 字号刻度混乱：16/13/12 三档混用且不在同一体系

容器 13px（css:1）、按钮/summary 12px（css:2/6）、h2 `text-sm`（项目覆盖 `--text-sm:1rem`=16px，`index.css:23`）、h3 无任何 class 裸继承 13px（`:141`）、noteKeys `text-xs`=12px（`:158`）。13px 不是 Tailwind 刻度值；h2(16 medium) 与 h3(13 regular) 之间没有刻度化层级。违反设计语言 L63-88「正文统一、Section 标题小而轻、辅助信息更小更弱」的体系化要求。

#### G-07 信息层级扁平：正文节点零样式、无 tone，与聊天卡视觉倒挂

`GoalInspectorContent.tsx:139` blocker `p[role=status]`、`:140` summary `p`、`:142` 准则 `p`、`:151-154` 预算确认四段 `p`——全部无颜色/字重/间距区分，同为 13px 默认前景色平铺。对照：旧聊天卡有完整 tone 体系（`goal-card.ts:108-114` tone 映射、`index.css:6926-7310` 约 40 个选择器含 3px tone 色条）。**重设计后侧栏才是 progress/edit 的主 surface，视觉资源却仍留在旧卡上，主次倒挂**（详见 K-02）。

#### G-08 准则状态为纯文本拼接，无语义色

`GoalInspectorContent.tsx:142` `{description} · {t(statusKey)}` 以 muted 纯文本呈现，passed/failed/pending/needs_review 四态视觉完全相同。验收是 Goal 的核心概念，状态应有 badge/色彩语义（passed=success、failed=destructive、pending=muted），并与证据 tone 呼应。

#### G-09 时间与预算数值未本地化

- `GoalInspectorContent.tsx:144` `<time>{evidence.acceptedAt}</time>`、`:136` `t('goalUpdatedAt',{time: goal.updatedAt})` 都直接渲染**原始 ISO 字符串**（如 `2026-09-10T08:41:22.000Z`），不可读。
- `:151` `goalBudgetActual` 模板拼接原始毫秒值：「实际已用 / 上限：1800000 / 1800000 毫秒；8 / 8 轮」——预算确认是最需要一眼看懂的场景，当前呈现最差。
- **方向**：ISO → 本地时间或相对时间；预算改为结构化展示（`已用 8/16 轮 · 12/30 分钟`，可配进度条）。

#### G-10 Note 文案语境错位：「上方的卡片」在侧栏不存在

`goalAwaitingInputNote`「正在等待你处理**上方的卡片**。」（i18n.ts:2604）、`goalAwaitingApprovalNote`「正在等待你在**上方卡片**中审批工具。」（:2605）。这套文案源自聊天区 Goal 卡的 view model（`goal-card.ts:116-147` `noteKeysForStatus`），侧栏复用同一投影（`GoalInspectorContent.tsx:79` → `:158` 平铺渲染）。侧栏里没有「上方的卡片」——审批卡在聊天区。用户在侧栏读到该句会指向不存在的对象。

#### G-11 唯一使用独立 CSS 的 Inspector 内容组件，双体系混用

`src/components` 全目录仅两处 `import './x.css'`：`GoalInspectorContent.tsx:6` 与 `GoalSummarySection.tsx:6`，**全部是 Goal 组件**。其余 Inspector 内容组件（SubagentRunDetail/SideChat/WorkspaceDocument）均为纯 Tailwind。同一个 TSX 文件内 Tailwind 类（`:119 flex gap-2`、`:123 text-xs` 等）与作用域 CSS 规则并存，两套体系互相覆盖心智。且该 css 值全部硬编码脱离刻度（14/18/12/8/5px 9px、radius 7/8px）。**方向**：统一到 Tailwind 原子类或统一整理为 token 化规则，二选一，不要混用。

### 2.4 低优先级（P2）

#### G-12 间距脱离 4px 刻度

`gap:14px; padding:18px`（css:1）vs 其他 Tab 内容统一 `px-4 py-4`=16px（`SubagentRunDetailContent.tsx:24`）；`5px 9px`（css:2）、`8px 0`（css:7）、`12px`（css:5）。18px 让 Goal Tab 与相邻 Tab 内容边距肉眼可见不对齐。

#### G-13 `overflow-wrap:anywhere` 与 `break-words` 双策略并存

容器级 `overflow-wrap:anywhere`（css:1）对英文单词任意断行；h2 又指定 `break-words`（`:138`）。换行行为随元素层级漂移，英文目标文本会被拆得支离破碎。应统一为 `overflow-wrap:break-word`（或仅对确需断行的长串使用 anywhere）。

#### G-14 details/summary 无展开指示

css:6 仅 muted 色 + pointer，无 chevron 图标、无 open/close 过渡；`:147` scope `<ul>` 无列表样式处理。用户无法感知「这里可以点开」。

#### G-15 内联确认组无视觉容器

预算追加确认组（`:148-157`，含 4 段长文案 + 2 按钮）与暂停保存确认组（`:133-135`）都是 `role=group` 但无边框/背景/内边距，与普通说明文字混排成一坨。违反设计语言 L206-219「内嵌信息块应复用邻近卡片的边框、背景、圆角、阴影强度」。

#### G-16 外壳问题（仅记录，建议另行 feature，不属 Goal 组件）

- `WorkspaceInspector.tsx:2096` Tab 关闭按钮 `hover:bg-black hover:text-white`——暗色模式下黑底几乎不可见。
- aside 无 `border-l`（`:1932-1938`）且与主对话区同为 `bg-background`，侧栏边界靠宽度差区分，违反「分割线要统一」（L37-39）。
- Tab 头部 `pr-[5.5rem]`（`:1955-1956`）硬编码为 App 层浮层让位，布局耦合。

---

## 三、Surface ②：置顶摘要 Goal 分区（GoalSummarySection）

24 行 React 组件 + 13 行 css。**文案层面达标**：两行纯导航，无说明性长文案，全部是状态/数据投影（状态词、目标、blocker/summary、`{n}/{m} 项验收标准`）——这是四个 surface 里文字纪律最好的。问题集中在样式细节：

| 编号 | 级别 | 问题 | 证据 |
|---|---|---|---|
| S-01 | 低 | 值硬编码脱离刻度：`gap:5px; padding:6px 8px; font-size:12px`（12px 与相邻 Tailwind `text-xs` 同值但写法孤立），且是全仓库两个独立 css 之一 | `goal-summary.css:4/7/10` |
| S-02 | 低 | 第二行兜底链 `blockerHint \|\| blocker \|\| summary \|\| t('goalTitle')` 全空时显示「目标」二字——语义为零的占位噪音，与首行状态词重复 | `GoalSummarySection.tsx:21`、i18n.ts:2535 |
| S-03 | 低 | 状态词无 tone 色彩：控制条有 `data-tone` 五档（index.css:6823-6827），摘要是纯 muted 文本，同一状态在两 surface 视觉不呼应 | `GoalSummarySection.tsx:20` |

---

## 四、Surface ③：输入框控制条（goal-control-strip）

565 行原生 DOM 控制器 + `index.css:6803-6924、7826-7827` 约 15 个选择器。**正面记录（C-05）**：有 640px media query（6916-6919）、`prefers-reduced-motion` 降级（6921-6924）、hover/active/focus-visible 完整反馈（6889-6897）、pause/resume 复用同一节点保焦点——这条 surface 的交互纪律是四个里最好的。问题如下：

#### C-01 中：tone 色三值硬编码且两处重复定义

`index.css:6823-6827`（strip）`#3478d4` / `#d97706` / `rgb(4 143 101)`，与 `:6930`（card）同值重复定义两份。未上升为语义 token（如 `--quickforge-goal-tone-info/warning/success` 统一声明），暗色模式下 `#3478d4` 的对比度未经验证；两处将来必然漂移。

#### C-02 中：信息密度超出自身设计文档——「单行极简」变成「单行全家桶」

- `.ts` 头注释（`goal-control-strip.ts:16-19`）：「renders only a single compact row: a status icon, a short status label and at most two icon buttons… **The full card / summary view owns the objective**, criteria, scope, budget, evidence and notes.」
- `index.css:6803-6807` 注释同样声明「One in-flow row — status icon + short label + at most two icon buttons」。
- **实现**：`goal-control-strip.ts:354-357` 创建 objective/duration 节点，`:391` `host.append(icon, label, objective, duration, spacer, cancel, open)`，`:422-424` 每次渲染写入**目标全文**（12px 单行截断）与「已记录 N 秒」（11px）。实际单行内容 = icon + 状态词 + 目标全文 + 时长 + [错误] + spacer + [暂停/继续] + 取消 + 打开摘要，取消确认态再追加 3 个节点（`:492`）。
- **定性**：这是用户「过多说明性文字」观感的直接来源之一，也是**实现与设计意图的漂移**——设计原型（`design-mockups/goal-pinned-summary.html` L1327-1329 说明表）明确「控制条不放目标正文」。目标全文已在置顶摘要首分区展示（Surface ②），控制条再放一遍是重复。
- **方向**：回归自身注释的承诺——icon + 状态词 + 时长（时长是有价值的新信息可保留）+ 两个 icon 按钮；objective 移除或仅在摘要不可见时兜底；行宽不够时按优先级截断。

#### C-03 低：字号单位与写法混用

`0.75rem/0.6875rem`（`:6853/6863`）与 `12px/11px` 直写（`:7826-7827`）并存，同为 12px 的 label 与 objective 一个 rem 一个 px。

#### C-04 低：阴影颜色硬编码

`box-shadow: 0 1px 2px rgb(15 23 42 / 0.04)`（`:6820`）为亮色定制，暗色模式下阴影不可见/不适配（控制条在暗色下失去「轻卡片」层次）。应使用跟随主题的阴影 token。

---

## 五、Surface ④：聊天 Goal 卡（goal-card）

旧 surface（`goal-card.ts` + `index.css:6926-7310` 约 40 选择器），重设计后不再是主入口但仍挂载在聊天区：

#### K-01 中：Note 双份平铺——「说明文字过多」的结构性根源

`GoalInspectorContent.tsx:79` 复用 `buildGoalCardViewModel`，`:158` 将 `noteKeys` 逐条平铺渲染；聊天卡（`goal-card.ts:116-147` `noteKeysForStatus` 同一映射）也渲染同一批。**paused 状态下用户同屏看到 6 条 Note（聊天卡 3 + 侧栏 3），其中 3 条逐字重复**。重设计后侧栏是详情中心，聊天卡应降级为「状态 + 打开侧栏」，Note 只保留一处（建议侧栏收拢后承接，见 T-G）。

#### K-02 中：视觉权重倒挂

旧卡有 tone 色条、criteria/evidence/scope/stats 分区样式（约 40 选择器，投入充分）；新侧栏（主 surface）反而扁平零样式（G-07）。样式资产应随信息架构迁移到侧栏，聊天卡减重。

#### K-03 低：i18n 重复 key

`goalActionSubmitting`（i18n.ts:2597）与 `goalActionInProgress`（:2624）中英文**逐字相同**（更新中…/Updating…），消费方分别是 `goal-card.ts:731` 与 `goal-control-strip.ts`。两个 key 表达同一语义，维护必漂移，应合并。

---

## 六、说明性文字专项

### 6.1 规模统计（每语言 100 条 goal key）

| 类别 | 条数 | 占比 |
|---|---|---|
| 状态标签 | 23 | 23% |
| 按钮操作/aria | 20 | 20% |
| 字段标签/模板 | 17 | 17% |
| **说明性文字**（`*Note` 后缀 15 条） | **25** | **25%** |
| 错误提示 | 14 | 14% |
| 对话框标题 | 1 | 1% |

长说明（≥25 字）10 条，最长的 `goalNeedsReviewAcceptNote` 42 字（i18n.ts:2608）。位置：en 约 i18n.ts:788-879 / zh 约 2535-2626，预算确认组另在 en 17-23 / zh 1764-1770。

### 6.2 同屏平铺最坏情形

`needs_review` 状态侧栏 progress 视图一屏可达：blocker 长句 + summary + 每条准则 + 每条证据折叠 + 范围预算折叠 + 预算确认 4 段长文案 + **3 条 Note 连排**（`goalNeedsReviewNote` + `goalNeedsReviewAcceptNote` 42 字 + `goalNeedsReviewContinueNote`）+ 按钮行；聊天卡再重复 3 条 Note。这还不含控制条的目标全文与置顶摘要的目标重复展示。**信息密度远超「工具感、克制」的设计基调。**

### 6.3 冗余重复组（T-01~T-08）

| 编号 | 语义 | 涉及 key（zh 行号） | 建议 |
|---|---|---|---|
| T-01 | 「不回滚」×2 | goalPauseCancelNote(2601) + goalCancelConfirmMessage(2620) | 保留取消确认弹窗处一句；Note 不再常驻平铺 |
| T-02 | 「需要确认」×4 | goalStatusAwaitingConfirmation(2537) + goalConfirmNote(2600) + goalResumeNote(2602) + goalBudgetReconfirm(1768) | 状态词已表达；Note 收进 `?` 浮层 |
| T-03 | 「继续执行」同文 ×3 | goalContinue(2612) / goalKeepWorking(2621) 中文**逐字相同**，英文才区分；goalNeedsReviewContinueNote(2610) 再复用该词 | goalKeepWorking 改「继续工作」，与 en（Keep working）对齐 |
| T-04 | 重复 key | goalActionSubmitting(2597) ≡ goalActionInProgress(2624) | 合并为一个 key（=K-03） |
| T-05 | 状态词+Note 冗余 | goalStatusAwaitingInput(2540)+goalAwaitingInputNote(2604)；AwaitingApproval(2541)+Note(2605) 同理 | 状态词保留；Note 改语境中立或删除 |
| T-06 | 「预算耗尽」×4 | goalBlockerIterationBudget/DurationBudget(2565-2566) + goalExtendOpen(1765) + goalBudgetActual(1767) | 结构化预算展示（G-09）后自然合并为 1 处 |
| T-07 | 暂停机制解释 ×3 | goalPauseSaveNote(2576) + goalSaveConfirmPause(2586) + goalPausingNote(2606) | 保留操作时（保存确认）一处；其余收浮层 |
| T-08 | 「人工验收」×2 | goalNeedsReviewAcceptNote 尾句(2608) + goalEvidenceHumanAccepted(2613) | 保留证据标签；Note 尾句删除 |

### 6.4 收敛策略（T-A~T-G，对齐 DESIGN_LANGUAGE L187-191）

> 设计语言原文（L187-191）：「大段辅助说明（机制解释、解析规则、字段含义等）不应长期平铺在页面上，应收拢到标题或字段旁的 `?` 浮层中……保留标题与简短 helper 文本（一行能说清的），把多句机制说明收进浮层。」

- **T-A 侧栏 Note 降为「1 行可行动提示 + `?` 浮层」**：每个状态保留 ≤16 字的一行提示（如 paused：「已暂停——继续前需重新确认预算与范围」），机制长句全部进 `?` 浮层。3 条连排 → 1 行。
- **T-B 取消语义合并**：「不回滚」只在取消确认处出现一次（T-01）。
- **T-C 消除同文按钮**：「继续执行/继续工作」分工（T-03）。
- **T-D 合并重复 key**（T-04）。
- **T-E 语境中立化**：侧栏 awaiting_* 的 Note 改「等待聊天区的输入/审批」或直接依赖状态词（G-10、T-05）。
- **T-F 数据本地化**：ISO 时间 → 本地/相对时间；`goalBudgetActual` 毫秒拼接 → 「已用 8/16 轮 · 12/30 分钟」结构化展示（G-09）。
- **T-G 双 surface 分工**：Note 只在侧栏（收拢后）显示，聊天卡不再平铺（K-01）。

**预期效果**：`needs_review` 一屏文字量约减少 60%（6 条重复 Note → 1 行 + 浮层；4 段预算文案 → 1 行结构化数据 + 浮层）。

---

## 七、设计语言符合性对照

| DESIGN_LANGUAGE 条款 | 现状 | 问题编号 |
|---|---|---|
| L21-27 以对话区为视觉基准、其他区域看齐 | 侧栏按钮比全应用按钮更弱更裸 | G-03 |
| L37-39 分割线统一 | aside 与对话区无分隔线 | G-16 |
| L63-88 字体层级体系化（正文统一/标题小而轻/辅助更弱） | 16/13/12 混用、13px 不在刻度 | G-06 |
| L106-131 Hover 有感知不跳动 | 侧栏按钮**零** hover 反馈 | G-03 |
| L156 按钮 `:active` scale(0.97) | 无 | G-03 |
| L139-148 动效统一 token | 无任何 transition | G-03、G-14 |
| L166-185 图标与文字（icon-only 需可访问名称） | 侧栏 details 无展开指示图标 | G-14 |
| **L187-191 辅助说明应收拢进 `?` 浮层** | 3 条 Note 连排 ×2 surface 平铺 | **T 系列、K-01** |
| L206-219 内嵌信息块复用邻近卡片样式 | 内联确认组零容器零样式 | G-15 |
| L210 禁止未验证的语义色透明度拼法 | `color-mix(var(--muted) 40%, transparent)` 属同类拼法（未验证弱化效果） | G-03 附带 |
| L234-244 圆角中等、刻度化 | radius 7/8px 随手值 | G-11、G-12 |
| L248-259 禁忌（hover 无反馈/层级字号 padding 不一） | 均有触犯 | G-02、G-03、G-06、G-12 |

---

## 八、修复优先级路线图

| 级别 | 内容 | 涉及 |
|---|---|---|
| **P0（阻断可用性/高频可见，先做）** | 侧栏内容区加滚动；按钮接入 Button 体系；textarea min-height 视口化；侧栏 Note 收敛为 1 行 + `?` 浮层；「不回滚」合并到取消确认 | G-01、G-03、G-04、T-A、T-B |
| **P1（体验与一致性）** | 动作行 flex-wrap + 断行策略（一行改动，可随 P0 顺带）；导航/动作按钮分层；字号刻度化；信息层级与 tone；准则状态 badge；时间/预算本地化；Note 语境修正；tone token 化；控制条回归极简（移除 objective）；聊天卡 Note 去重与视觉资产迁移；「继续执行」分工 | G-02、G-05~G-11、C-01、C-02、K-01、K-02、T-C~T-G |
| **P2（打磨）** | 间距刻度；断行策略统一；details 指示；确认组容器；摘要三项；字号单位/阴影；合并重复 key | G-12~G-15、S-01~S-03、C-03、C-04、T-D |
| **另行 feature（不扩范围）** | 外壳三问题 | G-16 |

---

## 九、优化示例对照索引

配套示例 `design-mockups/goal-inspector-optimization.html`（自包含单文件，Before/After 对照）演示以下修复方案，编号与本文一致：

| 示例区块 | 演示问题 |
|---|---|
| 侧栏 Before/After 对照 | G-01（滚动裁剪）、G-02（按钮行换行与断行策略）、G-03（按钮体系）、G-05（导航分层）、G-06（字号）、G-07（层级/tone）、G-08（状态 badge）、G-09（时间/预算格式化）、G-15（确认组容器） |
| 说明文字收敛演示 | T-A（1 行 + `?` 浮层）、T-01/T-02/T-03/T-06 合并效果 |
| 控制条 Before/After | C-02（单行极简 vs 全家桶） |

---

## 附录：证据文件清单

| 文件 | 关键位置 |
|---|---|
| `src/components/workspace/GoalInspectorContent.tsx` | :79、:118-160（全文已核对） |
| `src/components/workspace/goal-inspector.css` | :1-8（全文已核对） |
| `src/components/workspace/WorkspaceInspector.tsx` | :244-262、:1932-1938、:2209、:1955-1956、:2096 |
| `src/components/workspace/SubagentRunDetailContent.tsx` | :24 |
| `src/components/git/GoalSummarySection.tsx` | :15-23（全文已核对） |
| `src/components/git/goal-summary.css` | :1-13（全文已核对） |
| `src/components/chat/panel-decoration/goal-control-strip.ts` | :13-26、:297-393、:416-502 |
| `src/components/chat/panel-decoration/goal-card.ts` | :97-114、:116-147、:731 |
| `src/index.css` | :23、:620-629、:6803-6924、:6926-7310、:7826-7827 |
| `src/lib/i18n.ts` | zh 2590-2626（已核对）、en 788-879、预算组 en 17-23 / zh 1764-1770 |
| `DESIGN_LANGUAGE.md` | 全文 268 行（已核对） |
| `design-mockups/goal-pinned-summary.html` | 区域结构（对照原型意图） |
