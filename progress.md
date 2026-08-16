# Progress

## Current State

- Feature: `subagent-run-live-updates`
- Status: `done`（subagent 运行详情实时更新改造完成：ServerAgent 在 tool_execution_start/update/end SSE 分支经 SubagentRunEventPublisher 直发 subagentRunStore，local-tools 渲染回填同一 store，Workspace Inspector 改为订阅 store 更新已打开 Tab；runId 以 toolCallId 为主键、sessionId 仅历史兼容 fallback。针对性 6 文件 / 89 项、全量 144 文件 / 1184 项测试通过，TypeScript / lint / build 通过）
- Goal: 让 subagent 运行详情实时更新不依赖聊天渲染器（window 事件），改由 ServerAgent SSE 直发 + 共享 store 订阅，并补齐 runId/store/发布器测试与文档。
- Files: src/lib/subagent-run-detail.ts, src/lib/server-agent.ts, src/lib/local-tools.ts, src/components/workspace/WorkspaceInspector.tsx, tests/frontend/subagent-run-detail.test.ts, tests/frontend/server-agent.test.ts, docs/wiki/src/lib/README.md, docs/wiki/src/components/README.md, feature_list.json, progress.md, session-handoff.md
- Blockers: 无。
- Next step: 无待办；如后续发布，遵循 patch-release-runbook（发布前必须完整 test/lint/build 通过）。
- Last Updated: 2026-08-14

## Completed Work

