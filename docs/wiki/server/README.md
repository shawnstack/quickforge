# `server/` — Node.js 后端服务器

后端使用原生 Node.js HTTP 服务器（无 Express 等框架依赖）。提供 REST API、WebSocket、SSE 事件流、Agent 管理和存储服务。

## 目录结构

```
server/
├── index.mjs                 # 服务器入口 (486 行)
├── agent-manager.mjs         # Agent 生命周期管理 (含 Agent Profile / subagent 执行)
├── auto-archive.mjs          # 超过 30 天未更新对话的自动归档 runner
├── acp/                      # ACP AgentSideConnection stdio 适配层
├── agent-profiles.mjs        # Agent Profile 配置层，合并内置和自定义 Agent
├── storage.mjs               # 文件存储层 (707 行)
├── network-proxy.mjs         # 直连、真实系统代理与手动 HTTP(S) 代理运行时
├── skills.mjs                # Agent Skills 管理和加载 (553 行)
├── channels/                 # 通用渠道管理（外部应用 bridge 进程，如微信 weixin-acp）
├── cloud/                    # QuickForge Cloud 配置、凭据、身份、模型目录和托管请求代理
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
- `GET /api/health` — 健康检查，返回 `version` 与 `package` 元数据，并按当前请求返回 `isLocalRequest` 与 `capabilities`；远端客户端的终端、重启和打开本机应用能力为关闭状态
- 静态文件服务（`serveStatic`）
- SSE（`/api/agents/events`, `/api/agents/:sessionId/stream`）
- WebSocket 交互式终端（`/api/terminal/sessions/:id/ws`，仅 localhost）
- 启动时重置僵死任务状态
- 支持 LAN 共享（显示局域网 URL）；远程完整访问需在本机配置密码。已认证远端可使用 Cloud、Storage、Backup、更新与重启，不再依据客户端 IP 网段区分；终端、系统代理、终端 Shell、目录选择器和打开服务端电脑上的资源管理器/IDE 仍仅限本机。
- 启动后初始化 `network-proxy.mjs`：读取 `settings['network-proxy']`，为外部 Fetch 请求应用直连、操作系统真实代理、手动 HTTP(S) 代理或 PAC 地址；localhost 始终直连。Desktop inline 由 Electron/Chromium Session 处理系统 PAC/WPAD 和自定义 PAC 地址；CLI/SDK 由 `@vscode/os-proxy-resolver` 调用 Windows、macOS 和 Linux 的原生系统代理来源，当前不支持自定义 PAC 地址，且不会静默降级为直连

### cloud/ — QuickForge Cloud 本地代理

- `model-catalog.mjs` 是所有正式模型入口的服务端权威目录与 resolver：自定义模型按稳定 Provider ID + 模型 ID 引用，Cloud 按 catalog ID 引用；新绑定保存版本化 `ModelRef`，执行时重读当前配置，客户端模型对象和 transport 不具有权威性。`quickforgeHidden` 仅阻止新选择，已有绑定仍可执行。Cloud 使用权限按本机、已认证 Tailscale、ACP、后台任务和分享显式授权上下文统一判断。
- `cloud/` 提供独立受管 QuickForge Cloud BFF：`service-config.mjs` 从 `settings['quickforge-cloud-service']`、环境变量和产品默认值解析安全 Cloud URL；`runtime.mjs` 按当前配置热构建/失效运行时；配置不会进入 `customProviders` / `providerKeys`。
- `credential-store.mjs` 将安装密钥、Refresh Token 和待处理 Device Flow 原子保存在 `~/.quickforge/storage/security/cloud-identity.json`；公开状态不返回 Token、私钥、路径或 `deviceCode`，账户摘要严格白名单为 `id/email/plan`。
- `identity.mjs` 管理显式游客注册、正式账户 OAuth Device Flow、Access Token 内存缓存、Refresh Token 轮换、额度/设备读取和注销；local 的登录动作先在同一显式流程中创建临时 guest，guest 直接升级。pending/slow_down/network 可恢复，denied/expired/cancel 保留 guest；仅网络异常、HTTP 5xx 和可重试服务错误映射为 network，协议/无效响应直接抛错；并发 poll 合并为一次远端 exchange。成功原子替换账户 Token、保留 installation 并清模型缓存。
- `routes/cloud.mjs` 暴露同源 `/api/cloud/*`：包括配置、连接测试、身份 reset/status、游客、Device Flow start/poll/cancel、目录、额度、设备和退出；所有 Device Flow 写操作使用既有 action header + JSON 防护，响应不返回 `deviceCode`。跨 URL 保存且存在 Session 或 pending flow 时返回 `409 cloud_session_active`。
- 退出当前设备时先调用云端 installation revoke，成功后才清理本地 Session；失败时保留凭据供重试。
- 退出后再次创建游客会轮换 Ed25519 安装密钥，避免旧公钥指纹唯一约束冲突；该行为创建新游客，不恢复旧额度。
- `models.mjs` 只向浏览器返回无密钥模型描述，过滤 `available:false`，指定 catalog ID 未命中时强制刷新一次；真实 Cloud Token 和上游地址仅在 Node 请求期间注入。
- 主聊天消息使用公开的 `metadata.quickforgeClientMessageId` 标识逻辑消息；真正的 Cloud Chat `Idempotency-Key` 以 `sessionId + messageId` 绑定在 `~/.quickforge/storage/security/cloud-chat-idempotency/` 私有 sidecar 中，不进入 Session JSON、浏览器状态或通用备份。同消息的 Provider 网络重试、`/continue` 和重启恢复后重新生成复用同一 UUID，不同消息使用不同 UUID；AI HTTP 调试日志会脱敏该 Header。

### agent-manager.mjs (1350 行)

**用途**: Agent 生命周期管理。后端最复杂的模块。

**功能**:
- Agent 创建（`createAgent`）：初始化 Agent 实例，配置工具和系统提示词
- Provider 请求重试：主 Agent、Subagent、对话压缩和辅助模型生成默认设置 `maxRetries: 3`，即首次请求失败后最多再重试 3 次（最多共 4 次请求）；是否可重试及退避由各 Provider 实现决定，模型连通性探测显式保持不重试，`maxRetryDelayMs` 只限制服务端要求的单次等待上限
- Git 提交信息 AI 生成同样接收 `modelRef` 并通过统一 resolver；客户端提交的完整模型仅作兼容识别，不能覆盖 Provider Base URL 或绕过 Cloud 来源权限。
- 默认工作目录：全局会话（无 `projectId`）会合成默认 workspace 上下文（`defaultGlobalWorkspaceContext`，根目录 `~/.quickforge/workspace`，合成 project id 为 `default`），使「对话」与「项目」享有相同的文件工具（读/写/编辑/grep/命令）、工作区面板、终端和 Git 能力；文件操作受该目录沙箱约束，默认权限下读类工具放行、写入/命令/MCP/Plugin 等可能影响系统的工具走审批，完全访问权限则在既有沙箱与敏感文件限制内自动执行；`projectContextFromId` 找不到项目时同样回落到该默认 workspace
- 消息运行（`runPrompt`）：执行 AI 对话，管理消息历史
- SSE 事件流管理：向连接的客户端广播 Agent 事件
- 后台任务运行（`runTask` / `abortTask`）
- Agent 恢复（`restoreAgent`）：从持久化状态恢复会话；Web 冷加载通过 `POST /api/agents/:sessionId/restore` 在一次请求中恢复并返回权威快照，`GET state` 仅在内存会话不存在时回落恢复，避免重复读取完整 Session
- Subagent 工具：`run_subagent` 在父会话内创建短生命周期临时 Agent；运行条件是父会话已解析出有效 `projectContext.workspaceRoot`，因此项目对话和合成默认 workspace 的全局对话都可使用，不再要求必须存在真实 `projectId`。可调用启用的 Agent Profile。内置 `explore` 是只读仓库调研的首选，用于文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现和影响面分析，可执行安全的检查/诊断命令但不能修改文件；内置 `general` 适合有边界的复杂多步骤实现或更广泛独立任务，可使用完整内置工作区工具但不含 MCP/Skills。自定义 Agent Profile 也可通过白名单工具执行。`run_subagent` 还支持 AI 按需传入一次性 `temporary` profile spec；服务端会校验名称、工具、`capabilityPolicy` 和模型引用，将该临时 subagent 写入 `~/.quickforge/cache/global/tmp/agents/<session>/<run>/*.md` 后再执行，并在结果 details 中返回 `profilePath`、`source`、`lifecycle`、`capabilityPolicy` 和实际模型信息。子 Agent 不作为普通会话持久化，默认不能递归调用 `run_subagent`。父会话会在内存中保留正在执行的工具快照，`getSessionState()` / SSE 初始 state 会将尚未进入权威消息历史的 `run_subagent` partial trace 和 `pendingToolCalls` 返回给刷新后的页面；该快照不写入持久化会话，也不进入 LLM 上下文，最终权威 `toolResult` 出现后自动去重清理。
- Agent Profile 执行：`createAgent` 支持传入 `agentProfile`，在默认系统提示词后追加 profile 系统提示词，并按 `allowedTools` 限制 workspace 工具；定时任务可绑定 profile 执行。自定义 Profile 可将模型和思考等级设为继承或固定值；运行时先解析最终模型，再解析思考等级，非推理模型统一降级为 `off`。内置 Profile 的定义保持只读，仅模型可通过 `agent-profile-overrides` 覆盖。
- 工具管理：基于 Skills 和 Agent 权限模式动态构建工具列表；工具上下文包含当前会话的 `sessionId/scope/projectId`，供 `generate_image` 将输出绑定到会话资产。默认权限下安全读取工具自动通过，写入、命令、图片生成、MCP/Plugin 等可能改变状态、产生费用或影响外部系统的工具需要审批；完全访问权限等同开发者授权，在 workspace 沙箱和命令级限制内跳过审批；`/init` 当前轮允许调研仓库、运行必要的只读命令、调用 subagent 并写入根目录 `AGENTS.md`，但仍受正常审批、工作区沙箱和敏感文件保护约束；`/plan` 当前轮使用只读白名单，仅允许读取/搜索、Skill 加载和继承同样只读边界的 subagent 辅助调研，阻止写文件、编辑文件、运行命令、图片生成以及未声明为允许的 MCP/Plugin/未知工具；Shift+Tab 计划模式通过结构化 command 元数据复用同一套 `/plan` 解析、prompt 和权限，并在 retry/continue 时恢复该权限；`/review` 当前轮允许读取和运行检查命令，但阻止编辑文件和 subagent 执行，用于提交前自检。
- 对话压缩（`compactConversation`）：手动 `/summary` 会创建总结后的新会话并保留原会话；手动 `/compact` 与自动上下文压缩保持一致，会在当前会话内生成/更新滚动摘要，只影响 Agent loop 输入，完整历史仍保留用于 UI 展示和持久化。自动上下文压缩会在模型请求前按配置阈值触发同一套当前会话内压缩。
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
- 新会话会校验 ACP `cwd` 并记录 `additionalDirectories`；当 `cwd` 等于全局默认工作区时，会话保持 `global` scope，不会把该目录注册成项目；其他 `cwd` 会注册/激活 QuickForge 项目。额外目录会作为 ACP 上下文注入 prompt，但不会在当前实现中直接放宽 QuickForge workspace 工具的写入边界。项目路径匹配采用规范化 + 大小写不敏感比较（`sameProjectPath`），确保同一目录在 Windows 等大小写不敏感文件系统上始终命中同一已注册项目，而非被重复注册成新的 projectId。渠道 bridge 可通过 `QUICKFORGE_ACP_CHANNEL_ID` / `QUICKFORGE_ACP_CHANNEL_NAME` 传入来源，ACP 会把 `source`、`channelId`、`channelName` 持久化到会话数据及 metadata，但不修改真实标题。
- `session/list` 会合并 QuickForge 持久化 `sessions-metadata` 与当前内存 active sessions；`session/load` 恢复会话后会通过 ACP `session/update` 回放历史 user/assistant 消息。
- ACP document 事件会维护当前打开/聚焦文档缓存，并在当前轮模型上下文中临时注入 `<acp_context>`，使“当前文件/打开文件”类请求能获得 IDE buffer 上下文；该内部上下文不会写入可见用户消息、持久化会话或历史回放。
- ACP prompt 启动失败、取消、删除或关闭会话时会统一移除 pending prompt、Agent EventEmitter 和 AbortSignal 监听器；同一会话的并发 prompt 会只拒绝后发请求，不中断已运行请求。
- `session/new` / `session/load` 会返回 ACP `configOptions` 模型和 Thinking Level 下拉选项，模型来源于统一 Model Catalog，包含当前允许的自定义与 Cloud 模型；当前 ACP 会话已经使用的隐藏模型会保留在该会话的选项中，但不能由其他会话重新选择。客户端调用 `session/set_config_option` 后会通过统一 resolver 校验并切换当前 ACP 会话配置。切换到不支持 reasoning 的模型时会自动将 Thinking Level 置为 `off`。新建会话时初始 Thinking Level 与 Web UI 保持一致：优先读取用户在设置中保存的默认思考级别（`settings['default-options'].thinkingLevel`），否则推理模型默认 `medium`、非推理模型默认 `off`（见 `resolveInitialThinkingLevel`）。
- 工具审批事件会转成 ACP `session/request_permission`，客户端选择 allow/reject 后调用现有 `approveToolCall` / `rejectToolCall`。

### storage.mjs (707 行)

**用途**: 文件存储层。管理 JSON 文件的读写、存储布局迁移。

**存储位置**: `~/.quickforge/`

**目录结构**:
```
~/.quickforge/
├── config/                # 配置数据（按 store 拆分为多文件）
│   ├── config.json        # 仅元数据/迁移标记
│   ├── settings.json      # 应用设置
│   ├── mcp-servers.json   # MCP 服务配置
│   ├── providers.json     # 自定义服务商 + API 密钥
│   ├── plugins.json       # 插件配置
│   ├── agent-profile-overrides.json # 内置 Agent 的模型覆盖
│   └── projects.json      # 项目注册表
├── storage/               # 会话数据和索引
│   └── conversations/
│       ├── global/{sessions,assets}/
│       └── projects/<projectId>/{sessions,assets}/
├── cache/                 # 缓存数据（含 cache/global/tmp/agents 临时 subagent Markdown）
├── agents/                # 用户 Agent Profile；agents/builtin 下生成内置 explore/general Markdown
├── workspace/             # 全局对话的默认工作目录（合成 project id=default）
└── logs/                  # 日志文件
```

**功能**:
- 存储布局迁移：早期 v1→v2 布局迁移 + 配置按 store 拆分（`migrateSplitConfig()`，单体 `config.json` → `settings`/`mcp`/`providers`/`plugins`/`projects` 多文件）
- `readStore` / `writeStore` / `atomicUpdate` — 通用存储操作（各配置 store 独立文件与写入队列）
- `atomicSessionValueUpdate` — 在会话数据写队列中原子更新单个会话，供自动归档等后台维护任务避免覆盖并发持久化
- 会话分桶存储（按 scope 和 projectId）；会话图片资产位于同一 bucket 的 `assets/<sessionId>/`，永久删除会话时同步清理
- `readSessionStoreScoped` — 作用域会话查询
- 写操作的原子锁队列
- 目录大小计算

### auto-archive.mjs

**用途**: 按设置自动归档长期未更新的历史对话。

- 设置保存在 `settings['auto-archive-settings']`，默认关闭。
- 开启时立即扫描，服务启动时检查一次，之后每 24 小时检查一次。
- 以 metadata、完整会话及消息时间戳中的最新活动时间判断是否超过 30 天；归档扫描与会话持久化串行，并在写入前再次校验，避免旧 metadata 造成误归档。
- 超过 30 天且非空、非运行中的对话写入与手动归档相同的 `archivedAt`；不会删除会话数据。
- 普通会话索引默认排除带 `archivedAt` 的记录；“已归档对话”页可查看、恢复或永久删除。
- 关闭开关只停止后续自动归档，不恢复已有归档。

### global-memory.mjs

**用途**: 管理一份跨项目、跨会话共享的全局用户记忆。

- 设置项保存在 `settings['memory-settings']`，默认开启；设置页入口为「设置 → 记忆」，可直接查看、自由编辑、重新加载并原样保存完整 Markdown。
- `GET /api/memory` 在开关关闭时也允许查看已有文件；`PUT /api/memory` 仅在开启时原样保存，并检查大小和敏感信息。
- 记忆正文保存在 `~/.quickforge/MEMORY.md`，不要求固定标题、列表、分类或条目 ID；用于记录对未来对话有帮助的长期偏好、习惯、背景、工作方式和目标。
- 开启时，`buildInstructionsPayload()` 会把精简后的记忆注入 `<global_user_memory>`，并附加 `<memory_policy>`；主 Agent 可在普通对话中主动识别并保存长期有价值的信息，也会响应用户明确的记住、修改或忘记要求。
- 主动记忆会排除仅适用于当前任务的要求、临时项目细节、基于单次行为的推断和不确定猜测；没有有价值的变化时不调用工具，不确定时不保存或向用户确认。
- `manage_global_memory` 工具支持读取或覆盖完整记忆文档；写入前必须读取完整文档、去重并更新冲突信息，同时保留无关内容和原有格式。写入不弹审批，并拒绝密码、Token、API Key、Cookie、私钥等敏感信息。
- 关闭后不注入记忆内容或主动记忆规则，并停止工具读取和写入，但保留 `MEMORY.md`；运行中的会话会在下一次发送消息前刷新 system prompt 和工具列表。
- Subagent 和自定义 Agent Profile 默认不获得记忆写入工具，避免临时 Agent 修改全局用户信息。

### agent-profiles.mjs

**用途**: Agent Profile 配置层。

**功能**:
- 将内置 `general` / `explore` sub agent 映射为内置 Agent Profile，并在 `~/.quickforge/agents/builtin/*.md` 生成受管 Markdown 供用户查看。
- 使用 `~/.quickforge/agents/<name>.md` 保存 UI/API 创建的用户自定义 Agent；旧版 `custom-agents` store 会在首次加载时一次性迁移为 QuickForge-managed Markdown，并保留旧 `id` 以兼容已有引用。
- 加载文件化 Agent Profile：用户级 `~/.claude/agents/*.md`、`~/.quickforge/agents/*.md`，项目级 `<workspace>/.claude/agents/*.md`、`<workspace>/.quickforge/agents/*.md`；Markdown frontmatter 放 `name`、`description`、`tools`、`capabilityPolicy`、`model` 等元数据，正文作为 `systemPrompt`。`model` 默认 `inherit` 父 Agent，也可声明固定模型引用（provider + modelId，可选 api/baseUrl）。
- 文件化 Agent 支持 Claude 风格工具别名：`Read`、`Grep`、`Bash`、`Write`、`Edit` 会映射为 QuickForge 的 workspace tools；`general` / `explore` 是保留名，不能被文件覆盖。
- 合并优先级：内置 Agent 保留；文件化 Agent 中项目级覆盖用户级；`~/.quickforge/agents` 会覆盖 `~/.claude/agents`；旧 `custom-agents` store 仅作为一次性迁移源，不再作为新自定义 Agent 的主存储。
- 校验 Agent 名称、系统提示词、工具白名单、`capabilityPolicy`、模型引用、运行时间和工具调用预算。
- 为 `run_subagent`、定时任务和前端 Agents 页面提供统一列表。
- 提供 AI 填充能力，生成 Agent 名称、显示名称、描述和系统提示词，工具权限仍由用户手动配置。

### skills.mjs (553 行)

**用途**: Agent Skills 的发现、加载和管理。

**搜索路径**:
1. `<quickforge>/skills/` — 随 Runtime 分发的内置全局 skills；当前包含 Anthropic `skill-creator`
2. `~/.claude/skills/` — Claude 用户级 skills
3. `~/.opencode/skills/` — opencode 用户级 skills
4. `~/.agents/skills/` — 用户级共享 skills
5. `~/.quickforge/skills/` — 用户级全局 skills
6. `<workspace>/.claude/skills/` — Claude 项目级 skills
7. `<workspace>/.opencode/skills/` — opencode 项目级 skills
8. `<workspace>/.agents/skills/` — 项目级共享 skills
9. `<workspace>/.quickforge/skills/` — 项目级 QuickForge skills
10. 启用插件贡献的 `contributes.skills` — 插件打包 skills

内置 `skill-creator` 会在首次运行新版本时自动加入全局已选 Skills；迁移标记写入 `~/.quickforge/config/.default-skills-v1`，因此用户后续取消后不会在重启时被重新启用。用户级目录按上述顺序覆盖同名内置 Skill，其中 `~/.quickforge/skills` 优先级最高；Runtime 更新只替换内置副本，不覆盖用户文件。上游来源、固定 commit 和许可证记录在 `skills/skill-creator/UPSTREAM.md`。

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
- `channels/event-relay.mjs` — ACP 渠道子进程在会话持久化完成后，通过仅本机可访问的内部 HTTP relay 发布 `sessions-changed` 事件。
- `channels/process-channel.mjs` — 通用外部进程渠道基类，负责 `spawn` 生命周期、日志 ring buffer、状态、PID、二维码字段和关闭清理；stdout/stderr/system 日志同时按日追加到 `~/.quickforge/logs/channels/<安全渠道 ID>/channel-YYYY-MM-DD.log`（UTF-8 JSON Lines，每行含时间、stream 和文本），写入失败只记录服务端警告，不影响渠道进程；启动过程带互斥保护，避免并发 start 生成多个 bridge，停止时会尽量终止整棵子进程树（Windows 使用 `taskkill /T`）。
- `channels/providers/wechat.mjs` — 微信渠道 Provider，使用 `npx -y weixin-acp start -- node <quickforge>/bin/quickforge.mjs acp` 启动微信 ACP bridge；UI 展示命令为 `npx weixin-acp start -- qf acp`；默认以非项目的全局默认工作区作为启动 cwd，也可由设置页选择已有项目作为启动工作区；启动时通过 ACP 渠道环境变量传入 `wechat` / `微信`，用于会话来源展示。
- `routes/channels.mjs` — `/api/channels`、`GET /api/channels/events` SSE、仅本机内部使用的 `POST /api/channels/events` 事件 relay、`/api/channels/:id/start|stop|restart|actions/:action|open-logs`；`start`/`restart` 可通过 JSON body 传入 `projectId`，`default` 表示全局默认工作区；`POST /api/channels/:id/open-logs` 仅接受已注册渠道 ID，由服务端创建并打开对应日志目录。

**行为约束**:
- 启动/停止/action 属于本地命令执行，仅允许 localhost 请求，并要求 `x-quickforge-action: channel-action`。
- QuickForge 退出或重启时会调用 `shutdownChannels()` 停止渠道子进程。
- 微信渠道要求 Node.js >= 22、npm/npx 可用；首次启动由 `weixin-acp` 输出终端二维码，设置页仅在存在二维码内容时展示扫码入口，并提供“打开日志文件夹”访问持久化渠道日志，不再内嵌最近日志或常驻展示 PID、命令、环境要求等运行细节。
- 微信 bridge 与 Web 服务运行在不同进程，但共享会话存储。外部 ACP 会话持久化完成后会通过内部 relay 发布 `sessions-changed` SSE，前端按事件更新受影响会话并同步当前打开的会话，不再进行固定间隔轮询；页面重新可见时仍会执行一次全量兜底同步。

### mcp/ — MCP Client 集成

**用途**: 管理全局 stdio MCP Server，并把外部 MCP tools 适配为 QuickForge Agent tools。

**核心文件**:
- `mcp/config.mjs` — MCP Server 配置读写和校验，配置存放在独立的 `mcp` store（`config/mcp-servers.json`，内部 key 仍为 `mcpServers`）；兼容 `mcpServers` JSON 导入、`type`/`transport` 和远程 `headers` 配置。
- `mcp/registry.mjs` — stdio/SSE/Streamable HTTP 连接生命周期、工具发现、工具调用转发、关闭清理；支持全量刷新（`refreshMcpConnections`，对 error 状态有重试退避）和单 server 强制重连（`reconnectMcpServer`，绕过退避）；连接、工具发现或工具调用超时后会取消请求并关闭异常 transport，后续调用再重连。
- `routes/mcp.mjs` — `/api/mcp/servers`（列表与 upsert 单个）、`/api/mcp/config`（批量导入 merge/replace）、`/api/mcp/reconnect/:name`（单 server 重连）、启停开关与删除等管理接口。

**行为约束**:
- 当前支持 `stdio`、`sse` 和 Streamable HTTP (`http`) transport。
- MCP 工具注入时使用 `mcp__{serverName}__{toolName}` 命名空间，避免和内置工具重名。
- YOLO 关闭时，MCP 工具调用需要用户审批；YOLO 开启时允许直接调用。

### plugins/ — Agent 能力插件系统

**用途**: 发现本地 QuickForge 插件，并把插件声明的 Agent 能力接入 QuickForge。插件系统定位为 Agent 能力包，而不是传统 IDE UI 插件：未来同一 manifest 会统一承载 Skills、Commands、Hooks、Tools/MCP、Agent/Subagent、LSP、Monitors、Context、Permissions 和 Audit。当前 V1 已落地 `contributes.tools`、静态 `contributes.skills` 和静态 `contributes.commands`。

**核心文件**:
- `plugins/manifest.mjs` — `plugin.json` 解析、校验、工具命名规范和静态 skills/commands 路径贡献规范；后续扩展更多 capability。
- `plugins/loader.mjs` — 动态加载插件入口 `index.mjs` / `main` 并调用 `createPlugin(context)`；入口内容哈希作为 ESM reload token，插件可选实现 `dispose()` 参与实例替换清理。
- `plugins/registry.mjs` — 插件搜索、启用状态、配置、缓存、事务式实例替换、工具定义和工具调用转发；普通状态查询复用缓存，显式 reload 或配置/启停变更才刷新，刷新失败时保留上一健康实例。内置插件规范名称为 `documents`、`presentations`、`spreadsheets`，旧 `openai-*` 配置会一次性迁移，且新名称配置优先。
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
- `terminal/terminal-manager.mjs` — PTY 创建、输入输出转发、REST/WS 输入写入、resize、会话上限、断线保留和关闭清理。已连接的终端不会因为无输入输出而自动销毁；最后一个客户端断开后默认保留 30 分钟，便于页面刷新、休眠恢复或前端重连。
- `routes/terminal.mjs` — `/api/terminal/capabilities`、`/api/terminal/sessions`、`/api/terminal/sessions/:id/input` 和 `/api/terminal/sessions/:id/ws`。
- `routes/system.mjs` — 系统状态、服务重启、关于信息和 QuickForge Runtime 更新 API；`GET /api/system/update/check` 检查 npm 分发的 Runtime 版本，`POST /api/system/update` 仅允许 localhost 请求并要求 `x-quickforge-action: update`，会启动外部 `update-supervisor.mjs`，让当前服务退出后再执行全局 npm 更新并自动重启；Desktop 客户端更新不走该 npm 更新入口，而是通过 GitHub Releases / 桌面包分发。

**安全边界**:
- 终端接口强制仅允许 localhost 访问；LAN 分享和共享会话页面不能访问。
- 终端运行在本机用户权限下，不是沙箱；默认 cwd 为当前项目目录。
- `QUICKFORGE_TERMINAL=0` 可关闭终端，`QUICKFORGE_MAX_TERMINALS` 可调整最大会话数；`QUICKFORGE_TERMINAL_RECONNECT_MS` 可调整最后一个客户端断开后的 PTY 保留时间，默认 30 分钟。
- 终端 Shell 配置保存在 `settings` store 中：系统会按平台和可执行文件可用性自动识别常见内置 profiles（Windows: cmd/PowerShell/pwsh；macOS/Linux: zsh/bash/fish/sh/pwsh），`terminalShellProfiles` 仅存放自定义 profiles，`defaultTerminalShellProfileId` 存放默认 profile；兼容旧的 `terminalShell` 字段。
- `QUICKFORGE_TERMINAL_SHELL` 优先级最高，会覆盖 UI 中的默认 profile 和新建终端时选择的 profile。

### update-supervisor.mjs

**用途**: 设置页一键更新的外部更新器。由当前后端以 detached 子进程启动，等待旧服务退出后，在数据目录下执行 `npm install -g <package>@latest`，将 npm 输出写入 `~/.quickforge/logs/update-*.log`，成功后重新启动后端服务。这样避免 Windows 上“运行中的服务更新自己”导致安装目录文件被占用。

### share-store.mjs (432 行)

**用途**: 对话分享的持久化和访问控制。

**功能**:
- `createConversationShare()` — 创建或更新同一会话的固定分享链接
- `listConversationShares()` — 列出当前实例全部或指定会话的分享
- `revokeConversationShare()` — 停用分享并清除已有认证令牌
- `restoreConversationShare()` — 以新的有效期恢复分享，旧 Cookie 不会重新生效
- `updateConversationShareExpiration()` — 修改仍有效分享的到期时间
- `updateConversationShare()` — 编辑分享的权限、密码和有效期；修改/取消密码后旧 token 失效
- `deleteConversationShare()` — 永久删除分享记录
- 分享停用、永久删除、被替代或到期时，已建立的共享 SSE 连接会立即/按时关闭
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
- `handleInternalCommand()` — 处理内置命令，包括 `/help`（显示全部命令参考）、`/init`（调研当前仓库并生成或更新根目录 `AGENTS.md` 贡献者指南，不接受参数）、`/plan`（只生成计划，本轮禁止写入/命令执行，可调用受同样只读边界约束的 subagent）、`/review`（提交前自检，本轮禁止编辑文件）、`/summary`（创建总结后的新会话）、`/compact`（当前会话内滚动压缩上下文）、`/clear`、`/commands`、`/command new` 等
- `formatHelpText()` — 生成 `/help` 输出（内置命令区 + 自定义命令区）
- `createCommandFile()` — 在项目 `.ai/commands/` 下新建命令文件（带 frontmatter 模板，`flag:'wx'` 防覆盖），供 REST 路由和 `/command new` 复用

### session-utils.mjs (102 行)

会话工具函数：构建系统提示词、生成会话标题。

### system-prompt.mjs (91 行)

合成系统提示词。将基础提示词、workspace 上下文、多来源用户/项目指令（兼容 `~/.claude/CLAUDE.md`、`~/.opencode/AGENTS.md`、项目 `CLAUDE.md` / `AGENTS.md` 等）、Skills 目录和 Subagents 目录组装成完整的系统提示词；其中 Subagents 目录会引导主 Agent 在需要文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现或影响面分析时优先委托 `explore` 做只读仓库调研。

### project-config.mjs (162 行)

项目配置管理（在 `config/projects.json` 的 `projects` 数组中）。

### reasoning-cache.mjs (51 行)

缓存 LLM 推理过程内容 (reasoning_content)，在流式推理中恢复。

### restart-supervisor.mjs (38 行)

分离进程，用于重启时保证旧进程退出前新进程已就绪。

### lan-access-store.mjs

**用途**: LAN 共享访问会话的持久化存储和验证。

**功能**:
- `updateLanAccessSettings()` — 更新 LAN 共享设置（启用/禁用、密码、会话 TTL）
- `issueLanAccessToken()` — 签发访问令牌，并记录会话 ID、IP、User-Agent 和有效期
- `readLanAccessStatus()` — 读取 LAN 共享状态与有效登录会话列表
- `revokeLanAccessTokenById()` — 按公开会话 ID 撤销单个会话
- `revokeLanAccessToken()` — 按当前 Cookie 令牌撤销会话，用于主动退出
- `revokeLanAccessTokens()` — 撤销所有会话
- 密码哈希存储（scrypt）
- 会话数量上限保护（100 个）
- 兼容没有会话 ID/设备元数据的旧令牌记录

---

## API 路由 (routes/)

参见 [routes/ 文档](routes/)。

## 工作区工具 (tools/)

参见 [tools/ 文档](tools/)。

## 工具函数 (utils/)

参见 [utils/ 文档](utils/)。
