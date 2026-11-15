# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：bot 会话的记忆写入不再打到用户总记忆（2026-11-16 01:20）

- 目标：修 P0——`manage_global_memory` 固定写全局 `MEMORY.md`，而 bot 会话的系统提示注入的是**它自己工作区**的 `MEMORY.md`；bot 每次心跳把自己那份原样写回，落到用户总记忆（2026-11-13 已发生 4 个 bot / 37 次写入）。
- 改动文件：`server/tools/global-memory.mjs`（handler 收 `context` + 新增 `resolveBotWorkspaceRoot()`，判不出目标就抛错、不回退）、`server/global-memory.mjs`（新增 `writeWorkspaceMemory()`，与全局那份共用校验 / 写锁 / 原子写）、`server/tools/definitions.mjs`（工具描述不再对 bot 会话承诺 "global"）、`tests/server/bot-memory-scope.test.mjs`（新增 4 例）、`tests/server/tools/definitions.test.mjs`（描述反向断言）、`docs/wiki/server/README.md` + `docs/wiki/server/tools/README.md`（落点说明 / 行数 11→74）、`progress.md`、`feature_list.json`、`session-handoff.md`。
- 验证：把两个 server 文件回滚到 HEAD 后独立重跑，3 例红（第一条红在「全局文件被写了」`expected(true).toBe(false)`，不是文案），恢复后 4 例绿；全量 582 文件 / 6374 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净、`check:wiki` `matched=399 resolved=399 bad=0`。
- Blocker：无。已本地 commit，未 push（用户未明说）。
- 需知会：① 运行实例仍是 2026-11-15 01:06 启动的旧代码，重启之后 bot 才真正写到自己的工作区；② 行为变化——项目记录已被删、会话还在的**普通**项目会话，现在抛 `Bot memory file is unavailable for this session.` 而不是写全局（安全侧取舍）。
- 下一步：重启窗口由用户定；重启后拿一个真 bot 心跳验一次，回执里的 `details.path` 应为 `bot workspace MEMORY.md`，且 `~/.quickforge/memory/MEMORY.md` 的 mtime 不变。

