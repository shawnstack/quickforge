# LAN 访问存储 SQLite 权威迁移（F11）

## 1. 背景与决策

`lan-access-store.mjs` 目前以 `security/lan-access.json`（单配置对象：`enabled`/`passwordHash`(scrypt)/`passwordSalt`/`passwordVersion`/`authVersion`/`sessionTtlHours`(1-168)/`updatedAt`/`tokens`≤100）为唯一权威，内存写队列 + 非原子 `fs.writeFile`。token=`createRandomToken(32)` b64url，仅存 sha256 哈希；签发返回 `authVersion.secret`；`verifyLanAccessToken` 先做版本号比较再做常数时间哈希比较（安全闸门）。暴力破解防护（5 次/5 分钟 attempts Map）在 `routes/lan-access.mjs` 内存层，与存储无关，F11 不触碰。消费方：`routes/lan-access.mjs`（status/settings/unlock/logout/revoke/revoke-all）、`server/index.mjs` `isAuthorizedRemoteRequest`（cookie `qf_lan_access` → `verifyLanAccessToken`）。

调研确定的决策：

1. **整体迁移**：配置与 token 一起从 JSON 迁到 SQLite（一个配置对应一批 token，独立成域）。
2. **直接权威切换 + 可靠性外壳**：不做影子双写；cutover 双快照/备份/三读 → `replaceAll`+pending 同事务 → verifyIntegrity → drain → authoritative；LAN token 可重建（重新 unlock 即可），故可靠性外壳比会话/分享更轻。
3. **JSON 降级为 best-effort mirror**：authoritative 下经 `lan_access_json_mirror_queue` drain 物化回 `security/lan-access.json`（原子 tmp+rename），文件保持可读。
4. **纳入 backup/restore 与离线工具**（Phase 3，本阶段只规划不实现）。
5. **鉴权 fail-closed 不回归**：`verifyToken` 精确语义（版本号 + 常数时间哈希），任何不一致返回 false。

## 2. Phase 1 范围（本文件覆盖）

- `feature_list.json` 登记 F11 `lan-access-storage-migration`（in_progress，dependencies 为 `share-token-storage-migration`）。
- schema v9 `lan_access_storage_migration`（见 §3）。
- `server/sqlite/lan-access-repository.mjs`（见 §4）。
- `server/lan-access-service.mjs` + `server/lan-access-cutover.mjs` + `server/lan-access-json-file.mjs`（见 §5、§6、§7）。
- 新增 3 个针对性测试文件（repository 11 项 / cutover 6 项 / service 4 项）+ 既有 v8 硬编码断言升级到 v9（sqlite-storage-foundation / scheduled-task-runs-repository / session-index-repository / session-index-query / session-state-repository / share-repository / index.tunnel-host.integration / session-state-full-chain-electron-smoke 测试 + 4 个 Electron fixtures），full-chain Electron smoke 增加 F11 lan-access 全链段。

Phase 1 **不接线**：`lan-access-store.mjs` 仍为 JSON 唯一权威；不接入 `server/index.mjs` 启动链；不做 routes/backup/restore/离线工具（Phase 2/3）。

## 3. schema v9 `lan_access_storage_migration`

| 表 | 用途 |
| --- | --- |
| `lan_access_state` | 单配置行（`singleton = 1` PK）：enabled(0/1)、password_hash/password_salt/password_version、auth_version(≥1)、session_ttl_hours(1-168)、updated_at、revision（CAS）、record_digest（64 hex，含 tokens）、extra_json（未知字段 roundtrip）；`CHECK ((enabled=0) OR (password_hash/salt 均非空))` |
| `lan_access_tokens` | token_id PK、seq（插入序，供 `slice(-100)` 语义裁剪）、token_hash（sha256 b64url，非明文）、issued_at、expires_at、auth_version、remote_address、user_agent；≤100 条由写入方在事务内按 seq 裁剪 |
| `lan_access_storage_state` | 独立域 phase 状态机（`json_authoritative`/`cutover_running`/`sqlite_authoritative_json_pending`/`authoritative`）、lan_token_count、digest、backup_file、diagnostic_json |
| `lan_access_maintenance_lock` | 独立维护锁（owner/owner_pid/fencing/acquired/heartbeat/expires） |
| `lan_access_json_mirror_queue` | singleton=1（整文件镜像）、operation（upsert/delete）、config_json、attempts、last_error、updated_at |

