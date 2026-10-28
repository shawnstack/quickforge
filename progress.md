# Progress

按时间倒序追加。每个 feature 一段，完成后在此留档。

## dreaming-model-label-dedupe（done，2026-10-28）

- 现象：梦境页模型下拉里供应商名字重复，如 “GLM-4.6V (智谱) (智谱)”。
- 根因：自定义模型在 providers.json 里的 `name` 本身常写成 “GLM-4.6V (智谱)”，前端又无条件拼 `${name} (${provider})`。
- 修法：新增 `formatModelOptionLabel(name, provider)`（dreaming-data.ts）——provider 已出现在 name 里（忽略大小写）则不追加；空值单边兵底。同时过滤掉 `ref` 为 null 的模型（其 select value 会是空串，与“跟随对话模型”撞键）。
- 验证：新增 `tests/frontend/dreaming-model-label.test.ts`（4 例）；`npm run test` → 444 files / 5182 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## workflow-error-collapse（done，2026-10-28）

- 现象：`run_workflow` 失败时错误原文（服务端不截断，多段 + 「已完成步骤」清单）直接铺满聊天消息流 / 详情页，阶段与步骤被挤出可视区。
- 修法（一律「先给结论、按需展开」）：
  1. `src/lib/workflow-run-detail.ts` 新增 `isWorkflowErrorCollapsible(text)`（>140 字符或含换行）与 `WORKFLOW_ERROR_COLLAPSE_THRESHOLD`，纯 UI 判定，不动数据。
  2. Inspector 详情 `run.error` 抽成 `WorkflowErrorBanner`：原文默认 `-webkit-line-clamp: 2`，长错误给「展开详情 / 收起详情」（`aria-expanded` + `data-open`），展开后 `max-height: 40vh` 内部滚动；短错误不加按钮，渲染与之前一致。
  3. `PhaseLogs` 不再「阶段有 error 级日志就默认展开」——日志一律默认收起，error 只在头部保留 `-logs-flag` 标记点（原行为会让一屏全是日志）。
  4. 聊天区无 details 的失败帧（审批拒绝、参数校验失败、worker 启动失败）抽出 `WorkflowFallbackError`，套用同一折叠规则。
  5. i18n 新增 `workflowErrorExpand` / `workflowErrorCollapse`（中英成对）；样式改动落在 `workflow-detail.css` 与 `goal-workflow.css`，没有新增样式文件或依赖。
- 测试：`workflow-renderer.test.ts` 新增「长错误折叠 + 短错误不折叠 + 详情页折叠与日志默认收起」断言；同步修正两条原先依赖「error 日志默认展开」的旧断言。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md`（错误展示与 i18n 键）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`（两处）、`docs/wiki/src/styles/README.md`。
- 验证：`npm run test` → 443 files / 5178 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes（本次不动）：`src/components/workspace/SubagentRunDetailContent.tsx` 的 subagent 错误块（`border-destructive/50` 那段）仍是无 clamp 的全量文本，属同类问题，等有反馈再统一。


## dream-page-shadcn-layout（done，2026-10-28）

- 更正：上一轮误改了设置页**左侧导航**（并动了全局 `.quickforge-settings-subtab`，影响数据管理页）。用户明确只要改 Dreaming 页内部，已全部回滚：`git diff` 对 `SettingsWorkspacePage.tsx` 与 `shell.css` 均为空；`quickforge:open-settings-tab` 监听保留（属上一个 feature）。
- 本轮只改 `src/components/dreaming/*` 与 `src/styles/settings/dreaming.css`：
  1. **一张 Card 一块事**：状态卡（标题 + 状态点/文字 + 立即处理 + 开关）→ 4 列 stats 条（下次/上次/生效/模型）→ 2 列字段网格（模型、执行时间、记忆语言、敏感、定时），全部用 `border-t` 发丝线分隔，不再堆 5 个 settings-row。
  2. **页内 tabs 用本页自己的 segmented**：`.quickforge-dreaming-tabs`（muted 轨道 + 选中项浮起），筛选器移到同一行右侧，省掉单独一行 toolbar。
  3. **列表改成 divide-y 行**：去掉 `min-height: 5rem` 与逐行 border（会与 divide-y 双线），行 padding 统一 0.875/1.25rem，空态改为居中弱化文字而非 `settings-empty-row`。
  4. **按钮改用 shadcn Button**：`@/components/ui/button` 的 `variant=ghost|outline size=sm`（立即处理、分页、淘汰、查看、返回）。
  5. 字段布局抽出本地 `Field`（label 在上、控件在下）+ 两个常量 `CARD`/`HAIRLINE`，避免同类 class 散落。
- DESIGN_LANGUAGE 里上一轮加的「分组导航（shadcn 惯例）」收窄为「页内切换（segmented）」，并注明侧栏菜单沿用既有实现、本轮不动。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功（DreamingSettingsTab 24.19 kB / gzip 5.70 kB）；`npx tsc -b` → 0 错误。


## settings-nav-shadcn（done，2026-10-28）

- Goal：设置页这部分菜单按 shadcn 风格重排布局。
- 结论（一句话）：左侧导航从“大圆角 + 自选阴影 + 11px 分组标题”改为 shadcn 惯例——菜单项 `h-8 rounded-md px-2 text-sm`、选中 `bg-[var(--sidebar-accent)]` 且去阴影、分组标题 `text-xs`、组间 `space-y-4` 组内 `space-y-0.5`；页内切换（记忆/运行历史）从下划线 tab 改为 segmented 轨道。
- 关键判断：
  1. 去掉 `shadow-[0_8px_22px_-20px_...]`：阴影属于浮层，不该出现在导航选中态（DESIGN_LANGUAGE 也禁止“每项都有明显阴影”）。
  2. 选中态改用 shadcn 语义 token `--sidebar-accent`/`--sidebar-accent-foreground`，不再用项目自建的 `--quickforge-sidebar-active-bg`（保留变量本身，侧栏其它地方仍在用）。
  3. 分组标题 `text-[11px]` → `text-xs`：去掉任意值，与 shadcn 的 `text-xs` 一致。
  4. 页内 tab 去下划线：设置面板里已有一层左侧导航，再来一条下划线会被读成第二层导航；segmented 轨道更贴近 shadcn Tabs。
  5. 同步修正间距：原 `pb-4`（分组内 padding-bottom）改到 nav 层的 `space-y-4`，避免“组内最后一项也带 16px”导致密度不均。
- 改动文件：`src/components/settings/SettingsWorkspacePage.tsx`（菜单项/分组/返回按钮/搜索框）、`src/styles/settings/shell.css`（subtab → segmented + section 内 gutter）、`DESIGN_LANGUAGE.md`（新增「分组导航（shadcn 惯例）」一节，固定 h-8/rounded-md/text-xs/组间距/选中态禁阴影）。
- 影响面：subtab 样式由 Dreaming 与 DataSettingsTab 共用，两处同步变为 segmented（纯视觉，交互与 aria 不变）。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## dreaming-button-layout-fix（done，2026-10-28）

- 现象：设置页记忆列表里的「淘汰」按钮一会儿横排一会儿竖排。
- 根因：按钮直接作为 `.quickforge-settings-list-item`（`display:flex; justify-content:space-between`）的子元素，没有包进 `.quickforge-settings-list-item-actions`（该类才有 `flex: 0 0 auto`），按钮自身也没有 `flex-shrink: 0` / `white-space: nowrap`。内容一长就挤压按钮宽度，两个中文字被折成两行 → 看起来是“竖着”。内容短时又正常 → “一会儿横一会儿竖”。
- 修法：
  1. `.quickforge-settings-button` 全局补 `flex: 0 0 auto` + `white-space: nowrap`（按钮标签永远不该竖排）。
  2. 记忆行的「淘汰」与运行详情的「查看/收起」按钮包进 `.quickforge-settings-list-item-actions`。
  3. 新增 `.quickforge-dreaming-list` 作用域：`align-items: flex-start`（按钮钉在首行，不随内容行数上下漂移）+ actions 区 `flex-wrap: nowrap`。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## sidebar-show-more-indent（done，2026-10-28）

- 问题：项目分区的会话列表底部「显示更多」左边缘与会话标题对不齐——会话行展开态是 `px-2 + pl-8`（32px），按钮只有 `w-full px-2`（8px）。
- 修复：`SessionDisplayControls` 改用 `sidebarRowClass(sidebarOpen)`，新增可选 `sidebarOpen` / `indent` props；项目分区调用点传 `indent`，`timeline` / 全局对话不加缩进。顺带修掉收起态的偏差——原来按钮固定 `px-2` 左对齐，现在跟随会话行的 `justify-center px-0` 居中。
- 改动文件：`src/components/sidebar/chat-sidebar/SessionDisplayControls.tsx`、`src/components/sidebar/ChatSidebar.tsx`（三处调用点传 `sidebarOpen`，项目处加 `indent`）、`tests/frontend/sidebar-section-order.test.ts`（契约断言改指 `sidebarRowClass(sidebarOpen)` 并新增缩进断言）、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：`npx vitest run tests/frontend/sidebar-section-order.test.ts` → 22 passed；`npx eslint` 三个改动文件 → 无输出（0 error）；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰 `dist/` 等生成产物。
- Notes：`pl-8` 在拆分前的 `SidebarSessionRow` 里就已存在，「显示更多」此前从未跟随这段缩进，不是本轮重构新引入的回归；只是按钮与会话行共用 `sidebarSessionRowBaseClass` 后视觉上更容易被看成“共用同一行样式却没对齐”。

## rollback-inline-edit（done，2026-10-28）

- 需求：回滚不要二次确认，点一下就把那条消息就地变成输入框，改完直接发送。
- 方案（一句话）：`inline-message-editor.ts` 把「确认弹窗」换成「就地编辑 + 后续消息变淡预览」，提交时先静默截断（`rollbackForResend`）再把新文案交给 composer 的 `onSend`，复用既有的 API key 检查 / plan-mode 包装 / 乐观消息 / 滚动锚定。
- 关键取舍：
  1. **不再有确认步骤，代价改用可视线索**：该行之后的消息加 `quickforge-message-doomed`（opacity .34 + grayscale）并插入 `quickforge-removal-divider` 虚线说明「以下 N 条消息将被移除」，比弹窗里那句抽象描述更具体。
  2. **发送链路不另起一套**：装饰层不直接调 `agent.prompt`，而是回滚成功后在 panel 上轮询 `.qf-message-editor` 的 `onSend`（最多 12 帧）再发送——回滚到第一条会重建会话（新 agent + 新 surface），桥要等 React 提交后才可用；非 DOM 环境（rAF 缺失）轮询立即失败并保持编辑态。
  3. **装饰层幂等**：编辑中的行打 `data-quickforge-editing`，行循环整行短路（不重写 dataset key），避免重装饰把用户正在输入的编辑框冲掉；流式开始 / 只读切换统一 `closeInlineMessageEditors`。
  4. **保留降级路径**：没传 `onRollbackForResend` 的调用方仍走旧的 `rollback-confirm-popover.ts`，侧聊等只读场景语义不变。
- 动过的文件：`inline-message-editor.ts`（新）、`message-actions.ts`、`ChatPanelHost.tsx`、`useChatActions.ts`（抽出 `performRollback(messageIndex, restoreDraft)` + 新导出 `rollbackForResend`）、`App.tsx`、`SharedConversationPage.tsx`、`src/styles/chat/message-edit.css`（新，index.css 里紧跟 messages.css 导入）、`i18n.ts`（双语 7 条）。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。单测 `tests/frontend/inline-message-editor.test.ts`（7 例，jsdom）：预填/变淡/虚线、提交成功关闭、提交失败保持编辑态、Enter vs Shift+Enter、Esc 还原、切换行互斥、装饰层点回滚不再出 popover 且二次点击取消。
- Notes：设计稿在 `docs/design/rollback-inline-edit.html`（整屏高保真，可切「现状 / 新方案」对比）。真机待确认：编辑态气泡变宽后长文本的折行观感、以及回滚到第一条消息时（重建会话）发送是否稳定落到新 agent。
- 追加调整（真机反馈）：「这条消息及之后 N 条会被移除…」与「Enter 发送 · Esc 取消」不再平铺，收进 footer 左侧的 ⓘ 提示（hover / focus / 点击展开，靠近消息区顶部时自动翻到按钮下方），footer 只留 ⓘ + 取消 + 发送；同时去掉 textarea 的 `focus-visible` outline 与气泡外扩的 3px ring——编辑态本身（主色描边 + 光标）已表达焦点，再套一层会在气泡内部形成深色边框。输入框默认书写高度提到 `min-height: 4rem`（约 2.5 行），自增高的 `resizeTextarea` 改为 `max(scrollHeight, computed min-height)` 取值，内容只有一行时不再缩成一条细缝。——随后按用户澄清「要的是宽度」回退了高度（min-height 回到 1.6rem），改为编辑态放宽宽度：行内 margin 收到 0.25rem、气泡 `max-width: 100%`，铺满消息列。
- 宽度再调整（用户反馈「还是很短」「不要超过对话消息」）：根因是气泡是 `align-self: flex-end` 的**收缩宽度**，只写 `max-width` 根本不会变宽——短消息的编辑框始终只有一行文本那么宽。改为编辑态 `align-self: stretch` + `width: 100%`，宽度 = 对话列宽（不超出）；中途试过的「编辑时把消息列放宽到 80rem」已撤销。

