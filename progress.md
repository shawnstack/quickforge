# Progress

> 归档说明（2026-09-04）：更早的 33 个条目已移至 docs/archive/progress-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json。

## Completed Feature：agent-manager-module-split（2026-09-04）

- Feature: agent-manager.mjs 上帝模块无损拆分（agent-manager-module-split，**done**）——纯机械搬移，零行为变更。
- 结果：agent-manager.mjs 4014 → 约 1966 行，保留会话生命周期编排 + facade re-export；新模块 agent-session-store / agent-session-events / agent-harness / agent-compaction / agent-prompt-commands / agent-approval-orchestrator / agent-subagent-runner / agent-persistence，函数逐字符搬移，消费方 import 路径零改动。
- 执行序列（每块独立 commit，均过门禁）：b55c3d8 安全网（导出面契约测试 + agentSessions/pendingRestores/subagent 错误暂存收口）→ 557b748 事件核心（agentEvents/emitSessionEvent/分帧/消息构造器/context usage）→ 61d316d harness 常量 + /summary /compact /clear → 9fe9758 斜杠命令解析与 prompt 模板 → e841aad 审批 Promise 编排 → f33e70b run_subagent 生命周期 → 1f7a8fd 会话持久化（persistSessionState 经 facade 保持公共 API）。
- 门禁：每块全量 npm run test 与基线一致（275 files / 2612 tests，唯一失败为既有前端 CSS 契约，与 server 无关）、eslint 0 error、build 通过；契约测试锁定 47 个消费面符号不变，内部共享导出（resetIdleTimer/createServerTools，persistSession 已随块4收回）单独登记；tunnel-host 集成测试捕获一处链接期缺导出（persistSession 未导出）并即时修复。两个既有源码契约测试（model-retry-notice、agent-harness）同步覆盖符号新位置，行为断言不变。
- 文档：docs/wiki/server/README.md 模块地图同步（目录树 + agent-manager 条目 + 拆分模块清单）。
- Notes: ① 前端 App.tsx / ChatPanelHost.tsx 上帝组件拆分另行立项；② 工具构建（createServerTools 等）与 SSE 路由仍在 agent-manager，后续可继续拆；③ 工作区基线的 local-tool-running-sweep 前端 CSS 契约失败为拆分前既有问题（motion-design 批次遗留），与本 feature 无关。

---

## Planned Feature：agent-manager-module-split（2026-09-04 立项，未开始）

- Feature: agent-manager.mjs 上帝模块无损拆分（agent-manager-module-split，**pending**）——纯机械搬移，零行为变更。
- 背景：架构审查（双 explore 调研）确认 agent-manager.mjs 约 4000 行混杂 8+ 类职责，模块级可变状态 agentSessions/stashedSubagentErrorDetails/pendingRestores 无唯一 owner、36 处直接引用，为最大风险聚集点。
- 方案：① 第零步建安全网：全量 test/lint/build 基线数字、导出符号契约测试、高风险区（persist CAS / subagent 超时中止 details / 审批 Promise）补行为用例；② 状态收口到 server/agent-session-store.mjs；③ 绞杀式逐块抽取 agent-compaction → agent-prompt-commands → agent-subagent-runner → agent-persistence → agent-approval-orchestrator → 工具包装，agent-manager 保留 facade re-export，消费方零改动；每块独立 commit，门禁=契约测试+全量 test 与基线一致+lint+无新增循环 import。函数体逐字符搬移，不改任何语法语义/逻辑/导出面。
- Boundaries: 只拆模块不改功能；前端 App.tsx/ChatPanelHost.tsx 拆分另行立条目；发现的问题只记 Notes。
- Next step: 执行第零步（基线 + 导出契约测试）。

---

## Completed Feature：motion-design-batch-1（2026-09-04）

- Feature: 动效统一第一批——motion token、弹窗进入动画、侧栏文字淡入双通道、按钮按压微交互、工具扫光纳管（motion-design-batch-1，**已完成**）
- Status: done — 五项动效按确认方案落地，源码、契约测试与 DESIGN_LANGUAGE.md 已同步；未 commit。
- 实现：`src/index.css` 顶层 `:root` 新增 `--quickforge-dur-fast/base/slow`（120/180/280ms）与 `--quickforge-ease-out`（cubic-bezier(0.2,0,0,1)）token；新增共享进入原语 `quickforge-dialog-backdrop-in` / `quickforge-dialog-panel-in`（遮罩淡入 + 面板 translateY 4px、scale 0.97 落位，进入-only）接线 prompt-dialog 与 confirm-dialog；`quickforge-sidebar-label-in`（opacity 淡入）挂 ChatSidebar `sidebarSessionTitleClass` 与 `sectionHeaderClass`，侧栏展开时文字随宽度过渡淡入；`ui/button.tsx` cva 基类升级 `transition-[background-color,color,border-color,scale] duration-(--quickforge-dur-fast) ease-(--quickforge-ease-out) active:scale-[0.97]` 全局按压回缩；工具扫光保持 1.8s 循环并注释为时长刻度豁免类。全部 keyframes 带 prefers-reduced-motion 降级。
- 测试：新增 `tests/frontend/motion-design.test.ts` 7 用例（token 定义、弹窗原语+接线、侧栏淡入挂载点、按钮按压契约含 v4 scale 属性、扫光豁免、reduced-motion 守卫）；同步更新 `sidebar-section-order.test.ts` 对 `sidebarSessionTitleClass` 的既有精确字符串断言。
- Verification: 定向 vitest 2 files / 27 tests 全过；eslint 6 文件 0 error；`npx tsc -b` 通过；`npm run build` 通过（仅既有 chunk size 警告）；产物 CSS 抽查确认 token var、`transition-property` 含 scale、`.active\:scale-\[0\.97\]:active{scale:.97}` 与 dialog/label keyframes 均正确编译。未跑全量 test/lint。
- Boundaries: 不新增依赖/动画库；仅进入动画；只动 opacity/transform/scale；大型功能弹窗（skills/GitGraph/ShareConversation）与 toast/菜单/列表 enter-exit 属后续批次。
- Next step: 真机冒烟——弹窗打开淡入落位、侧栏展开时标签/分区头淡入、任意按钮按压缩放反馈、系统开启「减弱动态效果」时以上全部瞬时呈现。

