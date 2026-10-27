# Progress

按时间倒序追加。每个 feature 一段，完成后在此留档。

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