v8→v9 整体在一个 `BEGIN IMMEDIATE` 事务内，失败全回滚（测试证明 F5 scheduled runs / F7 session index / F9 session messages / F10 share 数据保留），新库 `user_version` 为 9。

## 4. lan-access repository

`createLanAccessRepository(storage, { now })`，严格对象映射与白名单：

- 已知配置字段（`enabled`/`passwordHash`/`passwordSalt`/`passwordVersion`/`authVersion`/`sessionTtlHours`/`updatedAt`/`tokens`）映射到列；其余字段进 `extra_json`，读/导出时恢复（roundtrip 测试覆盖 `custom` 对象）。
- `normalizeLanAccessConfig` 同时供 cutover JSON 快照使用，保证两侧校验与 digest 一致：password 哈希/salt 成对、enabled 必须有密码、tokens 数组结构与每项 token_hash 非空、authVersion 正整数；过期 token 按 `pruneTokens` 语义裁剪，≤100 保留最新（`slice(-100)` 语义，SQL 侧以 seq 保持插入序）。
- 快照 digest：`lanAccessConfigDigest(config)` = `sha256(canonicalize({...config, tokens: sortedTokens}))`（含 tokens 与未知字段、排除 revision），JSON 侧与 SQLite 侧 1:1；`count` 为活跃 token 数。
- `updateSettings`：单事务内 ① settings 变更（enabled/password/sessionTtlHours）② 若密码变更或 enabled 切换则 `authVersion+1` 并**清空全部 tokens**（与 JSON `authChanged` 语义一致）③ 配置行 + tokens + mirror 入队一起提交。
- `issueToken`：单事务内校验 enabled+passwordHash（403）、生成 secret/tokenHash/expiresAt、删除过期 token、按 seq 裁剪 ≤100、配置行 revision+1 与 mirror 入队；返回 `{ token, expiresAt, maxAge, config, revision }`。
- CAS：`updateSettings`/`issueToken`/`revokeAll` 支持 `expectedRevision`，冲突 409 `LAN_ACCESS_STATE_CONFLICT`。
- 单条 revoke：`revokeTokenById`（按 token_id，404 `LAN_ACCESS_NOT_FOUND`）、`revokeToken`（logout，解析 `version.secret`，版本不匹配或哈希不存在返回 false）、`revokeAll`（authVersion+1 + 清空 tokens）。
- `verifyToken(token)`：读当前配置走导出纯函数 `verifyLanAccessTokenRecord(config, token)`——enabled/passwordHash 缺失、版本号不匹配、secret 为空均 false；对未过期且 authVersion 一致的 token 做常数时间哈希比较（`safeHashEqual`）。
- `replaceAll`/`exportSnapshot`/`verifyIntegrity`/`count`/`digest`/`listMirrorQueue`/`acknowledgeMirror`/`failMirror`；verifyIntegrity 校验 record_digest（含 tokens）、password 成对/enabled 有密码、≤100、孤儿 token、token authVersion 与配置一致。

## 5. lan-access service

`lan-access-service.mjs`：独立域 phase 状态机与 mirror drain。

- `configureLanAccessService({ repository, mirror, phase })`、`setLanAccessStoragePhase`、`readLanAccessStorageState`、`getLanAccessStoragePhase`、`isLanAccessStorageAuthoritative`、`initializeLanAccessService`、`getLanAccessRepository`。
- `drainLanAccessJsonMirror`：single-flight 遍历 `lan_access_json_mirror_queue`（singleton 单条目），upsert/delete 经 mirror adapter 物化到 `security/lan-access.json`，成功 acknowledge、失败 attempts+1 保留、定时重试调度。
- 默认 mirror `createDefaultLanAccessMirror()` 经 `materializeLanAccessJsonEntry` 写真实 JSON 文件（原子 tmp+rename，保留文件作为 mirror/backup）。

## 6. lan-access cutover

`lan-access-cutover.mjs`：

