# `src/lib/` — 前端工具库

包含前端工具模块，涵盖存储、聊天逻辑、本地工具、国际化、设置选项卡等。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `i18n.ts` | 3351 | 国际化（中/英）翻译和语言管理；`applyAppLanguageFromSnapshot` 供启动快照预应用（不写库不 reload） |
| `pi-chat.ts` | 365 | Pi Chat 初始化和模型管理 |
| `server-agent.ts` | 2260 | Server Agent — 服务端 Agent 客户端 |
| `selected-capabilities.ts` | 82 | 用户本轮插件选择的前端统一规范化/快照：合法类型与字符串边界、`type+pluginName+name` 去重、顺序保持、最多 4 项，持久化/历史读取快照均剥离 description |
| `deferred-session-agent.ts` | 302 | 新会话首条消息前的延迟 Agent 代理：本地先渲染乐观消息，`prompt()` 时才创建真实 `ServerAgent`，并把暂存的 capabilities / contextReferences / promptMode 转发给真实 Agent |
| `indexeddb-cache.ts` | 通用 IndexedDB 只读缓存封装：惰性单例 open、条目级 schemaVersion、LRU+字节双预算淘汰、全部异常静默降级（供会话消息/工作区/设置快照等缓存层复用） |
| `session-message-cache.ts` | 会话消息只读快照 store（F12）：`resolveServerCacheKey`（baseUrl→直连后端→origin）、结构校验读取、per-key debounce 写入 + stateVersion 高水位守卫、IndexedDB 不可用全程 no-op |
| `workspace-cache.ts` | Workspace 只读缓存 store（F13）：目录条目（SWR+30s TTL 新鲜判定）、展开路径、文件内容（size+mtimeMs 失效戳、>1MB 跳写）；复用 `IndexedDbCache` 与 `resolveServerCacheKey`，坏条目删除、不可用全程 no-op |
| `app-settings-cache.ts` | 启动 Settings 快照 store（F14）：追踪键白名单（language/外观/字号/工具展示）、结构校验读取（坏条目删除）、>4KB 跳写；`HttpStorageBackend.set` 经 `updateAppSettingSnapshotFromStorageSet` 写通，IndexedDB 不可用全程 no-op |
| `shared-server-agent.ts` | 488 | 共享会话 Agent 客户端 |
| `local-tools.ts` | 1352 | 前端本地工具渲染器注册；含原生 `todo_write` 与 OpenCode `todowrite` 专用历史 renderer |
| `todo-write-history.ts` | 90 | TodoWrite 历史工具消息视图模型：区分 running/error/success/clear/neutral，并按 QuickForge/OpenCode 来源提取已应用快照 |
| `share-client.ts` | 148 | 分享功能客户端 API |
| `slash-catalog.ts` | 102 | 斜杠菜单目录客户端：并行拉取 `/api/skills?available=true`（可带 projectId）与 `/api/agent-profiles`（可带 projectId），agents 过滤 `enabledAsSubagent === true`；任一失败/非 200/形状异常整体返回 null 静默降级；按 projectId 模块级缓存成功结果 |
| `composer-drafts.ts` | 241 | Composer 本地草稿：正文、结构化文件 `contextReferences` 与结构化能力 `selectedCapabilities` 按 session/project key 写入 localStorage；能力选择防御规范化、按 `type+pluginName+name` 去重且最多 4 个；正文为空但有 refs/capabilities 仍保留草稿，附件不持久化 |
| `message-queue.ts` | 172 | 流式期 Composer 消息队列：纯函数入队/删除/编辑/置顶/拖拽重排 moveQueuedMessage（20 条上限、单条 2000 字符）与 per-session localStorage 持久化（含 paused 标记、无 localStorage 安全降级）；插队经 `ServerAgent.steer`（乐观显示） |
| `startup-model.ts` | 主聊天启动模型的当前目录精确匹配与安全回退 |
| `cloud-client.ts` | QuickForge Cloud 本地 BFF 客户端和公开配置/状态/额度/设备类型 |
| `http-storage-backend.ts` | 245 | HTTP Storage Backend 实现；`set` 成功后 fire-and-forget 写通启动设置快照（`app-settings-cache`） |
| `types.ts` | 82 | 类型定义 |
| `utils.ts` | 6 | 通用工具函数（cn） |
| `message-utils.ts` | 95 | 消息处理工具 |
| `mermaid-renderer.ts` | 共享 Mermaid 动态加载、SVG 安全检查和渲染工具 |
| `custom-model-selector.ts` | 590 | 自定义模型选择器；主聊天可通过可选无参回调在桌面浮层与移动抽屉底部显示“自定义模型”，点击先关闭选择器再打开设置，未传回调的共享对话/表单复用场景不显示 |
| `custom-providers-only-tab.ts` | 565 | 自定义供应商设置选项卡 |
| `backup-settings-tab.ts` | 备份与恢复设置选项卡：按设置数据项选择导出内容（不包含对话），上传后预览有效/异常数据项，并支持按项替换或合并恢复 |
| `default-options-settings-tab.ts` | 257 | 常规设置选项卡（语言、默认模型、网络代理、上下文和终端 Shell）；先用统一目录/本地模型渲染，Cloud 模型在后台加载后增量合并 |
| `lan-access-settings-tab.ts` | 227 | LAN 共享设置选项卡 |
| `patch-thinking-selector.ts` | 117 | 思考模式选择器修补 |
| `clipboard-polyfill.ts` | 51 | 剪贴板 API polyfill |
| `logger.ts` | 56 | 前端日志工具 |
| `update-check-poll.ts` | 71 | 更新检查轮询助手：`requestUpdateCheck()` 对非阻塞的 `GET /api/system/update/check` 状态快照做有界轮询（默认 10 次 × 1s，可注入 fetch/sleep 单测）到 `ok`/`error` 终态，失败一律返回 `{ kind: 'error' }` 不抛出（fetch/sleep 可注入）；`force` 仅首次请求带 `?force=1`；兼容不带 `status` 字段的旧服务端 payload |
| `random-id.ts` | 19 | UUID 生成 |
| `tool-display-settings.ts` | 40 | Tool 与上下文用量展示设置 |
| `tool-execution-events.ts` | 120 | 工具执行事件处理 |
| `tool-param-summary.ts` | 工具参数→摘要文案纯函数：`summarizeParams`（自 local-tools 提取，按工具名取 command/path/query 等生成单行摘要）、`normalizeToolArguments`（toolCall arguments 归一化，兼容 JSON 字符串）、`truncateSummary`；工具卡片与 subagent 跑马灯共用同一套规则 |
| `tool-marquee.ts` | subagent 摘要卡「当前工具」跑马灯动画控制：`ToolMarqueeController`（DOM/定时器/动画经参数注入可单测）——容器内双视图（各含 static+moving span，宿主定高一行），溢出且非 reduced-motion 时 WAAPI 横向循环（35px/s 滚动→端部停顿→回弹），同值刷新不打断；text 切换时旧视图向上滚出、新视图自下滚入（`MARQUEE_ROLL_DURATION_MS`=260ms + 里程计同族缓动，滚动期间旧视图横向动画不中断，结束后按既有 400ms 起始延迟重建横向循环，滚动中再遇新文本先就地结算再重滚），reduced-motion/首次出现/终态退化为直切，常量与侧栏会话标题跑马灯一致 |
| `input-clamp.ts` | 长输入内容定高收起（聊天用户消息气泡 + subagent 详情任务块共用，设计稿 `design-mockups/input-clamp-expand.html`）：`InputClampController`（DOM 能力注入可单测）管理 data 属性状态机与内联 max-height 过渡（220ms，展开结束后置 none，reduced-motion 直切）；正文阈值按元素 computed line-height × 6 行 + 纵向 padding/border 计算（随字号设置缩放），overflowing 内容额外显示 30px 流内按钮安全区，确保展开/收起按钮不覆盖正文，fits 内容隐藏安全区、渐隐与按钮且不留空白；i18n 标签由调用方注入（模块不 import i18n，保持 node 环境可测）；DOM 装饰入口 `decorateUserMessageInputClamp`（聊天装饰）与 `syncInputClampBoxes`（subagent 详情 updated 后） |
| `diff-counter.ts` | 工具卡片 ±行数里程计：`OdometerDiffCounterController`（DOM/定时器注入可单测）驱动 `quickforge-diff-counter` 元素——每位数字一列、translateY 滚动、进位新列左侧入场、位数减少移除最左列、running 呼吸、reduced-motion 关动画；数据源为 write/edit 工具写盘前的 partial update（`details.diff.addedLines/removedLines`，见 `server/tools/index.mjs`） |
| `diff-view.ts` | write/edit 工具 unified diff 的结构化解析纯函数：`parseDiffRows`（行号 old/new 双侧、剥离 +/- 前缀、hunk 间隙省略行数、配对删/加行字符级变化段）、`parseDiffFileInfo`（路径上提 + `/dev/null` 判新文件）、`tokenizeDiffLine`/`markTokenChanges`（单词/空白/单符号三分段 token LCS，乘积超 40000 回退整行变化）；renderDiff 消费其结果渲染对话区 diff 块，设计稿见 `design-mockups/diff-display-optimization.html` |
| `sidebar-session-sort-mode.ts` | 左侧会话时间线排序偏好的 `localStorage` 安全读写，刷新后恢复且不参与后端同步 |
| `sidebar-session-display.ts` | 左侧 Projects 时间线、项目会话与 Tasks 的五条递增展示纯行为：计算下一展示目标、判断是否需要请求下一页，并以 timeline/global/project 各 key 的 pending generation 合并快速重复点击；仅在异步加载确认新增数据且 generation 仍有效时提交展示数量，重置会使在途旧请求失效，失败保持原数量并允许重试 |
| `sidebar-section-order.ts` | 左侧 Projects / Tasks 顶层区块顺序的 `localStorage` 安全读写与纯函数排序：规范化缺失、重复和外来 ID，固定映射 `tasks` 到现有 conversations UI；桌面/移动共用 App 状态，置顶区不参与排序 |
| `chat-harness-capabilities.ts` | 主聊天 Harness capability 静态表与页面策略 resolver；QuickForge 默认全开，OpenCode P0 关闭模型/思考、Plan/Access、命令与 capability suggestions、上下文压缩、历史派生（按消息 fork/rollback/retry），P1 开放整会话 fork（`forkSession`）与 OpenCode 动态配置（`harnessConfig`）；另导出 `SIDE_CHAT_CAPABILITIES` 全 false 的可执行能力表，Side Chat 仍复用主控件布局，但由共享装饰层将不支持控件原生禁用，服务端固定 `tools: []` 作为安全边界 |
| `system-notifications.ts` | 浏览器 Notification/Service Worker、Electron Desktop 原生通知与 Capacitor Android 本地通知统一适配；管理默认开启的设备偏好、权限、安卓远程浏览器首次发送授权、后台展示、点击打开会话和短时去重 |
| `info-tip.ts` | 134 | 统一问号说明浮层 Web Component |

