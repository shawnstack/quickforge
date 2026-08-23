# `server/routes/` — API 路由处理器

每个文件处理一组相关 API 端点。路由在 `server/index.mjs` 中分发。

`server/index.mjs` 内置两个启动相关端点（不经 routes/ 文件）：

- `GET /api/health` — 健康检查；启动维护窗口内返回 `{ok:true, maintenance:true, ...}`，启动失败返回 `{ok:false, startupError}`（进程保持存活、业务 API 持续 503），就绪后返回完整系统状态。
- `GET /api/migration-status` — 返回 `{ok:true, state:'migrating'|'ready'|'failed', startupError?, domains:{scheduledRuns,sessionState,share,lanAccess}}`（各域 phase/count/updatedAt，域不可读时为 `{phase:'unknown', error}`），供前端迁移进度 UI 轮询；`sessionState` 域在后台迁移任务启动后额外携带 `background` 内存态快照（`state`：importing/idle-waiting/switching/done/failed/aborted，含 `taskId`、`buckets`、`convergeRound`、`diffBuckets`、`backup`、`lastEventAt` 及 `failure`/`reason`/`lockOwner*` 失败诊断），任务启动前该键缺省。

启动维护窗口（后台初始化链未完成或失败）内，除上述白名单外的所有 `/api/*` 请求统一返回 503 `{ok:false, maintenance:true, state}` + `Retry-After: 5`；非 `/api` 路径（静态资源、`/share/`）不受限，前端页面可先加载。会话域已后台迁移化：维护窗口通常仅剩 scheduled-runs/share/lan-access 三小域秒级切换，进度页可能一闪而过或不出现；READY 后仍可轮询 `sessionState.background` 观察会话域后台迁移进度。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `agent.mjs` | 558 | Agent 会话管理、消息流式处理 |
| `storage.mjs` | 151 | 存储 CRUD 操作 |
| `project.mjs` | 106 | 项目管理 |
| `filesystem.mjs` | 87 | 文件系统浏览 |
| `tools.mjs` | 82 | 工具定义和执行 |
| `skills.mjs` | 213 | Skills 管理 |
| `agent-profiles.mjs` | 236 | Agent Profile 管理 API，支持 AI 填充基础定义 |
| `models.mjs` | 68 | 自定义模型连接测试 |
| `scheduled-tasks.mjs` | 949 | 定时任务管理，支持绑定 Agent Profile 与配置单任务执行模式 |
| `shares.mjs` | 90 | 分享管理 |
| `shared-conversation.mjs` | 共享会话查看与共享图片资产读取 |
| `session-assets.mjs` | 当前会话生成图片资产的同源二进制读取 |
| `backup.mjs` | 817 | 数据备份和恢复（权威会话/分享/LAN 访问导出与恢复、settings 导入） |
| `lan-access.mjs` | 201 | LAN 共享访问管理 |
| `instructions.mjs` | 20 | 系统提示词 |
| `system.mjs` | 107 | 系统状态、网络代理、重启、关于信息、Runtime 更新和 Desktop 发布页检查 |
| `workspace.mjs` | 1614 | 工作区文件浏览、产物预览静态读取、Git 变更检查、单文件/批量暂存与还原、分支操作、AI 提交信息生成、提交/推送和提交图谱（`server/index.mjs` 通过 `/api/git/*` 统一分发） |
| `channels.mjs` | 外部渠道管理、SSE 状态/会话变更事件、仅 localhost + `x-quickforge-action: channel-event` 可调用的内部事件 relay，以及仅 localhost + `x-quickforge-action: channel-action` 可打开已注册渠道日志目录的 `POST /api/channels/:id/open-logs` |
| `cloud.mjs` | QuickForge Cloud 本地 BFF：状态、正式账户 Device Flow、模型、额度、设备撤销和安全退出 |
| `static.mjs` | 89 | 静态文件服务；`index.html` 与可替换的 APK 下载使用 `no-cache`，其余构建资产长期缓存 |

### system.mjs

系统与运行时设置路由。网络代理端点包括：

