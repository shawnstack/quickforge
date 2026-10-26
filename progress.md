## project-create-in-workspace（done，2026-10-26）

- Goal：用户要求「选择项目目录下面应该有一个创建项目，直接就在 workspace 创建就可以了，这样感觉更简单」，并先给出 HTML 交互原型确认后再实现。
- 结论（一句话）：项目选择 popover 内新增「新建项目」入口，就地切成新建面板，只填名称即可在默认 workspace（`~/.quickforge/workspace`）下建目录并激活，不再需要浏览目录树。
- 改动文件：
  1. `server/project-config.mjs`：新增 `validateProjectFolderName` / `createProjectInDefaultWorkspace`——名称校验（空 / `.` / `..` / `\ / : * ? " < > |` / 控制字符 / >64 字符 → 400 `INVALID_PROJECT_NAME`），`fs.mkdir(recursive:false)` 建子目录后复用 `setActiveProjectPath` 注册并激活；`EEXIST` → 409 `PROJECT_FOLDER_EXISTS`、`EACCES/EPERM` → 403 `PROJECT_CREATE_DENIED`，注册失败把 `createdPath` 挂到 error 上。
  2. `server/routes/project.mjs`：新增 `POST /api/project/create`，**不**加入 `assertLocalExternalAction` 名单（远程客户端也可用）。
  3. `src/hooks/useProject.ts`：新增 `createProjectInWorkspace(name)`，复用 `setActiveProject` / `setProjects` / `invalidateApiCache` / `pruneExpandedProjectIds`；错误对象带 `code` 供 UI 分支。
  4. `src/components/chat/NewChatProjectPicker.tsx`：新增 `view`（`list | create`）、名称输入、路径预览、客户端同名/非法字符/超长校验、创建中态、错误态、Enter 提交、Esc 逐级返回（先清输入再回列表）、同名给「直接使用该项目」；「选择项目目录…」去掉常驻 `item-emphasis` 底色，成为普通动作行。
  5. `src/styles/chat/empty-state.css`：新增 `.quickforge-project-picker-item-hint` 与 `.quickforge-project-create-*`（面板无边框无阴影，只有输入框轻边框 + 聚焦 `shadow-2xs`；提交按钮 `:active` scale 0.97）。
  6. `src/lib/i18n.ts`：中英各补 14 个 key。
  7. `src/App.tsx`：`handleCreateEmptyStateProject` → `createProjectInWorkspace`；`onCreateProject`（remoteClient 时 undefined）+ `workspacePath={defaultWorkspace?.path}`。
  8. 测试：`tests/server/routes/project-create.test.mjs`（15 例）、`tests/frontend/new-chat-project-picker-create.test.ts`（10 例）。
  9. 文档：`docs/design/project-create-in-workspace.html`（交互原型）、`docs/wiki/src/components/README.md`、`docs/wiki/src/hooks/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`。
- 验证 / Evidence：定向 vitest 5 文件 **36 passed**；`npm run test` 全量 **428 文件 / 4976 passed / 2 skipped**（首轮曾出现 `tests/server/scheduled-tasks.commands.test.mjs` 2 例并发 flake，单独重跑 **24/24 passed**、全量重跑全绿）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（6.88s）。
- Notes：只允许在 workspace 根目录**下**建子目录，不接受 workspace 根目录本身作为项目，避免与 `id='default'` 合成项目语义重叠。`project-directory-picker.tsx` 的既有浏览 / 单层新建文件夹流程未改；没有新增依赖；未创建 Git commit；未手工修改生成产物。设计稿默认自动展开菜单便于对比，落地代码没有这段演示逻辑。

## sidebar-timeline-runtime-status（done，2026-10-26）

- Goal：侧栏切换到「时间线」视图后，运行中/未读会话与普通项目视图一致显示行尾状态。
- 结论（一句话）：删除 `SidebarSessionRow` 的 timeline 特判，四个变体统一走 `sessionTimeSlotContent`；运行中 Loader2、完成未读 emerald 点替换时间文本，固定 `w-11` 槽与 hover/focus 几何不变。
- 改动文件：
  1. `src/components/sidebar/chat-sidebar/SidebarSessionRow.tsx`：`timeSlotContent` 不再按 `variant === 'timeline'` 短路为 `timeText`；更新变体注释与 `timeText` prop 说明。
  2. `tests/frontend/sidebar-session-action-alignment.test.ts`：断言四个变体共用 `sessionTimeSlotContent`，移除“timeline 直接展示时间”的旧契约。
  3. `docs/wiki/src/components/README.md`：两处 ChatSidebar 模块说明同步为四变体共用时间/状态槽。
- 验证 / Evidence：定向 vitest 5 文件 **46 passed**（sidebar-session-action-alignment / session-row-hit-area / sidebar-session-sort-mode / sidebar-session-display-limit / motion-design）；`npx tsc -b` 通过；`npx eslint` 改动源/测试文件通过。
- Notes：性能分析——每可见行仅多一次 `sessionTaskStatus()`（O(1) 对象查找）与 `Set.has()`，本机 V8 微基准约 21ns/行；状态只在 `agent_start` / `agent_end` 与 visibilitychange 更新，没有新增 state/effect/订阅，不会把流式 token 更新引入侧栏；运行 spinner 仅运行行渲染，合成层动画，与项目/全局视图一致。未改状态数据源、固定槽宽度与 hover 几何；无依赖变更；未创建 Git commit；未手工修改生成产物。全量 `npm run build` / `npm run lint` 当前被工作区既有 WIP（新建 workspace 项目：`NewChatProjectPicker.tsx` / `i18n.ts` / `project-config.mjs`）阻塞（TS6133 未使用变量、no-control-regex），与本改动无关；定向 tsc/eslint 已通过。

## workflow-detail-script-expanded（done，2026-10-26）

- Goal：workflow 详情里的脚本 sheet 默认展开，不再要求先点底部「脚本」。
- 结论（一句话）：`sheet` 初始值改为按 `payload.script` 推导（有脚本即 `'script'`），底部脚本/结果按钮改为 `aria-expanded` + `aria-controls` 的可切换控件，脚本 sheet 默认可见；结果 sheet 仍默认收起。
- 改动文件：
  1. `src/components/workspace/WorkflowRunDetailContent.tsx`：`useState` 初始化 `sheet`（payload 带 script 时为 `'script'`）；新增 `toggleSheet` 统一脚本/结果互切与收起；脚本/结果按钮补 `aria-expanded` / `aria-controls`；sheet 补 `id` / `role="region"` / `aria-label`。
  2. `src/styles/workspace/workflow-detail.css`：底部按钮增加 `[aria-expanded='true']` 的轻量 active 背景；sheet 保持 `max-height: 40%` 可滚动。
  3. `tests/frontend/workflow-renderer.test.ts`：新增带 script 时默认渲染 script sheet、无 script 不渲染 foot/sheet 的 markup 断言。
  4. `tests/frontend/workflow-step-interaction.test.ts`：新增默认展开 + 点击「脚本」收起的 jsdom 断言。
  5. 文档：`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`、`docs/design/workflow-detail-redesign.html`。
- 验证 / Evidence：定向 vitest 2 文件 **51/51 passed**；`npm run test` 全量 **426 文件 / 4938 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（5.76s）。
- Notes：只改脚本默认展开与按钮展开态；结果默认保持收起，点击「结果」会从脚本切到结果。未改脚本内容、预算行、服务端 details 契约；无依赖变更；未创建 Git commit；未手工修改生成产物。实现中曾尝试用 `useEffect` 补“脚本晚到自动展开”，被 `react-hooks/set-state-in-effect` 拦下后移除——详情 Tab 打开时 payload 已带脚本，初始化值足够。

## workflow-detail-no-timeline（done，2026-10-26）

- Goal：按用户反馈移除工作流详情右侧时间轴；Agent 行只保留「点击打开对应子 Agent 运行详情」，不展示 subagent 的当前工具跑马灯/内部过程。
- 结论（一句话）：详情改为「概览 + 吸顶阶段头 + 轻量 Agent 入口 + ToolMessage 工具行 + 折叠日志」；刻度/条形/游标/网格/并行 bracket/图例全部移除，耗时只保留概览总时长与日志时间戳；工具行连接线落在 Agent 图标中心；并行只保留组首文字标记；失败步骤在概览给「N 个失败步骤 · 定位」。
- 改动文件：
  1. `src/components/workspace/WorkflowRunDetailContent.tsx`：删除 `TimelineAxis` / `StepTrack` / 时间轴百分比 / now/grid layer / 阶段跨度条 / 并行 bracket 与图例；Agent 行改为轻量按钮（图标 + 任务名 + profile + 状态 + 外链箭头），仍走 `buildWorkflowSubagentRunPayload` + `subagentRunStore` 快照 + `OPEN_SUBAGENT_RUN_EVENT`，queued 禁用，不再调用 `renderSubagentRunSummary`；工具行继续 `ToolMessage`，内容列缩进 + 连接线；日志改折叠 disclosure（有 error 默认展开，错误只染消息）；概览失败入口 + 底部文字按钮。
  2. `src/styles/workspace/workflow-detail.css`：删除全部 `--wf-tl-*` 与 bar/track/axis/legend/now/grid/phase-track/parallel-group 规则；新增 Agent 行、日志 disclosure、失败入口、低强调 foot 样式；摘要行统一 `min-height: 1.375rem`；连接线 x = `padding + 7px`。
  3. `src/lib/i18n.ts`：补 `workflowDetailFailedStepsOne/Many`、`workflowDetailLocate`、`workflowDetailPending`。
  4. `tests/frontend/workflow-renderer.test.ts`：重写详情断言（无时间轴、日志默认策略、失败入口、Agent 轻量行、单次并行标签、pending 阶段）。
  5. `tests/frontend/workflow-step-interaction.test.ts`：新增 workflow 详情 Agent 行点击派发 `OPEN_SUBAGENT_RUN_EVENT`、queued 禁用、无 `quickforge-subagent-tool` / marquee 的 jsdom 断言。
- 验证 / Evidence：定向 vitest 2 文件 **48/48 passed**；`npm run test` 全量 **426 文件 / 4935 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（5.89s）。独立 Vite harness 用真实组件 + 全量 CSS 在 Chromium 420px 面板实测：无横向溢出，Agent 图标中心与工具连接线同 x=283，工具卡内容起点 291，阶段头 `sticky top: 0`，概览失败入口 / 日志默认策略 / 底部脚本结果按钮正常。
- Notes：未在用户正在使用的 5176 实例里点开 workflow 详情（QuickForge 单实例 guard 拦截了第二个浏览器窗口），改用独立 Vite harness 做真实 Chromium 布局测量；未做真机目视截图（in-app Browser 不可见）。未改服务端 details 契约与 Inspector Tab / `OPEN_WORKFLOW_RUN_EVENT` / `OPEN_SUBAGENT_RUN_EVENT` 公共链路；无依赖变更；未创建 Git commit；未手工修改生成产物。设计稿：`docs/design/workflow-detail-redesign.html`。

## composer-model-trigger-thinking-label（done，2026-10-26）

- Goal：用户要求「对话框显示模型那里显示模型 + 思考等级，思考等级更浅色一点，其他的不变，只是改显示；目前对话框里面只显示了模型」。
- 结论（一句话）：模型触发按钮文案从「模型 ID」扩成「模型 ID · 思考等级」，等级用比模型名更浅一档的颜色；纯展示改动，不改任何交互、持久化与服务端契约。
- 改动文件：
  1. `src/components/chat/surface/MessageEditor.tsx`：`MessageEditorProps` 新增可选 `thinkingLevel?: ThinkingLevel`；按钮内 `<span className="ml-1">` 追加 `<span className="quickforge-model-trigger-thinking"> · {label}</span>`；推导逻辑 `currentModel?.reasoning === true && thinkingLevel ? thinkingLevelLabel(toThinkingLevel(thinkingLevel)) : null`。
  2. `src/components/chat/surface/ChatSurface.tsx`：`<MessageEditor>` 新增 `thinkingLevel={snapshot.thinkingLevel}`（`AgentSurfaceSnapshot` 已含该字段，且等级变化本就会产生新 snapshot，无需额外 revision）。
  3. `src/lib/thinking-levels.ts`：新增 `toThinkingLevel()`（`minimal`→`low`、非法→`off`），把档位收敛规则提到词表模块——它是跨模块契约，不能只存在于滑杆里。
  4. `src/lib/thinking-slider.ts`：`toSliderLevel()` 改为委托 `toThinkingLevel()`，消除两份映射表不一致的风险；展示组件不再依赖含 400 行粒子代码的滑杆模块。
  5. `src/styles/chat/composer-controls.css`：新增 `.quickforge-model-trigger-thinking`（`color-mix(in oklab, var(--muted-foreground) 72%, transparent)`）与 hover/展开态重着色（`var(--foreground) 62%`）。
  6. 测试：`composer-model-trigger.test.ts` +11 例（后缀渲染、无等级不渲染、非推理模型不渲染、5+2 档位映射、中点分隔）；`composer-control-hover.test.ts` +2 例（后缀更浅且不抢 `!important`、hover/展开态重着色），并给该文件的 `ruleFor` 补上注释剥离（否则规则前的中文注释会被朴素选择器正则吸入）。
- 关键实现约束：**等级必须是 `.ml-1` 那个 span 的子节点**，不能是兄弟节点。紧凑态（`compact.css`）与移动端（`empty-state.css`）只把 `.quickforge-model-trigger > span.ml-1` sr-only 化，2rem 图标形态下兄弟节点会继续显示并撑破按钮。
- 被避免的坑：① 展示文案不能直接 `thinkingLevelLabel(thinkingLevel)`——上游 `ThinkingLevel` 含滑杆没有的 `minimal`，映射表无此键会落成「关」，显示错等级。② 「更浅」不能用 Tailwind 语义色透明度凭感觉造（DESIGN_LANGUAGE 有明确禁令，`border-border/75` 曾导致实际更深），复用本文件已验证的 `color-mix(... --muted-foreground N%, transparent)`。③ 非推理模型不显示等级文案：切到这类模型时等级被强制 `off`，显示「关」会与「不支持思考」混淆。
- Evidence（验证）：`npx tsc -b --force` 通过；定向 8 文件 **83 passed**（composer-model-trigger 16、composer-control-hover 6、chat-compact-controls 10、css-architecture 5、thinking-slider 16、model-selector-thinking-sync 6、chat-surface-editor / render / composer-store-isolation 等）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）。真实渲染探针本轮未拿到结果（CDP 脚本里 `createRoot` 取自 vite deps 预打包路径失败），改为以 CSS 契约测试 + jsdom 渲染断言兜底；视觉观感（浅色档位是否足够可辨、深色模式对比度）**尚未目视验收**。
- Boundaries：纯展示改动，未改滑杆交互、`active-thinking-level` 持久化、服务端 `thinkingLevel` 契约；未新增依赖；未触碰 `dist/`、`package-dist/`、`package-offline/`。
- Notes（范围外遗留，供下轮）：① 共享会话页与 Side Chat 复用同一按钮，等级文案会一并出现（Side Chat 按钮为 disabled，等级仍显示）——若产品认为 disabled 态不该显示等级，需再加门控；② 按钮无 `max-width`，模型名较长时新增后缀会挤压右侧控件组，真机需确认；③ `docs/wiki/src/components/README.md:181` 与 `docs/architecture/session-open-fast-path.zh-CN.md:558` 记录的「模型按钮为纯文字、思考等级已拆为独立控件」口径已与本次相反，需同步（本轮因该文件被另一会话的 workflow 改动占用，未一并修改）。
- 已知工作区遗留（与本次无关）：另一会话未提交的 workflow 详情无时间轴重设计（`WorkflowRunDetailContent.tsx`、`workflow-detail.css`、`i18n.ts`、`workflow-renderer` / `workflow-step-interaction` 测试、`docs/design/workflow-detail-redesign.html` 及三份进度文档内的对应段落）原样保留，本次提交未包含。

## thinking-slider-first-frame-fix（done，2026-10-26）

- Goal：用户反馈「打开模型选择就显示思考等级是关了」，要求分析并优化。
- 结论（一句话）：这不是默认值问题，而是**滑杆首帧定位失败**——滑杆在 `append` 到弹层之前就渲染，`offsetHeight` 恒为 0，旧实现「拿不到行高就 return」导致 `translateY` 从未写入，五档常驻文字整列停在第一行（`thinkingOff` = 「关」），而圆圈用百分比定位显示在正确档位。修复：兜底行高（根字号 × 1.2rem）+ 拿到实测布局后无动画校正；同时补上「弹层内切模型后滑杆不刷新」和「非法档位算成 NaN」两个相邻缺陷。
- 改动文件：
  1. `src/lib/thinking-slider.ts`：① `positionStack()` 不再在无实测行高时提前返回，改用 `fallbackLineHeight()`（`--quickforge-thinking-line` = 1.2rem × 根字号）兜底；② 新增 `syncStackToLayout()`，在 `ResizeObserver` 回调里按实测行高无动画重算（**放在 `resizeFx()`/`hasLayout()` 之前**，否则无 canvas 环境下永远跑不到）；③ 新增导出 `toSliderLevel()`，把上游 `ThinkingLevel` 的 `minimal` 收敛到 `low`、非法值收敛到 `off`；④ `levelIndex()` 越界兜底为 0，`aria-valuetext` 改用收敛后的档位，杜绝 `indexOf(-1)` 让 `translateY` 变正向偏移、`knob.left` 变 NaN。
  2. `src/lib/custom-model-selector.ts`：`ModelSelectorHandle` 新增 `setThinkingDisabled`，桌面菜单与移动 sheet 两个 handle 都实现；`setThinkingLevel` 从「无人调用」变成主聊天实际接线。
  3. `src/hooks/useModelActions.ts`：接收 `openCustomOnlyModelSelector` 的返回 handle，`onSelect` 里 `syncSlider(nextThinkingLevel)` + `setThinkingDisabled(!nextModel.reasoning)`；初始 `thinkingLevel` 与 `syncSlider` 统一走 `toSliderLevel`（服务端可能写回 `minimal`）。
  4. 测试：`tests/frontend/thinking-slider.test.ts` +6 例（首帧就有位移、拿到实测行高后重写偏移、无布局时保持兜底、`minimal`→`low`、未知值→`off`、`setLevel` 非法值收敛）；新增 `tests/frontend/model-selector-thinking-sync.test.ts` 6 例（只在传参时渲染滑杆、打开即定位到目标档、handle 换档、非推理模型转禁用、五档全覆盖、移动 sheet handle 同样支持）。
  5. 文档：`docs/wiki/src/lib/README.md`（`custom-model-selector` 与 `thinking-slider` 两条目录行 + 接线说明新增 handle 同步语义）。
- 被避免的坑：① **`ResizeObserver` 里把校正写在 `hasLayout()` 之后无效**——`resizeFx()` 在 `context` 为空（jsdom / 无 canvas）时提前返回，`fxW` 恒为 0，校正永远跑不到；必须放在 canvas 尺寸逻辑之前。② **不能只在 `renderValue` 里改兜底就收工**——字体加载或用户改字号会让真实行高偏离 1.2rem，只有「实测后校正一次」才能保证文字与圆圈始终同档。③ `ThinkingLevel` 类型包含滑杆没有的 `minimal`，直接 `as ThinkingSliderLevel` 强转在运行时是非法档位。
- Evidence（验证）：`npx tsc -b --force` 通过；定向 8 文件 **59 passed**；`npm run test` 全量 **426 文件 / 4932 passed / 2 skipped，exit 0**（首轮并发跑时 `tests/server/scheduled-tasks.commands.test.mjs` 曾因 Windows EPERM 临时文件 rename 失败 1 例，单跑 24 passed、后台复跑全绿，属既有 flaky 与本次改动无关）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（3.66s）。
- Boundaries：未改服务端 thinkingLevel 契约与 `active-thinking-level` 持久化策略；未新增依赖；未触碰 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit；未做真机目视验收。
- Notes（范围外遗留，供下轮）：① `useModelActions` 的思考接线仍无单测覆盖（「仅推理模型传参」「切非推理模型强制 off 且不写 `active-thinking-level`」），可用 fake agent + mock selector 补；② 服务端 `updateSessionThinkingLevel` 不校验档位合法性，非法值会原样落到 `session.thinkingLevel`，目前靠前端收敛兜底。

## model-selector-provider-menu（done，2026-10-26）

- Goal：用户提供参考截图，要求把输入框旁的模型选择改造成「服务商分组 + 选中勾选 + 模型能力标签 + 底部思考等级滑杆」的样式，并逐步迭代为：自定义模型入口置顶、思考等级文字翻滚、拖动条只留圆圈、粒子特效限制在滑块内且随档位从右向左游动、高档位粒子超级多且流速快、底部去掉档位文字与 Ctrl+T。
- 结论（一句话）：模型选择弹层重做成「顶部设置入口 + 按 provider 分组的可滚列表 + 底部思考滑杆」三段式；思考等级从 composer 独立控件迁入弹层底部，实现为常驻整列翻滚文字 + 纯圆圈渐变轨道 + 圆角裁剪的 canvas 粒子拖尾（档位驱动密度/流速/拖尾长度）。
- 改动文件：
  1. `src/lib/thinking-slider.ts`（新增）：滑杆控件的全部实现。翻滚数值用「五档文字常驻一列 + `translateY`」而不是节点入场/退场（后者在快速换档时定时器未跑完会重叠）；粒子按档位三档配置 `LEVEL_CAP / LEVEL_RATE / LEVEL_SPEED`（上限 4/16/38/82/160，每帧补充 0.02/0.12/0.36/0.8/1.7，流速 0.72×→1.85×），画布用 `roundRect` 按轨道圆角裁剪保证不溢出，`prefers-reduced-motion` 下整体关闭，无 canvas 实现的环境（jsdom）自动降级为无粒子。
  2. `src/lib/custom-model-selector.ts`：新增 `groupModelsByProvider()`（按 `Model.provider` 分组，`quickforgeModelRef.source === 'custom'` 优先，组内按展示文案排序）、`modelSupportsImages()`（`Model.input` 含 `image`）、桌面菜单与移动 sheet 的新结构（顶部 `.quickforge-model-menu-top` + 滚动区 + 分组头 + 滑杆）；`positionMainMenu` 宽度 260 → 336px（三列语义在原宽度下会频繁截断模型 id）；`ModelSelectorOptions` 新增 `thinkingLevel / onThinkingLevelChange / thinkingDisabled`，`ModelSelectorHandle` 新增 `setThinkingLevel`；清理时销毁滑杆的 rAF 与监听。
  3. `src/lib/thinking-levels.ts`（新增）：档位词表与标签（`off/low/medium/high/xhigh`），替代被删除的 `surface/ThinkingLevelControl.tsx`——词表本身是跨模块契约（服务端同步、持久化、子代理运行详情共用）。
  4. `src/hooks/useModelActions.ts`：主聊天接线——仅推理模型传 `thinkingLevel` + `onThinkingLevelChange`，回调写 `agent.state.thinkingLevel`、调 `updateThinkingLevel` 同步服务端并 `saveActiveThinkingLevel` 持久化。
  5. `src/components/chat/surface/MessageEditor.tsx` / `ChatSurface.tsx` / `ChatPanelHost.tsx`：移除 composer 内旧的思考入口（原生 `<select>`、`trailingControls`、`enableThinkingControl` / `onThinkingLevelChange` / `enableThinkingSelector` 透传），避免同一状态出现在两处控件上。
  6. `src/styles/chat/composer-controls.css`：弹层改 flex 三段式（`overflow: hidden` + 内部滚动）、新增分组头/首字母徽标/能力标签/滑杆样式；删除 `thinking-inline` / `thinking-menu` / `thinking-item` 等已无 DOM 的选择器。
  7. `src/styles/chat/compact.css`、`src/styles/chat/empty-state.css`：删除紧凑/移动端的思考按钮 icon-only 规则。
  8. `src/lib/i18n.ts`：新增 `modelVisionCapability`（en `Vision` / zh `视觉`），复用既有 `modelsCount` 做分组计数。
  9. 测试：新增 `tests/frontend/thinking-slider.test.ts`（10 例：词表、`role=slider` 语义、单圆圈、整列翻滚不叠节点、点击/键盘换档、disabled、外部同步、canvas 存在且在轨道内）；删除 `thinking-level-control.test.ts`；更新 `custom-model-selector`（按 `.quickforge-model-menu-item-name` 匹配）、`composer-control-hover`（中性 hover 列表 -1）、`agent-access-menu`（选择器组拆分）、`chat-compact-controls`（-2 条断言）、`chat-surface-editor`（改为锁定「composer 不再渲染 select」+ 词表契约）。
- 被避免的坑：① **粒子生成在轨道外导致首帧销毁**——初版 `x = fxW + 2..16`，而透明度按 `fxW - x` 判定，负数被判为透明后立即 `p.x = -10` 销毁，肉眼完全看不到流动；改为在右边缘内侧生成并按 `age/fadeIn` 淡入。② **同色粒子叠同色渐变不可见**——初版用渐变同位置取色，等于青点画在青底上；改为 70% 浅色粒子 + 少量品牌色。③ **翻滚数值节点重叠**（用户实测反馈「叠在一起」）——从双节点入场/退场改为整列位移。④ **粒子溢出滑块**（用户实测反馈）——画布从 `inset: -0.85rem -0.6rem` 收回 `inset: 0` 并加圆角裁剪。⑤ 勾选槽不能照截图移到右侧——`app-css` 契约锁定 `grid-template-columns: 1rem minmax(0, 1fr)` 与 `item.append(checkSlot, label)`，能力标签改为跟在模型名后，勾选槽保留在左。
- Evidence（验证）：`npx tsc -b --force` 通过；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功（3.77s）。定向：thinking-slider 10 passed、custom-model-selector 8 passed、契约组（compact / hover / agent-access / model-trigger）34 passed。
- Boundaries：未新增依赖；未触碰 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit；移动端 sheet 复用同一分组/标签/滑杆实现但未做真机验证。
- Notes（范围外遗留，供下轮）：① 移动端 sheet 的设置入口从底部移到顶部后，原 `.quickforge-model-sheet-footer` 样式已无使用方，可择机清理；② 分组徽标颜色目前只有中性灰（设计稿里的按 provider 哈希配色未落地，仓库无品牌 logo 资源）；③ 侧聊/共享页不传思考参数，因此它们的模型弹层不显示滑杆，与「侧聊控件 inert」的既有语义一致。

## workflow-detail-chat-cards（done，2026-10-24）

- Goal：用户反馈「Workflow 详情里面的 tools 调用和 sub agent 调用，应该样式和最外层的保持一致要复用普通对话里面的信息」。
- 结论（一句话）：详情面板的步骤行整卡替换为普通对话同一份组件——工具行 = 聊天区同一颗 `ToolMessage`（local-workspace / MCP 渲染器，args/resultPreview/quickforgeTiming 合成 toolCall/result），Agent 行 = `renderSubagentRunSummary`（run_subagent 摘要卡，queued 用新加的 `disabled` 选项）；工作流自己只保留右侧时间轴轨道列（卡片列 + 轨道列 grid），不再各写一套步骤 UI。
- 改动文件：
  1. `src/components/workspace/WorkflowRunDetailContent.tsx`：ToolStep → `ToolMessage` + `workflowToolCall` / `workflowToolResult`（queued 不合成 result；error/aborted 置 `isError`；`startedAt/durationMs` 写进 `details.quickforgeTiming` 驱动同款耗时徽标）；AgentStep → `renderSubagentRunSummary`（`buildWorkflowSubagentRunPayload` + `subagentRunStore` 回填 + `shouldPublishSubagentRunPayload` 发布，与 `SubagentToolRenderer` 同口径；label=任务名、meta=profile、运行中流光、error 进 title）；`onOpenAgentRun` prop 与 PhaseSection 的 detailed 透传删除；`jumpToFailure` 改点嵌套卡的 `details.querySelector('summary')`、闪烁整条步骤行。
  2. `src/components/workspace/WorkspaceInspector.tsx`：删除 workflow 分支的 `onOpenAgentRun` 接线与 `buildWorkflowSubagentRunPayload` / `shouldPublishSubagentRunPayload` / `openSubagentRunTab` 解构（点击由卡片自身走 `OPEN_SUBAGENT_RUN_EVENT`，store 最新快照优先，链路等价）。
  3. `src/lib/tool-renderers/subagent-tool-renderer.tsx`：`SubagentRunSummaryOptions` 新增 `disabled`（强制禁用仍保完整视觉；workflow queued Agent 复用时用——canonical runId 恒存在、canOpen 恒 true，默认判定表达不了）。
  4. `src/styles/workspace/workflow-detail.css`：步骤行改 `grid-template-columns: minmax(0,1fr) var(--wf-tl-track)`（轨道钉 `grid-column:2; grid-row:1; height:1.375rem`，不随展开体长高）；工具缩进移到卡片列；`details[open] > div` 实底遮网格线；绝对定位层统一 `--wf-tl-plot-left/-plot-right` 变量；**新增 `--wf-tl-track-plot`**（双基准修复，见坑①）与窄媒体覆盖；删除 `-row / -row-head / -row-label / -row-icon / -step-body / -step-meta / -agent-link / -sr / -field-label / -error-text` 及 `--wf-tl-label(‑plot)`；is-flash 与 reduced-motion 改整条步骤行。
  5. `src/lib/i18n.ts`：删除孤儿键 `workflowAgentQueued / workflowAgentRunning / workflowAgentFailed / workflowAgentAborted / workflowDetailPending`（中英各 5 条）。
  6. `tests/frontend/workflow-renderer.test.ts`：import `getLocalWorkspaceTools` 注册渲染器（markup 断言走真实 local 卡）；「共享构件复用」用例重写为「整卡复用」（ToolMessage/workflowToolCall/workflowToolResult/renderSubagentRunSummary/buildWorkflowSubagentRunPayload/quickforgeTiming + markup 含 quickforge-local-tool-shell、src/a.ts、quickforge-subagent-tool）；「Agent 直达」用例重写为「聊天 subagent 卡 + 自身打开链路」（onOpenAgentRun/agent-link 不存在、queued disabled）；CSS 契约改 step grid / 轨道列 / details[open] 实底 / is-flash 整行 / `--wf-tl-track-plot` 双基准回归（含窄媒体）；`payload.detailed` 断言反转（详细模式改由聊天卡读全局设置）。
  7. 文档：`docs/wiki/src/components/README.md`（两处重复小节的步骤行/时间轴/Agent 行口径重写）、`docs/wiki/src/lib/README.md`（tool-renderers 条目 Agent 行复用方更正 + workflow-subagent-detail 消费方）、`docs/wiki/src/styles/README.md`（workflow-detail.css 条目）、`docs/architecture/workflow-orchestration.zh-CN.md`（7.3 步骤行复用段重写 + i18n 键清单 -5 + 样式段 track-plot 口径）。
- 被避免的坑：① **clamp 百分比双基准复发**——`--wf-tl-track: clamp(8rem, 34%, 12.5rem)` 在 grid-template-columns / flex-basis 按行内容盒（W−1.75rem）、在 absolute `left` 按包含块（W）解析；640px 被 clamp 上限钉住看不出来，380px 百分比段实测错位 **7.7px**。绝对定位层改 `--wf-tl-track-plot: clamp(8rem,(100%-1.75rem)*0.34,12.5rem)`（窄媒体 0.30），修复后 640/380px 五层对齐 ≤0.01px。与旧 `--wf-tl-label-plot` 同一教训，本轮已把回归契约写进测试。② harness 样式表必须走 http 引用——file:// 的 `<link>` 在 http 页面被拦，第一轮测的是无样式 DOM。③ `renderSubagentRunSummary` 的 canOpen 对 workflow 载荷恒 true（canonical runId 必在），queued 禁用必须走新加的 `disabled` 选项。
- Evidence（验证）：定向 workflow-renderer **37 passed**（+1 契约扩充）；相邻 workflow-step-interaction / subagent-run-detail-react / chat-surface-tool-message 共 60 passed；`tests/frontend` 全量 **251 文件 / 3009 passed**；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**；`npm run lint` 0 error（仅既有 GitToolsPinnedSummary warning）；`npx tsc -b` 通过；`npm run build` 成功。真实渲染：生产 CSS harness + Playwright，640/380px 轴绘图区/行绘图区/网格层/游标层/阶段跨度条/并行标注对齐 ≤0.01px、条形不出绘图区、卡片不侵入轨道、无横向溢出，卡片文案确认复用（「读取文件 · workflow-run-detail.ts」「运行命令 · 跑一遍测试」「扫描 src 目录 · explore」）。
- Boundaries：不改服务端 details 契约与时间轴数据推导（workflowTimeline/workflowPhaseSteps 原样）；未新增依赖；未触碰 dist/、package-dist/、package-offline/（harness 引用的 dist 为构建产物，仅本地验证）；未创建 Git commit。
- Notes（范围外遗留，供下轮）：① i18n 里 `workflowAgentDone / workflowAgentToolCalls / workflowAgentSchema / workflowDetailTimelineHint` 是更早已无引用的孤儿键（本轮未扩范围删除）；② `@media (max-width: 30rem)` 按视口而非面板宽度生效——宽视口下 380px 面板取不到窄轨道覆盖（历史行为，本轮沿用）；③ 详情页 `--wf-tl-track` 在极宽面板被 12.5rem 上限钉住、卡片列很宽，属预期；④ now-chip 与近旁刻度的短暂重叠仍按上轮取舍（运行态优先）。

## frontend-god-components-split（done，2026-10-24）

- Goal：用户先要求「评审当前项目是否存在前端上帝组件」（评审结论：App.tsx 2431 行单组件 / ChatSidebar.tsx 2216 行 69 props 4 处重复行 / ChatPanelHostProps 巨型平铺接口为 Tier-1），随后设定 goal「架构最优 最佳实现 你拆分一下模块，不影响功能和产品体验就可以直接执行」。
- 结论（一句话）：三个 Tier-1 全部拆分——ChatSidebar 2216→1165 行装配层 + `chat-sidebar/` 14 模块（四分区重复行统一为 SidebarSessionRow 变体组件）；App.tsx 2431→2019 行（6 个状态域 hook + 3 个 `components/app/` 区域组件）；ChatPanelHostProps 五分组类型级重组（运行时零变化）。DOM/类名/交互逐字节保真，测试钉死的接线留在原位。
- 改动文件：
  1. `src/components/sidebar/chat-sidebar/`（新增 14 文件）：`SidebarSessionRow.tsx`（variant=pinned|timeline|project|global，pinned 保留 div[role=button]+Enter/Space、timeline 时间槽不加运行/未读态、project 保留 pl-8——三处差异均按「不影响功能」原样保留并写入注释）、`sidebar-classes.ts`（静态类名 + `sidebarRowClass(sidebarOpen)` 工厂）、`sidebar-utils.ts`、`SessionTitleMarquee` / `SessionDisplayControls` / `SortableSidebarItems` / `SessionHoverTip` / `ViewSortMenu` / `ProjectMenu` / `SidebarSearchDialog` / `SidebarHeaderNav` / `SidebarFooter` 叶子、`useSidebarResize` / `useSidebarSessionDisplay` hooks。`ChatSidebar.tsx` 保留 props 装配（69 成员契约不变）、区块/项目 DnD 接线、菜单/删除/悬停状态机。
  2. `src/hooks/`（新增 6）：`useSidebarOrdering`（区块顺序+视图/排序持久化）、`useProjectExternalOpen`（explorer/vscode/idea 打开）、`useDesktopTitlebarMenu`、`useAgentApprovalActions`（工具审批/ask 应答/compact 审批）、`useTurnFileRollback`（轮次回滚目标收集+记账）、`useMobileSidebar`（抽屉焦点/Escape + 9 个 *FromSidebar 包装）。
  3. `src/components/app/`（新增 3）：`ConversationHeader`（标题/项目 chip/分支菜单/对话-轨迹切换/⋯ 菜单，`headerRef` 由 App 传入）、`DesktopTitlebarMenu`、`StartupScreens`。两处 ChatSidebar 实例、GitToolsPinnedSummary 工具条、ChatPanelHost/WorkspaceInspector 接线**刻意留在 MainApp**（被 git-tools-pinned-summary / sidebar-* / assistant-artifact-card 等源码契约测试钉死）。
  4. `src/components/chat/ChatPanelHost.tsx`：ChatPanelHostProps 拆为 Session/MessageAction/Approval/Artifact/View 五个子接口交叉类型——成员名与顺序不变、解构与调用方零变化，纯类型可读性重组。
  5. 测试：新增 `tests/frontend/helpers/sidebar-module.ts`（模块源码统一入口，jsdom 下 process.cwd() 解析，同 app-css 做法）；重写 `session-row-hit-area` / `sidebar-session-action-alignment`（行组件断言一次 + 装配层 sessionRowProps 透传断言）；`sidebar-section-order` / `sidebar-section-header-hit-area` / `sidebar-new-chat-routing` / `motion-design` / `conversation-trace-contract` / `git-tools-pinned-summary` / `assistant-artifact-card` 搬家断言指向新文件（motion-design 退场 token 计数 10 → 「ChatSidebar 项目行 2 + SidebarSessionRow 2」双向锁定，语义不放宽）。
  6. 文档：`docs/wiki/src/hooks/README.md`（18→24 表）、`docs/wiki/src/components/README.md`（两处目录树 + 两处 ChatSidebar 段补拆分契约）、`docs/wiki/src/README.md`（App.tsx 段补第二轮拆分说明）。
- 被避免的坑：① 契约测试 `indexOf('actionOverlayClass')` 会先命中 import 语句——锚点必须用 `className={cn(actionOverlayClass`；② jsdom 下 `import.meta.url` 不是 file scheme，测试 helper 读源码要用 `process.cwd()`（app-css 同款）；③ `useProjectExternalOpen` 端点是 `/open-in-vscode`、`/open-in-idea`（不是 `/open-vscode`），搬运时一度写错，靠与原文件逐字对照抓回；④ useTurnFileRollback 的 layout effect 依赖必须用解构后的字段（context 对象每渲染新建，整对象作依赖会变成每帧执行）。
- Evidence（验证）：侧栏定向 9 文件 **81/81**；`tests/frontend` 全量 **251 文件 / 3009 passed**；`npm run test` 全量 **424 文件 / 4915 passed / 2 skipped**（与拆分前同基数）；`npm run lint` **0 error**（仅既有 GitToolsPinnedSummary warning）；`npx tsc -b` 通过；`npm run build` 成功。
- Boundaries：不改任何 DOM/类名/交互/文案；不新增依赖；未触碰 dist/、package-dist/、package-offline/；未创建 Git commit。
- Notes（范围外遗留，供下轮）：① WorkspaceInspector.tsx（1997 行 26 props）与 ScheduledTasksPage.tsx（1248 行 23 useState）为边缘候选，本轮未动；② MainApp 内置顶摘要数据派生（pinnedSummary* memos + goal sync，约 90 行）可再抽 `usePinnedSummaryData`，因 agent 联合类型需结构化泛型而推迟；③ GitToolsPinnedSummary 既有 exhaustive-deps warning 仍在；④ 会话行两处历史不一致（timeline 缺运行指示 / pinned 用 div[role=button]）已在 SidebarSessionRow 注释标记，若要统一需单开一轮；⑤ docs/wiki/src/components/README.md 存在两份重复目录树与重复 ChatSidebar 段（历史遗留），本轮按原样双处同步。

## workflow-detail-visual-optimize（done，2026-10-23）

- Goal：用户要求「优化一下 workflow 的详情展示，先设计 html 给我看」，确认后回复「按设计稿执行」。设计稿 + 实施同一 feature 闭环。**次日追加用户验收反馈**：「不要绿色 icon 不要显示个发送消息 直接点击可以到 运行详情就好了」——Agent 行首的绿色机器人图标与展开后的 prompt 文本块被否决，改为整行直达。**再追加（同日）**：「不要显示任务 只保留详情入口」——Composer 运行中 subagent 指示器菜单项删除任务全文行（quickforge-subagent-running-task），只留 label + 时长的纯详情入口，任务文本保留在 aria-label；后台命令菜单项不受影响。改动 `subagent-running-indicator.ts` + 定向测试（13 passed），全量 4915 passed / lint 0 error / tsc 通过，wiki 目录行同步。
- 结论（一句话）：单页合并视图之上加八处读数效率层（共享网格 / 运行游标 / 阶段跨度条 / 并行组 bracket×N / 错误定位 / 日志 console 块+折叠 / 展开体 rail / 概览减负+预算迁 sheet 头），不改单页结构、时间轴几何与服务端 details 契约。
- 设计稿：`docs/design/workflow-detail-optimize.html`（现状复刻 + P1–P8 + 决策表 + 可交互原型 + 落地清单）。
- 改动文件：
  1. `src/lib/workflow-run-detail.ts`：`WorkflowTimelineEntry` 新增 `parallelGroupSize`（并查集组大小，非并行 1）；新增 `workflowPhaseSpan(phase, timeline)`（阶段最早起点→最晚终点，无可定位条目返回 null；运行钳制由调用方做）。
  2. `src/components/workspace/WorkflowRunDetailContent.tsx`：StepTrack 删行内网格与逐行「并行」标注；TimelineAxis 可挂 `-now-chip`；PhaseSection 重写（`-phase-text` 文字块钳宽 + `-phase-track/-phase-bar` 跨度条 + 耗时右对齐 + `data-collapsed` + 连续并行行包 `-parallel-group` + 组首 `workflowDetailParallelCount` + 日志 `LOG_FOLD_LIMIT=6` 折叠）；外壳重写（图例并入第一行、派生统计行条件渲染、预算迁 `-sheet-meta`、`-grid-layer`/`-now-layer` 注入、错误横幅 `-error-jump` + `jumpToFailure`——阶段折叠先点头、再 `summary.click()` 展开行、scrollIntoView 居中 + `is-flash` 1.6s，reduce-motion 双侧降级）。
  3. `src/styles/workspace/workflow-detail.css`：新增 grid/now 层（同 inset、z-index −1/1）、now-chip、phase-text/track/bar（四种 tone）、阶段耗时与 chevron 绝对定位、parallel-group bracket、step-body rail+实底（z:2）、日志 console 块+toggle、error-jump、sheet-meta、step-flash keyframes；删行内 `-grid`；**新增 `--wf-tl-label-plot`**（见坑①）并同步窄媒体覆盖；错误横幅改单行 flex；合并重复声明两份的 legend 与 phase-index 规则。
  4. `src/lib/i18n.ts`：新增 `workflowDetailNow/NowTitle/LocateFailure/LogsExpand/LogsCollapse/ParallelCount/BudgetLine`（中英各 7 条）；删除 `workflowDetailBudget` / `workflowDetailParallelBadge`（中英各 2 条）。
  5. `tests/frontend/workflow-renderer.test.ts`：+6 例（并行组单标注×N、跨阶段跨度条+null 阶段、网格层/游标/跨度条渲染与终态消隐、日志 8→6 折叠、定位按钮与预算迁移、parallelGroupSize）；CSS 契约新增整段（无行内 grid、层级 z 序、label-plot inset、bracket/rail/logs outline、flash+reduce-motion、legend/phase-index 收敛为 1 份）；i18n 键清单 +7。
  6. 文档：`docs/wiki/src/components/README.md`（两处重复段：概览条/读数效率层①–⑦/label-plot 基准/foot 预算行）、`docs/wiki/src/lib/README.md`（timeline 条目 + workflowPhaseSpan 小节；两处过时「三视图/SVG 甘特/预算在概览条」段改为单页口径）、`docs/wiki/src/styles/README.md`（workflow-detail.css 条目）、`docs/architecture/workflow-orchestration.zh-CN.md`（i18n 键清单补 workflowDetail* 系列 + 样式段重写为当前契约）。
- 被避免的坑：① **clamp 百分比双基准**——`--wf-tl-label: clamp(5.5rem, 30%, 9.5rem)` 在 flex-basis 里按行内容宽（W−1.75rem）解析、在绝对定位 `left` 里按包含块 padding-box（W）解析；百分比参与区间（面板约 300–500px）两层错位实测 6.8px（640px 时被 max 钉住看不出来）。绝对定位层统一改 `--wf-tl-label-plot: clamp(5.5rem,(100% - 1.75rem)*0.3,9.5rem)` 复刻行内容宽基准。② `ToolDetails` 是受控 `<details open={open} onToggle>`，直接改 `open` 属性会被 React 状态盖回，展开必须走原生 `summary.click()` 让 onToggle 回写。③ 网格层 z-index:-1 会被任何实底元素遮住（含行 hover 背景展开的正常层序），展开体/日志块必须显式实底+定位否则文字被竖线穿过。
- Evidence（验证）：定向 workflow-renderer 36 + workflow-step-interaction 8 + css-architecture 5 = **49 passed**；`npm run test` 全量 **424 文件 / 4914 passed / 2 skipped**（exit 0，label-plot 修复后复跑）；`npm run lint` 0 error（仅既有 warning）；`npx tsc -b` 通过；`npm run build` 成功。真实渲染：临时 harness 链接生产 CSS，Playwright 实测 640/460/380/320px + 375px 视口六层（行绘图区/跨度条/网格层/游标层/轴绘图区/并行标注）左缘对齐误差 <1.5px、游标 chip 与竖线重合、阶段耗时与行耗时右缘一致、无横向溢出（harness 用后即删）。
- 追加改动（2026-10-24，用户验收反馈）：`WorkflowRunDetailContent.tsx` 的 AgentStep 从 `ToolDetails` 展开改为 `quickforge-workflow-detail-agent-link` 整行直达按钮（点击 = `onOpenAgentRun`，queued/无句柄时 `disabled`），删除 AgentTaskBlock / input-clamp 接线 / 行首 StepIcon / `workflowDetailOpenAgentDetails` 键；CSS 删 `-agent-open`/`-step-actions`、加按钮 reset + hover/focus、闪烁选择器覆盖直达按钮；`workflow-renderer.test.ts` 新增「makes each agent row a direct link」用例 + 改写 stateKey/subagent-task 断言 + flash 双选择器正则。验证：定向 45 passed，全量 **424 文件 / 4915 passed / 2 skipped**，lint 0 error，tsc/build 通过。
- Boundaries：未改单页结构/聊天卡/服务端契约/依赖；未触碰生成产物；未创建 Git commit。工具行的图标与展开体保留（用户仅否决 Agent 行）。
- Notes（范围外遗留）：① `docs/architecture/workflow-orchestration.zh-CN.md` 7.3 仍有一段描述**已删除的聊天卡内联展开体**（含 `-tool-zone` 等已删 class），为 workflow-inspector-panel 轮的文档漂移，本轮未扩范围重写；② 阶段头 chevron 从 flex 流改绝对定位后，`.quickforge-workflow-detail-phase-head .quickforge-tool-chevron` 原有 opacity 过渡保留但阶段头 hover 不再提亮 chevron（原也无此规则，无回退）；③ 现在芯片（now-chip）与近旁刻度标签在轴内可能短暂重叠（运行态信息优先，设计稿已注明）。

## workflow-detail-visual-optimize（design，2026-10-23）

- Goal：用户要求「优化一下 workflow 的详情展示，先设计 html 给我看」。设计稿已产出，等确认后实施。
- 产出：`docs/design/workflow-detail-optimize.html`（约 58KB 自包含单文件、零依赖、纯 LF）。01 现状 1:1 复刻 + P1–P8 问题清单；02 决策表；03 可交互原型（浅/深 × 运行中/已完成/失败 × 640/380 × 减少动效；同一渲染器 + legacy 开关出新旧两形态）；04 文件级落地清单 + 非目标。
- 八处优化：概览条减负（预算→脚本 sheet 头）/ 共享网格层（删逐行 5×N 网格）/ 运行游标（轴 chip「现在 4m10s」+ 同百分比竖线）/ 阶段跨度条（阶段头与行绘图区同几何，运行中·失败按时刻钳制）/ 并行组 bracket +「并行×N」（虚线双编码保留）/ 错误横幅「定位失败步骤」（跳转+1.6s 闪烁，reduce-motion 纯滚动）/ 日志 console 块 + >6 行折叠 / 展开体左 rail + 实底。顺带发现 `workflow-detail.css` legend 规则重复声明两份（114–148 与 444–478），实施时合并。
- Evidence：内联脚本 `node --check` 通过；Playwright 实测对齐（跨度条/网格层/游标层与行绘图区误差 <1.5px）、交互（定位/折叠/sheet/日志展开/状态切换）、380px 无溢出、深色 token 均通过；中途修复 `.panel.narrow` 缺 `width:380px`。
- Boundaries：文档类改动，未跑 test/lint/build；未触碰 src/、server/、测试、生成产物；未创建 Git commit。
- Notes：elapsed 游标不需要服务端新字段（运行中帧 `max(startedAt + durationMs)`）；实施顺序建议 纯 CSS 三件 → 组件层四件 → 游标与测试契约。

## todo-summary-hover-popover（done，2026-10-23）

- Goal：用户要求「对话上面的任务 todo 样式优化一下，默认收拢一下，划过再弹窗，划走就收缩，里面只显示任务，不显示任务其他的文案，先设计一下 html」。先出设计稿 `docs/design/todo-hover-popover.html`（浅/深色 + 固定展开 + 减少动效开关），用户确认「确认，开始实施」后落地：收拢形态选 A（环 + 计数），移动端保留点击弹出。
- 结论：Composer 上方 TodoWrite 摘要从「默认展开的整行列表」改为「默认收拢的进度胶囊 + 悬停/聚焦时从正上方弹出的任务浮层」；浮层内容只剩任务行（状态图标 + 文本），标题、统计句、「已更新」标记、chevron 与逐行状态文案全部移除，状态词降级为视觉隐藏的读屏文本。
- 改动文件：
  1. `src/components/chat/surface/TodoWriteSummary.tsx`：DOM 收成 `section > trigger > [button.pill, popover]`；`hovered` / `focused` / `pinned` 三个开合状态 + `HOVER_CLOSE_DELAY_MS=120` 宽限；`onPointerOver/Out` 忽略 `touch`；`pointerDownRef` 让鼠标点击不把焦点当展开信号；`pinned` 只在 `(hover: none)` 下由 click 切换，Escape 关闭；`trackedOpenKey` 在快照清空时于 render 阶段重置开合状态（避免 setState-in-effect）；退休逻辑（`retiringKey` / `retiredKey` / `data-fading`）原样保留。
  2. `src/styles/chat/todo-summary.css`：重写为「收拢胶囊 + 向上弹出浮层」；浮层 `position: absolute; bottom: 100%`、`padding-bottom: 0.375rem` 作为命中区内的桥接间距，卡片单独承担描边/背景/阴影，`data-open` 驱动显隐（`visibility` + `pointer-events`，不用 `display:none` 以保留过渡）；列表限高桌面 14rem / 移动端 10rem；`.quickforge-todo-summary-status-label` 改为 clip-path 视觉隐藏；`prefers-reduced-motion` 取消位移/缩放与旋转动画。
  3. `src/styles/chat/goal-workflow.css`：只更新一行注释（历史卡仍保持 7.5rem 基准，不再与胶囊列表共用）。
  4. `src/lib/i18n.ts`：删除已无引用的 `todoWriteStats` / `todoWriteUpdated`（中英各两条）。
  5. `tests/frontend/todo-write-summary.test.ts`：渲染用例重写为「默认收拢 / 只渲染任务行 / hover 开合 / touch 忽略 / 键盘聚焦 / Escape / 新快照不自动展开 / 清空重置」共 26 例。
  6. `tests/frontend/todo-write-renderer.test.ts`：CSS 契约改为断言浮层绝对定位向上弹出、section 自身仍在正常流、无 fixed/backdrop-filter。
  7. `docs/design/todo-hover-popover.html`（新增）：设计稿。
  8. 文档：`docs/wiki/src/components/README.md`（两处 TodoWrite 摘要段落 + panel-decoration 条目）、`docs/wiki/src/styles/README.md`（todo-summary.css 说明）。
- 关键取舍：开合用 React 状态而不是 CSS `:hover`——浮层关闭态需要 `visibility: hidden`，`aria-expanded` 必须与屏幕状态严格一致；浮层作为 trigger 的后代，指针从胶囊移进浮层不会触发 `pointerout`，比「CSS hover + 伪元素桥接」更不容易闪断。浮层绝对定位使 Dock 高度恒定，开合不再压缩上方消息区（旧方案会）。
- 被避免的坑：① 鼠标点击胶囊会顺带 focus，若把 focus 也算作展开信号，点击后浮层会一直开着——用 `pointerDownRef` 在指针按下期间跳过 focus 展开；② 在 effect 里同步 `setState` 触发 `react-hooks/set-state-in-effect`，改为 render 阶段按 `trackedOpenKey` 派生重置；③ 用 `hidden` 关浮层会打断 CSS 过渡，改用 `visibility` + `pointer-events`。
- Evidence（验证）：定向 `todo-write-summary` + `todo-write-renderer` = **37 passed**；`npm run test` → **424 文件 / 4908 passed / 2 skipped**，exit 0；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` → 成功；`npx tsc -b tsconfig.app.json` → 无输出。视觉用 Chrome headless 加载真实 `todo-summary.css` 截图核对浅/深色与收拢/展开，并用 `--dump-dom` 读 computed style 验证浮层定位、行底色、删除线、状态词 clip-path。
- Boundaries：未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit；未改动置顶摘要（`GitToolsPinnedSummary`）与 `todo_write` 历史卡的视觉；临时验证页与截图（`docs/design/todo-summary-harness.html`、`docs/design/.shots/`）已删除。
- Notes（本次范围外、未处理）：① `todoWriteTitle` 仍作为 section 与胶囊 button 的 `aria-label` 使用，未改文案；② 移动端浮层宽度固定 `min(20rem, 100vw - 1.5rem)`，极窄屏未单独适配；③ 浮层 `z-index: 30` 依赖 composer dock 祖先链无 `overflow: hidden`，后续如新增裁切容器需复核。

## css-architecture-split（done，2026-10-23）

- Goal：用户要求「不需要打补丁，需要完整最佳的架构，必要必须重构，保持架构最佳，但不要影响现有交互形态和样式」。把 10,173 行的单体 `src/index.css` 做完整拆分，而不是继续在大文件里加规则。
- 结论（一句话）：全局样式改为「唯一有序入口 + 按功能域拆分的模块」：`src/styles/index.css` 只保留 Tailwind + 按原源顺序排列的 38 个模块 import；入口顺序就是级联契约，模块间禁止互相 import；测试通过 `tests/helpers/app-css.ts` 递归内联入口图读取全局样式，并用 `css-architecture.test.ts` 固化入口/归属规则。
- 拆分粒度：
  - `foundation.css`（unlayered token / body / 滚动条 / 共享 keyframes）、`startup.css`、`motion.css`、`layout.css`、`markdown.css`、`highlight.css`、`ui/info-tip.css`。
  - `settings/`：shell / appearance / forms / select / controls。
  - `chat/`：24 个功能面模块（messages、composer×3、process×2、tool×3、runtime notices、artifact/goal/workflow/todo、pinned summary、file rollback 等）。
  - `workspace/`：workflow-detail、inspector-tabs。
  - 组件自持 CSS（conversation-trace.css / goal-inspector.css / goal-summary.css）保持原样，作为懒加载 surface 的隔离样式例外。
- 拆分过程中顺手归位的错位规则：`.quickforge-subagent-title { flex }` 从 math.css 移回 tool-summary.css；原 subagent.css 拆为 markdown-content.css + context-compaction.css；settings select 只保留自定义下拉框；file-reference 的 20rem 高度覆盖收敛到 composer.css。没有改任何声明值。
- 零回归验证：
  1. 初次结构搬迁后，构建出的 `index-*.css` 与重构前逐字节一致（所有声明、顺序、Tailwind utilities 完全相同）。
  2. 归位/合并后，用 PostCSS 对构建前后 CSS 做规则级比对（selector → declarations，按 at-rule 上下文聚合）：3393 条规则、0 语义差异；其余 CSS chunk（katex/editor/floatingMenu/WorkspaceInspector 等）逐字节一致。
  3. `npm run test` → 424 文件 / 4908 passed / 2 skipped，exit 0；`npm run lint` → 0 error（仅既有 GitToolsPinnedSummary warning）；`npm run build` → 成功；`css-architecture.test.ts` → 5 passed。
- 测试迁移：新增 `tests/helpers/app-css.ts`（递归解析入口 import，支持 jsdom 下用 `process.cwd()`）；33 个测试文件从直接 `readFileSync('src/index.css')` 改为 `appCss`/`globalCss`，CSS 契约断言内容不变。
- 文档：`DESIGN_LANGUAGE.md` 新增「CSS 架构」；`docs/wiki/src/README.md` 重写样式架构段并修正路径；新增 `docs/wiki/src/styles/README.md`（模块地图、归属规则、验证流程）；`docs/architecture/workflow-orchestration.zh-CN.md` 路径改为 goal-workflow.css / workflow-detail.css；`docs/wiki/src/components|lib/README.md` 的旧路径同步。
- 边界/未做：不新增或升级依赖；未手工修改生成产物；未创建 Git commit；没有做真实浏览器逐屏目视验收（但有构建产物语义比对兜底）；没有把聊天/设置 CSS 拆成按路由懒加载的独立 chunk——当前保留单 bundle 是为了保证未经审计的跨模块覆盖不依赖 chunk 加载顺序；设计稿 `docs/design/*.html` 与 `docs/archive/*` 中的历史路径未改。
- Notes（后续可选）：① 若要进一步做 CSS 代码分割，需先把 4 组跨模块 selector 收敛或改成 cascade layer，并补真实视觉回归；② `docs/design/*.html` 可在下次设计稿更新时顺手迁移路径；③ 现有 4 组跨模块覆盖已登记在 `tests/frontend/css-architecture.test.ts`，新增覆盖必须先登记。

---

## ask-user-remark-on-confirm（done，2026-10-23）

- Goal：用户要求「askuser 这个 tools 交互显示最后确认底部还希望可以加一个补充信息」，先出 HTML 设计稿评审，确认后落地。评审稿给了 A/B/C 三案，用户选择「按推荐执行」＝方案 C（第 N+1 条回执行）。
- 方案 C 语义：补充信息不是某一题的答案，而是整次提交的限定语。因此它**不进** `answers[]`（不污染逐题结构），而是在回执列表末行单独成行——虚线引导线 + 笔形图标，与问答同层但一眼可辨「这条是自由输入」，且不计入「N 问」。
- 改动（13 个源码/测试文件 + 2 处 wiki + 1 份设计稿）：
  1. `src/components/chat/panel-decoration/ask-user-card.ts`：`AskUserCardDeps.onSubmit` 增加第二参数 `remark`；新增卡片级 `let remark = ''`；review 分支的 `body.innerHTML` 末尾插入 `.quickforge-ask-review-row--remark`（内嵌 `.quickforge-ask-remark-field` + 笔形 svg + `.quickforge-ask-remark-input` 自适应高度 textarea + `.quickforge-ask-remark-optional`「可选」）；**Enter 保持换行**（与逐题补充框的 Enter 前进语义相反，多行备注是正常输入）；提交时 `deps.onSubmit(answers.map(...), trimmedRemark || undefined)`。
  2. `src/components/chat/ChatPanelHost.tsx`：`onAnswerAsk` 两处类型加 `remark?: string`；`onSubmit` 回调把 remark 作为第 4 参数透传。
  3. `src/App.tsx`：`handleAnswerAsk` 加 `remark` 参数并计入 `answerAsk` payload。
  4. `src/lib/server-agent.ts`：`answerAsk` payload 类型加 `remark?: string`，请求体带 `remark`。
  5. `server/agent-approval-responses.mjs`：`answerAsk` 接收并归一化 remark（`trim` + `slice(0,4000)`，空白丢弃），skip 时不写入。
  6. `server/agent-approval-orchestrator.mjs`：`finish()` 把 remark 传给 `formatAskResult` 并写入 `details.remark`。
  7. `server/ask-store.mjs`：`formatAskResult(questions, answers, skipped, reason, remark)` 在「用户的回答」末尾追加一行 `补充信息：…`。
  8. `server/routes/agent.mjs`：`/answer-ask` 透传 `body?.remark`。
  9. `src/lib/tool-renderers/ask-user-tool-renderer.tsx`：`AskUserReviewRows` 加 `remark?`，`askUserReviewRowsFromDetails` 读 `details.remark`（trim 后非空才算），渲染时在回执行末尾追加同款虚线行（标签 `askUserRemarkLabel`，skip 时不显示）。
  10. `src/index.css`：新增 `.quickforge-ask-review-row--remark`（虚线 + 42% primary 引导线）+ `.quickforge-ask-remark-{field,icon,input,optional}`，窄屏 `@media (max-width:40rem)` 隐藏「可选」小字。
  11. `src/lib/i18n.ts`：新增 `askUserRemarkLabel` / `askUserRemarkPlaceholder` / `askUserRemarkOptional`，中英各一份。
  12. 测试：`tests/frontend/ask-user-card.test.ts` 新增两条（回执行结构与样式契约、remark 全链路透传 + 历史持久化 + i18n 双语）；`tests/server/ask-user-tool.test.mjs` 新增 `formatAskResult` 末行用例（含空白/缺省不产生空行）；`tests/server/agent-manager-domains.test.mjs` 新增 `answerAsk` remark 归一化与丢弃用例。
  13. 文档：`docs/wiki/src/components/README.md`（两处重复段落同步补口径）、`docs/wiki/src/lib/README.md`（answerAsk 第四个字段）；评审稿落位 `docs/design/ask-user-remark-mock.html`。
- 验证 / Evidence：`npx vitest run ask-user-card / ask-user-tool / agent-manager-domains / agent-approval-orchestrator` → **70 passed**；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` → 成功（`tsc -b` + vite，6.25s）。`npm run test` 全量 **4895 passed / 2 failed**，两处失败与本次无关：① `scheduled-tasks.commands` 的 `EPERM ... scheduled-tasks.json.tmp -> scheduled-tasks.json`（Windows 临时文件 rename 抖动，单跑 24 passed）；② `workflow-renderer` 的「阶段下挂步骤」用例（来自工作区既存未提交的 `WorkflowRunDetailContent.tsx` 重写，`git status` 显示该文件本轮未触碰）。
- 边界：未新增或升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit；`remark` 刻意不写进 `ServerAgentAskAnswer`。
- Notes（未做，供下轮）：① remark 无字数计数与上限提示，只有服务端 4000 字截断，超长会静默丢尾；② 刷新/重连后回执步的 remark 不持久（与既有 wizard 进度归零同源问题 ⑥）；③ remark 行未加 `aria-label`，无障碍仍走 placeholder（与既有卡片同级问题 ⑧）；④ 回传给模型的文案仍是硬编码中文「补充信息：」（与既有 `formatAskResult` 的 ⑩ 同源）。

---

## workflow-detail-single-page（done，2026-10-23）

- Goal：用户反馈运行详情里的「时间轴 / 阶段 / 日志」三个分段 tab 需要点击切换、用起来不顺手，要求「就一个页面不要点击切」。先出 HTML 设计稿评审（`docs/design/workflow-detail-single-page.html`），确认后落地。
- 结论（一句话）：三视图本来就是同一份运行数据的三种投影（时间轴读 `startOffsetMs/durationMs`、阶段读 `phases[]`、日志读自带 `phase` 的 `logs[]`），合并成一页连续滚动后信息量不减、反而可以互相参照：整页共享一根时间轴（刻度条吸顶），每个阶段 = 粘性阶段头 + 该阶段的行 + 该阶段自己的日志。
- 改动（4 个源码/测试文件 + 2 处 wiki + 1 份设计稿）：
  1. `src/components/workspace/WorkflowRunDetailContent.tsx`：删除 `DetailView = 'timeline' | 'phase' | 'log'` 状态、`role="tablist"` 分段控件与三视图分发（原 `:437` / `:452`）。新结构：概览条（pill / 耗时 / 规模 / 并发峰值 / 比串行快 / 预算 + **图例常驻**）→ 唯一滚动容器 `.quickforge-workflow-detail-scroll` → 吸顶刻度条 `TimelineAxis` → 阶段小节 `PhaseSection`（粘性阶段头 + `workflowPhaseSteps` 交错渲染 + 该阶段日志）。`AgentStep` / `ToolStep` 都用 `<details class="-step">` 包整行 `<summary class="-row">`：Agent 展开是元信息 / 错误 / `payload.detailed` 门控的结果预览 /「运行详情 ↗」；工具行展开是 input/output/错误。空标题阶段桶（服务端只给空 phase 串）标题回退 `workflowDetailRunLogs`。
  2. `src/index.css`：删除 `-seg / -seg-count / -pane / -rows / -timeline / -log-list / -log* / -tool* / -agent* / -phase-rule`；新增 `-scroll` 滚动容器；`-axis` 改 `position: sticky; top: 0`、高 `var(--wf-tl-axis-h)`、加实底（否则滚动中的行会从刻度下面透出来）；`-phase-head` 改 `position: sticky; top: var(--wf-tl-axis-h)` + `background: var(--background)`、`z-index: 2`（低于刻度条 3）；`--wf-tl-*` 变量**上移到根节点** `.quickforge-workflow-detail`（含窄面板 `@media` 覆盖同一个选择器——只留在被删的 `-timeline` 里吸顶元素取不到）；新增 `-step / -step-body / -step-meta / -step-actions`。
  3. `src/lib/i18n.ts`：新增 `workflowDetailRunLogs`；删除随三视图下线的 `workflowDetailViewTimeline/Phases/Logs`、`workflowDetailNoLogs`、`workflowDetailPhaseCount`。
  4. `tests/frontend/workflow-renderer.test.ts`：把「三视图存在」用例改成「单页合并」；新增真实渲染用例（`renderToStaticMarkup` 断言刻度条 / `-scroll` / `-phase-logs` 同屏、Scan 日志落在 Scan 阶段后、Fix 日志落在 Fix 阶段后、整页无 `-seg`）；CSS 契约改成断言 `-scroll` 的 `overflow-y: auto` + 刻度/阶段头 `sticky` + 图例 `margin-left: auto` + `-seg / -pane` 已删除。
- 关键实现取舍：
  - **工具行只缩进标签列，右轨道不缩进** —— 否则不同层级的时间条会横向错位，同一根时间轴就失去「可以横向比较」的意义。从属关系由标签列内的 1px 连接线（`-tools::before`）+ `padding-left` 表达，符合 `DESIGN_LANGUAGE.md` 的缩进 + 细连接线例外条款。
  - **只有两个吸顶元素**：刻度条与阶段头，两者都必须有不透明底色；阶段体不再叠加左缩进（行自带左右 `0.875rem` 内距，方便 hover 背景贴边）。
  - 「运行详情 ↗」从「hover 才 `opacity: 1`」改为展开体里常显 —— 合并后它不再独占一行，隐藏入口会让功能变得不可发现。
- 验证 / Evidence：`npx vitest run tests/frontend/workflow-renderer.test.ts` → **29 passed**（含新增 3 处断言）；`tests/frontend` 全量 → **249 文件 2991 passed**；`npm run test` 全量 → **422 文件 4897 passed / 2 skipped**；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npx tsc -b` 通过；`npm run build` 成功（5.55s，仅既有 chunk 体积警告）。
- 边界：只改 run_workflow 运行详情的视图结构与样式，未动编排/数据层（`workflow-run-detail.ts`、`workflow-run-payload.ts`、服务端）；未改 Inspector Tab 去重/持久化与 Tab 标题；未新增或升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist）；未创建 Git commit。
- Notes（未做，供下轮）：① 未做真实浏览器目视验收——浅/深色 + 340px 窄面板下吸顶区域是否显重、工具行连接线与条形在视觉上是否对齐，需 `npm run dev` 看一眼；② 未加「跳到出错步骤」之类的滚动辅助，长运行（几十个阶段）里找失败点仍需手滚。

---

## trace-view-switch-neutral（done，2026-10-23）

- Goal：用户反馈「切换到轨迹的时候 轨迹的 icon 不需要有特殊的颜色 就和普通的对话一样就行」。
- 结论（一句话）：不是图标本身带色，而是 `conversation-trace.css` 里有一条只作用于「轨迹」页签的选中态覆盖规则——`:last-of-type` 把文字与图标染成 model 蓝并加 1px 内描边；删掉这条规则后两个页签完全同款。
- 改动（2 文件）：
  1. `src/components/chat/trace/conversation-trace.css`：删除 `.quickforge-chat-view-switch button[role='tab'][aria-selected='true']:last-of-type` 整条规则（`color: var(--qf-trace-text-model)` + `inset 0 0 0 1px` model 色描边）；轨迹页签回落到通用 `[aria-selected='true']`（`--background` 药丸 + `--foreground` 文字）。切换器内的 `--qf-trace-*` 令牌与容器作用域选择器保留（令牌仍被 `.quickforge-trace` 主体使用，删作用域会扩大改动面）。
  2. `tests/frontend/conversation-trace-contract.test.ts`：新增契约用例「keeps the chat / trace view switch neutral」，断言切换器自身规则块内不出现 `--qf-trace-hue-*` / `--qf-trace-text-*`（排除 `:where()` 令牌作用域）、选中态用 `--foreground` 且无 `inset 0 0 0 1px` 彩色内描边。
- 文档：未更新 `docs/wiki` 与 `docs/architecture`——两处只描述「对话区顶部切换器把 ChatSurface 换成 ConversationTraceView」，从未记录轨迹页签的 model 色选中态，本次是把实现回退到文档既有口径，无文档口径变化。
- 验证 / Evidence：`npx vitest run tests/frontend/conversation-trace-contract.test.ts` → **27 passed**（含新增 1 例；首版正则误命中 `:where()` 令牌块，改为行首锚定后通过）；`npm run lint` → 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` → 成功（`tsc -b` + vite 5.53s，仅既有 KaTeX/`node:fs` externalized 警告）。
- 边界：只删一条 CSS 规则 + 一条测试，不动 `ConversationTraceView.tsx` / `App.tsx` 的切换器结构、不动轨迹主体（时间总览、Ledger、Inspector）的任何色相、不动 `--qf-trace-*` 令牌值、不新增或升级依赖、未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist）、未创建 Git commit。
- Notes（未做，供下轮）：① 浅色/深色真机对比度未目视验收（`--foreground` 对白药丸应无障碍，但深色下药丸是 `--background` 深底 + 近白字，建议 `npm run dev` 各看一眼）；② `.quickforge-chat-view-switch` 里的 `--qf-trace-*` 令牌现在只为「不解耦作用域」而留，若后续确认切换器不再需要任何轨迹色，可把 `:where(.quickforge-trace, .quickforge-chat-view-switch)` 收窄成 `.quickforge-trace`（需同步 `scopes the hues` 契约用例）。

---

## goal-strip-pause-icon-two-bars（done，2026-10-23）

- Goal：用户反馈「执行中的 icon 显示有点问题，我看到只有单杠不是双杠」，问有没有现成 icon 可用。
- 结论（一句话）：**不是设计取舍，是代码少画了一条杠** —— `surface/GoalControlStrip.tsx` 的 `ACTION_ICON.pause` 只有 `M9.5 6v12` 一条 path，而设计稿 `goal-strip-icon-review.html` 一直是两条；测试只断言主操作按钮存在 + `aria-label`，从不检查图标内部，所以少一条杠一路绿灯。
- 现成图标评估（`lucide-react@1.11.0` 已装）：`Pause` 是两个描边 `rect`，12px 下每个只有 2.5px 宽、含 1.2px 描边 → 空心部分剩 0.1px，糊成两个实心块还带上下横边；`SquarePause` 带外框同样框死；`CirclePause` 的线只有 6 格比现状更短。根因是主操作按钮 24px 命中区塞 12px 图标 + 强制 `stroke-width:2.4`，凡是靠留白分隔两个小形状的图标都会糊，**这个尺寸下只有纯 `path` 组合安全**。
- 改动（2 文件）：
  1. `src/components/chat/surface/GoalControlStrip.tsx`：`pause` 改为两条圆头竖杠（`M9.5 6v12` + `M14.5 6v12`，`strokeWidth 2.4`），注释写清为什么不能用 lucide 的 rect 系图标。
  2. `tests/frontend/goal-control-strip.test.ts`：新增回归用例「draws pause as two bars so it cannot be read as an I-beam」，断言主操作 `svg` 内恰好是这两条 path。
- 文档：`docs/wiki/src/components/README.md` 两处运行条口径（存在重复段落）同步补暂停图标形状 + 为什么不用 lucide rect 系 + 断言说明；新增评审稿 `docs/design/goal-pause-icon-fix.html`（12px 真实尺寸 + 2x 放大、6 个候选横向对比）。
- 验证 / Evidence：`npx vitest run goal-control-strip / git-tools-pinned-summary / goal-icon` 三文件 **64 passed**（含新增 1 例）；`npx tsc -b` 通过；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` 成功（5.28s）。
- 边界：只改暂停图标与一条测试，不动 `resume` / `attention` / `more`、不改 `src/index.css`、不新增或升级依赖、未手工修改 `dist/`、`package-dist/`、`package-offline/`、未创建 Git commit。
- Notes（未做，供下轮）：① `attention` 主操作仍是 3 笔（竖杆 + 尖 + 底线），12px 下底线与尖几乎贴住，读起来是一个粗箭头，若要去噪需另做评审；② `resume` 现为尖角三角 `M8 6.5 17 12l-9 5.5Z`，与 lucide `Play` 的圆角三角风格不一致，可选统一；③ 条带里「14px 图标 + 8px 旋转环 + 6px 呼吸点」三件小东西并排（8px 旋转环既不像环也不像点），是「运行中看着不对」的另一处来源，已在 `docs/design/goal-icon-redesign.html` 给出 R1–R5 方案但未落地。

---

## retry-continue-lease-header（done，2026-10-23）

- Goal：用户反馈「只有一条消息时点重试就报错 This session is open for writing in another window」，随后补充「多轮点重试也报错」——即所有重试都失败，但本页明明就是唯一打开的窗口，属于误报。
- 结论（一句话）：消息「重试」实际走的写入口是 `POST /api/agents/:id/continue`，而 `ServerAgent.continue()` 是全仓**唯一一个漏发 `x-quickforge-client-id` 的写入口**（裁剪重生成形态连 headers 都没有）——服务端 `assertSessionWriteAccess` 读不到客户端标识就把本页当匿名客户端，租约被自己持有时照样 409 `SESSION_LEASE_HELD`，于是无论消息多少条、点几次重试都必然失败。
- 根因证据：`server/routes/agent.mjs:545` 的 continue 路由挂了守卫；`src/lib/server-agent.ts` 的 `writeHeaders()`（744）被 prompt/abort/steer/follow-up/access-mode/model/thinking-level/rollback/rollback-turn/goal/approve|reject-* 全量使用，唯独 `continue()` 只在带 appendMessage 时拼了 content-type、不带参数时**完全没 headers**。这与 2026-10-23 已修的 `abort()` 漏头是同一类缺陷（当时只补了 abort 一处）。
- 改动（2 文件）：
  1. `src/lib/server-agent.ts`：`continue()` 无论是否带 `appendMessage` 都发 `writeHeaders()`（带消息时再叠 content-type + body），并补注释说明为什么两种形态都必须带头；同时在入口加 `canWrite()` 守卫，非持有者本地直接抛错，不再先乐观追加「继续」消息再被 409 打回。
  2. `tests/frontend/server-agent-session-lease.test.ts`：新增 2 例（无 appendMessage 的裁剪重生成必须带客户端头；带 appendMessage 时必须带客户端头 + body），并在「blocks the other write entry points too」里补 `continue()` 的旁观者本地拦截断言。
- 文档：`docs/wiki/src/lib/README.md` 的 `continue(appendMessage?)` 条目补「两种形态都必须经 `writeHeaders()` 带客户端标识、入口先过 `canWrite()`」的口径（原来只写了乐观追加/回滚语义）。
- 验证：`npx vitest run tests/frontend/server-agent-session-lease.test.ts` **14 passed**；`tests/frontend/server-agent.test.ts` **142 passed**；`message-actions/message-utils` 相邻 **51 passed**；`npx eslint` 改动文件 0 error；`npm run lint` 0 error；`npx tsc -b` 通过；`npm run build` 成功（5.40s）；`npm run test` 全量 422 文件 → 421 passed / 1 failed，失败项是 `tests/server/scheduled-tasks.commands.test.mjs`（单独复跑 **24 passed**，属并行跑时的既有抖动，与本改动无关）。
- 边界：未动服务端租约逻辑、未动 `enableSessionLease`/心跳/接管 UI；未新增/升级依赖；未碰 `dist/`、`package-dist/`、`package-offline/`（build 会正常刷新 dist）；未创建 Git commit。
- Notes（未做，供下轮）：① `App.tsx` 的 `abort-tool`、`useSessionActions.ts` 的 `renameSession`（`POST /title`）仍是裸 fetch 不带客户端头，其中 `/title` 在服务端有守卫——旁观窗口改名会 409，属同类漏头但不在本次重试范围内；② 未做真实浏览器验收（单条消息 + 多轮两种场景点重试）。

---

## todo-summary-retire-latch（done，2026-10-23）

- Goal：用户反馈「todo list 在对话上方，已经完成了但没消失」，要求「每轮对话结束都检查，完成了就消失不应该再显示」。
- 结论（一句话）：退休**判定**本来就是对的（`idle && 100% completed`），坏在退休**动作**是一个活的谓词——下一轮一开始 `idle` 就翻回 false，140ms 淡出的 timer 被 cleanup 取消，胶囊以全不透明度复活；goal 续跑 / 消息队列续发 / 后台任务通知都会让 idle 窗口短于一帧退场，于是「全完成」的清单能永久挂在输入框上方。
- 根因证据：真实会话库里相关会话最后一个 `todo_write` 快照都是 100% completed（`bf82eea5` 7/7、`c335ad65` 8/8、`77c649cc` 4/4），而服务端 `agent_end` 间隔从 31 分钟一路缩到 3 分钟 / 7 分钟，即典型连续轮次把退场窗口挤掉。
- 改动（3 文件）：
  1. `src/components/chat/surface/TodoWriteSummary.tsx`：新增 `retiringKey` state，在 render 阶段（与既有 `trackedKey` 同一条 React 认可的 derive-from-props 路径）锁存首次观察到的 `shouldRetire`；`fading = (shouldRetire || latched) && !retired`，即一次「idle + 全完成」之后淡出必然跑完，不受 `idle` 回摆影响；新快照是新 key，不被 latch 影响。
  2. `tests/frontend/todo-write-summary.test.ts`：新增「keeps a retired list gone when the next round starts inside the exit window」——淡出中途 `idle` 翻 false，断言 `data-fading` 仍为 true、140ms 后仍卸载、后续轮次不复活。
  3. `docs/wiki/src/components/README.md`：两处 `panel-decoration/todo-write-summary.ts` 条目补 `retiringKey`，两处 Composer 摘要段落补「按快照 key latch 的一次性退休」口径。
- 未改：`shouldRetireTodoSummary` 的判定条件（仍是 idle + 全完成，残留 pending/in_progress 时保留）、`retiredKey` 的粘性、数据层（历史工具卡照旧可回看）、`ChatSurface` 传 `idle` 的方式。
- 验证：`npx vitest run tests/frontend/todo-write-summary.test.ts` **26 passed**；`npm run lint` **0 error**；`npm run build` 成功。
- 边界：未新增/升级依赖；未碰 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：① 若残留项来自模型中途规划却没发最终快照（真实库里 `b0018264` 最后一版停在 6/11），胶囊按设计仍保留——这是「有活没干完」的正确提示，不是本次的 bug；② 未做真实浏览器验收（连续轮次下淡出是否仍有观感抖动）。

---

## goal-strip-single-line（done，2026-10-23）

- Goal：用户要求「尽量优化成一行显示目标，优化一下保持简单，重新设计」，看完单行设计稿后回复「按推荐执行，不需要按钮文字，使用 icon」。
- 做法（一句话）：把三段卡（身份行 + 两行目标 + 进度行，≈76px）压成一行 32px —— `靶心图标 · 状态词 · 目标（单行截断）· 2/3 · 主操作(icon) · ⋯`；删掉就地展开面板与 chevron，主操作改纯图标。
- 丢掉的东西与补偿：
  1. 目标第二行 → 单行 `ellipsis`；`title` 保留「全文 + 阶段说明」，目标本身是进 Inspector 的按钮。
  2. 独立进度行 → 并进同一行（分段条 + `2/3`）；≤560px 只留数字，≤420px 整组隐藏，目标是唯一可伸缩元素、永不隐藏。
  3. 阶段说明（第 3/20 轮 / 暂停于第 3 轮 / 等待审批）→ 进「⋯」菜单的只读信息行 `.quickforge-goal-strip-menu-meta` 与 tooltip；`detailLine` 用 `Set` 去重（`phaseDetail` 已含轮次时不再重复）。
  4. 展开箭头 + 就地验收清单 → 删除；验收明细只在 Inspector，三处入口（状态词 / 目标 / ⋯→打开完整面板）。
  5. 主操作文字 → 纯图标 24px，`aria-label` + `title` 承载（避免本地化动词换行或截断）。
- 改动：
  1. `src/components/chat/surface/GoalControlStrip.tsx`：单一 flex 行；主操作改 icon-only；状态词与目标改按钮；新增 `detailLine` 去重；删除 `expanded` / `panelId` / chevron / `CRITERION_STATUS_KEY` 与 `goalStatusIcon` import；窄屏退让依赖 CSS。
  2. `src/components/chat/panel-decoration/goal-control-strip.ts`：`stateTone`（6 值）+ `GoalControlStripTone` 类型 + `stateToneFor` + `isWorkingSpin`（仅 planning/executing/verifying 转）；`v2PrimaryAction` 增加「等待用户优先」判断（否则会出现「需要你处理 + 暂停按钮」的矛盾）。此文件在本轮曾被回退，已重新应用。
  3. `src/index.css`：条带段整体重写（−342/+219 行）：固定 `height: 2rem`、`width: 100%`、`text-overflow: ellipsis` + `white-space: nowrap`、icon-only 主操作、`.menu-meta`、560/420 两级退让；删 `.head`/`.meta`/`.panel`/`.chevron`/`line-clamp`。
  4. `tests/frontend/goal-control-strip.test.ts`：30 例。展开用例改为「进度在行内 + 无内联清单」与「三处入口进 Inspector」；新增 icon-only 主操作断言（`textContent === ''` + `aria-label`）；`roundText` 与 `durationMinutes` 在 tooltip 里都出现，期望值同步。
  5. `tests/frontend/goal-card.test.ts`：CSS 契约改为固定 32px 高 + `width: 100%` + 无 `line-clamp`/`panel`/`chevron` + 目标 `ellipsis`/`nowrap`。
- 验证：定向 4 文件 **71 passed**；goal 全量相关 17 文件 **357 passed**；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；全量 `npm run test` **422 文件 / 4887 passed / 2 skipped**；`npm run build` 成功（3.67s）。
- 文档：`docs/wiki/src/components/README.md` 两处「运行条」段改写为单行口径（numstat 2/2，无格式漂移）；`docs/design/goal-strip-single-line.html` 标为已落地 + 第 05 节换成实际实施表。
- 边界：服务端 goal 契约、`goal-ui.ts` 锁、`goal-edit.ts` 的 pause→revise、锚定确认 popover 全部未动；方案 B（悬停长高）与 C（不带进度）未做；完成态仍不渲染条带；tone 仍是硬编码 hex；未新增/升级依赖；未碰生成产物；未创建 Git commit。
- Notes：① 有一段时间工作区的 `GoalControlStrip.tsx` 与 `goal-control-strip.ts` 被回退到 HEAD 版本（组件里还引用 `goalStatusIcon`/`expanded`，而 CSS 已是单行版），已重新写入并跑通验证 —— 若后续再出现「CSS 与组件不匹配」，先怀疑编辑器/工具回退了未提交的文件；② 未做真实浏览器验收（32px 高度下 6px 点与 12px 图标的重量平衡、420px 窄屏目标截断长度）。

---


## goal-strip-icon-fix（done，2026-10-23）

- Goal：用户反馈「goal 模式对话框上面的样式还有问题，比如 icon 不对」，要求先评审出 HTML 设计稿，选定后落地。用户选了我推荐的**方案 A（身份图标恒定 + 状态只走点/词/色）**。
- 根因（一句话）：图标绑错了维度。条带用 `dangerouslySetInnerHTML={{ __html: goalStatusIcon[view.tone] }}`，而 tone 是卡片的 5 个**颜色阶**而不是 5 个**状态**：`v2Tone` 把 `paused → info`，`info` 的字形是「勾选框 + 三条线」的待办清单，于是「已暂停」旁边画着待办清单；`waiting_*` 落到 `active`，于是「需要你处理」（唯一需要用户动手的状态）和「执行中」共用同一只蓝色时钟。另外「去处理」与「打开面板」两个按钮在 12px 下都是「一个朝上的尖」。
- 评审稿：`docs/design/goal-strip-icon-review.html`（按真实 CSS 复刻的 5 个状态条带 + 4 处语义错位 + 三方案对照 + 6 个问题 + 4 项样式微调）。
- 改动：
  1. `src/components/chat/surface/GoalControlStrip.tsx`：身份图标改为 `<GoalIcon />`（产品统一靶心，中性灰、恒定），删除 `goalStatusIcon` 与 `dangerouslySetInnerHTML`；旋转从「图标转」改为独立的 `.quickforge-goal-strip-spinner` 圆环（`border-top-color` 亮弧）；`ACTION_ICON.attention` 加下沿横线，与 `open` 的 chevron 区分；`data-tone` 改挂 `view.stateTone`，卡片色移到 `data-card-tone`。
  2. `src/components/chat/panel-decoration/goal-control-strip.ts`：新增 `GoalControlStripTone`（`working/attention/idle/blocked/success/danger`）与 `stateToneFor(goal, word)`——按状态词推导，不碰 `v2Tone`；新增 `isWorkingSpin(goal)`：仅 `planning/executing/verifying`（legacy `running/verifying/planning`）为 `spinning: true`，`waiting_approval/waiting_input/pausing` 一律不转；删掉 `isGoalSpinning` 的 import。
  3. `src/index.css`：`[data-tone]` 由 5 个 `info/active/warning/success/danger` 改为 6 个 stateTone 值；`.quickforge-goal-strip-icon` 固定 `var(--muted-foreground)` + 0.875rem；新增 `.quickforge-goal-strip-spinner`；点 `0.4375rem → 0.375rem`（与 3px 分段条同档）；`.quickforge-goal-strip-chip` 固定 `#d97706`（不再吃 tone）；`min-width` 20rem → 18rem；reduced-motion 覆盖 spinner（静态时保留亮弧）。
  4. `src/components/chat/panel-decoration/icons.ts`：`goalStatusIcon` 保留（置顶摘要/工具卡仍在用），注释说明条带不再消费及原因。
  5. 测试：`goal-control-strip.test.ts` 新增「identity glyph 恒定且不含 `<rect>`」「`stateTone` 矩阵（paused→idle 而非 info、waiting→attention、blocked→blocked、executing→working）」「spinning 只在推进时为真」，并把 `planning`/`pausing` 的 spinning 期望按新语义翻正；`goal-card.test.ts` 的 CSS 契约从「含 `icon--spinning`」改为「含 `.quickforge-goal-strip-spinner`、`[data-tone="attention"|"idle"]`，且 `icon--spinning` 已移除」。
- 验证：定向 4 文件 **69 passed**（goal-control-strip / goal-card / goal-icon / message-queue）；契约与相邻 9 文件 **179 passed**（含 semantic-color-class-parity、motion-design、goal-summary-section、git-tools-pinned-summary）；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npm run test` 全量 **422 文件 / 4884 passed / 2 skipped**；`npm run build` 成功（5.46s）。
- 文档：`docs/wiki/src/components/README.md` 两处「运行条」段落改写为「图标/文字/颜色各管一件事」的口径（`git diff --numstat` = 2 增 2 删，无格式漂移）；`docs/design/goal-strip-icon-review.html` 标为已落地。
- 边界：服务端 goal 契约、`lib/gold-ui.ts`/`goal-ui.ts` 的锁、`goal-edit.ts` 的 pause→revise、展开/菜单/确认交互全部未动；`goalStatusIcon` 未删（摘要与工具卡仍在用）；未新增/升级依赖；未碰生成产物；未创建 Git commit。
- Notes（未做）：① 完成态仍不渲染条带（完成卡属设计稿方案 C）；② tone 仍是硬编码 hex（`#3478d4`/`#d97706`/`rgb(4 143 101)`），本轮只是把「按 tone 上色」改成「按 stateTone 上色」，token 化仍未做；③ `min-width` 降到 18rem 后若目标很短，主操作按钮仍会把卡片撑到内容宽度，未加更激进的收缩策略；④ 未做真实浏览器验收（spinner 视觉转速、6px 点在 13px 行高下的重量感）。

---


## workflow-summary-card-visual-quiet（done，2026-10-23）

- Goal：用户要求「样式再优化：不需要显示查看详情和小绿点，反正可以点击跳转过去；运行过程中可以显示思考过程那样的流光效果」。确认口径：「小绿点」= 卡片右侧阶段刻度短条；运行态保留「文字流光 + 阶段跑马灯」。
- 改动：
  1. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：删除 `WorkflowTicks` 组件与 `quickforge-workflow-affordance`（「查看详情 ›」）；卡片只剩 图标 + 摘要（运行中带 `.quickforge-tool-running-sweep` 流光）+ 阶段跑马灯 + 终态的状态图标/耗时。「查看详情 / 已打开」仍进 `aria-label`，可访问名称不丢。
  2. `src/index.css`：删除 `.quickforge-workflow-ticks` / `-tick` / `-affordance` / `-affordance-icon` 与其 reduced-motion 分支；保留 `@keyframes quickforge-workflow-tick-pulse`（Inspector 状态 pill 仍在用）；`.quickforge-workflow-title` 加 `margin-right: auto` 把状态/耗时推到右侧。
  3. 测试：`workflow-renderer.test.ts` 新增「drops the visible detail affordance and phase ticks」「gives the running card the same shimmer as thinking text」，并把 CSS 契约从「tick 有脉冲」改为「tick/affordance 已移除 + 标题 auto margin」；`workflow-step-interaction.test.ts` 改为断言 tick/affordance 为 0，且「View details / Opened」只出现在 `aria-label`。
  4. 文档：`DESIGN_LANGUAGE.md` 新增「整行可点时不再单独渲染入口提示」（含「折叠态不要用短条/点阵复述详情页进度」）；`docs/wiki/src/lib/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md` 同步。
- 验证：定向 2 文件 36 例通过；`npx tsc -b` 通过；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` 成功。
- 边界：只动摘要卡的视觉与 DOM，不改打开逻辑、store 契约、跑马灯机制与状态计数；未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## workflow-summary-hide-zero-agents（done，2026-10-23）

- Goal：工作流卡片与 Inspector 概览条不再显示「0 个智能体」这类无信息量片段（用户确认范围为「聊天区摘要卡 + 右侧详情概览条」）。
- 做法：`src/lib/workflow-run-detail.ts` 新增 `WorkflowTranslate` / `workflowCountParts(view, translate)` / `workflowSummaryText(view, translate)`——计数为 0 的片段整段省略，两者都为 0 时只保留状态文案；删除 `workflowSummaryKey` 与 i18n 中英各 4 条 `workflowSummary*` 模板（状态标签 `workflowRunning/Completed/Failed/Aborted` 直接复用）。
- 渲染点：`workflow-tool-renderer.tsx` 摘要卡改用 `workflowSummaryText(view, t)`（原 `summaryParams` 预拼接删除）；`WorkflowRunDetailContent.tsx` 概览条用 `workflowCountParts(run, t).concat(阶段数).join(' · ')`。
- 被避免的坑：直接清空模板占位符会残留孤立的 ` · `；改为片段数组 join，零计数时不会多出分隔符。
- 测试：`tests/frontend/workflow-renderer.test.ts` 新增「omits zero agent and tool counts from the summary」三例（仅工具 / 仅 agent / 两者皆 0），移除 `workflowSummaryKey` 与 4 条模板键断言；定向 2 文件 35 例通过。
- 验证：`npm run test` 422 文件 4874 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.88s）。
- 文档：`docs/wiki/src/lib/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md` 同步新辅助函数与「零计数省略」契约。
- 边界：只改摘要文案拼接，未改计数口径（`agentCount`/`toolCount` 仍是登记数）、未动服务端、未新增依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## conversation-trace-view（done，2026-10-23）

- Goal：用户要求设计并实现「对话轨迹」——能看到每个工具的详情与时间轴，入口在对话顶部（分支旁边）；确认「直接在对话区域展开」、参考 DSH Trajectory、保留时间总览、三模式都要、检查器默认隐藏。
- 做法（一句话）：把 `agent.state.messages` 纯投影成 Turn→Step→Tool，做成对话区内部的第二种视图（顶部「对话/轨迹」切换器 + 覆盖层），配三轨×三模式时间总览与按类型给页签的检查器；不新增事件日志、不卸载对话。
- 关键决策（供后续判断）：
  1. **不加 append-only 事件表**：`details.quickforgeTiming` 由服务端 `tool-wiring.mjs` 写入、canonical JSON 不裁剪，回放可用；轮次/步骤/usage 都能从 `messages` 直接推出。DSH 的事件日志对 QuickForge 是过度设计。
  2. **覆盖而不是卸载**：轨迹层是 `ChatConversationSurface` 内的绝对定位兄弟（`.quickforge-trace-layer`）。卸载 `SessionViewPool`/`ChatPanelHost` 会丢输入草稿、滚动锚点与消息窗口，切回要整树重建。
  3. **视图状态绑 scope**：`useUIState.conversationViewScope = { scopeId, view }`，App 派生实际视图。好处是切会话自动回对话，且不需要 `useEffect` + `setState`（那个写法会被 `react-hooks/set-state-in-effect` 判 error，与 `workspaceInspectorOpenScopeId` 同款模式）。
  4. **只有「时钟」模式允许拖选筛区间**：另两种模式横向位置不代表时间，拖选会给出无法解释的结果，代码直接不启动拖选并在标题旁用 `traceHint*` 说明。
  5. **诚实计时**：尾步没有后续记录时 `durationMs` 为 `undefined` 而不是 `0`；`formatTraceDuration(undefined)` → `—`；运行中的行显示 `+4.1s` 且结束时间为「进行中 — 尚无结束时间」。
  6. **测试暴露的一个设计问题**：最初「没有任何工具就显示空状态」，结果纯文本问答看不到任何请求与 token——而这正是轨迹该给的信息。改为「没有任何 step 才空状态」，纯文本会话仍列 USER/ASSISTANT 行。
- 改动：新增 `src/lib/conversation-trace.ts`、`src/components/chat/trace/{ConversationTraceView.tsx,conversation-trace.css}`、3 个测试文件、`docs/architecture/conversation-trace.zh-CN.md`；改 `src/App.tsx`、`src/hooks/useUIState.ts`、`src/lib/i18n.ts`（中英各 64 key）、3 份 wiki 文档。
- 验证：
  - 定向 `npx vitest run` 3 个轨迹文件 → **56 passed**（投影 29 / 渲染 10 / 源码契约 17）。
  - `npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）。
  - `npm run test` 全量 → **422 文件 / 4874 passed / 2 skipped**。
  - `npm run build` 成功（4.05s），但**需先隔离工作区里预先存在的无关改动**（`workflow-run-detail.ts` 删了 `workflowSummaryKey`，`workflow-tool-renderer.tsx` 仍在 import）。
- 边界：不改服务端存储与事件协议；不改 `SessionViewPool`/`ChatPanelHost`/`ChatSurface` 内部语义；未新增/升级依赖；未做跨会话轨迹、深链接、虚拟滚动；未碰 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：
  1. **真机视觉验收**：时间总览拖选手感、三模式切换的条形动画、深色模式对比度、窄屏（≤48rem）覆盖式 Inspector、`prefers-reduced-motion` 表现。
  2. **移动端入口**：切换器在 `md` 以下隐藏，`⋯` 菜单里还没有「轨迹」项。
  3. **大工具数性能**：>500 行首屏变慢（无虚拟滚动）；要优化先做轮次级懒渲染，暂不引入 `@tanstack/react-virtual`。
  4. **双向联动未完成**：目前只有 Inspector 的「在对话中定位」；原型的「点工具卡 → 轨迹定位」需要先给 `ToolMessage` 加 `data-tool-call-id`（`approval-card.ts:336` 已有同名属性先例）。
  5. **工作区遗留**：`workflowSummaryKey` 的移除收尾没做完，导致 `npm run build` 在未隔离状态下失败，建议优先修掉。
  6. 过程中误操作把 `src/index.css` 追加了一份副本（`appendFileSync('src/index.css', css)` 读同一文件写入自己），已用「内容恰为自身两倍」的断言还原，最终轨迹样式改为独立 `conversation-trace.css`。

---

## goal-mode-ux-fix-strip（done，2026-10-23）

- Goal：用户选定设计稿的**方案 A**（目标卡）并要求执行落地。
- 做法（一句话）：把输入框上方的 goal 条带从「单行 + 4 个同权重 icon」改成三段式目标卡（身份行 / 目标行 / 进度行），配「⋯」菜单 + 就地展开 + 锚定确认 popover，并把 13 个服务器状态收敛成 5 个用户可见状态词。
- 改动：
  1. `src/components/chat/panel-decoration/goal-control-strip.ts`：view 投影新增 `statusWordKey`（5 词：`goalStateRunning/NeedsYou/Paused/Blocked/Done`）、`phaseDetail`、`criteriaPassed/criteriaTotal`、`durationMinutes`、`primaryLabelKey`、`primaryOpensInspector`；`primaryAction` 从 `'pause'|'resume'|'none'` 扩为 `+ 'attention'`；新增纯函数 `stateWordFor` / `phaseDetailFor` / `criteriaTally` / `isWaitingOnUser`；`statusKey`（精确 13 值）保留供 title/aria。
  2. `src/components/chat/surface/GoalControlStrip.tsx`：三段结构；唯一实心 `quickforge-goal-strip-primary`；「⋯」菜单承载编辑/打开完整面板/清除；展开 `quickforge-goal-strip-panel`（验收清单 + 预算条 + 打开面板链接）；清除确认改 `quickforge-goal-strip-confirm-pop` 锚定 popover；`attention` 主操作 → `revealWaitingCard()` 滚动 `.qf-scroll-container` 内最后一张 `.quickforge-approval-card`/`.quickforge-ask-card` 并加 1.4s `data-goal-attention` 描边；`data-state` 导出 5 词状态供 CSS 驱动 tone/呼吸点。
  3. `src/index.css`：`.quickforge-goal-strip*` 改写为卡片形态（约 400 行，类名前缀刻意保留——`message-queue.ts` 的 `isQueueAnchorFollower` 与 `goal-card.test.ts` 的 CSS 契约都依赖它）；补上仓库里一直**只被引用未定义**的 `@keyframes quickforge-goal-spin`；所有新动效带 `prefers-reduced-motion` 降级。
  4. `src/components/chat/panel-decoration/goal-card.ts`：`blockerText` → 导出 `buildGoalBlockerText`，条带复用它做 blocker 本地化，不复制 `BLOCKER_KEY`。
  5. `src/lib/i18n.ts`：中英各新增 22 个 key（5 状态词 + 9 阶段说明 + 去处理/更多操作/打开完整面板/展开·收起验收标准/可选标记/证据计数/分钟后缀）。
  6. `tests/frontend/goal-control-strip.test.ts`：从 19 例扩到 25 例，写清方案 A 的意图而不是放宽断言——新增「13 状态 → 5 词」收敛断言、验收计数/时长投影、预算耗尽走 `primaryOpensInspector` + 文案换 `goalExtendResume`、`attention` 不派发动作、菜单编辑（编辑 icon 不再常驻）、锚定确认（菜单关闭 + popover 出现 + 两个确认按钮）、就地展开/收起（含 `aria-controls` 对齐、不触发 `openSummary`）。
- 验证：
  - 定向：`npx vitest run` 15 个 goal 相关文件 → **311 passed**；CSS/i18n 契约 6 文件 → **94 passed**。
  - `npx tsc --noEmit -p tsconfig.app.json` 通过（先修了两个自造错误：`goal-card.ts` 残留旧函数名、`primaryLabelFor` 多了未用参数）。
  - `npm run lint` → **0 error**（仅既有 `GitToolsPinnedSummary` 的 exhaustive-deps warning）。
  - `npm run test` 全量 / `npm run build`：见下方补充。
- 文档：`docs/wiki/src/components/README.md` 两处重复段（目录行 + Goal 生产 UI 段）改写；`docs/design/goal-mode-ux-proposals.html` 标为「方案 A 已落地」，06 节改动表换成实际实施内容、落地顺序打勾。
- 边界：服务端 goal 契约、`src/lib/goal.ts` 类型、`goal-ui.ts` 锁、`goal-edit.ts` 的 pause→revise **全部未动**；未做完成卡（C3）与计划门禁（C1）；未改 `GoalInspectorContent` 的 `<details>` 双层嵌套（属独立改造）；未新增/升级依赖；未碰生成产物；未创建 Git commit。
- Notes（未做，供下轮）：① 完成态仍 `return null`，需要 C3 完成卡才算闭环；② `goal-control-strip.ts` 的 `phaseDetailFor` 与 `goal-card.ts` 的 `v2StatusKey` 有一定语义重叠，若继续演进可抽公共映射；③ tone 仍是硬编码 hex（`#3478d4`/`#d97706`/`rgb(4 143 101)`）散在 4 处，未 token 化；④ 未做真实浏览器视觉验收（展开/菜单/popover 的定位与窄屏表现需目视）。

---

## goal-mode-ux-redesign（done，2026-10-23）

- Goal：用户要求「分析 goal 模式的 UI 设计，给几个可优化方案（用户体验与流程），出 HTML 设计稿」。
- 做法（一句话）：先只读调研现状实现（`GoalControlStrip` + `GoalInspectorContent` + `goal-control-strip.ts`/`goal-card.ts` view 投影 + `index.css` 的 tone/条带样式 + `DESIGN_LANGUAGE.md`），把 8 个问题落到具体代码依据，再产出**一个自包含 HTML 设计稿**覆盖三套方案。
- 现状要点（用于判断方案取舍）：
  1. 条带是 `fit-content` 单行，`gap: 0.4375rem`，内含 icon + 状态词 + 截断 objective（`max-width: 22rem`）+ 4 个 24px icon-only 按钮（暂停/编辑/清除/详情），危险动作与详情按钮相邻只差字形。
  2. 只有 `roundText`（`roundsStarted/maxRounds`），验收通过数完全不可见；`goal.criteria` 数据已在前端，纯投影即可补。
  3. 预算耗尽时 `primaryAction === 'resume'` 会被路由到 `openSummary('progress')`——同图标不同行为。
  4. 13 个 `GoalStatus` 各映射一个中文词（v2 还有 `goalPhaseInterrupted` 等），主状态语义不收敛。
  5. 明细在右侧面板，证据是 `details` 嵌 `details`；取消确认用 `:has()` + `flex-wrap` 在行内塞文案+两按钮，条带高度会跳。
  6. `buildGoalControlStripViewV2` 对 `phase === 'complete'` 直接 `return null`，完成后无收尾。
  7. tone 色硬编码 `#3478d4` / `#d97706` / `rgb(4 143 101)`，散在 `index.css:7919-7923`、`goal-inspector.css:16-20`、`goal-card.ts` 的 tone 映射。
- 产出：新增 `docs/design/goal-mode-ux-proposals.html`（1182 行 / 67.8 KB，UTF-8 纯 LF）。
  - 01 现状诊断：按生产 CSS 复刻的条带 demo + 8 张问题卡（P1–P8，每条给「改」结论）。
  - 02 方案 A · 目标卡（推荐）：A1 折叠态（状态→目标→进度三级）／A2 就地展开（验收清单 + 预算 + 操作行，零跳转）／A3 状态收敛表（13 → 5 主状态词 + 1 阶段标签）。
  - 03 方案 B · 顶部停靠 Dock：36px 吸顶 + 验收进度环 + 展开抽屉；「需你处理」= 滚动高亮对话卡。
  - 04 方案 C · 计划门禁 + 完成卡：C1 计划就绪卡（配可选 `goal.requirePlanConfirmation`，默认关）／C2 24px 极简胶囊／C3 完成卡替代 `return null`。
  - 05 交互路径对比：内联 SVG 把「现状 4 次跳转」与「方案 A 1 次」并排画出来；另附状态机表（服务器字段 → 条带表现 → 允许动作 → 不该出现的东西）。
  - 06 规格与落地：视觉规格表（对齐 `DESIGN_LANGUAGE` 与既有 token）、tone 收敛表、按方案 A 的 6 项文件级改动表、5 步落地顺序（先动作收敛、再两行结构、再就地展开、再状态收敛、最后流程层）。
  - 交互：深浅色切换、5 个状态切换（联动状态词/主操作/图标）、卡片展开收起；全部动画带 `prefers-reduced-motion` 降级。
- 验证：文档类改动，**未跑** `npm run test` / `lint` / `build`（不触碰 `src/`、`server/`、测试、打包产物）。静态校验：标签配平（div 221/221、svg 33/33、section 6/6）、内联脚本 `node --check` 通过、LF 换行。
- 文档：`feature_list.json` 新增 `goal-mode-ux-redesign`（done）；`progress.md` 本条；`session-handoff.md` 置顶交接。`docs/wiki` 未改（本轮无代码/架构变更，设计稿是提案而非既有实现说明）。
- 边界：未改任何生产代码（`GoalControlStrip.tsx`、`GoalInspectorContent.tsx`、`index.css`、`goal-control-strip.ts`、`goal-card.ts`、`i18n.ts` 全未动）；未改服务端 goal 契约；未新增/升级依赖；未碰生成产物；未创建 Git commit。
- Notes（未做，供下轮）：① 需用户选方案，方案 A 的落地改动表才进入实施；② 方案 C 的 `requirePlanConfirmation` 是产品决策；③ 顺手可收敛的 token 问题：goal tone 应在 `:root`/`.dark` 只声明一次（现 4 处重复 + 硬编码 hex），但会被 `goal-control-strip.test.ts`/`goal-card.test.ts` 的锚点感知；④ 聊天正文宽度两套值（token 56rem vs `max-w-3xl` 48rem）未统一。

---


- Goal：用户最初说「左侧边栏切 session 总自动打开」，调研后自己纠正为**右侧面板**：「右侧的不要自动预览，重新切换 session 默认不打开」；两轮确认后定为 **D + A**——保留「当前会话新产出自动预览」机制，只要求切换 session 时不弹、且上一会话手动打开的面板必须强制收起。
- 结论（一句话）：`workspaceInspectorOpen` 原本是 App 级布尔量，而 `WorkspaceInspector` 的 key 是 `${projectId}:${runtimeScopeId}`，切 session 只让子组件重挂载、不重置父级开合，于是「手动展开」会跟着用户跨会话残留；改成记录「在哪个 runtimeScopeId 打开」的 `workspaceInspectorOpenScopeId` 后，open 由它与当前 scope 派生，scope 一变即 false。
- 根因（为什么原来的注释不成立）：`src/App.tsx:455` 的旧注释写「切换 session 不再自动展开」，但那只覆盖了「新会话默认 false」，没有覆盖「上一个会话留下的 true」。真实的两条触发路径是 ① 残留的 open 状态 + `WorkspaceInspector` remount 后按 `projectId:sessionId` 从 localStorage 恢复上次 tab（`workspace-inspector-tabs.ts:87`），看起来就是「切过去自己弹出来」；② 运行中会话的 live 产物回调 `openLivePresentedArtifacts`（`App.tsx:799`，门禁只有 `sessionId === currentSessionId` 与「活跃视图」）在切进去的瞬间把面板打开。本次按用户选择只修 ①，② 保留。
- 改动：
  1. `src/App.tsx`：`const [workspaceInspectorOpen, setWorkspaceInspectorOpen] = useState(false)` → `const [workspaceInspectorOpenScopeId, setWorkspaceInspectorOpenScopeId] = useState<string | null>(null)` + `const workspaceInspectorOpen = workspaceInspectorOpenScopeId === workspaceInspectorRuntimeScopeId`；三处写入点全部绑定 scope：`requestWorkspaceInspector` 写 `scope.runtimeScopeId`、`handleWorkspaceInspectorOpenChange` 写 `open ? workspaceInspectorRuntimeScopeId : null`、右上角 PanelRight 手动 toggle 写 `null` / `workspaceInspectorRuntimeScopeId`。
  2. 不引入 effect：第一版写的是 `useEffect(() => { setWorkspaceInspectorOpen(false); setWorkspaceInspectorRequest(undefined) }, [runtimeScopeId])`，被 `react-hooks/set-state-in-effect` 判为 error（同步 setState 触发级联渲染）。派生状态本身就能表达「scope 变了就收起」，删掉 effect 后 lint 干净，语义也更准确。
  3. `tests/frontend/git-tools-pinned-summary.test.ts`：该例原来断言 PanelRight 关闭分支含 `setWorkspaceInspectorOpen(false)`、打开分支在 `setWorkspaceInspectorOpen(true)` 之前调 `setGitToolsExpanded(false)`；语义未变，只把两个断言换成新的 scope 绑定写法（顺序断言保留）。
  4. 新增 `tests/frontend/workspace-inspector-session-switch-close.test.ts`：3 条源码契约——open 由 scope 派生、打开路径必须绑定 `runtimeScopeId` 且不得出现 `setWorkspaceInspectorOpen(true)` 裸布尔写法、不得用 effect 同步重置。
- 测试（Evidence）：定向 `npx vitest run workspace-inspector-session-switch-close / auto-preview-fresh-present / workspace-inspector-request / workspace-inspector-tabs / inspector-tabs-hooks / git-tools-pinned-summary` → 6 文件 **76 passed**；`npm run test` 全量 **419 文件 / 4809 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npx tsc -b` 通过；`npm run build` 成功（4.24s）。
- 文档：`docs/wiki/src/components/README.md` 的 PanelRight 段补写开合语义（按 `runtimeScopeId` 派生、切 session 自动收起、无需 effect），并把该段里残留的 `setWorkspaceInspectorOpen(true)` 措辞改为「绑定当前 runtimeScopeId 之前」。
- 边界：**保留**自动预览机制（`onLivePresentArtifacts` / `extractToolExecutionArtifacts` / `isSessionViewActive` 未动）；不改 `WorkspaceInspector` 的 tab 持久化与恢复；不改 `useInspectorLayout` / `useInspectorTabs`；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：① 按用户选择 D，运行中会话的 live `present_files` 在切进去的瞬间仍可能打开面板（门禁 `sessionId === currentSessionId` 是在切完之后才成立的），若真机仍觉得打扰，需要再加「切 session 后的 N 秒内不自动预览」或「只对用户主动发起的回合生效」；② `src/index.css` 里 4 个 CSS 契约测试（goal-iteration-divider / reconnect-notice / model-retry-notice / scroll-to-bottom-button）失败是**本会话开始前就存在**的未提交 CSS 改动导致，已用 `git stash` 单独验证复现为绿、再 `stash pop` 还原，与本次改动无关；③ 未做真实浏览器视觉验收。

---

## workflow-timeline-clip-fix（done，2026-10-23）

- Goal：用户反馈「时间轴还有问题，右侧进度条好像被遮挡」。
- 结论（一句话）：右侧 4 处独立裁切叠加——条形 `content-box` 溢出 2px、耗时挂在条形上随位置伸出轨道、「并行」标签往左盖住行名、首尾刻度被轨道边界切。统一改为「绘图区 + 两侧安全区」布局。
- 根因（每处独立）：
  1. 项目**没有全局 `box-sizing: border-box`**，条形 `width: X%` 再加 `1px` 边框 → 总宽超出轨道 2px，贴 100% 时右端被切。
  2. `.bar-value` 是**条形的子元素**，`left: calc(100% + 5px)` 相对条形算，条形靠右必然溢出；注释写了「太靠右时翻到内侧」但从未实现。
  3. `.parallel-tag` 同理挂在条形上、`right: calc(100% + 5px)` 往左伸进标签列，盖住行名。
  4. 刻度的 `translateX(-50%/-100%)` 需要半个字宽余量，轨道边界处没有，首尾文字被切。
- 改动：
  1. `src/index.css`：时间轴根节点新增两个安全区变量 `--wf-tl-pad-start: 2.25rem` / `--wf-tl-pad-end: 2.75rem`（窄屏 `1.75rem` / `2.25rem`）；新增 **`.quickforge-workflow-detail-row-plot` 与 `.quickforge-workflow-detail-axis-plot`** 两层——用 `margin-left/right` 承担安全区，而不是给轨道加 `padding`；条形 `position: absolute` + `box-sizing: border-box`（去掉原来多余的 `display:flex/gap`）；`.bar-value` 改 `right: 0`、`.parallel-tag` 改 `left: 0`，都改为相对绘图区定位。
  2. `WorkflowRunDetailContent.tsx`：轴与每一行（含阶段头）都插入 plot 层；**耗时与「并行」从条形的子元素上移到绘图区的直属子元素**——挂在条形上必然随位置溢出。
  3. `docs/design/workflow-timeline-clip-fix.html`：对比稿，含 640px 极端情况、4 处成因表、以及「为什么不能用 padding 当安全区」的坑说明。
- 关键设计约束（写进 CSS 注释）：**绝对定位的百分比基准是包含块的 padding box（含 padding）**，所以给轨道加 `padding` 会让 `left: 0%` 仍从 border 内侧算起，条形会压到左侧安全区的标签上。必须用独立 plot 层 + `margin` 收缩真正的定位基准。
- 测试：`tests/frontend/workflow-renderer.test.ts` 新增回归——条形 `box-sizing: border-box`、两个 pad 变量存在、`row-plot/axis-plot` 用 `margin-*` 走这两个变量、`.bar-value { right: 0 }`、`.parallel-tag { left: 0 }`。
- 验证：定向 workflow 两文件 **34 passed**；`tsc --noEmit` 通过；全量 test / lint / build 见下方。
- 边界：不改 `workflowTimeline` 数据层；不改阶段/日志视图；未新增/升级依赖；未手工修改生成产物；未创建 Git commit。
- Notes（未做）：① 阶段数 > 8 时折叠头刻度仍未做「3/8」文本降级；② 未做真实浏览器视觉验收（仅构建 + 测试）。

---

## workflow-timeline-layout-fix（done，2026-10-23）

- Goal：用户反馈样式问题（时间轴文字/条形太小、显示不全）。
- 结论（一句话）：两层原因——① SVG 固定 `viewBox` + `width:100%` 会等比缩放整张图（含字号）；② 详情根节点缺 `flex:1`，宽度按内容收缩且 `height:100%` 解析失败，导致 `pane` 的 `overflow-y:auto` 失效、内容被父级 `overflow:hidden` 裁掉。
- 改动：
  1. `src/components/workspace/WorkflowRunDetailContent.tsx`：`TimelineView` 从 SVG 重写为 DOM——轴（`.quickforge-workflow-detail-axis`）+ 行列表（`.quickforge-workflow-detail-rows`），每行 = 标签列 + 百分比轨道列；条形用内联 `left`/`width` 百分比，短调用保底 `0.6%`；删除 `TIMELINE_LABEL_WIDTH` / `TIMELINE_ROW_*` / `TIMELINE_HEADER_HEIGHT` 等像素常量与纵坐标计算。
  2. `src/index.css`：**详情根节点**改为 `flex: 1 1 auto` + `min-width: 0` + `min-height: 0` + `max-height: 100%`（原只有 `height: 100%`，这是「显示不全」的直接原因）；时间轴新增 `--wf-tl-label: clamp(5.5rem, 30%, 9.5rem)`（窄屏 `clamp(4.5rem, 34%, 6.5rem)`）；条形从 `fill/stroke` 改 `background/border`，`.is-parallel` 改 `border-style: dashed`；字号全部走 `calc(var(--quickforge-message-font-size) * …)`。
  3. **修掉两个 token 缺陷**：① `--quickforge-workflow-done` 从未定义，9 处使用都在吃 fallback 浅色绿（深色模式发脏）→ 在 `:root` 定义 `--workflow-done: oklch(0.55 0.13 158)`、`.dark` 定义 `oklch(0.75 0.15 160)`，9 处引用改名；② 14 处写的是 `var(--quickforge-ease, …)`，正确名为 `--quickforge-ease-out`，缓动从未生效 → 全部改名。
  4. `docs/design/workflow-timeline-fix.html`：修复前后对比稿（640px / 340px 两档、深色模式、容器约束示意图）。
- 测试：`tests/frontend/workflow-renderer.test.ts` 断言改写为 DOM 契约 + 新增容器约束回归（根节点 `flex`/`min-*`、`pane` 滚动、`--wf-tl-label` clamp、`--workflow-done` 双主题定义、不含 `var(--quickforge-ease,`、不含 `viewBox={\`0 0 1000`）。
- 验证：定向 workflow 两文件 **34 passed**；`npm run test` 全量 **419 文件 / 4809 passed / 2 skipped**；`npm run lint` 0 error；`npm run build` 成功；`tsc --noEmit` 通过。
- 事故与修复：改写 CSS 时用 Python 写文件，Windows 默认把 `index.css` 从 LF 转成 CRLF，导致 9 个依赖 `\n` 正则的源码契约测试全部失败。已字节级恢复为纯 LF。**教训：本项目 `src/index.css` 必须保持 LF；用脚本写该文件需显式 `newline=''` 或写后统一换行。**
- 边界：不改 `workflowTimeline` 算法与返回值；不改阶段/日志视图逻辑；不改 `App.tsx` 面板开合逻辑（`workspaceInspectorOpenScopeId` 是更早会话的未提交改动）；未新增/升级依赖；未手工修改生成产物；未创建 Git commit。
- Notes（未做，供下轮）：① 条形过窄时右侧耗时文字可能与其他行重叠，可改 hover 显示或固定列；② 阶段数 > 8 时折叠头刻度仍未做「3/8」文本降级；③ 未做真实浏览器视觉验收。

---

## workflow-inspector-panel（done，2026-10-23）

- Goal：用户不满 workflow 工具卡的样式，先要 HTML 设计稿，随后要求「点击在右边打开」。设计稿 `docs/design/workflow-run-panel.html` 给出「聊天卡退化为一行入口 + 右侧 Inspector 独立 Tab」方案，用户确认执行。
- 结论（一句话）：聊天区只剩一行入口，明细进右侧 Inspector 的三视图面板——**时间轴**答「串行还是并行」、**阶段**答「跑到哪了」、**日志**答「为什么卡住」。
- 根因（为什么不是「把卡片做漂亮点」）：① 信息密度错配——内联展开与右侧详情是同一份数据的两套布局，长跑必然漂移（原实现已有 `.quickforge-workflow-tool > div` 的 ×0.8 字号补偿这类补丁），且 5 阶段 + 12 工具会挤成 1400px 长条；② 表达能力缺失——`seq` + `startedAt` + `durationMs` 数据里本来就有，但平铺列表永远画不出并行关系，而并行正是 `parallel()` / `pipeline()` 的核心语义。
- 改动：
  1. `src/lib/workflow-run-detail.ts`：`WorkflowToolView` 增 `startedAt`；`WorkflowRunView` 增 `runStartedAt` / `maxAgents` / `maxTools` / `concurrency` / `maxRuntimeMs`；新增 `workflowTimeline(view)` —— 摊平成甘特条目（`startOffsetMs` / `durationMs` / `parallel` / `parallelGroupStart`），并查集聚合并行组、扫描线算 `peakConcurrency`、`savedMs` = 各步耗时之和 − 实际跨度；缺 `startedAt` 按 `seq` 顺延、`totalMs` 恒 ≥ 1。
  2. 新增 `src/lib/workflow-run-payload.ts`：`WorkflowRunPayload`（view + script + detailed + fingerprint）、`WorkflowRunStore`（runId 去重 / 50 条 FIFO / 订阅）、`shouldPublishWorkflowRunPayload`（拒绝终态回退）、`normalizeOpenWorkflowRunRequest`、`OPEN_WORKFLOW_RUN_EVENT`、`activeWorkflowRunStore`（让卡片显示「已打开」的极小广播器）。
  3. 新增 `src/components/workspace/WorkflowRunDetailContent.tsx`：时间轴（SVG 甘特，左固定标签列、条形高度即层级 Agent 10px / 工具 6px、最小宽 3px、并行段虚线 + 「并行」文字作第二编码、概览条给并发峰值与「比串行快 X」）、阶段（`workflowPhaseSteps` 交错 + Agent 卡「运行详情 ↗」跳 subagent Tab + 工具行展开 input/output）、日志（相对时间戳 + 阶段标签）；底部固定区脚本/结果抽屉。
  4. `src/lib/tool-renderers/workflow-tool-renderer.tsx` 重写为单行入口 `<button class="quickforge-workflow-card">`：摘要 + running sweep + 跑马灯（当前阶段）+ 阶段刻度 + 常显耗时 + hover 才出现的「查看详情/已打开」；点击回填 store 后派发事件；内联展开体与 `renderSubagentRunSummary` 依赖全部移除。
  5. tab 体系加 `workflow` kind：`workspace-types.ts` 请求分支、`workspace-inspector-request.ts` scope 校验、`workspace-inspector-tabs.ts`（类型/字段/`upsertWorkflowRunTab`/`updateWorkflowRunTab`/持久化排除）、`useInspectorTabs.ts`（`openWorkflowRunTab` + 订阅 store）、`WorkspaceInspector.tsx`（label/title/Workflow 图标/内容分发/request 处理/`activeWorkflowRunStore` 广播）、`useInspectorLayout.ts`（自动拉宽）。
  6. `src/App.tsx` 监听 `OPEN_WORKFLOW_RUN_EVENT` → `requestWorkspaceInspector({ kind: 'workflow' })`。
  7. `src/lib/i18n.ts` 新增 24 组中英文案（Tab 标题、三视图名、并发/节省/预算、入口提示）。
  8. `src/index.css`：删除聊天内展开样式约 268 行，新增 `.quickforge-workflow-card` / `-ticks` / `-affordance` 与 `.quickforge-workflow-detail-*` 全套（约 900 行），全部走既有语义 token。
- 测试（语义迁移 + 新增）：`tests/frontend/workflow-renderer.test.ts` 26 例（新增 `workflowTimeline` 5 例 + payload store 3 例 + 详情面板契约 2 例；原「默认收起 / tool zone 嵌套 / CSS 正则」三类断言整组改写为「单行入口 + 刻度 + 已删除旧样式」）；`tests/frontend/workflow-step-interaction.test.ts` 重写为 8 例（单行入口无内联展开、点击回填 store 并派发事件、`activeWorkflowRunStore` 联动、终态不回退、queued 载荷、不使用 `OPEN_SUBAGENT_RUN_EVENT`）。
- 验证：定向 `npx vitest run` 3 文件 → **40 passed**；`npx tsc --noEmit -p tsconfig.app.json` 通过；`npm run test` 全量 **4806 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**；`npm run build` 成功（4.21s，仅既有 chunk 体积 warning）。
- 文档：`docs/wiki/src/lib/README.md`（`workflow-run-detail.ts` 行数/字段/`workflowTimeline`、新增 `workflow-run-payload.ts` 条目、渲染器与样式契约段整体重写）、`docs/wiki/src/components/README.md`（两处同步新增 `WorkflowRunDetailContent.tsx` 小节）。
- 边界：不改服务端契约（`details` 已带 `startedAt` 与预算字段，无新 SSE 字段）；不改 worker/runner 编排与限制；不改 subagent Tab 既有行为；workflow Tab 不持久化（运行快照刷新后无法重建）；未改 approval-card / process-folding 对本工具的处理；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：① 时间轴在 340px 最小宽度下标签列会被压缩，可考虑改两行省略或收起为图标；② 阶段数 > 8 时折叠头刻度会溢出，未做「3/8」文本降级；③ 未做真实浏览器视觉验收（甘特图的实际观感、窄面板下的换行、深色模式对比度）；④ 并行段检测依赖 `startedAt`，若服务端某路径不写该字段则会退化为串行（当前 `agentRecordPayload` / `toolRecordPayload` 都写）。

---

## workflow-result-no-truncation（done，2026-10-22）

- Goal：用户质疑「workflow 结果为什么会被截断」，确认「里面是多少就返回多少」，选择 **①②③ 全去掉**（正文 50,000 / 工作流结果预览 20,000 / agent·tool 步骤预览 2,000·4,000），超长结果**信任 auto-compact 兜底**。
- 结论（一句话）：`run_workflow` 的返回值与 Inspector 预览不再有任何字符截断——脚本 `return` 什么，模型与前端就收到什么；`truncateText` 只保留给错误文本与失败摘要。
- 根因（为什么原设计有害）：`runner.mjs` 切的是 `JSON.stringify(value, null, 2)` 之后的**文本**，5 万字符处可能落在字符串/括号中间，模型既不知道被截断（`<workflow_result>` 内无提示）也无法 `JSON.parse`，等于静默交付半截数据。
- 改动：
  1. `server/agent-workflow-runner.mjs`：删除 `AGENT_RESULT_PREVIEW_LIMIT` / `TOOL_ARGS_PREVIEW_LIMIT` / `TOOL_RESULT_PREVIEW_LIMIT` / `WORKFLOW_RESULT_PREVIEW_LIMIT` / `CONTENT_RESULT_LIMIT` 五个常量；`completeWorkflow` 直接写完整 `state.resultJson`；`buildDetails` 的 `resultPreview` 全量、不再产出 `resultTruncated`；`agentRecordPayload` 的 `promptPreview` / `context` / `expectedOutput` / `resultPreview` 全量、不再产出 `promptTruncated` / `resultTruncated`；`toolRecordPayload` 始终发结构化 `args`、去掉 `argsPreview` 分支与 `resultTruncated`；`normalizeToolRequest` 与 tool record 删除只为截断服务的 `argsJson` 字段。`ERROR_TEXT_LIMIT`（错误文本 2,000）与失败摘要的 300 字符保留——那是错误摘要，不是结果。
  2. `src/lib/workflow-run-detail.ts`：`WorkflowToolView` 删 `argsPreview`，`WorkflowRunView` 删 `resultsTruncated`，`normalizeTool` 不再读 `argsPreview`。
  3. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：`workflowToolSummary` 只走 `summarizeParams(tool.args)`；详细模式的 input 只走 `stringifyValue(tool.args)`；结果区摘要去掉「· 已截断」后缀。
  4. `src/lib/i18n.ts`：删除 `workflowResultTruncated` 中英各一条。
- 测试（语义迁移 + 新增回归）：`tests/server/agent-workflow-runner.test.mjs` 新增 2 例——「120,000 字符结果原样返回」（`content` 含完整 JSON、`resultPreview` 全量、无 `resultTruncated`、可 `JSON.parse`）、「长 prompt/结果/工具参数不设预览预算」（6,000 字符 prompt 与结果、9,000 字符 description 全量保留，无 `promptTruncated` / `argsPreview` / `resultTruncated`）；`tests/frontend/workflow-renderer.test.ts` 的 i18n 键清单去掉 `workflowResultTruncated`。既有 35 例全部通过。
- 验证：定向 `npx vitest run tests/server/agent-workflow-runner.test.mjs tests/frontend/workflow-renderer.test.ts` → 53 passed；`npm run test` 全量通过；`npm run lint` 0 error；`npm run build` 成功。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md` 的上限表（正文/三个预览改为「不截断」并说明 1 MB JSON 仍是硬约束）、details 字段表（删 `resultTruncated` / `argsPreview` / `promptTruncated`）、7.2 汇总字段与 7.3 i18n 键清单同步；`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/lib/README.md` 的截断描述改为「结果一律不截断 + 上下文压缩兜底」。
- 边界：**保留** `worker.mjs` 的 1 MB JSON 上限（worker 内存保护，抛错而非截断）、`MAX_SCRIPT_LENGTH` / `MAX_ARGS_JSON_LENGTH`（20,000，启动前校验）、`MAX_LOG_ENTRIES`（200 条）、`ERROR_TEXT_LIMIT`；工具层自己的 `server/utils/workspace.mjs` 50,000 上限未动（那是工具输出契约，不是 workflow 结果）；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：① 单条 toolResult 最大可达 1 MB（≈250k tokens），在 auto-compact 80% 阈值触发前若已超 provider 上限会直接报错——本轮按用户决定不做前置保护，若真机遇到需要把 `DEFAULT_AUTO_COMPACT_SETTINGS.thresholdPercent` 前移或给 `run_workflow` 加软预算；② 运行中帧体积随结果增长变大（`resultPreview` 全量随 200ms 节流推送），超长结果下流式帧会明显变重，未做「运行中只推摘要、终态推全量」的分层；③ `docs/design/workflow-tool-redesign.html:856` 仍写着「结果 · 已截断」，属历史设计稿，未改。

---

## live-present-auto-preview（done，2026-10-22）

- Goal：用户反馈「切换 session 时左侧边栏/右侧面板总是自动打开，不希望每次都自动打开」。先做只读调研定位现象归属，用户确认为**右侧 workspace 面板/预览被自动打开**，并要求「方案最佳、不考虑历史包袱、保证产品体验、不要打补丁」。
- 结论（一句话）：自动预览原本用「消息状态差分」判断新产物，与消息窗口化/缓存/历史补齐天然冲突；改为**live 事件驱动**——`ChatPanelHost` 在 `tool_execution_end` 时抽取该次执行自己产出的文件并只由活跃视图上报，历史文件永远不进入这条路径。
- 根因（为什么是机制问题）：附着时刻把 `agent.state.messages` 里全部 toolResult 的 toolCallId 记成历史快照，再用 `isNewlyPresentedArtifact` 判差集。会话打开快路径（`20227ad`）后 `messages` 只是尾部 200 条窗口（`server/routes/session-view.mjs:19,140`），首帧后 `ChatPanelHost` 调 `hydrateFullHistory` 补齐全量并整表替换（`server-agent.ts:2138-2163`），全量表里更早的 `present_files` 的 toolCallId 不在快照中 → 被当成「刚刚新产生」→ 自动开面板。凡消息数 > 200 且历史含 `present_files` 的会话，切入即弹。差分方案对窗口化、缓存命中校准、SSE 重连、回滚/压缩都不可能收敛。
- 改动：
  1. `src/lib/tool-artifacts.ts`：新增 `extractToolExecutionArtifacts(event)`——把单次 `tool_execution_end` 经 `upsertToolResult` 组装成一条伪 toolResult，复用既有 `extractArtifactsFromMessages` 抽取；无 `toolCallId`/`result` 返回空，`read_file` 等不可 present 的工具天然返回空。
  2. `src/components/chat/ChatPanelHost.tsx`：新增 prop `onLivePresentArtifacts(sessionId, artifacts)`；`tool_execution_end` 分支（`!sideChatMode`）计算 `liveArtifacts`，仅当 `isSessionViewActive(agentRuntimeScopeId ?? agent.sessionId)` 为真时经 `propsRef` 上报——后台会话（`SessionViewPool` 保活的隐藏视图）跑完 `present_files` 不再抢走用户正看着的面板。
  3. `src/App.tsx`：删除整条差分链路（附着快照 effect、自动预览 effect、`autoPreviewHistoryRef`、`autoPreviewSignatureRef`、切项目时的签名重置），改为 `openLivePresentedArtifacts`：校验 `sessionId === currentSessionId` 且有 `projectId`，用 `findBestPreviewableArtifact` 挑选后按 reader/document/browser 分流 `requestWorkspaceInspector`；新增 `onLivePresentArtifacts={openLivePresentedArtifacts}` 传入 `ChatPanelHost`。
  4. `src/components/workspace/artifact-preview-utils.ts`：删除 `collectToolResultToolCallIds` / `isNewlyPresentedArtifact`（保留 `presentArtifacts` / `findBestPreviewableArtifact`，产物列表与 live 回调仍在用），`findBestPreviewableArtifact` 注释改为 live 口径。
- 测试（重写为事件契约，不放宽断言）：`tests/frontend/auto-preview-fresh-present.test.ts` 原 9 例差分判定全部替换为——`extractToolExecutionArtifacts` 抽取 present_files（含 `details` 无 files 时回退 `content` 解析）、无 `toolCallId`/无 result/不可 present 工具均返回空；`findBestPreviewableArtifact` 预览优先级与不可预览扩展名返回 undefined；三条源码契约断言：App.tsx 必须含 `onLivePresentArtifacts={openLivePresentedArtifacts}` 且**不含** `autoPreviewHistoryRef`/`autoPreviewSignatureRef`/`isNewlyPresentedArtifact`/`collectToolResultToolCallIds`，ChatPanelHost 必须含 `extractToolExecutionArtifacts` + `isSessionViewActive(activityKey)` + `propsRef.current.onLivePresentArtifacts?.(sessionId, liveArtifacts)`，utils 不再导出已删工具。
- 验证：定向 `npx vitest run tests/frontend/auto-preview-fresh-present.test.ts tests/frontend/assistant-artifact-card.test.ts` → 2 文件 **29 passed**；`npm run lint` **0 error**；`npm run build`（`tsc -b && vite build`）成功；`npm run test` 全量通过。
- 文档：`docs/wiki/src/components/README.md:681`、`docs/wiki/src/README.md` 的「附着后新 present_files 自动预览」改为「live present_files 自动预览」；`docs/wiki/src/lib/README.md` 的 `tool-artifacts.ts` 小节改写自动预览口径（live 事件 + 活跃视图门控 + 历史文件永不进入该路径）。
- 边界：不改服务端契约（不新增/修改 SSE 事件与字段）；不改 `SessionViewPool` / 窗口化 / 缓存策略；侧栏 `ChatSidebar` 未改（调研确认它没有任何随 session 变化的打开路径：`sidebarOpen` 只有 `useState(true)` + 手动 toggle，无持久化、无相关 effect，唯一能把状态翻回 true 的是整树 remount，与 session 切换无因果）；手动预览入口（工具卡预览按钮、产物列表、文件卡「打开▾」）行为不变；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：① 需真机确认切换到 >200 条且含 `present_files` 的历史会话时右侧面板保持关闭；② 多窗口/多标签下 `isSessionViewActive` 是单页内信号，跨窗口抢面板由现有 `sessionId === currentSessionId` 校验兜住，未做跨窗口抑制；③ `extractToolExecutionArtifacts` 目前也接受 `write_file`/`edit_file` 事件，但 `findBestPreviewableArtifact` 只放行 `explicit`（present_files），因此不会回归到「写文件就弹」。

---

## workflow-tool-row-hierarchy（done，2026-10-22）

- Goal：用户指出「工作流 tools 显示本来就是 tools 内部的行为，应该更有层级感」，先出 HTML 设计稿对比（现状 / 方案 A 缩进+细连接线+弱化 / 方案 B 再折成工具组），用户选 **方案 A**。
- 结论（一句话）：阶段内连续的 `tool()` 调用从「与 Agent 平铺的步骤行」改成「Agent 之下带缩进 + 1px 连接线的工具区」，工具行字号/颜色再降一档；Agent 行主文案由状态换成任务名，状态退到悬停/aria 与状态区。
- 改动：
  1. `src/lib/workflow-run-detail.ts`：新增 `WorkflowPhaseStep`（`agent` | `tools`）与 `workflowPhaseSteps(phase)`——先按 `seq` 排序，再把**连续**的 `tool()` 折叠成单个 `tools` 步骤（只按连续性判断，不推断归属；阶段开头/结尾的孤立工具调用同样成组）。
  2. `src/lib/tool-renderers/workflow-tool-renderer.tsx`：用 `workflowPhaseSteps` 替代内联排序；工具步骤渲染成 `li.quickforge-workflow-tool-zone > ul.quickforge-workflow-tool-list > WorkflowToolCallRow`；紧跟 Agent 的工具区带缩进与连线，阶段开头无可归属 Agent 的加 `--root` 去掉缩进与连线（不留悬空连接线）。阶段头改为 `阶段名 + workflowStepCount 步数 + 渐隐细线`。
  3. `src/lib/tool-renderers/subagent-tool-renderer.tsx`：`SubagentRunSummaryOptions` 新增可选 `label` / `labelClassName`（`run_subagent` 不传，行为零变化）；workflow Agent 行传 `agent.label`，running 时把 `quickforge-tool-running-sweep` 挂到任务名上。
  4. `src/index.css`：新增 `.quickforge-workflow-tool-zone`（`margin-left: 0.375rem` + `padding-left: 0.625rem` + `1px solid color-mix(in oklab, var(--border) 60%, transparent)`，与主结构分割线同配方）、`--root`（去缩进/去线）、`.quickforge-workflow-tool-list`、工具行 `×0.75` 字号与 muted 78%、图标弱化 + hover 强化、`@media (hover: hover)` 下 chevron 默认 `opacity: 0`、Agent 主行 `font-weight: 500` + foreground 84%（用 `:not(.quickforge-tool-running-sweep)` 排除流光标签，避免压掉 `color: transparent` 与 reduced-motion 回退）、reduced-motion 下 Agent 主行回到主行色、`.quickforge-workflow-phase-*` 小标题与步数。
  5. `src/lib/i18n.ts`：新增 `workflowStepCount`（`{count} steps` / `{count} 步`）中英成对。
- 测试（随语义迁移，不放宽断言）：
  - `tests/frontend/workflow-renderer.test.ts`：新增「工具行嵌进 tool-zone 且阶段头带步数」「`workflowPhaseSteps` 把连续工具折到 Agent 之下」「工具独有阶段与孤立工具仍可寻址」3 例 + 1 条 CSS 层级契约（连接线配方、`--root`、字号阶梯、hover chevron、步数等宽）；Agent 主文案断言由「状态在首位」改为「任务名在首位 + 状态仍在 `title`」；既有 18 例全部保留。
- 验证：定向 `npx vitest run` 8 文件 **242 passed**；全量 `npm run test` → **418 文件 4790 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npx tsc -b` 通过；`npm run build` 成功（3.53s）。
- 文档：`DESIGN_LANGUAGE.md` 的「阶段内子级用缩进 + 细连接线」例外规范补一句 run_workflow 复用同配方（阶段开头的 root 工具区不缩进不画线）；`docs/architecture/workflow-orchestration.zh-CN.md` 的 7.2 / 7.3 与样式段、i18n 键清单（+`workflowStepCount`）同步；`docs/wiki/src/lib/README.md` 的 workflow-run-detail 与渲染器契约段同步改写。设计稿保留在 `docs/design/workflow-tool-hierarchy.html`。
- 边界：只做展示层级，不改服务端 details 契约、不改 `seq` 语义、不新增服务端字段；`run_subagent` 单独卡片零变化；未做方案 B（连续工具折叠成组）；工具行仍是独立 `<details>` 默认收起、`stateKey` 记忆不变；阶段之间不加连接线。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：① 工具区归属是「按时间连续」推断的，若将来一个 Agent 中间插入别的 Agent 的工具调用，工具会被拆成两段（当前 runner 是顺序提交，不会发生）；② 真机需目视确认窄列下长文件路径省略、以及深色主题连接线强度。

---

## tool-stage-expand-fixed（done，2026-10-22）

- Goal：用户要求「工具调用列表默认展开，我希望默认就是这样的，设置里面不需要再有了，相关代码也固化」。先出方案（两个决策点：手动收起是否保留、流式思考行归属），用户选「手动收起留」+「流式思考行 A 方案（零视觉变化）」。
- 结论（一句话）：`tool-display-settings.expandProcessStageByDefault` 整条链路降级为渲染常量 `PROCESS_STAGE_DEFAULT_EXPANDED = true`，设置页开关与 4 条 i18n 文案删除，老数据里的字段按未知字段丢弃。
- 改动：
  1. `src/lib/tool-display-settings.ts`：`ToolDisplaySettings` / `DEFAULT_TOOL_DISPLAY_SETTINGS` 删 `expandProcessStageByDefault`；`normalizeToolDisplaySettings` 不再重建该字段，并入 legacy 丢弃清单（`showToolDetails` / `expandToolsByDefault` / `expandToolDetailsByDefault` 同款），老用户存过的 `false` 自动失效、不迁移不清洗。
  2. `src/components/chat/panel-decoration/process-folding.ts`：新增并导出常量 `PROCESS_STAGE_DEFAULT_EXPANDED = true` 取代 `processStageDefaultExpanded()`，`updateProcessStageGroups` 直接用它；删除 `isStreamingThinkingItem` / `splitStreamingThinkingRuns` / `ProcessStageSectionRun` 与 `populateProcessGroup` 的 `detachStreamingThinking` 分支（A 方案：流式思考行留在 stage 内，不再拎到组 body，页面结构恒定）；`resolveProcessExpandedState` 保留（saved state 优先），`index.css` 的 `[data-expanded="false"]` 收起样式保留（手动收起仍需要）。
  3. `src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`：删 state、ref、`loadSettings` 回填、`updateExpandProcessStageByDefault`、`saveToolDisplayOptions` 入参、整行 UI（「交互」组只剩 Tool 显示模式 / 系统通知 / 上下文用量）。
  4. `src/lib/i18n.ts`：删 `expandProcessStageByDefault` 与 `expandProcessStageByDefaultDescription` 中英各 2 条共 4 条；`settings-tabs.ts` 的关键词本来就无该词，未动。
- 测试（随语义迁移，不放宽断言）：
  - `tests/frontend/process-folding.test.ts`：删 `splitStreamingThinkingRuns` 用例；改为「`PROCESS_STAGE_DEFAULT_EXPANDED` 恒 `true` + 增量 key 命中保留现值 + saved state 展开/收起均优先」。
  - `tests/frontend/thinking-streaming-stage.test.ts`：整文件改为恒展开语义——删除 `applyToolDisplaySettingsValue` 驱动与 `afterEach` 复位；S2/S3 合并为「mixed section 恒展开且流式思考行留在 stage body 内」；「流式结束」「跨轮次」断言由 `false` 翻为 `true`；跨 assistant 用例改为断言「默认展开 → 手动收起 → 重建后仍收起」；manual collapse / reading-intent 两条原样保留。
  - `tests/frontend/settings-normalizers.test.ts`：默认值与 legacy 用例去字段，并把 `expandProcessStageByDefault`（true 与 false 两种老值）加入「unknown field 丢弃」断言。
  - `tests/frontend/default-options-settings-react.test.ts`：删开关渲染/保存用例，改为负向断言「不再渲染该行」；`saveToolDisplay` 断言去字段。
  - `tests/frontend/default-options-settings-tab.test.ts`：加同款负向断言（并补 `text` 导入）。
  - `tests/frontend/chat-surface-tool-message.test.ts`：`applyToolDisplaySettingsValue` 参数去字段。
- 验证：定向 `npx vitest run` 9 文件 **124 passed**；全量 `npm run test` → **418 文件 4786 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功。
- 文档：`docs/wiki/src/lib/README.md` 的 `tool-display-settings.ts` 小节整段改写（含行数 40→60）；`docs/wiki/src/components/README.md` 两处重复小节同步；`docs/wiki/src/README.md` 的「通用」页包含项去掉该开关。`DESIGN_LANGUAGE.md` 无该词无需改；`CHANGELOG.md` 留到发布时。
- 边界：保留手动收起（saved state 优先）；按用户选择 A 方案（流式思考行留 stage 内，不做 B 方案可见微调）；顶层过程组默认展开值 `isAgentStreaming` 不动；`toolDisplayMode` / `showContextUsage` 不动；老数据字段不主动删除；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：`PROCESS_STAGE_DEFAULT_EXPANDED` 目前只在 `process-folding.ts` 内部与测试使用；若将来又要「可配」，应该做成「显式产品开关 + 一次性迁移」而不是再让装饰层读模块缓存。

---

## todo-summary-expand-and-retire（done，2026-10-22）

- Goal：用户要求 ① 回合结束（`agent_end`）且 todolist 全部完成时清除、不再显示；② todo 默认展开；③ 完成/运行/待执行三态都要清晰表达。先出设计（含三个决策点：退休时机、退休后是否留入口、置顶摘要是否同步），用户选「单次回合结束即移除」「彻底不显示」「置顶摘要仅统一图标」，实现方式选 A（前端由 `agent_end` 推导，不加服务端字段）。
- 结论（一句话）：退休判定是纯函数 `shouldRetireTodoSummary({ todos, idle })`，`idle = !snapshot.isStreaming` 用状态而不是一次性 `agent_end`，摘要默认展开、全完成且 idle 时淡出卸载，三态图标/文案收敛到 `src/lib/todo-status*` 单一来源。
- 改动：
  1. 新增 `src/lib/todo-status.ts`（`TodoStatus` 类型、`TODO_STATUS_LABEL_KEY`、`TODO_STATUS_GLYPH_CLASS`、`todoStatusLabel()`）与 `src/lib/todo-status-icon.tsx`（`TodoStatusIcon`：pending 空心圆 / in_progress 暗底环 + 1/4 旋转弧 / completed 实心圆 + mask 镂空勾，`useId` 生成 mask id）。拆成两个文件是因为「组件 + 常量同文件」触发 `react-refresh/only-export-components`。
  2. `panel-decoration/todo-write-summary.ts`：新增 `shouldRetireTodoSummary({ todos, idle })`；`TodoWriteStatus` 改为 `TodoStatus` 别名，`TODO_WRITE_STATUS_LABEL_KEY` 改为共享映射的再导出别名。
  3. `surface/TodoWriteSummary.tsx`：`expanded` 默认 `true`，snapshot key 变化时重置为 `true`（用户手动收起只在本轮生效）；新增 `retiredKey`（按 snapshot key 记账，新快照天然恢复）、`fading` 由 `shouldRetireTodoSummary` 派生（不在 effect 里 setState，避开 `react-hooks/set-state-in-effect`）；展开体最终只保留「当前进行中任务行 + 列表」（三态 chips 按用户反馈「待执行 0 / 进行中 0 / 已完成 8 不要显示，保持简洁」已删除）；行级图标改用共享 `TodoStatusIcon`。
  4. `surface/ChatSurface.tsx`：传 `idle={!snapshot.isStreaming}` 给 `<TodoWriteSummary>`，不新增 `turnEnded` state。原因：`turnEnded` 只能由实时 `agent_end` 置位，刷新页面 / 切会话 / 恢复历史会话时该事件永不到来，会让「全完成」的清单永久常驻（用户实际遇到的现象）。
  5. `GitToolsPinnedSummary.tsx`：`TodoStatusIcon`/`todoStatusLabel` 改走共享实现 + `TODO_STATUS_GLYPH_CLASS`，删除 lucide `CheckCircle2`/`Clock3`/`Circle` 在任务分组里的用法（`CheckCircle2` 在 subagent 段仍用）。`slice(0,3)` 与展开行为未动。
  6. `tool-renderers/todo-write-tool-renderer.tsx`：删除自带的 `todoHistoryStatusIcon`（模块级 `mask` 自增计数器）与 `todoHistoryStatusLabel`，改用共享图标与 `t(TODO_STATUS_LABEL_KEY[todo.status])`。
  7. `src/index.css`：TodoWrite 段的硬编码时长全部改 `--quickforge-dur-*` / `--quickforge-ease-out`；删除 `nth-child` 阶梯淡入与 `translateY` 位移（改整体 opacity 淡入，符合 DESIGN_LANGUAGE「列表只做 opacity 淡入、不做逐项瀑布」）；新增 `--in_progress` 行底、`[data-fading]` 退出、胶囊 `@starting-style` 进入、`.quickforge-todo-glyph--*`（置顶摘要用）；进行中图标最终改为「22% 暗底环 + 1/4 主色弧 900ms 旋转」（`.quickforge-todo-spin-arc` / `-spin-track`，只有弧动、文字不动），reduced-motion 关闭旋转并把底环提到 45% 透明度读作 3/4 环。
  8. `src/lib/i18n.ts`：本轮最终没有新增任何 key——chips 与「正在：」行都按用户反馈删除，对应的 `todoWriteChip*` / `todoWriteCurrentTask` 也同步移除，保持中英键集一致。
  9. 测试：`tests/frontend/todo-write-summary.test.ts` 重写（新增 `shouldRetireTodoSummary`、默认展开、共享 glyph、「回合结束后淡出并卸载」「有剩项时保留」「退役后可恢复」、以及「body 内不再有 chips/当前任务行」的负向断言；旧的「全完成自动收起」契约改为「全完成仍展开、回合结束后移除」）；`todo-write-renderer.test.ts` 的状态断言改为「渲染器消费共享映射」。
  10. 文档：`docs/wiki/src/components/README.md`（注意该文件 L14-302 与 L340-628 是逐字重复的两套段落，两处 TodoWrite 条目都改了）、`docs/wiki/src/lib/README.md`（新增 `todo-status.ts / todo-status-icon.tsx` 小节 + 历史卡一行）、`CHANGELOG.md`（新增 `[Unreleased] / Changed`）。
- 验证：定向 `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts tests/frontend/git-tools-pinned-summary.test.ts` → 3 文件 **65 passed**；全量 `npm run test` → **418 文件 4786 passed / 2 skipped**（exit 0）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` 的 `react-hooks/exhaustive-deps` warning）；`npx tsc -b` 通过；`npm run build` 成功。
- 边界：不改 `GitToolsPinnedSummary` 的 `slice(0,3)` 与展开行为（仅统一三态图标）；历史工具卡默认折叠不变；不改 server 端 SSE 契约（退休判定用前端已有的 `snapshot.isStreaming`，未给 `agent_end` 加 reason 字段）；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes（未做，供下轮）：未做真实浏览器视觉验收（用户表示自行验证；当时端口 5176 / 32176 被既有实例占用，MCP 打开报 `QuickForge local service is unavailable`）。另：本轮早期全量测试曾出现 7 个 `expandProcessStageByDefault` 相关失败，属既存失败，已由后续 `tool-stage-expand-fixed` 一轮修复，现全量 4786 passed。

---


- Goal：用户判断 `design-mockups/` 内均为临时产物，要求整个目录清空、且不留档。
- 改动（删除）：`design-mockups/` 整目录（14 个 HTML，约 320KB）——`ask-user-tool`、`assistant-reply-file-card-v2`、`assistant-stopped-message-preview`、`command-console-fixed-width`、`composer-borderless`、`conversation-error-retry`、`input-clamp-expand`、`reconnect-indicator`、`slash-menu-expansion`、`todo-tool-card-structured`、`tool-running-feedback-styles`、`tool-running-sweep-white`、`unreachable-notice`、`turn-error-composer-strip`（后者为本轮新增未定稿草稿，先前已单独删除）。
- 改动（引用同步，避免死链）：`feature_list.json` 两处 `files` 数组移除 `design-mockups/*` 条目（工具运行态流光 feature、后台命令菜单宽度 feature），JSON 解析校验通过；`progress.md`、`session-handoff.md` 的设计对比稿表述改为「已随后续整体删除，规格以 `DESIGN_LANGUAGE.md` 为准」；非归档引用全部去掉路径——`src/index.css` 6 处、`src/components/chat/{command-suggestions.ts,slash-invocation-chip.ts,panel-decoration/{ask-user-card.ts,message-actions.ts,turn-error-row.ts}}`、`src/lib/{input-clamp.ts,tool-renderers/todo-write-tool-renderer.tsx}` 改为纯文字规格描述；`docs/wiki/src/{components,lib}/README.md` 去路径。
- 边界：`docs/archive/*`（progress-archive.md、session-handoff-archive.md、feature-list-archive.json）为历史归档，保留原有 `design-mockups/` 路径记录不回改——归档语义即「当时状态」，且不清空归档可保留决策脉络。未改 `.gitignore`（不做过度忽略规则）。未触碰生成产物，未创建 Git commit。

---

## fix-thinking-level-menu-clipped（done，2026-10-22）

- 现象：对话中的思考等级「没法选择」。根因是 `decb5d6`（装饰层渲染化 M4）把思考档位控件从 `panel-decoration/thinking-level-controls.ts` 搬成 React 组件时，菜单从「`document.body.append` 的原生 DOM」变成「渲染进组件树内部」，但样式仍是 `position: fixed` + `getBoundingClientRect()` 视口坐标。
- 机制：控件挂载在输入框卡片内（`MessageEditor.tsx:712` → 卡片 `MessageEditor.tsx:605`），而 `.quickforge-composer > div:first-child`（`src/index.css:4605-4616`）带 `backdrop-filter`，会让卡片成为 `fixed` 后裔的包含块，视口坐标被当成卡片内坐标写入 → 菜单落到卡片外；卡片 `overflow: hidden` 再把它裁掉；`z-index: 10000` 也被困在卡片的 stacking context 里。表现即「点了没反应 / 闪一下就没」。空态新会话因为 `index.css:6107` 覆盖成 `backdrop-filter: none`，所以那边正常 —— 正好对应「对话中不行」。
- 改动：
  1. `src/components/chat/surface/ThinkingLevelControl.tsx`：菜单改用 `createPortal(..., document.body)` 渲染（恢复装饰层时代的逃逸行为），并把测量 effect 换成 `useLayoutEffect` 以免首帧在离屏位置闪现；顺带加上「上方空间不足时翻到触发器下方」的翻转逻辑（`above`/`below` 分支）。
  2. `src/components/chat/surface/ChatSurface.tsx`：`ThinkingLevelControl` 的 `disabled` 从裸 `composerControlsDisabled` 改为 `composerControlsDisabled || leaseObserver`，与同一行 `+`/模型/Access 控件的语义对齐（此前别的窗口持有写租约时，其他控件置灰而思考控件仍可点）。
- 测试：`tests/frontend/thinking-level-control.test.ts` 增加断言「菜单的父节点是 `document.body`」，把 portal 这个必须成立的前提钉死。
- 文档：`docs/wiki/src/components/README.md` 两处描述更新为 `surface/ThinkingLevelControl.tsx`、正确的渲染条件（`enableThinkingControl && snapshot.model?.reasoning === true`）以及「菜单必须 portal 到 body」的原因。
- 验证：定向 vitest 4 文件 82 passed；全量 `npm run test` → 418 文件 4779 passed / 2 skipped；`npx eslint` 改动文件 0 error；`npx tsc -b` 通过。
- 未处理（在范围外，仅记录）：若某会话持久化的 model 仍是 `reasoning: false`（自定义供应商未勾选推理模型、或老会话快照过时），`ChatSurface.tsx:1523` 的严格 `=== true` 会让按钮整体不渲染——这是另一条独立原因，需要「加载会话时对持久化 model 做一次 `resolveConfiguredModel`」才能修，本次未动。

---

## remove-default-model-thinking-level（done，2026-10-22）

- Goal：用户要求「移除设置里面默认选择的模型和思考等级，完全取决于最近一次用户选择的模型和思考等级」。
- 根因：设置页「通用」有 `defaultModel` / `defaultThinkingLevel` 两行（settings 键 `default-options`），与 `active-model`（最近一次模型）形成两套来源；用户在模型选择器/思考等级下拉里换值只写 `active-model` 与会话级 `thinkingLevel`，`default-options` 仍是旧值，于是下一个新会话又被打回设置里的默认。
- 改动：
  1. `src/lib/pi-chat.ts`：删 `DEFAULT_OPTIONS_SETTING_KEY` / `DefaultOptions` / `StoredDefaultOptions` / `saveDefaultOptions` / `loadDefaultOptions`；新增 `ACTIVE_THINKING_LEVEL_SETTING_KEY = 'active-thinking-level'`、`saveActiveThinkingLevel()` / `loadActiveThinkingLevel()`、`resolveNewSessionThinkingLevel(model, saved)`、`loadLastUsedSessionOptions()`；`ModelReference` 类型导入随之删除。
  2. 设置页 `DefaultOptionsSettingsTab.tsx`：删两行 UI 与全部配套代码（models/selectedModel/thinkingLevel state、`defaultOptionsSavePromiseRef`/`selectedModelRef`/`thinkingLevelRef`、`updateModel`/`updateThinkingLevel`/`saveDefaultModelOptions`、`modelKey`/`findModelByValue`/`resolveDefaultModel`、`THINKING_OPTIONS`、`loadModelCatalog`/`modelLabel`/`getSelectableConfiguredModels`/`mergeAvailableModels` 引用）；「基础」组只剩语言。
  3. 消费方改读「最近一次」：`useAppBootstrap`（`chooseStartupModel` 去掉 `preferredModel` 入参）、`useAgentManager.createAgent`/`startDeferredSession`、`ScheduledTasksPage`、`GitCommitPushDialog`（改用 `loadLastUsedSessionOptions`）、`AgentProfilesPage`、`server/acp/server.mjs resolveInitialThinkingLevel`。
  4. `ChatPanelHost.tsx`：思考等级下拉切换时额外写 `active-thinking-level`（原先只写会话级），保证「最近一次」被记住。
  5. `i18n.ts`：删 `defaultModel`/`defaultModelDescription`/`defaultThinkingLevel`/`defaultThinkingLevelDescription`/`thinkingRequiresReasoningModel` 中英各一份；改写 `defaultOptionsDescription`；`settings-tabs.ts` 搜索关键词去掉「模型/思考」。
- 回退规则（与旧 `defaultThinkingLevelForModel` 一致）：非推理模型强制 `off`；否则用已记住的等级；从未记录过才回落推理模型 `high`。
- 测试：新增 `tests/frontend/pi-chat-thinking-level.test.ts`（5 例：active-thinking-level 往返、非法值归一与拒读、推理模型复用已选等级、从未记录回落 high、非推理强制 off）；`default-options-settings-tab.test.ts` 改为「不再渲染两行」负向断言 + 原数值项用例；`default-options-settings-react.test.ts`、`use-app-bootstrap-{snapshot,migration}.test.ts`、`scheduled-tasks-page.test.ts` 的 pi-chat 桩换为 `loadActiveThinkingLevel` / `resolveNewSessionThinkingLevel`；`tests/server/acp/server.model-visibility.test.mjs` 新增「新 ACP 会话复用 active-thinking-level」用例（含 raw JSON 与已解码两种存储形态）。
- 验证：全量 `npx vitest run` → **418 文件 4779 passed / 2 skipped**（exit 0）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.40s，仅既有 chunk 体积 warning）。
- 边界：不改 `active-model` 既有语义与写入点；不改会话级 `thinkingLevel` 持久化（服务端 sessions/session-state 未动）；旧数据里的 `settings['default-options']` 不再读写但**不主动删除**（保留回滚，不影响运行）；未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## remove-image-generation（done，2026-10-22）

- Goal：用户表示「当前项目暂时不支持生成图片」，要求移除 generate-image-tool-renderer 相关代码；经确认采用「前后端全删」方案（session-assets 只读路由与存储清理保留）。
- 改动：
  1. 服务端：删除 `server/image-generation.mjs` 与 `tests/server/image-generation.test.mjs`；`server/tools/index.mjs` 移除 `generateSessionImages` 导入与 handler 注册；`server/routes/tools.mjs` 移除 `directRouteDisabledTools` 的 `generate_image` 条目；`server/session-assets.mjs` 删除仅被图片生成使用的 `writeSessionAsset` 写入路径（`normalizeMimeType`/`decodeBase64`/`normalizeImageData` 一并删除），`MAX_SESSION_IMAGE_BYTES` 改为模块私有，read/delete 与路由保留。
  2. 前端：删除 `src/lib/tool-renderers/generate-image-tool-renderer.tsx`、`src/lib/generated-image-assets.ts` 与 `tests/frontend/generated-image-assets.test.ts`；移除 `tool-renderers/index.ts` 导出、`local-tools.ts` 注册、`i18n.ts` 中英各 5 组词条、`index.css` 两处选择器与注释、`approval-card.ts` BUILTIN_TOOL_LABELS 条目、`process-folding.ts` 顶层排除特判、`shared.tsx` 图标分支、`tool-param-summary.ts` 摘要分支。
  3. 测试同步：approval-card / process-folding / tool-param-summary / chat-surface-css-contract / definitions / session-assets 六个测试文件更新（session-assets 路由测试夹具改直写文件）。
  4. 文档：user-guide zh/en 删除「图片生成」小节；docs/wiki（server/tools、server、src/lib、src/components、src）与 docs/architecture/session-open-fast-path.zh-CN.md 同步更新。
- 行为变化：历史会话中的 `generate_image` 结果回落默认工具卡兜底渲染；已生成图片文件仍在会话资产目录、`/api/session-assets/...` 与分享资产路由可读，但前端不再有查看/下载入口。
- 验证 / Evidence：定向 vitest 6 文件 125 passed；`npx tsc -b` 通过；`npx eslint src server tests` 通过；全量 `npm run test` → 417 文件 4773 passed / 2 skipped（首轮曾偶发 `tests/frontend/local-tool-running-sweep.test.ts` 1 例失败，该测试切片区域未被本次触碰，单文件与复跑全量均通过，判定为既有并行抖动，与已知 flaky 现象同类）。
- Notes：无依赖变更；未手工修改 `dist/`、`package-dist/`、`package-offline/`；改动未提交。

---

## streaming-decorate-hotpath（done，2026-10-22）

- Goal：用户问「分析一下有那些会导致界面卡断，是 css 的问题么」，确认**不改变现有产品体验和交互**（零外观/交互/时序反馈变化，只优化实现）后，在新分支 `perf/zero-ux-streaming-hotpath` 落地流式输出期间的装饰热路径优化。
- 根因：流式期间每个 `message_update`（server 50ms 合并，客户端约 20 帧/s）都触发**完整** `decorateMessages`——618 行会话实测单次 12–17ms，即流式期间每秒 240–340ms 花在装饰主线程上。完整 pass 中绝大部分（消息动作按钮、产物卡、压缩横线、审批卡插入点、composer 绑定）在回合内不变，只有过程折叠需要每帧对账。CSS 不是主因：`.user-message-container` 的 `backdrop-filter: blur(10px)` 视觉上无效（气泡背景与面板背景均不透明），但为每条用户消息建一个合成层，是次要成本。
- 改动：
  1. 新增 `panel-decoration/decorate-scheduler.ts`：每帧最多一次装饰，`streaming`/`full` 两档，同帧 pending 的 full 覆盖 streaming，带 cancel 句柄。
  2. `panel-decoration/message-actions.ts` 新增 `decorateStreamingMessages(panel, messageRows?, isStreaming?)`：只跑 `decorateProcessBlocks`（对账过程折叠/thinking hint）+ `scrollBottomButton.setup()`（内容增长可在无 scroll 事件时跨过回底阈值，必须保留）；接受宿主传入的已提交行快照，追加流式行后不做行级装饰。
  3. `ChatPanelHost.tsx`：行枚举改 `createMessageRowSnapshot`（一次完整 pass 内复用，流式档直接拿快照）；事件订阅按 `event.type === 'message_update' && agent.state.isStreaming` 分档；结构事件（message_start/end、turn_end、agent_end、工具边界、messages_replaced）、MutationObserver、视图重新激活仍走 full。
  4. `src/index.css`：移除 `.user-message-container` 的 `backdrop-filter: blur(10px)` 及 `-webkit-` 前缀（不透明背景下无可见差异）。
- 测试：新增 `tests/frontend/decorate-scheduler.test.ts`（5 例：streaming+full 合并为一次 full、full 后 streaming 仍 full、纯 streaming 单独跑、跑完可再排新帧、cancel 丢弃 pending）与 `tests/frontend/streaming-decoration.test.ts`（3 例：流式行追加且不做行级装饰、接受缓存行快照、非流式不追加）。
- 验证：全量 `npm run test` → **419 文件 4783 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc --noEmit` 通过；`npm run build` 成功。
- 文档：`docs/architecture/session-open-fast-path.zh-CN.md` 新增「M5：流式装饰热路径（已实施，2026-10-22）」章节；`docs/wiki/src/components/README.md` ChatPanelHost 小节（文件内两份重复小节同步）新增装饰调度两档说明。
- 边界：不改任何可见外观或交互时序——贴底仍由 scrollSync 的 ResizeObserver 负责，滚动行为、动作按钮、过程折叠展开态均不变。未做（见 M5「仍未改动」）：`tool_execution_update` 仍触发完整装饰、流式 Markdown 仍按帧全量解析、消息列表仍全量常驻 DOM；真实浏览器流式 A/B（longtask 基线）待做。未新增依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## dsh-trajectory-design（done，2026-10-22）

- Goal：只读调研 DSH（DeepSeek Harness）会话轨迹的存储与事件设计（用户问「能不能读取 dsh deepseek harness 的轨迹的设计」）。纯调研，未改产品代码、未更新 docs/wiki（调研结论非架构变更，沉淀在 session-handoff.md 即可）、未创建 Git commit。
- 结论（一句话）：DSH 轨迹 = **追加式 zstd 多帧 JSONL 事件日志** `~\.dsh\sessions\<workspace-slug>\<sessionId>\session.v4.jsonl.zstd`；事件信封 `{type, seq, time, data, surfaceOp?, sourceEventSeqs?}`，seq 从 0 连续递增（实测 12 会话 0 gap），恢复即顺序重放。头事件 `session{version:4,id,createdAt,cwd,parentSession?,origin?,delegationDepth,agentPreset}` 无 seq。
- 解压要点（避坑）：文件是**多帧 zstd 拼接**，`zstdDecompressSync`/流式解压都只吐第一帧；必须按 zstd magic `28 B5 2F FD` 切帧逐帧解压再拼（最大会话 3.7MB = 2671 帧 / 4499 事件）。
- 事件分层（41 种）：会话配置（permission/preset、sandbox/mode、approval/policy）→ 轮次骨架（turn/start→step/start→…→step/end→turn/end{reason:completed|error|aborted{user|parent}}）→ 模型交互（request/header 含 tools 全量定义快照、request/context、system/user/assistant/message，assistant 带 usage 与全量 stream[] 流记录 + source.replayState 可重放回源；失败另有 assistant/attempt + llm/retry*）→ 工具生命周期（tool/call → job/registered → job/settled → tool/result{message,error?,meta?}，meta 按工具结构化）→ 审批/命令 → agent/inbox/spliced 注入 → **Goal 事件溯源**（goal/change 完整快照 + revision CAS，即 QuickForge Goal v2 对标的源头）→ 压缩（compaction/prune 裁剪审计 + summary 以 compact-checkpoint user/message 投放）→ 工作流/子代理（tool-workflow/* + subagent/descriptor|catalog，子代理是独立 session 文件双向链接）→ 元数据/遥测（session/title、delivery-accepted{throughSeq} 水位 ack）。
- Evidence：Node 24 `zlib.zstdDecompressSync` 按帧切分解压 12 个会话共 9931 事件全部 JSON 可解析、seq 零缺口；配置面 cordis.patch.yml 与 storages/workspace.json 一并读过。
- Notes：可复用脚本 `.tmp-dsh-lib.mjs` / `.tmp-dsh-zframes.mjs` / `.tmp-dsh-inspect.mjs` / `.tmp-dsh-src.mjs` 留在仓库根（一次性分析产物已清理）；详细契约见 session-handoff.md「dsh-trajectory-design」条目。未新增依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## tool-running-text-shimmer（done，2026-10-22）

- Goal：用户问「运动命令时候的扫光是不是黑色的，白色会不会更好」，随后选择把运行态扫光改成**渐变高光在文字内部流过**（复用思考 shimmer 范式）。
- 根因：原 `.quickforge-tool-running-sweep::after` 用 `color-mix(in oklab, currentColor 12%, transparent)` 在标签上层盖一条滑动的光带。`currentColor` 取的是 `--muted-foreground`，浅色主题下是灰色带（观感像黑色扫光）、暗色下近白 —— 同一份代码两套观感，且光带压在文字上层会降低可读性。用户提议改成纯白，但白底 + 白扫光在浅色主题下等于失效。
- 改动（`src/index.css`）：删除 `::after` 覆盖层与 `@keyframes quickforge-tool-running-sweep`，改为标签自身承载渐变：
  1. `background-image: linear-gradient(90deg, muted-foreground 25%, foreground 50%, muted-foreground 75%)` + `background-size: 200% 100%` + `background-clip: text` + `color: transparent`，动画直接复用既有 `shimmer 2s ease-in-out infinite`（与思考文本同一 keyframes、同一节奏）。
  2. **底色兜底** `background-color: var(--muted-foreground)`：渐变在 200% 幅面里只覆盖部分区间，端点相位会让整段文字「失焦」不可见；铺不透明底色后任意相位都可读，且渐变的两个端点色与底色相同，无接缝。
  3. `.quickforge-tool-running-sweep .quickforge-tool-summary-detail { color: var(--muted-foreground) }`：参数摘要（` · npm run build`）不能被父级的 `color: transparent` 吞掉。
  4. `prefers-reduced-motion` 下 `background-image: none` + `background-clip: border-box` + `color: inherit` + `animation: none`，回到普通文字，不留静态渐变运行态。
- 测试迁移：`tests/frontend/local-tool-running-sweep.test.ts` 的 CSS 契约从「伪元素 + translateX + currentColor 12%」改为「text-clip 渐变 + shimmer 复用 + 底色兜底 + detail 不透明 + reduced-motion 回退」，并新增断言「不再存在 `.quickforge-tool-running-sweep::after`」；`tests/frontend/motion-design.test.ts` 的豁免长循环断言改锚 `animation: shimmer 2s ease-in-out infinite`。
- 验证：定向 vitest（local-tool-running-sweep / motion-design / chat-surface-css-contract / subagent-run-detail / tool-param-summary）**5 文件 178 passed**；`npx eslint` 改动文件 0 error；`npm run build` 成功（7.87s，仅既有 externalized / chunk size warnings）；Playwright 实测深浅两主题：计算样式确认为 `background-clip: text` + `color: transparent` + `background-color: oklch(0.556/0.708)`，-200%…200% 各相位文字均完整可读，亮部落在字形中部，`· npm run build` 保持自身灰色。
- 文档：`DESIGN_LANGUAGE.md` 动效章节新增「工具运行态流光」条目（范式、底色兜底、detail 保护、reduced-motion 回退）；设计对比稿（8 方案 / 白色 4 档）已随 `design-mockups/` 整体删除，结论以本文件与 `DESIGN_LANGUAGE.md` 为准。
- 边界：只改 running 态工具标题的视觉表现（`quickforge-tool-label` 的 sweep 类名与 CSS），renderer 结构、`aria-busy` 语义、`renderStatus` 显隐、run_command 输出与终止按钮、subagent 跑马灯均未动；未新增依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。
- Notes：`appearance` 类阴影/滤镜仍被契约测试禁止，本次未引入；若后续想强化「光的质感」，只能在渐变停靠点上做文章（不改结构、不加 filter）。
- Notes（与本次 feature 无关，已顺手修）：全量 `npm run test` 曾出现 1 例失败 `tests/frontend/server-agent-events-types.test.ts`（TS 诊断报 `src/lib/session-lease-client.ts:171` `failure: null` 不匹配 `SessionLeaseFailure | undefined`）；`npm run lint` 报 `MessageEditor.tsx:228` `readOnlyPlaceholderKey` 声明了却未被引用。两者都来自并行会话的会话租约/composer 未提交改动。修复：`failureFromStatus` 返回类型去掉恒不出现的 `| null`；`ComposerTextarea` 改为真正使用 `readOnlyPlaceholderKey`，父组件把 `composerReadOnlyPlaceholderKey` 透传下去，两个 prop 的类型由 `string` 收窄为 `AppTextKey`（`t()` 要求字面量联合）。
- 最终验证：`npm run test` **417 文件 4775 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功。

---

## abort-lease-header（done，2026-10-22）

- Goal：用户反馈「点击暂停无效，控制台报 `POST /api/agents/:id/abort 409 (Conflict)`」。
- 根因：`ServerAgent.abort()`（`src/lib/server-agent.ts:865`）是唯一漏发租约身份头的写入口——只调 `fetch(url, { method: 'POST' })`，没带 `writeHeaders()`。服务端 abort 路由有 `assertSessionWriteAccess`（`server/routes/agent.mjs:337`），读不到 `x-quickforge-client-id` 就按匿名客户端处理，租约被持有时返回 409 `SESSION_LEASE_HELD`。因为前端 `canWrite()` 已先放行（本页就是持有者），请求才会真的发出并撞上 409。又因原实现只 `.catch()` 网络错误、不检查 `response.ok`，409 被静默吞掉，表现为「点了没反应、运行继续」。
- 改动：① `abort()` 补 `headers: this.writeHeaders()`；② 增加非 2xx 的 `logger.warn`（带 status），让后续同类拒绝不再隐身。③ `tests/frontend/server-agent-session-lease.test.ts` 新增 1 例断言 abort 请求带 `x-quickforge-client-id`。
- 验证：`npx vitest run tests/frontend/server-agent-session-lease.test.ts tests/server/routes/agent.test.mjs tests/server/session-lease.test.mjs` → 3 文件 84 passed；全量 `npm run test` → **417 文件 4774 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc --noEmit` 通过；`npm run build` 成功（6.70s）。
- Notes：`docs/wiki/src/lib/README.md:179` 早已声称「所有写请求经 `writeHeaders()` 携带」，本次修复后该描述才真正成立，无需改文档；但**同类漏项值得复查**（新增写路由时容易再忘）。

---

## session-write-lease（done，2026-10-22）

- Goal：回答用户「消息保存失败，请刷新或重试，以免丢失最近的对话记录」是什么意思后，用户选择落地 **A2 会话级独占（防多标签/多设备）**。
- 根因：写权限只有两道防线 —— ① 进程内 per-session FIFO 锁（`session-persistence-lock.mjs`），但只有 `persistSession` 走它；② SQLite revision CAS（`BEGIN IMMEDIATE` 内 check-then-write）。真实并发写入口（第二标签页、局域网第二设备、多进程共享 dataDir）从未经过该锁，`runPrompt` 的业务门禁也只有本地 `state.isStreaming`，且检查到真正开跑之间有多处 `await`（TOCTOU 窗口）。CAS 冲突时的策略是「拒绝覆盖 + `persist_degraded` 告警」，于是并发写退化为用户可见的「消息保存失败」。另注意原 `session.sseConnected` 独占位（重复连接 409）早已无人消费——前端改用全局事件流 `/api/agents/events` 后那条链失效。
- 服务端改动：
  1. 新增 `server/session-lease.mjs`：纯同步逻辑（无 await 即无 TOCTOU）。`acquire`（申领/续约，续约不广播）、`forceTake`（用户显式接管，无条件覆盖并广播）、`release`（只允许持有者，避免旁观页关闭打掉持有者写权限）、`get`（过期即按无人持有返回）、`canWrite`（无租约放行，兼容 ACP/定时任务/共享会话与升级前单端行为）、`clear`（带 fence 防「旧连接迟到释放清掉新租约」）。TTL 60s；`publish` 抛错被吞掉（租约是并发保护，不是可用性依赖）。
  2. 新增 `server/agent-session-lease.mjs`：装配层，把租约表接到 `agentSessions` 与 `emitSessionEvent`，变化以 `session_lease` 帧广播；6 个函数由 `agent-manager.mjs` facade re-export（`agent-manager-exports-contract.test.mjs` 的 `EXPECTED_EXPORTS` 同步 +6）。
  3. `server/routes/agent.mjs`：新增 `GET|POST|DELETE /api/agents/:id/lease`（客户端标识取 `x-quickforge-client-id` 头，缺失回落 body `clientId`，都没有 400 `SESSION_LEASE_CLIENT_ID_REQUIRED`；他人持有 409 `SESSION_LEASE_HELD` 并回带当前 `lease`；`{takeover:true}` 为显式接管）；新增 `assertSessionWriteAccess` 并挂到 **13 条写路由**（prompt/goal/abort/continue/steer/follow-up/title/access-mode/yolo-mode/model/thinking-level/rollback/rollback-turn）**入口**——守卫在 `await readJsonBody` 之前，被拦下的请求不读 body、不进 `runPrompt`，这正是对旧 TOCTOU 空窗的补位。审批与 `ask_user` 应答**不**设门禁（避免非持有页看不到卡片时把运行卡死）。
  4. `getSessionState` / `getSessionStatus` 增加 `lease` 字段（经 `createSessionQueries` 注入 `getWriteLease`），state 帧与 `/status` 都能带下来；`destroyAgent` 结束处 `clearSessionLease(sessionId, {force:true})`。
- 前端改动：
  5. 新增 `src/lib/session-lease-client.ts`：`clientId` 存 sessionStorage（刷新不变、新标签页新值，正好对应「谁在写」）、`acquireLease`/`takeOverLease`/`releaseLease`、`leaseSnapshotFromWire` 把 `{clientId}` 翻译成 `owner`/`observer`、20s 心跳常量。**409 与网络失败一律不降级为可写**（拿不到租约按只读处理）。
  6. `ServerAgent`：新增 `enableSessionLease()`（申领 + 20s 心跳）、`takeOverSessionLease()`、`canWrite()`、`subscribeSessionLease()`（供 `useSyncExternalStore`）；`dispose()` 释放租约并停表；`state.sessionLease` 由心跳结果与 `session_lease` SSE 帧共同维护（`applySessionLease` 对同值去重不广播）；10 个写入口以 `canWrite()` 本地拦截（一个请求都不发，避免「先乐观插入再回滚」的界面闪烁）；所有写请求经 `writeHeaders()` 携带客户端头。`global-agent-sse-client.ts` 的 eventTypes 增加 `session_lease`。
  7. UI：`ChatPanelHost` 挂载时（非 `readOnly`/非 Side Chat）申领租约，用 `useSyncExternalStore` 订阅（第一版用 `useEffect` 内 setState 被 lint 的 `react-hooks/set-state-in-effect` 拦下，改为外部 store 订阅后消失）；`ChatSurface` 新增 `SessionLeaseStrip`（提示条 + 「在此窗口接管」）与 `composerReadOnly` 门禁（textarea `readOnly` + 专用占位文案、发送按钮禁用、paste/drag/drop 短路），并复用既有 `composerControlsDisabled` 语义禁用「+」/模型/access 控件；`index.css` 新增 `.quickforge-lease-*` 样式（与 unreachable strip 同族的 Amber 信息色）；i18n 新增 6 条中英文案。
- 新增测试：`tests/server/session-lease.test.mjs`（17 例：申领/续约不广播/他人持有被拒/TTL 过期可抢占/过期视作无人持有/显式接管/仅持有者可释放/非法 clientId 被拒/trim/无 clientId 在租约存在时被拒/fence 防跨代误释放/force 清理/会话独立/publish 抛错不影响写入/自定义 TTL）、`tests/frontend/session-lease-client.test.ts`（14 例）、`tests/frontend/server-agent-session-lease.test.ts`（11 例：未启用租约完全走旧路径、心跳续约、头部携带、非持有者本地丢弃 prompt 与其他 8 个写入口、SSE 帧双向切换、同值帧不重复通知、接管、dispose 释放且停表、重复 enable 只申领一次）；`tests/server/routes/agent.test.mjs` 新增 8 例（GET 只读不改状态、POST 从头部取 clientId、409 回带 holder、takeover、DELETE 释放、缺 clientId 400、非持有者 409 且 `runPrompt` 未被调用、10 条写路由统一守卫、持有者正常通过）。
- 验证：`npm run test` **417 文件 4773 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 成功（5.03s）。
- 修过程中的两次返工（记录以便下轮避坑）：① `agent-manager.mjs` 里 `export { ... }` 漏掉 `from` 造成 rolldown `Duplicated export`，一度让 28 个测试文件整体加载失败；② 起初把租约函数挂在 `agent-manager` facade 上供路由导入，导致 9 个既有 `vi.mock('server/agent-manager.mjs')` 的测试全部 `No "canWriteSession" export is defined`——最终改为**路由直接 import `agent-session-lease.mjs`**，facade 仍 re-export 保住导出面契约，既有 mock 零改动。
- Notes（未做，供下轮）：① 用户本次只选了 A2；**A1（pin/归档改字段级 patch）未做**——侧栏 pin 仍会把客户端整份缓存 metadata 回写 state（`lastModified/title/taskStatus`），这是目前最高频的 `persist_degraded` 诱因，agent 侧冲突白名单只有 `pinnedAt/archivedAt`。② **C6/C7 未做**：`bodyUnchanged` 仍比整份 canonical JSON，冲突后仍是「放弃写入」而非「重读 + 合并 messages 再写一次」。③ 租约仍是**单进程内存态**（语义同原 `sseConnected`），多进程共享 dataDir（`npm start` 与 `npm run dev`/桌面版并存）无进程级文件锁，跨进程正确性继续靠 CAS 兜底。④ 审批与 `ask_user` 应答未纳入门禁——若后续要求更强隔离，需要同时解决「非持有页看不到卡片」的 UI 问题。⑤ `session.sseConnected` 独占链仍是无消费方的死代码，可在确认无外部依赖后删除。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## composer-typing-latency（done，2026-10-22）

- Goal：修用户反馈「对话轮次多了之后，输入框打字非常卡」。用户选择 P1+P2，并要求只做内部重构、外观/交互零变化。
- 根因（一句话）：热路径归属错了。输入文本存于 `ChatSurface` 顶层 `useState`，每按一个键就重渲染整个 surface（1417 行）；其中 `UsageBar` 的 `aggregateUsage`（`filter`+`reduce` 全量 assistant 消息，每次新建数组）与 `TodoWriteSummary` 的倒序扫描都是 O(消息数)，成本随轮次线性增长 —— 这才是「只有长会话卡」。`MessageArea` 早就被 memo 围栏挡住，但围栏越加越多、热路径仍在顶层。
- 三条叠加成本链：① 渲染——按键 → `setEditorValue` → 整树重渲染（`MessageEditor`/`GoalStrip`/`PlusMenu`/`ThinkingControl` 均未 memo）；② 命令式联动——`editor.onInput` 串联 4 个控制器，两个建议菜单每键 `innerHTML=''` 全量重建，`handleEditorInput` 每键两次 `querySelector`；③ 装饰放大——面板级 `MutationObserver{childList,subtree}` 把菜单/chip/附件 tile 的节点增删都当成「需要全量 decorate」，而 decorate 含约 39 项 O(消息数)/O(DOM 数) 操作。
- 改动（P1）：
  1. 新增 `src/components/chat/surface/composer-store.ts`：`text` / `attachments` 两个独立切片的外部 store（`useSyncExternalStore`）。切片独立通知，所以一次按键不会唤醒附件订阅者。
  2. `ChatSurface`：删除 `editorValue`/`editorValueRef`/`editorAttachments`/`editorAttachmentsRef` 四个副本与两个镜像 effect，改持一个 `useState(createComposerStore)`；`applyEditorText`/`applyEditorAttachments` 变成 store 写入口；bridge 的 `value`/`attachments` 改为纯适配器（getter 读 store、setter 写 store，自身零状态）——顺带消灭「同一值每键写 2–3 次 + `handleEditorInput` 跑 2 次」的旁路。
  3. `MessageEditor`：拆成 `ComposerTextarea` / `ComposerAttachmentRow` / `ComposerActionButton` 三个 memo 叶子，各自只订阅需要的切片。textarea 的 `onChange` 只 `store.setText()`，不再回写 DOM（旧实现此处写一次、React 提交再写一次）。
  4. `AgentSurfaceSnapshot` 新增 `usage` 与 `todoSnapshot`，由 `readAgentSnapshot` 一次算出，按 `messages` 数组身份用 WeakMap 缓存（复用既有 R1 F1a 身份复用机制）。`UsageBar` 改收 `totals: Usage` 并 memo 化；`TodoWriteSummary` 改收 `{snapshot,key}|null`。
- 改动（P2）：
  5. `MutationObserver` 回调先按 `closest('.qf-scroll-container')` 过滤 added/removed/target，只有消息区变动才 `scheduleDecorate()`；composer 侧节点增删不再喂全量 decorate。
  6. `command-suggestions` / `file-reference-suggestions` 各加 `renderedSignature`（query + 命中条目 + loading/directory/state），签名不变直接 return；`remove()`/`removeMenu()` 清空签名保证重开必重建。
  7. `handleEditorInput`/`handleEditorFilesChange` 改用 `resolveEditor()`（`isConnected` 校验的缓存节点），替代每键两次 `querySelector`。
- 收益（结构性）：打字期间 `ChatSurface` 零重渲染；usage/todo 从「每键 O(消息数)」降为「每次快照提交 1 次 WeakMap 查询」；菜单 DOM 重写从「每键」降为「命中集变化时」；装饰 pass 不再由 composer 变动触发。
- 新增回归护栏：
  - `tests/frontend/composer-store-isolation.test.ts`（5 例）：切片互不唤醒 / 同值写入不通知（`Object.is` 稳定）/ **打字后 `.qf-message-editor` 与卡片节点身份不变**（等价于「组件没重渲染」）/ 发送按钮仍随文字变活。
  - `tests/frontend/suggestion-menu-reconcile.test.ts`（3 例）：签名不变时行节点是同一批 / query 变化时重建且高亮正确 / 关闭后重开拿到新节点。
- 测试迁移（随改动增量迁移到新 API，不是改断言糊过去）：`chat-surface-editor`、`chat-surface-usage`、`chat-surface-css-contract`、`send-stop-button`、`composer-model-trigger`、`todo-write-summary`。
- 验证：`npm run test` **415 文件全通过**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.66s）。
- Notes（未做，供下轮）：① **窗口化仍关闭**（`createMessageWindow({ enabled: false })`）——恢复它需要先把 `process-folding` 的展开态键从窗口内 `turnIndex` 改成绝对 messageIndex，并让 release 门控区分「消息变更」与「窗口位移」，还要同步改两条源码锁定断言（`chat-surface-behavior-alignment.test.ts:88-89`、`chat-surface-render.test.ts:224`）。② `scroll-sync` 仍观察 `composerDock`，`fieldSizing:'content'` 自动增高每键触发 resize → rAF 读 `scrollHeight`（强制 reflow），P1/P2 后已不是主导项但仍是单帧成本。③ `process-folding.ts`（1717 行）是窗口化/虚拟滚动的唯一根本障碍。④ **未做真实浏览器 profile**，本轮收益是结构性的，建议下轮用 1000+ 消息会话采 `PerformanceObserver` longtask 作为 P3 基线。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## turn-navigation-anchor（done，2026-10-22）

- Goal：修用户反馈「对话区域左边的导航点，对于非用户输入的消息，无法正确定位」。用户确认现象是「导航点数量偏多，多的是 goal 续跑/后台任务通知这类非用户输入」，并明确选择**先只修定位锚点、不动节点数量**。
- 根因（三处叠加，同一根因的不同表现）：
  1. **节点虚增**：`turn-navigation-data.ts` 的 `isTurnUserMessage` 只看 `role`，而 goal 续跑提示（`metadata.quickforgeGoalRun`，`server/agent-goal-runner.mjs:712`、`server/goal/runner.mjs:361`）与后台命令完成通知（`details.quickforgeBackgroundCommand`，`server/agent-manager.mjs:1589`）都是 `role: 'user'`，于是每轮 goal 运行都多出一个导航节点。本次按用户要求**保留**该行为。
  2. **点击定位落空**：`scrollToTurn` 用「窗口内第 n 个 `.qf-user-message`」的**索引算术**取 DOM，再读 `getBoundingClientRect()`。
  3. **滚动高亮错乱**：`updateActiveFromScroll` 同一套序号算术 + `rect.top <= threshold` 扫描。
- 失效机理：渲染层给这些内部消息加 `quickforge-goal-internal-user-message`，`src/index.css:4245-4248` 整行 `display: none !important`。这类行**没有布局盒、rect 全 0**，而 `querySelectorAll` 不筛可见性：`0 <= threshold` 恒成立 → `visibleIndex` 推进到隐藏行 → 高亮跳到隐藏轮次（若窗口首行是隐藏行则恒为 0）；点击则算出 `scrollTop + 0 - containerTop - 24`，与内容无关，表现为「点了几乎没反应 / 轻微往回跳一格」。
- 修复（新增纯模块 `src/components/chat/turn-navigation-anchor.ts`，单一真相）：
  1. `collectIndexedRows` 只扫 `.qf-message-list` 的**直接子级**里带绝对 `data-message-index` 的行（该属性由 `MessageList` 的 `useLayoutEffect` 写入，与 `turns[].messageIndex` 同一套坐标，与窗口起点无关）；subagent 过程列表的嵌套 `.qf-message-list` 因此不会被误读。
  2. `isLaidOutRow` 用 `getClientRects().length === 0` 判定 `display: none`（不读 rect 值，避免「0 也是合法坐标」的歧义）；无 `getClientRects` 的测试桩按有布局处理。
  3. `resolveTurnAnchor` 三级回退：自身行可见 → 用它；被隐藏 → 其后第一个可见行，没有则之前最后一个可见行；自身行根本不在 DOM（被窗口裁剪 / 下标尚未提交）→ `null`，本轮不高亮也不跳转（宁可不动也不猜）。
- `turn-navigation.ts` 改动：删除 `isUserMessage` / `renderedTurnOrdinals` / `userElements` 那套序号算术；测量缓存改存 `anchors: TurnAnchor[]`（缓存键仍是 `list + messages 引用 + windowStart + turns`）；`updateActiveFromScroll` 与 `scrollToTurn` 都走新模块。顺带修掉旧 `renderedTurnOrdinals` **缺窗口上界**的隐患（pin 到中间窗口时会把窗口之后的轮次也算进来，此前靠前缀顺序侥幸不出错）。
- 验证：`npm run test` **412 文件 4716 passed / 2 skipped**（`turn-navigation.test.ts` 11 例全过，其中 2 例新增：`never marks a display:none user row as the active turn`、`jumps a hidden turn to the next visible row instead of scrolling to 0`；原有 3 例按新口径改造，测试桩补 `data-message-index` / `getClientRects` / `scrollTop` / `scrollTo`）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 成功。
- 文档：`docs/wiki/src/components/README.md` 的轮次导航条目（181/503 两处同文）已更新，写明隐藏行导致序号算术失效的机理与三级回退规则。
- Notes：未动节点数量（用户明确要求），因此「一轮 goal 运行出现多个点、tooltip 显示『继续执行目标（第 k/N 轮）』」仍然存在；后续若要收敛，应在 `turn-navigation-data.ts` 复用 `isGoalInternalUserMessage`（`panel-decoration/goal-internal-message.ts`）过滤，并把该轮次的 assistant 内容归入上一个真实用户轮次。`src/components/workspace/SubagentRunDetailContent.tsx:121-124` 有同构的 `.qf-user-message` 扫描，口径一致但目前未受影响。未新增依赖；未手工改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## composer-native-attachment-hidden（done，2026-10-22）

- Goal：修用户反馈「改造后输入框附件按钮跑到『完全访问』右边了，而『+』添加菜单里本来就有添加附件」。
- 根因：附件入口唯一性原本由装饰层维持。旧 `composer-plus-menu.ts` 的 `setupComposerPlusMenu` 在**每一次 decorate pass** 都调用 `findNativeAttachmentButton(leftControls)` 给原生回形针按钮加 `quickforge-native-attachment-hidden`（`index.css` 里 `display:none !important`），所以界面上只有「+」菜单里的「添加附件」。M4 把该模块整文件删除后，这个隐藏动作一起消失，回形针重新可见，于是与 `AgentAccessTrigger`（「完全访问」）并排出现。
- 修复：所有权交给 React 渲染门禁，而不是补一条 CSS 隐藏规则。
  1. `ChatSurface.tsx`：`showAttachmentButton={enableAttachments && !activePlusMenu}`——「+」菜单存在时不再渲染回形针；没有「+」（只读/侧聊降级、能力缺失）时保留它作为唯一入口。
  2. `MessageEditor.tsx`：把解析中的 spinner 从 `showAttachmentButton` 分支里提出来，改成 `processingFiles ? spinner : showAttachmentButton ? 按钮 : null`。否则「+」菜单接管后，粘贴/拖拽触发的秒级文档解析（PDF/DOCX 最长 30s）会没有任何进度指示。
  3. 隐藏的 `input[type=file]` 始终挂载——「+」菜单的「添加附件」通过 `pickAttachment` 回调拿到的就是它的 `click()`。
- 等价性细节：旧实现是「渲染后再隐藏」，因此回形针在 DOM 里存在（可被 querySelector 命中、可被 Tab 聚焦前的 `display:none` 排除）；新实现是「根本不渲染」。两者可见行为一致，且新实现不再依赖装饰 pass 的时序。
- 验证：`npm run test` **412 文件 4712 passed / 2 skipped**（新增 2 例：`showAttachmentButton` 为真渲染回形针、为假不渲染但保留 file input）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.32s）。
- 回归（真实浏览器，CDP 驱动 headless Chrome，`127.0.0.1:5176`）:
  - 左侧控制行只有 `+`（title「添加」）与 `完全访问`，**回形针查询结果为空数组**；`input[type=file]` 仍为 1 个。
  - 点 `+` 后弹层出现，`inDock=true`、位于编辑卡片之前，菜单项 `["附件","插件"]`——附件入口确实还在「+」里。
  - 真实走隐藏 file input 上传 1x1 PNG：`attachments` 行是卡片的**第一个子节点**（`attachRowInsideCard=true`、`attachRowIsFirstChild=true`），tile 1 个、`img` 实际渲染 56×56、`tileInsideCard=true`、`removeButtonClippedPx=0`（删除按钮未被 `overflow:hidden` 裁掉）、发送按钮由禁用转可用；点删除后 tile 归零、发送按钮回到禁用。
  - 右侧控制行未受影响：`quickforge-context-usage-slot` / 模型 / `quickforge-thinking-inline` / 发送，顺序正常。
- Notes：未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。**这类「装饰层每次 pass 顺手做的可见性抑制」在 M4 里最容易漏**——删除模块时除功能外还要盘一遍它写的 class/属性。
- 回归期间的环境事实（非本轮改动，记录以免误判）: 会话进行中有**其他进程**在改 `src/components/chat/turn-navigation.ts` / 新增 `turn-navigation-anchor.ts` / `tests/frontend/turn-navigation.test.ts`（时间戳 10:19–10:21）。10:21 跑的全量测试因此出现 2 文件 4 例失败（`skips display:none user rows...`、`env.getAnchorScanCount is not a function` 等，属改到一半的瞬时状态）；等其写完后重跑 `turn-navigation` 11 例与全量 412 文件全部通过，与本轮改动无关。

---

## run-command-silent-console-and-log-viewer（done，2026-10-22）

- Goal：用户反馈「运行命令时控制台会显示打开」，要求前台与后台命令都不弹窗口，但可以点击查看运行日志。
- 定位（实机验证，不是推测）：每 250ms 轮询可见顶层窗口，前台 `run_command` 无新增窗口；`run_in_background: true` 抓到 `WindowsTerminal | ping -n 4 127.0.0.1`。用户机器 `HKCU\Console\%%Startup` 的 `DelegationConsole` 为 `{2EACA947-...}`（Windows Terminal）。
- 根因：`server/tools/index.mjs` 的 `detached: runInBackground || process.platform !== 'win32'`。libuv 在 `detached:true` 时加 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`，而 WinBase.h 对 `CREATE_NO_WINDOW` 明确写着「ignored if ... used with either CREATE_NEW_CONSOLE or DETACHED_PROCESS」，所以后台分支的 `windowsHide:true` 完全失效，`cmd.exe` 自行 `AllocConsole()`，默认终端把它渲染成可见窗口。前台因 `detached:false`，`CREATE_NO_WINDOW` 生效，所以**只有后台弹窗**——这与用户「普通前台命令也会弹」的初始描述相反，先纠正了这个前提才动手。
- 修复（窗口）：`detached: process.platform !== 'win32'`。后台语义「调用已返回、进程继续跑」本来就由 spawn 后立即 `resolve()` + `unref()` 承担，不依赖 detached；Windows 杀进程一直走 `taskkill /T /F`，也不需要进程组。`details.detached` 改为如实反映实际参数。顺带修 `server/utils/platform.mjs` 的 `openBrowser()`：`cmd /c start` + `detached:true` 且**没设** `windowsHide`，每次启动应用都会闪一个 cmd 窗口，同样改为 Windows 不开 detached 并补 `windowsHide: true`。
- 修复（日志查看）：新增 `server/utils/command-log.mjs` —— `isCommandLogPath` 从 `tools/index.mjs` 抽出成共享判定（`read_file` 工具同步改用），并加 `readCommandLog` 读取尾部窗口（默认 2000 行、上限 20000 行，返回与 `/api/workspace/file` 同构的只读响应 + `totalLines`/`truncated`）。新增 `GET /api/agents/:sessionId/command-log`，只放行 `<dataDir>/logs/commands/*.log`，其余 400。
- 修复（前端）：Reader 新增 `source: 'command-log'` 虚拟文件通道（`ReaderTab.source/sessionId/label`、`workspace-types` 的 `kind: 'command-log'` 变体、`workspace-api.getCommandLog`）；`WorkspaceInspector` 用 `openCommandLogTab` + `loadCommandLogIntoReaderTab` 分流（跳过工作区缓存与 meta 校准），tab 标题为「命令日志 · <命令摘要>」，不参与持久化（刷新后重载必然 403/ENOENT，恢复只会得到红色错误页），并隐藏工作区专用的「在资源管理器中显示 / 用编辑器打开」入口（日志在工作区外会 403）。入口两处：工具卡 console 块标题栏的纯 SVG 按钮（`data-qf-action="view-command-log"`）与后台命令浮层的「查看完整日志」，都派发 `quickforge:view-command-log`，由 `App.tsx` 转成 `requestWorkspaceInspector({ kind: 'command-log' })`。
- 安全边界：日志路径只接受 `details.outputFile` 的绝对路径；判定只保留 `isCommandLogPath` 一份，禁止各路由另写 `startsWith`；不放宽 `/api/workspace/*`（工作区外仍 403）；不复用 `open-text-attachment`（限定 `.txt` + conversations 目录）。
- 验证：实机后台命令全程轮询新增可见窗口 `[]`（改前为 WindowsTerminal 窗口），`details.running=true` 调用仍立即返回；`npx tsc -b --noEmit` 通过；`npx eslint` 改动文件 0 error；新增/更新 5 个测试文件（command-log 工具模块、路由、console 块按钮、tab 持久化、后台 detached 断言）。
- 文档：`docs/wiki/server/tools/README.md`（后台静默的 Windows 原因 + 日志入口链路）、`docs/wiki/server/routes/README.md`（新端点）。
- Notes：未新增/升级依赖；未触碰 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。**`detached` 与 `windowsHide` 在 Windows 上互斥**是本轮最容易再次踩到的点——任何新加的后台/脱离型 spawn 都不要同时指望这两个参数生效。另外用户机器上残留过一个 `WindowsTerminal.exe`（`node -e "setInterval(() => {}, 1000)"`），来自 `run-command-background.test.mjs` 的后台用例，属既有的测试清理缺口，未在本轮处理。

---


## session-open-fast-path-m4（done，2026-10-21）

- Goal：把 `panel-decoration` 里**可 React 化**的命令式 DOM 注入器逐个迁移为 React 渲染（M4），保留类名/DOM 层级契约、删宿主 decorate 调用、把源码文本锁改为渲染断言。
- 落地 **13 个模块**（含前一轮的 send-stop-button / persist-degraded-notice，以及 M4-4 追加的等待气泡 / 计划模式触发器 / Agent 权限选择器）。
- M4-4 追加的三个：
  - `assistant-waiting-bubble.ts`（113 行，删除）→ `resolveAssistantWaitingRow` 用消息数组算**行索引** + `AssistantWaitingBubble` 作为 keyed 兄弟；判定改为读消息体（text / 非空 thinking / toolCall），不再用 DOM 探针 + 克隆节点。
  - `plan-mode-controls.ts` 的 `syncPlanModeButton`（删除）→ `PlanModeTrigger`；仅 planMode 为 true 时渲染（保持旧行为）。Shift+Tab 快捷键仍留在装饰层（绑 textarea）。
  - `agent-access-menu.ts` 的触发器与菜单渲染（删除）→ `AgentAccessTrigger` + `AgentAccessMenu`；定位测量仍命令式，位置计算抽成纯函数 `positionAgentAccessMenu`。
- **自我评审发现并修掉 2 个高危缺陷**（都是"测试全绿但功能已坏"）：
  1. **压缩横线与等待气泡的插入索引错位**：两者都按消息行计数，但用两次 `splice` 插入——插横线会把之后每个位置推后一位，于是横线在上方时**气泡被挤到该行之前**。任何发生过上下文压缩的会话下一轮等待必中。改成单次正序构建子节点数组，并新增两条测试锁定顺序。
  2. **装饰层删除 React 拥有的菜单节点**：`removeAgentAccessMenu` 仍 `menu.remove()`，之后 React 卸载抛 `NotFoundError: The node to be removed is not a child of this node`，被 error boundary 接管后**整块聊天区不可用**。触发链：打开权限菜单 → 点「+」或子代理指示器 → `dismissComposerMenus()`。改成**只请求关闭**（`registerAgentAccessMenuCloser`），探针已确认「外部移除后再卸载必抛」。
- 另修 4 处行为偏差：等待气泡漏了 `isStreaming` 前置条件；空 thinking 被算作"已输出"导致气泡提前一帧消失；侧聊权限控件从"可见但禁用"变成消失；权限菜单在门禁变化后会自动重开。
- 顺带清死代码：`decorateEditor` 的 5 个未用参数、`agent-access-menu.ts` 的菜单渲染与 `createAgentAccessItem`、`.quickforge-composer-left-controls` 这条无写入方的 CSS 规则。
- 验证：`npm run test` **410 文件 4693 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.58s）。
- 文档：`docs/architecture/session-open-fast-path.zh-CN.md`（M4-4 追加表、评审复盘、剩余"必须命令式"清单补上 scroll-to-bottom / subagent indicator）；`docs/wiki/src/components/README.md`（decorateEditor 段改为「控制行全部 React 渲染」+ 关闭握手说明）。
- Notes：明确不做且已写入拒因的有 5 类：`process-folding`（节点所有权移交）、`message-actions`/`assistant-artifact-card`/`message-queue`（需要"消息根最后一个子元素"位置语义 + 100+ 条文本锁）、`scroll-to-bottom-button`（测量驱动的可见性，无快照数据）、`subagent-running-indicator`（body 浮层 + 就地 diff 防 hover 闪断）、审批卡/ask 卡/回滚弹层（定位原语与浮层）。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

- 落地 **10 个模块**（含前一轮的 send-stop-button / persist-degraded-notice）：
  - `model-controls.ts`（24 行，删除）→ `MessageEditor` 直接给模型按钮加类。**`aria-expanded` 故意不由 React 声明**——菜单自己写，否则每次流式重渲染都会把展开态抹掉。
  - `context-compaction.ts`（190 行，删除）→ `resolveCompactionBoundary` 纯函数算行索引 + `MessageList` 按索引插 keyed 兄弟；`<details>` 展开态是组件 state。
  - `todo-write-summary.ts` 控制器（约 230 行）→ 只留 96 行纯函数，渲染改 `surface/TodoWriteSummary.tsx`。
  - `reconnect-notice.ts` + `model-retry-notice.ts` + `unreachable-strip.ts`（约 640 行，全删）→ `surface/ConnectionNotices.tsx`；宿主只持 `modelRetryInfo` state，surface 用 `useSseConnectionStatus` 订阅，倒计时共用一个 tick。
  - `goal-control-strip.ts` 控制器（约 520 行，删除）→ `surface/GoalControlStrip.tsx`；`desired[]` 子节点 diff 换成 JSX 顺序，编辑态/取消确认是 state。`lib/goal-ui.ts` 未改。
  - `local-file-path-links.ts` 的 DOM 部分 → 纯检测函数 + rehype 插件 `rehype-local-file-paths.ts` + `LocalFilePathLink`；链接进首帧，无需 post-render 改写。
  - `composer-plus-menu.ts`（234 行，删除）→ `surface/ComposerPlusMenu.tsx`，trigger/popover 两半共用一个 controller，各自放回原插入点。
  - `thinking-level-controls.ts`（242 行，删除）→ `surface/ThinkingLevelControl.tsx`；仅定位测量仍是命令式。
- **自我评审发现并修掉 3 个真实缺陷**（这是本轮最重要的部分，都是"测试全绿但功能已坏"的类型）：
  1. **rehype 插件递归进自己的产物** → `qf-file-path` 的子文本仍是同一路径，插件再次拆分，无限嵌套直到 `RangeError: Maximum call stack size exceeded`。后果是**Markdown 里出现任何本地路径就白屏**。修法：产物标签加入跳过集合 + 只递归原始子节点；新增 `local-file-path-markdown.test.ts` 用「无嵌套 + 确实生成链接」双向锁定。
  2. **`+` 菜单弹层放错位置** → 被渲染成触发器所在控制行的兄弟，而不是编辑卡片之前的独立块，`.quickforge-plus-popover` 的间距/宽度全部错位。修法：拆 trigger / popover 两个组件共用一个 controller。
  3. **侧聊控件不再禁用** → 装饰层删除后，"+"、思考档位、模型三个触发器在侧聊里仍可点（原本由 `disableComposerControls` 置灰）。修法：加 `composerControlsDisabled`，三个控件渲染 `disabled` 且忽略 pointerdown/keydown。
- 验证：`npm run test` 236 文件 **2793 passed**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.22s）。
- 文档：`docs/architecture/session-open-fast-path.zh-CN.md` §4 M4 整体重写（10 模块映射表、3 个等价性细节、3 个缺陷复盘、剩余"必须命令式"清单）；`docs/wiki/src/components/README.md` 同步 facade 行数与三个迁移条目。
- Notes：**未做**的三件套 `assistant-artifact-card` / `message-actions` / `message-queue` 与 `process-folding.ts` 不是"还没做"，而是**不该按渲染迁移做**：它们需要「消息根最后一个子元素」的位置语义与节点搬运所有权，收益低于风险，架构文档已写明拒因。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---


## workflow-detail-no-trace-trim（done，2026-10-21）

- Goal：用户反馈 workflow subagent 运行详情出现「本次运行的过程记录超出详情预算，已保留最近步骤」，要求服务端**不要再有任何裁剪逻辑**（与主 Agent 一致）。
- 根因：`run_workflow` 的 details 每 200ms 整份重发，历史上为避免传输膨胀加了三层预算：单 Agent `subagentRun` 80K/50 条（终态 200K/200 条）、details 总量 240K（终态 500K）、日志 50K。三者口径本身不成立——运行中总量 240K ÷ 单 Agent 80K = **3 个 Agent 必然触发**，而默认并发 4、maxAgents 24，多工具 Agent 的 50 条消息几乎必然顶到 80K，所以运行中帧几乎每次都在裁。裁剪结果通过 `subagentRunTruncated` / `subagentRunDropped` → 前端 `traceDropped` → `traceNotice` 块翻译成那句提示；`traceTruncated` 只要为真就提示，哪怕前端已用 `previousTrace` 回填出更完整的旧 trace，所以还会出现「内容都在却说不完整」的矛盾观感。
- 决策：**全删裁剪 + 把流式帧瘦身改成结构性控制**。直接删预算会让 24 个 Agent × 上百条消息在每 200ms 的帧里全量重发（数 MB/帧、CPU 在对整份对象 `JSON.stringify` 上打尖）。改为：运行中帧只携带 running/queued 的 Agent trace（上限是 `concurrency`，默认 4），其余打 `subagentRunDeferred: true`；终态帧一次性带全部 Agent 的全量 trace。
- 服务端（`server/agent-workflow-runner.mjs`）：删除 `MAX_DETAILS_TEXT` / `MAX_DETAILS_TEXT_STREAMING` / `MAX_LOG_TEXT` / `MAX_SUBAGENT_RUN_JSON` / `MAX_SUBAGENT_RUN_JSON_TERMINAL` / `MAX_SUBAGENT_TRACE_MESSAGES` / `MAX_SUBAGENT_TRACE_MESSAGES_TERMINAL` 与 `compactJsonValue` / `compactSubagentMessage` / `sliceMessagesWithToolPairs` / `dropOrphanToolResults` / `compactSubagentRunDetails` / `detailsTextSize` / `trimSubagentTraces` / `trimDetails` 共 8 个函数（约 130 行）；新增 `subagentRunDetails()` 只挑字段（messages/tools 原样透传，不再按字符或条数截断）。`buildDetails` 去掉 `trimDetails` 包裹，按 `streaming && 非 running/queued` 决定是否省略 trace。`MAX_LOG_ENTRIES = 200` 保留（条数上限，非体积裁剪）。
- 前端：删除 `SubagentRunPayload.traceDropped`、`subagentRunBodyBlocks()` 的 `traceNotice` 块、`SubagentRunDetailContent` 的提示节点、i18n `subagentTraceTruncated`（中英）、`WorkflowAgentView.subagentRunDropped/subagentRunTruncated`、`subagentRunFingerprint` 里的 `traceDropped`。新增 `WorkflowAgentView.subagentRunDeferred`；`buildWorkflowSubagentRunPayload` 在 `deferred && ownMessages.length === 0` 时沿用 `previous.traceMessages`——不标任何「丢失」标记，因为这是正常分帧。
- 测试：`agent-workflow-runner.test.mjs` 把「预算裁剪/保留最新 trace/日志 50K 上限」4 个用例改为「全量不裁剪」契约（300 条消息完整、toolCall/toolResult 配对完整、3 个 Agent 各 120 条全保留、150 条日志全保留、长日志不截断），新增「运行中帧只 deferred 已结束 Agent」用例；`workflow-agent-run-events.test.ts` 的 `traceDropped` 断言改为 `subagentRunDeferred` 回填语义（含「迟到帧不得把 20 条缩回 1 条」）。
- 验证：定向 `npx vitest run tests/server/agent-workflow-runner.test.mjs tests/frontend/workflow-agent-run-events.test.ts` 39 passed；`npm run test` 405 文件 4644 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` exit 0（3.58s）。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md`（第 49 行概览、第 4 节预算表两行改为「不裁剪」、details 字段表删除 `detailsTruncated`、Agent record 表两行改 `subagentRun`/`subagentRunDeferred`、7.3 实时通道段、测试清单）；`docs/wiki/src/lib/README.md`（三个条目 + body blocks + fingerprint）；`docs/wiki/server/README.md`（两段）；`docs/wiki/server/tools/README.md`（Workflow 约束段）。
- Notes：未新增/升级依赖；未手工修改生成产物；未创建 Git commit。**历史会话里已持久化的 workflow details 仍带旧裁剪痕迹**（不会回溯修复），且旧载荷里的 `subagentRunDropped`/`subagentRunTruncated` 现在会被前端忽略——即旧会话详情不会再显示那句提示，但也无法恢复已裁掉的内容，需要重跑该 workflow 才能看到完整过程。另一个未处理点：主 Agent 的 trace 走增量通道（`messageAfter` 游标），workflow 仍是整份 details 重发，若将来 Agent 单步消息量再上量级，可考虑给 `subagentRun.messages` 也做增量或按 Agent 分片推送。

---


## session-view-ready-republish（done，2026-10-21）

- Goal：修「切换到一个正在生成的会话，再切回来，永久卡在『正在加载对话』，只能刷新页面」。
- 根因（两个条件必须同时成立，所以前三轮验收都没覆盖到）：
  1. **目标会话仍常驻 `taskMap`** —— 只在会话**正在生成**时发生。空闲会话切走时被 `selectAgentTaskEvictions` 直接 dispose（`MAX_IDLE_AGENT_TASKS = 0`），切回走 `/view` + `restore`，拿到的是**新 agent 对象**，`ChatPanelHost` 主 effect 会重跑；运行中的会话留在 `taskMap`，`performLoadSession` 命中 `runningTask` 分支走 `attachTaskToView(runningTask)`，复用**同一个 agent 对象**。
  2. **视图被保活** —— M3 之后 `SessionViewPool` 让切回只翻 `display`，不 remount。
- 叠加结果：`[agent, agentRuntimeScopeId]` 依赖全不变 → 主 effect 不重跑 → `onInitialRenderReady` 一次都不发；而遮罩下马条件只有 `renderedLoadingSessionId === visibleLoadingSessionId`，后者只能由这个回调设置 → 既不会被 ready 撤掉、也不会被 280ms 淡出撤掉（淡出本身以 ready 为前提）。`agent_end` 不碰 loading 状态，所以**这一轮生成结束也不会自愈**，是真正的假死。
- 修复（两层，刻意保持「一个发布者」）：
  1. 源头：`ChatPanelHost` 把就绪发布收敛成 `publishViewReady()`，由面板初始化的 `notifyInitialRenderReady`（同时置位 `pendingHistoryHydration`）和活跃性回调的「回到前台」分支共同调用。发布幂等——`handleSessionInitialRenderReady` 只在 `visibleLoadingSessionIdRef` 等于该会话时生效，晚到/竞争的发布不会撤掉别人的遮罩。**全量历史补齐不会重复触发**：开关只由初始化路径置位，`publishViewReady` 消费一次后置 `historyHydrated`。
  2. 兜底：`useAppLoadingEffects` 增加 10s 过渡看门狗，把 `rendered` 置为当前 `visible`（复用既有 280ms 淡出）并 `logger.warn` 记录会话 id。这是安全网不是第二条路径：实测打开都在 300ms 量级（1279 条会话首帧 275ms），10s 只命中真正的信号丢失；而「单信号协议」永远离一次回归只差一步，其失败模式是**永久**卡死界面，比提前揭示未就绪内容更糟。看门狗在 `rendered === visible` 时直接不 arm，所以不会与正常 ready 抢时序。
- 为什么一开始没发现：前三轮验收全部在「空闲会话」上做（切走即 dispose、切回必换 agent），恰好绕开了必要条件 1。教训与前几轮一致——契约表要按「哪些前提变了」枚举，而不是按「我改了什么」枚举；M3 当时列的三条必须显式迁移的行为（草稿落盘、复位滚动、重扫装饰）漏了第四条「就绪信号」，因为它原本由 effect 承担而非卸载 cleanup。
- 验证：定向 vitest — `app-domain-hooks` 16 passed（新增 2 例：看门狗到时经正常淡出下马并 warn、ready 到达与旧会话不误触发）、`chat-surface-behavior-alignment` 18 passed（新增 2 例：单一发布者 + 重新激活分支必须调用 `publishViewReady`、补齐开关只由初始化置位）、`session-view-activity` 10、`session-view-pool-dom` 9、`message-queue` 20、`chat-compact-controls` 11 全通过；`npx tsc -b` 通过；eslint（4 个改动文件）0 error。**旧实现红灯验证**：新契约断言跑在 `HEAD` 版本源码上 4 项全部不成立（`publishViewReady` / 重新激活调用 / `pendingHistoryHydration` 均缺失）。
- Notes：未改遮罩 280ms 过渡、滚动四组阈值、折叠分组规则、DOM 类名契约、只读/分享/侧聊能力矩阵。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。**未做浏览器实机复现**（需要构造「生成中途切走再切回」的时序），已用源码契约 + 旧实现红灯对照锁定根因与修复位置；建议下次发布前在真实 UI 上补一次手工回归。

---

## session-open-fast-path-m4（部分实施，2026-10-21）

- Goal：把 `panel-decoration` 的命令式 DOM 注入器改为 React 渲染（M4）。
- **先划清边界**：按「输入能否完全从 snapshot/props 得到」分类 36 个模块 —— 可 React 化 12（其中 5 个本就是纯函数）、必须保留命令式 10、混合 14。真正的阻塞不是代码量而是契约：全仓 **232 条**「读源码文本 + toContain」断言（`assistant-artifact-card` 独占 114 条）锁的是**命令式实现**（`insertBefore`/`className =`），React 写不出这些字符串，改造等于重写测试；且装饰层测试多用 `vi.stubGlobal('document', fake)` 的假 DOM，**无法承载 `createRoot().render()`**，任何 React 化必须整文件切 jsdom。`process-folding.ts`（1717 行）与 `ChatSurface` 的所有权租约强耦合，属「节点搬运」而非渲染，不在 M4 范围。
- 落地 ①**发送/停止按钮**（`send-stop-button.ts` 50 行整文件删除）：`MessageEditor` 用 `isWaiting` 渲染等待环、`onPointerDownCapture` 中止（`stopImmediatePropagation`）、`onBeforeAbort` 先收建议弹层；宿主 `assistantWaitingActive` 提升为 `replyWaiting` state。
- 落地 ②**持久化降级提示**（`persist-degraded-notice.ts` 37 行整文件删除）：`MessageList` 按 `persistDegraded` 渲染为 `.qf-message-list` 首子。前提是把 `persist_degraded` 加入 `ChatSurface` 的 `SUBSCRIBED_EVENTS`——缺它则 `state.persistDegraded` 变化不触发快照刷新，提示永不出现。
- **主动回退 ③ goal 迭代分隔线**：一度按 React 实现（在 `AssistantMessage` 末尾渲染），随后回退。原因是两个无法用 React 忠实表达的事实：宿主在**渲染后**才确定（通常 assistant，本轮无 assistant 时回退到该轮 user 行 —— 两个不同组件负责同一节点）；且分隔线必须是根的**最后一个子元素**，而 `message-actions` 其后仍会往同一根 append（这正是它原本需要幂等重定位的原因）。改为把决策逻辑抽成纯函数 `readGoalIterationMarker` + `buildGoalIterationDivider`，`syncGoalIterationDivider` 只留 DOM 写入 —— 67 条既有断言全过，证明这次重构行为等价。**回退不是失败，是把「能等价的部分」和「不能等价的部分」分开**。
- 两个必须记住的等价性细节：① 停止按钮的 `title`/`aria-label` 必须是**字面量 `"Stop"`**——装饰层一直写的是字面量，改用 `t('stop')` 会改变非英文环境的可见 tooltip；② 等待环的清除时刻**不等于** `isStreaming && !streamingMessage`：宿主在 assistant 的 `message_start` 就清除，而 `streamingMessage` 要到第一个 `message_update` 才有值，从 snapshot 推导会让等待环多显示一段（像素相同、时刻不同）。
- 验证：`npm run test` 405 文件 4639 用例通过；`lint` 0 error（1 个既有 warning）；`tsc -b` 通过；`build` 成功（3.53s）。专项 send-stop-button 8 例（jsdom 渲染断言）、persist-degraded-notice 4 例（新增）、goal-iteration-divider 67 例。
- Notes：M4 的正确形态是**逐模块绞杀**：保留类名与 DOM 层级、把文本锁改为渲染断言、并删除宿主里对应的 decorate 调用（否则 `MutationObserver` 会让 pass 空转）。剩余按代价排序：零文本锁的 5 个 → 1–3 条文本锁的 6 个 → `assistant-artifact-card`(114) / `message-actions`(44) / `message-queue`(27) 三件套放最后。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m3（done，2026-10-21）

- Goal：消除切换会话时的**整树 remount**（准则 4 的最后一块），且用户可见交互零变化。
- 方案决策（关键）：调研确认 `ServerAgent.dispose()` 不清 `state`（`server-agent.ts:1236` 明确注释 dispose 后仍可安全读取），因此「保留渲染结果」与「保留 agent 运行时」可以分开。**只保活渲染子树，不调大 `MAX_IDLE_AGENT_TASKS`**——避免常驻 MB 级 messages，也避免跨项目 `workspaceRoot` 污染（`server/project-config.mjs` 是进程级单值，这是调研中风险最高的一项，本方案直接绕开）。
- 实现：新增 `src/components/chat/SessionViewPool.tsx`（类组件，非活跃视图 `display:none`、活跃视图 `display:contents`）、`src/lib/session-view-pool.ts`（纯策略：默认 1 个非活跃槽 + 1500 行预算，活跃视图先计入预算且永不淘汰）、`src/lib/session-view-activity.ts`（活跃广播）。`App.tsx` 把 `ChatPanelHost` 包进池，池 key 与 `ChatSurface` 的 key 完全一致（`runtimeScopeId`），「同 key 不重挂载」语义不变。
- 为什么用类组件：冻结「离开时那个元素」必须发生在**本次 render 仍在输出它**的时候，否则 React 在这一提交里已经卸载了它。这个读写发生在 render 期间，用 ref 会违反 Rules of React、用 setState 在 effect 里会被 `react-hooks/set-state-in-effect` 拒绝且实测会丢槽位（切到 B 后 B 整个消失）。实例字段是唯一既能持久又不参与 render 输入的存放处。
- 三条必须显式迁移的「卸载副作用」（冻结 props 让保活视图收不到更新，无法从 props 得知自己已离开屏幕）：① 草稿末次落盘（原在卸载 cleanup；不补则切走前 400ms 防抖窗口内的输入**直接丢失**）；② 回前台复位滚动并贴底；③ 装饰层重扫。②③ 是实测发现的：隐藏期 `display:none` 下测量值全为 0 且 `[agent]` effect 不重跑，不回前台补装饰，切回后就停在失真状态。
- 可见性门控：`runDecorate` 开头跳过隐藏视图，`ChatSurface` 贴底写 `scrollTop` 前也跳过（隐藏态 `scrollHeight` 为 0，写下去会把容器停到顶部）。判据用**DOM 可见性**（`isInsideHiddenView`）而非活跃性信号——信号在 `useLayoutEffect` 发布，本视图刚变可见的那次提交上信号可能仍指向旧视图，会把唯一一次权威装饰跳过。
- 顺带修掉的多面板缺陷（保活让「同时两个面板」成为常态，暴露了原本被「只有一个面板」掩盖的问题）：`thinking-level-controls.ts` 无参清理会删掉任意面板的 thinking 按钮、`model-controls.ts` 的 `aria-expanded` 取全局、`useModelActions.ts` 读**第一个**面板的草稿与附件。现全部按 `closest('.qf-chat-panel')` 归属。新增 `tests/frontend/composer-popover-panel-scope.test.ts` 锁定。
- 实测（83 行会话 ↔ 16 行会话，SPA 内切换，独立端口实例，`PerformanceObserver` longtask 收集器）：离开大会话 **1 个 longtask / 55ms**；切回大会话（保活命中）**4 个 / 累计 249ms / 最大 83ms**。对照改动前同链路基线（618 行 ↔ 171 行）小→大 **2360ms / 最大 854ms**——会话规模不同不能直接相减，但可确认**量级**：原先 500–850ms 的「整树卸载 + 重建」单项尖峰已不存在，剩余成本是数据重取（`/view`）与一次装饰 pass。
- 交互契约实测（同一 SPA 会话内切走再切回）：**节点身份复用**——切回后同一 `[data-quickforge-view]` wrapper 与同一 `.qf-user-message` 节点（`===` 成立），`.qf-scroll-container` 探针属性存活；装饰产物与切走前**完全一致**（4 个过程组、83 行）；切回**复位贴底**（`distance = 0`），含「先脱离 899px → 切走 → 切回」后仍贴底；两个视图并存（1 活跃 `contents` + 1 保活 `none`）。真实滚轮验证滚动滞回（距底 399 / 1499px 稳定脱离、不自动回底）；回底按钮 `display:flex` 可见且点击后 `distance = 0`；草稿隔离与恢复 `isolated=true, restored=true`；composer 四钩子齐全且 textarea 可编辑。
- 三次误判的排除（教训同上一轮：自动化给出的「异常」先用规则本身对照）：① 一个 4 轮会话的轮次导航节点为 0，一度判定为回归，实际是轮次导航有显示阈值 `TURN_NAVIGATION_MIN_TURNS = 5`，**空轨道才是正确行为**；② 用 `page.goto` 换 URL 会整页重载、绕过 SPA，测不到保活，改用侧栏点击在 SPA 内切换才有效；③ **直接赋值 `scrollTop` 会被自动跟随逻辑立刻回弹**，在补充验证里表现为「滚上去又回到贴底」，一度疑似回归——改用真实 `wheel`/`scrollBy` 后滞回完全正常。这是既有设计（程序化滚动不算阅读意图），不是本轮引入。
- 验证：`npm run test` 全量 404 文件 4633 用例通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.04s）。临时实例 32210 已清理，主实例 5176 全程 health 200。
- Notes：M4（装饰层 20+ 命令式注入器改 React 兄弟节点）仍未做，其价值是可维护性而非性能（装饰 pass 12–17ms 不是瓶颈）。若将来要调大 `MAX_IDLE_AGENT_TASKS`，必须先给 server agent 绑定 projectId 而不是读全局 active project。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m2（done，2026-10-21）

- Goal：为「打开历史会话」提供不重建 Agent 运行时的读取通道，把 `/restore` 与运行时 attach 移出首屏关键路径，且不改变任何用户可见交互。
- 根因：`GET /state`、`GET /messages`、`POST /restore` 三条读路径在会话不在内存时都 fallback 到 `restoreAgent`，而它走 `createAgent` 全套（`buildSystemPrompt` / `createServerTools` / `readProjectConfig` / 模型解析 / MCP）。**只为显示一段历史，却要重建整个 Agent 运行时。**
- 服务端：新增 `server/routes/session-view.mjs`（`GET /api/sessions/:sessionId/view`），在 `server/index.mjs` 的 `handleApi` 注册 `/api/sessions/` 前缀。内存命中直接委派 `getSessionState`（活跃会话的待审批/流式/上下文用量只存在于进程内存，原样返回即完全等价）；未命中直接 `readSessionStateValue` 读 SQLite，**绝不调用 `restoreAgent`**。响应形状与 `getSessionState` 对齐，可空字段统一用 `null`——否则 `JSON.stringify` 会丢掉 `undefined` 字段，形状随会话状态漂移（这是实现中实际踩到并修正的问题）。
- 前端：`ServerAgent.loadView` 打入该端点；`useAgentManager.performLoadSession` 改为「`loadView` 优先，任何失败回退 `restore`」，并在 `attachTaskToView` 之后用 `isLatestRequest` 守卫发起后台 `syncState` 校准（冷会话此时才 restore，但用户已看到内容）。
- 工具渲染（关键耦合点）：只读视图不返回 `tools`（存储层没有工具定义）。调研确认工具卡图标/label/摘要来自静态渲染器注册表，`state.tools` 只在 `AssistantMessage` 做一次 `find(name)` 且 `ToolMessage` 有 `toolCall.name` 兜底——**唯一例外是 MCP 卡**（应用期动态注册，且注册点只在面板初始化 effect 跑一次、依赖数组不含 `tools`，晚到不会自愈）。修复：`ToolMessage` 注册表未命中时对 `mcp__server__tool` 形态直接构造 `McpToolRenderer`，server 与原工具名从名字解析，不读 `tool.label`。
- 一次自我纠正：最初让 `ToolMessage` 经 `local-tools` 导入，但该模块在 import 时注册全部内置渲染器，改变了「哪些卡能解析」的既有语义，`chat-surface-message-list` 的顺序断言立刻变红。改为直接 import `tool-renderers/mcp-tool-renderer`，零导入副作用。
- 测试：新增 `tests/server/routes/session-view.test.mjs`（5 例，每例显式断言 `restoreAgent` 未被调用）；`server-agent.test.ts` 新增 `loadView` 2 例（不出现 `POST /restore`、失败可回退）；`chat-surface-tool-message.test.ts` 新增 MCP 无 `state.tools` 不降级 + 非 MCP 未知工具仍走通用卡。
- 验证：定向 vitest 全绿（session-view 5、server-agent 140、chat-surface-tool-message 10、chat-surface-message-list 19、chat-surface-behavior-alignment 10 等）；`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（2 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功。
- Notes：M3（会话视图实例池 keep-alive，需先把滚动状态归约为 `ScrollAnchor` 才能开窗口化，否则改变「滚动到顶部」行为）、M4（装饰层 20+ 命令式注入器改 React 兄弟节点）未实施，设计与风险在架构文档里。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-round3（done，2026-10-21）

- Goal：把「切换会话时全量重算」的最后一块——Markdown 解析——也纳入内容寻址缓存。
- **推翻上一轮结论**：上一轮我判断「缓存 `react-markdown` 元素树无效，因为 remount 时 React 会重新执行 `ReactMarkdown`」。这个判断假设了它必须是 JSX 组件。本轮查证 `node_modules/react-markdown/index.js`：默认导出 `Markdown(options)` 是**普通函数**（`post(processor.runSync(processor.parse(file)), options)`），不是带 hook 的组件。因此可以在渲染期直接调用它拿到元素树并缓存，remount 时真正跳过 parse + 插件流水线。
- 改动：`Markdown.tsx` 新增 `markdownElementCache`（`ContentCache<ReactNode>`，上限 300），`renderMarkdownTree` 改为 `ReactMarkdown({ children, ... })` 普通调用，`MarkdownBlock` 用 `memoizeContent` 取缓存；新增 `clearMarkdownElementCache` 供测试隔离。缓存键只需 `content`：`remarkPlugins`/`components` 是模块级常量，`rehypePlugins` 只携带由同一 content 决定的 math token 映射（token 本身也已按内容缓存）。
- 正确性论证：React 元素是不可变描述，复用不会让渲染结果取决于挂载历史；`CodeBlock` 等外层组件读取的 context 变化仍由 React 正常传播，跳过的只是字符串解析与插件执行。
- 测试：`chat-math.test.ts` 新增 3 例——同一 content 两次渲染输出完全一致（缓存命中路径）、不同 content 互不串染、数学公式在缓存树上仍正确。
- 验证：`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.79s）。定向：chat-math 13、chat-surface-css-contract + chat-surface-message-list + chat-surface-render 83。
- 文档纠正：`docs/architecture/session-open-fast-path.zh-CN.md` 里那句「明确未做：缓存元素树是无效的」已改写为「更正」，说明上一版判断错在哪、为什么现在成立。
- Notes：至此四类渲染产物（Markdown 解析 / 代码高亮 / Mermaid / KaTeX）全部跨 mount 复用，准则 2 的「消除切换会话时的全量重算」已完整兑现。准则 4 的「消除整树 remount」仍未做——`ChatSurface` 的 `key` 不能直接删（同时承担丢弃上一会话草稿恢复/编辑器状态的职责），需要先设计显式的会话级状态迁移。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-acceptance（done，2026-10-21）

- Goal：对照交互契约清单做一次系统性可见交互验收，确认准则 5（不改用户可见交互）成立。
- 浏览器实测（独立端口实例，361 条消息会话）结果全部符合契约：
  - **滚动滞回**：初始贴底（距底 0）；小滚 40px 仍跟随；大幅上滚后脱离（距底 1141px）。
  - **回底按钮**：脱离后出现且可见。
  - **轮次导航**：存在、6 个节点、未被 CSS 隐藏。
  - **折叠**：6 个过程组、5 条终答标记为「不折叠」——终答常显契约成立。
  - **composer 契约**：`.qf-message-editor` / `.quickforge-composer` / `-shell` / `-dock` 四个钩子齐全；发送、`+`、权限、模型触发都在；textarea 可编辑。
  - **草稿隔离与恢复**：在 A 输入 → 切到 B（草稿为空，未串染）→ 切回 A（草稿恢复）。
- **一次误报的排查过程（值得记录）**：侧栏点击会话行在我用「合成 click」和「强制点击」时都不切换，一度被判定为产品回归。用 `git stash` 在**基线代码上复现同样现象**后排除——真实原因是会话行位于 **dnd-kit 可拖拽排序容器**内，其指针事件被 DnD 拦截，自动化点击打不到行按钮。改用 deep-link 路由切换后，草稿隔离/恢复验证全部通过。教训：自动化交互失败时，先用基线对照排除「不是自己引入的」，再判断是否产品问题。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.41s）。主实例 5176 全程运行（health 200 复核），临时实例 32190/32191/32192 均已清理。
- Notes：生产代码零改动（本轮是验收）。中途 `git stash` 已 `pop`，改动完整保留（31 个已跟踪文件 + 13 个新增文件）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-hydrate-batching-probe（done，2026-10-21）

- Goal：验证「把补齐历史切成小批、逐帧渲染」能否削平首屏后的长任务。
- **两个新发现（都是正面或决定性的）**：
  1. **首屏本身已经很快**：小→大切换实测 `click 1ms → load-start 35ms → first-paint/ready 303ms`。之前的 2360ms 累计阻塞**发生在 ready 之后**，是补齐历史造成的，不在首屏关键路径上。
  2. **切断补齐则零长任务**：把 `hydrateFullHistory` 的全量请求 abort 掉后，实测 `longTasks: []`、`totalBlockMs: 0`。证明剩余阻塞的唯一来源就是那一次全量替换。
- 尝试并**被实测否决**：把全量替换改成「按 60 条逐帧向前扩展」。
  - 预期：长任务被切碎。
  - 实测：**更差** —— 累计阻塞从 ~1.1s 涨到 **5006ms**、长任务从 2 个变成 **35 个**、最大单项从 609ms 降到 324ms 但总量翻 4 倍。
  - 原因：每次提交都要重建整张列表（React 协调 + 装饰重算），增量收益被重复成本吃掉。已完整回退，并把「不要分批」的实测数据写进代码注释。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.27s）。主实例 5176 全程运行（health 200 复核），临时实例 32188 已清理。
- Notes：**生产代码零净改动**（分批尝试已完整回退，仅保留说明性注释）。这条结论很重要：剩余阻塞不能用「切小批」解决，只能减少总渲染量（窗口化）或不重建（DOM 保活），两者都属 M3。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-remount-memo-probe（done，2026-10-21）

- Goal：在已确认「remount 成本在 fiber 创建」的前提下，尝试低风险组件层优化，看能否在不改 `key` 的情况下削减成本。
- 两个候选优化，**都被测试否决并完整回退**：
  1. **给 `ThinkingBlock` 加 `memo`**（该会话有 125 个实例，是 surface 中唯一未 memo 的组件）。失败原因：`thinking-block-interaction.test.ts` 直接调用组件函数来断言 pointerdown-first 契约，memo 返回的是对象而非函数，4 个用例全部报 `ThinkingBlock is not a function`。而且即便不冲突，memo 对 remount 本就无效——全新 fiber 一定会执行组件函数，这正是上一轮实测得出的结论。
  2. **按消息对象身份缓存 `messageDecorationFingerprint`**（每行每帧两次 `JSON.stringify`）。失败原因：`message-actions.test.ts:561` 明确断言「**原地修改 details（数组引用不变）→ 指纹变化 → 行重新装饰**」。这是被测试锁定的语义，与「同对象必然同指纹」的缓存前提直接冲突，2 个用例失败。
- 结论：这两个方向都不通，且都不是「测试写错了」——测试锁定的是真实契约（组件可被直接调用、原地变更必须被发现）。M3 若要走，仍必须动 `key` 或做 DOM 保活，没有组件层的捷径。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.49s）。主实例 5176 全程运行（health 200 复核），临时实例 32187 已清理。
- Notes：本轮**生产代码零净改动**（两处尝试均已回退）。唯一留下的是这段记录，避免后续重复尝试同样两条死路。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-remount-profiling（done，2026-10-21）

- Goal：为准则 4 的剩余部分（消除整树 remount）建立可执行的成本基线，并排除错误方向。
- 实测（A=618 行/10425 节点，B=171 行，来回切换，只读视图与渲染缓存均已生效）：

  | 切换方向 | longtask 数 | 累计阻塞 | 最大单项 |
  |---|---|---|---|
  | 大 → 小 | 8 | 1034ms | 238ms |
  | 小 → 大 | 10 | **2360ms** | **854ms** |

  分段（点击为 0）：+5ms 首个 longtask 140ms → +148ms `load-start` → **+383ms 618 行旧 DOM 整体销毁（MutationObserver 记录移除 578 节点）** → +592ms `first-paint`/`ready`。
- **三个被数据排除的方向**（这是本轮的主要价值）：
  - 不是 DOM 解析：1.47MB `innerHTML` 重建单次仅 **23ms**；
  - 不是布局：10425 节点强制同步布局单次 **0.1ms**；
  - 不是网络：首个 140ms longtask **早于** `load-start`。
  结论：成本在 React 创建约 1 万个 fiber + 组件函数执行（该会话 125 个 `ThinkingBlock`、191 个工具行、19 个 markdown 块）。这解释了为什么「内容寻址缓存」只解决了字符串解析、没解决 remount 本身。
- 本轮产出：上述数据全部写入 `docs/architecture/session-open-fast-path.zh-CN.md` 的 M3 章节，作为后续改造的基线与方向约束。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 通过。主实例 5176 全程运行（health 200 复核），临时实例仅用 32185/32186 并在结束时清理。
- Notes：**未修改生产代码**——本轮是诊断，不是修复。M3 的保活改造（`SessionViewStore` + `ChatSurface` 的 `key` 迁移策略）需要产品决策支撑：`key` 除 remount 外还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换它必须先确定该状态如何显式迁移。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-message-rows（done，2026-10-21）

- Goal：消除准则 4 明确点名的「命令式 DOM 后置注入的重复扫描」。
- 发现：`getPrimaryMessageElements` 在 **4 个装饰器**里各写了一份完整实现（`message-actions`、`assistant-waiting-bubble`、`context-compaction`、`approval-card`），每份都是 `querySelectorAll('.qf-user-message, .qf-assistant-message')` + `closest` 过滤。一次 decorate pass 会对同一张列表重复全表扫描多遍。
- 改动：新增 `src/components/chat/panel-decoration/message-rows.ts` 作为唯一枚举实现（`readMessageRows` / `getPrimaryMessageList`），4 处改为复用；`context-compaction`、`assistant-waiting-bubble`、`decorateMessages` 增加可选 `messageRows` 入参，`ChatPanelHost.decorate` 在 pass 开始时枚举**一次**并向下传递。
- 一个实现细节：`readMessageRows` 里把 `closest('message-list, .qf-message-list')` 拆成两次单选择器查询。真实 DOM 两者等价，但测试脚手架只支持单选择器形式——合并写法会让 4 个既有用例失败。这是「实现要适配最小 DOM 契约」的一个具体例子。
- 测试：新增 `tests/frontend/message-rows.test.ts`（3 例：只保留本列表的行并跳过流式尾行、无列表时返回空、**每次调用只做一次全表扫描**）。最后一条锁定的正是本轮要解决的问题。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.58s）。浏览器实测（独立端口 32184，361 条会话）：171 行、消息动作 8、压缩横线 1、过程组 6、composer 与贴底均正常。主实例 5176 全程运行（health 200 复核）。
- Notes：准则 4 的「消除重复扫描」部分已有实质进展，但「消除整树 remount」仍未动——那需要 M3 的 `SessionViewStore`，且受 `ChatSurface` 的 `key` 约束。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-scroll-anchor（done，2026-10-21）

- Goal：把重复的滚动锚点补偿逻辑收敛为单一抽象，为 M3（展示层跟随「会话」而非「agent 实例」）打地基。
- 发现的问题：同一套公式在 `ChatSurface` 里存在两处独立实现——`captureReadingAnchor`/`applyReadingAnchor`（后台补齐历史）与 `loadMoreMessages`（加载更早一页）。公式相同但各自维护，且都嵌在组件里无法单测。
- 改动：新增 `src/components/chat/scroll-anchor.ts`，导出 `readScrollAnchor` / `resolveAnchorRow` / `anchoredScrollTop` 与 `ScrollAnchor` 类型。两处调用点改为复用；`loadMoreMessages` 通过 `requireMessageIndex: true` 表达「分页必须锚在真实消息行上，不能锚折叠组（分页会重建它们）」。
- 顺带修复一个实测暴露的既有缺陷：顶部可见行是**折叠过程组**（无 `data-message-index`）时，原实现回退到 ordinal，前置 142 行后该 ordinal 指向了别的行——浏览器实测 `scrollTop` 保持不变而顶部文字被换掉。修复为「优先锚在带索引的真实消息行，找不到才退回任意行」。修复后实测 `topText` 保持一致。
- 测试：新增 `tests/frontend/scroll-anchor.test.ts`（9 例，覆盖锚点选取、`requireMessageIndex` 行为、按索引优先/按 ordinal 回退、补偿值计算、无需调整时返回 null）。这两个函数此前完全没有单测覆盖。
- 验证：`npm run test` 全量 399 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.78s）。浏览器实测（446 条会话，独立端口 32182 临时实例）：补齐后 `topText` 保持一致、`hydrated` 从 99 → 203 行。主实例 5176 全程运行（health 200 复核）。
- Notes：M3 的下一步是在这个抽象之上建 `SessionViewStore`。`ChatSurface` 的 `key` 仍是硬约束（承担「换会话时丢弃草稿恢复/编辑器状态」）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-decorate-measurement（done，2026-10-21）

- Goal：量化装饰层在真实长会话上的成本，判断是否值得为 M4（装饰层 React 化）投入重构。
- 实测（618 行已完整补齐的会话，单次强制装饰 pass）：**16.5–17.2ms**，首帧后第一次是 5.1ms（干净状态）。其中「枚举本列表拥有的行」这一步占约 6.2ms。
- 尝试并回退的优化：把选择器从 `user-message, assistant-message, .qf-user-message, .qf-assistant-message` 收窄为纯类名（实测遗留自定义元素匹配数 = 0，走查从 6.94ms 降到 4.91ms）。**被测试否决**：`message-actions.test.ts` 用 `createFakeElement('user-message')` 显式锁定遗留标签兼容行为，收窄后该用例失败。收益仅约 2ms/次（16.5 → 14.5ms），远低于 50ms longtask 阈值，不值得拿一个被测试锁定的契约去换。已完整回退，理由与实测数据写进代码注释。
- 结论：装饰层在当前规模（618 行）不是瓶颈。M4 的价值在于「消除命令式 DOM 注入带来的状态复杂度与自愈逻辑」，不在性能；不应以性能为由推进 M4。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（6.18s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32181。
- Notes：本轮没有留下生产代码改动（唯一改动是注释记录了实测结论与回退理由）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-cache-proof（done，2026-10-21）

- Goal：为「内容寻址渲染缓存」提供真正能证伪的证据，而不是「输出一致」这种自证式断言。
- 发现的问题：`chat-math.test.ts` 里的元素树缓存测试原本只断言「同一 content 两次渲染输出一致」。这个断言有缺陷——**即使每次都重新解析，输出也必然一致**，它无法区分「命中缓存」与「重新解析」，等于没有测到缓存本身。
- 修复：spy `react-markdown` 模块并统计调用次数。`react-markdown` 默认导出是普通函数（已在 Node 中确认 `typeof default === 'function'`），所以可以直接测量 unified 流水线实际运行次数。新增两例：
  - 命中缓存时调用数不增（真正跳过 parse + 插件）；
  - `clearMarkdownElementCache()` 之后调用数增加（缓存确实承载了复用）。
- 验证：`chat-math.test.ts` 15 例全通过；`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` 成功（5.82s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32180。
- Notes：这条测试的意义不在于覆盖率，而在于它现在**能真正失败**——如果有人把缓存改回每次都解析，第一例立刻变红。M3（会话视图实例池 keep-alive）与 M4（装饰层全量 React 化）仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-idle-hydration（done，2026-10-21）

- Goal：对首屏链路做精确耗时归因，找出剩余的可优化项。
- 归因结果（1279 条消息，点击切换）：`/view` 8ms / 592KB、`/state` 18ms / 77KB、尾部对账 `/messages` 2ms / 2.4KB，`click → first-paint` 275ms；但**全量补齐 `/messages` 是 141–186ms / 10MB**，且原本在 first-paint 的同一时刻发起——正好与用户首次交互抢主线程。
- 修复：`hydrateFullHistory` 改到 `requestIdleCallback`（`timeout: 2000` 兜底；无该 API 时 300ms `setTimeout`），给它独立取消句柄。实测补齐启动点从「首帧同时」推迟到**首帧后 270ms**，且补齐结果正确（`minIdx=0` / `maxIdx=1277`、贴底正常、composer 正常）。
- 一个被避免的 bug：最初把 idle 句柄赋给 `cancelInitialRenderReady`，会覆盖首帧就绪通知的取消函数，导致卸载时无法取消就绪通知。已改为独立的 `cancelHydration`，并在 cleanup 中一并调用；加了源码契约测试锁定「不得覆盖」。
- 测试：`chat-surface-behavior-alignment.test.ts` 新增 1 例（补齐必须走 idle 槽、取消句柄独立）。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.95s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32179。
- Notes：`clickToFirstPaint` 在一次未命中缓存的测量里是 458ms（首次加载该会话），命中缓存时 275ms——这是既有差异，不是本轮回归。10MB 全量补齐本身仍是成本，但它已不在关键路径上；进一步压缩需要服务端分页 + 窗口化（M3 范畴）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-decorate-timing（done，2026-10-21）

- Goal：把「首帧后第一轮 DOM 装饰」的耗时也纳入观测——它不在 `ready` 之前，但决定按钮/折叠何时可用，属于打开会话的用户感知成本。
- 问题：首版埋点只到 `ready`，而装饰在 `ready` 之后由 rAF 触发。DevTools trace 到「已上屏」就结束，真正阻塞首次交互的那段成本是隐形的，无法判断装饰层是否值得继续优化。
- 改动：`session-open-timing.ts` 新增 `recordFirstDecorateTiming` / `readSessionOpenTiming().firstDecorateMs`，同时打一个 `qf:session-open:decorate:<sid>` mark（带 `durationMs` detail）；`ChatPanelHost` 的 `runDecorate` 在结束时记录。只记第一轮：流式期后续装饰是常规开销，混入会掩盖打开会话的真实数字。
- 实测（1279 条消息的活跃会话，独立端口临时实例）：`click → first-paint/ready = 441ms`（上轮同链路 608ms），补齐后 `minIdx=0` / `maxIdx=1277` 正常；`data-message-list` 有 203 行时，单次强制装饰 pass 约 12–17ms，无 longtask。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.24s）。主实例 5176 全程运行（`/api/health` 200 复核），临时实例只清理了 32178 这一个进程。
- Notes：装饰 pass 12–17ms 未达 longtask 阈值（50ms），在当前规模下不是瓶颈，因此**本轮没有为它做进一步优化**——先把成本变成可见数据，避免凭直觉优化非瓶颈。M3（会话视图实例池 keep-alive）与 M4（装饰层全量 React 化）仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-active-window（done，2026-10-21）

- Goal：实机测量完整首屏链路（点击 → 可交互），定位并修复残余的耗时来源。
- **发现并修复的第二个真实缺陷**：只读视图的**内存命中分支**直接返回 `getSessionState`，后者携带完整消息列表。实测 1279 条消息的活跃会话：`/view` 响应 **9.5MB / 1946ms**，首屏 `click → first-paint` 高达 **3202ms**。也就是说只读端点在最需要它的场景（大会话、活跃会话）完全没有生效。修复：内存命中同样应用尾部窗口，但保留 `tools`、待审批、流式等运行时字段。同一条链路降到 **592KB / 7ms**，首屏 **608ms（−81%）**。
- 验证方式：因用户要求不关闭现有实例，起了独立端口（32177）的临时实例加载新代码验证，验证完成后只清理该临时进程，主实例（5176）始终保持运行（`/api/health` 200 已复核）。
- 实测数据（1279 条会话）：冷 `view` 592KB/11ms；`restore` 76KB + 内存命中 `view(tail=200)` 592KB/7ms（此前 9.5MB/1946ms）；前端 `click→first-paint` 3202ms → 608ms，且补齐仍正常（`minIdx=0`、`maxIdx=1277`）。
- 测试：`session-view.test.mjs` 新增 2 例——活跃会话也走尾部窗口（断言窗口取尾部而非头部、`messagesSummary.count` 正确、`tools` 运行时字段保留）、活跃会话消息未超窗口时不带 summary。当前 9 例全部通过。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.67s）。
- Notes：这次修复说明「按分支写测试」比按路径写更可靠——第一版测试只覆盖了冷会话（storage 分支），内存分支漏测，直接导致 9.5MB 的回归上线到实测阶段才被发现。M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-hydration-anchor（done，2026-10-21）

- Goal：在浏览器实机验证 M2 只读视图链路的用户可见行为，并修复补齐历史带来的滚动跳变。
- **发现并修复的真实回归**：尾部窗口在头部插入 100~200 行历史时，`scrollTop` 不变而上方内容变高，用户视口整体下跳。实测（886 条会话）：补齐后 `scrollTop` 完全不变，顶部可见行从「已测试完成」变成「异步 shell 测试通过」——用户读的内容被推走了。
- 修复方案经历三次失败才成立，全部记录在代码注释与架构文档里：① 在发起请求时捕获锚点（错：网络往返期间用户会滚动，用过期位置）；② 用 `offsetTop` 算 delta（错：测量发生在插入行高度稳定之前）；③ 用 DOM 节点身份（部分错：折叠过程组会被重建）；④ **视口偏移 + 绝对 `data-message-index`（无索引用 ordinal 回退）**（通过）。
- 实现：`hydrateFullHistory(beforeReplace?)` 在替换前一刻同步调用回调，宿主用它调 `surfaceRef.current.captureScrollAnchor()`；`ChatSurface` 的 layout effect 在提交时按 delta 补偿 `scrollTop`。补齐触发点从 `useAgentManager` 移到 `ChatPanelHost`（那里才有 surface ref）。
- 另一处修复：`server-agent.ts` 里 `window.requestAnimationFrame` 未做环境判断，非 DOM 环境（测试、ACP）直接抛 `window is not defined`。已改为带 `typeof window !== 'undefined'` 守卫。
- 浏览器实测证据：端点级——1179 条会话 `/view` 601KB/20ms（全量视图 4.6MB/57ms）；网络请求顺序 `/view` → `/state` → `/messages?after=360`（证明窗口偏移换算正确）；UI 级——361 条与 1179 条会话均能滚到 `data-message-index=0`，贴底、composer、回底按钮、轮次导航全部正常；补齐时 `topText` 不变且 `scrollTop` 精确补偿。
- 测试：`chat-surface-behavior-alignment.test.ts` 新增 5 例（替换时刻捕获、delta 度量方式、锚点识别方式、宿主触发位置、非 DOM 守卫）；`server-agent-message-window.test.ts` 8 例锁定窗口偏移换算；`session-agent.test.ts` 新增窗口补齐 2 例。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.85s）。
- Notes：残余 67px 漂移来自补齐前后折叠过程组自身高度变化（折叠头文案随时长变化），不是定位错误。M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-tail-window（done，2026-10-21）

- Goal：实机验证 M2 只读视图通道的真实收益，并修掉实测暴露的设计缺陷与回归。
- **实测推翻了原假设**：第一版 `/view` 全量返回，1179 条消息的会话单次响应 4.6MB / 57ms，而完整 restore 链路（restore 78KB + messages 4.5MB）共 151ms。只读端点确实省掉了一次串行往返，但**字节数完全没降**——瓶颈从「服务端重建运行时」转移成「单次超大响应 + 前端主线程解析」，实际更糟。
- 修正：新增 `readSessionStateTail`（SQLite 只取末 N 条 + total），默认尾部 200 条，支持 `?tail=N`。实测 1179 条会话 **4.6MB/112ms → 601KB/20ms（−87% / −82%）**，`tail=50` 时 128KB / 5ms。
- 尾部窗口引入两个正确性问题，均已修复并加测试：
  - **前缀永远补不回**（真实可见回归）：只读视图只带 200 条，增量对账只往后拉、不补前缀，用户从完整 restore 的 361 条退化为只能看到 200 条。修复：`hydrateFullHistory()` 首屏后做一次全量替换并归零窗口偏移。
  - **增量对账索引基准错**：`mergeIncrementalMessages` 与所有 `summary.count === localCount` 比较都隐含「本地索引 == 服务端索引」，窗口场景下会误判为服务端截断并触发无意义全量重拉。修复：新增 `messageWindowOffset`，比较改用 `localEnd`，合并改走新增的 `mergeWindowedMessages`（丢弃落在被省略前缀里的尾部条目）。
- 另一处修正（测试发现）：`readSessionStateTail` 的非 split 分支原本无条件返回 `total`，导致全量返回时也带上 `messagesSummary`，短会话被误判为「有更早历史」。改为仅在窗口被截断时返回。
- 测试：新增 `tests/frontend/server-agent-message-window.test.ts`（8 例，锁定窗口偏移换算，偏差一格就会让整段对话渲染错位）；`server-agent.test.ts` 新增 2 例（窗口补齐为全量、全量时不再多发请求）；`session-view.test.mjs` 新增 2 例（返回尾部而非头部、短会话不下发 summary）。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.60s）。
- Notes：实机验证用 `node server/index.mjs --dev` + curl 直接打端点测得。**未做浏览器 UI 级验证**（未在真实界面点击会话观察渲染与滚动），这是下一步应补的验证。M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-round2（done，2026-10-21）

- Goal：补齐「会话打开快路径」的第二个渲染缓存缺口（KaTeX），并继续削减装饰热路径的重复工作，全程不改可见行为。
- 改动：① `KatexMath.tsx` 接入内容寻址缓存（`(display, latex)` → html）。`katex.renderToString` 是纯函数，但 React `memo` 只在同一次挂载内生效；会话切换整树 remount 会让历史公式逐个重算。只缓存成功结果，异常路径仍回退红色原文。新增 `clearKatexHtmlCache` 供测试隔离。② `ChatPanelHost.tsx#artifactsInputKey` 按 `messages` 数组身份加 `WeakMap` 记忆。依据是既有不变量「`state.messages` 从不原地修改」——已全仓核实无 `push`/`splice`/`pop`/`shift`/`unshift` 写入，所有写入方一律替换整个数组，与 `readAgentSnapshot` 的身份复用契约一致。
- 被测试否决并回退：给 `goal-iteration-divider` 加「details 指纹相同就跳过」的短路。该装饰器既有语义是**每周期重新确认分隔线仍挂在宿主末尾**（其它装饰器可能在它之后追加内容），`goal-iteration-divider.test.ts` 显式锁定该幂等重定位行为。已回退，理由写入架构文档 M1.6。
- 测试同步：`chat-math.test.ts` 的「renderToString 抛错」用例需要在断言前 `clearKatexHtmlCache()`——缓存生效后，前序用例缓存的成功结果会让它走不到失败分支。这是缓存的正常行为，不是回归。
- 验证：`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.69s）。定向：chat-math 10、goal-iteration-divider 67、chat-surface-render + chat-surface-behavior-alignment 27。
- Notes：`KatexMath.tsx` 新增非组件导出触发 `react-refresh/only-export-components`，按仓内既有先例（`Markdown.tsx`、`MessageList.tsx`）在文件首行加 `eslint-disable` 说明。M3 未实施，且发现一个新约束：`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话的草稿恢复/编辑器状态」的职责，需要先用显式的会话级 key 迁移策略替代。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m4-slice（done，2026-10-21）

- Goal：在不改变任何可见行为的前提下，削减装饰层与滚动路径上的重复全表扫描与临时分配（准则 4 的可证明等价切片；M3 的 keep-alive 与 M4 的全量 React 化仍未实施）。
- 改动：① `panel-decoration/message-actions.ts` 的 `getMessageElements` 由「`Array.from(querySelectorAll)` + 两次 `filter`」改为单遍遍历 + 提前 `continue`，语义不变（嵌套列表仍排除、流式 partial 仍排除），每次装饰少一次中间数组与一轮祖先遍历。② `panel-decoration/process-folding.ts` 的 `decorateProcessBlocks` 用 `flushTurn` 闭包单遍分组，避免每轮回调都新建数组；分组结果与原来逐字一致。③ `scroll-sync.ts` 的 `scrollToBottom` 调整读取顺序：先读 `scrollTop` 再读 `scrollHeight`，让「已贴底」的短路判断尽可能避免触发不必要布局失效。
- 判据：三处都只重排执行路径，不改变任何阈值（脱离 50px / 吸附 10px / 近底 80px / 回底按钮 280↔120）、不改变分组规则、不改变 DOM 结构或类名。
- 验证：定向 vitest 全绿（process-folding 系列 4 文件 118 passed、scroll-sync + scroll-to-bottom-button 29 passed）；`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` 成功（5.66s）。
- Notes：这是准则 4 的**部分**进展，不是达成。真正消除整树 remount 需要 M3：`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」，且必须先把滚动状态归约为单一 `ScrollAnchor`（`{ turnId, offsetPx }`）才能安全开启窗口化——否则「滚动到顶部」的可见行为会变。装饰层全量 React 化（M4）同样未做。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m0-m1（done，2026-10-21）

- Goal：优化「点击历史会话 → 首帧可交互」的耗时，且不改变任何用户可见交互（滚动阈值、折叠规则、遮罩过渡、DOM 契约、只读/分享/侧聊能力矩阵全部不变）。
- 根因（只读调研结论）：① 读路径被写路径绑架——`GET /state`、`GET /messages`、`POST /restore` 在服务端全部 fallback 到 `restoreAgent`，而它走 `createAgent` 全套（`buildSystemPrompt` / `createServerTools` / `readProjectConfig` / `readStore(settings)` / MCP），只为显示一段历史却重建整个 Agent 运行时；② 展示与运行时耦合——`ChatSurface` 的 `key={agentRuntimeScopeId ?? agent.sessionId}` 让切会话 = 整树 remount = 全部历史 Markdown 重新解析、代码块重新高亮、Mermaid 重新渲染，而这三者都没有跨 mount 缓存；③ 重复计算——`createAgent` 内 `readProjectConfig` 实读 3 次、`readStore('settings')` 至少 4 次、skills 目录扫描 3 次（其中 `createSkillTools` 与 `loadSkillToolContext` 是同一批目录扫两遍）；④ 前端 `fetchAllSessionMessages` 串行分页，默认 500 导致长会话 ⌈N/500⌉ 次串行往返。
- 改动（M0 埋点）：新增 `src/lib/session-open-timing.ts`，`performance.mark` 四段（click / load-start / first-paint / ready），`readSessionOpenTiming` 汇总 `clickToReadyMs` / `clickToFirstPaintMs` / `loadToReadyMs`；接入 `useAppLoadingTransitions`（click / load-start / ready）与 `ChatPanelHost` 就绪回调（first-paint）。纯旁路：Performance API 缺失、id 非法、重复打点全部静默处理。
- 改动（M1.1 渲染缓存）：新增 `src/lib/render-cache.ts`——`ContentCache`（有界 LRU，FNV-1a 摘要定位桶 + **命中时逐段严格比较原字符串**，摘要碰撞只会退化为 miss）、`memoizeContent`、`memoizeContentAsync`（并发调用共享 in-flight promise，失败不入缓存）。接入三处纯函数：`chat-math.ts`（定界符预处理结果含 token Map）、`code-highlight.ts`（`(language, code)` → segment 数组）、`mermaid-renderer.ts`（源码 → SVG）。
- 改动（M1.2 消除重复技能扫描）：`server/tools/definitions.mjs` 的 `createSkillTools` 新增可选 `resolvedSkills`；`server/agent-manager.mjs` 的 `createServerTools` 改为先 `loadSkillToolContext` 一次、`createSkillTools` 通过 `resolvedSkills: mergeSkills(...)` 复用。`loadSkillToolContext` 改为无条件执行（原先在 `includeSkillTools=false` 时被跳过），保持 toolContext 字段形状不变。
- 改动（M1.3 配置读取缓存）：`server/storage.mjs` 新增按 `(mtimeMs, size)` 校验的 `readJsonFileCached`（命中返回 `structuredClone`，保持调用方「可随意修改返回值」的既有语义）；`writeJsonAtomic` 在 rename 成功后 `invalidateJsonFileCache(file)`，避免文件系统 mtime 粒度较粗时读到写入前的值。`readProjectConfigData` 与 `readConfigStore` 改走该缓存。外部直接编辑文件同样被 `(mtime, size)` 变化捕获，与原先「每次都读盘」的新鲜度一致。
- 改动（M1.4 分页对齐上限）：`server/routes/agent.mjs` 的 `GET /api/agents/:id/messages` 默认 `limit` 由 500 提升到服务端上限 5000；显式传 `limit` 仍可降级到任意较小页，返回形状与语义不变。
- 文档：新增 `docs/architecture/session-open-fast-path.zh-CN.md`（问题链路、交互契约红线、已实施改动、M2/M3/M4 设计与重写原则）；`docs/wiki/README.md` 增加导航；`docs/wiki/src/lib/README.md` 增加 `render-cache.ts` 与 `session-open-timing.ts` 条目；`docs/architecture/session-state-transactional-storage.zh-CN.md` 同步默认 5000。
- 明确不做：缓存 `react-markdown` 的元素树。remount 时 React 会为新 fiber 重新执行 `ReactMarkdown`，缓存元素对象无法跳过 parse + 插件流水线；真正解法是让会话切换不 remount（M3），不是缓存元素。该尝试已实施并回退，理由写在代码注释与架构文档里。
- 验证：定向 vitest 全部通过——render-cache 8、session-open-timing 5、project-config-read-cache 4、code-highlight 60、chat-math 10、mermaid-renderer 3、app-domain-hooks 14、chat-surface-behavior-alignment 10、chat-surface-css-contract 37、chat-surface-message-list 19、server-agent 138、routes/agent 44、agent-manager.persist-session-state 34、definitions 22、storage-config-split 8、storage-layer 15、storage.session-metadata-pin 2；`npx tsc -b` 通过；`npx eslint`（改动文件）0 error。
- Notes：M2（只读视图通道 `/api/sessions/:id/view` 不走 `restoreAgent`，`attachRuntime` 移出首屏关键路径）、M3（会话视图实例池 keep-alive，消灭 remount；需先归约 `ScrollAnchor` 再开窗口化，否则会改变「滚动到顶部」行为）、M4（`panel-decoration` 20+ 命令式注入器改为 React 兄弟节点）均未实施，设计与风险已写入架构文档。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## compaction-divider-at-compacted-end（done，2026-10-21）

- Goal：用户要求「自动触发上下文压缩时，压缩线应该显示在对应位置（被压缩历史的末尾），而不是挂在对话上方」。
- 根因：`src/components/chat/panel-decoration/context-compaction.ts` 的 `alignBoundaryToUserTurn` 把服务端 `compactedUpToIndex` **向前回溯**到包含边界的用户回合，横线因此插在该轮用户提问之前。自动压缩默认 `keepRecentTurns=0`（`server/auto-compaction.mjs` 的 `tailStartForRecentTurns` 直接返回 `source.length`），边界 = 消息总数，回溯后落点永远是「最新一轮提问上方」——用户看到的横线不在压缩结束处。同时 `insertBeforeMessageElement` 在找不到目标行时 `messageList.prepend(notice)`，把横线挂到列表最顶部。
- 改动：`context-compaction.ts` 删除 `alignBoundaryToUserTurn`（及仅供它使用的 `isUserMessage`），边界直接用 `compactedUpToIndex - messageIndexOffset`；`insertBeforeMessageElement` 重写为 `insertNoticeAtBoundary`——按「边界之前的可见消息条数」定位插入行（边界落在 `toolResult` 等不单独渲染的消息上时自然插到其后第一条可见消息之前），边界在已渲染末尾之后时 `lastElement.after(notice)` 跟到最后一条消息之后，仅在完全无消息行时才 `append` 到列表末尾（不再 `prepend`）。`dataset.tailStart` 改名为 `dataset.boundaryIndex`。
- 测试同步：`tests/frontend/context-compaction-notice.test.ts` 假 DOM 增补 `lastElementChild` / `after` / `append`，用例预期从「对齐到用户回合之前」改为「紧跟被压缩历史之后」；原「边界=窗口末尾显示在最后一个用户回合之前」改为「跟在最后一条消息之后」，原「非 user 边界对齐回用户回合」改为「不回退到用户回合」（toolResult 边界）。7 passed。
- 验证：定向 `npx vitest run tests/frontend/context-compaction-notice.test.ts` 7 passed；`npx vitest run tests/frontend` 223 文件 / 2673 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过；`npm run lint`、`npm run build` 见本会话记录。
- boundaries：只改横线的定位规则；不动服务端压缩链（`server/auto-compaction.mjs`、`conversation-compaction.mjs`）与 `compactedUpToIndex` 语义，不动 `windowed-messages` 窗口语义、审批卡的 `findKeepBoundaryTarget`、样式表 `.quickforge-context-compaction-*`；未引入新视觉模式；未手工修改生成产物。

---

## dead-code-cleanup（done，2026-10-21）

- Goal：按审计结论清理全量死代码——确定死代码全删，仅测试可达的实现一并删除，完全下线会话级文件回滚能力。
- 改动（服务端）：`server/goal/prompts.mjs` 删 `_criteriaBlock`/`_evidenceBlock`/`goalPlanningPromptV2`/`goalWrapupPromptV2`/`scopeEntry` 与随之无用的 `attachmentBlock`/`escapeXmlAttribute`；`server/goal/state.mjs` 删 `isGoalActivation`/`isGoalRuntime`/`isGoalTerminalPhase`/`goalRoundsRemaining`/`goalProgressSignatureV2` 与常量 `GOAL_ACTIVATIONS`/`GOAL_RUNTIMES`（保留在用的 `isGoalPhase`/`isGoalActivePhase`）；`server/goal/errors.mjs` 删 `isGoalError`；`server/hooks/hooks-settings.mjs` 删 `DEFAULT_HOOKS_SETTINGS`；`server/utils/network.mjs` 删 `isTailscaleAddress`；`server/utils/scheduled-tasks.mjs` 删 `cronMatches`；`server/subagents.mjs` 删 `getSubagentDefinition` 与随之无用的 `subagentByName`；`server/ai-provider-options.mjs` 删 `DEFAULT_AI_STREAM_DEADLINE_MS`；`server/session-state-backup.mjs` 删私有 `planValuesDigest` 并把内部调用改走 `computeSessionSnapshotDigest`（该导出因此转为生产使用）。
- 改动（会话级文件回滚整链下线）：`server/routes/agent.mjs` 删 `GET /file-changes`、`GET /rollback-files/preview`、`POST /rollback-files` / `rollback-file`；`server/session-file-backups.mjs` 删会话级 `inspectEntry`/`inspectEntryState`/`inspectBatch`/`getSessionFileRollbackPreview`/`getSessionFileChanges`/`rollbackSessionFiles`/`rollbackSessionFile`/`selectRollback`/`rollbackSelection`/`readBackupContent` 及 `createTextDiff` 导入（写入侧 `backupFileBeforeWrite`/`recordFileAfterWrite` 与轮级链路保留）；`src/lib/server-agent.ts` 删 `getFileRollbackPreview`/`rollbackFiles`/`rollbackFile` 与 `isFileRollbackPreview`/`isFileRollbackResult`；`src/lib/server-agent-types.ts` 删 `ServerFileRollbackPreview`/`ServerFileRollbackResult`；`src/components/chat/file-rollback-state.ts` 只保留 `TurnRollback*`；`src/components/chat/FileRollbackDialog.tsx` 只保留 `TurnRollbackDialogContent`/`TurnRollbackDialog`；`src/lib/i18n.ts` 删 19 个仅会话级弹窗使用的 `fileRollback*` key（保留 23 个轮级共用）。
- 改动（其余前端死代码）：`tool-param-summary.ts` 删 `truncateSummary`；`workflow-run-detail.ts` 删 `workflowAgentStatusKey`/`workflowActiveAgentLabels`/`formatWorkflowDuration`；`indexeddb-cache.ts` 删 `isIndexedDbCacheAvailable`；`tool-artifacts.ts` 删 `extractCurrentTurnArtifacts` 与 `latestUserMessageIndex`；`message-queue.ts` 删 `clearStoredMessageQueueState`；`pinned-summary-drag.ts` 删 `clampPinnedSummaryPosition`；`browser-connection-diagnostics.ts` 删 `summarizeResourceEntries` 与随之无用的 `SummarizeResourceEntriesOptions`/`DiagnosticsSummary`/`queueMetric`；`chat-capabilities.ts` 删别名 `SIDE_CHAT_CAPABILITIES`；`workspace-tree-state.ts` 删别名 `loadedExpandedWorkspaceTreePaths`；`process-folding.ts` 删 `processGroupTargetIndex` 与 `ProcessGroupTargetSource`、`latestThinkingLine`；`input-clamp.ts` 删 `INPUT_CLAMP_TRANSITION_MS`（改注释说明 .22s）；`code-highlight.ts` 删 `HIGHLIGHT_LANGUAGES`；`hooks-settings.ts` 删 `DEFAULT_HOOKS_SETTINGS`。
- 改动（样式）：`src/index.css` 删 `.quickforge-model-sheet-section`（label 变体仍在用）、`.quickforge-goal-strip-duration`（44f75ee 删节点未删样式）、`.quickforge-file-rollback-single` 基样式+hover+响应式一行、`--qf-console-fade` 两处声明（从未被 var() 消费）及空壳规则 `.qf-console-block.border-destructive\/50`。
- 测试同步：`file-rollback-state`/`file-rollback-dialog`/`file-rollback-api` 三个测试只保留轮级用例；`session-file-backups.test.mjs` 重写为「写入侧 shadow backup journal + 轮级 rollback」，丢弃 37 个会话级用例；`routes/agent.test.mjs` 只留轮级路由；其余 14 个测试文件的对应断言改为使用现役函数名或直接删除；`code-highlight.test.ts` 的语言覆盖改用「每种语言必须产出有色 token」的真实样本（不再依赖被删的 `HIGHLIGHT_LANGUAGES`）。
- 验证：`npm run test` 393 文件 / 4534 passed、2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` 通过（仅既有大 chunk warning）。未提交 Git。
- Notes：保留项均属刻意：`resetStartupState`/`__resetSlashCatalogCacheForTests`/`terminateSessionStateWorkerForTests` 是测试隔离钩子；4 个 barrel 的 66 个「无消费者再导出」本次未动（本体全活，删 export 行属独立机械重构，避免混入本次语义删除）；`dist/` 为构建产物由 build 重新生成，未手工修改。

---

## docs-cleanup-stale-assets（done，2026-10-22）

- Goal：评审并清理仓库内过时的文档与资产，同时修复文档链接 bug。
- 改动（删除，共 71 个文件 + 4 个目录）：`docs/analysis/`、`docs/prototypes/`、`docs/reports/`、`docs/reviews/`、`docs/design/`（19 个已落地设计稿）、`docs/archive/goal-test-demo.md`；`docs/architecture/` 下 8 篇一次性设计/评审与被 v2 取代的存储 v1 文档（`session-storage-current-architecture`、`session-storage-recovery-runbook`、`session-sqlite-migration-design-review`、`session-storage-background-migration-design`、`sqlite-compatibility-spike`、`config-split-design`、`storage-cache-directory-design`、`scheduled-task-runs-shadow-integration`）及其 4 个 svg；`docs/wiki/src/lib/.git`（误建的空嵌套仓库）与 `.gitignore`；根目录误产文件 `0`/`new`/`nul`/`m[1])`/`$null`/`{try{require.resolve('jsdom')`、`.qf-agent-debug.log`、`.tmp-*` 分析残留、`review-01~06.png`。
- 改动（修复）：`docs/wiki/` 下 71 处相对链接层级错误（wiki 在深度 2/3，指向仓库根与 `src/`、`server/` 的 `../` 少一层）；`docs/wiki/README.md` 新增「架构与设计文档」导航表；`docs/wiki/src/README.md` 目录结构补 components/hooks/lib 子文档链接；`docs/architecture/session-*` 中 3 处指向已删文档的引用改指 `session-storage-v2.zh-CN.md`；`tests/frontend/code-highlight.test.ts` 注释去掉指向已删 parity 报告的路径；`feature_list.json`/`progress.md`/`session-handoff.md` 中指向已删报告的引用改为文字说明。
- 判据：markdown 链接反向图 + 全文引用扫描；被删项均为「零入链 + 自述已被取代/已执行完毕」或「已被实现取代的一次性设计稿」。
- 补充（同日第二轮）：`design/`（1 个动效 demo）、`design-review/`（6 个含 1 个 svg）整体删除，`design-mockups/` 删除 24 个零外部引用的旧设计稿（`assistant-reply-file-card`、`chat-task-launcher`、`diff-display-optimization`、`diff-odometer-counter*`、`execution-summary-groups`、`file-reference-mention`、`goal-inspector-optimization`、`goal-pinned-summary`、`goal-ux-ui-optimization`、`hooks-settings`、`message-queue`、`model-compact-icon-options`、`pinned-summary-capsule-expand-icon`、`pinned-summary-drag-capsule`、`safe-undo`、`scheduled-tasks-frequency`、`scroll-to-bottom-button`、`session-tail-status-indicator`、`subagent-marquee-roll-switch`、`subagent-running-indicator`、`subagent-tool-marquee-impl`、`todo-capsule-summary`、`todo-pending-icon-options`），保留 12 个仍被 `src/`、`docs/wiki`、`feature_list.json` 引用的设计稿（`design-mockups` 从 36 文件 1040KB 收敛到 12 文件 301KB）。
- 补充（引用修正）：`docs/architecture/logging-design.zh-CN.md` 误写为已不存在的 `logging-design.md`；`docs/architecture/agent-plugin-system.zh-CN.md` 的 hooks 能力表指向不存在的 `server/plugins/events.mjs`、`server/plugins/hooks.mjs`，改为复用实际存在的 `server/hooks/hook-engine.mjs`、`server/hooks/hook-executor.mjs`；`design-mockups/goal-plan-tool-card-redesign.html` 注释里对已删 `todo-capsule-summary.html` 的引用改为文字描述。
- 验证：脚本复核 docs 内 0 失效链接、0 孤立文档（仅 3 个 `docs/archive/*` 状态归档按机制无需入链）；`feature_list.json`/`package*.json`/`tsconfig.json` JSON 解析通过；`npx vitest run tests/frontend/code-highlight.test.ts` 60 passed；`npx eslint` 该文件通过；`npx tsc -b` 通过。
- Notes：未触碰生成产物（`dist/`、`package-dist/`、`package-offline/`）；未提交 Git。剩余 `design-mockups/` 的 12 个文件均有 `src/` 或 wiki 引用，属活跃设计参照。`.agentbridge/`、`.playwright-mcp/`、`.zcode/`、`.idea/` 为本地工具缓存且已被 `.gitignore` 忽略，可按需手动清理（约 320KB，不影响仓库）。

---

## settings-search-autofill-guard（done，2026-10-21）

- Goal：防止设置页搜索框偶发被浏览器自动填充历史网址、账号等。
- 改动：`SettingsWorkspacePage` 提取 `SETTINGS_SEARCH_INPUT_PROPS`，桌面与移动搜索框统一加 `name="qf-settings-search"`、`autoComplete="off"`、`autoCorrect="off"`、`autoCapitalize="off"`、`spellCheck={false}`；`LanAccessSettingsTab` 的局域网密码与 `CustomProvidersSettingsTab` 的 API Key 分别补 `name` + `autoComplete="new-password"`；`settings-workspace-react.test.ts` 新增输入框属性与源码契约断言。
- 原因：原输入框无 name/autocomplete，Chromium 的自动填充/表单历史会按启发式猜测字段并向其中填值。设置页还包含 `type=password` 的局域网密码、API Key 输入，且相关 tab 常驻挂载，Chromium 会把整页当登录表单，并把最前面的搜索框猜成用户名框，出现搜索框填网址/账号、密码框填密码。
- 验证：定向 vitest 15 passed；`npx eslint` 改动文件通过；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有大 chunk warning）。未跑全量 test；浏览器自动填充无实机复现，仅做属性层修复。
- Notes：若个别浏览器/密码管理器仍强行填充，可再叠加 `data-1p-ignore` / `data-lpignore="true"` / `data-bwignore`，或改用只读至聚焦的方案；当前先采用标准属性。无依赖变更；未修改生成产物；未提交 Git。

---

## appearance-settings-preview-redesign（done，2026-10-21）

- Goal：用户认为设置页分组方案里的外观设计稿更好看，要求把实际外观页调整成设计稿风格。
- 改动：`AppearanceSettingsTab` 主题选择从分段按钮改为两张主题预览卡片（浅色/深色迷你侧栏 + 内容区 + 气泡，固定明暗配色），选中态用边框 + 勾选圆点；字号独立成组，保留滑杆与 px 值；新增“对话预览”卡片，头部使用界面字号、消息使用对话字号实时预览。
- 样式/文案：`index.css` 新增主题卡片、迷你预览、分组说明、对话预览样式；移动端主题卡片单列；`FontSizeSlider` 补 `ariaLabel`；i18n 补 `fontSize`、`appearancePreview`、预览用户/助手文案中英文案。
- 范围：主题/字号持久化与即时应用逻辑不变；不改后端/API/依赖；纯设置页视觉与预览增强，docs/wiki 无需更新。
- 验证：定向 vitest 4 文件 30 passed（appearance 3、settings-workspace 13、default-options 13、network-proxy 1）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Vite dev + Chrome CDP 1440×900 明暗主题与 390×844 移动端验证主题卡片选中、迷你预览、字号滑杆、实时对话预览，无 console error。
- Notes：未提交 Git；build 正常重生成 `dist/`，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## settings-grouped-navigation（done，2026-10-21）

- Goal：用户认为设置页 16 个标签页平铺过多，要求参考 Codex 等主流设置页做分组优化，并在两轮反馈后压缩为 3 个分组。
- 改动：`settings-tabs.ts` 增加 `group`/`keywords` 元数据并派生三组（基础 / AI 与扩展 / 自动化与数据）；`SettingsWorkspacePage` 按组渲染桌面与移动导航，新增设置搜索（按名称/描述/关键词/组名过滤，选择后清空，Escape 可清空）、关于置底；新增 `data`/`network` 状态保留 tab。
- 数据/网络：新增 `DataSettingsTab`（备份与恢复 / 已归档对话 / 分享链接子标签，首次访问后保持挂载，`active` 向下转发；分享链接页增加 `embedded`/`active`，隐藏重复标题并在重新激活时刷新）；新增 `NetworkSettingsTab`（局域网访问 + 从 `DefaultOptionsSettingsTab` 提取的 `NetworkProxySettingsSection`），`DefaultOptions` 移除代理逻辑并按基础/交互/上下文管理/终端四段展示。
- 文案/视觉：常规 → 通用、自定义模型 → 模型与提供商；补三组标签、搜索、空结果、数据管理与网络设备中英文案；`index.css` 增加设置分组标题与页内子标签样式；保留现有轻量分割线、淡选中态与圆角语言。
- 测试：更新设置注册表/导航用例（14 个 key、三组顺序、搜索过滤与选择后清空、data/network active 转发、状态保留），新增 `network-proxy-settings-react.test.ts` 验证 active 加载与连续刷新；代理刷新用例从 default-options 测试移出。
- 验证：定向 vitest 3 文件 27 passed；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Vite dev + Chrome CDP 实机 1440×900 和 390×844 验证三组导航、搜索“代理/备份”、数据管理三子标签与状态保留、网络与设备、模型与提供商重命名，无 console error。
- Notes：全量 `npm run test` 两次各出现 1 个既有 `tests/server/scheduled-tasks.commands.test.mjs` 随机失败（两次用例不同，单文件 24 passed），判定为并行 SQLite 抖动，与本次前端改动无关；未提交 Git；build 正常重生成 `dist/`，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## new-chat-project-row-branch（done，2026-10-21）

- Goal：新建对话底部项目行去掉整条背景块，项目本身默认无底色；分支紧贴项目显示（有则显示），并可复用分支选择菜单切换/新建分支。
- 改动：`NewChatProjectPicker` 新增 `branch` 与 `branchMenu`（projectId/dirtyCount/onCheckout/onCreated/onOpenGraph/onOpenChanges），项目 chip 后渲染分支按钮，点击经 portal 复用 `GitBranchMenu`（fixed 定位到分支上方，按视口收敛宽度/高度，外部点击或 Escape 关闭，切换后关闭）；`App.tsx` 传入 `titleGitStatus` 分支与既有 `handleCheckoutTitleBranch`/`handleBranchCreated`、Git 图谱与变更入口；`index.css` 移除 trigger 背景/圆角，chip 默认背景改 `transparent`（hover/focus 才显示），分支改为紧邻布局并带 hover/展开反馈。
- 范围：只改新建对话空状态项目行及其分支菜单复用；项目选择弹层、正常会话 composer 与 header 分支入口不变；未自动执行真实分支切换；无依赖变更；未手工修改生成产物；模块职责未变，docs/wiki 无需更新。
- 验证：定向 vitest 3 文件 43 passed（picker 4、分支菜单 jsdom 交互 2、css-contract 37）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Chrome CDP 实机 1400×900 与 390×844：chip/trigger 背景 `rgba(0,0,0,0)`、分支紧邻项目约 9px，菜单含分支列表/未提交更改/新建分支/Git 图谱、不超出视口、Escape 可关闭。未跑全量 `npm run test`。

---

## composer-pasted-text-tile-radius（done，2026-10-21）

- Goal：用户反馈输入框粘贴大段文本时，文本附件显示为圆形，不符合设计语言，要求与界面整体圆角对齐。
- 根因：`.quickforge-composer button { border-radius: 999px !important; }` 是给 composer 内图标按钮用的统一全圆规则；粘贴文本生成的附件 tile 主体也是 `<button>`，被该规则覆盖成圆形，而消息区同名 AttachmentTile 保持 `rounded-lg`。
- 改动：`src/index.css` 在全圆按钮规则后新增 `.quickforge-composer .qf-attachment-tile button:not(.qf-attachment-tile-remove)`，显式使用 0.5rem 中等圆角；`AttachmentTile.tsx` 给删除按钮补 `qf-attachment-tile-remove` 类，使其继续使用全圆。
- 范围：只影响 composer 内附件 tile 圆角；消息区附件、图片/PDF 预览、删除按钮交互均不变；未新增依赖；未手工修改生成产物；纯样式调整，无需更新 wiki。
- 验证：浏览器实机在 composer 粘贴 3200 字符生成文本附件，计算样式 tile 7px（根字号 14px 下的 0.5rem）、删除按钮 999px；定向 vitest 3 文件 69 passed；`npx eslint src/components/chat/surface/AttachmentTile.tsx` 通过；`npm run build` exit 0，产物 CSS 含新规则。

---

## workflow-summary-single-line-marquee（done，2026-10-21）

- Goal：用户反馈 run_workflow 折叠头右侧的运行中摘要会换行，要求固定单行、溢出滚动。
- 根因：`run_workflow` 摘要行通过 `renderToolMarquee(..., 'quickforge-workflow-marquee')` 渲染跑马灯，但 `src/index.css` 的 `.quickforge-workflow-marquee` 只设置了 `flex: 1 1 auto; min-width: 0`，缺少单行/定高/双视图绝对定位/隐藏 moving 视图的规则。custom element 因此按普通块级文本换行，且 static 与 moving 两份文本同时可见；640px 列宽下折叠头被撑到 55px（3 行）。
- 改动：为 `.quickforge-workflow-marquee` 补齐 `inline-flex`、`flex: 1 1 auto`、`min-width: 0`、定高 `1.125rem`、`overflow: hidden`、`white-space: nowrap`、mono 0.75rem，并补 `.quickforge-marquee-view` 绝对定位、`.quickforge-marquee-static` 省略号、`.quickforge-marquee-moving` 默认 `display: none`。复用现有 `ToolMarqueeController`：剩余槽位内溢出才横向滚动，短文本静止，`prefers-reduced-motion` 退化为省略号。
- 范围：只改 workflow 折叠头；内嵌工具行本就单行横滑，`run_subagent` 摘要行行为不变；`workflow-tool-renderer.tsx` 结构未动。
- 验证：定向 vitest 3 文件 56 passed（workflow-renderer 14、workflow-step-interaction 5、chat-surface-css-contract 37）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；构建 CSS 静态复测 640px 列宽下摘要行 18px 单行、长文本溢出 205px 可滚动、moving 默认隐藏。
- Notes：未提交 Git；build 正常重生成 `dist/`，未手工修改生成产物；无依赖变更。

---

## workflow-inner-tool-open-memory-isolation（done，2026-10-21）

- Goal：用户反馈 run_workflow 展开体里的内部 tool 调用看起来默认展开，希望默认收起。
- 根因：内层 `WorkflowToolCallRow` 与外层 `run_workflow` 卡都在同一个 `.qf-tool-message` 宿主内，`ToolDetails` 默认按最近宿主的 toolCall id 记忆开合。外层卡手动展开一次后，内层行在流式刷新、新增步骤或重挂载时读到同一个 `true`，于是自动展开；反向内层展开也会污染外层卡记忆。
- 改动：`ToolDetails` 新增可选 `stateKey`（显式 key 优先于宿主 toolCall id，空字符串表示不记忆）；`WorkflowToolCallRow` 传入 `workflow:${runId}:tool:${id}`，外层卡保持原 key。补 `tool-renderer-shared-state.test.ts` stateKey 单测与 `workflow-step-interaction.test.ts` 两条交互回归：外层展开后新增/重渲染内层仍收起；内层展开不污染外层，重挂载后各自恢复。
- 验证：`npm run test` 390 文件 4689 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；`npx tsc -b --pretty false` exit 0；定向 3 文件 36 passed。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常重生成 `dist/`）。

---

## workflow-agent-live-detail-parity（done，2026-10-21）

- Goal：用户反馈“workflow 点击 subagent 跳转后不能实时看到内部 tools 调用，显示与内部细节不一致，有时看不到 detail”，要求与 run_subagent 卡片保持一致、按最佳体验实现而非最小改动。
- 根因：① `run_workflow` 的 SSE 只更新聊天卡片，未像 `run_subagent` 那样实时写入 `subagentRunStore`，已打开详情不刷新；② 点击时用当前渲染帧覆盖 store，打开的是陈旧快照；③ 服务端 details 总量超 100KB 会把所有 Agent 的 trace 一起丢掉；④ `compactSubagentRunDetails` 从最旧消息逐条丢，容易拆散 toolCall/toolResult，且窗口化后与 run_subagent 显示不一致。
- 实时通路：新增 `src/lib/workflow-agent-run-events.ts`。`ServerAgent` 在 `tool_execution_start/update/end` 直接调用发布器，以 `${workflowRunId}:agent:${id}` 稳定 runId 将每个 Agent 映射为 `SubagentRunPayload` 写入全局 store；重连时以 `details.workflow === true` 兜底识别；终态不被迟到的 running 帧回退；缓存有界（120）。
- 载荷一致：重写 `workflow-subagent-detail.ts`，复用导出的 `subagentRunStatus` / `subagentRunError`；trace 经同一个 `subagentProcessTraceMessages`；timing 使用 Agent 真实 `startedAt`；缺 trace 时回填上一次可见载荷并标 `traceDropped`；input 增加 phase，details 保留摘要与 agent.error；任务说明取 `promptPreview`，并透传 `context` / `expectedOutput`（服务端 bounded 2,000 字符，预算超限缩到 400），与 run_subagent 详情的 task/context/expectedOutput 同构。
- 打开一致：`workflow-tool-renderer.tsx` 点击优先取 store 最新快照，只有历史恢复/首帧无快照时才用渲染帧并 publish；Agent 行构建载荷时传入 store previous；行状态/耗时改为统一 payload 推导（与 run_subagent 摘要卡同源）。Composer 的“运行中 subagent”指示器在 `run_workflow` 仍 pending 时按 `${toolCallId}:agent:` 前缀列出嵌套 Agent，点击打开同一 store 快照。
- 卡片复用：`WorkflowAgentRow` 不再复制 `run_subagent` 的按钮标记，直接调用 `subagent-tool-renderer.tsx` 的 `renderSubagentRunSummary`；workflow 只追加 meta/错误悬停文案与历史回填发布（onOpen），状态/耗时/跑马灯/点击打开事件完全同源。
- 服务端预算：运行中 details 240K、终态 500K；日志独立 50K；单 Agent 运行中 50 条/80KB、终态 200 条/200KB；单条 text/toolCall/thinking 2000、toolResult.details 4000；新增 `sliceMessagesWithToolPairs`（配对窗口）与 `dropOrphanToolResults`；批量 10 条缩减避免二次方 stringify；按 Agent 优先级裁剪（done 先、running 最后），先缩到 10 条/20KB，再整体移除并标 `subagentRunDropped`；不再因总量超限丢掉所有 Agent trace。
- 透明提示：`SubagentRunPayload.traceDropped` 纳入指纹与 body blocks；详情页新增 `subagentTraceTruncated` 中英文案与 `traceNotice` 块，被服务端裁剪时明确提示“过程记录不完整”，同时保留最后一次可见 trace。
- 测试：新增 `tests/frontend/workflow-agent-run-events.test.ts`（实时发布与增量、dropped 回填、终态不回退、忽略非 workflow）；`workflow-step-interaction.test.ts` 新增“store 领先渲染帧时点击打开最新 running 快照”；`subagent-running-indicator.test.ts` 新增“pending run_workflow 下列出嵌套运行 Agent”；`agent-workflow-runner.test.mjs` 新增终态完整尾部、toolCall/toolResult 配对窗口、总预算超限保留最新 Agent trace，并断言 context/expectedOutput 透传；`workflow-renderer.test.ts` 契约改为断言 Agent 行调用 `renderSubagentRunSummary`（不再复制卡片标记）。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md` 同步预算表、`detailsTruncated`/`subagentRun`/`subagentRunDropped`、Agent record 的 prompt/context/expectedOutput、7.3 实时详情通道与 Composer 指示器、测试清单与相关文件；`docs/wiki/src/lib/README.md` 新增发布器条目并同步 subagent 载荷/面板块与 store list；`docs/wiki/server/README.md` 同步 details 预算与裁剪优先级；`docs/wiki/src/components/README.md` 同步 Composer 指示器覆盖范围。
- 评审补强（2026-10-21）：① 服务端 `trimSubagentTraces` 部分缩容时标 `subagentRunTruncated`，前端把它与 `subagentRunDropped` 一致对待：保留最后一次可见的更长 trace 并显示“过程记录不完整”，终态装得下时自动恢复完整过程，不再静默缩掉用户已看到的工具卡。② `WorkflowAgentRow` 用 `shouldPublishSubagentRunPayload` 在 effect/onOpen 安全回填 store：历史首帧、或 SSE 断连漏掉结束帧导致 store 仍 running 而渲染帧已终态时修正，已有终态不被覆盖；发布器 previous 改为优先取 store、再回落本地缓存，避免渲染层已修正的完整 trace 被迟到帧缩回旧缓存。③ 日志预算改为从最新往前保留至多 50 条且累计 ≤50K，修正“50 条大日志仍可超 50K”的口径。新增 4 个回归用例（部分缩容保留长 trace、store 优先回填、终态渲染修复 stale running、日志累计预算）。
- 验证：`npm run test` 390 文件 4685 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；`npx tsc -b --pretty false` exit 0；定向 6 文件 172 passed。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常重生成 `dist/`）。已持久化的旧 workflow 结果没有实时 trace，需重跑一次。未做浏览器实机验证。

---

## goal-v2-dsh-round-driver（done，2026-10-19）

- Goal：用户反馈 Goal 执行中会不必要阻塞、恢复时显示"正在收尾运行"。根因是 v2 runner 保留了太多 QuickForge legacy 逻辑。完全对标 DSH 重写 round driver。
- 删除的 legacy 逻辑：规划阶段（goal_report plan）、证据门禁（criteria+evidence 检查）、防空转检测（no_progress）、重复失败暂停（repeated_failures）、`goalRunSettling` 结算屏障。
- DSH 对标行为：每轮都是执行轮（objective + round number）；轮次正常结束 → complete/blocked 停止，否则直接下一轮；错误 disarm 不重试；轮次上限 block `round_limit`；`update_goal complete` 在执行轮内直接生效（无证据检查）；`/goal <objective>` 创建后返回文本响应，driver 通过 setImmediate 启动第一轮。
- Round 提示词改为 DSH 式 `<goal_round>`（objective + round + 继续工作指令），不含 criteria/evidence。
- 验证：`npm run test` 389 文件 4672 passed / 2 skipped；`npm run lint` 0 error；`npm run build` exit 0。定向：v2 manager 6 passed（round limit、update_goal complete、create_goal、pause/resume/clear、重启 disarmed）。

---

## workflow-subagent-trace-budget（done，2026-10-19）

- Goal：workflow 里点进 Subagent 详情，工具过程应和直接 `run_subagent` 一样可见。
- 根因：`compactSubagentRunDetails` 把每个 Agent 的 `subagentRun` 压到 6KB。元数据占掉大部分后，从最旧消息丢起，一次 toolCall + toolResult 先被丢掉，详情页只剩最终回复。
- 改动：单 Agent trace 上限改为 80KB、最近 50 条（与直接 subagent 的运行期 trace 截尾一致）。单条文本仍 1000 字符，toolResult.details 仍 2000 字符。`workReport` 继续关闭，编排脚本只拿最终文本。整份 workflow details 超过 100KB 仍会丢 `subagentRun`。
- 验证：见本轮 `tests/server/agent-workflow-runner.test.mjs`。
- Notes：未提交 Git；未手工修改生成产物。已持久化的旧 workflow 结果没有这份 trace，需重跑一次才能在详情里看到工具卡。

---

## latest-code-review（reviewed，2026-10-19）

- 范围：未提交 diff（workflow 内部行对齐、运行中 subagent trace）+ 已提交 Goal v2 / `run_workflow`。只读评审，未改产品代码。
- 确认问题：Goal v2 执行轮可用 `update_goal complete` 直接完成，`service.complete(..., { by: 'user' })` 不走 `checkGoalCompletionV2`。测试 `lets the model complete from an execution round through update_goal` 明确允许无证据完成。`goal_report complete` 仍要求证据、正常轮末和持久化。工具说明、`prompts.mjs` 与 wiki 把证据路径写成完成方式，和这条旁路不一致。
- 风险：workflow 内部 `ToolDetails` 与外层卡共用 `.qf-tool-message` 的同一 toolCall id 记忆。展开内部工具行会把外层 `run_workflow` 卡的开合状态一起记住，流式重挂载后两者同步打开或收起。
- 风险：`trimDetails` 先截断 agent 预览，超限才丢 `subagentRun`。大 trace 会先牺牲已完成 Agent 的结果预览；截断后的 trace 仍计入体积，可能继续触发丢弃。
- 未改：内部工具行没有外部卡的 diff/预览/终止按钮；`run_workflow` 仍排除在过程折叠组外。这是对齐范围取舍，不是回归。
- 验证：定向 vitest 9 文件 exit 0（5.2s）；定向 eslint + `npx tsc -b --pretty false` exit 0（17.6s）。未跑全量 test/lint/build。

## workflow-inner-tool-parity（done，2026-10-19）

- Goal：workflow 展开体内的工具行、Agent 行与外部普通工具卡、sub-agent 卡保持同一套交互。
- 工具行：改为 `quickforge-local-tool` 的 `ToolDetails`。摘要是图标 + 名称 · 参数 + chevron + 状态/耗时；运行中隐藏状态并加 running sweep；点击展开 `input`/`output`，`run_command` 仍用控制台块。
- Agent 行：改为 `quickforge-subagent-tool` 整行按钮。Bot 图标 + 状态文案 · profile/工具次数/schema；运行中显示当前工具跑马灯并隐藏状态；点击打开 Inspector 运行详情。
- 删除内部专用的步骤 chevron、状态圆点、external-link 与「查看运行详情」按钮及其 CSS。
- 验证：定向 vitest 2 文件 14 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- 后续：工作流结果改为默认收起的 `<details>`，点击标题才展开。
- 后续：workflow Agent 详情对齐外部 subagent。运行中也写入有界 `subagentRun`；toolResult 保留 `details`（耗时、diff、命令状态）；详情 `detailed` 跟随当前工具显示模式，不再强制展开。
- Notes：未提交 Git；未手工修改生成产物。刷新前端后才会看到新行。

---

## goal-tool-card-display（done，2026-10-19）

- Goal：把 `get_goal`、`create_goal`、`update_goal` 从带边框的默认工具卡改为与 `goal_report` 一致的无边框只读折叠卡片。
- 实现：新增 `src/lib/goal-tool-history.ts` 与 `src/lib/tool-renderers/goal-tool-renderer.tsx`；`local-tools.ts` 导入时注册三个工具。摘要显示读取/创建/更新、动作、phase 和目标；展开显示目标、阶段、activation、轮次和阻塞原因。完整 JSON 仅详细模式可见。
- 边界：不改变 Goal 工具行为、权限、状态机或服务端返回结构，也不改 Goal 条带和 Inspector。卡片不提供操作按钮。
- 字号：`goal_report` 与 get/create/update goal 的展开结果统一为消息字号 ×0.8，和普通工具正文一致。
- 验证：`npx vitest run tests/frontend/goal-tool-renderer.test.ts` 11 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。运行中的前端需刷新后才会加载新卡片。

---

## goal-v2-event-sourced（done，2026-10-19）

- Goal：按 DSH 式持久状态骨架完整实施 Goal v2，同时保留 QuickForge 的只读规划、criteria、工具证据与服务端完成门禁；新目标默认 v2，旧 13 状态会话保留 legacy 引擎。
- 服务端：新增 `server/goal/{state,store,service,errors,prompts,report-tool,tools,authority,runner,engine}.mjs`。4 个持久 phase + 进程本地 armed/disarmed + 派生 runtime；`goal/change` 事件日志严格 fold 与 tombstone；全量 `{id,revision}` CAS；规划轮不占 execution round；`goal_report complete` 只写 `pendingCompletion`/`verifying`，runner 在正常轮末持久化后提交 `complete`；`get_goal`/`create_goal`/`update_goal` 对 v2 会话常驻，模型可从直接人类轮次自动创建/编辑/暂停/恢复（`server/goal/authority.mjs`），goal 轮完成仍走 `goal_report` 证据，直接人类可用 `update_goal complete` 强制完成。`agent-manager` 改注入 `goal/engine` 并 `await beginGoalRun`；`agent-persistence` 持久化 `goalEvents`/`goalEngine`；restore 保留 v2 active+disarmed，旧快照 `migrateLegacyGoal` 转换（failed/cancelled → tombstone）。
- 命令与设置：`/goal` 支持裸状态、`edit/pause/resume/clear`；动作命令不产生模型轮次。`goal-settings` 增加 `engine`（默认 v2），设置·常规页新增「Goal 引擎」选择；`QUICKFORGE_GOAL_ENGINE` 可覆盖。`tests/setup-goal-engine.mjs` 让历史测试默认 legacy，v2 专项测试显式 `goalEngine:'v2'`。
- 前端：`src/lib/goal.ts` 增加 `phase/activation/runtime/plan/maxRounds/roundsStarted/blockerInfo` 归一化与 v2 helpers；`goal-control-strip.ts` 对 v2 显示 phase/轮次与目标第二行、active+disarmed 显示“已中断”、complete 隐藏；`goal-card.ts` 与 Inspector/Summary 复用 v2 投影；i18n 中英新增 phase 文案；设置页与 normalizer 同步 engine。
- 验证：`npm run test` 388 文件 4672 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0。定向：v2 state/store/service 24 passed、v2 manager 6 passed（规划→执行、证据完成屏障、执行轮 update_goal complete、模型直接人类创建 goal、pause/resume/clear、重启 active+disarmed、active-disarmed resume）、legacy goal 7 文件 211 passed。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。v2 的 `failed/cancelled` 不再作为 phase，由 tombstone `lastRun.outcome` 表达；legacy 代码保留用于旧快照与设置回退。测试目录 `tests/setup-goal-engine.mjs` 默认 legacy 以保留历史契约。

---

## run-workflow-scripted-orchestration（done，2026-10-19）

- Goal：按用户要求以 workflow 模式为 QuickForge 增加接近 DSH workflow 的脚本化多 Agent 编排能力（`run_workflow`），并完成测试、文档与全量验证。
- 服务端新增：`server/agent-workflow-runner.mjs`（参数/预算校验、worker 生命周期、resourceLimits、总 deadline、父 signal 传播、有界 Agent 队列、agent 失败降级 `null`、TypeBox `Value.Check` JSON Schema 校验、details 构建与 100KB 文本裁剪、失败/超时/中止时 queued/running Agent 统一标记 `aborted`、已完成 Agent 摘要附加到错误正文）；`server/agent-workflow-worker.mjs`（worker_threads + vm guest bridge：hooks 在 guest 内创建，`args` 以 JSON 字符串进入并在 guest 内解析/深冻结，唯一 host 函数 `__hostCall` 为 null-prototype 且在用户脚本编译前删除，host 回复只以 JSON 字符串经 guest pump 投递；`console` 置空、`codeGeneration.strings/wasm` 关闭、同步段 10s、结果 `structuredClone` + `JSON.stringify` ≤1MB）。
- 复用与接线：`agent-subagent-runner.mjs` 新增 `runWorkflowSubagent`（命名 Profile、按步覆盖 model/预算、schema hint、trace/workReport 关闭）并抽取 `executeSubagentRun`，补 setup 期 abort 检查与审批 signal 绑定；`agent-manager.mjs` 增加 `wrapWorkflowToolDefinition`、`includeWorkflowTool`（Subagent/Profile 关闭）、默认权限审批分支、`afterToolCall` 注入失败 details；`tools/definitions.mjs` 增加 `workflowTool`；`approval-store.mjs` 纳入 `/plan` 与 `allowSubagents:false` 限制；`routes/tools.mjs` 禁止直接 REST；`system-prompt.mjs` 增加使用引导。
- 默认行为与安全：默认权限下启动前展示**完整脚本**（脚本上限 20KB）并审批一次，`effectiveConcurrency=1` 串行执行，避免前端单槽位审批卡被并发覆盖；完全访问才使用配置并发。风险说明明确“以服务进程权限运行本地 JavaScript”；worker 隔离仍是可终止性/纵深防御，不是 OS 沙箱，审批是信任边界。工作流 step 的 pending 审批额外监听步骤 signal，超时/中止立即 reject，不再等 5 分钟审批超时。
- 前端：新增 `src/lib/workflow-run-detail.ts`（状态/阶段/Agent/日志/计数/当前阶段/i18n key）、`workflow-tool-renderer.tsx`（摘要行 + 跑马灯 + 阶段分组 + 可点击步骤行 + 结果/脚本/错误 + preparing/无 details 终态错误回退）、注册/图标/标题刷新；i18n 中英 32 键；`index.css` 增加 `quickforge-workflow-*`（正文跟随消息字号、Agent 结果 6rem/结果 16rem 内滚、运行点动画 reduced-motion 关闭）；approval-card 增加 `runWorkflow` 标签、workflow 来源本地化徽标与风险说明。视图状态先判 `aborted` 再判 `result.isError`，用户停止不再显示为失败。
- 审查修复（workflow 模式的只读审查发现）：guest bridge 阻断 `agent.constructor` / `args.constructor` 等 host 原型逃逸（测试覆盖）；审批展示完整脚本而非 4000 字符预览；默认权限串行避免并发审批互相覆盖；超时/中止/孤儿 Agent 不再残留 `running`；setup 期 abort 与审批 signal 中止；无 details 的终态错误不再永久显示“正在准备”；details 总文本 100KB 裁剪；CSS 字号选择器修正；`schema:false` 与 schema hint；worker resourceLimits。
- 迭代②（tool() 工具步骤 + QuickForge 交互适配，2026-10-19）：新增 `server/agent-workflow-tools.mjs`，`tool(name, args?, options?)` 复用 `createServerTools` 的会话工具集（排除 subagent/workflow/ask_user/todo/memory/goal_report）、命令权限与 workspace 沙箱，默认权限下按 `safeReadTools`/Skill 免审批、其余走 `createApprovalPromise`（source `workflow-tool`，监听步骤 signal），写入归因父会话；拒绝 `run_command run_in_background`。Runner 将 Agent 与工具合并到同一有界步骤队列（`activeSteps`），新增 `maxTools`（默认 64/上限 128）、`toolCount`/`failedToolCount`/`tools` details 与 `seq` 提交序号；worker 新增 `tool` 协议与 guest hook；前端 `workflow-run-detail.ts` 归一工具、按 `seq` 交错 Agent/工具，`workflow-tool-renderer.tsx` 新增可点击步骤行：每个 Agent/工具行是独立 `<details>`（默认收起，点击摘要展开任务/参数与结果，chevron 旋转；run_command 结果用控制台块、其余用代码块），摘要行含工具图标/本地化名称/`summarizeParams`/状态/耗时；参数 JSON/脚本/原始 details 只在详细模式显示。CSS 适配 QuickForge 工具摘要交互（单行横滑/隐藏滚动条/H5 touch、消息字号、running sweep、aria-busy、focus-visible、reduced-motion），i18n 新增工具计数/参数/结果/任务键（中英共 32 键），审批卡 `workflow-tool` 显示 Workflow 徽标。`run_workflow` 与 `run_subagent` 一样不进入 process-folding 工具摘要组，保持顶层可点击卡片；新增 `workflow-step-interaction.test.ts` 用真实 React DOM 验证外层/步骤两级展开互不干扰。Agent 行新增 external-link 入口与展开体「查看运行详情」按钮，经 `workflow-subagent-detail.ts` 构建 `SubagentRunPayload` 并派发 `OPEN_SUBAGENT_RUN_EVENT`，进入 Workspace Inspector 的 Subagent 运行详情；runner 在 Agent 完成/失败时持久化有界 `subagentRun`（最近 40 条消息、tools、allowedTools、model/thinkingLevel，单 Agent≈6KB，超限标记 `subagentRunDropped`）。
- 文档：新增 `docs/architecture/workflow-orchestration.zh-CN.md`（背景、架构、hooks、限制、失败语义、安全模型、details/UI、测试清单），同步 `docs/wiki/README.md`、`server/README.md`、`server/tools/README.md`、`src/lib/README.md`、`src/components/README.md` 与根 `README.md`。
- 验证：本 feature 定向 9 文件 174 passed（workflow runner 26、approval orchestrator 23、subagent 集成 18（含真实 `tool("read_file")` 与 `run_in_background` 拒绝）、approval-store 16、definitions 22、workflow-renderer 13、approval-card 7、process-folding 48、workflow-step-interaction 1）；`npx tsc -b` 通过；`npm run lint` exit 0（仅既有 GitToolsPinnedSummary warning）；`npm run build` exit 0（既有 externalized/大 chunk warning）；`npm run test` 全量 388 文件 4675 passed / 2 skipped（exit 0，含同工作区已收敛的 Goal v2 改动）。
- Notes：未提交 Git。未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 仅正常重生成 `dist/`）。工作区既有未跟踪临时文件 `0`、`m[1])`、`new`、`{try{require.resolve('jsdom')` 未纳入。默认权限串行是产品取舍：并发审批需要前端多槽位队列，留作后续；完全访问不受影响。同一工作区存在并行 Goal v2/scheduled 改动（`server/goal/**`、`src/lib/goal.ts`、`goal-control-strip.ts`、`server/goal-settings.mjs`、`server/routes/scheduled-tasks.mjs` 等）；该并行改动已收敛，全量 4675 passed，本 feature 未触碰其文件。

---

## dead-code-cleanup-round3（done，2026-10-16）

- 目标：按死代码评审清理高置信度 A 区僵尸代码。
- 已清理：`runIcon`、`sliderProgressStyle`、`CHAT_SURFACE_REFRESH_EVENTS`；i18n 中英各删除 `displayLanguage`、`openLocalFile`、`execute`、`taskScheduleSavePreview`、`taskList`、`artifacts`；删除 capability-suggestions 专属 CSS 与 message-queue 死查询项；删除已确认无源码/测试消费者的 settings/context/project picker CSS。
- 复核保留：`server/session-state-service.mjs` 的 `readSessionIdentityRows` 是 `storage.mjs` 动态 facade 接口，不能删除；`quickforge-tool-message` 有 CSS 契约测试，不能按源码无创建方误删；K8 安全预留、B/C/D 灰色项未处理。
- 文档：Wiki `openLocalFile` 示例改为仍在使用的 `openLocalFileWithPath`；评审报告同步实际清理结果和误报修正。
- 验证：定向 vitest 6 文件 96 passed；`npx tsc --noEmit` 通过；`npm run lint` 通过（1 个既有 GitToolsPinnedSummary warning）；`npm run build` 通过；`git diff --check` 通过。
- 边界：工作区同时存在用户此前 channels-removal 等未提交改动，本次未覆盖或回滚；未提交。

---

## channels-removal（removed，2026-10-16）

- 目标：应用户要求**彻底移除**设置中的「渠道」功能（微信 weixin-acp bridge、渠道 API/SSE、sessions-changed 事件链、channelId/channelName 字段与渠道 Tab），且不影响 ACP、分享、通知、跨标签同步等其他功能。
- 用户确认的两个决策：sessions-changed 死链一并删除；存量渠道会话标题前缀（channelName）一并移除（旧会话标题退化为纯标题，持久化字段成为无主数据被读侧忽略，无需迁移）。
- 删除文件：server/channels/**（registry/process-channel/channel-logs/event-relay/providers/wechat）、server/routes/channels.mjs、src/components/settings/tabs/ChannelsSettingsTab.tsx、tests/server/channels/**、tests/server/routes/channels.test.mjs、tests/server/agent-manager.channel-{sync,source,events}.test.mjs、tests/server/acp/server-channel-source.test.mjs（共 15 个专用文件）。
- 服务端清理：server/index.mjs（import、/api/channels 路由分发、initializeChannels 启动、shutdownChannels 关停、openPathInFileManager 仅供渠道使用后移除 import）；routes/agent.mjs（channelEvents import、SSE sessions-changed 转发监听、会话摘要 channelId/channelName）；agent-manager.mjs（createAgent 参数、session 字段、restore 回填、恢复会话传参、listSessions 导出）；agent-persistence.mjs（event-relay import、字段解构、session data/metadata 落盘、ACP 渠道事件 fire-and-forget）；agent-session-queries.mjs（两处快照字段）；session-state-service.mjs（metadata→state 白名单）；acp/server.mjs（QUICKFORGE_ACP_CHANNEL_* 环境变量传参）；agent-goal-runner.mjs 注释措辞。
- 前端清理：settings-tabs.ts / react-settings-tabs.tsx / SettingsWorkspacePage.tsx（tab 定义、lazy、图标表 Share2 条目、STATE_PRESERVING_TAB_KEYS）；App.tsx（ChannelWorkspace/ChannelRefreshEvent/channelEventProjectId 类型与函数、handleSessionsChanged 订阅、externalProjectIds state 与 useSessionPagination 传参、标题栏 sessionTitle 第二参数、loadGlobalSessions 未使用解构）；useSessionPagination.ts（externalProjectIds 可选参数与 ref）；useAgentManager.ts（createAgent options 与 loadSession hints 字段）；types.ts（两个会话元数据类型字段、sessionTitle 签名简化为单参数）；server-agent.ts / server-agent-types.ts（config 字段、POST body 透传、快照字段、sessions-changed 提前 return）；global-agent-sse-client.ts（allowlist 项）；ChatSidebar.tsx（7 处）/ ArchivedConversationsSettingsTab.tsx（2 处）sessionTitle 第二参数；i18n.ts 中英各删 24 键（start/restart/channels*/channel*，**保留 stop**——MessageEditor 仍在用）；index.css 两处 .quickforge-channel-qr-text 规则。
- 测试清理：routes/agent.test.mjs 删 2 个渠道事件用例；agent.goal.test.mjs 删 registry mock；7 个 agent-manager/scheduled-tasks/slash-skill 测试删 event-relay mock；external-sync.test.mjs 删渠道事件发布用例；agent-goal-runner.test.mjs 用例名与来源列表去掉 channel；settings-workspace-react.test.ts（tab 数 17→16、en:channels、active 契约、生命周期守卫文件列表）；session-title.test.ts 重写（渠道前缀用例改为本地化用例）；server-agent.test.ts 删 channel sessions-changed forwarding describe。
- 文档清理：docs/wiki/README.md（Goal 拒绝来源措辞）、src/README.md（渠道页描述）、src/lib/README.md（tab 列表）、src/components/README.md（两处渠道标题展示规则）、server/README.md（目录树、channels/ 整节、启动链、ACP 渠道环境变量句、Goal 可用范围措辞）、server/routes/README.md（channels.mjs 行、/api/agents/events 转发说明、goal 来源措辞）。
- 保留（与渠道无关，勿回退）：ACP 全链（source:'acp'、qf acp、server/acp）、BroadcastChannel 跨标签（useCrossTabSync/cross-tab-events/provider-keys-cache，其 sessions-changed 是跨标签事件同名）、Electron IPC 通知通道、Android NotificationChannel、npm-runtime 更新 channel、sessionTitle 函数本体、stop i18n 键、Share2 import 的其余使用方。
- 验证：全仓 grep（git ls-files 限 src/server/tests/bin/scripts/desktop/docs/wiki）残留仅剩无关命中；npm run test 全量 381 文件 4595 passed / 2 skipped；npm run lint exit 0（仅 GitToolsPinnedSummary 既有 warning）；npm run build exit 0；npx tsc --noEmit 通过。

---

## dead-code-audit-round3（评审完成，未清理，2026-10-16）

- 目标：应用户要求全面评审僵尸代码（无引用代码 / 永远走不到的分支）。
- 方法：import 引用图（857 文件、四端入口 BFS、修复扫描器自身 @/ 别名解析缺陷）+ 2 个只读子任务（server 147 文件 AST 级、前端 302 文件标识符级）+ word-boundary grep 抽检复核，对照 round2 报告去重。
- 结论：0 僵尸文件（18 个静态不可达文件全为 preload/Worker/spawn/runbook 字符串或手动工具引用）；0 不可达分支（return 后语句、恒真假、重复条件、重复 case 双端零命中）；0 死 env 门控；0 context-eviction 残留；SSE/工具渲染器/自定义事件/BroadcastChannel 协议双向配对无孤儿。
- 僵尸清单曾沉淀至 `docs/reports/dead-code-candidates-2026-10-16.zh-CN.md`（该报告已随一次性评审文档清理删除，结论已并入本条目）：A 区零引用 8 组（readSessionIdentityRows 双定义、runIcon、sliderProgressStyle、CHAT_SURFACE_REFRESH_EVENTS、6 个 i18n 孤儿键（en+zh）、capability-suggestions CSS 组 + message-queue 死查询项、零散死 CSS 类；K8 安全预留保留）；B 区仅测试存活 27 项（最典型 3 个：cronMatches、revokeLanAccessToken、DEFAULT_AI_STREAM_DEADLINE_MS）；C 区导出冗余 ~114 项（本体存活，不建议动）；D 区 sqlite-compatibility-spike 归档候选。
- Notes：清理范围待用户决策（A / A+B前3 / A+B全部 / 暂不清理），本次未改任何产品代码；执行清理时需同步直测与 wiki。

---

## prefer-background-commands（done，2026-10-15）

- 目标：基础系统提示词中的命令运行规则从“可能超出当前回合才后台”改为“可行时优先后台运行”。
- 改动：`BASE_SYSTEM_PROMPT` 要求设置 `run_command run_in_background` 为 true；仍通过返回的输出文件读取结果，并禁止 `&`、`nohup`、`Start-Process`。
- 验证：`npx vitest run tests/server/system-prompt.test.mjs` 8 passed。
- 复审：2026-10-16 再次检查源码、测试、Wiki、入口和 Android 资产；精确渠道专用标识 0 残留，`npm run android:sync` 后旧 ChannelsSettingsTab bundle 已移除。修正 feature_list 中两处过期文件路径。保留项（BroadcastChannel、Electron IPC、npm-runtime、messages channel）均确认与渠道功能无关。

---

## agent-context-eviction-removal（removed，2026-10-14）

- 目标：应用户要求**彻底移除**「上下文主动遗忘（context eviction）」特性——实现不理想（模型重复裁剪、空转调用等观感问题，迭代⑤-⑧多轮修补仍未收敛）；移除后 auto-compaction、过程折叠、最终回复可见性修复等其余功能完全不受影响。
- 删除文件：server/context-eviction.mjs、src/lib/context-eviction-settings.ts、src/components/chat/surface/ContextEvictedBadge.tsx、src/lib/tool-renderers/context-eviction-tool-renderer.tsx、tests/server/context-eviction.test.mjs、tests/frontend/context-eviction-renderer.test.ts、docs/architecture/context-eviction-design.zh-CN.svg。
- 服务端清理：agent-manager.mjs（import、contextEvictionToolHandlers/wrapContextEvictionToolDefinition、createServerTools 注册块、beforeToolCall 免审批分支、refreshContextEvictionState 及调用、session 初始字段、restore/sync 字段、transformSessionContext 的 ensureMessageIds/投影/占比通知块——maybeAutoCompactSession 日志与 applyActiveCommandPrompt/applyActiveCapabilityPrompt 链路原样保留）；auto-compaction.mjs（sessionProjectionMessages 及 import、摘要源包装、估算缓存 key 的账本字段；estimateSessionContextUsage 其余行为不变）；agent-persistence.mjs（contextEviction 解构与落盘）；agent-session-queries.mjs（快照字段）；tools/definitions.mjs（三工具定义）；routes/tools.mjs（import、directRouteDisabledTools 三名、GET /api/tools 暴露）。agent-session-events.mjs 无 eviction 专属代码（其 767565c 改动为最终回复可见性修复，保留）。
- 前端清理：surface-context.ts（ContextEvictionEntriesContext/useContextEvictionEntries）；ChatSurface.tsx（evictedEntries 派生、sameMapItems、AgentSurfaceSnapshot 字段、Provider 包裹、SUBSCRIBED_EVENTS 的 context_eviction_updated）；ToolMessage.tsx / AssistantMessage.tsx 徽标接线；DefaultOptionsSettingsTab.tsx（开关行 UI、state/ref、加载/保存函数、import）；server-agent-types.ts / server-agent.ts（ServerAgentContextEviction 类型、快照映射、state 帧处理、case 'context_eviction_updated'、类型 re-export）；local-tools.ts / tool-renderers/index.ts / shared.tsx（渲染器注册、导出、三个专属 icon）；i18n.ts 中英各删 18 键（对称）。global-agent-sse-client.ts 无该事件注册，无需改动。
- 测试清理：删除两份专项测试；default-options-settings-react.test.ts 与 default-options-settings-tab.test.ts 仅删 context-eviction-settings 的 vi.mock；agent-session-events.test.mjs、server-agent.test.ts 中 767565c 增加的断言属最终回复可见性修复，**全部保留**；process-folding-final-reply.test.ts、thinking-final-reply-visibility.test.ts、server-agent-final-answer-recovery.test.ts、process-folding.ts 明确保留未动。
- 文档清理：docs/wiki/server/README.md 删 context-eviction.mjs 整节并去掉 auto-compaction 段的遗忘投影句；docs/wiki/server/routes/README.md、docs/wiki/src/components/README.md（两处）、docs/wiki/src/lib/README.md 同步删除。
- 遗留数据：旧会话 JSON 的 `contextEviction` 字段与 settings.json 的 `context-eviction-settings` 键不再被读取（无主数据），无害、无需迁移。
- 验证：全仓 grep（排除 node_modules/dist/package-dist/package-offline/.git）源码与测试零残留（仅 feature_list/progress/session-handoff 历史记录条目）；npm run test / lint / build 全部通过（详见 session-handoff）。

---

## fix-process-folding-source-empty（done，2026-10-13）

- 症状：工具调用→思考→最终回复时，最终回复渲染了但整行被隐藏（刷新才恢复）；仅 OpenAI 系 reasoning 形态触发（正文无流式 tick、紧跟 message_end）。
- 取证链：[sse-frame]（服务端）+ [sse-rx]（前端）帧流水日志证明发送/接收/数据合入全部正常；用户 DOM 检查定位 `quickforge-process-source-empty` class；jsdom 级折叠测试（分阶段/一次性/节点重建）先证明核心豁免逻辑无恙，最终场景 4 精确复现。
- 根因：`decorateProcessTurn` 流式期间（正文未到）为只剩 thinking 的 assistant 行打上 source-empty（CSS 隐藏整行，当时正确）；message_end 正文到达后 agent_end 装饰走 skip 短路（终答指纹排除后与 thinking-only 态匹配）且三条提前 return 路径（skip/update/空 nodes）全部跳过 `updateEmptyProcessSources` → empty 永不清除 → 正文随整行被隐藏。
- 修复：`src/components/chat/panel-decoration/process-folding.ts` 三处提前 return 前补 `updateEmptyProcessSources(assistants)`——skip 只跳过组重建，不跳过行级可见性维护。
- 验证：`tests/frontend/process-folding-final-reply.test.ts` 4 用例（含用户精确复现场景）全绿；mutation 验证（回退修复即红、恢复即绿）；折叠层 4 文件 79/79；eslint/build 通过；用户真机确认修复。
- 附带：两端帧流水取证日志保留（server/agent-session-events.mjs [sse-frame] + src/lib/global-agent-sse-client.ts [sse-rx]，仅关键帧），后续可按需移除。
- 顺带修正过时断言：tests/frontend/server-agent.test.ts「merges incremental message tails」同 id 断言改为「内容不同必须替换」（sameMessageShape 注释即此 bug 家族警告）。

---

## agent-context-eviction（done，2026-10-13）

- Goal：设置门控的 Agent 主动遗忘——对话记录完全保留，agent 运行时可自行把不需要的工具结果/旧回复裁剪出运行时上下文；每次请求向 agent 注入上下文占比（无 60% 门槛）；含 recall/report 工具与前端「已裁剪」标记（feature 1+2 一次完成）。
- 设计：存储与运行时视图分离的既有架构（transformContext 投影不回写）上叠加遗忘通道。① 会话级账本 `session.contextEviction`（按稳定消息 id，ensureMessageIds 在投影前兜底补 UUID；回滚后失配 id 惰性失效）② 工具族 `context_forget`（messageIds 精确 / rule 批量：kind+olderThanTurns+tools 过滤+except 豁免）/ `context_recall`（按 id 或 all 召回，账本移除即回上下文）/ `context_report`（完整可遗忘清单+账本摘要）；永不遗忘 user 与 compact summary；免审批、执行时双重校验设置 ③ 投影把命中消息替换为一行占位符（toolResult 保 toolCallId/toolName 配对；assistant 折叠 text/thinking 留 toolCall），`sessionProjectionMessages` 为同步共用投影（estimateSessionContextUsage 缓存 key 加账本、压缩摘要源跳过被忘内容）④ `buildContextUsageNotice` 每次请求注入瞬态 user `<system-reminder>`（不落存储）：恒含占比，≥40% 附 top3 清单与工具族用法。设置 `context-eviction-settings` 默认关闭（enabled + exemptRecentTurns 两项）；enabled 翻转经 refreshContextEvictionState（每次 runPrompt 前）重建工具集。前端：ServerAgent.state.contextEviction（state 帧 + context_eviction_updated 事件→广播 message_metadata_updated）、ChatSurface 快照派生 identity-stable evictedMessageIds 经 ContextEvictedIdsContext 下发、ToolMessage/AssistantMessage 剪刀徽标（卡外顶部，a11y 安全）、原文始终完整展示。
- 验证：context-eviction 29 passed；tests/server 全量 1919 passed / 2 skipped、仅 1 failed 属并行会话的 split-final-answer-delivery-cursor；eslint 改动文件通过；npm run build 仅挂该并行工作的 server-agent.ts:1483 类型错误，与本 feature 无关。
- 迭代⑧（通知减负：只留占比行，2026-10-13）：用户决定通知不再带账本计数与工具指引。`buildContextUsageNotice` 签名收敛为 `({ settings, usage })`（去掉 session / loopMessages 与 forgottenCount / forgettableCandidates 统计），通知只剩一行占比（`Context usage: X% of the N-token window (T tokens).`），删掉账本计数行与两条分支指引句（M>0 固定指引、M=0 止步句）；`settings?.enabled !== true` / 窗口缺失 / percent ≤ 0 仍返回 null；details 只含 percent/inputTokens/contextWindow；账本与投影行为不变（条数与清单改由 agent 自行调 context_report）。`server/agent-manager.mjs` transformSessionContext 调用点同步新签名与注释。测试通知契约重写（只报占比行 + 负向断言：无 Forgotten ledger / context_forget / context_report / frees space，details 只含三项；删除计数行与止步句用例）。文档：`docs/wiki/server/README.md` 占比通知段改写为「只注入一行占比（role=user 的 <system-reminder>，不落存储），不再附带计数行、清单或工具指引」；`docs/architecture/context-eviction-design.zh-CN.svg` ② 卡改「只有占比行 · 每轮都注入」、② 下方 note 改「只有占比行：无计数、无清单、无工具指引」、⑥ 改为「残留问题：模型自发重复调用（通知侧已实施修复，不再催促）」并把 ①④ 卡与根因/方向文字改为已实施+残留表述（xml.dom.minidom 解析通过）。验证：`npx vitest run tests/server/context-eviction.test.mjs` 30 passed；`npx eslint server/context-eviction.mjs server/agent-manager.mjs` 0 error 0 warning；grep 确认 server/ 与 tests/ 无残留 forgettableCandidates 与旧计数行/止步句文案（forgottenCount 仅存于 context_report details，供工具卡渲染）。
- 迭代⑦（状态感知占比通知，止住 forget 空转循环，2026-10-13）：用户反馈每轮都出现「N 条均已裁剪过」重复调用。根因：投影本身每轮都发裁剪后上下文（agent-manager transformSessionContext 先 sessionProjectionMessages 再发模型，无 bug），但 `buildContextUsageNotice` 是无状态的——恒注入同一句「context_forget frees space」，不告诉模型账本已裁完，模型每轮被催促、每轮空转调一次 forget。修复：通知增账本计数行（已裁 N 条（仅 live id）/ 剩余可裁 M 条，仅计数无清单，保持迭代④自主性设计）；M>0 附原固定指引；M=0 改明确止步句「All forgettable items are already trimmed — skip context_forget until new tool results or replies accumulate」；`context_forget` 结果「全部已裁剪过」文案同步附 call again only after new tool results accumulate；details 增 forgottenCount/forgettableCandidates。验证：context-eviction 32 passed（通知契约重写：计数行、账本计数不入清单、M=0 止步且不再含 frees space 指引）；eslint 改动文件通过。
- 迭代⑥（修复重复遗忘 + 工具卡下拉详情，2026-10-13）：① 服务端 `resolveForgetTargets` 接收账本 id 集——规则求值与显式 messageIds 中已入账 id 拆入 `alreadyForgotten`（数量 + `alreadyForgottenNow` 清单）单独上报，`forgotten`/`tokensFreed` 只统计本次新裁；content 文案区分「全部已裁剪过 / 规则无匹配 / 混合 no-change」，重复调用同一规则不再返回误导性的 forgotten:0；`forgottenNow` 逐项带 `{ id, kind, toolName, tokens }`，`context_recall` details 增 `recalledItems`（`{ id, kind, toolName }`）；工具描述补「重复调用安全」说明。② 前端 `ContextEvictionToolRenderer`：forget 摘要区分三种 0 语义（新裁剪 `contextForgetToolSummary` / 全部已裁剪过 `contextForgetToolAllForgotten` / 无新增裁剪 `contextForgetToolNone`，混合时追加 `contextForgetToolAlreadySuffix`）；展开体默认恒有明细区（forget 逐条 `#短id · 工具名/早期回复 · ~tokens`、recall 逐条、report 完整报告文本），detailed 模式再追加 input/details JSON；i18n 中英新增 7 键。验证：context-eviction 31 passed（新增重复规则/混合规则 2 用例）+ 新增 context-eviction-renderer 7 passed + i18n 快照 8 + local-tool-running-sweep 7；eslint 改动文件 0 error 0 warning；npx tsc -b 通过。
- 迭代⑤（工具卡渲染器 + 徽标 reason，2026-10-13）：① 三个工具获专属 icon（forget=剪刀/recall=回退箭头/report=柱状图，shared.tsx renderToolIcon）；② 新增 ContextEvictionToolRenderer（tool-renderers/context-eviction-tool-renderer.tsx，todo_write 同构折叠卡）：摘要行=icon+结果计数（已裁 {count} 条·释放 ~{tokens} tokens / 已召回 {count} 条 / 上下文报告·占用 {percent}%·已裁剪 {count} 条）+斜体 reason（来自 params，悬停全文）+状态/耗时；detailed 模式展开 input/details JSON；local-tools.ts 注册三个工具名，i18n 中英 6 键。③ 徽标升级：ContextEvictedIdsContext(Set)→ContextEvictionEntriesContext(Map id→entry 含 reason/kind/forgottenAt)，共享组件 ContextEvictedBadge.tsx（剪刀+文案+斜体 reason 截断+title 全文），ChatSurface 快照 evictedMessageIds→evictedEntries（新增 sameMapItems 保 identity-stable），ToolMessage/AssistantMessage 接线。验证：eslint 通过、i18n 对称测试通过、npm run build 通过、前端全量 2716 passed/1 failed（失败为并行会话 server-agent.ts 的 mergeIncrementalMessages id 语义回归，非本 feature，其测试注释「Message-id equality wins over content comparison」给出修复方向）。
- 迭代④（去通知清单，2026-10-13）：占比通知不再附带任何清单、无 ≥40% 触发阈值——恒为 `<system-reminder>` 包裹的占比行 + 一句固定工具指引（report 列清单/forget 释放/recall 恢复）；删 NOTICE_TOP_CONSUMERS/NOTICE_LIST_MIN_PERCENT 常量与候选计算，查什么/忘什么/何时忘完全由 agent 自主（需要清单时自己调 context_report）。29 个单测全绿（新增"高占比也不列清单"与"账本状态不影响通知格式"用例）。
- 迭代③（去轮次豁免，2026-10-13）：设置只剩 enabled 单开关；rule.olderThanTurns 降级为纯过滤参数（0/缺省=不限轮龄，clamp 0–100）；显式 messageIds 与占比清单同样不受轮次限制；仅保结构性保护——user 消息与 compact summary 永不可忘。同步：工具描述、前端设置 UI（删豁免数字项）、i18n、wiki、29 个单测（新增 olderThanTurns 0 与"仅保护对象时无候选"用例）。注意：迭代②曾补的"显式 id 过豁免下限检查"已按用户要求移除，其配套单测随语义一并移除。
- E2E 真机验证（2026-10-13 同会话）：用当前源码在 5199 端口起第二实例（真实数据目录），创建 eviction-e2e-test 会话跑 6 回合真实 LLM 会话——① GET /api/tools 门控双向：enabled→3 工具出现、disabled→消失 ② context_report 如实报占比/豁免窗口/候选 ③ 豁免下限：olderThanTurns 1 被 exempt 4 拦截（matched nothing）④ context_forget 规则 4 轮命中 2 条 toolResult，释放 ~14488 tokens，上下文占比 6.3%→1.9%，账本（含 reason/forgottenAt）持久化且消息原文完整 ⑤ context_recall all：账本清空、占比回升 6.4%。测试会话/工作区文件已清除，5199 实例已停。
- 顺带修复：显式 messageIds 遗忘未过豁免下限检查（与文案/规则路径不一致）——补 exempt 检查 + 2 个单测；handler settings 注入语义改为「传入即用、缺省读实时」（单测不再受真实 settings store 状态影响）。
- Notes：未提交。演进轨迹：① 去 60% 水位门槛→占比通知每请求恒注入 ② 并行会话补显式 id 豁免检查+E2E ③ 去轮次豁免→设置只剩 enabled 单开关（见上）。类型契约靠 vitest server-agent-events-types + tsc -b 兜住（根 npx tsc --noEmit 是 solution 空检查）；后台 vitest 非 TTY 输出被吞（既有）。用户 settings.json 已开启该特性（旧字段 exemptRecentTurns 已无意义、normalize 忽略）。工作区有并行会话的 split-final-answer-delivery-cursor 改动（agent-session-events.mjs deliveredMessageCount + server-agent.ts messagesSummary reconcile）：其"keeps the final answer in an end frame"测试失败（after=min(delivered,count)=3 空 tail，测试期望 after=2 保留末条）且 server-agent.ts:1483 messagesSummary 可选性类型错误连带 build 失败——非本 feature 引入、未触碰，待其作者收敛。

---

## split-final-answer-end-frame-gap（done，2026-10-13）

- Goal：回合已结束，最后总结仍偶发不出现。
- 根因：结束帧缺投递游标时回退到已保存条数，尾部为空；同一事件二次转换还会裁掉已补上的总结。
- 改动：缺游标从 0 取尾部；事件只转换一次。客户端发现条数缺口或最后一条原地替换时强制回读。
- 验证：事件、前端恢复、路由共 73 passed；eslint 通过。
- Notes：未提交。需要重启服务后验证。

---

## split-final-answer-delivery-cursor（done，2026-10-13）

- Goal：回合已结束但最后总结偶发缺失，刷新后才出现。
- 根因：持久化计数可能在结束帧发出前推进到最终条数；split 帧把该计数当作客户端游标，尾部变空。
- 改动：新增 `deliveredMessageCount`，结束帧按已投递与已持久化的较小值取尾部，再推进投递游标。
- 验证：事件、路由、持久化相关 109 passed；eslint 通过。
- Notes：未提交。

---

## release-v2.2.5（done，2026-10-13）

- Goal：发布 v2.2.5 小版本。
- 内容：后到最终答案不再折进收起过程组；工具卡文件名恢复点击预览；ResizeObserver 噪音降级与 summary 交互警告修复。
- 验证：test 388 文件 4606 passed / 2 skipped；lint exit 0（既有 useMemo warning）；build exit 0。tarball `package-offline/shawnstack-quickforge-2.2.5.tgz`，7.7MB / 549 files / shasum f6b0741484ec62d3fccdb86d69d395370d28cf17。
- Notes：npm publish 待用户执行。未跟踪 `new` 不纳入。

---

## late-final-answer-process-fold（done，2026-10-13）

- Goal：不断连时，最终答案偶发被收起的过程组藏住，刷新才出现。
- 根因：终答标记在流式阶段锁住当时最后一段文字；最终正文晚到后，旧标记仍优先，新正文被当成过程文本折进默认收起的组。
- 改动：过期终答标记立即清除；终答缺失或仍在过程组内时，跳过指纹短路并重装饰，让最新正文留在组外。
- 验证：process-folding 相关 4 个测试文件 80 passed；eslint 改动文件通过。
- Notes：未提交。未跑全量 test/build。

---

## tool-file-summary-span-click-preview（done，2026-10-10）

- Goal：恢复「点击工具卡文件名即预览」且不违反「summary 内禁嵌交互元素」规范（用户反馈上一 feature 后文件名无下划线、点击不跳转）；随后按用户要求去掉 write/edit/read 右侧眼睛按钮，文件名点击即唯一预览入口。
- 方案依据：HTML 规范与 DevTools 的 nested-interactive 警告针对的是 summary 内嵌**交互控件**（button / 带 href 的 a / role=button 等）；普通元素挂 click 不在禁止之列，且 span 无 role / tabindex 时在 a11y 树中不是交互控件、不会触发该警告。
- 改动：`renderToolFileSummary` 签名恢复 `(toolName, params)`，文件元素恒为静态 span——`resolvePreviewableArtifact` 有值时挂 `onClick` 复用 `previewArtifactClickHandler`（preventDefault + stopPropagation 阻断折叠后派发 `PREVIEW_ARTIFACT_EVENT`），恢复 `cursor-pointer` 与仅 basename 的 `hover:underline underline-offset-4` 暗示；不可预览路径仍纯静态。`renderPreviewButton` 收窄回仅 present_files（多文件摘要无法整体充当入口）。local-workspace-tool-renderer 调用传回 toolName；wiki shared.tsx 段同步。
- 验证：tool-renderer-file-icon 12 passed；连带 local-tool-running-sweep + tool-renderer-shared-state 共 35 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Notes：已随本条目一并提交（fix(chat) 提交）。取舍：write/edit/read 预览入口只剩文件名点击，span 不进 tab 序列，键盘/读屏用户不可达（用户明确要求去眼睛按钮）。span 不加 tabindex/role 是刻意的——加 tabindex 会把它变成 tab 序列内元素、加 role=button 又构成嵌套交互控件。

---

## summary-interactive-content-a11y（done，2026-10-10）

- Goal：消除 Chrome DevTools 的 18 个「Interactive element inside of a `<summary>` element」a11y 警告。
- 根因：write_file / edit_file / read_file 工具行摘要区的文件名元素整体是预览入口 `<button>`（renderToolFileSummary 可预览分支），嵌在折叠头 `<summary>` 内——HTML 规范禁止 summary 内嵌交互元素，每个文件读写工具行报一条，18 个即 18 个此类工具行。其余 summary（mcp/ask-user/goal-report/todo-write/默认卡/CodeBlock 菜单/context-compaction 等）排查均干净（button 都在展开区或 actions 区）。
- 改动：renderToolFileSummary 统一静态 span（去 button 分支、cursor-pointer、hover:underline；签名去 toolName 参数）；renderPreviewButton 扩展为 write/edit/read/present_files 共用右侧眼睛按钮（键盘可达，与 present_files 既有模式一致）；wiki shared.tsx 段同步。
- 验证：tool-renderer-file-icon 12 passed；连带 local-tool-running-sweep + diff-view + tool-renderer-shared-state 47 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Notes：未提交。UX 变化：点击文件名不再预览，预览改点 summary 右侧眼睛按钮（用户未答复方案确认，按推荐方案 A 执行）。

---

## resize-observer-noise-filter（done，2026-10-10）

- Goal：消除控制台被 `ResizeObserver loop completed with undelivered notifications` 刷屏，并修复 apple-mobile-web-app-capable 废弃警告。
- 根因：ResizeObserver loop 报错是浏览器单帧内多次派发尺寸回调的良性噪音（scroll-sync、跑马灯等多个观察器并发观察/改写同批元素时常触发），`main.tsx` 全局 error 入口一律按 error 级别输出导致刷屏；index.html 仅有 iOS 旧语法的 apple-mobile-web-app-capable，Chrome 要求补 mobile-web-app-capable。
- 改动：新增 `src/lib/error-noise.ts`（isResizeObserverLoopError：字符串/Error.message 匹配，普通对象不识别）；`main.tsx` error 与 unhandledrejection 入口命中降级 logger.debug（quickforge_debug=1 才可见），真实错误不变；`index.html` 补 `<meta name="mobile-web-app-capable" content="yes">`（保留 apple 版供 iOS Safari）。
- 验证：定向 vitest error-noise 9 passed；eslint 改动文件通过；npx tsc --noEmit 通过。wiki 已同步 src/lib/README.md。
- Notes：未提交。android/ 下两份 index.html 为 cap copy/gradle 产物未手工修改，下次 cap sync 从 dist 带入。Intervention「Images loaded lazily」为浏览器优化提示，非错误，未处理。

---

## release-v2.2.3（done，2026-10-10）

- Goal：按 patch-release-runbook 发布 v2.2.3 小版本。
- 内容：v2.2.3 = state 帧拉尾合入后补发 UI 通知（5df3037）。fix 提交与 release 提交分开。版本 2.2.2→2.2.3；CHANGELOG.md 新增 [2.2.3] 节；README.md 版本文案。
- 验证：npm run test 387 文件 4596 passed / 2 skipped（exit 0，较 v2.2.2 +3 即本次新增用例）；npm run lint exit 0（1 个既有 GitToolsPinnedSummary useMemo warning）；npm run build exit 0（既有 externalized/大 chunk warning）。tarball：package-offline/shawnstack-quickforge-2.2.3.tgz（7.7MB / 549 files / shasum c44eaa6e6ef711723083ed3d0962264cc73952aa）。
- Git：fix `5df3037` + `chore(release): v2.2.3` + tag `v2.2.3`，push origin dev v2.2.3。
- Notes：npm whoami 401 未登录，publish 待用户执行。后台 vitest 非 TTY 输出被吞（既有），硬门禁以前台复跑为准。未跟踪 new（0 字节）维持不纳入。

---

## state-frame-tail-merge-notify（done，2026-10-10）

- Goal：用户在最新代码（含 4c653cd 拉尾重试）上仍复现「聊天回复的最终答案偶发不可见，刷新才显示」，重新分析根因并修复。
- 根因（重分析）：state 帧驱动恢复的时序倒挂——SSE 断连吞掉收尾帧后，state 帧（split 会话只带 messagesSummary）到达时先**同步** emit agent_end（ChatSurface syncSnapshot 读到的还是旧列表，任务收尾 UI 全部完成），再**异步** reconcile 拉尾合入最终回答；而合入后的通知 finish() 只在 `markers && ...` 时广播（无 goal 的普通会话 markers 为 undefined，marker replay 对 undefined 原引用返回），merge 分支也不 emit → 合入零通知 → ChatSurface 靠 SUBSCRIBED_EVENTS 重渲染，此后再无事件 → 最终答案停留在内存不渲染，刷新重建 agent 才显示。对照：message_end/agent_end 的 summary 分支（finally forward）、watchdog /status 路径（await 后 emit）、非 split state 帧（合入即 notify）均正确，唯独 split state 帧路径漏发。4c653cd 只修了「数据拉不回来」，本条修「拉回来了 UI 不知道」，重试成功后同样缺通知，故症状仍在。
- 附带缺陷一并修复：① 拉尾只取一页不看 hasMore（服务端单页 500 上限），断连窗口丢 >500 条时最终答案在第 2 页永不显示；② 回滚场景全量重拉失败时 fetchAllSessionMessages 静默返回 []，走 all.length===0 分支静默 return 不重试。
- 改动：finish() 去掉 markers 前置（stateVersion 前进即广播 message_metadata_updated；marker replay 自行改写时先广播不双发）；hasMore 时整体重跑续拉下一页（每页重置重试预算）；fetchAllMessagesFromServer 失败显式返回 null 与真空（[]）区分，失败进退避重试、真空替换本地（模块级 fetchAllSessionMessages 的 restore/create 静默降级语义不变）。
- 验证：server-agent-final-answer-recovery 6 passed（新增 3 用例：合入后补发通知且晚于 agent_end / 跨页续拉 after=1→2 / 回滚全量重拉失败重试；主用例红灯验证——临时还原 markers 条件，收到的只有 ['agent_end'] 精确复现症状）；连带 server-agent + events + http 166 passed；eslint 改动文件通过；npx tsc --noEmit 通过。wiki 已同步。
- Notes：未提交。边界：state 帧 agent_end 发出时序未动（同步清 streaming/pending 语义保留，靠合入后补发通知闭环）；SSE 重连上限、watchdog、后端分页 limit 未动。下次发布随 patch 版本带出。

---



## transformer-learning-project（done，2026-10-10）

- Goal：按用户要求在 `learning/transformer/` 创建 Transformer 模型学习项目（用户确认方向：Transformer 模型；形式：笔记 + 可运行示例）。非产品 feature，不进入 feature_list.json（产品功能清单只收 QuickForge 功能；学习项目完全隔离于 learning/ 目录，不涉及产品代码、依赖与构建）。
- 内容：7 章中文笔记（notes/00-overview ~ 06-training-and-sampling）+ 6 个纯 NumPy 可运行示例（01 注意力含缩放/掩码/饱和实验、02 多头、03 正弦位置编码、04 Pre-LN Block、05 完整可训练字符级 mini GPT（604,571 参数，手写逐层反向 + Adam + 数值梯度检查 + 生成）、06 采样策略对比）+ 架构 SVG（assets/transformer-architecture.svg）+ README 导航。Python venv（.venv，Python 3.10.8 + numpy 2.2.6）。
- 验证：示例 01-06 全部运行通过；05 梯度检查（单元：LayerNorm/Linear/FFN/Attention/Block 全部 <1e-6；整体 <1e-4 含数值微分噪声），训练 500 步损失 3.32→0.32，生成对比正常；06 train/val 分叉清晰（0.37 vs 1.72）、六种采样策略与温度-熵表输出正常。开发中修复了 05 手写 softmax 反向的经典错误（逐元素 dp·p·(1-p) → 正确的行内联合公式 p·(dp−Σdp·p)）。
- 文件：learning/transformer/{README.md, requirements.txt, notes/×7, examples/×6, assets/×1, .venv/}；.gitignore 追加 `learning/**/.venv/`。
- Notes：未提交。v2.2.2 发布记录中「未跟踪 learning/ 来源不明」即本目录（用户此前要求的会话产物），本次正式落地内容。示例 5/6 训练耗时约 1.5~2.5 分钟/500 步（纯 CPU）。
- 迁移（2026-10-10 同会话）：应用户要求项目移出本仓库——robocopy 至 `D:\transformer-learning`（排除 .venv 后重建 venv + numpy，抽验示例 01/05 梯度检查通过，README 路径同步），经 `POST /api/project/path` 注册为 qf 项目（id f2cde6ee-1a05-41ea-9af0-f7b17e8e40a7，设为 active）；`learning/` 已从仓库删除，.gitignore 的 learning 条目已回滚。quickforge 仓库不再含学习项目代码。

---



## release-v2.2.2（done，2026-10-10）

- Goal：按 patch-release-runbook 发布 v2.2.2 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 内容：v2.2.2 = run_command 摘要 description 优先（793a739）+ SSE 断连后最终回答拉尾重试（4c653cd）。版本 2.2.1→2.2.2；CHANGELOG.md 新增 [2.2.2] 节；README.md 版本文案。
- 验证：npm run test 387 文件 4593 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 GitToolsPinnedSummary useMemo warning，2026-09-28 已记录）；npm run build exit 0（既有 externalized/大 chunk warning）。tarball：package-offline/shawnstack-quickforge-2.2.2.tgz（7.7MB / 549 files / shasum 336abea4bf25ee643e39fe5fc76d8dc0d4ad56b7）。
- Git：`b2cbe4d chore(release): v2.2.2` + tag `v2.2.2`，已 push（`git push origin dev v2.2.2`）。
- Notes：npm whoami 401 未登录，publish 待用户 `npm login` 后执行。后台首轮 vitest 输出被吞（非 TTY），为硬门禁可信前台复跑全量。工作区新增未跟踪 learning/（测试运行后出现，来源不明）与 new（0 字节），均未纳入提交，待用户确认处置。

---

## sse-reconnect-final-answer-recovery（done，2026-10-10）

- Goal：修复「长任务 final answer 偶发看不见、刷新才看到」。
- 根因：SSE 断连窗口（日志频发 Global scope request_socket_error；前端 ServerAgent 走全局流 /api/agents/events，重连后不重放事件）吞掉收尾的 message_end/agent_end 后，重连 state 帧（split 会话只带 messagesSummary.count）内联合成 agent_end（UI 停止转圈）并触发 /messages 拉尾；拉尾瞬时失败（fetchSessionMessagesPage 返回 null）时 `if (!isCurrent() || !page) return` 静默放弃、无重试，watchdog 已随 isStreaming=false 停止 → 最终回答永久缺失，刷新全量拉取才恢复。次要缺陷：state 帧 isStreaming=false 分支未清 streamingMessage（agent_end case 与 watchdog 路径都清了）。排除项：会话 idle 回收（600s）与 SSE 断连无关，运行中会重置；聊天 DOM 折叠链路（process-folding）静态推演自洽，非根因。
- 改动：reconcileMessagesFromSummary 拉尾失败按 MESSAGE_RECONCILE_RETRY_DELAYS_MS（1s→16s 共 5 次）退避整体重跑（重跑重新快照 stateVersion，更新事件补齐即自然放弃；count 追平空转），成功清定时器、耗尽 logger.warn 放弃，dispose 清理；case 'state' isStreaming=false 内联 agent_end 分支补清 streamingMessage 与三类 pending。
- 验证：server-agent-final-answer-recovery 3 passed（重试恢复/上限放弃/成功对照，先以红灯复现无重试断链后改写）；server-agent + server-agent-events + server-agent-http 连带 160 passed；eslint 改动文件通过；npx tsc --noEmit 通过。wiki 已同步 src/lib/README.md（拉尾重试契约 + 行数）。
- Notes：未提交。边界：SSE 断连本身、global SSE 重连 10 次上限、后端事件不重放、refetch-all 失败路径均未动；后端彻底不可达场景仍由 reconnect-notice + watchdog 兜底。

---

## run-command-description-first（done，2026-10-08）

- Goal：run_command 带 description 参数时，对话工具行摘要优先显示 Description，而不是原始命令。
- 改动：`summarizeParams` run_command 分支改为非空 description（空白折叠）优先、空缺回退 command；`local-workspace-tool-renderer.tsx` 摘要 title 在描述与命令并存时改为「描述\n命令」，命令悬停仍可达。子任务跑马灯复用同一函数自动生效。
- 验证：定向 vitest tool-param-summary + subagent-run-detail + local-tool-running-sweep 129 passed；eslint 改动文件通过；npm run build 通过（tsc -b 首轮报 title 类型错误，已用 summaryText 收窄修复）。
- Notes：未提交。Composer 后台命令菜单本就 description 优先（label=description、command 次行），本次未动。approval 卡的 summarizeToolArgs 仍显示命令，属审批流不在本次范围。wiki 已同步 src/lib/README.md 的 summarizeParams 契约。

---



## release-v2.2.1（done，2026-09-30）

- Goal：按 patch-release-runbook 发布 v2.2.1 小版本：版本递增、CHANGELOG/README 更新、全量验证、runtime/offline 包、Git commit/tag/push；npm publish 交用户。
- 门禁修复：全量 test 首轮 4 failed（2 个 server 为并发抖动，单独跑通过；2 个 frontend 稳定失败，均为 8119283 提交时测试与实现即不一致的历史遗留）。`isProcessToolsGroupMember` 补 `running !== false`（运行中后台命令不折叠、退出终态折回过程组，与 shared.tsx:49 / ToolMessage.tsx:160 同款判定）；subagent-running-indicator 后台命令测试断言改为独立触发器 `.quickforge-background-command-trigger`（在 leftControls 内）与 innerHTML badge 断言。
- 验证：`npm run test` 386 文件 4586 passed / 2 skipped（exit 0）；`npm run lint` exit 0（1 个既有 GitToolsPinnedSummary useMemo warning，2026-09-28 已记录）；`npm run build` exit 0（既有 externalized module / 大 chunk warning）。tarball：`package-offline/shawnstack-quickforge-2.2.1.tgz`（7.7MB / 549 files / shasum 23a3ce711f6e...）。
- Git：`68fa8621 fix(chat): 后台命令退出后可折回过程组，修正摘要触发器过期断言` + `cf7c27b4 chore(release): v2.2.1` + tag `v2.2.1`，已 push（`git push origin dev v2.2.1`，无历史 tag 误推）。
- Notes：npm whoami 401 未登录，publish 指令已交用户手动执行。发布中途一次 `git stash` + checkout 8119283 验证历史失败时被 shell 管道中断短暂 detached HEAD，已恢复 dev 并 stash pop，无改动丢失。docs/wiki 无需更新：isProcessToolsGroupMember 行为变化与既有「运行中后台命令不折进过程组」wiki 契约一致（退出终态本来就该折回）。

---



## local-path-link-trailing-text（done，2026-09-29）

- Goal：修复对话路径显示把文件地址后紧贴的文字一起识别进链接的问题。
- 根因：`local-file-path-links.ts` 绝对路径两条分支的尾部字符类 `[^\s"'<>\`]+` 只排空白/引号/尖括号/反引号，CJK 正文（含中文标点 `，` `。`）全被贪心吞进匹配；`trimTrailingPathPunctuation` 只能剥末尾标点，救不回中间正文。
- 改动：正则保持宽松召回（保住含 CJK 段的合法路径如 `D:\文档\说明.md`），新增 `resolveLocalFilePathCandidate` 解析终点——剥末尾标点后无 CJK 或以扩展名结尾直接接受；否则从左到右取第一个使剩余以扩展名结尾的 CJK 截断点（`D:\...\index.css后面还有文字` → `D:\...\index.css` + 正文回填）；无扩展名定位不了终点放弃链接（宁可不链接不吞正文，用户确认取舍）。相对路径分支扩展名尾部加 `(?![A-Za-z0-9])` 防 >8 位英文粘连截半（`foo.tsxabcdefghij` 整体不匹配）；≤8 位粘连（`foo.tsxand`）视为真实扩展名维持现状（本质歧义）。
- 验证：定向 vitest local-file-path-links 17 passed（新增 8 用例；红灯验证：临时还原旧行为 6 failed，失败信息即整串吞字症状）；decorator-copy-i18n + message-actions 连带 69 passed；eslint 改动文件通过；tsc --noEmit 通过。
- Notes：未提交。中文标点 `，` 不在正则排除集内，无扩展名路径后接「，再改 xxx」会先整体吞到空格、再因无有效截断点放弃，原文完整保留，符合「不吞正文」。wiki 同步 components/README.md 两份副本的 panel-decoration 细分列表（新增 local-file-path-links.ts 条目）。DESIGN_LANGUAGE.md 无需更新：纯识别逻辑修正，无视觉变化。

---

## background-command-idle-keepalive（done，2026-09-29）

- Goal：修复后台命令在会话空闲 10 分钟后被自动回收连带终止的问题。
- 根因：agent-manager `IDLE_TIMEOUT_MS`（10 分钟）到点即 `destroyAgent`，而 `destroyAgent` 会 `stopBackgroundCommandTasksForSession` 杀掉该会话全部运行中后台命令；SSE keep-alive 故意不重置该计时器，后台命令运行中也不保活，回合结束后约 10 分钟进程即被 taskkill。
- 改动：`resetIdleTimer` 回调增加豁免——`listBackgroundCommandTasks(sessionId)` 非空时仅重置计时器（与 goal waiter 同型）；最后一个命令退出经通知路径重置后按常规回收。显式销毁（删除会话/服务 shutdown）终止行为不变。新增 `tests/server/agent-manager.background-idle.test.mjs`：带后台命令的会话跨多个 10 分钟窗口存活 + 无后台命令对照组仍回收 + 命令退出后恢复回收 + 显式销毁仍终止命令。
- 验证：定向 vitest 2 passed；tests/server 全量 174 文件 passed；eslint 改动文件通过；npm run build 通过（chunk 警告既有）。
- Notes：未提交。既有行为未改：用户停止当前 run（abortRun → run signal abort）会终止该 run 内启动的后台命令（tools/index.mjs 的 abort 监听只随进程退出清理）；服务器 shutdown 仍终止全部后台命令。wiki 同步 server/README.md（冷会话操作段）与 server/tools/README.md（run_command 段）。

---



## chat-h5-no-horizontal-scrollbar（done，2026-09-28）

- Goal：H5 聊天消息区不再因过长内容在底部浮出横向滑动条。
- 根因：主滚动容器（qf-scroll-container）只有 overflow-y-auto，另一轴按 CSS 规范被计算为 auto；KaTeX 展示公式容器是裸 my-4 div（katex.min.css 无溢出处理），宽公式直接撑破消息列。
- 改动：主滚动容器加 overflow-x:hidden，只承担纵向滚动；展示公式容器挂 quickforge-katex-scroll（unlayered：公式块内横滑 + 隐藏滚动条 + touch 滑动）。
- 验证：定向 vitest：chat-surface-css-contract + chat-math 47 passed；npm run lint 通过。
- Notes：未提交。行内公式、mermaid/svg、表格、代码块既有溢出保护未动。lint 的 GitToolsPinnedSummary useMemo warning 为既有无关问题，未扩大范围修复。wiki 同步 src/README.md（KaTeX 段）与 components/README.md（scroll-sync 段两处）。

---

## tool-summary-no-ellipsis（done，2026-09-28）

- Goal：工具行长内容不再出现省略号，超长时横向滚动，并完成 build。
- 覆盖：run_command 72 字、generate_image 100 字、present_files 只显示 3 项、子任务跑马灯 80 字，以及工具标题 CSS ellipsis。
- 改动：摘要输出完整文本。工具行和子任务行横向滚动，H5 可触摸滑动，滚动条隐藏。
- 验证：定向 vitest 213 passed；npm run build 通过。
- Notes：展开区输出截断、附件名省略未改。未提交。

---

## run-command-summary-no-ellipsis（done，2026-09-28）

- Goal：run_command 摘要不再显示省略号，长命令可以滚完。
- 根因：摘要被硬截到 72 字并追加 …，父级 overflow:hidden 又裁掉剩余文字。
- 改动：显示完整命令。超长时摘要行横向滚动，H5 可触摸滑动，滚动条隐藏。
- 验证：定向 vitest：chat-surface-css-contract + local-tool-running-sweep 42 passed。
- Notes：未提交。子任务跑马灯截断未改。wiki 无需更新。

---

## edit-diff-long-line-scroll（done，2026-09-28）

- Goal：edit_file 长行在工具卡内可滚动，行背景不露底，H5 可触摸滑动。
- 改动：diff 块锁在列宽内。长代码行用 max-content 铺满背景，行号列 sticky。开启 touch 横滑和纵滑。
- 验证：定向 vitest：diff-view + chat-surface-css-contract 60 passed。
- Notes：未提交。wiki 无需更新，只是现有 diff 的溢出显示。

---

## tool-command-console-scroll（done，2026-09-28）

- Goal：run_command 命令内容特别长时可以滚动，且不要把文字显示成空白。
- 根因：控制台常驻左右渐隐，短行和未滚到的一侧也被遮掉。
- 改动：溢出侧只用内阴影提示，不用 mask 裁字。H5 开启 touch 横向/纵向滚动。内容未超出列宽时不提示。
- 验证：定向 vitest：tool-renderer-shared-state + chat-surface-css-contract 52 passed。
- Notes：未提交。wiki 无需更新，只是现有控制台的溢出显示。

---

## subagent-title-command-gap（done，2026-09-28）

- Goal：子任务输出很长时，标题和后面的命令显示不再中间空出一段。
- 根因：标题和命令跑马灯都是 `flex: 1`，剩余宽度被平分。
- 改动：标题改为按内容收缩，长标题才省略；命令继续吃剩余空间。
- 验证：定向 vitest：chat-surface-css-contract 36 passed。
- Notes：未提交。wiki 无需更新，只是现有摘要行的宽度分配。

---

## composer-console-fixed-width（done，2026-09-24）

- Goal：输入框旁控制台图标弹出的后台命令面板不再被长命令撑宽。
- 改动：菜单固定 `min(22.5rem, 视口)`。长命令在条目内横向滚动，左右高斯模糊渐隐。
- 验证：定向 vitest 11 passed。原有 1 个失败是后台命令单独触发器与旧断言不一致，与本次无关。
- Notes：未提交。wiki 无需更新，只是现有菜单的宽度约束。

---

## background-command-presence（done，2026-09-24）

- Goal：后台命令像 subagent 一样留在对话里，并出现在 Composer 运行摘要中，摘要项可直接关闭。
- 改动：运行中的后台命令不折进过程组。`backgroundCommands` 随会话状态、启动和退出事件同步。摘要列表合并后台命令，关闭按钮复用 abort-tool。退出后原工具结果替换为终态。
- 验证：定向 vitest 79 passed；eslint 与 tsc 通过。
- Notes：未提交。

---

## run-command-background（done，2026-09-24）

- Goal：`run_command` 支持 `run_in_background: true`，分离执行、不阻塞当前回合，跨回合运行到退出，并把完整输出写入日志后发 task-notification。
- 改动：后台命令 detached 启动后立即返回 `outputFile` 与 `taskId`；退出或终止后通知原会话。流式回合走 followUp，空闲回合直接 prompt，活跃 Goal 暂存。会话销毁会停止该会话仍在运行的后台命令。`read_file` 只额外放行命令日志绝对路径。工具卡在后台结果上保持运行态和终止按钮。
- 验证：定向 vitest 3 文件 31 passed；eslint 与 tsc 通过。
- Notes：未提交。后台任务不跨服务重启恢复。

---

## thinking-before-tool-order（done，2026-09-24）

- Goal：思考块先折走后，后续工具行无论追加在组后、插到组前，还是出现在另一条 assistant，第一轮思考仍排在工具前面。
- 根因：只信折走时的 `sourceNextSibling`。锚点还在但前面又插入了节点时，思考会被还原到工具后面，全量重建再按这个 DOM 序收集。
- 改动：失效锚点插回过程组之前；锚点前面的新节点改为插到这些节点之前。`orderRestoredProcessNodes` 再按来源 `message.content` 序号校正同一条 assistant 内的源序。
- 验证：折叠相关 74 passed；eslint 与 tsc 通过。
- Notes：未提交。

---

## android-cloud-removal（done，2026-09-24）

- Goal：移除安卓端已下线的 QuickForge Cloud 原生功能和页面残留。
- 改动：删除 `android/.../remote/` 云隧道源码与测试；取消 `RemoteTunnel` 插件注册、`RemoteTunnelService` 和仅供隧道使用的 WebRTC/OkHttp 依赖；导航白名单去掉云 API 地址。直连页与任务通知保留。
- Notes：前端云页面源码此前已不存在。`android/app/src/main/assets/public/` 仍是旧前端包，需下次 `android:sync` 覆盖。未跑 Android Gradle 构建。已提交。

---

## tool-file-underline-on-name（done，2026-09-23）

- Goal：编写/写入文件时，只有悬停到具体文件名才出下划线，悬停整块「已执行 / 编辑 / 写入」不再出。
- 根因：文件名用 `group-hover:underline`，而工具行 `details` 带 `group/tool`，悬停整行就会给文件名加下划线。
- 改动：文件名改为 `hover:underline`，按钮去掉 `group`。
- Notes：未提交。

---

## inspector-tab-fade（done，2026-09-23）

- Goal：多个 Tab 时变短、无中间分隔线，标题右侧高斯模糊/渐隐替代「…」。
- 改动：多于一个 Tab 在 `min-w-24` / `max-w-32` 之间均分，溢出整条横向滚动；去掉竖线。标题在关闭按钮左侧正常流里 mask 渐隐，文字不覆盖 X。下拉列表当前项与 hover 同色。
- 验证：见本次会话定向测试。
- Notes：未提交；未手工改生成产物。

---

## thinking-before-tool-order（done，2026-09-23）

- Goal：第一轮思考过程不再排到后面出现的工具调用下面。
- 根因：同一条 assistant 内容容器里，思考块先被折走时 `sourceNextSibling` 记成 null；工具行随后 append 进同一容器。全量重建的 `restoreGroupedProcessNode` 走 `append`，思考块落到工具行之后，再按这个顺序重新收集。
- 改动：锚点失效时插回仍在该容器内的过程组之前，不再 append 到容器末尾。有效锚点仍走 `insertBefore`。
- 验证：定向 vitest 5 文件 86 passed（含同容器思考→工具回归）；eslint 通过。
- Notes：未提交；未改生成产物。

---

## thinking-hint-hide-when-thinking-ends（done，2026-09-23）

- Goal：思考过程完成后，思考行右侧不再显示。
- 根因：`processThinkingHintSegment` 只看整条 assistant 的 `isStreaming`。思考写完后模型继续输出正文或工具时，消息仍在流式，右侧尾行提示一直留到 `message_end`。
- 改动：提示只在该思考段仍是 `content` 末块、仍在流式、且没有 `thinkingSignature` 时显示；思考一结束立即走既有淡出。
- 验证：thinking-hint / thinking-streaming-stage / thinking-hint-marquee-inplace 28 passed；process-folding / header-adoption / ownership 74 passed；eslint 通过。
- Notes：未提交；未改生成产物。

---

## stage-collapsed-no-round-flip（done，2026-09-23）

- Goal：用户反馈「工具调用列表默认展开 设置为关闭的时候，就不应该新的一轮消息来了之后展开又收缩反复这样操作，你实现的有问题」。只读定位后给出三种方案，用户选择方案 A：关闭设置 = 内层 stage 全程收起、不自动展开，正在流式的思考行（含尾行提示）改挂过程组 body。
- 根因：`process-folding.ts` 的 `updateProcessStageGroups` 用 `processStageDefaultExpanded() || processStageHasStreamingThinking(stageBody)` 作为 stage 默认值——只要 stage 内含流式思考行就强制展开（为的是不让收起态 `visibility:hidden` 藏住思考行与尾行提示）。但每轮工具调用结束（message_end：bridge isStreaming 翻 false + 工具行出现 → 结构变化 → 组全量重建）新 stage 元素回落到设置默认（收起），下一轮流式思考再把它顶开 → 第 2 轮起逐轮「展开 → 收起」往复。
- 改动：
  1. `src/components/chat/panel-decoration/process-folding.ts`：新增 `processThinkingAssistant`（思考块来源 assistant：processThinkingSources → processNodeOwners → closest assistant bridge）与 `isStreamingThinkingItem`；导出纯函数 `splitStreamingThinkingRuns`（按位置把段内项切成交替 run：liveThinking 挂组 body、其余照常包 stage，保持原顺序——toolCall chunk 先于 message_end 出现时流式思考行也可能夹在工具行之前，故不只抽段尾）；`populateProcessGroup` 仅在设置关闭（`!processStageDefaultExpanded()`）时切分；`updateProcessStageGroups` 的默认值回归纯 `processStageDefaultExpanded()`，删除 `processStageHasStreamingThinking` 与强制展开。
  2. 测试：`thinking-streaming-stage.test.ts` 改写 S2（设置关闭：stage 收起 + 思考行挂组 body + hint 仍 running）、「流式结束收进 stage」、跨 assistant 用例的开合预期、手动收起用例（改用默认展开设置）；新增多轮工具循环往复回归用例；`process-folding.test.ts` 新增 `splitStreamingThinkingRuns` 单测（含夹在工具行之前的形态）。
  3. 文档：`docs/wiki/src/components/README.md`（两份副本）与 `docs/wiki/src/lib/README.md` 的折叠默认值契约改为新规则。
- 验证 / Evidence：定向 vitest 3 文件 61 passed；连带（thinking-hint / thinking-header-adoption / process-folding-ownership 等）6 文件 104 passed；`tests/frontend` 全量 210 文件 2674 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 大小警告既有）；`npm run test` 全量 382 文件 4561 passed / 1 skipped（无失败）。
- Notes：设置默认展开（默认 true）时结构与行为零变化（切分只在关闭时启用）；saved state（用户手动开合）语义、group 默认展开、`appendProcessToolSuffix` 增量与轮指纹、release gate / reading-intent / 滚动时序均未动；观感取舍（用户确认）：本轮思考结束后该思考行随重建收进已收起的 stage（即行消失），但不再有自动开合；无依赖变更；未触碰 dist/package-dist/package-offline；改动未提交（工作区同时有并行会话 thinking-hint-growth-inplace 的改动，同文件不同函数，互不影响）。

---

## compaction-boundary-visible-at-tail（done，2026-09-23）

- Goal：用户要求「压缩时候如果是最新一轮，应该先显示压缩的摘要横线，用户再发送消息」——不要发完消息才知道被压缩。
- 根因：`src/components/chat/panel-decoration/context-compaction.ts` 的 `syncContextCompactionNotice` 以 `compactedUpToIndex >= windowEnd` 判定不渲染并移除横线。自动压缩默认 `keepRecentTurns: 0`（`tailStartForRecentTurns` 直接返回 `source.length`），压缩边界 = 消息总数，恰好等于窗口末尾（压缩覆盖到最新一轮、边界之后没有消息）→ 横线被移除；用户必须再发一条消息让 `messages.length` 超过边界，条件翻成 `<` 才显示。压缩完成时 decorate 已由 `auto_compact_completed` / `messages_replaced` 触发（ChatPanelHost.tsx:1713-1731），所以唯一阻塞就是这个隐藏条件。
- 改动：
  1. `context-compaction.ts`：隐藏条件收紧为 `compactedUpToIndex > windowEnd`（严格越过窗口末尾 = 回滚后消息变短等陈旧状态，仍隐藏）；`alignBoundaryToUserTurn` 补注释说明边界可正好落在列表末尾、回溯到最后一个用户回合的定位与随后追加消息时一致。
  2. `tests/frontend/context-compaction-notice.test.ts`：新增 3 用例（边界 = 窗口末尾显示在最后一个用户回合之前 / 回复追加后横线位置不变 / 窗口化 `messageIndexOffset` 下边界 = 窗口末尾显示）；原「边界越过窗口末尾隐藏」用例保留。
- 时序依据：服务端压缩只发生在新一轮首条 LLM 调用前（pi-agent-core 先 `message_end(prompt)` 提交本轮 user 消息，再 `transformContext` → `maybeAutoCompactSession`），因此边界对齐到的正是本轮用户消息——横线在压缩完成那一刻出现在它上方，与随后回复提交后的位置完全相同，无跳动；重新打开已全量压缩的会话也直接显示。
- 验证 / Evidence：定向 vitest `context-compaction-notice` 7 passed（含新增 3 例）+ 连带 4 文件 52 passed；旧实现红灯验证 2 failed / 5 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 大小警告既有）；`npx vitest run` 全量 382 文件 4556 passed / 1 skipped（无失败）。
- Notes：只改可见性判断与注释——未动服务端压缩链、`insertBeforeMessageElement`/`alignBoundaryToUserTurn` 定位规则、`windowed-messages` 窗口语义与 release gate；未引入新视觉模式，`DESIGN_LANGUAGE.md` 无需更新；`docs/wiki` 的 panel-decoration 条目只列模块名、无该条件的契约描述，模块职责/公共入口未变，故无需更新（原因记于此）；无依赖变更；未手工修改生成产物（仅验证用 `npm run build` 重新生成 `dist/`）；改动未提交。
- Notes（遗留）：`settings-row-infotip` 仍为 pending，WIP 不在本轮。

---

## thinking-hint-growth-inplace（done，2026-09-23）

- Goal：用户反馈「对话中思考过程中的右侧显示会一句话重复显示两次，我不希望这样」→ 确认位置为思考行右侧尾行提示（hint），按方案 A 修复：只在行切换时整行滚入，同一行内增长就地更新。
- 根因（有复现证据）：hint 是 header 第四槽位 `quickforge-tool-marquee`，其 `ToolMarqueeController` 对任何 text 变化都 `beginRoll`（旧文上滚出 + 新文下滚入，两视图各含 static span，滚入期间同时可见）；装饰层 `syncProcessThinkingHint` 对「同一行内增长」在 300ms 节流窗后同样写 `text`（只是不重触发淡入），于是 260ms 滚入被每 ~300ms 反复触发，两个视图长期同显、内容又是同一句（只差几个字）＝同一句上下两份。用控制器直接跑序列复现：`grow v0[VIS/s=句子A] v1[VIS/s=句子A-grow]`。
- 改动：
  1. `src/lib/tool-marquee.ts`：`sync(text, running, restart = false, roll = true)` 新增 roll 开关，`roll=false` 时 text 变化走 `applyInstant`（就地更新 + 另一视图保持隐藏 + 按既有语义重建横向循环），默认 true 不动 subagent 摘要卡契约。
  2. `src/lib/tool-renderers/shared.tsx`：`QuickForgeToolMarquee` 增 observedAttributes `roll`，`attributeChangedCallback('roll')` 只记录意图（`rollOnChange`，默认 true、connectedCallback 复位），`sync()` 一次性消费并透传第四参；`scheduleRestart` 统一 `sync(true)`。
  3. `src/components/chat/panel-decoration/process-folding.ts`：`syncProcessThinkingHint` 在 textChanged 分支先写 `roll`（`lineSwitched ? 'true' : 'false'`）再写 `text`；标记每次随 text 必写（元素消费后复位，值比较跳过写会丢标记→行切换被误判成就地更新）。
  4. 文档：`DESIGN_LANGUAGE.md` 思考尾行提示条目、`docs/wiki/src/components/README.md` 思考头接管契约两份副本、`docs/wiki/src/lib/README.md` 的 `tool-marquee.ts` 条目。
- 测试：`tool-marquee.test.ts` +2（同行增长就地更新且行切换仍滚入 / 元素 roll 意图透传与一次性消费；原 wiring 两处断言随新签名补 `false, true`）、`thinking-hint.test.ts` +1（roll 意图：增长 false、行切换 true、流式结束清空）、新增 `tests/frontend/thinking-hint-marquee-inplace.test.ts`（jsdom 全链路：真 React `ThinkingBlock` → `decorateProcessThinkingBlocks` → 真 `quickforge-tool-marquee` 元素 → ToolMarqueeController，桩 `Element.prototype.animate` 观察滚入；断言同行增长零纵向滚入 + 恰好一个可见视图 + 文本就地追平、行切换仍两次滚入动画且视图摆位正确、流式结束淡出）。
- 验证 / Evidence：定向 vitest tool-marquee 17 passed、thinking-hint 16 passed、新 jsdom 全链路 1 passed、思考/折叠/跑马灯/接管相关 7 文件 133 passed；**旧实现红灯验证**（临时把 roll 恒写 `'true'`）新用例在症状级断言失败 `expected 0 to have length 2`（同行增长仍触发两次整行滚入），thinking-hint 新用例同时失败，改回后全绿；`npx tsc --noEmit` 通过；`npx eslint`（src + 新测试）通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 383 文件 4562 passed / 1 skipped。
- Notes：
  - 上一轮全量中失败的 `tests/server/session-state-repository.test.mjs`（multi-process CAS writer 时序用例）本轮全量通过，确认为并发负载下的 flaky，与本改动无关。
  - 同行增长走就地更新后，横向跑马灯在增长期间会随每次 text 变化重建（与修复前每次滚入结算后 `scheduleHorizontal(..., true)` 的净效果一致：增长停止 400ms 后恢复滚动），长行溢出滚动不因此丢失。
  - 行切换的滚入、淡入（`hint-in`）、300ms 节流、取段规则、release gate 与思考头接管契约均未改动；无依赖变更；未触碰 dist/package-dist/package-offline；改动未提交。

---

## streaming-display-stability（done，2026-09-23）

- Goal：用户明确目标「不希望有展开态闪帧、执行中突然闪烁或重新加载，期望稳定增量显示」。基于只读审查（P1/P2/R1）全量修复，方案经用户确认（P1+P2+R1 全修；R1 选稳定 key 避免提升重挂载）。
- 修复内容：
  1. **P1 展开后视口被拉回底部**（「展开 stage 滚动跳/重新展开感」滚动侧根因）：`scroll-sync.ts` 新增 `READING_INTENT_EVENT`('quickforge:reading-intent') + `emitReadingIntent(target)`（dispatchEvent 存在才派发，兼容 node-env fake 宿主；CustomEvent 浏览器与 node 全局均可用已验证）；`setup()` 在 panel 上监听并 `disableAutoScroll()`，`cleanup()` 摘除。发射端：`process-folding.ts` group `toggleExpanded` / stage `onclick` 从开关元素冒泡；`ThinkingBlock.tsx` pointerdown 与键盘 click（detail===0）路径 `emitReadingIntent(event.currentTarget)`。跟随解除后按既有语义滚回距底 <10px 重挂（复用 disableAutoScroll，无新滚动模式）。
  2. **P2 替换路径一帧「已释放未重折叠」**：删除 `ChatPanelHost` 事件回调中的 `releaseStreamingProcessGroups(panel)` 预释放（1711）与 import；结构性释放全归 `ProcessGroupReleaseBoundary`（同提交释放 + `componentDidUpdate` 同步重折叠）；服务端 `auto_compact_completed` 必跟 `messages_replaced`（server/auto-compaction.mjs:274-288）保证结构提交必经 boundary；原两次 decorate rAF 兜底保留。`releaseStreamingProcessGroups` 无生产调用后随删除（process-folding.ts + panel-decoration.ts 桶导出），thinking-streaming-stage 测试 3 处改用 `releaseProcessGroups`（boundary 语义）。
  3. **R1 提升整树重挂载**：`ChatPanelHost` 新增 `agentRuntimeScopeId?: string` prop，ChatSurface key 改 `agentRuntimeScopeId ?? agent.sessionId`；`App.tsx` 传 `agentManager.currentRuntimeScopeId`。提升时 runtimeScopeId 保持 `pending-*`（useAgentManager.attachTaskToView(task, previousAgent.sessionId) 既有行为）→ 同 key 原地更新，乐观用户行 DOM 保留（readAgentSnapshot 身份复用使 MessageArea memo bail、零 DOM 写）；会话切换 runtimeScopeId=目标 sessionId → 仍整树重建；分享页/侧聊未传 prop → 回退 sessionId 语义不变。
- 改动文件：见 feature_list.json 本条目（6 源码 + 5 测试 + wiki + 3 状态文件；新增 tests/frontend/chat-surface-agent-swap.test.ts）。
- 验证 / Evidence：定向 vitest 17 文件 272 passed（scroll-sync 19 含 reading-intent 3 新例、thinking-block-interaction 4 含 emit 1 新例、thinking-streaming-stage 12 含 stage/group emit 2 新例、chat-surface-agent-swap 2（jsdom：行 DOM 身份保留 + 提升后事件跟随）、behavior-alignment 10 含稳定 key / 无预释放 2 新契约、ownership/release-refold/streaming-handoff 回归 26、扩大面 203）；npx eslint（改动文件）通过；npx tsc --noEmit 通过；npm run lint 通过；npm run build 通过（chunk 警告既有）；npm run test 全量 382 文件 4553 passed / 1 skipped（本轮 4 个此前 dev 基线失败的 server 测试亦通过）。
- Notes：
  - 展开即解除跟随是「阅读意图」语义：解除后不再跟随流式尾部（回到底部按钮可返回，滚回 <10px 自动重挂）——与 turn-navigation 的 beginProgrammaticScroll 先例一致的取舍。
  - R1 依赖的既有时序（realAgent.prompt 在 React 刷新前同步乐观插入用户消息）未改动；jsdom agent-swap 测试已把「同 key 换 agent 不 remount、行 DOM 保留」固化为回归。
  - 子代理 trace（SubagentRunDetailContent 内的展开件）未接 reading-intent 事件（当前无用户反馈指向它）；如真机仍有该场景跳动，同模式补发即可。
  - 既有失败登记（与本次无关，dev 基线即失败）：tests/server/sqlite-quick-check-gate.test.mjs（1）、tests/server/acp/server-channel-source.test.mjs（1）、server.workspace-mapping.test.mjs（2）。
  - settings-row-infotip 仍为 pending，WIP 不在本轮。

---

## message-end-inplace-commit（done，2026-09-23）

- Goal：在新分支 `fix/message-end-remount-flicker` 上根治「思考过程结束后对话刷一下」——消除 message_end 时流式消息跨 React 子树的 unmount/remount（用户选定完整版：流式行进 MessageList + release gate 改渲染序列比较）。
- **三轮修复（用户反馈「展开 stage 时特定节点滚动跳/重新展开感」）**：工具循环的三个释放源已全部消除——(a) toolResult upsert（不可渲染行，不参与 gate 序列）；(b) message_end 同身份转正（同 key，序列不变）；(c) 下一轮流式 assistant 行出现（**纯尾部追加**，前缀匹配放行：React 只在列表尾 appendChild，已有行 memo bail 零 DOM 写，折叠组节点不受触碰）。至此工具循环全程（思考→工具→结果→下一轮）折叠组**零释放零重建**，仅 update/增量路径运行。剩余已知释放点：行删除/重排/身份替换（rollback、compaction、messages_replaced——低频且必要）。已排除的候选：stageKey 振荡（processTurnStateKey 以 turnIndex+首 assistant timestamp 构成，轮内稳定，saved 展开状态不失效；expandProcessStageByDefault 默认 true）；scrollToBottom 双 rAF 与 ≤1px 守卫；hint/stageLabel 均已值守卫。若真机仍有抖动，下一步用调试脚本（见 Next Session）捕获 scrollTop/scrollHeight 跳变序列定位滚动侧根因（候选：贴底跟随与展开阅读冲突、或装饰层 rAF 与 scrollToBottom rAF 的帧内顺序）。
- 根因：`ChatSurface` 双容器结构（MessageList 完成消息 + `.qf-streaming-message` 流式消息）。`message_end` 时 `streamingMessage` 清空、消息 upsert 进 `messages`，流式容器内整棵 AssistantMessage unmount，同一条消息以全新 DOM 挂进 MessageList（代码注释明言 "an unmount/remount"）。可见后果：展开的思考块 `isExpanded` 弹回收起、代码高亮/图片/动画重置、装饰层重建折叠组并 reparent 节点（重启 animate-spin）。此前 4 个 flicker feature 只能同帧压制，结构性迁移仍在。
- 关键可行性事实（已验证源码）：pi-ai 流式 partial 与 final 是同一 `output` 对象（`timestamp: Date.now()` 流开始一次赋值、`result()` 返回同一对象），agent-manager 原样透传 → 流式行与提交行 `messageRenderIdentity` 恒同；光标 span 本就被 CSS 隐藏（streaming 时 `display:none`、容器只有光标时整容器隐藏），AssistantMessage 移走后容器恒自隐藏、无观感变化。
- 改动：
  1. `MessageList.tsx`：新增 `streamingAssistant` prop，流式 partial 渲染为列表最后一行（key=`messageRenderIdentity`、Provider 只包该行、`hidePendingToolCalls`）；已完成行照旧 memo bail out，流式帧成本与旧结构等价。
  2. `ChatSurface.tsx`：流式容器只剩光标锚点；`MessageArea` 构造渲染序列（messages + 流式行）交给 boundary；`ProcessGroupReleaseGate` 删除 `isStreaming`/`streamingAssistant` 字段，`shouldReleaseProcessGroups` 收敛为纯序列 key 比较；清理未用导入/props（toolResultsById、AssistantMessage、AssistantStreamingContext、useMemo、collectToolResultsById）。
  3. `message-actions.ts`：`getStreamingAssistantMessage` 改为在 `.qf-message-list` 内按 bridge `isStreaming === true` 从尾部定位流式行；`getMessageElements` 过滤流式行（行级装饰职责与旧结构等价，避免流式行被收集两次/误入行级装饰）。
  4. `surface-context.ts`：Provider 位置注释更新。
  5. 测试：release-gate（message_end 同身份不释放 / abort 清空释放 / 纯流式帧序列形式）、release-refold（同上场景 + 新增 message_end 转正跳过用例）、process-folding-ownership（同上 + 新增 DOM 级「转正折叠组完好」用例）、behavior-alignment（源码断言改为 MessageList 内 Provider）、chat-surface-render 新增「流式行在列表内、光标容器之前」用例。
  6. `docs/wiki/src/components/README.md`：MessageList 构建规则 + process-folding gate 语义两处条目（各有两处副本，已同步）。
- 验证 / Evidence：定向 vitest 全绿（chat-surface 39、process-folding 系 70、message-actions/context-compaction 49、thinking/code-block/subagent 148）；`npm run test` 全量 4530 passed / 4 failed，4 个失败（sqlite-quick-check-gate 1 + acp 3）经 `git stash` 基线对比确认 dev 上同样失败、与本次无关；`npm run lint`、`npx tsc --noEmit`、`npm run build` 全部通过。
- Notes：
  - 同 timestamp 重复 assistant 行的 key 撞车（agent-loop 不产生）：四轮起由 `messageRenderKeys` 的 occurrence suffix 在合并 key 数组上消歧，不再撞 key。
  - `message_end` 帧仍有 React 局部 DOM 变化（usage 行出现、shimmer 类切换、光标容器卸载）——均为节点内部更新，折叠组不持有、零搬移；这是与旧「整行销毁重建」的本质区别。
  - 既有失败登记：tests/server/sqlite-quick-check-gate.test.mjs（1）、tests/server/acp/server-channel-source.test.mjs（1）、tests/server/acp/server.workspace-mapping.test.mjs（2）在 dev 基线即失败，待后续单独排查。
  - 分支 `fix/message-end-remount-flicker`（自 dev b633016 切出）已提交 `04be17f`、`--no-ff` 合并进 dev（`b9d6656`）并推送 origin/dev；未修改生成产物；依赖仅四轮新增 devDependency `jsdom`（package.json/package-lock.json 同步）。
- **四轮修复（代码评审 P1/P2，2026-09-23）**：
  - P1（高）：「同 key 就地转正」实际未生效——流式行外层 `AssistantStreamingContext.Provider`（元素类型前后不一致）与 `items.map` 之后的独立 JSX slot（隐式 index-keyed 子节点、独立 reconcile scope）都会让 `message_end` remount 整行。修复：`MessageList` 把已提交行与流式行推进同一个 `rows` 数组（`rows.push`），key 由合并数组 `[...messages, streamingAssistant]` 经 `messageRenderKeys` 一次计算；Provider 移入 `AssistantMessage` 内部（`surfaceStreaming || isStreaming`，subagent trace 整树语义不变），行元素类型前后一致。
  - P2（低）：流式行 key 原用裸 `messageRenderIdentity`，同 timestamp 撞车时与已提交行重复 key；合并 key 数组后由 occurrence suffix 消歧且两态一致。
  - 新增 `tests/frontend/chat-surface-streaming-handoff.test.ts`（`// @vitest-environment jsdom` + react-dom/client 真实生命周期：DOM 节点身份断言就地转正 / 身份变更仍 remount / 重复身份不撞 key）；旧实现红灯验证 2 failed + control 1 passed。`tests/frontend/chat-surface-behavior-alignment.test.ts` 源码契约随新结构更新。
  - 依赖变更：新增 devDependency `jsdom`（本轮唯一依赖变更）——真实 React reconciliation 回归测试需要 DOM 渲染器，原 Node-only 测试栈（renderToStaticMarkup + 源码断言）无法断言 remount（P1 正是因此漏过）。
  - 验证 / Evidence（四轮）：定向 vitest 7 文件 83 passed（streaming-handoff 3 + behavior-alignment 8 + render 17 + message-list 19 + release-gate 13 + release-refold 5 + ownership 18）；旧实现红灯验证 2 failed + control 1 passed（证明新用例确实能抓住 remount/重复 key 回归）；npm run test 全量 381 文件 4536 passed / 4 failed / 4 skipped——4 个失败为 dev 既有基线（sqlite-quick-check-gate 1 + acp 3，上方 Notes 已登记，与本轮无关）；npm run lint 通过；npm run build 通过（chunk 警告既有）。

---

## plugins-page-visual-polish（done，2026-09-23）

- Goal：优化「设置 → 插件」界面样式——用户选择「视觉微调 + 工具列表展示（同 MCP 卡片：最多 12 个 + 省略）」。
- 现状问题：列表项只显示名称+描述+开关且用 `--column` 变体包一层冗余 header；插件 tools 数据完全不展示；开关无 aria-label；空状态搜索路径 chips 平铺、长路径换行不齐。
- 改动：
  1. `src/components/plugins/PluginsPage.tsx`：提取导出 `PluginListItem`（结构对齐 MCP 卡片：`list-item` + `list-item-main` + `list-item-actions`）；meta 行渲染工具 chips（`label || name` 文本、`title = description || quickForgeName`，`VISIBLE_PLUGIN_TOOLS = 12`，超出折叠为 `pluginMoreTools` 的 +N muted 徽章）；开关补 `aria-label`（`pluginEnabledSwitchLabel`）；禁用插件在 article 上标 `data-quickforge-plugin-disabled="true"`；空状态搜索路径改 `quickforge-settings-meta quickforge-settings-code-list` 纵向列表；discovery 错误行加 `mt-0.5 leading-relaxed`。
  2. `src/index.css`：`data-quickforge-plugin-disabled='true'` 时 `list-item-main` opacity 0.55（过渡 160ms 挂在 `list-item-main` 基础类，启停双向平滑）。
  3. `src/lib/i18n.ts`：新增 `pluginMoreTools`（'+{count}'）、`pluginEnabledSwitchLabel`（'Enable plugin {name}' / '启用插件 {name}'）。
  4. 新增 `tests/frontend/plugins-page.test.ts`（9 用例：zh/en 本地化文案与开关 label、12+N 折叠、无折叠分支、label/title 优先级、禁用标记与受控开关、启用不标记、错误 alert）。
- 验证 / Evidence：定向 vitest 9 passed；连带 mcp-server-card + settings-react-infrastructure + decorator-copy-i18n + i18n-language-snapshot 30 passed；npx eslint 通过；npx tsc --noEmit 通过；npm run build 通过（chunk 警告既有）。
- Notes：测试要点——静态渲染断言用 `renderToStaticMarkup`，受控 `checked=false` 不输出属性、需经函数调用组件取元素 props（同 mcp-server-card.test.ts 模式）。未加状态徽章/版本/来源信息（用户明确只要视觉微调 + 工具展示）；无依赖变更；未修改生成产物；改动未提交。

---

## thinking-end-refold-flicker（done，2026-09-23）

- Goal：消除「思考过程之后界面闪一下」——思考段结束/整轮提交那一帧被真实绘制的「未折叠」状态。
- 根因：折叠组借用了 React 渲染的节点，`ProcessGroupReleaseBoundary.getSnapshotBeforeUpdate` 必须在提交前 release（节点搬回原位 + 解除 `data-quickforge-process-folded`，即恢复显示），但重新折叠排在 `ChatPanelHost` 的下一个 rAF（`requestSurfaceDecorate` → `scheduleDecorate` → `requestAnimationFrame`）——中间整整一帧「未折叠」被浏览器 paint，观感即闪一下。`ChatSurface.tsx` 的注释与 `session-handoff` 早先记录都已点名这个跨帧空档（同项目 `SubagentTrace` 早已是同提交内同步重折叠）。
- 改动：
  1. `ChatSurface.tsx`：`getSnapshotBeforeUpdate` 只做 release 并返回「是否真的交还了组」作为 snapshot；`componentDidUpdate(_, _, released)` 为真时才调 `onReleased`（同帧）；`componentWillUnmount` 只防御性释放；相关注释（boundary / MessageArea / Props）改成同一提交口径。
  2. `ChatPanelHost.tsx`：新增 `requestSurfaceDecorateNow`（`decorateFnRef` 就绪且不在装饰中 → 同步跑完整 decorate pass；否则回落 `scheduleDecorate` 的 rAF 兜底），`onProcessGroupsReleased` 改传它；`runDecorate` 增加 single-flight 守卫（`decorateInFlightRef`）。
  3. `process-folding.ts`：`releaseProcessGroups` 文档口径改为「同一 task 内重折叠」。
  4. `docs/wiki/src/components/README.md`：process-folding 所有权租约条目（315 与 635 两处副本）同步新契约。
- 测试：新增 `tests/frontend/chat-surface-release-refold.test.ts`（4 用例：释放阶段不回调 / `componentDidUpdate` 同帧才回调 / 未交还组不回调 / 纯流式帧两半都跳过 / 卸载只释放）；`tests/frontend/process-folding-ownership.test.ts` 4 处断言改为 snapshot 驱动 `componentDidUpdate`。
- 验证 / Evidence：定向 vitest 32 passed（refold 4 + ownership 18 + release-gate 10），另一批 13 文件 230 passed；`npm run test` 全量 379 文件 4525 passed / 1 skipped；`npm run lint` 通过；`npm run build` 通过。
- Notes：未改 release gate 判定与 `releaseProcessGroups` 的释放规则，只改「何时请求重折叠」；未动思考头接管/尾行提示动效与滚动时序。风险：同步装饰 pass 会在 React layout 阶段跑一次（含强制 layout 读取），仅发生在真正交还过组的提交帧；`runDecorate` 的 single-flight 守卫也可能吞掉"装饰中再次请求"的场景，此时由 rAF 兜底补一次。无依赖变更；未修改生成产物；改动未提交。

---

## thinking-end-refresh-flicker（done，2026-09-23）

- Goal：消除「思考过程结束之后页面重新刷一下」——思考段结束（`isStreaming` 翻转、正文开始输出）那一帧的可见重排。
- 根因（两处，同一帧）：
  1. 思考头接管路径（`decorateProcessThinkingBlocks`）在 React 重写 chevron/label 的 class 后短路失效，旧实现无条件重写 `label.textContent`（销毁重建文本节点）并 `prepend`/`append` 重排 header 子级——移动子级会重启其 CSS 动画（hint 淡入、跑马灯滚入），整行因此抖一下。
  2. 轮指纹 `processTurnFingerprint` 把终答 markdown 也算进结构，正文首次出现即被判为结构变化 → full 重建：整组节点搬动两次、组元素连同高度过渡一起重建。
- 改动文件：src/components/chat/panel-decoration/process-folding.ts（最小写路径 + 指纹排除 `excludeNode`，`decorateProcessTurn` 调整顺序）、tests/frontend/thinking-header-adoption.test.ts（+1 用例）、tests/frontend/process-folding.test.ts（+1 describe / 2 用例，含 fake assistant 指纹夹具）、docs/wiki/src/components/README.md（契约条目补充）、feature_list.json、progress.md、session-handoff.md。
- 验证 / Evidence：定向 vitest 8 文件 109 passed、2 文件 55 passed；npm run test 全量 4521 passed / 1 skipped；npm run lint 通过；npm run build 通过。
- Notes：指纹只排除「终答 markdown」，中间（可折叠）markdown 仍计入，结构变化仍走 full；未改释放/交还契约与 release gate，未动尾行提示滚动时序与对齐。无依赖变更；未修改生成产物；改动未提交。

---

## thinking-hint-align-left（done，2026-09-23）

- Goal：思考过程右侧的尾行提示文字（含行切换滚入）不要居中，改为靠左。
- 根因：接管后的思考头是 `<button>`，UA 默认 `text-align: center` 被继承到 header 第四槽位 `quickforge-tool-marquee`（hint）内部的静态度省略文本与纵向滚入的 static 视图上；横向滚动视图 `.quickforge-marquee-moving` 本身绝对定位在 `left: 0`，因此「静态/滚入居中、滚动靠左」不一致。装饰层把 header className 重置为 `thinking-header quickforge-process-thinking-header`，丢掉了可兜底的 `text-left`（子代理工具行 `<button>` 自带 `text-left`，所以只有思考过程暴露）。
- 改动文件：src/index.css（`.quickforge-process-thinking-hint` 显式 `text-align: left` + 注释）、tests/frontend/chat-surface-css-contract.test.ts（新增对齐契约断言）、feature_list.json、progress.md、session-handoff.md。
- 验证 / Evidence：定向 vitest 49 passed；连带 5 文件 76 passed；npx eslint 通过（src/index.css 被 eslint 配置忽略，属既有设定）。
- Notes：纯对齐修正，未改滚动时序/淡入淡出/字号，未动 subagent 跑马灯；无需更新 DESIGN_LANGUAGE.md 与 docs/wiki（未改模块职责、公共入口、发布流程，原因记于此）。无依赖变更；未修改生成产物；改动未提交。

---

## thinking-expand-flicker（done，2026-09-23）

- Goal：修复「运行中点击「思考过程」展开后页面一直重刷/闪烁」——定位并消除过程折叠层与终答 markdown 判定的逐帧互翻。
- 根因：流式期间 `ThinkingBlock` 展开会在 thinking-block 内渲染 `MarkdownBlock`（tag/class 命中 `PROCESS_DETAIL_NODE_SELECTOR`），`collectProcessTimeline` 的 filter 只按 owner/previousByNode 判定、未排除嵌套 detail，于是它被当折叠项搬进过程组 step；父链一变，`markdownCandidates`（按父链上最近的过程节点排除 thinking 内 markdown）不再排除它，它反而成为流式终答 markdown 候选并从折叠项中剔除；下一帧 full 路径的 `restoreProcessTurn` 又把它送回 thinking 块 → 每帧「收集→搬走→判为终答→归还」互翻，整组每帧全量重建、每个被折叠节点每帧搬动两次并重启 CSS 动画。
- 改动文件（4 个源/文档 + 3 个状态文件）：src/components/chat/panel-decoration/process-folding.ts（新增导出 `isFoldableProcessTimelineNode(node, trackedOrOwned)`；`collectProcessTimeline` filter 改用它）、tests/frontend/process-folding.test.ts（+2 回归用例）、docs/wiki/src/components/README.md（process-folding 所有权租约条目补折叠收集口径）、feature_list.json、progress.md、session-handoff.md。
- 验证 / Evidence：定向 7 文件 vitest 99 passed；npm run test 全量 378 文件 4518 passed / 1 skipped；npm run lint 通过；npm run build 通过。
- Notes：判定刻意**不**含「位于过程组内即非顶层」——组内节点父链无 detail 祖先、仍算顶层并被收集，`appendProcessToolSuffix` 增量追加与指纹短路依赖该序列稳定，加组内判定会让每帧全量重建（已在测试中固化）。修复会让工具卡/思考块内部的嵌套 markdown 一并退出折叠收集，属同口径修正。无依赖变更；未修改生成产物；改动未提交。

---

## harness 状态重置（done，2026-09-22）

- Last Updated: 2026-09-22
- Goal：三个状态文件（feature_list.json / progress.md / session-handoff.md）被清空为未提交空模板，导致无法恢复上下文；先按既有惯例把 HEAD 内容归档到 docs/archive/ 三个归档文件，再将主状态文件重置为全新状态。
- 改动文件（6 个）：feature_list.json、progress.md、session-handoff.md、docs/archive/feature-list-archive.json、docs/archive/progress-archive.md、docs/archive/session-handoff-archive.md。纯记录搬移，未动生产代码/测试/wiki。
- 验证 / Evidence: node JSON.parse 校验 feature_list.json 与 docs/archive/feature-list-archive.json 均通过；git status --porcelain 确认本次仅改动上述 6 个允许文件。
- Notes：工作区未提交 WIP 混杂两个主题（thinking-tail-hint 为主、settings-row-infotip 次要）；ChatSurface.tsx 有一处 pb-0→pb-4 归属不明改动；旧 progress 记录中的 4 个服务端测试失败与 flaky 登记随归档保留，但需后续重新验证是否已修复；docs/archive/feature-list-archive.json 历史条目引用的 docs/wiki/README.md:3 段落本次已删除（历史条目按惯例原样保留不回改）。

---

## thinking-tail-hint（done，2026-09-22）

- Goal：完成并验证 thinking-tail-hint——思考行尾行提示在真实 Chromium 下可正常显示，且跨 assistant 折叠 reparent 后归属/序号正确。
- 改动文件：src/components/chat/panel-decoration/process-folding.ts、src/index.css（另含 feature_list.json 列出的测试/文档文件与 tests/frontend/process-folding-incremental.test.ts）。
- 修复内容：
  1. 真实 Chromium 零宽根因与 `width:100%` 修复——header 未撑满导致尾行提示/跑马灯零宽不可见，为 `.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header` 补 `width:100%`。
  2. 跨 assistant reparent 的 source assistant / ordinal 修复——折叠后节点被搬进其它 assistant 组时，processNodeOwners/processThinkingSources 的 seed 与序号重排修复，groupedProcessNodeHasCurrentReplacement 改按 source index 判定替换。
  3. TS18048 及 ordinal 边界修复。
- 验证 / Evidence：定向 7 文件 vitest 128 passed；npm run lint 通过；npm run build 通过；npm run test 全量 4516 passed / 1 skipped。
- Notes：无依赖变更；未修改生成产物（dist/package-dist/package-offline）；本次改动未提交。
  - 本次状态文档一致性修复（2026-09-22）：仅同步 feature_list.json / progress.md / session-handoff.md，删除残留的 thinking-tail-hint in_progress 与“待验证”表述；未改源码、测试、Wiki 与生成产物。
  - Wiki 表述：本次修复不需要新增架构文档（未改变公共入口/模块职责）；工作区 docs/wiki 下已有 WIP 改动（docs/wiki/README.md、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md）不属本次修复，未回滚。
  - settings-row-infotip 仍为 pending，WIP 在同一工作区待验证；ChatSurface.tsx 的 pb-0→pb-4 属无关既有改动，本次未触碰。

---

## console-scroll-shadow-remove（done，2026-10-26）

- Goal：用户反馈「运行命令的 tools 详情」右侧有阴影，选择「直接去掉左右两侧阴影」。
- 根因：`src/styles/chat/tool-output.css` 给 `.qf-console-scroll[data-overflow-start/end="true"]` 加了 `inset ±10px 0 8px -8px` 内阴影作为横向溢出提示，由 `src/lib/tool-renderers/shared.tsx#syncConsoleScrollFades` 写 data 属性触发；垂直滚动条占宽会把 `clientWidth` 压小，导致没有真实横向溢出时右侧阴影也常亮。
- 改动文件：`src/styles/chat/tool-output.css`（删除三条 inset box-shadow 规则，注释改为「横向溢出不再加内阴影」）。保留 data 属性与检测逻辑。
- 验证 / Evidence：`npx vitest run tests/frontend/tool-renderer-shared-state.test.ts` 21 passed；`npm run lint` 0 error（仅既有 GitToolsPinnedSummary exhaustive-deps warning）。
- Notes：不新增依赖；未手工修改 dist/package-dist/package-offline；未创建 Git commit。若以后想恢复溢出提示，建议改用文本或淡出遮罩，而不是两侧内阴影，避免再次被误读为卡片投影。

---

## workspace-inspector-module-split（done，2026-10-26）

- Last Updated: 2026-10-26
- Goal：行为保真拆分 `src/components/workspace/WorkspaceInspector.tsx`（2003 行）——不改变 UI/DOM/class/aria、tab 持久化、请求 scope guard、i18n 与测试期望。
- 结论：入口缩到 544 行（-1459），其余职责拆为 2 个 hook + 6 个展示组件 + 2 个纯工具模块；元素/handler/aria/className 计数与原文件逐项一致（`<div>` 78、`<button>` 25、`className=` 175、`onClick=` 32、`role=*`/`aria-*` 全部相等）。
- 改动文件：`src/components/workspace/useWorkspaceTree.ts`（目录树/搜索状态、缓存 seed、项目切换重置、展开恢复、refresh/load-more）、`useWorkspaceReader.ts`（reader/document/diff/命令日志打开与加载、缓存优先 + meta 校准、刷新重读）、`WorkspaceInspectorHeader.tsx`、`WorkspaceTabStrip.tsx`（下拉菜单 + 可排序 strip，Pointer+Keyboard sensor、独立关闭按钮）、`WorkspacePanelLanding.tsx`、`WorkspaceTreePanel.tsx`、`WorkspaceReviewPanel.tsx`、`WorkspaceReaderPanel.tsx`（InlineReader/WorkspaceOverview/reader 列）、`workspace-panel-tabs.ts`、`workspace-path-utils.ts`、`WorkspaceInspector.tsx`（shell）；测试同步：`workspace-inspector-tabs`/`tab-fade`/`tab-list-scroll`/`on-demand-source`/`workspace-diff-no-changes`/`workspace-diff-review-recovery`/`side-chat-workspace-tab`（断言语义不变，仅指向迁移后的文件/文件合集）；`docs/wiki/src/components/README.md`。
- 验证 / Evidence：定向 vitest（workspace-inspector-* + inspector-layout/git-hooks + workspace-diff-*）76 passed；workspace/goal 相关 33 文件 461 passed；全量 `npx vitest run` 426/429 文件通过（失败 3 项均为既有 WIP：`chat-surface-css-contract` 因未提交的 tool-output.css 删除阴影规则、`file-rollback-api` 因未提交的 server-agent.ts 改动、`scheduled-tasks.commands` 并发 flake 单独重跑 24/24 通过）；`npx eslint .` 0 error（仅既有 GitToolsPinnedSummary warning）；`npx tsc -b` 除 ChatPanelHost/composer-input 既有 WIP 错误外无新增错误（`npm run build` 因此仍被该 WIP 阻塞）。
- Notes：effect 相对顺序尽量保持（根加载 → 搜索 → 项目重置 → 展开恢复 → tabs 持久化 → reader 加载）；唯一 relocate 是 git demand effect 由「重置之前」变为「重置之后」，两者最终都落到「review 激活时按 idle 加载」，属等价。`useWorkspaceTree` 内 3 处 setState-in-effect 与原组件逻辑逐字相同，因规则在独立 hook 中触发而加了带说明的 `eslint-disable-next-line react-hooks/set-state-in-effect`；入口 `projectGuardRef.current.token()` 的 render 期读数沿用原写法并加 `react-hooks/refs` disable。未新增依赖；未触碰 dist/package-dist/package-offline、tool-output.css、App.tsx；未创建 Git commit。

---

## frontend-god-components-split-round-3（done，2026-10-26）

- Last Updated: 2026-10-26
- Goal：按 2026-10-26 前端只读评审的 P0–P6 建议落地行为保真整改，不影响功能与产品体验。
- 结论：P0 可访问性/原生 alert 修复；P1 ChatPanelHost 2270 → 1750 行（主 effect ~1345 → 838）；P2 ScheduledTasksPage 1270 → 532；P3 WorkspaceInspector 2003 → 544（独立 feature 记录）；P4 GitToolsPinnedSummary 1124 → 253；P5 App 置顶摘要派生与事件订阅迁到 usePinnedSummaryModel（2028 → 1970）；P6 ServerAgent 抽取 SessionLeaseController 与 GoalStateController 两个协作者。全量测试 429/429 文件通过。
- 改动文件：`src/components/chat/panel-wiring/`（5 个纯 setup 模块）、`src/components/scheduled-tasks/`（state/data/form/types/sections）、`src/components/workspace/`（useWorkspaceTree/useWorkspaceReader + 6 个展示组件 + 2 个纯工具）、`src/components/git/`（usePinnedSummaryLayout/DesktopWidget/Sections/Capsule）、`src/hooks/usePinnedSummaryModel.ts`、`src/lib/session-lease-controller.ts`、`src/lib/goal-state-controller.ts`、`src/lib/server-agent.ts`、`src/App.tsx`、`src/components/workspace/useInspectorLayout.ts`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/MessageEditor.tsx`、`src/lib/i18n.ts`、`src/styles/settings/controls.css`；对应源码契约测试与 wiki 文档同步。
- 验证 / Evidence：`npm run test` → 429 files / 4984 passed / 2 skipped；`npm run lint` → 0 error（仅既有 `usePinnedSummaryCapsule` exhaustive-deps warning）；`npm run build` → 成功（仅既有 chunk 体积警告）；`npx tsc -b` → 通过。定向覆盖：ScheduledTasksPage 50、PinnedSummary 相关 71、Workspace 88、ChatPanelHost 主套件 314/315（唯一失败为已同步的旧 console shadow 断言）、ServerAgent/Goal/Lease 187、file-rollback-api 14。
- Notes：P6 只抽取租约与 Goal 状态机两个低耦合协作者，SSE/消息缓存/审批仍留在 `ServerAgent`，作为后续项；P1 主 effect 仍有 838 行，`decorate()` 本体、agent 事件扇出与 scroll sync 因 DOM/测试契约强耦合留在 host。`console-scroll-shadow-remove` 的旧 CSS 断言已同步为“无 box-shadow / mask”的新行为。未新增依赖；未手工修改 dist/package-dist/package-offline；未创建 Git commit。