- `buildLanAccessJsonSnapshot`：整包校验——配置必须是对象、password 哈希/salt 成对、enabled 必须有密码哈希、`tokens` 数组结构（每项对象、token_hash 非空、authVersion 正整数）；过期裁剪与 ≤100 与 repository 一致；输出 `{ config, tokenCount, digest }`。
- `readLanAccessJsonSource`（默认 cutover 读源）：文件缺失（ENOENT）与损坏/不可解析统一回退**默认禁用配置**（与 lan-access-store 对缺文件的兜底语义一致，fail-closed 默认禁用），并物化稳定副本保证双快照稳定。
- `initializeLanAccessCutover`：`json_authoritative`→`cutover_running`→`sqlite_authoritative_json_pending`→`authoritative`。双快照（tokenCount+digest 一致）→ v1 backup（`quickforge-lan-access-cutover-<stamp>.json`，临时文件重读 tokenCount/digest 校验后 rename）→ 三读稳定性 → `replaceAll`（与 pending phase 同事务）→ verifyIntegrity+count/digest 对拍 → drain mirror → authoritative。
- pending/authoritative 启动恢复：pending 先 verifyIntegrity（失败 fail closed 保持 pending）再 drain；authoritative 校验 + drain；`cutover_running` 安全回 JSON 后重跑。
- 失败语义：pending 之前任何失败回 `json_authoritative`；**进入 pending 后失败保持 pending，不回 JSON 权威**（mirror 失败即此态，后续启动可恢复）。
- 维护锁：独立 `lan_access_maintenance_lock`，复用 PID+expiry+fencing+heartbeat 模式（`runLanAccessMaintenance`）。

## 7. lan-access-json-file

`lan-access-json-file.mjs`：`lanAccessJsonPath()`（`<dataDir>/security/lan-access.json`）、`ensureLanAccessJsonFile`（缺失写默认配置）、`readLanAccessJsonFile`（ENOENT 兜底默认配置）、`writeLanAccessJsonFile`（原子 tmp+rename，写入前经 `normalizeLanAccessConfig` 规范化）、`materializeLanAccessJsonEntry`（upsert 写整文件 / delete 重置为默认禁用配置）。

## 8. 已知边界

- §8 原记录为 Phase 1 未接线状态；Phase 2（lan-access-store 全部读写路径接入 repository + 生命周期 + routes）与 Phase 3（backup/restore + 离线工具 + 全量门禁）已完成，见 §9/§10 与 `progress.md`。
- token 级未知字段不 roundtrip（与 share_tokens 一致，仅已知列）；配置级未知字段经 `extra_json` 保留。
- mirror 文件为规范化后表示（无 revision），不保证与历史 JSON 逐字节一致。
- 暴力破解内存防护（routes attempts Map）与存储无关，F11 不动。
- 未触碰 `dist/`、`package-dist/`、`package-offline/`；未 commit/tag/push。

## 9. Phase 2 / Phase 3 完成状态

- **Phase 2（lan-access-store 接入 + 生命周期 + routes）**（已完成，见 `progress.md`）：`lan-access-store.mjs` 全部读写路径按 phase 路由；`server/index.mjs` 启动链 `initializeLanAccessCutover() → initializeLanAccessService() → drainLanAccessJsonMirror()`，shutdown `stopLanAccessService()`；`routes/lan-access.mjs` 无需改动；`isAuthorizedRemoteRequest` 消费 repository `verifyToken`。
- **Phase 3（backup/restore + 离线工具 + 全量门禁）**：见 §10。

## 10. Phase 3（backup/restore + 离线工具 + 全量门禁）

### 10.1 backup route 权威导出与 restore