- `GET /api/system/network-proxy` — 返回当前配置和运行时能力状态。
- `PUT /api/system/network-proxy` — 本机请求可切换 `direct`、`system`、`manual`、`pac`；手动模式仅接受包含端口的 HTTP/HTTPS 地址，PAC 模式接受 HTTP/HTTPS PAC 地址。
- `POST /api/system/network-proxy/refresh` — 重新读取操作系统代理并关闭旧连接。

“跟随系统”不读取代理环境变量冒充系统代理：Desktop inline 使用 Electron/Chromium 系统代理；CLI/SDK 使用原生 Windows、macOS SystemConfiguration 和 Linux GNOME/libproxy 能力。自定义 PAC 地址仅 Desktop inline 支持；其他运行环境会拒绝保存，并且读取到已有 PAC 配置时不会静默直连。localhost 始终直连。

### cloud.mjs

已通过 LAN 密码认证的客户端可以使用本地 Cloud BFF，不再按 Tailscale IPv4、IPv6、普通 LAN 或公网地址分类。远程客户端使用的是宿主机 Cloud 身份与额度。未认证远端请求会先由全局 LAN 层返回 HTTP 401；请求到达 Cloud 路由但不满足认证边界时返回 HTTP 403 / `cloud_local_only`。所有非安全写方法还要求 `x-quickforge-action: cloud-action`，带 JSON body 的写接口要求 `Content-Type: application/json`，以阻止浏览器跨站简单请求绕过预检。

- `GET /api/cloud/config` — 返回规范化 Cloud URL、来源与配置错误，不返回凭据。
- `PUT /api/cloud/config` — 保存 URL 并使 Cloud runtime 失效；活动 Session 必须与凭据中绑定的 `sessionCloudUrl` 一致，旧版未绑定 Session 也会以 HTTP 409 / `cloud_session_active` 安全拒绝。
- `POST /api/cloud/test-connection` — 使用一次性 Client 检查 health/ready，不创建身份、初始化 runtime 或发送 Token。
- `POST /api/cloud/identity/reset` — 需显式确认；仅清本地 Session、轮换 installation 并使 runtime 失效，不联系旧/新服务。
- `GET /api/cloud/status` — 返回本地安全摘要，不自动注册；Session URL 不匹配或旧 Session 缺失绑定时带 `sessionServiceMismatch` 供 UI 提示重建身份。
- Refresh、Logout、模型、额度和设备等 Token 操作发现 Session URL 不匹配或缺失时返回 HTTP 409 / `cloud_session_service_mismatch`，并在发送旧 Refresh Token 前拒绝。
- `POST /api/cloud/device/start|poll|cancel` — 正式账户 Device Flow；local 的 start 直接 ensure installation 并 authorizeDevice。`deviceCode` 仅保存在 Node 私有凭据文件；页面刷新/本地重启后由 status 恢复公开 pending 摘要。pending/slow_down/network 保留流程，denied/expired/cancel 清 pending 并保留原 local/遗留 guest 状态，成功原子写入账户 Token、保留 installation 并清模型缓存。
- `GET /api/cloud/models|usage|installations` — 返回公开模型、额度和设备列表。
- `DELETE /api/cloud/installations/:id` — 撤销指定设备。
- `POST /api/cloud/logout` — 先撤销云端当前 installation，再清理本地 Session；远端失败时请求失败且本地凭据保留。

---

## agent.mjs (558 行)

Agent 会话管理核心路由。

