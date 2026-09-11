# Goal UX / UI 评审：让当前自动执行契约可理解、可操作

> 范围：当前工作树的 Goal 入口、聊天、控制条、置顶摘要、Inspector、历史与恢复旅程。仅评审与设计提案，不修改生产代码、API 或 Wiki；`feature_list.json`、`progress.md`、`session-handoff.md` 由父任务统一同步。旧评审仅作历史背景，本报告结论以重新核读的当前源码为准。
>
> 结论：执行契约已升级，但入口、编辑说明和部分导航仍沿用旧心智模型。建议先修低成本的 **P1 文案与导航**，再处理帮助布局、键盘反馈与信息分层；不恢复人工计划确认或人工 accept。

## 1. 依据与证据边界

- **C（代码确认）**：当前分支条件、调用链、文本或 DOM/CSS 定义可直接核实；不等于浏览器已复现影响。
- **R（源码风险）**：结构支持风险判断，实际计算布局、裁切、焦点或阅读误解仍待浏览器验证。
- **D（设计建议）**：建议的理解和操作收益尚未经过用户测试。
- 优先级为体验修复排序：P1 影响授权预期、主要路径或关键帮助；P2 影响理解、恢复效率或可访问性。不是服务端漏洞评级。
- 设计基准：`DESIGN_LANGUAGE.md:9–15,166–191,206–210`。轻盈、克制、一致、清晰；核心状态保留文字，复杂动作不能只靠图标；长解释渐进披露，复用现有弱分隔线与 token，不另起一套厚卡片体系。
- **SVG 考虑结果**：旅程有图示价值，但报告以短流程和表格更便于扫描；不另建图文件。交互原型 `design-mockups/goal-ux-ui-optimization.html` 已有交接 SVG（`svg.flow`）和状态 SVG（`icon()`，渲染至 `#stageDivider` / `#controlState`），用于解释而非装饰。

## 2. 当前完整旅程：应沿用的契约

**显式 `/goal` 范围授权 → 整轮只读规划 → 正常轮末且持久化成功 → 自动执行 → 必要准则有可信证据 → 正常轮末且最终状态保存成功 → 自动完成。**

| 阶段 | 当前事实与用户应理解的内容 | 当前源码依据 |
|---|---|---|
| 入口 | `/goal` 已授权目标范围内自动执行；不重复要求计划确认。范围不明仍问必要问题，不绕过工具审批、安全边界。 | `server/system-prompt.mjs:11`；`src/components/chat/command-suggestions.ts:87` |
| 规划交接 | plan 结果先记录在 `awaiting_confirmation` 内部状态；这个名字不能被直接解释成“等待用户同意”。整轮及保存屏障之前仍只读，正常交接才进入 execution。 | `server/agent-goal-state.mjs:286–308`；`server/agent-goal-runner.mjs:786–795,893–900,1406–1418` |
| 执行与预算 | 新 Goal 默认 **8 个执行轮次，累计时间上限为 null（无限）**；仅 execution 增加轮次用量，planning 不计入这 8 轮。记录实际累计用时，不表示无限轮次。保留防空转、重复失败、暂停取消与单工具超时。轮次是资源用量，不是完成率。 | `server/agent-goal-state.mjs:50–51,258–259`；`server/agent-goal-runner.mjs:565,832–860,911–917`；`src/components/workspace/GoalInspectorContent.tsx:221–234` |
| 问答与审批 | `awaiting_input` / `awaiting_approval` 是必要待办；用户去聊天中的原卡片处理，不是编辑目标或确认整个计划。 | `server/agent-goal-runner.mjs:903–908`；`src/components/workspace/GoalInspectorContent.tsx:22–23,248` |
| 暂停与取消 | 暂停等待安全结算；取消不等于失败或完成，也不回滚已改文件。已有草稿不应妨碍暂停/取消。 | `server/agent-goal-runner.mjs:769–779,809–830`；`src/components/chat/panel-decoration/goal-control-strip.ts:278–287,373–386`；`src/lib/i18n.ts:2680,2698–2699` |
| 恢复与追加 | 显式恢复：有计划继续执行，无准则则重新规划；移除旧时间上限但不清累计用量。轮次耗尽时显式确认追加 8 轮，保留同一 Goal；`extend_resume` 有 goalId/revision CAS。打开旧快照不是恢复指令。 | `server/agent-goal-runner.mjs:1030–1064,1102–1139`；`src/lib/goal.ts:91–104` |
| 编辑 | 运行中确认“暂停并保存”→ 等权威 paused 且非 streaming → revise → 清旧计划/证据并重新只读规划 → 正常保存后自动执行；不是“只改文字、保持暂停”。预算仍受约束。 | `src/lib/goal-edit.ts:85–114`；`server/agent-goal-runner.mjs:1202–1225,893–900`；`server/agent-goal-state.mjs:311–326` |
| 验证受阻 | 无法验证时 `needs_review` 报告落到 blocked，说明缺少什么证据或环境；允许必要问题，不用人工签字伪造 passed。 | `server/agent-goal-runner.mjs:1445–1450` |
| 自动完成 | complete 经必要准则/证据检查后先 verifying；正常轮末、终止意图检查和持久化屏障后才 completed。最后一轮成功可完成；不能把 complete 工具返回当最终完成。 | `server/agent-goal-state.mjs:505–532`；`server/agent-goal-runner.mjs:309–328,832–875,1453–1477` |
| 历史与新目标 | 历史报告和轮末 marker 是当时快照，不由当前状态反推。历史 human evidence / accept API 兼容保留，当前 UI 不提供计划确认或验收操作；新 Goal 不能借旧记录操作当前目标。 | `src/lib/goal-report-history.ts:24–44`；`src/components/chat/panel-decoration/goal-plan-confirmation.ts:5–24`；`src/lib/goal.ts:281–284`；`server/agent-goal-runner.mjs:1148–1162`（旧 `acceptGoal` 兼容入口）；`src/components/chat/panel-decoration/goal-card.ts:162–166` |

