# 会话存储故障自救 Runbook（一页式）

> **⚠ 存储 v2 修订（2026-08-19）**：会话域已完成存储 v2 重构，mirror/phase/cutover 链路已移除，会话域**恒为 SQLite authoritative**——本文的 phase fail-closed 路径已变：不再存在"降级回 JSON 权威"。SQLite 会话库损坏时的恢复路径为：① 用第 2 步导出的备份走 restore 流程；或 ② 删除库文件 `~/.quickforge/storage/quickforge.sqlite3`（连同 `-wal`/`-shm`）后重启——空库 + JSON 会话文件存在时启动链自动一次性重导（前提：重导前先按本文第 1/2 步确认备份在手）。`downgrade-session-state-v1.mjs` 现为纯导出工具（不再切相位）。现状见 [`session-storage-v2.zh-CN.md`](./session-storage-v2.zh-CN.md)。

> 适用场景：QuickForge 启动失败，错误页/日志中出现 startupError（完整性校验失败、恢复计划异常、cutover 反复失败等 fail-closed 场景），以及会话域后台迁移任务失败的判读（见「后台迁移失败」一节——该场景不阻塞业务，通常无需停机）。
> 原则：**先诊断、先备份，再修复；任何步骤都不要手动删除 `~/.quickforge/storage/` 下的文件。**

## 第 0 步：停止所有 QuickForge 进程

所有离线工具都要求独占数据目录（WAL 模式不允许多进程并发写）：

- 关闭 Desktop 窗口并在系统托盘退出；
- 关闭所有 `qf` / `quickforge` CLI 进程；
- 确认没有残留 node 进程占用数据目录。

## 第 1 步：离线诊断（只读，不改数据）

```bash
node server/maintenance/downgrade-session-state-v1.mjs --dry-run
```

- 输出 SQLite 中会话记录的完整性对拍结果（记录数、digest 校验、拆分会话重组校验）；
- 该命令只读，任何时候执行都安全。

## 第 2 步：导出权威备份（只读 SQLite，写新文件）

```bash
node server/maintenance/export-session-state-v1.mjs <输出路径.json>
```

- 从 SQLite 权威存储导出完整快照（含 `sessionState` 包络：phase/count/digest）；
- 导出成功即说明数据本体可读，后续任何恢复路径都有兜底。

## 第 3 步：按诊断结果选择恢复路径

| 诊断结果 | 恢复路径 |
|---|---|
| 完整性对拍通过，仅是启动链路异常（如恢复计划文件缺失/错位） | 备份已导出后，直接重试启动；恢复计划异常会在启动时按 plan 状态自动 roll-forward/rollback |
| 对拍发现少量记录损坏，其余完好 | 降级回 JSON 权威（见第 4 步），JSON mirror 保存着完整可降级形态 |
| SQLite 库整体不可读 | 降级回 JSON 权威（第 4 步）；若 JSON mirror 也不可用，用第 2 步导出的备份走 restore 流程 |

## 第 4 步：降级回 JSON 权威（最后的兜底）

```bash
# 先物化预览，确认 JSON 输出完整
node server/maintenance/downgrade-session-state-v1.mjs --commit
```

- `--commit` 会把 phase 置回 `json_authoritative`，之后启动走 JSON 权威路径（旧版本行为）；
- 工具内置对拍：检测到 JSON mirror 残缺会**拒绝**降级（fail-closed），此时回到第 2 步确认备份，并保留现场寻求支持；
- 降级成功后可以正常启动使用，后续版本升级会重新走会话域后台迁移（phase 为 `json_authoritative` 时自动触发，业务无感）。

## 第 5 步：仍无法恢复

保留以下现场信息再寻求支持（不要重装/清目录）：

1. 启动错误原文（错误页上的 startupError 全文）；
2. 第 1 步 dry-run 的完整输出；
3. 第 2 步导出的备份文件；
4. `~/.quickforge/logs/` 下最近的服务日志。

## 后台迁移失败（不阻塞业务，通常无需停机）

会话域 JSON→SQLite 迁移现为后台任务（phase 为 `json_authoritative`/`cutover_running` 时启动链自动触发）：任务失败**不影响业务读写 JSON、不产生 startupError、不阻塞 READY**。诊断入口：`GET /api/migration-status` 的 `domains.sessionState.background` 域（内存态快照，随进程存活；字段见设计文档 §6.2）。

| 现象（background 域） | 含义 | 处置 |
|---|---|---|
| `state:"failed"` + `failure:{stage,error}` | 任务整体失败，phase 仍为 `json_authoritative` | 查 `~/.quickforge/logs/` 中 `session.background_migration.task.failed`；通常直接重启进程即整任务幂等重试；反复失败再按第 1/2 步离线诊断（JSON 权威无损） |
| `state:"aborted"` + `reason:"lock-busy"`（附 `lockOwner`/`lockOwnerPid`/`lockFencing`） | 另一进程持有维护锁、正在迁移 | 无需处理；本进程重启后若锁空闲会接管迁移（同时确认是否误开了双进程） |
| `state:"aborted"` + `reason:"lock-lost"` | 迁移中维护锁丢失（如持锁进程崩溃后租约被接管） | 任务终止，phase 仍 `json_authoritative`；重启即重试 |
| `backup.state:"failed"`（任务继续运行） | idle 期备份有界重试耗尽 | 不影响切换一致性（切换由最终对拍保证）；可待下轮迁移重试或手动备份 |

## 附：相关机制索引

- 维护窗口与启动三态：`server/startup-state.mjs`、[`startup-maintenance-window` 设计](./session-storage-current-architecture.zh-CN.md) §6；
- 会话域后台迁移设计、进度字段与实施偏差：[`session-storage-background-migration-design.zh-CN.md`](./session-storage-background-migration-design.zh-CN.md)；
- 备份/恢复/降级工具完整清单：[`session-storage-current-architecture.zh-CN.md`](./session-storage-current-architecture.zh-CN.md) §7；
- cutover 与恢复计划设计细节：[`session-state-transactional-storage.zh-CN.md`](./session-state-transactional-storage.zh-CN.md)。
