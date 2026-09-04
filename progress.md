# Progress

## 1.10.2 发布状态（2026-09-04）

- 已 bump 版本至 1.10.2，并完成当前 dev 分支待发布提交的文档整理。
- 发布前门禁已通过：`npm run test`（273 files / 2602 tests 全过）、`npm run lint`（0 error，1 个既有 warning）、`npm run build`（通过，含既有 KaTeX/chunk warnings）。
- qf-agent 测试夹具已最小修复：Windows `taskkill` mock 正确触发 exit，并在每个测试前恢复 real timers；定向测试 28/28 通过。
- runtime/offline 包已生成并复核，`package-offline/shawnstack-quickforge-1.10.2.tgz` 约 7.4 MB，包内版本为 1.10.2。
- Git 发布门禁尚未完成：需复核差异后进行 commit/tag/push；本次不执行 npm publish。
- 当前 `pinned-summary-draggable-capsule` needs-review feature 已按用户确认纳入本次发布，仍保留 needs-review 状态。

---

## Completed Feature：sidebar-collapse-zoom-width

- Feature: 桌面侧栏收缩态避免 resize 恢复展开宽度（sidebar-collapse-zoom-width，**已完成**）
- Status: done — 按已确认的最小方案修改源码、源码契约测试、ChatSidebar wiki 与状态文件，未 commit。
- 实现：`ChatSidebar.tsx` 的桌面 `window.resize` effect 现在在 `isMobile || !sidebarOpen` 时直接跳过，浏览器缩放或视口变化不会在收缩态调用 `finishResizing(nextWidth)` 写回展开宽度；`finishResizing()` 无 `finalWidth` 的收缩/移动清理路径调用 `asideRef.current?.style.removeProperty('width')`，避免遗留内联样式覆盖 `w-14`。展开拖拽、reset 与移动端语义不变。
- 测试：`tests/frontend/sidebar-section-order.test.ts` 新增源码契约，锁定 resize effect 的 `!sidebarOpen` 守卫、resize listener 与收缩清理的 `removeProperty('width')`。
- Docs：`docs/wiki/src/components/README.md` 的 ChatSidebar 条目补充桌面收缩态不会因 `window.resize`/浏览器缩放恢复宽度，以及清理遗留内联 width 的语义。
- Verification: 定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 20 tests 全过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` 通过；未 commit/tag/push，未修改生成产物。
- Boundaries: 不新增依赖，不触碰 `dist/`、`package-dist/`、`package-offline/`，不 commit/tag/push；工作区其他未提交改动保留。

---

## Completed Feature：manual-compact-adaptive-retention

- Feature: 手动 `/compact` 放宽并始终压缩全部当前可压缩历史。
- Status: done — 已按用户确认调整为固定全量压缩，核心源码、边界测试、server wiki 与状态文件已同步，未 commit。
- 实现：`server/agent-manager.mjs` 手动 compact 固定传入 `keepRecentTurns: 0` 和 `minSourceChars: 0`；`server/auto-compaction.mjs` 默认 `keepRecentTurns` 改为 `0`，设置归一化支持 `0-20`，并保留 keep=0 的 tailStart 与 in-place 支持；`src/lib/auto-compact-settings.ts` 与设置页同步默认值、`min=0` 和显式 0 输入；审批展示兜底同步为 0。
- 测试：`tests/server/auto-compaction.test.mjs` 覆盖 keep=0 时 tailStart 等于完整消息长度；`tests/server/conversation-compaction.test.mjs` 覆盖短历史在 `minSourceChars: 0` 下全量压缩且 recentTail 为空。
- Verification: 定向 Vitest 6 files / 39 tests 全部通过；相关 ESLint 通过；`node --check server/auto-compaction.mjs`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 与 `feature_list.json` JSON parse 均通过。build 仅有既有 KaTeX 字体与 chunk size 警告；未跑全量 test/lint。
- Boundaries: 不修改 `/summary`、自动压缩阈值/minSourceChars/确认/间隔与保护逻辑，仅将自动压缩 `keepRecentTurns` 默认值改为 0 并支持 0；不碰 dist/package-dist/package-offline，不新增依赖。

---

## Completed Feature：known-exception-i18n

- Feature: 已知代码异常文案国际化——展示层把 Request was aborted / AI stream 超时等已知英文异常映射为本地化文案（known-exception-i18n，**已完成**）
- Status: done — 用户实测「错误：Request was aborted.」英文原文后提出；源码、测试与 wiki 已同步；未 commit。
- 调研：错误正文来源为 pi-ai（各 provider abort 抛 'Request was aborted'、流异常结束两串）、server/ai-http-logger.mjs（'AI stream idle/total timeout after Nms'，idle 覆盖首事件/后续事件两档）、undici（'fetch failed'）、server-agent.ts（'Failed to send prompt: HTTP N' 兜底）。数据层必须保持英文原文——SQLite 持久化、客户端 appendAssistantErrorMessageOnce 去重、subagent trace 去重（错误原因与 trace 终态错误文本精确相等比较）都依赖原始字符串，翻译只能做展示层。
- 实现 ①：新增 `src/lib/error-messages.ts` `translateErrorMessage(message)`——规则表 trim + 忽略大小写 + 容忍句尾句点 + ms/status 参数捕获走 `t(key, params)` 插值；未匹配的动态正文（provider 错误、subagent 超时进度复合句）原样返回。
- 实现 ②（主聊天/Side Chat）：message-actions.ts `decorateAssistantErrorText` 在 decorate 周期把 pi-web-ui 错误红块（`div.bg-destructive/10`）内 `<strong>` 后动态文本改写为译文；保留原 strong 节点（前缀本地化/加粗）、`dataset.quickforgeErrorText` 幂等、语言切换下一轮自动收敛、译文===原文（未匹配）不改写 Lit 节点；对全部错误消息生效（含历史错误）。
- 实现 ③（subagent 卡）：local-tools.ts `renderSubagentRunBody` 错误原因卡（聊天摘要卡与 Inspector 详情共用）改 `translateErrorMessage(payload.errorMessage) || t('subagentErrorUnavailable')`。
- 实现 ④：i18n 中英成对 +7 key（errorRequestAborted「请求已中止。」、errorAiStreamIdleTimeout「模型连接空闲超时（{ms}ms 无响应）。」、errorAiStreamTotalTimeout、errorAnthropicStreamEnded、errorStreamNoFinishReason、errorFetchFailed「网络请求失败。」、errorSendPromptHttp「发送消息失败（HTTP {status}）。」）。服务端零改动、无新依赖、无视觉变化。
- Verification: 定向 vitest 6 files / 193 tests 全过（error-messages 新建：10 条映射断言含句点/大小写/空白容忍与插值、动态正文透传、空值、两处接线契约；message-actions/i18n-snapshot/subagent-run-detail/local-tools-lit-reactivity/server-agent 回归）；eslint 5 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量；未 commit。
- Boundaries: 数据层（errorMessage 字段、持久化、去重比较）保持英文原文，仅展示层翻译；OpenCode ACP 动态错误、provider 返回的动态错误正文、subagent 超时进度复合句不在映射表内（原样显示）；规则表按需追加（新增已知异常在 error-messages.ts 加一条规则 + i18n 一对 key 即可）。
- Next step: 真机冒烟：中文界面下停止生成/弱网超时/断网发送失败 → 错误红块分别显示「请求已中止。」「模型连接空闲超时（60000ms 无响应）。」「发送消息失败（HTTP xxx）。」；subagent 失败卡同理；英文界面文案不变；未知 provider 错误仍显示原文。

---

## Completed Feature：todo-summary-completed-icon-emerald

- Feature: 对话上方 Todo 摘要完成项图标改绿色——与置顶摘要 Todo 的 emerald 完成语义保持一致（todo-summary-completed-icon-emerald，**已完成**）
- Status: done —— 纯 CSS 颜色改动 + 测试契约，源码与测试已同步；未 commit。
- 起因：用户反馈「对话上方的 todo 显示，完成的 icon 换一下绿色的，和摘要的保持一致」。置顶摘要（GitToolsPinnedSummary 的 TodoStatusIcon）完成项是 CheckCircle2 + text-emerald-600，而对话上方 todo-write-summary 行级完成项图标是 var(--muted-foreground) 灰色。
- 实现：`src/index.css` 中 `.quickforge-todo-summary-item--completed .quickforge-todo-summary-status-icon` 的 color 由 muted 改为本组件「全部完成」圆环对勾的既有 emerald 配方（light `rgb(4 143 101)` / 新增 `html.dark` 变体 `rgb(110 231 183)`），复用 slash agent chip 语义色、不新增颜色体系，light 下与置顶摘要 emerald-600 视觉一致；完成项文字保持 muted + 删除线不变；ring-check 上方注释措辞同步为「绿色用于 Todo 完成语义（行级图标 + 圆环对勾）」。
- 测试：`tests/frontend/todo-write-renderer.test.ts` 既有 emerald 契约用例（改名 colors completed checks…）扩展断言行级完成项图标 light/dark 绿色。
- Verification: 定向 vitest todo-write-renderer 10 tests 全过；回归 todo-write-summary 26 + git-tools-pinned-summary 24 全过；eslint 测试文件 0 error（css 被 lint 配置忽略）；feature JSON parse 通过；npm run build 通过（仅既有 chunk size 警告）。纯 CSS 改动未跑 tsc/全量。
- Boundaries: 不改图标形状（同为圆圈打勾语义）、不改完成项文字样式、不触碰置顶摘要与 in_progress/pending 图标；无架构/公共入口变化，wiki 无需更新（纯视觉微调，components wiki 未描述行级图标颜色粒度）。
- Next step: 真机复核 light/dark 下对话上方 Todo 摘要展开列表的完成项绿色图标与置顶摘要一致。

---

## Completed Feature：error-continue-retry-button

- Feature: 错误旁「继续生成」按钮——会话末尾错误消息挂常显继续操作行，发送「继续」消息或重发未送达的原始消息（error-continue-retry-button，**已完成**）
- Status: done — 调研方案经用户两轮确认（改「重试=发继续用户消息」语义）后实现；源码、测试与 wiki 已同步；未 commit。
- 调研结论：错误渲染为消息末尾 `{role:'assistant', stopReason:'error', errorMessage, 空文本}`（pi-web-ui 红块），decorateMessages 空文本早退导致错误消息无任何操作行；既有 retryFromMessage/continueSession 会截断 user 消息之后全部内容（丢弃失败轮已完成工具进度、重放工具副作用）；pi-ai transform-messages 构建请求时整条跳过 error/aborted assistant 消息并为孤儿 toolCall 合成 toolResult，因此「发继续消息」链路安全且与用户手动打字恢复完全同路径。
- 实现 ①（UI）：message-actions.ts 终态错误（会话最后一条 display 消息为错误）挂常显弱化操作行——runIcon icon-only「继续生成」+ 时间戳，不依赖 hover（触屏可用），无 copy/fork；创建路径与 message-bottom 快路径均管理 continue 按钮存在性/禁用态；错误不再最后一条或门控关闭时整行移除（历史错误无操作行）。门控沿用 allowRetry(capabilities.retry，OpenCode 隐藏)/readOnly/historyActionsDisabled(Side Chat 禁用)/流式禁用。
- 实现 ②（接线）：ChatPanelHost `onContinueAfterError`——错误带 quickforgeFailedPrompt 时优先 `retryFailedPrompt`（重发原始消息），否则 `agent.prompt(t('errorContinueMessage'))` 发「继续」。
- 实现 ③（重发）：server-agent.ts prompt HTTP 失败合成错误时挂客户端专用 `quickforgeFailedPrompt`（原始未送达消息）；`retryFailedPrompt` 非流式时把 stash 的 capabilities/contextReferences 预置回 nextPrompt*（防空快照剥除 details）、移除错误消息后原样重发。i18n 中英 +2 key（errorContinueAction「继续生成」/errorContinueMessage「继续」）。服务端零改动、无新依赖、无新 CSS 段。
- 测试：新增 message-actions「error message continue action」10 用例（常显行+点击回传、幂等+禁用、历史错误、陈旧行、四门控、接线契约）+ server-agent 4 用例（stash 挂载、重发保真+错误条目移除、无 stash false、流式拒绝）；附带修复测试假 DOM harness 的 querySelectorAll 按选择器分组拼接 bug（改文档顺序，否则 user/assistant 交错与消息 index 错位）。
- Verification: 定向 vitest 3 files / 84 tests 全过；回归 3 files / 32 tests（capabilities/side-chat/message-queue）全过；eslint 6 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量 test/lint；未 commit。
- Boundaries: 仅终态错误显示按钮（历史错误无入口，避免误截断语义）；OpenCode（capabilities.retry=false）与 Side Chat（禁用）/readOnly（隐藏）沿用现有门控——prompt 语义理论上可支持 OpenCode，留作后续小迭代；错误消息不进 LLM 上下文（pi-ai 既有行为），模型只看到「继续」指令与失败前已完成的工作；消息队列在 agent_end error 后暂停的行为不变，继续按钮不自动恢复队列。
- Next step: 真机冒烟：模型流超时/断网杀后端产生错误 → 错误旁出现常显 ▶ 按钮 → 点击发出「继续」消息、模型从失败前进度接着做、错误消息保留在历史；断网时发送失败错误 → 点击重发原始消息（含插件/文件引用 chip 保真）；流式中按钮禁用；OpenCode 会话无按钮。

---

## Completed Feature：sidebar-drag-vertical-boundary

- Feature: 侧栏项目/任务拖拽纵向边界——区块标题拖拽 clamp 到可见视口，修复可无限向下拖动（sidebar-drag-vertical-boundary，**已完成**）
- Status: done — 源码、测试与 wiki 已同步；未 commit。
- 起因：用户反馈「项目和任务拖动的时候注意不能无限向下拖动」。调研确认：项目条目拖拽（restrictProjectDragToViewport，d07f18a）已夹取在 Projects 列表 ∩ 共享滚动视口内；但 72ac7e0 后加的「项目/任务」顶层区块标题拖拽（section DndContext）没有任何 modifier，`SortableSidebarSection` 仅锁横向、纵向 transform 无界——拖动区块标题可无限向下，正是用户看到的问题。
- 实现：`ChatSidebar.tsx` 新增 `sectionsDragBoundaryRef`（挂在区块排序容器 div）与 `sectionDragStartScrollTopRef`（`handleSectionDragStart` 记录起始 scrollTop），新 modifier `restrictSectionDragToViewport` 复用 `src/lib/project-drag-boundary.ts` 纯函数（可见交集 + 纵向 clamp + 滚动补偿），接入区块 DndContext `modifiers`；区块拖拽预览被夹取在区块排序容器与侧栏共享滚动视口的可见交集内，不能向下越出可见区、也不会上移越过 Pinned。dnd-kit `collisionRect` 使用 modifier 后 transform，落点同步受限；拖拽期间两区块本就临时折叠（dnd-kit `useRect` 对 active node 有 ResizeObserver，折叠后重新测量），换位所需位移远小于边界，排序语义不变。同时 `clampProjectDragTransform` fallback 收紧为 fail-closed：rect 缺失/退化（minY>maxY）时横向纵向同时锁定，项目条目与区块两条路径共用，边界未知时不再放任纵向无界拖动。
- 测试：`project-drag-boundary.test.ts` fallback 用例改写为 x/y 均锁 0；`sidebar-section-order.test.ts` 新增区块拖拽边界 wiring 契约（ref/起始 scrollTop/modifier 声明与 section DndContext 接线、autoScroll=false 保持）。
- Docs: `docs/wiki/src/components/README.md` ChatSidebar 两条（项目拖拽 fail-closed 说明 + 新增区块拖拽边界条目）；`docs/wiki/src/lib/README.md` 补 `project-drag-boundary.ts` 表格条目（此前索引缺失，现记录双消费方与 fail-closed 语义）。
- Verification: 定向 vitest 4 files / 37 tests 全过（project-drag-boundary 10、sidebar-section-order 19、mobile-fullscreen-adaptation 3、sidebar-new-chat-routing 5）；eslint 4 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX/chunk 警告）。未跑全量 test/lint。
- Boundaries: 未新增依赖；未改 dnd-kit 配置语义（section autoScroll 仍为 false、KeyboardSensor 不受影响）；未触碰生成产物；工作区其他未提交改动保留。
- Next step: 真机冒烟：拖动「项目」「任务」区块标题向下应停在可见区域底部；向上不越过 Pinned；松手换位正常；项目条目拖拽回归正常。

---

## Completed Feature：subagent-timeout-structured-progress

- Feature: Subagent 超时结构化输出——错误正文携带进度摘要 + details 注入持久化 toolResult，默认超时 60 分钟 → 2 小时（subagent-timeout-structured-progress，**已完成**）
- Status: done — 源码、测试与 wiki 已同步；未 commit。
- 起因：用户实测「错误原因: Subagent general timed out after 60 minutes.」后提出超时报错应把 AI 已完成的工作结构化输出（"大概知道做了什么"），同时要求子 Agent 默认超时改为 2 小时。调研确认：pi-agent-core 把抛错的 execute 收口为纯文本错误结果（details 为空对象），details 又不进 LLM 上下文（`omitDetailsForLlm`），因此父模型只见一行字；前端实时 SSE 路径有运行中快照回填兜底，但持久化 toolResult.details 为空，刷新/恢复后过程全部丢失。
- 实现 ①（错误正文）：`server/agent-manager.mjs` 超时错误保持既有首句 `Subagent X timed out after N minutes.`，其后追加 `Progress before timeout: N tool calls; still running: toolA; last assistant message: …`——工具计数取 beforeToolCall 累计值；被中断工具由 pendingToolCalls（toolCallId 集合）× 消息历史 assistant toolCall 块求交集（与前端 currentSubagentToolSummaries 同一算法，新函数 pendingSubagentToolNames）；最后一条 assistant 文本经 lastAssistantText 提取、压缩空白并截断 600 字符（SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT），无内容时省略分句。
- 实现 ②（details 注入）：runSubagent 抛错前把 `quickforgeSubagentDetails`（与成功终态同构 + `timedOut:true` + toolCallId，messages 全量）挂到 error 上；`wrapSubagentToolDefinition.execute` catch 后按 toolCallId 存入模块级 stash（即取即删 + 6h TTL 兜底清理）；主 Agent 构造点新增 `afterToolCall`（仅 isError 且 run_subagent 时取回，返回 `{ details }`），错误 toolResult 因此携带完整过程持久化，刷新/恢复后 Inspector 可见。前端 `details.timedOut → error` 判定为既有预留逻辑，UI 侧零改动；isError、置顶摘要 ✗、SSE 协议不变。
- 实现 ③（2 小时）：SUBAGENT_DEFAULT_TIMEOUT_MS 与新增 SUBAGENT_MAX_TIMEOUT_MS（runSubagent clamp + 临时 subagent prompt 内 clamp 两处）同步 2 小时；内置 explore/general maxRuntimeMs、subagents.mjs markdown 回落、agent-profiles.mjs / agent-profile-files.mjs DEFAULT_MAX_RUNTIME_MS 一并上调；旧安装内置 markdown 由启动物化（全内容比对）自动重写。
- 测试：agent-manager.subagents 12 tests——既有超时用例改写为 2 小时默认 + 错误正文/quickforgeSubagentDetails/afterToolCall 注入·即取即删·非 run_subagent 早退断言；新增「有进度超时」用例（MockAgent hangAfterProgress 模式：真实驱动 beforeToolCall 计数、带未完成 toolCall 的 assistant 消息与 pending 集合）。前端 subagent-run-detail +2 契约：timedOut details 注入后 status=error、trace 保留、errorSource=output 不重复渲染 output 块；无 isError 时 details.timedOut 仍判 error。
- Verification: Revision 2 复验 2 files / 106 tests 全过（新增通用失败用例：failAfterProgress 模式驱动，正文不变/无标记/注入与即取即删；前端通用错误恢复契约）。此前 Revision 后复验 2 files / 104 tests 全过（父中止用例改写：新正文/quickforgeSubagentDetails.aborted/timedOut 未设置/注入与即取即删）；eslint 2 文件 0 error、node --check 通过。此前定向 vitest 5 files / 121 tests 全过（agent-manager.subagents 12、agent-profiles 4、agent-profile-files、subagents、subagent-run-detail 92）；回归 agent-manager.* 家族 9 files / 31 tests + routes/agent 16 tests 全过；eslint 6 个改动文件 0 error；node --check 4 个服务端模块通过；feature JSON parse、git diff --check 通过。未跑全量 test/lint/build。
- Revision（父运行中止复用）：`Subagent X aborted with parent run.` 首句不变，其后追加 `Progress before abort:` 同构摘要，details 以 `aborted:true` 标记走同一 stash/afterToolCall 注入——用户停止后错误 toolResult 同样持久化，下一回合模型可见部分进度、刷新后 Inspector 保留 trace（此前误判"父循环拆解后不可见"：toolResult 仍持久化并进入后续 LLM 上下文）。摘要分段抽为 subagentProgressSegments、终态 details 抽为 buildTerminalSubagentDetails 闭包，超时/父中止两分支共用；前端 `details.aborted → error` 判定与测试（subagent-run-detail :414）均为既有。
- Revision 2（通用失败全覆盖）：修复"只要报错就看不到 subagent 执行过程"——内层 catch 为所有未携带 details 的运行期失败统一挂 quickforgeSubagentDetails（同构终态、无 timedOut/aborted 标记），错误正文保持上游原文（前端 stripTerminalErrorFromTrace 依赖 errorMessage 与 trace 终态错误文本精确相等去重，改文本会破坏去重）；刷新/恢复后 Inspector trace 不再丢失。实时 SSE 路径的 previousPayload 合并兜底保留，错误 toolResult 现直接携带全量 details，两条路径一致。
- Boundaries: 外层失败（模型解析/工具创建/Agent 构造等 prompt 开始前）无进度可带，不挂 details；旧版本已持久化的空 details 错误 toolResult 无法回溯补全；日志仍只记 errorName 等元数据，符合 p0-subagent-observability 隐私边界；未新增依赖；未触碰生成产物。
- Notes: scheduled-tasks.mjs 的 `runtimeLimitMs`（定时任务会话运行上限，默认/上限仍 60 分钟）与 `run_command` 1 小时超时为独立语义，本 feature 未动，如需调整另行立项。
- Next step: 真机冒烟：长时间 subagent 触发超时（或调小 profile max-runtime-ms）→ 父 Agent 回复应能转述部分进度；聊天摘要卡「错误原因」显示进度摘要；刷新页面后 Inspector Subagent Tab 仍能看到完整 trace。父中止路径：运行中点停止 → 下一条消息父 Agent 能转述 subagent 中止前进度，刷新后 Inspector 同样保留 trace。

---

## Needs Review Feature：pinned-summary-draggable-capsule（普通任务置顶摘要一致性验收修订）

- Feature: 普通全局会话的非简单多步骤任务也应受 `todo_write` 通用计划规则指导，并在实际产生有效 Todo 后显示既有置顶摘要（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 最小修复系统提示词作用域与契约测试；本次修订已纳入提交。
- 根因与修复：普通 global 会话实际具备 `todo_write`，但 `server/system-prompt.mjs` 的通用规则误置于 `For project tasks:` 之下。现仅将该规则移到项目任务专属段之前，使所有具备工具的非简单多步骤任务适用；`For project tasks:` 内其他规则及工具权限不变。
- UI 边界：`App.tsx` / `GitToolsPinnedSummary.tsx` 继续按 Todo、Git、Subagent 实际内容驱动挂载；无有效内容时不显示入口，不实现常驻空摘要。
- 测试：`tests/server/system-prompt.test.mjs` 不只断言文案存在，而是同时锁定规则索引早于 `For project tasks:`、项目任务段内不含该规则、全文仅出现一次。
- Docs: `docs/wiki/server/README.md` 记录系统提示词作用域；`docs/wiki/src/components/README.md` 明确通用计划规则与内容驱动 UI 空态边界；无新视觉模式，`DESIGN_LANGUAGE.md` 无需更新。
- Verification: `npx vitest run tests/server/system-prompt.test.mjs` → 1 file / 7 tests 全过；`npx eslint server/system-prompt.mjs tests/server/system-prompt.test.mjs`、`node --check server/system-prompt.mjs`、`feature_list.json` JSON parse、`git diff --check` 全过。
- Boundaries: 未改前端源码/契约，故无需前端测试；未新增依赖，未触碰生成产物；已清理本轮临时未跟踪文件。
- Next step: 真机用普通全局会话发起非简单多步骤任务，确认 Agent 维护 Todo 后既有置顶摘要出现；无 Todo 内容时入口仍不常驻。通过前保持 needs-review。

---

## Completed Feature：diff-display-optimization（最终视觉收口）

- Feature: 对话区 `write_file` / `edit_file` 与 OpenCode Diff 改为更简洁的摘要和正文（diff-display-optimization，**已完成**）
- Status: done — 用户在「平衡精简」基础上继续确认：`+N/−N` 需要颜色区分、正文使用单列智能行号、减少说明性文字；源码、测试、Wiki 与状态文件已同步；未 commit。
- 摘要：删除滚动数字里程计、自定义元素和动画；静态 `+N` 绿色、`−N` 红色，仅文字着色且默认可见，无 badge/背景/边框。running count-only partial 可显示统计，但无完整 `text` 时不渲染正文。
- 正文：删除重复标题、路径、统计 chip 与字符级 token/LCS/`<mark>`；行号收敛为单列智能显示（删除行取旧行号，新增行取新行号，上下文取新行号），共享 grid 收敛为“行号 + 代码”两列，继续保留长行横向背景、浅色整行增删背景和 `display: contents`。hunk gap 可见内容仅显示 `⋯`。
- 状态语义：短文案为“新文件 / 已截断 / 无变化”；新建空文件同时显示新文件与无变化。截断尾标记只在 `details.truncated === true` 时移除，合法正文末行即使等于 marker 也不会误删。
- OpenCode：支持 raw 新文件文本与无 hunk pseudo-unified；raw 保留首字符、行号从 1 开始。服务端统一 CRLF/CR，修正尾随换行计数、相同内容 `0/0 + text:''`，真实超限时设置 `truncated:true`；临时测试 helper 未导出，不扩大公共接口。
- Files: `src/lib/local-tools.ts`、`src/lib/diff-view.ts`、`src/index.css`、`src/lib/i18n.ts`、`server/opencode-acp-agent.mjs`、`tests/frontend/diff-view.test.ts`、`tests/server/opencode-acp-agent.test.mjs`、`docs/wiki/src/lib/README.md`；删除 `src/lib/diff-counter.ts` 与 `tests/frontend/diff-counter.test.ts`。
- Verification: 此前全量 `npm run test` → 272 files / 2559 tests 全过；本轮最终视觉收口定向 Vitest 5 files / 119 tests 全过；定向 ESLint 4 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings。
- Boundaries: 未改通用“过程 → 工具组”折叠；未新增依赖；未提交/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。工作区其他 feature 的未提交改动完整保留。
- Docs: 当前模块行为已同步 `docs/wiki/src/lib/README.md`；`design-mockups/diff-display-optimization.html` 保留为历史方案对照，不作为当前规格，故未同步重绘。
- Next step: 建议真机复核 light/dark 下 edit、write 新文件、空文件、长行横向滚动与 OpenCode raw/pseudo-unified；无代码 blocker。

---

## Needs Review Feature：pinned-summary-draggable-capsule（desktop stay + 向下展开）

- Feature: GitToolsPinnedSummary desktop 外点/Escape 保持当前形态，显式 Minimize 才进入 capsule；capsule→panel 从同一 top 向下展开（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 源码、纯函数/契约测试和 wiki 已更新；未 commit。
- 状态转换：desktop panel/capsule 点击外部均 stay；desktop Escape 不安装摘要级 listener，因此无操作且不 preventDefault/stopPropagation。`minimizeDesktopPanel` 只由 panel 标题栏显式 Minimize 调用；capsule 主体打开 panel；panel/capsule 的 X 与顶部 List 完全关闭。mobile/mobileShell 继续 List + fixed panel，外点/Escape/X 关闭，无 capsule/minimize。branch menu 不再因摘要 outside 分支改变 panel/capsule，本轮未新增嵌套菜单 dismiss。
- 向下布局：`pinned-summary-drag.ts` 新增纯函数 `resolvePinnedSummaryLayout` 和具名常量 `PINNED_SUMMARY_PANEL_MIN_HEIGHT=180` / viewport inset 12。panel 优先保持当前 y，把 `viewportHeight - 12 - y` 作为动态 `panelMaxHeight`，复用 panel flex + 内容 `overflow-y-auto`；不再用整屏 panel 自然高度把 y 向上 clamp。仅当下方不足 180px 时向上移到刚好容纳最小高度；viewport 本身更矮时使用全部安全区域。首次定位、panel/capsule 形态切换、window resize、drag 过程/结束与 Inspector resume 复用同一策略；conversation header 默认锚点仍只在首次无位置时读取。
- 尺寸/动画：动态 max-height 通过 `--quickforge-pinned-summary-panel-max-height` 传入且只在 panel mode 更新/消费；`ResizeObserver` 继续读 offset 布局尺寸，panel 展开态用 `scrollHeight + (offsetHeight - clientHeight)` 记录含边框的自然高度，避免 2px morph 误差。observer 在拖动中以 `dragRef.current.current` 而非旧 `positionRef` 解析布局，拖动跨边界、结束/取消后统一由 `finishDrag` 收敛，不会把 panel max-height 回写到起点或令 position/capsule 回归。删除无效 `height: min(max-content, ...)`，依赖 auto + max-height 与 widget 高度变量。panel 内容区始终 `overflow-y-auto overscroll-contain`，branch menu 改在受限内容区内向下展开、宽度随 panel、带 viewport 约束的 max-height/自身滚动，不再为了菜单把普通内容切为 overflow-visible。panel/capsule 子层 `transform-origin: top right`；width/height 220ms 与 reduced-motion 保留。设计 mockup 为历史稿且与本轮语义差异较大，未做小修，wiki 明确源码为准；DESIGN_LANGUAGE 无需更新（仅修正既有几何/交互，无新视觉模式）。
- 图标决策：按已确认的设计原型推荐 B，将 capsule 主体末端展开提示由 `ChevronUp` 改为 `Maximize2`，与 panel 标题栏既有 `Minimize2` 配对。`Maximize2` 放在主体 button 内约 28px 的透明圆形视觉槽中（`aria-hidden`，不是独立 button），默认弱化，仅在主体 hover/focus 时以现有 `group-*` Tailwind 克制增强；顶部 `List`、独立 `X`、点击/拖动/关闭逻辑均不变，无新增 CSS 模式。
- Regression boundaries: Inspector suspension/resume、160ms closing timer、pointer capture/window listeners/body userSelect/rAF cleanup、header 首次锚点、移动端 overlay 行为保持。
- Verification: 图标终审后定向 `npx vitest run tests/frontend/git-tools-pinned-summary.test.ts` → 24 tests 全过（契约锁定 capsule `Maximize2` + panel `Minimize2`、约 28px 非 button/`aria-hidden` 视觉槽、独立 X 与无 `ChevronUp` 残留）；定向 ESLint 2 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。此前终审修复 5 files / 52 tests 与定向 ESLint 4 文件结果继续有效；build 仅既有 KaTeX 字体与 chunk size warnings，`git status` 确认生成产物无状态变化。
- Boundaries: 未新增依赖、未提交/tag/push、未手改生成产物；工作区其他 OOM 等未提交修改完整保留。
- Next step: 完成最终门禁后真机复核 desktop panel/capsule 外点与 Escape 均不变、Minimize 唯一收缩、capsule 展开 top 不上浮且内容在下方空间滚动；通过前保持 needs-review。

---

## Needs Review Feature：pinned-summary-draggable-capsule（首次 header 锚点调整）

- Feature: GitToolsPinnedSummary 无历史位置时改以主对话 header 为首次 desktop 锚点（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 最小源码、纯函数测试、契约测试和文档已更新；未 commit。
- 实现：`App.tsx` 在主对话 `<header>` 增加稳定 `conversationHeaderRef: RefObject<HTMLElement | null>`，通过 `initialAnchorRef` 传给 `GitToolsPinnedSummary`；无 `querySelector` 或 Tailwind selector。`pinned-summary-drag.ts` 新增 `resolvePinnedSummaryInitialPosition` 与显式常量 `PINNED_SUMMARY_INITIAL_GAP=10`、`PINNED_SUMMARY_INITIAL_RIGHT_INSET=12`：仅 desktop 且 `positionRef.current` 尚不存在的首次定位读取 header rect，坐标为 `y = ceil(header.bottom) + 10px`、`x = header.right - targetWidth - 12px`；header 不可用时先回退 toolbar root rect，toolbar root 也不可用时再回退 widget rect，最终继续走 `clampPinnedSummaryPosition` 的 12px viewport 安全区。
- 生命周期边界：用户拖动后、panel/capsule 切换、window resize、Inspector suspend/resume 都只 clamp 现有 position，不重读 header；mobile/mobileShell 的 List + fixed panel 不变。实现不含 28/32/56 titlebar 定位常量，真实 header rect 自然适配浏览器/Electron、字号与侧栏宽度。
- 测试：`pinned-summary-drag.test.ts` 真实测试 bottom+gap/right inset 与传入 fallback rect；`git-tools-pinned-summary.test.ts` 锁定 header ref 接线、conversation header → toolbar root → widget rect 回退顺序、仅初始分支读一次、无 querySelector/28/32/56 定位常量、Inspector 恢复不重锚。
- Docs: `docs/wiki/src/components/README.md` 两处与 `docs/wiki/src/lib/README.md` 同步；复用既有视觉模式，不改 DESIGN_LANGUAGE。
- Verification: 定向 Vitest 5 files / 48 tests 全过（pinned-summary-drag 8、git-tools-pinned-summary 24、workspace Inspector request/width 与 mobile fullscreen 回归 16）；定向 ESLint 5 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings，生成产物无 git 状态变化。本次 fallback 措辞收尾另跑相关 Vitest 2 files / 32 tests、feature JSON parse、`git diff --check` 全过；按要求未再次 build。
- Boundaries: 未新增依赖、未持久化位置、未触碰 `dist/`/`package-dist/`/`package-offline/`、未 commit；工作区其他 OOM 等未提交改动完整保留。
- Next step: 真机复核首次打开 panel 与首次缩为 capsule 均在对话 header 下方、主内容右侧内缩且不遮顶部栏；通过后再标 done。

## Completed Feature：browser-oom-first-aid

- Feature: 浏览器渲染进程 OOM 第一步止血——IndexedDbCache 去全量序列化/物化 + subagent 运行期 trace 截尾（browser-oom-first-aid，**已完成**）
- Status: done — 用户确认"页面一直开着导致 OOM"发生在浏览器渲染进程；三路 explore 调研（前端/服务端/Electron）+ 两路补充审计（pi-web-ui message-list 内部实现、单条消息体积链路）定位三层放大后，用户决策"两步走：先零体验风险止血，再做体验无损的窗口化"；本轮完成第一步。
- 根因结论（大白话版见 oom-plain-words.svg）：无典型泄漏，是设计上的无界——消息/工具记录只进不出 + DOM 无窗口化全量渲染（ChatPanelHost.tsx:600 enabled:false 禁用了已实现的窗口化，pi-web-ui MessageList 无原生虚拟化）+ 同一内容多份驻留（messages 数组 + code-block base64 属性/hljs span 树 3-5× + IndexedDB 快照 + subagent store 快照）；放大器为 session-message-cache 每 1.5s flush 的 estimateBytes 全量 JSON.stringify 与 evictIfNeeded getAll 全量物化（~40 会话快照），以及 run_subagent trace 每 150ms 全量 details.messages 重发（O(N²)）。
- 实现 ①：src/lib/indexeddb-cache.ts estimateBytes 改递归粗估（string length+2 / number 8 / 布尔空 4 / 节点 +2 键 +1，深度 16 + seen 防循环回溯删除，异常兜底 0；80 字符串估值 82>60 保住 maxBytes=120 测试口径）；新增实例私有 metaIndex（null 起步）：put 成功后可选链更新、首次 evict 单次 getAll 以 store 重建此后纯内存、get lastUsed 写回成功才同步、delete/clear 维护、非数组容错重试；磁盘格式/LRU 纯函数/API/schema 零改动。
- 实现 ②：server/agent-manager.mjs 新增 SUBAGENT_TRACE_MESSAGES_LIMIT=50，emitSubagentTrace 的 details.messages 截尾 slice(-50) + messagesTotal 总数（同一字面量同一 latestMessages 引用，无口径分裂；Array.isArray 防御），覆盖节流补发/工具边界/finally 全部 update 路径；终态 toolResult（:1799）保持全量；updateRuntimeToolExecution/persist/SSE 转发未动。explore 复核确认前端 update 消费方全部只依赖尾部（traceMessages 过滤、跑马灯尾部 chunk、终态判定逆向扫描），运行中 Inspector 最近 50 条滚动窗、结束全量恢复，体验无损；唯一可感知差异是运行中刷新恢复的 running 快照只含尾部 50 条。
- Wiki: docs/wiki/src/lib/README.md（subagent-run-detail 截尾语义）与 docs/wiki/server/README.md（run_subagent partial trace）同步；纯数据层改动无 UI/视觉变化，DESIGN_LANGUAGE 无需更新。
- Verification: 定向 vitest 5 files / 47 tests 全过（indexeddb-cache 15 含新 2：getAllCallCount===1、冷启动重建淘汰；agent-manager.subagents 11 含新 1：真实驱动 MockAgent 61 条消息，窗口 50/total 61/首元素 trace-message-11/终态全量 61）；ESLint 4 文件 0 问题；node --check；tsc -b；git diff --check；feature JSON parse。explore 独立复核 26/26 复跑通过。
- Boundaries: 未跑全量 test/lint/build；未 commit；未触碰 dist/、package-dist/、package-offline/；未新增依赖；多 tab 并发写缓存依赖现有 Web Locks 单窗口守卫（与改动前等价）；三张分析 SVG（oom-analysis-diagram/oom-browser-renderer/oom-plain-words）为调研产物一并列档。
- Next step: 第二步"智能货架"（恢复消息窗口化 + turn 导航/跳转适配）另行立项，需先 explore 调研 windowed-messages.ts 能力边界与 turn navigation/decorate/process-folding 对全量 DOM 的依赖面；建议真机长会话+长 subagent 运行观察渲染进程内存曲线确认止血效果。

## Completed Feature：project-picker-mkdir-and-roots

- Feature: 项目目录选择器移除 QuickForge 快捷入口并新增「新建目录」功能（project-picker-mkdir-and-roots，**已完成**）
- Status: done — 用户确认两项设计决策：新建目录交互为「当前路径行右侧按钮 + 列表顶部内联输入，成功后直接进入新目录」；mkdir 端点不加 local-only 守卫（与 POST /api/project/path 同性质，Android 远程客户端可用）。
- 实现：`server/routes/filesystem.mjs` 删除 `addRoot('QuickForge', projectRoot)`（projectRoot 保留为 `_activeWorkspaceRoot` 默认值）；提取 `isPathWithinRoots` 纯函数与 `getAllowedRootPaths()`（roots + home 兜底）供 directories 与新端点共用；新增 `POST /api/filesystem/mkdir`——名称校验（禁路径分隔符/`.`/`..`/`\0`/空白 → 400）、parentPath 缺失 400、越界白名单 403、父目录不存在映射 404（assertDirectory 原生 400 语义未动，仅本端点内映射）、EEXIST 409、EACCES/EPERM 403，`fs.mkdir` recursive:false。前端 `project-directory-picker.tsx`：路径行右侧 FolderPlus「新建目录」按钮（sm 以下 icon-only），点击在列表顶部插入内联输入 form（autoFocus、Enter 提交、Esc 关闭清空），成功 `loadDirectory(新路径)` 进入，失败保留输入行 + error 区提示；`creatingFolder` 禁用传播覆盖目录行/parent 行/新建/取消/选择/Escape 关弹窗/遮罩点击；创建中文案用专用 `creatingDirectory`。i18n 中英成对 +4 key。wiki：server/routes filesystem 小节修正 `list`→`directories` 过时端点并补 mkdir 与 roots 说明、src/README picker 条目补能力描述。
- Verification: 定向 vitest 2 files / 21 tests（新 server 12 + 新 frontend 契约 9）全过；定向 ESLint 5 文件 0 error；`node --check`；`npx tsc -b --pretty false`；`git diff --check` 全过。未跑全量 test/lint/build；未 commit。
- Boundaries: 未加 local-only 守卫（用户决策）；allowedRoots 白名单与 directories 共用同一逻辑；不触碰 dist/package-dist/package-offline；工作区其他未提交改动（pinned-summary 等）与本 feature 无关未触碰。
- Next step: 真机冒烟：打开选择项目目录确认快捷入口无 QuickForge；在任意目录点「新建目录」输入名称回车 → 直接进入新目录；重名/非法名/失败时输入行保留并显示错误；创建期间全部控件禁用、Esc/遮罩不关弹窗。

## Completed Feature：pinned-summary-draggable-capsule

- Feature: GitToolsPinnedSummary 顶部 List 常驻、桌面 closed/capsule/panel 三态浮动摘要，并在右侧 WorkspaceInspector 往返时恢复状态和位置（pinned-summary-draggable-capsule，**已完成**）
- Status: done — 已实现真实桌面右侧栏暂停/恢复；用户真机复核验收矩阵通过；未 commit。
- Inspector 往返：App 使用与 `WorkspaceInspector` 一致的 `(min-width: 1024px)`，以 `canSuspendPinnedSummaryOnInspectorOpen` 表达“未来打开 Inspector 是否具备 desktop sidebar suspension/preserve 能力”；仅 `workspaceInspectorOpen && capability` 时保持 `GitToolsPinnedSummary` 挂载并传 `suspended`。`<1024px` 和 `mobileShell` 仍按原条件卸载，保持移动端/全屏 overlay 行为。`suspended` 保留 panel/capsule、position、Todo 展开和智能体折叠。
- Inspector 打开分支：PanelRight 直接按钮、Git Changes 与智能体入口统一按 `canSuspendPinnedSummaryOnInspectorOpen` 分支；真实桌面右侧栏保留 panel，`<1024px`/`mobileShell` overlay 路径在 `setWorkspaceInspectorOpen(true)` 前先 `setGitToolsExpanded(false)`，关闭 Inspector 后摘要不自动重开。PanelRight 关闭分支不额外修改 summary；Commit/Push 始终先关闭。
- 真隐藏与副作用暂停：toolbar root 和 desktop fixed widget 同时使用 `hidden` class/属性、`inert`、`aria-hidden`，不进入布局、Tab 或辅助技术，也不遮挡 Inspector。暂停时不注册 outside pointerdown/Escape、resize/clamp、ResizeObserver/形态定位；进入暂停只结束 drag，清 window pointer listeners、capture、body userSelect、drag/responsive rAF，关闭 branch menu 与 pending focus。不会取消已代表用户明确关闭意图的 160ms close timer，也不使用可被 cleanup 取消的 rAF 去归一化 closing/mounted；timer 在隐藏期间自然完成 `closed => unmounted`。组件最终 unmount 时既有 cleanup 仍会清 timer；不清 position/capsule/expanded，不自动回焦。
- 恢复 clamp：`suspended true→false` 时按当前 `desktopMode` 的 `desktopPanelRef` / `capsuleRef` 目标布局尺寸（offsetWidth/offsetHeight，必要时 rect fallback）对原 position 重新 `clampPinnedSummaryPosition`，维持 12px 安全区；视口未变化通常原位，变化后仅夹取，不调用 openDesktopPanel/minimizeDesktopPanel、不抢焦点。
- 既有三态与拖动保持：desktop capsule 外点 stay、panel 外点 minimize、X close；pointerdown 后由 window 跟踪同 pointerId，越过 4px 才 capture/禁选/suppress click；finish/cancel/暂停/响应式降级/unmount 统一清理。移动端/mobileShell 仍 List + fixed panel，无 capsule/拖动/缩小。
- 测试边界：`pinned-summary-drag.test.ts` 是真实纯函数测试，覆盖 desktop/窄屏/mobileShell suspension 判定，以及以“未来可 suspend/preserve capability”为参数的 desktop preserve vs overlay close 分支，并继续覆盖 clamp/outside/4px threshold。`git-tools-pinned-summary.test.ts` 是源码契约测试，锁定 PanelRight 打开分支 desktop preserve/mobile close、关闭分支不改 summary、摘要 action 条件接线、hidden/inert/aria-hidden、suspension 不清 close timer/不归一化 closing/mounted、unmount 仍清 timer、side-effect gating、marker、恢复 clamp 与 focus cleanup，不是 React 组件挂载/真实点击拖动测试。
- Docs: `docs/wiki/src/components/README.md` 两处同步 suspended 生命周期、Inspector action 与移动端边界；不涉及新视觉模式，DESIGN_LANGUAGE 无需改。
- Verification: Revision 3 最终收口后，相关 Vitest 8 files / 165 tests 全过（git-tools-pinned-summary 23、pinned-summary-drag 6、workspace inspector tabs/width/request、mobile fullscreen、side chat、subagent detail）；定向 ESLint（App/摘要组件/纯函数/两测试）0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check`、`git status` 全部通过/已检查。build 仅既有 KaTeX 字体与 chunk size warnings；status 仅列出本 feature 的 10 个预期文件，无生成产物。前轮完整门禁记录保留：npm run test → 271 files / 2530 passed + 1 既有失败（见 Notes）；npm run lint → 0 errors。
- Boundaries: 无 localStorage、无新增依赖、未把完整摘要状态提升到 App；未触碰生成产物；共享文件中的其他未提交 feature 片段保留。
- Notes: 全量 test 中 `tests/server/cloud/qf-agent-process.test.mjs`「keeps the restart budget bounded when newly isolated identities keep getting rejected」稳定失败，经单文件 stash 对照确认 HEAD 同样失败（该测试仅依赖 `qf-agent-process/auto-approval/network-proxy`，均无未提交改动），属既有失败、与本次无关，未修复未扩大范围；该文件历史另有定时器波动记录（见早前条目）。
- 真机验收矩阵：① closed→打开右栏→关闭仍 closed，且 closing 160ms 内打开右栏不会出现幽灵 capsule；② capsule 拖动后往返原位恢复；③ panel 拖动、Todo 展开/智能体折叠后往返原位与状态恢复；④ PanelRight 鼠标/键盘不预先 minimize；⑤ desktop Git Changes/Subagent 打开并关闭 Inspector 恢复 panel；⑥ `<1024px`/mobileShell 从摘要打开 Git Changes/Subagent 后关闭 Inspector 不自动重开摘要；⑦ Commit/Push 仍关闭；⑧隐藏期间 Escape/外点/resize 不改摘要；⑨拖动中打开 Inspector 后 window listeners/capture/body userSelect/rAF 完整清理；⑩视口变化后恢复保持 12px 安全区且不抢焦点。
- Next step: 无（用户复核通过，已标 done）。

