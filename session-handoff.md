## 当前交接：修复排队消息切换 session 后不发送（2026-09-22）

- 当前目标（已完成，待真机验收）：排队消息切换 session 后不发送、永久滞留 localStorage。根因：自动发送唯一触发是当前面板订阅的 agent_end（ChatPanelHost :1650-1663），切换 session 的 cleanup 只做「取消 250ms 定时器 + 在途条目回队首 + 存回 localStorage」并退订事件，切走后原会话回合结束无人 drain；切回只 hydrate 不补发。修复为后台自动续发 + 切回兜底：① 新增 `src/lib/message-queue-drainer.ts`（drainStoredMessageQueue / pauseStoredMessageQueue：localStorage 顺序逐条发送、per-session 单飞防并发、成功删条目持久化（写前重读保留新入队）、失败保队头置 paused、流式中不抢发、永不抛错）；② `useAgentManager` 后台 task 的 agent_end：非 aborted/error → drain 后台续发，aborted/error → pause 暂停（主路径）；③ `ChatPanelHost` effect cleanup 在最后 save 之后：队列非空未暂停且回合已结束 → drain（修定时器被 cleanup 取消的竞态）；④ 挂载 hydrate 后空闲 + 队列非空未暂停 + 无 timer/inFlight → 复用 250ms submitQueuedPrompt 调度（切回兜底）。既有语义零改动（aborted/error 暂停、失败回队头暂停、防抖持久化、测试锁定字符串）。
- 改动文件：`src/lib/message-queue-drainer.ts`、`src/hooks/useAgentManager.ts`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/message-queue-drainer.test.ts`（新建 8 用例）、`tests/frontend/message-queue.test.ts`（+3 源码契约 it，既有 17 it 零改动）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/hooks/README.md`。
- 验证：全量 `npm run test` → **376 files / 4495 passed + 1 skipped（exit 0）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**；定向 2 files / 28 passed + 护栏 20 passed（`npx tsc -b` / `npx eslint` 改动文件均 exit 0）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：流式中 Enter 入队 → 切走 session，确认原会话回合结束后排队消息在后台逐条自动发出；abort/出错回合后队列暂停（切回见暂停态）；切走瞬间回合已结束的场景消息也发出；切回空闲会话时兜底续发；② 已知边缘（不修）：agent_end 恰落在 setAgent 与 effect cleanup 微窗口的双发风险；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：发布 2.2.0（2026-09-22）

- 当前目标：发布 2.2.0 版本。发布准备已完成：版本递增 2.2.0、CHANGELOG/README 更新、全量验证通过、runtime/offline 离线包生成。
- 改动文件：`package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npm run test` → **375 files / 4484 passed（exit 0）**；`npm run lint` → **0 errors / 0 warnings（exit 0）**；`npm run build` → **exit 0**；离线包 `package-offline/shawnstack-quickforge-2.2.0.tgz` 已生成。
- Blocker：无。
- 下一步：git commit `chore(release): v2.2.0` + tag `v2.2.0` + push；之后按用户指令执行 npm publish（默认不直接发布）。

---
## 历史交接：修复运行中点击「思考过程」文字无法展开思考块（2026-09-21）

- 当前目标（已完成，待真机验收）：流式（运行中）期间点击思考块 header 的「思考过程」文字无法展开。根因：`decorateProcessThinkingBlocks` 流式期间每帧重跑写路径（重写 `label.textContent` + prepend/append 重排 header 子级）与 click 事件派发竞态。修复：① `src/components/chat/surface/ThinkingBlock.tsx` header 按钮新增 `onPointerDown` 切换（不 preventDefault，保留原生 focus 等默认行为），`onClick` 仅 `e.detail === 0`（键盘 Enter/Space 或程序触发）时切换、`e.detail > 0`（真实鼠标 pointerdown 之后重复派发的 click）忽略——对齐 `shouldToggleProcessSummary` 的 pointerdown 优先先例；② `src/components/chat/panel-decoration/process-folding.ts` `decorateProcessThinkingBlocks` 幂等 no-op：header 已接管、三槽位类名就位、文案一致且子级顺序已是 `[icon, label, chevron]` 时短路 return，跳过全部 DOM 写操作，消除流式期间每帧 DOM churn（React 重渲染重写 class 属性后条件自然失效、回落完整接管）。
- 改动文件：`src/components/chat/surface/ThinkingBlock.tsx`、`src/components/chat/panel-decoration/process-folding.ts`、`tests/frontend/thinking-header-adoption.test.ts`（新增幂等 no-op 用例）、`tests/frontend/thinking-block-interaction.test.ts`（新建 3 用例）、`docs/wiki/src/components/README.md`（思考头接管契约条目两份副本）、`docs/wiki/src/lib/README.md`（tool-display-settings 条目交叉引用）、`feature_list.json`（新增 thinking-header-streaming-click-fix，done）、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run`（thinking / process 相关）→ **7 files / 132 passed（exit 0）**；`npx eslint` 改动文件 → **exit 0**；`npx tsc -b` → **exit 0**。未跑全量 test/build（定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：运行中（流式）点击「思考过程」文字可展开/收起思考块；header 聚焦时键盘 Enter/Space 可切换；运行结束后点击同样正常；② 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：定时任务详情视图「最近执行」精简——与历史 tab 同规格，仅保留跳转（2026-09-21）

- 当前目标（已完成，待真机验收）：任务列表点击进入的「任务详情视图」里「最近执行」区域与上轮历史 tab 同规格精简——每条 run 由 `<details>/<summary>` 展开结构（展开体 renderRunDetails：执行 Agent/warning/输入内容/AI 结果/错误信息/耗时）改为紧凑行：`rounded-lg bg-muted` 行内「开始时间 + 状态 badge」+ 行尾「查看对话」icon-action 跳转按钮（有 sessionId enabled、无 sessionId disabled 灰 + t('runNoSession')，常驻渲染宽度稳定）；触发方式与全部 run 明细字段不再渲染（会话里仍可见）。组件统一：抽出 `renderRunConversationAction(run)` 共用渲染函数，历史 tab 行尾与详情视图 run 行同一实现。`renderRunDetails` 整体删除；i18n EN/ZH 成对删除 `runInputContent`/`runAiResult`（grep 确认无引用）；`executionAgent`（详情任务信息网格）/`runDuration`（历史表头）保留。详情视图其余部分（返回/标题/scheduleRule/状态与模式 badge/任务内容/任务信息网格/编辑/删除 danger/lastSessionId 跳转）零改动。
- 改动文件：`src/components/scheduled-tasks/ScheduledTasksPage.tsx`（+18 -30：紧凑 run 行 + 共用跳转按钮函数 + 删 renderRunDetails）、`src/lib/i18n.ts`（EN/ZH 删 runInputContent/runAiResult）、`tests/frontend/scheduled-tasks-page.test.ts`（+39 新增详情视图用例：enabled/disabled 语义 + 点击跳转 + 明细不出现护栏 + 无 summary 节点）、`feature_list.json`（scheduled-tasks-history-compact-rows 条目追加第二轮）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/scheduled-tasks-page.test.ts` → **1 file / 20 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 三改动文件 → **exit 0**；`npm run test` → **374 files / 4480 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs flaky 本轮未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（ScheduledTasksPage chunk 41.73 kB，仅既有 chunk size 警告）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：定时任务 → 任务列表点击某任务进详情——「最近执行」区每条 run 为一行（时间 + 状态 badge + 行尾对话图标），无展开交互、无 Agent/输入/AI 结果/错误/耗时明细；有会话图标可点跳转并关闭设置页、无会话灰色禁用 + tooltip「该次执行没有对话记录」；② 上轮历史 tab 精简与跳转闭环真机验收项见下两条历史交接；③ `tests/server/scheduled-tasks.commands.test.mjs` 偶发超时 flaky 仍待单独排查（本轮未复现）；④ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：定时任务执行历史行精简——去展开详情、仅保留「查看对话」（2026-09-21）

- 当前目标（已完成，待真机验收）：定时任务「执行历史」tab 行不再可展开（原整行点击展开 renderRunDetails：执行 Agent/warning/输入内容/AI 结果/错误/耗时大段字段），改为非交互普通行；行尾常驻「查看对话」icon-action 按钮（MessageSquare size-4，title/aria-label=t('viewConversation')，onClick → onOpenSession，复用上一轮预检+关闭设置页+不存在提示链路）；无 sessionId（创建会话前失败的 run）时按钮 disabled 灰 + title/aria-label 切新 key `t('runNoSession')`（mcpBuiltinNoDelete 同模式，行操作区宽度稳定）。删除 expandedRunId state；`renderRunDetails` 保留（任务详情视图「最近执行」仍用）；任务列表 tab、筛选、分页、加载/空态、详情视图零改动；耗时保留为紧凑列，errorMessage 不在历史行展示（最简）。
- 改动文件：`src/components/scheduled-tasks/ScheduledTasksPage.tsx`（+21 -11：删展开状态/展开区、历史行改普通 grid+行尾 icon 按钮、import MessageSquare）、`src/lib/i18n.ts`（EN/ZH 新增 runNoSession 紧邻 viewConversation；无删除 key，runInputContent/runAiResult/executionAgent/runDuration 仍被详情视图引用）、`tests/frontend/scheduled-tasks-page.test.ts`（render() 扩展可选 onOpenSession + 新增 1 用例：有 sessionId enabled+点击跳转 / 无 sessionId disabled+runNoSession 标签+点击无副作用 / 无展开详情文本护栏）、`feature_list.json`（新增 scheduled-tasks-history-compact-rows，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/scheduled-tasks-page.test.ts` → **1 file / 19 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 三改动文件 → **exit 0**；`npm run test` → **374 files / 4479 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs flaky 本轮未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（ScheduledTasksPage chunk 42.77 kB，仅既有 chunk size 警告）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：定时任务 → 执行历史——行 hover 不再展开、行尾「查看对话」图标按钮（有会话可点跳转并关闭设置页、无会话灰色禁用 + tooltip「该次执行没有对话记录」）、行操作区各行宽度一致不跳动；② 上一轮跳转闭环（预检+sessionNotFound 提示）真机验收项见下条历史交接；③ `tests/server/scheduled-tasks.commands.test.mjs` 偶发超时 flaky 仍待单独排查（本轮未复现）；④ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：定时任务历史「查看对话」跳转完整体验（2026-09-21）

- 当前目标（已完成，待真机验收）：定时任务执行历史「查看对话」闭环——会话存在时自动关闭设置页并加载会话；不存在时留在历史记录页 `showAlert(t('sessionNotFound'))` 友好提示；预检失败不阻断跳转；加载返回 false（服务端 restore 404）兜底提示。新增纯逻辑模块 `src/lib/open-session-from-settings.ts`（依赖注入回调：closeSettingsPage / scheduleSessionLoad / loadSession / onMissingSession；预检 `getAppStorage().sessions.getMetadata(id)`，先例 ArchivedConversationsSettingsTab.tsx:119-122）；App.tsx 事件监听（`quickforge:open-session-from-settings`，定时任务页与系统通知点击共用）由 handleToastClick 改为专用 handleOpenSessionFromSettings（移至 closeSettingsPage 之后定义，hook 顺序静态一致；handleToastClick/ToastContainer 零改动）。
- 改动文件：`src/lib/open-session-from-settings.ts`（新建 +36）、`src/App.tsx`（+27 -10：import + 专用 handler + 监听迁移）、`tests/frontend/open-session-from-settings.test.ts`（新建 5 用例：空 id / 元数据 null 提示且不 close 不 load / 存在则 close+schedule+load / load false 兜底提示 / 预检抛错仍跳转；App 组件测试基建过重故抽纯函数，参照 system-notifications.test.ts mock 模式）、`feature_list.json`（新增 scheduled-tasks-open-session-jump，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/open-session-from-settings.test.ts` → **1 file / 5 passed（exit 0）**；`npm run test` → **374 files / 4478 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs flaky 本轮未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（仅既有 chunk size 警告）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：定时任务 → 执行历史 → 「查看对话」——存在会话应关闭设置页进入对话；删除/归档对应会话后点「查看对话」应留在历史页弹「未找到该对话。」；系统通知点击跳转同验证；② `tests/server/scheduled-tasks.commands.test.mjs` 偶发超时 flaky 仍待单独排查（本轮未复现）；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：定时任务设置页 UI 对齐 quickforge-settings 统一设计系统（2026-09-21）

- 当前目标（已完成，待真机验收）：ScheduledTasksPage（设置 → 定时任务 tab，调研确认仅存离群旧模式）重构为 quickforge-settings-* 设计系统，与 MCP 轮完全同构（基准 mcp-servers-dialog.tsx + mcp-server-card.tsx）。页面自建滚动容器移除改单 section（宿主 SettingsPanel stack 承载）；列表/历史视图 toolbar（Clock 图标 + 标题/描述 + badge 计数 + segmented 双 tab + primary 新建）；任务行 list-item + meta badge 行 + settings-switch（保留 aria-label）+ icon-action 菜单（定位逻辑不动）；历史筛选 form-grid + settings-select/input、状态 pill badge 语义色、分页 secondary-compact；编辑/新建 toolbar + fieldset disabled 保留 + form-grid 全量 settings 表单控件 + AI 解析/追问 warning/解析成功 message + 周重复 segmented + 底部 row-control；详情 toolbar + 底部 row-control（删除 button-danger 仅 hover 红）。statusClass→statusBadgeClass 语义映射；硬编码文案 3 处 t() 化（requestFailed 既有 + 新 key taskNeedMoreInfo + taskCronExpression 复用）；图标统一 size-4。功能逻辑零改动（useState/useRef/useEffect 次序数量、API/防抖/确认/分页逐字未动）。
- 改动文件：`src/components/scheduled-tasks/ScheduledTasksPage.tsx`（+402 -397）、`src/lib/i18n.ts`（EN/ZH 新增 taskNeedMoreInfo）、`tests/frontend/scheduled-tasks-page.test.ts`（switch 用例适配 checkbox 断言，语义保留；其余 17 用例零改动）、`feature_list.json`（新增 scheduled-tasks-ui-design-system-alignment，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run` scheduled-tasks-page + scheduled-task-form + semantic-color-class-parity → **3 files / 50 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 三改动文件 → **exit 0**；`npm run test` → **373 files / 4473 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs 本轮 flaky 未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（仅既有 chunk size 警告）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收定时任务设置 tab：列表 toolbar（图标标题+描述+计数徽标+segmented 双 tab+新建按钮）、任务行 hover/badge 语义色（enabled 绿/running 蓝/paused 黄/failed 红/completed 灰）、switch 启停与 pending 禁用、icon-action 菜单（执行/编辑/详情/删除）、行点击进详情、编辑页表单（AI 解析、周重复 segmented、保存禁用逻辑）、历史筛选/表格/分页、详情页底部按钮（删除仅 hover 红）；② `tests/server/scheduled-tasks.commands.test.mjs` 偶发超时 flaky 仍待单独排查（本轮未复现）；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：MCP 服务卡片 builtin 删除按钮禁用常驻 + 操作区图标对齐修复（2026-09-21）

- 当前目标（已完成，待真机验收）：用户反馈两问题——① 内置 Playwright 卡片与普通卡片操作区图标位置不对齐（list-item-actions 为 flex 0 0 auto 右对齐、宽度随内容变化，builtin 此前少渲染一个删除按钮导致各卡片编辑/删除图标 x 位置错位）；② builtin 隐藏删除按钮布局错位。修复：所有卡片统一渲染删除按钮，builtin 时 `disabled={server.builtin}` 灰色禁用不可点击（opacity 0.58 + cursor not-allowed，沿用 settings-button:disabled 模式），aria-label/title 用新 i18n key `mcpBuiltinNoDelete`（EN: Built-in services cannot be deleted / ZH: 内置服务不可删除）；onClick 保留由原生 disabled 拦截（与重连按钮同模式）；后端 409 builtin 删除保护不动。
- 改动文件：`src/components/mcp/mcp-server-card.tsx`（删除按钮无条件渲染 + builtin disabled + 新 aria-label/title）、`src/index.css`（icon-action 规则就近新增 `:disabled` 变体 + 两条 hover 补 `:not(:disabled)` 守卫）、`src/lib/i18n.ts`（EN/ZH 新增 mcpBuiltinNoDelete）、`tests/frontend/mcp-server-card.test.ts`（builtin 断言改「存在但 disabled」、普通服务断言 disabled=false + handler 正常、NodeProps 补 disabled）、`feature_list.json`（mcp-settings-ui-design-system-alignment 条目追加修复轮 + files 补 src/index.css）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run mcp-server-card + semantic-color-class-parity` → 2 files / 10 passed（exit 0）；`npm run test` → **373 files / 4473 passed + 1 skipped（exit 0）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（仅既有 chunk size 警告）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收 MCP 设置 tab：内置 Playwright 卡片删除按钮灰色禁用（hover 无反馈、tooltip「内置服务不可删除」）、普通卡片删除正常红 hover + 点击确认删除、builtin 与普通卡片操作区图标列对齐；② `tests/server/scheduled-tasks.commands.test.mjs` 全量偶发超时 flaky（上轮已记录，本轮未复现），待后续单独排查；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：MCP 服务设置 UI 对齐 quickforge-settings 统一设计系统（2026-09-21）

- 当前目标（已完成，待真机验收）：McpServersPanel/McpServerCard/McpServerForm 从自制 Tailwind 卡片 + emerald 开关 + ui/Button ghost icon 旧模式重构为 quickforge-settings-* 设计系统（基准 CustomProvidersSettingsTab.tsx）。功能全保留：启停 PUT enabled、重连、编辑（表单+JSON 双 tab 双向同步）、删除 showConfirm 确认、builtin 删除隐藏保护；server/ 端与 mcp-helpers.ts 未动。
- 改动文件：`src/components/mcp-servers-dialog.tsx`（section+toolbar+list-item+segmented 双 tab+row-control 底部操作）、`src/components/mcp/mcp-server-card.tsx`（list-item-main/actions、settings-switch、badge-*、icon-action/-danger）、`src/components/mcp/mcp-server-form.tsx`（form-grid/form-row/form-label + input/textarea/select）、`src/lib/i18n.ts`（EN/ZH 新增 mcpServersDescription、mcpServersCount）、`tests/frontend/mcp-server-card.test.ts`（适配新 DOM+保留语义断言）、`feature_list.json`（新增 mcp-settings-ui-design-system-alignment，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run mcp-server-card + semantic-color-class-parity` → 2 files / 10 passed（exit 0）；`npm run test` → **373 files / 4473 passed + 1 skipped（exit 0）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收 MCP 设置 tab：toolbar（图标标题+描述+计数徽标+添加按钮）、服务行 hover/badge 语义色（connected 绿/error 红/其他 muted）、switch 启停与禁用态、icon-action hover（删除仅 hover 红）、编辑页 segmented 双 tab 与保存禁用逻辑；② `tests/server/scheduled-tasks.commands.test.mjs` 全量并行下偶发超时 flaky（本轮两次复现不同用例，单跑全过、干净工作区及复跑全过），与本次无关，已记 progress.md Notes，待后续单独排查；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：移除 run_subagent 摘要卡运行时加载 icon（2026-09-21）

- 当前目标（已完成，待真机验收）：外层 run_subagent 摘要卡（`src/lib/tool-renderers/subagent-tool-renderer.tsx` renderSubagentRunSummary）运行中不再渲染状态区（spinner icon + 耗时徽标）——第 51 行改为 `{payload.status === 'running' ? null : renderStatus(payload.status, payload.timing)}`，与 `local-workspace-tool-renderer.tsx:78` 既有模式一致；运行态仍由 statusLabel 文案 + 跑马灯表达。`shared.tsx` 的 renderStatus 共用实现未动（其他工具渲染器不受影响）；终态状态区渲染不变。
- 改动文件：`src/lib/tool-renderers/subagent-tool-renderer.tsx`（+2 -1）、`tests/frontend/chat-surface-css-contract.test.ts`（+12 新增运行中隐藏状态 icon 断言用例）、`docs/wiki/src/lib/README.md`（subagent-tool-renderer 条目同步）、`feature_list.json`（新增 subagent-summary-hide-running-status-icon，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run` chat-surface-render + chat-surface-css-contract + tool-renderer-registry + subagent-run-detail-react + local-tool-running-sweep → **5 files / 62 passed（exit 0）**；`npx eslint` 两改动文件 → **0 errors（exit 0）**。未跑全量 test/build（定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：运行 run_subagent 时摘要卡只有 statusLabel 文案 + 跑马灯（无旋转 spinner、无耗时徽标），运行结束/失败后状态 icon 与耗时恢复显示；② 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：对话 tools（process 折叠组）展开/收缩动效平滑化（2026-09-21）

