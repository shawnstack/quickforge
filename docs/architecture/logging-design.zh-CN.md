# 日志系统设计

> 状态：已实现（2026-05-11）

## 1. 架构概览

```
                    ┌─────────────────────┐
                    │   bin/quickforge.mjs │  CLI: qf logs [--json] [--level] [--grep]
                    └──────────┬──────────┘
                               │ tail -f + node transform
                               ▼
┌──────────────────────────────────────────────────────┐
│  ~/.quickforge/logs/server-YYYY-MM-DD.log            │
│  (JSON Lines, daily rotation)                        │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│  ~/.quickforge/logs/ai-http-YYYY-MM-DD.jsonl         │
│  (AI HTTP full request/response trace, opt-in)       │
└──────────────────────────────────────────────────────┘
          ▲                              ▲
          │ appendFile (buffered)        │
          │                              │
┌─────────┴──────────┐    ┌─────────────┴─────────────┐
│ server/utils/      │    │ src/lib/logger.ts          │
│ logger.mjs         │    │ (console with prefix)      │
│ (Node.js backend)  │    │ (React frontend)           │
└────────────────────┘    └───────────────────────────┘
```

## 2. 服务端日志 (`server/utils/logger.mjs`)

### 2.1 级别

| 级别 | 含义 | 生产默认 |
|------|------|----------|
| ERROR | 需人工介入 | 开启 |
| WARN | 异常但可恢复 | 开启 |
| INFO | 关键业务节点 | 开启 |
| DEBUG | 调试详情 | **关闭** |

通过环境变量控制：`QUICKFORGE_LOG_LEVEL=debug` 开启 DEBUG。

### 2.2 双通道输出

- **stderr**：人类可读格式
  ```
  2026-05-11T09:04:00.123Z [INFO] Server started port=32176
  ```
- **文件**：JSON Lines 格式（每天一个文件）
  ```json
  {"ts":"2026-05-11T09:04:00.123Z","level":"INFO","msg":"Server started","port":32176}
  ```

### 2.3 异步写入

使用 `fs.createWriteStream` + 5 秒缓冲 flush，不再每次 `appendFileSync` 阻塞事件循环。进程退出时 `flushLogger()` 确保不丢日志。

### 2.4 上下文追踪

```javascript
// 全局 logger
logger.info('Server started', { port })

// HTTP 请求级（自动注入 reqId）
// server/index.mjs 生成 reqId = randomUUID().slice(0,8)
// 日志自动附带 {"reqId":"a1b2c3d4"}

// Session 级
logger.info(`Agent prompt error`, err, { sessionId })
```

`logger.child({ key: val })` 创建带固定上下文的子 logger。

### 2.5 日志轮转与清理

- **按天切割**：文件名 `server-YYYY-MM-DD.log`，跨天自动切换
- **保留 7 天**：`ensureStorage()` 启动时清理超过 7 天的日志
- **总大小上限 100MB**：超出时从最旧文件开始删除

### 2.6 AI HTTP 完整请求/响应日志

`server/ai-http-logger.mjs` 提供可选的 AI HTTP 诊断日志。通过 `QUICKFORGE_AI_HTTP_LOG=1` 开启后，会拦截 QuickForge 发起的 AI 模型请求，并按天写入独立文件：

```text
~/.quickforge/logs/ai-http-YYYY-MM-DD.jsonl
```

日志为 JSON Lines，每个 HTTP 请求通常包含：

- `ai_http_request`：真实 fetch URL、method、headers、body
- `ai_http_response`：HTTP status、headers、完整响应 body
- `ai_http_error` / `ai_http_response_capture_error`：请求或响应体捕获失败时的错误

该功能用于本地诊断，默认关闭。开启后日志可能包含 API Key、系统提示词、用户输入、项目源码片段、工具结果和模型返回内容，请勿分享或上传这些日志。

## 3. 前端日志 (`src/lib/logger.ts`)

```typescript
import { logger } from '@/lib/logger'

logger.error('Failed to sync sessions:', error)
logger.warn('Deprecated API used', { api: '/v1/old' })
logger.info('Model switched', { from: 'gpt-4', to: 'claude-4' })
logger.debug('SSE event received', { type: event.type })
```

- 统一前缀 `[QuickForge]`
- DEBUG 级别通过 `localStorage.quickforge_debug=1` 开启
- Error 对象自动提取 `.stack`
- 输出到浏览器 `console`

## 4. CLI (`qf logs`)

```bash
qf logs                    # 人类可读格式，实时 tail
qf logs --json             # JSON Lines 原始格式
qf logs --level warn       # 只看 WARN 及以上
qf logs --grep sessionId=abc123  # 按关键字过滤
```

## 5. 关键埋点

| 位置 | 日志内容 | 级别 |
|------|----------|------|
| HTTP 请求完成 | method, url, status, durationMs, reqId | INFO |
| HTTP 请求异常 | error.message, stack, reqId | ERROR |
| Session 创建/销毁 | sessionId, scope, projectId | INFO |
| Agent prompt 错误 | sessionId, error.stack | ERROR |
| Title 生成失败 | sessionId, error.message | WARN |
| Session 恢复/持久化失败 | sessionId, error | ERROR |
| 定时任务执行/失败 | taskId | INFO/ERROR |
| 服务启动/关闭 | port, host, signal | INFO |
| 重启请求 | supervisorPid | INFO |
| ErrorBoundary 捕获 | error.message, componentStack | ERROR |

## 6. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `QUICKFORGE_LOG_LEVEL` | `info` | 最低日志级别 (error/warn/info/debug) |
| `QUICKFORGE_AI_HTTP_LOG` | `off` | 设置为 `1`/`true`/`full` 时开启 AI HTTP 完整请求/响应诊断日志，写入 `logs/ai-http-YYYY-MM-DD.jsonl` |
| `QUICKFORGE_DATA_DIR` | `~/.quickforge` | 数据根目录，日志在 `$DATA_DIR/logs/` |

## 7. 变更摘要

| 文件 | 变更 |
|------|------|
| `server/utils/logger.mjs` | 重写：DEBUG 级别、JSON Lines、异步 buffer、child()、flushLogger() |
| `server/ai-http-logger.mjs` | 新增：可选 AI HTTP 完整请求/响应诊断日志 |
| `server/index.mjs` | 注入 reqId、SIGTERM 时 flush，启动 AI HTTP 日志拦截器 |
| `server/agent-manager.mjs` | console.error→logger.error、结构化 sessionId，接入 AI HTTP 日志包装 stream |
| `server/conversation-compaction.mjs` | 接入 AI HTTP 日志包装 stream，标记 compact 请求 |
| `server/storage.mjs` | 新增 `cleanOldLogs()`，启动时清理过期日志 |
| `src/lib/logger.ts` | **新建**：前端统一 logger |
| `src/**/*.ts(x)` | 14 个文件，console→logger 替换 |
| `bin/quickforge.mjs` | `logs` 命令支持 --json/--level/--grep |
| `docs/architecture/logging-design.md` | **新建**：本文档 |
