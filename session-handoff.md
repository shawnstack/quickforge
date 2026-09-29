## 当前交接：local-path-link-trailing-text（done，2026-09-29）

- Current Objective（当前目标）: 对话路径显示不再把文件地址后紧贴的文字吞进链接。已实现，未提交。
- 根因: 绝对路径分支尾部字符类 `[^\s"'<>\`]+` 吞 CJK 正文（含中文标点）；末尾剥标点救不回中间文字。
- 改动内容: `local-file-path-links.ts` 新增 `resolveLocalFilePathCandidate` 终点解析（剥标点 → 无 CJK / 扩展名结尾直接接受 → CJK 截断到扩展名 → 无效则放弃链接）；相对路径分支扩展名尾部负向前瞻防超 8 位英文粘连截半。测试新增 8 用例并完成红灯验证。
- Files（改动文件）: src/components/chat/panel-decoration/local-file-path-links.ts、tests/frontend/local-file-path-links.test.ts、docs/wiki/src/components/README.md（两份副本）、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest local-file-path-links 17 passed；decorator-copy-i18n + message-actions 连带 69 passed；eslint 改动文件通过；tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机发一条「已修改 D:\quickforge\src\index.css后面还有文字」类消息，确认链接只覆盖路径、正文完整显示；含中文目录的路径（D:\文档\说明.md）仍可点击。

---

## 当前交接：background-command-idle-keepalive（done，2026-09-29）

- Current Objective（当前目标）: 后台命令不再因会话空闲 10 分钟回收被连带终止。已实现，未提交。
- 根因: `resetIdleTimer` 到点 `destroyAgent` → `stopBackgroundCommandTasksForSession` 杀掉该会话全部运行中后台命令；SSE keep-alive 故意不重置计时器、后台命令运行中不保活。
- 改动内容: `server/agent-manager.mjs` `resetIdleTimer` 回调新增豁免——仍有运行中后台命令（`listBackgroundCommandTasks` 非空）时只重置计时器（与 goal waiter 同型）；命令退出后经通知路径重置计时器再按常规回收。新增回归测试 `tests/server/agent-manager.background-idle.test.mjs`（含无后台命令对照组仍回收、显式销毁仍终止命令）。
- Files（改动文件）: server/agent-manager.mjs、tests/server/agent-manager.background-idle.test.mjs、docs/wiki/server/README.md、docs/wiki/server/tools/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest agent-manager.background-idle 2 passed；tests/server 全量 174 文件 passed；npx eslint 改动文件通过；npm run build 通过（chunk 警告既有）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条长后台命令（如 dev server）静置 15 分钟以上，确认进程仍在、退出时收到 task-notification；如需“用户停止 run 不杀后台命令”，再评估移除 detach 后的 run signal abort 监听（当前保持既有行为）。

---


## 当前交接：chat-h5-no-horizontal-scrollbar（done，2026-09-28）

- Current Objective（当前目标）: H5 聊天消息区不再出现底部横向滑动条，宽 KaTeX 公式块内横滑。已实现，未提交。
- 根因: 主滚动容器 overflow-y-auto 的另一轴按规范被计算为 auto；KaTeX 展示公式容器（裸 my-4 div）无溢出保护，宽公式撑破消息列。
- 改动内容: .qf-chat-panel > .qf-scroll-container 加 overflow-x:hidden（主滚动容器只管纵向）；KatexMath display 分支挂 quickforge-katex-scroll（unlayered：overflow-x auto + 隐藏滚动条 + touch 滑动）；chat-math 测试 3 处容器类名断言同步；css-contract 测试新增滚动契约用例。
- Files（改动文件）: src/index.css、src/components/chat/surface/KatexMath.tsx、tests/frontend/chat-surface-css-contract.test.ts、tests/frontend/chat-math.test.ts、docs/wiki/src/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 47 passed；npm run lint 通过（仅既有无关 warning）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机 H5 发一条宽公式（长积分/求和）与长表格消息，确认底部无横向滑动条、公式块可滑、纵向滚动正常。

---

## 当前交接：tool-summary-no-ellipsis（done，2026-09-28）

