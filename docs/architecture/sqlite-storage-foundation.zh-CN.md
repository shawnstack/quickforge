# SQLite 存储基础层设计（F2）

> 状态：F2 基础层已接入；F2 当时不迁移 JSON 业务数据且不创建业务表。F3 后续追加了空的 `scheduled_task_runs` 非权威表，详见 [`scheduled-task-runs-repository.zh-CN.md`](./scheduled-task-runs-repository.zh-CN.md)。**当前 schema 为单条 baseline v19**：F3–F11 的 migration 链已整体折叠，历史对象不再存在（见 §4）。

## 1. 范围与稳定依赖方向

SQLite 基础层位于 `server/sqlite/`，只依赖 Node 标准库、`node:sqlite` 和服务端 logger。稳定依赖方向为：

```text
server / ACP lifecycle
        ↓
server/sqlite/database.mjs
        ↓
server/sqlite/migrations.mjs
        ↓
node:sqlite DatabaseSync
```

业务模块未来只能依赖 `database.mjs` 提供的受控 handle，不应直接依赖 `node:sqlite`、migration 实现或数据库文件路径。基础层不依赖 public API、CLI、Desktop、channels 或现有 JSON store。

## 2. 路径与生命周期

默认数据库路径：

```text
<QUICKFORGE_DATA_DIR 或 ~/.quickforge>/storage/quickforge.sqlite3
```

`initializeSqliteStorage({ dataDir, databasePath })` 的 override 仅供内部组合和测试使用，不新增公开环境变量。路径在调用时解析，避免模块 import 顺序把错误的 dataDir 固化。

- Server：`ensureStorage()` 完成后、HTTP listen 前初始化；失败会阻止启动。
- ACP stdio：进入 runner 后动态加载 storage/SQLite 模块，先初始化，再创建 ACP agent；SQLite 默认路径在调用时读取当前环境，`finally` 关闭。
- 单进程并发初始化共享同一 Promise；同一已打开或初始化中的实例传入不同路径会明确失败。
- 初始化失败会关闭临时连接并清除 Promise，允许重试。
- `closeSqliteStorage()` 幂等；关闭后允许测试或下一 lifecycle 重新初始化。

## 3. 连接 PRAGMA

每个正式连接统一设置并校验：

| PRAGMA | 值 |
|---|---|
| `busy_timeout` | `5000` ms |
| `foreign_keys` | `ON` |
| `journal_mode` | `WAL` |
| `synchronous` | `NORMAL`（2026-08-26 决策切回，见 §3.1 修订记录） |

初始化或 health 校验不一致时明确报错。

### 3.1 synchronous 耐久性分析与定案

WAL 模式下两种取值的崩溃语义：

- `WAL + synchronous=NORMAL`：进程崩溃（含机器重启但 OS 正常刷盘）安全，已提交事务不丢；但 OS 崩溃/断电时可能丢失最后一次 checkpoint 以来已提交的事务。丢失窗口有界，约等于 checkpoint 间隔（默认 `wal_autocheckpoint=1000` 页）。
- `WAL + synchronous=FULL`：每次 COMMIT 都 fsync WAL，OS 崩溃/断电后已提交事务也不丢。

实测（`scripts/sqlite-synchronous-benchmark.mjs`，模拟会话保存热路径：2000 次单条 upsert 独立事务（state_json ≈ 50KB）与 1 个事务内 upsert 2000 条，各 3 轮取中位数；本机 Windows 11 / Node v24.15.0 / SQLite 3.51.3 / NVMe SSD）：

| 负载 | synchronous | 总耗时 | 均次耗时 | 相对 NORMAL 倍率 |
|---|---|---|---|---|
| 高频小事务（每条消息一次保存） | NORMAL | 1061.4 ms | 0.531 ms | 1.00x |
| 高频小事务（每条消息一次保存） | FULL | 1977.8 ms | 0.989 ms | 1.86x |
| 批量导入（一次性导入，单事务） | NORMAL | 1250.6 ms | 0.625 ms | 1.00x |
| 批量导入（一次性导入，单事务） | FULL | 1196.4 ms | 0.598 ms | 0.96x |

