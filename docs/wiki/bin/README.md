# `bin/` — CLI 入口

CLI 启动脚本，注册为 `quickforge` 和 `qf` 命令。

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [quickforge.mjs](quickforge.mjs) | 主 CLI 入口 | 247 |

---

## `quickforge.mjs`

- **路径**: `bin/quickforge.mjs`
- **行数**: 247
- **功能**: CLI 入口点，管理 QuickForge 服务的启动/停止/重启。

### 核心功能

| 函数 | 说明 |
|------|------|
| `start()` | 启动后端服务进程，写入 PID 文件，等待端口就绪后打开浏览器 |
| `stop()` | 读取 PID 文件，发送 SIGTERM 信号停止服务进程 |
| `restart()` | 先后调用 `stop()` 和 `start()` 实现重启 |
| `status()` | 检查服务进程是否在运行中 |
| `version()` | 显示当前安装版本、包名和 Node.js 版本 |
| `check-update()` | 检查 npm registry 上是否有新版本，并提示升级命令 |

### 常用命令

| 命令 | 说明 |
|------|------|
| `qf` / `quickforge` | 启动后台服务 |
| `qf stop` | 停止后台服务 |
| `qf restart` | 重启后台服务 |
| `qf status` | 查看服务状态 |
| `qf logs` | 查看当天服务日志 |
| `qf --version` / `qf -v` / `qf version` | 显示当前安装版本 |
| `qf check-update` | 检查 npm 上是否有新版本，不自动安装 |
| `qf update` | 从 npm 下载安装最新版本 |

### 启动流程

1. 解析命令行参数 (`start` / `stop` / `restart` / `status` / `logs` / `version` / `check-update` / `update` / `help`)
2. `start` 时派生 `server/index.mjs` 子进程
3. 写入 PID 到 `~/.quickforge/quickforge.pid`
4. 轮询等待服务端口 (默认 32176) 就绪
5. 自动打开浏览器到 `http://127.0.0.1:5176`

### 环境变量

- `QUICKFORGE_DATA_DIR` — 数据目录，默认 `~/.quickforge`
- `QUICKFORGE_PORT` — 服务端口，默认 32176
- `QUICKFORGE_HOST` — 绑定地址，默认 `127.0.0.1`
- `QUICKFORGE_VITE_PORT` — Vite 端口，默认 5176
