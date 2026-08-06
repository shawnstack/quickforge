# QuickForge Cloud 本地客户端设计

## 状态

**当前 quickforge 仓库：Implemented and verified**（可配置服务连接、游客身份、本地凭据、云模型目录、本机 API、Agent 云调用、Session URL 绑定与本地身份重建）。

状态口径：

- **当前 quickforge 仓库已实现并验证**：本文涉及的本地 BFF、前端同源客户端和安全边界，已按当前源码及相关测试核对。
- **外部仓库声明、未验证**：Cloud 服务端、管理后台、Provider、部署与生产环境状态不属于本次验证结论。
- **Planned**：正式账户登录，以及“已知限制”中明确列出的后续项。
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

Access Token 只存在 Node 内存中。创建 Session 时会把规范化 Cloud URL 写入凭据记录的 `sessionCloudUrl`；Refresh Token 只会发送给该绑定 URL。运行时 URL 与绑定 URL 不一致，或检测到旧版本未绑定 URL 的 Session 时，所有 Token 操作都会以 `cloud_session_service_mismatch` 拒绝，用户需在账户页执行“重建身份并切换”；该恢复操作只清本地 Session 并轮换 installation，不会把旧 Token 发送给任何服务。

## 本地 API

所有 `/api/cloud/*` 仅允许本机请求，或“已通过 LAN 密码认证且 socket 来源属于 Tailscale IPv4 `100.64.0.0/10`”的远端请求；普通 LAN、公网来源和未认证 Tailscale 请求拒绝。未认证远端请求可能先被全局 LAN 认证层以 HTTP 401 拒绝；到达 Cloud 路由但不满足边界时返回 HTTP 403 / `cloud_local_only`。当前未实现 Tailscale IPv6 判定。配置类 JSON body 限制为 16 KiB。

- `GET /api/cloud/config`：返回规范化 URL、来源与配置错误；不返回凭据。
- `PUT /api/cloud/config`：保存 URL 并使运行时失效；存在 Refresh Token 时，仅允许保存与 `sessionCloudUrl` 相同的规范化 URL，否则返回 HTTP 409 / `cloud_session_active`。
- `POST /api/cloud/test-connection`：一次性检查 health/ready。
- `POST /api/cloud/identity/reset`：要求 body `{"confirm":"reset-cloud-identity"}`；清内存 Access Token/模型缓存，轮换 installation 并清本地 Session，不向旧或新 Cloud 发送 Token。
- `GET /api/cloud/status`：返回本地安全摘要且不自动注册游客；旧 Session 缺失 URL 绑定或绑定到其他服务时返回 `sessionServiceMismatch: true`。
- `POST /api/cloud/guest/start`
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

应用启动和页面刷新不会自动注册游客。`POST /api/cloud/guest/start` 仍是唯一游客创建入口，必须由用户主动确认数据发送说明。

正式账户 OAuth / Device Flow 登录协议仍未实现；当前账户页继续支持游客、额度、设备撤销、退出、服务连接和模型目录。

## 远程访问边界

来源属于 Tailscale IPv4 `100.64.0.0/10` 且已通过 LAN 密码认证的客户端可访问 `/api/cloud/*`，因此符合该边界的 Android 远程客户端可以使用宿主机的 QuickForge Cloud 身份、模型与额度。普通 LAN、公网来源和未认证 Tailscale 请求仍拒绝。该结论来自请求来源判定与路由测试，不等同于真实 Tailnet、ACL、防火墙或 Android WebView E2E 验收。

## 已知限制

- 正式账户登录尚未实现。
- 服务重启不会恢复已经断开的上游流本身；恢复会话后通过重新生成/继续路径发起的新 Cloud stream 会复用原逻辑消息的 Idempotency-Key。
- 当前只对主聊天启动模型做精确目录验证与安全回退；次级模型入口仍需后续统一审计。
- 本地身份文件依赖操作系统账户与文件权限，尚未接入系统 Keychain。
- 当前服务端只识别 Tailscale IPv4 `100.64.0.0/10`，未实现或验证 Tailscale IPv6。
- 本次未验证外部 Cloud 仓库、真实 Provider、支付、生产部署、真实 Tailnet/ACL 或 Android WebView 端到端链路；这些内容不能据本文标记为已完成。
