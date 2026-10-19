## 当前交接：goal-v2-dsh-round-driver（done，2026-10-19）

- Current Objective（当前目标）: 完全对标 DSH 重写 Goal v2 round driver，删除所有 QuickForge legacy 阻塞逻辑。已完成，未提交。
- 核心改动: `server/goal/runner.mjs` 完全重写为 DSH round driver——删除规划阶段、证据门禁、no_progress/repeated_failures 检测、goalRunSettling 结算屏障。每轮都是执行轮（objective + round number）；正常结束→complete/blocked 停止/直接下一轮；错误 disarm；轮次上限 block round_limit。`server/goal/prompts.mjs` 的 round prompt 改为 DSH 式（不含 criteria/evidence）。`agent-prompt-commands.mjs` 的 `/goal` 创建后返回文本响应（不产生规划模型轮次）。`update_goal complete` 在执行轮内直接生效。
- Files: `server/goal/runner.mjs`、`server/goal/prompts.mjs`、`server/agent-prompt-commands.mjs`、`tests/server/goal-v2-manager.test.mjs`、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- Evidence（验证）: `npm run test` 389 文件 4672 passed / 2 skipped；`npm run lint` 0 error；`npm run build` exit 0。v2 manager 6 passed。
- Blockers: 无。
- Next Session: 1) 真实模型跑 `/goal` 验证 DSH 流（无规划轮、直接执行、update_goal complete 即完成）；2) 验证错误后 disarm→用户 resume 可继续；3) 验证轮次上限后 blocked `round_limit` 可 extend_resume。未提交 Git。

---

## 当前交接：workflow-subagent-trace-budget（done，2026-10-19）

