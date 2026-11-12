# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：上帝模块治理⑦——src/App.tsx 按职责拆分（2026-11-12 12:06）

- 结论：完成。App.tsx 2334 → 1585 行（MainApp 约 2120 → 约 1520）。任务点名的三块业务规则——openLocalFilePathFromChat（拼路径+fetch）、已删项目恢复策略执行、artifact 预览/自动预览挂起规则——全部迁出视图层；另迁出 agent 事件联动、窗口事件桥、bot 模式块、侧聊宿主、新对话空态+taskLauncher、顶栏工具条 JSX。逐字搬移 + 装配层接线，对外行为与 UI 完全不变。
- 新模块：`src/lib/agent-event-guards.ts`；`src/hooks/useAgentSessionEvents.ts`、`useChatFileOpener.ts`、`useDeletedProjectRecovery.ts`、`useArtifactPreviewActions.ts`、`useAppEventBridges.ts`、`useBotWorkspace.ts`、`useSideChatPanel.ts`、`useNewChatEmptyState.ts`；`src/components/app/WindowToolbar.tsx`、`StartupErrorScreen.tsx`。
- 测试同步：15 个读 App.tsx 源码文本的测试断言改指新模块（语义不变；负向断言在新旧文件双保留防回流；slice 锚点随代码同迁）。
- 文档：`docs/wiki/src/README.md`（App.tsx 第三轮拆分记录）、`src/hooks/README.md`（+8 hook，37 个）、`src/components/README.md`（app/ 新组件）已同步。
- 验证：`npm run test` 全量 526 文件 5810 passed / 2 skipped；`npx tsc -b` 通过；`npm run build` 通过；npx eslint 全部改动文件 0 problems。
- 未完 / 下一步：①改动留工作区**未 commit**；②god-module-decomposition ⑥（server-agent）由并行会话完成中/已完成，⑦ 本轮收口；③归档本轮未跑（progress/handoff 含并行会话活跃段落，避免误归档，下次归档时机再处理）；④MainApp 剩余约 1520 行为状态声明+hooks 装配+JSX 装配，后续如继续瘦身可拆 WorkspaceInspectorHost/移动抽屉，但它们被 sidebar-section-order/focus-ring 测试钉住，收益/风险比一般。

## 本轮：上帝模块治理⑥——src/lib/server-agent.ts 按职责拆分（2026-11-12 11:35）

- 结论：完成。2817 行 10 类职责的上帝模块拆到 `src/lib/server-agent/` 目录（24 个职责模块）+ 46 行门面 `server-agent.ts`；26 个导出名经门面逐名保持，21 个消费方零改动；逐字搬移纯重构，行为不变。
- 新模块：`core.ts`（ServerAgentState + ServerAgentCore 内部协作面）、`agent.ts`（类本体：状态字段/构造/buildCore 闭包上下文/订阅/租约薄门面/委托与静态工厂 hooks）、`prompt-actions.ts`、`approval-actions.ts`、`goal-actions.ts`、`rollback-actions.ts`、`state-sync.ts`、`messages-channel.ts`、`history-reconcile.ts`、`sse-dispatch.ts` + `sse-state-frame.ts`/`sse-run-lifecycle.ts`/`sse-message-sync.ts`/`sse-tool-events.ts`/`sse-approvals.ts`/`sse-goal-events.ts`/`sse-compaction-events.ts`/`sse-session-events.ts`、`goal-iteration-markers.ts`、`snapshot.ts`、`factories.ts`、`errors.ts`、`runtime-status.ts`。
- 关键不变量：测试硬触点保留在类上（`handleSseEvent`/`refreshStateFromServer`/`stateVersion` 字段/`emitToListeners` 私有签名/原型实例兼容的轮级回滚）；事件分发契约 handler 返回 true=原 break（分发层转发）/false=原 return（族内自管转发）；factories→agent 仅 type-only 引用，无 runtime 循环。
- 测试同步：goal-card / ask-user-card / assistant-artifact-card / chat-surface-behavior-alignment / deferred-handoff-contract 5 个文件里 6 处读 server-agent.ts 源码文本的断言改指新模块（断言语义不变）。
- 文档：`docs/wiki/src/lib/README.md` 模块表（server-agent.ts 门面行 + server-agent/ 目录行）与 3 处文件指称已同步；feature_list.json ⑥ 标完成。
- 验证：基线与拆分后相关测试同为 18 文件 411 用例绿；`npm run test` 全量 526 文件 5810 passed / 2 skipped 绿（首轮 1 个服务端 SQLite CAS 竞速用例满负载抖动，单跑+全量重跑均绿，与前端改动无关）；`npx tsc -b` 通过；`npm run build` 通过；改动文件 eslint 0 problems。
- 未完 / 下一步：①全部改动留工作区**未 commit**（我的足迹：src/lib/server-agent.ts、src/lib/server-agent/ 新目录、上述 5 个测试文件、docs/wiki/src/lib/README.md、progress/session-handoff/feature_list）；②上帝模块治理只剩 ⑦src/App.tsx（MainApp 单函数 1808 行）；③归档脚本本轮未跑（progress/handoff 含并行会话段落，避免误归档）。
- 与 bots 会话并行：其改动文件（server/bots*、bot-runner、routes/bots、tests/server/bots*、docs 三份、docs/wiki/README.md、wiki/bots.md、skills endpoints、src/components/bots、bot-mascot、BackgroundTasksTabContent、local-workspace-tool-renderer、useAgentManager、session-reload-guard 相关、i18n、fork-session-visibility）一律未触碰。

