# `server/routes/` — API 路由处理器

每个文件处理一组相关 API 端点。路由在 `server/index.mjs` 中分发。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `agent.mjs` | 374 | Agent 会话管理、消息流式处理 |
| `storage.mjs` | 151 | 存储 CRUD 操作 |
| `project.mjs` | 106 | 项目管理 |
| `filesystem.mjs` | 87 | 文件系统浏览 |
| `tools.mjs` | 82 | 工具定义和执行 |
| `skills.mjs` | 191 | Skills 管理 |
| `scheduled-tasks.mjs` | 853 | 定时任务管理 |
| `shares.mjs` | 90 | 分享管理 |
| `shared-conversation.mjs` | 404 | 共享会话查看 |
| `backup.mjs` | 395 | 数据备份和恢复 |
| `lan-access.mjs` | 201 | LAN 共享访问管理 |
| `instructions.mjs` | 20 | 系统提示词 |
| `system.mjs` | 35 | 系统状态和重启 |
| `static.mjs` | 83 | 静态文件服务 |

---

## agent.mjs (374 行)

Agent 会话管理核心路由。

**主要端点**:
- `GET /api/agents` — 列出活跃会话
- `GET /api/agents/events` — 全局 SSE 事件流
- `GET /api/agents/:sessionId/stream` — 会话级 SSE 流
- `HEAD /api/agents/:sessionId/stream` — 检查 SSE 可用性
- `POST /api/agents/:sessionId/prompt` — 发送消息
- `POST /api/agents/:sessionId/abort` — 中止运行
- `POST /api/agents/:sessionId/steer` — 引导 Agent
- `POST /api/agents/:sessionId/follow-up` — 后续处理
- `POST /api/agents/:sessionId/destroy` — 销毁 Agent
- `POST /api/agents/:sessionId/compact` — 压缩对话
- `PATCH /api/agents/:sessionId/yolo` — 切换 YOLO 模式
- `PATCH /api/agents/:sessionId/model` — 更新模型
- `PATCH /api/agents/:sessionId/thinking` — 更新思考级别

## storage.mjs (151 行)

通用存储 CRUD 路由。

**主要端点**:
- `GET /api/storage/quota` — 存储配额和用量
- `GET|POST|DELETE /api/storage/:store/keys/:key` — 键值操作
- `GET /api/storage/:store/index/:indexName` — 索引查询（支持排序、分页、作用域过滤）

## project.mjs (106 行)

项目管理路由。

**主要端点**:
- `GET /api/project` — 获取活动项目和列表
- `GET /api/project/commands` — 获取项目自定义命令
- `POST /api/project/select-directory` — 打开系统目录选择器
- `POST /api/project/path` — 按路径设置项目
- `POST /api/project/active` — 切换活动项目
- `DELETE /api/project/:projectId` — 删除项目

## filesystem.mjs (87 行)

文件系统浏览路由（供前端目录选择器使用）。

**主要端点**:
- `GET /api/filesystem/roots` — 获取文件系统根
- `GET /api/filesystem/list?path=...` — 列出目录内容

## tools.mjs (82 行)

工具定义和执行路由。

**主要端点**:
- `GET /api/tools` — 获取工具定义列表
- `POST /api/tools/:name` — 执行全局工具
- `POST /api/projects/:projectId/tools/:name` — 在项目上下文中执行工具
- 强制执行 YOLO 模式检查

## skills.mjs (191 行)

Skills 管理路由。

**主要端点**:
- `GET /api/skills?scope=global|project` — 获取技能列表
- `PUT /api/skills` — 更新已选技能
- 支持项目级技能发现

## scheduled-tasks.mjs (853 行)

定时任务管理（最复杂的路由模块）。

**主要端点**:
- `GET /api/scheduled-tasks` — 列出任务
- `POST /api/scheduled-tasks` — 创建任务
- `PUT /api/scheduled-tasks/:id` — 更新任务
- `DELETE /api/scheduled-tasks/:id` — 删除任务
- `POST /api/scheduled-tasks/:id/toggle` — 暂停/启用
- `GET /api/scheduled-tasks/:id/runs` — 运行历史
- `POST /api/scheduled-tasks/:id/abort-run` — 中止运行

**调度引擎**: 内置调度器（`startScheduledTaskRunner`），支持 Cron 表达式和间隔调度。

## shares.mjs (90 行)

分享管理路由。

**主要端点**:
- `GET /api/shares` — 列出会话的分享
- `POST /api/shares` — 创建分享

## shared-conversation.mjs (404 行)

共享会话查看和交互路由。

**主要端点**:
- `GET /api/shared/:shareId` — 获取共享会话详情
- `POST /api/shared/:shareId/unlock` — 密码解锁
- `GET /api/shared/:shareId/providers` — 获取共享模型供应商
- `POST /api/shared/:shareId/stream` — SSE 流式交互
- `POST /api/shared/:shareId/prompt` — 发送消息
- `POST /api/shared/:shareId/rollback` — 回滚消息

## backup.mjs (395 行)

数据备份和恢复路由。

**主要端点**:
- `GET /api/backup/export?scope=all|config|sessions&includeSecrets=0|1` — 导出备份，默认不包含 API Key
- `POST /api/backup/inspect` — 检查备份文件并返回导入预览
- `POST /api/backup/import` — 导入备份；请求体可为备份本身，或 `{ "backup": <备份>, "sections": [...] }` 选择性恢复

## lan-access.mjs (201 行)

LAN 共享访问管理路由。

**主要端点**:
- `POST /api/lan-access/settings` — 更新 LAN 共享设置（密码、启用状态）
- `GET /api/lan-access/status` — 获取 LAN 共享状态
- `POST /api/lan-access/auth` — 密码认证获取令牌
- `POST /api/lan-access/revoke` — 撤销所有令牌
- 支持暴力破解保护（5 次失败后锁定 5 分钟）

## instructions.mjs (20 行)

**用途**: 提供系统提示词 API。返回基础提示词、指令和 Skills 目录。

## system.mjs (35 行)

**主要端点**:
- `GET /api/system/status` — 系统状态
- `GET /api/system/network` — 网络信息
- `POST /api/system/restart` — 服务重启

## static.mjs (83 行)

**用途**: 静态文件服务。从 `dist/` 目录提供 Vite 构建产物。
