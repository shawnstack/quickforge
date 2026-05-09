# `server/routes/` — API 路由处理

各路由模块处理对应的 `/api/*` 路径请求。

## 文件清单

| 文件 | 说明 |
|------|------|
| [agent.mjs](agent.mjs.md) | Agent 管理 API (创建、运行、中止、SSE) |
| [storage.mjs](storage.mjs.md) | 存储读写 API (KV 存储操作) |
| [project.mjs](project.mjs.md) | 项目管理 API |
| [filesystem.mjs](filesystem.mjs.md) | 文件系统操作 API (目录列表) |
| [tools.mjs](tools.mjs.md) | 工具定义 API |
| [instructions.mjs](instructions.mjs.md) | 指令/Skills API |
| [skills.mjs](skills.mjs.md) | Skills 查询/保存 API |
| [scheduled-tasks.mjs](scheduled-tasks.mjs.md) | 定时任务管理 API |
| [backup.mjs](backup.mjs.md) | 数据备份/恢复 API |
| [system.mjs](system.mjs.md) | 系统信息 API (状态、重启) |
| [shares.mjs](shares.mjs.md) | 对话分享管理 API |
| [shared-conversation.mjs](shared-conversation.mjs.md) | 分享对话读取 API |
| [static.mjs](static.mjs.md) | 静态文件服务 API |

---

## 各路由详情

### `agent.mjs` (333 行)

- `GET /api/agents` — 列出活跃会话
- `POST /api/agents` — 创建新 Agent
- `POST /api/agents/:id/run` — 运行 Prompt
- `POST /api/agents/:id/abort` — 中止运行
- `POST /api/agents/:id/steer` — 引导 Agent
- `POST /api/agents/:id/follow-up` — 后续对话
- `GET /api/agents/:id/sse` — SSE 事件流
- `GET /api/agents/:id/state` — 获取会话状态
- `GET /api/agents/:id/destroy` — 销毁 Agent
- `POST /api/agents/:id/restore` — 恢复 Agent

### `storage.mjs` (152 行)

- `GET /api/storage/quota` — 存储配额/用量
- `GET /api/storage/:store/keys` — 列出键
- `GET /api/storage/:store/:key` — 读取值
- `POST /api/storage/:store/:key` — 写入值
- `DELETE /api/storage/:store/:key` — 删除值

### `project.mjs` (135 行)

- `GET /api/project` — 获取项目列表和活跃项目
- `POST /api/project/active` — 切换活跃项目
- `POST /api/projects` — 创建新项目
- `DELETE /api/projects/:id` — 删除项目
- `PUT /api/projects/:id` — 更新项目

### `filesystem.mjs` (100 行)

- `GET /api/fs/roots` — 列出文件系统根目录
- `POST /api/fs/list` — 列出目录内容
- `POST /api/fs/resolve` — 解析路径 (用于目录选择器)

### `tools.mjs` (82 行)

- `GET /api/tools` — 获取可用工具定义列表
- `POST /api/tools` — 执行工具调用 (REST 方式)

### `instructions.mjs` (20 行)

- `GET /api/instructions` — 获取指令/Skills 配置 (global + project)

### `skills.mjs` (90 行)

- `GET /api/skills` — 获取可用 Skills 列表
- `POST /api/skills/save` — 保存 Skills 选择

### `scheduled-tasks.mjs` (803 行)

- `GET /api/scheduled-tasks` — 列出定时任务
- `POST /api/scheduled-tasks` — 创建定时任务
- `PUT /api/scheduled-tasks/:id` — 更新定时任务
- `DELETE /api/scheduled-tasks/:id` — 删除定时任务
- `POST /api/scheduled-tasks/:id/run` — 手动触发执行
- 内置 Cron 调度器 (30 秒检查间隔)
- 支持类型: once / daily / weekly / monthly / interval / cron

### `backup.mjs` (260 行)

- `GET /api/backup/export` — 导出备份 (all / config / sessions)
- `POST /api/backup/import` — 导入备份 (含安全备份)
- `GET /api/backup/list` — 列出可用备份文件

### `system.mjs` (28 行)

- `GET /api/system/status` — 获取服务状态 (PID、启动时间、数据目录、工作区等)
- `POST /api/system/restart` — 重启服务

### `shares.mjs` (85 行)

- `GET /api/shares` — 列出分享
- `POST /api/shares` — 创建分享
- `PUT /api/shares/:id` — 更新分享
- `DELETE /api/shares/:id` — 撤销分享

### `shared-conversation.mjs` (400 行)

- `GET /api/shared-conversation/:shareToken` — 读取分享对话
- `POST /api/shared-conversation/:shareToken/verify-password` — 验证密码
- SSE 流式读取分享对话内容

### `static.mjs` (58 行)

- 静态文件服务 (用于生产模式)
- 支持 SPA 路由回退 (fallback to `index.html`)
- 支持 `If-Modified-Since` 缓存