- Reader 复用：`openFileTab` 命中已有 `file:${path}` reader tab 时，激活 panel/reader tab 的同时将该 reader tab 置为 `loading: true`、`error: undefined`，由既有的 reader 加载 effect（`loadingReaderKeysRef` 去重）重新读取最新内容；新建路径不变。
- Browser 复用：`openPanelTab('browser', { url })` 改为先经新增纯函数 `findBrowserTabToReuse` 在 browser tab 中按 `browserPreviewReuseKey` 查找（本地文件路径归一化为 file key，兼容 `D:\` 与 `D:/` 分隔符；其余 URL 精确比较），命中则激活并递增 `WorkspacePanelTab.reloadNonce`（不持久化），未命中才新建 tab；`+` 菜单空 URL 打开仍每次新建（与既有行为一致）。
- 外部 reload token：`WorkspacePanelTab` 增加可选 `reloadNonce`，仅运行时使用，`serializePanelTabs`/`normalizePersistedPanelTabs` 不变，localStorage 序列化格式无变化；`WebPreviewContent` 增加可选 `externalReloadToken` prop，纳入 previewCheckKey 与 iframe key，重复预览时强制 iframe 重载。
- 纯函数与测试：`workspace-tab-file-path.ts` 新增 `browserPreviewReuseKey`、`findBrowserTabToReuse`；`tests/frontend/workspace-tab-file-path.test.ts` 新增 10 项（同文件复用、不同文件不复用、Windows 路径分隔符归一化、web URL 精确匹配、web/本地不互匹配、跨 kind 不去重、空 URL 不匹配等）。
- 仅同 kind 去重，不做 reader/browser 跨类型合并；未新增依赖，未改生成产物（dist/ 由 build 正常再生成）。

- 已有滚动压缩后，只要出现一条新消息即可再次执行阈值检查，不再固定等待三条新增消息。
- 压缩完成后忽略保留尾部中代表压缩前完整上下文的陈旧 provider usage，立即按 compact summary + tail 重新估算百分比。
- 压缩后出现新的 assistant provider usage 时自动恢复 provider 权威统计；兼容旧压缩元数据和 rollback 后重发场景。
- 补充自动压缩 usage、再次检查、legacy 时间戳和 rollback 重发回归测试。
- 同步更新 server Wiki。
- settings-tab-select-alignment：设置页下拉框宽度对齐（语言/默认 Harness 等行复用 quickforge-settings-row-control-wide）；并在 `.quickforge-settings-select-trigger-label` 显式设置 font-size: 0.9rem / line-height: 1.35，使收起态已选值与菜单选项字号一致。改动文件：src/index.css、src/lib/default-options-settings-tab.ts（保留此前两处 wide 修改）。

## Verification Evidence

- `npm run test`（workspace-same-file-tab-reuse）：exit code 0，141 个测试文件、1109 项测试全部通过（100%）。
- `npm run lint`：exit code 0，0 error，仅 1 个既有 warning（server/cloud/identity.mjs no-useless-assignment）。
- `npm run build`：exit code 0，仅既有 KaTeX 字体解析与大 chunk warning。
- `npx vitest run tests/frontend/workspace-tab-file-path.test.ts tests/frontend/workspace-inspector-tabs.test.ts tests/frontend/workspace-inspector-request.test.ts`（workspace-same-file-tab-reuse）：exit code 0，3 个测试文件、37 项测试全部通过（含新增 browserPreviewReuseKey / findBrowserTabToReuse 10 项测试）。
- `npx vitest run tests/server/auto-compaction.test.mjs tests/server/agent-manager.rollback-compaction.test.mjs`：exit code 0，2 个测试文件、14 项测试通过。
- `npx eslint server/context-usage.mjs server/auto-compaction.mjs tests/server/auto-compaction.test.mjs`：exit code 0。
- `npm run test`：exit code 0，141 个测试文件、1088 项测试全部通过。
- `npm run lint`：exit code 0；仅 7 个既有 warning（desktop/nsis-patch/apply.mjs 的 no-console、server/cloud/identity.mjs 的 no-useless-assignment），无 error。
- `npm run build`：exit code 0；仅既有 KaTeX 字体解析与大 chunk warning。
- settings-tab-select-alignment 验证：`npm run lint` exit code 0，仅 7 个既有 warning（desktop/nsis-patch/apply.mjs no-console、server/cloud/identity.mjs no-useless-assignment），无 error；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。
- 独立 Explore 代码审查：两个修复无阻断问题；回滚后 provider usage 恢复边界已按建议修正并补测试。

## v1.7.7 发布准备与验证（2026-08-12）

- 版本：`npm version patch --no-git-tag-version`，package.json / package-lock.json（root 与 packages[""]）均为 1.7.7。
- CHANGELOG.md：Unreleased 整理为 `[1.7.7] - 2026-08-12`，含 Cloud URL 改动（HTTP 建议仅用于可信自建服务/内网网关，注明 Bearer token 明文风险）、三个 fix（auto-compaction 触发与 usage 刷新、settings select 对齐、NSIS 升级自愈）、Released 小节与 1.7.7 离线包命令；格式与 1.7.6 一致。
- README.md：核查无硬编码版本（无 1.7.x/v1.7/shawnstack-quickforge- 引用），未做改动。
- 已纳入发布的既有改动（审查通过）：Cloud 配置/路由/测试、prepare-patch-release.cjs（test 门禁）、runbook（手动流程优先）、AGENTS.md（Startup/Verification/DoD）、PR 模板（test 勾选）、wiki（root-config、scripts）。init.sh 纳入发布范围但内容无需修改。
- 排除项：`.qf_staging/`、`artifacts/`、空文件 `c` 未纳入，未删除任何用户文件。

## Notes

- 工作区存在与本任务无关的并发改动和未跟踪项，已保留且未主动修改。
- `dist/` 为 build 生成产物，未手工修改。

## v1.7.7 门禁与打包结果（2026-08-12）

- `npm run test`：exit code 0，141 个测试文件 / 1088 项测试全部通过（100%）。
- `npm run lint`：exit code 0，0 error，1 个既有 warning（server/cloud/identity.mjs no-useless-assignment）。
- `npm run build`：exit code 0，仅既有 KaTeX 字体未解析与大 chunk warning。
- 打包：`node scripts/prepare-runtime-package.cjs`、`node scripts/prepare-offline-package.cjs`、`cd package-offline && npm pack` 均 exit 0。
- tarball：`package-offline/shawnstack-quickforge-1.7.7.tgz`，25.1 MB，291 文件；核验无 .qf_staging、artifacts、`c`、临时/日志/.env/node_modules/.git 内容。
- 未执行 commit/tag/push/publish；`dist/`、`package-dist/`、`package-offline/` 未手工修改。

## v1.7.7 远端 Git 发布完成（2026-08-12）

- GitHub 连接恢复：`git ls-remote --heads --tags origin` 成功（第 1 次尝试）。
- `git push origin master`：`2f4ecbb..c377144 master -> master` 成功。
- `git push origin v1.7.7`：`* [new tag] v1.7.7 -> v1.7.7` 成功（annotated tag，tag 对象 093904e...，peeled c3771444...）。
- 远端核验（ls-remote）：refs/heads/master = `c3771444ad8da9bd1e2d870fcfe7de6562cb4a57`；refs/tags/v1.7.7^{} = `c3771444ad8da9bd1e2d870fcfe7de6562cb4a57`。
- 状态提交 `docs(handoff): mark v1.7.7 git release complete` 已创建并推送至 origin master。
- npm publish 未执行（默认不发布）。

## 智能体操作菜单首项文案统一（2026-08-13）

- 改动：设置 → 智能体中，智能体操作菜单首项文案由 `openMenuAgent.builtin ? t('builtinAgentModelSettings') : t('editTask')` 统一为 `t('editTask')`，使内置/自定义智能体均显示“编辑”（t('editTask') 为 en 'Edit' / zh '编辑'）；仅改显示文案，onClick（openEditAgentDialog）等行为及其他逻辑不变。
- 改动文件：src/components/agent-profiles/AgentProfilesPage.tsx（1 行）、feature_list.json、progress.md、session-handoff.md。
- 验证：`npm run lint` exit code 0，0 error，仅 1 个既有 warning（server/cloud/identity.mjs no-useless-assignment）；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。无对应组件测试（纯 JSX 文案改动，无测试文件）。未新增依赖、未提交 Git、未手工修改生成目录（dist/ 由 build 正常再生成）。

## subagent 运行详情侧栏（2026-08-14）

- 需求：用户明确要求“点击聊天中的 subagent 卡片 → 右侧侧栏查看该次运行详情/执行过程”，不是 Agent Profile 配置。
- 先撤回错误方向（仅本 feature）：删除 `src/lib/agent-profile-panel.ts`、`src/components/agent-profiles/AgentProfileSidePanel.tsx`、`tests/frontend/agent-profile-lookup.test.ts`；`src/lib/local-tools.ts` 移除 `OPEN_AGENT_PROFILE_EVENT`/`renderOpenAgentProfileButton`；`src/App.tsx`、`src/hooks/useUIState.ts`、`src/components/agent-profiles/AgentProfilesPage.tsx`、`docs/wiki/src/README.md`、`docs/wiki/src/lib/README.md` 经 diff 确认仅含错误 feature 后恢复 HEAD；`src/lib/i18n.ts` 只删 `openAgentProfile`/`agentProfileNotFound`（en/zh），并发 cloud 的 `cloudRemoteAutoApproval*` 全部保留；feature_list.json/progress.md/session-handoff.md 恢复 HEAD 历史后追加本记录，未再次覆盖历史。
- 正确实现：
  - 稳定 run id：`lib/subagent-run-detail.ts` 的 `buildSubagentRunPayload` 优先 `details.sessionId`，旧消息回退 `${name}:${task}`；并输出 status/statusLabel/timing/toolCalls/allowedTools/过滤后 traceMessages/tools/pendingToolCalls/input/details JSON/output/detailed/内容指纹。
  - 交互：subagent 卡片摘要行新增带文字标签的“查看运行详情”按钮（`renderOpenSubagentRunButton`，派发 `quickforge:open-subagent-run`，detail 含 runId+payload 快照），`<details>`/`<summary>` 原生展开折叠不变；未采用“摘要点击即开侧栏”，避免破坏既有展开行为。
  - 共享模板：内联卡片 body 抽为 `renderSubagentRunBody`（local-tools.ts 导出），侧栏通过 Lit 宿主元素 `subagent-run-detail-body`（light DOM）复用同一模板，panel 模式无条件展示摘要框/input/details，两视图零漂移。
  - 实时更新：渲染器每次收到更新经 `queueMicrotask` + 内容指纹去重派发 `quickforge:update-subagent-run`；App 用 `shouldApplySubagentRunUpdate` 仅更新当前打开的 run。
  - 互斥：打开运行详情时收起 WorkspaceInspector/Artifact 预览；打开 WorkspaceInspector 或自动/手动预览时收起运行详情；项目切换重置。
  - 小屏：lg+ 右侧 split pane（与 WorkspaceInspector 相同模式），小屏降级为全宽右侧抽屉，避免“已打开但侧栏 hidden 不可见”。
  - i18n：新增 `viewSubagentRunDetails`/`subagentRunDetails`/`subagentRunEmpty`（en/zh）。
- 改动文件：src/lib/subagent-run-detail.ts（新增）、src/lib/local-tools.ts、src/components/chat/SubagentRunDetailPanel.tsx（新增）、src/hooks/useUIState.ts、src/App.tsx、src/lib/i18n.ts、tests/frontend/subagent-run-detail.test.ts（新增）、docs/wiki/src/README.md、docs/wiki/src/lib/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：`npm run test` exit code 0，143 个测试文件、1145 项测试全部通过（100%）；`npm run lint` exit code 0，0 error，仅 1 个既有 warning（server/cloud/identity.mjs no-useless-assignment，属并发 cloud 改动）；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。针对性测试 `tests/frontend/subagent-run-detail.test.ts`（13 项）+ `tests/frontend/subagent-process-trace.test.ts`（2 项）全部通过。未新增依赖、未提交 Git、未手工修改生成目录（dist/ 由 build 正常再生成）。
- Notes：工作区存在并发 cloud 会话改动（server/cloud、src/components/cloud、src/lib/cloud-client.ts、cloud tests/docs、i18n 的 cloudRemoteAutoApproval* 等），本次全部保留；并发会话可能需自行补记其状态到 feature_list.json/progress.md/session-handoff.md。

## subagent 运行详情最小修复（2026-08-14）

- 独立审查确认的 3 个问题全部修复（最小改动，未触碰 Cloud 并发文件、未提交 Git）：
  - HIGH：`renderSubagentRunBody` 的 `<message-list>` 由布尔属性绑定 `?data-quickforge-subagent-process=${!options.panel}` 修为静态精确值 `data-quickforge-subagent-process="true"`（内联与侧栏一致）。此前内联时属性值为空串、侧栏时属性被移除：精确 selector `message-list[data-quickforge-subagent-process="true"]`（index.css、message-actions.ts 的 decorateProcessBlocks）不匹配，且侧栏列表未满足 windowed-messages 的存在性退避（hasAttribute），会被窗口接管导致长 trace 截断。
  - MEDIUM：App 互斥/收起时仅 `setSubagentRunPanelOpen(false)`，残留 runId/payload 仍使隐藏面板接收 UPDATE 事件。新增统一 `closeSubagentRunPanel` useCallback（同时清 open/runId/payload），复用于 requestWorkspaceInspector、工具栏手动展开 WorkspaceInspector、项目切换清理 effect、面板 onClose；自动预览经 requestWorkspaceInspector 已覆盖，未重复改。
  - LOW：fingerprint 仅按长度/条数，同长度内容变化不改变指纹。新增 FNV-1a 32 位纯函数 stableHash（无依赖）+ jsonText，对 output/input/details 及 traceMessages JSON 做轻量稳定 hash（不拼入原始大内容），并保留原有长度字段。
- 删除 SubagentRunDetailPanel 未使用的 runId prop 及 App 传参（App 的 runId 状态仍保留，用于 UPDATE 事件匹配）。
- 测试：tests/frontend/subagent-run-detail.test.ts 新增“同长度文本内容变化（trace/details/output）指纹不同”用例（13→14 项）。message-list 属性精确值未补 DOM 用例：测试设施无 jsdom/Lit 渲染环境，按任务约定不为低成本不可达的情况引入 DOM 依赖。
- 改动文件：src/lib/local-tools.ts、src/lib/subagent-run-detail.ts、src/App.tsx、src/components/chat/SubagentRunDetailPanel.tsx、tests/frontend/subagent-run-detail.test.ts、feature_list.json、progress.md、session-handoff.md。
- 验证：`npm run test` exit code 0，143 文件 / 1146 项测试全部通过（100%）；`npm run lint` exit code 0，0 error，仅 1 个既有 warning（server/cloud/identity.mjs no-useless-assignment，属并发 cloud 改动）；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。针对性测试 subagent-run-detail（14 项）+ subagent-process-trace（2 项）+ windowed-messages（14 项）共 30 项通过。未新增依赖、未手工修改生成产物（dist/ 由 build 正常再生成）。

## subagent 运行详情接入工作区 Tab（2026-08-14）

- 根据用户反馈，将 subagent 运行详情从独立右侧侧栏改为 `WorkspaceInspector` 的运行时 Tab，与文件、审查、终端和浏览器 Tab 并存。
- 点击聊天中的 subagent 摘要会直接打开或激活对应 `runId` 的 Tab；同一次运行复用已有 Tab，不同运行分别创建 Tab，可切换、排序和单独关闭。
- 移除聊天内 `<details>` 展开与重复详情内容；聊天只显示名称、状态和耗时摘要，任务、工具调用、完整过程和结果统一在工作区 Tab 显示。
- `quickforge:update-subagent-run` 由 Workspace Inspector 直接监听，只实时更新已打开且 `runId` 匹配的 Tab。subagent Tab 不写入项目持久化，刷新后不恢复；其他 Tab 的持久化规则不变。
- 支持没有项目的全局对话打开 subagent Tab；独立 `SubagentRunDetailPanel` 与 `useUIState` 中对应状态已删除。
- 改动文件：`src/App.tsx`、`src/lib/local-tools.ts`、`src/lib/subagent-run-detail.ts`、`src/components/workspace/WorkspaceInspector.tsx`、`src/components/workspace/SubagentRunDetailContent.tsx`、`src/components/workspace/workspace-inspector-tabs.ts`、`src/components/workspace/workspace-inspector-request.ts`、`src/components/workspace/workspace-types.ts`、相关测试和 Wiki/状态文件。
- 验证：`npx tsc -b --pretty false` 通过；针对性测试 4 文件 / 33 项通过；`npm run test` 143 文件 / 1148 项全部通过（100%）；`npm run lint` 0 error，仅 1 个并发 Cloud warning；`npm run build` 通过，仅既有 KaTeX 字体与大 chunk warning。未提交 Git，未手工修改生成目录。
- 后续样式/配置修正：Workspace Tab 不再强制 detailed 内容，直接沿用原 subagent 详情模板和工具显示配置；`concise / compact` 保持简洁，`detailed` 才显示工具调用统计、允许工具、input/details。验证：TypeScript 通过；针对性 3 文件 / 29 项通过；修改文件 lint 通过。
## subagent 侧边详情与聊天内展示一致化（2026-08-14）
- 目标：让 Workspace Inspector 中 subagent 运行详情 Tab 的层级、过程折叠装饰与交互、视觉与聊天内既有展示“一步到位一致”，并补齐可测试生命周期与测试。
- 内部块顺序以 Git 历史最终态（1f40ead / 32be493，不恢复已废弃的 ad45fc7 分组重排）为规范：task/context/expectedOutput → detailed 摘要（工具统计/耗时/允许工具）→ trace（process message-list，保持原始时间线顺序）→ 无 trace 时 output → detailed 时 input/details。顺序抽为 `subagentRunBodyBlocks()`（`src/lib/subagent-run-detail.ts`）单一事实来源，`renderSubagentRunBody` 据此输出，避免模板与测试各写一份顺序。
- 过程折叠一致化：把 `decorateMessages` 内联的 subagent message-list 装饰循环抽为导出的 `decorateSubagentProcessBlocks(panel)`（`panel-decoration/message-actions.ts`，经 `panel-decoration.ts` 再导出），聊天与侧边共用同一路径。`SubagentRunDetailBodyElement`（`local-tools.ts`）每次渲染后调度一次装饰：等 Lit `updateComplete` 与 message-list `updateComplete` 后再执行，覆盖首次挂载、payload 实时更新、运行状态变化（`data-quickforge-subagent-streaming` 随之变化，process folding 全量重建/释放 streaming 态）；调度用布尔标志防叠加，卸载置 `disposed` 标志并检查 `isConnected`，装饰幂等（process-folding 指纹跳过/重建），无外部监听器泄漏。
- 视觉与可访问：侧边容器沿用 Inspector 内容区 `px-4 py-4`，body 模板与聊天内一致（同一 `renderSubagentRunBody`），不引入新视觉语言。聊天摘要按钮作为打开侧栏的入口：原生 button 语义 + `aria-label`/`title`，index.css 新增 `.quickforge-subagent-tool > .quickforge-tool-summary` 的 hover（浅背景）与 focus-visible（焦点环）反馈。
- WorkspaceInspector subagent Tab 审查：upsert/激活/关闭/重复 runId（同 runId 复用并更新 payload）/无 projectId（请求放行、Tab 可渲染）行为均正确，未发现需修复的明确缺陷；未改动工作区 Tab 拖拽排序与 `reorderPanelTabs` 规则。
- 死代码清理（确认无引用后删除）：`src/index.css` 移除已无渲染来源的 `.quickforge-subagent-chevron`（保留 `.quickforge-tool-chevron`）；`src/lib/subagent-run-detail.ts` 删除不再被 src 引用的 `shouldApplySubagentRunUpdate`（实时更新已由 WorkspaceInspector 直接按 runId 处理）。
- 测试：subagent-run-detail.test.ts 新增 `subagentRunBodyBlocks` 顺序（5 项）、trace 时间线保序（1 项）、`called` 状态（1 项），删除 `shouldApplySubagentRunUpdate` 用例；新增 `tests/frontend/decorate-subagent-process.test.ts`（4 项）：验证子代理 message-list 各自以子节点与 streaming 标志被装饰、未标记列表被忽略、跨作用域子节点被过滤、空 panel 为空操作。workspace-inspector-tabs/request 既有测试已覆盖重复打开复用、实时更新与无 projectId。
- 改动文件：`src/components/chat/panel-decoration/message-actions.ts`、`src/components/chat/panel-decoration.ts`、`src/lib/subagent-run-detail.ts`、`src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/subagent-run-detail.test.ts`、`tests/frontend/decorate-subagent-process.test.ts`（新增）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc -b` 通过；针对性 vitest 6 文件 / 92 项全部通过；`npm run test` 144 文件 / 1159 项全部通过（100%）；`npm run lint` 0 error（仅 1 个并发 Cloud warning）；`npm run build` 通过（仅既有 KaTeX 字体解析与大 chunk warning）。未新增依赖、未提交 Git、未手工修改生成产物（dist/ 由 build 正常再生成）、未触碰 Cloud 并发改动。

