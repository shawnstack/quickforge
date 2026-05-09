# `bin/` — CLI 启动脚本

**路径**: `bin/`

---

## quickforge.mjs (248 行)

**用途**: QuickForge CLI 入口。通过 `npm bin` 或 `npx quickforge` 调用。

**命令**:
```
quickforge [start|stop|restart|status|dev|help]
```

**功能**:
- `start` — 启动服务器（后台守护进程模式）
- `stop` — 停止服务器
- `restart` — 重启服务器
- `status` — 查看运行状态
- `dev` — 开发模式启动（前台 + 自动打开浏览器）
- 默认（无参数）— 等同于 `start`

**关键特性**:
- PID 文件管理（`~/.quickforge/quickforge.pid`）
- 日志文件自动轮转（按天）
- 进程存在性检查（`process.kill(pid, 0)`）
- Windows / Unix 跨平台兼容
- 子进程启动/退出状态码统一