---

## 核心模块

### i18n.ts (3351 行)

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
- `loadInitialConfiguredModel()` / `resolveNewSessionModel()` — QuickForge 新会话只从当前可选择目录解析默认、active 或请求模型；已隐藏、已删除或失效的模型不会成为新会话候选。Cloud 目录加载以 5 秒为上限，超时降级为空目录并回退已配置模型。OpenCode 新会话改用仅供前端 state/type 的本地占位模型，不要求 QuickForge Provider，且创建 POST 不发送该占位模型。
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

### server-agent.ts (2260 行)

**用途**: `ServerAgent` 类 — 与服务端 Agent 通信的客户端。

**关键功能**:
- SSE 事件流管理（`GlobalAgentSseClient`）
- 消息发送/接收；`steer(message)` 乐观显示——立即把 steering user 消息追加进本地 state 并发 `message_start`，服务端在下一工具轮边界注入同一消息（同 role+timestamp）经 `message_end` 回显后由 `upsertMessage` 原位替换不重复，HTTP 失败则回滚乐观副本并重新通知面板；prompt HTTP 请求失败时先回滚未被服务端接收的乐观 user message，再追加符合消息契约的 assistant error message（具体 `errorMessage`、`stopReason:'error'`、当前模型字段、零 usage 与 timestamp），并以 `agent_end` 的 `status:'error'` / `errorMessage` 结束本地运行，让聊天区直接显示服务端返回的具体原因
- Agent 状态管理（创建、单次恢复、销毁）；`ServerAgent.restore()` 支持 `AbortSignal`，从 `/api/agents/:sessionId/restore` 一次取得完整权威快照，取消的旧会话请求不会创建 SSE；页面刷新或 SSE 重连时会从服务端 state 恢复运行中工具的临时 `toolResult`（含 subagent `details.messages`）和 `pendingToolCalls`
- OpenCode `acpSession` 快照（configOptions/modes/usage）随 state 事件与 refresh 同步；`setConfigOption`/`setMode` 调用 harness API 并以响应刷新本地；`forkSession` 触发整会话 ACP fork；`acp_session_usage_update` 轻量事件即时更新 usage
- ask_user 提问流：`ask_user_required`/`ask_user_answered` SSE 事件维护 `state.pendingAsk`（随 state 快照与 SSE state 帧恢复），`answerAsk(askId, {answers, skipped})` POST `/api/agents/:id/answer-ask` 回传后清空 pending；回答以纯文本作为 ask_user 工具结果回给模型
- 系统提示词加载
- Agent 权限模式切换
- 自定义命令注入
- 下一次 prompt 的结构化选择：`setNextPromptCapabilities()` 先通过 `selected-capabilities.ts` 统一规范化（仅合法对象/字符串、裁剪长度、按 `type+pluginName+name` 去重、保持顺序、最多 4 项），请求体继续发送可含 description 的本轮选择，同时乐观 user message `details.selectedCapabilities` 写入不含 description 的展示快照；与 `details.contextReferences` 可共存，两者均发送一次后清空，下一轮不泄漏。`setNextPromptContextReferences()` 发送最多 8 个 `{type:'file',projectId,path}`，随 prompt body 的 `contextReferences` 字段上送、乐观 user message 同步写入 `details.contextReferences` 供历史 chip 即时渲染；失败沿用既有 optimistic 回滚。`setPromptMode('plan' | 'ask' | null)` 把 `setPlanMode` 泛化为单轮模式选择（当前仅 `'plan'` 映射到既有 `{type:'plan'}` command，`'ask'` 为预留值尚无发送方；`setPlanMode` 保留为兼容包装）
- 支持直接后端连接（绕过 Vite 代理）
- **弱网重连状态广播**：`GlobalAgentSseClient` 的指数退避重连（1s 起 ×2、封顶 30s）新增尝试计数与上限 `MAX_SSE_RECONNECT_ATTEMPTS = 10`；`onerror` 进入恢复（直连→同源代理切换计一次零等待尝试）时经 `subscribeSseConnectionState` 广播 `{status:'reconnecting', attempt, maxAttempts, nextRetryAt, unreachable?}`，`onopen` 成功且此前确有断连时广播 `{status:'connected', recovered:true, restarted?}` 并重置计数/退避，第 10 次重试仍失败广播 `{status:'failed', maxAttempts}` 并停止自动重试（`requestSseReconnectNow()` 供 UI「立即重试」手动重启、`getSseConnectionState()` 取当前快照）；断连期间的 streaming 卡死仍由既有 15s 静默看门狗轮询 `/status` 兜底，两者互补不替代。重连期间每次调度失败后还会 fire-and-forget 探测一次 `/api/health`（`SSE_HEALTH_PROBE_TIMEOUT_MS = 5000`，AbortController 超时、single-flight 去重、baseUrl 跟随直连/同源代理切换）：`reachable = ok && json.ok`，结果返回时若仍处重连中则更新 `serverUnreachable` 并重播当前 reconnecting 状态（不可达时携带 `unreachable:true`）；`serverUnreachable` 为 true 时重连不再受 10 次上限约束（退避仍封顶 30s 持续自动重试，翻回 false 后若已超上限则下次失败照常进 failed），成功连上/`retryNow()`/`disconnect()` 均复位该标志。探测同时读取 `bootId` 维护基线：重连探测结果无条件更新基线；每次 `onopen`（含首次连接）再探测一次，若基线存在且 bootId 变化则补播 `{status:'connected', recovered:true, restarted:true}`（服务重启提示），首次连接仅记录基线；连上后到达的探测结果不影响 unreachable 语义
- **会话消息 IndexedDB 快照缓存（F12，只读加速层）**：`ServerAgent.restore()` 先读 `session-message-cache`，命中则用本地快照立即构造 Agent（不 POST /restore），后台经 `GET /state` 轻量校准——服务器 `stateVersion` 与缓存一致且 split `messagesSummary.count` 等于本地条数时跳过 `/messages` 补拉，不一致走既有 reconcile（尾部增量/全量重取，`versionBefore` 守卫不变）；restore/create 物化与 SSE 消息写事件（state/agent_end/message_end/turn_end/messages_replaced/tool_execution_*）经模块级 debounce（1.5s trailing）写回快照，写入前做 stateVersion 高水位守卫。服务器 SQLite 唯一权威，缓存任何失败（不可用/损坏/配额）均静默回源路径。