## subagent 运行详情实时更新改造（2026-08-14）

- 需求：subagent 运行详情实时更新不再依赖聊天渲染器（local-tools 的 UPDATE window 事件），改由 ServerAgent 在 SSE 事件路径直发 + 共享 store 订阅，并在恢复会话/历史消息时回填同一 store。
- 稳定 run id 语义修正：新消息以 `toolCallId`（显式参数或 `details.toolCallId`）为主键（start/update/end 全程不变，sessionId 在 update 后变为子代理会话导致失配），`details.sessionId` 仅作历史兼容 fallback（旧消息/旧服务器无 toolCallId 时），最后回退 `${name}:${task}`；修正注释与实现一致。
- `subagent-run-detail.ts`：
  - `SubagentRunStore`：有界内存快照 store（`MAX_SUBAGENT_RUN_SNAPSHOTS`=100），publish 指纹去重（同指纹返回 false 不通知）、订阅者异常隔离（单订阅者抛错不破坏发布链）、get/subscribe（返回取消函数）/clear（仅清快照、保留订阅关系）；已存在 key 的重复发布不刷新 Map 插入顺序（按首次插入淘汰）；全局单例 `subagentRunStore`。
  - `subagentRunPayloadFromToolEvent(event, isStreaming, cachedArgs, toolDisplayMode, t, previousTiming)`：tool_execution_start/update/end → 载荷的纯转换（toolName 必须为 run_subagent、args 缺时用 cachedArgs 回填、isStreaming 区分 running/done、event.isError/result 合并归 error、previousTiming 回填 timing）。
  - `SubagentRunEventPublisher`（导出类，ServerAgent 持有）：按 toolCallId 缓存 run_subagent 的 args/toolName；handleToolStart 缓存后经 `toolStartEventWithPartialResult` 规范化事件（带 partialResult）发布 running；handleToolUpdate 缺 args/toolName 回填缓存、previousTiming 取 store 同 runId 上一次载荷；handleToolEnd 发布终态后清理缓存；dispose 清空缓存；非 run_subagent/无 toolCallId/无 args 忽略，不影响其他工具。
