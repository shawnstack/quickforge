# 会话存储故障自救 Runbook（一页式）

> 适用场景：QuickForge 启动失败，错误页/日志中出现 startupError（完整性校验失败、恢复计划异常、cutover 反复失败等 fail-closed 场景）。
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
- 降级成功后可以正常启动使用，后续版本升级会重新走 cutover 迁移。

## 第 5 步：仍无法恢复

保留以下现场信息再寻求支持（不要重装/清目录）：

1. 启动错误原文（错误页上的 startupError 全文）；
2. 第 1 步 dry-run 的完整输出；
3. 第 2 步导出的备份文件；
4. `~/.quickforge/logs/` 下最近的服务日志。

## 附：相关机制索引

- 维护窗口与启动三态：`server/startup-state.mjs`、[`startup-maintenance-window` 设计](./session-storage-current-architecture.zh-CN.md) §6；
- 备份/恢复/降级工具完整清单：[`session-storage-current-architecture.zh-CN.md`](./session-storage-current-architecture.zh-CN.md) §7；
- cutover 与恢复计划设计细节：[`session-state-transactional-storage.zh-CN.md`](./session-state-transactional-storage.zh-CN.md)。
