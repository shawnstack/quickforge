# 会话存储 v2 设计（SQLite 单一权威重构）

> 基准：存储 v2 改造完成，2026-08-19；SQLite schema v11（migration `session_state_v2_storage`）。本文是会话域存储的**当前事实源**。旧设计（JSON mirror、phase 状态机、session_index 派生表、cutover / background-migration）见 [`session-storage-current-architecture.zh-CN.md`](./session-storage-current-architecture.zh-CN.md)，保留为历史参考。
> 本文与 [`sqlite-storage-foundation.zh-CN.md`](./sqlite-storage-foundation.zh-CN.md)（连接/PRAGMA/migration 协议）互补：基础层机制不变，v2 只重构会话域表与写入/删除/启动链路。

## 1. 背景与动机：写放大与不可回收空间

旧设计（schema v6/v7，F8/F9）在"SQLite 权威 + JSON 镜像"双轨下，同一份会话数据最多被完整持久化 5 次：

| # | 副本 | 机制 |
|---|---|---|
| 1 | `session_states.state_json` 巨列 | WITHOUT ROWID 表，每次 save 全量重写 body（哪怕只追加一条消息） |
| 2 | `session_index` 派生表行 | 与权威同事务维护的查询投影 |
| 3 | `session_json_mirror_queue` outbox 行 | 又一份完整 `state_json` 副本，等待 drain |
| 4 | JSON 物化文件 | drain 把完整 body 写回 `storage/conversations/**.json` |
| 5 | WAL 残留 + 自由页永不回收 | 删除只清数据不清空间，库文件只增不减 |

实测后果：真实生产库膨胀至 **2~3GB**（2.93GB / 2415 会话），衍生出元数据读取隐式全库扫描、启动 OOM、quick_check 30s 检查税等一系列问题（历史修复见 `progress.md`）。v1 时代靠打补丁（v10 元数据覆盖索引、quick_check 降频、元数据只读投影）缓解症状，但根因——巨列全量重写与无空间回收——不可在旧布局上修复。

v2 的目标：**每条数据只存一份；删除即时归还空间；删除全部过渡性机制**（mirror、phase、cutover、background-migration、写屏障、派生索引表）。

## 2. 目标布局：schema v11 三表

migration v11 把旧会话域 6 张表 `RENAME` 保留为回滚安全网（见 §7），并创建新三表：

| 表 | 作用 | 关键结构 |
|---|---|---|
| `sessions` | 每会话一行的小行权威表 | 主键 `(scope, project_id, session_id)`；提升列 `title`/`created_at`/`updated_at`/`message_count`/`state_version`/`harness`/`task_status`/`archived_at`/`pinned_at`/`revision`/`updated_at_ms`；正文 `body_json`/`meta_json`（两个小 JSON 对象，`json_valid` CHECK） |
| `session_messages` | 消息逐行存储（append-only） | 主键 `(scope, project_id, session_id, seq)`；`UNIQUE(…, message_id)` 天然幂等去重；`message_json` + `message_digest`（sha256，CHECK 64 位 hex）；`FOREIGN KEY … REFERENCES sessions ON DELETE CASCADE` |
| `session_tombstones` | 删除墓碑（防 stale writer 复活） | `WITHOUT ROWID`，仅 `(scope, project_id, session_id, deleted_at)` 四列，极小 |

```sql
CREATE INDEX idx_sessions_list ON sessions (scope, project_id, archived_at, updated_at DESC);
CREATE INDEX idx_sessions_pinned ON sessions (scope, project_id, updated_at DESC) WHERE pinned_at IS NOT NULL;
CREATE INDEX idx_sessions_session_id ON sessions (session_id);
CREATE INDEX idx_session_messages_session_id ON session_messages (session_id);
```

要点：