**主要端点**:
- `GET /api/agents` — 列出活跃会话
- `GET /api/agents/events` — 全局 SSE 事件流
- `GET /api/agents/:sessionId/stream` — 会话级 SSE 流
- `POST /api/agents/:sessionId/restore` — 从内存复用或从持久化存储恢复 Agent，并在同一响应中返回完整权威快照，供历史会话冷加载使用；并发恢复（restore/state/messages/status/SSE 同时回落）按 sessionId 共享同一 in-flight Promise，只构建一个内存 Agent 实例，避免竞态覆盖泄漏
- `GET /api/agents/:sessionId/state` — 获取完整会话快照，用于 SSE 异常恢复；仅在内存会话不存在时从磁盘恢复，不再每次无条件重读 Session
- `GET /api/agents/:sessionId/status` — 获取轻量运行状态，用于 SSE 静默后的版本探测
- `HEAD /api/agents/:sessionId/stream` — 检查 SSE 可用性
- `POST /api/agents/:sessionId/prompt` — 发送消息；`/summary` 与 `/compact` 作为内置 slash command 通过此端点触发，不存在独立压缩 REST 路由。可选 `contextReferences: [{type:'file',projectId,path}]` 最多 8 条；仅项目 QuickForge 会话支持，服务端用已恢复会话的 projectId/workspaceRoot 重新校验并持久化 canonical `{type,projectId,path,name}` 到用户消息 `details.contextReferences`，只向本轮模型注入已验证相对路径提示，不读取正文。OpenCode 与 Shared 非空引用显式拒绝
- `POST /api/agents/:sessionId/title` — 手动重命名会话；同步更新服务端活跃状态与持久化数据，优先于待完成的 AI 标题
- `POST /api/agents/:sessionId/abort` — 中止运行
- `POST /api/agents/:sessionId/steer` — 引导 Agent
- `POST /api/agents/:sessionId/follow-up` — 后续处理
- `DELETE /api/agents/:sessionId` — 销毁 Agent
- `POST /api/agents/:sessionId/access-mode` — 切换 Agent 权限模式（`default` / `full-access`）
- `POST /api/agents/:sessionId/yolo-mode` — 旧客户端兼容入口
- `POST /api/agents/:sessionId/model` — 接收版本化 `modelRef`（旧完整 `model` 仅作兼容识别），从当前统一目录解析权威模型；prompt/continue 执行前会再次解析，失效显式绑定直接拒绝
- `POST /api/agents/:sessionId/thinking-level` — 更新思考级别

## storage.mjs (151 行)

通用存储 CRUD 路由。本机与已通过 LAN 密码认证的远程客户端具有相同 KV 读写能力，包括 Provider Key、自定义 Provider、MCP、插件、任务、Agent Profile 覆盖与会话数据；未认证远程请求由全局认证层和路由守卫拒绝。

**主要端点**:
- `GET /api/storage/quota` — 存储配额和用量
- `GET|POST|DELETE /api/storage/:store/keys/:key` — 键值操作
- `POST /api/storage/batch` — F8 窄事务端点：单请求一次提交 sessions+sessions-metadata 的 set/delete（expectedStateVersion 可选）；`SESSION_STATE_CONFLICT`/`SESSION_STATE_DUPLICATE_ID`/`SESSION_STATE_REQUIRED`/`SESSION_FULL_DELETE_REQUIRED` 稳定映射 409，会话维护锁 active 返回 423；单 PUT sessions 走 `writeSessionValueWithMetadata`（自动派生/merge metadata，不制造 body orphan），DELETE 走 `deleteSessionWithMetadata` 幂等，GET/API shape 不变
- `GET /api/storage/:store/index/:indexName` — 索引查询（支持排序、分页、作用域过滤）；会话元数据默认排除归档记录，`archived=only` 仅返回归档，`archived=include` 返回全部。F7 仅对严格合法、可证明与旧 JSON 等价的 sessions metadata 分页请求使用 SQLite `COUNT + LIMIT/OFFSET`；readiness/digest/source compatibility、duplicate/tie、repository/shadow mismatch 或 legacy 参数均保留原 JSON fallback
- 写入 `settings/auto-archive-settings` 并开启时，会立即执行一次超过 30 天未更新对话的自动归档扫描

## backup.mjs

备份导出、检查和导入接口允许本机及已通过 LAN 密码认证的远程客户端调用；未认证远程请求禁止访问。