- Current Objective（当前目标）: 工具长摘要不再省略，超长可横滑，并完成 build。
- 改动内容: 去掉命令、生图、文件列表和子任务摘要的硬截断。工具行与子任务行改为完整文本横向滚动，H5 可触摸滑动。
- Files（改动文件）: src/lib/tool-param-summary.ts、src/lib/subagent-run-detail.ts、工具渲染器、src/index.css、相关测试、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 213 passed；npm run build 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看长命令、长搜索、长生图提示词和子任务行，确认没有省略号且能滑到末尾。

---

## 当前交接：run-command-summary-no-ellipsis（done，2026-09-28）

- Current Objective（当前目标）: run_command 摘要不再出现省略号，长命令可横向滚完。已实现，未提交。
- 根因: 摘要硬截 72 字加 …，父级 overflow:hidden 继续裁切。
- 改动内容: 摘要输出完整命令。超长时整行横向滚动，H5 可触摸滑动，滚动条隐藏。
- Files（改动文件）: src/lib/tool-renderers/local-workspace-tool-renderer.tsx、src/index.css、tests/frontend/chat-surface-css-contract.test.ts、tests/frontend/local-tool-running-sweep.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：chat-surface-css-contract + local-tool-running-sweep 42 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看一条超长 run_command，确认没有省略号，可横滑到命令末尾。

---

## 当前交接：edit-diff-long-line-scroll（done，2026-09-28）

- Current Objective（当前目标）: edit_file 长行在 diff 内滚动，不撑开对话，H5 可滑。已实现，未提交。
- 改动内容: diff 块限制在列宽内。长行横向滚动且增删背景铺满整行，行号列保持可见。H5 使用 touch 横滑和纵滑。
- Files（改动文件）: src/index.css、tests/frontend/diff-view.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：diff-view + chat-surface-css-contract 60 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机展开一条长 edit_file，确认可横滑，行底色不中断，手机上也能滑。

---

## 当前交接：tool-command-console-scroll（done，2026-09-28）

- Current Objective（当前目标）: run_command 长命令可在工具卡内滚动，且未溢出的文字不再被遮成空白。已实现，未提交。
- 根因: 控制台左右渐隐始终生效，短行两端也被虚化。
- 改动内容: 溢出侧改内阴影，不用 mask。H5 可触摸横滑和纵滑。未超出不提示；滚到中间两侧提示；滚到末尾只提示左侧。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/index.css、tests/frontend/tool-renderer-shared-state.test.ts、tests/frontend/chat-surface-css-contract.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：52 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机展开一条长 run_command，确认可横向滚动，短行和滚到尽头的一侧不再空白。

---

## 当前交接：subagent-title-command-gap（done，2026-09-28）

- Current Objective（当前目标）: 子任务输出很长时，标题和后面的命令显示中间不再空出一段。已实现，未提交。
- 根因: 标题和命令跑马灯都是 flex:1，剩余宽度被平分。
- 改动内容: 标题按内容收缩，长标题才省略；命令继续占用剩余空间。
- Files（改动文件）: src/index.css、tests/frontend/chat-surface-css-contract.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：chat-surface-css-contract 36 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看一条长输出的子任务，确认标题紧挨后面的命令，过长时标题省略而不是中间留白。

---

## 当前交接：composer-console-fixed-width（done，2026-09-24）

- Current Objective（当前目标）: 输入框旁控制台弹出面板不再被长命令撑宽。已实现，未提交。
- 改动内容: 后台命令菜单固定宽度。长命令在条目内横向滚动，左右高斯模糊渐隐。
- Files（改动文件）: src/index.css、tests/frontend/subagent-running-indicator.test.ts、design-mockups/command-console-fixed-width.html、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机点输入框旁终端图标，确认面板宽度不变，长命令可横向滚动并看到左右模糊。

---

## 当前交接：background-command-presence（done，2026-09-24）

- Current Objective（当前目标）: 后台命令在对话和 Composer 运行摘要中可见，并可从摘要关闭。已实现并验证，未提交。
- 改动内容: 运行中的后台命令独立显示；摘要计数和列表包含它，列表项调用 abort-tool 关闭。退出后工具结果改为终态，摘要同步移除。
- Files（改动文件）: server/tools/index.mjs、server/agent-manager.mjs、server/agent-session-queries.mjs、src/lib/server-agent.ts、src/lib/server-agent-types.ts、src/lib/shared-server-agent.ts、src/lib/i18n.ts、src/index.css、src/components/chat/ChatPanelHost.tsx、src/components/chat/panel-decoration.ts、process-folding.ts、subagent-running-indicator.ts、ChatSurface.tsx、local-workspace-tool-renderer.tsx、相关测试、docs/wiki、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认后台命令在回合结束后仍单独显示，摘要可关闭并随退出消失。