**不列为旧问题重报**：规划阶段分隔线已经识别 `kind: planning`，并区分就绪、失败、暂停等文字（`goal-iteration-divider.ts:7–35`）；规划/执行 marker 实时同步与持久化已有新实现，本次不再泛称“规划分隔线缺失”或“SSE 不同步”。G10 只讨论仍存在的 execution 图标语义。

## 3. 问题清单（G01–G11）

### G01 · P1 · 命令入口仍承诺“等你确认”

- **现状 / 引用**：命令建议实际使用 `goalCommandDescription`（`src/components/chat/command-suggestions.ts:87`）；中英内容分别仍为“等你确认后再执行”与“for your confirmation”（`src/lib/i18n.ts:388,2181`）。
- **影响**：用户可能以为执行前还有选择窗口，而服务端已按显式 `/goal` 授权自动交接。属于授权预期错位，不是建议新增确认门槛。
- **证据等级**：C；用户误解程度为 D，未做用户测试。
- **建议**：入口短句直说“只读规划，正常结束并保存后自动执行”，必要提问/审批放帮助说明。
- **验收**：中英文实际命令建议均无“待计划确认”；规划保存前不执行、成功交接后无确认按钮；必要问答审批仍有效。

### G02 · P1 · “保存不会自动恢复”与端到端效果冲突

- **现状 / 引用**：运行中编辑确认直接显示 `goalPauseSaveNote`（`GoalInspectorContent.tsx:253–256`），当前中英文均否认自动恢复（`src/lib/i18n.ts:861,2654`）。客户端仅发 pause/revise，确实不自行发 resume/confirm（`src/lib/goal-edit.ts:19–22,85–114`）；但服务端 revise 会重规划并自动交接（`server/agent-goal-runner.mjs:1202–1225,893–900`）。
- **影响**：用户同意的是“暂停后保存”，实际将开始一个新规划及执行链；不能拿客户端“不发 resume”解释面向用户的最终结果。
- **证据等级**：C（调用链和文案）；本次未实跑浏览器端到端。
- **建议**：保留必要的暂停保存确认，明确“暂停并保存修改，重新只读规划；正常结束且保存成功后自动执行”。不增加第二次计划确认。
- **验收**：运行中确认文案、普通保存按钮和帮助语义一致；正常路径 pause → 权威静止 → revise → planning → 自动 execution；暂停失败、冲突、取消保存时不偷发后续 revise。