- `server-agent.ts`：`ServerAgent` 新增实例字段 `subagentRunPublisher = new SubagentRunEventPublisher({ t, getToolDisplayMode: () => getCachedToolDisplaySettings().toolDisplayMode })`；tool_execution_start（用规范化事件 upsert 后调 handleToolStart）、update、end 每次 state upsert 后调用对应 handler；dispose 调 publisher.dispose() 清理缓存。
- `local-tools.ts`：删除 UPDATE_SUBAGENT_RUN_EVENT import、`subagentRunUpdateFingerprints` Map 与 `dispatchSubagentRunUpdate`（含 queueMicrotask）；`SubagentToolRenderer.render` 构建 payload 后直接 `subagentRunStore.publish(payload)` 作历史/恢复回填（store 内指纹去重，与 SSE 实时发布不重复）；摘要点击打开时优先 `subagentRunStore.get(payload.runId) ?? payload`；runId 稳定来源为 toolResult `details.toolCallId`（upsertToolResult 注入）。
- `WorkspaceInspector.tsx`：删除 UPDATE_SUBAGENT_RUN_EVENT import 与 window listener，改为 `useEffect(() => subagentRunStore.subscribe(...))`（返回取消订阅函数）；收到 payload 仅更新已打开且同 runId、指纹不同的 Tab，无匹配时返回原数组避免无意义 setState；subagent 打开请求优先 `subagentRunStore.get(request.payload.runId) ?? request.payload` 再 upsert。
- 测试：
  - subagent-run-detail.test.ts 14→44 项：subagentRunId 新增显式/详情 toolCallId 优先、sessionId 变化不影响（原 "prefers sessionId" 更名）；buildSubagentRunPayload 显式 toolCallId 优先；SubagentRunStore 独立实例（不污染全局单例）覆盖去重/无 runId 拒绝/取消订阅/异常隔离/上限淘汰/重复发布不刷新插入顺序/clear 保留订阅；subagentRunPayloadFromToolEvent 覆盖 start 运行态、非 subagent 忽略、cachedArgs 回填、previousTiming 回填、end done/error；SubagentRunEventPublisher 覆盖 start→update→end 全生命周期（update/end 缺 args+toolName 仍发布）、规范事件带 timing、previousTiming 回填、end 后缓存清理、非 subagent 不缓存、无 args 不发布、dispose 后忽略。
  - server-agent.test.ts 20→21 项：新增端到端用例——emit tool_execution_start/update/end SSE 后断言全局 subagentRunStore 出现 running→running→done 载荷（task/output/runId 正确），证明发布不依赖 local-tools render。
