# `server/` — Node.js 后端服务器

后端使用原生 Node.js HTTP 服务器（无 Express 等框架依赖）。提供 REST API、WebSocket、SSE 事件流、Agent 管理和存储服务。

## 目录结构

```
server/
├── index.mjs                 # 服务器入口 (486 行)
├── agent-manager.mjs         # Agent 生命周期管理 (1350 行)
├── storage.mjs               # 文件存储层 (707 行)
├── skills.mjs                # Agent Skills 管理和加载 (553 行)
├── mcp/                      # MCP Client 配置、连接和工具适配
├── share-store.mjs           # 分享数据存储 (432 行)
├── session-utils.mjs         # 会话工具 (102 行)
├── system-prompt.mjs         # 系统提示词合成 (91 行)
├── project-config.mjs        # 项目配置管理 (162 行)
├── conversation-compaction.mjs # 对话历史压缩 (302 行)
├── custom-commands.mjs       # 自定义命令系统 (344 行)
├── reasoning-cache.mjs       # 推理内容缓存 (51 行)
├── restart-supervisor.mjs    # 服务重启监控脚本 (38 行)
├── lan-access-store.mjs      # LAN 共享访问令牌存储 (215 行)
├── terminal/                 # 本地交互式终端 PTY 会话管理
├── routes/                   # API 路由处理器
├── tools/                    # 工作区工具定义和实现
└── utils/                    # 工具函数
```

---

## 核心模块

### index.mjs (486 行)

**用途**: 服务器入口 / 主路由分发。启动 HTTP 服务器，注册所有 API 路由。

**启动参数**:
- `--dev`: 开发模式
- 环境变量: `QUICKFORGE_PORT`, `QUICKFORGE_HOST`, `QUICKFORGE_DATA_DIR`, `QUICKFORGE_WORKSPACE_DIR`, `QUICKFORGE_SHARE_LAN`, `QUICKFORGE_ALLOW_REMOTE`

**主要功能**:
- HTTP 路由分发（基于 `url.pathname` 匹配）
- 中间件：CORS、JSON 请求体大小限制
- `GET /api/health` — 健康检查
- 静态文件服务（`serveStatic`）
- SSE（`/api/agents/events`, `/api/agents/:sessionId/stream`）
- WebSocket 交互式终端（`/api/terminal/sessions/:id/ws`，仅 localhost）
- 启动时重置僵死任务状态
- 支持 LAN 共享（显示局域网 URL）

### agent-manager.mjs (1350 行)

**用途**: Agent 生命周期管理。后端最复杂的模块。

**功能**:
- Agent 创建（`createAgent`）：初始化 Agent 实例，配置工具和系统提示词
- 消息运行（`runPrompt`）：执行 AI 对话，管理消息历史
- SSE 事件流管理：向连接的客户端广播 Agent 事件
- 后台任务运行（`runTask` / `abortTask`）
- Agent 恢复（`restoreAgent`）：从持久化状态恢复会话
- 工具管理：基于 Skills 和 YOLO 模式动态构建工具列表
- 对话压缩（`compactConversation`）
- 自定义命令处理
- 工具权限检查
- 会话活动跟踪（`touchSession`）
- Agent 销毁和资源清理

### storage.mjs (707 行)

**用途**: 文件存储层。管理 JSON 文件的读写、存储布局迁移。

**存储位置**: `~/.quickforge/`

**目录结构**:
```
~/.quickforge/
├── config/config.json     # 配置数据
├── storage/               # 会话数据和索引
│   ├── sessions/          # 按 scope/projectId 分桶的会话文件
│   ├── sessions-metadata/ # 会话元数据索引
│   └── shares/            # 分享数据
├── cache/                 # 缓存数据
└── logs/                  # 日志文件
```

**功能**:
- 存储布局迁移（v1 → v2）
- `readStore` / `writeStore` / `atomicUpdate` — 通用存储操作
- 会话分桶存储（按 scope 和 projectId）
- `readSessionStoreScoped` — 作用域会话查询
- 写操作的原子锁队列
- 目录大小计算

### skills.mjs (553 行)

**用途**: Agent Skills 的发现、加载和管理。

**搜索路径**:
1. `~/.quickforge/skills/` — 用户级全局 skills
2. `~/.agents/skills/` — 用户级共享 skills
3. `<workspace>/.ai/skills/` — 项目级 skills
4. 项目自带 bundled skills

