# 分享令牌与分享记录 SQLite 权威存储迁移（F10）

## 1. 背景与决策

`share-store.mjs` 目前以 `shares/conversation-shares.json`（顶层对象 key=shareId）为唯一权威，单内存写队列非事务；令牌只存 sha256 哈希（secret=randomToken(32) b64url，token=`shareId.secret`），每分享 ≤50 条、7 天过期、`authVersion` 变更即整体失效。分享不存消息快照，动态读原会话（已走 F8 facade `readSessionValue` + F9 组装）。

用户确认的三项决策：

1. **完整套路**：影子双写 → cutover → 维护锁 → backup/restore/离线工具，复用 F8 session-state 模式。
2. **share_tokens 独立表**：令牌独立存储，便于 ≤50 条约束、过期清理与事务性签发。
3. **纳入 backup/restore**：分享记录与令牌进入既有备份/恢复体系（Phase 3）。

## 2. Phase 1 范围（本文件覆盖）

- `feature_list.json` 登记 F10 `share-token-storage-migration`（in_progress，dependencies 为 `session-state-transactional-storage`、`message-incremental-storage`）。
- schema v8 `share_storage_migration`（见 §3）。
- `server/sqlite/share-repository.mjs`（见 §4）。
- `server/share-service.mjs` + `server/share-cutover.mjs`（见 §5、§6）。
- 新增 3 个针对性测试文件（repository 9 项 / cutover 6 项 / service 3 项）+ 既有 v7 硬编码断言升级到 v8。

Phase 1 **不接线**：share-store.mjs 仍为 JSON 唯一权威；不接入 `server/index.mjs` 启动链；不做 routes/backup/restore/离线工具（Phase 2/3）。

## 3. schema v8 `share_storage_migration`

| 表 | 用途 |
| --- | --- |
| `share_sessions` | 分享记录：share_id PK、session_id、permission、title_snapshot、scope/project_id、password_hash/salt/version、auth_version、allow_cloud_usage、created/updated、expires/revoked/superseded_at、access_count、last_accessed_at、created_from_host、last_updated_from_host、revision（CAS）、record_digest（64 hex）、deleted_at（tombstone 标记）、extra_json（未知字段） |
| `share_tokens` | share_id FK（ON DELETE CASCADE）、token_hash、issued_at、expires_at、auth_version；`UNIQUE(share_id, token_hash)`；≤50 条由写入方在事务内裁剪 |
| `share_storage_state` | 独立域 phase 状态机（`json_authoritative`/`cutover_running`/`sqlite_authoritative_json_pending`/`authoritative`）、share_count、digest、backup_file、diagnostic_json |
| `share_maintenance_lock` | 独立维护锁（owner/owner_pid/fencing/acquired/heartbeat/expires） |
| `share_json_mirror_queue` | share_id PK、operation（upsert/delete）、share_json、attempts、last_error、updated_at |

`project_id` 约束与 F8 一致：global 必须空，project 必须非空。v7→v8 整体在一个 `BEGIN IMMEDIATE` 事务内，失败全回滚（测试证明 F5 scheduled runs / F7 session index / F9 session messages 数据保留），新库 `user_version` 为 8。

## 4. share repository

`createShareRepository(storage, { now })`，严格对象映射与白名单：

- 已知字段（`id`/`sessionId`/`permission`/`titleSnapshot`/`scope`/`projectId`/密码三件套/`authVersion`/`allowCloudUsage`/`createdAt`/`updatedAt`/`expiresAt`/`revokedAt`/`supersededAt`/`accessCount`/`lastAccessedAt`/`createdFromHost`/`lastUpdatedFromHost`/`tokens` + 旧版单令牌字段）映射到列；其余字段进 `extra_json`，读/导出时恢复（roundtrip 测试覆盖 `customField`/`futureFlag`）。
- `normalizeShareRecord` 同时供 cutover JSON 快照使用，保证两侧校验与 digest 一致。
- 快照 digest：每记录 `sha256(canonicalize(record))`（含 tokens、排除 revision/deletedAt），整仓为排序后的 `shareId\0recordDigest` 行聚合；`shareRecordDigest`/`shareSnapshotDigest` 导出供 cutover/backup 复用。
- `create`：单事务内 ① supersede 同 session 其他记录（置 superseded/revoked、清令牌、bump revision）② 更新当前活跃记录（无活跃则生成 `qfs_` 新 id 插入）③ 可选 `tokens` 同事务签发；幂等（重复 create 只更新当前记录）。
- CAS：所有变更（create/update/revoke/restore/delete/issueToken/pruneTokens）支持 `expectedRevision`，冲突 409 `SHARE_STATE_CONFLICT`。
- read/list：`get(shareId)` 排除 tombstone；`list({ sessionId, includeRevoked })` 默认排除 superseded 与 revoked（`includeRevoked` 供 Phase 2 restore 使用）。
- delete 走 tombstone（`deleted_at`），防 stale 写入复活；重复 delete 404。
- token：`issueToken`（活跃校验 404/410，生成 secret、事务内过期清理 + ≤50 裁剪 + access_count/last_accessed_at）、`verifyToken`（纯函数，authVersion + 过期过滤 + 恒定时间比较）、`pruneTokens`（过期清理，同时刷新 record_digest 与 mirror）。
- `replaceAll`/`exportSnapshot`/`verifyIntegrity`/`count`/`digest`/`listMirrorQueue`/`acknowledgeMirror`/`failMirror`；verifyIntegrity 校验每行 record_digest（含 tokens）、permission/scope、≤50 条、孤儿令牌、令牌 authVersion 与行一致。