- 改动文件：`src/lib/subagent-run-detail.ts`、`src/lib/server-agent.ts`、`src/lib/local-tools.ts`、`src/components/workspace/WorkspaceInspector.tsx`、`src/components/workspace/workspace-inspector-tabs.ts`、`tests/frontend/subagent-run-detail.test.ts`、`tests/frontend/server-agent.test.ts`、`tests/frontend/workspace-inspector-tabs.test.ts`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc -b` 通过；针对性 vitest 6 文件 / 89 项全部通过；`npm run test` 144 文件 / 1184 项全部通过（100%）；`npm run lint` 0 error（仅 1 个并发 Cloud warning：server/cloud/identity.mjs）；`npm run build` 通过（仅既有 chunk size warning）。未新增依赖、未提交 Git、未手工修改生成产物（dist/ 由 build 正常再生成）、未触碰 Cloud 并发改动。

## 追加记录（subagent-run-canonical-id-live-updates，2026-08-15）

- 修复运行中 subagent 点击后 Inspector 详情因 runId 分叉无法持续实时更新：聊天 renderer 使用 toolResult 顶层 toolCallId，与 SSE canonical 主键统一；无 canonical ID 的 called/running 摘要禁用；仅 canonical payload 进入实时 store，历史终态 fallback 直接打开当前消息；恢复终态可单向修正残留 running 快照。
- 保持详情展示顺序、trace 原始时间线、process folding、Workspace Tab 拖拽和持久化规则不变；未触碰 Cloud 并行源码。
- 验证：相关测试 6 文件/108 项、TypeScript、完整测试 144 文件/1203 项、lint、build 全部通过；lint 仅 Cloud 并行文件既有 1 条 warning。
- 本 feature 已完成，提交时仅纳入显式文件，不 push。
