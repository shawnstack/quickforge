# `src/lib/` — 前端工具库

包含前端工具模块，涵盖存储、聊天逻辑、本地工具、国际化、设置选项卡等。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `i18n.ts` | 2171 | 国际化（中/英）翻译和语言管理 |
| `pi-chat.ts` | 365 | Pi Chat 初始化和模型管理 |
| `server-agent.ts` | 832 | Server Agent — 服务端 Agent 客户端 |
| `shared-server-agent.ts` | 429 | 共享会话 Agent 客户端 |
| `local-tools.ts` | 247 | 前端本地工具渲染器注册 |
| `share-client.ts` | 148 | 分享功能客户端 API |
| `startup-model.ts` | 主聊天启动模型的当前目录精确匹配与安全回退 |
| `cloud-client.ts` | QuickForge Cloud 本地 BFF 客户端和公开配置/状态/额度/设备类型 |
| `http-storage-backend.ts` | 200 | HTTP Storage Backend 实现 |
| `types.ts` | 82 | 类型定义 |
| `utils.ts` | 6 | 通用工具函数（cn） |
| `message-utils.ts` | 95 | 消息处理工具 |
| `mermaid-renderer.ts` | 共享 Mermaid 动态加载、SVG 安全检查和渲染工具 |
| `custom-model-selector.ts` | 162 | 自定义模型选择器 |
| `custom-providers-only-tab.ts` | 565 | 自定义供应商设置选项卡 |
| `backup-settings-tab.ts` | 备份与恢复设置选项卡：按设置数据项选择导出内容（不包含对话），上传后预览有效/异常数据项，并支持按项替换或合并恢复 |
| `default-options-settings-tab.ts` | 257 | 常规设置选项卡（语言、默认模型、网络代理、上下文和终端 Shell） |
| `lan-access-settings-tab.ts` | 227 | LAN 共享设置选项卡 |
| `patch-thinking-selector.ts` | 117 | 思考模式选择器修补 |
| `clipboard-polyfill.ts` | 51 | 剪贴板 API polyfill |
| `logger.ts` | 56 | 前端日志工具 |
| `random-id.ts` | 19 | UUID 生成 |
| `tool-display-settings.ts` | 40 | Tool 与上下文用量展示设置 |
| `tool-execution-events.ts` | 120 | 工具执行事件处理 |
| `sidebar-session-sort-mode.ts` | 左侧会话时间线排序偏好的 `localStorage` 安全读写，刷新后恢复且不参与后端同步 |
| `chat-harness-capabilities.ts` | 主聊天 Harness capability 静态表与页面策略 resolver；QuickForge 默认全开，OpenCode P0 关闭模型/思考、Plan/Access、命令与 capability suggestions、上下文压缩、历史派生（按消息 fork/rollback/retry），P1 开放整会话 fork（`forkSession`）与 OpenCode 动态配置（`harnessConfig`） |
| `system-notifications.ts` | 浏览器 Notification/Service Worker 与 Capacitor Android 本地通知统一适配；管理当前设备权限、安卓远程浏览器首次发送授权、后台展示、点击打开会话和短时去重 |
| `info-tip.ts` | 134 | 统一问号说明浮层 Web Component |

---

## 核心模块

### i18n.ts (1072 行)

**用途**: 国际化支持。包含中英文翻译字典和应用语言管理。

**功能**:
- 支持 `en` / `zh` 两种语言
- 提供 `t()` 翻译函数
- 语言初始化/应用函数
- 与 `pi-web-ui` 的翻译集成
- 日期区域设置

### pi-chat.ts (365 行)

**用途**: Pi Chat 的初始化和模型配置管理。

**功能**:
- `initializePiStorage()` — 初始化存储后端
- `loadDefaultOptions()` / `saveDefaultOptions()` — 默认选项管理
- `getConfiguredModels()` — 通过同源 `GET /api/models/catalog` 获取统一公开目录，包含当前可用的自定义模型和 QuickForge Cloud 模型；失败时仅为本机旧环境回退 Provider store。`getSelectableConfiguredModels()` 统一排除 `quickforgeHidden: true`。
- `saveActiveModel()` / `saveDefaultOptions()` — 写入展示快照并附带版本化 `quickforgeModelRef`，执行 transport 仍由服务端解析。
- `loadInitialConfiguredModel()` / `resolveNewSessionModel()` — QuickForge 新会话只从当前可选择目录解析默认、active 或请求模型；已隐藏、已删除或失效的模型不会成为新会话候选。OpenCode 新会话改用仅供前端 state/type 的本地占位模型，不要求 QuickForge Provider，且创建 POST 不发送该占位模型。
- `resolveConfiguredModel()` — 已有会话、分支等持久化绑定按完整模型身份恢复，可继续使用后来被隐藏的模型。
- DeepSeek V4 推理兼容性处理