---

## 当前交接：run-command-background（done，2026-09-24）

- Current Objective（当前目标）: `run_command` 支持后台分离执行。已实现并验证，未提交。
- 改动内容: `run_in_background: true` 立即返回输出文件和 taskId；进程跨回合运行，stdout/stderr 持续写入命令日志；退出后向原会话发 `<task-notification>`。流式中走 followUp，空闲时开下一轮，活跃 Goal 暂存。销毁会话会终止其后台命令。
- Files（改动文件）: server/tools/definitions.mjs、server/tools/index.mjs、server/tool-wiring.mjs、server/agent-manager.mjs、server/system-prompt.mjs、src/lib/tool-renderers/shared.tsx、src/components/chat/surface/ToolMessage.tsx、tests/server/tools/run-command-background.test.mjs、tests/server/tools/definitions.test.mjs、tests/server/system-prompt.test.mjs、docs/wiki/server/tools/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条长命令，确认当前回合可继续使用其他工具，并在进程退出后收到通知。

---

## 当前交接：thinking-before-tool-order（done，2026-09-24）

- Current Objective（当前目标）: 第一轮思考过程保持在后续工具调用之前。已补上组前插入与跨 assistant 两条路径，未提交。
- 根因: 折走时的 `sourceNextSibling` 在工具行插到它前面后仍然有效，还原会把思考放到工具后面。
- 改动内容: 锚点前移到新插入节点之前；全量重建按来源 content 序号排回源序。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认第一轮「思考 → 工具」不再颠倒。

---

## 当前交接：android-cloud-removal（done，2026-09-24）

- Current Objective（当前目标）: 移除安卓端云服务原生功能和页面残留。已完成并提交。
- 改动内容: 删除 RemoteTunnel 插件、云账户存储、云 API、WebRTC 隧道服务及测试；Manifest、Gradle、Capacitor 白名单和架构文档同步。保留 Tailscale/局域网直连与通知服务。
- Files（改动文件）: android/app/src/main/java/com/quickforge/mobile/remote/、android/app/src/test/java/com/quickforge/mobile/remote/、MainActivity.java、AndroidManifest.xml、android/app/build.gradle、capacitor.config.ts、docs/architecture/android-remote-client.zh-CN.md、docs/wiki/src/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 未执行 Android Gradle 构建。旧 APK 前端资源仍在 `android/app/src/main/assets/public/`。
- Next Session（下一步）: 需要新 APK 时运行 `npm run android:sync` 覆盖旧云页面资源。

---

## 当前交接：tool-file-underline-on-name（done，2026-09-23）

- Current Objective（当前目标）: 编写/写入文件的下划线只在悬停具体文件名时出现。已实现，未提交。
- 根因: 文件名 `group-hover:underline` 被整行 `group/tool` 触发。
- 改动内容: `renderToolFileSummary` 改为文件名自身 `hover:underline`，按钮去掉 `group`。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认悬停「已执行 / 编辑 / 写入」不再出下划线。

---

## 当前交接：inspector-tab-fade（done，2026-09-23）

- Current Objective（当前目标）: 右侧工作栏多个 Tab 时变短、无中间分隔线，标题右侧渐隐替代省略号。已实现，未提交。
- 改动内容: 多 Tab 在 `min-w-24` / `max-w-32` 之间均分，放不下横向滚动；去掉竖线，标题在关闭按钮左侧正常流里渐隐，文字不覆盖 X。下拉列表选中项与 hover 同为淡背景。
- Files（改动文件）: src/components/workspace/WorkspaceInspector.tsx、src/index.css、tests/frontend/workspace-inspector-tab-fade.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看多 Tab 渐隐是否够柔和；其余未提交改动仍待按需发版。

---

## 当前交接：thinking-before-tool-order（done，2026-09-23）