**功能**:
- `listGlobalSkillSummaries()` / `listProjectSkillSummaries()` — 技能列表
- `loadSelectedGlobalSkills()` / `loadSelectedProjectSkills()` — 按选择加载
- `mergeSkills()` — 合并全局和项目 skills
- `readSkillResource()` — 读取技能资源文件
- Skill 验证（名称格式、目录结构）

### mcp/ — MCP Client 集成

**用途**: 管理全局 stdio MCP Server，并把外部 MCP tools 适配为 QuickForge Agent tools。

**核心文件**:
- `mcp/config.mjs` — MCP Server 配置读写和校验，配置存放在 `settings.mcpServers`；兼容 `mcpServers` JSON 导入、`type`/`transport` 和远程 `headers` 配置。
- `mcp/registry.mjs` — stdio/SSE/Streamable HTTP 连接生命周期、工具发现、工具调用转发、关闭清理。
- `routes/mcp.mjs` — `/api/mcp/servers`、`/api/mcp/config`、`/api/mcp/reconnect` 等管理接口。

**行为约束**:
- 当前支持 `stdio`、`sse` 和 Streamable HTTP (`http`) transport。
- MCP 工具注入时使用 `mcp__{serverName}__{toolName}` 命名空间，避免和内置工具重名。
- YOLO 关闭时，MCP 工具调用需要用户审批；YOLO 开启时允许直接调用。

### terminal/ — 本地交互式终端

**用途**: 基于 `node-pty` 管理多开终端会话，并通过 WebSocket 连接前端 `xterm.js` 面板。

**核心文件**:
- `terminal/terminal-manager.mjs` — PTY 创建、输入输出转发、resize、会话上限、空闲清理和关闭清理。
- `routes/terminal.mjs` — `/api/terminal/capabilities`、`/api/terminal/sessions` 和 `/api/terminal/sessions/:id/ws`。

**安全边界**:
- 终端接口强制仅允许 localhost 访问；LAN 分享和共享会话页面不能访问。
- 终端运行在本机用户权限下，不是沙箱；默认 cwd 为当前项目目录。
- `QUICKFORGE_TERMINAL=0` 可关闭终端，`QUICKFORGE_MAX_TERMINALS` 可调整最大会话数。

### share-store.mjs (432 行)

**用途**: 对话分享的持久化和访问控制。

**功能**:
- `createConversationShare()` — 创建分享
- `listConversationShares()` — 列出分享
- `revokeConversationShare()` — 撤销分享
- 密码哈希验证（scrypt）
- 令牌认证（7天有效期）
- 口令保护

### conversation-compaction.mjs (302 行)

**用途**: 对话历史压缩。使用 AI 将长对话压缩为精炼摘要。

### custom-commands.mjs (344 行)

**用途**: 自定义命令系统。从 `<workspace>/.ai/commands/` 和项目配置 `commandDir` 指向的一个或多个相对/绝对目录读取命令定义；同名命令由后面的配置目录覆盖前面的目录。

**功能**:
- `listProjectCommands()` — 列出命令
- `readProjectCommand()` — 读取命令详情
- `resolveCustomCommandInvocation()` — 解析命令调用
- `handleInternalCommand()` — 处理内置命令

### session-utils.mjs (102 行)

会话工具函数：构建系统提示词、生成会话标题。

### system-prompt.mjs (91 行)

合成系统提示词。将基础提示词、用户指令、项目指令和 Skills 目录组装成完整的系统提示词。

### project-config.mjs (162 行)

项目配置管理（在 `config/config.json` 的 `projects` 数组中）。

### reasoning-cache.mjs (51 行)

缓存 LLM 推理过程内容 (reasoning_content)，在流式推理中恢复。

### restart-supervisor.mjs (38 行)

分离进程，用于重启时保证旧进程退出前新进程已就绪。

### lan-access-store.mjs (215 行)

**用途**: LAN 共享访问令牌的持久化存储和验证。

**功能**:
- `updateLanAccessSettings()` — 更新 LAN 共享设置（启用/禁用、密码）
- `issueLanAccessToken()` — 签发访问令牌（带 TTL）
- `readLanAccessStatus()` — 读取 LAN 共享状态
- `revokeLanAccessTokens()` — 撤销所有令牌
- 密码哈希存储（scrypt）
- 令牌数量上限保护（100 个）

---

## API 路由 (routes/)

参见 [routes/ 文档](routes/)。

## 工作区工具 (tools/)

参见 [tools/ 文档](tools/)。

## 工具函数 (utils/)

参见 [utils/ 文档](utils/)。