- **没有 `state_json` 巨列**：`body_json` 只存不含 `messages` 数组的会话帧（标题、配置、任务状态等，KB 级）；消息本体全部在 `session_messages` 逐行追加。旧设计"改一个字段重写整个 body"的放大从根上消失。
- **messages 永远逐行**：不再有 v1 的 inline/split 双模式与 200 条阈值——任何带 `messages` 数组的 body 在写入时被 repository 统一抽取（`body_json` 带标记 `messageStorage: 'split'`，永不内联消息）。
- **`message_count` 是派生值**：任何消息写入后在同事务内由 `SELECT COUNT(*)` 重算，不信任调用方。
- **旧表 RENAME 保留**：`session_states`/`session_messages`/`session_index`/`session_state_tombstones`/`session_json_mirror_queue`/`session_storage_state` 全部重命名为 `*_v10_backup`，不 DROP（新表索引改用 `idx_*` 前缀避免与旧索引名冲突）；share / lan-access / scheduled-runs 域与维护锁表不受影响。

## 3. 写入路径：统一抽取 + 增量计划 + 单事务

### 3.1 save 的统一抽取

repository 的 `normalizeRecord` 对任何带 `messages` 数组的 body（内联或旧 split 标记体）整体抽取消息、编码为行（`message_id` / 规范化 `message_json` / sha256 `message_digest`）；body 只留帧。service 不再关心"拆不拆"，只决定**怎么写这些行**。

### 3.2 service 增量计划（`messageStoragePlan`）

| 模式 | 触发条件 | 动作 |
|---|---|---|
| `body-only` | 传入 body 无 `messages` 数组；或长度不变且**尾部 digest + 中部采样 digest** 均与存储一致 | 只 UPSERT `sessions` 行，消息行零触碰 |
| `append` | 传入长度 > 存储长度 | 只写尾部新行（`MAX(seq)+1` 起） |
| `replace` | 首存 / 截断 / 尾或中部校验失败 | 删除该会话全部消息行后重插 |

中部采样（`seq = floor(n/2)`）修复 v1 已知的"同长度中部原位编辑被静默丢弃"盲区，成本是一次主键单行查询。

### 3.3 repository 单事务

所有写路径（`save` / `replaceMessages` / `appendMessages`）在同一个 `BEGIN IMMEDIATE` 事务内完成：

1. 跨桶重复 id 检查（同 `session_id` 不允许出现在不同 bucket）；
2. revision / stateVersion CAS（冲突 409 `SESSION_STATE_CONFLICT`，语义与 v1 一致）；
3. 清除同 key 墓碑（CAS 链接管复活保护）；
4. UPSERT `sessions` 行（`revision + 1`，先写 FK 父行）；
5. `writeMessages`：replace 全删重插；append 做两类去重——带 `message_id` 的行按 `IN(…)` 分批（500/批）探测已存 id 跳过（O(增量)），无 id 整批在"digest 序列与存储尾部完全一致"时视为重试整批跳过；
6. 同事务重算 `sessions.message_count`。

### 3.4 写放大对比

| 维度 | v1 | v2 |
|---|---|---|
| 追加一条消息的写盘 | 巨列全量重写 + index 行 + outbox 行（完整 state 副本）+ drain 后 JSON 文件全量重写 + WAL | `sessions` 小行（KB 级）+ 1 条消息行 + WAL |
| 同一数据落盘份数 | ≈5 份 | 1 份 |
| 删除后库文件 | 不缩小（自由页永不回收） | 即时归还（见 §4） |

## 4. 删除与空间回收

删除路径（`deleteBySessionId`，单事务）：

1. CAS 检查（墓碑态解析为 revision 0，见 §8）；
2. `DELETE FROM sessions …` —— `session_messages` 的全部行经 **FK `ON DELETE CASCADE`** 连带删除；
3. UPSERT 墓碑（`deleted_at` = epoch 毫秒，`WITHOUT ROWID` 极小）；
4. **事务外** best-effort `PRAGMA incremental_vacuum(512)`：`auto_vacuum = INCREMENTAL` 下把释放页归还 OS；失败仅记 warn，不影响业务操作成功。

