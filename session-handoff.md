## 当前交接：goal-changes-commit（in_progress，提交准备快照）

- 目标：用户已授权提交并推送既有 42 个 Goal 文件；子任务只 commit，父 Agent 负责 push/远端核验。分支 dev，上游 origin/dev；不读取凭据/远端 URL 配置，不 reset/rebase/force/pull，不创建 tag。
- 本轮修改仅 feature_list.json、progress.md、session-handoff.md 追加提交准备与验证记录；其余既有 Goal server/src/tests/wiki/review 内容保留。明确路径暂存，提交前复核完整暂存差异。
- 实跑验证：npm run test 退出0（319 files/3457 tests）；npm run lint 退出0（仅既有 identity.mjs:92 warning）；npx --no-install tsc -b --pretty false 退出0；git diff --check通过。状态同步后再次 JSON 与 diff 校验。
- 边界：本段写于 commit 前，不预填哈希，不宣称 push 完成；真实 commit hash/status 由工具输出回报。无依赖/生成产物/build/npm 发布操作。真实浏览器验收及历史评审问题未解决。
- Notes：Wiki 的 renderer 无 mount 描述与保留空 mount 的源码有偏差，无运行时确认按钮；本次不修生产或 Wiki。首次分号组合只读 git 命令被当参数拒绝，已拆为单命令成功执行，不影响验证结果。
- 下一步：创建单个 commit 后父 Agent 执行 push 并核验远端；完成后同步最终状态。

---

## goal-auto-start-unlimited-time（done，实现与全量自动验证完成；浏览器待验收）

- 实现：planning 整轮及最终 persist 窗口只读，正常持久化后自动执行；新 Goal null 无限累计时间，usage 保留；resume/extend/revise 移除旧时间上限，extend 仅耗尽轮次 +8 且保留 CAS。当前 UI 无计划确认/验收，Inspector 显示无限与累计用时。
- 收尾：补 goalRun 清除后的 planning 最后持久化窗口只读门禁；needs_review→blocked 本轮仅 read_file/grep_files/必要 ask_user，禁止写/命令/委派/goal_report，问答与 error 结束均不续跑，不伪造 passed。历史 human evidence/accept API 保留。
- 验证：定向 2 files/107 tests；全量 npm run test 退出0，319 files/3457 tests passed；npm run lint 退出0，仅既有 server/cloud/identity.mjs:92 warning；npx tsc -b --pretty false 退出0；git diff --check通过。补 duration-only resume、null预算SSR无NaN、planning persist只读、needs_review提问后idle/error不续跑。
- 文档：逐条同步 Wiki 总入口/server/routes/tools/src/lib/components 现行段落，不改历史 reviews/features。保留 inert chat confirmation controller 与 Host 接线，避免扩大装饰生命周期清理；无 DOM/confirm 派发，非运行时确认入口。
- 边界/下一步：父 Agent 最终审查与浏览器真实模型/刷新/暂停取消/窄屏主题/焦点验收待办；done 仅表示实现与自动验证完成。其他历史评审问题未修。无 build、依赖/生成产物变更、Git commit/tag/push/发布。

---

## 当前交接：goal-hide-internal-run-messages（done，实现与自动验证完成；父 Agent 最终审查待办）

- 目标：隐藏合法metadata execution/planning内部user正文/操作/空白，保留user DOM分轮边界、原消息索引、模型上下文和历史；保留user回退/空assistant source直接divider。普通同文本不隐藏，class可逆，计划确认仍读完整messages。
- 文件：goal-internal-message.ts（新）、message-actions.ts、index.css、agent-goal-runner.mjs、新internal测试、message-actions/divider/runner测试、server/components wiki、三状态文件。保留旧改动及所有旧feature状态。
- 验证：定向8 files/329 tests通过；npm run lint退出0仅既有identity.mjs:92 warning；npx tsc -b --pretty false退出0。不build、不依赖变更/生成产物、不commit/tag/push/发布。
- Blocker/边界：无自动验证阻断；父Agent最终审查待办。渲染后装饰不能保证零闪现，窗口高度估算/滚动与CSS :has真实布局、焦点/屏幕阅读器待浏览器验证。提示词不能保证模型百分百不重复；不按字符串删助手内容，不迁移旧无metadata正文。
- 下一步：父Agent审查CSS及完整消息/原索引契约；用户浏览器验收自动续跑、重新规划、无assistant回退divider、刷新历史、窄屏/亮暗与键盘导航。

---

## 当前交接：goal-chat-plan-confirmation（done，实现与自动验证完成；父 Agent 最终审查待办）