### G03 · P2 · 恢复与范围帮助仍要求“重新确认”

- **现状 / 引用**：`goalResumeNote` / `goalScopeChangeNote` 在运行、暂停、受阻状态被选择（`goal-card.ts:116–132`），经 Inspector `notes` 显示（`GoalInspectorContent.tsx:140–141,188–192`）。旧描述仍在 `src/lib/i18n.ts:888–889,2681–2682`，暂停短提示也仍说确认预算与范围（`:807,2600`）。
- **影响**：把显式继续、预算追加确认、运行中暂停保存确认混成已取消的“重新确认计划”。
- **证据等级**：C；理解负担为 D。
- **建议**：拆开解释：有计划续跑/无计划重规划；范围变更要编辑保存；仅耗尽预算走追加确认，审批仍在原工具卡。
- **验收**：普通 resume 不新增确认流程；预算追加和暂停保存确认保留；中英状态帮助不暗示人工计划确认。

### G04 · P1 · 预算继续入口误开 edit，名称与目的地不一致

- **现状 / 引用**：控制条 `openSummary()` 固定请求 `'edit'`（`goal-control-strip.ts:271–276`）；耗尽预算的继续也复用它（`:393–407`），名称却是 `goalExtendOpen`“预算已耗尽 — 打开进度确认追加预算”（`:474–480`；中文 `src/lib/i18n.ts:1811`，英文 `src/lib/i18n.ts:18`）。普通打开按钮名仍是摘要（`goal-control-strip.ts:342–351`），而置顶摘要确实打开 progress（`GoalSummarySection.tsx:19`）。
- **影响**：用户点击预算继续进入编辑器，实际追加按钮在 progress（`GoalInspectorContent.tsx:237–257`），必须自己找路。
- **证据等级**：C；点击路径浏览器待测。
- **建议**：明确区分 openProgress/openEdit：预算继续、摘要去 progress；编辑图标去 edit 并命名“编辑目标”。**正常编辑打开 edit 是正确行为，不应一律改为 progress。**
- **验收**：鼠标/键盘激活预算入口均打开 progress 且不直接 POST；普通编辑仍进 edit；名称、tooltip、目标视图一致，旧 session/goal 身份守卫保持。

### G05 · P1 · 问号浮层百分比宽度存在布局风险

- **现状 / 引用**：相对定位父 span 只含问号按钮及绝对定位浮层（`GoalInspectorContent.tsx:69–72`）；按钮宽 18px，浮层 `width: min(290px, 100%)`，父级 `.pop` 相对定位（`goal-inspector.css:89–118`）。这里的百分比不是天然相对于整个 Inspector。
- **影响**：可能得到极窄内容区域、逐字换行或超出滚动区，关键恢复说明难读。
- **证据等级**：R。确认的是 CSS/DOM 组合，**未测 computed width，不能断言实际宽度就是 18px，也未实测裁切**。
- **建议**：先测包含块/边界；短状态帮助复用项目浮层并按容器/视口限宽，长规则可用 details。原型展示 details 方向，不代表生产必须整体替换现有浮层模式。
- **验收**：真实 340/420px Inspector、窄屏、长中英文、200% 缩放下测量浮层和滚动边界；可读且不裁切；键盘展开/关闭、焦点可见，亮暗主题均检查。

### G06 · P2 · 错误可点击但没有等价键盘入口

- **现状 / 引用**：控制条错误为 `span role="alert"` 加 click handler，没有原生按钮、tabIndex 或键盘 handler（`goal-control-strip.ts:329–334`）。
- **影响**：错误会被播报，但键盘用户不能直接激活这条错误去看详情；其他可达按钮存在，不等于错误操作本身可访问。
- **证据等级**：C；实际屏幕阅读器播报待测。
- **建议**：alert 保留为消息，另给原生“查看错误详情”按钮，导航到包含错误的当前视图；避免把交互角色和播报角色混用。
- **验收**：Tab 可到达，Enter/Space 激活同一目标；更新不重复抢焦点/播报；返回有明确焦点落点。

### G07 · P2 · progress 中 dirty 禁用继续却不说明原因

