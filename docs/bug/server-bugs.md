# 后端 Bug (server/)

审查日期：2026-05-29  
处理分支：`fix/triage-docs-bugs`

本文件仅保留源码核对后仍需要修复或后续专项确认的问题；误判、过时记录、产品设计选择和纯维护性建议已删除。

## 已在本分支修复

| # | 文件 | 处理 |
|---|------|------|
| CRIT-2 | `server/terminal/terminal-manager.mjs` | 为终端 WebSocket 客户端添加 `error` 处理，并对发送失败做日志记录 |
| CRIT-4 | `server/routes/terminal.mjs`, `server/index.mjs` | WebSocket upgrade 拒绝路径统一消费 socket error，写响应失败时安全销毁 socket |
| CRIT-5 | `server/index.mjs` | 为 Vite 子进程添加 `error` 事件处理 |
| HIGH-5 | `server/agent-manager.mjs` | `destroyAgent` 清理并 reject 待处理 tool/auto-compact approvals |
| HIGH-8 | `server/routes/lan-access.mjs` | 为 LAN access 失败尝试 Map 添加过期清理 |
| HIGH-9 | `server/mcp/registry.mjs` | `onclose` 不再覆盖已记录的 MCP error 状态 |
| HIGH-10 | `server/index.mjs` | 信号处理包装 async shutdown，捕获 Promise rejection |
| HIGH-11 | `server/mcp/registry.mjs` | MCP 连接失败后保留冷却期，后续 refresh 可重试 |
| MED-7 | `server/utils/response.mjs` | `sendError` 在 headers 已发送时安全结束响应，避免二次写头 |
| MED-11 | `server/storage.mjs` | 日志清理仅在 `unlink` 成功后减少 `totalSize` |
| LOW-2 | `server/system-prompt.mjs` | 统一 skill/subagent `allowedTools` 字符串化逻辑 |
| LOW-3 | `server/agent-manager.mjs` | 预声明 `session`，降低 `onPayload` 闭包 TDZ 脆弱性 |

## 保留：后续专项确认 / 修复

### CRIT-1: terminal-manager — pty 进程缺少可靠错误处理

**文件:** `server/terminal/terminal-manager.mjs`

当前 `node-pty` 会话只处理 `onData()` 和 `onExit()`。是否存在稳定的 `error` 事件 API 需要结合当前 `node-pty` 版本确认，避免添加不存在的接口导致运行时问题。

**建议:** 单独确认 `node-pty` API 与跨平台行为，再补充错误处理和手动终端 smoke test。

---

### CRIT-3: terminal-manager — pty kill 无强制回退

**文件:** `server/terminal/terminal-manager.mjs`

当前销毁终端会话时直接调用 `session.pty.kill()`。两阶段 kill（SIGHUP/TERM 后 SIGKILL）可能更稳，但需要确认 Windows 和 `node-pty` signal 参数兼容性。

**建议:** 作为终端生命周期专项处理，覆盖 Windows/macOS/Linux。

---

### HIGH-1: storage.mjs — `writeSessionStore` 可能覆盖未见桶文件

**文件:** `server/storage.mjs`

涉及 session metadata 分桶写入，存在数据安全风险；修复需要加定向测试确认不会破坏现有写入语义。

**建议:** storage 专项中处理，覆盖跨 project/global metadata 写入。

---

### HIGH-2: storage.mjs — `writeSessionValues` 删除与写入顺序缺少失败回滚

**文件:** `server/storage.mjs`

属于故障原子性问题。调整写入/删除顺序需要验证索引缓存与删除语义。

**建议:** storage 专项中和 HIGH-1 一起处理。

---

### HIGH-3: storage.mjs — `migrateUnifiedConfig` TOCTOU 竞态

**文件:** `server/storage.mjs`

首次迁移路径存在并发重复迁移风险。需要确认 `ensureStorage()` 调用链和队列设计后修改。

**建议:** storage 专项中增加并发调用测试。

---

### HIGH-4: storage.mjs — `readStore` 不等待写队列

**文件:** `server/storage.mjs`

严格一致性上可能读到旧数据，但让读取进入写队列需要避免死锁与性能退化。

**建议:** storage 专项中明确一致性语义后处理。

---

### MED-4: MCP stderr listener 生命周期

**文件:** `server/mcp/registry.mjs`

关闭连接时 stderr listener 是否需要显式移除，取决于 transport close 是否释放底层 stream。

**建议:** MCP 生命周期专项中处理。

---

### MED-5: MCP shutdown 与 refresh 并发

**文件:** `server/mcp/registry.mjs`

关闭过程和刷新过程可能交错。低频但可在 MCP 生命周期专项中用单一互斥/状态机处理。

---

### MED-9: scheduled-tasks run history 内存分页

**文件:** `server/routes/scheduled-tasks.mjs`

大量运行记录下有性能和内存风险。

**建议:** 调度任务性能专项中处理，优先从存储层支持分页/索引。

---

### MED-10: 工具权限检查时序需确认

**文件:** `server/agent-manager.mjs`, `server/tools/index.mjs`

文档原始描述可能把“工具创建时”和“工具调用时”混淆。当前回调通常在工具调用时执行，届时 session 已入 map。

**建议:** 先补充调用时序验证，再决定是否需要改动。