### shared-server-agent.ts (488 行)

**用途**: `SharedServerAgent` 类 — 共享会话的 Agent 客户端。

**功能**:
- 从共享状态恢复会话
- 只读/可操作模式
- 消息发送
- 回滚支持
- SSE 事件订阅
- 结构化选择在共享会话为 no-op：`setNextPromptCapabilities()` / `setNextPromptContextReferences()` 为空实现（对应服务端对非空 `contextReferences` 的 `CONTEXT_REFERENCES_UNSUPPORTED_SHARED` 显式拒绝）；`setPromptMode('plan' | 'ask' | null)` 与 `setPlanMode` 兼容包装同 `ServerAgent`

### deferred-session-agent.ts (302 行)

**用途**: `DeferredSessionAgent` 类 — 新会话首条消息发出前的本地延迟代理，让用户无需等待服务端会话创建即可开始输入。

**功能**:
- 本地维护乐观 state（消息、streaming 标志等），`prompt()` 时才 promote 创建真实 `ServerAgent` 并转发首条消息；已有真实 Agent 后全部调用直通
- 暂存并在 promote 时转发下一次 prompt 的结构化选择：`setNextPromptCapabilities()` 使用与 `ServerAgent` 相同的统一规范化，首条乐观 user message 同步写入无 description 的 `details.selectedCapabilities`，再把可含 description 的 canonical 选择转发真实 Agent；`setNextPromptContextReferences()`（≤8，引用同时写入同一乐观 user message 的 `details.contextReferences`）、`setPromptMode('plan' | 'ask' | null)`（`setPlanMode` 兼容包装）。三类状态均一次性消费，插件最多 4 项且保持顺序
- 真实 Agent 不支持的可选方法（如 `setNextPromptContextReferences`）以 `?.` 安全调用，消费回调（onConsumed）随转发传递