## 5. share service

`share-service.mjs`：独立域 phase 状态机与 mirror drain。

- `configureShareService({ repository, json, mirror, phase })`、`setShareStoragePhase`、`readShareStorageState`、`getShareStoragePhase`、`isShareStorageAuthoritative`、`initializeShareService`。
- `drainShareJsonMirror`：single-flight 遍历 `share_json_mirror_queue`，upsert/delete 经 mirror adapter 物化到 `shares/conversation-shares.json`（whole-file 原子写），成功 acknowledge、失败 attempts+1 保留。
- 默认 mirror `createDefaultShareMirror()` 写真实 JSON 文件（保留 conversation-shares.json 作为 mirror/backup）。

## 6. share cutover

`share-cutover.mjs`：

- `buildShareJsonSnapshot`：整包校验——shareId/sessionId 必填、permission/scope 合法、`tokens` 数组结构（每项 token_hash 非空、authVersion 正整数）、password 哈希字段一致性（hash 与 salt 成对）、key 与 record.id 一致、**重复 shareId blocker**（与已见 id 重复直接拒绝）。
- `initializeShareCutover`：`json_authoritative`→`cutover_running`→`sqlite_authoritative_json_pending`→`authoritative`。双快照（count+digest 一致）→ v1 backup（临时文件重读 count/digest 校验后 rename）→ 三读稳定性 → `replaceAll`（与 pending phase 同事务）→ verifyIntegrity+count/digest 对拍 → drain mirror → authoritative。
- pending/authoritative 启动恢复：pending 先 verifyIntegrity（失败 fail closed 保持 pending）再 drain；authoritative 校验 + drain；`cutover_running` 安全回 JSON 后重跑。
- 失败语义：pending 之前任何失败回 `json_authoritative`；**进入 pending 后失败保持 pending，不回 JSON 权威**（mirror 失败即此态，后续启动可恢复）。
- 维护锁：独立 `share_maintenance_lock`，复用 PID+expiry+fencing+heartbeat 模式（`runShareMaintenance`）。

## 7. 已知边界（Phase 1）

- Phase 1 未接线：分享读/写路径仍走 JSON（share-store.mjs 未接入 repository）；`server/index.mjs` 启动链未包含 share cutover。Phase 2 完成接线后本节两条作废。
- 未知字段以 `extra_json` 保留；旧版单令牌字段（tokenHash/tokenIssuedAt/tokenExpiresAt）在导入时折入 `tokens` 数组。
- mirror 文件为规范化后表示（无 revision），不保证与历史 JSON 逐字节一致。

## 8. Phase 2（share-store 接入 + 生命周期 + routes）

- `share-store.mjs` 全部读写路径按 phase 路由：`pending`/`authoritative` 下 `createConversationShare`/`readConversationShare`/`listConversationShares`/`revoke`/`restore`/`update`/`updateExpiration`/`delete`/`issueConversationShareToken`/`verifyShareToken`/`pruneShareTokens` 经 share repository（单事务、CAS 409、supersede 事件、token 失效语义不变）；`json_authoritative`/`cutover_running` 保留旧 JSON 读写。
- JSON 文件降级为 best-effort mirror：repository 每次写后入 `share_json_mirror_queue`，`requestShareJsonMirrorDrain()` 调度 drain（默认 mirror 物化回 `conversation-shares.json`，文件保持可读）。
- 保留：`onConversationShareInvalidated` 事件（superseded/updated/revoked/deleted）、`assertShareActive` 404/410 状态机、operate 需密码、7 天 / ≤50 / authVersion 语义、`shareCookieName`/`parseCookies`、API shape 不变。
- 维护锁：authoritative 下若 `share_maintenance_lock` 被持有，share-store 写路径返回 423 `SHARE_MAINTENANCE_ACTIVE`（cutover 期间 JSON 路径照常）。
- 生命周期（`server/index.mjs`）：session state cutover 之后按序 `initializeShareCutover()` → `initializeShareService()` → `drainShareJsonMirror()`；pending/authoritative 完整性失败 fail-closed 阻止启动，json_authoritative 失败安全保留旧 JSON 路径；`shutdownRuntime` finally 调 `stopShareService()`（清 mirror timer）。
- routes：`routes/shares.mjs` restore 改用 `readConversationShare`（get，含 revoked 记录）；`routes/shared-conversation.mjs` `verifyShareToken`/`readConversationShare` 消费 repository 记录；CAS 409 / 维护锁 423 由 `sendError` 稳定映射。
- `share-service.mjs` 补回 `json` 配置项与 `requireShareJsonAdapter`（按 session-state-service 模式，作为 JSON 权威读路径扩展点）+ `getShareRepository()`。
- 测试：新增 `tests/server/share-store.authoritative.test.mjs`（4 项：authoritative 全生命周期走 repository、CAS 409 + 维护锁 423、json_authoritative 回退、mirror drain 后文件可读）与 `tests/server/share-lifecycle.test.mjs`（5 项：启动顺序、authoritative fail-closed、json 回退、mirror 队列跨启动恢复、shutdown 释放）。

