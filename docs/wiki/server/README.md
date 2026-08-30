# `server/` — Node.js 后端服务器

后端使用原生 Node.js HTTP 服务器（无 Express 等框架依赖）。提供 REST API、WebSocket、SSE 事件流、Agent 管理和存储服务。

## 目录结构

```
server/
├── index.mjs                 # 服务器入口 (883 行)
├── agent-manager.mjs         # Agent 生命周期管理 (3753 行，含 Agent Profile / subagent 执行)
├── auto-archive.mjs          # 超过 30 天未更新对话的自动归档 runner
├── acp/                      # ACP AgentSideConnection stdio 适配层
├── agent-profiles.mjs        # Agent Profile 配置层，合并内置和自定义 Agent
├── storage.mjs               # 文件存储层 (707 行)
├── sqlite/                   # node:sqlite 基础连接、事务、health 与 append-only migration
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
├── context-references.mjs      # @ 文件引用请求校验、canonical details 与本轮路径提示
├── selected-capabilities.mjs   # 本轮插件选择规范化、持久化快照与模型临时提示 (76 行)
├── custom-commands.mjs       # 自定义命令系统 (628 行)
├── reasoning-cache.mjs       # 推理内容缓存 (51 行)
├── restart-supervisor.mjs    # 服务重启监控脚本 (38 行)
├── lan-access-store.mjs      # LAN 共享访问令牌存储 (407 行)
├── lan-access-service.mjs    # F11 lan-access 域 phase 状态机 + mirror drain
├── lan-access-cutover.mjs    # F11 lan-access JSON→SQLite cutover + 维护锁
├── lan-access-backup.mjs     # F11 lan-access 权威导出 / restore 计划与补偿
├── lan-access-json-file.mjs  # F11 lan-access mirror 文件读写（原子 tmp+rename）
├── terminal/                 # 本地交互式终端 PTY 会话管理
├── routes/                   # API 路由处理器
├── tools/                    # 工作区工具定义和实现
└── utils/                    # 工具函数
```

---

## 核心模块

### index.mjs (1031 行)

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
- 启动预热 MCP：HTTP listen 回调内 fire-and-forget `refreshMcpConnections()` 预热 MCP 连接（CLI/desktop/android 均经 `server/index.mjs` 启动、共用此路径；不阻塞启动与初始化链，无 MCP 配置时刷新空转，失败仅 warn）
- 启动分两段（P1 listen early + 维护窗口）：`ensureStorage()` 与 `initializeSqliteStorage()`（`<dataDir>/storage/quickforge.sqlite3`，统一 WAL/foreign keys/busy timeout/synchronous，migration 或一致性失败将 startup state 置为 `failed`）仍在 HTTP listen 前执行；其余全部初始化链（scheduled runs cutover、restore-plan recovery、stale-running recovery、F8 session state 链、share/lan-access cutover 链、skills、network proxy、channels、session index、runners）移入 `runStartupInitialization()` 在 listen 后后台执行（步骤与顺序保持不变）。维护窗口内 `/api/health`（`{ok:true, maintenance:true,...}`）与 `GET /api/migration-status`（`server/startup-state.mjs`：startup state + 4 域 phase 汇总）正常响应、静态资源正常放行，其余 `/api/*` 一律 503 `{ok:false, maintenance:true, state}` + `Retry-After: 5`，前端页面先加载并显示迁移进度后自动进入（会话域后台迁移后，维护窗口仅剩 scheduled-runs/share/lan-access 三小域秒级切换，进度页通常一闪而过或不出现；会话域迁移进度改经 `sessionState.background` 域在 READY 后持续可查）。fail-closed 语义从"进程退出"改为"服务存活但拒绝业务 API"：启动失败时 `/api/health` 返回 `{ok:false, startupError}`（waitForQuickForge 持续轮询直到超时，保持启动失败结果），日志已 flush 便于排查；cutover/restore/权威 backup 共用带 PID/fencing/heartbeat 的 SQLite 维护锁；restore 遇 active run 返回 409，权威 backup repository/count/digest 异常 fail closed；restore plan 按 applying 类状态 roll-forward target、compensating 类状态 rollback before，digest 不符或补偿失败阻止 runner。`resetStaleTaskStatuses()` 后会话域按 phase 路由（`resolveSessionStateStartupRoute`）：`json_authoritative`/`cutover_running` 不再执行同步 cutover，仅 `initializeSessionStateService()` → `recoverSessionStateRestorePlan()` → `drainSessionJsonMirror()`（空队列确认）后 fire-and-forget 启动后台迁移任务（`startSessionStateBackgroundMigration`：桶级对齐导入 → 收敛循环 → idle 期异步备份 → 全局 persist 锁 + 写队列 barrier 内单事务 promote；全程持维护锁，失败保持 `json_authoritative`、业务不受影响、重启幂等重试，`cutover_running` 残留在锁内复位，进度经 migration-status `sessionState.background` 域暴露）；`pending`/`authoritative`（及未知 phase 兜底）保留同步链 `initializeSessionStateCutover()`（完整性自检 + drain + promote 恢复语义，integrity fail closed）→ `initializeSessionStateService()` → `recoverSessionStateRestorePlan()`（中断的 restore 计划 roll-forward/rollback）→ `drainSessionJsonMirror()`；pending/authoritative 下 session body+metadata+session_index 为 SQLite 单事务权威，`session_storage_state` 记录 phase/count/digest。F7 readiness 显式区分 uninitialized/ready/degraded，并以 source/index count+digest、source compatibility、TTL verify、single-flight rebuild 守护 storage route SQL 分页；异常、duplicate/tie 或 shadow mismatch 均回 JSON。`/api/health` 返回 SQLite 与非敏感 sessionIndex 摘要，shutdown 幂等关闭。authoritative 后 scheduled runs 的 JSON mirror 损坏仅降级（diagnostic+warn，不阻止启动），其常规启动不重复 SQLite health/`quick_check`；全局数据库打开、schema/migration 与版本门禁由 `initializeSqliteStorage()` 在业务初始化前统一负责
- 支持 LAN 共享（显示局域网 URL）；远程完整访问需在本机配置密码。已认证远端可使用 Cloud、Storage、Backup、更新与重启，不再依据客户端 IP 网段区分；终端、系统代理、终端 Shell、目录选择器和打开服务端电脑上的资源管理器/IDE 仍仅限本机。
- 启动后初始化 `network-proxy.mjs`：读取 `settings['network-proxy']`，为外部 Fetch 请求应用直连、操作系统真实代理、手动 HTTP(S) 代理或 PAC 地址；localhost 始终直连。Desktop inline 由 Electron/Chromium Session 处理系统 PAC/WPAD 和自定义 PAC 地址；CLI/SDK 由 `@vscode/os-proxy-resolver` 调用 Windows、macOS 和 Linux 的原生系统代理来源，当前不支持自定义 PAC 地址，且不会静默降级为直连
- F11 lan-access 启动链（share 之后）：`initializeLanAccessCutover() → initializeLanAccessService() → recoverLanAccessRestorePlan() → drainLanAccessJsonMirror()`；pending/authoritative 常规启动只 drain 事务性 mirror outbox，不做全表完整性扫描或 `quick_check`，中断的 restore 计划仍按 roll-forward/rollback 恢复；authoritative 下 `security/lan-access.json` 为 best-effort mirror；`shutdownRuntime` finally 在 `closeSqliteStorage()` 前调用 `stopLanAccessService()`
- 进程级异常兜底：启动早期（模块级状态声明后）注册 `uncaughtException` / `unhandledRejection` 处理器（`utils/process-error-guards.mjs`）；`uncaughtException` 记录错误与堆栈后 best-effort 优雅关闭（`shutdownTimeoutMs` 5s 上限）→ `flushLogger()` → `exit(1)`，re-entrancy 守卫防止关闭期间二次异常丢失日志；`unhandledRejection` 仅记录（Error 取 `.stack`，非 Error 经 `inspect`）并继续运行，不 flush、不退出

### cloud/ — QuickForge Cloud 本地代理