## 工具模块

### model-visibility.ts / model-identity.ts / model-display-label.ts

**用途**: 收口模型选择与展示规则。

- `isModelSelectable()` / `filterSelectableModels()` 仅排除明确设置 `quickforgeHidden: true` 的模型，并保持 `Model<Api>[]` 泛型返回值；缺少字段的旧配置继续可见。
- `modelIdentityKey()` / `sameModelIdentity()` 使用 Provider、Model ID、API 和规范化 Base URL 区分模型；`modelMatchesReference()` 兼容旧 Agent 引用缺少可选字段。
- `includeCurrentModel()` 只为编辑或恢复入口重新加入当前已绑定的隐藏模型，不把它变成其他新选择候选。
- `modelDisplayLabel()` 统一输出 `Provider / Model ID`，不使用 Provider 内部模型名称、API 或 Base URL 作为选择标签。
- `custom-model-selector.ts` 是展示层，调用方必须传入已过滤的新选择目录；主聊天、默认模型、Agent Profile、定时任务和共享会话均按上述规则准备列表。主聊天额外传入语义独立的可选无参设置回调，因此桌面浮层和移动抽屉底部显示低强调“自定义模型”；点击顺序固定为先关闭选择器、再打开 `customModels` 设置页。共享对话与 Agent 表单等复用入口不传该回调，因而不显示设置入口，且不复用旧的模型编辑参数。

