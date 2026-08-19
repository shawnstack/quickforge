# Progress

## Current State

- Feature: fix-startup-cutover-replay（cutover digest 排序不一致导致迁移永久失败、每次启动重放 30s~167s）
- Status: done — 源侧/仓储侧统一 canonical 全行排序 digest；成功 cutover 后 TRUNCATE WAL；回归测试 + 相关 6 文件 52 测试 + eslint 通过
- Blockers: 无
- Next step: 发布 patch 版本后，装有新代码的实例首次启动会一次性完成 cutover（预计 1-2 分钟），之后启动恢复秒级；发布前完整运行 `npm run test`、`npm run lint`、`npm run build`

## Notes

- 启动慢根因（本轮）：`session_storage_state` 卡在 `json_authoritative`（8-18 起 `Session state replace digest verification failed`），每次启动重放完整迁移（4 遍 1.6GB JSON 全量流读 + 1.4GB 备份写 + SQLite 全量导入再回滚）。排序不一致是核心 bug：JSON 源侧 summary digest 按 sessionId `localeCompare` 排序（`buildSessionJsonSnapshot`/`createStreamingSessionSource`/`writeCutoverBackupStream`），而仓储侧 `digestFromLines`/`verificationDigest` 按**整行字节序**排序。global+project 混合桶时两种排序必然交错不同（实测真实数据：`76eadc82…` vs `a40c7ee7…`），`replaceAllStream` 末尾 digest 校验必炸。现有测试数据集（global alpha/beta + project gamma）恰好两种排序同序，从未暴露。
- 修复：`digestFromLines` 从 `session-state-repository.mjs` 导出为唯一 canonical 实现，cutover 源侧三处（snapshot/streaming summary/backup writer）全部改用它；新增混合桶回归测试（global zulu + project alpha，sessionId 序与行序交叉）。附带：cutover 成功 promote 后 `PRAGMA wal_checkpoint(TRUNCATE)`（反复失败留下的 2.8GB WAL 一次性回收）。
- 事故记录（已回滚）：验证时一次 `QUICKFORGE_DATA_DIR` 未设成功的 node 脚本误在真实库执行了 cutover——digest 修复实证生效（首次成功 commit，2415 会话入库），但违反独占前提（旧服务还在 JSON 模式写数据），随后手动补救（merge 最新 2 会话 + pending promote）被用户叫停。已将 `session_storage_state` 回退为 `json_authoritative`（JSON 权威未动，quick_check ok，5176 服务存活），数据回到干预前等价状态；SQLite 残留 states/queue 条目会在下次 cutover 的 replaceAllStream 中整体清空重写，无影响。临时脚本与 %TEMP% 试验数据已清理。教训：对真实数据目录执行任何写路径前必须显式断言 dataDir 非默认值。
- 用户数据现状（择机清理，非本 feature 范围）：`conversations` 4.36GB 中 2.75GB 是 1045 个原子写 `.tmp` 残留（JSON 模式高频全量重写的副作用）；WAL 2.8GB 待新代码 cutover 成功后自动 TRUNCATE。npm 全局包（旧代码）在发布新版前仍是慢启动。
- 桌面端与 `qf` 共用 `server/index.mjs` 初始化链，同根因同修复；桌面端 `ready-to-show` 策略使首屏 6.5MB modulepreload（pi-web-ui 3.75MB + pi-ai 1.6MB）也计入可见时间（独立遗留项，未处理）。

- 字体滑块闪烁根因（本轮）：滑块 @input 每步同步调用 `applyFontSizeSettings`，直接改 html root font-size 造成整页 rem 全量 reflow，且每次无条件 dispatch `FONT_SIZE_SETTINGS_CHANGED_EVENT`（`useCodeFontMetrics` setState → Monaco re-render、TerminalPane 每步 xterm re-fit），同一帧多次叠放掉帧；拖“消息字号”时 interface 值未变也重写 root font-size。修复要点：① `scheduleFontSizePreview`（RAF 每帧合并，pending 值只保留最后一次）；② `applyFontSizeSettings` dirty-check（fontSize + `--quickforge-message-font-size` 都无变化则直接 return）；③ 事件仅 interface 字号实际变化时派发——监听方 metrics（`getCodeFontMetrics`/`getTerminalFontMetrics`）只由 interfaceFontSizePx 推导，message 变化靠 CSS 变量直接生效无需事件。@change 保存路径与 `saveFontSizeSettings` 内部同步 apply 不变，dirty-check 保证幂等。

