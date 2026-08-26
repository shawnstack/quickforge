# QuickForge Cloud 本地客户端设计

## 状态

**当前 quickforge 仓库：Implemented and verified**（可配置服务连接、正式账户 Device Flow、本地凭据、云模型目录、本机 API、Agent 云调用、Session URL 绑定与本地身份重建；`mode:guest` 仅兼容遗留本地凭据）。

状态口径：

- **当前 quickforge 仓库已实现并验证**：可配置服务连接、正式账户 OAuth Device Flow、本地凭据、云模型目录、本机 API、Agent 云调用、Session URL 绑定与本地身份重建；guest mode 仅兼容遗留本地凭据。
- **外部仓库声明、未验证**：Cloud 服务端、管理后台、Provider、部署与生产环境状态不属于本次验证结论。
- **Planned**：仅限“已知限制”中明确列出的后续项。
- **Not in current scope**：支付、同步、团队与组织能力。
- **Blocked / NO-GO**：在真实 Provider、生产基础设施和真实 Tailnet 验收完成前，不得据本文宣称 Cloud Beta 已生产可用。

QuickForge Cloud 是独立受管服务，不进入 `customProviders` 或 `providerKeys`，也不要求用户输入 Provider Key。现有自定义 OpenAI-compatible Provider 保持原有行为。

## 服务连接配置

服务连接保存在普通 `settings` store 的 `quickforge-cloud-service`：

```json
{
  "schemaVersion": 1,
  "serviceType": "quickforge-cloud",
  "cloudUrl": "https://qf.shawnstack.com/"
}
```

配置优先级：

1. 用户已保存设置；
2. `QUICKFORGE_CLOUD_URL`；
3. 产品默认 `https://qf.shawnstack.com/`。

`Cloud URL` 不是凭据，可以在「设置 → 账户与云服务」修改。浏览器只调用同源 `/api/cloud/*`，由 Node BFF 请求 Cloud。连接测试使用一次性 `CloudClient` 仅调用 `healthz` 与 `readyz`，不创建身份、不读取或发送 Refresh Token，也不修改运行时。

URL 安全规则：

- 允许 HTTPS；
- HTTP 仅允许 localhost、`.localhost` 与回环 IP；
- 禁止 userinfo、query、fragment 和不安全路径；
- 统一规范化尾部 `/`；
- UI 显式保存回环 HTTP 不依赖环境变量开关。

## 凭据边界

身份凭据仍保存在 `~/.quickforge/storage/security/cloud-identity.json`，不会写入 settings、Provider 配置、前端缓存或备份。浏览器看不到 Access Token、Refresh Token、私钥、凭据路径、真实上游 Provider、路由或 Key。

Access Token 只存在 Node 内存中。Device Flow 的 `deviceCode` 与待处理状态保存在同一私有凭据文件中，浏览器只获得 `userCode`、验证地址、过期时间、轮询间隔和公开状态；页面刷新或本地服务重启后可继续恢复。创建 Session 或 pending flow 时会把规范化 Cloud URL 写入 `sessionCloudUrl`；Refresh Token 与 deviceCode 只会发送给该绑定 URL。运行时 URL 与绑定 URL 不一致，或检测到旧版本未绑定 URL 的 Session 时，所有 Token/Device 操作都会以 `cloud_session_service_mismatch` 拒绝，用户需在账户页取消/退出或执行“重建身份并切换”。

## Server 托管远程 Agent

QuickForge Server 在 HTTP `listen` 成功后读取当前 Cloud 服务配置。Cloud 服务通过独立 `enabled` 总开关控制，默认关闭；仅当配置有效且开关开启时，才使用实际绑定端口对应的回环地址启动随运行时分发的 `qf-agent`。Agent 由 Server/Desktop 生命周期托管：关闭 Cloud 服务或 Server 关闭、重启、更新前会先停止 Agent，再按原有顺序清理本地运行时与 HTTP 服务。

关闭 Cloud 服务不会清除已保存 URL、本地安装身份、Session 或账户摘要，也不影响测试/修改 URL 和退出；但会暂停云模型、额度、设备、Device Flow 轮询与远程 Agent。已配置但关闭时，模型解析稳定返回 `cloud_disabled`，不会误报为未配置。

