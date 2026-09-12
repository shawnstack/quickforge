# Goal 功能显示交互评审（显示与交互层）

- 评审日期：本轮会话（基线：goal-ui-live-ticker-grouped-summary 及其续报微调之后的当前工作树——含 Inspector 无限时长行隐藏、SPINNING_STATUSES 移除 planning、strip fit-content 宽度，见 progress.md:1/:3-5）
- 评审性质：纯只读评审，不修改生产代码；优化建议的采纳由用户决定
- 评审对象：Goal 功能的**显示与交互层**（7 个显示 surface），与 `docs/reviews/goal-design-review.zh-CN.md`（服务端设计层）互补
- 引用门槛：本文所有 `文件:行号` 引用均由父 Agent 在当前工作树逐条亲自读取核实

---

## 一、评审范围、方法与结论速览

本轮覆盖 7 个显示 surface：

1. 输入框上方运行条（goal-control-strip.ts）
2. 置顶摘要分区 + 胶囊段（GoalSummarySection.tsx / GitToolsPinnedSummary.tsx）
3. Workspace Inspector Goal Tab 及其入口（GoalInspectorContent.tsx / goal-inspector.css / WorkspaceInspector.tsx）
4. 聊天迭代分隔线 + 内部消息隐藏（goal-iteration-divider.ts / goal-internal-message.ts）
5. goal_report 历史工具卡（local-tools.ts GoalReportToolRenderer / goal-report-history.ts）
6. 状态门禁与编排层（goal.ts / goal-ui.ts / goal-edit.ts）
7. i18n 文案层（i18n.ts goal key 块）

方法：先由两路只读调研产出 surface 现状地图与历史评审残留对照，父 Agent 再对全部关键引用逐条亲读核实（含历史标记「待复核」的 12 项），最后汇总为本报告。历史评审编号沿用各原文档并带体系前缀区分（见第十一节撞号说明）。

**结论速览**：goal-ui-p0-budget-120 之后各 surface 的骨架质量明显提升（滚动容器、按钮体系、tone 状态行、预算计量条、实时 ticker、分组化摘要均正常工作）；当前最值得投入的可优化点集中在四类——

- **交互语义错位（P0）**：open 入口目的地不一致且预算追加确认组不在落点视图；执行期失败轮分隔线仍用对勾；一批文案仍在承诺已被自动执行契约废除的「人工确认」。
- **信息缺口/文档漂移（P1）**：无限时长 goal 的 Inspector 时长行按续报微调有意隐藏，但 docs/wiki 仍声称「显示无限与累计用时」，且终态后无任何累计时长回显；运行条与 Inspector 的时长取整口径互相矛盾；错误提示行键盘不可达。
- **死代码与维护噪音（P2）**：822 行 goal-card DOM 控制器 + 配套 CSS + 一批仅死代码消费的 i18n key；accept 通道「看似可达实则恒关」；空壳 plan-confirmation 控制器。
- **样式债务（P1/P2）**：tone 色值已扩散到 4 组以上定义；置顶摘要无终态过滤。

---

## 二、Surface 1：输入框上方运行条（goal-control-strip.ts，609 行）

### 现状（已核实）

- 接线：仅主聊天创建（Side Chat / 只读 / 分享 / ACP 会话被 enabled 门禁排除），`src/components/chat/ChatPanelHost.tsx:745-761`；每次装饰循环 `goalStrip?.update()`（`ChatPanelHost.tsx:1264`），cleanup（`ChatPanelHost.tsx:1832-1833`）。
- 渲染：单行 `section.quickforge-goal-strip`，骨架节点只建一次、原地变更（`goal-control-strip.ts:355-430`），保键盘焦点与 `aria-live` 稳定。
- 状态分支：终态整行消失（`goal-control-strip.ts:130`）；tone 映射 `:109-115`；planning/awaiting_confirmation 用清单图标（`:143-151`）；spinning 态图标旋转（`src/index.css:6883-6885`）。
- 主动作门禁：running/verifying/pausing→pause、paused→resume、其余 none（`goal-control-strip.ts:117-121`）；pausing 态禁用不假装已停（`:515`）；resume 且预算耗尽时点击改为打开摘要（`:443-446`），aria-label 切换为 goalExtendOpen（`:512`）。
- cancel：非终态可用，点击展开内联确认三件套（取消目标/继续工作），Escape 收起（`:412-426`）。
- open「⌃」：始终可用，`openSummary()` 固定打开 **edit** 视图（`:311-315`，`requestOpenGoalSummary(..., 'edit')`）。
- 1s ticker：`goal-control-strip.ts:249-260`，每次新鲜快照重锚点（`:590-593`）；≥60s 显示分钟（floor）、以下显示秒（`:168-172`）。
- 错误行：`role=alert`、可点击进 summary（`:368-373`）。

### 发现（ND-03 / ND-13 / ND-07，详见第九节）

