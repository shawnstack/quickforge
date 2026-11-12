# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：拆分 scheduled-tasks.mjs 上帝模块（god-module-decomposition ①）（2026-11-12 00:30）

- 目标：把 1120 行四合一的 `server/routes/scheduled-tasks.mjs` 拆成薄路由 + 四个职责模块，HTTP 行为与 API 契约完全不变（纯重构），全量验证全绿。
- 改动：新增 `server/scheduled-task-store.mjs`（354 行）/ `scheduled-task-executor.mjs`（443 行）/ `scheduled-task-runner.mjs`（117 行）/ `scheduled-task-instruction-parser.mjs`（113 行）；`server/routes/scheduled-tasks.mjs` 缩为薄路由（194 行，只导出 `handleScheduledTasksApi`）；`server/index.mjs` 的 import 拆两行（生命周期符号改自 `./scheduled-task-runner.mjs`）；`tests/server/scheduled-tasks.execution.test.mjs`、`scheduled-tasks.commands.test.mjs` 的 start/stop/recover 调用改直连 runner 模块；`docs/wiki/server/routes/README.md`、`docs/wiki/server/README.md` 同步；feature_list.json 仅更新本 feature 的 updatedAt 与 summary 追记。未 commit（用户未要求）。
- 验证：vitest 相关批 4 文件 127 例全绿；npx eslint 改动文件 0 problems；npx tsc -b 通过；npm run build 通过；npm run test 全量 524 文件 5797 passed + 2 skipped、0 失败。
- 未完 / 下一步：①god-module-decomposition 剩 ②-⑦（下一项建议 `src/components/skills-dialog.tsx`，注意其组件内数据层抽离）；②本改动未 commit，需要提交时先跑 `node scripts/archive-harness.mjs`；③服务端改动需重启 QuickForge 才生效（重启会杀掉所有在跑会话，先排 [自约] 班）；④工作区还有一个既有未跟踪文件 `docs/design/bot-mascot/self-review-board.html`，不属于本轮、不要动。