- `model-catalog.mjs` 是所有正式模型入口的服务端权威目录与 resolver：自定义模型按稳定 Provider ID + 模型 ID 引用，Cloud 按 catalog ID 引用；新绑定保存版本化 `ModelRef`，执行时重读当前配置，客户端模型对象和 transport 不具有权威性。`quickforgeHidden` 仅阻止新选择，已有绑定仍可执行。Cloud 使用权限按本机、已认证 Tailscale、ACP、后台任务和分享显式授权上下文统一判断。
- `cloud/` 提供独立受管 QuickForge Cloud BFF：`service-config.mjs` 从 `settings['quickforge-cloud-service']`、环境变量和产品默认值解析安全 Cloud URL 与独立 `enabled` 总开关（默认关闭）；`runtime.mjs` 按当前配置热构建/失效运行时。关闭时保留 URL、本地身份、Session、账户摘要和退出能力，暂停云模型、额度、设备、Device Flow 轮询及托管 `qf-agent`；已配置但关闭的模型解析返回 `cloud_disabled`。配置不会进入 `customProviders` / `providerKeys`。
- `credential-store.mjs` 将安装密钥、Refresh Token 和待处理 Device Flow 原子保存在 `~/.quickforge/storage/security/cloud-identity.json`；公开状态不返回 Token、私钥、路径或 `deviceCode`，账户摘要严格白名单为 `id/email/plan`。
- `identity.mjs` 管理正式账户 OAuth Device Flow、Access Token 内存缓存、Refresh Token 轮换、额度/设备读取和注销；local 登录直接 ensure installation 并 authorizeDevice，`mode:guest` 仅兼容遗留本地凭据。pending/slow_down/network 可恢复，denied/expired/cancel 清 pending 并保留原 local/遗留 guest 状态；仅网络异常、HTTP 5xx 和可重试服务错误映射为 network，协议/无效响应直接抛错；并发 poll 合并为一次远端 exchange。成功原子写入账户 Token、保留 installation 并清模型缓存。
- `routes/cloud.mjs` 暴露同源 `/api/cloud/*`：包括配置、连接测试、身份 reset/status、Device Flow start/poll/cancel、目录、额度、设备和退出；所有 Device Flow 写操作使用既有 action header + JSON 防护，响应不返回 `deviceCode`。跨 URL 保存且存在 Session 或 pending flow 时返回 `409 cloud_session_active`。
- `cloud/qf-agent-process.mjs` 在 HTTP 监听成功后托管独立 `qf-agent` 进程，并使用实际绑定端口生成回环 Server URL；qf-agent 二进制当前不随 npm/runtime/offline/桌面包分发（包体裁剪临时下线，`runtime-assets` 已移除），缺失时启动结果为 `unavailable`，可通过 `QUICKFORGE_QF_AGENT_PATH` 指定外部二进制；默认身份目录按 `<runtimeKind>-<port>` 隔离 Server 与 Desktop。二进制缺失、版本校验失败、身份锁冲突或远程连接失败仅反映到 `GET /api/cloud/remote/status`，不会阻塞本地 Server 启动；公开状态不包含可执行路径、身份路径或令牌。代理透传：仅当 QuickForge 网络代理配置为 `manual` 且 proxyUrl 非空时，才向 qf-agent 子进程 env 注入 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`，并构造 `NO_PROXY`（保留父进程已有 `NO_PROXY`/`no_proxy` 条目，至少加入 `localhost`、`127.0.0.1`、`::1` 与回环 Server URL 主机名）；`direct`/`system`/`pac` 模式不映射为子进程代理，也不清除父进程已有代理 env。失效身份自愈：检测到 qf-agent 结构化 warn/error/fatal/panic 日志中的 `invalid_refresh_token`、`refresh_token_reused`、`installation_revoked` 或既有“refresh token 已失效”提示时，每 lifecycle 至多一次终止子进程，并在子进程退出后仅对当前 runtime 专属 `identityDir/identity.json` 做安全隔离（rename 到同目录临时文件后删除，Windows EPERM fallback unlink，ENOENT 幂等，只处理普通文件不跟随 symlink），随后调度重启进入设备授权；隔离成功与否均不清零重启计数，连续失效由 `MAX_CONSECUTIVE_RESTARTS` 有界兜底（稳定运行 60s 为自然重置边界），避免新身份持续被拒绝时形成无界循环；不会触碰 `storage/security/cloud-identity.json`，stop/新 lifecycle 不会误清理。
- `cloud/auto-approval.mjs` 管理短时、一次性的远程 Agent 自动批准意图（仅内存态，默认 TTL 10 分钟）：仅当本机用户在设置页显式将 Cloud 服务从 `disabled` 切换为 `enabled`（`PUT /api/cloud/config` 的 enabled false→true 转换）时创建；认证远程客户端、Server 启动恢复、URL 切换、agent 普通重启都不会创建新意图，因此不会静默批准新 agent。qf-agent 进入 `authorizing` 后，托管层从结构化日志的 `verificationUriComplete`（兼容 `userCode`/`user_code`/`code` query 参数）安全提取一次性 user_code，经 `CloudIdentityManager.withAccessToken` 用桌面 Access Token 调用云端固定接口 `POST /v1/remote/agents/authorize`（body `{userCode}`）；云端只接受 `kind=desktop` 且具备 `remote:write` 的身份，并只批准同账户、`pending`、未过期、`client_id=quickforge-agent` 的请求。意图一次性消费、并发去重，成功即消耗，失败保留脱敏错误，仅本机可通过 `POST /api/cloud/remote/authorize-retry` 重试。desktop Token 只在 Node 内存中经 `withAccessToken` 注入请求，user_code 不作为独立字段进入公开状态；意图绝不落盘，不写 agent identity，也不触碰 `storage/security/cloud-identity.json`。agent 仍走自己的 Device Flow 并保存独立身份；远程 Agent UI 不显示人工授权链接或 user code。
- 退出当前设备时先调用云端 installation revoke，成功后才清理本地 Session；失败时保留凭据供重试。
- 退出后再次登录会按 `rotateInstallationBeforeRegistration` 轮换 Ed25519 安装密钥，避免旧公钥指纹唯一约束冲突。
- `models.mjs` 只向浏览器返回无密钥模型描述，过滤 `available:false`，指定 catalog ID 未命中时强制刷新一次；真实 Cloud Token 和上游地址仅在 Node 请求期间注入。
- 主聊天消息使用公开的 `metadata.quickforgeClientMessageId` 标识逻辑消息；真正的 Cloud Chat `Idempotency-Key` 以 `sessionId + messageId` 绑定在 `~/.quickforge/storage/security/cloud-chat-idempotency/` 私有 sidecar 中，不进入 Session JSON、浏览器状态或通用备份。同消息的 Provider 网络重试、`/continue` 和重启恢复后重新生成复用同一 UUID，不同消息使用不同 UUID；AI HTTP 调试日志会脱敏该 Header。

### agent-manager.mjs (3753 行)

**用途**: Agent 生命周期管理。后端最复杂的模块。

**功能**:
- Agent 创建（`createAgent`）：按会话固定的 `harness` 初始化 QuickForge Agent 或 OpenCode ACP facade；缺失/未知持久化值回落 QuickForge，OpenCode ACP session ID 单独持久化并在恢复时按 initialize capability 选择 load/resume。OpenCode 新会话不依赖 QuickForge 模型配置，前端占位模型不会进入 ACP/服务端模型参数。OpenCode adapter 按 ACP `messageId` 分段 assistant，保留 text/thinking 收包顺序，并将工具持久化为 assistant 文本 → assistant toolCall → toolResult → 后续 assistant 文本。
- OpenCode 运行保护：initialize/session setup/prompt/close 均有有界 deadline；协议、session lifecycle capability 与 auth required 分别映射为明确的 incompatible/auth/timeout 错误。进程或 transport 崩溃只收口一次，流式 partial 先 flush；公开 stderr/错误会脱敏密钥、URL 和本机绝对路径。QuickForge 不读取 OpenCode 凭证。POSIX 以 process group 启动，销毁时与 Windows `taskkill /T` 一样两阶段终止进程树。
- OpenCode ACP 附件与工具展示：图片转换为标准 `image` block，普通文件以内嵌 `resource` 的 text/blob 发送并使用安全 `quickforge-attachment://` URI；发送前严格校验 initialize 的 `promptCapabilities.image/embeddedContext`，非法或不支持时在消息持久化和 `agent_start` 前返回 `400`。工具名只按 ACP kind 将 read/edit/search/execute 映射为现有展示名，其余固定为 `opencode_tool`；title/kind/locations 仅做白名单来源 metadata，`_meta` 剥离，content/resource/diff/terminal/rawOutput 均转为有界展示，失败状态、审批与消息顺序保持不变。旧 OpenCode 历史加载时会仅在内存中归一旧工具名和配对结果以自愈展示，不主动改写持久化文件。
- OpenCode 标准 ACP 动态配置：`agent.state.acpSession` 仅在内存中保存白名单化的 `configOptions`、`modes`、`availableCommands`、`sessionInfo`、`usage`，剥离 `_meta`/未知 metadata，不含凭证且不持久化；`session/load` / `resume` 是恢复时的权威刷新来源。Setup 只缓冲五类标准 metadata update，不回放消息/tool/plan 历史。`session_info` 不改 QuickForge title，`usage` 不映射为 QuickForge context/message usage。服务端 Harness config/mode API（`POST …/harness/config-option`、`…/harness/mode`）已接入前端 OpenCode 配置菜单，改动成功后广播 `state` SSE；运行期 `usage_update` 通过 `acp_session_usage_update` 轻量事件触发 debounce 持久化（仅持久化 `openCodeUsage` 快照），并即时刷新前端 usage badge。该 Client→OpenCode 方向与下方 `acp/server.mjs` 的 QuickForge→ACP Client 方向严格区分。
- OpenCode 消息位置能力：ACP 仅提供整会话 fork，不支持按消息位置 fork、rollback 或 retry；Web UI 对 OpenCode 仍禁用这些操作，但当前会话操作菜单已开放“复制当前会话”整会话 fork 入口，新会话通过 `sourceHarnessSessionId` 触发 ACP `session/fork` 并立即持久化。
- Provider 请求重试与流超时：主 Agent、Subagent、对话压缩和辅助模型生成默认设置 `maxRetries: 3`，即首次请求失败后最多再重试 3 次（最多共 4 次请求）；是否可重试及退避由各 Provider 实现决定，模型连通性探测显式保持不重试，`maxRetryDelayMs` 只限制服务端要求的单次等待上限。统一 AI 流包装默认等待首个实质事件 90 秒；首个实质事件（任意非 `start` 流事件，包括文本、thinking、tool call）到达后，空闲超时切换为 3 分钟，另有 20 分钟总时长硬上限。仅首个实质事件前的 idle 超时可透明重建上游流，最多重试 2 次；已有实质内容、用户中止或总时长超时均直接失败且不重建。显式 `idleTimeoutMs` / 兼容 `deadlineMs` 仍同时覆盖首事件与后续 idle 两档，但不改变“已有内容后不重试”的规则；超时会中止 Provider signal。
- Git 提交信息 AI 生成同样接收 `modelRef` 并通过统一 resolver；客户端提交的完整模型仅作兼容识别，不能覆盖 Provider Base URL 或绕过 Cloud 来源权限。
- 默认工作目录：全局会话（无 `projectId`）会合成默认 workspace 上下文（`defaultGlobalWorkspaceContext`，根目录 `~/.quickforge/workspace`，合成 project id 为 `default`），使「对话」与「项目」享有相同的文件工具（读/写/编辑/grep/命令）、工作区面板、终端和 Git 能力；文件操作受该目录沙箱约束，默认权限下读类工具放行、写入/命令/MCP/Plugin 等可能影响系统的工具走审批，完全访问权限则在既有沙箱与敏感文件限制内自动执行；`projectContextFromId` 找不到项目时同样回落到该默认 workspace。`@` 文件引用是更窄的项目会话契约，不支持合成默认 workspace/global 会话
- 工作区敏感路径保护：默认（`allowSensitive` 未开启）按大小写不敏感规则拦截 `.git`、`.env*`、密钥/证书、token、credentials/secrets 等；完成 realpath 与 workspace 边界检查后还会对真实目标再检查一次，防止内部符号链接伪装指向敏感文件。显式 `allowSensitive:true` 的既有 Workspace Inspector search/children/Reader 行为保持不变
- 消息运行（`runPrompt`）：执行 AI 对话，管理消息历史。可选 `contextReferences` 仅接受最多 8 个项目文件引用；`server/context-references.mjs` 以已恢复 session 的 `projectId/projectContext.workspaceRoot` 为权威，校验 POSIX 项目相对路径、普通文件、非敏感、realpath 不逃逸并去重，绝不读取正文。canonical `{type:'file',projectId,path,name}` 覆盖客户端伪造 details 后持久化到用户消息；本轮 transient prompt 只列相对路径并要求相关时用 `read_file` 精确读取。顶层 `selectedCapabilities` 同样不信任消息 details：`server/selected-capabilities.mjs` 仅接收合法对象/字符串，裁剪长度、按 `type+pluginName+name` 去重、保持顺序且最多 4 项，以请求体 canonical 结果覆盖实际 user message `details.selectedCapabilities`（快照只持久化 type/pluginName/name/label；空数组删除伪造或陈旧字段，保留 contextReferences 等其他 details），并由同一规范化结果生成可含 description 的本轮 capability prompt；details 经 `message-converters.mjs` 在 LLM 转换时统一剥离，用户正文、标题和复制逻辑不混入插件标签。两类本轮提示可共存且 finally 清理。retry/continue 从对应最后 user message details 读取并重新规范化 selectedCapabilities、重新校验 contextReferences，再重建两类提示后生成，因此复用原插件与文件；失效文件在截断历史前失败。OpenCode 与 Shared 非空文件引用明确拒绝；共享输出仍剥离 `details.contextReferences`，但明确保留 `selectedCapabilities` 供分享页显示历史插件标签
- SSE 事件流管理：向连接的客户端广播 Agent 事件；session/global 两类 SSE 的 keepalive/event 写失败与 request/response socket error 均记录结构化 WARN（仅 stream scope、sessionId、failure type、error name，不记录 event payload）；连接级幂等守卫确保同一连接故障只 WARN 一次、cleanup/release/end 只执行一次，正常 close 只 cleanup、不记录 failure，不改变 SSE 帧协议
- 后台任务运行（`runTask` / `abortTask`）
- Agent 恢复（`restoreAgent`）：从持久化状态恢复会话；Web 冷加载通过 `POST /api/agents/:sessionId/restore` 在一次请求中恢复并返回权威快照，`GET state` 仅在内存会话不存在时回落恢复，避免重复读取完整 Session。恢复关键路径不等待 MCP 连接/重连：restore 以 `mcpToolsMode:'cached'` 立即用当前连接快照（仅已连接 server）生成 MCP 工具（无连接时为空），同时 fire-and-forget 后台刷新（含 disconnected 重连）；工具集变化经 `subscribeMcpToolsetChanged` 订阅触发 `refreshAllSessionTools()` 重建活跃会话工具并广播 `state` 事件，新会话创建、subagent、`/api/tools` 与 `callMcpTool` 保持 await 语义
- 模型配置即时刷新（`refreshAllSessionModels`）：`custom-providers` 存储（模型定义、Max Tokens 等）经 storage 路由（PUT/DELETE key、DELETE 整 store）或备份恢复变更后，遍历内存活跃会话重新解析 model 绑定（跳过 OpenCode harness 与 streaming 中会话——后者由下一次 `runPrompt` 的 `refreshSessionModelBinding` 刷新），仅当 `session.model` 实际变化时 emit `state` 事件推送前端；模型被删除导致的解析失败只记日志并保留最后绑定，由下一条消息复现原报错。前端 `ServerAgent` 复用既有 `case 'state'` 更新 `state.model`，`useAgentManager` 同步 `activeModelRef` 并 bump `chatPanelRevision` 触发重渲染。
- Subagent 工具：`run_subagent` 在父会话内创建短生命周期临时 Agent；运行条件是父会话已解析出有效 `projectContext.workspaceRoot`，因此项目对话和合成默认 workspace 的全局对话都可使用，不再要求必须存在真实 `projectId`。可调用启用的 Agent Profile。内置 `explore` 是只读仓库调研的首选，用于文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现和影响面分析，可执行安全的检查/诊断命令但不能修改文件；内置 `general` 适合有边界的复杂多步骤实现或更广泛独立任务，可使用完整内置工作区工具但不含 MCP/Skills。自定义 Agent Profile 也可通过白名单工具执行。`run_subagent` 还支持 AI 按需传入一次性 `temporary` profile spec；服务端会校验名称、工具、`capabilityPolicy` 和模型引用，将该临时 subagent 写入 `~/.quickforge/cache/global/tmp/agents/<session>/<run>/*.md` 后再执行，并在结果 details 中返回 `profilePath`、`source`、`lifecycle`、`capabilityPolicy` 和实际模型信息。子 Agent 不作为普通会话持久化，默认不能递归调用 `run_subagent`。父会话会在内存中保留正在执行的工具快照，`getSessionState()` / SSE 初始 state 会将尚未进入权威消息历史的 `run_subagent` partial trace 和 `pendingToolCalls` 返回给刷新后的页面；该快照不写入持久化会话，也不进入 LLM 上下文，最终权威 `toolResult` 出现后自动去重清理。执行链将 `run_subagent` 的 `toolCallId` 透传至 Subagent runtime；profile/task/workspace/model 等前置校验通过后立即生成子 session ID 并记录 `started`，后续模型解析、工具创建、system prompt、Agent 构造或 prompt 任一失败均由终态守卫只记录一个 `failed`，同时保留 `timeout_triggered`、`parent_aborted`、`settled_after_abort`、`completed` 既有语义和不重复终态日志。字段仅包含 timeout/duration/toolCalls、abort 后等待与 outcome 等元数据，不记录 task/context/messages/system prompt/工具正文/profilePath/完整错误正文。Subagent 内部 AI stream retry/timeout 使用仅内部白名单日志上下文关联同一组 ID，该字段在进入 Provider 前删除
- Agent Profile 执行：`createAgent` 支持传入 `agentProfile`，在默认系统提示词后追加 profile 系统提示词，并按 `allowedTools` 限制 workspace 工具；定时任务可绑定 profile 执行。自定义 Profile 可将模型和思考等级设为继承或固定值；运行时先解析最终模型，再解析思考等级，非推理模型统一降级为 `off`。内置 Profile 的定义保持只读，模型和思考等级可通过 `agent-profile-overrides` 覆盖，设回 `inherit` 时清除对应覆盖字段。
- 工具管理：基于 Skills 和 Agent 权限模式动态构建工具列表；`generate_image` 当前已从 `workspaceTools` 移除，不再向 Agent 或 `GET /api/tools` 暴露。其 handler、图片生成模块、`directRouteDisabledTools`、会话资产路由与前端历史结果渲染继续保留，仅用于历史会话兼容。默认权限下安全读取工具自动通过，写入、命令、MCP/Plugin 等可能改变状态、产生费用或影响外部系统的工具需要审批；完全访问权限等同开发者授权，在 workspace 沙箱和命令级限制内跳过审批；`/init` 当前轮允许调研仓库、运行必要的只读命令、调用 subagent 并写入根目录 `AGENTS.md`，但仍受正常审批、工作区沙箱和敏感文件保护约束；`/plan` 当前轮使用只读白名单，仅允许读取/搜索、Skill 加载和继承同样只读边界的 subagent 辅助调研，阻止写文件、编辑文件、运行命令以及未声明为允许的 MCP/Plugin/未知工具；Shift+Tab 计划模式通过结构化 command 元数据复用同一套 `/plan` 解析、prompt 和权限，并在 retry/continue 时恢复该权限；`/review` 当前轮允许读取和运行检查命令，但阻止编辑文件和 subagent 执行，用于提交前自检；`/commit [message]` 使用同样的无编辑/无 subagent 权限，只允许命令执行以验证、显式暂存当前任务文件并最多创建一个本地 commit，禁止 push/tag/release。
- 对话压缩（`compactConversation`）：手动 `/summary` 会创建总结后的新会话并保留原会话；手动 `/compact` 与自动上下文压缩保持一致，会在当前会话内生成/更新滚动摘要，只影响 Agent loop 输入，完整历史仍保留用于 UI 展示和持久化。自动上下文压缩会在模型请求前按配置阈值触发同一套当前会话内压缩。
- 上下文统计：`contextUsage` 由 `estimateSessionContextUsage()` 计算；存在 `contextCompaction` 时先构造 `summaryMessage + messages.slice(compactedUpToIndex)`，因此统计口径是压缩后的模型实际上下文，而不是完整可见聊天历史。底层 token 估算复用 `@earendil-works/pi-agent-core` 的 `estimateContextTokens()` / `estimateTokens()`，provider usage 与 `contextWindow` 来自 `@earendil-works/pi-ai` 的 assistant `usage` 和 model 元数据；上下文占用按纯输入口径统计——`percent = inputTokens / contextWindow`，真实请求的 max_tokens 由 pi-ai `clampMaxTokensToContext` 按窗口收缩，统计侧不再预留输出 token；压缩完成后会忽略保留尾部中仍代表压缩前完整上下文的旧 provider usage，先按摘要与尾部重新估算，并在压缩后产生新 assistant usage 时恢复 provider 权威口径，确保完成事件和 UI 百分比立即反映压缩效果。自动压缩阈值判断同样按纯输入占用，通过百分比配置转换为 reserve tokens 后复用 `pi-agent-core.shouldCompact()`。返回值保留 `totalTokens` 字段（恒等于 `inputTokens`，兼容消费者），并提供 `breakdown.systemPromptTokens`、`breakdown.toolsTokens`、`breakdown.messagesTokens`、`breakdown.providerUsageTokens`、`breakdown.trailingTokens`、`isCompacted`、`originalMessageCount` 和 `effectiveMessageCount`；此外 `breakdown.skillsTokens` 仅在 `activate_skill` definition 的名称枚举证明会话存在已启用 Skills 时，从系统提示词中选择包含全部启用名称的最后一个系统生成 `<available_skills>` catalog（固定介绍结构，且包含全部启用名称），并归集 Skills 工具定义及其已关联调用/结果，项目或用户指令中的同名伪标签不会计入；`breakdown.mcpTokens` 仅归集 `tool.mcp` 为非数组对象且 `serverName` / `toolName` 为非空字符串，或名称按 `mcp/tool-name.mjs` 的真实 server 规范与 tool sanitize/encode 规则严格重建后与原字符串完全相同的 MCP definition，再统计对应 assistant toolCall/result。result 有非空 `toolCallId` 时只按已识别 MCP call ID 关联（不匹配即拒绝，不再降级到名称）；ID 缺失或空时才允许按已识别 canonical MCP `toolName` 关联；ID/name 都缺失时才以真实 `details: { mcp: true, server, tool }` 完整结构回退。Skills/MCP 是跨前三类的来源归因字段，不参与 `estimatedInputTokens`、`inputTokens` 或百分比二次相加。
- 自定义命令处理
- 内部命令 `/skill` / `/agent`：`resolveCommandState` 在 `handleInternalCommand` 之前拦截（两者需要会话上下文）。`/skill` 校验名称属于会话已启用技能（与 `activate_skill` 工具同一来源：`loadSkillToolContext` 的全局 + 项目已选技能，含插件技能，项目覆盖全局同名），任务可省略（提示词让模型激活技能后询问用户）；`/agent` 要求名称和任务都存在，名称按会话 workspaceRoot 解析为已启用 subagent 的 Agent Profile（含项目级 `.claude/agents`、`.quickforge/agents`）。校验失败以文本消息返回用法与可用列表（已启用技能 / 可用 subagent）；通过则注入对应 commandPrompt 且不附加 permissions（保持会话默认权限）。内部命令优先于同名自定义命令
- 工具权限检查
- 会话活动跟踪（`touchSession`）
- Agent 销毁和资源清理；OpenCode Harness 会关闭 ACP session/transport 并终止子进程
- Harness 选择、恢复与派生约束见 [`docs/architecture/agent-harness-selection.zh-CN.md`](../../architecture/agent-harness-selection.zh-CN.md)