**定案结论：切换为 `FULL`。** 高频小事务负载下 FULL 的均次增量约 0.46 ms（远低于 2 ms 的可接受阈值），对每条消息一次保存的热路径不可感知；批量导入为单事务，fsync 成本被摊薄，倍率约 1.0。倍率 1.86x 看似偏高，但绝对成本极小，且换来断电/OS 崩溃场景下已提交事务零丢失，消除了 NORMAL 的 checkpoint 窗口丢数风险（该窗口内 mirror JSON 虽可兜底，但恢复链路复杂，不值得为 0.46 ms 保留）。

本任务只定案与记录，server 代码中的 PRAGMA 切换在后续独立小 feature 落地（含 health 摘要与测试同步）。若在 fsync 昂贵的环境（机械盘、部分网络盘）实测均次增量 ≥ 2 ms，应回退本决策并显式记录"接受 NORMAL 的丢失窗口"：丢失窗口有界（≈ checkpoint 间隔）、对话记录有 mirror JSON 兜底。日志只记录 `component=sqlite`、schema/migration 版本、journal mode、timeout 与错误摘要；禁止记录未来业务 SQL、参数或数据内容。

**2026-08-26 修订：切回 `NORMAL`（用户决策，覆盖上述 FULL 定案）。** 按上文预设的回退条款显式记录"接受 NORMAL 的丢失窗口"。背景变化：①会话持久化热路径已落地单遍 canonical 序列化 + 分批让出事件循环（optimize-persist-encoding-yield），编码段不再独占事件循环后，COMMIT 时的 fsync——尤其杀毒软件实时扫描、机械盘、网络盘上的延迟尖刺——成为大事务同步突刺的主要残余来源；②高频小事务 0.46ms 的均次增量本身收益有限，当初定案 FULL 主要买的是断电零丢失。语义边界：WAL 帧校验和保证任意崩溃模式下事务原子性（恢复时整事务重放或回滚，库文件不撕裂）；NORMAL 仅放弃逐 COMMIT fsync——进程崩溃/正常重启已提交事务不丢，OS 崩溃/断电可能回滚最后一次 checkpoint 以来已提交的事务（窗口有界 ≈ checkpoint 间隔）。注意：会话域存储 v2 下 SQLite 恒权威、无 mirror JSON 兜底，窗口内丢失即真实丢失（早于本修订的"mirror 兜底"前提已不存在），用户知情接受。代码侧 `SQLITE_SYNCHRONOUS=1`，health 摘要同步派生为 `normal`，`verifyPragmas` 与测试断言随常量收紧。

## 4. Migration 协议

迁移是版本连续、名称唯一的 append-only 列表。当前只有一条 **baseline** 迁移，一次建出全部现役表：

```js
export const BASELINE_VERSION = 19

export const SQLITE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: BASELINE_VERSION, // 19
    name: 'baseline',
    up(database) { database.exec(BASELINE_SQL) },
  }),
])
```

