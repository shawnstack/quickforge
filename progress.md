# Progress

## Current State

- Feature: fix-persistence-lock-stall（修复全局持久化锁串行链导致的请求挂起与会话滞留）
- Status: done — 按 session 分锁 + 慢 persist 观测日志 + taskkill 超时兜底已落地并通过全部 server 测试
- Blockers: 无
- Next step: 无待办 feature；发布 patch 版本前完整运行 `npm run test`、`npm run lint`、`npm run build`

## Notes

- 持久化锁修复（本轮）：`withSessionPersistenceLock` 从全局单链改为 keyed 队列（`session-persistence-lock.mjs`），默认 key（''）保持全局串行；`persistSession` 在 SQLite 权威模式下用 `session:${sessionId}` key，JSON 镜像模式保留全局 key（bucket 级 read-modify-write 需要）。正确性依据：authoritative 模式下正确性由 per-row revision CAS（`persistAuthoritativeSessionState` 的 expectedRevision + 有界重试 + storage-owned 字段合并）独立保证，全局互斥是 JSON 时代遗留（git 35bce8b 引入，当时 writeSessionValue 无 CAS）；SQLite 单连接 + DatabaseSync 同步 API + Node 单线程保证任意时刻至多一个事务执行，分锁无数据库层写冲突。收益：跨 session 的 persist/destroyAgent 不再互相排队，某 session 的大同步事务不再把其他 session 的 idle 销毁堵在全局链尾（旧模式锁卡 → destroyAgent 完不成 → agentSessions 只增不减的恶性循环解除一半）。auto-archive 仍用全局 key；其与 per-session persist 的交错由 CAS + 写前重校验（archivedAt/pinnedAt 合并）保证。锁 drain 后 Map 条目自动清理。
- 慢 persist 观测：`persistSession` 记录耗时（排队+写），≥1s 打 warn（含 messageCount），便于定位"大会话同步事务阻塞事件循环"。注意同步 SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大，单事务耗时需靠拆事务/消息 split（已有 F9 split 机制）缓解。
- `runTaskkill` 超时兜底（`server/utils/process-tree.mjs`）：taskkill.exe 挂起时 10s 后 resolve(false)，不再让 dispose()/destroyAgent 永久悬挂（Windows 上 OpenCode 子进程清理路径）。锁外低概率路径，属同一"销毁链路挂起"修复范围。
- `/api/agents/:id/restore` 挂起+内存增长根因分析：① 前端切到一个 session 时并发发 POST /restore + GET /state + GET /messages + GET /status + SSE，这些路由在内存无 session 时都隐式回落 restoreAgent，而旧实现是 check-then-act（get → await readSessionValue → await createAgent → set），并发时各自 createAgent、最后一次 set 覆盖前面的——被覆盖的 session（监听器/idleTimer/persistTimer/OpenCode 子进程）永不销毁，形成孤儿泄漏，切换越快越偶发。② 前端切 session 只 abort fetch，服务端 handler 照常建 session。③ agentSessions Map 唯一删除点是 destroyAgent（30min idle / DELETE），前端 dispose 不通知服务端。④ 全局 withSessionPersistenceLock 是无超时单链 promise 队列 + node:sqlite DatabaseSync 同步大事务，persist 积压时阻塞事件循环 → 请求挂起；destroyAgent 也走该锁，锁卡死则 idle 销毁也完不成，恶性循环。
- restore 修复（上轮）：`restoreAgent` 拆为外层去重 + `restoreAgentUnlocked`（沿用 persistSession/persistSessionUnlocked 命名模式），`pendingRestores` Map 按 sessionId 共享 in-flight Promise，finally 清理（失败不缓存 null）。所有并发调用点（路由隐式 restore、ACP、shared-conversation）收敛到模块内单个函数，无需改调用方。
- 测试教训（锁单测）：模块级队列 Map 在同一测试文件内共享——测试失败路径泄漏的 pending 链会污染后续使用相同 key 的测试（表现为下一个测试超时）；每个测试用唯一 key + gate 必须 settle + `await new Promise(r => setTimeout(r, 0))` 排空微任务（promise 链 `.catch().then()` 需两个微任务 tick，`await Promise.resolve()` 不够）。
- 未实施的后续候选（见 session-handoff）：前端 dispose 通知服务端提前回收、agentSessions 上限 LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 归档闪烁根因：`archiveSession` 归档后调 `refreshSessions({ broadcast: true })`，其“先置 loading、page-0 整体替换”的全量重置模式导致侧栏项目列表 loading 占位闪现、LoadMoreSentinel 卸载重挂、超 20 条时先缩回 20 条再逐页补回。修复：归档成功后本地乐观移除（`useSessionPagination.removeSession` + `removeSessionFromPage`），跨 tab 广播保留（其他 tab 收到广播仍走各自全量刷新，属既有行为）。
- 遗留（本次范围外，择机处理）：`ChatSidebar.confirmDeleteSession` 的 `deletingSessionId` 成功后不复位、`deleteAnimationTimeoutRef` 为共享单值 ref——360ms 内连续确认删除两个会话时第二次 `clearTimeout` 会取消第一个的归档调用，该行可能闪回；置顶区删空后整块条件卸载（无高度过渡）；设置页“已归档对话”永久删除仅 `notifySessionsChanged()` 广播，本 tab 列表不刷新。
- 分页死循环根因：删除/归档会话改变服务端列表 total 与排序窗口后，前端 offset 分页（offset = items.length）+ uniqueSessions 去重合并可能整页全重复，items.length 不增长 → hasMore 恒 true → sentinel（enabled 翻转重建 IntersectionObserver）反复触发 loadMoreGlobal 无限请求+渲染（UI 一直加载、内存暴涨）。修复：四个分页 loader 在 offset>0 且本页有数据但合并后零进展时，将 total 收敛为 items.length 终止循环；refreshSessions（offset 0）自动恢复。
- 已知取舍：若服务端确实还有更多数据但某页全为已加载项（去重误伤），hasMore 会提前置 false，需下次 refreshSessions 恢复；属方案 B 设计内行为。
- 服务器端遗留问题（本次范围外，择机处理）：`DELETE /api/storage/sessions/key/:id`（server/routes/storage.mjs:365）只删持久化，不销毁 agentSessions 内存中的会话；内存中的 agent 后续 persistSession 会把会话写回存储（“复活”）并刷新 lastModified，加剧排序窗口漂移。另外 loadMoreGlobal/loadMoreProject 无 loading 守卫（方案 A 未实施，零进展收敛已可终止循环）。
- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment（'record' 赋值后未使用），多会话前已存在，与近期改动无关。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行，避免 storage.mjs 默认 `~/.quickforge` 被测试污染。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`（全动态导入实现）。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地，新缓存需求沿用）。
- 前端分页测试技巧：tests/frontend/session-pagination-bootstrap.test.ts 的 mock React harness 中 useCallback 直接返回原函数且 useState 闭包是首次渲染快照，测 offset 分页必须直接调用 `loadGlobalSessions(offset)` / `loadProjectSessions(projectId, offset)` 显式传 offset，不能依赖 loadMore* 的闭包 state。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