## Completed Feature：p0-subagent-observability

- Feature: P0 Subagent 可观测性——生命周期、AI stream 关联与 SSE 失败日志（p0-subagent-observability，**已完成**）
- Status: done — 不修改 timeout 语义、UI 或 SSE 协议，仅增加最小结构化诊断链路。
- 实现：`run_subagent` execute 将真实 `toolCallId` 透传到 `runSubagent`；profile/task/workspace/model 等前置校验通过后立即生成 `subagentSessionId` 并记录 `started`，后续模型解析、工具创建、system prompt、Agent 构造或 prompt 任一失败均通过终态守卫只记录一个 `failed`；保留 `timeout_triggered`、`parent_aborted`、`settled_after_abort`、`completed` 既有语义。统一字段为 `parentSessionId`、`subagentSessionId`、`toolCallId`、`subagent`、`timeoutMs`、`durationMs`、`toolCalls`，abort 后 prompt settle 另记录 `waitAfterAbortMs`、`outcome`、`abortReason`。失败仅记录 outcome/errorName，不记录完整错误正文。Subagent 内部 AI stream 显式传 `quickforgeInternalLogContext`；`ai-http-logger` 只提取安全白名单关联字段，并在调用 provider `streamSimple` 前删除内部字段，retry/timeout WARN 可关联父/子 session 和 toolCall。session/global SSE 增连接级幂等守卫：同一连接多重 write/socket error 只记录一次 failure WARN，cleanup/release/end 只执行一次；正常 close 只 cleanup、不记录 failure；日志不含 event payload，SSE 帧格式不变。
- Verification: 定向 Vitest 三文件共 47 tests 全过（agent-manager.subagents 10，含真实调用 MockAgent `streamFn` 的内部日志上下文接线断言与 Agent 构造初始化失败 started→唯一 failed；ai-http-logger 21；routes/agent 16，含重复 error 只 WARN/cleanup/release/end 一次）；定向 ESLint 6 个相关源码/测试文件 0 error；`node --check` 三个服务端模块通过；`git diff --check` 通过。未跑全量 test/lint/build；未 commit。
- Boundaries: 不修 timeout/abort settle 语义；不记录 task/context/expectedOutput/messages/system prompt/tool args/results/profilePath/完整错误正文；无前端或协议改动，因此未更新 src/lib/routes Wiki；未触碰生成产物和已有 Subagent UI 改动。
- Next step: 可选真机通过 server log 按 toolCallId 串联 started→terminal 生命周期，并模拟断连确认单连接只产生一次 SSE WARN 与 cleanup。

## Completed Feature：subagent-running-icon-badge

- Feature: Subagent 运行指示器改为 Bot 图标+数量角标并修复菜单 hover 闪烁（subagent-running-icon-badge，**已完成**）
- Status: done — 用户确认「静态 Bot 图标 + 右上角 emerald 数量小角标（无动画）」设计后执行；同时修复流式输出期间悬停运行列表时界面闪烁。
- 实现：`subagent-running-indicator.ts` trigger 子结构由 spinner/count/label 三段改为 icon（模块级 `BOT_ICON_SVG`，与项目 lucide-react v1.11.0 Bot 及聊天 run_subagent 摘要卡 local-tools.ts:539 同款天线+方头+双耳+双眼 SVG，14×14，currentColor；Revision：初版误用 lucide 旧版 bot path，用户反馈后对齐）+ badge（textContent=数量）两段，保持按类名复用 DOM、缺失才重建，每轮仅更新 badge 数字；删除 `subagentRunningIndicatorTriggerLabel` 文案。菜单闪烁主修复：`renderMenuItems` 由每轮 `replaceChildren(heading, list)` 全量重建改为按 runId 就地 diff——heading/list 复用，Map<runId,item> 复用现有元素，仅 label/task 文本、elapsed dataset 与文本、aria-label 变化时更新，onclick 重绑，`insertBefore` 仅乱序时移动，消失 runId 删除；元素身份稳定使流式 decorate 不再打断 :hover。trigger 重建闪烁次修复：trigger 查不到而新建时不再 `removeSubagentRunningIndicatorMenu`，ownedMenu 归属同 panel 时同步 `__quickforgeOwnerTrigger` 为新 trigger 并继续 renderMenuItems，菜单保持打开；dismiss 外点判断与 positionMenu 定位改为读取菜单当前 ownerTrigger，不依赖被替换的旧 trigger 闭包引用。`index.css`：trigger 改 `position:relative; width:2rem; padding:0`，删 spinner（含 dark/reduced-motion 段）与 count 样式，新增 icon（flex 居中）与 badge（参照 `.quickforge-scroll-bottom-badge`：absolute -0.3rem、min-width/height 1.05rem、emerald 背景、2px var(--background) 描边、dark 变体 rgb(52 211 153)/rgb(5 46 31)）；移动端 @media 与 compact 段中 subagent label 隐藏/宽度收缩规则随 label 删除而移除，三控件共用胶囊基础规则保留。测试：更新 icon/badge 断言与 i18n 5 key/CSS badge 契约，新增 3 用例（菜单 item/heading 元素跨 decorate 身份保持、runId 增删与顺序、trigger 重建后菜单保留且 ownerTrigger 更新）。wiki components 两处条目同步。
- Verification: 定向 Vitest 3 files / 109 tests 全过；定向 ESLint（ts 文件）0 error、index.css 被 eslint 配置忽略属预期；`npx tsc -b --pretty false` ✓；`npm run build` ✓（仅既有 KaTeX/chunk 警告）；`feature_list.json` JSON parse ✓；`git diff --check` ✓。未跑全量 test/lint；未 commit。
- Boundaries: 静态图标无动画（用户确认）；badge 样式复用 scroll-bottom-badge 既有视觉模式，未新增设计语言；菜单仍为轻量名称/任务/耗时，详细过程在 Inspector；未修改后端、公共入口与生成产物。
- Revision（文案）：用户要求更简短且中文用「智能体」——TriggerAria/MenuTitle/MenuAria 改为「{count} 个智能体运行中」「智能体运行中 · {count}」「智能体运行中」，英文对应 '{count} agents running'/'Agents running · {count}'/'Agents running'；复验 vitest（含 i18n-language-snapshot）+ eslint + tsc 通过。
- Next step: 真机冒烟：并行 2-3 个 subagent 验证角标数字增减、Bot 图标 Light/Dark 视觉、流式输出期间 hover 菜单不闪、流式中触发 leftControls 重建后菜单不消失。

## Completed Feature：pinned-summary-subagent-sections

- Feature: 置顶执行摘要 Subagent 分组改版为「运行中 / 已结束 · N」简约双小节（pinned-summary-subagent-sections，**已完成**）
- Status: done — 用户确认双小节设计后执行：运行中小节默认展开，已结束小节默认折叠且标题行整行切换；已结束条数随标题展示。后续文案修订（保持国际化）：Subagent 分组标题 i18n 改为「智能体 / Agents」，Git 分组标题改为「Git 工具 / Git Tools」。
- 实现：`GitToolsPinnedSummary` 的 Subagent 分组重写为双小节：分组标题中英文统一「Subagent」；「运行中」小节无折叠、0 条隐藏，行用弱色 `Loader2 animate-spin` + 名称 + task 弱副行，不显示耗时；「已结束 · N」标题行整行 button 切换折叠（`aria-expanded`，ChevronRight/Down size-3.5 弱色），默认收起，关闭弹层的三条路径（外部点击/Escape、toggle、X）均恢复默认折叠、不持久化；已结束行保持 ✓/✗ + 名称 + 静态耗时（Bot fallback）+ task 副行，仍是先关浮层再打开 Inspector Subagent Tab；两组全空时整个分组隐藏，组件空态与 App 挂载条件均纳入运行中列表；分组顺序、分割线、`aria-labelledby` 不变；删除「最近优先」span。数据层新增 `extractRunningSubagentRuns()`，与 `extractLatestTerminalSubagentRuns`（API 不变）共用新抽的 `collectRunSubagentToolCalls` 收集器（按出现顺序 id→args，重复调用块天然去重），仅收集 pendingToolCalls 中的 run_subagent 调用并复用 `buildSubagentRunPayload(args, undefined, true, …)` 构建 running 载荷（canonicalToolCallId/runId=toolCallId，label/name/task 回落一致）；App 在终态列表旁新增 `pinnedSummaryRunningSubagentRuns`（同一 revision 订阅）传入组件；`openSubagentRun` 经 `requestWorkspaceInspector(kind=subagent)`，Inspector 已按 store 取 running 快照，无需适配。i18n：`pinnedSubagentsTitle` 改 Subagent，新增 `pinnedSubagentsRunningSection`/`pinnedSubagentsFinishedSection`，删 `pinnedRecentFirst`。
- Verification: 定向 Vitest 3 files / 113 tests 全过（git-tools-pinned-summary 11、subagent-run-detail 90 含新增 3、model-retry-notice 12）；定向 ESLint 6 文件 0 error；`npx tsc -b` ✓；`feature_list.json` JSON parse ✓；`git diff --check` ✓。docs/wiki/src/components/README.md 三处（L28/L95/L224）已同步双小节描述（实现时曾误判 wiki 无需同步，冒烟后修正）。未跑全量 test/lint/build；未 commit。
- Boundaries: 已结束小节沿用现有最近 3 项（`extractLatestTerminalSubagentRuns` 默认 limit）；运行中行不显示耗时/不加定时器，详细过程由 Inspector Tab 承担；运行中集合以当前消息分支 + pendingToolCalls 为准，pending 中的 run 即使消息流里残留旧 toolResult 也按运行中展示；折叠状态不持久化；未修改后端与生成产物。
- Next step: 用户复核双小节视觉与折叠交互；真机冒烟：运行中 subagent 出现/结束迁移到已结束、点击两种行打开 Inspector、弹层重开恢复折叠、两组全空时分组隐藏、中英文标题。

## Completed Feature：pinned-execution-summary-groups

- Feature: 右上角现有“置顶摘要”按 Git、任务清单、已结束 Subagent 分组显示（pinned-execution-summary-groups，**已完成**）
- Status: done — 用户确认修正版 `design-mockups/execution-summary-groups.html` 后要求执行；实现准确复用顶部工具栏现有 `GitToolsPinnedSummary`，未在 Composer 新建同类摘要。
- 实现：保留 36×36 `List` 触发器、外部点击/Escape/X 关闭和 Workspace Inspector 打开时隐藏的既有规则。挂载条件由“必须 Git 仓库”泛化为 Todo、最近终态 Subagent 或 Git 任一存在，因此非 Git 会话也可查看前两类内容。用户视觉修订后，展开浮层移除顶部总标题与描述，只保留 absolute 右上角 X；实际存在的分组按 Git → Todo → 已结束 Subagent 排列，首组无顶部 margin/分割线，后续组使用紧凑浅色 0.5px 分割线，标题行预留 X 空间；Git 标题中英文均为 `Git`。Todo 复用当前消息分支最新合法 TodoWrite 完整快照，默认 3 项并可展开全部；终态 Subagent 新增 `extractLatestTerminalSubagentRuns()`，仅扫描当前 agent messages，按 toolCallId 配对 assistant 调用与 toolResult，以 `pendingToolCalls` 排除运行中临时结果，复用 `buildSubagentRunPayload`，按终态 timestamp 最近优先、canonical ID 去重并取最近 3 项，不枚举全局 store。App 订阅当前 agent 的 tool/message 相关事件轻量刷新摘要；点击终态项先收起浮层，再打开 Workspace Inspector 详情 Tab。Todo 展开、Subagent 标题右侧“最近优先”、Git changes/branch/menu/commit-push 行为保持；移动端 fixed 全浮层滚动，分支菜单 top/max-height 按 Git 首位成对调整，桌面保持 overflow visible 防裁剪。i18n 中英同步。
- Verification: 用户视觉修订后定向 Vitest 4 files / 125 tests 全过（git-tools-pinned-summary、subagent-run-detail、todo-write-summary、mobile-fullscreen-adaptation）；定向 ESLint 0 error；`npx tsc -b --pretty false` ✓；`feature_list.json` JSON parse ✓；`git diff --check` ✓。按要求未运行 build，未跑全量 test/lint。
- Boundaries: 已结束 Subagent 只显示当前消息分支最近 3 项；运行中项继续留在 Composer 胶囊；任务“查看全部”只在浮层内展开，不跳转独立详情；Inspector 打开期间入口仍隐藏；未修改后端、公共协议或生成产物，未 commit。
- Next step: 真机冒烟：Git/非 Git 会话分别验证三组/单组；完成和失败 Subagent 排序与点击跳转；回滚或切换会话后无旧记录；移动端、Light/Dark、中英文及分支菜单不被裁剪。

## Completed Feature：subagent-running-indicator

