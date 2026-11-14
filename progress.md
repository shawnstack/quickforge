# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## Dreaming 会话采集分层配额（2026-11-14 01:30）

- 问题：`collect.mjs` 的 `selectSessions` 是单条 updated_at 倒序查询，bot-/scheduled- 会话每 15 分钟刷新自身时间戳，实测最近 12 个会话里 10 个是 bot/定时任务空转轮，10 万字符预算被稀释。
- 改法：拆成两次查询 —— 用户会话（`session_id GLOB` 排除 `bot-*` / `scheduled-*`）拿满 `maxSessions` 主份额；bot/task 会话独立查询 `LIMIT 2`；`collectTranscript` 再给 bot 会话叠加 `maxTotalChars * 20%` 的字数上限（超出即跳过，不借用用户预算）；corrections-first 排序与总预算截断逻辑保持原样。新增导出 `MAX_BOT_SESSIONS` / `MAX_BOT_CHAR_RATIO` / `isBotSession`。
- 验证：`tests/server/dreaming.test.mjs` 14/14（新增 4 例：bot 不抢占会话窗口、无 bot 时整窗归用户、curator 采集同上限、bot 字数上限 1/5）；`npm run test` 550 文件 6176 passed / 2 skipped；`npx tsc -b` 净；`npx eslint .` 净。
- Notes：未 commit；只改 `server/dreaming/collect.mjs` + `tests/server/dreaming.test.mjs`。用 GLOB 而非 LIKE，因为 LIKE 对 ASCII 大小写不敏感、会与 JS 侧 `isBotSession` 的判定不一致。现役 curator 路径 `collectSessionEntries` 共用同一查询，因此同样只取 2 个 bot 会话（预期行为）。wiki 无 dreaming 采集查询的细节描述，故未改文档。

