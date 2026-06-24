# `server/` — Node.js 后端服务器

后端使用原生 Node.js HTTP 服务器（无 Express 等框架依赖）。提供 REST API、WebSocket、SSE 事件流、Agent 管理和存储服务。

## 目录结构

```
server/
├── index.mjs                 # 服务器入口 (486 行)
├── agent-manager.mjs         # Agent 生命周期管理 (含 Agent Profile / subagent 执行)
├── acp/                      # ACP AgentSideConnection stdio 适配层
├── agent-profiles.mjs        # Agent Profile 配置层，合并内置和自定义 Agent
├── storage.mjs               # 文件存储层 (707 行)
├── skills.mjs                # Agent Skills 管理和加载 (553 行)
├── channels/                 # 通用渠道管理（外部应用 bridge 进程，如微信 weixin-acp）
├── mcp/                      # MCP Client 配置、连接和工具适配
├── plugins/                  # 本地插件 manifest、加载和工具适配
├── share-store.mjs           # 分享数据存储 (432 行)
├── session-utils.mjs         # 会话工具 (102 行)
├── system-prompt.mjs         # 系统提示词合成 (91 行)
├── project-config.mjs        # 项目配置管理 (162 行)
├── conversation-compaction.mjs # 对话历史压缩 (302 行)
├── custom-commands.mjs       # 自定义命令系统 (539 行)
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
- 默认工作目录：全局会话（无 `projectId`）会合成默认 workspace 上下文（`defaultGlobalWorkspaceContext`，根目录 `~/.quickforge/workspace`，合成 project id 为 `default`），使「对话」与「项目」享有相同的文件工具（读/写/编辑/grep/命令）、工作区面板、终端和 Git 能力；文件操作受该目录沙箱约束，默认权限下读类工具放行、写入/命令/MCP/Plugin 等可能影响系统的工具走审批，完全访问权限则在既有沙箱与敏感文件限制内自动执行；`projectContextFromId` 找不到项目时同样回落到该默认 workspace
- 消息运行（`runPrompt`）：执行 AI 对话，管理消息历史
- SSE 事件流管理：向连接的客户端广播 Agent 事件
- 后台任务运行（`runTask` / `abortTask`）
- Agent 恢复（`restoreAgent`）：从持久化状态恢复会话
- Subagent 工具：`run_subagent` 在父会话内创建短生命周期临时 Agent；可调用启用的 Agent Profile。内置 `explore` 是只读仓库调研的首选，用于文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现和影响面分析，可执行安全的检查/诊断命令但不能修改文件；内置 `general` 适合有边界的复杂多步骤实现或更广泛独立任务，可使用完整内置工作区工具但不含 MCP/Skills。自定义 Agent Profile 也可通过白名单工具执行。子 Agent 不作为普通会话持久化，默认不能递归调用 `run_subagent`。
- Agent Profile 执行：`createAgent` 支持传入 `agentProfile`，在默认系统提示词后追加 profile 系统提示词，并按 `allowedTools` 限制 workspace 工具；定时任务可绑定 profile 执行。
- 工具管理：基于 Skills 和 Agent 权限模式动态构建工具列表；默认权限下安全读取工具自动通过，写入、命令、MCP/Plugin 等可能改变状态或影响外部系统的工具需要审批；完全访问权限等同开发者授权，在 workspace 沙箱和命令级限制内跳过审批；`/plan` 当前轮使用只读白名单，仅允许读取/搜索、Skill 加载和继承同样只读边界的 subagent 辅助调研，阻止写文件、编辑文件、运行命令以及未声明为允许的 MCP/Plugin/未知工具；Shift+Tab 计划模式通过结构化 command 元数据复用同一套 `/plan` 解析、prompt 和权限，并在 retry/continue 时恢复该权限；`/review` 当前轮允许读取和运行检查命令，但阻止编辑文件和 subagent 执行，用于提交前自检。
- 对话压缩（`compactConversation`）：手动 `/compact` 会创建压缩后的新会话；自动上下文压缩会在模型请求前按配置阈值生成滚动摘要，只影响 Agent loop 输入，完整历史仍保留用于 UI 展示和持久化。
- 上下文统计：`contextUsage` 由 `estimateSessionContextUsage()` 计算；存在 `contextCompaction` 时先构造 `summaryMessage + messages.slice(compactedUpToIndex)`，因此统计口径是压缩后的模型实际上下文，而不是完整可见聊天历史。底层 token 估算复用 `@earendil-works/pi-agent-core` 的 `estimateContextTokens()` / `estimateTokens()`，provider usage 与 `contextWindow` / `maxTokens` 来自 `@earendil-works/pi-ai` 的 assistant `usage` 和 model 元数据；自动压缩阈值判断通过百分比配置转换为 reserve tokens 后复用 `pi-agent-core.shouldCompact()`。返回值保留总量字段，并提供 `breakdown.systemPromptTokens`、`breakdown.toolsTokens`、`breakdown.messagesTokens`、`breakdown.providerUsageTokens`、`breakdown.trailingTokens`、`reservedOutputTokens`、`isCompacted`、`originalMessageCount` 和 `effectiveMessageCount`，用于前端解释固定成本、provider 基线、后续增量和压缩效果。
- 自定义命令处理
- 工具权限检查
- 会话活动跟踪（`touchSession`）
- Agent 销毁和资源清理

### acp/ — ACP Agent 适配层

**用途**: 通过 `@agentclientprotocol/sdk` 的 `AgentSideConnection` 将 QuickForge 暴露为 stdio ACP Agent。入口命令为 `quickforge acp` / `qf acp`，供支持 ACP 的 IDE/客户端启动并通信。

**核心文件**:
- `acp/server.mjs` — 创建 stdio ACP 连接，处理 `initialize`、`session/new`、`session/load`、`session/set_config_option`、`session/prompt`、`session/cancel`、`session/list`、`session/delete`、`session/close` 和 `document/didOpen` / `didChange` / `didSave` / `didClose` / `didFocus`，并把 QuickForge Agent 事件转换为 ACP `session/update`。

**行为约束**:
- stdout 保留给 ACP NDJSON 协议；日志走 QuickForge logger 的 stderr / 日志文件。
- 新会话会校验 ACP `cwd` 并记录 `additionalDirectories`；当 `cwd` 等于全局默认工作区时，会话保持 `global` scope，不会把该目录注册成项目；其他 `cwd` 会注册/激活 QuickForge 项目。额外目录会作为 ACP 上下文注入 prompt，但不会在当前实现中直接放宽 QuickForge workspace 工具的写入边界。项目路径匹配采用规范化 + 大小写不敏感比较（`sameProjectPath`），确保同一目录在 Windows 等大小写不敏感文件系统上始终命中同一已注册项目，而非被重复注册成新的 projectId。
- `session/list` 会合并 QuickForge 持久化 `sessions-metadata` 与当前内存 active sessions；`session/load` 恢复会话后会通过 ACP `session/update` 回放历史 user/assistant 消息。
- ACP document 事件会维护当前打开/聚焦文档缓存，并在 prompt 前注入 `<acp_context>`，使“当前文件/打开文件”类请求能获得 IDE buffer 上下文。
- `session/new` / `session/load` 会返回 ACP `configOptions` 模型和 Thinking Level 下拉选项，模型来源于 QuickForge 已配置的自定义模型；客户端调用 `session/set_config_option` 后会通过 `updateSessionModel` / `updateSessionThinkingLevel` 切换当前 ACP 会话配置。切换到不支持 reasoning 的模型时会自动将 Thinking Level 置为 `off`。新建会话时初始 Thinking Level 与 Web UI 保持一致：优先读取用户在设置中保存的默认思考级别（`settings['default-options'].thinkingLevel`），否则推理模型默认 `medium`、非推理模型默认 `off`（见 `resolveInitialThinkingLevel`）。
- 工具审批事件会转成 ACP `session/request_permission`，客户端选择 allow/reject 后调用现有 `approveToolCall` / `rejectToolCall`。

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
├── workspace/             # 全局对话的默认工作目录（合成 project id=default）
└── logs/                  # 日志文件
```

