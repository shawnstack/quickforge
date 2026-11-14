# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：Dreaming 采集分层配额（2026-11-14 01:30）

- 目标：让 bot / 定时任务会话不再稀释用户的 dreaming 采集预算。
- 改动文件：`server/dreaming/collect.mjs`（selectSessions 拆两查询 + bot 字数上限 1/5 + 新导出 `MAX_BOT_SESSIONS` / `MAX_BOT_CHAR_RATIO` / `isBotSession`）、`tests/server/dreaming.test.mjs`（+4 例）。
- 验证：dreaming 定向 14/14；`npm run test` 550 文件 6176 passed / 2 skipped；`npx tsc -b` 净；`npx eslint .` 净。
- Blocker：无。未 commit 未 push（用户要求留在工作区）。
- 下一步：若确认效果，可将 `MAX_BOT_SESSIONS` / `MAX_BOT_CHAR_RATIO` 提为可配置项；仍在等的 `bot-memory-writes-global`（P0）未动。