- `GET /api/backup/export` — 支持 `scope`（`all`/`config`/`sessions`/`shares`/`lan-access`）与 `sections` 细分；权威模式下会话导出在维护锁内做 `quick_check` + count/digest 校验，并新增顶层 `sessionState: { phase, count, digest }`；权威模式下 `all`/`shares` scope 同时纳入 share 权威导出（share 维护锁内 quick_check + verifyIntegrity + exportSnapshot，记录含 token 哈希），新增顶层 `shareState: { phase, count, digest }`（旧客户端忽略未知字段）；权威模式下 `all`/`lan-access` scope 同时纳入 lan-access 权威导出（lan-access 维护锁内 quick_check + verifyIntegrity + exportSnapshot，配置含 token 哈希非明文、剔除 revision），新增顶层 `lanAccessState: { phase, count, digest }`（count = token 数）
- `POST /api/backup/import` — replace/merge 模式；含 conversations 的恢复在权威模式下走 `restoreSessionStateSnapshot`（维护锁 + 计划文件 + 失败补偿，只触碰会话表、不影响 `scheduled_task_runs`），维护锁占用时返回 423 `session_state_maintenance`；含 shares 的恢复在权威模式下走 `restoreShareStateSnapshot`（share 维护锁 + 计划文件 + 失败补偿，replace 全量 / merge 保留 local-only、backup 同 key 覆盖，不影响 F5/F7/F9），维护锁占用时返回 423 `share_maintenance`；v1 conversation-shares.json 形状归一化导入；空 `shares: {}` 语义：replace 清空、merge 保留；metadata-only 会话恢复在权威模式拒绝（400）；含 lanAccess 的恢复在权威模式下走 `restoreLanAccessStateSnapshot`（lan-access 维护锁 + `lan-access-restore-plan.json` 计划文件 + 失败补偿，replace 全量 / merge 保留本地配置字段与 tokens、backup 同 key 覆盖，恢复覆盖 enabled 开关，不影响 F5/F7/F9/F10），维护锁占用时返回 423 `lan_access_maintenance`；v1 lan-access.json 形状归一化导入
- `POST /api/backup/inspect` / `inspect-file` — 检查备份内容与警告（含 shares 替换警告、lan-access「将替换局域网访问配置」警告），`inspect-file` 生成一次性 import token

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
- `DELETE /api/project/:projectId` — 删除项目；删除当前项目时活动项目切换到剩余列表中的后继项目，没有剩余项目时前端使用合成的默认 workspace；删除最后一个项目时后端 `workspaceRoot` 回退到默认工作区。

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

## skills.mjs (213 行)

Skills 管理路由。

**主要端点**:
- `GET /api/skills?scope=global|project` — 获取技能列表、已选项和搜索路径
- `GET /api/skills?available=true[&projectId=...]` — 返回当前会话可用的已启用技能合并视图（全局已启用 + 项目已启用，含插件技能；按名称去重、项目覆盖全局，与 `loadSkillToolContext` 口径一致；无 projectId 时仅全局已启用，projectId 无效时项目侧为空）。响应 `{ available: true, skills }`，摘要不含 instructions，不影响既有 scope 响应
- `GET /api/skills/content?scope=global|project&name=...` — 获取 Skill 正文与元数据
- `GET /api/skills/global` / `GET /api/skills/project` — 获取对应作用域的已选 Skills
- `PUT /api/skills/global` — 更新全局已选 Skills
- `PUT /api/skills/project` — 更新指定项目的已选 Skills
- 支持项目级技能发现；内置 `skill-creator` 首次运行时默认加入全局已选项

## agent-profiles.mjs (236 行)

Agent Profile 管理路由。

**主要端点**:
- `GET /api/agent-profiles[?projectId=...]` — 列出内置和自定义 Agent Profile；传入有效 `projectId` 时按对应 workspaceRoot 合并项目级 `.claude/agents`、`.quickforge/agents` 文件 profile，省略或无效时保持默认行为（响应形状不变，仍含 disabled，由前端过滤）。
- `POST /api/agent-profiles` — 创建自定义 Agent。
- `GET /api/agent-profiles/available-tools` — 获取第一阶段可配置的 workspace 工具列表。
- `POST /api/agent-profiles/ai-fill` — 使用默认模型生成 Agent 名称、显示名称、描述和系统提示词。
- `GET /api/agent-profiles/:id` — 获取单个 Agent。
- `PATCH|PUT /api/agent-profiles/:id` — 更新自定义 Agent；内置 Agent 只接受单一 `model` 字段，用于设置或恢复模型覆盖。
- `DELETE /api/agent-profiles/:id` — 删除自定义 Agent。

