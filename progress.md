# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 切断 src/lib/types.ts ↔ server-agent 运行时循环依赖（2026-11-12 14:24）

- 环结构：`types.ts` 第 2 行从 `@/lib/server-agent` 门面 import type `ServerAgent` / `ServerAgentContextCompaction`；反向 `server-agent/` 下 7 条 import 语句从 `@/lib/types` 取 `agentAccessModeFromYoloMode` / `normalizeAgentAccessMode` / `agentAccessModeToYoloMode` 与 `AgentAccessMode`，构成运行时环（types → 门面 → agent.ts → types）。
- 落点：新增零依赖模块 `src/lib/agent-access-mode.ts`（17 行），把 `AgentAccessMode` 类型与三个纯函数原样搬入（签名、实现、顺序一字未改）；`types.ts` 保留 `export type { AgentAccessMode } from './agent-access-mode'` + 同名 value re-export，对外导出面不变（20 个环外消费方零改动），并把第 2 行拆成 `import type { ServerAgent } from '@/lib/server-agent/agent'` 与 `import type { ServerAgentContextCompaction } from '@/lib/server-agent-types'`（均 type-only，编译期擦除）。
- 改 import 的 7 处：`server-agent-types.ts:3`、`server-agent/agent.ts:3-4`、`core.ts:3`、`factories.ts:3`、`snapshot.ts:2`、`sse-state-frame.ts:2`、`state-sync.ts:2` 全部改指 `@/lib/agent-access-mode`；这批语句没有混入其它 types 符号，故无需拆句。环外文件（useAgentManager / deferred-session-agent / pi-chat / App.tsx 等）一律未动。
- 验证：`npm run test` 526 文件 5810 passed / 2 skipped 全绿；`npx tsc -b` 通过；`npm run build` 通过（tsc + vite + precompress，225 文件）；`npx eslint src/lib/agent-access-mode.ts src/lib/types.ts src/lib/server-agent-types.ts src/lib/server-agent` 0 problems。
- 环证据自查：`src/lib/types.ts` 中 `@/lib/server-agent'` 门面路径 0 处（`types.ts` 116 → 102 行）；`src/lib/server-agent/` 目录内 `@/lib/types` 0 处。
- Notes：①改动留工作区**未 commit**（未 push、未建分支、未跑 git add）；②`docs/wiki/src/lib/README.md` 模块表已补 `agent-access-mode.ts` 行并更新 `types.ts` 行与章节；③归档脚本本轮未跑（progress/handoff 另有多轮历史段落与并行会话上下文，避免误归档）；④表内既有漂移顺带修正 1 处：`server-agent-types.ts` 记 266 行、实际 308 行（本轮只改其第 3 行 import 路径，行数未变）。

## 上帝模块治理⑦：src/App.tsx 按职责拆分（2026-11-12 12:06）