- 当前目标：最新有效 Goal plan 聊天内确认执行；历史快照不可执行，侧栏动作保留。新 controller `src/components/chat/panel-decoration/goal-plan-confirmation.ts` 由 ChatPanelHost 注入当前agent，renderer仅空mount；同Goal revise仍按最新toolCallId/revision和计划内容/criterion IDs验证，未确认允许轮末+1 revision。
- 改动文件：新controller、ChatPanelHost.tsx、local-tools.ts、i18n.ts、新goal-plan-confirmation.test.ts、goal-report-renderer.test.ts、docs/wiki/src/lib/README.md、docs/wiki/src/components/README.md、三状态文件。旧修改与feature状态全部保留。
- 验证：定向9 files/295 tests通过（controller/host21，renderer32）；npm run lint退出0仅既有identity.mjs:92 warning；npx tsc -b --pretty false退出0；git diff --check通过。不build、不新增依赖/生成产物、不commit/tag/push/发布。
- Blocker/边界：无自动验证阻断；父Agent最终审查待办。fake DOM及host源码契约不等于浏览器；真实规划结束、HTTP/SSE时序、窄屏主题/焦点/屏幕阅读器/刷新待人工。没有新增后端CAS，已发HTTP跨客户端替换仍既有边界；无法证明最新记录时保守隐藏聊天入口、Inspector不变。
- 下一步：父Agent审查身份/时序门禁与工具mount实际Lit行为，用户浏览器验收；done不表示浏览器已验收。

---

## 当前交接：goal-report-renderer（done，实现与自动验证完成；浏览器待验收）

- 目标：用户确认的 Goal 计划确认工具样式最小修复，专属 renderer 已注册，默认结构化历史计划内容，JSON 只在详细模式。非 plan 动作只作历史报告，运行中/失败/缺失结果不冒充成功，不新增历史确认操作，当前状态与动作仍在 Inspector。
- 改动文件：`src/lib/local-tools.ts`、`src/lib/goal-report-history.ts`、`src/lib/i18n.ts`、`tests/frontend/goal-report-renderer.test.ts`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。保留全部旧改动/旧feature状态；无其他评审修复或后端/CSS改动。
- 验证：定向 vitest 8 files / 121 tests通过（新renderer31）；npm run lint退出码0，只有既有identity.mjs:92 warning；npx tsc -b --pretty false退出码0；git diff --check通过。模板测试非真实浏览器。
- Blocker：无实现或自动验证阻断；浏览器窄屏/长文本/亮暗主题/折叠键盘焦点/屏幕阅读器、真实刷新/新Goal尚未验收。
- 下一步：父Agent审查整合；用户按真实规划确认流程查看工具样式及历史「当时等待确认」文案。不build生成产物、不依赖变更、不commit/tag/push/发布；done不表示浏览器已验收。

---

## 当前交接：goal-auto-complete-validation（done，仅审查与自动验证完成；浏览器 needs-review）