**功能**:
- 存储布局迁移（v1 → v2）
- `readStore` / `writeStore` / `atomicUpdate` — 通用存储操作
- 会话分桶存储（按 scope 和 projectId）
- `readSessionStoreScoped` — 作用域会话查询
- 写操作的原子锁队列
- 目录大小计算

### agent-profiles.mjs

**用途**: Agent Profile 配置层。

**功能**:
- 将内置 `general` / `explore` sub agent 映射为内置 Agent Profile。
- 使用 `custom-agents` store 保存用户自定义 Agent。
- 校验 Agent 名称、系统提示词、工具白名单、运行时间和工具调用预算。
- 为 `run_subagent`、定时任务和前端 Agents 页面提供统一列表。
- 提供 AI 填充能力，生成 Agent 名称、显示名称、描述和系统提示词，工具权限仍由用户手动配置。

### skills.mjs (553 行)

**用途**: Agent Skills 的发现、加载和管理。

**搜索路径**:
1. `~/.claude/skills/` — Claude 用户级 skills
2. `~/.opencode/skills/` — opencode 用户级 skills
3. `~/.agents/skills/` — 用户级共享 skills
4. `~/.quickforge/skills/` — 用户级全局 skills
5. `<workspace>/.claude/skills/` — Claude 项目级 skills
6. `<workspace>/.opencode/skills/` — opencode 项目级 skills
7. `<workspace>/.agents/skills/` — 项目级共享 skills
8. `<workspace>/.quickforge/skills/` — 项目级 QuickForge skills
9. 启用插件贡献的 `contributes.skills` — 插件打包 skills