- Feature: Composer「完全访问权限」旁显示当前会话运行中的 Subagent 数量，点击具体运行跳转 Workspace Inspector 详情 Tab（subagent-running-indicator，**已完成**）
- Status: done — 用户确认设计稿后要求执行。实现沿用既有 `subagentRunStore` 和 `quickforge:open-subagent-run` 跳转链路，不新增依赖或后端接口。
- 实现：新增 `panel-decoration/subagent-running-indicator.ts`。当前会话运行集合只遍历 `agent.state.pendingToolCalls`，再按 toolCallId 读取全局 store 并筛选 `status=running`，避免跨会话污染；`tool_execution_start/update/end` 后调度 editor 重装饰，终态立即移除。胶囊插在 access 后、plan 前，显示绿色 spinner、数量与「运行中」；重复装饰时复用现有 spinner/count/label DOM，仅更新数量和文字，避免 CSS 旋转动画被反复重启造成闪烁；0 项隐藏，移动端/容器 compact 时隐藏文字。点击后创建 body-level fixed 菜单（名称、任务、每秒耗时），支持 Composer 菜单互斥、外部点击/Escape 关闭、resize/scroll 重定位、DOM 重挂更新与卸载清理；点击项读取 store 最新 payload 后派发既有事件打开 Inspector Subagent Tab。Side Chat、readOnly、disabledControls 不显示。i18n 中英 +6 key，CSS 对齐现有 Composer 胶囊/弹层视觉并支持 reduced motion。
- Verification: 定向 Vitest 5 files / 111 tests 全过（新增 7，回归 104）；eslint 改动源码/测试 0 error；`npx tsc -b --pretty false` ✓；`npm run build` ✓（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` ✓。未跑全量 test/lint。
- Boundaries: 指示器仅表示父会话仍在 `pendingToolCalls` 中且 store 快照为 running 的运行；store 缺快照时宁可不显示。列表本次保持轻量（名称/任务/耗时），当前工具的详细过程仍在 Inspector。未修改后端与公共 store payload；未 commit。
- Next step: 真机冒烟：并行启动 2-3 个 subagent，确认 access 后出现数量；点击展开并打开不同 Inspector Tab；逐个完成后数量递减并在 0 时消失；侧栏压窄时仅显示 spinner+数量。

## Completed Feature：model-stream-safe-retry-policy

- Feature: 模型流安全重试策略——仅首个实质事件前透明重试，避免回复中途重复运行（model-stream-safe-retry-policy，**已完成**）
- Status: done — 用户真机反馈模型回复会“中途重复运行”。根因是上一版允许流已产出实质内容后仍因 idle 超时从零重建整条模型请求，导致生成/工具调用重复执行、内容重写与重复计费。用户决策改为安全优先：仅零实质内容阶段自动重试。
- 实现：`server/ai-provider-options.mjs` 将默认预算调整为首个实质事件 90s、已有内容 idle 180s、total 20min；`server/ai-http-logger.mjs` 将 `MAX_STREAM_RETRIES` 收紧为 2，并以 `!hasSubstantiveEvent` 作为透明重试硬门槛，已有实质内容后的 idle timeout 直接失败，不再自动重跑；保留首事件前重试进度与恢复上报。三份测试覆盖预算、最多 2 次零内容重试、已有内容不重试、恢复事件及前端源码契约；wiki server 与 src/components 同步策略和提示边界。
- Verification: 定向 `npx vitest run` 7 files / 60 tests 全过；定向 ESLint 0 error；`node --check server/ai-provider-options.mjs` 与 `server/ai-http-logger.mjs` 通过；`npx tsc -b` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size warnings）；`git diff --check` 通过。未跑全量 `npm run test` / `npm run lint`。
- Boundaries: 首事件前上游可能已开始处理但尚未返回，透明重试仍可能产生重复计费，无法完全消除；收到实质内容后若网络停滞会直接报 idle timeout，由用户决定是否重新发起；total timeout 仍不重试；Side Chat/后台任务既有展示边界不变；未 commit。
- Next step: 真机观察弱网、大上下文 prefill 与长工具回合：确认不再出现“中途重复运行”，同时关注 90s 首事件预算是否误杀、180s 已有内容 idle 是否合适。

## Completed Feature：subagent-running-indicator-design

- Feature: Composer「完全访问权限」旁显示 Subagent 运行数量，并从列表跳转 Inspector 详情 Tab 的 HTML 设计稿（subagent-running-indicator-design，**已完成设计**）
- Status: done — 用户确认位置为「完全访问权限」旁，跳转目标为 Workspace Inspector 详情 Tab。本轮只做设计稿，不修改功能源码。
- 设计：新增 `design-mockups/subagent-running-indicator.html` 自包含演示。Composer 控件顺序为「+ / 完全访问权限 / Subagent 运行胶囊 / 计划」；运行胶囊对齐现有 2rem、999px 胶囊视觉，显示绿色 spinner、数量和“运行中”文字；0 个运行时淡出隐藏，窄模式收缩为 spinner+数字。点击胶囊向上展开运行列表，展示 agent 名、任务摘要、当前工具跑马灯和递增耗时；点击列表项滑入模拟 Inspector 详情面板。工具栏支持 light/dark、中文/英文、0/1/2/3 数量及宽/窄切换，支持 `prefers-reduced-motion`。
- Verification: Node 检查必要结构、无外链资源、内嵌脚本语法通过；`git diff --check` 通过；Playwright 实测默认布局、弹层、运行项→Inspector、0 数量隐藏、Dark 主题与窄模式均正常。仅 HTML 设计稿，未跑 npm test/lint/build。
- Boundaries: 未实现运行数订阅/会话过滤/实际 `quickforge:open-subagent-run` 派发；页面内已注明实际实现时需调整 `panel-decoration/agent-access-menu.ts` 的 plan 排序逻辑，才能让新指示器紧贴 access 按钮。未修改架构或源码行为，docs/wiki 无需更新；未 commit。
- Next step: 用户复核设计稿；确认后另开实现阶段 feature，补运行中集合 API/会话作用域、Composer 装饰挂载、Inspector 跳转与测试。

## Completed Feature：sse-unreachable-tiered-notice

- Feature: 后端不可达提示分层升级——Tier1 琥珀双行行内提示（+立即重试）→ 持续 ≥30s 升级 Tier2 composer 上方常驻条（断开时长+恢复指引按环境排序），恢复态 restarted 显示 4s（sse-unreachable-tiered-notice，**已完成**）
- Status: done — 起因：用户实测「后端服务不可达（健康检查失败）/ 8s 后重试」后反馈交互不够友好。诊断：unreachable 复用最弱的灰色 spinner 样式（视觉层级错位）、无操作入口、滚动后离开视口、无恢复指引。用户确认方案 A（分层升级，design-mockups/unreachable-notice.html）+ 30s 阈值 + 指引按环境自动排序。
- 实现：`server-agent.ts` reconnecting 状态新增 `unreachableSince` 时间戳；`reconnect-notice.ts` Tier1 改琥珀双行（主行三角图标+标题+立即重试按钮，副行健康检查失败+倒计时），≥30s 自动让位 Tier2；新 `panel-decoration/unreachable-strip.ts` Tier2 常驻条（composer dock 前插入、滚动容器外恒可见、断开时长 45s/1m 05s 格式、恢复指引两行=环境对应动作+日志、展开状态 sync 重挂保留）；ChatPanelHost 仅主聊天挂载；index.css 复用 failed/persist-degraded 琥珀配方零新 token；i18n 中英 +8 key、删 1 个被取代 key。
- Revision（用户反馈「恢复指引文字太多」）：展开区由 5 行按环境排序改为 2 行（环境对应动作 + 日志），删除「自动重连」行与 sseUnreachableHelpAuto key，四条指引文案缩短；strip 的 helpRowOrder→helpRows 过滤逻辑、测试改过滤断言、mockup/wiki/feature_list 同步。
- Verification: 定向 vitest 3 files / 82 tests 全过（unreachable-strip 新建 12 例：阈值/无广播自动出现、时长格式、环境排序、展开记忆、destroy 清理）；eslint 9 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。
- Boundaries: Tier2 恢复时直接移除（无离场动画）；unreachableSince 缺失时行内提示不隐藏（防御边界）；Tier1 副行倒计时到 0 显示 0s（完整句式，与 Tier0 独立倒计时清空行为不同属有意）；Side Chat/分享页不挂（同现状）；未 commit。
- Next step: 真机冒烟：杀后端 → 几秒内 Tier1 琥珀双行+按钮 → 持续断开 30s 后升级 composer 常驻条（展开指引看环境排序）→ 重启后端 → 常驻条消失 + 绿「已重新连接 · 服务已重启」显示 4s；弱网（health 通）维持 n/10。

## Completed Feature：chat-compact-composer-on-narrow-chat-area

- Feature: 对话区被左右侧栏挤压变窄时 Composer 控件 icon-only 紧凑模式（chat-compact-composer-on-narrow-chat-area，**已完成**）
- Status: done — 起因：用户需求中间对话区被左右侧栏拖宽挤压变窄时（viewport 宽度不变，`@media` 视口查询不触发），Composer 输入框控件应收起文字只留 icon（复用移动端紧凑形态）。
- 实现：① `ChatPanelHost.tsx` 模块级常量 `CHAT_COMPACT_WIDTH_THRESHOLD=640`（控件行极限约 530px+余量）/`CHAT_COMPACT_WIDTH_RELEASE=672`（32px 滞回防拖动抖动），新增 useEffect 以 ResizeObserver（`typeof` 防御式检查，vitest node 环境无 ResizeObserver，先例 WorkspaceInspector matchMedia）监听宿主 div `contentRect` 宽度：<640 挂 `quickforge-chat-compact`、≥672 摘除、区间内保持现状。② `index.css` 在移动端 `@media (max-width:768px)` 块（:5318 结束）之后新增 `.quickforge-chat-panel-host.quickforge-chat-compact` 段（+68 行）：agent-access/model-trigger 照抄移动端规则（收 2rem、label/chevron 隐藏、span.ml-1 sr-only、thinking 徽标隐藏），并补齐移动端没有的 plan（`> span` 只隐藏无 class 文字 span，svg icon 专用 class 不受影响）、opencode-config（label+chevron 隐藏）、opencode-mode（label 隐藏，icon 来自 model-trigger::before）三控件同样收 2rem；三 class 选择器特异性高于 @media 内两 class 规则且两态值一致，移动端零回归；未改动 @media 块内任何规则。③ 新增 `tests/frontend/chat-compact-controls.test.ts`（9 用例源码契约：阈值常量/ResizeObserver 防御/classList add/remove 滞回分支/CSS 五控件覆盖/@media 既有规则回归守卫；ruleFor 前剥 CSS 注释、`:is()` 含逗号规则改精确文本断言）。④ wiki `src/components/README.md` panel-decoration 段补一条紧凑模式说明。
- Verification: 定向 vitest 8 files / 48 tests 全过（新 9 tests）；eslint 改动 2 文件 0 error；npx tsc -b ✓；npm run build ✓（仅既有 KaTeX 字体与 chunk size 警告）。未跑全量。
- Boundaries: + 按钮、send/stop 本就是 2rem 纯 icon 无需处理；side chat 复用同一宿主，窄面板下同样进入紧凑（合理行为）；宽度在 640-672 区间保持现状（滞回有意为之）；空态聊天（quickforge-chat-panel-empty-host）与常驻 composer 同一宿主子树，紧凑 class 同样生效；未 commit。
- Next step: 真机冒烟（拖宽左右侧栏把对话区压到 <640px 控件应收成 icon-only，拖回 ≥672px 恢复文字；移动端窄视口行为不变）。

## Completed Feature：workspace-inspector-dynamic-width

- Feature: Workspace Inspector 拖动宽度动态上限（workspace-inspector-dynamic-width，**已完成**）
- Status: done — 起因：用户需求右侧 Workspace Inspector 面板拖动范围更大。确认方案：最小 340 不变；上限改动态 max(340, min(1200, 视口宽*0.75))（参照 ChatSidebar getSidebarMaxWidth/clampSidebarWidth 模式）；超宽屏封顶 1200px；自动展开仍固定 640。
- 实现：`WorkspaceInspector.tsx` 常量区 MAX 640→1200，新增 RATIO=0.75、AUTO_EXPAND=640 与模块级 `getInspectorMaxWidth()`/`clampInspectorWidth()`；readPersistedInspectorWidth 与 resize() 拖动 clamp 走 clampInspectorWidth；expandInspectorToMax 改用 AUTO_EXPAND_WIDTH（行为不变 640）；全屏退出恢复 maxWidth、aside 行内 maxWidth（保持三元结构契约）、separator aria-valuemax 改 getInspectorMaxWidth()；新增 window resize 同步 effect（fullscreen/mobileOverlay 跳过，已存宽度自动夹回上限内）。新增 `tests/frontend/workspace-inspector-width-range.test.ts` 源码契约测试；wiki src/components README 同步宽度说明。Storage key 沿用 v2 不变。
- Verification: 定向 vitest workspace-inspector-width-range（新 6 tests）+ mobile-fullscreen-adaptation（3 tests）全过；workspace-inspector-tabs 回归 19 tests 过；eslint 改动 2 文件 0 error；tsc -b ✓；build ✓（仅既有警告）。未跑全量。
- Boundaries: 窄视口（mobileOverlay）/全屏模式不参与宽度 clamp（按现状全屏覆盖布局）；自动展开目标是固定 640 而非动态上限（保持既有行为）；localStorage 旧值无需迁移（读取时即被重新夹取）。
- Next step: 可选真机冒烟（宽屏拖到 >640px、窗口缩窄后宽度自动收缩、打开 reader/browser 仍展开到 640）。

## Completed Feature：browser-single-window-guard

- Feature: 浏览器严格单窗口守卫——Web Locks 抢锁，第二个窗口只显示拦截页并尽力聚焦已有窗口（browser-single-window-guard，**已完成**）
- Status: done — 起因：用户问「浏览器打开能否只允许开一个窗口？开多个 SSE 会堵塞的吧」。双 explore 并行调研澄清：服务端 SSE 是单进程 EventEmitter 广播（无锁无队列、每连接独立 res.write），**不存在服务端互相阻塞**；真实堵塞是浏览器 HTTP/1.1 同源 6 连接池被每窗口 2-4 条常驻长连接占满（channels/events + agents/events（生产同源，仅 dev 直连 32176 绕开）+ Side Chat NDJSON fetch + 设置页 channels-settings-tab.ts:179 额外再开一条 channels/events），普通 API 全部排队——与 git-status-connection-pool-guard 当年诊断同一机制。
- 用户决策：① Web Locks 方案；② 检测到第二窗口时尽力自动把已有窗口带到前台（浏览器安全模型禁止脚本聚焦非自己打开的窗口，改为由已有窗口收到 BroadcastChannel 通知后自行 `window.focus()` + 标题闪烁兜底）；③ 严格单窗口、不提供「在此窗口继续使用（接管）」逃生门，因此旧窗口永远正常运行、不存在让位场景。
- 实现：① `src/lib/window-guard.ts`（257 行）——`acquireAppWindowGuard`：`navigator.locks.request(LOCK, {ifAvailable:true}, cb)` 抢锁，持锁时回调 `await` 永不结算的 promise（锁持有到页面卸载自动释放），成功判定靠回调内 acquired 标志经 acquiredPromise 在 `Promise.race` 胜出（不依赖永不结算的 request promise）；ifAvailable 拿不到锁（cb 收到 lock 为 null、request promise 随即结算）→ 同窗口刷新竞态按 400ms×2 重试（共 3 次尝试）后才判 blocked；Web Locks/BroadcastChannel 任一不可用 → unsupported 降级放行。持锁后 `startWindowFocusResponder` 监听专用频道 `quickforge-window-guard`，收到 focus-request → `window.focus()` + 「● 」前缀标题闪烁 5s（800ms 交替，重复请求重置截止计时）；`requestExistingWindowFocus` 广播后立即 close。全部依赖可注入单测。② `src/components/WindowGuardNotice.tsx`：全屏拦截页（内联 SVG 不依赖 LucideProvider、t() 双语、复用 Button 与既有 token、不 import App、不发任何 /api）。③ `src/main.tsx`：渲染前 `await acquireAppWindowGuard()`，blocked 先自动广播一次 focus 请求再只渲染拦截页；granted/unsupported 原样渲染 App（SW 注册/错误兜底/补丁原位不动）。④ i18n 中英成对 3 key；i18n import 时以 `browserDefaultLanguage()` 同步初始化，blocked 场景 t() 安全可用。⑤ wiki 3 处同步。
- Verification: 定向 vitest window-guard 10 tests（6 行为 + 4 源码契约）主 Agent 复核通过；i18n 回归 3 文件 31 tests 全过；eslint 5 文件 0 error；tsc -b 通过；npm run build 通过（仅既有警告）。未跑全量。
- Boundaries: ① 拦截页语言用浏览器默认语言（i18n import 时同步初始化；用户在设置里选了与浏览器不同的语言时拦截页显示浏览器语言，3 条文案的小妥协，换来拦截页零 /api 请求）；② Electron（5177 独立源）/ Android 壳 / 隐身窗口 / 不同浏览器 profile 为独立锁空间，天然互不拦截（它们的连接池也彼此隔离，无堵塞风险）；③ blocked 窗口仍会下载主 bundle（main.tsx 静态 import App 是有意的 HMR 设计，未改为动态 import）；④ Web Locks 在持锁窗口崩溃/关闭时由浏览器自动释放，无接管/让位机制（用户决策）。
- Notes: 同一根因的单 tab 内连接数优化候选（`channels-settings-tab.ts:179` 设置页常驻期间额外再开一条 channels/events SSE，可改为复用 App.tsx 的全局连接）记为潜在后续 feature，本次未动。
- Revision（用户真机反馈「点击切换到已有窗口不跳转、旧窗口完全没反应」）: 根因是双重浏览器限制——① 旧窗口在 BroadcastChannel message 回调中调 `window.focus()` 无 user activation，Chrome 防焦点劫持策略静默忽略；② 后台标签 setTimeout 被深度节流（低至 1 次/分钟），原实现首个标题变化要等 800ms 定时器 → 闪烁也完全不可见。修复：① `startWindowFocusResponder` 收到请求**立即**置「● 」标题（不依赖计时器，重复请求重置闪烁相位与截止）；② 新增系统通知聚焦路径——`Notification.permission === 'granted'` 且 `isSystemNotificationsEnabled()`（复用 system-notifications 开关，未复制逻辑）时 `new Notification`（`tag: quickforge-window-guard` 去重、10s 节流 `WINDOW_GUARD_NOTIFICATION_THROTTLE_MS`，标题闪烁不受节流），`onclick` close + focus（**通知点击自带 user activation，聚焦可靠**）；构造器不可用/抛错静默降级；③ focus 事件兜底：用户切回窗口时若闪烁已超截止立即恢复原标题（后台节流下截止定时器可能迟到，保证不留脏 title）；④ `WindowGuardNotice` 点击按钮后本地 state 显示 `windowGuardSwitchHint` 引导文案（系统通知或任务栏 ● 标记）。i18n +3 中英 key（windowGuardNotificationTitle/Body/SwitchHint）；window-guard import system-notifications（测试补 pi-web-ui/@capacitor/core 传递依赖桩）。通知未带 icon（观感小项未处理）。复验：vitest window-guard 10→15 用例全过（主 Agent 复核）+ i18n-language-snapshot/system-notifications 回归 20/20 + eslint 0 error + tsc -b + build ✓。
- Revision 2（用户决策「算了，就简单提示吧，也不显示跳转按钮，按钮改成关闭当前页面」）: 移除整套切换链路——删除 focus responder（系统通知/标题闪烁/focus 事件兜底）、BroadcastChannel 协商（WINDOW_GUARD_CHANNEL_NAME/startWindowFocusResponder/requestExistingWindowFocus）、isSystemNotificationsEnabled/t/randomId import；`window-guard.ts` 收缩为 118 行纯锁守卫（unsupported 判定仅看 navigator.locks；clearTimeout 注入链因 sleep 只注册从不取消、无调用路径一并删除，仅保留 setTimeout）；`WindowGuardNotice` 按钮改「关闭当前页面」（onClose 默认 `window.close()` 可注入），点击后显示 `windowGuardCloseHint` 手动关闭引导（浏览器不允许脚本关闭手动打开的标签页；成功关闭时页面消失、提示不可见，无需检测）；`main.tsx` blocked 分支不再自动广播，直接渲染拦截页；i18n 删 4 key（windowGuardSwitchButton/SwitchHint/NotificationTitle/NotificationBody）增 2 key（windowGuardCloseButton/CloseHint），Description 微调衔接关闭按钮（中英同步）；测试收缩至 10 用例（删通知/闪烁/BroadcastChannel 用例与传递依赖桩，unsupported 新语义：locks 可用即可）。复验：vitest window-guard 10 + i18n-language-snapshot 2 全过（主 Agent 复核）、eslint 0 error、tsc -b、build ✓；全仓搜索确认 src/ 无 requestExistingWindowFocus/startWindowFocusResponder/windowGuardSwitch/windowGuardNotification 残留。附带发现（未处理）：docs/wiki/src/components/README.md 中 ErrorBoundary.tsx 行数目录树与详细条目不一致（53 vs 44，既有问题）。
- Revision 3（用户真机实测「点击关闭按钮是无效的。所以按钮也不要了。有个提示就好了」）: `WindowGuardNotice.tsx` 再收缩为 34 行纯静态提示——删除「关闭当前页面」按钮、`useState`/`Button` import 与 `window.close()`（浏览器不允许脚本关闭手动打开的标签页，`window.close()` 对手动开的窗口必然静默失败，按钮已无意义）；仅保留内联 SVG 图标 + 双语标题/描述，文案引导用户关闭本窗口并回到已有窗口。i18n 删除 windowGuardCloseButton/windowGuardCloseHint（中英成对，grep 无残留）；测试契约同步（无按钮/无 window.close/无 useState，removedKeys 增 Close×2）；wiki src/components 两处条目同步。复验：vitest window-guard + i18n-language-snapshot 全过、eslint 0 error、tsc -b、build ✓。
- Next step: 真机复测（开第二个窗口只见纯提示卡片：图标 +「QuickForge 已在另一个窗口打开」+ 引导文案，无任何按钮；关掉第一个窗口后刷新第二个窗口应能正常接管运行；Web Locks 不可用的旧浏览器放行）。

## Completed Feature：sse-health-probe-notice

- Feature: SSE 重连健康探测——后端被杀时 UI 显示「后端服务不可达（健康检查失败）」并无上限持续自动重试 + 恢复后 bootId 对比提示「服务已重启」（sse-health-probe-notice，**已完成**）
- Status: done — 起因：用户反馈后台被杀后前端只显示「重新连接中… 3/10」约 3 分钟才进失败态，且无法区分「后端死亡」与「弱网」；前端运行期无任何 /api/health 消费（仅关于页使用）。用户确认方案：A（重连失败尽早探测 health）+ 顺带服务已重启提示。
- 实现：`src/lib/server-agent.ts` GlobalAgentSseClient 重连期间每次调度失败后 single-flight 探测 /api/health（SSE_HEALTH_PROBE_TIMEOUT_MS=5s，异常/超时=不可达，baseUrl 跟随直连/代理切换，结果晚于状态切换到达时仅更新 bootId 基线）；不可达时 noteReconnectAttempt 豁免 10 次上限持续退避重试（封顶 30s，health 恢复且已超上限则照常进 failed），reconnecting 状态携带 unreachable:true；每次 onopen 探测 bootId，与基线不同补播 connected{restarted:true}（首连仅记基线）。`reconnect-notice.ts` unreachable 态切换文案 sseServerUnreachableLabel、隐藏 n/10 计数、保留 Xs 后重试倒计时；restarted 补播升级文案 sseReconnectedRestarted 并重置淡出计时器（已 dismiss 则忽略）。i18n 中英成对 +2 key；SseConnectionStatus 纯增量扩展（grep 确认消费方仅 reconnect-notice.ts）。
- Verification: 定向 vitest 2 files / 67 tests 全过（server-agent 新 5 例：unreachable 超上限持续重连、health 可达 10 次后照常 failed 回归、bootId 变化/相同、fetch 抛错/超时；reconnect-notice 新 3 例）；model-retry-notice 相邻回归 12 tests 过；eslint 5 个改动文件 0 error；tsc -b ✓。未跑全量。
- Boundaries: 「不可达」不区分「进程死」vs「彻底断网」（浏览器端两者都是 health 不通，无法分辨）；restarted 补播若恢复提示已淡出移除（2.2s 后）则忽略；Side Chat/分享页本就不挂该提示，未扩展；首次连接多一次 /api/health 请求（记录 bootId 基线）；未 commit。
- Next step: 真机验证：杀掉后端 → 界面几秒内切「后端服务不可达（健康检查失败）」且持续自动重试；重启后端 → 自动恢复「已重新连接 · 服务已重启」；弱网（health 通 SSE 断）→ 维持「重新连接中… n/10」。

## Completed Feature：session-switch-no-auto-preview-tab

- Feature: 切换 session 不再自动弹出预览 tab 与右面板（session-switch-no-auto-preview-tab，**已完成**）
- Status: done — 起因：用户反馈切换项目内 session 时 tab 自动打开。根因两条：① 面板开合状态按 (projectId, sessionId) localStorage 恢复，切回曾展开的 session 自动开面板；② 自动预览 effect 对恢复会话的全部历史 present_files 自动弹 tab 并强制开面板，sessionStorage 签名去重只覆盖浏览器标签页生命周期，冷启动后首次切换仍弹。
- 实现：① 删除 `src/hooks/useWorkspaceInspectorOpenState.ts`（及其测试），`workspaceInspectorOpen` 改 `useState(false)`——页面生命周期内默认收起、仅用户手动或自动预览请求打开；tab 列表仍按 (projectId, sessionId) 持久化恢复（WorkspaceInspector 重建逻辑不变）。② `artifact-preview-utils.ts` 新增 `collectToolResultToolCallIds` / `isNewlyPresentedArtifact` 纯函数；App.tsx 在自动预览 effect 前新增附着时刻快照 effect（restore 返回时消息已同步填充），历史门控仅放行「附着后新发生」的 present_files；删除 sessionStorage 去重，保留内存签名去重。
- Verification: 定向 vitest 4 files / 50 tests 全过（新 auto-preview-fresh-present 8 用例）；eslint 0 error；tsc -b ✓；build ✓（仅既有警告）；无残留引用。未跑全量。
- Boundaries: 缓存命中后后台校准补尾的 toolResult 会视为新产物（罕见、可接受，代码注释已说明）；live present 仍会 requestWorkspaceInspector 强制开面板（保留的预期行为）；用户浏览器中残留的旧 `quickforge:workspace-inspector-open:v1:` key 不再读写、无需迁移；未 commit。
- Next step: 可选真机冒烟（切回曾展开面板的 session 面板不再自动开；重启应用后首次切换含 present_files 的旧 session 不再弹 tab；新会话中 AI present 文件当次仍正常弹出）。

## Completed Feature：persist-skip-message-deep-clone

- Feature: 持久化路径消除全量 messages 双重 structuredClone 深拷贝——CPU 削减，事务边界不变（persist-skip-message-deep-clone，**已完成**）
- Status: done — 起因：/restore 偶发慢分析发现写路径每次 persist 对全量 messages 做两次深拷贝（synchronize 整 state 深拷贝 + normalizeRecord 预编码旁路仍深拷贝），replace 模式下与消息量线性相关的同步 CPU 突刺叠加在事件循环上。
- 实现：`server/session-state-service.mjs` — synchronize() 改「深拷贝 body + messages 浅拷贝」重组；savePairChunked() 入口浅拷贝冻结快照（plan 与所有编码批次读同一冻结数组，torn-read 防护）。`server/sqlite/session-state-repository.mjs` — normalizeRecord() 在 messagesEncoded 已提供时同样 body 深拷贝 + messages 浅拷贝（该旁路 messages 仅同步读长度对齐，写库内容为编码瞬间冻结的不可变字符串）；其余路径保持全量深拷贝。事务边界/锁/CAS 零改动。
- Verification: 定向 5 files / 95 tests 全过（新增：不可克隆探针证明旁路不再深拷贝；torn-read 防护——编码 yield 间隙 push+原地改已编码对象，写入仍为调用时快照，修复前会失败）；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- Boundaries: 未动事务分片/worker 线程（记录在案的待定升级项，待 200ms 慢日志量化残余 INSERT+COMMIT 分布再决定）；非数组 messages 路径与同步 savePair 全量深拷贝行为保留。
- Next step: 观察慢日志 `persist took Xms` 分布变化；若残余仍集中在事务 COMMIT 段，再评估 worker 线程方案。

## Completed Feature：mcp-restore-nonblocking

- Feature: restore 非阻塞 MCP——连接快照构建工具 + 后台重连 + 工具集变更刷新会话 + 启动预热（mcp-restore-nonblocking，**已完成**）
- Status: done — 起因：/restore 偶发慢根因之一为 MCP 重连挡在关键路径（error+过 30s 冷却同步等待 connect ≤15s + listTools ≤15s，single-flight 扩散到所有并发方）；启动无预热；disconnected 不自动重连。
- 实现：registry 增加 waitForConnections:false 快照模式 + reconnectDisconnected + subscribeMcpToolsetChanged 签名变更通知；agent-manager 的 createServerTools/createAgent 透传 mcpToolsMode，restoreAgentUnlocked 走 cached，模块级订阅变化后调现成 refreshAllSessionTools()（SSE state 推送新工具，无死循环）；index.mjs listen 回调预热（已确认覆盖 CLI/SDK/Desktop/Android 全入口）。新会话/subagent/工具调用保持 await 语义。
- Verification: 定向 12 files / 63 tests 全过（registry 3 新用例 + restore cached 行为断言 + 11 个测试文件 mock 补导出）；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- Boundaries: restore 后首个回合若恰好用到尚未重连完成的 MCP 工具，该工具调用按现状 503 报错自愈（重连完成后经工具集通知重建会话工具）；未改 callMcpTool/管理路由语义。
- Next step: 真机观察 restore durationMs（debug 日志）不再出现 MCP 重连量级的长尾；MCP server 掉线后恢复会话应能在后台重连完成后自动拿到工具。

## Completed Feature：agent-idle-timeout-10min

- Feature: Agent 空闲逐出时长 30 分钟收紧到 10 分钟（agent-idle-timeout-10min，**已完成**）
- Status: done — 用户反馈「冷恢复：30 分钟 idle 被 destroyAgent 踢出内存……缓存不要设置这么长，10 分钟就够了」。定位：`server/agent-manager.mjs:270` 常量 `IDLE_TIMEOUT_MS`（硬编码，无环境变量覆盖），唯一消费点 `resetIdleTimer()` 超时后调 `destroyAgent` 逐出内存会话；L1864 逐出日志以 `${IDLE_TIMEOUT_MS / 1000}s` 派生自动跟随，无需另改。
- 实现：仅一行 `30 * 60 * 1000 // 30 minutes` → `10 * 60 * 1000 // 10 minutes`。`idleRetention='always'`（ACP 会话）仍永不逐出；`touchSession` 各续期入口行为不变。
- Verification: node --check ✓；npx eslint 0 error；动态 import 冒烟 ✓；git diff 确认仅 1 行。tests/ 无该常量断言（grep 零匹配），未跑全量。
- Boundaries: 未动终端 PTY 断线保留 30 分钟（`RECONNECT_GRACE_MS`，`QUICKFORGE_TERMINAL_RECONNECT_MS` 可覆盖）与 ask_user 30 分钟超时（`ASK_TIMEOUT_MS`）——均为独立语义；`dist/`、`package-dist/`、`package-offline/` 生成产物未触碰；docs/wiki 无该时长描述、无需更新；未 commit。
- Notes: 收紧后冷恢复（`restoreAgent` 全量 `assembleState`）会更频繁触发，大会话首访尖峰（见 `docs/architecture/session-sqlite-migration-design-review.zh-CN.md` P6）出现频率升高，属预期行为变化而非代码风险。
- Next step: 无 blocker。

## Completed Feature：server-process-error-guards

- Feature: 服务器进程级异常兜底——uncaughtException 记录后优雅关闭退出、unhandledRejection 仅记录继续运行，后台不再无声死掉（server-process-error-guards，**已完成**）
- Status: done — 用户报告后台服务无声退出：8/27 23:10:29 日志断档（无错误、无优雅关闭标记、无系统重启事件），8.5 分钟后新实例才被拉起。根因：server/index.mjs 仅注册 SIGINT/SIGTERM，无 uncaughtException/unhandledRejection 处理器；服务器由 CLI 以 detached + stdio:'ignore' 启动，未捕获异常的默认 stderr 堆栈被丢弃，崩溃在 server-*.log 零痕迹。
- 实现：① 新增 `server/utils/process-error-guards.mjs` — `createProcessErrorHandlers({onFatalError, exitProcess, shutdownTimeoutMs=5000})` 返回纯处理器：uncaughtException 走 fatal 路径（re-entrancy 守卫 → `logger.error('Uncaught exception:', error, {fatal})` 含完整 stack → best-effort 优雅关闭 `Promise.race` 5s 上限、失败记 'Fatal shutdown failed:' → `flushLogger()` → `exit(1)`，先落盘再退出）；unhandledRejection 非fatal（仅记录：Error 取 `.stack`、非 Error 经 `util.inspect`；不 flush——flushLogger 会关闭日志流、不退出、不触发 onFatalError）。`installProcessErrorHandlers(options)` 向 process 注册两监听。② `server/index.mjs` 在模块级状态声明后、首个启动逻辑前（:101）尽早注册，覆盖顶层求值期与 `await ensureStorage()` 启动期异常窗口（`stopQuickForgeServer` 为 hoisted 声明、`shutdownRuntime` 对未启动服务防御、`closeHttpServer` 未 listen 安全）。③ 文档：wiki server/README（index.mjs bullet + 行数 1031）、server/utils/README（新模块条目）、logging-design §5 埋点表 +1 行。
- Verification: 定向 `npx vitest run tests/server/utils/process-error-guards.test.mjs` 6/6（含 flush-before-exit 与 re-entrancy 顺序断言、onFatalError 抛错/挂起 20ms 超时、rejection Error/非 Error）；回归 `tests/server/utils/` 全目录 9 files / 157 tests 全过；eslint 3 个改动文件 0 error 0 warning；`npm run build` 通过（tsc -b + vite build；KaTeX 字体/chunk size 提示为既有第三方警告）。定向验证 + build，未跑全量测试。
- Boundaries: 不改变 SIGINT/SIGTERM 既有优雅关闭语义；unhandledRejection 后继续运行属有意取舍（本地服务可用性优先）；注册点之前的 import 期同步异常仍走 Node 默认行为（与现状一致，窗口极小）；未改 CLI/bin 侧 spawn（stdio 仍 ignore，靠 logger 文件通道）；未 commit。
- Notes: ① 本会话为诊断驱动：崩溃时间线与排除项（22:38–22:45 update/check fetch failed 500 为网络问题非死因；系统未重启；无 OOM/EADDRINUSE 痕迹）已当面汇报；② update/check 弱网 500 修复（fdd7115）在 v1.10.0 之后合入，全局安装版本尚未包含，下个小版本随包生效；③ 并行会话同期在工作区推进 MCP warmup/agent-manager 相关改动（server/agent-manager.mjs、server/mcp/registry.mjs、tests/server/agent-manager.*、tests/server/mcp-registry.test.mjs、wiki mcp 条目），非本 feature 改动，未触碰。
- Next step: 可选真机验证：人为触发未捕获异常确认 server-*.log 出现 'Uncaught exception:' + stack + fatal 字段并 exit(1)；此后后台再无声退出时日志将直接给出死因。

## Completed Feature：update-check-async-snapshot

- Feature: 检查更新接口异步化——GET /api/system/update/check 立即返回状态快照、后台刷新 registry、弱网不再 500（update-check-async-snapshot，**已完成**）
- Status: done — 用户报告控制台 `Failed to load resource: 500 http://localhost:5176/api/system/update/check` 并指出「这个更新检查应该异步」。根因：路由 `await checkForUpdates()` 同步等待外部 npm registry fetch（5 秒超时），弱网/超时/registry 异常时抛错 → sendError 500，浏览器把非 2xx 记入控制台（启动静默检查每次触发）。
- 实现：① `server/utils/package-update.mjs` — npm 检查改进程内状态机：新 `getUpdateCheckState(projectRoot, {force})` 同步返回快照 `{status: 'checking'|'ok'|'error', ...上次结果, checkError?, checkedAt}` 永不等网络；结果过期（5 分钟冷却）/未检查/失败退避（30 秒）到期时后台 `startUpdateCheck` 刷新，失败只记 `checkError` 不抛给 HTTP 层；`force`（?force=1 手动检查）跳过缓存与退避。`checkForUpdates` 保留可等待语义供 `POST /api/system/update` 更新流程（成功走冷却缓存、与快照共享后台 Promise、失败如实 reject）；`checkDesktopRelease` 未动。② 路由改为 `sendJson(200, 快照)`，index.mjs context 换 `getUpdateCheckState(force)`。③ 前端新 `src/lib/update-check-poll.ts`（`requestUpdateCheck()`：默认 10 次 × 1s 有界轮询，fetch/sleep 可注入，一切失败返回 `{kind:'error'}` 不抛出，force 仅首请求，兼容无 status 字段旧 payload）；`useUpdateCheck`（启动静默）与 `about-settings-tab`（手动 force）接入，失败路径行为不变。
- Verification: 定向 3 files / 29 tests 全过（package-update 状态机 6 新用例：快照不等网络/冷却复用/错误快照+退避/force 重查/checkForUpdates reject；路由层 2 新用例：error 快照不 500、force 透传；update-check-poll 7 用例）；eslint 0 error（仅既有 identity.mjs:92 warning）；build ✓；`npm run test` 全量 **263 files / 2415 tests 全过**。
- Boundaries: 未动 `/api/system/update/desktop`（checkDesktopRelease，同形态阻塞+可能 500，但前端无调用方，见 Notes）；未新增依赖；无 UI/文案变化（About 错误文案沿用 updateCheckFailed / 服务端 checkError）；未 commit/tag/push。
- Notes: ① update/desktop 端点如后续被桌面壳启用，建议同样迁移到状态机；② identity.mjs:92 no-useless-assignment 为 dev 分支既有 lint warning，与本次无关。
- Next step: 真机验证：断网/代理失效时刷新页面，控制台不再出现 update/check 500；About 手动检查弱网下约 5 秒后显示检查失败文案，恢复网络后 force 重查成功。

## Completed Feature：model-stream-retry-notice

- Feature: 模型上游流重试可视化——任意 idle 超时重试（上限 10）+「模型连接重试中… n/10」（model-stream-retry-notice，**已完成**）
- Status: done — 用户实测上一特性后反馈：本机弱网场景（浏览器↔服务器 SSE 走 localhost 不断开）只看到 idle timeout 错误、没有重连文字；SSE 重连提示覆盖不到这层。按用户期望将上游模型流故障做成可见恢复：服务端重试条件放宽到任意 idle（有内容也重试、新流从零重放、消息原位替换），上限 10 次对齐 SSE 重连语义；重试进度经 `model_stream_retry` SSE 事件上报（agent-manager 两处 streamFn 闭包注入 onStreamRetry → emitSessionEvent），重试后首个实质事件上报 recovered；前端新 model-retry-notice controller 显示居中「模型连接重试中… n/10」（复用 reconnect-notice 样式词汇），message_update/message_end/agent_end/error 即隐藏，decorate 周期 sync 重挂。
- Verification: 服务端 2 files / 19 tests（重试上限/进度回调/有内容重试+恢复上报/停滞重试不立刻失败）；前端 model-retry-notice 12 tests + server-agent 透传 + 回归（compaction/side-chat/agent-manager/message-queue）全过；eslint 0 error；tsc -b；build ✓。测试适配：total 预算放大（10 次重试 × idle 需 11s+，真实 total 20min 不受影响）、reconnect-notice CSS 契约改并列选择器。
- Boundaries: total timeout 仍不重试；有内容重试丢弃半截内容重新生成（重新计费，恢复可用性优先）；Side Chat 不挂提示；conversation-compaction 流不注入回调（后台任务无 UI）；未 commit。
- Next step: 真机弱网验证：上游卡死时应看到「模型连接重试中… 1/10…」递增，网络恢复后提示消失、内容从零重写继续；持续断网 10 次用尽后报 idle timeout 错误。

## Completed Feature：ai-stream-idle-fast-detect-retry

- Feature: AI 流静默分档检测 + 零内容透明重试（ai-stream-idle-fast-detect-retry，**已完成**）
- Status: done — 起因：用户报告弱网下回合以「AI stream idle timeout after 300000ms」失败而非前端重连提示。链路分析确认这是服务端→模型 API 的上游流卡死（openai SDK 的 120s timeout 只覆盖到响应头、`finally clearTimeout` 后 body 读取无任何超时；pi-ai 在 headers 一回来就 push start，所以 idle timeout ≠ 请求没成功）；用户直觉「没成功的请求可重试」经修正为「按有无实质内容分流」，与用户确认后在 QuickForge 包装层简单实现（pi-ai 不透传自定义 fetch、patch globalThis.fetch 侵入过大，SDK 层方案否决）。
- 实现：① `ai-provider-options.mjs` — `DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS` 300s→60s（中断档），新增 `DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS`=120s（首实质事件前，容忍大上下文 prefill）；显式 idleTimeoutMs/deadlineMs 时两档同值（既有调用方语义不变）。② `ai-http-logger.mjs` — `wrapStreamWithTimeouts` 改流工厂模式；零内容静默超时（未达 1 次重试、用户 signal 未 abort）时内部 `createStream()` 重建：每次尝试独立 AbortController（`combineAbortSignals` 改多参修复第三个参数被丢弃）、换流打断上一次挂起连接、total timeout 跨尝试共享；托管云重试换新随机幂等键；对外吞掉重试流重复 `start`（agent-loop 后续 delta 的 message_update 以新 partial 自然接管已发布消息）；外部 `next()` 等待者跨重试存活由新流续喂；`result()` 等待者跟随当前流并在 swap 时迁移（旧流 abort settle 不再污染 result 归宿）；旧 pump 以 generation 守卫静默退出。有实质内容后超时或重试耗尽走原报错路径（文案不变）。
- Verification: 定向 ai-http-logger + ai-provider-options → 2 files / 19 tests 全过（6 个新增行为用例 + 2 个适配重试语义的既有用例）；消费方回归（conversation-compaction、side-chat 路由、agent-manager persist/abort/process-timing、rollback-compaction、auto-compaction）全过；eslint 0 error；node --check；build ✓（仅既有 warnings）。调试中修的三个自身 bug：`waiter(...)`→`waiter.resolve(...)` 笔误（重写时引入，对照 HEAD 原版发现）、`combineAbortSignals` 双参签名静默丢弃第三个 signal、`result()` 早调用绑定旧流（重试场景挂死/错误 settle）——后两个是重试机制引入的新边界，均以用例锁死。
- Boundaries: 未动 openai SDK/pi-ai/pi-agent-core；SSE 重连提示（sse-reconnect-notice）与本特性分属两层、互补；显式传 idleTimeoutMs 的调用方（compaction 等经 withDefaultAiProviderOptions 默认路径）行为不变；总时长 total 20min 不变；未 commit/tag/push。
- Revision（用户决策「都收紧到 60s 试试」）: DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS 120s→60s，与中断档统一；ai-provider-options 注释、两处测试断言/用例（首事件档 60s 触发重试、再 60s 失败报 after 60000ms）、wiki 与状态文件描述同步。复验定向 2 files / 19 tests 全过。prefill 误杀观察点：若大上下文场景出现「重试后仍首事件超时」，回调该常量或显式传 firstEventTimeoutMs。
- Next step: 无 blocker；可选真机验证：弱网制造上游卡死（断代理）观察 60s 快速失败 + 零内容时静默重试一次无感恢复；大上下文 prefill 确认 60s 首事件档不误杀。