### acp/ — ACP Agent 适配层

**用途**: 通过 `@agentclientprotocol/sdk` 的 `AgentSideConnection` 将 QuickForge 暴露为 stdio ACP Agent。入口命令为 `quickforge acp` / `qf acp`，供支持 ACP 的 IDE/客户端启动并通信。

**核心文件**:
- `acp/server.mjs` — 创建 stdio ACP 连接，处理 `initialize`、`session/new`、`session/load`、`session/set_config_option`、`session/prompt`、`session/cancel`、`session/list`、`session/delete`、`session/close` 和 `document/didOpen` / `didChange` / `didSave` / `didClose` / `didFocus`，并把 QuickForge Agent 事件转换为 ACP `session/update`。

**行为约束**:
- ACP stdio：`quickforge acp` 在创建 Agent 前先完成 JSON storage 与 SQLite 基础库初始化，连接关闭或启动失败时在 `finally` 幂等关闭 SQLite；动态导入避免 public-api 先设置 dataDir 的时序被顶层 import 固化。
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
│   ├── agent-profile-overrides.json # 内置 Agent 的模型/思考等级覆盖
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
- 会话分桶存储（按 scope 和 projectId）：global metadata 为 `storage/conversations/global/sessions-metadata.json`，每个完整会话为 `storage/conversations/global/sessions/<sessionId>.json`；project 对应 `storage/conversations/projects/<projectId>/sessions-metadata.json` 与 `sessions/<sessionId>.json`。会话图片资产位于同一 bucket 的 `assets/<sessionId>/`，永久删除会话时同步清理
- `readSessionStoreScoped` — 作用域会话查询
- `readPhysicalSessionMetadataBuckets` — 按真实文件路径枚举所有 metadata bucket，路径决定 scope；供可重建索引使用，不读取敏感文件
- `atomicSessionMetadataUpdate` 与 bulk `writeStore('sessions-metadata')` 在 JSON 原子提交后调用可注册 best-effort hook；hook 失败不改变 JSON 成功语义
- 写操作的原子锁队列
- 目录大小计算