## process-stage-scroll（已回滚，2026-10-28）

- 决定：用户试用后觉得「执行中 · N 个工具调用 · N 条命令」展开区被限高（`min(50vh, 18rem)` + 区域内滚动 + 执行中自动贴底）不好用，要求撤回该功能。
- 回滚范围：整条 feature 的代码 / 测试 / wiki 全部还原——`src/styles/chat/process.css`（限高与展开态滚动规则）、`src/components/chat/panel-decoration/process-folding.ts`（`resolveProcessStageScrollFollow` / `bindProcessStageScrollFollow` / `applyProcessStageStick` / `scheduleProcessStageStick` / `resetProcessStageScrollFollow` 及 `updateProcessStageGroups` 内的绑定逻辑）、`tests/frontend/process-folding.test.ts`、`tests/frontend/process-folding-incremental.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md`。
- 回滚方式：该功能是一次独立提交 `55923d4`，且 `git log 55923d4..HEAD -- <上述文件>` 无任何结果（无后续提交改动过这些行），因此直接按文件回退到父提交 `ab1ff0b0` 的版本；**没有**用 `git revert`，因为 `feature_list.json` / `progress.md` 当时已有未提交改动（`dreaming-settings-discoverability`），revert 会在状态文件上冲突。
- 保留：`feature_list.json` 的 `process-stage-scroll` 条目与 `session-handoff.md` 的记录（标注已回滚，便于日后查到这段历史，避免重复实现）。
- 验证 / Evidence：`npx vitest run` process-folding + -incremental + -ownership + chat-surface-css-contract + css-architecture → 5 files / 114 tests passed；`npm run test` 全量 → 442 files / 5169 passed / 2 skipped（= 回滚前的 5172 减掉本 feature 的 3 个用例）；`npx tsc -b` → 0 错误；`npm run lint` → 0 error；`npm run build` → 成功（built in 4.24s）。未创建 Git commit。
- Notes：回滚后「执行中 N 个工具调用」的展开区恢复成随内容全高展开（工具多时会把对话拉长、也不会自动贴底）——这是回滚预期的旧行为。`src/styles/chat/process.css` 里所有 `quickforge-process-stage*` 结构与 `PROCESS_STAGE_DEFAULT_EXPANDED = true`（内层阶段恒默认展开）属于更早的功能，未受影响。

## dreaming-settings-discoverability（done，2026-10-27）

- 现象：用户反馈“运行时候没有模型这个选项”。
- 排查结论（代码本身没问题）：直接向正在运行的实例取了模块源码 —— `GET http://127.0.0.1:5176/src/components/dreaming/DreamingSettingsTab.tsx` 返回 130 KB 转译结果，确认包含 `dreamingModel` / `dreamingModelFollowChat`；`GET /api/dreaming` 也返回 `model.effective = HAPI/deepseek-v4-flash · source=active`，说明三级解析已生效。
- 真正原因：模型选择在「设置 → 自动化 → Dreaming」，而「设置 → 记忆」页对 Dreaming **一字未提**（`MemorySettingsTab.tsx` 里没有任何 dreaming 字样），从“记忆”找入口必然找不到。
- 修法：
  1. `MemorySettingsTab` 新增 Dreaming 区块：一行摘要（状态 · 条目数 · 当前生效模型）+「打开 Dreaming 设置」按钮。
  2. `SettingsWorkspacePage` 监听 `quickforge:open-settings-tab` 自定义事件跳转页签（项目里原先没有跨页签跳转机制）。
  3. 事件监听对非 DOM 环境做了守卫：`typeof window === 'undefined' || typeof window.addEventListener !== 'function'` 直接 return——单元测试渲染该页时不提供 window。
- 验证：`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## dreaming-model-selection（done，2026-10-27）

- Goal：Dreaming 要能自由选模型；先搞清楚为什么它一直在用 智谱/GLM-4.6V。
- 根因：未指定模型时 `resolveDreamingModel()` 直接调 `resolveImplicitModelPreference(null)`，它返回**模型目录第一条**；用户第一个配置的自定义模型就是 智谱/GLM-4.6V。同时设置页根本没有模型入口，所以既不可见也不可改。
- 结论（一句话）：改成三级解析——指定 `dreaming-settings.modelRef` → 最近对话模型（`settings['active-model']`）→ 目录第一条；设置页加可搜索模型下拉（首项「跟随对话模型」），并用 `overview.model` 把**实际生效的模型与原因**显示在 meta 行。
- 关键细节：
  1. 指定的模型被删/隐藏时，`resolveModelBinding` 抛错后不中断 run，降级到下一优先级（避免凌晨定时任务直接失败）。
  2. 只有在 `active-model` 真的存在时才走第二级；否则 `resolveImplicitModelPreference(undefined)` 会返回目录第一条，被误标成“跟随对话”。
  3. 保存设置时先校验 `modelRef` 可解析，不可解析直接 400，不把坏配置留到定时触发才暴露。
  4. 模型下拉展示 `name (provider)`，宽度单组控制（`quickforge-dreaming-field-model`），不挤压其他内联设置。
- 改动文件：`server/dreaming/runner.mjs`（三级解析 + `modelLabelOf`）、`server/routes/dreaming.mjs`（overview.model + PUT 校验）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（中英文案 14 条）、`tests/server/dreaming-runner.test.mjs`（+4 例回归）、`tests/server/routes/dreaming.test.mjs`（+2 例）、设计稿 §6.1 与 §10、wiki。
- 验证：dreaming-runner 14 passed；routes/dreaming 11 passed；`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 「跟随对话」用的是 `active-model`，即用户最近一次在对话里选中的模型；它不会随每个会话的临时切换变动。
  - 视觉模型（如 GLM-4.6V）用于文本摘要不是错误但浪费；现在用户可以在下拉里直接换成纯文本模型，代码不做能力判断。


## dreaming-ui-polish（done，2026-10-28）

- Goal：在 dreaming-ui-and-language 的结构上做第二轮 UI 精修——更美观、简洁、易用，不动后端。
- 结论（一句话）：状态不再只靠点的颜色表达（点旁永远拼同色调状态词）；徽章去碎（作用域下沉到 meta 行、名词挂 `title` 数字裸排）；内联设置与 meta 行之间加 hairline 分层；折叠箭头换 lucide chevron 旋转；搜索去掉按钮改为 300ms 防抖自动查询。
- 具体改动：
  1. 头部：标题从「开启 Dreaming」（开关的 label 兼标题，语义重复）改为功能名「梦境记忆」+ 状态文字（已开启/已关闭/进行中/上次运行失败，与状态点同色）；开关补 `aria-label`；meta 行去掉与 subtab 重复的「已淘汰」计数、自动区段两句长文案换短句（`dreamingAutoSectionOnShort/OffShort`）；保留并行会话新增的「生效模型」行。
  2. 记忆行：`ScopeBadge` 降为 meta 行文字（`全局 · 0.86 · 4.2 · 时间`），落地既有设计决策「数字裸排 + 名词挂 title」；行内徽章从 3 个收敛到 2 个（类型 + 召回次数），召回徽章带 `title`（`在对话中被召回 N 次`）。
  3. 运行行/详情：`+N/~N/-N/✕N/耗时` 每格补 `title` 全称；变更/衰减区的 `0.86 / 4.2` 裸数字徽章、读取内容区的消息数/字符数徽章同样补 `title`；折叠箭头由字符 `▸/▾` 换为 lucide `ChevronDown` + `--quickforge-dur-fast` 旋转（`data-open` 驱动，符合设计语言“动效挂 data 不挂 class”）。
  4. 筛选：删掉「搜索」按钮与回车触发，输入 300ms 防抖自动查询，状态下拉切换即查询（两者行为统一；首帧由初始加载覆盖，`useRef` 跳过首次）。
  5. CSS：`dreaming.css` 新增 `.quickforge-dreaming-status-text`（含 data-state 着色与 `·` 分隔）、`.quickforge-dreaming-chevron`（旋转过渡）、`.quickforge-dreaming-settings` 顶部 hairline。
- 改动文件：`src/components/dreaming/DreamingSettingsTab.tsx`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（新增 8 条双语）、`docs/architecture/dreaming-memory.zh-CN.md`（§10 页面结构描述同步）。
- 验证 / Evidence：`npx tsc -b` → 0 错误；`npx eslint` 改动 ts 文件 → 0 问题；`npx vitest run tests/frontend/{i18n-language-snapshot,settings-workspace-react,quickforge-settings-select,recall-experience-renderer}.test.ts` → 4 files / 45 passed；`npm run build` → ✓ built in 4.66s。
- 追加修复（同轮，2026-10-28）：真机出现 `Cannot read properties of undefined (reading 'available')` 崩溃（DreamingSettingsTab modelOptions）——崩溃行来自并行「模型选择」改动（`overview?.model.available` 只保护了 `overview` 没保护 `.model`），触发环境是**旧 server 进程**返回的 overview 无 `model` 字段（磁盘上 `server/routes/dreaming.mjs` 已总是返回该字段，5176 端口上有一个更早启动的实例在应答）。处理：`DreamingOverview.model` 改为可选类型 + 前端三处访问全部设防（`overview?.model?.available`、meta 行经局部 `effectiveModel` 收窄），旧 server 下页面降级显示「无模型」而不是整页崩。验证：tsc 0 错误、eslint 0 问题、settings-workspace-react + i18n 快照 23 passed。用户侧需重启旧的 dev server 进程才能看到完整的模型信息。
- Notes：
  - 开发态偶发崩溃：首次打开 Dreaming 页曾出现 `SettingsSelect` → `visibleSelectIndexes` 的 `option.label.toLowerCase()` TypeError（疑似 Vite 首载陈旧模块 + HMR websocket 失败的缓存现象，整页刷新后不可复现；相关 key 在 en/zh 双语均已确认存在）。`t()` 对缺失 key 会静默返回 undefined，缺 en 回填时任何消费 `label` 的组件都会整页崩——建议后续给 `t()` 加开发态缺 key 警告或给 `visibleSelectIndexes` 加防御，属共享组件改动，未在本次范围处理。
  - `dreamingMemorySearch`（搜索按钮文案）与 `dreamingAutoSectionOn/Off`（长文案）在本次改动后无生产消费方，保留未删（repo 有留档先例）。
  - 并行会话在 DreamingSettingsTab 里新增了「模型」选择（`modelRef` / `overview.model`），本轮改动已与其合流：meta 行保留生效模型、内联设置含模型下拉；其数据层细节见对应 feature 记录。

## dreaming-ui-and-language（done，2026-10-27）

- Goal：`Dreaming` 设置页要更简洁易用；同时修掉“用户中文对话、沉淀出的记忆却全是英文”的语言对齐问题。
- 结论（一句话）：语言不能靠提示词自觉——“write in the user's language” 被英文系统提示词淹没；改为代码从 **user 消息**里判定（CJK 字权重 ≈ 4 个拉丁字母，样本不足 12 个字母返回 null），再以 `## Output language` 硬要求写进 user message，设置项 `contentLanguage` 可覆盖，判定结果入库并在详情页显示。
- UI 改动：
  1. 原来的四组 settings-row（开关/定时/时间/敏感/运行/计数/自动区）压成一个「头部状态块」：状态点 + 开关 + 立即处理按钮；第二行单行 meta（下次/上次/生效/淘汰/自动区）；第三行内联设置（执行时间、记忆语言、敏感内容、定时开关）。
  2. 记忆列表与运行历史合并为一块，用 subtab 切换并带计数，避免两个长列表垂直堆叠。
  3. 运行历史改为整行可点的按钮式行：状态徽章 + 时间 + 单行指标（会话/+新增/~更新/-淘汰/✕拒绝/耗时）+ 结论，指标用语义色区分不加重底色。
  4. 详情页改为「状态条 + 统计条 + 元信息一行 + 可折叠分区」，读取内容/变更/拒绝/衰减/原始响应默认收起，减少滚动。
  5. 新增 `src/styles/settings/dreaming.css`（状态点含 running pulse 与 `prefers-reduced-motion` 降级），其余仍用既有 settings 令牌。
- 改动文件：`server/dreaming/{collect,prompt,runner,settings}.mjs`、`server/sqlite/{migrations,dreaming-repository}.mjs`（v15 `content_language`）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`（新）、`src/styles/index.css`、`src/lib/i18n.ts`（语言文案 14 条）、`tests/server/{dreaming,dreaming-memory,dreaming-runner}.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`。
- 验证 / Evidence：五个 dreaming 测试文件 → 58 passed；`npm run test` → 442 files / 5166 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功（DreamingSettingsTab 21.46 kB / gzip 4.79 kB）；`npx tsc -b` → 0 错误。
- Notes：
  - 已经存下的英文记忆不会自动重写——它们会在后续 run 里被 `update`/`supersede` 逐步替换为中文；想立刻重置只能在记忆列表里手工淘汰。
  - 判定只在“样本足够”时生效；纯代码会话会得到 `null`，此时提示词退回“跟随 transcript 语言”而不是瞎猜。
  - 记忆列表的置信度/强度仍显示在 meta 行，没有做成图表：这两个值目前只用于排序与淘汰阈值，做成可视化会夸大其精度。
- 补充（同轮）：真实 `~/.quickforge/MEMORY.md` 里已经有一批旧版写出的英文条目。为了不产生中英重复，提示词在 `## Existing memories` 后新增一句：已有条目若仍是另一种语言，应使用 `action="update"` 就地改写为目标语言，而不是为同一事实新建一条。这样历史条目会在后续 run 里逐步转成中文。


