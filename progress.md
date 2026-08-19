# Progress

## Current State

- Feature: cutover 启动链三连（optimize-cutover-statement-reuse → fix-cutover-startup-bugs → startup-maintenance-window），用户要求同会话连续推进
- Status: 全部 done — 语句复用、P0 四项修复、P1 listen 提前+维护窗口+迁移进度 UI 均落地；全量 `npm run test`、`npm run lint`、`npm run build` 通过；rebase 整合远端 3 个提交（sidebar/font/metadata-delete）后重跑全量验证再推送
- Blockers: 无
- Next step: 无待办 feature；发布 patch 版本前完整运行 `npm run test`、`npm run lint`、`npm run build`

## Notes

- P1 启动维护窗口（本轮）：listen 前仅 `ensureStorage()+initializeSqliteStorage()`（gate 与 migration-status 依赖 DB；失败置 failed 不退出），其余启动链逐字保留移入后台 `runStartupInitialization()`。维护窗口 gate 在 index.mjs `/api/` 分支 handleApi 之前：白名单（GET /api/health、GET /api/migration-status）放行，其余 503 `{ok:false,maintenance:true,state}`+Retry-After:5；非 /api（静态、/share/）放行。health 三态：migrating→`{ok:true,maintenance:true,...完整状态}`（getSystemStatus 异常降级精简）、ready→原样、failed→`{ok:false,startupError}`（进程存活，waitForQuickForge 持续轮询到超时保持"启动失败"语义）。listen 回调里的云 agent 改为等启动链 settle 后再起（failed 跳过），避免维护期撞 503。
- fail-closed 语义变化（有意）：从"进程退出"改为"服务存活但拒绝业务 API"。收益：desktop 窗口/CLI 已开的浏览器不再直接消失，用户看到错误页（含 startupError 原文）而非黑屏；代价：CLI spawn 模式失败表现为 5 分钟超时而非快速失败，需 qf stop/restart 恢复。架构文档中"block startup"表述的实质（阻止业务使用）未变，wiki server/README.md 与 routes/README.md 已更新说明新机制。
- P0 四项修复（本轮）：① scheduled-runs 偷锁双条件（`!expired || stalePid===null || pidAlive` 均不偷，与 session 域一致，复用注入 now()）；② retainedMaintenance 在 finally 正常释放分支复位（retain 错误路径不动，DB 锁行兜底 isScheduledRunsMaintenanceActive）；③ authoritative 分支拆两段 try：JSON 读取/slim 失败→diagnostic+warn 降级继续启动，health 失败→保持 throw blocked；④ session/share/lan cutover 补 logger（开始/完成/晋升/回退/fail-closed error/fallback warn，options.logger 注入模式），index.mjs 启动链 catch log.error+flushLogger。旧测试"authoritative JSON 校验失败 fail closed"语义已改为 fail-open（JSON 是非权威 mirror），新增 health 失败 fail-closed 用例补齐覆盖。
- 前端迁移进度（本轮）：`src/lib/migration-status.ts`（fetchMigrationStatus 网络/非200/坏 payload→{ok:false}、migrationPhaseStage 映射、waitForMigrationSettled 可注入轮询门支持取消）；useAppBootstrap 在 initializePiStorage 后插迁移门（migrating→setMigrationStatus+2s 轮询、ready→清状态继续原 boot、failed→{kind:'migration',detail:startupError} 错误），catch 里补一次 migration-status 探测覆盖"页面加载时服务端已 failed"路径；startupError 从 string 升级为 {message,kind,detail?}（注意：这是 hook 返回值形状变更，既有测试已同步加 mock）。MigrationProgressView 复用 splash 容器/图标动画（抽 StartupSplashIcon 共用），4 域状态点遵循 DESIGN_LANGUAGE 强度梯（border→foreground 呼吸→实心）。仓库无前端渲染测试先例（全 mock react 逻辑 harness），组件无渲染断言，逻辑由单测覆盖。
- 已知取舍/遗留：迁移轮询期间单次网络抖动会落错误卡片需手动 Retry（可后续加连续失败计数）；WebSocket upgrade（/api/terminal/*）未 gate（前端就绪后才连，风险低）；failed 时 CLI 5 分钟超时表现（见上）；migration-status 各域 count 字段名不同（runCount/stateCount/shareCount/lanTokenCount）。
- 语句复用优化（本轮早些）：cutover 导入（`replaceAll`/`replaceAllStream`）原在循环内每行 `db.prepare()` 重新编译 SQL。改法：SQL 提取为模块级常量（`UPSERT_SESSION_INDEX_SQL`/`ENQUEUE_SESSION_MIRROR_SQL`/`SHARE_SESSION_UPSERT_SQL`/`ENQUEUE_SHARE_MIRROR_SQL`），函数追加可选 `statement = null` 参数（不传走原路径，运行时调用方零影响），导入循环前 prepare 一次复用。node:sqlite `StatementSync` 与事务状态解耦，BEGIN 前/后 prepare、事务内多次 run 安全。未改 `lan-access-repository.mjs`（其 replaceAll 无循环，各函数只调用一次）；`replaceTokens`（DELETE+INSERT 各一次/调用）与 `writeMessages`（split-message 记录才触发）保持不动——share 域规模小/不在 cutover 主路径，收益趋零。
- cutover 性能调研结论（本轮，指导后续方向）：瓶颈在 CPU 侧——session-state 整库被完整 parse+规范化+digest 4 遍（双读校验/备份/导入），每条记录含 2×structuredClone + 2×JSON round-trip + 2×sha256；磁盘侧已被单事务 all-or-nothing + WAL + synchronous=NORMAL 规避（整个迁移只 COMMIT 时一次同步）。"分批读+分批插"打不中瓶颈：分页提交破坏可回滚语义且无 I/O 收益，分批读不减少 parse 次数。数量级收益要靠减 pass（文件级快照替代双读，需重新论证并发安全，属独立 feature）。
- SQLite/JSON 启动兼容设计评审（本轮产出）：遗留 bug 清单中 ①启动失败黑盒 ②scheduled-runs 锁偷锁只查 pid ③retainedMaintenance 泄漏 ④authoritative 读 JSON fail-closed 扩大化 已由 fix-cutover-startup-bugs 修复；仍未修：⑤门禁豁免不一致（调度 gate vs backup-export 豁免）、⑥失败回退后 backupFile 复用旧快照可能错位（语义待定/低概率，择机处理）。体验方案（listen 提前+进度 UI）已由 startup-maintenance-window 落地；"彻底不碰 JSON"仍受三处架构依赖制约（session_index 权威源仍是 JSON metadata、scheduled-tasks metadata 永久驻留 JSON、mirror outbox 持续写 JSON），属独立 feature。

## 并行会话记录（rebase 整合）

- ⚠️ 启动慢根因（远端会话 fix-startup-cutover-replay，**代码未推送**——远端仅提交了状态文件描述，`digestFromLines` 导出/三处源侧改用/WAL checkpoint 均不在当前库中，待该会话提交推送后整合，届时注意与本轮语句复用/日志改动在同一批文件上可能再次冲突）：`session_storage_state` 卡在 `json_authoritative`（8-18 起 `Session state replace digest verification failed`），每次启动重放完整迁移（4 遍 1.6GB JSON 全量流读 + 1.4GB 备份写 + SQLite 全量导入再回滚）。排序不一致是核心 bug：JSON 源侧 summary digest 按 sessionId `localeCompare` 排序（`buildSessionJsonSnapshot`/`createStreamingSessionSource`/`writeCutoverBackupStream`），而仓储侧 `digestFromLines`/`verificationDigest` 按**整行字节序**排序。global+project 混合桶时两种排序必然交错不同（实测真实数据：`76eadc82…` vs `a40c7ee7…`），`replaceAllStream` 末尾 digest 校验必炸。现有测试数据集恰好两种排序同序，从未暴露。已验证修复方向：`digestFromLines` 导出为唯一 canonical 实现，cutover 源侧三处全部改用；cutover 成功 promote 后 `PRAGMA wal_checkpoint(TRUNCATE)` 回收反复失败积累的 GB 级 WAL。与维护窗口互补：新版首次启动一次性完成迁移（预计 1-2 分钟）期间用户看到进度页。
- 事故记录（远端会话，已回滚）：验证时一次 `QUICKFORGE_DATA_DIR` 未设成功的 node 脚本误在真实库执行了 cutover——digest 修复实证生效（首次成功 commit，2415 会话入库），但违反独占前提（旧服务还在 JSON 模式写数据），随后手动补救被用户叫停。已将 `session_storage_state` 回退为 `json_authoritative`（JSON 权威未动，quick_check ok，5176 服务存活）；SQLite 残留条目会在下次 cutover 的 replaceAllStream 中整体清空重写。教训：对真实数据目录执行任何写路径前必须显式断言 dataDir 非默认值。
- 用户数据现状（远端会话记录，择机清理）：`conversations` 4.36GB 中 2.75GB 是 1045 个原子写 `.tmp` 残留（JSON 模式高频全量重写的副作用）；WAL 2.8GB 待新代码 cutover 成功后自动 TRUNCATE。npm 全局包（旧代码）在发布新版前仍是慢启动。
- 桌面端与 `qf` 共用 `server/index.mjs` 初始化链，同根因同修复；桌面端 `ready-to-show` 策略使首屏 6.5MB modulepreload（pi-web-ui 3.75MB + pi-ai 1.6MB）也计入可见时间（独立遗留项，未处理）。
- 字体滑块闪烁（远端会话）：滑块 @input 每步同步 `applyFontSizeSettings` 改 root font-size 造成整页 reflow；修复为 RAF 合并 + dirty-check + 仅 interface 字号变化时派发事件。
- 归档删除（远端会话）：设置页永久删除走 batch 两操作事务，旧 `applySessionBatch` 对 metadata delete 无条件拒绝；修复为配对 metadata delete 视为 no-op 放行。删除后复活路径已堵（路由删持久化前先 destroyAgent）。遗留竞态（范围外）：删除请求处理期间另一请求恰好 restore 同一 session 仍可能复活，彻底堵住需 tombstone 机制。

## 历史笔记

- 持久化锁修复（前轮）：`withSessionPersistenceLock` 从全局单链改为 keyed 队列（`session-persistence-lock.mjs`），默认 key（''）保持全局串行；`persistSession` 在 SQLite 权威模式下用 `session:${sessionId}` key，JSON 镜像模式保留全局 key（bucket 级 read-modify-write 需要）。正确性依据：authoritative 模式下正确性由 per-row revision CAS 独立保证，全局互斥是 JSON 时代遗留；SQLite 单连接 + DatabaseSync 同步 API + Node 单线程保证任意时刻至多一个事务执行。auto-archive 仍用全局 key；其与 per-session persist 的交错由 CAS + 写前重校验保证。锁 drain 后 Map 条目自动清理。
- 慢 persist 观测：`persistSession` 记录耗时（排队+写），≥1s 打 warn（含 messageCount），便于定位"大会话同步事务阻塞事件循环"。注意同步 SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大，单事务耗时需靠拆事务/消息 split（已有 F9 split 机制）缓解。
- `runTaskkill` 超时兜底（`server/utils/process-tree.mjs`）：taskkill.exe 挂起时 10s 后 resolve(false)，不再让 dispose()/destroyAgent 永久悬挂（Windows 上 OpenCode 子进程清理路径）。
- `/api/agents/:id/restore` 挂起+内存增长根因分析：① 前端切到一个 session 时并发发 POST /restore + GET /state + GET /messages + GET /status + SSE，这些路由在内存无 session 时都隐式回落 restoreAgent，而旧实现是 check-then-act，并发时各自 createAgent、最后一次 set 覆盖前面的——被覆盖的 session 永不销毁，形成孤儿泄漏。② 前端切 session 只 abort fetch，服务端 handler 照常建 session。③ agentSessions Map 唯一删除点是 destroyAgent。④ 全局 withSessionPersistenceLock 是无超时单链 promise 队列，persist 积压时阻塞事件循环 → 请求挂起。
- restore 修复（前轮）：`restoreAgent` 拆为外层去重 + `restoreAgentUnlocked`，`pendingRestores` Map 按 sessionId 共享 in-flight Promise，finally 清理。所有并发调用点收敛到模块内单个函数。
- 测试教训（锁单测）：模块级队列 Map 在同一测试文件内共享——测试失败路径泄漏的 pending 链会污染后续使用相同 key 的测试；每个测试用唯一 key + gate 必须 settle + `await new Promise(r => setTimeout(r, 0))` 排空微任务。
- 未实施的后续候选（见 session-handoff）：前端 dispose 通知服务端提前回收、agentSessions 上限 LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 归档闪烁根因（前轮）：`archiveSession` 归档后调 `refreshSessions({ broadcast: true })` 的全量重置模式导致侧栏闪烁；修复为归档成功后本地乐观移除。
- 遗留（范围外，择机处理）：`ChatSidebar.confirmDeleteSession` 的 `deletingSessionId` 成功后不复位、`deleteAnimationTimeoutRef` 为共享单值 ref；置顶区删空后整块条件卸载（无高度过渡）。
- 分页死循环根因（前轮）：删除/归档改变服务端 total 与排序窗口后，前端 offset 分页 + uniqueSessions 去重可能整页全重复 → hasMore 恒 true 无限请求；修复为零进展时 total 收敛为 items.length。
- 已知取舍：若服务端确实还有更多数据但某页全为已加载项（去重误伤），hasMore 会提前置 false，需下次 refreshSessions 恢复。
- loadMoreGlobal/loadMoreProject 无 loading 守卫（零进展收敛已可终止循环）。
- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment，多会话前已存在。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地）。
- 前端分页测试技巧：mock React harness 中测 offset 分页必须显式传 offset，不能依赖 loadMore* 的闭包 state。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