`auto_vacuum` 说明（`server/sqlite/database.mjs`）：连接打开时（`busy_timeout` 之后、migration 事务之前）执行 `PRAGMA auto_vacuum = INCREMENTAL`。**该标志只对新建的空库生效**——已有库保持原布局，除非整体 `VACUUM` 重建。升级用户的实际路径是"删库文件重启重导"（见 §5），重建出的库天然带增量回收。

墓碑语义：同 key 墓碑在下一次成功 save 时清除；从未复活的会话墓碑按设计保留（每行几十字节）。同长度同尾但中部的并发写靠 CAS 拒绝，不依赖墓碑。

## 5. 启动与一次性导入

v2 之后会话域**没有相位路由**：SQLite 恒为权威（`isSessionStateAuthoritative()` 常量 true；migration-status 的 `sessionState` 域恒报 `authoritative` + 实时会话数）。启动链只剩一个条件分支（`server/index.mjs` 的 `runStartupInitialization`）：

```text
session-state-service  →  session-state-import  →  session-state-restore-plan
                              │
                              ├─ repository.count() > 0 → 直接返回（库已就绪）
                              └─ 库为空 且 物理会话 JSON 树存在任一会话文件
                                   → importSessionStateFromJson（一次性导入）
```

`importSessionStateFromJson`（`server/session-state-import.mjs`）：

- 流式遍历旧 JSON 物理树（`storage/conversations/{global,projects/*}/`，与 v1 cutover 源相同的 adapter），**JSON 全程只读**——不写回、无 mirror、无 phase 状态；
- 逐桶合并 body 文件 id ∪ metadata 桶 key 排序遍历；**每会话一个事务**（`repository.save` 幂等 upsert），任意中断后重跑安全；
- 校验语义沿用 cutover 的 `normalizeSessionEntry`（id/scope/projectId 三方一致；body-only 文件推导 metadata；metadata-only 孤儿 dropped 并记 diagnostics）；
- 单条目失败（文件不可读、校验不符）**不中断整体**：计入 `skipped` + `diagnostics`，修复源文件后重跑即可；
- 结束后 WAL checkpoint。

导入在启动维护窗口内执行：`/api/*` 维持 503 门控（进程状态 `migrating`）直到完成，避免导入期间读到半量数据。

**用户重导路径**：关闭进程 → 删除 `~/.quickforge/storage/quickforge.sqlite3`（连同 `-wal`/`-shm`）→ 重启。空库 + JSON 文件存在即自动重导；这也是升级用户获得 `auto_vacuum` 新库布局的路径。

## 6. 删除的机制清单

| 机制 | v1 位置 | v2 处置 |
|---|---|---|
| JSON mirror 全链 | `session_json_mirror_queue` 表 + service 内 drain 调度 + storage JSON 写回 | 表 RENAME 保留；代码全删，会话写路径不再物化 JSON |
| phase 状态机 | `session_storage_state` singleton + 4 相位路由 | 表 RENAME 保留；service 恒 authoritative |
| `session_index` 派生表 | v4/v5 派生表 + 同事务 upsert + 影子校验/rebuild | 表 RENAME 保留；`session-index-repository.mjs` 重写为 `sessions` 表**直查层**（只读 LIMIT/OFFSET + `json_extract(meta_json,'$.lastModified')` 排序，保持历史列表序），无 sync/shadow/rebuild |
| 同步 cutover | `server/session-state-cutover.mjs` | 模块删除 |
| 后台迁移 | `server/session-state-background-migration.mjs`（importing→converging→idle→switching 状态机） | 模块删除 |
| 写屏障 | `acquireSessionJsonWriteBarrier` / `readLastSessionWriteFinishedAt`（storage.mjs） | 删除（无 JSON 写路径需要 park） |
| 维护锁 | cutover 模块内 | 抽出为独立模块 `server/session-state-maintenance.mjs`（`session_state_maintenance_lock` 表沿用，restore/verify 维护操作仍经它跨进程串行） |
| phase 路由的 facade 复检 | storage.mjs 会话写入口的执行时相位重路由 | 删除：`sessionStateFacade()` 恒走 session-state-service（SQLite） |

share / lan-access / scheduled-runs 三小域的 JSON→SQLite cutover 链**不在本次范围**，机制照旧。