- **ND-03（重要）**：预算耗尽的 resume 分支 aria 标为 goalExtendOpen（打开追加确认），但 `openSummary()` 固定 `'edit'`，而追加确认组只在 Inspector **progress** 视图渲染（GoalInspectorContent.tsx:238-248）——用户点「追加预算」落在没有确认组的编辑视图。
- **ND-13**：错误 span 仅 mouse click（`:368-373`），无 tabIndex/键盘 handler。
- **ND-07**：时长 floor 口径与 Inspector 的 round 口径矛盾（见 Surface 3 / 第九节）。

---

## 三、Surface 2：置顶摘要分区与胶囊段（GoalSummarySection.tsx / GitToolsPinnedSummary.tsx）

### 现状（已核实）

- 分区：带标题分组（`GoalSummarySection.tsx:33-37`：标题「Goal/目标」+ passed/total 计数）→ criteria 只读行（`:40-47`，四态 lucide 图标 + 单行截断 + passed 划线 + sr-only 状态词）→ 两行导航入口按钮（`:49-51`），点击 `requestOpenGoalSummary(..., 'progress')`（`:49`）。
- 宿主：`hasGoalSection = Boolean(goal && goalSessionId)`（`GitToolsPinnedSummary.tsx:215`），Goal 分区固定第一段（`:737-739`），仅有 Goal 也成立（`:701-709`）。
- 胶囊段：Goal 固定第一位（icon + objective 截断 + 状态词 + passed/total，`GitToolsPinnedSummary.tsx:232-244`），有 Goal 时胶囊最多 3 段（`:291`）。
- 第二行回退链：`blockerHint || blocker || summary || goalTitle`（`GoalSummarySection.tsx:51`）。

### 发现（ND-08 / ND-11 / S-02 / G11）

- **ND-08**：`hasGoalSection` 无终态判断（`:215`），completed/failed/cancelled 的 goal 永久占据置顶摘要首位，且与运行条「终态整行消失」（goal-control-strip.ts:130）口径不同。
- **ND-11**：`onAction` prop 声明于 props（`GoalSummarySection.tsx:13`）并由宿主传入（`GitToolsPinnedSummary.tsx:738`），但组件不消费——死参数。
- **S-02（残留确认）**：三空回退链最终显示 `goalTitle`（「目标」）占位噪音（`GoalSummarySection.tsx:51`）。
- **G11（残留确认）**：criteria 行仅按 status 渲染，`criterion.required`（视图模型保留，goal-card.ts:173）无任何视觉区分（`GoalSummarySection.tsx:40-47`）。

---

## 四、Surface 3：Workspace Inspector Goal Tab 及入口（GoalInspectorContent.tsx 263 行 / goal-inspector.css 347 行 / WorkspaceInspector.tsx）

### 现状（已核实）

- Tab 生命周期：`kind: 'goal'` 的 tab 不持久化（`workspace-inspector-tabs.ts:46-51` 持久化类型不含 goal），按 sessionId+goalId 复用（`:39-44`）；goalBinding 身份不匹配时显示 goalUnavailable（`WorkspaceInspector.tsx:2241-2244`）。
- 打开链路：`requestOpenGoalSummary` → window 事件（`goal-ui.ts:424-434`）→ `App.tsx:1100-1111`（view edit/progress 透传）→ `WorkspaceInspector.tsx:1034-1039`。
- 渲染结构：滚动容器（G-01，`goal-inspector.css:22-34`）+ 底部固定动作栏（`:304-320`）；progress/edit 分段导航（`GoalInspectorContent.tsx:184-187`）；tone 状态行 + `?` 浮层 + 本地化时间（`:188-193`，浮层 Escape/外点关闭 `:48-74`）；progress 视图：h2 目标 → blocker 警示条 → summary → 验收 badge 四态（`:208-218`，css `:175-199`）+ evidence `<details>`（`:213-219`）→ 预算两行计量条（`:221-236`，null 时长隐藏行 `:229-230`）→ scope `<details>`（`:237`）→ extend_resume 内联确认组（`:238-248`，**仅 progress 视图**）→ 单行状态提示（`:249`）。
- edit 视图：textarea readOnly 门禁（`:195-202`）、conflict alert、运行中保存先弹「暂停并保存」内联确认（`:151-165, 254-256`）、Ctrl/Cmd+Enter（`:198`）。
- 底部动作门禁（progress，`:258`）：`model.confirmable`（恒 false）、`model.accepting`（恒 false，见 ND-01）、`model.resumable` + 耗尽切换 extend_resume。
- 编排：`goal-ui.ts` 模块级 store——pending 同步锁 + dirty 拦截写 error（`:388-393`）、终态释放 dirty（`:348-363`）；`goal-edit.ts` 运行中保存 pause→轮询→revise（`:24-123`，15s 超时/身份漂移各自报错 `:29-49`）。

### 发现（ND-01 / ND-06 / ND-07 / ND-19 / G07 / G05 / formatGoalTime）

