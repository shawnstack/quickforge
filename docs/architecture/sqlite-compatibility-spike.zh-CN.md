# SQLite 兼容性探针（F1）

## 范围

本探针用于在进入正式 SQLite 存储工作（F2）前，验证 QuickForge 当前开发运行时对内置 `node:sqlite` 的最低共同能力。它是独立开发脚本，不接入正式 server、desktop 或 CLI，不创建或迁移任何业务数据。

探针仅使用 Node 24 与 Electron 内置 Node 22 均提供的共同 API：

- `DatabaseSync`
- `exec()`
- `prepare()`
- statement 的 `run()` / `get()` / `all()`
- `close()`

不使用 `Session` 等仅部分运行时提供的 API。

## 已验证环境

2026-08-17 在 Windows 本机实测：

| 入口 | Node | Electron | SQLite | 结果 |
|------|------|----------|--------|------|
| 系统 Node | v24.12.0 | — | 3.50.4 | 通过 |
| Electron Run-as-Node | v22.22.1 | 39.8.10 | 3.51.2 | 通过 |

项目声明的最低 Node 版本仍是 `22.19.0`；该最低版本本身尚未实测。macOS、Linux 与 Electron 安装包成品也尚未实测。

## 验证项

`scripts/sqlite-compatibility-spike.mjs` 每次运行都会创建独立临时目录和文件数据库，结束后自动清理。它验证：

1. 基础 CRUD：插入、查询、更新、删除。
2. 显式事务：`BEGIN` 后插入，再以 `ROLLBACK` 确认数据未落库。
3. 文件库 WAL：`PRAGMA journal_mode = WAL` 返回 `wal`。
4. 忙等待：设置并读取 `PRAGMA busy_timeout = 5000`。
5. 双进程并发：
   - 子进程 A 执行 `BEGIN IMMEDIATE`、写入并发出明确 `locked` 信号；
   - 主进程收到 `locked` 后启动子进程 B，并等待其明确 `ready` 信号；
   - A 持锁一段时间后由主进程释放；
   - B 依靠 `busy_timeout` 等待锁，随后成功写入；
   - 最终验证写入顺序为 A、B，且 B 的写入耗时表明确实等待过锁。

主进程和 worker 均有硬超时；失败时会终止仍存活的子进程并清理临时目录。子进程使用 `spawn(..., { shell: false })`，Electron Run-as-Node 场景会继续传递 `ELECTRON_RUN_AS_NODE=1`。

## 使用

系统 Node：

```shell
node scripts/sqlite-compatibility-spike.mjs
```

Electron Run-as-Node（Windows cmd 示例）：

```bat
set ELECTRON_RUN_AS_NODE=1&& node_modules\.bin\electron.cmd scripts\sqlite-compatibility-spike.mjs
```

成功时 stdout 输出单行 JSON 摘要，包含 Node、Electron、SQLite 版本以及 CRUD、rollback、WAL、busy timeout、双进程并发和临时库清理结果；失败时 stderr 输出结构化错误并以非零状态退出。

运行时会出现 `ExperimentalWarning: SQLite is an experimental feature`。这是当前 Node/Electron 对 `node:sqlite` 的预期警告，不作为探针失败条件；但进入正式实现后仍需持续关注上游 API 稳定性。

## 打包边界

该探针、测试和本文档仅用于开发验证。当前 npm 发布白名单、runtime/offline 打包流程与 electron-builder 配置均不包含 `scripts/`、`tests/`、`docs/`，因此探针不会进入发布成品。本次未修改任何生成产物。

## 结论与进入 F2 的前提

当前 Windows 开发机上的系统 Node 与 Electron Run-as-Node 都通过共同 API、文件 WAL、busy timeout 和双进程锁等待验证，说明可继续设计 F2，但不能据此宣称所有受支持平台和最低 Node 版本已兼容。

进入 F2 前应满足：

1. 正式存储设计只依赖本探针覆盖的共同 API，或对新增 API 单独补充兼容验证。
2. 明确 schema、事务边界、并发/锁策略、备份恢复与 JSON 到 SQLite 的迁移/回滚方案。
3. 在 CI 或发布验证中补测最低 Node 22.19.0、macOS、Linux；安装包级 SQLite 接入前补做 Electron 成品验证。
4. 保持探针与正式存储隔离，F2 需独立评审后再接入 server/desktop/CLI，不能直接迁移业务数据。
