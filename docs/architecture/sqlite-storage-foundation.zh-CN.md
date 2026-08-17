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
| `synchronous` | `NORMAL` |

初始化或 health 校验不一致时明确报错。日志只记录 `component=sqlite`、schema/migration 版本、journal mode、timeout 与错误摘要；禁止记录未来业务 SQL、参数或数据内容。

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

## 7. 备份与数据边界

F2 不迁移现有 JSON 配置、会话或其他业务数据。当时的 JSON 备份/恢复流程也**不包含** `quickforge.sqlite3`、`-wal` 或 `-shm` 文件；migration 1 只有可由代码重建的 schema metadata。F3 后续增加 `scheduled_task_runs`；F4 再将其用于非权威、best-effort 影子双写，但不迁移旧历史。JSON `task.runs` 仍是完整业务权威并继续由现有备份格式导出/恢复，restore 不依赖 SQLite。

F5 若要让 SQLite 成为权威业务存储，必须先设计并实现 SQLite **逻辑备份/恢复**（而不是运行中复制数据库/WAL 文件），并定义 JSON→SQLite 的迁移、验证、回滚和版本兼容策略。未完成该前置工作前，不得删除 JSON runs 或把 SQLite 设为唯一权威。

## 8. 已知风险

- 多个 QuickForge 版本共用同一 dataDir 时，旧版本遇到更高 `user_version` 会拒绝启动；这是防止旧代码破坏新 schema 的硬保护。
- WAL 不适合所有网络盘、同步盘或不完整文件锁实现；默认数据库应位于本机文件系统。
- F1/F2 已在 Windows 的 Node 24 与 Electron Run-as-Node（内置 Node 22）验证；macOS、Linux、网络文件系统及最终 Electron 安装包环境仍需单独验证。
- `node:sqlite` 在当前运行时仍可能输出 ExperimentalWarning；该警告不改变上述一致性和失败策略。