每个运行实例使用独立身份目录，默认位于 `<dataDir>/remote-agent/<runtimeKind>-<port>`；CLI/Server 的 `runtimeKind` 默认为 `server`，Desktop 使用 `desktop`，因此动态端口和并行运行实例不会共享远程身份。可通过 `QUICKFORGE_QF_AGENT_IDENTITY_DIR` 显式覆盖，或用 `QUICKFORGE_QF_AGENT_ENABLED=0` 禁用托管。

`GET /api/cloud/remote/status` 仅返回运行状态、绑定的回环 Server URL、Agent PID、需要授权时的公开验证链接和脱敏错误，不返回可执行文件路径、身份目录或令牌。Agent 二进制缺失、版本不兼容、锁冲突或连接失败都不会阻塞 QuickForge 本地 Server 启动；本地功能保持可用。

代理透传：仅当 QuickForge 网络代理配置为 `manual` 且 proxyUrl 非空时，托管层才向 `qf-agent` 子进程 env 注入 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`，并构造 `NO_PROXY`（保留父进程已有 `NO_PROXY`/`no_proxy` 条目，至少加入 `localhost`、`127.0.0.1`、`::1` 与回环 Server URL 主机名，保证 agent 与本地 QuickForge 的通信不被代理）；`direct`/`system`/`pac` 模式不映射为子进程代理，也不清除父进程已有代理 env。代理 URL 不会出现在任何公开状态或日志中。

失效身份自动重新授权：托管层检测 `qf-agent` 结构化 warn/error/fatal/panic 日志中的 `invalid_refresh_token`、`refresh_token_reused`、`installation_revoked` 错误码，以及既有“refresh token 已失效”终态提示；每 lifecycle 至多一次标记身份重置、将状态置为可操作的 `authorizing` 并终止子进程。仅在子进程退出后对当前 runtime 专属 `identityDir/identity.json` 做安全隔离/删除（优先 rename 到同目录临时文件并尽快清理，Windows EPERM 安全 fallback unlink，ENOENT 幂等，只处理普通文件、不跟随 symlink），随后调度重启使 agent 重新进入设备授权；隔离成功与否均不清零重启计数，若新身份仍被云端拒绝，重启预算逐次消耗至 `MAX_CONSECUTIVE_RESTARTS` 后停止（稳定运行 60s 为自然重置边界），避免隔离清零形成无界循环。清理严格限定在 `remote-agent/<runtimeKind>-<port>` 身份目录，绝不触碰 `storage/security/cloud-identity.json`；stop 或新 lifecycle 不会触发误清理。

自动批准远程 Agent（一次性、短时）：意图有两个创建来源——① 本机用户在设置页显式把 Cloud 服务从 `disabled` 切换为 `enabled` 时立即创建（默认 10 分钟有效期）；② qf-agent 首次进入 `authorizing` 且当前无有效意图（`none`/`expired`）时，若该 agent 生命周期由本机发起（Server 启动恢复、本机 URL 切换、agent 普通重启、身份失效隔离重启），且本机存在有效 desktop 云会话（凭据公开状态含 Session 且与当前服务 URL 匹配；只读公开状态，不发起网络请求），托管层自动创建同样短时、一次性的意图并立即代批——**本机已登录云账户时首次设备授权自动批准，无需再“关闭后重新开启”开关**。**安全边界：由认证远程客户端（非本机请求）触发的云服务开关切换/配置变更，经 `applyCloudServiceConfig` 以 `autoApprovalPolicy: 'manual'` 启动 agent；该生命周期内（含其自动重启）不会自动创建意图或自动批准，仍需本机操作（在本机重新启用远程访问）。本机无有效 desktop 会话时同样不自动批准。** 其余语义不变：qf-agent 进入 `authorizing` 后，托管层从结构化日志的 `verificationUriComplete`（兼容 `userCode`/`user_code`/`code` query 参数）提取一次性 user_code，经桌面 `CloudIdentityManager.withAccessToken` 调用云端固定接口 `POST /v1/remote/agents/authorize`（Bearer desktop Access Token，body `{userCode}`，200 `{ok:true}`）。云端要求调用身份 `kind=desktop` 且具备 `remote:write`，并只批准同账户、`pending`、未过期、`client_id=quickforge-agent` 的独立 Agent installation；mobile/agent 身份即使具有同 scope 也会被拒绝。意图一次性消费并在进程内合并并发调用；成功后 agent 自己的 Device Flow 完成轮询并保存独立身份，失败则保留脱敏错误，UI 提示“重新登录或重试”，用户无需打开授权页或输入码。`POST /api/cloud/remote/authorize-retry` 仅本机可调用；`GET /api/cloud/remote/status` 返回 `autoApproval` 状态（`none/armed/pending/consumed/failed/expired`）。远程 Agent UI 不提供人工授权入口；无有效意图时（本机未登录云账户或远程触发的生命周期）引导用户在本机登录并重新启用远程访问。desktop Token 只在 Node 内存中经 `withAccessToken` 注入，user_code 不作为独立字段进入公开状态；意图绝不落盘（不写 agent identity、不触碰 `storage/security/cloud-identity.json`），关闭服务或服务退出后自动失效。

`qf-agent` 二进制（`runtime-assets/agent/<平台>/qf-agent[.exe]`）**当前不随 npm 包、runtime 包、offline 离线包与桌面安装包分发**（包体裁剪，临时下线）：`package.json` 的 `files` 与 `scripts/prepare-runtime-package.cjs` / `scripts/prepare-offline-package.cjs` 均不再包含 `runtime-assets`，桌面 `electron-builder` 也不再通过 extraResources 携带 agent。托管层代码保持不变：二进制缺失时启动结果为 `unavailable`，仅反映到 `GET /api/cloud/remote/status`，不影响本地服务；需要启用远程访问时可通过 `QUICKFORGE_QF_AGENT_PATH` 环境变量显式指定外部二进制（开发环境另有 `../quickforge-cloud/bin/agent.exe` 回退）。历史支持矩阵为 `win32-x64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`；其含义是：这些主机可注册为远程访问设备，供已认证的远端客户端通过云信令/隧道访问本机 QuickForge；**不代表跨主机远程执行 AI 工具**——模型推理（本地 Provider 或 Cloud）仍由被访问主机上的 QuickForge 本机执行，远端只是经隧道访问其 Web/API 界面。

## 本地 API

所有 `/api/cloud/*` 仅允许本机请求，或已通过 LAN 密码认证的远端请求；不再按 Tailscale IPv4、IPv6、普通 LAN 或公网地址分类。未认证远端请求会先被全局 LAN 认证层以 HTTP 401 拒绝；到达 Cloud 路由但不满足认证边界时返回 HTTP 403 / `cloud_local_only`。配置类 JSON body 限制为 16 KiB。所有非安全写方法还必须携带 `x-quickforge-action: cloud-action`；带 JSON body 的写接口必须使用 `Content-Type: application/json`，以阻止浏览器跨站简单请求绕过预检。

- `GET /api/cloud/config`：返回规范化 URL、来源与配置错误；不返回凭据。
- `PUT /api/cloud/config`：保存 URL 并使运行时失效；存在 Refresh Token 时，仅允许保存与 `sessionCloudUrl` 相同的规范化 URL，否则返回 HTTP 409 / `cloud_session_active`。
- `POST /api/cloud/test-connection`：一次性检查 health/ready。
- `POST /api/cloud/identity/reset`：要求 body `{"confirm":"reset-cloud-identity"}`；清内存 Access Token/模型缓存，轮换 installation 并清本地 Session，不向旧或新 Cloud 发送 Token。
- `GET /api/cloud/status`：返回本地安全摘要且不自动注册；旧 Session 缺失 URL 绑定或绑定到其他服务时返回 `sessionServiceMismatch: true`。
- `POST /api/cloud/device/start`：local 直接 `ensureInstallation` 后向绑定的 Cloud 服务申请设备授权；返回用户码、验证地址、过期时间与轮询间隔，不返回 `deviceCode`。
- `POST /api/cloud/device/poll`：Node 使用私有 `deviceCode` 轮询；结果为 `pending`、`slow_down`、`success`、`denied`、`expired` 或 `network`。仅网络异常、HTTP 5xx 与可重试服务错误映射为 `network`；协议错误和无效响应直接抛错。并发 poll 在单进程内合并为一次远端 exchange。
- `POST /api/cloud/device/cancel`：清理待处理授权，保留原 local 或遗留 guest 状态。
- 以上三个 Device Flow 端点均要求 action header 与 JSON Content-Type，响应绝不包含 `deviceCode`。
- `POST /api/cloud/remote/authorize-retry`：仅本机可调用，且仅当自动批准意图处于 `failed` 时由 UI 显式发起重试；服务端复用内存中保留的 user_code 重新调用 `POST /v1/remote/agents/authorize`，返回新的意图状态（`pending/consumed/failed` 等）。不要求用户打开授权页或输入码，也不把 user_code 发送给浏览器。
- `GET /api/cloud/remote/status`：返回 `autoApproval` 字段（`{status, error?}`，status ∈ `none/armed/pending/consumed/failed/expired`），供 UI 在 `authorizing` 期间区分自动批准进行中、失败或需要在本机重新启用；远程 Agent UI 不提供人工授权链接。
- `GET /api/cloud/models` — 上游超时返回 HTTP 504 / `cloud_timeout`，网络不可达返回 HTTP 502 / `cloud_unreachable`，均带 `retryable: true`；HTTP 语义由本地 BFF 映射，不再落入全局 500 兜底
- `GET /api/cloud/usage`
- `GET /api/cloud/installations`
- `DELETE /api/cloud/installations/:id`
- `POST /api/cloud/logout`

`GET /api/models/catalog` 对 Cloud 模型采用 2 秒短截止等待：冷缓存回源超过 2 秒即先降级返回本地/自定义模型（Cloud 部分为空），底层请求继续并在成功后写入 60 秒目录缓存，下一次请求在软 TTL 内直接命中，不会长时间阻塞主目录接口。

有本地 Session 时，保存配置会按凭据中持久化的 `sessionCloudUrl` 校验目标 URL；不同 URL 返回 HTTP 409 / `cloud_session_active`。相同规范化 URL 可重复保存。旧版本中没有 URL 绑定的 Session 也不会被自动信任，必须先重建身份。UI 引导先普通退出；也可在明确危险确认后执行“重建身份并切换”，流程是 reset 成功后再 save，不自动重试。

普通退出语义不变：先远端撤销当前 installation，成功后才清本地 Session；Cloud 不可用时保留本地凭据供安全重试。

## 运行时与模型安全

Cloud runtime 按当前有效配置构建，保存、reset、logout 后失效；下一次状态、目录或推理请求会读取最新配置，因此修复错误 URL 后无需重启。`resolveManagedCloudProvider()` 每次取得当前 runtime，再根据目录重新校验 `quickforgeCatalogId`。

前端 `quickforge:cloud-state-changed` 会清除 `useCloudModels` 内存目录缓存。账户设置页的刷新同时更新 config、status、usage、installations 和 models。

公开模型只包含：

```text
provider: quickforge-cloud
baseUrl: quickforge://cloud/<catalog-id>
quickforgeModelSource: cloud
quickforgeCatalogId: <catalog-id>
```

Node 推理时忽略前端模型快照中的真实 transport 字段，固定使用当前 Cloud URL 的 `/v1`、当前目录 ID 与内存 Access Token。模型目录 UI 仅展示名称、ID 和公开能力。

主聊天用户消息会携带公开的稳定逻辑 ID `metadata.quickforgeClientMessageId`。Cloud stream 创建时，Node 以 `sessionId + 逻辑消息 ID` 在 `~/.quickforge/storage/security/cloud-chat-idempotency/` 私有 sidecar 中原子创建或读取 UUID，并作为 `Idempotency-Key`；真正的 Key 不进入会话 JSON、浏览器 Agent state、共享会话或通用备份。相同逻辑消息的 Provider 内部网络重试、`/continue` 重新生成以及服务重启后恢复再试会复用同一 UUID；不同逻辑消息使用不同 UUID。辅助模型调用或缺少逻辑消息 ID 的兼容路径仍使用单次随机 UUID。HTTP 调试日志会脱敏该 Header。

启动时，持久化的 `active-model` / `default-options.model` 只有在当前可用模型目录中精确匹配时才生效；失效 Cloud 模型会回退到当前目录中的可用模型，避免主聊天用旧 Cloud 快照启动。

## 游客与正式账户

无自动或显式游客注册入口。正式账户仅通过 Device Flow 登录/注册；`mode:guest` 仅用于兼容本地遗留凭据。

Device Flow 使用 Cloud 承载的 `/device` 页面与账户登录/注册流程，QuickForge 不接触邮箱或密码。local 模式点击“登录或注册”时，Node 直接 ensure installation 并向 Cloud 申请设备授权。UI 展示设备码、验证页、复制、倒计时、取消并按服务端 interval 自动轮询；刷新页面后从公开状态恢复 pending。`authorization_pending` 继续等待，`slow_down` 增加轮询间隔，拒绝/过期清 pending，网络或服务不可用错误保留 pending 供重试；协议错误和无效响应直接报错。取消或失败保留原 local 或遗留 guest 状态。成功时 Node 在凭据写队列中写入正式账户 Refresh Token，保留 installation，清 pending、账户旧摘要和模型缓存，再以严格白名单 `{id,email,plan}` 返回账户摘要。

## 统一模型目录与引用

所有正式模型入口统一使用服务端 Model Catalog。新绑定保存版本化 `ModelRef`：自定义模型保存稳定 Provider ID 与模型 ID，Cloud 保存 catalog ID；模型名称和能力可作为 `modelSnapshot` 展示快照，但 URL、Token、Header、API Key 等 transport 不属于执行权威数据。`active-model` 与 `default-options` 采用 `modelRef + modelSnapshot` 读旧写新；执行前由服务端根据当前 Provider 配置或当前 Cloud 目录重新解析，客户端提交的完整模型对象不能覆盖 transport。

Agent 会话、Agent Profile 固定模型与 AI Fill、定时任务、ACP、可操作共享会话以及默认模型页面均接入统一目录。旧完整模型快照继续读兼容，新写入优先包含 `modelRef`。用户显式绑定的 Cloud 模型失效时返回 `cloud_model_unavailable`，不静默换模型；仅 active/default 等隐式启动偏好允许回退到当前可选模型。

Cloud 模型目录采用有界缓存：60 秒软 TTL、5 分钟硬过期。软 TTL 后刷新失败可短暂使用未硬过期目录；指定 catalog ID 未找到时会强制刷新一次，仍不存在或标记 `available:false` 则 fail closed。

`quickforgeHidden` 只禁止成为新的选择。已有 Profile、任务和历史会话绑定仍可展示、保存、恢复和执行；用户切走后不能重新选择。它不是权限边界，也不会覆盖 Cloud 访问策略。

## 远程访问边界

已通过 LAN 密码认证的远程客户端可访问 `/api/cloud/*`，并可在统一模型目录和 Agent API 中使用 Cloud；访问权不再依赖客户端 IP 网段。未认证远程请求不能选择或执行 Cloud。可操作共享默认不允许消耗分享者 Cloud 额度；只有分享者从本机或已认证远程客户端显式启用 `allowCloudUsage` 后才允许。只读共享永不执行模型。后台定时任务在创建时完成模型授权和引用固化，执行时仍从当前 Cloud 目录解析，不使用旧 transport 快照。

通用 Storage 与 Backup API 对本机和已认证远程客户端提供相同能力，包括 Provider Key、自定义 Provider、MCP、插件、定时任务、Agent Profile 覆盖以及 Session 数据的读取和修改。更新与重启同样允许已认证远程客户端调用，但继续要求各自的 `x-quickforge-action` 确认头。交互式终端、系统代理、终端 Shell、打开本机应用或文件管理器、LAN 认证管理等主机级能力仍保持本机限制。

## 已知限制

- Device Flow 已在本地客户端/BFF 状态机和契约测试中覆盖，但本次未对外部 Cloud 仓库、真实邮件/浏览器登录页或生产账户系统做端到端验收。
- 服务重启不会恢复已经断开的上游流本身；恢复会话后通过重新生成/继续路径发起的新 Cloud stream 会复用原逻辑消息的 Idempotency-Key。
- 所有正式模型入口已统一接入 Model Catalog 与版本化 ModelRef；后续新增入口必须复用同一目录和服务端 resolver，不能自行读取 Provider store 或信任客户端 transport。
- 本地身份文件依赖操作系统账户与文件权限，尚未接入系统 Keychain。
- 远程完整访问统一依赖 LAN 密码认证，不再依据 Tailscale IPv4/IPv6 或其他客户端 IP 网段决定 Cloud、Storage、Backup、更新与重启权限。
- 本次未验证外部 Cloud 仓库、真实 Provider、支付、生产部署、真实 Tailnet/ACL 或 Android WebView 端到端链路；这些内容不能据本文标记为已完成。