- Current Objective（当前目标）: workflow 内 Subagent 详情与直接 `run_subagent` 一样能看到工具调用。已完成，未提交。
- 核心改动: `MAX_SUBAGENT_RUN_JSON` 6000 → 80000，`MAX_SUBAGENT_TRACE_MESSAGES` 40 → 50。压缩仍从最旧消息丢起，但一次正常 toolCall/toolResult/最终回复可以留下。
- Files（改动文件）: `server/agent-workflow-runner.mjs`、`tests/server/agent-workflow-runner.test.mjs`、`docs/wiki/server/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 见本轮定向 vitest。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 重启服务后重跑一次带工具调用的 workflow，点进 Agent 详情确认工具卡。旧的已保存结果不会回填。

---

## 当前交接：latest-code-review（reviewed，2026-10-19）

- Current Objective（当前目标）: 只读评审最新代码。已完成，未改产品代码。
- 范围: 未提交的 workflow 内部行对齐与运行中 subagent trace；已提交的 Goal v2 与 `run_workflow`。
- 确认问题: `server/goal/tools.mjs` 的 `update_goal complete` 调 `service.complete(..., { by: 'user' })`，不检查 criteria/evidence。`server/goal/runner.mjs` 允许执行轮调用。`goal_report complete` 仍有证据与正常轮末/持久化门禁。`tests/server/goal-v2-manager.test.mjs` 把无证据完成当成通过。工具说明、`server/goal/prompts.mjs` 与 `docs/wiki/src/lib/README.md` 未标明这条旁路。
- 风险: `src/lib/tool-renderers/shared.tsx` 的 `ToolDetails` 只用最近 `.qf-tool-message` 的 toolCall id。workflow 内外两层 details 共用该 key，手动展开内部工具行会污染外层卡开合记忆。
- 风险: `server/agent-workflow-runner.mjs` `trimDetails` 先截断 agent 预览，之后才丢 `subagentRun`；大 trace 会先损失结果预览，截断 trace 仍占预算。
- Evidence（验证）: 定向 vitest 9 文件 exit 0；定向 eslint + `npx tsc -b --pretty false` exit 0。未跑全量 test/lint/build。
- Blockers（阻塞）: 无。是否收紧 `update_goal complete` 需要产品决定。
- Next Session（下一步）: 若要修，先决定执行轮完成是否必须绑定证据；再给 workflow 内层 details 单独记忆 key。

## 当前交接：workflow-inner-tool-parity（done，2026-10-19）

- Current Objective（当前目标）: workflow 内部工具行对齐外部普通工具卡，Agent 行对齐外部 sub-agent 卡。已完成，未提交。
- 核心改动: `WorkflowToolCallRow` 改用 `quickforge-local-tool`；`WorkflowAgentRow` 改用 `quickforge-subagent-tool` 整行打开详情。删除步骤 chevron、状态圆点、external-link 与展开体内的详情按钮。
- Files（改动文件）: `src/lib/tool-renderers/workflow-tool-renderer.tsx`、`src/index.css`、`tests/frontend/workflow-renderer.test.ts`、`tests/frontend/workflow-step-interaction.test.ts`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 2 文件 14 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端，展开一次 `run_workflow`，确认工具行点击展开、Agent 行整行打开 Inspector、结果默认收起。未跑全量 test/lint/build。
- 后续：工作流结果块改为默认收起的 details。workflow Agent 详情改为运行中即有有界 trace，工具结果保留 details，显示模式跟随外部工具设置。需重启服务后验证。

---

## 当前交接：goal-tool-card-display（done，2026-10-19）

- Current Objective（当前目标）: 优化 `get_goal`、`create_goal`、`update_goal` 的聊天工具卡显示。已完成，未提交。
- 核心改动: 新增 `src/lib/goal-tool-history.ts`、`src/lib/tool-renderers/goal-tool-renderer.tsx`；注册三个工具；补中英 `goalTool*` 文案。卡片为无边框、默认收起的只读历史投影。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `goal-tool-card-display` 条目。
- Evidence（验证）: 定向 vitest 10 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端后实际调用三个 Goal 工具，确认摘要、展开内容和详细模式 JSON；未跑全量 test/lint/build。

---

## 当前交接：goal-v2-event-sourced（done，2026-10-19）

- Current Objective（当前目标）: 按 DSH 的持久状态骨架完整实施 Goal v2，同时保留 QuickForge 的规划/证据/完成门禁；新目标默认 v2，旧会话保留 legacy。已完成，未提交。
- 核心改动: 新增 `server/goal/{state,store,service,errors,prompts,report-tool,tools,authority,runner,engine}.mjs`（4 phase + armed/disarmed + 事件日志 + 全量 CAS + Round Driver + goal_report/get_goal/create_goal/update_goal）。模型可从直接人类轮次自动创建/编辑/暂停/恢复 goal，goal 轮完成仍走 `goal_report` 证据，直接人类可用 `update_goal complete` 强制完成；`agent-manager` 为 v2 会话常驻注入 goal 控制工具并 `await beginGoalRun`；`agent-persistence` 持久化 `goalEvents`/`goalEngine`；restore 保留 v2 active+disarmed，旧快照 `migrateLegacyGoal` 转换。`/goal` 支持裸状态与 edit/pause/resume/clear；`goal-settings` 增加 `engine`（默认 v2）并提供设置页选择；`tests/setup-goal-engine.mjs` 让历史测试默认 legacy。
- 前端: `src/lib/goal.ts` v2 字段归一化/helpers；`goal-control-strip.ts` 显示 phase/轮次/目标第二行、“已中断”，complete 隐藏；`goal-card.ts`/Inspector/Summary 复用 v2 投影；i18n 中英 phase 文案；`index.css` v2 条带布局。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `goal-v2-event-sourced` 条目。
- Evidence（验证）: `npm run test` 388 文件 4672 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0。定向：v2 state/store/service 24 passed、v2 manager 6 passed、legacy goal 7 文件 211 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 1) 用真实模型/浏览器验收 v2：`/goal` 规划→自动执行→证据→complete、`/goal pause|resume|clear`、重启后 active+disarmed 显示“已中断”并手动继续；2) 检查设置页「Goal 引擎」切换与 legacy 回退；3) 把 `.tmp-vitest-shim.mjs` 删除或替换为正式测试运行方式（沙箱内 Vite 需要 `net use`/`.vite-temp` 写权限）；4) 后续可补 v2 的 failed/cancelled tombstone UI 标记与调度任务专项测试。未提交 Git。

---

## 当前交接：run-workflow-scripted-orchestration（done，2026-10-19）

- Current Objective（当前目标）: 按用户要求以 workflow 模式为 QuickForge 增加接近 DSH workflow 的脚本化多 Agent 编排（`run_workflow`），并完成测试、文档与全量验证。已完成，未提交。
- 核心改动: 新增 `server/agent-workflow-runner.mjs`（worker 生命周期、有界队列、总 deadline/父 abort、agent 失败降级 `null`、JSON Schema、details 裁剪与坏状态标记）与 `server/agent-workflow-worker.mjs`（worker_threads + vm guest bridge，hooks 全在 guest 内创建，host 对象不进入脚本，args/结果 JSON 序列化，resourceLimits/同步 10s/1MB 结果上限）。`agent-subagent-runner.mjs` 新增 `runWorkflowSubagent` 并抽取 `executeSubagentRun`，补 setup 期 abort 与审批 signal；`agent-manager.mjs`/`tools/definitions.mjs`/`approval-store.mjs`/`routes/tools.mjs`/`system-prompt.mjs` 完成工具定义、包装、审批、限制与引导接线。新增 `server/agent-workflow-tools.mjs` 提供 `tool()` 工具步骤：复用 `createServerTools` 的会话工具集/命令权限/workspace 沙箱与 `createApprovalPromise` 审批（source `workflow-tool`），排除递归/控制面工具并拒绝 `run_command run_in_background`；Agent 与工具共用有界步骤队列（`maxTools` 默认 64/上限 128）。前端新增 `src/lib/workflow-run-detail.ts`、`workflow-tool-renderer.tsx`，并接入 local-tools/index/shared 图标、i18n 32 键、CSS（每个 Agent/工具行独立 `<details>` 默认收起、点击展开任务/参数与结果；工具摘要横滑/结果代码块/控制台块/详细模式门控/running sweep/aria-busy/focus-visible/reduced-motion）、`process-folding` 排除 `run_workflow` 保持顶层可点击卡片、`src/lib/workflow-subagent-detail.ts` 把 Agent record 的 bounded `subagentRun` 转成 `SubagentRunPayload` 并派发 `OPEN_SUBAGENT_RUN_EVENT` 打开 Inspector Subagent 运行详情、approval-card、title-git-status-refresh。Runner 在 Agent 完成/失败时从最终 details / `quickforgeSubagentDetails` 提取最近 40 条消息、tools、allowedTools、model/thinkingLevel、pendingToolCalls（单 Agent≈6KB；超总量时 `subagentRunDropped`，仍可 summary 打开）。
- 关键契约: 默认权限下启动前展示**完整脚本**（脚本 ≤20KB）并审批一次，Agent 串行（`effectiveConcurrency=1`）以保证单槽位审批卡可见；完全访问才使用配置并发（默认 4 / 上限 8）。单步失败解析为 `null` 可继续；脚本异常/超时/父中止才整体失败，失败 details 经 `afterToolCall` 持久化。超时/中止/孤儿 Agent 在终态 details 中统一标记 `aborted`，不再残留 `running`。worker 提供隔离与可终止性，但不是 OS 沙箱，审批是信任边界。
- 文档: 新增 `docs/architecture/workflow-orchestration.zh-CN.md`；同步 `README.md`、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `run-workflow-scripted-orchestration` 条目；新增/改动的核心文件、测试与文档均已列入。
- Evidence（验证）: 本 feature 定向 9 文件 174 passed（workflow runner 26、approval orchestrator 23、subagent 集成 18，含真实 `tool("read_file")`、`run_in_background` 拒绝、approval-store 16、definitions 22、workflow-renderer 13、approval-card 7、process-folding 48、workflow-step-interaction 1）；`npx tsc -b` 通过；`npm run lint` exit 0；`npm run build` exit 0；`npm run test` 全量 388 文件 4675 passed / 2 skipped（exit 0，含同工作区已收敛的 Goal v2 改动）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 当前运行中的服务仍是旧代码，重启后才会加载 `run_workflow` 与 `tool()`。建议真机验证：① 让模型用 `run_workflow` 跑一个 `explore` + `general` 的 fan-out，确认工具卡摘要、阶段/Agent/工具/日志/结果与脚本折叠块；点击 Agent 行右侧 external-link（或展开体内的「查看运行详情」按钮），确认 Inspector 打开该 Agent 的 Subagent 运行详情（trace/tools/task/result），且行内 details 不被切换；② 脚本里用 `tool("read_file")` 与 `tool("write_file")`，确认工具行图标/摘要/展开参数与结果、写文件审批卡显示 Workflow 徽标；③ 默认权限下拒绝一次审批，确认卡片显示“失败 + 错误正文”而不是“正在准备”；④ 观察默认权限步骤串行、审批卡不互相覆盖；⑤ 超时/停止后确认所有 Agent/工具状态为 aborted；⑥ 完全访问下验证并发。未提交 Git；`dist/` 由 build 正常重生成，未手工修改 `package-dist/`/`package-offline/`。

---

## 当前交接：dead-code-cleanup-round3（done，2026-10-16）

- Current Objective（当前目标）: 按死代码评审清理高置信度 A 区僵尸代码。已完成，未提交。
- 改动文件: `src/components/chat/panel-decoration/icons.ts`、`message-queue.ts`、`ChatSurface.tsx`、`settings/tabs/shared.tsx`、`src/index.css`、`src/lib/i18n.ts`、`docs/wiki/src/lib/README.md`、评审报告、feature_list/progress/session-handoff。
- 已清理: 3 个无引用导出、6 个 i18n 孤儿键的中英词条、capability-suggestions 专属 CSS/死查询项、已确认无消费者的 settings/context/project picker CSS。
- 保留: `readSessionIdentityRows` 动态 facade 接口、`quickforge-tool-message` CSS 契约规则、K8 安全预留、B 区测试专用导出、C 区导出冗余、D 区历史 spike。
- Evidence（验证）: 定向 vitest 6 文件 96 passed；`npx tsc --noEmit` 通过；`npm run lint` 通过（1 个既有 warning）；`npm run build` 通过；`git diff --check` 通过。
- Blockers（阻塞）: 无。工作区另有用户此前 channels-removal 等未提交改动，本次未覆盖或回滚。
- Next Session（下一步）: 用户若需要可继续处理 B 区前 3 项或全部灰色项；当前清理未提交。

---

## 当前交接：channels-removal（removed，2026-10-16）

- Current Objective（当前目标）: 应用户要求彻底移除设置中的「渠道」功能（微信 bridge、渠道 API/SSE、sessions-changed 事件链、channelId/channelName 字段），不影响其他功能。已完成移除，未提交。
- 改动文件: 删除 15 个专用文件（server/channels/**、server/routes/channels.mjs、src/components/settings/tabs/ChannelsSettingsTab.tsx、tests/server/channels/**、tests/server/routes/channels.test.mjs、tests/server/agent-manager.channel-*.test.mjs ×3、tests/server/acp/server-channel-source.test.mjs）；修改 server/index.mjs、server/routes/agent.mjs、server/agent-manager.mjs、server/agent-persistence.mjs、server/agent-session-queries.mjs、server/session-state-service.mjs、server/acp/server.mjs、server/agent-goal-runner.mjs、src/lib/settings-tabs.ts、src/lib/react-settings-tabs.tsx、src/components/settings/SettingsWorkspacePage.tsx、src/App.tsx、src/hooks/useSessionPagination.ts、src/hooks/useAgentManager.ts、src/lib/types.ts、src/lib/server-agent.ts、src/lib/server-agent-types.ts、src/lib/global-agent-sse-client.ts、src/components/sidebar/ChatSidebar.tsx、src/components/settings/tabs/ArchivedConversationsSettingsTab.tsx、src/lib/i18n.ts、src/index.css、11 个混合测试文件、6 个 docs/wiki 文档、feature_list.json、progress.md、session-handoff.md。完整清单见 progress.md「channels-removal」节。
- 保留（与渠道无关，勿回退）: ACP 全链（qf acp / server/acp / source:'acp'）；BroadcastChannel 跨标签同步（其 sessions-changed 为跨标签事件同名）；Electron IPC 通知通道 / Android NotificationChannel / npm-runtime 更新 channel；sessionTitle 函数本体（签名简化为单参数，仍被 9 处使用）；i18n stop 键（MessageEditor 在用，start/restart 已删）。
- 遗留数据说明: 旧渠道会话持久化 data/metadata 的 channelId/channelName 字段与 ~/.quickforge/logs/channels/ 日志目录成为无主数据（不再被读取），无害、无需迁移；存量微信渠道会话标题退化为纯标题（用户已确认）。
- Evidence（验证）: 全仓 grep 残留仅无关命中；源码/测试/Wiki/入口精确标识检查为 0；Android 正规 `npm run android:sync` 已重新生成资产并移除旧 `ChannelsSettingsTab` bundle（剩余 `channel-*.js` 为 Monaco 语言包）；npm run test 381 文件 4595 passed / 2 skipped；npm run lint exit 0（1 个既有无关 warning）；npm run build exit 0；npx tsc --noEmit 通过。
- 复审结论（2026-10-16）: 渠道功能已完全从当前源码、测试、Wiki、入口及 Android 当前生成资产清除。修正 `feature_list.json` 中两处已删除 `ChannelsSettingsTab.tsx` 的过期文件路径。发现的 `BroadcastChannel`、Electron IPC notification channel、npm-runtime update channel、messages channel 均为独立功能，确认保留。
- Blockers（阻塞）: 无。工作区另有既存未跟踪临时文件 `0`、`m[1])`、`new`、`{try{require.resolve('jsdom')` 及 dead-code audit 报告，未纳入本 feature，未修改。
- Next Session（下一步）: 待用户决定提交时机；运行中的服务是旧代码，重启后设置页不再出现「渠道」Tab，/api/channels 返回 404（预期）。若将来要恢复渠道，可在 git 历史找回本次删除前的实现。

---

## 当前交接：dead-code-audit-round3（评审完成，未清理，2026-10-16）

- Current Objective（当前目标）: 全面评审僵尸代码（无引用代码/不可达分支）。评审已完成并沉淀报告，未改任何产品代码。
- Files（改动文件）: docs/reports/dead-code-candidates-2026-10-16.zh-CN.md（新增）、progress.md、session-handoff.md。
- Evidence（验证）: 三路独立扫描交叉验证 + grep 抽检复核；结论：0 僵尸文件 / 0 不可达分支 / 0 死 env 门控 / 0 context-eviction 残留 / 协议无孤儿；僵尸清单见报告 A/B/C/D 四区。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 待用户选定清理范围（仅 A 区 / A+B 前 3 项 / A+B 全部 / 暂不清理）；执行时行号以实际内容为准，需同步直测（B 区）与 wiki 文档。

---

## 当前交接：prefer-background-commands（done，2026-10-15）

- Current Objective（当前目标）: 基础系统提示词改为命令在可行时优先后台运行。已完成，未提交。
- 改动文件: server/system-prompt.mjs、tests/server/system-prompt.test.mjs、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: `npx vitest run tests/server/system-prompt.test.mjs` 8 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 无。

---

## 当前交接：agent-context-eviction-removal（removed，2026-10-14）

- Current Objective（当前目标）: 应用户要求彻底移除「上下文主动遗忘（context eviction）」特性（实现不理想：重复裁剪等）。已完成移除，未提交。
- 改动文件: 删除 7 个文件（server/context-eviction.mjs、src/lib/context-eviction-settings.ts、src/components/chat/surface/ContextEvictedBadge.tsx、src/lib/tool-renderers/context-eviction-tool-renderer.tsx、tests/server/context-eviction.test.mjs、tests/frontend/context-eviction-renderer.test.ts、docs/architecture/context-eviction-design.zh-CN.svg）；修改 server/agent-manager.mjs、auto-compaction.mjs、agent-persistence.mjs、agent-session-queries.mjs、tools/definitions.mjs、routes/tools.mjs、src/components/chat/surface/{surface-context.ts,ChatSurface.tsx,ToolMessage.tsx,AssistantMessage.tsx}、src/components/settings/tabs/DefaultOptionsSettingsTab.tsx、src/lib/{server-agent-types.ts,server-agent.ts,local-tools.ts,i18n.ts}、src/lib/tool-renderers/{index.ts,shared.tsx}、tests/frontend/{default-options-settings-react, default-options-settings-tab}.test.ts、docs/wiki/{server/README.md, server/routes/README.md, src/components/README.md, src/lib/README.md}、feature_list.json、progress.md、session-handoff.md。完整清单见 progress.md「agent-context-eviction-removal」节。
- 保留（与 eviction 无关，勿回退）: 767565c 夹带的最终回复可见性修复——process-folding.ts、thinking-final-reply-visibility.test.ts、process-folding-final-reply.test.ts、server-agent-final-answer-recovery.test.ts、agent-session-events.mjs 的 deliveredMessageCount/sse-frame 日志、global-agent-sse-client.ts 的 [sse-rx] 日志、server-agent.test.ts 的 mergeIncrementalMessages 断言、agent-session-events.test.mjs 的 split final-answer delivery 用例；auto-compaction 逻辑（maybeAutoCompactSession、压缩摘要、用量估算）仅去掉裁剪口径、行为不变。
- Evidence（验证）: 全仓 grep 零残留（源码/测试；feature_list/progress/session-handoff 历史条目允许保留）；npm run test 全量通过；npm run lint 通过；npm run build 通过（实测摘要见各自运行输出）。
- 遗留数据说明: 旧会话 JSON 的 contextEviction 字段与 settings.json 的 'context-eviction-settings' 键成为无主数据（不再被读取），无害、无需迁移。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 待用户决定提交时机；若后续想恢复类似能力，可在 git 历史中找回 767565c～本次移除前的实现。

---

## 当前交接：fix-process-folding-source-empty（done，2026-10-13）

- Current Objective（当前目标）: 修复「工具调用→思考→最终回复时最终回复被隐藏（刷新才恢复）」。已修复，用户真机确认（硬刷新后复现场景正常）。
- 根因/修复: `decorateProcessTurn` 流式期间为 thinking-only 行打 `quickforge-process-source-empty`（CSS 隐藏整行，当时正确）；正文后到时 agent_end 装饰走 skip 短路（终答指纹排除后匹配 thinking-only 态），三条提前 return 路径（skip/update/空 nodes）全部跳过 `updateEmptyProcessSources` → empty 残留 → 整行连同正文被隐藏。修复：三处提前 return 前补 `updateEmptyProcessSources(assistants)`（process-folding.ts）。取证链：[sse-frame]/[sse-rx] 两端帧流水日志（已保留，agent-session-events.mjs + global-agent-sse-client.ts，可按需移除）+ 用户 DOM console 输出定位 source-empty class。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-final-reply.test.ts、server/agent-session-events.mjs（取证日志）、src/lib/global-agent-sse-client.ts（取证日志）、tests/frontend/server-agent.test.ts（过时同 id 断言修正）。
- Evidence（验证）: 折叠层 4 文件 79/79 passed（含用户精确复现场景 4）；mutation 验证（回退即红/恢复即绿）；eslint + npm run build 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 待用户决定提交时机；取证日志（[sse-frame]/[sse-rx]）可在稳定后移除；feature_list.json 未单列此修复条目（记录于 progress.md 本节）。

---

## 当前交接：agent-context-eviction（done，2026-10-13）

- Current Objective（当前目标）: 设置门控的 Agent 主动遗忘上下文（feature 1+2+去轮次豁免：工具族 + 占位符投影 + 每请求占比通知 + 前端已裁剪标记 + 完全自主遗忘）。已实现并在本人会话完成真实 E2E，未提交。
- 改动内容: `server/context-eviction.mjs`（设置仅 enabled 单开关、账本、规则求值（olderThanTurns 纯过滤参数 0/缺省=不限轮龄、无服务端豁免）、占位符投影、buildContextUsageNotice 每请求恒注入占比通知（只有一行占比，无计数/清单/指引，条数与清单由 agent 自行调 context_report）、handleContextForget|Recall|Report）；`server/auto-compaction.mjs` sessionProjectionMessages 共用投影；`server/agent-manager.mjs`（transformSessionContext 投影链、三工具注册、免审批、refreshContextEvictionState、session 字段）；`server/agent-session-queries.mjs` 快照带账本；`server/agent-persistence.mjs` 账本持久化；`server/tools/definitions.mjs` + `server/routes/tools.mjs`。前端：`src/lib/context-eviction-settings.ts`（仅 enabled）+ `server-agent-types.ts`/`server-agent.ts`（contextEviction state+事件）+ DefaultOptionsSettingsTab 单开关 + i18n 中英。迭代⑤（工具卡显示优化）：三工具专属 icon（`tool-renderers/shared.tsx` renderToolIcon：剪刀/回退箭头/柱状图）+ `ContextEvictionToolRenderer` 折叠卡（计数摘要：已裁 {count} 条·释放 ~{tokens} tokens / 已召回 {count} 条 / 报告·{percent}%·已裁 {count} 条 + 斜体 reason（params，悬停全文）+ running/error 状态 + detailed JSON；`local-tools.ts` 注册；i18n 6 键中英）；徽标升级为共享 `ContextEvictedBadge`（剪刀+斜体 reason 截断+title 全文），surface context 由 Set 改 Map（id→entry 含 reason/kind），ChatSurface 快照 evictedEntries（新增 sameMapItems 保 identity-stable）。迭代⑥（修复重复遗忘 + 工具卡下拉详情）：`resolveForgetTargets` 接收账本 id 集——已入账 id 拆入 alreadyForgotten（数量+alreadyForgottenNow 清单）单独上报，forgotten/tokensFreed 只计本次新裁（content 区分全部已裁剪过/规则无匹配/混合 no-change）；forgottenNow 逐项带 { id, kind, toolName, tokens }、recall details 增 recalledItems；ContextEvictionToolRenderer 摘要区分三种 0 语义、展开体默认恒有明细区（forget 逐条 #短id·工具名·~tokens / recall 逐条 / report 完整文本）；i18n 中英 +7 键；工具描述补重复调用安全说明。迭代⑦（止住 forget 空转循环，2026-10-13）：buildContextUsageNotice 改状态感知——增账本计数行（已裁 N 条/剩余可裁 M 条，仅计数无清单）、候选 0 时明确「skip context_forget until new tool results or replies accumulate」替换 frees space 指引、details 增 forgottenCount/forgettableCandidates；context_forget「全部已裁剪过」文案附止步说明；根因为无状态通知每轮催促模型空转（投影链无 bug，裁剪后上下文确实每轮发出）。迭代⑧（通知减负，2026-10-13）：`buildContextUsageNotice` 收敛为 `({ settings, usage })`——去掉 session / loopMessages 与 forgettableCandidates 统计，通知只剩占比行（删账本计数行与两条分支指引句），details 只含 percent/inputTokens/contextWindow；`server/agent-manager.mjs` 调用点同步新签名与注释；`tests/server/context-eviction.test.mjs` 通知契约重写（只报占比行 + 负向断言）；`docs/wiki/server/README.md` 与 `docs/architecture/context-eviction-design.zh-CN.svg` 同步为「只有占比行：无计数、无清单、无工具指引」，⑥ 改为「残留：仅模型自发重复调用场景」。
- Files（改动文件）: 见 feature_list.json agent-context-eviction 条目。
- Evidence（验证）: context-eviction 29 passed（含 olderThanTurns 0 与仅保护对象用例）；真实 E2E 闭环（report→forget 357+339→recall→re-forget，占比 59.7%→28.8%）；tests/server 全量 1919 passed / 2 skipped / 1 failed（并行工作）；eslint 通过；build 仅挂并行工作的 server-agent.ts:1483。迭代⑦：context-eviction 32 passed。迭代⑧：`npx vitest run tests/server/context-eviction.test.mjs` 30 passed（通知只报占比行、details 只含 percent/inputTokens/contextWindow）；`npx eslint server/context-eviction.mjs server/agent-manager.mjs` 0 error 0 warning；grep 无残留计数行/清单指引文案（forgottenCount 仅存于 context_report details）；SVG XML 校验通过。
- Blockers（阻塞）: 无（本 feature 范围）。
- Next Session（下一步）: 并行会话坏点演进：server-agent.ts:1483 类型错误已由其自行修复、build 通过；当前残留 tests/frontend/server-agent.test.ts「merges incremental message tails positionally」失败（mergeIncrementalMessages id 相同时应保留旧消息，实现却新覆盖旧；测试注释「Message-id equality wins over content comparison」给出修复方向）——非本 feature 代码，待其作者收敛。本 feature：重启服务后真机验证工具卡显示（icon + 计数摘要 + 斜体 reason）与被裁消息徽标（剪刀 + reason）；迭代⑥追加验证项——重复调用同一 forget 规则时卡片摘要应显示「N 条均已裁剪过」而非「已裁剪 0 条」，混合场景显示新裁数 + 「另 M 条已裁剪过」，工具卡展开即见逐条明细（#短id · 工具名/早期回复 · ~tokens）、report 卡展开可见完整报告文本；迭代⑦追加验证项——重启后通知应为新格式（含「Forgotten ledger: N … M forgettable item(s) remaining.」计数行），已裁完的会话里模型不再每轮空转调 context_forget、不再重复出现「均已裁剪过」工具卡；迭代⑧替换该项——重启后通知只应有一行占比（无计数行 / 无清单 / 无 context_report·context_forget 指引），观察模型是否自行调 context_report 取条数与清单；待用户决定提交时机。

---

## 当前交接：split-final-answer-end-frame-gap（done，2026-10-13）

- Current Objective（当前目标）: 结束帧空尾部不再丢掉最终总结。已实现，未提交。
- 方案：缺投递游标时从 0 取尾部；事件只转换一次。客户端在 count 缺口或最后一条原地替换时强制回读。
- Files（改动文件）: server/agent-session-events.mjs、src/lib/server-agent.ts、tests/server/agent-session-events.test.mjs、tests/frontend/server-agent-final-answer-recovery.test.ts、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 相关测试 73 passed；eslint 通过。
- Blockers（阻塞）: 当前运行中的服务仍是旧代码，需重启后再测。
- Next Session（下一步）: 重启后跑一条带工具的长回复，确认结束后总结立即出现，刷新结果一致。

---

## 当前交接：split-final-answer-delivery-cursor（done，2026-10-13）

- Current Objective（当前目标）: 持久化抢先提交时，结束帧仍携带最终总结。已实现，未提交。
- 方案：`deliveredMessageCount` 与 `persistedMessageCount` 分离；结束帧取两者较小值作为未投递起点。
- Files（改动文件）: server/agent-session-events.mjs、server/agent-manager.mjs、tests/server/agent-session-events.test.mjs、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 相关服务端测试 109 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑长工具回合，确认结束后最终总结立即出现；刷新结果一致。

---

## 当前交接：release-v2.2.5（done，2026-10-13）

- Current Objective（当前目标）: 发布 v2.2.5。Git commit/tag/push 已完成，npm publish 待用户执行。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: test 4606 passed / 2 skipped；lint exit 0（既有 warning）；build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.5.tgz（7.7MB / 549 files / shasum f6b0741484ec62d3fccdb86d69d395370d28cf17）。
- Blockers（阻塞）: npm 发布未执行。
- Next Session（下一步）: 用户执行 `cd package-offline && npm publish --access public`，再用 `npm view @shawnstack/quickforge version` 验证。

---

## 当前交接：late-final-answer-process-fold（done，2026-10-13）

- Current Objective（当前目标）: 不断连时，最终答案不再被收进已折叠过程组。已实现，未提交。
- 方案：终答标记仅在它仍是最后一段正文时有效；否则清标记，并在终答缺失或仍位于过程组内时强制重装饰。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: process-folding 相关 4 个测试文件 80 passed；eslint 改动文件通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条带思考或工具、最终正文较晚出现的回复，确认正文在组外可见且无需刷新；展开状态与工具折叠动画无回归。

---

## 当前交接：tool-file-summary-span-click-preview（done，2026-10-10）

- Current Objective（当前目标）: 恢复「点击工具卡文件名即预览」，不违反「summary 内禁嵌交互元素」规范，并按用户要求去掉 write/edit/read 右侧眼睛按钮。已实现，已提交。
- 方案：规范禁的是 summary 内嵌**交互控件**（button/a 等）；文件名保持静态 span（无 role/tabindex）仅挂 click（复用 previewArtifactClickHandler，阻断折叠后派发 PREVIEW_ARTIFACT_EVENT），带 cursor-pointer + hover:underline 暗示；renderPreviewButton 收窄回仅 present_files，write/edit/read 文件名点击即唯一预览入口。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/lib/tool-renderers/local-workspace-tool-renderer.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: tool-renderer-file-icon 12 passed；连带 local-tool-running-sweep + tool-renderer-shared-state 35 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机打开含文件读写工具行的会话，点文件名直接预览且工具卡不折叠、hover 出下划线、右侧无眼睛按钮；DevTools Issues 确认无「Interactive element inside of a `<summary>` element」警告回归。取舍备忘：write/edit/read 预览入口无键盘路径（span 不进 tab 序列）。

---

## 当前交接：summary-interactive-content-a11y（done，2026-10-10）

- Current Objective（当前目标）: 消除 18 个「summary 内嵌交互元素」a11y 警告。已实现，未提交。
- 改动内容: renderToolFileSummary（write/edit/read 摘要文件名）统一静态 span；renderPreviewButton 扩展四类工具，预览入口统一为 summary 右侧动作区眼睛按钮（键盘可达）。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/lib/tool-renderers/local-workspace-tool-renderer.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: tool-renderer-file-icon 12 passed；连带 3 文件 47 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机打开含文件读写工具行的会话，DevTools Issues 确认警告消失；预览改用文件行右侧眼睛按钮，点文件名只展开/收起工具卡。

---

## 当前交接：resize-observer-noise-filter（done，2026-10-10）

- Current Objective（当前目标）: 控制台不再被 ResizeObserver loop 噪音刷屏，index.html 无废弃 meta 警告。已实现，未提交。
- 改动内容: 新增 `src/lib/error-noise.ts`（isResizeObserverLoopError）；`main.tsx` 全局 error/unhandledrejection 入口命中降级 logger.debug（quickforge_debug=1 可见）；`index.html` 补 mobile-web-app-capable meta（保留 apple 版）。
- Files（改动文件）: src/lib/error-noise.ts、src/main.tsx、index.html、tests/frontend/error-noise.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest error-noise 9 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机打开 DevTools 确认控制台不再出现 ResizeObserver loop 的 [ERROR] 行（如需查看可设 localStorage quickforge_debug=1 后看 debug 行）；`[Intervention] Images loaded lazily` 为浏览器优化提示，非错误，维持现状。

---

## 当前交接：release-v2.2.3（done，2026-10-10）

- Current Objective（当前目标）: 发布 v2.2.3 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 改动内容: 版本 2.2.3（package.json / package-lock.json）；CHANGELOG.md 新增 [2.2.3] 节（state 帧拉尾合入后补发 UI 通知 + 跨页续拉 + 回滚重拉重试）；README.md 版本文案 2.2.3。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: npm run test 387 文件 4596 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 warning）；npm run build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.3.tgz（7.7MB / 549 files / shasum c44eaa6e6ef711723083ed3d0962264cc73952aa）。
- Git: `5df3037 fix(chat): state 帧拉尾合入后补发 UI 通知，最终答案不再需刷新` + `chore(release): v2.2.3` + tag `v2.2.3`，已 push origin dev v2.2.3。
- Blockers（阻塞）: npm 未登录（whoami 401），publish 待用户 `npm login` 后执行 `cd package-offline && npm publish --access public`。
- Next Session（下一步）: 用户 publish 后 `npm view @shawnstack/quickforge version` 验证；真机验证长任务跨网络抖动后最终回答自动补回且无需刷新；确认处置工作区未跟踪的 new（0 字节，两次发布遗留）。

---

## 当前交接：state-frame-tail-merge-notify（done，2026-10-10）

- Current Objective（当前目标）: 修复用户在最新代码上仍复现的「最终答案偶发不可见、刷新才显示」。已实现，未提交。
- 根因: state 帧恢复路径时序倒挂——agent_end 在拉尾前同步发出（UI 读旧列表），reconcile 合入最终回答后 finish() 仅在 markers 存在时广播（无 goal 会话零通知），ChatSurface 再无事件驱动重渲染。4c653cd 只修了拉尾失败，未修「拉回后 UI 不知道」。
- 改动内容: `server-agent.ts` reconcileMessagesFromSummary——finish() 去掉 markers 前置（stateVersion 前进即广播 message_metadata_updated，marker replay 改写时先广播不双发）；hasMore 跨页整体重跑续拉（每页重置重试预算）；fetchAllMessagesFromServer 失败显式 null 与真空 [] 区分（失败进退避重试、真空替换本地；模块级 fetchAllSessionMessages 语义不变）。
- Files（改动文件）: src/lib/server-agent.ts、tests/frontend/server-agent-final-answer-recovery.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest final-answer-recovery 6 passed（新增 3 用例，主用例红灯验证：还原旧条件后仅收到 ['agent_end']）；连带 server-agent/events/http 166 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机验证长任务跨网络抖动后最终回答自动补回且无需刷新；随下次 patch 版本发布（v2.2.2 的 npm publish 仍挂起）。

---

## 当前交接：release-v2.2.2（done，2026-10-10）

- Current Objective（当前目标）: 发布 v2.2.2 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 改动内容: 版本 2.2.2（package.json / package-lock.json）；CHANGELOG.md 新增 [2.2.2] 节（run_command description 优先 + SSE 断连拉尾重试）；README.md 版本文案 2.2.2。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: npm run test 387 文件 4593 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 warning）；npm run build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.2.tgz（7.7MB / 549 files / shasum 336abea4bf25ee643e39fe5fc76d8dc0d4ad56b7）。
- Git: `b2cbe4d chore(release): v2.2.2` + tag `v2.2.2`，已 push origin dev v2.2.2（无历史 tag 误推）。
- Blockers（阻塞）: npm 未登录（whoami 401），publish 待用户 `npm login` 后执行 `cd package-offline && npm publish --access public`。
- Next Session（下一步）: 用户 publish 后 `npm view @shawnstack/quickforge version` 验证；确认处置工作区未跟踪的 new（0 字节）与 learning/（测试运行后出现，来源不明）。

---

## 当前交接：transformer-learning-project（done，2026-10-10）

- Current Objective（当前目标）: 创建 Transformer 学习项目并按用户要求迁出仓库。已完成，未提交。
- 内容: 7 章笔记 + 6 个纯 NumPy 示例 + 架构 SVG + README，最终位置 `D:\transformer-learning`（含重建的 .venv，Python 3.10.8 + numpy 2.2.6）；已通过 `POST /api/project/path` 注册为 qf 项目（id f2cde6ee-1a05-41ea-9af0-f7b17e8e40a7，注册时设为 active）。quickforge 仓库内 `learning/` 已删除，.gitignore 回滚。
- Files（改动文件）: .gitignore（净零变化）、progress.md、session-handoff.md；项目本体在 D:\transformer-learning（仓库外）。
- Evidence（验证）: 迁移后抽验：示例 01 运行通过、05 `--check-only` 梯度检查通过；qf /api/project 列表含 transformer-learning 且 workspaceRoot 已切换。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 无需跟进；qf 当前 active 项目变为 transformer-learning，用户如需回 quickforge 项目在 UI 项目列表切换即可。

---

## 当前交接：transformer-learning-project-initial（superseded，2026-10-10）

- 原 learning/transformer 创建记录见 progress.md「transformer-learning-project」条目；同会话已整体迁出至 D:\transformer-learning，本条仅存档。

---

## 当前交接：sse-reconnect-final-answer-recovery（done，2026-10-10）

- Current Objective（当前目标）: 修复「长任务 final answer 偶发看不见、刷新才看到」。已实现，未提交。
- 根因: SSE 断连窗口吞掉收尾帧（message_end/agent_end）后，重连 state 帧（split 会话只有 messagesSummary.count）内联合成 agent_end 并触发 /messages 拉尾；拉尾瞬时失败被 `if (!isCurrent() || !page) return` 静默放弃（无重试、watchdog 已停）→ 最终回答永久停留在服务端，刷新才恢复。state 帧 isStreaming=false 分支还残留 streamingMessage。
- 改动内容: `server-agent.ts` reconcileMessagesFromSummary 拉尾失败按 1s→16s 共 5 次退避整体重跑（版本守卫/追平空转/成功清理/耗尽放弃/dispose 清理）；case 'state' isStreaming=false 分支补清 streamingMessage 与三类 pending。新增回归 tests/frontend/server-agent-final-answer-recovery.test.ts。
- Files（改动文件）: src/lib/server-agent.ts、tests/frontend/server-agent-final-answer-recovery.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest final-answer-recovery 3 passed；server-agent + server-agent-events + server-agent-http 连带 160 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机验证长任务跨网络抖动（如断 Wi-Fi 数秒）后最终回答能在 ~31s 内自动补回；如仍遇到，查 global-agent-sse-client 10 次重连上限与后端不可达场景。

---

## 当前交接：run-command-description-first（done，2026-10-08）

- Current Objective（当前目标）: run_command 带 description 时，对话工具行摘要与子任务跑马灯优先显示 Description。已实现，未提交。
- 改动内容: `summarizeParams` run_command 分支优先返回非空 description（空白折叠）、空缺回退 command；`local-workspace-tool-renderer.tsx` 摘要 title 在描述与命令并存时为「描述\n命令」。子任务跑马灯复用同函数自动生效。
- Files（改动文件）: src/lib/tool-param-summary.ts、src/lib/tool-renderers/local-workspace-tool-renderer.tsx、tests/frontend/tool-param-summary.test.ts、tests/frontend/subagent-run-detail.test.ts、tests/frontend/local-tool-running-sweep.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 3 文件 129 passed；eslint 改动文件通过；npm run build 通过（tsc -b 首轮 title 类型错误已修复，externalized/大 chunk warning 为既有）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认带 description 的命令工具行显示描述、悬停可见命令；无 description 的命令仍显示命令本身。

---

## 当前交接：release-v2.2.1（done，2026-09-30）

- Current Objective（当前目标）: 发布 v2.2.1 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 改动内容: 版本 2.2.1（package.json / package-lock.json）；CHANGELOG.md 新增 [2.2.1] 节；README.md 版本文案。门禁修复：process-folding.ts 的 isProcessToolsGroupMember 补 `running !== false`（运行中后台命令不折叠、退出终态折回过程组）；subagent-running-indicator.test.ts 后台命令断言改为独立触发器 `.quickforge-background-command-trigger` + innerHTML badge 断言。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、src/components/chat/panel-decoration/process-folding.ts、tests/frontend/subagent-running-indicator.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: npm run test 386 文件 4586 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 warning）；npm run build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.1.tgz（7.7MB / 549 files）。
- Git: `68fa8621`（fix）+ `cf7c27b4 chore(release): v2.2.1` + tag `v2.2.1`，已 push origin dev。
- Blockers（阻塞）: npm 未登录（whoami 401），publish 待用户 `npm login` 后执行 `cd package-offline && npm publish --access public`。
- Next Session（下一步）: 用户执行 npm publish 后可用 `npm view @shawnstack/quickforge version` 验证；真机回归后台命令退出后折回过程组的显示。

---

## 当前交接：local-path-link-trailing-text（done，2026-09-29）

- Current Objective（当前目标）: 对话路径显示不再把文件地址后紧贴的文字吞进链接。已实现，未提交。
- 根因: 绝对路径分支尾部字符类 `[^\s"'<>\`]+` 吞 CJK 正文（含中文标点）；末尾剥标点救不回中间文字。
- 改动内容: `local-file-path-links.ts` 新增 `resolveLocalFilePathCandidate` 终点解析（剥标点 → 无 CJK / 扩展名结尾直接接受 → CJK 截断到扩展名 → 无效则放弃链接）；相对路径分支扩展名尾部负向前瞻防超 8 位英文粘连截半。测试新增 8 用例并完成红灯验证。
- Files（改动文件）: src/components/chat/panel-decoration/local-file-path-links.ts、tests/frontend/local-file-path-links.test.ts、docs/wiki/src/components/README.md（两份副本）、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest local-file-path-links 17 passed；decorator-copy-i18n + message-actions 连带 69 passed；eslint 改动文件通过；tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机发一条「已修改 D:\quickforge\src\index.css后面还有文字」类消息，确认链接只覆盖路径、正文完整显示；含中文目录的路径（D:\文档\说明.md）仍可点击。

---

## 当前交接：background-command-idle-keepalive（done，2026-09-29）

- Current Objective（当前目标）: 后台命令不再因会话空闲 10 分钟回收被连带终止。已实现，未提交。
- 根因: `resetIdleTimer` 到点 `destroyAgent` → `stopBackgroundCommandTasksForSession` 杀掉该会话全部运行中后台命令；SSE keep-alive 故意不重置计时器、后台命令运行中不保活。
- 改动内容: `server/agent-manager.mjs` `resetIdleTimer` 回调新增豁免——仍有运行中后台命令（`listBackgroundCommandTasks` 非空）时只重置计时器（与 goal waiter 同型）；命令退出后经通知路径重置计时器再按常规回收。新增回归测试 `tests/server/agent-manager.background-idle.test.mjs`（含无后台命令对照组仍回收、显式销毁仍终止命令）。
- Files（改动文件）: server/agent-manager.mjs、tests/server/agent-manager.background-idle.test.mjs、docs/wiki/server/README.md、docs/wiki/server/tools/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest agent-manager.background-idle 2 passed；tests/server 全量 174 文件 passed；npx eslint 改动文件通过；npm run build 通过（chunk 警告既有）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条长后台命令（如 dev server）静置 15 分钟以上，确认进程仍在、退出时收到 task-notification；如需“用户停止 run 不杀后台命令”，再评估移除 detach 后的 run signal abort 监听（当前保持既有行为）。

---


## 当前交接：chat-h5-no-horizontal-scrollbar（done，2026-09-28）

- Current Objective（当前目标）: H5 聊天消息区不再出现底部横向滑动条，宽 KaTeX 公式块内横滑。已实现，未提交。
- 根因: 主滚动容器 overflow-y-auto 的另一轴按规范被计算为 auto；KaTeX 展示公式容器（裸 my-4 div）无溢出保护，宽公式撑破消息列。
- 改动内容: .qf-chat-panel > .qf-scroll-container 加 overflow-x:hidden（主滚动容器只管纵向）；KatexMath display 分支挂 quickforge-katex-scroll（unlayered：overflow-x auto + 隐藏滚动条 + touch 滑动）；chat-math 测试 3 处容器类名断言同步；css-contract 测试新增滚动契约用例。
- Files（改动文件）: src/index.css、src/components/chat/surface/KatexMath.tsx、tests/frontend/chat-surface-css-contract.test.ts、tests/frontend/chat-math.test.ts、docs/wiki/src/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 47 passed；npm run lint 通过（仅既有无关 warning）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机 H5 发一条宽公式（长积分/求和）与长表格消息，确认底部无横向滑动条、公式块可滑、纵向滚动正常。

---

## 当前交接：tool-summary-no-ellipsis（done，2026-09-28）

- Current Objective（当前目标）: 工具长摘要不再省略，超长可横滑，并完成 build。
- 改动内容: 去掉命令、生图、文件列表和子任务摘要的硬截断。工具行与子任务行改为完整文本横向滚动，H5 可触摸滑动。
- Files（改动文件）: src/lib/tool-param-summary.ts、src/lib/subagent-run-detail.ts、工具渲染器、src/index.css、相关测试、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 213 passed；npm run build 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看长命令、长搜索、长生图提示词和子任务行，确认没有省略号且能滑到末尾。

---

## 当前交接：run-command-summary-no-ellipsis（done，2026-09-28）

- Current Objective（当前目标）: run_command 摘要不再出现省略号，长命令可横向滚完。已实现，未提交。
- 根因: 摘要硬截 72 字加 …，父级 overflow:hidden 继续裁切。
- 改动内容: 摘要输出完整命令。超长时整行横向滚动，H5 可触摸滑动，滚动条隐藏。
- Files（改动文件）: src/lib/tool-renderers/local-workspace-tool-renderer.tsx、src/index.css、tests/frontend/chat-surface-css-contract.test.ts、tests/frontend/local-tool-running-sweep.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：chat-surface-css-contract + local-tool-running-sweep 42 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看一条超长 run_command，确认没有省略号，可横滑到命令末尾。

---

## 当前交接：edit-diff-long-line-scroll（done，2026-09-28）

- Current Objective（当前目标）: edit_file 长行在 diff 内滚动，不撑开对话，H5 可滑。已实现，未提交。
- 改动内容: diff 块限制在列宽内。长行横向滚动且增删背景铺满整行，行号列保持可见。H5 使用 touch 横滑和纵滑。
- Files（改动文件）: src/index.css、tests/frontend/diff-view.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：diff-view + chat-surface-css-contract 60 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机展开一条长 edit_file，确认可横滑，行底色不中断，手机上也能滑。

---

## 当前交接：tool-command-console-scroll（done，2026-09-28）

- Current Objective（当前目标）: run_command 长命令可在工具卡内滚动，且未溢出的文字不再被遮成空白。已实现，未提交。
- 根因: 控制台左右渐隐始终生效，短行两端也被虚化。
- 改动内容: 溢出侧改内阴影，不用 mask。H5 可触摸横滑和纵滑。未超出不提示；滚到中间两侧提示；滚到末尾只提示左侧。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/index.css、tests/frontend/tool-renderer-shared-state.test.ts、tests/frontend/chat-surface-css-contract.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：52 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机展开一条长 run_command，确认可横向滚动，短行和滚到尽头的一侧不再空白。

---

## 当前交接：subagent-title-command-gap（done，2026-09-28）

- Current Objective（当前目标）: 子任务输出很长时，标题和后面的命令显示中间不再空出一段。已实现，未提交。
- 根因: 标题和命令跑马灯都是 flex:1，剩余宽度被平分。
- 改动内容: 标题按内容收缩，长标题才省略；命令继续占用剩余空间。
- Files（改动文件）: src/index.css、tests/frontend/chat-surface-css-contract.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：chat-surface-css-contract 36 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看一条长输出的子任务，确认标题紧挨后面的命令，过长时标题省略而不是中间留白。

---

## 当前交接：composer-console-fixed-width（done，2026-09-24）

- Current Objective（当前目标）: 输入框旁控制台弹出面板不再被长命令撑宽。已实现，未提交。
- 改动内容: 后台命令菜单固定宽度。长命令在条目内横向滚动，左右高斯模糊渐隐。
- Files（改动文件）: src/index.css、tests/frontend/subagent-running-indicator.test.ts、design-mockups/command-console-fixed-width.html、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机点输入框旁终端图标，确认面板宽度不变，长命令可横向滚动并看到左右模糊。

---

## 当前交接：background-command-presence（done，2026-09-24）

- Current Objective（当前目标）: 后台命令在对话和 Composer 运行摘要中可见，并可从摘要关闭。已实现并验证，未提交。
- 改动内容: 运行中的后台命令独立显示；摘要计数和列表包含它，列表项调用 abort-tool 关闭。退出后工具结果改为终态，摘要同步移除。
- Files（改动文件）: server/tools/index.mjs、server/agent-manager.mjs、server/agent-session-queries.mjs、src/lib/server-agent.ts、src/lib/server-agent-types.ts、src/lib/shared-server-agent.ts、src/lib/i18n.ts、src/index.css、src/components/chat/ChatPanelHost.tsx、src/components/chat/panel-decoration.ts、process-folding.ts、subagent-running-indicator.ts、ChatSurface.tsx、local-workspace-tool-renderer.tsx、相关测试、docs/wiki、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认后台命令在回合结束后仍单独显示，摘要可关闭并随退出消失。

---

## 当前交接：run-command-background（done，2026-09-24）

- Current Objective（当前目标）: `run_command` 支持后台分离执行。已实现并验证，未提交。
- 改动内容: `run_in_background: true` 立即返回输出文件和 taskId；进程跨回合运行，stdout/stderr 持续写入命令日志；退出后向原会话发 `<task-notification>`。流式中走 followUp，空闲时开下一轮，活跃 Goal 暂存。销毁会话会终止其后台命令。
- Files（改动文件）: server/tools/definitions.mjs、server/tools/index.mjs、server/tool-wiring.mjs、server/agent-manager.mjs、server/system-prompt.mjs、src/lib/tool-renderers/shared.tsx、src/components/chat/surface/ToolMessage.tsx、tests/server/tools/run-command-background.test.mjs、tests/server/tools/definitions.test.mjs、tests/server/system-prompt.test.mjs、docs/wiki/server/tools/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条长命令，确认当前回合可继续使用其他工具，并在进程退出后收到通知。

---

## 当前交接：thinking-before-tool-order（done，2026-09-24）

- Current Objective（当前目标）: 第一轮思考过程保持在后续工具调用之前。已补上组前插入与跨 assistant 两条路径，未提交。
- 根因: 折走时的 `sourceNextSibling` 在工具行插到它前面后仍然有效，还原会把思考放到工具后面。
- 改动内容: 锚点前移到新插入节点之前；全量重建按来源 content 序号排回源序。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认第一轮「思考 → 工具」不再颠倒。

---

## 当前交接：android-cloud-removal（done，2026-09-24）

- Current Objective（当前目标）: 移除安卓端云服务原生功能和页面残留。已完成并提交。
- 改动内容: 删除 RemoteTunnel 插件、云账户存储、云 API、WebRTC 隧道服务及测试；Manifest、Gradle、Capacitor 白名单和架构文档同步。保留 Tailscale/局域网直连与通知服务。
- Files（改动文件）: android/app/src/main/java/com/quickforge/mobile/remote/、android/app/src/test/java/com/quickforge/mobile/remote/、MainActivity.java、AndroidManifest.xml、android/app/build.gradle、capacitor.config.ts、docs/architecture/android-remote-client.zh-CN.md、docs/wiki/src/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 未执行 Android Gradle 构建。旧 APK 前端资源仍在 `android/app/src/main/assets/public/`。
- Next Session（下一步）: 需要新 APK 时运行 `npm run android:sync` 覆盖旧云页面资源。

---

## 当前交接：tool-file-underline-on-name（done，2026-09-23）

- Current Objective（当前目标）: 编写/写入文件的下划线只在悬停具体文件名时出现。已实现，未提交。
- 根因: 文件名 `group-hover:underline` 被整行 `group/tool` 触发。
- 改动内容: `renderToolFileSummary` 改为文件名自身 `hover:underline`，按钮去掉 `group`。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认悬停「已执行 / 编辑 / 写入」不再出下划线。

---

## 当前交接：inspector-tab-fade（done，2026-09-23）

- Current Objective（当前目标）: 右侧工作栏多个 Tab 时变短、无中间分隔线，标题右侧渐隐替代省略号。已实现，未提交。
- 改动内容: 多 Tab 在 `min-w-24` / `max-w-32` 之间均分，放不下横向滚动；去掉竖线，标题在关闭按钮左侧正常流里渐隐，文字不覆盖 X。下拉列表选中项与 hover 同为淡背景。
- Files（改动文件）: src/components/workspace/WorkspaceInspector.tsx、src/index.css、tests/frontend/workspace-inspector-tab-fade.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看多 Tab 渐隐是否够柔和；其余未提交改动仍待按需发版。

---

## 当前交接：thinking-before-tool-order（done，2026-09-23）

- Current Objective（当前目标）: 第一轮思考过程保持在后续工具调用之前。已实现并验证，未提交。
- 根因: 思考块先折叠时还原锚点为 null，同一容器后追加的工具行在全量重建时被 append 到思考前面。
- 改动内容: `restoreGroupedProcessNode` 在锚点失效时插回过程组之前。新增同容器顺序回归；wiki 两份所有权租约已同步。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 5 文件 86 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认第一轮「思考 → 工具」顺序不再颠倒；其余未提交改动仍待按需发版。

---

## 当前交接：thinking-hint-hide-when-thinking-ends（done，2026-09-23）

- Current Objective（当前目标）: 思考过程完成后，右侧尾行提示不再显示。已实现并验证，未提交。
- 根因: 右侧提示跟整条消息的 `isStreaming`，思考段结束后正文/工具仍在流式时提示不收。
- 改动内容: `process-folding.ts` 改为只显示仍是 content 末块、无 `thinkingSignature`、且消息仍在流式的思考段；结束后立即淡出。CSS 注释与 wiki 两份契约同步。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、src/index.css、tests/frontend/thinking-hint.test.ts、tests/frontend/thinking-streaming-stage.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 28 passed + 连带折叠/接管 74 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认思考写完、正文开始后右侧提示淡出；其余未提交改动仍待按需发版。

---

## 当前交接：stage-collapsed-no-round-flip（done，2026-09-23）

- Current Objective（当前目标）: 修复用户反馈「关闭『工具调用列表默认展开』后，新的一轮消息来了仍会展开又收缩反复」。经确认按方案 A 实现：设置关闭时内层 stage 全程收起、不自动展开；正在流式的思考行（含尾行提示）改挂顶层组 body 显示，本轮结束后随重建收进 stage。已实现并验证（feature_list.json 标 done），改动未提交。
- 根因: `updateProcessStageGroups` 的 stage 默认值原为 `processStageDefaultExpanded() || processStageHasStreamingThinking(stageBody)`（含流式思考就强制展开）；而每轮工具调用结束的组全量重建让新 stage 元素回落设置默认（收起），下一轮流式思考再顶开 → 第 2 轮起逐轮开合往复。
- 改动内容:
  1. `src/components/chat/panel-decoration/process-folding.ts`：新增 `processThinkingAssistant` / `isStreamingThinkingItem` / 导出 `splitStreamingThinkingRuns`（按位置切 run：liveThinking 挂组 body、其余包 stage，顺序不变）；`populateProcessGroup` 仅在设置关闭时切分；`updateProcessStageGroups` 默认值回归 `processStageDefaultExpanded()`，删除 `processStageHasStreamingThinking` 与强制展开。
  2. 测试：thinking-streaming-stage 的 S2 / 流式结束回填 / 跨 assistant / 手动收起用例按新语义重写，新增多轮工具循环往复回归；process-folding 新增切分函数单测。
  3. 文档：`docs/wiki/src/components/README.md`（两份副本）+ `docs/wiki/src/lib/README.md` 的折叠默认值契约同步为 `isStreamingThinkingItem` / `splitStreamingThinkingRuns`。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/thinking-streaming-stage.test.ts、tests/frontend/process-folding.test.ts、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 3 文件 61 passed + 连带 6 文件 104 passed + tests/frontend 全量 210 文件 2674 passed；`npx eslint`（改动文件）/ `npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 382 文件 4561 passed / 1 skipped（无失败）。
- Blockers（阻塞）: 无。
- Notes:
  - 设置默认展开（默认 true）时结构与行为零变化；切分只在「关闭设置」时启用。
  - 观感取舍（用户已确认）：本轮思考结束后该思考行随重建收进已收起的 stage（即该行消失），换取不再有自动开合动画。
  - 工作区同时存在并行会话 `thinking-hint-growth-inplace` 的改动（同文件不同函数）与 `streaming-display-stability` 的未提交改动；本轮未提交 Git；未触碰生成产物。
  - `settings-row-infotip` 仍为 pending。
- Next Session（下一步）: 真机跑一轮多轮工具循环（关闭「工具调用列表默认展开」）确认不再逐轮开合、流式思考行与尾行提示可见、本轮结束收进 stage；确认后可与其它未提交改动一起按 runbook 发小版本。

---

## thinking-hint-growth-inplace（done，2026-09-23）

- Current Objective（当前目标）: 修复用户反馈「对话中思考过程中的右侧显示会一句话重复显示两次」——思考行右侧尾行提示（hint）在「同一行内增长」时被反复整行滚入，两个视图同显同一句。按用户确认的方案 A 完成：只在行切换时滚入，同一行内增长就地更新。已实现并验证（feature_list.json 标 done），改动未提交。
- 根因:
  1. hint 是 header 第四槽位的 `quickforge-tool-marquee`；`ToolMarqueeController` 对任何 text 变化都 `beginRoll`（旧文上滚出 + 新文下滚入，滚入期间两视图同时可见），而 `syncProcessThinkingHint` 在流式「同一行内增长」时也会每 ~300ms 写一次 `text` → 260ms 滚入被反复触发、两视图长期同显同一句（只差几个字）。
  2. 复现证据：直接驱动 `ToolMarqueeController` 跑序列，grow 帧 `v0[VIS/s=句子A] v1[VIS/s=句子A-grow]` 双视图 VISIBLE。
- 改动内容:
  1. `src/lib/tool-marquee.ts`：`sync(text, running, restart = false, roll = true)`——`roll=false` 时 text 变化走就地更新（`applyInstant`），不再整行滚入；默认 true 保持 subagent 摘要卡行为。
  2. `src/lib/tool-renderers/shared.tsx`：`QuickForgeToolMarquee` 增 observedAttributes `roll`，回调只记录意图（`rollOnChange`，connectedCallback 复位），`sync()` 一次性消费并透传；`scheduleRestart` 统一 `sync(true)`。
  3. `src/components/chat/panel-decoration/process-folding.ts`：textChanged 分支先写 `roll`（`lineSwitched ? 'true' : 'false'`）再写 `text`（标记必须每次随 text 写，元素消费后复位）。
  4. 文档：`DESIGN_LANGUAGE.md`、`docs/wiki/src/components/README.md`（接管契约两份副本）、`docs/wiki/src/lib/README.md`（tool-marquee.ts 条目）。
  5. 测试：`tool-marquee.test.ts` +2、`thinking-hint.test.ts` +1、新增 `tests/frontend/thinking-hint-marquee-inplace.test.ts`（jsdom 全链路：真 React ThinkingBlock → 装饰层 → 真 `quickforge-tool-marquee` 元素 → ToolMarqueeController，桩 `Element.prototype.animate` 观察滚入）。
- Files（改动文件）: src/lib/tool-marquee.ts、src/lib/tool-renderers/shared.tsx、src/components/chat/panel-decoration/process-folding.ts、tests/frontend/tool-marquee.test.ts、tests/frontend/thinking-hint.test.ts、tests/frontend/thinking-hint-marquee-inplace.test.ts、DESIGN_LANGUAGE.md、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest tool-marquee 17 passed（+2 新例）、thinking-hint 16 passed（+1 新例）、新 jsdom 全链路 1 passed、思考/折叠/跑马灯/接管相关 7 文件 133 passed；**旧实现红灯验证**（临时把 roll 恒写 `'true'`）新用例在症状级断言失败 `expected 0 to have length 2`（同行增长仍触发两次整行滚入）+ thinking-hint 新用例同时失败，改回后全绿；`npx tsc --noEmit` 通过；`npx eslint`（src + 新测试）通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 383 文件 4562 passed / 1 skipped（无失败）。
- Blockers（阻塞）: 无。
- Notes:
  - 前一次全量中失败的 `tests/server/session-state-repository.test.mjs`（multi-process CAS writer 时序用例）在最新全量中通过，确认为并发负载下 flaky，与本改动无关。
  - 未动：取段规则 / 500 码点截断 / 300ms 节流 / 淡入淡出 / 行切换滚入 / release gate / 思考头接管契约；subagent 摘要卡跑马灯默认行为不变（roll 缺省 true）。
  - 无依赖变更；未触碰 dist/package-dist/package-offline；未提交 Git。
  - settings-row-infotip 仍 pending（WIP 不在本轮）；上一轮 streaming-display-stability 的改动仍在工作区未提交。
- Next Session（下一步）: 真机跑一轮带思考的流式对话验证观感（重点：右tail提示不再同一句上下两份、行切换仍有滚入、长行溢出滚动仍在增长停止后恢复）；确认后可考虑与 streaming-display-stability 一起按 runbook 发小版本；处理 pending 的 settings-row-infotip、session-state-repository flaky 用例。