- **ND-01（重要）**：accept 按钮不可达——`buildGoalCardViewModel` 固定 `accepting: false`（goal-card.ts:166），Inspector accept 分支（GoalInspectorContent.tsx:258）永不渲染；而 `goalCanAccept/goalAcceptanceCheck` 是活逻辑（goal.ts:314-328，acceptBlocked 仍消费）。needs_review 状态下用户只有 resume 一条路，无法人工验收。
- **ND-06（定性修正）**：无限时长 goal（maxActiveDurationMs=null）的时长行整体隐藏（GoalInspectorContent.tsx:229-230）——该隐藏是 goal-ui-live-ticker-grouped-summary 续报微调的**有意决策**（progress.md:1、:3-4 记录；tests/frontend/goal-budget-inspector.test.ts 已锁定「hides the duration budget row when unlimited」断言）。残留两个真问题：① `docs/wiki/README.md` Goal 模式段仍声称「Inspector 显示无限与累计用时」，文档未随微调同步；② 终态后运行条整行消失（goal-control-strip.ts:130），历史回看无任何累计时长展示。`goalUnlimitedTime` key 的「仍在用」仅指 goal-card.ts:546 死代码（见 ND-02），生产无消费。
- **ND-07**：取整口径矛盾——Inspector 用 `goalDurationMinutes`（round，且 <1 分钟记 1 分钟，goal.ts:330-334），运行条用 floor（goal-control-strip.ts:168-172）。同为 90 秒时运行条显示「已记录 1 分钟」、Inspector 预算行显示「2 分钟」。
- **ND-19 / G07（部分残留）**：footer 按钮无 title 解释 dirty/pending 禁用原因（运行条有 blockedTitle，goal-control-strip.ts:159-165）；点击后 runGoalUiAction 的 dirty 拦截会写 error 并显示（goal-ui.ts:389-393），有事后反馈、无悬停提示。
- **G05/U2（残留确认）**：浮层宽度 `min(290px, 100%)`（goal-inspector.css:118），极窄面板下 `100%` 可能远小于内容宽，静态风险未实测。
- **formatGoalTime（残留确认）**：`toLocaleString()` 完整日期时间（GoalInspectorContent.tsx:34-37），信息密度高。

---

## 五、Surface 4：聊天迭代分隔线与内部消息隐藏（goal-iteration-divider.ts / goal-internal-message.ts）

### 现状（已核实）

- 分隔线挂每轮 primary 消息宿主末尾（`message-actions.ts:640-642`），渲染「Planning / Iteration N · 结果标签」（`goal-iteration-divider.ts:16-30`）；marker 校验与降级移除 `:8-14`；幂等 append 根末尾 `:48`。
- 内部消息：metadata `quickforgeGoalRun` 的 user 消息加可逆类（`goal-internal-message.ts:12-16`）；CSS 保留宿主作轮边界但隐藏气泡——**无 divider 的宿主整体 display:none**（`src/index.css:3365-3368`），有 divider 的宿主强制可见（`:3370-3376`）。
- divider 的 DOM 稳定性被产物卡锚点回退依赖（`assistant-artifact-card.ts:589-593`）。

### 发现（G10 / U3 / U6）

- **G10（残留确认）**：图标仅对「planning 且非 running」换叹号（`goal-iteration-divider.ts:33-35`）；execution 的 error（「本轮失败，准备重试」）/ blocked / cancelled 轮仍用对勾——绿色对勾配失败文案，语义矛盾。
- **U3（静态风险确认）**：displayEntries 索引错位等异常导致 divider 未挂载时，内部消息宿主连同轮边界一起消失（`src/index.css:3365-3368` 的 `:not(:has(...))` 机制）。静态推断，未动态复现。
- **U6（机制确认）**：divider append 根末尾（`goal-iteration-divider.ts:48`）与产物卡/操作栏各自 append 根末尾并存（`assistant-artifact-card.ts:589-593` 回退锚点），依赖装饰顺序，属健壮性问题，未复现错序。

---

## 六、Surface 5：goal_report 历史工具卡（local-tools.ts / goal-report-history.ts）

### 现状（已核实）

- 视图模型 `buildGoalReportHistoryViewModel`（`goal-report-history.ts:32-72`）：status 派生 error/running/done/called；仅 `action==='plan' && summary && criteria` 认定已记录计划（`:51`）；输出显式声明「历史工具结果，非当前状态」（`:55-57`）。
- 渲染（`local-tools.ts:1048-1117`）：`details[data-tone]` 折叠卡 + 靶心图标 + tone 标题 + 四态准则图标 + scope chips + blocker 警示条 + detailed 模式 JSON；tone 映射 `:1049-1056`。
- 该 surface 无任何历史评审文档复核记录（此前各评审报告未覆盖 goal-report-tone-card 落地后的成品），本轮为首查。

### 发现（G09 / ND-05 关联）

