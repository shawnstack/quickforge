# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 上帝模块治理④：server/tools/index.mjs 按职责拆分（2026-11-12 09:53）

- 需求：god-module-decomposition 子项④：`server/tools/index.mjs`（1375 行）混杂读/搜、写改、技能资源、展示、命令执行、记忆/todo 六类职责加整套子进程管理器，拆到 `server/tools/` 独立模块，index 只留注册表/装配薄层；纯重构，对外行为、工具名、参数与返回结构完全不变。
- 改动：新增 9 模块——`file-search.mjs`（read_file+grep_files，452 行）、`file-write.mjs`（write/edit+会话锁+备份 journal，139）、`skill-resources.mjs`（69）、`present-files.mjs`（99）、`run-command.mjs`（toolRunCommand+tail 预览+命令日志，502）、`process-control.mjs`（killProcessTree+runningCommands/backgroundTasks 注册表+abort/list/stop 入口，107）、`global-memory.mjs`（12）、`todo-write.mjs`（65）、`params.mjs`（共享 clampNumber，13）；`index.mjs` 重写为 52 行薄层：`toolHandlers` 注册表 + 原公开面（15 个导出名）全量再导出，agent-manager/routes/tools/tool-wiring/agent-prompt-commands 与全部测试的 import 路径零改动。代码逐字迁移，仅三处接线调整（`runningCommands.set/delete`、`backgroundTasks.get` 改经 process-control 的 `registerRunningCommand`/`unregisterRunningCommand`/`getBackgroundTaskRecord`）；行级多重集校验：原 1375 行中仅 10 行未原样出现，全部为预期（2 行 import 合并、3 行加 export 前缀、2 行节注释升为模块头、3 行接线）。文档同步：`docs/wiki/server/tools/README.md` 文件表改 12 模块并更新 index.mjs 章节；custom-agents-design / quickforge-api-skill / skills/quickforge-api references/endpoints.md 及两处前端注释（local-workspace-tool-renderer、BackgroundTasksTabContent）里指向旧 index.mjs 的路径改指新模块。
- Evidence：定向 tools 测试 6 files / 98 passed；`npx eslint server/tools/` 0 problems；全量 `npm run test` 524 files / 5800 passed / 2 skipped / 0 failed；`npx tsc -b` 通过；`npm run build` 通过。
- Notes：①未 commit（规矩留工作区）；②package-dist/package-offline 里的旧 tools/index.mjs 是生成产物，未动；③本轮未跑 archive-harness——progress/session-handoff 里还有并行会话（Bot 心跳 09:35 段）的活内容，归档会把它挪进 docs/archive，时机留给那轮或下轮；④server 改动需重启 QuickForge 才生效；⑤用户并行的 bots/mascot 文件未触碰未还原。

## Bot 心跳指令模板化：自进化 + 防过拟合（2026-11-12 09:35）

- 需求（用户原话）：「我希望心跳指令也是个模板.md 在bot创建时候」「注意让ai 能够自进化 自驱动 修改自己的对应的记忆和心跳 但是注意要是通用性的 泛化性好 不要过拟化 某种场景的固定行动」。分界口诀（已答复并获认可）：每次醒来都一样的放指令、会变的放记忆；丢了会坏机制的钉服务端、丢了只是忘了的让 bot 自己记。
- 改动：①`bots.mjs` 新增 `BOT_HEARTBEAT_TEMPLATE_FILE`（`.bot/heartbeat.md`，判活扫描忽略 `.bot/` 不误触发）与 `defaultHeartbeatTemplate()`（四节引导式种子：半径/接上自己/做一件值得做的事/留痕回滚——只给判断标准，无场景化步骤）；`ensureBotWorkspace` 只在文件不存在时播种，绝不覆盖 bot 的演化。②`heartbeatInstruction` 改 async 三段拼装：固定头（处境 + botPath + **自进化授权**：模板和记忆都可自己改，改完下一跳生效）+ 模板内容（缺失/空白回退种子）+ 固定尾（`[报告]` 首行、不 commit、不提问）——bot 重写模板也改不掉契约。存量 bot 无文件自动回退，行为与之前一致。
- Evidence：定向 3 files / 43 passed（bots/routes/bot-heartbeat-message）；`npx eslint` 0 problems（含修掉一处 no-useless-assignment）；`npx tsc -b` 通过；`npm run build` 通过；全量 `npm run test` 524 files / 5799 passed、2 skipped、0 failed（含并行会话 god-module 治理的新测试）。
- Notes：①`.bot/heartbeat.md` 与 MEMORY.md 现在同为 bot 自我演化对象，一个管「怎么干活」一个管「我是谁」；②并行会话在做 god-module 治理（③ ui-store 迁移），与本轮无文件冲突；③生效仍需重启 QuickForge；④追加（同日）：用户问「存量的也会有对吧」——补上存量回填：`runBotHeartbeat` 开头幂等调 `ensureBotWorkspace`，存量 bot 下一次被扫到（≤30s 或催醒）即补 `.bot/heartbeat.md`，已有记忆/已演化模板不碰；新增 legacy 回填测试（有 MEMORY.md 无模板 → 补模板不动记忆），定向 37 passed、eslint 0。