- 当前目标：用户授权的 Goal 自动完成/迭代分隔线验证报告已产出，不修缺陷；依赖 `goal-auto-complete-iteration-divider`，所有既有 feature 状态保留。
- 本次改动文件：`docs/reviews/goal-auto-complete-validation.zh-CN.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。历史记录原样保留在下方；报告足够，无需修改 Wiki 现行契约。
- 验证：父 Agent 本次 16 files / 472 tests 退出码 0（完整命令/计数见报告）；Node 纯函数复现 S1：passed→failed→passed 无新 evidence 仍 goalCompletionCheck ok:true，非真实模型。末轮完成、异常不完成、SQLite marker 恢复测试通过，不代表整条浏览器流程通过。
- Notes / 未修复：高 S1 旧证据复用；中 S2 needs_review persist 中 abort 意图未复核、S3 refreshTools reject 阻断完成通知（静态）；中 U1 预算入口误开 edit、U2 浮层极窄/裁切风险、U3 空宿主隐藏 divider 风险；低 U4 aria 名称、U5 click span 键盘缺口、U6 整链重复移末尾。observer suppression 存在，不声称无限循环；旧评审未重新核实项不混入新结论。
- Blocker：浏览器 c6 待人工；无专用 browser 工具，playwright/puppeteer/jsdom/happy-dom 不可 resolve，electron 有但未启动；不装依赖、不新建 harness。没有截图/真实布局/IME/屏幕阅读器验收结果。
- 下一步：父 Agent 整合交付；用户确认独立修复项，优先 S1 与 S2/S3 回归、U1 导航、U2/U3 真实浏览器复现；按报告 c1-c8 补人工验收。done 只表示审查与自动验证完成，发现问题并未修复。
- 边界：不改生产/测试/生成产物，不作 Git 提交或发布；本次只报告与状态同步，考虑 SVG 后采用问题表/清单。

---

## 当前交接：goal-auto-complete-iteration-divider（done，自动验证完成；无浏览器验收）

- 目标：Goal 有证据正常结束且最终状态持久化后自动完成；execution 每轮历史分隔线。
- 修改：runner/manager/persistence/tools definitions；前端 goal-iteration-divider/message-actions/index.css/i18n；3测试文件；4wiki；三状态文件。详见 feature_list。本轮复审仅追加runner末轮预算修复、3测试增强、server wiki及三状态同步，保留其他现有改动。
- 复审结论：第maxIterations轮验证成功可completed，预算只阻止下一轮；错误/abort/时长超限不能自动完成。commitCompletedGoal完成前后意图守卫、persistSession锁内canPersist及取消后串行补偿保存无新增阻断。分隔线按消息持久化元数据恢复，不依赖当前Goal；幂等且其他装饰追加内容后重置到根末尾。
- 验证：npm run test退出码0，316 files / 3397 tests passed；npm run lint退出码0，仅既有server/cloud/identity.mjs:92 warning；npx tsc -b --pretty false退出码0。按要求未build，无依赖或生成产物变更，无Git提交。
- Blocker：无实现/自动验证阻断；完全存储故障/任意I/O崩溃窗口不保证补偿持久化。
- 下一步：父Agent整合结果；用户浏览器视觉、真实刷新与新Goal验收尚未进行，done不代表浏览器已验收。

---

## 上一轮交接：goal-design-review Goal 功能设计评审（needs-review，待用户评审采纳）

- 当前目标：对当前 Goal 功能做设计层评审（与 UI 评审互补），产出报告 + 状态机图，纯只读零生产改动（git status 核实仅新增 2 交付物 + 3 状态文件）。
- 产物：`docs/reviews/goal-design-review.zh-CN.md`（七维度 + 高2/中8/低10 问题分级 + 设计债 8 条核实 + P0/P1/P2 建议，全部 文件:行号 亲读核实）+ `docs/reviews/goal-state-diagram.svg`（13 状态，node 校验零缺失 + XML well-formed）。
- 核心结论：骨架优秀（revision 单点/意图只升不降/fail-closed/settle barrier/证据信任链/重启不重放/goal 水位隔离）；🔴 X1 并发 /goal 双写窗口（runner:863-876 锁外 + :347-348 跳过同 session + commitGoal 无守卫）、🔴 X2 clear/compact 与回滚守卫不对称（manager:1209-1228 vs :1058-1065）；新发现 D1 死状态 failed（零入边）、D2 disposition 吞 error、D3 结算窗口中止语义、B1 等待计费、B3 双 commit、E1 降级不清证据；设计债核实：retry=已缓解、其余按历史仍开放/部分缓解。
- Blocker：无。时序结论（X1/D3/B3）未动态复现，建议修复时并发用例先行。
- 下一步：① 用户评审报告决定采纳项；② 若做 P0：X1（startGoalPlanning 锁内补活跃 goal re-check，约 5 行 + 并发用例）与 X2（clear/summary/compact 分支移到 GOAL_ACTIVE 之后或 clear 终态化 + 用例）；③ P1 清单见报告第九节；④ 上一轮 goal-ui-p0-budget-120 的浏览器视觉验收仍待用户。

---

## 上一轮交接：goal-ui-p0-budget-120 Goal UI 生产落地 + 预算 120 分钟（done，实现与全量自动验证完成，浏览器待验收）

- 当前目标：按已验收的评审/示例方向落地生产（P0+G-09+C-02）并把预算默认时长 30→120 分钟（追加 +120 跟随默认、轮次 8 不变）。实现与父 Agent 最终全量验证完成，未 commit，浏览器视觉验收待用户。
- 改动文件（22 个，完整清单见 feature_list.json）：预算（server/agent-goal-state.mjs、src/lib/goal.ts、3 个测试、wiki 6 处）；侧栏（GoalInspectorContent.tsx、goal-inspector.css 重写）；控制条（goal-control-strip.ts、src/index.css）；i18n（+16 key/-1 key/改 1 key）；测试（goal-budget-inspector/goal-control-strip/goal-inspector-lifecycle 重写或增补）；CHANGELOG [Unreleased] Changed；三状态文件。
- 父 Agent 审查要点：重构后组件 abort/focus/Escape 契约逐行核对保留；删除了子 Agent 实现中状态行与提示行重复的第二个 ? 浮层（唯一入口在状态行，edit 视图可达）；CSS token 引用全部存在；控制条 objective 六处移除干净。
- 最终验证：npm run test 315 files / 3381 tests 退出码 0；lint 0 error（仅既有 identity.mjs warning）；build 退出码 0（仅既有警告）。
- Blocker：无。
- 已知残留（下轮候选）：popover note 文案「上方的卡片」语境（G-10/T-E，涉及聊天卡 view model 共享）；tone 色值三处复制（C-01 token 全局化）；K-01 聊天卡 Note 双显；G-16 外壳三问题；formatGoalTime 可精简为相对时间；S 系列/字号单位/阴影等 P2 打磨项。
- 下一步：① 用户浏览器验收（侧栏滚动/动作栏/状态行 ? 浮层/badge/计量条/控制条单行/预算 120 分钟展示）；② 验收通过后决定 commit（发布走 docs/architecture/patch-release-runbook.zh-CN.md）。

---

## 上一轮交接：goal-ui-review-optimization-example Goal UI 评审与优化示例（needs-review，待用户验收）

- 当前目标：响应用户浏览器验收反馈（右侧边栏大量样式问题、说明性文字过多），产出完整评审 + Before/After 优化示例；不修改生产代码。改动仅 2 个新交付物 + 3 状态文件，`src/`、`server/`、`tests/`、`dist/` 等均未触碰，无 commit。
- 产物：`docs/reviews/goal-ui-review.zh-CN.md`（四 surface 完整评审，G/S/C/K/T 问题编号体系，设计语言对照表，P0/P1/P2 路线图，全部 文件:行号 引用经父 Agent 亲自核实）+ `design-mockups/goal-inspector-optimization.html`（自包含 Before/After：滚动、token 按钮、状态 badge、时间/预算本地化、Note 一行 + ? 浮层、确认组容器、控制条极简；主题/宽度/状态切换）。
- 核心结论：右侧边栏 3 高危（G-01 内容链路无滚动被裁剪、G-03 按钮体系脱节、G-04 textarea 260px）+ 8 中 + 5 低；说明性文字 100 key 中 25 条、Note 3 条连排且聊天卡/侧栏同屏双份（K-01）；收敛策略 T-A~T-G 对齐 DESIGN_LANGUAGE L187-191。修正：G-02（动作行溢出）经 goal.ts 谓词核实不实际发生，下调为中优健壮性问题。新发现 C-02：控制条实现与自身设计注释矛盾（objective 全文 + 时长进单行，注释却承诺 objective 归摘要视图）。
- 验证：内联 JS vm.Script 语法通过；无外部资源全 0；getElementById 9 引用全定义；fake DOM 动态冒烟 9/9；feature_list.json JSON.parse 通过。真实浏览器视觉/交互待用户验收。
- Blocker：无。
- 下一步：① 用户浏览器打开示例（340/420、亮/暗、两状态）+ 阅读报告，确认优化方向；② 确认后另开 feature 落地生产修复（建议 P0：G-01/G-03/G-04 + T-A/T-B）；③ G-16 外壳问题（Tab 关闭 hover、aside 分隔线、pr-[5.5rem]）另开 feature。

---

## 上一轮交接：goal-budget-extension-resume（done，实现与全量自动验证完成，浏览器待验收）

- 当前目标：预算耗尽后显式追加默认额度、恢复同一 Goal；实现与父 Agent 最终全量自动验证完成，标记 done，浏览器验收尚未完成。本子任务仅同步三状态文件。旧交接保留历史，旧无 CAS/取消重建描述不代表新追加动作。
- 契约：`extend_resume` 只接收 `{action,goalId,expectedRevision}`（revision 正 safe integer）；仅该动作锁内 CAS，旧请求不重复追加，其他动作不泛化 CAS。耗尽维度 +8 轮/+30 分钟，usage/计划证据保留；同次 persist 成功后才恢复。仍不足 paused 不调度；足够后无计划 planning、未确认 awaiting_confirmation、已确认 running。planConfirmed 持久化仅 confirm 置 true，revise/plan 清 false；旧 planning/awaiting_confirmation 强制 false，其余优先显式布尔值、缺字段以 usage.iterations > 0 兼容。统一预算 gate 防错误越额续跑，旧 resume 耗尽仍409但有新出口。
- 前端：Inspector 内联确认真实 usage/额度/增量，运行条耗尽继续转 progress；预检绑定旧 revision，失败权威对账、不盲重发；关闭只取消未发 POST，已发不可撤回、等待结算再释放锁。不会隐式确认计划。
- 相关实现：`server/{agent-goal-state,agent-goal-runner}.mjs`、`server/routes/agent.mjs`；`src/lib/{goal,server-agent,deferred-session-agent,i18n}.ts`、`src/components/workspace/GoalInspectorContent.tsx`、`src/components/chat/panel-decoration/{goal-control-strip,goal-card}.ts`。测试：`tests/server/{agent-goal-state,agent-goal-runner,agent-goal-manager}.test.mjs`、`tests/server/routes/agent.goal.test.mjs`、`tests/frontend/{goal-budget-inspector,goal-state,server-agent,goal-control-strip,goal-card,goal-card-controller,goal-ui}.test.ts`。完整清单见 feature_list.json，30个文件已核实存在。
- 本次最终同步仅改 `feature_list.json` / `progress.md` / `session-handoff.md`；此前六份 Wiki README（总入口、server、server/routes、src、src/lib、src/components）已同步，无需再次修改。保留历史、不改生产/测试。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，315 files / 3377 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体解析与 chunk 体积 warning。此前子 Agent 定向后端166/前端270 tests通过，不替代最终全量结果。本子任务未重跑生产测试；浏览器视觉、真实交互/IME/焦点未验收。
- Notes：旧 pendingDisposition 优先于 error 仅落 needs_review、非 completed，本轮未修、不扩范围。
- Blocker / 下一步：实现与最终全量自动验证完成，done 不表示浏览器验收完成；仍需浏览器视觉、真实交互/IME/焦点验收。未新增/升级依赖、无 Git commit/tag/push/发布、未手工修改生成产物 `dist/`/`package-dist/`/`package-offline/`。

---

## 上一轮交接：goal-inspector-progress-editor Goal 侧栏进度/编辑重设计（done，实现与全量自动验证完成，浏览器视觉未验收）

- 当前目标/状态：实现与父 Agent 最终全量自动验证已完成，标记 `done`，用户视觉与真实浏览器验收尚未完成；依赖 `goal-pinned-summary-production-ui`。本次委派仅同步三状态文件，保留已有生产改动和所有历史 feature 状态，无 commit。
- 当前路径：运行条真实状态/已记录累计时长 + 取消/暂停或继续/编辑三个 icon → 编辑打开侧栏 edit；摘要两行纯导航 → 侧栏 progress。`GoalInspectorContent` 统一进度、验收、阶段动作与编辑，Workspace Inspector Tab 按 session + goal 复用、仅 runtime、不持久化。
- 安全边界：`goal-ui` 保留运行中草稿与外部冲突 dirty 文本，dirty 允许 pause/cancel。`goal-edit` 经用户确认 pause，等待权威 paused 且非 streaming 再 revise；App 绑定 `refreshGoalForSave` 单次严格快照。关闭侧栏的 layoutEffect 取消后续等待/尚未派发保存，已发 POST 不能撤回且须结算后才释放锁；不自动 confirm/resume、不重试 POST。Goal 动作 API 无客户端 revision CAS，不保证跨客户端原子性，也不保证服务端拒绝所有外部冲突；检测到冲突或服务端返回错误时保留草稿并报错。
- 本次改动文件：仅 `feature_list.json`、`progress.md`、`session-handoff.md`；此前四份 Wiki（根、src、src/components、src/lib 的 README）已同步，无需再次修改。相关实现（已核实路径存在）：`src/App.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/components/chat/panel-decoration/goal-control-strip.ts`、`src/components/git/{GoalSummarySection.tsx,goal-summary.css,GitToolsPinnedSummary.tsx}`、`src/components/workspace/{WorkspaceInspector.tsx,GoalInspectorContent.tsx,goal-inspector.css,workspace-types.ts,workspace-inspector-tabs.ts,workspace-inspector-request.ts}`、`src/lib/{goal-ui.ts,goal-edit.ts,server-agent.ts,i18n.ts}`、`src/index.css`。测试：`tests/frontend/{goal-edit,goal-ui,goal-inspector-lifecycle,goal-inspector-tabs,goal-control-strip,goal-summary-section,git-tools-pinned-summary,server-agent}.test.ts`；完整清单见 `feature_list.json`。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，314 files / 3292 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体解析与大 chunk warning。本次状态子任务不重跑生产测试。历史记录：最后修复前父 Agent 313 files / 3288 tests passed，子 Agent 定向 5 files / 141 tests passed、lint/build 通过，不替代最终全量结果。
- Notes：此前一次全量在 `qf-agent-process.test.mjs:269` 重启 timer 测试失败，未改相关源码原样复跑全绿；未定位根因、不标已修复，不扩大范围。
- Blocker / 下一步：实现与自动验证无待办；用户仍需验收三 icon、两行导航、progress/edit 与真实暂停保存。浏览器视觉、IME、焦点保持/关闭回焦、响应式布局仍未实测；后端 CAS 属明确边界，非本轮扩展项。
- 未做：未新增/升级依赖、不改 `server/`、生成产物未手工修改、无 commit/tag/push/发布；不混入网络容错、不修无关后端问题。下方旧交接仅作历史保留，不代表当前 UI。

---

## 上一轮交接：goal-pinned-summary-production-ui Goal 置顶摘要生产 UI 落地（2026-09-10，done，实现与全量自动验证完成，仍保留用户视觉验收）

- 当前状态：原型已由用户明确确认落地，生产 UI 主路径已完成；父 Agent 完整验证通过（`npm run test` 311 files / 3263 tests、`npm run lint` 0 error 仅 1 个既有 warning、`npm run build` 退出码 0），feature 标 `done`。本会话最终一轮只做**文档/状态同步**（不改后端 `server/`）。未 commit（遵循项目规则）。
- 目标与范围：完整 Goal 卡不再由 `ChatPanelHost` 挂载，旧 `panel-decoration/goal-card.ts` controller/viewmodel 保留兼容（`buildGoalCardViewModel` 仍是三 surface 共用纯投影）；生产主路径 = 置顶摘要置顶的 Goal 首分区（`git/GoalSummarySection.tsx` + `goal-summary.css`）+ 输入框上方控制条（`panel-decoration/goal-control-strip.ts`，单行状态 + pause/resume + 打开摘要两个 icon）。摘要在只有 goal 的会话也挂载（goal-only），胶囊首段为「目标·真实状态·已验收准则数」再接任务/文件/智能体段（总段数截断 3）；控制条固定插在 composer shell 首位，不插进 TodoWrite 摘要/排队消息锚点之间；主会话门禁排除 ACP，控制条再加 `capabilities.goal`、非共享页、非 side chat；其他 surface 经 `quickforge:open-goal-summary` 打开摘要，`App` 只认当前会话 + 当前 goal 并先关闭已打开的 Workspace Inspector。
- 关键设计：新增 `src/lib/goal-ui.ts` 按 `sessionId + goalId` 持有 pending/dirty/error/草稿，三 surface 同源锁（脏草稿除 `revise` 全拒并写原因，失败广播不抛出）；草稿连 `editing` 存 store（基线为服务端 objective），`retainGoalUi`/`releaseGoalUi` 让关闭摘要、最小化、桌面↔移动重挂后重开恢复同一文本与 dirty 锁（`clearGoalUi` 才丢弃，无人挂载草稿 LRU 最多 6 份）；取消确认是内联行（焦点进入「继续工作」，Escape 只关该行/菜单并把焦点还给触发按钮）。控制条不复制原型 800ms 假延迟：pause 直接 POST 真实后端，`pausing` 为服务端真实状态；goal 快照/`goal_updated` 只推进独立 `goalSeq` 水位（同 id 比 revision、跨 id/清空比水位），HTTP 动作响应与 `/state` 刷新带请求前水位做竞态守卫，只有真正改变 goal 才广播，且**不**推进消息 `stateVersion`（避免作废在途消息对账）。
- 改动文件（最终一轮文档/状态同步，均在本 feature 允许清单内）：`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`（本 feature 早前轮次另含 `docs/wiki/README.md`）。被文档描述的生产改动（实现）：`src/components/git/GoalSummarySection.tsx`、`src/components/git/goal-summary.css`、`src/components/git/GitToolsPinnedSummary.tsx`、`src/components/chat/panel-decoration/goal-control-strip.ts`、`src/components/chat/panel-decoration.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/App.tsx`、`src/lib/goal-ui.ts`、`src/index.css`、`src/lib/server-agent.ts` 及 5 份前端测试；完整清单见 `feature_list.json`。
- 验证（父 Agent 完整验证，全部通过，2026-09-10）：`npm run test` 退出码 0，**311 files / 3263 tests passed**；`npm run lint` 退出码 0，**0 error**（仅 1 个既有 warning `server/cloud/identity.mjs:92` no-useless-assignment，与本 feature 无关）；`npm run build` 退出码 0（TypeScript 类型检查与 Vite 生产构建通过，仍有既有 KaTeX 字体路径未构建解析警告与大 chunk 体积警告）；子 Agent 针对性回归 `npx vitest run tests/frontend/goal-control-strip.test.ts tests/frontend/goal-summary-section.test.ts tests/frontend/goal-ui.test.ts tests/frontend/goal-card.test.ts tests/frontend/goal-card-controller.test.ts tests/frontend/goal-state.test.ts` → **6 files / 113 tests passed**（control-strip 20 / summary-section 20 / goal-ui 17 / goal-card 22 / card-controller 19 / goal-state 15）；`feature_list.json` JSON parse 与 `git diff --check` 通过。
- 收尾修复（已并入并有测试覆盖）：① `syncGoalUiState` 由 `App` 的 effect 在每次 goal 变化时调用（非可编辑状态或 objective 被替换清旧 draft/dirty，保留真实 in-flight pending）；② 关闭/重挂只在同一可编辑目标下保留草稿；③ 被移除的焦点节点回填到摘要入口或 composer 编辑器；④ `server-agent` 的 `/state` 消息版本早退只允许「同 goal id + 严格更高 revision + `goalSeq` capture 未变」的 goal 独立采纳，跨 id/`null` 不越过 guard。
- Blocker：无。待办仅剩用户浏览器验收。
- 未做（明确不宣称）：真实浏览器实测（摘要三态与 goal-only 布局、控制条两个 icon 与 `pausing` disabled、焦点圈闭、屏幕阅读器、中文输入法 IME、pause 的真实后端时序）均属代码/单测保障；无依赖变更、未 commit/tag/push、未发布 npm、未手工修改 `dist/`、`package-dist/`、`package-offline/`。
- 边界：保留旧记录——`goal-pinned-summary-interaction-prototype`（needs-review）与 `ai-goal-mode`（done）状态不擅改。Notes：上轮六类中优先级问题中 SSE 快照卡片刷新已补，其余四类后端旧问题（同 session 并发、clear/compact 守卫、retry 生命周期、验收证据一致性）仍不修、不标已解决；消息版本回退属广义 SSE epoch/消息对账基础设施问题，本轮不扩、不声称已解决。
- 下一步：① 用户浏览器验收（摘要三态与 goal-only、控制条、胶囊、编辑 dirty 跨挂载保留、取消内联确认、pause 真实时序）；② 验收通过后决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。

---

## 上一轮交接：goal-pinned-summary-interaction-prototype Goal 置顶摘要交互设计原型（2026-09-10，needs-review，待用户视觉验收）

- 当前状态：设计原型完成，三份状态文件已记录，feature 标 `needs-review`——明确待用户视觉验收，不偷标 done，也不把既有中优先级问题标为已解决。未 commit（原型文件当前为未跟踪状态）。
- 授权与范围（用户明确）：本 feature 只是设计原型对齐，不做生产落地；不改生产组件/后端/依赖，不跑生产整套 test/lint/build。
- 产物与覆盖：`design-mockups/goal-pinned-summary.html`（自包含中文 HTML/CSS/JS/SVG，无外部资源/网络调用）——置顶摘要三态（关闭/胶囊/面板）+ 移动端弹层；输入框上方状态短标识 + pause/resume + 打开摘要两个 icon（无 more 完整卡）；胶囊短目标/状态/验收数；面板验收详情折叠 + 阶段主操作；more 编辑/取消；编辑 dirty 保护；pause → pausing(800ms) → paused（pausing 期间暂停 icon 真实 disabled、aria-disabled 同步）；审批/问答聊天样例不自动授权（拒绝工具→paused 且进展/验收数不变）；accept 一次完成、continue 保留进度；取消不回滚 + 确认态焦点圈闭；预算 8 轮 / 30 分钟；设计说明独立于产品 UI。
- 改动文件（1 交付物 + 3 状态文件）：`design-mockups/goal-pinned-summary.html`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证（2026-09-10，针对最终修订版；两类结果分开记）：**父 Agent 独立静态**——内联 JS `node --check` 通过；67 个唯一 id 全部有定义、50 处 `getElementById` 引用零缺失；无外部资源与网络/API 调用（http(s) 0 命中、无 fetch/XHR）；改动范围仅 4 文件（原型 + 3 状态文件）；`feature_list.json` JSON parse 与 `git diff --check` 通过。**委派动态**（Node VM + 最小 fake DOM，父 Agent 转述）——最终 54 条断言全部通过，分组 R1 15 / R2 12 / R3 10 / R4 7 / R5 10，覆盖输入框上方 2 icon 控条（含 pausing 的 disabled/aria-disabled 同步）、胶囊短目标/状态/验收数、pause→pausing(800ms)→paused 时序、continue 与工具被拒后进展/验收数保持不变、拒绝工具→paused、blocked 详情展开、accept 一次完成、编辑 dirty 保护、取消确认态焦点圈闭与 Tab/Escape 模拟。最终修订已修 pausing 的 aria-disabled 同步与「拒绝工具→paused」。旧版草稿的 686 条断言属修订前历史结果，不作为最终依据。展示文件由父 Agent 用 present_files 交付。
- Blocker：无（动态断言已完成；真实浏览器/CSS 布局/屏幕阅读器/中文输入法（IME）视觉验收仍未完成）。
- 未做（明确不宣称）：真实浏览器、CSS 布局、屏幕阅读器与中文输入法（IME）实测；无网络、真实 API 与真实模型；未跑生产整套 test/lint/build（本轮无生产代码变更）。
- 边界：未改生产源码/依赖/生成产物（`dist/`、`package-dist/`、`package-offline/` 未触碰），未 commit/tag/push；不改之前 feature 状态、保留历史；既有中优先级遗留问题（同 session 并发、clear/compact 守卫、retry 生命周期、SSE 快照卡片刷新、验收证据一致性等）仍开放；无需生产 Wiki 同步（仅设计产物，未变公共入口）。
- 下一步：① 用户视觉验收该 HTML（摘要三态、输入框上方 icon、胶囊信息、面板折叠与主操作、pause→pausing→paused 时序与拒绝工具→paused、编辑 dirty 与取消语义、焦点圈闭、预算文案），并补真实浏览器/屏幕阅读器/中文输入法（IME）验收；② 验收通过后再决定是否另开 feature 推进生产落地。

---

## 上一轮交接：ai-goal-objective-edit-actions 高优先级按钮问题修复（2026-09-10，needs-review，仍待用户验收）

- 当前状态：代码完成、独立评审无阻断、父 Agent 针对性验证通过，feature 标 `needs-review`（代码/自动验证通过待用户验收，不宣称整个 Goal 已无缺陷）。未 commit（遵循项目规则，等待用户指示）。
- 目标与范围（用户明确）：本轮 Goal 只修高优先级按钮问题——goal 卡「修改目标/确认」按钮 disabled 只在整卡重渲染时按当时的 draft 计算，导致输入过程中状态不同步、点击时可能拿过期状态。上轮评审六项问题中的其余五类中优先级问题仍未修（见 feature_list.json boundaries）。
- 改动文件（仅 2 个代码/测试 + 3 状态文件）：`src/components/chat/panel-decoration/goal-card.ts`、`tests/frontend/goal-card-controller.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 关键设计：输入事件改为局部同步 dirty 相关按钮、不重建输入节点（textarea 节点/value/focus/选区保留属「输入不重绘」的代码保障，未做真实浏览器实测；`syncDraftActions` 闭包按 render 隔离，旧输入节点的处理器不更新新按钮）；按钮新增 `disabledForDraft(dirty)` 仅由输入事件调用（dirty 实时由 `editing && draftObjective.trim() !== view.objective.trim()` 推导），click 不重求 `disabledForDraft`，过期 confirm 提交由 `objectiveDirty()` 实时 return 防线拦截；dirty 按钮在 awaiting_confirmation/paused/blocked 各状态按同一规则 re-arm，草稿回退后 confirm 自动恢复。
- 测试：新增 6 条 controller 行为测试（输入即时启用 revise / dirty 时 confirm 不可用并回退 re-arm / 过期 confirm 点击被拒 / in-flight 重复鼠标提交与 Ctrl+Enter 被阻断等）。
- 验证（父 Agent 针对性）：`npx vitest run tests/frontend/goal-card-controller.test.ts tests/frontend/goal-card.test.ts tests/frontend/goal-state.test.ts` **3 files / 54 tests passed**（controller 19 / card 20 / state 15）；两改动文件 `npx eslint` **0 error**；`npx tsc -b` 无错误；JSON parse 与 `git diff --check` 通过。子 Agent 委派：先红（4 失败）后绿，`npx vitest run tests/frontend` **149 files / 1667 tests passed**。未跑全套 build。
- Blocker：无。
- 未做（明确不宣称）：真实浏览器焦点/选区实测与 IME 组合输入实测——测试用最小 fake DOM，仅断言输入过程未替换输入节点、未写入选区。
- 边界：未改架构/状态机/API 契约/i18n/视觉，无需更新 wiki；未改后端/依赖/生成产物；未 commit/tag/push。
- 下一步：① 浏览器真实输入冒烟（中文输入法、光标/选区、dirty 时 confirm 置灰、回退后恢复、点击无误提交）；② 用户验收后决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。
- 上一轮：ai-goal-mode（done，详见下方摘要与 progress.md）。