- 当前目标（已完成，待真机验收）：process 折叠组三层 body（顶层过程组 / 内层 stage / 工具组）的展开/收缩由「display:none 直接切显隐」改为平滑高度过渡。`process-folding.ts` 新增 `quickforge-process-body-inner` 动画壳层（`PROCESS_BODY_INNER_CLASS` + `ensureProcessBodyInner` 幂等 helper；`createProcessToolsGroup` / `createProcessStage` / `createProcessGroup` / `populateProcessContainer` / `populateProcessGroup` / `appendProcessToolSuffix` 增量路径 / `updateProcessToolsGroups` 统计查询全部接线 inner；release / restore 未动）；`index.css` 三个 body 由共享 flex 规则拆出改 `display:grid` + `grid-template-rows 1fr`（先例 `.quickforge-assistant-artifact-card-details`），收起态 0fr + visibility 延迟隐藏，展开 `--quickforge-dur-base` 180ms / 收起 `--quickforge-dur-exit` 140ms + 同 ease-out，inner opacity 淡入淡出，`prefers-reduced-motion` 降级；原三条 display:none 收起规则删除，旧版 folded 兜底未动。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`、`src/index.css`、`tests/frontend/process-folding-incremental.test.ts`（断言改 inner 维度 + body 直接子级只有 inner 护栏）、`feature_list.json`（新增 process-fold-grid-animation，done）、`progress.md`、`session-handoff.md`。
- 验证：process-folding 三件套 + subagent-process-trace → **4 files / 76 passed（exit 0）**；chat-surface-tool-message + chat-surface-css-contract + thinking-header-adoption → **3 files / 39 passed（exit 0）**；message-actions → **45 passed（exit 0）**；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**。未跑全量 `npm run test`（定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收动效手感：折叠组展开/收缩高度过渡平滑（展开 180ms / 收起 140ms + ease-out）、无闪烁、收起后 0fr 区内不可 Tab 聚焦、`prefers-reduced-motion` 下直接切换；② 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：dependency-removal-parity-audit（done，2026-09-20 第二十三轮·依赖移除后的交互 Parity 审计与修复，分支 ui）

- 当前目标（已完成，feature **done**）：对「依赖移除（pi-web-ui / mini-lit / lit → 自研 React）后的交互与 CSS 一致性」做独立取证评审并修复真实回归。报告 `docs/reviews/dependency-removal-interaction-parity-audit.zh-CN.md`（基线 `HEAD=6d845ca` vs `BASE=3e10f58`；证据只用旧源码 + 旧构建产物 + 当前工作区）。五域 155 条对照（一致 107 / 回归-已修 11 / 有意保留 30 / 不可考证 7），落地 7 项修复：console 输出复制入口（1500ms、恒定 `Copy output`、可见 `Copied!`）、行中 `$$…$$` 块级公式、语法高亮 heading/list/code/quote/strong/emphasis 语义 + SVG 代码块 CSS、自动滚动 50/10 迟滞、代码块标题栏复制文案 `copyCode`/`copiedBang`、高亮分桶对齐旧 hljs、工具卡代码块复制反馈 + console 输出区每次 commit 置底（复刻旧 `.updated()`）。
- 改动文件：源码 7 个 `src/components/chat/scroll-sync.ts`、`src/components/chat/surface/CodeBlock.tsx`、`src/index.css`、`src/lib/chat-math.ts`、`src/lib/code-highlight.ts`、`src/lib/i18n.ts`、`src/lib/tool-renderers/shared.tsx`；测试 7 个 `tests/frontend/chat-code-block.test.ts`、`chat-math`、`chat-surface-css-contract`、`code-highlight`、`scroll-sync`、`tool-renderer-code-block`、`tool-renderer-shared-state`；文档/状态 `docs/reviews/dependency-removal-interaction-parity-audit.zh-CN.md`（新增报告）、`docs/wiki/src/README.md`、`docs/wiki/src/components/README.md`（两份副本）、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- 验证：`npm run test` → **364 files / 4373 passed + 1 skipped（exit 0）**；`npm run lint` → **0 errors / 3 warnings（exit 0，3 条 warning 均在 coverage/ 生成物）**；`npm run build` → **通过**（tsc -b 无诊断 + vite build 2.36s）；定向 7 个本轮测试文件 → 7 files / 169 passed；`git diff --stat -- package.json package-lock.json` 空（无依赖变更）。
- Blocker：无。
- 下一步：① **真机复验报告 §6.1 清单**（composer hover/active/聚焦反馈、设置下拉键盘与定位、弹窗 Escape 与焦点恢复、三档复制反馈时长手感 2000/1200/1500ms、自动滚动手感 50/10 + 500ms 意图窗口、console 输出区自动置底）；② **裁决报告 §4 中 17 条有意保留差异**（优先：过程折叠默认值与早期 R10 用户要求冲突、Esc 中止新增接线、`ui/Input` 聚焦 ring 可见变化、「未注册语言不再 highlightAuto」、composer placeholder 文案变更）；③ 若要收口 §6.2 的 7 条未修语法分桶残留，建议单开分片（嵌套围栏 `code`、`formula`、引用式链接定义、YAML `on/off/~`、各语言 literal 表）。
- rebase 适配（2026-09-21）：50/10 迟滞仅限普通尾随；锚定存活期内上滑立即脱离（见 progress.md 第二十三轮 Note h）。

---

## 历史交接：Hooks 执行记录持久化 + 分页收尾完成（2026-09-21）

- 当前目标（已完成）：Hooks 执行记录升级为持久化 + 分页：store `hook-executions`（`storage/hook-executions.json` 根数组；内存 buffer 权威、上限 300 条索引 0 最新、启动 fail-open 加载 + 3s 防抖落盘 + stop flush）；`GET /api/hooks/executions?limit=&offset=` 返回 `{executions,total,limit,offset}` 信封（limit 默认 20 clamp 1–100、offset 默认 0、缺省/不可解析回落默认、越界空页 total 不变）；前端 Hooks 页执行记录 20 条/页分页（页码/总数摘要、上下翻页、失败重试保留当前页）。上一轮已写入源码/测试/wiki 并重启 server 但无报告；本会话核实实际完成度、补齐三个状态文件并跑全量验证。
- 改动文件：源码/测试/wiki 上轮已就绪（`server/storage.mjs` rootArrayStores、`server/hooks/hook-engine.mjs`、`server/routes/hooks.mjs`、`src/components/settings/tabs/HooksSettingsTab.tsx`、`src/lib/i18n.ts`、3 个测试文件、3 个 wiki README，全量清单见 feature_list.json hooks-agent-events 条目）；本会话补 `feature_list.json` / `progress.md` / `session-handoff.md`。
- 验证：全量 `npm run test` → **373 files / 4447 passed + 1 skipped（exit 0）**；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**（HooksSettingsTab chunk 25.80 kB，仅既有警告）。server PID 55220（`node server/index.mjs`，01:40:15 启动 > 源码 mtime 01:31，已加载新代码）；curl `?limit=5&offset=0` 实测返回 `{"executions":[],"total":0,"limit":5,"offset":0}` 信封 ✓。
- Blocker：无。
- 下一步：① 真机验收：设置 → Hooks 页执行记录分页翻页/总数摘要/失败重试；配置命令 Hook（无副作用如 `node -e "..."`）触发事件观察记录产生与重启后保留；② 已知边界（不扩范围）：`atomicUpdate` 不支持 root-array store（引擎 flush 全量覆盖写）、通用 storage REST 顺带暴露 'hook-executions' 读写面；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：修复发送后用户消息锚定偶发失效（2026-09-20）

- 当前目标（已实现，待真机复测）：主聊天页「发送后用户消息锚定可视区顶部（12px 边距）」偶发失效（消息不在视口内）的健壮性修复，对外行为不变。三类竞态修复：① H2——`enableWithAnchor()` 弃用固定双 rAF（移除 scheduleAfterPaint 依赖），改为记录发送前最后一条 `.qf-user-message` 后按帧 rAF 轮询等待「新出现的」最后一条用户消息（无历史则等第一条），超时 1000ms 回退 `enable()` 贴底；② H1/H3——锚定激活期（spacer 存活期）不再钉死发送时 scrollTop，每次 ResizeObserver 更新以消息实时位置重导出 target/spacer（msgTopDoc = rect 差 + scrollTop；spacer = max(0, target + clientHeight − contentHeight)，>0 写 scrollTop = target），布局变化（折叠释放/重折叠、装饰注入、上方增减）下一帧自动校正；spacer 归零退出锚定回贴底；msgEl.isConnected=false 静默清理不报错；③ 浏览器原生滚动锚定互扰——`src/index.css` 给 `.qf-chat-panel > .qf-scroll-container` 加 `overflow-anchor: none`。
- 改动文件：`src/components/chat/scroll-sync.ts`（等待轮询 + 实时位置驱动锚定，322→391 行）、`src/index.css`（+1 规则）、`tests/frontend/scroll-sync.test.ts`（锚定用例重写 10→14，mock 虚拟时钟按帧推进 + rect 随 scrollTop 联动 + 可变消息列表）、`docs/wiki/src/components/README.md`（scroll-sync 小节两份副本 + 树条目行数同步）、`progress.md`、`session-handoff.md`。feature_list.json 未动（同 feature 内缺陷修复）。
- 验证：`npx vitest run tests/frontend/scroll-sync.test.ts` → **14 passed（exit 0）**；护栏 `tests/frontend/chat-surface-behavior-alignment.test.ts` + `tests/frontend/scroll-to-bottom-button.test.ts` → **17 passed（exit 0）**；CSS 契约（chat-surface-css-contract + chat-compact-controls）→ **37 passed（exit 0）**；`npx tsc -b --pretty false` → **exit 0**；eslint（scroll-sync.ts + 测试文件）→ **exit 0**。未跑全量 test/build（定向验证）。
- 实现取舍（偏离规格说明）：未启用锚定激活期常驻 rAF 跟随循环——识别的失效场景（fold 释放/重折叠、装饰注入、内容增减、H3 直写）均伴随被观察元素高度变化、由既有 ResizeObserver（观察滚动容器 + `.max-w-3xl` 内容列 + composer dock）在下一帧驱动 `refreshAnchor` 校正，避免 spacer 长存活时（短回复场景）每帧无条件 rect 读取；「总高度不变的内容上移/下移互换」类布局变化不在覆盖内（评估为极罕见，未引入常驻循环）。等待阶段轮询在找到目标或超时后即结束。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 复测偶发失效场景：主线程拥塞时连续发送（消息应仍锚定顶部 12px、1s 内未出现则回退贴底）、长会话带过程折叠的回合发送（折叠重算后消息不应停在视口外）、回复增长超屏自然推走、手动上滚不受影响；② 侧边聊天/分享页回归确认行为不变；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：Hooks 事件钩子功能收尾完成（2026-09-20）

- 当前目标（已完成，待真机验收）：设置页「Hooks」功能——按 Agent 事件（agent_start / agent_end / tool_execution_start / tool_execution_end / tool_approval_required / error）自动执行本地命令或发送 Webhook。前后端并行实现完成后，本轮做集成接缝核对、文档 wiki 同步、状态文件与全量验证。
- 接缝核对结论：① `/api/hooks/test` server 返回 `{ execution }` 信封而前端按裸 record 解析（测试结果会恒显示 timeout 标签）→ 已修正前端按信封解析；② `/api/hooks/executions` `{ executions }` 双端一致；③ 存储键双端均 `'hooks-settings'`；④ status 枚举 `success/error/timeout` 双端一致，`HookExecutionRecord.event` 类型对齐为 `HookEvent | 'test'`；⑤ 刷新链路（settings.set → PUT /api/storage/settings/key/hooks-settings → refreshHooksSettings，fail-open）✓；⑥ i18n 73 key en/zh 成对 ✓。另修正 HooksSettingsTab 10 处白名单外透明度语义色类为 color-mix 任意值写法（semantic-color-class-parity 护栏）。
- 改动文件（收尾轮）：`src/components/settings/tabs/HooksSettingsTab.tsx`（信封解析 + 'test' 守卫 + 8 处类名）、`src/lib/hooks-settings.ts`（event 类型）、`tests/frontend/hooks-settings-tab.test.ts`（信封 mock）、`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`（新增 hooks-agent-events，done）、`progress.md`、`session-handoff.md`。（feature 全量文件清单见 feature_list.json hooks-agent-events 条目。）
- 验证：针对性 Hooks 测试 → **6 files / 59 passed（exit 0）**；全量 `npm run test` → **373 files / 4431 passed + 1 skipped（exit 0）**；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**（HooksSettingsTab chunk 25.29 kB，仅既有警告）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：设置 → Hooks 页面新增/编辑/测试/开关，观察执行记录（命令 Hook 建议用无副作用命令如 `node -e "..."`）；② 遗留（V1 有意不做，见 feature boundaries）：执行记录仅内存 50 条不持久化、无项目限定、无拦截语义、Modal 无完整 focus trap；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：修复新添加项目行“新建对话”无反应（2026-09-20）

- 当前目标（已完成，待真机验收）：startNewProjectChat（`src/hooks/useChatActions.ts`）的 reusableBlankSession 判断只比较 activeProjectRef（UI 选中态），添加新项目流程只更新 activeProject 不替换 agent，导致旧项目的空白 DeferredSessionAgent 被误判为可复用 → 静默 return 'reused' 不建会话（点项目行“新建对话”无反应；刷新后 bootstrap 重建 agent 与 activeProject 对齐才正常）。修复：在 `instanceof DeferredSessionAgent` 分支之后增加 `currentAgent.project?.id === nextProject.id` 附加条件（+1 行，校验 agent 实际绑定项目）。
- 改动文件：`src/hooks/useChatActions.ts`（reusableBlankSession +1 条件）、`tests/frontend/project-new-chat-reuse-guard.test.ts`（新增 3 用例：源码契约断言 / 行为用例「agent 绑定项目 B、activeProject 为 C → 'created' 且 startDeferredSession 收到项目 C、不触发 switchActiveProject」/ 复用保留用例）、`feature_list.json`（新增 fix-project-new-chat-reuse，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run` 新增测试 + 相关既有（sidebar-new-chat-routing / deferred-session-agent / workspace-inspector-tabs）→ **4 files / 34 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint`（两改动文件）→ **exit 0**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：添加新项目后不刷新，点该项目行“新建对话”应直接新建绑定该项目的空白会话；空白态下再次点击应复用（返回 reused 属正常）；② 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：主聊天页发送后用户消息锚定到可视区顶部（2026-09-20）

- 当前目标（已实现，待真机验收）：主聊天页发送消息后，最新 `.qf-user-message` 滚动定位到可视区顶部；消息列表末尾插入 spacer 补偿高度，回复流式增长期间动态收缩，归零后退回现有贴底跟随；用户上滚时禁用跟随但保留 spacer；会话切换/卸载清理。经 ChatPanelHost 新可选 prop `anchorSentUserMessage`（默认关闭）接线，仅 App.tsx 主聊天面板开启；侧边聊天与分享页行为不变。真机验收反馈微调：锚定位置在用户消息顶部与可视区顶部之间留 12px 固定边距（`scroll-sync.ts` 模块常量 `ANCHOR_TOP_OFFSET = 12`，spacer 初始/收缩公式共用同一锚定目标、随边距自动调整），tests/frontend/scroll-sync.test.ts 期望值同步、docs/wiki scroll-sync 小节两份副本已更新。
- 改动文件：`src/components/chat/scroll-sync.ts`（发送后锚定实现）、`src/components/chat/ChatPanelHost.tsx`（新 prop anchorSentUserMessage，默认关闭）、`src/App.tsx`（主聊天面板开启）、`tests/frontend/scroll-sync.test.ts`（10 用例）、`feature_list.json`（新增 send-anchor-user-message-top，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/scroll-sync.test.ts` → **10 passed**；`tests/frontend/chat-surface-behavior-alignment.test.ts` + `tests/frontend/scroll-to-bottom-button.test.ts` → **17 passed**（护栏回归）；`npx tsc -b` → **exit 0**；eslint（改动文件）→ **exit 0**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 用户真机 `npm run dev` 验收：主聊天页发送后用户消息应出现在可视区顶部（消息顶部与可视区顶之间留 12px 边距）、回复增长期间稳在顶部、超过一屏后自然被推走、手动上滚不受影响；② 侧边聊天/分享页回归确认行为不变；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：todo_write 工具卡展开显示结构化任务列表（2026-09-20）

- 当前目标（已实现，待真机验收）：todo_write 工具卡展开体由 JSON-only 改为结构化任务列表——`ul.quickforge-todo-history-list`，li 含状态图标（in_progress 半填充圆 + accent / completed 实心勾 emerald + 弱化 + line-through / pending 空心圆）+ sr-only 状态文本 + content；>5 项滚动容器 max-height 7.5rem；compact 模式同样渲染（修复展开为空）；snapshot 空回退 JSON-only。设计决策：不加进度条；类名 quickforge-todo-history-list 避开测试禁用的 quickforge-todo-summary-list。
- 改动文件：`src/lib/tool-renderers/todo-write-tool-renderer.tsx`、`src/index.css`（.quickforge-todo-history-* 系列，text-xs 走字号契约，hover 无位移无边框无阴影，SVG mask 模块级计数器防串扰）、`tests/frontend/todo-write-renderer.test.ts`（10 用例，新增 2）、`design-mockups/todo-tool-card-structured.html`（设计稿）、`feature_list.json`（新增 todo-tool-card-structured-list，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/todo-write-renderer.test.ts` → **10 passed**；`tests/frontend/todo-write-summary.test.ts` → **24 passed**；相邻 CSS 契约测试 → **142 passed**；`npx tsc -b` → **exit 0**；eslint 改动文件 → **exit 0**；全量 `npm run test` → **367 files / 4374 passed + 1 skipped（exit 0）**。未跑 npm run build。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：工具卡展开三态视觉（in_progress/completed/pending）、hover 反馈、>5 项滚动、暗色主题 completed 色；验收通过即关闭本 feature；② 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：主结构分割线强度统一加深 34% → 60%（2026-09-20 第四轮）

- 当前目标（已完成）：用户反馈「线颜色不够深」。主结构分割线集合（DESIGN_LANGUAGE.md 统一强度约束）全组由 `color-mix(in_oklab,var(--border) 34%,transparent)` 加深为 60%，共 5 处：App.tsx :1989 对话区 `<main>` md:border-l/t 颜色类、:1991 对话 header `border-b` 颜色类；ChatSidebar.tsx :1927 footer `border-t` 颜色类；SettingsWorkspacePage.tsx :148 设置区 `<main>` 颜色类、:149 设置 header 颜色类（同步 `border-b-[0.5px]` → `border-b`，1px 与对话 header 宽度统一）。DESIGN_LANGUAGE.md「分割线要统一」小节补充当前统一配方（1px + 60%）与全组同步原则。
- 保留清单（非主结构线，不动）：App.tsx:2230 检查器 w-px（30% + sidebar-bg 混色）；WorkspaceInspector / WorkspaceInlineDiffPreview / WorkspaceChangesList / WebPreviewContent / ProjectOpenMenu / GitToolsPinnedSummary / GitGraphDialog / GitCommitPushDialog / GitBranchMenu / AttachmentPreview 的 34%/35%/38% 内部细线、弹层边框、0.5px 表格线。完整清单见 progress.md 本轮条目。
- 改动文件：`src/App.tsx`（2 处颜色类）、`src/components/sidebar/ChatSidebar.tsx`（1 处颜色类）、`src/components/settings/SettingsWorkspacePage.tsx`（2 处：颜色类 + 宽度）、`DESIGN_LANGUAGE.md`（分割线配方同步）、`feature_list.json`（sidebar-main-divider-1px 追加第四轮）、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc --noEmit` → **exit 0**；`npx eslint src/App.tsx src/components/sidebar/ChatSidebar.tsx src/components/settings/SettingsWorkspacePage.tsx` → **exit 0**；`npx vitest run` 12 个 sidebar/settings/app 相关前端测试 → **12 files / 111 passed（exit 0）**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 确认 light/dark 两模式下 60% 强度适宜（浅色足够可见、dark 不过重）、对话区/设置页/侧边栏 footer 三组线观感一致；② 非主结构内部细线（34%/35%/38%）是否跟随加深待用户另行决策；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：主分割线沿圆角包裹——对话区 + 设置页同步（2026-09-20）

- 当前目标（已完成）：分割线沿 `md:rounded-tl-2xl` 圆角轮廓包裹（左侧竖线 → 弧线绕过左上角 → 顶部横线）。App.tsx 对话区 `<main>`（约 :1988-1990）className 追加 `md:border-l md:border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)]`（border-l/border-t 带 md: 前缀——移动端无圆角无线；颜色类无前缀，无 border-width 时不生效）；ChatSidebar.tsx 根 `<aside>`（约 :1185）移除 `border-r` 与同色 border-[color-mix(...)] 两类（撤掉竖线，避免与 main 左边框叠成双线），其余类保留。本轮（用户确认）设置页同步：SettingsWorkspacePage.tsx 设置区 `<main>`（约 :148）className 追加同样 3 类（与 App.tsx 写法完全一致）；其 `<aside>`（:99）本无 border-r，无需撤线。强度 1px + color-mix(in_oklab,var(--border) 34%,transparent) 与主结构分割线统一（DESIGN_LANGUAGE.md）。
- 改动文件：`src/App.tsx`（main +3 类）、`src/components/sidebar/ChatSidebar.tsx`（aside -2 类）、`src/components/settings/SettingsWorkspacePage.tsx`（main +3 类）、`feature_list.json`（更新既有 sidebar-main-divider-1px 为三轮方案，files 补 App.tsx 与 SettingsWorkspacePage.tsx）、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc --noEmit` → **exit 0**；`npx eslint src/App.tsx src/components/sidebar/ChatSidebar.tsx src/components/settings/SettingsWorkspacePage.tsx` → **exit 0**；ChatSidebar 相关 9 个测试文件 → **9 files / 79 passed（exit 0）**；`npx vitest run tests/frontend/settings-workspace-react.test.ts` → **1 file / 11 passed（exit 0）**；grep tests/ 无 `rounded-tl-2xl` / main 边框类断言（无需测试适配）。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 确认 light/dark 两模式下对话区与设置页边线沿圆角包裹（连续、不贯穿到顶）、侧边栏宽度切换/收起态不回归；② 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：侧边栏与对话区主分割线改 1px 可见（2026-09-20）

- 当前目标（已完成）：ChatSidebar.tsx 根 `<aside>`（约 :1185）右边框由 `border-r-[0.5px]` 改为 `border-r`（1px），使对话区与左侧对话历史侧边栏之间出现一条可见浅色边界线；边框色配方 `border-[color-mix(in_oklab,var(--border)_34%,transparent)]` 与其余全部类不变，与 App.tsx 对话区 header 底线（`border-b` 同配方 1px）统一主结构分割线强度（DESIGN_LANGUAGE.md）。
- 改动文件：`src/components/sidebar/ChatSidebar.tsx`（仅 :1185 一处类名，+1 -1）、`feature_list.json`（新增 sidebar-main-divider-1px，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc --noEmit` → **exit 0**；`npx eslint src/components/sidebar/ChatSidebar.tsx` → **exit 0**；`npx vitest run` 9 个 ChatSidebar 相关测试文件（mobile-fullscreen-adaptation / project-drag-boundary / motion-design / sidebar-new-chat-routing / sidebar-section-order / sidebar-session-action-alignment / sidebar-section-header-hit-area / project-row-hit-area / session-row-hit-area）→ **9 files / 79 passed（exit 0）**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 确认 light/dark 两模式下侧边栏右缘 1px 分割线可见、强度适宜、宽度切换过渡不回归；② 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：任务胶囊默认收起、点击才展开（2026-09-20）

- 当前目标（已完成）：`todo-write-summary.ts` update() 移除「首个含未完成项快照自动展开」分支（原 `if (isFirstSnapshot) expanded = counts.completed !== counts.total`），任何新快照下 expanded 保持默认 false，仅用户点击 toggle（handleToggle）才展开；原 else if 提为独立 if——「全部完成自动收起」（`counts.completed === counts.total → expanded = false`）统一适用所有快照；用户手动展开/收起状态跨快照保留契约不变。isFirstSnapshot 变量保留（仍被 :324 门控 showUpdatedMarker——仅非首个新快照显示 updated 标记）。
- 改动文件：`src/components/chat/panel-decoration/todo-write-summary.ts`（update() 内 +1 -2：删自动展开分支、else if 提为 if）、`tests/frontend/todo-write-summary.test.ts`（6 处适配：首用例默认收起断言 + 点击展开 'true'；shell 重建/编辑器移除两用例用户态断言翻转为 'true'；user-collapsed 用例改双击建立收起态；空快照重置与回滚新首快照断言 'false'）、`feature_list.json`（新增 todo-capsule-default-collapsed，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → **2 files / 32 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint`（2 改动文件）→ **exit 0**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收默认收起形态——新 todo_write 快照出现时胶囊收起（aria-expanded false / body hidden）、点击 toggle 展开、全部完成自动收起、手动展开状态跨快照与编辑器重建保留、updated 标记仍仅非首快照出现；② 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：聊天路径链接改 icon+basename、hover 显示全路径（2026-09-20）

- 当前目标（已完成）：`local-file-path-links.ts` 的 `createLocalFilePathLink` 正文从完整路径文本改为「文件图标 + basename」——img（src=fileIconUrl(pathValue)，与工具卡摘要区 FileIcon 同源；alt=''、draggable=false、aria-hidden）+ span（artifactFileName(pathValue)）；`button.title = pathValue`（hover 显示完整路径）；aria-label 保持 `t('openLocalFileWithPath', { path })`；dataset.quickforgeFilePath / onclick / className（quickforge-file-path-link）不变。CSS：`.quickforge-file-path-link` 改 inline-flex + align-items:center + gap:0.25rem + vertical-align:baseline，新增 `.quickforge-file-path-link img { 0.875rem; flex-shrink:0 }`；蓝色/下划线/underline-offset/hover color-mix 保留。
- 改动文件：`src/components/chat/panel-decoration/local-file-path-links.ts`（+13 -3：2 个 import + createLocalFilePathLink 重写）、`src/index.css`（.quickforge-file-path-link 布局 + 新增 img 规则）、`tests/frontend/local-file-path-links.test.ts`（file-icon-assets mock、FakeElement 补 img 属性、linkParts helper、断言升级）、`tests/frontend/decorator-copy-i18n.test.ts`（去 `t('openLocalFile')` 断言、加 `button.title = pathValue`）、`progress.md`、`session-handoff.md`。
- openLocalFile key：仅 local-file-path-links.ts 一处消费（本轮移除），i18n.ts en/zh 词条按最小改动保留未删；docs/wiki 未动（视觉变更不改模块职责，词条亦未删）；feature_list.json 未动（本轮任务范围仅状态文件两项）。
- 验证：`npx vitest run tests/frontend/local-file-path-links.test.ts tests/frontend/decorator-copy-i18n.test.ts tests/frontend/message-actions.test.ts` → **3 files / 61 passed（exit 0）**；`npm run lint` → **0 errors（exit 0）**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 确认链接形态：icon+basename 与正文基线对齐、图标 0.875rem、hover tooltip 显示完整路径、下划线仅作用于 span 文本（不划到图标）、light/dark 蓝色与 hover 变淡不回归；② 可选清理轮：删除 i18n.ts 中已无消费方的 `openLocalFile` 词条（en/zh 成对）；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---

## 历史交接：local-file-path-links 正则 lastIndex 状态污染加固（2026-09-20）

- 当前目标（已完成）：消除 `LOCAL_FILE_PATH_REGEX`（g 标志全局正则）在文本节点过滤 `.test()` 上的状态依赖——把 `lastIndex = 0` 重置移到 `.test()` 之前（每次匹配前重置），避免任何残留偏移让后续短文本节点漏判、路径不链接化。exec 循环（linkLocalFilePathTextNode）既有前置重置不变；未去 g 标志。
- 改动文件：`src/components/chat/panel-decoration/local-file-path-links.ts`（仅 acceptNode 内 3 行：注释 + 重置前移，+2 -1）、`tests/frontend/local-file-path-links.test.ts`（新增 4 用例回归测试，Node + 最小 Fake DOM）、`progress.md`、`session-handoff.md`。docs/wiki 未动（实现细节加固，不改模块职责/公共入口）；feature_list.json 未动（bug 修复轮次）。
- 验证：`npx vitest run tests/frontend/local-file-path-links.test.ts tests/frontend/message-actions.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 3 files / 56 passed（exit 0）；`npm run lint` → 0 error 0 warning（exit 0）；变异验证通过（删除重置行后「短节点漏判」两用例准确变红）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 复测聊天路径链接化；若仍有漏链，优先排查 decorateLocalFilePathLinks 的 signature 短路（markdown 重渲染但签名不变时跳过再装饰）与路径位于 pre/code 被设计跳过的情形（已记入 progress.md Notes）；② 上一轮蓝色样式真机验收仍在等待用户确认。

---

## 历史交接：聊天文件路径链接改蓝色（2026-09-20）

- 当前目标（已完成）：聊天正文中的本地文件路径链接（`button.quickforge-file-path-link`，由 panel-decoration/local-file-path-links.ts 生成、点击经 App.tsx openLocalFilePathFromChat 打开阅读）改为蓝色：light 模式 Tailwind v4 blue-600（oklch(0.546 0.245 262.881)）、dark 模式 blue-400（oklch(0.707 0.165 254.624)），经 `--quickforge-file-path-link-color` 变量下发、`html.dark` 作用域覆盖；underline、text-underline-offset 2px、hover 变淡（color-mix 80%）保留。
- 改动文件：`src/index.css`（仅 `.quickforge-file-path-link` / `html.dark` 覆盖 / `:hover` 三段，+9 -2）、`feature_list.json`（新增 chat-file-path-link-blue，done）、`progress.md`、`session-handoff.md`。未动 local-file-path-links.ts、message-actions.ts 与任何跳转/门控逻辑；docs/wiki 未动（纯配色变更，不改模块职责/公共入口）。
- 验证：`npx vitest run tests/frontend/decorator-copy-i18n.test.ts tests/frontend/message-actions.test.ts` → 2 files / 52 passed（exit 0）；`npm run lint` → 0 errors（exit 0）；grep tests/ 无该类名或 CSS 颜色断言。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机确认 light/dark 两模式下路径链接为蓝色、下划线偏移不变、hover 变淡；② 上一轮真机验收清单（摘要区文件元素 hover 仅文件名下划线、工具卡 FileIcon 形态与跳转）仍待用户验收。

---

## 历史交接：摘要区文件元素 hover 反馈微调——仅文件名下划线、不变色（2026-09-20）

