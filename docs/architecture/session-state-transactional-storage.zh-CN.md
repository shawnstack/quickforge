# 会话状态 SQLite 事务权威存储（F8 / F9）

> 状态：F8 将 session body、metadata、session_index 与 JSON mirror outbox 收敛为 SQLite 单事务提交，提供严格校验、CAS、可恢复 cutover、镜像物化、backup/restore 与离线降级工具。F9 Phase 2（核心存储层）在 schema v7 增加按会话分片的 `session_messages` 增量存储：大会话“拆分后写入”，body 保留 `messageStorage: 'split'` 标记，messages 行与 body/index/outbox 同一事务提交。schema v7。JSON mirror 保留用于降级与外部工具读取，SQLite 在 pending/authoritative 下是唯一业务权威。
> 边界（F9 Phase 2）：本阶段实施核心存储层（schema v7 + repository 分片 API + service 增量读写与 digest 语义）；agent-manager 增量接线、route SSE 增量下发、前端、backup 导出 v2 与 downgrade 对拆分会话的完整物化属于 Phase 3。

## 1. Schema v6 → v7

migration v6 新增以下表（v5→v6 失败会整体回滚，不影响 F5 `scheduled_task_runs` 与 F7 `session_index` 旧结构）：

- `session_states`：复合主键 `(scope, project_id, session_id)`；保存 `state_json`/`state_digest`、`metadata_json`/`metadata_digest`、`revision`（单调递增 CAS 版本）、`state_version`（业务版本）、`created_at`/`updated_at`。
- `session_state_tombstones`：删除墓碑，阻止 stale writer 在删除后以旧 revision 复活会话。
- `session_storage_state`：singleton phase 状态机，记录 `state_count`、canonical `digest`、`backup_file`、`diagnostic_json`。
- `session_json_mirror_queue`：JSON mirror outbox，按 `(scope, project_id, session_id)` 去重，记录 upsert/delete、revision、attempts、last_error。
- `session_state_maintenance_lock`：singleton 维护锁，owner PID + fencing + heartbeat/expires（与 scheduled runs 各自独立表）。

migration v7（`session_messages_incremental_storage`，v6→v7 失败整体回滚，存量 `state_json.messages` 原地保留、不回填）新增：

- `session_messages`：按会话分片的增量消息表。复合主键 `(scope, project_id, session_id, seq)`（seq 为会话内单调排序号），另有 `UNIQUE(scope, project_id, session_id, message_id)`（message_id 可空，带稳定 id 的消息去重/幂等）。每行含 `message_json`（规范化 JSON）、`message_digest`（sha256）、`created`/`updated`。
- `session_messages_session_id_idx`：按 session_id 的辅助索引。

`session_index`（F7 派生索引）与 `session_states` 在同一事务维护：body/metadata 提交、索引 upsert、mirror 入队要么全部成功要么全部回滚；拆分会话的 messages 行写入也在此事务内。

## 2. Phase 状态机

```text
json_authoritative -> cutover_running -> sqlite_authoritative_json_pending -> authoritative
   ^                      |                            |
   +----------------------+                            +-- 恢复时重试 drain
```

- `json_authoritative`：JSON 文件是唯一权威；service 全部走注入的 JSON adapter。
- `cutover_running`：仅存在于 cutover 事务窗口；崩溃后下次启动回到 `json_authoritative` 重新 cutover。
- `sqlite_authoritative_json_pending`：SQLite 已提交，JSON mirror 尚未排空；此 phase 下 SQLite 已可读（`isSessionStateAuthoritative()` 为 true）。
- `authoritative`：mirror 排空完成，正常运行态。

规则：

