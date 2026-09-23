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