- **现状 / 引用**：草稿保留跨视图（`GoalInspectorContent.tsx:107–118,142–146`），progress 底部 resume/extend 被 `ui.dirty` 禁用（`:257`）；progress 分支未展示草稿提示，冲突提示只在 edit（`:195–249`）。控制条已有 disabled title（`goal-control-strip.ts:477–480`），不能因此视为侧栏也已解释。
- **影响**：切回进度后“恢复”灰掉，用户看不到未保存文本在哪，也不知道如何解除。
- **证据等级**：C；发现性收益为 D。
- **建议**：progress 显示一行“有未保存草稿；此处显示已保存进度”及“返回草稿”，继续旁关联禁用原因。保留 dirty 安全门禁、暂停与取消能力。
- **验收**：edit → progress → edit 文本不丢；dirty 禁用有可读原因；保存/放弃后更新；冲突草稿不能静默覆盖，pending 不重复派发。

### G08 · P2 · “上方卡片”迁入侧栏后失去指向

- **现状 / 引用**：问答与审批说明仍指“上方卡片”（`src/lib/i18n.ts:890–891,2683–2684`）；由 `goal-card.ts:123–126` 注入侧栏帮助。短提示已写“聊天区”（`i18n.ts:2597–2598`），但 `GoalInspectorContent.tsx:181–258` 没有定位聊天待办的动作。
- **真实待办来源**：`src/components/chat/ChatPanelHost.tsx:1274–1297,1362–1388` 按当前 session 校验 pending 身份，分别注入审批和问答卡片并绑定处理回调。问题卡由 `src/components/chat/panel-decoration/ask-user-card.ts:44–63,329–332` 创建、按 askId 去重并插入；审批卡由 `src/components/chat/panel-decoration/approval-card.ts:303–330,419–447` 创建、绑定允许/拒绝并插入。这里评审的是 pending 卡片，不把历史 `AskUserToolRenderer` 当作当前交互入口。
- **已有定位能力 / 缺口**：问题卡注入时已有 `scrollIntoView`；普通工具审批卡注入时也已有 `scrollIntoView`（自动压缩审批存在保留轮次边界分支）。G08 仅指出 **Inspector 缺少重新定位有效聊天待办的入口**，不是聊天从未自动滚动。
- **影响**：长短提示相互错位；注入滚动后若用户离开待办位置，长聊天或窄屏下仍需手动找回。
- **证据等级**：C（注入滚动已存在、当前 Inspector 缺重新定位入口）；搜索成本为 D，未实测滚动。
- **建议**：统一“前往聊天回答问题 / 处理工具审批”，复用当前 session 的有效 pending 卡片，重新滚动并聚焦。有效待办暂未挂载时提供定位/重试反馈，已处理或失效时解释；不复制一个新的审批面，也不激活历史记录。
- **验收**：两类待办分别定位正确；跨会话/旧卡不触发当前动作；导航本身不回答、不授权；窄屏及键盘焦点可追踪。

### G09 · P2 · 新计划历史被误标为“当时等待确认”

- **现状 / 引用**：历史模型仅凭 `recordedPlan && goal.status === 'awaiting_confirmation'` 选择旧提示（`src/lib/goal-report-history.ts:38–44`；`src/lib/i18n.ts:830,2623`）。当前新 plan 也先写此内部状态（`server/agent-goal-state.mjs:286–308`；`server/agent-goal-runner.mjs:1406–1411`），随后自动交接。
- **影响**：新记录凭内部兼容状态虚构“当时等人确认”，与入口和当前状态矛盾。
- **证据等级**：C；新历史 UI 待浏览器回归。
- **建议**：新记录采用中性的“计划已生成 · 历史记录不代表当前状态”。如果需要精确区分代际，应依可证明的来源/版本，不靠当前状态或任意时间阈值猜测。不能把真正旧确认流程的历史反写成“当时已自动执行”。
- **验收**：新、旧、缺版本及错误结果分别覆盖；新记录不出现等计划确认，真实旧事实保留；历史无确认/验收按钮，不追随当前取消或 completed 改写当时结果。

### G10 · P2 · execution 分隔线错误/受阻仍用对勾

