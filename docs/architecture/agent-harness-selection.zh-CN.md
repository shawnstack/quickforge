# Agent Harness 选择

QuickForge 会话现在可固定使用以下 Harness 标识：

- `quickforge`：现有 QuickForge Agent runtime。
- `opencode`：通过 OpenCode 的 ACP v1 stdio runtime 执行。
- `claude-code`：仅保留类型与设置展示，首期未接入，不能由 API 选择。

## 选择与兼容规则

“设置 → 常规 → 默认 Harness”用于新对话。设置保存后，当前全局空白对话（尚未发送消息、仍是 `DeferredSessionAgent`）会立即按新 Harness 重建，以同步更新界面能力；如果 Harness 相同则继续复用。已有消息的对话、已创建的真实服务端会话和项目空白对话均不切换。真实服务端会话创建后将 `harness` 固定在会话数据中。

旧设置、旧会话或未知持久化值统一降级为 `quickforge`。显式创建 API 对未知值或 `claude-code` 返回 `400`，避免虚假可用。

会话数据与 metadata 保存：

- `harness`：QuickForge 会话选择。
- `harnessSessionId`：OpenCode 返回的 ACP session ID。

恢复 OpenCode 会话时必须使用 `session/load`，失败时再尝试 `session/resume`；不会创建新 ACP 会话替代旧历史。Web UI 仍保存规范化的 user、assistant 与 tool result 消息，用于会话列表和聊天展示。

## OpenCode ACP runtime

服务端从 `PATH` 跨平台解析 `opencode` / `opencode.cmd`，然后启动：

```text
opencode acp --pure --cwd <workspace>
```

Windows npm `.cmd` 包装器通过固定的 `cmd.exe /d /s /c` 启动；用户 prompt 始终通过 ACP stdin NDJSON 发送，不进入 shell 命令字符串。

OpenCode 使用自身登录、模型和原生工具。QuickForge 不读取或转发 OpenCode 凭证，不向该 runtime 注入 Tools、MCP、Skills、Memory 或系统提示词，也不启用自动批准。ACP `session/request_permission` 转成现有 `tool_approval_required` SSE 事件，并复用 approve/reject API。

ACP session update 映射为现有事件：

- assistant 文本 → `message_start` / `message_update` / `message_end`
- tool call/update → `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- permission → `tool_approval_required`
- prompt completion/error → `agent_end` / `error`

中止使用 ACP `session/cancel`；销毁或 idle cleanup 会调用 `session/close`，关闭 transport 并终止子进程。

- ACP assistant 输出按 `messageId` 分段；`messageId` 变化、工具调用、prompt 结束、错误、中止和进程退出都会先 flush 当前 assistant。文本与 thought 以 `text` / `thinking` content block 按收包顺序保存，只有连续同类型块会合并。
- 工具调用持久化顺序固定为 assistant 前置文本 → assistant `toolCall` message → `toolResult` → assistant 后续文本；未知 `tool_call_update` 不会产生孤立 tool result，多工具与失败状态分别保存。
- prompt 完成保留 ACP 原始 `stopReason`；运行期进程/transport 故障只收口一次，流式 partial 会先 flush，再发一次 error 与 agent_end。中止后清空 streaming/pending tool 状态，避免污染下一轮。

## OpenCode P0 能力边界

前端通过统一 Harness capability 表解析能力，并与分享页的 `readOnly` / `disableFork` 策略叠加。OpenCode 保留文本与附件输入、停止、复制、工具展示和 ACP 工具审批；图片、文件 paste/drop 与附件-only 均可进入同一发送链路，但分享只读页仍关闭附件入口。以下 QuickForge 专属能力继续隐藏并禁用：

- 模型/Thinking 选择和 QuickForge 客户端 API Key 检查
- Plan mode、Access mode
- QuickForge built-in/custom command 与 plugin/capability suggestions
- context usage（QuickForge 估算）、compaction UI
- rollback、retry、按消息 fork（整会话 fork 已开放，见下文 P1 派生）

OpenCode 附件在服务端转换为标准 ACP `ContentBlock`：caption 使用 `text`；图片使用 `image { data, mimeType }`；普通文件使用内嵌 `resource`，带安全的 `quickforge-attachment://` URI，有 `extractedText` 时发送 `text`，否则发送附件 base64 `blob`。adapter 严格读取 initialize 返回的 `agentCapabilities.promptCapabilities`：图片要求 `image === true`，普通文件要求 `embeddedContext === true`；能力缺失或附件字段非法会在持久化用户消息和发出 `agent_start` 前返回明确 `400`，不会静默丢弃附件，也不会暴露本地文件路径。

OpenCode 工具展示只按 ACP 标准 `kind` 归一：`read/edit/search/execute` 分别映射到 `read_file/edit_file/grep_files/run_command`；title 不参与工具名猜测，其他 kind 固定为 `opencode_tool`。参数保留原字段并补齐常见别名，title/kind/locations 以内部白名单 metadata 标识 ACP 来源，renderer 展示为 `OpenCode · ACP title/kind` 且不会把内部字段显示在输入/详情中。tool content 的 text/resource、diff、terminal 与 rawOutput 会转成有界、安全的展示/持久化内容；`_meta` 被剥离，失败状态与历史顺序保持不变。加载旧 OpenCode 历史时还会在内存中归一旧工具名与配对结果，使既有会话自愈展示；该步骤不会主动改写持久化文件。

QuickForge Harness 的 capability 默认全开，`SharedConversationPage` 等未传 capability 的调用方保持原行为。

## OpenCode P1 动态配置基础层