### model-reference.ts

**用途**: 前端版本化 ModelRef 与统一目录客户端。

- `ModelReference` 区分 `custom(providerId + modelId)`、`cloud(catalogId)` 和旧自定义快照兼容引用。
- `modelReferenceFromModel()` 为 Agent、Profile、任务和共享切换生成持久化引用。
- `loadModelCatalog()` 读取同源 `/api/models/catalog`，不读取 Provider Key 或 Cloud Token。

### cloud-client.ts

**用途**: 封装同源 `/api/cloud/*` 本地 BFF，只处理公开配置、连接测试、状态、模型、额度和设备数据，不在浏览器持有 Cloud Token。

- `getCloudConfig()` / `updateCloudConfig()` 管理独立受管服务 URL；`testCloudConnection()` 仅请求 Node BFF 做 health/ready 检查。
- `resetCloudIdentity()` 发送固定危险确认值，由 Node 清本地 Session 并轮换 installation；错误通过 `CloudClientError.code` 保留（包括保存配置时的 `cloud_session_active`，以及 Token 操作时的 `cloud_session_service_mismatch`）。
- `getCloudStatus()` 只读取本地安全摘要，不触发注册；可恢复公开的 pending Device Flow，但不包含 `deviceCode`。
- `startCloudDeviceFlow()` / `pollCloudDeviceFlow()` / `cancelCloudDeviceFlow()` 使用受保护 JSON 写接口完成正式账户状态机，浏览器不提交邮箱、密码或 deviceCode。
- `getCloudUsage()` / `getCloudInstallations()` 读取额度与设备。
- `revokeCloudInstallation()` / `logoutCloud()` 管理设备生命周期；当前设备退出的远端撤销顺序由 Node 保证。

### server-agent.ts (832 行)

**用途**: `ServerAgent` 类 — 与服务端 Agent 通信的客户端。

**关键功能**:
- SSE 事件流管理（`GlobalAgentSseClient`）
- 消息发送/接收
- Agent 状态管理（创建、单次恢复、销毁）；`ServerAgent.restore()` 支持 `AbortSignal`，从 `/api/agents/:sessionId/restore` 一次取得完整权威快照，取消的旧会话请求不会创建 SSE；页面刷新或 SSE 重连时会从服务端 state 恢复运行中工具的临时 `toolResult`（含 subagent `details.messages`）和 `pendingToolCalls`
- OpenCode `acpSession` 快照（configOptions/modes/usage）随 state 事件与 refresh 同步；`setConfigOption`/`setMode` 调用 harness API 并以响应刷新本地；`forkSession` 触发整会话 ACP fork；`acp_session_usage_update` 轻量事件即时更新 usage
- 系统提示词加载
- Agent 权限模式切换
- 自定义命令注入
- 支持直接后端连接（绕过 Vite 代理）

### shared-server-agent.ts (429 行)

**用途**: `SharedServerAgent` 类 — 共享会话的 Agent 客户端。

**功能**:
- 从共享状态恢复会话
- 只读/可操作模式
- 消息发送
- 回滚支持
- SSE 事件订阅

## 工具模块

### model-visibility.ts / model-identity.ts / model-display-label.ts

**用途**: 收口模型选择与展示规则。

- `isModelSelectable()` / `filterSelectableModels()` 仅排除明确设置 `quickforgeHidden: true` 的模型，并保持 `Model<Api>[]` 泛型返回值；缺少字段的旧配置继续可见。
- `modelIdentityKey()` / `sameModelIdentity()` 使用 Provider、Model ID、API 和规范化 Base URL 区分模型；`modelMatchesReference()` 兼容旧 Agent 引用缺少可选字段。
- `includeCurrentModel()` 只为编辑或恢复入口重新加入当前已绑定的隐藏模型，不把它变成其他新选择候选。
- `modelDisplayLabel()` 统一输出 `Provider / Model ID`，不使用 Provider 内部模型名称、API 或 Base URL 作为选择标签。
- `custom-model-selector.ts` 是展示层，调用方必须传入已过滤的新选择目录；主聊天、默认模型、Agent Profile、定时任务和共享会话均按上述规则准备列表。