**功能**:
- `listGlobalSkillSummaries()` / `listProjectSkillSummaries()` — 技能列表
- `loadSelectedGlobalSkills()` / `loadSelectedProjectSkills()` — 按选择加载
- `mergeSkills()` — 合并全局和项目 skills
- `readSkillResource()` — 读取技能资源文件
- Skill 验证（名称格式、目录结构）：`name` 会按 `trim + lowercase` 归一化为内部 canonical slug，因此 `name: SDD`、配置中的 `SDD` 和工具调用 `activate_skill({ name: 'SDD' })` 都会匹配到内部 `sdd`；大写展示名应使用 `displayName`。

### channels/ — 外部通信渠道

**用途**: 管理把外部应用接入 QuickForge Agent 的本地渠道。渠道以 Provider 形式注册到 `channels/registry.mjs`，当前内置微信渠道。

**核心文件**:
- `channels/registry.mjs` — 渠道注册、列表、状态查询、启动/停止/重启/action 分发和全局事件总线。
- `channels/process-channel.mjs` — 通用外部进程渠道基类，负责 `spawn` 生命周期、日志 ring buffer、状态、PID、二维码字段和关闭清理；启动过程带互斥保护，避免并发 start 生成多个 bridge，停止时会尽量终止整棵子进程树（Windows 使用 `taskkill /T`）。
- `channels/providers/wechat.mjs` — 微信渠道 Provider，使用 `npx -y weixin-acp start -- node <quickforge>/bin/quickforge.mjs acp` 启动微信 ACP bridge；UI 展示命令为 `npx weixin-acp start -- qf acp`；默认以非项目的全局默认工作区作为启动 cwd，也可由设置页选择已有项目作为启动工作区。
- `routes/channels.mjs` — `/api/channels`、`/api/channels/events` SSE、`/api/channels/:id/start|stop|restart|actions/:action`；`start`/`restart` 可通过 JSON body 传入 `projectId`，`default` 表示全局默认工作区。

**行为约束**:
- 启动/停止/action 属于本地命令执行，仅允许 localhost 请求，并要求 `x-quickforge-action: channel-action`。
- QuickForge 退出或重启时会调用 `shutdownChannels()` 停止渠道子进程。
- 微信渠道要求 Node.js >= 22、npm/npx 可用；首次启动由 `weixin-acp` 输出终端二维码/登录链接，设置页通过日志和二维码字段展示扫码入口。

