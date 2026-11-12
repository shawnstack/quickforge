# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## Bot 心跳指令模板化：自进化 + 防过拟合（2026-11-12 09:35）

- 需求（用户原话）：「我希望心跳指令也是个模板.md 在bot创建时候」「注意让ai 能够自进化 自驱动 修改自己的对应的记忆和心跳 但是注意要是通用性的 泛化性好 不要过拟化 某种场景的固定行动」。分界口诀（已答复并获认可）：每次醒来都一样的放指令、会变的放记忆；丢了会坏机制的钉服务端、丢了只是忘了的让 bot 自己记。
- 改动：①`bots.mjs` 新增 `BOT_HEARTBEAT_TEMPLATE_FILE`（`.bot/heartbeat.md`，判活扫描忽略 `.bot/` 不误触发）与 `defaultHeartbeatTemplate()`（四节引导式种子：半径/接上自己/做一件值得做的事/留痕回滚——只给判断标准，无场景化步骤）；`ensureBotWorkspace` 只在文件不存在时播种，绝不覆盖 bot 的演化。②`heartbeatInstruction` 改 async 三段拼装：固定头（处境 + botPath + **自进化授权**：模板和记忆都可自己改，改完下一跳生效）+ 模板内容（缺失/空白回退种子）+ 固定尾（`[报告]` 首行、不 commit、不提问）——bot 重写模板也改不掉契约。存量 bot 无文件自动回退，行为与之前一致。
- Evidence：定向 3 files / 43 passed（bots/routes/bot-heartbeat-message）；`npx eslint` 0 problems（含修掉一处 no-useless-assignment）；`npx tsc -b` 通过；`npm run build` 通过；全量 `npm run test` 后台运行中（完成后如失败将跟进）。
- Notes：①`.bot/heartbeat.md` 与 MEMORY.md 现在同为 bot 自我演化对象，一个管「怎么干活」一个管「我是谁」；②并行会话在做 god-module 治理（③ ui-store 迁移），与本轮无文件冲突；③生效仍需重启 QuickForge。

