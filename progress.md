# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 前端三处「延迟写 / 延迟发，卸载或抢占就静默丢」（2026-11-16 16:40）

- 问题：把「用户输入 → 持久层」或「用户点击 → 请求」放进定时器，中间就多出一个窗口；窗口里卸载、切 tab、切项目、连点，动作就静默消失（没有报错、没有提示，界面还显示已保存）。扫了 `src` 里 163 处 `setTimeout`，真正「延迟写持久层」的只有 5 处：三处做对（`WorkbenchScreensaverSettings` 卸载 flush、`ChatPanelHost` 草稿卸载＋视图切走双 flush、`message-queue` 的 `cleanup()` 两分支），三处是洞。
- P0 `ProjectCommandsSettingsTab.tsx`：800ms 防抖的 cleanup 只 `clearTimeout` 不 flush，而该 tab 不在 `STATE_PRESERVING_TAB_KEYS` 里（切走即真卸载），于是「填完命令目录 800ms 内切走 / 关设置」＝PUT 从未发出。改法：新增**卸载专用** flush effect（放在 `save` 定义之后，避免 use-before-define），并**删掉挂载 effect cleanup 里的 timer 清理**——React 卸载时按 effect 声明顺序正向跑 cleanup，旧的若先清 timer，后面新的 flush 会以为没有待写值而提前返回（子会话实测过：保留旧清理，新用例就是红的）。
- P1 同文件 `selectProject`：切项目前 `clearSaveTimer()` 把待写值直接扔掉。改法：有待写就先 `clearSaveTimer()` + `save()`，再切 `projectRef` / `commandDirRef`。
- P2 `ChatSidebar.tsx`：`onDeleteSession` / `onDeleteProject` 被塞进 140ms 动画定时器——140ms 内卸载不补发，且 140ms 内确认第二个会把前一个 `clearTimeout` 掉，**第一个删除请求永远发不出**。改法：请求在确认时同步发出，定时器只负责 `setConfirmingDelete*` 复位。
- 测试（全部先证会红）：`tests/frontend/project-commands-settings-tab.test.ts` 加 2 例（卸载 flush / 切项目 flush，新增 `mountWithCleanups` 自行收集 `harness.effects` 的 cleanup——原 harness 只 push 不执行）；新建 `tests/frontend/sidebar-delete-request-flush.test.ts` 2 例（同步派发 / 连点两次都发出）。**修复前 4 例红在断言上**：`expected [] to deeply equal ['typed-then-left']`、`expected "vi.fn()" to be called 1 times, but got 0 times`。
- 验证：主助手独立复核，不看自述——把 P0 的 flush 跳过（`if (1 === 1) return`）后**只有 P0 那条红**，其余 13 条绿；把 P2 的同步调用注释掉后两条全红；两次还原后文件 sha1 与备份一致、无探针残留。全量 585 文件 / 6387 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净。
- Notes：`confirmDelete*` 失败分支仍只复位状态、没有用户可见错误提示（与修复前一致，未扩大范围）；同族观察保留不改：卸载时若有 save 在飞，`pendingSaveAfterCurrentRef` 会让它的 `finally` 再排一个 800ms 定时器并最终发出 PUT——修复前就有的路径，语义是「最终写出去」。判据与三对三错表在 `~/.quickforge/bots/bot-b9c0e755/.bot/decisions.md` §21。

## bot 会话的 `manage_global_memory` 落到它自己工作区的 MEMORY.md（2026-11-16 01:20）