`schema_migrations` 结构不变：

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
)
```

baseline 建出 15 张表 + 13 个索引，按域归组：

| 域 | 表 |
|---|---|
| 元数据 | `schema_migrations` |
| 会话 | `sessions`、`session_messages`、`session_tombstones`、`session_state_maintenance_lock` |
| 分享 | `share_sessions`、`share_tokens`、`share_maintenance_lock` |
| LAN 访问 | `lan_access_state`、`lan_access_tokens`、`lan_access_maintenance_lock` |
| 定时任务运行 | `scheduled_task_runs`、`scheduled_runs_maintenance_lock` |
| Dreaming | `dreaming_note_stats`、`dreaming_runs` |

索引：`idx_sessions_list`、`idx_sessions_pinned`、`idx_sessions_session_id`、`idx_session_messages_session_id`、`share_sessions_session_id_idx`、`lan_access_tokens_issued_idx`、`lan_access_tokens_seq_idx`、`scheduled_task_runs_started_idx`、`scheduled_task_runs_status_started_idx`、`scheduled_task_runs_task_started_idx`、`scheduled_task_runs_trigger_started_idx`、`idx_dreaming_note_stats_recall`、`idx_dreaming_runs_started`。

兼容期对象全部不存在：`session_index_v10_backup`、`session_json_mirror_queue(_v10_backup)`、`session_messages_v10_backup`、`session_state_tombstones_v10_backup`、`session_states_v10_backup`、`session_storage_state(_v10_backup)`、`share_storage_state`、`lan_access_storage_state`、`share_json_mirror_queue`、`lan_access_json_mirror_queue`、`scheduled_runs_state`。四域（session / share / lan-access / scheduled-runs）都是单路径 SQLite 权威，JSON 只作为一次性导入源与导出逃生通道存在。

### 4.1 历史迁移清单（已折叠进 baseline，仅作决策记录）

| 版本 | 当时内容 | 现状 |
|---|---|---|
| 1 | 创建 `schema_migrations`，无业务表 | 折叠进 baseline |
| 2 | F3 空非权威 `scheduled_task_runs` 表 | 折叠进 baseline（`scheduled_task_runs`） |
| 3 | F5 重建 runs 表为 `(task_id, id)` 复合主键，增加 unknown/legacy/source 字段与稳定索引，并引入 cutover 相位与维护锁 | 表结构与索引折叠进 baseline；相位状态机整体删除，维护锁留在 `scheduled_runs_maintenance_lock` |
| 4 | F6 可重建 `session_index` 派生表 | 会话域 v2 起退役，不建表 |
| 5 | F7 列表查询索引 | 折叠进 baseline（`idx_sessions_*`） |
| 6 | F8 巨列 `session_states` + tombstone + `session_storage_state` + JSON mirror outbox + 维护锁 | 会话域 v2 起退役，不建表 |
| 7 | F9 按会话分片增量消息表 | 折叠进 baseline（`session_messages`） |
| 8 | F10 share 三表 + phase + mirror 队列 + 维护锁 | 只有 `share_sessions`/`share_tokens`/`share_maintenance_lock` 折叠进 baseline |
| 9 | F11 lan-access 三表 + phase + mirror 队列 + 维护锁 | 只有 `lan_access_state`/`lan_access_tokens`/`lan_access_maintenance_lock` 折叠进 baseline |
| 10 | `session_states_metadata_covering_index`：`session_states` 元数据覆盖索引（GB 级巨列隐式全扫的缓解） | 随 `session_states` 退役；v2 小行布局不需要该索引 |
| 11 | `session_state_v2_storage`：会话域 v2 三表，旧 6 表 RENAME 为 `*_v10_backup` | 三表折叠进 baseline；`*_v10_backup` 全部删除 |
| 12 | `remove_share_lan_record_digests`：删除 v8/v9 在线 `record_digest` 列 | 新库天生没有该列 |
| 13–18 | 结构化记忆实验表（`memories`/`memory_events` 等） | 表已删除；新库不建 |

历史演进细节见 [`session-storage-v2.zh-CN.md`](./session-storage-v2.zh-CN.md)、F5/F10/F11 三份存档文档与 `progress.md`。

### 4.2 版本门禁与事务语义

初始化执行 `BEGIN IMMEDIATE` 获取写锁后重新读取并验证数据库状态；全部待执行迁移在该事务内按序应用，每条迁移的 schema 变更、`schema_migrations` 记录与 `PRAGMA user_version` 更新同事务提交，任一步失败整体回滚。追加新迁移时只需在列表尾部追加 `{ version: 上一条 + 1, name, up }`，版本必须连续、名称唯一。

以下情况会明确失败（fail closed，不做半迁移）：

- `user_version` 高于代码支持的最新版本（旧版代码打开新库会被拒绝）；
- `user_version` 在 1..18 之间：属兼容期旧布局，本版本**没有就地升级路径**，打开即报错并提示“备份数据目录后从导出恢复或使用空库”；
- `user_version = 0` 但 `schema_migrations` 已存在，或 `user_version > 0` 但没有 `schema_migrations`；
- 已应用迁移行数/版本/名称与当前列表不一致；
- migration SQL 或记录写入失败；
- migration 列表不连续或名称重复。

该设计允许多个进程同时首次打开同一数据库：等待写锁的进程获得锁后重新读取版本，不会重复应用 migration。

## 5. 事务 API

受控 handle 提供 `exec`、`prepare`、`transaction`、`health`，不暴露原生数据库对象和 `close`。

```js
storage.transaction((database) => {
  database.prepare('...').run(...)
}, { mode: 'immediate' })
```

- 模式支持 `deferred`、`immediate`、`exclusive`，默认 `immediate`。
- callback 必须同步；返回 Promise/thenable 会立即回滚并抛出明确错误。
- 嵌套 transaction 使用唯一 SAVEPOINT；内层失败只回滚到对应 SAVEPOINT，外层可选择继续或整体失败。
- 业务模块不得自行关闭连接，不得修改基础 PRAGMA；关闭权只属于 Server/ACP lifecycle。

## 6. Health 与公开摘要

health 执行轻量 `SELECT 1`、SQLite 版本、PRAGMA、`user_version` 与 migration 一致性检查；可选运行 `PRAGMA quick_check`。Server 系统状态和 `/api/health` 增加 `sqlite` 摘要：版本、schema/migration 数量、journal mode、timeout、foreign keys 和 synchronous 状态。

摘要不包含绝对数据库路径、SQL、参数或业务数据。

### 6.1 `quick_check` 使用边界

四个存储域（session/share/lan-access/scheduled-runs）共用同一个 `quickforge.sqlite3`，而 `PRAGMA quick_check` 扫描整个库文件、不分域。因此它**不是四域常规启动扫描**：

- `initializeSqliteStorage()` 统一负责数据库打开、PRAGMA、schema/migration 一致性与版本门禁；四域常规启动都不额外调用 health/`quick_check`。
- 四域都没有 cutover、phase 或 JSON mirror outbox 可 drain，常规启动只需初始化 service（repository 访问器与注入），不做全表扫描、不调用 `verifyIntegrity({ quickCheck: true })`。
- shared `quick_check` 只在权威 backup/export、restore 边界、显式完整性维护与离线工具等场景使用；restore 的关系/count/digest 校验按各域恢复流程执行，日常启动不复算快照 digest。
- `server/sqlite/database.mjs` 的 `runSharedSqliteQuickCheck()` 仍为这些显式调用点提供进程内按数据库路径去重与 7 天 marker 降频；`:memory:` 始终真扫，marker 缺失/损坏/不可读则退回真扫。
- `verifyIntegrity({quickCheck:true, forceQuickCheck:true})` 与 `QUICKFORGE_SQLITE_QUICK_CHECK=force` 可强制真扫；失败照旧 fail closed，且不写 marker、不进入缓存。

历史“authoritative 启动时四域各扫一次，再由 shared quick_check 去重”的描述已被上述边界策略取代。WAL + `synchronous=NORMAL` 降低 torn-write 风险；`quick_check` 主要发现磁盘 bit-rot / 文件系统级损坏，逻辑关系与快照一致性由 backup/restore/export 和维护边界各自校验。

## 7. 备份与数据边界

> 本节保留 F2 时代的前提与决策上下文；四域的最终形态见下一条现状说明。

F2 不迁移现有 JSON 配置、会话或其他业务数据。当时的 JSON 备份/恢复流程也**不包含** `quickforge.sqlite3`、`-wal` 或 `-shm` 文件；migration 1 只有可由代码重建的 schema metadata。F3 后续增加 `scheduled_task_runs`；F4 再将其用于非权威、best-effort 影子双写，但不迁移旧历史。JSON `task.runs` 仍是完整业务权威并继续由现有备份格式导出/恢复，restore 不依赖 SQLite。

F5 若要让 SQLite 成为权威业务存储，必须先设计并实现 SQLite **逻辑备份/恢复**（而不是运行中复制数据库/WAL 文件），并定义 JSON→SQLite 的迁移、验证、回滚和版本兼容策略。未完成该前置工作前，不得删除 JSON runs 或把 SQLite 设为唯一权威。

**现状**：上述前置工作已全部落地，四个业务域（session / share / lan-access / scheduled-runs）均为单路径 SQLite 权威。在线备份/恢复走各域 `*-backup.mjs`（维护锁 + 逻辑导出/计划文件 + 补偿，绝不复制运行中的库文件）；JSON→SQLite 迁移只剩两个方向——空库启动时对会话域的一次性导入（`session-state-import.mjs`），以及 `server/maintenance/export-*-v1.mjs` 的停机导出逃生通道。JSON 不再承担任何在线权威或 mirror 角色。

## 8. 已知风险

- 多个 QuickForge 版本共用同一 dataDir 时，旧版本遇到更高 `user_version` 会在任何业务写入前拒绝打开；这是防止旧代码破坏新 schema 的硬保护。
- WAL 不适合所有网络盘、同步盘或不完整文件锁实现；默认数据库应位于本机文件系统。
- F1/F2 已在 Windows 的 Node 24 与 Electron Run-as-Node（内置 Node 22）验证；macOS、Linux、网络文件系统及最终 Electron 安装包环境仍需单独验证。
- `node:sqlite` 在当前运行时仍可能输出 ExperimentalWarning；该警告不改变上述一致性和失败策略。