### local-tools.ts

**用途**: 在 `pi-web-ui` 中注册本地工具渲染器；`run_command` 运行中会显示图标按钮，通过 `/api/agents/:sessionId/abort-tool` 手动结束当前命令；`run_subagent` 在聊天中只展示名称、状态和耗时摘要，运行期间在状态标签与 spinner/耗时之间渲染 `quickforge-tool-marquee` 自定义元素（attribute 驱动，仿 `quickforge-elapsed-time` 模式），以跑马灯滚动显示子代理当前正在执行的工具（`工具名 · 参数摘要`，多个 pending 用 ` · ` 连接，见 `currentSubagentToolSummariesWithMemory`：工具间隙——上一个工具已结束、下一个尚未开始时 pending 为空，回放该 run 最近一次非空摘要，避免工作过程显示闪空，直至下一个工具摘要出现或运行结束；工具摘要切换时双视图纵向滚动——旧摘要向上滚出、新摘要自下滚入 260ms，横向滚动与纵向滚动两轴独立互不打断；溢出自动循环滚动、不溢出静态、reduced-motion 降级为省略号，动画逻辑在 `tool-marquee.ts`），跑马灯只占用剩余弹性空间不遮挡标签与状态；点击整个摘要通过 `window` CustomEvent（`OPEN_SUBAGENT_RUN_EVENT`，事件名 `quickforge:open-subagent-run`）在 `WorkspaceInspector` 中打开或激活该次运行的独立 Tab，不再内联展开完整过程；renderer 会把 toolResult 顶层 `toolCallId` 显式传给 `buildSubagentRunPayload()`，确保临时/最终消息都使用父工具调用 canonical ID；缺少 canonical ID 的 `called/running` 摘要禁用、不打开且不进入全局 store，已完成历史消息仍可用 `sessionId/name:task` fallback 直接打开，但不会发布到 store；运行详情由 `renderSubagentRunBody` 渲染并通过 Lit 宿主元素 `subagent-run-detail-body` 嵌入工作区 Tab，遵循工具显示配置（`concise / compact` 简洁显示，`detailed` 额外展示工具统计、允许工具和 input/details）；详情顶部任务说明块（task/context/expectedOutput）复用用户消息气泡视觉（同边框/圆角/阴影/文字规格，见 `input-clamp.ts`），三个值节点分别保留任务文本中的原始换行（不对外层 Lit 模板启用 pre-wrap，避免模板缩进形成额外空白），长内容做定高收起——超出约 6 行裁掉不滚动、底部渐隐 + 居中「展开/收起」按钮，并用仅 overflowing 内容显示的 30px 流内安全区避免按钮覆盖正文，宿主每次渲染后经 `syncInputClampBoxes` 幂等度量，状态走 data 属性可跨实时更新存活；宿主每次渲染后调度 `decorateSubagentProcessBlocks`（`panel-decoration/message-actions.ts`），对内部过程 message-list 应用与聊天一致的 process folding / 过程分组装饰与交互（幂等、不重复叠加、卸载随 DOM 回收）；`run_subagent` renderer 仅回填 canonical 安全快照：首次可发布，或以恢复出的 done/error 修正 store 中已有 called/running，其他已有快照仍以 `ServerAgent` 的 `tool_execution_*` SSE 为权威；canonical 摘要点击时可取 store 最新同 ID 载荷，非 canonical 历史摘要始终使用当前 renderer 载荷；聊天摘要按钮具备 hover / focus-visible 反馈与 `aria-label`/`title` 可访问语义；`generate_image` 的 renderer 仅为历史会话兼容，以独立结果块展示既有会话图片资产，并根据普通页或 `/share/:shareId` 自动构造同源资源 URL；`write_file`/`edit_file` 的 diff 正文（`details.diff.text`，`OpenCodeToolRenderer` 复用同一渲染）为结构化视图：`diff-view.ts` 解析 unified 文本后按行渲染 old/new 双行号列（删行只占 old 号、加行只占 new 号），剥离 +/- 前缀，`---`/`+++` 文件头上提为标题行路径并带新文件标记，hunk 间隙显示「省略 N 行」分隔（i18n），配对的删/加行做 token 级对比、真正变化的字符段加重底色（`<mark>`）；增/删文字色在 `html.dark` 下覆盖为亮绿/亮红（含徽章与里程计），修复暗色对比度；`ask_user` 由 `AskUserToolRenderer` 渲染（summary「N 问 · 首问」，问号图标；pending/旧消息非 detailed 展开时列出问题清单），已回答/跳过的历史消息展开复用回执确认步样式——`askUserReviewRowsFromDetails(details)` 从持久化 toolResult.details 提取规范化 questions/answers/skipped/skipReason，按 `.quickforge-ask-review` 只读行渲染（复用 `buildAskAnswerText` 合并答案、未答显示占位、无「修改」按钮，跳过态行区顶部带跳过原因行，reason→i18n 四映射 timeout/aborted/no-questions/用户跳过），非 detailed 模式省略 output 文本块；`detailed` 模式一律维持 input JSON + output 原文视图。

