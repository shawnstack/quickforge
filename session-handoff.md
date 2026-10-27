# Current Session Handoff

## background-tasks-sidebar · 跟进 2（入口重构，done，2026-10-27）

- Current Objective（当前目标）：把「打开后台任务面板」的入口收敛为置顶摘要「后台命令」区块 + Composer 左下角命令图标两处，删除会话顶栏入口与 Composer 浮层。
- 结论（一句话）：入口重构已完成——`ConversationHeader` 的后台任务图标（含运行中徽标）删除；置顶摘要区块提供「查看全部」+ 整行命令主体两个入口；Composer 终端图标（`.quickforge-background-command-trigger`）改为直接打开右侧面板，`openBackgroundCommandMenu` 与 `.quickforge-background-command-menu` 样式已删；新增 `src/lib/background-tasks-open.ts` 事件桥（`quickforge:open-background-tasks`），`App.tsx` 只接受当前会话或缺省 `sessionId` 的请求后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`。
- 改动文件：`src/components/app/ConversationHeader.tsx`（删除入口）；`src/components/git/PinnedSummarySections.tsx` + `src/components/git/GitToolsPinnedSummary.tsx`（「查看全部」+ 整行按钮 + 兄弟停止按钮，`onOpenBackgroundTasks` 透传）；`src/components/chat/panel-decoration/subagent-running-indicator.ts`（图标改 `dispatchOpenBackgroundTasks`）；`src/styles/chat/composer-controls.css`（删浮层样式）；`src/lib/background-tasks-open.ts`（新增）、`src/App.tsx`、`src/lib/i18n.ts`；`tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/subagent-running-indicator.test.ts`；`docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/lib/README.md`；`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npx tsc -b` 通过；`npx eslint` 相关改动文件 0 error；`npx vitest run` 相关 5 个测试文件 79 passed；`npm run build` 成功（3.39s）。
- Blockers（阻塞）：无。
- Next Session（下一步）：可选——后台命令输出改为 SSE 流式推送（替掉 2s 轮询）；把 Terminal Dock 与后台任务面板统一为「任务中心」。已知保留项：`renderBackgroundCommandItems` 仍被 subagent 运行浮层复用，`.quickforge-background-command-item/-copy/-stop/-log` 样式不能一并删。未创建 Git commit，未触碰生成产物。

## present-files-inline-links（done，2026-10-26）

- Current Objective（当前目标）：`present_files`（展示文件）工具卡去掉右上角眼睛（预览）按钮，改为摘要区逐文件「文件图标 + 文件名」，文件名 hover 出下划线、点击跳转预览；范围只限 present_files。
- 结论（一句话）：删除 `renderPreviewButton`，新增 `renderPresentedFilesSummary(params)` 在摘要区逐文件渲染可点文件名（复用 `previewArtifactClickHandler` → `PREVIEW_ARTIFACT_EVENT` 与 `underline-offset-4 hover:underline` 文案），不可预览/工作区外路径纯静态；动作区只剩终止命令按钮。
- 改动文件：`src/lib/tool-renderers/shared.tsx`、`src/lib/tool-renderers/local-workspace-tool-renderer.tsx`、`tests/frontend/tool-renderer-file-icon.test.ts`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）：`npx tsc -b` 0 错误；定向 vitest 4 files / 39 passed；`npx eslint` 改动文件 0 error；`npm run lint` 0 error / 3 存量 warning；`npm run build` 成功；`npm run test` 402 files / 4731 tests（4727 passed / 3 failed / 1 skipped）——3 个失败在 `background-tasks-tab.test.ts` 与 `subagent-running-indicator.test.ts`，断言对象是工作区里其他未提交改动（`App.tsx` 缺 `kind: 'background-tasks'` 等），与 `tool-renderers/*` 无交集；另有 31 个 jsdom 缺包既有错误。
- Blockers（阻塞）：无。
- Next Session（下一步）：如需可视化确认，可启动应用查看 present_files 卡片在窄列下的换行表现（逐文件 `inline-flex` + 裸文本逗号分隔）；顺带清理与本轮无关的 `background-tasks-tab.test.ts` / `subagent-running-indicator.test.ts` 失败（属另一份未提交改动）。未创建 Git commit，未触碰生成产物。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Current Objective（当前目标）：
- 结论（一句话）：
- 改动文件：
- Evidence（验证）：
- Blockers（阻塞）：
- Next Session（下一步）：未创建 Git commit，未触碰生成产物。

## background-tasks-sidebar（done，2026-10-26）

- Current Objective（当前目标）：把后台运行命令的运行态与历史收进右侧边栏，提供筛选/搜索/详情/日志预览/跟随输出/停止，并补齐 docs/wiki、progress、feature 记录。
- 结论（一句话）：Inspector 新增 `background-tasks` 运行时 Tab（单实例复用、不持久化），运行中取 `backgroundCommands` 快照、终态由 `toolResult` 消息 `details` 派生，未新增服务端接口；顶栏 Activities 入口带运行中数量徽标。
- 改动文件：`src/lib/background-tasks-model.ts`（新增）；`src/components/workspace/BackgroundTasksTabContent.tsx`（新增）；`src/components/workspace/WorkspaceInspector.tsx`、`workspace-panel-tabs.ts`、`workspace-inspector-tabs.ts`、`useInspectorTabs.ts`；`src/components/app/ConversationHeader.tsx` + `src/App.tsx`；`src/styles/workspace/background-tasks.css`（新增）+ `src/styles/index.css`；`src/lib/i18n.ts`（新增面板文案，清理未使用的 `backgroundTaskTabLabel` en/zh 各一行）；`tests/frontend/background-tasks-model.test.ts`、`tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/server-agent-background-commands-frame.test.ts`（新增，6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 合并）；docs/wiki 四处（components、styles、server、server/tools）；`feature_list.json` / `progress.md` / 本文件。
- Evidence（验证）：`npm run test` → 402 files passed / 4722 tests passed（1 skipped），退出码 1 仅来自 31 个 `Cannot find package 'jsdom'` 的既有环境错误（31 个 `@vitest-environment jsdom` 测试文件的 worker 启动失败，无真实断言失败），其余断言全过；`npm run lint` 0 error / 3 存量 warning；`npm run build` 成功（3.78s）。
- Blockers（阻塞）：无。`npm run test` 仍有 31 个 `Cannot find package 'jsdom'` 的既有环境错误（`jsdom` 已声明为 devDependency 但未安装），与本改动无关。
- Next Session（下一步）：可选——后台命令输出改为 SSE 流式推送，替掉 2s 轮询；把 Terminal Dock 与后台任务面板统一为「任务中心」。已知限制：`backgroundTasks` 为服务端内存 Map，重启后终态丢失；`settleBackgroundCommandToolResult` 找不到对应 `toolResult` 消息时返回 false，该任务不进面板终态；`listBackgroundCommandTasks` 仍只返回 running（idle 回收语义依赖）。未创建 Git commit，未触碰生成产物。

- 跟进（2026-10-27，后台任务面板样式对齐 + 入口统一）：
  - Current Objective（当前目标）：把后台任务面板的横向基准、控件高度、间距与字号刻度对齐 Inspector 其余 tab（与 `workflow-detail.css` 同轴），消除切 tab 横跳与工具栏 1px 高低差；同时把入口收敛到一处。
  - 结论（一句话）：`background-tasks.css` 重写为 0.875rem 基准 + 1.625rem 控件同高 + 1/16 网格间距 + 4 档字号；行内操作与元信息共用网格第三列修掉压字；Composer 命令图标改为派发 `quickforge:open-background-tasks` 窗口事件，删除浮层菜单与顶栏后台任务入口。
  - 改动文件：`src/styles/workspace/background-tasks.css`（重写：0.875rem 水平基准、输出区三级统一 0.5rem、分段控件 1.375rem + 0.125rem 内距 = 搜索框 1.625rem、间距回到 0.375/0.5/0.75、字号 4 档 0.6875/0.75/0.8125/0.875、`.item-meta` 与 `.item-actions` 共用 `grid-template-columns: auto minmax(0,1fr) minmax(3.5rem, auto)`、选中态不显示行内操作、命令单行 ellipsis + `title`、详情头恢复 `border-bottom`、meta `padding-bottom: 0.5rem`、输出区 `min-height: 4rem` + `.detail { overflow: hidden }`、新增 `.quickforge-background-tasks-no-results`、`pointer: coarse` 图标按钮 2rem、`:focus-visible` / `:hover` 过渡与 reduced-motion）；`src/lib/i18n.ts`（`backgroundTaskElapsed` → `backgroundTaskMetaElapsed`，新增 `backgroundTaskNoResults`）；`src/components/workspace/BackgroundTasksTabContent.tsx`（详情命令加 `title`、footer 提示加单行截断类）；`src/lib/background-tasks-open.ts`（新增窗口事件入口）；`src/App.tsx`、Composer 命令图标、`src/components/app/ConversationHeader.tsx`（删除 `openBackgroundCommandMenu` 浮层与顶栏入口）；`tests/frontend/background-tasks-tab.test.ts`；`docs/design/background-tasks-align-preview.html`（新增对齐校验页）；`progress.md` / 本文件。
  - Evidence（验证）：`npx tsc -b` 通过；`npm run lint` 0 error（3 条 warning 在 `coverage/` 生成目录，存量）；`npm run build` 通过；`npx vitest run tests/frontend/` → 228 个文件中 227 通过，唯一失败 `tests/frontend/custom-providers-tab.test.ts` 属另一并行 feature（与本次无关），31 个 jsdom 缺包 worker 启动失败属既有环境问题；后台任务相关 67 个用例全绿。
  - Blockers（阻塞）：无。
  - Next Session（下一步）：可在实机上按 `docs/design/background-tasks-align-preview.html` 复核 340/380px 窄列与亮暗主题；日志预览仍是 2s 轮询，如需流式再单独排期。未创建 Git commit，未触碰生成产物。

## models-providers-layered-settings（done，2026-10-26）

- Current Objective（当前目标）：按 `docs/design/models-providers-settings-redesign.html` 把「模型与提供商」设置页重构为提供商列表 / 连接 / 模型三层，各层独立保存。
- 结论（一句话）：前端拆为编排器 + `settings/custom-providers/` 三层组件（存储结构不变、连接层保存迁移改名密钥），服务端新增 provider-test / provider-discover，窄屏详情变抽屉。
- 改动文件：`src/components/settings/tabs/CustomProvidersSettingsTab.tsx`（重写）；`src/components/settings/custom-providers/`（shared / provider-list-pane / provider-detail-pane / connection-section / model-list-section，新增）；`src/styles/settings/custom-providers.css`（新增）+ `src/styles/index.css`；`server/routes/models.mjs` + `server/index.mjs`（两个新接口）；`src/lib/i18n.ts`；`tests/frontend/custom-providers-tab.test.ts`（新增）+ `tests/frontend/settings-workspace-react.test.ts`；docs/wiki 三处；`feature_list.json` / `progress.md` / 本文件。
- Evidence（验证）：目标测试 28 passed（13 新用例 + 15 既有契约）；`npm run test` 399 files / 4684 tests 全过（31 个 jsdom 缺包 Unhandled Error 为存量）；`npm run lint` 0 error；`npm run build` 成功。
- Blockers（阻塞）：无（jsdom 环境缺失沿用 skills-settings-redesign 记录，待统一 `npm install`）。
- Next Session（下一步）：已做一轮视觉打磨（协议分段不换行并与输入框等高对齐、密钥行三段纵排、模型行徽标垂直居中、字号刻度统一、协议短标签）；剩余可选项——实机视觉走查三层布局与窄屏抽屉；自动发现类型（ollama/llama.cpp/vllm/lmstudio 的一等入口，store 类型已支持）与 provider 级连接状态持久化（当前仅会话内）。未创建 Git commit，未触碰生成产物。

## ask-user-echo-fix（done，2026-10-26）

- Current Objective（当前目标）：修复 ask_user 工具最后补充内容不回显的问题，按 `docs/design/ask-user-echo-fix.html` 方案 A 落地。
- 结论（一句话）：回执改为选项 chip + 独立补充段两段语义；跳过/超时 `answers: null` 也渲染回执并保留 `remark`；待答卡补充框显示「已填写」并预展开；Enter 增加 IME `isComposing` 守卫。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`；`src/lib/tool-renderers/ask-user-tool-renderer.tsx`；`src/styles/chat/interaction-cards.css`；`src/lib/i18n.ts`；`tests/frontend/ask-user-card.test.ts`；`tests/frontend/ask-user-renderer-remark.test.ts`；`docs/design/ask-user-echo-fix.html`；`docs/wiki/src/components/README.md`；`docs/wiki/src/lib/README.md`；`docs/wiki/src/styles/README.md`；`feature_list.json`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：目标测试 36 passed；ask_user 回归面 6 files / 103 tests passed；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。
- Blockers（阻塞）：无。验证期间存在并行的 CustomProviders 重构，已延时等待收敛；`npm run test` 全量仍有 31 个 `Cannot find package 'jsdom'` 既有环境错误（`jsdom` 已声明为 devDependency 但未安装）。
- Next Session（下一步）：可补 ask-user 卡片的按钮点击级行为测试（当前只有源码字符串断言 + 历史回执静态渲染）。未触碰生成产物。

## skills-settings-redesign（done，2026-10-26）

- Current Objective（当前目标）：重构设置页「技能」列表，最终按用户反馈改为「点击技能行打开居中详情弹窗」。
- 结论（一句话）：技能页现为全宽筛选/来源分组列表；点击行通过 portal 打开详情弹窗（概览/指令/元数据），批量启停、撤销、重新扫描和搜索路径均可用，原 Skills API 语义未变。
- 改动文件：`src/components/skills-dialog.tsx`；`src/styles/settings/skills.css`（新增）；`src/styles/index.css`；`src/styles/settings/shell.css`；`src/lib/react-settings-tabs.tsx`；`src/lib/i18n.ts`；`docs/wiki/src/components/README.md`；`docs/wiki/src/styles/README.md`；`docs/design/skills-settings-redesign.html`；`feature_list.json`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：`npm run build` 成功；`npx eslint src/components/skills-dialog.tsx src/lib/react-settings-tabs.tsx` 通过；`npm run lint` 0 error / 4 既有 warning；目标测试 43 passed；全量测试 398 files / 4664 tests passed，但退出码 1 来自缺失 `node_modules/jsdom` 的 31 个 jsdom 环境测试（依赖已在 devDependencies，未安装，与本次无关）。隔离数据目录 + Headless Chrome 在 1440×900 / 900×900、明暗主题验证筛选、弹窗、markdown、批量启用与撤销，控制台无错误。
- Blockers（阻塞）：无（jsdom 全量测试环境缺失待后续统一安装既有 devDependency）。
- Next Session（下一步）：如需继续打磨，可补充技能组件级交互测试（当前无 skills-dialog 渲染测试）；可评估详情弹窗焦点陷阱与关闭后焦点回到原技能行。未创建 Git commit，未触碰生成产物。

## default-context-window-1m（done，2026-10-26）

- Current Objective（当前目标）：把默认模型配置的上下文窗口从 200000 改为 1000000（1M），只改默认值，不动 `modelId`、不加设置项、不重构无关代码。
- 结论（一句话）：`DEFAULT_CONNECTION.contextWindow` 改为 `1000000`，全部回退点自动跟随，`maxTokens` 保持 `32768`。
- 改动文件：`src/lib/pi-chat.ts`（单行）、`progress.md`、`session-handoff.md`。
- Evidence（验证）：`npx vitest run tests/frontend/settings-workspace-react.test.ts tests/frontend/side-chat-agent.test.ts tests/frontend/context-usage.test.ts` → 36 passed；`npm run lint` → 0 errors / 4 既有 warnings；`npm run build` → 成功。
- Blockers（阻塞）：无。
- Next Session（下一步）：如需放大长会话压缩广度，评估 `server/conversation-compaction.mjs:203-206` 的 160000 字符硬上限；`maxTokens` 仍为 32768。未创建 Git commit，未触碰生成产物。