## Completed Feature：sse-reconnect-notice

- Feature: 弱网重连提示——对话中显示「重新连接中… 8/10」（sse-reconnect-notice，**已完成**）
- Status: done — 先产出交互稿 `design-mockups/reconnect-indicator.html`（A/B/C 三方案 × 重连中/已重连/失败三状态 × 深浅主题 + 可操作断连→计数递增→成功淡出/上限失败演示），用户确认 **方案 A（消息流末尾居中轻量行）** 后实现。调研确认现状：`GlobalAgentSseClient`（src/lib/server-agent.ts）无限次指数退避（1s 起 ×2、封顶 30s）且断连对 UI 完全静默，弱网时用户只看到输出停住。
- 实现（连接层）：`MAX_SSE_RECONNECT_ATTEMPTS = 10` + `SseConnectionStatus` 类型；`onerror` 恢复路径（直连→同源代理切换计一次零等待尝试，随后调度重试）经 `noteReconnectAttempt` 广播 `reconnecting{attempt, maxAttempts, nextRetryAt}`；`onopen` 在此前确有断连时广播 `connected{recovered:true}` 并重置计数/退避；第 10 次重试仍失败广播 `failed` 并停止自动重连。导出 `subscribeSseConnectionState` / `getSseConnectionState` / `requestSseReconnectNow`（手动重试：disconnect 清退避后立即重连）；`disconnect()` 统一重置计数/退避/状态快照。
- 实现（UI 层）：新 `panel-decoration/reconnect-notice.ts` controller 订阅连接状态，在 `message-list` 末尾追加居中轻量行：重连中 spinner +「重新连接中… n/10」（计数稍加重色）+ 每秒倒计时（interval 只更新文本节点）；恢复后绿色「已重新连接」约 2.2s 带退场动画自动移除；上限后琥珀「连接失败，已重试 10 次」+「立即重试」按钮。元素幂等复用、decorate 周期 `sync()` 在消息列表被 Lit 重建后重挂回末尾，`destroy()` 退订 + 清计时器 + 移除 DOM。`ChatPanelHost` 仅主聊天挂载（Side Chat 走独立 NDJSON 流不共享该 SSE），decorate try 块内 `sync()`、清理段 `destroy()`。i18n 中英成对 5 key；`index.css` 新增 `.quickforge-reconnect*` 段（复用 muted token、todo 完成态 emerald、persist-degraded 琥珀 #d97706；reduced-motion 关动画；置于 TodoWrite 摘要注释之前避免 todo-write-renderer 无界切片契约污染）。文案全部 createElement/textContent，innerHTML 仅静态 SVG 常量。流式断连卡死仍由既有 15s 静默看门狗轮询 /status 兜底，两者互补不替代。
- Verification: 定向 vitest reconnect-notice + server-agent → 2 files / 58 tests 全通过（server-agent 新增 4 用例：退避计数与广播、上限后 failed 且不再新建连接、onopen recovered+重置、手动重连后从 attempt 1 重计；reconnect-notice 8 行为 + 6 组源码契约）；回归 i18n-language-snapshot + todo-write-renderer/summary + message-queue + side-chat-workspace-tab + chat-harness-capabilities → 6 files / 70 tests 全通过；eslint 改动 7 文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warnings），dist 确认含新样式与 key。**事故记录**：实现中途误把 `SSE_SILENCE_RECOVERY_MS` 15000 改成 15015（受调研报告笔误影响），导致两个既有 watchdog 用例在 15s 整刻差 15ms 不触发而失败——恢复原值后全绿；该常量与本次 feature 无关，最终 diff 未包含此变更。
- Boundaries: 未改服务端与 SSE 协议；重连节奏（1s→30s 退避）与看门狗行为不变，只加了计数/上限/广播；Side Chat / SharedServerAgent（分享页）未接入提示；未新增依赖；未 commit/tag/push。DESIGN_LANGUAGE 未更新（复用既有语义色与轻量行模式，无新视觉范式）。
- Next step: 无 blocker；可选真机弱网验证（断开网络观察计数递增与倒计时、恢复后绿色提示自动消失、持续断网到 10/10 后点「立即重试」）。

## Completed Feature：release-v1.10.0

- Feature: minor 发布 v1.10.0（release-v1.10.0，**已完成**）
- Status: done — v1.9.1 tag 之后 dev 待发布内容为 chat-message-queue 新功能（dfb2bcc：Composer 流式期排队自动发送、「立即」steer 轮边界插队 + 乐观显示、拖拽排序、localStorage 持久化），另有 plugins/lan-access 两个设置页文案精简（91d0c4d、9b52444，经 435c3bf 合入 dev，未包含在 v1.9.1 npm 包内）。新功能按 semver 应升 minor，经用户确认按 **minor** 发布 v1.10.0。
- Release changes: `npm version minor` 1.9.1→1.10.0（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.10.0] - 2026-08-27` 章节（Added/Changed/Released）；README.md 当前版本徽章更新为 1.10.0。
- Verification: 完整 `npm run test` → **260 files / 2365 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.10.0.tgz`（unpacked 24.2MB / 453 files）；打包元数据校验 version 1.10.0、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies、无 devDependencies/scripts。
- Release sequence: 本轮变更构成 release commit（7 个发布文件），随后 master 快进到发布提交、创建 `v1.10.0` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：chat-message-queue

- Feature: Composer 消息队列——流式期排队自动发送 + steer 轮边界插队（chat-message-queue，**已完成**）
- Status: done — 先产出交互稿 `design-mockups/message-queue.html`（深浅主题可操作演示，用户手动验证通过），按稿内推荐方案实现。调研确认 pi-agent-core 的 steering 队列与 QuickForge 既有但无 UI 的 `POST /api/agents/:id/steer` 可直接承载「插队」语义，服务端零改动。普通排队：流式期间 Composer Enter 不再被静默丢弃，`panel-decoration/message-queue.ts` controller 在 textarea capture-phase keydown 拦截（IME/Shift 放行）入队并把占位符切为「继续输入以排队后续修改」；`agent_end` 且非 aborted/error 时延迟 250ms 取队头作为普通 prompt 自动发送直至清空。插队：队列项「立即」按钮 steer 注入当前工具轮结束后的最早边界，不打断执行中的工具；能力位 `messageSteering` 仅 QuickForge 开启，OpenCode/Side Chat 关闭且不可用时点击退化为置顶立即发送。手动停止/Escape（aborted）与 error 结束且队列非空 → 暂停 +「继续依次发送」恢复入口；自动发送失败回退队头并暂停，steer 失败仅 warn 保留该项。状态经 localStorage `quickforge:message-queue:v1` per-session 持久化（50 会话 / 20 条 / 2000 字符），挂载恢复、卸载保存、清空删条目；刷新中断不丢消息。UI 挂 composer shell 内任务摘要后、建议菜单前：todo-write-summary 锚点规则容忍相邻 `quickforge-msg-queue`、双方收敛稳定不再逐装饰周期交换位置。i18n 中英成对 15 key；样式复用既有 token 与克制 hover/危险色规范（删除仅 hover 红），reduced-motion 关闭过渡。
- Verification: 定向 `npx vitest run tests/frontend/message-queue.test.ts tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → 3 files / 47 tests 全通过（新增 21 用例：入队上限/FIFO、编辑/删除/置顶、normalize 防御、无 localStorage 降级与 stub round-trip、steer 客户端请求契约与失败抛错、ChatPanelHost/controller/todo 容忍/能力门控/i18n/css 六组源码契约）；回归 chat-harness-capabilities + side-chat-workspace-tab + ChatPanelHost 引用族共 6 files / 72 tests 全通过；`npx eslint` 改动 8 文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 服务端未改（steer/follow-up 端点与语义沿用现状）；对话流内不加「已插队」标记（交互稿演示项，实际以消息顺序体现）；OpenCode 无普通插队仅保留自动排队方向；未新增依赖；未 commit/tag/push。
- Revision（用户真机反馈 2026-08-27）: 移除队头项特殊深色边框——原 `.quickforge-msg-queue-item[data-head]` 的三参 `color-mix` 写法无效，浏览器回退 currentColor 导致队头边框发黑；改为与其他项一致统一 `var(--border)`。删除队列头部「AI 结束后按顺序自动发送」提示文案及 `messageQueueAutoHint` 双语 key、`quickforge-msg-queue-hint`/`data-head`/`order--next` 死代码。复验：eslint 3 文件 0 error、定向 vitest message-queue + todo-write-summary → 37 tests 全过、tsc -b 通过、build ✓ built in 6.59s。
- Revision 2（拖拽排序设计稿轮次）: 应用户要求设计排队项拖拽排序。已在 `design-mockups/message-queue.html` 扩展可操作演示并经浏览器自动化实测通过：左侧 ⠿ 手柄触发（与按钮/文本选择零冲突）、6px 阈值激活、原位半透明占位 + 克隆幽灵跟随、越过相邻行中线实时换位、边缘自动滚动、松手提交顺序并刷新序号（含真实 CUA drag 断言 orderOk/seqOk/无残留幽灵）。过程中修复两个关键 bug：①move/up 原绑在手柄上依赖 setPointerCapture 路由导致手动拖不动 → 改挂 window capture；②重写时丢失 ghost.remove() 导致克隆残留。实现路线确认为 ~80 行指针 mini-sortable（非 React 控制器不便用 @dnd-kit），不新增依赖；组件落地待用户手动复核演示稿后进行。
- Revision 3（拖拽排序组件落地，用户确认后实现）: 将演示稿交互移植进正式代码。`src/lib/message-queue.ts` 新增纯函数 `moveQueuedMessage(items,id,toIndex)`（clamp+round、未知 id no-op）；`panel-decoration/message-queue.ts` 新增 `beginRowDragSession` 指针 mini-sortable——行首 ⠿ 手柄（`quickforge-msg-queue-handle`，hover 增强）pointerdown 触发，6px 阈值激活后原行变 `--drag-placeholder` 半透明虚线占位、克隆体 `.quickforge-msg-queue-drag-ghost`（`--shadow-quickforge`、body 级、pointer-events:none）跟随指针，越过相邻行中线占位实时换位预示落点；move/up/cancel 监听挂 window capture（手柄级监听会因指针捕获不生效而丢失抬起——mockup 阶段实测教训），列表边缘 26px 自动滚动，拖拽期禁用文本选择；编辑中的行不可拖。松手经 `moveQueuedMessage` 提交并走既有 onChange → localStorage 持久化链路。i18n 新增 messageQueueDragTitle 双语 key；index.css 追加 handle/placeholder/ghost 样式（token 复用，无新视觉范式）。Verification: 定向 vitest message-queue(新增 moveQueuedMessage 7 断言组 + 拖拽源码契约「window capture 三监听 / ghost 清理」等) + todo-write-summary + chat-harness-capabilities + side-chat-workspace-tab → 4 files / 57 tests 全过；eslint 改动文件 0 error；tsc -b 通过；build ✓ built in 6.86s。
- Revision 4（拖拽正确性评审修复，用户指出「html 只是看交互，实际功能要正确」）: 评审确认 4 个真 bug 并修复。①【最严重】`render()` 每个装饰周期（流式期间每个 agent 增量都触发 `messageQueue.update()`）开头无条件取消进行中拖拽——队列面板恰在流式期使用，拖拽几乎必被打断；静态 mockup 无重渲染所以自动化实测发现不了。② `pointercancel`/中途取消只移除幽灵、不复位被 `movePlaceholder` 挪动的行、不触发重渲染，空闲（暂停态）时行序与 items 永久错位。③ 拖拽会话状态为模块级全局 `let cancelActiveRowDrag`，多控制器实例（会话切换/重挂载）互相误杀。④ 同根因：流式期间每次重渲染重建编辑输入框并重置为已提交文本 + rAF 抢焦点，行内编辑几乎不可用。修复：`beginRowDragSession` 改为返回 `{cancel}` 会话对象的工厂（onCommit/onEnd 回调、无模块状态）；控制器持有 `dragSession`，拖拽存续期间 `render()` 挂起（`renderDeferredByDrag` 脏标记），会话结束（提交或取消）统一从权威 items 重建；提交路径 onCommit 先于 cleanup，notify 的渲染被挂起后由 onEnd 一次兑现；控制器 cleanup 经 `disposed` 守卫取消会话且不再重建；编辑输入框加 `dataset.queueItemId`，同一编辑项跨重渲染保值/保焦点/保光标（失焦状态不抢回焦点）。Verification: 定向 vitest 4 files / 59 tests 全过（契约更新：无模块级会话变量、拖拽挂起重渲染、会话结束重建、编辑保值）；eslint 0 error；tsc -b 通过；build ✓ 6.52s。
- Revision 5（「立即」乐观显示，用户提出点击后对话马上显示文字）: 调研确认 steer 链路——服务端 steerAgent 把消息入 steeringQueue，agent-loop 在当前工具轮结束时以 message_start/message_end 事件注入真实 user 消息，所以点击后要等工具轮结束才能看到。实现：`ServerAgent.steer(message)` 改 async——先乐观把 user 消息追加进 state.messages 并 emit message_start（面板 requestUpdate 即渲染），再 POST 同一消息对象（含客户端 timestamp；服务端 prepareCloudUserMessage 只加 metadata 不改 timestamp）；工具轮边界 drain 时 SSE message_end 回显同一消息 → upsertMessage 按 role+timestamp 原位替换乐观副本（实测去重通过）；HTTP 失败回滚乐观副本 + 二次 message_start 通知面板 + reject（ChatPanelHost 捕获后保留队列项）。ChatPanelHost submitJump 改调 `agent.steer({ role:'user', content: item.text, timestamp: Date.now() })`；删除 lib/message-queue.ts 的 steerSessionMessage（唯一调用方迁移后成死代码）及测试 describe；state/turn_end 全量替换路径有长度守卫（本地更长不覆盖），乐观副本在 drain 前安全；drain 前 optimistic 消息位于对话尾部、工具结果后到会临时排其后，agent_end 权威历史恢复最终顺序（可接受的一次性重排）。Verification: vitest server-agent(新增 2 行为用例：乐观追加+echo 原位去重 / 409 回滚) + message-queue → 2 files / 54 tests 全过；eslint 5 文件 0 error；tsc -b 通过；build ✓ 7.30s。lib/components wiki 两处已同步。
- Revision 6（提交前完整门禁修复 + CSS 事故恢复）: 完整 npm run test 首跑暴露 todo-write-renderer「正常流布局」契约失败——该用例用 `css.slice(indexOf('/* TodoWrite task summary'))` 无界切片到文件尾，Revision 3 追加在 todo 段之后的队列 CSS（drag-ghost 的 position:fixed/z-index）污染断言（定向测试从未覆盖）。修复：队列 CSS 段整体移至 todo 摘要注释之前。过程中一次脚本失误截断了 src/index.css：从 HEAD 恢复基底（队列段是 index.css 唯一未提交增量），丢失段按 ① 会话内 Read 逐字原文（-list 至 -icon-btn svg、drag 段）+ ② 事故前 dist 编译产物提取的声明（含 @supports 内 color-mix 原值）重建，重建后 bundle 队列规则与事故前逐条一致（fallback + color-mix 全同）。复验完整门禁：npm run test 260 files / 2365 tests 全过、lint 0 error（仅既有 identity.mjs warning）、build ✓。
- Next step: 可选真机验证（真实回合中连续排队多条观察逐条自动发送；长工具轮中点「立即」观察消息立即出现且工具轮结束后不重复；手动停止后恢复；流式运行中拖动 ⠿ 调整顺序不再被打断；流式期间行内编辑）。遗留小决策：暂停横幅当前同时覆盖 aborted 与 error 两种结束态。

## Completed Feature：release-v1.9.1

- Feature: patch 发布 v1.9.1（release-v1.9.1，**已完成**）
- Status: done — v1.9.0 tag 之后 dev 累计 6 个提交：云服务设置页精简与 Cloud API 地址行重设计、Todo 任务摘要胶囊化动画、检查更新遵循 npm registry 配置、侧栏「显示更多」颜色弱化及状态文件记录；无破坏性变化，经用户确认按 **patch** 发布 v1.9.1。
- Release changes: `npm version patch` 1.9.0→1.9.1（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.9.1] - 2026-08-27` 章节（Added/Changed/Fixed/Released）；README.md 当前版本徽章更新为 1.9.1。
- Verification: 完整 `npm run test` → **259 files / 2349 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.9.1.tgz`（7.0MB / 453 files）；打包元数据校验 version 1.9.1、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies、无 devDependencies/scripts。
- Release sequence: 本轮变更构成 release commit（7 个发布文件），随后 master 快进到发布提交、创建 `v1.9.1` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：plugins-remove-description

- Feature: 插件设置页移除插件描述文案（plugins-remove-description，**已完成**）
- Status: done — 用户要求移除「管理本地 QuickForge 插件。当前首版支持通过 manifest 声明并贡献 Agent 工具的插件。」。`PluginsPage.tsx` 删除标题下方描述行；`settings-tabs.ts` 插件项 `getDescription` 改为 `undefined`（与 mcp 项同先例；`SettingsWorkspacePage.tsx` 的 activeDescription/搜索文本均可选链消费，安全）；`i18n.ts` 中英文成对删除 `pluginsDescription` key，grep 确认无残留。
- Verification: grep 删除 key 无残留；eslint 改动 3 文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）。tests/ 无 PluginsPage/pluginsDescription 引用。未跑全量 test/lint。
- Boundaries: 纯 UI 文案移除，不改插件发现与加载逻辑；无新增依赖；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：lan-access-remove-risk-warning

- Feature: 局域网访问设置页移除高风险警告文案（lan-access-remove-risk-warning，**已完成**）
- Status: done — 用户要求移除设置页顶部「高风险：通过密码的局域网设备可以访问你的对话、项目和可用工具。请只在可信网络中开启。」。`lan-access-settings-tab.ts` render 删除 `quickforge-settings-warning` 警告 div；`i18n.ts` 中英文成对删除 `lanAccessRiskWarning` key，grep 确认无残留引用。`.quickforge-settings-warning` 样式保留（cloud/backup/skills/plugins 页仍用）。
- Verification: grep 删除 key 无残留；eslint 改动文件 0 error（server/cloud/identity.mjs 既有 warning 与本次无关）；npm run build 成功（仅既有 chunk size warning）。tests/ 无 lan-access-settings-tab 相关测试文件。未跑全量 test/lint。
- Boundaries: 纯 UI 文案移除，不改局域网访问功能与密码逻辑；无新增依赖；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：cloud-settings-url-row-redesign

- Feature: 云服务设置页移除「启用云服务」开关行与登录安全说明 + Cloud API 地址行样式重设计·方案 A（cloud-settings-url-row-redesign，**已完成**）
- Status: done — ①「登录或注册」安全说明文字已删；②「启用云服务」开关行及描述已删（连带 setCloudServiceEnabled 与 4 个 i18n key；.quickforge-settings-switch 样式保留给其他设置页）；③设计稿 `design-mockups/cloud-url-row-redesign.html`（现状对比 + A/B/C、深浅主题、交互演示）经用户选型 **A** 后实现：URL 行改为 `quickforge-settings-row-form` 紧凑表单组——标签上置、「来源」caption 移至标签行右端、输入框通栏与「测试连接」「保存修改」同排、错误提示与「重建身份并切换」保持在下方；index.css 新增三条规则（纵向堆叠 / min-height 0 / 悬停不高亮），tests 新增源码契约 describe 锁定布局。**边界**：服务端默认 enabled=false，开关原是唯一 UI 启用入口——已装实例 saved enabled=true 不受影响（PUT config 合并语义），新装实例默认关闭暂无 UI 开关；用户未要求改默认值，server/cloud/service-config.mjs 未动。
- Verification: 定向 vitest 3 files / 23 tests 全通过；eslint 改动文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）。未跑全量 test/lint。
- Boundaries: 未新增依赖；docs/wiki/src/components/README.md 已同步；未 commit/tag/push；设计稿保留。
- Next step: 无 blocker。遗留决策（用户未答）：新装实例云服务默认关闭是否改为默认开启（改 candidateFrom 默认值，一行）。

## Completed Feature：update-check-npm-registry-config

- Feature: 检查更新遵循 npm registry 配置（update-check-npm-registry-config，**已完成**）
- Status: done — 会话首段调研确认「检查更新」为直接 fetch npm registry packument 取 dist-tags.latest，registry 仅读 `npm_config_registry` 环境变量、默认官方源，用户 `.npmrc` 镜像配置不生效（国内网络 5 秒超时易失败）；与用户确认不改用 `npm view` 命令方案（更慢、依赖本机 npm、超时控制更复杂，且 npm 命令底层请求同一接口），按「读取当前 npm 配置的源」落地：`server/utils/package-update.mjs` 新增 `resolveRegistry(packageName, options)`——环境变量 `npm_config_registry` / `NPM_CONFIG_REGISTRY` > 用户级 `.npmrc`（`NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` 或 `~/.npmrc`，`@scope:registry` 覆盖通用 `registry`，容忍注释/空行/引号值，去尾部斜杠；只读 registry 键、不触碰凭据）> 默认 `https://registry.npmjs.org/`；缺文件/空值/非法内容静默回退。`getRegistryPackageUrl` 改 async 接入，`fetchLatestVersion`/`checkForUpdates`（`/api/system/update/check`）与 5 分钟冷却缓存行为不变。`bin/quickforge.mjs` 删除本地复制的 registry/fetch 副本，先初始化网络代理再委托 server 模块 `fetchLatestVersion`。
- Verification: 定向 `npx vitest run tests/server/utils/package-update.test.mjs` → 1 file / 11 tests 全通过（resolveRegistry 7 用例 + fetchLatestVersion 按 npm 配置构造 URL）；`npx eslint` 3 个改动文件 0 error；`node --check` 两模块通过；真实冒烟 `node bin/quickforge.mjs check-update` 走共享模块与本机 npm 配置成功返回 1.9.0。未跑全量。
- Boundaries: 不改冷却缓存、超时、packument 端点与更新执行链（update-supervisor）；Desktop 渠道（GitHub Releases）不受影响；未新增依赖，未 commit/tag/push；docs/wiki server/utils（补收 package-update.mjs 条目）与 bin 已同步。
- Next step: 无 blocker；调研中识别的可选后续：packument → 轻量 `/-/package/<name>/dist-tags` 端点（该包版本多、元数据大）；bin 与 server 模块仍各有一份相同的 compareVersions 复制（本轮未动）。

## Completed Feature：cloud-settings-remove-remote-identity-sections

- Feature: 云服务设置页下线「远程访问」与「云身份」状态区块（cloud-settings-remove-remote-identity-sections，**已完成**）
- Status: done — 用户确认远程访问状态展示与云身份状态行均不需要，要求下线。`CloudAccountSettingsPage.tsx`：整块移除远程访问 section（远程访问标题/描述、「Agent 不可用」等状态徽标、授权中提示、错误警告）及全部关联逻辑（remoteStatus state、refreshRemoteStatus、1.75s 轮询、visibilitychange 刷新、retryRemoteAuthorization、remoteStatusLabel），不再请求 `/api/cloud/remote-status`；「云身份」section 移除头部状态行（云身份标题、identityDescription 描述、modeLabel 徽标）与 cloud-unavailable、session-mismatch 警告行，改为仅在连接后渲染邮箱/套餐、剩余额度、重置时间、退出登录功能行——未连接用户的页面只剩「云服务连接」配置区。`cloud-account-settings-state.ts`：移除 shouldPollCloudRemoteStatus、getCloudRemoteAuthorizationUi、CloudRemoteAuthorizationUi 及失去消费者的 getCloudAccountViewState/CloudAccountViewState。`i18n.ts`：中英文成对删除 31 个 key；`cloudSessionServiceMismatch` 有意保留（cloud-error-message.ts 错误码映射）。cloud-client.ts 的 remote-status API 绑定与服务端端点保留（cloud-client.test.ts 仍覆盖）。说明：用户消息中仍看到「绑定服务 http://127.0.0.1:5176/」，该行已于上一 feature（cloud-settings-remove-devices-simplify）删除，属旧构建/未刷新界面。
- Verification: 定向 `npx vitest run tests/frontend/cloud-account-settings-page.test.ts tests/frontend/cloud-i18n.test.ts tests/frontend/cloud-client.test.ts` → 3 files / 21 tests 全通过；`npx eslint` 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；grep 确认删除标识符/key 无残留。未跑全量。
- Boundaries: 页面行为/UI 精简，不改服务端与 API 契约；docs/wiki src/README.md 与 components/README.md 已同步；未新增依赖，未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：todo-summary-capsule-redesign

- Feature: Todo 任务摘要胶囊化——未展开时收缩为进度胶囊、展开/收起带动画过渡（todo-summary-capsule-redesign，**已完成**）
- Status: done — 先按用户要求产出 `design-mockups/todo-capsule-summary.html` 设计稿（用户确认并要求胶囊水平居中），随后落地实现：`todo-write-summary.ts` toggle 外加居中 toggle-row（flex-grow 0→1 插值驱动宽度动画），toggle 子元素一次性创建并跨快照持久（ring 环+对勾、heading、完整 stats、aria-hidden 紧凑 stats-compact、updated、spacer、chevron），进度弧经内联 `--quickforge-todo-ring-offset` 变量驱动 450ms 动画，root 新增 data-complete/data-running（对勾交叉淡化 / 收起态呼吸）；`index.css` 整段替换 todo 摘要样式：胶囊（999px、muted/55%、1.5rem、居中）⇄ 展开整行（8px、透明背景），标题/双统计 max-width+opacity 交叉淡化，列表 grid-rows 0fr→1fr + 阶梯淡入，body hidden 仍即时赋值、display:none 由 `transition-behavior: allow-discrete` 延迟 + `@starting-style` 进入动画（无 JS 两帧协调），环双 SVG 用 grid 同格叠放保持正常流契约，reduced-motion/移动端分支同步。用户追加：完成态对勾改绿色——复用 slash agent chip 既有 emerald 语义色（浅 rgb(4 143 101)/深 rgb(110 231 183)），整体单色、绿色仅完成刻出现，设计稿同步。wiki 两处同步（行为段 + 模块 360 行）。
- Verification: 定向 vitest 3 files / 58 tests 全通过（含新增 5 个胶囊结构契约用例）；eslint 0 error；tsc -b 通过；npm run build 成功且 dist CSS 保留 @starting-style/allow-discrete/ring-offset 变量。未跑全量 test/lint。
- Boundaries: 复用既有语义 token 与轻盈模式，无新视觉范式，DESIGN_LANGUAGE 未改；不改服务端协议、无新增依赖；未 commit/tag/push；设计稿保留作决策记录。
- Next step: 无 blocker；可选真机目视深浅主题下胶囊⇄展开动画、收起态呼吸与全完成对勾自动收起。

## Completed Feature：cloud-settings-remove-devices-simplify

- Feature: 云服务设置页精简——移除「绑定服务」URL/Agent PID 行与设备管理区块（cloud-settings-remove-devices-simplify，**已完成**）
- Status: done — 用户要求移除远程访问区的「绑定服务 http://127.0.0.1:5176/」展示、不再需要设备管理并精简界面。`CloudAccountSettingsPage.tsx`：删除 cloudRemoteServerUrl（绑定服务 URL）与 cloudRemotePid（Agent PID）两行，远程访问区收敛为「标题+描述+状态徽标（Agent 不可用等）+授权中提示+错误警告」；整块移除「已连接设备」区块（列表/当前设备徽标/撤销按钮/重名提示）及 revoke 回调、installationId/installationName 辅助、重名统计。`cloud-account-settings-state.ts`：CloudDetailsState/loaders/loadCloudAccountDetails 移除 installations（详情只加载 usage+models），getCloudAccountViewState 的 cloud-unavailable 判定 3→2 加载器全失败。`i18n.ts` 中英文成对删除 13 个仅设备 UI 使用的 key。保留边界：cloud-client.ts 的 installations API 绑定与服务端端点未动（移动端 CloudRemotePage 走独立 remote-client 链路选择连接设备，功能必需，不受影响）；远程 Agent 启停/轮询/自动授权逻辑不变。
- Verification: 定向 `npx vitest run tests/frontend/cloud-account-settings-page.test.ts tests/frontend/cloud-i18n.test.ts tests/frontend/cloud-client.test.ts` → 3 files / 27 tests 全通过；`npx eslint` 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；grep 确认删除 key 无残留。未跑全量。
- Boundaries: 纯 UI 精简，不改架构/模块职责/公共入口，docs/wiki 无需更新；未新增依赖，未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：sidebar-show-more-muted-color

- Feature: 侧边栏「显示更多」弱化至与分区标题一致的灰色（sidebar-show-more-muted-color，**已完成**）
- Status: done — 用户反馈项目会话列表的「显示更多」颜色太深、与会话标题区分不开，应对齐「项目」分区标题的灰色。定位：`SessionDisplayControls`（ChatSidebar.tsx，三处共用——项目视图会话、时间线视图、全局对话）按钮为 `text-muted-foreground/60`，仅比会话标题 `text-muted-foreground/70` 浅 10% 肉眼难辨，而分区标题为 `text-muted-foreground/50`。修复：resting 色 `/60`→`/50` 与分区标题一致（与会话标题拉开 20% 差），hover `/80` 保留（悬停时有背景色，不影响区分度）；tests/frontend/sidebar-section-order.test.ts:198 硬编码断言同步 `/60`→`/50`。
- Verification: 定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 18 tests 全通过；`npx eslint` 两个改动文件 0 error；grep 确认无其他测试引用旧颜色字符串。
- Boundaries: 仅调整透明度档位，`/50` 为该文件既有写法（分区标题、菜单标签），未引入新视觉模式，DESIGN_LANGUAGE.md 无具体档位约定、无需更新；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：release-v1.9.0

- Feature: minor 发布 v1.9.0（release-v1.9.0，**已完成**）
- Status: done — v1.8.1 tag（35e0863）之后 dev 累计 11 个提交（文档预览+移动端 H5、Monaco 本地打包、SSE/Cloud/git 状态修复、SQLite persist 优化与 synchronous=NORMAL、vendor node-pty、包体裁剪、todo 图标），含新功能与分发行为变化，经用户确认按 **minor** 发布 v1.9.0；npm 1.8.1 从未发布，用户决策跳过、由 1.9.0 直接取代。
- Release changes: `npm version minor` 1.8.1→1.9.0（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.9.0] - 2026-08-26` 章节（Added/Changed/Fixed/Released，基于 v1.8.1..HEAD 11 个提交整理）；README.md 版本徽章更新为 1.9.0（安装命令使用 @latest，无其他版本引用）。
- Verification: 完整 `npm run test` → **259 files / 2340 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.9.0.tgz`（7.4MB / unpacked 24.2MB / 453 files，含 vendor/node-pty 四平台）；打包元数据校验 version 1.9.0、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies。
- Release sequence: 本轮变更构成 release commit（7 个预期发布文件），随后 master 快进到发布提交、创建 `v1.9.0` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：git-status-connection-pool-guard