- **G09（残留确认）**：plan 后快照 status=awaiting_confirmation 时 resultKey 用 goalReportWasWaiting「当时等待确认」（`goal-report-history.ts:55-57`，i18n.ts:830/:2624）。在自动执行契约下 awaiting_confirmation 已是「计划就绪、等自动执行屏障」的过渡态，该文案沿用旧语义会让用户误以为此 goal 曾等待人工确认。
- 渲染细节（`:1106`）：`data-quickforge-goal-plan-action` 空锚点 div 仍在每次渲染输出（见 ND-10）。
- 准则图标色硬编码散点：passed `rgb(4 143 101)`（`src/index.css:7053`）、needs_review `#d97706`（`:7065`），独立于 tone 变量体系（见 C-01）。

---

## 七、Surface 6：状态门禁与编排层（goal.ts / goal-ui.ts / goal-edit.ts）

### 现状（已核实）

- 状态集 13 个（goal.ts:10-23）；终态/spinning 集合 `:253-262`；`goalIsEditable`（awaiting_confirmation/paused/blocked，`:278-280`）；`goalCanConfirm` **恒 false**（`:282-285`，注释声明 API 兼容保留）；pause/resume/cancel 门禁 `:287-297`；`goalAcceptanceCheck/goalCanAccept` 活逻辑 `:314-328`；`goalBudgetExtension`（轮次 +8、时长恒 0、stillExhausted，`:95-105`）。
- goal-ui store：会话+goal 键控、draft LRU；pending 同步锁 + dirty 拦截（goal-ui.ts:388-393）+ 失败写 error 广播（`:402-417`）+ 终态释放 dirty（`:348-363`）。
- goal-edit：pause→轮询至 paused 且非 streaming→revise，身份/基线漂移保护（goal-edit.ts:97-122）。
- 动作执行：App 侧 `handlePinnedGoalAction` 校验当前 agent/goal 后直调 `agent.updateGoal`（App.tsx:1115-1120）；保存走 `saveGoalObjective`（`:1122-1132`）。

### 发现（ND-01 / ND-02 关联）

- 门禁层与视图模型层存在**语义断层**：`goalCanConfirm` 恒 false 与 `accepting: false`（goal-card.ts:166）是两处独立硬关——confirm 侧文档已声明（goal.ts:282-285 注释），accept 侧无注释、无声明，且 Inspector 仍保留完整 accept 按钮分支（GoalInspectorContent.tsx:258）与 `goalNeedsReviewAcceptNote` 等文案（i18n.ts:894/:2688，无生产消费）。见 ND-01/ND-02。

---

## 八、Surface 7：i18n 文案层（i18n.ts goal key 块，en :787-925 / zh :2581-2719）

### 现状（已核实）

- 13 状态词 + 11 hint + 报告/预算/动作/保存错误等约 120 个 key 双语成对；`goalStatusAwaitingConfirmation` 已是中性词「Plan ready/计划就绪」（i18n.ts:789/:2583）；`goalConfirmNote`/`goalHintAwaitingConfirmation` 已按自动执行契约改写（`:886/:2680`、`:802/:2596`）。

### 发现（ND-04 / ND-05 / ND-02 死 key）

- **ND-04（重要）——契约漂移残留（G01/G02/G03 同源）**：以下文案仍承诺已被「规划正常轮末持久化后自动执行」废除的人工确认：
  - `goalCommandDescription`：en「…for your confirmation」（i18n.ts:388）、zh「等你确认后再执行」（`:2182`）——**入口级承诺，用户第一眼看到的描述就与实际行为矛盾**；
  - `goalResumeNote`「恢复…需要确认」（`:888`/`:2682`）；
  - `goalScopeChangeNote`「…重新确认」（`:889`/`:2683`）；
  - `goalHintPaused`「继续前需确认预算与范围」（`:807`/`:2601`）；
  - `goalPauseSaveNote` zh「不会自动恢复或确认」（`:2655`；en `:861` 语义同构）。
- **ND-05——已失效的「上方的卡片」语境（G-10/T-E 扩散确认）**：`goalAwaitingInputNote/goalAwaitingApprovalNote` 的「等待你处理上方的卡片」（i18n.ts:2684-2685，en `:890-891`）。聊天 goal 卡已退役（见 ND-02），这些 note 现在唯一展示位置是 Inspector 的 `?` 浮层（GoalInspectorContent.tsx:141→:191）——用户在**侧栏**看到「上方的卡片」，所指物已不存在。
- **ND-02（死 key 清单，grep 核实零生产消费方）**：`goalUnlimitedTime`（:839/:2633）、`goalActionSubmitting`（:883/:2677）、`goalExpand/goalCollapse`（:849-850/:2643-2644）、`goalContinue`（:898/:2692）、`goalBudgetValue/goalUsageValue/goalUsageLabel`（:836-842/:2630-2636）、`goalPlanConfirm/goalPlanConfirmed/goalPlanConfirming/goalPlanWait`（:852-855/:2646-2649）、`goalNeedsReviewNote/goalNeedsReviewAcceptNote/goalNeedsReviewBlockedNote`（:893-895/:2687-2689）、`goalMoreActions`（:904/:2698）、`goalSummaryDetails`（:925/:2719）、`goalEvidenceCount`（:844/:2638）——消费方均为 goal-card 死代码或不存在。
- `goalActionSubmitting` 与 `goalActionInProgress` 中英文逐字相同（「更新中…」），生产只消费后者（goal-control-strip.ts:161）。