- **现状 / 引用**：execution 文字已分别显示受阻、取消、错误等（`goal-iteration-divider.ts:22–30`），图标只在 `planning && outcome !== 'running'` 时不用对勾，其余都用对勾（`:31–35`）。
- **影响**：快速扫读可能把“这一轮结束”理解为“这一轮成功”，与错误/受阻文字冲突。
- **证据等级**：C；实际误读为 D。
- **建议**：execution 按完成、继续、暂停、阻塞、错误、取消配相符图标；颜色辅助，文字仍为主要状态。若统一表达“轮末”，改用中性标记而非成功对勾。
- **验收**：逐项 marker outcome 渲染断言；异常/受阻不显示成功图标，历史 marker 本身不改；保留规划就绪修复、legacy 无 kind 兼容、刷新与实时同步。

### G11 · P2 · 必要/可选准则未区分，统计混在一起

- **现状 / 引用**：viewmodel 保留 `required`（`goal-card.ts:170–176`），Inspector 行未显示它（`GoalInspectorContent.tsx:207–218`）。置顶摘要及胶囊统计全部 passed/全部 criteria（`GoalSummarySection.tsx:17–21`；`GitToolsPinnedSummary.tsx:217,235–241`），服务端完成门禁只检查 required（`server/agent-goal-state.mjs:505–532`）。
- **影响**：所有必要项通过、可选项未做时，完成却看起来“未满”；可选通过又可能掩盖必要项未过。现有全量计数本身不算算错，但缺少口径说明。
- **证据等级**：C；理解改善为 D。
- **建议**：主统计“必要准则 x/y 已通过”，可选单独分组或标注；轮次资源预算与结果进度分开。没有必要准则时显示“待生成/无必要准则”，不能把 0/0 当完成。
- **验收**：必需/可选混合、零准则、failed/needs_review、证据缺失等都覆盖；数字不代替服务端完成门禁，不因 UI 满格自动完成；三个展示入口口径一致。

> 上述短文件名：`GoalInspectorContent.tsx`、`goal-inspector.css` 位于 `src/components/workspace/`；`goal-card.ts`、`goal-control-strip.ts`、`goal-iteration-divider.ts` 位于 `src/components/chat/panel-decoration/`；`GoalSummarySection.tsx`、`GitToolsPinnedSummary.tsx` 位于 `src/components/git/`。行号基于本次核读工作树，后续改动可能移动。

## 4. 信息架构与中英改写

### 推荐信息分工

1. **入口**：一句授权结果 + 可展开安全边界，避免把旧确认流程作为保障承诺。
2. **聊天**：实质分析、结果、问题和工具审批；轻量阶段分隔线解释真实结算状态。历史只读。
3. **控制条**：当前状态、已记录用时、暂停/继续、编辑、取消；预算继续是去 progress 的导航，不暗中追加。
4. **置顶摘要**：目标、真实状态、必要准则统计；纯导航到 progress，不复制编辑器。
5. **Inspector / progress**：状态与下一步 → 待办定位/阻塞原因 → 必要准则及证据 → 可选项 → 预算 → 折叠范围与规则。dirty 提示常驻一行，不展开大说明。
6. **Inspector / edit**：目标草稿、冲突/只读原因、保存结果说明、必要的暂停保存确认。允许浏览进度时保留草稿，但不承诺跨客户端原子写入。

### 文案提案（不是已修改的 i18n）

