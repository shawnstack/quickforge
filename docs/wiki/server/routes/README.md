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
| `agent-profiles.mjs` | 173 | Agent Profile 管理 API，支持 AI 填充基础定义 |
| `models.mjs` | 68 | 自定义模型连接测试 |
| `scheduled-tasks.mjs` | 949 | 定时任务管理，支持绑定 Agent Profile 与配置单任务执行模式 |
| `shares.mjs` | 90 | 分享管理 |
| `shared-conversation.mjs` | 404 | 共享会话查看 |
| `backup.mjs` | 395 | 数据备份和恢复 |
| `lan-access.mjs` | 201 | LAN 共享访问管理 |
| `instructions.mjs` | 20 | 系统提示词 |
| `system.mjs` | 81 | 系统状态、重启、关于信息和 npm 更新 |
| `workspace.mjs` | 296 | 工作区文件浏览、产物预览静态读取与 Git 变更检查 |
| `static.mjs` | 83 | 静态文件服务 |

---

## agent.mjs (374 行)

Agent 会话管理核心路由。

**主要端点**:
- `GET /api/agents` — 列出活跃会话
- `GET /api/agents/events` — 全局 SSE 事件流
- `GET /api/agents/:sessionId/stream` — 会话级 SSE 流
- `GET /api/agents/:sessionId/state` — 获取完整会话快照，用于初始化和异常恢复
- `GET /api/agents/:sessionId/status` — 获取轻量运行状态，用于 SSE 静默后的版本探测
- `HEAD /api/agents/:sessionId/stream` — 检查 SSE 可用性
- `POST /api/agents/:sessionId/prompt` — 发送消息
- `POST /api/agents/:sessionId/abort` — 中止运行
- `POST /api/agents/:sessionId/steer` — 引导 Agent
- `POST /api/agents/:sessionId/follow-up` — 后续处理
- `POST /api/agents/:sessionId/destroy` — 销毁 Agent
- `POST /api/agents/:sessionId/compact` — 压缩对话
- `POST /api/agents/:sessionId/access-mode` — 切换 Agent 权限模式（`default` / `full-access`）
- `POST /api/agents/:sessionId/yolo-mode` — 旧客户端兼容入口
- `PATCH /api/agents/:sessionId/model` — 更新模型
- `PATCH /api/agents/:sessionId/thinking` — 更新思考级别

## storage.mjs (151 行)

通用存储 CRUD 路由。

**主要端点**:
- `GET /api/storage/quota` — 存储配额和用量
- `GET|POST|DELETE /api/storage/:store/keys/:key` — 键值操作
- `GET /api/storage/:store/index/:indexName` — 索引查询（支持排序、分页、作用域过滤）

## project.mjs (192 行)

项目管理路由。

**主要端点**:
- `GET /api/project` — 获取活动项目和列表
- `GET /api/project/commands` — 获取项目自定义命令（含 name、description、argumentHint、allowEdit、allowCommands、relativePath、filePath、source、pluginName）
- `POST /api/project/select-directory` — 打开系统目录选择器
- `POST /api/project/path` — 按路径设置项目
- `POST /api/project/active` — 切换活动项目
- `PUT /api/project/:projectId/command-dir` — 保存项目自定义 command 目录，支持一行一个相对路径或绝对路径；读取命令时与默认 `.ai/commands` 合并
- `POST /api/project/:projectId/open-in-explorer` — 在系统资源管理器中打开项目根目录
- `POST /api/project/open-path` — 在系统资源管理器中打开任意目录（相对路径基于活动项目根解析）
- `POST /api/project/command` — 在活动项目的 `.ai/commands/` 下新建命令文件（带 frontmatter 模板，`flag:'wx'` 防覆盖）
- `PUT /api/project/reorder` — 按顺序重排项目列表
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
- 按 Agent 权限模式执行审批检查

## skills.mjs (191 行)

Skills 管理路由。

**主要端点**:
- `GET /api/skills?scope=global|project` — 获取技能列表
- `PUT /api/skills` — 更新已选技能
- 支持项目级技能发现

## agent-profiles.mjs (64 行)

Agent Profile 管理路由。