- `server/lan-access-backup.mjs` 提供 `exportLanAccessStateForBackup()` 与 `restoreLanAccessStateSnapshot()`（含 `recoverLanAccessRestorePlan()`），镜像 F10 share-backup 的独立域模式。
- **导出**：`server/routes/backup.mjs` 新增 `lan-access` scope；`all`/`lan-access` scope 在 authoritative 下经 `exportLanAccessStateForBackup()` —— lan-access 维护锁内 `quick_check` + `verifyIntegrity` + `exportSnapshot`，count/digest 校验 **fail closed**；导出包新增顶层 `lanAccessState: { phase, count, digest }`（count = token 数），`data.lanAccess` 为单个配置对象——**只含 token 哈希非明文，剔除 revision**；非权威路径直接读 `security/lan-access.json`。
- **恢复**：`restoreSectionIds` 新增 `lanAccess`；authoritative 下经 `restoreLanAccessStateSnapshot()`（lan-access 维护锁 + `lan-access-restore-plan.json` 计划文件 + 失败补偿：apply 失败自动补偿回 before，补偿失败保留 `compensation_failed` 计划）。replace 全量替换；merge 保留本地配置字段（含本地 tokens）、backup 同 key 覆盖。**恢复会覆盖 `enabled` 开关**（inspect 警告新增「将替换局域网访问配置」）。只触碰 `lan_access_state`/`lan_access_tokens`/`lan_access_json_mirror_queue`，不破坏 F5 `scheduled_task_runs`、F7 `session_index`、F9 `session_messages`、F10 `share_sessions`（route 测试断言四域行数不变）。v1 `lan-access.json` 形状（无 envelope、token 缺 issuedAt 等）经 `buildLanAccessJsonSnapshot`/`normalizeLanAccessConfig` 归一化导入（issuedAt 缺失归一为确定性哨兵 `1970-01-01T00:00:00.000Z`）。维护锁占用时含 lanAccess 的 import 返回 423 `lan_access_maintenance`。
- `recoverLanAccessRestorePlan()` 已接入 `server/index.mjs` 启动链（`initializeLanAccessCutover` → `initializeLanAccessService` → `recoverLanAccessRestorePlan` → `drainLanAccessJsonMirror`）：applying 类状态 roll-forward target、compensating 类状态 rollback before。

### 10.2 离线工具

- `server/maintenance/export-lan-access-v1.mjs`：停机权威 v1 导出（`quick_check`+`verifyIntegrity`+`exportSnapshot`、count/digest fail closed、临时文件重读再校验后 rename，输出 `{ scope: 'lan-access', lanAccessState, data: { lanAccess } }`）；`cutover_running`/`json_authoritative` 拒绝。
- `server/maintenance/downgrade-lan-access-v1.mjs`：`--dry-run` 只读报告（零写入）；默认 drain `lan_access_json_mirror_queue` 物化完整 `security/lan-access.json` 并对拍 SQLite 快照（tokenCount/digest 精确）；`--commit` 校验通过后切回 `json_authoritative`；失败不留部分输出/不改变相位。

### 10.3 已知限制

- restore 会覆盖 `enabled` 开关与配置（含密码哈希/token），导入前 UI inspect 已警告「将替换局域网访问配置」。
- LAN token 可重建（重新 unlock 即可），故 cutover 失败最坏损失为已签发 token 需要重登，无不可恢复数据。
- 导出/mirror 只含 token 哈希非明文；原始密码与 token 明文永不离开签发方。
- token 级未知字段不 roundtrip；mirror 文件为规范化表示（无 revision），不保证与历史 JSON 逐字节一致。
- 暴力破解内存防护（routes attempts Map）与存储无关，F11 未触碰。

### 10.4 验证

- 新增 `tests/server/backup.authoritative-lan-access.test.mjs`（7 项：scope=lan-access/all 导出含 lanAccessState+digest+token 哈希+无 revision、replace 且 F5/F7/F9/F10 行数不变、merge 保留本地字段与 tokens、legacy v1 无 envelope 归一化、维护锁 423、inspect 警告含「将替换局域网访问配置」、restore 后 verifyLanAccessToken 任何输入 fail-closed）+ `tests/server/lan-access-offline-export.test.mjs`（7 项：停机导出、导出→恢复 roundtrip digest 对拍、json_authoritative/cutover_running 拒绝、dry-run 零写入、materialize 后 JSON 可读 + --commit 相位切换、mirror 不匹配拒绝、失败不留部分输出）。
- Electron 39.8.10 full-chain smoke 扩展覆盖 lanAccess（schemaVersion 9：settings/issue/verify/revoke/backup/restore/mirror/downgrade 端到端，输出 `lanAccess: { phase, count, roundtripDigestOk, mirrorOk, revokeAllOk, backupRestoreOk, downgrade: { dryRunOk, materialized, committed, phaseAfterCommit } }`）。
- 全量 `npm run test`/`npm run lint`/`npm run build` 通过后 F11 标记 done。