---

## 九、新发现问题汇总（ND 编号，本轮新增）

| 编号 | 级别 | surface | 一句话 | 依据 |
|---|---|---|---|---|
| ND-01 | 中 | Inspector | accept 按钮恒不可达（accepting 硬关 false），needs_review 无法人工验收；活逻辑与死按钮并存 | goal-card.ts:166、GoalInspectorContent.tsx:258、goal.ts:314-328 |
| ND-02 | 中 | 全局 | goal-card.ts 822 行 DOM 控制器 + `.quickforge-goal-card` CSS（index.css:6962-6991）+ 空壳 plan-confirmation 控制器 + ≥14 个仅死代码消费的 i18n key + local-tools.ts:1106 空 mount | panel-decoration.ts:41 仅 re-export；tests/frontend/goal-card.test.ts:281 断言 Host 不挂载；第八节死 key 清单 |
| ND-03 | 高 | 运行条+Inspector | open 目的地分叉：strip open→edit、摘要 open→progress；预算耗尽 resume 的 aria 承诺「追加确认」实际落在无确认组的 edit 视图 | goal-control-strip.ts:311-315、:443-446、:512；GoalSummarySection.tsx:49；GoalInspectorContent.tsx:238-248 |
| ND-04 | 高 | i18n | 六组文案仍承诺人工确认，与自动执行契约矛盾（含入口 goalCommandDescription） | i18n.ts:388/:2182、:888/:2682、:889/:2683、:807/:2601、:861/:2655 |
| ND-05 | 高 | i18n | 「上方的卡片」语境彻底失效（聊天卡已退役，note 现于侧栏浮层展示） | i18n.ts:890-891/:2684-2685；GoalInspectorContent.tsx:141/:191 |
| ND-06 | 低 | Inspector | 无限时长行隐藏为有意决策（续报微调+测试锁定）；残留 wiki 未同步 + 终态后无累计时长回显 | GoalInspectorContent.tsx:229-230；docs/wiki/README.md Goal 模式段；progress.md:1 |
| ND-07 | 中 | 运行条+Inspector | 时长取整口径矛盾：floor（运行条）vs round 且 <1min 记 1（Inspector），同一时刻可差 1 分钟 | goal-control-strip.ts:168-172；goal.ts:330-334 |
| ND-08 | 中 | 置顶摘要 | 终态 goal 永久占据摘要首位且无收起机制，与运行条终态消失口径不一 | GitToolsPinnedSummary.tsx:215；goal-control-strip.ts:130 |
| ND-13 | 中 | 运行条 | 错误 span 可点击但无键盘入口（tabIndex/keydown 均无） | goal-control-strip.ts:368-373 |
| ND-19 | 低 | Inspector | footer 按钮无 title 解释 dirty/pending 禁用（有事后 error 反馈） | GoalInspectorContent.tsx:258；goal-ui.ts:389-393 |
| ND-11 | 低 | 置顶摘要 | onAction 死参数（声明+传入+不消费） | GoalSummarySection.tsx:13；GitToolsPinnedSummary.tsx:738 |
| ND-18 | 低 | Inspector | planning hint 复用 awaiting_confirmation 文案，两阶段差异被抹平 | GoalInspectorContent.tsx:18 |

（G10/G11/U3/U6/S-02/G05 等历史编号的复核结论见第十节，不重复编号。）

---

## 十、历史编号对照表与「待复核」结论

状态以当前工作树源码为准；「待复核」为本轮调研标记、经父 Agent 亲读后给出明确结论。

### 10.1 goal-ui-review.zh-CN.md（G-01~G-16 / S / C / K / T 体系）