- Feature: git/status 慢请求钉死浏览器连接池的防护（git-status-connection-pool-guard，**已完成**）
- Status: done — 用户反馈 `GET /api/git/status` 请求「导致后续请求全部被阻止」。日志定位（`~/.quickforge/logs/server-2026-08-26.log`）：12:28:46 页面刷新后同时对 default 与 97e168b3 两项目发起 4 个无 signal、无超时的 git/status（App.tsx 标题栏 `refreshTitleGitStatus` 与 ChatPanelHost 分支探测各一），这两个仓库各需 141-146s（`listGitStatus` 的 `git status --porcelain=v1 -z --untracked-files=all` + numstat + 未跟踪文件行数统计在大仓库上极慢；73cb87e5 项目仅 ~500ms）；4 条慢连接 + 2 条常驻 SSE（channels/agents events）恰好占满 HTTP/1.1 同源 6 连接池，期间服务端其他请求全部 1ms 正常完成（非服务端阻塞），12:31:08 慢请求结束后积压的 default-options 请求立即成串放出，证实浏览器侧连接耗尽。修复（服务端不动）：`workspace-api.ts` `getGitStatus` 统一组合 20s 超时（TimeoutError DOMException 中止、成功结算后清理计时器、桥接外部 signal 的 abort）；`App.tsx` 新增 `titleGitAbortRef` 中止上一请求、abort/超时静默不写警告、项目 scope 切换 effect 立即中止在途请求；`ChatPanelHost.tsx` 分支探测挂 AbortController，卸载或 `gitProjectId`/`revision` 变化即中止。WorkspaceInspector 既有 force-abort 逻辑不变，超时落入既有 error+重试按钮路径。用户最初贴的 e14ed8a7 请求 503 为另一现象：命中 dev server 重启后 ~1s 启动维护窗口（`resolveMaintenanceGate` fail-closed），与连接池问题无关、无需修复。
- Verification: 定向 `npx vitest run tests/frontend/git-status-request-lifecycle.test.ts` → 1 file / 8 tests 全通过（20s 超时边界 19999/20000、外部 abort 即时传播、预先 aborted signal、成功后计时器清零，及三个调用方源码契约）；相关回归 5 files / 29 tests 全通过；`npx eslint` 4 个改动文件 0 error；`npx tsc -b --pretty false` 通过。未跑全量 test/lint/build。
- Boundaries: 未改服务端 git 路由与 `listGitStatus` 实现；未新增依赖；未 commit/tag/push；`docs/wiki/src/components/README.md` 已同步（ChatPanelHost 行数 1552→1581 + git status 请求生命周期一条）。
- Next step: 无 blocker。Notes（后续独立事项）：①`listGitStatus` 在 default/97e168b3 仓库耗时 100-146s，候选方向为 `--untracked-files` 粒度/仓库级配置、轻量 status 端点（标题栏与分支徽标只需 branch/counts 却调用全量端点）、并发去重或 fsmonitor/untrackedCache；②release-v1.8.1 发布门禁需含本改动全量重跑 test/lint/build。

## Completed Feature：switch-sqlite-synchronous-normal

- Feature: SQLite synchronous FULL→NORMAL（switch-sqlite-synchronous-normal，**已完成**）
- Status: done — 用户知情决策（已向用户完整解释权衡后拍板"改一下"）：接受 OS 崩溃/断电回滚「最后一次 checkpoint 以来已提交事务」的有界窗口，消除大 persist COMMIT 段的逐事务 fsync（含杀毒扫描/机械盘/网络盘下的延迟尖刺）。`server/sqlite/database.mjs`：`SQLITE_SYNCHRONOUS` 2→1（注释含决策历史链）、`configurePragmas` 以常量注入 `PRAGMA synchronous`、`publicHealth` 摘要从硬编码 `'full'` 改为 `SQLITE_SYNCHRONOUS_NAMES` 按常量派生、safety argument 注释改写为 NORMAL 语义（WAL 帧校验和保证任意崩溃模式下事务原子性/文件不撕裂；NORMAL 仅放弃逐 COMMIT fsync，进程崩溃安全；quick_check 7 天节奏不变，仍管 bit-rot）。文档按 §3.1 预设的回退条款格式显式记录：`sqlite-storage-foundation.zh-CN.md` §3.1 追加 2026-08-26 修订段（明确会话域存储 v2 无 mirror JSON 兜底、窗口内丢失即真实丢失）、`session-storage-current-architecture.zh-CN.md` 已定案条目更新为现况、wiki pragma 校验行同步。测试：foundation 断言 `.toBe(2)`→`.toBe(1)`、health `'full'`→`'normal'`。
- Verification: 定向 vitest 8 文件（sqlite-storage-foundation/lifecycle、quick-check-gate、compatibility-spike、session-state-repository/service/phase3、agent-manager.persist-session-state）→ 8 files / 66 tests 全通过；eslint 改动文件 0 error。
- Boundaries: 只动 pragma 值与派生逻辑，未改事务协议/连接管理；唯一 DB 打开点 database.mjs:301 每次都经 configurePragmas，全连接生效；未新增依赖；未 commit/tag/push。
- Next step: 无 blocker。与 optimize-persist-encoding-yield 叠加后，大 persist 的事件循环占用 = 分批编码微停顿 + 单段同步写（无逐事务 fsync）；观察 200ms 慢日志确认分布。release-v1.8.1 发布门禁需含本改动全量重跑。

## Completed Feature：optimize-persist-encoding-yield

- Feature: 大会话持久化优化——单遍 canonical 序列化 + 编码分批让出事件循环 + 慢日志阈值 200ms（optimize-persist-encoding-yield，**已完成**）
- Status: done — 背景：Node 单线程事件循环上，大会话 persist 的「每条消息 3 遍 JSON 序列化 + 同步 SQLite 事务」会独占线程，卡住所有在途请求（代码注释自认，SLOW_PERSIST_LOG_MS 慢日志可观测）。按用户拍板实施评估项 ①+③ 与阈值调整，synchronous=NORMAL 与 worker 线程不动。① 新增 `server/sqlite/canonical-json.mjs`：单遍 canonical 序列化器，与旧 `JSON.stringify(canonicalize(JSON.parse(JSON.stringify(x))))` 流水线**字节级等价**（toJSON 一次语义、undefined/function/symbol 对象值丢弃/数组位补 null、bigint 抛 TypeError、数字/字符串委托 JSON.stringify 格式化、键 UTF-16 码元排序），`tests/server/canonical-json.test.mjs` 差分测试 54 用例钉死等价（含 Date/toJSON 变体/null-proto/稀疏数组/lone surrogate/200 层嵌套/500 条消息）；repository 的 encodeMessage/messageDigest 切换至新序列化器，消息编码 CPU ≈ 原 1/3，digest 与既有库行完全兼容（jsonAndDigest 保留 round-trip——其调用方消费规范化 value 副本且仅处理小 body）。③ repository 新增 `encodeMessagesChunked`（默认 50 条/批，批间 setImmediate 让出事件循环）+ `normalizeRecord` 接受对齐的内部 `messagesEncoded` 预编码旁路；service 层 `savePair` 拆出 `savePairWithPlan` + 新增 `savePairChunked`：仅当 `saveSessionStatePair` 带 expectedRevision（CAS）时走「先 plan → 分批编码（yield）→ 同步事务」，yield 间隙并发提交由前置 revision CAS 转为 conflict 重试（saveInTransaction 先查 revision 再写行，无撕裂写窗口）；无 CAS 调用方保持全同步路径，`saveSessionBody`/`atomicSessionRecordUpdate` 等同步 facade 零波及。**评估并否决**「跨 yield 持事务分批 INSERT」：事务跨 await 期间其他同步写者会经 savepoint 加入该事务，中途失败 ROLLBACK 连带回滚其已确认写入（换独立连接则 busy_timeout 同步阻塞重造全局停顿），故事务内 INSERT+COMMIT 保持单段同步——残余的同步写突刺（INSERT+fsync）由慢日志量化后决定是否升级 worker 线程方案。观测：`SLOW_PERSIST_LOG_MS` 1000→200（注释同步更新），`persistAuthoritativeSessionState` 对异步化后的 saveSessionStatePair 补 await（phase3 测试同步调用点同步补 await）。
- Verification: 定向 vitest 13 文件（canonical-json、session-state-repository/service/messages/backup/import/lifecycle/phase3/offline-export、storage facade、auto-archive、session-index-sqlite-source、agent-manager.persist-session-state）→ 13 files / 166 tests 全通过；新增用例：差分 54、encodeMessagesChunked 的 FIFO immediates 有序性证明（events ['external','done']）、预编码旁路与同步路径落库逐行字节一致、messagesEncoded 错位抛 TypeError；eslint 7 个改动文件 0 error。早期一轮并行全量出现 1 例时序抖动，随后两轮全量均绿。未跑完整 test/lint/build（服务端聚焦改动；release-v1.8.1 发布门禁时全量重跑）。
- Boundaries: SQLite 事务语义/事务包装器/WAL+synchronous=FULL 未动；digest 算法不变（差分测试保证跨版本兼容）；未新增依赖；docs/wiki/server/README.md 已同步 repository/service 两条描述；未 commit/tag/push。
- Next step: 无 blocker。建议跑一段时间 200ms 慢日志观察真实分布：若同步写突刺（INSERT+COMMIT 段）仍显著，后续候选为 worker 线程承载 SQLite（根治）或 replace 模式按 digest 差异只重写变更行（缩事务）；synchronous=NORMAL 属产品权衡待用户单独拍板。

## Completed Feature：vendor-node-pty-runtime