## 本轮：上帝模块治理⑤——server/agent-manager.mjs 按职责拆分（2026-11-12 10:40）

- 结论：完成。2197 行 8 类职责的上帝模块拆为 10 个职责模块 + 133 行薄 facade；49+5=54 个契约导出名经 facade re-export 全部稳定，21 个导入方零改动；纯重构逐字搬移，行为不变。
- 新模块：`server/agent-turn-ids.mjs`、`agent-tool-assembly.mjs`、`agent-context-transform.mjs`、`agent-idle-recycler.mjs`、`agent-run-events.mjs`、`agent-background-commands.mjs`、`agent-session-lifecycle.mjs`（createAgent 等）、`agent-rollback.mjs`、`agent-run-orchestration.mjs`、`agent-session-updaters.mjs`；`server/goal/engine.mjs` 增补 `activeGoalStatus`；`server/agent-manager.mjs` 定形薄门面。
- 测试同步：`tests/server/system-prompt.test.mjs`、`tests/server/agent-manager.context-references.test.mjs` 的源码文本断言路径改指 `agent-session-lifecycle.mjs`（断言语义不变）。
- 文档：`docs/wiki/server/README.md` agent-manager 章节与拆分模块清单已同步；`feature_list.json` god-module-decomposition ⑤ 标完成。
- 验证：agent-manager 专项 12 文件 100 用例绿；`npm run test` 全量绿（525 文件，5805 passed / 2 skipped）；`npx tsc -b` 通过；`npm run build` 通过；全仓 eslint 0 problems。
- 未完 / 下一步：①全部改动留工作区**未 commit**；②上帝模块治理还剩 ⑥src/lib/server-agent.ts、⑦src/App.tsx 未动；③归档脚本本轮未跑（progress/handoff 有并行 bots 会话的活跃段落，避免误归档，下次归档时机再处理）。
- 与 bots 会话并行：其改动文件（server/bots*、bot-runner、routes/bots、tests/server/bots*、docs 三份、wiki/bots.md、skills endpoints、src/components/bots、bot-mascot、BackgroundTasksTabContent、local-workspace-tool-renderer、session-reload-guard 相关）一律未触碰。

## 本轮：修复重复点击同一 bot 对话卡「正在加载中」10 秒（2026-11-12 10:35）

- 结论：bug 已修。根因是 `performLoadSession` 对同会话重复点击不是空操作——bot 会话每次必 `await switchActiveProject`（bot 项目永远写不进 activeProject，恒为无效写），中间态触发兜底「正在加载对话」遮罩后无人能发就绪信号（agent 引用未变 → ChatPanelHost 不重跑；活跃 key 未变 → no-op），只能等 10s watchdog。修复：新增 `src/lib/session-reload-guard.ts` 的 `shouldSkipSessionReload`（taskMap 命中 + 当前视图即该会话 + agent 引用未变三条件），`performLoadSession` 据此早退，对齐 §2.2 契约。
- 改动文件：`src/lib/session-reload-guard.ts`（新增）、`src/hooks/useAgentManager.ts`（import + 7 行早退）、`tests/frontend/session-reload-guard.test.ts`（新增 4 用例）。
- 验证：vitest（session-reload-guard + agent-task-retention + open-session-from-settings）14 passed；eslint 0 problems；`tsc -b` 通过。未跑全量 test/build（小改动针对性检查）。
- 未完 / 下一步：①**未提交**；②**需重启 QuickForge 生效**，实测重复点同一 bot 应不再弹遮罩（React 批处理吞中间态为推断，见 progress Notes ②）；③候选修复 2（从别处切回 bot 会话时跳过无效 switchActiveProject）未做，低频留观察。