`todo_write` 使用专用 `TodoWriteToolRenderer`；OpenCode 的 `opencode_tool` 仅在 ACP metadata 规范化后为 `todowrite` 时委托给同一 renderer，并使用 OpenCode 参数快照语义。历史摘要只陈述历史事件：运行中（running）、失败/中止/超时（error）、成功更新任务清单（success，显示完成数）、成功清空任务清单（clear），以及只有调用、成功结果缺少有效快照或旧数据形状不完整（neutral，不宣称已更新）。它不声称与当前 Composer Dock 摘要同步，因为当前 UI 由当前消息分支独立恢复。成功历史在非 `detailed` 模式默认只显示事件摘要，不重复渲染完整 Todo 列表；`detailed` 才显示 input/details JSON。

**支持的工具渲染**: `run_subagent`, `read_file`, `grep_files`, `write_file`, `edit_file`, `run_command`, `present_files`, `activate_skill`, `read_skill_resource`, `ask_user`, `todo_write`；`opencode_tool` 对 `todowrite` 提供专用历史 renderer 分支；另保留 `generate_image` renderer，仅用于历史会话兼容。

### todo-write-history.ts

**用途**: 为 TodoWrite 历史工具消息构建不依赖 DOM/Lit/i18n 的视图模型，供 QuickForge 原生 `todo_write` 与 OpenCode `todowrite` 共用。