- 动手前先摸清测试面：explore 调研确认 23 个前端测试直接读 `src/App.tsx` 源码文本断言（含 indexOf/slice 锚点与多行缩进断言）；其中 openLocalFilePathFromChat / openArtifactPreview 无源码断言可自由迁移，其余块迁移时同步把断言改指新模块（语义不变、负向断言双保留防回流）。动手前基线全量 526 文件 5810 passed / 2 skipped 全绿。
- 拆分落点（每块迁完跑相关测试再拆下一块）：`src/lib/agent-event-guards.ts`（agent 事件类型守卫）、`src/hooks/useAgentSessionEvents.ts`（agent 事件→会话列表联动/Toast/系统通知）、`useChatFileOpener.ts`（openLocalFilePathFromChat：临时附件 fetch + 工作区 resolve + 项目/序号/scope 三重迟到守卫）、`useDeletedProjectRecovery.ts`（已删项目恢复策略执行，判据仍来自 lib/deleted-project-recovery 纯函数）、`useArtifactPreviewActions.ts`（产物预览统一入口 + live 自动预览 + 文件卡三动作 + 预览桥接）、`useAppEventBridges.ts`（view-command-log / background-tasks / goal-summary / subagent / workflow 五个窗口事件桥 + agent-browser 自动切换）、`useBotWorkspace.ts`（bot 列表/增删改/排序/催醒/模式切换补偿/吉祥物派生，约 215 行）、`useSideChatPanel.ts`（侧聊宿主）、`useNewChatEmptyState.ts`（空态判定 + taskLauncher 世代号 + startNew* 路由）；子组件 `src/components/app/WindowToolbar.tsx`（顶栏工具条约 226 行，纯装配+回调转发）与 `StartupErrorScreen.tsx`。
- 结果：App.tsx 2334 → 1585 行（MainApp 约 2120 → 约 1520），留状态声明 + hooks 装配 + JSX 装配；被测试钉死的接线（两处 ChatSidebar、ChatPanelHost/WorkspaceInspector 传参、chatCapabilities 判定）刻意留装配层。逐字搬移 + 装配接线，对外行为与 UI 完全不变。
- 测试同步：15 个测试文件断言改指新模块（bot-project-scope、git-tools-pinned-summary、auto-preview-fresh-present、assistant-artifact-card、workspace-inspector-tabs、agent-browser-panel-contract、background-tasks-tab、workflow-renderer、bot-mascot、bot-mascot-composer-toggle、bot-reorder-rename、side-chat-workspace-tab、sidebar-new-chat-routing、new-chat-empty-state-requires-session、mobile-fullscreen-adaptation）。
- 验证：`npm run test` 全量 526 文件 5810 passed / 2 skipped；`npx tsc -b` 通过；`npm run build` 通过（tsc + vite + precompress）；npx eslint 全部改动文件（11 个源文件 + 16 个测试文件）0 problems。
- Notes：①与 server-agent 拆分会话并行，其改动文件（server/bots*、src/lib/server-agent* 及任务清单所列）一律未触碰；②feature_list.json 未动（主助手统一注记）；③`docs/wiki/src/lib/README.md` 的改动来自并行会话，本轮未碰。

## 上帝模块治理⑥：src/lib/server-agent.ts 按职责拆分（2026-11-12 11:35）

