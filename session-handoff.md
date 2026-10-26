# 当前交接：frontend-god-components-split-round-3（done，2026-10-26）

- Current Objective（当前目标）：按前端只读评审的 P0–P6 建议完成行为保真整改，不影响功能与产品体验。
- 结论（一句话）：P0 可访问性/alert 修复；P1 ChatPanelHost 2270 → 1750 行；P2 ScheduledTasksPage 1270 → 532；P3 WorkspaceInspector 2003 → 544（独立 feature）；P4 GitToolsPinnedSummary 1124 → 253；P5 App 2028 → 1970（置顶摘要 view-model）；P6 ServerAgent 抽取 SessionLeaseController + GoalStateController。全量 429/429 测试文件通过。
- 改动文件：`src/components/chat/panel-wiring/`（5 个 setup 模块）、`src/components/scheduled-tasks/`（state/data/form/types/sections）、`src/components/workspace/`（useWorkspaceTree/useWorkspaceReader + 6 个展示组件 + 2 个工具）、`src/components/git/`（layout/DesktopWidget/Sections/Capsule）、`src/hooks/usePinnedSummaryModel.ts`、`src/lib/session-lease-controller.ts`、`src/lib/goal-state-controller.ts`、`src/lib/server-agent.ts`、`src/App.tsx`、`src/components/workspace/useInspectorLayout.ts`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/MessageEditor.tsx`、`src/lib/i18n.ts`、`src/styles/settings/controls.css`；对应测试与 docs/wiki 已同步。
- Evidence（验证）：`npm run test` → 429 files / 4984 passed / 2 skipped；`npm run lint` → 0 error（仅既有 `usePinnedSummaryCapsule` exhaustive-deps warning）；`npm run build` → 成功（仅既有 chunk 体积警告）；`npx tsc -b` → 通过。定向覆盖：ScheduledTasksPage 50、PinnedSummary 71、Workspace 88、ChatPanelHost 314/315（唯一失败为已同步的旧 console shadow 断言）、ServerAgent/Goal/Lease 187、file-rollback-api 14。
- Blockers（阻塞）：无构建/测试阻塞。P6 仅完成租约与 Goal 两个协作者，SSE/消息缓存/审批仍在 `ServerAgent`；P1 主 effect 仍有 838 行，`decorate()` 本体/agent 事件扇出/scroll sync 因 DOM 契约留在 host。未做真实窗口目视冒烟。
- Next Session（下一步）：① 如需继续 P6，可抽 SSE transport / 消息缓存 / 审批协作者；② 如需继续 P1，可把 decorate 本体按过程折叠/产物卡/滚动分块，但需先补 characterization tests；③ 真机冒烟：任务行键盘、Inspector 键盘调宽、Tab 键盘排序/关闭、聊天气泡与过程折叠、Pinned summary 拖拽/挂起、Goal 预算/编辑、定时任务列表/历史。未创建 Git commit，未手工修改生成产物。

---

# 当前交接：workspace-inspector-module-split（done，2026-10-26）

- Current Objective（当前目标）：行为保真拆分 `WorkspaceInspector.tsx`（2003 行），不改变 UI/DOM/class/aria、tab 持久化、请求 scope guard、i18n 与测试期望。
- 结论（一句话）：入口缩到 544 行，职责拆为 `useWorkspaceTree.ts` / `useWorkspaceReader.ts` + `WorkspaceTabStrip` / `WorkspaceInspectorHeader` / `WorkspacePanelLanding` / `WorkspaceTreePanel` / `WorkspaceReviewPanel` / `WorkspaceReaderPanel` + `workspace-panel-tabs.ts` / `workspace-path-utils.ts`；元素/handler/aria/className 计数与原文件逐项相等。
- 改动文件：上述 10 个新模块 + `WorkspaceInspector.tsx`、7 个源码契约测试（断言指向迁移后文件，语义不变）、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）：定向 vitest 76 passed（workspace-inspector-* + inspector-layout/git-hooks + workspace-diff-*）；workspace/goal 相关 33 文件 461 passed；全量 vitest 426/429（3 个失败均为既有 WIP：tool-output.css 阴影删除、server-agent.ts rollback、scheduled-tasks 并发 flake 单跑通过）；`npx eslint .` 0 error（仅既有 warning）；`npx tsc -b` 无新增错误。
- Blockers（阻塞）：工作区既有 WIP 导致 `npm run build`（tsc -b）仍失败于 ChatPanelHost/composer-input，与本次拆分无关；`chat-surface-css-contract` / `file-rollback-api` 需等对应 WIP 收尾；未在真实窗口目视冒烟（无可见浏览器），靠源码契约测试 + DOM 计数对齐兜底。
- Next Session（下一步）：① WIP 收尾后跑 `npm run test` / `npm run lint` / `npm run build` 全绿；② 真实窗口冒烟：打开/关闭 tab、拖拽排序（含键盘）、下拉列表滚动、Files 搜索/刷新/展开、Review diff 空态、reader 刷新、命令日志 tab、全屏切换；③ 如需继续拆分可把 `WorkspaceOverview`/`InlineReader` 再拆为独立叶子文件。未创建 Git commit，未触碰生成产物。

---

# 当前交接：console-scroll-shadow-remove（done，2026-10-26）

- Current Objective（当前目标）：用户反馈「运行命令的 tools 详情」右侧出现阴影，确认来源后选择「直接去掉左右两侧阴影」。
- 结论（一句话）：右侧阴影不是卡片投影，而是 `.qf-console-scroll` 的横向溢出内阴影（`data-overflow-end`），且因垂直滚动条占宽被误判为常亮；已删除该提示的三条 `box-shadow` 规则。
- 改动文件：`src/styles/chat/tool-output.css`（删除 `[data-overflow-start|end=true]` 与叠加规则，注释同步）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）：`npx vitest run tests/frontend/tool-renderer-shared-state.test.ts` 21 passed；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）。
- Blockers（阻塞）：未在用户正在使用的实例里目视复验（单实例 guard）；改动为纯 CSS 删除，风险低。
- Next Session（下一步）：如需恢复横向溢出提示，改用淡出遮罩或文本提示而不是两侧内阴影；`syncConsoleScrollFades` 与 data 属性保留未删，恢复时只加 CSS 即可。未创建 Git commit，未触碰生成产物。

---

# 当前交接：project-create-in-workspace（done，2026-10-26）

- Current Objective（当前目标）：用户要求项目选择器里「选择项目目录」下面增加「创建项目」，并直接在 workspace 下创建；先看 HTML 交互原型，确认后落地实现。
- 结论（一句话）：`NewChatProjectPicker` 菜单新增「新建项目」动作行，就地切到新建面板（只填名称 + 路径预览），`POST /api/project/create` 在默认 workspace 下建目录并注册激活；「选择项目目录…」保持只选已存在目录。
- 改动文件：`server/project-config.mjs`（`validateProjectFolderName` / `createProjectInDefaultWorkspace`）、`server/routes/project.mjs`（`POST /api/project/create`）、`src/hooks/useProject.ts`（`createProjectInWorkspace`）、`src/components/chat/NewChatProjectPicker.tsx`（list/create 双视图 + 校验 + Enter/Esc）、`src/App.tsx`（接线 + workspacePath）、`src/lib/i18n.ts`（中英各 14 key）、`src/styles/chat/empty-state.css`（`.quickforge-project-create-*`）、`tests/server/routes/project-create.test.mjs`、`tests/frontend/new-chat-project-picker-create.test.ts`、`docs/design/project-create-in-workspace.html`、`docs/wiki/{src/components,src/hooks,src/styles,server,server/routes}/README.md`、`feature_list.json`、`progress.md`。
- Evidence（验证）：定向 vitest 5 文件 36 passed；`npm run test` 全量 428 文件 / 4976 passed / 2 skipped（首轮出现 `scheduled-tasks.commands` 2 例并发 flake，单独重跑 24/24、全量重跑全绿）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（6.88s）。
- Blockers（阻塞）：未在用户正在使用的实例里目视验收新建面板（单实例 guard + 无可见浏览器）；布局/动效由 static markup、CSS 契约测试与独立原型页兜底。
- Next Session（下一步）：① 在真实窗口打开新对话 → 点项目胶囊 → 「新建项目」，确认焦点自动落在名称框、Enter 提交后侧栏出现并高亮新项目；② 若希望远程/局域网客户端也能建项目，现在是允许的（`/api/project/create` 未加入本地限制名单），如要收紧需改 `assertLocalExternalAction` 名单并同步测试；③ 目视确认路径预览在长 workspace 路径下的截断表现。未创建 Git commit，未触碰生成产物。

---

# 当前交接：sidebar-timeline-runtime-status（done，2026-10-26）

- Current Objective（当前目标）：侧栏视图切到「时间线」后运行中状态消失；用户要求与普通项目视图保持一致。
- 结论（一句话）：`SidebarSessionRow` 删除 timeline 变体对 `timeText` 的短路，四个变体统一走 `sessionTimeSlotContent`；运行中显示 Loader2、完成未读显示 emerald 点，均替换时间文本，固定 `w-11` 槽和 hover 几何不变。
- 改动文件：`src/components/sidebar/chat-sidebar/SidebarSessionRow.tsx`（删除 timeline 特判 + 更新注释）、`tests/frontend/sidebar-session-action-alignment.test.ts`（四变体共用状态槽断言）、`docs/wiki/src/components/README.md`（两处 ChatSidebar 说明）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 性能分析：每可见行仅多一次 O(1) `sessionTaskStatus()` 与 `Set.has()`，本机 V8 微基准约 21ns/行；状态仅在 `agent_start` / `agent_end` / visibilitychange 更新，无新增 state/effect/订阅，不引入逐 token 重渲染；spinner 仅运行行渲染，合成层动画，与项目/全局视图一致。
- Evidence（验证）：定向 vitest 5 文件 46 passed；`npx tsc -b` 通过；`npx eslint` 改动源/测试文件通过。
- Blockers（阻塞）：未做用户正在使用的 5176 实例内目视验收；jsdom 不可用，源码契约测试覆盖渲染口径。全量 `npm run build` / `npm run lint` 当前被工作区既有 WIP（`NewChatProjectPicker.tsx` / `i18n.ts` / `project-config.mjs` 的新建 workspace 项目功能）阻塞（TS6133、no-control-regex），与本改动无关；改动文件定向 eslint 与 `tsc -b --force`（仅报该 WIP 错误）已确认。
- Next Session（下一步）：在已有 QuickForge 窗口切到「时间线」视图，确认运行中会话行尾出现 spinner、结束后未读绿点替换时间；未创建 Git commit，未触碰生成产物。

---

# 当前交接：composer-model-trigger-thinking-label（done，2026-10-26）

- Current Objective（当前目标）：用户要求「对话框显示模型那里显示模型 + 思考等级，思考等级更浅色一点，其他的不变，只是改显示」。
- 结论（一句话）：模型触发按钮文案从「模型 ID」扩成「模型 ID · 思考等级」，等级比模型名浅一档；纯展示改动，交互 / 持久化 / 服务端契约全不动。
- 改动文件：
  - `src/components/chat/surface/MessageEditor.tsx`（新增可选 `thinkingLevel` prop + `.quickforge-model-trigger-thinking` 后缀渲染 + 非推理模型门控）。
  - `src/components/chat/surface/ChatSurface.tsx`（`thinkingLevel={snapshot.thinkingLevel}`）。
  - `src/lib/thinking-levels.ts`（新增 `toThinkingLevel()`：`minimal`→`low`、非法→`off`）、`src/lib/thinking-slider.ts`（`toSliderLevel()` 委托给它，去掉重复映射）。
  - `src/styles/chat/composer-controls.css`（`.quickforge-model-trigger-thinking` 72% muted-foreground，hover/展开态转 62% foreground）。
  - 测试：`composer-model-trigger.test.ts` +11、`composer-control-hover.test.ts` +2（含该文件 `ruleFor` 补注释剥离）。
- 关键实现约束：等级必须是 `.ml-1` span 的**子节点**——紧凑态与移动端只把 `.quickforge-model-trigger > span.ml-1` sr-only 化，兄弟节点会在 2rem 图标形态下继续显示并撑破按钮。
- Evidence（验证）：`npx tsc -b --force` 通过；定向 6 文件 59 passed（model-trigger 16 / hover 6 / compact 10 / css-architecture 5 / thinking-slider 16 / selector-sync 6）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（7.62s）。
- Blockers（阻塞）：**未做目视验收**。CDP 探针脚本本身没跑通（`createRoot` 从 vite 预打包 deps 路径取不到），所以只有 jsdom 渲染断言 + CSS 契约测试兜底。浅色档位的实际观感、深色模式对比度、长模型名加后缀是否挤压右侧控件组，都需要人工确认。
- Next Session（下一步）：① 目视看 `72%` 这个值是否合适（偏浅可调到 78%，偏深调到 66%）；② 共享会话页与 Side Chat 复用同一按钮，Side Chat 为 disabled 但等级仍显示——若要隐藏需再加门控；③ `docs/wiki/src/components/README.md:181` 与 `docs/architecture/session-open-fast-path.zh-CN.md:558` 的「模型按钮为纯文字」口径已与本次相反，需同步。未创建 Git commit，未触碰生成产物。

---

# 当前交接：workflow-detail-script-expanded（done，2026-10-26）

- Current Objective（当前目标）：workflow 详情里的脚本 sheet 默认展开。
- 结论（一句话）：`sheet` 初始值按 `payload.script` 推导，有脚本即默认 `'script'`；底部脚本/结果按钮带 `aria-expanded` + `aria-controls`，脚本 sheet 默认可见、可手动收起；结果 sheet 仍默认收起。
- 改动文件：`src/components/workspace/WorkflowRunDetailContent.tsx`（初始化 + toggleSheet + aria/sheet id）、`src/styles/workspace/workflow-detail.css`（active foot button）、`tests/frontend/workflow-renderer.test.ts`、`tests/frontend/workflow-step-interaction.test.ts`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`、`docs/design/workflow-detail-redesign.html`。
- Evidence（验证）：定向 vitest 2 文件 51/51；`npm run test` 全量 426 文件 / 4938 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（5.76s）。
- Blockers（阻塞）：无技术阻塞。未在用户正在使用的 5176 实例内目视截图（单实例 guard / in-app Browser 不可见）；脚本默认展开由 static markup + jsdom 测试覆盖。
- Next Session（下一步）：如需让“脚本晚到”也自动展开，不能再用 effect setState（`react-hooks/set-state-in-effect` 已拦），可在打开 Tab 的 payload 构建层保证 script 先到位，或改成派生的 controlling state；当前详情 Tab 打开时 payload 已带脚本，默认展开已生效。未创建 Git commit，未触碰生成产物。

---

# 当前交接：workflow-detail-no-timeline（done，2026-10-26）

- Current Objective（当前目标）：按用户反馈移除工作流详情右侧时间轴；Agent 行只保留点击打开对应子 Agent 运行详情，不显示 subagent 详细运行过程。
- 结论（一句话）：详情已改成「概览 + 吸顶阶段头 + 轻量 Agent 入口 + ToolMessage 工具行 + 折叠日志」，时间轴全部移除；Agent 行仍经原 store / `OPEN_SUBAGENT_RUN_EVENT` 打开子 Agent 详情，但不再渲染当前工具跑马灯。
- 改动文件：
  - `src/components/workspace/WorkflowRunDetailContent.tsx`（无时间轴、Agent 轻量入口、日志 disclosure、概览失败入口、foot 条件渲染）。
  - `src/styles/workspace/workflow-detail.css`（删除 `--wf-tl-*` 与全部 bar/track/axis/legend/now/grid/parallel-group；新增 Agent 行 / 日志 / 失败入口 / foot；连接线 x = padding + 7px）。
  - `src/lib/i18n.ts`（`workflowDetailFailedStepsOne/Many`、`workflowDetailLocate`、`workflowDetailPending`）。
  - `tests/frontend/workflow-renderer.test.ts`、`tests/frontend/workflow-step-interaction.test.ts`（详情结构 / 样式 / Agent 点击 / queued 禁用 / 无跑马灯）。
  - 文档：`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`、`docs/design/workflow-detail-redesign.html`。
- Evidence（验证）：定向 vitest 2 文件 48/48；`npm run test` 全量 426 文件 / 4935 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功。独立 Vite harness 真实组件 + 全量 CSS：420px 面板无横向溢出，Agent 图标中心与工具连接线同 x=283，工具卡内容起点 291，阶段头 sticky top 0，失败入口 / 日志默认策略 / 底部按钮正常。
- Blockers（阻塞）：无技术阻塞。**未做用户正在使用的 5176 实例里的真机 UI 点击验收**——QuickForge 单实例 guard 拦截了第二个窗口；已用独立 Vite harness 做 Chromium 布局测量，但 in-app Browser 不可见导致无法截图。若需要目视确认，请打开已有 QuickForge 窗口，进入任一含 `run_workflow` 的会话，点工作流卡打开详情。
- Next Session（下一步）：① 在已有 QuickForge 实例里目视确认 420/520px 下的阶段头吸顶、Agent 行外链提示、失败定位、日志折叠、底部脚本/结果；② 若产品确认「workflow 级 `tool()` 行」也要隐藏，只需从 `workflowPhaseSteps` 的 tools 分支删掉 `ToolStep` 渲染（Agent 行跳转链路不动）；③ 未创建 Git commit，未触碰生成产物。

---

# 当前交接：thinking-slider-first-frame-fix（done，2026-10-26）

- Current Objective（当前目标）：用户反馈「打开模型选择就显示思考等级是关了」，要求分析并优化。
- 结论（一句话）：**不是默认值问题，是滑杆首帧定位失败**。滑杆在 append 到弹层之前就渲染，`offsetHeight` 恒为 0；旧 `positionStack()` 拿不到行高直接 return，`translateY` 从未写入 → 五档常驻文字整列停在第一行 `thinkingOff`（「关」），而圆圈用百分比定位却在正确档位（所以「拖动一下就好了」）。修复为「根字号兜底行高 + 实测后无动画校正」，并顺手修掉两个相邻缺陷。
- 改动文件：
  - `src/lib/thinking-slider.ts`：`positionStack()` 用 `fallbackLineHeight()`（1.2rem × 根字号）兜底不再提前返回；新增 `syncStackToLayout()` 在 `ResizeObserver` 里按实测行高无动画重算；导出 `toSliderLevel()`（`minimal`→`low`、非法→`off`）；`levelIndex()` 越界兜底 0，`aria-valuetext` 用收敛后的档位。
  - `src/lib/custom-model-selector.ts`：`ModelSelectorHandle` 新增 `setThinkingDisabled`（桌面菜单 + 移动 sheet 两个 handle 都实现）。
  - `src/hooks/useModelActions.ts`：接住 selector handle，`onSelect` 里同步滑杆档位与可用性；初始档位与同步都走 `toSliderLevel`。
  - 测试：`tests/frontend/thinking-slider.test.ts` +6 例；新增 `tests/frontend/model-selector-thinking-sync.test.ts` 6 例。
  - 文档：`docs/wiki/src/lib/README.md` 两处目录行 + 接线说明。
- 关键实现约束：**`syncStackToLayout()` 必须放在 `resizeFx()` / `hasLayout()` 之前**——`resizeFx()` 在无 canvas 实现时提前返回，`fxW` 恒为 0，把校正写在 `hasLayout()` 之后在 jsdom/无 canvas 环境下永远跑不到。
- 被避免的坑：① 只改 `renderValue` 兜底不够——字体加载/用户改字号会让真实行高偏离 1.2rem，必须实测后校正一次；② 上游 `ThinkingLevel` 含滑杆没有的 `minimal`，`as ThinkingSliderLevel` 强转在运行时是非法值（`indexOf(-1)` → `translateY` 正向偏移、`knob.left` NaN）；③ 弹层保持打开时切模型，状态已改但滑杆停在旧档（`setThinkingLevel` 原先全库无调用方）。
- Evidence（验证）：`npx tsc -b --force` 通过；定向 8 文件 **59 passed**；`npm run test` 全量 **426 文件 / 4932 passed / 2 skipped，exit 0**（首轮并发跑时 `scheduled-tasks.commands.test.mjs` 曾因 Windows EPERM 临时文件 rename 失败 1 例，单跑 24 passed、后台复跑全绿，属既有 flaky）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（3.66s）。
- Blockers（阻塞）：无技术阻塞。未做真机目视验收（重点看：打开弹层瞬间文字是否直接落在会话档位、拖动后文字与圆圈是否同档、切到非推理模型滑杆是否转灰）。
- Next Session（下一步）：① 真机目视验收上述三点；② `useModelActions` 的思考接线仍无单测（「仅推理模型传参」「切非推理模型强制 off 且不写 `active-thinking-level`」）；③ 服务端 `updateSessionThinkingLevel` 不校验档位合法性，建议补一层归一化；④ 未创建 Git commit，未触碰生成产物。

---

# 当前交接：model-selector-provider-menu（done，2026-10-26）

