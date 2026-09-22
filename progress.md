## 2026-09-22 · 设置页「常规」语言/思考等级下拉框收窄（settings-row-control-compact）

- Goal：设置页「常规」tab 中「语言」下拉容器误用 `quickforge-settings-row-control-wide`（`min-width: min(28rem, 48%)`，约 432px 过宽），「默认模型思考等级」行用普通 row-control（min-width 11rem）。方案 B（用户确认）：两处统一收窄为固定 8.5rem——新增 `.quickforge-settings-row-control-compact { width: 8.5rem; min-width: 8.5rem; }`（仿 `.quickforge-share-expiration-select` 先例），语言行 wide→compact、思考等级行追加 compact；共享 wide 类不动。
- 改动文件：`src/index.css`（wide 规则后新增 compact 类 +5 行；移动端 row-control 撑满选择器组显式列入 compact，跟随既有 100% 模式确保窄屏不溢出）、`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`（语言行 L996 wide→compact、思考等级行 L1033 追加 compact；「默认模型」行 L1011 wide 保持）、`feature_list.json`（新增 settings-row-control-compact，done）、`progress.md`、`session-handoff.md`。
- 验证（定向，小改动未跑全量）：`npx vitest run`（default-options-settings-react + default-options-settings-tab + quickforge-settings-select）→ **3 files / 26 passed（exit 0）**；`npx eslint src/components/settings/tabs/DefaultOptionsSettingsTab.tsx` → **exit 0**。测试对这两个容器类名零断言（grep tests/ `row-control` 无匹配），无需改测试。
- Notes（只记录，不扩范围）：
  - a) 共享 `.quickforge-settings-row-control-wide` 被 About/Channels/ProjectCommands/Backup/Memory/LanAccess/CustomProviders 等大量复用，本轮未动类定义与复用处。
  - b) 移动端沿用既有 100% 撑满模式（与全部 row-control 一致），未采用 14rem 上限变体。
  - c) 无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-22 · 需求理解修正：工具卡详情固定默认收起（无配置）+ 可配置改为阶段层 expandProcessStageByDefault

- Goal：上一轮 `tool-call-rows-expand-details-collapse` 需求理解有误（把可配置项做成 `expandToolDetailsByDefault`「工具详情默认展开」），经用户指出修正为最终语义：① 工具卡参数/输出详情（`ToolDetails`，5 渲染器 + `DefaultToolCardBody` 默认卡）**固定默认收起**（`initiallyOpen={false}`），无任何设置；手动开合记忆（`toolDetailsOpenMemory`）优先；「简洁/详细」（toolDisplayMode）只控内容渲染；② 可配置项改为 `tool-display-settings.expandProcessStageByDefault: boolean`（默认 `true`），控制「已执行 N 个工具调用」阶段层（stage）默认收起/展开（`processStageDefaultExpanded()` 读 `getCachedToolDisplaySettings()`），手动开合记忆优先，顶层过程组默认（流式展开/历史收起）不变；③ 设置页「常规 → Tool 显示模式」开关为「工具调用列表默认展开」（默认开），i18n key `expandProcessStageByDefault(+Description)`（en+zh）；④ 旧字段 `expandToolDetailsByDefault` 与 helper `toolDetailsDefaultExpanded()` 已删除，normalize 白名单重建时与 legacy `showToolDetails`/`expandToolsByDefault` 一并剥离。
- 改动文件：`src/lib/tool-display-settings.ts`、`src/lib/tool-renderers/shared.tsx`、5 个 tool-renderer（`ask-user-tool-renderer.tsx` / `goal-report-tool-renderer.tsx` / `local-workspace-tool-renderer.tsx` / `mcp-tool-renderer.tsx` / `todo-write-tool-renderer.tsx`）、`src/components/chat/surface/ToolMessage.tsx`、`src/components/chat/panel-decoration/process-folding.ts`、`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`、`src/lib/i18n.ts`、`src/index.css`、测试 7 文件（`chat-surface-tool-message.test.ts` / `process-folding.test.ts` / `settings-normalizers.test.ts` / `goal-report-renderer.test.ts` / `tool-renderer-shared-state.test.ts` / `chat-surface-css-contract.test.ts` / `default-options-settings-react.test.ts`）、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`（双副本同步）、`docs/wiki/src/README.md`（按最终语义修正，旧语义 0 残留）、`feature_list.json`（条目修正为最终语义）、`progress.md`、`session-handoff.md`。
- 验证：全量 `npm run test` → **376 files / 4492 passed / 1 skipped（exit 0；历史登记的 4 个既有服务端失败连续两轮未复现）**；`npm run lint` → **无告警（exit 0）**；`npm run build` → **成功（exit 0）**；前端回归 **2605 用例通过**。
- Notes（只记录，不扩范围）：
  - a) 折叠默认值最终口径：顶层组 = `isAgentStreaming`（流式展开/历史收起）不变；阶段层默认由 `expandProcessStageByDefault`（默认 true）控制；工具卡详情固定收起（无配置）；saved state 手动开合记忆均优先于默认值。
  - b) `toolDisplayMode`（简洁/详细）只控内容渲染；旧 `expandToolDetailsByDefault` / `toolDetailsDefaultExpanded()` 已删除，normalize 白名单剥离 legacy `showToolDetails`/`expandToolsByDefault`。
  - c) 工作区混有「MCP 服务→MCP」措辞改动（`src/lib/i18n.ts` 22 行 + 根 `README.md` 2 行），与本 feature 无关、来源待确认，本次未回退未调整。
  - d) 此前登记的 4 个既有服务端测试失败（ACP channel/workspace-mapping/sqlite quick_check）连续两轮全量未复现，待确认是否已被修复或环境相关。
  - e) 各轮真机验收清单沿用（见下方历史记录 Notes）。
  - f) 本轮无 Git 操作（2.2.0 发布的 git commit/tag/push 仍待执行）、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-22 · 对话工具调用默认展开到工具行层 + 工具卡细节默认收起且可配置（需求理解已修正，最终语义见上条）

- Goal：用户需求——对话里工具调用默认展开到工具行层（不用再点一层），工具卡 params/output 细节默认收起、可配置。实现四项：① process-folding 内层 stage 默认展开（`processStageDefaultExpanded()` 返回 true，用户手动开合记忆优先），展开过程组后每条工具调用直接可见，顶层组默认不变（流式展开/历史收起）；② 工具卡 params/output 细节区（`ToolDetails`，含 5 个渲染器与 DefaultToolCardBody 默认卡）默认收起，由新设置 `tool-display-settings.expandToolDetailsByDefault`（默认 false）控制初始开合，手动开合记忆优先；③ 简洁/详细（toolDisplayMode）只控内容渲染不再控初始开合；④ 设置页「常规 → Tool 显示模式」新增「工具详情默认展开」开关（i18n en+zh 新增 key）。
- 改动文件：
  - `src/lib/tool-display-settings.ts`（新增 `expandToolDetailsByDefault`，默认 false）、`src/lib/tool-renderers/shared.tsx`（ToolDetails 初始开合接线新设置）、5 个 tool-renderer（`ask-user-tool-renderer.tsx` / `goal-report-tool-renderer.tsx` / `local-workspace-tool-renderer.tsx` / `mcp-tool-renderer.tsx` / `todo-write-tool-renderer.tsx`）、`src/components/chat/surface/ToolMessage.tsx`（DefaultToolCardBody 默认卡同步）。
  - `src/components/chat/panel-decoration/process-folding.ts`（`processStageDefaultExpanded()` 返回 true，手动开合记忆优先）。
  - `src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`（「常规 → Tool 显示模式」新增「工具详情默认展开」开关）；`src/lib/i18n.ts`（仅新增 key，en+zh）；`src/index.css`。
  - 测试 7 文件：`chat-surface-tool-message.test.ts` / `process-folding.test.ts` / `settings-normalizers.test.ts` / `goal-report-renderer.test.ts` / `tool-renderer-shared-state.test.ts` / `chat-surface-css-contract.test.ts` / `default-options-settings-react.test.ts`。
  - `docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/README.md`；`feature_list.json`（新增 tool-call-rows-expand-details-collapse，done）、`progress.md`、`session-handoff.md`。
- 验证：全量 `npm run test` → **376 files / 4492 passed / 1 skipped（exit 0；此前登记的 4 个既有服务端失败本次未复现）**；`npm run lint` → **无告警（exit 0）**；`npm run build` → **成功（exit 0）**。
- Notes（只记录，不扩范围）：
  - a) 折叠默认值：顶层组 = `isAgentStreaming`（流式展开/历史收起）不变；内层 stage 默认展开、工具卡细节默认收起（`expandToolDetailsByDefault` 默认 false），两者 saved state 手动开合记忆均优先于默认值。
  - b) `toolDisplayMode`（简洁/详细）语义收窄：只控内容渲染，不再控初始开合。
  - c) 工作区混有「MCP 服务→MCP」措辞改动（`src/lib/i18n.ts` 22 行 + 根 `README.md` 2 行），与本 feature 无关、来源待确认，本次未回退未调整。
  - d) 此前登记的 4 个既有服务端测试失败（ACP channel/workspace-mapping/sqlite quick_check）本次全量未复现，待确认是否已被修复或环境相关。
  - e) 各轮真机验收清单沿用（见下方历史记录 Notes）。
  - f) 本轮无 Git 操作（2.2.0 发布的 git commit/tag/push 仍待执行）、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-22 · 过程折叠第二轮：纯思考段不渲染空「已执行」stage 头

- Goal：第一轮两层折叠落地后，纯思考段（段内只有 thinking 块、没有任何工具行）会出现一个空壳「已执行 N 个工具调用」stage 头——没有工具统计可聚合，没有信息量。本轮：纯思考段不包 stage，思考块直接挂顶层组 body；工具行到来后走全量重建正常包 stage。
- 改动文件：
  - `src/components/chat/panel-decoration/process-folding.ts`：新增导出 `processSectionNeedsStage(items)`（段内含任何 `tool-message` 才需要 stage，含 run_subagent/generate_image 这类不可分组工具行）；`populateProcessGroup` 中 `section.kind === 'detail' || !processSectionNeedsStage(...)` 走 `populateProcessContainer` 直挂顶层组 body；`appendProcessToolSuffix` 注释「工具组→stage step」。
  - `tests/frontend/process-folding.test.ts`：新增 `processSectionNeedsStage` 纯函数 3 例（thinking-only false / 含 tool-message true / 空 false）。
  - `tests/frontend/process-folding-incremental.test.ts`：新增 DOM 级用例——thinking-only 回合无 stage 头、无空「已执行」标题；工具到来后全量重建出 stage 且 step.children=[thinking, tool]。
  - `docs/wiki/src/components/README.md`（两份副本）+ `docs/wiki/src/lib/README.md`：process-folding 条目补充纯思考段规则；所有权租约条目 appendProcessToolSuffix 描述同步「最后一个 stage step 的最后一行」。
- 验证：定向 `npx vitest run`（process-folding + incremental）→ **2 files / 47 passed（exit 0）**；前端全量 `tests/frontend/` → **203 files / 2590 passed（exit 0）**；全量 `npm run test` → **4470 passed + 4 failed**（4 处失败 = 第一轮同款服务端 ACP/sqlite 既有失败，重跑清单一致；另一次全量出现的第 5 个失败未复现，系并行偶发 flaky）；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**。
- Notes（只记录，不扩范围）：
  - a) 「纯思考」判定口径 = 段内没有任何 tool-message 节点（subagent / 生图卡这类不可分组工具也算「有工具」）；中间 Markdown detail 段行为不变（本来就不包 stage）。
  - b) 工具行到来后的恢复路径是结构变化触发的全量重建（非增量），无需额外状态；思考头接管契约 / 所有权租约 / fail-visible 均不受影响。
  - c) 待真机验收：纯思考回合展开顶层组后直接看到思考块（无空「已执行」行）；带工具回合不变。

---

## 2026-09-22 · 过程折叠移除「调用了 N 项工具」最内层（三层→两层折叠）

- Goal：用户反馈保留「已执行 N 个工具调用 · M 条命令」这层（stage 阶段层）、移除其下还要再点一次的「调用了 N 项工具」最内层工具摘要组（tools）。调研后用户裁决：普通回合（无中间 Markdown、原本只有 tools 层）也统一包 stage 头（方案 B）；「N 项失败」失败计数挪到 stage 头上。
- 改动文件：
  - `src/components/chat/panel-decoration/process-folding.ts`：`splitProcessStageSections` 所有连续过程段（含首段）一律 `kind:'stage'`（中间 Markdown 仍是不折叠 detail 段）；`populateProcessContainer` 删除分段与 tools 包裹，过程项按时间线原序直接挂 step；`summarizeProcessStageTools`/`ProcessStageSummary` 新增 `errorCount`，`processStageLabel` 失败时追加 `processToolsFailedCount`；`appendProcessToolSuffix` 防闪烁校验链改为 tail→step→stage-inner→group（新增 `PROCESS_STEP_CLASS` 常量）；删除 `createProcessToolsGroup`/`toolsIconMarkup`/`updateProcessToolsGroups`/`toolGroupStateKey`/`processToolGroupStateKey`/`processToolGroupDefaultExpanded`/`summarizeProcessTools`/`processToolsLabel`/`ProcessToolSummary`/`ProcessNodeSegment`/`splitConsecutiveProcessNodes` 与 `getCachedToolDisplaySettings` import。
  - `src/lib/i18n.ts`：en/zh 删 `processCommandsRan`/`processFilesEdited`/`processToolsCalled`/`expandProcessTools`/`collapseProcessTools`（保留 `processToolsFailedCount` 供 stage 用）；`toolDisplayModeDescription` 去掉「默认展开 Tool 调用」承诺。
  - `src/index.css`：清理全部 `.quickforge-process-tools-*` 规则（hover/focus-visible/chevron/icon/flex/grid 折叠动画/reduced-motion，约 17 处选择器组）。
  - 测试 4 文件：`process-folding.test.ts`（删 summarizeProcessTools 5 例、processToolGroup* 与 splitConsecutiveProcessNodes 断言；首段断言改 'stage'；补 errorCount 断言 + 失败计数新用例）、`process-folding-incremental.test.ts`（断言改 stage-body inner 的 step；新增组内不存在 `.quickforge-process-tools` 护栏）、`chat-surface-css-contract.test.ts`（字号契约删 tools-summary）、`chat-surface-api-key-dialog.test.ts`（文案断言改新值）。
  - `docs/wiki/src/components/README.md`（两份副本）+ `docs/wiki/src/lib/README.md`（tool-display-settings 条目）：三层结构描述改两层；`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 8 files / 212 passed（process-folding 系全部相关测试，exit 0）；全量 `npm run test` → **4467 passed + 4 failed**（4 处失败 = `tests/server/acp/server-channel-source` / `server.workspace-mapping` / `sqlite-quick-check-gate`，**git stash 后重跑同样失败，属主分支既有失败，与本轮无关**）；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**。
- Notes（只记录，不扩范围）：
  - a) 折叠默认值：顶层组 = `isAgentStreaming`（流式展开/历史收起）、stage 默认收起，saved state 优先——均未变；`toolDisplayMode`（简洁/详细）设置保留，仍控制单行摘要详细程度与 subagent 详情，只是不再控制折叠。
  - b) 工具组 saved state（`processKey:tools:*` 键）随层级删除自然失效，无迁移必要（内存 WeakMap，不入库）。
  - c) 待真机验收：普通回合展开「已执行 · Ns」后看到 stage 头「已执行 N 个工具调用」（收起）；点开 stage 直接见工具行；含失败工具时 stage 头带「· N 项失败」。
  - d) 主分支既有服务端测试失败 4 例（ACP channel/workspace-mapping/sqlite quick_check gate）已登记，不在本轮范围。

---

## 2026-09-22 · run_subagent 部分成果回传（工具调用清单 + 全量 assistant 正文回传主 agent）

- Goal：用户需求——subagent 内部停止（如网络故障）时，把 subagent 已经产生的 AI 回复正文给主 agent，让主 agent 知道内部行为、可基于部分成果续接或只重派剩余工作。方案经两轮过稿定稿：先做「部分成果回传」（不做自动重试，留后续 feature）；回传**不做条数/行数限制**（用户明确取消原提案的「正文取最后 2 条 / 工具清单 40 行」），全量回传；唯一截断是工具参数单行摘要化（200 字符，防 write_file 整文件回显成一行）。
- 改动文件：
  - `server/agent-subagent-runner.mjs`：新增部分成果报告纯 helper（`buildSubagentWorkReport` / `withSubagentWorkReport` / `collectSubagentToolCallLines` / `lastAssistantTextEntry` / `summarizeToolCallArgumentValue` + `SUBAGENT_TOOL_ARGS_SUMMARY_LIMIT=200`）；四路径接线——① 成功：content = 最终回复（既有行为）+ Work done 报告（工具调用清单 + 全量 assistant 正文，按索引跳过与最终回复重复的那条）；② 运行期失败（网络错误，此前只有纯上游原文、最大缺口）：错误正文 = 上游原文首行 + 报告（含 Still running when interrupted 行）；③ 超时 / ④ 父运行中止：既有错误首句（含进度摘要，逐字保留为前缀）+ 报告（不再重复 still running 行）。
  - `tests/server/agent-manager.subagents.test.mjs`：新增 2 用例（成功回传精确形态；失败 >800 字符正文全量不截断 + 2 条消息全量）；既有 2 处精确断言（超时 mid-tool :454 / 通用失败 :535）扩展为完整正文断言（首句前缀逐字保留）；空报告场景（messages: [] 的超时/中止用例）断言零改动通过。
  - `docs/wiki/server/README.md`（agent-subagent-runner 条目同步部分成果回传契约）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run tests/server/agent-manager.subagents.test.mjs tests/server/subagents.test.mjs` → **2 files / 21 passed（exit 0）**；前端契约回归 `subagent-run-detail + subagent-run-detail-react + error-messages + subagent-process-trace` → **4 files / 126 passed（exit 0，前端零改动验证去重/翻译契约不回归）**；`npx eslint` 两改动文件 → **exit 0**；`npx tsc -b` → **exit 0**。未跑全量 test/build（定向验证）。
- Notes（只记录，不扩范围）：
  - a) 既有契约保持：`omitDetailsForLlm` 不动（全量 messages 仍只进 details 不送 LLM）；前端 subagent trace 去重自洽（通用失败 trace 终态错误文本是 pi-agent-core handleRunFailure 在 prompt() 内快照的上游原文，早于 catch 里的 message 追加；错误卡仍显示可被 translateErrorMessage 翻译的干净首行，追加段经 toolResult output 块展示）。
  - b) 后续 feature（方案已与用户过稿）：A 层 subagent 瞬时网络错误自动重跑（挂 wrapSubagentToolDefinition catch，复用 pi-ai `isRetryableAssistantError` 分类，有界次数 + 退避）/ B 层主 agent 网络错误自动 continue 续跑 / C 层 UI 自动重试提示；部分成果回传与其互补（回传让重派可只做剩余工作）。
  - c) 本轮无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-22 · 修复排队消息切换 session 后不发送（后台自动续发 + 切回兜底）

- Goal：排队消息（流式中 Enter 入队）切换 session 后不发送、永久滞留 localStorage。根因：自动发送唯一触发是当前面板订阅的 agent_end（ChatPanelHost :1650-1663），切换 session 的 cleanup 只做「取消 250ms 定时器 + 在途条目回队首 + 存回 localStorage」并退订事件，切走后原会话回合结束无人 drain；切回只 hydrate 不补发。修复为后台自动续发 + 切回兜底（三处挂钩 + 共享 helper）。
- 改动文件：
  - `src/lib/message-queue-drainer.ts`（新建）：`drainStoredMessageQueue` / `pauseStoredMessageQueue` 共享 helper——基于 localStorage 顺序逐条发送、per-session 单飞防并发、成功删条目持久化（写前重读保留 prompt 期间新入队）、失败保队头置 paused、agent 流式中不抢发、永不抛错。
  - `src/hooks/useAgentManager.ts`：task 订阅 agent_end 且 `task.agent !== agentRef.current`（后台 task）时——非 aborted/error → `drainStoredMessageQueue` 后台续发；aborted/error → `pauseStoredMessageQueue` 暂停（主路径，覆盖「切走后回合结束」）。
  - `src/components/chat/ChatPanelHost.tsx`：① effect cleanup 在 saveStoredMessageQueueState 之后：队列非空未暂停且回合已结束（`!agent.state.isStreaming`）→ `drainStoredMessageQueue`（修「agent_end 已到但 250ms 定时器被 cleanup 取消」竞态）；② 挂载 hydrate 后：会话空闲 + 队列非空未暂停 + 无 timer/inFlight → 复用既有 250ms `submitQueuedPrompt` 调度（切回兜底）。
  - `tests/frontend/message-queue-drainer.test.ts`（新建 8 用例）：顺序发送逐条落盘 / 失败保队头暂停 / paused 不发 / 无状态与空 no-op / isStreaming 不动队列 / per-session 防并发返回同一 promise / pauseStoredMessageQueue 三种行为。
  - `tests/frontend/message-queue.test.ts`（+3 源码契约 it）：cleanup 的 drain 位于最后一次 cleanup save 之后的 indexOf/lastIndexOf 位置断言、hydrate 后切回兜底切片断言、useAgentManager 三字符串接线 + 后台 task 守卫断言；既有 17 个 it 零改动。
  - `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/hooks/README.md`、`feature_list.json`（新增 fix-queued-message-session-switch，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run message-queue-drainer + message-queue` → **2 files / 28 passed（exit 0）**；护栏 `app-domain-hooks + deferred-session-agent` → **20 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 5 改动文件 → **exit 0**；全量硬门禁 `npm run test` → **376 files / 4495 passed + 1 skipped（exit 0，既有 skipped）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（仅既有 chunk size 警告）。
- Notes（只记录，不扩范围）：
  - a) 既有语义零改动：aborted/error 暂停、失败回队头并暂停、300ms 防抖持久化、测试锁定字符串（`cancelQueuedPrompt()`/`restoreHead(queuedPromptInFlight)`）原样保留；当前查看会话仍由面板链路处理（避免双写）；侧边聊天/分享页队列禁用不变。
  - b) 已知边缘（记录不修）：agent_end 恰落在 setAgent 与 effect cleanup 之间的微窗口可能双发（概率极低，接受不修）。
  - c) 待真机验收：流式中 Enter 入队 → 切走 session，原会话回合结束后排队消息后台逐条自动发出；abort/出错回合后队列暂停（切回见暂停态）；切走瞬间回合已结束的场景消息也发出；切回空闲会话时兜底续发。
  - d) 本轮无 Git 操作（工作分支 fix/queued-message-session-switch）、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-22 · 发布准备 v2.2.0（版本递增 + 文档更新 + 全量验证 + 离线包）

- Goal：发布 2.2.0 小版本准备——版本递增 2.2.0、CHANGELOG/README 更新、全量验证通过、runtime/offline 离线包生成；Git commit/tag/push 由收尾流程完成。
- 改动文件：`package.json`、`package-lock.json`（版本 2.2.0）；`CHANGELOG.md`（新增 [2.2.0] 节）；`README.md`（版本文案）；`feature_list.json`（新增 release-v2.2.0，done）、`progress.md`、`session-handoff.md`。
- 验证：`npm run test` → **375 files / 4484 passed（exit 0）**；`npm run lint` → **0 errors / 0 warnings（exit 0）**；`npm run build` → **exit 0**；离线包 `package-offline/shawnstack-quickforge-2.2.0.tgz` 已生成。
- Notes（只记录，不扩范围）：
  - a) 原有 flaky 测试条目（`tests/server/scheduled-tasks.commands.test.mjs` 偶发超时）与各轮真机验收条目保留在下方历史记录 Notes 中，未删除。
  - b) 本轮未手工触碰 dist/、package-dist/、package-offline/（离线包为发布脚本生成产物）；无依赖升级；docs/wiki 未动（纯版本发布，不改模块职责/公共入口）。

---

## 2026-09-21 · 修复运行中点击「思考过程」文字无法展开（thinking header pointerdown 优先 + 装饰幂等 no-op）

- Goal：流式（运行中）状态下点击思考块 header 的「思考过程」文字无法展开思考块。根因：`decorateProcessThinkingBlocks` 在流式期间每帧重跑，其写路径每帧重写 `label.textContent`（销毁重建文本节点）并 prepend/append 重排 header 子级，与点击事件派发竞态——click 的目标节点被重建/搬移，React onClick 打不上。
- 改动文件：
  - `src/components/chat/surface/ThinkingBlock.tsx`：header 按钮新增 `onPointerDown` 切换（不 preventDefault，保留原生 focus 等默认行为）；`onClick` 改为 `e.detail > 0` 时 return（真实鼠标 pointerdown 之后重复派发的 click，已由 pointerdown 处理）、`detail === 0` 时切换（键盘 Enter/Space 或程序触发）——对齐 `process-folding.ts` `shouldToggleProcessSummary` 的 pointerdown 优先先例。
  - `src/components/chat/panel-decoration/process-folding.ts`：`decorateProcessThinkingBlocks` 幂等化——header 已接管（`quickforge-process-thinking-header`）、icon/label/chevron 三槽位类名就位、label 文案一致（`t('processThinking')`）且子级顺序已是 `[icon, label, chevron]` 时短路 return，跳过全部 DOM 写操作，消除流式期间每帧 DOM churn；React 重渲染整体重写 chevron/label 的 class 属性后短路条件自然失效，回落完整接管路径恢复装饰状态。
  - `tests/frontend/thinking-header-adoption.test.ts`：新增幂等 no-op 用例（`is a full no-op on an already-adopted header (streaming reruns do not churn the DOM)`）。
  - `tests/frontend/thinking-block-interaction.test.ts`（新建，3 用例）：pointerdown 切换且不 preventDefault / pointerdown 后 click detail=1 不二次切换 / click detail=0 仍切换；沿用仓库「手写最小 fake 表面」约定（直调组件函数取 header props 事件处理器，经 React development 构建的 client internals 注入 useState 桩）。
  - `docs/wiki/src/components/README.md`（思考头接管契约条目两份副本补 pointerdown 优先 + 幂等 no-op 说明）、`docs/wiki/src/lib/README.md`（tool-display-settings 条目补交叉引用）、`feature_list.json`（新增 thinking-header-streaming-click-fix，done）、`session-handoff.md`。
- 验证：定向 `npx vitest run`（thinking / process 相关）→ **7 files / 132 passed（exit 0）**；`npx eslint` 改动文件 → **exit 0**；`npx tsc -b` → **exit 0**。未跑全量 test/build（定向验证）。
- Notes（只记录，不扩范围）：
  - a) `shouldToggleProcessSummary` 既有实现零改动（仅对齐其先例语义）；思考块默认收起、接管形态 `[icon, label, chevron]` 与 fail-visible 可见性契约（禁止 `.thinking-header` display:none）不变。
  - b) 待真机验收：运行中点击「思考过程」文字可展开/收起；header 聚焦时键盘 Enter/Space 可切换（detail=0 路径）；运行结束后点击同样正常。
  - c) 本轮无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-21 · 定时任务详情视图「最近执行」精简（与历史 tab 同规格，仅保留跳转）

- Goal：上轮历史 tab 已精简为紧凑行 + 「查看对话」跳转，任务详情视图「最近执行」仍是 <details>/<summary> 展开结构（展开体 renderRunDetails 渲染执行 Agent/warning/输入内容/AI 结果/错误信息/耗时大段字段），本轮同规格精简：每条 run 只保留紧凑信息（时间 + 状态 badge）+ 行尾「查看对话」icon-action 跳转按钮；会话里已能看到全部内容。
- 改动文件：
  - `src/components/scheduled-tasks/ScheduledTasksPage.tsx`（+18 -30）：① 详情视图「最近执行」由 `<details>/<summary>（时间·触发方式·状态）+ renderRunDetails 展开体` 改为紧凑行 `flex items-center justify-between rounded-lg bg-muted px-3 py-2`：左「formatDateTime(startedAt) + 状态 badge（statusBadgeClass/statusLabel）」、右「查看对话」icon-action 按钮；触发方式（manualRun/autoRun）与全部明细字段（执行 Agent/warning/inputContent/aiResult/errorMessage/durationMs）不再渲染。② 新增 `renderRunConversationAction(run)` 统一渲染函数，历史 tab 行尾按钮与详情视图 run 行共用（按钮 className/disabled/title/aria-label/onClick/MessageSquare icon 完全一致：有 sessionId enabled、无 sessionId disabled 灰 + t('runNoSession')，常驻渲染宽度稳定，onClick sessionId 守卫双保险）。③ `renderRunDetails` 无剩余调用点整体删除。详情视图其余部分零改动（返回按钮、标题/scheduleRule、状态/执行模式 badge、任务内容/任务信息网格、编辑入口、删除 danger 按钮、lastSessionId「查看对话」跳转）。
  - `src/lib/i18n.ts`：EN/ZH 成对删除 `runInputContent`（Sent to AI / 发送给 AI 的内容）与 `runAiResult`（AI result / AI 结果）——grep 确认仅被已删除的 renderRunDetails 引用；`executionAgent` 保留（详情视图任务信息网格引用）、`runDuration` 保留（历史 tab 表头引用）、`viewConversation`/`runNoSession` 保留（共用跳转按钮 + lastSessionId 按钮引用）。
  - `tests/frontend/scheduled-tasks-page.test.ts`（+39）：新增 describe「task detail recent executions」用例——states[4]=detailTaskId 进详情视图 + 两 run fixture（success 带 sessionId/agentLabel/inputContent/aiResult/durationMs、failed 带 errorMessage/warning）：断言 2 个 icon-action（aria-label viewConversation enabled + 点击 onOpenSession('session-a')；runNoSession disabled + 点击无副作用）、紧凑信息保留（recentExecutions/executionSuccess/taskFailed）、明细不出现（runInputContent/runAiResult/secret input/secret result/Agent X/boom/careful/12ms）、无 `<summary>` 节点护栏；上轮历史 tab 用例零改动通过（按钮改由共用函数渲染）。
  - `feature_list.json`（scheduled-tasks-history-compact-rows 条目追加第二轮）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/scheduled-tasks-page.test.ts` → **1 file / 20 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 三改动文件 → **exit 0**；`npm run test` → **374 files / 4480 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs flaky 本轮未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（ScheduledTasksPage chunk 41.73 kB，较上轮 42.77 kB 减小，仅既有 chunk size 警告）。
- Notes（只记录，不扩范围）：
  - a) `ScheduledTaskRun` 类型明细字段（inputContent/aiResult/errorMessage/warning/agentLabel/durationMs 等）保留——API 数据契约，历史 tab 耗时列仍消费 durationMs。
  - b) 详情视图任务级信息网格的「执行智能体」（t('executionAgent')，任务 agentId 维度）保留，本轮仅移除 run 维度明细。
  - c) 本轮无 Git 操作、无依赖变更，未手工触碰 dist/、package-dist/、package-offline/（dist 为 build 生成产物）；docs/wiki 未动（单页 UI 精简，不改模块职责/公共入口）。

---

## 2026-09-21 · 定时任务执行历史行精简（去展开详情，仅保留查看对话）

- Goal：用户反馈历史记录不需要展开看大段内容（执行 Agent/warning/输入/AI 结果/错误/耗时）——会话里已能看到全部内容，且跳转链路（预检+关闭设置页+不存在提示）上一轮已修好。精简历史 tab：行不可展开，行尾常驻「查看对话」icon 按钮；无 sessionId（如创建会话前失败的 run）时按钮禁用灰 + tooltip 提示。
- 改动文件：
  - `src/components/scheduled-tasks/ScheduledTasksPage.tsx`（+21 -11）：删除 `expandedRunId` state 与历史行整行 button 展开交互；历史行改普通 div grid（列结构不变 5 列 + 行尾新增 auto 第 6 列操作区）：MessageSquare size-4 `quickforge-settings-icon-action` 按钮，title/aria-label 有 sessionId 用 `t('viewConversation')`、无则切 `t('runNoSession')` 并 disabled（mcp-server-card builtin 删除按钮同模式，保证操作区宽度稳定）；onClick 内 sessionId 守卫双保险。`renderRunDetails` 保留（任务详情视图「最近执行」仍调用，保留不动），仅历史 tab 不再引用。
  - `src/lib/i18n.ts`：EN/ZH 同步新增 `runNoSession`（EN: No conversation for this run / ZH: 该次执行没有对话记录）紧邻 viewConversation。无删除 key：runInputContent/runAiResult/executionAgent/runDuration 均仍被 renderRunDetails（详情视图）引用，grep 逐个确认。
  - `tests/frontend/scheduled-tasks-page.test.ts`：`render()` helper 扩展可选 onOpenSession（既有调用零改动）；新增 1 用例：有 sessionId 按钮 enabled + aria-label=viewConversation + 点击 onOpenSession('session-a')；无 sessionId 按钮 disabled + aria-label=runNoSession + 点击无副作用；渲染文本不含 runInputContent/runAiResult/executionAgent/errorMessage 内容（展开详情移除护栏）。删除 state 后 useState 索引 20+ 位移，既有用例仅用索引 <20（0/1/2/4/7/11/12），零适配。
  - `feature_list.json`（新增 scheduled-tasks-history-compact-rows，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/scheduled-tasks-page.test.ts` → **1 file / 19 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 三改动文件 → **exit 0**；`npm run test` → **374 files / 4479 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs flaky 本轮未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（ScheduledTasksPage chunk 42.77 kB，仅既有 chunk size 警告）。
- Notes（只记录，不扩范围）：
  - a) 历史行保留 hover:bg-muted 视觉节奏（非交互但视觉与表头/行一致）；耗时保留为紧凑列（表头 runDuration），仅移除展开区里的「耗时：Nms」等大段字段。
  - b) 失败原因按最简处理：历史行不展示 errorMessage（状态 badge 失败红已表达；详情视图与对话内仍可见）。
  - c) 本轮无 Git 操作、无依赖变更，未手工触碰 dist/、package-dist/、package-offline/（dist 为 build 生成产物）；docs/wiki 未动（单页 UI 精简，不改模块职责/公共入口）。

---

## 2026-09-21 · 定时任务历史「查看对话」跳转完整体验（关闭设置页 + 不存在友好提示）

- Goal：定时任务执行历史的「查看对话」真正跳转到对话界面：会话存在时自动关闭设置页并加载会话；不存在时留在历史记录页友好提示（复用既有 sessionNotFound 文案）。此前链路事件与加载已存在，但设置页不关闭、不存在时静默无提示。
- 改动文件：
  - `src/lib/open-session-from-settings.ts`（新建，+36）：纯逻辑 `openSessionFromSettings(options)`，依赖注入回调（closeSettingsPage / scheduleSessionLoad / loadSession / onMissingSession）。流程：空 id return → `getAppStorage().sessions.getMetadata(id)` 预检（先例 ArchivedConversationsSettingsTab.tsx:119-122）→ null 则 onMissingSession + return（设置页保持打开）；预检抛错仅 logger.error 不阻断 → closeSettingsPage() → scheduleSessionLoad(id, wrapped)，wrapped 内 `await loadSession(id)`，false 时 onMissingSession 兜底（覆盖本地有元数据但服务端 restore 404），返回值透传供 cancelSessionTransition。
  - `src/App.tsx`（+27 -10）：新增 import openSessionFromSettings；`quickforge:open-session-from-settings` 事件监听由 handleToastClick 改为专用 `handleOpenSessionFromSettings`（useCallback，依赖 [closeSettingsPage, loadAgentSession, scheduleSessionLoad]，onMissingSession → `void showAlert(t('sessionNotFound'))`）；因依赖 closeSettingsPage（定义在其后），handler + useEffect 移至 closeSettingsPage 定义之后（hook 顺序静态一致）；handleToastClick 与 ToastContainer 点击路径零改动。系统通知点击（system-notifications.ts 同名事件 dispatch）同样受益。
  - `tests/frontend/open-session-from-settings.test.ts`（新建，5 用例）：App 组件测试基建过重（全仓库零 App 渲染测试），按预案抽纯函数测试；mock @/storage + logger（参照 system-notifications.test.ts 模式）。覆盖：空 id / 元数据 null（提示且不 close 不 load）/ 元数据存在（close + schedule + load 成功不提示）/ load 返回 false（兜底提示）/ 预检抛错（仍跳转）。
  - `feature_list.json`（新增 scheduled-tasks-open-session-jump，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/open-session-from-settings.test.ts` → **1 file / 5 passed（exit 0）**；`npm run test` → **374 files / 4478 passed + 1 skipped（exit 0，scheduled-tasks.commands.test.mjs flaky 本轮未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（仅既有 chunk size 警告）。
- Notes（只记录，不扩范围）：
  - a) closeSettingsPage 在设置页未开时调用无害：setSettingsDialogOpen(false)/setSettingsCustomProvider(undefined) 均为 useState setter 幂等（React bailout 不重渲染）；仅 needsModelSetup || !agentRef 时触发 activateConfiguredModel 兜底（与返回按钮关闭同行为）。
  - b) scheduleSessionLoad 在目标即当前会话时（beginSessionTransition 返回 undefined）直接 `void load()` 忽略返回值——该分支 false 时不会触发兜底提示，但当前会话必然存在，风险可忽略。
  - c) i18n 零新增（复用 sessionNotFound）；无 Git 操作、无依赖变更，未手工触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（新增小工具模块 + App 内部接线，不改模块职责/公共入口，docs/wiki/src/lib/README.md 未列该粒度）。

---

## 2026-09-21 · 定时任务设置页 UI 对齐 quickforge-settings 统一设计系统

- Goal：ScheduledTasksPage（设置 → 定时任务 tab，调研确认是仅存离群旧模式）从自制容器/pill tab/emerald switch/ui-Button 旧模式重构为 quickforge-settings-* 设计系统，与上一轮 MCP 设置页改造完全同构（基准 mcp-servers-dialog.tsx + mcp-server-card.tsx；辅助 AgentProfilesPage 可点击行+菜单先例、PluginsPage 加载/空态）。功能逻辑零改动。
- 改动文件：
  - `src/components/scheduled-tasks/ScheduledTasksPage.tsx`（+402 -397）：① 移除页面自建滚动容器（flex overflow-hidden + p-6 + max-w-5xl + 顶部 border-b header），根改为 fragment + 单 `section.quickforge-settings-section`（宿主 SettingsPanel 已包 stack，同 MCP）；② 列表/历史视图：toolbar（row-main：Clock 图标 size-4 text-primary + `t('scheduledTasks')` 标题 + `t('scheduledTasksDescription')`（既有 key）+ badge-muted `t('tasksCount')`；右侧 segmented 任务列表/执行历史双 tab（aria-pressed，切历史仍触发 loadHistory）+ primary Plus「新建任务」）；任务行 → `quickforge-settings-list-item`（cursor-pointer 点击进详情 + list-item-main：row-title/description/meta badge 行：状态 badge + scheduleRule mono + 上次/下次执行）+ list-item-actions；自制 emerald switch → `quickforge-settings-switch`（label+checkbox，保留 aria-label `taskEnabledSwitch`、pause/resume 调用与 disabled 条件）；Button ghost icon → `quickforge-settings-icon-action`（菜单定位逻辑不动）；空态 empty-row、错误 settings-alert warning-attached；③ 历史视图：筛选 → form-grid(sm:2/md:3 列) + form-row/form-label + settings-select/input×6；底部 quickforge-settings-row + row-control（重置 secondary | 查询 primary）；表格结构保留（grid 列、hover:bg-muted），状态 pill → badge 语义色，加载态 empty-row + Loader2 spin，分页 → button-secondary-compact + w-24 包装的 settings-select；④ 编辑/新建：toolbar（返回 secondary + row-main）+ fieldset disabled={loading}（测试契约保留）改 form-grid sm:grid-cols-2；AI 解析块 form-row + settings-textarea + button-secondary-compact（loading → Loader2）；追问 → settings-warning、解析成功卡 → settings-message、周重复 → segmented-option(-active)（保留 aria-pressed）、执行规则摘要 → settings-note、表单全量 settings-input/-select/-textarea(+mono)、启用开关 → settings-switch + form-label；底部 row + row-control（取消 secondary | 保存 primary + Loader2）；⑤ 详情视图：section + toolbar（返回 + 标题/scheduleRule + 状态/执行模式 badge）+ 正文 + 底部 row-control（查看对话/立即执行/编辑 secondary、删除 button-danger 仅 hover 红，disabled 条件逐字保留）；⑥ 杂项：`statusClass()` → `statusBadgeClass()`（enabled/success→success、running→info、paused→warning、failed→danger、completed→muted）；清零 emerald/blue/amber 自制配色与 bg-destructive/10；门户菜单图标 3.5→size-4；硬编码文案 '请求失败'→`t('requestFailed')`（既有）、'请补充任务信息。'→新 key、'cron：'→`t('taskCronExpression')`。所有 useState/useRef/useEffect 次序数量与 API/防抖/确认/分页逻辑逐字未动。
  - `src/lib/i18n.ts`：EN/ZH 同步新增 `taskNeedMoreInfo`（EN: Please provide more details about this task. / ZH: 请补充任务信息。）紧邻 aiParseTask；标题/描述复用既有 scheduledTasks/scheduledTasksDescription。
  - `tests/frontend/scheduled-tasks-page.test.ts`：仅 switch 用例适配——任务行开关由 `role='switch'` button 断言改为 `input[type=checkbox][aria-label=taskEnabledSwitch]` 的 disabled/onChange 断言（语义保留：仅 pending 任务禁用、两任务互不阻塞、POST×2）；Node 类型补 `checked`/`'aria-label'`；其余 17 用例（频率切换/AI 解析/防抖去重/删除确认/保留草稿等）零改动通过。
  - `feature_list.json`（新增 scheduled-tasks-ui-design-system-alignment，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run scheduled-tasks-page + scheduled-task-form + semantic-color-class-parity` → **3 files / 50 passed（exit 0）**；`npx tsc -b` → **exit 0**；`npx eslint` 三改动文件 → **exit 0**；`npm run test` → **373 files / 4473 passed + 1 skipped（exit 0，本轮 flaky 未复现）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（ScheduledTasksPage chunk 42.62 kB，仅既有 chunk size 警告）。
- Notes（只记录，不扩范围）：
  - a) scheduled-tasks/ 目录已核实仅 ScheduledTasksPage.tsx 一个文件，无嵌套子组件需对齐。
  - b) 无新增 CSS：全部复用既有 quickforge-settings-*（含上轮新增的 icon-action :disabled / :not(:disabled) hover 守卫）；semantic-color-class-parity 3 用例通过（无新增白名单外透明度语义色类）。
  - c) 历史记录保留 grid 表格结构（5 列信息密度优先，MCP 无表格先例）；周重复选择复用 segmented-option 形态（aria-pressed 保留），视觉由「边框方块」变为分段控件。
  - d) 本轮无 Git 操作、无依赖变更，未手工触碰 dist/、package-dist/、package-offline/（dist 为 build 生成产物）；docs/wiki 未动（UI 样式对齐，不改模块职责/公共入口）。

---

## 2026-09-21 · MCP 服务卡片：builtin 删除按钮禁用常驻 + 操作区图标对齐修复

- Goal：用户反馈两个问题——① 内置 Playwright 卡片与普通卡片操作区图标位置不对齐；② builtin 服务隐藏删除按钮导致布局错位。改为：所有卡片统一渲染删除按钮，builtin 时 disabled 灰色禁用不可点击（后端 409 builtin 删除保护不动）。
- 改动文件：
  - `src/components/mcp/mcp-server-card.tsx`：删除按钮由 `!server.builtin` 条件渲染改为无条件渲染（保留 `quickforge-settings-icon-action -danger` 类保证尺寸/外观一致），`disabled={server.builtin}` + aria-label/title 按 builtin 切换为新 key `t('mcpBuiltinNoDelete')`（普通服务仍 `t('delete')`）；onClick 保留、由原生 disabled 拦截（与既有重连按钮 `disabled={reconnecting}` 带 onClick 同模式）。对齐原理：list-item-actions 为 flex 0 0 auto 右对齐、宽度随内容变化，此前 builtin 少一个按钮导致各卡片编辑/删除图标 x 位置错位；删除按钮常驻（1.875rem 固定宽）后所有卡片操作区结构一致（重连仍按 canReconnect 状态渲染，语义不变）。meta badge 行（builtin 徽标+状态+工具数同 flex 行 gap 0.375rem）与图标统一 size-4 本已对齐，未改结构。
  - `src/index.css`：icon-action 规则就近新增 `.quickforge-settings-icon-action:disabled { cursor: not-allowed; opacity: 0.58; }`（沿用 `.quickforge-settings-button:disabled` 既有模式，未新增 CSS 类）；两条 hover 规则补 `:not(:disabled)` 守卫（禁用态无 hover 反馈，与 `.quickforge-settings-button-danger:not(:disabled):hover` 既有守卫一致；顺带修正 skills-dialog/hooks 等处已存在的 disabled icon-action 按钮误显 hover）。
  - `src/lib/i18n.ts`：EN/ZH 同步新增 `mcpBuiltinNoDelete`（EN: Built-in services cannot be deleted / ZH: 内置服务不可删除），紧邻 `mcpBuiltIn`。
  - `tests/frontend/mcp-server-card.test.ts`：builtin 用例从「删除按钮不存在」改为「存在但 disabled」（aria-label=mcpBuiltinNoDelete + `disabled=""`）；NodeProps 补 disabled；builtin handler 用例追加删除节点 disabled 断言；普通服务用例改为「删除按钮 enabled 且 handler 正常」（disabled 为 false、无 mcpBuiltinNoDelete 标签）。其余语义断言（builtin 徽标、启停/编辑/重连 handler、重连可见性、badge 语义色）保留。
  - `feature_list.json`（mcp-settings-ui-design-system-alignment 条目追加修复轮 + files 补 src/index.css）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run mcp-server-card + semantic-color-class-parity` → 2 files / 10 passed（exit 0）；`npm run test` → **373 files / 4473 passed + 1 skipped（exit 0）**；`npm run lint` → **exit 0**；`npm run build` → **exit 0**（3.33s，仅既有 chunk size 警告）。
- Notes（只记录，不扩范围）：
  - a) scheduled-tasks.commands.test.mjs 全量偶发超时 flaky 上轮已记录，本轮全量一次通过未复现，不重复展开。
  - b) 本轮无 Git 操作、无依赖变更，未手工触碰 dist/、package-dist/、package-offline/（dist 为 build 命令生成产物）；docs/wiki 未动（UI 细节修复，不改模块职责/公共入口）。

---

## 2026-09-21 · MCP 服务设置 UI 对齐 quickforge-settings 统一设计系统

- Goal：MCP 设置面板（McpServersPanel/McpServerCard/McpServerForm）从离群旧模式（自制 px-6 py-5 header、自制 Tailwind 卡片、emerald 开关、ui/Button ghost icon 按钮）重构为项目统一 quickforge-settings-* 设计系统，基准 CustomProvidersSettingsTab.tsx，功能全部保留。
- 改动文件：
  - `src/components/mcp-servers-dialog.tsx`：列表视图 → quickforge-settings-section + toolbar（Server 图标 size-4 text-primary 标题 + 描述 + badge-muted 计数；右侧 primary「添加服务」）；加载态 empty-row + Loader2、空态 empty-row、错误 settings-alert；编辑视图保留表单/JSON 双 tab（segmented 切换 + aria-pressed），底部 row + row-control（取消 secondary / 保存 primary）；不再内部重复 stack（宿主 SettingsPanel 已包）。所有 fetch/启停/重连/删除确认逻辑不变。
  - `src/components/mcp/mcp-server-card.tsx`：改为 list-item-main（title + mono description + meta badge 行 + error alert + 工具名 command-name chips）+ list-item-actions；emerald 开关 → quickforge-settings-switch（保留 aria-label mcpEnabledSwitchLabel 与启停 title）；自制 text-[11px] 徽标 → badge-*（connected→success、error→danger、connecting/disabled→muted、builtin→muted）；操作按钮 → icon-action（删除 -danger 变体，默认不红仅 hover 红）；builtin 隐藏删除、保留编辑/启停/重连。
  - `src/components/mcp/mcp-server-form.tsx`：labelClass/textareaClass 局部常量删除 → form-grid/form-row/form-label + settings-input/textarea(+mono)/select；transport 分支不变；标题行移除（编辑视图 toolbar 承载）。
  - `src/lib/i18n.ts`：EN/ZH 新增 mcpServersDescription、mcpServersCount 两 key，无硬编码文案。
  - `tests/frontend/mcp-server-card.test.ts`：适配新 DOM（switch 改 onChange、badge 类名、icon-action 断言），保留语义断言（builtin 徽标显示/删除隐藏、handler 触发、重连可见性），新增 badge 语义色映射用例。
- 验证：`npx vitest run mcp-server-card + semantic-color-class-parity` → 2 files / 10 passed；`npm run test` → 373 files / 4473 passed（exit 0）；`npm run lint` → exit 0；`npm run build` → exit 0。
- Notes（只记录，不扩范围）：
  - a) 前两次全量 `npm run test` 在 `tests/server/scheduled-tasks.commands.test.mjs` 偶发不同用例超时（vi.waitFor 10s 时序敏感），单跑该文件 24/24 通过、stash 全部工作区改动后及第三次全量均 373/373 通过——服务端时序 flaky，与本前端 UI 改动无关，未修（避免扩范围）。
  - b) `SettingsSwitch`（shared.tsx）未被采用，McpServerCard 直接用原生 label.quickforge-settings-switch 模式（与 PluginsPage/AgentProfilesPage 行内开关一致），并保留 input aria-label。
  - c) 本轮无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-21 · 移除 run_subagent 摘要卡运行时加载 icon（运行中隐藏状态区）

- Goal：外层 run_subagent 摘要卡（聊天流中，非 Inspector 详情）在运行中不再渲染加载 spinner（及耗时徽标）；运行态仍由 statusLabel 文案 + 跑马灯表达，与 DESIGN_LANGUAGE「运行状态保留文字说明」一致。
- 改动文件：
  - `src/lib/tool-renderers/subagent-tool-renderer.tsx`：`renderSubagentRunSummary` 第 51 行 `renderStatus(payload.status, payload.timing)` 改为 `{payload.status === 'running' ? null : renderStatus(payload.status, payload.timing)}`（+1 行注释说明），与 `local-workspace-tool-renderer.tsx:78` 既有模式完全一致。`shared.tsx` 的 renderStatus/renderStatusIcon 未动（其他工具渲染器共用）。
  - `tests/frontend/chat-surface-css-contract.test.ts`：subagent 摘要卡用例旁新增最小断言用例「hides the running status icon on the subagent run summary while the run is streaming」（pending=true：含 quickforge-subagent-tool、statusLabel span 非空（语言无关正则 `quickforge-subagent-label">[^<]+<`，该文件未固定语言快照回落 navigator.language）、不含 quickforge-tool-status-icon 与 animate-spin）。
  - `docs/wiki/src/lib/README.md`：subagent-tool-renderer 条目（:209）「运行期在标签与状态之间渲染跑马灯」改为「标签之后」+ 运行中隐藏状态区说明；`docs/wiki/src/components/README.md` 无相关描述未动。
  - `feature_list.json`（新增 subagent-summary-hide-running-status-icon，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run` chat-surface-render + chat-surface-css-contract + tool-renderer-registry + subagent-run-detail-react + local-tool-running-sweep → **5 files / 62 passed（exit 0）**；`npx eslint` 两改动文件 → **0 errors（exit 0）**。未跑全量 test/build（定向验证）。
- Notes（只记录，不扩范围）：
  - a) `chat-surface-render.test.ts:327` 的 pending 卡 `animate-spin` 断言核实走的是**默认工具卡** ToolStatusIcon（该测试 fakeAgent 未注册渲染器、tools:[]），与本次改动无关，未改。
  - b) 终态（done/error/called）状态区（icon+耗时）渲染不变；仅 running 隐藏。
  - c) 本轮无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-21 · 对话 tools（process 折叠组）展开/收缩动效平滑化

- Goal：对话 tools 过程折叠组（process-folding 三层：顶层过程组 / 内层 stage / 工具组）的展开/收缩由「display:none 直接切显隐」改为平滑高度过渡，动效平滑、避免闪烁。
- 改动文件：
  - `src/components/chat/panel-decoration/process-folding.ts`：新增 `quickforge-process-body-inner` 动画壳层——`PROCESS_BODY_INNER_CLASS` 常量 + `ensureProcessBodyInner(body)` 幂等 helper（body 已有 inner 直接返回）；`createProcessToolsGroup` / `createProcessStage` / `createProcessGroup` 三个 body 创建即挂 inner；`populateProcessContainer` / `populateProcessGroup`（step / stage 挂 inner）；`appendProcessToolSuffix` 增量路径校验链扩为 tail → inner → tools-body → group（且 inner 最后子节点为 tail，保证增量只 append 新行、已有行不搬动——防闪烁关键路径）；`updateProcessToolsGroups` 统计查询适配 inner 维度。release / restore 未动。
  - `src/index.css`：三个 body（`.quickforge-process-body` / `.quickforge-process-stage-body` / `.quickforge-process-tools-body`）由共享 flex 规则拆出改为 `display:grid; grid-template-rows:1fr`（先例 `.quickforge-assistant-artifact-card-details`，无需测量内容高度）；收起态 `[data-expanded="false"] > body` 为 0fr + `visibility:hidden` 延迟到收起动画结束后切换（0fr 区内按钮不可 Tab 聚焦）；展开走 `--quickforge-dur-base`（180ms）、收起用更快的 `--quickforge-dur-exit`（140ms）+ 同 ease-out token；inner 随高度 opacity 淡入淡出；`prefers-reduced-motion: reduce` 降级为无过渡；原三条 display:none 收起规则删除，旧版 `data-quickforge-process-folded` 兜底未动。
  - `tests/frontend/process-folding-incremental.test.ts`：断言改为 inner 维度 + 「body 直接子级只有 inner」护栏。
  - `feature_list.json`（新增 process-fold-grid-animation，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run` process-folding 三件套（process-folding / process-folding-ownership / process-folding-incremental）+ subagent-process-trace → **4 files / 76 passed（exit 0）**；chat-surface-tool-message + chat-surface-css-contract + thinking-header-adoption → **3 files / 39 passed（exit 0）**；message-actions → **45 passed（exit 0）**；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**。未跑全量 `npm run test`（定向验证）。
- Notes（只记录，不扩范围）：
  - a) process 折叠动效手感待真机验收（展开 180ms / 收起 140ms 时长与 ease 曲线观感）。
  - b) 本轮无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/（dist 为 build 命令生成产物）；docs/wiki 未动（装饰层动画实现细化，不改模块职责/公共入口）。

---

## 2026-09-21 · Hooks 执行记录持久化 + 分页（增强轮收尾）

- Goal：Hooks 执行记录由「内存 50 条、重启清空」升级为持久化 + 分页：store `hook-executions`（`storage/hook-executions.json`，文件根为纯 JSON 数组），内存 buffer 为权威读路径，上限 300 条（索引 0 最新，尾部裁最旧），启动 fail-open 加载 + push 后 3s 防抖（unref）落盘 + `stopHookEngine` flush；`GET /api/hooks/executions` 增 `limit`/`offset` 分页，返回 `{executions,total,limit,offset}` 信封（limit 默认 20、clamp 1–100；offset 默认 0；缺省/不可解析回落默认；越界 offset 空页但 total 不变）；前端 Hooks 页执行记录列表改 20 条/页分页（页码/总数摘要 + 上下翻页，mount 加载、失败重试保留当前页）。本轮为收尾核实：源码/测试/wiki/server 重启上轮已就绪但未报告，本会话逐项核实、补齐状态文件并跑全量验证。
- 改动文件（上轮已写入，本会话核实）：`server/storage.mjs`（rootArrayStores 支持，'hook-executions' 根数组独立读写分支）、`server/hooks/hook-engine.mjs`（持久化 + `getHookExecutionsPage` 分页器）、`server/routes/hooks.mjs`（limit/offset 透传）、`src/components/settings/tabs/HooksSettingsTab.tsx`（分页 UI）、`src/lib/i18n.ts`（previousPage/nextPage/页码摘要词条 en/zh）、`tests/server/hooks/hook-engine.test.mjs`（300 上限 / 加载裁剪 / 分页 clamp）、`tests/server/routes/hooks.test.mjs`（分页契约）、`tests/frontend/hooks-settings-tab.test.ts`、`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/lib/README.md`；本会话补：`feature_list.json`（hooks-agent-events 条目补记增强轮：approach/verification/boundaries/files +server/storage.mjs）、`progress.md`、`session-handoff.md`。
- 验证（本会话全量）：`npm run test` → **373 files / 4447 passed + 1 skipped（exit 0）**；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**（HooksSettingsTab chunk 25.80 kB，仅既有 chunk size 警告）。运行中 server：PID 55220（`node D:\quickforge\server\index.mjs`，2026-09-21 01:40:15 启动，晚于 hook-engine.mjs mtime 01:31:23 → 已加载新代码，无需重启）；实测 `curl "http://localhost:5176/api/hooks/executions?limit=5&offset=0"` → `{"executions":[],"total":0,"limit":5,"offset":0}` 信封契约 ✓（当前无执行记录，total 0 属通过）。
- Notes（只记录，不扩范围）：
  - a) 已知边界：`atomicUpdate` 暂不支持 root-array store（'hook-executions' 由引擎每次 flush 全量覆盖写）；新增 store 使通用 storage REST（/api/storage/*）顺带暴露 'hook-executions' 读写面（与 settings 等同权）。
  - b) 本轮无 Git 操作、无依赖变更，未手工触碰 dist/、package-dist/、package-offline/（dist 为 build 命令生成产物）。
  - c) 待真机验收：设置 → Hooks 页执行记录分页翻页/总数摘要/失败重试；配置命令 Hook（无副作用如 `node -e`）触发事件观察记录产生与重启后保留。

---

## 2026-09-20 · HooksSettingsTab 三项 UI 收敛：去总开关 / 去执行记录刷新按钮 / 说明文字收入 ? InfoTip

- Goal：按 DESIGN_LANGUAGE「辅助说明应收拢到 `?` 浮层」与用户决策，对 Hooks 设置页做三项收敛：① 移除「启用 Hooks」总开关行（schema/normalize/保存链路保留 `enabled` 字段，server 引擎继续依赖）；② 移除执行记录 RotateCw 手动刷新按钮（保留 mount GET 加载、失败重试与展开输出）；③ section 级平铺说明文字收进标题旁 InfoTip。
- 改动文件：`src/components/settings/tabs/HooksSettingsTab.tsx`：
  - ① 删除总开关行（含 `hooksEnabledDescription`）；组件移除 `enabled` state，persist 乐观回滚仅覆盖 hooks；所有保存调用 `persist({ enabled: true, hooks })` ——存量 `enabled=false` 在下次任意保存（增删改/启停）时重置为 true，server 端不因旧存量 false 而失效；load 时不再回填 enabled（不产生非必要写盘）。Hook 级开关/增删改/测试/执行记录行为不变。
  - ② 删除执行记录 header 的 RotateCw 刷新按钮（`hooksExecutionsRefresh`），`loadExecutions` 保留（mount 加载 + 失败 retry 按钮复用）。
  - ③ Hooks 标题旁新增 `<InfoTip label={t('hooksTabInfo')}>`（机制说明：事件触发→命令/Webhook、异步执行不影响会话），删除原平铺 `hooksTabDescription` 行；执行记录标题旁新增 `<InfoTip label={t('hooksExecutionsInfo')}>`（仅保留最近 50 条、服务重启后清空，与 server hook-engine 内存记录契约一致），删除平铺 `hooksExecutionsDescription`；空态一行文案（`hooksEmpty`/`hooksExecutionsEmpty`）与弹窗内操作提示（`hooksInsertVariable`）按设计语言保留。布局：header（自带 border-b）后直接接列表行（border-b 模式不变），与其它 tab 一致，无需 CSS 调整。
- `src/lib/i18n.ts`（en/zh 成对）：新增 `hooksTabInfo`、`hooksExecutionsInfo`；删除仅被移除 UI 引用的 `hooksEnabledDescription`、`hooksExecutionsRefresh`、`hooksExecutionsDescription`；`hooksTabDescription`（settings-tabs 工作区 header InfoTip 引用）、`hooksEnabled`（Hook 行开关 aria-label）、`refresh`（其它组件引用）保留。
- `tests/frontend/hooks-settings-tab.test.ts`：首个用例改为断言无总开关（SettingsSwitch 数量 = Hook 数）；总开关切换/回滚两用例改写为 Hook 级开关版本（payload 断言 `enabled: true`）；新增「存量 enabled=false 下次保存重置为 true」用例；执行记录失败重试用例改为 mount 即失败（不再依赖已删除的刷新按钮触发）。`tests/frontend/hooks-settings.test.ts`（normalize/保存链路保留 enabled 语义）零改动通过。
- 验证：`npx vitest run tests/frontend/hooks-settings-tab.test.ts tests/frontend/hooks-settings.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/semantic-color-class-parity.test.ts` → **4 files / 35 passed（exit 0）**；`npx tsc -b --pretty false` → **exit 0**；`npx eslint src/components/settings/tabs/HooksSettingsTab.tsx src/lib/i18n.ts` → **0 errors（exit 0）**。
- Notes（只记录，不扩范围）：
  - a) `docs/wiki/src/lib/README.md` Hooks 页描述仍含「总开关 / 可刷新」字样，属文档同步项，超出本轮授权路径（src/**、tests/frontend/**），待主会话决策更新。
  - b) 存量 `enabled=false` 的用户在未做任何保存前 hooks 仍不执行（沿用旧值），首次保存后强制回到 true——已在组件注释与测试中固化该语义。
  - c) 本轮无 Git 操作、无依赖变更，未触碰 dist/、package-dist/、package-offline/；server 端零改动。

---

## 2026-09-20 · HooksSettingsTab 样式对齐 DESIGN_LANGUAGE / 原型（10 项自评审清单修复）

- Goal：对 Hooks 设置页组件做样式自评审收敛，逐项对齐 DESIGN_LANGUAGE.md、设置页既有惯例与原型，不改行为逻辑与 aria 语义。
- 改动文件：`src/components/settings/tabs/HooksSettingsTab.tsx`（仅样式类名，10 项）：
  - ① 执行记录行间分割线 `var(--border)_54%` → `_78%`（与同页 hook 行 78% 对齐）。
  - ② hook 行首开关容器 `quickforge-settings-row-control`（min-width 11rem + justify-end 导致开关右推）→ 轻容器 `shrink-0 flex items-center`，开关紧贴行左缘（对齐原型与 CustomProvidersSettingsTab 列表行）；aria-label 关联不变。
  - ③ 9 处散落的 `duration-150` / 无时长 `transition-colors` / `transition-[background-color,border-color,color]`（L492/509/590/598/650/701/706/770/775）统一补 `duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]`（settings 系列 160ms ease-out 惯例）。
  - ④ 测试运行成功结果条：中性灰（muted 40% + text-muted-foreground）→ success 色系 `bg-[color-mix(in_oklab,#10b981_12%,transparent)] text-[color-mix(in_oklab,#047857_86%,var(--foreground))]`（精确对齐 index.css badge-success 配方；失败态保持 bg-destructive/10 + text-destructive 不变）。
  - ⑤ 9 处手搓表单标签 `text-[0.8125rem] font-medium` → 复用 `quickforge-settings-form-label`。
  - ⑥ 弹窗描述 `text-xs` → `text-[0.8125rem] text-muted-foreground`。
  - ⑦ 弹窗标题 `font-semibold`(600) → `font-[520]`（app 弹窗 520 惯例，对齐 skills-dialog/settings-row-title）。
  - ⑧ 执行记录行 hover 背景 muted 18% → 26%（与同页 quickforge-settings-row hover 一致）。
  - ⑨ 展开 output `<pre>` 与测试结果条（testError/testResult）新挂载补纯 opacity 淡入：复用既有 `quickforge-list-item-in` 类（base 180ms + ease-out token + prefers-reduced-motion 降级，无需 motion-safe 前缀）。
  - ⑩ 圆角对齐原型：output 块 rounded-lg → rounded-[0.625rem]；事件芯片容器 rounded-xl → rounded-[0.625rem]；变量芯片 rounded-md → rounded-lg。
- 验证：`npx vitest run tests/frontend/hooks-settings-tab.test.ts tests/frontend/hooks-settings.test.ts tests/frontend/semantic-color-class-parity.test.ts tests/frontend/settings-workspace-react.test.ts` → **4 files / 34 passed（exit 0）**（结构/类名调整未触及任何测试断言，无需改测试）；`npx tsc -b --pretty false` → **exit 0**；`npx eslint src/components/settings/tabs/HooksSettingsTab.tsx` → **0 errors（exit 0）**。
- Notes（只记录，不扩范围）：
  - a) 任务摘要中「success 文字 78% 左右」按权威来源 index.css badge-success 实际配方取 86%（`#047857 86%,var(--foreground)`），与 `.quickforge-settings-message` 一致。
  - b) 待真机 `npm run dev` 验收：hook 行开关位置、执行记录 hover/分割线、编辑弹窗标题/标签/事件芯片、测试结果条 success 绿色与淡入。
  - c) 本轮无 Git 操作、无依赖变更、未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（纯组件内样式类调整，不改模块职责/公共入口）。

---

## 2026-09-20 · Hooks 事件钩子：会话/工具事件触发命令或 Webhook（前后端实现 + 集成收尾）

- Goal：设置页新增「Hooks」：按 Agent 事件（agent_start / agent_end / tool_execution_start / tool_execution_end / tool_approval_required / error）自动执行本地命令或发送 Webhook；提供总开关、Hook 增删改/启停、编辑器内手动测试与最近执行记录列表。HTML 原型 `design-mockups/hooks-settings.html` → 前后端并行实现 → 本轮集成核对与收尾。
- 集成核对结论（收尾轮逐项核对前后端契约）：
  - ① `POST /api/hooks/test`：server 返回 `{ execution }` 信封，前端 runTest 原按裸 record 解析（测试结果会恒显示 timeout 标签、无耗时/输出）→ **修正前端**：`HooksSettingsTab.tsx` 改按信封解析并对缺失/非对象按请求失败处理；前端测试 mock 同步改为信封 + `event:'test'`。
  - ② `GET /api/hooks/executions`：server `{ executions }` 与前端解析一致 ✓。
  - ③ 存储键：双端均为 `'hooks-settings'`（server/hooks/hooks-settings.mjs 与 src/lib/hooks-settings.ts）✓。
  - ④ ExecutionRecord 字段：status 枚举 `success/error/timeout` 双端一致 ✓；`event` 类型对齐为 `HookEvent | 'test'`（手动测试记录的合成事件），执行日志事件标签查找处补 `'test'` 守卫。
  - ⑤ 刷新链路：前端 `saveHooksSettings` → `storage.settings.set` → `HttpStorageBackend.set` → `PUT /api/storage/settings/key/hooks-settings` → server `routes/storage.mjs`（`store === 'settings' && key === HOOKS_SETTINGS_KEY` 共享常量）→ `refreshHooksSettings()`（fail-open）✓。
  - ⑥ i18n：HooksSettingsTab + lib 全部 73 个 t()/标签 key 在 en/zh 成对存在 ✓。
- 改动文件（收尾轮）：
  - `src/components/settings/tabs/HooksSettingsTab.tsx`：runTest 信封解析；`event === 'test'` 守卫；8 处白名单外透明度语义色类（bg-muted/40 ×2、bg-muted/70、hover:bg-muted/60 ×2、hover:bg-muted/55 ×2、border-foreground/25、hover:border-foreground/20 ×2 共 10 条违规类）改为视觉等价 `color-mix(in_oklab,var(--x)_NN%,transparent)` 任意值写法。
  - `src/lib/hooks-settings.ts`：`HookExecutionRecord.event: HookEvent | 'test'`（附注释）。
  - `tests/frontend/hooks-settings-tab.test.ts`：测试端点 mock 改为 `{ execution: {...} }` 信封、`event: 'test'`。
  - 文档：`docs/wiki/server/README.md`（目录树 + `### hooks/ — Hooks 事件钩子` 小节）、`docs/wiki/server/routes/README.md`（表格行 + `## hooks.mjs` 小节）、`docs/wiki/src/lib/README.md`（hooks-settings.ts 表格条目 + 设置选项卡清单加 Hooks 与页面说明）。
  - `feature_list.json`（新增 hooks-agent-events，done）、`progress.md`、`session-handoff.md`。
  - （本 feature 前序轮已含：server/hooks/*、server/routes/hooks.mjs、server/index.mjs、server/routes/storage.mjs 接线；src/lib/hooks-settings.ts、HooksSettingsTab.tsx、settings-tabs.ts、react-settings-tabs.tsx、SettingsWorkspacePage.tsx、i18n.ts；五个测试文件；design-mockups/hooks-settings.html。）
- 验证：针对性 `npx vitest run tests/server/hooks tests/server/routes/hooks.test.mjs tests/frontend/hooks-settings.test.ts tests/frontend/hooks-settings-tab.test.ts tests/frontend/settings-workspace-react.test.ts` → **6 files / 59 passed（exit 0）**；全量 `npm run test` → **373 files / 4431 passed + 1 skipped（exit 0）**（首轮 1 失败：semantic-color-class-parity 报 HooksSettingsTab 白名单外档位，修正后定向 6 files / 51 passed、全量复跑通过）；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**（HooksSettingsTab chunk 25.29 kB，仅既有警告）。
- Notes（只记录，不扩范围）：
  - a) 遗留：执行记录仅内存 50 条不持久化（重启清空）；V1 无项目限定、无拦截语义（纯通知）；编辑 Modal 无完整 focus trap（Escape/外点关闭已有）。
  - b) 待真机 `npm run dev` 验收：设置 → Hooks 页面新增/编辑/测试/开关，观察执行记录。
  - c) 本轮无 Git 操作，无依赖变更，未触碰 package-dist/、package-offline/（dist/ 仅由 npm run build 生成）。

---



## 2026-09-20 · 修复：新添加项目行“新建对话”无反应（空白 deferred 会话误判复用）

- Goal：新添加项目后不刷新，点该项目行“新建对话”无反应。根因：startNewProjectChat（src/hooks/useChatActions.ts）的 reusableBlankSession 判断只比较 activeProjectRef（UI 选中态），不校验当前 DeferredSessionAgent 实际绑定的项目；添加项目流程只更新 activeProject 不替换 agent，旧项目的空白 deferred 会话被误判为可复用 → 静默 return 'reused'，不建会话；刷新后 bootstrap 重建 agent 与 activeProject 对齐所以正常。
- 改动文件：
  - `src/hooks/useChatActions.ts`：startNewProjectChat 的 reusableBlankSession 判断链在 `currentAgent instanceof DeferredSessionAgent` 分支之后增加 `currentAgent.project?.id === nextProject.id`（+1）。
  - `tests/frontend/project-new-chat-reuse-guard.test.ts`：新增 3 用例——源码契约（reusable 判断含 agent 项目绑定校验且位于 instanceof 之后）、行为（agent 绑定项目 B、activeProject 为 C → 'created' 且 startDeferredSession 收到项目 C、不触发 switchActiveProject）、复用保留（agent 与 activeProject 同为 C 的空白会话 → 'reused'）。
  - `feature_list.json`（新增 fix-project-new-chat-reuse，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/project-new-chat-reuse-guard.test.ts tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/deferred-session-agent.test.ts tests/frontend/workspace-inspector-tabs.test.ts` → 4 files / 34 passed（exit 0）；`npx tsc -b` → exit 0；`npx eslint`（两改动文件）→ exit 0。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 待真机 `npm run dev` 验收：添加新项目后不刷新，点该项目行“新建对话”应直接新建绑定该项目的空白会话；空白态下再次点击应复用（返回 reused 属正常）。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（单条件 bug 修复，不改模块职责/公共入口）。

---

## 2026-09-20 · 主聊天页：发送消息后用户消息锚定滚动到可视区顶部

- Goal：主聊天页发送消息后，最新用户消息滚动定位到可视区顶部（而非被新回复顶走）；回复增长期间稳在顶部，内容超过一屏后自然被推走，spacer 归零后退回现有贴底跟随；手动上滚不受影响。
- 改动文件：
  - `src/components/chat/scroll-sync.ts`：新增发送后锚定——最新 `.qf-user-message` 滚动定位到可视区顶部；消息列表末尾插入 spacer 补偿高度，回复流式增长期间随内容高度动态收缩，归零后退回现有贴底跟随；用户上滚时禁用跟随但保留 spacer；会话切换/卸载清理。
  - `src/components/chat/ChatPanelHost.tsx`：新增可选 prop `anchorSentUserMessage`（默认关闭）。
  - `src/App.tsx`：仅主聊天面板开启 `anchorSentUserMessage`；侧边聊天与分享页不传，行为不变。
  - `tests/frontend/scroll-sync.test.ts`：10 用例。
  - `feature_list.json`（新增 send-anchor-user-message-top，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/scroll-sync.test.ts` → 10 passed；`tests/frontend/chat-surface-behavior-alignment.test.ts` + `tests/frontend/scroll-to-bottom-button.test.ts` → 17 passed（护栏回归）；`npx tsc -b` → exit 0；eslint（改动文件）→ exit 0。未跑全量 test/build（小改动定向验证）。
- 微调（同 feature 内，真机验收反馈「锚定后消息顶部与上方标题区域贴得太近」）：`scroll-sync.ts` 新增模块常量 `ANCHOR_TOP_OFFSET = 12`，锚定目标 scrollTop = 消息顶部偏移 − 12px（clamp ≥ 0）；spacer 初始高度与动态收缩公式共用同一锚定目标值，所需垫高随边距自动调整（目标下移 12px 即少垫 12px），「内容底贴视口底时 scrollTop 恒等于锚定值」不变量保持。`tests/frontend/scroll-sync.test.ts` 期望值同步（初始 spacer 120→108px、收缩 80→56px、锚定位 900→888/380→368，新增 12px 边距断言语义）；定向验证 vitest 10 passed、`npx tsc -b` exit 0、eslint 改动文件 exit 0；`docs/wiki/src/components/README.md` scroll-sync 小节两份副本补「锚定位置留 12px 顶部边距」。feature_list.json 未动（同一 feature 内微调）。
- 修复（同 feature 内，偶发失效：发送后消息不在视口内，只读调研定位三类竞态）：① `enableWithAnchor()` 不再依赖固定双 rAF（scheduleAfterPaint 依赖移除）——调用时记录容器内已存在的最后一条 `.qf-user-message`，按帧 rAF 轮询等待出现「不同于发送前那条」的最后一条用户消息（发送前无任何用户消息则等第一条出现），找到后锚定；超时 1000ms（`ANCHOR_WAIT_TIMEOUT_MS`）回退 `enable()` 贴底并停止轮询（治 H2：React 提交晚于双 rAF 时锚错上一轮消息）；② 锚定跟随改为消息实时位置驱动——spacer 存活期（锚定激活态）每次 ResizeObserver 更新重导出：msgTopDoc = 消息 rect.top − 容器 rect.top + scrollTop，target = max(0, msgTopDoc − 12)，spacer = max(0, target + clientHeight − contentHeight)，spacer >0 写 scrollTop = target，归零即移除 spacer 退出锚定回贴底；目标消息 isConnected=false 时静默清理退出（治 H1/H3：锚定测量落在 fold 释放/重折叠过渡几何、视口钉死发送时 scrollTop 永不自愈）；③ `src/index.css` 给 `.qf-chat-panel > .qf-scroll-container` 加 `overflow-anchor: none`，关闭浏览器原生滚动锚定互扰。`tests/frontend/scroll-sync.test.ts` 锚定用例重写（10→14：新增晚于双 rAF 出现仍锚定 / 超时回退贴底 / 上方内容收缩展开 scrollTop 跟随（消息 top 恢复 12px）/ 节点移除清理不报错 / 连续 enableWithAnchor 重置锚定最新消息；既有用例按新机制调整期望），mock 改为按帧推进虚拟时钟（16ms/帧，驱动超时）+ 用户消息 rect 随 scrollTop 联动 + 可变消息列表。验证：`npx vitest run tests/frontend/scroll-sync.test.ts` → 14 passed；护栏 chat-surface-behavior-alignment + scroll-to-bottom-button → 17 passed；CSS 契约（chat-surface-css-contract + chat-compact-controls）→ 37 passed；`npx tsc -b` exit 0；eslint（scroll-sync.ts + 测试）exit 0。`docs/wiki/src/components/README.md` scroll-sync 小节两份副本机制描述同步（322→391 行）。feature_list.json 未动（同 feature 缺陷修复）。
- Notes（只记录，不扩范围）：
  - a) 待真机 `npm run dev` 验收：主聊天页发送后用户消息应出现在可视区顶部、回复增长期间稳在顶部、超过一屏后自然被推走、手动上滚不受影响。
  - b) 侧边聊天/分享页回归确认行为不变。
  - c) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（滚动行为微调，不改模块职责/公共入口）。

---

## 2026-09-20 · todo_write 工具卡展开显示结构化任务列表

- Goal：todo_write 工具卡展开体由 JSON-only 改为结构化任务列表（状态图标 + 文本），并修复 compact 模式展开为空的问题。
- 改动文件：
  - `src/lib/tool-renderers/todo-write-tool-renderer.tsx`：展开体插入结构化任务列表 `ul.quickforge-todo-history-list`，li 含状态图标（in_progress 半填充圆 / completed 实心勾 / pending 空心圆）+ sr-only 状态文本 + content；compact 模式同样渲染（修复展开为空）；snapshot 空回退 JSON-only；>5 项滚动容器 max-height 7.5rem。
  - `src/index.css`：新增 `.quickforge-todo-history-*` 系列——text-xs 走既有字号契约 `calc(var(--quickforge-message-font-size,14px)*0.8)`；in_progress 半填充圆 + accent color-mix 配方（与聊天胶囊一致）；completed 实心勾 emerald（light `rgb(4 143 101)` / dark `rgb(110 231 183)`）+ 弱化 + line-through；pending 空心圆；hover color-mix muted 55%（无位移、无边框、无阴影）；SVG mask 模块级 id 计数器防多卡串扰。
  - `tests/frontend/todo-write-renderer.test.ts`：新增 2 用例共 10（结构化列表断言 + CSS 配方断言，保留原 not.toContain 断言）。
  - `design-mockups/todo-tool-card-structured.html`（新增设计稿）。
  - `feature_list.json`（新增 todo-tool-card-structured-list，done）、`progress.md`、`session-handoff.md`。
- 设计决策：in_progress 采用半填充圆 + accent（与聊天胶囊一致，用户拍板）；不加进度条；类名 quickforge-todo-history-list 避开测试禁用的 quickforge-todo-summary-list。
- 验证：`npx vitest run tests/frontend/todo-write-renderer.test.ts` → 10 passed；`tests/frontend/todo-write-summary.test.ts` → 24 passed；相邻 CSS 契约测试 → 142 passed；`npx tsc -b` → exit 0；`npx eslint`（改动文件）→ exit 0；全量 `npm run test` → **367 files / 4374 passed + 1 skipped（exit 0）**。未跑 npm run build。
- Notes（只记录，不扩范围）：
  - a) 待真机验收：`npm run dev` 下查看工具卡展开三态视觉、hover、>5 项滚动、暗色主题 completed 色。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（单工具卡展开体渲染变更，不改模块职责/公共入口）。

---

## 2026-09-20 · 主结构分割线强度统一加深 34% → 60%

- Goal：用户反馈「线颜色不够深」（浅色主题 --border oklch(0.922) 偏亮，34% 混透明太淡）。DESIGN_LANGUAGE.md 要求主结构分割线统一强度，因此全组同步 34% → 60%，并统一设置 header 底线宽度为 1px。
- 改动文件：
  - `src/App.tsx`：:1989 对话区 `<main>` md:border-l/t 颜色类、:1991 对话 header `border-b` 颜色类 → `color-mix(in_oklab,var(--border)_60%,transparent)`（各 +1 -1）。
  - `src/components/sidebar/ChatSidebar.tsx`：:1927 footer `border-t` 颜色类 → 60%（+1 -1）。
  - `src/components/settings/SettingsWorkspacePage.tsx`：:148 设置区 `<main>` 颜色类 → 60%；:149 设置 header 颜色类 → 60% 且 `border-b-[0.5px]` → `border-b`（1px，与对话 header 宽度统一）。
  - `DESIGN_LANGUAGE.md`：「分割线要统一」小节补充当前统一配方（1px + `color-mix(in_oklab,var(--border)_60%,transparent)`）与全组同步原则（+2）。
  - `feature_list.json`（sidebar-main-divider-1px 追加第四轮，files 补 DESIGN_LANGUAGE.md）、`progress.md`、`session-handoff.md`。
- 保留清单（非主结构线，一律不动）：App.tsx:2230 检查器 w-px 分隔（30% + `var(--quickforge-sidebar-bg)` 混色，刻意融入侧边栏背景）；WorkspaceInspector.tsx（1285 header border-b 34%、1303/1472/1778 弹层菜单边框 34%、1351 菜单内分割线 34%、1556 卡片边框 34%、1665 border-l-[0.5px] 34%、1686 标签边框 34%、385 弹层 38%）；WorkspaceInlineDiffPreview.tsx:162/167/171/175/179/183/187 内部细线 34%；WorkspaceChangesList.tsx:177 34%；WebPreviewContent.tsx:229 34%；ProjectOpenMenu.tsx:80/109（38%）、:97（34%）；GitToolsPinnedSummary.tsx:976/1064（38%）；GitGraphDialog.tsx:89/103-107/127/138/139/142（34%，0.5px 表格线）；GitCommitPushDialog.tsx:323（34%）；GitBranchMenu.tsx:104/120/162（34%，0.5px）；AttachmentPreview.tsx:463（35% 表格线）。
- 验证：`npx tsc --noEmit` → exit 0；`npx eslint src/App.tsx src/components/sidebar/ChatSidebar.tsx src/components/settings/SettingsWorkspacePage.tsx` → exit 0；`npx vitest run` 12 个 sidebar/settings/app 相关前端测试（sidebar-new-chat-routing / sidebar-section-header-hit-area / sidebar-section-order / sidebar-session-action-alignment / sidebar-session-display-limit / sidebar-session-sort-mode / settings-workspace-react / settings-react-infrastructure / app-domain-hooks / app-settings-cache / use-app-bootstrap-migration / use-app-bootstrap-snapshot）→ 12 files / 111 passed（exit 0）。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认 light/dark 两模式下 60% 强度适宜（浅色主题下足够可见、dark 模式不过重）待用户验收。
  - b) 其余 34%/35%/38% 内部细线是否跟随加深待用户另行决策，本轮未动（DESIGN_LANGUAGE.md 仅约束主结构分割线统一）。
  - c) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（纯样式微调，不改模块职责/公共入口）。

---

## 2026-09-20 · 设置页同步包裹圆角分割线（SettingsWorkspacePage main +3 类）

- Goal：用户确认设置页与对话区对齐——`src/components/settings/SettingsWorkspacePage.tsx` 设置区 `<main>`（约 :148）追加同款分割线，border 沿 `md:rounded-tl-2xl` 圆角轮廓包裹（与 App.tsx 对话区 main 写法完全一致）。
- 改动文件：
  - `src/components/settings/SettingsWorkspacePage.tsx`：仅 :148 一处 className 追加 `md:border-l md:border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)]`（+1 -1，其余类全部保留）；其 `<aside>`（:99）本就无 border-r，无需撤线。
  - `feature_list.json`（更新既有 sidebar-main-divider-1px 为三轮方案，files 补 SettingsWorkspacePage.tsx）、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc --noEmit` → exit 0；`npx eslint src/components/settings/SettingsWorkspacePage.tsx` → exit 0；`npx vitest run tests/frontend/settings-workspace-react.test.ts` → 1 file / 11 passed（exit 0，grep tests/ 唯一直接渲染该页面的测试）。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认设置页 light/dark 两模式下边线沿圆角包裹形态（与对话区一致）待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（纯样式微调，不改模块职责/公共入口）。

---

## 2026-09-20 · 主分割线改沿圆角包裹（main 上 md:border-l/t，侧边栏撤 border-r）

- Goal：上一轮 ChatSidebar `border-r`（1px）竖线无视对话区 `<main>` 的 `md:rounded-tl-2xl` 圆角贯穿到顶，圆角弧段处只剩颜色区分；改为分割线沿圆角轮廓包裹（左侧竖线 → 弧线绕过左上角 → 顶部横线），强度与其他主结构分割线一致（DESIGN_LANGUAGE.md）。
- 改动文件：
  - `src/App.tsx`：对话区 `<main>`（约 :1988-1990）className 追加 `md:border-l md:border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)]`——border-l/border-t 必须 md: 前缀（移动端无圆角不应出现线），颜色类无前缀（无 border-width 时不生效）；border 沿 `md:rounded-tl-2xl` 圆角绘制。
  - `src/components/sidebar/ChatSidebar.tsx`：根 `<aside>`（约 :1185）移除 `border-r` 与 `border-[color-mix(in_oklab,var(--border)_34%,transparent)]` 两类（撤掉竖线，避免与 main 左边框叠成双线），其余类全部保留。
  - `feature_list.json`（更新既有 sidebar-main-divider-1px 为最终方案，files 补 App.tsx）、`progress.md`、`session-handoff.md`。
- 设置页调查（仅报告不改）：`src/components/settings/SettingsWorkspacePage.tsx` 是同样模式——:99 `<aside>`（`hidden ... md:flex` 侧栏，**无 border-r**）+ :148 `<main>`（`md:rounded-tl-2xl`，**无 border-l/t**），当前两者之间没有任何分割线，仅靠 sidebar-bg 与 main-bg 颜色区分；若后续对齐本轮方案，同样在其 main 上加 `md:border-l md:border-t` + 同色配方即可（保持本次范围只改对话区）。
- 验证：`npx tsc --noEmit` → exit 0；`npx eslint src/App.tsx src/components/sidebar/ChatSidebar.tsx` → exit 0；`npx vitest run` 9 个 ChatSidebar 相关测试文件（mobile-fullscreen-adaptation / project-drag-boundary / motion-design / sidebar-new-chat-routing / sidebar-section-order / sidebar-session-action-alignment / sidebar-section-header-hit-area / project-row-hit-area / session-row-hit-area）→ 9 files / 79 passed（exit 0）；grep tests/ 无 `rounded-tl-2xl` / main 边框类断言（无需测试适配）。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认 light/dark 两模式下边线沿圆角包裹形态（左侧竖线 + 弧线 + 顶部横线连续、不断线不贯穿）、强度适宜待用户验收。
  - b) 设置页（同为 sidebar + rounded-tl main 模式）当前无分割线，是否对齐本轮方案待用户决策，未扩范围。
  - c) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（纯样式微调，不改模块职责/公共入口）。

---

## 2026-09-20 · 侧边栏与对话区主分割线改 1px 可见

- Goal：对话区与左侧对话历史侧边栏之间提供一条可见的浅色边界线。ChatSidebar.tsx 根 `<aside>`（约 :1185）右边框由 `border-r-[0.5px]` 改为 `border-r`（1px）——0.5px 亚像素在常见 DPR 下视觉不可见；颜色配方 `border-[color-mix(in_oklab,var(--border)_34%,transparent)]` 与其余类全部保留，与 App.tsx 对话区 header 底线（`border-b` 同配方 1px）统一主结构分割线强度（遵循 DESIGN_LANGUAGE.md）。
- 改动文件：
  - `src/components/sidebar/ChatSidebar.tsx`：仅 :1185 一处类名变更（border-r-[0.5px] → border-r），+1 -1。
  - `feature_list.json`（新增 sidebar-main-divider-1px，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx tsc --noEmit` → exit 0；`npx eslint src/components/sidebar/ChatSidebar.tsx` → exit 0；`npx vitest run` 9 个 ChatSidebar 相关测试文件（mobile-fullscreen-adaptation / project-drag-boundary / motion-design / sidebar-new-chat-routing / sidebar-section-order / sidebar-session-action-alignment / sidebar-section-header-hit-area / project-row-hit-area / session-row-hit-area）→ 9 files / 79 passed（exit 0）。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认 light/dark 两模式下 1px 分割线可见且强度适宜待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（纯样式微调，不改模块职责/公共入口）。

---

## 2026-09-20 · 任务胶囊默认收起，点击才展开

- Goal：聊天面板任务胶囊（todo-write-summary.ts，todo_write 工具快照摘要）默认收起，仅用户点击 toggle 才展开；保留「全部完成快照自动收起」与「用户手动展开/收起状态跨快照保留」既有契约。
- 改动文件：
  - `src/components/chat/panel-decoration/todo-write-summary.ts`：update() 内移除「首个含未完成项快照自动展开」分支（原 `if (isFirstSnapshot) expanded = counts.completed !== counts.total`），原 `else if` 提为独立 `if`——`if (counts.completed === counts.total) expanded = false` 统一适用所有快照；expanded 默认 false（:124）与 handleToggle 点击翻转（:159-162）不变。isFirstSnapshot 定义保留：仍被 :324 `if (isNewSnapshot && !isFirstSnapshot) showUpdatedMarker()` 使用（仅非首个新快照显示 updated 标记）。
  - `tests/frontend/todo-write-summary.test.ts`：6 处最小适配——① 首用例断言默认收起（aria-expanded 'false'、body.hidden true）+ 补点击展开 'true' 断言；② shell 重建用例（:294/:301）用户态断言翻转为 'true'（默认收起后单次点击即展开，仍验证用户态跨重建保留）；③ 编辑器移除用例（:314/:323）同翻转为 'true'；④ 「keeps the user collapsed after a new unfinished snapshot」用例改双击（展开→收起）建立用户收起态，后续断言不变；⑤ 空快照重置用例（:404）与 ⑥ 回滚用例（:417）新首快照断言 'true' → 'false'。「starts collapsed when the first snapshot is fully completed」「auto-collapses every fully completed snapshot」「self-heals ... preserves a manually expanded state」等用例语义不变，未动。
  - `feature_list.json`（新增 todo-capsule-default-collapsed，done）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → 2 files / 32 passed（exit 0）；`npx tsc -b` → exit 0；`npx eslint src/components/chat/panel-decoration/todo-write-summary.ts tests/frontend/todo-write-summary.test.ts` → exit 0。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认默认收起形态（新任务列表出现时胶囊收起、点击展开、全部完成自动收起、手动展开状态跨快照保留、updated 标记仅非首快照出现）待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（交互默认值微调，不改模块职责/公共入口）。

---

## 2026-09-20 · 聊天路径链接改 icon+basename、hover 显示全路径

- Goal：对话正文中本地文件路径链接（button.quickforge-file-path-link，panel-decoration/local-file-path-links.ts 生成）正文从「完整路径文本」改为「文件图标 + basename」，完整路径收进 title（hover 原生提示）与 aria-label；图标与工具卡摘要区（renderToolFileSummary 的 FileIcon）同源（fileIconUrl）。
- 改动文件：
  - `src/components/chat/panel-decoration/local-file-path-links.ts`：`createLocalFilePathLink` 改为 button.title=pathValue + append(img(fileIconUrl(pathValue), alt='', draggable=false, aria-hidden) , span(artifactFileName(pathValue)))；不再设置 textContent=pathValue；`dataset.quickforgeFilePath`、onclick、className、`t('openLocalFileWithPath', { path })` aria-label 不变。新增 import：`artifactFileName`（@/components/workspace/artifact-preview-utils）、`fileIconUrl`（@/components/workspace/file-icon-assets）。
  - `src/index.css`：`.quickforge-file-path-link` 改 `display:inline-flex; align-items:center; gap:0.25rem; vertical-align:baseline`；新增 `.quickforge-file-path-link img { width/height:0.875rem; flex-shrink:0 }`；蓝色（blue-600/blue-400）、underline、underline-offset 2px、hover color-mix 全部保留。
  - `tests/frontend/local-file-path-links.test.ts`：新增 `vi.mock('@/components/workspace/file-icon-assets')`（确定性前缀，避免加载 60 个 svg 资产）；FakeElement 补 src/alt/draggable 属性；新增 `linkParts` helper；首个用例断言升级为 title=完整路径、img.src/alt/draggable/aria-hidden、span.textContent=basename、按钮 textContent=basename、aria-label 保留；相对路径用例补 basename（反斜杠混用归一化）与 img.src 断言。
  - `tests/frontend/decorator-copy-i18n.test.ts`：移除 `t('openLocalFile')` 源码字面量断言，保留 `t('openLocalFileWithPath', { path: pathValue })`，新增 `button.title = pathValue` 断言。
  - `progress.md`、`session-handoff.md`。
- openLocalFile key 去留：grep src/tests/docs 仅 local-file-path-links.ts:48 一处消费（本轮移除）；按最小改动原则 i18n.ts 中 en/zh 词条保留不删（decorator-copy-i18n 的 en/zh 键对等用例继续通过），后续若有清理轮可一并删除。
- 验证：`npx vitest run tests/frontend/local-file-path-links.test.ts tests/frontend/decorator-copy-i18n.test.ts tests/frontend/message-actions.test.ts` → 3 files / 61 passed（exit 0，svg 资产经 message-actions 传递导入在 vitest 下正常解析）；`npm run lint` → 0 errors（exit 0）。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认链接形态（icon+basename 对齐基线、hover tooltip 全路径、下划线仅作用于 span 文本不划到图标）待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（视觉呈现变更，不改模块职责/公共入口；wiki 仅以 openLocalFile 为 i18n 词条示例，词条未删）。

---

## 2026-09-20 · 聊天文件路径链接改蓝色（light blue-600 / dark blue-400）

- Goal：对话正文中本地文件路径链接（button.quickforge-file-path-link，panel-decoration/local-file-path-links.ts 生成、点击经 App.tsx openLocalFilePathFromChat 打开阅读）由中性灰黑 var(--primary) 改为蓝色：light 模式 Tailwind v4 blue-600、dark 模式 blue-400；保留 underline、text-underline-offset 2px 与 hover 变淡效果。仅改 CSS 配色，不动匹配/生成/跳转逻辑。
- 改动文件：
  - `src/index.css`：`.quickforge-file-path-link` 新增 `--quickforge-file-path-link-color: oklch(0.546 0.245 262.881)`（blue-600）并作为 color；新增 `html.dark .quickforge-file-path-link` 覆盖变量为 `oklch(0.707 0.165 254.624)`（blue-400；html.dark 为文件既有 dark 作用域写法）；`:hover` 改 `color-mix(in oklab, var(--quickforge-file-path-link-color) 80%, transparent)`。
  - `feature_list.json`（新增 chat-file-path-link-blue，done）、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/decorator-copy-i18n.test.ts tests/frontend/message-actions.test.ts` → 2 files / 52 passed（exit 0）；`npm run lint` → 0 errors（exit 0）。grep tests/ 无 `.quickforge-file-path-link` 类名/CSS 颜色断言（无需改快照）。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认 light/dark 蓝色观感与 hover 变淡待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/；docs/wiki 未动（纯配色，不改模块职责/公共入口）。

---

## 2026-09-20 · 摘要区文件元素 hover 反馈微调：仅文件名下划线、不变色

- Goal：`renderToolFileSummary` 可点击（可预览）时 hover 行为从「整元素透明度变淡」改为「仅 basename 文本出现下划线」，颜色/透明度保持不变（遵循 DESIGN_LANGUAGE.md「hover 有感知、不跳动」，对齐 MarkdownReader 链接的 `underline-offset-4` 模式）。
- 改动文件：
  - `src/lib/tool-renderers/shared.tsx`：button class 移除 `transition-opacity hover:opacity-70`，改 `group cursor-pointer`（下划线经分组 hover 作用于文件名 span，图标不下划线）；文件名 span 增加 `underline-offset-4 group-hover:underline`；函数注释同步。
  - `tests/frontend/tool-renderer-file-icon.test.ts`：新增用例「signals clickability with a basename-only hover underline and no recolor」（button 含 `group`/`cursor-pointer`、不含 `hover:opacity`/`transition-opacity`/`hover:text-`；文件名 span 含 `group-hover:underline`；FileIcon 无 underline 类）。
  - `progress.md`、`session-handoff.md`。docs/wiki 与 feature_list.json 不动（纯样式微调，不改模块职责与公共入口）。
- 验证：`npx vitest run tests/frontend/tool-renderer-file-icon.test.ts` → 12/12；`npx tsc -b` → exit 0；`npx eslint src/lib/tool-renderers/shared.tsx tests/frontend/tool-renderer-file-icon.test.ts` → exit 0。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认 hover 下划线形态（仅文件名下划线、图标不变色）待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-20 · 工具卡摘要区文件图标：眼睛按钮去重 + read_file 纳入 + 绝对路径静态化

- Goal：本轮在「摘要区文件图标+文件名」基础上三项收尾——① `renderPreviewButton` 去重收窄：仅 present_files 渲染右侧眼睛按钮，write_file / edit_file 眼睛按钮移除（摘要区文件元素整体即预览入口，与文件名点击重复；present_files 为多文件摘要，保留独立按钮）；② read_file 摘要区纳入 `renderToolFileSummary`（FileIcon + basename，可预览时点击跳转阅读）；③ read_file 绝对路径 / `~` 路径一律静态不可点击。
- 改动文件：
  - `src/lib/tool-renderers/shared.tsx`：`renderPreviewButton` 非 present_files 直接返回 null；`renderToolFileSummary` 签名扩为 `'write_file' | 'edit_file' | 'read_file'`；新增 `isNonWorkspaceClickablePath`（`~`、`/`、`\`、盘符前缀）；`resolvePreviewableArtifact` 新增 read_file 分支——绝对 / `~` 路径返回 undefined。
  - `src/lib/tool-renderers/local-workspace-tool-renderer.tsx`：read_file 摘要同改 `renderToolFileSummary`。
  - `tests/frontend/tool-renderer-file-icon.test.ts`（重写 11 用例）。
  - 收尾轮：`docs/wiki/src/lib/README.md`（tool-renderers/shared.tsx 条目同步三工具覆盖 + renderPreviewButton 仅剩 present_files + 绝对路径静态化原因）、`feature_list.json`（tool-card-file-icon 条目同步）、`progress.md`、`session-handoff.md`。
- 绝对路径静态化取舍原因：预览链路（App.tsx openArtifactPreview → 工作区文件 API）只认工作区内路径，工作区外绝对路径被服务端 `isInside(workspaceRoot)` 边界 403 拒绝、`~` 前缀不展开；渲染层拿不到工作区根、无法区分「工作区内绝对路径」，故绝对路径一律静态（不猜路径展开）。
- 验证：`npx vitest run tests/frontend/tool-renderer-file-icon.test.ts` → 11/11；相关测试 26/26（含 local-tool-running-sweep）；`npx tsc -b` → exit 0；eslint 改动文件 0 问题。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认（FileIcon + basename 形态、title 完整路径、可预览点击跳转、绝对路径/~ 路径静态不可点击）待用户验收。
  - b) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-20 · 工具卡摘要区文件图标+文件名（用户澄清重构轮）

- Goal：按用户澄清重构上一轮实现——工具图标 `renderToolIcon` 保持不变；write_file / edit_file 摘要区改为文件元素（FileIcon + 仅 basename，title 显示完整路径；可预览时整体可点击跳转阅读）。
- 用户澄清：不替换 summary 行左侧工具图标；改为摘要区（工具名后「 · 」详情）显示文件类型图标 + 仅文件名。
- 改动文件：
  - `src/lib/tool-renderers/shared.tsx`：删除 `renderToolSummaryIcon`，新增导出 `renderToolFileSummary(toolName, params)`——write_file/edit_file 按 `params.path` 渲染 FileIcon（与工作区文件树统一）+ 仅 basename（`artifactFileName`，兼容 / 与 \\）的整体元素，hover title 显示完整路径；可预览时（`resolvePreviewableArtifact` 有值）渲染为 button，点击经 `previewArtifactClickHandler`（preventDefault + stopPropagation 阻断 summary 折叠后派发 `PREVIEW_ARTIFACT_EVENT` = quickforge:preview-artifact）交 App.tsx openArtifactPreview，与 `renderPreviewButton` 共用同一入口；不可预览时仅静态 span。
  - `src/lib/tool-renderers/local-workspace-tool-renderer.tsx`：summary 行保留 `renderToolIcon` 工具图标；write_file/edit_file 摘要文本改用 `renderToolFileSummary`，其余工具保持 `summarizeParams` 纯文本。
  - `tests/frontend/tool-renderer-file-icon.test.ts`（重写 8 用例）、`tests/frontend/local-tool-running-sweep.test.ts`（扫描标记恢复）。
  - 收尾轮：`docs/wiki/src/lib/README.md`（tool-renderers/shared.tsx 条目改 `renderToolFileSummary` 澄清后方案）、`feature_list.json`（tool-card-file-icon 条目同步）、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/tool-renderer-file-icon.test.ts` → 8/8；相关测试 26/26；`npx tsc -b` → exit 0；eslint 改动文件 0 问题。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认摘要区交互（FileIcon + basename 形态、title 完整路径、点击跳转预览、不可预览仅静态）待用户验收。
  - b) read_file 是否也加文件类型图标可后续评估。
  - c) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-20 · 工具卡文件图标 + 点击跳转阅读

- Goal：write_file / edit_file 工具卡 summary 行左侧图标替换为文件类型图标（FileIcon，按 params.path 解析），路径可预览时整枚图标可点击跳转阅读。
- 改动文件：
  - `src/lib/tool-renderers/shared.tsx`：新增导出 `renderToolSummaryIcon(toolName, params)`——write_file/edit_file 按 `params.path` 渲染 FileIcon（与工作区文件管理同源）；可预览时（`resolvePreviewableArtifact` 有值）渲染为 button，点击经 `previewArtifactClickHandler`（preventDefault + stopPropagation 阻断 summary 折叠后派发 `PREVIEW_ARTIFACT_EVENT` = quickforge:preview-artifact）交 App.tsx openArtifactPreview，与 `renderPreviewButton` 共用同一入口；不可预览时仅静态 span；其余工具与缺 path 场景回退 `renderToolIcon`。
  - `src/lib/tool-renderers/local-workspace-tool-renderer.tsx`：summary 行图标改用 `renderToolSummaryIcon`。
  - `tests/frontend/tool-renderer-file-icon.test.ts`（新增 6 用例）、`tests/frontend/local-tool-running-sweep.test.ts`（扫描标记同步）。
  - 收尾轮：`docs/wiki/src/lib/README.md`（tool-renderers/shared.tsx 条目补 `renderToolSummaryIcon` 描述）、`feature_list.json`（新增 tool-card-file-icon，done）、`progress.md`、`session-handoff.md`。
- 验证：新增测试 6/6、相关测试 26/26、`npx tsc -b`、eslint 全部 exit 0；`feature_list.json` JSON.parse 校验通过。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 真机确认点击跳转阅读交互（图标形态、预览打开、不可预览仅静态）待用户验收。
  - b) read_file 是否也加文件类型图标可后续评估。
  - c) 本轮无 Git 操作，无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---

## 2026-09-20 · 设置页搜索框移除

- Goal：移除设置界面顶部的搜索框及相关代码（桌面侧栏 + 移动端主菜单两处）。
- 改动文件：
  - `src/components/settings/SettingsWorkspacePage.tsx`：删除两处搜索框 JSX、`Search` 图标 import、`settingsSearchQuery` / `normalizedSettingsSearchQuery` / `filteredSettingsItems` / `visibleTabIndex` / `hasSettingsResults` 全部搜索状态与过滤联动逻辑、三处“无结果”占位；导航列表与内容区恢复 `settings.items` + `activeTabIndex` 原始语义；已访问 STATE_PRESERVING tab host 常驻挂载契约完整保留。
  - `src/lib/i18n.ts`：en/zh 成对删除 `searchSettings`、`noSettingsResults` 词条。
  - `tests/frontend/settings-workspace-react.test.ts`：删除 `search()` helper 与纯搜索用例；混合用例改写为"keeps visited persistent tab hosts mounted under the same key after switching tabs"（非搜索场景，保留常驻挂载/hidden/key 稳定性断言）。
- 未触碰：`src/index.css`（`.quickforge-settings-inline-field` / `.quickforge-settings-input` 为共享类，skills-dialog、ShareLinksSettingsPage、CustomProvidersSettingsTab 仍在用）；生成产物（`dist/`、`package-dist/`、`package-offline/`、android assets）按约束未手改。
- 验证：`npx vitest run tests/frontend/settings-workspace-react.test.ts` → 11 passed（exit 0）；`npx vitest run tests/frontend/decorator-copy-i18n.test.ts tests/frontend/settings-workspace-react.test.ts` → 18 passed（exit 0，en/zh 键对等通过）；`npx tsc -b` → exit 0；`npx eslint`（3 个改动文件）→ exit 0。未跑全量 test/build（小改动定向验证）。
- Notes（只记录，不扩范围）：
  - a) 生成产物中仍含旧搜索代码字符串，属构建产物，下次 build 自然更新。
  - b) DESIGN_LANGUAGE.md 与 docs/wiki 均未描述该搜索框，无需文档同步。
  - c) 本轮无 Git 操作，无依赖变更。
  - d) 发现仓库根未跟踪 0 字节异常名文件 `x[1])`（mtime 2026-09-14，历史命令转义事故遗留，非本轮产生），按不扩范围原则未删除，待用户决定。

---

## dependency-removal-parity-audit（done，2026-09-20 第二十三轮·依赖移除后的交互 Parity 审计与修复）

- 目标/结论：本轮为「依赖移除（`@earendil-works/pi-web-ui` / `@mariozechner/mini-lit` / `lit` → 自研 React）后的交互与 CSS 一致性评审 + 修复」，独立自洽报告 `docs/reviews/dependency-removal-interaction-parity-audit.zh-CN.md`（基线：`HEAD=6d845ca` React 化重构 vs `BASE=3e10f58` 仍含三依赖）。取证只用三件套：① `git show 3e10f58:<path>` 旧源码、② 只读旧构建产物 `package-dist/dist/assets/*`（= `package-offline/dist`，逐字节相同）、③ 当前工作区源码 + 新产物；不采信 `docs/reviews/` 既有报告结论。五域 155 条对照（一致 107 / 回归-已修 11 / 有意保留 30 / 不可考证 7），落地 **7 项修复**（7 源码 + 7 测试，`+939 / −135`）：① `renderConsoleBlock` 复刻旧 `<console-block>` 的复制入口（标题栏 `console` 标签 + `ConsoleCopyButton`；1500ms、`Copy output` 恒定 title、可见 `Copied!`、`data-qf-action="copy-console-output"`）；② 行中 `$$…$$` 恢复为块级公式（对齐旧 `blockMathDollar` 任意位置起块 + 内容不含 `$` + `.trim()`，按旧块级标记拆段输出）；③ 语法高亮 heading/list/code/quote/strong/emphasis/link 语义与 SVG 代码块 CSS 补回（+4 `--qf-hl-*` 变量、+6 高亮规则、+2 SVG 规则；故意不建 `--qf-hl-link`）；④ 自动滚动恢复 pi 内部 50/10 迟滞（`releaseFollowDistancePx` 50 / `repinFollowDistancePx` 10 + `markUserScrollUp` 距离门控）；⑤ 代码块标题栏复制文案改 `copyCode` / `copiedBang`（Copy code / Copied!、2000ms 恒定 title）；⑥ 高亮分桶对齐旧 hljs（`selector-class/-id` → `attr`、CSS 函数名 → `builtin`、YAML/JSON/TOML/INI 字面量 → `number`、Setext 标题 → `heading`）；⑦ 工具卡代码块复制反馈统一（title 恒 `copyCode` + 可见 `copiedBang` + 复制态尺寸配方）与 console 输出区 `ConsoleScrollArea` 每次 commit 置底（复刻旧 `.updated()`；不区分用户手动上滑的旧缺陷一并保留）。
- 改动文件清单（14 个：7 源码 + 7 测试，另有本轮报告与文档四件套）：
  - 源码：`src/components/chat/scroll-sync.ts`、`src/components/chat/surface/CodeBlock.tsx`、`src/index.css`、`src/lib/chat-math.ts`、`src/lib/code-highlight.ts`、`src/lib/i18n.ts`、`src/lib/tool-renderers/shared.tsx`
  - 测试：`tests/frontend/chat-code-block.test.ts`、`tests/frontend/chat-math.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`tests/frontend/code-highlight.test.ts`、`tests/frontend/scroll-sync.test.ts`、`tests/frontend/tool-renderer-code-block.test.ts`、`tests/frontend/tool-renderer-shared-state.test.ts`
  - 文档/状态：`docs/reviews/dependency-removal-interaction-parity-audit.zh-CN.md`（新增报告）、`docs/wiki/src/README.md`、`docs/wiki/src/components/README.md`（两份副本）、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`
- 验证结果：`npm run test` → **364 files passed / 4373 passed + 1 skipped**（exit 0）；`npm run lint` → **0 errors / 3 warnings**（3 条 warning 均在 `coverage/` 生成物，exit 0）；`npm run build` → **通过**（`tsc -b` 无诊断 + `vite build` ✓ 7836 modules / 2.36s，exit 0）。定向复核本轮 7 个测试文件 → `7 files / 169 passed`；`git diff --stat -- package.json package-lock.json` 空输出（无依赖变更）；`package-dist/`、`package-offline/` 未被写入。
- wiki 同步：`docs/wiki/src/README.md` 数学段落改述为「行中与行首 `$$…$$` 一样是块级公式」+ 保留旧约束与拆段形态；`docs/wiki/src/components/README.md` 两份副本同步（目录树 `CodeBlock.tsx` 条目的复制文案 → `copyCode`/`copiedBang`、Markdown 段的 2000ms/1200ms 两套文案区分与高亮 token 清单、新增「工具卡代码/命令输出复制反馈」段、i18n 段补 4 个新键）；`docs/wiki/src/lib/README.md` 的 tool-renderers 段补 console 复制入口（1500ms/恒定 title）与 `ConsoleScrollArea` 置底语义。
- Notes（遗留项，只记录不扩范围）：
  - a) **过程折叠默认值与早期 R10 用户要求冲突**：本轮按「移除前旧语义」保留（`processGroupDefaultExpanded(isAgentStreaming) = isAgentStreaming`、阶段层恒 false、工具组仅 detailed 展开），但本轮证据源中未取证到 R10 要求的原文 → 记为冲突项，**待用户裁决**（报告 §4 第 11 条）。
  - b) **Esc 中止为新增接线**：旧 pi 有 Escape 分支但 BASE 全仓未给 editor 赋 `onAbort`（旧为死代码）；新 `MessageEditor` → `ChatSurface` 已真实接线（`agent.abort()`），属旧缺陷修复，建议发布说明显式记录（报告 §4 第 2 条）。
  - c) **`ui/Input` 聚焦 ring 为可见变化**：旧 `focus-visible:border-primary` 在旧产物 0 命中（dead，`@theme` 无 `--color-primary`），新组合 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring` 真实可见，属有意补齐，与移除依赖前实际渲染不同（报告 §4 第 1 条）。
  - d) `docs/reviews/parity-audit-parts/` 分片目录已清理（本轮中间产物，未纳入版本控制）。
  - e) **真机浏览器实测未执行**：本轮全部结论基于源码 + 旧产物 + 单测级验证，报告 §6.1 按风险登记 6 项待复验（composer hover/active/聚焦、设置下拉键盘与定位、弹窗 Escape 与焦点恢复、三档复制反馈时长手感、自动滚动手感、console 输出区自动置底）。
  - f) 其余待裁 / 待取证：报告 §4 的 17 条有意保留差异（未注册语言不再 `highlightAuto`、Markdown 图片白名单与 `skipHtml`、附件解析上限、思考块 fail-visible、摘要行字号跟随消息字号、数字输入去重、消息窗口化仍 `enabled:false` 等）与不可考证 7 条；§6.2 另登记 7 条 W3/W10 未修语法分桶残留（嵌套围栏 `code`、`formula`、引用式链接定义 `symbol`/`link`、YAML `on`/`off`/`~`、TOML 字面量集合、各语言 `true/false/null` 关键字表、YAML 裸标量与 Setext 纯空白标题行）。
  - g) 既有缺陷（保持原样）：`quickforge-goal-spin` 定义缺失（BASE 前已缺）、console 输出区不区分用户手动上滑、单次点击触发 2 次非幂等 `abort()` POST、zh 下停止按钮 title/aria 仍为英文 `Stop`。
  - h) rebase 适配（2026-09-21，rebase 到 origin/ui 02e72b7 时发现的语义冲突，已随 cd62a84 amend）：50/10 迟滞仅适用于普通尾随；锚定模式（enableWithAnchor 的 anchorMessage 存活期）内用户上滑立即脱离跟随，否则距底恒≈0 的迟滞带会吞掉全部上滑、锚定校正与用户抢滚动位置（tests/frontend/scroll-sync.test.ts「keeps compensating the spacer without following after the user scrolls up」护栏）。
  - 本轮无 Git 操作（未 commit/tag/push），未手工修改 `dist/`、`package-dist/`、`package-offline/`（`dist/` 仅由 `npm run build` 正常产出）；无依赖变更。

---

## self-hosted-chat-ui（done，2026-09-20 第二十二轮·回归修复：send/stop 按钮装饰层 replaceSvg 替换 React 拥有的 svg 导致 removeChild NotFoundError）

- 目标/结论：feature 保持 done。修复用户报障（主聊天面板「出错了/重试/刷新页面」ErrorBoundary 兜底，与第二十一轮同症状不同根因）。症状：发送消息进入流式（isStreaming 翻转）瞬间整个聊天面板崩进 ErrorBoundary。真机取证：componentStack 逐帧 `svg → Button → MessageEditor (Fg) → ChatSurface → ChatPanelHost`，报错 removeChild NotFoundError。根因：`panel-decoration/send-stop-button.ts` 在 streaming 分支用 `replaceSvg`（`chat-utils.ts`，`oldSvg.replaceWith`）把 React 拥有的按钮内 lucide svg 物理替换为装饰层自建 svg；isStreaming 翻转时 React 按自己记录的子树卸载旧 svg，removeChild 找不到节点抛 NotFoundError。全仓仅此一处 replaceSvg 打在 React 拥有节点上。修复（方案 A'，用户授权）：① `MessageEditor.tsx` 发送分支删除 rotate(-45deg) wrapper div 与 lucide Send，直接内联渲染装饰层同款 arrow-up svg（viewBox 24、fill none、stroke currentColor、strokeWidth 2.4、linecap/linejoin round，path `M12 19V5` 与 `m5 12 7-7 7 7` 逐字符一致）；stop 分支删除 lucide Square，内联实心方块 svg（rect x=6 y=6 width=12 height=12 rx=2、fill currentColor）；两个 Button 的 className 分别挂 `quickforge-send-button` / `quickforge-stop-button` 基础 class（与 h-8 w-8 一起经 cn 合并，variant/size/disabled/title/onClick/onAbort 逻辑不动）。② `send-stop-button.ts` 改为纯状态装饰（不触碰 React 拥有的 DOM 结构）：删除两处 replaceSvg、rotate wrapper transform 清理、dataset.quickforgeSendIcon 幂等守卫、基础 class 的增删（基础 class 归 React，装饰层只 toggle `quickforge-stop-button--waiting` 等状态）；保留 disabled=false、title/aria 'Stop' 更新、capture 阶段 pointerdown+click stop handler（preventDefault + stopPropagation + stopImmediatePropagation + removeCommandSuggestions + abort）。非新能力；视觉零变化（同一 svg 字符串、同一 CSS 锚点，`index.css` 未动）。
- 改动文件：`src/components/chat/surface/MessageEditor.tsx`（两个按钮分支内联 svg + 基础 class）、`src/components/chat/panel-decoration/send-stop-button.ts`（改写为状态装饰）、`tests/frontend/send-stop-button.test.ts`（适配：删除 replaceSvg mock（模块已不引用）、删除 dataset 守卫断言、新增「never adds or removes the React-owned base classes」用例、恢复用例改为「drops the stop decoration」、stop handler 断言补 removeCommandSuggestions）、`tests/frontend/chat-surface-editor.test.ts`（新增「renders React-owned arrow-up / stop-square icons with the base classes」用例锁定两分支 svg path/rect 与基础 class 归属）+ 本轮文档（`progress.md`、`session-handoff.md`）。
- 验证：定向 `npx vitest run tests/frontend/send-stop-button.test.ts tests/frontend/chat-surface-editor.test.ts tests/frontend/chat-compact-controls.test.ts tests/frontend/composer-control-hover.test.ts` → **4 files / 38 passed（exit 0，send-stop-button 6 例、chat-surface-editor 17 例含新增 1 例）**；`npx tsc -b` → **exit 0**；`npm run lint` → **0 errors / 3 warnings（exit 0，均为 coverage/ 生成目录既有）**。
- Notes（只记录，不扩范围）：
  - a) 装饰层 stop 分支 title/aria 仍硬编码英文 'Stop'（React 层已是 t('stop') 本地化；装饰层覆写在非英文 locale 下会显示英文）。
  - b) 装饰层仍以 `rightControls` 的 `button:last-child` 锚定动作按钮，右侧控制行结构变化会静默失锚（脆弱但现状可用）。
  - c) wiki 未更新：`docs/wiki/src/components/README.md` 对 `send-stop-button.ts` 仅有目录级列举、未记录其图标替换行为，本次所有权收编后条目仍准确；`chat-utils.ts` 的 replaceSvg 描述（供其他装饰器使用）不变。
  - d) 真机复验建议：发送→流式→停止/终态往返数次，确认面板不再落 ErrorBoundary 且 send/stop 图标、等待环、hover 样式与修复前一致。
  - 本轮无 Git 操作，未触碰 dist/、package-dist/、package-offline/；无依赖变更。

---

## self-hosted-chat-ui（done，2026-09-20 第二十一轮·回归修复：流式终态翻转未释放过程组导致 removeChild NotFoundError）

- 目标/结论：feature 保持 done。修复用户报障（主聊天面板出现「出错了/重试/刷新页面」ErrorBoundary 兜底）。症状：agent 终态（agent_end / message_end / turn_end / abort / 404 轮询）时 React 删除流式容器（`.qf-streaming-message`）子树对已被 process-folding 搬进 `.quickforge-process-group` 的节点调 removeChild 抛 NotFoundError。根因：第十九轮 P0-B 的 `shouldReleaseProcessGroups` 门控只比较 messages 数组身份——终态事件可只翻转 `isStreaming` 或清空 `streamingMessage` 而 messages 身份不变（`readAgentSnapshot` 复用上一身份），门控跳过释放，React 随后卸载流式容器即踩所有权租约。修复（方案 A，最小改动）：门控扩展为 `ProcessGroupReleaseGate`（messages 身份 + `isStreaming` 翻转 + 流式行 presence 翻转——`streamingAssistant` 每帧浅拷贝出新对象，故比较 presence 而非对象身份），任一命中即释放；三者均未变的纯流式帧仍跳过（不回退第十九轮优化）；`MessageArea` 把既有 `isStreaming`/`streamingAssistant` props 透传给 `ProcessGroupReleaseBoundary`（新增同名 props），同步更新 ChatSurface.tsx 两处契约注释与 process-folding.ts 释放契约注释（补终态翻转例外）。非新能力。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`（`shouldReleaseProcessGroups` 改对象 gate 签名 + 新增 `ProcessGroupReleaseGate` 类型；boundary props 扩展 + `getSnapshotBeforeUpdate` 传 prevProps/this.props 整体比较；MessageArea JSX 透传两个新 props；两处契约注释更新）、`src/components/chat/panel-decoration/process-folding.ts`（仅 `releaseProcessGroups` doc 注释补终态翻转例外）、`tests/frontend/process-folding-ownership.test.ts`（改写「keeps the release decision identity-based」为对象 gate 断言 + 补终态翻转/presence 翻转/纯流式帧不释放断言；新增 `reactRemoveChild` fake（模拟 React removeChild 对非直接子节点抛 NotFoundError）与 3 个回归用例）+ 本轮文档（`progress.md`、`session-handoff.md`）。
- 验证：`npx tsc -b` → **exit 0**；定向 `npx vitest run tests/frontend/process-folding-ownership.test.ts tests/frontend/process-folding.test.ts tests/frontend/thinking-header-adoption.test.ts` → **3 files / 77 passed（exit 0，ownership 18 例含新增 3 例）**；相邻护栏 `npx vitest run tests/frontend/chat-surface-render.test.ts tests/frontend/chat-surface-message-list.test.ts tests/frontend/process-folding-incremental.test.ts` → **3 files / 38 passed（exit 0）**；`npm run lint` → **0 errors / 3 warnings（exit 0，均为 coverage/ 生成目录既有）**。
- Notes（只记录，不扩范围）：
  - a) 理论边缘场景未覆盖：`atTail` 翻转（流式容器挂载条件是 `isStreaming && atTail`）而窗口 messages 身份不变时门控仍会跳过——实际 atTail 变化几乎总伴随窗口重建（loadMore/showMessageIndex/resetToTail 均换新数组），本次未纳入 gate；若真机复现可再扩。
  - b) `docs/wiki/src/components/README.md` 两处 process-folding 所有权租约段落描述的「`getSnapshotBeforeUpdate` 调 `releaseProcessGroups`」整体契约不变（第十九轮引入的身份门控本就未写入 wiki），本次不更新 wiki。
  - c) 真机复验建议：复现原报障场景（流式中途 abort / 404 轮询翻转终态），确认主聊天面板不再落 ErrorBoundary。
  - 本轮无 Git 操作，未触碰 dist/、package-dist/、package-offline/；无依赖变更。

---

## self-hosted-chat-ui（done，2026-09-19 第二十轮·性能修复：subagent 工具行 spinner 闪烁修复）

- 目标/结论：feature 保持 done。修复 subagent 工具行 spinner 闪烁（工具运行中/结束时 spinner 重启、事件交错中间帧灰点闪一帧）。七组修复：① pending 工具行渲染所有权统一到 MessageList——`MessageList` 移除 `isStreaming` prop，pending 工具卡在 message_end 前后由消息列表持续渲染（同一 DOM 节点，跨容器迁移重挂消失），`ChatSurface` 流式容器内的 `AssistantMessage` 改传 `hidePendingToolCalls` 隐藏自己那份（不双行）；`SubagentRunDetailContent.tsx` 同步简化、`subagent-trace-structure.ts` 注释与镜像规则对齐。② 消息行 key 由 index 回退改为内容指纹——`content-parts.ts` 的 `messageRenderIdentity`（签名改单参）无 timestamp 时以首个有意义内容分块的有界前缀（64 字符）+ 附件 id 的 FNV-1a 指纹为身份，永不按数组位置（滑窗/全量替换不再重挂未触碰行），调用者同步更新。③ `ToolMessage` React.memo 化（R18 Notes ② 落地）。④ message_end 时无 toolResult 的 toolCallId 合成进 pendingToolCalls——`src/lib/tool-execution-events.ts` 新增纯函数 `toolCallIdsWithoutToolResult`，`shared-server-agent.ts` / `server-agent.ts` 的 event.message 分支接入，消除事件交错中间帧 pending=false 的灰点闪烁。⑤ `process-folding.ts` full 重建路径新增「纯工具后缀追加」增量分支（`appendProcessToolSuffix`）——结构变化但组仍存活时只搬新增行、已有行原地不动（避免重启其正在运行的 CSS keyframes），非纯后缀追加仍走全量重建兜底。⑥ `SubagentRunDetailContent.tsx` 的 pendingToolCalls Set 身份稳定化（`stablePendingToolCalls`：内容未变复用同一 Set 身份，不击穿 MessageList 下游 memo）。⑦ `src/lib/subagent-run-detail.ts` 的 `subagentRunPayloadFromToolEvent` 增加 `previousPayload`——running 帧缺 details 字段按字段回填上一载荷（事件自带值优先），消除 done→running 回跳。非新能力。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/MessageList.tsx`、`src/components/chat/surface/AssistantMessage.tsx`、`src/components/chat/surface/ToolMessage.tsx`、`src/components/chat/surface/content-parts.ts`、`src/components/chat/panel-decoration/process-folding.ts`、`src/components/workspace/SubagentRunDetailContent.tsx`、`src/components/workspace/subagent-trace-structure.ts`、`src/lib/tool-execution-events.ts`、`src/lib/subagent-run-detail.ts`、`src/lib/shared-server-agent.ts`、`src/lib/server-agent.ts`；测试：`tests/frontend/chat-surface-message-list.test.ts`（扩充）、`tests/frontend/chat-surface-render.test.ts`（扩充）、`tests/frontend/chat-surface-tool-message.test.ts`（扩充）、`tests/frontend/subagent-trace-flicker.test.ts`（扩充）、`tests/frontend/tool-pending-interleaved-frames.test.ts`（新增）、`tests/frontend/process-folding-incremental.test.ts`（新增）、`tests/frontend/subagent-run-detail.test.ts`（扩充）+ 本轮文档（`progress.md`、`session-handoff.md`、`feature_list.json`、`docs/wiki/src/components/README.md` 两处副本、`docs/wiki/src/lib/README.md`）。
- 验证：全量 `npm run test` → **363 files / 4334 passed + 1 skipped（exit 0，44.02s）**；`npm run lint` → **0 errors / 3 warnings（exit 0，21s）**（3 条 warning 均在 `coverage/` 生成产物，仓库既有）；`npm run build` → **exit 0（2.65s）**（仅既有 chunk 体积与 pi-ai node:fs externalize 警告）。修复前定向测试全绿（见 session-handoff.md）。
- Notes（只记录，不扩范围）：
  - a) `agent_end`/error 事件不清理 pendingToolCalls，异常终止时 spinner 可能残留（既有缺陷，本次未动）。
  - b) `server-agent.ts` message_end 的 messagesIncremental/全量 messages 分支未接入 pendingToolCalls 合成逻辑（本次只接了 event.message 分支）。
  - c) release 边界释放场景（messages identity 变化 / SubagentTrace 签名变化）仍走一次全量重建，但同帧完成且已有行不搬出文档；真机 keyframes 是否重启仍待确认（延续第十三轮 progress.md:93-96 待确认项）。
  - d) 行为权衡：流式期间工具卡不可见，出现在 message_end（原 streaming 容器渲染路径移除，由 MessageList 统一渲染）。
  - e) ToolMessage memo（R18 Notes ②）已解决。
  - f) R13 遗留②（结构变化重启 animate-*）已通过增量分支缓解。
  - 本轮无 Git 操作，未手工修改 dist/、package-dist/、package-offline/（dist 仅由 `npm run build` 正常产出）。

---

## self-hosted-chat-ui（done，2026-09-19 第十九轮·性能修复：轮次导航跳转卡顿第二轮——DOM/decorate 层根因）

- 目标/结论：feature 保持 done。修复轮次导航跳转卡顿第二轮（R2 轮）——DOM/decorate 层根因，四项修复：P0-A `process-folding.ts` decorateProcessBlocks 的 `canShortCircuit` 放宽为 `!isActiveTurn`（非流式指纹命中也 skip，消除每次跳转的全量 restore+refold）；P0-B `ChatSurface.tsx` `ProcessGroupReleaseBoundary` 新增 `shouldReleaseProcessGroups` 门控（messages identity 未变跳过全量 release，消除流式期间每帧 release→refold 振荡）；P1-A `turn-navigation.ts` `updateActiveFromScroll` 加 rAF 合帧 + 元素/ordinal 缓存；P1-B `message-actions.ts` `decorateMessages` 行级指纹短路 + `ensureMessageTime` 比较后写 + `getPrimaryMessageElements` 复用（3 次→1 次）。非新能力。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/turn-navigation.ts`、`src/components/chat/panel-decoration/message-actions.ts`；测试：`tests/frontend/process-folding.test.ts`（改写 2 例）、`tests/frontend/process-folding-ownership.test.ts`（新增 3 例）、`tests/frontend/turn-navigation.test.ts`（新增 3 例）、`tests/frontend/message-actions.test.ts`（新增 3 例）+ 本轮文档（`progress.md`、`session-handoff.md`、`feature_list.json`）。
- 验证：`npx tsc -b` → exit 0；`npx vitest run` 全量 **361 files / 4312 passed（exit 0）**；`npx eslint` 改动文件 **0 问题**。
- Notes（只记录，不扩范围）：① `tests/server/session-state-messages.test.mjs` 的「multi-process append CAS winner」用例在全量并发下偶发 flaky（时序敏感，单独重跑通过，与本次改动无关）；② 真机流畅度待用户验证；③ 备用后续项：流式 markdown 稳定段落拆分、ToolMessage memo、R3（agent_start 中断程序滚动）、R2（overflow-anchor）。本轮无 Git 操作，未触碰 dist/、package-dist/、package-offline/。

---

## self-hosted-chat-ui（done，2026-09-19 第十八轮·性能修复：轮次导航跳转卡顿——流式重渲染）

- 目标/结论：feature 保持 done。修复轮次导航跳转卡顿（R1）——流式期间每个 agent 事件都触发 ChatSurface 全量 React 提交（每事件新快照对象 → MessageArea 与全部消息行重渲染），smooth 滚动动画掉帧。三项修复：F1a `readAgentSnapshot(agent, previous?)` 快照身份复用——无可观察变化时复用上一快照的数组/集合身份并原样返回上一快照对象，`setSnapshot` 直接 bail out；F1b `UserMessage`/`AssistantMessage` 加 `memo`（已完成行只在自身消息对象被替换时重渲染），配套 `MessageList.tsx` 的 `toolResultsById` useMemo 化（每渲染新 Map 会击穿 memo 比较）；F1c `publishWindow` 跳过无可观察变化的窗口提交（`publishedWindowRef` 同时防同批次双提交）。非新能力。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`（F1a + F1c）、`src/components/chat/surface/UserMessage.tsx`（memo）、`src/components/chat/surface/AssistantMessage.tsx`（memo）、`src/components/chat/surface/MessageList.tsx`（toolResultsById useMemo 化）、`tests/frontend/chat-surface-render.test.ts`（新增 snapshot identity reuse 4 用例）+ 本轮文档（`progress.md`、`session-handoff.md`、`feature_list.json`）。
- 验证：`npx tsc -b` → exit 0；vitest 全量前端 2458 例通过；eslint 全过。真机轮次跳转流畅度需用户手动验证。
- Notes（只记录，不扩范围）：① F1a 依赖「ServerAgent 不原地变更已发布消息」的不可变 upsert 契约（原地变更会让复用身份静默丢更新；契约已在 `ChatSurface.tsx` 注释说明）；② `ToolMessage` 未 memo，可作后续优化项；③ R3（agent_start 中断程序滚动）与 R2（overflow-anchor）未修，待真机 profile 验证后决定优先级。本轮无 Git 操作，未触碰 dist/、package-dist/、package-offline/。

---

## self-hosted-chat-ui（done，2026-09-19 第十七轮·恢复 KaTeX 数学公式渲染）

- 目标/结论：恢复移除 pi-web-ui 时丢失的聊天数学公式渲染（用户授权，feature 保持 done）。只新增 1 个依赖 katex（devDependencies ^0.16.47，与 mermaid 传递依赖去重为单一 0.16.47 副本；不引入 remark-math/rehype-katex——不支持行内反斜杠圆括号定界符且美元规则与旧版不一致）。三段式自研：①`src/lib/chat-math.ts` preprocessLatexDelimiters 在进 react-markdown 前把 \(...\)/\[...\] 换成 QFMTHI/QFMTHB 十六进制占位 token（markdown 会把反斜杠当转义吃掉；LaTeX 存 token map；跳过 fenced（```/~~~ 围栏含长度与闭合匹配）、indented（行首 4 空格/tab）、inline code（同行反引号配对））；②rehypeQfMath rehype 插件把占位 token、行内 $...$、块级 $$...$$（行首锚定；行中 `a $$x$$ b` 保持字面量，旧版 parity）换成 qf-math 元素（跳过 code/pre 子树；行内护栏：内容不含 $ 与换行、开闭 $ 不双写、开 $ 后与闭 $ 前非空白——「价格 $5 和 $6 之间」不误渲染；仅含单个块级公式的段落被公式元素替换，避免 div 嵌 p）；③`src/components/chat/surface/KatexMath.tsx`（katex.renderToString：throwOnError:false、displayMode、output:'html' 对齐旧版；display 外层 my-4；异常回退红色等宽原文；React.memo；组件内 import katex/dist/katex.min.css，照 TerminalPane 引 xterm.css 先例）。
- 接线与构建：`Markdown.tsx` content 先过 preprocessLatexDelimiters，rehypePlugins 加 [rehypeQfMath, { tokens}]，components 加 'qf-math': KatexMath（自定义 tag 断言到 Components 类型）；`vite.config.ts` manualChunks 加 katex 分组（照既有分组先例，按模块 id 判断）；`src/index.css` 头部注释修订为「KaTeX 选择器已由组件内引入恢复」（未改任何样式规则）。
- 改动文件：package.json / package-lock.json（katex ^0.16.47）、src/lib/chat-math.ts（新增，纯 TS 可单测）、src/components/chat/surface/KatexMath.tsx（新增）、src/components/chat/surface/Markdown.tsx、vite.config.ts、src/index.css（仅注释）、tests/frontend/chat-math.test.ts（新增 8 用例：行内美元/独占段落双美元/反斜杠定界符占位 token/行中双美元字面量/fenced+indented+inline code 不渲染/货币不误渲染/katex-error 可见回退/组件 catch 回退）+ 本轮文档四件套。
- 验证：定向 `npx vitest run tests/frontend/chat-math.test.ts tests/frontend/chat-markdown-parity.test.ts tests/frontend/chat-surface-css-contract.test.ts` → **3 files / 38 passed（exit 0）**；相邻护栏 `npx vitest run tests/frontend/chat-surface-render.test.ts tests/frontend/chat-code-block.test.ts tests/frontend/chat-surface-behavior-alignment.test.ts tests/frontend/subagent-run-detail-react.test.ts` → **4 files / 67 passed（exit 0）**；`npm run lint` → **0 errors / 3 warnings（exit 0，均为 coverage/ 既有）**；`npm run build` → **exit 0**（仅既有 chunk 体积与 pi-ai node:fs externalize 警告），产物确认：katex 独立 chunk `dist/assets/katex-*.js`（259.24KB / gzip 77.49KB，由 ChatPanelHost 与 index chunk 引用、不进首屏主 chunk）+ `katex-*.css`（28.8KB）+ **59 个 KaTeX_*.woff2/woff/ttf 字体**。
- Notes：①`npm i -D katex` 默认解析到 0.18.7，会与 mermaid 的 ^0.16.45 形成双副本（lock 两条目 + 嵌套 node_modules），按任务书「提升 mermaid 传递依赖为直接依赖」意图改钉 ^0.16.45 档，npm 最终去重为单一 node_modules/katex@0.16.47；lock 相对会话前仅 katex 版本变化。②实测 katex 0.16：未知命令（如 \fracc）输出内联红字（无 katex-error class），语法错误（如 x^）才输出 katex-error——测试按实际输出断言。③已知局限：公式定界符在 rehype 阶段处理，公式内含 markdown 强调字符（* 等）可能被 markdown 语法拆分而不渲染（旧 marked 在源码层处理无此问题）；含 markdown 块级结构的公式同理。④未跑全量 `npm run test`（定向验证，符合项目规则）；未触碰 dist/（仅 build 正常产出）、package-dist/、package-offline/；无 git commit。

---

## self-hosted-chat-ui（done，2026-09-19 第十六轮·迁移缺口修复：SSE 流式正文 / 工具卡实时渲染）

- 目标/结论：修复 React ChatSurface 迁移留下的两个缺口（诊断已定位、用户确认都修），feature 保持 done。① 缺口 A（流式正文消失）：`src/lib/server-agent.ts` handleSseEvent 的 `message_update` 分支此前只 forwardWireEvent 转发、不写 `state.streamingMessage`（全文件 9 处对该字段均为 `= undefined`），React ChatSurface（readAgentSnapshot 依赖该字段）渲染不出流式正文；现对齐 `shared-server-agent.ts:404-406` 写入 `event.message`（缺省帧防御：不动现有流）。② 缺口 B（工具过程显示慢）：`src/components/chat/surface/ChatSurface.tsx` 的 SUBSCRIBED_EVENTS 白名单缺 `tool_execution_start/update/end`，导致 isSnapshotRefreshEvent 不触发 syncSnapshot、React 不重渲染，工具卡要等下一条 message 事件才出现；现已加入（ServerAgent 侧本就即时 upsert state.messages/pendingToolCalls 并转发）。
- 清理路径补齐：`message_end`（原有 4 个分支均不清理）与 `turn_end`（防御：无前置 message_end 的帧）现在都会将 `state.streamingMessage` 置回 undefined；`agent_end` 原有清理保持不变；`messages_replaced`、错误路径（prompt catch）、`reset()` 的既有清理未动。`noteSseEvent` 的 stateVersion 单调守卫在 handleSseEvent 入口处先行拦截过期帧，不影响新写入逻辑（新写入只发生在被接受的帧上）。
- 改动文件：`src/lib/server-agent.ts`（message_update 独立 case 写入 + message_end/turn_end 清理）、`src/components/chat/surface/ChatSurface.tsx`（SUBSCRIBED_EVENTS 增 3 个 tool_execution_* + 注释）、`tests/frontend/server-agent.test.ts`（新增 2 用例：message_update 写入/message_end+agent_end 清理/缺省帧防御；turn_end 无数据帧清理；并把原 :411 的 streamingMessage 断言升级为先经 SSE 帧置值再验证失败 prompt 路径清理）、`tests/frontend/chat-surface-render.test.ts`（新增 1 用例：tool_execution_* 触发 snapshot 刷新）。
- 验证：`npx vitest run tests/frontend/server-agent.test.ts tests/frontend/chat-surface-render.test.ts` → **2 files / 150 passed（exit 0）**；`npm run lint` → **0 errors / 3 warnings（exit 0，均为 coverage/ 生成目录既有）**；`npx tsc -b` → **exit 0**。未跑全量 test/build（小改动定向验证，符合项目规则）。
- Notes：无新问题发现。未触碰 dist/、package-dist/、package-offline/；无依赖变更；无 git commit。

---

## goal-workflow-test（goal 流程测试，2026-09-19，非 feature）

- 目标/结论：测试 goal 流程闭环（只读规划 → 自动执行 → 证据验收），非 feature 开发；`feature_list.json` 28 项全部 done，无新增/变更 feature 状态。会话启动上下文恢复完成：`docs/wiki/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npm run lint` → **退出码 0（0 errors，3 warnings 均位于 `coverage/` 生成产物，仓库既有）**。无代码改动，未运行 test/build。
- 改动文件：仅 `session-handoff.md`、`progress.md` 的本会话记录条目；无源码、依赖、生成产物改动。
- Notes：无。

---

## self-hosted-chat-ui（done，2026-09-19 第十五轮·一手证据复评 + 自修：语义色死类判据 / 折叠默认值 / 复制反馈 / API Key 探测 / 聚焦反馈）

- 目标/结论：feature 保持 done。本轮对「移除 pi-web-ui/mini-lit/lit 的迁移」做一手证据复评 + 自修（不采信前轮结论，基线为 HEAD `3e10f58` + 移除前构建产物 `package-dist/dist/assets/index-B1G0LqYR.css`）。评审报告：`docs/reviews/self-hosted-chat-ui-parity-recheck.zh-CN.md`。非新 feature。
- 决定性判据（判断「删除语义色透明度类」是否回归的唯一标准）：HEAD `3e10f58` 的 `src/index.css` **没有**语义色 `--color-*` 映射 → 源码自写的语义色透明度类（`text-foreground/90`、`hover:bg-muted/45`、`bg-border/70` …）在移除依赖前**不会被 Tailwind 生成**（dead，删除无视觉影响）；旧产物 `package-dist/dist/assets/index-B1G0LqYR.css` 的 `@layer utilities` 里真实存在的语义色工具类只有 **78 个**（`109` 处选择器）。工作区新增 `@theme inline` 全量映射后这些类会真实生效——第八轮用户反馈的「文字变淡」根因即在此，故新代码**不得**再使用白名单之外的透明度档位。护栏：新增 `tests/frontend/semantic-color-class-parity.test.ts` 固化该契约；**白名单变更前必须重新核对旧/新产物**。
- 自修清单（5 项）：
  - ① 折叠语义回退旧版：`src/components/chat/panel-decoration/process-folding.ts` 顶层过程组默认展开值 = `isAgentStreaming`（导出 `processGroupDefaultExpanded(isAgentStreaming)`）；内层阶段默认收起（`processStageDefaultExpanded()` 返回 false）；工具组默认展开值 = `toolDisplayMode === 'detailed'`（compact 默认收起，导出 `processToolGroupDefaultExpanded(mode)`）。saved state 仍优先；fail-visible 契约不变（不得对 `.thinking-header` 写 `display:none`）。
  - ② code-block 复制反馈：对齐旧 `copy-button` 的 `showText` 行为——复制后图标换 Check **并**显示可见文本（i18n `copied` / 已复制），`title` / `aria-label` 恒为 `copy`，2000ms 复位；新增导出组件 `CodeBlockCopyButton`（此前只有图标对勾，图标按钮上不构成反馈）。
  - ③ Markdown：链接无条件 `target="_blank" rel="noopener noreferrer"`（对齐旧 `<markdown-block>` 渲染器，不区分协议）；表格外包 `overflow-x-auto my-2 border border-border rounded`（对齐旧渲染器，宽表格横向滚动、不再撑破消息列）。
  - ④ API Key 对话框恢复「保存前探测」：本地 `custom-providers` 存储的该 provider 模型优先（保留 headers）、`/api/models/catalog` 兜底、两者都没有该 provider 模型时直接保存；探测失败**不写入** `providerKeys`、显示 `✗ Invalid` 且 5000ms 复位；请求中按钮显示 `Testing...` 并禁用；关闭后焦点恢复到打开前的元素。i18n 新增 key `apiKeyPromptInvalid`。
  - ⑤ `ui/Input` 聚焦反馈：由 dead 的 `focus-visible:border-primary` 改为白名单组合 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring`（性质为**有意补齐**：与移除依赖前的实际渲染不同——旧组合是死类，该输入框此前不渲染聚焦边框）。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`、`src/components/chat/surface/CodeBlock.tsx`、`src/components/chat/surface/Markdown.tsx`、`src/components/chat/surface/ApiKeyPromptDialog.tsx`、`src/components/ui/input.tsx`、`src/lib/i18n.ts`、`tests/frontend/semantic-color-class-parity.test.ts`（新增）等（实现细节以并行任务的落地为准）+ 本轮文档（`progress.md`、`session-handoff.md`、`feature_list.json`、`docs/wiki/src/README.md`、`docs/wiki/src/components/README.md` 两处副本、`docs/wiki/src/lib/README.md`）。
- 验证（2026-09-19 收尾轮一手）：全量 `npm run test` → **359 files / 4282 passed + 1 skipped（exit 0，45.08s）**；`npm run lint`（`eslint .`）→ **0 error / 3 warnings（exit 0）**，3 条 warning 均在 `coverage/` 生成产物（仓库既有）；`npm run build`（`tsc -b && vite build`）→ **exit 0**（2.64s；新产物 `dist/assets/index-CWWfUxx8.css`，327,333 B；仅既有 chunk 体积与 `node:fs` externalize 警告）。定向护栏/契约测试见评审报告 §6（5 文件 125 passed + `code-highlight.test.ts` 51 passed）。
- 构建产物核对（收尾轮一手）：白名单外 **20 个带透明度语义色类全部是「幽灵类」**——`src/**` 出现 0 次，字符串来源为 `coverage/**`（迁移前快照，最大来源）、`.goal-runtime-refactor-baseline/**`、`docs/**`（含报告自身）、`docs/archive/*`、`docs/wiki/**`、`feature_list.json`、`progress.md`、`session-handoff.md`、`DESIGN_LANGUAGE.md`、`design-mockups/**`、`tests/**`；无 DOM 使用 ⇒ **不影响真实渲染**（仅体积与核查噪音）。非透明度差集 5 条：`accent-foreground`/`accent-primary`（`accent-color` 工具类，非语义色用法）、`border-ring`/`ring-ring`（裸类无使用；`ring-ring` 的另一来源是仓库根垃圾文件 `0)n++`，本轮已删）、`focus-visible:border-primary`（HEAD 的死类写法被文档/记录文本重新喂回构建，无 DOM 使用）。本轮新增/恢复的 `.focus-visible\:border-ring`、`.border-destructive\/50`、`.bg-muted\/30`、`.bg-background\/90`、`.hover\:bg-muted` 均在新产物中真实生成（详见评审报告 §3.5/§6/§8）。
- **用户未在评审窗口内裁决 → 默认保留当前实现**（与既有用户要求的冲突记录如下，勿当回归；精确回退路径见评审报告 §6.1）：自修①「折叠默认值回退旧语义」与 **R10（第十轮·需求纠正）记录的用户明确提出要求**冲突——`progress.md:124-135` 原文：标题「第十轮·需求纠正：思考正文默认折叠 + **折叠组三层默认展开**」、`:126`「**用户澄清**——思考正文应默认折叠，真正问题是**折叠组默认收起导致「思考和工具都不显示」**」、`:129`「② **折叠组三层默认展开（核心需求：思考块与工具行默认可见）**：……顶层过程组……`processGroupDefaultExpanded()`（恒 true，历史回合也默认展开）；内层阶段 `processStageDefaultExpanded()` false→true；工具组 resolve 的 defaultExpanded 由 `detailed` 改 `true`」、`:135`「三层默认展开后长会话默认高度变大，属预期行为变更（**与用户需求一致**）」；`session-handoff.md:48-50` 同源记录「过程折叠组三层（顶层过程组/内层阶段/工具组）**默认展开**……**历史回合同样默认展开**」。本轮按复评结论把三层默认值回退为旧语义（= 对齐移除依赖前的渲染），**用户未在评审窗口内裁决 → 默认保留当前实现**（未发现 R10 之后有修订该要求的用户记录）；背景事实：R10 要求的动机（折叠组默认收起导致思考/工具都不显示）根因已在 R12 定位并修复（思考头接管失败 + 「等接管」的隐藏规则），现已具备 fail-visible 契约。**精确回退路径（若用户要求恢复 R10）**：`src/components/chat/panel-decoration/process-folding.ts` 三处——`processGroupDefaultExpanded`（:556-558）及其调用处传参（:693）、`processStageDefaultExpanded()` 的返回值（:561-563）、工具组 resolve 的第四个参数（:652-658，值来自 `processToolGroupDefaultExpanded` :621-623/:646）改回恒 `true`；并同步 `tests/frontend/process-folding.test.ts` 3 例断言（:131-135 / :137-141 / :437-443）。`ui/Input` 聚焦环（`src/components/ui/input.tsx:9`，有意补齐）同属「未获裁决 → 默认保留」，回退 = 删 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring` 三个类、只保留 `focus-visible:outline-none`。详见评审报告「6.1 与既有用户要求的冲突/待裁决」（行号均为收尾轮实测）。
- Notes（只记录，不扩范围）：
  - 侧栏/设置页等处的 `hover:bg-muted/45`、`bg-background/50`、`bg-border/70`、`text-muted-foreground/70`、`text-foreground/90` 一类删除属**正确删除**（旧版本 dead、无视觉影响），不应记为回归。
  - `docs/wiki/src/components/README.md` 存在整页重复副本（第二份自 315 行起）：仅登记，不修。
  - `WorkspaceFileTree.tsx` / `WorkspaceChangesList.tsx` 等处残留 `isSelected ? '' : ''` 空类分支：旧版本就无视觉区分，本轮保持最小改动未清理。
  - Markdown 代码块根边距 `my-2` vs 旧外层 `mt-2`：已评估，未改。
  - 未决/待验收：① KaTeX 未移植（公式纯文本）；② hljs 自动识别等价性；③ 真实浏览器人工验收清单——思考行与折叠默认状态、hover/focus、下拉定位与关闭、modal 焦点、复制反馈、长表格横向滚动、代码块着色、输入框聚焦、移动端遮罩；④ 字号在「界面字号 ≠ 消息字号」时的条件性差异。
  - 仓库根垃圾文件已清理（收尾轮）：`!o.has(x))`（0 字节，早前删除）、`0)n++`（117 字节，内容是坏命令回显 `--- focus-related selectors in baseline CSS --- / skip / --- focus-visible:ring-2 / ring-ring uniqueness count ---`）、`console.log(l))`（0 字节）均已删除，空目录 `-p` 已删；`_tmp_head/`（空目录）、`.dev-ui-review/`（含 `fulltest-2.log`）只记录不动。`0)n++` 曾被 Tailwind 内容探测扫到、在新构建里生成幽灵类 `.ring-ring`（已标注于报告 §3.5/§8-14）。本轮未做 Git 操作，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`dist/` 仅由 `npm run build` 正常产出）。

---

## self-hosted-chat-ui（done，2026-09-19 第十三轮·根因修复：subagent 运行详情面板运行时闪烁）

- 目标/结论：feature 保持 done。用户反馈：Workspace Inspector 的 **subagent 运行详情面板运行时持续闪烁**，观感是「整段消息内容重建（代码块、SVG/图片重新渲染）」。非新能力，三条根因 + 一条次要项全部定位并修复；未重构主面板行为语义（`ChatSurface` 的 release 边界、`MessageArea` memo、过程折叠算法均未改）。
- 根因 1（面板每轮 commit 无条件 release + 跨帧重折叠）：`SubagentRunDetailContent.tsx` 的 `SubagentTrace.getSnapshotBeforeUpdate` 之前**无条件**调 `releaseProcessGroups(root)`，`componentDidUpdate` 用 `setTimeout(0)` 重折叠。后果双杀：① 释放后到重折叠之间浏览器会画出一帧「未折叠」态；② `releaseProcessGroups` 会 `group.remove()` 并删除指纹/节点序列缓存（`process-folding.ts:1000-1018`），导致 `processTurnUpdateMode` 的 `update`/`skip` 快路径（`process-folding.ts:1195-1206`、`1234-1238`）**永不可达**，每轮恒走 `full` 全量重建（把每个节点再搬一次）。服务端每 ~150ms 推一次快照 ⇒ 连续闪烁。
  - 修法（a）：新增纯函数 `src/components/workspace/subagent-trace-structure.ts#subagentTraceStructureSignature(messages)`——镜像渲染规则算出「消息行（含行身份 `role:timestamp`）+ 每条 assistant 实际渲染出的 part」的结构签名（`MessageList` 只渲染 user/user-with-attachments/assistant；`AssistantMessage` 走 `content-parts.ts#assistantContentParts`，空白 text/thinking 不渲染、toolCall 用 id 记）。`getSnapshotBeforeUpdate` 先比对新旧签名，**未变则不释放**；`shouldComponentUpdate` 对同一个 payload 对象直接 bail out（Inspector 的 tab 切换/resize/host revision 等无关重渲染不再进来）。`pendingToolCalls` **刻意不入签名**：subagent 列表取 `isStreaming={false}`（没有独立流式容器，未完成工具卡必须渲染），工具起止只重绘工具卡内部，入签名会导致每轮快照都释放+重折叠，正是要修的抖动。
  - 修法（b）：重折叠改为**同一提交内同步执行**（`componentDidUpdate` 直接调 `decorateProcessBlocks`，删掉 `setTimeout(0)` 与 `timer` 字段）。同步执行的前提是折叠读到的 DOM 属性必须是本次提交的值：`AssistantMessage`/`ToolMessage` 的 DOM 属性镜像（`bridge.message` / `bridge.toolCall` / `bridge.result` …）从 `useEffect` 改为 **`useLayoutEffect`**——React 布局阶段按「先子后父」提交，`SubagentTrace.componentDidUpdate`（父）晚于后代的 layout effect，因此 `processTurnFingerprint` 读到的是本次 message/toolCall，不会因读到上一轮值而恒判指纹不匹配、反而退化成全量重建。
  - 修法（c）：保留 revision 作废语义（`componentWillUnmount` 自增 + 释放）并加 `decorating` 单飞标志（折叠会搬节点，嵌套 pass 不得交错）。
- 根因 2（React key 不稳 → 卸载重挂）：① `MessageList.tsx` 用 `msg:${messageIndexOffset + index}`：服务端运行期 trace 是 `latestMessages.slice(-50)` 滑窗（`server/agent-subagent-runner.mjs:347`），窗口一滑，**每个下标都换成了另一条消息** → 全部消息行一起重渲染（`AssistantMessage` 也随之全部重算）。改用 `content-parts.ts#messageRenderKeys`：以消息身份 `role:timestamp`（toolResult 用 `toolCallId`，无 timestamp 回退下标，重复身份加 `#n` 后缀保唯一）作 key，滑窗只卸载被移出的那一条。② `AssistantMessage.tsx` 用「非空 parts 的序号」做 key（`text-${orderedParts.length}` / `thinking-${...}`）：空 chunk 被过滤时后面所有 key 位移 → `MarkdownBlock`/`ThinkingBlock`/`CodeBlock` 整批卸载重挂（重挂会重跑挂载期探测与高亮、mermaid 重渲染、SVG data URL 重 decode）。改用 `message.content` 的**原始索引**（`text:N` / `thinking:N`，toolCall 仍用 `tool:<id>`），并把「哪些分块会渲染 + key」抽成共享纯投影 `content-parts.ts`（组件与结构签名同源，不再各写一份过滤规则）。
- 根因 3（子面板缺流式闸门 → 飞行中的代码块反复渲染预览）：`CodeBlock.tsx` 之前用 DOM 探测（`closest('.qf-streaming-message')`）判断是否流式；主面板的在飞消息在 `.qf-streaming-message` 容器内故预览被关，而子面板根是 `.quickforge-subagent-trace`（无该祖先）→ 每 150ms 更新都重渲染 mermaid/SVG 预览（预览 `<img>` 还随每次结构重建重新 decode）。
  - 修法：`surface-context.ts` 新增 **`AssistantStreamingContext`**（+`useAssistantStreaming()`），流式状态**显式传入**不再探测 DOM——`ChatSurface` 在 `.qf-streaming-message` 容器内提供 `true`（消息列表内仍是默认 `false`，语义与旧探测一致），`SubagentTrace` 用它包住 `MessageList` 并传 `payload.status === 'running'`。`CodeBlock` 的 `streaming = isStreaming prop ?? context`（`isAssistant` 仍按 `.qf-assistant-message` 祖先探测，那是结构性判断且子面板本就命中）。顺带给 `CodeBlock` 加 `memo`（props 是原始值；上下文变化仍会穿透 memo 触发重渲染）。
  - 注意（未改契约）：子面板的 `MessageList` 仍取 `isStreaming={false}`——该 prop 在 `MessageList` 里表示「是否有独立流式容器接管未完成工具卡」（`hidePendingToolCalls`），子面板没有那个容器，若照搬 `status === 'running'` 会让运行中的工具卡消失（既有回归用例 `subagent-run-detail-react.test.ts` 的 "keeps pending tools visible while running" 钉住了这条）。
- 根因 4（次要，随手修）：`SubagentRunBody` 的 `syncInputClampBoxes` effect 依赖 `[payload]`（每轮快照都是新对象）→ 每轮 dispose + 重测，任务说明块抖动。改为依赖真正影响 clamp 的稳定值 `[runId, task, context, expectedOutput]`。
- 新增测试：
  - `tests/frontend/subagent-trace-flicker.test.ts`（新增 8 用例）：① 结构签名忽略「分块内文本增长」「不渲染的空白 chunk」「toolResult/artifact 行」，但对新增 part / 新增消息行 / 流式态翻转敏感；② 直接驱动 `SubagentTrace` 生命周期（DOM 桩 + mock 折叠层）断言——结构未变时 `releaseProcessGroups` **不被调用**、结构变了调用 1 次、`shouldComponentUpdate` 对同一 payload 返回 false、`decorateProcessBlocks` 在 `componentDidUpdate` 内**同步**发生（fake timers 前进 100ms 后调用次数不变，钉住「不再 setTimeout」）；③ mock `MessageList` 反查 context，断言 trace 运行中提供 `AssistantStreamingContext=true` 且列表自身 `isStreaming=false`。
  - `tests/frontend/chat-surface-message-list.test.ts`（+5 用例）：滑窗前后幸存消息 key 不变、重复身份去重且首个不变、toolResult 用 `toolCallId`、assistant 分块按源索引生成 key（空 thinking 进出不再位移后续 key）、pending 过滤只由 `hidePendingToolCalls` 决定。
  - `tests/frontend/chat-code-block.test.ts`（+1 用例）：同一个 SVG 代码块在 `AssistantStreamingContext=true` 下不渲染预览（只有源码），`false` 下恢复预览——证明闸门已改为上下文显式传入而不是任何 DOM 祖先探测（SSR 环境本来就没有祖先）。
  - `tests/frontend/chat-surface-behavior-alignment.test.ts`（+1 用例）：源码级钉住主面板 `.qf-streaming-message` 容器由 `AssistantStreamingContext.Provider value={true}` 包裹。
- 改动文件：`src/components/chat/surface/content-parts.ts`（新增）、`src/components/workspace/subagent-trace-structure.ts`（新增）、`src/components/workspace/SubagentRunDetailContent.tsx`、`src/components/chat/surface/MessageList.tsx`、`src/components/chat/surface/AssistantMessage.tsx`、`src/components/chat/surface/ToolMessage.tsx`、`src/components/chat/surface/CodeBlock.tsx`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/surface-context.ts`、`tests/frontend/subagent-trace-flicker.test.ts`（新增）、`tests/frontend/chat-surface-message-list.test.ts`、`tests/frontend/chat-code-block.test.ts`、`tests/frontend/chat-surface-behavior-alignment.test.ts` + 本轮文档（`progress.md`、`session-handoff.md`、`docs/wiki/src/components/README.md` 两处副本）。
- 验证：定向 `npx vitest run tests/frontend/subagent-run-detail-react.test.ts tests/frontend/subagent-run-detail.test.ts tests/frontend/subagent-process-trace.test.ts tests/frontend/chat-surface-message-list.test.ts tests/frontend/chat-surface-render.test.ts tests/frontend/chat-surface-behavior-alignment.test.ts tests/frontend/process-folding.test.ts tests/frontend/process-folding-ownership.test.ts tests/frontend/chat-surface-css-contract.test.ts tests/frontend/subagent-trace-flicker.test.ts tests/frontend/chat-code-block.test.ts` → **11 files / 275 passed（exit 0）**；随后完整 `npm run test` → **357 files / 4235 passed + 1 skipped（exit 0）**（较 R12 的 356 files / 4220 passed 增加 1 文件 15 例＝本轮 4 个测试文件的新增用例）；`npx tsc -b --pretty false` → **exit 0**；`npm run lint` → **0 error / 3 warnings**（均在 `coverage/` 生成产物，仓库既有）；`npm run build` → **exit 0**（仅既有 chunk 体积与 `node:fs` externalize 警告）。
- 文档同步：`docs/wiki/src/components/README.md` 两处副本——surface 树补 `content-parts.ts` 与 `AssistantStreamingContext`、`MessageList`/`AssistantMessage` 行补 key 契约、`CodeBlock` 行补 memo 与流式门控来源、`workspace` 树补 `subagent-trace-structure.ts`、「process-folding 所有权租约」段补「只在结构变了才释放 + 同提交内同步重折叠 + 镜像改 `useLayoutEffect`」、「SubagentRunDetailContent」段补独立流式 surface 与 clamp 依赖。`feature_list.json` 未动（feature 自 R10 起恒为 done，本轮为既有 feature 的运行时回归修复，无状态变化）。`docs/wiki/src/lib/README.md` 未动：本轮没有 lib 层新契约（`content-parts.ts` / `subagent-trace-structure.ts` 都在 components 目录树内）。
- Notes（只记录，不扩范围 / 需真机确认）：
  - **需真机确认①：同步重折叠是否彻底消除「未折叠帧」。** node 环境无 jsdom（仓库 v4 无 DOM 测试运行器），「子 layout effect 先于父 `componentDidUpdate`」是 React 的布局阶段语义保证而非本项目实测；若真机上仍能看到结构性变更（新增 part/新增消息行/运行结束）的一次闪动，应先用 DevTools Performance 录制确认是 release 落帧还是 CSS keyframes 重启，再决定是否进一步做「释放与重折叠合并」。
  - **需真机确认②：节点搬动是否重启 CSS 动画。** `releaseProcessGroups` + 重新 `createTurnProcessGroup` 会把节点从原父容器移出再插入新组，DOM 移出/插入是否重启 `animate-*`（`ThinkingBlock` 的 shimmer、`animate-pulse` 光标）取决于浏览器实现，本地无 jsdom 无法断言；本轮把发生频率从「每 150ms」降到「结构变化时」，但结构变化那一次仍可能重启动画。
  - **需真机确认③：`shouldComponentUpdate` 的语义边界。** 它按 payload 对象身份 bail out；语言切换走 `window.location.reload()`（`i18n.ts:3402`）故无影响，但若将来出现「不换 payload 对象却需要重渲染」的宿主路径（如就地改写 payload 字段），该门控会吞掉更新——届时应按签名或显式 revision 放宽。
  - 结构性变更（新增 part / 新增消息行）仍会释放 + 全量重建：本轮只把触发条件从「每轮」收紧到「结构真的变了」，未改 `process-folding` 的 full 路径本身；运行结束时 `isAgentStreaming=false` 使 `canShortCircuit=false`，`processTurnUpdateMode` 必然返回 `full`，该次重建属既有设计。
  - `MessageList` 行 key 依赖消息 `timestamp`：无 timestamp 的消息回退下标（滑窗时该行仍会重挂）；若将来出现无时间戳的服务端消息，应补稳定 id 而不是依赖索引。
  - 本轮未做 Git 操作，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`dist/` 仅 `npm run build` 正常产出）。
- 2026-09-19 复查修复（第十三轮复审结论落实，feature 保持 done）：
  - 阻塞项 1（`getSnapshotBeforeUpdate` 门控晚一拍）：`SubagentTrace.getSnapshotBeforeUpdate` 之前把**形参当本次的新 props** 用——而 React 的契约是「形参是**上一轮已提交的 `prevProps`**，本次提交的新 props 已在 `this.props`」。于是它比较的是**上一轮**的签名：结构真正变了的那次 commit **不释放**，要下一次 commit 才释放，React 在结构变化那次就会围着仍被折叠组持有的节点做 insert/remove。改为在 `getSnapshotBeforeUpdate` 内读 `this.props.payload` 计算签名，与 `this.structure`（表示上一轮已提交 DOM 对应的载荷签名）比较，变了才释放并更新 `this.structure`；补注释说明该 React 契约与「为何必须读 `this.props` 而非形参」。
  - 阻塞项 2（签名里的 `isStreaming` 位）：`subagent-trace-structure.ts#subagentTraceStructureSignature` 之前把 `isStreaming`（`payload.status === 'running'`）计入签名，与同文件「运行结束开启预览属内容型更新、不应释放」的注释自相矛盾，且运行结束会多一次 release+全量重建。**选择删除该位**（并去掉函数的第二个参数）。理由：签名描述的是「哪些 DOM 节点存在」，而流式态只影响已存在节点内部的渲染细节（trace 恒以 `isStreaming={false}` 渲染 `MessageList`，运行结束只把已渲染节点内的代码块预览打开、不增删行/part）；把它计入只会把一次内容型更新升级为一次全量重建——恰是要修的抖动。
  - 小项 3（tool 分块 key 兜底）：`content-parts.ts#assistantContentParts` 的 toolCall key 之前恒为 `tool:${chunk.id}`，原始 trace 载荷缺 id 时会产出重复的 `tool:undefined`，同一次渲染内 key 冲突。改为非空字符串 id 才用 `tool:${chunk.id}`，否则回退 `tool:${index}`（与 `text:N`/`thinking:N` 同构，同一消息内唯一）。
  - 小项 4（wiki 文档矛盾）：`docs/wiki/src/components/README.md` 两处副本（:181 / :497）之前仍写「`SubagentTrace` 在每次提交前用 `getSnapshotBeforeUpdate` 调 `releaseProcessGroups(root)`」，与 :313/:629 的新描述及实现矛盾。改为「只在结构签名变化时释放 + 同提交内同步重折叠」。
  - 小项 5（隐式耦合说明）：`subagent-trace-structure.ts` 签名函数注释补明——该门控成立的前提是 trace 的 `MessageList` 恒传 `isStreaming=false`（pending 工具卡始终渲染、pending 过滤不进签名）；若将来改为传入真实流式标志，`MessageList` 会按 `hidePendingToolCalls` 隐藏未完成工具卡，工具起止将变成真实的行/part 变化，此时必须同步把 `pendingToolCalls` 纳入签名。
  - 测试更新：`tests/frontend/subagent-trace-flicker.test.ts`——按 React 真实约定驱动生命周期（先 `instance.props = { payload: next }`、再以 **prev props** 调 `getSnapshotBeforeUpdate`），把「结构变化那一拍」的断言改成真能防 off-by-one 的写法（用例改名 `releases on the commit whose structure changed (no off-by-one)`），并新增 `does not treat the running→done flip as a structural change`、把「流式态翻转改变签名」断言移除；`tests/frontend/chat-surface-message-list.test.ts` 新增缺 id toolCall 的 key 回退断言（`tool:0` / `tool:1` / `tool:call-1`）。
  - 护栏有效性取证：把 `getSnapshotBeforeUpdate` 临时改回错误写法（用形参）后单跑 `subagent-trace-flicker.test.ts` → **1 failed / 8 passed**（恰是 `releases on the commit whose structure changed (no off-by-one)`），恢复修复后 **9/9 passed**。
  - 验证：定向 `npx vitest run tests/frontend/subagent-trace-flicker.test.ts tests/frontend/chat-surface-message-list.test.ts tests/frontend/process-folding.test.ts tests/frontend/process-folding-ownership.test.ts tests/frontend/subagent-run-detail-react.test.ts tests/frontend/subagent-run-detail.test.ts tests/frontend/chat-code-block.test.ts` → **7 files / 238 passed（exit 0）**；完整 `npm run test` → **358 files / 4258 passed + 1 skipped（exit 0）**；`npm run lint` → **0 error / 3 warnings（coverage/ 既有）**；`npm run build` → **exit 0**（仅既有 chunk 体积与 `node:fs` externalize 警告）。
  - Notes（只记录，不扩范围 / 需真机确认）：① 复查修复后「结构变化那一次仍会 release + 全量重建」属既有 `process-folding` full 路径设计，未改；② 移除 `isStreaming` 位后运行结束不再触发 release/重建，代码块预览切换仍在已渲染节点内部由 React patch（内容型更新，预期）；③ 首跑 `npm run lint` 曾命中**另一会话并发新建**的 `tests/frontend/chat-surface-api-key-dialog.test.ts` 的半写状态（`Parsing error: '}' expected`），单文件 `eslint` 与随后重跑全量 lint 均 **0 error**，判定为并发写入竞态，非本轮改动；④ 本轮未做 Git 操作，未触碰生成产物。
- 2026-09-19 硬化（第十四轮复审放行后落实，feature 保持 done，最小改动）：
  - 硬化 1（崩溃路径，中低概率）：`subagent-trace-structure.ts#subagentTraceStructureSignature` 之前行 token 只含 `role`，不含**行身份**。服务端运行期 trace 是 `latestMessages.slice(-50)` 滑窗（`server/agent-subagent-runner.mjs`），窗口用「连续同形 assistant 行」替换被移出的行时（role 序列与 part 形态相同、仅身份不同），签名不变 ⇒ **不释放**；而被替换的行可能是过程组锚点行（`process-folding.ts#createTurnProcessGroup` / `processGroupAnchorIndex`），组内夹带其它行搬来的节点，脱离后 `releaseProcessGroups` 走 `shouldRestoreGroupedProcessNode`（节点仍连接但已不在组内）只清折叠标记不归还 ⇒ 之后 React `removeChild` 抛 `NotFoundError`。修法：把行身份 token 补入签名——`content-parts.ts` 新增导出 `messageRenderIdentity`（`messageRenderKeys` 背后的同一身份：`role:timestamp`，无 timestamp 回退 `#index`），签名对每条渲染行取该身份（assistant 行写成 `identity[part,part]`）。刻意保持「文本增长 / toolResult 到达 / running→done」不入签名：这些仍是内容型更新，入签名会退回「每 150ms 释放」的抖动。
  - 硬化 2（tool 分块 key 撞）：`content-parts.ts#assistantContentParts` 的无 id toolCall 兜底 key 由 `tool:${index}` 改为 `tool#${index}`——原形态会与「id 恰为纯数字」的分块撞 key（如 id='1' → `tool:1`，另一无 id 分块 index=1 → `tool:1`，同一渲染内冲突）。
  - 硬化 3（注释一致性）：`content-parts.ts` 头注原写「assistant 每个 part 都按源索引 key」，与 tool 分块按 id key 的实现不符；改为「text/thinking 用源索引、toolCall 用 id、缺 id 用不会与 id 形态冲突的源索引兜底」。
  - 硬化 4（文档陈旧）：本文件第 5 行早前仍写 `subagentTraceStructureSignature(messages, isStreaming)`（两参），与实现（单参）矛盾；改为单参描述。
  - 测试（新增/更新）：`tests/frontend/subagent-trace-flicker.test.ts` 新增 3 例——① 滑窗把「同形 assistant 行」换成不同身份必须改变签名（并在 `SubagentTrace` 生命周期层断言该 commit 真的 `releaseProcessGroups`）；② 同窗口内仅文本增长签名不变；③ toolResult 到达签名不变。`tests/frontend/chat-surface-message-list.test.ts` 更新无 id toolCall 期望为 `tool#0` / `tool#1` / `tool:call-1`，并新增「数字 id（id='1'）与无 id 分块混合」唯一性断言（`tool:1` 与 `tool#1` 不撞）。
  - 护栏有效性取证：把签名临时改回「只含 role」的旧写法后单跑 `subagent-trace-flicker.test.ts` → **2 failed / 10 passed**（恰是两条新增滑窗用例：签名都是 `user|assistant[text:0]` 无差异、`releaseProcessGroups` 被调 0 次），恢复后 **12/12 passed**。
  - 验证：定向 `npx vitest run tests/frontend/subagent-trace-flicker.test.ts tests/frontend/chat-surface-message-list.test.ts tests/frontend/subagent-run-detail-react.test.ts` → **3 files / 32 passed（exit 0）**；完整 `npm run test` → **359 files / 4267 passed + 1 skipped（exit 0）**（较复查修复后 358 files / 4258 增加：本硬化 +4 例，其余为并发会话新增文件/用例）；`npm run lint` → **0 error / 3 warnings（coverage/ 生成产物，仓库既有）**；`npm run build` → **exit 0**（仅既有 chunk 体积与 `node:fs` externalize 警告）。
  - Notes（只记录，不扩范围 / 需真机）：① 行身份 token 依赖消息 `timestamp`，无 timestamp 时回退下标（与 `MessageList` 行 key 同源）——服务端 trace 消息若无时间戳，该行滑窗时仍会重挂、且仍可能漏判释放，属既有边界；② 本轮只补「行身份」这一位，未改 `process-folding` 的释放/归还算法；③ 未做 Git 操作，未触碰 `dist/`、`package-dist/`、`package-offline/`。

---

## self-hosted-chat-ui（done，2026-09-19 第十二轮·根因修复：思考头接管永远失败 + fail-visible 契约）

- 目标/结论：feature 保持 done。本轮为第十二轮·根因修复：R9/R11 连续两轮改 CSS 都没能让主 Agent 面板的思考行回来，真正根因不在 CSS——装饰层的「思考头接管」从来就没成功过。本轮修接管（chevron 识别兼容「自身即 svg」+ 去掉 `instanceof HTMLElement` 过滤）并把「等接管」的隐藏彻底删掉（fail-visible）。非新能力。
- 真正根因（症状 ↔ 改动对应，链路逐段可复现）：
  - ① `src/components/chat/panel-decoration/process-folding.ts:434`（改前）`Array.from(header.children).filter((child): child is HTMLElement => child instanceof HTMLElement)`：React `ThinkingBlock` 的 chevron 是 lucide `<ChevronRight>` 的 **`<svg>` 本体**（`ThinkingBlock.tsx:29`，header.children = `[svg, span]`），而 **SVGElement 不是 HTMLElement** → chevron 被整条过滤掉。
  - ② 同文件 `:439`（改前）`hasSvg: Boolean(child.querySelector('svg'))` 只查**后代**：`svg` 匹配不到自身 → 即便不过滤，`processThinkingChildIndexes`（`:413-426`）也拿不到 chevron；chevronIndex=undefined → `:444` `if (!chevron || !label) return` 提前退出。
  - ③ 结果：`header.className = 'thinking-header quickforge-process-thinking-header'`（`:467`）永不执行 → 而 `src/index.css:3610-3612`（改前）`.qf-chat-panel .quickforge-process-body .qf-thinking-block > .thinking-header:not(.quickforge-process-thinking-header) { display: none }` 把它永久隐藏；R10 把 ThinkingBlock 改回默认折叠（折叠态只渲染 header）后，整块思考消失。**这也解释了 R9（面板级隐藏）/R11（收紧为过程组级隐藏）为何无效——隐藏规则不管挂在哪一级，接管都从未成功。**
  - ④ 副产物：即便 ① 修好，`chevron.className = '...'`（改前 `:448`）对 SVG 也不成立——`SVGElement.className` 是只读的 `SVGAnimatedString`，严格模式（ESM）赋值直接抛 `TypeError`，会连带炸掉整轮装饰。
- 修复（2 项 + 1 处导出）：
  - ① 接管兼容两种 chevron 形态（`process-folding.ts`）：`children` 直接取 `Array.from(header.children)`（children 本就只含元素子级，且注释明确「node 测试环境无 HTMLElement 全局，用结构检查而非 instanceof」的既有约定，这里连结构检查都不需要），类型放宽为 `Array<HTMLElement | SVGElement>`；`ProcessThinkingChild` 新增 `selfSvg`（`child.tagName.toLowerCase() === 'svg'`），chevron 判定改为 `markedChevron ?? (selfSvg || hasSvg)`（保留 `hasSvg` 兼容旧 thinking-block 自定义元素把 svg 包在 span 里的形态）；`rotated` 判定不变（`rotate-90` / `quickforge-process-thinking-chevron-expanded`），对 svg 自身 `classList` 同样生效。chevron/label 的类改写改走 `setAttribute('class', ...)`（HTML/SVG 两形态通吃，且避开只读 `className`）。
  - ② fail-visible（`src/index.css`）：**删除** `:3610-3612` 的 `display: none` 规则，原位置改成契约注释（记录 R9/R11/R12 的教训：任何「等接管」的隐藏都会把「接管失败」变成「思考静默消失」，宁可显示 React 原生「Thinking...」行）。删除后未接管状态显示同一位置的原生 header（非空白），R9 的 28px 空白诉求由接管后规则 `.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header { display:flex; min-height:1.625rem }` 承担，接管成功后无空白、无装饰前双头（装饰复用同一 header 元素）。
  - ③ 导出 `decorateProcessThinkingBlocks`（实现未改，仅加 doc 注释说明接管契约）供集成护栏直接跑真实接管路径。
- 护栏测试（关键：此前**没有任何**测试跑过真实接管路径，这正是 bug 存活两轮的原因）：
  - 新增 `tests/frontend/thinking-header-adoption.test.ts`（6 用例）：项目 vitest 跑 node 环境无 jsdom，按仓库既有约定（`process-folding-ownership.test.ts` / `slash-invocation-chip.test.ts`）手写最小 fake DOM，但刻意复刻真实 DOM 最要命的一条语义——**`SVGElement` 与 `HTMLElement` 是互不 `instanceof` 的兄弟类**；用 React 真实形态建树（`.qf-chat-panel > .qf-message-list > .qf-assistant-message > .px-4.flex.flex-col > .quickforge-process-group > .quickforge-process-body > .qf-thinking-block.thinking-block > button.thinking-header > [svg, span]`，`svg` 是 `FakeSvgElement`）后断言：header 拿到 `thinking-header quickforge-process-thinking-header`、children 重排为 `[SPAN(icon), SPAN(label), SVG(chevron)]`、`label.textContent === 'processThinking'`、chevron 的 class 属性为 `quickforge-process-thinking-chevron`（`rotate-90` 时追加 `quickforge-process-thinking-chevron-expanded` 且原 utility 类被清掉）、二次装饰幂等（同一批节点、仅 1 个 icon）、旧 span 包裹形态仍被接管、组外 thinking 块不受影响。**先在未修复源码上跑：4/6 失败**（header 仍是原始 utility 类、children 仍是 `[SVG, SPAN]`、rotate-90 留在原类上），修复后 6/6 通过。
  - `tests/frontend/process-folding.test.ts`：新增 2 例——`selfSvg` 形态识别（`{selfSvg:true}` + label → chevronIndex 0 / labelIndex 1）与 `selfSvg + rotated` → `chevronExpanded: true`。
  - `tests/frontend/chat-surface-css-contract.test.ts`：R11 那条「隐藏规则必须带 `.quickforge-process-body` 限定」的护栏改为 fail-visible 契约——`expect(css).not.toMatch(/\.thinking-header\b[^{}]*\{[^}]*display:\s*none/)`（任何针对 `.thinking-header` 的 display 隐藏都不得存在）＋ 断言 R11 的旧组合选择器（`.qf-chat-panel .quickforge-process-body .qf-thinking-block > .thinking-header`）不得回流；兜底可见规则与接管规则 `display:flex` 断言保留。
- 与前两轮的关系：R9 为解决「原生头占 28px 空白」引入面板级 `display:none`；R11 发现未接管头被误伤、把隐藏收紧到过程组级（承认「未接管必须可见」）；R12 查明接管从未成功，把隐藏彻底删除——R9 的空白诉求转由「接管成功」满足，R11 的「未接管可见」由 fail-visible 契约强制。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`（children 取法 + `selfSvg` + `setAttribute('class')` + 导出与注释）、`src/index.css`（删 `display:none` + 契约注释）、`tests/frontend/thinking-header-adoption.test.ts`（新增）、`tests/frontend/process-folding.test.ts`（+2 用例）、`tests/frontend/chat-surface-css-contract.test.ts`（护栏改写）+ 本轮文档（`progress.md`、`session-handoff.md`、`docs/wiki/src/components/README.md` 两处副本的 process-folding 段）。
- 验证：定向 `npx vitest run tests/frontend/process-folding.test.ts tests/frontend/process-folding-ownership.test.ts tests/frontend/thinking-header-adoption.test.ts tests/frontend/chat-surface-css-contract.test.ts tests/frontend/chat-surface-render.test.ts tests/frontend/chat-surface-behavior-alignment.test.ts tests/frontend/subagent-run-detail.test.ts`（见 `session-handoff.md` 终态数字）；随后完整 `npm run test`、`npm run lint`、`npm run build`。护栏有效性另以「修复前跑新护栏 4 例失败 → 修复后 6/6 通过」取证。
- 文档同步：`docs/wiki/src/components/README.md` 两处副本的 process-folding 段补「思考头接管契约 + fail-visible 原则」（含 `selfSvg`/`hasSvg` 两形态、`setAttribute('class')` 的原因、禁止 display 隐藏）；`progress.md`/`session-handoff.md` 更新；`feature_list.json` 未动（feature 自 R10 起恒为 done）。
- Notes（只记录，不扩范围）：
  - 未接管原生 header 的字号残余差异（R11 遗留项）本轮未动：fail-visible 后它理论上仍可能短暂可见，值为 React `text-sm`（= `--text-sm` = 1rem = 界面字号，默认 13px），与统一后的 11.375px 行字号不同；接管成功后该 header className 被重置、不再走兜底规则。
  - `.quickforge-process-thinking-chevron svg { width/height: 1rem }` 这类「后代 svg」规则对「自身即 svg」的接管形态不再命中，但同级 `.quickforge-process-thinking-chevron { width/height: 1rem }` 已直接作用在 svg 上，尺寸与旧 span 包裹形态一致（1rem），未额外改动 CSS。
  - 真实浏览器观感（面板内思考行恢复、接管后行高/字号/chevron 行为、默认字号无回归）仍待人工验收；本轮无 Git 写操作，未触碰 `dist/`、`package-dist/`、`package-offline/`。

---

## self-hosted-chat-ui（done，2026-09-19 第十一轮·用户反馈回归修复：主 Agent 面板思考行不可见 + 思考行/工具行字号不一致）

- 目标/结论：feature 保持 done。本轮为第十一轮·用户反馈回归修复：用户报告 ① 主 Agent 对话里看不到思考行（subagent 运行详情可见）；② 同一屏思考行与工具行字号不一致。均为 CSS 契约问题，非新能力，未改组件逻辑。
- 修复 2 项（症状 ↔ 改动对应）：
  - ① 主 Agent 面板思考行不可见：根因是 R9 引入的 `.qf-chat-panel .qf-thinking-block > .thinking-header:not(.quickforge-process-thinking-header) { display: none }` 是**面板级**隐藏，而标记类 `.quickforge-process-thinking-header` 的唯一写入点是 `src/components/chat/panel-decoration/process-folding.ts:467`（`decorateProcessThinkingBlocks`，只对已折进 `.quickforge-process-group` 的元素执行，唯一调用点 `updateProcessGroup` 的 708 行）。装饰层未接管的原生头因此被永久 `display:none`；R10 把 ThinkingBlock 回退默认折叠（`ThinkingBlock.tsx:19` `useState(false)`，折叠态只渲染 header）后，这类思考块整块消失。改法（收紧而非删除）：`src/index.css` 该规则的 `.qf-thinking-block` 前加 `.quickforge-process-body` 祖先限定——只有「已被搬进过程组、等待装饰层接管」的原生头继续 `display:none`（保留 R9「不占 28px 空白」的诉求，未改回 `visibility:hidden`），未成组/未接管的原生头落到紧随其后的兜底可见样式（只改色/hover/chevron，无 `display` 声明）。
  - ① 核对（无需放宽）：装饰层取头用 `:scope.qf-thinking-block > .thinking-header`（`process-folding.ts:431`），React `ThinkingBlock` 渲染的 header 始终是 `.qf-thinking-block` 的直接子级；搬入的节点一律 append 进 `.quickforge-process-body`（`populateProcessGroup` 的 body、`populateProcessContainer` 的 `.quickforge-process-stage-body` / `.quickforge-process-tools-body`），即 header 永远在 `.quickforge-process-body` 之内，故接管后的可见性规则 `.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header` 命中全部实际位置，选择器未放宽。
  - ② 思考行与工具行字号不一致：同一屏两套基准——思考行/过程摘要行走 `0.875rem`（界面字号 rem 根），工具行（`index.css` 3445-3455 的既有表达式）走 `calc(var(--quickforge-message-font-size, 14px) * 0.875)`（消息字号）；两设置项独立，默认 R=M=13px 时数值相同故默认看不出，用户调大消息字号即漂移。统一到消息字号基准：`src/index.css` 三处替换——接管后的思考行（`.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header`）、`.quickforge-process-summary`、`.quickforge-process-stage-summary, .quickforge-process-tools-summary` 的 `font-size: 0.875rem` → `calc(var(--quickforge-message-font-size, 14px) * 0.875)`。
  - ② 默认下已存在的逃逸（补漏）：兜底工具卡首行（`ToolMessage.tsx:84` 的 `text-sm`）与 generate_image 首行（`generate-image-tool-renderer.tsx:21` 的 `text-sm`）逃逸到 1rem。把两条同级 DOM 形态选择器 `.quickforge-tool-message > .space-y-2 > .quickforge-tool-summary`、`.quickforge-tool-message > .quickforge-generated-image-tool > .quickforge-tool-summary` 并入工具摘要行既有规则（`index.css` 3445-3455）。该规则不受 `.qf-chat-panel` 限制，面板外（subagent 运行详情等）同步取同一基准，语义一致；顺带修正压平后（`.quickforge-process-body` 内）这两行字色仍是全浓度 `text-muted-foreground`、与相邻工具行 88% mix 不一致的既有偏差。
  - ② 去 `!important` 的理由：接管后的 header className 已被装饰层重置为 `thinking-header quickforge-process-thinking-header`（不再有 `text-sm` 等 utility），且该规则 unlayered（层叠优先于 `@layer utilities`），无竞争故删掉 `font-size: ... !important`；R10 默认折叠语义与装饰层覆盖范围均未改动。
  - ② 零视觉回归核算：默认（界面字号 = 消息字号 = 13px）下 `0.875rem` = 11.375px、`calc(13px * 0.875)` = 11.375px，三处替换数值不变；兜底卡/generate_image 首行由 `text-sm`（= `--text-sm` = 1rem = 13px，**原本就不等于工具行的 11.375px**）改为 11.375px，属本轮要修的默认不一致。
- 护栏测试：`tests/frontend/chat-surface-css-contract.test.ts` 新增两个 describe（6 用例）——① `thinking header visibility contract`：断言隐藏规则必须带 `.qf-chat-panel .quickforge-process-body` 祖先限定（`not.toMatch` 面板级裸规则，防契约再次回归）、兜底规则只改色/hover 无 `display` 声明（未接管 header 可见）、接管规则 `display: flex` 命中 `.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header`，并用 `renderToStaticMarkup(ThinkingBlock)` 钉住「header 是 `.qf-thinking-block` 直接子级」这一 CSS ⇄ DOM 结构前提；② `chat row font scale contract`：过程摘要 / 阶段与工具组摘要 / 接管后思考行必须含 `font-size: calc(var(--quickforge-message-font-size, 14px) * 0.875)` 且不含 `font-size: 0.875rem`，兜底卡与 generate_image 首行必须被工具摘要行规则的选择器覆盖。
- 改动文件：`src/index.css`（4 处字号基准 + 1 处隐藏规则作用域收紧 + 注释）、`tests/frontend/chat-surface-css-contract.test.ts`（+6 用例）+ 本轮文档（`progress.md`、`session-handoff.md`、`docs/wiki/src/README.md` 字号体系段）。
- 验证：定向 `npx vitest run tests/frontend/chat-surface-css-contract.test.ts tests/frontend/goal-report-renderer.test.ts tests/frontend/process-folding.test.ts tests/frontend/chat-surface-render.test.ts tests/frontend/chat-surface-behavior-alignment.test.ts tests/frontend/subagent-run-detail.test.ts` → **6 files / 228 passed（exit 0）**；护栏有效性另用 node 直接对旧/新 CSS 文本复核（旧的面板级裸规则被 `not.toMatch` 命中、新规则命中、旧 `font-size: 0.875rem !important` 已消失）；全量 `npm run test` → **355 files / 4212 passed + 1 skipped（exit 0）**（较 R10 的 4206 passed 增加 6 例＝本轮护栏）；`npm run lint` → **0 error / 3 warnings**（coverage/ 既有）；`npm run build` → **exit 0**（仅既有 chunk 体积与 `node:fs` externalize 警告），并抽查构建产物 `dist/assets/index-*.css` 确认 4 处 `font-size:calc(var(--quickforge-message-font-size,14px) * .875)`、收紧后的隐藏规则与新增的两条工具行选择器均已落到产物。
- 文档同步：`docs/wiki/src/README.md` 的「字号体系」段补一句——聊天区内与消息同屏的过程摘要行 / 接管后思考行 / 工具摘要行（含兜底工具卡与 generate_image 首行）统一取 `calc(var(--quickforge-message-font-size, 14px) * 0.875)`，不再依赖界面字号 rem 根。`docs/wiki/src/components/README.md` 的 process-folding 段落未记载思考头的可见性契约（只写折叠默认值/所有权租约），本轮为实现级 CSS 修复，不改该段；`feature_list.json` 未动（feature 自 R10 起恒为 done，本轮无状态变化）。
- Notes（只记录，不扩范围）：
  - 未接管根因「运行时确认项」：装饰层未接管（或被 React 重挂导致 class 丢失）的**具体触发时机**本轮未在真实浏览器中取证——静态证据只能确定「未接管的原生头此前被面板级规则隐藏」，收紧作用域后这类 header 一律可见（不再整块消失），但为何主 Agent 面板存在长期未接管的 header（装饰层未跑 vs 节点被重挂）仍需运行时确认；若确认是 React 重挂丢失装饰，应单独立项修装饰幂等，而非继续放宽 CSS。
  - 未接管原生 header 的字号残余差异：兜底可见的原生 header 仍走 React `text-sm`（= `--text-sm` = 1rem = 界面字号，默认 13px），与统一后的 11.375px 行字号不同；本轮按「不擅自改兜底规则」的最小改动原则未动，若真实浏览器确认未接管 header 会长期可见，应把兜底规则也纳入消息字号基准（待评估项）。
  - 思考正文 markdown 字号（`index.css:3788` 的 `.qf-chat-panel .qf-thinking-block > .qf-markdown-block.text-sm { font-size: 0.875rem }`）同样游走在界面字号基准上：用户只提「行」的字号，本轮**未改**（待评估项——若一并统一，需确认展开态思考正文与消息正文的字号意图，避免与 `--quickforge-message-font-size` 的正文口径混淆）。
  - `--quickforge-message-font-size` 的 fallback `14px` 沿用既有工具行表达式；仅在变量未写入根节点时（如极早期渲染/无 JS 设置写入）才会比旧 `0.875rem`（界面字号基准）偏大，与工具行既有行为一致，未改。
  - 本轮未做 Git 操作，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`dist/` 仅 `npm run build` 正常产出）；真实浏览器观感（面板内思考行重新可见、行字号一致性、默认字号下无回归）仍待人工验收。

---

## self-hosted-chat-ui（done，2026-09-19 第十轮·需求纠正：思考正文默认折叠 + 折叠组三层默认展开）

- 目标/结论：feature 保持 done。本轮为第十轮·需求纠正：第九轮把「思考内容默认展示」误解为 ThinkingBlock（思考正文）默认展开；用户澄清——思考正文应默认折叠，真正问题是折叠组默认收起导致「思考和工具都不显示」。非新能力。
- 修复 2 项（症状 ↔ 改动对应）：
  - ① 思考正文回退默认折叠：`src/components/chat/surface/ThinkingBlock.tsx` `useState(true)` → `useState(false)`（第九轮④反向修正），组件注释同步改写；护栏断言 `tests/frontend/chat-surface-render.test.ts` 改为反向——默认渲染含 `qf-thinking-block` 与 header 文案（`thinkingBlockLabel`='Thinking...'）但不含思考正文文本（'internal reasoning trace'）。
  - ② 折叠组三层默认展开（核心需求：思考块与工具行默认可见）：`src/components/chat/panel-decoration/process-folding.ts` 三处默认值翻转——顶层过程组 `syncProcessGroupExpandedState` 第 4 参由 `isAgentStreaming` 改为新提取的 `processGroupDefaultExpanded()`（恒 true，历史回合也默认展开）；内层阶段 `processStageDefaultExpanded()` false→true；工具组 resolve 的 defaultExpanded 由 `detailed` 改 `true`（显示模式不再决定组展开，`detailed` 仍用于 displayMode dataset 与状态失效判定）。不动 `createProcessGroup`/`createProcessToolsGroup`/`createProcessStage` 的初始值（同步路径必经 resolve，初始值仅为瞬态）。语义保留：saved state 优先（`resolveProcessExpandedState`，用户手动收起后不被 default 覆盖）、「default 展开且无 saved 时一次性持久化」照旧。
  - 同步测试期望：`tests/frontend/process-folding.test.ts` 阶段默认值用例期望 false→true、用例名 collapsed→expanded（saved 优先断言不变，其余 `resolveProcessExpandedState` 断言未动）。
- i18n 文案修正（描述失实同步）：`toolDisplayModeDescription` en/zh 不再表述「简洁默认收起/详细默认展开」，改为两模式只差渲染细节（摘要 vs 完整参数/details）、工具组两模式均默认展开。
- Wiki 同步：`docs/wiki/src/components/README.md` 两处重复副本的 process-folding 段「运行中和已完成阶段均默认收起」→「均默认展开（顶层过程组与更内层工具摘要组同样默认展开，用户手动收起后按回合记忆）」；`docs/wiki/src/lib/README.md` `tool-display-settings.ts` 条目同步（简洁/详细只差渲染细节 + 组默认展开）。
- 改动文件：`src/components/chat/surface/ThinkingBlock.tsx`、`src/components/chat/panel-decoration/process-folding.ts`、`src/lib/i18n.ts`、`tests/frontend/chat-surface-render.test.ts`、`tests/frontend/process-folding.test.ts`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md` + 本轮文档（`progress.md`、`session-handoff.md`）。
- 验证：定向 `npx vitest run`（process-folding / process-folding-ownership / chat-surface-render / chat-surface-behavior-alignment / chat-surface-message-list / subagent-run-detail / motion-design）7 files / 198 passed；全量 `npm run test` **355 files / 4206 passed + 1 skipped（exit 0）**——首次全量出现 `tests/server/session-state-messages.test.mjs` 多进程 CAS 用例失败（与第九轮 `session-state-repository` 同族的并发时序 flake），单跑该文件 9/9 通过、随后全量复跑通过；`npm run lint` **0 error / 3 warnings（coverage/ 既有）**；`npm run build` **exit 0**（仅既有 chunk 体积 / node:fs externalize 警告）。
- Notes（只记录，不扩范围）：① 折叠状态记忆容量与淘汰照旧（`PROCESS_EXPANDED_STATE_LIMIT`）；② 三层默认展开后长会话默认高度变大，属预期行为变更（与用户需求一致），真实浏览器未实测观感。

---

## self-hosted-chat-ui（done，2026-09-19 第九轮·用户反馈回归修复：打字闪烁/工具行高/思考间距 + 思考内容默认展示）

- 目标/结论：feature 保持 done。本轮为第九轮·用户反馈回归修复：用户报告 3 项样式/行为回归（输入框打字时过程折叠组闪烁展开、工具行高四套不齐、思考块与工具/正文间距过大）+ 1 项新需求（思考内容默认展示），非新能力。
- 修复 4 项（症状 ↔ 改动对应）：
  - ① 打字闪烁（`ProcessGroupReleaseBoundary` 每次随 `ChatSurface` commit 重渲染、在 `getSnapshotBeforeUpdate` 同步解散全部 `.quickforge-process-group`，重折叠要等下一 rAF，展开形态落帧）：`src/components/chat/surface/ChatSurface.tsx` 新增 memo 化 `MessageArea`（props 只含消息快照输入 + 稳定 ref/callback；`toolResultsById` 改 `useMemo`、`getReleaseRoot` 改 `useCallback`），boundary 移入其内——composer 打字等与消息无关的 commit 在 memo 比较处 bail out，不再触发 release；agent 事件照常经 snapshot 驱动重渲染 boundary 并刷新装饰。同步改写 boundary 类注释与 `release()` 注释（原"most commits release nothing"与实际不符）。核对 `ChatPanelHost.tsx` 各触发点（agent 事件 1570-1574、agent_start 1546-1547、scheduleToolInterfaceUpdate 1385-1393）decorate rAF 均先于 scroll rAF 注册，scroll-sync.ts ResizeObserver 路径的 scroll rAF 落在 decorate rAF 之后的下一帧——顺序本已正确，无需调整。
  - ② 工具行高统一（组内 details>summary 26px vs run_subagent/generate_image/默认卡 18.4px、组外无 min-height）：`src/lib/tool-renderers/generate-image-tool-renderer.tsx` 与 `src/components/chat/surface/ToolMessage.tsx`（DefaultToolCardBody 首行）补挂 `.quickforge-tool-summary` 类；`src/index.css` 将组内 `details > summary` 规则替换为面板作用域 `.qf-chat-panel .quickforge-tool-summary { min-height: 1.625rem }`（不限元素类型，组内/组外统一；面板外维持自适应）；压平区新增 `.quickforge-process-body .qf-tool-message > .space-y-2 pre` 清除默认卡内部 pre 的 border/p-2/底色（`> .space-y-2` 精确锚定默认卡体，渲染器 details 内代码块不受影响）。
  - ③ 思考/工具间距（`.qf-chat-panel .qf-thinking-block > .thinking-header:not(...)` visibility:hidden 占 28px 空白 + 组外 gap-3 vs 组内 0.25-0.375rem）：`src/index.css` 该规则改 `display: none`（装饰复用同一 header 元素并加 `.quickforge-process-thinking-header`，不存在装饰前双头，仅消除空白占位）；`src/components/chat/surface/AssistantMessage.tsx` 正文列 `gap-3` → `gap-1.5`（0.375rem，对齐组内节奏上沿），过程组折叠语义不变。
  - ④ 展示思考内容（新需求）：`src/components/chat/surface/ThinkingBlock.tsx` `useState(false)` → `useState(true)`，思考内容默认在 DOM（面板内由过程组 header/组折叠管理可见性，组外直接展示）；新增护栏断言 `tests/frontend/chat-surface-render.test.ts`（renderToStaticMarkup 断言 thinking 文本默认出现在标记中）。
- 同步测试期望：`tests/frontend/chat-surface-css-contract.test.ts` 钉死的 `gap-3 px-4` 标记更新为 `gap-1.5 px-4`（gap 变更为 ③ 的预期行为）。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/surface/AssistantMessage.tsx`、`src/components/chat/surface/ThinkingBlock.tsx`、`src/components/chat/surface/ToolMessage.tsx`、`src/lib/tool-renderers/generate-image-tool-renderer.tsx`、`src/index.css`、`tests/frontend/chat-surface-render.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts` + 本轮文档（`progress.md`、`session-handoff.md`）。
- 验证：定向 `npx vitest run`（process-folding / process-folding-ownership / chat-surface-render / chat-surface-behavior-alignment / chat-surface-message-list / subagent-run-detail / motion-design）7 files / 198 passed；全量 `npm run test` **355 files / 4206 passed + 1 skipped（exit 0）**；`npm run lint` **0 error / 3 warnings（coverage/ 既有）**；`npm run build` **exit 0**（仅既有 chunk 体积 / node:fs externalize 警告）。中途一次全量出现 `tests/server/session-state-repository.test.mjs` 多进程 CAS 用例失败，单跑 17/17 通过、随后全量复跑通过——并发时序 flake，与前端改动无交集，记录不扩范围。
- Wiki：`docs/wiki` 无 chat 面行为契约条目（ChatSurface/过程折叠/ThinkingBlock/工具行高均未被记载），本轮为实现级回归修复，无需同步 wiki。
- Notes（只记录，不扩范围）：① memo 化后 `onCostClick` 若由外部传入不稳定引用会退化回旧行为（boundary 随外部 commit 重渲染），当前唯一挂载点 `ChatPanelHost` 未传该 prop，无实际影响；② 打字闪烁修复未动 `streamingOnly` 变体（`process-folding.ts:979`），memo 化方案已覆盖验收标准。

---

## self-hosted-chat-ui（done，2026-09-18 第八轮·用户反馈回归修复：死类复活致文字变淡）

- 目标/结论：feature 保持 done。本轮为第八轮·用户反馈回归修复：用户报告移除 pi-web-ui 后设置页与左侧项目列表文字变淡，定位为“死类复活”机制并批量修复，非新能力。
- 根因（死类复活）：源码中的分数透明度工具类（text-foreground/80~92、text-muted-foreground/55~76、hover:text-*、focus:border-ring 等共 161 个类）在旧版是死类——旧本地构建无对应 `--color-*` 映射、pi-web-ui 包仅带 text-muted-foreground/50，元素实际继承全浓度前景色；迁移后本地 `@theme inline` 语义色映射使这些类真实生效为半透明。证据：旧编译 CSS `package-dist/dist/assets/index-B1G0LqYR.css` 中无这些类。
- 修复：按审计表（3e10f58 已有用法 ∧ 旧编译 CSS 无该类 → 移除）从 36 个文件移除 549 处类 token，恢复旧渲染；迁移新代码（chat/surface、tool-renderers、settings/tabs 等）145 处保留；text-muted-foreground/50 等旧已生效类保留。更新 6 个测试文件期望。
- 验证：死类残留 grep 0；`npx tsc -b` 通过；`npm run test` **355 files 全通过 / 4205 passed + 1 skipped（exit 0）**；`npm run lint` **0 error / 3 warnings（coverage/ 既有）**；`npm run build` 成功。抽查 ChatSidebar/SettingsWorkspacePage/MarkdownReader 确认形态正确。
- Notes（只记录，不扩范围）：
  - `tests/frontend/settings-workspace-react.test.ts` 并行高负载下偶发 2 例失败（单独运行及多轮全量均过，与类名改动无关）。
  - 仓库根 3 个此前误生成的未跟踪文件（`$($a`、`5`、`pruned)`）已在收尾轮按精确路径删除；本条目落盘时实测仓库根无此 3 文件。
  - 动态拼接类名（如模板字符串内拼接）可能漏检，属已知限制。
  - 遗留小项（无害，未改）：`SettingsWorkspacePage.tsx:169` 空三元死代码、`ChatSidebar` :477/478 模板串尾随空格。

---

## self-hosted-chat-ui（done，2026-09-18 第八轮独立评审：窗口化对齐 + 设置页常驻 + diff/标点/复制反馈修复）

- 目标/结论：feature 保持 done。本轮为第八轮独立评审：以 HEAD `3e10f58` + 移除前构建产物为基线从零取证、不采信前七轮结论，自查自修 9 项回归（含 2 项行为语义、2 项测试护栏之外的 CSS 缺口），非新能力。
- 取证基线：**不采信前几轮结论**，独立从零取证——旧实现取 `HEAD`（= `3e10f58`，即移除 pi-web-ui/mini-lit/lit 之前）的 `git show`，旧 CSS/行为取移除前构建产物 `package-dist/dist/assets/index-B1G0LqYR.css`（含 pi-web-ui 0.75.3 app.css 注入部分）与 `package-dist/dist`、`package-offline/dist` 内的旧 bundle；不可考证项（pi-web-ui shadow DOM 内部行为）如实标注，不猜测。
- 本轮修复 9 项：
  - ① 长会话消息窗口化：`src/components/chat/surface/ChatSurface.tsx:272-274` 改为 `createMessageWindow({ enabled: false })`（带注释说明“先渲染完整对话，让轮次导航直接滚到已有 DOM 节点”），恢复移除前“始终全量渲染 DOM”的行为；旧证据 `HEAD:src/components/chat/ChatPanelHost.tsx:654-657`；`loadMoreMessages`/`showMessageIndex`/`getWindowStart`/`data-window-start` 契约全部保留（`getWindowMessages`/`getWindowStart` 仍读 `committedWindowRef`）。护栏：`tests/frontend/chat-surface-behavior-alignment.test.ts:83-93`（`describe('message windowing stays off for turn navigation')` 断言含 `enabled: false` 且不含 `createMessageWindow()`）。
  - ② 设置页 tab 切换丢失页内中间态：`src/components/settings/SettingsWorkspacePage.tsx:56-68` 定义 `STATE_PRESERVING_TAB_KEYS`（7 个：`customModels`/`defaults`/`backup`/`archivedConversations`/`lanAccess`/`channels`/`about`），`:260-275` 这 7 个 tab 首次激活后常驻挂载 + `hidden` 隐藏 + `cloneElement(item.content, { active: isActive })` 注入 `active`；6 个有生命周期的 tab（defaults/customModels/archivedConversations/lanAccess/channels/about）在重新激活时重载数据（各 tab `if (active === false) return` + `}, [active])` 依赖，backup 旧版无生命周期钩子故不注入）；channels 非激活断开 SSE；搜索无结果时 `:261` 内容区 host 仍渲染（`hidden={!hasSettingsResults}`），已访问的常驻 tab 保持挂载。对应旧行为 = Lit 元素 detach/attach + `connectedCallback` 重载（旧证据 `HEAD:src/components/settings/SettingsWorkspacePage.tsx:57-71`）。回归：`tests/frontend/settings-workspace-react.test.ts`（`forwards the workspace active flag into the tabs that can be reactivated`、`stops the state-preserving tabs while hidden and reloads them on reactivation`、`reloads the custom providers list whenever the tab is reactivated`、`keeps visited persistent tab hosts mounted while the search has no results` 等）。
  - ③ ```diff 围栏增删底色：`src/lib/code-highlight.ts:42-46/63-67` 新增 `addition`/`deletion` token 与 `qf-hl-addition`/`qf-hl-deletion` class，diff 分支按旧 hljs `Diff` 顺序（meta→comment→addition→deletion，`:1443-1491`）重写；`src/index.css:8005-8008`（亮色）/`:8021-8024`（暗色）新增 `--qf-hl-addition/deletion-bg|fg`，取值逐字等于旧 `--syntax-addition/deletion-*`；`:8036-8037` 新增 `.qf-hl-addition` / `.qf-hl-deletion` 规则（前景 + 底色成对，对齐旧 `.hljs-addition` / `.hljs-deletion`）。护栏：`tests/frontend/chat-surface-css-contract.test.ts:230-252`。
  - ④ 标点颜色：删除 `--qf-hl-punct` 变量与 `.qf-hl-punct` 规则（旧 CSS 无 `.hljs-punctuation`，标点与 plain 段一并继承正文色，`src/index.css:7980-7990` 头注已写明）；`punct` token 保留在 tokenizer 内（仅不产出样式 class）。护栏：`tests/frontend/chat-surface-css-contract.test.ts:254-258`（断言无 `--qf-hl-punct:` 也无 `.qf-hl-punct {`）。
  - ⑤ 代码块复制反馈时长：标题栏复制按钮 2000ms（旧 mini-lit `copy-button` 重置间隔，`src/components/chat/surface/CodeBlock.tsx:40-44` 注释 + `COPY_BUTTON_FEEDBACK_MS`）、⋯ 菜单复制动作 1200ms（旧装饰层 `showCopiedFeedback`，旧证据 `HEAD:src/components/chat/panel-decoration/code-blocks.ts:33`；`CodeBlock.tsx:45-50` 注释 + `MENU_COPY_FEEDBACK_MS`）；`copyFeedback` 记录自己的 `durationMs` 并由重置定时器读回（`CodeBlock.tsx:264-266/314-319/334-340`），单一共享常量无法再把两条路径合并。护栏：`tests/frontend/chat-code-block.test.ts:257-266`。
  - ⑥ 代码块 ⋯ 菜单互斥范围：恢复为同一 `.qf-markdown-block` 内互斥（旧 `block.closest('markdown-block')`），`CodeBlock.tsx:189-195` 用 `detailsRef.current?.closest('.qf-markdown-block') ?? document` 作为 CustomEvent（`quickforge:code-block-menu-open`）派发作用域；外部点击 / Escape 仍是 document 级（`:196`）。
  - ⑦ 无信息串围栏的语言标签：恢复旧显示（无语言 → `text`，保留原始大小写），`src/components/chat/surface/Markdown.tsx:85-91`（无 info string 时传 `language="text"`，注释对齐旧 markdown 层行为）+ `CodeBlock.tsx:68-76`（`codeBlockLanguageLabel` 仅在空语言时回退 `plaintext`，显示不做大小写折叠）。护栏：`tests/frontend/chat-code-block.test.ts:64-68/326-330`（断言标题栏渲染 `>text</span>`、无 `language-plaintext`）。
  - ⑧ 列表项间距：核实旧 CSS 的 `ul`/`ol` 两条 `:not(:last-child)` 规则与新规则等价 → **未改动**（属取证确认，非遗漏）。
  - ⑨ 本轮同时补齐的护栏断言（只加测试，不改行为）：`tests/frontend/chat-surface-css-contract.test.ts`（`--qf-hl-addition/deletion-*` 旧值锁定 + 无 `--qf-hl-punct`）、`tests/frontend/chat-surface-render.test.ts:131-134`（`data-window-start="0"` 偏移透传）、`tests/frontend/chat-code-block.test.ts`（菜单 1200ms / 标题栏 2000ms；无语言 → `text`）、`tests/frontend/settings-workspace-react.test.ts`（常驻挂载与重新激活重载契约）。
- 有意变更/保留（本轮取证确认，不复刻，需用户决策者单列）：
  - 未知/未注册语言不再像 hljs `highlightAuto` 那样猜测着色（自研 tokenizer 覆盖 16 种语言，其余整块 plain）→ 属能力边界，**需用户决策**是否扩大语言表。
  - KaTeX 数学公式渲染随 pi-web-ui 移除（`$…$`）→ 现按纯文本渲染，恢复需新增 katex 依赖，**需用户决策**。
  - color-mix 的旧浏览器回退（旧 CSS 有 `@supports` 双写，新实现仅 color-mix 一半）——现代浏览器无影响。
  - 附件解析新增安全上限（zip 炸弹 / 文本 2MB / PDF 500 页 / 超时）——有意加固。
  - 设置下拉控件修复了旧版“按键打开后多走一格”的缺陷——有意变更。
  - 工具卡折叠记忆 key 由内容寻址改为 `toolCall.id`、容量 200→100——有意变更。
  - KaTeX/hljs 等被移除组件相关的 CSS（web-component 选择器、`.katex`、`.hljs-*` 通用类）不再存在——预期。
- 不可考证项：pi-web-ui 包（含 shadow DOM）内部行为；旧包已从 `node_modules` 卸载，`pi-web-ui` 0.75.3 的运行时内部实现只能经旧构建产物间接推断。
- 验证：`npm run test` **355 files 全通过 / 4205 passed + 1 skipped（exit 0，50.71s）**；`npm run lint` **0 error / 3 warnings（exit 0；3 个 warning 全部来自 `coverage/` 生成目录的 Unused eslint-disable 指令，非源码）**；三者由父 Agent 统一执行：`npm run build` **exit 0（vite built in 2.68s）**，仅 chunk >500kB 与 `node:fs` externalize 两处既有 stderr 警告（无新增告警）。本轮为独立评审的源/测试同步轮——源与测试修复与其验证属同一轮，本条目的文档落盘本身未改源码/测试（收尾轮的注释改写另见下方 Notes ①）。
- 未闭环（不阻塞 done，各自可单独立项）：① 真实浏览器 / Electron 视觉验收仍未执行（窗口化恢复为全量渲染后的长会话滚动、设置页常驻 tab 的隐藏/重载、diff 增删底色与标点色、复制反馈时长）；② KaTeX 公式渲染决策；③ `highlightAuto` 式未知语言猜测着色决策。
- Notes（只记录，不扩范围）：① `src/components/chat/panel-decoration/message-actions.ts:143-149` 的过时注释（“React ChatSurface still windows the conversation”）已在收尾轮改写为现状表述（窗口控制器保留但以 `enabled:false` 创建、`getWindowStart()` 恒为 0、装饰层拿到完整消息数组），纯注释、无逻辑改动；② 仓库根 3 个评审转义残留文件 `$($a`（1195 字节旧 CSS 抽取片段）、`5`（1386 字节旧 CSS 变量块 MAP）、`pruned)`（679 字节 color token 比对输出）已在收尾轮经 node `fs.readFileSync` 只读确认内容 + `fs.unlinkSync` 按精确路径删除，`git status --porcelain -uall` 复核无异常名残留；③ 本条目落盘时未做 Git 写操作，未触碰 `dist/`、`package-dist/`、`package-offline/`。

---

## self-hosted-chat-ui（done，2026-09-18 第七轮独立评审：从零取证修复 7 项回归）

- 目标/结论：feature 保持 done。本轮为第七轮独立评审：以 3e10f58 + pi-web-ui 0.75.3 app.css 为基线从零取证、不采信前六轮结论，自查自修 7 项回归，非新能力。
- 评审方法：3e10f58 旧实现（git show）+ `package-dist/dist/assets/index-B1G0LqYR.css`（含 pi-web-ui 0.75.3 app.css）从零取证，不采信前轮结论。
- 本轮修复 7 项：
  - ① `src/index.css` markdown 链接 hover 恢复 `@media(hover:hover)` 包裹 + `@supports` color-mix fallback 结构。
  - ② `CodeBlock.tsx` 菜单复制源码不再关菜单（copied 反馈可见，download/模式切换仍关）。
  - ③ 代码块菜单互斥经 document 级 CustomEvent（`quickforge:code-block-menu-open`）恢复（含键盘路径）。
  - ④ shell 块按钮顺序恢复 [复制][运行]。
  - ⑤ 运行按钮恢复 assistant 门控（`shellBlock && runInTerminalEnabled && assistant`）。
  - ⑥ `tool-renderers/shared.tsx` 的 `renderCodeBlock` 改用 code-highlight 高亮 + 1200ms copied 反馈（新增 `ToolCodeBlock` 组件）；`ToolDetails` 增加模块级 LRU(100) 开合记忆，跨 remount 持久。
  - ⑦ `SettingsWorkspacePage.tsx` customModels tab 首次激活后保持 mounted（hidden 隐藏，`index.css` 补 `[hidden]` display:none 规则），未保存表单跨 tab 保留。
- 新增/调整测试：chat-surface-css-contract、chat-code-block、tool-renderer-code-block.test.ts（新）、tool-renderer-shared-state.test.ts（新）、settings-workspace-react。
- 不改项清单（本轮取证确认，非遗漏；**已被第八轮推翻**：diff 增删高亮 token 缺失、标点 color-mix 混色约淡 28% 两项已在第八轮修复，见上方第八轮条目 ③④）：
  - CSS：~~diff 增删高亮 token 缺失~~；~~标点 color-mix 混色约淡 28%~~；复制按钮图标化弱化 hover 反馈；KaTeX 移除；代码块底外距 my-2；图片圆角新增；`:host` 规则移除（light DOM 验证无影响）；`--color-text-primary` 旧即无效。
  - 交互：SVG/mermaid 预览模式语言标题栏消失；run 按钮 stopPropagation 移除（无消费方）；`data-quickforge-action`→`data-qf-action` 契约变更；thinking-selector patch 改 prop；side-chat renderer 隔离随注册表本地化消除；number input 新增 Enter 提交并修复双提交；全 tab Suspense 瞬时 loading；info-tip/SettingsSelect/SettingsSwitch aria 增强；turn-navigation reject 路径保守化；流式期已提交消息 mermaid 预览不再强制移除；source 变化保留 preview/source 模式（旧重置为 preview）；装饰 pass 不再强制收起菜单；滚动意图收紧 A1/A3（触摸长惯性到顶不翻页边界）；~~窗口化重开 B1/F4/B5 连带（待真实浏览器验收）~~（**已被第八轮推翻**：`ChatSurface` 恢复 `createMessageWindow({ enabled: false })`，不再窗口化，见上方第八轮条目 ①）。
  - 不可考证：pi-web-ui 包内部行为；AbortedMessage 无历史记录。
- 验证：`npm run test` 355 files / 4190 passed + 1 skipped（scheduled-tasks 未触发既有 flake）；`npm run lint` 0 error / 3 warnings（coverage/ 既有）；`npm run build` 成功（2.83s）；依赖 diff 干净——package.json 仅移除 pi-web-ui/mini-lit/lit + 新增 jszip(dev)，lock 26 项移除 / 0 新增 / 0 升级。

---

## self-hosted-chat-ui（done，2026-09-18 第六轮一致性评审：移除 pi-web-ui 前后全面对比清单落盘）

- 目标/结论：feature 保持 done。本轮为第六轮独立一致性评审：全面对比移除 pi-web-ui/mini-lit/lit 前后的 CSS 与交互，确认仅需修复 2 项并扩充契约测试、落盘对比清单，非新能力。
- 评审方法：对比 3e10f58 旧 `src/index.css`（git show）+ `package-dist/dist/assets/index-B1G0LqR.css`（其中 pi-web-ui app.css 注入部分）+ 旧 panel-decoration 源码三源对照。
- 一致项（等值迁移/逐字一致，未改动）：链接 a/a:hover color-mix 80% 无 offset/transition；表格无斑马纹、无 thead 规则；行内代码取值；`--qf-hl-*` 对齐 `--syntax-*`；对话框 keyframes 180ms；`--quickforge-dur-*`/ease token；主题 token；滚动条（含 thumb:hover 透明，与旧版逐字相同）；conversation-enter/waiting-enter/waiting-dot/composer 160ms/svg 菜单 160ms 逐字一致；markdown 排版；`--text-sm--line-height`。
- 交互保留：panel-decoration 36 个装饰器全保留（command-suggestions、message-queue、plan-mode-controls、editor-bindings、composer-plus-menu、send-stop-button、scroll-to-bottom-button、message-actions、process-folding、input-clamp、local-file-path-links、ask-user/approval、agent-access-menu）；SettingsSelect 全键盘交互等价；MessageEditor Enter/IME/Escape 等价；scroll-sync/windowed-messages 契约不变。
- 本轮修复 2 项：
  - ① `.animate-shimmer` 补 `@media (prefers-reduced-motion: reduce) { animation: none; }` 豁免（对齐 DESIGN_LANGUAGE「所有 keyframes 必须有 prefers-reduced-motion 降级」约束，`src/index.css`，就近放在 shimmer 规则旁并带注释）。
  - ② `.qf-markdown-block :not(pre) > code` 补 `line-height: var(--text-sm--line-height);`（对齐旧 `.markdown-content code:not(.hljs)` 的行高取值，放在 font-size 之后并加注释，`src/index.css`）。
- 契约测试扩充：`tests/frontend/chat-surface-css-contract.test.ts` 新增行内 code 字号+行高断言；`tests/frontend/motion-design.test.ts` 新增 `.animate-shimmer` 的 reduced-motion `animation: none` 豁免断言。
- 已知边界（不可考证/有意保留）：ApiKeyPromptDialog 的 pi-web-ui 原版动画/焦点陷阱不可考证（保持无动画，与旧版 app.css 无 dialog keyframes 一致）；code-block 折叠细节在旧 shadow DOM 内不可考证（现 max-h-96 滚动）；KaTeX 随包移除；pi-web-ui shadow DOM 内部样式不可取证。
- 验证：定向 `npx vitest run tests/frontend/chat-surface-css-contract.test.ts tests/frontend/motion-design.test.ts` **2 files / 30 passed**（motion-design 14、css-contract 16，各含本轮新增 1 例）；全量 `npm run test` 353 files / 4173 passed + 1 skipped、`npm run lint` 0 error / 3 warnings（coverage/ 生成目录，既有）、`npm run build` 成功。
- Notes（不扩范围）：
  - SettingsSelect `disabled && expanded` 时存在 render 期 setState 反模式（旧版同源逻辑，行为等价，未改）。
  - moveSelectFocus 未聚焦态 ArrowUp 落点新旧微差：新版落末项，已有测试锁定。
  - plan-mode-controls 与 local-file-path-links 缺专门键盘交互测试。

---

## self-hosted-chat-ui（done，2026-09-18 评审轮：对比移除 pi-web-ui 前后交互与 CSS，自查自修）

- 目标/结论：feature 保持 done。本轮为第五轮独立评审：对比移除 pi-web-ui 前后的交互与 CSS，自查自修 5 项回归，非新能力。
- 评审方法：基线 3e10f58（git show 取旧实现）+ `package-dist/dist/assets/index-B1G0LqYR.css` 旧 CSS 对比源 + pi-web-ui 0.75.3 npm tarball 取证。
- 修复 5 项：
  - ① `.qf-markdown-block a:hover` 恢复 `color-mix(in oklab, var(--primary) 80%, transparent)` 变色；链接去掉 underline-offset-4。
  - ② markdown 表格恢复旧样式：去卡片容器、恢复竖向列分隔线、muted 表头、0.5rem padding、左对齐 semibold，值照抄旧 `.markdown-content` 规则（`src/index.css` + `Markdown.tsx`）。
  - ③ `ApiKeyPromptDialog` 补 Escape 关闭：`isDialogEscapeKey` 纯函数 + window keydown 监听 + 单测（`tests/frontend/chat-surface-api-key-dialog.test.ts`）。
  - ④ 代码高亮 `--qf-hl-*` 配色对齐旧 `--syntax-*`：keyword/string/comment/tag 直配、function←entity、number/property/attr←constant、builtin←variable；heading/list/diff± 无对应 token，记为已知差异。
  - ⑤ ThinkingBlock 自带 header 兜底观感对齐装饰层：88%/86% color-mix、chevron hover 渐显（`src/index.css`）。
- 一致项结论（等值迁移/逐 token 一致，未改动）：滚动行为、code block 交互（shell 语言集/危险命令正则/SVG/mermaid 防竞态）、composer 全链路、消息操作与 retry 可见性、主题 token、滚动条、动画、消息气泡。
- 误报澄清：composer 内联控件装饰层仍注入全部 quickforge-* class，旧 CSS 非 dead code。
- 验证：定向 vitest 7 files / 102 passed（含 api-key-dialog 新增 Escape 用例、css-contract 链接/表格断言扩充）+ 改动 TS 文件 eslint 0 error；全量 `npm run test` 353 files / 4171 passed + 1 skipped、`npm run lint` 0 error / 3 warnings（coverage/ 生成目录）、`npm run build` 成功。`feature_list.json` 状态未变，本轮 5 个改动文件均已在其 files 数组中，无需重复登记；JSON.parse 复验通过。
- Notes：
  - 装饰层锚定 `.flex.gap-2.items-center` 与 `textContent.includes(model.id)` 无契约测试保护，未来 JSX 重构会静默失效，建议单独小项加固。
  - 附件 tile 容器 gap-2 与旧 margin 规则叠加，旧容器间距不可考。
  - `ApiKeyPromptDialog` Save 不再联网验证 key（有意简化）；Enter 提交为新增增强。
  - a:hover 未包 `@media(hover:hover)`（与仓内其他 hover 规则风格一致）。
  - color-mix fallback 全量移除（现代浏览器无影响）。

---

## self-hosted-chat-ui（done，2026-09-18 移除 pi-web-ui 后 CSS/交互回归修复轮）

- 目标/结论：feature 保持 done。本轮修的是 React 聊天面相对旧 pi-web-ui 的真实回归，不是新能力。
- 修复：
  - Markdown 排版：`src/index.css` 恢复 unlayered `.qf-markdown-block` 标题/段落/列表/引用/链接/code/hr；文件头注释纠正 `.markdown-content` 不是 unused web-component CSS。字号选择器补 `.qf-assistant-message` / `.qf-user-message`；用量条隐藏改 `.quickforge-composer + .qf-usage-bar`；窄屏气泡与 first/last margin reset 补 `.qf-user-message`。
  - `Markdown.tsx` 工具类对齐（underline / my-4 list / hr my-8 / inline `bg-muted`），不加 h1–h6/p 组件。
  - 双滚动所有权：删除 ChatSurface 的 `< 10px` 监听与无 atTail 检查的 ResizeObserver 贴底；layout 仅在 `autoScrollRef && atTail` 跟随；`ChatPanelHost` 的 `onReachTop` 用 `beginProgrammaticScroll` 包 `loadMoreMessages`。窗口化保持开启。
  - loadMore 的 programmatic-scroll 守卫改为等窗口 commit/scrollTop 还原后再 end，不再用双 rAF。
  - `message-actions.ts` 注释改为「React surface 仍窗口化，host 传 getWindowStart()」。
- 有意不移植：KaTeX、artifacts 面板、highlight.js 调色板；未做真实浏览器 QA。
- 验证：定向 vitest **7 files / 84 passed**；改动 TS 文件 eslint **0 error**。未改 `feature_list.json` 状态。未跑全量 test/lint/build。

---

## self-hosted-chat-ui（历史：done，2026-09-18 T1-T9 全量自研收尾）

- 目标/结论：T1-T9 全部落地并收尾，feature 置 done。@earendil-works/pi-web-ui、@mariozechner/mini-lit、lit 三个 UI 运行时依赖已卸载，聊天面板、工具渲染、存储层、设置页、i18n、附件解析全量自研，包内无残留往返。迁移前基线 342 files / 3964 tests（阶段中途曾记录 340 files / 3947 passed + 1 skipped，已被本轮覆盖）。
- 最终架构：
  - 存储层 `src/storage/`：`AppStorage` + 4 个 Store（settings、provider-keys、sessions（含姊妹 sessions-metadata）、custom-providers），`StorageBackend`/`StorageTransaction` 为纯契约接口；唯一后端实现仍是 `src/lib/http-storage-backend.ts`（本地服务 HTTP 持久化，含 provider-keys 内存缓存），`SessionsStore` 双 store 事务聚合为单次 `/api/storage/batch`；模块级单例 `getAppStorage()/setAppStorage()`，`pi-chat.ts` 与 `SharedConversationPage` 各自构造后注册同一实例。
  - 工具渲染 registry：`src/lib/tool-renderer-registry.ts`（模块内 Map）+ `src/lib/tool-renderers/*`，`render()` 返回 `{ content: ReactNode, isCustom }`，class 链与 DOM 结构逐字复刻原 html 模板；不再有包级 process-wide 注册表，因此删除 `side-chat-renderer-isolation.ts` 及对应测试。
  - React surface：`src/components/chat/surface/`（18 文件：第一轮复核新增 `CodeBlock.tsx`，第二轮复核删除死组件 `AbortedMessage.tsx`，对齐轮新增 `surface-context.ts`），ChatSurface 取代旧 `ChatPanel` + `AgentInterface`（消息列表/composer/流式/思考块/工具消息/代码块/usage/附件/API key 弹窗），沿用既有 class 链以兼容共享 CSS 与 panel-decoration；`ChatPanelHost` 内化 panel-decoration 接线；`scroll-sync.ts` 与 `windowed-messages.ts` 契约不变（窗口化控制器保留原行为）。
  - 设置页：`src/components/settings/tabs/*` + `SettingsSelect`/`settings-select-state`；旧 `src/lib/*-settings-tab.ts`（13 文件）与 `info-tip.ts`/`quickforge-settings-select.ts`/`patch-thinking-selector.ts` 删除。
  - 主题：`src/index.css` 不再 `@import "@earendil-works/pi-web-ui/app.css"`（87KB 预构建 bundle），本地重建 tokens/Tailwind 语义色/body 基线/滚动条/shimmer，取值不变；`vite.config.ts` 删除 lit-vendor、pi-web-ui、@mariozechner 的 manualChunks。
  - 附件：`attachment-loader.ts` 本地解析 PPTX/DOCX；Markdown 走 react-markdown + remark-gfm。
- 关键决定：**显式声明 jszip（^3.10.1）为直接依赖**，而不是继续依靠传递依赖——pi-web-ui 已卸载，PPTX/DOCX 解析需要稳定的直接依赖边界与可复现的 lock；这是本次唯一的新增依赖（同时卸载 3 个包，package.json 与 package-lock.json 保持一致）。jszip 落在 `package.json` 的 `devDependencies`（与 react/react-markdown 等其他前端依赖一致，最终由 Vite 打进 bundle），`package-lock.json` 中已按 `^3.10.1` 解析到 jszip 3.10.1，声明与 lock 同源、无隐式传递依赖。
- 验证（2026-09-18 终态，R1-R11 复核修复后复跑）：`npm run test` **349 files / 4067 passed + 1 skipped**（exit 0；迁移前基线 342 files / 3964 tests，上一轮收尾记录的 347 files / 4022 passed + 1 skipped 已被本轮覆盖）；`npm run lint` **0 errors / 3 warnings**（3 个 warning 全部来自 `coverage/` 生成目录的 eslint-disable 指令，非源码）；`npm run build` **成功**（exit 0，tsc -b + vite build，仅既有 chunk 体积 warning）。体积：dist/assets 合计 **16.34MB → 13.93MB**（本轮按当前 dist 复算 = 14606882 字节；pi-web-ui 3.58MB chunk 与 lit-vendor chunk 消失）；`dist/index.html` 首屏 modulepreload **6.48MB → 2.80MB**（本轮复算 11 个 modulepreload link 合计 = 2936844 字节；上一轮收尾复算为 13.94MB / 2.82MB，差异来自本轮源码微调后的重新构建）。依赖：package.json 与 package-lock.json 一致，卸载 @earendil-works/pi-web-ui / @mariozechner/mini-lit / lit，仅新增 jszip（^3.10.1）直接依赖。文档：wiki 新增 `docs/wiki/src/storage/README.md`，更新 src/、src/components/、src/lib/ 与 root-config。
- 本轮复核修复（R1-R11 回归 + 三处小缺陷）：迁移落地后经独立复核发现并修复 11 项回归——① **代码块能力 React 化**：新增 `src/components/chat/surface/CodeBlock.tsx`，删除 `src/components/chat/panel-decoration/code-blocks.ts` 的 DOM/Lit 装饰实现，复制按钮、终端执行（含流式禁用与危险命令标记）、SVG 预览（仅 assistant 消息的自包含 SVG）、mermaid 工具栏与流式降级在 React 侧重建（配 `tests/frontend/chat-code-block.test.ts`）；② **composer DOM 契约**：`panel-decoration/editor-bindings.ts` 恢复 composer 卡片/输入区选择器与事件契约（`tests/frontend/editor-bindings.test.ts` 新增 167 行断言）；③ **附件 tile 选择器**：`surface/AttachmentTile.tsx` 修正 tile 选择器；④ **surface 文案 i18n**：`src/lib/i18n.ts` 键增补，surface/composer 文案改走词典；⑤ **思考等级口径**：统一 thinking level 取值口径；⑥ **侧边会话模型按钮**：`ChatPanelHost.tsx` 模型按钮显示判断；⑦ **过程折叠所有权租约**：`panel-decoration/process-folding.ts` 与 ChatSurface 的 `ProcessGroupReleaseBoundary` 引入所有权交还语义（`releaseProcessGroups` 只回收 React 当前不持有的节点；`message-queue.ts`/`assistant-waiting-bubble.ts` 随 DOM 契约同步修正），新增 `tests/frontend/process-folding-ownership.test.ts`。三处小缺陷一并修复：双转义换行、硬编码中文、死选择器。
- 遗留风险/未做：① 未做真实浏览器或 Electron 客户端验收——主题 token 视觉、滚动锚定与 scroll-sync、附件预览（PPTX/DOCX/图片）、长会话窗口化、设置各 tab 仅在 jsdom + 单测层面覆盖；② pi-web-ui 内置 artifacts 面板未一对一等价复刻（HEAD 版仅在 side-chat 分支 `panel.artifactsPanel?.remove()`，面板与 `artifacts` 工具渲染器均由包内置提供），当前只有 `onArtifactsChange` + `extractSessionArtifacts` 抽取链路 → App 工作区产物/预览路径；原包已卸载无法逐项比对，如确需该能力应单独立项；③ KaTeX/highlight.js/旧 web-component 选择器随 app.css 移除，新 Markdown 未引入公式与代码高亮渲染。
- Notes：本轮收尾只改 `feature_list.json`、`progress.md`、`session-handoff.md` 三个文档，未改源码/测试；JSON 已用 node `JSON.parse` 复验通过。
  - 环境备注：`init.sh` 为 CRLF 换行（21 行 CRLF、0 行纯 LF），在 Git Bash/WSL 下直接 `bash init.sh` 可能因 `\r` 报错；本轮未运行 init.sh，直接执行 `npm run test/lint/build`。
  - 根目录由本轮迁移期间的命令转义事故产生的若干 0 字节未跟踪文件已清理（非本 feature 产物）。
  - 本轮终态刷新（同样只改 `feature_list.json`、`progress.md`、`session-handoff.md`，未改源码/测试）：补充 R1-R11 回归修复与三处小缺陷记录，verification 更新为终态数字；`feature_list.json` 已用 node `JSON.parse` 复验通过。
  - 待定项：附件 tile 的 `title` 仍用全角冒号拼接（英文界面显示为 `...：path`），分隔符本地化待产品决策。
  - 后续可立项项：① 真实浏览器/Electron 客户端验收（composer 卡片观感、CodeBlock 交互、窗口化滚动锚定、附件预览、暗色组合、过程折叠所有权租约在真实 React commit 时序下的表现）；② pi-web-ui 内置 artifacts 面板的等价能力（当前 QuickForge 不产出 artifact 角色消息，仅保留 `onArtifactsChange`/`extractSessionArtifacts` 链路，历史数据若含该类消息不可见）。
- 第二轮复核修复（M1/M2/L1/L5/L6 + 终态清理，仍只改三个状态文件，未改源码）：
  - M1/M2 **CSS ⇄ DOM 结构契约失效**：`src/index.css` 中按「消息根的直接子级」书写的两条规则（assistant 用量行隐藏、用户气泡右对齐）在迁移到 React 层级后静默失效（旧层级选择器不报错），按同一层级重建 CSS 与组件结构；新增 `tests/frontend/chat-surface-css-contract.test.ts`，对同一份契约同时断言 CSS 与 `renderToStaticMarkup` 渲染结构（`AssistantMessage`/`UserMessage`）。
  - L1 **失效装饰与假契约测试**：删除已失效的子代理装饰函数及其假契约测试 `tests/frontend/decorate-subagent-process.test.ts`（原测试只断言源码字符串，不反映真实行为）。
  - L5/L6 **文案 i18n 化**：`src/components/chat/panel-decoration/local-file-path-links.ts`（openLocalFile/openLocalFileWithPath）、`src/components/chat/context-usage.ts`（gitBranchLabel）去硬编码英文改走词典，surface 与装饰层文案补齐词条，`src/lib/tool-renderers/shared.tsx` 的 `run_command` 输出标签（Command/STDOUT/STDERR/Status/Exit code）本地化，`src/lib/i18n.ts` 键增补；新增 `tests/frontend/decorator-copy-i18n.test.ts` 覆盖装饰层文案与工具卡状态/命令输出标签的中英双语言。
  - 其他清理：删除死组件 `src/components/chat/surface/AbortedMessage.tsx`（surface 由 18 文件变为 17 文件）、修正过时注释与硬编码。
  - 既定约定：`appTranslations` 的 en/zh 键集合必须一致（当前 **1649/1649**，由 `tests/frontend/decorator-copy-i18n.test.ts` 断言键集合相等）；文案断言前显式固定语言（`applyAppLanguageFromSnapshot('en'/'zh')`），避免依赖机器 `navigator.language`。
- 终态验证（2026-09-18，**覆盖上文「R1-R11 复核修复后」的 349 files / 4067 等阶段数字**）：`npm run test` **350 files / 4078 passed + 1 skipped**（exit 0）、`npm run lint` **0 errors / 3 warnings**（3 个 warning 全部来自 `coverage/` 生成目录的 eslint-disable 指令，非源码）、`npx tsc -b` **通过（无输出）**、`npm run build` **成功**（exit 0，built in 2.47s，仅既有 chunk 体积 warning）；体积：dist/assets **16.34MB → 13.93MB**（本轮复算 14607927 字节 / 255 文件）、`dist/index.html` 首屏 11 个 modulepreload **6.48MB → 2.80MB**（2938650 字节）；i18n en/zh 键对齐 **1649/1649**（原记 1643/1643 为误记，已于本轮全面评审自查自修轮更正）。
- 终态遗留项：① 注释旧命名已清理——`src/components/chat/windowed-messages.ts`（第 26/30 行）与 `src/components/chat/surface/MessageList.tsx`（第 10 行）的 `<message-list>` / “the package implementation” 已改为 React `MessageList` 现状表述（第 8 行保留 “legacy `<message-list>`” 溯源说明），仅为注释、无行为影响；② 真实浏览器/Electron 验收仍未做（同下文可立项项①）；③ 聊天 Markdown 代码块**无语法高亮**（highlight.js 随依赖移除，见 feature_list boundaries）；④ 如后续需要发布，按 `docs/architecture/patch-release-runbook.zh-CN.md` 走 patch 版本流程（发布前必须完整通过 test/lint/build）；⑤ artifacts 面板等价能力与附件 tile 全角冒号本地化仍待产品决策。
- 未提交：无 Git 写操作，未 commit/tag/push，全部改动留在工作区；未手工修改 dist/、package-dist/、package-offline/。
- 对齐轮（第三轮独立复核，2026-09-18，源码/测试/文档/状态文件一并更新）：
  - 附件预览安全加固 10 项：Markdown 渲染结果超链接净化（`isAllowedAttachmentHref` 白名单 + 危险 href 置 `#` + 全链接 `rel=noopener noreferrer`/`target=_blank` 硬化 + 携带可疑标记的 style 元素移除）、zip 解压条目数与解压后体积上限、超长内容截断、PDF 渲染页数上限、渲染超时、Excel 50 列/5000 行采样与稀疏 `!ref` 收窄（i18n 截断提示）、预览 ErrorBoundary、下载容错、pdfjs `isEvalSupported:false`（attachment-loader 与 AttachmentPreview 两处）；回归 `tests/frontend/attachment-preview-security.test.ts`。
  - 行为对齐 5 项 + 3 项小修：模型切换经 `chatPanelRevision` 刷新快照（`readAgentSnapshot` 读活 state，原地换模型不再漏刷新）、composer 挂载一次性聚焦（对齐 legacy firstUpdated，不随重渲染抢焦点）、side-chat/只读面板终端命令门控改 `surface-context.ts` 的 `CommandActionsEnabledContext`（宿主按 `!sideChatMode && !readOnly` 提供，默认 fail-closed，不再按 composer DOM 探测）、`onInitialRenderReady` 渲染屏障双 rAF、滚动恢复阈值放宽；另修菜单定位回调读旧值与死参数清理。回归 `tests/frontend/chat-surface-behavior-alignment.test.ts`（5 例）。
  - 样式对齐 3 项：MCP/subagent 工具渲染器 `isCustom:true` 压平默认卡片包裹、渲染器根级样式重置、UsageBar button 样式覆盖。
  - 存储：`SessionsStore.updateTitle` 双 store（sessions + sessions-metadata）单事务原子化 + 幂等守卫，中途失败不再产生标题分叉；并修相关测试隔离。
  - 自研语法高亮：新增 `src/lib/code-highlight.ts`（1459 行，零新依赖）——16 组语言（javascript/jsx、typescript/tsx、json、bash/sh、python、css/scss/less、html/xml/svg、sql、java、c、cpp、go、rust、yaml、markdown、diff）单遍线性 sticky-regex tokenizer（O(n)、无嵌套量词防回溯灾难）、`MAX_HIGHLIGHT_LENGTH`=200KB 护栏、未知语言回退纯文本；`CodeBlock.tsx` 消费（`qf-hl-*` token class），关闭「无语法高亮」迁移缺口。已知局限（阅读级启发式）：JS/TS 模板串插值不再分词、正则字面量按前置显著 token 启发式（含 `/` 字符类可提前截断）、JSX/Rust 嵌套注释与 bash heredoc/YAML block scalar 近似、流式中未闭合串/注释吞到行/块尾并随文本到达自愈。回归 `tests/frontend/code-highlight.test.ts`。
  - 对齐轮终态验证（2026-09-18，覆盖上文 350 files / 4078 等阶段数字）：`npm run test` **353 files / 4159 passed + 1 skipped**（exit 0）、`npm run lint` **0 errors / 3 warnings**（全部为 coverage/ 生成目录的 Unused eslint-disable 指令，非源码）、`npx tsc -b` **通过（无输出）**、`npm run build` **成功**（exit 0，built in 3.19s，仅既有 chunk 体积 warning 与 pi-ai node:fs externalize 提示）；体积：dist/assets **14637992 字节 / 255 文件（约 13.96MB）**、`dist/index.html` 首屏 11 个 modulepreload 合计 **2939761 字节（约 2.80MB）**；对齐轮零新增依赖。
  - 垃圾清理与文档同步：仓库根 0 字节异常名文件 `')`（前会话命令转义事故遗留、git 未跟踪）经 node fs 确认 size=0 后 unlink；git status 复核无其它 0 字节/异常名文件（`skills/skill-creator/scripts/__init__.py` 为被跟踪的合法 Python 包标记，保留）。wiki 同步：`docs/wiki/src/README.md`（决策记录改「语法高亮已自研补齐」，保留 KaTeX 边界）、`docs/wiki/src/components/README.md`（CodeBlock 条目 + surface-context 门控 + 目录树补 surface-context.ts）、`docs/wiki/src/lib/README.md`（新增 code-highlight.ts 表格条目）；`feature_list.json` approach（⑪对齐轮）/boundaries（关闭「无语法高亮」②⑦与 KaTeX/syntax-highlight 段，保留 KaTeX 缺失边界）/verification（终态数字）/files（+5 路径：code-highlight.ts、surface-context.ts 与三个新测试，核对存在且无重复）已同步，JSON.parse 复验通过。
  - 对齐轮遗留（backlog，不阻塞 done）：① 流式性能三叠加优化 backlog（待单独立项）；② 7 个设置 tab 无专属测试（依赖 settings-react-harness 共享回归）；③ Excel 预览未虚拟化（5000 行采样上限兜底，超大表仍可能卡顿）；④ pi-ai 1.6MB 独立 chunk 未懒加载（可后续 code-split）；⑤ 真实浏览器/Electron 验收清单仍未执行（composer 观感、CodeBlock 交互、高亮着色视觉、滚动锚定、附件预览、暗色组合）。
- 全面评审 + 自查自修轮（第四轮独立复核，2026-09-18，源码/测试/文档/状态文件一并更新，覆盖上文 353 files / 4159 等阶段数字）：
  - 竞态与时序：`src/components/chat/surface/MessageEditor.tsx` 改用 `attachmentsRef` 消除 `addFiles` 异步竞态（连续选择/粘贴附件不再丢文件）；`surface/ChatSurface.tsx` 的 effect 依赖收敛为 `[agent]`、清理冗余 `resumeTail`、prompt 转发按是否重载分流并补注释。
  - 渲染：`surface/AssistantMessage.tsx` 去掉 Fragment 的 index key（改用消息内稳定 key）。
  - 安全：`surface/AttachmentPreview.tsx` 的 docx 后置 sanitize 补 `img[src]` 协议校验；`surface/Markdown.tsx` 新增 `isSafeMarkdownImageSrc`（拦截 `javascript:`/`data:` 等危险 scheme）。
  - 无障碍：`MessageEditor` 的 thinking select 与 file input 补 `aria-label`；`src/components/settings/settings-select-state.ts` 未聚焦时 ArrowUp 落最后一项（与聚焦态口径一致）；`surface/UserMessage.tsx`/`surface/AttachmentOverlay.tsx` 测试钩子类名补注释。
  - 死代码与契约：`src/index.css` 删 3 处死选择器（含 `settings-dialog`/`settings-tab` 旧 Lit 契约残留）；`src/storage/stores/sessions-store.ts` 删零引用的 `deleteSession` 别名（被测试引用的 3 个别名保留并加注释）；`src/storage/types.ts` 的 preview 注释修正为 last assistant / 200 chars；`src/lib/http-storage-backend.ts` 对 2xx 但非法 JSON 抛明确 Error（不再静默返回空）；`src/lib/local-tools.ts` 补 MCP 渲染器先到先得注释；`src/App.tsx` 的 `PREVIEW_ARTIFACT_EVENT` 注释指向修正；`src/lib/subagent-run-detail.ts`/`input-clamp.ts`/`server-agent.ts`/`src/components/workspace/useInspectorTabs.ts` 共 9 处过时注释修正；`docs/bug/frontend-bugs.md` 的 F-03 标注失效。
  - 类型与高亮：`MessageEditor.tsx` 的 `EditorFileLike` 放宽为 `{ size: number }`（与调用方实际传入形状一致）；`src/lib/code-highlight.ts` 给 JSX 插值递归加深度上限 32（含既有 round-trip bug 修正）。
  - i18n 与清理：`src/lib/i18n.ts` 3 行缩进 5→4 空格；删除仓库根 0 字节垃圾文件 `m[1])`（命令转义事故遗留、未跟踪）。
  - 新增/扩充测试：code-highlight 深嵌套畸形输入 3 例、settings-select 未聚焦方向键 1 例、MarkdownBlock image safety 3 例、attachment-preview-security 的 `sanitizeAttachmentImages` 1 例 + `FakeImage` fixture。
  - 验证（2026-09-18 本轮终态）：`npx tsc -b` **0 错误**；`npm run test` 全量 **353 files 全通过 / 4168 passed + 1 skipped**；`npm run lint` **0 error / 3 warning**（全部来自 `coverage/` 生成目录，可接受）；`npm run build` **成功**（3.49s）。
  - Notes：
    - 已知偶发 flake（与本次改动无关）：`tests/server/scheduled-tasks.commands.test.mjs` 第 192/593 行用例在高负载全量并行下偶发失败——均为 `vi.waitFor` 的 10s wall-clock 等待在 SQLite/IO 尖峰下超时，复跑即过；该测试与被测 server 源文件都不在本轮改动范围内。
    - i18n 键数更正：实测 `appTranslations` en/zh 均为 **1649/1649**；上文第二轮记录写的 1643/1643 为误记，已在上文就地更正。
    - `feature_list.json` 中本 feature 的 `files` 数组（131 项）**非穷尽**，实际改动约 143 个文件，数组只登记主要路径。
    - 未处理/记 Notes 项（不阻塞 done，各自可单独立项）：① tool-renderers 各渲染器类未 `implements ToolRenderer`（类型安全弱化，仅靠 registry 契约约束）；② CodeBlock 预览图放大无键盘可达 + lightbox 无焦点捕获/归还；③ `ApiKeyPromptDialog` 无 Escape 关闭且输入框未 autofocus；④ docx-preview 第三方属性复制面未逐行审计。

---

## self-hosted-chat-ui（历史阶段：in_progress，2026-09-18 T6 通知修复；结论已被上方 done 记录取代）

- 当前目标：按已授权方案一次性移除 pi-web-ui/mini-lit/lit，保留前序全部改动；阶段进度 **T1-T5 完成、T6 进行中、T7-T9 待办**，不标 done。T6 新 settings tabs 尚待完成接入及整体验证。
- 本次改动：`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx` 区分通知持久化函数别名与 React state setter；关闭落盘 false，授权落盘 true，拒绝/prompt/unsupported/异常回滚 false，加载检测旧启用值权限失效时也清理落盘。保留旧请求前启用的 native 初始化顺序；授权期间开关 disabled，最终 UI 与持久化一致。
- 定向 lint 首次发现本 tab 迁移遗留的 render refs 与 mount effect 规则错误；限定本文件处理：镜像只由加载与事件更新，渲染改读 state，代理 finally 清 saving；一次性异步加载仅保留有理由的局部 effect lint 例外。未修改 shared、设置入口、其他 tab 或依赖。
- 新独立测试 `tests/frontend/default-options-settings-react.test.ts` 13 例直接驱动新 React tab 渲染回调，并使用真实通知 localStorage 持久化；覆盖权限/开关/异常/初始恢复/测试通知，以及已加载兄弟设置保存和代理连续刷新。旧 tab 测试未重写。
- 验证：`npx vitest run tests/frontend/default-options-settings-react.test.ts tests/frontend/system-notifications.test.ts` **2 files / 31 passed**；组件与新测试定向 ESLint **exit 0，无 warning**。此前 **340 files / 3947 passed + 1 skipped 仅为历史阶段验证**，不能当作当前最终状态；最终全量 test/lint/build、浏览器验收未完成。
- Notes：新旧 tab 静态翻译键集合一致，未发现明显丢失翻译；发现 3 个数字输入旧 native change+blur 提交现为 React onChange 编辑+onBlur 提交，Enter/步进器提交时机待 T6 整体接入时确认，不在通知修复内扩大交互变更。native 系统权限/真实通知仍需实际客户端验收。本次局部通知修复不改变公共入口，独立 wiki/SVG 无需新增；整体迁移的 wiki/依赖收尾待后续阶段。无 Git 写操作或生成产物修改，所有无关历史记录保留。

---

## remove-cloud-service（done，2026-09-18）

- 目标：完全移除 QuickForge Cloud 云服务——服务端 `server/cloud/`、`/api/cloud/*` BFF 与全部耦合点；前端云库/组件/设置页/移动云 tab/词条/样式；配套测试删除与修复；文档/wiki/用户指南同步。
- 改动文件：阶段A/B（服务端+前端+测试，见 feature_list.json 完整清单）；阶段C（本阶段）：删除 docs/architecture/quickforge-cloud-client.zh-CN.md、docs/architecture/cloud-admin-console.zh-CN.md、docs/design/remote-access-p2p.md、docs/design/cloud-admin-console-wireframe.svg、design-mockups/cloud-url-row-redesign.html 共 5 个云专属文档；docs/architecture/android-remote-client.zh-CN.md 顶部加状态说明（云服务已移除、Android 原生云代码暂留待后续清理、云远程功能不可用、正文保留作历史参考）；wiki 6 页去云（server/README：删目录树 cloud/ 行与 cloud 小节、AI 流包装层云幂等键/懒解析、ACP/远端访问/Git 提交 Cloud 表述；server/routes/README：删 cloud.mjs 表行与小节、models/shares/side-chat/shared-conversation/scheduled-tasks 云语句与 allowCloudUsage；src/README：删 cloud/ 目录、设置页云 tab、Android 云账户入口（更新为仅局域网/Tailscale 直连）、hooks 19→18；src/lib/README：删 cloud-client 条目与小节、pi-chat/model-reference/default-options/startup 云描述；src/hooks/README：删 useCloudModels 条目与小节、启动步骤云预取；src/components/README：删 cloud/ 目录行与 CloudAccountSettingsPage 小节）；docs/user-guide.zh-CN.md 与 en-US.md 删云模型规则语句与「正式账户登录与注册/Sign in or register」章节（编号 1-11 与目录锚点不受影响）；feature_list.json、progress.md、session-handoff.md。
- 验证：2026-09-18 全量 npm run test 333 files / 3900 passed + 1 skipped（exit 0）；npm run lint 0 errors（仅既有 coverage 3 warnings）；npm run build exit 0（仅既有 KaTeX/chunk warnings）。残留扫描：docs/wiki 与 user-guide* 无 cloud/云服务/云账户/云模型/allowCloud 残留（grep 复核）。
- Blocker：无。
- Notes：关键决策——①分享 SQLite 列 allow_cloud_usage 保留（API 不再接收/返回 allowCloudUsage）；②旧云模型引用（source:'cloud'）自然降级为 model_not_configured，不清理数据；③Android 原生云代码与 capacitor.config.ts 保留暂留待后续清理；④遗留本地云数据（cloud-identity.json 等）不主动清理。docs/wiki/README.md 首页经查无指向被删文档的链接，无需修改。改动未提交，与并行会话 project-commands-settings-ux 未提交改动（project-commands-settings-tab.ts、i18n.ts、tests/frontend/project-commands-settings-tab.test.ts、docs/wiki/src/lib/README.md 及三状态文件）共存，仅做增量追加/局部编辑。

---

## lan-access-info-tip（done，2026-09-18）

- 目标：局域网访问设置 tab 的 7 处静态说明文字（lanAccessEnabledDescription、lanAccessPasswordStatusDescription、lanAccessActiveDevicesDescription、lanAccessUrlsDescription、lanAccessAllowFullDescription、lanAccessSessionTtlDescription、lanAccessActionsDescription）由常驻段落收敛到各节标题旁 quickforge-info-tip，参考 default-options-settings-tab.ts 既有模式，符合 DESIGN_LANGUAGE.md「辅助说明应收拢」规范；纯 UI 文案收纳，行为不变。
- 改动文件：src/lib/lan-access-settings-tab.ts、progress.md、session-handoff.md。
- 验证：npx eslint 通过；npm run build 通过（仅既有 KaTeX/chunk warning）；无现有相关测试，未新增测试。
- Blocker：无。
- Notes：纯 UI 文案收敛，无架构/公共入口/发布流程变化，docs/wiki 无需更新；非 feature_list.json feature 项，feature_list.json 未动；无 Git 提交。

---

## project-commands-settings-ux（done，2026-09-17）

- 目标：设置-项目命令 tab 两项交互优化——新建命令由 window.prompt 改为 showPrompt 弹窗（en/zh 新增 newCommandNamePlaceholder 占位文案）；打开命令目录由硬编码 .ai/commands 改为取 commandDir 配置首个非空行（空则回退 .ai/commands）。
- 改动文件：src/lib/project-commands-settings-tab.ts、src/lib/i18n.ts、tests/frontend/project-commands-settings-tab.test.ts（新增 7 用例）、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 vitest 9 用例通过；eslint 0 错；tsc -b 通过。
- Blocker：无。
- Notes：① 打开目录取 commandDir 首行与新建命令固定落盘 .ai/commands 存在不对称（服务端行为，未改）；② 该 tab 其余 UX 问题（来源标注、编辑/删除、目录选择器、提示不自动消失）未在本次范围。

---

## dead-code-cleanup-round2（done，2026-09-17）

- 目标：死代码清理 round2——`cleanup/dead-code` 分支（基线 `dev@10ecfebe8e6b29cf40f010e2df40efc70653003c`）四区扫描产出 18 项候选（报告 `docs/reports/dead-code-candidates-2026-09-16.zh-CN.md`），用户逐项确认后执行删除。
- 扫描（2026-09-16）：入口白名单 + 动态引用排查 + grep 排除生成目录，产出 A1-A3 前端死类型/死导出、K1-K9 server 兼容路由/恒假链/孤儿模块、O1/O2/DEP1/D1/D2/D3 杂项共 18 项候选；本轮零删除、仅固化报告与三状态。
- 执行（2026-09-17）：用户确认删除 15 组、K8 保留。K1-K6 死/兼容路由（server/routes 4 文件 + `server/index.mjs` 分发注册 + `server/utils/package-update.mjs` 孤儿链 cooldownLoad/updateCheckCooldowns/QUICKFORGE_LATEST_RELEASE_API_URL + 对应测试用例与 wiki 路由/browser-cache-strategy/server README 文档同步）；K7 前端 confirm 恒假链（goal.ts goalCanConfirm+'confirm' 字面量、goal-card.ts confirmable、GoalInspectorContent.tsx 恒假分支，3 个前端测试剔除恒假断言；server 端 API 未动）；K9 `server/cloud/index.mjs`+测试整文件删除；O1 `.playwright-mcp/` 59 文件+`.gitignore` 条目、O2 `$null`；DEP1 删 `@emnapi/core`/`@emnapi/runtime` 声明（传递依赖保留）；D1+D2 `SignalReconnectBackoff.kt`+测试+design 文档 3 处；D3 `prune-offline-package.cjs`+wiki scripts 同步；A1-A3 零引用导出清理共处理 220 项（217 项去 export + 3 项删类型），净清理 217 项、92 个 src 文件。
- 验证：删除中回归一次（A 批审计漏报 tests 引用，18 用例失败，恢复 serializePanelTabs/browserTabFilePath/decorateUserContextChips 的 export 后修复）；最终 `npm run test` 354 files / 4101 passed + 1 skipped（exit 0）、`npm run lint` 0 errors（仅既有 coverage 3 warnings）、`npm run build` exit 0（仅既有 KaTeX/chunk warning）。Android 零引用纯删除，未跑 gradle（静态验证）。
- Blocker：无。改动未提交（`cleanup/dead-code` 分支），commit 时机由用户决定。
- Notes：K8（isSessionTextAttachmentPath）保留待产品决策（附件沙箱豁免接线点）；goalConfirm i18n key 活跃保留（extend_resume 消费）；A 批审计曾漏报 tests 引用致 18 用例回归，已修复并复验；Android 未跑 gradle；git 实改 src 93 文件、tests 10 文件（server 7 + 前端 3），与 A 批 92/K7 3 存在重叠。

---

## scheduled-tasks-ui-optimization（done，2026-09-16）

- 目标：定时任务页面 UI 布局优化——任务列表由 2 列卡片网格改为紧凑行列表，编辑表单/详情/历史筛选按 DESIGN_LANGUAGE.md 去除透明度 hack 并收紧密度；i18n/状态机/API 不变。
- 改动文件：src/components/scheduled-tasks/ScheduledTasksPage.tsx（单文件重构）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 npx vitest run tests/frontend/scheduled-tasks-page.test.ts 18/18 通过；tsc --noEmit 通过；ScheduledTasksPage.tsx ESLint 通过。
- 第二轮（用户反馈修复）：层级修复——任务行 MoreHorizontal 菜单由 absolute z-20 内联改为 createPortal(document.body)+fixed z-50+锚点定位（视口钳制/上方翻转/click/blur/scroll/resize/Escape 关闭），对齐 AgentProfilesPage，修复被 4 层 overflow 祖先裁剪；编辑表单对齐 AgentProfilesPage 表单模式——AI 解析弱化为辅助块（outline sm 按钮+解析结果上移）、模型/思考/项目/智能体由 icon-only 工具条升格为标准 label 字段、预览收紧行、操作按钮入卡内 footer、返回按钮左移。仍仅改 src/components/scheduled-tasks/ScheduledTasksPage.tsx。
- 第二轮验证：vitest tests/frontend/scheduled-tasks-page.test.ts 18/18、tsc --noEmit、eslint 全部通过，测试断言零改动。
- Notes：无新依赖、无生成产物修改、无 Git 操作。仓库存在大量历史会话未提交改动（server/、tests/、docs/wiki/ 等约 18 个文件），非本次改动，未触碰。

---

## scheduled-task-frequency-select（done，2026-09-16）

- 目标：定时任务编辑器「执行频次」由六枚分段按钮（aria-pressed button 组）改为原生下拉框，控件形态与执行模式等既有 select 一致，行为与数据不变。
- 实现：ScheduledTasksPage 复用 taskExecutionMode select 结构——`<label className="block text-sm font-medium text-foreground">{t('taskFrequency')}<select className={scheduleInputClass} aria-label={t('taskFrequency')}>`；frequencyOptions 原样渲染为 `<option>`，cron label 改用新 i18n key `taskFrequencyCron`（en/zh 成对，值均为 'Cron'），不再硬编码；移除原 legend（可见名称改由 label 提供），保留外层 fieldset 的 `disabled={loading}` 分组（测试仍断言 pending 时 fieldset 禁用）。updateForm 的 scheduleType 切换逻辑（once/interval 日期草稿保存恢复、清 nextRunAt/scheduleRule、清 AI 解析态）与按频次子字段渲染零改动。
- 测试：tests/frontend/scheduled-tasks-page.test.ts 11 处频次切换由 `button('taskFrequencyX').props.onClick?.()` 改为 `change('taskFrequency', '<type>')`，经 select onChange 触发同一 updateForm；其余断言不变。
- 验证：定向 vitest 3 文件 49/49 通过（scheduled-tasks-page 18、scheduled-task-form 29、i18n-language-snapshot 2）；全量 npm run test 355 files / 4111 passed + 1 skipped、npm run lint 0 error（仅既有 coverage 3 warnings）、npm run build 成功（仅既有 KaTeX/chunk warnings），均 exit 0。
- Notes：无新依赖、无生成产物手工修改（build 正常生成 dist）、无 Git 操作；docs/wiki/src/components/README.md「手动频次分段按钮」同步改为「频次下拉框」。i18n 快照测试不校验 key 清单，en/zh 成对新增即可。

---

## cold-session-operation-restore（done，2026-09-16）

- 用户已批准目标：修复普通会话 idle 回收后 continue/rollback/access/yolo/model/thinking 误报 Session not found；限定本 feature，不改 idle、Goal 或重试历史语义。
- 实现：manager 按 updateSessionTitle 模式先用内存、缺失 await restoreAgent；model/thinking 转 async，主路由/shared/ACP 所有生产调用补 await。主 model 先恢复再取 currentModel/解析 binding，保留当前隐藏模型规则。restore 只有读到无记录才 null，503 原样保留，其他异常记录原日志并抛安全500/SESSION_RESTORE_FAILED（cause 保留内部原因）。pending single-flight 与 finally 清除不变。
- 调用链复核：所有 restore 调用均 await 或由 async 返回；主 SSE GET/HEAD 与 shared SSE 在发送头前 await，上层已有错误传播，无需额外修改。share-store 的仅404存储fallback不变，新增500/503不得fallback测试。Wiki 两处补短文字，无需SVG。
- 验证：工作区 `.tmp-session-restore` 作为所有验证 TEMP/TMP/TMPDIR。最终十文件定向 vitest 143/143通过（新增35例）；包含真实SQLite持久化→destroy→内存为空→直接操作、continue两模式历史、压缩点前后rollback、设置不启动生成、冷Goal409、缺失404、存储/构建故障500、原503、并发失败后重试、热setter不读存储、主model冷隐藏模型及异步setter/SSE传播。9个改动源码/测试定向ESLint无warning；npm run lint退出0（既有coverage3 warnings）；npm run build退出0（既有KaTeX/chunk warnings）。独立只读审查通过，无阻塞；父Agent已接受审查结论，确认143项定向测试与lint/build通过足够本次范围，feature标记done。未跑全量test、真实模型或浏览器验收，未重启运行实例。
- Notes：首轮新故障注入用vi.spyOn冻结repository导致2例夹具失败，已改用既有spread wrapper模式并全部复跑通过。一次git grep单引号在Windows shell失败，已用兼容-e参数复核。测试异步日志/Node缓存产生的本次专用临时目录残留已清理，仅删除本轮创建目录，不涉及用户数据；无其他无关故障需扩范围。
- 边界：不承诺真实模型永不重复调用工具；无新依赖、无UI改动、无commit/tag/push；未手工编辑生成目录，正常build产物不纳入diff；用户 `.playwright-mcp/` 保留未跟踪。改动文件见feature_list，本次未提交。

---

## desktop-portable-exe（done，2026-09-16）

- 用户直接需求：Windows 桌面打包时同时产出免安装 portable exe。方案：electron-builder win target 增加 `portable`，随 `desktop:build:win` 自动产出，无需改 package.json / CI（`desktop-dist/*.exe` 通配已覆盖，Release 资产名不冲突）。
- 改动文件：`desktop/electron-builder.config.cjs`（`win.target: ['nsis','portable']` + `portable.artifactName: 'QuickForge-Portable-${version}.exe'`）；`docs/wiki/root-config.md`（Desktop 脚本条目补 portable 说明）；三状态文件。
- 验证：配置 require 加载字段正确；本地 `npm run desktop:build:win` 完整通过，产出 `QuickForge Setup 2.1.0.exe`（109,371,633 B）与 `QuickForge-Portable-2.1.0.exe`（109,129,258 B）双产物；`npx eslint desktop/electron-builder.config.cjs` exit 0。未跑全量 test（无源码/测试改动，构建链已含 `npm run build`）。
- 行为说明：portable 免安装、双击即用，与安装版共享 `%APPDATA%` 用户数据；不经过 `nsis-patch/apply.mjs` 与 `installer.nsh`（仅 NSIS 安装器路径）。CI tag 构建将自动把 portable exe 上传至 GitHub Release。
- Notes：无新依赖、无 UI 改动、未触碰 dist/package-dist/package-offline（desktop-dist 为 electron-builder 生成物）；无 Git 操作。

---

## scheduled-tasks-goal-support（done，2026-09-16）

- 当前 feature：定时任务可触发 Goal，并复用既有 `runPrompt`→runner，不新增执行器；主聊天与 scheduled 支持，ACP/channel/shared 仍拒绝。
- 契约：`waitForGoalCompletion` 复用 runner 持久化终态屏障与 idle，只有 `completed` 才 schedule 成功；`paused`/`blocked`、预算耗尽与 awaiting 仍为 running 并保留 serial。关联聊天可 resume/cancel，静止后的 cancelled/failed 才失败。
- Goal 豁免普通 1h/Profile 墙钟超时；审批、轮次、工具超时不提升或取消。普通任务不变；重启沿用 stale-run failed，Goal paused 不自动重放。Profile 获准的 `goal_report` 不受 workspace 白名单滤除，但不扩展 workspace 能力；goal waiter 避免 idle eviction。
- 父 Agent 最终验证：8 文件 309 tests 全过（commands 24、runner 146），7 个相关源/测试 ESLint 零 warning、`tsc -b --pretty false` 通过。包含真实自动 tick 与手动 Goal、多轮不提前完成、persist 延迟/失败、暂停恢复、取消等底层 idle、独立并行、普通/Profile 超时区分及销毁注册竞态。未跑全量 test/build、未调用真实模型，自动入口测试使用真实 scheduler/manager/runner/storage 与模拟 Agent。
- 实现文件见 feature_list：runner 增加可复用 completion waiter，manager 保活与 Profile 控制工具接通，scheduled 仅适配完整 Goal 等待；补消息快照与结束前禁止替换 Goal，避免结果污染。销毁前后/缺失 session 注册已补 5 项边界测试。
- Notes：未新增依赖、未改 UI 或生成产物、未在当前仓库 commit/tag/push。保留并行指令/附件改动及全部历史记录，旧拒绝契约由本节覆盖。原 timer/active-ID/手动请求 pending 不扩展修复。既有 ai-timeout-budgets 夹具会在系统临时目录 Git init/commit，subagent 首次执行后发现并停止复跑；本次仅补依赖 mock 并 lint，不宣称该文件修复后测试通过。父验证将 TEMP/TMP/TMPDIR 指向工作区。旧 waitForGoalIdle 的底层 wait 无硬 deadline、外部存储直接同步 terminal 不登记 completion 属后续评估，不在此扩展。
- Wiki 已同步；考虑 SVG 后采用紧凑文字契约，无需新增图。下一步可重启所运行的源码服务后用 `/goal 刚刚提交了什么代码` 做实际模型验收；本轮不主动重启当前服务。

---

## scheduled-tasks-command-support（done，2026-09-15）

- 目标已完成：定时触发与手动运行均走统一 `runPrompt`，支持既有内置 slash command、Skill 与项目自定义命令；解析、权限和可用性规则沿用普通 prompt 链，Goal 仍拒绝，工具审批不变。
- 生产改动仅 `server/routes/scheduled-tasks.mjs`：去掉首消息预 append/persist，改用 `runPrompt`；首消息由统一 prompt 流程持久化，不再保证 `onStarted` 前落盘。
- 测试：更新 `tests/server/scheduled-tasks.execution.test.mjs`（44 tests）；新增 `tests/server/scheduled-tasks.commands.test.mjs`（10 tests），使用真实 manager/resolver/storage，仅 mock 底层 Agent。覆盖普通消息仅一次、plan 权限、custom 参数、skill、help/goal、clear/summary/compact 短路与 prompt reject。
- 验证：父 Agent 定向 7 文件 196 tests 全部通过；父 Agent 对 3 个改动源/测试文件最终定向 ESLint 通过（0 warning）。本次未跑全量 test/build，不将并行会话的全量结果认领为本次验证。
- 文档：routes Wiki 仅补简洁指令执行契约；几句文字足够，无需 SVG 或文档重构。三状态新增本 feature，保留并行与历史章节。
- Notes：此前 timer 恢复、active ID、手动请求悬挂问题按用户要求未修，不扩大范围。无 UI、依赖、生成产物修改或 Git 写操作，改动未提交。

---

## ui-ux-review-optimization（done，2026-09-16）

- 目标：全面评审并优化 UI 与交互设计（视觉/交互/状态完整性/无障碍/操作安全性），问题明确、风险可控的直接实施。
- 评审：以真实用户数据实例（本地 5176 + Playwright MCP）实测主界面、设置 17 tab、定时任务、MCP、确认弹窗与移动 375px 视口，产出分级问题清单 docs/reviews/app-ui-ux-review-2026-09-15.zh-CN.md（B01-B12，6 张截图 review-01~06 佐证）；B12（任务卡片整卡 div onClick 键盘不可达）有更多操作菜单补偿，保留现状。
- 修复（11 项）：confirm-dialog 模块级互斥 + focus trap + 关闭后焦点恢复；备份替换导入 destructive；移动 drawer Escape/焦点移入/恢复；ReactSettingsTab 延迟卸载（消除设置 tab 切换的 React sync-unmount 报错）；switch 可访问名称（MCP/定时任务）；toast 语义分级（error=alert 其余 status/polite）；常规页 3 数字输入 aria-label；执行模式下拉 label 与冒号统一；折叠项目不暴露 loading 占位。i18n en/zh 成对新增（mcpEnabledSwitchLabel/executionAgentLabel 等）。
- 验证：父 Agent 亲读全部 diff 复审；定向 vitest 4 文件 32/32（新增 tests/frontend/confirm-dialog.test.ts 6 例）、tsc -b、11 文件 ESLint exit 0；Playwright 复查：弹窗初始焦点取消/Enter 走取消/Tab 循环/Escape 关闭、4 次 tab 切换 0 console error、switch 标签语义一致、375px 无溢出、drawer 焦点与 Escape 正常；全量 test 355 files/4053 passed+1 skipped、lint 0 error（既有 3 coverage warning）、build 成功（既有 chunk warning）。
- 边界：破坏性流程（备份替换导入、真实删除）只打开弹窗后取消，未在真实数据执行确认；toast 成功态未触发真实任务通知；pi-web-ui 外部包不可控部分未纳入；对比度抽样。docs/wiki/src/components/README.md 已同步 confirm-dialog 行为契约与 toast 语义。
- Notes：工作区存在多路并行未提交改动，本 feature 不认领不回退——server/routes/scheduled-tasks.mjs + tests/server/scheduled-tasks.execution.test.mjs（runPrompt 分发，另一会话）、goal-attachment-missing-marker 系列；两者均含于全量 4053 通过内。评审期 vite dev 进程后期异常终止（404/CONNECTION_RESET）属环境问题；实际验证改用运行中的生产实例（服务 dist）。B12 与「项目删除语义待确认」记录在评审文档，不做扩大修改。

---
## goal-attachment-missing-marker（done，2026-09-15）

- 自主选题（用户授权休息期间推进一项低风险高价值改进）：并行 Explore 三候选后选定本项。未选理由：审批迟到 approve（生产不可达：超时即删 Map 条目，路由 404 + goal 状态机双守卫）、/plan 权限前置缺口（所有赋值路径均设置 permissions，不可达）、MCP 名称 lowercase（纯 UX 文案级）价值不足；subagent 测试缺口"评审高-2"系静态检索误判（见下方勘误）。本项为可复现正确性问题且是 goal-persisted-attachment-paths 明确遗留的边界。
- 修复：`server/agent-goal-runner.mjs` 的 goalAttachmentPrompt 注入前 `existsSync` 检查：文件缺失 → `(attachment file no longer available: <原路径>)`；path 空 → 原 `(no readable path recorded)`；存在 → 原样注入路径。新增 `import { existsSync } from 'node:fs'`。
- 测试：`tests/server/agent-goal-runner.test.mjs` 既有附件用例改用 `os.tmpdir()` 真实临时文件（原假路径 `C:\Users\test\notes.txt` 不测可读性）；新增文件缺失失效标注用例（断言精确标注 + `not.toContain` 防可用形式裸注入）与空 path 用例（固化既有行为）；夹具 mkdtemp + 登记 + afterAll rmSync force，不触碰 process.cwd()。
- 验证：父 Agent 亲读全部 diff 复审后独立重跑；定向 vitest 141/141、两文件 node --check、npx eslint 0 error 均 exit 0；测试后 os.tmpdir() 与仓库根 goal-attachment-* 零残留（仓库根仅存 .goal-runtime-refactor-baseline 为前次 Goal 特意保留基线，非本次产生）；package.json/package-lock.json 无 diff；无 Git 操作。
- Notes（遗留与勘误）：① 附件文件存在但位于 workspace 外（`~/.quickforge/cache/global/tmp/conversations/...`）时模型 read_file 必然 403（`server/utils/workspace.mjs` resolveWorkspacePath 无附件豁免）——沙箱豁免 vs 内容内联需产品决策，未做；② 失效状态持久化进 goal.attachments 需动 schema，未做；③ `server/message-converters.mjs` 普通消息附件内联读取失败静默返回空串，独立范围；④ 勘误：zombie-code-safe-cleanup Notes 中"可选补强 agent-subagent-runner 行为测试与 SQLite worker 冒烟（评审高-2）"大部分为静态检索误判——`tests/server/agent-manager.subagents.test.mjs`（14 用例）已通过 createAgent→run_subagent tool.execute() 真实驱动 runner 本体，`tests/server/sqlite/session-state-worker.test.mjs`（6 用例）已是真实 worker_threads+SQLite 冒烟；残余缺口仅 subagent 工具审批编排（type:'subagent' 元数据）、maxToolCalls 超限 block、前置校验 400 三项，价值中低，未补。

---

## batch-commit-push-2026-09-15（done，多会话成果汇总提交推送与发布收尾）

- 按用户指令将此前多个并行会话的全部未提交成果以单个汇总提交落地并推送：提交 `ace9930`（142 文件，+17132/−9840）已同步 origin/dev；推送前全量 test 353 files / 4037 passed + 1 skipped、lint 0 error（仅既有 coverage 3 warning）、build 成功（仅既有 KaTeX/chunk warning）。
- 推送 rebase：远端 dev 含 v2.1.0 发布 4 提交，三状态文件冲突按「本仓归档后版本为主体 + 远端 release 收尾记录插回主文件」解决，其余远端历史条目本已在 docs/archive；冲突解决后定向复跑远端改动两测试文件 46/46 通过。
- 发布收尾：npm 2.1.0 已确认发布成功，2026-09-15 实查 registry `version=2.1.0`、`dist-tags.latest=2.1.0`；下方 release-v2.1.0 段的「npm 等待双重验证」为当时状态，已闭环。
- Notes：`.playwright-mcp/`、`server.name`、`test-screenshot.png` 本地产物未提交也未 ignore；远端 master 落后 dev 1 提交待按需快进；此前历史记录中「未提交/无 Git 操作」表述已被 ace9930 覆盖，不逐段改写。

---

## retry-error-only-continue（done，2026-09-15）

- 用户报告：普通对话点「重试」按钮实际发送的是「继续」。调研确认根因：`retryFromMessage`（useChatActions.ts）用 `hasToolResultsAfter` 判定——回合只要跑过工具就追加发 i18n `errorContinueMessage`（『继续』），成功回合也命中，与按钮语义错位（该分支随 commit 835bebc「重试保留工具历史」引入，原为防副作用重放）。
- 用户决策：正常对话重试→裁剪历史重发原消息；回合报错后的重试→保留历史追加「继续」。
- 实现：`message-utils.ts` 删 `hasToolResultsAfter`、新增 `turnEndedWithError`（回合边界止于下一条 user 消息，谓词与 turn-error-row `isErrorMessage` 一致：stopReason==='error' 且 errorMessage 非空）；`useChatActions.ts` 换判定并改注释；`turn-error-state.ts` 仅同步模块头注释（逻辑零改动）。
- 测试：`message-utils.test.ts` 旧 3 用例替换为新 6 用例（错误+工具、纯文本错误、成功含工具 false、旧回合错误不计、回合边界、aborted false）；`turn-error-state.test.ts` 仅注释。
- 验证：父 Agent 亲读 diff；定向 vitest 4 文件 195/195、相关 5 文件 ESLint、`tsc -b` 全部 exit 0。
- Notes：成功回合含写工具的重试现在会裁剪重试，模型可能重复执行副作用——用户明确接受。服务端 `/continue` 两种模式未改；docs/wiki 无相关记载无需更新；未跑全量，无 Git 提交。

---

## release-v2.1.0（done：Git/CI/npm 发布全部完成）

- 最终状态（覆盖初始发布记录，初始阶段记录已随 2026-09-15 全量归档移入 docs/archive/progress-archive.md）：本轮实时核验远端 dev/master/v2.1.0 与 HEAD 为 `baaa041cc2a37e49038da46cec4c7d2ca6272f59`；本地 master 仍为 `9ded6c0`，并非四 ref 同步。发布提交 `6ad3489`，CI 测试修复 `6252e2d`（固定中文）及 `baaa041`（sleep 5→20ms，保留 >=5 断言）。
- 当前 HEAD 重跑硬门禁：test 323 文件 / 3649 全过，lint/build 退出 0；仅既有 identity.mjs:92、KaTeX/chunk warning。CI [34797256759](https://github.com/shawnstack/quickforge/actions/runs/34797256759) 与 Desktop Build [34797259067](https://github.com/shawnstack/quickforge/actions/runs/34797259067) 网页 Success，完整 SHA 匹配；API 限流。
- 包核验：`package-offline/shawnstack-quickforge-2.1.0.tgz`，7486125 bytes / 471 文件，SHA1 `7c952caa07a39971fdd4dbf74acd899238495d0c`；402 个 dist/server/bin 文件与当前构建逐字节一致，无需重打。
- npm：已登录 shawnstack，用户明确授权发布；当时 publish 退出 1（EOTP）。（已闭环：用户完成双重验证后发布成功，2026-09-15 实查 registry version=2.1.0、latest=2.1.0。）
- Notes：三状态文件更新当时未提交（后随汇总提交 rebase 并入 dev），未再次移动 tag；未知零字节文件 `x[1])` 已由后续会话清理。无架构/公共入口变化，无需同步 Wiki。

---

## builtin-playwright-mcp（done，最新：UI/API 内置删除保护）

- 保留 `npx -y @playwright/mcp@latest` 原样、默认关闭、已有同名配置及启用状态；未新增依赖或修改 Desktop。
- 读取为规范化名称 playwright 派生 `builtin: true`，不信任输入、不落盘；删除在 normalize 后、`atomicUpdate` 前返回 409。普通 MCP 删除行为不变；批量 replace 遗漏 playwright 后仍读到关闭预置。
- 卡片展示中性“内置”标签，隐藏删除，保留编辑、启停和重连。README、server Wiki 与三状态已同步。
- 改动文件：`server/mcp/config.mjs`、`src/components/mcp/mcp-server-card.tsx`、`src/lib/types/mcp.ts`、`src/lib/i18n.ts`、MCP config/routes/card 测试及上述五份文档；文件清单见 feature_list.json。
- 验证：父 Agent 已执行 MCP config/registry/routes/card 四文件定向测试、定向 lint、build 整链，exit 0；当前定向测试全部通过，未取得用例总数，不推测，不冒称本次全仓 test/lint。
- Notes：本次 General 意外清空未跟踪的 `tests/server/mcp-config.test.mjs`；父 Agent 依据本会话已读取的测试内容重建覆盖并补行为测试，不声称逐字恢复。本次文档子任务仅编辑五份文档，不触碰任何源/测试文件。无 Git 操作或全局配置变更；不继续旧 Desktop/离线方案，不声称浏览器端到端验收。
- blocker：无。下一步可重启运行中的源码版检查设置卡片；以下为历史记录，不代表当前行为或待办。

---

## 历史完成记录：goal-persisted-attachment-paths（done）\n\n- Goal 创建时将原始用户消息中的附件元数据持久化到 Goal，兼容旧快照；规划与后续执行提示词均追加文件名和完整路径。\n- 改动：agent-prompt-commands、agent-goal-runner、agent-goal-state、src/lib/goal，以及 Goal runner 回归测试。\n- 验证：定向 Goal 测试 4 files / 206 tests 通过；相关 ESLint 与 `tsc -b --pretty false` 通过。\n- 边界：未改变附件文件生命周期、workspace 权限或普通消息转换；附件文件若过期/不可读仍需后续独立处理。\n\n---\n\n## 历史阶段：builtin-playwright-mcp（done，npx 简化；删除行为已由顶部保护方案替代）

- 已撤回过度实现：Playwright production dependency、浏览器资源发现/安装脚本、Desktop资源打包与环境注入、UI内置标签和编辑删除限制。本任务新增五个独有文件删除；package/lock通过npm同步，其他未提交成果保留。
- 最终仅在 config.mjs 动态预置 `npx -y @playwright/mcp@latest`，默认关闭、上游默认可见浏览器。已有同名完整优先，首次启停原子落盘；允许编辑，删除用户配置后读到关闭预置。满50服务时首次落盘返回409且store不变。
- 验证：MCP三个测试文件62 tests通过；定向ESLint、父Agent全仓lint/build通过（既有coverage/font/chunk warning保留）。未再次运行浏览器或改全局配置；README/Wiki和三状态已同步。
- Notes：旧Desktop下载/打包阻塞不再属于新范围，不重复执行。此前生成/下载目录未清理，避免误删；无Git提交。旧Goal的运行时状态未修改，不声称其原验收通过。

## 历史方案（已撤回）：builtin-playwright-mcp（2026-09-15）

- 已完成第一阶段：固定安装 `@playwright/mcp@0.0.81` production dependency，并新增 `server/mcp/builtin.mjs`：Playwright 服务使用当前 Node + 包内 `cli.js`，不再依赖 npx/@latest，默认 disabled、`--isolated`；已有同名配置保留启用选择但强制使用内置入口。
- 设置卡片已识别内置服务，显示“内置”并隐藏编辑/删除，保留启停/重连；MCP 类型增加 builtin 字段。README 已补充默认关闭、隔离 headed Chromium 与浏览器二进制/离线边界。
- 验证：官方 npm 元数据确认 0.0.81 及 Playwright 1.64 alpha 依赖；MCP config/registry/routes 定向 43 tests 通过，内置配置单测和定向 eslint 通过，`npm pack --dry-run --json` 成功。尚未完成 Desktop 浏览器资源打包、真实 QuickForge 内置服务连接冒烟、完整 test/lint/build 与 Wiki/三状态最终同步。
- 本轮补充：内置定义使用 Playwright `chromium.executablePath()`，存在时传入 `--executable-path`；浏览器缺失时 registry 返回明确安装提示。真实内置配置独立 smoke 仍成功（tools/list 26、about:blank、close）。MCP 定向 44 tests、定向 eslint、build/lint、npm pack --dry-run 均通过；lint 仅既有 coverage warning。
- 本轮补充：完成 Desktop `extraResources` 可选浏览器资源契约（通过 QUICKFORGE_PLAYWRIGHT_BROWSERS_PATH 注入，未配置时不改变现有构建）；新增 packaging contract 2 tests；Wiki server MCP 导航补充内置服务、固定入口和缺失诊断。全量 test 352 files / 4015 passed + 1 skipped，build/lint 仍通过（既有 coverage 3 warnings）。
- blocker/risk：浏览器资源 helper 当前按配置目录直接复制，尚未完成跨平台浏览器目录结构映射与真实 Desktop 安装包运行验证；因此仍不能宣称完整离线可用。浏览器资源下载与 Desktop 构建此前超时；本轮最终链路 `npm run test && npm run lint && npm run build && npm pack --dry-run` 全部通过（354 files / 4021 passed + 1 skipped，lint 仅既有 coverage 3 warnings）。由于资源未实际落盘，仍无离线运行证据。

## configure-playwright-mcp（done，2026-09-15）

- 用户授权为当前 QuickForge 实例全局配置 Playwright MCP，选择可见窗口；核对本地实例及当前项目后，通过单服务 PUT 新增 playwright，stdio / npx / `-y @playwright/mcp@latest`，保留其他配置。
- 验证：官方 help 确认默认 headed；实例状态 connected、enabled=true、26 tools、无错误。同参数独立 SDK 客户端成功打开 about:blank 并关闭浏览器；不是当前聊天直接调用工具的端到端验收。
- 仓库仅补充 feature_list/progress/session-handoff；无源码、依赖或生成产物修改，无 Git 提交。真实连接/浏览器检查替代无关全仓 test/lint/build；未改变架构或入口，既有 MCP Wiki 无需更新。
- Notes：工作区大量既有未提交改动保持不动、不认领。General 空返回后父 Agent 检查服务仍不存在，再亲自完成配置与验证；最初分号串联诊断不兼容当前命令环境，拆为单命令后成功，不影响配置结果。无 blocker。

## 四项拆分最终核验汇总

- 实现顺序已落实：manager访问模式/状态SSE查询/审批应答；workspace Git/浏览搜索/文件预览/请求控制；App终端/Git/加载过渡；Inspector布局/tab/Git review。四feature均done，具体文件见feature_list.json；未声称主入口所有职责均已拆尽。
- 最后源码验证：07:50UTC完整npm run test、npm run lint、npm run build成功。此前cloud/qf-agent-process计时失败隔离与默认全量复跑通过；旧runtime-diagnostics等失败历史保留如下。构建字体/chunk warning仍在。原/新Inspector相同16行为、App14行为对照均过；无DOM测试不等同浏览器/StrictMode验收。
- 最终范围：相对05:10UTC的791文件执行hash基线，42个本Goal相关路径（含新增）全部属于四feature文件清单；9个并行scheduled路径、3个历史cleanup删除、7个初始hash未收录的报告/reviews/mockup/archive明确排除，不回退、不认领。共享Wiki和三状态保留并行章节。package.json/package-lock.json和HEAD未变，无tracked生成物diff；build只正常生成dist，未手工改产物、未commit/tag/push/发布。
- 范围审计保存在忽略目录 `.goal-runtime-refactor-baseline/final-scope-audit.json`，原四源码快照及baseline.json保留用于可选重放与审计；不是测试泄漏，不在此处删除。已确认的0字节单引号命令残留已清理。后续清理快照会让显式QF_*_BASELINE_TEST模式不可用，但不影响默认CI。
- 文档：五个相关Wiki保留模块职责和phase调用/owner边界，修正四feature验证栏中的过时“待下一步”；没有全库去行数化或视觉重设计。最终补记前的全部progress/handoff和无关feature以hash验证保留。无剩余实现待办；测试时序波动、构建warning及浏览器验收局限如实保留，不扩大本Goal。

<!-- final-audit-history -->
## refactor-workspace-inspector-split（done，三域实现与验证完成）

### Git阶段/完整验证追加
- 新useInspectorGit229行，入口1872行；按需review/status/filters/actions/inline diff迁移，共享projectGuard/跨域reset与卸载abort、diff reader跨tab留入口。props/格式/UI不变。
- Git搬前5原AST+39关联44过；最终原Inspector与实际三域hooks同16例分别通过，21effects同序/同回调，4 JSX+props逐字相同、27actions体归一一致。
- 完整test/lint/build最终通过（07:50UTC命令exit0）；首次全量仅cloud/qf-agent-process重启计时失败（runtimeChildren期望2实际1），隔离及默认全量重跑通过，未改无关实现。构建仍有既有font/chunk warning。成功日志截断未确认总数，不猜测。
- 失败修复：一次cmd解析失败，源码未写；机械unused清理跨函数误删同名isGitRepository state被tsc拦住，已还原；2旧源码断言改读真实Git模块保留强度；稳定setter/ref deps补齐，applyGitStatus原project-only callback身份通过局部有理由lint例外保留。
- 范围初审：基线hash变化除四feature外还有并行scheduled与cleanup后三个死文件删除，不回退/认领；package与lock不在基线差异列表。发现0字节单引号命令残留（05:39时间）核实后删除。原快照目录保留，最终范围证据与Wiki/四状态终验待下一步。

### 前阶段历史

### tab阶段追加
- 新useInspectorTabs181行，state/effects/actions真实接入，入口2048行。tab复用/排序/关闭/运行时订阅及project+session持久化抽离；request/scope guard和共享updatePanelTab仍在入口，文件缓存/树不动。
- 搬前5原AST行为+31关联共36通过；搬后同36通过，最新全前端171文件2093用例、tsc -b、定向eslint零warning通过。原快照布局/tab同11例重放通过；21effect原序/回调、4JSX逐字相同、18action体归一一致，updater原样。
- 失败修复：首次字符串唯一匹配发现子组件同名menu状态，assert失败未写文件，改Main组件AST精确匹配。多余import清理；4旧源码契约失配改指真实tab模块未弱化断言。自动dep建议曾加入不稳定updatePanelTab，经复核恢复原project-only缓存callback身份，局部说明并禁用该一行deps检查；新hook mount-only ref初始化保留原模式，仅该段refs lint例外（不全文件禁用）。
- 本阶段另改inspector-tabs-hooks测试、inspector-domain-fixture扩展props、workspace-inspector-tabs与side-chat-workspace-tab源码定位；wiki与三状态。测试非DOM非StrictMode；无提交/依赖/产物修改。Git review仍须先保护后抽离，最终全仓验收待后续。

### 布局阶段历史

- 已搬迁：新增useInspectorLayout.ts，state/viewport/visibility/width/actions按phase调用；双面板resize、全屏动画、宽度持久化/viewport clamp从Inspector抽离，入口2544→2194行。tab与Git review未搬，c4尚未通过。
- 文件：Inspector、useInspectorLayout、inspector-layout-hooks.test.ts、helpers/inspector-domain-fixture.ts；width-range和mobile-fullscreen源码断言改定位真实模块（保留断言），components wiki和三状态。
- 验证：搬前13文件97基线及6原AST行为用例通过后才移动；搬后14文件103通过，原快照重放同6通过；21effect回调归一同序，4外层JSX及props逐字一致。定向eslint零warning/tsc -b通过，全前端170文件2088用例通过。未运行最终全仓test/lint/build。
- 失败记录：3次Explore空返回，父直接读源码/测试/docs完成调研。机械生成多余解构被lint拦住，NAV宽度常量未导出被tsc拦住，均修复；一次cmd嵌套引号语法失败未写文件，改专用edit/短命令完成。没有修改生产行为以规避测试。
- Notes：布局测试无DOM同步harness，覆盖resize边界/RAF合并与取消、body恢复、180ms关闭、640自动展开、mobile跳过clamp、240ms全屏/Escape/afterExit；不宣称浏览器或StrictMode验收。保留原nav结束清空body样式、全屏RAF既有语义，未额外修复边界。
- 下一步：当前Inspector feature继续tab持久化/复用/scope编排，随后Git按需review，各自先补搬前测试。原快照.goal-runtime-refactor-baseline/Inspector-before-split.tsx不能清理；QF_INSPECTOR_BASELINE_TEST=1仅本地显式布局审计，默认CI测真实hook。无提交/依赖变更/手工产物修改。

---

## refactor-app-main-split（done，Goal第三项）

- App 2618→2362行；新增useAppTerminal74/useAppGit148/useAppLoadingTransitions136行，分phase hook保留effect相对顺序；共享project ref与scope invalidation留App，基础hooks/URL owner未动，10段最外层JSX逐字相同。
- 文件：App、三个hooks、app-domain-hooks.test.ts、hook-lifecycle-harness.test.ts、helpers/{hook-lifecycle,app-domain-fixture}.ts；git-status-request-lifecycle及workspace-inspector-tabs仅适配真实实现/稳定ref依赖断言；wiki/src与hooks导航、三状态。
- 验证：先11文件93基线；原App AST抽取14行为先通过后搬迁；父最终将相同14例对原App快照和真实hooks各跑全过，加2例harness自身验证。覆盖终端确认/旧回执/监听清理、Git旧结果/400ms刷新/菜单、1350/280ms及双RAF过渡/token隔离。父07:05UTC完整test/lint/build exit0，截断未确认全量总数，不猜测。
- 失败/修复：前期fixture漏toolName、CRLF和scope源码位置断言失配已修；harness no-this-alias早期lint问题已处理（并行scheduled历史记录不改写），最终全仓lint通过。独立review发现harness cleanup/setup交错，父改为分阶段并增加自测；无生产行为修复。
- 边界：测试无DOM，不等于React StrictMode/并发/浏览器验收。QF_APP_BASELINE_TEST=1仅本地审计显式读保存快照，常规CI只测真实hook。保留既有font/chunk warning，不新增依赖、不提交、不手工改产物；并行scheduled成果保留。
- 下一项Inspector三域先Explore与搬前保护；全部完成后再最终全量及执行基线范围验收。.goal-runtime-refactor-baseline含App原快照请保留。

---

## refactor-routes-workspace-split（done，Goal第二项）

- 原workspace入口1948→594行；新增workspace-git-service681行、workspace-browser-service527行、workspace-file-service193行、workspace-request-control42行。17个原出口不变，120个顶层函数体和常量逐字一致且仅一份，调用新模块无反向facade环。
- 验证：搬迁前9文件76基线及新增7契约测试通过，搬迁后10文件83通过；AST/语法/零warning lint通过，独立Explore未发现阻断。默认最终全量347文件3946 passed+1 skipped，npm run lint/build通过（既有字体/chunk warning）。
- 失败历史：机械脚本误多self re-export导致duplicate exports，删一行后测试全过；格式脚本cmd引号解析失败未改文件，修正重跑。全量另发现第一feature遗留session-index-lifecycle源码断言位置失配，改读实际queries实现保留断言；随后复跑遇runtime-diagnostics elapsedMs4<5ms既有flake，隔离通过再默认全绿，未改无关实现。
- 范围：本Goal没改其他生产功能/依赖/样式，无提交；并行scheduled-tasks feature已完成，保留其状态及文件，不认领。workspace原文快照保存.goal-runtime-refactor-baseline/workspace-before-split.mjs供最终比对。
- 下一项App，随后Inspector；最终验证须在全部完成后再次运行。本节全量结果仅当前两个后端阶段。

---

## refactor-agent-manager-split（done，Goal第一项）

- 已抽离访问模式、状态/SSE查询、审批/ask应答三个域，facade实际接入且保留出口。主文件1946行；新模块agent-access-mode18、agent-session-queries139、agent-approval-responses73行。
- 新增agent-manager-domains测试11用例；状态/应答搬迁前后相同19文件297用例通过；函数体AST归一比对、node语法检查、零warning定向lint、diff check通过。
- query factory依赖注入避免新增反向manager环；唯一store不变，SSE未设置返回undefined、abort UI掩码与raw busy区别、ask截断/错误均保留。
- 失败记录：general空返回半成品曾误增4个facade出口；contract检测失败后父Agent修复，未放宽测试。未接入模块曾含错误abort替代，已用原函数搬迁覆盖且abortToolCall留主文件。后续两次general空返回无进展，父Agent完成测试与AST搬迁。
- 基线：`.goal-runtime-refactor-baseline/baseline.json`记录791文件SHA256和初始Git状态；目录为本Goal诊断产物而非测试泄漏，后续范围验收前保留。另存manager-before-domain-move.mjs用于函数体比对。初次分号串联命令在cmd失败，后用单Node脚本记录成功。
- Notes：并行scheduled-tasks源码/UI/测试正在变更；不回退、不认领。原Goal/server-agent/zombie等成果保留；未新加依赖/提交/手工生成产物修改。
- 下一项：routes/workspace.mjs；其后App、Inspector。最终全量test/lint/build和全Goal范围检查待后续。

---

> 归档说明（2026-09-15 全量）：主文件已按用户要求清空为全新状态，全部历史条目（含 Notes）在 docs/archive/progress-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json；会话交接归档在 docs/archive/session-handoff-archive.md。新 feature 记录从本文件重新开始。

## scheduled-tasks-manual-frequency（done，2026-09-15）

### 复审收尾（06:03 UTC，以下覆盖本节早期验证结论）
- 补同步 parse/save 互斥、taskId action 去重与忙态、失效解析响应保护、单次/间隔独立日期草稿；保留历史锚点秒毫秒。
- 补 interval 首次锚点+间隔的 Date 溢出防护；新 Cron 严格验证与历史运行兼容分离；真实 30 秒 scheduler tick 测试覆盖 parallel 开始推进、serial 长任务越槽、pause/resume 不补跑。
- 验证：前端2文件47、后端2文件93、扩大10文件177 tests通过（非全新增）；父06:00全量347文件3982 passed+1 skipped；06:02本功能9源/测试ESLint零warning、独立build通过（既有font/chunk warning）。
- Notes：最终全仓lint失败于无关并行 `tests/frontend/helpers/hook-lifecycle.ts:33` no-this-alias，另coverage3 warning；未扩大修复。此前05:42全量链式通过仅代表第一版，不冒充最终全绿。
- 边界：实现保留现有页内编辑而非HTML抽屉；准确nextRunAt保存后返回；未做浏览器E2E或视觉验收、不承诺100%覆盖。未新增依赖/提交；build正常产生dist，未手工修改生成产物。

### 第一阶段记录

- 当前目标：用户确认后实现手动六频次；本轮只推进该 feature，不处理其他计划中的拆分。
- 前端：分段频次选择 + 动态字段（单次、分钟/小时/天间隔与首次时间、每日时间、星期多选、1–31 月日期、五字段 Cron）；默认每天，无需 AI 解析；规则摘要、设备/服务端时区提示、表单校验、解析/提交禁用、失败保留草稿；AI 回填可编辑 Cron，手改清除过期解析结果。
- 后端：结构化 intervalValue/intervalUnit/executeAt；以原始锚点计算下一槽位，跳过错过时间、不按完成时间漂移。weekDays 非空整数组合并兼容 weekDay；类型切换清理旧字段；Cron 支持列表与数字起点步长并拒绝部分非法字段。旧中文 interval rule 可兼容读取。
- 文件：ScheduledTasksPage.tsx、新 scheduled-task-form.ts、i18n.ts、server/routes 与 utils 的 scheduled-tasks.mjs；前端两测试、后端两测试；components/routes wiki 与三状态。
- 验证：定向 Vitest 4 files / 104 tests 通过；扩大 `npx vitest run scheduled` 9 files / 137 tests 通过；相关 ESLint 无 warning、tsc -b、相关 git diff --check 与状态 JSON 检查通过。6 页面用例使用 hook-state harness 调用真实交互 handler，另 26 表单、41 工具和 31 API/执行用例；不是浏览器 E2E。首次新增 API fixture 使用字符串 stream 导致 10 fail，改为实际 Buffer 请求体后全绿，无生产规避。
- 文档：同步频次字段、时区、月末/错过槽位语义和兼容边界；已考虑 SVG，字段表比流程图更适合此契约，未新增装饰图。
- 边界：未新增依赖、未修改生成物、未提交 Git；未跑全量 test/build，采用定向测试+lint+tsc 防止写入生成目录。保留前序/并行修改。准确 nextRunAt 由服务端保存计算，界面只即时预览规则；Cron 沿用日/周 AND 和 366 天搜索窗口；间隔天=24小时。

---

## p0-goal-runtime-testdir-hygiene（done，残留治理与测试修复完成）

- 目标：消除 `.goal-runtime-*` 测试目录污染。
- 实现：`.gitignore` 增加 `.goal-runtime-*`；`agent-goal-runtime.test.mjs` 改用 `os.tmpdir()`，增加 `afterAll` 延迟兜底清理；删除仓库根目录现存 109 个测试残留目录。
- 验证：定向 Vitest 15/15 通过（复跑 2 次），ESLint 通过；修复后仓库根目录与系统临时目录均无新残留。
- 边界：未修改生产日志器；无 Git 提交。

---

## p0-coverage-provider（done，coverage 脚本修复完成）

- 目标：修复既有 `test:coverage` 脚本。
- 实现：新增 `@vitest/coverage-v8@4.1.8`；`vitest.config.ts` 增加 V8/text+HTML coverage 配置；`.gitignore` 忽略 `coverage`；`package-lock.json` 已同步。
- 验证：`npm run test:coverage` 全量 331 files、3718 passed、1 skipped；总行覆盖率 49.98%。
- 边界：未设置 coverage threshold；`vite.config.ts` 经核实无 test 段，因此未修改；无 Git 提交。

---

## backend-test-gaps-fill（done，后端缺口测试完成）

- 目标：补齐审批/MCP/supervisor/network-proxy/compaction 测试。
- 实现：新增 8 个测试文件，覆盖审批状态与超时 fail-closed、MCP 配置与工具名、compaction、network proxy 运行时、restart/update supervisor。
- 验证：定向 Vitest 9 files、244 tests 全部通过；定向 ESLint 通过。
- 边界：测试按当前源码行为固化，记录但未修复潜在行为问题；未运行全量验证。

---

## server-agent-guard-tests（done，拆分保护网评估完成）

- 目标：为 `server-agent.ts` 拆分确认现有行为保护覆盖。
- 结论：已有 `server-agent.test.ts` 140 用例覆盖 SSE 退避、重连上限、手动重试、health timeout、状态恢复与事件派发；无需重复新增大量测试。
- 验证：`server-agent.test.ts`、`file-rollback-api.test.ts`、`deferred-session-agent.test.ts` 共 188 tests 通过；TypeScript 检查通过。
- 边界：`fetchActiveAgentStatuses`、部分订阅资源释放及若干审批 API 的直接断言仍有限，作为后续拆分风险点。

---

## refactor-server-agent-split（in_progress，第一阶段）

- 目标：按行为保持优先，拆分 `server-agent.ts` 并逐步收敛事件类型。
- 当前完成：新增 `src/lib/server-agent-types.ts`，迁移 18 个公共类型及 `GoalIterationMarkerSnapshot`；原 `server-agent.ts` 通过 type import/re-export 保持公共导出路径兼容，未移动 SSE、fetch helper、ServerAgent 类或事件逻辑。
- 验证：相关 3 个前端测试文件 188 tests 通过；`tsc -b`、定向 ESLint、`git diff --check` 通过。
- 下一步：先抽离无运行时循环的 SSE/HTTP 基础边界，再处理 ServerAgent 事件类型收敛；每一步保持现有公共导出与测试契约。

- 本轮追加：新增 `src/lib/server-agent-http.ts` 与 `src/lib/global-agent-sse-client.ts`，迁移 `fetchJsonWithTimeout`、GlobalAgentSseClient、全局单例及 SSE 连接状态 API；`server-agent.ts` 保持原公共导出路径并增加兼容导航注释。6 个相关前端测试文件共 249 tests 通过，tsc、ESLint、git diff --check 通过。

---

## zombie-code-safe-cleanup（done，三 Phase 清理与全量验证完成；2 个既有 flake 已隔离复跑确认）

- 当前目标：接续本轮僵尸代码只读评审，用户授权处理「可安全处理、不影响功能」的部分；新增独立 feature 无依赖，不推进其他事项。
- 方法：三路 explore 只读评审 → 父 Agent 逐条亲验 → 三个 Phase 由 general subagent 顺序实施（每步删除前重新 grep，防并行会话写入导致引用变化）→ 父 Agent 亲读关键 diff + 终验。
- Phase 1（零风险）：删 server 死导出 isGoalRunActive / isGoalInFlightStatus / isValidGoalId 及孤儿常量 GOAL_ID_PATTERN；删 src/lib/goal.ts 死薄包装 goalCanAccept（goalAcceptanceCheck 保留）；删 Android Capacitor 模板遗留 ×2 + icon-preview.png；goal-test-demo.md 归档 docs/archive/；修复 scripts/session-index-query-benchmark.mjs 悬空 import（现行 API 重写，smoke run equivalent:true）。server/cloud/index.mjs 因并行会话新增 tests/server/cloud/index.test.mjs 引用而保留。
- Phase 2（Goal 计划确认死代码簇，净删约 1200 行）：goal-card.ts 821→212（仅留 viewmodel）；删 goal-plan-confirmation.ts 空壳 + goal-card-controller.test.ts（19 用例全测死代码）+ goal-plan-confirmation.test.ts；ChatPanelHost 三处死接线；local-tools 空 mount；index.css 死区 -386 行；i18n goal 域扫描删 14 对死 key（goalConfirm 活引用保留）；goal-card.test.ts/goal-report-renderer.test.ts 同步（viewmodel 断言与 goal-mode-i18n 未提交断言完整保留）。
- Phase 3（非 goal 域 i18n 死 key）：动态消费穷举（唯一动态前缀 migration.phase.* 保留）→ 带引号精确匹配扫描 → 删 175 对死 key（1810→1635，-350 行）；同步 assistant-artifact-card.test.ts 2 处死断言（含 1 处冒号形式盲点，测试运行暴露后补扫确认仅此 1 处）。
- wiki：components README「Goal 聊天计划确认」改记已移除；lib README 回归清单去 goal-card-controller。
- 已验：全量链式 test+lint+build 退出码 0；复跑全量出现 2 个时序 flake（persist-session-state beforeEach 10s 超时、runtime-diagnostics elapsedMs 4<5ms），隔离复跑 28/28 全过含原失败用例、与改动面无交集；分 Phase 定向 192/374/1034 tests 全过 + tsc/eslint 0 error + 残留 grep 零命中 + i18n en/zh 对齐（1796/1635 两阶段均相等）。
- Notes/边界：有意不做（待产品决策）：confirm 恒假链、6 个零调用路由（wiki 记载兼容旧客户端）、isSessionTextAttachmentPath 接线、SignalReconnectBackoff、82 个 export 冗余。Android 未跑 gradle（仅 grep 零引用验证，模板遗留风险极低）。根目录垃圾文件已被并行会话先行清除。工作树并行/前序未提交改动完整保留无冲突。未新增依赖，无 Git 提交。
- 下一步：待用户决策项见 Notes；可选补强 agent-subagent-runner 行为测试与 SQLite worker 冒烟（评审高-2）；改动未提交。

---

## refactor-server-agent-split（in_progress，2026-09-15 本阶段收尾与事实勘误）

> 本节更新此前本文件中后端用例计数、保护网仅评估及全量尚未执行等阶段性记录；保留旧记录与并行 zombie-code-safe-cleanup 全部成果，不代表五个巨石已全部完成。

- 已完成拆分：`server-agent.ts` 2782→2236 行；新增 `server-agent-types.ts` 245 行（18 个原公共 type + 1 个内部 marker snapshot）、`server-agent-http.ts` 16 行、`global-agent-sse-client.ts` 340 行。旧入口 type/value re-export 保持兼容，抽离模块无反向主类依赖；watchdog、状态/消息对账及业务事件仍在 `ServerAgent`。
- 事件类型：删除 11 处冗余 AgentEvent 断言，剩余 20 处原始 SSE / 自定义事件 / 轻通知边界尚未完整收敛，当前 feature 保持 **in_progress**。伪源码注释已删除，相关源码契约测试已改为定位真实模块，不再用注释伪装原入口中存在实现。
- 前端保护网勘误：`server-agent-guard-tests` 不仅评估既有 140 用例；新增 `server-agent-http.test.ts`、`global-agent-sse-client.test.ts` 共 13 用例。最新前端定向 10 文件 293 tests 通过。
- 后端计数与隔离勘误：新增 8 测试文件原为 104 用例；supervisor 使用 fail-closed preload 后由 6→10，现为 **108 个后端新增用例**，另新增 `tests/server/helpers/supervisor-fixture.mjs` 与 `supervisor-preload.mjs` 两个夹具。此前 244 是含前端的混合定向数量，不能计为后端新增。supervisor 测试拦截 spawn，绝不启动真实 npm/server；失败 finally 等待唯一真实 Node 子进程 close 后才删除 fixture。
- 最新验证：父 Agent 于 **2026-09-15 03:59 UTC** 执行 `npm run test && npm run lint && npm run build`，exit 0；截断日志未取得全量用例数，不填推测数量。此前阶段 tsc、定向 ESLint 与 diff check 均通过。
- 文档/状态：wiki 最小补三模块职责、单向依赖、兼容入口与 watchdog 所属；考虑后无需 SVG，不全 wiki 清理行数。健康报告仅顶部补勘误；从既有 progress/handoff 证据恢复 feature_list 缺失的 `zombie-code-safe-cleanup` done 条目，其余 feature 和历史交接完整保留。本次收尾只改文档/状态，不改源码测试，无提交。文档轮 JSON parse、10 个 feature 唯一性/状态断言、旧交接保留检查与五文件 `git diff --check` 通过；未跟踪报告另做空白/冲突标记检查通过。
- 下一步：继续当前 feature 的事件边界收敛及相关验证，之后按顺序 **agent-manager → workspace → App → Inspector**；这四项仍为 planned，不能自动宣称全部完成。

---

## refactor-server-agent-split（done，2026-09-15 事件边界收尾）

- 本阶段限定成果：完成类型/HTTP/SSE 拆分与事件边界明确化。`server-agent.ts` 当前 2271 行；`server-agent-types.ts` 266 行；HTTP 16 行；SSE 340 行。新增 `ServerAgentLocalEvent` 标准和本地明确轻通知联合，`ServerAgentWireEvent` 仅为 `readonly type?: unknown`，无万能索引。
- `subscribeEvents` 是诚实入口；旧 `subscribe` 保持原签名，仅在 legacy wrapper 一个 `event as AgentEvent` 兼容边界，不声称 wire 已校验。12 处 wire 原样转发与本地 typed emit 分离；订阅 Map 保持原 Set identity、插入顺序、live iteration、异常隔离、dispose 语义。20 处散布 AgentEvent 断言收敛为 1 处有意兼容边界，不等于所有其他 cast 消除。
- 新增 `tests/frontend/server-agent-events.test.ts`（14 用例）、`server-agent-events-types.test.ts`（1 个实际 compiler 用例）及 `server-agent-events.typecheck.ts` 负例夹具（非运行时测试）。子 agent 27 文件/694 定向通过，独立 review 155 通过。
- 验证：父 Agent 2026-09-15 04:38 UTC 默认 `npm run test` 通过（343 files / 3854 passed + 1 skipped）；04:37 UTC `npm run lint` 与 `npm run build` 通过，构建仅有既有 font/chunk warning。保留失败历史：首全量 Worker fork unexpected exit 原因未确定；maxWorkers=2 复跑仅 runtime-diagnostics elapsedMs 4<5 的既有同类 flake，隔离两文件通过，默认最终全绿；无源码/测试修复掩盖问题。
- 边界：不宣称主类所有职责已细分、运行时 schema 校验或全库 strict 完成；未改报告、生产、测试、依赖、生成产物，不提交。下一步 `agent-manager`；其他四个巨石保持 planned。

### Notes（本阶段勘误与风险）

- 健康报告 C1 所称 compaction/network-proxy 无专属测试有误：`conversation-compaction.test.mjs`、`auto-compaction.test.mjs`、`network-proxy.test.mjs` 原本已 Git 跟踪并直接覆盖对应模块。新增测试是补缺口，不是从零覆盖整族。
- 报告 C3 所称重复 test 配置有误：`vite.config.ts` 没有 test 段。报告其余未经验证结论仅是静态建议，不视为已证实问题；不扩展当前 feature。
- 构建仍有既有 KaTeX/font/chunk warning。自动测试通过不等于真实浏览器或现场 SSE 弱网验收；剩余 20 处事件断言仍是当前工作的未完成边界。
- 并行 zombie cleanup 的历史 flake、Android 未验证及产品待决策事项继续按原节保留；本轮不修改其代码、测试或状态结论。工作树含大量并行/前序未提交改动，无 Git commit/tag/push。

---

## goal-runtime-residue-sweep（done，2026-09-16 存量一次性清理）

- 现状：仓库根发现 162 个 `.goal-runtime-*` 残留目录（09-11: 85 / 09-12: 22 / 09-14: 55），每个仅 `data/logs/server-*.log`（共约 116KB）。全部早于修复提交 `ace9930`（09-15 23:41），修复后无新增。
- 处置：一次性删除全部 162 个，删除后仓库根与 `os.tmpdir()` 均验证 0 残留；无源码/测试改动，无需跑验证命令；Git 状态无新增变化（`.gitignore:28` 已忽略该模式）。
- 勘误：`feature_list.json` p0-goal-runtime-testdir-hygiene（done）中"删除 109 个、repo root 与 os.tmpdir() 均为 0 残留"的验证记录与事实不符——本次实际清理出 162 个，说明当时的删除/验证未覆盖全部。
- Notes：仓库根另发现 0 字节未跟踪文件 `x[1])`（09-14 9:57 创建，疑似命令转义事故产物），后续会话已清理。

- 2026-09-19 视觉修正：移除 `src/lib/tool-renderers/` 6 个文件共 11 处 `text-muted-foreground/60|70` 透明度后缀，统一为全浓度 `text-muted-foreground`，恢复工具行摘要旧版视觉（新 Tailwind `@theme inline` 使透明度真实生效导致偏淡）；`src/components/chat/surface/AttachmentPreview.tsx` 另有 6 处同类命中（/60~/75，新装饰层）仅记录未改。验证：8 个 tool-renderer 相关测试文件 95 用例通过，`npm run lint` 通过（仅 coverage/ 既有 3 warning）；无测试断言受影响，feature_list.json 未改，无 Git commit。

---

## turn-error-row-react-ownership（done，2026-09-19 修复 removeChild NotFoundError）

- 问题（用户报障）：点「重试」或刷新后浏览器抛 `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node`，冒泡到 ErrorBoundary。
- 根因：`src/components/chat/panel-decoration/turn-error-row.ts` 把 React 渲染的错误红块（`AssistantMessage.tsx:118-122` 的 `div.bg-destructive/10`）当作装饰层自己的行复用：`row.className = ...` 覆盖 React className、`row.replaceChildren()` 删除 React 的 `<strong>` 与文本节点，并把 escalate/details 追加到其父级。React fiber 仍视这些子节点为己有，重渲染/卸载时执行 `removeChild` 即抛错。
- 改动（2 源码/测试文件 + 1 新测试 + wiki）：`turn-error-row.ts` 红块改为**只读**——仅内联 `style.display='none'` 隐藏（不改 className、不动子节点、不移除）；行改为装饰层自建的 `.quickforge-error-line` 兄弟节点（首次创建、之后复用，retrying 加 `.quickforge-error-retrying`），retry/details/escalate 全部挂在装饰层节点上；错误解除时清理行 + escalate + details。`decorateTurnErrorRow` 与所有导出/类型签名不变，escalate/details 仍挂 assistant 宿主（`div.qf-assistant-message`）作兄弟节点。视觉等价：改前是**替换** className 为 `quickforge-error-line`，故行样式本就完全来自该类（`index.css:6542-6707`：flex/缩进/图标/文字/按钮/升级/详情），无需补类。
- 新增测试：`tests/frontend/turn-error-row-ownership.test.ts`（6 用例，结构 fake DOM，无 jsdom）：红块子节点/value 与 className 装饰后不变、被 `display:none` 隐藏、行只创建一次且重复 decorate 复用、点击重试仍调用 onRetry 且不删 React 子节点、escalate/details 是宿主兄弟节点、错误解除后清理。既有 `message-actions.test.ts` 的 turn error row 契约断言同步到装饰行（红块保持原样）。
- 验证（全部 exit 0）：`npx vitest run tests/frontend/turn-error-row-ownership.test.ts tests/frontend/message-actions.test.ts tests/frontend/error-messages.test.ts tests/frontend/turn-error-state.test.ts` → 4 files / 69 passed；`npm run test` → 360 files / 4288 passed + 1 skipped；`npm run lint` → 0 error（仅 coverage/ 既有 3 warning）；`npm run build`（含 `tsc -b`）→ 通过（仅既有 KaTeX/node:fs/chunk warning）。
- 未决风险：行改为 append 到 assistant 宿主的末尾（替代原来的原位改写），错误红块本就在渲染尾部，视觉顺序等价；若未来错误红块之后出现新的 React 尾部节点，装饰行会落在其前而非原位——当前 surface 无此结构。装饰层仍不接管 React 节点，process-folding 等其它装饰器未改。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖。

---

## process-group-release-structural-gate（done，2026-09-20 修复 subagent 运行期 spinner 闪烁）

- 问题（根因已由前序分析定位）：subagent 运行期间 `tool_execution_update`（子代理工具 start/end 立即发、trace ~150ms 节流）每次让 messages 数组换引用，`ChatSurface.tsx` 的 `ProcessGroupReleaseBoundary` 仅凭 `prevMessages !== nextMessages` 就整组释放存活 process 折叠组，下一 rAF decorate 走全量重建把节点搬回——两次 DOM 搬动重启 pending 工具行的 `animate-spin`。
- 改动（叠加在并行会话的 streaming-terminal gate 之上，未回退其成果）：`shouldReleaseProcessGroups` 的 messages 信号从数组引用收窄为消息行结构渲染身份序列——直接复用 `content-parts.ts#messageRenderKeys`（与 MessageList 行 key 同一实现，防漂移），长度或任一 key 不同才 release；key 结果按数组引用 WeakMap 缓存（`getSnapshotBeforeUpdate` 每次渲染调用，避免每帧重建 Map）；messages 缺失仍防御性 release。并行会话新增的 `isStreaming` 翻转 / streamingAssistant 出现-清空信号原样保留。同步更新 ChatSurface.tsx 与 process-folding.ts 的契约注释、docs/wiki/src/components/README.md 两处副本。
- 新增测试：`tests/frontend/chat-surface-release-gate.test.ts`（10 用例：引用变化但结构不变不 release、toolResult 原位重插不 release、新增/删除/重排/换身份 release、重复身份 occurrence 后缀稳定、无时间戳指纹前缀稳定语义、终态翻转仍 release、缺 gate/messages 防御 release、缓存一致性）；并行会话新加的 `process-folding-ownership.test.ts` 中 2 个以空数组占位断言旧 identity 语义的用例已按新契约修正数据与断言。
- 验证（全部 exit 0）：定向 5 文件 116 tests 通过；`npm run test` 364 files / 4347 passed + 1 skipped；`npm run lint` 通过；`npm run build`（含 tsc -b）通过（仅既有 KaTeX/node:fs/chunk warning）。
- 未决风险（语义收窄的理论边界，未发现真实触发路径）：整表替换类写入（`messages_replaced`/watchdog state 对账/`message_end` 全量回填）若产生「行身份序列完全相同但某行内容 part 结构收缩」的数组，新 gate 不释放，React 行内 removeChild/insertBefore 可能打到被折叠节点。已核查现有写入方（rollback/clear/compaction 改变行身份或长度、tool_execution 只原位重插 toolResult、metadata 更新不改结构），未发现该形态；如未来出现 removeChild NotFoundError 回归，优先检查此类写入。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖；未改 feature_list.json（全部 done，本轮为 bug 修复轮次）。

---

## local-file-path-links 正则 lastIndex 状态污染加固（done，2026-09-20）

- 问题：`LOCAL_FILE_PATH_REGEX`（带 g 标志）在 `collectLocalFilePathTextNodes` 的 acceptNode 中用 `.test()` 过滤文本节点；原实现为「命中后再重置 lastIndex」，依赖先污染后清理，任何残留偏移都会让后续短文本节点从偏移处扫描而整段漏判（路径不链接化）。
- 修复（最小改动）：把 `LOCAL_FILE_PATH_REGEX.lastIndex = 0` 移到 `.test()` 之前（每次匹配前重置），并加注释说明；`linkLocalFilePathTextNode` exec 循环前既有的重置保持不变。行为不变，仅消除对残留状态的依赖。未去 g 标志（exec 循环需要迭代）。
- 新增测试：`tests/frontend/local-file-path-links.test.ts`（4 用例，Node 环境 + 最小 Fake DOM，风格对齐 message-actions.test.ts）：长路径命中后短文本节点仍链接化（lastIndex 残留回归）、多次 decorate 多容器交替长/短路径顺序不漏匹配、同签名重复调用幂等、pre/code 跳过选择器行为不变。已做变异验证：删除重置行后前两个用例准确变红（`D:\x.md`、`/mnt/data/x` 漏链接化），证明用例真实守护该场景。
- 验证（exit 0）：`npx vitest run tests/frontend/local-file-path-links.test.ts tests/frontend/message-actions.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 3 files / 56 passed；`npm run lint` → 0 error 0 warning。
- Notes（与本次修复无关的观察，不扩大范围）：本修复前的 src 已含「命中后重置 + exec 前重置」，且 ES 规范下 `.test()` 未命中会自动归零 lastIndex，纯 src 路径未必能复现用户漏链现象；真机「路径未变蓝」若仍复现，优先排查 `decorateLocalFilePathLinks` 的 signature 短路（markdown 重渲染但 timestamp/文本长度/块数不变时跳过再装饰）与路径位于 pre/code 内被设计跳过的情形。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖；未改 feature_list.json（bug 修复轮次）。

---

## 2026-09-20 · 聊天文件路径链接化扩展：工作区相对路径纳入（local-file-path-links）

- Goal：`src/components/chat/panel-decoration/local-file-path-links.ts` 的 `LOCAL_FILE_PATH_REGEX` 在保留既有绝对路径匹配（盘符 `X:\\`/`X:/`、`/Users|/home|/workspace|/mnt|/Volumes` 前缀）的前提下，新增工作区相对路径分支（如 `src/App.tsx`、`docs/wiki/README.md`、`tests\\frontend\\chat.test.ts`），SKIP 容器（pre/code/a/button/thinking/tool 卡等）与 `onOpenLocalFilePath` 回调链不变（服务端 `resolveWorkspacePath` 已支持相对路径解析）。
- 正则设计（扩展原正则为三分支 alternation，绝对分支在前防内部子串匹配）：
  - 相对分支：`[A-Za-z0-9_-]+(?:[\\/][A-Za-z0-9_.-]+)*[\\/][A-Za-z0-9_.-]+\\.[A-Za-z0-9]{1,8}`——≥2 段、`/`与`\\`可混用；首段不含点（排除 `example.com`/`v1.2` 形态）；中间段可含点横线；末段必须带 1-8 位扩展名。**与任务规格的一处有意偏差**：末段 basename 用 `[A-Za-z0-9_.-]+` 而非规格字面的 `[A-Za-z0-9_-]+`，否则 `chat.test.ts`/`patch-release-runbook.zh-CN.md` 这类多段点文件名会被截断成 `chat.test`（任务自带验证用例 `tests\\frontend\\chat.test.ts` 要求完整链接化）。
  - 防误伤守卫：整体前置行后行断言 `(?<![\\w./\\:-])` 对三分支统一生效——排除前导为单词字符/点/分隔符/冒号的起点，防 URL 子串（`https://example.com/a.ts`）、盘符路径内部重复匹配（`D:\\x\\src`）、版本号（`v1.2/file`）。**顺带修复存量误伤**：旧盘符分支会把 URL 中的 `s://example.com/a.ts` 当盘符路径链接化（`[A-Za-z]:` 命中 https 的 s:），统一守卫后该 URL 整体不链接化（任务验证用例明确要求）。
  - 尾部标点修剪（TRAILING_PATH_PUNCTUATION）与 g 标志 lastIndex 每次匹配前归零（collectLocalFilePathTextNodes / linkLocalFilePathTextNode 两处既有重置）保持不变。
- 新增测试：`tests/frontend/local-file-path-links.test.ts` 追加 5 用例（4→9）：常见相对路径链接化（正斜杠/反斜杠/混用分隔符、单节点多路径）、不误伤（`and/or`、`a/b`、`2024/05`、`v1.2/beta`、`https://example.com/a.ts` 全部零链接）、行内 `D:\\quickforge\\src\\App.tsx` 整体只匹配一次、pre/code（含反引号内联代码渲染产物）内相对路径仍跳过、长相对路径命中后短相对路径 lastIndex 回归。绝对路径旧 4 用例原样通过。
- 验证（exit 0）：`npx vitest run tests/frontend/local-file-path-links.test.ts tests/frontend/message-actions.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 3 files / 61 passed；`npm run lint` → 0 error。未跑全量 test/build（定向验证，改动面仅此装饰器正则与对应测试；grep tests/ 无其他文件引用 quickforge-file-path-link/decorateLocalFilePathLinks）。
- docs/wiki 未更新：`docs/wiki/src/components/README.md` 及全部 docs/ 均无 local-file-path-links 条目或「仅绝对路径」表述（grep 本地路径/file-path/openLocalFile 零命中），无存量描述需要修正；源文件内已补三分支规则注释。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖；未改 feature_list.json（增强轮次，feature 全 done）。

---

## server-resolve-path-relative-fix（done，2026-09-20 修复点击相对路径链接报错）

- 问题：前一轮 `local-file-path-relative-links` 已把聊天中工作区相对路径链接化，但点击后走 `POST /api/workspace/resolve-path`（App.tsx `openLocalFilePathFromChat`），服务端 `server/routes/workspace.mjs` 的 `handleWorkspaceResolvePath` 存在 `path.isAbsolute` 前置守卫，相对路径一律 400 "Only absolute paths are supported"。
- 修复（最小改动）：删除该守卫段，其余 handler 逻辑不动；底层 `resolveWorkspacePath`（server/utils/workspace.mjs）本就支持相对路径（以 workspaceRoot 为基准解析）且含 isInside 越界 403，`assertSafeWorkspacePath` 继续承担敏感文件/realpath 校验。守卫删除后 `import path from 'node:path'` 在该文件再无模块引用（grep 确认仅剩 `body?.path` 属性访问），一并移除以过 lint。
- 新增路由级回归测试：`tests/server/routes/workspace-resolve-path.test.mjs`（3 用例；组织方式参照 tests/server/routes/workspace-mention-project-context.test.mjs：QUICKFORGE_DATA_DIR 临时目录 + storage.writeProjectConfigData 注册 project-1 + vi.resetModules 动态导入路由，POST body 用 Readable 构造，参照 workspace-open-external.test.mjs）：相对路径 `src/App.tsx` → 200 且返回 relativePath；`../outside` 越界 → 403；workspace 内绝对路径 → 200（保持旧行为）。
- 验证（exit 0）：`npx vitest run tests/server/routes/workspace-resolve-path.test.mjs tests/server/utils/workspace.test.mjs` → 2 files / 56 passed（含既有 util 53 用例）；`npm run lint` → 0 error。未跑全量 test/build（服务端改动面仅删一个前置守卫，定向覆盖路由 + util 语义）。
- dev 重启结论：`npm run dev` = `node server/index.mjs --dev`，纯 node 进程（无 nodemon/watch；dev 模式仅内嵌启动 Vite dev server 负责前端），server/*.mjs 改动不会自动重载——**用户需手动重启 dev server 后再验收**。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖；未改 feature_list.json（bug 修复轮次，feature 全 done）。

---

## hooks-timeout-max-300（done，2026-09-20 Hooks 超时上限 120→300 秒）

- 需求：用户需要 5 分钟 Hooks 超时；`timeoutSeconds` 上限从 120s 提升到 300s（下限 1、默认 10 不变），前后端同构保持。
- 改动（4 文件 + 本记录）：`src/lib/hooks-settings.ts` 与 `server/hooks/hooks-settings.mjs` 的 `MAX_HOOK_TIMEOUT_SECONDS` 120→300；`tests/frontend/hooks-settings.test.ts` clamp 断言 999→300，补 300 合法 / 301 截断边界，loadHooksSettings 用例期望值 120→300；docs/wiki 两处「timeout clamp 1–120s」同步为 1–300s（`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`）。`HooksSettingsTab.tsx` 输入框 max 引用常量自动生效；`src/lib/i18n.ts` grep 无「120 秒 / 1-120」文案（零命中），无需改动。
- 验证（exit 0）：`npx vitest run tests/frontend/hooks-settings.test.ts tests/frontend/hooks-settings-tab.test.ts tests/server/hooks tests/server/routes/hooks.test.mjs` → 5 files / 48 passed；`npx tsc -b --pretty false` 通过；改动文件 `npx eslint`（src/lib/hooks-settings.ts、tests/frontend/hooks-settings.test.ts、server/hooks/hooks-settings.mjs）0 错误。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`、`design-mockups/`；无新增依赖；未改 feature_list.json（小改动轮次，feature 全 done）。

---

## user-message-actions-right-align（done，2026-09-21 修复用户消息操作 icon 行未与气泡右缘对齐）

- 问题：用户消息气泡（`align-self: flex-end` 贴行容器右缘）下方的操作 icon 行来自 `message-actions.ts` user 分支的 Tailwind `mx-4`，其右侧 1rem margin 仍在，导致 icon 行右缘比气泡右缘缩进 16px。
- 修复（最小改动）：`src/index.css` 的 `.quickforge-user-message .quickforge-message-actions` 规则在既有 `margin-left: auto;` 基础上新增 `margin-right: 0;`（覆盖 Tailwind `mx-4` 的右 margin）；未动 2402/2412 等被契约测试锁定的规则，未改 `message-actions.ts`。
- 验证（exit 0）：`npx vitest run tests/frontend/chat-surface-css-contract.test.ts tests/frontend/message-actions.test.ts` → 2 files / 71 passed。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖；未改 feature_list.json（UI 微调轮次，feature 全 done）。

---

## sidebar-nested-session-row-hover（done，2026-09-21 修复项目嵌套会话行 hover 背景不横跨整行）

- 问题：`src/components/sidebar/ChatSidebar.tsx` 项目展开区嵌套会话行 hover/active 背景仅从 32px 缩进处起绘制，不覆盖整行。根因：会话列表容器 `pl-8` 使行元素整体右移 32px，行自身背景随元素盒起点绘制；而项目行（rowClass）无外层缩进，hover 整行变色，违反 DESIGN_LANGUAGE.md「整行可点、hover 反馈清晰」。
- 修复（最小改动，仅此文件）：① L1648 容器去掉 `pl-8`（保留 `mt-0.5 space-y-0.5`）；② 会话行 `cn(rowClass, 'gap-1', …)` 补 `sidebarOpen ? 'pl-8' : ''`（cn 为 clsx+twMerge，`pl-8` 覆盖展开态 rowClass `px-2` 的左侧；折叠态不加，避免与 `justify-center px-0` 居中冲突）——内容仍缩进 32px，但行元素盒从 x=0 起，hover 背景横跨整行；③ 容器内三个 loading/空态占位行原依赖容器 `pl-8` 对齐，一并补 `sidebarOpen && 'pl-8'` 补偿缩进。
- 影响面：grep `pl-8` 全文件仅容器一处；其余 rowClass 使用处（默认会话列表、置顶/项目区、归档区）无外层 pl-8，不受影响。
- 验证（exit 0）：`npx eslint src/components/sidebar/ChatSidebar.tsx` 0 错误；`npx tsc -b --pretty false` 通过。
- 无 Git commit/tag/push；未改 `dist/`、`package-dist/`、`package-offline/`；无新增依赖；未改 feature_list.json（UI 微调轮次，feature 全 done）。
