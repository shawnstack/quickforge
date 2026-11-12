# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

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