### sqlite/ — SQLite 存储基础层

**用途**: 为后续业务表提供统一的 `node:sqlite` 文件连接、PRAGMA、append-only migration、同步事务与 health；详细设计见 [`docs/architecture/sqlite-storage-foundation.zh-CN.md`](../../architecture/sqlite-storage-foundation.zh-CN.md)。

- 默认路径 `<QUICKFORGE_DATA_DIR 或 ~/.quickforge>/storage/quickforge.sqlite3`；内部支持 `dataDir` / `databasePath` 测试覆盖，不新增公开环境变量。
- 当前 migration 1 创建 `schema_migrations`；migration 2 创建 F3 `scheduled_task_runs`；migration 3 原子重建为 `(task_id,id)` 复合主键，增加 unknown/legacy/source/updated 字段、全局稳定索引、cutover 状态和维护锁表。F5 权威切换设计见 [`docs/architecture/scheduled-task-runs-authoritative-cutover.zh-CN.md`](../../architecture/scheduled-task-runs-authoritative-cutover.zh-CN.md)。migration 4 创建 F6 `session_index` 可重建派生表与 bucket/partial indexes，设计见 [`docs/architecture/session-index-foundation.zh-CN.md`](../../architecture/session-index-foundation.zh-CN.md)。migration 5 增加 F7 查询索引；migration 6 创建 F8 `session_states`/tombstone/`session_storage_state`/mirror outbox/维护锁表；migration 7 创建 F9 `session_messages` 按会话分片增量消息表，设计见 [`docs/architecture/session-state-transactional-storage.zh-CN.md`](../../architecture/session-state-transactional-storage.zh-CN.md)。migration 8 创建 F10 `share_sessions`（严格列映射 + extra_json 不透明字段 + `record_digest` + deleted_at tombstone）、`share_tokens`（UNIQUE(share_id,token_hash)、≤50 条）、`share_storage_state`/`share_maintenance_lock`/`share_json_mirror_queue` 独立存储域表，设计见 [`docs/architecture/share-token-storage-migration.zh-CN.md`](../../architecture/share-token-storage-migration.zh-CN.md)。migration 9 创建 F11 `lan_access_state`（单配置行，含历史 `record_digest`）、`lan_access_tokens`（token_id PK + seq 插入序，≤100 写入裁剪）、`lan_access_storage_state`/`lan_access_maintenance_lock`/`lan_access_json_mirror_queue` 独立存储域表，设计见 [`docs/architecture/lan-access-storage-migration.zh-CN.md`](../../architecture/lan-access-storage-migration.zh-CN.md)。migration 10 为 `session_states` 元数据覆盖索引（历史，见下）；migration 11 为会话域存储 v2 重建——新三表 `sessions`（小行：提升列 + body_json/meta_json）、`session_messages`（逐行消息，`UNIQUE(…, message_id)` + FK CASCADE）、`session_tombstones`（极小墓碑），旧 6 张会话域表 RENAME 为 `*_v10_backup` 保留，设计见 [`docs/architecture/session-storage-v2.zh-CN.md`](../../architecture/session-storage-v2.zh-CN.md)。migration 12（`remove_share_lan_record_digests`）在一个 migration 事务中物理删除 `share_sessions.record_digest` 与 `lan_access_state.record_digest`；当前 Share/LAN 表不含在线行派生哈希，v8/v9 的相关列仅属历史 schema。
- 统一校验 `busy_timeout=5000`、`foreign_keys=ON`、`journal_mode=WAL`、`synchronous=NORMAL`（2026-08-26 用户决策切回，覆盖 §3.1 早前 FULL 定案：接受 OS 崩溃/断电回滚 checkpoint 以来已提交事务的有界窗口，进程崩溃安全）、`auto_vacuum=INCREMENTAL`（仅新库生效，配合删除后 `incremental_vacuum` 回收空间）；migration 使用 `BEGIN IMMEDIATE`、`PRAGMA user_version` 和同事务记录。
- 会话域存储 v2 单一事实文档（三表布局、写入/删除/空间回收、一次性 JSON 导入、逃生通道、已知取舍）见 [`docs/architecture/session-storage-v2.zh-CN.md`](../../architecture/session-storage-v2.zh-CN.md)；v1"当前架构"文档（mirror/phase/cutover/background-migration，已全部移除）与上述 F2/F6/F7/F8 设计文档均保留为历史决策记录。
- `transaction()` 默认 immediate，支持 deferred/exclusive 和嵌套 SAVEPOINT；callback 必须同步，Promise/thenable 会回滚并拒绝。
- `scheduled-task-runs-repository.mjs` 所有单行操作使用 `(taskId,runId)`；提供 idempotent full upsert、事务 `replaceAll`、unknown/legacy round-trip、复合键裁剪、当前 task IDs 与 task-title keyword IDs 过滤，以及 `started_at,id,task_id DESC` 的真实 SQL count/page。
- `scheduled-runs-cutover.mjs` 在 SQLite 初始化后执行逻辑 backup、JSON 全量校验/digest、SQLite replace/验证、pending 提交与 JSON 瘦身；维护锁和 phase 支持多进程及崩溃恢复。authoritative 常规启动不绑定 SQLite health/`quick_check`，数据库打开、schema 与 migration 门禁统一由 `initializeSqliteStorage()` 负责。
- `scheduled-task-runs-service.mjs` 在 hybrid 保留 JSON-first best-effort 影子；pending/authoritative 下 SQLite 是唯一 runs 权威，task API 仅按需补最近 5 条，history 直接 SQL 分页且隐藏孤立行。
- `scheduled-runs-backup.mjs` 保持 backup version 1：权威模式将 SQLite runs 逻辑挂回 scheduledTasks；restore 拆分 metadata/runs，使用维护 gate、补偿和持久化计划文件。
- `session-index-repository.mjs`（存储 v2 重写）为 `sessions` 表的**只读直查层**：`session_index` 派生表已退役（migration v11 RENAME），权威表自身携带提升列表列；提供 LIMIT/OFFSET `listPage` 与 count（scope/archive/pinned 过滤 + 排序，`lastModified` 排序经 `json_extract(meta_json)` 保持历史列表序），无 sync/shadow/rebuild。`session-index-service.mjs` 相应为直查消费层，不再从 JSON buckets rebuild 或经 storage hook 增量同步。
- `session-state-repository.mjs`（存储 v2 重写）以复合 bucket key 写入 `sessions` 小行 + `session_messages` 消息行，单个 immediate 事务内原子提交（CAS revision/stateVersion → UPSERT sessions 行 → 消息写入 → 同事务重算 message_count）；`save` 统一抽取任何 body 携带的 `messages` 数组（body_json 永不内联消息、带 `messageStorage:'split'` 标记），`replaceMessages`/`appendMessages` 提供 replace/append 两种行写入模式（append 按 `message_id` IN 分批去重，无 id 整批尾 digest 一致时跳过重试批）；`readMessagesPage`（seq 稳定排序，offset/afterSeq，≤5000 行/页）、`messageCount`、`exportSnapshot`/`verifyIntegrity`（快照 digest 覆盖消息表）；delete 走 FK CASCADE 级联删消息行 + 墓碑 + 事务外 best-effort `incremental_vacuum(512)` 回收空间。消息编码经 `sqlite/canonical-json.mjs` 单遍 canonical 序列化器（与旧 round-trip+canonicalize+stringify 流水线字节级等价，差分测试 `tests/server/canonical-json.test.mjs` 钉死），`encodeMessagesChunked` 分批（默认 50 条）编码并在批间 `setImmediate` 让出事件循环，replace 输入可携带对齐的 `messagesEncoded` 预编码行跳过事务内同步编码（该旁路仅读 messages 长度做对齐校验，不对 messages 做深拷贝——编码产物字符串在编码瞬间即为不可变快照），`normalizeRecord` 对 body 仍深拷贝——大会话持久化的编码 CPU 不再一次性独占事件循环（SQLite 事务本身仍同步原子）。
- `session-state-service.mjs`（存储 v2）恒走 SQLite repository（无 phase 路由、无 mirror drain）；`messageStoragePlan` 决定增量写计划（body-only / replace / append：长度对齐时尾 digest + 中部采样校验，防中部原位编辑丢失）；`saveSessionStatePair` 为 async 且带 `expectedRevision`（CAS 保护）时走 `savePairChunked`：入口对 messages 浅拷贝冻结调用时快照（防让出间隙调用方 push 进后续编码批次），先分批让出式编码（`encodeMessagesChunked`）再跑同步事务，yield 间隙的并发写入由 revision CAS 转为 conflict 重试；`synchronize` 只深拷贝 body、messages 仅浅拷贝（写入字节与全量深拷贝路径一致）；无 CAS 的调用方保持全同步 `savePair` 路径。返回 `messageStoragePlan`/`messageCount`，`storedMessagesState`（行数 + 尾部行 digest）供 agent-manager 冲突检测；`readSessionMetadataBuckets` 只读 `meta_json` 投影（不物化正文与消息行）；`readSessionStorageState` 返回常量 `authoritative` + 实时会话数。启动链见下条 import。
- `session-state-import.mjs`（存储 v2 新增）执行一次性 JSON 导入：空库 + 物理会话 JSON 文件存在时（`server/index.mjs` 启动链在维护窗口内触发），流式遍历旧 JSON 树、每会话一个事务幂等 `repository.save`、失败条目 skipped + diagnostics 不中断整体、结束 WAL checkpoint；JSON 全程只读。用户重导路径 = 删库文件（及 `-wal`/`-shm`）重启。`session-state-maintenance.mjs`（自退役的 cutover 模块抽出）持有 `session_state_maintenance_lock` 跨进程维护锁（owner 存活 + fencing + TTL 心跳），供 restore/verify 维护操作串行。
- `agent-manager.mjs`（Phase 3）维护 `persistedMessageStorage`/`persistedMessageCount`/`persistedTailDigest`：权威保存显式按 plan 传 delta（append/replace），CAS 冲突按拆分表示（body 规范化 + 消息行 count/tail digest）判定 agent-owned 变更；`getSessionState` 增加 `messageStorage` 字段；拆分会话的 SSE `state`/`message_end`/`agent_end`/`messages_replaced` 帧只发 `messagesSummary` 与增量尾部（`messagesAfter`/`messagesIncremental`），不再携带全量 messages；路由新增 `GET /api/agents/:id/messages?after=N` 分页拉取，`GET /state`、`POST /restore` 与 SSE 初始 state 帧对拆分会话下发轻量 summary（stateVersion 语义不变）。存储 v2 下所有会话均为拆分表示（消息恒在 `session_messages`）。
- `share-store.mjs` 为分享记录/令牌的读写入口：`pending`/`authoritative` 下全部读写路径经 `share-repository`（单事务、CAS 409、supersede/revoke/update/delete 失效事件、7天/≤50/authVersion 语义），`json_authoritative`/`cutover_running` 保留旧 JSON 读写；authoritative 下 JSON 文件降级为 best-effort mirror（经 `share_json_mirror_queue` drain 物化，文件保持可读）；维护锁持有期间写路径返回 423。`share-repository.mjs` 提供 `share_sessions`/`share_tokens` 严格对象映射与白名单、单事务 create/update、CAS revision、read/list、restore/tombstone delete、token issue/verify/prune 与不透明字段 roundtrip：同 session 其他记录被 supersede 时置 revoked/superseded、清 tokens 且 `authVersion+1`；更新当前记录未提供密码字段时保留 tokens，密码变化时清 tokens；issue/prune 同步 `updatedAt`/revision/mirror，issue 另更新访问计数与最后访问时间。snapshot count/digest 仅用于 cutover、backup/restore/export 和离线维护边界，不是在线行权威。
- `share-service.mjs` 提供 F10 独立 share 域 phase 状态机（`json_authoritative`/`cutover_running`/`sqlite_authoritative_json_pending`/`authoritative`，表 `share_storage_state`）与 `share_json_mirror_queue` 镜像 drain（默认镜像物化到 `shares/conversation-shares.json`，保留作为 mirror/backup）；提供 `getShareRepository()` 与 `requireShareJsonAdapter`。`server/index.mjs` 启动链在 session state 初始化之后接入 `initializeShareCutover() → initializeShareService() → recoverShareRestorePlan() → drainShareJsonMirror()`；pending/authoritative 常规启动只 drain 事务性 mirror outbox，不全表扫描、不绑定 `quick_check`。`shutdownRuntime` finally 调 `stopShareService()`。
- `share-cutover.mjs` 执行 share JSON→SQLite cutover：`buildShareJsonSnapshot` 全量校验（shareId/sessionId 必填、tokens 数组结构、password 哈希字段一致、重复 shareId blocker），双快照 count/digest 校验、v1 backup 重读、`replaceAll`+pending 原子提交与失败保持 pending；首次提交后做严格快照/关系校验，后续常规 pending/authoritative 启动不复算 digest。使用独立 `share_maintenance_lock`（PID+expiry+fencing+heartbeat）。
- `session-state-backup.mjs` 提供权威导出（维护锁内 quick_check + count/digest 校验）与带计划文件/补偿的 restore（merge/replace、startup roll-forward/rollback recovery）；Phase 3 修复 `snapshotValues` 对「已组装」拆分会话记录的 messages 清空问题，拆分会话 backup/restore 后 digest 精确往返。
- `share-backup.mjs` 提供 share 独立域的权威导出（share 维护锁内 quick_check + verifyIntegrity + exportSnapshot，count/digest fail closed）与带计划文件/补偿的 restore（`share-restore-plan.json`，merge 保留 local-only / replace 全量替换，startup `recoverShareRestorePlan` roll-forward/rollback）；只触碰 share 三表，不破坏 F5/F7/F9；v1 conversation-shares.json 形状导入归一化。
- `lan-access-store.mjs` 为 LAN 访问配置与令牌的读写入口；`pending`/`authoritative` 下读写路径经 `lan-access-repository`（单事务、CAS 409、settings authVersion+1 清 tokens 与配置更新同事务、unlock 签发+裁剪≤100 同事务、verifyToken 版本号+常数时间哈希 fail-closed），`json_authoritative`/`cutover_running` 保留旧 JSON 读写；authoritative 下 `security/lan-access.json` 降级为 best-effort mirror（经 `lan_access_json_mirror_queue` drain 原子物化）。`lan-access-repository.mjs` 提供当前不含 `record_digest` 的 `lan_access_state` 严格列映射 + `extra_json` 未知字段 roundtrip、`lan_access_tokens`、单事务 settings/issue、CAS revision、单条 revoke/logout revoke/revoke-all、`replaceAll`/`exportSnapshot`/`verifyIntegrity`/`count`/`digest` 与 mirror 队列；snapshot count/digest 仅用于 cutover、backup/restore/export 和离线维护边界。
- `lan-access-service.mjs` 提供 F11 独立 lan-access 域 phase 状态机（`lan_access_storage_state`）与 `lan_access_json_mirror_queue` 镜像 drain（默认 mirror 物化到 `security/lan-access.json`，原子 tmp+rename 保留可读）；提供 `getLanAccessRepository()`。`server/index.mjs` 启动链在 share 之后接入 `initializeLanAccessCutover() → initializeLanAccessService() → recoverLanAccessRestorePlan() → drainLanAccessJsonMirror()`；pending/authoritative 常规启动只 drain 事务性 mirror outbox，不全表扫描、不绑定 `quick_check`。shutdown `stopLanAccessService()`。
- `lan-access-cutover.mjs` 执行 LAN access JSON→SQLite cutover：`buildLanAccessJsonSnapshot` 整包校验（enabled/passwordHash 成对、tokens 数组结构、损坏/缺文件 ENOENT 兜底默认禁用配置），双快照 tokenCount/digest 校验、v1 backup 重读、`replaceAll`+pending 同事务与失败保持 pending；首次提交后做严格快照/关系校验，后续常规 pending/authoritative 启动不复算 digest。使用独立 `lan_access_maintenance_lock`（PID+expiry+fencing+heartbeat）。
- `lan-access-backup.mjs` 提供 lan-access 独立域的权威导出（lan-access 维护锁内 quick_check + verifyIntegrity + exportSnapshot，count/digest fail closed，配置含 token 哈希非明文、剔除 revision）与带计划文件/补偿的 restore（`lan-access-restore-plan.json`，replace 全量 / merge 保留本地配置字段与 tokens、backup 同 key 覆盖，恢复覆盖 enabled 开关，startup `recoverLanAccessRestorePlan` roll-forward/rollback）；只触碰 lan-access 三表，不破坏 F5/F7/F9/F10；v1 lan-access.json 形状归一化导入。
- `sqlite/database.mjs` 的 `runSharedSqliteQuickCheck()` 为首次 cutover、权威 backup/export、显式完整性维护和离线工具等边界统一执行 `PRAGMA quick_check`：进程内按数据库路径去重 + 数据库同目录 marker 文件（`quickforge-quick-check.marker.json`，7 天内跳过真扫），失败照抛且不写 marker 不缓存；`verifyIntegrity` 支持 `forceQuickCheck`，环境变量 `QUICKFORGE_SQLITE_QUICK_CHECK=force` 可全局强制真扫。它不再服务“四域 authoritative 常规启动扫描”；Share/LAN 常规启动只 drain outbox，scheduled-runs 的数据库门禁由 `initializeSqliteStorage()` 统一负责（详见 `docs/architecture/sqlite-storage-foundation.zh-CN.md` §6.1）。
- `server/maintenance/export-scheduled-runs-v1.mjs` 提供停机离线 `quick_check` + 完整 runs v1 导出；不复制 live DB/WAL/SHM。
- `server/maintenance/export-session-state-v1.mjs` 提供停机离线会话权威 v1 导出（`sessionState` phase/count/digest envelope，phase 恒 `authoritative`；拆分会话导出时重组完整 body）。
- `server/maintenance/downgrade-session-state-v1.mjs`（存储 v2 重写）提供停机**纯导出**逃生通道：把权威 SQLite 会话库物化回 v1 JSON 布局（逐会话 body 文件 + 每桶 `sessions-metadata.json`，拆分会话重组完整 body，清理已删会话的残留文件）；`--dry-run` 只读报告。不再切换 phase——SQLite 恒权威，导出的 JSON 是供旧版本/人工读取的副本。
- `server/maintenance/export-share-v1.mjs` 提供停机离线 share 权威 v1 导出（`shareState` phase/count/digest envelope，记录含 token 哈希，`cutover_running`/`json_authoritative` 拒绝）。
- `server/maintenance/downgrade-share-v1.mjs` 提供停机 share 降级：`--dry-run` 只读、默认 drain 物化完整 `conversation-shares.json` 并对拍 SQLite 快照 digest、`--commit` 校验后切回 `json_authoritative`。
- `server/maintenance/export-lan-access-v1.mjs` 提供停机离线 lan-access 权威 v1 导出（`lanAccessState` phase/count/digest envelope，配置含 token 哈希非明文、剔除 revision，`cutover_running`/`json_authoritative` 拒绝）。
- `server/maintenance/downgrade-lan-access-v1.mjs` 提供停机 lan-access 降级：`--dry-run` 只读、默认 drain 物化完整 `security/lan-access.json` 并对拍 SQLite 快照 tokenCount/digest、`--commit` 校验后切回 `json_authoritative`。
- 业务模块只能使用受控 handle，不得自行关闭连接或改基础 PRAGMA；生命周期由 Server/ACP runner 管理。MED-9 已解决：authoritative history 的 total/page/filter 在 SQLite 中完成。