## workflow-docs-sync-to-code（done，2026-10-27）

- Goal：以**最终代码**为准同步 run_workflow 的文档，**不改任何代码**；并回答「当前并发是多少」。
- 结论（一句话）：默认权限下并发**恒为 1**（`effectiveConcurrency = hasFullAccess ? options.concurrency : 1`），只有完全访问模式才用 `options.concurrency`（默认 4、上限 8）；文档里「4 并发」的表述会让人误以为是常态，已改为「默认权限串行 1 / 完全访问默认 4」。另外修掉 6 处文档与实现不符的点。
- 关键对照（每条都落到行号）：
  1. **并发**：`agent-workflow-runner.mjs:236`。附带发现 `details.concurrency` 上报的是**生效值**（默认权限下恒 1），不是调用方传入值 —— UI 上看不出「配了 4 被降级」。
  2. **hooks 失败语义**：只有空/非字符串 prompt（`worker.mjs:250`）、空 tool name（`:260`）、`args` 非 plain object（`:263`）在 guest bridge 内抛 `TypeError`；其余参数错误（prompt 超长 `:165`、未知 option `:102`、schema 不可序列化/超限 `:106-113`、未知 tool option `:132`）由 `hostCall` 捕获后以 `ok:false` 回投 → `agent()`/`tool()` 返回 `null`。原文档说「参数非法会 throw」，与实现不符。
  3. **`phase()` 超 120 字符**：`phase` 是 notify 型消息（无 `requestId`），父进程 `normalizePhaseTitle` 校验失败后走 `if (!id) return`（`worker.mjs:191`）**静默丢弃**。脚本内 `currentPhase` 已更新，但该阶段不进 `details.phases`，后续 `log()` 归到上一阶段。原文档写「超 120 字符 throw」，是错的。
  4. **`schema` 未透传**：`runner.mjs:548-558` 调 `runAgent` 时只传 `prompt/profile/label/context/expectedOutput/workflowLabel/maxRuntimeMs/maxToolCalls/model`；`subagent-runner.mjs:347-351` 的 `schemaHint` 依赖 `params.schema`，工作流路径不会传 → 分支永不生效。所以 workflow 里的 `schema` 是**纯后置断言**，模型看不到契约，写散文时更容易返回 `null`。
  5. **中止/孤儿错误文本**按步骤位置区分：队列 Agent `Workflow stopped before this agent started.`、队列工具 `...before this tool call started.`、运行中 `Workflow stopped while this step was running.`（超时/父中止）或 `Workflow completed before this step settled.`（脚本已 return）。`markRunningStepsStopped` 是**同步**标记，因为 abort 后在途步骤是异步 settle 的。
  6. **details / 前端**：Agent record 漏了 `seq`；`subagentRun` 实际透传 16 个字段（补全 `subagent`/`sessionId`/`parentSource`…）；聊天卡跑马灯内容是**最后一个阶段标题**（`workflow-tool-renderer.tsx:108`），不是活跃步骤 label；`MaxWorkflowRunSnapshots` 是 50 不是 100（原文写「100→50」）；`workflowActiveStepLabels` 已无生产消费方（仅测试引用）。
- 改动文件（纯文档）：
  1. `docs/architecture/workflow-orchestration.zh-CN.md` — §2.1 模块表（补 `workflow-run-payload.ts` / `WorkflowRunDetailContent.tsx`）、§2.4 toolset 懒构建、§3.1 hooks 失败语义、§3.3 schema 边界、§4 并发与预算补充、§5.2/5.4 中止文本、§7.1 Agent record `seq` 与 `subagentRun` 字段、§7.2/7.3 前端契约合并重写（跑马灯、单行卡、实时通道、i18n 残留键、样式类清单）、§9 测试覆盖、§10 相关文件带行数。
  2. `docs/wiki/README.md` — 项目概览的并发表述（默认串行 1 / 完全访问默认 4）。
  3. `docs/wiki/server/README.md` — run_workflow 段：有界队列并发（生效值）、worker 协议补 phase/log 无 requestId、孤儿文本、schema 后置校验、toolset 懒构建缓存、限制表补 parallel/pipeline 256 与 bridge 5s、details 形状。
  4. `docs/wiki/src/lib/README.md` — 4 个 workflow 文件的行数与描述（549/190/149/135），渲染器契约（跑马灯取最后阶段、`activeWorkflowRunStore` 驱动 `data-open`、展开体已删的类清单）、残留 i18n 键。
  5. `docs/wiki/src/components/README.md` — 详情页条目补「样式已无 `--wf-tl-*`」与概览派生统计的显隐条件；历史段落加已移除提示。
  6. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `node -e "JSON.parse(...)"` → `feature_list.json` 语法 OK。
  - `git status --porcelain` → 本 feature 只涉及 5 个 md + 3 个记录文件；未触碰 `server/`、`src/`、`tests/`、`dist/` 等生成产物。
  - 逐条取证行号见「关键对照」。
- Notes：
  - **没有跑 `npm run test` / `lint` / `build`**：本轮零代码改动，这些门禁不会因文档变更而受影响。若需要门禁记录可单独跑一次。
  - 发现 3 处「代码 vs 文档」的实质问题（schema 未透传、参数校验错误类型不统一、`phase()` 静默丢弃），按「不要改代码」的要求**只写进文档**，未修。
  - 建议后续单独决策是否修 `schema` 透传（1 行改动，能显著降低 workflow 里 `agent({schema})` 的失败率）。


## recall-experience-tool-card（done，2026-10-27）

- Goal：`recall_experience` 在聊天里没有专属样式，只有兜底卡（工具名 + 整段 JSON），且 `count: 0` 会被渲染成绿色对勾，读起来像“成功查到了什么”。
- 结论（一句话）：新增专属渲染器 —— 折叠态一行读完（灯泡图标 + 回忆经验 + `· query` + 命中计数 + 状态），展开态是结构化经验列表（kind/scope/×recallCount + 正文 + 质量指标），并把「0 命中」重新定义为**正常结果**而非成功对勾 + JSON。
- 关键取舍：
  1. **计数分两种可见性**：命中时 `meta-hover`（默认隐形，避免每个工具行都挂一个数字）；0 命中时 `meta-important` 常显——因为「没查到」本身就是这次调用的结论。
  2. **0 命中与失败互斥**：`count === 0 && status === 'done'` 才渲染 `.quickforge-recall-empty` 中性说明；`isError` 走 `renderConsoleBlock(..., 'error')` + destructive 图标。旧兜底卡两者都不区分，是这次的主要体感问题。
  3. **正文不截断**：用户展开卡片就是为了读全文，`line-clamp` 只省一次点击但会藏掉关键限定条件。
  4. **质量指标不带标签**：行内 `0.86 · 4.2 · 2 个会话 · 3 天前` 已够读，完整名词挂在各段 `title` 上（`dreamingMemoryConfidence` / `dreamingMemoryStrength`），避免辅助信息抢正文层级。
  5. **复用而非新建视觉语言**：行配方复刻 `.quickforge-todo-history-item`（无分隔线、hover 仅 `muted 55%` 轻背景、无位移/边框/阴影）；颜色全走语义 token，暗色零覆盖；不自造 keyframes，运行态借用 `quickforge-tool-running-sweep`。
  6. **视图模型独立成纯函数**（`recall-experience-history.ts`）：只认 `details.type === 'recall_experience_result'`，其余返回 `available:false` 不伪造列表；空正文行整条丢弃；`confidence` 夹 0–1、`sessionCount` 按 evidence sessionId 去重（与设置页 `MemoryRow` 同口径）。
  7. **顺手补齐三处遗漏**：`renderToolIcon` 的 if 链（否则回落扳手图标）、`summarizeParams` 分支（subagent 跑马灯复用同一套摘要规则）、`approval-card` 的 `BUILTIN_TOOL_LABELS`（审批卡原本会显示原始工具名）。
- 改动文件：
  1. `src/lib/recall-experience-history.ts`（新，101 行）— 视图模型 + `recallRecencyDays`。
  2. `src/lib/tool-renderers/recall-experience-tool-renderer.tsx`（新，151 行）— 渲染器。
  3. `src/lib/tool-renderers/shared.tsx` — `renderToolIcon` 加 `recall_experience`（灯泡）分支。
  4. `src/lib/tool-renderers/index.ts` / `src/lib/local-tools.ts` — 导出 + `registerToolRenderer`。
  5. `src/lib/tool-param-summary.ts` — `recall_experience` 取 `query`（修剪空白）。
  6. `src/components/chat/panel-decoration/approval-card.ts` — `recall_experience: 'recallExperience'`。
  7. `src/lib/i18n.ts` — 9 个键 × 2 语言（标题/最强记忆/命中计数/无匹配/两条空态说明/会话数/今天/N 天前）。
  8. `src/styles/chat/tool-output.css` — `.quickforge-recall-{list,item,meta,kind,content,metrics,sep,count,empty}` + `.quickforge-recall-tool > div .text-xs`。
  9. `tests/frontend/recall-experience-renderer.test.ts`（新，16 例）、`tests/frontend/tool-param-summary.test.ts`（+2 例）。
  10. `docs/wiki/src/lib/README.md` — 渲染器条目 + 视图模型小节 + 文件表行。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/recall-experience-renderer.test.ts tests/frontend/tool-param-summary.test.ts tests/frontend/tool-renderer-registry.test.ts tests/frontend/chat-surface-tool-message.test.ts` → 4 files / 41 passed。
  - `npm run test` → 442 files / 5160 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 问题；`npx tsc -b` → 0 错误；`npm run build` → ✓ built in 9.89s（仅既有 chunk 体积 warning）。
- Notes：
  - 未跑「发布」流程，未创建 Git commit（用户未要求）。
  - 折叠态**不做** kind/scope 药丸：`DESIGN_LANGUAGE.md` 已否掉「折叠态堆状态短条」，这些信息只在展开态出现。
  - `renderToolIcon` 仍是 if 链而非映射表，每次新增工具都要改两处（`shared.tsx` + `local-tools.ts`）；本次未重构，留作后续独立 feature。
  - 未验证真机视觉：建议实际跑一次 `recall_experience`（有命中 / 无命中各一次）确认 hover 计数与列表行距在暗色下符合预期。

## schema-version-test-hygiene（done，2026-10-27）

- Goal：结束“每次升 schema 都要在 7 个测试文件里改同一个版本号”的 churn，同时不引入恒真断言。
- 结论（一句话）：**不是**把数值断言都换成 `SQLITE_MIGRATIONS.length` 推导，而是直接删掉“等于最新版本”这类断言（它对迁移写坏完全没有分辨力），把价值留在能真正抓 bug 的地方——历史迁移边界的显式字面量、迁移行与迁移表逐项对齐、版本号连续性与 `user_version === 已应用行数`、以及表/列/索引/数据内容。
- 关键取舍：
  1. `const LATEST_SCHEMA_VERSION = SQLITE_MIGRATIONS.length` 只是把 churn 从 7 处收敛到 1 处，测试依然在重述实现；`expect(health().schemaVersion).toBe(SQLITE_MIGRATIONS.length)` 永远为真，迁移少写一列、漏建索引它都抓不到。故直接删除。
  2. 历史边界必须写死：`slice(0, 11)` 后验“v11 runtime 拒绝新库”、`migration 12` 故意失败验回滚、v7→v8 / v8→v9 / v2→v3 回滚——这些是“某个历史版本之前的库”这种事实。改成从当前列表推导会静默从“测那一条迁移”漂移到“测最新两条”。
  3. 迁移行断言改为与 `SQLITE_MIGRATIONS` 逐项比对（`version/name` 全等）：既能抓改名/重排/重复，又不写死版本号。
  4. 并发初始化断言改为“版本号连续 + `user_version` 等于已应用行数”，语义是“没重复、没漏”，与原 `COUNT === 版本号` 等价但不依赖具体数字。
  5. electron smoke fixture 里的裸 `schemaVersion: 14` 改成读实际 `health()` 输出，并校验 `schemaVersion === migrationCount`。
  6. helper 收窄为“构造用”而非“断言用”：保留 `LATEST_SCHEMA_VERSION`（构造“列表之后一条”的失败迁移）与新增 `NEXT_SCHEMA_VERSION`，并在注释里写明它不该用于版本断言。
- 改动文件：`tests/helpers/sqlite-schema.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`tests/server/scheduled-task-runs-repository.test.mjs`、`tests/server/session-state-repository.test.mjs`、`tests/server/share-repository.test.mjs`、`tests/server/lan-access-repository.test.mjs`、`tests/fixtures/session-state-full-chain-electron-smoke.mjs`、`tests/server/session-state-full-chain-electron-smoke.test.mjs`。
- 验证 / Evidence：
  - `npx vitest run` 5 个 schema 相关仓库测试 → 5 files / 61 passed。
  - `npx vitest run tests/server/session-state-full-chain-electron-smoke.test.mjs` → 1 passed。
  - `npx eslint` 上述 8 个改动文件 → 0 problems。