| 场景 / 关联 | 建议中文 | Suggested English |
|---|---|---|
| 入口 G01 | 设定可验证目标；只读规划正常结束并保存后自动执行。 | Set a verifiable goal. Execution starts automatically after read-only planning ends normally and is saved. |
| 编辑确认 G02 | 暂停并保存修改，然后重新只读规划；规划正常结束且保存成功后自动执行。 | Pause and save changes, then replan read-only. Execution starts automatically after planning ends normally and is saved. |
| 保存按钮 G02 | 保存并重新规划 | Save and replan |
| 普通恢复 G03 | 有计划继续执行；无计划重新规划。范围变更请编辑目标。 | Continue an existing plan, or replan if none exists. Edit the goal to change scope. |
| 范围帮助 G03 | 修改目标需保存并重新规划；不会静默扩大范围。 | Save and replan to change the goal. Scope never expands silently. |
| 编辑入口 G04 | 编辑目标 | Edit goal |
| 预算导航 G04 | 轮次耗尽，打开进度追加预算 | Round budget exhausted. Open progress to add rounds. |
| 追加按钮 | 追加 8 轮并继续… | Add 8 rounds and continue… |
| 错误 G06 | 查看错误详情 | View error details |
| 草稿 G07 | 有未保存草稿；当前显示已保存目标的进度。返回草稿 | Unsaved draft. Progress reflects the saved goal. Return to draft |
| 问题 / 审批 G08 | 前往聊天回答问题 / 前往聊天处理工具审批 | Go to chat to answer / Go to chat to review tool approval |
| 新历史 G09 | 计划已生成 · 历史记录不代表当前状态。 | Plan recorded. This history entry does not represent the current state. |
| 分隔线 G10 | 第 {n} 轮 · 受阻 / 出错 / 已暂停 / 已取消 | Round {n} · Blocked / Error / Paused / Cancelled |
| 主统计 G11 | 必要准则 {passed}/{total} 已通过 | Required criteria: {passed}/{total} passed |
| 预算帮助 | 已用 {used}/{limit} 轮 · 资源预算，不是完成率；累计用时 {time}，时间上限无限。 | {used}/{limit} rounds used. Resource budget, not completion progress. Recorded time: {time}; no cumulative time limit. |
| 无法验证 / 完成 | 无法验证：{reason} / 证据已验证并保存，目标已完成。无需人工验收。 | Unable to verify: {reason} / Evidence verified and saved. Goal completed; no manual acceptance required. |

预算追加、取消和暂停保存的确认仍有具体用途；不得把所有含“确认”的文案机械删掉。历史 key、兼容 API 与当前可见 UI 也须分开判断。

## 5. 交互原型：查看方法与 G01–G11 映射

文件：[goal-ux-ui-optimization.html](../../design-mockups/goal-ux-ui-optimization.html)。直接用浏览器打开本地 HTML 即可；不需要启动服务器或安装依赖。

**这是优化方向的模拟演示，不是生产现状截图。** 数据、证据、计时与审批都是虚构；无 API、网络或实际文件操作，不执行测试命令，不产生真实工具授权。规划约 2.2 秒后的成功保存仅为定时模拟，不验证真实持久化/竞争。刷新不保留数据，切场景重置草稿（原型 `.notice`、`createState()`、`loadScene()`；定时交接见 `schedulePlanning()`）。

| 九个场景选择 | 建议查看动作 | 主要映射 |
|---|---|---|
| planning · 只读规划 | 查看授权折叠说明/SVG，等待模拟正常保存后自动 running | G01、G09、G10 |
| running · 执行中 | 摘要进 progress、编辑进 edit；修改并确认暂停保存，观察重规划 | G02、G04、G11 |
| input · 等待回答 | Inspector 定位聊天问题；空回答看内联错误，再输入模拟回答 | G06、G08 |
| approval · 等待工具审批 | 定位聊天审批，分别试模拟允许/拒绝 | G08、G10 |
| paused · 已暂停 / 恢复 | 继续；或改草稿后切回进度，查看提示与返回草稿 | G03、G07 |
| blocked · 无法验证 | 看阻塞原因和未验证准则；“模拟障碍已解除并继续”仅示意下一步 | G03、G10、G11 |
| budget · 轮次耗尽 | 追加入口、确认/暂不追加；观察 8 → 16 且已有用量保留 | G03、G04 |
| edit-conflict · 编辑冲突 | 保存禁用；载入最新版本仍保留草稿，核对后保存 | G02、G06、G07 |
| completed · 已完成 | 必要准则与证据回顾，无人工 accept；可选项独立 | G09、G10、G11 |

