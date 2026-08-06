# QuickForge Cloud 本地客户端设计

## 状态

**当前 quickforge 仓库：Implemented and verified**（可配置服务连接、游客身份、正式账户 Device Flow、本地凭据、云模型目录、本机 API、Agent 云调用、Session URL 绑定与本地身份重建）。

状态口径：

- **当前 quickforge 仓库已实现并验证**：可配置服务连接、游客身份、正式账户 OAuth Device Flow、本地凭据、云模型目录、本机 API、Agent 云调用、Session URL 绑定与本地身份重建。
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
  "cloudUrl": "http://127.0.0.1:8082/"
}
```

配置优先级：

1. 用户已保存设置；
2. `QUICKFORGE_CLOUD_URL`；
3. 产品默认 `http://127.0.0.1:8082/`。

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

## 本地 API

所有 `/api/cloud/*` 仅允许本机请求，或“已通过 LAN 密码认证且 socket 来源属于 Tailscale IPv4 `100.64.0.0/10`”的远端请求；普通 LAN、公网来源和未认证 Tailscale 请求拒绝。未认证远端请求可能先被全局 LAN 认证层以 HTTP 401 拒绝；到达 Cloud 路由但不满足边界时返回 HTTP 403 / `cloud_local_only`。当前未实现 Tailscale IPv6 判定。配置类 JSON body 限制为 16 KiB。所有非安全写方法还必须携带 `x-quickforge-action: cloud-action`；带 JSON body 的写接口必须使用 `Content-Type: application/json`，以阻止浏览器跨站简单请求绕过预检。

- `GET /api/cloud/config`：返回规范化 URL、来源与配置错误；不返回凭据。
- `PUT /api/cloud/config`：保存 URL 并使运行时失效；存在 Refresh Token 时，仅允许保存与 `sessionCloudUrl` 相同的规范化 URL，否则返回 HTTP 409 / `cloud_session_active`。
- `POST /api/cloud/test-connection`：一次性检查 health/ready。
- `POST /api/cloud/identity/reset`：要求 body `{"confirm":"reset-cloud-identity"}`；清内存 Access Token/模型缓存，轮换 installation 并清本地 Session，不向旧或新 Cloud 发送 Token。
- `GET /api/cloud/status`：返回本地安全摘要且不自动注册游客；旧 Session 缺失 URL 绑定或绑定到其他服务时返回 `sessionServiceMismatch: true`。
- `POST /api/cloud/guest/start`
- `POST /api/cloud/device/start`：若当前是本地模式，先建立游客 Session，再向绑定的 Cloud 服务申请设备授权；返回用户码、验证地址、过期时间与轮询间隔，不返回 `deviceCode`。
- `POST /api/cloud/device/poll`：Node 使用私有 `deviceCode` 轮询；结果为 `pending`、`slow_down`、`success`、`denied`、`expired` 或 `network`。仅网络异常、HTTP 5xx 与可重试服务错误映射为 `network`；协议错误和无效响应直接抛错。并发 poll 在单进程内合并为一次远端 exchange。
- `POST /api/cloud/device/cancel`：清理待处理授权，保留原游客 Session、目录、额度和设备信息。
- 以上三个 Device Flow 端点均要求 action header 与 JSON Content-Type，响应绝不包含 `deviceCode`。
- `GET /api/cloud/models`
- `GET /api/cloud/usage`
- `GET /api/cloud/installations`
- `DELETE /api/cloud/installations/:id`
- `POST /api/cloud/logout`

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

应用启动和页面刷新不会自动注册游客。`POST /api/cloud/guest/start` 仍是显式游客创建入口。用户点击“登录或注册”时，如果当前为 local，Node 会在该显式动作内先创建临时 guest，再启动 Device Flow；如果已是 guest，则直接升级。