- Current Objective（当前目标）: 第一轮思考过程保持在后续工具调用之前。已实现并验证，未提交。
- 根因: 思考块先折叠时还原锚点为 null，同一容器后追加的工具行在全量重建时被 append 到思考前面。
- 改动内容: `restoreGroupedProcessNode` 在锚点失效时插回过程组之前。新增同容器顺序回归；wiki 两份所有权租约已同步。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 5 文件 86 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认第一轮「思考 → 工具」顺序不再颠倒；其余未提交改动仍待按需发版。

---

## 当前交接：thinking-hint-hide-when-thinking-ends（done，2026-09-23）

- Current Objective（当前目标）: 思考过程完成后，右侧尾行提示不再显示。已实现并验证，未提交。
- 根因: 右侧提示跟整条消息的 `isStreaming`，思考段结束后正文/工具仍在流式时提示不收。
- 改动内容: `process-folding.ts` 改为只显示仍是 content 末块、无 `thinkingSignature`、且消息仍在流式的思考段；结束后立即淡出。CSS 注释与 wiki 两份契约同步。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、src/index.css、tests/frontend/thinking-hint.test.ts、tests/frontend/thinking-streaming-stage.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 28 passed + 连带折叠/接管 74 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认思考写完、正文开始后右侧提示淡出；其余未提交改动仍待按需发版。

---

## 当前交接：stage-collapsed-no-round-flip（done，2026-09-23）