- **G05**：各场景的证据/规则/恢复帮助用原生 details 演示渐进披露，不声称已修生产浮层。
- **G06**：除内联错误，还可试 Tab、Enter/Space、页签方向键/Home/End、关闭返回焦点；这些是原型交互，不是生产键盘验收结果。
- 页脚“优化说明 · G01–G11 对照”逐项列出全部编号（原型 `footer.footer .map`）。取消通过动作进入派生 cancelled 场景，不是第十个下拉选项。
- 顶栏可切亮/暗主题，Inspector 宽度 340/420px；“窄屏预览”将主区限制为 420px 并把侧栏放到聊天下方；另用真实窄视口检查响应式（原型 `#theme`、`#width`、`#narrow`、`.workspace.narrow` 及响应式 `@media`）。不要把模拟窄屏等同生产移动端实现。
- 原型是方向样例而非状态机替代品：例如冲突“载入最新且保留草稿”、活动等待态编辑、dirty 下恢复门禁等必须按生产规则细化；不照搬原型的同步 transition 去实现真实审批、暂停结算或跨客户端 CAS。

## 6. 分阶段落地与风险

| 阶段 | 范围 | 门槛 / 取舍 |
|---|---|---|
| A · 优先低成本 P1 | G01、G02 中英可见文案；G04 导航和可访问名称；顺手在同一文案范围核对 G03 | 不改服务端自动执行契约；分别测 edit / progress / budget 导航；确认不是新增计划确认 |
| B · 关键可读性与可操作性 | 先浏览器复现 G05，再选最小布局修复；G06 键盘错误、G07 草稿解释、G08 待办定位 | 保留身份/pending/dirty 门禁；虚拟化聊天的定位失败要有反馈；不新建第二审批入口 |
| C · 状态与证据表达 | G09 历史代际策略、G10 execution 图标、G11 必需统计 | 新旧快照 fixture；不回写历史，不用视觉统计代替服务端验证；复用现有样式 |

关键风险与约束：

- **授权**：文字修正必须准确表达最终结果；不能暗示“无限时间”绕过审批、范围、防空转或单工具超时。
- **并发/异步**：运行中保存等待权威暂停；关闭侧栏可取消未发出的后续保存，但已发 POST 不能撤回。`src/lib/goal-ui.ts:348–362` 在终态清除 editing/dirty，`:375–417` 按 session/goal 提供本地 pending 锁、dirty 门禁和 token 结算保护；这些不等于跨客户端原子写入。`src/lib/server-agent.ts:1598–1602` 仅对 `extend_resume` 发送 goalId/expectedRevision，其他动作发 action，revise 可附 objective；因此追加预算的 CAS 不代表 revise 也具备跨客户端 CAS。
- **历史**：旧 `awaiting_confirmation` 可能确实表示旧人工确认；缺来源时宁可中性表达，不虚构新旧执行事实。
- **视觉/可访问性**：颜色不能独立传状态；浮层缩放、长英文、滚动容器、焦点返回、屏幕阅读器均需实测。原型语义 fallback 色值不直接作为生产 token。
- **范围**：本报告不是后端架构或全部历史缺陷复审，不把旧证据问题、旧 SSE 风险等未经本次重验内容顺带判定已修/未修。
- **文档**：本次仅新增评审，未改变生产架构、模块职责、公共入口或发布流程，故不改 Wiki；后续若采纳并改变导航/交互契约，再同步相应 `docs/wiki/src/`。三份状态文件随本次评审统一同步。

## 7. 验证状态与回归清单

### 本次状态（严格区分来源）

本轮接续复核完善轮初已存在的未跟踪报告与原型草稿，不是从零新建。`goal-ux-ui-review-prototype` 的 done 仅表示评审交付与下列自动验证完成，不代表 G01–G11 生产缺陷已修复或真实浏览器通过，也不预写本 Goal 的运行状态为 completed。

| 检查 / 来源 | 实际结果与边界 |
|---|---|
| 当前源码、设计语言、原型核读 | 已完成只读核对；上列行号来自当前工作树 |
| 父 Agent · Node 内联静态检查 | 退出 0：`vm.Script` 编译、71 个唯一 ID、18 处 HTML 引用、零外部资源、9 场景、4 种规划双屏障、预算/编辑冲突与 G01–G11 映射通过 |
| 父 Agent · Node VM + fake DOM | 退出 0：28 组事件与 timer guard 检查通过；fake DOM 不是浏览器，不验证真实布局、焦点或持久化 |
| 委派 · 原型定时器回归 | 6 项虚拟时钟检查及负对照通过，单列、不并入父级 28 组；仅原型修复 planning 同 scene 重新保存时 timer 复用，以 generation + revision guard 隔离旧回调 |
| 父 Agent · 定向 Vitest | 退出 0：8 文件 / 187 测试通过；完整命令如下，既有测试通过不代表提案已落地 |
| 真实浏览器/真实模型/屏幕阅读器 | **未实测**；无生产截图、computed layout 或实际审批验收结论；无可用真实 browser 通道，Playwright 等依赖不安装 |
| 全量 test / lint / build | **本轮未运行**；未改生产代码、测试、Wiki、依赖或生成产物，无 Git 提交/标签/推送/发布；纯提案不改变现行契约，故无需同步 Wiki |