### auto-archive.mjs

**用途**: 按设置自动归档长期未更新的历史对话。

- 设置保存在 `settings['auto-archive-settings']`，默认关闭。
- 开启时立即扫描，服务启动时检查一次，之后每 24 小时检查一次。
- 以 metadata、完整会话及消息时间戳中的最新活动时间判断是否超过 30 天；归档写入用 revision CAS 并在写入前再次校验，避免旧 metadata 造成误归档（SQLite 权威模式下会话持久化按 session 分锁，与归档 runner 不再共用全局队列，交错正确性由 CAS + 写前重校验保证；JSON 镜像模式两者仍共用全局锁）。
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

### skills.mjs (654 行)

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
- `summarizeSkills()` — 导出的摘要函数（剥离 instructions/rootDir/location），`/api/skills?available=true` 合并视图与 `loadSkillToolContext` 共用同一口径
- Skill 验证：标准 Skill 必须以目录内固定入口 `SKILL.md` 提供非空正文；其 frontmatter `name` 是唯一权威 ID，会按 `trim + lowercase` 归一化并继续执行 slug/长度校验，Skill 目录名可与该 ID 不同。同名发现与覆盖均按 canonical `name` 判断，资源仍从实际 Skill 目录读取；`description` 仍需非空且不超过 1024 字符。配置中的 `SDD` 和工具调用 `activate_skill({ name: 'SDD' })` 会匹配 frontmatter `name: SDD` 归一化后的内部 `sdd`；面向用户的名称应使用 `metadata.displayName`（兼容 `metadata.title`），而不是依赖目录名或改变 canonical ID。旧 `skill.json` fallback 规则保持不变。

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
- `mcp/tool-name.mjs` — MCP server canonical 规则与工具名 sanitize/encode/parse helper；registry 生成名称与 context usage 严格回退判定共用，避免规则漂移。
- `mcp/config.mjs` — MCP Server 配置读写和校验，配置存放在独立的 `mcp` store（`config/mcp-servers.json`，内部 key 仍为 `mcpServers`）；兼容 `mcpServers` JSON 导入、`type`/`transport` 和远程 `headers` 配置。
- `mcp/registry.mjs` — stdio/SSE/Streamable HTTP 连接生命周期、工具发现、工具调用转发、关闭清理；支持全量刷新（`refreshMcpConnections`，对 error 状态有重试退避；可选 `reconnectDisconnected:true` 让 `disconnected` 连接也走 delete+close+重连，供后台刷新恢复被动断开的 server）和单 server 强制重连（`reconnectMcpServer`，绕过退避）；`createMcpToolDefinitions` 可选 `waitForConnections:false`：立即用当前连接快照（仅已连接 server）生成定义并 fire-and-forget 后台刷新；`subscribeMcpToolsetChanged(callback)` 返回退订函数，每次刷新完成后比较已连接 server 工具集签名（`${serverName}::${toolName}` 排序 join），变化时通知订阅者（无订阅者只更新基线）；single-flight 刷新期间 options 以首个调用方为准；连接、工具发现或工具调用超时后会取消请求并关闭异常 transport，后续调用再重连。
- `routes/mcp.mjs` — `/api/mcp/servers`（列表与 upsert 单个）、`/api/mcp/config`（批量导入 merge/replace）、`/api/mcp/reconnect/:name`（单 server 重连）、启停开关与删除等管理接口。