- Current Objective（当前目标）: 修复用户反馈「关闭『工具调用列表默认展开』后，新的一轮消息来了仍会展开又收缩反复」。经确认按方案 A 实现：设置关闭时内层 stage 全程收起、不自动展开；正在流式的思考行（含尾行提示）改挂顶层组 body 显示，本轮结束后随重建收进 stage。已实现并验证（feature_list.json 标 done），改动未提交。
- 根因: `updateProcessStageGroups` 的 stage 默认值原为 `processStageDefaultExpanded() || processStageHasStreamingThinking(stageBody)`（含流式思考就强制展开）；而每轮工具调用结束的组全量重建让新 stage 元素回落设置默认（收起），下一轮流式思考再顶开 → 第 2 轮起逐轮开合往复。
- 改动内容:
  1. `src/components/chat/panel-decoration/process-folding.ts`：新增 `processThinkingAssistant` / `isStreamingThinkingItem` / 导出 `splitStreamingThinkingRuns`（按位置切 run：liveThinking 挂组 body、其余包 stage，顺序不变）；`populateProcessGroup` 仅在设置关闭时切分；`updateProcessStageGroups` 默认值回归 `processStageDefaultExpanded()`，删除 `processStageHasStreamingThinking` 与强制展开。
  2. 测试：thinking-streaming-stage 的 S2 / 流式结束回填 / 跨 assistant / 手动收起用例按新语义重写，新增多轮工具循环往复回归；process-folding 新增切分函数单测。
  3. 文档：`docs/wiki/src/components/README.md`（两份副本）+ `docs/wiki/src/lib/README.md` 的折叠默认值契约同步为 `isStreamingThinkingItem` / `splitStreamingThinkingRuns`。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/thinking-streaming-stage.test.ts、tests/frontend/process-folding.test.ts、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 3 文件 61 passed + 连带 6 文件 104 passed + tests/frontend 全量 210 文件 2674 passed；`npx eslint`（改动文件）/ `npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 382 文件 4561 passed / 1 skipped（无失败）。
- Blockers（阻塞）: 无。
- Notes:
  - 设置默认展开（默认 true）时结构与行为零变化；切分只在「关闭设置」时启用。
  - 观感取舍（用户已确认）：本轮思考结束后该思考行随重建收进已收起的 stage（即该行消失），换取不再有自动开合动画。
  - 工作区同时存在并行会话 `thinking-hint-growth-inplace` 的改动（同文件不同函数）与 `streaming-display-stability` 的未提交改动；本轮未提交 Git；未触碰生成产物。
  - `settings-row-infotip` 仍为 pending。
- Next Session（下一步）: 真机跑一轮多轮工具循环（关闭「工具调用列表默认展开」）确认不再逐轮开合、流式思考行与尾行提示可见、本轮结束收进 stage；确认后可与其它未提交改动一起按 runbook 发小版本。

---

## thinking-hint-growth-inplace（done，2026-09-23）

- Current Objective（当前目标）: 修复用户反馈「对话中思考过程中的右侧显示会一句话重复显示两次」——思考行右侧尾行提示（hint）在「同一行内增长」时被反复整行滚入，两个视图同显同一句。按用户确认的方案 A 完成：只在行切换时滚入，同一行内增长就地更新。已实现并验证（feature_list.json 标 done），改动未提交。
- 根因:
  1. hint 是 header 第四槽位的 `quickforge-tool-marquee`；`ToolMarqueeController` 对任何 text 变化都 `beginRoll`（旧文上滚出 + 新文下滚入，滚入期间两视图同时可见），而 `syncProcessThinkingHint` 在流式「同一行内增长」时也会每 ~300ms 写一次 `text` → 260ms 滚入被反复触发、两视图长期同显同一句（只差几个字）。
  2. 复现证据：直接驱动 `ToolMarqueeController` 跑序列，grow 帧 `v0[VIS/s=句子A] v1[VIS/s=句子A-grow]` 双视图 VISIBLE。
- 改动内容:
  1. `src/lib/tool-marquee.ts`：`sync(text, running, restart = false, roll = true)`——`roll=false` 时 text 变化走就地更新（`applyInstant`），不再整行滚入；默认 true 保持 subagent 摘要卡行为。
  2. `src/lib/tool-renderers/shared.tsx`：`QuickForgeToolMarquee` 增 observedAttributes `roll`，回调只记录意图（`rollOnChange`，connectedCallback 复位），`sync()` 一次性消费并透传；`scheduleRestart` 统一 `sync(true)`。
  3. `src/components/chat/panel-decoration/process-folding.ts`：textChanged 分支先写 `roll`（`lineSwitched ? 'true' : 'false'`）再写 `text`（标记必须每次随 text 写，元素消费后复位）。
  4. 文档：`DESIGN_LANGUAGE.md`、`docs/wiki/src/components/README.md`（接管契约两份副本）、`docs/wiki/src/lib/README.md`（tool-marquee.ts 条目）。
  5. 测试：`tool-marquee.test.ts` +2、`thinking-hint.test.ts` +1、新增 `tests/frontend/thinking-hint-marquee-inplace.test.ts`（jsdom 全链路：真 React ThinkingBlock → 装饰层 → 真 `quickforge-tool-marquee` 元素 → ToolMarqueeController，桩 `Element.prototype.animate` 观察滚入）。
- Files（改动文件）: src/lib/tool-marquee.ts、src/lib/tool-renderers/shared.tsx、src/components/chat/panel-decoration/process-folding.ts、tests/frontend/tool-marquee.test.ts、tests/frontend/thinking-hint.test.ts、tests/frontend/thinking-hint-marquee-inplace.test.ts、DESIGN_LANGUAGE.md、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest tool-marquee 17 passed（+2 新例）、thinking-hint 16 passed（+1 新例）、新 jsdom 全链路 1 passed、思考/折叠/跑马灯/接管相关 7 文件 133 passed；**旧实现红灯验证**（临时把 roll 恒写 `'true'`）新用例在症状级断言失败 `expected 0 to have length 2`（同行增长仍触发两次整行滚入）+ thinking-hint 新用例同时失败，改回后全绿；`npx tsc --noEmit` 通过；`npx eslint`（src + 新测试）通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 383 文件 4562 passed / 1 skipped（无失败）。
- Blockers（阻塞）: 无。
- Notes:
  - 前一次全量中失败的 `tests/server/session-state-repository.test.mjs`（multi-process CAS writer 时序用例）在最新全量中通过，确认为并发负载下 flaky，与本改动无关。
  - 未动：取段规则 / 500 码点截断 / 300ms 节流 / 淡入淡出 / 行切换滚入 / release gate / 思考头接管契约；subagent 摘要卡跑马灯默认行为不变（roll 缺省 true）。
  - 无依赖变更；未触碰 dist/package-dist/package-offline；未提交 Git。
  - settings-row-infotip 仍 pending（WIP 不在本轮）；上一轮 streaming-display-stability 的改动仍在工作区未提交。
- Next Session（下一步）: 真机跑一轮带思考的流式对话验证观感（重点：右tail提示不再同一句上下两份、行切换仍有滚入、长行溢出滚动仍在增长停止后恢复）；确认后可考虑与 streaming-display-stability 一起按 runbook 发小版本；处理 pending 的 settings-row-infotip、session-state-repository flaky 用例。
