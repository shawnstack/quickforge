# 定时任务运行记录影子集成（F4）

> 状态：F4 已实现 hybrid 影子双写与完整性服务层；F5 已在其上完成 SQLite authoritative cutover。本文保留 F4 行为作为切换前/权威提交前失败回退说明，当前权威设计见 [`scheduled-task-runs-authoritative-cutover.zh-CN.md`](./scheduled-task-runs-authoritative-cutover.zh-CN.md)。

## 1. 范围

F4 增加：

- `server/scheduled-task-runs-service.mjs`：注入式影子同步、完整性读取、诊断；
- scheduled task 创建运行、中间补充、正常终态、异常终态、任务删除后的影子调用；
- `/api/scheduled-tasks/runs` 的 hybrid 完整性读取；
- 服务层、执行、删除、备份和 Electron Run-as-Node 回归。

F4 明确不做：

- 不迁移旧 JSON runs，不后台回填全量历史；
- 不删除或缩减 JSON `task.runs`；
- 不修改备份格式，不把 SQLite 文件或表加入备份；
- 不让 restore 依赖 SQLite；
- 不把 SQLite 设为唯一权威；
- 不将 MED-9 标记完成，因为 API 仍必须读取并验证完整 JSON 权威集合后才能分页。

## 2. 写入顺序与失败语义

所有调用点都先完成 JSON 原子提交，再从 `updateTask()` 返回的权威 task 中提取对应 run：

1. created running run；
2. resolved session/agent snapshot 更新；
3. normal terminal；
4. exception terminal；
5. JSON 删除任务成功后调用 `deleteByTask()`。

SQLite create/update/delete 是 best-effort。服务内部捕获 repository 失败，路由边界也防御 rejected Promise；失败不会改变任务执行结果、API 状态码或 JSON 内容。JSON 提交失败时不会调用影子写入。运行期间任务已被删除时，`updateTask()` 返回 null，服务不会创建孤立影子。

## 3. Ownership 与修复

进程内维护 `runId → taskId` ownership：

- created 或未拥有 run 时先尝试 create；成功后登记 ownership；
- owned run 才可 update；update patch 覆盖全部可更新字段，缺失 nullable 值显式写 null；
- early create 失败后，后续 resolved/terminal 会再次 create 当前完整权威 run；
- owned update 返回 null 时只补 create 一次；
- 全局 run ID 冲突时 create 失败，不会盲目 update 另一 task 的记录，只标记 dirty 并回退 JSON。

## 4. GET 完整性算法

服务可先分页读取 SQLite 候选（repository 每页最大 100），但随后必须成功读取 JSON 权威任务集合。JSON 读取失败会让请求失败；SQLite 读取失败则降级为 JSON-only。

合并规则：

- 复合键为 `(taskId, runId)`；
- 最终可见键集合严格来自当前 JSON task/runs；SQLite-only、已删除 task 和跨 task 冲突行均隐藏；
- 同键不一致时 JSON 胜出；一致时也直接展开 JSON 对象，保留其未知字段且不暴露 SQLite 独有字段；
- 同一 task 的重复 JSON run ID 保留首条；
- `taskId/taskTitle/scheduleRule/projectName` 始终来自当前 JSON task；
- keyword 兼容 `taskTitle/inputContent/aiResult/result/errorMessage`；
- status、trigger、时间、keyword、稳定排序、total 和分页全部在完整合并后执行；
- 排序为 `startedAt DESC, id DESC, taskId DESC`。

因此任何 SQLite 空、部分、陈旧、读取失败或孤立状态都不会直接出现在 API 中，也不会造成 JSON 权威记录缺失。

## 5. Diagnostics 与日志

`getDiagnostics()` 只返回进程内状态：

- `dirtyTaskIds`
- `dirtyRunIds`（taskId + runId）
- `ownedRunIds`（taskId + runId）
- `readDegraded`
- `lastFailureAt`
- `failureCounts`

不持久化“迁移完成”标记。失败日志只记录 operation、taskId、runId、phase、error name/code，不记录 input/result/error 正文或 agent snapshot。

## 6. F5 后续状态

F5 已完成这些门禁：migration v3 复合主键与状态/锁、逻辑 backup v1、JSON→SQLite count/digest cutover、pending/authoritative 崩溃恢复、authoritative runtime/API、restore 补偿与计划恢复、离线导出及降级流程。F4 hybrid 代码路径继续作为 `hybrid` phase 的安全回退；pending 提交后不会回退到 hybrid。