- 状态先按工具生命周期判定：`isStreaming` 为 running；`isError`、`details.aborted` 或 `details.timedOut` 为 error；存在终态 result 为 success 候选；只有调用无结果为 neutral。
- QuickForge 仅信任成功 `toolResult.details.todos` 作为已应用快照；OpenCode 成功终态从 tool call 参数的顶层 `todos` 或 `rawInput.todos` 提取，顶层优先。两侧都复用严格三态、最多 20 项、非空内容的规范化边界。
- 有效非空快照生成 success“更新任务清单”历史事件，有效空数组生成 clear“清空任务清单”历史事件；无效/缺失快照生成 neutral 摘要。renderer 不根据历史事件宣称当前 Composer Dock 摘要已同步或移除。

### subagent-run-detail.ts

**用途**: subagent 单次运行详情的纯逻辑（不依赖 DOM/Lit/React/i18n 运行时，`t` 由调用方注入）。`buildSubagentRunPayload()` 把 run_subagent 的 params/result.details 规范化为 Workspace Inspector 运行 Tab 使用的统一载荷（稳定 run id 以 `toolCallId`（显式参数、toolResult 顶层字段或 `details.toolCallId`）为主键，`details.sessionId` 仅作历史兼容 fallback，两者都没有时回退 `${name}:${task}`；同时携带 `canonicalToolCallId`，并生成状态/状态文案/耗时/工具调用数/允许工具/过滤后的过程消息/input/details JSON/内容指纹）。`canPublishSubagentRunPayload()` 仅允许 canonical 载荷进入全局 store；`canOpenSubagentRunPayload()` 允许 canonical 任意状态以及无 canonical 的 done/error 历史载荷打开；`shouldPublishSubagentRunPayload()` 允许 renderer 首次发布 canonical 快照，或用恢复出的 done/error 修正已有 called/running，其他已有快照保持 SSE 权威；`resolveSubagentRunPayloadForOpen()` 仅为 canonical 点击选取 store 最新同 ID 快照，历史 fallback 始终返回当前 renderer 载荷。`subagentRunFingerprint()` 用于实时更新去重且包含 `canonicalToolCallId`，`normalizeOpenSubagentRunRequest()` 校验打开事件 detail；`currentSubagentToolSummaries()` 是聊天摘要卡「当前工具」跑马灯的数据源：`pendingToolCalls`（toolCall id）× `traceMessages`（assistant content 的 toolCall chunk）求交集，按 trace 顺序返回 `工具名 · 参数摘要`（`summarizeParams` 生成、`SUBAGENT_TOOL_SUMMARY_MAX_LENGTH`=80 截断、arguments 经 `normalizeToolArguments` 归一化），无 pending 或 chunk 缺失时为空列表；`currentSubagentToolSummariesWithMemory()` 是渲染层实际使用的带记忆版本：非 running 一律空列表，fresh 非空时经 `SubagentToolSummaryMemory`（按 runId 的有界 `Map`，`MAX_SUBAGENT_TOOL_SUMMARY_RUNS`=100，插入序 FIFO 淘汰、已存在 key 更新不改变淘汰顺序、remember 忽略空 runId/空列表、支持 clear）记住并返回，running 且 fresh 为空（工具间隙、pending 未流出的瞬时）回放该 run 最近一次非空摘要，保持跑马灯连续直到下一个工具出现或运行结束；`subagentRunBodyBlocks()` 是运行详情内部块顺序（task/context/expectedOutput → 详细摘要 → trace → 无 trace 时 output → input/details）的单一事实来源，与 Git 历史最终态一致；`SubagentRunStore` 是有界（`MAX_SUBAGENT_RUN_SNAPSHOTS`=100）的内存快照 store，支持 publish（指纹去重、订阅者异常隔离）/get/subscribe/clear（clear 仅清快照、保留订阅），全局单例 `subagentRunStore` 供 ServerAgent 实时发布与 Workspace Inspector 订阅；`subagentRunPayloadFromToolEvent()` 是 tool_execution_start/update/end 事件到载荷的纯转换（isStreaming 区分运行/终态、args 缓存回填、previousTiming 回填、isError 归 error）；`SubagentRunEventPublisher` 是 ServerAgent 持有的 SSE 事件发布器，按 toolCallId 缓存 run_subagent 的 args/toolName（start 缓存、end 清理），用规范化 start 事件（带 partialResult）发布，update/end 缺 args/toolName 时回填缓存，previousTiming 取 store 中同 runId 上一次载荷；Workspace Inspector Tab 严格按相同 `runId` 更新/upsert，不执行 fallback 迁移。