- Notes：
  - 本次未跑全量 `npm run test` / `npm run build`（非发布改动，改动集中在测试与 fixture）；如需发版仍须完整跑三项。
  - `scheduled-task-runs-repository.test.mjs` 里 `DELETE FROM schema_migrations WHERE version >= 3` 与 `PRAGMA user_version = 2` 也是历史边界字面量，刻意保留。
  - `package-dist/`、`package-offline/` 内的同名 `migrations.mjs` 未触碰（生成产物）。

## dreaming-run-detail（done，2026-10-27）

- Goal：Dreaming 只取会话的「user 消息 + assistant 最终回答」（含压缩摘要），总预算 100k 字符；并为运行详情页补齐可追溯的数据与 UI。
- 结论（一句话）：采集层从「全消息投影 + 工具结果首尾截断」改为「只投影 user 与最终回答」——工具调用与工具输出根本不进 prompt，因此不需要任何截断启发式；「最终回答」用 `no toolCall && stopReason ∉ {toolUse,error,aborted}` 判定，顺带把过程式中间消息与被中断回复排除掉。
- 关键取舍：
  1. 压缩摘要保留且单独标记为 `history(compacted)`：它以 user 角色存储，是那段被压缩历史的唯一可见形式，丢了等于丢掉历史；提示词里明确它证据强度更弱（置信度上限 0.7）。
  2. evidence 从 `sessionId+seq` 改为 `sessionId+note`：transcript 已无行号，保留 seq 是假精度。
  3. 运行详情新增 v14 四列（`model_label/input_chars/sessions_json/raw_response`）：窗口内会话可能超出保留期，事后再也复现不出“当时送了什么”，所以采集时就把每会话投影文本裁到 1200 字符存库。
  4. rejected 保留模型原提案（kind/scope/content/targetId）：只存 reason 无法区分“规则太严”和“模型跑偏”。
  5. 详情页额外返回 `memories`（本次触及条目当前状态），前端一次请求即可渲染“提案 vs 库中结果”的 diff。
  6. schema 版本断言改为从 `SQLITE_MIGRATIONS.length` 推导（新增 `tests/helpers/sqlite-schema.mjs`）：此前每次升 schema 都要手改 7 个测试文件的同一个字面量，已连续踩两轮。
- 改动文件：
  1. `server/dreaming/collect.mjs` — 重写 `projectMessages()`（user + 最终回答 + history(compacted)），新增 `isFinalAnswer()`、`SESSION_PREVIEW_CHARS`，预算改为单会话 30k / 整体 100k，返回带 preview 的 `sessions`。
  2. `server/dreaming/prompt.mjs` — 系统提示改为说明 transcript 只含 user 与最终回答；新增 Transcript format 段；`history(compacted)` 置信度约束。
  3. `server/dreaming/apply.mjs` — evidence 去掉 seq。
  4. `server/dreaming/runner.mjs` — createRun 写 modelLabel/inputChars/sessions；finishRun 写 rawResponse；rejected 保留原提案。
  5. `server/sqlite/migrations.mjs` — v14 `dreaming_run_details`（4 个 ADD COLUMN）。
  6. `server/sqlite/dreaming-repository.mjs` — toRun/createRun/finishRun 支持新列。
  7. `server/routes/dreaming.mjs` — detail 返回 `memories`，事件收集覆盖 replacementId。
  8. `src/components/dreaming/dreaming-data.ts` / `DreamingSettingsTab.tsx` — 详情页六段式（概览 / 读取内容 / 变更 / 拒绝 / 衰减 / 原始响应），`OperationRow` 同时显示提案与库中结果。
  9. `src/lib/i18n.ts` — 14 个新文案（中英）。
 10. `tests/server/dreaming.test.mjs`（采集用例外重写 + 压缩摘要/中断回复两例）、`tests/server/routes/dreaming-detail.test.mjs`（新，3 例）、`tests/helpers/sqlite-schema.mjs`（新）、5 个 schema 版本测试改为推导、fixture 升到 14。
 11. `docs/architecture/dreaming-memory.zh-CN.md`（采集/提示词/数据模型/前端详情三节）、`docs/wiki/server/README.md`。
- 验证 / Evidence：
  - `npx vitest run tests/server/dreaming.test.mjs tests/server/dreaming-memory.test.mjs tests/server/dreaming-runner.test.mjs tests/server/routes/dreaming.test.mjs tests/server/routes/dreaming-detail.test.mjs` → 52 passed。
  - 5 个 schema 版本测试 → 61 passed。
  - `npm run test` → 441 files / 5144 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 100k 是**字符**不是 token。按 3 字符/token 粗算约 33k token；若只想按 token 计，改 `MAX_TOTAL_CHARS` 即可（单处常量）。
  - 不含工具输出后，模型只能依据“用户说了什么 + 助手最后答了什么”判断。这意味着**它看不到具体命令与报错文本**，所以 pitfall 类记忆会偏向“现象 + 结论”而不是精确命令；这是用 100k 预算换覆盖面的直接代价。
  - `sessions_json` 每会话存 1200 字符预览，40 会话上限时单行最大约 48KB，仍在 SQLite 常规行大小内，无需拆分。


## dreaming-memory（done，2026-10-27）

- Goal：新增全自动 Dreaming 后台记忆固化——回看已结束会话，沉淀结构化长期记忆，并在后续任务中自动检索使用。
- 结论（一句话）：四个动作（提取事实/总结经验/识别错误/更新认知）全部交给一份提示词，代码只做硬校验后单事务落库，因此既保持“全自动”又不会让模型幻觉直接污染记忆库；检索用 SQLite 自带 FTS5 trigram，不引入新依赖。
- 关键设计取舍：
  1. 不做独立进程 worker，改做 server 内子系统 `server/dreaming/`：desktop/Android 共用同一 server，多进程会带来打包与退出成本；要的是逻辑隔离（独立设置、独立 run 记录、独立单飞锁）。
  2. MEMORY.md 分人工区与 `<!-- dreaming:auto:begin/end -->` 自动区，自动区整体重写、人工字节逐字保留——全自动写入若沿用“全量替换”必然覆盖人工内容。
  3. 记忆不只存 MEMORY.md，还落 SQLite 结构化经验库（kind/confidence/strength/evidence），才可能做“更新认知”与“淘汰”而不靠模型自觉。
  4. 淘汰判据只用可观测量（strength<1 且 confidence<0.5 且 30 天未召回，三者同时满足），不用“模型决定忘掉”；淘汰是软删，可追溯。
  5. 中文检索：默认 unicode61 分词器无法匹配中文子串，实测 trigram 可以；不足 3 字符的查询回退 `LIKE`（表规模小，代价可忽略）。
- 改动文件：见 `feature_list.json` 的 `dreaming-memory` 条目（设计稿、migration v13、server 模块、前端设置页、4 个新增测试、6 个受 schema 版本升级影响的既有测试、3 个 wiki 页）。
- 验证 / Evidence：
  - 四个新增测试文件 → 48 passed。
  - `npm run test` → 441 files / 5127 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 error / 0 warning；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - schema 从 v12 升到 v13，6 个既有测试硬编码了“最新版本=12”，已同步；其中 `sqlite-storage-foundation` 的表清单断言额外包含 FTS5 的 5 张影子表（`memories_fts_*`），这是 SQLite 正常行为，不是新增业务表。
  - 测试隔离教训：`global-memory.mjs` 与 `storage.mjs` 在 import 时就从环境变量解析数据目录，route/runner 测试必须 mock 这两个模块，否则会写真实 `~/.quickforge/MEMORY.md` 与 `config/settings.json`（本轮已发生并已清理）。
  - 已知边界：单次 run 只做一次模型调用（不做 tool-calling 多轮），成本可预测但模型无法回看 transcript 细节；采集预算（单会话 6000 字符 / 总量 60000 字符 / 最多 40 会话）在代码里封顶，不靠模型自觉。
  - 尚未做：跨设备记忆同步、向量检索、per-session 记忆；`recall_experience` 目前只按 FTS5 + strength/新鲜度排序，没有真正的语义相似度。


## fork-session-visible-immediately（done，2026-10-27）

- Goal：fork 出的新对话必须马上出现在左侧会话列表，而不是等用户再发一条消息。
- 结论（一句话）：根因是服务端 `createAgent` 从不持久化——创建期唯一那次持久化依赖「首条 user 消息 message_end」，而 fork 预置了 messages 时 `sessionCreatedEmitted` 直接为 true、该分支永久跳过，会话索引里查不到；修法是在 `createAgent` 返回前对 `messages.length > 0` 且非 restore 的会话 `await persistSession(session)`。
- 改动文件：
  1. `server/agent-manager.mjs` — `createAgent` 末尾新增创建期持久化（`messages.length > 0 && typeof config.persistedStateJson !== 'string'`），失败只记日志不阻断创建；不调用 `emitSessionEvent`。
  2. `server/agent-persistence.mjs` — `sessionLastModifiedFromMessages` 改为 `max(末尾消息时间, createdAt)`，避免继承旧历史时间戳的 fork 被排到列表底部。
  3. `src/hooks/useChatActions.ts` — `forkFromMessage` 传 `refreshSessions: false`（由 createAgent 内部那次负责），并去掉 `if (storage)` 门禁；同时移除已无用的 `storage` 局部变量。
  4. `tests/server/agent-manager.persist-session-state.test.mjs` — 新增 3 例：seeded 会话创建即落库且 `lastModified` 为 now、无消息创建仍不落库、restore 不重写（revision 不变）。
  5. `tests/frontend/fork-session-visibility.test.ts`（新） — 4 例源码契约：创建期持久化存在且排除 restore、创建期不发事件、fork 刷新不被 storage 门禁、`refreshSessions:false` 去重。
  6. `docs/wiki/server/README.md` / `docs/wiki/src/hooks/README.md` — 记录 createAgent 持久化时机与 `lastModified` 语义。
- 验证 / Evidence：
  - `npm run test` → 437 files / 5119 passed / 2 skipped，退出码 0。
  - `npm run lint` → 0 error / 0 warning。
  - `npm run build` → ✓ built in 7.06s。
  - `npx tsc -b` → 0 错误。
  - 定向：`agent-manager.persist-session-state` 37 passed；agent-manager 相关 9 文件 72 passed；`fork-session-visibility` 4 passed。
- Notes：
  - 早期尝试在该处发 `session_created` 并置 `sessionCreatedEmitted`，会额外消耗一次 `stateVersion`（既有断言 3→4 被抓到），已改为只写库不发事件：创建端自己会 `refreshSessions`，其他端通过索引读到即可。
  - `/summary` 的 fork 路径本来就显式 `persistSession`，不受此缺陷影响；本轮修复让普通 fork 与之对齐。
  - 创建期持久化是同步 await，会让 `POST /api/agents/:id` 多一次 SQLite 写；仅限带 messages 的创建（fork/seeded），空会话创建不受影响。

## fork-title-prefix（done，2026-10-27）

