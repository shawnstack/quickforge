# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## goal 轮次结算「派发前窗口」真机可达性核查（2026-11-15 01:48）

- 起因：`b857fb6d` 修 flaky 时留下的产品侧疑点——`beginGoalRun` 之后、`agent.prompt` 之前夹着 `await refreshRuntime`（`server/goal-run-orchestration.mjs`:287），若结算落在这个窗口，`markGoalIteration` 找不到锚点，goal 仍可能落成 completed 而 durable iteration marker 缺失。
- 结论：**真机不可达**。真实 pi-agent-core 只在 run 活着时投递 `agent_end`（`dist/agent.js`:402-405 无 activeRun 直接抛 `Agent listener invoked outside active run`），且所有监听器 settle 之后 `finishRun` 才置 `isStreaming=false`（`:334-336`、`:355-360`）——比任务书假设的顺序正好相反；`afterGoalRunPersisted` 又先 `await session.activePromptPromise`（`server/agent-run-events.mjs`:40-47），于是「结算 → 下一轮」是同一条异步链，窗口内没有任何触发者。
- 未改产品代码（按「两头别都做」只出证据链）。回执：`~/.quickforge/bots/bot-b9c0e755/.bot/inbox-from-agents/goal-run-race.md`。
- 验证：`npx vitest run tests/server/agent-goal-manager.test.mjs` 13/13 绿；另用真实 `pi-agent-core` 跑了一个事件顺序探针（`agent_end` 时 `isStreaming=true`/`activeRun=true`，prompt 落定时才 false/undefined），原始输出见回执 §2.1。
- Notes：① 测试能构造出这个窗口，是因为 `tests/server/agent-goal-manager.test.mjs`:6-48 的 MockAgent 把顺序反了（L37 先置 `isStreaming=false`，L38 再 `emit('agent_end')`），建议按回执 §2.5 改那段注释（本轮未改文件）；② 顺带发现（未修、未扩大范围）：`cancelGoal`（`server/goal-actions.mjs`:204-239）不检查 quiescence，若用户正好在这一轮卡在 `:287` 时取消，`goalRun` 被清空后 `startGoalRun` 仍会 `agent.prompt`，出现「已取消但这一轮照跑」且该轮无 marker；③ 工作区仍有用户在途的前端改动（工作台屏保等），本轮未触碰。

## bot 会话 /clear 后标题被抹成默认标题（2026-11-15 00:22）

- 问题：bot 会话的标题是它唯一的身份（建会话时 `title = bot.name`，改名由 `PATCH /api/bots/:id` 同步），但 `clearSession()`（`server/agent-compaction.mjs`）无条件把 `title` 复位成 `'New chat'`、`titleSource` 复位成 `'default'`。后果：清空后下一条心跳指令被当成标题生成出来，侧栏上那个 bot 的名字变成指令原文。
- 改法：① `server/bots.mjs` 新增 `BOT_SESSION_ID_PREFIX` / `isBotOwnedSessionId()`（会话侧不存 bot 字段，`bot-` 前缀是唯一标识）与 `findBotBySessionId()`（按 `sessionId` 反查，`heartbeat.lastSessionId` 兜底）；② `clearSession()` 分支处理——bot 会话把标题写回 bot 名、`titleSource` 保持 `manual`（顺带修掉存量被复位过的标题），查不到记录时保留现有标题且不影响清空；普通会话照旧复位；两条路都继续自增 `titleGenerationId` 作废在途生成；③ `bot-session.mjs` 生成 id 改用同一前缀常量。
- 文档：`docs/wiki/server/bots.md` 新增 §7.3（判据、例外理由、查不到记录时的降级）与 §8 测试清单。
- 验证：定向 4 文件（agent-compaction / bots / module-cycles / scheduled-tasks.commands）80/80；全量 `npm run test` 6212 passed / 2 skipped / 1 failed（`routes/workspace-search-ripgrep` 的「客户端中途断开」用例，单跑 3/3 通过，属子进程时序 flaky，与本次改动无关）；改动文件 eslint 净；`npm run check:wiki` 无新增漂移（仍是那 6 条前端既有漂移）。
- Notes：① 事故与善后：新测试第一版直接调 `saveBotRecord` 落盘，而 `dataDir` 在 import 时定死，测试进程里就是真实 `~/.quickforge`，于是往用户 bots.json 塞了 4 条假记录（名字「质检bot」、sessionId `bot-9f3c1a2b-…` / `bot-new-0000`）；已备份（`~/.quickforge/_backups/bots-json-before-test-cleanup-*.json`）并按 id 只删这 4 条，现存 6 个真 bot（主助手/答疑bot/小跟班/质检bot/文档bot/UIbot）未动，测试改成 mock `storage.mjs` 的 `readStore`，不再碰真实存储；② `scheduled-*` 会话仍按普通会话复位标题（一次性任务，无身份语义）；③ 同一工作区本轮还有其它在途改动（工作台屏保、bot 侧栏时间），本轮只碰 `/clear` 标题相关的 4 个文件 + wiki；④ 未 commit。