内置 Agent 不允许删除，其提示词、工具、思考等级和运行预算不可修改。

## models.mjs (68 行)

统一模型目录与自定义模型连接测试路由。

**主要端点**:
- `GET /api/models/catalog` — 返回当前请求上下文可使用的公开模型目录。每个条目携带版本化 `quickforgeModelRef`；不返回 API Key、Cloud Token 或请求 Header，普通 LAN 请求不包含 Cloud。
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

**调度引擎**: 内置调度器（`startScheduledTaskRunner`），支持 Cron 表达式和间隔调度。任务新建/更新保存 `modelRef + model` 展示快照；执行时以后台授权上下文从当前统一目录重新解析，Cloud 失效或自定义 Provider 已删除时拒绝运行，永不使用旧 transport 快照。任务可通过 `agentId` 绑定 Agent Profile；执行时会追加 profile 系统提示词、限制工具白名单，并在运行历史中记录 `agentId`、`agentLabel` 和 `agentSnapshot`。每个任务可配置 `executionMode`：默认 `serial`，同一任务已有运行实例时跳过新的到期执行；`parallel` 允许同一任务重叠执行。不同任务之间始终并行触发。达到 Agent Profile 运行时限后会调用 `abortRun()`，并以有界等待清理 timeout、Agent 事件监听器、内存/持久化运行 ID；循环任务超时后暂停，已保存的任务会话仍保留供查看。

## shares.mjs (90 行)

分享管理路由。

**主要端点**:
- `GET /api/shares` — 列出当前实例全部分享；可用 `sessionId` 过滤指定会话
- `POST /api/shares` — 创建或更新同一会话的固定分享链接
- `DELETE /api/shares/:shareId` — 兼容旧客户端的停用入口
- `POST /api/shares/:shareId/disable` — 停用分享，立即清除认证令牌并关闭已有共享 SSE
- `POST /api/shares/:shareId/restore` — 按请求中的 `expiresAt` 恢复分享；恢复前验证原会话仍存在
- `POST /api/shares/:shareId/expiration` — 修改仍有效分享的有效期，并关闭旧 SSE 使客户端按新配置重连
- `POST /api/shares/:shareId/update` — 编辑仍有效分享的权限、密码、有效期和 `allowCloudUsage`；Cloud 默认关闭，只能由本机或已认证 Tailscale 管理端显式开启，修改会使旧共享状态失效
- `DELETE /api/shares/:shareId/permanent` — 永久删除分享记录并关闭已有共享 SSE

## shared-conversation.mjs (444 行)

共享会话查看和交互路由。每次请求都会校验停用和过期状态；SSE 在停用、永久删除、链接被替代时立即关闭，并在到期时按时关闭。

**主要端点**:
- `GET /api/shared/:shareId/meta` — 获取分享元数据
- `POST /api/shared/:shareId/unlock` — 密码解锁并写入分享 Cookie
- `GET /api/shared/:shareId/session` — 获取共享会话快照
- `GET /api/shared/:shareId/models` — 从统一 Model Catalog 获取可操作分享可用的公开模型；Cloud 仅在分享记录显式 `allowCloudUsage: true` 时出现
- `GET /api/shared/:shareId/events` — 订阅共享会话 SSE
- `POST /api/shared/:shareId/message` — 发送消息；非空 `contextReferences` 返回稳定错误 `CONTEXT_REFERENCES_UNSUPPORTED_SHARED`，共享 session/state/SSE 清洗会剥离历史消息 `details.contextReferences`，防止 owner 项目相对路径泄露
- `POST /api/shared/:shareId/model` — 更新模型
- `POST /api/shared/:shareId/thinking-level` — 更新思考等级
- `POST /api/shared/:shareId/abort` — 停止生成
- `POST /api/shared/:shareId/rollback` — 回滚消息
- `GET /api/shared/:shareId/assets/:assetId` — 经分享权限校验读取该会话的生成图片资产

## session-assets.mjs

