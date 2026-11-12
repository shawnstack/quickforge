# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 拆分 scheduled-tasks.mjs 上帝模块（god-module-decomposition ①）（2026-11-12 00:30）

- 需求：`server/routes/scheduled-tasks.mjs`（1120 行）同时承担 HTTP 路由、常驻调度守护循环、Agent 会话编排（executeTask 单函数约 333 行）、LLM 自然语言转任务 JSON 四类无共同主题职责。目标：routes 只留薄路由层，其余按职责拆到 server/ 根目录（与既有 `scheduled-task-runs-service.mjs` / `scheduled-runs-maintenance.mjs` 同族命名），对外 HTTP 行为与 API 契约完全不变（纯重构）。
- 拆分结果（函数体逐字迁移，只改 import 归属）：
  - `server/scheduled-task-store.mjs`（新增 354 行）— 任务记录领域规则与存取：`normalizeTaskInput`/`scheduleRuleFor`/`calculateNextRun`/`isRecurringTask`、任务 CRUD、`taskRunsService` 单例 + `persistRun`/`getTaskRuns`/`hydrateTaskRuns`、`repairRecurringTaskStatuses`；新增 `getTask`/`createTaskRecord`/`removeTaskRecord` 精确封装路由层原先直接 `readStore/atomicUpdate` 的三个调用形状。
  - `server/scheduled-task-executor.mjs`（新增 443 行）— `executeTask` 会话编排（run 记录创建/补偿、模型与 Profile 与绑定项目解析、`createAgent`+`runPrompt`、超时 `abortRun`、终态落库）+ 进程内活跃 run 追踪（`runningTaskRunIds`，executeTask 是唯一写入方，对外只读 `hasActiveTaskRuns`/`hasInFlightRuns`）+ `scheduled_task_started/notification` 事件发射。
  - `server/scheduled-task-runner.mjs`（新增 117 行）— 30s tick 调度循环、`start/stopScheduledTaskRunner`、`recoverStaleScheduledTaskRuns` 启动恢复、`configureScheduledRunsRuntimeHooks` 维护暂停钩子（模块加载时注册，注册时机语义与原先等价）。
  - `server/scheduled-task-instruction-parser.mjs`（新增 113 行）— `parseScheduledTaskInstructionWithAi` 自然语言 → cron 草稿 JSON。
  - `server/routes/scheduled-tasks.mjs` 1120 → 194 行，只导出 `handleScheduledTasksApi`。
- 接线调整：`server/index.mjs` 改为从 `./scheduled-task-runner.mjs` import 三个生命周期符号（不走 routes re-export，避免路由层背守护循环职责）；`tests/server/scheduled-tasks.execution.test.mjs`（10 处）与 `scheduled-tasks.commands.test.mjs`（3 处）的 start/stop/recover 调用改直连 runner 模块，`handleScheduledTasksApi` 的 mock req/res 直调全部不变。
- 文档同步：`docs/wiki/server/routes/README.md`（清单表 949→194 行 + scheduled-tasks 小节重写为四模块地图）、`docs/wiki/server/README.md`（核心模块新增 scheduled-task-* 小节）。
- Evidence：vitest 相关批 4 文件 127 例全绿；`npx eslint` 全部改动文件 0 problems；`npx tsc -b` 通过；`npm run build` 通过；`npm run test` 全量 524 文件 5797 通过 + 2 跳过、0 失败。
- Notes：①未 commit（用户未要求提交）；②feature_list.json 只更新本 feature 条目的 updatedAt 与 summary 追记，其余条目未动；③`docs/design/bot-mascot/self-review-board.html` 为既有未跟踪文件，未触碰；④旧 handoff 曾建议「routes re-export 4 个导出保契约」，本轮未采用——改为 index.mjs 与测试直连 runner：HTTP 契约不变、分层更诚实，测试改动机械可控；⑤期间一次中间失败（commands.test 里 `const runner` 声明在 try 块内导致 finally 作用域 ReferenceError + EBUSY 残留临时目录），已修复并清理，最终全绿。