**行为约束**:
- 当前支持 `stdio`、`sse` 和 Streamable HTTP (`http`) transport。
- MCP 工具注入时使用 `mcp__{serverName}__{toolName}` 命名空间，避免和内置工具重名。
- YOLO 关闭时，MCP 工具调用需要用户审批；YOLO 开启时允许直接调用。
- restore 非阻塞 MCP：`POST /api/agents/:id/restore` 及经 `restoreAgent` 的回落入口（state/messages/status/SSE）以连接快照构建 MCP 工具，不等待（重）连接；`waitForConnections:false` 触发的后台刷新会以 `reconnectDisconnected:true` 重连被动断开的 server，工具集签名变化时通知订阅者（agent-manager 据此重建活跃会话工具），配合服务启动后的 MCP 预热共同保证恢复会话最终拿到完整工具集。

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
- `routes/system.mjs` — 系统状态、服务重启、关于信息和 QuickForge Runtime 更新 API；`GET /api/system/update/check` 检查 npm 分发的 Runtime 版本（非阻塞状态快照：立即返回 checking/ok/error，registry 后台刷新，弱网失败不再 500，前端 `src/lib/update-check-poll.ts` 轮询），`POST /api/system/update` 仅允许 localhost 请求并要求 `x-quickforge-action: update`，会启动外部 `update-supervisor.mjs`，让当前服务退出后再执行全局 npm 更新并自动重启；Desktop 客户端更新不走该 npm 更新入口，而是通过 GitHub Releases / 桌面包分发。