| 编号 | 一句话 | 当前状态 | 依据 |
|---|---|---|---|
| G-01 | 侧栏无垂直滚动 | 已修复（goal-ui-p0-budget-120） | goal-inspector.css:22-34 |
| G-02 | 动作行换行保护 | 已修复 | GoalInspectorContent.tsx:315-320（flex-wrap） |
| G-03 | 按钮体系脱节 | 已修复 | GoalInspectorContent.tsx:252-258（Button 组件 + variant） |
| G-04 | textarea 硬编码 | 已修复 | goal-inspector.css:322-333（min(260px,40vh)） |
| G-05 | 导航/动作同款 | 已修复 | GoalInspectorContent.tsx:184-187 分段导航 |
| G-06 | 字号混用 | **待复核→部分修复**：inspector 内已收敛单一标题刻度（css:130 注释「one title scale (15px)」，15/13/12/11 层级化）；跨 surface 仍有 14px（GoalSummarySection.tsx:41 text-sm）与 12px（goal-summary.css:10）并存，属 P2 打磨 | goal-inspector.css:130-137 |
| G-07 | 信息层级无 tone | 已修复 | goal-inspector.css:68-87 |
| G-08 | 准则纯文本 | 已修复 | goal-inspector.css:166-199 四态 badge |
| G-09 | 时间/预算未本地化 | 主体已修复；残留 formatGoalTime 完整格式（GoalInspectorContent.tsx:34-37） | — |
| G-10 | 「上方的卡片」语境 | **残留且恶化**（语境彻底失效，见 ND-05） | i18n.ts:890-891/:2684-2685 |
| G-11 | 双 CSS 体系 | **待复核→结构残留**：goal-inspector.css 独立文件与 index.css goal 段（:6843-7088）并存 | 两文件现状 |
| G-12 | 间距脱离 4px 刻度 | **待复核→轻微残留**：goal-summary.css:4 gap 5px 等；inspector 内 2/4/6/8/10/12px 已合规 | goal-summary.css:1-13 |
| G-13 | overflow-wrap 双策略 | 已修复（inspector break-word + report 卡 anywhere） | goal-inspector.css:13 |
| G-14 | 无展开指示 | 已修复（▸ 旋转） | goal-inspector.css:211-217 |
| G-15 | 确认组无容器 | 已修复 | goal-inspector.css:277-286 |
| G-16 | 外壳三问题 | **残留（前两点亲读确认）**：pr-[5.5rem]（WorkspaceInspector.tsx:1957）、Tab 关闭 hover:bg-black hover:text-white（`:2097`）；「aside 分隔线」一点以原报告为准，本轮未逐项复核 | WorkspaceInspector.tsx:1957/:2097 |
| S-01 | 摘要 css 硬编码 | **待复核→残留** | goal-summary.css:1-13（px 硬编码） |
| S-02 | 兜底链占位噪音 | **待复核→残留** | GoalSummarySection.tsx:51（goalTitle 兜底） |
| S-03 | 摘要状态词无 tone | 部分覆盖：criteria 四态图标已加（GoalSummarySection.tsx:17-22）；胶囊段状态词仍无 tone（GitToolsPinnedSummary.tsx:240） | — |
| C-01 | tone 色值重复 | **残留且扩大**：现 4 组定义（index.css:6859-6863 strip、:6987-6991 goal-card 死、:7014-7018 report-tool、goal-inspector.css:16-20）+ 散点（index.css:7053/:7065、goal-inspector.css:6-7） | 上述行号 |
| C-02 | 控制条单行全家桶 | 已修复（objective 六处移除） | goal-control-strip.ts 现状 |
| C-03 | rem/px 混用 | 残留（index.css:6906-6907 cancel-note 12px 与相邻 rem 混用） | index.css:6906-6907 |
| C-04 | 阴影硬编码 | 残留（index.css:6856/:6976/:7003 `rgb(15 23 42 / 0.04)`） | 上述行号 |
| K-01 | 聊天卡+侧栏 Note 双显 | **重新定性：产品层已消解**——聊天 goal 卡已退役（ND-02），noteKeys 唯一生产消费是 Inspector 浮层（GoalInspectorContent.tsx:141）；残留问题转为 ND-05 语境错误 | goal-card.ts:116-145 |
| K-02 | 视觉资产主次倒挂 | **待复核→产品层已消解**（聊天卡退役）；转化为死资产问题（ND-02） | goal-card.ts:236 |
| K-03 | 两 key 同文 | **待复核→残留**：goalActionSubmitting（死）与 goalActionInProgress（活）中英文逐字相同 | i18n.ts:883/:923、:2677/:2717 |
| T-01/02/05/06/07/08 | 冗余 Note 组 | 大部分已随 T-A 收敛（noteKeys 仅入浮层；needs_review 只挂 1 条、paused 3 条） | goal-card.ts:116-145 |
| T-03 | 「继续执行」同文 | 已修复（goalKeepWorking 改「继续工作」） | i18n.ts:907/:2701 |
| T-04/T-D | =K-03 | 残留 | 同 K-03 |
| T-E | Note 语境 | 残留（=G-10=ND-05） | — |
| T-G | 双 surface Note 分工 | 随 K-01 重新定性（生产已无双显） | — |

### 10.2 goal-ux-ui-review.zh-CN.md（G01–G11 体系，均无生产修复记录）