### generated-image-assets.ts

**用途**: 校验 `generated_image_result` 工具元数据，只接受受控图片 MIME 和服务端 UUID 资产 ID；为普通会话与分享页构造同源图片资源 URL。

### tool-artifacts.ts

**用途**: 从当前 AI turn 的工具结果中提取产物文件；识别 `write_file`、`edit_file` 和 `present_files`，并将 HTML/图片分流到 Browser，将 Markdown、代码、配置及普通文本分流到 Reader，将 PDF/DOCX/XLS/XLSX 分流到 Document；显式 `preview: false` 的文件仅保留在产物列表（仍可手动预览）。

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
- Electron Desktop 通过 `contextIsolation + sandbox` preload 的窄桥接调用主进程 `Notification`；IPC 仅接受主窗口 main frame 的受限 payload，通知点击恢复、显示并聚焦窗口后复用会话打开事件。
- Capacitor Android 使用 `@capacitor/local-notifications`；设置页手动授权逻辑保持独立。
- Android 普通远程浏览器仅在 HTTPS 安全上下文中，于首次有效发送（含仅附件）同步标记并自动申请一次权限；需要 `Notification` 和 Service Worker API 可用。
- 通知偏好默认开启，用户显式关闭/开启分别持久化为 `0` / `1`；浏览器启动时不会自动申请权限，无权限时发送自然返回失败。任务终态在前台也会显示系统通知，仅“运行中”通知在页面可见且有焦点时被抑制，并通过任务 key 做短时跨标签去重。
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
| `about-settings-tab.ts` | 关于信息、更新检查/执行（经 `update-check-poll.ts` 轮询，手动检查 force 跳过服务端缓存），以及后端服务重启 |
| `project-commands-settings-tab.ts` | 项目命令目录配置 + 命令预览 + 新建命令 |
| `archived-conversations-settings-tab.ts` | 已归档对话的恢复和永久删除 |
| `react-settings-tabs.tsx` | 将 Agent、Skills、MCP、插件、定时任务和分享链接管理等 React 页面适配为设置 Tab |
| `share-client.ts` | 分享链接创建、列表、编辑（权限/密码/有效期）、停用、恢复、永久删除及状态推导 API |
| `channels-settings-tab.ts` | 渠道设置选项卡：展示名称、状态、简述、工作区与启动/停止/登录操作，仅在存在二维码内容时展示扫码入口，同时保留错误提示，并通过“打开日志文件夹”访问后端持久化渠道日志 |
| `patch-thinking-selector.ts` | 修补 pi-web-ui 的模型选择器 |
| `custom-model-selector.ts` | 自定义模型选择器；主聊天通过可选无参设置回调显示桌面/移动底部入口，复用场景未传回调时保持隐藏 |

### message-utils.ts (95 行)

**用途**: 消息处理工具函数。

**功能**:
- `assistantText()` — 提取助手消息文本
- `rollbackStartIndexFromMessage()` — 计算回滚起点
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 剪贴板复制
- `generateTitle()` / `titleNeedsGeneration()` — 标题生成