- pending/authoritative 只走 SQLite，绝不回 JSON 权威；
- cutover 稳定性校验改为流式 4 pass（双 summary、备份写 pass、`replaceAllStream` 导入 pass），任一不一致即中止回到 JSON（历史“三读整库物化”路径已移除）；
- cutover 对 metadata-only 孤儿（sessions-metadata 有索引条目但无会话体文件）容忍：启动迁移持有维护锁、无并发写，孤儿视为已删除会话的索引残留，剔除后不进入 records/`replaceAll`/备份（backup 重读验证基于剔除后 records），记录进 diagnostics（`metadataOnly` 为 id 审计数组，`orphanDeletes` 携带 `{scope, projectId, sessionId}`）并随 phase 写入 `session_storage_state.diagnostic_json` 审计；孤儿经 `replaceAll({ mirrorDeletes })` 入 mirror delete 队列，drain 时物理清除 JSON 元数据残留（delete 物化幂等），防止 `initializeSessionIndex` 从 JSON 源重建时孤儿回流 `session_index` 导致下次启动完整性校验失败；restore/import 路径仍独立拒绝（400）；
- 权威完整性（`quick_check` + digest + index 对账）失败时 fail closed 阻止启动；`json_authoritative` 下失败保留 JSON 路径；pending/authoritative 分支完整性失败时先尝试 `rebuildIndex()` 从权威 `session_states` 重建（`session_index` 是纯投影，JSON 源重建可能与之漂移，如 mirror drain 失败后孤儿回流），复验仍失败才 fail closed；
- 大库流式安全（quickCheck 轻量校验）：`verifyIntegrity({ quickCheck: true })` 只做 `PRAGMA quick_check` + 纯 SQL COUNT/join 对账（missingIndex/orphanIndex/duplicateIds/activeTombstones/staleTombstones/orphanMessages），返回带 `lightweight: true` 标记且 `digest: null`，不做逐行 `JSON.parse`/digest 重算（invalidRecords/invalidDigests 等字段为 0）；启动 pending/authoritative 校验、cutover 提交后校验、启动 diagnostics 均用轻量模式，digest 以 `replaceAll`/`replaceAllStream` 事务内验证并持久化的值为准；完整逐行校验保留在 `quickCheck: false`（backup restore、离线导出/降级工具等维护入口）；
- 大库流式导入：`repository.replaceAllStream(recordIterable, { expectedCount, expectedDigest, storageState, mirrorDeletes, beforeCommit })` 逐条消费 sync/async iterable（不把全部 records 物化进内存），在单个 immediate 事务内完成清表 + 逐条 INSERT/index upsert/mirror 入队 + mirrorDeletes delete 入队 + count/digest 验证（digest 逐条累加 `snapshotDigestLine`，JSON 导入恒为非 split，messages digest 槽为空，与 `digestRows` 对非 split 行等价）；任何错误（含迭代器中途抛错、digest/count 不匹配、mirrorDeletes 与 record key 冲突）整体回滚、原状保留；`storage.transaction` 回调要求同步，故事务由该方法自行 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` 管理，调用方须持有 session state 维护锁；`replaceAll` 保持不变供既有调用方使用；
- cutover 迁移路径流式化（第 2 步）：`json_authoritative` 分支不再 `buildSessionJsonSnapshot(readPhysicalSessionStateBuckets())×3` 整库物化，改为流式源 `createStreamingSessionSource(fsAdapter)` 逐桶逐会话 yield 规范化 record（逐会话规范化提取为 `normalizeSessionEntry`，与 `buildSessionJsonSnapshot` 共用同一实现，语义逐字节一致），4 个 pass 独立完整迭代源：pass1/pass2 双 summary（count/digest/diagnostics 序列化比对，不一致抛 `Session JSON source changed during cutover double read`）；pass3 备份写 pass（写入时逐条 digest 汇总复验 summary，不一致抛 `Session JSON source changed before cutover commit`；`backupFile` 已存在的恢复场景改为 summary-only 第三读，不重复写备份）；pass4 `replaceAllStream` 导入。跨 pass 仅保留小体积 summary（digest 行 + 诊断），内存上界 ≈ 最大单会话 parse/clone/stringify 峰值 + 单桶 metadata parse（+ 备份 pass 缓冲的 metadata JSON 小字符串），不再随库规模线性增长。`fsAdapter`（`listBuckets`/`listSessionFiles`/`readSessionState`/`readMetadataBucket`）可注入，生产默认 `createPhysicalSessionStateFsAdapter()` 包装 storage.mjs 物理 helper（`listProjectIds`/`listSessionDataFiles`/`sessionDataFile`/`sessionStoreFile('sessions-metadata')`/`readJsonFile`）；`options.readBuckets` 注入路径保留：每 pass 调用一次并物化一份全量快照后转等价 generator（仅限小数据测试场景，summary 结构与流式路径完全一致，每次完整 cutover 的调用次数由 3 次变为 4 次）；
- cutover 备份流式写入与字节级校验：`fs.createWriteStream` 写 tmp 文件逐会话输出（`"sessionId": <state>` 与 metadata 同理，逗号前置、末条无尾逗号；metadata JSON 小字符串缓冲、state 永不整库缓冲），JSON 形状与旧整库写入完全一致（`{app, version, exportedAt, scope, includeSecrets, sessionState:{count,digest}, data:{sessions, sessionsMetadata}}`，可被 JSON.parse 与既有 restore 兼容）；写入中同步累计 sha256 与字节数，close 后用 `createReadStream` 分块重读复核 hash/字节数一致且首尾字节为 `{`/`}`（替代原“整读 + 再 parse + 再 snapshot”校验，不再把备份整文件载入内存），失败抛 `Session cutover backup verification failed`、清理 tmp 并回退 `json_authoritative`（diagnostic 记录错误）；
- `server/index.mjs` 在 `recoverStaleScheduledTaskRuns` 之后、HTTP listen 之前执行 `initializeSessionStateCutover()` → `initializeSessionStateService()` → `recoverSessionStateRestorePlan()` → `drainSessionJsonMirror()`；shutdown 时 `stopSessionStateService()` 清理 mirror 定时器后关闭 SQLite。

## 3. CAS 与错误码

- `save` 支持 `expectedRevision`（revision CAS）与 `expectedStateVersion`（业务版本 CAS）；冲突返回 HTTP 409。
- F9 增量写同样以 revision CAS 覆盖 body 与 messages：`replaceMessages`（拆分过渡/全量改写/恢复）与 `appendMessages`（增量追加）都在同一 immediate 事务内做 revision 检查 + body 写入 + 行写入 + index upsert + mirror 入队；并发增量写与整体会话写互斥，stale writer 得到 `SESSION_STATE_CONFLICT`。
- 稳定错误码：`SESSION_STATE_CONFLICT`（revision/stateVersion 冲突）、`SESSION_STATE_DUPLICATE_ID`（跨 bucket 重复）、`SESSION_STATE_REQUIRED`（metadata 要求 body 存在）、`SESSION_FULL_DELETE_REQUIRED`（metadata 桶更新/替换不能删除 body）。
- 删除写 tombstone 并级联删除该会话的 `session_messages` 行；同 key 的 batch 操作单事务，无半状态。

## 4. Mirror（JSON 镜像）

- 每次 SQLite 提交在同一事务入队 upsert/delete；写后 best-effort drain，失败保留队列并定时重试，mirror 失败不传播业务提交失败。
- upsert 物化：body 文件 + metadata 桶条目；delete 物化：删除 body 文件与 metadata 条目。
- 拆分会话的 mirror 入队只存 body（`messageStorage: 'split'` 标记、不含 messages），保持 outbox 行小；drain 时 service 从 `session_messages` 重组完整 body（body + messages）再交给 mirror adapter 物化——JSON 文件始终是完整可降级形态。
- 启动 drain + 写后 drain；`drainSessionJsonMirror()` 返回 `{ drained, pending }`，pending 大于 0 时继续调度。
- drain 分页拉取 outbox：队列行携带完整 `state_json`，大库 cutover 可入队数千条目，drain 按 `listMirrorQueue({ limit })`（批大小 8）分页物化，不一次性载入全量队列；失败条目 `failMirror` 后 `updated_at` 后移、在后续批继续重试，整批零确认即停止本轮（防止死循环），1 秒定时重试不变；`pending` 为本轮结束后 `countMirrorQueue()`（COUNT 查询）的剩余队列长度。
- 镜像不反向影响 SQLite 权威；删除/替换产生的“残留 JSON 文件”由后续显式 delete 物化清除，权威判断始终以 SQLite 为准。

## 5. Backup / Restore

### 导出（权威）

- `GET /api/backup/export?scope=sessions`（以及 `scope=all`、safety backup）在权威模式下走 `exportSessionStateForBackup()`：维护锁内执行 `quick_check` + 轻量 `verifyIntegrity({ quickCheck: true })` + `exportSnapshot()`，integrity 失败或 count 不一致即 fail closed（digest 由 `exportSnapshot` 自算返回，轻量校验不再重复比对）。
- `exportSnapshot()` 对拆分会话同时返回 `messages` 数组与 `messagesDigest`；导出/快照值（`data.sessions`）组装为完整 body（标记 + messages），备份永不丢消息。
- 导出包顶层 `sessionState: { phase, count, digest }`，`data.sessions`/`data.sessionsMetadata` 为权威快照；旧字段格式不变，旧客户端可继续读取。

### 恢复

- `restoreSessionStateSnapshot({ sessions, sessionsMetadata }, { mode })` 仅在权威模式生效（非权威走既有 JSON 写路径）。
- 维护锁内执行：读取 before 快照 → 内存形成 target（replace 全量 / merge 时 local-only 保留、backup 同 key 覆盖）→ 归一化校验（非法 body、metadata-only orphan 在写计划前即失败）→ 写恢复计划 → 单事务 `replaceAll` → count/digest + integrity 验证 → 清理计划。
- `replaceAll` 对带 `messageStorage: 'split'` 标记的记录将 messages 拆分回 `session_messages` 行（seq 按数组序），非标记记录保持内联——表示形式在导出/恢复间精确往返，`sessionState.digest` 在 restore 后不变。
- 应用或验证失败自动补偿：`replaceAll(before)` 恢复精确 before 状态；补偿失败保留 `compensation_failed` 计划（startup 再回滚）。
- 计划文件 `storage/session-state-restore-plan.json`：`prepared/applying/target_applied` 启动时 roll-forward target，`compensating/compensation_failed` rollback before；计划缺失或 count/digest 不符阻止启动。
- 维护锁被占用时 `/api/backup/import` 对含 conversations 的恢复直接返回 423 `session_state_maintenance`；会话恢复只触碰 session_states/session_index/mirror/session_messages 表，绝不修改 `scheduled_task_runs` 或 JSON config 存储。
- 兼容：v1 JSON 备份（含 `data.sessions`/`data.sessionsMetadata`，或无 envelope 的旧格式）经 `normalizeBackupPayload`/`normalizeSessionMetadata` 归一化后导入；body-only 会话自动派生 metadata；metadata-only 孤儿在权威模式下拒绝（400）。

## 6. 离线导出与降级

停止所有 QuickForge/桌面进程后运行：

```bash
node server/maintenance/export-session-state-v1.mjs <输出文件.json>
```

- 先 `quick_check`，要求 phase 为 pending/authoritative（`cutover_running`/`json_authoritative` 明确报错）；
- 完整性 + count/digest 校验通过后写出 v1 备份（`scope: 'sessions'` + `sessionState` envelope）；拆分会话的导出同样组装为完整 body；
- 临时文件写入并重读验证后 rename，失败不留部分输出。

降级（materialize）工具：

```bash
node server/maintenance/downgrade-session-state-v1.mjs            # 仅物化 JSON 镜像
node server/maintenance/downgrade-session-state-v1.mjs --dry-run  # 只读报告
node server/maintenance/downgrade-session-state-v1.mjs --commit   # 物化并切回 json_authoritative
```

- 要求 pending/authoritative；`--dry-run` 不写任何文件；
- 物化 = drain mirror queue（拆分会话经 service 重组完整 body 后写出），随后用 `buildSessionJsonSnapshot` 对拍磁盘 JSON 与 SQLite 快照，count/digest 不一致拒绝继续（避免带残缺镜像降级）；
- **F9 Phase 2 限制**：drain 已能把拆分会话物化为完整 JSON 文件，但 downgrade 的 count/digest 对拍要求磁盘 JSON 与 SQLite 快照表示一致——含拆分会话时对拍会因 messages 表示差异 fail closed（安全拒绝）。拆分会话的完整降级（v1 整包物化 + 对拍调整）属于 Phase 3；
- `--commit` 在校验通过后把 phase 置为 `json_authoritative`（之后写入直连 JSON）。

彻底回到旧版的完整步骤见 F5 文档第 5 节（导出 → 移动 SQLite/WAL/SHM → 启动旧版 → 导入 v1）。

## 7. 磁盘占用说明

- 权威模式下同一份会话数据同时存在于 SQLite 与 JSON mirror（双写）。
- SQLite 使用 WAL 模式：`quickforge.sqlite3`、`-wal`、`-shm` 三件套；正常运行时 WAL 增长由 checkpoint 收敛，关闭时归并。
- 拆分会话的消息主体只存在 `session_messages`（不再整体压在 `state_json`），body 字节显著下降；mirror 排空后 JSON 文件仍为完整 body（重组产物）。
- mirror 排空后 JSON 文件与 SQLite 内容一致，主要增量来自 SQLite 页、WAL 与索引页；删除会话后 SQLite 有 tombstone 行，JSON 文件在 delete 物化后被移除。
- 备份文件写入 `storage/backups/`（cutover 与 before-restore safety backup）。

## 8. 已知限制

- **网络盘**：SQLite WAL 依赖本地文件锁与 mmap 语义，不支持网络文件系统；请将 `QUICKFORGE_DATA_DIR` 放在本地盘。
- **WAL 三件套**：不得只复制/删除主库文件；迁移或降级必须整体处理 `-wal`/`-shm`。
- **最低 Node**：`node:sqlite` 需要 Node ≥ 22.19（Electron 内置 Node 22 满足）；旧 Node 无法打开新 schema，会拒绝启动而不是降级写 JSON 造成 split-brain。
- **multi-version dataDir**：SQLite `user_version` 与新版本不匹配时，新版本会拒绝启动或按迁移规则处理；不支持多个 QuickForge 版本并发读写同一 dataDir。
- **JSON mirror 不是事务边界**：mirror 是 best-effort 降级/读取用镜像，权威与一致性以 SQLite 为准。
- **同长度中部修改的增量检测盲区**：拆分会话的增量写与重连补齐按「行数 + 尾部消息 digest」判定；对头部/中部消息的同长度原地修改不会被增量路径与前端 count 启发式检测（§10.4）。`verifyIntegrity` 可发现存储最终不一致；客户端可通过 `messages_replaced` 全量帧或显式全量刷新收敛。

## 9. F9 拆分语义（Phase 2 核心层）

### 9.1 拆分策略（拆分后写入）

- **阈值门控**：service 在权威写路径对 `state.messages` 做检查——非空且长度 ≥ `MESSAGES_SPLIT_THRESHOLD`（200，可调）时执行“拆分后写入”（`replaceMessages` 全量搬入 `session_messages`，body 去掉 messages 并加 `messageStorage: 'split'`）；小于阈值或空数组保持内联（向后兼容、零拆分开销）。
- **v6 存量不迁移**：v6→v7 迁移对既有 `state_json.messages` 原地保留；未重写前的旧会话仍从 body 读 messages（未拆分会话兼容路径）。首个超过阈值的权威保存触发一次性拆分（同一事务）。
- **拆分是持久的**：会话一旦拆分（body 带标记）后续所有保存都走分片路径；即使消息数被压缩到阈值以下也不回退内联。
- **增量追加**：拆分会话保存时，service 对比传入全量 messages 与已存行数（`messageCount`）：
  - `incoming.length < storedCount`（截断/重组）→ `replaceMessages` 全量改写；
  - 长度相等 → 校验最后一条边界消息 digest，一致则只写 body（`body-only`），不一致（原地改尾）→ 全量改写；
  - 变长 → `appendMessages` 只写新增尾部行（seq 从 max+1 起）。
  - **限制**：计数启发式只校验边界消息；对头部/中部消息的同长度原地修改不会被增量路径检测（会按尾部追加处理），需要显式全量改写（恢复、镜像重组、Phase 3 agent-manager 传 delta）来保证。`verifyIntegrity` 可发现任何最终不一致。
- **message_id 语义**：消息对象带非空字符串 `id` 时写入 `message_id` 列并受 `UNIQUE` 约束（`appendMessages` 对同 id 幂等跳过）；无 id 的消息仅由 seq 标识（不做内容去重，允许完全相同消息重复出现）。

### 9.2 Digest / 版本定义（v7）

- **body digest（`state_digest`）**：覆盖 `session_states.state_json` 的规范化 SHA-256。拆分会话的 `state_json` 不含 messages 且带 `messageStorage: 'split'`，因此 body digest **不含** messages；未拆分会话 body digest **含** 内联 messages。digest 即“当前存储表示”的摘要。
- **行级 digest（`message_digest`）**：每条消息规范化 JSON 的 SHA-256，随行写入。
- **会话级 messages digest**：对 `(seq, message_digest)` 序列（seq 升序）做 `sha256('\n'.join(seq\0digest))`；无行时为空串 `''`。
- **快照 digest（`verificationDigest` / `sessionState.digest` / 备份/restore 计划 digest）**：每会话一行 `scope\0projectId\0sessionId\0state_digest\0metadata_digest\0messages_digest`，整体排序后 SHA-256。cutover 导入（全部未拆分）与 repository 计算使用同一行格式（`snapshotDigestLine`），保证 JSON 源 digest 与 SQLite 快照 digest 一致；`exportSnapshot().digest`、`digest()`、`verifyIntegrity().digest` 全部走该定义。
- **表示形式往返**：导出把拆分会话组装为完整 body（标记 + messages），恢复经 `replaceAll` 按标记拆回 `session_messages` 行；同表示同 digest，restore 前后 `sessionState.digest` 不变。

### 9.3 Repository 增量 API

- `appendMessages(input, messages, { expectedRevision, expectedStateVersion })`：同事务 CAS + 追加行 + body/index/outbox；要求会话已拆分（否则报错，须先用 `replaceMessages`）。
- `replaceMessages(input, messages, { ... })`：同事务全量改写消息行（拆分过渡、恢复、压缩重组、边界变更兜底）。
- `readMessagesPage({ scope, projectId, sessionId, limit, offset | afterSeq })`：按 seq 稳定排序，返回 `{ messages: [{ seq, message, digest }], total, hasMore, nextOffset, lastSeq }`。
- `messageCount(...)`：会话消息行数（未拆分会话为 0）。
- `delete` 级联删除消息行；`replaceAll` 按标记拆分写入；`exportSnapshot` 含 messages/messagesDigest；`verifyIntegrity` 新增消息 digest、孤儿消息、双重表示（标记 + messages 并存）检查。
- `applyBatch`/`saveMany` 保持单事务；upsert 项可携带 `messages` + `messagesMode`（replace/append）。

### 9.4 Service 适配

- `saveSessionStatePair`/`saveSessionBody`/`applySessionBatch`/原子更新按 9.1 策略路由到 `save`/`replaceMessages`/`appendMessages`；增量保存只写新增 messages，不重写全量。
- `readSessionStateValue`/`readSessionStateStore('sessions')`/`exportSessionStateSnapshot`：未拆分会话直接返回 body；拆分会话返回 body + messages（重组）。
- `deriveMetadata`：`messageCount`/`preview` 在有 messages 载荷时按消息数组计算；拆分会话保存时按最终行数覆写 `messageCount`（未拆分会话保持既有行为）。
- `drainSessionJsonMirror`：拆分会话入队项物化前重组完整 body。
- phase 语义不变：`json_authoritative`/`cutover_running` 只走 JSON adapter，绝不误读 SQLite；pending/authoritative 只走 SQLite。

## 10. F9 Phase 3：agent 接线 / SSE 传输下降 / 前端 / backup / downgrade

### 10.1 agent-manager 增量接线与拆分冲突检测

- **显式 plan 接线**：`saveSessionStatePair` 返回 `messageStoragePlan`（inline/body-only/replace/append）与权威 `messageCount`（拆分会话按行数、内联按数组长度），`persistAuthoritativeSessionState` 据此维护 `session.persistedMessageStorage` / `persistedMessageCount` / `persistedTailDigest`；增量保存只把新增尾部行交给 `appendMessages`，截断/尾部修改走 `replaceMessages`，与 §9.1 计划一致。
- **拆分表示冲突检测**：拆分会话的 body 不含 messages，仅靠 `persistedStateJson`（body 规范化比较）无法发现并发消息写入。冲突重试分支额外比较 `storedMessagesState(sessionId)`（行数 + 尾部行 digest）与本次会话上次持久化的 `persistedMessageCount`/`persistedTailDigest`；任一不一致视为「storage 改了 agent-owned 字段」→ 记录 `persistConflictCount` 并拒绝覆盖（不伪成功）。仅 body 与消息均未变（如 pin/archive 等 storage-owned 变更）才采纳新 revision 重试。
- **restore 组装语义**：`restoreAgent` 经 `readSessionValue` 拿到重组后的完整 body+messages；同时读一次权威 record 设置 `persistedStorageRevision`/`persistedStateJson`/`persistedMessageStorage`/`persistedMessageCount`/`persistedTailDigest`，使恢复后的会话继续以拆分表示做冲突检测与增量保存。空会话删除路径同步重置以上计数。

### 10.2 SSE / 传输协议（stateVersion 语义不变）

- **轻量 state 帧**：拆分会话的 `GET /api/agents/:id/state`、`POST /restore`、SSE 初始 `event: state` 帧与 `emitSessionEvent` 下发的 `state` 事件均不再携带全量 messages，改为 `messagesSummary: { count }`（`messageStorage: 'split'` 字段仍保留供客户端判断）。非拆分会话与旧客户端行为逐字节不变。
- **增量 SSE 通道**：拆分会话的 `message_end`/`agent_end`/`messages_replaced` 帧不再携带全量数组；尾部有新消息时携带 `messagesAfter` + `messages`（增量尾部）+ `messagesIncremental: true`，并附 `messagesSummary` 总条数；尾部为空（截断/清空/rollback）时仅 `messagesSummary`。运行循环的单条 `message_end` 事件本就只带 `message`（单条），维持原有 upsert 路径。
- **消息拉取端点**：新增 `GET /api/agents/:sessionId/messages?after=N&limit=…`（默认 500，上限 5000），返回 `{ after, count, hasMore, messages }`；`count < after` 表示服务端已截断，客户端据此全量重取。会话未在内存时先 `restoreAgent`。
- **前端适配**（`src/lib/server-agent.ts`）：state 帧携带 summary 时走 `reconcileMessagesFromSummary`——`summary.count < 本地条数` → 全量重取替换；否则按 `after=本地条数` 拉缺失尾部，经 `mergeIncrementalMessages`（按 position + message id/内容去重）增量合并；`message_end`/`agent_end`/`messages_replaced` 增量帧同样合并。`stateVersion` 语义严格不变：`noteSseEvent` 的旧事件拒绝、poll 过期丢弃（`versionBeforeFetch`）逻辑原样保留，拆分协议不削弱既有防旧覆盖保护。`restore()`/`create()` 收到 summary 时先经 `/messages` 物化全量再构造 initialState。
- **实测传输下降**（本机 Windows / Node 24.12 / SQLite 3.50.4，content 512 字符/条）：
  - 2000 条（≈256k tokens）：整包 SSE state 帧 **1,189,252 B（1.19MB，Phase 1 基线）** → 拆分后 **278 B**（-99.98%，`stateFrameReduction=0.9998`）；增量 message_end 帧（5 条新消息）**10,538 B（10.3KB）**。
  - 说明：首次冷加载仍需经 `/messages` 传一次全量（状态帧变小，首次总字节接近）；收益在于页面刷新/SSE 重连/流式运行期间不再重复重传整包——这正是 Phase 1 判定为可感知瓶颈的场景。

### 10.3 backup / restore 拆分会话端到端

- 导出已把拆分会话重组为完整 body（`snapshotValues`）；Phase 3 修复了一个潜在问题：`snapshotValues` 对「已组装」的拆分会话记录（来自 `normalizeSessionSnapshotValues`，state 内联 messages）此前会用 `record.messages ?? []` 把 messages 清空，导致含拆分会话的备份 restore 后 count/digest 对拍失败；现在同时兼容两种形态（exportSnapshot 的「剥离 body + 独立 messages」与 normalize 后的「内联组装 body」）。
- 恢复后 `sessionState.digest` 与导出 digest 精确一致（表示形式往返，测试断言 `after.digest === exported.digest`）。v1 导出格式无需升级（导出即组装，restore 按标记拆回），v1 兼容不回归。

### 10.4 downgrade 拆分会话完整物化

- `downgrade-session-state-v1.mjs` 对拆分会话不再 fail closed：`drainSessionJsonMirror` 物化完整 body（标记 + messages 内联）；SQLite 侧对拍改用 **assembled 表示 digest**（`{ ...storedState, messages }` + 空 messages digest），与 `buildSessionJsonSnapshot` 读出的 JSON mirror 表示一致。
- `--dry-run` 只读（零写入、不改 phase）；默认运行物化 JSON 并对拍；`--commit` 校验通过后切回 `json_authoritative`，JSON 可完整读取（Electron smoke 断言 210 条消息完整物化）。

### 10.5 安全与兼容声明

- SSE `stateVersion` 语义不变；未触碰 F5 `scheduled_task_runs` / F7 `session_index` 表结构与查询权威；authoritative 下新增消息仅经 facade/service 写 SQLite，无 JSON 权威旁路。
- 测试全部在隔离 dataDir（mkdtemp）下运行，外部 guard 目录零写入；未提交 Git、未手工修改 `dist/`/`package-dist/`/`package-offline/`（build 生成的 `dist/` 由脚本完成）。