## 7. 兼容与逃生通道

- **备份信封不变**：`GET /api/backup/export` 仍写 `sessionState: { phase, count, digest }`（phase 恒 `'authoritative'`）；restore 链路（维护锁、补偿事务、`session-state-restore-plan.json` 启动恢复）原样保留。旧 v1 备份文件可正常导入恢复。
- **downgrade 工具 = 纯导出**：`node server/maintenance/downgrade-session-state-v1.mjs [--dry-run]` 重写为把权威库物化回 v1 JSON 布局（逐会话 body 文件 + 每桶 `sessions-metadata.json`，拆分会话重组完整 body）。它**不再切换权威**——SQLite 恒权威，导出的 JSON 只是逃生副本（供旧版本 QuickForge 或人工读取）。
- **export 工具照旧**：`node server/maintenance/export-session-state-v1.mjs <输出.json>` 不再检查相位，完整性校验通过后导出 v1 备份。
- **`*_v10_backup` 六表**：作为回滚安全网保留（约等于旧库原始体积）。建议 v2 稳定运行一个观察期（真实大库验证 + 至少一个 patch 发布）后，以独立 migration 统一 DROP 回收空间。

## 8. 已知取舍

1. **`listPage` 的 `lastModified` 排序走 `json_extract(meta_json, '$.lastModified')`**：列表 UI 沿用 metadata 的 `lastModified`（会话可能回填早于写时钟的历史时间），无法直接用 `updated_at` 列。排序需要 temp b-tree；EXPLAIN 已验证 scope/archive 过滤仍走 `idx_sessions_list` 索引。中期候选：`json_extract` 表达式索引。
2. **删除后同 key CAS 的 `actualRevision` 报 0**：v2 墓碑不携带 revision（`actualRevision` 对墓碑态解析为 0）。效果上 stale 写（`expectedRevision > 0`）依旧 409 冲突、fresh 重建（null/0）依旧成功，但冲突错误体里的 `actualRevision` 是 0 而非历史值——调用方若依赖该值需知悉。
3. **`repository()` 先取进程级句柄**：service 的 `repository()` 总是先求值 `getSqliteStorage()`（用于检测句柄重建），即使测试通过 `configureSessionStateService` 注入了 repository 实例——**注入路径仍要求 SQLite 已初始化**（否则抛错）。当前测试均先初始化 storage，未构成实际问题；后续若需要纯内存 repository 测试可拆开这两步。
4. **`auto_vacuum` 仅新库生效**（见 §4）：升级用户不删库重导则没有增量回收；`*_v10_backup` 表的旧体积也仍在文件里。
5. **消息行读放大有界**：`readMessagesPage` 上限 5000 行/页；整体读组装（`assembleState`）逐页拉取，不再一次性物化（v1 OOM 教训）。

## 9. 新旧对比总表

| 维度 | v1（旧设计） | v2（现设计） |
|---|---|---|
| 写入遍数（追加一条消息） | 巨列全量重写 + index 行 + outbox 行 + JSON 物化 + WAL（≈5 份） | sessions 小行 + 1 条消息行 + WAL（1 份） |
| 删除回收 | 无：FK 手动级联删行，自由页永不回收，库只增不减 | FK CASCADE + 墓碑 + `incremental_vacuum(512)`，空间即时归还 OS |
| 列表查询 | `session_index` 派生表 + 同事务维护 + TTL/影子校验 + fallback | `sessions` 直查（`idx_sessions_list` + `json_extract` 排序），无同步层 |
| 启动链 | phase 路由四分支（同步 cutover / 后台迁移 / drain / barrier）+ 恢复计划 | 常量 authoritative + 空库一次性 JSON 导入 + 恢复计划 |
| 降级逃生 | `downgrade --commit` 切回 JSON 权威 | `downgrade` 纯导出 JSON 副本，SQLite 恒权威 |
| 库体积 | 实测 2~3GB 且不可逆增长 | 每数据一份 + 删除即回收（`*_v10_backup` 清理后回到净体积） |