| 编号 | 一句话 | 当前状态 | 依据 |
|---|---|---|---|
| G01 | 入口文案承诺「等你确认」 | 残留（=ND-04） | i18n.ts:388/:2182 |
| G02 | 保存文案否认自动恢复 | 残留（=ND-04） | i18n.ts:861/:2655 |
| G03 | 恢复/范围要求「重新确认」 | 残留（=ND-04） | i18n.ts:888-889/:2682-2683、:807/:2601 |
| G04 | 预算继续误开 edit | 残留且加重（=ND-03：确认组不在落点视图） | goal-control-strip.ts:311-315/:443-446 |
| G05 | 浮层百分比宽度风险 | 残留（静态） | goal-inspector.css:118 |
| G06 | 错误可点击无键盘 | 残留（=ND-13） | goal-control-strip.ts:368-373 |
| G07 | dirty 禁用不解释 | **待复核→部分残留**：有事后 error 反馈（goal-ui.ts:389-393），无 hover title | GoalInspectorContent.tsx:258 |
| G08 | 侧栏缺回聊天待办入口 | **待复核→残留**：awaiting_* hint 指向聊天区（i18n.ts:804-805/:2598-2599），Inspector 无导航回聊天入口 | GoalInspectorContent.tsx 全文 |
| G09 | 历史误标「当时等待确认」 | **待复核→残留**（语义漂移） | goal-report-history.ts:55-57；i18n.ts:830/:2624 |
| G10 | execution 失败轮对勾 | 残留 | goal-iteration-divider.ts:33-35 |
| G11 | 必要/可选准则不区分 | **待复核→残留**（required 字段保留但无渲染） | GoalSummarySection.tsx:40-47；GoalInspectorContent.tsx:209-218 |

### 10.3 goal-auto-complete-validation.zh-CN.md（S/U 体系，仅 UI 侧）

| 编号 | 一句话 | 当前状态 | 依据 |
|---|---|---|---|
| U1 | 预算继续误开 edit | 残留（=G04=ND-03） | goal-control-strip.ts:311-315 |
| U2 | 浮层极窄裁切 | 残留（=G05，静态） | goal-inspector.css:118 |
| U3 | 空宿主连带隐藏 divider | **待复核→静态风险确认**：无 divider 的宿主整体 display:none | index.css:3365-3368 |
| U4 | aria 名称与目的地不一致 | 残留（goalOpenSummary「查看目标摘要」实际去 edit） | goal-control-strip.ts:384/:311-315 |
| U5 | 错误 span 无键盘 | 残留（=G06=ND-13） | goal-control-strip.ts:368-373 |
| U6 | actions/divider 重复移末尾 | **待复核→机制确认**（append 顺序依赖装饰循环，未复现错序） | goal-iteration-divider.ts:48；assistant-artifact-card.ts:589-593 |
| S1/S2/S3 | 服务端结算/时序 | 非本轮范围（服务端设计层，见 goal-design-review） | — |

### 10.4 goal-design-review.zh-CN.md（X/D/B/E 体系）

本轮范围外；其 P2 段交叉引用的前端四残留（K-01/C-01/G-16/G-10）已在上表更新结论：K-01 产品层消解（语境残留见 ND-05）、C-01 扩大、G-16 前两点确认、G-10 恶化。

---

## 十一、撞号说明（两套 G/S 体系）

历史报告存在**两套 G 编号与两套 S 编号**，含义完全不同，本报告统一以带连字符与否区分：

- `G-01~G-16 / S-01~S-03`（带连字符）= `docs/reviews/goal-ui-review.zh-CN.md` 的样式/摘要体系（G-01 滚动、S-01 摘要 css）。
- `G01~G11 / S1~S3`（不带连字符）= `docs/reviews/goal-ux-ui-review.zh-CN.md` 的 UX 契约体系（G01 入口文案）与 `goal-auto-complete-validation.zh-CN.md` 的服务端体系（S1 证据复用）。
- 特别注意：**G-10（Note「上方的卡片」语境）≠ G10（execution 分隔线对勾图标）**；**S-01（摘要 css 硬编码）≠ S1（服务端旧证据复用）**。
- 跨报告同题映射：G04=U1；G05=U2；G06=U5；G-10=T-E≈语境项；K-01=T-G；K-03=T-04=T-D。

---

## 十二、优化建议（P0/P1/P2）

### P0——交互语义正确性（用户可感知的错位/误导）

1. **统一 open 目的地与预算确认落点**（surface：运行条+Inspector；ND-03/G04/U1/U4）：`openSummary()` 按目的选 view——预算耗尽 resume 打开 **progress**（确认组所在视图，GoalInspectorContent.tsx:238-248），常规 open 统一 progress 或统一 edit 并让 aria/标题与实际目的地一致；一处修改点在 goal-control-strip.ts:311-315 与 :443-446。
2. **批量修正契约漂移文案**（surface：i18n；ND-04/G01/G02/G03/G09）：改写 goalCommandDescription（i18n.ts:388/:2182）为「只读规划并自动开始执行」；goalResumeNote/goalScopeChangeNote/goalHintPaused/goalPauseSaveNote 去除「确认」措辞；goalReportWasWaiting 改为「当时状态：计划就绪（等待自动执行）」。纯文案、低风险、高收益。
3. **执行期失败轮分隔线换图标**（surface：divider；G10）：goal-iteration-divider.ts:33-35 的叹号分支从「仅 planning」扩到 error/blocked/cancelled outcome，与「本轮失败，准备重试」等文案对齐。

### P1——明显体验缺口