服务端按标准 ACP session 动态配置协议接收 `session/new`、`session/load`、`session/resume`（以及整会话 `session/fork`）响应中的 `configOptions` / `modes`，并在内存态 `agent.state.acpSession` 中维护严格白名单快照：`configOptions`、`modes`、`availableCommands`、`sessionInfo`、`usage`。快照会剥离 `_meta` 和未知 metadata，不包含凭证，不写入会话持久化；恢复时以 OpenCode `session/load` / `session/resume` 返回值重新刷新，OpenCode 是权威来源。

Setup 阶段只临时缓冲 ACP 标准的 `available_commands_update`、`current_mode_update`、`config_option_update`、`session_info_update`、`usage_update`，且有数量上限；不会缓冲或回放 user/assistant/tool/plan 历史，避免与 QuickForge 已有消息重复。运行期继续更新上述五类快照；`session_info_update.title` 仅保存在 `sessionInfo`，不会改写 QuickForge 标题，`usage_update` 也不会映射为 QuickForge `contextUsage` 或消息 usage。

服务端提供 `POST /api/agents/:sessionId/harness/config-option` 与 `POST /api/agents/:sessionId/harness/mode` 作为客户端集成基础，仅接受 OpenCode 当前已广告的配置、模式和值，生成期间禁止切换。OpenCode 1.18.16 的 mode 通常通过 `configOptions`（`category: mode`）广告，而不一定使用独立 `modes`；两种标准 ACP 表达均被保留。

## OpenCode P1 前端集成

- **动态配置/Mode UI**：OpenCode 会话在 composer 现有行内控制区提供“配置”菜单（复用 agent-access menu 的浮层模式）。展示 ACP `modes` 单选与 `configOptions`：boolean 切换、select 单选（支持分组数据，UI 按组简单分区）；mode 为 `null` 时仍完整展示 configOptions，不通过名称猜测 mode。生成期间与只读页禁用。修改走上述两个 API，成功后以响应中的 `acpSession` 刷新本地快照，并通过 `state` SSE 事件同步其他客户端。
- **Usage / Cost 持久化与展示**：`acpSession.usage`（`{used,size,cost:{amount,currency}|null}|null`）是唯一持久化的 OpenCode 动态快照（字段 `openCodeUsage`），动态 config/mode 不作为本地权威持久化；恢复 OpenCode 会话时回填该快照，旧会话兼容。运行期 `usage_update` 会发 `acp_session_usage_update` 轻量事件，触发会话 debounce 持久化并即时刷新前端。composer 用量区域显示独立的 OpenCode usage badge（used/size、cost/currency 可用时展示，缺数据不显示），与 QuickForge `contextUsage` 估算严格分离。
- **整会话 Fork**：当前会话操作菜单提供“复制当前会话”。仅在非只读、非 streaming、有 `harnessSessionId` 的 OpenCode 会话启用；复用 `createAgent` 链路，传完整 messages 与当前 title/scope/project/harness/accessMode，并将 `sourceHarnessSessionId` 设为当前 ACP session 以触发 `session/fork`。新会话立即持久化并经既有 `session_forked` 事件切到前台，刷新后可恢复。按消息 fork 对 OpenCode 仍禁用；fork capability 不支持时沿用既有明确错误处理。

这里的方向是 **QuickForge 作为 ACP Client 驱动 OpenCode Agent**，与 `server/acp/server.mjs` 中 **QuickForge 自身作为 ACP Agent 暴露给 IDE/渠道** 的方向相反，二者状态与配置入口不得混用。

## 超时、认证与崩溃诊断

OpenCode ACP 请求均有 deadline：initialize 15 秒、session new/load/resume/fork 30 秒、prompt 1 小时、close 2 秒；测试可注入 timeout/timer/进程依赖。deadline 同时与 child error/exit 和 `connection.closed` 竞争，超时统一返回 `504 / OPENCODE_ACP_TIMEOUT` 并携带 stage。

initialize 会保存并校验 `protocolVersion`、`agentInfo`、`agentCapabilities`、`authMethods`。load/resume/fork/close 只在对应 capability 声明后调用；协议或能力不兼容返回 `503 / OPENCODE_ACP_INCOMPATIBLE`。ACP 标准 auth required（优先 code `-32000`）映射为 `401 / OPENCODE_AUTH_REQUIRED`，提示用户在终端完成 OpenCode 登录。

stderr 和公开错误只保留截断后的脱敏文本：Bearer、token/secret/password/API key/private key、URL 与本机绝对路径会被替换，不公开 ACP `error.data` 或 `_meta`。

## 跨平台子进程树

OpenCode 在 POSIX 以独立 process group 启动；销毁时无论 session/close 是否超时，都会 finally 关闭 ACP transport，并通过共享 `server/utils/process-tree.mjs` 两阶段结束进程树：POSIX 先向 process group 发 `SIGTERM`、超时后 `SIGKILL`；Windows 使用 `taskkill /PID <pid> /T`，强杀追加 `/F`。

## 派生与边界

- OpenCode ACP 只支持整会话 `session/fork`，不支持指定消息位置。Web UI 仍禁用 OpenCode 的按消息 fork、rollback 与 retry，action/API 层也会返回明确提示；当前会话操作菜单已提供“复制当前会话”整会话 fork 入口，通过 `sourceHarnessSessionId` 触发 ACP fork 并立即持久化新会话。
- QuickForge `/summary` 派生继续继承 Harness；首期 OpenCode 不接入 QuickForge 命令解析，因此不会在 OpenCode runtime 中执行该派生。
- QuickForge 对外 ACP Agent 入口和定时任务没有传入 Harness，继续默认 `quickforge`。
- OpenCode 模型、思考等级由 OpenCode 原生管理，因此 Web 对话中的 QuickForge 模型控件与 Provider API Key 检查禁用。OpenCode 新会话无需配置 QuickForge 模型；前端仅使用不会发送给 OpenCode 的本地占位 state 满足 UI 类型约束。