- 当前目标（已完成）：`renderToolFileSummary` 可点击（可预览）时的 hover 行为由「整元素透明度变淡」改为「仅 basename 文本下划线」：button class 移除 `transition-opacity hover:opacity-70`、改 `group cursor-pointer`；文件名 span 加 `underline-offset-4 group-hover:underline`（分组 hover 保证悬停按钮任意位置（含图标）都只给文件名 span 下划线，图标不下划线、颜色与透明度不变；对齐 MarkdownReader 链接 `underline-offset-4 hover:underline` 模式）。静态不可预览分支无 `group` 祖先，下划线类为惰性（src 全库无其他 `group` 类，无碰撞）。
- 改动文件：`src/lib/tool-renderers/shared.tsx`（renderToolFileSummary class 调整 + 注释同步）、`tests/frontend/tool-renderer-file-icon.test.ts`（新增 hover 断言用例，12 用例）、`progress.md`、`session-handoff.md`。docs/wiki 与 feature_list.json 未动（纯样式微调，不改模块职责与公共入口）。
- 验证：`npx vitest run tests/frontend/tool-renderer-file-icon.test.ts` → 12/12（exit 0）；`npx tsc -b` → exit 0；`npx eslint` 两改动文件 → exit 0。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机确认 hover 下划线形态（仅文件名下划线、图标不变色）；② 上一轮真机验收清单（FileIcon + basename 形态、title 完整路径、可预览点击跳转、绝对路径/~ 路径静态不可点击）仍待用户验收。

---

## 历史交接：工具卡摘要区文件图标（眼睛按钮去重 + read_file 纳入 + 绝对路径静态化）（2026-09-20）

- 当前目标（已完成）：write_file / edit_file / read_file 三工具卡摘要区渲染 `renderToolFileSummary`——FileIcon（与 workspace 文件树统一）+ 仅 basename 的整体元素，hover title 显示完整路径；路径可预览时整体可点击，经 `previewArtifactClickHandler`（preventDefault + stopPropagation 阻断 summary 折叠后派发 `PREVIEW_ARTIFACT_EVENT` = quickforge:preview-artifact）交 App.tsx openArtifactPreview 跳转阅读，与 `renderPreviewButton` 共用同一入口；不可预览时仅静态展示。`renderPreviewButton` 仅剩 present_files——write/edit 眼睛按钮已移除（与摘要区文件名点击去重；present_files 多文件摘要保留独立按钮）。read_file 绝对路径 / `~` 路径静态不可点击（`isNonWorkspaceClickablePath`：`~`、`/`、`\`、盘符前缀）——服务端 workspace 边界（isInside(workspaceRoot)）致工作区外路径 403 且 `~` 不展开，渲染层无工作区根无法区分工作区内绝对路径，有意不猜路径展开。其余工具保持 `summarizeParams` 纯文本摘要。
- 改动文件：`src/lib/tool-renderers/shared.tsx`（renderPreviewButton 收窄 present_files、renderToolFileSummary 扩 read_file、新增 isNonWorkspaceClickablePath、resolvePreviewableArtifact read_file 分支）、`src/lib/tool-renderers/local-workspace-tool-renderer.tsx`（read_file 摘要接入）、`tests/frontend/tool-renderer-file-icon.test.ts`（重写 11 用例）、`tests/frontend/local-tool-running-sweep.test.ts`（扫描标记恢复）、`docs/wiki/src/lib/README.md`（tool-renderers/shared.tsx 条目同步）、`feature_list.json`（tool-card-file-icon，done，描述同步）、`progress.md`、`session-handoff.md`。
- 验证：新增/重写测试 11/11、相关测试 26/26（含 local-tool-running-sweep）、`npx tsc -b`、eslint 改动文件全部 exit 0；`feature_list.json` JSON.parse 校验通过。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机确认摘要区交互（FileIcon + basename 形态、title 完整路径、可预览点击跳转、绝对路径/~ 路径静态不可点击）。

---

## 历史交接：工具卡摘要区文件图标+文件名 + 点击跳转阅读（2026-09-20，用户澄清重构轮）

- 当前目标（已完成）：工具图标 `renderToolIcon` 保持不变；write_file / edit_file 工具卡摘要区（summary 标题后「 · 」详情）改为 `renderToolFileSummary`——FileIcon（与 workspace 文件树统一）+ 仅 basename 的整体元素，hover title 显示完整路径；路径可预览时整体可点击，经 `previewArtifactClickHandler`（preventDefault + stopPropagation 阻断 summary 折叠后派发 `PREVIEW_ARTIFACT_EVENT` = quickforge:preview-artifact）交 App.tsx openArtifactPreview 跳转阅读，与 `renderPreviewButton` 共用同一入口；不可预览时仅静态展示。其余工具保持 `summarizeParams` 纯文本摘要。
- 改动文件：`src/lib/tool-renderers/shared.tsx`（删 `renderToolSummaryIcon`，新增导出 `renderToolFileSummary`）、`src/lib/tool-renderers/local-workspace-tool-renderer.tsx`（write_file/edit_file 摘要改用 `renderToolFileSummary`，工具图标不动）、`tests/frontend/tool-renderer-file-icon.test.ts`（重写 8 用例）、`tests/frontend/local-tool-running-sweep.test.ts`（扫描标记恢复）、`docs/wiki/src/lib/README.md`（tool-renderers/shared.tsx 条目改为 `renderToolFileSummary` 澄清后方案）、`feature_list.json`（tool-card-file-icon，done，描述同步澄清后方案）、`progress.md`、`session-handoff.md`。
- 验证：新增/重写测试 8/8、相关测试 26/26（含 local-tool-running-sweep）、`npx tsc -b`、eslint 全部 exit 0；`feature_list.json` JSON.parse 校验通过。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机确认摘要区交互（FileIcon + basename 形态、title 完整路径、点击跳转预览、不可预览仅静态）；② read_file 是否也加文件类型图标可后续评估。

---

## 历史交接：移除设置页顶部搜索框及相关代码（2026-09-20）

- 当前目标（已完成）：移除设置界面顶部搜索框（桌面侧栏 + 移动端主菜单两处）及其相关代码。
- 改动文件：`src/components/settings/SettingsWorkspacePage.tsx`（删两处搜索框 JSX、`Search` import、`settingsSearchQuery`/`normalizedSettingsSearchQuery`/`filteredSettingsItems`/`visibleTabIndex`/`hasSettingsResults` 搜索状态与过滤联动、三处无结果占位；恢复 `settings.items` + `activeTabIndex` 语义；STATE_PRESERVING tab host 常驻挂载契约保留）、`src/lib/i18n.ts`（en/zh 成对删 `searchSettings`/`noSettingsResults`）、`tests/frontend/settings-workspace-react.test.ts`（删 search helper 与纯搜索用例；混合用例改写为"keeps visited persistent tab hosts mounted under the same key after switching tabs"）、`progress.md`、`feature_list.json`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/settings-workspace-react.test.ts` → 11 passed（exit 0）；`npx vitest run tests/frontend/decorator-copy-i18n.test.ts tests/frontend/settings-workspace-react.test.ts` → 18 passed（exit 0，en/zh 键对等通过）；`npx tsc -b` → exit 0；`npx eslint`（3 改动文件）→ exit 0。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机打开设置页，确认桌面/移动两处搜索框已消失、tab 切换与移动端钻取正常；② 遗留待办见 progress.md 第二十二轮 Notes（装饰层英文 'Stop'、`button:last-child` 锚定）与第二十一/二十轮遗留项不变。

---

## 历史交接：self-hosted-chat-ui 第二十二轮·回归修复：send/stop 按钮装饰层 replaceSvg 替换 React 拥有的 svg 导致 removeChild NotFoundError（2026-09-20，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：修复用户报障（主聊天面板「出错了/重试/刷新页面」ErrorBoundary，发送进入流式瞬间崩溃）。真机 componentStack 取证：`svg → Button → MessageEditor (Fg) → ChatSurface → ChatPanelHost`，removeChild NotFoundError。根因：`panel-decoration/send-stop-button.ts` 用 `replaceSvg`（oldSvg.replaceWith）物理替换 React 拥有的按钮内 svg，isStreaming 翻转时 React 卸载自己记录的子树即崩。修复（方案 A'，用户授权）：图标与基础 class 收编进 React——`MessageEditor.tsx` send 分支内联 arrow-up svg（path `M12 19V5` + `m5 12 7-7 7 7`、strokeWidth 2.4，删 rotate wrapper 与 lucide Send）、stop 分支内联实心 rect svg（x=6 y=6 12×12 rx=2，删 lucide Square），两 Button 挂 `quickforge-send-button` / `quickforge-stop-button`；`send-stop-button.ts` 改纯状态装饰（只 toggle `--waiting`、title/aria、capture stop handler），不再动 DOM 结构。
- 改动文件：`src/components/chat/surface/MessageEditor.tsx`、`src/components/chat/panel-decoration/send-stop-button.ts`、`tests/frontend/send-stop-button.test.ts`（删 replaceSvg mock + 基础 class 归属新用例）、`tests/frontend/chat-surface-editor.test.ts`（新增 React-owned svg/base class 用例）、`progress.md`、`session-handoff.md`。
- 验证：定向 4 files（send-stop-button / chat-surface-editor / chat-compact-controls / composer-control-hover）→ **38 passed（exit 0）**；`npx tsc -b` → exit 0；`npm run lint` → 0 errors / 3 warnings（exit 0，coverage/ 既有）。未跑全量 test/build（定向验证）。
- Blocker：无。
- 下一步：① 真机复验：发送→流式→停止往返，确认不再落 ErrorBoundary、图标/等待环/hover 与修复前一致；② 遗留（progress.md 第二十二轮 Notes a/b）：装饰层 title/aria 硬编码英文 'Stop'、`button:last-child` 锚定脆弱；③ 第二十一轮遗留项（atTail 边缘场景）与第二十轮遗留项（agent_end 不清理 pendingToolCalls、server-agent messagesIncremental 分支未接 pendingToolCalls 合成）仍待处理。

---

## 历史交接：self-hosted-chat-ui 第二十一轮·回归修复：流式终态翻转未释放过程组导致 removeChild NotFoundError（2026-09-20，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：修复用户报障（主聊天面板 ErrorBoundary 兜底「出错了/重试/刷新页面」）。根因：第十九轮 P0-B 的 `shouldReleaseProcessGroups` 门控只比较 messages 数组身份，agent 终态事件（agent_end / message_end / turn_end / abort / 404 轮询）可只翻转 `isStreaming` 或清空 `streamingMessage` 而 messages 身份不变，门控跳过释放；React 随后卸载流式容器（`.qf-streaming-message`）时对已被 process-folding 搬进 `.quickforge-process-group` 的节点调 removeChild 抛 NotFoundError。修复（用户确认方案 A）：门控扩展为 `ProcessGroupReleaseGate`（messages 身份 + isStreaming 翻转 + 流式行 presence 翻转，流式 partial 每帧新对象故比较 presence 而非身份），纯流式帧（三者均未变）仍跳过不回退；`MessageArea` 透传既有 `isStreaming`/`streamingAssistant` 给 boundary（新增同名 props）。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`（gate 签名/类型、boundary props、getSnapshotBeforeUpdate、MessageArea JSX、两处契约注释）、`src/components/chat/panel-decoration/process-folding.ts`（仅 doc 注释补终态翻转例外）、`tests/frontend/process-folding-ownership.test.ts`（改写 1 例 + 新增 3 例 + `reactRemoveChild` fake）、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc -b` → exit 0；定向 3 files（process-folding-ownership / process-folding / thinking-header-adoption）→ **77 passed（exit 0）**；相邻护栏 3 files（chat-surface-render / chat-surface-message-list / process-folding-incremental）→ **38 passed（exit 0）**；`npm run lint` → **0 errors / 3 warnings（exit 0，coverage/ 既有）**。未跑全量 test/build（小改动定向验证）。
- Blocker：无。
- 下一步：① 真机复验原报障场景（流式中途 abort / 404 轮询终态翻转），确认主面板不再落 ErrorBoundary；② 可选：若真机出现 atTail 翻转且窗口身份不变的边缘场景（见 progress.md 第二十一轮 Notes a），再把 atTail 纳入 gate；③ 第二十轮遗留项（agent_end 不清理 pendingToolCalls、server-agent message_end messagesIncremental 分支未接 pendingToolCalls 合成）仍待处理。

---

## 历史交接：self-hosted-chat-ui 第二十轮·性能修复：subagent 工具行 spinner 闪烁修复（2026-09-19，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：修复 subagent 工具行 spinner 闪烁，七组修复：① pending 工具行渲染所有权统一到 MessageList（`MessageList` 移除 `isStreaming` prop，pending 工具卡 message_end 前后同一 DOM 节点；流式容器 `AssistantMessage` 改传 `hidePendingToolCalls`）；② 消息行 key 无 timestamp 时由 index 回退改为内容指纹（`content-parts.ts` `messageRenderIdentity` 改单参签名，首个有意义分块 64 字符前缀 + 附件 id 的 FNV-1a）；③ `ToolMessage` memo 化；④ message_end 时无 toolResult 的 toolCallId 合成进 pendingToolCalls（`tool-execution-events.ts` 新增纯函数 `toolCallIdsWithoutToolResult`，`shared-server-agent.ts`/`server-agent.ts` 的 event.message 分支接入，消除事件交错灰点帧）；⑤ `process-folding.ts` full 重建路径新增「纯工具后缀追加」增量分支 `appendProcessToolSuffix`（只搬新增行、已有行不动，不重启 CSS keyframes）；⑥ `SubagentRunDetailContent.tsx` pendingToolCalls Set 身份稳定化（`stablePendingToolCalls`）；⑦ `subagent-run-detail.ts` `subagentRunPayloadFromToolEvent` 增加 `previousPayload`，running 帧缺 details 字段按字段回填，消除 done→running 回跳。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/MessageList.tsx`、`src/components/chat/surface/AssistantMessage.tsx`、`src/components/chat/surface/ToolMessage.tsx`、`src/components/chat/surface/content-parts.ts`、`src/components/chat/panel-decoration/process-folding.ts`、`src/components/workspace/SubagentRunDetailContent.tsx`、`src/components/workspace/subagent-trace-structure.ts`、`src/lib/tool-execution-events.ts`、`src/lib/subagent-run-detail.ts`、`src/lib/shared-server-agent.ts`、`src/lib/server-agent.ts`、`tests/frontend/chat-surface-message-list.test.ts`、`tests/frontend/chat-surface-render.test.ts`、`tests/frontend/chat-surface-tool-message.test.ts`、`tests/frontend/subagent-trace-flicker.test.ts`、`tests/frontend/tool-pending-interleaved-frames.test.ts`（新增）、`tests/frontend/process-folding-incremental.test.ts`（新增）、`tests/frontend/subagent-run-detail.test.ts`、`progress.md`、`session-handoff.md`、`feature_list.json`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- 验证：`npm run test` → **363 files / 4334 passed + 1 skipped（exit 0，44.02s）**；`npm run lint` → **0 errors / 3 warnings（exit 0，21s，coverage/ 既有）**；`npm run build` → **exit 0（2.65s，仅既有警告）**。
- Blocker：无（真机视觉验证仍建议执行：DevTools 观察闪烁瞬间节点是否重建）。
- 下一步：① 真机视觉复验（spinner 生命周期不再闪、无残留）；② 处理 progress.md 第二十轮 Notes 中的遗留 a/b——`agent_end`/error 事件不清理 pendingToolCalls（异常终止时 spinner 可能残留）、`server-agent.ts` message_end 的 messagesIncremental/全量 messages 分支未接入 pendingToolCalls 合成逻辑。

---

## 历史交接：self-hosted-chat-ui 第十九轮·性能修复：轮次导航跳转卡顿第二轮——DOM/decorate 层根因（2026-09-19，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：轮次导航跳转卡顿第二轮修复（R2 轮，4 项）：P0-A `process-folding.ts` decorateProcessBlocks 的 `canShortCircuit` 放宽为 `!isActiveTurn`（非流式指纹命中也 skip，消除每次跳转的全量 restore+refold）；P0-B `ChatSurface.tsx` `ProcessGroupReleaseBoundary` 新增 `shouldReleaseProcessGroups` 门控（messages identity 未变跳过全量 release，消除流式期间每帧 release→refold 振荡）；P1-A `turn-navigation.ts` updateActiveFromScroll 加 rAF 合帧 + 元素/ordinal 缓存；P1-B `message-actions.ts` decorateMessages 行级指纹短路 + ensureMessageTime 比较后写 + getPrimaryMessageElements 复用（3 次→1 次）。测试：process-folding.test.ts 改写 2 例、process-folding-ownership.test.ts 新增 3 例、turn-navigation.test.ts 新增 3 例、message-actions.test.ts 新增 3 例。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/turn-navigation.ts`、`src/components/chat/panel-decoration/message-actions.ts`、`tests/frontend/process-folding.test.ts`、`tests/frontend/process-folding-ownership.test.ts`、`tests/frontend/turn-navigation.test.ts`、`tests/frontend/message-actions.test.ts`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- 验证：`npx tsc -b` → exit 0；`npx vitest run` 全量 361 files / 4312 passed（exit 0）；`npx eslint` 改动文件 0 问题。
- Blocker：无（真机流畅度待用户验证）。
- 下一步：① 用户真机验证轮次跳转流畅度；② 若仍卡顿按备用项继续（优先流式 markdown 稳定段落拆分，其余：ToolMessage memo、R3（agent_start 中断程序滚动）、R2（overflow-anchor））。

---

## 历史交接：self-hosted-chat-ui 第十八轮·性能修复：轮次导航跳转卡顿（2026-09-19，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：修复轮次导航跳转卡顿（R1）——流式期间每事件全量 React 提交导致 smooth 滚动掉帧。三项修复：F1a `readAgentSnapshot` 快照身份复用（无可观察变化时原样返回上一快照对象，`setSnapshot` 直接 bail out；依赖「不原地变更已发布消息」的不可变 upsert 契约，已在 `ChatSurface.tsx` 注释）；F1b `UserMessage`/`AssistantMessage` 加 memo（配套 `MessageList.tsx` `toolResultsById` useMemo 化）；F1c `publishWindow` 跳过无变化的窗口提交。新增 `tests/frontend/chat-surface-render.test.ts` snapshot identity reuse 4 用例。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/UserMessage.tsx`、`src/components/chat/surface/AssistantMessage.tsx`、`src/components/chat/surface/MessageList.tsx`、`tests/frontend/chat-surface-render.test.ts`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- 验证：`npx tsc -b` → exit 0；vitest 全量前端 2458 例通过；eslint 全过。
- Blocker：无（真机流畅度需用户手动验证）。
- 下一步：① 真机验证轮次跳转流畅度；② 若仍卡顿，用 DevTools Performance 面板录制定位；候选后续项：R3（agent_start 中断程序滚动）、ToolMessage memo、R2（overflow-anchor）。

---

## 历史交接：self-hosted-chat-ui 第十七轮·恢复 KaTeX 数学公式渲染（2026-09-19，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：恢复移除 pi-web-ui 时丢失的聊天数学公式渲染（用户授权）。只新增 1 个依赖 katex（devDependencies `^0.16.47`，与 mermaid 传递依赖去重为单副本，lock 无其他包变化）；未引入 remark-math/rehype-katex（不支持 \(...\) 定界符且 $ 规则与旧版不一致），改为自研三段式。
- 改动文件：`src/lib/chat-math.ts`（新增：preprocessLatexDelimiters 把 \(...\)/\[...\] 在进 react-markdown 前换成 QFMTHI/QFMTHB 占位 token——markdown 转义会吃掉反斜杠；跳过 fenced/indented/inline code；rehypeQfMath 插件把占位 token、行内 $...$、行首锚定的块级 $$...$$ 换成 qf-math 元素，跳过 code/pre，仅含单个块级公式的段落被替换避免 div 嵌 p）、`src/components/chat/surface/KatexMath.tsx`（新增：renderToString throwOnError:false / displayMode / output:'html'，display 外层 my-4，异常回退红色等宽原文，memo，组件内 import katex/dist/katex.min.css）、`src/components/chat/surface/Markdown.tsx`（接线：预处理 + rehypePlugins + components 'qf-math'）、`vite.config.ts`（manualChunks 加 katex 分组）、`src/index.css`（仅头部注释修订，KaTeX 已恢复）、`tests/frontend/chat-math.test.ts`（新增 8 用例）、`package.json`/`package-lock.json`、文档四件套（feature_list.json / progress.md / session-handoff.md / docs/wiki/src/README.md）。
- 验证：定向 3 files（chat-math + chat-markdown-parity + chat-surface-css-contract）→ **38 passed（exit 0）**；相邻护栏 4 files（chat-surface-render / chat-code-block / chat-surface-behavior-alignment / subagent-run-detail-react）→ **67 passed（exit 0）**；`npm run lint` → **0 error / 3 warnings（exit 0，coverage/ 既有）**；`npm run build` → **exit 0**，产物确认 katex 独立 chunk（dist/assets/katex-*.js 259.24KB / gzip 77.49KB，ChatPanelHost 与 index chunk 引用）+ katex css（28.8KB）+ 59 个 KaTeX_*.woff2/woff/ttf 字体；`feature_list.json` JSON.parse 复验通过。
- Blocker：无。
- 下一步：可选——真实浏览器人工验收 KaTeX 公式渲染观感（含字体加载、长公式滚动、暗色下公式颜色）；发布前按规则全量跑 `npm run test` / `npm run lint` / `npm run build`。已知局限（记录在 feature boundaries）：公式内含 markdown 强调字符可能被 markdown 语法拆分（rehype 阶段处理的固有代价）；katex 0.16 未知命令输出内联红字而非 katex-error。

---

## 历史交接：self-hosted-chat-ui 第十六轮·迁移缺口修复（2026-09-19，分支 ui）

- 当前目标（已完成，feature 保持 **done**）：修复 React ChatSurface 迁移的两个缺口（诊断已定位、用户确认都修）。① `src/lib/server-agent.ts` handleSseEvent 的 `message_update` 分支此前只转发不写 `state.streamingMessage`，React ChatSurface 流式正文消失——现对齐 `shared-server-agent.ts:404-406` 写入 `event.message`（缺省帧防御），并在 `message_end`/`turn_end` 补 `streamingMessage = undefined` 清理（`agent_end` 原有清理保持）。② `src/components/chat/surface/ChatSurface.tsx` 的 SUBSCRIBED_EVENTS 缺 `tool_execution_start/update/end`，工具卡滞后到下一条 message 事件——已加入（isSnapshotRefreshEvent 复用同一白名单，自动一致）。`noteSseEvent` 的 stateVersion 单调守卫在入口拦截过期帧，不影响新写入。
- 改动文件：`src/lib/server-agent.ts`、`src/components/chat/surface/ChatSurface.tsx`、`tests/frontend/server-agent.test.ts`（新增「exposes SSE message_update frames on state.streamingMessage and clears them on message_end」「clears a lingering streaming message on turn_end without message data」2 用例，并把原 :411 断言升级为 SSE 置值→失败 prompt 清理）、`tests/frontend/chat-surface-render.test.ts`（新增「refreshes on tool_execution frames so tool cards appear while running」）、`feature_list.json`（self-hosted-chat-ui 追加第十六轮 verification 说明与 2 个 files 条目）、`progress.md`、`session-handoff.md`（本条）。
- 验证：`npx vitest run tests/frontend/server-agent.test.ts tests/frontend/chat-surface-render.test.ts` → 2 files / 150 passed（exit 0）；`npm run lint` → 0 errors / 3 warnings（exit 0，coverage/ 既有）；`npx tsc -b` → exit 0；`feature_list.json` JSON.parse 复验通过。
- Blocker：无。
- 下一步：无强制事项。可选：真实浏览器人工验收流式正文与工具卡实时渲染（原有人工验收清单仍在 feature boundaries 中）；发布前按规则全量跑 `npm run test` / `npm run lint` / `npm run build`。

---

## 历史交接：goal-workflow-test（goal 流程测试，2026-09-19）

- 当前目标（已完成，非 feature 开发）：测试 goal 流程闭环（只读规划 → 自动执行 → 证据验收），不推进任何 feature。会话启动上下文恢复完成：`docs/wiki/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`（28 项 feature 全部 done，无可选 feature）。
- 改动文件：仅 `session-handoff.md` 与 `progress.md` 的本会话记录条目；无源码、依赖、生成产物（`dist/`、`package-dist/`、`package-offline/`）改动；`feature_list.json` 未动。
- 验证：`npm run lint` → **退出码 0（0 errors，3 warnings 均位于 `coverage/` 生成产物，仓库既有）**。
- Blocker：无。
- 下一步：无遗留（测试目的达成）。上一 feature（self-hosted-chat-ui，done）的交接与待验收事项保持不变，见下方历史条目。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-19 第十五轮·一手证据复评 + 自修：语义色死类判据 / 折叠默认值 / 复制反馈 / API Key 探测 / 聚焦反馈）

