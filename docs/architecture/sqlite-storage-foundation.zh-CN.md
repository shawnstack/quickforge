# SQLite 存储基础层设计（F2）

> 状态：F2 基础层已接入；F2 当时不迁移 JSON 业务数据且不创建业务表。F3 后续追加了空的 `scheduled_task_runs` 非权威表，详见 [`scheduled-task-runs-repository.zh-CN.md`](./scheduled-task-runs-repository.zh-CN.md)。

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
| `synchronous` | `FULL`（定案依据见下文 §3.1 实测与决策） |

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
| 批量导入（cutover，单事务） | NORMAL | 1250.6 ms | 0.625 ms | 1.00x |
| 批量导入（cutover，单事务） | FULL | 1196.4 ms | 0.598 ms | 0.96x |

**定案结论：切换为 `FULL`。** 高频小事务负载下 FULL 的均次增量约 0.46 ms（远低于 2 ms 的可接受阈值），对每条消息一次保存的热路径不可感知；批量导入为单事务，fsync 成本被摊薄，倍率约 1.0。倍率 1.86x 看似偏高，但绝对成本极小，且换来断电/OS 崩溃场景下已提交事务零丢失，消除了 NORMAL 的 checkpoint 窗口丢数风险（该窗口内 mirror JSON 虽可兜底，但恢复链路复杂，不值得为 0.46 ms 保留）。

本任务只定案与记录，server 代码中的 PRAGMA 切换在后续独立小 feature 落地（含 health 摘要与测试同步）。若在 fsync 昂贵的环境（机械盘、部分网络盘）实测均次增量 ≥ 2 ms，应回退本决策并显式记录"接受 NORMAL 的丢失窗口"：丢失窗口有界（≈ checkpoint 间隔）、对话记录有 mirror JSON 兜底。日志只记录 `component=sqlite`、schema/migration 版本、journal mode、timeout 与错误摘要；禁止记录未来业务 SQL、参数或数据内容。

## 4. Migration 协议

迁移是版本连续且名称唯一的 append-only 列表。F2 初始仅有 migration 1：

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
)
```

F2 当时不创建任何业务表，应用版本使用 `PRAGMA user_version`。F3 后续以 migration 2 增加空的非权威 `scheduled_task_runs` 表，但未改变 F2 的基础层结论、生命周期或事务协议。

初始化执行 `BEGIN IMMEDIATE` 获取写锁后重新读取并验证数据库状态。每个 migration 的 schema 变更、`schema_migrations` 记录与 `user_version` 更新都在同一事务内。以下情况会明确失败并回滚：

- 数据库版本高于当前代码支持版本；
- `user_version`、migration 表和已应用行不一致；
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

### 6.1 启动 quick_check 策略（进程内去重 + 7 天 marker）

四个存储域（session/share/lan-access/scheduled-runs）共用同一个 `quickforge.sqlite3`，而 `PRAGMA quick_check` 扫描的是整个库文件、不分域——authoritative 相位每次启动的 4 个域级启动检查等于对同一文件全量扫描 4 次（2.93GB 生产库实测约 30s 启动检查税）。`server/sqlite/database.mjs` 的 `runSharedSqliteQuickCheck()` 统一了所有调用点（三个 repository 的 `verifyIntegrity({quickCheck:true})` 与 `storage.health({quickCheck:true})`）：

- **进程内去重**：同一数据库文件路径的一次成功 `quick_check` 在本进程内复用（按 `PRAGMA database_list` 解析主库路径作为缓存键；`:memory:` 无路径，始终真扫）。
- **跨启动降频**：成功扫描后在数据库同目录原子写 marker 文件 `quickforge-quick-check.marker.json`（记 `lastOkAt`/`sqliteVersion`/`databaseBytes`）；7 天内（`SQLITE_QUICK_CHECK_MAX_AGE_MS`）跳过真扫。marker 缺失/损坏/不可读一律视为不存在，退回真扫；marker 写失败仅 warn，不影响判定。
- **失败语义不变**：quick_check 失败照旧抛错且 fail closed；失败不写 marker、不进进程缓存，下次调用重新真扫。
- **逃生口**：`verifyIntegrity({quickCheck:true, forceQuickCheck:true})` 强制真扫（手动维护端点 `POST /api/storage/maintenance/verify-session-integrity` 已接线）；环境变量 `QUICKFORGE_SQLITE_QUICK_CHECK=force` 使所有调用每次真扫。
- **安全性论证**：WAL + `synchronous=FULL` 下已提交事务不存在 torn-write（崩溃时 WAL 重放或回滚），`quick_check` 防的是磁盘 bit-rot / 文件系统级损坏——这类损坏按磁盘时间尺度演化而非按启动次数，7 天周期 + 手动 force 入口足够把盲区变成有界窗口；跳过 quick_check 时其余 SQL 级 counts/join 对账照常执行，逻辑层损坏不受影响。

## 7. 备份与数据边界

F2 不迁移现有 JSON 配置、会话或其他业务数据。当时的 JSON 备份/恢复流程也**不包含** `quickforge.sqlite3`、`-wal` 或 `-shm` 文件；migration 1 只有可由代码重建的 schema metadata。F3 后续增加 `scheduled_task_runs`；F4 再将其用于非权威、best-effort 影子双写，但不迁移旧历史。JSON `task.runs` 仍是完整业务权威并继续由现有备份格式导出/恢复，restore 不依赖 SQLite。

F5 若要让 SQLite 成为权威业务存储，必须先设计并实现 SQLite **逻辑备份/恢复**（而不是运行中复制数据库/WAL 文件），并定义 JSON→SQLite 的迁移、验证、回滚和版本兼容策略。未完成该前置工作前，不得删除 JSON runs 或把 SQLite 设为唯一权威。

## 8. 已知风险

- 多个 QuickForge 版本共用同一 dataDir 时，旧版本遇到更高 `user_version` 会拒绝启动；这是防止旧代码破坏新 schema 的硬保护。
- WAL 不适合所有网络盘、同步盘或不完整文件锁实现；默认数据库应位于本机文件系统。
- F1/F2 已在 Windows 的 Node 24 与 Electron Run-as-Node（内置 Node 22）验证；macOS、Linux、网络文件系统及最终 Electron 安装包环境仍需单独验证。
- `node:sqlite` 在当前运行时仍可能输出 ExperimentalWarning；该警告不改变上述一致性和失败策略。
