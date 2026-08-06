# QuickForge Cloud 本地客户端设计

## 状态

**Status: Implemented（游客身份、本地凭据、云模型目录、本机 API、Agent 云调用）/ Planned（正式账户、账户与云服务完整 UI）/ Not in current scope（支付、同步、团队）**

本文件描述 QuickForge 主仓当前工作树中的本地云客户端设计。云端总体设计和生产阻断项见 `quickforge-cloud` 仓库的 `docs/README.md` 与 `docs/production-acceptance.md`。

## 目标

QuickForge 保持本地优先和匿名可用：

- 未配置或未启用 QuickForge Cloud 时，本地模型、BYOK Provider、项目、会话和 Agent 正常工作。
- 游客身份只能由用户主动操作创建，应用启动不能自动注册。
- 浏览器 UI 不持有 Access Token、Refresh Token、安装私钥或官方上游模型密钥。
- 云账户不能绕过 LAN 访问认证，也不能自动获得 Agent 完全访问权限。
- 已通过 LAN 密码认证且来源属于 Tailscale `100.64.0.0/10` 的客户端可以使用宿主机云账户身份与额度；普通 LAN、公网来源和未认证请求仍拒绝。

## 配置

未设置 `QUICKFORGE_CLOUD_URL` 时云能力禁用，不连接云端，也不显示游客体验入口：

```text
QUICKFORGE_CLOUD_URL=https://cloud.example.com/
QUICKFORGE_CLOUD_TIMEOUT_MS=10000
```

本地开发可以显式设置：

```text
QUICKFORGE_CLOUD_URL=http://127.0.0.1:8080/
QUICKFORGE_CLOUD_ALLOW_INSECURE=1
```

约束：

- 默认只接受 HTTPS。
- HTTP 只在显式开启开发例外后允许 localhost 或回环 IP。
- URL 禁止 userinfo、query 和 fragment。
- 非回环 HTTP 地址始终拒绝。

## 凭据边界

凭据保存在：

```text
~/.quickforge/storage/security/cloud-identity.json
```

文件可能包含：

- 安装实例 Ed25519 公钥与 PKCS#8 私钥；
- Installation ID；
- Refresh Token；
- 注册失败重试使用的 pending Idempotency-Key 和请求摘要；
- 不敏感的账户摘要。

保护规则：

- 不注册到 `/api/storage/*`。
- 不进入现有 QuickForge 设置或会话备份。
- 不进入前端 localStorage。
- 不通过状态接口返回私钥、Refresh Token、pending key 或文件路径。
- 写入时使用临时文件替换，并尽力将目录设为 `0700`、文件设为 `0600`。
- Windows 上最终安全边界仍是当前操作系统账户及其文件系统权限；当前未接入 DPAPI、Keychain 或 Secret Service。

Access Token 只保存在 Node 进程内存中。需要刷新时使用 Refresh Token 单飞轮换，避免同一进程并发消费同一 Token。

## 本地 API

来源属于 `100.64.0.0/10` 且已通过 LAN 密码认证的 Tailscale 客户端可访问 `/api/cloud/*`，因此 Android 远程客户端可以使用宿主机的 QuickForge Cloud 身份、模型与额度。普通 LAN、公网来源和未认证 Tailscale 请求仍拒绝。该规则不会把 Tailscale 请求视为本机请求，因此终端、重启、打开本机路径等能力不会因此开放。

本地云 API 包括：

- `GET /api/cloud/status`
- `POST /api/cloud/guest/start`
- `GET /api/cloud/models`
- `GET /api/cloud/usage`
- `GET /api/cloud/installations`
- `DELETE /api/cloud/installations/:id`
- `POST /api/cloud/logout`

行为说明：

- `GET /api/cloud/status` 只读取本地安全摘要，不自动注册游客，也不保证云端当前可用。
- `POST /api/cloud/guest/start` 是唯一创建游客身份的入口，必须由用户主动操作触发。
- 状态响应不返回 Token、私钥或凭据文件路径。
- QuickForge Cloud 未配置或不可用时，本地项目、会话、本地模型和 BYOK Provider 不受影响。
- `POST /api/cloud/logout` 会先用当前 Session 撤销云端 installation；只有远端撤销成功后才清除本地 Session。远端不可用时保留本地凭据，避免丢失后续撤销能力。
- 退出后再次调用 `POST /api/cloud/guest/start` 会先轮换本地 Ed25519 安装密钥，再注册新的游客身份；这是新游客和新额度，不是恢复旧游客。

## 游客启动与恢复

### 首次启用

1. 用户在无模型页面点击“立即体验云模型”。
2. UI 展示数据发送说明，用户确认后调用本地 Node API。
3. Node 创建或读取安装实例 Ed25519 密钥。
4. Node 持久化注册 Idempotency-Key，然后请求云端游客注册。
5. 云端返回 Access/Refresh Token；Access Token 留在内存，Refresh Token 原子写入安全文件。
6. Node 获取公开云模型目录。
7. UI 激活第一项可用云模型并创建 Agent。

如果注册响应在网络中丢失，客户端复用 pending Idempotency-Key；云端使用 AES-256-GCM 加密保存的原始响应完成安全重放。

### 应用重启