- `GET /api/session-assets/:sessionId/:assetId` — 读取当前会话的生成图片资产；服务端按会话 bucket 定位文件并返回受控图片 MIME、`nosniff` 与私有不可变缓存头。
- 路由只接受服务端生成的 UUID 图片 ID，不接受任意相对路径。

## backup.mjs

数据设置备份和恢复路由。用户设置备份只处理可携带配置数据，不包含本机项目注册表与对话历史；恢复前的内部安全备份仍会保留项目注册表，用于同机回滚。

**主要端点**:
- `GET /api/backup/export?sections=settings,mcp,providerKeys,customProviders,scheduledTasks` — 按数据项导出用户设置备份；至少选择一项。`providerKeys` 与其他设置项一致，不需要额外开关。项目注册表和对话数据均不接受导出。
- `GET /api/backup/export?scope=all|config|sessions&includeSecrets=0|1` — 旧客户端兼容参数；用户导出不再包含项目注册表，新设置界面也不再使用 `all` / `sessions`。
- `POST /api/backup/inspect` — 检查 JSON 请求体中的备份并返回预览；高于当前格式版本的备份会被拒绝。
- `POST /api/backup/inspect-file` — 上传备份文件，按设置数据项检查并返回 `importToken`。旧完整备份中的对话和项目注册表会被忽略并明确告知；格式异常的数据项通过 `invalidSections` 返回，不阻塞其他有效项。
- `POST /api/backup/import` — 使用 `{ "importToken": "...", "sections": [...], "mode": "replace|merge" }` 恢复所选数据，也兼容直接传入 `backup`。导入令牌仅在成功后删除，失败可重试；写入前会创建包含本机项目注册表的安全备份。项目绑定的定时任务若找不到对应本地项目，会保留绑定信息并自动暂停。

## lan-access.mjs

LAN 共享访问管理路由。

**主要端点**:
- `PUT /api/lan-access/settings` — 本机更新 LAN 共享设置（密码、启用状态、会话 TTL）
- `GET /api/lan-access/status` — 本机获取完整状态、有效登录会话列表和 LAN 地址；远端只获取是否需要密码
- `POST /api/lan-access/unlock` — 密码认证并创建带 IP、User-Agent 和有效期的登录会话
- `POST /api/lan-access/logout` — 清理当前 Cookie，并同步撤销服务端会话
- `POST /api/lan-access/revoke` — 本机按会话 ID 踢出单个局域网登录会话
- `POST /api/lan-access/revoke-all` — 本机撤销所有局域网登录会话
- 支持暴力破解保护（5 次失败后锁定 5 分钟）

## instructions.mjs (20 行)

**用途**: 提供系统提示词 API。返回基础提示词、指令和 Skills 目录。

## system.mjs (81 行)

**主要端点**:
- `GET /api/system/status` — 系统状态
- `GET /api/system/network` — 网络信息
- `GET /api/system/about` — 包名、版本、GitHub / homepage / issues 地址
- `GET /api/system/update/check` — 检查 npm 分发的 QuickForge Runtime 更新（CLI、本地后端、Web dist、skills、plugins），返回 `channel: "npm-runtime"`、`distribution: "npm"`、`installCommand` 等信息。
- `GET /api/system/update/desktop` — 检查 GitHub Releases 上的 Desktop 发布版本，返回 `channel: "desktop-app"`、`distribution: "github-releases"`、`releaseUrl`；当前不执行桌面壳自动安装。
- `POST /api/system/update` — 启动外部更新器执行 npm Runtime 更新（本机请求限定，需 `x-quickforge-action: update`）；接口返回 `202`、更新日志路径和旧 `bootId`，当前服务随后退出，`update-supervisor.mjs` 在外部执行 `npm install -g <package>@latest` 并自动重启服务。Desktop 客户端更新不走该入口。
- `POST /api/system/restart` — 服务重启

## workspace.mjs

Workspace Inspector 后端 API。