## 9. Phase 3（backup/restore 纳入 + 离线工具 + 全量门禁）

### 9.1 backup route

- **导出**：`buildBackup` 新增 `shares` scope；`all`/`shares` scope 在 authoritative 下经 `share-backup.mjs` 的 `exportShareStateForBackup()` 导出——维护锁（share_maintenance_lock）内 `quick_check` + `verifyIntegrity` + `exportSnapshot`，count/digest 校验 fail closed；导出记录含 tokens（哈希），并剔除 `revision`/`deletedAt` 内部字段；包新增顶层 `shareState: { phase, count, digest }`（旧客户端忽略未知字段）。非权威（json_authoritative）路径直接读 `conversation-shares.json`。
- **恢复**：`restoreSectionIds` 新增 `shares`；authoritative 下经 `restoreShareStateSnapshot()`（share 维护锁 + 计划文件 + 失败补偿，`replace` 全量替换 / `merge` 保留 local-only、backup 同 key 覆盖）；仅触碰 `share_sessions`/`share_tokens`/`share_json_mirror_queue`，不破坏 F5 `scheduled_task_runs`、F7 `session_index`、F9 `session_messages`（测试证明）。维护锁占用时含 shares 的 import 返回 423 `share_maintenance`；v1 `conversation-shares.json` 形状（含旧版单令牌字段 tokenHash/tokenIssuedAt/tokenExpiresAt）经 `buildShareJsonSnapshot` 归一化导入。空 `shares: {}` 语义明确：replace 清空本地、merge 保留本地。
- `recoverShareRestorePlan()` 接入 `server/index.mjs` 启动链（`initializeShareCutover` → `initializeShareService` → `recoverShareRestorePlan` → `drainShareJsonMirror`），applying 类计划 roll-forward、compensating 类 rollback。
- 安全备份（restore 前）在恢复 sessions 或 shares 时 scope 为 `all`（包含 shares）。

### 9.2 离线工具

- `server/maintenance/export-share-v1.mjs`：停机权威 v1 导出（quick_check + verifyIntegrity + exportSnapshot，count/digest fail closed，临时文件重读再校验后 rename）；`cutover_running`/`json_authoritative` 拒绝。
- `server/maintenance/downgrade-share-v1.mjs`：`--dry-run` 只读报告（零写入）；默认 drain 物化完整 `conversation-shares.json` 并对拍 SQLite 快照（count/digest 精确）；`--commit` 校验通过后切回 `json_authoritative`；失败不留部分输出/不改变相位。

### 9.3 digest 稳定性

- `normalizeShareRecord` 将缺失 issuedAt 的令牌归一化为确定性哨兵 `1970-01-01T00:00:00.000Z`（与 `share_tokens.issued_at NOT NULL` 的存储表示一致），保证遗留 v1 导入在 cutover 与 backup/restore 两侧 digest 1:1 对拍。
- 修复 `repository.create` 新记录路径：行 `created_at` 与 record_digest 使用同一输入值（此前用当前时间导致输入 createdAt ≠ now 时 verifyIntegrity invalidDigests）。

### 9.4 已知限制

- backup/restore 导出的令牌只有哈希（tokenHash），原始 secret 不落盘；恢复后令牌仍可用（哈希原样恢复）。
- shares 恢复为整域替换/合并，不提供按 sessionId 或单个 share 的粒度恢复。
- 恢复后 JSON mirror 队列保留 pending 项，由启动 drain 或后续写入调度物化（与 F8 会话一致）。
- `scope=shares` 导出只含 shares；`scope=all` 含 config+sessions+shares。

