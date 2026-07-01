# `bin/` — CLI 入口

CLI 启动脚本，注册为 `quickforge` 和 `qf` 命令。

## 文件清单

| 文件 | 说明 |
|------|------|
| [quickforge.mjs](../../bin/quickforge.mjs) | 主 CLI 入口 |

---

## `quickforge.mjs`

- **路径**: `bin/quickforge.mjs`
- **功能**: CLI 入口点，管理 QuickForge 服务的启动/停止/重启。

### 核心功能

| 函数 | 说明 |
|------|------|
| `cmdStart()` / `startService()` | 启动后端服务进程，等待 `/api/health` 就绪后写入 PID 文件 |
| `cmdStop()` / `stopResolvedService()` | 优先通过 `/api/health` 定位真实服务，回退 PID 文件，发送 SIGTERM/SIGKILL 停止服务 |
| `cmdRestart()` | 打印重启前后 `pid`/`bootId`/`startedAt`，停止真实服务后启动并校验新服务 |
| `cmdStatus()` | 通过 `/api/health` 检查服务状态，并在需要时修复 PID 文件 |
| `cmdLogs()` | 查看当天服务日志，支持 JSON、level、grep 过滤 |
| `cmdAcp()` | 以前台 stdio 方式运行 ACP AgentSideConnection，供 ACP Client/IDE 启动 |
| `cmdVersion()` | 显示当前安装版本、包名和 Node.js 版本 |
| `cmdCheckUpdate()` | 检查 npm registry 上是否有新版本，并提示升级命令 |
| `cmdUpdate()` | 通过 npm 全局安装最新版本 |

### 常用命令

| 命令 | 说明 |
|------|------|
| `qf` / `quickforge` | 启动后台服务 |
| `qf stop` | 停止后台服务 |
| `qf restart` | 重启后台服务并校验新实例 |
| `qf status` | 查看服务状态 |
| `qf logs` | 查看当天服务日志 |
| `qf acp` | 通过 stdio 运行 QuickForge ACP Agent，stdout 保留给 ACP 协议 |
| `qf --version` / `qf -v` / `qf version` | 显示当前安装版本 |
| `qf check-update` | 检查 npm 上是否有新版本，不自动安装 |
| `qf update` | 从 npm 下载安装最新版本（终端手动更新入口，设置页更新另走外部更新器并自动重启服务） |

### 启动与重启流程

1. 解析命令行参数 (`start` / `stop` / `restart` / `status` / `logs` / `acp` / `version` / `check-update` / `update` / `help`)。
2. `start` 时派生 `server/index.mjs` 子进程。
3. 轮询 `http://127.0.0.1:<port>/api/health`，确认子进程 PID、`bootId` 和服务就绪。
4. 就绪后写入 PID 到 `~/.quickforge/quickforge.pid`，并打印 URL、日志路径等信息。
5. `restart` 时先记录旧 `pid`/`bootId`/`startedAt`，停止 `/api/health` 返回的真实服务（PID 文件仅作回退），再启动并校验新服务；若前后 `pid`/`bootId` 没变会给出警告。

### 环境变量

- `QUICKFORGE_DATA_DIR` — 数据目录，默认 `~/.quickforge`
- `QUICKFORGE_PORT` — 生产模式服务端口，默认 `5176`
- `QUICKFORGE_HOST` — 绑定地址，默认 `0.0.0.0`
- `QUICKFORGE_SHARE_LAN` — 是否启用 LAN 分享模式，默认启用
- `QUICKFORGE_ALLOW_REMOTE` — 允许显式远程绑定
- `QUICKFORGE_NO_OPEN` — 不自动打开浏览器
