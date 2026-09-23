## Goal 当前契约：自动执行与无限累计时间

规划整轮只读，正常轮末及持久化成功后自动执行，不需要计划确认。新 Goal 的 maxActiveDurationMs 为 JSON null（无限），累计用时仍记录，默认轮次20（设置·常规可配置），保留防空转/重复失败、工具审批、必要提问、暂停取消及单工具超时。旧快照不自动执行或改写终态；显式 resume/extend_resume/revise 移除旧时间上限，extend_resume 保留 CAS 且只给耗尽轮次追加配置轮次（默认 20）。有计划恢复 running，无计划重新 planning。complete 保留可信证据与正常轮末持久化屏障；needs_review 报告改为 blocked 并说明无法验证原因，不伪造 passed。历史 human evidence 与 accept API 兼容。当前聊天 controller 不再生成确认按钮，Inspector/card 不提供验收动作；历史 renderer 保留当时事实。

# `src/lib/` — 前端工具库

包含前端工具模块，涵盖存储、聊天逻辑、本地工具、国际化、设置选项卡等。

## Goal 分隔线元数据实时同步

- `server-agent.ts` 对 split SSE state / GET state 的 `goalIterationMarkers` 做窄合并：只接收原索引存在且 role、可用 id/timestamp 匹配的条目，至少须有 id 或 timestamp 可验证；不追加消息、不移动锚点、不替换正文或无关 details。未知 kind 拒绝，legacy 无 kind 保留 execution 兼容。
- 最新 marker snapshot 留存，在后到的 message/agent end、增量或全量消息对账合并后重放；重放不覆盖已存在的更新 marker（按 finishedAt 守卫）。snapshot 后到也立即合并已有消息，避免相同 message count 导致分隔线直到刷新才出现。full state 同样可独立合并 metadata，但不放宽 streaming 期间正文替换门禁。
- 仅 marker 实际变化才替换必要消息条目、推进消息 watermark，并发出专用本地 `message_metadata_updated`。不是伪造 `messages_replaced`：`ChatPanelHost` 仅刷新窗口消息和装饰，不清 streaming process groups、不触发 composer draft 恢复。`goal_updated` 仍只走独立 Goal 水位、不推进消息 watermark。
- `i18n.ts` 提供规划/执行阶段文案；规划 iteration 可为 0，但不展示执行轮数。「计划已就绪」只消费服务端正常提交 plan 轮末与成功保存后的 marker，complete 工具成功也不冒充 completed。服务端 staged pair / CAS / 取消优先屏障见 [服务端契约](../../server/README.md#goal-自动完成与迭代记录)。
- 相关验证：`tests/frontend/server-agent.test.ts`、`goal-iteration-divider.test.ts`、`message-actions.test.ts`；自动测试不等同真实浏览器或现场模型验收。考虑 SVG 后复用现有细线/SVG 图标，无需额外流程图。

## Goal 报告工具呈现契约

- `local-tools.ts` 导入时注册 `goal_report`，不依赖 `/api/tools` 返回该会话专属工具。复用 local-tool shell、summary、状态图标与原生 details；固定默认收起（与其他工具卡一致，`initiallyOpen={false}`，不随任何设置变化，`toolDetailsOpenMemory` 手动开合记忆优先，detailed 模式只控制内容渲染），可折叠。卡体为普通工具行形态（无卡片框、无 tone 染色），展开内容区带轻量边框（复用 code-block 框配方 border-border/rounded-lg，无背景无阴影，仅点开后可见），类型图标为靶心 `GoalIcon`（内联 SVG），验收标准按 `criteriaDetails` 状态渲染通过/失败/待审/待定四种图标，范围改 mono chip，阻塞原因加固定 warning 色警示左框。
- `goal-report-history.ts` 只读取成功结果 `details.type: goal_report_result` 内的 `goal`，不把请求参数、旧英文正文或当前 Goal 当成已记录计划。plan 有摘要与有效准则才显示「计划已生成」；快照为 awaiting_confirmation 时明确显示「当时等待确认」，不声称当前仍需确认。`criteriaDetails` 把每项准则归一为 description + status（pending/passed/failed/needs_review），`criteria` 字符串数组保留兼容。
- running/error/缺失结果不展示成功快照；progress/blocked/needs_review/complete 等动作保留报告语义与摘要、阻塞原因，尤其 complete 工具成功不等于目标已完成。旧结果正文按纯文本回退，不解析成 Goal 状态，完整 JSON 仅详细模式显示。
- Renderer 只展示历史内容，不生成计划确认 mount 或按钮；`ChatPanelHost` 的 controller 接线保留为 inert 兼容接口，不派发任何操作，以避免本轮扩展到装饰生命周期重构。自动执行只由服务端正常规划轮末持久化屏障触发。
- 当前 UI 无计划确认或最终验收入口；历史 awaiting_confirmation 只表示当时事实，历史 human evidence/accept API 保留兼容。必要提问、工具审批、预算追加确认、暂停/取消与编辑仍可用。
- 这是客户端预检，不新增后端 CAS；HTTP 已发之后跨客户端替换目标仍是既有 confirm API 边界，不能撤回/保证原子性。缺身份、旧消息或无法证明最新计划时不展示动作，可经 Inspector 使用现有入口。所有不可信正文经 React 文本节点或 textContent 输出，不使用 HTML 注入；中英 key 成对维护。工具卡不再使用 tone 变量/染色（与其他工具行一致），准则四态图标配色保留。
- 验证见 `tests/frontend/goal-report-renderer.test.ts`（纯模型与真实 renderer class 的惰性模板捕获）；不是浏览器 CSS/焦点/屏幕阅读器验收。目标图标与准则状态图标均为内联细线 SVG，无新增外部资源。

## Goal 错误文案本地化消费契约

- `server-agent.ts` 的 `updateGoal` 对非 2xx 响应解析 body 的 `code` 字段并挂到抛出 Error 的 `.code`（message 仍取 `payload.error`，缺失时兜底 `Failed to update goal: HTTP <status>`，行为不变）；不识别的 code 原样保留，由展示层决定映射。
- `goal-ui.ts` 新增 `GOAL_ACTION_ERROR_KEY`（11 个静态码：`GOAL_ACTIVE` / `GOAL_SESSION_BUSY` / `GOAL_BUDGET_EXHAUSTED` / `GOAL_REVISION_CONFLICT` / `GOAL_BUDGET_NOT_EXHAUSTED` / `GOAL_OBJECTIVE_REQUIRED` / `GOAL_ACTION_INVALID` / `GOAL_NOT_FOUND` / `GOAL_UNAVAILABLE` / `SESSION_NOT_FOUND` / `SESSION_PERSIST_FAILED`，i18n `goalError*` 中英成对）与 `goalActionErrorMessage(error)`：已知码显示本地化文案，未知/无码回退 Error 的英文 message，再兜底通用 `goalActionFailed`；`runGoalUiAction` 失败统一走该函数，动作面不各自翻译。
- `goal-report-history.ts` 按 `details.type === 'goal_report_error'` 的 `details.code` 映射 15 个 `goalReportError*` key 显示本地化正文；无 code / 未知码（含历史旧数据与 `aborted` / `timedOut`）透传服务端原文，不猜语义。服务端错误契约见 [Goal 错误码与文案本地化](../../server/README.md#goal-错误码与文案本地化现行契约)。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `i18n.ts` | 3342 | 国际化（中/英）翻译和语言管理；`applyAppLanguageFromSnapshot` 供启动快照预应用（不写库不 reload）；surface 文案统一走 `appTranslations.en/zh`，新增/修改 surface 文案必须同时补中英键 |
| `error-messages.ts` | 42 | 已知上游代码异常文案的展示层国际化：`translateErrorMessage(message)` 以「精确/参数正则 → i18n key」规则表映射 pi-ai（Request was aborted、流异常结束）、ai-http-logger（AI stream idle/total timeout）、undici fetch failed 与 server-agent prompt HTTP 兜底等已知英文异常串；数据层保持原文（持久化、appendAssistantErrorMessageOnce 去重、subagent trace 去重都依赖原始文本），仅在展示层（message-actions 错误红块装饰、local-tools subagent 错误原因卡）调用；未匹配的动态正文原样显示 |
| `pi-chat.ts` | 365 | Pi Chat 初始化和模型管理 |
| `goal.ts` | 310 | Goal 模式前后端共享契约：状态/准则/证据/预算类型、防御归一化（容忍旧服务端缺字段、坏项丢弃）、状态语义纯函数（终态/活跃/旋转、可编辑/可确认/可暂停/可恢复/可接受、`goalAcceptanceCheck` 与时长整分钟展示） |
| `goal-ui.ts` | — | Goal UI 共享 store：按 `sessionId + goalId` 管理 pending / dirty / error 与草稿；运行中可保留草稿，外部 objective 冲突保留 dirty 文本；dirty 允许 `revise` / `pause` / `cancel`，其余动作受守卫；挂载钉键/释放与 LRU 保留草稿，导航事件携带 progress/edit 打开侧栏 |
| `goal-edit.ts` | — | 目标安全保存编排：确认 pause、限时等待权威 paused 且非 streaming，再 revise；校验 session/goal/基线，支持取消只读等待，不重试 POST、客户端不另发 confirm/resume；服务端 revise 的新规划正常持久化后自动执行 |
| `server-agent.ts` | 2271 | Server Agent — 会话状态、消息对账、watchdog、事件边界与公共兼容入口 |
| `server-agent-types.ts` | 266 | 共享类型与事件边界：ServerAgentLocalEvent、只读 type?: unknown 的 ServerAgentWireEvent；无运行时依赖 |
| `server-agent-http.ts` | 16 | `fetchJsonWithTimeout`：请求超时、外部取消转发、JSON 解析与资源清理 |
| `global-agent-sse-client.ts` | 340 | 全局 SSE 单例、按会话分发、连接状态订阅、重连退避与健康探测 |
| `selected-capabilities.ts` | 82 | 用户本轮插件选择的前端统一规范化/快照：合法类型与字符串边界、`type+pluginName+name` 去重、顺序保持、最多 4 项，持久化/历史读取快照均剥离 description |
| `hooks-settings.ts` | 185 | Hooks 设置前端镜像：`HOOKS_SETTINGS_KEY`（`hooks-settings`）、事件枚举（6 种）/变量表、`HookConfig` / `HooksSettings` / `HookExecutionRecord` 类型（record 的 `event` 兼容手动测试合成事件 `'test'`，status 枚举 `success`/`error`/`timeout`）、timeout clamp 1–300s（默认 10s）、`normalizeHooksSettings` 防御规范化（非法动作 Hook 整体丢弃）、`load/saveHooksSettings` 经 AppStorage settings store 读写（PUT 后由 server 触发引擎缓存刷新）；服务端契约见 [server/hooks/](../../server/README.md#hooks--hooks-事件钩子) |
| `deferred-session-agent.ts` | 302 | 新会话首条消息前的延迟 Agent 代理：本地先渲染乐观消息，`prompt()` 时才创建真实 `ServerAgent`，并把暂存的 capabilities / contextReferences / promptMode 转发给真实 Agent |
| `indexeddb-cache.ts` | 通用 IndexedDB 只读缓存封装：惰性单例 open、条目级 schemaVersion、LRU+字节双预算淘汰、全部异常静默降级（供会话消息/工作区/设置快照等缓存层复用） |
| `session-message-cache.ts` | 会话消息只读快照 store（F12）：`resolveServerCacheKey`（baseUrl→直连后端→origin）、结构校验读取、per-key debounce 写入 + stateVersion 高水位守卫、IndexedDB 不可用全程 no-op |
| `workspace-cache.ts` | Workspace 只读缓存 store（F13）：目录条目（SWR+30s TTL 新鲜判定）、展开路径、文件内容（size+mtimeMs 失效戳、>1MB 跳写）；复用 `IndexedDbCache` 与 `resolveServerCacheKey`，坏条目删除、不可用全程 no-op |
| `app-settings-cache.ts` | 启动 Settings 快照 store（F14）：追踪键白名单（language/外观/字号/工具展示）、结构校验读取（坏条目删除）、>4KB 跳写；`HttpStorageBackend.set` 经 `updateAppSettingSnapshotFromStorageSet` 写通，IndexedDB 不可用全程 no-op |
| `provider-keys-cache.ts` | Provider keys 前端内存缓存：provider→key 模块级 Map（null=已确认无 key）+ in-flight 并发去重；`HttpStorageBackend` 对 provider-keys store 读穿/写通（set/delete/clear 后广播），备份导入统一失效；跨标签经 BroadcastChannel('quickforge-sync') 'provider-keys-changed' 广播互失效（sourceTabId 自忽略），通道不可用静默降级 |
| `shared-server-agent.ts` | 488 | 共享会话 Agent 客户端 |
| `local-tools.ts` | 257 | QuickForge 工具渲染器注册入口（仅注册逻辑）：导入时注册全部 React 渲染器（见 `tool-renderers/`），`getLocalWorkspaceTools` 透传服务端工具元数据并幂等注册 MCP 渲染器；渲染实现全部在 `tool-renderers/`，subagent 运行详情由 React 组件 `components/workspace/SubagentRunDetailContent.tsx` 承担 |
| `tool-renderers/` | — | QuickForge 工具渲染器 React 实现集（按工具分文件，由原 local-tools 内联模板迁为 React）：`shared.tsx` 承载共用纯函数、attribute 驱动自定义元素（`quickforge-elapsed-time` / `quickforge-tool-marquee`）与 React 节点工厂（图标/状态/diff/按钮/code-block）；`local-workspace-tool-renderer.tsx`（本地工作区工具通用卡）、`subagent-tool-renderer.tsx`、`generate-image-tool-renderer.tsx`、`ask-user-tool-renderer.tsx`（含 `askUserReviewRowsFromDetails` 回执行提取）、`goal-report-tool-renderer.tsx`、`todo-write-tool-renderer.tsx`、`mcp-tool-renderer.tsx`（含 `parseMcpToolName`）；`index.ts` 统一导出。渲染器 `render()` 返回 `{ content: ReactNode, isCustom }`，class 链与 DOM 结构逐字复刻原模板 |
| `tool-renderer-registry.ts` | — | 纯本地工具渲染器 registry（self-hosted-chat-ui T2/T8）：模块级 `Map<string, ToolRenderer>`，`registerToolRenderer` 覆盖同名注册、`getToolRenderer` 立即返回、未知工具返回 `undefined`（无任何包级回退）；`ToolRenderResult.content` 为纯 `ReactNode`，无 DOM 宿主、无跨会话共享渲染器，chat / side chat / subagent trace 共用同一批实现 |
| `code-highlight.ts` | 1532 | 自研聊天代码块语法高亮（无新依赖，对齐轮补齐 highlight.js 移除后的迁移缺口）：每语言族一个单遍线性 sticky-regex tokenizer（O(n)、无嵌套量词，防回溯灾难），16 组既有语言（javascript/jsx、typescript/tsx、json、bash/sh、python、css/scss/less、html/xml/svg、sql、java、c、cpp、go、rust、yaml、markdown、diff）+ 对齐轮新增 9 组（toml、ini、dockerfile、makefile、powershell、graphql、protobuf、nginx、apache），共 25 组（别名见 `LANGUAGE_ALIASES`），token → `qf-hl-*` class（13 个 token：comment/string/keyword/number/function/builtin/property/punct/tag/attr/addition/deletion/plain；其中 `punct` 与 `plain` 无独立样式——旧调色板没有 `.hljs-punctuation` 规则，故不声明 `--qf-hl-punct` 变量、标点与 plain 段一并继承正文字色；`addition`/`deletion` 对应旧 `.hljs-addition`/`.hljs-deletion` 的前景+底色对，`--qf-hl-addition/deletion-bg|fg` 逐字等于旧 `--syntax-addition/deletion-*` 的亮/暗取值）；diff fence 严格按旧 highlight.js `Diff` 语法顺序 meta（hunk 头与 `***`/`---` 范围头，复用 `--qf-hl-number` 即旧 `.hljs-meta` 的 `--syntax-constant` 色）→ 注释（`Index: `/`index`/`===`/`---`/`*** `/`+++`/`diff --git` 整行、15 星分隔行）→ `+`/`!` 增行 → `-` 删行；超过 `MAX_HIGHLIGHT_LENGTH`（200KB）回退单一 plain 段；未注册的语言名改走保守通用回退 `tokenizeGeneric`（不再整块纯文本，纯文本仅限 `text`/`plaintext`/`txt`、空名与无判别 token 的输入；仍不做 hljs 式语言自动猜测）。已知局限为阅读级近似：JS/TS 模板串插值不再分词、正则字面量按前置显著 token 启发式（含 `/` 的字符类可提前截断）、JSX/Rust 嵌套注释与 bash heredoc/YAML block scalar 近似、流式中未闭合串/注释吞到行/块尾并随文本到达自愈。供 `chat/surface/CodeBlock.tsx` 消费；回归 `tests/frontend/code-highlight.test.ts` |
| `goal-report-history.ts` | — | Goal 工具历史只读投影：成功 `details.type === 'goal_report_result'` 的 goal 提取摘要/验收/范围；错误、运行中与缺失结果不冒充计划成功 |
| `todo-write-history.ts` | 90 | TodoWrite 历史工具消息视图模型：区分 running/error/success/clear/neutral，并从成功 `toolResult.details.todos` 提取已应用快照 |
| `share-client.ts` | 148 | 分享功能客户端 API |
| `slash-catalog.ts` | 102 | 斜杠菜单目录客户端：并行拉取 `/api/skills?available=true`（可带 projectId）与 `/api/agent-profiles`（可带 projectId），agents 过滤 `enabledAsSubagent === true`；任一失败/非 200/形状异常整体返回 null 静默降级；按 projectId 模块级缓存成功结果 |
| `composer-drafts.ts` | 241 | Composer 本地草稿：正文、结构化文件 `contextReferences` 与结构化能力 `selectedCapabilities` 按 session/project key 写入 localStorage；能力选择防御规范化、按 `type+pluginName+name` 去重且最多 4 个；正文为空但有 refs/capabilities 仍保留草稿，附件不持久化 |
| `message-queue.ts` | 172 | 流式期 Composer 消息队列：纯函数入队/删除/编辑/置顶/拖拽重排 moveQueuedMessage（20 条上限、单条 2000 字符）与 per-session localStorage 持久化（含 paused 标记、无 localStorage 安全降级）；插队经 `ServerAgent.steer`（乐观显示）；会话切换后的自动续发见 `message-queue-drainer.ts` |
| `message-queue-drainer.ts` | — | 基于 localStorage 的排队消息后台顺序发送器：per-session 防并发、顺序逐条发送、成功删条目、失败置 paused 停止、agent 流式中不抢发、永不抛错；导出 `drainStoredMessageQueue`（把指定会话的排队消息从 localStorage 逐条自动发送到该会话）与 `pauseStoredMessageQueue`（置 paused 停止该会话后台续发） |
| `startup-model.ts` | 主聊天启动模型的当前目录精确匹配与安全回退 |
| `http-storage-backend.ts` | 286 | HTTP Storage Backend 实现；`set` 成功后 fire-and-forget 写通启动设置快照（`app-settings-cache`）；provider-keys store 挂接 `provider-keys-cache` 内存缓存（get/has 读穿、set/delete/clear 写通 + 跨标签广播，fake/override 短路不污染缓存） |
| `types.ts` | 82 | 类型定义 |
| `utils.ts` | 6 | 通用工具函数（cn） |
| `message-utils.ts` | 95 | 消息处理工具 |
| `mermaid-renderer.ts` | 共享 Mermaid 动态加载、SVG 安全检查和渲染工具 |
| `custom-model-selector.ts` | 590 | 自定义模型选择器；主聊天可通过可选无参回调在桌面浮层与移动抽屉底部显示“自定义模型”，点击先关闭选择器再打开设置，未传回调的共享对话/表单复用场景不显示 |
| `clipboard-polyfill.ts` | 51 | 剪贴板 API polyfill |
| `logger.ts` | 56 | 前端日志工具 |
| `update-check-poll.ts` | 71 | 更新检查轮询助手：`requestUpdateCheck()` 对非阻塞的 `GET /api/system/update/check` 状态快照做有界轮询（默认 10 次 × 1s，可注入 fetch/sleep 单测）到 `ok`/`error` 终态，失败一律返回 `{ kind: 'error' }` 不抛出（fetch/sleep 可注入）；`force` 仅首次请求带 `?force=1`；兼容不带 `status` 字段的旧服务端 payload |
| `random-id.ts` | 19 | UUID 生成 |
| `window-guard.ts` | 118 | Web Locks 严格单窗口守卫（纯锁守卫）：`acquireAppWindowGuard` 以 `ifAvailable` 抢锁（持锁成功时 request promise 因回调永不结束不会结算，成功判定只依赖 acquired 标志）；同窗口刷新竞态按 400ms×2 重试后判 blocked（blocked 窗口由 main.tsx 渲染拦截页）；Web Locks 不可用降级放行（unsupported，BroadcastChannel 等不再是依赖） |
| `browser-connection-diagnostics.ts` | 631 | 浏览器侧连接池 / 请求排队诊断采集器：`PerformanceObserver` 采同源资源计时（排队 = `requestStart - startTime`），包装 `window.fetch` 统计 in-flight 与常驻长连接（SSE / NDJSON，clone 分支观测结束、不改原响应体），排队超阈值 `console.warn`（同 path 节流 30s），`window.__quickforgePerf()` 输出报告并异步拉取 `GET /api/diagnostics`；`VITE_QUICKFORGE_DIAGNOSTICS=0` 关闭 |
| `tool-display-settings.ts` | 40 | Tool 与上下文用量展示设置 |
| `tool-execution-events.ts` | 163 | 工具执行事件处理（类型/消息合并 + `toolCallIdsWithoutToolResult` pendingToolCalls 合成） |
| `tool-param-summary.ts` | 工具参数→摘要文案纯函数：`summarizeParams`（自 local-tools 提取，按工具名取 command/path/query 等生成单行摘要）、`normalizeToolArguments`（toolCall arguments 归一化，兼容 JSON 字符串）、`truncateSummary`；工具卡片与 subagent 跑马灯共用同一套规则 |
| `tool-marquee.ts` | subagent 摘要卡「当前工具」跑马灯动画控制：`ToolMarqueeController`（DOM/定时器/动画经参数注入可单测）——容器内双视图（各含 static+moving span，宿主定高一行），溢出且非 reduced-motion 时 WAAPI 横向循环（35px/s 滚动→端部停顿→回弹），同值刷新不打断；text 切换时旧视图向上滚出、新视图自下滚入（`MARQUEE_ROLL_DURATION_MS`=260ms + 里程计同族缓动，滚动期间旧视图横向动画不中断，结束后按既有 400ms 起始延迟重建横向循环，滚动中再遇新文本先就地结算再重滚），`sync(text, running, restart, roll)` 的 `roll=false` 表示本次 text 变化只是同一行内增长：就地更新当前视图文本、不做整行纵向滚入（否则两视图同显同一句＝上下重复显示两次；思考尾行提示的同行增长走这条路径，行切换仍写 `roll="true"` 走滚入）；reduced-motion/首次出现/终态退化为直切，常量与侧栏会话标题跑马灯一致 |
| `input-clamp.ts` | 长输入内容定高收起（聊天用户消息气泡 + subagent 详情任务块共用，设计稿 `design-mockups/input-clamp-expand.html`）：`InputClampController`（DOM 能力注入可单测）管理 data 属性状态机与内联 max-height 过渡（220ms，展开结束后置 none，reduced-motion 直切）；正文阈值按元素 computed line-height × 6 行 + 纵向 padding/border 计算（随字号设置缩放），overflowing 内容额外显示 30px 流内按钮安全区，确保展开/收起按钮不覆盖正文，fits 内容隐藏安全区、渐隐与按钮且不留空白；i18n 标签由调用方注入（模块不 import i18n，保持 node 环境可测）；DOM 装饰入口 `decorateUserMessageInputClamp`（聊天装饰）与 `syncInputClampBoxes`（subagent 详情 updated 后） |
| `diff-view.ts` | write/edit 工具 diff 的结构化解析纯函数：`parseDiffRows` 支持 unified（含无 hunk 的 pseudo-unified）与 raw 新文件文本，保留 old/new 解析行号并由渲染层按 del→oldNo、add→newNo、ctx→newNo（防御性回退 oldNo）显示单列智能行号，剥离 unified 的 +/- 前缀、保留 raw 首字符、计算 hunk 间 gap，并在显式截断状态下忽略精确尾标记；`parseDiffFileInfo` 从标准 unified 文件头提取路径与 `/dev/null` 新文件语义。`tool-renderers/shared.tsx`（T4 前在 local-tools.ts）复用该结果渲染两列共享 grid / `display: contents` 行视图与横向长行背景，摘要以静态绿色 `+N` / 红色 `−N` 文字显示，gap 可见内容仅为 `⋯`，不做字符级 token/LCS/`<mark>` 标记 |
| `sidebar-session-sort-mode.ts` | 左侧会话时间线排序偏好的 `localStorage` 安全读写，刷新后恢复且不参与后端同步 |
| `sidebar-session-display.ts` | 左侧 Projects 时间线、项目会话与 Tasks 的五条递增展示纯行为：计算下一展示目标、判断是否需要请求下一页，并以 timeline/global/project 各 key 的 pending generation 合并快速重复点击；仅在异步加载确认新增数据且 generation 仍有效时提交展示数量，重置会使在途旧请求失效，失败保持原数量并允许重试 |
| `sidebar-section-order.ts` | 左侧 Projects / Tasks 顶层区块顺序的 `localStorage` 安全读写与纯函数排序：规范化缺失、重复和外来 ID，固定映射 `tasks` 到现有 conversations UI；桌面/移动共用 App 状态，置顶区不参与排序 |
| `project-drag-boundary.ts` | 37 | 侧栏拖拽纵向边界纯函数：`visibleProjectDragBoundary` 取列表区块与共享滚动视口的可见交集；`clampProjectDragTransform` 锁定横向并把纵向 transform 夹取在可见边界内（含拖动期间容器 scrollTop 滚动补偿），rect 缺失或退化（拖动节点高过可见区）时 fail-closed 双向锁定，不允许无界拖动。Projects 条目拖拽（`restrictProjectDragToViewport`）与 Projects/Tasks 顶层区块标题拖拽（`restrictSectionDragToViewport`，边界为区块排序容器）共用，均在 ChatSidebar 中以 modifier 接线 |
| `chat-capabilities.ts` | 聊天页面 capability 静态表与页面策略 resolver：`QUICKFORGE_CHAT_CAPABILITIES` 主会话默认全开；`SIDE_CHAT_UI_CAPABILITIES`（兼容别名 `SIDE_CHAT_CAPABILITIES`）为全 false 的可执行能力表，Side Chat 仍复用主控件布局，但由共享装饰层将不支持控件原生禁用，服务端固定 `tools: []` 作为安全边界；`applyChatPagePolicy` 在其上叠加分享页 `readOnly` / `disableFork` 策略收窄 rollback/retry/forkFromMessage/attachments 等，`shouldSendComposerInput` 按 `attachments` 能力与文本/附件输入判定可发送 |
| `cross-tab-events.ts` | 跨标签 BroadcastChannel `'quickforge-sync'` 通信的稳定 per-tab source id：`getCrossTabSyncSourceId()` 返回模块级随机 id，用于广播时自忽略本 tab 的消息 |
| `system-notifications.ts` | 浏览器 Notification/Service Worker、Electron Desktop 原生通知与 Capacitor Android 本地通知统一适配；管理默认开启的设备偏好、权限、安卓远程浏览器首次发送授权、后台展示、点击打开会话和短时去重 |
| `pinned-summary-drag.ts` | 152 | 置顶摘要桌面浮动摘要的纯状态/拖动/布局 helper：`resolvePinnedSummaryInitialPosition` 仅为无历史位置的首次 desktop 定位解析主对话 header 锚点（`x = header.right - targetWidth - 12px`、`y = ceil(header.bottom) + 10px`，header 不可用时先回退 toolbar root rect，toolbar root 也不可用时再回退 widget rect）；`resolvePinnedSummaryLayout` 统一处理首次定位后、panel/capsule 切换、resize、drag 与 Inspector resume 的 viewport 安全策略——横向 12px inset，capsule 常规 clamp；panel 优先保留当前 y，并返回当前位置到 viewport bottom 12px 的 `panelMaxHeight`，让 flex 内容区滚动，只有下方不足 `PINNED_SUMMARY_PANEL_MIN_HEIGHT=180` 时才向上调整，极矮 viewport 使用全部安全区域，不按整屏自然高度上移。组件契约中 `panelMaxHeight` 只在 panel mode 更新/消费；ResizeObserver 若与拖动并发，必须以 `dragRef.current.current` 作为布局 position，不能用尚未收敛的拖动起点覆盖 max-height，结束/取消再由统一 drag cleanup 收敛。`getPinnedSummaryOutsideAction` API 已简化为 desktop `stay` / mobile `close`，不再存在 desktop minimize action；desktop 组件结构上不安装摘要级 outside/Escape listener，mobile/mobileShell 仍使用 close。`shouldSuspendPinnedSummary` 判定 Inspector 已打开时是否进入 `>=1024px` 且非 `mobileShell` 的真实桌面右侧栏暂停；`shouldClosePinnedSummaryBeforeInspectorOpen` 的参数明确表示“即将打开 Inspector 时是否具备暂停/保留能力”；另含兼容的矩形 clamp 与 4px 拖动阈值。供 `App` / `GitToolsPinnedSummary` 共用，配套纯函数测试 `tests/frontend/pinned-summary-drag.test.ts` |
| `new-chat-greeting.ts` | 31 | 新对话空状态欢迎语的时段选择纯函数：`getNewChatGreetingSlot(hour)` 按本地小时映射 morning(06–11)/afternoon(12–17)/evening(18–22)/lateNight(23–05)，越界与 NaN 归一化；`getNewChatGreetingKeys(slot)` 返回该时段 3 个 i18n key，`pickNewChatGreetingKey(date, random)` 随机取 key（random 可注入便于单测）；`NEW_CHAT_GREETING_FALLBACK_KEY` 指向 `newChatEmptyTitle` 兜底。`src/App.tsx` 以 `useMemo([showNewChatEmptyState])` 锁定随机结果，避免重渲染抖动 |

---

## 核心模块

### i18n.ts (3342 行)

**用途**: 国际化支持。包含中英文翻译字典和应用语言管理。

**功能**:
- 支持 `en` / `zh` 两种语言
- 提供 `t()` 翻译函数
- 语言初始化/应用函数
- 翻译字典本地维护（无外部包依赖），语言偏好经 `AppStorage` 的 settings store 持久化
- 日期区域设置
- **surface 文案统一走 `appTranslations`**：聊天 surface（`MessageEditor` / `ThinkingBlock` / `AssistantMessage` / `ToolMessage` / `AttachmentTile` / `AttachmentOverlay` / `AttachmentPreview` / `ApiKeyPromptDialog` / `CodeBlock` / `ChatSurface`）不再硬编码文案，全部调用 `t()`；新增或修改 surface 文案**必须同时补齐 `appTranslations.en` 与 `appTranslations.zh` 的同名键**（中英成对维护），并优先复用既有键（`thinking*` / `input` / `output` / `stop` / `close` / `save` / `cancel` / `composerPlaceholder`、```svg 与 ```mermaid 预览、`executeInTerminal`、`moreActions` 等）。装饰层可见文案同规则（`openLocalFile` / `gitBranchLabel` / `toolCommand*` 等）。
- **测试约定（文案断言固定语言）**：surface 组件的 `renderToStaticMarkup` 断言因默认语言回退 `navigator.language`（中文机器上即 zh），必须在测试内固定语言（文件级 `beforeEach(applyAppLanguageFromSnapshot('en'))`），另保留一处 zh 断言覆盖本地化生效；见 `tests/frontend/chat-surface-editor.test.ts` 与其余 `chat-surface-*.test.ts`。

### pi-chat.ts (365 行)

**用途**: Pi Chat 的初始化和模型配置管理。

**功能**:
- `initializePiStorage()` — 初始化存储后端
- `loadDefaultOptions()` / `saveDefaultOptions()` — 默认选项管理
- `getConfiguredModels()` — 通过同源 `GET /api/models/catalog` 获取统一公开目录，包含当前可用的自定义模型；失败时仅为本机旧环境回退 Provider store。`getSelectableConfiguredModels()` 统一排除 `quickforgeHidden: true`。
- `saveActiveModel()` / `saveDefaultOptions()` — 写入展示快照并附带版本化 `quickforgeModelRef`，执行 transport 仍由服务端解析。
- `loadInitialConfiguredModel()` / `resolveNewSessionModel()` — 新会话只从当前可选择目录解析默认、active 或请求模型；已隐藏、已删除或失效的模型不会成为新会话候选。
- `resolveConfiguredModel()` — 已有会话、分支等持久化绑定按完整模型身份恢复，可继续使用后来被隐藏的模型。
- DeepSeek V4 推理兼容性处理

### model-reference.ts

**用途**: 前端版本化 ModelRef 与统一目录客户端。

- `ModelReference` 区分 `custom(providerId + modelId)` 和旧自定义快照兼容引用。
- `modelReferenceFromModel()` 为 Agent、Profile、任务和共享切换生成持久化引用。
- `loadModelCatalog()` 读取同源 `/api/models/catalog`，不读取 Provider Key。

### server-agent.ts (2236 行)

**用途**: `ServerAgent` 类 — 与服务端 Agent 通信的客户端。

**拆分边界（本 feature 已完成限定范围）**：`server-agent-types.ts` 承载 18 个原公共类型及内部 `GoalIterationMarkerSnapshot`，并定义 `ServerAgentLocalEvent`（本地明确轻通知联合）与仅含 `readonly type?: unknown`、无万能索引的 `ServerAgentWireEvent`；`server-agent-http.ts` 提供无项目模块依赖的 HTTP helper；`global-agent-sse-client.ts` 管理 SSE 传输、全局单例、重连及健康探测。单向依赖为 `server-agent.ts → global-agent-sse-client.ts → server-agent-http.ts`，主类也直接使用 HTTP helper；抽离模块不反向依赖主类。旧 `server-agent.ts` 保留 type/value re-export，消费方导入路径兼容。`subscribeEvents` 是本地事件与未校验 wire 对象的诚实入口；旧 `subscribe` 保持原签名，仅在 legacy wrapper 有一处 `event as AgentEvent` 兼容边界，不声称已校验。12 处 wire 原样转发与本地 typed emit 分离；Map 保持原 Set 的 identity、插入顺序、live iteration、异常隔离与 dispose 语义。会话 watchdog（5s 检查、15s 静默恢复）、状态/消息对账及事件派发仍在主类；20 处散布的 AgentEvent 断言已收敛为 1 处有意兼容边界，但不等于所有其他 cast 消除。此处线性依赖用文字即可说明，无需新增 SVG。

**关键功能**:
- SSE 事件流通过独立 `global-agent-sse-client.ts` 的 `GlobalAgentSseClient` 管理；会话恢复 watchdog 仍由 `ServerAgent` 负责
- 消息发送/接收；`steer(message)` 乐观显示——立即把 steering user 消息追加进本地 state 并发 `message_start`，服务端在下一工具轮边界注入同一消息（同 role+timestamp）经 `message_end` 回显后由 `upsertMessage` 原位替换不重复，HTTP 失败则回滚乐观副本并重新通知面板；prompt HTTP 请求失败时先回滚未被服务端接收的乐观 user message，再追加符合消息契约的 assistant error message（具体 `errorMessage`、`stopReason:'error'`、当前模型字段、零 usage 与 timestamp），并以 `agent_end` 的 `status:'error'` / `errorMessage` 结束本地运行，让聊天区直接显示服务端返回的具体原因；该合成错误消息同时挂客户端专用 `quickforgeFailedPrompt`（未被服务端接收的原始消息），`retryFailedPrompt(errorEntry)` 据此在非流式时移除该错误消息、把 stash 中的 `selectedCapabilities`/`contextReferences` 预置回 nextPrompt*（避免 prompt 空快照逻辑剥除 details）后原样重发，供「错误旁继续按钮」区分「重发未送达消息」与「发继续消息」两种语义。`continue(appendMessage?)` 可选追加：不带参数时保持服务端截断重生成；带 `appendMessage` 时把该消息乐观追加进本地 state 并发 `message_start`（与 `steer` 同一模式），连同请求体 `{ message }` 发给服务端，服务端保留历史并在末尾追加后续跑，HTTP 失败则回滚乐观副本再抛出；`deferred-session-agent` 透传该参数
- Agent 状态管理（创建、单次恢复、销毁）；`ServerAgent.restore()` 支持 `AbortSignal`，从 `/api/agents/:sessionId/restore` 一次取得完整权威快照，取消的旧会话请求不会创建 SSE；页面刷新或 SSE 重连时会从服务端 state 恢复运行中工具的临时 `toolResult`（含 subagent `details.messages`）和 `pendingToolCalls`
- ask_user 提问流：`ask_user_required`/`ask_user_answered` SSE 事件维护 `state.pendingAsk`（随 state 快照与 SSE state 帧恢复），`answerAsk(askId, {answers, skipped})` POST `/api/agents/:id/answer-ask` 回传后清空 pending；回答以纯文本作为 ask_user 工具结果回给模型
- Goal 模式客户端：`state.goal` 由会话快照、SSE `goal_updated` 与 `updateGoal(action, objective?)`（POST `/api/agents/:id/goal`，30s 超时，超时抛错让卡片解除 pending）维护。权威排序分两层：同一 goal id 以 `revision` 为准，旧 revision 不回退；跨 id 或 `null` 清空以请求前捕获的 goal 变更水位 `goalSeq` 守卫，异步响应只有在期间没有更新的 goal 落地时才被采纳（相同回显不推进水位）；响应缺少 `goal` 字段时保留现状而非清空。`deferred-session-agent` 同步代理 `updateGoal` 并在新会话/重置时清空 `goal`。相同回显不推进水位，且只有**真正改变** goal 的快照才向订阅者广播 `goal_updated`（`/state` 刷新同样带请求前水位，输给更新的 goal 快照时不上报）。goal 帧与 goal 通知一律**不**推进消息 `stateVersion`：goal 不改消息，推进会作废在途的消息对账并丢消息。`/state` 刷新的消息版本早退路径只对「同 goal id + 严格更高 revision + 请求前捕获的 `goalSeq` 未被期间落地的 goal 改变」的 goal 快照独立采纳（`adoptNewerRevisionGoalFromSnapshot`），跨 id 替换与 `null` 清空不越过消息版本 guard，仍由正常路径与 `goalSeq` 水位裁定
- Goal UI 共享状态与草稿保留：`goal-ui.ts` 是 pending / dirty / error / 草稿的唯一客户端 owner，键为 `sessionId + goalId`。`runGoalUiAction` 同步加锁、失败写 error 广播；dirty 允许 `revise` / `pause` / `cancel`，防止草稿阻止安全停机，其他动作仍拒绝。草稿保存服务端 objective 基线与 editing 标记，运行中也可编辑；`syncGoalUiState` 由 App effect 对账，外部 objective 改写时保留 dirty 草稿以显示冲突，不静默覆盖用户文本，并保留真实 in-flight pending。挂载面通过 `retainGoalUi` / `releaseGoalUi` 保留关闭或响应式重挂后的草稿，无人挂载的草稿由 LRU 限额管理。`requestOpenGoalSummary` 沿用事件名 `quickforge:open-goal-summary`，携带 progress/edit；App 校验当前会话与 goal 后打开对应 Workspace Inspector 运行时 Tab，不再展开摘要详情。
- Goal 安全编辑：`goal-edit.ts` 的 `saveGoalObjective` 在调用方共享 revise 锁内检查 session/goal/基线；running/verifying 保存需用户确认 pause，然后读取权威快照，等 paused 且非 streaming 再 revise。App 注入 `ServerAgent.refreshGoalForSave`（单次严格快照读取，失败显式抛出，不走后台重试或降级成功）；等待过程限时、可取消，并在派发前再次检查身份/基线，不自动 confirm/resume、不重试 POST。`GoalInspectorContent` 的关闭 `useLayoutEffect` 立即取消后续等待/未发送保存；已发送 POST 不能撤回，mutation 结算前不释放共享锁。`revise` 等既有动作仍无客户端 revision CAS，快照预检不是跨客户端原子事务，也不保证服务端拒绝所有外部冲突；发现冲突或请求失败时保留草稿报错。只有预算追加的 `extend_resume` 新动作具备 goalId/revision CAS（见下文）。

### Goal 预算追加客户端契约

- `goal.ts` 提供 `extend_resume`、`GoalActionOptions`、真实 usage/预算耗尽维度与默认增量投影；`planConfirmed` 防御归一化与服务端一致：planning/awaiting_confirmation 为 false，其他状态优先显式布尔值，旧缺字段仅以 usage.iterations > 0 推断。
- `ServerAgent.updateGoal(action, objective?, options?)` 与 deferred 代理透传追加选项；HTTP 仅发送 `{action:'extend_resume', goalId, expectedRevision}`，expectedRevision 必须为正 safe integer，不发送 signal 或客户端预算。确认时捕获旧 goalId/revision，严格快照预检仍绑定此旧 revision，不能读到新 revision 后悄悄重绑提交。
- 失败后做权威快照对账，不盲重发追加 POST；冲突、超时或响应丢失不等于服务端未追加。只读预检可取消，关闭 Inspector 仅取消尚未发送的 POST；已发 POST 不可撤回，须等待请求结算后释放共享 pending 锁。需要再次追加时由用户查看新快照并重新确认。
- 服务端才拥有预算/恢复状态决策：仅耗尽轮次追加配置轮次（settings key `goal-settings`，整数 clamp 1–100，缺省/读取失败回落 20；前端镜像 `src/lib/goal-settings.ts`，追加确认增量经 `goalBudgetExtension(goal, grant)` 展示配置值），并移除旧时间上限，usage/计划证据保留；加额仍不足保持 paused，不调度；足够后无计划 planning、有计划 running（不需要确认）。其他旧动作不因新契约获得 CAS。相关回归为 `tests/frontend/{goal-state,goal-ui,goal-budget-inspector,server-agent,goal-control-strip,goal-card}.test.ts`。
- 文件撤销独立于消息回滚：`getFileRollbackPreview(signal?)` GET `/rollback-files/preview`（30s 超时）取得整批及每项独立 revision；旧服务端缺少每项 revision 时禁用单项操作。`rollbackFiles(revision, signal?)` POST `/rollback-files` 提交整批 `{revision}`；`rollbackFile(path, revision, signal?)` POST `/rollback-file` 提交选中项 `{path, revision}`，不回退整批接口（两者均 60s 超时）。校验响应结构及 HTTP/status 配对：单项接受 200 / `partial` 或 `completed`，整批接受 200 / `completed`，两者均接受 409 / `blocked`、500 / `failed`，返回结构化 `ServerFileRollbackResult`（含实际恢复/删除计数、errors 与剩余 preview）。`partial` 仅表示本次单项成功，不能触发整体「已撤销」；普通兄弟项冲突/legacy 不阻止安全单项，但全局 reason 仍禁用，整批要求剩余全安全。传输失败、超时、取消或异常响应不能证明服务端未写入，交给文件撤销弹窗展示“结果未确认”，不自动重试执行。轮级撤销客户端（per-turn-artifact-cards）：`getTurnRollbackPreview(turnIds, signal?)` GET `/rollback-turn/preview?turnIds=t1,t2`（逗号分隔，30s 超时；空集合防御——无 turnId 的轮不发起请求、直接按预检失败拒绝）返回 `{revision, turnIds, canRollback, files:[{path, relativePath, safe, reason, action, created, beforeBytes, afterBytes}]}`（`turnIds` 回显请求集合）；`rollbackTurn(turnIds, revision, signal?)` POST `/rollback-turn` 提交 `{turnIds, revision}`（60s 超时，空集合防御同口径）返回 `ServerTurnRollbackResult`（`{status, rolledBack, conflicts, errors, preview}`），200 接受 `completed` / `partial`，另接受 409 / `blocked`、500 / `failed`；错误对象携带 HTTP `status` 供 UI 区分 conflict 与未确认。
- 系统提示词加载
- Agent 权限模式切换
- 自定义命令注入
- 下一次 prompt 的结构化选择：`setNextPromptCapabilities()` 先通过 `selected-capabilities.ts` 统一规范化（仅合法对象/字符串、裁剪长度、按 `type+pluginName+name` 去重、保持顺序、最多 4 项），请求体继续发送可含 description 的本轮选择，同时乐观 user message `details.selectedCapabilities` 写入不含 description 的展示快照；与 `details.contextReferences` 可共存，两者均发送一次后清空，下一轮不泄漏。`setNextPromptContextReferences()` 发送最多 8 个 `{type:'file',projectId,path}`，随 prompt body 的 `contextReferences` 字段上送、乐观 user message 同步写入 `details.contextReferences` 供历史 chip 即时渲染；失败沿用既有 optimistic 回滚。`setPromptMode('plan' | 'ask' | null)` 把 `setPlanMode` 泛化为单轮模式选择（当前仅 `'plan'` 映射到既有 `{type:'plan'}` command，`'ask'` 为预留值尚无发送方；`setPlanMode` 保留为兼容包装）
- 支持直接后端连接（绕过 Vite 代理）
- **弱网重连状态广播**：`GlobalAgentSseClient` 的指数退避重连（1s 起 ×2、封顶 30s）新增尝试计数与上限 `MAX_SSE_RECONNECT_ATTEMPTS = 10`；`onerror` 进入恢复（直连→同源代理切换计一次零等待尝试）时经 `subscribeSseConnectionState` 广播 `{status:'reconnecting', attempt, maxAttempts, nextRetryAt, unreachable?}`，`onopen` 成功且此前确有断连时广播 `{status:'connected', recovered:true, restarted?}` 并重置计数/退避，第 10 次重试仍失败广播 `{status:'failed', maxAttempts}` 并停止自动重试（`requestSseReconnectNow()` 供 UI「立即重试」手动重启、`getSseConnectionState()` 取当前快照）；断连期间的 streaming 卡死仍由既有 15s 静默看门狗轮询 `/status` 兜底，两者互补不替代。重连期间每次调度失败后还会 fire-and-forget 探测一次 `/api/health`（`SSE_HEALTH_PROBE_TIMEOUT_MS = 5000`，AbortController 超时、single-flight 去重、baseUrl 跟随直连/同源代理切换）：`reachable = ok && json.ok`，结果返回时若仍处重连中则更新 `serverUnreachable` 并重播当前 reconnecting 状态（不可达时携带 `unreachable:true`）；`serverUnreachable` 为 true 时重连不再受 10 次上限约束（退避仍封顶 30s 持续自动重试，翻回 false 后若已超上限则下次失败照常进 failed），成功连上/`retryNow()`/`disconnect()` 均复位该标志。探测同时读取 `bootId` 维护基线：重连探测结果无条件更新基线；每次 `onopen`（含首次连接）再探测一次，若基线存在且 bootId 变化则补播 `{status:'connected', recovered:true, restarted:true}`（服务重启提示），首次连接仅记录基线；连上后到达的探测结果不影响 unreachable 语义。不可达窗口带时间戳：`serverUnreachable` 从 false→true 时记录 `unreachableSince`（`Date.now()`，同一轮不可达期间保持不变），reconnecting 广播携带该字段供 UI 计算断开时长与提示分层阈值（30s 升级 Tier2 常驻条）；翻回 false / onopen 恢复 / `retryNow()` / `disconnect()` 均清除
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

**用途**: QuickForge 工具渲染器注册入口。渲染器实现全部为 React（见 `tool-renderers/`），本文件不再含渲染逻辑：

- **注册**：导入时注册本地工作区工具（`manage_global_memory` / `read_file` / `grep_files` / `write_file` / `edit_file` / `run_command` / `present_files` / `activate_skill` / `read_skill_resource`）、`run_subagent`、`generate_image`、`todo_write`、`ask_user`、`goal_report`；`getLocalWorkspaceTools(tools)` 仅透传服务端工具元数据（工具定义只在服务端 `server/tools/definitions.mjs` 与 `GET /api/tools`），并对 `mcp__server__tool` 名称按需幂等注册 `McpToolRenderer`（label 取服务端 label 或剥除 `[MCP:...]` 前缀的 description）。
- **subagent 运行详情（React）**：Workspace Inspector 的运行详情由 `components/workspace/SubagentRunDetailContent.tsx` 渲染（纯逻辑与实时 store 见 `subagent-run-detail.ts`，展示层级遵循 `subagentRunBodyBlocks`），渲染后由 `syncInputClampBoxes` 幂等度量收起态；过程装饰由 `SubagentTrace` 自身承担（`getSnapshotBeforeUpdate` 释放过程组 + `componentDidUpdate` 对 `.qf-message-list` 调 `decorateProcessBlocks`），不再经由 `message-actions` 的共享入口；本文件不再提供任何详情模板或耗时徽标（耗时徽标见 `tool-renderers/shared` 的 `renderTiming`）。

### tool-renderers/

**用途**: QuickForge 工具渲染器的 React 实现集（由原 local-tools 内联模板逐个迁出）。各渲染器 `render(params, result, isStreaming)` 返回 `{ content: ReactNode, isCustom }`，由 React ChatSurface 的 ToolMessage 直接渲染；class 链与 DOM 结构逐字复刻原模板（CSS 与 DOM 装饰层依赖这些类名），内联 SVG 图标仅属性名驼峰化；代码与日志输出直接渲染 React DOM（`qf-code-block` / `qf-console-block` class 链），不再是 `code-block` / `console-block` 自定义元素（仅 `quickforge-elapsed-time` / `quickforge-tool-marquee` 仍是 attribute 驱动的自定义元素）。两类输出块现在都有复制入口，但**来源不同、时长与文案不同**：工具卡代码输出 `renderCodeBlock` 的 title 恒为 `t('copyCode')`（Copy code / 复制代码）、复制后图标换 Check 并追加可见 `t('copiedBang')`（Copied! / 已复制！）、2000ms 复位；命令输出 `renderConsoleBlock` 复刻旧 pi `<console-block>`——标题栏左标签 `t('consoleBlockLabel')`（console / 控制台），右侧 `ConsoleCopyButton`（`data-qf-action="copy-console-output"`）的 title/aria-label **恒为** `t('copyOutput')`（Copy output / 复制输出，不随 copied 切换），复制成功换对勾 + 可见 `t('copiedBang')`、1500ms 复位（`CONSOLE_COPY_FEEDBACK_MS`，对应旧 `copy(){…setTimeout(…,1500)}`）；输出区包在私有 `ConsoleScrollArea` 里，**无依赖数组**的 `useEffect` 每次 commit 后把 `scrollTop` 写到 `scrollHeight`，复刻旧 `<console-block>.updated()` 的「每次渲染后置底」语义（**旧缺陷一并保留**：不区分用户手动上滑，也没有 pi 内部 `_autoScroll` 那类 scroll 监听）。上述 i18n 键（`copyCode` / `copyOutput` / `copiedBang` / `consoleBlockLabel`）与消息操作仍在用的 `copy`/`copied` 刻意分开。聊天消息里的 fenced 代码块由 `components/chat/surface/CodeBlock.tsx` 承担（标题栏/复制/```svg 预览/```mermaid/终端执行），`renderCodeBlock` 只服务工具卡内的代码输出。

- `shared.tsx` — 共用构件：纯函数（`toolStatus` / `stringifyValue` / `resultText` / `toolOutputText` / `getDiffDetails` / `formatDuration` 等）、attribute 驱动自定义元素（`quickforge-elapsed-time` 耗时徽标、`quickforge-tool-marquee` 跑马灯宿主，动画时序在 `tool-marquee.ts`）、React 节点工厂（`renderToolIcon` / `renderToolChevron` / `renderStatus` / `renderDiff` / `renderDiffRow` / `renderInlineDiffStats` / `renderTerminateCommandButton` / `renderPreviewButton` / `renderToolFileSummary` / `renderCodeBlock` / `renderConsoleBlock`（后者内部含 `ConsoleCopyButton` / `ConsoleScrollArea` 私有组件））、折叠状态记忆（`rememberToolDetailsOpen`，按 toolCall id 键控、模块级 LRU 上限 100 条，跨 remount 保留用户开合）与 `toolDisplayDetailed()` detailed 门控（仅控制 input/details 内容渲染）；5 个工具渲染器与默认工具卡的 ToolDetails 初始开合固定 `initiallyOpen={false}` 默认收起、不随任何设置变化（`toolDetailsOpenMemory` 手动开合记忆优先）。`renderToolFileSummary(toolName, params)` 覆盖 write_file / edit_file / read_file 三个工具卡摘要区（summary 标题后「 · 」详情）：按 `params.path` 渲染文件类型图标（FileIcon，与 workspace 文件树统一）+ 仅 basename 的整体元素，hover title 保留完整路径；路径可预览（`resolvePreviewableArtifact` 有值）时整体即预览入口，点击经 `previewArtifactClickHandler`（阻断 summary 折叠后派发 `PREVIEW_ARTIFACT_EVENT`）交 App.tsx openArtifactPreview 跳转阅读；不可预览时仅静态 span。`renderPreviewButton` 仅剩 present_files——write_file / edit_file 的右侧眼睛按钮已移除（摘要区文件元素整体即预览入口，与文件名点击去重；present_files 为多文件摘要无法整体充当入口，保留独立按钮）。read_file 的绝对路径与 `~` 前缀路径一律静态不可点击（`isNonWorkspaceClickablePath`：`/`、`\`、盘符、`~` 开头）：预览链路（App.tsx openArtifactPreview → 工作区文件 API）受服务端 workspace 边界（isInside(workspaceRoot)）约束，工作区外绝对路径会被 403 拒绝且 `~` 不展开，渲染层又拿不到工作区根、无法区分「工作区内绝对路径」，故不猜路径展开、一律静态。工具图标 `renderToolIcon` 与其余工具的纯文本摘要行为保持不变。
- `local-workspace-tool-renderer.tsx` — 本地工作区工具通用卡：shell + summary（图标 + 标题 + 折叠箭头 + diff 统计 + 状态，运行中标签挂 `quickforge-tool-running-sweep` 跑马灯排除区之外的扫光）+ 展开区（input/output/diff/details，`run_command` 用带标题栏与复制入口的 console 输出块）+ `quickforge-tool-actions`（预览 / 终止命令）。
- `subagent-tool-renderer.tsx` — run_subagent 摘要卡：点击派发 `OPEN_SUBAGENT_RUN_EVENT` 打开 Inspector 运行 Tab（canonical 可取 store 最新同 ID 快照，历史 fallback 用当前载荷）；运行期在标签之后渲染 `quickforge-tool-marquee` 显示当前工具摘要（工具间隙回放最近非空摘要防闪空），且运行中隐藏状态区（icon+耗时，与 local-workspace 渲染器一致），运行态由 statusLabel 文案 + 跑马灯表达；renderer 仅按 `shouldPublishSubagentRunPayload` 回填 canonical 安全快照，SSE 实时路径权威（发布/打开规则见 `subagent-run-detail.ts`）。
- `ask-user-tool-renderer.tsx` — ask_user 卡：pending 展开列问题清单；已答/跳过历史复用回执确认步样式（`askUserReviewRowsFromDetails` 从持久化 details 提取规范化 questions/answers/skipped/skipReason，`buildAskAnswerText` 合并答案，跳过态带 reason 行），非 detailed 省略 output 文本块。
- `goal-report-tool-renderer.tsx` / `todo-write-tool-renderer.tsx` — 历史只读投影（视图模型见 `goal-report-history.ts` / `todo-write-history.ts`），固定默认折叠（`initiallyOpen={false}`，不随任何设置变化）、detailed 只决定是否附原始 JSON、不影响开合。
- `generate-image-tool-renderer.tsx` — 历史会话兼容的图片结果块（普通页与 `/share/:shareId` 同源 URL）。
- `mcp-tool-renderer.tsx` — MCP 动态渲染器（summary 行 server / 原名 / 参数摘要，`parseMcpToolName` 解析 `mcp__server__tool`）。
- `index.ts` — 统一导出，`local-tools.ts` 注册入口消费。

**registry 语义**：注册统一走 `tool-renderer-registry.ts` 的 `registerToolRenderer`——模块级 `Map` 存 React 渲染器，chat / side chat / subagent trace 经 `getToolRenderer` 取同一批实现；无包级 registry、无 DOM 宿主桥、无双管线。渲染行为契约（diff 单列智能行号 / ask_user 回执 / todo_write 摘要 / 跑马灯动画）的验证见 `tests/frontend/diff-view.test.ts`、`ask-user-card.test.ts`、`todo-write-renderer.test.ts`、`tool-marquee.test.ts`、`local-tool-running-sweep.test.ts` 等。

### todo-write-history.ts

**用途**: 为 TodoWrite 历史工具消息构建不依赖 DOM/React/i18n 的视图模型，供 `todo_write` 工具消息消费。

- 状态先按工具生命周期判定：`isStreaming` 为 running；`isError`、`details.aborted` 或 `details.timedOut` 为 error；存在终态 result 为 success 候选；只有调用无结果为 neutral。
- 仅信任成功 `toolResult.details.todos` 作为已应用快照，复用严格三态、最多 20 项、非空内容的规范化边界。
- 有效非空快照生成 success“更新任务清单”历史事件，有效空数组生成 clear“清空任务清单”历史事件；无效/缺失快照生成 neutral 摘要。renderer 不根据历史事件宣称当前 Composer Dock 摘要已同步或移除。

### subagent-run-detail.ts

**用途**: subagent 单次运行详情的纯逻辑（不依赖 DOM/框架/React/i18n 运行时，`t` 由调用方注入）。`extractLatestTerminalSubagentRuns()` 用于顶部置顶摘要：只扫描调用方传入的当前消息分支，按 `toolCallId` 配对 assistant `run_subagent` 调用与 `toolResult`，排除当前 `pendingToolCalls`，复用 `buildSubagentRunPayload()` 规范化后仅保留 done/error；按终态结果 timestamp 最近优先（缺失时回退消息索引）、canonical ID 去重并限制最近 1–`MAX_TERMINAL_SUBAGENT_RUNS`（100）条，且返回轻量载荷（traceMessages/input/details 留空；点击打开时 Inspector 优先取 `subagentRunStore` 快照，未命中时详情缺 trace/input/details），明确不枚举全局 `subagentRunStore`，因此切换会话、回滚或恢复时列表跟随当前分支重算。`buildSubagentRunPayload()` 把 run_subagent 的 params/result.details 规范化为 Workspace Inspector 运行 Tab 使用的统一载荷（稳定 run id 以 `toolCallId`（显式参数、toolResult 顶层字段或 `details.toolCallId`）为主键，`details.sessionId` 仅作历史兼容 fallback，两者都没有时回退 `${name}:${task}`；同时携带 `canonicalToolCallId`，并生成状态/状态文案/耗时/工具调用数/允许工具/过滤后的过程消息/input/details JSON/内容指纹，以及从 `details.model`/`details.thinkingLevel` 解析出的运行信息 `model`/`thinkingLevel`——非法或缺失时为 `undefined`，`model` 的 `provider/id` 已由服务端在继承模式下补全）。`canPublishSubagentRunPayload()` 仅允许 canonical 载荷进入全局 store；`canOpenSubagentRunPayload()` 允许 canonical 任意状态以及无 canonical 的 done/error 历史载荷打开；`shouldPublishSubagentRunPayload()` 允许 renderer 首次发布 canonical 快照，或用恢复出的 done/error 修正已有 called/running，其他已有快照保持 SSE 权威；`resolveSubagentRunPayloadForOpen()` 仅为 canonical 点击选取 store 最新同 ID 快照，历史 fallback 始终返回当前 renderer 载荷。`subagentRunFingerprint()` 用于实时更新去重且包含 `canonicalToolCallId`，`normalizeOpenSubagentRunRequest()` 校验打开事件 detail；`currentSubagentToolSummaries()` 是聊天摘要卡「当前工具」跑马灯的数据源：`pendingToolCalls`（toolCall id）× `traceMessages`（assistant content 的 toolCall chunk）求交集，按 trace 顺序返回 `工具名 · 参数摘要`（`summarizeParams` 生成、`SUBAGENT_TOOL_SUMMARY_MAX_LENGTH`=80 截断、arguments 经 `normalizeToolArguments` 归一化），无 pending 或 chunk 缺失时为空列表；`currentSubagentToolSummariesWithMemory()` 是渲染层实际使用的带记忆版本：非 running 一律空列表，fresh 非空时经 `SubagentToolSummaryMemory`（按 runId 的有界 `Map`，`MAX_SUBAGENT_TOOL_SUMMARY_RUNS`=100，插入序 FIFO 淘汰、已存在 key 更新不改变淘汰顺序、remember 忽略空 runId/空列表、支持 clear）记住并返回，running 且 fresh 为空（工具间隙、pending 未流出的瞬时）回放该 run 最近一次非空摘要，保持跑马灯连续直到下一个工具出现或运行结束；`subagentRunBodyBlocks()` 是运行详情内部块顺序（task/context/expectedOutput → 运行信息 meta（有可显示的模型标识（provider/id/name）或 `thinkingLevel` 时，不受 detailed 门控；渲染时位于任务说明块上方独立一行）→ 详细摘要 → trace → 无 trace 时 output → input/details）的单一事实来源，与 Git 历史最终态一致；`subagentRunModelLabel()` / `subagentThinkingLevelLabelKey()` 是「运行信息」行的展示纯函数（前者 provider/id 优先、回落 name，后者复用主 Agent 思考等级 i18n key）；`SubagentRunStore` 是有界（`MAX_SUBAGENT_RUN_SNAPSHOTS`=100）的内存快照 store，支持 publish（指纹去重、订阅者异常隔离）/get/subscribe/clear（clear 仅清快照、保留订阅），全局单例 `subagentRunStore` 供 ServerAgent 实时发布与 Workspace Inspector 订阅；`subagentRunPayloadFromToolEvent()` 是 tool_execution_start/update/end 事件到载荷的纯转换（isStreaming 区分运行/终态、args 缓存回填、previousTiming 回填、isError 归 error；另带 `previousPayload` 回填——running 帧缺 details 字段（如 pendingToolCalls/messages）时按字段回填上一载荷且事件自带值优先，保证同 run 内状态单调不回跳（工具行不闪 done）；终态 details 无元数据时整份回填上一载荷的 trace/元数据）；`SubagentRunEventPublisher` 是 ServerAgent 持有的 SSE 事件发布器，按 toolCallId 缓存 run_subagent 的 args/toolName（start 缓存、end 清理），用规范化 start 事件（带 partialResult）发布，update/end 缺 args/toolName 时回填缓存，previousTiming 取 store 中同 runId 上一次载荷；Workspace Inspector Tab 严格按相同 `runId` 更新/upsert，不执行 fallback 迁移。

- 服务端运行期 `tool_execution_update` 的 `details.messages` 只携带最近 50 条消息（`SUBAGENT_TRACE_MESSAGES_LIMIT`），并附 `messagesTotal` 总条数；终态 `toolResult` 的 `details.messages` 保持全量，运行结束后查看完整过程不受影响。前端消费方只依赖尾部消息（跑马灯/trace 过滤/指纹），截尾对实时渲染不可见。

### generated-image-assets.ts

**用途**: 校验 `generated_image_result` 工具元数据，只接受受控图片 MIME 和服务端 UUID 资产 ID；为普通会话与分享页构造同源图片资源 URL。

### tool-artifacts.ts

**用途**: 从当前 AI turn 的工具结果中提取产物文件；识别 `write_file`、`edit_file` 和 `present_files`，并将 HTML/图片分流到 Browser，将 Markdown、代码、配置及普通文本分流到 Reader，将 PDF/DOCX/XLS/XLSX 分流到 Document；显式 `preview: false` 的文件仅保留在产物列表（仍可手动预览）。自动预览仅对 agent 附着后新发生的 `present_files` 生效（恢复会话的历史 present 不自动弹）。per-turn-artifact-cards 新增 `extractTurnArtifacts(messages)`：按 user / user-with-attachments 双边界把消息切轮，返回每轮新增产物的 `AiTurnArtifacts[]`（`{userIndex, artifacts, turnIds: string[]}`，首条 user 之前的内容归入 `userIndex=-1` 前置组），无产物轮不返回，供产物卡每轮一卡使用；轮对象 `turnIds` 取自该轮全部产物 toolResult `details.turnId` 的去重保序集合（一轮 = 原 run + 重试 run 的全部 turnId；无任何 turnId 的轮为空数组，产物卡不渲染撤销按钮）。`turnRollbackKey(turnIds)`（= `join('|')`）是轮级撤销的稳定轮键，App `rolledBackTurns` 与卡片「已撤销」判定共用同一口径——重试在同轮追加新 turnId 后轮键变化，旧键残留无害（新产物出现本就该重新武装按钮）。既有 `extractCurrentTurnArtifacts` / `extractSessionArtifacts`（会话累计口径）保留供其余消费方。

### mermaid-renderer.ts

**用途**: 聊天 Markdown 与 Workspace Markdown Reader 共享的 Mermaid 渲染入口。首次遇到 Mermaid fenced code block 时动态加载 Mermaid，以严格安全配置生成 SVG，并在转为图片预览前拒绝脚本、事件属性、HTML 外嵌内容和外部资源。

### http-storage-backend.ts (286 行)

**用途**: 通过 HTTP API 实现的 Storage Backend。

**功能**:
- 实现 `StorageBackend` 接口
- 可配置的 `blockedStores`（阻止访问某些存储区域）
- 支持 `storeOverrides`（覆盖本地读取逻辑）
- 健康检查（`isAvailable()`）
- `fakeProviderKeys` — 模拟供应商密钥
- `set` 成功后 fire-and-forget 写通启动设置快照（`app-settings-cache`）
- provider-keys store 挂接 `provider-keys-cache` 内存缓存：`get` 读穿（缓存命中零 HTTP，未命中经 in-flight 去重回填）、`has` 仅缓存命中时短路（不回填，has 无法区分具体值）、`set`/`delete`/`clear` HTTP 成功后写通 + 广播；`keys` 不缓存（非关键路径）；transaction legacy 路径委托 get/set/delete 自动继承。所有缓存逻辑位于 `fakeProviderKeys` 与 `storeOverrides` 短路之后——分享页假 key 与本地 override 命中不污染缓存

### provider-keys-cache.ts (139 行)

**用途**: provider→key 模块级内存缓存，消除发送消息路径上 `providerKeys.get` 的无缓存 HTTP 往返（pi 库 AgentInterface.sendMessage 乐观上屏前 await 该调用，服务端忙时往返可感知）。

**设计**:
- 缓存值三态：`string`=已缓存 key、`null`=已确认无 key（服务端 miss 返回 200 `{value:null}`）、`undefined`=未缓存。
- 模块级 Map + in-flight Promise 表：同 provider 并发 miss 只发一次 load；load 失败不缓存（finally 清理，允许重试）。
- 模块级单例而非 backend 实例字段：全局 AppStorage 会被多处 `initializePiStorage` 重建。
- 失效路径：backend set/delete/clear 写穿、备份导入（`components/settings/tabs/BackupSettingsTab.tsx` 绕过 backend 直写服务端，成功后统一 `clearProviderKeysCache` + 广播）、跨标签 `BroadcastChannel('quickforge-sync')` `provider-keys-changed`（与 `useCrossTabSync` 共用频道、sourceTabId 自忽略、未知类型互相安全忽略）。
- 通道惰性建立（首次产生缓存项或广播时）而非 import 期：Node 测试环境未关闭通道会挂住事件循环（建立时 `unref` 兜底），且缓存为空时不存在跨标签过期窗口；BroadcastChannel 不可用/监听器异常静默降级。

### types.ts (82 行)

**类型**: `BackgroundTaskStatus`, `ChatScope`, `ProjectInfo`, `SkillsScope`, `SkillSummary`, `RestoredDraft`, `QuickForgeSessionMetadata`, `QuickForgeSessionData`, `BackgroundTask`

### utils.ts (6 行)

- `cn()` — Tailwind class 合并工具 (封装 `clsx` + `tailwind-merge`)

### browser-connection-diagnostics.ts (631 行)

**用途**: 浏览器侧连接池 / 请求排队诊断采集器。目标是在 DevTools 控制台执行 `window.__quickforgePerf()` 就能区分「浏览器 HTTP/1.1 同源 6 连接池耗尽（请求在浏览器侧排队）」与「服务端阻塞」。

- 排队时长取 `PerformanceResourceTiming` 的 `requestStart - startTime`（本地服务 DNS/connect 很短，近似 Stalled）；只统计同源或 `localhost`/`127.0.0.1` 请求（dev 下前端 :5176 与 API :32176 端口不同，按 hostname 命中）。
- `PerformanceObserver({ type: 'resource', buffered: true })` 采集；排队 ≥ 500ms 时 `console.warn`，同一 path 在 30s 节流窗口内只告警一次；节流表定期清理避免无界增长。
- 包装 `window.fetch`（幂等、保留 `this` 绑定、`stop()` 时还原）统计 in-flight 与常驻长连接数；仅当响应 `content-type` 为 `text/event-stream` / `application/x-ndjson` 时 `clone()` 并在后台读流观测结束，普通请求零额外开销，不影响调用方读取原响应体。
- `formatDiagnosticsReport()` 输出采集状态、in-flight / activeLongLived、最大排队、慢排队与慢请求 top、按路径聚合；`src/main.tsx` 在 `patchThinkingSelector` 之后启动采集并挂 `window.__quickforgePerf`（同时异步打印 `GET /api/diagnostics` 服务端快照）。
- `VITE_QUICKFORGE_DIAGNOSTICS=0` 时启动为 no-op，报告显示「采集：已关闭」。全部外部依赖（performance / PerformanceObserver / fetch / console / 计时器 / now / base）可注入单测。

### clipboard-polyfill.ts (51 行)

**用途**: 为非安全上下文 (HTTP) 提供剪贴板 API polyfill。当 `navigator.clipboard` 不可用时，回退到 `document.execCommand('copy')`。

### logger.ts (56 行)

**用途**: 前端日志工具，支持 `error`/`warn`/`info`/`debug` 级别，`debug` 级别需在 localStorage 设置 `quickforge_debug=1`。

### random-id.ts (19 行)

**用途**: 生成 UUID v4，优先使用 `crypto.randomUUID()`，回退到手动构造。

### tool-display-settings.ts

**用途**: 工具展示设置管理。支持“简洁 / 详细”模式：简洁模式隐藏原始 Tool JSON、显示简洁摘要；详细模式显示完整参数和 details。显示模式只控制 input/details 的内容渲染，不再控制工具卡细节的初始开合。折叠默认值（`components/chat/panel-decoration/process-folding.ts`，原最内层「调用了 N 项工具」工具摘要组已移除，工具行直接挂内层阶段 stage 的 step，失败计数并入阶段标题；纯思考段不渲染空「已执行」stage 头、思考块直接挂顶层组 body（`processSectionNeedsStage`），工具行到来后走全量重建正常包 stage）：顶层过程组默认展开值 = `isAgentStreaming`（只有正在流式的回合默认展开，历史回合默认收起，见导出的 `processGroupDefaultExpanded(isAgentStreaming)`）；内层阶段默认值由配置字段 `expandProcessStageByDefault`（默认 true=默认展开）控制（`processStageDefaultExpanded()` 读 `getCachedToolDisplaySettings()`，展开过程组后每条工具调用直接可见；正在流式的思考块不并入（设置默认收起的）内层 stage——`isStreamingThinkingItem` / `splitStreamingThinkingRuns`：stage 内 thinking-block 的来源 assistant bridge `isStreaming===true` 时不进 stage、改挂顶层组 body，不被 stage 收起态藏住流式思考行与尾行提示；stage 默认值只看设置、不再因流式思考强制展开（旧实现如此兜底会让每轮工具调用结束的组全量重建回落设置默认与下一轮流式思考往复开合，即用户反馈的「新的一轮消息来了之后展开又收缩」），流式结束组释放重建后该思考行自然收进 stage）。两层默认值均不覆盖 saved state（用户手动展开/收起后按回合记忆，`resolveProcessExpandedState`）；显示模式不再参与折叠默认值，仅控制单行摘要详细程度与 subagent 详情。工具卡细节（参数/输出）固定默认收起（`initiallyOpen={false}`，不随任何设置变化）：5 个工具渲染器（local-workspace / mcp / ask-user / todo-write / goal-report）的 `ToolDetails` 与无渲染器默认工具卡（`ToolMessage.tsx` 的 `DefaultToolCardBody`，params/output 亦收进 ToolDetails、header 只留一行工具名摘要）统一固定收起，`toolDetailsOpenMemory` 手动开合记忆优先；设置页「常规 → Tool 显示模式」的开关是「工具调用列表默认展开」（绑定 `expandProcessStageByDefault`，默认开；i18n `expandProcessStageByDefault` / `expandProcessStageByDefaultDescription`，en+zh），随 toolDisplayMode / showContextUsage 一起保存。可见性契约不变：禁止任何针对 `.thinking-header` 的 `display:none`（fail-visible，接管失败时宁可显示 React 原生「Thinking...」行）。上下文用量显示设置也保存在该配置中。归一化恒重建完整对象：`expandProcessStageByDefault` 非布尔回默认（true）；此前的详情默认展开配置字段与对应初始开合 helper 均已删除（白名单重建时与 legacy `showToolDetails` / `expandToolsByDefault` 一样被剥离）；`saveToolDisplaySettings` 入参放宽为 `Partial<ToolDisplaySettings>`。思考头交互契约（header 按钮在 React 侧 `onPointerDown` 优先切换、click 仅 `detail === 0` 生效；`decorateProcessThinkingBlocks` 对已接管 header 幂等 no-op，流式期间零 DOM churn）见 `docs/wiki/src/components/README.md`「思考头接管契约」条目。

### tool-execution-events.ts (163 行)

**用途**: 工具执行事件类型定义和消息合并工具。

**功能**:
- `QuickForgeToolTiming` / `ToolExecutionEvent` 类型
- `upsertMessage()` — 根据 `toolCallId` 合并或替换工具结果消息
- `toolStartEventWithPartialResult()` / `upsertToolResult()` — 在运行中工具结果里保留计时、`sessionId` 和 `toolCallId`，用于前端展示耗时和结束运行中的 `run_command`。
- `toolCallIdsWithoutToolResult()` — message_end 时返回 assistant 消息中尚无任何 toolResult（partial 或终态）的 toolCallId，由 `shared-server-agent.ts` / `server-agent.ts` 的 event.message 分支合入 pendingToolCalls，使 `tool_execution_*` 与 `message_end` 事件交错的中间帧仍按 pending 渲染（否则 pending=false + 无 result 会闪一帧 idle 灰点再被 tool_execution_start 拉回 running）；已有结果（成功或错误）的 id 一律排除，绝不把 done/error 行推回 running。

### system-notifications.ts

**用途**: 复用任务完成 SSE 事件，在 QuickForge 客户端仍运行时显示系统级通知。

- Web 优先通过 Service Worker registration 的 `showNotification()` 展示通知并携带会话 ID；非 Android 或无 SW 时才回退浏览器 `Notification` 构造器。Android 普通浏览器没有可用 SW registration 时不依赖构造器。
- Electron Desktop 通过 `contextIsolation + sandbox` preload 的窄桥接调用主进程 `Notification`；IPC 仅接受主窗口 main frame 的受限 payload，通知点击恢复、显示并聚焦窗口后复用会话打开事件。
- Capacitor Android 使用 `@capacitor/local-notifications`；设置页手动授权逻辑保持独立。
- Android 普通远程浏览器仅在 HTTPS 安全上下文中，于首次有效发送（含仅附件）同步标记并自动申请一次权限；需要 `Notification` 和 Service Worker API 可用。
- 通知偏好默认开启，用户显式关闭/开启分别持久化为 `0` / `1`；浏览器启动时不会自动申请权限，无权限时发送自然返回失败。任务终态在前台也会显示系统通知，仅“运行中”通知在页面可见且有焦点时被抑制，并通过任务 key 做短时跨标签去重。
- 浏览器通知点击由 Service Worker 聚焦同源窗口并发消息，页面监听消息后派发已有会话打开事件；原生通知点击也复用该会话打开逻辑。通知正文不包含完整 AI 输出。
- 不提供 Web Push/FCM；普通浏览器页面或原生 App 无法继续接收现有 SSE 时，不保证任务完成通知。

## 设置选项卡

设置页已全部自研为 React：`settings-tabs.ts` 组装 tab 定义，`react-settings-tabs.tsx` 按 tabKey 懒加载渲染，页面文件位于 `src/components/settings/tabs/`（Appearance / DefaultOptions / Memory / CustomProviders / Backup / ArchivedConversations / LanAccess / About / ProjectCommands / Hooks / Channels，共享 `shared.tsx` 与 `SettingsNumberInput.tsx`，下拉复用 `../SettingsSelect.tsx`）。无 `SettingsTab` 基类、无自定义元素渲染、无命令式桥（`extends SettingsTab` / `replaceChildren` / `createRoot` 由 `tests/frontend/settings-workspace-react.test.ts` 守卫）。Hooks 页（`HooksSettingsTab.tsx`）无总开关：说明文字收进标题行 `InfoTip`，提供 Hook 增删改与 Hook 级启停、编辑器内手动测试（`POST /api/hooks/test`，按 `{execution}` 信封解析）与执行记录分页列表（`GET /api/hooks/executions?limit=20&offset=`：20 条/页、页码/总数摘要与上下翻页，mount 加载、加载失败可重试且重试保留当前页，可展开失败输出；记录由 server 持久化，上限 300 条、重启后保留）；存量 `enabled: false` 在下次保存时重置为 `true`（server 引擎仍按该字段过滤）。

| 文件 | 用途 |
|------|------|
| `react-settings-tabs.tsx` | 设置页 React 内容分发：按 tabKey 懒加载 `components/settings/tabs/*` 与 Agent / Skills / MCP / 插件 / 定时任务 / 分享链接等管理页 |
| `share-client.ts` | 分享链接创建、列表、编辑（权限/密码/有效期）、停用、恢复、永久删除及状态推导 API |
| `custom-model-selector.ts` | 自定义模型选择器；主聊天通过可选无参设置回调显示桌面/移动底部入口，复用场景未传回调时保持隐藏 |

### message-utils.ts (95 行)

**用途**: 消息处理工具函数。

**功能**:
- `assistantText()` — 提取助手消息文本
- `rollbackStartIndexFromMessage()` — 计算回滚起点
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 剪贴板复制
- `generateTitle()` / `titleNeedsGeneration()` — 标题生成