### local-tools.ts

**用途**: 在 `pi-web-ui` 中注册本地工具渲染器；`run_command` 运行中会显示图标按钮，通过 `/api/agents/:sessionId/abort-tool` 手动结束当前命令；`run_subagent` 在聊天中只展示名称、状态和耗时摘要，点击整个摘要通过 `window` CustomEvent（`OPEN_SUBAGENT_RUN_EVENT`，事件名 `quickforge:open-subagent-run`）在 `WorkspaceInspector` 中打开或激活该次运行的独立 Tab，不再内联展开完整过程；renderer 会把 toolResult 顶层 `toolCallId` 显式传给 `buildSubagentRunPayload()`，确保临时/最终消息都使用父工具调用 canonical ID；缺少 canonical ID 的 `called/running` 摘要禁用、不打开且不进入全局 store，已完成历史消息仍可用 `sessionId/name:task` fallback 直接打开，但不会发布到 store；运行详情由 `renderSubagentRunBody` 渲染并通过 Lit 宿主元素 `subagent-run-detail-body` 嵌入工作区 Tab，沿用原详情视觉样式并遵循工具显示配置（`concise / compact` 简洁显示，`detailed` 额外展示工具统计、允许工具和 input/details）；宿主每次渲染后调度 `decorateSubagentProcessBlocks`（`panel-decoration/message-actions.ts`），对内部过程 message-list 应用与聊天一致的 process folding / 过程分组装饰与交互（幂等、不重复叠加、卸载随 DOM 回收）；`run_subagent` renderer 仅回填 canonical 安全快照：首次可发布，或以恢复出的 done/error 修正 store 中已有 called/running，其他已有快照仍以 `ServerAgent` 的 `tool_execution_*` SSE 为权威；canonical 摘要点击时可取 store 最新同 ID 载荷，非 canonical 历史摘要始终使用当前 renderer 载荷；聊天摘要按钮具备 hover / focus-visible 反馈与 `aria-label`/`title` 可访问语义；`generate_image` 以独立结果块展示会话图片资产，并根据普通页或 `/share/:shareId` 自动构造同源资源 URL。

**支持的工具渲染**: `run_subagent`, `read_file`, `grep_files`, `write_file`, `edit_file`, `run_command`, `generate_image`, `present_files`, `activate_skill`, `read_skill_resource`

### subagent-run-detail.ts

**用途**: subagent 单次运行详情的纯逻辑（不依赖 DOM/Lit/React/i18n 运行时，`t` 由调用方注入）。`buildSubagentRunPayload()` 把 run_subagent 的 params/result.details 规范化为 Workspace Inspector 运行 Tab 使用的统一载荷（稳定 run id 以 `toolCallId`（显式参数、toolResult 顶层字段或 `details.toolCallId`）为主键，`details.sessionId` 仅作历史兼容 fallback，两者都没有时回退 `${name}:${task}`；同时携带 `canonicalToolCallId`，并生成状态/状态文案/耗时/工具调用数/允许工具/过滤后的过程消息/input/details JSON/内容指纹）。`canPublishSubagentRunPayload()` 仅允许 canonical 载荷进入全局 store；`canOpenSubagentRunPayload()` 允许 canonical 任意状态以及无 canonical 的 done/error 历史载荷打开；`shouldPublishSubagentRunPayload()` 允许 renderer 首次发布 canonical 快照，或用恢复出的 done/error 修正已有 called/running，其他已有快照保持 SSE 权威；`resolveSubagentRunPayloadForOpen()` 仅为 canonical 点击选取 store 最新同 ID 快照，历史 fallback 始终返回当前 renderer 载荷。`subagentRunFingerprint()` 用于实时更新去重且包含 `canonicalToolCallId`，`normalizeOpenSubagentRunRequest()` 校验打开事件 detail；`subagentRunBodyBlocks()` 是运行详情内部块顺序（task/context/expectedOutput → 详细摘要 → trace → 无 trace 时 output → input/details）的单一事实来源，与 Git 历史最终态一致；`SubagentRunStore` 是有界（`MAX_SUBAGENT_RUN_SNAPSHOTS`=100）的内存快照 store，支持 publish（指纹去重、订阅者异常隔离）/get/subscribe/clear（clear 仅清快照、保留订阅），全局单例 `subagentRunStore` 供 ServerAgent 实时发布与 Workspace Inspector 订阅；`subagentRunPayloadFromToolEvent()` 是 tool_execution_start/update/end 事件到载荷的纯转换（isStreaming 区分运行/终态、args 缓存回填、previousTiming 回填、isError 归 error）；`SubagentRunEventPublisher` 是 ServerAgent 持有的 SSE 事件发布器，按 toolCallId 缓存 run_subagent 的 args/toolName（start 缓存、end 清理），用规范化 start 事件（带 partialResult）发布，update/end 缺 args/toolName 时回填缓存，previousTiming 取 store 中同 runId 上一次载荷；Workspace Inspector Tab 严格按相同 `runId` 更新/upsert，不执行 fallback 迁移。