1. Bootstrap 只读取 `/api/cloud/status`。
2. 只有本地记录显示已有 Session 时才请求云模型目录。
3. Access Token 不在内存时，Node 使用 Refresh Token 恢复。
4. 云端不可用时捕获错误并回退到本地/BYOK 模型或无模型页面，不能使整个 QuickForge 启动失败。
5. Bootstrap 不调用游客注册接口。

## 模型边界

前端只看到无密钥模型描述：

```text
provider: quickforge-cloud
baseUrl: quickforge://cloud/<catalog-id>
quickforgeModelSource: cloud
quickforgeCatalogId: <catalog-id>
```

公开描述包含目录下发的 `contextWindow`、`maxTokens` 和能力标记，但不包含真实云 URL、Access Token、Refresh Token、Authorization Header 或官方上游密钥。

云模型不会写入现有 `customProviders`，也不会写入自定义模型的浏览器缓存。模型选择器只在内存中合并：

1. 用户配置的自定义模型；
2. 当前云 Session 可用的官方云模型。

## Agent 请求接入

Agent 云模型调用已经接入统一推理路径，不需要在 `server/agent-manager.mjs` 中保存或传递云 Token。

调用流程：

1. 会话和前端只保存 `quickforge://cloud/<catalog-id>` 的公开模型快照。
2. `streamSimpleWithAiHttpLogging()` 识别 managed cloud model。
3. Node 根据 `quickforgeCatalogId` 在当前云模型目录中重新校验可用性；目录可能命中当前进程内存缓存。
4. Node 刷新或取得内存 Access Token。
5. Node 瞬时构造固定 Cloud `/v1` 模型配置。
6. 每次流式请求生成 `Idempotency-Key`，然后交给现有 pi-ai 流式接口。
7. 客户端模型或请求体中伪造的 `baseUrl`、headers、apiKey 和 model ID 不会决定真实云目标。

这样可以防止攻击者把官方云 Token 诱导发送到自定义地址。

主聊天用户消息携带公开的稳定逻辑 ID `metadata.quickforgeClientMessageId`。Cloud stream 创建时，Node 以 `sessionId + 逻辑消息 ID` 在 `~/.quickforge/storage/security/cloud-chat-idempotency/` 私有 sidecar 中原子创建或读取 UUID，并作为 `Idempotency-Key`；真正的 Key 不进入会话 JSON、浏览器 Agent state、共享会话或通用备份。相同逻辑消息的 Provider 内部网络重试、`/continue` 重新生成以及服务重启后恢复再试会复用同一 UUID；不同逻辑消息使用不同 UUID。辅助模型调用或缺少逻辑消息 ID 的兼容路径仍使用单次随机 UUID。HTTP 调试日志会脱敏该 Header。

服务重启不会恢复已经断开的上游流本身；恢复会话后通过重新生成或继续路径发起的新 Cloud stream 会复用原逻辑消息的 Idempotency-Key。

## HTTP 调试日志

`QUICKFORGE_AI_HTTP_LOG` 默认关闭。显式开启后：

- Authorization、API Key、Cookie 等敏感 Header 会脱敏；
- 请求和响应正文仍可能写入本地诊断日志，其中可能包含用户消息、文件片段和模型输出；
- 运维和 UI 必须将其视为本地敏感调试能力，不能默认开启或自动上传。

## UI 当前状态

已实现：

- 云服务已配置时，无模型页显示游客体验入口；
- 用户确认数据发送说明后才注册游客；
- 连接中状态；
- 重启恢复已有游客模型；
- 模型选择器合并自定义和云模型；
- 云模型进入现有 Agent 请求链；
- “账户与云服务”设置页展示身份、剩余额度、重置/到期时间和设备列表；
- 可撤销其他设备，并以“先远端撤销、后本地清理”的顺序退出当前设备；
- 退出后再次体验会轮换安装密钥并创建新游客，UI 明确不恢复旧游客额度；
- Cloud 状态变更会清空前端内存中的云模型缓存。

尚未实现：

- 额度不足错误的专用引导和单次请求用量展示；
- OAuth Device Flow 与正式账户登录；
- 恢复原游客账户、原 installation 或原额度；
- 退出后自动将当前 Agent 从失效云模型切换到本地/BYOK 模型。

## 已知风险与生产阻断项

- Refresh Token 在云端轮换提交成功、客户端新 Token 落盘前存在崩溃窗口。
- 安装私钥当前未用于请求 Proof-of-Possession。
- 本地凭据文件当前依赖 OS 文件权限，未使用系统 Keychain。
- 云模型目录可能使用进程内缓存，尚无版本化失效或推送机制。
- 退出只清理云身份和云模型内存缓存，当前 Agent 若仍引用云模型，需要用户手动选择可用模型。
- 真实 PostgreSQL/Redis/上游模型端到端链路尚未完成生产环境验收。

完整生产门禁以 `quickforge-cloud/docs/production-acceptance.md` 为准。

## 当前范围

- **Implemented**：游客身份、加密注册重放、Token 轮换、公开云模型目录、本地安全路由、模型选择、Agent 云调用，以及账户/额度/设备设置页和安全退出后新游客重注册。
- **Planned**：正式账户 Device Flow、额度不足专用 UX、原游客身份恢复和退出后的活动模型自动回退。
- **Not in current scope**：支付、会话/Memory/项目代码同步、团队和组织能力。