---

## 上一轮交接：ai-goal-mode Goal 模式（2026-09-10，done）

- 当前状态：服务端/前端实现、测试、wiki 文档全部完成，父 Agent 完整验证通过（`npm run test` 308 files / 3180 tests passed、`npm run lint` 0 error 仅 1 个既有 warning、`npm run build` 成功仅既有 KaTeX 字体与大 chunk 警告、`git diff --check` 通过、`git status` 无生成产物变更），feature 已标 `done`。未 commit（遵循项目规则，等待用户指示）。
- 目标：主聊天 `/goal <目标>` 先只读规划、用户 `confirm` 后有限轮执行，最终 `needs_review` 交回用户——`accept` 是唯一人审完成动作，`resume` 只继续执行；模型不能自行验收。
- 改动文件：新增 `server/agent-goal-state.mjs`、`server/agent-goal-runner.mjs`、`src/lib/goal.ts`、`src/components/chat/panel-decoration/goal-card.ts` 及 4 份服务端/3 份前端测试；改动 `server/agent-manager.mjs`、`server/agent-persistence.mjs`、`server/agent-prompt-commands.mjs`、`server/agent-approval-orchestrator.mjs`、`server/approval-store.mjs`、`server/custom-commands.mjs`、`server/routes/agent.mjs`、`server/routes/shared-conversation.mjs`、`server/tools/definitions.mjs`、`src/lib/server-agent.ts`、`src/lib/deferred-session-agent.ts`、`src/lib/chat-capabilities.ts`、`src/lib/i18n.ts`、`src/components/chat/{ChatPanelHost.tsx,panel-decoration.ts,command-suggestions.ts}`、`src/index.css` 及关联测试；wiki 6 份 + 三份状态文件。完整清单见 `feature_list.json`。
- 关键设计：预算默认 8 轮 / 30 分钟累计活跃（`revise` 保留累计用量，耗尽 `resume` 409 提示 cancel 新建）；每轮仅在运行真正结束且最终状态持久化成功后调度下一轮（fail-closed）；显式 settle barrier + abort generation 观测中止；goal body 随会话 CAS 持久化、重启 in-flight→`paused` 不自动重放；同一规范化工作区路径互斥；`goal_report` 会话专用（不在 `workspaceTools`/`GET /api/tools`、无 REST handler），证据只信任真实成功工具结果的 `toolCallId`，human 证据只由用户 `accept` 写入。
- 验证（父 Agent 完整验证，全部通过）：`npm run test` 退出码 0，308 files / 3180 tests passed；`npm run lint` 退出码 0，0 error（仅 1 个既有 warning `server/cloud/identity.mjs:92`），与本 feature 无关；`npm run build` 退出码 0（TypeScript 与 Vite 通过）；`git diff --check` 通过；`git status` 无 `dist/`、`package-dist/`、`package-offline/` 变更。cancel/settlement 收尾竞态已修复并有测试覆盖。未做浏览器 E2E、未做真实模型实测。
- Blocker：无（cancel/settlement 收尾竞态已修复并有测试覆盖）。
- 下一步：① 浏览器真实模型验收——`/goal` 规划→确认→执行→人审双按钮（accept/resume）→暂停/继续/修改/取消；② 用户决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。
- Notes：`server/context-references.mjs` 会话级残留 `modelAccessContext.source === 'shared'` 可能误拒 owner 首条带引用 prompt，另行 feature，本轮未修。
- 上一轮：subagent-run-detail-model-thinking（详见 progress.md）。

