# 定时任务运行记录 SQLite 权威切换（F5）

> 状态：F5 将 scheduled task runs 从 F4 JSON-authoritative hybrid 安全切换为 SQLite authoritative。备份格式继续为 version 1；JSON `scheduled-tasks` 在权威模式仅保存任务 metadata。

## 1. Schema v3

migration v3 在单个 `BEGIN IMMEDIATE` 中重建 `scheduled_task_runs`：

- 主键改为 `(task_id, id)`，允许不同 task 使用相同 run ID；
- v2 影子行原样复制，标记 `source=v2_shadow`；
- 增加 `extra_json`、`legacy_json`、`source`、`updated_at`；
- 全局索引稳定排序为 `started_at DESC, id DESC, task_id DESC`；
- 增加 singleton `scheduled_runs_state` 和可过期恢复的 `scheduled_runs_maintenance_lock`。

状态机：

```text
hybrid -> cutover_running -> sqlite_authoritative_json_pending -> authoritative
   ^            |                         |
   +------------+                         +-- JSON 瘦身失败时下次重试
```

权威提交前失败会回到 `hybrid` 并保留诊断；提交 `sqlite_authoritative_json_pending` 后绝不回 hybrid。

## 2. Startup cutover

Server 在 SQLite 初始化后、HTTP listen 和 scheduled runner 启动前执行 coordinator：

1. 获取 SQLite 维护锁；cutover、online restore 与权威逻辑 backup 共用同一 singleton 锁。锁记录 owner PID、单调 fencing token、heartbeat/expires；持有者续租，只有租约过期且明确确认 PID 已死亡才允许新 fencing 接管，旧 owner 无法释放新租约。
2. 读取完整 JSON tasks/runs，校验 task ID、run 对象、同 task 重复 ID、status、startedAt。
3. 生成 canonical SHA-256 digest。
4. 在 `storage/backups/` 生成可重新读取验证的逻辑 backup v1，记录 run count/digest；不复制 live DB/WAL/SHM。
5. SQLite 事务 `replaceAll`，校验 count/digest，并提交 pending 状态。
6. 原子写 metadata-only JSON（删除 `runs`）；成功后进入 `authoritative`。

恢复规则：

- `cutover_running`：以 JSON 重新执行全量替换；
- `sqlite_authoritative_json_pending`：SQLite 已权威，只重试 JSON 瘦身；
- `authoritative`：执行 SQLite `quick_check`，如 JSON 意外仍含 runs 则只做瘦身，不覆盖 SQLite。

## 3. Runtime 与 API

- authoritative/pending 下 created run 先写 SQLite，再写 JSON active metadata；metadata 失败会删除刚创建的 run 并中止。
- resolved/terminal/exception 以 SQLite full upsert 为权威；终态 SQLite 失败不会返回伪成功。
- JSON metadata 更新失败只记录不含正文的诊断；不会把已成功写入的终态反向改写。
- hybrid 保留 JSON-first、SQLite best-effort 行为。
- scheduler 读取 metadata-only task，不 hydrate 历史。
- tasks CRUD/action 响应按需从 SQLite 补最近 5 条且不回写 JSON。
- history API 一次 repository SQL count/page/filter；只包含当前 task IDs，孤立行不计 total。keyword 为当前 task title 命中的 task IDs OR run 文本字段。
- scheduler 每个 tick 与每个新执行前检查本进程 gate 和 SQLite 持久化维护锁；维护期间 scheduled API 与含 scheduledTasks 的 backup export fail closed。
- restore 获取跨进程锁后设置 gate、暂停新 tick 并等待当前 tick 结束；只要 JSON `currentRunId/currentRunIds`、SQLite running row 或本进程 execution 任一存在，就明确返回 409，绝不执行 `replaceAll`。
- startup 在 runner 前修复无可恢复执行进程的历史 running：SQLite/JSON run 标记 failed，固定错误 `Interrupted by previous process shutdown`，补齐 finishedAt/duration，清理 task active metadata 并按现有 helper 重算 recurring nextRunAt，避免 serial 永久阻塞。
- 删除 task 在 authoritative 下先严格清理 SQLite；JSON 删除失败时按删除前逻辑快照补偿 runs。

## 4. Backup / restore

格式保持 `version: 1`：

- hybrid：直接导出 JSON runs；
- pending/authoritative：在共享维护锁内逻辑读取 SQLite，挂回 `scheduledTasks[taskId].runs`；repository 缺失、读取失败、分页/count/digest 不一致一律 fail closed，不返回 metadata-only；
- restore replace/merge 先在内存形成完整 target，再拆为 SQLite runs + metadata-only JSON；active runs 时返回 409；
- restore 计划状态为 `prepared/applying/target_applied` 时 startup roll-forward target，`compensating/compensation_failed` 时 rollback before；计划缺失字段或 before/target digest 不符会阻止启动；
- SQLite/JSON 应用失败先进入 compensating 并恢复 before。补偿失败保留 `compensation_failed` 计划、维护锁与 gate，runner 不会在不确定状态启动。

## 5. 离线导出与降级

停止所有 QuickForge 进程后运行：

```bash
node server/maintenance/export-scheduled-runs-v1.mjs <输出文件.json>
```

脚本不启动 Server/runner，先执行 SQLite `quick_check`，再按当前 phase 逻辑导出包含完整 runs 的 v1 backup；使用临时文件并在验证后 rename，失败不会留下部分输出。

降级到不支持 schema v3 的旧版：

1. 停止所有 QuickForge/桌面进程；
2. 用上述脚本导出 v1；
3. 将 `quickforge.sqlite3`、`quickforge.sqlite3-wal`、`quickforge.sqlite3-shm` 一并移动到隔离目录（不要只删主库）；
4. 启动旧版，让其新建 schema v2 库；
5. 从 UI/API 导入 v1 backup。

不提供 down migration，也不得运行中复制 live SQLite/WAL/SHM 作为业务备份。