- 归档删除根因（本轮）：设置页"已归档对话"永久删除走 pi-web-ui `SessionsStore.delete()` 的两操作事务（delete sessions + delete sessions-metadata 同 key）→ `POST /api/storage/batch`；旧 `applySessionBatch` 对 metadata delete 无条件拒绝（facade 分支 TypeError→400 整体失败零删除；JSON 回退分支 op1 已删、op2 抛 409 半成功）。修复：两分支均预扫描 fullDeleteKeys，配对的 metadata delete 视为 no-op 放行，metadata-only 仍拒绝。`useChatActions` 回滚空会话删除同路径受益。
- 删除后复活路径（本轮堵住）：storage 删除路由（batch/DELETE）此前不触碰 agentSessions，内存 agent 的 final persist（destroyAgent）或 idle persist 会把已删会话写回（且丢 archivedAt 回到活跃侧栏）。修复：路由层在删持久化前先 `destroyAgent`（其 final persist 发生在删除前，随后删除清掉）；`configureStorageSessionAgentDisposal` 注入点供测试 spy；routes/storage 已静态导入 agent-manager，无循环依赖。遗留竞态（范围外）：删除请求处理期间另一请求恰好 restore 同一 session 仍可能复活，彻底堵住需 tombstone 机制。
- 旧记录修正：设置页删除成功后本 tab 有本地过滤刷新（archived-conversations-settings-tab.ts:160），"本 tab 不刷新"仅指失败场景（batch 400 报错后列表原样保留）；UI 实际调用 batch 端点而非 `DELETE /api/storage/sessions/key/:id` 直连路由。
- 侧栏项目展开列表高度（前轮）：单条会话行高 = py-1.5(0.75rem) + leading-5(1.25rem) = 2rem，5 条 + 4×space-y-0.5(0.5rem) = 10.5rem；若后续调整行 padding/行高需同步此值。
- 持久化锁修复（本轮）：`withSessionPersistenceLock` 从全局单链改为 keyed 队列（`session-persistence-lock.mjs`），默认 key（''）保持全局串行；`persistSession` 在 SQLite 权威模式下用 `session:${sessionId}` key，JSON 镜像模式保留全局 key（bucket 级 read-modify-write 需要）。正确性依据：authoritative 模式下正确性由 per-row revision CAS（`persistAuthoritativeSessionState` 的 expectedRevision + 有界重试 + storage-owned 字段合并）独立保证，全局互斥是 JSON 时代遗留（git 35bce8b 引入，当时 writeSessionValue 无 CAS）；SQLite 单连接 + DatabaseSync 同步 API + Node 单线程保证任意时刻至多一个事务执行，分锁无数据库层写冲突。收益：跨 session 的 persist/destroyAgent 不再互相排队，某 session 的大同步事务不再把其他 session 的 idle 销毁堵在全局链尾（旧模式锁卡 → destroyAgent 完不成 → agentSessions 只增不减的恶性循环解除一半）。auto-archive 仍用全局 key；其与 per-session persist 的交错由 CAS + 写前重校验（archivedAt/pinnedAt 合并）保证。锁 drain 后 Map 条目自动清理。
- 慢 persist 观测：`persistSession` 记录耗时（排队+写），≥1s 打 warn（含 messageCount），便于定位"大会话同步事务阻塞事件循环"。注意同步 SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大，单事务耗时需靠拆事务/消息 split（已有 F9 split 机制）缓解。
- `runTaskkill` 超时兜底（`server/utils/process-tree.mjs`）：taskkill.exe 挂起时 10s 后 resolve(false)，不再让 dispose()/destroyAgent 永久悬挂（Windows 上 OpenCode 子进程清理路径）。锁外低概率路径，属同一"销毁链路挂起"修复范围。
- `/api/agents/:id/restore` 挂起+内存增长根因分析：① 前端切到一个 session 时并发发 POST /restore + GET /state + GET /messages + GET /status + SSE，这些路由在内存无 session 时都隐式回落 restoreAgent，而旧实现是 check-then-act（get → await readSessionValue → await createAgent → set），并发时各自 createAgent、最后一次 set 覆盖前面的——被覆盖的 session（监听器/idleTimer/persistTimer/OpenCode 子进程）永不销毁，形成孤儿泄漏，切换越快越偶发。② 前端切 session 只 abort fetch，服务端 handler 照常建 session。③ agentSessions Map 唯一删除点是 destroyAgent（30min idle / DELETE），前端 dispose 不通知服务端。④ 全局 withSessionPersistenceLock 是无超时单链 promise 队列 + node:sqlite DatabaseSync 同步大事务，persist 积压时阻塞事件循环 → 请求挂起；destroyAgent 也走该锁，锁卡死则 idle 销毁也完不成，恶性循环。
- restore 修复（上轮）：`restoreAgent` 拆为外层去重 + `restoreAgentUnlocked`（沿用 persistSession/persistSessionUnlocked 命名模式），`pendingRestores` Map 按 sessionId 共享 in-flight Promise，finally 清理（失败不缓存 null）。所有并发调用点（路由隐式 restore、ACP、shared-conversation）收敛到模块内单个函数，无需改调用方。
- 测试教训（锁单测）：模块级队列 Map 在同一测试文件内共享——测试失败路径泄漏的 pending 链会污染后续使用相同 key 的测试（表现为下一个测试超时）；每个测试用唯一 key + gate 必须 settle + `await new Promise(r => setTimeout(r, 0))` 排空微任务（promise 链 `.catch().then()` 需两个微任务 tick，`await Promise.resolve()` 不够）。
- 未实施的后续候选（见 session-handoff）：前端 dispose 通知服务端提前回收、agentSessions 上限 LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 归档闪烁根因：`archiveSession` 归档后调 `refreshSessions({ broadcast: true })`，其“先置 loading、page-0 整体替换”的全量重置模式导致侧栏项目列表 loading 占位闪现、LoadMoreSentinel 卸载重挂、超 20 条时先缩回 20 条再逐页补回。修复：归档成功后本地乐观移除（`useSessionPagination.removeSession` + `removeSessionFromPage`），跨 tab 广播保留（其他 tab 收到广播仍走各自全量刷新，属既有行为）。
- 遗留（本次范围外，择机处理）：`ChatSidebar.confirmDeleteSession` 的 `deletingSessionId` 成功后不复位、`deleteAnimationTimeoutRef` 为共享单值 ref——360ms 内连续确认删除两个会话时第二次 `clearTimeout` 会取消第一个的归档调用，该行可能闪回；置顶区删空后整块条件卸载（无高度过渡）。（设置页"已归档对话"删除失败问题已由 fix-archived-session-delete-batch 修复，见上方根因记录。）
- 分页死循环根因：删除/归档会话改变服务端列表 total 与排序窗口后，前端 offset 分页（offset = items.length）+ uniqueSessions 去重合并可能整页全重复，items.length 不增长 → hasMore 恒 true → sentinel（enabled 翻转重建 IntersectionObserver）反复触发 loadMoreGlobal 无限请求+渲染（UI 一直加载、内存暴涨）。修复：四个分页 loader 在 offset>0 且本页有数据但合并后零进展时，将 total 收敛为 items.length 终止循环；refreshSessions（offset 0）自动恢复。
- 已知取舍：若服务端确实还有更多数据但某页全为已加载项（去重误伤），hasMore 会提前置 false，需下次 refreshSessions 恢复；属方案 B 设计内行为。
- 服务器端遗留问题（本次范围外，择机处理）：~~`DELETE /api/storage/sessions/key/:id` 只删持久化，不销毁 agentSessions 内存会话（“复活”）~~ 已由 fix-archived-session-delete-batch 堵住（删除前先 destroyAgent）。另外 loadMoreGlobal/loadMoreProject 无 loading 守卫（方案 A 未实施，零进展收敛已可终止循环）。
- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment（'record' 赋值后未使用），多会话前已存在，与近期改动无关。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行，避免 storage.mjs 默认 `~/.quickforge` 被测试污染。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`（全动态导入实现）。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地，新缓存需求沿用）。
- 前端分页测试技巧：tests/frontend/session-pagination-bootstrap.test.ts 的 mock React harness 中 useCallback 直接返回原函数且 useState 闭包是首次渲染快照，测 offset 分页必须直接调用 `loadGlobalSessions(offset)` / `loadProjectSessions(projectId, offset)` 显式传 offset，不能依赖 loadMore* 的闭包 state。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