4. **无限时长 goal 的 wiki 同步与终态时长回显**（surface：Inspector+文档；ND-06）：时长行隐藏为既有有意决策（续报微调，测试锁定），**不要直接改实现**；需要做的是 ① 同步 docs/wiki/README.md「Inspector 显示无限与累计用时」表述与实现一致（改文档）；② 若用户希望保留累计用时回显，可在 progress 视图其他位置（如状态行时间旁）以「已累计 N 分钟」展示，作为独立决策项（GoalInspectorContent.tsx:229-235、goal-control-strip.ts:130）。
5. **统一时长取整口径**（surface：运行条+Inspector；ND-07）：goal-control-strip.ts:168-172 与 goal.ts:330-333 二选一（建议统一 floor + <1 分钟显示秒），消除同一时刻差 1 分钟。
6. **错误行键盘可达**（surface：运行条；ND-13/G06/U5）：error span 改 button 或补 tabIndex=0 + Enter/Space（goal-control-strip.ts:368-373）。
7. **tone 色值收敛**（surface：CSS 全局；C-01）：将 4 组 `--quickforge-goal-tone` 定义收敛为一处共享（token 或共享 class），顺带收编散点（index.css:7053/:7065、goal-inspector.css:6-7）。
8. **置顶摘要终态降级**（surface：置顶摘要；ND-08）：终态 goal 折叠为单行（状态词+objective+入口）或提供收起，避免永久占据首位（GitToolsPinnedSummary.tsx:215）。
9. **「上方的卡片」语境修正**（surface：i18n+浮层；ND-05/G-10/T-E）：awaiting_* note 改为指向聊天区/输入框的中性措辞（如「等待聊天区的输入」——hint 已如此，note 对齐即可）。

### P2——清理与打磨

10. **accept 通道决策**（surface：Inspector+门禁；ND-01）：二选一——恢复 `accepting: goalCanAccept(goal)`（若保留 needs_review 人工验收语义）或彻底删除 accept 按钮分支 + goalAccept/goalNeedsReviewAcceptNote/BlockedNote key 并在 goal-card.ts:166 注释声明（当前「活逻辑+死按钮」最差）。
11. **死代码清理包**（surface：全局；ND-02）：拆分 buildGoalCardViewModel 到独立文件后删除 822 行 DOM 控制器与 .quickforge-goal-card CSS（index.css:6962-6991）；删除空壳 goal-plan-confirmation 接线（ChatPanelHost.tsx:762-776/:1265/:1833）与 local-tools.ts:1106 空 mount；清理第八节死 key 清单（注意 tests/frontend/goal-card.test.ts:216/:273/:281/:302 契约断言与 goal-card-controller.test.ts 需同步）。**建议独立 feature、单独评审测试影响。**
12. **准则 required 标识**（G11）：Inspector badge 或描述行加「必需」标记（数据已就绪：goal-card.ts:173）。
13. **formatGoalTime 精简**（G-09 残留）：toLocaleString → 短格式或相对时间（GoalInspectorContent.tsx:34-37）。
14. **planning 专属 hint**（ND-18）：STATUS_HINT_KEY 拆分 planning 与 awaiting_confirmation（GoalInspectorContent.tsx:18）。
15. **footer 按钮 title 提示**（ND-19/G07）：dirty/pending 禁用时补 title（对齐运行条 blockedTitle 模式）。
16. **awaiting_* 回聊天入口**（G08）：Inspector hint 行加「回到聊天」按钮。
17. **样式打磨包**：S-01/S-02（goal-summary.css token 化 + 兜底链去掉 goalTitle 占位）、C-03/C-04（px/rem 统一、阴影 token 化）、G-06 跨 surface 字号刻度、G-12（gap 5px→4px 刻度）、ND-11（删 onAction 死参数）、K-03（删死 key）。
18. **G-16 外壳**：pr-[5.5rem]（WorkspaceInspector.tsx:1957）与 Tab close hover:bg-black（`:2097`）按原报告路线处理（该两条非 Goal 专属，建议随外壳 feature）。

---

## 十三、验证与边界

- 本报告为纯评审交付：不修改 src/、server/、tests/、dist/、package-dist/、package-offline/，无依赖变更，无 Git 提交/发布。
- 所有 `文件:行号` 引用均经父 Agent 在当前工作树逐条亲读核实（含 12 项「待复核」的源码结论）；grep 在本工作区对多关键词组合查询有漏报史（见 progress.md 历史记录），死 key 判定均以单关键词 grep + 亲读双重确认。
- 时序/布局类风险（U3/U6/G05/U2）为静态代码推断，未做动态复现；真实浏览器视觉（窄屏/主题/焦点/读屏）不在本轮范围。
- 历史编号「已修复」判定依据 feature_list.json 修复记录 + 本轮源码现状双确认；「残留」判定以本轮源码为准。
- 采纳建议后应另开生产 feature（参照 goal-ui-p0-budget-120 的评审→采纳→落地流程），修复时同步更新 docs/wiki 与三状态文件。