**主要端点**:
- `GET /api/workspace/tree?projectId=...` — 兼容旧客户端的递归文件树；仍只跳过 `.git`、`node_modules`，节点总量有上限
- `GET /api/workspace/children?projectId=...&path=.&limit=&cursor=` — 按需列出一个目录的直接子节点，目录优先并使用大小写不敏感主排序及确定性次级排序；相对路径统一使用 `/`。`cursor` 是当前排序结果中的 offset 编码，不是目录快照，目录在分页间变化时可能出现重复或跳过；响应必含 `root/path/entries/nextCursor/truncated`。单个超大目录仍需读取并排序整层后才能分页
- `GET /api/workspace/search?projectId=...&query=&limit=` — 独立遍历整个项目并按名称/相对路径搜索，不依赖前端已加载节点；至少 2 个字符，结果与遍历均有上限。结果上限通过多找 1 个匹配后截断，因此 `truncated: true` 表示还有额外匹配，或遍历先达到安全上限。每个从遍历队列取出的目录都会在 `readdir` 前重新经过现有 workspace 真实路径 validator；不安全、已替换为外部链接或不可访问的目录会跳过。该检查用于缩小竞态窗口，不宣称消除文件系统不可避免的 TOCTOU
- `GET /api/workspace/mention-children?projectId=...&path=.` — Composer `@` 文件引用专用目录浏览；`projectId` 必须对应仍存在的已注册项目，未知或已删除项目返回 HTTP 404 / `PROJECT_NOT_FOUND`，不会回退默认 workspace。只读取 `path` 的直接子节点并一次返回当前层全部安全文件/目录（目录优先排序），不递归、不分页；始终启用 mention 级敏感路径与 realpath/符号链接边界检查，排除 `.env*`、密钥/证书、credentials/secrets、`.git` 及指向敏感或项目外目标的链接。目录只用于逐层导航，不能成为 context reference
- `GET /api/workspace/mention-search?projectId=...&query=&limit=` — 旧版 `@` 文件引用专用递归搜索端点，保留兼容；至少 2 个字符，仅返回普通文件，默认 20、最大 50 条，保留与普通 search 相同的 visited 上限和 `truncated`。始终启用敏感路径保护（大小写不敏感，并在 realpath 后复查真实目标），排除 `.env*`、密钥/证书、credentials/secrets 与 `.git`，不返回绝对路径；排序依次为 basename 精确、前缀、包含，再按相对路径。`projectId` 必须对应仍存在的已注册项目，未知或已删除项目返回 HTTP 404 / `PROJECT_NOT_FOUND`，不会回退默认 workspace；普通 `/api/workspace/search`、children 等端点继续保留兼容回退。当前 Composer 不再调用该递归端点
- `GET /api/workspace/file?projectId=...&path=...` — 安全读取 1MB 以内文本文件，返回 Monaco 语言标识；响应含 `size` 与 `mtimeMs`（F13 缓存失效戳）；`&meta=1` 轻量模式走同一安全校验与 stat，仅返回 `{path,size,mtimeMs,language,readonly}` 不读内容（供前端缓存 meta 校验）
- `GET /api/workspace/preview/:projectId/*` — 安全读取项目内静态产物文件，供右侧 Artifact Preview iframe/img 加载 HTML、CSS、JS、图片等资源；采用 ETag 协商缓存：响应带 `cache-control: private, no-cache` 与强 ETag `"<mtimeMs>-<size>"`（源自 `fs.stat`，零额外 IO），请求带匹配的 `If-None-Match` 时返回 304 且不再读取文件体，文件 mtime/size 变化即生成新 ETag 立即生效；附加 `?__quickforge_check=1` 时仅执行预检并返回文件元数据（含 `mtimeMs`），错误响应包含稳定错误代码、原始报错和请求路径，供前端统一展示 404/403/413/415/500 等状态
- `GET /api/git/status?projectId=...` — 基于 `git status --porcelain=v1 -z --untracked-files=all` 返回扁平的工作区文件变更列表（未跟踪目录展开为具体文件，不返回目录分组项），并附加 `git diff HEAD --numstat` 的每个文件增删行数（`additions`/`deletions`）；未跟踪/新增文件按工作区文件行数估算，最多统计排序后的 100 个文件，单文件上限 1MB、单次总量上限 10MB、并发数 6，超限文件仍返回状态但省略增删行数
- `GET /api/git/file-diff?projectId=...&path=...` — 返回单文件 `oldContent/newContent`，供 Monaco DiffEditor 展示