**PTY 运行时加载**:
- `loadPty()` 优先加载仓库自带的 vendored 运行时 `vendor/node-pty/lib/index.js`（约 5MB，含 win32-x64/arm64、darwin-x64/arm64 四平台预编译，由 `scripts/vendor-node-pty.mjs` 从 node-pty devDependency 同步生成，来源版本记录在 `vendor/node-pty/VENDOR.json`）；失败时回退 `require('node-pty')`（如用户自装），两者皆不可用时 capabilities 返回 503 降级，报错文案见 `PTY_UNAVAILABLE_MESSAGE`。
- vendored 目录带 `{"type":"commonjs"}` package.json 标记（仓库根是 ESM），布局与上游一致（`lib/` 与 `prebuilds/<platform>-<arch>/` 为兄弟目录，`lib/utils.js` 的 `loadNativeModule` 按相对路径解析），二进制为 N-API 构建，跨 Node 版本 ABI 稳定，无需安装期编译。
- 上游 node-pty 1.1.0 未提供 Linux 预编译：Linux 上终端依赖外部安装 node-pty（npm 包已不再自动安装该依赖），缺失时优雅降级；win32/darwin 开箱即用。macOS 上 node-pty 会直接 `posix_spawn` 执行 `prebuilds/darwin-*/spawn-helper`，因 Windows 打包的 tarball 会丢失可执行位，`loadPty()` 成功加载 vendor 后经 `ensureVendoredSpawnHelperExecutable()` 在 darwin 上自愈补执行位（git index 已对这两个文件标记 100755，Windows 重新生成后需重设，见 vendor README）。
- 许可合规：上游 MIT `LICENSE` 与 `licenses/` 下的 winpty/conpty 第三方文本随 vendor 目录分发。

**安全边界**:
- 终端接口强制仅允许 localhost 访问；LAN 分享和共享会话页面不能访问。Windows Desktop 默认启用本地终端。
- 终端运行在本机用户权限下，不是沙箱；默认 cwd 为当前项目目录。
- `QUICKFORGE_TERMINAL=0` 可关闭终端，`QUICKFORGE_MAX_TERMINALS` 可调整最大会话数；`QUICKFORGE_TERMINAL_RECONNECT_MS` 可调整最后一个客户端断开后的 PTY 保留时间，默认 30 分钟。
- 终端 Shell 配置保存在 `settings` store 中：系统会按平台和可执行文件可用性自动识别常见内置 profiles（Windows: cmd/PowerShell/pwsh；macOS/Linux: zsh/bash/fish/sh/pwsh），`terminalShellProfiles` 仅存放自定义 profiles，`defaultTerminalShellProfileId` 存放默认 profile；兼容旧的 `terminalShell` 字段。
- `QUICKFORGE_TERMINAL_SHELL` 优先级最高，会覆盖 UI 中的默认 profile 和新建终端时选择的 profile。

### update-supervisor.mjs

**用途**: 设置页一键更新的外部更新器。由当前后端以 detached 子进程启动，等待旧服务退出后，在数据目录下执行 `npm install -g <package>@latest`，将 npm 输出写入 `~/.quickforge/logs/update-*.log`，成功后重新启动后端服务。这样避免 Windows 上“运行中的服务更新自己”导致安装目录文件被占用。

### share-store.mjs (432 行)

**用途**: 对话分享的持久化和访问控制。

> F10 Phase 2：`pending`/`authoritative` 下全部读写经 `share-repository`（SQLite 单事务，JSON 文件降级为 best-effort mirror）；`json_authoritative`/`cutover_running` 保留旧 JSON 路径；维护锁持有期间写返回 423。API shape 不变。

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