- Current Objective（当前目标）：用户提供参考截图，要求把输入框旁的模型选择改造成「服务商分组 + 选中勾选 + 能力标签 + 底部思考等级滑杆」。经 5 轮原型迭代后确认：自定义模型入口置顶、思考等级文字翻滚、拖动条只留圆圈、粒子只在滑块内且从右向左游动、档位越高粒子越多越快、底部不要档位文字与 Ctrl+T。最终按原型落地真实实现。
- 结论（一句话）：模型选择弹层重做为「顶部设置入口 + 按 `Model.provider` 分组的可滚列表 + 底部思考滑杆」三段式；思考等级从 composer 独立控件迁入弹层底部，实现为常驻整列翻滚文字 + 纯圆圈渐变轨道 + 圆角裁剪的 canvas 粒子拖尾。
- 改动文件：
  - 新增 `src/lib/thinking-slider.ts`（滑杆控件：翻滚数值、拖动、粒子）、`src/lib/thinking-levels.ts`（档位词表与标签，替代被删除的 `surface/ThinkingLevelControl.tsx`）。
  - `src/lib/custom-model-selector.ts`（分组 / 能力标签 / 顶部入口 / 滑杆挂载 / 宽度 260→336）。
  - `src/hooks/useModelActions.ts`（仅推理模型传 thinking 参数并持久化）。
  - `src/components/chat/surface/MessageEditor.tsx`、`ChatSurface.tsx`、`src/components/chat/ChatPanelHost.tsx`（移除 composer 内旧思考入口与相关 props 透传）。
  - `src/styles/chat/composer-controls.css`（三段式布局 + 分组/标签/滑杆样式，删废弃 thinking 选择器）、`compact.css`、`empty-state.css`（删思考按钮 icon-only 规则）。
  - `src/lib/i18n.ts`（新增 `modelVisionCapability`，en/zh 成对）。
  - 测试：新增 `tests/frontend/thinking-slider.test.ts`（10 例）；删除 `thinking-level-control.test.ts`；更新 `custom-model-selector` / `composer-control-hover` / `agent-access-menu` / `chat-compact-controls` / `chat-surface-editor`。
  - 文档：`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`progress.md`、`session-handoff.md`。
- 关键设计决策（都有代码事实支撑）：
  - 分组用 `Model.provider`（= `CustomProvider.name`），不加数据源；`quickforgeModelRef.source === 'custom'` 的组排最前。
  - 能力标签只做 `视觉`（`Model.input` 含 `image`），`reasoning` 已由滑杆表达，不重复。
  - **勾选槽仍在左侧**：`app-css` 契约锁定 `grid-template-columns: 1rem minmax(0, 1fr)` 与 `item.append(checkSlot, label)`。截图是勾选在右，改它要联动改 3 个测试文件，本轮选择不动契约、把能力标签放在模型名后。
  - 滑杆只在同时传 `thinkingLevel` + `onThinkingLevelChange` 时渲染；侧聊/共享页/表单场景不传，因此不显示（与侧聊控件 inert 的既有语义一致）。
- 被避免的坑：① **粒子在轨道外生成导致首帧销毁**（`x = fxW + 2..16` + 透明度按 `fxW - x` 判定为负 → 立即 `p.x = -10`），现象是「完全看不到流动」；改为内侧生成 + 按 `age/fadeIn` 淡入。② **同色粒子叠同色渐变不可见**；改为 70% 浅色粒子 + 少量品牌色。③ **翻滚数值重叠**（用户反馈）：双节点入场/退场在快速换档时定时器未跑完会叠；改为整列 `translateY`。④ **粒子溢出滑块**（用户反馈）：画布从 `inset: -0.85rem -0.6rem` 收回 `inset: 0` + `roundRect` 裁剪。
- Evidence（验证）：`npx tsc -b --force` 通过；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（3.77s）。定向：thinking-slider 10、custom-model-selector 8、契约组 34。
- Blockers（阻塞）：无技术阻塞。未做真机目视验收（粒子观感、深浅色对比度、移动端 sheet 手势与滑杆共存需要看一眼）。
- Next Session（下一步）：① 真机/浏览器目视验收——尤其滑动时粒子密度与流速是否符合预期、深色模式下的可读性、`prefers-reduced-motion` 表现；② 可择机清理 `.quickforge-model-sheet-footer` 样式（入口移到顶部后已无使用方，见 progress.md Notes）；③ 分组徽标目前是中性灰，若要按 provider 配色需先决定是否引入哈希色；④ 未创建 Git commit，未触碰生成产物。

---

# 当前交接：workflow-detail-chat-cards（done，2026-10-24）

- Current Objective（当前目标）：用户反馈「Workflow 详情里面的 tools 调用和 sub agent 调用，应该样式和最外层的保持一致要复用普通对话里面的信息」。
# 当前交接：workflow-detail-chat-cards（done，2026-10-24）

- Current Objective（当前目标）：用户反馈「Workflow 详情里面的 tools 调用和 sub agent 调用，应该样式和最外层的保持一致要复用普通对话里面的信息」。
- 结论（一句话）：详情步骤行整卡复用普通对话组件——工具行 = 聊天区同一颗 `ToolMessage`（args/resultPreview/quickforgeTiming 合成 toolCall/result），Agent 行 = `renderSubagentRunSummary`（run_subagent 摘要卡）；工作流只保留右侧时间轴轨道列（`--wf-tl-track` 固定宽 grid 列），自研行 UI（label 行 / Input-Output JSON 展开体 / agent-link 直达按钮）与 `onOpenAgentRun` 接线全部删除。
- 改动文件：`WorkflowRunDetailContent.tsx`（ToolStep/AgentStep 重写 + jumpToFailure 点嵌套卡 summary）、`WorkspaceInspector.tsx`（删接线）、`subagent-tool-renderer.tsx`（options 新增 `disabled`，queued Agent 复用）、`workflow-detail.css`（卡片+轨道 grid 几何、`--wf-tl-track`/`--wf-tl-track-plot`/`--wf-tl-plot-left/-right` 变量、删 10+ 自研行规则）、`i18n.ts`（删 5 孤儿键）、`tests/frontend/workflow-renderer.test.ts`（整卡复用契约 + 双基准回归）、wiki 三份 + 架构文档 7.3。
- 关键保真点：Agent 点击链路与原 `onOpenAgentRun` 等价（卡片自身 resolve store 最新快照 → `OPEN_SUBAGENT_RUN_EVENT`；`WorkflowAgentRunEventPublisher` 持续发布 `${workflowRunId}:agent:${agent.id}`）；queued 仍禁用（`disabled` 选项，canOpen 对 canonical runId 恒 true 表达不了）；运行中任务名流光保留；「定位失败步骤」改点嵌套卡 `details.querySelector('summary')` 并闪烁整条步骤行。
- 被避免的坑：① clamp 百分比双基准在 grid 列（行内容盒 W−1.75rem）与 absolute left（包含块 W）之间复发——380px 实测错位 7.7px，绝对定位层必须用 `--wf-tl-track-plot: clamp(8rem,(100%-1.75rem)*0.34,12.5rem)`（窄媒体 0.30），回归已写进测试；② harness 的 `<link>` 必须 http 引用（file:// 样式表在 http 页被拦，第一轮测的是无样式 DOM）；③ 聊天卡展开体透明，需 `details[open] > div` 补实底遮共享网格线。
- Evidence（验证）：定向 workflow-renderer **37 passed**；相邻 4 文件 **60 passed**；`tests/frontend` 全量 **251 文件 / 3009 passed**；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**；`npm run lint` 0 error（仅既有 warning）；`npx tsc -b` 通过；`npm run build` 成功。真实渲染：生产 CSS harness + Playwright 640/380px 六层对齐 ≤0.01px、条形不出界、卡片不侵入轨道、无溢出；卡片文案确认复用（「读取文件 · workflow-run-detail.ts」「运行命令 · 跑一遍测试」「扫描 src 目录 · explore」）。
- 已知工作区遗留（与本次无关）：`goal-*`、`ask-user-*`、上帝组件拆分等前序未提交改动原样保留。
- Blockers（阻塞）：无。
- Next Session（下一步）：① 真机目视验收——运行中详情（跑马灯/游标推进）、失败定位闪烁整行、MCP 工具卡、深色对比度、窄面板观感；② `workflowAgentDone/ToolCalls/Schema` 与 `workflowDetailTimelineHint` 为更早孤儿键（progress.md Notes，可另开一轮清理）；③ 未创建 Git commit，未触碰生成产物。

---

# 当前交接：frontend-god-components-split（done，2026-10-24）

- Current Objective（当前目标）：用户评审「前端是否存在上帝组件」后设定 goal「架构最优 最佳实现 你拆分一下模块，不影响功能和产品体验就可以直接执行」。三个 Tier-1 上帝组件已完成模块拆分，行为/样式逐字节保真。
- 结论（一句话）：ChatSidebar 2216→1165 行装配层 + `src/components/sidebar/chat-sidebar/` 14 模块（四分区重复行统一为 `SidebarSessionRow` 变体组件）；App.tsx 2431→2019 行（`useSidebarOrdering` / `useProjectExternalOpen` / `useDesktopTitlebarMenu` / `useAgentApprovalActions` / `useTurnFileRollback` / `useMobileSidebar` 六个状态域 hook + `src/components/app/` 下 ConversationHeader / DesktopTitlebarMenu / StartupScreens 三个区域组件）；ChatPanelHostProps 拆为五个分组子接口（类型级，运行时平铺结构不变）。被契约测试钉死的接线（两处 ChatSidebar 实例、GitToolsPinnedSummary 工具条、ChatPanelHost/WorkspaceInspector 传参）刻意留在 MainApp。
- 改动文件：`src/components/sidebar/ChatSidebar.tsx`（重写为装配层）+ `chat-sidebar/` 14 新文件；`src/App.tsx` + 6 个 `src/hooks/use*.ts` 新文件 + 3 个 `src/components/app/*.tsx` 新文件；`src/components/chat/ChatPanelHost.tsx`（仅类型分组）；测试新增 `tests/frontend/helpers/sidebar-module.ts`，重写/更新 `session-row-hit-area` / `sidebar-session-action-alignment` / `sidebar-section-order` / `sidebar-section-header-hit-area` / `sidebar-new-chat-routing` / `motion-design` / `conversation-trace-contract` / `git-tools-pinned-summary` / `assistant-artifact-card`；wiki 三份（src/hooks、src/components、src/README）。
- 关键保真点：`SidebarSessionRow` 的 variant 判别逐变体复刻原 DOM——pinned 保留 `div[role=button]`+键盘激活、timeline 时间槽**不**叠加运行/未读态（历史行为）、project 保留 `pl-8` 缩进；`useProjectExternalOpen` 端点为 `/open-in-vscode`、`/open-in-idea`；契约测试断言语义不放宽（motion-design 退场 token 计数改「项目行 2 + 行组件 2」双向锁定）。
- Evidence（验证）：侧栏定向 9 文件 **81/81**；`tests/frontend` 全量 **251 文件 / 3009 passed**；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**（与拆分前同基数）；`npm run lint` 0 error（仅既有 GitToolsPinnedSummary warning）；`npx tsc -b` 通过；`npm run build` 成功。
- Blockers（阻塞）：无。
- Next Session（下一步）：① 真机目视验收——侧栏四个分区的行 hover 操作组 / 删除确认淡出 / 拖拽排序 / 宽度拖拽、移动端抽屉 Escape 关闭、桌面标题栏菜单、会话头分支菜单与轨迹切换、轮次撤销弹窗；② 可选后续（progress.md Notes）：WorkspaceInspector / ScheduledTasksPage 拆分、`usePinnedSummaryData` 抽取、会话行两处历史不一致的统一；③ 未创建 Git commit，未触碰生成产物。

---

# 当前交接：subagent-indicator-task-line-removal（done，2026-10-24）

- Current Objective（当前目标）：用户反馈「不要显示任务 只保留详情入口」。定位为 Composer 左下角「运行中 subagent」指示器菜单——每项第二行平铺完整任务全文（`.quickforge-subagent-running-task`），而菜单项本身就是点击进运行详情的入口。
- 结论（一句话）：菜单项删掉任务全文行，只保留 label + 已运行时长的纯详情入口；任务文本保留在 aria-label（`subagentRunningIndicatorItemAria`）供读屏；点击行为不变（打开运行详情 Tab）。后台命令菜单项（同 class 显示命令文本）属另一功能，未动。
- 改动文件：`src/components/chat/panel-decoration/subagent-running-indicator.ts`（renderMenuItems 删 task span 创建与更新）、`tests/frontend/subagent-running-indicator.test.ts`（元素身份用例改为断言 task 行不存在 + aria 仍含任务）、`docs/wiki/src/components/README.md`（两处目录行）。`.quickforge-subagent-running-task` CSS 保留（后台命令项仍在用）。
- Evidence（验证）：定向 subagent-running-indicator **13 passed**；全量 `npm run test` **424 文件 / 4915 passed / 2 skipped**；`npm run lint` 0 error；`npx tsc -b` 通过。
- 注意（若用户其实指别处）：运行详情页（SubagentRunDetailContent）顶部的「任务：」块本轮**未动**——它是 run_subagent 直达运行的标配套头（含上下文/期望输出）；若用户指的是那里，需另开一轮移除或按 workflow 嵌套运行做门控。
- Blockers（阻塞）：无。
- Next Session（下一步）：真机确认菜单项只剩一行；未创建 Git commit，未触碰生成产物。

---

# 当前交接：workflow-detail-agent-direct-link（done，2026-10-24）

- Current Objective（当前目标）：用户验收 `workflow-detail-visual-optimize` 后反馈「不要绿色 icon 不要显示个发送消息 直接点击可以到 运行详情就好了」——指 Agent 行首的绿色机器人图标 + 展开后的任务/prompt 文本块 + 需要两步才能进运行详情。
- 结论（一句话）：Agent 行从「ToolDetails 展开 + 展开体里『运行详情 ↗』按钮」改为 `quickforge-workflow-detail-agent-link` **整行直达按钮**：点击即开该步运行详情（run_subagent 同款 Tab），删除行内展开体（AgentTaskBlock/input-clamp）、行首图标、`-agent-open`/`-step-actions` 样式与 `workflowDetailOpenAgentDetails` 键；queued/无句柄渲染禁用按钮；运行中标题流光保留；「定位失败步骤」闪烁选择器同时覆盖 summary（工具行）与直达按钮。
- 改动文件：`WorkflowRunDetailContent.tsx`（AgentStep 重写 + 删 AgentTaskBlock/imports）、`workflow-detail.css`（按钮 reset/hover/focus/disabled + 删 agent-open/step-actions + flash 双选择器 + reduced-motion 同步）、`i18n.ts`（中英删 `workflowDetailOpenAgentDetails`）、`workflow-renderer.test.ts`（新增 direct-link 用例、stateKey 只剩工具行、subagent-task 断言反转、flash 正则改双选择器）、wiki（components 两处重复段 ①⑤ bullet 重写 + 「运行详情 ↗」bullet 改直达 + 删重复 bullet、lib 一处、architecture 7.3 进入详情条目与 i18n 清单）。
- Evidence（验证）：定向 workflow-renderer（37）+ workflow-step-interaction（8）= **45 passed**；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**；`npm run lint` 0 error（仅既有 warning）；`npx tsc -b` 通过；`npm run build` 成功。
- 被避免的坑：① `ToolDetails` 开合记忆（stateKey）只剩工具行——Agent 行删除后测试里 `stateKey={...agent...}` 断言必须同步反转，否则改对了还被当回归；② flash 动画原先只挂 `> summary`，Agent 行没有 summary，闪烁会静默失效——选择器扩成 `summary, .agent-link` 双列表。
- 已知工作区遗留（与本次无关）：`goal-*`、`ask-user-*` 等前序未提交改动原样保留。
- Blockers（阻塞）：无。
- Next Session（下一步）：① 真机目视验收 Agent 行直达（含 queued 禁用态与错误态 title 提示）；② 若用户同样不想要工具行的绿色图标，可再做一轮（本轮仅按反馈改 Agent 行，工具行图标/展开保留）；③ 未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

# 当前交接：workflow-detail-visual-optimize（done，2026-10-23）

- Current Objective（当前目标）：用户要求「优化一下 workflow 的详情展示，先设计 html 给我看」→ 设计稿 `docs/design/workflow-detail-optimize.html` 评审后用户回复「按设计稿执行」，本轮完成全部实施与验证。
- 结论（一句话）：单页合并视图之上加八处读数效率层——①共享竖向网格（删逐行 5 条刻度线）②运行游标（轴 chip「现在 Xs」+ 同百分比竖线，elapsed=max(start+dur)）③阶段跨度条（`workflowPhaseSpan`，运行中钳制到 elapsed）④并行组 bracket + 组首一次「并行×N」（`parallelGroupSize`）⑤错误横幅「定位失败步骤」（展开阶段→summary.click 展开行→滚动居中→is-flash 1.6s）⑥日志 console 块 + >6 行折叠 ⑦展开体左 rail + 实底（z:2 遮线）⑧概览减负（图例并入第一行、派生统计行条件渲染、预算迁「脚本」sheet 头 `-sheet-meta`）；不改单页结构、时间轴几何、服务端 details 契约。
- 改动文件：`src/lib/workflow-run-detail.ts`（parallelGroupSize + workflowPhaseSpan）、`src/components/workspace/WorkflowRunDetailContent.tsx`（StepTrack/PhaseSection/外壳重写）、`src/styles/workspace/workflow-detail.css`（读数效率层全部规则 + 删行内 grid + 合并重复 legend/phase-index）、`src/lib/i18n.ts`（+7/−2 键中英）、`tests/frontend/workflow-renderer.test.ts`（+6 例 + CSS 契约整段 + i18n 清单）、wiki 三份 + 架构文档 7.3（i18n/样式段）。
- 关键坑（实施时已写入代码注释与 wiki）：① **clamp 百分比双基准**——`--wf-tl-label` 在 flex-basis 按行内容宽（W−1.75rem）、在 absolute left 按包含块（W）解析，300–500px 面板区间错位 6.8px；绝对定位层（网格/游标/跨度条/并行标注）必须用 `--wf-tl-label-plot: clamp(5.5rem,(100% - 1.75rem)*0.3,9.5rem)`（窄媒体 0.34）。② `ToolDetails` 是受控 details，展开走原生 `summary.click()` 让 onToggle 回写，直接改 open 属性会被盖回。③ 网格层 z:-1 会被一切实底遮住——展开体/日志块显式实底 + `position:relative; z-index:2`。
- Evidence（验证）：定向 workflow-renderer 36 + step-interaction 8 + css-architecture 5 = **49 passed**；全量 `npm run test` **424 文件 / 4914 passed / 2 skipped**（exit 0，label-plot 修复后复跑）；`npm run lint` 0 error；`npx tsc -b` 通过；`npm run build` 成功。真实渲染：生产 CSS harness + Playwright，640/460/380/320px 与 375px 视口（窄媒体）六层左缘对齐 <1.5px、游标重合、阶段耗时与行耗时右缘一致、无溢出。
- 已知工作区遗留（与本次无关）：`goal-*`、`ask-user-*` 等前序未提交改动原样保留；架构文档 7.3 仍有一段描述已删除的聊天卡内联展开体（前轮漂移，见 progress.md Notes）。
- Blockers（阻塞）：无。
- Next Session（下一步）：① 真机目视验收——运行中游标推进、失败定位闪烁、日志折叠、380px 窄面板观感、深色对比度；② 可选：now-chip 与刻度标签重叠的进一步避让（当前运行态优先，设计稿已注明）；③ 未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

# 当前交接：workflow-detail-visual-optimize（design，2026-10-23）

- Current Objective（当前目标）：用户要求「优化一下 workflow 的详情展示，你优化一下，先设计 html 给我看」。设计稿已产出 `docs/design/workflow-detail-optimize.html`，**等用户确认后再实施**（feature_list.json 中 `workflow-detail-visual-optimize` 为 pending）。
- 结论（一句话）：在单页合并视图（`workflow-detail-single-page`）之上做八处读数效率优化——概览条减负（预算迁入脚本 sheet 头）、共享网格层（删逐行网格）、运行游标 playhead、阶段跨度条、并行组 bracket + ×N、错误横幅「定位失败步骤」、日志 console 块 + >6 行折叠、展开体左 rail + 实底；外加清理 workflow-detail.css 里重复声明两份的 legend 规则。
- 设计稿结构：01 现状 1:1 复刻（静态）+ P1–P8 问题清单 → 02 决策表（每条 P 对应一个改动与理由）→ 03 可交互原型（浅/深 × 运行中/已完成/失败 × 640/380 宽 × 减少动效，JS 渲染器一套数据出新旧两种形态）→ 04 落地清单（文件级）+ 非目标。
- 关键几何约束（实施时必须保持）：跨度条 `ptrack`、网格层 `glayer`、游标层 `now-layer` 的左右 inset 都等于 `padx + label + gap + ps` / `padx + pe`，与行绘图区完全同列（原型实测对齐误差 <1.5px）；网格层 `z-index:-1` 垫底、实底块（展开体/日志/阶段头/行 hover 背景）自动遮线；游标层 `z-index:1` 在条形之上、实底文本块（`z-index:2`）之下；阶段跨度右端按运行状态钳制（运行中 ≤ elapsed，失败 ≤ runDur）。
- 实施落点（设计稿 04 表）：`WorkflowRunDetailContent.tsx`（概览/sheet 头/跨度条/并行组包装/定位按钮/日志折叠）、`workflow-detail.css`（grid-layer/pgroup/ptrack/logs/rail + 删行内 grid + 合并重复 legend）、`workflow-run-detail.ts`（导出 `workflowPhaseSpan`）、`i18n.ts`（现在/定位失败步骤/展开全部 N 条/收起/并行×N）、`tests/frontend/workflow-renderer.test.ts` 契约重写、wiki 文档同步。elapsed 无需服务端新字段：运行中帧 `max(startedAt + durationMs)` 即可。
- Evidence（验证）：文档类改动未跑 test/lint/build（不触碰 src/、server/、测试、产物）。内联脚本 `node --check` 通过、纯 LF。本地静态服务 + Playwright 实测：对齐/游标重合/并行组（3 行 + 并行×3 + 2px bracket）/日志折叠 8→6/行内网格 0/失败定位（跳转+展开+flash）/阶段折叠/sheet 开合/状态切换/380px 无溢出且对齐保持/深色 token/现状面板 40 条行内网格与预算行均在——全部通过（中途修复一处：`.panel.narrow` 漏了 `width:380px` 导致宽度开关不生效，已补）。
- 已知工作区遗留（与本次无关）：`goal-*`、`workflow-*` 等前序未提交改动原样保留。
- Blockers（阻塞）：无，等用户确认设计。
- Next Session（下一步）：① 用户确认后按 04 落地表实施（先做纯 CSS 三件：共享网格层、日志块、展开体 rail；再做组件层的跨度条/并行组/定位按钮/概览重排；最后 elapsed 游标与测试契约重写）；② 若用户对某条 P 有异议，按反馈改稿再确认；③ 未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

# 当前交接：todo-summary-hover-popover（done，2026-10-23）

- Current Objective（当前目标）：用户要求「对话上面的任务 todo 样式优化一下，默认收拢一下，划过再弹窗，划走就收缩了，里面只显示任务，不显示任务其他的文案，先设计一下 html」。先出设计稿 `docs/design/todo-hover-popover.html`，用户回复「确认，开始实施」后落地。
- 结论（一句话）：Composer 上方 TodoWrite 摘要从「默认展开、常驻整行列表」改为「默认收拢的进度胶囊 + 悬停/聚焦时从正上方弹出的任务浮层」；浮层只剩任务行（状态图标 + 文本），标题 / 统计句 / 「已更新」/ chevron / 逐行状态文案全部移除，状态词降级为视觉隐藏的读屏文本。收拢形态按设计稿选 A（环 + 计数），移动端保留点击弹出。
- 改动文件：
  1. `src/components/chat/surface/TodoWriteSummary.tsx`：DOM 收成 `section > trigger > [button.pill, popover]`。开合状态 `hovered` / `focused` / `pinned` + `HOVER_CLOSE_DELAY_MS=120` 离场宽限；`onPointerOver/Out` 忽略 `pointerType === 'touch'`；`pointerDownRef` 让鼠标点击产生的 focus 不算展开信号；`pinned` 只在 `(hover: none)` 下由 click 切换、Escape 清除；`trackedOpenKey` 在快照清空/回滚时于 render 阶段重置开合状态。退休逻辑（`retiringKey` / `retiredKey` / `data-fading` / 140ms 淡出）完全保留。
  2. `src/styles/chat/todo-summary.css`：整文件重写。胶囊居中细 pill（环 15px + `completed/total`），浮层 `position: absolute; bottom: 100%; z-index: 30`，`padding-bottom: 0.375rem` 作为**命中区内**的桥接间距，卡片 `.quickforge-todo-summary-popover-card` 单独承担描边/背景/阴影；`data-open` 用 `visibility` + `pointer-events` 显隐（不用 `display:none`，保留过渡）；列表限高桌面 14rem / 移动端 10rem；任务行两列（图标 + 文本）；`.quickforge-todo-summary-status-label` 改 clip-path 视觉隐藏；`prefers-reduced-motion` 取消位移动画/缩放与旋转。
  3. `src/styles/chat/goal-workflow.css`：仅更新一行注释（历史卡保持 7.5rem 基准，不再与胶囊列表共用）。
  4. `src/lib/i18n.ts`：删除已无引用的 `todoWriteStats` / `todoWriteUpdated`（中英各两条）。
  5. `tests/frontend/todo-write-summary.test.ts`：渲染用例重写为 26 例（默认收拢 / 只渲染任务行 / hover 开合 / touch 忽略 / 键盘聚焦 / Escape / 新快照不自动展开 / 清空重置 / 退休与 latch 全保留）。
  6. `tests/frontend/todo-write-renderer.test.ts`：CSS 契约改为断言浮层绝对定位向上弹出、`section` 自身仍在正常流、无 `fixed`/`backdrop-filter`。
  7. 文档：`docs/wiki/src/components/README.md`（两处 TodoWrite 摘要段落 + `panel-decoration` 条目）、`docs/wiki/src/styles/README.md`。
  8. 设计稿：`docs/design/todo-hover-popover.html`（浅/深色、固定展开、减少动效四个开关）。
- 关键实现约束：浮层必须是 trigger 的**后代**（指针从胶囊移进浮层不触发 `pointerout`，比 CSS hover + 伪元素桥接更稳）；开合必须是 React 状态而不是 CSS `:hover`，否则 `aria-expanded` 会与屏幕状态不一致；浮层绝对定位使 Dock 高度恒定，开合不再压缩上方消息区（旧方案会）。
- 被避免的坑：① 鼠标点击胶囊会顺带 focus，若把 focus 也算展开信号，点一下浮层就永远开着 → `pointerDownRef` 在指针按下期间跳过 focus 展开；② 在 effect 里同步 `setState` 触发 `react-hooks/set-state-in-effect` → 改为 render 阶段按 `trackedOpenKey` 派生重置；③ 用 `hidden` 关浮层会打断 CSS 过渡 → 用 `visibility` + `pointer-events`；④ `position: absolute` 写进 section 会破坏正常流断言 → 只有浮层绝对定位。
- Evidence（验证）：定向 `todo-write-summary` + `todo-write-renderer` = **37 passed**；`npm run test` → **424 文件 / 4908 passed / 2 skipped**，exit 0；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` → 成功；`npx tsc -b tsconfig.app.json` → 无输出。视觉核对用 Chrome headless 加载真实 `todo-summary.css` 截图（浅/深 × 收拢/展开），并用 `--dump-dom` 读 computed style 确认浮层 `position: absolute` / `bottom: 24px` / `z-index: 30` / 行底 8% primary / `line-through` / status-label `clip-path: inset(50%)`。
- 已知工作区遗留（与本次无关）：`goal-*`、`workflow-*` 等前序未提交改动原样保留。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续（见 `progress.md` Notes）：① 移动端浮层宽度固定 `min(20rem, 100vw - 1.5rem)`，极窄屏可再收一档；② 浮层 `z-index: 30` 依赖 composer dock 祖先链无 `overflow: hidden`；③ 置顶摘要（`GitToolsPinnedSummary`）与历史卡视觉本轮未动，若要统一收拢语义可另起一轮。

---

# 当前交接：css-architecture-split（done，2026-10-23）

- Current Objective（当前目标）：用户要求「不需要打补丁，需要完整最佳的架构，必要必须重构，保持架构最佳，但不要影响现有交互形态和样式」。已完成单体 `src/index.css` 的完整拆分与验证。
- 结论（一句话）：`src/index.css` 删除，改为 `src/styles/index.css` 唯一有序入口 + 38 个领域模块；入口 import 顺序就是级联契约，模块间禁止互相 import；构建产物规则级零差异。
- 改动文件：
  1. `src/styles/**`（新增 39 个 CSS 文件：入口 + 38 模块；foundation / settings / chat / workspace / 共享 markdown/highlight/info-tip）。
  2. `src/main.tsx`：改引 `./styles/index.css`。
  3. `tests/helpers/app-css.ts`（新增）：递归内联入口 import 图，导出 `appCss` / `styleFiles`；兼容 jsdom（`process.cwd()`）。
  4. `tests/frontend/css-architecture.test.ts`（新增）：入口顺序、所有模块恰好可达一次、模块内禁止 @import、跨模块 selector 白名单、main.tsx 入口。
  5. 33 个前端测试：CSS 读取从 `src/index.css` 改为 `appCss`/`globalCss`。
  6. 17 个源码注释：旧 `src/index.css` 路径改为对应模块。
  7. 文档：`DESIGN_LANGUAGE.md`、`docs/wiki/src/README.md`、`docs/wiki/src/styles/README.md`（新增）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`。
- 关键实现约束：入口顺序 = 原单体源顺序，不能重排；跨模块同 selector 覆盖只允许 `css-architecture.test.ts` 登记的 4 组（`:root` / `.dark` token 命名空间、subagent 摘要排版/交互态、tool-summary detail 布局/reduced-motion）；新增全局样式必须进对应领域模块，不能继续堆入口；不使用 CSS Modules（class 被装饰层/querySelector/测试按字符串消费）。
- 被避免的坑：① 不能直接按功能重组 import 顺序——初次搬迁必须保持原顺序才能逐字节比对；② 30+ 测试直接读文件文本，先做 `appCss` helper 再拆，否则会炸一片；③ jsdom 下 `import.meta.url` 不是 file scheme，helper 用 `process.cwd()`；④ 原 `subagent.css` 混了 markdown 链接/用户消息/压缩卡，已按语义拆开；⑤ 误放在 math.css 的 subagent-title flex 已归位。
- Evidence（验证）：`npm run test` → **424 文件 / 4908 passed / 2 skipped**，exit 0；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` → 成功；构建 CSS PostCSS 规则级比对 → **3393 条规则 / 0 语义差异**，其余 CSS chunk 逐字节一致；`css-architecture.test.ts` → **5 passed**。
- 已知工作区遗留（与本次无关）：ask-user remark、workflow 单页详情等前序未提交改动原样保留；`src/index.css` 的未提交内容已全部迁入 `src/styles/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续：① 若要 CSS 按路由拆分 chunk，先收敛 4 组跨模块覆盖/引入 cascade layer，并补真实视觉回归；② `docs/design/*.html` 历史路径可在下次设计稿更新时迁移；③ 在真实浏览器做一轮浅/深色目视验收（本次以构建产物语义比对兜底）。

---

# 当前交接：ask-user-remark-on-confirm（done，2026-10-23）

- Current Objective（当前目标）：用户要求「askuser 这个 tools 交互显示最后确认底部还希望可以加一个补充信息」，先出 HTML 设计稿评审；用户回复「按推荐执行」，即方案 C（第 N+1 条回执行）。
- 结论（一句话）：补充信息是整次提交的限定语而不是某一题的答案，所以**不进** `answers[]`，而是作为回执列表末行单独展示（虚线引导线 + 笔形图标 + 内嵌自适应 textarea + 「可选」小字），并以独立 `remark` 参数一路透传到服务端，最终追加进工具结果末行并持久化到 `details.remark`。
- 改动文件（13 源码/测试 + 2 wiki + 1 设计稿）：
  1. `src/components/chat/panel-decoration/ask-user-card.ts`：`onSubmit(answers, remark?)`；卡片级 `let remark = ''`；review 分支末尾插入 `.quickforge-ask-review-row--remark`；textarea Enter 保持换行；提交透传 `trimmedRemark || undefined`。
  2. `src/components/chat/ChatPanelHost.tsx`：`onAnswerAsk` 两处类型 + `onSubmit` 调用加第 4 参数 `remark`。
  3. `src/App.tsx`：`handleAnswerAsk(askId, answers, skipped, remark?)` → `answerAsk` payload。
  4. `src/lib/server-agent.ts`：`answerAsk` payload 带 `remark`。
  5. `server/agent-approval-responses.mjs`：remark 归一化（trim + slice(0,4000)，空白丢弃，skip 不写）。
  6. `server/agent-approval-orchestrator.mjs`：`finish()` 传 remark → `formatAskResult` + `details.remark`。
  7. `server/ask-store.mjs`：`formatAskResult(..., remark)` 末尾追加 `补充信息：…`。
  8. `server/routes/agent.mjs`：`/answer-ask` 透传 `body?.remark`。
  9. `src/lib/tool-renderers/ask-user-tool-renderer.tsx`：`AskUserReviewRows.remark`、从 `details` 读取、历史回执渲染同款虚线行（skip 不显示）。
  10. `src/index.css`：`.quickforge-ask-review-row--remark` + `.quickforge-ask-remark-{field,icon,input,optional}`；窄屏隐藏「可选」。
  11. `src/lib/i18n.ts`：`askUserRemarkLabel` / `askUserRemarkPlaceholder` / `askUserRemarkOptional`（中英）。
  12. 测试：`tests/frontend/ask-user-card.test.ts`（+2 例）、`tests/server/ask-user-tool.test.mjs`（+1 例）、`tests/server/agent-manager-domains.test.mjs`（+1 例）。
  13. 文档：`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`；评审稿 `docs/design/ask-user-remark-mock.html`。
- 关键实现约束：remark **不能**塞进 `ServerAgentAskAnswer`（会污染逐题答案结构，且服务端 `normalizedAnswers` 按 `questions.length` 对齐切片会丢掉它）；回执行 textarea 的 Enter 必须保持换行，否则多行备注会被当成「前进/提交」。
- 被避免的坑：`tests/frontend/ask-user-card.test.ts` 的源码字符串断言必须精确到 `deps.onSubmit(answers.map((answer) => ({ ...answer })), trimmedRemark || undefined)`，否则改动参数顺序不会被测试发现。
- Evidence（验证）：定向 4 文件 **70 passed**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功。全量 `npm run test` 当时 4895 passed / 2 failed——`scheduled-tasks.commands` 的 Windows `EPERM` 临时文件 rename（单跑 24 passed）、`workflow-renderer` 阶段用例（当轮工作区既存未提交的 `WorkflowRunDetailContent.tsx` 重写导致，已在 `workflow-detail-single-page` 那轮一并修好，现全量 422 文件 4897 passed / 2 skipped）。
- 已知工作区遗留（与本次无关）：`goal-*`、`workflow-*`、`TodoWriteSummary.tsx` 等多处未提交改动来自前几轮会话；`docs/design/workflow-detail-single-page.html` 与 `WorkflowRunDetailContent.tsx` 的单页合并实现见上方 `workflow-detail-single-page` 交接。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续（见 `progress.md` Notes）：① remark 加字数计数/上限提示；② 回执步 remark 与 step/answers 一起持久化，解决刷新归零；③ 补 `aria-label`；④ `formatAskResult` 的「补充信息：」按会话语言本地化。

---

# 当前交接：workflow-detail-single-page（done，2026-10-23）

- Current Objective（当前目标）：用户反馈运行详情里「时间轴 / 阶段 / 日志」三个分段 tab 要点击切换、不顺手，要求「就一个页面不要点击切」。先出 HTML 设计稿评审，用户回复「执行」后落地。
- 结论（一句话）：三视图本来就是同一份数据的三种投影（时间轴读 `startOffsetMs/durationMs`、阶段读 `phases[]`、日志读带 `phase` 的 `logs[]`），已合并成一页连续滚动：整页共享一根吸顶时间轴，每个阶段 = 粘性阶段头 + 该阶段的行（Agent 条形 + 状态点 / 工具 1px 连接线缩进行）+ 该阶段自己的日志。
- 改动文件：
  1. `src/components/workspace/WorkflowRunDetailContent.tsx`：删除 `DetailView` 状态 / `role="tablist"` 分段控件 / 三视图分发；改为 概览条（图例常驻）→ `-scroll` 唯一滚动容器 → 吸顶 `TimelineAxis` → `PhaseSection`（粘性阶段头 + `workflowPhaseSteps` 渲染的 `AgentStep`/`ToolStep` + `-phase-logs`）。`AgentStep`/`ToolStep` 都是 `<details class="-step">` 包整行 `<summary class="-row">`。
  2. `src/index.css`：删除 `-seg / -pane / -rows / -timeline / -log-list / -log* / -tool* / -agent* / -phase-rule`；新增 `-scroll`；`-axis` 与 `-phase-head` 改 `position: sticky`（后者 `top: var(--wf-tl-axis-h)`、`background: var(--background)`、`z-index: 2`）；`--wf-tl-*` 上移到根节点（窄面板 `@media` 同步改覆盖 `.quickforge-workflow-detail`）；新增 `-step / -step-body / -step-meta / -step-actions`；`-phase-logs` 改 flex 行。
  3. `src/lib/i18n.ts`：新增 `workflowDetailRunLogs`；删除 `workflowDetailViewTimeline/Phases/Logs`、`workflowDetailNoLogs`、`workflowDetailPhaseCount`。
  4. `tests/frontend/workflow-renderer.test.ts`：三视图用例改「单页合并」+ 真实渲染断言（刻度条/`-scroll`/`-phase-logs` 同屏、日志落在各自阶段后、无 `-seg`）；CSS 契约改断 `-scroll` overflow、刻度/阶段头 sticky、图例 `margin-left:auto`、`-seg`/`-pane` 不存在。
  5. `docs/wiki/src/components/README.md`：两处重复的「三个视图」段落替换成「单页合并视图」新契约（含吸顶 z-index、为什么工具行只缩进标签列、`--wf-tl-*` 为何上移）。
  6. `docs/design/workflow-detail-single-page.html`：设计稿（上一轮产出，已按此实现）。
- 关键实现约束：吸顶元素（刻度条 `z-index: 3` / 阶段头 `z-index: 2`）都必须有不透明底色，否则滚动中的行会透出来；工具行**只缩进标签列**、右轨道保持整页对齐（否则跨层级条形无法横向比较）；阶段体不再叠加左缩进（行自带左右 `0.875rem`）。
- 被避免的坑：`--wf-tl-*` 变量原先声明在 `-timeline` 内部，合并后吸顶的刻度条/阶段头取不到，必须上移到根节点，窄面板 `@media` 的覆盖选择器也要一起改。
- Evidence（验证）：`npx vitest run tests/frontend/workflow-renderer.test.ts` → **29 passed**；`tests/frontend` 全量 → **249 文件 2991 passed**；`npm run test` 全量 → **422 文件 4897 passed / 2 skipped**；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（5.55s）。
- 已知工作区遗留（与本次无关）：`goal-*`、`ask-user-*`、`server/*` 等多处未提交改动来自前几轮会话。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续：① `npm run dev` 目视验收浅/深色与 340px 窄面板下吸顶区域的观感、工具行连接线与条形是否对齐；② 长运行（几十阶段）里加「跳到出错步骤」的滚动辅助。

---

# 当前交接：trace-view-switch-neutral（done，2026-10-23）

- Current Objective（当前目标）：用户反馈「切换到轨迹的时候 轨迹的 icon 不需要有特殊的颜色 就和普通的对话一样就行」。
- 结论（一句话）：图标本身没色，是 `conversation-trace.css` 里一条只作用于轨迹页签的选中态覆盖（`:last-of-type`）把文字与图标染成 model 蓝并加了 1px 彩色内描边；删掉后两个页签完全同款。
- 改动文件：
  1. `src/components/chat/trace/conversation-trace.css`：删除 `.quickforge-chat-view-switch button[role='tab'][aria-selected='true']:last-of-type` 整条规则，轨迹页签回落到通用 `[aria-selected='true']`（`--background` 药丸 + `--foreground`）。
  2. `tests/frontend/conversation-trace-contract.test.ts`：新增「keeps the chat / trace view switch neutral」，断言切换器规则块不含 `--qf-trace-hue-*` / `--qf-trace-text-*`（行首锚定，避开 `:where()` 令牌作用域），选中态 `--foreground` 且无 `inset 0 0 0 1px`。
  3. `progress.md` / `session-handoff.md` / `feature_list.json`（新增 `trace-view-switch-neutral`，done）。
- 关键实现约束：令牌作用域选择器 `:where(.quickforge-trace, .quickforge-chat-view-switch)` 必须保留——`.quickforge-trace` 主体仍用这批 `--qf-trace-*` 令牌，收窄作用域会扩大改动面并撞 `scopes the hues` 契约用例。
- 被避免的坑：写契约用例时不能直接匹配 `.quickforge-chat-view-switch...{`，会先命中 `:where(.quickforge-trace, .quickforge-chat-view-switch) {` 令牌块并误报；用 `^\.` 行首锚定。
- Evidence（验证）：`npx vitest run tests/frontend/conversation-trace-contract.test.ts` → **27 passed**；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` → 成功（`tsc -b` + vite 5.53s）。
- 已知工作区遗留（与本次无关）：`goal-*`、`workflow-*`、`index.css`、`TodoWriteSummary.tsx` 等多处未提交改动来自前几轮会话。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续（`progress.md` Notes）：① `npm run dev` 各看一浅色/深色下轨迹选中态对比度；② 若确认切换器不需要任何轨迹色，可把令牌作用域从 `:where(.quickforge-trace, .quickforge-chat-view-switch)` 收窄为 `.quickforge-trace`（同步契约用例）。

---

# 当前交接：goal-strip-pause-icon-two-bars（done，2026-10-23）

- Current Objective（当前目标）：用户反馈「执行中的 icon 显示有点问题，我看到只有单杠不是双杠」，问有没有现成的 icon 可用。
- 结论（一句话）：**代码少画了一条杠**。`surface/GoalControlStrip.tsx` 的 `ACTION_ICON.pause` 只有 `M9.5 6v12`，而设计稿 `goal-strip-icon-review.html` 一直是两条；测试只断言按钮存在 + `aria-label`，从不检查图标内部，所以少一条杠一路绿灯。
- 改动文件：
  1. `src/components/chat/surface/GoalControlStrip.tsx`：`pause` 补第二条圆头竖杠（`M14.5 6v12`），并注释为什么不能用 lucide 的 `Pause`（两个描边 `rect`）/`SquarePause`（带外框）——24px 命中区塞 12px 图标 + 强制 `stroke-width:2.4`，靠留白分隔的小形状会糊成实心块。
  2. `tests/frontend/goal-control-strip.test.ts`：新增回归用例，断言主操作 `svg` 内恰好是这两条 path。
  3. `docs/wiki/src/components/README.md`：两处运行条口径（该文件存在重复段落）同步补暂停图标形状与断言说明。
  4. 新增 `docs/design/goal-pause-icon-fix.html`：12px 真实尺寸 + 2x 放大、6 个候选横向对比。
- 被避免的坑：直接换成 lucide `Pause` 会从「单杠」变成「两个实心块」——它的两条杠是 `rect`，12px 下空心部分只剩 0.1px；`SquarePause` 更糟（多一圈外框）。这个尺寸只接受纯 `path` 组合。
- Evidence（验证）：`npx vitest run goal-control-strip / git-tools-pinned-summary / goal-icon` 三文件 **64 passed**（含新增 1 例）；`npx tsc -b` 通过；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（5.28s）。
- 已知工作区遗留（与本次无关）：`goal-*`、`workflow-*`、`index.css`、`TodoWriteSummary.tsx` 等多处未提交改动来自前几轮会话；`tests/frontend/goal-control-strip.test.ts` 的既有失败上一轮已修复。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续（`progress.md` Notes）：① `attention` 主操作 3 笔在 12px 下贴太紧；② `resume` 尖角三角与 lucide `Play` 圆角风格不一致；③ 条带「14px 图标 + 8px 旋转环 + 6px 呼吸点」三件套仍待定，方案见 `docs/design/goal-icon-redesign.html` 的 R1–R5。

---

# 当前交接：retry-continue-lease-header（done，2026-10-23）

- Current Objective（当前目标）：用户反馈「只有一条消息时点重试会报错 This session is open for writing in another window」，随后更正为「多轮点重试也报错」——即重试在所有场景都失败，且本页明明是唯一打开的窗口。
- 结论（一句话）：消息「重试」的写入口是 `POST /api/agents/:id/continue`，而 `ServerAgent.continue()` 是全仓**唯一漏发 `x-quickforge-client-id` 的写入口**（不带 appendMessage 的裁剪重生成形态连 headers 都没传）；服务端 `assertSessionWriteAccess`（`server/routes/agent.mjs:545`）读不到客户端标识就把本页当匿名客户端，租约被自己持有时也返回 409 `SESSION_LEASE_HELD`。
- 改动文件：
  1. `src/lib/server-agent.ts`：`continue()` 两种形态都发 `writeHeaders()`（带 `appendMessage` 时再叠 `content-type` + body）；入口新增 `canWrite()` 守卫，非持有者本地抛错、不再乐观追加「继续」消息。
  2. `tests/frontend/server-agent-session-lease.test.ts`：+2 例（无/有 appendMessage 都必须带客户端头），并在旁观者用例里补 `continue()` 本地拦截断言（现 14 passed）。
  3. `docs/wiki/src/lib/README.md`：`continue(appendMessage?)` 条目补「两种形态都必须带租约头 + 入口先过 `canWrite()`」。
- 被避免的坑：只给带 `appendMessage` 的分支补 header 会漏掉普通重试（无 body 分支），因为 headers 原本嵌在 `...(optimistic ? {...} : {})` 里——必须把 headers 提到分支之外。
- Evidence（验证）：定向 14 + 142 + 51 passed；`npx eslint` 改动文件 0 error；`npm run lint` 0 error；`npx tsc -b` 通过；`npm run build` 成功（5.40s）；`npm run test` 全量 422 文件 421 passed / 1 failed（`tests/server/scheduled-tasks.commands.test.mjs` 单独复跑 24 passed，属并行抖动）。
- 已知工作区遗留（与本次无关）：`goal-*`、`workflow-*`、`index.css`、`TodoWriteSummary.tsx` 等多处未提交改动来自前几轮会话；`tests/frontend/goal-control-strip.test.ts` 的既有失败上一轮已修复并全量通过。
- Blockers（阻塞）：无。
- Next Session（下一步）：未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选同类修复（`progress.md` Notes）：`App.tsx` 的 `abort-tool` 与 `useSessionActions.ts` 的 `POST /title` 仍是不带客户端头的裸 fetch，后者在服务端有守卫（旁观窗口改名会 409）。

---

# 当前交接：todo-summary-retire-latch（done，2026-10-23）

- Current Objective（当前目标）：用户反馈「todo list 显示在对话上方，已经完成了但是没有消失」，期望「每轮对话结束检查，完成了就该消失」。
- 结论（一句话）：判定没问题，是**退休动作被下一轮打断**——`shouldRetire` 是活谓词，下一轮 `idle` 翻 false 就把 140ms 淡出的 timer 取消并让胶囊以全不透明度复活；连续轮次（goal 续跑 / 队列续发 / 后台任务通知）下退场永远跑不完，全完成的清单就常驻了。
- 改动文件：
  1. `src/components/chat/surface/TodoWriteSummary.tsx`：新增 `retiringKey`，render 阶段锁存首次 `shouldRetire`（与 `trackedKey` 同一条 derive-from-props 路径）；`fading = (shouldRetire || latched) && !retired`。新快照新 key，不受 latch 影响。
  2. `tests/frontend/todo-write-summary.test.ts`：新增淡出窗口内开新一轮不复活用例（26 passed）。
  3. `docs/wiki/src/components/README.md`：两处 `todo-write-summary.ts` 条目 + 两处 Composer 摘要段落补 latch 口径。
- 被避免的坑：把 latch 放进 `useEffect` 会晚一帧、首帧不带 `data-fading`，退出过渡从错误的不透明度起算；必须像 `trackedKey` 一样在 render 里 setState。
- Evidence（验证）：定向 `npx vitest run tests/frontend/todo-write-summary.test.ts` 26 passed；`npm run lint` 0 error；`npm run build` 成功（`tsc -b && vite build`）。
- 已知工作区遗留（与本次无关）：`tests/frontend/goal-control-strip.test.ts` 有 1 例失败（goal 条带图标评审遗留）、`test(s)` 之外的多处未提交改动（`goal-*`、`workflow-*`、`index.css`）来自上一轮会话，未扩范围。
- Blockers（阻塞）：无。
- Next Session（下一步）：未提交 Git，未手工修改 `dist/`、`package-dist/`、`package-offline/`。可选后续：若希望「残留 pending/in_progress」也随轮次退休，需要先决定是否放给模型「最终快照」契约变更，当前按用户选择保持「有未完成项就保留」。

---

# 当前交接：workflow-summary-card-visual-quiet（done，2026-10-23）

- Current Objective（当前目标）：用户要求「样式再优化一下：不需要显示查看详情和小绿点，反正可以点击跳转过去；运行过程可以显示思考过程那样的流光效果」。确认：小绿点 = 阶段刻度；运行态保留「文字流光 + 阶段跑马灯」。
- 结论（一句话）：摘要卡缩到「图标 + 摘要文本 + 阶段跑马灯 + 终态状态/耗时」，整行即可点，动作提示只留在 `aria-label`；运行中标题复用 `.quickforge-tool-running-sweep`（与思考过程同一套 shimmer）。
- 改动文件：
  1. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：删 `WorkflowTicks` 与 `quickforge-workflow-affordance` 块。
  2. `src/index.css`：删 `.quickforge-workflow-ticks/-tick/-affordance/-affordance-icon` 及其 reduced-motion 分支；保留 `@keyframes quickforge-workflow-tick-pulse`（Inspector 状态 pill 复用）；`.quickforge-workflow-title` 加 `margin-right: auto`。
  3. `tests/frontend/workflow-renderer.test.ts`、`tests/frontend/workflow-step-interaction.test.ts`：改为断言 tick/affordance 不存在、`View details`/`Opened` 仅在 aria-label、运行态有 sweep 与跑马灯。
  4. `DESIGN_LANGUAGE.md`（新增「整行可点时不再单独渲染入口提示」）、`docs/wiki/src/lib/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`。
- 被避免的坑：直接删「查看详情」会把可访问名称一起删掉 → 保留 `aria-label` 里的 `workflowDetailOpenRun/workflowDetailOpened`；删刻度后右侧状态会贴到文本尾 → 用标题 `margin-right: auto` 占位（有跑马灯时 auto margin 自动归零，不影响其弹性宽度）。
- Evidence（验证）：`npx vitest run` 两个工作流文件 36 例通过；`npx tsc -b` 通过；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（24s）。
- 已知工作区遗留（与本次无关）：`tests/frontend/goal-control-strip.test.ts` 有 1 例失败（`buildGoalControlStripView` 期望 `planning` 时 `spinning: false`，实际 `true`，来自另一处未完成的 goal 条带图标评审改动），未扩范围修复。
- Blockers（阻塞）：无。
- Next Session（下一步）：无遗留；未提交 Git，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

# 当前交接：workflow-summary-hide-zero-agents（done，2026-10-23）

- Current Objective（当前目标）：用户要求「工作流优化一下，如果没有智能体调用就不要显示智能体 0 了」→ 确认范围为「聊天区摘要卡 + 右侧详情概览条」→ **已实施完成，未提交、未创建 commit**。
- 结论（一句话）：摘要文案改为「状态 + 非零计数片段」拼接，0 个智能体 / 0 个工具整段不再出现，两者都为 0 时只留状态；i18n 里 4 条「状态 · {agents} · {tools}」模板随之删除。
- 改动文件：
  1. `src/lib/workflow-run-detail.ts`：新增 `WorkflowTranslate`、`workflowCountParts(view, translate)`、`workflowSummaryText(view, translate)`，删除 `workflowSummaryKey`。
  2. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：摘要卡改用 `workflowSummaryText(view, t)`，删除 `summaryParams` 预拼接。
  3. `src/components/workspace/WorkflowRunDetailContent.tsx`：概览条改用 `workflowCountParts(run, t).concat(阶段数).join(' · ')`。
  4. `src/lib/i18n.ts`：中英各删 4 条 `workflowSummaryRunning/Done/Failed/Aborted`。
  5. `tests/frontend/workflow-renderer.test.ts`：新增「omits zero agent and tool counts from the summary」三例，更新 i18n 键清单与摘要断言。
  6. 文档：`docs/wiki/src/lib/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`。
- 被避免的坑：清空模板占位符会残留孤立的 ` · `；改为片段数组 join 后零计数不会多出分隔符。
- Evidence（验证）：`npm run test` 422 文件 4874 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.88s）。
- Blockers（阻塞）：无。计数口径未变（`agentCount` 仍是已登记的 agent record 数，因 `maxAgents` 预算被跳过的调用不计入）。
- Next Session（下一步）：无遗留；未提交 Git，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

# 当前交接：conversation-trace-view（done，2026-10-23）

- Current Objective（当前目标）: 用户要求「设计对话功能的轨迹功能，可以看到每个工具的详情和时间轴，在对话顶部分支旁边可以查看」→ 确认「直接在对话区域展开」→ 参考 DSH Trajectory 重做原型 → 确认「保留时间总览 / 三种模式都要 / 检查器默认隐藏」→ **已实施完成，未提交、未创建 commit。**
- 结论（一句话）: 轨迹是**对话区内部的第二种视图**（顶部「对话 / 轨迹」切换器），把 `agent.state.messages` 纯投影成 Turn→Step→Tool，配三轨×三模式时间总览与按类型给页签的检查器；不新增事件日志、不卸载对话、不使用 SVG viewBox。
- 改动（7 个源文件 + 3 个测试 + 4 份文档）:
  1. `src/lib/conversation-trace.ts`（新）：纯投影 `buildConversationTrace(messages, { pendingToolCalls, now })`；轮次切分复用 `process-folding` 的 `decorateProcessBlocks` 语义；耗时只取 `details.quickforgeTiming`，尾步无记录时 `undefined`（不写 0）；状态 `done`/`error`/`running`/`interrupted`；`parallelGroupId`；`traceRows`/`traceBounds`/`layoutTraceSpans`（sequence|duration|time）/`traceTurnMarkers`/`traceRowMatches`/`formatTraceDuration`（未知 → `—`）/`countTraceTools`。
  2. `src/components/chat/trace/ConversationTraceView.tsx`（新）：工具栏（三模式 / 展开全部 / 搜索）+ 时间总览三轨（DOM + 内联百分比）+ Ledger（Turn→Step→Tool，工具行缩进 26px + 1px 连接线）+ Inspector（默认隐藏、按类型给页签、Esc 关闭）+ 空状态。视图内不调 `Date.now()`（`now` 由顶层传入，满足 `react-hooks/purity`）。
  3. `src/components/chat/trace/conversation-trace.css`（新）：组件自 import（同 `goal-inspector.css` 做法）；复用 `color-mix(in oklab, var(--border) 60%, transparent)` 与 `--quickforge-dur-*` / `shimmer`；每条 `@keyframes` 都有 `prefers-reduced-motion` 降级。
  4. `src/hooks/useUIState.ts`：新增 `conversationViewScope: { scopeId, view } | null`（scope 绑定，不是裸字符串）。
  5. `src/App.tsx`：顶部「对话 / 轨迹」切换器（Git 分支 pill 之后、⋯ 之前，md 以上显示）+ `conversationView` 派生 + `.quickforge-trace-layer` 覆盖层（**刻意不卸载** `SessionViewPool`/`ChatPanelHost`）+ `traceToolCount` 徽标（`countTraceTools`，不建投影）。
  6. `src/lib/i18n.ts`：中英各 64 个 `trace.*` key。
  7. 测试：`tests/frontend/conversation-trace.test.ts`（29）、`conversation-trace-view.test.ts`（10）、`conversation-trace-contract.test.ts`（17）。
- Evidence（验证）:
  - 定向 `npx vitest run` 3 个轨迹文件 → **56 passed**。
  - `npx tsc --noEmit -p tsconfig.app.json` 通过。
  - `npm run lint` → **0 error**（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）。
  - `npm run test` 全量 → **422 文件 / 4874 passed / 2 skipped**（exit 0）。
  - `npm run build` → 成功（4.05s），但**必须先隔离工作区里预先存在的无关改动**：`src/lib/workflow-run-detail.ts` 删掉了 `workflowSummaryKey`，而 `src/lib/tool-renderers/workflow-tool-renderer.tsx` 仍在 import 它（另一个未完成的 workflow 渲染重构）。该失败在剥离本次改动后依旧存在，与本 feature 无关。
- 文档:
  - 新增 `docs/architecture/conversation-trace.zh-CN.md`（12 节：问题、目标/非目标、数据来源、结构、时间总览、Ledger、Inspector、挂载与不卸载、视觉约束、完整度边界、测试清单、相关文件）。
  - `docs/wiki/README.md` 架构表格加「对话轨迹」行。
  - `docs/wiki/src/components/README.md` 首节加「对话轨迹视图」。
  - `docs/wiki/src/lib/README.md` 首节加「对话轨迹投影」。
  - `docs/design/conversation-trace-mockup.html` 保留为设计阶段对照物。
- Blockers（阻塞）: 无。
- Next Session（下一步）:
  1. **真机视觉验收**：时间总览拖选手感、三模式切换的条形动画、深色模式对比度、窄屏（≤48rem）覆盖式 Inspector、`prefers-reduced-motion` 表现。
  2. **移动端入口**：顶部切换器在 `md` 以下隐藏，`⋯` 菜单里还没有「轨迹」项。
  3. **大工具数性能**：>500 行时首屏渲染变慢（无虚拟滚动，已知取舍）；如需优化，先做轮次级懒渲染而不是引入 `@tanstack/react-virtual`。
  4. **与对话双向联动**：目前只有 Inspector 的「在对话中定位」单向跳回对话视图；原型的「点工具卡 → 轨迹定位到该行」还没接（需要给 `ToolMessage` 加 `data-tool-call-id`）。
  5. **建议先修掉工作区里那处 workflow 渲染重构**（补 `workflowSummaryKey` 的移除收尾），否则 `npm run build` 始终失败。
  6. 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：goal-strip-single-line（done，2026-10-23）

- Current Objective（当前目标）: 用户要求「尽量优化成一行显示目标，保持简单，重新设计」；看单行设计稿后回复「按推荐执行，不需要按钮文字，使用 icon」。**已实现，未提交、未创建 commit。**
- 结论（一句话）: 三段卡（≈76px）压成一行 32px —— `靶心图标 · 状态词 · 目标（单行截断）· 2/3 · 主操作(纯图标) · ⋯`；就地展开面板与 chevron 删除，验收明细只在 Inspector（三处入口：状态词 / 目标 / ⋯→打开完整面板）。
- 改动:
  1. `surface/GoalControlStrip.tsx`：单一 flex 行；主操作改 **icon-only**（24px，`aria-label` + `title` 承载文字，避免本地化动词换行）；状态词与目标改按钮（进 Inspector）；新增 `detailLine`（`Set` 去重 phaseDetail/轮次/用时）供 ⋯ 菜单只读行与 tooltip；删 `expanded`/`panelId`/chevron/`CRITERION_STATUS_KEY`/`goalStatusIcon` import。
  2. `panel-decoration/goal-control-strip.ts`：`stateTone`（working/attention/idle/blocked/success/danger）+ `GoalControlStripTone` + `stateToneFor` + `isWorkingSpin`（仅 planning/executing/verifying 转）；`v2PrimaryAction` 增加「等待用户优先」判断。
  3. `src/index.css`：条带段整体重写（−342/+219 行）：`height: 2rem`、`width: 100%`、单行 + `ellipsis/nowrap`、icon-only 主操作、`.menu-meta`、560/420 两级退让；删 `.head`/`.meta`/`.panel`/`.chevron`/`line-clamp`。
  4. 测试：`goal-control-strip.test.ts` 30 例（展开用例改为「进度在行内 + 无内联清单」与「三处入口进 Inspector」，新增 icon-only 断言）；`goal-card.test.ts` CSS 契约改为固定 32px / 100% 宽 / 无 panel 无 clamp。
- Evidence（验证）: 定向 4 文件 **71 passed**；goal 全量相关 17 文件 **357 passed**；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；全量 `npm run test` **422 文件 / 4887 passed / 2 skipped**；`npm run build` 成功（3.67s）。
- 文档: `docs/wiki/src/components/README.md` 两处「运行条」段改写（numstat 2/2）；`docs/design/goal-strip-single-line.html` 标为已落地。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① **真机视觉验收**——32px 高度下 6px 点与 12px 图标/14px 靶心的重量平衡、420px 窄屏目标截断后是否还能认出目标、`width: 100%` 在宽屏下贴满 composer 的观感；② 方案 B（悬停长高展示验收）与 C（不带进度）未做；③ 完成态仍不渲染条带（方案 C 完成卡）；④ tone 仍是硬编码 hex；⑤ **注意**：本轮工作区一度把 `GoalControlStrip.tsx` 与 `goal-control-strip.ts` 回退到 HEAD 版本（CSS 已是单行版但组件还是三段卡），已重新写入并验证 —— 若再遇到「CSS 与组件不匹配」，先怀疑未提交文件被回退；⑥ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：goal-strip-icon-fix（done，2026-10-23）

- Current Objective（当前目标）: 用户反馈「goal 模式对话框上面的样式还有问题，比如 icon 不对」，要求先出评审 HTML，选定后落地。用户选了我推荐的**方案 A（身份图标恒定 + 状态只走点/词/色）**。**已实现，未提交、未创建 commit。**
- 结论（一句话）: 图标绑错了维度——条带用 `goalStatusIcon[view.tone]`，而 tone 是 5 个**颜色阶**不是 5 个**状态**，于是 `paused → info` 把「已暂停」画成了规划态的待办清单、`waiting_* → active` 让「需要你处理」和「执行中」共用蓝色时钟。改成：图标恒定靶心、状态词表达状态、颜色只表达注意力。
- 改动（4 源文件 + 2 测试 + 文档）:
  1. `surface/GoalControlStrip.tsx`：图标改 `<GoalIcon />`（中性灰、恒定），删 `goalStatusIcon` + `dangerouslySetInnerHTML`；旋转改为独立 `.quickforge-goal-strip-spinner` 圆环；`ACTION_ICON.attention` 加下沿横线（与 `open` 的 chevron 区分）；`data-tone` 改挂 `stateTone`，卡片色移到 `data-card-tone`。
  2. `panel-decoration/goal-control-strip.ts`：新增 `GoalControlStripTone`（`working/attention/idle/blocked/success/danger`）与 `stateToneFor`（按状态词推导，不碰 `v2Tone`）；新增 `isWorkingSpin`（仅 planning/executing/verifying 转）。
  3. `src/index.css`：`[data-tone]` 改 6 个 stateTone 值；图标固定 `var(--muted-foreground)` + 0.875rem；新增 spinner；点 7px→6px；chip 固定 `#d97706`；`min-width` 20rem→18rem；reduced-motion 覆盖 spinner。
  4. `panel-decoration/icons.ts`：`goalStatusIcon` 保留（摘要/工具卡仍用），加注释说明条带不再消费。
  5. 测试：`goal-control-strip.test.ts` 加「identity glyph 恒定且无 `<rect>`」「stateTone 矩阵」「spinning 只在推进时」；`goal-card.test.ts` CSS 契约改为断言 spinner + `[data-tone="attention"|"idle"]` 且 `icon--spinning` 已移除。
- Evidence（验证）: 定向 4 文件 **69 passed**；契约与相邻 9 文件 **179 passed**；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；全量 `npm run test` **422 文件 / 4884 passed / 2 skipped**；`npm run build` 成功（5.46s）。
- 文档: `docs/wiki/src/components/README.md` 两处「运行条」段改写（numstat 2/2，无格式漂移）；`docs/design/goal-strip-icon-review.html` 标注已落地 + 05 节换成实际实施表。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① **真机视觉验收**——spinner 转速（1.1s）与 6px 点的重量感、`min-width` 18rem 在短目标下的表现、深色模式下 id+灰图标对比度；② 完成态仍不渲染条带（方案 C 完成卡未做）；③ tone 仍是硬编码 hex，本轮只把「按 tone 上色」改成「按 stateTone 上色」，token 化未做；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：goal-mode-ux-fix-strip（done，2026-10-23）

- Current Objective（当前目标）: 用户选定设计稿的**方案 A**（目标卡）并要求执行落地。**已实现，未提交、未创建 commit。**
- 结论（一句话）: 输入框上方的 goal 条带从「单行 + 4 个同权重 icon」改成三段式目标卡（身份行 / 目标行 / 进度行），配「⋯」菜单 + 就地展开 + 锚定确认 popover，并把 13 个服务器状态收敛成 5 个用户可见状态词。
- 改动（5 个源文件 + 1 个测试 + 文档）:
  1. `src/components/chat/panel-decoration/goal-control-strip.ts`：view 投影新增 `statusWordKey`（`goalStateRunning/NeedsYou/Paused/Blocked/Done`）、`phaseDetail`、`criteriaPassed/criteriaTotal`、`durationMinutes`、`primaryLabelKey`、`primaryOpensInspector`；`primaryAction` 扩为 `pause|resume|attention|none`；新增纯函数 `stateWordFor` / `phaseDetailFor` / `criteriaTally` / `isWaitingOnUser`；精确 13 值的 `statusKey` 保留给 title/aria。
  2. `src/components/chat/surface/GoalControlStrip.tsx`：唯一实心 `quickforge-goal-strip-primary`；「⋯」菜单（编辑 / 打开完整面板 / 清除）；展开 `quickforge-goal-strip-panel`（验收清单 + 预算条 + 打开面板链接）；清除确认改 `quickforge-goal-strip-confirm-pop` 锚定 popover；`attention` → `revealWaitingCard()` 滚动 `.qf-scroll-container` 内最后一张 `.quickforge-approval-card`/`.quickforge-ask-card` 并加 1.4s `data-goal-attention` 描边；`data-state` 导出 5 词状态供 CSS 驱动 tone/呼吸点。
  3. `src/index.css`：`.quickforge-goal-strip*` 改写为卡片形态（约 400 行；**类名前缀刻意保留**，`message-queue.ts` 的 `isQueueAnchorFollower` 与 `goal-card.test.ts` 的 CSS 契约都依赖它）；补上仓库里一直只被引用未定义的 `@keyframes quickforge-goal-spin`；新动效全部带 `prefers-reduced-motion` 降级。
  4. `src/components/chat/panel-decoration/goal-card.ts`：`blockerText` → 导出 `buildGoalBlockerText`，条带复用同一套 blocker 本地化。
  5. `src/lib/i18n.ts`：中英各新增 22 个 key。
  6. `tests/frontend/goal-control-strip.test.ts`：19 → 25 例，写清意图而非放宽断言。
- Evidence（验证）: 定向 15 个 goal 相关文件 **311 passed**；CSS/i18n 契约 6 文件 **94 passed**；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npm run test` 全量 **419 文件 / 4817 passed / 2 skipped**；`npm run build` 成功。
- 文档: `docs/wiki/src/components/README.md` 两处重复段（目录行 + Goal 生产 UI 段）改写；`docs/design/goal-mode-ux-proposals.html` 标注「方案 A 已落地」，06 节换成实际实施表、落地顺序打勾。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① **真机视觉验收**——展开面板/「⋯」菜单/确认 popover 的定位、窄屏（≤640px 隐藏 `phaseDetail`）表现、深色模式对比度；② 完成态仍 `return null`，需要设计稿 C3 完成卡才算闭环；③ tone 仍是硬编码 hex（`#3478d4`/`#d97706`/`rgb(4 143 101)`）散在 4 处，未 token 化；④ `phaseDetailFor` 与 `goal-card.ts` 的 `v2StatusKey` 语义有重叠，可抽公共映射；⑤ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：goal-mode-ux-redesign（done，2026-10-23）

- Current Objective（当前目标）: 用户要求「分析 goal 模式的 UI 设计，给几个可优化方案（用户体验与流程），出 HTML 设计稿」。**设计稿已产出，未改任何生产代码、未创建 commit。**
- 结论（一句话）: goal 模式的核心问题是「把会话级目标当成输入框附属物」——单行 fit-content 条带承载 4 个同权重图标按钮、放不下验收进度、13 个状态词原样透出、细节全在右侧面板且完成即消失。设计稿给出 A（目标卡，推荐）/ B（顶部停靠 Dock）/ C（计划门禁 + 完成卡）三套方案，均可直接评审。
- 产出: `docs/design/goal-mode-ux-proposals.html`（1182 行 / 67.8 KB，自包含单文件、零依赖、UTF-8 纯 LF）。
  - 01 现状诊断（按生产 CSS 复刻条带 + P1–P8 问题卡，每条附「改」）
  - 02 方案 A：A1 折叠态（状态→目标→进度三级）/ A2 就地展开（验收 + 预算 + 操作行）/ A3 状态收敛表（13 → 5 主状态词 + 1 阶段标签）
  - 03 方案 B：36px 吸顶 Dock + 验收进度环 + 展开抽屉；「需你处理」= 滚动高亮对话卡
  - 04 方案 C：计划就绪卡（配可选 `goal.requirePlanConfirmation`，默认关）/ 24px 极简胶囊 / 完成卡替代 `return null`
  - 05 交互路径对比（内联 SVG：现状 4 次跳转 vs 方案 A 1 次）+ 状态机表
  - 06 规格与落地：视觉规格、tone 收敛表、6 项文件级改动表、5 步落地顺序
  - 交互：主题切换、5 状态切换、展开收起，全部动画带 `prefers-reduced-motion` 降级
- 关键代码依据（供后续实施时直接定位）:
  - 条带：`src/components/chat/surface/GoalControlStrip.tsx`（243-406 行是渲染，4 个 `.quickforge-goal-strip-action`）；视图投影 `src/components/chat/panel-decoration/goal-control-strip.ts`（`buildGoalControlStripViewV2` 在 `complete` 时 `return null`）
  - 面板：`src/components/workspace/GoalInspectorContent.tsx`（219-229 是 criteria + `details` 嵌 `details` 的证据）+ `goal-inspector.css`（`:16-20` tone 映射）
  - 样式：`src/index.css:7897-8056`（`.quickforge-goal-strip*`），tone 硬编码 `#3478d4` / `#d97706` / `rgb(4 143 101)`
  - 卡片投影：`src/components/chat/panel-decoration/goal-card.ts`（`buildGoalCardViewModel`，tone/statusKey 单一来源）
- Evidence（验证）: 文档类改动，未跑 `npm run test` / `lint` / `build`（不触碰 `src/`、`server/`、测试、打包产物）。静态校验：标签配平（div 221/221、svg 33/33、section 6/6）、内联脚本 `node --check` 通过、LF 换行。
- Blockers（阻塞）: 无。需用户选定方案（推荐 A，可叠加 C3 完成卡）。
- Next Session（下一步）: ① 等用户选方案 → 按设计稿 06 的 6 项改动表实施（第一步只做「4 图标 → 1 主操作 + ⋯ 菜单」，纯收益零风险）；② 实施时同步 `tests/frontend/goal-control-strip.test.ts`、`goal-card.test.ts` 的锚点；③ 顺手收敛 tone token（现在 4 处重复 + 硬编码 hex）；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：workspace-inspector-close-on-session-switch（done，2026-10-23）

- Current Objective（当前目标）: 用户要「切换 session 时右侧面板不要自动打开」。用户先误说成左侧边栏、随后纠正为右侧，并选定 **D + A**：保留自动预览、切 session 强制收起。**已实现并全量验证，未提交、未创建 commit。**
- 结论（一句话）: 右侧面板的开合过去是 App 级布尔量，而 `WorkspaceInspector` 的 key 是 `${projectId}:${runtimeScopeId}`——切 session 只重挂载子组件、不重置父级状态，于是上一会话手动展开的面板会跨会话残留。改成记录「在哪个 runtimeScopeId 打开」后，open 由它与当前 scope 派生，切 session 自动回到收起态。
- 改动:
  1. `src/App.tsx`：`workspaceInspectorOpen`（`useState(false)`）→ `workspaceInspectorOpenScopeId`（`useState<string | null>(null)`）+ 派生 `const workspaceInspectorOpen = workspaceInspectorOpenScopeId === workspaceInspectorRuntimeScopeId`；三个写入点（`requestWorkspaceInspector`、`handleWorkspaceInspectorOpenChange`、右上角 PanelRight toggle）全部绑定 `runtimeScopeId`。
  2. 第一版用 `useEffect` 重置，被 `react-hooks/set-state-in-effect` 判 error（同步 setState 级联渲染）；改为派生状态后删除 effect。
  3. `tests/frontend/git-tools-pinned-summary.test.ts`：同一语义换用新 setter 名，顺序断言保留。
  4. 新增 `tests/frontend/workspace-inspector-session-switch-close.test.ts`（3 例源码契约）。
- Evidence（验证）: 定向 6 文件 **76 passed**；`npm run test` 全量 **419 文件 / 4809 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.24s）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 真机确认「在 A 会话手动打开面板 → 切到 B 会话」面板保持收起；② 若仍偶发自动弹出，那是保留的自动预览（`openLivePresentedArtifacts`，门禁 `sessionId === currentSessionId`）+ 运行中会话的 live `present_files`，需再加时间窗或「仅用户主动回合」抑制；③ `src/index.css` 有本会话之前就存在的未提交改动，会让 4 个 CSS 契约测试（goal-iteration-divider / reconnect-notice / model-retry-notice / scroll-to-bottom-button）失败——已 stash 验证与本次改动无关，**不要误当成回归**；④ 未提交 Git；未手工修改生成产物；未关闭用户正在使用的实例。

---

## 当前交接：workflow-timeline-clip-fix（done，2026-10-23）

- Current Objective（当前目标）: 用户反馈「时间轴右侧进度条好像被遮挡」。已修复。**未提交、未创建 commit。**
- 结论（一句话）: 右侧是 4 处独立裁切叠加，统一改为「绘图区（plot）+ 两侧安全区」布局。
- 根因（4 处）:
  1. 项目**没有全局 `box-sizing: border-box`** → 条形 `width:X%` + `1px` 边框超出轨道 2px，贴 100% 时右端被切。
  2. `.bar-value` 是**条形的子元素**（`left: calc(100% + 5px)`），条形靠右就伸出轨道；注释说「太靠右翻到内侧」但没实现。
  3. `.parallel-tag` 同样挂在条形上、往左伸进标签列，盖住行名。
  4. 刻度 `translateX(-50%/-100%)` 需要半个字宽余量，边界处没有，首尾被切。
- 改动:
  1. `src/index.css`：时间轴根节点加 `--wf-tl-pad-start: 2.25rem` / `--wf-tl-pad-end: 2.75rem`（窄屏 `1.75rem` / `2.25rem`）；新增 `.quickforge-workflow-detail-row-plot` 与 `-axis-plot` 两层，用 **`margin`** 承担安全区；条形改 `position:absolute` + `box-sizing: border-box`；`.bar-value` 改 `right:0`、`.parallel-tag` 改 `left:0`。
  2. `WorkflowRunDetailContent.tsx`：轴与每行（含阶段头）插入 plot 层；耗时与「并行」从条形子元素**上移到绘图区直属子元素**。
  3. 对比稿 `docs/design/workflow-timeline-clip-fix.html`（极端情况 + 4 处成因表 + padding 陷阱说明）。
- 关键坑（已写入 CSS 注释）: **绝对定位的百分比基准是包含块的 padding box（含 padding）**，给轨道加 `padding` 当安全区会让 `left:0%` 仍从 border 内侧算起，条形直接压到左侧标签上。必须用独立 plot 层 + `margin`。
- 测试与 Evidence（验证）: `workflow-renderer.test.ts` 新增 5 条回归（条形 border-box、两个 pad 变量、plot 用 margin 走变量、bar-value right:0、parallel-tag left:0）；定向 workflow 两文件 **34 passed**；`tsc --noEmit` 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 阶段数 > 8 时折叠头刻度仍未做「3/8」降级；② 未做真实浏览器视觉验收；③ 未提交 Git。

---

## 当前交接：workflow-timeline-layout-fix（done，2026-10-23）

- Current Objective（当前目标）: 用户反馈时间轴「文字/条形太小」以及「还是显示不全」。两层原因已修复。**未提交、未创建 commit。**
- 结论（一句话）: ① SVG 的 `viewBox="0 0 1000 H"` + `width:100%` 会等比缩放整张图（含字号）；② 详情根节点缺 `flex:1`，宽度按内容收缩、`height:100%` 在父级 auto 时解析失败，`pane` 的 `overflow-y:auto` 失效导致内容被 `overflow:hidden` 裁掉。
- 改动:
  1. `WorkflowRunDetailContent.tsx` 的 `TimelineView` 从 SVG 重写为 DOM：轴（`.quickforge-workflow-detail-axis`）+ 行列表（`.quickforge-workflow-detail-rows`），每行 = 标签列 + 百分比轨道列，条形用内联 `left`/`width` 百分比，保底 `0.6%`。
  2. `src/index.css`：**详情根节点改为 `flex: 1 1 auto` + `min-width:0` + `min-height:0` + `max-height:100%`**（原只有 `height:100%`，这是「显示不全」的直接原因）；`--wf-tl-label` 改 `clamp(5.5rem, 30%, 9.5rem)`（窄屏 `clamp(4.5rem, 34%, 6.5rem)`）；条形从 `fill/stroke` 改 `background/border`，`.is-parallel` 改 `border-style: dashed`；字号走 `--quickforge-message-font-size` 基准。
  3. token 修复：`--quickforge-workflow-done` **从未定义**（9 处在吃 fallback 浅色绿）→ `:root` / `.dark` 定义 `--workflow-done` 并改名；14 处 `var(--quickforge-ease, …)` 是**错名**（正确为 `--quickforge-ease-out`）→ 全部改名。
  4. 对比稿 `docs/design/workflow-timeline-fix.html` 增加「容器约束」一节与示意图。
- 测试与 Evidence（验证）: `workflow-renderer.test.ts` 断言改为 DOM 契约 + 容器约束回归（根节点 flex/min-*、pane 滚动、clamp、`--workflow-done` 双主题、不含 `var(--quickforge-ease,`、不含 `viewBox={\`0 0 1000`）；定向 workflow 两文件 **34 passed**；`npm run test` 全量 **419 文件 / 4809 passed / 2 skipped**；`npm run lint` 0 error；`npm run build` 成功；`tsc --noEmit` 通过。
- 事故记录（重要）: 用 Python 改写 `src/index.css` 时，Windows 默认把整个文件从 LF 转成 CRLF，导致 9 个依赖 `\n` 正则的源码契约测试全部失败。已字节级恢复为纯 LF。**本项目 `src/index.css` 必须保持 LF**；用脚本写该文件需显式 `newline=''` 或写后统一换行。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 条形过窄时右侧耗时文字可能与其他行重叠，可改 hover 显示或固定列；② 阶段数 > 8 时折叠头刻度仍未做「3/8」降级；③ 未做真实浏览器视觉验收；④ `src/App.tsx` 的 `workspaceInspectorOpenScopeId`（面板开合按 runtimeScope 派生）是更早会话的未提交改动，本轮未动；⑤ 未提交 Git。

---

## 当前交接：workflow-inspector-panel（done，2026-10-23）

- Current Objective（当前目标）: 用户先要 workflow 卡片的设计稿，再要求「点击在右边打开」。方案落地为**聊天卡入口化 + 右侧 Inspector 三视图详情**。**已完成**，未提交、未创建 commit。
- 结论（一句话）: 聊天区只剩一行入口（摘要 + 阶段刻度 + 耗时 + 打开态），明细统一进右侧 Inspector：时间轴答「串行还是并行」、阶段答「跑到哪了」、日志答「为什么卡住」。
- 根因: ① 内联展开与右侧详情是同一份数据的两套布局，长跑必然漂移（原实现已有 `×0.8` 字号补偿补丁），且 5 阶段 + 12 工具会挤成 1400px 长条；② `seq` + `startedAt` + `durationMs` 数据本来就有，但平铺列表画不出并行关系，而并行正是 `parallel()` / `pipeline()` 的核心语义。
- 改动:
  1. `src/lib/workflow-run-detail.ts`：`WorkflowToolView.startedAt`、`WorkflowRunView.runStartedAt/maxAgents/maxTools/concurrency/maxRuntimeMs`；新增 `workflowTimeline(view)`（甘特条目 + 并查集聚合并行组 + 扫描线并发峰值 + `savedMs`；缺 `startedAt` 按 `seq` 顺延，`totalMs` 恒 ≥ 1）。
  2. 新增 `src/lib/workflow-run-payload.ts`：payload / store / `shouldPublishWorkflowRunPayload` / `normalizeOpenWorkflowRunRequest` / `OPEN_WORKFLOW_RUN_EVENT` / `activeWorkflowRunStore`。
  3. 新增 `src/components/workspace/WorkflowRunDetailContent.tsx`：时间轴（SVG 甘特，条形高度即层级、并行虚线 + 文字第二编码）、阶段（Agent 卡「运行详情 ↗」跳 subagent Tab）、日志（相对时间戳 + 阶段标签）；底部脚本体/结果抽屉。
  4. `workflow-tool-renderer.tsx` 重写为单行 `<button class="quickforge-workflow-card">`，删除全部内联展开体。
  5. tab 体系加 `workflow` kind（5 处类型/分发/持久化）+ `useInspectorLayout` 自动拉宽 + `App.tsx` 事件监听。
  6. `i18n.ts` 24 组文案；`index.css` 删 268 行内联样式、新增约 900 行入口卡与详情面板样式。
- 测试与 Evidence（验证）: `tests/frontend/workflow-renderer.test.ts` 26 例（`workflowTimeline` 5 例、payload store 3 例、详情面板契约 2 例）、`tests/frontend/workflow-step-interaction.test.ts` 重写 8 例（单行入口 / 点击派发 / 已打开联动 / 终态不回退）；定向 3 文件 **40 passed**；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run test` 全量 **4806 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**；`npm run build` 成功。
- 文档: `docs/wiki/src/lib/README.md`（`workflow-run-detail.ts` 字段与 `workflowTimeline`、新增 `workflow-run-payload.ts` 条目、渲染器/样式契约段重写）、`docs/wiki/src/components/README.md`（两处同步新增 `WorkflowRunDetailContent.tsx` 小节）；设计稿 `docs/design/workflow-run-panel.html`、`docs/design/workflow-execution-model.html`（本轮之前的分析稿）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 真机视觉验收——甘特图观感、340px 窄面板下标签列换行、深色模式对比度；② 阶段数 > 8 时折叠头刻度会溢出，需「3/8」文本降级；③ 时间轴标签列在窄面板可改为两行省略或收起为图标；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：workflow-result-no-truncation（done，2026-10-22）

- Current Objective（当前目标）: 用户质疑「workflow 为什么结果会截断」，要求「里面是多少就返回多少」。确认范围为 **①②③ 全去掉**（正文 / 工作流结果预览 / agent·tool 步骤预览），超长结果**信任 auto-compact 兜底**。**已完成**，未提交、未创建 commit。
- 结论（一句话）: `run_workflow` 的返回值与 Inspector 预览不再有任何字符截断；`truncateText` 只留给错误文本与失败摘要。
- 根因: `runner.mjs` 切的是 `JSON.stringify` 之后的文本，可能落在字符串/括号中间，模型既不知道被截断（`<workflow_result>` 无提示）也无法 `JSON.parse`，等于静默交付半截数据。
- 改动:
  1. `server/agent-workflow-runner.mjs`：删 `AGENT_RESULT_PREVIEW_LIMIT` / `TOOL_ARGS_PREVIEW_LIMIT` / `TOOL_RESULT_PREVIEW_LIMIT` / `WORKFLOW_RESULT_PREVIEW_LIMIT` / `CONTENT_RESULT_LIMIT`；`completeWorkflow` 写完整 `resultJson`；`buildDetails.resultPreview` 全量、无 `resultTruncated`；`agentRecordPayload` 的 prompt/context/expectedOutput/result 全量、无 `promptTruncated`；`toolRecordPayload` 始终发结构化 `args`、无 `argsPreview`；`normalizeToolRequest` 删只为截断服务的 `argsJson`。
  2. `src/lib/workflow-run-detail.ts`：删 `WorkflowToolView.argsPreview` 与 `WorkflowRunView.resultsTruncated`。
  3. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：摘要与详细 input 只走 `tool.args`；结果区去掉「· 已截断」。
  4. `src/lib/i18n.ts`：删 `workflowResultTruncated` 中英各一条。
- 测试与 Evidence（验证）: `tests/server/agent-workflow-runner.test.mjs` 新增 2 例（120,000 字符结果原样返回且可 `JSON.parse`；6,000 字符 prompt/结果、9,000 字符 description 全量保留且无 truncated 标记）；`tests/frontend/workflow-renderer.test.ts` i18n 键清单去掉 `workflowResultTruncated`。定向 53 passed；全量 `npm run test` 通过；`npm run lint` 0 error；`npm run build` 成功。
- 文档: `docs/architecture/workflow-orchestration.zh-CN.md`（上限表、details 字段表、7.2、7.3）、`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/lib/README.md`。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 单条 toolResult 最大 1 MB（≈250k tokens），auto-compact 80% 阈值触发前若已超 provider 上限会直接报错——按用户决定本轮不做前置保护，真机遇到需前移阈值或加软预算；② 运行中帧的 `resultPreview` 也全量随 200ms 节流推送，超长结果下流式帧明显变重，未做「运行中推摘要、终态推全量」分层；③ `docs/design/workflow-tool-redesign.html:856` 仍写「结果 · 已截断」，属历史设计稿未改；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：live-present-auto-preview（done，2026-10-22）

- Current Objective（当前目标）: 用户反馈「切换 session 时左边侧边栏总是自动打开」，要求先调研。调研确认现象实际是**右侧 workspace 面板/预览被自动打开**；用户要求「方案最佳、不考虑历史包袱、保证产品体验、不要打补丁」，并按推荐方案 **live 事件驱动** 落地。**已完成**，未提交、未创建 commit。
- 结论（一句话）: 自动预览从「消息状态差分」换成「live 事件驱动」——`ChatPanelHost` 在 `tool_execution_end` 时抽取该次执行自己产出的文件，只由当前活跃视图上报；历史 `present_files` 永远不进入这条路径，切换会话不再弹面板。
- 根因: 附着时刻把 `agent.state.messages` 全部 toolResult 的 toolCallId 记成历史快照，再用 `isNewlyPresentedArtifact` 判差集。会话打开快路径（`20227ad`）后 messages 只是尾部 200 条窗口（`server/routes/session-view.mjs:19,140`），首帧后 `hydrateFullHistory` 补齐全量并整表替换（`server-agent.ts:2138-2163`），更早的 `present_files` 的 toolCallId 不在快照中 → 被当成新产物 → 自动开面板。凡 >200 条且历史含 `present_files` 的会话切入即弹。差分对窗口化/缓存校准/SSE 重连/回滚都不可能收敛。
- 改动:
  1. `src/lib/tool-artifacts.ts`：新增 `extractToolExecutionArtifacts(event)`——单次 `tool_execution_end` 经 `upsertToolResult` 组装成伪 toolResult，复用 `extractArtifactsFromMessages`；无 toolCallId/result 返回空。
  2. `src/components/chat/ChatPanelHost.tsx`：新增 prop `onLivePresentArtifacts(sessionId, artifacts)`；`tool_execution_end`（`!sideChatMode`）计算 live 产物，仅 `isSessionViewActive(agentRuntimeScopeId ?? agent.sessionId)` 为真时经 `propsRef` 上报（后台保活会话不抢面板）。
  3. `src/App.tsx`：删除差分链路（附着快照 effect、自动预览 effect、`autoPreviewHistoryRef`、`autoPreviewSignatureRef`、切项目签名重置），改为 `openLivePresentedArtifacts`（校验 sessionId + projectId，`findBestPreviewableArtifact` 后按 reader/document/browser 分流 `requestWorkspaceInspector`），并传入 `onLivePresentArtifacts`。
  4. `src/components/workspace/artifact-preview-utils.ts`：删除 `collectToolResultToolCallIds` / `isNewlyPresentedArtifact`；保留 `presentArtifacts` / `findBestPreviewableArtifact`（产物列表与 live 回调共用）。
- 测试与 Evidence（验证）: `tests/frontend/auto-preview-fresh-present.test.ts` 重写为 live 事件契约（抽取/内容兜底/无 toolCallId/不可 present 工具、预览优先级、3 条源码契约断言含「App.tsx 不得含 autoPreviewHistoryRef 等」）；定向 `npx vitest run` 该文件 + `assistant-artifact-card` → **29 passed**；`npm run lint` **0 error**；`npm run build` 成功；`npm run test` 全量通过。
- 文档: `docs/wiki/src/components/README.md`（:681 与 :64 相关表述）、`docs/wiki/src/README.md`（「附着后新 present_files 自动预览」→「live present_files 自动预览」）、`docs/wiki/src/lib/README.md`（`tool-artifacts.ts` 小节改写自动预览口径）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 真机确认——切到 >200 条且含 `present_files` 的历史会话，右侧面板保持关闭；agent 本轮真的 `present_files` 仍自动弹；后台会话跑完 `present_files` 不弹。② 跨窗口抑制未做（`isSessionViewActive` 是单页内信号，跨窗口由 `sessionId === currentSessionId` 校验兜住）。③ 侧栏 `ChatSidebar` 未改：调研确认它没有随 session 变化的打开路径（`sidebarOpen` 只有 `useState(true)` + 手动 toggle，无持久化、无相关 effect），若用户仍看到左栏变化，需另查整树 remount（`ErrorBoundary` 重试 / 整页 reload）。④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：workflow-tool-row-hierarchy（done，2026-10-22）

- Current Objective（当前目标）: 用户指出「工作流 tools 显示本来就是 tools 内部的行为，应该更有层级感」，要求先出 HTML 设计稿。对比稿给出三档（现状 / 方案 A 缩进+细连接线+弱化 / 方案 B 再折成工具组），用户选 **方案 A** 并落地。**已完成**，未提交、未创建 commit。
- 结论（一句话）: 阶段内连续的 `tool()` 调用从「与 Agent 平铺的步骤行」下沉为「Agent 之下带缩进 + 1px 连接线的工具区」，工具行字号/颜色再降一档；Agent 行主文案由状态换成任务名，状态退到悬停/aria 与状态区。
- 改动:
  1. `src/lib/workflow-run-detail.ts`：新增 `WorkflowPhaseStep`（`agent` | `tools`）与 `workflowPhaseSteps(phase)`——先按 `seq` 排序，再把**连续**的 `tool()` 折叠成单个 `tools` 步骤（只按连续性判断，不推断归属）。
  2. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：用 `workflowPhaseSteps` 替代内联排序；工具步骤渲染成 `li.quickforge-workflow-tool-zone > ul.quickforge-workflow-tool-list`；紧跟 Agent 的工具区带缩进与连线，阶段开头无可归属 Agent 的加 `--root` 去掉缩进与连线（不留悬空连接线）。阶段头改为「阶段名 + `workflowStepCount` 步数 + 渐隐细线」。
  3. `src/lib/tool-renderers/subagent-tool-renderer.tsx`：`SubagentRunSummaryOptions` 新增可选 `label` / `labelClassName`（`run_subagent` 不传，行为零变化）；workflow Agent 行传 `agent.label`，running 时把 `quickforge-tool-running-sweep` 挂到任务名。
  4. `src/index.css`：新增 `.quickforge-workflow-tool-zone`（0.375rem 左缩进 + 0.625rem padding + `1px` `border 60%` 连接线）、`--root`、`.quickforge-workflow-tool-list`、工具行 `×0.75` 与 muted 78%、图标弱化/hover 强化、`@media (hover: hover)` 下 chevron 默认透明、Agent 主行 500 + foreground 84%（`:not(.quickforge-tool-running-sweep)` 保护流光与 reduced-motion 回退）、`.quickforge-workflow-phase-*`。
  5. `src/lib/i18n.ts`：新增 `workflowStepCount` 中英各一条。
- 测试与 Evidence（验证）: 定向 `npx vitest run` 8 文件 **242 passed**（workflow-renderer 18 / workflow-step-interaction 5 / chat-surface-css-contract 37 / local-tool-running-sweep / motion-design / process-folding / subagent-run-detail / decorator-copy-i18n）；全量 `npm run test` → **418 文件 4790 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.53s）。新增断言不是放宽：Agent 主文案从「状态在首位」改为「任务名在首位且状态仍在 `title`」，另加 3 例结构/分组单测与 1 条 CSS 层级契约。
- 文档: `DESIGN_LANGUAGE.md` 第 106-111 节补一句「run_workflow 复用同配方，阶段开头的 root 工具区不缩进不画线」；`docs/architecture/workflow-orchestration.zh-CN.md` 的 7.2 / 7.3 / 样式段 / i18n 键清单同步；`docs/wiki/src/lib/README.md` 的 `workflow-run-detail.ts` 与渲染器契约段改写。设计稿保留在 `docs/design/workflow-tool-hierarchy.html`（已标注「已落地」）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 真机目视——展开工作流后确认窄列下 Agent 任务名与工具行参数各自省略正常、深色主题连接线不过重、running 时任务名流光与工具行流光共存；② 工具区归属是「按时间连续」推断，若将来一个 Agent 中间插入别的 Agent 的工具调用会被拆成两段（当前 runner 顺序提交，不会发生）；③ 方案 B（连续工具折叠成「工具调用 · N」组）未实现，需要时按设计稿右栏做；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：tool-stage-expand-fixed（done，2026-10-22）

- Current Objective（当前目标）: 用户要求「工具调用列表默认展开，我希望默认就是这样的，设置里面不需要再有了，相关代码也固化」。**已完成**，未提交、未创建 commit。
- 用户决策: ① 手动收起**保留**（saved state 仍优先于默认值）；② 流式思考行按 **A 方案**（删除 split、留在 stage 内，零视觉变化，不做 B 方案的缩进微调）。
- 结论（一句话）: 「内层 stage 默认展开」从设置项 `tool-display-settings.expandProcessStageByDefault` 降级为渲染常量 `PROCESS_STAGE_DEFAULT_EXPANDED = true`，设置页开关、i18n 文案、装饰层的设置读取与流式思考行 split 分支一并删除。
- 改动:
  1. `src/lib/tool-display-settings.ts`：删 `expandProcessStageByDefault`（类型、默认值、归一化重建）；`normalizeToolDisplaySettings` 把它并入 legacy 丢弃清单，老用户存过的 `false` 自动失效，不迁移不清洗。文件 63 → 60 行。
  2. `src/components/chat/panel-decoration/process-folding.ts`：新增导出常量 `PROCESS_STAGE_DEFAULT_EXPANDED = true` 取代 `processStageDefaultExpanded()`；`updateProcessStageGroups` 直接传常量；删除 `isStreamingThinkingItem` / `splitStreamingThinkingRuns` / `ProcessStageSectionRun`，`populateProcessGroup` 去掉 `detachStreamingThinking` 分支（每段含工具行就聚合成一个 stage，结构恒定）；删掉该文件对 `@/lib/tool-display-settings` 的 import。`resolveProcessExpandedState` 与 CSS 收起态保留。
  3. `src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`：删 state / ref / loadSettings 回填 / `updateExpandProcessStageByDefault` / `saveToolDisplayOptions` 入参 / 整行 UI。
  4. `src/lib/i18n.ts`：删 `expandProcessStageByDefault(+Description)` 中英各 2 条共 4 条。
- 测试与 Evidence（验证）:
  - 定向 `npx vitest run` 9 文件 **124 passed**（process-folding 45 / thinking-streaming-stage 8 / process-folding-incremental 9 / settings-normalizers 9 / default-options-settings-react 13 / default-options-settings-tab 5 / chat-surface-tool-message 10 / process-folding-ownership 18 / decorator-copy-i18n 7）。
  - 全量 `npm run test` → **418 文件 4786 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功。
  - 测试迁移不是放宽断言：`process-folding.test.ts` 的开关用例改成「常量恒 true + saved state 双向优先」；`thinking-streaming-stage.test.ts` 的 S2/S3 合并为恒展开、跨轮次/流式结束断言由 `false` 翻 `true`；`settings-normalizers.test.ts` 把该字段纳入 legacy 丢弃断言（true 与 false 两种老值都不进结果）。
- 文档: `docs/wiki/src/lib/README.md`（tool-display-settings 小节整段改写 + 行数 40→60）；`docs/wiki/src/components/README.md` 的 process-folding 两处重复小节同步；`docs/wiki/src/README.md` 的「通用」页包含项去掉该开关。`DESIGN_LANGUAGE.md` 无该词无需改；`CHANGELOG.md` 留到发布时。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 真机冒烟——展开过程组后工具行直接可见；手动收起某个 stage，流式追加工具行时不被弹回；② 老用户升级后如果曾关过该开关，行为统一变为展开（不可逆偏好覆盖，已记录在 feature boundaries）；③ 改动在 `perf/zero-ux-streaming-hotpath` 分支与既有未提交改动同处工作区，等待用户决定是否 commit；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：todo-summary-expand-and-retire（done，2026-10-22）

- Current Objective（当前目标）: 用户要求 ① 回合结束且 todolist 全完成时清除不显示；② todo 默认展开；③ 完成/运行/待执行三态清晰表达。**已完成**，未提交、未创建 commit。用户明确表示「我自己验证」，所以未做浏览器视觉验收。
- 设计决策（用户已确认）: 「对话结束」= 回合结束且全完成即移除；退休后彻底不显示（只能翻历史工具卡）；顶部置顶摘要只统一三态图标、不移除。实现用 A 方案：退休判定读前端已有的 `!snapshot.isStreaming`，不改服务端 SSE 契约。
- 结论（一句话）: 退休判定是 `shouldRetireTodoSummary({ todos, idle })`，`idle` 取 `!snapshot.isStreaming`（状态而非一次性事件），摘要默认展开、全完成且 idle 时淡出卸载，三态图标/文案收敛到 `src/lib/todo-status*` 单一来源。
- 改动文件:
  1. 新增 `src/lib/todo-status.ts`（`TodoStatus`、`TODO_STATUS_LABEL_KEY`、`TODO_STATUS_GLYPH_CLASS`、`todoStatusLabel()`）与 `src/lib/todo-status-icon.tsx`（`TodoStatusIcon`，`useId` 生成 mask id）。两个文件是为了避开 `react-refresh/only-export-components`。
   2. `src/components/chat/panel-decoration/todo-write-summary.ts`：新增 `shouldRetireTodoSummary()`；`TodoWriteStatus` 变成 `TodoStatus` 别名，`TODO_WRITE_STATUS_LABEL_KEY` 改为再导出别名。
  3. `src/components/chat/surface/TodoWriteSummary.tsx`：默认展开、按 snapshot key 重置为新展开并更新「已更新」标记、`retiredKey` 按 snapshot key 记账 + 派生 `fading`（不在 effect 内 setState）、`data-fading` + `inert`、140ms（`--quickforge-dur-exit`）后卸载、（展开体只有列表：chips 与「正在：」行都已按用户反馈删除）、共享 `TodoStatusIcon`。
  4. `src/components/chat/surface/ChatSurface.tsx`：只传 `idle={!snapshot.isStreaming}`。早期版本用 `turnEnded` state（由 `agent_end` 置位）实现，实测刷新/切会话后不触发导致清单常驻，已改为状态谓词并删除该 state。
  5. `src/components/git/GitToolsPinnedSummary.tsx` / `src/lib/tool-renderers/todo-write-tool-renderer.tsx`：改用共享图标与 label 映射，`GitToolsPinnedSummary` 移除 lucide `Clock3`/`Circle`（`CheckCircle2` 仍被 subagent 行使用），渲染器删除模块级 mask 计数器与本地 `todoHistoryStatus*`，第三套实现清零。
  6. `src/index.css`：TodoWrite 段 token 化（`--quickforge-dur-*` / `--quickforge-ease-out`）、删 `nth-child` 阶梯延时、新增 in_progress 行底与 500 字重 / `data-fading` 退出 / `@starting-style` 进入 / `.quickforge-todo-glyph--*` 共享配色；进行中图标改为「暗底环 + 1/4 弧旋转」（`.quickforge-todo-spin-arc`），reduced-motion 关闭旋转。历史卡不旋转（历史快照里的进行中项不是正在运行）。
   7. `src/lib/i18n.ts` 本轮最终没有新增 key（chips 与「正在：」行的键随功能删除，保持中英键集一致）；`tests/frontend/todo-write-summary.test.ts` 重写、`tests/frontend/todo-write-renderer.test.ts` 改为断言消费共享映射；wiki（`docs/wiki/src/components/README.md` 两处重复段落 + `docs/wiki/src/lib/README.md` 新增小节）、`CHANGELOG.md`、`feature_list.json`、`progress.md` 已同步。
- 验证: 定向 `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts tests/frontend/git-tools-pinned-summary.test.ts` → 3 文件 **65 passed**；全量 `npm run test` → **418 文件 4786 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` 的 `react-hooks/exhaustive-deps` warning）；`npx tsc -b` 通过；`npm run build` 成功。
- Blocker: 无。（本轮早期全量测试出现过的 7 个 `expandProcessStageByDefault` 失败属既存问题，已由后续 `tool-stage-expand-fixed` 一轮修复，现全量全绿。）
- Next Session（下一步）: ① 用户自行做浏览器视觉验收（dev server 5176 / 32176 被既有实例占用，我这轮无法启动；MCP 打开报 `QuickForge local service is unavailable`）；② 若要验证退休边界，重点看「`agent_end` 为 error/aborted 或仍有 pending/in_progress 时摘要保留」「下一轮新快照自动恢复展开」；③ 未提交，需要时再走发布流程。

---

## 当前交接：remove-design-mockups-dir（done，2026-10-22）

- Current Objective（当前目标）: 用户判断 `design-mockups/` 全是临时产物，要求整目录清空、不留档。**已完成**，未提交、未创建 commit。
- 改动:
  1. 删除 `design-mockups/` 整目录（14 个 HTML，约 320KB）；本轮早先已单独删掉未定稿草稿 `turn-error-composer-strip.html` 与 16 个根目录 `tmp-*`/`.tmp-*` 临时文件。
  2. `feature_list.json`：两处 `files` 数组移除 `design-mockups/*` 条目（JSON 解析校验通过）。
  3. `progress.md` / `session-handoff.md`：设计对比稿表述改为「已随后续整体删除，规格以 `DESIGN_LANGUAGE.md` 为准」。
  4. 非归档引用全部去路径：`src/index.css` 6 处、`src/components/chat/{command-suggestions.ts,slash-invocation-chip.ts,panel-decoration/{ask-user-card.ts,message-actions.ts,turn-error-row.ts}}`、`src/lib/{input-clamp.ts,tool-renderers/todo-write-tool-renderer.tsx}`、`docs/wiki/src/{components,lib}/README.md`，改为纯文字规格描述或直接省略。
- 验证: `npx eslint` 改动 TS 文件 0 error；`npx tsc -b` 通过；定向 vitest（message-actions / todo-write-renderer / slash-invocation-chip / thinking-level-control）4 文件 87 passed；`npm run build` 通过。
- 边界: `docs/archive/*` 三个归档文件保留原有 `design-mockups/` 路径不回改（归档即当时状态）；未改 `.gitignore`；未触碰生成产物。
- Next Session（下一步）: 无待办。后续新增设计稿建议直接放在临时目录或本轮用完即删，不再进主仓库。

---

## 当前交接：fix-thinking-level-menu-clipped（done，2026-10-22）

- Current Objective（当前目标）: 用户反馈「对话中思考等级没法选择」。**已修复**，未提交、未创建 commit。
- 根因（一句话）: `decb5d6` 装饰层渲染化把思考菜单从 `document.body.append` 的原生 DOM 改成渲染进组件树内部，但样式仍是 `position: fixed` + 视口坐标 —— 输入框卡片的 `backdrop-filter` 让卡片成为 `fixed` 后裔的包含块，`overflow: hidden` 再把菜单裁掉。
- 改动:
  1. `src/components/chat/surface/ThinkingLevelControl.tsx`：菜单改 `createPortal(..., document.body)`；测量 effect 换 `useLayoutEffect`（避免首帧在离屏位置闪现）；新增「上方空间不足时翻到触发器下方」翻转逻辑。
  2. `src/components/chat/surface/ChatSurface.tsx`：`ThinkingLevelControl` 的 `disabled` 改为 `composerControlsDisabled || leaseObserver`，与同行 `+`/模型/Access 控件对齐。
  3. `tests/frontend/thinking-level-control.test.ts`：新增 `expect(menu()!.parentElement).toBe(document.body)`，钉死 portal 前提。
  4. `docs/wiki/src/components/README.md`：两处描述改为 `surface/ThinkingLevelControl.tsx`、正确渲染条件 `enableThinkingControl && snapshot.model?.reasoning === true`、以及菜单必须 portal 到 body 的原因。
- 验证: 定向 vitest 4 文件 82 passed；全量 `npm run test` → 418 文件 4779 passed / 2 skipped；`npx eslint` 改动文件 0 error；`npx tsc -b` 通过。
- 未处理（明确记录的下一步）: 若会话持久化的 model 仍是 `reasoning: false`（自定义供应商未勾推理模型 / 老会话快照过时），`ChatSurface.tsx:1523` 的严格 `=== true` 会让按钮整体不渲染。修法是「加载会话时对持久化 model 做一次 `resolveConfiguredModel`」（`src/hooks/useAgentManager.ts:238` 已有该工具，但只在 create 路径调用，load/restore 路径没调）。本次未动，属独立问题。

---

## 当前交接：remove-default-model-thinking-level（done，2026-10-22）

- Current Objective（当前目标）: 用户要求「移除设置里面默认选择的模型和思考等级，完全取决于最近一次用户选择的模型和思考等级」。**已完成**，未提交、未创建 commit。
- 做法（一句话）: 删掉 `settings['default-options']` 这套「默认值」，模型沿用既有 `active-model`，思考等级新增 `active-thinking-level`，新会话一律走「最近一次选择」。
- 改动:
  1. `src/lib/pi-chat.ts`：删 `DEFAULT_OPTIONS_SETTING_KEY` / `DefaultOptions` / `StoredDefaultOptions` / `saveDefaultOptions` / `loadDefaultOptions`（及随之无用的 `ModelReference` 类型导入）；新增 `ACTIVE_THINKING_LEVEL_SETTING_KEY='active-thinking-level'`、`saveActiveThinkingLevel()` / `loadActiveThinkingLevel()`、`resolveNewSessionThinkingLevel(model, saved)`、`loadLastUsedSessionOptions()`。
  2. `DefaultOptionsSettingsTab.tsx`：删「默认模型」「默认思考等级」两行与全部配套代码（models/selectedModel/thinkingLevel state、三个 ref、`updateModel`/`updateThinkingLevel`/`saveDefaultModelOptions`、`modelKey`/`findModelByValue`/`resolveDefaultModel`、`THINKING_OPTIONS`、`loadModelCatalog`/`modelLabel`/`getSelectableConfiguredModels`/`mergeAvailableModels` 引用）。「基础」组仅剩语言。
  3. 消费方：`useAppBootstrap.ts`（`chooseStartupModel` 去掉 `preferredModel`）、`useAgentManager.ts`（`createAgent`/`startDeferredSession`）、`ScheduledTasksPage.tsx`、`GitCommitPushDialog.tsx`（改 `loadLastUsedSessionOptions`）、`AgentProfilesPage.tsx`（顺带删无用的 `sameModelIdentity` 导入）、`server/acp/server.mjs resolveInitialThinkingLevel`（读 `active-thinking-level`，兼容 raw JSON 与已解码两种存储形态）。
  4. `ChatPanelHost.tsx`：思考等级下拉切换时补写 `active-thinking-level`（原先只写会话级 `thinkingLevel`），这是「最近一次」被记住的唯一新写入点。
  5. `i18n.ts` 删 5 个 key 中英各一份并改写 `defaultOptionsDescription`；`settings-tabs.ts` 搜索关键词去掉「模型/思考」。
- 回退规则: 非推理模型强制 `off` → 否则用已记住的等级 → 从未记录过才回落推理模型 `high`（与旧 `defaultThinkingLevelForModel` 一致）。
- 测试与 Evidence（验证）:
  - 新增 `tests/frontend/pi-chat-thinking-level.test.ts`（5 例：active-thinking-level 往返 / 非法值归一与拒读 / 推理模型复用已选等级 / 从未记录回落 high / 非推理强制 off）。
  - `tests/server/acp/server.model-visibility.test.mjs` 新增「新 ACP 会话复用 active-thinking-level」1 例（含 raw JSON 与已解码两种存储形态）。
  - `tests/frontend/default-options-settings-tab.test.ts` 改为「不再渲染 defaultModel/defaultThinkingLevel」负向断言；`default-options-settings-react.test.ts`、`use-app-bootstrap-{snapshot,migration}.test.ts`、`scheduled-tasks-page.test.ts` 的 pi-chat 桩换为 `loadActiveThinkingLevel` / `resolveNewSessionThinkingLevel`。
  - 全量 `npx vitest run` → **418 文件 4779 passed / 2 skipped**（exit 0）；`npm run lint` → **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` → 通过；`npm run build` → 成功（3.40s，仅既有 chunk 体积 warning）。
- 已知取舍 / Notes:
  - 旧数据里的 `settings['default-options']` 不再读写但**不主动删除**，保留回滚空间；不迁移、不清洗（不影响运行）。
  - 老用户首次升级后，若从未在新版本里动过思考等级下拉，`active-thinking-level` 为空 → 推理模型回落 `high`、非推理 `off`，即旧版默认行为；之后完全跟随最近一次选择。
  - `loadLastUsedSessionOptions()` 与 `resolveNewSessionThinkingLevel()` 是唯一语义出口，后续新增消费方请复用，不要各自重判 `reasoning`。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机冒烟——① 把思考等级从高改成低 → 新建对话应直接是低；② 换模型后新建对话应保持该模型；③ 非推理模型新建对话为「关」；④ 定时任务/Git 提交信息生成默认值跟随最近一次；⑤ ACP 客户端新建会话 Thinking Level 跟随最近一次。改动与既有未提交改动同处工作区，等待用户决定是否 commit。

---

- Current Objective（当前目标）: 用户表示「当前项目暂时不支持生成图片」，要求移除 `generate-image-tool-renderer` 相关代码；经 AskUser 确认采用「前后端全删」方案——session-assets 只读路由与存储清理保留。**已完成**，未提交、未创建 commit。
- 改动:
  1. 删除文件：`server/image-generation.mjs`、`src/lib/tool-renderers/generate-image-tool-renderer.tsx`、`src/lib/generated-image-assets.ts`、`tests/server/image-generation.test.mjs`、`tests/frontend/generated-image-assets.test.ts`。
  2. 服务端：`server/tools/index.mjs` 移除 handler 注册与导入；`server/routes/tools.mjs` 移除 `directRouteDisabledTools` 条目；`server/session-assets.mjs` 删除 `writeSessionAsset` 写入路径（read/delete 与 `/api/session-assets`、分享资产路由保留，历史图片文件仍可经 API 读取）。
  3. 前端：`local-tools.ts` / `tool-renderers/index.ts` 移除注册与导出；`i18n.ts` 删除中英各 5 组词条（generateImage/generatingImage/generatedImageAlt/openGeneratedImage/downloadGeneratedImage）；`index.css` 移除 `.quickforge-generated-image-tool` 选择器与注释；`approval-card.ts`、`process-folding.ts`、`shared.tsx`、`tool-param-summary.ts` 移除 generate_image 特判。
  4. 测试：approval-card / process-folding / tool-param-summary / chat-surface-css-contract / definitions / session-assets 六个文件同步更新（session-assets 夹具改直写文件）。
  5. 文档：user-guide zh/en 删除「图片生成」小节；docs/wiki（server/tools、server、src/lib、src/components、src）与 docs/architecture/session-open-fast-path.zh-CN.md 更新。
- 行为变化（已知取舍）: 历史会话中的 `generate_image` 工具结果回落默认工具卡兜底渲染（无图标/摘要特判）；前端不再有查看/下载入口，但资产 API 仍可读，永久删除会话时文件仍同步清理。
- 测试与 Evidence（验证）: 定向 vitest 6 文件 125 passed；`npx tsc -b` 通过；`npx eslint src server tests` 通过；全量 `npm run test` → 417 文件 4773 passed / 2 skipped（首轮 `local-tool-running-sweep` 1 例偶发失败，单文件与复跑全量均通过，属既有并行抖动，非本次改动引入）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 改动在 `perf/zero-ux-streaming-hotpath` 分支与既有未提交改动同处工作区，等待用户决定是否 commit 及提交范围。未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：streaming-decorate-hotpath（done，2026-10-22）

- Current Objective（当前目标）: 用户要求分析界面卡断原因并确认「**不改变现有产品体验和交互**」（零外观/交互/时序反馈变化）后，在新分支 `perf/zero-ux-streaming-hotpath` 落地流式输出期间的装饰热路径优化。**已完成**，未提交、未创建 commit。
- 根因（一句话）: 流式期间每个 `message_update`（server 50ms 合并、客户端约 20 帧/s）都触发**完整** `decorateMessages`——618 行会话实测单次 12–17ms，即流式期间每秒 240–340ms 花在装饰主线程；而 pass 中绝大部分内容在回合内不变，只有过程折叠需要每帧对账。CSS 非主因：`.user-message-container` 的 `backdrop-filter: blur(10px)` 在不透明背景下无可见差异，却为每条用户消息建一个合成层。
- 改动:
  1. 新增 `src/components/chat/panel-decoration/decorate-scheduler.ts`：每帧最多一次装饰，`streaming`/`full` 两档，同帧 pending 的 full 覆盖 streaming，`cancel()` 丢弃 pending。
  2. `src/components/chat/panel-decoration/message-actions.ts` 新增 `decorateStreamingMessages(panel, messageRows?, isStreaming?)`：只跑 `decorateProcessBlocks`（过程折叠/thinking hint 对账）+ `scrollBottomButton.setup()`（内容增长可在用户无滚动时跨过回底阈值，无 scroll 事件，必须每帧调）；接受宿主传入的已提交行快照并追加流式行，不做行级装饰。`panel-decoration.ts` barrel 同步导出。
  3. `src/components/chat/ChatPanelHost.tsx`：行枚举改 `createMessageRowSnapshot`（完整 pass 开始 invalidate、pass 内复用；流式档直接拿快照）；事件订阅按 `event.type === 'message_update' && agent.state.isStreaming` 分档为 streaming，其余（message_start/end、turn_end、agent_end、工具边界、messages_replaced、props 变更、MutationObserver、视图重新激活）仍走 full；清理时 `decorateScheduler.cancel()`。
  4. `src/index.css`：移除 `.user-message-container` 的 `backdrop-filter: blur(10px)` 与 `-webkit-backdrop-filter`。
- 测试与 Evidence（验证）: 新增 `tests/frontend/decorate-scheduler.test.ts`（5 例：合并/覆盖/单独跑/再排帧/cancel）与 `tests/frontend/streaming-decoration.test.ts`（jsdom，3 例：流式行追加不做行级装饰、接受缓存行快照、非流式不追加）。全量 `npm run test` → **419 文件 4783 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc --noEmit` 通过；`npm run build` 成功。
- 文档: `docs/architecture/session-open-fast-path.zh-CN.md` 新增「M5：流式装饰热路径（已实施，2026-10-22）」章节（问题、观察、实现表、行为等价性、blur 移除、遗留项）；`docs/wiki/src/components/README.md` 的 ChatPanelHost 小节——注意该文件内 ChatPanelHost 小节**完整重复出现两次**（约 line 153 与 478），两处已同步加装饰调度两档说明。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 可选后续优化（用户未要求，勿擅自扩大）：`tool_execution_update` 服务端合并/前端分档、流式 Markdown 增量解析、窗口化等价改造；② 建议做一次真实浏览器流式 A/B（longtask 基线）确认收益；③ 改动在 `perf/zero-ux-streaming-hotpath` 分支未提交，等待用户决定是否 commit；④ 未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：dsh-trajectory-design（done，2026-10-22）

- Current Objective（当前目标）: 只读调研 **DSH（DeepSeek Harness）会话轨迹（trajectory / session log）的存储与事件设计**，供 QuickForge Goal/会话轨迹对标参考。纯调研，**未改任何代码/文档/wiki**（调研结论沉淀在本交接，非架构变更，无需同步 docs/wiki）；未提交 Git。
- 结论（DSH 轨迹设计一句话）: **追加式 zstd 多帧 JSONL 事件日志**——`~\.dsh\sessions\<workspace-slug>\<sessionId>\session.v4.jsonl.zstd`，每次 append 写一个独立 zstd 帧（帧内 1..n 行 JSON），事件信封 `{type, seq, time, data, surfaceOp?, sourceEventSeqs?}`，seq 从 0 连续递增（实测 12 会话 0 gap）；恢复即顺序重放。
- 解压要点（避坑）: 整个文件是**多帧 zstd 拼接**，`zlib.zstdDecompressSync`/流式解压都只吐第一帧；必须按 zstd magic `28 B5 2F FD` 切帧逐帧解压再拼接（最大会话 3.7MB = 2671 帧 / 4499 事件，帧压缩比 ~0.27）。
- 头事件与信封: 首行 `{"type":"session", version:4, id, createdAt, cwd, isSeeded, delegationDepth, agentPreset}`（无 seq），子代理会话带 `parentSession` + `origin:"subagent"` + `delegationDepth:1`。其余事件 `seq`(int) + `time`(epoch ms)；`surfaceOp` 是 UI 呈现提示（`"append"` 或 `{op,startSeq,endSeq}`，非模型可见）；`sourceEventSeqs` 把派生事件（tool/result: 1842 条、system/message: 5、user/message: 1）回链源事件，压缩摘要 user/message 可指向多个源 seq。
- 事件分层（41 种，实测）:
  1. **会话配置**: `permission/preset`、`sandbox/mode`、`approval/policy`（带 `source:'delegation'`，会随 `/permission danger-full-access` 等命令变化）。
  2. **轮次骨架**: `turn/start{turn}` → `step/start{turn,step}` → 模型交互 → `step/end` → `turn/end{reason}`；reason：`completed` / `error{error:{message,code}}` / `aborted{reason:{kind:'user'|'parent'}}`。
  3. **模型交互**: `request/header`（config{provider,model,maxTokens,reasoningEffort} + adapterDefaults + **tools 全量定义快照**，31 个工具）；`request/context`（contextWindow、`systemPromptUpdate:"in-history"`）；`system/message` / `user/message`（content blocks，user source.kind 有 `user{rpcId,clientTimeZone}`、`user-approval`、`time-context`、`tool-jobs`、`skill-catalog`、`compact-checkpoint`）；`assistant/message`（message.content: reasoning/text/tool-call 块；`source.replayState`={response:{kind:'deepseek-messages',version:1,model}, blocks:[{type:'reasoning',signature}]} 可重放回源；`usage{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens}`；**`stream[]` 全量流记录**：chunk/block-start、chunk/block-end、chunk/usage、chunk/finish、reasoning-chunks(dt+texts 差分)、tool-call-chunks、text-chunks）；失败重试另有 `assistant/attempt`（原始失败流）+ `llm/retry-started`/`llm/retry{retryId,policyKey,retry,maxRetries,delayMs,failure}`；`model/selection`。
  4. **工具生命周期**: `tool/call{turn,step,callId,name,arguments}` → `job/registered{jobId,owner,kind,label,startedAt,toolCall{callId,rootCallId}}` → `job/settled{finishedAt,status,cause,producerReported,detail}` → `tool/result{message{role:'tool',source{kind:'tool',callId},content,isError,id},error?,meta?}`。`meta` 按工具结构化：read→`{path,offset,lines[{number,text}],totalLines,lang}`、grep→`{shape:'matches',files,total,truncated}`、glob→`{shape:'paths',paths}`、edit/write→`{path,diffs,operation}`。工具分布（9931 事件统计）: edit 763 > pwsh 444 > read 377 > grep 116 > write 37 > job_output 28。
  5. **审批/命令**: `approval/asked{id,toolName,callId,reason}` → `approval/decided{outcome:'allowed-once'}`；`command/run{commandId,name,args,source}` → `command/done{kind:'success',text}`。
  6. **注入/收件箱**: `agent/inbox/spliced{target:'next-turn',start,inserted[]}`——steering/子代理提示注入，含会话内多次 spliced。
  7. **Goal（事件溯源）**: `goal/change{kind:'goal/change',version:1,operation:'create'|'complete',goal{id,revision,objective,phase,maxGoalRounds},roundsStarted,createdAt,updatedAt}`——**完整快照 + revision CAS**，这正是 QuickForge Goal v2 对标的源头契约。`todo/write{todos[]}` 同族。
  8. **压缩/上下文管理**: `compaction/prune{shadowedRange,shadowedSeqs,shadowedTokenCount}`（裁剪审计，57 条）→ `compaction/start/end{compactionId,turn,error?}` → `compaction/summary{summary[]}`（结构化摘要）；摘要以 `user/message` + `compact-checkpoint` 投放进上下文。
  9. **工作流/子代理**: `tool-workflow/run-start|agent-start{runId,seq,label,phase,childId}|agent-end{outcome}|run-end{stopReason}` + `subagent/descriptor{version,mode:'continuable',provider:'spawn',label,agentProvider,agentModel,agentReasoningEffort}` + `subagent/catalog{version,childId,childCreatedAt,mode,label}`；子代理是**独立 session 文件**（裸 UUID 目录），与父会话双向链接。
  10. **元数据/遥测**: `session/title`、`session/title-llm-request`、`session-log-deepseek/delivery-accepted{sessionId,sessionFormatVersion,throughSeq}`（日志投递水位 ack）。
- Evidence（验证方式）: Node 24 `zlib.zstdDecompressSync` 按帧切分解压 12 个会话（含 C:\Users\xiaohao\.dsh 两个 workspace、QuickForge 目录下 8 主会话 + 3 子代理会话），共 9931 事件全部 JSON 可解析、seq 0 个缺口；配置面 `~\.dsh\profiles\desktop\cordis.patch.yml`（provider/model 注入）与 `storages\workspace.json`（workspace↔session 索引）一并读过。
- 可复用脚本（保留在仓库根，未纳入 git 提交范围）: `.tmp-dsh-lib.mjs`（多帧解压+事件统计+落盘 dump）、`.tmp-dsh-zframes.mjs`（zstd 帧边界/seq 连续性分析）、`.tmp-dsh-inspect.mjs`（单文件概览）、`.tmp-dsh-src.mjs`（sourceEventSeqs/meta/request-header 形状）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 若启动 QuickForge「轨迹/Goal v2 对标 DSH」改造，直接按上面第 7/8 节契约做事件溯源（goal/change 完整快照 + revision CAS + compaction/prune 裁剪审计）；② 若要把 QuickForge 会话存储也改成 zstd 多帧追加，注意按 magic 切帧的读取约定；③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：tool-running-text-shimmer（done，2026-10-22）

- Current Objective（当前目标）: 用户先问「运动命令时候的扫光是不是黑色的，白色会不会更好」，看完白色变体与 8 个样式方案后选定 **C 方案：渐变高光在文字内部流过（复用思考 shimmer 范式）**。**已完成**，未提交、未创建 commit。
- 根因（一句话）: 原扫光是 `.quickforge-tool-running-sweep::after` 覆盖层，用 `color-mix(in oklab, currentColor 12%, transparent)` 取文字色 —— 而文字色是 `--muted-foreground`，于是浅色主题下是灰带（观感像黑色）、暗色下近白，同一份代码两套观感；且光带压在文字上层拉低可读性。用户提的「纯白」方案在浅色主题（白底）下会完全失效。
- 改动（`src/index.css`，仅 CSS）:
  1. 删除 `::after` 覆盖层与 `@keyframes quickforge-tool-running-sweep`，改由标签自身承载渐变：`background-image: linear-gradient(90deg, muted-foreground 25%, foreground 50%, muted-foreground 75%)` + `background-size: 200% 100%` + `background-clip: text` + `color: transparent`，动画**直接复用既有 `shimmer 2s ease-in-out infinite`**（与 ThinkingBlock 同一 keyframes/节奏）。
  2. **底色兜底** `background-color: var(--muted-foreground)`：渐变只覆盖 200% 幅面的一部分，端点相位会让整段文字不可见；底色与渐变两端同色，任意相位都可读且无接缝。这一步是踩坑点，删掉会看到文字周期性消失。
  3. `.quickforge-tool-running-sweep .quickforge-tool-summary-detail { color: var(--muted-foreground) }`：保护参数摘要（` · npm run build`）不被父级 `color: transparent` 吞掉。
  4. `prefers-reduced-motion` 回退：`background-image: none` + `background-clip: border-box` + `background-color: transparent` + `color: inherit` + `animation: none`，不留静态渐变运行态。
- 测试迁移（改断言到新语义，不是糊过去）: `tests/frontend/local-tool-running-sweep.test.ts` 的三条 CSS 契约重写为「text-clip 渐变 + shimmer 复用 + 底色兜底 + detail 不透明 + reduced-motion 回退」，新增「不再存在 `::after`」的负向断言；`tests/frontend/motion-design.test.ts` 的长循环豁免锚点从 `quickforge-tool-running-sweep 1.8s` 改为 `animation: shimmer 2s ease-in-out infinite`。
- Evidence（验证）: 最终全量 `npm run test` → **417 文件 4775 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功。定向 `npx vitest run local-tool-running-sweep / motion-design / chat-surface-css-contract / subagent-run-detail / tool-param-summary` → 5 文件 178 passed。Playwright 实测深浅两主题：计算样式为 `background-clip: text` / `color: rgba(0,0,0,0)` / `background-color: oklch(0.556 0 0)`（暗色 0.708），`-200%…200%` 五个相位文字均完整可读，亮部落在字形中部，`· npm run build` 保持自身灰色。
- 顺带修复（并行会话遗留，非本次 feature）:
  1. `src/lib/session-lease-client.ts:129` `failureFromStatus` 返回类型从 `SessionLeaseFailure | null` 收窄为 `SessionLeaseFailure` —— 三个分支都返回值、恒不返回 `null`，注解让 TS 把 `null` 漏进第 171 行，导致 `server-agent-events-types.test.ts`（真实 tsc 诊断）失败。
  2. `src/components/chat/surface/MessageEditor.tsx` 的 `readOnlyPlaceholderKey` 原本声明但未使用（占位符写死为 `sessionLeaseComposerPlaceholder`），改为真正使用该 prop，父组件透传 `composerReadOnlyPlaceholderKey`，两处类型由 `string` 收窄为 `AppTextKey`（`t()` 只接受字面量联合）。这才让「旁观者 / 降级」两种只读文案能分开。
- 文档: `DESIGN_LANGUAGE.md` 动效章节新增「工具运行态流光」一条（范式、底色兜底、detail 保护、reduced-motion 回退）；对比稿（8 方案 / 白色 4 档）已随后续 `design-mockups/` 整体删除，规格以 `DESIGN_LANGUAGE.md` 为准。`docs/wiki` 无需更新：纯视觉状态反馈，模块职责与公共入口未变。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 可选真机目视 running → done 切换、reduced-motion、以及 `run_command` 长命令下流光与后台命令删除线的共存；② 若觉得流光偏弱，只能调渐变停靠点（`25%/50%/75%` 与 `foreground` 权重），**不要**引入 filter/box-shadow（被契约测试禁止）；③ 会话租约那批改动（`ChatSurface` / `ConnectionNotices` / `server-agent` / `i18n` / `session-lease-client`）仍未被本次 feature 覆盖验证，仅修了它们的两个编译错误；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：abort-lease-header（done，2026-10-22）

- Current Objective（当前目标）: 用户报「点击暂停无效，控制台 `POST /api/agents/:id/abort 409 (Conflict)`」。**已完成**，未提交。
- 根因（一句话）: `ServerAgent.abort()` 是唯一漏发租约头的写入口。服务端 abort 挂了 `assertSessionWriteAccess`，读不到 `x-quickforge-client-id` 即视作匿名客户端，租约被持有时 409 `SESSION_LEASE_HELD`；而前端 `canWrite()` 先放行（本页确实是持有者），请求才真的发出并撞 409。原实现只 `.catch()` 网络错误、不检查 `response.ok`，409 因此完全隐身 —— 用户看到的就是「点了没反应、agent 继续跑」。
- 改动:
  1. `src/lib/server-agent.ts:865` `abort()` 补 `headers: this.writeHeaders()`（与 prompt/steer/followUp/updateModel/thinking-level 等写入口对齐）。
  2. 同处增加非 2xx 的 `logger.warn('Abort request rejected:', { status })`，让同类拒绝不再静默。
  3. `tests/frontend/server-agent-session-lease.test.ts` 新增 1 例：abort 请求必须带 `x-quickforge-client-id`。
- Evidence（验证）: `npm run test` **417 文件 4774 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc --noEmit -p tsconfig.json` 通过；`npm run build` 成功（6.70s）。
- 文档: 无需更新。`docs/wiki/src/lib/README.md:179` 原本就写「所有写请求经 `writeHeaders()` 携带 `x-quickforge-client-id` 供服务端二次校验」，是代码漏实现而非文档不实，本次修复后描述才真正成立。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 复查其它新增写入口是否漏发 `writeHeaders()`（本次暴露的是「文档已声明、代码漏一处」这类漂移，建议加一条”写路由 ↔ 客户端头”的契约测试把 13 条路由与前端写方法对齐）；② 承接上一条 session-write-lease 的遗留：A1（pin/归档改字段级 patch）、C6/C7（`bodyUnchanged` 仍比整份 canonical JSON）、多进程共享 dataDir 无文件锁、`session.sseConnected` 死代码。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：session-write-lease（done，2026-10-22）

- Current Objective（当前目标）: 用户先问「消息保存失败，请刷新或重试，以免丢失最近的对话记录」是什么意思；解释根因后用户选择落地 **A2 会话级独占（防多标签/多设备并发写同一会话）**。**已完成**，未提交，未创建 commit。
- 产品决策（用户未在追问中回复，按默认方案执行）: 非持有者降级为**只读旁观 + 可手动「在此窗口接管」**；不做自动抢占、不做硬拒绝；门禁覆盖全部写路由，但**不含审批与 `ask_user` 应答**（避免非持有卡片的页面把运行卡死）。
- 根因（一句话）: 写权限只有两层 —— 进程内 per-session FIFO 锁（只有 `persistSession` 走）+ SQLite revision CAS。真实并发写入口（第二标签页、局域网第二设备、多进程共享 dataDir）从不经过该锁；`runPrompt` 的业务门禁只有本地 `state.isStreaming`，且与真正开跑之间有多处 `await`（TOCTOU）。CAS 冲突时策略是「拒绝覆盖 + `persist_degraded` 告警」，于是并发写退化成用户可见的「消息保存失败」。原 `session.sseConnected` 独占链（重复连接 409）**早已无消费方** —— 前端改用全局事件流后失效。
- 服务端改动:
  1. `server/session-lease.mjs`（新增，纯同步 = 无 TOCTOU 窗口）: `acquire`（续约不广播）/ `forceTake`（显式接管，广播）/ `release`（仅持有者可）/ `get`（过期视作无人持有）/ `canWrite`（无租约放行，保持 ACP/定时任务/共享会话与升级前单端行为）/ `clear`（带 fence 防跨代误释放）。TTL 60s；`publish` 抛错被吞（租约是并发保护，不是可用性依赖）。
  2. `server/agent-session-lease.mjs`（新增，装配层）: 接 `agentSessions` + `emitSessionEvent`，变化以 `session_lease` 帧广播；6 个函数由 `agent-manager.mjs` facade re-export（导出面契约 +6）。
  3. `server/routes/agent.mjs`: 新增 `GET|POST|DELETE /api/agents/:id/lease`；新增 `assertSessionWriteAccess` 挂到 **13 条写路由入口**，位置在 `await readJsonBody` 之前 —— 被拦下的请求不读 body、不进 `runPrompt`，正是对旧 TOCTOU 空窗的补位。
  4. `getSessionState`/`getSessionStatus` 增加 `lease` 字段；`destroyAgent` 结束处 force 清除租约。
- 前端改动:
  5. `src/lib/session-lease-client.ts`（新增）: `clientId` 存 sessionStorage（刷新不变、新标签页新值）；`acquireLease`/`takeOverLease`/`releaseLease`；**409 与网络失败一律不降级为可写**。
  6. `ServerAgent`: `enableSessionLease()`（申领 + 20s 心跳）/ `takeOverSessionLease()` / `canWrite()` / `subscribeSessionLease()`；`dispose()` 释放并停表；`state.sessionLease` 由心跳与 SSE 帧共同维护且同值去重；**10 个写入口**本地拦截（一个请求都不发，避免「先乐观插入再回滚」的界面闪烁）；写请求统一带客户端头。
  7. UI: `ChatPanelHost` 挂载时申领 + `useSyncExternalStore` 订阅；`ChatSurface` 新增 `SessionLeaseStrip`（提示条 + 「在此窗口接管」）与 `composerReadOnly`（textarea `readOnly` + 占位文案、发送按钮禁用、paste/drag/drop 短路），复用 `composerControlsDisabled` 禁用「+」/模型/access 控件；`index.css` 新增 `.quickforge-lease-*`；i18n 新增 6 条中英文案。
- Evidence（验证）: `npm run test` **417 文件 4773 passed / 2 skipped**（新增 `session-lease.test.mjs` 17 例、`session-lease-client.test.ts` 14 例、`server-agent-session-lease.test.ts` 11 例、路由 409/守卫 8 例）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 成功（5.03s）。
- 两次返工（避坑记录）: ① `agent-manager.mjs` 的 `export { ... }` 漏 `from` → rolldown `Duplicated export`，一度让 28 个测试文件整体加载失败；② 起初把租约函数挂在 `agent-manager` facade 供路由导入，导致 9 个既有 `vi.mock('server/agent-manager.mjs')` 测试全报 `No "canWriteSession" export` —— 最终改为**路由直接 import `agent-session-lease.mjs`**，facade 仍 re-export 保住导出面契约，既有 mock 零改动。
- Blockers（阻塞）: 无。
- Next Session（下一步，按收益排序）: ① **A1（用户本次未选，但是最高频诱因）**：pin/归档改字段级 patch —— 侧栏 pin 仍会回写客户端整份缓存 metadata（`lastModified/title/taskStatus`），而 agent 侧冲突白名单只有 `pinnedAt/archivedAt`。② **C6/C7**：`bodyUnchanged` 仍比整份 canonical JSON，冲突后仍是「放弃写入」而非「重读 + 合并 messages 再写一次」。③ 多进程共享 dataDir 无进程级文件锁，跨进程仍靠 CAS 兜底。④ `session.sseConnected` 独占链可在确认无外部依赖后删除。⑤ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：composer-typing-latency（done，2026-10-22）

- Current Objective（当前目标）: 修用户反馈「对话轮次多了之后，输入框打字非常卡」。**P1+P2 已完成**（用户明确选择 P1+P2，且要求「内部重构，外观/交互零变化」）。未提交。
- 根因（一句话）: 卡顿不是某个组件慢，而是**热路径的归属错了**——输入文本存于 `ChatSurface` 顶层 `useState`（原 `:843`），于是每按一个键就重渲染整个 surface（1417 行），其中 `UsageBar` 的 `aggregateUsage`（`filter`+`reduce` 全量 assistant 消息，每次新建数组）与 `TodoWriteSummary` 的倒序扫描都是 O(消息数)。成本随轮次线性增长，所以只有长会话才卡。`MessageArea` 早已被 memo 围栏挡住（`:571`），但围栏越加越多、热路径仍在顶层。
- 三条叠加的成本链:
  1. **渲染**：按键 → `applyEditorText` → `setEditorValue` → 整个 ChatSurface 重渲染；`MessageEditor`/`GoalStrip`/`PlusMenu`/`ThinkingControl` 全部未 memo。
  2. **命令式联动**：`editor.onInput` 同步串联 4 个控制器；`command-suggestions`/`file-reference-suggestions` 每键 `innerHTML=''` + 全量重建（含 `setActiveRow` 重新 `querySelectorAll`）；`handleEditorInput` 每键两次 `querySelector`。
  3. **装饰放大**：面板级 `MutationObserver{childList,subtree}`（原 `ChatPanelHost.tsx:1679`）把菜单/chip/附件 tile 的节点增删都当成「需要全量 decorate」，而 decorate 内含约 39 项 O(消息数)/O(DOM 数) 操作。
- 修复（按架构分层，不是打补丁）:
  1. **U1 热路径下沉**（新增 `src/components/chat/surface/composer-store.ts`）：`text` / `attachments` 两个独立切片的外部 store + `useSyncExternalStore`。`ChatSurface` 删除 `editorValue`/`editorValueRef`/`editorAttachments`/`editorAttachmentsRef` 四个副本与两个镜像 effect；`MessageEditor` 拆成 `ComposerTextarea` / `ComposerAttachmentRow` / `ComposerActionButton` 三个叶子，各自只订阅需要的切片。bridge（`.qf-message-editor` 的 `value`/`attachments`）改为**纯适配器**：getter 读 store、setter 写 store，自身不存状态——顺带消灭了「同一值每键写 2–3 次 + 2 次 `handleEditorInput`」的旁路。
  2. **U4 派生投影前移**：`AgentSurfaceSnapshot` 新增 `usage` 与 `todoSnapshot`，由 `readAgentSnapshot` 一次算出并按 `messages` 数组身份用 WeakMap 缓存（与既有 R1 F1a 身份复用同一机制）。`UsageBar` 改收 `totals: Usage` 并 memo 化；`TodoWriteSummary` 改收 `{snapshot,key}|null`，组件内不再 `useMemo` 扫消息。
  3. **U3 装饰作用域收窄**：`MutationObserver` 仍在 `panel` 上（消息列表可能尚未挂载），但回调先按 `closest('.qf-scroll-container')` 过滤——只有 added/removed/target 落在消息区时才 `scheduleDecorate()`。composer 侧的节点增删不再喂全量 decorate。
  4. **U2 菜单按签名协调**：`command-suggestions` 与 `file-reference-suggestions` 各加 `renderedSignature`（query + 命中条目 + loading/directory/state），签名不变直接 return，`remove()`/`removeMenu()` 清空签名保证重开必重建。菜单 DOM 现在只在「可见内容真的变了」时重写。
  5. **热路径查询缓存**：`handleEditorInput`/`handleEditorFilesChange` 改用 `resolveEditor()`——`isConnected` 校验的缓存节点，替代每键两次 `querySelector`；文件变更分支不再多查一次 textarea。
- 收益（结构性，不依赖实测数字）: 打字期间 `ChatSurface` **零重渲染**，只有 `<textarea>` 与发送按钮重渲染；usage/todo 从「每键 O(消息数)」降为「每次快照提交 1 次 WeakMap 查询」；菜单 DOM 重写从「每键」降为「命中集变化时」；装饰 pass 不再由 composer 变动触发。
- Evidence（验证）: `npm run test` **415 文件全通过**（新增 `composer-store-isolation.test.ts` 5 例、`suggestion-menu-reconcile.test.ts` 3 例；迁移 `chat-surface-editor`/`chat-surface-usage`/`chat-surface-css-contract`/`send-stop-button`/`composer-model-trigger`/`todo-write-summary` 到新 API）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.66s）。
- 新增回归护栏（锁定「打字不惊动 surface」这条不变量）:
  - `composer-store-isolation.test.ts`：text setter 只通知 text 订阅者 / attachment setter 只通知 attachment 订阅者 / 同值写入不通知（`Object.is` 稳定）/ **打字后 `.qf-message-editor` 与卡片节点身份不变**（等价于「组件没重渲染」）/ 发送按钮仍随文字变活。
  - `suggestion-menu-reconcile.test.ts`：签名不变时行节点**同一批** / query 变化时重建且高亮正确 / 关闭后重开拿到新节点（不命中陈旧签名）。
- 未做（用户已确认只做 P1+P2）:
  - **U5 恢复窗口化**：`createMessageWindow({ enabled: false })` 仍是全量渲染。阻塞项：过程组展开态键含窗口内 `turnIndex` 需改绝对下标；窗口翻转会被 `shouldReleaseProcessGroups` 当成结构变化而全量 release+refold；另需同时改两条源码锁定断言（`chat-surface-behavior-alignment.test.ts:88-89`、`chat-surface-render.test.ts:224`）。
  - **U6 滚动 reflow**：`scroll-sync` 仍观察 `composerDock`，`fieldSizing:'content'` 自动增高 → 每键 resize → rAF 读 `scrollHeight`（强制 reflow）。P1/P2 后已不是主导项，但仍是单帧成本。
  - **P4 process-folding React 化**：`process-folding.ts`（1717 行）把 React 渲染的节点 re-parent 进装饰组，是所有窗口化/虚拟滚动方案的唯一根本障碍，也是大量「读源码文本」断言的主要对象。
- Blockers（阻塞）: 无。**未做真实浏览器 profile**——本轮收益是结构性的（重渲染范围与 O(n) 调用次数都从代码里消失了），但「长会话实际打字延迟」建议下次用 1000+ 消息会话配 `PerformanceObserver` longtask 采一轮，作为 P3 基线。
- Next Session（下一步）: ① 继续则做 P3：改 `process-folding` 展开态键为绝对 messageIndex + 让 release 门控区分「消息变更」与「窗口位移」，再启用窗口化，同时更新两条源码锁定测试。② 采一轮真实 profile 作为 P3 准入基线。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：turn-navigation-anchor（done，2026-10-22）

- Current Objective（当前目标）: 修用户反馈「对话区域左边的导航点，对于非用户输入的消息无法正确定位」。**已完成**。未提交。
- 用户约束: 现象确认为「导航点数量偏多，多的是 goal 续跑/后台任务通知」；修复范围明确要求**先只修定位锚点、不动节点数量**，所以内部消息仍各占一个导航点。
- 根因（一句话）: 导航节点来自**全量消息**（只看 `role`），可滚动目标只有实际渲染的行；两者用「窗口内第 n 个 `.qf-user-message`」的**序号算术**对齐，而 goal 续跑提示（`metadata.quickforgeGoalRun`）与后台命令通知（`details.quickforgeBackgroundCommand`）虽 `role: 'user'`，却被 `index.css:4245-4248` 以 `.quickforge-goal-internal-user-message` 整行 `display: none`。这类行没有布局盒、`getBoundingClientRect()` 全 0，但 `querySelectorAll` 不筛可见性 → 序号被它占位；`0 <= 阈值` 恒成立让高亮跳格，点击则算出 `scrollTop + 0 - containerTop - 24` 这种与内容无关的位置（表现为「几乎没反应 / 轻微往回一格」）。
- 修复（新增 `src/components/chat/turn-navigation-anchor.ts`，把口径收成单一真相）:
  1. 锚点改用 `MessageList` 写在行上的绝对 `data-message-index`（与 `turns[].messageIndex` 同一套坐标，与窗口起点无关），只扫 `.qf-message-list` 直接子级，避开 subagent 嵌套列表。
  2. `getClientRects().length === 0` 判定 `display: none`（不读 rect 值，避免「0 也是合法坐标」的歧义）。
  3. 三级回退：自身行可见 → 用它；被隐藏 → 其后第一个可见行，没有则之前最后一个可见行；自身行不在 DOM → `null`，不猜。
  4. `turn-navigation.ts` 删掉 `renderedTurnOrdinals` / `userElements` 序号算术，测量缓存改存 `anchors`；顺带补上旧 `renderedTurnOrdinals` **缺窗口上界**的隐患。
- Evidence（验证）: `npm run test` **412 文件 4716 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 成功。
- 新增/改造测试: `tests/frontend/turn-navigation.test.ts` 共 11 例，新增 `never marks a display:none user row as the active turn`、`jumps a hidden turn to the next visible row instead of scrolling to 0`；桩补 `data-message-index` / `getClientRects` / `scrollTop` / `scrollTo`。
- Blockers（阻塞）: 无。**未做真实浏览器手点**——本项是纯测量与锚点解析改动，假 DOM 已覆盖可见性分支，但建议下次开面板时用长会话（含 goal 运行或后台命令）点几个点确认手感。
- Next Session（下一步）: ① 若用户后续要收敛**节点数量**，在 `turn-navigation-data.ts` 复用 `isGoalInternalUserMessage`（`panel-decoration/goal-internal-message.ts`）过滤内部消息，并把该轮次的 assistant 内容归入上一个真实用户轮次；注意 `tooltip` 的 `userText`/`finalAnswerText` 配对也走同一函数。② `src/components/workspace/SubagentRunDetailContent.tsx:121-124` 有同构的 `.qf-user-message` 扫描，口径一致、当前不受影响，改动时一并核对即可。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：composer-native-attachment-hidden（done，2026-10-22）

- Current Objective（当前目标）: 修用户反馈「输入框附件按钮跑到『完全访问』右边了，但『+』添加菜单里本来就有添加附件」。**已完成**。未提交。
- 根因（一句话）: 附件入口的唯一性一直由**装饰层的副作用**维持，不是由 CSS 或 props 表达。旧 `panel-decoration/composer-plus-menu.ts` 的 `setupComposerPlusMenu` 每次 pass 都执行 `findNativeAttachmentButton(leftControls)?.classList.add('quickforge-native-attachment-hidden')`，配合 `index.css:4984` 的 `display:none !important` 把原生回形针藏起来。M4 整文件删除该模块后，这行副作用一起消失，回形针重新可见 → 与「完全访问」触发器并排。
- 修复（把隐含契约改成显式渲染门禁）:
  1. `ChatSurface`：`showAttachmentButton={enableAttachments && !activePlusMenu}`。
  2. `MessageEditor`：spinner 从 `showAttachmentButton` 分支里提出（`processingFiles ? spinner : showAttachmentButton ? 按钮 : null`），否则「+」接管后粘贴/拖拽的长文档解析（PDF/DOCX 最长 30s）没有任何进度提示。
  3. `input[type=file]` 始终挂载，「+」菜单经由 `pickAttachment` 回调点它。
- 等价性差异（已知且可接受）: 旧实现是「先渲染再 `display:none`」，回形针仍在 DOM 里；新实现根本不渲染。可见行为一致，且不再依赖 decorate 时序。
- Evidence（验证）: `npm run test` **412 文件 4714 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.46s）。
- 真实浏览器回归（CDP + headless Chrome，`127.0.0.1:5176`，临时探针脚本已删除）:
  1. 左侧控制行只剩 `+`（title「添加」）与 `完全访问`，回形针查询**返回空数组**；`input[type=file]` 仍为 1 个。
  2. 点 `+` → 弹层 `inDock=true`、位于编辑卡片之前，菜单项 `["附件","插件"]`：附件入口确实还在「+」里。
  3. 真实走隐藏 file input 传 1×1 PNG：附件行是卡片**第一个子节点**（`attachRowInsideCard` / `attachRowIsFirstChild` 均 true），tile 1 个、`img` 实测 56×56、`tileInsideCard=true`、`removeButtonClippedPx=0`（删除按钮未被 `overflow:hidden` 裁掉）、发送按钮由禁用转可用；点删除后 tile 归零、发送按钮回禁用。
  4. 右侧控制行未受影响：context-usage / 模型 / thinking / 发送，顺序正常。
- Blockers（阻塞）: 无。
- 一条环境事实（**不是本轮改动**，但会污染回归结论）: 会话期间有**其他进程**在改 `src/components/chat/turn-navigation.ts`、新增 `turn-navigation-anchor.ts`、改 `tests/frontend/turn-navigation.test.ts`（时间戳 10:19–10:21）。10:21 的全量测试因此报 2 文件 4 例失败（`skips display:none user rows...`、`env.getAnchorScanCount is not a function`、`scrollTargets` 为空等，全是改到一半的瞬时态）；对方写完后 `turn-navigation` 11 例与全量 412 文件全绿。**多 Agent 并行时，回归结论必须带时间戳与文件 mtime 对照**，否则会把别人的中间态当成自己的回归。
- Next Session（下一步）: ① **M4 收尾检查项**——整文件删除装饰模块时，除了「功能搬到 React」，还要逐条盘它写的 `classList.add/remove`、`dataset`、`style`：这些「顺手做的可见性/状态抑制」不会出现在函数名里，测试也常不覆盖（本轮就是典型）。建议对已删的 13 个模块做一次同样口径的回扫。② 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。③ 工作区里 `tmp-attach-shot.png`、`tmp-attach-shot2.png`、`tmp-test-attachment.png` 是更早会话遗留的未跟踪文件（时间戳 9:59–10:00），非本轮产物，未删除。

---

## 当前交接：session-open-fast-path-m4-slice4（done，2026-10-22）

- Current Objective（当前目标）: 把 M4 剩余可 React 化的 3 个装饰模块迁到 surface，并对整轮改造做自我代码评审。**已完成**。未提交。
- 落地 3 个（累计 13 个）:
  - `assistant-waiting-bubble.ts`（113 行，删除）→ `resolveAssistantWaitingRow` 用消息数组算**行索引** + `AssistantWaitingBubble` 作为 keyed 兄弟。「其后是否已有 assistant 输出」从 DOM 探针（查 `.qf-thinking-block`/`.qf-tool-message`/`.qf-markdown-block` + 克隆节点剔除动作行）改为读消息体，并保留旧的 `isStreaming` 前置条件。
  - `plan-mode-controls.ts` 的 `syncPlanModeButton`（删除）→ `PlanModeTrigger`，**仅 planMode 为 true 时渲染**（保持旧「关闭时 remove」的可见行为）。Shift+Tab 快捷键仍留在装饰层（绑定 textarea）。
  - `agent-access-menu.ts` 的触发器与菜单渲染（删除）→ `AgentAccessTrigger` + `AgentAccessMenu`；位置计算抽成纯函数 `positionAgentAccessMenu`，关闭改为**握手**。
- **自我评审发现并修掉 2 个高危缺陷**（都是"测试全绿但功能已坏"，务必记住）:
  1. **压缩横线与等待气泡的索引错位**：两者都按消息行计数，却用两次 `splice` 插入——插入横线会把之后每个位置推后一位，于是**横线在上方时气泡被挤到该行之前**（本该在最后一条 user 行之后）。任何发生过上下文压缩的会话，下一轮等待必中。改法：`MessageList` 的子节点数组**单次正序构建**；另加两条测试锁定「横线在上方时气泡仍是最后一个子节点」「同索引时横线在前」。
  2. **装饰层删除 React 拥有的菜单节点**：`removeAgentAccessMenu` 仍 `menu.remove()`，之后 React 卸载抛 `NotFoundError: The node to be removed is not a child of this node`，被 error boundary 接管后**整块聊天区不可用**。触发链：打开权限菜单 → 点「+」或子代理指示器 → `dismissComposerMenus()`。改法：装饰层只调 closer（`registerAgentAccessMenuCloser`），节点由 React 自己卸载。**探针已确认「外部移除后再卸载必抛」——这是形态问题，不是概率问题。**
- 另修 4 处行为偏差:
  1. 等待气泡漏了 `isStreaming` 前置条件（旧实现要求 `isStreaming && isActive`），会与停止按钮的等待环脱节。
  2. 空 thinking chunk 被算作「已输出」→ 气泡提前一帧消失（`content-parts` 会丢掉空 thinking，不渲染）。
  3. 侧聊的权限控件从「可见但禁用」变成完全不渲染（门禁漏了 `sideChatMode ||`）。
  4. 权限菜单在门禁变化后自动重开（门禁变 false 时菜单卸载但 `open` 仍为 true）。
- Evidence（验证）: `npm run test` **412 文件 4710 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.67s）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 明确不做且已写入拒因的 5 类——`process-folding`（节点所有权移交）、`message-actions`/`assistant-artifact-card`/`message-queue`（位置语义 + 100+ 条文本锁）、`scroll-to-bottom-button`（测量驱动的可见性，无快照数据可推导）、`subagent-running-indicator`（body 浮层 + 就地 diff 防 hover 闪断）、审批卡/ask 卡/回滚弹层（定位原语与浮层）。② 仍未跑真实浏览器：`+`/思考/权限三个弹层的定位、侧聊禁用观感、压缩横线 + 等待气泡在长列表里的相对位置，都值得手点一遍（jsdom 只覆盖顺序与属性，不覆盖像素）。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：run-command-silent-console-and-log-viewer（done，2026-10-22）

- Current Objective（当前目标）: 让 `run_command` 的前台与后台都不再弹出 Windows 控制台窗口，同时提供「点击查看完整运行日志」的入口，日志落在右侧 Reader 面板。**已完成**。未提交。
- 关键前提（先说清，避免复现错方向）: 用户最初报的是「普通前台命令也弹窗」。实机实测（250ms 轮询可见顶层窗口）结论相反——**只有 `run_in_background: true` 会弹**，前台 `detached:false` 时 `CREATE_NO_WINDOW` 生效、无窗口。抓到的证据：`WindowsTerminal | ping -n 4 127.0.0.1`；用户机器 `HKCU\Console\%%Startup\DelegationConsole = {2EACA947-...}`（默认终端是 Windows Terminal）。
- 根因: libuv 在 `detached:true` 时加 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`；WinBase.h 对 `CREATE_NO_WINDOW`（= Node 的 `windowsHide`）明确注明「ignored if ... used with either CREATE_NEW_CONSOLE or DETACHED_PROCESS」。**`detached` 与 `windowsHide` 在 Windows 上互斥**，所以原 `detached: runInBackground || process.platform !== 'win32'` 让后台分支的隐藏完全失效。
- 修复要点:
  1. `server/tools/index.mjs`：`detached: process.platform !== 'win32'`（后台语义由 `unref()` 承担，Windows 杀进程走 `taskkill /T /F`，都不需要进程组）；`details.detached` 如实反映实际参数。
  2. `server/utils/platform.mjs` 的 `openBrowser()`：原本 `cmd /c start` + `detached:true` + **无** `windowsHide`，每次启动应用闪一次 cmd 窗口；改为 Windows 不开 detached 并补 `windowsHide: true`。
  3. 日志查看：新增 `server/utils/command-log.mjs`（`isCommandLogPath` 共享 + `readCommandLog` 尾部窗口）→ 新增 `GET /api/agents/:sessionId/command-log`（只放行 `<dataDir>/logs/commands/*.log`）→ 前端 Reader 新增 `source: 'command-log'` 虚拟文件通道 → 工具卡 console 块与后台命令浮层各加一个「查看完整日志」按钮，经 `quickforge:view-command-log` 事件由 `App.tsx` 转成 Reader 请求。
- 必须记住的取舍:
  1. 日志 tab **不持久化**（`serializePanelTabs` 跳过 `source === 'command-log'`）：刷新后重载日志必然 403/ENOENT，恢复只会得到一个红色错误页。
  2. 日志 tab **隐藏**「在资源管理器中显示 / 用编辑器打开」入口（`/api/workspace/open-external` 对工作区外路径 403）。
  3. 日志路径只认 `details.outputFile` 的**绝对路径**，且判定只保留 `isCommandLogPath` 一份，禁止各路由另写 `startsWith`。
- Evidence（验证）: 实机后台命令全程轮询新增可见窗口 `[]`；`details.running=true` 调用仍立即返回；`npx tsc -b --noEmit` 通过；`npx eslint` 改动文件 0 error；新增/更新 5 个测试文件。
- Blockers（阻塞）: 无。**未做真实浏览器手点**：「查看完整日志」按钮 → Reader tab 的观感、后台浮层新增按钮的排版都只做了 jsdom/源码断言，建议下次发布前手点一遍。
- Next Session（下一步）: ① 真机手点验证 Reader 日志 tab 与后台命令浮层按钮排版；② 用户机器上残留的 `WindowsTerminal.exe`（`node -e "setInterval(() => {}, 1000)"`，来自 `run-command-background.test.mjs` 的后台用例）属既有测试清理缺口，可考虑在该用例里显式杀掉；③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---


## 当前交接：session-open-fast-path-m4-slice3（done，2026-10-21）

- Current Objective（当前目标）: 把 `panel-decoration` 里剩余**可 React 化**的命令式注入器全部迁移为 surface 内 React 渲染（M4），每个模块单独可验证，最后自我评审。**已完成**。未提交。
- 落地 8 个（累计 10 个）：`model-controls`（24 行）、`context-compaction`（190 行）、`todo-write-summary` 控制器（约 230 行 → 96 行纯函数）、`reconnect-notice`+`model-retry-notice`+`unreachable-strip`（约 640 行 → 一个 `ConnectionNotices.tsx`）、`goal-control-strip` 控制器（约 520 行）、`local-file-path-links` 的 DOM 部分、`composer-plus-menu`（234 行）、`thinking-level-controls`（242 行）。映射表与拒因见 `docs/architecture/session-open-fast-path.zh-CN.md` §4 M4。
- **自我评审发现并修掉 3 个真实缺陷**（都是"测试全绿但功能已坏"的类型，务必记住）:
  1. **rehype 插件递归进自己的产物**：`qf-file-path` 的子文本仍是同一路径，插件再次拆分 → 无限嵌套 → `RangeError: Maximum call stack size exceeded`。后果是 **Markdown 里出现任何本地路径就白屏**。修法：产物标签加入跳过集合 + 只递归**原始**子节点。`tests/frontend/local-file-path-markdown.test.ts` 用「无嵌套 + 确实生成链接」双向锁定——只测纯函数发现不了这个，必须走 `MarkdownBlock` 渲染。
  2. **`+` 菜单弹层放错位置**：被渲染成触发器所在控制行的兄弟，而不是编辑卡片之前的独立块，`.quickforge-plus-popover` 的间距/宽度全部错位。修法：拆 `ComposerPlusTrigger` / `ComposerPlusPopover` 两个组件共用一个 `useComposerPlusMenu` controller，各自放回原插入点。
  3. **侧聊控件不再禁用**：装饰层删除后，`+`、思考档位、模型三个触发器在侧聊里仍可点（原本由 `disableComposerControls` 置灰）。修法：`composerControlsDisabled` prop，三个控件渲染 `disabled` 且忽略 pointerdown/keydown。
- 必须记住的等价性细节（第三轮追加 1 条，前两条沿用）:
  1. 停止按钮 `title`/`aria-label` 是**字面量 `"Stop"`**。
  2. 等待环清除时刻**不等于** `isStreaming && !streamingMessage`，仍由宿主显式提供。
  3. **模型按钮的 `aria-expanded` 不能由 React 声明**——菜单（`lib/custom-model-selector.ts`）自己写；React 一旦声明，每次流式快照重渲染都会把展开态抹掉。
- Evidence（验证）: `npm run test` **236 文件 2793 passed**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.22s）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 剩下四件**不是"还没做"而是"不该按渲染迁移做"**——`assistant-artifact-card` / `message-actions` / `message-queue` 需要「消息根最后一个子元素」的位置语义且被 100+ 条源码文本锁保护，`process-folding.ts` 与 `ChatSurface` 的所有权租约强耦合是节点搬运而非渲染；若将来真要动，正确形态是「插入点仍命令式、内容 React 化」，并先补位置语义的测试。② 本轮只做了 jsdom 渲染断言，**没有跑真实浏览器**：`+`/思考弹层的定位、侧聊禁用态的观感、压缩横线在长列表里的位置都值得手点一遍。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：workflow-detail-no-trace-trim（done，2026-10-21）

- Current Objective（当前目标）: 去掉 workflow subagent 详情的「本次运行的过程记录超出详情预算，已保留最近步骤」提示，即删除服务端所有详情裁剪逻辑（与主 Agent 一致）。**已完成**。未提交。
- 根因: 三层体积预算口径互相矛盾 —— 单 Agent trace 80K（运行中）/200K（终态）、details 总量 240K/500K、日志 50K。运行中 240K ÷ 80K = **3 个 Agent 必定触发裁剪**，而默认并发 4、maxAgents 24，多工具 Agent 的 50 条窗口几乎必然顶到 80K → 运行中帧几乎每次都在裁。裁剪标记 `subagentRunTruncated`/`subagentRunDropped` → 前端 `traceDropped` → `traceNotice` 块，就是那句提示；且 `traceTruncated` 只要为真就提示，即使前端已用 previous 回填出更完整的旧 trace。
- 修复: **全删裁剪 + 流式帧改结构性瘦身**。
  1. 服务端 `server/agent-workflow-runner.mjs` 删除 7 个预算常量 + 8 个裁剪函数（`compactJsonValue`/`compactSubagentMessage`/`sliceMessagesWithToolPairs`/`dropOrphanToolResults`/`compactSubagentRunDetails`/`detailsTextSize`/`trimSubagentTraces`/`trimDetails`，约 130 行），新增 `subagentRunDetails()` 仅挑字段、messages/tools 原样透传。`buildDetails` 不再包 `trimDetails`；运行中帧只给 running/queued 的 Agent 带 trace，其余打 `subagentRunDeferred: true`，终态帧带全部全量 trace。`MAX_LOG_ENTRIES = 200` 作为条数上限保留（非体积裁剪）。
  2. 前端删除 `traceDropped`、`traceNotice` 块、提示节点、`subagentTraceTruncated` 中英文案、`subagentRunDropped`/`subagentRunTruncated`；新增 `subagentRunDeferred`，`buildWorkflowSubagentRunPayload` 在 deferred 且本帧无消息时沿用 `previous.traceMessages`，不标「丢失」。
- Evidence（验证）: 定向 `npx vitest run tests/server/agent-workflow-runner.test.mjs tests/frontend/workflow-agent-run-events.test.ts` 39 passed；`npm run test` 405 文件 4644 passed / 2 skipped；`npm run lint` 0 error（仅既有 GitToolsPinnedSummary warning）；`npx tsc -b` 通过；`npm run build` exit 0。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 旧会话里已持久化的 details 带旧裁剪痕迹，无法回溯补全，需重跑该 workflow；② 若担心单步消息量继续增长，可给 `subagentRun.messages` 做增量/分片（当前整份 details 每 200ms 重发是唯一剩余成本点）。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-view-ready-republish（done，2026-10-21）

- Current Objective（当前目标）: 修「切到一个正在生成的会话、再切回来，永久卡在『正在加载对话』，只能刷新页面」。**已修**。未提交。
- 根因（两个条件同时成立才触发，所以前三轮验收全部漏掉）:
  1. 目标会话**仍常驻 `taskMap`** —— 只在会话正在生成时发生。空闲会话切走即被 `selectAgentTaskEvictions` dispose（`MAX_IDLE_AGENT_TASKS = 0`），切回走 `/view` + `restore` 拿到**新 agent 对象**，主 effect 会重跑；运行中的会话留在 `taskMap`，`performLoadSession` 命中 `runningTask` 分支走 `attachTaskToView(runningTask)`，复用**同一个 agent 对象**。
  2. 视图被 `SessionViewPool` **保活** —— 切回只翻 `display`，不 remount。
- 叠加结果: `[agent, agentRuntimeScopeId]` 全不变 → `ChatPanelHost` 主 effect 不重跑 → `onInitialRenderReady` 一次都不发 → `renderedLoadingSessionId` 永远 `undefined` → 淡出 effect 的 `rendered === visible` 前置条件不成立。`agent_end` 不碰 loading 状态，所以**本轮生成结束也不会自愈**。
- 修复（两层，刻意保持「一个发布者」）:
  1. 源头 `ChatPanelHost`: 就绪发布收敛成 `publishViewReady()`，由面板初始化（同时置位 `pendingHistoryHydration`）与活跃性回调的「回到前台」分支共同调用。幂等——`handleSessionInitialRenderReady` 只在 `visibleLoadingSessionIdRef` 等于该会话时生效。**全量补齐不会重复**：开关只由初始化路径置位，发布时消费一次并置 `historyHydrated`。
  2. 兜底 `useAppLoadingTransitions`: 10s 过渡看门狗，把 `rendered` 置为当前 `visible`（复用既有 280ms 淡出）并 `logger.warn`。安全网不是第二条路径——实测打开都在 300ms 量级，10s 只命中真正的信号丢失；单信号协议的失败模式是**永久**卡死界面，比提前揭示更糟。`rendered === visible` 时不 arm，不与正常 ready 抢时序。
- Evidence（验证）: 定向 vitest — `app-domain-hooks` 16（新增 2 例）、`chat-surface-behavior-alignment` 18（新增 2 例）、`session-view-activity` 10、`session-view-pool-dom` 9、`message-queue` 20、`chat-compact-controls` 11 全过；`tsc -b` 通过；eslint 4 个改动文件 0 error。**旧实现红灯验证**：新契约断言在 `HEAD` 源码上 4 项全部不成立。
- Blockers（阻塞）: 无技术阻塞。**未做浏览器实机复现**（需构造「生成中途切走再切回」时序）；根因与修复位置已由源码契约 + 旧实现红灯对照锁定，建议下次发布前补一次手工回归。
- Next Session（下一步）: ① 若仍要自动化锁定该场景，最小可行做法是在 App 层用假 agent 驱动 `beginSessionTransition` + `handleSessionInitialRenderReady` 的时序（`app-domain-hooks` 已具备该基建），而不是渲染真实 `ChatPanelHost`（其主 effect 依赖真实 DOM 与全套子系统）；② M4 其余模块按逐模块绞杀继续（见下条交接）。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-m4（部分实施，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进 M4 —— 把 `panel-decoration` 的命令式 DOM 注入器改为 React 渲染。**部分实施**：2 个模块已落地，1 个模块主动回退。未提交。
- 本轮最重要的产出是**边界**，不是数量：按「输入能否完全从 snapshot/props 得到」分类 36 个模块 —— 可 React 化 12（其中 5 个本就是纯函数）、必须保留命令式 10、混合 14。真正的阻塞不是代码量，是**契约**：
  - 全仓 **232 条**「读源码文本 + `toContain`」断言（`assistant-artifact-card` 独占 114 条）锁的是**命令式实现**（`hostElement.insertBefore(card, anchor)`、`rollbackButton.className = ...`）。React 写不出这些字符串 → 改造等于**重写测试**。
  - 装饰层测试多用 `vi.stubGlobal('document', fake)` 的假 DOM（vitest 默认 `node` 环境），**无法承载 `createRoot().render()`** → 任何 React 化必须整文件切 jsdom。
  - `process-folding.ts`（1717 行）与 `ChatSurface` 的所有权租约强耦合（`getSnapshotBeforeUpdate` → `releaseProcessGroups`），是节点搬运/所有权移交，不是渲染 → 不在 M4 范围。
- 已落地两个模块（都是整文件删除 + 宿主删 decorate 调用）:
  - `send-stop-button.ts`（50 行）→ `MessageEditor` 渲染：`isWaiting` 控等待环、`onPointerDownCapture` 中止、`onBeforeAbort` 先收建议弹层；宿主 `assistantWaitingActive` 提升为 `replyWaiting` state（按钮现在由 React 渲染，翻转必须触发 render）。
  - `persist-degraded-notice.ts`（37 行）→ `MessageList` 渲染为 `.qf-message-list` 首子。**前提**：把 `persist_degraded` 加进 `ChatSurface` 的 `SUBSCRIBED_EVENTS`，否则 `state.persistDegraded` 变化不触发快照刷新，提示永不出现也不消失。
- **主动回退的一个模块**（重要，避免下轮重做）：`goal-iteration-divider` 一度在 `AssistantMessage` 末尾按 React 渲染，随后回退。两个无法用 React 忠实表达的事实：① 宿主**渲染后**才确定——通常 assistant，但本轮无 assistant 时回退到该轮 **user 行**（`quickforge-goal-internal-user-message`），两个不同组件负责同一节点；② 分隔线必须是根的**最后一个子元素**，而 `message-actions` 其后仍会 append 到同一根（这正是它原本需要幂等重定位的原因）。要 React 化就得把消息列表兄弟顺序提升为共享状态，那是重写折叠/装饰模型。→ 改为抽出纯函数 `readGoalIterationMarker` + `buildGoalIterationDivider`，`syncGoalIterationDivider` 只留 DOM 写入；**67 条既有断言全过**，证明行为等价。
- 两个必须记住的等价性细节（想当然就会改坏可见行为）:
  1. 停止按钮 `title`/`aria-label` 必须是**字面量 `"Stop"`** —— 装饰层一直写的是字面量，改用 `t('stop')` 会改变非英文环境的可见 tooltip。
  2. 等待环清除时刻**不等于** `isStreaming && !streamingMessage`：宿主在 assistant 的 `message_start` 就清除，而 `streamingMessage` 要到第一个 `message_update` 才有值 → 从 snapshot 推导会让等待环多显示一段（像素相同、时刻不同）。故该状态仍由宿主显式提供。
- Evidence（验证）: `npm run test` 405 文件 4639 用例通过；`lint` 0 error（1 既有 warning）；`tsc -b` 通过；`build` 成功（3.53s）。专项：send-stop-button 8 例（jsdom 渲染断言，含 pointerdown 抢占祖先冒泡、键盘激活、字面量 Stop、等待环清除时机）、persist-degraded-notice 4 例（新增）、goal-iteration-divider 67 例。
- Next Session（下一步）: M4 按**逐模块绞杀**继续，每步必须同时做三件事 —— 保留类名与 DOM 层级、把源码文本锁改为渲染断言、删除宿主里对应的 decorate 调用（否则 `MutationObserver` 会让 pass 空转）。按代价排序：零文本锁的 5 个（`composer-plus-menu`、`thinking-level-controls`、`model-controls`、`context-compaction`、`editor-bindings`）→ 1–3 条文本锁的 6 个（`todo-write-summary`、`goal-control-strip`、`local-file-path-links`、`model-retry-notice`、`reconnect-notice`、`unreachable-strip`）→ `assistant-artifact-card`(114) / `message-actions`(44) / `message-queue`(27) 三件套放最后。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-m3（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上完成「会话打开快路径」准则 4 的最后一块——消除切换会话时的整树 remount。**已完成**。未提交。
- 本轮核心判断: **保活渲染子树，不保活 agent 运行时**。依据是 `ServerAgent.dispose()` 不清 `state`（`server-agent.ts:1236` 明确注释 dispose 后仍可安全读取），所以「保留渲染结果」与「保留 agent 运行时」可以分开。这一划分同时绕开了调研中风险最高的两项：常驻 MB 级 messages（`MAX_IDLE_AGENT_TASKS` 保持 0 未动）与跨项目 `workspaceRoot` 污染（`server/project-config.mjs` 的 `activeProjectId` 是进程级单值）。
- 新增文件: `src/components/chat/SessionViewPool.tsx`（类组件；非活跃 `display:none`、活跃 `display:contents`、槽位恒定不重排）、`src/lib/session-view-pool.ts`（纯策略：默认 1 个非活跃槽 + 1500 行预算，活跃视图先计费且永不淘汰）、`src/lib/session-view-activity.ts`（活跃广播 + `isInsideHiddenView`）、`tests/frontend/session-view-pool.test.ts`、`session-view-pool-dom.test.ts`、`session-view-activity.test.ts`、`composer-popover-panel-scope.test.ts`。
- 关键实现约束（踩过坑，勿重试）:
  - **必须用类组件**：冻结「离开时那个元素」要发生在本次 render 仍输出它的时候，读写发生在 render 期间——用 ref 违反 Rules of React（lint `react-hooks/refs`），在 effect 里 setState 被 `react-hooks/set-state-in-effect` 拒绝，且实测**会丢刚切入的槽位**（切到 B 后 B 整个消失）。实例字段是唯一合适的存放处。
  - **wrapper 与位置必须恒定**：换元素类型/key 会卸载整棵子树；移动 keyed sibling 会让 React 搬动 DOM。淘汰只整槽移除。
  - **门控用 DOM 可见性而非活跃信号**：信号在 `useLayoutEffect` 发布，本视图刚变可见的那次提交上信号可能仍指向旧视图，会把唯一一次权威装饰跳过（表现为切回后轮次导航为空）。
- 三条必须显式迁移的「卸载副作用」: ① 草稿末次落盘（不补则切走前 400ms 防抖内的输入**直接丢失**，已提取 `flushComposerDraft()` 供停用与卸载共用）；② 回前台复位滚动并贴底（`surface.setAutoScroll(true)`）；③ 装饰层重扫。
- 顺带修掉的既有缺陷: `thinking-level-controls.ts` 无参清理会删任意面板的 thinking 按钮、`model-controls.ts` 的 `aria-expanded` 读全局、`useModelActions.ts` 读**第一个**面板的草稿/附件。全部改为 `closest('.qf-chat-panel')` 归属；这三点在「主聊天 + 侧聊并存」下本就是真实 bug。
- Evidence（验证）: 实机（32210，83↔16 行 SPA 内切换）——切走→切回**同一 wrapper / 同一消息行节点**（`===`）、切回贴底（`distance=0`，含脱离 899px 后再切回）、两视图并存、真实滚轮滞回稳定脱离、回底按钮可见且生效、草稿 `isolated=true restored=true`、composer 四钩子可编辑；longtask 切回 **4 个 / 累计 249ms / 最大 83ms**（改造前 10 / 2360ms / 854ms，500–850ms 单项尖峰消失）。`npm run test` 404 文件 4633 通过；`lint` 0 error（1 既有 warning）；`tsc -b` 通过；`build` 成功（4.04s）。临时实例已清理，主实例 5176 全程 health 200。
- 一条验证方法教训: **直接赋值 `scrollTop` 会被自动跟随立刻回弹**（程序化滚动不算阅读意图），表现为「滚上去又贴底」，极易误判为回归。滚动验证必须用真实 `wheel`/`scrollBy`。另：`page.goto` 换 URL 会整页重载、绕过 SPA，测不到保活，须在 SPA 内点击切换。
- Next Session（下一步）: M4（`panel-decoration` 20+ 命令式注入器改 React 兄弟节点）仍未做，价值在可维护性而非性能（装饰 pass 12–17ms 不是瓶颈）。若将来要调大 `MAX_IDLE_AGENT_TASKS`，**必须**先给 server agent 绑定 projectId 而不是读全局 active project。未提交 Git；未手工修改生成产物。

---


- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮把 Markdown 解析纳入内容寻址缓存，至此准则 2 完整兑现。M3（消除整树 remount）仍未开始。未提交。
- 本轮核心改动: **推翻上一轮结论并落地**。上一轮判断「缓存 `react-markdown` 元素树无效」，前提是它必须是 JSX 组件；查证 `node_modules/react-markdown/index.js` 后确认默认导出 `Markdown(options)` 是普通函数（`post(processor.runSync(processor.parse(file)), options)`）。因此改为渲染期直接调用它、缓存返回的元素树：`Markdown.tsx` 新增 `markdownElementCache` + `renderMarkdownTree` + `clearMarkdownElementCache`，`MarkdownBlock` 经 `memoizeContent` 取缓存。缓存键只需 `content`（插件列表是模块级常量，math token 由同一 content 决定）。
- Files（本轮改动文件）: `src/components/chat/surface/Markdown.tsx`、`tests/frontend/chat-math.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: `npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.79s）。定向：chat-math 13（新增 3 例元素树缓存契约）、chat-surface-css-contract + chat-surface-message-list + chat-surface-render 83。
- Blockers（阻塞）: 无技术阻塞。环境侧：本机 32176 端口已有旧版 QuickForge 实例在跑，新代码的 `/api/sessions/:id/view` 在该实例上返回 404（说明是旧进程），因此本轮未做浏览器实机验证；单元/集成测试已覆盖端点契约。
- Next Session（下一步）: 准则 4 的剩余部分（消除整树 remount）。关键约束已确认：`ChatSurface` 的 `key={agentRuntimeScopeId ?? agent.sessionId}` **不能直接去掉**——它同时承担「切换会话时丢弃上一会话的草稿恢复与编辑器状态」的职责，直接删会引入跨会话草稿串染。正确路径是先把会话级瞬态状态（草稿恢复代次、编辑器值、折叠展开集）迁到显式的会话键作用域，再让 `ChatSurface` 复用实例。M3/M4 与三项现网待确认事实（附件跨会话保留预期、过程组自动收起预期、`MAX_IDLE_AGENT_TASKS` 真实值）记录见 `docs/architecture/session-open-fast-path.zh-CN.md` 与 `progress.md`。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-acceptance（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮做系统性可见交互验收（准则 5）。未提交。
- 验收结果（浏览器实测，独立端口实例，361 条会话）：滚动滞回（初始贴底 0 / 小滚 40px 仍跟随 / 大滚后脱离 1141px）、回底按钮出现、轮次导航 6 节点未隐藏、折叠 6 组 + 5 条终答常显、composer 四钩子齐全且可编辑、草稿隔离与恢复——**全部符合契约**。
- 一次误报的排查: 侧栏点击会话行在合成 click / 强制点击下都不切换，一度判定为产品回归。用 `git stash` 在**基线代码复现同样现象**后排除——真实原因是会话行在 **dnd-kit 可拖拽排序容器**内，指针事件被 DnD 拦截。改用 deep-link 路由切换后草稿验证全部通过。教训：自动化交互失败先用基线对照排除自引入，再判断产品问题。
- Files（本轮改动文件）: `progress.md`、`session-handoff.md`、`feature_list.json`。**生产代码零改动**（`git stash` 已 pop，31 个已跟踪 + 13 个新增文件完整保留）。
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.41s）。主实例 5176 全程运行（health 200 复核），临时实例 32190/32191/32192 均已清理。
- Blockers（阻塞）: 无技术阻塞。准则 4 的「消除整树 remount」仍未做，需产品决策：`ChatSurface` 的 `key` 承担「换会话时丢弃上一会话草稿恢复/编辑器状态」——本轮已用实测确认这条职责真实存在且工作正常（草稿隔离与恢复通过），去掉它必须先设计显式迁移；另需确定附件跨会话保留、过程组自动收起、`MAX_IDLE_AGENT_TASKS` 三项事实。
- Next Session（下一步）: 两条路——① 动 `key` + 显式会话级状态迁移（收益最大，需先定迁移方案）；② 最近 N 个会话 DOM 保活（隐藏而非卸载，风险低，需定 N）。**不要再试「切小批」（已实测更差）或给 ThinkingBlock 加 memo / 指纹按对象缓存（已被测试锁定否决）。** 未提交 Git；未手工修改生成产物；不要关闭用户正在使用的实例。

---

## 当前交接：session-open-fast-path-hydrate-batching-probe（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮验证「分批补齐」能否削平首屏后的长任务——**被实测否决并回退**，但顺带确认了两条重要事实。未提交。
- 本轮两个发现:
  1. **首屏已足够快**：小→大切换 `click 1ms → load-start 35ms → first-paint/ready 303ms`。此前测到的 2360ms 累计阻塞**发生在 ready 之后**，属补齐，不在关键路径。
  2. **切断补齐 = 零长任务**：abort 掉 `hydrateFullHistory` 的全量请求后，实测 `longTasks: []`、`totalBlockMs: 0`。剩余阻塞的唯一来源就是那一次全量替换。
- 被否决的尝试: 全量替换改为「按 60 条逐帧向前扩展」。实测**更差**——累计阻塞 ~1.1s → **5006ms**、长任务 2 个 → **35 个**、最大单项 609ms → 324ms 但总量翻 4 倍。原因是每次提交都要重建整张列表，增量收益被重复成本吃掉。已完整回退，数据写进代码注释。
- Files（本轮改动文件）: `progress.md`、`session-handoff.md`、`feature_list.json`、`src/lib/server-agent.ts`（仅注释：记录「不要分批」的实测结论）。**生产逻辑零净改动。**
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.27s）。主实例 5176 全程运行（health 200 复核），临时实例 32188 已清理。
- Blockers（阻塞）: 无技术阻塞。剩余阻塞只能靠「减少总渲染量（窗口化）」或「不重建（DOM 保活）」解决，两者都属 M3，都需要产品决策：`ChatSurface` 的 `key` 承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换前必须定该状态迁移方式；另需确定附件跨会话保留、过程组自动收起、`MAX_IDLE_AGENT_TASKS` 三项事实。
- Next Session（下一步）: 只剩两条路——① 动 `key` + 显式会话级状态迁移（收益最大）；② 最近 N 个会话 DOM 保活（隐藏而非卸载，风险低，需定 N）。两者都需要你先确认上述事实。**不要再尝试「切小批」这类方案，已被实测否决。** 未提交 Git；未手工修改生成产物；不要关闭用户正在使用的实例。

---

## 当前交接：session-open-fast-path-remount-memo-probe（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮尝试用组件层优化削减 remount 成本——**两条候选路径都被测试否决并回退**，生产代码零净改动。未提交。
- 本轮结论（避免后续重复踩）:
  1. **不能给 `ThinkingBlock` 加 memo**：`thinking-block-interaction.test.ts` 直接调用组件函数断言 pointerdown-first 契约，memo 返回对象后 4 例全报 `ThinkingBlock is not a function`。且 memo 对 remount 本就无效（全新 fiber 必执行）。
  2. **不能按消息对象身份缓存 `messageDecorationFingerprint`**：`message-actions.test.ts:561` 断言「原地修改 details（数组引用不变）→ 指纹变化 → 行重新装饰」，与「同对象同指纹」的缓存前提冲突，2 例失败。
  两者都不是测试写错——测试锁定的是真实契约。**M3 没有组件层捷径**，必须动 `key` 或做 DOM 保活。
- Files（本轮改动文件）: `progress.md`、`session-handoff.md`、`feature_list.json`。**生产代码零净改动**（`ThinkingBlock.tsx`、`message-actions.ts` 的尝试均已完整回退，仅 `ThinkingBlock.tsx` 保留一段说明「为何刻意不 memo」的注释）。
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.49s）。主实例 5176 全程运行（health 200 复核），临时实例 32187 已清理。
- Blockers（阻塞）: 无技术阻塞。M3 仍需产品决策：`ChatSurface` 的 `key` 除 remount 外还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换前必须先定该状态的迁移方式；另三项事实（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）决定实例池大小与折叠默认态。
- Next Session（下一步）: 只剩两条可行路径——① 动 `key` + 显式会话级状态迁移（收益最大，风险最高）；② 最近 N 个会话 DOM 保活（隐藏而非卸载，风险低，但需定 N）。两者都需要你先确认上面的事实。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-remount-profiling（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮为准则 4 的剩余部分（消除整树 remount）建立成本基线并排除错误方向。M3 主体未动。未提交。
- 本轮产出（**未改生产代码，是诊断**）: 实测 A(618 行/10425 节点)↔B(171 行) 来回切换 —— 大→小 8 个 longtask/累计 1034ms/最大 238ms；小→大 10 个 longtask/**累计 2360ms**/**最大 854ms**。分段（点击为 0）：+5ms 首个 longtask 140ms（**早于 load-start，属旧树同步成本**）→ +148ms `load-start` → **+383ms 618 行旧 DOM 整体销毁（MutationObserver 记录移除 578 节点）** → +592ms first-paint/ready。
- 三个被数据排除的方向: 不是 DOM 解析（1.47MB `innerHTML` 重建单次 23ms）；不是布局（10425 节点强制布局 0.1ms）；不是网络（首个长任务早于请求）。→ 成本在 React 创建约 1 万个 fiber + 组件函数执行（会话含 125 个 ThinkingBlock、191 工具行、19 个 markdown 块）。
- Files（本轮改动文件）: `docs/architecture/session-open-fast-path.zh-CN.md`（M3 章节补实测数据与排除项）、`progress.md`、`session-handoff.md`、`feature_list.json`。**生产代码零改动。**
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 通过。主实例 5176 全程运行（health 200 复核），临时实例 32185/32186 均已清理。
- Blockers（阻塞）: 无技术阻塞。**但 M3 保活改造需要产品决策才能安全实施**——`ChatSurface` 的 `key` 除 remount 外还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换它必须先确定该状态如何显式迁移；另三项事实（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）决定实例池大小与折叠默认态。这些不是难度问题，是一致性基准无法由我单方面判定。
- Next Session（下一步）: 若确认可动 `key`：按 M3 实施 `SessionViewStore`（纯数据不可变 `Turn[]`）+ 显式会话级状态迁移，预期可消除 2360ms 累计阻塞中的大部分。若暂不动 `key`：可先做「最近 N 个会话 DOM 保活」（隐藏而非卸载），风险更低，但仍需决定保活数量。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-message-rows（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮消除准则 4 点名的「命令式 DOM 后置注入的重复扫描」。M3 主体（消除整树 remount）与 M4 未开始。未提交。
- 本轮核心改动: 新增 `src/components/chat/panel-decoration/message-rows.ts`（`readMessageRows` / `getPrimaryMessageList`）作为唯一枚举实现；此前 4 个装饰器各写一份 `querySelectorAll('.qf-user-message, .qf-assistant-message')` + `closest` 过滤（`message-actions`、`assistant-waiting-bubble`、`context-compaction`、`approval-card`）。`context-compaction` / `assistant-waiting-bubble` / `decorateMessages` 增加可选 `messageRows` 入参，`ChatPanelHost.decorate` 在 pass 开始时枚举一次并向下传递。
- 实现细节: `readMessageRows` 把 `closest('message-list, .qf-message-list')` 拆成两次单选择器查询——真实 DOM 等价，但测试脚手架只支持单选择器，合并写法会让 4 个既有用例失败。
- Files（本轮改动文件）: `src/components/chat/panel-decoration/message-rows.ts`（新增）、`message-actions.ts`、`assistant-waiting-bubble.ts`、`context-compaction.ts`、`approval-card.ts`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/message-rows.test.ts`（新增）、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.58s）。浏览器实测（独立端口 32184，361 条会话）：171 行、消息动作 8、压缩横线 1、过程组 6、composer 与贴底正常。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 准则 4 还剩「消除整树 remount」，唯一路径是 M3：在已收敛的 `scroll-anchor` 抽象之上建 `SessionViewStore`（纯数据、不可变 `Turn[]`），让展示层跟随「会话」而非「agent 实例」，并为 `ChatSurface` 的 `key` 设计显式的会话级状态迁移策略。这是压缩 10MB 全量补齐（分页 + 窗口化）的前置。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-scroll-anchor（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮把重复的滚动锚点逻辑收敛为单一抽象（M3 前置），并修掉实测暴露的一个既有缺陷。M3 主体与 M4 未开始。未提交。
- 本轮核心改动: 新增 `src/components/chat/scroll-anchor.ts`（`readScrollAnchor` / `resolveAnchorRow` / `anchoredScrollTop` / `ScrollAnchor`），`ChatSurface` 的 `captureReadingAnchor`、`applyReadingAnchor`、`loadMoreMessages` 三处改为复用；`loadMoreMessages` 用 `requireMessageIndex: true` 表达「分页必须锚在真实消息行」。
- 顺带修复的既有缺陷: 顶部可见行是折叠过程组（无 `data-message-index`）时，原实现回退 ordinal，前置 100+ 行后 ordinal 指向错误的行，浏览器实测「scrollTop 不变但顶部文字被换掉」。改为优先锚在带索引的真实消息行。修复后实测 `topText` 保持一致。
- Files（本轮改动文件）: `src/components/chat/scroll-anchor.ts`（新增）、`src/components/chat/surface/ChatSurface.tsx`、`tests/frontend/scroll-anchor.test.ts`（新增）、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `npm run test` 全量 399 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.78s）。浏览器实测（446 条会话，独立端口 32182）：补齐后 `topText` 一致、`hydrated` 99 → 203 行。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 在 `scroll-anchor` 之上建 `SessionViewStore`（纯数据、不可变 `Turn[]`），让展示层跟随「会话」而非「agent 实例」，这是准则 4 的唯一实质路径；随后才能安全开启窗口化以压缩 10MB 全量补齐。M4 的价值在可维护性，不在性能（已实测装饰 pass 16–17ms 非瓶颈）。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-decorate-measurement（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮量化装饰层真实成本，判断 M4 是否值得投入。M3/M4 均未开始。未提交。
- 结论：**装饰层在当前规模不是瓶颈，M4 不应以性能为由推进。** 618 行完整会话单次装饰 pass 16.5–17.2ms（首次 5.1ms），低于 50ms longtask 阈值。M4 的真正价值是消除命令式 DOM 注入的状态复杂度与自愈逻辑，属可维护性收益。
- 一次尝试并回退的优化：选择器收窄为纯类名（实测遗留标签匹配 0，走查 6.94ms → 4.91ms），但 `message-actions.test.ts` 用 `createFakeElement('user-message')` 锁定了遗留标签兼容行为，收窄后用例失败。收益约 2ms/次，不值得换一个被测试锁定的契约。已完整回退，理由与数据写入代码注释。
- Files（本轮改动文件）: `src/components/chat/panel-decoration/message-actions.ts`（仅注释：记录实测结论与回退理由）、`progress.md`、`session-handoff.md`、`feature_list.json`。**无生产逻辑改动。**
- Evidence（验证）: 独立端口临时实例（32181）Playwright 实测——618 行、装饰 pass 16.5/17.2/16.5ms（首次 5.1ms）、行枚举 6.2ms、遗留标签匹配 0。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（6.18s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3 是准则 4 的唯一实质路径——把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor`，再在其上建 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」），并以此为基础压缩 10MB 全量补齐（服务端分页 + 前端窗口化）。若不做 M3，准则 4 无法达成，目标应保持 active。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-cache-proof（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮把「渲染缓存生效」从自证式断言改成可证伪证据。M3/M4 未开始。未提交。
- 本轮核心改动: `tests/frontend/chat-math.test.ts` 新增 `react-markdown` 模块 spy，统计 unified 流水线实际运行次数；新增 2 例——命中缓存时调用数不增、`clearMarkdownElementCache()` 后调用数增加。原实现只断言「同一 content 两次渲染输出一致」，而这个断言在「每次都重新解析」时同样成立，无法区分命中与未命中。
- 事实核实: 在 Node 中确认 `react-markdown` 默认导出是普通函数（`typeof default === 'function'`，源码为 `function Markdown(options)`），因此在渲染期直接调用并缓存元素树是可行的——这也印证了更早轮次对「无法缓存元素树」这一错误结论的更正。
- Files（本轮改动文件）: `tests/frontend/chat-math.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `chat-math.test.ts` 15 例全通过（含新增 2 例）；`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` 成功（5.82s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32180。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3——把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor` 抽象，再在其上建 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）；这是压缩 10MB 全量补齐（服务端分页 + 前端窗口化）的前置。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点。装饰 pass 12–17ms 不是瓶颈，暂不优化。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-idle-hydration（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮做首屏精确耗时归因并把全量补齐移出关键路径。M3/M4 未开始。未提交。
- 归因结论（1279 条会话，点击切换）：`/view` 8ms/592KB、`/state` 18ms/77KB、尾部对账 `/messages` 2ms/2.4KB、`click → first-paint` 275ms（命中缓存）；**全量补齐 `/messages` 141–186ms / 10MB，原本在 first-paint 同时发起**。
- 本轮核心改动: `ChatPanelHost` 的补齐触发从 first-paint 回调改为 `requestIdleCallback`（`timeout: 2000` 兜底，无该 API 时 300ms `setTimeout`），并使用独立取消句柄 `cancelHydration`（cleanup 中调用）。实测补齐启动点推迟到首帧后 270ms，补齐结果正确。
- Files（本轮改动文件）: `src/components/chat/ChatPanelHost.tsx`、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 独立端口临时实例（32179）Playwright 实测——补齐请求启动点 = 首帧后 270ms（修复前与首帧同时），补齐后 `minIdx=0`/`maxIdx=1277`、贴底、composer 正常。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.95s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- 被避免的 bug: 最初把 idle 句柄赋给 `cancelInitialRenderReady`，会覆盖首帧就绪通知的取消函数。已改为独立 `cancelHydration` 并加源码契约测试锁定。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 剩余最大单项是 10MB 全量补齐（已不在关键路径，但仍是带宽与内存成本）。压缩它需要服务端分页 + 前端窗口化，属 M3 范畴：先把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor`，再建 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点。装饰 pass 12–17ms 不是瓶颈，暂不优化。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-decorate-timing（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮补齐「首帧后第一轮装饰」的观测盲区，并实测确认它在当前规模下不是瓶颈。M3/M4 未开始。未提交。
- 本轮核心改动: `session-open-timing.ts` 新增 `recordFirstDecorateTiming` / `firstDecorateMs`（并额外打 `qf:session-open:decorate:<sid>` mark，带 durationMs detail）；`ChatPanelHost.runDecorate` 在结束时记录首轮耗时。只记第一轮，避免流式期常规装饰掩盖真实数字。
- Files（本轮改动文件）: `src/lib/session-open-timing.ts`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/session-open-timing.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 独立端口临时实例（32178）实测——1279 条消息活跃会话 `click → first-paint/ready = 441ms`（上轮同链路 608ms），补齐后 `minIdx=0`/`maxIdx=1277` 正常；203 行时单次强制装饰 pass 约 12–17ms，无 longtask（<50ms 阈值）。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.24s）。主实例 5176 全程运行（health 200 复核），仅清理临时进程 32178。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3——把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor` 抽象，再在其上做 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。装饰 pass 当前 12–17ms 不是瓶颈，暂不优化。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-active-window（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上完成「会话打开快路径」的实机端到端测量与收尾。M3（实例池 keep-alive）与 M4（装饰层全量 React 化）未开始。未提交。
- **本轮最重要的发现**：只读视图的**内存命中分支**直接返回 `getSessionState`（含完整消息列表），导致 1279 条消息的活跃会话 `/view` 返回 9.5MB/1946ms、首屏 3202ms——端点在最需要它的场景没有生效。修复为「内存命中同样走尾部窗口，但保留 `tools`/待审批/流式等运行时字段」后：592KB/7ms、首屏 608ms（−81%）。
- 核心改动: `server/routes/session-view.mjs` 的内存命中分支加尾部裁剪 + `messagesSummary`；`tests/server/routes/session-view.test.mjs` 补 2 例锁定该行为（活跃会话走尾部窗口、未超窗口时不带 summary）。
- Files（本轮改动文件）: `server/routes/session-view.mjs`、`tests/server/routes/session-view.test.mjs`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 独立端口临时实例（32177）实测——冷 `view` 592KB/11ms；`restore` 76KB + 内存命中 `view(tail=200)` 592KB/7ms（此前 9.5MB/1946ms）；Playwright 首屏 `click→first-paint` 3202ms → 608ms，补齐后 `minIdx=0`/`maxIdx=1277` 正常。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.67s）。主实例 5176 始终运行（`/api/health` 200 复核）。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值），且 `ChatSurface` 的 `key` 不能直接去掉——它还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 优先补 M3 的前置：把本轮与上轮的滚动锚点实现（`captureScrollAnchor` / `applyReadingAnchor`）提升为通用 `ScrollAnchor` 抽象，再在其上做 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-hydration-anchor（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上完成「会话打开快路径」的 M2 实机验证，并修复补齐历史导致的滚动跳变。M3（实例池 keep-alive）与 M4（装饰层全量 React 化）未开始。未提交。
- 本轮核心改动: ① 新增阅读锚点补偿——`ChatSurface` 暴露 `captureScrollAnchor()`（记录顶部可见行的视口偏移 + 绝对 `data-message-index`，无索引时用 ordinal 回退以覆盖折叠过程组），layout effect 在提交时按 delta 补偿 `scrollTop`；② `hydrateFullHistory(beforeReplace?)` 在替换前一刻同步调回调，宿主在 `ChatPanelHost` 的就绪回调里接上；③ 修复 `server-agent.ts` 中未做环境判断的 `window.requestAnimationFrame`（非 DOM 环境抛错）。
- Files（本轮改动文件）: `src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/hooks/useAgentManager.ts`、`src/lib/server-agent.ts`、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 浏览器实机（Playwright）——网络顺序 `/view` → `/state` → `/messages?after=360`；361 条与 1179 条会话均可滚到 `data-message-index=0`，贴底/composer/回底按钮/轮次导航正常；补齐时 `topText` 不变且 `scrollTop` 从 258 精确补偿到 404（886 条会话）。端点级：1179 条会话 `/view` 601KB/20ms（全量 4.6MB/57ms）。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.85s）。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项需产品决策的事实（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值），且 `ChatSurface` 的 `key` 不能直接去掉——它还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3——`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」，先把滚动状态归约为单一 `ScrollAnchor`（本轮已有一个面向「头部插入」的锚点实现可复用为起点），再考虑开启窗口化。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-tail-window（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮实机验证 M2 只读视图通道，修正了实测暴露的设计缺陷与两处正确性问题。M3/M4 未开始。未提交。
- **本轮最重要的发现**：第一版 `/view` 全量返回虽然省掉一次串行往返（151ms → 57ms），但**字节数完全没降**（4.6MB 不变），瓶颈只是从「服务端重建运行时」转移成「单次超大响应 + 前端主线程解析」。改为尾部窗口后才真正同时拿到时间与体积收益：1179 条会话 4.6MB/112ms → 601KB/20ms。
- 核心改动: ① `server-state-service.mjs` 新增 `readSessionStateTail`（SQLite 只取末 N 条 + total，仅在窗口被截断时返回 total）；② `session-view.mjs` 默认 `tail=200` 并支持 `?tail=N`，只在截断时下发 `messagesSummary.count`；③ `server-agent.ts` 新增 `messageWindowOffset`（修正增量对账的索引基准）+ `hydrateFullHistory()`（补齐被省略的前缀）+ `mergeWindowedMessages()`（丢弃落在省略前缀里的尾部条目）；④ `useAgentManager.ts` 在 `loadedViaView` 时并行发起 `syncState()` 与 `hydrateFullHistory()`。
- Files（本轮改动文件）: `server/session-state-service.mjs`、`server/routes/session-view.mjs`、`src/lib/server-agent.ts`、`src/hooks/useAgentManager.ts`、`tests/server/routes/session-view.test.mjs`、`tests/frontend/server-agent.test.ts`、`tests/frontend/server-agent-message-window.test.ts`（新增）、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 实机 curl 实测（1179 条会话：`/view` 601KB/20ms、`tail=50` 128KB/5ms、全量视图 4.6MB；361 条会话 815KB/24ms）；`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.60s）。
- Blockers（阻塞）: 无技术阻塞。**但有一项验证缺口必须先补**：本轮只做了 curl 端点级实测，**没有在真实浏览器里点击会话验证渲染与滚动**。尾部窗口 + 后台补齐这条链路涉及滚动位置、`messagesSummary` 对账、`hydrateFullHistory` 触发时机，端点级测试无法覆盖，必须补 UI 级验证才能确认「用户可见交互不变」。
- Next Session（下一步）: ① **优先补浏览器实机验证**：打开一个 300+ 条消息的会话，确认首屏立即显示尾部内容、可向上滚动到最早历史、滚动位置正确贴底、`messagesSummary` 被正确消费。② 之后才推进 M3——`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」；注意 `ChatSurface` 的 `key` 不能直接去掉，它同时承担「换会话时丢弃上一会话的草稿恢复/编辑器状态」的职责，需先用显式的会话级状态迁移策略替代。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-round2（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上继续推进「会话打开快路径」。本轮补齐 KaTeX 渲染缓存（第二个里程碑缺口）并扩大装饰热路径的重复扫描削减；M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未开始。未提交。
- 本轮核心改动: ① `KatexMath.tsx` 接入内容寻址缓存（`(display, latex)` → html），让会话切换 remount 时历史公式不再重复 `renderToString`；增加 `clearKatexHtmlCache` 供测试隔离。② `ChatPanelHost.tsx#artifactsInputKey` 按 `messages` 数组身份加 `WeakMap` 记忆——依据是既有不变量「`state.messages` 从不原地修改」（已全仓核实无 `push`/`splice`/`pop`/`shift`/`unshift` 写入）。
- 被测试否决并回退的改动: 给 `goal-iteration-divider` 加「details 指纹相同就跳过」短路。该装饰器的既有语义是**每周期重新确认分隔线仍挂在宿主末尾**（其它装饰器可能在它之后追加内容），`goal-iteration-divider.test.ts` 显式锁定了这个幂等重定位行为。已回退，理由写入架构文档。
- Files（本轮改动文件）: `src/components/chat/surface/KatexMath.tsx`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/chat-math.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: `npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.69s）。定向：chat-math 10、goal-iteration-divider 67、chat-surface-render + chat-surface-behavior-alignment 27。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项需现网验收的事实（与上轮相同）：附件跨会话丢失是 bug 还是预期；过程组流式结束后是否应自动收起；`MAX_IDLE_AGENT_TASKS = 0` 与 wiki 写的「保留 5 个」不符。
- Next Session（下一步）: M3——`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」，**先把滚动状态归约为单一 `ScrollAnchor`（`{ turnId, offsetPx }`）**再开窗口化。注意 `ChatSurface` 的 `key` 不能直接去掉：它同时承担「换会话时丢弃上一会话的草稿恢复/编辑器状态」的职责，需要先用显式的会话级 key 迁移策略替代。未提交 Git；未手工修改生成产物。

---