- Feature: 终端 node-pty 运行时 vendor 化——npm 包自带四平台预编译（vendor-node-pty-runtime，**已完成**）
- Status: done — 背景：node-pty 1.1.0 npm 包全平台一锅端（tarball 15MB / 解压 61MB，约 48MB .pdb 死重），作为 optionalDependencies 使消费端安装沉重且离线包终端不可用；经调研（功能层面无可替代、@lydell/node-pty 为 beta、上游 npm 包已内置四平台 prebuilds 且运行时经 lib/utils.js `loadNativeModule` 按 build/Release→prebuilds/<platform>-<arch> 相对路径自解析、N-API ABI 跨 Node 稳定、MIT 允许再分发）实施本地挑运行集方案：新增 `vendor/node-pty/`（5.3MB：lib/*.js 13 文件 + win32-x64/arm64、darwin-x64/arm64 prebuilds 全部去 pdb + LICENSE + licenses/ 第三方文本），目录内 `{"type":"commonjs"}` package.json 标记解决仓库根 ESM 与 CJS lib 冲突（否则 require 报 exports is not defined），`VENDOR.json` 记录来源 node-pty@1.1.0 与平台清单，winpty/conpty MIT 许可文本从 rprichard/winpty 与 microsoft/terminal 官方仓库补齐（上游 npm 包未携带）。`scripts/vendor-node-pty.mjs` 一键重新同步（升级 node-pty devDependency 后 `npm install && node scripts/vendor-node-pty.mjs`，保留 licenses/ 与 README）。`server/terminal/terminal-manager.mjs` loadPty() 改 vendor 优先 → `require('node-pty')` 回退 → 双失败 503（PTY_UNAVAILABLE_MESSAGE 更新为平台运行时缺失语义），导出 vendoredPtyEntryPath()，darwin 加载成功后 ensureVendoredSpawnHelperExecutable() 自愈 spawn-helper 执行位（macOS posix_spawn 直接执行该二进制、Windows 打包 tarball 丢失执行位，git index 对两个 darwin spawn-helper 标记 100755，Windows 重新生成后需重设）；node-pty 自 optionalDependencies 移至 devDependencies（仅作同步源），npm 消费端不再安装 15MB 依赖、win/mac 终端开箱即用且离线可用，Linux 无上游预编译、终端需自装 node-pty 否则优雅降级。package.json files、prepare-runtime/offline-package copyEntries、electron-builder files+asarUnpack 均纳入 vendor。
- Verification: node 冒烟：vendor 入口 require + cmd.exe spawn 收到 200 字节输出 + onExit 正常（kill 阶段 `AttachConsole failed` 为上游 1.1.0 已知噪音，官方 node_modules 副本同样存在，与 vendor 无关）；定向 vitest `tests/server/terminal-vendor-runtime.test.mjs` → 5 tests 全通过（布局/许可/排除 pdb 契约 + terminalCapabilities() enabled 且 require.cache 断言真实从 vendor 加载）；eslint 3 个改动文件 0 error；`npm install --package-lock-only` 同步 lock；`npm pack --dry-run` → 7.4MB / 452 files（vendor 前 4.8MB，+2.6MB）；完整 `npm run test` → 257 files / 2275 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX/chunk size warnings）。
- Boundaries: 已同步 docs/wiki/server/README.md（terminal/ 节新增「PTY 运行时加载」）、docs/wiki/root-config.md（发布包含 vendor/）、docs/architecture/patch-release-runbook.zh-CN.md（3.6 与注意事项改为 vendor 语义）；docs/bug/server-bugs.md 的 node-pty 提及为 API/生命周期议题、与分发无关未动；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 commit/tag/push。desktop 安装包会随 vendor 带入全部四平台二进制（各平台安装器多 ~2.6MB 压缩前），如需按目标平台裁剪 electron files 可作后续优化。
- Next step: 无 blocker；发布门禁（release-v1.8.1 或其后版本）需纳入本改动重新完整验证；可选真机验证 npm 消费端安装后终端开箱即用、macOS arm64 实测 vendor 加载、Electron 桌面包终端可用（asarUnpack 生效）。升级 node-pty 时记得跑同步脚本并核对 licenses/。

## Completed Feature：package-size-trim

- Feature: 包体裁剪——qf-agent 暂时下线 + 前端依赖归位 + Monaco 语言 worker 移除（package-size-trim，**已完成**）
- Status: done — 三项裁剪按用户决策落地：①qf-agent 不再随包分发：package.json files、prepare-runtime/offline 两个脚本 copyEntries 移除 runtime-assets，electron-builder 删除 agent extraResources 与平台 helper，electron-main 删除 desktopAgentPath/qfAgentPath，git rm 五平台二进制 52MB；server/cloud/qf-agent-process.mjs 不动，二进制缺失时状态 unavailable，QUICKFORGE_QF_AGENT_PATH 仍可外部指定，恢复分发只需还原二进制与四处打包引用。②mermaid/react-markdown/remark-gfm/@dnd-kit×3/@capacitor×3 移回 devDependencies（服务端运行时仅需 9 个真依赖），lock 仅 dev 标记变化；npm 消费端每次安装省约 93MB，并消除桌面 asar 吸入 mermaid 的隐患。③Monaco 只读查看器去掉 json/css/html/ts 语言 worker（叠加于 monaco-local-bundled-loading）：monaco-local.ts 改为 editor.api + editor.all + monaco-basic-languages.ts 聚合 Monarch + 仅 editor.worker，不引入 vs/language 贡献；TS/JS/CSS/SCSS/LESS/HTML 由 Monarch 着色，JSON 无 Monarch 以纯文本呈现（已知取舍）；新增 src/monaco-esm.d.ts 补深路径类型。
- Verification: 定向 vitest（monaco-local、qf-agent-process、public-api、electron-desktop-notifications-structure、workspace-inspector tabs/on-demand）全通过；eslint 改动文件 0 error；node --check 打包/desktop 文件通过；tsc -b 通过；npm run build 成功（dist 26MB→17MB，四个语言 worker chunk 消失，editor.worker 保留）；npm run lint 0 errors / 1 既有 warning；完整 npm run test → 256 files / 2269 tests 全通过；prepare-runtime-package 重建 + npm pack --dry-run → 4.8MB / 414 files（对照 v1.7.10 24.1MB），打包 dependencies 仅 9 个运行时依赖。
- Boundaries: vite.config.ts 保持并行会话最新状态未改动（monaco 无 manual chunk 为其刻意决策）；server/cloud/qf-agent-process.mjs 与 public-api.mjs qfAgentPath option 未动；已同步 docs/architecture/quickforge-cloud-client.zh-CN.md、docs/design/remote-access-p2p.md、docs/wiki/server/README.md、docs/wiki/src/components/README.md；未新增/升级依赖版本，未 commit/tag/push。
- Next step: 无 blocker；发布时注意 v1.8.1 之后的版本 tarball 将从 ~24MB 降至 ~5MB；Cloud 远程访问功能处于不可用（unavailable）状态直到恢复 agent 分发（或用户经 QUICKFORGE_QF_AGENT_PATH 自备二进制）；可选真机目视 Reader/Diff 中 TS/CSS 着色正常、JSON 纯文本呈现。

## Completed Feature：monaco-local-bundled-loading

- Feature: Monaco 编辑器本地打包加载（monaco-local-bundled-loading，**已完成**）
- Status: done — 起因：Edge Tracking Prevention 提示 jsdelivr 存储访问，且 package-offline 断网时 Monaco 编辑器加载不出（`@monaco-editor/react` 默认经 `@monaco-editor/loader` 从 `cdn.jsdelivr.net` 运行时拉取 monaco-editor@0.55.1）。现新增 `src/components/workspace/monaco-local.ts`：`ensureLocalMonaco()` 模块级单例，函数内 `Promise.all` 动态 import `monaco-editor` 与 editor/json/css/html/ts 五个 `?worker`，设置 `self.MonacoEnvironment.getWorker` 按 label 分发，再经 `loader.config({ monaco })` 注册本地实例；顶层只 import `loader`（Environment 为 type-only），monaco 本体不进首屏静态图。`MonacoCodeViewer.tsx` / `MonacoDiffViewer.tsx` 增加 `monacoReady` gate（useEffect + cancelled 清理，保证 config 先于 `loader.init()`；未 ready 返回 null，其余 props/options 不变）。`vite.config.ts` 删除 monaco manualChunks 分支：实测保留 manual chunk 时 rolldown 会把共享 vite/preload-helper 收编进 monaco chunk、经 modulepreload 把 4MB 拖回首屏；删除后 monaco 家族为纯异步 chunk（editor.api2 3.63MB/gzip 926KB + 5 个独立 worker），index.html preload 11 项与入口静态闭包均不含 monaco，首屏不变。`@monaco-editor/loader` 默认 config 的 jsdelivr 字符串为死代码（dist 残留 1 处、无运行时网络请求）。
- Verification: 定向 vitest 4 files / 29 tests（monaco-local 5 + markdown-reader 2 + workspace-inspector-tabs 19 + mobile-fullscreen-adaptation 3）全通过；eslint 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；dist 只读检查确认 preload/静态闭包无 monaco、worker 正常生成、jsdelivr 仅 1 处死字符串。未跑全量 test/lint。
- Boundaries: 未新增依赖（monaco-editor@0.55.1 本就是 devDependency 且已安装）；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 仅重建被忽略的 dist/）；未 commit/tag/push；cloud-models-timeout-nonblocking 并行改动未触碰。已同步 `docs/wiki/src/components/README.md`。
- Next step: 无 blocker；可选真机（含断网 offline 包/Electron）验证代码/Diff 查看器加载与语法高亮；`release-v1.8.1` 发布门禁需纳入本改动重新完整验证。

## Completed Feature：cloud-models-timeout-nonblocking

- Feature: Cloud 模型超时正确映射与非阻塞加载（cloud-models-timeout-nonblocking，**已完成**）
- 根因: 用户反馈 `GET /api/cloud/models` 500。日志证实为 dev server 重启后冷缓存回源 `https://qf.shawnstack.com/v1/models`，上游偶发慢响应超过默认 10s 超时（`TimeoutError` 非 `CloudApiError`）被全局 `sendError` 兜底成 500；且 `/api/models/catalog` 在 `server/model-catalog.mjs` 串行 await Cloud 目录导致主目录接口同步挂 ~10s（日志中与失败同一毫秒返回）。
- Status: done — 服务端：`server/cloud/client.mjs` 将 fetch `TimeoutError` → `CloudApiError(504, cloud_timeout, retryable)`、网络 `TypeError` → `502 cloud_unreachable`，外部 AbortError 原样抛出；`server/model-catalog.mjs` 新增 2s 短截止（`CLOUD_MODELS_CATALOG_WAIT_MS`，可注入 `cloudWaitMs`），超时先降级仅本地/自定义模型，底层请求继续暖 60s identity 缓存，raced promise 挂 catch 防 unhandled rejection。前端：`useCloudModels` 失败后 30s 负缓存（非 refresh 直接返回 `[]`）；`resolveNewSessionModel` 与 `useAppBootstrap` 持久化 Cloud 模型恢复最多等 5s（`CLOUD_MODEL_RESOLUTION_TIMEOUT_MS`），超时走既有本地 configured 回退；`default-options-settings-tab` 首屏不再 await Cloud 目录，Cloud 到达后带 `loadSettingsGeneration` 代数守卫增量合并并按 defaults 重新解析自动选中（手动改选不覆盖），类加 `export` 供测试实例化。
- Verification: 定向 `npx vitest run` 10 files / 98 tests 全通过（client 504/502/AbortError 分类、catalog 短截止与后台失败、负缓存与 refresh 绕过、5s 回退、设置页增量合并，含 routes/cloud、cloud identity/models、cloud-client 回归）；`npx eslint` 12 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 已同步 `docs/architecture/quickforge-cloud-client.zh-CN.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/hooks/README.md`、`docs/wiki/src/lib/README.md`；未新增依赖，未手工修改生成产物，未 commit/tag/push；工作区 Monaco 相关并行改动（`MonacoCodeViewer/MonacoDiffViewer/monaco-local.*`、`docs/wiki/src/components/README.md`）未触碰。慢而正常的上游（>2s）下 catalog 该次响应不含 Cloud 模型，下一次请求命中缓存即恢复，属可接受降级。
- Next step: 无 blocker；可选真机验证：断网/慢代理下模型选择器、新建会话与 Defaults 设置页不再长时间阻塞，网络恢复后 Cloud 模型自动回来。

## Completed Feature：mobile-h5-fullscreen-sidebar-and-inspector

- Feature: 移动端 H5 侧栏整屏与 Inspector 全屏覆盖（mobile-h5-fullscreen-sidebar-and-inspector，**已完成**）
- Status: done — 左侧会话侧栏移动抽屉 100% 整屏：`ChatSidebar.tsx` 移动分支改为 `isMobile ? 'flex h-full w-full flex-col'`，`App.tsx` 抽屉包装 div 移除 `max-w-[85vw]`，桌面宽度/resize/inline style 不动。右上工具栏 PanelRight 开关由 `hidden ... lg:inline-flex` 改为全断点 `inline-flex`（disabled/onClick/aria-label 不变），移动端可打开 Inspector。`WorkspaceInspector.tsx` 新增 `narrowViewport`（`matchMedia('(min-width: 1024px)')`，对应 Tailwind lg 断点，防御式写法兼容 vitest node 无 matchMedia）与 `mobileOverlay = narrowViewport && mounted`：根 aside 在 mobileOverlay 时复用既有 `quickforge-workspace-inspector-fullscreen` 以 z-20 全屏覆盖（原首行 `hidden` 移入条件分支；不设 width style、隐藏 resize separator），header 继续走 `pr-[5.5rem]` 为右上工具栏预留、PanelRight 可点关闭；桌面 fullscreen z-40、Maximize2、Escape 逻辑不变。
- Verification: `npx vitest run` 定向 7 files / 66 tests 全通过（含新建 `tests/frontend/mobile-fullscreen-adaptation.test.ts` 3 个源码契约用例与更新的 side-chat-workspace-tab 首用例）；`npx eslint`（App/ChatSidebar/WorkspaceInspector/两个测试文件）→ 0 error；`npx tsc -b --pretty false` → 通过；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；feature JSON 解析通过。未跑全量 test/lint。
- Boundaries: 不动 `GitToolsPinnedSummary` 的 `hidden md:flex` 与小屏隐藏“更改”入口（Inspector 已提供移动覆盖布局，GitTools 更改入口维持现状）；不动 Inspector 内部桌面 fullscreen/Maximize2/Escape 逻辑；未新增依赖，未手工修改生成产物（`dist/` 为 build 命令自动生成），未 commit/tag/push；`docs/wiki/src/components/README.md` 已同步 ChatSidebar/WorkspaceInspector/GitToolsPinnedSummary 三处。
- Next step: 无 blocker；可选真机（H5/Android WebView）目视验证整屏侧栏、PanelRight 开关与 Inspector 全屏覆盖的关闭交互。

## Completed Feature：todo-pending-status-icon-hollow-circle

- Feature: Todo 未开始状态图标改为空心圆（todo-pending-status-icon-hollow-circle，**已完成**）
- Status: done — 先在 `design-mockups/todo-pending-icon-options.html` 提供 5 个候选（A 空心圆 / B 点状虚线圆 / C 缺口环 / D 圈+短横线 / E 纯实心点），均按真实面板样式与 14px 实际尺寸渲染并支持深浅主题切换，用户选定方案 A。实现仅替换 `src/components/chat/panel-decoration/todo-write-summary.ts` 中 `statusIcon()` pending 分支的 SVG 字符串：删除中心实心小圆点只留外圈。三态统一为「外圈+内部符号」语言：无符号 = 未开始、时钟指针 = 进行中、对勾 = 已完成。颜色、尺寸、`fill:none; stroke:currentColor; stroke-width:2` 约束不变，未改 CSS。
- Verification: `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → 2 files / 30 tests 全通过；`npx eslint src/components/chat/panel-decoration/todo-write-summary.ts` → 0 error；`npm run build` → 成功（仅既有 KaTeX 字体与 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 纯局部图标替换不改变架构、模块职责或公共入口，docs/wiki 无需更新；复用既有描边图标体系，无新视觉模式，DESIGN_LANGUAGE 无需修改。未新增依赖，未手工修改生成产物，未 commit/tag/push；设计稿保留作决策记录。
- Next step: 无 blocker；可选真机目视深浅主题下任务摘要三态图标。

## Completed Feature：workspace-document-preview

- Feature: Workspace 文档预览 — PDF/DOCX/XLS/XLSX（**已完成**）
- Status: done — WorkspaceInspector 新增顶层 `document` Tab，Files 文件树与 `present_files` 两条入口统一按 `artifactPreviewMode` 三路分流（Reader/Browser/Document）。服务端 `inferPresentedFileKind` 与前端 `tool-artifacts.ts` 识别 `pdf/docx/excel`（XLS/XLSX 合并为 excel），`preview:false` 仅禁止自动打开、仍可手动预览。二进制复用 `/api/workspace/preview` 路由：仅扩展允许扩展名与 MIME（pdf/docx/xls/xlsx），50 MiB 上限、路径安全校验、realpath 复查、敏感文件拦截、ETag/304 与 `__quickforge_check=1` 预检全部沿用；未新增 document API、HEAD 或 Range。
- Renderer: `WorkspaceDocumentContent` 按格式动态 import 解析库（避免 Vitest Node 顶层 DOMMatrix 问题）：PDF 用 pdfjs-dist + 本地 Worker URL + IntersectionObserver 可见页懒渲染（DPR 上限 2、缩放 ≤2、render 按 canvas+viewport）；DOCX 用 docx-preview `renderAsync`（breakPages/页眉/页脚，独立 body/style 容器隔离样式）；Excel 用 xlsx 主线程解析、多 Sheet 切换 + 100 行/页分页 + 5000 行截断提示；数据重新加载后 sheet/页码自动重置。Tab 仅持久化 `{path, format}`，同路径复用并递增 `reloadNonce` 刷新；`revision` 由 `max(reloadNonce, manualNonce)` 派生，无 effect 内 setState。
- Dependencies: `pdfjs-dist@5.4.394`、`docx-preview@0.3.7`、`xlsx@0.20.3`（SheetJS CDN tarball 源不变）由 pi-web-ui 传递依赖提升为 QuickForge 直接 devDependencies，版本与既有锁定完全一致；lock 仅新增 3 行直接依赖声明，无升级、无新库类别。构建确认动态 import 复用既有 pi-web-ui chunk 模块，未重复打包。
- Verification: 定向 `npx vitest run`（tool-artifacts/artifact-preview-utils/workspace-inspector-tabs/server tools index+definitions/workspace-preview）→ 6 files / 169 tests 全通过；完整 `npm run test` → 253 files / 2247 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92`）；`npm run build` → 成功（仅既有 KaTeX 字体与 chunk size warnings）。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/server/routes/README.md`；未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push。PPT/PPTX/DOC/XLSM 不在本期范围，仍为 unsupported。
- Next step: 无 blocker；可选后续为真机（Electron/Android 远程）目视验证大文件 PDF/Excel 渲染与内存表现。

## Completed Feature：fix-cutover-startup-bugs

- Feature: 修复 cutover 启动链缺陷（fix-cutover-startup-bugs，**已完成；本轮完成 Share/LAN/Scheduled Runs 启动完整性收口**）
- Status: done — migration 12 原子物理删除 Share/LAN 在线 `record_digest`；repository 不再逐行维护或验证派生哈希。Share/LAN 的 `sqlite_authoritative_json_pending` 与 `authoritative` 常规启动只 drain 事务性 JSON mirror outbox，清空后保留已有 storage state 元数据并提升 authoritative，不做全表扫描或域内 `quick_check`。Scheduled Runs authoritative 常规启动不再调用 health quick check；SQLite 打开、schema 与 migration 等真正整库门禁仍由 `initializeSqliteStorage()` 负责。首次 cutover 的双读/备份/replace/快照 count-digest/关系校验及 backup/restore/export 边界保持严格。
- Share consistency: 普通 update 和未显式 tokens 的重复 create 保留现有 tokens；密码变化时清 token，若显式提供替代 tokens 则统一绑定新的 `authVersion`；supersede 物理删除旧 token；issue/prune 的返回值、数据库 `updated_at` 和 mirror 时间一致。启动恢复指引改为停进程、完整复制整个 dataDir（含 SQLite/WAL/SHM）、按实际错误域诊断，禁止删库或盲跑 session downgrade。
- Verification: 定向回归 17 files / 135 tests 通过；Share 修复聚焦回归 5 files / 34 tests 通过；完整 `npm run test` → 253 files / 2219 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Boundaries: 已同步 Share/LAN/SQLite 架构文档及 server Wiki；未新增依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。当前未实现域级 `READY_DEGRADED` 或统一离线 restore CLI，这些不属于本轮最小收口。
- Next step: 无 blocker。

## Completed Feature：sidebar-five-item-display-shared-scroll

- Feature: 侧栏会话五条递增展示与统一中部滚动（**已完成**）
- Status: Projects 时间线、每个展开项目和 Tasks 默认显示 5 条；唯一可见控件“显示更多”每次增加 5 条，不显示“收起”。显示更多行复用普通 session 行的 `text-sm / leading-5`、`py-1.5 / px-2`、圆角、水平布局和整行点击区域，仅以 muted 灰色降低视觉层级；中英文 show-less i18n 已删除。只有下一组超过当前已加载数据时才调用既有 `loadMore`，并等待分页层确认确有新增数据后才提交展示数量；异步失败保持原数量、允许重试。每个 timeline/global/project key 独立维护 generation 与 pending generation：快速重复点击仍合并为单请求；用户在 pending 期间折叠 Projects/Tasks、折叠单项目、折叠全部项目或切换时间线视图触发重置时，对应 generation 立即递增，旧 Promise resolve true 后也不会提交旧 nextVisibleCount。`useSessionPagination` 的 `PAGE_SIZE=20` 保持不变且无页码。共享折叠 props、展开项目集合和 `sessionViewMode` 变化会让桌面/移动两个本地实例都执行 previous ref + effect 兜底重置；视图模式变化时每个实例将 timeline 恢复 5 条并 invalidate pending generation，初始挂载跳过，区块/项目 DnD 临时视觉折叠不重置展示数量。
- Layout / DnD: Pinned、Projects、Tasks 共用侧栏中部唯一纵向滚动容器，移除了 Pinned/Projects/Tasks 和项目子列表固定高度及内部纵向滚动，内容自然撑开；底部服务器/更新/设置区仍固定在外部。Pinned sentinel 保留且折叠时禁用；Projects 时间线、项目内列表、Tasks sentinel 已删除。项目拖拽自动滚动只允许共享侧栏容器，预览边界由纯函数计算 Projects 内容区域与共享视口的合法可见交集；矩形缺失、交集为空或夹紧上下界反转时只锁定横向、不构造 `top > bottom` 的非法边界。
- UX / i18n: 仅新增中英文“Show more / 显示更多”；显示更多整行与普通 session 的字号、行高、水平布局、圆角和点击区域一致，使用 muted 灰色及克制 hover/focus ring。无可见“收起”按钮，show-less 中英文 i18n 已删除；符合现有 DESIGN_LANGUAGE，未修改规范本身。
- Verification: 局部收口后，定向 `npx vitest run tests/frontend/sidebar-session-display-limit.test.ts tests/frontend/sidebar-section-order.test.ts tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/session-pagination-bootstrap.test.ts tests/frontend/project-drag-boundary.test.ts` → 5 files / 48 tests 全通过；新增契约锁定显示更多与普通 session 共用行/标题基类、muted 灰色、无 `onCollapse`/show-less key，并继续覆盖共享 `sessionViewMode`、折叠重置与 generation 竞态保护。目标 ESLint 0 error；完整 `npm run test` → 253 files / 2210 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 与 feature JSON 解析通过。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`；未新增依赖，未手工修改生成产物，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。

## Current Feature：release-v1.8.1（已完成）

- Feature: patch 发布 v1.8.1（release-v1.8.1，**已完成**）
- Status: done — 最终基线为 `35e0863`（b81effaa + 发布说明文档刷新），`v1.8.1` tag 已创建并推送远端，master/dev 均已同步到该提交。
- Release facts: npm 上 1.8.1 从未发布（latest 停留在 1.8.0）；经用户决策跳过补发，由 v1.9.0 直接取代（见上方 release-v1.9.0）。
- Next step: 无。后续发布流程见 release-v1.9.0。


## Completed Feature：remove-side-chat-title-entry-global-inspector-access

- Feature: 移除对话顶部 Side Chat 入口并保持全局 Inspector 可达（remove-side-chat-title-entry-global-inspector-access，**已完成**）
- Status: done — `App.tsx` 已彻底移除主对话标题区 Side Chat 按钮、`openWorkspaceSideChat`，以及只为该按钮显隐服务的 `sideChatTabOpen / onSideChatPresenceChange` 状态链；`sideChatOpen` 中英文 i18n 键因全仓无引用一并删除。
- Inspector: Side Chat 仍保留在 Workspace Inspector 的 `+` 菜单和空 Tab 入口，继续要求活动主会话与可用模型，重复打开只激活单实例运行时 Tab；关闭自身、关闭其他、关闭全部和切换 runtime scope 仍会 reset/abort/清空。桌面主工具栏 `PanelRight` 按钮不再依赖 `currentToolProject.id`，global/无项目会话也会挂载并可展开 Inspector；仍保留 `needsModelSetup` 禁用和 `lg:inline-flex` 桌面断点，移动端未新增入口。
- Verification: 定向 `npx vitest run tests/frontend/side-chat-workspace-tab.test.ts tests/frontend/workspace-inspector-tabs.test.ts tests/frontend/workspace-inspector-on-demand-source.test.ts tests/frontend/workspace-inspector-open-state.test.ts tests/frontend/workspace-inspector-request.test.ts` → 5 files / 46 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` → 成功，仅既有 KaTeX 字体解析与 chunk size warnings；`git diff --check` → 通过。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`；无需修改 `DESIGN_LANGUAGE.md`，因为没有新增视觉或移动交互模式。未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿未触碰。
- Next step: 无 blocker；可选桌面真机确认 global/无项目会话主工具栏右侧栏按钮可展开 Inspector，以及 Inspector 内两类 Side Chat 入口仍为单实例。

## Completed Feature：remove-todo-summary-bottom-border

- Feature: 移除 TodoWrite 任务摘要底部横线（remove-todo-summary-bottom-border，**已完成**）
- Status: done — 仅删除 `src/index.css` 中 `.quickforge-todo-summary` 的 `border-bottom` 声明；任务摘要的布局、背景、交互及其他业务代码/样式均未改。
- Verification: `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/slash-invocation-chip.test.ts` → 2 files / 44 tests 全通过；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Boundaries: 局部样式调整不改变架构、模块职责或公共入口，docs/wiki 与 `DESIGN_LANGUAGE.md` 无需更新；未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿未触碰。
- Next step: 无 blocker；可选真机目视确认输入框上方任务摘要底部横线已消失。

## Completed Feature：todo-write-sticky-summary

- Feature: TodoWrite 输入框上方任务摘要与专用历史渲染（todo-write-sticky-summary，**已完成**）
- Status: done（位置调整、审查 major 修复、定向验证与完整门禁均已完成）
- Scope: 服务端完整快照型 `todo_write` 协议与持久化语义不变。前端最新成功快照现位于 Composer Dock 内、`message-editor` 前的正常流任务摘要：展开时自然压缩消息区，不覆盖消息或输入框；长列表在摘要内部滚动，桌面约显示 4 项、移动端约显示 3 项。Composer sibling 顺序为任务摘要 → command/file 临时建议菜单 → `message-editor` → stats，菜单紧邻输入框；历史工具调用仍在既有过程折叠中，并由专用 renderer 提供 running/error/success/clear/neutral 历史事件摘要。
- Behavior: 无有效 Todo 不显示；首次未完成自动展开；后续未完成快照保留用户手动展开/收起状态，相同内容的新 toolCall 仍提示“已更新”；全完成自动收起但允许重开；成功空数组或回滚到无快照时移除；editor/shell 重建时按当前快照自愈；`readOnly` 无 Composer Dock 时不显示。QuickForge/OpenCode 提取继续按成功快照与 `toolCallId` 配对，错误、畸形或未完成结果不覆盖已有有效快照。
- Review fixes: 两个 major 已修复：①任务摘要从聊天消息区顶部调整为 Composer Dock 正常流 sibling，并补齐 sibling 顺序、内部滚动、readOnly、重建自愈与移除边界；② Slash invocation overlay 同时观察 textarea 与 composer shell，摘要插入/展开/收起导致布局变化时重算几何，observer 在重建和卸载路径成对 cleanup。历史 renderer 文案只陈述“更新任务清单 / 清空任务清单”，不再声称同步当前 UI；running/error/neutral 与 `detailed` JSON 语义保持准确。
- Verification: 定向 `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts tests/frontend/slash-invocation-chip.test.ts tests/server/tools/definitions.test.mjs tests/server/tools/index.test.mjs tests/server/routes/tools.todo-write.test.mjs` → 6 files / 89 tests passed；`npx tsc -b --pretty false` → exit 0。最终完整门禁：`npm run test -- --reporter=dot` → 242 files / 2112 tests passed；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → passed，仅既有 KaTeX 字体解析与 chunk size warning。
- Verification process: 首次完整 `test/lint/build` 链通过；为了提取数量二次运行全量 test 时，`tests/server/cloud/qf-agent-process.test.mjs` 的 “does not double start while a restart timer is pending” 出现一次无关定时器波动（1 failed / 2111 passed）。该单文件复跑 28/28 通过，随后全量 242 files / 2112 tests 通过；未为此修改代码。
- Boundaries: 未新增或升级依赖；未新增存储表；未手工修改 `dist/`、`package-dist/`、`package-offline/` 等生成物；`DESIGN_LANGUAGE.md` 未更新，因为复用既有轻盈内嵌工具模式。
- Existing workspace noise: 任务开始前 `package-lock.json` 已有 43 行 npm peer 元数据噪音（当前 diff 14 增/29 删），本功能未修改、还原或纳入正式功能；`artifacts/todo-write-interaction-prototype.html` 为保留的 HTML 设计原型，正式实现不依赖，未归入功能 files/交付范围；无关未跟踪 `').Groups[1].Value` 未触碰、不纳入本功能。
- Next step: 仅可选真机目视输入框上方任务摘要、长列表、`/` 与 `@` 菜单、slash chip、深浅主题及窄屏。未创建 commit/tag/push。

## Current State

- Feature: 侧边聊天 Workspace Tab（side-chat-workspace-tab，**已完成**）
- Status: done — Side Chat 最终收敛为直接复用主聊天 `ChatConversationSurface → ChatPanelHost → pi-web-ui ChatPanel/MessageList/MessageEditor`：纯文本发送、停止、复制、Markdown/代码块、滚动与轮次导航正常；`+`、模型、Access、rollback/retry/fork 等主控件原位复用但 native disabled，不再实现 Side Chat 专属模型、附件、Slash、插件、文件引用、Plan、历史分叉或工具 Agent。最小内存 Agent/NDJSON 只传 user/assistant 纯文本，显示最多 40 条，请求从最新向前按完整消息裁剪至 200,000 字符；切普通 Tab 保留，关闭/关闭其他/关闭全部/切主会话时 abort/reset，Tab 不持久化。Host 隔离 localStorage、Git、通知、artifact、审批、终端、context usage/compaction 等副作用；Side Chat 初始化 `ChatPanel.setAgent()` 时保存并恢复主聊天全局 artifacts renderer，禁用装饰只关闭当前 panel 所属模型/Access 菜单。入口仅在活动主会话和模型可用时启用。服务端读取活动主会话权威纯文本上下文，固定 `tools: []`，tool call fail closed，不创建、调用或持久化主 Agent。
- Verification: 定向 Vitest 11 files / 97 tests 与隔离修复聚焦 9 files / 71 tests 全通过；`npx tsc -b --pretty false`、MJS syntax、`git diff --check` 通过；完整 `npm run test` → 249 files / 2148 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）。
- Next step: 无 blocker；Wiki 与状态已同步，本次仅提交 Side Chat，未 tag/push；未新增依赖，未手工修改生成产物。Plan pill 只在主聊天已进入 Plan 模式时存在，Side Chat 从不进入该模式，因此不额外伪造控件。

- Feature: Prompt HTTP 失败时在聊天区显示具体错误原因（prompt-http-error-message，**已完成**）
- Status: done — `ServerAgent.prompt()` 的 HTTP fetch 失败分支继续仅在乐观 user message 仍是尾部时精确回滚，随后追加唯一合法 assistant error message：空 text block、当前模型 `api/provider/id`、完整零 usage/cost、`stopReason:'error'`、服务端具体 `errorMessage` 与 timestamp。同步清理 streaming 状态，保留 error 事件，并让本地 `agent_end` 携带 `status:'error'`、`errorMessage` 和最终 messages，因此 Chat 消息区可直接显示如 `Selected model is not configured in QuickForge.` 的具体原因。
- Verification: `npx vitest run tests/frontend/server-agent.test.ts` → 1 file / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Next step: 无 blocker；已同步 src/lib Wiki。未创建 commit/tag/push，未新增依赖，未修改生成产物或架构/设计语言文档。

- Feature: 修复 Side Chat assistant 上下文缺失 usage（fix-side-chat-assistant-usage-contract，**已完成**）
- Status: done — `server/routes/side-chat.mjs` 在服务端最终模型解析、主上下文/侧聊历史纯文本安全投影和既有字符预算裁剪之后，统一物化 pi-ai 消息：user 保持合法纯文本 user message；assistant 固定为单一 text block，使用最终 `model.api/provider/id`，完整零 `usage`（含 input/output/cacheRead/cacheWrite/totalTokens 与五项 cost）、`stopReason:'stop'`、timestamp。客户端或历史中的 usage/details/tool/thinking 等字段均不信任、不回传；既有压缩语义、120k/200k 字符预算、权限和工具 fail-closed、`tools: []` 均未改。
- Verification: `npx vitest run tests/server/routes/side-chat.test.mjs tests/frontend/side-chat-agent.test.ts` → 2 files / 13 tests 全通过；目标 ESLint 0 error；`node --check` 两个 MJS 通过；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Next step: 无 blocker；已同步 routes Wiki 一句服务端消息契约。未创建 commit/tag/push，未触碰生成产物或其他并行文件。

- Feature: Side Chat 与主聊天共享完整对话显示壳（side-chat-shared-conversation-surface，**已完成**）
- Status: done — 新增极薄 `ChatConversationSurface`，统一主聊天和 Side Chat 的 `relative/flex/min-h-0/flex-1/flex-col/overflow-hidden` 与 `--quickforge-main-bg`。App 主聊天保留 `quickforge-empty-chat`、`quickforge-conversation-enter`、Hero、`NewChatProjectPicker`、`ErrorBoundary`、`Suspense` 与首次使用引导；Side Chat 用同一 surface 包住同一 `ChatPanelHost mode="side-chat"`，保持普通空白空状态，移除 `showTurnNavigation={false}`，不自绘 textarea/messages/button，不新增 side-chat CSS/class。Host 的 mode 仅保留安全能力关闭、空 tools、内存草稿与副作用隔离；DOM return/插入无视觉 mode 分支。
- Verification: 定向 Vitest 5 files / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 247 files / 2108 tests 全通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Next step: 无 blocker；实际可见差异只来自主聊天区与 Inspector 的容器宽度，消息、Composer、轮次导航和布局由同一响应式规则自然适配。未创建 commit/tag/push，未手工修改生成产物。

- Feature: 上下文统计增加 Skills/MCP 来源行（context-usage-skills-mcp-breakdown，**已完成**）
- Status: done — 服务端 `contextUsage.breakdown` 新增可选 `skillsTokens` / `mcpTokens`。最终审查收口后，Skills 不再扫描全部同名标签：以 `activate_skill` / `read_skill_resource` definition 参数枚举作为 enabled Skills 的结构化证据，只选择最后一个带系统固定介绍且包含全部启用名称的真实 catalog，再归集 Skills definitions 与已关联调用/结果；无 enabled Skills 时伪标签/伪调用为 0。MCP definition 仅接受非数组对象 `mcp` 且 `serverName` / `toolName` 为非空字符串；名称回退通过共享 `server/mcp/tool-name.mjs` 复用 registry 的真实 server canonical 与 tool sanitize/encode 规则，解析后重建并要求和原字符串完全一致，因此三处带空格、空 segment、非法 server 与未编码 tool 名均拒绝，同时接受 registry helper 生成的 canonical 名称，且未收紧 `registry.isMcpToolName()` / `callMcpTool()` 的既有公共行为。toolResult 有非空 `toolCallId` 时仅按已识别 MCP call ID 关联，错误/孤立 ID 不再降级凭名称；ID 缺失/空时才允许按已识别 canonical `toolName` 关联；ID/name 都缺失时才接受完整 `details: {mcp:true,server,tool}`。两项复用 `pi-agent-core.estimateTokens()`，是跨系统提示词/工具定义/消息三类的来源归因，不参与总量或百分比二次相加。Tooltip 在现有三行后按正数追加 `Skills` / `MCP`，缺失或 0 隐藏；圆环和总量不变。
- Verification: 最终审查定向 Vitest 3 files / 40 tests 全通过；MCP registry 额外回归 1 file / 6 tests 全通过；完整 `npm run test` → 247 files / 2119 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Next step: 无 blocker；已同步 server/components Wiki。架构、模块职责和公共入口未改变，无需更大文档更新。保留 `docs/prototypes/context-usage-source-attribution.html`，未迁移原型演示控件；未创建 commit/tag/push，未手工修改生成产物。

- Feature: 工具调用标题与参数运行态扫光（tool-call-running-title-sweep，**已完成**）
- Status: done — 普通 `LocalWorkspaceToolRenderer` 仅在 running 时为 `quickforge-tool-label` 追加 `quickforge-tool-running-sweep`，标题与参数摘要以低强度从左到右循环扫光；运行态隐藏 `renderStatus` 的 spinner/耗时，done/error/called 原状态不变。`aria-busy` 保留语义；reduced motion 关闭扫光且不增加静态运行状态；`run_command` 输出和终止按钮不变，共享 `renderStatus` 未修改。实现文件为 `src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/local-tool-running-sweep.test.ts`，设计探索稿为 `design-mockups/tool-call-running-light-sweep.html`。
- Verification: 目标 Vitest 4 files / 31 tests 全通过；目标 ESLint 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；`feature_list.json` JSON 可解析；`git diff --check` 通过。
- Next step: 无代码 blocker；局部视觉状态反馈不改架构、模块职责或公共入口，docs/wiki 无需更新；符合现有 DESIGN_LANGUAGE，未修改规范。未创建 commit/tag/push，未手工修改生成产物。

- Feature: 右侧 Inspector subagent Tab 图标复用设计稿 Bot（subagent-tab-bot-icon，**已完成**）
- Status: done — 用户要求右侧边显示 subagent 过程的 Tab 图标复用 subagent 设计里的 icon。调研确认：设计稿 `design-mockups/subagent-tool-marquee-impl.html` / `subagent-marquee-roll-switch.html` 的 subagent 类型图标即 Lucide `Bot`，且与聊天内 run_subagent 摘要卡（`local-tools.ts` renderToolIcon）和 Slash agent 图标（`slash-icons.ts` agent=Bot）一致；右侧 Inspector 现状是 `WorkspaceInspector.tsx` 两处内联 `SquareActivity`（顶部 Tab 栏 + ChevronDown Tab 下拉列表），`panelTabMeta` 对 subagent 不提供 meta。改动仅将两处 `SquareActivity` 换为 `Bot` 并同步 import（SquareActivity 全仓库无其他使用）。`workspace-inspector-tabs.test.ts` 新增源码契约测试锁定两处分支与 import。
- Verification: 定向 `npx vitest run` inspector 相关 5 files / 37 tests 全通过（含新增契约用例）；`npx eslint` 改动源码/测试 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。纯图标替换，docs/wiki 与 DESIGN_LANGUAGE 无需更新（不改架构/职责/入口，无新视觉模式）。未创建 commit/tag/push。
- Next step: 无代码 blocker；可选真机目视深浅主题下 subagent Tab 图标观感。

- Feature: 侧边聊天 Workspace Tab（side-chat-workspace-tab，**已完成**）
- Status: done — 已实现单实例、非持久化 Workspace Side Chat，并改为真实复用主对话核心 UI。`SideChatTabContent` 仅包装 `ChatPanelHost mode="side-chat"`；消息列表、Markdown/代码块、滚动、Composer、Enter/Shift+Enter/IME、复制、发送/停止与流式等待均走主对话同一链路。主聊天标题栏、Workspace `+` 与空 Tab 入口重复打开只激活同一 Tab；无可用模型时三类入口均不允许打开。App 稳定持有内存 `SideChatAgent` 与输入 ref，切换其他 Workspace Tab 保留；关闭自身/关闭全部/在其他 Tab 关闭其他/切换主会话时 abort/reset、清空并恢复主标题入口。
- Server: 新增 `POST /api/side-chat/stream` NDJSON 路由。只读取当前活动主会话的权威消息、模型、thinking 与有效压缩上下文；主线上下文仅投影 user/assistant 纯文本，忽略 system/tool/toolCall/thinking/details/非文本块，按 120,000 字符从最新向前裁剪并尽量保留 compact summary；主线与侧聊合计不超过 200,000 字符。QuickForge 使用会话权威模型，OpenCode 使用前端当前 QuickForge `modelRef`，不调用 ACP。模型上下文固定 `tools: []`，任何 `toolcall_*` / `toolUse` fail closed；不调用 `runPrompt`、不创建/恢复 Agent、不写会话或持久化，断连会 abort。
- Verification: 定向 Vitest 11 files / 76 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 245 files / 2095 tests 全通过；完整 `npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选真机确认深浅主题、主标题入口、Workspace `+`、Tab 生命周期、OpenCode 主会话与流式停止。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`，未跟踪原型 `design-mockups/side-chat-tab.html` 保持未修改。

- Feature: 修复左侧 Tasks 普通收起闪烁（fix-tasks-collapse-flicker，**已完成**）
- Status: done — 根因是 Tasks 普通收起时，外层 `SortableSidebarSection` 同一提交从展开态 `flex-1` 切为折叠态 `shrink-0`，内层内容面板仍执行 200ms `grid-template-rows` / `opacity` 关闭动画；配合 `h-full`、flex 与滚动树会产生中间绘制帧。现在仅 Tasks 面板在 `conversationsVisuallyCollapsed` 为 true 时追加现有 `transition-none`，普通收起和拖拽临时收起均瞬时关闭；展开时该类移除，保留既有 200ms 动画。Projects 未改。
- Verification: `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 15 tests 全通过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` → 0 error；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Next step: 无代码 blocker；可选真机确认桌面/移动 Tasks 普通收起无闪烁且展开动画仍存在。局部视觉 bugfix 不改变架构、模块职责或公共入口，因此未更新 docs/wiki，也无需修改 DESIGN_LANGUAGE。未创建 commit/tag/push；未手工修改生成目录，build 仅重建被忽略的 `dist/`；无关 `design-mockups/side-chat-tab.html` 保持不动。

- Feature: 拆分侧栏默认新建与 Tasks 显式全局新建（tasks-new-chat-inherits-current-task-project，**已完成**）
- Status: done — `ChatSidebar` 顶部“发起新对话”与 Tasks 标题 MessageSquarePlus 已拆为 `onStartNewDefaultChat` / `onStartNewGlobalChat`。顶部继续调用 `startNewDefaultSession`，有 `activeProject` 时按默认规则新建该项目对话，否则新建 global。Tasks 标题 desktop/mobile 调用独立 `startNewExplicitGlobalSession`：先 `setEmptyStateProjectDismissed(true)`，再 `startNewGlobalSession()`；标记只在离开当前新对话空状态后复位，因此 active-project 自动项目 effect 不会把显式 global 切回项目。global 使用默认 Workspace（`~/.quickforge/workspace`），不读取 `activeProject`、当前任务、`chatScope` 或 `currentToolProject`。移动包装保持先关闭侧栏；项目行 `onStartNewProjectChat(item)` 未改。上一轮错误 helper、测试与 lib Wiki 条目已移除。
- Verification: `npx vitest run tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/sidebar-section-order.test.ts` → 2 files / 19 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`feature_list.json` 解析与 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机分别点击桌面/移动的顶部、Tasks 标题和项目行三个入口确认。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`，无关的 `design-mockups/side-chat-tab.html` 保持不动。

- Feature: 准备 v1.8.0 minor release（release-v1.8.0，**已完成**）
- Status: done — 本次为 minor 发布：先以功能提交 `56d435d`（feat: 增加 /commit 与自定义模型设置入口）纳入当前全部工作区改动（20 条目），并以 `--ff-only` 将 `master` 快进，无 merge commit。package 双文件 1.7.12→1.8.0；CHANGELOG 已按 `v1.7.12..HEAD` 的 17 个提交新增 `[1.8.0]` 条目；README 无固定版本引用，未修改。完整 `npm run test`（239 files / 2068 tests）全通过，`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；runtime/offline 包及 tarball 已生成并完成元数据、依赖处理与清单校验。生成目录均被 Git 忽略，release commit 范围为 6 个预期发布文件。
- Release sequence: 本变更用于 release commit，随后创建 tag `v1.8.0`，`dev` 快进至发布提交，原子推送 `master`/`dev`/`v1.8.0`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.8.0.tgz --access public`。

- Feature: 主聊天模型选择器底部打开自定义模型设置（main-chat-model-selector-settings-entry，**已完成**）
- Status: done — `custom-model-selector` 新增语义独立的可选无参 `onOpenModelSettings`，不复用旧的模型编辑参数；仅 `useModelActions` 主聊天入口传既有 `openModelSettings`。桌面浮层与移动抽屉底部按条件显示低强调“自定义模型”，点击先统一关闭选择器并复位 trigger `aria-expanded`，再打开 `customModels` 设置页。共享对话、Agent 表单等不传回调的复用场景不显示。移动 footer 在可滚动 model list 之外保持固定，样式遵循既有分隔线、muted 文字及 hover/focus token。
- Verification: 定向 `npx vitest run tests/frontend/custom-model-selector.test.ts tests/frontend/use-model-actions-cloud.test.ts tests/frontend/i18n-language-snapshot.test.ts tests/server/routes/shared-conversation.model-visibility.test.mjs` → 4 files / 15 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；需求文件 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机目视桌面/移动、深浅主题及移动长模型列表。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`。

- Feature: Composer @ 从项目根目录逐层浏览文件（file-reference-root-browser，**已完成**）
- Status: done — 新增严格 `projectId` 的 `/api/workspace/mention-children`，只返回当前目录全部直接安全子节点且目录优先，不递归、不分页、不回退默认 workspace；敏感路径、真实目标和项目外符号链接继续按 mention 边界过滤。审查修正后，目录完成 stat/realpath 解析仍按真实/链接目标路径分段排除 `SKIP_DIRS`：普通 `node_modules`、名为 `node_modules` 的目录链接与安全别名指向 `node_modules` 子树均不返回；普通安全目录链接仍允许。Composer 裸 `@` 默认浏览根目录；点击/Enter/Tab 目录逐层进入，选择文件才沿用既有 `contextReferences`；`@src` 等仅在当前目录本地筛选，不发全项目搜索请求；当前层全部渲染并由菜单滚动。旧 `mention-search` 保留兼容但 Composer 不再调用。
- Verification: 审查收口 `npx vitest run tests/server/routes/workspace-tree-on-demand.test.mjs tests/frontend/file-reference-controller.test.ts` → 2 files / 29 tests 全通过（含请求竞态、remove Abort 与 cleanup listener）；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` 通过（仅既有 CRLF→LF warning）。完整门禁：`npm run test` → 238 files / 2062 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Next step: 可选真机确认深浅主题、长目录滚动、鼠标/键盘逐层进入、当前层筛选及文件 chip；未创建 commit/tag/push。

- Feature: / 斜杠菜单点击菜单外任意区域收起（slash-menu-click-outside-dismiss，**已完成**）
- Status: done — 用户关闭与内部删除已分离。菜单外任意 pointerdown（包括 textarea/Composer 控件）、Escape 或公开 `remove()` 会收起菜单、清理 document listener，并进入等待下一次显式输入的抑制态；即使正文仍以 `/` 开头，MutationObserver 装饰刷新、catalog resolve/reject 回调等无参数 `update()` 也不会立即重开。下一次真实输入调用 `update(value)` 时解除抑制并正常打开/过滤。选中菜单项、chip 激活、非 Slash 文本、无结果等内部删除走不抑制的统一 `removeMenu()`；document listener 为控制器级单例，重复渲染不累积，`cleanupTextareaHandler()` 同步清理。菜单本体 pointerdown 仍不关闭；`@` 文件引用菜单保持既有行为未改。
- Verification: `npx vitest run tests/frontend/command-suggestions.test.ts` → 1 file / 18 tests passed；`npx vitest run tests/frontend/command-suggestions.test.ts tests/frontend/slash-invocation-chip.test.ts tests/frontend/composer-plus-menu.test.ts` → 3 files / 49 tests passed；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` → exit 0（仅 `feature_list.json` 既有 CRLF→LF warning）。
- Next step: 无代码 blocker；可选真机确认点击输入框/消息区收起、继续输入重开、点击菜单行仍正常插入。未创建 commit/tag/push。

- Feature: 内置 Slash 指令 `/commit [message]`（builtin-slash-commit，**已完成**）
- Status: done — 后端 catalog/help、内部解析与 agent-manager 命令状态已接入 `/commit`；参数可省略。当前轮权限固定为 `allowEdit=false`、`allowCommands=true`、`allowSubagents=false`。简短 6 条 prompt 要求仅显式暂存并提交当前任务相关文件，禁止 `git add .` / `-A` / `--all`，验证失败停止，不修改代码、不混入无关改动、不绕过 hooks，最多一个本地 commit，禁止 push/tag/release/publish；无 message 时按 diff 与仓库风格生成，最后报告 hash/message/验证/剩余改动。前端菜单显示 `/commit [message]` 并插入 `/commit `，中英文描述、README 和 server/components Wiki 已同步。
- Verification: 定向 `npx vitest run tests/server/custom-commands.test.mjs tests/server/slash-skill-agent.test.mjs tests/frontend/command-suggestions.test.ts` → 3 files / 78 tests passed；目标 `npx eslint` 0 error；`npx tsc -b --pretty false` exit 0；完整 `npm run test` → 238 files / 2050 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；未创建 commit/tag/push，`package-lock.json` 的既有 peer 元数据改动未触碰。

- Feature: 点击 Composer 内 Slash chip 不再降级显示命令原文（slash-chip-click-keeps-chip，**已完成**）
- Status: done — 用户真机反馈：选中 agent 后输入框内的小 tab（slash chip）一点击就露出 `/agent <name>` 原文。根因是覆盖层整体 `pointer-events:none`，点击穿透到 textarea 前缀区，光标进入前缀触发 selectionchange 降级逻辑。修复：CSS 仅对 `.quickforge-slash-overlay .quickforge-slash-chip` 开启 `pointer-events:auto`（消息流 chip 保持纯展示），控制器在 `renderChipContent` 为覆盖层 chip 挂 `pointerdown`：preventDefault 后聚焦 textarea 并把光标移到文本末尾，chip 保持显示不降级；键盘方向键进入前缀区的降级/自愈、IME、自愈重建逻辑均未改。共享工厂 `createSlashChipElement` 未挂监听，消息流 chip 不受影响。
- Verification: 定向 `npx vitest run tests/frontend/slash-invocation-chip.test.ts tests/frontend/command-suggestions.test.ts` → 2 files / 36 tests passed（新增 chip pointerdown 用例：preventDefault、光标移末尾、不降级、CSS 契约）；相邻 `message-actions` / `composer-plus-menu` / `slash-catalog` 3 files / 29 tests passed；`npx eslint` 改动源码/测试 0 error；`npx tsc -b --pretty false` exit 0。
- Next step: 无代码 blocker；可选真机点击 skill/agent chip 确认光标落末尾且原文不露出（含触屏）。

- Feature: 用户消息显示本轮插件标签并在重试/分享中保留（user-message-selected-plugin-chips，**已完成**）
- Status: done — 审查收口修复 M1/M2：服务端 `selectedCapabilitiesFromMessage` 改为历史快照投影，retry/continue 只能恢复 `type/pluginName/name/label`，历史 `details.description` 即使伪造也不会进入 LLM prompt；新发送请求顶层 description 仍仅用于当前轮临时 prompt。前后端历史读取边界均有同构测试。`decorateUserContextChips` 做最小导出，message-actions 新增真实 fake DOM 行为测试，实际执行插件在文件前、重复调用替换不重复、混合→空移除、历史 chip 无 ×、仅插件/仅文件/混合 aria-label，并经 `decorateMessages` 点击 copy 验证仍复制原始正文。Wiki 行数/表格已按当前源码修正；feature 保持 done。
- Verification: 审查收口定向 Vitest 9 文件 / 87 用例全通过；目标 eslint 0 error；`npx tsc -b --pretty false`、`git diff --check`、feature JSON 解析通过；完整 `npm run test` 238 文件 / 2043 用例 100% 全通过；完整 `npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。`package-lock.json` blob hash 仍为 `a7f0bb9fcb4de96f8953024be8ac588435dcc3ab`，未修改/还原；未触碰并行 `slash-invocation-chip.ts` 及其测试/专属逻辑，未手工修改生成目录，未 commit/tag/push。
- Next step: 无代码 blocker；可选真机目视多插件、未知插件、仅插件/仅文件/混合消息及分享页。

- Feature: Composer 插件标签移入输入卡片并统一插件术语（composer-plugin-chips-inside-editor，**已完成**）
- Status: done — 审查修复已完成：`ensureComposerContextChips` 继续从 textarea 父元素定位真正输入卡片；新增共享 `syncComposerContextChipsAriaLabel`，两个控制器在完成自身 chip 增删后统一调用，按仅插件=`Selected plugins / 已选插件`、仅文件=`Referenced files / 引用的文件`、混合=`Selected plugins and referenced files / 已选插件和引用的文件` 同步可访问名称，空容器仍移除。插件与文件引用两类 chip 在任一同步/删除顺序下互不删除；内部 capability 类型、`selectedCapabilities` 草稿字段与发送协议不变。插件多选、去重、草稿恢复、× 删除和发送消费保持；documents/spreadsheets/presentations 使用现有专用图标，未知插件回退通用图标。CSS 仅收紧标签尺寸/间距和有标签时 textarea 顶部 padding，保留 composer `> div:first-child` 根卡片选择器及文件标签色。
- Verification: 审查修复定向 vitest 9 文件 / 77 用例全通过（含双控制器 file-first/plugin-first 两种同步顺序、互相保留、分别删除、最后一项删除移除空容器及仅文件/仅插件/混合 aria-label）；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test -- --reporter=dot` 236 文件 / 2024 用例全通过；完整 `npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选真机目视深浅主题下多插件+文件混合标签、删除按钮、窄输入框换行及读屏名称。`package-lock.json` 仍为任务前既有 43 行 peer 元数据差异，本次未修改/还原；未创建 commit/tag/push，未手工修改生成目录（build 仅重建被忽略的 `dist/`）。

- Commit 收尾：本轮并行三功能已提交——`4f0182f`（slash chip 点击修复，含 index.css 专属 hunk 拆分）、`abbc7cd`（插件标签链路与用户消息插件回显；composer-plugin-chips-inside-editor 与 user-message-selected-plugin-chips 在多文件内交织，合并一笔）；状态文档随后以独立 docs commit 收口。提交前完整门禁：`npm run test` 238 files / 2043 tests 全通过、`npm run lint` 0 errors / 1 existing warning、`npm run build` 成功。`package-lock.json` peer 元数据噪音仍未提交、未丢弃。未 tag、未 push。

- Commit 收尾：剩余功能代码已按逻辑提交为 `d66a3e7`（Workspace Inspector 会话隔离）、`924e8c5`（Slash canonical name + 中性 Lucide 图标）、`b64a4b2`（Composer hover）；此前侧栏区块功能已在 `72ac7e09`，会话状态 clear 修复已在 `6c337aeb`。状态文档将在本次独立 docs commit 收口；未 tag、未 push。
- 最终验证：`npm run test` → 236 files / 2020 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 与 `feature_list.json` / `package.json` / `package-lock.json` JSON 解析通过。
- 保留未提交：`package-lock.json` 仅有 43 行 npm `peer` 元数据翻转；`package.json` 无依赖/版本变化，且用当前 npm 11.6.2 对 HEAD 锁文件执行隔离 `npm install --package-lock-only` 可复现同一结果，判定为工具链规范化噪音。按要求未提交、未丢弃。

- Feature: 侧栏区块改用标题拖拽并在排序时临时折叠（sidebar-section-title-drag-collapse，**已完成**）
- Status: done — Projects / Tasks 不再显示专用 GripVertical；各自标题主 toggle 直接接收 `setActivatorNodeRef` / attributes / listeners，普通单击仍走原折叠回调，仅独立 `draggableSectionTitleClass` 添加 `touch-none` 与 grab/grabbing 反馈；共享 `sectionToggleClass` 保持普通折叠标题样式，Pinned 继续使用默认 pointer/触摸行为。PointerSensor 超过 6px 才启动拖拽，右侧 action buttons 保持隔离。拖动任一区块时，两个区块通过派生视觉状态同时临时折叠，Chevron、`aria-expanded`、外层尺寸与内容 grid 一致；收缩禁用过渡，cancel/end 清理 `draggingSectionId` 后恢复各自原持久折叠状态。compact layout、设置底部固定和 Projects 内部 DnD/边界保持不变。
- Verification: 定向 vitest 2 文件 / 21 用例（含 Pinned 不使用 draggable class、Projects/Tasks 使用的契约）、目标 eslint、`tsc -b`、`git diff --check` 全通过；前一轮完整 `npm run test` 236 文件 / 2020 用例全通过、完整 lint 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）、build 成功（仅既有 KaTeX/chunk warnings），本次极小局部修复未重复全量门禁。
- Next step: 无代码 blocker；可选真机分别从 Projects/Tasks 标题短按折叠与拖动换位，确认 6px 阈值、两个区块瞬时收缩、右侧操作按钮隔离以及结束/取消恢复。

- Feature: 修复侧栏 Projects / Tasks 折叠后不贴合（sidebar-collapsed-sections-compact-layout，**已完成**）
- Status: done — `SortableSidebarSection` 现在接收按 `sectionId` 推导的折叠状态；折叠时使用 `shrink-0`，Tasks 不再保留 `flex-1` 撑出大段空白，两个标题会按当前排序紧贴。展开时 Tasks 仍为 `flex-1`，Projects 仍为 `max-h-[55%]`；顶层排序容器的 `flex/min-h-0/overflow-hidden`、两区内部滚动和底部设置 `mt-auto shrink-0` 均保留。拖拽语义、传感器、命名空间 ID、排序存储和项目内部 DnD 未改。
- Verification: 定向 vitest 2 文件 / 20 用例、目标 eslint、`tsc -b` 全通过；完整 `npm run test` 236 文件 / 2019 用例全通过；完整 lint 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；build 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选在桌面/移动分别测试 Projects→Tasks 与 Tasks→Projects 顺序下单独/同时折叠，确认标题紧贴、展开区滚动与设置底部固定。

- Feature: 统一 Slash 图标并取消类别色（unify-neutral-slash-icons，**已完成**）
- Status: done — command/skill/agent 分别复用已有 Lucide `SquareTerminal` / `BookOpen` / `Bot`，通过 `slash-icons.ts` 静态映射供斜杠菜单、输入框选中 chip 与消息流复用 chip 使用；移除本 Slash 功能新增的自绘类别 glyph。菜单三类图标默认统一 `var(--muted-foreground)`，hover/selected 仅增强为 `var(--foreground)`；共享 chip 只将 `.quickforge-slash-chip-icon` 覆盖为中性色，因此 skill/agent chip 原有蓝/绿背景与文字语义色、结构和行为保持不变。非 Slash 能力菜单继续使用 `capability-icons.ts`，未扩大范围。
- Verification: 定向 vitest 2 文件 / 35 用例全过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build`、`git diff --check` 均通过；build 仅既有 KaTeX/chunk warnings。`package-lock.json` SHA-256 前后均为 `1176cf21fa40c0ddec54adaf769f5ef85d09e296ca2a8c0176da757b0daa8042`，未触碰既有变更。
- Next step: 可选真机目视确认深浅主题下菜单三类中性图标，以及输入框/消息流 chip 的图标中性但 chip 背景与文字仍保留原语义色。已随 canonical-name 合并提交为 `924e8c5`，未 tag、未 push。

- Feature: 侧栏 Projects / Tasks 完整区块拖拽换位并持久化（sidebar-section-reorder，**已完成**）
- Status: done — App 中单一 `SidebarSectionOrder` 状态同时传给桌面/移动侧栏并安全持久化到 `quickforge:sidebar-section-order:v1`。置顶区固定在顶层排序区外；Projects 与现有 conversations UI（ID 映射为 `tasks`）两个完整区块由 `sectionOrder` 动态渲染，并由区块级 `DndContext + SortableContext + SortableSidebarSection` 排序。唯一 activator 是标题旁弱化 `GripVertical` 手柄（PointerSensor 6px 激活阈值支持鼠标/触摸；KeyboardSensor + `sortableKeyboardCoordinates` 支持聚焦后 Space、方向键、Space 排序；aria-label/title 保持与 dnd-kit attributes 一致）；折叠、添加、筛选、菜单按钮无拖拽监听。顶层 ID 使用 `sidebar-section:*` 命名空间，start/cancel/end 状态完整并锁定 x=0/关闭 autoScroll；Projects 内部嵌套 DnD、视口边界、自动滚动限制与 `onReorderProjects` 持久化保持不变。
- Verification: 定向 vitest 2 文件 / 19 用例全过（新增外层 `sectionSensors` 同时含 PointerSensor、KeyboardSensor 与 `sortableKeyboardCoordinates` 的契约测试；现有测试为源码接线契约架构，无低成本真实 DOM 键盘行为 harness，未扩大基础设施）；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；feature JSON 解析与 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机分别在桌面/移动用鼠标或触摸拖动 Projects/Tasks，并聚焦手柄后执行 Space → 方向键 → Space，确认顺序同步、刷新恢复、置顶区固定、标题操作按钮不误触，以及项目内部排序继续正常。

- Feature: Workspace Inspector 状态按会话隔离恢复（session-scoped-workspace-inspector-state，**已完成**）
- Status: done — Inspector 展开/收起、可恢复 tabs、`activePanelTabId`、Review 子视图与 Reader 左侧导航显示按 `projectId + sessionId` 写入 localStorage。AgentManager 维护独立 runtime scope：pending deferred session 首次发送晋升真实 session 时沿用原 scope，`WorkspaceInspector` key 不变，内存状态保留，并在真实 `sessionId` 到达后写入真实会话 storage；普通会话切换或确认创建另一 deferred session 才滚动 scope。App wrapper 不再提前重置，底层新建返回 `created/reused/cancelled`。一次性 Inspector request 携带 `projectId + runtimeScopeId`，在发起、聊天文件异步 resolve 完成和 Inspector 消费处三重校验；历史无项目 subagent 请求兼容。pending 本身仍不持久化，旧项目级状态不迁移，整体宽度保持全局。
- Next step: 无本 feature 代码 blocker；已提交为 `d66a3e7`，未 tag、未 push。
- Verification note: 定向 6 文件 / 41 用例通过；相关 eslint 0 error；`npx tsc -b --pretty false` 通过；最终合并工作区 `npm run test` 为 236 文件 / 2020 用例全通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；feature/package/lock JSON 与 `git diff --check` 通过。

- Feature: Composer 控件 hover 改为背景反馈且不位移（composer-controls-hover-background，**已完成**）
- Status: done — 保留全局 Composer 按钮 hover 位移规则，仅用精确选择器覆盖 +、权限、模型、发送/停止：五类目标均 `transform:none`；三个中性控件使用 `var(--quickforge-sidebar-hover-bg)` 与合适前景色且不影响 disabled；发送态以 92% primary 混少量 sidebar hover token 保持 primary 层级和 `primary-foreground`；停止态保留既有 hover 背景。Plan、OpenCode config、chip/菜单项未改，model trigger 同时覆盖 OpenCode mode 符合定案。
- Verification: 定向 vitest 3 文件 / 16 用例全过；新增测试 eslint 0 error；最终合并工作区 `npm run test` 236 文件 / 2020 用例全过，`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 解析与 `git diff --check` 通过。未改 Wiki/DESIGN_LANGUAGE（纯视觉反馈且现有“hover 有感知、不跳动”规范已覆盖）。`package-lock.json` 无 `package.json` 依赖或版本对应变更，确认为 npm 11.6.2 重算 peer 元数据噪音，未纳入功能提交且未丢弃。
- Next step: 可选真机目视确认深浅主题下 +/权限/模型 hover 与侧栏会话项一致、发送按钮仍明显为 primary、停止态背景变化保留且五类按钮无垂直跳动。已提交为 `b64a4b2`，未 tag、未 push。

- Feature: 修复取消置顶与归档恢复未清除会话状态（fix-session-state-clear-actions，**已完成**）
- Status: done — 按服务端既有三态契约（字符串=设置、`null`=清除、字段缺失=保留），取消置顶 payload 改为 `pinnedAt:null`，归档恢复对 session/metadata 两个 save payload 均写 `archivedAt:null`，避免 `JSON.stringify` 丢弃 undefined 或 batch merge 保留旧值。前端与服务端定向回归测试 27/27 通过，验证序列化 payload、state/metadata、SQLite `pinned_at`/`archived_at` 与 pinned/archive 查询索引状态均正确清除；改动文件 eslint、`tsc -b`、build、diff check 通过。
- Next step: 无代码 blocker；未改 Wiki（仅恢复既有行为契约）。

- Feature: 斜杠菜单技能与子智能体仅显示 canonical name（slash-menu-canonical-name-display，**已完成**）
- Status: done — 普通 command 主文本仍显示完整 usage（如 `/plan [task]`）；skill/agent 行主文本仅显示 `SlashEntry.name`，不再展示 `/skill` / `/agent` 前缀。`usage` 与 `insertText` 未改，因此 `skill ` / `agent ` 类型前缀搜索仍有效，选中和 dataset 仍使用完整 `/skill <name> ` / `/agent <name> `。定向测试 13/13、改动文件 eslint、tsc、build、diff check 均通过；build 仅既有 KaTeX/chunk warnings。
- Next step: 可选真机目视确认三组菜单主文本与 Tab/点击插入行为。已与中性 Slash 图标合并提交为 `924e8c5`，未 tag、未 push。

- Feature: 输入框 @ 引用当前项目文件并与插件能力解耦（file-reference-mention，**已完成**）
- Status: done — `@` 仅搜索当前 QuickForge 项目文件：裸 `@` 和 1 字符只提示，2+ 字符经 300ms debounce 调用严格 projectId 的 files-only mention-search，并支持键盘选择与结构化文件 chip；`+ → 能力` 生成独立能力 chip，不再插入 `@Documents` 或从正文推断。`text`、`contextReferences`、`selectedCapabilities` 已写入 localStorage 草稿（能力防御规范化、按 `type+pluginName+name` 去重、最多 4），附件仍不持久化；文件引用随下一次 prompt 一次性发送，服务端重新校验项目/路径/敏感边界，注入相对路径提示并持久化 history details，失败回滚/retry 链路已覆盖。OpenCode/shared 禁用或拒绝非空引用；mention-search 对未知/已删除 projectId 返回 404 `PROJECT_NOT_FOUND`，普通 workspace search/children 等兼容回退不变。验证：合并定向 vitest 20 files / 242 tests passed；相关 eslint 0；`tsc -b` passed；`npm run build` passed（仅既有 KaTeX/chunk warnings）；`git diff --check` passed。
- MVP 限制 / Next step: 输入框只有 chip、没有正文且没有附件时不能发送；裸 `@` 不提供最近文件；真机目视待用户（键盘选择、深浅主题、草稿恢复、发送后历史 chip 与敏感/错误提示）。

- Feature: Wiki 文档同步——补齐 file-reference-mention / slash-menu-expansion 未提交改动的文档缺口（wiki-sync-uncommitted-features，**已完成**）
- Status: done — 纯文档维护（用户明令禁止修改代码，未触碰任何代码/测试）。对照工作区两条未提交功能链审计 docs/wiki 六个页面并补缺口：context-references.mjs 独立小节（含 CONTEXT_REFERENCE_* 错误码）、utils workspace.mjs 现状行为（大小写不敏感敏感路径 + realpath 复查 + 稳定 errorCode）、src/lib 新增 deferred-session-agent.ts 条目与章节（此前完全未收录）、server-agent/shared-server-agent 补 setPromptMode 泛化与 no-op 语义、slash chip 的 IME/selectionchange/自愈行为更正为最终实现、message-actions 补 decorateUserFileReferences、chat-utils 补新类型与 hasDraft 口径、多文件过期行数与 src/lib 模块总数（28→86）修正。
- Next step: 无。file-reference-mention 功能本体仍由并行会话推进（feature_list 尚未登记该 feature），其收尾时 wiki 已就位，只需按最终实现复核增量。

- Feature: 侧栏“对话”分组标题更名为“任务”（rename-sidebar-conversations-to-tasks，**已完成**）
- Status: done — i18n `conversations` key 中文 ‘对话’→‘任务’、英文 ‘Conversations’→‘Tasks’（唯一使用处为 ChatSidebar 左侧边栏分组标题）；DESIGN_LANGUAGE.md 3 处分组标题示例同步为 Tasks。验证：eslint i18n.ts 0 error；i18n-language-snapshot + sidebar-session-sort-mode 定向测试 11/11 通过。全量 `tsc -b` 失败均为并行会话 file-reference-mention 中间态错误（与本改动无关，已有记录）。未改 wiki（纯显示文案，不影响模块职责或公共入口）。
- Next step: 真机目视确认左栏标题显示“任务”（英文 Tasks）；其余“对话”相关文案（置顶、暂无对话、已归档对话、重命名对话等）按最小范围保持不变，如需一并更名待用户确认。

- Feature: 斜杠菜单扩展——/ 触发指令 / 技能 / 子智能体三类补全 + 方案 A 选中态 chip（slash-menu-expansion，**已完成**）
- Status: done — 两轮定稿实现：①主功能（三分组菜单 + /skill /agent 内部命令 + 懒加载目录）；②方案 A 选中态呈现（用户定稿）：新增 slash-invocation-chip.ts（输入行内联 chip 覆盖层——原文不变仅视觉替换、computed 度量同步、光标对齐补偿 spacer=max(0,前缀宽-chip宽)、IME composition 防护、光标入前缀区自毁、ResizeObserver/scroll 同步）+ command-suggestions 集成（选中即 engage、菜单抑制、手输/草稿恢复自动 engage、Backspace 边界删前缀、Esc 退出）+ message-actions 用户消息前缀 chip 装饰（幂等，复制走原文）。实现取舍：还原机制用 chip 自带前缀标记（Lit 重渲染会替换 container dataset）；selectionchange 自毁不记 dismissed（Esc 才记）；update 校验加词边界（防 /agent explore-deep 误留 explore chip）。input-clamp 既有源码断言随 if 块化同步修正（守卫语义不变）。合并门禁：npm run test 226 files / 1945 tests、lint 0 errors / 1 existing warning、tsc -b、build、git diff --check 均通过。
- Next step: 真机目视留待用户（重点：选中态 chip 与光标对齐、中文 IME 输入、窄列宽换行、退格边界删除、消息流 chip、深浅主题；未知名称提示文本）。**追加修复已落地（用户反馈打字后 chip 消失）**：自愈式三层防御——update 重建被外部移除的 overlay/textarea（isConnected 检查）、selectionchange 降级显示而非自毁（光标回尾部自愈）、自动 engage 兜底；最小复现环境（无头 Edge CDP 全链路：选中/打字/逐字符/IME）无法复现核心链路问题，判定破坏源在真实 app React/Lit 生命周期。门禁全过、dist 已重建。

- Feature: 限制侧栏项目排序拖拽的顶部/底部边界（fix-sidebar-project-drag-bottom-boundary，**已完成**）
- Status: done — Projects 的实际 `overflow-y-auto` 容器成为拖拽预览边界和唯一自动滚动容器；纯函数按拖拽矩形、视口矩形及拖拽期间 `scrollTop` 增量锁定横向并夹紧纵向，覆盖 dnd-kit modifier 后滚动补偿。保留 closestCenter、verticalListSortingStrategy、MeasuringStrategy.Always、拖动折叠会话、排序持久化与视觉样式。定向测试 7/7、改动文件 eslint、tsc、build、diff check 均通过。
- Next step: 无代码 blocker；需手工浏览器验证长项目列表拖到顶部/底部时预览不越界、仅 Projects 滚动且真实边界停止。

- Feature: 暂时下线 generate_image 工具（temporarily-disable-generate-image-tool，**已完成**）
- Status: done — 已从 `workspaceTools` 移除 `generate_image`，Agent 与 `GET /api/tools` 不再暴露；handler、图片生成模块、`directRouteDisabledTools`、会话资产与前端历史结果渲染全部保留。definitions 定向测试 20/20、历史兼容测试 63/63、lint（0 errors / 1 existing warning）与 build 均通过；用户指南和 server/src wiki 已同步为“仅历史会话兼容”。
- Next step: 无 blocker；未创建 commit/tag/push。

- Feature: 删除基础系统提示词中的最简实现与最小局部修改规则（remove-base-prompt-minimalism-rules，**已完成**）
- Status: done — `BASE_SYSTEM_PROMPT` 已删除 “Prefer the simplest solution that satisfies the request.”、“Make surgical changes only.” 和语义重复的 “Make minimal, focused changes.”；保留 “Do not refactor unrelated code.” 等其他规则。新增反向契约测试。验证：系统提示词定向 vitest 1 文件 / 5 用例全通过；未改 Wiki（仅提示词措辞调整，不改变模块职责、公共入口或配置方式）。
- Next step: 无。

- Feature: 准备 v1.7.12 patch release（release-v1.7.12，**已完成**）
- Status: done — 版本与 CHANGELOG 已准备；完整 `npm run test`（219 files / 1865 tests）全通过，`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功；runtime/offline 包及 `package-offline/shawnstack-quickforge-1.7.12.tgz` 已生成并完成元数据、依赖处理与清单校验。生成目录均被 Git 忽略，release commit 范围为 6 个预期发布文件。
- Release sequence: 本变更用于 release commit，随后创建并推送 tag `v1.7.12`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

- Feature: 移除 Workspace Inspector subagent 执行区域最外层卡片外框（fix-workspace-inspector-subagent-trace-outer-card，**已完成**）
- Status: done — `.quickforge-subagent-trace` 根容器仅保留 `quickforge-subagent-trace p-2.5`，移除 `rounded-lg border border-border bg-background/60`，完整执行区域融入 Inspector 消息流；内部 `message-list` 及状态/耗时、process summary 分隔线、思考正文、工具统计、折叠交互和聊天摘要均未改。新增按 class token 提取的最小模板契约测试，避免大段字符串断言。验证：定向 vitest 1 文件 2 用例全过；改动文件 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 通过（build 仅既有 KaTeX 字体解析与 chunk size warning）。未改 wiki（纯视觉外框 bugfix，不改变行为契约、模块职责或公共入口）。
- Next step: 可选真机打开 Workspace Inspector 的 subagent 运行详情，目视确认执行区域无最外层圆角边框且内部过程分组/折叠视觉不变。

- Feature: 修复 subagent 跑马灯剩余宽度与重连重复视图（fix-subagent-marquee-width-reconnect，**已完成**）
- Status: done — `.quickforge-tool-title` 保持 `flex: 0 1 auto`，仅 `.quickforge-subagent-title` 改为 `flex: 1 1 auto`，使跑马灯获得摘要行剩余宽度；`QuickForgeToolMarquee` 重连时复用现有两组完整 view，异常结构才清理并重建，避免 connect-disconnect-reconnect 累计双视图，同时保留 attribute 驱动、动画时序与 ResizeObserver 策略。新增 CSS flex 契约和自定义元素重连行为回归测试。验证：定向 vitest 2 文件 16 用例全过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` 与 `git diff --check` 通过。未改 wiki（局部 bugfix 未改变模块职责、公共入口或既有行为契约）。
- Next step: 可选真机触发多工具 subagent，目视确认窄列宽下跑马灯占满剩余区域、过程分组搬移后仍仅两组视图。

- Feature: ask_user 历史工具消息展开复用回执样式（ask-user-history-review-style，**已完成**）
- Status: done — 非 detailed 展开体复用回执确认步样式：askUserReviewRowsFromDetails 解析持久化 toolResult.details（questions/answers/skipped/skipReason），已回答/跳过渲染只读回执行（复用 buildAskAnswerText 与 .quickforge-ask-review 样式，跳过态带原因行）并省略 output 文本块；detailed / pending / 旧消息维持原视图。验证：定向 vitest 2 文件 23 用例全过、eslint 改动文件 0 error、tsc -b 通过；真机目视留待用户；未提交 git。
- Next step: 真机目视确认（触发一次 ask_user 提交与跳过、重载会话展开历史工具消息观察回执样式/跳过原因行/detailed 对照）。

- Feature: 长输入内容定高收起——聊天用户消息与 subagent 详情任务块统一气泡样式（input-clamp-expand，**已完成**）
- Status: done — 新增 `src/lib/input-clamp.ts`（InputClampController 状态机：定高=computed line-height×6 行+纵向 chrome、data 属性状态、220ms max-height 过渡/展开后置 none/reduced-motion 直切；DOM 装饰入口 decorateUserMessageInputClamp / syncInputClampBoxes，i18n 标签注入式）；任务块模板改气泡视觉+收起结构，详情宿主 updated 后幂等度量；聊天装饰对纯文本 user 消息接入（附件消息不参与）；user-message-container 背景浓度 primary 10%→深色 6%/浅色（html:not(.dark)）3%，渐隐遮罩与展开按钮复用同色变量；新增 i18n expand/collapse 双语。追加真机反馈修复：`white-space: pre-wrap` 收窄到 task/context/expectedOutput 三个值节点，保留输入换行但不再放大 Lit 模板缩进；为共享收起盒注入 30px 流内按钮安全区，仅 overflowing 内容显示，展开/收起均不覆盖正文，fits 内容不留空白。验证：input-clamp 20/20；此前相关面 174、前端全量 87 文件 821 用例、eslint、tsc/build 均通过。真机目视确认留待用户（设计稿 design-mockups/input-clamp-expand.html 可对照，支持 #light/#dark hash 与浓度切换）。
- Next step: 无阻塞；真机目视确认（长用户消息与 subagent 详情任务块的收起/展开、深浅两主题气泡浓度观感）。

## Notes

- 全局 SSE 流首字节延迟修复（本轮）：用户反馈 `/api/agents/events`、`/api/channels/events` "请求时间长、易挂起"。诊断结论：两接口均为 SSE 长连接，DevTools 永久 Pending + Time 增长属正常表象；但 `handleGlobalStream`（server/routes/agent.mjs）`writeHead` 后无任何 body 写入，Node 会把响应头缓到第一次 `res.write`（15s ping 或首条事件）才发出，客户端 `onopen`/TTFB 最长延迟 15 秒——`handleChannelEvents` 因立即写 snapshot 无此问题。修复：`writeHead` 后加 `res.flushHeaders()` 立即刷头。新增针对性测试（tests/server/routes/agent.test.mjs：立即 flush 头 + close 时移除监听并 end），mock 的 `agentEvents` 补 `removeListener`。验证：定向 vitest 14 tests 全过，lint 仅既有 identity.mjs warning。剩余"挂起"因素（范围外，未改）：dev 下 server/Vite 重启断流后 EventSource 指数退避重连在 Network 面板呈现为新 Pending 请求；HTTP/1.1 同源 6 连接上限下每 tab 占 2-4 条 SSE（channels/events + agents/events + 会话级 stream + 设置页再开一条 channels/events），多 tab 会挤占连接池使普通 API 排队。

- 侧栏项目拖拽边界（本轮）：实际依赖为 `@dnd-kit/core@6.3.1`；其 `Modifier` 参数含 `draggingNodeRect`，`autoScroll.canScroll` 签名为 `(element: Element) => boolean`。非 DragOverlay 路径会在 modifier 后把滚动增量加回活动项 transform，因此边界纯函数显式接收拖拽开始后的 Projects `scrollTop` 增量进行抵消，避免自动滚动后预览突破底部。未新增依赖，未修改样式或生成产物。

- generate_image 暂时下线（本轮）：单一暴露源 `server/tools/definitions.mjs` 已移除定义，未删除 `server/tools/index.mjs` handler、`server/image-generation.mjs`、`server/routes/tools.mjs` 的 `directRouteDisabledTools`、session assets、前端 renderer/i18n/process-folding 等兼容代码；历史会话中的既有图片仍可查看/下载。未修改 CHANGELOG、依赖或生成产物。

- v1.7.12 release 收尾完成：`test` 219 files / 1865 tests 全通过，`lint` 0 errors / 1 existing warning，`build` 成功；runtime/offline 目录与 offline tarball 已生成并校验。生成产物被 `.gitignore` 排除，不进入 release commit；release commit 范围为 6 个预期发布文件。发布顺序为：本变更纳入 release commit，随后创建并推送 tag `v1.7.12`，最后由用户执行 `npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

- Workspace Inspector subagent trace 外框修复（本轮）：仅删除 trace 根容器的卡片视觉 utility，`message-list` 节点、数据属性与全部内部装饰链路保持逐字不变；契约测试只提取命中 `.quickforge-subagent-trace` 的 class 属性并比较 token，既锁定 `p-2.5` 又避免绑定整段 Lit 模板。

- ask-user-history-review-style 实现定案（本轮）：「所见即所提交」——ask_user 历史工具消息非 detailed 展开体复用回执样式而非原始问题清单+output 文本。数据依据：服务端 resolve 即把 {askId, questions(规范化), answers, skipped, skipReason} 随 toolResult.details 持久化（agent-manager.mjs finish()），旧渲染器只用了 timing。要点：纯函数 askUserReviewRowsFromDetails 自包含无外部依赖（可被测试经 ts.transpileModule 提取函数体单测，规避 local-tools 模块级 registerToolRenderer 副作用与 pi-web-ui 重依赖——同 local-tools-lit-reactivity.test.ts 惯例）；skipReason 实际取值仅 timeout/aborted/无 reason（用户跳过），'no-questions' 路径服务端 details 不含 questions（解析返回 null 走兜底原视图），映射 key 仍保留以对齐服务端 reason 枚举；跳过原因行复用 .quickforge-ask-review-answer 样式（视觉贴回执）而非 .quickforge-ask-note（后者 margin-left:auto 右对齐，属 actions 行）。
- diff-display-optimization 实现定案（本轮，并行会话）：用户在对比设计稿（design-mockups/diff-display-optimization.html：现状复刻/方案 A 基础改良/方案 B 字符级高亮三卡 + 亮暗主题切换 + edit 局部修改与 write 新文件双示例，页面内 JS 即 unified→结构化解析原型）中选定方案 B 落地。实现：新模块 src/lib/diff-view.ts（parseDiffRows 行号双侧/剥离前缀/hunk 间隙省略/配对删加行 token LCS 字符级变化段、parseDiffFileInfo 路径上提+新文件判定、乘积>40000 回退整行变化）；local-tools.ts renderDiff 改结构化行渲染并删除内联样式双保险（DIFF_* 常量/diffLineClass/diffLineStyle/styleMap），OpenCodeToolRenderer 复用自动受益；index.css 行号/gap/mark/path 样式 + html.dark 亮绿/亮红文字覆盖（含 diff 徽章与里程计 side——修复暗色下固定深绿/深红文字对比度不足这一现状缺陷）；i18n 新增 diffOmittedLines/diffNewFile 双语；服务端零改动。验证：定向 vitest 4 文件 35 用例全过（diff-view 新增 16）、eslint 0 error、tsc -b 过。真机目视（触发 edit/write 观察新 diff 块、亮暗两主题）留待用户；本会话改动未提交 git。追加修复（用户反馈）：长行横向滚动后行背景不覆盖滚动区——根因是行背景画在 code 单元格盒宽内（列宽=容器宽），溢出文本无背景；修复为整块单一 grid（`3.1rem 3.1rem minmax(max-content,1fr)`）+ 行 display:contents + gap 跨全列，第三列取 max(剩余宽,最宽行) 使全部行背景铺满横向滚动区，设计稿同步修复并加长行示例；验证：npm run build 过 + 无头 Edge 截图像素级确认（绿/红行背景延伸至块右缘）。
- input-clamp-expand 实现定案（本轮）：状态用 data 属性而非 class——Lit 模板重渲染会重写 class 属性，data 属性与注入式遮罩/按钮节点都不在模板 part 内，可跨实时 SSE 更新存活，因此无需按 runId 持久化展开态（元素在即状态在，重开 Tab 回落默认收起）；i18n 标签由调用方注入是硬约束——i18n.ts 运行时依赖 pi-web-ui（pdfjs 引 DOMMatrix），node 环境 vitest 导入即炸，input-clamp 保持零 i18n 依赖才可单测；浅色浓度 3% 的依据：真实浅色 token --background 为纯白（oklch 100%），往纯白混灰极易显脏，深色底则需 6% 才可见，设计稿工具栏留 2–10% 五档供对照；块注释里不能出现 `decorate*/sync*/` 这类写法（*/ 提前终止注释，oxc 解析报错）。设计稿 design-mockups/input-clamp-expand.html 支持 #light/#dark hash 直达与浓度切换，可作真机对照。
- 跑马灯切换滚动实现定案（本轮）：方向/时长/缓动沿用设计稿定稿（方案 A、260ms、里程计同族缓动）；视图元素用 span 而非 div（绝对定位自动块化，语义轻量）；非当前视图整体 aria-hidden（瞬态滚入内容不重复播报，元素本身有 aria-label 覆盖）；finishRoll 用滚动自身文本排程而非 this.text（中途换文结算时 this.text 已是新文本，会错排新当前视图）；同值 sync 增加自愈排程（当前视图完全静止时重排，覆盖 dispose 后同值恢复，旧契约为同值也重排）；旧实现验证页 subagent-tool-marquee-impl.html 标注为 v1 参考并指向新设计稿（其 dist CSS 链接本已失效）。
- subagent 跑马灯间隙保持实现定案（前轮）：不做元素级兜底（空列表时元素整个不渲染，控制器层兜不到），落在数据层——渲染函数改用带记忆数据源，模块级单例与渲染同生命周期；记忆按 runId 隔离（多 subagent 并行不串台），终态一律空列表不消费不污染记忆（恢复 running 间隙仍可回放）；有界淘汰语义对齐 SubagentRunStore（已存在 key 重复 remember 不改变插入顺序）。

- ask_user 评审遗留 ③④ 修复定案（本轮）：③自由输入语义改为可叠加补充——数据模型（buildAskAnswerText/formatAskResult）本就支持 choices+custom 组合，前端清空是多余互斥，删两行即可，文案从『其他想法（自由输入）』改为『补充说明（可选）』对齐语义；④回执直达修改按 backBtn 同构实现（同 renderStep 路径 + disarmSkip，不加动画状态），每行 ghost 式紧凑「修改」按钮（复用 custom-toggle/ghost 的透明底 + hover muted 模式），review-row 改 content 列 + 右侧按钮行布局。

- ask_user 交互评审遗留（前轮只读评审；①②③④已随后续轮次修复，其余未处理待定夺；另有真机反馈两问题——「下一问」与「上一问」分行、自由输入无就近确认入口——已随后续轮次修复：nextBtn 收敛到底部 actions 行 + textarea Enter 确认前进）：⑤30min 超时不可见且吞进行中作答（无倒计时/无提示即 skipped）；⑥刷新/重连后向导进度归零（pendingAsk 恢复但 step/answers 不持久）；⑦命令式 DOM 注入无行为级 E2E（现有测试均为源码字符串断言，按钮 wiring 无真实点击覆盖，含本轮 review 直达修改按钮）；⑧无障碍语义缺失（option 按钮无 role=radiogroup/checkbox、aria-checked，skip 两步确认无 aria-live 播报）；⑨schema 描述宣称 options 与 multiSelect mutually exclusive 但实现允许同用、options>4 超限静默截断；⑩回传给模型的回答文本固定中文（formatAskResult 硬编码『跳过』『未回答』等，英文会话也收中文）。
- 24h 变更风险审查（本轮，只读）：核心发现 H1——存储 v2（3493aeb）v11 迁移只 RENAME 旧表不搬数据，启动导入仅"新表空且 JSON 树有会话文件"才跑、否则静默跳过，全仓库无任何 `*_v10_backup` 读取者：升级前 SQLite 权威且 JSON 副本缺失/不完整的用户会话列表为空、零告警，数据锁死 backup 表（文档自认升级路径=删库重导，但代码零防护零校验）。M2——导入 `count>0` 即永不重跑，首导 skipped 条目永久不可见（修复源文件后自动链路不会 re-run，只能人工删库）。低危：`scripts/session-index-query-benchmark.mjs:7` 悬空 import（canonicalSessionMetadata/sessionMetadataDigest 已从 session-index-service 删除，脚本一跑即模块加载报错）；ACP stdio 入口（acp/server.mjs）不跑 JSON 导入，空库+仅 JSON 时会话列表为空无提示。前端未提交改动两个已核实缺陷：diff-counter `?running` 布尔 attribute 绑定（lit 真值渲染为空串 attribute）与元素侧 `getAttribute('running')==='true'` 不匹配→running 呼吸动画永不生效（对照 quickforge-elapsed-time 的 `running=${String(...)}` 字符串绑定即为正确写法）；OdometerDiffCounterController 整体覆写 `root.className` 丢失模板赋予的 `quickforge-tool-meta-hover shrink-0`→±行数计数器常显（原 hover 显示）且窄布局可被压缩。权限绕过（write/edit 的 onUpdate 在全部路径校验后、partial 无 diff.text 全文）、资源泄漏（新模块 dispose 路径完整）、跨端兼容（scrollend 有 900ms 兜底）未发现高置信问题。M1 已修（见前轮记录），其余未处理待定夺。
- M1 修复实现定案（本轮）：与模块既有单条目韧性语义对齐而非加开关——桶级 metadata 读取失败降级为空 metadata 继续，比跳过整桶更好（正文仍在、可推导），比中断更好（不再 STARTUP_FAILED）；diagnostics kind=metadata-bucket-error 含 scope/projectId/message，warn 日志同字段。

- ask-user-tool 真机两缺陷修复（本轮，用户反馈）：①卡片误显"当前视图无法作答"——propsRef 每渲染整体重建的同步 effect 漏了 onAnswerAsk，首帧后被覆写为 undefined 触发禁用判定；已补字段并加回归源断言（定位 propsRef effect 块内必须含 onAnswerAsk）。②ask_user 工具消息不走设置的工具显示模式——此前未注册渲染器落进 pi-web-ui 默认工具卡；新增 local-tools.ts AskUserToolRenderer（结构与 LocalWorkspaceToolRenderer 同构：toolDisplayMode==='detailed' 才出 input JSON，summary=「N 问 · 首问」，非 detailed 展开时直接列问题清单，output=回答文本，detailsOpen 记忆、isCustom 防默认卡壳）+ ask_user 问号图标 + i18n askUserSummaryCount + .quickforge-ask-tool-questions 样式。验证：定向 ask-user-card(9)+local-tools-lit-reactivity 全过、前端全量 760 用例过、lint 0 error、build 过。
- ask-user-tool 实现定案（前轮）：复刻审批链路但 resolve payload 扩展为 answers[{choices,custom}]；ask_user 无 toolHandlers 入口（agent-manager wrapAskUserToolDefinition 拦截绑定会话，仿 run_subagent）；单问题 schema 兼容（normalizeAskQuestions 接受 {question,options} 简写）；纯函数 normalizeAskQuestions/formatAskResult 放 ask-store.mjs（零依赖可单测）。前端卡片与审批卡同族注入（data-ask-id + displaySignature 去重，向导内部 DOM 变更不触发重建）。

- diff-odometer-counter 实现定案（本轮）：「实时」的落点是工具开始执行即算 diff 并立即发 partial（本仓 edit_file 是单次 oldText→newText 替换、write_file 单次写入，无更细中间态，不伪造数据）；partial 与 end 几乎同帧到达，实际观感=计数器从 0 逐位滚动到最终值的里程计动画。计数器列右对齐保 DOM 稳定（transition 不被打断），位数增长 unshift 新列到符号之后、380ms 后清 enter 标记防重放。设计稿 design-mockups/diff-odometer-counter.html（可重播演示）。

- subagent 跑马灯实现定案（本轮）：内容=「工具名 · 参数摘要」（用户选定，复用 summarizeParams，80 字符截断）；滚动=运行中自动循环（用户选定，非 hover）：35px/s 线性滚动→端部停顿 1s→ease-out 回弹（240–500ms 按时长比例）→起始停顿 1s→重复，起始延迟 400ms；text 变化才重建动画（SSE 150ms 节流同值刷新不打断）；结构=QuickForgeToolMarquee 自定义元素（attribute 驱动，仿 quickforge-elapsed-time，Lit 重渲染保实例）+ ToolMarqueeController 纯逻辑（DOM/定时器/动画注入，node 环境可单测）。「不遮挡」落实：跑马灯 flex:1 1 auto + min-width:0 只占标签与状态间的剩余弹性空间，列宽收缩时先自行退让（实测 340px 下标签仍完整可见带省略号）。
- 模块拆分（本轮）：summarizeParams 从 local-tools.ts 提取为 tool-param-summary.ts（纯函数化，附带 normalizeToolArguments/truncateSummary），local-tools 改 import 行为不变；subagent-run-detail.ts 新增 currentSubagentToolSummaries（pendingToolCalls × traceMessages toolCall chunk 交集，JSON 字符串 arguments 兼容）。
- 验证环境教训（本轮两条）：①本机 8931/8932 端口已有既有 http-server 占用（服务 dist/），python http.server 指定端口前必须 netstat 确认空闲，否则响应错位极难排查；②验证页连续快速拖宽度后动画计数为空是 RO 重启与 400ms 起始延迟的测试竞态（每次 RO 触发 sync(true) 会清掉未触发的起始 timer），干净加载后动画正常——宽度突变后不要立即断言动画状态，等 ≥500ms。
- 既有 lint warning（不变，待择机修复）：server/cloud/identity.mjs:92 no-useless-assignment。

- 回到底部按钮实现定案（本轮，设计稿经用户选定居中形态后落地）：交互——距底部>280px 淡入、<120px 淡出（滞回区间防临界抖动）；点击平滑回底（scrollend + 900ms 兜底，途中 wheel-up 视为用户打断、不恢复自动跟随，prefers-reduced-motion 直接跳底）并经 onJumpSettled→scrollSync.enable() 恢复尾部跟随（回调内再校验距底 ≤120px 才恢复，防打断后误拉回）；不在底部期间 assistant message_start 累计未读徽标，回底或点击清零，aria-label 随未读数切换（i18n en/zh 双 key）。视觉——复用 composer 卡片 token（78% border 混合、card 92% 透明混合、backdrop blur 12px、降一档浮层阴影），icon-only（arrow-down-to-line）居中悬浮于 .quickforge-composer-shell 上方 10px（shell 补 position:relative 作锚点，left/right:0+margin auto 居中，transform 留给出入场动画）；空会话态与 readOnly（dock 被移除）自动不渲染；html.dark 下徽标用亮 emerald。接入点——decorate() 尾部 setup()（与 scrollSync.setup() 同帧，幂等）；显隐独立监听滚动容器 scroll 事件，不侵入 scroll-sync 内部状态。
- 单测抓到实现 bug 一枚（记录）：createButton 内 renderBadge() 在模块级 button 赋值前调用导致初始 aria-label/title 缺失——构造函数内先赋值再渲染即可；测试驱动发现的顺序依赖问题值得保留该用例。
- 思考块高度封顶设计定案（本轮）：根因——thinking-block（pi-web-ui Lit 组件）展开后 markdown-block 全量渲染且无任何高度约束，装饰层折叠只是 display:none 开关，展开时全部高度进入消息列表文档流撑高 agent-interface 滚动容器；流式期间外层过程组默认展开，长思考边生成边撑长页面并触发自动滚底跳动。方案为纯 CSS 单点改动（复用 diff 块 28rem/code-block 24rem/压缩文本 18rem 的 max-height+overflow 先例）；用户确认两项参数：上限 min(60vh, 20rem)（小屏按视口收缩，兼顾 Capacitor Android）、流式期间保持阅读位置不做终端式跟随。交互细节：overscroll-behavior: contain 使思考块内滚到头不连锁滚动外层聊天；标题行在滚动容器外，折叠按钮始终可见；markdown-block 自带 display:block（connectedCallback），max-height 天然生效。
- 验证环境教训：临时 http 服务器给 .css 返回 text/html 会被浏览器 MIME 严格检查拒绝解析（styleSheets 规则数为 0 且 computed style 全默认），排查选择器匹配前先确认样式表实际解析条数。
- 发送按钮等待态设计定案（前轮）：分析确认按钮原为发送↑/停止■两态、无旋转态——prompt() 乐观同步置 isStreaming 使点击后下一帧即翻 Stop，无可感知空档；等待期反馈原仅由三点气泡承担。用户在小样（三方案：A2 方块步进/A1 方块平滑/B 环形）中选定 B 环形——与审批按钮 loading 完全同构、全应用单一旋转节奏。实现要点：::before 环形用 margin 居中而非 transform（transform 归 spin 动画所有，若用 translate 居中每圈末尾会跳位）；等待与生成的区分依赖 assistantWaitingActive（首个 assistant 文字增量即复位），agentic 循环后段工具阶段保持静止■（保守设计，避免图标反复起停）；等待期点击仍为 abort、aria-label 保持 Stop。附带补上了 send-stop-button 的首个单测（此前该模块零测试覆盖）。
- 遗留（记录不处理）：根目录空目录 design-preview/ 因句柄占用未能删除（内含文件已清空，重启后可删）；既有 lint warning server/cloud/identity.mjs:92 不变。

- 存储 v2 收尾（本轮）：重构主体（schema v11 三表/repository/service/importer/mirror+phase+cutover 链删除/auto_vacuum 回收）已在前序会话完成并全量测试通过，本轮补齐文档与簿记：新增单一事实文档 `docs/architecture/session-storage-v2.zh-CN.md`（背景写放大 5 份、三表布局、写入/删除/启动导入路径、删除机制清单、逃生通道、已知取舍、新旧对比表）；v1"当前架构"文档标注为历史参考；recovery runbook 顶部加 v2 修订提示（恢复路径=备份 restore 或删库重导，不再有"降级回 JSON 权威"）；sqlite-storage-foundation §4 补 v11 一段；wiki server README 存储层描述段全面更新为 v2 现状。后续候选（记录在案）：①S2b 发现 `repository()` 先求值 `getSqliteStorage()`——通过 configureSessionStateService 注入 repository 的测试仍需 SQLite 已初始化，若要纯内存 repository 测试需拆开两步（当前测试均先初始化 storage，未构成实际问题）；②`*_v10_backup` 六表稳定观察期后以独立 migration DROP 回收空间；③listPage lastModified 的 json_extract 表达式索引；④share/lan mirror 链后续同类清理候选。
- 存储重构动机留档：旧设计同一数据落盘 ≈5 份（state_json 巨列全量重写 + session_index 派生表 + mirror outbox 完整副本 + drain 物化 JSON 文件 + WAL/自由页永不回收），真实库膨胀至 2~3GB；v2 后每条数据一份、删除即时 incremental_vacuum 归还 OS。用户升级路径：删库文件重启即从 JSON 一次性重导（空库 + JSON 存在时启动链自动触发，每会话一事务幂等）。
- session 分页查询热路径优化（前一轮）：根因=每请求固定全量开销而非分页 SQL（本机库 24 会话 authoritative 纯 SQL 亚毫秒；大库 2415 会话时线性放大且同步阻塞事件循环）：verifyIntegrity TTL 5s 即做 session_states 全表扫+逐行 JSON.parse/SHA-256+session_index 两遍全表且无并发去重；syncMetadataCommit 置空 lastVerifiedAt 使下次分页必触发全量校验；analyzeQuery 每请求 2 条 GROUP BY 全表聚合。修复（session-index-service.mjs，不改导出/降级语义）：TTL 5s→60s + in-flight 共享去重；增量同步成功后保留校验时间戳（成功路径已全量重算 index digest）；analyzeQuery 按索引内容代际缓存（rebuild/增量同步失效，limit/offset 不参与键）。新增 5 测试；文档性能注记入 session-index-query-migration F8 节。基准留档：1k 行 0.8ms / 50k 行 93ms（OFFSET 翻页线性 → keyset/可见性列进索引为中期候选）。〔注：v2 重构后 session_index 派生表与该校验机制已整体退役，本条留作历史〕
- 测试观察（记录不处理）：session-state-background-migration.integration.test.mjs 用例 a) 出现过 EPERM rename %TEMP% .tmp→目标文件（Windows 文件锁/AV 嫌疑）；取样：带改动 4 跑 1 挂、stash 本次改动后通过、恢复后连跑 3 次全过——判定环境级 flaky 候选，与本次改动无关（未触碰 writeJsonAtomic 路径）。
- 后台迁移全部落地（前一轮）：启动秒级 READY（会话域退出维护窗口，窗口仅剩 scheduled-runs/share/lan 三小域秒级）；三机制实现见 feature_list 的 6 个 impl-bg-migration-* 条目。核心链路：index.mjs 按 phase 路由（resolveSessionStateStartupRoute）→ startSessionStateBackgroundMigration（维护锁全程持有）→ 逐桶 alignBucketStream（不 enqueue mirror）→ 收敛循环（逐桶只读 digest 对拍内存 Map）→ idle 信号（SSE 流计数+写静默）→ 切换窗口（全局 persist 锁→barrier→最终对拍→promoteAlignedSessionState→drain）。备份在 idle 期异步（复验已登记可复用、有界重试、与切换解耦）。
- boot 竞态修复（本轮追加，commit 1e959d4 已推送）：用户另一台机器部署新版后 UI 无法启动只显示错误卡——根因是 boot 阶段（initializePiStorage/设置校准）在迁移门之前发业务请求，撞上 migrating 窗口 503 落进通用错误卡。修复：catch 探测 migrating 转入迁移门（进度视图）+ ready 后自动重试 boot；waitForMigrationSettled 容忍单次轮询失败（连续 3 次才抛）。
- auto-archive 启动 49s 阻塞优化（本轮，quick_check 修复后用户机器二次实测发现）：三域 check 27ms/8ms 通过后仍有 49s 零日志空洞、浏览器请求堆积至同毫秒簇放行——事件循环被同步阻塞。根因：startAutoArchiveRunner 启动链末尾立即首次归档，扫描阶段逐候选 readSessionValue 全量加载正文（~2400 会话 2.9GB）。修复：元数据优先扫描（activityTime(metadata) 可判定零正文读；null 才回退；事务内全量复核保证归档正确性不变）+ 归档循环间 setImmediate + 首跑延迟 30s。附带根治 writeJsonAtomic 的 Defender rename EPERM 竞态（有界重试+失败清 tmp，本机测试 flake 与历史 tmp 残留共同成因）。用户机器预期：启动链 complete 从 lan-check 后 ~49s 降至秒级。注意：auto-archive 若有历史积压，会在启动 30s 后开始逐个归档（已让出循环，前台无感）。
- session_states 元数据覆盖索引（本轮终局修复）：启动分段计时实测——reset-stale-task-statuses 零写入仍 45.2s、session-index 同一扫描仅 1.5s（冷/热差）——定案根因：WITHOUT ROWID 表行内 state_json（GB 级）在 metadata_json 之前，读靠后列必须穿溢出页链，SELECT metadata_json 隐式读全库 2.9GB，每进程首次冷读必付。migration v10 覆盖索引（含 metadata_json/metadata_digest）使元数据读取 index-only（EXPLAIN 四形态验证命中），全部元数据热路径（readSessionMetadataBuckets/metadataBucketChanges/readSessionStateStore('sessions-metadata')/auto-archive 扫描/index 服务 readSnapshot）受益；升级后首启建索引一次性慢（listen 前），之后启动预期 reset-stale/session-index 均毫秒~秒级。纠正：前两条 49s/50s 空洞曾误归因 auto-archive（次要真实问题），大头一直是本条；剩余可见慢步骤为 session-state-cutover ~1.6s 与 session-index 热 ~1.5s，可接受。
- 启动 quick_check 检查税优化（本轮，commit 3d1ae01）：四域启动检查各自对同一 2.93GB 库文件全量 PRAGMA quick_check 3~4 遍（用户机器实测 session 16s+share 7s+lan 6.6s≈30s）。runSharedSqliteQuickCheck（database.mjs）：进程内按库路径去重 + marker 文件 7 天降频 + 维护端点/env force 逃生口；预期用户机器启动检查税 30s→秒级（更新后首启仍真扫一遍写 marker，之后 7 天内跳过）。已知取舍：备份导出/离线工具的 quick_check 也走 7 天门（内容级 count/digest fail-closed 校验不受影响，bit-rot 影响内容会被 digest 检出）；marker 不绑定库文件 mtime/size，外部替换库文件盲区最长 7 天（force 或删 marker 消除）。
- 启动 OOM 生产事故与修复（本轮，重要）：用户真实大库（2.93GB SQLite、authoritative 相位、今日两次全量 cutover 后首次进入 authoritative）每次启动 38 秒后 4GB 堆 OOM 崩溃，进程死掉→端口无监听→界面"无法启动"。取证链：四域 check 全过（authoritative）→ lan-access 之后 8 秒内崩 → sw.js 被同步阻塞 6.6s → 堆 4095MB Mark-Compact 全失败。根因：启动链 resetStaleTaskStatuses→atomicUpdate('sessions-metadata')→atomicSessionMetadataBucketUpdateViaFacade→readSessionStateStore('sessions-metadata')→repository().exportSnapshot() 全库（state_json+session_messages 重组）载入。修复三处同病灶：①readSessionStateStore('sessions-metadata') 复用 readSessionMetadataBuckets 只读 metadata_json（JSON 时代该 store 本就 metadata-only）；②metadataBucketChanges（updateSessionMetadataBucket 底层）current 构建弃用 exportSnapshot（不改则逐桶调用仍 OOM）；③atomicSessionMetadataBucketUpdateViaFacade 逐桶 RMW（顺带修掉全 scope 合并写 global 桶的跨桶混写错误，project 会话元数据不再错挂 global）。附带收益：readStore('sessions-metadata')（acp 列表/backup/auto-archive 路径）权威相位也变 metadata-only。教训：小测试库测不出 GB 级库的内存放大路径；exportSnapshot 全库快照类 API 只允许出现在维护锁内低频路径（restore/import），任何启动链/业务链路禁用。
- 测试观察（记录不处理）：agent-manager.external-sync.test.mjs 的 "keeps transient ACP context..." 用例在全量并发下出现过一次失败（单跑与全量复跑均绿），疑似 flaky 候选，后续择机排查。
- 集成测试发现 2 个真实缺陷并已修复：①严重——barrier-parked 业务写在 promote 后重放仍走 JSON 路径导致权威源丢写，storage.mjs 全部会话写入口补"执行时 facade 复检重路由"（*ViaFacade 助手，嵌套 metadata 写同覆盖）；②background.state 缺 converging（补 setState）。另理论风险已记录：parked 旧写覆盖 promote 后新写的窗口被"微任务级联+promote 要求空 mirror 队列"封闭，若后续引入窗口内宏任务间隙需复查 runSwitchWindow 的 release 顺序。
- 设计→实施主要偏差（已记入设计文档 §11）：promote 走 repository 内部 updateStorageState（避免循环依赖）；barrier park 从 drain 完成后生效（防嵌套入队自锁死锁）；backup.verify 无 sha256（避免 1.4GB 双读）；"写时间戳未变跳过重读"优化未实现（正确性优先）；cutover 模块 cutover_running 恢复分支保留（新链不再到达，维护工具可直调）。
- cutover_running 存量残留清退与双进程 status 可见性（设计 §10.1/§10.2）已落地：残留由后台任务锁内复位（backupFile 保留、phase.reset 日志）；锁忙 aborted 快照携带 lockOwner/lockOwnerPid/lockFencing，第二进程经 migration-status 可见。
- 未做（记录在案）：慢盘/大库内存上界断言（需大库装置，归 §10.3 真实库实测待办）；writeSessionValues/restore 类写在维护锁内运行无 parked 场景未加重放路由（如需防御性覆盖后续单独评估）。
- 前一轮设计阶段的产出与决策详见 git 历史中 feature_list.json 该轮提交；评审实施（review-* 11 feature）遗留事项不变：⑤门禁豁免不一致、⑥backupFile 复用旧快照、P2 减 pass 快照方案、"彻底不碰 JSON"三处架构依赖、前端 dispose 通知、agentSessions LRU、SQLite 大事务拆分等范围外候选。

## Notes

- 评审建议全部实施完成（本轮，11 个 feature 全 done，详情见 feature_list.json）：①split 中部编辑采样校验（body-only 多一次主键单行查询，顺带修复 split body 双重表示的预存 bug：normalizeRecord 剥离 split 标记 body 的内联 messages，旧库下次保存自愈）；②persist 冲突表面化（session.persistDegraded + SSE persist_degraded 事件 + 前端 panel-decoration 警告条，persist 成功自动清除；仅内存标记重启不恢复，语义合理）；③synchronous 实测定案并落地切 FULL（database.mjs，health 摘要同步）；④fail-closed 恢复指引（STARTUP_RECOVERY_GUIDANCE 附加段 + 一页式 runbook docs/architecture/session-storage-recovery-runbook.zh-CN.md + App.tsx 错误页 pre-wrap）；⑤保存热路径优化（IN 分批去重 O(增量)、readLastMessage 替深 OFFSET、WeakMap<handle,Map<sql,stmt>> 语句缓存）；⑥drain 同会话合并 + mirrorQueueRevision 取代跳过 + mirror 永久设施定位入文档（F8 §4.1）；⑦权威相位 index 就绪判定切 SQLite 源（readAuthoritativeSessionMetadataBuckets，index.mjs 与 acp/server.mjs 均切换；digest 口径与 upsertIndex 天然同构未动体系）+ F7 退役计划入文档；⑧当前架构单一事实文档 session-storage-current-architecture.zh-CN.md + 完整 phase 状态机 SVG；⑨cutover 恢复备份复核（verifyRegisteredCutoverBackup 包络 count/digest 对拍，损坏重写；不含中段 bit-rot，登记时未存文件 sha256 属范围外）+ POST /api/storage/maintenance/verify-session-integrity（full 逐行校验，维护锁内，409/423 门控）+ restore/roll-forward 后 checkpointWal；⑩mirror 死信 MIRROR_MAX_ATTEMPTS=12（diagnostics 暴露 mirrorDeadLetters，re-enqueue 复活）+ 无 id 消息整批 digest 重试去重 + 墓碑 GC 语义固化（现有 save 路径本已删同 key 墓碑，补注释+测试）。
- synchronous 实测定案（本轮）：新增 `scripts/sqlite-synchronous-benchmark.mjs`（2000 次单事务 upsert + 单事务批量 2000 条，state_json≈50KB，3 轮中位数）。本机（Win11/Node v24/SQLite 3.51.3/NVMe）实测：小事务 NORMAL 0.531ms/op vs FULL 0.989ms/op（1.86x，绝对增量仅 0.46ms）；批量导入 1.00x（fsync 被单事务摊薄）。定案：切换 FULL，结论与实测表已写入 `docs/architecture/sqlite-storage-foundation.zh-CN.md` §3.1；server 代码 PRAGMA 切换已由 `review-switch-sqlite-synchronous-full` 落地（done）。
- 会话 SQLite 迁移整体设计评审（本轮，纯文档产出）：`docs/architecture/session-sqlite-migration-design-review.zh-CN.md`（含写路径 SVG 图 `docs/architecture/assets/session-sqlite-write-path.svg`）。双路评审（设计文档 + 源码核查）+ 三个存疑点源码实证：①phase 切换与导入确认同事务提交，无中间态；②备份登记必在校验后，无"登记坏备份"窗口（残余低风险：登记后外部损坏不复核）；③权威态查询 fallback 读 SQLite 而非过期 JSON，无正确性问题（仅 pending 窗口性能降级 + ~1s 缓存瑕疵）。评审主要发现：高优先级——split 会话中部原位编辑静默丢弃（messageStoragePlan 尾 digest 启发式盲区）、persist 冲突三次重试后静默放弃（仅 warn 无用户反馈）、`synchronous=NORMAL` 丢失窗口无论证、fail-closed 启动缺用户可恢复通道；中优先级——append 去重 O(存量)（repository.mjs:361）、尾行深 OFFSET（service.mjs:327）、mirror drain 抵消 split 增量收益、exportSnapshot 被元数据操作调用、JSON mirror 双写无退役路线、F7 shadow/TTL 机制 F8 后冗余、文档碎片化。改进建议 10 条按优先级见报告 §7；本轮未改任何代码。
- P1 启动维护窗口（本轮）：listen 前仅 `ensureStorage()+initializeSqliteStorage()`（gate 与 migration-status 依赖 DB；失败置 failed 不退出），其余启动链逐字保留移入后台 `runStartupInitialization()`。维护窗口 gate 在 index.mjs `/api/` 分支 handleApi 之前：白名单（GET /api/health、GET /api/migration-status）放行，其余 503 `{ok:false,maintenance:true,state}`+Retry-After:5；非 /api（静态、/share/）放行。health 三态：migrating→`{ok:true,maintenance:true,...完整状态}`（getSystemStatus 异常降级精简）、ready→原样、failed→`{ok:false,startupError}`（进程存活，waitForQuickForge 持续轮询到超时保持"启动失败"语义）。listen 回调里的云 agent 改为等启动链 settle 后再起（failed 跳过），避免维护期撞 503。
- fail-closed 语义变化（有意）：从"进程退出"改为"服务存活但拒绝业务 API"。收益：desktop 窗口/CLI 已开的浏览器不再直接消失，用户看到错误页（含 startupError 原文）而非黑屏；代价：CLI spawn 模式失败表现为 5 分钟超时而非快速失败，需 qf stop/restart 恢复。架构文档中"block startup"表述的实质（阻止业务使用）未变，wiki server/README.md 与 routes/README.md 已更新说明新机制。
- P0 四项修复（本轮）：① scheduled-runs 偷锁双条件（`!expired || stalePid===null || pidAlive` 均不偷，与 session 域一致，复用注入 now()）；② retainedMaintenance 在 finally 正常释放分支复位（retain 错误路径不动，DB 锁行兜底 isScheduledRunsMaintenanceActive）；③ authoritative 分支拆两段 try：JSON 读取/slim 失败→diagnostic+warn 降级继续启动，health 失败→保持 throw blocked；④ session/share/lan cutover 补 logger（开始/完成/晋升/回退/fail-closed error/fallback warn，options.logger 注入模式），index.mjs 启动链 catch log.error+flushLogger。旧测试"authoritative JSON 校验失败 fail closed"语义已改为 fail-open（JSON 是非权威 mirror），新增 health 失败 fail-closed 用例补齐覆盖。
- 前端迁移进度（本轮）：`src/lib/migration-status.ts`（fetchMigrationStatus 网络/非200/坏 payload→{ok:false}、migrationPhaseStage 映射、waitForMigrationSettled 可注入轮询门支持取消）；useAppBootstrap 在 initializePiStorage 后插迁移门（migrating→setMigrationStatus+2s 轮询、ready→清状态继续原 boot、failed→{kind:'migration',detail:startupError} 错误），catch 里补一次 migration-status 探测覆盖"页面加载时服务端已 failed"路径；startupError 从 string 升级为 {message,kind,detail?}（注意：这是 hook 返回值形状变更，既有测试已同步加 mock）。MigrationProgressView 复用 splash 容器/图标动画（抽 StartupSplashIcon 共用），4 域状态点遵循 DESIGN_LANGUAGE 强度梯（border→foreground 呼吸→实心）。仓库无前端渲染测试先例（全 mock react 逻辑 harness），组件无渲染断言，逻辑由单测覆盖。
- 已知取舍/遗留：迁移轮询期间单次网络抖动会落错误卡片需手动 Retry（可后续加连续失败计数）；WebSocket upgrade（/api/terminal/*）未 gate（前端就绪后才连，风险低）；failed 时 CLI 5 分钟超时表现（见上）；migration-status 各域 count 字段名不同（runCount/stateCount/shareCount/lanTokenCount）。
- 语句复用优化（本轮早些）：cutover 导入（`replaceAll`/`replaceAllStream`）原在循环内每行 `db.prepare()` 重新编译 SQL。改法：SQL 提取为模块级常量（`UPSERT_SESSION_INDEX_SQL`/`ENQUEUE_SESSION_MIRROR_SQL`/`SHARE_SESSION_UPSERT_SQL`/`ENQUEUE_SHARE_MIRROR_SQL`），函数追加可选 `statement = null` 参数（不传走原路径，运行时调用方零影响），导入循环前 prepare 一次复用。node:sqlite `StatementSync` 与事务状态解耦，BEGIN 前/后 prepare、事务内多次 run 安全。未改 `lan-access-repository.mjs`（其 replaceAll 无循环，各函数只调用一次）；`replaceTokens`（DELETE+INSERT 各一次/调用）与 `writeMessages`（split-message 记录才触发）保持不动——share 域规模小/不在 cutover 主路径，收益趋零。
- cutover 性能调研结论（本轮，指导后续方向）：瓶颈在 CPU 侧——session-state 整库被完整 parse+规范化+digest 4 遍（双读校验/备份/导入），每条记录含 2×structuredClone + 2×JSON round-trip + 2×sha256；磁盘侧已被单事务 all-or-nothing + WAL + synchronous=NORMAL 规避（整个迁移只 COMMIT 时一次同步）。"分批读+分批插"打不中瓶颈：分页提交破坏可回滚语义且无 I/O 收益，分批读不减少 parse 次数。数量级收益要靠减 pass（文件级快照替代双读，需重新论证并发安全，属独立 feature）。
- SQLite/JSON 启动兼容设计评审（本轮产出）：遗留 bug 清单中 ①启动失败黑盒 ②scheduled-runs 锁偷锁只查 pid ③retainedMaintenance 泄漏 ④authoritative 读 JSON fail-closed 扩大化 已由 fix-cutover-startup-bugs 修复；仍未修：⑤门禁豁免不一致（调度 gate vs backup-export 豁免）、⑥失败回退后 backupFile 复用旧快照可能错位（语义待定/低概率，择机处理）。体验方案（listen 提前+进度 UI）已由 startup-maintenance-window 落地；"彻底不碰 JSON"仍受三处架构依赖制约（session_index 权威源仍是 JSON metadata、scheduled-tasks metadata 永久驻留 JSON、mirror outbox 持续写 JSON），属独立 feature。

## 并行会话记录（rebase 整合）

- ✅ 启动慢根因（远端会话 fix-startup-cutover-replay，修复代码未推送，**已在本仓库按其状态文件描述重建并验证通过**）：`session_storage_state` 卡在 `json_authoritative`（8-18 起 `Session state replace digest verification failed`），每次启动重放完整迁移（4 遍 1.6GB JSON 全量流读 + 1.4GB 备份写 + SQLite 全量导入再回滚）。排序不一致是核心 bug：JSON 源侧 summary digest 按 sessionId `localeCompare` 排序（`buildSessionJsonSnapshot`/`createStreamingSessionSource`/`writeCutoverBackupStream`），而仓储侧 `digestFromLines`/`verificationDigest` 按**整行字节序**排序。global+project 混合桶时两种排序必然交错不同（实测真实数据：`76eadc82…` vs `a40c7ee7…`），`replaceAllStream` 末尾 digest 校验必炸。现有测试数据集恰好两种排序同序，从未暴露。修复已在本仓库重建落地：`digestFromLines` 导出为唯一 canonical 实现，cutover 源侧三处（`buildSessionJsonSnapshot` / `createStreamingSessionSource` 的 `getSummary` / `writeCutoverBackupStream` 双 summary 校验）全部改用（records 迭代顺序与流式 bucket 内排序保持原行为，仅 digest 统一）；repository 新增 `checkpointWal()`（`PRAGMA wal_checkpoint(TRUNCATE)`，返回含 busy 的 pragma 行），两个 promote 成功点晋升 authoritative 后经 `checkpointWalAfterPromote` 调用（try/catch，失败仅 log.warn 不阻断）。新增混合桶测试（global 'Zeta' + project 'alpha'，localeCompare 与字节序不同序）：改源码前精确复现 `Session state replace digest verification failed` 回退 json_authoritative，改后端到端晋升 authoritative。与维护窗口互补：新版首次启动一次性完成迁移（预计 1-2 分钟）期间用户看到进度页。
- 事故记录（远端会话，已回滚）：验证时一次 `QUICKFORGE_DATA_DIR` 未设成功的 node 脚本误在真实库执行了 cutover——digest 修复实证生效（首次成功 commit，2415 会话入库），但违反独占前提（旧服务还在 JSON 模式写数据），随后手动补救被用户叫停。已将 `session_storage_state` 回退为 `json_authoritative`（JSON 权威未动，quick_check ok，5176 服务存活）；SQLite 残留条目会在下次 cutover 的 replaceAllStream 中整体清空重写。教训：对真实数据目录执行任何写路径前必须显式断言 dataDir 非默认值。
- 用户数据现状（远端会话记录，择机清理）：`conversations` 4.36GB 中 2.75GB 是 1045 个原子写 `.tmp` 残留（JSON 模式高频全量重写的副作用）；WAL 2.8GB 待新代码 cutover 成功后自动 TRUNCATE。npm 全局包（旧代码）在发布新版前仍是慢启动。
- 桌面端与 `qf` 共用 `server/index.mjs` 初始化链，同根因同修复；桌面端 `ready-to-show` 策略使首屏 6.5MB modulepreload（pi-web-ui 3.75MB + pi-ai 1.6MB）也计入可见时间（独立遗留项，未处理）。
- 字体滑块闪烁（远端会话）：滑块 @input 每步同步 `applyFontSizeSettings` 改 root font-size 造成整页 reflow；修复为 RAF 合并 + dirty-check + 仅 interface 字号变化时派发事件。
- 归档删除（远端会话）：设置页永久删除走 batch 两操作事务，旧 `applySessionBatch` 对 metadata delete 无条件拒绝；修复为配对 metadata delete 视为 no-op 放行。删除后复活路径已堵（路由删持久化前先 destroyAgent）。遗留竞态（范围外）：删除请求处理期间另一请求恰好 restore 同一 session 仍可能复活，彻底堵住需 tombstone 机制。

- 中止双消息根因（本轮，只读分析未改码）：用户点停止后同时出现「请求已中止」+「错误： Request was aborted」。链路：pi-ai 把中止定稿为 stopReason="aborted" 且塞 errorMessage="Request was aborted"（anthropic-messages.js catch 分支）→ pi-agent-core turn_end 无差别写入 state.errorMessage → agent-manager agent_end 订阅（agent-manager.mjs:2111）见 state.errorMessage 即 appendAssistantErrorMessageOnce 补一条 stopReason="error" 消息，而其去重只认末条 stopReason==="error"，对 aborted 末条失效 → 两条消息分别渲染成斜体中止行与红框错误行。修复方向（待定夺）：agent_end 补条前判 eventEndStatus==='aborted' 跳过 + 去重放宽到 aborted 末条同 errorMessage；i18n 补 'Request was aborted' key（现 key 是 'Request aborted' 少了 was，原文翻译不到）。

## 历史笔记

- 持久化锁修复（前轮）：`withSessionPersistenceLock` 从全局单链改为 keyed 队列（`session-persistence-lock.mjs`），默认 key（''）保持全局串行；`persistSession` 在 SQLite 权威模式下用 `session:${sessionId}` key，JSON 镜像模式保留全局 key（bucket 级 read-modify-write 需要）。正确性依据：authoritative 模式下正确性由 per-row revision CAS 独立保证，全局互斥是 JSON 时代遗留；SQLite 单连接 + DatabaseSync 同步 API + Node 单线程保证任意时刻至多一个事务执行。auto-archive 仍用全局 key；其与 per-session persist 的交错由 CAS + 写前重校验保证。锁 drain 后 Map 条目自动清理。
- 慢 persist 观测：`persistSession` 记录耗时（排队+编码+同步写），阈值已由 1s 降至 200ms（optimize-persist-encoding-yield）打 warn（含 messageCount），便于定位"大会话同步事务阻塞事件循环"。注意同步 SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大；编码段已由单遍序列化器+分批 yield 优化，残余同步写突刺（INSERT+COMMIT）需慢日志量化后再决定是否升级 worker 线程方案。
- `runTaskkill` 超时兜底（`server/utils/process-tree.mjs`）：taskkill.exe 挂起时 10s 后 resolve(false)，不再让 dispose()/destroyAgent 永久悬挂（Windows 上 OpenCode 子进程清理路径）。
- `/api/agents/:id/restore` 挂起+内存增长根因分析：① 前端切到一个 session 时并发发 POST /restore + GET /state + GET /messages + GET /status + SSE，这些路由在内存无 session 时都隐式回落 restoreAgent，而旧实现是 check-then-act，并发时各自 createAgent、最后一次 set 覆盖前面的——被覆盖的 session 永不销毁，形成孤儿泄漏。② 前端切 session 只 abort fetch，服务端 handler 照常建 session。③ agentSessions Map 唯一删除点是 destroyAgent。④ 全局 withSessionPersistenceLock 是无超时单链 promise 队列，persist 积压时阻塞事件循环 → 请求挂起。
- restore 修复（前轮）：`restoreAgent` 拆为外层去重 + `restoreAgentUnlocked`，`pendingRestores` Map 按 sessionId 共享 in-flight Promise，finally 清理。所有并发调用点收敛到模块内单个函数。
- 测试教训（锁单测）：模块级队列 Map 在同一测试文件内共享——测试失败路径泄漏的 pending 链会污染后续使用相同 key 的测试；每个测试用唯一 key + gate 必须 settle + `await new Promise(r => setTimeout(r, 0))` 排空微任务。
- 未实施的后续候选（见 session-handoff）：前端 dispose 通知服务端提前回收、agentSessions 上限 LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 归档闪烁根因（前轮）：`archiveSession` 归档后调 `refreshSessions({ broadcast: true })` 的全量重置模式导致侧栏闪烁；修复为归档成功后本地乐观移除。
- 遗留（范围外，择机处理）：`ChatSidebar.confirmDeleteSession` 的 `deletingSessionId` 成功后不复位、`deleteAnimationTimeoutRef` 为共享单值 ref；置顶区删空后整块条件卸载（无高度过渡）。
- 分页死循环根因（前轮）：删除/归档改变服务端 total 与排序窗口后，前端 offset 分页 + uniqueSessions 去重可能整页全重复 → hasMore 恒 true 无限请求；修复为零进展时 total 收敛为 items.length。
- 已知取舍：若服务端确实还有更多数据但某页全为已加载项（去重误伤），hasMore 会提前置 false，需下次 refreshSessions 恢复。
- loadMoreGlobal/loadMoreProject 无 loading 守卫（零进展收敛已可终止循环）。
- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment，多会话前已存在。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地）。
- 前端分页测试技巧：mock React harness 中测 offset 分页必须显式传 offset，不能依赖 loadMore* 的闭包 state。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