### ai-http-logger.mjs (635 行) / ai-provider-options.mjs

**用途**: 服务端 → 模型供应商 API 的流包装层。`streamSimpleWithAiHttpLogging` 包装 pi-ai `streamSimple`：AI HTTP 日志（`QUICKFORGE_AI_HTTP_LOG`，AsyncLocalStorage trace + header 脱敏 jsonl）、quickforge-cloud 托管模型懒解析（忽略客户端可控 transport 字段、首尝试用持久化幂等键）、流超时治理。默认首个实质事件（任意非 `start` 流事件，包括 text/thinking/toolcall delta）等待 90 秒；产出实质内容后 idle 预算为 3 分钟，total 硬上限为 20 分钟。仅首个实质事件前的 idle 超时会透明重建底层流，`MAX_STREAM_RETRIES=2`：每次尝试使用独立 AbortController（换流时打断上一次挂起连接，total timeout 跨尝试共享且不重置）、托管云重试换新随机幂等键、对外吞掉重试流的重复 `start`，`result()` 等待者跟随当前流迁移；重试进度经 `options.onStreamRetry` 上报 attempt/maxAttempts，新流首个实质事件上报 `recovered:true`，前端按动态上限显示「模型连接重试中… n/2」。一旦已有实质内容，后续 idle 直接失败且不重建；用户 parent signal 已 abort、total timeout 或重试额度用尽也不重试。显式 `idleTimeoutMs` / 兼容 `deadlineMs` 仍令首事件与后续 idle 两档同值，但不改变已有内容后不重试的规则。超时按原路径报 `AI stream idle/total timeout after Xms` 并中止 Provider signal；openai SDK 层的 `maxRetries=3` + 120s timeout 只覆盖请求建立阶段，流建立后的挂死由本层负责。

### auto-compaction.mjs

**用途**: 自动上下文压缩。读取 `settings['auto-compact-settings']`，在 Agent 每次请求模型前按压缩后的有效上下文估算占当前模型 `contextWindow` 的比例；token 统计复用 `@earendil-works/pi-agent-core.estimateContextTokens()` / `estimateTokens()`，模型 `contextWindow` 和 assistant `usage` 来自 `@earendil-works/pi-ai`，占用按纯输入口径（`inputTokens / contextWindow`）计算，真实请求的 max_tokens 由 pi-ai `clampMaxTokensToContext` 按窗口收缩，统计不再预留输出 token；阈值判断通过 QuickForge 百分比配置转换为 reserve tokens 后复用 `pi-agent-core.shouldCompact()`；超过阈值时生成滚动摘要。后端同时在 session state 中返回同一口径的权威 `contextUsage`，聊天底部上下文百分比优先展示该值；压缩完成后立即丢弃摘要前旧请求留下的 provider usage 基线，待压缩后新 assistant usage 到达再恢复 provider 统计，因此百分比会马上下降并保持后续准确。触发只发生在下一次模型请求前，并会受最小历史长度、最近拒绝、压缩间隔等保护条件限制；已有压缩后只要出现新消息即可再次检查，不再固定等待三条新增消息。自动压缩采用“双轨”模式：完整 `messages` 继续持久化并展示在 UI 中，后续 Agent loop 只使用最新 compact summary 与最近若干用户回合。

### context-references.mjs

**用途**: `@` 文件引用（`contextReferences`）的服务端校验与提示合成，被 `agent-manager.mjs` 的 `runPrompt` 与 `routes/agent.mjs` 复用。

**导出**:
- `MAX_CONTEXT_REFERENCES`（=8）/ `CONTEXT_REFERENCES_DETAILS_KEY`（=`'contextReferences'`）— 引用上限与用户消息 `details` 持久化键
- `validatePromptContextReferences()` / `validateContextReferences()` — 以已恢复 session 的 `projectId` / `projectContext.workspaceRoot` 为权威校验引用：必须是 POSIX 项目相对路径（拒绝反斜杠、绝对路径、盘符、控制字符、空/`.`/`..` 段，长度 ≤1024）、普通文件、非敏感（复用 `assertSafeWorkspacePath`，含 realpath 后复查）、去重；全程 **不读取文件正文**。workspace 层错误经 `mappedWorkspaceError()` 映射为稳定错误码：`CONTEXT_REFERENCE_SENSITIVE` / `CONTEXT_REFERENCE_OUTSIDE_PROJECT` / `CONTEXT_REFERENCE_NOT_FOUND` / `CONTEXT_REFERENCE_FORBIDDEN` / `CONTEXT_REFERENCE_VALIDATION_FAILED`；形状/数量错误为 400 `CONTEXT_REFERENCES_INVALID` / `CONTEXT_REFERENCES_LIMIT`
- `contextReferencesFromMessage()` — 从用户消息 `details.contextReferences` 提取引用（retry/continue 重放路径）
- `withCanonicalContextReferences()` — 以服务端 canonical `{type:'file',projectId,path,name}` 覆盖客户端伪造的 details 后返回新消息
- `contextReferencesPrompt()` — 生成本轮 transient 提示（只列相对路径，要求相关时用 `read_file` 精确读取），可与 selectedCapabilities prompt 共存

### selected-capabilities.mjs

**用途**: 用户本轮插件选择 `selectedCapabilities` 的服务端单一规范化边界，与前端 `src/lib/selected-capabilities.ts` 使用相同规则。

**导出/语义**:
- `normalizeSelectedCapabilities()` / `selectedCapabilitySnapshots()` — 只接受数组中的合法对象与字符串字段；type 限定 plugin/skill/tool/command，pluginName/name/label/description 分别裁剪到 120/120/160/400 字符；按 `type+pluginName+name` 首项去重，保持顺序，最多 4 项。展示/持久化快照仅含 type/pluginName/name/label，description 只可保留在本轮模型临时提示中
- `selectedCapabilitiesFromMessage()` / `withCanonicalSelectedCapabilities()` — retry 从用户消息 details 读取历史快照时再次强制投影为 type/pluginName/name/label，历史 details 即使伪造 description 也会被丢弃，绝不进入 continue prompt；新 prompt 以请求体顶层 canonical 结果覆盖消息 details，空结果删除伪造/陈旧 selectedCapabilities，但保留 contextReferences 等其他 details；未知插件名不做 registry 校验，保证历史消息可继续展示
- `selectedCapabilityPrompt()` — 严格使用同一 canonical 结果生成本轮 capability prompt，不修改用户正文；`message-converters.mjs` 后续剥离全部 details，避免展示字段直接进入 LLM 正文

### custom-commands.mjs (628 行)

**用途**: 自定义命令系统。从用户级 `~/.quickforge/commands/`（所有项目共享）和项目级 `<workspace>/.claude/commands/`、`<workspace>/.opencode/commands/`、`<workspace>/.ai/commands/` 及项目配置 `commandDir` 指向的目录读取命令定义；同名命令优先级由高到低：项目配置目录 > `.ai` > `.opencode` > `.claude` > 用户级目录 > 插件命令。内置命令元数据集中在 `builtinCommandCatalog` 常量表（单一事实源），`/help` 和前端建议均据此派生。

**功能**:
- `listProjectCommands()` — 列出命令（含插件、用户级、项目级三层）
- `listUserCommands()` — 读取用户级 `~/.quickforge/commands/` 命令
- `findProjectCommand()` — 查找单个命令
- `resolveCustomCommandInvocation()` — 解析命令调用
- `handleInternalCommand()` — 处理内置命令，包括 `/help`（显示全部命令参考）、`/init`（调研当前仓库并生成或更新根目录 `AGENTS.md` 贡献者指南，不接受参数）、`/plan`（只生成计划，本轮禁止写入/命令执行，可调用受同样只读边界约束的 subagent）、`/review`（提交前自检，本轮禁止编辑文件）、`/commit [message]`（验证并只提交当前任务相关文件，最多一个本地 commit，禁止编辑/subagent/push/tag/release）、`/summary`（创建总结后的新会话）、`/compact`（当前会话内滚动压缩上下文）、`/clear`、`/commands`、`/command new` 等
- `parseInternalCommandInvocation()` 还解析 `/skill <name> [task]` 与 `/agent <name> <task>`（大小写不敏感；复数形式 `/skills`、`/agents` 不匹配）。两者需要会话上下文（已启用技能、workspace 级 Agent Profile），不在 `handleInternalCommand` 中执行，而是由 agent-manager 在 `resolveCommandState` 里拦截处理；内部命令优先于同名自定义命令
- `formatSkillCommandPrompt()` / `formatAgentCommandPrompt()` — 生成 `/skill`（引导本轮先调用 `activate_skill` 再按技能指示执行，无任务时先激活再询问用户）与 `/agent`（引导调用 `run_subagent` 委派执行并汇总结果）的当前轮提示词；XML 属性复用 `escapeXml` 转义
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
