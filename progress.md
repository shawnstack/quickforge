# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## bot 会话的 `manage_global_memory` 落到它自己工作区的 MEMORY.md（2026-11-16 01:20）

- 问题：`manage_global_memory` 不认会话，固定写 `~/.quickforge/memory/MEMORY.md`；可 bot 会话的系统提示注入的是**它自己工作区根上的** `MEMORY.md`（`buildInstructionsPayload()` 对 `kind === 'bot'` 用它顶掉全局记忆块）。于是 bot 每次心跳把读到的那份记忆原样写回，落点却是用户的全局记忆——2026-11-13 已造成 4 个 bot / 37 次写入、用户 425 字原文被覆盖。
- 改法：`server/tools/global-memory.mjs` 的 handler 收 `context`（`wrapToolDefinition` 本来就把同一份 toolContext 交给所有 handler，四个 `createServerTools` 调用点都已带 `sessionId` / `scope`），新增 `resolveBotWorkspaceRoot(context)`：`scope !== 'project'` 直接判非 bot；`project.kind` 缺失才按 `projectId` 查一次项目记录；只有 `kind === 'bot'` 才返回工作区根（`context.workspaceRoot` 优先，退回项目登记的 `path`）。`server/global-memory.mjs` 新增 `writeWorkspaceMemory()`：与全局那份共用 `validateGlobalMemoryMarkdown` + `withMemoryWriteLock` + 临时文件 rename 原子写，**只换目标文件**。
- 判据：**没有「按 workspacePath 猜」的分支，也没有任何回退**。判不出目标就抛 `Bot memory file is unavailable for this session.`（`errorCode: BOT_MEMORY_UNAVAILABLE`），因为悄悄退回写全局正是这个 bug 本身。`enabled` 开关沿用全局记忆设置（工具注册本来就挂在同一个开关上，另开一个 bot 专用项只会造出「设置里关了、agent 还能写」的半开状态）。
- 顺带改的文案：`server/tools/definitions.mjs` 的工具描述原写 "Replace the complete global MEMORY.md shared by all chats"，对 bot 会话是假的；改为 "the MEMORY.md this session owns — the global user memory, or the workspace copy that belongs to a bot"，并在 `tests/server/tools/definitions.test.mjs` 加反向断言（不得再出现 "global MEMORY.md shared by all chats"）。
- 测试：新增 `tests/server/bot-memory-scope.test.mjs`（4 例，`mkdtemp` 临时 data 目录 + 临时工作区，不碰真实 `~/.quickforge`）：bot 写自己那份且**全局文件一个字都不动（内容 + mtime + size）**、普通项目会话照旧写全局、bot 拿不到工作区根要抛错、项目记录已删要抛错。
- 验证：**先证会红**——主助手把两个 server 文件回滚到 HEAD 后独立重跑，3 例红、第一条红在 `expected(true).toBe(false)`（即「全局文件被写了」，而不是返回值文案），恢复后 4 例绿。全量 582 文件 / 6374 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净、`check:wiki` `matched=399 resolved=399 bad=0`。
- 已知行为变化：项目记录被删、会话还在的**普通**项目会话，以前写全局，现在抛 `Bot memory file is unavailable for this session.`。这是「绝不悄悄退回写全局」的代价——判错一次就是用户的记忆被整篇覆盖。
- 回执：`~/.quickforge/bots/bot-b9c0e755/.bot/inbox-from-agents/bot-memory-scope.md`（子会话实现，主助手独立复跑红→绿）。
- Notes：改动全在 `server/**`，运行实例要重启才生效（当前实例启动于 2026-11-15 01:06，重启等用户明说）。

