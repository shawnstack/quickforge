# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：bot 会话 /clear 不再把标题抹成默认标题（2026-11-15 00:22）

- 目标：修 bug——bot 会话跑 `/clear` 后标题被复位成 `'New chat'`，随后心跳指令被当成标题生成，侧栏上 bot 名字变成指令原文。
- 改动文件：`server/bots.mjs`（新增 `BOT_SESSION_ID_PREFIX` / `isBotOwnedSessionId()` / `findBotBySessionId()`）、`server/agent-compaction.mjs`（`clearSession()` 按 `bot-` 前缀分支：bot 会话写回 bot 名、`titleSource` 留 `manual`，查不到记录则保留现有标题；两条路都自增 `titleGenerationId`）、`server/bot-session.mjs`（id 生成复用前缀常量）、`tests/server/agent-compaction.test.mjs`（3 个 clear 标题用例）、`tests/server/bots.test.mjs`（前缀判定 + `findBotBySessionId` 4 个用例）、`docs/wiki/server/bots.md`（新增 §7.3 + §8 清单）、`progress.md`、`session-handoff.md`。
- 验证：定向 4 文件（agent-compaction / bots / module-cycles / scheduled-tasks.commands）80/80；全量 `npm run test` 6212 passed / 1 flaky（`workspace-search-ripgrep` 断连用例，单跑通过）；改动文件 eslint 净；`npm run check:wiki` 无新增漂移。
- Blocker：无。未 commit 未 push（用户未要求）。
- 需知会：新测试第一版把假 bot 记录写进了真实 `~/.quickforge` 的 bots.json（4 条「质检bot」假记录），已备份到 `~/.quickforge/_backups/bots-json-before-test-cleanup-2026-11-14T16-30-30-880Z.json` 并按 id 精确删除，现存 6 个真 bot 未动；测试已改为 mock `storage.mjs`，不会再落盘。
- 下一步：存量被抹成默认标题的 bot 会话，跑一次 `/clear` 就会把标题修回（也可以靠改名同步）；不跑任何命令就批量回填，需要另加一个按 bot 名回填会话标题的迁移。