Device Flow 使用 Cloud 承载的 `/device` 页面与账户登录/注册流程，QuickForge 不接触邮箱或密码。UI 展示设备码、验证页、复制、倒计时、取消并按服务端 interval 自动轮询；刷新页面后从公开状态恢复 pending。`authorization_pending` 继续等待，`slow_down` 增加轮询间隔，拒绝/过期清 pending，网络或服务不可用错误保留 pending 供重试；协议错误和无效响应直接报错。取消或失败始终保留原 guest Session。成功时 Node 在凭据写队列中用正式账户 Refresh Token 原子替换 guest Token，保留 installation，清 pending、账户旧摘要和模型缓存，再以严格白名单 `{id,email,plan}` 返回账户摘要。游客状态下，升级区域作为附加操作展示，不替换模型目录和设备列表。

## 统一模型目录与引用

所有正式模型入口统一使用服务端 Model Catalog。新绑定保存版本化 `ModelRef`：自定义模型保存稳定 Provider ID 与模型 ID，Cloud 保存 catalog ID；模型名称和能力可作为 `modelSnapshot` 展示快照，但 URL、Token、Header、API Key 等 transport 不属于执行权威数据。`active-model` 与 `default-options` 采用 `modelRef + modelSnapshot` 读旧写新；执行前由服务端根据当前 Provider 配置或当前 Cloud 目录重新解析，客户端提交的完整模型对象不能覆盖 transport。

Agent 会话、Agent Profile 固定模型与 AI Fill、定时任务、ACP、可操作共享会话以及默认模型页面均接入统一目录。旧完整模型快照继续读兼容，新写入优先包含 `modelRef`。用户显式绑定的 Cloud 模型失效时返回 `cloud_model_unavailable`，不静默换模型；仅 active/default 等隐式启动偏好允许回退到当前可选模型。

Cloud 模型目录采用有界缓存：60 秒软 TTL、5 分钟硬过期。软 TTL 后刷新失败可短暂使用未硬过期目录；指定 catalog ID 未找到时会强制刷新一次，仍不存在或标记 `available:false` 则 fail closed。

`quickforgeHidden` 只禁止成为新的选择。已有 Profile、任务和历史会话绑定仍可展示、保存、恢复和执行；用户切走后不能重新选择。它不是权限边界，也不会覆盖 Cloud 访问策略。

## 远程访问边界

来源属于 Tailscale IPv4 `100.64.0.0/10` 且已通过 LAN 密码认证的客户端可访问 `/api/cloud/*`，并可在统一模型目录和 Agent API 中使用 Cloud。普通 LAN、公网来源和未认证 Tailscale 请求不能选择或执行 Cloud。可操作共享默认不允许消耗分享者 Cloud 额度；只有分享者从本机或已认证 Tailscale 客户端显式启用 `allowCloudUsage` 后才允许。只读共享永不执行模型。后台定时任务在创建时完成模型授权和引用固化，执行时仍从当前 Cloud 目录解析，不使用旧 transport 快照。

通用 Storage 与 Backup API 不再向远程客户端开放 Provider Key、自定义 Provider、MCP、插件、定时任务和 Agent Profile 覆盖等敏感/可执行配置；Session 与 Session metadata 对远程保持只读，修改必须走 Agent API。上述数据必须通过本机 UI 或经过业务校验的专用 API 管理。

## 已知限制

- Device Flow 已在本地客户端/BFF 状态机和契约测试中覆盖，但本次未对外部 Cloud 仓库、真实邮件/浏览器登录页或生产账户系统做端到端验收。
- 服务重启不会恢复已经断开的上游流本身；恢复会话后通过重新生成/继续路径发起的新 Cloud stream 会复用原逻辑消息的 Idempotency-Key。
- 所有正式模型入口已统一接入 Model Catalog 与版本化 ModelRef；后续新增入口必须复用同一目录和服务端 resolver，不能自行读取 Provider store 或信任客户端 transport。
- 本地身份文件依赖操作系统账户与文件权限，尚未接入系统 Keychain。
- 当前服务端只识别 Tailscale IPv4 `100.64.0.0/10`，未实现或验证 Tailscale IPv6。
- 本次未验证外部 Cloud 仓库、真实 Provider、支付、生产部署、真实 Tailnet/ACL 或 Android WebView 端到端链路；这些内容不能据本文标记为已完成。