### mcp/ — MCP Client 集成

**用途**: 管理全局 stdio MCP Server，并把外部 MCP tools 适配为 QuickForge Agent tools。

**核心文件**:
- `mcp/config.mjs` — MCP Server 配置读写和校验，配置存放在 `settings.mcpServers`；兼容 `mcpServers` JSON 导入、`type`/`transport` 和远程 `headers` 配置。
- `mcp/registry.mjs` — stdio/SSE/Streamable HTTP 连接生命周期、工具发现、工具调用转发、关闭清理；支持全量刷新（`refreshMcpConnections`，对 error 状态有重试退避）和单 server 强制重连（`reconnectMcpServer`，绕过退避）。
- `routes/mcp.mjs` — `/api/mcp/servers`（列表与 upsert 单个）、`/api/mcp/config`（批量导入 merge/replace）、`/api/mcp/reconnect`（全量重连）、`/api/mcp/reconnect/:name`（单 server 重连）、启停开关与删除等管理接口。

**行为约束**:
- 当前支持 `stdio`、`sse` 和 Streamable HTTP (`http`) transport。
- MCP 工具注入时使用 `mcp__{serverName}__{toolName}` 命名空间，避免和内置工具重名。
- YOLO 关闭时，MCP 工具调用需要用户审批；YOLO 开启时允许直接调用。

### plugins/ — Agent 能力插件系统

**用途**: 发现本地 QuickForge 插件，并把插件声明的 Agent 能力接入 QuickForge。插件系统定位为 Agent 能力包，而不是传统 IDE UI 插件：未来同一 manifest 会统一承载 Skills、Commands、Hooks、Tools/MCP、Agent/Subagent、LSP、Monitors、Context、Permissions 和 Audit。当前 V1 已落地 `contributes.tools`、静态 `contributes.skills` 和静态 `contributes.commands`。

**核心文件**:
- `plugins/manifest.mjs` — `plugin.json` 解析、校验、工具命名规范和静态 skills/commands 路径贡献规范；后续扩展更多 capability。
- `plugins/loader.mjs` — 动态加载插件入口 `index.mjs` / `main` 并调用 `createPlugin(context)`。
- `plugins/registry.mjs` — 插件搜索、启用状态、配置、工具定义和工具调用转发。
- `routes/plugins.mjs` — `/api/plugins`、启用/禁用、配置和 reload API。

**行为约束**:
- 当前 V1 支持 `<quickforge>/plugins`、`~/.quickforge/plugins`、`~/.agents/plugins` 和 `<project>/.quickforge/plugins` 本地目录发现；同名插件优先级为 `project > user > shared-user > builtin`。
- 插件工具注入时使用 `plugin__{pluginName}__{toolName}` 命名空间。
- 启用插件贡献的静态 Skills 会自动参与项目 Agent 的 available skills catalog；启用插件贡献的静态 Commands 会自动参与项目 slash command 发现。
- 首版插件是本地可信 Node.js ESM 代码；manifest 权限目前用于展示和后续强校验，不提供完整沙箱。
- 详细架构见 `docs/architecture/agent-plugin-system.zh-CN.md` 和 `docs/architecture/plugin-system.zh-CN.md`。

### terminal/ — 本地交互式终端

**用途**: 基于 `node-pty` 管理多开终端会话，并通过 WebSocket 连接前端 `xterm.js` 面板。

**核心文件**:
- `terminal/terminal-manager.mjs` — PTY 创建、输入输出转发、REST/WS 输入写入、resize、会话上限、空闲清理和关闭清理。
- `routes/terminal.mjs` — `/api/terminal/capabilities`、`/api/terminal/sessions`、`/api/terminal/sessions/:id/input` 和 `/api/terminal/sessions/:id/ws`。
- `routes/system.mjs` — 系统状态、服务重启、关于信息和 QuickForge npm 更新 API；`POST /api/system/update` 会在本机执行 `npm install -g @shawnstack/quickforge@latest`，仅允许 localhost 请求并要求 `x-quickforge-action: update`。

