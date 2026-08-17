# 定时任务运行记录 SQLite Repository（F3）

> 状态：本文记录 F3 migration v2 与当时的独立 repository 边界。F4 增加 hybrid，F5 已升级 migration v3 与 repository API 并切换 SQLite authoritative；当前设计见 [`scheduled-task-runs-authoritative-cutover.zh-CN.md`](./scheduled-task-runs-authoritative-cutover.zh-CN.md)。

## 1. 范围与权威数据边界

F3 只增加：

- SQLite migration v2：`scheduled_task_runs` 及查询索引；
- 同步 repository：`server/sqlite/scheduled-task-runs-repository.mjs`；
- DDL、迁移、CRUD、过滤、分页、裁剪和运行时兼容测试。

本阶段明确不做：

- 不修改 `server/routes/scheduled-tasks.mjs`，现有 JSON `task.runs` 仍是运行时与 API 的权威来源；
- 不导入历史 `task.runs`，因此升级后 `scheduled_task_runs` 初始为空；
- 不修改 `server/routes/backup.mjs`，现有备份/恢复不包含该表；
- 不修改前端，不存储 `taskTitle`、`scheduleRule`、`projectName`；
- 不将 SQLite 数据解释为当前用户可见运行记录的权威副本。

F4 后续选择更保守的 hybrid 方案：只在 JSON 成功提交后 best-effort 影子双写 SQLite，GET 仍以完整 JSON 集合作权威校验和分页，因此不需要先把 SQLite 纳入当前备份，也没有切换权威数据。现有 JSON 备份完整包含 `task.runs`，restore 不依赖 SQLite；F5 若要迁移历史或切换权威，仍必须完成 SQLite 逻辑备份/恢复、迁移验证、失败回滚和多版本兼容门禁。禁止在运行中直接复制 `.sqlite3`、`-wal`、`-shm` 代替逻辑备份。

## 2. Migration v2

```sql
CREATE TABLE scheduled_task_runs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  task_id TEXT NOT NULL CHECK (length(trim(task_id)) > 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  trigger TEXT CHECK (trigger IS NULL OR trigger IN ('schedule', 'manual')),
  input_content TEXT,
  ai_result TEXT,
  result TEXT,
  error_message TEXT,
  warning TEXT,
  session_id TEXT,
  scheduled_at TEXT,
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  finished_at TEXT,
  duration_ms INTEGER CHECK (
    duration_ms IS NULL OR
    (typeof(duration_ms) = 'integer' AND duration_ms >= 0)
  ),
  agent_id TEXT,
  agent_label TEXT,
  agent_snapshot_json TEXT CHECK (
    agent_snapshot_json IS NULL OR json_valid(agent_snapshot_json)
  )
);
```

索引固定为：

```sql
(task_id, started_at DESC, id DESC)
(started_at DESC, id DESC)
(status, started_at DESC, id DESC)
(trigger, started_at DESC, id DESC)
```

`task_id` 是逻辑外键，不声明真实 SQLite foreign key。原因是 F3 没有 SQLite scheduled tasks 主表；风险是孤立 run 不会被数据库自动阻止或级联清理，调用方必须显式使用 `deleteByTask()`，后续切换前应补完整性扫描与修复策略。

## 3. Repository API

```js
const repository = createScheduledTaskRunsRepository(storageHandle)
```

工厂可注入 F2 受控 storage handle；省略时在**调用工厂时**读取 `getSqliteStorage()`。模块 import 不访问未初始化的全局 storage。

同步 API：

- `create(taskId, run)`
- `update(id, patch)`
- `get(id)`
- `listByTask(taskId, { limit, offset })`
- `list({ taskId, status, trigger, startedFrom, startedTo, keyword, page, pageSize })`
- `count(filters)`
- `delete(id)`
- `deleteByTask(taskId)`
- `prune(taskId, limit)`

`MAX_SCHEDULED_TASK_RUNS_PER_TASK = 200` 对外导出。`create()` 在一个 SQLite immediate transaction 内完成插入和按 `started_at DESC, id DESC` 裁剪，任务之间互不影响。

## 4. 对象映射与更新语义

- `create/get/update/listByTask` 返回对象不包含 `taskId`；全局 `list` 返回对象包含 `taskId`。
- nullable 普通可选字段在数据库为 `NULL` 时从输出省略。
- `agentId`、`agentLabel`、`agentSnapshot` 始终输出，缺失时为 `null`。
- `agentSnapshot` 作为不透明 JSON 保存与解析，未知字段原样 round-trip；repository 不定义其内部 schema。
- patch 中 `undefined` 表示不修改，`null` 表示清空 nullable 字段。
- `id`、`taskId`、`startedAt`、`trigger`、`scheduledAt` 不可更新；未知 patch 字段直接拒绝。
- repository 在执行 SQL 前验证非空字符串、枚举、nullable TEXT、非负整数和 snapshot JSON 基本类型。
- 校验错误与服务端日志不得拼接或记录 `inputContent`、`aiResult`、`result`、`errorMessage` 正文。

## 5. 查询、搜索与分页

全局排序固定为：

```sql
ORDER BY started_at DESC, id DESC
```

相同 `startedAt` 时以 `id DESC` 稳定排序。`list()` 在 deferred transaction 内读取匹配总数和当前页，避免两个独立读取之间出现视图漂移。分页边界兼容现有 scheduled task API：

- `page`：默认 `1`，最大 `100000`；
- `pageSize`：默认 `10`，最大 `100`；
- 非正整数回退默认值。

`keyword` 仅搜索 repository 自有字段：

- `input_content`
- `ai_result`
- `result`
- `error_message`

`%`、`_`、`\` 使用 `LIKE ... ESCAPE '\'` 正确转义，不作为通配符。现有 API 对 `taskTitle` 的搜索兼容留待 F4 服务层处理；F3 不冗余存储标题或任务元数据。

## 6. F5 后续状态

F5 migration v3 已将主键升级为 `(task_id,id)`，增加 `extra_json/legacy_json/source/updated_at` 和状态/锁表；单行 API 改为 `(taskId,runId)`，新增 full upsert/replaceAll、当前 task IDs 与 task-title keyword IDs SQL 过滤，并由 SQLite 承担 authoritative history 的 count/page。v2 内容作为迁移输入保留，本文 v2 DDL/API 仅用于说明升级来源。