- 当前目标（已完成，feature 保持 **done**）：对「移除 pi-web-ui/mini-lit/lit 的迁移」做一手证据复评 + 自修（基线 HEAD `3e10f58` + 移除前构建产物 `package-dist/dist/assets/index-B1G0LqYR.css`，不采信前轮结论）。评审报告：`docs/reviews/self-hosted-chat-ui-parity-recheck.zh-CN.md`。不是新 feature。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`（折叠默认值回退旧语义：顶层过程组 `processGroupDefaultExpanded(isAgentStreaming)`、内层阶段 `processStageDefaultExpanded()`=false、工具组 `processToolGroupDefaultExpanded(mode)`='detailed'；saved state 优先、fail-visible 不变）、`src/components/chat/surface/CodeBlock.tsx`（新增导出 `CodeBlockCopyButton`：复制后 Check + 可见文本 `copied`，`title`/`aria-label` 恒为 `copy`，2000ms 复位）、`src/components/chat/surface/Markdown.tsx`（链接无条件 `target="_blank" rel="noopener noreferrer"`；表格外包 `overflow-x-auto my-2 border border-border rounded`）、`src/components/chat/surface/ApiKeyPromptDialog.tsx`（恢复保存前探测：本地 `custom-providers` 优先 → `/api/models/catalog` 兜底 → 无模型直接保存；被拒时不写 `providerKeys`、5000ms `apiKeyPromptInvalid`；请求中 `Testing...` 且禁用；关闭后焦点恢复到打开前元素）、`src/components/ui/input.tsx`（聚焦反馈改 `focus-visible:border-ring` + `ring-2 ring-ring`）、`src/lib/code-highlight.ts`（对齐轮新增 9 个语言族：toml/ini/dockerfile/makefile/powershell/graphql/protobuf/nginx/apache，未知语言名改走保守通用回退 `tokenizeGeneric`——纯文本仅限 `text`/`plaintext`/`txt`、空名、超长/无判别 token；配套 `tests/frontend/code-highlight.test.ts` 51 例含 `unknown-language fallback`）、`src/lib/i18n.ts`（`apiKeyPromptInvalid`）、`tests/frontend/semantic-color-class-parity.test.ts`（新增护栏）+ 本轮文档（`progress.md`、`session-handoff.md`、`feature_list.json`、`docs/wiki/src/README.md`、`docs/wiki/src/components/README.md` 两处副本、`docs/wiki/src/lib/README.md`）。
- 关键判据（勿误判为回归）：HEAD `3e10f58` 的 `src/index.css` 无语义色 `--color-*` 映射 ⇒ 源码自写的语义色透明度类（`text-foreground/90`、`hover:bg-muted/45`、`bg-border/70` …）在移除依赖前不会被 Tailwind 生成（dead，删除无视觉影响）；旧产物 `@layer utilities` 中真实存在的语义色工具类只有 78 个（109 处选择器）。工作区 `@theme inline` 全量映射后这些类会真实生效（第八轮「文字变淡」根因）⇒ 新代码不得使用白名单之外的透明度档位；护栏 `tests/frontend/semantic-color-class-parity.test.ts`，**白名单变更前必须重新核对旧/新产物**。`ui/Input` 的聚焦反馈属**有意补齐**：HEAD 侧 `focus-visible:border-primary` 在旧产物 `index-B1G0LqYR.css` 中 **0 处（dead）**，与它同列的 `focus-visible:outline-none` **1 处（alive）**、`focus-visible:border-ring` 1 处、`focus-visible:ring-ring` 3 处、`focus-visible:ring-2` 1 处（后四者来自 pi 组件，不作用于该输入框）——旧输入框实际只有「无 outline」这一条真实生效，当前 `focus-visible:border-ring + ring-2 ring-ring` 是新行为，与移除依赖前该输入框的实际渲染不同（新产物已确认这些选择器均生成）。
- Blocker：无。未决/待验收：① KaTeX 未移植（公式纯文本）；② hljs 自动识别等价性；③ 真实浏览器人工验收清单——思考行与折叠默认状态、hover/focus、下拉定位与关闭、modal 焦点、复制反馈、长表格横向滚动、代码块着色、输入框聚焦、移动端遮罩；④ 字号在「界面字号 ≠ 消息字号」时的条件性差异。
- 下一步：① 按上面清单做真实浏览器人工验收（含折叠默认值与输入框聚焦两项按现状确认）；② **冲突项状态：用户未在评审窗口内裁决 → 默认保留当前（对齐移除依赖前）的实现**——R10 记录的用户明确要求「折叠组三层默认展开（核心需求：思考块与工具行默认可见，历史回合同样默认展开，`progress.md:124-135` / `session-handoff.md:48-50`）」与本轮回退冲突（R10 动机「思考/工具不显示」的根因已在 R12 定位并修复、现已具备 fail-visible 契约，见报告 §6.1「背景事实」）；`ui/Input` 聚焦环同属「有意补齐、与移除前实际渲染不同」。二者均默认保留现状，**精确回退路径**见报告「6.1 与既有用户要求的冲突/待裁决」（折叠：`process-folding.ts:556-558/693`、`:561-563`、`:621-623/646/657` 三处 + `tests/frontend/process-folding.test.ts:131-135/137-141/437-443` 3 例断言；聚焦环：删 `src/components/ui/input.tsx:9` 的 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring` 三个类、只留 `focus-visible:outline-none`）；③ 前几轮累积待办保留。**全量验证（收尾轮一手）**：`npm run test` → **359 files / 4282 passed + 1 skipped（exit 0）**；`npm run lint` → **0 error / 3 warnings**（均 `coverage/` 既有，exit 0）；`npm run build` → **exit 0**（新产物 `dist/assets/index-CWWfUxx8.css`，327,333 B）；构建产物核对：白名单外 20 个带透明度语义色类全为幽灵类（`src/**` 0 使用、不影响渲染），本轮新增/恢复的 `.focus-visible\:border-ring`、`.border-destructive\/50`、`.bg-muted\/30`、`.bg-background\/90`、`.hover\:bg-muted` 均已生成。本轮无 Git 写操作，未触碰 `dist/`、`package-dist/`、`package-offline/`（`dist/` 仅由构建产出）。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-19 第十三轮·根因修复：subagent 运行详情面板运行时闪烁 + 复审修复 + 硬化）

- 当前目标（已完成，feature 保持 **done**）：第十三轮·根因修复——用户反馈 Workspace Inspector 的 subagent 运行详情面板运行时持续闪烁（观感为「整段消息内容重建，代码块/SVG 图片重新渲染」）。定位到三条根因 + 一条次要项并全部修复；未改主面板行为语义（`ProcessGroupReleaseBoundary`、`MessageArea` memo、过程折叠算法均未动）。不是新 feature。
- 改动文件：`src/components/workspace/SubagentRunDetailContent.tsx`（`SubagentTrace`：结构签名门控释放 + `shouldComponentUpdate` + `componentDidUpdate` 内同步重折叠 + `decorating` 单飞 + 导出供测试；trace 用 `AssistantStreamingContext.Provider` 传流式态；clamp effect 依赖改 `runId/task/context/expectedOutput`）、`src/components/workspace/subagent-trace-structure.ts`（新增：结构签名纯函数）、`src/components/chat/surface/content-parts.ts`（新增：`assistantContentParts` + `messageRenderKeys` 共享投影）、`src/components/chat/surface/MessageList.tsx`（行 key 改消息身份）、`src/components/chat/surface/AssistantMessage.tsx`（分块走共享投影、part key 改源索引、DOM 镜像改 `useLayoutEffect`）、`src/components/chat/surface/ToolMessage.tsx`（同上镜像改 `useLayoutEffect`）、`src/components/chat/surface/CodeBlock.tsx`（流式态改读 `AssistantStreamingContext`、去掉 `.qf-streaming-message` 探测、加 memo）、`src/components/chat/surface/ChatSurface.tsx`（`.qf-streaming-message` 容器提供 `AssistantStreamingContext=true`）、`src/components/chat/surface/surface-context.ts`（新增 `AssistantStreamingContext`/`useAssistantStreaming`）、`tests/frontend/subagent-trace-flicker.test.ts`（新增，复审后 9 例）、`tests/frontend/chat-surface-message-list.test.ts`（+5 例，复审后 +6）、`tests/frontend/chat-code-block.test.ts`（+1 例）、`tests/frontend/chat-surface-behavior-alignment.test.ts`（+1 例）+ 本轮文档（`progress.md`、`session-handoff.md`、`docs/wiki/src/components/README.md` 两处副本）。
- 三条根因（链路）：① `SubagentTrace` 每轮 commit 无条件 `releaseProcessGroups` + `setTimeout(0)` 重折叠 ⇒ 落一帧未折叠、且丢掉组指纹使 `updateProcessGroup` 的 update/skip 快路径永不可达（恒全量重建）；② `MessageList` 用 `msg:${offset+index}`、`AssistantMessage` 用「非空 parts 序号」做 key ⇒ 服务端 `slice(-50)` 滑窗/空 chunk 进出时整批卸载重挂；③ `CodeBlock` 用 `closest('.qf-streaming-message')` 判断流式，子面板无该祖先 ⇒ 飞行中的代码块每 150ms 重渲染 mermaid/SVG 预览。④（次要）任务块 clamp effect 依赖整个 payload ⇒ 每轮 dispose+重测抖动。
- 关键取舍（勿随手改回）：① `pendingToolCalls` **不入**结构签名——子面板列表取 `isStreaming={false}`（无独立流式容器，未完成工具卡必须渲染），入签名会让每轮快照都释放+重折叠；② 子面板 `MessageList` 的 `isStreaming` 仍必须是 `false`（该 prop = `hidePendingToolCalls`，不是流式信号），流式信号单独走 `AssistantStreamingContext`；③ 同步重折叠依赖 `AssistantMessage`/`ToolMessage` 的 DOM 镜像在 layout 阶段完成（React 布局阶段先子后父），若把镜像改回 `useEffect`，折叠会读到上一轮的 message/toolCall 而恒判指纹不匹配、反而退化成全量重建。
- 复查修复（第十三轮复审结论落实，2026-09-19，同样只改上述 `SubagentTrace`/签名/`content-parts` 与对应测试/文档）：① **阻塞 1（门控晚一拍）**——`SubagentTrace.getSnapshotBeforeUpdate` 之前把形参当本次新 props 用；React 契约里形参是**上一轮已提交的 `prevProps`**、新 props 在 `this.props`，故比较的是上一轮签名、结构真正变化那次不释放。改为读 `this.props.payload` 计算签名与 `this.structure`（上一轮已提交 DOM 的签名）比较，变了才释放。② **阻塞 2（签名含 `isStreaming` 位）**——`subagentTraceStructureSignature` 删除该位并去掉第二个参数：trace 恒以 `isStreaming={false}` 渲染 `MessageList`，运行结束只打开已渲染节点内的代码块预览（内容型更新），入签名会多一次 release + 全量重建。③ 小项——`content-parts.ts` 的 toolCall key 缺 id 时回退 `tool:${index}`（原为重复的 `tool:undefined`）；`docs/wiki/src/components/README.md` 两处副本（:181/:497）改为「只在结构签名变化时释放 + 同提交内同步重折叠」；签名函数补「恒传 `isStreaming=false`，若改传真实流式标志须把 `pendingToolCalls` 纳入签名」的耦合说明。测试按 React 约定驱动（先 `instance.props = next` 再以 prev 调 `getSnapshotBeforeUpdate`）并新增防 off-by-one 与 `running→done 不释放` 用例；把源码临时改回错误写法取证 **1 failed / 8 passed**，恢复后 9/9。
- 硬化（第十四轮复审放行后落实，2026-09-19，最小改动，仍只改 `subagent-trace-structure.ts`/`content-parts.ts` 与对应测试/文档）：① **崩溃路径（中低概率）**——`subagentTraceStructureSignature` 的行 token 之前只含 `role`，窗口用「连续同形 assistant 行」替换时签名不变 ⇒ 不释放；被替换的行可能是过程组锚点行，组内夹带其它行搬来的节点，脱离后 `shouldRestoreGroupedProcessNode` 只清标记不归还 ⇒ React `removeChild` 抛 `NotFoundError`。修法：把行身份 token 补入签名（`content-parts.ts` 新增导出 `messageRenderIdentity`，即 `messageRenderKeys` 背后的 `role:timestamp`，无 timestamp 回退 `#index`），保持「文本增长 / toolResult 到达 / running→done」不入签名。② `content-parts.ts` 无 id toolCall 兜底 key `tool:${index}` → `tool#${index}`（原形态与纯数字 id 的分块撞 key）。③ `content-parts.ts` 头注改为准确描述（text/thinking 用源索引、toolCall 用 id、缺 id 走 `tool#` 兜底）。④ `progress.md` 第 5 行的两参签名描述改单参。取证：临时把签名改回「只含 role」→ `subagent-trace-flicker.test.ts` **2 failed / 10 passed**（两条新增滑窗用例），恢复后 12/12。
- 验证（硬化后）：定向 `npx vitest run tests/frontend/subagent-trace-flicker.test.ts tests/frontend/chat-surface-message-list.test.ts tests/frontend/subagent-run-detail-react.test.ts` → **3 files / 32 passed（exit 0）**；全量 `npm run test` → **359 files / 4267 passed + 1 skipped（exit 0）**；`npm run lint` → **0 error / 3 warnings**（`coverage/` 生成产物，仓库既有）；`npm run build` → **exit 0**（仅既有 chunk 体积 / `node:fs` externalize 警告）。
- 验证（复查修复后）：定向 `npx vitest run tests/frontend/subagent-trace-flicker.test.ts tests/frontend/chat-surface-message-list.test.ts tests/frontend/process-folding.test.ts tests/frontend/process-folding-ownership.test.ts tests/frontend/subagent-run-detail-react.test.ts tests/frontend/subagent-run-detail.test.ts tests/frontend/chat-code-block.test.ts` → **7 files / 238 passed（exit 0）**；全量 `npm run test` → **358 files / 4258 passed + 1 skipped（exit 0）**；`npm run lint` → 0 error / 3 warnings（`coverage/` 生成产物，仓库既有）；`npm run build` → exit 0（仅既有 chunk 体积 / `node:fs` externalize 警告）。
- Blocker：无。**需真机确认**：① 同步重折叠是否彻底消除「未折叠帧」（node 环境无 jsdom，子 layout effect 先于父 `componentDidUpdate` 是 React 语义保证而非本项目实测）；② `releaseProcessGroups` + 重建组搬动节点是否重启 `animate-*` keyframes（本轮只把频率从每 150ms 降到「结构变化时」）；③ 结构性变更（新增 part/新增消息行）仍会释放+全量重建，属既有 full 路径设计（复审修复后「运行结束」不再属于此列：`isStreaming` 位已从签名移除、运行结束不再触发释放）；④ 无 `timestamp` 的消息行 key 回退下标，滑窗时仍会重挂。
- 下一步：① 真机复验 subagent 详情面板运行全程（不再整段闪、代码块高亮/mermaid/SVG 不再反复重渲染）并用 DevTools Performance 判定遗留的偶发闪动是 release 落帧还是 keyframes 重启；② 前几轮累积待办保留（KaTeX 与 highlightAuto 两项决策等）。`feature_list.json` 未动（feature 恒为 done，本轮为运行时回归修复）；无 Git 写操作，未触碰 `dist/`、`package-dist/`、`package-offline/`。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-19 第十二轮·根因修复：思考头接管永远失败 + fail-visible 契约）

- 当前目标（已完成，feature 保持 **done**）：第十二轮·根因修复——R9/R11 两轮改 CSS 都没让主 Agent 面板的思考行回来；本轮定位并修掉真正根因：**装饰层「思考头接管」从来就没成功过**（chevron 识别失败 → 提前 return），叠加「等接管」的隐藏规则 → 永久隐藏。本轮不是新 feature。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`（① `:434` 去掉 `Array.from(header.children).filter(child => child instanceof HTMLElement)`——React `ThinkingBlock` 的 chevron 是 lucide `<svg>` 本体、SVGElement 不是 HTMLElement，整条被过滤掉；改为直接 `Array.from(header.children)`，类型 `Array<HTMLElement | SVGElement>`；② 新增 `selfSvg`（`tagName.toLowerCase() === 'svg'`）并把 chevron 判定改为 `markedChevron ?? (selfSvg || hasSvg)`（`hasSvg` 保留兼容旧 span 包裹形态）；③ chevron/label 类改写由 `className =` 改为 `setAttribute('class', ...)`——`SVGElement.className` 是只读 `SVGAnimatedString`，严格模式赋值会抛错；④ 导出 `decorateProcessThinkingBlocks` 供护栏、补接管契约注释）、`src/index.css`（删除 `:3610-3612` 的 `.qf-chat-panel .quickforge-process-body .qf-thinking-block > .thinking-header:not(.quickforge-process-thinking-header){display:none}`，改为 fail-visible 契约注释）、`tests/frontend/thinking-header-adoption.test.ts`（新增，6 用例集成护栏）、`tests/frontend/process-folding.test.ts`（+2 例 selfSvg 单测）、`tests/frontend/chat-surface-css-contract.test.ts`（R11 的「过程组级隐藏」护栏改写为 fail-visible 契约）+ `progress.md`、`session-handoff.md`、`docs/wiki/src/components/README.md`（两处副本的 process-folding 段）。
- 关键证据（链路）：`process-folding.ts:434` 过滤掉 svg → `:439` `querySelector('svg')` 也匹配不到自身 → `processThinkingChildIndexes`（`:413-426`）chevronIndex=undefined → `:444` 提前 return → `:467` 的 `header.className = 'thinking-header quickforge-process-thinking-header'` 永不执行 → `index.css:3610` 把该 header 永久 `display:none`（R10 起默认折叠只渲染 header ⇒ 整块消失）。
- 护栏有效性取证：新护栏**先在未修复源码上跑 → 4/6 失败**（header 仍是原始 utility 类、children 仍是 `[SVG, SPAN]`、rotate-90 未迁移），修复后 6/6 通过。它用项目既有约定（node 环境无 jsdom）手写最小 fake DOM，并刻意复刻 **`SVGElement` 与 `HTMLElement` 互不 `instanceof`** 这一条真实语义——这正是 bug 存活两轮的原因（此前没有任何测试跑过真实接管路径）。
- 验证：定向 `npx vitest run tests/frontend/process-folding.test.ts tests/frontend/process-folding-ownership.test.ts tests/frontend/thinking-header-adoption.test.ts tests/frontend/chat-surface-css-contract.test.ts tests/frontend/chat-surface-render.test.ts tests/frontend/chat-surface-behavior-alignment.test.ts tests/frontend/subagent-run-detail.test.ts` → **7 files / 210 passed（exit 0）**；全量 `npm run test` → **356 files / 4220 passed + 1 skipped（exit 0）**（较 R11 的 355 files / 4212 增加 1 文件 8 例＝本轮新护栏）；`npm run lint` → **0 error / 3 warnings**（coverage/ 既有）；`npm run build` → **exit 0**（仅既有 chunk 体积告警），并抽查构建产物 `dist/assets/index-*.css` 确认旧隐藏规则已消失、接管规则 `display:flex` 仍在。
- Blocker：无。遗留：① 真实浏览器观感（面板内思考行恢复、接管后行高/字号/chevron 展开态、默认字号无回归）待人工验收；② 未接管原生 header 的 `text-sm` 字号残余差异（R11 遗留项）与思考正文 markdown `0.875rem` 未动，仍在待评估清单；③ 前几轮累积待办（KaTeX、highlightAuto 两项决策）保留。`feature_list.json` 未动（feature 恒为 done）；无 Git 写操作，未触碰 `dist/`、`package-dist/`、`package-offline/`。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-19 第十一轮·用户反馈回归修复：主 Agent 面板思考行不可见 + 思考行/工具行字号不一致）

- 当前目标（已完成，feature 保持 **done**）：第十一轮·用户反馈回归修复——① 主 Agent 对话里看不到思考行（subagent 运行详情可见）；② 同一屏思考行与工具行字号不一致。纯 CSS 契约修复，未改组件逻辑，不是新 feature。
- 改动文件：`src/index.css`（① `display:none` 隐藏规则从面板级收紧为 `.qf-chat-panel .quickforge-process-body .qf-thinking-block > .thinking-header:not(.quickforge-process-thinking-header)`，未接管原生头回落到兜底可见样式；② 三处字号统一到消息字号基准 `calc(var(--quickforge-message-font-size, 14px) * 0.875)`——接管后思考行（3658）、`.quickforge-process-summary`（3263）、阶段/工具组摘要（3397）并删除思考行多余 `!important`；③ 工具摘要行规则（3445-3455）并入兜底工具卡首行 `.quickforge-tool-message > .space-y-2 > .quickforge-tool-summary` 与 generate_image 首行 `.quickforge-tool-message > .quickforge-generated-image-tool > .quickforge-tool-summary`，修掉两处 `text-sm` 逃逸到 1rem 的默认不一致）、`tests/frontend/chat-surface-css-contract.test.ts`（+2 describe / 6 用例护栏）+ `progress.md`、`session-handoff.md`、`docs/wiki/src/README.md`（字号体系段）。
- 关键结论：装饰层只给过程组内的 header 标记 `.quickforge-process-thinking-header`（`process-folding.ts:467`，唯一调用点 `updateProcessGroup`:708），接管规则 `.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header` 已命中全部实际位置（header 恒为 `.qf-thinking-block` 直接子级、搬入节点恒在 `.quickforge-process-body` 内），无需放宽选择器；默认 R=M=13px 下三处替换前后均为 11.375px，零视觉回归；未改 ThinkingBlock 默认折叠与装饰层覆盖范围。
- 验证：定向 6 files / 228 passed（exit 0）；全量 `npm run test` 355 files / 4212 passed + 1 skipped（exit 0，较 R10 +6 例＝本轮护栏）；`npm run lint` 0 error / 3 warnings（coverage/ 既有）；`npm run build` exit 0（仅既有警告），构建产物 `dist/assets/index-*.css` 已抽查含新规则。
- Blocker：无。遗留待确认：① 装饰层为何在真实运行时未接管这些 header（装饰未跑 vs React 重挂丢 class）需运行时取证，若是重挂丢装饰应单独立项修幂等而非放宽 CSS —— **已由第十二轮解决：真正根因是装饰层 chevron 识别失败（SVGElement 被 `instanceof HTMLElement` 过滤 + `querySelector('svg')` 匹配不到自身）导致接管提前 return，见上方第十二轮条目**；② 未接管原生 header 仍走 React `text-sm`（= 界面字号，默认 13px），与统一后的 11.375px 行字号有残余差异——若确认这类 header 长期可见，应把兜底规则也纳入消息字号基准（待评估）；③ 思考正文 markdown 的 `0.875rem`（3788）未改（用户只提「行」，待评估）。
- 下一步：① 真实浏览器验收（面板内思考行重新可见、默认字号无回归、把消息字号调大后思考行与工具行同幅缩放）；② 前几轮累积待办保留（KaTeX 与 highlightAuto 两项决策）。`feature_list.json` 未动（feature 恒为 done）；无 Git 写操作，未触碰 `dist/`、`package-dist/`、`package-offline/`。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-19 第十轮·需求纠正：思考正文默认折叠 + 折叠组三层默认展开）

- 当前目标（已完成，feature 保持 **done**）：第十轮·需求纠正——第九轮把「思考内容默认展示」误解为 ThinkingBlock 默认展开；用户澄清真实诉求：① 思考正文默认折叠；② 过程折叠组三层（顶层过程组/内层阶段/工具组）默认展开，让思考块与工具行默认可见（历史回合同样默认展开）。本轮不是新 feature。
- 改动文件：`src/components/chat/surface/ThinkingBlock.tsx`（useState(true)→false，注释改写）、`src/components/chat/panel-decoration/process-folding.ts`（新增 `processGroupDefaultExpanded()` 恒 true 并替换 `isAgentStreaming` 传参；`processStageDefaultExpanded()` false→true；工具组 resolve defaultExpanded `detailed`→`true`，`detailed` 仍用于 displayMode dataset）、`src/lib/i18n.ts`（`toolDisplayModeDescription` en/zh 改为「两模式只差渲染细节、工具组均默认展开」）、`tests/frontend/chat-surface-render.test.ts`（思考正文默认渲染断言反向：含 header 文案 'Thinking...'、不含正文文本）、`tests/frontend/process-folding.test.ts`（阶段默认值 collapsed→expanded）、`docs/wiki/src/components/README.md`（两处副本 process-folding 段默认收起→默认展开）、`docs/wiki/src/lib/README.md`（tool-display-settings 条目）+ `progress.md`/`session-handoff.md`。
- 关键语义保留：saved state 优先（`resolveProcessExpandedState`，用户手动收起不被 default 覆盖）；「default 展开且无 saved 时一次性持久化」照旧；create* 初始 expanded='false' 未动（同步路径必经 resolve，仅为瞬态）。
- 验证：定向 vitest 7 files / 198 passed；`npm run test` 355 files / 4206 passed + 1 skipped（exit 0；首跑 `tests/server/session-state-messages.test.mjs` 多进程 CAS 用例并发 flake，单跑 9/9、全量复跑过——与第九轮记录的同族 flake）；`npm run lint` 0 error / 3 warnings（coverage/ 既有）；`npm run build` exit 0。
- Blocker：无。已知限制：三层默认展开后长会话默认高度变大（预期行为变更）；真实浏览器观感未实测。
- 下一步：① 建议真实浏览器验收（思考正文默认折叠、点 header 展开；过程组/阶段/工具组默认展开、手动收起后记忆；历史回合同样默认展开）；② 前几轮累积待办保留（KaTeX 与 highlightAuto 两项决策）。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-19 第九轮·用户反馈回归修复：打字闪烁/工具行高/思考间距 + 思考内容默认展示）

- 当前目标（已完成，feature 保持 **done**）：第九轮·用户反馈回归修复——3 项用户报告的回归（① 输入框打字时过程折叠组闪烁展开一帧；② 工具摘要行高四套不齐；③ 思考块 header 隐藏仍占 28px 空白 + 组外间距 0.75rem 远大于组内 0.25-0.375rem）+ 1 项新需求（④ 思考内容默认展示）。本轮不是新 feature。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`（memo 化 `MessageArea` 包住消息区与 `ProcessGroupReleaseBoundary`，打字等无关 commit 不再触发 release；修正 boundary 注释）、`src/components/chat/surface/AssistantMessage.tsx`（正文列 gap-3→gap-1.5）、`src/components/chat/surface/ThinkingBlock.tsx`（默认展开 useState(true)）、`src/components/chat/surface/ToolMessage.tsx` + `src/lib/tool-renderers/generate-image-tool-renderer.tsx`（摘要行补 `.quickforge-tool-summary`）、`src/index.css`（面板作用域统一工具摘要行 min-height:1.625rem；压平区清默认卡 pre 边框/内距；thinking 原生头 visibility:hidden→display:none）、`tests/frontend/chat-surface-render.test.ts`（新增思考内容默认渲染断言）、`tests/frontend/chat-surface-css-contract.test.ts`（gap 标记期望更新）+ `progress.md`/`session-handoff.md`。
- 关键结论：ChatPanelHost 各触发点 decorate rAF 注册顺序本已先于 scroll rAF（含 scroll-sync.ts ResizeObserver 路径，其 scroll rAF 落在 decorate 之后的下一帧），无需调整；过程组默认收起语义保留未动。
- 验证：定向 vitest 7 files / 198 passed；`npm run test` 355 files / 4206 passed + 1 skipped（exit 0）；`npm run lint` 0 error / 3 warnings（coverage/ 既有）；`npm run build` exit 0。
- Blocker：无。已知限制：外部若传不稳定 `onCostClick` 会使 MessageArea memo 退化回旧的重渲染行为（当前挂载点未传）；`tests/server/session-state-repository.test.mjs` 多进程 CAS 用例在高负载全量下偶发失败（本轮单跑与全量复跑均过，既有 flake，与前端改动无交集）。
- 下一步：① 建议真实浏览器验收四项观感（打字不闪、工具行高对齐、思考间距、思考内容默认展示）；② 前几轮累积待办保留（真实浏览器/Electron 验收清单、KaTeX 与 highlightAuto 两项决策）。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 第八轮·用户反馈回归修复：死类复活致文字变淡）