### generated-image-assets.ts

**用途**: 校验 `generated_image_result` 工具元数据，只接受受控图片 MIME 和服务端 UUID 资产 ID；为普通会话与分享页构造同源图片资源 URL。

### tool-artifacts.ts

**用途**: 从当前 AI turn 的工具结果中提取产物文件；识别 `write_file`、`edit_file` 和 `present_files`，并将 HTML/图片分流到 Browser，将 Markdown、代码、配置及普通文本分流到 Reader；显式 `preview: false` 的文件仅保留在产物列表。

### mermaid-renderer.ts

**用途**: 聊天 Markdown 与 Workspace Markdown Reader 共享的 Mermaid 渲染入口。首次遇到 Mermaid fenced code block 时动态加载 Mermaid，以严格安全配置生成 SVG，并在转为图片预览前拒绝脚本、事件属性、HTML 外嵌内容和外部资源。

### http-storage-backend.ts (200 行)

**用途**: 通过 HTTP API 实现的 Storage Backend。

**功能**:
- 实现 `StorageBackend` 接口
- 可配置的 `blockedStores`（阻止访问某些存储区域）
- 支持 `storeOverrides`（覆盖本地读取逻辑）
- 健康检查（`isAvailable()`）
- `fakeProviderKeys` — 模拟供应商密钥

### types.ts (82 行)

**类型**: `BackgroundTaskStatus`, `ChatScope`, `ProjectInfo`, `SkillsScope`, `SkillSummary`, `RestoredDraft`, `QuickForgeSessionMetadata`, `QuickForgeSessionData`, `BackgroundTask`

### utils.ts (6 行)

- `cn()` — Tailwind class 合并工具 (封装 `clsx` + `tailwind-merge`)

### clipboard-polyfill.ts (51 行)

**用途**: 为非安全上下文 (HTTP) 提供剪贴板 API polyfill。当 `navigator.clipboard` 不可用时，回退到 `document.execCommand('copy')`。

### logger.ts (56 行)

**用途**: 前端日志工具，支持 `error`/`warn`/`info`/`debug` 级别，`debug` 级别需在 localStorage 设置 `quickforge_debug=1`。

### random-id.ts (19 行)

**用途**: 生成 UUID v4，优先使用 `crypto.randomUUID()`，回退到手动构造。

### tool-display-settings.ts

**用途**: 工具展示设置管理。支持“简洁 / 详细”模式：简洁模式隐藏原始 Tool JSON 并默认收起详情；详细模式显示完整参数和 details，并默认展开工具调用。上下文用量显示设置也保存在该配置中。

### tool-execution-events.ts (120 行)

**用途**: 工具执行事件类型定义和消息合并工具。

**功能**:
- `QuickForgeToolTiming` / `ToolExecutionEvent` 类型
- `upsertMessage()` — 根据 `toolCallId` 合并或替换工具结果消息
- `toolStartEventWithPartialResult()` / `upsertToolResult()` — 在运行中工具结果里保留计时、`sessionId` 和 `toolCallId`，用于前端展示耗时和结束运行中的 `run_command`。

### system-notifications.ts

**用途**: 复用任务完成 SSE 事件，在 QuickForge 客户端仍运行时显示系统级通知。