**主要端点**:
- `GET /api/agent-profiles` — 列出内置和自定义 Agent Profile。
- `POST /api/agent-profiles` — 创建自定义 Agent。
- `GET /api/agent-profiles/available-tools` — 获取第一阶段可配置的 workspace 工具列表。
- `POST /api/agent-profiles/ai-fill` — 使用默认模型生成 Agent 名称、显示名称、描述和系统提示词。
- `GET /api/agent-profiles/:id` — 获取单个 Agent。
- `PATCH|PUT /api/agent-profiles/:id` — 更新自定义 Agent。
- `DELETE /api/agent-profiles/:id` — 删除自定义 Agent。

内置 Agent 只读，不允许更新或删除。

## models.mjs (68 行)

自定义模型连接测试路由。

**主要端点**:
- `POST /api/models/test-connection` — 用当前配置（Base URL、API Key、模型 ID）发送最小请求验证连通性。请求体 `{ model, apiKey? }`（`model` 为完整模型对象，`apiKey` 可选，用于测试尚未保存的配置）；成功返回 `{ ok: true }`，失败返回 `{ ok: false, error }`。错误统一以 HTTP 200 返回，便于前端统一解析。

## scheduled-tasks.mjs (949 行)

定时任务管理（最复杂的路由模块）。

**主要端点**:
- `GET /api/scheduled-tasks` — 列出任务
- `GET /api/scheduled-tasks/runs` — 分页查询运行历史
- `POST /api/scheduled-tasks/parse` — 使用 AI 将自然语言解析为 cron 任务草稿
- `POST /api/scheduled-tasks` — 创建任务
- `PUT /api/scheduled-tasks/:id` — 更新任务
- `DELETE /api/scheduled-tasks/:id` — 删除任务
- `POST /api/scheduled-tasks/:id/pause` — 暂停任务
- `POST /api/scheduled-tasks/:id/resume` — 恢复任务
- `POST /api/scheduled-tasks/:id/run` — 手动触发任务

**调度引擎**: 内置调度器（`startScheduledTaskRunner`），支持 Cron 表达式和间隔调度。任务可通过 `agentId` 绑定 Agent Profile；执行时会追加 profile 系统提示词、限制工具白名单，并在运行历史中记录 `agentId`、`agentLabel` 和 `agentSnapshot`。每个任务可配置 `executionMode`：默认 `serial`，同一任务已有运行实例时跳过新的到期执行；`parallel` 允许同一任务重叠执行。不同任务之间始终并行触发。

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

## system.mjs (81 行)

**主要端点**:
- `GET /api/system/status` — 系统状态
- `GET /api/system/network` — 网络信息
- `GET /api/system/about` — 包名、版本、GitHub / homepage / issues 地址
- `GET /api/system/update/check` — 查询 npm 最新版本并返回是否可更新
- `POST /api/system/update` — 启动外部更新器执行一键更新（本机请求限定，需 `x-quickforge-action: update`）；接口返回 `202`、更新日志路径和旧 `bootId`，当前服务随后退出，`update-supervisor.mjs` 在外部执行 `npm install -g <package>@latest` 并自动重启服务
- `POST /api/system/restart` — 服务重启

## workspace.mjs (296 行)

Workspace Inspector 后端 API。

**主要端点**:
- `GET /api/workspace/tree?projectId=...` — 返回项目文件树，排除 `.git`、`node_modules`、构建产物和敏感文件
- `GET /api/workspace/file?projectId=...&path=...` — 安全读取 1MB 以内文本文件，返回 Monaco 语言标识
- `GET /api/workspace/preview/:projectId/*` — 安全读取项目内静态产物文件，供右侧 Artifact Preview iframe/img 加载 HTML、CSS、JS、图片等资源
- `GET /api/git/status?projectId=...` — 基于 `git status --porcelain=v1 -z` 返回工作区变更列表，并附加 `git diff HEAD --numstat` 的每个文件增删行数（`additions`/`deletions`）；未跟踪/新增文件按工作区文件行数估算，二进制文件不返回行数
- `GET /api/git/file-diff?projectId=...&path=...` — 返回单文件 `oldContent/newContent`，供 Monaco DiffEditor 展示

**安全约束**: 所有路径必须位于项目 workspace 内，阻止敏感文件、二进制文件和超大文件预览。

## static.mjs (83 行)

**用途**: 静态文件服务。从 `dist/` 目录提供 Vite 构建产物。