- 当前目标（已完成，feature 保持 **done**）：第八轮·用户反馈回归修复——用户报告移除 pi-web-ui 后设置页/左侧项目列表文字变淡，定位为“死类复活”并批量移除。本轮不是新 feature。
- 根因：分数透明度工具类（text-foreground/80~92、text-muted-foreground/55~76、hover:text-*、focus:border-ring 等共 161 个类）在旧版是死类（旧本地构建无 `--color-*` 映射、pi-web-ui 包仅带 text-muted-foreground/50，元素继承全浓度前景色）；迁移后本地 `@theme inline` 语义色映射使其真实生效为半透明。证据：`package-dist/dist/assets/index-B1G0LqYR.css` 无这些类。
- 修复：按审计表（3e10f58 已有用法 ∧ 旧编译 CSS 无该类 → 移除）从 36 个文件移除 549 处类 token；迁移新代码（chat/surface、tool-renderers、settings/tabs 等）145 处保留；text-muted-foreground/50 等旧已生效类保留；更新 6 个测试文件期望。
- 验证：死类残留 grep 0；`npx tsc -b` 通过；`npm run test` 355 files / 4205 passed + 1 skipped；`npm run lint` 0 error / 3 warnings（coverage/ 既有）；`npm run build` 成功。抽查 ChatSidebar/SettingsWorkspacePage/MarkdownReader 形态正确。
- Blocker：无。已知限制：动态拼接类名（模板字符串内拼接）可能漏检；`tests/frontend/settings-workspace-react.test.ts` 并行高负载下偶发 2 例失败（单独运行及多轮全量均过，与类名无关）。仓库根 3 个评审残留文件（`$($a`/`5`/`pruned)`）已在收尾轮删除（实测无残留）。
- 下一步：① 建议用户硬刷新浏览器（跳过缓存）验证设置页/左侧项目列表文字观感恢复；② 真实浏览器/Electron 验收待办保留（前几轮累积清单：长会话滚动与轮次导航、设置页常驻 tab 隐藏/重载、diff 增删底色与标点色、复制反馈时长）；③ KaTeX 与 highlightAuto 两项决策。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 第八轮独立评审：窗口化对齐 + 设置页常驻 + diff/标点/复制反馈修复）