## 1.10.2 发布状态（2026-09-04）

- 已 bump 版本至 1.10.2，并完成当前 dev 分支待发布提交的文档整理。
- 发布前门禁已通过：`npm run test`（273 files / 2602 tests 全过）、`npm run lint`（0 error，1 个既有 warning）、`npm run build`（通过，含既有 KaTeX/chunk warnings）。
- qf-agent 测试夹具已最小修复：Windows `taskkill` mock 正确触发 exit，并在每个测试前恢复 real timers；定向测试 28/28 通过。
- runtime/offline 包已生成并复核，`package-offline/shawnstack-quickforge-1.10.2.tgz` 约 7.4 MB，包内版本为 1.10.2。
- v1.10.2 Git 发布已完成：release commit `40deadb`、tag `v1.10.2` 已创建，并已推送 `origin/dev`；本次不执行 npm publish。
- 当前 `pinned-summary-draggable-capsule` needs-review feature 已按用户确认纳入本次发布，仍保留 needs-review 状态。

---

## Completed Feature：dead-code-cleanup-round-1

- Feature: 僵尸代码清理（dead-code-cleanup-round-1，**已完成**）——删除全仓库零引用的导出符号与遗留文件。
- Status: done — 三路只读调研（src/、server/、scripts/tests/外围）产出候选清单，随后逐符号 `grep -w` 全仓库复核（排除 dist/package-dist/package-offline/desktop-dist/node_modules/android），仅删除复核确认的高置信度项；未 commit。
- 删除内容：① 前端 6 个零引用导出（openCodeUsageIcon、getWorkspaceTree 及其独占类型 WorkspaceTreeResponse、clearApiCache、INPUT_CLAMP_EASING、selectableModelsFromProviders、sessionScope）；② server 19 个零引用导出，其中 skills.mjs 的 5 个无后缀旧包装（loadSkills/listSkillSummaries/findSkill/filterKnownSkillNames/loadSelectedSkills，现行 API 为 Global/Project 变体）、storage/share-store 各 2 个、agent-manager/sqlite/session-state-service/access-policy/lan-access-store/project-config/share-service/subagents/utils/workspace/agent-profile-files 各 1 个；③ 级联死链：requireShareJsonAdapter 删除后 share-service.mjs 的 `jsonAdapter` 只写变量、`configureShareService` 的 `json` 参数与 share-lifecycle 测试的 `json: null` 一并移除；④ 遗留文件：`dev-server.log`（gitignore 本地文件）、根目录 3 张 `oom-*.svg`、`artifacts/`（单文件后删空目录）、`design-preview/`（空目录）、`tests/fixtures/` 5 个零引用 electron-smoke 脚本（scheduled-runs-cutover/scheduled-task-runs/scheduled-task-runs-service/session-index/session-state）。
- 保留依据：restart-supervisor/update-supervisor 与 maintenance/*-v1 为运行时动态路径加载非孤儿；quickforge-settings-select.ts 为副作用 import；design-mockups/ 被源码注释引用为设计出处；generateSharePassword 前端同名函数来自 share-client.ts 非删除对象。
- 文档同步：`docs/architecture/browser-cache-strategy.zh-CN.md` 删 clearApiCache 条目、`docs/wiki/server/README.md` 删 requireShareJsonAdapter 提及、`docs/wiki/server/utils/README.md` 删 invalidateDirectorySizeCache 提及、feature_list.json 清理 browser-oom-first-aid files 数组中 3 张已删 SVG。
- Verification: 删除后复查 25 个符号代码零残留，级联候选（pruneTokenRecords/verificationDigest/messagesDigestFromValues/subagentDefinitions/readJsonFile 等）均有其他调用方；`node --check` 14 个改动 server/测试文件通过；`npm run test` 273 files / 2602 tests 全过；`npm run lint` 0 error（仅 identity.mjs:92 既有 warning，见 Notes）；`npm run build` 通过（仅既有 chunk size 警告）。
- Boundaries: 未新增依赖；未触碰 dist/、package-dist/、package-offline/、desktop-dist/；未 commit/tag/push；中低置信度候选（约 200 项"仅文件内使用的冗余 export"、生产-测试僵尸、scripts/ 一次性基准脚本）未动，留待后续轮次。

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