- 动手前先锁面：grep 全部消费方共 21 个 import 点（App.tsx、ChatPanelHost、panel-wiring/surface 族、hooks 族、shared/deferred-session-agent、types.ts + 12 个测试文件），导出面 = `ServerAgent` + `fetchActiveAgentStatuses` + 5 个 SSE 单例 re-export + 19 个类型 re-export；测试另有三类硬触点须保留在类上：`(agent as any).handleSseEvent(...)`（history-convergence/rollback-adoption）、`(agent as any).refreshStateFromServer()`/`.stateVersion`（server-agent.test）、`ServerAgent['emitToListeners']` 索引类型（events.typecheck）；file-rollback-api 用 `Object.create(ServerAgent.prototype)` 无构造函数实例直调轮级回滚方法。
- 拆分落点（`src/lib/server-agent/` 目录，24 文件 + 46 行门面 server-agent.ts，与 panel-decoration.ts+目录同款仓库惯例）：`core.ts`（`ServerAgentState` 状态形状 + `ServerAgentCore` 内部协作面——类构造时以闭包构建一次，模块经 core 读写私有状态，不复制实现；类是成员唯一实现来源）、`agent.ts`（类本体 ~940 行：27 字段状态机/构造/buildCore/订阅/租约薄门面/prompt·steer·continue 等委托/applyLog/watchdog/私有 handleSseEvent 转发/静态工厂经 `factoryHooks` 回接私有坐标落地）、HTTP 动作族 `prompt-actions.ts`（prompt/retryFailedPrompt/abort/steer/followUp/continue + stash 原子消费 `consumePromptStash` 留类）、`approval-actions.ts`、`goal-actions.ts`（updateGoal/refreshGoalForSave）、`rollback-actions.ts`（会话回滚/轮级预检执行/guards；轮级两方法走轻量 `AgentHttpTarget`，保住原型实例兼容）；状态同步族 `state-sync.ts`（/state·/status 执行体，去重包装留类）；历史族 `messages-channel.ts`（分页拉取）+ `history-reconcile.ts`（拉尾对账+退避重试、hydrate/ensureFullHistory）；事件族 `sse-dispatch.ts`（26 case 分发，契约：handler 返回 `true`=原 `break` 由分发层转发、`false`=原 `return` 族内自管转发）+ 8 个按事件族拆的 handler 模块（state 帧、运行生命周期、消息收敛、工具执行、审批与 ask、goal、压缩通知、会话杂项）；`goal-iteration-markers.ts`、`snapshot.ts`、`factories.ts`、`errors.ts`、`runtime-status.ts`。
- 关键决策：①TS 无 partial class，采用「类持有状态 + 模块函数吃 `ServerAgentCore` 闭包上下文」的仓库既有协作者模式（SessionLeaseController/GoalStateController 同款），私有成员不改 public、导出类型面零变化；②逐字搬移，仅 `this.`→`core.`（或 `target.`）机械替换，控制流（switch 的 break/return 语义、异步 .finally 里的转发时序）逐 case 对照保留；③factories 经注入 `{create, applyCoordinates}` 钩子把「实例化与私有坐标落地」留在类上，避免 runtime 循环依赖（目录内唯一跨引用 factories→agent 为 type-only）；④6 个读 server-agent.ts 源码文本断言的测试（goal-card/ask-user-card/assistant-artifact-card/chat-surface-behavior-alignment/deferred-handoff-contract）改指新模块，断言语义不变（同⑤轮 system-prompt 测试先例）。
- 验证：拆分前基线 18 文件 411 用例绿；拆分后同集合 411 绿；`npm run test` 全量 526 文件 5810 passed / 2 skipped 绿（首轮 1 个服务端 SQLite CAS 竞速用例在满负载下抖动失败，单跑与全量重跑均绿，与前端改动无关）；`npx tsc -b` 通过；`npm run build` 通过；改动文件 eslint 0 problems（修掉 buildCore 的 no-this-alias）。改动留工作区未 commit；并行会话文件（bots/docs/i18n/useAgentManager 等）一律未触碰。
- Notes：①`docs/wiki/src/lib/README.md` 模块表与三处文件指称已同步（docs/wiki/README.md 为并行会话脏文件未动）；②feature_list.json ⑥ 已标完成，⑦ src/App.tsx 未动；③归档脚本本轮未跑（progress/handoff 有并行会话段落，避免误归档）；④全量 test 后并行会话又动了 App.tsx（-290 行 bot 心跳清理）一度使 `npm run build` 的 tsc 段在其文件上报错，未干预，其稳定后 03:44 完整 build 通过（报错文件无一属于本轮改动）。

## 上帝模块治理⑤：agent-manager.mjs 按职责拆分（2026-11-12 10:40）