**安全边界**:
- 终端接口强制仅允许 localhost 访问；LAN 分享和共享会话页面不能访问。
- 终端运行在本机用户权限下，不是沙箱；默认 cwd 为当前项目目录。
- `QUICKFORGE_TERMINAL=0` 可关闭终端，`QUICKFORGE_MAX_TERMINALS` 可调整最大会话数。
- 终端 Shell 配置保存在 `settings` store 中：系统会按平台和可执行文件可用性自动识别常见内置 profiles（Windows: cmd/PowerShell/pwsh；macOS/Linux: zsh/bash/fish/sh/pwsh），`terminalShellProfiles` 仅存放自定义 profiles，`defaultTerminalShellProfileId` 存放默认 profile；兼容旧的 `terminalShell` 字段。
- `QUICKFORGE_TERMINAL_SHELL` 优先级最高，会覆盖 UI 中的默认 profile 和新建终端时选择的 profile。

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

### auto-compaction.mjs

**用途**: 自动上下文压缩。读取 `settings['auto-compact-settings']`，在 Agent 每次请求模型前按压缩后的有效上下文估算占当前模型 `contextWindow` 的比例；token 统计复用 `@earendil-works/pi-agent-core.estimateContextTokens()` / `estimateTokens()`，模型 `contextWindow` / `maxTokens` 和 assistant `usage` 来自 `@earendil-works/pi-ai`，阈值判断通过 QuickForge 百分比配置转换为 reserve tokens 后复用 `pi-agent-core.shouldCompact()`；超过阈值时生成滚动摘要。后端同时在 session state 中返回同一口径的权威 `contextUsage`，聊天底部上下文百分比优先展示该值；触发只发生在下一次模型请求前，并会受最小历史长度、最近拒绝、压缩间隔等保护条件限制。自动压缩采用“双轨”模式：完整 `messages` 继续持久化并展示在 UI 中，后续 Agent loop 只使用最新 compact summary 与最近若干用户回合。

### custom-commands.mjs (556 行)

**用途**: 自定义命令系统。从用户级 `~/.quickforge/commands/`（所有项目共享）和项目级 `<workspace>/.claude/commands/`、`<workspace>/.opencode/commands/`、`<workspace>/.ai/commands/` 及项目配置 `commandDir` 指向的目录读取命令定义；同名命令优先级由高到低：项目配置目录 > `.ai` > `.opencode` > `.claude` > 用户级目录 > 插件命令。内置命令元数据集中在 `builtinCommandCatalog` 常量表（单一事实源），`/help` 和前端建议均据此派生。

**功能**:
- `listProjectCommands()` — 列出命令（含插件、用户级、项目级三层）
- `listUserCommands()` — 读取用户级 `~/.quickforge/commands/` 命令
- `findProjectCommand()` — 查找单个命令
- `resolveCustomCommandInvocation()` — 解析命令调用
- `handleInternalCommand()` — 处理内置命令，包括 `/help`（显示全部命令参考）、`/plan`（只生成计划，本轮禁止写入/命令执行，可调用受同样只读边界约束的 subagent）、`/review`（提交前自检，本轮禁止编辑文件）、`/compact`、`/clear`、`/commands`、`/command new` 等
- `formatHelpText()` — 生成 `/help` 输出（内置命令区 + 自定义命令区）
- `createCommandFile()` — 在项目 `.ai/commands/` 下新建命令文件（带 frontmatter 模板，`flag:'wx'` 防覆盖），供 REST 路由和 `/command new` 复用

### session-utils.mjs (102 行)

会话工具函数：构建系统提示词、生成会话标题。

### system-prompt.mjs (91 行)

合成系统提示词。将基础提示词、workspace 上下文、多来源用户/项目指令（兼容 `~/.claude/CLAUDE.md`、`~/.opencode/AGENTS.md`、项目 `CLAUDE.md` / `AGENTS.md` 等）、Skills 目录和 Subagents 目录组装成完整的系统提示词；其中 Subagents 目录会引导主 Agent 在需要文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现或影响面分析时优先委托 `explore` 做只读仓库调研。

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