---

## 上一轮交接：subagent-run-detail-model-thinking 已完成（2026-09-09，done）

- 当前状态：代码、测试、文档完成；定向前端 99 tests、服务端 14 tests、`npm run lint`（0 error）、`npx tsc -b`、`npm run build` 全部通过；未 commit（遵循项目规则，等待用户指示）。
- 需求：点击 subagent 摘要打开的运行详情页（Workspace Inspector `kind:'subagent'` Tab）展示本次运行实际使用的模型与思考等级，范围仅详情页。样式两轮调整（用户确认）：最终为任务说明块上方独立一行、居中，只显示「模型名 · 思考等级」，不带标签与继承标记。
- 改动文件（7，i18n 无净新增）：`server/agent-subagent-runner.mjs`（新增 `subagentRuntimeDetails`，三处 details 展开）、`src/lib/subagent-run-detail.ts`（新增类型/payload 字段/解析/`'meta'` block/两个展示纯函数）、`src/lib/local-tools.ts`（新增 `renderSubagentRunMeta`，任务说明块上方独立一行居中）、`tests/frontend/subagent-run-detail.test.ts`、`tests/server/agent-manager.subagents.test.mjs`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`。
- 关键设计：服务端继承模型时补 `provider/id/name`（旧快照只有 `{mode:'inherit',inherited:true}`）；thinkingLevel 复用主 Agent i18n；meta 块不受 `detailed` 门控；产出条件为「有可显示模型标识或 thinkingLevel」（父 Agent 审查时修复的空块缺陷，已加回归用例）；渲染层 meta 独立于任务气泡，位于其上方一行。用户反馈「没看到思考等级」：该字段只对改动后新产生的运行生效，历史 details 无此字段，需重启 dev server 重跑验证。
- Blocker：无。
- 下一步：① 浏览器冒烟——点开运行中/已完成 subagent 详情，任务气泡顶部居中显示「provider / id · 高」，非推理模型显示「关」，长任务收起/展开不遮挡该行；② 用户决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）；③ 工作区仍有他人未提交 WIP，提交时注意分离。