- 问题：`manage_global_memory` 不认会话，固定写 `~/.quickforge/memory/MEMORY.md`；可 bot 会话的系统提示注入的是**它自己工作区根上的** `MEMORY.md`（`buildInstructionsPayload()` 对 `kind === 'bot'` 用它顶掉全局记忆块）。于是 bot 每次心跳把读到的那份记忆原样写回，落点却是用户的全局记忆——2026-11-13 已造成 4 个 bot / 37 次写入、用户 425 字原文被覆盖。
- 改法：`server/tools/global-memory.mjs` 的 handler 收 `context`（`wrapToolDefinition` 本来就把同一份 toolContext 交给所有 handler，四个 `createServerTools` 调用点都已带 `sessionId` / `scope`），新增 `resolveBotWorkspaceRoot(context)`：`scope !== 'project'` 直接判非 bot；`project.kind` 缺失才按 `projectId` 查一次项目记录；只有 `kind === 'bot'` 才返回工作区根（`context.workspaceRoot` 优先，退回项目登记的 `path`）。`server/global-memory.mjs` 新增 `writeWorkspaceMemory()`：与全局那份共用 `validateGlobalMemoryMarkdown` + `withMemoryWriteLock` + 临时文件 rename 原子写，**只换目标文件**。
- 判据：**没有「按 workspacePath 猜」的分支，也没有任何回退**。判不出目标就抛 `Bot memory file is unavailable for this session.`（`errorCode: BOT_MEMORY_UNAVAILABLE`），因为悄悄退回写全局正是这个 bug 本身。`enabled` 开关沿用全局记忆设置（工具注册本来就挂在同一个开关上，另开一个 bot 专用项只会造出「设置里关了、agent 还能写」的半开状态）。
- 顺带改的文案：`server/tools/definitions.mjs` 的工具描述原写 "Replace the complete global MEMORY.md shared by all chats"，对 bot 会话是假的；改为 "the MEMORY.md this session owns — the global user memory, or the workspace copy that belongs to a bot"，并在 `tests/server/tools/definitions.test.mjs` 加反向断言（不得再出现 "global MEMORY.md shared by all chats"）。
- 测试：新增 `tests/server/bot-memory-scope.test.mjs`（4 例，`mkdtemp` 临时 data 目录 + 临时工作区，不碰真实 `~/.quickforge`）：bot 写自己那份且**全局文件一个字都不动（内容 + mtime + size）**、普通项目会话照旧写全局、bot 拿不到工作区根要抛错、项目记录已删要抛错。
- 验证：**先证会红**——主助手把两个 server 文件回滚到 HEAD 后独立重跑，3 例红、第一条红在 `expected(true).toBe(false)`（即「全局文件被写了」，而不是返回值文案），恢复后 4 例绿。全量 582 文件 / 6374 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净、`check:wiki` `matched=399 resolved=399 bad=0`。
- 已知行为变化：项目记录被删、会话还在的**普通**项目会话，以前写全局，现在抛 `Bot memory file is unavailable for this session.`。这是「绝不悄悄退回写全局」的代价——判错一次就是用户的记忆被整篇覆盖。
- 回执：`~/.quickforge/bots/bot-b9c0e755/.bot/inbox-from-agents/bot-memory-scope.md`（子会话实现，主助手独立复跑红→绿）。
- 紧接着补上另一半（01:29）：落点改了、界面文案没改——`formatManageGlobalMemoryOutput` 把任何 `action:'write'` + `status:'saved'` 都渲染成「全局记忆已保存」，于是 bot 写自己那份时，界面上说的还是「你的全局记忆被保存了」。现在服务端在 `details` 里带 `target: 'global' | 'workspace'`，前端按它分流（新增 i18n 键 `memoryContentSavedWorkspace`，中英各一条）；**没有 `target` 的历史消息仍按全局文案渲染**，别把老消息的语义改掉。**先证会红**：新用例在旧格式化函数上红在 `expected '全局记忆已保存。' to be '本 bot 的记忆已保存。'`；再把服务端的 `target` 一行摘掉，两条 server 断言（`target: 'workspace'` / `'global'`）同时红，恢复后全绿。这一笔的闸门：582 文件 / 6375 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净、`check:wiki` 399/399 bad=0（改 `i18n.ts` 与 `global-memory-tool-output.ts` 招来 3 条行数漂移，当场连同说明一起改掉）。
- Notes：改动全在 `server/**`，运行实例要重启才生效（当前实例启动于 2026-11-15 01:06，重启等用户明说）。