- Web 优先通过 Service Worker registration 的 `showNotification()` 展示通知并携带会话 ID；非 Android 或无 SW 时才回退浏览器 `Notification` 构造器。Android 普通浏览器没有可用 SW registration 时不依赖构造器。
- Capacitor Android 使用 `@capacitor/local-notifications`；设置页手动授权逻辑保持独立。
- Android 普通远程浏览器仅在 HTTPS 安全上下文中，于首次有效发送（含仅附件）同步标记并自动申请一次权限；需要 `Notification` 和 Service Worker API 可用。
- 权限与启用开关按设备保存在 `localStorage`；任务终态在前台也会显示系统通知，仅“运行中”通知在页面可见且有焦点时被抑制，并通过任务 key 做短时跨标签去重。
- 浏览器通知点击由 Service Worker 聚焦同源窗口并发消息，页面监听消息后派发已有会话打开事件；原生通知点击也复用该会话打开逻辑。通知正文不包含完整 AI 输出。
- 不提供 Web Push/FCM；普通浏览器页面或原生 App 无法继续接收现有 SSE 时，不保证任务完成通知。

### info-tip.ts (134 行)

**用途**: 统一的问号说明浮层组件，封装为 Web Component `<quickforge-info-tip>`。用于将大段辅助说明收拢到标题/字段旁的 `?` 图标中，hover / focus / click 时展开。

**特性**:
- 基于 `LitElement`，使用 light DOM（`createRenderRoot` 返回 `this`），Tailwind class 与全局 CSS 变量直接生效。
- 渲染弱化 `?` 图标；hover（150ms 延迟）/ focus 展开，click 切换，外部 pointerdown / Escape 关闭。
- 仅 `label` 属性（说明文案，为空则不弹出）；`aria-label` / `aria-expanded` / `role="tooltip"` 支持可访问性。
- 幂等注册（`customElements.get` 守卫）。
- 双端可用：Lit 模板用 `.label` 属性绑定，React 用 `label` prop。

**样式**: 定义在 `src/index.css`（`.quickforge-info-tip*`），复用全局 `--popover` / `--border` 变量与轻阴影，不引入新的视觉模式。

**首个使用点**: `project-commands-settings-tab.ts`（标题旁收拢 `projectCommandsDescription`）。设计约定见 `DESIGN_LANGUAGE.md`「辅助说明统一使用 `<quickforge-info-tip>`」。

## 设置选项卡

所有设置选项卡继承自 `@earendil-works/pi-web-ui` 的 `SettingsTab` 类，使用 Lit HTML 渲染。

| 文件 | 用途 |
|------|------|
| `custom-providers-only-tab.ts` | 自定义模型供应商的完整 CRUD 管理界面 |
| `lan-access-settings-tab.ts` | LAN 共享设置（启用/禁用、密码、会话 TTL），仅展示当前仍有访问权限、可以踢出的局域网设备摘要、IP 与有效期，并支持逐个或全部踢出 |
| `backup-settings-tab.ts` | 数据备份导出和导入 |
| `default-options-settings-tab.ts` | 设置默认模型、语言、思考级别、Tool 展示、上下文用量显示、上下文管理和终端 Shell；默认 Shell 从系统识别列表选择，并支持自定义命令或路径 |
| `about-settings-tab.ts` | 关于信息、更新检查/执行，以及后端服务重启 |
| `project-commands-settings-tab.ts` | 项目命令目录配置 + 命令预览 + 新建命令 |
| `archived-conversations-settings-tab.ts` | 已归档对话的恢复和永久删除 |
| `react-settings-tabs.tsx` | 将 Agent、Skills、MCP、插件、定时任务和分享链接管理等 React 页面适配为设置 Tab |
| `share-client.ts` | 分享链接创建、列表、编辑（权限/密码/有效期）、停用、恢复、永久删除及状态推导 API |
| `channels-settings-tab.ts` | 渠道设置选项卡：展示名称、状态、简述、工作区与启动/停止/登录操作，仅在存在二维码内容时展示扫码入口，同时保留错误提示，并通过“打开日志文件夹”访问后端持久化渠道日志 |
| `patch-thinking-selector.ts` | 修补 pi-web-ui 的模型选择器 |
| `custom-model-selector.ts` | 自定义模型选择器对话框 |

### message-utils.ts (95 行)

**用途**: 消息处理工具函数。

**功能**:
- `assistantText()` — 提取助手消息文本
- `rollbackStartIndexFromMessage()` — 计算回滚起点
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 剪贴板复制
- `generateTitle()` / `titleNeedsGeneration()` — 标题生成