- 动手前先锁契约：`tests/server/agent-manager-exports-contract.test.mjs` 锁定 49 公开导出 + 5 内部共享导出共 54 名，导出面必须精确相等；排查出 3 个读 agent-manager.mjs 源码文本的测试，其中 2 个正向断言（system-prompt.test.mjs 的 beforeToolCall 行、context-references 的 createServerTools options 块）随 createAgent 迁移改指 `server/agent-session-lifecycle.mjs`（断言语义不变），1 个反向断言（session-index-lifecycle 的 not.toContain）不受影响。
- 拆分落点（每块迁完跑相关测试再拆下一块）：`agent-turn-ids.mjs`（sessionTurnIds+begin/end/clear）、`goal/engine.mjs` 增补 `activeGoalStatus` 共享助手、`agent-tool-assembly.mjs`（createServerTools/attachTurnIdGetter/rebuildSessionTools/appendGoalTools/工具包装）、`agent-context-transform.mjs`（transformSessionContext）、`agent-idle-recycler.mjs`（resetIdleTimer/touchSession）、`agent-run-events.mjs`（agent.subscribe 事件扇出+落库、afterGoalRunPersisted、标题调度）、`agent-background-commands.mjs`（后台命令通知投递）、`agent-session-lifecycle.mjs`（createAgent 509 行/restore/sync/destroy/listSessions/shutdown/resetStaleTaskStatuses/模型绑定与记忆刷新）、`agent-rollback.mjs`、`agent-run-orchestration.mjs`、`agent-session-updaters.mjs`；`agent-manager.mjs` 定形 133 行薄 facade（契约 re-export + `createSessionQueries` 唯一实例 + `configureGoalRunner` 注入接线 + agentEvents.setMaxListeners）。
- 关键决策：①不往 facade 增加任何新导出（契约测试断言精确集合），后台命令投递独立成模块以避免循环经门面取未导出符号；②跨模块互调全部函数级引用（ESM 函数声明提升），与既有 agent-compaction↔agent-manager 循环同模式；③查询工厂 getSessionState 等单例留在组合根，rollback/updaters 经 facade 取同一实例避免第二份闭包状态。
- 验证：每块相关测试绿（agent-manager 专项 12 文件 100 用例）；`npm run test` 全量、`npx tsc -b`、`npm run build` 绿（详见 handoff）。改动留工作区未 commit；并行会话文件（bots 相关等）一律未触碰。
- Notes：①`docs/wiki/server/README.md` agent-manager 章节已同步新模块布局（docs/wiki/README.md 当时为并行会话脏文件，未动）；②本轮与 bots 会话并行，progress/handoff 均只追加本段。

## 修复：重复点击同一 bot 对话触发「正在加载中」并卡 10 秒（2026-11-12 10:35）

- 现象：重复点同一个 bot 的对话会弹「正在加载对话」且停约 10s；切换不同 bot 反而几百 ms。
- 根因（explore 调研，代码逐行核实）：`performLoadSession`（useAgentManager.ts）对「同会话重复点击」并非空操作——①bot 会话是 project scope，但 bot 项目永远写不进 activeProject（useProject.ts 的约束），导致每次都 `await switchActiveProject` 网络往返且恒为无效写；②这次 await 让 `loadingSessionId` 中间态跨渲染周期，兜底通道挂出遮罩；③撤遮罩的就绪信号因 agent 引用未变（ChatPanelHost 主 effect 只在 agent 变化时重跑）与活跃 key 未变（同 key no-op）无人发布，只能等 10s watchdog。切换不同 bot 时 taskMap 必 miss（空闲零驻留）→ 走 `/view?tail=200` 快路径产生新 agent 引用 → ready 正常发出，所以快。违反 session-open-fast-path §2.2「同会话重复点击：不显示遮罩、不重复加载」契约。
- 修复（方向 1，用户选定）：新增 `src/lib/session-reload-guard.ts` 纯函数 `shouldSkipSessionReload`（三条件：taskMap 命中 + 该会话就是当前视图 + 视图 agent 引用未变），`performLoadSession` 在 taskMap 命中分支前据此早退，与 `beginSessionTransition` 的遮罩短路语义对齐。普通/全局会话与「真正切换」路径不受影响（条件不满足即走原逻辑）。
- 改动文件：`src/lib/session-reload-guard.ts`（新增）、`src/hooks/useAgentManager.ts`（+7 行）、`tests/frontend/session-reload-guard.test.ts`（新增 4 用例）。
- 验证：vitest 新测试 + agent-task-retention + open-session-from-settings 14 passed；eslint 0 problems；`tsc -b` 通过。未跑全量（小改动走针对性检查）。
- Notes：①修复候选 2 未做——「从别处切回 bot 会话」（taskMap 命中但视图不同）仍会多一次恒为无效的 switchActiveProject 往返，属低频路径，留观察；②React 批处理吞掉同步置位/清除是推断（explore 已标注），实测需重启 QuickForge 后重复点 bot 验证；③未 commit。