- Goal：fork 出来的新对话在会话列表里要能一眼看出是分叉，先用标题 `[fork]` 前缀解决（不做溯源字段）。
- 结论（一句话）：fork 路径改用 `generateForkTitle()`，新会话标题为 `[fork] + 首条用户消息`；前缀独立于既有 46 字符预算，正文截断规则不变，普通会话标题零影响。
- 改动文件：
  1. `src/lib/message-utils.ts` — 新增 `FORK_TITLE_PREFIX = '[fork] '`、`generateForkTitle(messages)`；`generateTitle(messages, prefix = '')` 增加可选前缀参数（前缀在多语言下统一，不本地化）。
  2. `src/hooks/useChatActions.ts` — `forkFromMessage` 由 `generateTitle(messages)` 改为 `generateForkTitle(messages)`。
  3. `tests/frontend/message-utils.test.ts` — 新增 `describe('fork title')` 四例：前缀不吃字符预算、短提示词保留空格归一化、无 user 消息时为 `[fork] New chat`、普通标题不带前缀。
  4. `docs/user-guide.zh-CN.md` / `docs/user-guide.en-US.md` — 分支/Fork 段落补充前缀说明。
  5. `docs/wiki/src/lib/README.md` / `docs/wiki/src/hooks/README.md` — 同步生成函数与 fork 行为说明。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/message-utils.test.ts` → 10 tests passed。
  - fork/标题相关 6 个前端测试（message-utils / message-actions / side-chat-workspace-tab / project-new-chat-reuse-guard / session-title / chat-capabilities）→ 6 files / 77 tests passed。
  - `npx eslint` 三个改动 TS 文件 → 0 error。
  - `npx tsc -b` → 0 错误。
- Notes：
  - 服务端 `titleSource` 逻辑未动：客户端传入非 `New chat` 标题即 `titleSource='manual'`，因此 fork 会话不会被 AI 标题覆盖——这正是前缀能稳定保留的原因，但也意味着 fork 会话标题不会自动精修；若以后要允许精修，需按“前缀 + 可识别”判断放行，而不是改 `canApplyGeneratedTitle()` 的全局语义。
  - 未做 `forkedFromSessionId` 溯源：后端 `createAgent` 无该字段、持久化与列表渲染也都没有，属独立 feature（可支持“分叉自 X”与分支树）。
  - `sessionTitle()` 只对完全等于 `New chat` 的标题做本地化，`[fork] New chat` 会原样显示；该场景只在 fork 出无语义首条消息时出现，未额外处理。

## compaction-prompt-english-untruncated（done，2026-10-27）

- Goal：把压缩用的提示词全部改成英文；并去掉 transcript 构造中的所有截断。
- 结论（一句话）：`COMPACT_SYSTEM_PROMPT` 与用户消息模板改为全英文（输出语言仍跟随会话语言），同时删除三层长度上限（单条 10000 字符、transcript `min(160000, max(12000, contextWindow×1.6))`、工具参数 2000 字符）——摘要现在能看到完整历史，代价是请求过大时由 provider 报错并经 `auto_compact_failed` 显式暴露，而不是静默产出不完整的摘要。
- 改动文件：
  1. `server/conversation-compaction.mjs` — `COMPACT_SYSTEM_PROMPT` 英文重写（九段结构不变）；用户消息模板改英文；删除 `truncateMiddle()` 与 `transcriptCharLimit()`；`buildTranscript(messages)` 不再接收/使用 model；`safeJson(value)` 去掉 `maxLength`；`formatMessageForTranscript()` 不再对消息正文做 10000 字符截断；`approximateMessageChars()` 的 attachments 调用同步去掉长度参数。保留 `redactSensitive()`（定点替换，非截断）与 `[image omitted]` / `[attachments omitted]` 结构性占位。
  2. `tests/server/conversation-compaction.test.mjs` — 新增 `describe('conversation compaction prompt')` 五个用例：提示词全英文且不含 CJK、transcript 指令为英文；40k 字符正文完整上送且不含 `[truncated`；5000 字符工具参数完整上送；裸 `sk-*` 仍被脱敏且 20k 正文不丢；`token = sk-*` 赋值形式被折叠为 `[REDACTED]`。
  3. `docs/wiki/server/README.md` — `conversation-compaction.mjs` 段新增「提示词（全英文）」与「不再做任何截断」两段，写明取舍与保留项。
  4. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx vitest run tests/server/conversation-compaction.test.mjs` → 11 tests passed。
  - 压缩相关四文件（conversation-compaction / agent-compaction / auto-compaction / auto-compaction-notice）→ 4 files / 46 tests passed。
  - `npx eslint` 改动文件 0 error；`npx tsc -b` 0 错误。
- Notes：
  - 语义边界：`minSourceChars` 门槛用的是**未截断**的 transcript 长度，因此判断更贴近真实历史量（旧行为下超长历史被截断到 160k 后仍高于门槛，实际结论不变）。
  - 已知残留：`LEGACY_COMPACTION_NOTICE_PREFIX/SUFFIX` 仍是中文常量，那是**历史识别**用的（旧版本写入的 notice 文案），不是提示词，不能翻译，否则旧会话的压缩消息将无法被识别与过滤。
  - 若后续发现某些小窗口模型频繁因输入过大而压缩失败，正确做法是提高 `<conversation_to_compact>` 的收敛策略（例如按 token 分块递进摘要），而不是恢复「掐头留尾」式截断。

## compaction-ux-timing（done，2026-10-27）

- Goal：分析自动上下文压缩的显示时机是否合理，并把「必须做」的缺口一次性补齐——架构最优、设计最优、保证产品体验，允许重构该部分代码。
- 结论（一句话）：压缩 UI 由「服务端零散事件 → 装饰层注入式卡片」改为「服务端 `state.compactionNotice` 单向状态投影 → React 在消息列表尾部渲染」，五个缺陷一并消失：进行中不再静默、审批不再留下死卡片、自动压缩不再切掉当前回合、阈值信号不再被丢弃、卡片不再强制滚动。
- 改动文件：
  1. `server/auto-compaction.mjs` — 新增 `COMPACTION_NOTICE_PHASES`（`awaiting_confirmation` / `summarizing`）、`setCompactionNotice()` / `clearCompactionNotice()`、`AUTO_COMPACT_DECISION` 四种结果、`resolveAutoCompactTailStart()` + `AUTO_COMPACT_MIN_TAIL_USER_TURNS`；`maybeAutoCompactSession()` 在每个进入/退出路径发布或清空 notice，审批结果区分拒绝/超时/取消/不可用；`approvalId` 前置生成并写入 notice；catch 住 abort 拒绝不再伪装成压缩失败。删除 `auto_compact_threshold_reached`。
  2. `server/agent-approval-orchestrator.mjs` — `createAutoCompactApprovalPromise()` 返回 `AUTO_COMPACT_DECISION`、采纳调用方传入的 `approvalId`、每条终止路径发 `auto_compact_approval_settled`（`decided` / `timed_out` / `cancelled`），并区分「已通告」与未通告的失败。
  3. `server/agent-compaction.mjs` / `server/agent-manager.mjs` / `server/agent-session-queries.mjs` — 初始化、`resetSessionCompaction()` 清空 notice；`getSessionState()` 投影 `compactionNotice`。
  4. `src/lib/server-agent-types.ts` / `src/lib/server-agent.ts` — 新增 `ServerAgentCompactionNotice` 与 `state.compactionNotice`；`auto_compact_state` / `auto_compact_approval_settled` 两个 case；`state` 帧与 `/state` 刷新都按「整体快照」语义覆盖（缺失即空闲）。
  5. `src/lib/global-agent-sse-client.ts` / `src/lib/shared-server-agent.ts` — SSE 事件白名单更新。
  6. `src/components/chat/surface/ContextCompactionStatusRow.tsx`（新）/ `ContextCompactionDecisionRow.tsx`（新）/ `MessageList.tsx` / `ChatSurface.tsx` / `ChatTypes.ts` — 两个行组件作为消息列表尾部子节点渲染；`ChatSurface` 订阅两个新事件；snapshot 增加 `compactionNotice`。
  7. `src/components/chat/panel-wiring/approval-cards.ts` / `panel-decoration/approval-card.ts` / `ChatPanelHost.tsx` — 删除 auto-compact 注入卡与其 tone/copy/keepBoundary/scrollIntoView 链路（`findKeepBoundaryTarget`、`statusIcon(tone)`、`ApprovalCardCopy`、`getMessages`/`keepRecentTurns` 依赖），`ChatPanelHost` 把批准/拒绝回调接进 `ChatSurface`。
  8. `src/lib/i18n.ts` + `src/styles/chat/context-compaction.css` — 新增 `compactionSummarizing*` 文案（en/zh）；新增状态行/决策行样式（shimmer 复用 `shimmer` keyframes + `prefers-reduced-motion` 降级、决策行复用邻近卡片强度、按钮只做 scale 按压反馈）。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误。
  - `npx eslint`（22 个改动文件）→ 0 error；`npm run lint` → 0 error / 0 warning。
  - 压缩相关 22 个测试文件 → 22 files / 299 tests passed。
  - `npm run test` → 435 files / 5076 passed / 2 skipped，退出码 0。
  - `npm run build` → 成功（`✓ built in 5.82s`）。
- Notes：
  - 新增测试：`tests/server/auto-compaction-notice.test.mjs`（notice 相位序列、四种审批结果、抛错/取消清理）、`tests/frontend/context-compaction-rows.test.ts`（两个行组件的渲染/隐藏/只读/不滚动）；`tests/server/auto-compaction.test.mjs` 增加 `resolveAutoCompactTailStart` 三例；`tests/server/agent-approval-orchestrator.test.mjs` 与 `tests/frontend/approval-card.test.ts` 更新为废弃旧契约后的断言。
  - 未做的（与本轮边界无关，已记录）：失败态仍走 `auto_compact_failed` 的临时日志提醒，没有常驻错误行；`keepRecentTurns` 设置项仍写“0 = 不保留”，文案与实际自动路径行为（至少保留 1 个当前回合）存在轻微不一致，属设置页文案后续跟进。
  - 首次全量跑出现 1 个失败（`semantic-color-class-parity`），原因是 CSS 注释里字面写了旧文档的语义色类名示例；改为文字描述后通过，说明该测试会扫描注释，新增样式注释时不要在注释里写带透明度的语义色类名。

## baseline-verification（done，2026-10-27）

- Goal：跑一次完整基线验证（test / lint / build），确认仓库当前无真实失败；只记录结论，不做功能改动。
- 结论（一句话）：三项全绿——`npm run test` 433 files / 5057 passed（2 skipped，退出码 0），`npm run lint` 0 error / 0 warning，`npm run build` 成功；此前多轮记录的「31 个 `Cannot find package 'jsdom'` 环境错误」已消失（`jsdom` 现已可解析）。
- 改动文件：仅 `progress.md` / `session-handoff.md` / `feature_list.json` 记录，无源码改动。
- 验证 / Evidence：
  - `npm run test` → `Test Files 433 passed (433)`、`Tests 5057 passed | 2 skipped (5059)`、Duration 82.47s、退出码 0。
  - `npm run lint` → `eslint .` 无任何输出（0 error / 0 warning）。
  - `npm run build` → `✓ built in 6.17s`（仅有既有的 >500kB chunk size 提示 warning）。
- Notes：
  - 本轮为 goal 模式长跑验证，未新增 feature、未改业务代码、未创建 Git commit、未触碰 `dist/` 等生成产物（build 输出按既有脚本生成，未手工修改）。
  - 工作区存在他人遗留的未跟踪临时文件 `.tmp-cdp-probe4.cjs` / `.tmp-cdp-probe5.cjs` / `.tmp-cdp-result.json`，与本轮无关，未清理。

## background-tasks-output-height（done，2026-10-27）

- Goal：后台任务面板的日志输出区（终端明细）太高——长日志时被拉成半屏，把任务列表挤到只剩两行；希望改矮到约 14~16 行。
- 结论（一句话）：输出区从「吃满剩余高度」改为「按内容占位 + 封顶 18rem」——`.quickforge-background-tasks-output` 由 `flex: 1 1 auto` 改为 `flex: 0 1 auto` 并加 `max-height: 18rem`（保留 `min-height: 4rem`），`.quickforge-background-tasks-detail` 同步由 `flex: 1 1 auto` 改为 `flex: 0 1 auto`，滚动区 `-output-scroll` 的 `flex: 1`（basis 0）改为 `flex: 1 1 auto` 让日志高度真正参与占位；省下的竖向空间归还任务列表（`-list` 从 `flex: 0 1 auto + max-height: 45%` 改为 `flex: 1 1 auto`，仍是唯一滚动容器）。
- 改动文件：
  1. `src/styles/workspace/background-tasks.css` — 上述 4 条规则 + 设计注释（为什么 detail 不能 flex-grow、为什么 scroll 区 basis 必须是 auto、为什么列表不再按 45% 封顶）。
  2. `tests/frontend/background-tasks-tab.test.ts` — 新增 `caps the output area height instead of stretching it to half the panel`：锁定 output 的 `max-height: 18rem` / `min-height: 4rem` / `flex: 0 1 auto`（且不得 `flex: 1 1 auto`）、detail 不得 flex-grow、list 为 `flex: 1 1 auto` 且无 max-height 并保留 `overflow-y: auto`。
  3. `docs/design/background-tasks-align-preview.html` — 「本次修正」补一条输出区封顶 18rem 的说明（该页直接 link 真实 CSS，预览自动跟着变）。
  4. `docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md` — 同步竖向高度策略（detail/output 均 `flex: 0 1 auto`，输出 4rem~18rem，剩余高度归列表）。
  5. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/background-tasks-tab.test.ts tests/frontend/css-architecture.test.ts tests/frontend/subagent-running-indicator.test.ts` → 3 files / 42 tests passed。
  - `npm run lint` → 0 error。
  - `npm run build` → 成功（built in 5.82s）。
- Notes：
  - 没有新增文案 / i18n key，纯样式改动；用户所说的「终端明细」实为面板内的「输出」区（仓库里没有该文案）。
  - `max-height` 放在输出区而不是详情区：短日志时详情自然矮（不留大块空白），长日志才长到 18rem 为止；若把上限挂到 `.detail` 上，短日志的详情也会被撑成 18rem 高。
  - 未做真机视觉确认（18rem 是否合适、窄窗下 meta 行数较多时的观感）；`npm run test` 全量未跑（本轮只跑 3 个相关文件，其中含既有 jsdom 缺包噪音）。

## process-stage-scroll（done，2026-10-27）

- Goal：把「执行中 · 16 个工具调用 · 4 条命令 · 编辑 1 个文件」这条内层阶段（stage）展开后的工具列表收拢为固定高度，超出部分在区域内滚动；执行中新增工具行要自动贴底到最新一行，用户手动上翻后不再抢回阅读位置。
- 结论（一句话）：限高 `min(50vh, 18rem)` 挂在折叠动画壳层 `.quickforge-process-body-inner`（stage-body 的子级选择器，DOM 结构不变），滚动能力只在 `[data-expanded="true"]` 挂上并加 `overscroll-behavior: contain`；执行中由 `scheduleProcessStageStick`（rAF）贴底跟随，`resolveProcessStageScrollFollow` 用 24px/8px 双向滞回判断是否继续跟随，跟随标记存 inner 的 `dataset.quickforgeStageFollow`，手动收起时复位。
- 改动文件：
  1. `src/styles/chat/process.css` — 新增 `.quickforge-process-stage-body > .quickforge-process-body-inner { max-height: min(50vh, 18rem) }` 与展开态 `overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain`（含设计注释：为什么滚动容器必须是 inner、为什么限高两态都保留而滚动只在展开态）。
  2. `src/components/chat/panel-decoration/process-folding.ts` — 新增 `resolveProcessStageScrollFollow`（导出供测试）、`bindProcessStageScrollFollow`、`applyProcessStageStick`、`scheduleProcessStageStick`（WeakSet 去重 + rAF，无 rAF 环境退化为同步）、`resetProcessStageScrollFollow`；`updateProcessStageGroups` 在 label 写入后对 stage inner 绑监听并按 `expanded && stageStreaming` 排队贴底，收起态复位跟随标记；stage summary 的 onclick 收起时同样复位。
  3. `tests/frontend/process-folding.test.ts` — 新增 `resolveProcessStageScrollFollow` 滞回用例（24/25、8/9、NaN/Infinity）。
  4. `tests/frontend/process-folding-incremental.test.ts` — 新增「流式新增工具行后区域滚动贴底、用户上翻后不再贴底」用例（fake inner 上挂 scrollTop/scrollHeight/clientHeight）。
  5. `tests/frontend/chat-surface-css-contract.test.ts` — 新增 `caps the expanded stage body height and scrolls inside it`：限高只能挂 stage inner、滚动只在展开态、折叠壳层（body/stage-body）不得变成滚动容器、顶层组 inner 不得限高。
  6. `docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md` — 同步 process.css 条目与 process-folding 折叠说明（限高滚动 + 贴底跟随 + 滞回阈值）。
  7. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误；`npx eslint` 改动源码/测试文件 → 0 error。
  - `npx vitest run` process 相关 11 文件（process-folding / -incremental / -ownership、chat-surface-css-contract、css-architecture、thinking-streaming-stage、motion-design、thinking-hint、thinking-header-adoption、subagent-process-trace、scroll-sync）→ 11 files / 186 tests passed。
  - `npm run lint` → 0 error；`npm run build` → 成功（built in 6.08s）。
- Notes：
  - 没有给 stage body 插新包装层：滚动容器复用既有动画壳层 inner，`stage-body > inner > step` 的结构契约（`appendProcessToolSuffix` 的校验链、`process-folding-incremental.test.ts` 的选择器）因此零改动。
  - 限高放在两态共用的 inner 规则里、只把 `overflow` 放到展开态：收起瞬间若放开上限，内容会先弹回全高再塌陷（观感一次跳变）。
  - 贴底用 rAF 而不是装饰 pass 内同步读写：`scrollHeight`/`clientHeight` 是布局查询，装饰 pass 刚写完 DOM 时同步读会触发强制重排。
  - 滚动条画在 inner 右缘，stage body 的 `padding-left: 0.75rem` 缩进与左侧连接线留在滚动区外、不随内容滚动。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Goal：
- 结论（一句话）：
- 改动文件：
  1.
- 验证 / Evidence：
- Notes：

## present-files-inline-links（done，2026-10-26）

- Goal：`present_files`（展示文件）工具卡去掉右上角眼睛（预览）按钮，改为摘要区逐文件渲染「文件图标 + 文件名」，文件名 hover 出下划线、点击跳转预览（范围仅 present_files，write/edit/read 摘要保持不变）。
- 结论（一句话）：`renderPreviewButton` 整体删除，新增 `renderPresentedFilesSummary(params)` 在摘要区逐文件渲染，与 `renderToolFileSummary` 同一套 span + click（`previewArtifactClickHandler` → `PREVIEW_ARTIFACT_EVENT`）与 `underline-offset-4 hover:underline` 文案，不可预览文件纯静态。
- 改动文件：
  1. `src/lib/tool-renderers/shared.tsx` — 删除 `renderPreviewButton`（present_files 的眼睛按钮）与其 `t` 依赖路径；`resolvePreviewableArtifact` 收窄为 write/edit/read 单文件；新增 `presentedFileEntries`（files 归一化，兼容 string 与 `{ path, kind }`）与导出 `renderPresentedFilesSummary`（逐文件 FileIcon + basename，逗号分隔，可预览各挂 click；工作区外绝对路径经 `isNonWorkspaceClickablePath` 静态化）。
  2. `src/lib/tool-renderers/local-workspace-tool-renderer.tsx` — `present_files` 摘要改走 `renderPresentedFilesSummary`；`quickforge-tool-actions` 里移除 `renderPreviewButton`，只剩终止命令按钮。
  3. `tests/frontend/tool-renderer-file-icon.test.ts` — 眼睛按钮用例替换为 3 个新用例（逐文件可点 + 各自派发事件、不可预览/工作区外静态、无 files 时不渲染元素）；新增 `presentedFileNodes` 辅助函数；顶部注释同步。
  4. `docs/wiki/src/lib/README.md` — `shared.tsx` 条目把 `renderPreviewButton` 换为 `renderPresentedFilesSummary` 并说明「动作区不再有眼睛按钮」的理由。
  5. `feature_list.json` / `progress.md` / `session-handoff.md` 记录本轮。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误。
  - `npx vitest run tests/frontend/tool-renderer-file-icon.test.ts tests/frontend/local-tool-running-sweep.test.ts tests/frontend/tool-param-summary.test.ts tests/frontend/css-architecture.test.ts` → 4 files / 39 tests passed。
  - `npx eslint src/lib/tool-renderers/shared.tsx src/lib/tool-renderers/local-workspace-tool-renderer.tsx tests/frontend/tool-renderer-file-icon.test.ts` → 0 error。
  - `npm run test` → 402 files / 4731 tests（4727 passed，3 failed，1 skipped）。3 个失败均在 `tests/frontend/background-tasks-tab.test.ts`（1）与 `tests/frontend/subagent-running-indicator.test.ts`（3，并行跑时计 2）内，断言对象是工作区里既有的未提交改动（`src/components/app/ConversationHeader.tsx`、`src/components/chat/panel-decoration/subagent-running-indicator.ts`、`src/styles/workspace/background-tasks.css`、未跟踪的 `src/lib/background-tasks-open.ts`），与本轮改动的 `tool-renderers/*` 无交集（两文件均不引用 `tool-renderers` / `renderPreviewButton`）；另有 31 个 `Cannot find package 'jsdom'` 的既有环境错误。
  - `npm run lint` → 0 error / 3 存量 warning（`coverage/` 生成目录）。
  - `npm run build` → 成功（built in 5.47s）。
- Notes：
  - 摘要区逗号分隔符用裸文本 `', '`（未新增 CSS 类），避免引入无对应样式的选择器。
  - `quickforge-tool-actions` 现在只在 `run_command` 运行中出现（终止按钮）；CSS 的 `:has(> .quickforge-tool-actions > button)` 预留区规则保持不变，present_files 摘要因此不再被预留 1.75rem 右侧内边距。
  - 未改动 `summarizeParams` 的 present_files 纯文本分支——它仍供子代理跑马灯（`subagent-run-detail.ts`）与 MCP 渲染器使用。
  - 已知与本轮无关的失败：`background-tasks-tab.test.ts` / `subagent-running-indicator.test.ts` 的 3-4 个用例（源码断言指向工作区里其他未提交改动），记在此备查、未扩大改动范围。

## background-tasks-sidebar（done，2026-10-26）

- Goal：把「后台运行命令」的运行与历史从临时浮层收进右侧边栏，提供可筛选、可搜索、可看日志的统一面板；终态历史不新增服务端接口，直接派生自会话消息。
- 结论（一句话）：Workspace Inspector 新增 `background-tasks` 运行时 Tab（`BackgroundTasksTabContent`），运行中来自 `backgroundCommands` 快照、终态由 `toolResult` 消息 `details` 派生（`src/lib/background-tasks-model.ts`），入口为置顶摘要 + Composer 图标两处，顶栏不设入口（顶栏图标入口已于下方「跟进 2 · 入口重构」删除）。
- 改动文件：
  1. `src/lib/background-tasks-model.ts`（新增）— `buildBackgroundTasks` 统一视图模型：running 取后台命令快照，finished 从 `toolResult` 消息派生 `completed`/`failed`/`timed_out`/`aborted`、`exitCode`/`durationMs`；同 `taskId` 两边都有时以消息终态为准；筛选/搜索/时长格式化纯函数。
  2. `src/components/workspace/BackgroundTasksTabContent.tsx`（新增）— 面板内容：全部/运行中/已结束筛选 + 关键字搜索、任务列表与状态点、详情元信息、命令日志预览（`getCommandLog`）、跟随输出、复制命令/任务、停止任务与查看完整日志入口；选中项失效时回落到第一条 running。
  3. `src/components/workspace/WorkspaceInspector.tsx`、`workspace-panel-tabs.ts`、`workspace-inspector-tabs.ts`、`useInspectorTabs.ts` — 注册 `background-tasks` kind（`Activity` 图标）、单实例复用、`serializePanelTabs` 剔除（不持久化）。
  4. `src/components/app/ConversationHeader.tsx` + `src/App.tsx` — 会话头入口与运行中数量徽标，点击打开/激活后台任务 Tab（经 `requestWorkspaceInspector`）；该入口后来在「跟进 2 · 入口重构」中整体删除。
  5. `src/styles/workspace/background-tasks.css`（新增）+ `src/styles/index.css` — 面板样式，class 前缀 `.quickforge-background-tasks-*`。
  6. `src/lib/i18n.ts` — en/zh 成对新增后台任务面板文案；本次清理未使用的 `backgroundTaskTabLabel`（两段各删除一行）。
  7. `tests/frontend/background-tasks-model.test.ts`、`tests/frontend/background-tasks-tab.test.ts`（新增）、`tests/frontend/server-agent-background-commands-frame.test.ts`（新增，6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 合并逻辑）。
  8. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：
  - `npm run test` → **402 files passed / 4722 tests passed（1 skipped）**；退出码 1 仅来自 31 个标注 `@vitest-environment jsdom` 的文件无法启动 fork worker（`Cannot find package 'jsdom'`，既有环境缺失），无真实断言失败，其余断言全部通过。首轮全量曾出现 `tests/server/scheduled-tasks.commands.test.mjs` 2 个用例失败，单独重跑该文件 24 passed，重跑全量后全绿——判定为并发下的既有 flake，与本次改动无关（本次只删了一个 i18n key 并改文档）。
  - `npx vitest run tests/frontend/background-tasks-model.test.ts tests/frontend/background-tasks-tab.test.ts tests/frontend/server-agent-background-commands-frame.test.ts` → 全过（其中 `server-agent-background-commands-frame.test.ts` 6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 就地合并）。
  - `npm run lint` → 0 error / 3 warning（均为 `coverage/` 生成目录的 unused eslint-disable，存量）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.78s）。
- Notes：
  - 后台命令输出非流式：日志预览靠 2s 轮询（仅「跟随输出」开启且任务仍在运行时）。
  - `backgroundTasks` 是服务端内存 Map，服务重启后终态丢失，面板会变空。
  - `listBackgroundCommandTasks` 仍只返回 running，未改动——会话 idle 回收语义依赖它。
  - 服务端 `settleBackgroundCommandToolResult` 在找不到对应 `toolResult` 消息时返回 `false`，该任务不会出现在面板终态里（边界场景：会话被驱逐 / compaction 截断）。
  - 本机 `node_modules/jsdom` 缺失，31 个 `tests/frontend/*.test.ts`（jsdom 环境）无法启动，属既有环境问题。
  - Tab 条上的 tab 标签不显示任务数（运行中计数徽标在 Composer 命令图标上；原会话头入口在「跟进 2 · 入口重构」中删除），如需 tab 内计数需给 `panelTabLabel` 传入 count。

- 跟进（2026-10-27，后台任务面板样式对齐 + 入口统一）：
  - Goal：把后台任务面板的横向基准、控件高度、间距与字号刻度对齐 Inspector 其余 tab（`workflow-detail.css` 同轴），消除切 tab 时的横跳与工具栏 1px 高低差；同时把入口收敛到一处。
  - 样式对齐（`src/styles/workspace/background-tasks.css` 重写）：
    1. 水平基准从 0.5rem 改为 **0.875rem**，与 `workflow-detail.css` 同轴，切 Inspector tab 时正文不再横跳 5px。header / toolbar / detail-header / meta / output 外框统一落在基准线；列表用 `list 0.5rem + item 0.375rem` 叠出基准线。
    2. 输出区内部三级（标题条 / 滚动区 / 底部提示）统一横向 0.5rem，去掉原来的 0.4rem。
    3. 控件同高：分段控件 `1.375rem` + 容器 `0.125rem` 内距 = 搜索框 `1.625rem`，消除工具栏内 1px 高低差；输出标题条与底部提示也统一 `1.625rem`。
    4. 空间节奏回到 1/16 网格：`0.375 / 0.5 / 0.75`，清除 `0.3 / 0.35 / 0.4 / 1.05 / 1.15 / 1.6` 等零散值。
    5. 字号 4 档：`0.6875`（计数徽标）/ `0.75`（正文）/ `0.8125`（列表标题）/ `0.875`（面板标题与空态标题）。原面板标题 0.8125 小于 Inspector tab 的 13px，属层级倒挂，已提到 0.875。
    6. 行内操作不再绝对定位覆盖元信息：`.item-meta` 与 `.item-actions` 共用网格第三列（`grid-template-columns: auto minmax(0,1fr) minmax(3.5rem, auto)`），悬停只做透明度交换。修掉原先「操作区比元信息格宽 10px、透明底让命令字从图标间透出」的压字问题。
    7. 选中态（`is-active`）不再显示行内操作、也不淡出元信息——两者同格，常显会互相遮挡；选中行的停止/复制在详情区。
    8. 命令从 `word-break: break-all` 换行改为单行 `ellipsis` 截断 + `title` 展示完整值，避免长命令把复制/停止按钮挤到行中间。
    9. 详情头恢复 `border-bottom`（34% 弱线），meta 加 `padding-bottom: 0.5rem`，命令与元信息不再贴在一起。
    10. 输出区加 `min-height: 4rem`，面板被压矮时不会把日志挤成 0 高；`.detail` 加 `overflow: hidden`。
    11. 筛选/搜索无结果时新增 `.quickforge-background-tasks-no-results` 提示（新 i18n key `backgroundTaskNoResults`），不再复用「选择一个任务」空态文案。
    12. `pointer: coarse` 下图标按钮提到 `2rem`，满足触摸目标。
    13. 所有图标按钮、链接、跟随开关补 `:focus-visible` / `:hover` 过渡与 reduced-motion 关闭。
  - 配套改动：
    1. i18n（`src/lib/i18n.ts`）：`backgroundTaskElapsed`（`'{duration} elapsed'`，英文去参数后是小写 `elapsed`）替换为 `backgroundTaskMetaElapsed`（`'Elapsed'` / `'耗时'`）；新增 `backgroundTaskNoResults`。
    2. `src/components/workspace/BackgroundTasksTabContent.tsx`：详情命令加 `title`；输出 footer 提示文案加 `quickforge-background-tasks-output-footer-hint` 单行截断类。
    3. 入口统一：Composer 左下角命令图标不再弹浮层菜单（`openBackgroundCommandMenu` 已删），改为派发 `quickforge:open-background-tasks` 窗口事件（`src/lib/background-tasks-open.ts`），App 监听并按 `sessionId` 过滤后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`。顶栏 `ConversationHeader` 没有后台任务按钮。停止/查看日志只在面板内。
    4. `tests/frontend/background-tasks-tab.test.ts`：对齐断言改为 0.875rem 基准；新增「分段控件与搜索框同高」「操作区不与元信息压字（共用第三列）」「Composer 图标经窗口事件打开」三条；字号断言从 3 档改为 4 档。
  - 验证 / Evidence：`npx tsc -b` 通过；`npm run lint` 0 error（3 条 warning 在 `coverage/` 生成目录，存量）；`npm run build` 通过；`npx vitest run tests/frontend/` → 228 个文件中 227 通过，唯一失败 `tests/frontend/custom-providers-tab.test.ts` 属另一并行 feature（与本次无关），31 个 jsdom 缺包 worker 启动失败属既有环境问题；后台任务相关 67 个用例全绿。
  - Notes（跟进）：
    1. `docs/design/background-tasks-align-preview.html` 是可视化对齐校验页：直接引用真实 CSS + foundation token 子集，叠加 0.875rem / 0.5rem 基准线，可切亮暗与 340/380px 宽度。
    2. 列表正文比基准线多一个「圆点 + gap」的缩进，这是 bullet 列表固有缩进，圆点本身仍落在基准线上。
    3. 选中行不显示行内操作是刻意取舍（与元信息同格）。
    4. 日志预览仍是 2s 轮询，非流式（原限制未变）。

- 跟进 2（2026-10-27，后台任务入口重构：顶栏入口删除 + 置顶摘要双入口）：
  - Goal：把「打开后台任务面板」的入口从三方并存（顶栏图标、Composer 图标浮层、置顶摘要）收敛为「置顶摘要的后台命令区块」+「Composer 左下角命令图标」两个直开面板的入口，并清掉上一轮遗留的浮层代码与样式。
  - 完成内容：
    1. 会话顶栏：删除 `ConversationHeader` 的「后台任务」图标入口（含运行中数量徽标）。
    2. 置顶摘要：`PinnedSummarySections` 的「后台命令」区块成为主入口——标题右侧「查看全部」按钮（`backgroundTaskOpenPanel` / `backgroundTaskOpenPanelAria`）+ 每条命令的行主体（行本身是 button，aria 走 `backgroundTaskOpenAria`），停止按钮是同级兄弟按钮、点击冒泡不影响；区块内不再单独渲染「查看」入口。
    3. Composer 图标：`.quickforge-background-command-trigger`（终端图标 + 运行中角标）不再弹浮层，点击**直接打开右侧面板**；`openBackgroundCommandMenu` 与 `.quickforge-background-command-menu` 样式一并删除。
    4. 新增事件桥 `src/lib/background-tasks-open.ts`：`OPEN_BACKGROUND_TASKS_EVENT`（`quickforge:open-background-tasks`）+ `dispatchOpenBackgroundTasks()` + `normalizeOpenBackgroundTasksRequest()`；`App.tsx` 监听后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`，且只接受「当前会话或缺省 sessionId」的请求。
    5. 保留：subagent 浮层仍复用 `renderBackgroundCommandItems`，`.quickforge-background-command-item/-copy/-stop/-log` 样式必须保留。
  - 改动文件：
    1. `src/components/app/ConversationHeader.tsx` — 删除后台任务入口按钮与徽标。
    2. `src/components/git/PinnedSummarySections.tsx` + `src/components/git/GitToolsPinnedSummary.tsx` — 「后台命令」区块加「查看全部」按钮、命令行主体改为整行按钮 + 兄弟停止按钮，新增 `onOpenBackgroundTasks` 透传。
    3. `src/components/chat/panel-decoration/subagent-running-indicator.ts` — 图标点击改为 `dispatchOpenBackgroundTasks({ sessionId })`，删除浮层打开逻辑。
    4. `src/styles/chat/composer-controls.css` — 删除 `.quickforge-background-command-menu`，保留 trigger/badge 与 item/copy/stop/log。
    5. `src/lib/background-tasks-open.ts`（新增）、`src/App.tsx`（事件监听 + 会话过滤）、`src/lib/i18n.ts`（`backgroundTaskOpenPanel` / `backgroundTaskOpenPanelAria` / `backgroundTaskOpenAria`）。
    6. `tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/subagent-running-indicator.test.ts` — 对齐新入口断言。
    7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/lib/README.md`；`feature_list.json`、`progress.md`、`session-handoff.md`。
  - 验证 / Evidence：`npx tsc -b` 通过；`npx eslint` 相关改动文件 0 error；`npx vitest run` 相关 5 个测试文件 79 passed；`npm run build` 成功（built in 3.39s）。
  - Notes：
    1. 浮层删除后 `renderBackgroundCommandItems` 仍被 subagent 运行浮层复用，`.quickforge-background-command-item/-copy/-stop/-log` 相关 CSS 不能随手一并删除。
    2. 两处入口的打开路径不同：置顶摘要在 App 内直接持有 `requestWorkspaceInspector` 并顺带按既有规则收起摘要；Composer 图标在装饰层，只能经窗口事件回 App。事件 payload 只放 `sessionId`，App 侧做「只认当前会话」过滤，避免跨会话残留事件把面板切走。
    3. 后台命令输出仍是 2s 轮询（原限制未变）。

## models-providers-layered-settings（done，2026-10-26）

- Goal：按 `docs/design/models-providers-settings-redesign.html` 设计稿，把「模型与提供商」设置页从「一个表单管理全部配置」重构为分层设计：提供商列表 / 连接 / 模型三层各自保存。
- 结论（一句话）：`CustomProvidersSettingsTab` 拆为编排器 + `settings/custom-providers/` 三层子组件（列表+预设弹层 / 连接（密钥独立保存、提供商级测试）/ 模型（行内独立保存、可见性即时写回、模型级测试、服务器拉取）），存储结构不变，新增服务端 provider-test / provider-discover 两个接口。
- 改动文件：
  1. `src/components/settings/tabs/CustomProvidersSettingsTab.tsx` — 重写为编排器：providers/draft/选中态、L2 保存（改名迁移密钥 + 重建模型 headers/协议/baseUrl）、密钥独立保存、L3 读-改-写单提供商、provider-test / provider-discover / 模型级 test-connection 调用、active 生命周期与 `customProvider` 深链选中契约保持。
  2. `src/components/settings/custom-providers/`（新增目录）— `shared.ts`（预设、buildModel、草稿转换）、`provider-list-pane.tsx`（L1 + 添加预设弹层）、`provider-detail-pane.tsx`（头部 + 删除菜单）、`connection-section.tsx`（L2，含 `qf-provider-api-key` 密码字段契约）、`model-list-section.tsx`（L3 行内编辑）。
  3. `src/styles/settings/custom-providers.css`（新增）+ `src/styles/index.css` 挂载 — 主从布局、密钥行、脏标记条、模型行、窄屏抽屉（<768px 详情覆盖列表 + backdrop）。
  4. `server/routes/models.mjs`（68→144 行）+ `server/index.mjs` — 新增 `POST /api/models/provider-test`（GET baseUrl/models 探测，不依赖模型，OpenAI/Anthropic 两种鉴权）与 `POST /api/models/provider-discover`（返回模型 ID 列表）。
  5. `src/lib/i18n.ts` — en/zh 成对新增 40 个分层文案 key，删除 7 个弃用 key（editCustomModel / addCustomModel / presets / presetCustom / providerAdvanced / atLeastOneModel / noCustomModels / customHeadersHelp）。
  6. `tests/frontend/custom-providers-tab.test.ts`（新增，13 用例）+ `tests/frontend/settings-workspace-react.test.ts`（密码字段契约路径改指 connection-section.tsx）。
  7. `docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/routes/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：`npx vitest run tests/frontend/custom-providers-tab.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/css-architecture.test.ts tests/frontend/i18n-language-snapshot.test.ts` 全过；`npm run test` 399 files / 4684 tests 全过（31 个 `Cannot find package 'jsdom'` Unhandled Error 为存量环境缺失，jsdom 已声明未安装）；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。

- Notes（同日视觉打磨）：协议分段控件整行铺满、等分两段、`white-space: nowrap` 根除换行，字号 0.9375rem→0.8125rem、总高收到 2.25rem 与输入框对齐；协议独占连接网格整行（名称/Base URL 两列）；密钥行改「标题行/说明行/编辑行」三段纵排，标题与操作按钮同行对齐；模型行能力徽标取消 `.quickforge-settings-meta` 默认 margin-top（原先把 chips 顶歪 8px）并加 min-height 统一行高；模型 ID 0.78125→0.8125rem、规格 0.65625→0.6875rem 统一字号刻度；列表/详情头部协议徽标改短标签（OpenAI / Anthropic，`protocolShortLabel`），列表 meta 合并为单行。tsc / eslint / 18 目标用例 / `npm run build` 全过。

  - 跟进（2026-10-27）：草稿提供商删除补二次确认（`confirmDiscardDraft` 破坏性确认，取消保留草稿）；已保存提供商删除的确认原有。新增 1 个测试用例（14/14 全过）。

  - 跟进 2：主从卡片改固定高度（桌面 34rem / 窄屏 28rem，列表与详情卡内各自滚动，页面高度不随模型数变化）；新增「上次最后访问的提供商」记忆（localStorage `quickforge:custom-providers:last-selected:v1`，id 优先/名称兜底恢复，深链优先，草稿不写入，恢复时不自动展开窄屏抽屉）。测试 15/15 全过。

  - 跟进 3（参考用户截图样式）：连接层改为全宽竖排表单——名称 / Base URL / API 格式（`SettingsSelect` 下拉，选项带端点说明 `Chat Completions (/chat/completions)` / `Anthropic Messages (/v1/messages)`）/ API Key（常驻密码框 + 行内眼睛切换 + 状态徽标 + 「清除密钥」即时生效）；密钥输入计入连接层脏状态、随「保存连接」落库（留空保留现有密钥）；移除密钥卡片与「更换/保存密钥」流程及 protocolType 分段控件。测试 15/15、tsc / eslint / build 全过。

  - 跟进 4：每个模型行新增一键连通性测试图标（闪电 = 待测 / 旋转 = 测试中 / ✓ ✗ 徽标 = 结果，错误详情放 title 提示），用已保存的模型配置直接探测、无需展开编辑；展开编辑区里的「测试此模型」保留用于测试未保存的草稿参数。`ModelRow` 导出并补 1 个行内测试用例（16/16 全过）。

  - 跟进 8（2026-10-27，修复「查看 API Key」看不到内容）：已保存的密钥从不回填输入框（`keyValue` 初值空串），点眼睛只是切换一个空输入框的 type，所以看不到任何内容。改为按需读取：`ConnectionSection` 新增 `onRevealKey`，首次点眼睛时调用（编排器 `revealKey` 读 `provider-keys`，兜底 `provider.apiKey`），明文只进本地 state；新增 `keyFromStore` 标记，回显内容不计入连接层脏状态、保存时按「留空保留现有密钥」提交；占位文案在已配置且未回显时提示 `storedKeyHiddenHint`（中英成对）；读取期间按钮 disabled。新增 1 个用例（reveal-on-demand：明文可见、脏标记不出现、二次点击不重复读取），16/16 全过；tsc / lint / build 全过。

  - 跟进 7（2026-10-27，卡片高度跟视口）：`quickforge-providers-card` 从固定 `height: 34rem` 改为 `height: max(34rem, min(52rem, calc(100vh - 13rem)))`——桌面 34rem 起、最多 52rem、且始终给页面头尾留约 13rem，大屏能看到更多模型行，小屏不出视口；窄屏抽屉同步 `max(28rem, min(52rem, calc(100vh - 11rem)))`。列表与详情仍在卡内各自滚动，页面高度不随模型数变化。定向测试 20 项、`npm run lint`、`npm run build` 全过。

  - 跟进 6（2026-10-27，模型行开关尺寸收敛）：模型行「在选择器中显示」开关原用全局 3.125×1.75rem 轨道，比同行 1.875rem 图标按钮大一圈，且在窄列被 flex 压缩后滑块 `translateX(1.375rem)` 溢出轨道、显示不全。改为行内局部覆盖：轨道 2.25×1.25rem、滑块 0.875rem / 位移 1rem、`flex: 0 0 auto` 禁压缩；行本身 `min-height` 2.5→2.75rem、上下 padding 0.5→0.4375rem（行高由最高控件 1.875rem 撑开）。`tests/frontend/css-architecture.test.ts` 5 + `custom-providers-tab.test.ts` 15 全过；`npm run lint` 0 error；`npm run build` 成功。

  - 跟进 5（2026-10-27，删除连接分区头部行）：连接层顶部的「连接」标题行 + 右侧「测试连接」按钮整行删除（模型行已有逐模型测试，provider 级测试冗余）；表单直接贴在详情卡顶部。连带清理 provider 级测试死链：`CustomProvidersSettingsTab` 去 `testStates` / `IDLE_TEST` / `testProvider` / `rowTestStatus`，`ConnectionSection` 去 `testState` / `onTest` 与结果提示，`ProviderDetailPane` 去 `testBadge` 与 `testState`，`ProviderListPane` 去 `ProviderTestStatus` / `statusBadge` / `testStatus`；服务端删除 `POST /api/models/provider-test`（`provider-discover` 保留，复用同一 `fetchProviderModelIds`）；i18n 删除成对死 key `testConnection` / `testRequiresBaseUrl`（`connectionOk` / `connectionFailed` / `testingConnection` / `connectionSection` 仍被模型行复用，保留）。测试删去 provider 级测试用例，其余 15/15 全过；tsc / eslint / `npm run lint` / `npm run build` 全过。

- Notes：存储仍为 `custom-providers` + `provider-keys`（密钥按提供商名）；连接层保存语义 = 读-改-写整个提供商（协议/请求头下发到全部模型）并迁移改名密钥，密钥独立保存只写两个存储不触碰模型；草稿提供商（预设创建）在本地保存连接时落库。`customProviders` 深链从「打开编辑表单」改为「选中列表项」。工作区有并行会话（ask-user-echo-fix）在同文件 `src/lib/i18n.ts` 作业，本次 i18n 改动均为 provider 区块内成对增删，无交叉。

## ask-user-echo-fix（done，2026-10-26）

- Goal：修复 ask_user 工具「最后补充的问题/内容不回显」——回执行把选项与自定义补充合并成一行裸文本、跳过态丢失补充信息、待答卡无「已填写」指示、中文输入法 Enter 被当作下一问。
- 结论（一句话）：回执改为「选项 chip + 独立补充段」两段语义，跳过/超时（`answers: null`）也渲染回执并保留 `remark`，待答卡补充框显示已填写徽标并预展开，Enter 增加 IME 守卫。
- 改动文件：
  1. `src/components/chat/panel-decoration/ask-user-card.ts`（新增 `splitAskAnswer` / `renderReviewAnswer`、已填写徽标与预展开、`e.isComposing` 守卫）
  2. `src/lib/tool-renderers/ask-user-tool-renderer.tsx`（容忍 `answers: null`、`reviewRemark` 不再排除 skipped、分段渲染）
  3. `src/styles/chat/interaction-cards.css`（answer 分段与跳过态样式）
  4. `src/lib/i18n.ts`（新增 `askUserExtraLabel` / `askUserNoChoiceLabel` / `askUserFilledHint`，en + zh）
  5. `tests/frontend/ask-user-card.test.ts`、`tests/frontend/ask-user-renderer-remark.test.ts`
  6. `docs/design/ask-user-echo-fix.html`（方案设计稿）
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`
- 验证 / Evidence：`npx vitest run tests/frontend/ask-user-card.test.ts tests/frontend/ask-user-renderer-remark.test.ts` → 36 passed（28 + 8）；ask_user 回归面（含 server 侧 4 个测试文件）6 files / 103 tests passed；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。
- Notes：验证期间工作区存在并行的 CustomProviders 重构（`src/components/settings/custom-providers/`、`server/routes/models.mjs` 等），曾导致 build/test 瞬时失败；延时等待确认收敛后重新验证通过。提交时按文件隔离，`src/lib/i18n.ts` 只暂存 ask_user 相关的 2 个 hunk。`buildAskAnswerText` 死代码已随本次清理删除（回执与历史回显统一走 `splitAskAnswer`）。

## skills-settings-redesign（done，2026-10-26）

- Goal：重构设置页「技能」列表，让技能可扫、可筛选、可批量管理；最终交互按用户反馈定为「点击行打开居中详情弹窗」，不再使用右侧常驻详情栏。
- 结论（一句话）：`SkillsManagerPanel` 已重写为全宽筛选/来源分组列表 + 详情弹窗，保留 `/api/skills`、`/api/skills/content` 与全局/项目保存语义；宽窄屏、明暗主题与批量撤销均实机验证通过。
- 改动文件：
  1. `src/components/skills-dialog.tsx` — 重写技能管理面板：关键字/来源/状态筛选，按内置、个人（项目范围显示为项目）、插件分组；单行开关、筛选结果批量启用/停用与撤销 toast；重新扫描、搜索路径浮层与复制；点击行通过 portal 打开居中详情弹窗（概览/指令/元数据），`SKILL.md` 按需加载并以 markdown 渲染；保留串行保存队列、乐观更新、失败回滚和项目级 `SkillsDialog` 外壳。
  2. `src/styles/settings/skills.css`（新增）— 技能页布局、筛选工具条、分组吸顶头、行/开关、详情弹窗、markdown、toast、窄屏回退与 reduced-motion。
  3. `src/styles/index.css` — 在设置样式中登记 `skills.css`。
  4. `src/styles/settings/shell.css` — 新增 `quickforge-settings-stack-wide`（72rem），供列表型设置页使用。
  5. `src/lib/react-settings-tabs.tsx` — `SettingsPanel` 支持 `wide`，仅 Skills tab 启用；引入 `cn`。
  6. `src/lib/i18n.ts` — en/zh 同步新增技能页文案（筛选、批量、详情弹窗、元数据、搜索路径等），移除不再使用的详情占位文案。
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md` — 同步技能面板能力与新增样式模块。
  8. `docs/design/skills-settings-redesign.html` — 标注落地版将右侧详情改为点击行后的居中弹窗。
  9. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature 状态、验证与交接。
- 验证 / Evidence：
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.32s）。
  - `npx eslint src/components/skills-dialog.tsx src/lib/react-settings-tabs.tsx` → 无输出（0 error）。
  - `npm run lint` → 0 errors / 4 既有 warnings（`coverage/` 生成目录 3 个 unused disable + `usePinnedSummaryCapsule.tsx` exhaustive-deps，与本次无关）。
  - `npx vitest run tests/frontend/css-architecture.test.ts tests/frontend/motion-design.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 4 files / 43 tests passed。
  - `npm run test` → 398 个可运行测试文件全部通过（4664 passed / 1 skipped）；进程退出码为 1，原因是 31 个标注 `@vitest-environment jsdom` 的测试文件无法启动 fork worker：`Cannot find package 'jsdom'`。`jsdom` 已在 `package.json` devDependencies 中声明，但当前 `node_modules/jsdom` 未安装，属于环境缺失，与本次改动无关；未新增/升级依赖。
  - 实机视觉验证：使用隔离 `QUICKFORGE_DATA_DIR`/`QUICKFORGE_WORKSPACE_DIR` 启动 dev server，Headless Chrome 在 1440×900 与 900×900 下检查明/暗主题。页面宽度分别为 832px / 587px；详情弹窗 605px 宽、聚焦容器无多余 focus ring；筛选、来源菜单、指令 markdown、元数据、批量启用（1/4 → 4/4）与撤销（回到 1/4）均正常，浏览器控制台无错误。
- Notes：
  - 验证使用的示例技能只写入临时数据目录，没有触碰真实用户技能与配置；未创建 Git commit / tag / push，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`npm run build` 正常生成 `dist/`）。
  - 详情弹窗通过 `createPortal(document.body)` 渲染，避免项目级 `SkillsDialog` 的 `overflow-hidden` 与动画 transform 裁剪；关闭由 ESC、关闭按钮或点击遮罩触发。
  - 打开弹窗后焦点落在对话框容器（`tabIndex=-1`），Tab 可进入开关/标签页/操作按钮；未额外实现焦点陷阱。
  - 全量测试的 jsdom 缺失若需修复，应安装既有 devDependency（如 `npm install`），本次按“不新增/升级依赖”约束未处理。

## default-context-window-1m（done，2026-10-26）

- Goal：把 QuickForge 默认模型配置的上下文窗口从 200000 改为 1000000（1M）。只改默认值，不动 `modelId`，不加设置项，不重构无关代码。
- 结论（一句话）：`DEFAULT_CONNECTION.contextWindow` 由 `200000` 改为 `1000000`，所有回退点（`buildConnectionModel`、`CustomProvidersSettingsTab` 的模型表单默认/回退/保存归一化）自动跟随该常量，`maxTokens` 保持 `32768` 不变。
- 改动文件：
  1. `src/lib/pi-chat.ts` — `DEFAULT_CONNECTION.contextWindow: 200000 → 1000000`（单行 diff）。
  2. `progress.md` — 本条记录。
  3. `session-handoff.md` — 同步本次会话目标/改动/验证。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/settings-workspace-react.test.ts tests/frontend/side-chat-agent.test.ts tests/frontend/context-usage.test.ts` → 3 files / 36 tests passed。
  - `npm run lint` → 0 errors / 4 warnings（3 个 `coverage/` 生成目录 Unused eslint-disable + 1 个既有 `usePinnedSummaryCapsule.tsx` exhaustive-deps，均与本次改动无关）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.66s）。
- Notes：
  - 全仓库 `200000` / `200_000` grep 结论：无任何测试断言“默认值本身”，命中的都是无关常量或测试内联值，未做改动——`src/lib/auto-compact-settings.ts:48`（自动压缩 `minSourceChars` 上限）、`server/auto-compaction.mjs:44,237`（同上限 clamp）、`src/components/workspace/side-chat-agent.ts:9` + `server/routes/side-chat.mjs:12` + `server/routes/workspace-browser-service.mjs:30`（侧聊/搜索字符预算与行数护栏）、`tests/frontend/side-chat-agent.test.ts:16`（测试内联 `contextWindow: 100_000`）、`tests/frontend/settings-workspace-react.test.ts:21`（`DEFAULT_CONNECTION` 为 mock，`contextWindow: 128000`，与真实常量解耦）。`dist/`、`package-dist/`、`package-offline/`、`coverage/` 内的同名命中属生成产物，按约束未触碰。
  - `src/lib/i18n.ts` 只有 `contextWindow: 'Context Window'` 标签文案（en/zh 两处），没有写死 `200000` 或 “200K” 的表述，因此未改。
  - 遗留风险（未修改，仅记录）：`server/conversation-compaction.mjs:203-206` 的压缩 transcript 上限为 `Math.min(160000, Math.max(12000, Math.floor(contextWindow * 1.6)))`，即使 `contextWindow` 提升到 1M 也被 160000 字符硬顶，长会话压缩摘要的输入广度不会随 1M 窗口放大；另外 `maxTokens` 仍为 32768，1M 窗口下单次输出上限不变（本次按最小改动原则不动）。
  - 未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`；`feature_list.json` 当前为空（`{"features":[]}`），无对应 feature 条目，未改动。