```sh
npx --no-install vitest run tests/frontend/goal-control-strip.test.ts tests/frontend/goal-summary-section.test.ts tests/frontend/goal-budget-inspector.test.ts tests/frontend/goal-edit.test.ts tests/frontend/goal-ui.test.ts tests/frontend/goal-inspector-lifecycle.test.ts tests/frontend/goal-iteration-divider.test.ts tests/frontend/goal-report-renderer.test.ts
```

检查过程说明：父级首次静态检查把比较操作数的字面顺序断言写反，重读并更正检查后重跑退出 0；委派长命令包装失败，拆短后通过。这些属于检查脚本/命令包装问题，不是生产测试失败。生产修复须独立推进，优先 G01/G02/G04；下列浏览器及采纳后回归项仍未完成。

### 采纳修复后的回归矩阵

- [ ] **入口与交接**：中英文 `/goal` 建议、必要澄清；plan 同轮禁止执行期报告；正常轮末/保存两种先后次序；保存失败、abort/cancel 不启动 execution；没有计划确认按钮。
- [ ] **预算**：默认 8 个执行轮次（planning 不计轮次）/ null 时间 / 已记录用时；最后一轮验证成功可完成；耗尽追加仅给轮次 +8，CAS 过期不重复 POST；旧 duration-only 恢复移除时间上限，usage/证据不重置。
- [ ] **操作**：控制条取消/暂停/继续/编辑和摘要导航；budget 进入 progress，编辑进入 edit；只读/共享/ACP/sidechat 等 capability 门禁保持。
- [ ] **编辑/草稿**：运行中暂停保存完整链；权威 paused + 非 streaming；冲突、超时、网络错误、关闭、切会话/Goal、重复点击、IME；dirty 解释、保留和丢弃语义，暂停取消仍可用。
- [ ] **待办**：问答与审批分别定位；消息未加载/已处理/旧会话的回退；导航不授权，问题不自动回答，拒绝审批不伪造成功。
- [ ] **完成/受阻**：必要项缺证据/失败不 completed；needs_review → blocked 说明原因；complete 正常轮末与持久化前不显示最终完成；无人工 accept；保留可信旧 human evidence 显示。
- [ ] **历史/同步**：新旧 plan 历史、不完整结果、planning/execution/legacy marker、全部 outcome；当前 cancelled 不污染历史；刷新/流式元数据更新无重复分隔线，不回退已修 SSE 行为。
- [ ] **信息口径**：必要/可选混合、零准则、长摘要、长证据；摘要/胶囊/Inspector 同口径；轮次预算不是完成率。
- [ ] **浏览器可访问性**：340/420px 侧栏、真实 320/375/420px 窄视口、200% 缩放、亮暗主题、中英文长文本；computed 浮层尺寸/裁切；Tab/Enter/Space/Escape、焦点返回、读屏播报、reduced-motion。

已定位的相关测试包括 `tests/frontend/{goal-edit,goal-ui,goal-control-strip,goal-summary-section,goal-budget-inspector,goal-inspector-lifecycle,goal-report-renderer,goal-iteration-divider,goal-plan-confirmation}.test.ts` 及 `tests/server/{agent-goal-runner,agent-goal-state,agent-goal-runtime}.test.mjs`。后续按改动先跑定向 `npx vitest run <相关文件>`；生产改动再配 lint/类型检查或 build，发布前完整 `npm run test`、`npm run lint`、`npm run build`。自动化模板/状态测试不能替代上表真实浏览器检查。