- 当前目标（已完成，feature 保持 **done**）：第八轮独立评审——以 HEAD `3e10f58`（移除 pi-web-ui/mini-lit/lit 之前）+ 移除前构建产物（`package-dist/dist/assets/index-B1G0LqYR.css`、`package-dist/dist`、`package-offline/dist`）为基线从零取证、不采信前七轮结论，修复 9 项回归（含 2 项行为语义、2 项 CSS 缺口），其余分类记录为有意变更/不可考证。本轮不是新 feature。
- 本轮修复 9 项（逐条证据见 progress.md 第八轮条目）：① `ChatSurface.tsx:272-274` 恢复 `createMessageWindow({ enabled: false })`（对齐旧 `ChatPanelHost.tsx:654-657`），一次渲染完整对话、轮次导航直接滚到已有 DOM 节点，`loadMoreMessages`/`showMessageIndex`/`data-window-start` 契约保留；② `SettingsWorkspacePage.tsx:56-68/260-275` 7 个 tab 常驻挂载 + `hidden` + `cloneElement` 注入 `active`，6 个 tab 重新激活时重载数据、channels 非激活断开 SSE，搜索无结果时已访问常驻 tab 仍挂载（旧版 Lit detach/attach + connectedCallback 语义）；③ ```diff 围栏恢复旧 `.hljs-addition`/`.hljs-deletion` 前景+底色（`code-highlight.ts:42-46/63-67/1443-1491`、`index.css:8005-8008/8021-8024/8036-8037`，取值逐字等于旧 `--syntax-addition/deletion-*`）；④ 删除 `--qf-hl-punct` 变量与 `.qf-hl-punct` 规则（旧调色板无 `.hljs-punctuation`）；⑤ 复制反馈时长按旧路径拆分——标题栏 2000ms（旧 mini-lit `copy-button`）/ ⋯ 菜单 1200ms（旧 `code-blocks.ts:33` `showCopiedFeedback`）；⑥ ⋯ 菜单互斥范围恢复为同一 `.qf-markdown-block` 内（旧 `block.closest('markdown-block')`），外部点击/Escape 仍 document 级；⑦ 无信息串围栏语言标签恢复 `text`（旧 markdown 层行为）、保留原始大小写；⑧ 列表项间距核实旧 `ul`/`ol :not(:last-child)` 与新规则等价 → 未改动；⑨ 补齐护栏断言（css-contract 的增删旧值/无 punct、render 的 `data-window-start="0"`、chat-code-block 的 1200/2000ms 与 `text`、settings-workspace-react 的常驻与重载契约）。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`、`src/components/settings/SettingsWorkspacePage.tsx`、`src/lib/code-highlight.ts`、`src/index.css`、`src/components/chat/surface/CodeBlock.tsx`、`src/components/chat/surface/Markdown.tsx`、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`tests/frontend/chat-surface-render.test.ts`、`tests/frontend/chat-code-block.test.ts`、`tests/frontend/settings-workspace-react.test.ts` + 本轮文档（`progress.md`、`session-handoff.md`、`feature_list.json`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/README.md`）。
- 有意变更/保留（不复刻）：未知语言不再像 hljs `highlightAuto` 猜测着色（**待决策**）；KaTeX 公式渲染随包移除（**待决策**）；color-mix 旧浏览器 `@supports` 回退缺失（现代浏览器无影响）；附件解析安全上限（有意加固）；设置下拉修复“按键打开后多走一格”（有意变更）；工具卡折叠记忆 key 改 `toolCall.id`、容量 200→100（有意变更）；KaTeX/hljs 相关通用 CSS 类不复存在（预期）。不可考证：pi-web-ui 包（含 shadow DOM）内部行为（旧包已从 `node_modules` 卸载，只能经旧构建产物间接推断）。
- 验证（由父 Agent 统一执行，本轮独立评审的源/测试修复与其验证属同一轮）：`npm run test` **355 files 全通过 / 4205 passed + 1 skipped（exit 0，50.71s）**；`npm run lint` **0 error / 3 warnings（exit 0；3 个 warning 全部来自 `coverage/` 生成目录的 Unused eslint-disable 指令，非源码）**；`npm run build` **exit 0（vite built in 2.68s）**，仅 chunk >500kB 与 `node:fs` externalize 两处既有 stderr 警告。本轮定向验证为各回归护栏单测（`chat-surface-behavior-alignment`、`chat-surface-css-contract`、`chat-surface-render`、`chat-code-block`、`settings-workspace-react`）随全量跑。本条目的文档落盘本身未改源码/测试。
- 本轮文档同步：`docs/wiki/src/components/README.md` 的窗口化条目改为“默认关闭 + `enabled:false` 显式透传”表述、CodeBlock 条目的语言标签（`text` 而非 `plaintext`）与复制反馈（2000ms/1200ms）、diff 增删底色说明；`docs/wiki/src/lib/README.md` 的 `code-highlight.ts` 行数 1531→**1532** 并补 punct/plain 无样式与 `--qf-hl-addition/deletion-*` 旧值说明；`docs/wiki/src/README.md` 的 `main.tsx` 69→**83**、`App.tsx` 684→**2340**、`index.css` 5345→**8039** 行数修正。
- Blocker：无。下一步：① 真实浏览器/Electron 视觉验收（全量渲染后的长会话滚动与轮次导航、设置页常驻 tab 的隐藏/重新激活重载、diff 增删底色与标点色、复制反馈时长）；② KaTeX 与 highlightAuto 两项决策；③ `docs/wiki/src/components/README.md` 存在**整页重复**（第 318 行起为第二个副本，两副本仅差 2 行旧内容；非本轮引入，待用户决定是否清理，本轮按“最小改动”仅同步两副本中的同一条窗口化描述）；④ ~~`src/components/chat/panel-decoration/message-actions.ts:143-148` 注释仍写“React ChatSurface still windows the conversation”，与 `enabled:false` 矛盾~~ → 收尾轮已改写为现状注释（窗口控制器保留但 `enabled:false`、装饰层拿到完整消息数组；纯注释改动，无逻辑变更）；⑤ ~~仓库根新增 3 个未跟踪评审残留文件 `$($a`/`5`/`pruned)`（未删除）~~ → 收尾轮已按精确路径 node fs 只读确认内容后 unlink 删除，`git status --porcelain -uall` 复核无异常名残留。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 第七轮独立评审：从零取证修复 7 项回归）

- 当前目标（已完成，feature 保持 **done**）：第七轮独立评审——以 3e10f58 + pi-web-ui 0.75.3 app.css（`package-dist/dist/assets/index-B1G0LqYR.css`）为基线从零取证、不采信前六轮结论，修复 7 项回归并分类记录不改项。本轮不是新 feature。
- 本轮修复 7 项：① `src/index.css` markdown 链接 hover 恢复 `@media(hover:hover)` + `@supports` color-mix fallback 结构；② `CodeBlock.tsx` 菜单复制源码不再关菜单（copied 反馈可见，download/模式切换仍关）；③ 菜单互斥经 document 级 CustomEvent（`quickforge:code-block-menu-open`）恢复（含键盘路径）；④ shell 块按钮顺序恢复 [复制][运行]；⑤ 运行按钮恢复 assistant 门控（`shellBlock && runInTerminalEnabled && assistant`）；⑥ `tool-renderers/shared.tsx` renderCodeBlock 用 code-highlight 高亮 + 1200ms copied 反馈（`ToolCodeBlock`），`ToolDetails` 模块级 LRU(100) 开合记忆跨 remount 持久；⑦ `SettingsWorkspacePage.tsx` customModels tab 首次激活后保持 mounted（hidden 隐藏，`index.css` 补 `[hidden]` display:none），未保存表单跨 tab 保留。
- 改动文件：`src/index.css`、`src/components/chat/surface/CodeBlock.tsx`、`src/lib/tool-renderers/shared.tsx`、`src/components/settings/SettingsWorkspacePage.tsx`、`tests/frontend/chat-surface-css-contract.test.ts`、`tests/frontend/chat-code-block.test.ts`、`tests/frontend/tool-renderer-code-block.test.ts`（新增）、`tests/frontend/tool-renderer-shared-state.test.ts`（新增）、`tests/frontend/settings-workspace-react.test.ts` + 三状态文件。
- 验证：`npm run test` 355 files / 4190 passed + 1 skipped（scheduled-tasks 未触发既有 flake）、`npm run lint` 0 error / 3 warnings（coverage/ 既有）、`npm run build` 成功（2.83s）；依赖 diff 干净——package.json 仅移除 pi-web-ui/mini-lit/lit + 新增 jszip(dev)，lock 26 项移除 / 0 新增 / 0 升级。
- Blocker：无。不改项与不可考证清单已分类记录入 progress.md 第七轮条目（CSS 8 项 / 交互 14 项 / 不可考证 2 项）。
- 下一步：真实浏览器验收待办保留（前六轮累积清单 + 本轮新增：滚动意图收紧 A1/A3 触摸长惯性到顶不翻页边界、窗口化重开 B1/F4/B5 连带）。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 第六轮一致性评审：移除 pi-web-ui 前后全面对比清单落盘）

- 当前目标（已完成，feature 保持 **done**）：第六轮独立一致性评审——全面对比移除 pi-web-ui/mini-lit/lit 前后的 CSS 与交互，落盘对比清单，修复 2 项缺口并扩充契约测试。本轮不是新 feature。
- 评审方法：对比 3e10f58 旧 `src/index.css`（git show）+ `package-dist/dist/assets/index-B1G0LqR.css`（pi-web-ui app.css 注入部分）+ 旧 panel-decoration 源码。
- 一致项结论（等值迁移/逐字一致，未改动）：链接 a/a:hover color-mix 80%、表格无斑马纹/无 thead 规则、行内代码取值、`--qf-hl-*` 对齐 `--syntax-*`、对话框 keyframes 180ms、`--quickforge-dur-*`/ease、主题 token、滚动条（含 thumb:hover 透明逐字相同）、conversation-enter/waiting-enter/waiting-dot/composer 160ms/svg 菜单 160ms、markdown 排版、`--text-sm--line-height`。
- 交互保留：panel-decoration 36 装饰器全保留（command-suggestions、message-queue、plan-mode-controls、editor-bindings、composer-plus-menu、send-stop-button、scroll-to-bottom-button、message-actions、process-folding、input-clamp、local-file-path-links、ask-user/approval、agent-access-menu）；SettingsSelect 全键盘交互等价；MessageEditor Enter/IME/Escape 等价；scroll-sync/windowed-messages 契约不变。
- 本轮修复 2 项：① `.animate-shimmer` 补 prefers-reduced-motion `animation: none` 豁免（DESIGN_LANGUAGE keyframes 降级约束）；② `.qf-markdown-block :not(pre) > code` 补 `line-height: var(--text-sm--line-height)`（对齐旧 `.markdown-content code:not(.hljs)`）。
- 改动文件：`src/index.css`、`tests/frontend/chat-surface-css-contract.test.ts`（行内 code 断言）、`tests/frontend/motion-design.test.ts`（shimmer 豁免断言）+ 三状态文件。
- 验证：定向 vitest 2 files / 30 passed（motion-design 14、css-contract 16，各含新增 1 例）；全量 `npm run test` 353 files / 4173 passed + 1 skipped、`npm run lint` 0 error / 3 warnings（coverage/ 生成目录，既有）、`npm run build` 成功。
- Blocker：无。已知边界：ApiKeyPromptDialog 原版动画/焦点陷阱不可考证（保持无动画，与旧版 app.css 无 dialog keyframes 一致）；code-block 折叠细节旧 shadow DOM 不可考证（现 max-h-96 滚动）；KaTeX 随包移除；pi-web-ui shadow DOM 内部样式不可取证。
- 下一步（可选，均不扩当前范围）：补全量 test/lint/build 验证；plan-mode-controls 与 local-file-path-links 键盘交互测试；SettingsSelect render 期 setState 反模式治理；装饰层锚点契约测试加固；KaTeX / artifacts 待产品决策。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 评审轮：对比移除 pi-web-ui 前后交互与 CSS，自查自修）

- 当前目标（已完成，feature 保持 **done**）：第五轮独立评审——对比移除 pi-web-ui 前后的交互与 CSS，自查自修 5 项回归。本轮不是新 feature。
- 评审方法：基线 3e10f58（git show 取旧实现）+ `package-dist/dist/assets/index-B1G0LqYR.css` 旧 CSS 对比源 + pi-web-ui 0.75.3 npm tarball 取证。
- 本轮修复 5 项：① `.qf-markdown-block a:hover` 恢复 color-mix 80% 变色、链接去 underline-offset-4；② markdown 表格恢复旧样式（去卡片容器/恢复竖向列分隔线/muted 表头/0.5rem padding/左对齐 semibold，值照抄旧 `.markdown-content` 规则）；③ `ApiKeyPromptDialog` 补 Escape 关闭（`isDialogEscapeKey` 纯函数 + window keydown + 单测）；④ 代码高亮 `--qf-hl-*` 配色对齐旧 `--syntax-*`（keyword/string/comment/tag 直配、function←entity、number/property/attr←constant、builtin←variable；heading/list/diff± 无对应 token 记已知差异）；⑤ ThinkingBlock 自带 header 兜底观感对齐装饰层 88%/86% mix、chevron hover 渐显。
- 一致项结论（等值迁移/逐 token 一致，未改动）：滚动行为、code block 交互（shell 语言集/危险命令正则/SVG/mermaid 防竞态）、composer 全链路、消息操作与 retry 可见性、主题 token、滚动条、动画、消息气泡。误报澄清：composer 内联控件装饰层仍注入全部 quickforge-* class，旧 CSS 非 dead code。
- 改动文件：`src/index.css`、`src/components/chat/surface/Markdown.tsx`、`src/components/chat/surface/ApiKeyPromptDialog.tsx`、`tests/frontend/chat-surface-api-key-dialog.test.ts`（新增 Escape 用例）、`tests/frontend/chat-surface-css-contract.test.ts`（链接/表格断言扩充）+ 三状态文件。
- 验证：定向 vitest 7 files / 102 passed + 改动 TS 文件 eslint 0 error；全量 `npm run test` 353 files / 4171 passed + 1 skipped、`npm run lint` 0 error / 3 warnings（coverage/ 生成目录）、`npm run build` 成功。
- Blocker：无；真实浏览器观感验收仍缺（a:hover 变色、表格分隔线、高亮配色、ThinkingBlock 兜底观感需人工确认）。
- 下一步（可选）：装饰层锚点（`.flex.gap-2.items-center`、`textContent.includes(model.id)`）契约测试加固；KaTeX / artifacts 待产品决策。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 移除 pi-web-ui 后 CSS/交互回归修复轮）

- 当前目标（已完成，feature 保持 **done**）：针对 uncommitted `self-hosted-chat-ui` 把 Lit/pi-web-ui 换成 React 后的真实回归做最小修复。本轮不是新 feature。
- 本轮修复：① 恢复聊天 Markdown 排版——`src/index.css` 补回 unlayered `.qf-markdown-block` 的 h1–h6/p/a/list/blockquote/code/hr 规则（对齐旧 `.markdown-content`，压过 Tailwind preflight 折叠），文件头注释改为「聊天正文排版而非 unused web-component CSS」；字号/行高选择器同时命中 `.qf-*` 与 `.quickforge-*`；用量条隐藏改为 `.quickforge-composer + .qf-usage-bar`；窄屏气泡与 first/last 边距 reset 补 `.qf-user-message`。② `Markdown.tsx` 工具类与上述 CSS 对齐（a 常驻 underline、blockquote/ul/ol/hr 间距、inline code `bg-muted`），不加 heading/p 组件、保留 table overflow-x-auto。③ 去掉 ChatSurface 的 `distanceFromBottom < 10` 滚动监听 + ResizeObserver 抢滚动；尾部跟随仍由 `autoScrollRef && atTail` 的 layout effect 负责；宿主 `onReachTop` 用 `beginProgrammaticScroll` 包住 `loadMoreMessages`；窗口化保持默认开启。④ 修正 `message-actions.ts` 过时注释：T5 并未去掉窗口化，host 传 `getWindowStart()`。
- loadMore 的 programmatic-scroll 守卫改为等窗口 commit/scrollTop 还原后再 end，不再用双 rAF。
- 验证：定向 vitest **7 files / 84 passed**（css-contract / behavior-alignment / scroll-sync / windowed-messages / turn-navigation / chat-surface-message-list / chat-code-block）；改动 TS 文件 eslint **0 error**。未跑全量 test/lint/build。
- 有意保留的缺口：KaTeX、artifacts 面板、highlight.js 调色板未移植；未做真实浏览器 QA。composer 装饰 `.flex.gap-2.items-center` 选择器未改（class 顺序无关）。
- Blocker：无。下一步：真实浏览器验收滚动/排版；KaTeX 与 artifacts 仍各自单独立项。无 Git 写操作。

---

## 历史交接：self-hosted-chat-ui（done，2026-09-18 T1-T9 全量自研收尾 + 两轮复核修复 R1-R11 / M1-M2·L1·L5-L6 + 对齐轮附件安全/行为样式/存储/自研语法高亮 + 全面评审自查自修轮终态）

- 当前目标（已完成）：一次性移除 `@earendil-works/pi-web-ui`、`@mariozechner/mini-lit`、`lit`，聊天 UI 全量自研。T1-T9 全部落地，`feature_list.json` 中该 feature 置 **done**（主列表 28 条全部 done，无 in_progress）。2026-09-18 追加第四轮「全面评审 + 自查自修」（代码修复 + 验证全绿），该 feature 状态保持 **done**。
- 最终架构：本地存储层 `src/storage/`（AppStorage + 4 Store，StorageBackend 契约，后端仍是 `src/lib/http-storage-backend.ts`）；纯本地 ReactNode 工具渲染 registry（`src/lib/tool-renderer-registry.ts` + `src/lib/tool-renderers/`）；React 聊天面板 `src/components/chat/surface/`（18 文件：第一轮复核新增 `CodeBlock.tsx`，第二轮复核删除死组件 `AbortedMessage.tsx`，对齐轮新增 `surface-context.ts`，ChatSurface 取代 ChatPanel + AgentInterface，ChatPanelHost 内化 panel-decoration，scroll-sync/windowed-messages 契约不变）；纯 React 设置页 `src/components/settings/tabs/` + `SettingsSelect`；本地主题 token（`src/index.css` 不再 import pi-web-ui/app.css）；文档附件解析本地化（attachment-loader + 直接依赖 jszip）。
- 改动文件范围：新增 `src/storage/`、`src/lib/tool-renderer-registry.ts`、`src/lib/tool-renderers/`、`src/components/chat/surface/`、`src/components/settings/tabs/`、`src/components/settings/SettingsSelect.tsx` + `settings-select-state.ts`、`docs/wiki/src/storage/README.md`、13 个前端测试文件 + `tests/frontend/fixtures/chat-message-contract.ts`、`tests/frontend/settings-react-harness.ts`；删除 `src/components/chat/side-chat-renderer-isolation.ts`、13 个 `src/lib/*-settings-tab.ts` 系旧 Lit 文件、2 个对应测试；修改 `ChatPanelHost.tsx`、`SettingsWorkspacePage.tsx`、`SharedConversationPage.tsx`、`windowed-messages.ts`、`scroll-sync.ts`、`panel-decoration.ts`（及其目录下 20 个文件）、`local-tools.ts`、`http-storage-backend.ts`、`settings-tabs.ts`、`react-settings-tabs.tsx`、`tool-display-settings.ts`、`tool-param-summary.ts`、`pi-chat.ts`、`types.ts`、`i18n.ts`、`main.tsx`、`index.css`、`vite.config.ts`、`package.json`、`package-lock.json`、`server/session-state-service.mjs`、4 个 wiki 文件与三份状态文件。完整清单见 `feature_list.json` 该条目 files 数组（131 项，**非穷尽**，实际改动约 143 个文件）。本轮复核新增 `src/components/chat/surface/CodeBlock.tsx`、删除 `src/components/chat/panel-decoration/code-blocks.ts`，修正 `panel-decoration/editor-bindings.ts`、`panel-decoration/message-queue.ts`、`panel-decoration/assistant-waiting-bubble.ts`、`panel-decoration/process-folding.ts`、`ChatPanelHost.tsx` 与 `src/lib/i18n.ts`，新增 `tests/frontend/chat-code-block.test.ts`、`tests/frontend/process-folding-ownership.test.ts`。第二轮复核新增 `tests/frontend/chat-surface-css-contract.test.ts`、`tests/frontend/decorator-copy-i18n.test.ts`，删除 `tests/frontend/decorate-subagent-process.test.ts` 与 `src/components/chat/surface/AbortedMessage.tsx`，修正 `src/index.css`（消息根直接子级的用量行隐藏/用户气泡右对齐层级）、`src/components/chat/context-usage.ts`、`src/components/chat/panel-decoration/local-file-path-links.ts`、`src/components/chat/panel-decoration/message-actions.ts`、`src/components/chat/panel-decoration.ts`、`src/lib/tool-renderers/shared.tsx`、`src/lib/i18n.ts`（键增补）与 surface/装饰层文案。第四轮（全面评审 + 自查自修）修改 `surface/MessageEditor.tsx`、`surface/AssistantMessage.tsx`、`surface/ChatSurface.tsx`、`surface/AttachmentPreview.tsx`、`surface/Markdown.tsx`、`surface/UserMessage.tsx`、`surface/AttachmentOverlay.tsx`、`src/components/settings/settings-select-state.ts`、`src/lib/i18n.ts`、`src/lib/code-highlight.ts`、`src/index.css`、`src/storage/types.ts`、`src/storage/stores/sessions-store.ts`、`src/lib/http-storage-backend.ts`、`src/lib/local-tools.ts`、`src/App.tsx`、`src/lib/subagent-run-detail.ts`、`src/lib/input-clamp.ts`、`src/lib/server-agent.ts`、`src/components/workspace/useInspectorTabs.ts`、`docs/bug/frontend-bugs.md`，并新增/扩充 4 个测试文件的用例。
- 验证（2026-09-18 终态，两轮复核修复后复跑）：`npm run test` **350 files / 4078 passed + 1 skipped**（exit 0）、`npm run lint` **0 errors**（3 warnings 全部来自 coverage/ 生成目录）、`npx tsc -b` **通过**、`npm run build` **成功**（exit 0，built in 2.47s，仅既有 chunk 体积 warning）；dist/assets 合计 **16.34MB → 13.93MB**（本轮按当前 dist 复算 14607927 字节 / 255 文件）、首屏 modulepreload **6.48MB → 2.80MB**（11 个 link 合计 2938650 字节；上一轮收尾复算为 13.94MB / 2.82MB，差异来自本轮源码微调后的重新构建）；i18n en/zh 键对齐 **1649/1649**（原记 1643/1643 为误记，已在第四轮复核实测更正）；依赖卸载 3 个、仅新增 `jszip`（^3.10.1，devDependencies，显式直接依赖，理由见 progress.md），package-lock 一致；wiki 已同步（新增 `docs/wiki/src/storage/README.md`）。第一轮复核修复 R1-R11 回归（代码块能力 React 化、composer DOM 契约、附件 tile 选择器、surface 文案 i18n、思考等级口径、侧边会话模型按钮、过程折叠所有权租约）及三处小缺陷（双转义换行、硬编码中文、死选择器）；第二轮复核修复 M1/M2（`src/index.css` 用量行隐藏与用户气泡右对齐的 CSS ⇄ DOM 结构契约失效，新增 `tests/frontend/chat-surface-css-contract.test.ts`）与 L1/L5/L6（删除失效子代理装饰函数与假契约测试 `tests/frontend/decorate-subagent-process.test.ts`；surface/装饰层/工具卡文案 i18n 化 + `i18n.ts` 键增补，新增 `tests/frontend/decorator-copy-i18n.test.ts`），并删除死组件 `AbortedMessage.tsx`、修正过时注释。约定：文案断言前用 `applyAppLanguageFromSnapshot` 固定语言，键集合必须 en/zh 一致。
- Blocker：无。已知偶发 flake（与本次改动无关、不阻塞）：`tests/server/scheduled-tasks.commands.test.mjs` 第 192/593 行用例在高负载全量并行下因 `vi.waitFor` 10s wall-clock + SQLite/IO 尖峰偶发失败，复跑即过；该测试与被测 server 源文件均不在未提交改动中。
- 下一步建议：⓪ **提交范围待用户决定**——当前 `ui` 分支工作区仍有大量未提交改动（见下方工作区状态），本轮修复与其后核查都应纳入同一次提交范围决策，本会话不做 commit/tag/push；① **真实浏览器/客户端验收清单**——composer 卡片观感、CodeBlock 交互（复制/终端执行/SVG 预览/mermaid 工具栏）、主题 token 视觉、滚动锚定与「回到底部」、附件预览（PPTX/DOCX/图片）、长会话窗口化、过程折叠所有权租约在真实 React 提交时序下的表现、设置各 tab、侧边聊天与分享页的存储单例行为；② pi-web-ui 内置 artifacts 面板若确需恢复能力，**单独立项**（当前仅有 `onArtifactsChange` 抽取 → 工作区产物/预览链路，未等价复刻；QuickForge 不产出 artifact 角色消息，历史数据若含该类消息不可见）；③ 附件 tile `title` 全角冒号分隔符本地化待确认；④ 后续如需发布，按 `docs/architecture/patch-release-runbook.zh-CN.md` 走 patch 版本流程（发布前必须完整通过 test/lint/build）；⑤ 对齐轮遗留 backlog（各自单独立项）：流式性能三叠加优化、7 个设置 tab 专属测试、Excel 预览虚拟化、pi-ai 1.6MB chunk 懒加载；⑥ 自研语法高亮为阅读级启发式（模板串插值不再分词、正则字面量按前置 token 启发式等局限，见 `src/lib/code-highlight.ts` 头注），完美解析不在范围；⑦ 全面评审轮记录的 4 项未处理项（不阻塞，各自可单独立项）：tool-renderers 各渲染器类未 `implements ToolRenderer`、CodeBlock 预览图放大无键盘可达 + lightbox 无焦点捕获/归还、`ApiKeyPromptDialog` 无 Escape 关闭且输入框未 autofocus、docx-preview 第三方属性复制面未逐行审计。
- 工作区状态与历史「未提交」表述（2026-09-18 本轮 `git status --porcelain` 实测）：分支 `ui` **无上游跟踪**（`git rev-parse @{u}` 报 no upstream），HEAD = `3e10f58`；工作区共 177 条状态——已跟踪修改 125、删除 18、未跟踪 34，即**仍有大量未提交改动，提交范围/时机由用户决定**。本 feature 改动（含第一轮 R1-R11 与三处小缺陷、第二轮 M1/M2 结构契约与 L1/L5/L6、对齐轮附件安全/行为样式/存储/自研语法高亮、第四轮全面评审自查自修）全部留在工作区，未手工修改 `dist/`、`package-dist/`、`package-offline/`（dist 仅由 `npm run build` 正常产出）。下个会话注意：本文档中历史条目的「未提交/待提交」表述已被后续提交覆盖，勿再当作待提交存量——`remove-cloud-service` 与 `project-commands-settings-ux` → `3e10f58`、`lan-access-info-tip` → `6807a84`、`dead-code-cleanup-round2` → `4892460`、`scheduled-tasks` 系列（command-support / goal-support / frequency-select / ui-optimization）→ `10ecfeb`。根目录转义事故产生的 0 字节未跟踪文件 `')` 已在对齐轮 unlink、`m[1])` 已在第四轮 unlink；本轮 `git status --porcelain` 输出中未见其它异常名条目（`skills/skill-creator/scripts/__init__.py` 为被跟踪的合法 Python 包标记）。`init.sh` 为 CRLF 换行（21 行 CRLF、无纯 LF），本轮未运行（直接执行 `npm run test`/`npm run lint`/`npm run build`）。
- 对齐轮记录（2026-09-18，第三轮独立复核）：① 附件预览安全加固 10 项——Markdown 渲染结果超链接净化（href 白名单/危险链接置 #/rel+target 硬化/可疑 style 移除）、zip 解压条目数与体积上限、超长截断、PDF 页数上限、渲染超时、Excel 50 列/5000 行采样与稀疏 !ref 收窄、预览 ErrorBoundary、下载容错、pdfjs `isEvalSupported:false`（回归 `tests/frontend/attachment-preview-security.test.ts`）；② 行为对齐 5 项——模型切换 `chatPanelRevision` 刷新快照、composer 挂载一次性聚焦、side-chat/只读终端门控改 `surface-context.ts`（CommandActionsEnabledContext，fail-closed）、`onInitialRenderReady` 双 rAF 屏障、滚动恢复阈值放宽，另修菜单定位回调旧值与死参数（回归 `tests/frontend/chat-surface-behavior-alignment.test.ts`）；③ 样式对齐 3 项——MCP/subagent 渲染器 `isCustom:true` 压平、根级样式重置、UsageBar button 覆盖；④ 存储 `SessionsStore.updateTitle` 双 store 单事务原子化 + 幂等守卫（修测试隔离）；⑤ 自研语法高亮 `src/lib/code-highlight.ts`（16 组语言、200KB 护栏、零新依赖，`CodeBlock.tsx` 消费 `qf-hl-*`，关闭「无语法高亮」缺口，回归 `tests/frontend/code-highlight.test.ts`）。终态验证（覆盖前序 350 files / 4078 阶段数字）：`npm run test` **353 files / 4159 passed + 1 skipped**、`npm run lint` **0 errors / 3 warnings**（coverage/ 的 Unused eslint-disable）、`npx tsc -b` **通过**、`npm run build` **成功**（built in 3.19s）；dist/assets **14637992 字节 / 255 文件（约 13.96MB）**、首屏 11 个 modulepreload **2939761 字节（约 2.80MB）**。文档同步：wiki `src/README.md`、`src/components/README.md`、`src/lib/README.md`（自研高亮表述 + code-highlight.ts/surface-context 条目）与 `feature_list.json`（approach ⑪ / boundaries 关闭无高亮条目并保留 KaTeX 边界 / verification 终态数字 / files +5 至 131 项）、`progress.md` 对齐轮记录；feature_list JSON.parse 复验通过。
- 全面评审 + 自查自修轮记录（2026-09-18，第四轮独立复核，源码/测试/文档/状态文件一并更新）：① 竞态与时序——`surface/MessageEditor.tsx` 改用 `attachmentsRef` 消除 `addFiles` 异步竞态（连续选择/粘贴附件不再丢文件）；`surface/ChatSurface.tsx` effect 依赖收敛为 `[agent]`、清理冗余 `resumeTail`、prompt 转发按是否重载分流并补注释。② 渲染——`surface/AssistantMessage.tsx` 去掉 Fragment index key。③ 安全——`surface/AttachmentPreview.tsx` 的 docx 后置 sanitize 补 `img[src]` 协议校验；`surface/Markdown.tsx` 新增 `isSafeMarkdownImageSrc` 拦截危险 scheme。④ 无障碍——thinking select 与 file input 补 `aria-label`；`settings-select-state.ts` 未聚焦时 ArrowUp 落最后一项；`UserMessage.tsx`/`AttachmentOverlay.tsx` 测试钩子类名补注释。⑤ 死代码与契约——`src/index.css` 删 3 处死选择器（含 settings-dialog/settings-tab 旧 Lit 契约残留）、`sessions-store.ts` 删零引用 `deleteSession` 别名（被测试引用的 3 个别名保留 + 注释）、`storage/types.ts` preview 注释修正为 last assistant/200 chars、`http-storage-backend.ts` 对 2xx 非法 JSON 抛明确 Error、`local-tools.ts` 补 MCP 渲染器先到先得注释、`App.tsx` `PREVIEW_ARTIFACT_EVENT` 注释指向修正、`subagent-run-detail.ts`/`input-clamp.ts`/`server-agent.ts`/`useInspectorTabs.ts` 共 9 处过时注释、`docs/bug/frontend-bugs.md` F-03 标注失效。⑥ 类型与高亮——`EditorFileLike` 放宽为 `{ size: number }`；`code-highlight.ts` JSX 插值递归深度上限 32（含既有 round-trip bug 修正）。⑦ i18n 缩进 3 行 5→4 空格；删除仓库根 0 字节垃圾文件 `m[1])`。新增测试：code-highlight 深嵌套畸形输入 3 例、settings-select 未聚焦方向键 1 例、MarkdownBlock image safety 3 例、attachment-preview-security `sanitizeAttachmentImages` 1 例 + FakeImage fixture。验证（本轮终态，覆盖前序 353 files / 4159 阶段数字）：`npx tsc -b` 0 错误、`npm run test` **353 files 全通过 / 4168 passed + 1 skipped**、`npm run lint` **0 error / 3 warning**（coverage/ 内，可接受）、`npm run build` **成功**（3.49s）；i18n 键数实测 en/zh **1649/1649**。

---

## 历史交接：self-hosted-chat-ui（阶段记录：in_progress，2026-09-18 T6 通知修复；结论已被上方 done 记录取代）

- 当前目标：一次性移除 pi-web-ui/mini-lit/lit；**T1-T5 完成、T6 进行中、T7-T9 待办**。前序改动全部保留，本 feature 尚未完成。新 settings tabs 尚待完成接入/整体验证，不可把文件已创建当作迁移验收完成。
- 本次文件：`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`、新增 `tests/frontend/default-options-settings-react.test.ts`、三状态文件；未改 shared/设置入口/其他 tab/依赖/生成产物。
- 修复：通知持久化与 state setter 消除遮蔽，关闭/授权/拒绝/prompt/unsupported/异常/加载时权限失效均同步最终落盘与 UI；保留 native 初始化请求前启用顺序。定向 lint 暴露并修正该文件迁移期 refs 渲染访问，加载/事件维护镜像，代理 finally 复位 saving。
- 验证：新 React tab 定向 13 例 + 通知服务 18 例，**2 files / 31 passed**；两文件 ESLint **exit 0、无 warning**。**此前 340 files / 3947 passed + 1 skipped 仅是历史验证，不是最终当前状态**。未跑当前工作树最终全量 test/lint/build 或真实客户端验收。
- Blocker/风险：T6 整体接入与其他 tabs 回归待主 Agent 整合；通知真实 native/浏览器权限未实际触发，测试为 hook-state harness + 真实 localStorage 持久化函数，不等于 DOM/StrictMode/E2E。新旧静态翻译键一致；3 个数字输入旧 native change+blur 现为 React onChange 编辑+onBlur 提交，Enter/步进器提交时机差异待整体验收确认。
- 下一步：完成 T6 设置入口/shared 接线与行为回归，再推进 T7-T9、依赖移除/wiki 同步及最终验证；如后续确认数字提交差异属于必保契约，单独在本文件补最小修复与回归。无 Git 写操作，本次改动未提交。

---

## 最新交接：remove-cloud-service（done，2026-09-18）

- 当前目标已完成（待提交）：完全移除 QuickForge Cloud 云服务。阶段A（服务端：server/cloud/ 10 模块 + routes/cloud.mjs 删除及 16 个耦合文件去云）、阶段B（前端：11 个云组件/库/hook 删除及 24 文件去云化 + 21 个云测试删除/相关测试修复）、阶段C（文档同步 + 项目记录 + 全量验证）均完成。
- 阶段C改动文件：删除 5 个云专属文档（docs/architecture/quickforge-cloud-client.zh-CN.md、docs/architecture/cloud-admin-console.zh-CN.md、docs/design/remote-access-p2p.md、docs/design/cloud-admin-console-wireframe.svg、design-mockups/cloud-url-row-redesign.html）；docs/architecture/android-remote-client.zh-CN.md 顶部状态说明（云服务已移除、Android 原生云代码暂留、云远程不可用）；docs/wiki/{server,server/routes,src,src/lib,src/hooks,src/components}/README.md 去云；docs/user-guide.{zh-CN,en-US}.md 删云章节；feature_list.json / progress.md / session-handoff.md 追加记录。
- 验证：全量 test（333 files / 3900 passed + 1 skipped）、lint（0 errors，仅既有 coverage 3 warnings）、build（exit 0，仅既有 KaTeX/chunk warnings）全部通过；残留扫描 src/、server/、docs/wiki/、docs/user-guide* 无云服务残留引用（保留项见 feature_list boundaries）。
- 并行会话共存：project-commands-settings-ux 未提交改动（src/lib/project-commands-settings-tab.ts、src/lib/i18n.ts、tests/frontend/project-commands-settings-tab.test.ts、docs/wiki/src/lib/README.md、三状态文件）保持原样，本 feature 只做增量追加/局部编辑，未覆盖重写。
- Blocker：无。
- 下一步：① Android 原生云代码（android/、capacitor.config.ts 相关云部分）待后续单独清理；② package-dist/package-offline 待下次打包时再生成（本次未重新打包）；③ 用户决定提交时机（改动未提交，无 Git 操作）；④ 遗留本地云数据（cloud-identity.json 等）不主动清理，待产品决策。
- Notes：关键决策——分享 SQLite 列 allow_cloud_usage 保留；旧云模型引用自然降级（model_not_configured）；docs/wiki/README.md 无指向被删文档的链接，未修改。

---

## 最新交接：project-commands-settings-ux（done，2026-09-17）

- 当前目标已完成（待提交）：设置-项目命令 tab UI 交互优化——新建命令由 window.prompt 改为 showPrompt 弹窗（en/zh 新增 newCommandNamePlaceholder）；打开命令目录由硬编码 .ai/commands 改为取 commandDir 配置首个非空行（空则回退 .ai/commands）。
- 改动文件：src/lib/project-commands-settings-tab.ts、src/lib/i18n.ts、tests/frontend/project-commands-settings-tab.test.ts（新增 7 用例）、feature_list.json、progress.md、docs/wiki/src/lib/README.md、session-handoff.md。
- 验证：定向 vitest 9 用例通过；eslint 0 错；tsc -b 通过。
- Blocker：无。
- 下一步：用户决定是否连同死代码清理改动一起提交（当前 dev 分支工作区尚有上次会话死代码清理的未提交改动）。
- Notes：打开目录取 commandDir 首行与新建命令固定落盘 .ai/commands 存在不对称（服务端行为，未改）；该 tab 其余 UX 问题（来源标注、编辑/删除、目录选择器、提示不自动消失）未在本次范围。无 Git 操作。

---

## 最新交接：lan-access-info-tip（done，2026-09-18）

- 当前目标已完成：局域网访问设置 tab 7 处静态说明（enabled/passwordStatus/activeDevices/urls/allowFull/sessionTtl/actions 对应的 *Description 文案）由常驻段落收敛到各节标题旁 quickforge-info-tip，对齐 default-options-settings-tab.ts 模式与 DESIGN_LANGUAGE.md「辅助说明应收拢」。
- 改动文件：src/lib/lan-access-settings-tab.ts、progress.md、session-handoff.md。
- 验证：eslint 通过、npm run build 通过（仅既有 warning）；无现有相关测试。
- Blocker：无。
- 下一步：无待办；改动未提交，commit 时机由用户决定。
- Notes：纯 UI 文案收敛，docs/wiki 无需更新；feature_list.json 未动（非其 feature 项）；无 Git 操作。

---

## 最新交接：dead-code-cleanup-round2（done，2026-09-17）

- 当前状态：死代码清理 round2 **已执行完毕、全量验证通过、待提交**——用户确认删除 15 组、K8 保留；`npm run test` 354 files / 4101 passed + 1 skipped（exit 0）、`npm run lint` 0 errors（仅既有 coverage 3 warnings）、`npm run build` exit 0（仅既有 KaTeX/chunk warning）。报告已追加「五、执行结果」节（`docs/reports/dead-code-candidates-2026-09-16.zh-CN.md`）。
- 分支/基线：`cleanup/dead-code`，基线 `dev@10ecfebe8e6b29cf40f010e2df40efc70653003c`（=当前 HEAD `10ecfeb`，分支无 commit）；全部清理改动 + 4 个记录文件均未提交。
- 改动范围：server（routes 4 文件、index.mjs、utils/package-update.mjs、cloud/index.mjs 整删）、src 93 文件（A 批 92 + K7 3，2 文件重叠）、tests 10 文件（server 7 含 cloud 整删 + 前端 3）、package.json/package-lock.json/.gitignore、docs 6 文件、android 2 文件（删除）、scripts 1 文件（删除）+ 4 个记录文件；完整清单见 feature_list.json 与 `git status`。
- Blocker：无。
- 下一步：用户自行决定何时 commit（本会话禁止 commit/push）；K8 isSessionTextAttachmentPath 待产品决策（附件沙箱豁免接线点）；Android 未跑 gradle（零引用纯删除，静态验证）。
- Notes：goalConfirm i18n key 保留（extend_resume 活跃消费）；A 批审计曾漏报 tests 对 3 个符号（serializePanelTabs/browserTabFilePath/decorateUserContextChips）的引用致 18 用例回归，恢复 export 后修复并复验；K1-K6 的 server 端 confirm 处理与 `process-tree.mjs`、benchmark/vendor 脚本均保留。

---

## 最新交接：scheduled-tasks-ui-optimization（done，2026-09-16，含第二轮用户反馈修复）

- 当前目标：已完成 scheduled-tasks-ui-optimization 两轮迭代——第一轮：ScheduledTasksPage.tsx 单文件重构，任务列表由 2 列卡片网格改为紧凑行列表（规则列 md 起、时间列 lg 起），编辑表单/详情/历史筛选按 DESIGN_LANGUAGE.md 去除透明度 hack 并收紧密度；第二轮（用户反馈修复）：①层级修复——任务行 MoreHorizontal 菜单由 absolute z-20 内联改为 createPortal(document.body)+fixed z-50+锚点定位（视口钳制/上方翻转/click/blur/scroll/resize/Escape 关闭），对齐 AgentProfilesPage，修复被 4 层 overflow 祖先裁剪；②编辑表单对齐 AgentProfilesPage 模式——AI 解析弱化为辅助块（outline sm 按钮+解析结果上移）、模型/思考/项目/智能体由 icon-only 工具条升格为标准 label 字段、预览收紧行、操作按钮入卡内 footer、返回按钮左移。i18n/状态机/API 不变。
- 改动文件：src/components/scheduled-tasks/ScheduledTasksPage.tsx + 本批文档（docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md）。
- 验证：两轮均为定向 vitest tests/frontend/scheduled-tasks-page.test.ts 18/18、tsc --noEmit、eslint 全部通过；第二轮测试断言零改动。
- Blocker：无。
- 下一步：无固定待办；注意仓库存在大量历史会话未提交改动（server/、tests/、docs/wiki/ 等约 18 个文件），非本次改动，后续会话勿误认或误动。

---

## 最新交接：scheduled-task-frequency-select（done，2026-09-16）

- 当前目标已完成：定时任务编辑器执行频次改为下拉框选择（纯前端渲染层，数据模型/校验函数/服务端不变）。
- 改动文件：src/components/scheduled-tasks/ScheduledTasksPage.tsx（频次 select 复用 taskExecutionMode 结构，cron label 走 i18n）、src/lib/i18n.ts（en/zh 新增 taskFrequencyCron='Cron'）、tests/frontend/scheduled-tasks-page.test.ts（11 处切换改走 select onChange）、docs/wiki/src/components/README.md、feature_list.json/progress.md/session-handoff.md。
- 验证：定向 vitest 3 文件 49/49（page 18 / form 29 / i18n snapshot 2）；npm run test 全量 355 files / 4111 passed + 1 skipped、npm run lint 0 error（仅既有 coverage 3 warnings）、npm run build 成功（仅既有 KaTeX/chunk warnings），全部 exit 0。
- Blocker：无。改动未提交，未触碰 dist/package-dist/package-offline，无依赖变更。
- 下一步：无待办；如需可做浏览器视觉验收（频次下拉框与既有 select 样式一致性）。

---

## 最新交接：cold-session-operation-restore（done，2026-09-16）

- 当前目标：Session not found 冷会话操作修复已完成；独立只读审查通过且父Agent已接受结论，无阻塞，feature_list本feature标记done，不推进其他feature。
- 改动：4个生产文件（agent-manager、routes/agent、routes/shared-conversation、acp/server）；5个测试文件（persist-session-state、routes/agent、shared-conversation.model-visibility、acp/server.model-visibility、share-store.rollback-atomic）；server/routes两份Wiki及三状态文件。完整清单见feature_list。
- 关键契约：仅内存缺失才restore；model/thinking异步结果需await；主model恢复先于当前隐藏模型binding解析。无记录才404；恢复故障500/SESSION_RESTORE_FAILED安全文案，503原样。single-flight/finally、idle、Goal、原重试裁剪/追加语义不变。SSE既有await链已审查并回归，share-store仅404fallback未改。
- 验证：定向10文件143 tests全过（新增35例）；改动9个源码/测试ESLint零warning；npm run lint通过（既有coverage3 warnings）；npm run build通过（既有KaTeX/chunk warnings）。TEMP/TMP/TMPDIR全部在工作区.tmp-session-restore。父Agent确认143项定向测试与lint/build通过足够本次范围；未跑全量test、真实模型或浏览器验收，不作模型永不重放工具承诺。
- Blocker：无；独立只读审查与父Agent最终验收已通过。下一步：本feature无待完成实现；若需要实际客户端验证，由用户自行重启源码服务后验收，本轮未重启运行实例。
- 未提交：全部本feature修改未提交，无commit/tag/push/依赖修改/手工生成目录编辑，dist仅正常build生成且无跟踪diff；现有未跟踪.playwright-mcp/保持不动。本轮生成的测试专用临时目录已移除，未清理其他用户文件。

---

## 最新交接：desktop-portable-exe（done，2026-09-16）

- 目标已完成：Windows 桌面打包新增免安装 portable exe，随 `desktop:build:win` 与 tag 触发的 Desktop Build CI 自动产出并上传 GitHub Release。
- 改动文件：`desktop/electron-builder.config.cjs`（win target 加 portable + artifactName `QuickForge-Portable-${version}.exe`）、`docs/wiki/root-config.md`、feature_list.json 未动（用户直提需求，非列表 feature）、progress.md、session-handoff.md。
- 验证：本地 `desktop:build:win` 完整构建通过，双产物 `QuickForge Setup 2.1.0.exe` + `QuickForge-Portable-2.1.0.exe`（各约 109 MB）；配置加载与定向 ESLint 通过。
- Blocker：无。portable 与安装版共享 `%APPDATA%` 用户数据（Electron 默认）；不经过 nsis-patch/installer.nsh。
- Notes：无新依赖、无 Git 操作；下一个 tag 发布时 CI 将自动携带 portable exe 进 Release，无需额外步骤。

---

## 最新交接：scheduled-tasks-goal-support（done，2026-09-16）

- 当前目标：定时任务可触发 Goal 且复用既有 `runPrompt`→runner；主聊天与 scheduled 支持，ACP/channel/shared 仍拒绝，不新增执行器。
- 现行契约：`waitForGoalCompletion` 复用 runner 持久化终态屏障与 idle，completed 才 schedule 成功；paused/blocked/预算/awaiting 仍 running 并保留 serial；关联聊天可 resume/cancel，静止后的 cancelled/failed 才失败。Goal 豁免普通 1h/Profile 墙钟超时，但审批/轮次/工具超时不提升或取消；普通任务不变。
- 运行与能力边界：重启沿用 stale-run failed，Goal paused 不自动重放；Profile 获准的 `goal_report` 不受 workspace 白名单滤除，但 workspace 能力不扩展；goal waiter 避免 idle eviction。
- 文件：生产为 `server/agent-goal-runner.mjs`、`server/agent-manager.mjs`、`server/routes/scheduled-tasks.mjs`；测试为 runner/commands/execution/ai-timeout-budgets，后者只补 mock；同步三个 Wiki 与三状态。精确清单见 `feature_list.json`；依赖 `scheduled-tasks-command-support`（done），保留既有并行改动。
- 验证：父最终 8 文件 309 tests 通过（包含真实自动 tick；模拟底层 Agent），7 文件 ESLint 零 warning、tsc -b 通过。复审发现的销毁注册竞态已修并加 5 个 runner 边界测试；旧 Goal 等待结束前拒绝新 Goal 替换，并保存终态消息快照。未跑全量 test/build、真实模型/UI 验收。
- Blocker：无。下一步：重启所运行的源码服务后验证定时 `/goal 刚刚提交了什么代码`；本轮未重启服务。暂停/受阻可打开关联聊天恢复或取消，串行不会提前启动下一次。
- Notes：无当前仓库 Git 提交/推送、依赖或生成产物修改。ai-timeout-budgets 首次由 subagent 运行既有系统临时 Git fixture 后发现边界，补 mock 后未重跑（已 lint）；父后续测试临时目录限定工作区。其它 feature 历史拒绝表述由本条覆盖，不批量改写；原调度器遗留缺陷未扩展修复。

---

## 最新交接：scheduled-tasks-command-support（done，2026-09-15）

- 当前目标已完成：定时/手动执行统一走 `runPrompt`，复用内置 slash command、Skill、项目自定义命令的既有解析、权限与可用性；Goal 仍拒绝，工具审批不变。
- 改动文件：`server/routes/scheduled-tasks.mjs`（唯一生产改动：去掉预 append/persist，改用 runPrompt）、`tests/server/scheduled-tasks.execution.test.mjs`、新增 `tests/server/scheduled-tasks.commands.test.mjs`、`docs/wiki/server/routes/README.md` 与 feature_list.json/progress.md/session-handoff.md。
- 验证：父 Agent 定向 7 文件 196 tests 全过，含 execution 44、commands 10；commands 使用真实 manager/resolver/storage、mock 底层 Agent，覆盖普通一次、plan 权限、custom 参数、skill、help/goal、clear/summary/compact 短路及 prompt reject。父 Agent 对 3 个改动源/测试文件最终定向 ESLint 通过（0 warning）；本次未跑全量 test/build。
- 契约变化：首消息由统一 prompt 流程持久化，不再保证 `onStarted` 前落盘；Wiki 已同步，短文字足够，无需 SVG。
- Blocker：无；实现与定向验证完成。下一步可重启运行中的源码服务，以实际任务指令检查效果；本轮未运行真实模型任务。改动未提交，无 Git 写操作。
- Notes：此前 timer 恢复、active ID、手动请求悬挂问题按用户要求未处理，不继续顺带修复。无 UI、依赖、生成产物修改；并行 UI/Goal 等成果与历史章节保留、不认领。

---

## 最新交接：ui-ux-review-optimization（done，2026-09-16）

- 目标已完成：UI/UX 全面评审（真实实例 + Playwright 实测，问题清单 B01-B12 见 docs/reviews/app-ui-ux-review-2026-09-15.zh-CN.md）与 11 项修复（B01-B11）全部落地并验证；B12 保留现状（有菜单补偿）。
- 改动文件：confirm-dialog.tsx（互斥+focus trap+焦点恢复）、toast.tsx（语义分级）、backup-settings-tab.ts（replace 导入 destructive）、react-settings-tabs.tsx（延迟卸载）、App.tsx（移动 drawer Escape/焦点）、ChatSidebar.tsx（折叠占位）、ScheduledTasksPage.tsx + mcp-server-card.tsx（switch/下拉可访问名称）、default-options-settings-tab.ts（数字输入 label）、i18n.ts（en/zh 新 key）、docs/wiki/src/components/README.md、新增 tests/frontend/confirm-dialog.test.ts 与评审文档/截图。
- 验证：定向 vitest 32/32、tsc -b、11 文件 ESLint、Playwright 复查（弹窗键盘全项、tab 切换 0 error、switch 标签、375px 布局/drawer）全过；全量 test 355 files / 4053 passed + 1 skipped、lint 0 error（既有 coverage 3 warning）、build 成功，均 exit 0。
- Blocker：无。未验证项及原因见评审文档第五节（真实破坏性确认、真实成功 toast、外部包 ChatPanel、全量对比度扫描）。
- Notes：工作区有多路并行未提交改动（scheduled-tasks runPrompt 分发、goal-attachment-missing-marker 等），本 goal 不认领不回退，均含于全量通过内；运行中生产实例（5176）服务 dist，server 端磁盘改动不影响其进程。新会话恢复时先读 docs/reviews/app-ui-ux-review-2026-09-15.zh-CN.md。遗留可选项（不阻塞）：B12 键盘可达性重构、统一 EmptyState/ErrorState 组件、skeleton 推广——均为记录在案的未来方向，非本轮承诺。

---

## 最新交接：goal-attachment-missing-marker（done，2026-09-15）

- 目标已完成：Goal 附件文件缺失/过期时不再静默——`server/agent-goal-runner.mjs` 的 goalAttachmentPrompt 注入前 `existsSync` 检查，缺失时提示词标注 `(attachment file no longer available: <原路径>)`；path 为空、文件存在两分支行为不变。
- 改动文件：`server/agent-goal-runner.mjs`、`tests/server/agent-goal-runner.test.mjs`（+2 新用例、既有附件用例改 os.tmpdir() 真实临时文件）、feature_list.json/progress.md/session-handoff.md。
- 验证：定向 vitest 141/141、两文件 node --check、eslint 0 error 全部 exit 0；os.tmpdir() 零残留；package.json/package-lock.json 无 diff；无 Git 操作（HEAD `bd55a0d` 未变）。
- Blocker：无。遗留（需产品决策，详见 progress.md 本 feature Notes）：① 附件在 workspace 外时 read_file 403（沙箱豁免 vs 内容内联）；② 失效状态持久化进 goal.attachments（动 schema）；③ message-converters 普通消息附件静默空串。另：subagent 评审"高-2"测试缺口系静态误判，勘误已记入 progress.md Notes。
- Notes：本 feature 开始前工作区已存在其他并行会话未提交改动（UI review、scheduled-tasks 等），均未触碰；docs/wiki 无附件既有记载，未新增 wiki 内容。下方旧记录仅供历史追溯。

---

## 最新交接：state-records-closeout（done，2026-09-15）

- 目标已完成：多会话成果汇总提交 `ace9930` 已推送 origin/dev（本地与远端同步，历史线性）。推送前全量验证通过：npm run test 353 files / 4037 passed + 1 skipped、npm run lint 0 error（仅既有 coverage 3 warning）、npm run build 成功（仅既有 KaTeX/chunk warning）。
- 推送冲突处理：远端 dev 已含 v2.1.0 发布 4 提交（6ad3489/6252e2d/baaa041/e5775be），rebase 后三状态文件冲突；解决方式：主文件以本仓归档后的版本为主体，远端 release-v2.1.0 收尾记录插回主文件（见下方历史交接），其余远端历史条目本已在 docs/archive。冲突解决后定向复跑远端改动的两个测试文件 46/46 通过。
- 发布闭环：npm 2.1.0 已确认发布成功——2026-09-15 实查 registry `npm view @shawnstack/quickforge version/dist-tags` = 2.1.0 / latest=2.1.0（用户已完成双重验证发布）。下方 release-v2.1.0 历史交接中的「npm 等待双重验证」为当时状态，已被本节取代。
- 改动文件（本轮记录收尾）：feature_list.json、progress.md、session-handoff.md（新增 batch-commit-push-2026-09-15 done 条目与本收尾记录，release-v2.1.0 条目 npm 结论更新为已发布）。
- Blocker：无。遗留待办（非阻塞）：① 远端 master 落后 dev 1 个提交（ace9930），需要时可 `git fetch . dev:master` 快进后推送；② `.playwright-mcp/`、`server.name`、`test-screenshot.png` 三个本地运行产物保持未跟踪，未改 .gitignore；③ 磁盘上存在带尾随空格的 `.playwright-browsers ` 幻影目录导致 git status 恒报 warning，无害，可用 WSL 等工具删除。
- Notes：此前各历史记录中的「未提交/无 Git 操作/改动未提交」表述均已被 ace9930 汇总提交覆盖，不再逐段改写。feature_list.json 主列表 17 条全部 done，无 in_progress/needs-review。下方旧记录仅供历史追溯。

---

## 历史交接：release-v2.1.0（Git/CI/npm 发布全部完成）

- 最终提交：`baaa041cc2a37e49038da46cec4c7d2ca6272f59`；本轮实时 `git ls-remote` 确认远端 dev/master/v2.1.0 均为该提交，本地 dev/HEAD/tag 一致；本地 master 仍为 `9ded6c0`，未移动。
- 发布提交 `6ad3489`；CI 修复 `6252e2d` 固定测试中文，`baaa041` 将 runtime-diagnostics 等待 5ms 改为 20ms，保留 elapsedMs >= 5 断言。
- 当前 HEAD 重新验证：npm run test 323 文件 / 3649 测试全部通过；lint/build 均退出 0。既有 warning：identity.mjs:92、KaTeX 字体和大 chunk。
- GitHub 网页核验完整 SHA 匹配且 Success：[CI](https://github.com/shawnstack/quickforge/actions/runs/34797256759)、[Desktop Build](https://github.com/shawnstack/quickforge/actions/runs/34797259067)。公开 API 限流，以上依据 run 网页。
- 离线包：`package-offline/shawnstack-quickforge-2.1.0.tgz`，7,486,125 bytes、471 文件，SHA-1 `7c952caa07a39971fdd4dbf74acd899238495d0c`；其中 402 个 dist/server/bin 文件与当前构建逐字节一致，未重打包。
- npm：whoami 已成功（shawnstack），用户已明确授权；当时 publish 退出 1 报 EOTP。（已闭环：用户完成双重验证后发布成功，2026-09-15 实查 registry version=2.1.0、latest=2.1.0。）
- 下一步（已闭环）：npm publish 已完成，registry 实查结果见顶部收尾交接，无需再执行。验证码不应发送到聊天。
- 本轮仅补三份状态记录（当时未提交，后随汇总提交 rebase 并入 dev）、未再次移动 tag；未知零字节文件 `x[1])` 已由后续会话清理。无架构或公共入口变化，无需更新 Wiki。

---

## 历史交接：release-v2.1.0-retag（以下为 6252e2d 阶段记录，已被上方最终状态取代）

- 目标：用户指令「发布 2.1.0 版本」，确认 v2.1.0 上轮已发布 Git 但远端 tag 实际未推成功（远端最新 tag 仅 v2.0.0），用户选择「移动 tag 到最新提交」将 a21d3bc（？ 浮层修复）纳入 2.1.0 重新发布；随后用户报「单元测试没过」，核实为 GitHub Actions CI（Linux）失败，修复后再次移动 tag。
- CI 失败根因：`tests/frontend/git-tools-pinned-summary.test.ts` 两个用例断言中文文案（`执行中`/`已结束 · 5`），而 `src/lib/i18n.ts:3852` 默认语言跟随 `navigator.language`——本地 Windows zh-CN 渲染中文通过，CI Linux en-US 渲染英文失败（node ≥21 全局 navigator 按系统 locale）。属测试对宿主语言的隐式依赖，非产品缺陷；该失败自 22fe294（上轮发布提交）即存在。
- 改动（1+2 文件）：`CHANGELOG.md`（[2.1.0] Fixed 补 ？ 浮层修复一行，commit 6ad3489）；`tests/frontend/git-tools-pinned-summary.test.ts`（import `applyAppLanguageFromSnapshot` + describe 级 beforeAll 固定 'zh'，commit 6252e2d）；本交接条目。
- 验证：两轮 `npm run test` 323 files / 3649 tests 全过；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npm run build` 成功；定向 31/31。`package-offline/shawnstack-quickforge-2.1.0.tgz` 于 6ad3489 生成（7.5 MB / 471 files / shasum 7c952caa…），测试文件不进 npm 包（files 不含 tests/），tarball 无需重打。
- Git：`6ad3489`（chore(release)）+ `6252e2d`（test 修复）；tag v2.1.0 两移（22fe294→6ad3489→6252e2d），第二次远端 +v2.1.0 强推；dev/master/tag 均指向 6252e2d。
- Blocker：待确认本次 push 后 CI 转绿（推送时间 01:44 UTC，CI 约 3-5 分钟；上两次 CI 结论：6ad3489/22fe294 failure、9ded6c0 success）。npm 未登录（E401），publish 留给用户。
- Notes：Desktop Build 由 v2.1.0 tag 触发，6ad3489 那次已 success 并创建 GitHub Release（"Create GitHub Release" success），tag 强推会再次触发；旧 Release 对象仍存在，必要时人工核对 GitHub Release 页面内容与资产。CI annotations API（check-runs）可匿名定位失败测试，无需 admin。
- 下一步：确认 CI 绿后，用户手动 `npm login` + `npm publish`（命令见本轮会话总结）；继续下一个 feature。（goal-inspector-hint-popover-width 的交接正文已随全量归档移入 docs/archive/session-handoff-archive.md。）

---

## 历史交接：retry-error-only-continue（done，2026-09-15）

- 目标已完成：修复「普通对话重试按钮发送『继续』」。行为契约：回合以错误结束（回合内 assistant stopReason='error' 且 errorMessage 非空）→ 重试保留全量历史并追加「继续」；正常回合 → 重试裁剪历史重发原消息。
- 改动文件：`src/lib/message-utils.ts`（删 hasToolResultsAfter、新增 turnEndedWithError）、`src/hooks/useChatActions.ts`（retryFromMessage 换判定+注释）、`src/components/chat/panel-decoration/turn-error-state.ts`（仅头注释）、`tests/frontend/message-utils.test.ts`（6 新用例）、`tests/frontend/turn-error-state.test.ts`（仅注释）及三状态文件。
- 验证：父 Agent 亲读全部 diff；定向 vitest 4 文件 195/195、5 文件 ESLint、`tsc -b` exit 0。
- Blocker：无。
- Notes：成功回合含写工具的重试会裁剪重试（副作用可能重放），用户明确接受；服务端 /continue 未改；未跑全量 test/build，无 Git 操作。重启源码版后可在普通对话验证：成功回合点重试应重发原消息，报错回合点重试发送「继续」。下方旧记录仅供历史追溯。

---

## 历史交接：builtin-playwright-mcp（done，UI/API 内置删除保护）

- 当前目标已完成：Playwright 继续使用默认关闭的 `npx -y @playwright/mcp@latest` 预置，已有同名配置和启用状态保留；增加内置标记及不可删除保护，不改变命令、依赖或 Desktop。
- 读取按规范化名称派生 `builtin: true`，不信任输入且不落盘；删除在 normalize 后、`atomicUpdate` 前拒绝并返回 409。普通 MCP 删除不变，批量 replace 遗漏 playwright 后读取恢复关闭预置。
- 设置卡片显示中性“内置”标签并隐藏删除，仍可编辑、启停、重连。
- 改动文件：`server/mcp/config.mjs`、`src/components/mcp/mcp-server-card.tsx`、`src/lib/types/mcp.ts`、`src/lib/i18n.ts`、`tests/server/mcp-config.test.mjs`、`tests/server/routes/mcp.test.mjs`、`tests/frontend/mcp-server-card.test.ts`；同步 README、server Wiki、feature_list/progress/session-handoff 五份文档。
- 验证：父 Agent 的 MCP config/registry/routes/card 四文件定向测试、定向 lint、build 整链 exit 0；当前定向测试全部通过，不推测用例总数，不声称本次全仓 test/lint 或浏览器端到端验收。
- Notes：本次 General 意外清空未跟踪的 `tests/server/mcp-config.test.mjs`，父 Agent 依据本会话已读取内容重建覆盖并补行为测试，未声称逐字恢复。后续文档子任务严格只编辑五份文档，未触碰源/测试。无 Git 操作或全局配置变更。
- blocker：无。下一步可重启运行中的源码版检查设置卡片；仍需后端机器 Node/npm、首次网络和可用浏览器，不继续旧 Desktop/离线方案。改动未提交，以下旧记录仅供历史追溯，以本节为当前契约。

---

## 历史交接：goal-persisted-attachment-paths（done）\n\n- 已完成 Goal 附件路径修复：`/goal` 创建时从原始消息复制附件元数据到 Goal，规划/续跑提示词携带文件名与完整路径，旧 Goal 快照兼容空附件。\n- 改动文件：`server/agent-prompt-commands.mjs`、`server/agent-goal-runner.mjs`、`server/agent-goal-state.mjs`、`src/lib/goal.ts`、`tests/server/agent-goal-runner.test.mjs`，并同步三状态文件。\n- 验证：定向 4 files / 206 tests 通过；相关 ESLint 与 `tsc -b --pretty false` 通过。\n- 限制：仅解决 Goal 上下文中的附件路径持久化/提示词注入；未处理附件缓存清理、路径权限及普通消息附件读取失败的静默问题。\n\n---\n\n## 历史交接：Playwright MCP npx 预置简化完成（删除行为已由顶部保护方案替代）

- 用户明确确认只预置 `npx -y @playwright/mcp@latest`，撤回先前复杂runtime/Chromium/Desktop方案。当前feature done按新范围，旧离线Goal不声称完成。
- 最终源码变化集中于server/mcp/config.mjs：默认关闭、已有同名完整优先、首次启停原子持久化、满50项拒绝挤掉其他服务；设置沿用普通可编辑/删除/重连服务。删除自定义配置后恢复关闭预置。
- 已撤回本任务package/lock的Playwright依赖、UI限制、registry分支、Desktop打包与浏览器脚本；无关改动保留。新增/调整配置测试、README、server Wiki和三状态。
- 验证：MCP 3 files/62 tests、定向lint、父Agent全仓lint/build通过。未再次启动浏览器、改全局MCP配置、提交Git或清理旧下载/生成目录。
- 下一步：用户重启所运行的源码版后检查设置即可；已有全局Playwright保持原配置。当前简化范围无blocker，勿继续旧Desktop/离线任务。

## 历史交接：Playwright MCP 配置完成（2026-09-15）

- 当前目标已完成：用户授权的当前 QuickForge 实例全局 Playwright MCP，可见窗口。运行时服务 playwright：stdio，command `npx`，args `-y @playwright/mcp@latest`，enabled=true。
- 实例已连接并发现 26 tools，无错误；同参数独立 SDK 客户端打开 about:blank 后关闭成功。浏览器操作验证不是当前聊天工具调用验收；工具若未显示，可在设置 → MCP 服务检查或刷新聊天页面。
- 改动：实例全局 MCP store（通过本地 API，非手工覆盖配置）；仓库仅 feature_list.json、progress.md、session-handoff.md 三状态记录。无业务源码/依赖/生成产物修改，无提交；既有未提交成果保留。
- blocker：无。该历史配置目标已结束；当前新目标 builtin-playwright-mcp 仍在执行。下方旧交接完整保留。

## 历史交接：builtin-playwright-mcp（旧 Desktop/离线方案，已撤回）

- 已固定 `@playwright/mcp@0.0.81` production dependency；内置服务入口为当前 Node + 包内 `cli.js`，`--isolated`，默认 disabled，不依赖 npx/@latest。读取 Playwright Chromium executablePath，存在则传入路径，缺失时返回明确安装提示。
- 设置卡片展示“内置”，隐藏编辑/删除，保留启停/重连；类型增加 builtin。MCP 定向 44 tests、定向 lint、build/lint、npm pack dry-run 通过；真实内置 smoke 已完成 tools/list/about:blank/close。
- 本轮新增：Desktop electron-builder 增加可选 `extraResources`，由 `QUICKFORGE_PLAYWRIGHT_BROWSERS_PATH` 指定浏览器资源；新增 packaging contract 2 tests；server Wiki 已说明内置 Playwright。全量 test 352 files/4015 passed+1 skipped，build/lint 通过（既有 coverage 3 warnings）。
- 本轮新增：Electron packaged runtime 改为设置 `QUICKFORGE_PLAYWRIGHT_BROWSERS_PATH=process.resourcesPath/playwright-browsers`，由内置 helper 递归寻找平台 Chromium 可执行文件；新增资源根目录测试。定向测试 28/28、相关 lint、build 通过。
- 未完成：跨平台资源实际打包、真实 Desktop 安装包运行、最终状态同步。最终链路 `npm run test && npm run lint && npm run build && npm pack --dry-run` 通过（354 files/4021 passed+1 skipped，lint 仅既有 coverage 3 warnings）；浏览器资源下载和 Desktop 构建仍超时，当前不能宣称离线内置。

## 最新交接：四项拆分实现与最终核验

- 四feature均done；manager1946、workspace facade594、App2362、Inspector1872行。原公开入口/props/持久化保留，三个前端phase hooks模块族真实接入；测试及模块清单见feature_list.json。
- 最后完整test/lint/build已通过（07:50UTC）。cloud重启计时失败未改代码，隔离及默认完整复跑过；字体/chunk warning保留。App14及Inspector16原快照/真实hook对照通过；无DOM同步harness不代表StrictMode/真实浏览器验收。无剩余实现任务，不继续顺带重构。
- 范围核验：42个Goal路径、9个并行scheduled路径、3个历史cleanup删除、7个初始hash未收录背景文件全部分类。package/lock与基线一致，HEAD未变，无tracked生成物diff；没有commit/tag/push/发布。并行/前序文件不回退、不认领；完整历史保留在下方。
- 诊断目录 `.goal-runtime-refactor-baseline/` 保留baseline.json、四原源码、final-scope-audit.json、final-doc-preservation.json。保留原因是原快照重放及scope审计依赖，默认CI无需该目录。不要把它当新测试残留自动删掉。0字节命令垃圾已清理。
- 后续仅可按新需求单独评估时序flaky、构建warning或浏览器验证；这些不是当前Goal扩展范围。最终文档更新只改五Wiki的既有相关模块导航及四feature状态，不改无关历史。具体失败和修复证据以下方阶段记录为准。

<!-- final-audit-history -->
## 当前交接：四项实现及最终运行验证已完成，待范围/Wiki状态终验

- c1–c5已passed；c6/c7待严格最终核验。Inspector feature已done；新useInspectorGit229行，入口1872行，三域均真实调用，guard/reset/updater与diff reader跨tab留入口。
- Git先原AST5行为+39关联44过再搬迁；最终同16三域行为原快照/真实hooks各过；21effect原序同回调，4 JSX+props逐字相同、27action体归一一致。完整test/lint/build于07:50UTC链式成功；首次cloud/qf-agent-process重启计时失败，隔离及默认完整复跑通过未改无关代码。构建仅既有font/chunk warning。
- 新文件useInspectorGit.ts、inspector-git-hooks.test.ts；改Inspector/inspector-domain-fixture props/workspace-diff-no-changes源码定位，wiki/components与三状态。一次cmd解析失败；unused脚本跨函数误删同名state，tsc发现后修复。局部dep例外保留原applyGitStatus缓存闭包身份及卸载时最新controller读取。
- 下一步只终验，不继续重构：执行基线.goal-runtime-refactor-baseline/baseline.json存791文件hash、head a21d3bc；比较已列29个改变文件，其中scheduled两后端/UI/form/i18n/两server测试是并行feature，三个goal-plan-confirmation源/两test删除是并行cleanup历史，不认领；其余是四拆分及直接测试/wiki/状态。new未列入baseline还包含旧报告/reviews/mockup/archive（初始baseline覆盖有限），不能把它们当本Goal新增或删掉。package/lock与执行基线一致，head未变。0字节单引号垃圾（05:39时间）已确认后清理。
- 需输出可验证scope白名单/排除并行分类，验证相关docs模块导航/四done/历史保留/JSON/diff。目前c6/c7不能冒充通过。原4快照+baseline保留；测试QF_INSPECTOR_BASELINE_TEST=1可手动重放原快照，默认CI不依赖忽略目录。无依赖变更/commit/tag/push/手工产物修改，build正常刷新dist。

---

## 历史交接：Inspector布局和tab完成，下一步Git按需review

- feature仍in_progress，c4–c7未完成；入口现2048行，useInspectorTabs181行。state/effects/actions已接入，tab request/scope guard、updatePanelTab留入口；不可更改缓存callback的原project-only依赖身份。
- 新tab5原AST保护搬前通过后迁移真实hook，相关36过；全前端171文件2093、tsc、零warning定向lint过。21effect回调原序相同，4JSX逐字相同，18布局/tab action体归一一致；原快照11布局/tab例重放通过。最后全仓test/lint/build尚待所有域完成。
- 文件：Inspector、新useInspectorTabs、inspector-tabs-hooks.test.ts、inspector-domain-fixture props扩展、workspace-inspector-tabs/side-chat-workspace-tab源码断言定位；wiki/components与三状态。refs初始化局部lint例外保持基线模式，cache callback局部deps例外保持身份，勿自动修复加入每render updater依赖。
- 下一步Git域原快照范围：694–705/728/764/770 state；825–921派生/actions、949–956清diff effect、1174–1194load、1277–1280按需effect、1607–1691diff reader+inline；共享projectGuard和1304–1323跨域reset留入口，维持scope失效/abort原顺序。按需先补真正load/force/旧响应/404空态行为再抽hook，functions hoist依赖需注意。当前源码行号已变，用原statement AST匹配，避免子组件同名误替换。
- 首次唯一字符串assert发现子组件menu重复，未写文件，改Main AST后成功；4源码测试失配已修定位不弱化。自动deps建议加入不稳定updater已撤回，最终检查通过。无外部blocker/提交/依赖/手工产物修改，原snapshot与基线仍保留供最终范围审计。

---

## 历史交接：Inspector布局域完成，tab/Git review待继续

- 当前feature refactor-workspace-inspector-split=in_progress；c1–c3保持passed，c4–c7未完成。不要进入其他feature或宣称Inspector done。
- 新useInspectorLayout.ts含state/viewport/visibility/width/actions phase hooks，调用留原effect位置；Inspector2544→2194行，21effect回调原序/原内容（归一），4段最外层JSX和props逐字一致。layout仅原代码搬迁及稳定setter/ref依赖补齐，不改变持久化/时长。
- 文件：Inspector+新layout hook；tests/frontend/inspector-layout-hooks.test.ts、helpers/inspector-domain-fixture.ts；workspace-inspector-width-range与mobile-fullscreen测试定位真实模块；wiki/components和三状态。
- 证据：搬前13文件97基线、原AST6布局行为先过后移动；搬后14文件103过，原快照重放6过；零warning定向eslint、tsc -b，全前端170文件2088过。未跑全仓最终test/lint/build。生成多余解构与遗漏NAV常量出口已修；cmd引号失败未写文件。Explore空返回不算调研成果，父直接阅读完成。
- 下一步：优先Explore（若仍空返回则父读源码）定位tab与Git。原快照行号供定位：tab715–728/730/751–756、1342–1359 effects、1432–1541 create/open/reorder/close、1587–1604 document/ref；request1013–1048含scope guard可保留入口。Git694–705/728/764/770 state、825–921派生/actions、949–956清diff、1174–1194load、1277–1280按需effect、1607–1691diff。当前源码行号已变化，必须按函数名或AST比对而非直接旧行号切当前文件。共享projectGuard owner/1304–1323跨域reset留入口，不新增scope reset行为。
- 先补原行为测试再抽离各域；可复用HookLifecycle（无DOM，不等同ReactStrictMode）和originalInspectorDomain AST工具，后者当前仅布局props解构，扩展时勿手写镜像业务逻辑。布局测试通过QF_INSPECTOR_BASELINE_TEST=1读取原快照，默认CI仅真实hook。
- 基线目录保留baseline.json及4份原源码；无外部blocker、提交/依赖变更/手工生成物修改。最终c5–c7需要最后全量、范围审计和四feature状态/Wiki核验。并行scheduled/前序文件和历史均保留。

---

## 历史交接：四巨石 Goal — App三域完成，下一项Inspector

- c1/c2/c3已通过，c4–c7待后续。App2618→2362行；useAppTerminal74、useAppGit148、useAppLoadingTransitions136行，phase调用保留原effect顺序，共享project ref/App owner不变；10段JSX逐字相同、URL基础hooks不改。
- 文件：App与三个hooks；tests/frontend/app-domain-hooks.test.ts、hook-lifecycle-harness.test.ts、helpers/hook-lifecycle.ts、helpers/app-domain-fixture.ts；git-status-request-lifecycle与workspace-inspector-tabs只改真实实现/稳定ref依赖断言；wiki/src与hooks及三状态。
- 验证：搬前11文件93基线，14 AST行为保护先过再搬；父最后重放原App快照与真实hooks同14例均通过，另2 harness清理顺序/稳定身份验证；07:05UTC完整test/lint/build exit0（截断未确认总数），定向eslint及JSX/diff检查通过。既有字体/chunk warning保留。
- 无外部blocker。早期fixture/CRLF/源码位置测试失败已修，独立review无生产阻断；harness改为先全部cleanup再setup且补自测。测试是无DOM同步harness，不代表React StrictMode/浏览器验收。并行scheduled早期lint blocker记录保留，但本阶段最终全仓lint已通过。
- 下一步：只推进refactor-workspace-inspector-split（仍planned），先Explore定位tab持久化/scope、双resize/fullscreen、Git按需review，先搬前行为保护再抽离；最终全部完成后重跑全量、核验相对baseline范围、同步c5–c7。不要把当前全量当最终Goal验收。
- 保留.goal-runtime-refactor-baseline/baseline.json和3份搬前源码；App测试QF_APP_BASELINE_TEST=1可显式重放App-before-split.tsx，默认CI无需忽略目录。无提交/新依赖/手工产物修改；全部未提交且保留并行scheduled及前序成果。

---

## 历史交接：四巨石 Goal — 后端两项完成，下一项 App

- 本轮workspace实现完成：HTTP facade594行，Git681/浏览搜索527/文件预览193/请求控制42行。旧17出口/120原函数体和常量完全保留，无新反向环；四服务由入口实际调用。
- 文件：server/routes/workspace.mjs及workspace-{git-service,browser-service,file-service,request-control}.mjs；新增tests/server/routes/workspace-exports-contract.test.mjs；tests/server/session-index-lifecycle.test.mjs改读真实queries实现；wiki/routes与三状态。
- 验证：先9文件76基线+7新增保护通过，搬迁后10文件83，AST逐字唯一性/语法/零warning lint通过；最终全量347文件3946 passed+1 skipped，lint/build过。失败self re-export已删除；源码位置断言已适配；runtime-diagnostics4<5ms既有flake隔离后默认全过。无未处理本项失败。
- 已完成c1/c2；下一按序App终端/Git/启动会话过渡，需先Explore精确hook生命周期和现有harness，然后测试保护/抽离；再Inspector三域。c3-c7待后续实际证据。不要把本阶段全量当最终全Goal验收。
- 基线目录.goal-runtime-refactor-baseline内保存baseline.json和两个后端搬迁前源码，不要清除直到最终范围验收。并行scheduled-tasks已done，保留其文件/历史，非本Goal改动。无提交/依赖新增/手工生成物修改。

---

## 历史交接：scheduled-tasks-manual-frequency（done，2026-09-15）

### 复审完成 / 最新交接（06:03 UTC）
- 同一改动文件范围，补parse/save同步互斥、action按taskId去重、解析失效保护、独立日期草稿、Date溢出保护、严格新Cron/历史运行兼容以及真实scheduler tick测试。
- 最新验证：前端47、后端93 tests；扩大10文件177通过。父全量347文件3982 passed+1 skipped；本功能9源/测试eslint零warning；独立build通过（既有font/chunk warning）。
- Blocker/Notes：全仓lint被无关并行 `tests/frontend/helpers/hook-lifecycle.ts:33` no-this-alias阻断，coverage另3warning；不修改他人功能。不能宣称最终全仓lint全绿。
- 下一步：浏览器视觉/交互验收尚未做；实现保留现有页内编辑而非HTML抽屉，准确nextRunAt只保存后返回。无Git提交/依赖新增/手工生成物改动，build正常产生dist。以下为较早阶段记录，验证状态以上述为准。

- 目标：实现用户已确认的手动六频次、结构化 interval、weekDays 兼容 weekDay，完成测试/wiki/状态。
- 改动文件：src/components/scheduled-tasks/ScheduledTasksPage.tsx；src/lib/scheduled-task-form.ts（新增）、i18n.ts；server/routes/scheduled-tasks.mjs、server/utils/scheduled-tasks.mjs；tests/frontend/scheduled-task-form.test.ts、scheduled-tasks-page.test.ts（新增）；tests/server/scheduled-tasks.test.mjs、scheduled-tasks.execution.test.mjs；docs/wiki/src/components/README.md、docs/wiki/server/routes/README.md；三状态文件。
- 完成：手动六频次动态控件、即时规则摘要、校验/忙态/错误草稿；AI 可选回填 Cron；保存原类型并清理非当前字段；interval 锚点不漂移、旧中文 rule 回填、weekDays 多选兼容 weekDay、Cron 列表与步长范围校验。
- 验证：2026-09-15 05:21 UTC 定向 4 files / 104 tests 通过，05:23 UTC 扩大 scheduled 域回归 9 files / 137 tests 通过；相关 ESLint 无 warning、tsc -b、相关 git diff --check 与状态 JSON 检查通过。6 页面测试是 hook-state harness 真实 handler，不是浏览器 E2E；没有跑全量 test/build。
- Blocker：无。边界：准确 nextRunAt 由服务端保存后返回，不伪造客户端时区预估；间隔天=24h、错过槽位跳过；Cron 保留 AND 日/周与 366 天窗口。不添加依赖，不碰 dist/package-dist/package-offline，不提交 Git。
- 下一步：父 Agent 复审改动及按需补浏览器视觉验收。当前全部未提交，叠加既有大量前序/并行工作树修改；本轮没有处理其他 feature。历史交接保留如下。

---

## 当前交接：四巨石 Goal — agent-manager 三域完成

- 目标顺序：agent-manager → routes/workspace → App → WorkspaceInspector；本次仅完成第一项，后续自动执行按顺序推进。
- 本项改动：server/agent-manager.mjs、新agent-access-mode.mjs、agent-session-queries.mjs、agent-approval-responses.mjs、tests/server/agent-manager-domains.test.mjs、docs/wiki/server/README.md及三状态。
- 验证：搬迁前后19文件297用例通过，含11个新增行为保护与出口契约；原函数体归一比对、语法、零warning定向lint、diff check通过。c1证据已登记Goal。最终全Goal全量验证尚待完成。
- 修复记录：代理半成品出口多4个导致契约失败已修，未放宽测试；错误未接线abort实现已丢弃，实际abortToolCall留原处。不要把空subagent返回算完成。
- 边界：三个域实际接入，无新store或新反向循环；标题/工具装配/生命周期留manager，不承诺800行。前序Goal和并行scheduled-tasks改动保留，非本Goal成果。
- 基线：.goal-runtime-refactor-baseline/baseline.json（791文件hash）与manager-before-domain-move.mjs供后续范围及搬迁核验，请不要在Goal完成前当残留清除；最终清理前先登记证据。
- 下一步：Explore聚焦workspace路由，先跑9类既有workspace测试并补缺口，再按Git/浏览搜索/预览搬迁；完成前不得推进App。无外部blocker，无提交。

---

## 历史交接：refactor-server-agent-split（in_progress，2026-09-15 阶段文档/状态收尾）

- 当前目标：完成 `server-agent.ts` 拆分与事件类型收敛；本轮只同步 wiki、报告勘误与状态，不修改源码/测试。原 zombie cleanup 与全部旧交接条目保留在下方，其 done 不代表当前拆分已完成。
- 本轮改动文件：`docs/wiki/src/lib/README.md`、`docs/reports/project-health-check-2026-09-15.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。wiki 最小补三新模块职责、单向依赖及兼容入口，无需 SVG，不全库清行数；feature_list 从旧 progress/handoff 证据恢复缺失的 `zombie-code-safe-cleanup` done 条目，保留其他 feature。
- 已完成实现事实：`server-agent.ts` 2782→2236 行；types 模块 245 行（18 公共 + 1 内部类型）、HTTP helper 16 行、SSE 模块 340 行；旧入口保留 type/value re-export。会话 watchdog 与状态/消息对账仍在主类。已删 11 处冗余 AgentEvent 断言，仍剩 20 处原始 SSE / 自定义 / 轻通知边界；伪源码注释已删，测试改为定位真实模块。
- 保护测试：新增前端 HTTP/SSE 2 文件 13 用例，最新前端定向 10 文件 293 tests 通过，不是仅评估已有 140 用例。后端新增 8 测试文件原 104 用例，supervisor 从 6→10 后现 108；另新增 2 个 helpers 夹具。244 是含前端的混合数量。supervisor fail-closed preload 拦截 spawn，绝不运行真实 npm/server；失败 finally 等待唯一真实 Node 子进程 close 再删 fixture。
- 最新验证：父 Agent **2026-09-15 03:59 UTC** 执行 `npm run test && npm run lint && npm run build` exit 0；截断日志未获取全量用例数，不推测。既有 KaTeX/font/chunk 构建 warning 仍在。本文档轮 JSON parse、10 个 feature 唯一性/状态断言、旧交接保留检查、文档 diff check 与未跟踪报告空白/冲突标记检查均通过，不重复运行生产验证。
- Blocker / 未完成：无外部阻塞；事件边界尚未完整收敛，所以保持 **in_progress**，不能自动称拆分已全部完成。源码/测试与并行改动均未提交。
- Notes / 勘误：`conversation-compaction.test.mjs`、`auto-compaction.test.mjs`、`network-proxy.test.mjs` 本来已 Git 跟踪并直接覆盖对应模块；`vite.config.ts` 无 test 段。报告顶部已标明勘误，其余未经验证结论仅是静态建议，不是已证实问题。并行 cleanup 的历史 flake、Android 未验证及产品待决策项继续保留，未扩展处理。
- 下一步：先继续当前 **refactor-server-agent-split 的事件边界**，完成相应验证后按顺序 **agent-manager → workspace → App → Inspector**；四个后续巨石 feature 仍 planned，本轮未推进。无 Git commit/tag/push。

---

## 当前交接：refactor-server-agent-split（done，2026-09-15 事件边界收尾）

- 本轮仅同步 wiki/三状态；实际成果为类型/HTTP/SSE 拆分与事件边界明确化。源码当前行数：`server-agent.ts` 2271、`server-agent-types.ts` 266、HTTP 16、SSE 340。
- API 边界：`ServerAgentLocalEvent` 为本地标准及轻通知联合；`ServerAgentWireEvent` 仅 `readonly type?: unknown`，无万能索引；`subscribeEvents` 为诚实入口。旧 `subscribe` 保持原签名，仅 legacy wrapper 一个 `event as AgentEvent`，未声称已校验。12 处 wire 原样转发与 typed emit 分离；Map 的原 Set identity/插入顺序/live iteration/异常隔离/dispose 保留。20 处散布断言收敛为 1 处有意兼容边界，不代表所有其他 cast 消除。
- 测试/验证：新增 3 个 events 相关测试/夹具文件（14 用例、1 compiler 用例、负例夹具）；子 agent 27 文件/694 定向通过，独立 review 155 通过。父最终测试 04:38 UTC：343 files、3854 passed + 1 skipped；lint/build 04:37 UTC 通过，保留既有 font/chunk warning。
- 失败历史必须保留：首全量 Worker fork unexpected exit 原因未确定；maxWorkers=2 复跑仅 runtime-diagnostics elapsedMs 4<5 既有同类 flake，隔离两文件通过，默认最终全绿，无源码/测试修复掩盖问题。
- 边界/下一步：done 仅限本次类型/HTTP/SSE 拆分和事件边界明确化，不宣称主类全职责细分、运行时 schema 校验或全库 strict；其他四巨石仍 planned，下一步 `agent-manager`。本轮不改报告/生产/测试/依赖/生成产物，不提交。

---

## 当前交接：zombie-code-safe-cleanup（done，三 Phase 清理与全量验证完成；2 个既有 flake 已隔离复跑确认）

- 目标：接续本轮僵尸代码只读评审，用户授权「处理可安全处理、不影响功能」的代码；三 Phase 完成，纯删除/修复，无功能行为变化预期。
- 改动（22 个源码/测试/资产 + 2 wiki + 三状态文件）：Phase 1——server/agent-goal-runner.mjs（删 isGoalRunActive）、server/agent-goal-state.mjs（删 isGoalInFlightStatus/isValidGoalId/GOAL_ID_PATTERN）、src/lib/goal.ts（删 goalCanAccept，goalAcceptanceCheck 保留）、tests/frontend/goal-state.test.ts（同步）、scripts/session-index-query-benchmark.mjs（悬空 import 修复，现行 API 重写，smoke run equivalent:true）、Android 删 Capacitor 模板遗留 ×2 + icon-preview.png、goal-test-demo.md→docs/archive/；Phase 2——goal-card.ts 821→212（仅留 viewmodel buildGoalCardViewModel）、panel-decoration.ts barrel 收缩、删 goal-plan-confirmation.ts + 两测试文件（goal-card-controller 19 用例/goal-plan-confirmation）、ChatPanelHost.tsx 三处死接线、local-tools.ts 空 mount、index.css 死区 -386 行、i18n goal 域 14 对死 key、goal-card.test.ts/goal-report-renderer.test.ts 同步；Phase 3——i18n 非 goal 域 175 对死 key（1810→1635，-350 行）+ assistant-artifact-card.test.ts 2 处死断言同步；wiki components/lib README 两处。
- 验证：全量链式 npm run test && lint && build 退出码 0（build 仅既有 KaTeX/chunk warning）；复跑全量 2 个时序 flake（persist-session-state beforeEach 10s hook 超时、runtime-diagnostics elapsedMs 4<5ms）隔离复跑 28/28 全过、与改动面无交集；分 Phase 定向 192/374/1034 tests 全过；tsc -b 0 error；eslint 0 error；残留 grep（createGoalCardController/goal-plan-confirmation/currentGoalPlan/GoalPlanCandidate/data-quickforge-goal-plan-action/死 CSS 类族/死 key）零命中；i18n en/zh 集合相等（1796/1635 两阶段）。
- Blocker：无。
- Notes：有意不做（待产品决策）：confirm 恒假链（前端 goalCanConfirm 恒 false + Inspector confirmable 分支，server API 保留）、6 个零调用路由（workspace/tree、system/status、system/update/desktop、mention-search、mcp/config、lan-access/logout——wiki 记载兼容旧客户端）、isSessionTextAttachmentPath 安全预留、SignalReconnectBackoff.kt、82 个 export 冗余。server/cloud/index.mjs 因并行会话新增契约测试引用保留未删；根目录 0 字节垃圾文件已被并行会话先行清除；Android 未跑 gradle（仅 grep 零引用验证）。工作树有大量并行/前序未提交改动（goal-mode-i18n 等），本轮全部叠加其上且 goal-card.ts 等未提交断言/实现完整保留。未新增依赖，无 Git 提交。
- 下一步：可选——待决策项落定后另开 feature（confirm 链/死路由收敛）；测试补强建议 agent-subagent-runner 行为测试与 SQLite worker 冒烟（评审高-2）；本轮改动未提交。

---

## 上一轮交接：status-files-full-archive-2026-09-15（全部归档，主状态文件保持全新）

- 目标：应用户要求把主状态文件剩余全部条目归档：feature_list.json 全部条目（含 10 个 needs-review 与 1 个 in_progress）移入 docs/archive/feature-list-archive.json 前部；progress.md 全部历史段（含 ## Notes）移入 docs/archive/progress-archive.md；session-handoff.md 全部旧交接段移入 docs/archive/session-handoff-archive.md。主文件清空为全新空状态，从头开始记录。
- 改动文件（6 个）：feature_list.json、progress.md、session-handoff.md、docs/archive/feature-list-archive.json、docs/archive/progress-archive.md、docs/archive/session-handoff-archive.md。纯记录搬移，未动生产代码/测试/wiki。
- Blocker：无。
- Notes：未完成项（goal-changes-commit in_progress 及各 needs-review）的完整记录在 archive 中可查；共享工作树存在并行会话未提交 WIP，归档基于当时文件内容原子读改写，若并行会话稍后再写主文件属正常新记录；此前 2026-09-15 的部分归档交接段已随历史入档。
- 下一步：无待办；下个会话从全新状态开始，新 feature 直接追加到 feature_list.json 顶部。

---

## 当前交接：turn-error-row-react-ownership（done，2026-09-19 修复 removeChild NotFoundError）

- 目标：修复用户报障——点「重试」/刷新后抛 `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node` 并冒泡到 ErrorBoundary。
- 根因：`src/components/chat/panel-decoration/turn-error-row.ts` 把 React 渲染的错误红块（`div.bg-destructive/10`，见 `surface/AssistantMessage.tsx:118-122`）当作装饰层自己的行：覆盖其 `className` 并 `replaceChildren()` 删除 React 的 `<strong>` 与文本节点，导致 React 重渲染/卸载时对其已不存在的子节点调用 `removeChild`。
- 改动文件：`src/components/chat/panel-decoration/turn-error-row.ts`（红块改为只读 + 内联 `display:none` 隐藏；行改为装饰层自建的 `.quickforge-error-line` 兄弟节点，首次创建、之后复用；错误解除时清理行/escalate/details；对外 API 与签名不变）；`tests/frontend/message-actions.test.ts`（turn error row 契约断言同步到装饰行）；新增 `tests/frontend/turn-error-row-ownership.test.ts`（6 用例，结构 fake DOM）；`docs/wiki/src/components/README.md` 两处描述同步。
- 验证（全部 exit 0）：定向 vitest 4 files / 69 passed；`npm run test` 360 files / 4288 passed + 1 skipped；`npm run lint` 0 error（仅 coverage/ 既有 3 warning）；`npm run build`（含 `tsc -b`）通过（仅既有 warning）。
- Blocker：无。
- 未决风险：装饰行改为 append 到 assistant 宿主末尾（红块本就在渲染尾部，视觉顺序等价）；若未来红块之后新增 React 尾部节点，装饰行会落在其前而非原位——当前 surface 无此结构。process-folding 等其它装饰器未改。
- 下一步：如需真机确认，在浏览器复现「错误 → 重试 → 新错误 → 重试」循环，确认不再出现 removeChild 报错。无 Git commit/tag/push；未改生成产物；无新增依赖。

---

## 当前交接：process-group-release-structural-gate（done，2026-09-20 修复 subagent 运行期 spinner 闪烁）

- 目标：把 process group 的 release 判定从「messages 数组引用变化」收窄为「结构性 children 身份变化」，使 subagent 运行期间高频 `tool_execution_update` 不再解散存活折叠组、不再重启 spinner 的 animate-spin。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`（gate 的 messages 信号改为比较 `messageRenderKeys` 行身份序列 + WeakMap 结果缓存 + 契约注释）；`src/components/chat/panel-decoration/process-folding.ts`（边界注释同步）；新增 `tests/frontend/chat-surface-release-gate.test.ts`（10 用例）；`tests/frontend/process-folding-ownership.test.ts`（2 个旧 identity 语义用例改为结构语义，该文件主体为并行会话本轮新增）；`docs/wiki/src/components/README.md`（两处副本同步）；progress.md / session-handoff.md。
- 与并行会话的协同：本轮开始时 ChatSurface 的 gate 已被并行会话扩展为 `ProcessGroupReleaseGate`（messages + isStreaming + streamingAssistant presence），本改动叠加其上未回退；并行会话同时新增 `process-folding-ownership.test.ts`，其中 2 个用例以空数组占位断言「数组换引用即 release」，与本任务契约正面冲突，已按新契约修正（换成真实结构差异数据，用例更名为 keeps the release decision structural）——若并行会话仍持有该文件旧版，合并时以结构语义为准。
- 验证（全部 exit 0）：定向 5 文件 116 tests；全量 `npm run test` 364 files / 4347 passed + 1 skipped；`npm run lint`；`npm run build`（含 tsc -b，仅既有 KaTeX/node:fs/chunk warning）。
- Blocker：无。
- 下一步：浏览器真机验收 subagent 运行期 spinner 不再闪烁；关注理论边界（整表替换产生「行身份不变但行内 part 收缩」时新 gate 不释放，详见 progress.md 本轮条目）。无 Git commit；未改生成产物与依赖。

---

## 当前交接：local-file-path-relative-links（done，2026-09-20 聊天相对路径链接化）

- 目标：`panel-decoration/local-file-path-links.ts` 在保留绝对路径匹配与 SKIP 容器/回调链不变的前提下，把工作区相对路径（`src/App.tsx`、`docs/wiki/README.md`、`tests\\frontend\\chat.test.ts` 等）也链接化。
- 改动文件：`src/components/chat/panel-decoration/local-file-path-links.ts`（LOCAL_FILE_PATH_REGEX 扩展为三分支 alternation + 统一前置行后行断言守卫 `(?<![\\w./\\:-])` + 规则注释；尾部标点修剪与 lastIndex 归零逻辑不动）；`tests/frontend/local-file-path-links.test.ts`（4→9 用例：相对路径链接化/不误伤/绝对路径单次匹配/pre·code 跳过/lastIndex 回归）；`progress.md`、`session-handoff.md`。docs/wiki 无该模块条目、无「仅绝对路径」表述，无需同步（源文件已补注释）。
- 设计要点：相对分支首段不含点、中间段可含点、末段必须带 1-8 位扩展名且 basename 允许多点（`chat.test.ts` 完整链接化所需，与任务规格字面末段 `[A-Za-z0-9_-]+` 的有意偏差）；统一守卫顺带修复存量误伤——旧盘符分支会把 `https://` 中的 `s://example.com/a.ts` 链接化，现 URL 整体不链接化。
- 验证（exit 0）：定向 vitest 3 files / 61 passed（local-file-path-links 9 + message-actions 45 + decorator-copy-i18n 7）；`npm run lint` 0 error。未跑全量 test/build（定向验证，grep 确认无其他测试引用该装饰器）。
- Blocker：无。
- 下一步：可选——真机验收相对路径点击可打开（服务端 resolveWorkspacePath 相对解析已有服务端测试覆盖）；如后续发现误伤/漏匹配样本，调相对分支字符类即可，三分支结构无需动。无 Git commit；未改生成产物与依赖。

---

## 当前交接：server-resolve-path-relative-fix（done，2026-09-20 修复点击相对路径链接报错）

- 目标：修复点击聊天中相对路径链接报 "Only absolute paths are supported"——前一轮 `local-file-path-relative-links` 已把相对路径链接化，但服务端 resolve-path 路由只放行绝对路径。
- 改动文件：`server/routes/workspace.mjs`（删除 `handleWorkspaceResolvePath` 的 `path.isAbsolute` 守卫段与随之无引用的 `node:path` 导入；其余逻辑不动，越界 403/敏感路径校验由 `resolveWorkspacePath`/`assertSafeWorkspacePath` 继续承担）；新增 `tests/server/routes/workspace-resolve-path.test.mjs`（3 用例：相对路径 200+relativePath、`../outside` 403、workspace 内绝对路径 200）；`progress.md`、`session-handoff.md`。
- 验证（exit 0）：定向 vitest 新测试 + tests/server/utils/workspace.test.mjs → 2 files / 56 passed；`npm run lint` 0 error。未跑全量 test/build（服务端改动面仅此一个 handler 删守卫，定向覆盖路由 + util 语义）。
- Blocker：无。
- 下一步：**用户需手动重启 dev server 后验收**（`npm run dev` 是纯 `node server/index.mjs --dev`，无 nodemon/watch，server .mjs 改动不自动重载；dev 模式内嵌 Vite 只热更前端）。无 Git commit；未改生成产物与依赖。