**路径边界**: 工作区文件读取、静态预览和外部打开分别使用各自的路径校验及文件类型/大小限制；目录 children/search 会限制在 workspace 内并跳过 `.git`、`node_modules` 及不安全的符号链接。search 对每个待遍历目录在读取前重新校验真实路径，但文件系统检查与后续读取之间仍存在不可完全消除的 TOCTOU；客户端取消请求也不保证已经开始的服务端扫描立即停止。

## workspace.mjs

工作区文件与 Git 能力路由。

**主要端点**:
- `GET /api/workspace/tree` — 兼容旧客户端的递归工作区树。
- `GET /api/workspace/children` — 按目录路径分页读取直接子节点，供 Files 树按需展开；offset cursor 只定位当前排序结果，不承诺目录快照。
- `GET /api/workspace/search` — 独立遍历项目进行路径/名称搜索，不依赖前端已经展开的目录；`truncated` 表示存在额外匹配或遍历达到安全上限。上述 JSON 接口均返回 `Cache-Control: no-store`，但前端会在当前 Inspector 会话内保留各目录已加载页、展开和错误状态。
- `GET /api/workspace/mention-children` — Composer `@` 文件引用的安全逐层目录浏览；严格已注册 `projectId`，一次返回当前目录全部直接子文件/目录，不递归不分页，敏感路径及指向敏感/外部目标的符号链接不会出现。
- `GET /api/workspace/mention-search` — 旧版 `@` files-only 递归搜索端点，保留兼容但当前 Composer 不再调用；至少 2 字符、默认 20/最大 50，未知或已删除 `projectId` 严格返回 404 / `PROJECT_NOT_FOUND`。
- `GET /api/workspace/file?projectId=...&path=...` — 安全读取工作区文本文件。
- `GET /api/workspace/preview/:projectId/:path` — 为 HTML/SVG/图片/Markdown 等允许类型提供静态预览；ETag 协商缓存（`private, no-cache` + `"<mtimeMs>-<size>"`），未变化请求返回 304 零重传。
- `POST /api/workspace/resolve-path` — 将绝对路径解析为当前项目内的相对路径。
- `POST /api/workspace/open-external` — 在资源管理器中打开选中变更文件所在目录，或在 VS Code / IntelliJ IDEA 中直接打开工作区内的选中文件；路径经过工作区边界校验。
- `GET /api/git/status` — 获取 Git 仓库状态、当前分支、变更计数和文件列表。
- `GET /api/git/file-diff` — 获取单文件工作区 diff 内容。
- `POST /api/git/stage` — 暂存单个变更文件。
- `POST /api/git/stage-all` — 暂存全部工作区变更。
- `POST /api/git/unstage` — 将单个已暂存文件退回未暂存。
- `POST /api/git/unstage-all` — 将全部已暂存内容退回未暂存。
- `POST /api/git/restore` — 还原单个变更文件；未跟踪文件会被删除。
- `POST /api/git/restore-all` — 还原全部 tracked 变更并清理未跟踪文件。
- `GET /api/git/branches` — 列出本地与远端分支。
- `POST /api/git/checkout` — 检出已有分支。
- `POST /api/git/create-branch` — 从当前 HEAD 创建并检出新分支。
- `GET /api/git/log` — 获取最近提交和 refs 装饰，用于标题栏 Git 图谱弹窗。
- `POST /api/git/generate-commit-message` — 使用当前默认模型根据 staged/unstaged diff 生成 Conventional Commit 提交信息。
- `POST /api/git/commit` — 提交已暂存内容；可选 `includeUnstaged` 时先执行 `git add -A`。
- `POST /api/git/push` — 执行 `git push`，无 upstream 等错误直接返回给前端。
- `POST /api/git/commit-and-push` — 提交后执行 `git push`。

## static.mjs (83 行)

**用途**: 静态文件服务。从 `dist/` 目录提供 Vite 构建产物。
