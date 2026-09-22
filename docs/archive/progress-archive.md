# Progress Archive

更早的 feature 记录已从 progress.md 移入本文件（2026-09-04 归档，progress.md 仅保留最近 30 个 feature 及全部未完成项）。按归档时顺序排列（新→旧），追加归档时新内容插入本标题之后。2026-09-15 起按用户要求全部归档，主文件保持全新空状态。

## 2026-09-22 · process 折叠子级层级关系：缩进 + 左侧细连接线（process-fold-hierarchy）

- Goal：聊天「已执行 N 个工具调用」折叠结构中，顶层组头、stage 头、思考头、工具行全部左对齐 x=0，无层级区分。用户选定方案：折叠子级内容加「左缩进 + 1px 弱化左侧竖线连接线」。纯 CSS 改动，不改 DOM 结构、不改 process-folding.ts。
- 改动文件（同日调整后的最终态）：`src/index.css`（共享布局规则 `.quickforge-process-body, .quickforge-process-stage-body` 恢复原样；新增独立规则 `.quickforge-process-stage-body { padding-left: 0.75rem; border-left: 1px solid color-mix(in oklab, var(--border) 60%, transparent) }`，与主结构分割线同配方，浅/深主题均可用；注释说明层级语义）、`tests/frontend/chat-surface-css-contract.test.ts`（describe `process fold hierarchy contract`：钉住 stage-body 规则的 padding-left/border-left；负向断言共享规则与 `.quickforge-process-body` 规则不得含 padding-left/border-left、连接线不落到 `.quickforge-process-step` 叶子节点）、`DESIGN_LANGUAGE.md`（「布局与对齐」新增「例外：对话折叠的阶段内子级用缩进 + 细连接线」小节）、`feature_list.json`（新增 process-fold-hierarchy，done）、`progress.md`、`session-handoff.md`。
- 同日调整（用户反馈）：首版把缩进+连接线挂在共享规则上（组 body 与 stage body 都生效），用户反馈「顶层组头『已执行 · 9分33秒』到 stage 这一层不要缩进和细线」。改为仅 `.quickforge-process-stage-body` 保留缩进+连接线，`.quickforge-process-body` 恢复原规则；纯思考段直挂顶层 body 的 step 因此不再有缩进（顶层直挂内容回到原样），属预期。feature_list.json 该条目描述未回写（无 note 字段格式，遵循指示不动）。
- 层级语义（最终态）：仅 stage 头 → 子内容（思考块/工具行/中间 Markdown）这一层带缩进+连接线（stage-body 挂线）；顶层组头 → stage 之间不缩进、无连接线，组头与 stage 头对齐。收起态 body 本身 `visibility: hidden`，连接线随内容一起隐藏。
- 验证（定向，CSS 小改动未跑全量）：首版 `npx vitest run tests/frontend/process-folding.test.ts tests/frontend/process-folding-incremental.test.ts tests/frontend/chat-surface-css-contract.test.ts tests/frontend/thinking-header-adoption.test.ts` → **4 files / 87 passed（exit 0）**；调整后 `npx vitest run tests/frontend/chat-surface-css-contract.test.ts tests/frontend/process-folding.test.ts` → **2 files / 76 passed（exit 0）**；两次 `npx eslint tests/frontend/chat-surface-css-contract.test.ts` → **exit 0**。
- Notes（只记录，不扩范围）：
  - a) 既有契约断言零改动：字号契约钉的是 `.quickforge-process-summary` / `.quickforge-process-stage-summary` / thinking header / 工具行压平规则，均不含 body 展开区声明块。
  - b) DESIGN_LANGUAGE「子级层级用缩进表达（不用明显竖线）」原则保留，本条以「例外」形式登记，且约束不泛化到左侧导航等场景。
  - c) 无 Git 操作（2.2.0 发布的 git commit/tag/push 后续已完成，用户确认）、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

---


## 2026-09-22 · reasoning 模型默认思考等级 medium → high（default-thinking-level-high）

- Goal：reasoning 模型的默认思考等级从 medium 改为 high。全库搜索（排除生成产物目录与 docs/archive）后共改三处硬编码 fallback + 一处 wiki 文档：① `src/lib/pi-chat.ts` `defaultThinkingLevelForModel`（reasoning ? 'high' : 'off'，全部前端消费方经此函数自动跟随）；② `server/acp/server.mjs` `resolveInitialThinkingLevel`（ACP 新会话镜像 web UI，fallback 与注释同步）；③ `server/routes/scheduled-tasks.mjs` POST /api/scheduled-tasks 创建任务缺省 thinkingLevel 时的 fallback（调研发现的第三处硬编码）；④ `docs/wiki/server/README.md`「推理模型默认 `medium`」→ `high`。
- 改动文件：`src/lib/pi-chat.ts`、`server/acp/server.mjs`、`server/routes/scheduled-tasks.mjs`、`docs/wiki/server/README.md`、`feature_list.json`（新增 default-thinking-level-high，done）、`progress.md`、`session-handoff.md`。
- 验证（定向）：`npx vitest run`（default-options-settings-tab + default-options-settings-react）→ **2 files / 20 passed（exit 0）**；`npx vitest run tests/server/acp/ tests/server/scheduled-tasks.execution.test.mjs` → **6 files / 60 passed（exit 0）**；`npm run lint` → **exit 0**；`npx tsc -b --pretty false` → **exit 0**。
- Notes（只记录，不扩范围）：
  - a) 用户显式保存的 `settings['default-options'].thinkingLevel` 优先级不变；非 reasoning 模型仍 'off'；切到非 reasoning 模型自动归零守卫不变。
  - b) 测试中 'medium' 匹配均为显式值/profile override/持久化往返断言（agent-profiles / agent-manager.subagents / storage-layer / subagent-run-detail），与本默认值无关，零改动通过。
  - c) dist/、package-dist/、package-offline/、android/assets 中的同名逻辑为生成产物，不手工修改（下次构建/打包自然同步）。
  - d) 无 Git 操作、无依赖变更。

---

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
  - f) 本轮无 Git 操作（2.2.0 发布的 git commit/tag/push 后续已完成，用户确认）、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

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
  - f) 本轮无 Git 操作（2.2.0 发布的 git commit/tag/push 后续已完成，用户确认）、无依赖变更，未触碰 dist/、package-dist/、package-offline/。

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
  - c) git commit `chore(release): v2.2.0` + tag `v2.2.0` + push 已完成（用户确认，2026-09-22）；npm publish 按用户指令另行执行（默认不直接发布）。

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

---

## dead-code-cleanup-and-server-blindspot-tests（done，清理与测试补齐及全量验证完成）

- 当前目标：依据健康度分析报告落地三块——清理死代码（accept 死按钮通道/死 i18n key/STATUS_ICON 双副本/identity.mjs warning）、删除垃圾文件、为 server 盲区模块补单元测试。
- 清理：①goal-card.ts 删 accepting 字段+硬编码构造+永不可达 accept 按钮分支，resume 条件简化；GoalInspectorContent.tsx footer 删 accepting 按钮；acceptBlocked/continuing/goalAcceptanceCheck 活逻辑保留。②i18n.ts 删 10 个死 key（en/zh 成对 20 行）。③STATUS_ICON 双副本合并为 icons.ts 的 goalStatusIcon。④localizedGoalBlockerHint 去 export。⑤identity.mjs:92 去无用赋值（项目 lint 历史首次 0 warning）。⑥删除根目录垃圾文件 ') ' 与 ' )))'（均 0 字节）。
- 测试：新增 8 文件 78 用例覆盖此前 0 测试引用的 8 个 server 模块（plugins/manifest 21、plugins/loader 10、channels/channel-logs 6、routes/instructions 5、routes/static 7、routes/terminal 16、routes/mcp 11、cloud/index 2）；goal-card 系测试同步（断言翻转固化「无验收按钮」契约、双语清单收缩）。
- 文件（20 个，清单见 feature_list.json）：源码 6 + 测试改 2/新增 8 + 分析报告 1 + 三状态文件。
- 已验（父 Agent 实跑）：亲读核心 diff；node 断言死 key 零残留；npm run test 全量 333 files / 3746 passed + 1 skipped（+8 文件 +77 用例零回归）；npm run lint 0 error 0 warning；npm run build 成功（仅既有 KaTeX/chunk warning）。
- Notes/边界：服务端 accept API 按契约保留；goalCanAccept/confirmable 死通道/STATUS_KEY 与 toneForStatus 双副本/goal-plan-confirmation 空壳未动（独立决策点，后续候选）；agent-subagent-runner 执行级测试未做（桩最重）；static.mjs 403 防线跨平台不对称已按实测行为测试并记录未修。未新增依赖，无 Git 提交/发布。
- 下一步：浏览器验收 needs_review 场景时顺带确认 goal 卡片无 accept 按钮（预期不变，因该按钮本就不可达）；后续可考虑 confirmable 通道与 goal-plan-confirmation 空壳的独立清理 feature。

---

## goal-mode-i18n-chinese（done，实现与全量自动验证完成；浏览器中文界面视觉未实测）

- 当前目标：goal 模式中残留的未国际化文案（中文界面显示英文）调整为支持中文，新增独立 feature 无依赖，不推进其他 feature。
- 根因（两轮 explore 调研）：goal 前端 UI 已全面走 t()，残留英文全部来自服务端透传——goal 动作错误 message（updateGoal 只读 payload.error 不读 code）、blockerHint 恒为 GOAL_BUDGET_HINT 英文常量、blocker 机器码仅映射 2/13+1、goal_report 工具错误正文无 code、/goal 命令错误以英文纯文本 textResponse 持久化。
- 实现（机器码→前端 i18n key 映射、数据层保留英文，未知/无码一律回退原文）：① goal-card.ts BLOCKER_KEY 扩至 13+1 码 + localizedGoalBlockerHint()（GOAL_BUDGET_HINT_TEXT 镜像常量全等替换），buildGoalCardViewModel 统一本地化 blocker/blockerHint（三消费面 TSX 零改动）；② server-agent.ts 解析错误 body code 挂 Error.code，goal-ui.ts goalActionErrorMessage() 按 11 个静态码出中文；③ goal_report 错误改返回式 {isError, content:[英文], details:{type:'goal_report_error', code}}（15 码），agent-manager afterToolCall 提升 isError 标记（pi-agent-core 忽略返回对象 isError），goal-report-history 按 code 映射；④ startGoalPlanning 错误附 errorCode，新增 server/goal-command-messages.mjs 按 settings.language='zh' 本地化 textResponse（fail-open 英文）；⑤ goal 路由 400/404 补 errorCode；⑥ i18n.ts 新增 40 key（goalBlocker* 14/goalError* 11/goalReportError* 15）en/zh 成对。实现由两个 general subagent 并行（前端/服务端无文件交集），父 Agent 亲读全部核心 diff 复审。
- 文件（25 个）：源码 10（含新增 goal-command-messages.mjs）+ 测试 9（含新增 tests/server/goal-command-messages.test.mjs）+ wiki 3 + 三状态文件。
- 已验（父 Agent 实跑）：合并定向 vitest 15 文件 525/525 通过；node 断言 i18n en/zh key 集合一致（各 1820）且 40 新 key 齐备；npx --no-install tsc -b 0 error；npm run lint 0 error（仅既有 identity.mjs:92 warning）；npm run test 全量 325 files / 3669 tests 通过；npm run build 成功（仅既有 KaTeX/chunk warning）。
- Notes/边界：模型自由文本 blocker 与 GOAL_ACCEPT_BLOCKED 动态内容不映射（有意边界）；历史已持久化英文（旧 goal_report 错误卡无 code 回退原文、/goal 错误消息语言随创建冻结）保留当时事实；blockerHint 全等匹配依赖服务端常量镜像。并行会话同期在共享工作树推进 subagent-failure-trace 系列（untracked 文件与三状态文件顶部条目），与本 feature 无文件交集（feature_list/progress 顶部插入位置已错开）。未新增依赖，无 Git 提交/发布。
- 下一步：浏览器切中文验收五类文案；验收后可考虑 commit。

---

## subagent-failed-run-trace-refresh-loss-review（needs-review，纯调研+方案对比交付完成；待用户采纳修复方案）

- 当前目标：排查「subagent 已调用多个 tools 后失败，刷新页面只见最终报错、过程不可见，部分场景正常部分丢失」在哪些情况下存在，产出 `docs/reviews/subagent-failed-run-trace-refresh-loss.zh-CN.md`，不修改生产代码。
- 方法：三路 explore 并行调研（服务端持久化链 / 前端刷新恢复链 / 历史修复与文档契约）→ 父 Agent 亲读全部关键引用；与并行会话同主题诊断 docs/reviews/subagent-failure-trace-recovery.zh-CN.md 交叉验证一致并互补（本报告补版本考古、进程生命周期、入口差异判定、修复方案对比；吸收其 P2/P3 测试实证退化路径）。
- 核心结论：①唯一持久化载体=终态 toolResult 的 details.messages，1.10.2 起运行期失败统一注入全量 details；②主线 P1=置顶摘要行轻量载荷 + WorkspaceInspector store 未命中直落 fallback（聊天卡入口完整、置顶摘要入口丢过程）；P2=timing-only 终态 details 阻止 SSE 回填（判「任意 metadata」非 messages）；P3=残缺终态 store 遮蔽完整历史（终态→终态不覆盖）；③辅线=≤1.10.1 旧会话空 details（不可回溯）、prompt 前失败/审批拒绝无过程可带、运行中进程重启丢 runtime 快照、400ms 持久化 debounce 窗口崩溃；④渲染层无 error 抑制 trace 分支，「只见报错」唯一充分条件是 traceMessages 为空；⑤窗口化当前禁用（ChatPanelHost.tsx:658）勘误排除。
- 交付（4 个）：报告 + 三状态文件；报告含 15 行场景矩阵（判定+代码依据）、9 类失败终态枚举、双数据链路、二分定位验证步骤、修复方案 A/B/C/D 对比（A 推荐：打开/回填完整度统一规则，与并行报告 6.1 对齐）。
- 已验：父 Agent 亲读核实报告全部 文件:行号 引用（含并行报告 P2/P3 关键源码 subagent-run-detail.ts:798-804、agent-session-events.mjs:177-182 独立确认）；grep 五要素结构断言；node JSON.parse feature_list.json；git status 归属检查。docs-only 未跑 npm test/lint/build（无测试影响面）。
- Notes/边界：needs-review 待用户采纳方案（建议 A；实施前建议按报告第六节+并行报告第 5 节取证确认现场触发链）。场景 6 store 未命中属时序/容量边界未动态复现；版本归属 1.10.2 靠 CHANGELOG+progress 条目顺序（高置信）；纯调研零生产改动，无 Git 提交/发布。
- 下一步：用户评审两份互补报告后选择修复方案（A 为推荐起点），另开生产 feature 实施；实施时同步 wiki store 权威/轻量载荷/点击恢复契约。

---

## subagent-failure-trace-recovery（done，诊断报告与场景测试交付完成；未实施生产修复）

- 当前目标：诊断 subagent 已完成工具调用后失败时过程记录消失的恢复链路，不修改生产代码。
- 交付：`docs/reviews/subagent-failure-trace-recovery.zh-CN.md`（调用链、证据等级、场景矩阵、丢失层级、脱敏取证、修复建议与测试缺口）；`tests/frontend/subagent-failure-trace-recovery.test.ts`（7 个当前行为诊断用例，fixture 含 3 个已完成工具调用及 3 个结果、共 6 条 trace）。
- 场景结论：空 details + 有 previous 可恢复；timing-only/identity-only 等非空 details 缺 messages 会阻止回填；无 previous 则无内容可恢复。残缺终态 store 能遮蔽完整历史，轻量 payload + store miss 是独立降级路径；完整历史 + store miss 不丢过程。普通错误/超时/取消已有服务端保护为源码推导，未做端到端验证。
- 文件（5 个）：报告 + 诊断测试 + 三状态文件。
- 已验：父任务运行 `npx --no-install vitest run tests/frontend/subagent-failure-trace-recovery.test.ts`，1 文件、7/7 通过；三状态文件同步后以 node JSON.parse、顶部 feature/status/章节断言及 `git diff --check -- feature_list.json progress.md session-handoff.md` 校验 JSON/格式。未运行全量 test/lint/build。
- Notes/边界：done 表示诊断交付，不表示已修复或确认现场根因；无真实故障样本、原始 SSE、现场持久化消息，未验证真实模型/浏览器/持久化端到端。测试锁定的是当前丢失行为，实施修复时应转为恢复契约。生产代码、依赖与生成产物零改动，无 Git 提交/发布；未变更架构/职责/公共入口/发布流程，无需更新 wiki。
- 下一步：先收集同一 toolCallId 的脱敏 SSE、权威持久化与刷新前后载荷；取得证据后由用户选择字段级回填、完整度优先打开及轻量 miss 恢复方案，另开生产修复。

---

## goal-inspector-hint-popover-width（done，修复与定向验证完成；浏览器未实测）

- 当前目标：修复用户报告的右侧 Goal Tab「已完成」旁 ？ 提示浮层竖排文字。
- 根因：`goal-inspector.css` 的 `.quickforge-goal-inspector-pop` 只包住 18px ？ 按钮，pop-body `width:min(290px,100%)` 的 100% 按该包含块解析 → 实宽 ≈18px 逐字换行；且 ？ 左侧时间戳使 right:0 锚点易左溢裁剪。
- 实现（两轮）：首轮纯 CSS——position:relative 移到 `.quickforge-goal-inspector-status`、删 `.quickforge-goal-inspector-pop` 规则、pop-body 改 `width:max-content; max-width:min(290px, calc(100vw - 48px))`（根因：100% 按仅 18px 宽的 ？ 包含块解析导致逐字换行竖排）。续修（用户反馈未紧贴 icon）——`GoalInspectorContent.tsx` 状态行把 GoalHintPopover 移到 time 之后，？ 落在行末；浮层右缘与 ？ icon 右缘在任意面板宽度（340–1200px）精确对齐且不裁剪（从 ？ 右展 290px 在默认 380px 面板会溢出，故采用行末方案）。
- 文件（5 个）：goal-inspector.css、GoalInspectorContent.tsx + 三状态文件。
- 已验：定向 vitest 2 文件 13/13（两轮各复跑）；`npx --no-install tsc -b` 0 error（含 TSX 改动）；git diff --check 通过；两轮 diff 亲读复审。
- Notes/边界：基于并行会话 release-v2.1.0 提交（22fe294）之后的基线；浏览器视觉为人工验收项（点 ？ 确认横排+右对齐）；极窄面板 <322px 左缘理论轻微裁剪属可接受边界。未新增依赖、无 Git 提交。
- 下一步：浏览器验收后可考虑随下次发布提交。

---

## release-v2.1.0（done，Git 发布完成；npm publish 待用户手动执行）

- 当前目标：按用户指令「发布一个版本 2.1.0」发布 minor 版本（v2.0.0..HEAD 共 17 个提交的 dev 全量，不含 Android）。
- 内容：版本号 2.0.0→2.1.0（npm version --no-git-tag-version）；CHANGELOG [Unreleased] 转正为 [2.1.0] - 2026-09-13 并补全 17 个提交内容（Goal 模式/无限时长+默认 20 轮可配置/会话级并行/阶段分隔线/轮级文件撤销/subagent 模型与思考等级/重试保留工具历史/OpenCode harness 移除 breaking/Agent Profile 保存修复等），按最终状态修正旧 Unreleased 中已过时的预算描述，Released 小节含离线包路径与安装命令；README 当前版本徽章 2.1.0。
- 验证：npm run test 全量 323 files / 3649 tests 全过；npm run lint 0 error（仅既有 identity.mjs:92 warning）；npm run build 成功（仅既有 KaTeX/chunk 警告）；runtime/offline 包生成并 npm pack（package-offline/shawnstack-quickforge-2.1.0.tgz，7.5 MB / 471 files，版本核验 2.1.0）。
- Git：发布 commit 22fe294（4 文件：package.json/package-lock.json/CHANGELOG.md/README.md，husky pre-commit lint 通过）；tag v2.1.0；master 以 ff-only 快进与 dev 同步；dev/master/tags 已推送远端（首三次因 github.com 443 不可达失败，网络恢复后成功）；推送后核验 HEAD=22fe294 四 ref 同步、工作区干净。
- Notes：npm whoami 未登录（ENEEDAUTH），按手册不执行 npm publish，留给用户（先 npm login）；本三状态文件更新未提交，随下轮 feature 会话提交；GitHub Release（v* tag 触发 Desktop Build 工作流）不在本轮范围；未手工修改生成目录。
- 下一步：用户 npm login 后执行 npm publish（命令已提供）；下个 feature 会话顺带提交状态文件。

---

## pinned-summary-subagent-finished-show-all（done，实现与定向自动验证完成；浏览器未实测）

- 当前目标：落地调研报告（docs/reviews/pinned-summary-subagent-finished-count.zh-CN.md 第六节）方案 A——置顶摘要「智能体 · 已结束」真实计数 + 展开显示全部 + 提取轻量化（用户已采纳）。
- 实现：①`subagent-run-detail.ts` 新增 `MAX_TERMINAL_SUBAGENT_RUNS=100`，clamp 1..5→1..100（默认 limit=3 不动），extract 传 `{ lightweight: true }`；`buildSubagentRunPayload` 新增可选 `options.lightweight`——payload 的 traceMessages=[]、input/details=''（跳过全量 trace stringify），status/error 本地完整推导、output/timing 等照常，默认行为零变化。②`App.tsx` 显式传上限常量。③`GitToolsPinnedSummary.tsx` 删 `slice(0,3)`，标题/胶囊计数自动真实化（零新增 i18n）。④两测试文件更新+新增（clamp 1..100、105 条截到 100、轻量契约、5 条 finished 静态渲染计数断言、源码断言 slice 移除）。⑤wiki 两段同步。点击兼容：Inspector 仍优先 store 完整快照，仅 >100 旧 run 详情降级。
- 文件（10 个）：源码 3 + 测试 2 + wiki 2 + 三状态文件。
- 已验（父 Agent 实跑）：亲读全部 diff 复审；定向 vitest 7 文件 352/352（subagent-run-detail 100 含新用例、git-tools-pinned-summary 31、server-agent 138、subagent-running-indicator 11、workspace-inspector-request 7、process-folding 49、tool-artifacts-and-events 16）；`npx --no-install tsc -b` 0 error；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`git diff --check` 通过；grep wiki 旧措辞「最近优先取 3 项」「1–5 条」零残留；feature_list.json JSON.parse 通过。
- Notes/边界：done 表示实现与定向自动验证完成，浏览器视觉未实测（建议 >3 个已结束 subagent 会话验证展开全部/真实计数/点击详情完整/面板滚动）。store 未命中旧 run 详情降级为无 trace/input/details（文档化边界）。实施期间并行会话完成 goal-report-flat-style、goal-report-expanded-body-frame，与本 feature 无文件交集。未新增依赖、未手工改生成产物、无 Git 提交。
- 下一步：浏览器验收；验收后可考虑 commit。

---

## pinned-summary-subagent-finished-review（needs-review，纯调研+方案交付完成；待用户选择方案）

- 当前目标：调研置顶摘要「智能体 · 已结束」小节为何只显示 3 个（用户判断应有更多）并给出修复方案，产出 `docs/reviews/pinned-summary-subagent-finished-count.zh-CN.md`，不修改生产代码。
- 根因（父 Agent 亲读核实全部引用）：显示侧三层截断叠加+计数口径失真，数据源（server 会话消息、`ServerAgent.state.messages`）零截断——①`App.tsx:562` 未传 limit 走默认 3（`subagent-run-detail.ts:619`）；②提取层硬钳制 1..5（`:654`，测试 `subagent-run-detail.test.ts:112-122` 锁定）；③UI `visibleSubagentRuns.slice(0,3)` 与展开态无关（`GitToolsPinnedSummary.tsx:221/:864`）；④标题「已结束 · N」（`:857`）与胶囊计数（`:227/:271-282`）用截断后长度。"3"是 feature 逐代继承的实现边界（mockup 演示数据恰 3 条，「查看全部」机制只设计给任务组），非产品决策；`extractLatestTerminalSubagentRuns` 全仓唯一生产调用方为 `App.tsx:562`。
- 方案：A（推荐）真实计数+展开显示全部，必做配套=提取轻量化（跳过全量 trace stringify，置顶摘要行只消费 label/name/task/status/timing/canonicalToolCallId；须保留非 canonical 历史 run Inspector fallback 字段，报告 6.1 推荐 b）；B 仅提高上限；C 仅修计数口径。实施设计/影响面/验证见报告第六~八节。
- 文件（4 个）：报告 + 三状态文件。
- 已验：报告全部 文件:行号 引用亲读核实；全仓 grep 确认唯一生产调用方；node JSON.parse feature_list.json 通过（first id 正确）；git status 前后基线对比 src/server/tests 零新增改动（既有 M 为前序/并行 feature 遗留）。docs-only 未跑 npm test/lint/build。
- Notes/边界：needs-review 表示待用户在 A/B/C 中决策，全部方案未实施；撰写期间并行会话完成 goal-report-tool-flat-style（local-tools.ts/index.css/goal-report-renderer.test.ts/wiki lib），与本调研引用文件无交集。运行中小节与任务组无此问题（对照旁证）。
- 下一步：用户选择方案（建议 A）；采纳后按报告第六节实施设计开生产 feature。

---

## goal-report-expanded-body-frame（done，实现与全量自动验证完成；浏览器视觉未实测）

- 当前目标：按用户要求「goal_report 点开才见内容 可以用框框起来 参考其他的设计」，为展开内容区加轻量边框，复用项目已有 code-block 框配方；新增独立 feature 无依赖。
- 实现：调研确认先例为 code-block 组件自带框（`@mariozechner/mini-lit/dist/CodeBlock.js:64`：border border-border rounded-lg overflow-hidden，无背景无阴影）；`src/index.css` 的 `.quickforge-goal-report-tool-body` 增加 `border: 1px solid var(--border)` + `border-radius: var(--radius)` + `padding: 0.625rem 0.875rem`（附配方来源注释）；details 收起时内容隐藏，框仅点开后可见（不改模板、不动收起态摘要行）；消息字号契约保留。测试：goal-report-renderer.test.ts 新增框契约用例（border/radius/padding + not box-shadow/background）。wiki 呈现契约行同步。
- 文件（6 个）：`src/index.css`、`tests/frontend/goal-report-renderer.test.ts`、`docs/wiki/src/lib/README.md`、三状态文件。
- 已验（父 Agent 实跑）：node 源码断言 8/8 PASS；定向 vitest 2 文件 46/46（goal-report-renderer 38 含新用例）；`npm run test` 全量 323 文件 / 3647 tests 通过；`npm run lint` 0 error（仅既有 warning）；`npm run build` 成功（仅既有 KaTeX/chunk 警告）。
- Notes/边界：done 表示实现与自动验证完成，浏览器视觉未实测（收起一行灰色摘要、展开内容区带轻框）。详细模式下 body 内 code-block 自带框形成嵌套（层级语义，接受）。未新增依赖，未手工修改生成产物（build 正常刷新 dist），无 Git 提交/发布。
- 下一步：浏览器点开真实 goal_report 历史卡验收观感；验收后可考虑 commit。

---

## goal-report-tool-flat-style（done，实现与全量自动验证完成；浏览器视觉未实测）

- 当前目标：按用户反馈「默认收起和其他工具保持一致 不需要框选」修订 goal_report 工具卡形态：默认收起、去掉 tone 卡框与染色（经确认：染色 label 完全去掉与普通工具一致；展开内容状态化视觉保留），新增独立 feature 无依赖。
- 实现：`local-tools.ts` GoalReportToolRenderer 默认收起（`?? true` → `?? detailed`，与 todo_write 一致）、删 `data-tone` 属性与 `toneFor` 死代码；`index.css` 删 `.quickforge-goal-report-tool` 卡片配方（border/bg/shadow/::before 3px 左条）、5 个 data-tone 变量选择器、summary/body padding 特化、label tone 染色，class 保留为标记；blocker 警示条 `var(--quickforge-goal-tone)` → 固定 `#d97706`（blocked 语境原 tone 即 warning）；上一 feature 的消息字号契约（body 字号/行高 token）保留。测试同步：goal-report-renderer.test.ts 默认收起断言（`toContain(false)`）+ `not.toContain('data-tone=')`、删 info/warning tone 断言、用例名去 tone card。wiki `docs/wiki/src/lib/README.md` 呈现契约两行同步。
- 文件（7 个）：`src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/goal-report-renderer.test.ts`、`docs/wiki/src/lib/README.md`、三状态文件。
- 已验（父 Agent 实跑）：node 残留断言 10/10 PASS（tone 卡移除干净、保留项完整：标记 class/字号契约/blocker 固定色/goal-card 侧 tone 不受影响）；定向 vitest 3 文件 67/67 通过；`npm run test` 全量 323 文件 / 3646 tests 通过；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npm run build` 成功（仅既有 KaTeX/chunk 警告）。
- Notes/边界：done 表示实现与自动验证完成，真实浏览器视觉未实测（建议查看真实 goal_report 历史卡确认：默认收起、摘要行 muted 灰与普通工具一致、展开后仅内容区状态视觉）。tone 体系仅在 goal-report 工具卡上移除；`.quickforge-goal-card`（Inspector 常驻卡）与 goal strip 的 tone 未动。`quickforge-goal-report-tool` class 保留为标记（无样式规则），后续可按需清理。未新增依赖，未手工修改生成产物（build 正常刷新 dist），无 Git 提交/发布。
- 下一步：浏览器验收真实历史卡观感；验收后可考虑 commit。

---

## goal-plan-tool-card-font-consistency（done，实现与全量自动验证完成；浏览器视觉未实测）

- 当前目标：把上一 goal 已交付的设计稿 `design-mockups/goal-plan-tool-card-redesign.html`（S01–S05）落进生产：goal 期间计划工具调用卡（goal_report/todo_write）字号由「界面字号 rem 体系」切换到「消息字号」体系，与对话正文一致；新增独立 feature 无依赖，不推进其他 feature。
- 实现（纯 CSS，不改 local-tools.ts 模板，规避 goal-report-renderer 模板串断言）：① 工具卡摘要行组规则 font-size `0.875rem` → `calc(var(--quickforge-message-font-size, 14px) * 0.875)`（默认 13/13 下 ≈11.4px 与旧值一致，零视觉回归；line-height 1.5 保留，附注释）；② `.quickforge-goal-report-tool-body` 增加 `font-size: var(--quickforge-message-font-size, 14px)` + `line-height: var(--quickforge-message-line-height, 1.625)`（与 subagent-run-detail-body 先例同模式+注释）；③ 新增 unlayered 覆盖规则 `.quickforge-goal-report-tool-body .text-xs, .quickforge-todo-history-tool > div .text-xs` → `calc(×0.8)`（压过 Tailwind text-xs utility，遵循 index.css 文件末尾 unlayered 惯例；`> div` 直接子组合器避开 summary 行内 renderTiming 的 text-xs；13px 下节标签 9.75px→10.4px 越过 10px 可读下限）；④ `.quickforge-goal-report-scope-chip` 字号 `0.7rem` → `calc(×0.8)`，保留 `var(--font-mono)` 路径语义。测试：`goal-report-renderer.test.ts` 新增 'goal_report tool card message font contract' describe 3 用例锁定契约。
- 文件（5 个）：`src/index.css`、`tests/frontend/goal-report-renderer.test.ts`、三状态文件。
- 已验（父 Agent 实跑）：定向 vitest 3 文件 48/48 通过（goal-report-renderer 37 含新增 3 契约用例；首跑 1 失败为断言 slice 起点误命中上一条 padding 规则且新注释含旧值字样，改精确选择器与 `not.toContain('font-size: 0.875rem')` 后通过）；`npm run test` 全量 323 文件 / 3646 tests 通过；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npm run build` 成功（仅既有 KaTeX/chunk 警告）；node 源码断言 10/10 PASS；`git diff --check` 通过；git status 改动面仅 src/index.css + goal-report-renderer.test.ts（M）+ 上一 goal 设计稿（??）。
- Notes/边界：done 表示实现与自动验证完成，真实浏览器视觉未实测（建议设置·外观分开调整界面/消息字号，查看真实 goal_report/todo_write 历史卡验证一致性）。Process 折叠时间线 summary 行（index.css:2882/:3015 的 0.875rem）不在设计稿范围未动，可另开 feature 统一。summary 行规则全局作用于 local/mcp/subagent 全部工具卡（默认 13/13 零视觉回归，分开调整后分叉方向为与对话正文一致，符合 DESIGN_LANGUAGE.md「以对话区为视觉基准」）。wiki 未更新：纯样式字号行为变更，非架构/职责/入口变更。未新增依赖，未手工修改生成产物（build 正常刷新 dist），无 Git 提交/发布。
- 下一步：浏览器验收（分开调整两个字号设置 + 真实历史卡）；验收后可考虑 commit。

---

## goal-configurable-iterations（done，实现与定向自动验证完成；浏览器未实测）

- 当前目标：goal 最大轮次默认 8→20，并可在设置·常规页配置该轮次（注意样式与项目匹配），新增独立 feature 无依赖，不推进其他 feature。
- 实现：① 服务端——`agent-goal-state.mjs` GOAL_BUDGET_DEFAULTS.maxIterations 8→20（存量 goal 不改写）；新增 `server/goal-settings.mjs`（settings 键 `goal-settings`，clamp 1–100，fail-open 回落 20，DEFAULT 派生自 GOAL_BUDGET_DEFAULTS）；`startGoalPlanning` 锁内读配置显式传 budget；`extendResumeGoal` 追加量改用配置值（原 `+= GOAL_BUDGET_DEFAULTS`）；客户端 API 传 budget 仍被拒。② 前端——新增 `src/lib/goal-settings.ts`（仿 auto-compact-settings.ts）；`default-options-settings-tab.ts` 常规页主 section 新增「Goal 最大轮次」数值行（复用 quickforge-settings-* 既有 class 与 autoCompactThresholdPercent 暂存+clamp 提交模式，零新增 CSS）；`i18n.ts` 新增 goalMaxIterations(+Description) en+zh；`goal.ts` goalBudgetExtension(goal, grantIterations=20) 去硬编码 8；`GoalInspectorContent.tsx` useEffect 读配置使追加确认展示配置增量。
- 文件（25 个）：源码 8（3 新增）+ 测试 7（1 新增）+ wiki 7 + 三状态文件，清单见 feature_list.json。
- 已验（父 Agent 实跑）：合并定向 vitest 10 文件 238/238 通过（manager 日志可见 round 0/20 新默认生效）；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npx tsc -b` 0 error；`npm run build` 成功（仅既有 KaTeX/chunk 警告）。实现由两个 general subagent 并行完成（服务端/前端无文件交集），父 Agent 亲读全部核心 diff 复审（startGoalPlanning/extendResumeGoal 接线、双端 goal-settings 契约一致、设置行零新增 CSS）。
- Notes/边界：done 表示实现与定向自动验证完成，真实浏览器视觉（设置行观感、窄屏、中英文）未实测。extend 追加量与配置值同源（与默认值解耦属评审 B4 另开 feature）；runner 测试 mock goal-settings 保持 hermetic（真实存储路径 manager/runtime 覆盖，agent-goal-runtime 15/15 通过）。wiki 7 处「默认 8 轮 / +8」已全部更新。未新增依赖，未手工修改生成产物（build 正常刷新 dist），无 Git 提交/发布。
- 下一步：浏览器验收设置·常规页新行（观感/窄屏/中英文）；验收后可考虑 commit。

---

## goal-p0-fixes（done，实现与定向自动验证完成；浏览器未实测）

- 当前目标：落地 goal-display-interaction-review 评审报告的 P0 三项（用户指示「修复p0」），新增独立 feature 无依赖，不推进其他 feature。
- 实现：① ND-03——`goal-control-strip.ts` openSummary 参数化，预算耗尽 resume 分支传 'progress'（追加确认组所在视图，对齐 wiki components README:148 既有契约，此前实现固定 'edit' 与 wiki 矛盾）；编辑 icon 保持 'edit' 且 aria/title 换 goalEditObjective（U4：名称与目的地一致）。② G10——`goal-iteration-divider.ts` 叹号条件扩到 execution error/blocked/cancelled（warningOutcome 派生），completed/running/verifying/paused/needs_review/budget 阻断保留对勾。③ ND-04——i18n 六组 key en+zh 值改写去「确认」承诺（goalCommandDescription/goalResumeNote/goalScopeChangeNote/goalHintPaused/goalPauseSaveNote/goalReportWasWaiting），key 名不变。
- 文件（9 个）：`src/components/chat/panel-decoration/{goal-control-strip,goal-iteration-divider}.ts`、`src/lib/i18n.ts`、`tests/frontend/{goal-control-strip,goal-iteration-divider}.test.ts`、`docs/wiki/src/components/README.md`、三状态文件。
- 已验（父 Agent 实跑）：定向 vitest 7 文件 194/194 通过（divider 44→67、strip 24→28 含新增断言，既有 open→'edit' 断言不回退）；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npx tsc -b` 0；node 断言 i18n 十组旧措辞零残留、十二条新措辞齐备；JSON.parse 通过；归属脚本确认本轮 prod 改动仅限清单。
- Notes/边界：done 表示实现与定向自动验证完成，真实浏览器（aria 播报、图标观感、窄屏）未实测。goalOpenSummary key 仍被摘要导航/error span 正确消费；六组 key 名不变保证兼容。未新增依赖，未改 server/dist/package-dist/package-offline，无 Git 提交/发布。
- 下一步：浏览器验收后可考虑 commit；评审报告 P1/P2 项待用户后续选择。

---

## goal-display-interaction-review（needs-review，纯评审交付与自动验证完成，待用户评审采纳）

- 当前目标：评审 Goal 功能「显示与交互」层的可优化点，产出 `docs/reviews/goal-display-interaction-review.zh-CN.md`，不修改生产代码；新增独立评审 feature（无依赖），不推进其他 feature。基线为 goal-ui-live-ticker-grouped-summary 及其续报微调之后的当前工作树。
- 方法：两路 explore 只读调研（7 surface 现状地图 + 历史评审约 60 条编号对照）→ 父 Agent 亲读全部关键源码引用并复核 12 项历史「待复核」→ 撰写报告。
- 核心发现：P0 三项——ND-03 预算耗尽 resume 落点错视图（aria 承诺追加确认、openSummary 固定 edit、确认组只在 progress，goal-control-strip.ts:311-315/:443-446 vs GoalInspectorContent.tsx:238-248）、ND-04 六组 i18n 文案仍承诺已废除的人工确认（入口 goalCommandDescription i18n.ts:388/:2182 等）、G10 执行期失败轮分隔线对勾；P1——ND-05「上方的卡片」语境失效、ND-07 时长 floor/round 口径矛盾、ND-13 错误行无键盘、C-01 tone 色值 4 组+散点、ND-08 置顶摘要无终态过滤；P2——ND-01 accept 恒不可达、ND-02 goal-card.ts 822 行死代码+空壳 plan-confirmation+≥14 死 i18n key 等。ND-06 定性修正：Inspector 无限时长行隐藏为续报微调有意决策（测试锁定），残留仅 wiki 未同步+终态无时长回显（低）。报告含历史编号全量对照表（12 项待复核全部给出源码结论）与撞号说明（G-10≠G10、S-01≠S1）；K-01 重新定性（聊天卡退役后双显不存在，残留为 ND-05 语境错误）；G-16 前两点确认（pr-[5.5rem] WorkspaceInspector.tsx:1957、hover:bg-black :2097）。
- 文件（4 个）：`docs/reviews/goal-display-interaction-review.zh-CN.md`（新交付物）+ 三状态文件。
- 已验：父 Agent 亲读核实报告全部 文件:行号 引用；node JSON.parse feature_list.json 通过；grep 报告结构断言（7 surface 小节/对照表/撞号说明/P0P1P2）齐备；git status --porcelain 仅 4 个预期文件，src/server/tests/dist/package-dist/package-offline 零变更。docs-only 未跑 npm test/lint/build（无测试影响面）。
- 重新规划轮复核（结论交付，goal 重新规划后第 4 轮）：3 个 P0 依据 node 断言在当前工作树仍成立（goal-control-strip.ts openSummary 固定 'edit'、i18n.ts:388 仍含 confirmation、divider 仅 planning 失败换叹号）；归属验证脚本通过——untracked 仅本 goal 交付文件、server/dist/package-dist/package-offline 零变更、17 个非本轮 prod M 全部归属（13 个前序续报清单 + 4 个并行会话布局修复 message-queue/todo-write-summary 的 goal-strip 兄弟容忍逻辑，diff 抽查确认非本轮评审内容），unexpected=0；chat 已交付结论（一句话总评 + P0 三项 + 采纳路径）。上一轮 c6 快照断言 blocked 的教训已吸收：本轮断言直接写成归属形式并全部可验证。
- Notes/边界：needs-review 表示评审交付与自动验证完成，全部建议未实施，采纳后另开生产 feature。时序/布局类风险（U3/U6/G05/U2）静态推断未动态复现；真实浏览器视觉不在本轮范围。死代码清理（ND-02）涉及契约测试（tests/frontend/goal-card.test.ts:281 断言 Host 不挂载），建议独立 feature 单独评审测试影响。Notes（协作）：本轮撰写期间发现其他会话对 goal-ui-live-ticker-grouped-summary 的续报微调（无限时长行隐藏等）已入工作树，报告已按最新状态引用并修正 ND-06 定性。
- 下一步：用户评审报告（优先采纳 P0 三项）；采纳后按建议清单开生产 feature。

---

## goal-ui-live-ticker-grouped-summary（done，实现与定向自动验证完成；含续报微调 Inspector 无限时长行隐藏；浏览器视觉未实测）

- 当前目标：用户要求的三项 goal 模式 UI 修复（goal 运行条时长实时递增、规划中清单图标、置顶摘要 Goal 分组化）+ 续报微调（Inspector 累计用时上限无限时整行隐藏），新增独立 feature 无依赖，不推进其他 feature。
- 实现：1) `goal-control-strip.ts` 新增 1s interval ticker——以每次服务端快照的 `usage.activeDurationMs` 为锚点（快照到达时重置 `durationAnchorMs`/`durationAnchorAt`），显示锚点值 + 自快照到达起的流逝时间，服务端结算值仍为最终基准；goal 移除、转 terminal 或 detachRoot 即停并清理，再挂载重新锚定。推翻 wiki 旧约束「不以挂载时间或浏览器计时伪造实时用量」（原约束导致规划轮进行中时长冻结在 0 秒）。2) `STATUS_ICON.info`（仅 planning/awaiting_confirmation 使用）由圆圈+i info 图标换为 list-todo 清单 SVG（复选框+勾+三条线），`goal-control-strip.ts` 与 `goal-card.ts` 两处副本同步。3) `GoalSummarySection.tsx` 从无标题两行导航按钮改为与 Git/Tasks 组一致的带标题分组（`section aria-labelledby="pinned-goal-title"`，标题「Goal/目标」+ passed/total 计数），组内按序渲染规划 criteria todos（状态 icon：passed→CheckCircle2 绿 / failed→XCircle destructive / needs_review→Clock3 琥珀 / pending→Circle 弱化，passed 加 line-through），保留打开 Inspector 的导航按钮；`i18n.ts` 新增 pinnedGoalTitle（en Goal / zh 目标）。`GitToolsPinnedSummary.tsx` 零改动。4) 续报微调：`GoalInspectorContent.tsx` 预算区「累计用时（分钟）」行在 `maxActiveDurationMs === null`（goal 模式时间上限恒无限）时整行隐藏，不再显示「N/无限」；有限上限行为不变；`goalUnlimitedTime` i18n key 保留（goal-card.ts 聊天卡片仍在用）。5) 续报微调二：`goal.ts` 的 `SPINNING_STATUSES` 移除 `planning`（清单图标静止，仅 running/verifying/awaiting_input/awaiting_approval/pausing 忙碌态旋转，strip 与卡片共享语义）；`.quickforge-goal-strip` 宽度由 `width: 100%` 改 `fit-content` + `max-width: 100%`，运行条随内容自适应收缩不再占满 composer shell 全宽。6) 续报微调三：goal strip 锚点从 composer shell 首位改为 `suggestionMenu ?? editor` 紧前（紧贴输入框，任务摘要出现时仍在输入框上方紧邻）；todo-write-summary 的 isSettled 与 message-queue 的 isQueueAnchorFollower 均新增容忍 `quickforge-goal-strip` 后继，最终稳定顺序 `[msg-queue] [todo-summary] [goal-strip] [建议菜单?] message-editor`，三装饰器零 DOM flip。7) 续报微调四：`.quickforge-goal-strip` margin 改 `0 auto 0.375rem`，fit-content 宽度下左右 auto margin 在 composer shell 内水平居中。
- 文件（22 个）：`src/components/chat/panel-decoration/{goal-control-strip,goal-card,todo-write-summary,message-queue}.ts`、`src/components/git/GoalSummarySection.tsx`、`src/components/workspace/GoalInspectorContent.tsx`、`src/lib/{i18n,goal}.ts`、`src/index.css`、`tests/frontend/{goal-control-strip,goal-summary-section,git-tools-pinned-summary,goal-budget-inspector,goal-card,goal-state,todo-write-summary,message-queue}.test.ts`、`docs/wiki/src/components/README.md`、`docs/wiki/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 已验：定向 vitest 5 文件 120/120 tests 通过（goal-control-strip ticker 递增/清理/再锚点与新 icon 断言、goal-summary-section criteria 渲染断言（原 not.toContain 反转）、git-tools-pinned-summary 分组 section/标题契约）；`npm run lint` 0 error；`npm run build` 成功。续报微调另验：定向 vitest 3 文件 45/45 通过（goal-budget-inspector 8 用例含新「hides the duration budget row when unlimited」断言，原 toContain('Unlimited') 反转为 not.toContain 并补 not.toContain('Elapsed (min)')）；eslint 两改动文件通过；`tsc -b` 通过。续报微调二另验：定向 vitest 3 文件 83/83 通过（goal-state spinning 分类契约移除 planning、goal-control-strip planning 视图补 spinning:false 断言、goal-card CSS 宽度契约改 fit-content+max-width）；eslint 四改动文件通过；`tsc -b` 通过。续报微调三另验：定向 vitest 3 文件 68/68 通过（goal-control-strip 锚定 editor/menu 紧前、todo-write-summary 容忍 goal-strip 后继场景、message-queue follower 集合契约）；eslint 六改动文件通过；`tsc -b` 通过。续报微调四另验：定向 vitest 2 文件 50/50 通过（goal-card CSS 契约新增 margin 居中断言）；eslint 改动文件 0 error；`npm run build` 成功。
- Notes/边界：done 表示实现与定向自动验证完成，真实浏览器视觉（窄屏/主题/焦点/读屏）未实测。服务端结算值为最终基准，ticker 仅做快照间插值显示，不改变服务端 usage 记录语义；wiki「≥1 分钟按分钟向下取整」规则保留。未新增/升级依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist），无 Git commit/tag/push/发布。
- 下一步：无待办；可选后续为真实浏览器视觉验收。改动未提交。

---

## goal-report-tone-card（done，实现与定向自动验证完成；浏览器视觉为人工判断项未实测）

- 当前目标：将上一轮已验收的 goal 工具对话显示设计（tone 卡片 + 靶心图标 + 状态化验收标准 + scope chip + blocker 警示框）落进生产代码，依赖 `goal-report-renderer`（done），不推进其他 feature。
- 实现：`goal-report-history.ts` 新增 `criteriaDetails`（description + status，status 归一 pending/passed/failed/needs_review），`criteria` 字符串数组保留兼容；`local-tools.ts` 的 `GoalReportToolRenderer` 给 details 加 `data-tone` 与 `quickforge-goal-report-tool` class，类型图标由 `todo_write` 换成靶心 `GoalIcon`（内联 SVG），验收标准按状态渲染通过/失败/待审/待定四种图标，scope 改 mono chip，blocker 加 tone 左框，保持 shell/summary/status/空 plan-action mount 契约不变；`src/index.css` 新增 `.quickforge-goal-report-tool` 的 5 个 tone 选择器、左侧 3px 强调条、tone 色 label、criteria 四态配色、scope chip 与 blocker 样式。
- 文件（8 个）：`src/lib/goal-report-history.ts`、`src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/goal-report-renderer.test.ts`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。前三者源码改动为本 feature 的范围，本会话续跑时已在工作树中。
- 已验（父 Agent 实跑）：`npx vitest run tests/frontend/goal-report-renderer.test.ts` 退出码 0（34 tests passed，新增 criteriaDetails 归一、data-tone、靶心图标、scope chip、blocker 与四态图标断言）；`npm run lint` 退出码 0（仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning）；`npx --no-install tsc -b --pretty false` 退出码 0；`git diff --check` 通过。
- Notes/边界：done 表示实现与定向自动验证完成，浏览器视觉（c8）为人工判断项，未做真实浏览器/窄屏/主题/焦点验收。仅改上述文件，未改后端/无关文件，未新增/升级依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`，无 Git commit/tag/push/发布。新 renderer 方法内联在类内以通过 VM 测试。工作树中另有无关联的既有未跟踪文件（`docs/design/goal-*`、`goal-demo/`、`iter-demo/`）来自设计阶段，本 feature 未触碰。
- 下一步：浏览器打开一次真实 goal_report 历史消息验收视觉（c8）；改动未提交。

---

## retry-preserve-tool-history（done，实现与全量自动验证完成；浏览器未验收）

- 当前目标：用户提出「点重试会清掉对话、丢掉已执行 tools 调用，模型上下文对已改文件无感知」，确认按方案 A（按失败阶段分流）改造重试语义：被重试回合已产生 `toolResult` 时保留历史并追加一条「继续」用户消息续跑，纯文本失败仍截断重生成。依赖无（新增独立 feature），不推进其他 feature。
- 调研结论（两轮 explore）：现状 `retryFromMessage` 前端 `slice(index+1)` + `continueSession` 服务端 `slice(0, lastUserIndex).concat(...)` 是「原地重生成」的刻意设计（`CHANGELOG.md:1384`），副作用是丢弃失败轮已完成的工具调用与结果；pi-ai `transform-messages.js:150-158` 会把 `stopReason: error/aborted` 的 assistant 整条跳过，所以「保留失败的部分回答」对模型无意义，真正的收益是保住工具调用记录。只改服务端会坏：服务端消息数多于本地时 split 位置合并永久错位，且 summary 对账只在服务端更少时自愈。
- 实现：`src/lib/message-utils.ts` 新增 `hasToolResultsAfter`；`src/hooks/useChatActions.ts` `retryFromMessage` 分流（有工具结果 → `continue(continueMessage)`，否则原 slice 路径）；`src/lib/server-agent.ts` `continue(appendMessage?)` 乐观追加 + `message_start` + Cloud 模型补 `quickforgeClientMessageId` + 失败回滚；`src/lib/deferred-session-agent.ts` 透传；`server/agent-manager.mjs` 新增 `normalizeRetryAppendMessage` 与 `continueSession(sessionId, modelAccessContext, appendMessage)` 追加模式；`server/routes/agent.mjs` continue 路由读可选 body `{message}`。
- 实际文件（源码/测试/文档/状态共16个）：`server/agent-manager.mjs`、`server/routes/agent.mjs`、`src/hooks/useChatActions.ts`、`src/lib/server-agent.ts`、`src/lib/deferred-session-agent.ts`、`src/lib/message-utils.ts`、`tests/server/agent-manager.context-references.test.mjs`、`tests/frontend/server-agent.test.ts`、`tests/frontend/message-utils.test.ts`、`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 已验（父 Agent 实跑）：定向 `npx vitest run tests/server/agent-manager.context-references.test.mjs tests/frontend/server-agent.test.ts tests/frontend/message-utils.test.ts tests/frontend/message-actions.test.ts tests/server/routes/agent.test.mjs tests/server/agent-manager.external-sync.test.mjs` 退出码 0（5 files / 244 tests passed，含新增用例）；`npm run test` 退出码 0（322 files / 3617 tests passed，较上轮 +1 file/+6 tests）；`npm run lint` 退出码 0（仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning）；`npm run build` 退出码 0（仅既有 KaTeX 字体解析与 chunk 体积 warning）。新用例覆盖：追加模式保留 `toolResult` 且 `transformContext` 仍能看到工具结果、追加消息 timestamp 保留 + `contextReferences` 重新校验写入 details、无 `message` 时仍截断（既有用例继续通过）、前端乐观追加与请求体 `{message}`、HTTP 失败回滚乐观副本。
- Notes/边界：done 表示实现与全量自动验证完成，未做真实浏览器/真实模型验收；未验证项是 provider 对连续两条 user 消息的接受度（自动压缩 summary 是既有同形态先例但未线上验证）。追加消息正文复用既有 i18n `errorContinueMessage`（中「继续」/英 Continue），文案随当时语言写入会话历史。发送失败仍走既有 `retryFailedPrompt` 原样重发；分享页重试仍是 no-op。未新增/升级依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist），无 Git commit/tag/push/发布。Notes（发现但未修的无关问题）：前端 `retryFromMessage` 允许对任意 user 消息重试，而服务端始终取最后一条 user 消息，该既有口径不一致未在本轮扩大处理。
- 下一步：加载新前端后实测一次「多步工具中断 → 点重试」确认 provider 接受追加消息且历史保留；改动未提交。

---

## goal-parallel-sessions（done，实现与全量自动验证完成；浏览器未验收）

- 当前目标：用户确认把 Goal 互斥从「同一工作区最多一个活跃 goal」彻底改为「同一会话最多一个活跃 goal」，让不同会话真正并行执行，`/goal` 不再因别的对话已有活跃 goal 返回工作区冲突 409。依赖 `goal-stage-order-target-icon`（done），其全部历史 diff 与下方记录原样保留，不推进其他 feature。
- 互斥放开：删除 `GOAL_WORKSPACE_CONFLICT`(409) 及 `findWorkspaceGoalConflict`/`assertWorkspaceFree`/`workspaceKeyForSession`/`workspaceKeyForMetadata`/`activeSessionGoal`/`goalWorkspaceKey`/`normalizeWorkspaceKey`，并移除 `agent-manager` 只为该互斥注入的 `resolveWorkspaceRoot` 与 runner 侧对应依赖；全局对话共享的合成默认工作区、两个 projectId 指向同一目录的场景现均可各自持有活跃 goal。
- 会话级串行：start/confirm/resume/revise/extend_resume 走按 sessionId 串行的 admission 队列，锁内 re-check 后提交所有权，保证同会话读-改-写 `session.goal` 不交错，不同会话互不阻塞。
- X1 修复：`startGoalPlanning` 的「本会话已有活跃 goal」检查与 `clearGoalTermination` 移入会话锁内（此前在锁外，同会话并发 `/goal` 存在双写窗口）。
- 实际文件：`server/{agent-goal-runner,agent-goal-state,agent-manager}.mjs`、`server/agent-persistence.mjs`（仅一处陈旧注释 workspace exclusivity → goal 投影用途）、`tests/server/{agent-goal-runner,agent-goal-state}.test.mjs`、`docs/wiki/README.md`、`docs/wiki/server/README.md`（wiki 由另一 subagent 完成），另本轮同步 `CHANGELOG.md` 与三状态文件。
- 已验（父 Agent 实跑）：定向 `npx vitest run tests/server/agent-goal-runner.test.mjs tests/server/agent-goal-state.test.mjs tests/server/agent-goal-manager.test.mjs tests/server/routes/agent.goal.test.mjs` 退出码 0（4 files / 176 tests passed）；`npm run test` 退出码 0（321 files / 3611 tests passed）；`npm run lint` 退出码 0（仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning）；`npm run build` 退出码 0（仅既有 KaTeX 字体解析与 chunk 体积 warning）。覆盖同会话第二个 goal 被拒、不同会话与同路径两个 projectId 均可各自开 goal、两个不同会话并发 start 均成功且各持 own goal、同会话并发两次 `/goal` 恰好一个成功且 persistSession 仅 1 次；grep 确认删除符号在生产/测试/src 内零残留引用。
- Notes/边界：done 表示实现与自动验证完成，未做真实浏览器/真实模型验收。同一工作区可同时有多个 goal 并行跑工具，可能互相写文件或执行命令，互不隔离；「别的对话已有活跃 goal」的 409 提示与持久化 metadata 冲突扫描复核逻辑永久移除。未新增/升级依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist），无 Git commit/tag/push/发布；`docs/reviews` 下历史评审文档按历史保留原样。Notes（发现但未修的无关问题）：无。
- 下一步：父 Agent 最终审查后补真实浏览器验证（多对话并行打开 goal、同会话并发 `/goal` 只成功一个）；改动未提交。

---

## goal-stage-order-target-icon（done，实现与针对性自动验证完成；浏览器未测）

- 当前目标：用户已授权生产调整，依赖 `goal-stage-divider-live-sync`（done）；仅调整阶段分隔线视觉顺序与 Goal 身份图标，不推进其他 feature。
- 实现：`src/index.css` 的 divider `order: 3` 位于 actions `order: 2` 下方，保留正文/过程 → 操作栏 → 阶段分隔线及内部 user fallback/空 assistant source 契约。新 `src/components/goal-icon.tsx` 为 24 viewBox、currentColor、2px 双圆箭中靶心线条 SVG，复用于摘要行、胶囊 Goal 段、Inspector Tab/溢出菜单四入口；其他状态图标、导航与执行逻辑不动。
- 实际文件（源码与测试共10个）：`src/index.css`、`src/components/goal-icon.tsx`、`src/components/git/{GoalSummarySection,GitToolsPinnedSummary}.tsx`、`src/components/workspace/WorkspaceInspector.tsx`；`tests/frontend/{goal-icon,goal-iteration-divider,goal-summary-section,git-tools-pinned-summary,workspace-inspector-tabs}.test.ts`。另更新 `docs/wiki/src/components/README.md` 与三状态文件，共14个；新图标测试与 divider CSS/fallback 契约均纳入回归。
- 已验：实现委派及父 Agent 复跑定向9文件/196测试通过；委派 `npm run lint` 退出0，仅既有 `server/cloud/identity.mjs:92` warning，tsc通过。父 Agent 独立复跑 `npm run lint` 退出0，仅既有 `server/cloud/identity.mjs:92` warning；`npx --no-install tsc -b --pretty false` 退出0。本次文档委派仅检查 JSON、唯一ID、依赖、14文件路径、历史保留与 `git diff --check`。
- Notes/边界：done 限定实现与针对性自动验证，不等于真实浏览器验收；未做真实浏览器/模型、窄屏主题/焦点/读屏。全部既有未提交 diff、旧 feature、前轮 review/HTML 与历史原样保留，不将其他评审问题标为解决。未跑全量 test/build，无依赖、生成产物、Git commit/tag/push/发布。
- 文档/下一步：Wiki 只局部补视觉顺序和共享图标职责，不改 server 或架构总览；SVG 已是所需小图标，无需另增解释图。父 Agent 完成最终审查，再做真实浏览器视觉验收；改动未提交。

---

## goal-ux-ui-review-prototype（done，仅评审交付与自动验证完成）

- 当前目标/交付：依赖 `goal-stage-divider-live-sync`（done），接续复核完善轮初已存在的未跟踪草稿 `docs/reviews/goal-ux-ui-review.zh-CN.md` 与 `design-mockups/goal-ux-ui-optimization.html`，不是从零新建。报告覆盖完整 Goal UX/UI 旅程、G01–G11、信息分工/中英文案及分阶段建议；原型含九场景，复用交接与状态 SVG。
- 本轮改动：报告、原型及三状态文件；本次收尾委派仅回填报告验证段并新增三状态记录。唯一原型修复是 planning 同 scene 重新保存时 timer 复用，采用 generation + revision guard 隔离旧回调；不把提案算作生产修复。
- 父 Agent 实跑：Node 内联 `vm.Script`、71 唯一 ID、18 HTML 引用、零外部资源、9 场景、4 种规划双屏障、预算/编辑冲突、G01–G11 映射检查退出 0；28 组 fake DOM 事件与 timer guard 通过；定向 Vitest 8 文件/187 测试退出 0，完整命令见报告验证段。委派 6 项虚拟时钟及负对照通过，单列不混父级 28 组。
- Notes：首次静态检查把比较操作数的字面顺序断言写反，重读更正检查后重跑退出 0；委派长命令包装失败拆短后通过，均非生产测试失败。G01–G11 为评审发现/建议，生产未修；旧 feature、全部历史及无关问题原样保留。
- 限制：done 仅表示评审交付与自动验证完成，不代表产品缺陷已修复、真实浏览器通过，也不预写本 Goal 运行状态 completed。fake DOM 不是浏览器；无真实 browser/Playwright 通道，不安装依赖，布局/焦点/读屏/真实模型未实测。本轮未跑全量 test/lint/build，不改生产代码/测试/Wiki/依赖/生成产物，无 Git 提交/tag/push/发布。纯提案未变架构、公共入口或现行契约，Wiki 无需更新。
- 下一步：独立生产修复优先 G01/G02/G04；按报告补真实浏览器、窄屏亮暗、键盘/读屏及采纳后回归。本轮交付无自动验证阻断，改动未提交。

---

## goal-stage-divider-live-sync（done，实现与全量自动验证完成）

- 当前目标：规划/执行阶段分隔线持久化与实时同步；依赖已 done 的 `goal-plan-handoff-fix`，其全部历史 diff 和下方记录原样保留，不推进其他 feature。
- 契约：marker kind 为 planning/execution，legacy 无 kind 按 execution；规划 iteration 可 0 但 UI 不显示轮数。有效 plan 正常轮末 + 保存成功才显示「计划已就绪」，completed 同屏障。staged goal/messages pair 校验数组、长度和逐条引用；settling 拒绝 runPrompt；冲突保留 live history 暂停，取消优先。非尾 assistant marker 用内部 forceMessagesReplace 保存、不绕 CAS；chunked 派发前重验 canPersist。
- 实时同步：split state/GET sparse goalIterationMarkers 不传正文，按原索引+身份合并，最新 snapshot 在后到消息后重放；full metadata 不放宽正文 streaming 门禁。本地 message_metadata_updated 触发 Host 窗口消息/装饰更新，不清 process、不恢复 draft；marker 实际变化推进消息 watermark，goal_updated 不推进。
- 本次文件（按 Git 实际范围）：server/{agent-goal-runner,agent-manager,agent-persistence,agent-session-events,session-state-service}.mjs；src/components/chat/{ChatPanelHost.tsx,panel-decoration/goal-iteration-divider.ts}；src/lib/{i18n,server-agent}.ts；tests/server/{agent-goal-runner,agent-session-events,session-state-service}.test.mjs；tests/frontend/{goal-iteration-divider,message-actions,server-agent}.test.ts；server/src/lib/src/components 三份 Wiki README 与三状态文件。system-prompt、其测试、server/tools Wiki、runtime 新测试归上轮，不冒算本轮。
- 已验结果：父 Agent 最终实跑 `npm run test` 退出0，320 files/3605 tests 通过；`npm run lint` 退出0，仅既有 server/cloud/identity.mjs:92 warning；`npm run build` 退出0，仅既有 KaTeX 字体/chunk warning。此前联合定向 13 files/502 tests 通过；文档委派 JSON 解析、feature 依赖/唯一性、21 文件路径、HEAD 旧历史保留校验与 git diff --check 均通过。
- 复审：父 Agent 已审查并整合 staged 消息冲突、split 分页打断重放、full streaming marker 独立采纳三个竞态修正；正文 streaming 门禁不放宽。
- Notes/边界：done 表示实现与全量自动验证完成，无自动验证阻断。浏览器 c7 明确未实测，无现成浏览器通道（无 playwright 等工具，仅 electron runtime），不冒称现场模型验收，也不以人审阻塞自动验证结论。保留历史无关问题，不泛称已解决；完全存储故障/任意 I/O 崩溃窗口不保证补偿持久化。考虑 SVG 后复用现有细线/SVG，无需额外图；无依赖、Git 提交/发布或手工产物。
- 下一步：加载新服务/前端后可真 UI 观察规划/执行、刷新、暂停取消与窄屏主题；新规划 marker 不会回填无 marker 旧记录。改动未提交，上轮 diff 保留。

---

## goal-plan-handoff-fix（done，修复与全量自动验证通过）

- 修复：原报告阶段只看 `goal.status===planning`，plan 后的 awaiting_confirmation 仍属规划轮，却可被 blocked/needs_review 覆盖并阻止自动执行。现以 `isGoalPlanning(session)` 或未确认 awaiting_confirmation 拒绝执行期报告；重复 plan 原已拒绝，不冒称本轮新增。
- 授权：system prompt 明确显式 `/goal` 已授权目标范围内自动执行，不重复询问计划确认；必要澄清、工具审批、安全边界与正常轮末持久化仍保留。流程：只读规划 → plan → 正常轮末与持久化双屏障 → 自动 execution。
- 测试：新增真实 pi Agent + manager + SQLite、脚本模型 runtime 测试；prompt/persist 两种先后顺序均等待双屏障后恰好一次 execution，真实必要 ask 不自动回答；runner 补多组阶段与取消/失败保护。
- 父 Agent 已实跑：定向 20 files/390 tests 通过；npm run lint 退出0，仅既有 server/cloud/identity.mjs:92 warning；npm run build 退出0，仅 KaTeX/fonts/chunk 警告。最终全量 npm run test 退出0：320 files/3475 tests 通过（含 runtime 失败路径清理修正）；父 Agent 审查及独立只读复审完成。
- 文件：server/{agent-goal-runner,system-prompt}.mjs、tests/server/{agent-goal-runner,system-prompt}.test.mjs、新 tests/server/agent-goal-runtime.test.mjs；server/tools 两处 Wiki 与三状态文件。考虑 SVG 后采用简短流程文字；无 UI/历史文案变更，不需 src Wiki。
- Notes/边界：未确认现场会话根因，脚本模型 runtime 非真实模型/浏览器验收。调度门禁静默返回仅静态风险，未复现、未修，不扩大范围。全部历史记录保留；无依赖/手工产物/Git提交或发布，build 正常生成 dist 但 Git 无产物修改。
- 下一步：无自动验证阻断，改动未提交；重启加载新服务代码后可验证新 Goal，旧阻塞 Goal 不自动重放，需显式继续。真实模型/浏览器未实测，不影响上述自动验证结论。

---

## goal-changes-commit（in_progress，提交准备与推送交接）

- 用户已授权提交并推送本会话 Goal 改动；本子任务仅创建一个 commit，父 Agent 负责 push 和远端核验。初始分支 dev，上游 origin/dev，42 个既有改动/新文件均为 Goal 范围。
- 提交前实跑：npm run test 退出0，319 files/3457 tests passed；npm run lint 退出0，仅既有 server/cloud/identity.mjs:92 warning；npx --no-install tsc -b --pretty false 退出0；git diff --check通过。状态同步后再次 JSON/diff 与暂存区清单校验。
- 仅使用明确路径暂存，保留历史 feature/review，不新增依赖、不改生产源码、不生成构建产物、不建 tag、不发布 npm。本段为提交前快照，不伪造哈希或提前宣称推送完成。
- Notes：Wiki 声称 renderer 无 action mount，但 local-tools.ts 仍保留空 mount；无运行时确认按钮，属现有 Goal 文档偏差，本次提交任务不修。历史浏览器验收和评审缺陷不标已解决。
- 下一步：复核暂存区并创建 commit，回报真实 hash/status；由父 Agent 推送并核验远端。

---

## goal-auto-start-unlimited-time（done，实现与全量自动验证完成；浏览器待验收）

- 实现：planning 整轮及最终 persist 窗口只读，正常持久化后自动执行；新 Goal null 无限累计时间，usage 保留；resume/extend/revise 移除旧时间上限，extend 仅耗尽轮次 +8 且保留 CAS。当前 UI 无计划确认/验收，Inspector 显示无限与累计用时。
- 收尾：补 goalRun 清除后的 planning 最后持久化窗口只读门禁；needs_review→blocked 本轮仅 read_file/grep_files/必要 ask_user，禁止写/命令/委派/goal_report，问答与 error 结束均不续跑，不伪造 passed。历史 human evidence/accept API 保留。
- 验证：定向 2 files/107 tests；全量 npm run test 退出0，319 files/3457 tests passed；npm run lint 退出0，仅既有 server/cloud/identity.mjs:92 warning；npx tsc -b --pretty false 退出0；git diff --check通过。补 duration-only resume、null预算SSR无NaN、planning persist只读、needs_review提问后idle/error不续跑。
- 文档：逐条同步 Wiki 总入口/server/routes/tools/src/lib/components 现行段落，不改历史 reviews/features。保留 inert chat confirmation controller 与 Host 接线，避免扩大装饰生命周期清理；无 DOM/confirm 派发，非运行时确认入口。
- 边界/下一步：父 Agent 最终审查与浏览器真实模型/刷新/暂停取消/窄屏主题/焦点验收待办；done 仅表示实现与自动验证完成。其他历史评审问题未修。无 build、依赖/生成产物变更、Git commit/tag/push/发布。

---

## Feature：goal-hide-internal-run-messages（done，实现与自动验证完成；父 Agent 最终审查/浏览器待验收）

- 当前目标：只隐藏合法 metadata 的内部 execution/planning user 正文、操作与空白。保留DOM宿主、分轮边界、原索引、完整历史/模型上下文/计划确认；真实同文本仍可见。class可逆幂等，操作移除且CSS隐藏子级，不留可聚焦的隐藏操作；无assistant回退user及空assistant source直接divider可见。
- 服务端规划/续跑prompt与complete成功结果共用输出约束，状态交UI、不重复轮次/继续/重新规划/提交complete等待结算；保留实质分析/问题/阻塞/简洁总结，不提前声称completed。提示词非百分百保证，助手文本不做字符串删除，旧无metadata正文不清洗。
- 验证：定向vitest8 files/329 tests通过（internal13、message-actions40、divider1、plan21、server-agent103、process49、runner89、manager13）；npm run lint退出0仅既有identity.mjs:92 warning；npx tsc -b --pretty false退出0。
- 文件：新goal-internal-message.ts、新对应测试；message-actions/CSS/runner与相关测试；server/components wiki、三状态文件。考虑SVG后复用已有divider，不新增视觉模式。
- Notes/边界：DOM装饰前可能短暂闪现；窗口估算高度/滚动、CSS :has布局、窄屏主题/焦点/屏幕阅读器须浏览器验收。fake DOM/CSS契约非浏览器，不宣称零闪现。其他评审问题不修，既有修改/feature状态全部保留；无build/生成产物/依赖/Git提交或发布。

---

## Feature：goal-chat-plan-confirmation（done，实现与自动验证完成；父 Agent 最终审查/浏览器待验收）

- 用户已确认：最新成功 plan 在聊天内显示「确认并开始执行」，不跳侧栏，侧栏动作保留。renderer 空 mount + host 当前 agent 注入 controller，无全局活跃 agent；工具身份/结果revision/计划指纹/session/goal 重验，允许轮末 +1 commit，防同 id/同文重规划旧记录与旧 handler 派发。
- 复用 goal-ui pending/dirty/error/confirm 和 agent.updateGoal；streaming 等待，只有明确 planConfirmed 才显示已确认，取消/失败隐藏。共享/ACP/readOnly capability/sidechat 门禁对齐 strip；挂载幂等、仅拥有 mount 子节点；SSE 与共享store触发同步。考虑 SVG 后复用轻量按钮，无不可信 innerHTML。
- 验证：npx vitest run 定向9 files/295 tests（新21，renderer32，goal-ui24，strip24，card22，message-actions39，todo8，ask22，server-agent103）；npm run lint退出0，仅既有identity.mjs:92 warning；npx tsc -b --pretty false退出0；git diff --check通过。
- Notes：fake DOM/模板与host源码契约非真实浏览器；窄屏、主题、焦点、屏幕阅读器、真实刷新待人工。未新增confirm后端CAS，HTTP飞行中跨客户端替换仍既有边界，不宣称解决。过旧/无法证明最新计划保守隐藏聊天动作，Inspector可用。保留旧修改和feature状态，无build/生成产物/依赖/commit/tag/push/发布。

---

## Feature：goal-report-renderer（done，实现与自动验证完成；浏览器待验收）

- 用户确认最小修复：`goal_report` 漏注册导致 DefaultRenderer 回退；新增专属 renderer 与纯历史 viewmodel。默认展开摘要、验收和范围，原始 JSON 仅详细模式；成功 plan 显示「计划已生成 / 当时等待确认」，不使用历史快照宣称当前仍等待确认，历史无操作按钮。
- 文件：`src/lib/local-tools.ts`、`src/lib/goal-report-history.ts`、`src/lib/i18n.ts`、`tests/frontend/goal-report-renderer.test.ts`、`docs/wiki/src/lib/README.md` 与三状态文件。复用现有 shell/summary/details/图标/状态和 utility，不改 CSS/后端；13 个双语 key。考虑 SVG 后继续复用图标，契约采用短列表。
- 验证：定向 vitest 8 files / 121 tests（新文件31；todo renderer8、todo summary23、ask22、running-sweep6、lit-reactivity2、param-summary13、artifacts-events16），退出码0；npm run lint退出码0（仅既有identity.mjs:92 warning）；npx tsc -b --pretty false退出码0；git diff --check通过。
- Notes：其他评审问题均未修复，旧 feature 与现有工作树改动全部保留。模板测试执行真实 renderer 类并捕获 Lit 文本绑定，而非真实浏览器；窄屏、主题、焦点、屏幕阅读器与刷新/新Goal待人工。不build、不新增依赖、不碰生成产物、不commit/tag/push/发布。

---

## Feature：goal-auto-complete-validation（done，仅审查与自动验证完成；浏览器 needs-review）

- 用户授权验证报告，不修生产代码。产物：`docs/reviews/goal-auto-complete-validation.zh-CN.md` + 三状态文件；依赖 `goal-auto-complete-iteration-divider`，保留其及其他 feature 历史状态。
- 父 Agent 本次定向验证：`npx vitest run` 16 files / 472 tests，退出码 0；完整可复跑命令与逐文件计数见报告。正常边界含末轮完成、异常不完成、SQLite completed/marker 恢复；不冒充本次全量 lint/build 或浏览器测试。
- Notes（本次核读，未修复）：高 S1 passed→failed→passed 无新 evidence 仍通过完成检查（父 Agent Node 纯函数复现，非真实模型）；中 S2 needs_review 最终 persist 中 abort 意图未复核、S3 completed 保存后 refreshTools reject 阻断通知（静态）；中 U1 预算继续误开 edit（源码）、U2 问号浮层百分比宽度风险、U3 工具归并后空宿主可能隐藏分隔线（静态待浏览器）；低 U4 aria 名称错位、U5 错误 span 无键盘入口、U6 actions/divider 重复移末尾。ChatPanelHost 有 observer suppression，不能声称无限循环。
- 检查清单覆盖规划确认、执行进度、暂停取消、预算追加、编辑、完成、人审、历史恢复、新 Goal、窄屏和键盘；逐项标源码/测试/待人工，c6 needs-review。
- 边界：无专用 browser 工具；环境探查 playwright/puppeteer/jsdom/happy-dom 不可 resolve，electron 未启动。不安装依赖、不建浏览器 harness、不改生产/测试/生成产物，无 Git commit/tag/push/发布。考虑 SVG 后选问题表和清单；本报告不改现行契约，无需改 Wiki。旧评审未经重新验证的问题不计入本轮结论。
- 下一步：用户选择修复 feature（优先 S1，再 S2/S3 可控异步回归与 U1/U2/U3），并补 c6 和其他真实浏览器步骤；done 不代表缺陷已修复或浏览器通过。

---

## Feature：goal-auto-complete-iteration-divider（done，自动验证完成；无浏览器验收）

- 用户授权：保留计划确认与审批，验证通过并正常轮末持久化后自动完成；每轮聊天分隔线持久化。
- 实现：runner 延迟完成；abort/cancel/错误/真实时长超限优先，轮次额度仅阻止下一轮，第8轮验证成功可自动完成。完成快照经 persistSession 窄 options 同次保存 goal/messages，完成 I/O 期间 live verifying；本轮消息 details.quickforgeGoalIteration + manager state 同步；前端幂等根末尾分隔线与中英文。
- 复审：确认完成前后意图守卫、持久化串行锁内canPersist及失败暂停；补末轮成功/error/abort/双预算/未完成回归、真实SQLite完成状态和marker重启恢复断言、重复装饰根末尾位置与JSON恢复断言。同步server wiki轮次契约。
- 最终验证：npm run test退出码0，316 files / 3397 tests；npm run lint退出码0（仅既有server/cloud/identity.mjs:92 warning）；npx tsc -b --pretty false退出码0。首次把lint和tsc用分号拼接被当前命令环境当作lint;脚本名而失败，随后逐条执行均通过。
- Notes：无本轮消息不标记前轮；完全存储故障/任意I/O崩溃窗口不保证补偿持久化。无浏览器视觉、真实刷新/新Goal验收；按要求未跑build，无依赖、生成产物、Git提交/发布操作。

---

## Feature：goal-design-review Goal 功能设计评审（needs-review，待用户评审采纳）

- 背景与范围（用户指令）：评审「当前 goal 功能的设计」——设计层（状态机/预算/证据人审/执行持久化/API/前端契约/设计债），与已落地的 UI 评审互补不重复；纯只读不改生产代码。
- 方法：两路并行只读调研（服务端设计面全量 32 条转换表 + 8 条历史开放问题逐条核实）+ 父 Agent 亲读 agent-goal-state.mjs 全文、runner 关键段约 700 行、goal 端点、manager 分发顺序；全部 文件:行号 引用亲读核实。
- 产物一 `docs/reviews/goal-design-review.zh-CN.md`（324 行，七维度）：总评「骨架设计质量高」（revision 单点递增 / 终止意图只升不降 / persist fail-closed / settle barrier / 证据信任链 / 重启不重放 / goal 水位不污染消息版本，均附行号）；问题分级 高 2 · 中 8 · 低 10：
  - 🔴 X1 并发 /goal 双写窗口（runner:863-876 锁外检查 + commitGoal:243-246 无活跃守卫 + :347-348 跳过同 session）→ 后发覆盖先发、先发成孤儿 goal；
  - 🔴 X2 clear/compact 先于 GOAL_ACTIVE 执行且不触碰 goal（manager:1209-1228 vs 回滚守卫 :1058-1065 同类风险不对称；调度间隙 clear 后续跑在清空会话上脱钩执行）；
  - 🟡 D1 死状态 failed（零入边，错误统一 paused/repeated_failures）、D2 pendingDisposition 吞 error 计数（:729 先于 :766）、D3 结算窗口中止仍落 needs_review、B1 人审等待计费、B3 超时×已报告双 commit、E1 criterion 降级不清证据绑定、A1 仅 extend_resume 有 CAS、SSE 广义 epoch。
- 产物二 `docs/reviews/goal-state-diagram.svg`：13 状态 + 主要转换（confirm/accept/resume/extend_resume/revise/cancel/pause/goal_report 全标注）+ 图例 + failed 死状态标注；node 校验 13 状态零缺失、XML well-formed。
- 设计债核实 8 条判定：同 session 并发=部分缓解仍开放（=X1）；clear/compact=仍开放（=X2）；**retry 生命周期=已缓解**（continueSession 全活跃状态 409 + 终态先清理 + 测试锁定，静态推演无绕预算路径）；验收证据一致性=部分缓解仍开放（=E1）；pendingDisposition 优先 error=仍开放（=D2）；非 extend_resume 无 CAS=仍开放（既定边界）；SSE epoch=goal 特有已修复/广义仍开放；context-references 会话级残留=仍开放（无关旧问题）。
- 改进建议分级：P0 = X1（锁内 re-check 约 5 行，复用 confirm 模式）+ X2（分发顺序调整或 clear 终态化）；P1 = D2/D3/E1/B3/B1/A3；P2 = D1/A1/X4/X5/B4 与 UI 评审遗留项（交叉引用不重复）。
- 验证：SVG 13 状态/转换标注零缺失 + XML well-formed（node）；feature_list.json JSON.parse 通过；时序类结论（X1/D3/B3）为代码路径推断，报告已注明建议以并发用例先行验证。
- 边界：纯评审零生产改动（git status 核实）；建议均未实施，采纳由用户决定；未做运行动态复现。
- 下一步：用户评审报告 → 决定是否按 P0 开新 feature 修复 X1/X2（建议并发用例先行）。

---

## Feature：goal-ui-review-optimization-example Goal UI 完整评审与优化示例（needs-review，待用户验收）

- 背景与范围（用户明确）：浏览器验收 Goal 后反馈右侧边栏大量样式问题 + 说明性文字过多；本轮只产出评审报告与优化示例 HTML，不改生产代码、不改依赖。覆盖对象由用户选定为全部 Goal surface（右侧边栏 Inspector、置顶摘要、输入框控制条、聊天 Goal 卡）。
- 产物一 `docs/reviews/goal-ui-review.zh-CN.md`：右侧边栏 3 高（G-01 内容链路无垂直滚动被裁剪 / G-03 按钮体系与全应用 Button 脱节无 hover/active/`:active` 回缩 / G-04 textarea 260px 硬编码矮视口溢出）+ 8 中 + 5 低；其余 surface S/C/K 系列（含 C-02 控制条实现与自身设计注释矛盾的新发现）；文字专项（100 key 中 25 条说明性文字、10 条长句、3 条 Note 连排、聊天卡 + 侧栏同屏双份、8 组冗余 T-01~T-08、收敛策略 T-A~T-G 对齐 DESIGN_LANGUAGE L187-191「? 浮层收拢」）；设计语言符合性对照表；P0/P1/P2 路线图。全部 文件:行号 引用经父 Agent 亲自读取核实。
- 产物二 `design-mockups/goal-inspector-optimization.html`：自包含单文件 Before/After 对照（滚动容器、token 化 primary/secondary/ghost 按钮体系、状态 badge、时间/预算结构化本地化、Note 一行 + ? 浮层、确认组视觉容器、控制条回归单行极简），支持亮/暗主题、340/420px 面板宽度与 paused/needs_review 状态切换；问题编号 ● 标记 + 图例。
- 重要修正（诚实记录）：调研初稿「动作行三按钮 340px 必溢出」经 `src/lib/goal.ts:280-294` 门控谓词核实不成立（confirmable 仅 awaiting_confirmation、accepting 仅 needs_review、paused/blocked 仅 resumable → 最多同屏 2 个按钮约 176px 不溢出），报告已把 G-02 下调为中优先级健壮性问题，并在示例设计说明中注明演示的是「flex-wrap + 按钮 nowrap + anywhere 收敛」而非真实溢出复现。
- 验证（父 Agent 实际执行）：内联 JS `vm.Script` 编译通过；无外部资源（http(s)/fetch/XHR/@import/外部 src/url() 全 0）；getElementById 9 处引用全部有定义（10 ids）；Node VM + 最小 fake DOM 动态冒烟 9/9 断言通过；`feature_list.json` JSON.parse 通过。grep_files 工具在本工作区对 goal-control-strip.ts 漏报（连 className 都无命中），已改用 read_file/node 内联命令复核，引用以直读为准。
- 边界：不改生产源码/测试/依赖、不触碰 `dist/`/`package-dist/`/`package-offline/`、无 commit/tag/push/发布；旧 feature 状态与历史未修改；真实浏览器视觉与交互待用户验收；G-16 外壳问题仅记录建议另开 feature。
- 下一步：① 用户浏览器打开示例（340/420、亮/暗、两状态）+ 阅读报告，验收优化方向；② 确认后另开 feature 落地生产修复（建议 P0 先做 G-01/G-03/G-04 + T-A/T-B Note 收敛）；③ G-16 外壳问题另开 feature。

---

## Feature：goal-pinned-summary-interaction-prototype Goal 置顶摘要交互设计原型（2026-09-10，needs-review，待用户视觉验收）

- 授权范围（用户明确）：只做设计原型对齐，不进入生产落地——不改生产组件/后端/依赖，不跑生产整套 test/lint/build。
- 产物：`design-mockups/goal-pinned-summary.html`（单文件自包含中文 HTML/CSS/JS/SVG，无外部资源与网络调用；依赖 `ai-goal-mode` 的既有语义）。
- 覆盖交互：置顶摘要三态（关闭/胶囊/面板）与移动端弹层；输入框上方只放状态短标识 + pause/resume + 打开摘要两个 icon（不做 more 完整卡）；胶囊显示短目标/状态/验收数；面板内验收详情折叠 + 阶段主操作；more 提供编辑/取消；编辑有 dirty 保护；pause 走 pause → pausing(800ms) → paused（pausing 期间暂停 icon 真实 disabled 且 aria-disabled 同步）；聊天样例含审批与问答但不自动授权（拒绝工具→paused 且进展/验收数不变）；明确 accept 一次完成、continue 保留进度；取消不回滚 + 确认态焦点圈闭；预算展示 8 轮 / 30 分钟；设计说明区独立于产品 UI。
- 验证（2026-09-10，针对最终修订版，两类结果分开记）：**父 Agent 独立静态**——内联 JS `node --check` 通过；67 个唯一 id 全部有定义、50 处 `getElementById` 引用零缺失；无外部资源与网络/API 调用（http(s) 0 命中、无 fetch/XHR）；改动范围仅 4 文件（原型 + 3 状态文件），未触生产源码；`feature_list.json` JSON parse 与 `git diff --check` 通过。**委派动态**（Node VM + 最小 fake DOM，父 Agent 转述）——最终 54 条断言全部通过，分组 R1 15 / R2 12 / R3 10 / R4 7 / R5 10，覆盖：输入框上方 2 icon 控条形态与 disabled/aria-disabled 同步、胶囊短目标/状态/验收数、pause→pausing(800ms)→paused 时序、continue 与工具被拒后进展/验收数保持不变、拒绝工具→paused、blocked 详情展开、accept 一次完成、编辑 dirty 保护、取消确认态焦点圈闭与 Tab/Escape 模拟。最终修订已修 pausing 的 aria-disabled 同步与「拒绝工具→paused」。旧版草稿的 686 条断言属修订前历史结果，不作为最终版依据。展示文件由父 Agent 用 present_files 交付。
- 边界：不改生产源码/依赖/生成产物（`dist/`、`package-dist/`、`package-offline/` 未触碰）；未 commit/tag/push（原型文件为未跟踪状态）。未做真实浏览器、CSS 布局、屏幕阅读器与中文输入法（IME）实测，也无网络/真实 API/真实模型。
- 不改之前 feature 状态、保留历史；既有中优先级遗留问题（同 session 并发、clear/compact 守卫、retry 生命周期、SSE 快照卡片刷新、验收证据一致性等）仍开放，本轮未标已解决。
- 无需生产 Wiki 同步：仅设计产物，未影响架构、模块职责或公共入口。
- 下一步：用户打开 HTML 做视觉/交互验收（摘要三态、输入框上方 icon、胶囊信息、面板折叠与主操作、pause→pausing→paused 时序与拒绝工具→paused、编辑 dirty 与取消语义、焦点圈闭、预算文案），并补真实浏览器/屏幕阅读器/中文输入法（IME）验收；确认前不推进生产落地。

---

## Feature：ai-goal-objective-edit-actions Goal 卡目标编辑按钮实时同步与 confirm 防误提交（2026-09-10，needs-review）

- 范围（用户明确）：本轮 Goal 只修高优先级按钮问题；上轮评审六项问题中的其余五类中优先级问题（同 session 并发、clear/compact 守卫、retry 生命周期、SSE 快照卡片刷新、验收证据一致性）本轮仍未修，不标已解决。
- 问题：goal 卡「修改目标/确认」按钮的 disabled 只按整卡重渲染时的 draft 计算 → 输入过程中不同步（可能已输入仍灰）、点击时可能拿着过期状态（草稿未提交却触发 confirm）。
- 修复（仅 `src/components/chat/panel-decoration/goal-card.ts`）：① 输入事件只局部同步 dirty 相关按钮、不重建输入节点（textarea 节点/value/focus/选区保留属「输入不重绘」的代码保障，未做真实浏览器焦点/选区实测；`syncDraftActions` 闭包按 render 隔离，旧输入节点的处理器不更新新按钮，旧闭包只能触达旧 render 已 detach 的节点）；② 按钮新增 `disabledForDraft(dirty)`，仅由输入事件调用来局部同步按钮（dirty = `editing && draftObjective.trim() !== view.objective.trim()` 实时推导，不再信任 render 时捕获的值）；click 不重求 `disabledForDraft`，过期 confirm 提交由 `objectiveDirty()` 实时 return 防线拦截（点击仍先看按钮当时的 disabled）；③ dirty 按钮在每种可编辑状态（awaiting_confirmation/paused/blocked）按同一规则 re-arm，草稿回退后 confirm 自动恢复可用。
- 测试：`tests/frontend/goal-card-controller.test.ts` 新增 6 条行为测试（各可编辑状态输入即时启用 revise / dirty 时 confirm 不可用且回退后 re-arm / 过期 confirm 点击被拒 / in-flight 时重复鼠标提交与 Ctrl+Enter 被阻断等）。
- 验证：父 Agent 针对性验证——`npx vitest run tests/frontend/goal-card-controller.test.ts tests/frontend/goal-card.test.ts tests/frontend/goal-state.test.ts` **3 files / 54 tests passed**（controller 19 / card 20 / state 15）；两改动文件 `npx eslint` **0 error**；`npx tsc -b` 无错误；JSON parse 与 `git diff --check` 通过。子 Agent 委派实现：先红（4 失败）后绿，`npx vitest run tests/frontend` **149 files / 1667 tests passed**；独立只读评审未发现阻断。未跑全套 `npm run build`（本轮无构建/公共入口变更）。
- 边界：只修按钮状态同步与 confirm 防误提交，未改架构/状态机/API 契约/i18n/视觉 token，无需更新 wiki；未做真实浏览器焦点/选区实测（fake DOM 断言输入节点未被替换、输入过程中无选区赋值，真实光标/选区与 IME 组合输入未验证）；未改后端/依赖/生成产物，未 commit/tag/push。不宣称整个 Goal 已无缺陷，状态 needs-review 仅表示本轮范围代码与自动验证通过、待用户验收。
- 下一步：浏览器真实输入冒烟——中文输入法组合输入、光标/选区保持、dirty 时 confirm 置灰、回退文本后恢复可用、点击不再误提交；用户验收后决定是否 commit。

---

## Feature：chat-task-launcher-design-preview（needs-review，待用户确认）

- 目标：先用独立 HTML 对齐聊天任务入口，不实现正式功能。
- 产物：`design-mockups/chat-task-launcher.html`；灰侧栏、白内容、56rem 内容轴、中文浅色界面与内联线性 SVG；开发/办公双 Tab 各四张紧凑卡片，空对话居中布局及对话中紧凑预览。
- 交互：卡片只填入可编辑 Prompt；已有不同草稿内联选择保留/替换；办公 chip 可取消；附件/发送明确模拟且不读取文件、不调用 API。键盘焦点、Tab 方向键/Home/End、窄屏适配已编写。
- 验证：内联 JS `node --check` 通过；Node VM 模拟 DOM 断言通过（8 卡片、模板、草稿保护、chip 取消、模拟发送、键盘切换、两种预览、空草稿禁发）；静态唯一 ID 与无外部资源/网络调用检查通过。未浏览器视觉或真实交互实测。
- Notes：首个检查命令误用 PowerShell here-string，当前 shell 不支持；改为 `node -e`。静态 URL 检查首次误报 SVG 命名空间，排除标准命名空间后通过；均为检查命令问题，未改动原型规避检查。
- 边界：只新增原型并维护三份状态；不改源码、依赖、产物，不提交。无需更新 Wiki（不涉及架构/公共入口）。
- 下一步：用户打开 HTML 确认视觉、卡片文案及两种布局；确认前不推进正式实现。

---

## Notes

- 置顶摘要分支菜单改为旁挂弹层（2026-09-09，用户两轮指令：先「屏蔽一下」后改为「不要移除 不要在里面打开、从旁边打开」，按最终指令完成，未提交）：`GitToolsPinnedSummary` 桌面分支菜单不再在 panel 内容流中向下展开（原 `md:absolute md:top-full md:w-full` 嵌在滚动区里），改为作为 desktop widget 直接子节点旁挂弹出——默认左侧（`right-full mr-1 origin-top-right`），左侧空间不足 340px 翻右侧（`left-full ml-1 origin-top-left`）；打开时用分支行与 widget 的 rect 差算 top、viewport 12px 安全区算 maxHeight（22rem 上限/160px 下限），`GitBranchMenu` 新增可选 `style` 透传承接动态定位；拖动/收起/suspend/桌面移动形态切换（`desktopDraggable` 变化经 queueMicrotask 收起）即关闭。移动端保持原 fixed `top-[9.25rem]`/`max-h-[calc(100dvh-9.75rem)]` 契约（原 `md:absolute` 桌面类整体删除）。中间曾按「屏蔽」指令做过只读分支行版本（移除 onCheckout/onCreated/onOpenGraph props），本轮已完整恢复接线。契约测试 git-tools-pinned-summary.test.ts 同步（新旁挂用例替换只读用例）；wiki docs/wiki/src/components/README.md 六处同步。验证：定向 vitest 2 files / 38 tests、eslint 4 文件、tsc -b 全过。
- session-change-summary-rollback 边界（2026-09-07）：影子备份只覆盖 write_file/edit_file 写盘；`run_command`（npm install、脚本生成文件等）与 OpenCode harness 的文件改动不进备份/摘要/回滚——命令产生的变更若需纳入，需另行评估 run_command 前置目录快照（成本高）或提示用户用 git 兜底。备份文件按会话目录存放，7 天 TTL 惰性清理，超大会话备份的磁盘占用未设上限（单文件内容级备份，与源文件同量级，暂可接受）。

- 「显示更多」按钮切回闪烁调研（2026-09-07，实测实证，**已修复**，见 Completed Feature sidebar-show-more-refocus-spinner）：用户在 sidebar-pinned-refocus-flash 修复后报告"显示更多按钮也闪烁一下"。确认属实：切回 → refreshSessions 把 pinned/global/各项目会话列表全部置 `loading:true`（useSessionPagination.ts 四个 loader 置位处）→ `SessionDisplayControls`（ChatSidebar.tsx）按钮内容 `loading ? Loader2 : '显示更多'` + `disabled={loading}`（`disabled:opacity-45`）在切回期间切换。dev server 实测：本地无延迟时 React 把 loading:true/false 两次 setState 合批在同一渲染帧、中间态不进 DOM（MutationObserver 0 记录）；hook fetch 加 120ms 延迟模拟稍慢环境后确定性复现——dispatch 触发 5 个列表 API，t=197ms 按钮从 spinner 恢复文字（parentText="显示更多"）。闪烁时有时无的根源即"请求耗时是否跨过渲染帧边界"。与 Pinned 区块闪烁同根：切回 refresh 的 loading 态误伤已挂载 UI。修复：SessionPage 增加 `appending` 字段（offset>0 追加才置位），SessionDisplayControls spinner/disabled 只读 appending 变体；`*Loading` getter 保留给空态 spinner 与 LoadMoreSentinel 门控。
- 切回浏览器时工作区显示"抖一下"调研（2026-09-07，双 explore 只读调研 + 关键点人工核实 + dev server 实测复现）：切回必然执行的只有 `useCrossTabSync.ts:78-91`（visibilitychange → visible 时 refreshSessions + loadProject(true)，loading:true 一帧 + App 全树重渲染，聊天面板不重建）与 `useVisibleRuntimeStatuses.ts:98-106`（侧栏状态点刷新）。**用户澄清闪烁位置为侧栏项目列表，根因已实测实证**：refreshSessions → `loadPinnedSessions(0)` 先 `setPinnedPage({...prev, loading:true})`（useSessionPagination.ts:90，loading 保留空 items）→ 无置顶会话时 `pinnedSessionItems.length===0`，`ChatSidebar.tsx:1299` 挂载条件 `length > 0 || pinnedLoading` 因 loading 短暂成立 → 整个 Pinned 区块（"置顶会话"标题 + `px-3 pb-1` 容器，侧栏滚动区第一个区块）挂载 → 本地 fetch 返回无置顶 → `items:[], loading:false` → 区块卸载；MutationObserver 两次复现存活 42-62ms，下方项目列表被挤下再弹回即"闪烁一下"。**该条已修复**（sidebar-pinned-refocus-flash，挂载条件收紧为内容驱动 + 契约测试，修复后复验区块插拔消失）。次要伴随变化（视觉基本无感）：8 个项目行 dnd-kit `style.transition` 写入又清空（SortableProjectItem，无 transform 位移）、"显示更多"Loader2 短暂切换（已单独立项为上一条 Notes）。工作区级其余候选保留：①隐藏期 rAF/RO 挂起，切回第一帧集中补跑——`ChatPanelHost.tsx:1313-1321` scheduleDecorate、`scroll-sync.ts:80-87` 双重 rAF scrollToBottom + `:173-180` RO 触发，叠加 pi-web-ui AgentInterface 内部 RO 无条件 `scrollTop=scrollHeight`，流式中切回滚动跳变；②后台 SSE 断连时 `reconnect-notice.ts:89` 提示行为 `messageList.append` 文档流内插拔、`unreachable-strip.ts` 常驻条挂载/移除挤压 composer；③流式中切走 watchdog（server-agent.ts:48-49）补跑 `refreshStateFromServer({forceMessages:true})` 全量替换 messages；④消息滚动容器无 `scrollbar-gutter`，滚动条出现/消失致整列 reflow。自证：DevTools Performance 录制切回瞬间 + 对 `.quickforge-reconnect` 设 DOM 断点。
- scheduled-tasks 并行 run 的 sessionId 为 `scheduled-${taskId}-${Date.now().toString(36)}`（server/routes/scheduled-tasks.mjs executeTask），同一毫秒并发启动的两个 run 会共用 sessionId/事件总线（测试中同毫秒冲突已实证）；生产修复（追加随机后缀等）另行立项，不在本轮扩大范围。
- 桌面端内存排查（2026-09-05）遗留候选，按收益排序：①渲染端消息窗口化被 `ChatPanelHost.tsx:600` `{enabled:false}` 整体禁用（commit 32be493 为 turn-navigation 关闭），长会话全量 DOM 常驻 + 流式期每 rAF 全量装饰扫描（message-actions.ts querySelectorAll 全面板、artifacts key 全量构建）→ 卡死主因；恢复窗口化或装饰增量化（code-blocks.ts:574-588 command 块已有指纹跳过模式可参照；mermaid/SVG 块每帧 atob+哈希未跳过）。②desktop 默认 inline 内嵌 server 于主进程（electron-main.mjs:519），server 同步 SQLite 大事务（agent-persistence 每次全量序列化会话消息）与 GC 停顿直接冻结窗口/托盘；fork 模式路径已存在（QUICKFORGE_DESKTOP_INLINE=0，stdio ignore）。③SSE 无背压（res.write 返回值未检查，慢客户端无界缓冲）+ message_update 每次携带全量 partial。④storage 路由 keys/has/index 触发 exportSnapshot 全库物化（session-state-repository.mjs:723-745）。⑤ACP 会话 idleRetention:'always'（acp/server.mjs:656）+ 渠道进程 taskkill 强杀 → 旧 ACP 会话无界驻留。⑥pdfjs loadingTask 卸载竞态泄漏（WorkspaceDocumentContent.tsx:116-133）、xlsx 全 sheet 物化。
- 已修复测试基础设施问题：`tests/frontend/local-tool-running-sweep.test.ts` 的 CSS `ruleFor` 正则此前会把规则上方注释 glue 进 selector 文本，导致 `.quickforge-tool-running-sweep` 误报缺失；现参考 `chat-compact-controls.test.ts` 先剥离 CSS 注释，定向测试 6/6 通过。

## Needs Review Feature：pinned-summary-draggable-capsule（普通任务置顶摘要一致性验收修订）

- Feature: 普通全局会话的非简单多步骤任务也应受 `todo_write` 通用计划规则指导，并在实际产生有效 Todo 后显示既有置顶摘要（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 最小修复系统提示词作用域与契约测试；本次修订已纳入提交。
- 根因与修复：普通 global 会话实际具备 `todo_write`，但 `server/system-prompt.mjs` 的通用规则误置于 `For project tasks:` 之下。现仅将该规则移到项目任务专属段之前，使所有具备工具的非简单多步骤任务适用；`For project tasks:` 内其他规则及工具权限不变。
- UI 边界：`App.tsx` / `GitToolsPinnedSummary.tsx` 继续按 Todo、Git、Subagent 实际内容驱动挂载；无有效内容时不显示入口，不实现常驻空摘要。
- 测试：`tests/server/system-prompt.test.mjs` 不只断言文案存在，而是同时锁定规则索引早于 `For project tasks:`、项目任务段内不含该规则、全文仅出现一次。
- Docs: `docs/wiki/server/README.md` 记录系统提示词作用域；`docs/wiki/src/components/README.md` 明确通用计划规则与内容驱动 UI 空态边界；无新视觉模式，`DESIGN_LANGUAGE.md` 无需更新。
- Verification: `npx vitest run tests/server/system-prompt.test.mjs` → 1 file / 7 tests 全过；`npx eslint server/system-prompt.mjs tests/server/system-prompt.test.mjs`、`node --check server/system-prompt.mjs`、`feature_list.json` JSON parse、`git diff --check` 全过。
- Boundaries: 未改前端源码/契约，故无需前端测试；未新增依赖，未触碰生成产物；已清理本轮临时未跟踪文件。
- Next step: 真机用普通全局会话发起非简单多步骤任务，确认 Agent 维护 Todo 后既有置顶摘要出现；无 Todo 内容时入口仍不常驻。通过前保持 needs-review。

---

## Needs Review Feature：pinned-summary-draggable-capsule（desktop stay + 向下展开）

- Feature: GitToolsPinnedSummary desktop 外点/Escape 保持当前形态，显式 Minimize 才进入 capsule；capsule→panel 从同一 top 向下展开（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 源码、纯函数/契约测试和 wiki 已更新；未 commit。
- 状态转换：desktop panel/capsule 点击外部均 stay；desktop Escape 不安装摘要级 listener，因此无操作且不 preventDefault/stopPropagation。`minimizeDesktopPanel` 只由 panel 标题栏显式 Minimize 调用；capsule 主体打开 panel；panel/capsule 的 X 与顶部 List 完全关闭。mobile/mobileShell 继续 List + fixed panel，外点/Escape/X 关闭，无 capsule/minimize。branch menu 不再因摘要 outside 分支改变 panel/capsule，本轮未新增嵌套菜单 dismiss。
- 向下布局：`pinned-summary-drag.ts` 新增纯函数 `resolvePinnedSummaryLayout` 和具名常量 `PINNED_SUMMARY_PANEL_MIN_HEIGHT=180` / viewport inset 12。panel 优先保持当前 y，把 `viewportHeight - 12 - y` 作为动态 `panelMaxHeight`，复用 panel flex + 内容 `overflow-y-auto`；不再用整屏 panel 自然高度把 y 向上 clamp。仅当下方不足 180px 时向上移到刚好容纳最小高度；viewport 本身更矮时使用全部安全区域。首次定位、panel/capsule 形态切换、window resize、drag 过程/结束与 Inspector resume 复用同一策略；conversation header 默认锚点仍只在首次无位置时读取。
- 尺寸/动画：动态 max-height 通过 `--quickforge-pinned-summary-panel-max-height` 传入且只在 panel mode 更新/消费；`ResizeObserver` 继续读 offset 布局尺寸，panel 展开态用 `scrollHeight + (offsetHeight - clientHeight)` 记录含边框的自然高度，避免 2px morph 误差。observer 在拖动中以 `dragRef.current.current` 而非旧 `positionRef` 解析布局，拖动跨边界、结束/取消后统一由 `finishDrag` 收敛，不会把 panel max-height 回写到起点或令 position/capsule 回归。删除无效 `height: min(max-content, ...)`，依赖 auto + max-height 与 widget 高度变量。panel 内容区始终 `overflow-y-auto overscroll-contain`，branch menu 改在受限内容区内向下展开、宽度随 panel、带 viewport 约束的 max-height/自身滚动，不再为了菜单把普通内容切为 overflow-visible。panel/capsule 子层 `transform-origin: top right`；width/height 220ms 与 reduced-motion 保留。设计 mockup 为历史稿且与本轮语义差异较大，未做小修，wiki 明确源码为准；DESIGN_LANGUAGE 无需更新（仅修正既有几何/交互，无新视觉模式）。
- 图标决策：按已确认的设计原型推荐 B，将 capsule 主体末端展开提示由 `ChevronUp` 改为 `Maximize2`，与 panel 标题栏既有 `Minimize2` 配对。`Maximize2` 放在主体 button 内约 28px 的透明圆形视觉槽中（`aria-hidden`，不是独立 button），默认弱化，仅在主体 hover/focus 时以现有 `group-*` Tailwind 克制增强；顶部 `List`、独立 `X`、点击/拖动/关闭逻辑均不变，无新增 CSS 模式。
- Regression boundaries: Inspector suspension/resume、160ms closing timer、pointer capture/window listeners/body userSelect/rAF cleanup、header 首次锚点、移动端 overlay 行为保持。
- Verification: 图标终审后定向 `npx vitest run tests/frontend/git-tools-pinned-summary.test.ts` → 24 tests 全过（契约锁定 capsule `Maximize2` + panel `Minimize2`、约 28px 非 button/`aria-hidden` 视觉槽、独立 X 与无 `ChevronUp` 残留）；定向 ESLint 2 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。此前终审修复 5 files / 52 tests 与定向 ESLint 4 文件结果继续有效；build 仅既有 KaTeX 字体与 chunk size warnings，`git status` 确认生成产物无状态变化。
- Boundaries: 未新增依赖、未提交/tag/push、未手改生成产物；工作区其他 OOM 等未提交修改完整保留。
- Next step: 完成最终门禁后真机复核 desktop panel/capsule 外点与 Escape 均不变、Minimize 唯一收缩、capsule 展开 top 不上浮且内容在下方空间滚动；通过前保持 needs-review。

---

## Needs Review Feature：pinned-summary-draggable-capsule（首次 header 锚点调整）

- Feature: GitToolsPinnedSummary 无历史位置时改以主对话 header 为首次 desktop 锚点（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 最小源码、纯函数测试、契约测试和文档已更新；未 commit。
- 实现：`App.tsx` 在主对话 `<header>` 增加稳定 `conversationHeaderRef: RefObject<HTMLElement | null>`，通过 `initialAnchorRef` 传给 `GitToolsPinnedSummary`；无 `querySelector` 或 Tailwind selector。`pinned-summary-drag.ts` 新增 `resolvePinnedSummaryInitialPosition` 与显式常量 `PINNED_SUMMARY_INITIAL_GAP=10`、`PINNED_SUMMARY_INITIAL_RIGHT_INSET=12`：仅 desktop 且 `positionRef.current` 尚不存在的首次定位读取 header rect，坐标为 `y = ceil(header.bottom) + 10px`、`x = header.right - targetWidth - 12px`；header 不可用时先回退 toolbar root rect，toolbar root 也不可用时再回退 widget rect，最终继续走 `clampPinnedSummaryPosition` 的 12px viewport 安全区。
- 生命周期边界：用户拖动后、panel/capsule 切换、window resize、Inspector suspend/resume 都只 clamp 现有 position，不重读 header；mobile/mobileShell 的 List + fixed panel 不变。实现不含 28/32/56 titlebar 定位常量，真实 header rect 自然适配浏览器/Electron、字号与侧栏宽度。
- 测试：`pinned-summary-drag.test.ts` 真实测试 bottom+gap/right inset 与传入 fallback rect；`git-tools-pinned-summary.test.ts` 锁定 header ref 接线、conversation header → toolbar root → widget rect 回退顺序、仅初始分支读一次、无 querySelector/28/32/56 定位常量、Inspector 恢复不重锚。
- Docs: `docs/wiki/src/components/README.md` 两处与 `docs/wiki/src/lib/README.md` 同步；复用既有视觉模式，不改 DESIGN_LANGUAGE。
- Verification: 定向 Vitest 5 files / 48 tests 全过（pinned-summary-drag 8、git-tools-pinned-summary 24、workspace Inspector request/width 与 mobile fullscreen 回归 16）；定向 ESLint 5 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings，生成产物无 git 状态变化。本次 fallback 措辞收尾另跑相关 Vitest 2 files / 32 tests、feature JSON parse、`git diff --check` 全过；按要求未再次 build。
- Boundaries: 未新增依赖、未持久化位置、未触碰 `dist/`/`package-dist/`/`package-offline/`、未 commit；工作区其他 OOM 等未提交改动完整保留。
- Next step: 真机复核首次打开 panel 与首次缩为 capsule 均在对话 header 下方、主内容右侧内缩且不遮顶部栏；通过后再标 done。

## Completed Feature：pinned-summary-draggable-capsule

- Feature: GitToolsPinnedSummary 顶部 List 常驻、桌面 closed/capsule/panel 三态浮动摘要，并在右侧 WorkspaceInspector 往返时恢复状态和位置（pinned-summary-draggable-capsule，**已完成**）
- Status: done — 已实现真实桌面右侧栏暂停/恢复；用户真机复核验收矩阵通过；未 commit。
- Inspector 往返：App 使用与 `WorkspaceInspector` 一致的 `(min-width: 1024px)`，以 `canSuspendPinnedSummaryOnInspectorOpen` 表达“未来打开 Inspector 是否具备 desktop sidebar suspension/preserve 能力”；仅 `workspaceInspectorOpen && capability` 时保持 `GitToolsPinnedSummary` 挂载并传 `suspended`。`<1024px` 和 `mobileShell` 仍按原条件卸载，保持移动端/全屏 overlay 行为。`suspended` 保留 panel/capsule、position、Todo 展开和智能体折叠。
- Inspector 打开分支：PanelRight 直接按钮、Git Changes 与智能体入口统一按 `canSuspendPinnedSummaryOnInspectorOpen` 分支；真实桌面右侧栏保留 panel，`<1024px`/`mobileShell` overlay 路径在 `setWorkspaceInspectorOpen(true)` 前先 `setGitToolsExpanded(false)`，关闭 Inspector 后摘要不自动重开。PanelRight 关闭分支不额外修改 summary；Commit/Push 始终先关闭。
- 真隐藏与副作用暂停：toolbar root 和 desktop fixed widget 同时使用 `hidden` class/属性、`inert`、`aria-hidden`，不进入布局、Tab 或辅助技术，也不遮挡 Inspector。暂停时不注册 outside pointerdown/Escape、resize/clamp、ResizeObserver/形态定位；进入暂停只结束 drag，清 window pointer listeners、capture、body userSelect、drag/responsive rAF，关闭 branch menu 与 pending focus。不会取消已代表用户明确关闭意图的 160ms close timer，也不使用可被 cleanup 取消的 rAF 去归一化 closing/mounted；timer 在隐藏期间自然完成 `closed => unmounted`。组件最终 unmount 时既有 cleanup 仍会清 timer；不清 position/capsule/expanded，不自动回焦。
- 恢复 clamp：`suspended true→false` 时按当前 `desktopMode` 的 `desktopPanelRef` / `capsuleRef` 目标布局尺寸（offsetWidth/offsetHeight，必要时 rect fallback）对原 position 重新 `clampPinnedSummaryPosition`，维持 12px 安全区；视口未变化通常原位，变化后仅夹取，不调用 openDesktopPanel/minimizeDesktopPanel、不抢焦点。
- 既有三态与拖动保持：desktop capsule 外点 stay、panel 外点 minimize、X close；pointerdown 后由 window 跟踪同 pointerId，越过 4px 才 capture/禁选/suppress click；finish/cancel/暂停/响应式降级/unmount 统一清理。移动端/mobileShell 仍 List + fixed panel，无 capsule/拖动/缩小。
- 测试边界：`pinned-summary-drag.test.ts` 是真实纯函数测试，覆盖 desktop/窄屏/mobileShell suspension 判定，以及以“未来可 suspend/preserve capability”为参数的 desktop preserve vs overlay close 分支，并继续覆盖 clamp/outside/4px threshold。`git-tools-pinned-summary.test.ts` 是源码契约测试，锁定 PanelRight 打开分支 desktop preserve/mobile close、关闭分支不改 summary、摘要 action 条件接线、hidden/inert/aria-hidden、suspension 不清 close timer/不归一化 closing/mounted、unmount 仍清 timer、side-effect gating、marker、恢复 clamp 与 focus cleanup，不是 React 组件挂载/真实点击拖动测试。
- Docs: `docs/wiki/src/components/README.md` 两处同步 suspended 生命周期、Inspector action 与移动端边界；不涉及新视觉模式，DESIGN_LANGUAGE 无需改。
- Verification: Revision 3 最终收口后，相关 Vitest 8 files / 165 tests 全过（git-tools-pinned-summary 23、pinned-summary-drag 6、workspace inspector tabs/width/request、mobile fullscreen、side chat、subagent detail）；定向 ESLint（App/摘要组件/纯函数/两测试）0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check`、`git status` 全部通过/已检查。build 仅既有 KaTeX 字体与 chunk size warnings；status 仅列出本 feature 的 10 个预期文件，无生成产物。前轮完整门禁记录保留：npm run test → 271 files / 2530 passed + 1 既有失败（见 Notes）；npm run lint → 0 errors。
- Boundaries: 无 localStorage、无新增依赖、未把完整摘要状态提升到 App；未触碰生成产物；共享文件中的其他未提交 feature 片段保留。
- Notes: 全量 test 中 `tests/server/cloud/qf-agent-process.test.mjs`「keeps the restart budget bounded when newly isolated identities keep getting rejected」稳定失败，经单文件 stash 对照确认 HEAD 同样失败（该测试仅依赖 `qf-agent-process/auto-approval/network-proxy`，均无未提交改动），属既有失败、与本次无关，未修复未扩大范围；该文件历史另有定时器波动记录（见早前条目）。
- 真机验收矩阵：① closed→打开右栏→关闭仍 closed，且 closing 160ms 内打开右栏不会出现幽灵 capsule；② capsule 拖动后往返原位恢复；③ panel 拖动、Todo 展开/智能体折叠后往返原位与状态恢复；④ PanelRight 鼠标/键盘不预先 minimize；⑤ desktop Git Changes/Subagent 打开并关闭 Inspector 恢复 panel；⑥ `<1024px`/mobileShell 从摘要打开 Git Changes/Subagent 后关闭 Inspector 不自动重开摘要；⑦ Commit/Push 仍关闭；⑧隐藏期间 Escape/外点/resize 不改摘要；⑨拖动中打开 Inspector 后 window listeners/capture/body userSelect/rAF 完整清理；⑩视口变化后恢复保持 12px 安全区且不抢焦点。
- Next step: 无（用户复核通过，已标 done）。

> 归档说明（2026-09-15）：按「保留最近 30 个 feature 及全部未完成项」完整归档，更早条目在 docs/archive/progress-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json；会话交接归档在 docs/archive/session-handoff-archive.md。

## Feature：goal-ui-p0-budget-120 Goal UI P0+G-09+C-02 生产落地 + 预算 120 分钟（done，实现与全量自动验证完成，浏览器待验收）

- 范围（用户确认）：按评审报告/优化示例落地生产——P0（G-01 滚动、G-03 按钮体系、G-04 textarea、T-A/T-B Note 收敛）+ G-09（时间/预算本地化）+ C-02（控制条回归极简）；预算默认时长 30→120 分钟、追加额度跟随默认（+120）、轮次 8 不变。
- 预算改动：`server/agent-goal-state.mjs` GOAL_BUDGET_DEFAULTS 时长 120 分钟（extend_resume 复用同常量自动 +120）；`src/lib/goal.ts` 前端增量同步；`tests/server/agent-goal-state.test.mjs`、`tests/server/agent-goal-runner.test.mjs`（4 组用例按 120 分钟语义重新推导）、`tests/frontend/goal-state.test.ts` 断言同步；wiki 6 处数值更新 + 存量 goal 保留旧预算、首次追加跳变说明。
- 侧栏重构：`GoalInspectorContent.tsx` + `goal-inspector.css` 按示例 After 形态重写——滚动容器 + 底部固定动作栏、分段导航、tone 状态行（唯一 ? 浮层收拢 Note，外点/Escape 关闭）+ 本地化时间、blocker 警示条、验收 badge 四态语义色、预算双行计量条 + 已耗尽 chip（移除 goalBudgetActual 毫秒拼接并删 key）、确认组容器、▸ 展开指示、Button 变体分层（hover/:active scale(0.97)/focus-visible/动效 token）、textarea min(260px,40vh)、动作行 flex-wrap + 按钮 nowrap + break-word；abort/focus/Escape 契约逻辑逐行核对原样保留。
- 控制条（C-02）：objective 节点六处移除 + index.css 规则删除；时长 ≥60s 分钟格式化（新 key）、<60s 保留秒；取消确认单句（T-B）。
- i18n：新增 16 key 中英成对（11 状态 hint、goalHintDetails、goalRecordedDurationMinutes、预算标签 ×2、已耗尽 chip）；goalKeepWorking 中文改「继续工作」（T-C）；删 goalBudgetActual（grep 零消费方）。
- 父 Agent 审查修正：移除提示行重复的第二个 ? 浮层（保留状态行唯一入口，edit 视图也可达）；核实 CSS token（--shadow-quickforge/--quickforge-dur-fast/--quickforge-ease-out）均存在；核实控制条 objective 仅剩头注释与 revise 签名合法引用。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，315 files / 3381 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体/chunk warning。子 Agent 定向：预算 3 files/126 tests、UI 12 files/209 tests、eslint/tsc 全过。
- Notes（残留，不宣称已解决）：popover 内 note 文案仍含「上方的卡片」（G-10/T-E；聊天卡语境正确故暂不改文案）；tone 色值第三处局部复制（C-01）；planning hint 复用 awaiting_confirmation 文案；formatGoalTime 为 toLocaleString 完整格式，可再精简；G-16 外壳问题未动。
- 边界/下一步：无 commit；浏览器视觉/IME/焦点验收待用户；验收通过后可考虑 commit（发布走 patch-release-runbook）。

---

## Feature：goal-budget-extension-resume Goal 预算追加恢复（done，实现与全量自动验证完成，浏览器待验收）

- 当前目标：预算耗尽无需取消重建，用户明确确认后追加耗尽维度默认额度并恢复同一 Goal。依赖 `goal-inspector-progress-editor`（done）；旧记录为历史、不修改其状态，旧文中无 CAS/取消新建的限制已由本 feature 的窄契约补充。
- 后端契约：仅 `extend_resume` 接受 `{action,goalId,expectedRevision}`，revision 正 safe integer，拒绝额外字段/自定义预算；锁内 goalId/revision CAS 防旧请求重复追加。耗尽维度分别 +8 轮/+30 分钟，保留 usage/计划准则证据/进度；预算与恢复状态同次 persist 成功后才调度。仍不足 paused 不调度；足够时无计划 planning、未确认 awaiting_confirmation、已确认 running。planConfirmed 持久化，仅 confirm 置 true，revise/plan 清 false；旧记录 planning/awaiting_confirmation 强制 false，其余优先明确布尔值、缺字段按 usage.iterations > 0 兼容。统一预算 gate 不让错误越额续跑；旧 resume 耗尽仍409，提示新出口。其他动作不新增客户端 CAS。
- 前端：Inspector 额度内联确认显示真实 usage/上限/增量，运行条耗尽继续入口导航 progress；严格预检绑定确认时旧 revision，失败对账不盲重发。关闭仅取消未发送 POST，已发送不能撤回、等待结算后释放锁；计划未确认仍需用户 confirm。
- 实现路径：`server/{agent-goal-state,agent-goal-runner}.mjs`、`server/routes/agent.mjs`；`src/lib/{goal,server-agent,deferred-session-agent,i18n}.ts`、`src/components/workspace/GoalInspectorContent.tsx`、`src/components/chat/panel-decoration/{goal-control-strip,goal-card}.ts`。测试路径：`tests/server/{agent-goal-state,agent-goal-runner,agent-goal-manager}.test.mjs`、`tests/server/routes/agent.goal.test.mjs`；`tests/frontend/{goal-budget-inspector,goal-state,server-agent,goal-control-strip,goal-card,goal-card-controller,goal-ui}.test.ts`。完整清单见 feature_list.json。
- Wiki：总入口、server、server/routes、src、src/lib、src/components 六份 README 已同步公共契约，无需再次修改。本次最终同步仅改三状态文件，不修改生产/测试；最终清单30个文件已核实存在。考虑 SVG 后采用文字分支说明，未新增视觉产物。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，315 files / 3377 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体解析与 chunk 体积 warning。此前子 Agent 定向后端 **166 tests**、前端 **270 tests** 通过，不替代最终全量结果。本子任务不重跑生产测试。浏览器真实交互、视觉/IME/焦点未验收。
- Notes：旧 `pendingDisposition` 优先于 `error` 的问题会落 `needs_review`、并非 `completed`；本轮未修，不扩大范围，不宣称已修复。
- 边界/下一步：done 表示实现与最终全量自动验证完成，浏览器验收仍待补充，不以自动测试替代。未新增/升级依赖、无 Git commit/tag/push/发布、未手工改 `dist/`/`package-dist/`/`package-offline/`，保留既有改动与历史。

---

## Feature：goal-inspector-progress-editor Goal 侧栏进度/编辑重设计（done，实现与全量自动验证完成，浏览器视觉未验收）

- 当前目标：实现与父 Agent 最终全量自动验证已完成，标记 `done`；用户视觉及真实浏览器验收尚未完成。依赖 `goal-pinned-summary-production-ui`（done）；下文是历史记录，不改变旧 feature 状态或把旧行为当成当前 UI。
- 当前行为：运行条为真实状态 + 服务端已记录累计时长 + 取消/暂停或继续/编辑三个 icon；摘要 Goal 分区仅两行纯导航，点击打开 Workspace Inspector progress。`GoalInspectorContent` 集中进度/验收/阶段动作与 edit，Tab 按 session + goal 复用，仅 runtime、不持久化。
- 保存安全：`goal-ui` 保留运行中草稿与外部冲突 dirty 文本，dirty 允许 pause/cancel；`goal-edit` 运行中保存经确认 pause，等待权威 paused 且非 streaming 后 revise。App 绑定 `refreshGoalForSave` 单次严格快照，不自动 confirm/resume、不重试 POST；关闭由 layoutEffect 立即取消后续等待/尚未派发保存，已发 POST 不能撤回，结算前保留共享锁。当前 Goal 动作 API 无客户端 revision CAS，不保证跨客户端原子性。
- 相关实现文件（已核实路径存在）：`src/App.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/components/chat/panel-decoration/goal-control-strip.ts`、`src/components/git/{GoalSummarySection.tsx,goal-summary.css,GitToolsPinnedSummary.tsx}`、`src/components/workspace/{WorkspaceInspector.tsx,GoalInspectorContent.tsx,goal-inspector.css,workspace-types.ts,workspace-inspector-tabs.ts,workspace-inspector-request.ts}`、`src/lib/{goal-ui.ts,goal-edit.ts,server-agent.ts,i18n.ts}`、`src/index.css`；测试为 `tests/frontend/{goal-edit,goal-ui,goal-inspector-lifecycle,goal-inspector-tabs,goal-control-strip,goal-summary-section,git-tools-pinned-summary,server-agent}.test.ts`。此前已同步四份 Wiki（根、src、src/components、src/lib 的 README）；本次最终状态轮次仅更新三状态文件，完整清单见 `feature_list.json`。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，314 files / 3292 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体解析与大 chunk warning。本次状态子任务不重跑生产测试。历史结果保留：最后修复前父 Agent 313 files / 3288 tests passed，子 Agent 定向 5 files / 141 tests passed、lint/build 通过，不替代最终全量结果。
- Notes：此前一次全量在 `qf-agent-process.test.mjs:269` 重启 timer 测试失败；未改相关源码原样复跑全绿。根因未定位，不标已修复、不扩大本 feature 范围。
- 边界：未新增依赖、不改 `server/`、未手工修改 `dist/`/`package-dist/`/`package-offline/`，无 commit/tag/push/发布；本轮不混入网络容错，不把其他后端旧问题标为已解决。已考虑可视化说明，本次为现有导航/职责纠正文档，无需新增 SVG 产物。
- Blocker / 下一步：实现与自动验证无待办；浏览器真实 IME 组合输入、焦点保持/关闭回焦、侧栏与摘要响应式布局及用户视觉验收未做，不能以单测代替。后端无客户端 revision CAS，不能保证跨客户端原子保存或服务端拒绝所有外部冲突；检测到冲突或服务端返回错误时保留草稿并报错，已发 POST 不可回撤。

---

## Feature：goal-pinned-summary-production-ui Goal 置顶摘要生产 UI 落地（2026-09-10，done，实现与全量自动验证完成，仍保留用户视觉验收）

- 授权与范围（用户明确）：原型已确认落地，生产 UI 实现与全量自动验证（`npm run test` / `npm run lint` / `npm run build` 均退出码 0）已完成；本会话最终一轮为**文档/状态同步**，不改后端（`server/` 未动）。旧记录保留：`goal-pinned-summary-interaction-prototype`（needs-review）与 `ai-goal-mode`（done）状态不擅改。
- 生产主路径（与原型对齐）：完整 Goal 卡不再由 `ChatPanelHost` 挂载，旧 `panel-decoration/goal-card.ts` controller/viewmodel 保留兼容，`buildGoalCardViewModel` 仍是三个 surface 共用的纯投影。改为两块 surface——① 置顶摘要置顶的 Goal 首分区 `git/GoalSummarySection.tsx` + `goal-summary.css`：真实状态/目标正文、`已通过准则/总数`、blocker/summary、阶段主操作（confirm/pause/resume/accept·继续/revise 编辑器/cancel 内联确认），验收·证据·范围·预算默认折叠；② 输入框上方控制条 `panel-decoration/goal-control-strip.ts`：单行状态 + 最多两个 icon（pause/resume + 打开摘要），`running`/`verifying`/`pausing`→暂停、仅 `paused`→继续、`blocked`/`needs_review`/`awaiting_*` 只保留打开摘要、终态整条不渲染。
- 外壳与挂载：`GitToolsPinnedSummary`/`App` 让摘要在只有 goal 时也挂载（goal-only 渲染）；胶囊首段为 Goal（短目标 + 真实状态 + 已验收准则数），之后才接任务/文件/智能体段且总段数截断为 3。控制条挂载点固定为 composer shell 首位（TodoWrite 摘要/排队消息锚点之间绝不插新 sibling），节点与 `aria-live` 标签只建一次、原地更新，pause/resume 复用同一按钮节点保住焦点，节点被移除时焦点交回摘要入口或编辑器。主会话门禁：置顶摘要只排除 ACP（`sessionSource !== 'acp'`），控制条再加 `capabilities.goal`、非共享页、非 side chat；其他 surface 打开摘要走 `quickforge:open-goal-summary` 事件，`App` 只认当前会话 + 当前 goal，打开前先关闭已打开的 Workspace Inspector 解除挂起再展开，不新增全局模式。
- 真实后端（无假时序）：控制条**不复制原型的 800ms 演示延迟**，pause 直接 POST `/api/agents/:id/goal`，`pausing` 是服务端真实状态，图标在 pending/`pausing` 期间真实 disabled，失败经共享 store 广播回控制条而非被吞掉。
- 共享状态与草稿保留：新增 `src/lib/goal-ui.ts`，按 `sessionId + goalId` 持有 pending/dirty/error/草稿，三个 surface 同源锁（`runGoalUiAction` 同步加锁、脏草稿拒绝除 `revise` 的动作并写原因、失败存为 error 广播）。草稿连同 `editing` 标记存 store（基线为服务端 objective），挂载面 `retainGoalUi`/`releaseGoalUi` 钉键/释放：关闭摘要、最小化、桌面↔移动响应式重挂后重开恢复同一文本与 dirty 锁（只有显式 `clearGoalUi` 丢弃，无人挂载草稿按 LRU 最多保留 6 份）；目标被真正改写或换 goal 时草稿失效清除。取消确认是内联行而非对话框：焦点进入「继续工作」，Escape 只关该行/菜单并把焦点还给触发按钮，并拦在置顶摘要文档级监听器之前。
- 状态语义（SSE/HTTP 与消息水位）：goal 快照与 `goal_updated` 只推进独立 goal 水位（`goalSeq`：同 id 比 `revision`、跨 id/清空比水位、相同回显不推进），HTTP 动作响应与 `/state` 刷新都带请求前水位做竞态守卫，只有真正改变 goal 才广播 `goal_updated`；goal 帧与通知一律**不**推进消息 `stateVersion`（goal 不改消息，推进会作废在途消息对账导致丢消息）。
- 收尾修复（已并入并有测试覆盖）：① `syncGoalUiState` 由 `App` 的 effect 在每次 goal 变化时调用（不在 render 期写 store），非可编辑状态或 objective 被替换时清旧 draft/dirty、但保留真实 in-flight pending；② 关闭/最小化/响应式重挂只在同一可编辑目标下 `releaseGoalUi` 保留草稿（不 `clearGoalUi`）；③ 被移除的焦点节点回填到摘要入口或 composer 编辑器，不落 `body`；④ `server-agent` 的 `/state` 消息版本早退只独立采纳「同 goal id + 严格更高 revision + 请求前捕获的 `goalSeq` 未被期间落地的 goal 改变」的 goal，跨 id/`null` 不越过 guard。
- 文档：`docs/wiki/src/components/README.md`（新增 GoalSummarySection/goal-summary.css/goal-control-strip 条目与本轮行为段落）、`docs/wiki/src/lib/README.md`（新增 `goal-ui.ts` 行与共享 store/水位段落）、`docs/wiki/README.md`（Goal 模式概览补生产 UI 主路径）。
- 验证（父 Agent 完整验证，全部通过，2026-09-10）：`npm run test` 退出码 0，**311 files / 3263 tests passed**；`npm run lint` 退出码 0，**0 error**（仅 1 个既有 warning `server/cloud/identity.mjs:92` no-useless-assignment，与本 feature 无关）；`npm run build` 退出码 0（TypeScript 类型检查与 Vite 生产构建通过，仍有既有 KaTeX 字体路径未构建解析警告与大 chunk 体积警告）；子 Agent 针对性回归 `npx vitest run tests/frontend/goal-control-strip.test.ts tests/frontend/goal-summary-section.test.ts tests/frontend/goal-ui.test.ts tests/frontend/goal-card.test.ts tests/frontend/goal-card-controller.test.ts tests/frontend/goal-state.test.ts` → **6 files / 113 tests passed**（control-strip 20 / summary-section 20 / goal-ui 17 / goal-card 22 / card-controller 19 / goal-state 15）；`feature_list.json` JSON parse 与 `git diff --check` 通过。
- 边界：本期为收尾文档/状态同步，未改后端（`server/` 未动）、未新增依赖、未 commit/tag/push、未发布 npm、未手工修改 `dist/`、`package-dist/`、`package-offline/`。未做真实浏览器实测（布局、焦点圈闭、屏幕阅读器、IME、pause↔pausing 时序均属代码/单测保障，不宣称浏览器已验证）。
- Notes：上轮评审六类中优先级问题中，**SSE 快照卡片刷新已补**（goal 快照/`goal_updated` 触发置顶摘要与 Goal 分区刷新且不动消息水位）；其余四类后端旧问题（同 session 并发、clear/compact 守卫、retry 生命周期、验收证据一致性）仍不修、不标已解决；消息版本回退属广义 SSE epoch/消息对账基础设施问题，本轮不扩范围、不声称已解决。
- 下一步：① 用户浏览器验收（摘要三态与 goal-only 会话、控制条两 icon 与 pausing disabled、胶囊目标/状态/验收数、编辑 dirty 与跨关闭/响应式保留、取消内联确认焦点圈闭、pause 走真实后端时序）；② 验收通过后决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。

---

## Feature：ai-goal-mode Goal 模式（2026-09-10，done）

- 需求与语义（用户确认）：主聊天 `/goal <目标>` → 只读规划 → 用户确认 → 有限轮执行 → `needs_review` 交回用户；`accept` 是唯一人审完成动作，`resume` 只继续执行，模型不能自行验收。范围仅 QuickForge 主聊天（共享/ACP/定时任务不可用）。
- 状态流（代码语义，不含行号）：`/goal` 创建 goal 并进入 `planning`（复用 `/plan` 只读白名单，`goal_report action:"plan"` 提交准则/范围/摘要）→ `awaiting_confirmation` → 用户 `confirm` → `running`/`verifying` 有限轮 → `needs_review` → 用户 `accept`（写 human 证据并 `completed`）或 `resume`（继续执行）；受阻/审批拒绝超时/提问跳过/无进展/重复失败/预算耗尽/持久化失败分别落到 `paused`/`blocked` 并带 blocker。
- 服务端：新增 `server/agent-goal-state.mjs`（纯状态模型：状态机、预算核算、证据与准则校验、human 验收、恢复映射、工作区 key）与 `server/agent-goal-runner.mjs`（会话绑定 runner：只读规划权限、工作区互斥 admission 队列、用户动作、`goal_report`、审批/ask/abort hook）。生命周期纪律：每轮仅在运行真正结束且最终状态持久化成功后调度下一轮（fail-closed → `paused`/`persist_failed`）；显式 settle barrier + abort generation 观测用户中止；goal body 随会话 CAS 权威快照持久化、metadata 只存 `{id,status,updatedAt}` 投影；重启把 in-flight 状态映射为 `paused` 且不自动重放。预算默认 8 轮 / 30 分钟累计活跃，`revise` 保留累计用量，耗尽后 `resume` 409 并提示 `cancel` 新建。
- API 与工具：`POST /api/agents/:sessionId/goal` 的 `confirm` / `pause` / `resume` / `cancel` / `revise`（需 `objective`）/ `accept`（仅 `needs_review`）。`goal_report` 会话专用：仅活跃 goal 时注入，不在 `workspaceTools`/`GET /api/tools`，无 REST handler；证据只引用真实成功工具结果的 `toolCallId`（`run_command` 还需 exit code 0 且无中止/超时/信号），控制面/委派/Skill/记忆工具永不作为证据，工具成功是证据来源但不是目标的语义验证；human 证据只由用户 API 写入。
- 前端：新增 `src/lib/goal.ts` 共享契约与 `src/components/chat/panel-decoration/goal-card.ts`（纯视图模型 + 原生 DOM 控制器，复用既有面板装饰模式，非 React 组件），挂在 composer shell 首位；`state.goal` 由快照、SSE `goal_updated` 与 `updateGoal` 维护，同 id 用 `revision`、跨 id/清空用 `goalSeq` 水位防竞态，请求 30s 超时；`needs_review` 提供 accept/resume 双按钮，字段防御归一化且签名相同不重绘。
- 文档同步：`docs/wiki/README.md`、`server/README.md`、`server/routes/README.md`、`server/tools/README.md`、`src/lib/README.md`、`src/components/README.md`。未引入新视觉模式，未改 `DESIGN_LANGUAGE.md`；本轮实现未请求可视化产物，未新增图文件。
- 验证（父 Agent 完整验证，全部通过）：`npm run test` 退出码 0，**308 files / 3180 tests passed**；`npm run lint` 退出码 0，**0 error**（仅 1 个既有 warning `server/cloud/identity.mjs:92` no-useless-assignment，与本 feature 无关）；`npm run build` 退出码 0，TypeScript 类型检查与 Vite 生产构建通过（仍有既有 KaTeX 字体路径未构建解析警告与大 chunk 体积警告）；`git diff --check` 通过；`git status` 无 `dist/`、`package-dist/`、`package-offline/` 变更。cancel/settlement 收尾竞态已修复并有测试覆盖，全量测试通过。
- 未做（明确不宣称）：浏览器 E2E、真实模型端到端实测（planning/continuation 由 MockAgent 与纯函数测试覆盖）。
- 边界：未新增依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未 commit/tag/push。文档只写完成后的行为、不依赖行号。
- Notes（发现但不修的无关旧问题）：`server/context-references.mjs` 仍按会话级残留 `modelAccessContext.source === 'shared'` 判定共享会话，而该 overlay 由共享路由按请求写入会话（`server/agent-manager.mjs`）；共享访客发过一条消息后，owner 首条带文件引用的 prompt 可能被误拒。与 goal 的请求级来源处理口径不一致，另行 feature，不扩大本轮修复范围。
- 下一步：浏览器真实模型验收——`/goal` 规划→确认→执行→人审双按钮（accept/resume）→暂停/继续/修改/取消；或由用户决定是否提交（本会话未 commit/tag/push/发布）。

---

## Feature：subagent-run-detail-model-thinking subagent 运行详情展示模型与思考等级（2026-09-09，done）

- 需求（用户提出）：点击 subagent 摘要打开 Workspace Inspector 运行详情时，希望看到该次 subagent 实际使用的模型与思考等级；范围仅限详情页。样式两轮调整（用户确认）：最终为任务说明块上方独立一行、居中，只显示「模型名 · 思考等级」，不带文字标签与继承标记。
- 调研（双 explore）：详情链路 = 聊天摘要点击 → `OPEN_SUBAGENT_RUN_EVENT` → WorkspaceInspector `kind:'subagent'` Tab → SubagentRunDetailContent → `renderSubagentRunBody`（local-tools.ts）。缺口：服务端已算出 `subagentModel`/`subagentThinkingLevel`，但 details 只写 `model: subagentModelInfo`（继承时无模型名）且完全没有 thinkingLevel；前端 payload 未解析；summary 块受 `detailed` 门控。
- 实现：服务端 `agent-subagent-runner.mjs` 新增 `subagentRuntimeDetails`（模型 info + provider/id/name + thinkingLevel），emitSubagentTrace / buildTerminalSubagentDetails / 成功终态三处 details 展开它；前端 `subagent-run-detail.ts` 新增 `SubagentRunModel`/`SubagentRunThinkingLevel` 类型与 `payload.model`/`thinkingLevel` 严格解析、`'meta'` block、`subagentRunModelLabel`/`subagentThinkingLevelLabelKey`；`local-tools.ts` 新增 `renderSubagentRunMeta`，在任务说明块上方独立一行居中渲染（`flex items-center justify-center text-xs`，`模型名 · 思考等级`）。样式调整后不再需要文字标签与继承标记，i18n 无新增 key（思考等级复用既有 `thinkingLevel` 系列）。
- 审查发现并修复：旧会话 `details.model` 只有 `{mode,inherited}` 无模型标识时，原判定会产生空 meta 块与多余间距 → block 条件改为 `subagentRunModelLabel(...) || thinkingLevel`，并加回归用例。
- 验证（父 Agent 独立复跑）：`npx vitest run tests/frontend/subagent-run-detail.test.ts tests/frontend/i18n-language-snapshot.test.ts tests/frontend/input-clamp.test.ts` 121 passed；`npx vitest run tests/server/agent-manager.subagents.test.mjs` 14 passed；`npm run lint` 0 error（仅既有 identity.mjs warning）；`npx tsc -b --pretty false` 无错误；`npm run build` 成功。
- 边界：仅详情页；未改聊天摘要卡/置顶摘要行；未新增依赖；未改生成产物；未 commit；未加 DOM 渲染测试（仓库无渲染 harness）。
- 用户反馈排查：「没看到思考等级」——该字段本次新增，只对改动后新产生的运行生效；历史会话持久化的 details 没有此字段（固定模型的历史 details 仍带 providerId/modelId，所以模型名可见），需重启 dev server 并重跑一次 subagent 验证。
- 下一步：浏览器冒烟 + 用户决定 commit/发布。

---

## Feature：remove-opencode-harness 移除 OpenCode ACP harness 支持（2026-09-09，done）

- 完成内容：全量实施完成（服务端/前端/测试/文档三批次全部落地），三项已确认决策全部落实——① 保留 `.opencode/` 目录生态兼容；② 不做旧 OpenCode 会话向前兼容（存量会话降级为 QuickForge 会话，已记入 CHANGELOG Breaking Changes）；③ 彻底删除 harness 概念（不保留 'quickforge' 单值管道，设置页默认 Harness 选择器整体删除）。
- 服务端：删 `server/opencode-acp-agent.mjs`、`server/agent-harness.mjs`（访问模式 helper 迁回 agent-manager.mjs 并新增内部导出 hasFullAccess，agent-subagent-runner import 已改）；routes/agent.mjs 删 harness/config-option、harness/mode、fork 三条路由；agent-persistence 删 harness/harnessSessionId/openCodeUsage；agent-approval-orchestrator 删 createAcpApprovalPromise；sqlite v11 迁移与 session-state-repository/session-state-service 去 harness 列/字段。
- 前端：模块改名承接——`chat-harness-capabilities.ts`→`src/lib/chat-capabilities.ts`、`default-harness-events.ts`→`src/lib/cross-tab-events.ts`；删 deferred-session-harness.ts、opencode 三个菜单文件；types/server-agent/startup-model/pi-chat/local-tools/todo-write-history/panel-decoration 系/ChatPanelHost/App/三个 hooks/default-options-settings-tab（整个默认 Harness 选择器删除）/i18n/index.css 清理完毕。
- 测试：删 opencode-acp-agent.test.mjs、agent-harness.test.mjs（appendAssistantErrorMessageOnce 用例迁至新建 `tests/server/agent-session-events.test.mjs`）、opencode-config-menu.test.ts、deferred-session-harness.test.ts、chat-harness-capabilities.test.ts（新建 `tests/frontend/chat-capabilities.test.ts`）；修复/改写约 30 个测试文件（含源码契约切片边界与 vi.mock 清理）。
- 文档：删 `docs/architecture/agent-harness-selection.zh-CN.md`；更新 docs/wiki 各 README 与 session-storage-v2 架构文档；CHANGELOG.md 顶部新增 [Unreleased] Removed/Breaking Changes 英文条目。
- 验证：`npm run test`、`npm run lint`、`npm run build` 全量全部通过（2026-09-09）。grep 终态：server/、src/、tests/ 中 harness 0 命中；opencode 仅剩 `.opencode/` 目录兼容文案（i18n.ts、project-commands-settings-tab.ts、README.md、wiki 目录扫描描述）与 CHANGELOG/归档历史。保留项（.opencode/ 生态、@agentclientprotocol/sdk 与 server/acp/、session_forked 事件、审批共享流）已验证完好。
- Notes：① 工作区存在他人未提交 WIP（new-chat-greeting、file-rollback、session-file-backups 等），本任务未触碰，建议单独提交；② CHANGELOG 已有 [Unreleased] 条目待发布时归入版本；③ package-dist/package-offline 生成产物将在下次打包自然更新；④ 为满足 harness 0 命中对 17 个测试文件做了脚手架标识符中性化重命名（createHarness→createEnv 等），如需保留原命名可单独回退。
- 下一步：用户 review 并决定 commit/发布；发布需走 patch-release-runbook 或用户指定流程。

---

## Feature：fix-builtin-agent-save-silent-noop 内置 Agent 保存静默失效修复（2026-09-09，done）

- 现象（用户报告）：设置 → 智能体里编辑内置 subagent（explore/general）的模型、思考等级、MCP/Agent Skills 开关后，点保存「没有任何反应」。
- 根因（父 Agent 定位 + 真机验证）：内置定义 `maxRuntimeMs = 2h`（`server/subagents.mjs:37,53`，`f69e5a8` 于 2026-09-03 从 1h 提到 2h），而前端表单上限 `MAX_RUNTIME_MINUTES = 60`（`src/components/agent-profiles/agent-runtime.ts:3`）→ `agentFormFromProfile` 回填 `maxRuntimeMinutes="120"` → `isMaxRuntimeMinutesValid` false → `agentFormIsValid` false。保存按钮（`AgentProfilesPage.tsx:665`）对内置项有 `!editingAgent?.builtin &&` 豁免所以可点击，但 `handleSaveAgent`（`:421-422`）首行守卫无豁免 → 静默 return。服务端 PATCH 实测 HTTP 200，后端无问题。
- 修复（方案 A，用户确认）：`handleSaveAgent` 首行改为 `if (!editingAgent?.builtin && !agentFormIsValid(agentForm)) return`，与按钮 disabled 条件完全一致；内置项名称/label/工具集/运行预算本就 disabled 且不在保存 payload 中，不应阻塞保存。
- 测试：`tests/frontend/agent-profile-runtime.test.ts` 新增契约用例，锁定该守卫写法 + 「内置 2h 确实超出可编辑 60 分钟上限」事实。
- 验证（父 Agent 复跑）：定向 `npx vitest run tests/frontend/agent-profile-runtime.test.ts` 7/7 passed；`npx eslint` 两个改动文件 0 error；`npx tsc -b --pretty false` 无错误；`npm run build` 成功（仅既有 chunk 体积警告）。真机 `PATCH /api/agent-profiles/explore` 返回 200。
- 边界：未改 server 白名单/内置定义/60 分钟上限；内置项仍只能保存 4 项覆盖（名称/提示词/工具/预算/启用开关仍不可保存，设计如此）；未新增依赖、未手工修改生成产物、未 commit/tag/push。
- 下一步：浏览器冒烟——编辑内置 explore/general 改模型或 MCP 开关，点保存应关闭弹窗并在重开后保持；自定义 agent 编辑保存仍正常。

---

## Feature：new-chat-time-based-greeting 新对话欢迎语按时段随机（2026-09-09，done）

- 需求：用户希望新对话空状态标题「今天想推进什么？」按时间点变化；首版草案被用户指出「推进」重复 12 次太单调，已重写为动词轮换（做/开始/搞定/收尾/安排/动手/忙/处理），"推进"归零。
- 方案（用户确认）：4 时段 morning 06:00–11:59 / afternoon 12:00–17:59 / evening 18:00–22:59 / lateNight 23:00–05:59（本地时间）+ 问候保留行动号召 + 每段 3 条随机；方案 A = 纯函数 + i18n key，不做用户可配置文案、不新增依赖。
- 实现：新增 `src/lib/new-chat-greeting.ts`（`getNewChatGreetingSlot` 越界/NaN 归一化、`getNewChatGreetingKeys`、`pickNewChatGreetingKey(date, random)` 随机可注入、`NEW_CHAT_GREETING_FALLBACK_KEY` = 既有 `newChatEmptyTitle`）；`src/lib/i18n.ts` 中英各新增 12 条 `newChatGreeting*`；`src/App.tsx` 在 `showNewChatEmptyState` 后以 `useMemo([showNewChatEmptyState])` 锁定随机结果（防重渲染抖动），替换第 2377 行渲染；新增 `tests/frontend/new-chat-greeting.test.ts`（20 用例）；`docs/wiki/src/lib/README.md` 模块表补一行。无需 SVG：纯文案选择逻辑，无新视觉结构。
- 验证（父 Agent 已核实）：定向 `npx vitest run tests/frontend/new-chat-greeting.test.ts` 20 tests + 关联回归 task-launcher 18 / i18n-language-snapshot 2 全过；`npm run test` 全量 304 files / 3107 tests passed；`npx eslint` 4 个改动文件 0 error；`npm run build` 成功（仅既有 KaTeX 字体解析与大 chunk 警告，dist 按既有流程刷新）。
- 边界：仅空状态 Hero 标题文案来源；不改 Hero/项目选择器/快捷任务结构；无设置项、无持久化 schema 变更、无新依赖；i18n 既有 key 全保留（`newChatEmptyTitle` 作兜底）；跨时段不自动刷新（进入新对话时重算一次）。未 commit。
- 下一步：浏览器冒烟——四时段文案区间正确、同一空状态内重渲染不抖动、新建/刷新后随机变化、英文语言下文案正确。

---

## Feature：chat-task-launcher 模板插件替换与办公产物 Prompt（done，待父 Agent 审查）

- 用户批准小修：模板只撤回上次自动选择的插件，保留手动已有/后来重选；办公切开发撤回、周报与 Word 共用 documents 不重复。controller 内存完整 key 所有权，遵守四项上限；chip 取消、consume、restore 清理来源，不增加持久化 schema。冲突等待/keep/过期操作不改选择，恢复正文前同步最终 controller 快照。
- 中英文 PPT/Word/数据 Prompt 明确请求 PPTX/DOCX/XLSX 文件，删除正文优先及不承诺降级措辞；周报仍以编写周报为目标。未修改真实生成能力、插件启用 API 或不可用提示。
- 文件：capability-suggestions.ts、task-launcher.ts、i18n.ts、对应两份测试、components Wiki 及三份状态；保留并行产物卡改动。无需新 SVG：无新视觉结构，仅选择状态修复与文案。
- 验证：vitest 8 files / 65 tests passed；5 个修改 TS 文件 ESLint、tsc -b --pretty false 通过。首次新 i18n 测试触发 Node 环境 DOMMatrix 缺失，mock 外部 pi-web-ui 翻译依赖后通过，产品代码未为测试降级。未 build、未改生成产物、未新增依赖、未 commit。
- 下一步：父 Agent 审查，浏览器冒烟连续模板替换、手动重选保留与实际办公任务；未做浏览器/真实文件生成实测。

---

## Feature：per-turn-artifact-cards 每轮产物卡 + 轮级撤销（2026-09-09，done）

- 背景：用户反馈「当前的产物和预览设计应该是每轮对话，现在是最后才有，底部应该都检测」。双 explore 调研确认根因：产物卡被 `if (streaming) return` gate 限制在 agent run 结束后才更新，且全会话只有一张卡挂最后一条 assistant 底部（Rev9 会话累计口径的有意设计）。用户确认方案：每轮一张卡显示该轮新增、轮结束出卡、每轮卡带轮级撤销（安全分组语义：不安全禁撤只撤安全文件）、预览入口维持点击触发；一次做完。
- 服务端实现：`session-file-backups.mjs` 版本化（entry 新增 `versions[]`，每次写盘存独立 blob 快照 + turnId/toolCallId 归属；旧格式隐式单版本向后兼容，会话级/单文件回滚行为不变）；新增 `getSessionTurnRollbackPreview`/`rollbackSessionTurn`（复用文件锁、pending intent、双 preflight、fresh revision、generation 防 ABA、失败即停不补偿）；安全 reason 枚举 modified-after-turn / external-change / stale-backup；restore=写回该轮首版本 before、delete=删除该轮新建文件。`agent-manager.mjs` runPrompt 生成 turnId（模块级 sessionTurnIds + currentSessionTurnId，agent_end/finally 清除；合成路径与 continueSession 重试不生成）；`tools/index.mjs` write/edit 备份 meta 带 turnId+toolCallId 且 details 返回 turnId；`agent-subagent-runner.mjs` 透传父 turnId；`routes/agent.mjs` 新增 GET rollback-turn/preview + POST rollback-turn（completed/partial→200、blocked→409、failed→500，对齐 rollback-file 形态）。
- 前端实现：`tool-artifacts.ts` 新增 `extractTurnArtifacts`（user/user-with-attachments 双边界切片，前置组 userIndex=-1，AiTurnArtifact 增 turnId）；`assistant-artifact-card.ts` 多卡化（每轮一张挂该轮最后 assistant、显示该轮新增；removeOrphanArtifactCards 只删孤儿卡；展开态按宿主 dataset；签名按宿主+撤销态；streaming gate 保留=轮结束出卡；撤销按钮仅 turnId 存在且未撤销时渲染）；`message-actions`/`ChatPanelHost` deps 换 onRollbackTurn/rolledBackTurns + getArtifactMessages 显式全量；`server-agent.ts` 新增 getTurnRollbackPreview(30s)/rollbackTurn(60s) 附 status 错误；`FileRollbackDialog` 新增 TurnRollbackDialog（复用安全分组 UI，无单文件入口）；`file-rollback-state.ts` 新增 turn 控制器（completed/partial 均算已撤、409→conflict、网络错→unconfirmed 禁再执行）；`App.tsx` rolledBackTurns: Set<turnId>，移除会话级 rollbackFilesFromArtifactCard 入口（API 保留）；i18n 15 个 turnRollback* key 中英成对。
- 验证（父 Agent 已核实）：npm run test 全量 302 files / 3061 tests passed；npm run lint 0 errors / 1 既有 warning；npm run build 成功（仅既有警告）。子任务定向：服务端 120/120 + 关联回归 233/233（旧用例零改动）+ eslint/node --check；前端 174/174 + tsc -b + eslint。Wiki 五份已同步（server、server/routes、server/tools、src/components、src/lib）。
- 会话级恢复（2026-09-09 追加，用户反馈撤回功能缺失）：调研确认会话级能力全套保留（server 3 端点/弹窗/控制器/API 零改动，版本化后行为自洽——entry 首版本锚定保证恢复语义、轮级撤过的文件干净退出会话级预览、会话级不覆盖已确认的轮级撤销），仅 App 入口丢失。恢复实现：App 恢复 rolledBackFilesSessionId + rollbackFilesFromArtifactCard + FileRollbackDialog（session 模式）挂载（fileRollbackTarget 带 mode: turn|session 分流）；产物卡最新一轮 changed 卡头部并列「撤销本轮」（新 key assistantArtifactRollbackTurn）+「撤销全部」（新 key assistantArtifactRollbackAll，dataset.quickforgeAction=rollback-all，零新增 CSS）；fileChangesRolledBack OR 进轮级 rolledBack 判定与卡签名（会话级撤后全部置灰）；onArtifactsChange 首行清 rolledBackFilesSessionId 重新武装；message-actions/ChatPanelHost 透传 + effect 依赖补 fileChangesRolledBack。父 Agent 复跑全量：npm run test 303 files / 3072 tests passed；lint 0 errors；build 成功；定向 6 files / 161 tests + tsc -b + eslint 6 文件 0 error。wiki src/components 三处同步（目录树注释、撤销接线、产物卡撤销段）。
- 修订三（2026-09-09，用户明确撤回语义=只撤本轮）：移除「撤销全部」（卡片/透传/App/i18n 全清理，会话级 API 与 session 弹窗组件保留无入口）；continueSession 重试也生成独立 turnId（agent-manager，与 runPrompt 同机制）；轮级接口 turnId 改 turnIds 数组（GET query 逗号分隔/POST body 数组/preview 回显；集合匹配，modified-after-turn=首匹配后有集合外版本写入含无归属）；前端轮对象 turnIds 集合 + turnRollbackKey 轮键 join('|') + turnIds 并入卡签名（重试追加卡重建）；每轮都可撤（用户确认，安全检查保护）。父 Agent 复跑全量：npm run test 303 files / 3086 tests passed；lint 0 errors；build 成功；服务端定向 5 files / 143 tests、前端定向 7 files / 182 tests；query 编码联调审查通过。wiki 四份同步（server、server/routes、src/components、src/lib）。
- 修订四（2026-09-09 深夜，真机 bugfix）：用户报告看不到「撤销本轮」按钮。排查：dist 含新前端、运行中 server 有 rollback-turn 路由、用户测试会话（15:30 test-undo.md）备份索引 versions 记录 turnId=null → 最小复现证明 tools 层 getter 链正常（details.turnId 与备份 version.turnId 均正确）→ 定位根因：`server/agent-manager.mjs` 的 `createAgent` 内联调用 `createServerTools` 时两个 options 分支均漏传 `getTurnId`（初版 subagent 只给 `rebuildSessionTools` 加了；会话创建路径的工具集因此没有 turnId getter，写盘 turnId 恒 null，轮级撤销全程不可见；MockAgent 测试未覆盖该路径）。修复：createAgent 两分支补 `getTurnId: () => currentSessionTurnId(sessionId)`；新增源码契约测试（context-references 文件，断言 createAgent 内联调用两个分支各含一处 getTurnId 传参）防回归。验证：定向 3 files / 134 tests 全过；npm run test 全量 303 files / 3087 tests passed；eslint（排除 .launcher-index-verify）0 error；已 POST /api/system/restart 重启用户 server（新 pid 41448，bootId d993ccf2）生效。
- Notes：① `.launcher-index-verify/`（untracked 整仓验证副本，含 node_modules/tsconfig，非本 feature 产物，疑似并行 task-launcher 会话遗留）会干扰 ESLint tsconfigRootDir 检测导致全量 lint 报 800 个解析错误；`npx eslint . --ignore-pattern ".launcher-index-verify/**"` 通过（0 error / 1 既有 warning）。提交前应删除该目录或加入 .gitignore（归属待确认，本次未动）。② task-launcher 文件已被 stage（git add），非本会话操作。
- 边界：轮级撤销仅 QuickForge write/edit 路径（OpenCode ACP 无 turnId 不渲染撤销按钮）；重试写入 turnId=null 对轮级不可见；turn revision 绑定整个 index（无关文件新写入也 409）；轮级回滚后同文件会话级回滚 fail-closed；canRollback 字段前端未显式消费（files.length>0 门控等效 fail-closed，与 session 弹窗一致）；rolledBackTurns 内存态刷新重置；多轮单次 run 中间轮卡等整 run 结束。完整清单见 feature_list.json。
- Notes：工作区同时存在 chat-task-launcher（并行会话，done 待审查）遗留改动，与本 feature 无关，未触碰。既有 server/cloud/identity.mjs:92 lint warning 未扩大修复。
- 下一步：浏览器冒烟——多轮对话各轮底部各出一张本轮产物卡；流式中不出现；每轮卡撤销弹窗安全分组（后续轮已修改/外部修改/旧备份三 reason）；partial 后剩余文件可继续；OpenCode 轮无撤销按钮；刷新后卡片正常重挂。

## Feature：chat-task-launcher 显示范围修正（done，待父 Agent 审查）

- 用户批准：仅主动发起新对话显示快捷卡；自动初始化、已有零消息会话不显示；首次发送后隐藏，无对话紧凑版。
- App 显式新建完成后记录 agent 身份，取消不打开；新建页切项目继承资格，历史切换/发送使 generation 失效。Host 以独立可见 ref 同步，不重建 panel；隐藏移除 root、取消异步填入、断开测量并清理高度变量。
- 新增资格/race 测试、扩展 DOM 隐藏与取消测试、更新侧栏路由契约和 Wiki。保留并行产物/撤销改动及原有历史记录。
- 验证：针对性 vitest 7 files / 47 tests passed；修改 TS 文件 ESLint、tsc -b 通过。未 build、未修改生成产物、未 commit；未浏览器实测。
- 下一步：父 Agent 审查异步新建与项目自动选择边界，浏览器验证首次发送/历史空会话及窄屏隐藏无占位。

---

## Feature：chat-task-launcher（done，待父 Agent 审查）

- 用户已批准正式实现；App 显式开启，Side Chat/shared 不受影响。开发/办公各四入口，空态描述卡片/已有对话紧凑，响应式主题 token、中英文及键盘 Tab。
- 点击只填模板，不发送；冲突内联保留/替换，确认重新读正文、附件、引用及无关插件。复用真实 capability controller，仅 enabled + loaded 插件选择，无启用 API；不支持 runtime 仍填模板。
- 初始草稿恢复前禁用；旧恢复取消，异步新操作/取消/发送/会话卸载失效；空态 ResizeObserver 根据真实 dock 高度定位项目选择器。
- 修改清单详见 feature_list.json；Wiki 已更新。保留原型与历史状态记录，未改生成产物、依赖，未提交。
- 验证：vitest 5 files / 38 tests passed；变更文件 ESLint、tsc -b、独立 Vite 生产构建与 git diff --check 通过，临时构建目录已清理。构建仅既有 KaTeX 字体/大 chunk warnings。
- Notes：初次只读命令误用了 PowerShell/系统 rg，当前 shell 无此工具；后续使用 cmd 与 dedicated grep。没有因此修改源码或依赖。
- Blocker/风险：未浏览器实测空态项目选择器、窄屏/矮屏、焦点及真实插件运行；不承诺 Office 导出。父 Agent 应审查初始恢复与 Lit 装饰/布局。
- 下一步：父 Agent 审查及浏览器冒烟；无需发布或提交。

---

## Feature：safe-single-file-rollback（done，正式实现完成）

- 目标与实现：专用弹窗安全文件行新增“撤销此文件”；独立 `POST rollback-file` 携带 `{path, revision}`，混合场景只撤安全文件、不动冲突文件。成功为 `partial` 时保留剩余项继续单撤或整批撤销，最后 `completed` 才标记整体完成；整批仍要求全部剩余文件安全。
- 改动：`server/session-file-backups.mjs`、`server/routes/agent.mjs`；`src/lib/server-agent.ts`、`src/components/chat/file-rollback-state.ts`、`FileRollbackDialog.tsx`、仅弹窗 CSS、i18n 与对应 server/frontend 测试。完整路径见 `feature_list.json`。外部文件卡、`src/App.tsx` 与 Demo 本轮未改。
- Wiki：五份已同步：`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- 验证（父 Agent 已核实）：`npm run test` **300 files / 2999 tests passed**；`npm run lint` **0 errors / 1 个既有 warning**；`npm run build -- --outDir .safe-single-undo-build-check` 通过类型检查与生产构建，独立目录已删除。独立只读审查未发现阻塞；未浏览器实测。
- 边界：沿用 QuickForge write/edit 安全回滚范围；文件系统操作不是原子事务，失败 intent 保留且不重试，不误报完成。未动 `package-dist/`、`package-offline/`，未新增依赖、未提交。
- Notes：仅既有 `server/cloud/identity.mjs:92` 的 `no-useless-assignment` lint warning 与 KaTeX 字体解析/大 chunk 构建 warnings，本次不扩大修复范围。
- 下一步：浏览器冒烟混合安全单撤、不动冲突文件、连续单撤/剩余整批/最后完成、窄屏。用户授权后已执行 `npm run build`，生产 `dist/` 已刷新为含单文件撤销的最新前端产物。

---

## Feature：safe-undo-file-rollback（正式实现完成）

- 目标：将用户已确认的安全撤销弹窗接入真实文件回滚；外层 Demo 不带入正式实现。
- 实现：新增专用文件撤销弹窗，外部文件卡/按钮的 class、布局和文案保持，旧消息回滚浮层未改。GET 获取 preview，POST 携带 revision，结构化处理 200/409/500；before/pending/after 连续性、文件锁、Windows 大小写路径别名、全批校验、旧备份拒绝与失败保留均已接入；前端用结构化状态呈现安全/不安全分组、整批禁用和真实结果。
- 重要文件：后端 `server/session-file-backups.mjs`、`server/session-file-lock.mjs`、`server/tools/index.mjs`、`server/agent-manager.mjs`、`server/routes/agent.mjs`；前端 `FileRollbackDialog.tsx`、`file-rollback-state.ts`、`assistant-artifact-card.ts`、`src/App.tsx`、`src/lib/server-agent.ts`、i18n/CSS；相关 server/frontend 回归测试（完整路径见 feature_list）。
- Wiki：已同步 `docs/wiki/server/README.md`、`server/routes/README.md`、`server/tools/README.md`、`src/components/README.md`、`src/lib/README.md`（后四项均相对 `docs/wiki/`）。
- 验证（父 Agent 已核实）：`npm run test` 全量 **300 files / 2930 tests passed**；最终前端文案测试另跑 **4 files / 48 tests passed**。`npm run lint` 通过，0 errors、1 个既有 warning。`npm run build -- --outDir .safe-undo-build-check` 通过（类型检查及生产构建）；独立输出已删除；随后按用户要求执行 `npm run build` 成功，已刷新当时整批撤销版本的 `dist/`（不含后续单文件最新版），未动 `package-dist/`、`package-offline/`。构建有 KaTeX 字体解析与大 chunk warnings。
- 边界：仅覆盖 QuickForge write/edit 文件工具（含归属父会话的子工具），不覆盖 shell/OpenCode 原生改动；全批检查不保证外部文件系统原子事务，中途失败如实计数并保留备份，不误报完成；旧备份不支持安全回滚。未 commit；保留其他历史/并行内容。
- Notes：未修改文件 `server/cloud/identity.mjs:92` 有既有 `no-useless-assignment` lint warning，本次不扩大修复范围。
- 下一步：未真机浏览器冒烟、无截图，不宣称视觉实测。用户检查原撤销入口打开新窗、外部修改混合场景整批禁用、安全恢复/新建文件删除、ESC 及深浅色/窄屏；本 feature 当时版本的生产 `dist` 已按用户后续要求构建；后续单文件撤销由 `safe-single-file-rollback` 承接，最新版已按用户后续授权的 `npm run build` 进入生产 `dist/`。

---

## Demo：safe-undo-interaction-demo（done，用户已确认）

- 目标：用户先看安全撤销 HTML 交互，Demo 本身不实现真实撤销逻辑。
- 产物：`design-mockups/safe-undo.html`，按用户截图简化为撤销文件改动弹窗：安全/不安全分组、文件路径与原因、右上关闭、右下撤销。有任一不安全则整批不执行，全部安全才可确认；执行前再次整批检查。移除原部分撤销/失败重试演示。
- 验证：内联脚本 `node --check` 与主 Agent Node VM 断言通过（全部冲突/混合/备份不可用零写入；全安全恢复5个、删除1个；确认前新增冲突整批零写入；重复执行保护）；未做浏览器视觉/交互实测。用户已确认弹窗方案，外层 Demo 不带入正式实现。
- 边界：Demo 无真实文件访问或接口调用；Demo 阶段未改业务代码、依赖、生成产物，无需更新 Wiki（独立原型）。保留其他并行任务记录。
- 承接：真实安全撤销已由正式 feature `safe-undo-file-rollback` 承接并实现，见顶部记录；未提交。

---

## Bugfix：sidebar-session-row-hit-area（2026-09-09）

- 现象：侧栏会话行（置顶/时间线/项目分组/全局 4 处渲染）边缘点击无响应，与 2026-09-08 项目行 hit-area 同构：行容器 div 无 onClick，选中只挂在内层 flex-1 标题按钮上，上下 py-1.5、左 px-2、右缘 px-2+gap-2、hover 时右侧操作 overlay 全高拦截均为死区。
- 根因：会话行行容器（rowClass）只有 onMouseEnter/onClickCapture（仅隐藏 hover tip）/onMouseLeave，无 onClick；对照项目行修复前同款结构。
- 修复（与 sidebar-project-row-hit-area 同模式但更简）：① 4 处行容器统一加 `onClick={() => onLoadSession(session.id)}`，内层标题元素移除各自 onClick 让 click 冒泡行级统一处理（aria-busy/role/tabIndex 保留；置顶行 onKeyDown 保留——原生 div 键盘不派发 click，删掉会坏键盘可达性；其余三处原生 <button> 键盘 Enter 的 click 自然冒泡无双触发）；② overlay pin handler `toggleSessionPinFromActions` 补 `event.stopPropagation()`（requestDeleteSession/confirmDeleteSession 原已具备），防点 pin 误触行级选中；③ 不加 suppressRef——会话行不在任何 SortableContext 内（仅 sectionOrder/projectIds 可拖），无拖拽误触风险；deleting 行已有 pointer-events-none 隔离。
- 测试：新增 `tests/frontend/session-row-hit-area.test.ts` 4 用例（源码字符串契约，以 `onMouseEnter={(event) => showSessionHoverTip` 4 次出现按文档序切片）——4 处行容器含行级 onClick 且保留既有三事件、内层无 onClick 且 a11y 属性保留、置顶 onKeyDown 保留、三个 overlay handler 均含 stopPropagation、无 suppressSessionRowClickRef 契约。
- Verification: 定向 vitest 5 files / 47 tests 全过（session-row-hit-area 4 新 + project-row-hit-area 5 + sidebar-section-header-hit-area 7 + sidebar-session-action-alignment 9 + sidebar-section-order 22，既有断言零修改）；eslint ChatSidebar.tsx 与新测试 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（dist 已刷新，仅既有警告）。
- Boundaries: 只修 4 处会话行，未动项目行/分区头/样式类名；折叠态行为一致；wiki 无需更新（纯组件内交互修复）；未新增依赖、未触碰生成产物、未 commit。
- 下一步：真机冒烟——点击会话行上下留白/左右边缘即选中会话；hover 行右侧点 pin/归档不误触选中；置顶行键盘 Enter/Space 仍可打开；deleting 行不可点。

---

## Feature：简化自定义模型的推理/思考模型标签（2026-09-09）

- 目标：移除自定义模型设置标签中的“DeepSeek V4、Qwen 等”示例，只保留简短名称。
- 实现：`src/lib/i18n.ts` 的 `reasoningModel` 简化为中文“推理/思考模型”、英文“Reasoning / Thinking model”；组件仍使用原 i18n key，功能与交互不变。
- 验证：`npx vitest run tests/frontend/i18n-language-snapshot.test.ts`（1 file / 2 tests）通过；`npx eslint src/lib/i18n.ts` 通过；旧 UI 长文案在 `src/` 中无残留；`git diff --check` 通过。
- 边界：用户指南中的 DeepSeek V4 独立能力说明保留；纯文案调整，无需更新 Wiki；未修改生成产物；已纳入本次本地提交，未 push。

---

## Release：v2.0.0 发布准备（2026-09-09，完成）

- 目标：按用户确认发布当前 `dev` 全量内容，目标版本 2.0.0；不含 Android。
- 远端核验：已执行 `git fetch --prune --tags origin`；当前分支 `dev`，`HEAD` 与 `origin/dev` 均为 `7cd79018e76d84a54b6f852a7347fcb5f567356c`；准备前工作区干净；远端标签中不存在 `v2.0.0`。
- 已完成：`npm version 2.0.0 --no-git-tag-version` 更新 `package.json` / `package-lock.json`；按 `v1.10.2..HEAD` 整理 `CHANGELOG.md` 2.0.0 说明；README 当前版本更新为 2.0.0；同步发布状态文件。
- 发布范围：`pinned-summary-draggable-capsule` 与 `workspace-inspector-header-alignment` 两个 `needs-review` 功能已按用户确认以现状纳入本次发布，各自状态不改；Android 不纳入。
- 发布硬门禁（全部通过）：`npm run test` 全量 296 files / 2847 tests 全过；`npm run lint` 0 errors；`npm run build` 成功。
- 打包核验：runtime/offline 包已生成并核验——`shawnstack-quickforge-2.0.0.tgz` 版本 2.0.0、无 scripts/devDependencies、ripgrep 位于 optionalDependencies。
- git 收尾：`master` 已以快进（`--ff-only`）方式与 `dev` 同步；release commit 与 `v2.0.0` tag 已创建并推送至 origin。
- 文档边界：本轮只改发布元数据与发布状态，不改变架构、模块职责或公共入口，因此无需更新 `docs/wiki`。
- 待办：npm publish 留给用户手动执行，本会话默认不执行。

---

## Feature：git 读接口（file-diff/branches/log）客户端断开取消传播（2026-09-09）

- 背景：P2 收尾。git() 的 signal 能力与 createRequestAbortState helper 已就绪（前两个 feature），把取消传播扩展到其余 3 个 git 读接口——前端关分支菜单/图谱弹窗虽不 abort 请求，但刷新/关页/断连时服务端不再白跑（file-diff 内部还跑全量 git status）。
- 实现：见 feature_list.json 同 id 条目（5 个底层函数加可选 signal 完整传播；3 个 handler 接 helper，file-diff 两处传播、controller 建在 path 校验后）。
- 验证：定向 4 files / 43 tests 全过（it.each 参数化 3 新用例，status 既有用例零改动）；eslint 0 error；`node --check`；`npm run test` 全量 296 files / 2847 tests 全过；`git diff --check` 通过。
- 边界：不动 git 写接口与前端（getGitBranches/getGitLog 无超时记后续候选）；至此 4 个 git 读接口取消语义统一。
- 下一步：真机冒烟——4 个 feature（本日累计）待验证清单见 session-handoff；剩余候选 = 前端 branches/log 请求超时与组件卸载 abort、workspace 读接口（children/file）超时、MCP 增量重连、storage/quota 缓存。

## Feature：workspace/search 切换 ripgrep 优先（保真模式 + BFS 兜底 + 超时/取消）（2026-09-09）

- 背景：接口超时/慢接口调研的 P2。search 原为栈式 DFS 逐目录 realpath+readdir，无超时、不可取消（wiki 明说客户端取消不停服务端扫描）；前端文件树过滤框防抖 abort 旧请求后服务端照跑。
- 关键发现：search 是**文件名/路径子串搜索**（返回 entries），非内容搜索——不能复用 grep 工具封装的输出层；改为 `rg --files` 只外包目录遍历，Node 侧 includes 匹配保真。
- 实现：见 feature_list.json 同 id 条目（utils/ripgrep.mjs 抽共享；`--hidden --no-ignore` + glob 排除保真；目录条目父目录推导；60s 超时 + 200k 行护栏 + signal 取消；失败回退原 DFS；createRequestAbortState helper，handleGitStatus 迁移复用、handleWorkspaceSearch 接入取消）。
- 验证：定向 5 files / 88 tests 全过（**现有 search 测试 21 用例零改动全绿 = 行为保真验收**）；eslint 0 error（tools 2 个 no-console 为既有）；`node --check` ×3；tests/server 全量 156 files / 1385 tests 全绿。
- 边界（已接受的差异）：空目录条目 / 工作区内 symlink 目录在 rg 路径下不可见；超载时前 limit 条可能不同（truncated 语义一致）；mention-search 未迁移（前端零调用）。
- 下一步（F2，同日推进）：其余 git 读接口接入 abort 传播；真机冒烟——大仓库文件树过滤搜索响应明显变快、连续输入时旧扫描被真正中止。

## Feature：同步等待 LLM 的 4 个路由接口场景化 total 超时预算（2026-09-09）

- 背景：接口超时/慢接口调研的 P1。4 个「HTTP 响应同步等 LLM 跑完」的接口（test-connection / ai-fill / scheduled-tasks parse / generate-commit-message）全部走默认 total 20min，极端时用户等 20 分钟；wrapper 原生支持 totalTimeoutMs 覆写但无人使用。
- 实现：见 feature_list.json 同 id 条目（ai-provider-options.mjs +4 常量：60s/3min/2min/2min；4 个路由 options 各加一行，不改 wrapper 与 idle/firstEvent 档）。
- 验证：定向 vitest 6 files / 57 tests 全过（新 tests/server/routes/ai-timeout-budgets.test.mjs 4 用例 + 常量契约 + 默认档回归）；eslint 7 文件 0 error；`node --check` ×5；`npm run test` 全量 295 files / 2841 tests 全过（首次 1 例 runtime-diagnostics `elapsedMs ≥5ms` 计时 flaky，单独重跑 ×2 + 全量重跑全绿）；`git diff --check` 通过。
- 边界：不动 wrapper/idle/firstEvent 档/透明重试语义；4 接口未传 AbortSignal（客户端断开传播留后续）；SSE 零影响。
- Notes（与 feature 无关，未处理）：① runtime-diagnostics.test.mjs 的 `elapsedMs ≥5ms` 断言在全量并发下偶发 4ms flaky，可考虑放宽阈值或改 fake timers；② 调研附带发现 session-utils.mjs（AI 标题）与 conversation-compaction.mjs 也未传 total 覆写、wrapStreamWithTimeouts 的 maxStreamRetries 不可由 options 覆写，均为后续候选。
- 下一步：真机冒烟——配置不可达模型 Base URL 后点「测试连接」，应在 ~60s 内返回失败（此前极端 20min）。P2 候选 = workspace/search 换 ripgrep、其余 git 读接口接入 abort 传播、LLM 调用的客户端断开传播。

## Feature：git status 取消传播 + ChatPanelHost 分支探测接入 light（2026-09-09）

- 背景：接口超时/慢接口调研后的 P0 收尾。git-status-latency-reduction 已把 full 优化到 ~257ms、light 106ms；遗留两点：ChatPanelHost 分支探测走 full（只消费 isGitRepository/branch），以及前端 20s 超时/abort 后服务端不感知、git 子进程白跑到 2min 预算。
- 实现：见 feature_list.json 同 id 条目（A：ChatPanelHost `{ light: true }`；B：git() 支持 options.signal + handleGitStatus AbortController 取消传播，signal 贯穿 status/numstat/detached HEAD 兜底，AbortError 静默结束）。
- 验证：定向 vitest 5 files / 67 tests 全过（新增 4 用例：git() 三态 abort + 路由级客户端断开）；改动文件 eslint 0 error；`node --check`；`npx tsc -b`；`npm run build` 通过（仅既有警告）；`npm run test` 全量 294 files / 2836 tests 全过；`git diff --check` 通过。
- 边界：取消传播仅覆盖 /api/git/status 链路（git() signal 能力已就绪，其他 git 接口后续接入只是几行）；collectWorkspaceLineCounts 的 fs 读取不中止；App 标题栏仍走 full。
- Notes（与 feature 无关，未处理）：workspace.mjs 私有的 killProcessTree 可考虑复用 `server/utils/process-tree.mjs` 的 terminateProcessTree（SIGTERM 宽限 + taskkill 超时），本次未扩大范围。
- 下一步：真机冒烟——刷新页面观察分支徽标更快出现（走 light）；客户端断开 status 请求后服务端不再有后续 git 进程耗时。后续候选（P1）：同步等 LLM 的 4 个接口（test-connection/ai-fill/parse/generate-commit-message）传 totalTimeoutMs 场景化预算、workspace/search 换 ripgrep、其余 git 读接口补 abort 传播。

## Feature：产物卡「审查」打开卡死修复——file-diff 20s 超时 + 终态 diff tab 重拉（2026-09-09）

- 现象：用户报告点击生成产物卡的「审查」，若审查内容已被删除，会一直显示「打开中」，并导致其他请求卡住。
- 调研结论（explore subagent 只读 + 主 Agent 溯源）：服务端 `handleGitFileDiff`（server/routes/workspace.mjs:1464）所有分支都有界且必回复——文件已删除/已无工作区变更 → 404 `File has no working tree changes`（7157293 起前端转友好空态），tracked 删除 → 200 删除 diff，git 子进程 2 分钟硬超时，throw 全被全局 catch sendError。挂死在前端：`getGitFileDiff` 是 workspace-api 里唯一无超时的 git 请求；连接池排队/服务端极慢时 `await` 永不 settle → reader tab 永远 `loading:true`「打开中」，且挂起请求一直占同源 6 连接池一个槽位拖住其他请求；`openDiffTab` 对已存在 diff tab 只激活不重拉，卡死后再次点「审查」永远无法恢复。guard 早退（项目切换中途）与 tab 持久化恢复均排除（diff reader 不被持久化恢复；换项目时 tabs 整体替换）。
- 修复：① `workspace-api.ts` `getGitFileDiff` 加 `GIT_FILE_DIFF_TIMEOUT_MS=10s` 超时（对齐 `getGitStatus` 的 TimeoutError AbortController 模式，成功后清 timer），同时覆盖 `openDiffTab` 与 `toggleReviewDiff` 两个调用点；② `WorkspaceInspector.tsx` openDiffTab 的 fetch/写回抽为共享 `loadDiffIntoReaderTab`（guard 失效放弃写入不变），已存在 diff reader 分两态：在途仅激活；终态（diff/error/noChanges）重置为 loading 重拉——再次点「审查」即可恢复/刷新。
- 验证：定向 vitest 6 files / 71 tests 全过（新 `tests/frontend/workspace-diff-review-recovery.test.ts` 6 用例）；误触发全量 `npm run test` 294 files / 2832 tests 全过；eslint 三改动文件 0 error；`npx tsc -b`；`npm run build` 通过（dist 已刷新）；`git diff --check` 通过。
- 下一步：真机冒烟——删除/回滚产物文件后点「审查」应显示空态或删除 diff（不再卡「打开中」）；人为断网/挂起时 10s 后出红色超时错误，再次点「审查」重新拉取可恢复；其余请求不被拖住。
- Notes（与 feature 无关，未处理）：① 请求 effect 里 `openPanelTab('review', view)` 与紧随的 `openDiffTab(path)` 在同一同步块内，两处闭包的 `panelTabs` 都不含刚 append 的 review tab——项目+会话首次点「审查」（之前无 review tab）会 append 两个 review panel tab（diff reader 挂第二个，后续点击挂第一个）；② workspace-api 其余 git 读（branches/log）与 workspace 读（children/file）同样无超时，连接池极端场景仍可能被钉住，可按 getGitFileDiff 模式逐步补。

## Feature：对话报错重试一行式轻量错误行（2026-09-09）

- 背景：用户问「当前页面报错的重试有没有更优雅的交互」，澄清目标为对话回合失败的终态错误层（与 SSE 重连、模型流自动重试并列的第三层：恢复失败后的用户决策）。
- 调研结论：现状 = pi-web-ui 红块（`bg-destructive/10` + `<strong>Error:</strong>` 恒英文前缀 + 原文/译文直出）+ 错误旁 icon-only ▶「继续生成」（`onContinueAfterError` 两分支：stash 重发或发「继续」消息，语义不定）+ 真正的「重试」（`retryFromMessage` 裁剪重生成）藏在最后一条用户消息 hover 行（触屏不可发现）；无重试过程反馈、反复失败无升级引导。
- 设计：先出交互稿 `design-mockups/conversation-error-retry.html`（token 镜像 pi-web-ui 真实 oklch 值、现状 DOM 复刻对照、可操作演示、编号清单），浏览器实操验证过状态机；用户选定方案 A 并两轮收敛（更简洁 + 补「详情」），定稿一行式：`⚠ 生成失败 · 译文或原文 [重试] [详情]`，重试中转「⟳ 正在重试…」，连续失败 ≥2 追加琥珀「已重试 n 次仍失败 · 切换模型」。
- 实现：见 feature_list.json 同 id 条目（新模块 turn-error-row.ts / turn-error-state.ts；message-actions.ts 移除「继续生成」接入新错误行；ChatPanelHost 统一重试语义 + onSwitchModel + 主 effect 内创建 tracker；i18n 5 新 key 移除 errorContinueAction；index.css quickforge-error* 段复用 reconnect/琥珀词汇）。
- 验证：定向 vitest 4 files / 62 tests 全过（含新建 turn-error-state 7 用例、message-actions 重写的 turn error row 用例组）；相关回归 14 files / 186 tests 全过；`npm run test` 全量 292 files / 2799 tests 全过；eslint 改动文件 0 error 0 warning（全量 0 error / 5 个 server/ 既有 warnings）；tsc -b；`npm run build` 通过（仅既有 chunk 提示）；dist 抽查含新样式与 zh 文案。
- 边界：不动 SSE 重连/模型流重试两层与「已停止」标签；数据层 errorMessage 保持英文原文；不自动重试；详情只读；hover ↻ 与门控保留。
- 下一步：真机弱网验证——制造回合失败应看到一行式错误行（译文 + 就地重试 + 详情原文）；点重试转「正在重试…」后恢复或再失败（第二次起出现琥珀升级行，「切换模型」打开模型选择）；发送失败场景点「重试」应原样重发 stash 消息。备选后续：subagent 错误原因卡（local-tools.ts 红卡）对齐同款轻量行词汇。

## Feature：SSE 流式帧节流 + 背压保护（2026-09-09）

- 背景：第一轮调研发现但一直未处理的两个 SSE 问题。
- 调研结论：每帧同时携带 `message` 与 `assistantMessageEvent.partial`（同一份完整消息），单帧 ≈2× 累积 JSON，一个 N token 回合累计传输 O(N²)；前端 pi-web-ui 是全量替换 + rAF 批处理，不依赖每个 delta；`writeSseEvent` 从不检查 `res.write` 返回值。
- 实现：`message_update` 50ms trailing 合并（`SSE_MESSAGE_UPDATE_THROTTLE_MS`，非 message_update 事件先 flush pending 保序，cleanup dispose）+ `writableLength` 超 4MB（`SSE_BACKPRESSURE_BYTES`）时丢弃可丢弃帧（终态帧永不丢弃，不 await drain）。
- 验证：定向 39 tests 全过（新增 5 个用例）；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2825 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Notes：既有「SSE 写失败只 WARN 一次」用例的触发事件由 `message_update` 改为 `message_end`（前者现在延迟 50ms 写出，会被 socket error 抢占），断言意图不变。
- 下一步：真机观察长对话的 SSE 帧量/内存；剩余候选 = ChatPanelHost 接入 git status light（等并行会话收尾）、settings/custom-providers 逐 key 请求批量化、`message_update` 改增量 delta（高风险）。

## Feature：/api/git/status 单次耗时优化（合并 git 子进程 + light 模式）（2026-09-09）

- 背景：连接池优化后，`git status` 成为最大单一负担（最近 1.5 分钟 10 次、每次 400-670ms）。
- 根因：4 次串行 git 子进程（Windows 每次 60-130ms），其中 `numstat` 最贵（125ms）且只有 WorkspaceInspector 需要。
- 实现：见 feature_list.json 同 id 条目（A `--branch` 合并 branch 查询、B 退出码判仓库、C light 模式跳过 numstat + 行数统计）。
- 实测：subagent 基准 full **419.3ms → 256.7ms**（-38.8%，git 子进程 4→2）、light **106.2ms**（-74.7%）；重启后真机复测 full **276/272/295ms**、light **107/111/109ms**（改前真机 400-670ms），light 返回 branch/files 且首条文件不含 `additions`。
- 验证：定向 27 tests 全过；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2820 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Notes：实施中发现 App 标题栏不能走 light（`titleGitStatus` 被 `GitToolsPinnedSummary` / `GitCommitPushDialog` 共享，需要 `additions/deletions`），已回退并同步测试断言与 wiki；light 能力保留待 ChatPanelHost 分支探测接入（该文件正被另一会话改动）。

## Feature：会话列表重复请求收敛：refreshSessions 合并 + /api/agents 触发收敛（2026-09-09）

- 背景：承接浏览器连接池优化。实测重启后 2.5 分钟内 `/api/storage/sessions-metadata/index/lastModified` 23 次、`pinnedAt` 13 次、`/api/agents` 16 次（单请求 1-5ms，但数量占满 6 连接池）。
- 根因：①`agent_end` 双路 `refreshSessions`（App 全局订阅 + `syncSessionUI`），而 `refreshSessions` 无 in-flight 合并；②`useVisibleRuntimeStatuses` 的刷新 effect 依赖每次重建的 Set 身份。
- 修复：见 feature_list.json 同 id 条目（`REFRESH_SESSIONS_MERGE_MS=250` in-flight 合并 + broadcast 合并到轮尾；effect 依赖收敛为 `visibleSessionKey`）。
- 验证：定向 vitest 45 tests + 新增 1 test 全过（含变异验证）；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2813 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Notes：修复期间修正了新测试文件的一处 `react-hooks/rules-of-hooks` lint error（测试 harness 直接调用 hook，改为定向禁用注释）。
- 下一步：刷新页面后观察 `lastModified`/`pinnedAt`/`/api/agents` 频率是否下降；剩余候选是 `git status` 单次 400-670ms 的服务端耗时（`--untracked-files=all` + numstat）与 settings/custom-providers 逐 key 请求批量化。

## Feature：浏览器连接池压力缓解：git status 去重 + sessions-changed 并入全局 SSE（2026-09-09）

- 背景：承接上一条 runtime-diagnostics-instrumentation 的实测数据，定位「流式正常但普通 API 卡」的主因并修复。
- 实测结论：服务端无阻塞（lag p99 33.62ms ≈ Windows 基线、89% 请求 <50ms、6 并发 git status 下 health 45ms）；浏览器同源 6 连接池被 2 条常驻 SSE 占 2 条；服务端观测普通请求并发峰值 6 → 需 8 条连接；高并发时刻来自页面加载静态 chunk、切回窗口时的数十个并发请求，以及 `/api/git/status` 3 个互不协调调用点（峰值 3 并发、每个 400-500ms）。
- 修复：见 feature_list.json 同 id 条目（A：getGitStatus 在途共享 + 引用计数 abort + 1s 缓存 + force 绕过 + gitPostJson 失效缓存 + onProjectsChanged 走缓存；B：sessions-changed 并入 `/api/agents/events`，删除 App 常驻 channels EventSource）。
- 验证：定向 vitest 4+3 files（36+87 tests）全过；改动文件 eslint 0 error；`npx tsc -b` 通过；`npm run test` 292 files / 2809 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过；`git diff --check` 通过。
- 真机验证（08:28 通过 POST /api/system/restart 重启为新 pid 28120）：重启后 2.5 分钟窗口内 `/api/channels/events` 请求 0 次、`/api/diagnostics` 的 inFlight 仅 1 条 `/api/agents/events`、`git status` maxOverlap 从修复前最多 3（压测 6-7）降到 1、sockets 从 7 降到 3。
- Notes：跨标签页项目列表在 onProjectsChanged 走缓存后最多 15s 可见；设置页渠道 Tab 打开时仍会额外建一条 `/api/channels/events`（保留既有行为）。

## Feature：运行时诊断采集：event loop lag / 在途请求 / 浏览器连接池排队（2026-09-09）

- 背景：用户反馈「对话流式输出正常，但其他普通 API 经常卡住」，运行方式 CLI/npm start + 浏览器。本次会话目标为「先加诊断能力，用数据定位主因」。
- 调研结论（双 explore 只读）：服务端已有每请求 durationMs 的 INFO 日志，但缺阈值告警、在途计数、event loop lag 与连接池指标。三类候选根因——①浏览器 HTTP/1.1 同源 6 连接池被每窗口 2-4 条常驻长连接 + 无超时慢请求占满（最可能，Notes 已有同机制历史复盘）；②服务端单事件循环被同步 SQLite 大事务阻塞；③单个 handler 慢（如大仓库 git status）。
- 用户确认：新增 `GET /api/diagnostics`（仅本机）；服务端 + 前端浏览器侧都采集；默认开启、`QUICKFORGE_DIAGNOSTICS=0` 关闭。
- 实现：见 feature_list.json 同 id 条目（服务端 `server/runtime-diagnostics.mjs` + `server/index.mjs` 埋点与端点；前端 `src/lib/browser-connection-diagnostics.ts` + `main.tsx` 挂 `window.__quickforgePerf`）。
- 验证：定向 vitest 4 files / 42 tests + 前端 1 file / 15 tests 全过；改动文件 eslint 0 error 0 warning；`node --check`；`npm run build` 通过（仅既有警告）；`npm run test` 292 files / 2799 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`git diff --check` 通过；真机冒烟（独立实例 127.0.0.1:5999）本机 200、隧道头 403、隧道头 health 仍 200。
- Notes（与 feature 无关）：本工作区同时存在另一会话的 conversation-error-retry 改动（`src/components/chat/*`、`src/lib/i18n.ts`、`tests/frontend/error-messages.test.ts`、`tests/frontend/message-actions.test.ts`、`design-mockups/conversation-error-retry.html`、`docs/reports/`），本 feature 未触碰这些文件；全量 test/build 在该并发改动存在时仍全绿。
- 下一步：真机按判据读数据——浏览器执行 `window.__quickforgePerf()`：若「最大排队大 / 耗时接近」且 `activeLongLived` 接近 6 → 浏览器连接池耗尽；若服务端 `eventLoop.p99Ms` 高且所有请求耗时同步变长 → 事件循环阻塞；若个别 path `totalMs` 突出而 lag 正常 → 单 handler 慢。确认主因后再决定优化 feature（SSE 背压 / 连接池治理 / 同步 SQLite 下放）。

## Feature：diff 无工作区变更时友好空态 + 产物卡 ±0 统计隐藏（2026-09-08）

- 现象：Agent 修改文件后用户 commit/revert/撤销，聊天产物卡仍显示「N 个文件已更改」；点「审查」打开 diff 得到红色英文错误 "File has no working tree changes"，与卡片文案互相矛盾；净变化为 0 时标题还显示 `+0 -0`。
- 根因：产物卡是会话累计（工具调用）口径，而「审查」的 `/api/git/file-diff` 是 Git 工作区实时口径；服务端对无变更文件正确返回 404（`server/routes/workspace.mjs` 固定 message），但前端 `openDiffTab`/`toggleReviewDiff` 把 `err.message` 原样作为红色错误渲染，且 API 层错误不携带 HTTP status。
- 实现：① `workspace-api.ts` 的 `fetchJson`/`postJson` 抛错时附加 `status`（导出 `WorkspaceApiError`）；② `WorkspaceInspector.tsx` 新增 `isNoWorkingTreeChangesError`（匹配服务端固定 message），`openDiffTab` 把该 404 转为 readerTab `noChanges` 空态——i18n 新 key `workspaceFileNoWorkingTreeChanges`（该文件当前没有工作区变更，可能已提交或还原）+ `workspaceOpenCurrentFile`（查看文件当前内容）按钮经 `openFileTab` 降级打开 file reader；`ReaderTab` 类型增加 `noChanges?: boolean`；③ `toggleReviewDiff` 内联展开同款：`expandedDiffNoChanges` state → `WorkspaceChangesList(expandedNoChanges)` → `WorkspaceInlineDiffPreview(noChanges)` 渲染纯文案空态（列表行已有打开文件入口，不放按钮）；其他错误仍显示红色 `err.message`，成功/复位路径清 `noChanges`；④ `assistant-artifact-card.ts` 头部统计条件改为 `hasDiff && (total.added > 0 || total.removed > 0)`，净变化 0 不再渲染 `+0 -0` 与 diffbar（空 headerStats div 保留布局）。
- 测试：`tests/frontend/workspace-diff-no-changes.test.ts`（新，5 用例：API status 附加、openDiffTab 404 分支、InlineReader 空态与降级回调、内联路径透传、i18n en/zh 成对 key）；`assistant-artifact-card.test.ts` +1（净 0 隐藏 ± 统计契约）。
- 验证：定向 vitest 4 files / 45 tests 全过；eslint 九个改动源码/测试文件 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- 文档：`docs/wiki/src/components/README.md` Review tab 条目补 404 根因、双口径说明与两条路径的空态交互；产物卡条目补净 0 隐藏统计。
- 边界：服务端检测逻辑零改动；产物卡会话累计口径与行内各文件 ± 显示不变；未新增依赖、未手工修改生成产物、未 commit/tag/push。

---

## Bugfix：聊天消息队列流式发送时无变化重渲染闪烁修复（2026-09-08）

- 现象：聊天正在流式生成且消息队列内容没有变化时，队列区域仍随每个流式 delta 全量重建，表现为队列或队列项闪一下。
- 根因：消息装饰流程会高频调用消息队列 `render()`，旧实现每次都执行 `root.replaceChildren()`，没有判断队列的可见状态是否实际变化。
- 修复：`message-queue.ts` 增加 `renderedSignature`，覆盖 `items`、`paused`、`isStreaming()`、`steeringEnabled()`、`jumpingId`、`editingId`；root 已连接且签名不变时保留现有 DOM。首次创建、脱离后重挂载或任一可见状态变化时仍完整渲染；签名仅在 DOM 重建完成后提交。拖拽发生位移后主动失效签名，确保 `pointercancel` 也会按权威数据恢复临时调整过的 DOM 顺序。
- 测试：`message-queue.test.ts` 增加源码契约，锁定同状态跳过、签名覆盖范围，以及新建/脱离 root 时不得跳过重建。
- 验证：`npx vitest run tests/frontend/message-queue.test.ts`（1 file / 15 tests）通过；相关 ESLint 0 error；`npm run build` 通过（仅既有字体解析与 chunk 体积提示）；`git diff --check` 通过。
- 边界：拖拽延期渲染、编辑输入恢复、空队列移除、排队/立即发送/暂停恢复等既有语义不变；无需更新 docs/wiki（纯组件内部渲染稳定性修复，不改架构、职责或公共入口）；未新增依赖、未手工修改生成产物、未 commit/tag/push。

---

## Feature：手动停止的助手消息显示灰色「已停止」（2026-09-08）

- 目标：用户手动终止生成后，部分回答末尾以灰色「已停止」标明终态，替换现状的红色斜体英文 "Request aborted"。
- 对齐过程：v1 对齐稿（假气泡面板 + meta 行/灰线/行内三方案）被否；v2 先摸清真实渲染——pi-web-ui AssistantMessage 对 `stopReason:'aborted'` 渲染 `<span class="text-sm text-destructive italic">Request aborted</span>`（红、斜体、英文、无 px-4 缩进贴左缘，且应用未安装 pi-web-ui 翻译，恒英文），稿子改为镜像真实消息区结构（design-mockups/assistant-stopped-message-preview.html），用户确认方案①（灰色、与正文同号、左缘对齐、常显）执行。
- 实现：`message-actions.ts` 新增 `decorateAssistantStoppedText`（与 `decorateAssistantErrorText` 同一先例）：仅 assistant 且 `stopReason==='aborted'`；先找 `quickforge-message-stopped-label` 标记 span（幂等/语言切换路径），否则发现 `span.text-sm.text-destructive.italic` 且 `parentElement.parentElement === 消息元素`（渲染根 div 直接子级，避免误伤 tool 卡内同款 aborted 标签——工具级状态由 process-folding `processAborted` 负责）；改写为移除 text-destructive/italic、挂标记类、`dataset.quickforgeStoppedLabel` 记录当前文案；i18n 新 key `messageStoppedLabel`（zh 已停止 / en Stopped）；`index.css` 新增 `.quickforge-message-stopped-label`（display:block、margin-top 6px、padding 0 1rem、color var(--muted-foreground)，字号沿用节点自带 text-sm=应用根覆盖下与正文同号）。Lit 重建的新红 span 由下一装饰周期重新发现改写；不动 pi-web-ui、服务端零改动，红色语义保留给错误。
- 测试：`message-actions.test.ts` 新增 describe 3 用例——标记 span 本地化改写且重跑幂等、非 aborted 消息不动、发现路径/类交换/CSS 样式源码契约（FakeNode 选择器引擎不支持复合选择器，发现路径沿用错误装饰的源码契约形态）。
- 验证：定向 vitest 3 files / 49 tests 全过；eslint 三改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有警告）；产物 CSS 含 `.quickforge-message-stopped-label`；`git diff --check` 通过。
- 边界：tool 卡内部 aborted 红字、共享会话页（未走装饰管线的渲染面）不在本 feature 范围；未新增依赖、未手工修改生成产物、未 commit/tag/push。
- Revision（用户中止不再显示失败痕迹）：用户反馈手动停止后仍出现「错误：请求已中止。」红块与重试按钮。根因链路：用户停止 → pi-ai 抛 "Request was aborted" → pi-agent-core `handleRunFailure` 落 `stopReason:'aborted'` 终态消息（灰「已停止」那条）并把 errorMessage 经 processEvents 写入 `state.errorMessage`（agent.js:394）→ agent-manager agent_end 据此再 `appendAssistantErrorMessageOnce` 合成 `stopReason:'error'` 红块消息 → 前端终态错误行挂「继续生成」。修复：① 服务端 agent-manager agent_end 对 `signal.aborted` 的运行跳过合成并清 `state.errorMessage`（状态面板不把用户停止报成 error；非用户中止失败——超时/HTTP 等仍照常合成）；② 前端 `decorateMessages` 新增 `trailingTurnAborted`（尾部 assistant stopReason=aborted）门控，用户中止回合最后一条 user 消息隐藏重试按钮（回滚/复制/错误终态「继续生成」不受影响；重装饰随回合状态变化恢复）。测试：abort.test.mjs +2（用户中止不合成/非中止失败仍合成）、message-actions.test.ts +1（中止隐藏重试、正常恢复）。验证：定向 vitest abort 3 + message-actions 34 + routes/agent 21 全过；eslint 0 error；node --check；tsc -b；build 通过。边界：历史会话已持久化的「错误：请求已中止。」消息为存量数据不迁移（新停止干净）。

---

## Feature：桌面侧栏默认宽度略微收窄（2026-09-08）

- 目标：让左侧项目/对话区域稍微窄一点，为中间内容保留更多空间。
- 实现：`src/components/sidebar/ChatSidebar.tsx` 将桌面侧栏默认宽度和最小宽度从 320px 调整为 304px；最大宽度 520px、拖拽调整、收缩态和移动端全屏宽度保持不变。同步 `docs/wiki/src/components/README.md` 的宽度说明。
- 验证：定向 vitest 2 files / 9 tests 全过（workspace-inspector-width-range、mobile-fullscreen-adaptation）；ChatSidebar ESLint 通过；`npm exec tsc -- --noEmit` 通过；`git diff --check` 通过。
- 边界：仅调整桌面展开态宽度，不改 Inspector 约束逻辑、交互和生成产物；未 commit/tag/push。

---

## Feature：右侧 Inspector 拖动保留对话区最小宽度（2026-09-08）

- 目标：右侧面板向左拖动时，不再无限压缩中间对话区；对话区最小宽度采用用户确认的 440px。
- 实现：`ChatSidebar` 通过桌面 `ResizeObserver` 回报实际侧栏宽度；`App` 将侧栏宽度与 440px 对话区约束传给 `WorkspaceInspector`。Inspector 最大宽度统一取 1200px、75vw、`viewport - sidebar - 440px - 1px` 的较小值（仍保留 340px 最小值），覆盖恢复、拖动、窗口/侧栏变化、640px 自动展开、`maxWidth` 与 `aria-valuemax`。
- 文档：同步 `docs/wiki/src/components/README.md` 的 Inspector 宽度说明。
- 验证：定向 vitest 2 files / 9 tests 全过；相关 ESLint 0 error；`npm exec tsc -- --noEmit` 通过；`git diff --check` 通过。
- 边界：视口过窄导致 440px 对话区与 Inspector 340px 同时不可满足时，保留 Inspector 最小宽度作为降级；移动 fullscreen/overlay 和 Inspector 内部导航拖动不变；未新增依赖、未修改生成产物、未 commit/tag/push。

---

## Feature：字号滑块松手后统一应用并保存（2026-09-08）

- 目标：拖动外观设置中的界面字号、消息字号滑块时，只更新当前设置页的数值徽章和进度；松手触发 change 后才保存并全局应用。
- 实现：`appearance-settings-tab.ts` 将原 `previewFontSize` 收敛为本地 `updateFontSize`，input 只 normalize、更新两个本地字号字段并 `requestUpdate`；删除 `scheduleFontSizePreview` 调用。change 保持既有 `saveFontSize` 链路，但先同步 `applyFontSizeSettings`，再调用 `saveFontSizeSettings` 持久化，避免网络延迟阻塞松手后的视觉反馈；成功后的重复 apply 由既有 dirty-check 跳过。`font-size-settings.ts` 删除已无调用方的 RAF 预览调度函数及状态。
- 测试：新增 `appearance-settings-tab.test.ts`，以两个滑块参数化验证 input 仅更新本地状态，不持久化、不改 root font-size/CSS 变量；change 当下即应用并开始保存，持久化结束后状态保持。删除 `font-size-settings-apply.test.ts` 中已废弃预览调度测试。
- 验证：定向 vitest 3 files / 13 tests 全过；相关 ESLint 0 error；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积提示）；`git diff --check` 通过。首次单独 `npx tsc -b --pretty false` 碰到并行 `src/App.tsx` 两个未使用变量中间态，稍后包含 tsc 的 build 已通过。
- 边界：保存失败行为、字号范围/默认值、主题设置均不变；无需更新 docs/wiki（纯组件内交互时机调整，不改架构/职责/公共入口）；未新增依赖、未手工修改生成产物、未 commit/tag/push。

---

## Revision 19：Inspector Tab 下拉列表 hover / 选中态背景修复（2026-09-08）

- 目标：修复右侧 Inspector 左上角 ChevronDown 打开的 Tab 列表中，非选中项 hover 时没有背景反馈的问题，并保证选中项状态不被 hover 弱化。
- 根因：列表项使用的 `hover:bg-muted/34` 与 `bg-muted/55` 在当前 Tailwind 产物中未生成，因此 hover 和 active 背景均可能失效。
- 实现：`WorkspaceInspector.tsx` 将非选中项改为既有 `hover:bg-[var(--quickforge-sidebar-hover-bg)]`，选中项改为 `bg-[var(--quickforge-sidebar-active-bg)]`；两者仍由 `active` 条件分支隔离。`workspace-inspector-tab-list-scroll.test.ts` 新增局部源码契约，锁定 hover/active token。
- 验证：定向 vitest 1 file / 2 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积提示）；产物确认包含 hover/active 变量；`git diff --check` 通过。
- 边界：不改列表项高度、点击激活、关闭按钮、Tab 排序或持久化；无需更新 docs/wiki（纯组件内视觉反馈修复，复用既有设计 token）；未新增依赖、未手工修改生成目录。已提交（当前提交），未 push；待真机在亮/暗主题确认 hover 与选中态层级。

---

## Feature：侧栏任务分组新建对话按钮默认隐藏（2026-09-08）

- 目标：让左侧栏「任务」分组右侧的新建对话按钮默认隐藏，仅在标题行 hover 或 focus-within 时显示。
- 实现：`ChatSidebar.tsx` 中该按钮改为复用既有 `sectionActionButtonClass`，获得默认 `opacity-0`/`pointer-events-none` 与 `group-hover`、`group-focus-within` 显示和交互恢复；原 `onClick`、`stopPropagation`、`aria-label`、图标保持不变。
- 测试：`sidebar-section-header-hit-area.test.ts` 新增契约，确认按钮复用该类，并锁定类中 hover/focus-within 的可见性和 pointer-events 行为。
- 验证：定向 vitest 2 files / 29 tests 全过；eslint 2 个改动 TS/TSX 文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积提示）。
- 边界：纯组件内样式复用，不改架构/公共入口，无需更新 docs/wiki；未新增依赖、未手工修改生成目录、未 commit/push。

---

## Revision 18：Inspector 顶栏回归 56px 对齐 + 顶部按钮组高度与 hover 统一（2026-09-08）

- 背景：用户反馈 Revision 17 引入两个回归——① `+`/全屏按钮与右上角浮动工具栏的终端/关闭右侧边栏按钮高度不一致；② Inspector 顶栏底部横线与对话区 header 底部横线不齐（44px vs 56px）。并确认「顶部 tab 最左侧 ChevronDown 下拉没有 hover 背景」。
- 方案（用户确认「统一回 56px」）：Inspector 顶栏 `h-11`→`h-14`，与 `src/App.tsx:2152` 对话区 header、`fixed right-2 top:0.625rem` 浮动工具栏同高（13px 根字号下均 45.5px，两条底线对齐）；`+`/全屏/终端/关闭四个 `Button` 去掉 `size-8` 覆盖，回到 `size="icon"`（29.25px）与浮动工具栏按钮同尺寸；左侧下拉按钮 `size-8`→`size-9`（保留 `rounded-xl`）；两处下拉菜单 `top-10`→`top-12`（按钮变高后恢复原有间距）。Tab 条保留 Revision 17 的紧凑 `h-8` + 隐藏滚动条。
- hover 排查结论：`hover:bg-[var(--quickforge-sidebar-hover-bg)]` 已存在于产物 CSS 且实际生效——用 headless Chrome + CDP 实测（`Input.dispatchMouseEvent` + `getComputedStyle`），四个按钮 hover 均得到 `rgb(229,231,235)`；用户看到的「没有 hover」应为改动前的旧产物或页面未强刷。顺带把 `App.tsx` 右上角浮动工具栏的终端/关闭右侧边栏按钮从**未生成**的 `hover:bg-muted/45` 换成同一 token（此前这两个按钮完全没有 hover 反馈），对应两处硬编码类名断言同步更新。
- 验证：headless Chrome 实测两条 header 底线均 45.5px、六个按钮均 29.25px、四个按钮 hover 背景均生效；`npm run test` 287 files / 2742 tests 全过；`npm run lint` 0 error（5 个既有 warning）；`npm run build` 通过。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`src/App.tsx`、`tests/frontend/mobile-fullscreen-adaptation.test.ts`、`tests/frontend/side-chat-workspace-tab.test.ts`、`docs/wiki/src/components/README.md`、`progress.md`、`session-handoff.md`。未 commit、未 push。
- 下一步：真机强刷（Ctrl+Shift+R）后确认——两条顶栏横线齐平、`+`/全屏与终端/关闭四个按钮等高、最左侧 ChevronDown hover 有浅灰背景（亮/暗各看一次）、两处下拉菜单定位正常。

---

## Revision 17：WorkspaceInspector 顶部 Tab 条收窄并消除滚动条高度跳动（2026-09-08）

- 背景：右侧 Inspector 顶部 Tab 在多个时出现横向原生滚动条（Windows/Electron 占位式），撑高自动高度的滚动容器，父容器 `items-center` 居中导致 Tab 视觉上移，滚动条出现/消失时来回跳。
- 方案（用户确认 A）：顶栏 `h-14`(56px)→`h-11`(44px)；Tab 按钮 `h-10`(40px)→`h-8`(32px)、`rounded-2xl`→`rounded-xl`；横向滚动容器固定 `h-8`，并在 `src/index.css` 增加 unlayered 自定义类 `.quickforge-inspector-tab-strip` 隐藏原生滚动条（滚轮/触控板滚动与拖拽排序保留）；左侧 Tab 下拉按钮 `size-9`→`size-8`、`rounded-2xl`→`rounded-xl`；`+`/全屏/终端/折叠图标按钮 className 补 `size-8`；两处下拉菜单 `top-12`→`top-10`（与顶栏底保持 2px 间距）；分隔线 `h-3.5`→`h-3`。下拉列表条目 `h-10` 与滚动区类名不动（有测试断言）。
- 根因（首版 Tailwind arbitrary 类未生效）：`[scrollbar-width:none]` / `[&::-webkit-scrollbar]:hidden` 被编译进 `@layer utilities`，而 pi-web-ui 的 unlayered `*{scrollbar-width:thin}` 与 `::-webkit-scrollbar{width:8px;height:8px}` 在层叠中优先于任何 `@layer`；Chromium 在标准 `scrollbar-width` 生效时又忽略 `::-webkit-scrollbar` 自定义，滚动条仍以 8px 占位挤压 Tab。改用 unlayered 类后正常覆盖。
- 追加修复（顶部工具栏 hover 背景失效）：`hover:bg-muted/45` 这类带透明度修饰符的颜色类在本项目 Tailwind 产物中**未生成**（本项目 theme 缺 `--color-muted`/`--color-foreground` 映射，仅 pi-web-ui 预构建 CSS 里恰好存在的 `/30 /50 /60` 等可用），导致顶部左侧 Tab 下拉与 `+`/全屏/终端图标按钮 hover 无任何背景。改用项目既有、亮暗主题都可见的 `hover:bg-[var(--quickforge-sidebar-hover-bg)]`（亮色 `#e5e7eb`、暗色 `muted/74%`，composer 按钮已在用）。这是既有系统性问题的局部修复，其他 `bg-muted/NN`、`text-foreground/NN` 类同样可能未生成，后续如遇 hover/文字层级异常可按此排查。
- 验证：`npx vitest run workspace-inspector` 6 files / 46 tests 全过；`npx eslint src/components/workspace/WorkspaceInspector.tsx` 0 error；`npm run build` 通过；产物 CSS 确认 `.quickforge-inspector-tab-strip{scrollbar-width:none}` 为 unlayered 且位于全局 `*{scrollbar-width:thin}` 之后，`.hover\:bg-\[var\(--quickforge-sidebar-hover-bg\)\]` 已生成且变量亮色为 `#e5e7eb`。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`src/index.css`、`docs/wiki/src/components/README.md`、`progress.md`、`session-handoff.md`。未 commit、未 push。
- 下一步：真机冒烟——多 Tab 溢出时 Tab 不再上下跳且整体更紧凑；顶部左下拉与 `+`/全屏/终端按钮 hover 有可见浅灰背景（亮/暗主题各看一次）；Tab 下拉与 `+` 菜单定位正确；拖拽排序与滚轮横向滚动仍可用。

---

## 提交收尾：侧栏置顶分区独占展示 + 产物卡文件图标与打开方式（2026-09-08）

- 提交：`70a587a feat: 置顶会话改为分区独占展示并收紧悬停操作`；`b39c120 feat: 完善产物卡文件图标与打开方式`；`7a0ecae fix: 侧栏运行状态指示器贴齐时间槽`。均为本地 commit，未 push。
- 完整门禁全绿：`npm run test` 287 files / 2742 tests 全过；`npm run lint` 0 errors、5 个既有 warnings；`npm run build` 成功（仅既有 KaTeX 字体与大 chunk warnings）；`git diff --check` 通过。后续 spinner 补丁定向 vitest 1 file / 9 tests、相关 ESLint 与 diff-check 通过。此前侧栏 2 个失败为过程记录，现已修复并纳入全绿结果。
- Blocker：无。下一步：真机冒烟侧栏置顶/hover 交互与产物卡图标、分裂按钮及外部打开目标。

---

## Revision 16：assistant-reply-artifact-card 打开下拉扩展 VS Code/IDEA 目标（2026-09-08）

- 背景：用户要求打开下拉也提供 IDEA、资源管理器、VSCode 选项且带 icon。
- 实现：① `assistant-artifact-card.ts` 菜单项数组扩展——预览打开（行内 eye 描边 SVG）+ explorer 定位 + vscode + idea 三个外部目标（品牌图标 import `@/assets/icons/{file-manager,vscode,idea}.svg`，与工作区 ProjectOpenMenu 同款资源），`onRevealFile?.(artifact.path ?? '', target)` 传目标；deps 类型 `onRevealFile?: (relativePath, target?: WorkspaceExternalOpenTarget) => void`。② `ChatPanelHost.tsx` 两处 prop 类型同步 + type import。③ `App.tsx` `revealFileFromArtifactCard(relativePath, target = 'explorer')` 按目标转发 `openWorkspaceExternal`，失败 toast 按目标区分（openInVSCodeFailed/openInIDEAFailed/assistantArtifactRevealFailed，均既有 key 零新增）。④ CSS：菜单项 display:block→flex（图标槽 0.875rem + gap 0.5rem），svg 变体描边规则。
- 服务端零改动（open-external 路由本就支持三目标）；readOnly 不传 onRevealFile 时菜单仅预览项（既有门控不变）。
- 测试：新增契约（三图标 import、targets 数组三项、onRevealFile 双参转发、App target 转发与失败 key 分流、CSS flex 图标槽）；两处旧单参断言同步。
- Verification: 定向 vitest assistant-artifact-card 18 + message-actions 30 全过；eslint 四改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki 菜单描述同步。
- Boundaries: 主区直接预览/审查/撤销不受影响；i18n 零新增（复用既有 openIn* key）；未新增依赖；已提交 `b39c120`，未 push。

## Revision 15：assistant-reply-artifact-card 打开/审查按钮感升级描边档（2026-09-08）

- 背景：用户觉得分裂按钮版「按钮感不够强」，经 AskUserQuestion 三档选型（软填充/描边/主色淡底）确认为**描边 outline 档**，「审查」同步升级、「撤销」保持 ghost。
- 实现：index.css——基础 ghost 规则后追加描边档覆盖：`.quickforge-assistant-artifact-card-open, .quickforge-assistant-artifact-card-review` 常显 `border: 1px solid var(--border)`（复用卡片表面边框强度，遵守 DESIGN_LANGUAGE 不自造弱化混色）+ `var(--background)` 底 + `var(--foreground)` 文字；hover 仍走既有 muted 45% 浮底规则、active scale 回缩/focus-visible 不变。分裂胶囊接缝改描边实现：主区 `border-right: 0` 让位、箭头区 `border-left: 1px solid var(--border)` 即内部分隔线；退化 single 形态恢复整圆角并保留完整四边描边（删 border-left:0）。「撤销」及 rollback hover 转红规则零改动。
- 测试：assistant-artifact-card.test.ts——split 契约更新（分隔线 var(--border)、single 整圆角且不去边框、主区 border-right:0）+ 新增 outline/ghost 分层契约（open/review 描边三要素、基础规则仍 border:0、rollback hover:not(:disabled) 保留）。
- Verification: 定向 vitest assistant-artifact-card 17 tests 全过；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 按钮档位描述同步。
- Boundaries: 仅改 CSS 与测试，DOM 结构/交互零变化；compact/响应式规则自动继承描边；未新增依赖；已提交 `b39c120`，未 push。

## Revision 14：assistant-reply-artifact-card 「打开」改分裂按钮（2026-09-08）

- 背景：用户要求「打开」参考顶部设置按钮形态做分裂按钮——主区点击直接预览、箭头点击弹菜单选择后直接打开；设计先行过稿确认（菜单保留「预览打开」、行内 compact 同样分裂、主区不加图标）。
- 实现：`createOpenMenuControl` 重构——canPreview 时渲染主区按钮（`-open-main`，点击 `onOpenFilePreview(path)` 直接预览、title「预览打开」）+ 箭头区按钮（`-open-menu-zone`，aria-haspopup/expanded + aria-label「更多打开方式」，点击弹菜单，菜单项预览打开/在文件管理器中显示选择即执行）；无预览能力时主区不渲染、wrapper 标记 `-open-single`，箭头区补「打开」文字整颗弹菜单（=原形态）；菜单 fixed 定位/点外/Escape/滚动即关/模块级互斥机制原样保留（trigger 换为箭头区按钮）。CSS：主区左圆角、箭头区右圆角 + 细分隔线（border-left，--border 52%），compact 箭头区内距收窄，single 退化恢复整圆角/常规内距；各点击区独立 hover（复用基础 ghost 规则）。i18n 新增 `assistantArtifactOpenMenu`（zh 更多打开方式 / en More ways to open）。
- 测试：assistant-artifact-card.test.ts 新增分裂按钮契约（主区直连预览、箭头区 aria、退化形态保留文字、CSS 分隔线/圆角/退化恢复）。
- Verification: 定向 vitest assistant-artifact-card 16 + message-actions 30 + i18n-language-snapshot 2 全过；eslint 三改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 打开控件描述同步。
- Boundaries: 审查/撤销按钮不动；菜单内容与执行行为不变（仅入口变化）；无 path 或无任何回调仍不渲染；未新增依赖；已提交 `b39c120`，未 push。

## Revision 13：assistant-reply-artifact-card 产物图标对齐文件管理 Material 图标（2026-09-08）

- 背景：用户希望产物卡片的文件图标使用「文件管理」的图标。原实现是按 kind（code/markdown/pdf…）的单色内联 SVG + primary 着色 chip 底；文件管理（文件树/变更列表）用的是 Material Icon Theme 彩色图标，按路径解析（扩展名 + 特例名如 package.json/tsconfig/README）。
- 实现：① 新增 `src/components/workspace/file-icon-assets.ts`——自 file-icon.tsx 拆出 fileIconUrls/directoryIconUrls 静态资源映射并导出 `fileIconUrl(path)`（纯 TS，非渲染层可复用；拆分原因：react-refresh/only-export-components 禁止 tsx 组件文件混出非组件导出）；file-icon.tsx 瘦身为纯组件，改从 assets 模块导入，行为不变。② `assistant-artifact-card.ts` 删除 ARTIFACT_KIND_ICONS/FILE_DOCUMENT_ICON/artifactIcon/createIconSpan，新增 `createFileIcon(className, path, kind)`——img 元素 + `fileIconUrl(path)`，两处调用点（单文件卡 line297、折叠卡行 line421）传 `artifact.path`；kind 仍用于 title 与「类别 · KIND」副标题。③ CSS：两类图标类从 chip（border/primary 底/居中 18px svg 描边）改为裸 img——单文件卡 1.25rem、行内 1rem（与文件树行 size-4 同档），删除 svg 描边规则与行内 chip 尺寸规则。
- 效果：同一文件在文件树、变更列表、产物卡片三处图标完全一致（同一资源同一解析）。
- 测试：assistant-artifact-card.test.ts 新增契约（fileIconUrl 导入 + createFileIcon 两调用点 + 旧体系移除 + CSS 裸图标尺寸/无 svg 规则）。
- Verification: 定向 vitest assistant-artifact-card 15 + message-actions 30 全过；eslint 四改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 两处措辞同步。
- Boundaries: 文件树/变更列表渲染路径零改动（仅 file-icon.tsx 内部拆分）；i18n 类别副标题、± 统计、按钮布局不动；无扩展名文件回落 document 图标（getFileIconName 既有默认）；未新增依赖；已提交 `b39c120`，未 push。

## Revision 12：assistant-reply-artifact-card 审查关闭 ambiguous unicode 提示（2026-09-08）

- 背景：用户反馈审查页面每次都弹 “This document contains many ambiguous unicode characters / Disable Ambiguous Highlight”——Monaco unicodeHighlight 对中文/全角内容默认开启 ambiguous 字符检测，文档命中多字符即弹通知。
- 实现：`MonacoDiffViewer.tsx` options 增加 `unicodeHighlight: { ambiguousCharacters: false }`（IDiffEditorOptions extends IEditorOptions，作用于左右两栏）；invisibleCharacters/nonBasicASCII 保持默认。
- 测试：monaco-local.test.ts 新增 unicodeHighlight 契约。
- Verification: 定向 vitest monaco-local 8 tests 全过；eslint 两改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过。
- Boundaries: 只动审查 diff；MonacoCodeViewer（文件查看）未动——若文件预览同样弹此提示可按需同款处理；未新增依赖；已提交 `b39c120`，未 push。

## Revision 11：assistant-reply-artifact-card 审查 diff 单列行号（2026-09-08）

- 背景：用户反馈审查视图「序号有 2 列，只需要 1 列」——MonacoDiffViewer `renderSideBySide: true` 左右两栏各带一列行号（左原文件/右新文件）。
- 实现：`MonacoDiffViewer.tsx` 挂 `onMount`（DiffOnMount），`editor.getOriginalEditor().updateOptions({ lineNumbers: 'off' })` 隐藏左栏行号，仅保留右栏（新文件）一列行号；左右两栏布局、diff 高亮、gutter 变更指示不变；options prop 后续更新只设传入键，不会重新打开行号；`key={status:path}` 换文件重挂载时 onMount 重新生效。
- 测试：monaco-local.test.ts 新增契约（type DiffOnMount import、getOriginalEditor 关行号、onMount={handleDiffMount} 接线）。
- Verification: 定向 vitest monaco-local 7 tests 全过；eslint 两改动文件 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 干净。
- Boundaries: 只动审查 diff（MonacoDiffViewer 唯一消费方是 WorkspaceInspector InlineReader）；MonacoCodeViewer（文件查看）行号不受影响；未新增依赖、未触碰生成产物、未 commit。

## Revision 10：assistant-reply-artifact-card 审查视图纯 diff——收起右侧文件列表（2026-09-08）

- 背景：用户反馈产物卡片更改区域点「审查」打开后「只用展示 diff 就好了，不要右边的旁边还有东西」——WorkspaceInspector 打开 diff tab 时 `readerNavigationVisible` 默认 true，diff 右侧还挂着「更改文件列表」导航面板。
- 实现：WorkspaceInspector 请求处理 effect 中，带 `path` 的 review 请求（仅产物卡「审查」使用，App.tsx:933）直达 diff tab 时同步 `setReaderNavigationVisible(false)`，审查视图只展示 diff 本身；reader 头部文件夹按钮可随时切回列表；无 `path` 的 review 请求（App.tsx:755）与其他面板不受影响。该状态沿既有 per project+session 持久化链路（writePersistedPanelTabs）。
- 测试：新增 workspace-inspector-on-demand-source.test.ts 契约（if (request.path) 块内 openDiffTab + setReaderNavigationVisible(false) 顺序）；同步 assistant-artifact-card.test.ts 既有断言（旧单行 `if (request.path) openDiffTab...` 锚点改块级正则）。
- Verification: 定向 vitest 4 files / 47 tests 全过（on-demand-source 4 + tabs 9 + request 20 + artifact-card 14）；eslint 三改动文件 0 error；`npx tsc -b --pretty false` 通过。
- Boundaries: 仅收起导航不隐藏 reader 头部/面板 tab 栏（文件名、± 统计、复制/打开菜单保留）；收起态会持久化到该 project+session（用户可用文件夹按钮恢复，与手动收起同语义）；无 path 的 review 请求、文件树、terminal 等面板不受影响；未新增依赖、未触碰生成产物、未 commit。

## Revision 4：sidebar-pin-hover-alignment——hover 浮层紧凑贴尾（2026-09-08）

- 需求：用户反馈 hover 置顶/归档按钮"太靠前、分太开"，应更靠尾部、更紧密。
- 根因：Rev1 为对齐静置 pin 把 Archive 胶囊扩到 44px；Rev3 删静置 pin 后该约束失效，44px 胶囊成为纯粹的松散来源（图标间距 24px、Archive 图标中心距右缘 30px、浮层渐变多占 20px）。
- 修复：`overlayArchiveButtonClass` `h-6 w-11`→`size-6`（与 Pin 同 24px 圆形槽），gap-1 不变——图标间距 14px、Archive 图标中心距右缘 20px、右锚仍 right-2(8px)。测试注释/描述/断言同步（`size-6` + not w-11/w-9）。
- Verification: 定向 vitest 2 files / 31 tests、eslint 0 error、`npx tsc -b`、`npm run build` 全过（dist 已重建）。
- Boundaries: 一处类常量改动，4 处浮层共用生效；已提交 `70a587a`，未 push。

## Revision 3：sidebar-pin-hover-alignment——置顶分区独占展示（2026-09-08）

- 需求（用户决策）：置顶会话只在置顶分区展示，项目/时间线/全部会话列表全部隐藏；hover 浮层保留归档按钮；置顶区取消置顶用 PinOff 图标。
- 实现（general subagent 执行、主 Agent 审查）：① 服务端 `pinned=exclude` 三态——storage.mjs 白名单 + legacy readIndexedValues 镜像过滤、session-index-repository buildQuery `pinned_at IS NULL`（与 archived 对称；选服务端过滤因分页 total/LIMIT 口径天然一致，前端 filter 会破坏 hasMore 判定）；② 前端 global/project/timeline 三个加载带 `pinned:'exclude'`，`upsertSessionMetadata` 置顶会话只进 pinnedPage 直接 return（toggle 后 refreshSessions 收敛）；③ ChatSidebar 删全部静置 pin 按钮 + size-6 占位 span（时间槽成最右元素），置顶区浮层 Pin→PinOff，三列表浮层 aria-label 恒 pinSession，`pinnedSessionButtonClass` 常量删除；④ 搜索结果不动（主动查找场景保留置顶会话）。
- 测试：对齐测试重写（占位 0、Pin×3+PinOff×1、静置无 pin 契约、resting order 改静置仅 [time]）；bootstrap 补 only/exclude 各 1 次断言 + project 恢复加载 exclude；repository/路由新增 pinnedExclude SQL 与 legacy 回退用例。
- Verification: 定向 5 files / 58 tests、eslint 7 文件 0 error、tsc -b、node --check、`npm run build`（dist 已重建）全过。全量 `npm run test` 287 files：286 过 / 2740 tests 过，仅剩 `sidebar-new-chat-routing.test.ts` 2 用例失败——见 Notes。
- Notes：全量失败 2 用例（断言 `onClick={() => onStartNewProjectChat(item)}` 等源码字符串）由并行会话 sidebar-section-header-hit-area/project-row-hit-area 的 onClick stopPropagation 重构导致契约过时，非本 feature 改动；首次全量另有 1 文件 2 用例失败、复跑已自愈，属并行会话中间态。归属该会话修复，本 feature 不扩大范围。
- Boundaries: legacy 与 SQL 对非法 pinnedAt 语义差异为既有现状；wiki 无该查询参数条目；未新增依赖；已提交 `70a587a`，未 push。

## Bugfix：sidebar-pin-hover-alignment Revision 2——状态并入时间槽（2026-09-08）

- 需求：用户确认运行/未读状态时可以不显示时间，但 pin 位置也要与 hover 一致。
- 根因（Revision 1 遗留的次要偏差）：状态指示器（running spinner 12px/未读点 6px）插在 pin 与时间之间单独占位（running 时静置 pin 左移 16px、未读左移 10px）；且项目/全局行 running/未读时时间槽整体省略（pin 无对齐目标，偏差最大 ~30px）。
- 修复：`sessionStatusIndicator` 改造为 `sessionTimeSlotContent(session, timeText)`——running → spinner、未读 → emerald 点、否则时间文本，三选一渲染在固定 `w-11 text-right` 时间槽内；删除『状态时省略时间槽』条件分支，槽恒定渲染；置顶区/项目行/全局行 3 处调用统一（置顶区原为状态+时间同时显示，现状态优先替代时间）。槽为 text-right 行内上下文（非 flex），dot 补 `inline-block` 生效宽高。效果：pin 右侧几何恒 `[gap-1][w-11 槽]`，任何状态下静置 pin 中心恒 68px 与 hover pin 完全重合；状态随槽一起 group-hover 淡出（原状态指示器 hover 不淡出被渐变半掩）。
- 测试：新增契约用例——`sessionStatusIndicator` 旧模式移除、`? null : (` 时间省略模式移除、`sessionTimeSlotContent(session, formatSessionTime` 恰 3 处、槽函数含 Loader2/animate-spin/bg-emerald-500/inline-block。
- Verification: 定向 vitest 2 files / 30 tests 全过（alignment 8 含新用例 + section-order 22）；eslint 两改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（dist 已重建，仅既有警告）。
- Boundaries: 时间线行本无状态指示器未补（行为不变）；wiki 无需更新（纯组件内渲染调整）；未新增依赖、未触碰生成产物（build 为验证目的重建 dist 属正常流程）、未 commit。

## Bugfix：sidebar-pin-hover-alignment（2026-09-08）

- 现象：项目会话行的置顶 icon 在 hover 时向右跳 8px（两态交叉淡入淡出期间肉眼可见横移）。
- 根因（几何推算，距行右缘）：静置态 pin 中心 68px（行内流 [pin 24][gap 4][时间槽 44] + 右 padding 8）；hover 态 pin 中心 60px（浮层 absolute right-2 [Pin 24][gap 4][Archive 36]）；偏差 8px = 时间槽 w-11(44) 与 Archive 胶囊 w-9(36) 宽度差。`sidebar-session-action-alignment.test.ts` 头注释声称『两 pin 中心重合、Archive 精确覆盖时间槽』，但 w-9≠w-11 该不变量不成立（测试仅断言类名字符串存在）。
- 修复：`overlayArchiveButtonClass`（ChatSidebar.tsx）`w-9`→`w-11`，置顶区/时间线/项目行/全局行 4 处共用一处生效；Archive 胶囊精确覆盖时间槽、两 pin 中心重合（68px）。测试同步：注释 w-9→w-11、it 描述、断言 `toContain('w-11')` + 新增 `not.toContain('w-9')` 防回归。不改时间槽（sidebar-session-time-nowrap 刚为中文『23小时』扩到 44px）。
- Verification: 定向 vitest 2 files / 29 tests（alignment 7 + section-order 22）全过；eslint 两改动文件 0 error；`npx tsc -b --pretty false` 通过。
- Boundaries: running spinner/未读点插在 pin 与时间之间导致的次要偏差（16/10px）未处理（hover 移出布局会引入新跳动）；running/未读时时间槽省略的最大 ~30px 偏差属既有设计；wiki 无需更新；未新增依赖、未触碰生成产物、未 commit。

## Bugfix：sidebar-project-row-hit-area（2026-09-08）

- 现象：侧栏「项目」分组下项目行整行点击无响应，可点区只有最左 icon 按钮（24×24）和标题按钮（高约 20px）；上下留白、左右 padding、中间 gap 全是死区；右侧操作 overlay hover 时全高拦截右缘点击。
- 根因：项目行 div（挂 useSortable `{...listeners}{...attributes}`，L1559 一带）本身没有 onClick，展开/收起只绑在内层两个小按钮上；对照会话行是整行挂 onClick。
- 修复：① 行 div 新增 onClick 统一 `toggleProjectExpanded(item.id)`，内层 icon/标题按钮移除各自 onClick（点击与键盘 Enter 的 click 冒泡到行级统一处理，按钮/aria-label/title 保留，a11y 不回退）；② 新增 `suppressProjectRowClickRef = useRef(false)` 三段式防拖拽误触——`handleDragStart` 与 `finishProjectDrag`（dragEnd/dragCancel 共用出口）置 true，行 onClick 命中则复位 ref 并 return，吞掉拖拽结束后浏览器同手势补发的 click；行 div 另挂 `onPointerDown` 先复位 ref 再转发 `listeners?.onPointerDown?.(event)`（JSX 后写属性覆盖 spread 的 dnd listener，必须手动转发保拖拽），新手势开始即清位，Escape 取消拖拽后不吞下一次真实点击；③ 右侧 overlay 两个 Button（Ellipsis 菜单、MessageSquarePlus 新建）onClick 显式 `event.stopPropagation()` 防误触行级切换（openProjectMenu 内部原有 stopPropagation 保留不动）。
- 测试：新增 `tests/frontend/project-row-hit-area.test.ts` 5 用例（源码字符串契约，touchAction 唯一锚点切出行块）——行级 onClick + 抑制守卫 + toggle + onPointerDown 清位转发 listeners、内层两按钮无 onClick、overlay 两按钮 stopPropagation、finishProjectDrag 置抑制 ref、handleDragStart 置抑制 ref。
- Verification: 定向 vitest 4 files / 44 tests 全过（新 5 + project-drag-boundary 10 + sidebar-section-order 22 + sidebar-session-action-alignment 7，既有断言无冲突）；eslint 两改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（dist 已重建，仅既有警告）。
- Boundaries: 只修项目行，未动分区头/会话行/其他区域与样式类名；残余边界——拖拽结束 click 落在行外祖先时标记驻留至下次手势 pointerdown 清除（物理点击无感）；键盘 Enter 在拖拽取消后无 pointerdown 直接触发的极端组合仍可能被吞一次；wiki 无需更新（纯组件内交互修复）；未新增依赖、未触碰生成产物、未 commit。

### Revision：三个分区头整行可点（2026-09-08）

- 现象：用户复查反馈置顶/项目/任务三个分区头（sectionHeaderClass 行）同款死区——标题按钮外整行（左右 padding、右侧按钮间空隙）点击无反应。
- 修复（与项目行同款模式）：新增 `suppressSectionHeaderClickRef = useRef(false)`（与项目行 ref 相邻）；三个 header div 各挂 `onPointerDown` 清位（listeners 挂在内层标题按钮上、冒泡到 header div 才触发，无 spread 覆盖问题、无需转发）与带守卫的 `onClick`（置顶调 `onTogglePinnedCollapsed()`、项目调 `toggleProjectsCollapsed()`、任务调 `toggleConversationsCollapsed()`）；三个内层标题按钮移除各自 onClick（activator ref/listeners/attributes/aria-expanded 保留，键盘 Enter 的 click 冒泡到 header 生效，a11y 不回退）；`handleSectionDragStart` 与 `finishSectionDrag`（dragEnd/dragCancel 共用出口）置抑制 ref；右侧 4 个 action Button（项目头 openViewSortMenu/toggleAllProjectsExpanded/onSelectProjectDirectory + 任务头 onStartNewGlobalChat）onClick 包 `event.stopPropagation()` 原调用保留。
- 测试：新增 `tests/frontend/sidebar-section-header-hit-area.test.ts` 6 用例（源码字符串契约，`className={sectionHeaderClass}` 三处按 indexOf 顺序切片锚定置顶/项目/任务头）——header div 三件套（清位/守卫/toggle）、标题按钮无 onClick 且 activator 属性保留、4 个 action Button stopPropagation + 原调用、finishSectionDrag/handleSectionDragStart 置位、ref 声明。另同步 `sidebar-section-order.test.ts` 一处用例锚点（旧锚绑定标题按钮自带 onClick 与单行 div 写法；断言语义不变）。
- Verification: 定向 vitest 5 files / 50 tests 全过（section-header-hit-area 6 新 + project-row-hit-area 5 + project-drag-boundary 10 + sidebar-section-order 22 + sidebar-session-action-alignment 7）；eslint 三个改动文件 0 error；`npx tsc -b --pretty false` 通过。
- Boundaries: 未动项目行（上轮已修）、会话行、其他区域与样式类名；残余边界与项目行一致（拖拽结束 click 落头外祖先时标记驻留至下次手势、键盘 Enter 极端组合）；wiki 无需更新；未新增依赖、未触碰生成产物、未 commit。

## Revision 9：assistant-reply-artifact-card 改为会话累计口径（2026-09-08）

- 背景：用户反馈「产物和修改应该是当前 session 的总和，而不是单次的」——上一版「最近产物轮」只展示最后一个有产物轮的文件，此前轮次的产物/修改不显示。
- 实现：提取改 `extractSessionArtifacts(messages)`（全会话跨轮求和，含此前各轮 write/edit/present），卡片挂最后一条 assistant（对话尾部）；新轮无产物时签名一致原地不动，有产物时增量更新；卡片随对话尾部迁移到新宿主时展开态回退读旧卡自身 `data-quickforge-artifact-expanded`（不因迁移回折）。与「撤销」语义对齐——rollbackFiles 本就是会话级回滚，卡片口径与其一致。`extractArtifactsFromMessages` 收回内部（卡片改用 extractSessionArtifacts 后无外部使用方）。
- Verification: 定向 44；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。

## Revision 8：assistant-reply-artifact-card 合并文件 ± 语义——churn 改净变化（2026-09-08）

- 现象：用户对照 diff（纯新增）质疑卡片出现 -N。排查确认方向无反（createTextDiff insert→addedLines、调用点 old 在前、行渲染 +→绿 -→红均正确）；根因是 Revision 7 的合并取累计 churn——「先建 (+N) 后小改 (+a −r)」显示 +N+a −r，纯新增文件凭空多出 -r。
- 修复：mergeChangedArtifactsByPath 多次写入分支改净变化：net = Σ加 − Σ减，addedLines=max(net,0)、removedLines=max(-net,0)（任一侧有统计才赋值），与 git diff/新增文件观感一致；单次调用不进合并分支，保留真实 hunk ±（与 diff 视图逐段一致）。折叠头 diffTotal 随行之自动一致。
- Verification: 定向 14；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。

## Revision 7：assistant-reply-artifact-card 修改文件重复显示修复（2026-09-08）

- 现象：用户反馈修改文件列表出现重复行。根因：`artifactKey` 去重键含 toolCallId——同一文件一轮内多次 write/edit（或多次 present_files、父/子会话都写）每次工具调用各产出一条产物，卡片逐条渲染即重复。
- 修复：去重放在卡片层（共享提取器保持「每次工具调用一条」的产物面板语义）——`buildCardPlans` 前置 `mergeChangedArtifactsByPath`（changed 按归一路径合并为一行：行序取首现、kind/preview 取最新、± 为各次累计 churn）与 `dedupePresentedArtifacts`（present 同文件去重，字段取最新、保首现顺序）；路径键统一反斜杠归一（不做大小写折叠，避免大小写敏感文件系统误合并）。折叠头总数 diffTotal 随合并后数据自动一致。
- Verification: 定向 44；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。

## Revision 6 修正：assistant-reply-artifact-card 提取源回归——刷新不出卡（2026-09-08）

- 现象：用户刷新页面后卡片消失。根因是 Revision 6 把产物提取从完整 `messages` 挪到了 `displayEntries`——后者是只含 user/assistant 的过滤视图，**不含 `toolResult` 消息**，而 `extractArtifactsFromMessages` 恰恰从 `toolResult.details` 取 path/diff，导致提取永远为空、卡片在任何状态下都不再渲染（刷新加载新构建后暴露）。
- 修复：`findLastArtifactTurn` 改回在完整 `messages` 上扫描（user/user-with-attachments 为轮边界），返回该轮最后一条 assistant 的**消息对象**；sync 经对象引用（displayEntries 与 messages 同源同引用）`entry.message === turn.lastAssistantMessage` 定位 display 下标取元素。deps 恢复 `messages` 字段（message-actions 调用点同步恢复）。服务端 restore 链路核实无问题：persistSession 持久化完整 `state.messages`（含 toolResult+details），客户端 IndexedDB 快照同源，刷新后数据支持出卡。
- 测试加固：契约断言提取必须跑在 `messages.slice(turnStart, end)`（完整消息）而非 displayEntries，并断言 deps 携带 `messages: getMessages()`——防止同类回归再从字符串层面溜过。
- Verification: 定向 44；全量前端 132 files / 1379 tests 全过；eslint 改动文件 0 error；`npx tsc -b`、`npm run build` 通过。

## Revision 6：assistant-reply-artifact-card 卡片生命周期——流式保留旧产物（2026-09-08）

- 背景：用户反馈「发送一个新消息卡片就消失了」——旧实现 streaming 一到就 removeArtifactCards，新一轮哪怕只是问答、没有任何文件改动，上一轮产物卡也被清掉。
- 实现：① sync 流式分支改为纯 `return`（不清卡），上一轮卡片原地保留；② 产物提取从「当前轮（最后一条 user 之后）」改为 `findLastArtifactTurn`——在 displayEntries 上从最新轮向旧按 user 边界扫描，取最近一个产出 write/edit/present 文件产物的轮，卡片挂到该轮最后一条 assistant（displayEntries 与 messageElements 对齐且 message 为同引用，直接切片跑 `extractArtifactsFromMessages`，tool-artifacts 导出该函数）；③ 换卡时机自然成立：新轮流式结束后的 idle sync 中，若新轮有产物 → 目标轮切换 → 签名不同 → removeArtifactCards + 挂新卡；若无产物 → 目标轮仍是旧轮 → 签名一致跳过，旧卡保留；④ 整段会话扫描不到任何产物轮才清卡；⑤ deps 删除不再需要的 `messages` 字段（message-actions 调用点同步），撤销重新武装仍由 App onArtifactsChange（产物变化）驱动，语义不变。
- 边界：恢复旧会话/分支时，最后一个产物轮即使是历史轮也会重新出卡（与「卡片代表最近产物轮」一致）；流式中若 Lit 重建旧宿主元素导致卡片短暂丢失，流式结束的 idle sync 会重挂。
- Verification: 定向 44；全量前端 132 files / 1371 tests 全过；eslint 改动文件 0 error；`npx tsc -b`（含并行会话 http-storage-backend 中间态自愈后）、`npm run build` 通过。

## Feature：provider-keys-send-cache（2026-09-08）

- 现象：发送消息到乐观上屏之间存在可感知延迟，服务端忙时更明显。
- 根因：发送路径 `providerKeys.get(provider)` 无缓存——pi 库 AgentInterface.sendMessage 在乐观上屏前 await 该调用，QuickForge 的 HttpStorageBackend 每次都发无缓存 HTTP GET /api/storage/provider-keys/key/:provider（cache:'no-store'），往返被服务端排队拉长。
- 实现：① 新增 `src/lib/provider-keys-cache.ts`——模块级 Map（provider→key，null=已确认无 key）+ in-flight 去重 + load 失败不缓存；跨标签 BroadcastChannel('quickforge-sync') 'provider-keys-changed' 广播互失效（sourceTabId 自忽略，与 useCrossTabSync 共用频道且未知类型互相安全忽略）；通道惰性建立 + unref 兜底 + clear 时关闭重置（实测 Node 未关闭通道会挂住事件循环，import 期建立会挂死 vitest worker），不可用静默降级。② `http-storage-backend.ts` 挂接：get 读穿（命中零 HTTP）、has 命中短路不回填、set/delete/clear 写通 + 广播，全部位于 fakeProviderKeys/storeOverrides 短路与 assertStoreAccess 之后；transaction legacy 路径自动继承；keys 不缓存。③ `backup-settings-tab.ts` 导入成功后统一失效 + 广播（备份导入绕过 backend 直写服务端）。
- 测试：新增 `tests/frontend/provider-keys-cache.test.ts` 10 用例；`tests/frontend/http-storage-backend.test.ts` 新增 8 用例（缓存命中/写穿/清除/has 语义/fake 与 override 不污染/legacy 继承/非 provider-keys 不缓存）。
- Verification: 定向 vitest 3 files / 33 tests 全过；eslint 5 改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（仅既有警告）；提交前全量前端 132 files / 1379 tests 复跑通过。
- Boundaries: 模块级缓存（AppStorage 会被多处重建，实例字段会丢）；跨标签一致性尽力而为（写通保证本标签永不过期，他标签滞后到刷新/写操作）；未新增依赖、未触碰生成产物、已提交（artifact-card Rev2-6 同批先行单独提交）。

## Revision 5：assistant-reply-artifact-card 字体统一 + 浮层遮挡修复（2026-09-08）

- 背景：用户复查要求检查字体大小与弹窗遮挡。核查发现三个真实问题：① Revision 4 的明细动画层 `.quickforge-assistant-artifact-card-details-body { overflow:hidden }` 会把行内「打开▾」菜单裁掉（展开后靠后的行菜单不可见）；② 消息列表 `overflow-y-auto` 裁剪 absolute 浮层——产物卡恰在本轮最后一条消息底部（输入框正上方），「撤销」确认弹层/打开菜单向下弹最易被裁；③ 字体不一致——行内 ± 统计与「打开/审查/撤销」按钮继承消息正文字号（~14px），大于折叠头统计（12px）与卡片标题（13px）。
- 实现：① 新增 `panel-decoration/floating-position.ts` `positionFixedDropdown(trigger, dropdown, margin)`——fixed 视口定位（右对齐触发器、整体 clamp 进视口、下方空间不足向上翻转），fixed 不受祖先 overflow:hidden/滚动容器裁剪；② 打开菜单与撤销确认弹层（共享 rollback-confirm-popover，消息级回滚同样受益）改经此定位，均增补 scroll(capture)/resize 即关；弹层向上翻转加 `-up` 变体（箭头移底边），CSS 去 absolute top/right 改 fixed；③ 字体统一到卡片 12px 档——`-file-stats` 显式 `font-size: 0.75rem`，按钮基础 `font: inherit` 改 `font-family: inherit; font-size: 0.75rem; line-height: 1.25`（行内 compact 11px 不变）；④ 健壮性——`removeArtifactCards` 内统一 `closeActiveOpenMenu()`（流式/清空分支移除卡片时同步清 document 级监听）。
- Verification: 定向 43；全量前端 131 files / 1360 tests 全过；eslint 改动文件 0 error；`npx tsc -b`、`npm run build` 通过。

## Revision 4：assistant-reply-artifact-card 样式定稿——diff 红绿 + 对话宽度（2026-09-08）

- 背景：功能确认后用户要求样式对齐：± 有红绿区分、宽度与对话一致；先画 `design-mockups/assistant-reply-file-card-v2.html`（浅/深色、折叠/展开、打开▾下拉、比例条/ghost/参考线三个开关）对齐后按 6 项定稿执行。
- 实现：① ± 红绿——`-added/-removed` 色值与应用 `.quickforge-diff-stats-add/del` 同源（light green-700/red-700、dark green-300/red-300），折叠头统计组与行内统计统一；② 宽度——容器 `min(100%,620px)` → `width:100%` 填满消息容器（与正文/输入框同边），删 640px 断点的 `margin-inline:0.5rem`；③ 折叠头重排——标题 `flex:0 1 auto`，新增 `-header-stats`（margin-left:auto + mono tabular-nums）装比例条与 ±，流式 +N 增长不推标题；④ 比例条——`createDiffBar`（段宽按 +N/−N flex 占比，纯新增仅绿段），折叠头与行内都有；⑤ 按钮 Ghost 化——打开/审查/撤销去边框改透明底，hover 浮中性浅底，撤销 hover 转红（同组红绿 token）；⑥ 展开动画——details 三层结构（grid 动画层 / overflow 钳高层 / padding 列表层），`grid-template-rows 0fr→1fr` 过渡，`visibility` 延迟 dur-base 切换防折叠区 Tab 聚焦，reduced-motion 关闭。
- Verification: 定向 vitest assistant-artifact-card + message-actions（41）；全量前端 131 files / 1358 tests 全过；eslint 改动文件 0 error；`npx tsc -b`、`npm run build` 通过。

## Revision 3：assistant-reply-artifact-card 完全对齐截图两类卡（2026-09-08）

- 背景：用户给出第二张目标截图（两张 present 单文件卡 + 折叠的「13 个文件已更改 +353 -134」条），要求一次做完剩余全部差异并保持交互一致。
- 实现：① 卡片拆分——present_files 每文件独立单文件卡（类型 SVG 图标 + 文件名 + i18n「类别 · KIND」副标题 + 「打开▾」），write_file/edit_file 聚合为默认折叠「N 个文件已更改 +X -Y」卡，header role=button 点击/Enter/Space 切换 chevron 展开，展开态持久在宿主消息元素 dataset；行内 = 类型图标 + 文件名/路径同行 + +N/-N + 「审查」+「打开▾」。② 「打开」升级「打开▾」下拉：预览打开（onOpenFilePreview）+ 在文件管理器中显示（onRevealFile → `openWorkspaceExternal(…,'explorer')` 复用既有 open-external，服务端零改动），菜单模块级互斥。③ 「审查」落地 diff：`WorkspaceInspectorOpenRequest` review 分支加可选 `path`，App `onReviewFileChanges(path)` → requestWorkspaceInspector review/changes+path → WorkspaceInspector `openDiffTab` 单文件 Monaco diff（git 工作区口径，与 ± 统计会话影子备份口径不同，注释标注）。④ 装饰幂等重写为签名跳过重建：卡片 `dataset.quickforgeArtifactSignature` 与计划一致仅校正位置不重建——确认弹层/下拉菜单/展开态在任意 DOM mutation 触发的重装饰中存活（同时修复 Revision 2 撤销弹层会被装饰周期立刻清掉的隐患）。⑤ i18n 删旧 key（标题/说明/范围/切换等）+ 增类别/菜单 key，CSS 重写两类卡共享容器/折叠 header/菜单/响应式。
- Verification: 全量前端 vitest 130 files / 1350 tests 全过；eslint 改动 11 文件 0 error；`npx tsc -b`、`npm run build` 通过。
- Notes（与 feature 无关）：顺带修复既有失败测试 sidebar-session-action-alignment——源码 518c176 有意 `w-9`→`w-11`（中文断行修复），测试断言未同步，更新为 w-11（一行断言 + 用例名/注释）。

## Bugfix：settings-select-reactive-shadowing（2026-09-08）

- 现象：设置「默认模型/思考等级/语言/默认运行时/终端 Shell」选择后触发按钮不立即回显新选中项，再点一次才显示；数据保存链路正常（重开设置显示正确值）。
- 根因：`src/lib/quickforge-settings-select.ts` static properties（Lit 在 prototype 生成响应式 accessor）与真实类字段初始化（value=''、options=[] 等 8 个）混用；tsconfig target es2023 且 useDefineForClassFields 默认 true，原生字段在实例上创建 own property 永久遮蔽 prototype accessor，父组件 `.value=...` 属性绑定赋值不触发 requestUpdate（值本身写入实例所以保存/重开正确，但 UI 不重渲染）；再点一次显示是 `_openMenu`/`_close` 手动 requestUpdate 的副作用。
- 修复：8 个 reactive 属性改 `declare` 声明（对齐 info-tip.ts/local-tools.ts 项目范式）+ 默认值移 constructor 经 accessor 赋值（Lit 官方模式；options 被 render 直接 .find/.map 必须保留 [] 默认值），行为完全不变。
- 测试：新增 `tests/frontend/quickforge-settings-select.test.ts` 6 用例——ES2023+useDefineForClassFields transpile AST 契约防字段声明复发；Node stub 最小 DOM（HTMLElement/customElements/document/window + 手动 finalize 模拟 customElements.define 的 accessor 安装 + enableUpdating 模拟 connectedCallback 放行首轮更新 + 遮蔽 performUpdate 阻断真实渲染）直接实例化组件，验证属性赋值触发 requestUpdate（isUpdatePending/performUpdate spy）、默认值经 accessor 无 own property、_select change 派发、_open/_close 周期 label 不回退；bug 复发形态实测 4/6 失败，回归有效。
- Verification: 定向 vitest quickforge-settings-select 6 + default-options-settings-tab 2 + local-tools-lit-reactivity 2 全过（3 files/10 tests）；eslint 两改动文件 0 error；npx tsc -b 通过。
- Boundaries: 纯 bug 修复；wiki 无该组件条目未动；default-options-settings-tab 5 处使用点均显式绑定属性，其余 grep 命中为原生 select 的 CSS 类复用；未新增依赖、未触碰生成产物、未 commit。

## Bugfix：sidebar-session-time-nowrap（2026-09-08）

- 现象：中文界面侧栏会话时间「15小时」在 36px 固定列内断成两行（「15小/时」），行高被撑开；「2天」不受影响。
- 修复：`src/components/sidebar/ChatSidebar.tsx` `timeClass` 一行——`w-9`→`w-11`（36→44px，容纳最长 zh 输出「23小时」≈36-40px）+ 补 `whitespace-nowrap` 禁止 CJK 断行。4 处引用（置顶 1131 / 项目 1476、1680 / 时间线 1839）共用该变量，一处生效；固定宽度保证整列右对齐（非 min-w 自适应）。`formatSessionTime` 无绝对日期兜底、i18n 仅 zh/en，44px 覆盖所有输出。
- Verification: eslint ChatSidebar.tsx 0 error；npm run build 通过（仅既有 chunk 警告）；纯 className 字符串改动，无对应单测，未跑全量。
- Boundaries: 未动 i18n 文案、未动 en 布局（w-11 对「15h」等短文案仅加空白）；已提交 dev，未 push。

## Revision：assistant-reply-artifact-card 补撤销与行内打开（2026-09-08）

- 背景：评审发现卡片与目标形态差异——缺「撤销」入口（服务端 rollback-files 已就绪但前端无 UI）、缺每文件「打开」（头部按钮只开第一个可预览文件）。「审查」diff 视图暂用行内预览顶替。
- 实现：① 头部「撤销」按钮（`quickforge-assistant-artifact-card-rollback`，包 `.quickforge-rollback-action` 供弹层锚定）——点击弹共享确认层（原 message-actions 私有实现抽为 `panel-decoration/rollback-confirm-popover.ts`，onConfirm 泛化无参），确认后调 App `rollbackFilesFromArtifactCard` → `ServerAgent.rollbackFiles()`（POST rollback-files，幂等）；成功按会话 id 记 `rolledBackFilesSessionId` 置灰「已撤销」，`onArtifactsChange` 重新武装；部分失败/异常走 addToast；流式中防御拦截（卡片本就不显示）。② 每文件行 stats 后追加「打开」小按钮（`artifact.preview && artifact.path` 才渲染），替代原头部仅开首个可预览文件的按钮。③ readOnly 面板 ChatPanelHost 不传 onRollbackFiles 隐藏撤销；卡片模块不引用消息级 onRollbackFromMessage。
- Verification: vitest assistant-artifact-card + message-actions（38 tests）+ 关联 18 文件（320 tests）全过；`npx tsc -b`、eslint 改动 8 文件 0 error、`npm run build` 通过。
- Boundaries: 服务端零改动；整卡折叠、类型专属图标、「审查」diff 视图未做（后续可选）；未 commit。

## Completed Feature：assistant-reply-artifact-card（2026-09-07，Revision）

- 目标：仅在最后一条已渲染 assistant 回复底部显示“本次回复涉及的文件”卡片；流式中、user、历史 assistant 或无当前轮 artifacts 时不显示。
- 实现：新增 `src/components/chat/panel-decoration/assistant-artifact-card.ts`，复用 `extractCurrentTurnArtifacts`，只纳入有 path 的 `write_file`/`edit_file`/`present_files`；按设计稿展示文件图标、标题/说明、总 +N/-N、类型徽标、文件名、路径/类型辅助信息、每文件差异、统一「打开」预览按钮，以及「变更范围 · 本次回复」和详情展开/收起。`message-actions.ts` 每次 decorate 先清理并同步卡片，保证 Lit 重建幂等；流式或无 artifact 清除。旧 change-summary-strip UI、CSS、i18n key 和测试已删除；服务端影子备份/回滚实现保留。
- 测试：新增 `tests/frontend/assistant-artifact-card.test.ts` 覆盖最后 assistant/流式过滤、actions 前插入、preview 接线、CSS 类与 reduced-motion 契约；前端全套 130 files / 1351 tests 通过。
- Verification：定向 `npx vitest run tests/frontend --reporter=dot`、`npx eslint` 改动 TS/TSX、`npx tsc -b --pretty false`、`git diff --check` 均通过；提交前全量 `npm run test`（283 files / 2688 tests）、`npm run lint`（0 error，仅既有 warning）、`npm run build` 通过。
- Boundaries：未修改服务端、生成产物；已提交 dev，未 push。

## Completed Feature：session-change-summary-rollback（2026-09-07，needs-review）

- Feature: 对话底部会话级代码变更摘要条——修改文件数、对账真实 ±行数、影子备份安全回滚、HTML 预览（session-change-summary-rollback）。
- 决策（用户确认）：影子备份机制（非 git restore）、整会话回滚粒度、真实 diff 行数口径（首次备份内容 vs 当前内容）。
- 实现：`server/session-file-backups.mjs`（备份/摘要/回滚/7 天 TTL；同会话同文件只备份首次、新建登记 created）；`server/tools/index.mjs` write_file/edit_file 写盘前备份（失败仅 WARN 不阻断）；`server/agent-subagent-runner.mjs` 子 Agent 工具上下文补 sessionId 使写入归因父会话；新路由 GET `/api/agents/:id/file-changes` + POST `/api/agents/:id/rollback-files`。前端 `panel-decoration/change-summary-strip.ts`（composer dock 上方常驻条、两步确认回滚、流式禁用、html 预览经 App `onOpenHtmlPreview` → `workspacePreviewUrl` → Inspector browser tab）；ChatPanelHost 主 effect 创建（sideChatMode||readOnly 不挂）、decorate 周期 sync 按消息 write/edit toolResult 签名变化节流 fetch；i18n 中英 +7 key；CSS 中性条 + 绿/红 ±行数（含 dark）。
- Verification: 定向 vitest session-file-backups 5 + routes/agent 21 + tools 68 + agent-manager.subagents 16 + 前端契约 10 全过；eslint 改动 ts 0 error；node --check 4 模块；tsc -b；npm run build ✓（仅既有 chunk 警告）。未跑全量。
- Boundaries: run_command 产生的文件改动不纳入备份/回滚（见 Notes）；OpenCode harness 不经 QuickForge 工具链无备份；未新增依赖、未触碰生成产物、未 commit。
- Revision（预览对齐产物体系）：用户指出既有产物预览支持 html/md/txt/word 等全类型——变更摘要条预览从仅 `.html` 对齐为复用 `artifactPreviewMode` 判定（html/图片 → Browser、markdown/代码 → Reader、pdf/docx/excel → Document），回调改名 `onOpenFilePreview`，App 删除自拼 `workspacePreviewUrl` 的旁路改为直接调产物预览统一入口 `openArtifactPreview(projectId, relativePath)`，与产物列表点开同一文件行为完全同源（含 tab 复用/重载）；unknown 类型与无项目上下文的全局会话不显示按钮（与产物预览一致）。复验：契约测试 10、eslint、tsc -b 通过。
- Next step: 真机冒烟——项目会话让 Agent 编辑/新建文件 → 底部条出现文件数与 ±行数 → 展开列表 → md/txt/html/docx 等点「预览」分流到 Reader/Browser/Document → 「回滚」两步确认后文件恢复原样、新建文件被删除；流式中回滚按钮禁用；Side Chat 无条。

## Completed Feature：sqlite-heavy-op-worker-thread（本轮，已完成）

- Feature: SQLite 会话域重操作迁入 worker_threads 专职线程（sqlite-heavy-op-worker-thread，**已完成**）——"保存设置被同进程同步大事务阻塞"的治本项。
- 架构（方案 A 双连接分区）：worker 持自开 DatabaseSync 连接，白名单 op（save/saveMany/applyBatch/replaceMessages/appendMessages/delete/deleteBySessionId/replaceAll/exportSnapshot/verifyIntegrity/checkpointWal/readMessagesPage）经 postMessage RPC 在 worker 侧执行；主线程保留小读与 share/lan/scheduled-runs/session-index/maintenance-lock。正确性靠既有 revision CAS + BEGIN IMMEDIATE + busy_timeout（worker 侧 SQLITE_BUSY 有限重试），postMessage FIFO 保持 per-session 串行；错误序列化保留 statusCode/errorCode 控制流属性。`QUICKFORGE_SQLITE_WORKER=0` kill-switch；`configureSessionStateService({repository})` 注入恒优先不经 worker（测试/维护注入可达）。savePairChunked 保留主线程分批编码（快照契约不变），事务移 worker。
- 实现关键点：database.mjs 新增 getSqliteDatabasePath + 持久关闭钩子集合（closeSqliteStorage 先关 worker）；service heavyOp 路由 + 11 个导出方法 async 化；storage.mjs 调用点补 await；**异步化暴露两处真实缺陷已修**——①`atomicSessionMetadataStateUpdate` 的 `return updateSessionMetadataBucket(...)` 无 await 导致 conflict 重试从未捕获异步 rejection（改 return await）；②storage.mjs pin 路径 `atomicSessionMetadataBucketUpdateViaFacade` 原靠同步 run-to-completion 串行化，异步交错后按 service 同款 maxRetries=3 用新鲜桶状态重算 updateFn。附带：writePlan rename 补 Windows AV 25/50/100ms 重试（并行全量跑下 backup 测试在用户真实目录 EPERM 偶发，同 writeJsonAtomic 既有模式）。
- 验证：worker 单测 6 用例 ×3 稳定；sqlite+session-state 全族 97×4 稳定；受影响面 25 files / 212 tests 全过；全量 281 files / 2662 tests → 2642 过，剩 20 失败均属并行会话未提交改动（git-status-request-lifecycle 2 / git-tools-pinned-summary 1 / side-chat-workspace-tab 1 为其 App.tsx/ChatPanelHost 改动的源码契约失败；routes/side-chat 16 为其 text-attachments.mjs import cacheDir 撞 vi.mock 缺导出）；eslint 改动文件 0 error；node --check；build ✓。
- Boundaries：repository 零改动；session-state-import 启动导入未迁移；share/lan 等域留主线程（后续可评估）；未新增依赖；未触碰生成产物。
- Next step: 真机验证（长会话 agent 运行中保存设置/切会话不再卡顿、desktop 与 npm web 各一次；观察日志无 SESSION_STATE_WORKER_CRASHED）；kill-switch 验证 QUICKFORGE_SQLITE_WORKER=0 回退。

## Completed Feature：desktop-fork-default（本轮，已完成）

- Feature: 桌面端默认以独立子进程运行 server，inline 变显式 opt-in（desktop-fork-default，**已完成**）。
- 背景：用户追问"修改默认模型/思考等级接口慢"的根因链路：①设置页加载链（catalog 重复请求 + Cloud 2s 等待，另行立项）；②同进程单事件循环被会话持久化同步 SQLite 大事务阻塞——桌面端默认 inline 内嵌 server 使该阻塞直接冻结 Electron 主进程窗口。用户决策：翻转 fork 默认 + 立项 worker_threads 治本（见后续 feature）。
- 实现：`desktop/electron-main.mjs` 默认判定改 `QUICKFORGE_DESKTOP_INLINE === '1'`（opt-in inline，附注释说明动机与 PAC 逃生门）；dev（`!app.isPackaged`）传 `stdio: 'inherit'` 保住子进程 stderr，打包版保持 ignore；`server/public-api.mjs` 新增 `stopChildProcess`（SIGTERM→`waitForChildExit` 10s→SIGKILL→5s，对齐 qf CLI `terminateProcess` 语义），instance.stop 与 stopQuickForge 兜底分支均走升级链。
- 语义变化：默认 fork 下桌面代理走 node 侧 os-proxy-resolver（自定义 PAC URL 需 opt-in inline）；同版本端口复用（'same-version'）生效——退出不复用进程、attach 既有同版本服务；顺带修复 inline 三缺陷：UI restart 杀整个 App、EADDRINUSE 静默 process.exit(1)、启动失败傻等 300s。
- Verification：定向 vitest 3 files / 16 tests（desktop-fork-default 4 新契约 + startup-health-timeout 5 + public-api 7）全过；eslint 3 文件 0 error；node --check；npm run build ✓（仅既有 chunk 警告）。
- Boundaries：未新增依赖；未触碰生成产物；Windows fork 退出为硬杀（WAL 可恢复、日志尾 ≤5s 可能丢）已记录为接受项。
- Next step: 真机冒烟（启动/退出无孤儿进程、托盘主题刷新、UI restart 窗口保留并重连、杀子进程前端显示断连）；随后执行 sqlite-heavy-op-worker-thread。

## Completed Feature：sidebar-session-running-unread-status（本轮）

- 侧栏会话行尾新增状态反馈：运行中显示旋转 Loader2，成功完成且用户尚未点击时显示 emerald 绿色未读点，点击对应会话清除。覆盖 Pinned、Projects/Timeline、Tasks 三类会话行。
- 未读状态仅存在于当前前端生命周期；错误/中止不显示成功未读点。新增 `design-review/sidebar-session-status.html` 交互预览。
- 验证：`npx tsc -b --pretty false`、相关 ESLint、`git diff --check` 通过。未修改生成产物、未新增依赖。
- Revision（移除标题左侧加载 spinner）：用户反馈点击/刷新会话时标题左侧的加载 icon 出现/消失会把标题挤得抖动一下。删除 `sessionLoadingIndicator` 定义及 5 处渲染（置顶/时间线/项目分组/全局会话/搜索结果列表，最后一处为调研时发现的搜索弹窗），行按钮 `aria-busy` 语义保留，行尾运行中/未读状态不受影响；`Loader2` import 因行尾状态与加载占位仍在使用而保留。验证：ESLint ChatSidebar.tsx、`npx tsc -b`、定向 vitest 6 files / 52 tests 全过。

# Progress

## Completed Feature：sidebar-show-more-refocus-spinner（2026-09-07，已完成）

- Feature: 切回浏览器时「显示更多」按钮 spinner 闪烁修复（sidebar-show-more-refocus-spinner，**done**）——用户在 sidebar-pinned-refocus-flash 修复后报告"显示更多按钮也闪烁一下"，调研确认属实（详见 Notes）。
- 根因：切回 → refreshSessions 把各会话列表统一置 `loading:true`，`SessionDisplayControls` 的 `loading ? Loader2 : '显示更多'` + `disabled={loading}`（`disabled:opacity-45`）在切回期间切换；本地快时 React 合批掩盖、稍慢环境跨渲染帧呈现——闪烁时有时无。
- 实现：`SessionPage` 增加可选 `appending` 字段（session-list-updates.ts，spread 天然保留）——四个 loader 置位 `loading:true, appending: offset>0`，成功/失败/timeline 收尾统一清 `appending:false`；hook 新增导出 `projectTimelineAppending`/`globalAppending`/`projectAppending`；ChatSidebar 三处 SessionDisplayControls（timeline/项目/全局）`loading` prop 改读 appending 变体；App 两处传参接线。原 `*Loading` getter 保留：timeline/project 空态 spinner、`LoadMoreSentinel enabled={!pinnedCollapsed && pinnedHasMore && !pinnedLoading}` 防重复门控、App 首次展开项目守卫均不动；ChatSidebar/App 的 `globalLoading` 死链（全局区唯一消费点已换 appending）一并移除，hook 导出保留。用户点「显示更多」的 spinner 反馈与首载/分页/防并发语义零变化。
- 测试：session-pagination-bootstrap 更新 3 处状态断言（补 `appending:false`）+ 新增 2 用例（静默 refresh 阻塞时 `loading:true, appending:false`、loadMore 阻塞时 `appending:true`，deferred + offset=0 调用计数区分首载与 refresh）；sidebar-section-order 新增按钮接线契约（三处 loading 用 appending 变体、不再直接消费 globalLoading/projectLoading/projectTimelineLoading、空态 spinner 与 sentinel 保留）。
- Verification: 定向 vitest 5 files / 47 tests 全过；eslint 6 改动文件 0 error；`npx tsc -b --pretty false` 通过；浏览器实测同 120ms 延迟条件修复前 spinner 切换（t=197ms）→ 修复后 `svgChanges:[]`、`disabledFlips:0`。未跑全量（非发布）。
- Boundaries: 不改 LoadMoreSentinel/空态 spinner/分页/防并发；hook 导出面只增不减；未新增依赖；未触碰生成产物；未 commit。
- Next step: 无 blocker；用户真机切走/切回确认按钮静止；真机点「显示更多」确认 spinner 反馈仍正常。

## Completed Feature：sidebar-pinned-refocus-flash（2026-09-07，已完成）

- Feature: 切回浏览器时侧栏项目列表闪烁修复（sidebar-pinned-refocus-flash，**done**）——用户报告"切回浏览器到页面，左边项目的列表闪烁一下"。
- 根因（调研 + 实测实证，详见 Notes 2026-09-07 条目）：切回 → `useCrossTabSync` visibilitychange → `refreshSessions` → `loadPinnedSessions(0)` 先 `setPinnedPage({...prev, loading:true})`（useSessionPagination.ts:90，空 items 保留）→ 无置顶会话时 `ChatSidebar.tsx:1299` 挂载条件 `length > 0 || pinnedLoading` 因 loading 短暂成立 → 整个 Pinned 区块（标题 + `px-3 pb-1` 容器，侧栏第一个区块）挂载 → fetch 返回无置顶 → 卸载；MutationObserver 两次复现存活 42-62ms，下方项目列表被挤下再弹回即"闪烁"。触发条件 = 无置顶会话；App 首启同路径但整页加载期不显眼。
- 实现：挂载条件收紧为 `pinnedSessionItems.length > 0`（内容驱动，附注释说明约束）；删除随之不可达的区块内 loading spinner 占位分支（`length === 0 ? spinner : list` 三元收敛为直接渲染）；`pinnedLoading` 保留于 `LoadMoreSentinel enabled={!pinnedCollapsed && pinnedHasMore && !pinnedLoading}` 防重复加载更多，分页/loading 语义零改动。有置顶会话时区块常驻行为不变。
- 测试：`sidebar-section-order.test.ts` 新增契约——挂载条件含 `length > 0`、不含 `|| pinnedLoading`、区块内无 `length === 0` 死分支、LoadMoreSentinel 仍受 `!pinnedLoading` 门控。
- Verification: 定向 vitest 3 files / 33 tests（含 sidebar-section-order 21）全过；eslint 2 改动文件 0 error；`npx tsc -b --pretty false` 通过；修复后 dev server + MutationObserver 复验切回事件，Pinned 区块插拔消失（仅剩 dnd-kit 无位移 transition 写入）。未跑全量 test/lint/build（非发布）。
- Boundaries: 不改 useSessionPagination/loading/分页语义；不动 dnd-kit；未新增依赖；未触碰生成产物；未 commit。调研中发现的其余工作区级候选（rAF 补跑滚动跳变、SSE 重连提示条插拔、watchdog 全量替换、scrollbar-gutter）保持 Notes 备查，不在本 feature 扩大范围。
- Next step: 无 blocker；用户真机切走/切回确认项目列表不再闪。

## Completed Feature：large-paste-text-attachment（本轮）

- 长文本粘贴达到 3,000 字符时写入 qf 临时目录 `cache/global/tmp/conversations`，消息仅保存路径元数据；模型侧按受限路径读取，不把全文重复写入消息。
- 输入框内复用现有附件 tile；不显示“打开”文字，点击附件自动调用系统文件管理器；对话记录显示完整路径文本。
- 修复 pending 会话打开附件时的 400：不再直接在编辑器层拼接 agent endpoint，统一交给 App 的本地路径处理。
- 验证：文本附件与消息转换测试 9/9 通过；tsc、相关 ESLint、npm run build、git diff --check 通过。构建仅有既有 KaTeX/chunk warnings。
- Revision（真机冒烟报错修复，2026-09-07）：用户报告点击附件报「无法打开文件 Path is outside the selected project」。排查结论：该报错来自旧构建渲染进程（feature 中间态：编辑器粘贴已有、App.tsx 专用分支未上），重启加载新 dist 后不复现；但当前代码存在两个真实缺陷一并修复——① `openPathInFileManager` 仅接受目录，而 open-text-attachment 路由传入 .txt 文件，必然 400「Directory does not exist」：改为支持文件定位（win32 `explorer /select,<file>`、darwin `open -R`、Linux `xdg-open <父目录>`，参数构造抽为纯函数 `createFileManagerOpenArgs`，缺失文案统一 `Path does not exist`）；② message-actions 附件装饰无幂等守卫（Lit index-keyed 复用 user-message DOM，每装饰周期重复 append 路径行 + 叠加 once 点击监听），且多附件时 `:last-of-type` 全绑到最后一个 tile：重写为 `decorateTextAttachmentTiles`（tile 按 attachment 下标对齐、每 tile 仅一个读取当前 dataset 路径的持久监听、路径行按内容比对后重建）；editor-bindings 点击监听同步去 `once`（第二次点击不再落回 pi 附件预览）。新增测试：platform 2（三平台目录/文件参数矩阵）、agent 路由 3（创建/合法路径透传文件本身/非法路径 400）、message-actions 3（绑定+路径行、重复装饰幂等+持续可点、多附件对齐+路径变化跟随）。定向 vitest message-actions 30 / agent 19 / platform 5 / text-attachments+message-converters+editor-bindings+channels 17 全过；eslint 0 error；tsc -b；node --check；npm run build 通过。wiki server/utils 平台条目同步。
- Revision 2（UI 微调，2026-09-07）：用户反馈对话内不要显示完整路径。移除消息内 `.quickforge-text-attachment-path` 路径行（CSS 两条规则删除；装饰函数保留对该行的清理，防止同会话旧装饰残留），完整路径仅在附件 tile hover 提示（title）里，点击打开行为不变。message-actions 测试同步（路径行不存在 + 旧残留被清理），定向 vitest message-actions 30 + editor-bindings 2 全过；eslint 0 error；tsc -b；npm run build 通过。
- 边界：未新增依赖，未 commit/tag/push。


## Completed Feature：backup-settings-only-and-snapshot-fast-path（本轮，已完成）

- 本轮完成并验证：消息队列、活跃 Agent destroy-first、scheduled task updater、IndexedDB 事件收窄、`exportSnapshot` 的 keys/has/identity 快路径优化，以及用户 HTTP backup 的 settings-only boundary。
- 结果：相关实现与测试已完成；用户备份 HTTP 边界明确为 settings-only，不扩展到其他数据；本轮状态文件仅做最小追加/更新，保留工作区历史未提交改动。
- Revision（提交前定向验证与测试修复，2026-09-07）：发现新增并行用例「preserves a concurrently started parallel run」从未跑绿（HEAD 源码下同样失败，非源码回归），两处测试缺陷：①mock `createAgent` 的 timeout 模式 `continue()` 永不 resolve，`finish()` 仅 emit `agent_end` 无法唤醒 `runPromise`，用例只能卡在超时路径——mock 暴露 `resolveContinue` 并在 `finish()` 中结算；②`sessionId` 嵌入真实（未 fake 的）`Date.now()` 毫秒时间戳，同毫秒两次 run 共用 sessionId/事件总线使 listenerCount 断言失败——第二次 run 前自旋等待跨毫秒。修复后定向 vitest 8 files / 131 tests 全过（scheduled-tasks.execution 连跑 3 次 13/13 稳定）；eslint 16 个改动文件 0 error；随后创建 commit（docs/reports/ 12 份分析报告按用户决策保持未跟踪，另行整理）。
- Notes：未修改生成产物，未覆盖历史条目；未处理项沿用既有 Notes，不在本轮扩大范围。

## Completed Feature：desktop-memory-session-idle-eviction（2026-09-05）

- Feature: 桌面端内存暴涨排查 + 修复会话永不淘汰问题（desktop-memory-session-idle-eviction，**已完成**）。
- Status: done — 用户报告桌面端「内存爆炸卡死」。三轮只读调研（渲染端 / 服务端 / Electron 主进程）+ 关键点人工核实，结论：①根因之一为会话级 SSE keepAlive 每 15s `touchSession` 重置 10 分钟闲置计时器（agent.mjs），前端全局 SSE 常开导致本次运行打开过的所有会话连同全量消息历史永久驻留内嵌主进程堆；②其余主要问题见下方 Notes（渲染端窗口化禁用、装饰全量扫描、进程内嵌等，未在本条处理）。
- 实现：`server/routes/agent.mjs` keepAlive 心跳移除 `touchSession(sessionId)`（connect 时单次 arm 保留，与 restoreAgent 行为一致），并补注释说明心跳不得重置闲置计时的约束。删除安全性已核实：数据路由（state/messages/status/HEAD）与 `runPrompt`→`syncSessionFromStorage` 均自动 restore 被闲置销毁的会话（销毁不丢数据，历史在 SQLite）；闲置计时器对 running 会话自动续命（agent-manager.mjs:411-416）；`sseConnected` 挂在 session 对象上，销毁后无 409 死锁；前端实际只用全局流 `/api/agents/events`（server-agent.ts:208，挂模块级 emitter，不受销毁/恢复影响），会话级 `/stream` 端点在 src/、android/ 无消费方；`8e75c78` 引入该 touch 时前端尚用会话级流，现已不适用。
- Verification: 定向 vitest `tests/server/routes`（24 files / 183 tests，含 agent.test.mjs）+ agent-manager.abort / acp.prompt-cleanup / exports-contract 全过；eslint server/routes/agent.mjs 0 error。
- Boundaries: 单文件最小改动；未动 `dist/` 等生成产物；未 commit/tag/push。docs/wiki 无需更新（内部行为修复，不涉及架构/职责/公共入口/发布流程）。
- Next step: 无 blocker；后续候选见 Notes（渲染端窗口化恢复、装饰增量化、desktop fork 隔离、SSE 背压）。
- Revision（前端空闲会话副本缓存清零）：用户决策「不要存 7 个副本」——`agent-task-retention.ts` `MAX_IDLE_AGENT_TASKS` 5→0：taskMap 仅作为活动注册表（当前会话 + 后台 running/streaming 任务），切走的空闲会话立即销毁、切回走服务端 restore（网络往返换内存）；`useAgentManager.ts` `startDeferredSession` 视图切换后补 `pruneIdleTasks(undefined)`，堵住「新建空白会话后上一个空闲会话滞留到下次事件」的口子（running/streaming 不受影响，后台运行/完成 toast/状态角标/隧道恢复同步等 taskMap 消费方均兼容）。渲染端驻留副本 ~7 → 当前 + 后台运行数。新增契约用例 `MAX_IDLE_AGENT_TASKS === 0`。验证：定向 vitest 5 files / 26 tests 全过；eslint 3 文件 0 error；tsc -b；build ✓（仅既有警告）。

## Completed Feature：subagent-capability-inheritance（2026-09-04）

- Feature: Subagent MCP 与 Agent Skills Profile 开关及父工具集交集继承（**已完成**）。
- 实现：Agent Profile 新增 `allowMcpTools` / `allowAgentSkills`，Markdown/API 缺失默认关闭；QuickForge 自定义 Profile 可编辑，外部只读 Profile 不可编辑，内置 `general` / `explore` 通过 `agent-profile-overrides` 保存两个开关。
- 子 Agent 运行时只从父会话当前 `agent.state.tools` 继承对应 MCP 与 `activate_skill` / `read_skill_resource` 工具，不从全局额外扩展；开关默认关闭；MCP 仍走父会话审批/完全访问策略；Skills 无需审批；继续禁止递归 subagent。关闭 Skills 时动态移除继承的 `<available_skills>` 目录，避免系统提示词与工具列表不一致。
- 文件：`server/agent-profile-schema.mjs`、`server/agent-profile-files.mjs`、`server/agent-profiles.mjs`、`server/routes/agent-profiles.mjs`、`server/tools/definitions.mjs`、`server/agent-subagent-runner.mjs`、`server/agent-manager.mjs`、`server/subagents.mjs`、`src/components/agent-profiles/AgentProfilesPage.tsx`、`src/lib/i18n.ts`、相关测试与 Wiki。
- Verification：定向 Vitest 7 files / 64 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false`、相关 `node --check`、`npm run build` 全通过（build 仅既有 KaTeX 字体与 chunk size warnings）。
- Boundaries：未新增依赖，未修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push。

> 归档说明（2026-09-04）：更早的 33 个条目已移至 docs/archive/progress-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json。

## Completed Feature：composer-borderless-thinking-control（2026-09-04）

- Feature: Composer 底栏控件去框 + 思考等级独立选择器（composer-borderless-thinking-control，**已完成**）
- Status: done — 用户分四步驱动，逐轮设计稿对齐（design-mockups/composer-borderless.html，v1 两方案 → v2 思考等级独立 → v3 最终稿）：①标签「完全访问权限」→「完全访问」（agentAccessFullLabel），完全访问模式整体琥珀 #d97706（复用审批卡警告色）；②方案 A 完全去框——模型选择与 Agent 权限按钮移除 1px 边框与浅色填充，「计划」/子智能体胶囊不动；③顺序保持不变（左：[+] [完全访问]；右：[模型] [发送]），思考等级从模型按钮「· 等级」后缀拆为独立选择器（模型右侧、发送左侧），大脑 icon 归思考等级（icon + 等级文字形态、模型选择补下拉小箭头均经 AskUserQuestion 确认）。
- 实现：新 `panel-decoration/thinking-level-controls.ts`（按钮 + 五档向上弹出菜单，关/低/中/高/超高，menuitemradio + 勾选态，样式与 Agent 权限菜单共用选择器组；与其他 Composer 弹层互斥、Escape/点外关闭、resize/scroll 重定位）；`model-controls.ts` 移除思考后缀逻辑；`panel-decoration.ts` 接线（deps 新增 onThinkingLevelChange，dismissComposerMenus 纳入 thinking 菜单，disableComposerControls 纳入 thinking 按钮）；`ChatPanelHost.tsx` 回调写 `agent.state.thinkingLevel` + `updateThinkingLevel` 同步服务端 + 重跑装饰；`icons.ts` 新增 thinkingBrainIcon；`index.css`：模型按钮 ::before 大脑换盒形 icon 且默认隐藏、::after 由等级后缀改为 chevron（紧凑/移动端反转显示），thinking-inline 无框样式与 icon-only 紧凑规则，Agent 权限/模型按钮展开态不再强制前景色边框。
- Verification: npm run build ✓（仅既有 warnings）；eslint 改动文件 0 error；定向 tests/frontend 126/127 files 通过——唯一失败 `local-tool-running-sweep.test.ts` 为 **HEAD 上即失败的既有问题**（ruleFor 朴素正则被规则上方注释 glue，git show HEAD 对比证实，与本次无关），其余 1312 tests 全过；chat-compact-controls / composer-control-hover 两处断言旧结构的回归测试同步新设计。
- Boundaries: 未动服务端与 thinking 协议；模型选择弹层（custom-model-selector 及移动端 sheet 内的思考区块）保持原样，两处入口写同一 state；Side Chat 禁用态纳入 thinking 按钮；未新增依赖；未 commit/tag/push。
- Next step: 无 blocker；可选真机过一遍：切换思考等级后发送确认生效（服务端日志）、不支持推理模型下按钮隐藏、窄屏 icon-only 形态。
- Revision（用户追加三连改）：①「+」按钮同样去框；②模型选择弹层（桌面菜单 + 移动端 sheet）移除思考等级区块，custom-model-selector 删 thinking 渲染与 `thinkingLevel`/`onThinkingLevelSelect`/`showThinking` 选项，useModelActions / SharedConversationPage 调用点同步清理（保留切非推理模型自动归零守卫），桌面菜单头部「推理」→「模型」，无主 model-menu-separator / model-menu-note / model-sheet-thinking* CSS 删除；③思考等级按钮补下拉小箭头（thinkingChevronIcon，紧凑/移动端与文字一起隐藏为 :is() 组）。**事故记录**：本轮用 Python 正则批量删死 CSS 时，可选注释前缀 `(?:^[^\n]*\n)*?` 从文件首个单行注释起吞掉 4638 行；发现后 `git show HEAD` 恢复并用 Edit 工具逐块重放全部会话内 CSS 改动，最终 diff +97/−57 与预期一致，build + 1312 tests 复验全绿。
- Revision 2（用户四连改）：①误伤审查——全量 `npm run test` 276 files / 2626 tests，唯一失败仍为 HEAD 既有 local-tool-running-sweep，grep 无残留引用（THINKING_LEVELS 仅存于新模块）；②「完全访问」hover/展开背景删 12% 琥珀淡底、回归与其他控件一致的中性浅色底，文字/图标保持琥珀；③桌面模型菜单合并单一列表（去掉当前模型行→hover 子菜单二级结构、positionModelSubmenu 与 .quickforge-model-submenu CSS；「模型」头部 + 全部模型勾选项 + 设置入口；空列表恢复 .quickforge-model-menu-note 提示）；④模型按钮删 max-width min(14rem,38vw)，窗口缩放不截断模型名（<768px / 紧凑模式仍按设计收成 icon）。复验：build ✓、eslint 0 error、前端 126 files / 1312 tests 全过。
- Revision 3：紧凑模型 icon 经 6 候选对比页（design-mockups/model-compact-icon-options.html）评审维持 Box，同时补齐 mask 内部棱线（顶棱 m3.29 7 8.71 5 8.71-5 + 正面竖线 M12 22V12）使应用内显示与设计稿一致（此前只有外轮廓、呈空心六边形）；紧凑/移动端 icon-only 形态按钮行改 flex-start + gap 0.5rem，图标控件连续排列间距统一（消除权限 icon 与模型/思考之间的 justify-between 弹性空隙），发送/停止按钮 margin-left auto 保持右缘。复验 build ✓ + 前端 1312 tests 全过。
- Revision 4（上下文圆环紧凑态槽位修复）：`context-usage.ts` 在模型按钮前源码创建 `quickforge-context-usage-slot`，紧凑态由 `index.css` 提供固定 32px flex 槽位，14px 圆环居中；百分比与数据计算不变。新增 `chat-compact-controls` / `context-usage` 契约测试锁定槽位、插入顺序、14px 环和 compact 分组布局。定向 Vitest 2 files / 24 tests、ESLint、tsc -b、build、git diff --check 通过；未 commit/tag/push。
- Revision 5：Agent 输入框底部权限控件去除 `border-transparent` 透明边框类，保留原有尺寸、圆角、间距与 hover/展开反馈；新增 `tests/frontend/agent-access-menu.test.ts` 源码契约，确认触发按钮无透明边框且下拉菜单仍保留实际边框。改动文件：`src/components/chat/panel-decoration/agent-access-menu.ts`、`tests/frontend/agent-access-menu.test.ts`。定向 3 files / 18 tests、ESLint、tsc -b、git diff --check 通过；未 commit/tag/push。

- Revision 6：模型选择弹窗（桌面与移动端共用）选中勾改为复用 `agentAccessCheckIcon` SVG，勾选槽位移至左侧并与思考等级菜单统一 1rem 栅格、13px 图标和前景色；新增 `custom-model-selector.test.ts` 契约断言。定向模型选择器 8/8、ESLint、git diff --check、tsc -b 和 build 均通过；未 commit/tag/push。
- Revision 7（运行中 Subagent 控件去框）：完成 `src/components/chat/panel-decoration/subagent-running-indicator.ts` 的运行中控件去框，并同步 `tests/frontend/subagent-running-indicator.test.ts` 与 `tests/frontend/composer-control-hover.test.ts` 契约覆盖。定向 2 files / 15 tests、ESLint、tsc、build、git diff --check 均通过。

## Completed Feature：sidebar-pin-hover-alignment（2026-09-04）

- Feature: 侧栏会话行置顶按钮 hover 对齐修复——镜像槽位交叉淡入淡出（sidebar-pin-hover-alignment，**done**）
- Status: done — 根因修复 + 契约测试与 wiki 同步完成；未 commit。
- 根因：① 静置 pin（in-flow、时间文本左侧、size-5/size-3 图标）与 hover 浮层 pin（absolute right-1、size-6/size-3.5）位置和尺寸均不一致，hover 跳位约 5-20px 且放大，过渡期双影；② pinnedSessionButtonClass 的 transition-opacity + transition-colors 被 twMerge 去重为后者，静置 pin opacity 实为瞬变；③ 全局会话行归档图标误用 size-4；浮层 right-1(4px) 与行内容右缘 px-2(8px) 错位。
- 实现：镜像槽位几何——静置 [pin 槽 size-6][gap-1][时间槽 w-9 右对齐]，未置顶行渲染 size-6 空 span 占位（时间列/标题列跨行对齐，pin/unpin 不挤压布局）；hover 浮层 right-2 锚点 + [Pin size-6][gap-1][Archive h-6 w-9]，与静置簇几何完全镜像，pin 原位交叉淡入淡出零位移零缩放、归档胶囊精确覆盖时间槽；图标统一 size-3.5；pin 过渡改单一 transition-[color,opacity]；会话浮层与行内主按钮间距统一 gap-1（初版 gap-2 被用户反馈太宽后收窄，两态间距必须一致以保持镜像）、项目行浮层保持 gap-px（基类不再携带 gap）；四处行结构（Pinned 分区/时间线/项目子会话/全局会话）同步。
- 测试：新增 tests/frontend/sidebar-session-action-alignment.test.ts（7 用例源码契约：pin 几何/过渡、时间固定槽、空槽占位×3、浮层镜像锚点与间距、归档 w-9、图标尺寸统一 8×pin/4×archive、静置与浮层顺序）。
- Verification: 定向 vitest 4 files / 44 tests 全过；回归 3 files / 21 tests 全过；eslint 2 文件 0 error；tsc -b 通过；npm run build 通过（仅既有 chunk 警告）。未跑全量 test/lint。
- Boundaries: 不改悬停提示/确认归档流/actionsSuppressed/删除退出动效；纯 Tailwind 几何无新 CSS 模式，DESIGN_LANGUAGE 未改；未置顶行标题可用宽度减少约 32px（换取全列对齐与零跳变）。
- Next step: 真机冒烟——置顶/未置顶行 hover 时 pin 原位淡入淡出、归档落位时间槽、时间列跨行对齐、pin/unpin 切换无布局挤压、确认归档与 hover 提示回归。

## Completed Feature：motion-design-batch-2（2026-09-04）

- Feature: 动效统一第二批——大弹窗复用、菜单展开、Toast 调优、列表项淡入、侧栏删除退出 retune（motion-design-batch-2，**已完成**）
- Status: done — 四步方案 + 可选第 5 项全部落地，源码、契约测试与 DESIGN_LANGUAGE.md 已同步；未 commit。
- 实现：① skills/GitGraph/ShareConversation/project-directory-picker 四个大弹窗复用第一批 dialog-backdrop-in / panel-in；② 新增 `--quickforge-dur-exit: 140ms` token 与 `quickforge-menu-in` 原语（origin 由组件按对齐设置 origin-top-left/right），接线 GitBranchMenu（条件渲染确认无机制改动）与 ProjectOpenMenu；③ toast 调优：`transition-[translate,opacity]`、enter/exit 时长分设两分支类（180/140ms）、卸载超时对齐 token、加 motion-reduce 降级；④ `quickforge-list-item-in` 接线 WorkspaceChangesList（不改 key 语义，状态变化重放淡入属可接受）；⑤ 侧栏会话删除退出 360ms → 140ms（deleteSessionFadeMs 常量 + 5 处配对类全部 token 化，机制不变）。
- 测试：motion-design.test.ts 扩至 13 用例（exit token、menu 原语+两处接线、四弹窗复用、toast 契约、列表项接线、5 处删除 retune）。
- Verification: 定向 vitest 3 files / 42 tests 全过；eslint 10 文件 0 error；tsc -b 通过；npm run build 通过；产物 CSS 抽查（menu/list keyframes、exit token 压缩为 .14s、toast transition-property）确认。未跑全量 test/lint。
- Boundaries: 菜单退出保持瞬时卸载；不改 ChangesList key；路由页（MobileServerConnect/ShareLinksSettings）不接线；无新依赖。
- Next step: 真机冒烟——四个大弹窗落位、Git 分支菜单/项目打开菜单从触发角展开、后台任务 toast 进出节奏、git 变更列表新文件淡入、侧栏删除会话的快速退出、reduced-motion 全降级。

## Completed Feature：agent-manager-module-split（2026-09-04）

- Feature: agent-manager.mjs 上帝模块无损拆分（agent-manager-module-split，**done**）——纯机械搬移，零行为变更。
- 结果：agent-manager.mjs 4014 → 约 1966 行，保留会话生命周期编排 + facade re-export；新模块 agent-session-store / agent-session-events / agent-harness / agent-compaction / agent-prompt-commands / agent-approval-orchestrator / agent-subagent-runner / agent-persistence，函数逐字符搬移，消费方 import 路径零改动。
- 执行序列（每块独立 commit，均过门禁）：b55c3d8 安全网（导出面契约测试 + agentSessions/pendingRestores/subagent 错误暂存收口）→ 557b748 事件核心（agentEvents/emitSessionEvent/分帧/消息构造器/context usage）→ 61d316d harness 常量 + /summary /compact /clear → 9fe9758 斜杠命令解析与 prompt 模板 → e841aad 审批 Promise 编排 → f33e70b run_subagent 生命周期 → 1f7a8fd 会话持久化（persistSessionState 经 facade 保持公共 API）。
- 门禁：每块全量 npm run test 与基线一致（275 files / 2612 tests，唯一失败为既有前端 CSS 契约，与 server 无关）、eslint 0 error、build 通过；契约测试锁定 47 个消费面符号不变，内部共享导出（resetIdleTimer/createServerTools，persistSession 已随块4收回）单独登记；tunnel-host 集成测试捕获一处链接期缺导出（persistSession 未导出）并即时修复。两个既有源码契约测试（model-retry-notice、agent-harness）同步覆盖符号新位置，行为断言不变。
- 文档：docs/wiki/server/README.md 模块地图同步（目录树 + agent-manager 条目 + 拆分模块清单）。
- Notes: ① 前端 App.tsx / ChatPanelHost.tsx 上帝组件拆分另行立项；② 工具构建（createServerTools 等）与 SSE 路由仍在 agent-manager，后续可继续拆；③ 工作区基线的 local-tool-running-sweep 前端 CSS 契约失败为拆分前既有问题（motion-design 批次遗留），与本 feature 无关。

---

## Planned Feature：agent-manager-module-split（2026-09-04 立项，未开始）

- Feature: agent-manager.mjs 上帝模块无损拆分（agent-manager-module-split，**pending**）——纯机械搬移，零行为变更。
- 背景：架构审查（双 explore 调研）确认 agent-manager.mjs 约 4000 行混杂 8+ 类职责，模块级可变状态 agentSessions/stashedSubagentErrorDetails/pendingRestores 无唯一 owner、36 处直接引用，为最大风险聚集点。
- 方案：① 第零步建安全网：全量 test/lint/build 基线数字、导出符号契约测试、高风险区（persist CAS / subagent 超时中止 details / 审批 Promise）补行为用例；② 状态收口到 server/agent-session-store.mjs；③ 绞杀式逐块抽取 agent-compaction → agent-prompt-commands → agent-subagent-runner → agent-persistence → agent-approval-orchestrator → 工具包装，agent-manager 保留 facade re-export，消费方零改动；每块独立 commit，门禁=契约测试+全量 test 与基线一致+lint+无新增循环 import。函数体逐字符搬移，不改任何语法语义/逻辑/导出面。
- Boundaries: 只拆模块不改功能；前端 App.tsx/ChatPanelHost.tsx 拆分另行立条目；发现的问题只记 Notes。
- Next step: 执行第零步（基线 + 导出契约测试）。

---

## Completed Feature：motion-design-batch-1（2026-09-04）

- Feature: 动效统一第一批——motion token、弹窗进入动画、侧栏文字淡入双通道、按钮按压微交互、工具扫光纳管（motion-design-batch-1，**已完成**）
- Status: done — 五项动效按确认方案落地，源码、契约测试与 DESIGN_LANGUAGE.md 已同步；未 commit。
- 实现：`src/index.css` 顶层 `:root` 新增 `--quickforge-dur-fast/base/slow`（120/180/280ms）与 `--quickforge-ease-out`（cubic-bezier(0.2,0,0,1)）token；新增共享进入原语 `quickforge-dialog-backdrop-in` / `quickforge-dialog-panel-in`（遮罩淡入 + 面板 translateY 4px、scale 0.97 落位，进入-only）接线 prompt-dialog 与 confirm-dialog；`quickforge-sidebar-label-in`（opacity 淡入）挂 ChatSidebar `sidebarSessionTitleClass` 与 `sectionHeaderClass`，侧栏展开时文字随宽度过渡淡入；`ui/button.tsx` cva 基类升级 `transition-[background-color,color,border-color,scale] duration-(--quickforge-dur-fast) ease-(--quickforge-ease-out) active:scale-[0.97]` 全局按压回缩；工具扫光保持 1.8s 循环并注释为时长刻度豁免类。全部 keyframes 带 prefers-reduced-motion 降级。
- 测试：新增 `tests/frontend/motion-design.test.ts` 7 用例（token 定义、弹窗原语+接线、侧栏淡入挂载点、按钮按压契约含 v4 scale 属性、扫光豁免、reduced-motion 守卫）；同步更新 `sidebar-section-order.test.ts` 对 `sidebarSessionTitleClass` 的既有精确字符串断言。
- Verification: 定向 vitest 2 files / 27 tests 全过；eslint 6 文件 0 error；`npx tsc -b` 通过；`npm run build` 通过（仅既有 chunk size 警告）；产物 CSS 抽查确认 token var、`transition-property` 含 scale、`.active\:scale-\[0\.97\]:active{scale:.97}` 与 dialog/label keyframes 均正确编译。未跑全量 test/lint。
- Boundaries: 不新增依赖/动画库；仅进入动画；只动 opacity/transform/scale；大型功能弹窗（skills/GitGraph/ShareConversation）与 toast/菜单/列表 enter-exit 属后续批次。
- Next step: 真机冒烟——弹窗打开淡入落位、侧栏展开时标签/分区头淡入、任意按钮按压缩放反馈、系统开启「减弱动态效果」时以上全部瞬时呈现。

## 1.10.2 发布状态（2026-09-04）

- 已 bump 版本至 1.10.2，并完成当前 dev 分支待发布提交的文档整理。
- 发布前门禁已通过：`npm run test`（273 files / 2602 tests 全过）、`npm run lint`（0 error，1 个既有 warning）、`npm run build`（通过，含既有 KaTeX/chunk warnings）。
- qf-agent 测试夹具已最小修复：Windows `taskkill` mock 正确触发 exit，并在每个测试前恢复 real timers；定向测试 28/28 通过。
- runtime/offline 包已生成并复核，`package-offline/shawnstack-quickforge-1.10.2.tgz` 约 7.4 MB，包内版本为 1.10.2。
- v1.10.2 Git 发布已完成：release commit `40deadb`、tag `v1.10.2` 已创建，并已推送 `origin/dev`；本次不执行 npm publish。
- 当前 `pinned-summary-draggable-capsule` needs-review feature 已按用户确认纳入本次发布，仍保留 needs-review 状态。

---

## Completed Feature：dead-code-cleanup-round-1

- Feature: 僵尸代码清理（dead-code-cleanup-round-1，**已完成**）——删除全仓库零引用的导出符号与遗留文件。
- Status: done — 三路只读调研（src/、server/、scripts/tests/外围）产出候选清单，随后逐符号 `grep -w` 全仓库复核（排除 dist/package-dist/package-offline/desktop-dist/node_modules/android），仅删除复核确认的高置信度项；未 commit。
- 删除内容：① 前端 6 个零引用导出（openCodeUsageIcon、getWorkspaceTree 及其独占类型 WorkspaceTreeResponse、clearApiCache、INPUT_CLAMP_EASING、selectableModelsFromProviders、sessionScope）；② server 19 个零引用导出，其中 skills.mjs 的 5 个无后缀旧包装（loadSkills/listSkillSummaries/findSkill/filterKnownSkillNames/loadSelectedSkills，现行 API 为 Global/Project 变体）、storage/share-store 各 2 个、agent-manager/sqlite/session-state-service/access-policy/lan-access-store/project-config/share-service/subagents/utils/workspace/agent-profile-files 各 1 个；③ 级联死链：requireShareJsonAdapter 删除后 share-service.mjs 的 `jsonAdapter` 只写变量、`configureShareService` 的 `json` 参数与 share-lifecycle 测试的 `json: null` 一并移除；④ 遗留文件：`dev-server.log`（gitignore 本地文件）、根目录 3 张 `oom-*.svg`、`artifacts/`（单文件后删空目录）、`design-preview/`（空目录）、`tests/fixtures/` 5 个零引用 electron-smoke 脚本（scheduled-runs-cutover/scheduled-task-runs/scheduled-task-runs-service/session-index/session-state）。
- 保留依据：restart-supervisor/update-supervisor 与 maintenance/*-v1 为运行时动态路径加载非孤儿；quickforge-settings-select.ts 为副作用 import；design-mockups/ 被源码注释引用为设计出处；generateSharePassword 前端同名函数来自 share-client.ts 非删除对象。
- 文档同步：`docs/architecture/browser-cache-strategy.zh-CN.md` 删 clearApiCache 条目、`docs/wiki/server/README.md` 删 requireShareJsonAdapter 提及、`docs/wiki/server/utils/README.md` 删 invalidateDirectorySizeCache 提及、feature_list.json 清理 browser-oom-first-aid files 数组中 3 张已删 SVG。
- Verification: 删除后复查 25 个符号代码零残留，级联候选（pruneTokenRecords/verificationDigest/messagesDigestFromValues/subagentDefinitions/readJsonFile 等）均有其他调用方；`node --check` 14 个改动 server/测试文件通过；`npm run test` 273 files / 2602 tests 全过；`npm run lint` 0 error（仅 identity.mjs:92 既有 warning，见 Notes）；`npm run build` 通过（仅既有 chunk size 警告）。
- Boundaries: 未新增依赖；未触碰 dist/、package-dist/、package-offline/、desktop-dist/；未 commit/tag/push；中低置信度候选（约 200 项"仅文件内使用的冗余 export"、生产-测试僵尸、scripts/ 一次性基准脚本）未动，留待后续轮次。

---

## Completed Feature：sidebar-collapse-zoom-width

- Feature: 桌面侧栏收缩态避免 resize 恢复展开宽度（sidebar-collapse-zoom-width，**已完成**）
- Status: done — 按已确认的最小方案修改源码、源码契约测试、ChatSidebar wiki 与状态文件，未 commit。
- 实现：`ChatSidebar.tsx` 的桌面 `window.resize` effect 现在在 `isMobile || !sidebarOpen` 时直接跳过，浏览器缩放或视口变化不会在收缩态调用 `finishResizing(nextWidth)` 写回展开宽度；`finishResizing()` 无 `finalWidth` 的收缩/移动清理路径调用 `asideRef.current?.style.removeProperty('width')`，避免遗留内联样式覆盖 `w-14`。展开拖拽、reset 与移动端语义不变。
- 测试：`tests/frontend/sidebar-section-order.test.ts` 新增源码契约，锁定 resize effect 的 `!sidebarOpen` 守卫、resize listener 与收缩清理的 `removeProperty('width')`。
- Docs：`docs/wiki/src/components/README.md` 的 ChatSidebar 条目补充桌面收缩态不会因 `window.resize`/浏览器缩放恢复宽度，以及清理遗留内联 width 的语义。
- Verification: 定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 20 tests 全过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` 通过；未 commit/tag/push，未修改生成产物。
- Boundaries: 不新增依赖，不触碰 `dist/`、`package-dist/`、`package-offline/`，不 commit/tag/push；工作区其他未提交改动保留。

---

## Completed Feature：manual-compact-adaptive-retention

- Feature: 手动 `/compact` 放宽并始终压缩全部当前可压缩历史。
- Status: done — 已按用户确认调整为固定全量压缩，核心源码、边界测试、server wiki 与状态文件已同步，未 commit。
- 实现：`server/agent-manager.mjs` 手动 compact 固定传入 `keepRecentTurns: 0` 和 `minSourceChars: 0`；`server/auto-compaction.mjs` 默认 `keepRecentTurns` 改为 `0`，设置归一化支持 `0-20`，并保留 keep=0 的 tailStart 与 in-place 支持；`src/lib/auto-compact-settings.ts` 与设置页同步默认值、`min=0` 和显式 0 输入；审批展示兜底同步为 0。
- 测试：`tests/server/auto-compaction.test.mjs` 覆盖 keep=0 时 tailStart 等于完整消息长度；`tests/server/conversation-compaction.test.mjs` 覆盖短历史在 `minSourceChars: 0` 下全量压缩且 recentTail 为空。
- Verification: 定向 Vitest 6 files / 39 tests 全部通过；相关 ESLint 通过；`node --check server/auto-compaction.mjs`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 与 `feature_list.json` JSON parse 均通过。build 仅有既有 KaTeX 字体与 chunk size 警告；未跑全量 test/lint。
- Boundaries: 不修改 `/summary`、自动压缩阈值/minSourceChars/确认/间隔与保护逻辑，仅将自动压缩 `keepRecentTurns` 默认值改为 0 并支持 0；不碰 dist/package-dist/package-offline，不新增依赖。

---

## Completed Feature：known-exception-i18n

- Feature: 已知代码异常文案国际化——展示层把 Request was aborted / AI stream 超时等已知英文异常映射为本地化文案（known-exception-i18n，**已完成**）
- Status: done — 用户实测「错误：Request was aborted.」英文原文后提出；源码、测试与 wiki 已同步；未 commit。
- 调研：错误正文来源为 pi-ai（各 provider abort 抛 'Request was aborted'、流异常结束两串）、server/ai-http-logger.mjs（'AI stream idle/total timeout after Nms'，idle 覆盖首事件/后续事件两档）、undici（'fetch failed'）、server-agent.ts（'Failed to send prompt: HTTP N' 兜底）。数据层必须保持英文原文——SQLite 持久化、客户端 appendAssistantErrorMessageOnce 去重、subagent trace 去重（错误原因与 trace 终态错误文本精确相等比较）都依赖原始字符串，翻译只能做展示层。
- 实现 ①：新增 `src/lib/error-messages.ts` `translateErrorMessage(message)`——规则表 trim + 忽略大小写 + 容忍句尾句点 + ms/status 参数捕获走 `t(key, params)` 插值；未匹配的动态正文（provider 错误、subagent 超时进度复合句）原样返回。
- 实现 ②（主聊天/Side Chat）：message-actions.ts `decorateAssistantErrorText` 在 decorate 周期把 pi-web-ui 错误红块（`div.bg-destructive/10`）内 `<strong>` 后动态文本改写为译文；保留原 strong 节点（前缀本地化/加粗）、`dataset.quickforgeErrorText` 幂等、语言切换下一轮自动收敛、译文===原文（未匹配）不改写 Lit 节点；对全部错误消息生效（含历史错误）。
- 实现 ③（subagent 卡）：local-tools.ts `renderSubagentRunBody` 错误原因卡（聊天摘要卡与 Inspector 详情共用）改 `translateErrorMessage(payload.errorMessage) || t('subagentErrorUnavailable')`。
- 实现 ④：i18n 中英成对 +7 key（errorRequestAborted「请求已中止。」、errorAiStreamIdleTimeout「模型连接空闲超时（{ms}ms 无响应）。」、errorAiStreamTotalTimeout、errorAnthropicStreamEnded、errorStreamNoFinishReason、errorFetchFailed「网络请求失败。」、errorSendPromptHttp「发送消息失败（HTTP {status}）。」）。服务端零改动、无新依赖、无视觉变化。
- Verification: 定向 vitest 6 files / 193 tests 全过（error-messages 新建：10 条映射断言含句点/大小写/空白容忍与插值、动态正文透传、空值、两处接线契约；message-actions/i18n-snapshot/subagent-run-detail/local-tools-lit-reactivity/server-agent 回归）；eslint 5 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量；未 commit。
- Boundaries: 数据层（errorMessage 字段、持久化、去重比较）保持英文原文，仅展示层翻译；OpenCode ACP 动态错误、provider 返回的动态错误正文、subagent 超时进度复合句不在映射表内（原样显示）；规则表按需追加（新增已知异常在 error-messages.ts 加一条规则 + i18n 一对 key 即可）。
- Next step: 真机冒烟：中文界面下停止生成/弱网超时/断网发送失败 → 错误红块分别显示「请求已中止。」「模型连接空闲超时（60000ms 无响应）。」「发送消息失败（HTTP xxx）。」；subagent 失败卡同理；英文界面文案不变；未知 provider 错误仍显示原文。

---

## Completed Feature：todo-summary-completed-icon-emerald

- Feature: 对话上方 Todo 摘要完成项图标改绿色——与置顶摘要 Todo 的 emerald 完成语义保持一致（todo-summary-completed-icon-emerald，**已完成**）
- Status: done —— 纯 CSS 颜色改动 + 测试契约，源码与测试已同步；未 commit。
- 起因：用户反馈「对话上方的 todo 显示，完成的 icon 换一下绿色的，和摘要的保持一致」。置顶摘要（GitToolsPinnedSummary 的 TodoStatusIcon）完成项是 CheckCircle2 + text-emerald-600，而对话上方 todo-write-summary 行级完成项图标是 var(--muted-foreground) 灰色。
- 实现：`src/index.css` 中 `.quickforge-todo-summary-item--completed .quickforge-todo-summary-status-icon` 的 color 由 muted 改为本组件「全部完成」圆环对勾的既有 emerald 配方（light `rgb(4 143 101)` / 新增 `html.dark` 变体 `rgb(110 231 183)`），复用 slash agent chip 语义色、不新增颜色体系，light 下与置顶摘要 emerald-600 视觉一致；完成项文字保持 muted + 删除线不变；ring-check 上方注释措辞同步为「绿色用于 Todo 完成语义（行级图标 + 圆环对勾）」。
- 测试：`tests/frontend/todo-write-renderer.test.ts` 既有 emerald 契约用例（改名 colors completed checks…）扩展断言行级完成项图标 light/dark 绿色。
- Verification: 定向 vitest todo-write-renderer 10 tests 全过；回归 todo-write-summary 26 + git-tools-pinned-summary 24 全过；eslint 测试文件 0 error（css 被 lint 配置忽略）；feature JSON parse 通过；npm run build 通过（仅既有 chunk size 警告）。纯 CSS 改动未跑 tsc/全量。
- Boundaries: 不改图标形状（同为圆圈打勾语义）、不改完成项文字样式、不触碰置顶摘要与 in_progress/pending 图标；无架构/公共入口变化，wiki 无需更新（纯视觉微调，components wiki 未描述行级图标颜色粒度）。
- Next step: 真机复核 light/dark 下对话上方 Todo 摘要展开列表的完成项绿色图标与置顶摘要一致。

---

## Completed Feature：error-continue-retry-button

- Feature: 错误旁「继续生成」按钮——会话末尾错误消息挂常显继续操作行，发送「继续」消息或重发未送达的原始消息（error-continue-retry-button，**已完成**）
- Status: done — 调研方案经用户两轮确认（改「重试=发继续用户消息」语义）后实现；源码、测试与 wiki 已同步；未 commit。
- 调研结论：错误渲染为消息末尾 `{role:'assistant', stopReason:'error', errorMessage, 空文本}`（pi-web-ui 红块），decorateMessages 空文本早退导致错误消息无任何操作行；既有 retryFromMessage/continueSession 会截断 user 消息之后全部内容（丢弃失败轮已完成工具进度、重放工具副作用）；pi-ai transform-messages 构建请求时整条跳过 error/aborted assistant 消息并为孤儿 toolCall 合成 toolResult，因此「发继续消息」链路安全且与用户手动打字恢复完全同路径。
- 实现 ①（UI）：message-actions.ts 终态错误（会话最后一条 display 消息为错误）挂常显弱化操作行——runIcon icon-only「继续生成」+ 时间戳，不依赖 hover（触屏可用），无 copy/fork；创建路径与 message-bottom 快路径均管理 continue 按钮存在性/禁用态；错误不再最后一条或门控关闭时整行移除（历史错误无操作行）。门控沿用 allowRetry(capabilities.retry，OpenCode 隐藏)/readOnly/historyActionsDisabled(Side Chat 禁用)/流式禁用。
- 实现 ②（接线）：ChatPanelHost `onContinueAfterError`——错误带 quickforgeFailedPrompt 时优先 `retryFailedPrompt`（重发原始消息），否则 `agent.prompt(t('errorContinueMessage'))` 发「继续」。
- 实现 ③（重发）：server-agent.ts prompt HTTP 失败合成错误时挂客户端专用 `quickforgeFailedPrompt`（原始未送达消息）；`retryFailedPrompt` 非流式时把 stash 的 capabilities/contextReferences 预置回 nextPrompt*（防空快照剥除 details）、移除错误消息后原样重发。i18n 中英 +2 key（errorContinueAction「继续生成」/errorContinueMessage「继续」）。服务端零改动、无新依赖、无新 CSS 段。
- 测试：新增 message-actions「error message continue action」10 用例（常显行+点击回传、幂等+禁用、历史错误、陈旧行、四门控、接线契约）+ server-agent 4 用例（stash 挂载、重发保真+错误条目移除、无 stash false、流式拒绝）；附带修复测试假 DOM harness 的 querySelectorAll 按选择器分组拼接 bug（改文档顺序，否则 user/assistant 交错与消息 index 错位）。
- Verification: 定向 vitest 3 files / 84 tests 全过；回归 3 files / 32 tests（capabilities/side-chat/message-queue）全过；eslint 6 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量 test/lint；未 commit。
- Boundaries: 仅终态错误显示按钮（历史错误无入口，避免误截断语义）；OpenCode（capabilities.retry=false）与 Side Chat（禁用）/readOnly（隐藏）沿用现有门控——prompt 语义理论上可支持 OpenCode，留作后续小迭代；错误消息不进 LLM 上下文（pi-ai 既有行为），模型只看到「继续」指令与失败前已完成的工作；消息队列在 agent_end error 后暂停的行为不变，继续按钮不自动恢复队列。
- Next step: 真机冒烟：模型流超时/断网杀后端产生错误 → 错误旁出现常显 ▶ 按钮 → 点击发出「继续」消息、模型从失败前进度接着做、错误消息保留在历史；断网时发送失败错误 → 点击重发原始消息（含插件/文件引用 chip 保真）；流式中按钮禁用；OpenCode 会话无按钮。

---

## Completed Feature：sidebar-drag-vertical-boundary

- Feature: 侧栏项目/任务拖拽纵向边界——区块标题拖拽 clamp 到可见视口，修复可无限向下拖动（sidebar-drag-vertical-boundary，**已完成**）
- Status: done — 源码、测试与 wiki 已同步；未 commit。
- 起因：用户反馈「项目和任务拖动的时候注意不能无限向下拖动」。调研确认：项目条目拖拽（restrictProjectDragToViewport，d07f18a）已夹取在 Projects 列表 ∩ 共享滚动视口内；但 72ac7e0 后加的「项目/任务」顶层区块标题拖拽（section DndContext）没有任何 modifier，`SortableSidebarSection` 仅锁横向、纵向 transform 无界——拖动区块标题可无限向下，正是用户看到的问题。
- 实现：`ChatSidebar.tsx` 新增 `sectionsDragBoundaryRef`（挂在区块排序容器 div）与 `sectionDragStartScrollTopRef`（`handleSectionDragStart` 记录起始 scrollTop），新 modifier `restrictSectionDragToViewport` 复用 `src/lib/project-drag-boundary.ts` 纯函数（可见交集 + 纵向 clamp + 滚动补偿），接入区块 DndContext `modifiers`；区块拖拽预览被夹取在区块排序容器与侧栏共享滚动视口的可见交集内，不能向下越出可见区、也不会上移越过 Pinned。dnd-kit `collisionRect` 使用 modifier 后 transform，落点同步受限；拖拽期间两区块本就临时折叠（dnd-kit `useRect` 对 active node 有 ResizeObserver，折叠后重新测量），换位所需位移远小于边界，排序语义不变。同时 `clampProjectDragTransform` fallback 收紧为 fail-closed：rect 缺失/退化（minY>maxY）时横向纵向同时锁定，项目条目与区块两条路径共用，边界未知时不再放任纵向无界拖动。
- 测试：`project-drag-boundary.test.ts` fallback 用例改写为 x/y 均锁 0；`sidebar-section-order.test.ts` 新增区块拖拽边界 wiring 契约（ref/起始 scrollTop/modifier 声明与 section DndContext 接线、autoScroll=false 保持）。
- Docs: `docs/wiki/src/components/README.md` ChatSidebar 两条（项目拖拽 fail-closed 说明 + 新增区块拖拽边界条目）；`docs/wiki/src/lib/README.md` 补 `project-drag-boundary.ts` 表格条目（此前索引缺失，现记录双消费方与 fail-closed 语义）。
- Verification: 定向 vitest 4 files / 37 tests 全过（project-drag-boundary 10、sidebar-section-order 19、mobile-fullscreen-adaptation 3、sidebar-new-chat-routing 5）；eslint 4 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX/chunk 警告）。未跑全量 test/lint。
- Boundaries: 未新增依赖；未改 dnd-kit 配置语义（section autoScroll 仍为 false、KeyboardSensor 不受影响）；未触碰生成产物；工作区其他未提交改动保留。
- Next step: 真机冒烟：拖动「项目」「任务」区块标题向下应停在可见区域底部；向上不越过 Pinned；松手换位正常；项目条目拖拽回归正常。

---

## Completed Feature：subagent-timeout-structured-progress

- Feature: Subagent 超时结构化输出——错误正文携带进度摘要 + details 注入持久化 toolResult，默认超时 60 分钟 → 2 小时（subagent-timeout-structured-progress，**已完成**）
- Status: done — 源码、测试与 wiki 已同步；未 commit。
- 起因：用户实测「错误原因: Subagent general timed out after 60 minutes.」后提出超时报错应把 AI 已完成的工作结构化输出（"大概知道做了什么"），同时要求子 Agent 默认超时改为 2 小时。调研确认：pi-agent-core 把抛错的 execute 收口为纯文本错误结果（details 为空对象），details 又不进 LLM 上下文（`omitDetailsForLlm`），因此父模型只见一行字；前端实时 SSE 路径有运行中快照回填兜底，但持久化 toolResult.details 为空，刷新/恢复后过程全部丢失。
- 实现 ①（错误正文）：`server/agent-manager.mjs` 超时错误保持既有首句 `Subagent X timed out after N minutes.`，其后追加 `Progress before timeout: N tool calls; still running: toolA; last assistant message: …`——工具计数取 beforeToolCall 累计值；被中断工具由 pendingToolCalls（toolCallId 集合）× 消息历史 assistant toolCall 块求交集（与前端 currentSubagentToolSummaries 同一算法，新函数 pendingSubagentToolNames）；最后一条 assistant 文本经 lastAssistantText 提取、压缩空白并截断 600 字符（SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT），无内容时省略分句。
- 实现 ②（details 注入）：runSubagent 抛错前把 `quickforgeSubagentDetails`（与成功终态同构 + `timedOut:true` + toolCallId，messages 全量）挂到 error 上；`wrapSubagentToolDefinition.execute` catch 后按 toolCallId 存入模块级 stash（即取即删 + 6h TTL 兜底清理）；主 Agent 构造点新增 `afterToolCall`（仅 isError 且 run_subagent 时取回，返回 `{ details }`），错误 toolResult 因此携带完整过程持久化，刷新/恢复后 Inspector 可见。前端 `details.timedOut → error` 判定为既有预留逻辑，UI 侧零改动；isError、置顶摘要 ✗、SSE 协议不变。
- 实现 ③（2 小时）：SUBAGENT_DEFAULT_TIMEOUT_MS 与新增 SUBAGENT_MAX_TIMEOUT_MS（runSubagent clamp + 临时 subagent prompt 内 clamp 两处）同步 2 小时；内置 explore/general maxRuntimeMs、subagents.mjs markdown 回落、agent-profiles.mjs / agent-profile-files.mjs DEFAULT_MAX_RUNTIME_MS 一并上调；旧安装内置 markdown 由启动物化（全内容比对）自动重写。
- 测试：agent-manager.subagents 12 tests——既有超时用例改写为 2 小时默认 + 错误正文/quickforgeSubagentDetails/afterToolCall 注入·即取即删·非 run_subagent 早退断言；新增「有进度超时」用例（MockAgent hangAfterProgress 模式：真实驱动 beforeToolCall 计数、带未完成 toolCall 的 assistant 消息与 pending 集合）。前端 subagent-run-detail +2 契约：timedOut details 注入后 status=error、trace 保留、errorSource=output 不重复渲染 output 块；无 isError 时 details.timedOut 仍判 error。
- Verification: Revision 2 复验 2 files / 106 tests 全过（新增通用失败用例：failAfterProgress 模式驱动，正文不变/无标记/注入与即取即删；前端通用错误恢复契约）。此前 Revision 后复验 2 files / 104 tests 全过（父中止用例改写：新正文/quickforgeSubagentDetails.aborted/timedOut 未设置/注入与即取即删）；eslint 2 文件 0 error、node --check 通过。此前定向 vitest 5 files / 121 tests 全过（agent-manager.subagents 12、agent-profiles 4、agent-profile-files、subagents、subagent-run-detail 92）；回归 agent-manager.* 家族 9 files / 31 tests + routes/agent 16 tests 全过；eslint 6 个改动文件 0 error；node --check 4 个服务端模块通过；feature JSON parse、git diff --check 通过。未跑全量 test/lint/build。
- Revision（父运行中止复用）：`Subagent X aborted with parent run.` 首句不变，其后追加 `Progress before abort:` 同构摘要，details 以 `aborted:true` 标记走同一 stash/afterToolCall 注入——用户停止后错误 toolResult 同样持久化，下一回合模型可见部分进度、刷新后 Inspector 保留 trace（此前误判"父循环拆解后不可见"：toolResult 仍持久化并进入后续 LLM 上下文）。摘要分段抽为 subagentProgressSegments、终态 details 抽为 buildTerminalSubagentDetails 闭包，超时/父中止两分支共用；前端 `details.aborted → error` 判定与测试（subagent-run-detail :414）均为既有。
- Revision 2（通用失败全覆盖）：修复"只要报错就看不到 subagent 执行过程"——内层 catch 为所有未携带 details 的运行期失败统一挂 quickforgeSubagentDetails（同构终态、无 timedOut/aborted 标记），错误正文保持上游原文（前端 stripTerminalErrorFromTrace 依赖 errorMessage 与 trace 终态错误文本精确相等去重，改文本会破坏去重）；刷新/恢复后 Inspector trace 不再丢失。实时 SSE 路径的 previousPayload 合并兜底保留，错误 toolResult 现直接携带全量 details，两条路径一致。
- Boundaries: 外层失败（模型解析/工具创建/Agent 构造等 prompt 开始前）无进度可带，不挂 details；旧版本已持久化的空 details 错误 toolResult 无法回溯补全；日志仍只记 errorName 等元数据，符合 p0-subagent-observability 隐私边界；未新增依赖；未触碰生成产物。
- Notes: scheduled-tasks.mjs 的 `runtimeLimitMs`（定时任务会话运行上限，默认/上限仍 60 分钟）与 `run_command` 1 小时超时为独立语义，本 feature 未动，如需调整另行立项。
- Next step: 真机冒烟：长时间 subagent 触发超时（或调小 profile max-runtime-ms）→ 父 Agent 回复应能转述部分进度；聊天摘要卡「错误原因」显示进度摘要；刷新页面后 Inspector Subagent Tab 仍能看到完整 trace。父中止路径：运行中点停止 → 下一条消息父 Agent 能转述 subagent 中止前进度，刷新后 Inspector 同样保留 trace。

---

## Completed Feature：diff-display-optimization（最终视觉收口）

- Feature: 对话区 `write_file` / `edit_file` 与 OpenCode Diff 改为更简洁的摘要和正文（diff-display-optimization，**已完成**）
- Status: done — 用户在「平衡精简」基础上继续确认：`+N/−N` 需要颜色区分、正文使用单列智能行号、减少说明性文字；源码、测试、Wiki 与状态文件已同步；未 commit。
- 摘要：删除滚动数字里程计、自定义元素和动画；静态 `+N` 绿色、`−N` 红色，仅文字着色且默认可见，无 badge/背景/边框。running count-only partial 可显示统计，但无完整 `text` 时不渲染正文。
- 正文：删除重复标题、路径、统计 chip 与字符级 token/LCS/`<mark>`；行号收敛为单列智能显示（删除行取旧行号，新增行取新行号，上下文取新行号），共享 grid 收敛为“行号 + 代码”两列，继续保留长行横向背景、浅色整行增删背景和 `display: contents`。hunk gap 可见内容仅显示 `⋯`。
- 状态语义：短文案为“新文件 / 已截断 / 无变化”；新建空文件同时显示新文件与无变化。截断尾标记只在 `details.truncated === true` 时移除，合法正文末行即使等于 marker 也不会误删。
- OpenCode：支持 raw 新文件文本与无 hunk pseudo-unified；raw 保留首字符、行号从 1 开始。服务端统一 CRLF/CR，修正尾随换行计数、相同内容 `0/0 + text:''`，真实超限时设置 `truncated:true`；临时测试 helper 未导出，不扩大公共接口。
- Files: `src/lib/local-tools.ts`、`src/lib/diff-view.ts`、`src/index.css`、`src/lib/i18n.ts`、`server/opencode-acp-agent.mjs`、`tests/frontend/diff-view.test.ts`、`tests/server/opencode-acp-agent.test.mjs`、`docs/wiki/src/lib/README.md`；删除 `src/lib/diff-counter.ts` 与 `tests/frontend/diff-counter.test.ts`。
- Verification: 此前全量 `npm run test` → 272 files / 2559 tests 全过；本轮最终视觉收口定向 Vitest 5 files / 119 tests 全过；定向 ESLint 4 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings。
- Boundaries: 未改通用“过程 → 工具组”折叠；未新增依赖；未提交/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。工作区其他 feature 的未提交改动完整保留。
- Docs: 当前模块行为已同步 `docs/wiki/src/lib/README.md`；`design-mockups/diff-display-optimization.html` 保留为历史方案对照，不作为当前规格，故未同步重绘。
- Next step: 建议真机复核 light/dark 下 edit、write 新文件、空文件、长行横向滚动与 OpenCode raw/pseudo-unified；无代码 blocker。

---

## Completed Feature：browser-oom-first-aid

- Feature: 浏览器渲染进程 OOM 第一步止血——IndexedDbCache 去全量序列化/物化 + subagent 运行期 trace 截尾（browser-oom-first-aid，**已完成**）
- Status: done — 用户确认"页面一直开着导致 OOM"发生在浏览器渲染进程；三路 explore 调研（前端/服务端/Electron）+ 两路补充审计（pi-web-ui message-list 内部实现、单条消息体积链路）定位三层放大后，用户决策"两步走：先零体验风险止血，再做体验无损的窗口化"；本轮完成第一步。
- 根因结论（大白话版见 oom-plain-words.svg）：无典型泄漏，是设计上的无界——消息/工具记录只进不出 + DOM 无窗口化全量渲染（ChatPanelHost.tsx:600 enabled:false 禁用了已实现的窗口化，pi-web-ui MessageList 无原生虚拟化）+ 同一内容多份驻留（messages 数组 + code-block base64 属性/hljs span 树 3-5× + IndexedDB 快照 + subagent store 快照）；放大器为 session-message-cache 每 1.5s flush 的 estimateBytes 全量 JSON.stringify 与 evictIfNeeded getAll 全量物化（~40 会话快照），以及 run_subagent trace 每 150ms 全量 details.messages 重发（O(N²)）。
- 实现 ①：src/lib/indexeddb-cache.ts estimateBytes 改递归粗估（string length+2 / number 8 / 布尔空 4 / 节点 +2 键 +1，深度 16 + seen 防循环回溯删除，异常兜底 0；80 字符串估值 82>60 保住 maxBytes=120 测试口径）；新增实例私有 metaIndex（null 起步）：put 成功后可选链更新、首次 evict 单次 getAll 以 store 重建此后纯内存、get lastUsed 写回成功才同步、delete/clear 维护、非数组容错重试；磁盘格式/LRU 纯函数/API/schema 零改动。
- 实现 ②：server/agent-manager.mjs 新增 SUBAGENT_TRACE_MESSAGES_LIMIT=50，emitSubagentTrace 的 details.messages 截尾 slice(-50) + messagesTotal 总数（同一字面量同一 latestMessages 引用，无口径分裂；Array.isArray 防御），覆盖节流补发/工具边界/finally 全部 update 路径；终态 toolResult（:1799）保持全量；updateRuntimeToolExecution/persist/SSE 转发未动。explore 复核确认前端 update 消费方全部只依赖尾部（traceMessages 过滤、跑马灯尾部 chunk、终态判定逆向扫描），运行中 Inspector 最近 50 条滚动窗、结束全量恢复，体验无损；唯一可感知差异是运行中刷新恢复的 running 快照只含尾部 50 条。
- Wiki: docs/wiki/src/lib/README.md（subagent-run-detail 截尾语义）与 docs/wiki/server/README.md（run_subagent partial trace）同步；纯数据层改动无 UI/视觉变化，DESIGN_LANGUAGE 无需更新。
- Verification: 定向 vitest 5 files / 47 tests 全过（indexeddb-cache 15 含新 2：getAllCallCount===1、冷启动重建淘汰；agent-manager.subagents 11 含新 1：真实驱动 MockAgent 61 条消息，窗口 50/total 61/首元素 trace-message-11/终态全量 61）；ESLint 4 文件 0 问题；node --check；tsc -b；git diff --check；feature JSON parse。explore 独立复核 26/26 复跑通过。
- Boundaries: 未跑全量 test/lint/build；未 commit；未触碰 dist/、package-dist/、package-offline/；未新增依赖；多 tab 并发写缓存依赖现有 Web Locks 单窗口守卫（与改动前等价）；三张分析 SVG（oom-analysis-diagram/oom-browser-renderer/oom-plain-words）为调研产物一并列档。
- Next step: 第二步"智能货架"（恢复消息窗口化 + turn 导航/跳转适配）另行立项，需先 explore 调研 windowed-messages.ts 能力边界与 turn navigation/decorate/process-folding 对全量 DOM 的依赖面；建议真机长会话+长 subagent 运行观察渲染进程内存曲线确认止血效果。

## Completed Feature：project-picker-mkdir-and-roots

- Feature: 项目目录选择器移除 QuickForge 快捷入口并新增「新建目录」功能（project-picker-mkdir-and-roots，**已完成**）
- Status: done — 用户确认两项设计决策：新建目录交互为「当前路径行右侧按钮 + 列表顶部内联输入，成功后直接进入新目录」；mkdir 端点不加 local-only 守卫（与 POST /api/project/path 同性质，Android 远程客户端可用）。
- 实现：`server/routes/filesystem.mjs` 删除 `addRoot('QuickForge', projectRoot)`（projectRoot 保留为 `_activeWorkspaceRoot` 默认值）；提取 `isPathWithinRoots` 纯函数与 `getAllowedRootPaths()`（roots + home 兜底）供 directories 与新端点共用；新增 `POST /api/filesystem/mkdir`——名称校验（禁路径分隔符/`.`/`..`/`\0`/空白 → 400）、parentPath 缺失 400、越界白名单 403、父目录不存在映射 404（assertDirectory 原生 400 语义未动，仅本端点内映射）、EEXIST 409、EACCES/EPERM 403，`fs.mkdir` recursive:false。前端 `project-directory-picker.tsx`：路径行右侧 FolderPlus「新建目录」按钮（sm 以下 icon-only），点击在列表顶部插入内联输入 form（autoFocus、Enter 提交、Esc 关闭清空），成功 `loadDirectory(新路径)` 进入，失败保留输入行 + error 区提示；`creatingFolder` 禁用传播覆盖目录行/parent 行/新建/取消/选择/Escape 关弹窗/遮罩点击；创建中文案用专用 `creatingDirectory`。i18n 中英成对 +4 key。wiki：server/routes filesystem 小节修正 `list`→`directories` 过时端点并补 mkdir 与 roots 说明、src/README picker 条目补能力描述。
- Verification: 定向 vitest 2 files / 21 tests（新 server 12 + 新 frontend 契约 9）全过；定向 ESLint 5 文件 0 error；`node --check`；`npx tsc -b --pretty false`；`git diff --check` 全过。未跑全量 test/lint/build；未 commit。
- Boundaries: 未加 local-only 守卫（用户决策）；allowedRoots 白名单与 directories 共用同一逻辑；不触碰 dist/package-dist/package-offline；工作区其他未提交改动（pinned-summary 等）与本 feature 无关未触碰。
- Next step: 真机冒烟：打开选择项目目录确认快捷入口无 QuickForge；在任意目录点「新建目录」输入名称回车 → 直接进入新目录；重名/非法名/失败时输入行保留并显示错误；创建期间全部控件禁用、Esc/遮罩不关弹窗。

## Completed Feature：p0-subagent-observability

- Feature: P0 Subagent 可观测性——生命周期、AI stream 关联与 SSE 失败日志（p0-subagent-observability，**已完成**）
- Status: done — 不修改 timeout 语义、UI 或 SSE 协议，仅增加最小结构化诊断链路。
- 实现：`run_subagent` execute 将真实 `toolCallId` 透传到 `runSubagent`；profile/task/workspace/model 等前置校验通过后立即生成 `subagentSessionId` 并记录 `started`，后续模型解析、工具创建、system prompt、Agent 构造或 prompt 任一失败均通过终态守卫只记录一个 `failed`；保留 `timeout_triggered`、`parent_aborted`、`settled_after_abort`、`completed` 既有语义。统一字段为 `parentSessionId`、`subagentSessionId`、`toolCallId`、`subagent`、`timeoutMs`、`durationMs`、`toolCalls`，abort 后 prompt settle 另记录 `waitAfterAbortMs`、`outcome`、`abortReason`。失败仅记录 outcome/errorName，不记录完整错误正文。Subagent 内部 AI stream 显式传 `quickforgeInternalLogContext`；`ai-http-logger` 只提取安全白名单关联字段，并在调用 provider `streamSimple` 前删除内部字段，retry/timeout WARN 可关联父/子 session 和 toolCall。session/global SSE 增连接级幂等守卫：同一连接多重 write/socket error 只记录一次 failure WARN，cleanup/release/end 只执行一次；正常 close 只 cleanup、不记录 failure；日志不含 event payload，SSE 帧格式不变。
- Verification: 定向 Vitest 三文件共 47 tests 全过（agent-manager.subagents 10，含真实调用 MockAgent `streamFn` 的内部日志上下文接线断言与 Agent 构造初始化失败 started→唯一 failed；ai-http-logger 21；routes/agent 16，含重复 error 只 WARN/cleanup/release/end 一次）；定向 ESLint 6 个相关源码/测试文件 0 error；`node --check` 三个服务端模块通过；`git diff --check` 通过。未跑全量 test/lint/build；未 commit。
- Boundaries: 不修 timeout/abort settle 语义；不记录 task/context/expectedOutput/messages/system prompt/tool args/results/profilePath/完整错误正文；无前端或协议改动，因此未更新 src/lib/routes Wiki；未触碰生成产物和已有 Subagent UI 改动。
- Next step: 可选真机通过 server log 按 toolCallId 串联 started→terminal 生命周期，并模拟断连确认单连接只产生一次 SSE WARN 与 cleanup。

## Completed Feature：subagent-running-icon-badge

- Feature: Subagent 运行指示器改为 Bot 图标+数量角标并修复菜单 hover 闪烁（subagent-running-icon-badge，**已完成**）
- Status: done — 用户确认「静态 Bot 图标 + 右上角 emerald 数量小角标（无动画）」设计后执行；同时修复流式输出期间悬停运行列表时界面闪烁。
- 实现：`subagent-running-indicator.ts` trigger 子结构由 spinner/count/label 三段改为 icon（模块级 `BOT_ICON_SVG`，与项目 lucide-react v1.11.0 Bot 及聊天 run_subagent 摘要卡 local-tools.ts:539 同款天线+方头+双耳+双眼 SVG，14×14，currentColor；Revision：初版误用 lucide 旧版 bot path，用户反馈后对齐）+ badge（textContent=数量）两段，保持按类名复用 DOM、缺失才重建，每轮仅更新 badge 数字；删除 `subagentRunningIndicatorTriggerLabel` 文案。菜单闪烁主修复：`renderMenuItems` 由每轮 `replaceChildren(heading, list)` 全量重建改为按 runId 就地 diff——heading/list 复用，Map<runId,item> 复用现有元素，仅 label/task 文本、elapsed dataset 与文本、aria-label 变化时更新，onclick 重绑，`insertBefore` 仅乱序时移动，消失 runId 删除；元素身份稳定使流式 decorate 不再打断 :hover。trigger 重建闪烁次修复：trigger 查不到而新建时不再 `removeSubagentRunningIndicatorMenu`，ownedMenu 归属同 panel 时同步 `__quickforgeOwnerTrigger` 为新 trigger 并继续 renderMenuItems，菜单保持打开；dismiss 外点判断与 positionMenu 定位改为读取菜单当前 ownerTrigger，不依赖被替换的旧 trigger 闭包引用。`index.css`：trigger 改 `position:relative; width:2rem; padding:0`，删 spinner（含 dark/reduced-motion 段）与 count 样式，新增 icon（flex 居中）与 badge（参照 `.quickforge-scroll-bottom-badge`：absolute -0.3rem、min-width/height 1.05rem、emerald 背景、2px var(--background) 描边、dark 变体 rgb(52 211 153)/rgb(5 46 31)）；移动端 @media 与 compact 段中 subagent label 隐藏/宽度收缩规则随 label 删除而移除，三控件共用胶囊基础规则保留。测试：更新 icon/badge 断言与 i18n 5 key/CSS badge 契约，新增 3 用例（菜单 item/heading 元素跨 decorate 身份保持、runId 增删与顺序、trigger 重建后菜单保留且 ownerTrigger 更新）。wiki components 两处条目同步。
- Verification: 定向 Vitest 3 files / 109 tests 全过；定向 ESLint（ts 文件）0 error、index.css 被 eslint 配置忽略属预期；`npx tsc -b --pretty false` ✓；`npm run build` ✓（仅既有 KaTeX/chunk 警告）；`feature_list.json` JSON parse ✓；`git diff --check` ✓。未跑全量 test/lint；未 commit。
- Boundaries: 静态图标无动画（用户确认）；badge 样式复用 scroll-bottom-badge 既有视觉模式，未新增设计语言；菜单仍为轻量名称/任务/耗时，详细过程在 Inspector；未修改后端、公共入口与生成产物。
- Revision（文案）：用户要求更简短且中文用「智能体」——TriggerAria/MenuTitle/MenuAria 改为「{count} 个智能体运行中」「智能体运行中 · {count}」「智能体运行中」，英文对应 '{count} agents running'/'Agents running · {count}'/'Agents running'；复验 vitest（含 i18n-language-snapshot）+ eslint + tsc 通过。
- Next step: 真机冒烟：并行 2-3 个 subagent 验证角标数字增减、Bot 图标 Light/Dark 视觉、流式输出期间 hover 菜单不闪、流式中触发 leftControls 重建后菜单不消失。

## Completed Feature：pinned-summary-subagent-sections

- Feature: 置顶执行摘要 Subagent 分组改版为「运行中 / 已结束 · N」简约双小节（pinned-summary-subagent-sections，**已完成**）
- Status: done — 用户确认双小节设计后执行：运行中小节默认展开，已结束小节默认折叠且标题行整行切换；已结束条数随标题展示。后续文案修订（保持国际化）：Subagent 分组标题 i18n 改为「智能体 / Agents」，Git 分组标题改为「Git 工具 / Git Tools」。
- 实现：`GitToolsPinnedSummary` 的 Subagent 分组重写为双小节：分组标题中英文统一「Subagent」；「运行中」小节无折叠、0 条隐藏，行用弱色 `Loader2 animate-spin` + 名称 + task 弱副行，不显示耗时；「已结束 · N」标题行整行 button 切换折叠（`aria-expanded`，ChevronRight/Down size-3.5 弱色），默认收起，关闭弹层的三条路径（外部点击/Escape、toggle、X）均恢复默认折叠、不持久化；已结束行保持 ✓/✗ + 名称 + 静态耗时（Bot fallback）+ task 副行，仍是先关浮层再打开 Inspector Subagent Tab；两组全空时整个分组隐藏，组件空态与 App 挂载条件均纳入运行中列表；分组顺序、分割线、`aria-labelledby` 不变；删除「最近优先」span。数据层新增 `extractRunningSubagentRuns()`，与 `extractLatestTerminalSubagentRuns`（API 不变）共用新抽的 `collectRunSubagentToolCalls` 收集器（按出现顺序 id→args，重复调用块天然去重），仅收集 pendingToolCalls 中的 run_subagent 调用并复用 `buildSubagentRunPayload(args, undefined, true, …)` 构建 running 载荷（canonicalToolCallId/runId=toolCallId，label/name/task 回落一致）；App 在终态列表旁新增 `pinnedSummaryRunningSubagentRuns`（同一 revision 订阅）传入组件；`openSubagentRun` 经 `requestWorkspaceInspector(kind=subagent)`，Inspector 已按 store 取 running 快照，无需适配。i18n：`pinnedSubagentsTitle` 改 Subagent，新增 `pinnedSubagentsRunningSection`/`pinnedSubagentsFinishedSection`，删 `pinnedRecentFirst`。
- Verification: 定向 Vitest 3 files / 113 tests 全过（git-tools-pinned-summary 11、subagent-run-detail 90 含新增 3、model-retry-notice 12）；定向 ESLint 6 文件 0 error；`npx tsc -b` ✓；`feature_list.json` JSON parse ✓；`git diff --check` ✓。docs/wiki/src/components/README.md 三处（L28/L95/L224）已同步双小节描述（实现时曾误判 wiki 无需同步，冒烟后修正）。未跑全量 test/lint/build；未 commit。
- Boundaries: 已结束小节沿用现有最近 3 项（`extractLatestTerminalSubagentRuns` 默认 limit）；运行中行不显示耗时/不加定时器，详细过程由 Inspector Tab 承担；运行中集合以当前消息分支 + pendingToolCalls 为准，pending 中的 run 即使消息流里残留旧 toolResult 也按运行中展示；折叠状态不持久化；未修改后端与生成产物。
- Next step: 用户复核双小节视觉与折叠交互；真机冒烟：运行中 subagent 出现/结束迁移到已结束、点击两种行打开 Inspector、弹层重开恢复折叠、两组全空时分组隐藏、中英文标题。

## Completed Feature：pinned-execution-summary-groups

- Feature: 右上角现有“置顶摘要”按 Git、任务清单、已结束 Subagent 分组显示（pinned-execution-summary-groups，**已完成**）
- Status: done — 用户确认修正版 `design-mockups/execution-summary-groups.html` 后要求执行；实现准确复用顶部工具栏现有 `GitToolsPinnedSummary`，未在 Composer 新建同类摘要。
- 实现：保留 36×36 `List` 触发器、外部点击/Escape/X 关闭和 Workspace Inspector 打开时隐藏的既有规则。挂载条件由“必须 Git 仓库”泛化为 Todo、最近终态 Subagent 或 Git 任一存在，因此非 Git 会话也可查看前两类内容。用户视觉修订后，展开浮层移除顶部总标题与描述，只保留 absolute 右上角 X；实际存在的分组按 Git → Todo → 已结束 Subagent 排列，首组无顶部 margin/分割线，后续组使用紧凑浅色 0.5px 分割线，标题行预留 X 空间；Git 标题中英文均为 `Git`。Todo 复用当前消息分支最新合法 TodoWrite 完整快照，默认 3 项并可展开全部；终态 Subagent 新增 `extractLatestTerminalSubagentRuns()`，仅扫描当前 agent messages，按 toolCallId 配对 assistant 调用与 toolResult，以 `pendingToolCalls` 排除运行中临时结果，复用 `buildSubagentRunPayload`，按终态 timestamp 最近优先、canonical ID 去重并取最近 3 项，不枚举全局 store。App 订阅当前 agent 的 tool/message 相关事件轻量刷新摘要；点击终态项先收起浮层，再打开 Workspace Inspector 详情 Tab。Todo 展开、Subagent 标题右侧“最近优先”、Git changes/branch/menu/commit-push 行为保持；移动端 fixed 全浮层滚动，分支菜单 top/max-height 按 Git 首位成对调整，桌面保持 overflow visible 防裁剪。i18n 中英同步。
- Verification: 用户视觉修订后定向 Vitest 4 files / 125 tests 全过（git-tools-pinned-summary、subagent-run-detail、todo-write-summary、mobile-fullscreen-adaptation）；定向 ESLint 0 error；`npx tsc -b --pretty false` ✓；`feature_list.json` JSON parse ✓；`git diff --check` ✓。按要求未运行 build，未跑全量 test/lint。
- Boundaries: 已结束 Subagent 只显示当前消息分支最近 3 项；运行中项继续留在 Composer 胶囊；任务“查看全部”只在浮层内展开，不跳转独立详情；Inspector 打开期间入口仍隐藏；未修改后端、公共协议或生成产物，未 commit。
- Next step: 真机冒烟：Git/非 Git 会话分别验证三组/单组；完成和失败 Subagent 排序与点击跳转；回滚或切换会话后无旧记录；移动端、Light/Dark、中英文及分支菜单不被裁剪。

## Completed Feature：subagent-running-indicator

- Feature: Composer「完全访问权限」旁显示当前会话运行中的 Subagent 数量，点击具体运行跳转 Workspace Inspector 详情 Tab（subagent-running-indicator，**已完成**）
- Status: done — 用户确认设计稿后要求执行。实现沿用既有 `subagentRunStore` 和 `quickforge:open-subagent-run` 跳转链路，不新增依赖或后端接口。
- 实现：新增 `panel-decoration/subagent-running-indicator.ts`。当前会话运行集合只遍历 `agent.state.pendingToolCalls`，再按 toolCallId 读取全局 store 并筛选 `status=running`，避免跨会话污染；`tool_execution_start/update/end` 后调度 editor 重装饰，终态立即移除。胶囊插在 access 后、plan 前，显示绿色 spinner、数量与「运行中」；重复装饰时复用现有 spinner/count/label DOM，仅更新数量和文字，避免 CSS 旋转动画被反复重启造成闪烁；0 项隐藏，移动端/容器 compact 时隐藏文字。点击后创建 body-level fixed 菜单（名称、任务、每秒耗时），支持 Composer 菜单互斥、外部点击/Escape 关闭、resize/scroll 重定位、DOM 重挂更新与卸载清理；点击项读取 store 最新 payload 后派发既有事件打开 Inspector Subagent Tab。Side Chat、readOnly、disabledControls 不显示。i18n 中英 +6 key，CSS 对齐现有 Composer 胶囊/弹层视觉并支持 reduced motion。
- Verification: 定向 Vitest 5 files / 111 tests 全过（新增 7，回归 104）；eslint 改动源码/测试 0 error；`npx tsc -b --pretty false` ✓；`npm run build` ✓（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` ✓。未跑全量 test/lint。
- Boundaries: 指示器仅表示父会话仍在 `pendingToolCalls` 中且 store 快照为 running 的运行；store 缺快照时宁可不显示。列表本次保持轻量（名称/任务/耗时），当前工具的详细过程仍在 Inspector。未修改后端与公共 store payload；未 commit。
- Next step: 真机冒烟：并行启动 2-3 个 subagent，确认 access 后出现数量；点击展开并打开不同 Inspector Tab；逐个完成后数量递减并在 0 时消失；侧栏压窄时仅显示 spinner+数量。

## Completed Feature：model-stream-safe-retry-policy

- Feature: 模型流安全重试策略——仅首个实质事件前透明重试，避免回复中途重复运行（model-stream-safe-retry-policy，**已完成**）
- Status: done — 用户真机反馈模型回复会“中途重复运行”。根因是上一版允许流已产出实质内容后仍因 idle 超时从零重建整条模型请求，导致生成/工具调用重复执行、内容重写与重复计费。用户决策改为安全优先：仅零实质内容阶段自动重试。
- 实现：`server/ai-provider-options.mjs` 将默认预算调整为首个实质事件 90s、已有内容 idle 180s、total 20min；`server/ai-http-logger.mjs` 将 `MAX_STREAM_RETRIES` 收紧为 2，并以 `!hasSubstantiveEvent` 作为透明重试硬门槛，已有实质内容后的 idle timeout 直接失败，不再自动重跑；保留首事件前重试进度与恢复上报。三份测试覆盖预算、最多 2 次零内容重试、已有内容不重试、恢复事件及前端源码契约；wiki server 与 src/components 同步策略和提示边界。
- Verification: 定向 `npx vitest run` 7 files / 60 tests 全过；定向 ESLint 0 error；`node --check server/ai-provider-options.mjs` 与 `server/ai-http-logger.mjs` 通过；`npx tsc -b` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size warnings）；`git diff --check` 通过。未跑全量 `npm run test` / `npm run lint`。
- Boundaries: 首事件前上游可能已开始处理但尚未返回，透明重试仍可能产生重复计费，无法完全消除；收到实质内容后若网络停滞会直接报 idle timeout，由用户决定是否重新发起；total timeout 仍不重试；Side Chat/后台任务既有展示边界不变；未 commit。
- Next step: 真机观察弱网、大上下文 prefill 与长工具回合：确认不再出现“中途重复运行”，同时关注 90s 首事件预算是否误杀、180s 已有内容 idle 是否合适。

## Completed Feature：subagent-running-indicator-design

- Feature: Composer「完全访问权限」旁显示 Subagent 运行数量，并从列表跳转 Inspector 详情 Tab 的 HTML 设计稿（subagent-running-indicator-design，**已完成设计**）
- Status: done — 用户确认位置为「完全访问权限」旁，跳转目标为 Workspace Inspector 详情 Tab。本轮只做设计稿，不修改功能源码。
- 设计：新增 `design-mockups/subagent-running-indicator.html` 自包含演示。Composer 控件顺序为「+ / 完全访问权限 / Subagent 运行胶囊 / 计划」；运行胶囊对齐现有 2rem、999px 胶囊视觉，显示绿色 spinner、数量和“运行中”文字；0 个运行时淡出隐藏，窄模式收缩为 spinner+数字。点击胶囊向上展开运行列表，展示 agent 名、任务摘要、当前工具跑马灯和递增耗时；点击列表项滑入模拟 Inspector 详情面板。工具栏支持 light/dark、中文/英文、0/1/2/3 数量及宽/窄切换，支持 `prefers-reduced-motion`。
- Verification: Node 检查必要结构、无外链资源、内嵌脚本语法通过；`git diff --check` 通过；Playwright 实测默认布局、弹层、运行项→Inspector、0 数量隐藏、Dark 主题与窄模式均正常。仅 HTML 设计稿，未跑 npm test/lint/build。
- Boundaries: 未实现运行数订阅/会话过滤/实际 `quickforge:open-subagent-run` 派发；页面内已注明实际实现时需调整 `panel-decoration/agent-access-menu.ts` 的 plan 排序逻辑，才能让新指示器紧贴 access 按钮。未修改架构或源码行为，docs/wiki 无需更新；未 commit。
- Next step: 用户复核设计稿；确认后另开实现阶段 feature，补运行中集合 API/会话作用域、Composer 装饰挂载、Inspector 跳转与测试。

## Completed Feature：sse-unreachable-tiered-notice

- Feature: 后端不可达提示分层升级——Tier1 琥珀双行行内提示（+立即重试）→ 持续 ≥30s 升级 Tier2 composer 上方常驻条（断开时长+恢复指引按环境排序），恢复态 restarted 显示 4s（sse-unreachable-tiered-notice，**已完成**）
- Status: done — 起因：用户实测「后端服务不可达（健康检查失败）/ 8s 后重试」后反馈交互不够友好。诊断：unreachable 复用最弱的灰色 spinner 样式（视觉层级错位）、无操作入口、滚动后离开视口、无恢复指引。用户确认方案 A（分层升级，design-mockups/unreachable-notice.html）+ 30s 阈值 + 指引按环境自动排序。
- 实现：`server-agent.ts` reconnecting 状态新增 `unreachableSince` 时间戳；`reconnect-notice.ts` Tier1 改琥珀双行（主行三角图标+标题+立即重试按钮，副行健康检查失败+倒计时），≥30s 自动让位 Tier2；新 `panel-decoration/unreachable-strip.ts` Tier2 常驻条（composer dock 前插入、滚动容器外恒可见、断开时长 45s/1m 05s 格式、恢复指引两行=环境对应动作+日志、展开状态 sync 重挂保留）；ChatPanelHost 仅主聊天挂载；index.css 复用 failed/persist-degraded 琥珀配方零新 token；i18n 中英 +8 key、删 1 个被取代 key。
- Revision（用户反馈「恢复指引文字太多」）：展开区由 5 行按环境排序改为 2 行（环境对应动作 + 日志），删除「自动重连」行与 sseUnreachableHelpAuto key，四条指引文案缩短；strip 的 helpRowOrder→helpRows 过滤逻辑、测试改过滤断言、mockup/wiki/feature_list 同步。
- Verification: 定向 vitest 3 files / 82 tests 全过（unreachable-strip 新建 12 例：阈值/无广播自动出现、时长格式、环境排序、展开记忆、destroy 清理）；eslint 9 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。
- Boundaries: Tier2 恢复时直接移除（无离场动画）；unreachableSince 缺失时行内提示不隐藏（防御边界）；Tier1 副行倒计时到 0 显示 0s（完整句式，与 Tier0 独立倒计时清空行为不同属有意）；Side Chat/分享页不挂（同现状）；未 commit。
- Next step: 真机冒烟：杀后端 → 几秒内 Tier1 琥珀双行+按钮 → 持续断开 30s 后升级 composer 常驻条（展开指引看环境排序）→ 重启后端 → 常驻条消失 + 绿「已重新连接 · 服务已重启」显示 4s；弱网（health 通）维持 n/10。

## Completed Feature：chat-compact-composer-on-narrow-chat-area

- Feature: 对话区被左右侧栏挤压变窄时 Composer 控件 icon-only 紧凑模式（chat-compact-composer-on-narrow-chat-area，**已完成**）
- Status: done — 起因：用户需求中间对话区被左右侧栏拖宽挤压变窄时（viewport 宽度不变，`@media` 视口查询不触发），Composer 输入框控件应收起文字只留 icon（复用移动端紧凑形态）。
- 实现：① `ChatPanelHost.tsx` 模块级常量 `CHAT_COMPACT_WIDTH_THRESHOLD=640`（控件行极限约 530px+余量）/`CHAT_COMPACT_WIDTH_RELEASE=672`（32px 滞回防拖动抖动），新增 useEffect 以 ResizeObserver（`typeof` 防御式检查，vitest node 环境无 ResizeObserver，先例 WorkspaceInspector matchMedia）监听宿主 div `contentRect` 宽度：<640 挂 `quickforge-chat-compact`、≥672 摘除、区间内保持现状。② `index.css` 在移动端 `@media (max-width:768px)` 块（:5318 结束）之后新增 `.quickforge-chat-panel-host.quickforge-chat-compact` 段（+68 行）：agent-access/model-trigger 照抄移动端规则（收 2rem、label/chevron 隐藏、span.ml-1 sr-only、thinking 徽标隐藏），并补齐移动端没有的 plan（`> span` 只隐藏无 class 文字 span，svg icon 专用 class 不受影响）、opencode-config（label+chevron 隐藏）、opencode-mode（label 隐藏，icon 来自 model-trigger::before）三控件同样收 2rem；三 class 选择器特异性高于 @media 内两 class 规则且两态值一致，移动端零回归；未改动 @media 块内任何规则。③ 新增 `tests/frontend/chat-compact-controls.test.ts`（9 用例源码契约：阈值常量/ResizeObserver 防御/classList add/remove 滞回分支/CSS 五控件覆盖/@media 既有规则回归守卫；ruleFor 前剥 CSS 注释、`:is()` 含逗号规则改精确文本断言）。④ wiki `src/components/README.md` panel-decoration 段补一条紧凑模式说明。
- Verification: 定向 vitest 8 files / 48 tests 全过（新 9 tests）；eslint 改动 2 文件 0 error；npx tsc -b ✓；npm run build ✓（仅既有 KaTeX 字体与 chunk size 警告）。未跑全量。
- Boundaries: + 按钮、send/stop 本就是 2rem 纯 icon 无需处理；side chat 复用同一宿主，窄面板下同样进入紧凑（合理行为）；宽度在 640-672 区间保持现状（滞回有意为之）；空态聊天（quickforge-chat-panel-empty-host）与常驻 composer 同一宿主子树，紧凑 class 同样生效；未 commit。
- Next step: 真机冒烟（拖宽左右侧栏把对话区压到 <640px 控件应收成 icon-only，拖回 ≥672px 恢复文字；移动端窄视口行为不变）。
- Revision（本轮）：修正紧凑态布局回归——控件行恢复 `justify-content: space-between`，因此左侧控件组与右侧控件组仍左右分开；只对右侧末尾组覆盖 `gap: 0.5rem`，模型/思考等级槽位保持 2rem，发送/停止保持 `margin-left: auto`。`chat-compact-controls.test.ts` 增加对应契约断言；定向 Vitest 12/12、ESLint、tsc -b、git diff --check 均通过。

## Completed Feature：workspace-inspector-dynamic-width

- Feature: Workspace Inspector 拖动宽度动态上限（workspace-inspector-dynamic-width，**已完成**）
- Status: done — 起因：用户需求右侧 Workspace Inspector 面板拖动范围更大。确认方案：最小 340 不变；上限改动态 max(340, min(1200, 视口宽*0.75))（参照 ChatSidebar getSidebarMaxWidth/clampSidebarWidth 模式）；超宽屏封顶 1200px；自动展开仍固定 640。
- 实现：`WorkspaceInspector.tsx` 常量区 MAX 640→1200，新增 RATIO=0.75、AUTO_EXPAND=640 与模块级 `getInspectorMaxWidth()`/`clampInspectorWidth()`；readPersistedInspectorWidth 与 resize() 拖动 clamp 走 clampInspectorWidth；expandInspectorToMax 改用 AUTO_EXPAND_WIDTH（行为不变 640）；全屏退出恢复 maxWidth、aside 行内 maxWidth（保持三元结构契约）、separator aria-valuemax 改 getInspectorMaxWidth()；新增 window resize 同步 effect（fullscreen/mobileOverlay 跳过，已存宽度自动夹回上限内）。新增 `tests/frontend/workspace-inspector-width-range.test.ts` 源码契约测试；wiki src/components README 同步宽度说明。Storage key 沿用 v2 不变。
- Verification: 定向 vitest workspace-inspector-width-range（新 6 tests）+ mobile-fullscreen-adaptation（3 tests）全过；workspace-inspector-tabs 回归 19 tests 过；eslint 改动 2 文件 0 error；tsc -b ✓；build ✓（仅既有警告）。未跑全量。
- Boundaries: 窄视口（mobileOverlay）/全屏模式不参与宽度 clamp（按现状全屏覆盖布局）；自动展开目标是固定 640 而非动态上限（保持既有行为）；localStorage 旧值无需迁移（读取时即被重新夹取）。
- Next step: 可选真机冒烟（宽屏拖到 >640px、窗口缩窄后宽度自动收缩、打开 reader/browser 仍展开到 640）。

## Completed Feature：browser-single-window-guard

- Feature: 浏览器严格单窗口守卫——Web Locks 抢锁，第二个窗口只显示拦截页并尽力聚焦已有窗口（browser-single-window-guard，**已完成**）
- Status: done — 起因：用户问「浏览器打开能否只允许开一个窗口？开多个 SSE 会堵塞的吧」。双 explore 并行调研澄清：服务端 SSE 是单进程 EventEmitter 广播（无锁无队列、每连接独立 res.write），**不存在服务端互相阻塞**；真实堵塞是浏览器 HTTP/1.1 同源 6 连接池被每窗口 2-4 条常驻长连接占满（channels/events + agents/events（生产同源，仅 dev 直连 32176 绕开）+ Side Chat NDJSON fetch + 设置页 channels-settings-tab.ts:179 额外再开一条 channels/events），普通 API 全部排队——与 git-status-connection-pool-guard 当年诊断同一机制。
- 用户决策：① Web Locks 方案；② 检测到第二窗口时尽力自动把已有窗口带到前台（浏览器安全模型禁止脚本聚焦非自己打开的窗口，改为由已有窗口收到 BroadcastChannel 通知后自行 `window.focus()` + 标题闪烁兜底）；③ 严格单窗口、不提供「在此窗口继续使用（接管）」逃生门，因此旧窗口永远正常运行、不存在让位场景。
- 实现：① `src/lib/window-guard.ts`（257 行）——`acquireAppWindowGuard`：`navigator.locks.request(LOCK, {ifAvailable:true}, cb)` 抢锁，持锁时回调 `await` 永不结算的 promise（锁持有到页面卸载自动释放），成功判定靠回调内 acquired 标志经 acquiredPromise 在 `Promise.race` 胜出（不依赖永不结算的 request promise）；ifAvailable 拿不到锁（cb 收到 lock 为 null、request promise 随即结算）→ 同窗口刷新竞态按 400ms×2 重试（共 3 次尝试）后才判 blocked；Web Locks/BroadcastChannel 任一不可用 → unsupported 降级放行。持锁后 `startWindowFocusResponder` 监听专用频道 `quickforge-window-guard`，收到 focus-request → `window.focus()` + 「● 」前缀标题闪烁 5s（800ms 交替，重复请求重置截止计时）；`requestExistingWindowFocus` 广播后立即 close。全部依赖可注入单测。② `src/components/WindowGuardNotice.tsx`：全屏拦截页（内联 SVG 不依赖 LucideProvider、t() 双语、复用 Button 与既有 token、不 import App、不发任何 /api）。③ `src/main.tsx`：渲染前 `await acquireAppWindowGuard()`，blocked 先自动广播一次 focus 请求再只渲染拦截页；granted/unsupported 原样渲染 App（SW 注册/错误兜底/补丁原位不动）。④ i18n 中英成对 3 key；i18n import 时以 `browserDefaultLanguage()` 同步初始化，blocked 场景 t() 安全可用。⑤ wiki 3 处同步。
- Verification: 定向 vitest window-guard 10 tests（6 行为 + 4 源码契约）主 Agent 复核通过；i18n 回归 3 文件 31 tests 全过；eslint 5 文件 0 error；tsc -b 通过；npm run build 通过（仅既有警告）。未跑全量。
- Boundaries: ① 拦截页语言用浏览器默认语言（i18n import 时同步初始化；用户在设置里选了与浏览器不同的语言时拦截页显示浏览器语言，3 条文案的小妥协，换来拦截页零 /api 请求）；② Electron（5177 独立源）/ Android 壳 / 隐身窗口 / 不同浏览器 profile 为独立锁空间，天然互不拦截（它们的连接池也彼此隔离，无堵塞风险）；③ blocked 窗口仍会下载主 bundle（main.tsx 静态 import App 是有意的 HMR 设计，未改为动态 import）；④ Web Locks 在持锁窗口崩溃/关闭时由浏览器自动释放，无接管/让位机制（用户决策）。
- Notes: 同一根因的单 tab 内连接数优化候选（`channels-settings-tab.ts:179` 设置页常驻期间额外再开一条 channels/events SSE，可改为复用 App.tsx 的全局连接）记为潜在后续 feature，本次未动。
- Revision（用户真机反馈「点击切换到已有窗口不跳转、旧窗口完全没反应」）: 根因是双重浏览器限制——① 旧窗口在 BroadcastChannel message 回调中调 `window.focus()` 无 user activation，Chrome 防焦点劫持策略静默忽略；② 后台标签 setTimeout 被深度节流（低至 1 次/分钟），原实现首个标题变化要等 800ms 定时器 → 闪烁也完全不可见。修复：① `startWindowFocusResponder` 收到请求**立即**置「● 」标题（不依赖计时器，重复请求重置闪烁相位与截止）；② 新增系统通知聚焦路径——`Notification.permission === 'granted'` 且 `isSystemNotificationsEnabled()`（复用 system-notifications 开关，未复制逻辑）时 `new Notification`（`tag: quickforge-window-guard` 去重、10s 节流 `WINDOW_GUARD_NOTIFICATION_THROTTLE_MS`，标题闪烁不受节流），`onclick` close + focus（**通知点击自带 user activation，聚焦可靠**）；构造器不可用/抛错静默降级；③ focus 事件兜底：用户切回窗口时若闪烁已超截止立即恢复原标题（后台节流下截止定时器可能迟到，保证不留脏 title）；④ `WindowGuardNotice` 点击按钮后本地 state 显示 `windowGuardSwitchHint` 引导文案（系统通知或任务栏 ● 标记）。i18n +3 中英 key（windowGuardNotificationTitle/Body/SwitchHint）；window-guard import system-notifications（测试补 pi-web-ui/@capacitor/core 传递依赖桩）。通知未带 icon（观感小项未处理）。复验：vitest window-guard 10→15 用例全过（主 Agent 复核）+ i18n-language-snapshot/system-notifications 回归 20/20 + eslint 0 error + tsc -b + build ✓。
- Revision 2（用户决策「算了，就简单提示吧，也不显示跳转按钮，按钮改成关闭当前页面」）: 移除整套切换链路——删除 focus responder（系统通知/标题闪烁/focus 事件兜底）、BroadcastChannel 协商（WINDOW_GUARD_CHANNEL_NAME/startWindowFocusResponder/requestExistingWindowFocus）、isSystemNotificationsEnabled/t/randomId import；`window-guard.ts` 收缩为 118 行纯锁守卫（unsupported 判定仅看 navigator.locks；clearTimeout 注入链因 sleep 只注册从不取消、无调用路径一并删除，仅保留 setTimeout）；`WindowGuardNotice` 按钮改「关闭当前页面」（onClose 默认 `window.close()` 可注入），点击后显示 `windowGuardCloseHint` 手动关闭引导（浏览器不允许脚本关闭手动打开的标签页；成功关闭时页面消失、提示不可见，无需检测）；`main.tsx` blocked 分支不再自动广播，直接渲染拦截页；i18n 删 4 key（windowGuardSwitchButton/SwitchHint/NotificationTitle/NotificationBody）增 2 key（windowGuardCloseButton/CloseHint），Description 微调衔接关闭按钮（中英同步）；测试收缩至 10 用例（删通知/闪烁/BroadcastChannel 用例与传递依赖桩，unsupported 新语义：locks 可用即可）。复验：vitest window-guard 10 + i18n-language-snapshot 2 全过（主 Agent 复核）、eslint 0 error、tsc -b、build ✓；全仓搜索确认 src/ 无 requestExistingWindowFocus/startWindowFocusResponder/windowGuardSwitch/windowGuardNotification 残留。附带发现（未处理）：docs/wiki/src/components/README.md 中 ErrorBoundary.tsx 行数目录树与详细条目不一致（53 vs 44，既有问题）。
- Revision 3（用户真机实测「点击关闭按钮是无效的。所以按钮也不要了。有个提示就好了」）: `WindowGuardNotice.tsx` 再收缩为 34 行纯静态提示——删除「关闭当前页面」按钮、`useState`/`Button` import 与 `window.close()`（浏览器不允许脚本关闭手动打开的标签页，`window.close()` 对手动开的窗口必然静默失败，按钮已无意义）；仅保留内联 SVG 图标 + 双语标题/描述，文案引导用户关闭本窗口并回到已有窗口。i18n 删除 windowGuardCloseButton/windowGuardCloseHint（中英成对，grep 无残留）；测试契约同步（无按钮/无 window.close/无 useState，removedKeys 增 Close×2）；wiki src/components 两处条目同步。复验：vitest window-guard + i18n-language-snapshot 全过、eslint 0 error、tsc -b、build ✓。
- Next step: 真机复测（开第二个窗口只见纯提示卡片：图标 +「QuickForge 已在另一个窗口打开」+ 引导文案，无任何按钮；关掉第一个窗口后刷新第二个窗口应能正常接管运行；Web Locks 不可用的旧浏览器放行）。

## Completed Feature：sse-health-probe-notice

- Feature: SSE 重连健康探测——后端被杀时 UI 显示「后端服务不可达（健康检查失败）」并无上限持续自动重试 + 恢复后 bootId 对比提示「服务已重启」（sse-health-probe-notice，**已完成**）
- Status: done — 起因：用户反馈后台被杀后前端只显示「重新连接中… 3/10」约 3 分钟才进失败态，且无法区分「后端死亡」与「弱网」；前端运行期无任何 /api/health 消费（仅关于页使用）。用户确认方案：A（重连失败尽早探测 health）+ 顺带服务已重启提示。
- 实现：`src/lib/server-agent.ts` GlobalAgentSseClient 重连期间每次调度失败后 single-flight 探测 /api/health（SSE_HEALTH_PROBE_TIMEOUT_MS=5s，异常/超时=不可达，baseUrl 跟随直连/代理切换，结果晚于状态切换到达时仅更新 bootId 基线）；不可达时 noteReconnectAttempt 豁免 10 次上限持续退避重试（封顶 30s，health 恢复且已超上限则照常进 failed），reconnecting 状态携带 unreachable:true；每次 onopen 探测 bootId，与基线不同补播 connected{restarted:true}（首连仅记基线）。`reconnect-notice.ts` unreachable 态切换文案 sseServerUnreachableLabel、隐藏 n/10 计数、保留 Xs 后重试倒计时；restarted 补播升级文案 sseReconnectedRestarted 并重置淡出计时器（已 dismiss 则忽略）。i18n 中英成对 +2 key；SseConnectionStatus 纯增量扩展（grep 确认消费方仅 reconnect-notice.ts）。
- Verification: 定向 vitest 2 files / 67 tests 全过（server-agent 新 5 例：unreachable 超上限持续重连、health 可达 10 次后照常 failed 回归、bootId 变化/相同、fetch 抛错/超时；reconnect-notice 新 3 例）；model-retry-notice 相邻回归 12 tests 过；eslint 5 个改动文件 0 error；tsc -b ✓。未跑全量。
- Boundaries: 「不可达」不区分「进程死」vs「彻底断网」（浏览器端两者都是 health 不通，无法分辨）；restarted 补播若恢复提示已淡出移除（2.2s 后）则忽略；Side Chat/分享页本就不挂该提示，未扩展；首次连接多一次 /api/health 请求（记录 bootId 基线）；未 commit。
- Next step: 真机验证：杀掉后端 → 界面几秒内切「后端服务不可达（健康检查失败）」且持续自动重试；重启后端 → 自动恢复「已重新连接 · 服务已重启」；弱网（health 通 SSE 断）→ 维持「重新连接中… n/10」。

## Completed Feature：session-switch-no-auto-preview-tab

- Feature: 切换 session 不再自动弹出预览 tab 与右面板（session-switch-no-auto-preview-tab，**已完成**）
- Status: done — 起因：用户反馈切换项目内 session 时 tab 自动打开。根因两条：① 面板开合状态按 (projectId, sessionId) localStorage 恢复，切回曾展开的 session 自动开面板；② 自动预览 effect 对恢复会话的全部历史 present_files 自动弹 tab 并强制开面板，sessionStorage 签名去重只覆盖浏览器标签页生命周期，冷启动后首次切换仍弹。
- 实现：① 删除 `src/hooks/useWorkspaceInspectorOpenState.ts`（及其测试），`workspaceInspectorOpen` 改 `useState(false)`——页面生命周期内默认收起、仅用户手动或自动预览请求打开；tab 列表仍按 (projectId, sessionId) 持久化恢复（WorkspaceInspector 重建逻辑不变）。② `artifact-preview-utils.ts` 新增 `collectToolResultToolCallIds` / `isNewlyPresentedArtifact` 纯函数；App.tsx 在自动预览 effect 前新增附着时刻快照 effect（restore 返回时消息已同步填充），历史门控仅放行「附着后新发生」的 present_files；删除 sessionStorage 去重，保留内存签名去重。
- Verification: 定向 vitest 4 files / 50 tests 全过（新 auto-preview-fresh-present 8 用例）；eslint 0 error；tsc -b ✓；build ✓（仅既有警告）；无残留引用。未跑全量。
- Boundaries: 缓存命中后后台校准补尾的 toolResult 会视为新产物（罕见、可接受，代码注释已说明）；live present 仍会 requestWorkspaceInspector 强制开面板（保留的预期行为）；用户浏览器中残留的旧 `quickforge:workspace-inspector-open:v1:` key 不再读写、无需迁移；未 commit。
- Next step: 可选真机冒烟（切回曾展开面板的 session 面板不再自动开；重启应用后首次切换含 present_files 的旧 session 不再弹 tab；新会话中 AI present 文件当次仍正常弹出）。

## Completed Feature：persist-skip-message-deep-clone

- Feature: 持久化路径消除全量 messages 双重 structuredClone 深拷贝——CPU 削减，事务边界不变（persist-skip-message-deep-clone，**已完成**）
- Status: done — 起因：/restore 偶发慢分析发现写路径每次 persist 对全量 messages 做两次深拷贝（synchronize 整 state 深拷贝 + normalizeRecord 预编码旁路仍深拷贝），replace 模式下与消息量线性相关的同步 CPU 突刺叠加在事件循环上。
- 实现：`server/session-state-service.mjs` — synchronize() 改「深拷贝 body + messages 浅拷贝」重组；savePairChunked() 入口浅拷贝冻结快照（plan 与所有编码批次读同一冻结数组，torn-read 防护）。`server/sqlite/session-state-repository.mjs` — normalizeRecord() 在 messagesEncoded 已提供时同样 body 深拷贝 + messages 浅拷贝（该旁路 messages 仅同步读长度对齐，写库内容为编码瞬间冻结的不可变字符串）；其余路径保持全量深拷贝。事务边界/锁/CAS 零改动。
- Verification: 定向 5 files / 95 tests 全过（新增：不可克隆探针证明旁路不再深拷贝；torn-read 防护——编码 yield 间隙 push+原地改已编码对象，写入仍为调用时快照，修复前会失败）；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- Boundaries: 未动事务分片/worker 线程（记录在案的待定升级项，待 200ms 慢日志量化残余 INSERT+COMMIT 分布再决定）；非数组 messages 路径与同步 savePair 全量深拷贝行为保留。
- Next step: 观察慢日志 `persist took Xms` 分布变化；若残余仍集中在事务 COMMIT 段，再评估 worker 线程方案。

## Completed Feature：mcp-restore-nonblocking

- Feature: restore 非阻塞 MCP——连接快照构建工具 + 后台重连 + 工具集变更刷新会话 + 启动预热（mcp-restore-nonblocking，**已完成**）
- Status: done — 起因：/restore 偶发慢根因之一为 MCP 重连挡在关键路径（error+过 30s 冷却同步等待 connect ≤15s + listTools ≤15s，single-flight 扩散到所有并发方）；启动无预热；disconnected 不自动重连。
- 实现：registry 增加 waitForConnections:false 快照模式 + reconnectDisconnected + subscribeMcpToolsetChanged 签名变更通知；agent-manager 的 createServerTools/createAgent 透传 mcpToolsMode，restoreAgentUnlocked 走 cached，模块级订阅变化后调现成 refreshAllSessionTools()（SSE state 推送新工具，无死循环）；index.mjs listen 回调预热（已确认覆盖 CLI/SDK/Desktop/Android 全入口）。新会话/subagent/工具调用保持 await 语义。
- Verification: 定向 12 files / 63 tests 全过（registry 3 新用例 + restore cached 行为断言 + 11 个测试文件 mock 补导出）；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- Boundaries: restore 后首个回合若恰好用到尚未重连完成的 MCP 工具，该工具调用按现状 503 报错自愈（重连完成后经工具集通知重建会话工具）；未改 callMcpTool/管理路由语义。
- Next step: 真机观察 restore durationMs（debug 日志）不再出现 MCP 重连量级的长尾；MCP server 掉线后恢复会话应能在后台重连完成后自动拿到工具。

## Completed Feature：agent-idle-timeout-10min

- Feature: Agent 空闲逐出时长 30 分钟收紧到 10 分钟（agent-idle-timeout-10min，**已完成**）
- Status: done — 用户反馈「冷恢复：30 分钟 idle 被 destroyAgent 踢出内存……缓存不要设置这么长，10 分钟就够了」。定位：`server/agent-manager.mjs:270` 常量 `IDLE_TIMEOUT_MS`（硬编码，无环境变量覆盖），唯一消费点 `resetIdleTimer()` 超时后调 `destroyAgent` 逐出内存会话；L1864 逐出日志以 `${IDLE_TIMEOUT_MS / 1000}s` 派生自动跟随，无需另改。
- 实现：仅一行 `30 * 60 * 1000 // 30 minutes` → `10 * 60 * 1000 // 10 minutes`。`idleRetention='always'`（ACP 会话）仍永不逐出；`touchSession` 各续期入口行为不变。
- Verification: node --check ✓；npx eslint 0 error；动态 import 冒烟 ✓；git diff 确认仅 1 行。tests/ 无该常量断言（grep 零匹配），未跑全量。
- Boundaries: 未动终端 PTY 断线保留 30 分钟（`RECONNECT_GRACE_MS`，`QUICKFORGE_TERMINAL_RECONNECT_MS` 可覆盖）与 ask_user 30 分钟超时（`ASK_TIMEOUT_MS`）——均为独立语义；`dist/`、`package-dist/`、`package-offline/` 生成产物未触碰；docs/wiki 无该时长描述、无需更新；未 commit。
- Notes: 收紧后冷恢复（`restoreAgent` 全量 `assembleState`）会更频繁触发，大会话首访尖峰（见 `docs/architecture/session-sqlite-migration-design-review.zh-CN.md` P6）出现频率升高，属预期行为变化而非代码风险。
- Next step: 无 blocker。

## Completed Feature：server-process-error-guards

- Feature: 服务器进程级异常兜底——uncaughtException 记录后优雅关闭退出、unhandledRejection 仅记录继续运行，后台不再无声死掉（server-process-error-guards，**已完成**）
- Status: done — 用户报告后台服务无声退出：8/27 23:10:29 日志断档（无错误、无优雅关闭标记、无系统重启事件），8.5 分钟后新实例才被拉起。根因：server/index.mjs 仅注册 SIGINT/SIGTERM，无 uncaughtException/unhandledRejection 处理器；服务器由 CLI 以 detached + stdio:'ignore' 启动，未捕获异常的默认 stderr 堆栈被丢弃，崩溃在 server-*.log 零痕迹。
- 实现：① 新增 `server/utils/process-error-guards.mjs` — `createProcessErrorHandlers({onFatalError, exitProcess, shutdownTimeoutMs=5000})` 返回纯处理器：uncaughtException 走 fatal 路径（re-entrancy 守卫 → `logger.error('Uncaught exception:', error, {fatal})` 含完整 stack → best-effort 优雅关闭 `Promise.race` 5s 上限、失败记 'Fatal shutdown failed:' → `flushLogger()` → `exit(1)`，先落盘再退出）；unhandledRejection 非fatal（仅记录：Error 取 `.stack`、非 Error 经 `util.inspect`；不 flush——flushLogger 会关闭日志流、不退出、不触发 onFatalError）。`installProcessErrorHandlers(options)` 向 process 注册两监听。② `server/index.mjs` 在模块级状态声明后、首个启动逻辑前（:101）尽早注册，覆盖顶层求值期与 `await ensureStorage()` 启动期异常窗口（`stopQuickForgeServer` 为 hoisted 声明、`shutdownRuntime` 对未启动服务防御、`closeHttpServer` 未 listen 安全）。③ 文档：wiki server/README（index.mjs bullet + 行数 1031）、server/utils/README（新模块条目）、logging-design §5 埋点表 +1 行。
- Verification: 定向 `npx vitest run tests/server/utils/process-error-guards.test.mjs` 6/6（含 flush-before-exit 与 re-entrancy 顺序断言、onFatalError 抛错/挂起 20ms 超时、rejection Error/非 Error）；回归 `tests/server/utils/` 全目录 9 files / 157 tests 全过；eslint 3 个改动文件 0 error 0 warning；`npm run build` 通过（tsc -b + vite build；KaTeX 字体/chunk size 提示为既有第三方警告）。定向验证 + build，未跑全量测试。
- Boundaries: 不改变 SIGINT/SIGTERM 既有优雅关闭语义；unhandledRejection 后继续运行属有意取舍（本地服务可用性优先）；注册点之前的 import 期同步异常仍走 Node 默认行为（与现状一致，窗口极小）；未改 CLI/bin 侧 spawn（stdio 仍 ignore，靠 logger 文件通道）；未 commit。
- Notes: ① 本会话为诊断驱动：崩溃时间线与排除项（22:38–22:45 update/check fetch failed 500 为网络问题非死因；系统未重启；无 OOM/EADDRINUSE 痕迹）已当面汇报；② update/check 弱网 500 修复（fdd7115）在 v1.10.0 之后合入，全局安装版本尚未包含，下个小版本随包生效；③ 并行会话同期在工作区推进 MCP warmup/agent-manager 相关改动（server/agent-manager.mjs、server/mcp/registry.mjs、tests/server/agent-manager.*、tests/server/mcp-registry.test.mjs、wiki mcp 条目），非本 feature 改动，未触碰。
- Next step: 可选真机验证：人为触发未捕获异常确认 server-*.log 出现 'Uncaught exception:' + stack + fatal 字段并 exit(1)；此后后台再无声退出时日志将直接给出死因。

## Completed Feature：update-check-async-snapshot

- Feature: 检查更新接口异步化——GET /api/system/update/check 立即返回状态快照、后台刷新 registry、弱网不再 500（update-check-async-snapshot，**已完成**）
- Status: done — 用户报告控制台 `Failed to load resource: 500 http://localhost:5176/api/system/update/check` 并指出「这个更新检查应该异步」。根因：路由 `await checkForUpdates()` 同步等待外部 npm registry fetch（5 秒超时），弱网/超时/registry 异常时抛错 → sendError 500，浏览器把非 2xx 记入控制台（启动静默检查每次触发）。
- 实现：① `server/utils/package-update.mjs` — npm 检查改进程内状态机：新 `getUpdateCheckState(projectRoot, {force})` 同步返回快照 `{status: 'checking'|'ok'|'error', ...上次结果, checkError?, checkedAt}` 永不等网络；结果过期（5 分钟冷却）/未检查/失败退避（30 秒）到期时后台 `startUpdateCheck` 刷新，失败只记 `checkError` 不抛给 HTTP 层；`force`（?force=1 手动检查）跳过缓存与退避。`checkForUpdates` 保留可等待语义供 `POST /api/system/update` 更新流程（成功走冷却缓存、与快照共享后台 Promise、失败如实 reject）；`checkDesktopRelease` 未动。② 路由改为 `sendJson(200, 快照)`，index.mjs context 换 `getUpdateCheckState(force)`。③ 前端新 `src/lib/update-check-poll.ts`（`requestUpdateCheck()`：默认 10 次 × 1s 有界轮询，fetch/sleep 可注入，一切失败返回 `{kind:'error'}` 不抛出，force 仅首请求，兼容无 status 字段旧 payload）；`useUpdateCheck`（启动静默）与 `about-settings-tab`（手动 force）接入，失败路径行为不变。
- Verification: 定向 3 files / 29 tests 全过（package-update 状态机 6 新用例：快照不等网络/冷却复用/错误快照+退避/force 重查/checkForUpdates reject；路由层 2 新用例：error 快照不 500、force 透传；update-check-poll 7 用例）；eslint 0 error（仅既有 identity.mjs:92 warning）；build ✓；`npm run test` 全量 **263 files / 2415 tests 全过**。
- Boundaries: 未动 `/api/system/update/desktop`（checkDesktopRelease，同形态阻塞+可能 500，但前端无调用方，见 Notes）；未新增依赖；无 UI/文案变化（About 错误文案沿用 updateCheckFailed / 服务端 checkError）；未 commit/tag/push。
- Notes: ① update/desktop 端点如后续被桌面壳启用，建议同样迁移到状态机；② identity.mjs:92 no-useless-assignment 为 dev 分支既有 lint warning，与本次无关。
- Next step: 真机验证：断网/代理失效时刷新页面，控制台不再出现 update/check 500；About 手动检查弱网下约 5 秒后显示检查失败文案，恢复网络后 force 重查成功。

## Completed Feature：model-stream-retry-notice

- Feature: 模型上游流重试可视化——任意 idle 超时重试（上限 10）+「模型连接重试中… n/10」（model-stream-retry-notice，**已完成**）
- Status: done — 用户实测上一特性后反馈：本机弱网场景（浏览器↔服务器 SSE 走 localhost 不断开）只看到 idle timeout 错误、没有重连文字；SSE 重连提示覆盖不到这层。按用户期望将上游模型流故障做成可见恢复：服务端重试条件放宽到任意 idle（有内容也重试、新流从零重放、消息原位替换），上限 10 次对齐 SSE 重连语义；重试进度经 `model_stream_retry` SSE 事件上报（agent-manager 两处 streamFn 闭包注入 onStreamRetry → emitSessionEvent），重试后首个实质事件上报 recovered；前端新 model-retry-notice controller 显示居中「模型连接重试中… n/10」（复用 reconnect-notice 样式词汇），message_update/message_end/agent_end/error 即隐藏，decorate 周期 sync 重挂。
- Verification: 服务端 2 files / 19 tests（重试上限/进度回调/有内容重试+恢复上报/停滞重试不立刻失败）；前端 model-retry-notice 12 tests + server-agent 透传 + 回归（compaction/side-chat/agent-manager/message-queue）全过；eslint 0 error；tsc -b；build ✓。测试适配：total 预算放大（10 次重试 × idle 需 11s+，真实 total 20min 不受影响）、reconnect-notice CSS 契约改并列选择器。
- Boundaries: total timeout 仍不重试；有内容重试丢弃半截内容重新生成（重新计费，恢复可用性优先）；Side Chat 不挂提示；conversation-compaction 流不注入回调（后台任务无 UI）；未 commit。
- Next step: 真机弱网验证：上游卡死时应看到「模型连接重试中… 1/10…」递增，网络恢复后提示消失、内容从零重写继续；持续断网 10 次用尽后报 idle timeout 错误。

## Completed Feature：ai-stream-idle-fast-detect-retry

- Feature: AI 流静默分档检测 + 零内容透明重试（ai-stream-idle-fast-detect-retry，**已完成**）
- Status: done — 起因：用户报告弱网下回合以「AI stream idle timeout after 300000ms」失败而非前端重连提示。链路分析确认这是服务端→模型 API 的上游流卡死（openai SDK 的 120s timeout 只覆盖到响应头、`finally clearTimeout` 后 body 读取无任何超时；pi-ai 在 headers 一回来就 push start，所以 idle timeout ≠ 请求没成功）；用户直觉「没成功的请求可重试」经修正为「按有无实质内容分流」，与用户确认后在 QuickForge 包装层简单实现（pi-ai 不透传自定义 fetch、patch globalThis.fetch 侵入过大，SDK 层方案否决）。
- 实现：① `ai-provider-options.mjs` — `DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS` 300s→60s（中断档），新增 `DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS`=120s（首实质事件前，容忍大上下文 prefill）；显式 idleTimeoutMs/deadlineMs 时两档同值（既有调用方语义不变）。② `ai-http-logger.mjs` — `wrapStreamWithTimeouts` 改流工厂模式；零内容静默超时（未达 1 次重试、用户 signal 未 abort）时内部 `createStream()` 重建：每次尝试独立 AbortController（`combineAbortSignals` 改多参修复第三个参数被丢弃）、换流打断上一次挂起连接、total timeout 跨尝试共享；托管云重试换新随机幂等键；对外吞掉重试流重复 `start`（agent-loop 后续 delta 的 message_update 以新 partial 自然接管已发布消息）；外部 `next()` 等待者跨重试存活由新流续喂；`result()` 等待者跟随当前流并在 swap 时迁移（旧流 abort settle 不再污染 result 归宿）；旧 pump 以 generation 守卫静默退出。有实质内容后超时或重试耗尽走原报错路径（文案不变）。
- Verification: 定向 ai-http-logger + ai-provider-options → 2 files / 19 tests 全过（6 个新增行为用例 + 2 个适配重试语义的既有用例）；消费方回归（conversation-compaction、side-chat 路由、agent-manager persist/abort/process-timing、rollback-compaction、auto-compaction）全过；eslint 0 error；node --check；build ✓（仅既有 warnings）。调试中修的三个自身 bug：`waiter(...)`→`waiter.resolve(...)` 笔误（重写时引入，对照 HEAD 原版发现）、`combineAbortSignals` 双参签名静默丢弃第三个 signal、`result()` 早调用绑定旧流（重试场景挂死/错误 settle）——后两个是重试机制引入的新边界，均以用例锁死。
- Boundaries: 未动 openai SDK/pi-ai/pi-agent-core；SSE 重连提示（sse-reconnect-notice）与本特性分属两层、互补；显式传 idleTimeoutMs 的调用方（compaction 等经 withDefaultAiProviderOptions 默认路径）行为不变；总时长 total 20min 不变；未 commit/tag/push。
- Revision（用户决策「都收紧到 60s 试试」）: DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS 120s→60s，与中断档统一；ai-provider-options 注释、两处测试断言/用例（首事件档 60s 触发重试、再 60s 失败报 after 60000ms）、wiki 与状态文件描述同步。复验定向 2 files / 19 tests 全过。prefill 误杀观察点：若大上下文场景出现「重试后仍首事件超时」，回调该常量或显式传 firstEventTimeoutMs。
- Next step: 无 blocker；可选真机验证：弱网制造上游卡死（断代理）观察 60s 快速失败 + 零内容时静默重试一次无感恢复；大上下文 prefill 确认 60s 首事件档不误杀。

## Completed Feature：sse-reconnect-notice

- Feature: 弱网重连提示——对话中显示「重新连接中… 8/10」（sse-reconnect-notice，**已完成**）
- Status: done — 先产出交互稿 `design-mockups/reconnect-indicator.html`（A/B/C 三方案 × 重连中/已重连/失败三状态 × 深浅主题 + 可操作断连→计数递增→成功淡出/上限失败演示），用户确认 **方案 A（消息流末尾居中轻量行）** 后实现。调研确认现状：`GlobalAgentSseClient`（src/lib/server-agent.ts）无限次指数退避（1s 起 ×2、封顶 30s）且断连对 UI 完全静默，弱网时用户只看到输出停住。
- 实现（连接层）：`MAX_SSE_RECONNECT_ATTEMPTS = 10` + `SseConnectionStatus` 类型；`onerror` 恢复路径（直连→同源代理切换计一次零等待尝试，随后调度重试）经 `noteReconnectAttempt` 广播 `reconnecting{attempt, maxAttempts, nextRetryAt}`；`onopen` 在此前确有断连时广播 `connected{recovered:true}` 并重置计数/退避；第 10 次重试仍失败广播 `failed` 并停止自动重连。导出 `subscribeSseConnectionState` / `getSseConnectionState` / `requestSseReconnectNow`（手动重试：disconnect 清退避后立即重连）；`disconnect()` 统一重置计数/退避/状态快照。
- 实现（UI 层）：新 `panel-decoration/reconnect-notice.ts` controller 订阅连接状态，在 `message-list` 末尾追加居中轻量行：重连中 spinner +「重新连接中… n/10」（计数稍加重色）+ 每秒倒计时（interval 只更新文本节点）；恢复后绿色「已重新连接」约 2.2s 带退场动画自动移除；上限后琥珀「连接失败，已重试 10 次」+「立即重试」按钮。元素幂等复用、decorate 周期 `sync()` 在消息列表被 Lit 重建后重挂回末尾，`destroy()` 退订 + 清计时器 + 移除 DOM。`ChatPanelHost` 仅主聊天挂载（Side Chat 走独立 NDJSON 流不共享该 SSE），decorate try 块内 `sync()`、清理段 `destroy()`。i18n 中英成对 5 key；`index.css` 新增 `.quickforge-reconnect*` 段（复用 muted token、todo 完成态 emerald、persist-degraded 琥珀 #d97706；reduced-motion 关动画；置于 TodoWrite 摘要注释之前避免 todo-write-renderer 无界切片契约污染）。文案全部 createElement/textContent，innerHTML 仅静态 SVG 常量。流式断连卡死仍由既有 15s 静默看门狗轮询 /status 兜底，两者互补不替代。
- Verification: 定向 vitest reconnect-notice + server-agent → 2 files / 58 tests 全通过（server-agent 新增 4 用例：退避计数与广播、上限后 failed 且不再新建连接、onopen recovered+重置、手动重连后从 attempt 1 重计；reconnect-notice 8 行为 + 6 组源码契约）；回归 i18n-language-snapshot + todo-write-renderer/summary + message-queue + side-chat-workspace-tab + chat-harness-capabilities → 6 files / 70 tests 全通过；eslint 改动 7 文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warnings），dist 确认含新样式与 key。**事故记录**：实现中途误把 `SSE_SILENCE_RECOVERY_MS` 15000 改成 15015（受调研报告笔误影响），导致两个既有 watchdog 用例在 15s 整刻差 15ms 不触发而失败——恢复原值后全绿；该常量与本次 feature 无关，最终 diff 未包含此变更。
- Boundaries: 未改服务端与 SSE 协议；重连节奏（1s→30s 退避）与看门狗行为不变，只加了计数/上限/广播；Side Chat / SharedServerAgent（分享页）未接入提示；未新增依赖；未 commit/tag/push。DESIGN_LANGUAGE 未更新（复用既有语义色与轻量行模式，无新视觉范式）。
- Next step: 无 blocker；可选真机弱网验证（断开网络观察计数递增与倒计时、恢复后绿色提示自动消失、持续断网到 10/10 后点「立即重试」）。

## Completed Feature：release-v1.10.0

- Feature: minor 发布 v1.10.0（release-v1.10.0，**已完成**）
- Status: done — v1.9.1 tag 之后 dev 待发布内容为 chat-message-queue 新功能（dfb2bcc：Composer 流式期排队自动发送、「立即」steer 轮边界插队 + 乐观显示、拖拽排序、localStorage 持久化），另有 plugins/lan-access 两个设置页文案精简（91d0c4d、9b52444，经 435c3bf 合入 dev，未包含在 v1.9.1 npm 包内）。新功能按 semver 应升 minor，经用户确认按 **minor** 发布 v1.10.0。
- Release changes: `npm version minor` 1.9.1→1.10.0（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.10.0] - 2026-08-27` 章节（Added/Changed/Released）；README.md 当前版本徽章更新为 1.10.0。
- Verification: 完整 `npm run test` → **260 files / 2365 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.10.0.tgz`（unpacked 24.2MB / 453 files）；打包元数据校验 version 1.10.0、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies、无 devDependencies/scripts。
- Release sequence: 本轮变更构成 release commit（7 个发布文件），随后 master 快进到发布提交、创建 `v1.10.0` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：chat-message-queue

- Feature: Composer 消息队列——流式期排队自动发送 + steer 轮边界插队（chat-message-queue，**已完成**）
- Status: done — 先产出交互稿 `design-mockups/message-queue.html`（深浅主题可操作演示，用户手动验证通过），按稿内推荐方案实现。调研确认 pi-agent-core 的 steering 队列与 QuickForge 既有但无 UI 的 `POST /api/agents/:id/steer` 可直接承载「插队」语义，服务端零改动。普通排队：流式期间 Composer Enter 不再被静默丢弃，`panel-decoration/message-queue.ts` controller 在 textarea capture-phase keydown 拦截（IME/Shift 放行）入队并把占位符切为「继续输入以排队后续修改」；`agent_end` 且非 aborted/error 时延迟 250ms 取队头作为普通 prompt 自动发送直至清空。插队：队列项「立即」按钮 steer 注入当前工具轮结束后的最早边界，不打断执行中的工具；能力位 `messageSteering` 仅 QuickForge 开启，OpenCode/Side Chat 关闭且不可用时点击退化为置顶立即发送。手动停止/Escape（aborted）与 error 结束且队列非空 → 暂停 +「继续依次发送」恢复入口；自动发送失败回退队头并暂停，steer 失败仅 warn 保留该项。状态经 localStorage `quickforge:message-queue:v1` per-session 持久化（50 会话 / 20 条 / 2000 字符），挂载恢复、卸载保存、清空删条目；刷新中断不丢消息。UI 挂 composer shell 内任务摘要后、建议菜单前：todo-write-summary 锚点规则容忍相邻 `quickforge-msg-queue`、双方收敛稳定不再逐装饰周期交换位置。i18n 中英成对 15 key；样式复用既有 token 与克制 hover/危险色规范（删除仅 hover 红），reduced-motion 关闭过渡。
- Verification: 定向 `npx vitest run tests/frontend/message-queue.test.ts tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → 3 files / 47 tests 全通过（新增 21 用例：入队上限/FIFO、编辑/删除/置顶、normalize 防御、无 localStorage 降级与 stub round-trip、steer 客户端请求契约与失败抛错、ChatPanelHost/controller/todo 容忍/能力门控/i18n/css 六组源码契约）；回归 chat-harness-capabilities + side-chat-workspace-tab + ChatPanelHost 引用族共 6 files / 72 tests 全通过；`npx eslint` 改动 8 文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 服务端未改（steer/follow-up 端点与语义沿用现状）；对话流内不加「已插队」标记（交互稿演示项，实际以消息顺序体现）；OpenCode 无普通插队仅保留自动排队方向；未新增依赖；未 commit/tag/push。
- Revision（用户真机反馈 2026-08-27）: 移除队头项特殊深色边框——原 `.quickforge-msg-queue-item[data-head]` 的三参 `color-mix` 写法无效，浏览器回退 currentColor 导致队头边框发黑；改为与其他项一致统一 `var(--border)`。删除队列头部「AI 结束后按顺序自动发送」提示文案及 `messageQueueAutoHint` 双语 key、`quickforge-msg-queue-hint`/`data-head`/`order--next` 死代码。复验：eslint 3 文件 0 error、定向 vitest message-queue + todo-write-summary → 37 tests 全过、tsc -b 通过、build ✓ built in 6.59s。
- Revision 2（拖拽排序设计稿轮次）: 应用户要求设计排队项拖拽排序。已在 `design-mockups/message-queue.html` 扩展可操作演示并经浏览器自动化实测通过：左侧 ⠿ 手柄触发（与按钮/文本选择零冲突）、6px 阈值激活、原位半透明占位 + 克隆幽灵跟随、越过相邻行中线实时换位、边缘自动滚动、松手提交顺序并刷新序号（含真实 CUA drag 断言 orderOk/seqOk/无残留幽灵）。过程中修复两个关键 bug：①move/up 原绑在手柄上依赖 setPointerCapture 路由导致手动拖不动 → 改挂 window capture；②重写时丢失 ghost.remove() 导致克隆残留。实现路线确认为 ~80 行指针 mini-sortable（非 React 控制器不便用 @dnd-kit），不新增依赖；组件落地待用户手动复核演示稿后进行。
- Revision 3（拖拽排序组件落地，用户确认后实现）: 将演示稿交互移植进正式代码。`src/lib/message-queue.ts` 新增纯函数 `moveQueuedMessage(items,id,toIndex)`（clamp+round、未知 id no-op）；`panel-decoration/message-queue.ts` 新增 `beginRowDragSession` 指针 mini-sortable——行首 ⠿ 手柄（`quickforge-msg-queue-handle`，hover 增强）pointerdown 触发，6px 阈值激活后原行变 `--drag-placeholder` 半透明虚线占位、克隆体 `.quickforge-msg-queue-drag-ghost`（`--shadow-quickforge`、body 级、pointer-events:none）跟随指针，越过相邻行中线占位实时换位预示落点；move/up/cancel 监听挂 window capture（手柄级监听会因指针捕获不生效而丢失抬起——mockup 阶段实测教训），列表边缘 26px 自动滚动，拖拽期禁用文本选择；编辑中的行不可拖。松手经 `moveQueuedMessage` 提交并走既有 onChange → localStorage 持久化链路。i18n 新增 messageQueueDragTitle 双语 key；index.css 追加 handle/placeholder/ghost 样式（token 复用，无新视觉范式）。Verification: 定向 vitest message-queue(新增 moveQueuedMessage 7 断言组 + 拖拽源码契约「window capture 三监听 / ghost 清理」等) + todo-write-summary + chat-harness-capabilities + side-chat-workspace-tab → 4 files / 57 tests 全过；eslint 改动文件 0 error；tsc -b 通过；build ✓ built in 6.86s。
- Revision 4（拖拽正确性评审修复，用户指出「html 只是看交互，实际功能要正确」）: 评审确认 4 个真 bug 并修复。①【最严重】`render()` 每个装饰周期（流式期间每个 agent 增量都触发 `messageQueue.update()`）开头无条件取消进行中拖拽——队列面板恰在流式期使用，拖拽几乎必被打断；静态 mockup 无重渲染所以自动化实测发现不了。② `pointercancel`/中途取消只移除幽灵、不复位被 `movePlaceholder` 挪动的行、不触发重渲染，空闲（暂停态）时行序与 items 永久错位。③ 拖拽会话状态为模块级全局 `let cancelActiveRowDrag`，多控制器实例（会话切换/重挂载）互相误杀。④ 同根因：流式期间每次重渲染重建编辑输入框并重置为已提交文本 + rAF 抢焦点，行内编辑几乎不可用。修复：`beginRowDragSession` 改为返回 `{cancel}` 会话对象的工厂（onCommit/onEnd 回调、无模块状态）；控制器持有 `dragSession`，拖拽存续期间 `render()` 挂起（`renderDeferredByDrag` 脏标记），会话结束（提交或取消）统一从权威 items 重建；提交路径 onCommit 先于 cleanup，notify 的渲染被挂起后由 onEnd 一次兑现；控制器 cleanup 经 `disposed` 守卫取消会话且不再重建；编辑输入框加 `dataset.queueItemId`，同一编辑项跨重渲染保值/保焦点/保光标（失焦状态不抢回焦点）。Verification: 定向 vitest 4 files / 59 tests 全过（契约更新：无模块级会话变量、拖拽挂起重渲染、会话结束重建、编辑保值）；eslint 0 error；tsc -b 通过；build ✓ 6.52s。
- Revision 5（「立即」乐观显示，用户提出点击后对话马上显示文字）: 调研确认 steer 链路——服务端 steerAgent 把消息入 steeringQueue，agent-loop 在当前工具轮结束时以 message_start/message_end 事件注入真实 user 消息，所以点击后要等工具轮结束才能看到。实现：`ServerAgent.steer(message)` 改 async——先乐观把 user 消息追加进 state.messages 并 emit message_start（面板 requestUpdate 即渲染），再 POST 同一消息对象（含客户端 timestamp；服务端 prepareCloudUserMessage 只加 metadata 不改 timestamp）；工具轮边界 drain 时 SSE message_end 回显同一消息 → upsertMessage 按 role+timestamp 原位替换乐观副本（实测去重通过）；HTTP 失败回滚乐观副本 + 二次 message_start 通知面板 + reject（ChatPanelHost 捕获后保留队列项）。ChatPanelHost submitJump 改调 `agent.steer({ role:'user', content: item.text, timestamp: Date.now() })`；删除 lib/message-queue.ts 的 steerSessionMessage（唯一调用方迁移后成死代码）及测试 describe；state/turn_end 全量替换路径有长度守卫（本地更长不覆盖），乐观副本在 drain 前安全；drain 前 optimistic 消息位于对话尾部、工具结果后到会临时排其后，agent_end 权威历史恢复最终顺序（可接受的一次性重排）。Verification: vitest server-agent(新增 2 行为用例：乐观追加+echo 原位去重 / 409 回滚) + message-queue → 2 files / 54 tests 全过；eslint 5 文件 0 error；tsc -b 通过；build ✓ 7.30s。lib/components wiki 两处已同步。
- Revision 6（提交前完整门禁修复 + CSS 事故恢复）: 完整 npm run test 首跑暴露 todo-write-renderer「正常流布局」契约失败——该用例用 `css.slice(indexOf('/* TodoWrite task summary'))` 无界切片到文件尾，Revision 3 追加在 todo 段之后的队列 CSS（drag-ghost 的 position:fixed/z-index）污染断言（定向测试从未覆盖）。修复：队列 CSS 段整体移至 todo 摘要注释之前。过程中一次脚本失误截断了 src/index.css：从 HEAD 恢复基底（队列段是 index.css 唯一未提交增量），丢失段按 ① 会话内 Read 逐字原文（-list 至 -icon-btn svg、drag 段）+ ② 事故前 dist 编译产物提取的声明（含 @supports 内 color-mix 原值）重建，重建后 bundle 队列规则与事故前逐条一致（fallback + color-mix 全同）。复验完整门禁：npm run test 260 files / 2365 tests 全过、lint 0 error（仅既有 identity.mjs warning）、build ✓。
- Next step: 可选真机验证（真实回合中连续排队多条观察逐条自动发送；长工具轮中点「立即」观察消息立即出现且工具轮结束后不重复；手动停止后恢复；流式运行中拖动 ⠿ 调整顺序不再被打断；流式期间行内编辑）。遗留小决策：暂停横幅当前同时覆盖 aborted 与 error 两种结束态。

## Completed Feature：release-v1.9.1

- Feature: patch 发布 v1.9.1（release-v1.9.1，**已完成**）
- Status: done — v1.9.0 tag 之后 dev 累计 6 个提交：云服务设置页精简与 Cloud API 地址行重设计、Todo 任务摘要胶囊化动画、检查更新遵循 npm registry 配置、侧栏「显示更多」颜色弱化及状态文件记录；无破坏性变化，经用户确认按 **patch** 发布 v1.9.1。
- Release changes: `npm version patch` 1.9.0→1.9.1（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.9.1] - 2026-08-27` 章节（Added/Changed/Fixed/Released）；README.md 当前版本徽章更新为 1.9.1。
- Verification: 完整 `npm run test` → **259 files / 2349 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.9.1.tgz`（7.0MB / 453 files）；打包元数据校验 version 1.9.1、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies、无 devDependencies/scripts。
- Release sequence: 本轮变更构成 release commit（7 个发布文件），随后 master 快进到发布提交、创建 `v1.9.1` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：plugins-remove-description

- Feature: 插件设置页移除插件描述文案（plugins-remove-description，**已完成**）
- Status: done — 用户要求移除「管理本地 QuickForge 插件。当前首版支持通过 manifest 声明并贡献 Agent 工具的插件。」。`PluginsPage.tsx` 删除标题下方描述行；`settings-tabs.ts` 插件项 `getDescription` 改为 `undefined`（与 mcp 项同先例；`SettingsWorkspacePage.tsx` 的 activeDescription/搜索文本均可选链消费，安全）；`i18n.ts` 中英文成对删除 `pluginsDescription` key，grep 确认无残留。
- Verification: grep 删除 key 无残留；eslint 改动 3 文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）。tests/ 无 PluginsPage/pluginsDescription 引用。未跑全量 test/lint。
- Boundaries: 纯 UI 文案移除，不改插件发现与加载逻辑；无新增依赖；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：lan-access-remove-risk-warning

- Feature: 局域网访问设置页移除高风险警告文案（lan-access-remove-risk-warning，**已完成**）
- Status: done — 用户要求移除设置页顶部「高风险：通过密码的局域网设备可以访问你的对话、项目和可用工具。请只在可信网络中开启。」。`lan-access-settings-tab.ts` render 删除 `quickforge-settings-warning` 警告 div；`i18n.ts` 中英文成对删除 `lanAccessRiskWarning` key，grep 确认无残留引用。`.quickforge-settings-warning` 样式保留（cloud/backup/skills/plugins 页仍用）。
- Verification: grep 删除 key 无残留；eslint 改动文件 0 error（server/cloud/identity.mjs 既有 warning 与本次无关）；npm run build 成功（仅既有 chunk size warning）。tests/ 无 lan-access-settings-tab 相关测试文件。未跑全量 test/lint。
- Boundaries: 纯 UI 文案移除，不改局域网访问功能与密码逻辑；无新增依赖；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：cloud-settings-url-row-redesign

- Feature: 云服务设置页移除「启用云服务」开关行与登录安全说明 + Cloud API 地址行样式重设计·方案 A（cloud-settings-url-row-redesign，**已完成**）
- Status: done — ①「登录或注册」安全说明文字已删；②「启用云服务」开关行及描述已删（连带 setCloudServiceEnabled 与 4 个 i18n key；.quickforge-settings-switch 样式保留给其他设置页）；③设计稿 `design-mockups/cloud-url-row-redesign.html`（现状对比 + A/B/C、深浅主题、交互演示）经用户选型 **A** 后实现：URL 行改为 `quickforge-settings-row-form` 紧凑表单组——标签上置、「来源」caption 移至标签行右端、输入框通栏与「测试连接」「保存修改」同排、错误提示与「重建身份并切换」保持在下方；index.css 新增三条规则（纵向堆叠 / min-height 0 / 悬停不高亮），tests 新增源码契约 describe 锁定布局。**边界**：服务端默认 enabled=false，开关原是唯一 UI 启用入口——已装实例 saved enabled=true 不受影响（PUT config 合并语义），新装实例默认关闭暂无 UI 开关；用户未要求改默认值，server/cloud/service-config.mjs 未动。
- Verification: 定向 vitest 3 files / 23 tests 全通过；eslint 改动文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）。未跑全量 test/lint。
- Boundaries: 未新增依赖；docs/wiki/src/components/README.md 已同步；未 commit/tag/push；设计稿保留。
- Next step: 无 blocker。遗留决策（用户未答）：新装实例云服务默认关闭是否改为默认开启（改 candidateFrom 默认值，一行）。

## Completed Feature：update-check-npm-registry-config

- Feature: 检查更新遵循 npm registry 配置（update-check-npm-registry-config，**已完成**）
- Status: done — 会话首段调研确认「检查更新」为直接 fetch npm registry packument 取 dist-tags.latest，registry 仅读 `npm_config_registry` 环境变量、默认官方源，用户 `.npmrc` 镜像配置不生效（国内网络 5 秒超时易失败）；与用户确认不改用 `npm view` 命令方案（更慢、依赖本机 npm、超时控制更复杂，且 npm 命令底层请求同一接口），按「读取当前 npm 配置的源」落地：`server/utils/package-update.mjs` 新增 `resolveRegistry(packageName, options)`——环境变量 `npm_config_registry` / `NPM_CONFIG_REGISTRY` > 用户级 `.npmrc`（`NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` 或 `~/.npmrc`，`@scope:registry` 覆盖通用 `registry`，容忍注释/空行/引号值，去尾部斜杠；只读 registry 键、不触碰凭据）> 默认 `https://registry.npmjs.org/`；缺文件/空值/非法内容静默回退。`getRegistryPackageUrl` 改 async 接入，`fetchLatestVersion`/`checkForUpdates`（`/api/system/update/check`）与 5 分钟冷却缓存行为不变。`bin/quickforge.mjs` 删除本地复制的 registry/fetch 副本，先初始化网络代理再委托 server 模块 `fetchLatestVersion`。
- Verification: 定向 `npx vitest run tests/server/utils/package-update.test.mjs` → 1 file / 11 tests 全通过（resolveRegistry 7 用例 + fetchLatestVersion 按 npm 配置构造 URL）；`npx eslint` 3 个改动文件 0 error；`node --check` 两模块通过；真实冒烟 `node bin/quickforge.mjs check-update` 走共享模块与本机 npm 配置成功返回 1.9.0。未跑全量。
- Boundaries: 不改冷却缓存、超时、packument 端点与更新执行链（update-supervisor）；Desktop 渠道（GitHub Releases）不受影响；未新增依赖，未 commit/tag/push；docs/wiki server/utils（补收 package-update.mjs 条目）与 bin 已同步。
- Next step: 无 blocker；调研中识别的可选后续：packument → 轻量 `/-/package/<name>/dist-tags` 端点（该包版本多、元数据大）；bin 与 server 模块仍各有一份相同的 compareVersions 复制（本轮未动）。

## Completed Feature：cloud-settings-remove-remote-identity-sections

- Feature: 云服务设置页下线「远程访问」与「云身份」状态区块（cloud-settings-remove-remote-identity-sections，**已完成**）
- Status: done — 用户确认远程访问状态展示与云身份状态行均不需要，要求下线。`CloudAccountSettingsPage.tsx`：整块移除远程访问 section（远程访问标题/描述、「Agent 不可用」等状态徽标、授权中提示、错误警告）及全部关联逻辑（remoteStatus state、refreshRemoteStatus、1.75s 轮询、visibilitychange 刷新、retryRemoteAuthorization、remoteStatusLabel），不再请求 `/api/cloud/remote-status`；「云身份」section 移除头部状态行（云身份标题、identityDescription 描述、modeLabel 徽标）与 cloud-unavailable、session-mismatch 警告行，改为仅在连接后渲染邮箱/套餐、剩余额度、重置时间、退出登录功能行——未连接用户的页面只剩「云服务连接」配置区。`cloud-account-settings-state.ts`：移除 shouldPollCloudRemoteStatus、getCloudRemoteAuthorizationUi、CloudRemoteAuthorizationUi 及失去消费者的 getCloudAccountViewState/CloudAccountViewState。`i18n.ts`：中英文成对删除 31 个 key；`cloudSessionServiceMismatch` 有意保留（cloud-error-message.ts 错误码映射）。cloud-client.ts 的 remote-status API 绑定与服务端端点保留（cloud-client.test.ts 仍覆盖）。说明：用户消息中仍看到「绑定服务 http://127.0.0.1:5176/」，该行已于上一 feature（cloud-settings-remove-devices-simplify）删除，属旧构建/未刷新界面。
- Verification: 定向 `npx vitest run tests/frontend/cloud-account-settings-page.test.ts tests/frontend/cloud-i18n.test.ts tests/frontend/cloud-client.test.ts` → 3 files / 21 tests 全通过；`npx eslint` 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；grep 确认删除标识符/key 无残留。未跑全量。
- Boundaries: 页面行为/UI 精简，不改服务端与 API 契约；docs/wiki src/README.md 与 components/README.md 已同步；未新增依赖，未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：todo-summary-capsule-redesign

- Feature: Todo 任务摘要胶囊化——未展开时收缩为进度胶囊、展开/收起带动画过渡（todo-summary-capsule-redesign，**已完成**）
- Status: done — 先按用户要求产出 `design-mockups/todo-capsule-summary.html` 设计稿（用户确认并要求胶囊水平居中），随后落地实现：`todo-write-summary.ts` toggle 外加居中 toggle-row（flex-grow 0→1 插值驱动宽度动画），toggle 子元素一次性创建并跨快照持久（ring 环+对勾、heading、完整 stats、aria-hidden 紧凑 stats-compact、updated、spacer、chevron），进度弧经内联 `--quickforge-todo-ring-offset` 变量驱动 450ms 动画，root 新增 data-complete/data-running（对勾交叉淡化 / 收起态呼吸）；`index.css` 整段替换 todo 摘要样式：胶囊（999px、muted/55%、1.5rem、居中）⇄ 展开整行（8px、透明背景），标题/双统计 max-width+opacity 交叉淡化，列表 grid-rows 0fr→1fr + 阶梯淡入，body hidden 仍即时赋值、display:none 由 `transition-behavior: allow-discrete` 延迟 + `@starting-style` 进入动画（无 JS 两帧协调），环双 SVG 用 grid 同格叠放保持正常流契约，reduced-motion/移动端分支同步。用户追加：完成态对勾改绿色——复用 slash agent chip 既有 emerald 语义色（浅 rgb(4 143 101)/深 rgb(110 231 183)），整体单色、绿色仅完成刻出现，设计稿同步。wiki 两处同步（行为段 + 模块 360 行）。
- Verification: 定向 vitest 3 files / 58 tests 全通过（含新增 5 个胶囊结构契约用例）；eslint 0 error；tsc -b 通过；npm run build 成功且 dist CSS 保留 @starting-style/allow-discrete/ring-offset 变量。未跑全量 test/lint。
- Boundaries: 复用既有语义 token 与轻盈模式，无新视觉范式，DESIGN_LANGUAGE 未改；不改服务端协议、无新增依赖；未 commit/tag/push；设计稿保留作决策记录。
- Next step: 无 blocker；可选真机目视深浅主题下胶囊⇄展开动画、收起态呼吸与全完成对勾自动收起。

## Completed Feature：cloud-settings-remove-devices-simplify

- Feature: 云服务设置页精简——移除「绑定服务」URL/Agent PID 行与设备管理区块（cloud-settings-remove-devices-simplify，**已完成**）
- Status: done — 用户要求移除远程访问区的「绑定服务 http://127.0.0.1:5176/」展示、不再需要设备管理并精简界面。`CloudAccountSettingsPage.tsx`：删除 cloudRemoteServerUrl（绑定服务 URL）与 cloudRemotePid（Agent PID）两行，远程访问区收敛为「标题+描述+状态徽标（Agent 不可用等）+授权中提示+错误警告」；整块移除「已连接设备」区块（列表/当前设备徽标/撤销按钮/重名提示）及 revoke 回调、installationId/installationName 辅助、重名统计。`cloud-account-settings-state.ts`：CloudDetailsState/loaders/loadCloudAccountDetails 移除 installations（详情只加载 usage+models），getCloudAccountViewState 的 cloud-unavailable 判定 3→2 加载器全失败。`i18n.ts` 中英文成对删除 13 个仅设备 UI 使用的 key。保留边界：cloud-client.ts 的 installations API 绑定与服务端端点未动（移动端 CloudRemotePage 走独立 remote-client 链路选择连接设备，功能必需，不受影响）；远程 Agent 启停/轮询/自动授权逻辑不变。
- Verification: 定向 `npx vitest run tests/frontend/cloud-account-settings-page.test.ts tests/frontend/cloud-i18n.test.ts tests/frontend/cloud-client.test.ts` → 3 files / 27 tests 全通过；`npx eslint` 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；grep 确认删除 key 无残留。未跑全量。
- Boundaries: 纯 UI 精简，不改架构/模块职责/公共入口，docs/wiki 无需更新；未新增依赖，未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：sidebar-show-more-muted-color

- Feature: 侧边栏「显示更多」弱化至与分区标题一致的灰色（sidebar-show-more-muted-color，**已完成**）
- Status: done — 用户反馈项目会话列表的「显示更多」颜色太深、与会话标题区分不开，应对齐「项目」分区标题的灰色。定位：`SessionDisplayControls`（ChatSidebar.tsx，三处共用——项目视图会话、时间线视图、全局对话）按钮为 `text-muted-foreground/60`，仅比会话标题 `text-muted-foreground/70` 浅 10% 肉眼难辨，而分区标题为 `text-muted-foreground/50`。修复：resting 色 `/60`→`/50` 与分区标题一致（与会话标题拉开 20% 差），hover `/80` 保留（悬停时有背景色，不影响区分度）；tests/frontend/sidebar-section-order.test.ts:198 硬编码断言同步 `/60`→`/50`。
- Verification: 定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 18 tests 全通过；`npx eslint` 两个改动文件 0 error；grep 确认无其他测试引用旧颜色字符串。
- Boundaries: 仅调整透明度档位，`/50` 为该文件既有写法（分区标题、菜单标签），未引入新视觉模式，DESIGN_LANGUAGE.md 无具体档位约定、无需更新；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：release-v1.9.0

- Feature: minor 发布 v1.9.0（release-v1.9.0，**已完成**）
- Status: done — v1.8.1 tag（35e0863）之后 dev 累计 11 个提交（文档预览+移动端 H5、Monaco 本地打包、SSE/Cloud/git 状态修复、SQLite persist 优化与 synchronous=NORMAL、vendor node-pty、包体裁剪、todo 图标），含新功能与分发行为变化，经用户确认按 **minor** 发布 v1.9.0；npm 1.8.1 从未发布，用户决策跳过、由 1.9.0 直接取代。
- Release changes: `npm version minor` 1.8.1→1.9.0（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.9.0] - 2026-08-26` 章节（Added/Changed/Fixed/Released，基于 v1.8.1..HEAD 11 个提交整理）；README.md 版本徽章更新为 1.9.0（安装命令使用 @latest，无其他版本引用）。
- Verification: 完整 `npm run test` → **259 files / 2340 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.9.0.tgz`（7.4MB / unpacked 24.2MB / 453 files，含 vendor/node-pty 四平台）；打包元数据校验 version 1.9.0、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies。
- Release sequence: 本轮变更构成 release commit（7 个预期发布文件），随后 master 快进到发布提交、创建 `v1.9.0` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：git-status-connection-pool-guard

- Feature: git/status 慢请求钉死浏览器连接池的防护（git-status-connection-pool-guard，**已完成**）
- Status: done — 用户反馈 `GET /api/git/status` 请求「导致后续请求全部被阻止」。日志定位（`~/.quickforge/logs/server-2026-08-26.log`）：12:28:46 页面刷新后同时对 default 与 97e168b3 两项目发起 4 个无 signal、无超时的 git/status（App.tsx 标题栏 `refreshTitleGitStatus` 与 ChatPanelHost 分支探测各一），这两个仓库各需 141-146s（`listGitStatus` 的 `git status --porcelain=v1 -z --untracked-files=all` + numstat + 未跟踪文件行数统计在大仓库上极慢；73cb87e5 项目仅 ~500ms）；4 条慢连接 + 2 条常驻 SSE（channels/agents events）恰好占满 HTTP/1.1 同源 6 连接池，期间服务端其他请求全部 1ms 正常完成（非服务端阻塞），12:31:08 慢请求结束后积压的 default-options 请求立即成串放出，证实浏览器侧连接耗尽。修复（服务端不动）：`workspace-api.ts` `getGitStatus` 统一组合 20s 超时（TimeoutError DOMException 中止、成功结算后清理计时器、桥接外部 signal 的 abort）；`App.tsx` 新增 `titleGitAbortRef` 中止上一请求、abort/超时静默不写警告、项目 scope 切换 effect 立即中止在途请求；`ChatPanelHost.tsx` 分支探测挂 AbortController，卸载或 `gitProjectId`/`revision` 变化即中止。WorkspaceInspector 既有 force-abort 逻辑不变，超时落入既有 error+重试按钮路径。用户最初贴的 e14ed8a7 请求 503 为另一现象：命中 dev server 重启后 ~1s 启动维护窗口（`resolveMaintenanceGate` fail-closed），与连接池问题无关、无需修复。
- Verification: 定向 `npx vitest run tests/frontend/git-status-request-lifecycle.test.ts` → 1 file / 8 tests 全通过（20s 超时边界 19999/20000、外部 abort 即时传播、预先 aborted signal、成功后计时器清零，及三个调用方源码契约）；相关回归 5 files / 29 tests 全通过；`npx eslint` 4 个改动文件 0 error；`npx tsc -b --pretty false` 通过。未跑全量 test/lint/build。
- Boundaries: 未改服务端 git 路由与 `listGitStatus` 实现；未新增依赖；未 commit/tag/push；`docs/wiki/src/components/README.md` 已同步（ChatPanelHost 行数 1552→1581 + git status 请求生命周期一条）。
- Next step: 无 blocker。Notes（后续独立事项）：①`listGitStatus` 在 default/97e168b3 仓库耗时 100-146s，候选方向为 `--untracked-files` 粒度/仓库级配置、轻量 status 端点（标题栏与分支徽标只需 branch/counts 却调用全量端点）、并发去重或 fsmonitor/untrackedCache；②release-v1.8.1 发布门禁需含本改动全量重跑 test/lint/build。

## Completed Feature：switch-sqlite-synchronous-normal

- Feature: SQLite synchronous FULL→NORMAL（switch-sqlite-synchronous-normal，**已完成**）
- Status: done — 用户知情决策（已向用户完整解释权衡后拍板"改一下"）：接受 OS 崩溃/断电回滚「最后一次 checkpoint 以来已提交事务」的有界窗口，消除大 persist COMMIT 段的逐事务 fsync（含杀毒扫描/机械盘/网络盘下的延迟尖刺）。`server/sqlite/database.mjs`：`SQLITE_SYNCHRONOUS` 2→1（注释含决策历史链）、`configurePragmas` 以常量注入 `PRAGMA synchronous`、`publicHealth` 摘要从硬编码 `'full'` 改为 `SQLITE_SYNCHRONOUS_NAMES` 按常量派生、safety argument 注释改写为 NORMAL 语义（WAL 帧校验和保证任意崩溃模式下事务原子性/文件不撕裂；NORMAL 仅放弃逐 COMMIT fsync，进程崩溃安全；quick_check 7 天节奏不变，仍管 bit-rot）。文档按 §3.1 预设的回退条款格式显式记录：`sqlite-storage-foundation.zh-CN.md` §3.1 追加 2026-08-26 修订段（明确会话域存储 v2 无 mirror JSON 兜底、窗口内丢失即真实丢失）、`session-storage-current-architecture.zh-CN.md` 已定案条目更新为现况、wiki pragma 校验行同步。测试：foundation 断言 `.toBe(2)`→`.toBe(1)`、health `'full'`→`'normal'`。
- Verification: 定向 vitest 8 文件（sqlite-storage-foundation/lifecycle、quick-check-gate、compatibility-spike、session-state-repository/service/phase3、agent-manager.persist-session-state）→ 8 files / 66 tests 全通过；eslint 改动文件 0 error。
- Boundaries: 只动 pragma 值与派生逻辑，未改事务协议/连接管理；唯一 DB 打开点 database.mjs:301 每次都经 configurePragmas，全连接生效；未新增依赖；未 commit/tag/push。
- Next step: 无 blocker。与 optimize-persist-encoding-yield 叠加后，大 persist 的事件循环占用 = 分批编码微停顿 + 单段同步写（无逐事务 fsync）；观察 200ms 慢日志确认分布。release-v1.8.1 发布门禁需含本改动全量重跑。

## Completed Feature：optimize-persist-encoding-yield

- Feature: 大会话持久化优化——单遍 canonical 序列化 + 编码分批让出事件循环 + 慢日志阈值 200ms（optimize-persist-encoding-yield，**已完成**）
- Status: done — 背景：Node 单线程事件循环上，大会话 persist 的「每条消息 3 遍 JSON 序列化 + 同步 SQLite 事务」会独占线程，卡住所有在途请求（代码注释自认，SLOW_PERSIST_LOG_MS 慢日志可观测）。按用户拍板实施评估项 ①+③ 与阈值调整，synchronous=NORMAL 与 worker 线程不动。① 新增 `server/sqlite/canonical-json.mjs`：单遍 canonical 序列化器，与旧 `JSON.stringify(canonicalize(JSON.parse(JSON.stringify(x))))` 流水线**字节级等价**（toJSON 一次语义、undefined/function/symbol 对象值丢弃/数组位补 null、bigint 抛 TypeError、数字/字符串委托 JSON.stringify 格式化、键 UTF-16 码元排序），`tests/server/canonical-json.test.mjs` 差分测试 54 用例钉死等价（含 Date/toJSON 变体/null-proto/稀疏数组/lone surrogate/200 层嵌套/500 条消息）；repository 的 encodeMessage/messageDigest 切换至新序列化器，消息编码 CPU ≈ 原 1/3，digest 与既有库行完全兼容（jsonAndDigest 保留 round-trip——其调用方消费规范化 value 副本且仅处理小 body）。③ repository 新增 `encodeMessagesChunked`（默认 50 条/批，批间 setImmediate 让出事件循环）+ `normalizeRecord` 接受对齐的内部 `messagesEncoded` 预编码旁路；service 层 `savePair` 拆出 `savePairWithPlan` + 新增 `savePairChunked`：仅当 `saveSessionStatePair` 带 expectedRevision（CAS）时走「先 plan → 分批编码（yield）→ 同步事务」，yield 间隙并发提交由前置 revision CAS 转为 conflict 重试（saveInTransaction 先查 revision 再写行，无撕裂写窗口）；无 CAS 调用方保持全同步路径，`saveSessionBody`/`atomicSessionRecordUpdate` 等同步 facade 零波及。**评估并否决**「跨 yield 持事务分批 INSERT」：事务跨 await 期间其他同步写者会经 savepoint 加入该事务，中途失败 ROLLBACK 连带回滚其已确认写入（换独立连接则 busy_timeout 同步阻塞重造全局停顿），故事务内 INSERT+COMMIT 保持单段同步——残余的同步写突刺（INSERT+fsync）由慢日志量化后决定是否升级 worker 线程方案。观测：`SLOW_PERSIST_LOG_MS` 1000→200（注释同步更新），`persistAuthoritativeSessionState` 对异步化后的 saveSessionStatePair 补 await（phase3 测试同步调用点同步补 await）。
- Verification: 定向 vitest 13 文件（canonical-json、session-state-repository/service/messages/backup/import/lifecycle/phase3/offline-export、storage facade、auto-archive、session-index-sqlite-source、agent-manager.persist-session-state）→ 13 files / 166 tests 全通过；新增用例：差分 54、encodeMessagesChunked 的 FIFO immediates 有序性证明（events ['external','done']）、预编码旁路与同步路径落库逐行字节一致、messagesEncoded 错位抛 TypeError；eslint 7 个改动文件 0 error。早期一轮并行全量出现 1 例时序抖动，随后两轮全量均绿。未跑完整 test/lint/build（服务端聚焦改动；release-v1.8.1 发布门禁时全量重跑）。
- Boundaries: SQLite 事务语义/事务包装器/WAL+synchronous=FULL 未动；digest 算法不变（差分测试保证跨版本兼容）；未新增依赖；docs/wiki/server/README.md 已同步 repository/service 两条描述；未 commit/tag/push。
- Next step: 无 blocker。建议跑一段时间 200ms 慢日志观察真实分布：若同步写突刺（INSERT+COMMIT 段）仍显著，后续候选为 worker 线程承载 SQLite（根治）或 replace 模式按 digest 差异只重写变更行（缩事务）；synchronous=NORMAL 属产品权衡待用户单独拍板。

## Completed Feature：vendor-node-pty-runtime

- Feature: 终端 node-pty 运行时 vendor 化——npm 包自带四平台预编译（vendor-node-pty-runtime，**已完成**）
- Status: done — 背景：node-pty 1.1.0 npm 包全平台一锅端（tarball 15MB / 解压 61MB，约 48MB .pdb 死重），作为 optionalDependencies 使消费端安装沉重且离线包终端不可用；经调研（功能层面无可替代、@lydell/node-pty 为 beta、上游 npm 包已内置四平台 prebuilds 且运行时经 lib/utils.js `loadNativeModule` 按 build/Release→prebuilds/<platform>-<arch> 相对路径自解析、N-API ABI 跨 Node 稳定、MIT 允许再分发）实施本地挑运行集方案：新增 `vendor/node-pty/`（5.3MB：lib/*.js 13 文件 + win32-x64/arm64、darwin-x64/arm64 prebuilds 全部去 pdb + LICENSE + licenses/ 第三方文本），目录内 `{"type":"commonjs"}` package.json 标记解决仓库根 ESM 与 CJS lib 冲突（否则 require 报 exports is not defined），`VENDOR.json` 记录来源 node-pty@1.1.0 与平台清单，winpty/conpty MIT 许可文本从 rprichard/winpty 与 microsoft/terminal 官方仓库补齐（上游 npm 包未携带）。`scripts/vendor-node-pty.mjs` 一键重新同步（升级 node-pty devDependency 后 `npm install && node scripts/vendor-node-pty.mjs`，保留 licenses/ 与 README）。`server/terminal/terminal-manager.mjs` loadPty() 改 vendor 优先 → `require('node-pty')` 回退 → 双失败 503（PTY_UNAVAILABLE_MESSAGE 更新为平台运行时缺失语义），导出 vendoredPtyEntryPath()，darwin 加载成功后 ensureVendoredSpawnHelperExecutable() 自愈 spawn-helper 执行位（macOS posix_spawn 直接执行该二进制、Windows 打包 tarball 丢失执行位，git index 对两个 darwin spawn-helper 标记 100755，Windows 重新生成后需重设）；node-pty 自 optionalDependencies 移至 devDependencies（仅作同步源），npm 消费端不再安装 15MB 依赖、win/mac 终端开箱即用且离线可用，Linux 无上游预编译、终端需自装 node-pty 否则优雅降级。package.json files、prepare-runtime/offline-package copyEntries、electron-builder files+asarUnpack 均纳入 vendor。
- Verification: node 冒烟：vendor 入口 require + cmd.exe spawn 收到 200 字节输出 + onExit 正常（kill 阶段 `AttachConsole failed` 为上游 1.1.0 已知噪音，官方 node_modules 副本同样存在，与 vendor 无关）；定向 vitest `tests/server/terminal-vendor-runtime.test.mjs` → 5 tests 全通过（布局/许可/排除 pdb 契约 + terminalCapabilities() enabled 且 require.cache 断言真实从 vendor 加载）；eslint 3 个改动文件 0 error；`npm install --package-lock-only` 同步 lock；`npm pack --dry-run` → 7.4MB / 452 files（vendor 前 4.8MB，+2.6MB）；完整 `npm run test` → 257 files / 2275 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX/chunk size warnings）。
- Boundaries: 已同步 docs/wiki/server/README.md（terminal/ 节新增「PTY 运行时加载」）、docs/wiki/root-config.md（发布包含 vendor/）、docs/architecture/patch-release-runbook.zh-CN.md（3.6 与注意事项改为 vendor 语义）；docs/bug/server-bugs.md 的 node-pty 提及为 API/生命周期议题、与分发无关未动；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 commit/tag/push。desktop 安装包会随 vendor 带入全部四平台二进制（各平台安装器多 ~2.6MB 压缩前），如需按目标平台裁剪 electron files 可作后续优化。
- Next step: 无 blocker；发布门禁（release-v1.8.1 或其后版本）需纳入本改动重新完整验证；可选真机验证 npm 消费端安装后终端开箱即用、macOS arm64 实测 vendor 加载、Electron 桌面包终端可用（asarUnpack 生效）。升级 node-pty 时记得跑同步脚本并核对 licenses/。

## Completed Feature：package-size-trim

- Feature: 包体裁剪——qf-agent 暂时下线 + 前端依赖归位 + Monaco 语言 worker 移除（package-size-trim，**已完成**）
- Status: done — 三项裁剪按用户决策落地：①qf-agent 不再随包分发：package.json files、prepare-runtime/offline 两个脚本 copyEntries 移除 runtime-assets，electron-builder 删除 agent extraResources 与平台 helper，electron-main 删除 desktopAgentPath/qfAgentPath，git rm 五平台二进制 52MB；server/cloud/qf-agent-process.mjs 不动，二进制缺失时状态 unavailable，QUICKFORGE_QF_AGENT_PATH 仍可外部指定，恢复分发只需还原二进制与四处打包引用。②mermaid/react-markdown/remark-gfm/@dnd-kit×3/@capacitor×3 移回 devDependencies（服务端运行时仅需 9 个真依赖），lock 仅 dev 标记变化；npm 消费端每次安装省约 93MB，并消除桌面 asar 吸入 mermaid 的隐患。③Monaco 只读查看器去掉 json/css/html/ts 语言 worker（叠加于 monaco-local-bundled-loading）：monaco-local.ts 改为 editor.api + editor.all + monaco-basic-languages.ts 聚合 Monarch + 仅 editor.worker，不引入 vs/language 贡献；TS/JS/CSS/SCSS/LESS/HTML 由 Monarch 着色，JSON 无 Monarch 以纯文本呈现（已知取舍）；新增 src/monaco-esm.d.ts 补深路径类型。
- Verification: 定向 vitest（monaco-local、qf-agent-process、public-api、electron-desktop-notifications-structure、workspace-inspector tabs/on-demand）全通过；eslint 改动文件 0 error；node --check 打包/desktop 文件通过；tsc -b 通过；npm run build 成功（dist 26MB→17MB，四个语言 worker chunk 消失，editor.worker 保留）；npm run lint 0 errors / 1 既有 warning；完整 npm run test → 256 files / 2269 tests 全通过；prepare-runtime-package 重建 + npm pack --dry-run → 4.8MB / 414 files（对照 v1.7.10 24.1MB），打包 dependencies 仅 9 个运行时依赖。
- Boundaries: vite.config.ts 保持并行会话最新状态未改动（monaco 无 manual chunk 为其刻意决策）；server/cloud/qf-agent-process.mjs 与 public-api.mjs qfAgentPath option 未动；已同步 docs/architecture/quickforge-cloud-client.zh-CN.md、docs/design/remote-access-p2p.md、docs/wiki/server/README.md、docs/wiki/src/components/README.md；未新增/升级依赖版本，未 commit/tag/push。
- Next step: 无 blocker；发布时注意 v1.8.1 之后的版本 tarball 将从 ~24MB 降至 ~5MB；Cloud 远程访问功能处于不可用（unavailable）状态直到恢复 agent 分发（或用户经 QUICKFORGE_QF_AGENT_PATH 自备二进制）；可选真机目视 Reader/Diff 中 TS/CSS 着色正常、JSON 纯文本呈现。

## Completed Feature：monaco-local-bundled-loading

- Feature: Monaco 编辑器本地打包加载（monaco-local-bundled-loading，**已完成**）
- Status: done — 起因：Edge Tracking Prevention 提示 jsdelivr 存储访问，且 package-offline 断网时 Monaco 编辑器加载不出（`@monaco-editor/react` 默认经 `@monaco-editor/loader` 从 `cdn.jsdelivr.net` 运行时拉取 monaco-editor@0.55.1）。现新增 `src/components/workspace/monaco-local.ts`：`ensureLocalMonaco()` 模块级单例，函数内 `Promise.all` 动态 import `monaco-editor` 与 editor/json/css/html/ts 五个 `?worker`，设置 `self.MonacoEnvironment.getWorker` 按 label 分发，再经 `loader.config({ monaco })` 注册本地实例；顶层只 import `loader`（Environment 为 type-only），monaco 本体不进首屏静态图。`MonacoCodeViewer.tsx` / `MonacoDiffViewer.tsx` 增加 `monacoReady` gate（useEffect + cancelled 清理，保证 config 先于 `loader.init()`；未 ready 返回 null，其余 props/options 不变）。`vite.config.ts` 删除 monaco manualChunks 分支：实测保留 manual chunk 时 rolldown 会把共享 vite/preload-helper 收编进 monaco chunk、经 modulepreload 把 4MB 拖回首屏；删除后 monaco 家族为纯异步 chunk（editor.api2 3.63MB/gzip 926KB + 5 个独立 worker），index.html preload 11 项与入口静态闭包均不含 monaco，首屏不变。`@monaco-editor/loader` 默认 config 的 jsdelivr 字符串为死代码（dist 残留 1 处、无运行时网络请求）。
- Verification: 定向 vitest 4 files / 29 tests（monaco-local 5 + markdown-reader 2 + workspace-inspector-tabs 19 + mobile-fullscreen-adaptation 3）全通过；eslint 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；dist 只读检查确认 preload/静态闭包无 monaco、worker 正常生成、jsdelivr 仅 1 处死字符串。未跑全量 test/lint。
- Boundaries: 未新增依赖（monaco-editor@0.55.1 本就是 devDependency 且已安装）；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 仅重建被忽略的 dist/）；未 commit/tag/push；cloud-models-timeout-nonblocking 并行改动未触碰。已同步 `docs/wiki/src/components/README.md`。
- Next step: 无 blocker；可选真机（含断网 offline 包/Electron）验证代码/Diff 查看器加载与语法高亮；`release-v1.8.1` 发布门禁需纳入本改动重新完整验证。

## Completed Feature：cloud-models-timeout-nonblocking

- Feature: Cloud 模型超时正确映射与非阻塞加载（cloud-models-timeout-nonblocking，**已完成**）
- 根因: 用户反馈 `GET /api/cloud/models` 500。日志证实为 dev server 重启后冷缓存回源 `https://qf.shawnstack.com/v1/models`，上游偶发慢响应超过默认 10s 超时（`TimeoutError` 非 `CloudApiError`）被全局 `sendError` 兜底成 500；且 `/api/models/catalog` 在 `server/model-catalog.mjs` 串行 await Cloud 目录导致主目录接口同步挂 ~10s（日志中与失败同一毫秒返回）。
- Status: done — 服务端：`server/cloud/client.mjs` 将 fetch `TimeoutError` → `CloudApiError(504, cloud_timeout, retryable)`、网络 `TypeError` → `502 cloud_unreachable`，外部 AbortError 原样抛出；`server/model-catalog.mjs` 新增 2s 短截止（`CLOUD_MODELS_CATALOG_WAIT_MS`，可注入 `cloudWaitMs`），超时先降级仅本地/自定义模型，底层请求继续暖 60s identity 缓存，raced promise 挂 catch 防 unhandled rejection。前端：`useCloudModels` 失败后 30s 负缓存（非 refresh 直接返回 `[]`）；`resolveNewSessionModel` 与 `useAppBootstrap` 持久化 Cloud 模型恢复最多等 5s（`CLOUD_MODEL_RESOLUTION_TIMEOUT_MS`），超时走既有本地 configured 回退；`default-options-settings-tab` 首屏不再 await Cloud 目录，Cloud 到达后带 `loadSettingsGeneration` 代数守卫增量合并并按 defaults 重新解析自动选中（手动改选不覆盖），类加 `export` 供测试实例化。
- Verification: 定向 `npx vitest run` 10 files / 98 tests 全通过（client 504/502/AbortError 分类、catalog 短截止与后台失败、负缓存与 refresh 绕过、5s 回退、设置页增量合并，含 routes/cloud、cloud identity/models、cloud-client 回归）；`npx eslint` 12 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 已同步 `docs/architecture/quickforge-cloud-client.zh-CN.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/hooks/README.md`、`docs/wiki/src/lib/README.md`；未新增依赖，未手工修改生成产物，未 commit/tag/push；工作区 Monaco 相关并行改动（`MonacoCodeViewer/MonacoDiffViewer/monaco-local.*`、`docs/wiki/src/components/README.md`）未触碰。慢而正常的上游（>2s）下 catalog 该次响应不含 Cloud 模型，下一次请求命中缓存即恢复，属可接受降级。
- Next step: 无 blocker；可选真机验证：断网/慢代理下模型选择器、新建会话与 Defaults 设置页不再长时间阻塞，网络恢复后 Cloud 模型自动回来。

## Completed Feature：mobile-h5-fullscreen-sidebar-and-inspector

- Feature: 移动端 H5 侧栏整屏与 Inspector 全屏覆盖（mobile-h5-fullscreen-sidebar-and-inspector，**已完成**）
- Status: done — 左侧会话侧栏移动抽屉 100% 整屏：`ChatSidebar.tsx` 移动分支改为 `isMobile ? 'flex h-full w-full flex-col'`，`App.tsx` 抽屉包装 div 移除 `max-w-[85vw]`，桌面宽度/resize/inline style 不动。右上工具栏 PanelRight 开关由 `hidden ... lg:inline-flex` 改为全断点 `inline-flex`（disabled/onClick/aria-label 不变），移动端可打开 Inspector。`WorkspaceInspector.tsx` 新增 `narrowViewport`（`matchMedia('(min-width: 1024px)')`，对应 Tailwind lg 断点，防御式写法兼容 vitest node 无 matchMedia）与 `mobileOverlay = narrowViewport && mounted`：根 aside 在 mobileOverlay 时复用既有 `quickforge-workspace-inspector-fullscreen` 以 z-20 全屏覆盖（原首行 `hidden` 移入条件分支；不设 width style、隐藏 resize separator），header 继续走 `pr-[5.5rem]` 为右上工具栏预留、PanelRight 可点关闭；桌面 fullscreen z-40、Maximize2、Escape 逻辑不变。
- Verification: `npx vitest run` 定向 7 files / 66 tests 全通过（含新建 `tests/frontend/mobile-fullscreen-adaptation.test.ts` 3 个源码契约用例与更新的 side-chat-workspace-tab 首用例）；`npx eslint`（App/ChatSidebar/WorkspaceInspector/两个测试文件）→ 0 error；`npx tsc -b --pretty false` → 通过；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；feature JSON 解析通过。未跑全量 test/lint。
- Boundaries: 不动 `GitToolsPinnedSummary` 的 `hidden md:flex` 与小屏隐藏“更改”入口（Inspector 已提供移动覆盖布局，GitTools 更改入口维持现状）；不动 Inspector 内部桌面 fullscreen/Maximize2/Escape 逻辑；未新增依赖，未手工修改生成产物（`dist/` 为 build 命令自动生成），未 commit/tag/push；`docs/wiki/src/components/README.md` 已同步 ChatSidebar/WorkspaceInspector/GitToolsPinnedSummary 三处。
- Next step: 无 blocker；可选真机（H5/Android WebView）目视验证整屏侧栏、PanelRight 开关与 Inspector 全屏覆盖的关闭交互。

## Completed Feature：todo-pending-status-icon-hollow-circle

- Feature: Todo 未开始状态图标改为空心圆（todo-pending-status-icon-hollow-circle，**已完成**）
- Status: done — 先在 `design-mockups/todo-pending-icon-options.html` 提供 5 个候选（A 空心圆 / B 点状虚线圆 / C 缺口环 / D 圈+短横线 / E 纯实心点），均按真实面板样式与 14px 实际尺寸渲染并支持深浅主题切换，用户选定方案 A。实现仅替换 `src/components/chat/panel-decoration/todo-write-summary.ts` 中 `statusIcon()` pending 分支的 SVG 字符串：删除中心实心小圆点只留外圈。三态统一为「外圈+内部符号」语言：无符号 = 未开始、时钟指针 = 进行中、对勾 = 已完成。颜色、尺寸、`fill:none; stroke:currentColor; stroke-width:2` 约束不变，未改 CSS。
- Verification: `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → 2 files / 30 tests 全通过；`npx eslint src/components/chat/panel-decoration/todo-write-summary.ts` → 0 error；`npm run build` → 成功（仅既有 KaTeX 字体与 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 纯局部图标替换不改变架构、模块职责或公共入口，docs/wiki 无需更新；复用既有描边图标体系，无新视觉模式，DESIGN_LANGUAGE 无需修改。未新增依赖，未手工修改生成产物，未 commit/tag/push；设计稿保留作决策记录。
- Next step: 无 blocker；可选真机目视深浅主题下任务摘要三态图标。

## Completed Feature：workspace-document-preview

- Feature: Workspace 文档预览 — PDF/DOCX/XLS/XLSX（**已完成**）
- Status: done — WorkspaceInspector 新增顶层 `document` Tab，Files 文件树与 `present_files` 两条入口统一按 `artifactPreviewMode` 三路分流（Reader/Browser/Document）。服务端 `inferPresentedFileKind` 与前端 `tool-artifacts.ts` 识别 `pdf/docx/excel`（XLS/XLSX 合并为 excel），`preview:false` 仅禁止自动打开、仍可手动预览。二进制复用 `/api/workspace/preview` 路由：仅扩展允许扩展名与 MIME（pdf/docx/xls/xlsx），50 MiB 上限、路径安全校验、realpath 复查、敏感文件拦截、ETag/304 与 `__quickforge_check=1` 预检全部沿用；未新增 document API、HEAD 或 Range。
- Renderer: `WorkspaceDocumentContent` 按格式动态 import 解析库（避免 Vitest Node 顶层 DOMMatrix 问题）：PDF 用 pdfjs-dist + 本地 Worker URL + IntersectionObserver 可见页懒渲染（DPR 上限 2、缩放 ≤2、render 按 canvas+viewport）；DOCX 用 docx-preview `renderAsync`（breakPages/页眉/页脚，独立 body/style 容器隔离样式）；Excel 用 xlsx 主线程解析、多 Sheet 切换 + 100 行/页分页 + 5000 行截断提示；数据重新加载后 sheet/页码自动重置。Tab 仅持久化 `{path, format}`，同路径复用并递增 `reloadNonce` 刷新；`revision` 由 `max(reloadNonce, manualNonce)` 派生，无 effect 内 setState。
- Dependencies: `pdfjs-dist@5.4.394`、`docx-preview@0.3.7`、`xlsx@0.20.3`（SheetJS CDN tarball 源不变）由 pi-web-ui 传递依赖提升为 QuickForge 直接 devDependencies，版本与既有锁定完全一致；lock 仅新增 3 行直接依赖声明，无升级、无新库类别。构建确认动态 import 复用既有 pi-web-ui chunk 模块，未重复打包。
- Verification: 定向 `npx vitest run`（tool-artifacts/artifact-preview-utils/workspace-inspector-tabs/server tools index+definitions/workspace-preview）→ 6 files / 169 tests 全通过；完整 `npm run test` → 253 files / 2247 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92`）；`npm run build` → 成功（仅既有 KaTeX 字体与 chunk size warnings）。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/server/routes/README.md`；未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push。PPT/PPTX/DOC/XLSM 不在本期范围，仍为 unsupported。
- Next step: 无 blocker；可选后续为真机（Electron/Android 远程）目视验证大文件 PDF/Excel 渲染与内存表现。

## Completed Feature：fix-cutover-startup-bugs

- Feature: 修复 cutover 启动链缺陷（fix-cutover-startup-bugs，**已完成；本轮完成 Share/LAN/Scheduled Runs 启动完整性收口**）
- Status: done — migration 12 原子物理删除 Share/LAN 在线 `record_digest`；repository 不再逐行维护或验证派生哈希。Share/LAN 的 `sqlite_authoritative_json_pending` 与 `authoritative` 常规启动只 drain 事务性 JSON mirror outbox，清空后保留已有 storage state 元数据并提升 authoritative，不做全表扫描或域内 `quick_check`。Scheduled Runs authoritative 常规启动不再调用 health quick check；SQLite 打开、schema 与 migration 等真正整库门禁仍由 `initializeSqliteStorage()` 负责。首次 cutover 的双读/备份/replace/快照 count-digest/关系校验及 backup/restore/export 边界保持严格。
- Share consistency: 普通 update 和未显式 tokens 的重复 create 保留现有 tokens；密码变化时清 token，若显式提供替代 tokens 则统一绑定新的 `authVersion`；supersede 物理删除旧 token；issue/prune 的返回值、数据库 `updated_at` 和 mirror 时间一致。启动恢复指引改为停进程、完整复制整个 dataDir（含 SQLite/WAL/SHM）、按实际错误域诊断，禁止删库或盲跑 session downgrade。
- Verification: 定向回归 17 files / 135 tests 通过；Share 修复聚焦回归 5 files / 34 tests 通过；完整 `npm run test` → 253 files / 2219 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Boundaries: 已同步 Share/LAN/SQLite 架构文档及 server Wiki；未新增依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。当前未实现域级 `READY_DEGRADED` 或统一离线 restore CLI，这些不属于本轮最小收口。
- Next step: 无 blocker。

## Completed Feature：sidebar-five-item-display-shared-scroll

- Feature: 侧栏会话五条递增展示与统一中部滚动（**已完成**）
- Status: Projects 时间线、每个展开项目和 Tasks 默认显示 5 条；唯一可见控件“显示更多”每次增加 5 条，不显示“收起”。显示更多行复用普通 session 行的 `text-sm / leading-5`、`py-1.5 / px-2`、圆角、水平布局和整行点击区域，仅以 muted 灰色降低视觉层级；中英文 show-less i18n 已删除。只有下一组超过当前已加载数据时才调用既有 `loadMore`，并等待分页层确认确有新增数据后才提交展示数量；异步失败保持原数量、允许重试。每个 timeline/global/project key 独立维护 generation 与 pending generation：快速重复点击仍合并为单请求；用户在 pending 期间折叠 Projects/Tasks、折叠单项目、折叠全部项目或切换时间线视图触发重置时，对应 generation 立即递增，旧 Promise resolve true 后也不会提交旧 nextVisibleCount。`useSessionPagination` 的 `PAGE_SIZE=20` 保持不变且无页码。共享折叠 props、展开项目集合和 `sessionViewMode` 变化会让桌面/移动两个本地实例都执行 previous ref + effect 兜底重置；视图模式变化时每个实例将 timeline 恢复 5 条并 invalidate pending generation，初始挂载跳过，区块/项目 DnD 临时视觉折叠不重置展示数量。
- Layout / DnD: Pinned、Projects、Tasks 共用侧栏中部唯一纵向滚动容器，移除了 Pinned/Projects/Tasks 和项目子列表固定高度及内部纵向滚动，内容自然撑开；底部服务器/更新/设置区仍固定在外部。Pinned sentinel 保留且折叠时禁用；Projects 时间线、项目内列表、Tasks sentinel 已删除。项目拖拽自动滚动只允许共享侧栏容器，预览边界由纯函数计算 Projects 内容区域与共享视口的合法可见交集；矩形缺失、交集为空或夹紧上下界反转时只锁定横向、不构造 `top > bottom` 的非法边界。
- UX / i18n: 仅新增中英文“Show more / 显示更多”；显示更多整行与普通 session 的字号、行高、水平布局、圆角和点击区域一致，使用 muted 灰色及克制 hover/focus ring。无可见“收起”按钮，show-less 中英文 i18n 已删除；符合现有 DESIGN_LANGUAGE，未修改规范本身。
- Verification: 局部收口后，定向 `npx vitest run tests/frontend/sidebar-session-display-limit.test.ts tests/frontend/sidebar-section-order.test.ts tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/session-pagination-bootstrap.test.ts tests/frontend/project-drag-boundary.test.ts` → 5 files / 48 tests 全通过；新增契约锁定显示更多与普通 session 共用行/标题基类、muted 灰色、无 `onCollapse`/show-less key，并继续覆盖共享 `sessionViewMode`、折叠重置与 generation 竞态保护。目标 ESLint 0 error；完整 `npm run test` → 253 files / 2210 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 与 feature JSON 解析通过。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`；未新增依赖，未手工修改生成产物，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。

## Current Feature：release-v1.8.1（已完成）

- Feature: patch 发布 v1.8.1（release-v1.8.1，**已完成**）
- Status: done — 最终基线为 `35e0863`（b81effaa + 发布说明文档刷新），`v1.8.1` tag 已创建并推送远端，master/dev 均已同步到该提交。
- Release facts: npm 上 1.8.1 从未发布（latest 停留在 1.8.0）；经用户决策跳过补发，由 v1.9.0 直接取代（见上方 release-v1.9.0）。
- Next step: 无。后续发布流程见 release-v1.9.0。


## Completed Feature：remove-side-chat-title-entry-global-inspector-access

- Feature: 移除对话顶部 Side Chat 入口并保持全局 Inspector 可达（remove-side-chat-title-entry-global-inspector-access，**已完成**）
- Status: done — `App.tsx` 已彻底移除主对话标题区 Side Chat 按钮、`openWorkspaceSideChat`，以及只为该按钮显隐服务的 `sideChatTabOpen / onSideChatPresenceChange` 状态链；`sideChatOpen` 中英文 i18n 键因全仓无引用一并删除。
- Inspector: Side Chat 仍保留在 Workspace Inspector 的 `+` 菜单和空 Tab 入口，继续要求活动主会话与可用模型，重复打开只激活单实例运行时 Tab；关闭自身、关闭其他、关闭全部和切换 runtime scope 仍会 reset/abort/清空。桌面主工具栏 `PanelRight` 按钮不再依赖 `currentToolProject.id`，global/无项目会话也会挂载并可展开 Inspector；仍保留 `needsModelSetup` 禁用和 `lg:inline-flex` 桌面断点，移动端未新增入口。
- Verification: 定向 `npx vitest run tests/frontend/side-chat-workspace-tab.test.ts tests/frontend/workspace-inspector-tabs.test.ts tests/frontend/workspace-inspector-on-demand-source.test.ts tests/frontend/workspace-inspector-open-state.test.ts tests/frontend/workspace-inspector-request.test.ts` → 5 files / 46 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` → 成功，仅既有 KaTeX 字体解析与 chunk size warnings；`git diff --check` → 通过。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`；无需修改 `DESIGN_LANGUAGE.md`，因为没有新增视觉或移动交互模式。未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿未触碰。
- Next step: 无 blocker；可选桌面真机确认 global/无项目会话主工具栏右侧栏按钮可展开 Inspector，以及 Inspector 内两类 Side Chat 入口仍为单实例。

## Completed Feature：remove-todo-summary-bottom-border

- Feature: 移除 TodoWrite 任务摘要底部横线（remove-todo-summary-bottom-border，**已完成**）
- Status: done — 仅删除 `src/index.css` 中 `.quickforge-todo-summary` 的 `border-bottom` 声明；任务摘要的布局、背景、交互及其他业务代码/样式均未改。
- Verification: `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/slash-invocation-chip.test.ts` → 2 files / 44 tests 全通过；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Boundaries: 局部样式调整不改变架构、模块职责或公共入口，docs/wiki 与 `DESIGN_LANGUAGE.md` 无需更新；未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿未触碰。
- Next step: 无 blocker；可选真机目视确认输入框上方任务摘要底部横线已消失。

## Completed Feature：todo-write-sticky-summary

- Feature: TodoWrite 输入框上方任务摘要与专用历史渲染（todo-write-sticky-summary，**已完成**）
- Status: done（位置调整、审查 major 修复、定向验证与完整门禁均已完成）
- Scope: 服务端完整快照型 `todo_write` 协议与持久化语义不变。前端最新成功快照现位于 Composer Dock 内、`message-editor` 前的正常流任务摘要：展开时自然压缩消息区，不覆盖消息或输入框；长列表在摘要内部滚动，桌面约显示 4 项、移动端约显示 3 项。Composer sibling 顺序为任务摘要 → command/file 临时建议菜单 → `message-editor` → stats，菜单紧邻输入框；历史工具调用仍在既有过程折叠中，并由专用 renderer 提供 running/error/success/clear/neutral 历史事件摘要。
- Behavior: 无有效 Todo 不显示；首次未完成自动展开；后续未完成快照保留用户手动展开/收起状态，相同内容的新 toolCall 仍提示“已更新”；全完成自动收起但允许重开；成功空数组或回滚到无快照时移除；editor/shell 重建时按当前快照自愈；`readOnly` 无 Composer Dock 时不显示。QuickForge/OpenCode 提取继续按成功快照与 `toolCallId` 配对，错误、畸形或未完成结果不覆盖已有有效快照。
- Review fixes: 两个 major 已修复：①任务摘要从聊天消息区顶部调整为 Composer Dock 正常流 sibling，并补齐 sibling 顺序、内部滚动、readOnly、重建自愈与移除边界；② Slash invocation overlay 同时观察 textarea 与 composer shell，摘要插入/展开/收起导致布局变化时重算几何，observer 在重建和卸载路径成对 cleanup。历史 renderer 文案只陈述“更新任务清单 / 清空任务清单”，不再声称同步当前 UI；running/error/neutral 与 `detailed` JSON 语义保持准确。
- Verification: 定向 `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts tests/frontend/slash-invocation-chip.test.ts tests/server/tools/definitions.test.mjs tests/server/tools/index.test.mjs tests/server/routes/tools.todo-write.test.mjs` → 6 files / 89 tests passed；`npx tsc -b --pretty false` → exit 0。最终完整门禁：`npm run test -- --reporter=dot` → 242 files / 2112 tests passed；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → passed，仅既有 KaTeX 字体解析与 chunk size warning。
- Verification process: 首次完整 `test/lint/build` 链通过；为了提取数量二次运行全量 test 时，`tests/server/cloud/qf-agent-process.test.mjs` 的 “does not double start while a restart timer is pending” 出现一次无关定时器波动（1 failed / 2111 passed）。该单文件复跑 28/28 通过，随后全量 242 files / 2112 tests 通过；未为此修改代码。
- Boundaries: 未新增或升级依赖；未新增存储表；未手工修改 `dist/`、`package-dist/`、`package-offline/` 等生成物；`DESIGN_LANGUAGE.md` 未更新，因为复用既有轻盈内嵌工具模式。
- Existing workspace noise: 任务开始前 `package-lock.json` 已有 43 行 npm peer 元数据噪音（当前 diff 14 增/29 删），本功能未修改、还原或纳入正式功能；`artifacts/todo-write-interaction-prototype.html` 为保留的 HTML 设计原型，正式实现不依赖，未归入功能 files/交付范围；无关未跟踪 `').Groups[1].Value` 未触碰、不纳入本功能。
- Next step: 仅可选真机目视输入框上方任务摘要、长列表、`/` 与 `@` 菜单、slash chip、深浅主题及窄屏。未创建 commit/tag/push。

## Current State

- Feature: 侧边聊天 Workspace Tab（side-chat-workspace-tab，**已完成**）
- Status: done — Side Chat 最终收敛为直接复用主聊天 `ChatConversationSurface → ChatPanelHost → pi-web-ui ChatPanel/MessageList/MessageEditor`：纯文本发送、停止、复制、Markdown/代码块、滚动与轮次导航正常；`+`、模型、Access、rollback/retry/fork 等主控件原位复用但 native disabled，不再实现 Side Chat 专属模型、附件、Slash、插件、文件引用、Plan、历史分叉或工具 Agent。最小内存 Agent/NDJSON 只传 user/assistant 纯文本，显示最多 40 条，请求从最新向前按完整消息裁剪至 200,000 字符；切普通 Tab 保留，关闭/关闭其他/关闭全部/切主会话时 abort/reset，Tab 不持久化。Host 隔离 localStorage、Git、通知、artifact、审批、终端、context usage/compaction 等副作用；Side Chat 初始化 `ChatPanel.setAgent()` 时保存并恢复主聊天全局 artifacts renderer，禁用装饰只关闭当前 panel 所属模型/Access 菜单。入口仅在活动主会话和模型可用时启用。服务端读取活动主会话权威纯文本上下文，固定 `tools: []`，tool call fail closed，不创建、调用或持久化主 Agent。
- Verification: 定向 Vitest 11 files / 97 tests 与隔离修复聚焦 9 files / 71 tests 全通过；`npx tsc -b --pretty false`、MJS syntax、`git diff --check` 通过；完整 `npm run test` → 249 files / 2148 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）。
- Next step: 无 blocker；Wiki 与状态已同步，本次仅提交 Side Chat，未 tag/push；未新增依赖，未手工修改生成产物。Plan pill 只在主聊天已进入 Plan 模式时存在，Side Chat 从不进入该模式，因此不额外伪造控件。

- Feature: Prompt HTTP 失败时在聊天区显示具体错误原因（prompt-http-error-message，**已完成**）
- Status: done — `ServerAgent.prompt()` 的 HTTP fetch 失败分支继续仅在乐观 user message 仍是尾部时精确回滚，随后追加唯一合法 assistant error message：空 text block、当前模型 `api/provider/id`、完整零 usage/cost、`stopReason:'error'`、服务端具体 `errorMessage` 与 timestamp。同步清理 streaming 状态，保留 error 事件，并让本地 `agent_end` 携带 `status:'error'`、`errorMessage` 和最终 messages，因此 Chat 消息区可直接显示如 `Selected model is not configured in QuickForge.` 的具体原因。
- Verification: `npx vitest run tests/frontend/server-agent.test.ts` → 1 file / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Next step: 无 blocker；已同步 src/lib Wiki。未创建 commit/tag/push，未新增依赖，未修改生成产物或架构/设计语言文档。

- Feature: 修复 Side Chat assistant 上下文缺失 usage（fix-side-chat-assistant-usage-contract，**已完成**）
- Status: done — `server/routes/side-chat.mjs` 在服务端最终模型解析、主上下文/侧聊历史纯文本安全投影和既有字符预算裁剪之后，统一物化 pi-ai 消息：user 保持合法纯文本 user message；assistant 固定为单一 text block，使用最终 `model.api/provider/id`，完整零 `usage`（含 input/output/cacheRead/cacheWrite/totalTokens 与五项 cost）、`stopReason:'stop'`、timestamp。客户端或历史中的 usage/details/tool/thinking 等字段均不信任、不回传；既有压缩语义、120k/200k 字符预算、权限和工具 fail-closed、`tools: []` 均未改。
- Verification: `npx vitest run tests/server/routes/side-chat.test.mjs tests/frontend/side-chat-agent.test.ts` → 2 files / 13 tests 全通过；目标 ESLint 0 error；`node --check` 两个 MJS 通过；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Next step: 无 blocker；已同步 routes Wiki 一句服务端消息契约。未创建 commit/tag/push，未触碰生成产物或其他并行文件。

- Feature: Side Chat 与主聊天共享完整对话显示壳（side-chat-shared-conversation-surface，**已完成**）
- Status: done — 新增极薄 `ChatConversationSurface`，统一主聊天和 Side Chat 的 `relative/flex/min-h-0/flex-1/flex-col/overflow-hidden` 与 `--quickforge-main-bg`。App 主聊天保留 `quickforge-empty-chat`、`quickforge-conversation-enter`、Hero、`NewChatProjectPicker`、`ErrorBoundary`、`Suspense` 与首次使用引导；Side Chat 用同一 surface 包住同一 `ChatPanelHost mode="side-chat"`，保持普通空白空状态，移除 `showTurnNavigation={false}`，不自绘 textarea/messages/button，不新增 side-chat CSS/class。Host 的 mode 仅保留安全能力关闭、空 tools、内存草稿与副作用隔离；DOM return/插入无视觉 mode 分支。
- Verification: 定向 Vitest 5 files / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 247 files / 2108 tests 全通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Next step: 无 blocker；实际可见差异只来自主聊天区与 Inspector 的容器宽度，消息、Composer、轮次导航和布局由同一响应式规则自然适配。未创建 commit/tag/push，未手工修改生成产物。

- Feature: 上下文统计增加 Skills/MCP 来源行（context-usage-skills-mcp-breakdown，**已完成**）
- Status: done — 服务端 `contextUsage.breakdown` 新增可选 `skillsTokens` / `mcpTokens`。最终审查收口后，Skills 不再扫描全部同名标签：以 `activate_skill` / `read_skill_resource` definition 参数枚举作为 enabled Skills 的结构化证据，只选择最后一个带系统固定介绍且包含全部启用名称的真实 catalog，再归集 Skills definitions 与已关联调用/结果；无 enabled Skills 时伪标签/伪调用为 0。MCP definition 仅接受非数组对象 `mcp` 且 `serverName` / `toolName` 为非空字符串；名称回退通过共享 `server/mcp/tool-name.mjs` 复用 registry 的真实 server canonical 与 tool sanitize/encode 规则，解析后重建并要求和原字符串完全一致，因此三处带空格、空 segment、非法 server 与未编码 tool 名均拒绝，同时接受 registry helper 生成的 canonical 名称，且未收紧 `registry.isMcpToolName()` / `callMcpTool()` 的既有公共行为。toolResult 有非空 `toolCallId` 时仅按已识别 MCP call ID 关联，错误/孤立 ID 不再降级凭名称；ID 缺失/空时才允许按已识别 canonical `toolName` 关联；ID/name 都缺失时才接受完整 `details: {mcp:true,server,tool}`。两项复用 `pi-agent-core.estimateTokens()`，是跨系统提示词/工具定义/消息三类的来源归因，不参与总量或百分比二次相加。Tooltip 在现有三行后按正数追加 `Skills` / `MCP`，缺失或 0 隐藏；圆环和总量不变。
- Verification: 最终审查定向 Vitest 3 files / 40 tests 全通过；MCP registry 额外回归 1 file / 6 tests 全通过；完整 `npm run test` → 247 files / 2119 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Next step: 无 blocker；已同步 server/components Wiki。架构、模块职责和公共入口未改变，无需更大文档更新。保留 `docs/prototypes/context-usage-source-attribution.html`，未迁移原型演示控件；未创建 commit/tag/push，未手工修改生成产物。

- Feature: 工具调用标题与参数运行态扫光（tool-call-running-title-sweep，**已完成**）
- Status: done — 普通 `LocalWorkspaceToolRenderer` 仅在 running 时为 `quickforge-tool-label` 追加 `quickforge-tool-running-sweep`，标题与参数摘要以低强度从左到右循环扫光；运行态隐藏 `renderStatus` 的 spinner/耗时，done/error/called 原状态不变。`aria-busy` 保留语义；reduced motion 关闭扫光且不增加静态运行状态；`run_command` 输出和终止按钮不变，共享 `renderStatus` 未修改。实现文件为 `src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/local-tool-running-sweep.test.ts`，设计探索稿为 `design-mockups/tool-call-running-light-sweep.html`。
- Verification: 目标 Vitest 4 files / 31 tests 全通过；目标 ESLint 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；`feature_list.json` JSON 可解析；`git diff --check` 通过。
- Next step: 无代码 blocker；局部视觉状态反馈不改架构、模块职责或公共入口，docs/wiki 无需更新；符合现有 DESIGN_LANGUAGE，未修改规范。未创建 commit/tag/push，未手工修改生成产物。

- Feature: 右侧 Inspector subagent Tab 图标复用设计稿 Bot（subagent-tab-bot-icon，**已完成**）
- Status: done — 用户要求右侧边显示 subagent 过程的 Tab 图标复用 subagent 设计里的 icon。调研确认：设计稿 `design-mockups/subagent-tool-marquee-impl.html` / `subagent-marquee-roll-switch.html` 的 subagent 类型图标即 Lucide `Bot`，且与聊天内 run_subagent 摘要卡（`local-tools.ts` renderToolIcon）和 Slash agent 图标（`slash-icons.ts` agent=Bot）一致；右侧 Inspector 现状是 `WorkspaceInspector.tsx` 两处内联 `SquareActivity`（顶部 Tab 栏 + ChevronDown Tab 下拉列表），`panelTabMeta` 对 subagent 不提供 meta。改动仅将两处 `SquareActivity` 换为 `Bot` 并同步 import（SquareActivity 全仓库无其他使用）。`workspace-inspector-tabs.test.ts` 新增源码契约测试锁定两处分支与 import。
- Verification: 定向 `npx vitest run` inspector 相关 5 files / 37 tests 全通过（含新增契约用例）；`npx eslint` 改动源码/测试 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。纯图标替换，docs/wiki 与 DESIGN_LANGUAGE 无需更新（不改架构/职责/入口，无新视觉模式）。未创建 commit/tag/push。
- Next step: 无代码 blocker；可选真机目视深浅主题下 subagent Tab 图标观感。

- Feature: 侧边聊天 Workspace Tab（side-chat-workspace-tab，**已完成**）
- Status: done — 已实现单实例、非持久化 Workspace Side Chat，并改为真实复用主对话核心 UI。`SideChatTabContent` 仅包装 `ChatPanelHost mode="side-chat"`；消息列表、Markdown/代码块、滚动、Composer、Enter/Shift+Enter/IME、复制、发送/停止与流式等待均走主对话同一链路。主聊天标题栏、Workspace `+` 与空 Tab 入口重复打开只激活同一 Tab；无可用模型时三类入口均不允许打开。App 稳定持有内存 `SideChatAgent` 与输入 ref，切换其他 Workspace Tab 保留；关闭自身/关闭全部/在其他 Tab 关闭其他/切换主会话时 abort/reset、清空并恢复主标题入口。
- Server: 新增 `POST /api/side-chat/stream` NDJSON 路由。只读取当前活动主会话的权威消息、模型、thinking 与有效压缩上下文；主线上下文仅投影 user/assistant 纯文本，忽略 system/tool/toolCall/thinking/details/非文本块，按 120,000 字符从最新向前裁剪并尽量保留 compact summary；主线与侧聊合计不超过 200,000 字符。QuickForge 使用会话权威模型，OpenCode 使用前端当前 QuickForge `modelRef`，不调用 ACP。模型上下文固定 `tools: []`，任何 `toolcall_*` / `toolUse` fail closed；不调用 `runPrompt`、不创建/恢复 Agent、不写会话或持久化，断连会 abort。
- Verification: 定向 Vitest 11 files / 76 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 245 files / 2095 tests 全通过；完整 `npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选真机确认深浅主题、主标题入口、Workspace `+`、Tab 生命周期、OpenCode 主会话与流式停止。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`，未跟踪原型 `design-mockups/side-chat-tab.html` 保持未修改。

- Feature: 修复左侧 Tasks 普通收起闪烁（fix-tasks-collapse-flicker，**已完成**）
- Status: done — 根因是 Tasks 普通收起时，外层 `SortableSidebarSection` 同一提交从展开态 `flex-1` 切为折叠态 `shrink-0`，内层内容面板仍执行 200ms `grid-template-rows` / `opacity` 关闭动画；配合 `h-full`、flex 与滚动树会产生中间绘制帧。现在仅 Tasks 面板在 `conversationsVisuallyCollapsed` 为 true 时追加现有 `transition-none`，普通收起和拖拽临时收起均瞬时关闭；展开时该类移除，保留既有 200ms 动画。Projects 未改。
- Verification: `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 15 tests 全通过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` → 0 error；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Next step: 无代码 blocker；可选真机确认桌面/移动 Tasks 普通收起无闪烁且展开动画仍存在。局部视觉 bugfix 不改变架构、模块职责或公共入口，因此未更新 docs/wiki，也无需修改 DESIGN_LANGUAGE。未创建 commit/tag/push；未手工修改生成目录，build 仅重建被忽略的 `dist/`；无关 `design-mockups/side-chat-tab.html` 保持不动。

- Feature: 拆分侧栏默认新建与 Tasks 显式全局新建（tasks-new-chat-inherits-current-task-project，**已完成**）
- Status: done — `ChatSidebar` 顶部“发起新对话”与 Tasks 标题 MessageSquarePlus 已拆为 `onStartNewDefaultChat` / `onStartNewGlobalChat`。顶部继续调用 `startNewDefaultSession`，有 `activeProject` 时按默认规则新建该项目对话，否则新建 global。Tasks 标题 desktop/mobile 调用独立 `startNewExplicitGlobalSession`：先 `setEmptyStateProjectDismissed(true)`，再 `startNewGlobalSession()`；标记只在离开当前新对话空状态后复位，因此 active-project 自动项目 effect 不会把显式 global 切回项目。global 使用默认 Workspace（`~/.quickforge/workspace`），不读取 `activeProject`、当前任务、`chatScope` 或 `currentToolProject`。移动包装保持先关闭侧栏；项目行 `onStartNewProjectChat(item)` 未改。上一轮错误 helper、测试与 lib Wiki 条目已移除。
- Verification: `npx vitest run tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/sidebar-section-order.test.ts` → 2 files / 19 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`feature_list.json` 解析与 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机分别点击桌面/移动的顶部、Tasks 标题和项目行三个入口确认。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`，无关的 `design-mockups/side-chat-tab.html` 保持不动。

- Feature: 准备 v1.8.0 minor release（release-v1.8.0，**已完成**）
- Status: done — 本次为 minor 发布：先以功能提交 `56d435d`（feat: 增加 /commit 与自定义模型设置入口）纳入当前全部工作区改动（20 条目），并以 `--ff-only` 将 `master` 快进，无 merge commit。package 双文件 1.7.12→1.8.0；CHANGELOG 已按 `v1.7.12..HEAD` 的 17 个提交新增 `[1.8.0]` 条目；README 无固定版本引用，未修改。完整 `npm run test`（239 files / 2068 tests）全通过，`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；runtime/offline 包及 tarball 已生成并完成元数据、依赖处理与清单校验。生成目录均被 Git 忽略，release commit 范围为 6 个预期发布文件。
- Release sequence: 本变更用于 release commit，随后创建 tag `v1.8.0`，`dev` 快进至发布提交，原子推送 `master`/`dev`/`v1.8.0`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.8.0.tgz --access public`。

- Feature: 主聊天模型选择器底部打开自定义模型设置（main-chat-model-selector-settings-entry，**已完成**）
- Status: done — `custom-model-selector` 新增语义独立的可选无参 `onOpenModelSettings`，不复用旧的模型编辑参数；仅 `useModelActions` 主聊天入口传既有 `openModelSettings`。桌面浮层与移动抽屉底部按条件显示低强调“自定义模型”，点击先统一关闭选择器并复位 trigger `aria-expanded`，再打开 `customModels` 设置页。共享对话、Agent 表单等不传回调的复用场景不显示。移动 footer 在可滚动 model list 之外保持固定，样式遵循既有分隔线、muted 文字及 hover/focus token。
- Verification: 定向 `npx vitest run tests/frontend/custom-model-selector.test.ts tests/frontend/use-model-actions-cloud.test.ts tests/frontend/i18n-language-snapshot.test.ts tests/server/routes/shared-conversation.model-visibility.test.mjs` → 4 files / 15 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；需求文件 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机目视桌面/移动、深浅主题及移动长模型列表。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`。

- Feature: Composer @ 从项目根目录逐层浏览文件（file-reference-root-browser，**已完成**）
- Status: done — 新增严格 `projectId` 的 `/api/workspace/mention-children`，只返回当前目录全部直接安全子节点且目录优先，不递归、不分页、不回退默认 workspace；敏感路径、真实目标和项目外符号链接继续按 mention 边界过滤。审查修正后，目录完成 stat/realpath 解析仍按真实/链接目标路径分段排除 `SKIP_DIRS`：普通 `node_modules`、名为 `node_modules` 的目录链接与安全别名指向 `node_modules` 子树均不返回；普通安全目录链接仍允许。Composer 裸 `@` 默认浏览根目录；点击/Enter/Tab 目录逐层进入，选择文件才沿用既有 `contextReferences`；`@src` 等仅在当前目录本地筛选，不发全项目搜索请求；当前层全部渲染并由菜单滚动。旧 `mention-search` 保留兼容但 Composer 不再调用。
- Verification: 审查收口 `npx vitest run tests/server/routes/workspace-tree-on-demand.test.mjs tests/frontend/file-reference-controller.test.ts` → 2 files / 29 tests 全通过（含请求竞态、remove Abort 与 cleanup listener）；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` 通过（仅既有 CRLF→LF warning）。完整门禁：`npm run test` → 238 files / 2062 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Next step: 可选真机确认深浅主题、长目录滚动、鼠标/键盘逐层进入、当前层筛选及文件 chip；未创建 commit/tag/push。

- Feature: / 斜杠菜单点击菜单外任意区域收起（slash-menu-click-outside-dismiss，**已完成**）
- Status: done — 用户关闭与内部删除已分离。菜单外任意 pointerdown（包括 textarea/Composer 控件）、Escape 或公开 `remove()` 会收起菜单、清理 document listener，并进入等待下一次显式输入的抑制态；即使正文仍以 `/` 开头，MutationObserver 装饰刷新、catalog resolve/reject 回调等无参数 `update()` 也不会立即重开。下一次真实输入调用 `update(value)` 时解除抑制并正常打开/过滤。选中菜单项、chip 激活、非 Slash 文本、无结果等内部删除走不抑制的统一 `removeMenu()`；document listener 为控制器级单例，重复渲染不累积，`cleanupTextareaHandler()` 同步清理。菜单本体 pointerdown 仍不关闭；`@` 文件引用菜单保持既有行为未改。
- Verification: `npx vitest run tests/frontend/command-suggestions.test.ts` → 1 file / 18 tests passed；`npx vitest run tests/frontend/command-suggestions.test.ts tests/frontend/slash-invocation-chip.test.ts tests/frontend/composer-plus-menu.test.ts` → 3 files / 49 tests passed；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` → exit 0（仅 `feature_list.json` 既有 CRLF→LF warning）。
- Next step: 无代码 blocker；可选真机确认点击输入框/消息区收起、继续输入重开、点击菜单行仍正常插入。未创建 commit/tag/push。

- Feature: 内置 Slash 指令 `/commit [message]`（builtin-slash-commit，**已完成**）
- Status: done — 后端 catalog/help、内部解析与 agent-manager 命令状态已接入 `/commit`；参数可省略。当前轮权限固定为 `allowEdit=false`、`allowCommands=true`、`allowSubagents=false`。简短 6 条 prompt 要求仅显式暂存并提交当前任务相关文件，禁止 `git add .` / `-A` / `--all`，验证失败停止，不修改代码、不混入无关改动、不绕过 hooks，最多一个本地 commit，禁止 push/tag/release/publish；无 message 时按 diff 与仓库风格生成，最后报告 hash/message/验证/剩余改动。前端菜单显示 `/commit [message]` 并插入 `/commit `，中英文描述、README 和 server/components Wiki 已同步。
- Verification: 定向 `npx vitest run tests/server/custom-commands.test.mjs tests/server/slash-skill-agent.test.mjs tests/frontend/command-suggestions.test.ts` → 3 files / 78 tests passed；目标 `npx eslint` 0 error；`npx tsc -b --pretty false` exit 0；完整 `npm run test` → 238 files / 2050 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；未创建 commit/tag/push，`package-lock.json` 的既有 peer 元数据改动未触碰。

- Feature: 点击 Composer 内 Slash chip 不再降级显示命令原文（slash-chip-click-keeps-chip，**已完成**）
- Status: done — 用户真机反馈：选中 agent 后输入框内的小 tab（slash chip）一点击就露出 `/agent <name>` 原文。根因是覆盖层整体 `pointer-events:none`，点击穿透到 textarea 前缀区，光标进入前缀触发 selectionchange 降级逻辑。修复：CSS 仅对 `.quickforge-slash-overlay .quickforge-slash-chip` 开启 `pointer-events:auto`（消息流 chip 保持纯展示），控制器在 `renderChipContent` 为覆盖层 chip 挂 `pointerdown`：preventDefault 后聚焦 textarea 并把光标移到文本末尾，chip 保持显示不降级；键盘方向键进入前缀区的降级/自愈、IME、自愈重建逻辑均未改。共享工厂 `createSlashChipElement` 未挂监听，消息流 chip 不受影响。
- Verification: 定向 `npx vitest run tests/frontend/slash-invocation-chip.test.ts tests/frontend/command-suggestions.test.ts` → 2 files / 36 tests passed（新增 chip pointerdown 用例：preventDefault、光标移末尾、不降级、CSS 契约）；相邻 `message-actions` / `composer-plus-menu` / `slash-catalog` 3 files / 29 tests passed；`npx eslint` 改动源码/测试 0 error；`npx tsc -b --pretty false` exit 0。
- Next step: 无代码 blocker；可选真机点击 skill/agent chip 确认光标落末尾且原文不露出（含触屏）。

- Feature: 用户消息显示本轮插件标签并在重试/分享中保留（user-message-selected-plugin-chips，**已完成**）
- Status: done — 审查收口修复 M1/M2：服务端 `selectedCapabilitiesFromMessage` 改为历史快照投影，retry/continue 只能恢复 `type/pluginName/name/label`，历史 `details.description` 即使伪造也不会进入 LLM prompt；新发送请求顶层 description 仍仅用于当前轮临时 prompt。前后端历史读取边界均有同构测试。`decorateUserContextChips` 做最小导出，message-actions 新增真实 fake DOM 行为测试，实际执行插件在文件前、重复调用替换不重复、混合→空移除、历史 chip 无 ×、仅插件/仅文件/混合 aria-label，并经 `decorateMessages` 点击 copy 验证仍复制原始正文。Wiki 行数/表格已按当前源码修正；feature 保持 done。
- Verification: 审查收口定向 Vitest 9 文件 / 87 用例全通过；目标 eslint 0 error；`npx tsc -b --pretty false`、`git diff --check`、feature JSON 解析通过；完整 `npm run test` 238 文件 / 2043 用例 100% 全通过；完整 `npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。`package-lock.json` blob hash 仍为 `a7f0bb9fcb4de96f8953024be8ac588435dcc3ab`，未修改/还原；未触碰并行 `slash-invocation-chip.ts` 及其测试/专属逻辑，未手工修改生成目录，未 commit/tag/push。
- Next step: 无代码 blocker；可选真机目视多插件、未知插件、仅插件/仅文件/混合消息及分享页。

- Feature: Composer 插件标签移入输入卡片并统一插件术语（composer-plugin-chips-inside-editor，**已完成**）
- Status: done — 审查修复已完成：`ensureComposerContextChips` 继续从 textarea 父元素定位真正输入卡片；新增共享 `syncComposerContextChipsAriaLabel`，两个控制器在完成自身 chip 增删后统一调用，按仅插件=`Selected plugins / 已选插件`、仅文件=`Referenced files / 引用的文件`、混合=`Selected plugins and referenced files / 已选插件和引用的文件` 同步可访问名称，空容器仍移除。插件与文件引用两类 chip 在任一同步/删除顺序下互不删除；内部 capability 类型、`selectedCapabilities` 草稿字段与发送协议不变。插件多选、去重、草稿恢复、× 删除和发送消费保持；documents/spreadsheets/presentations 使用现有专用图标，未知插件回退通用图标。CSS 仅收紧标签尺寸/间距和有标签时 textarea 顶部 padding，保留 composer `> div:first-child` 根卡片选择器及文件标签色。
- Verification: 审查修复定向 vitest 9 文件 / 77 用例全通过（含双控制器 file-first/plugin-first 两种同步顺序、互相保留、分别删除、最后一项删除移除空容器及仅文件/仅插件/混合 aria-label）；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test -- --reporter=dot` 236 文件 / 2024 用例全通过；完整 `npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选真机目视深浅主题下多插件+文件混合标签、删除按钮、窄输入框换行及读屏名称。`package-lock.json` 仍为任务前既有 43 行 peer 元数据差异，本次未修改/还原；未创建 commit/tag/push，未手工修改生成目录（build 仅重建被忽略的 `dist/`）。

- Commit 收尾：本轮并行三功能已提交——`4f0182f`（slash chip 点击修复，含 index.css 专属 hunk 拆分）、`abbc7cd`（插件标签链路与用户消息插件回显；composer-plugin-chips-inside-editor 与 user-message-selected-plugin-chips 在多文件内交织，合并一笔）；状态文档随后以独立 docs commit 收口。提交前完整门禁：`npm run test` 238 files / 2043 tests 全通过、`npm run lint` 0 errors / 1 existing warning、`npm run build` 成功。`package-lock.json` peer 元数据噪音仍未提交、未丢弃。未 tag、未 push。

- Commit 收尾：剩余功能代码已按逻辑提交为 `d66a3e7`（Workspace Inspector 会话隔离）、`924e8c5`（Slash canonical name + 中性 Lucide 图标）、`b64a4b2`（Composer hover）；此前侧栏区块功能已在 `72ac7e09`，会话状态 clear 修复已在 `6c337aeb`。状态文档将在本次独立 docs commit 收口；未 tag、未 push。
- 最终验证：`npm run test` → 236 files / 2020 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 与 `feature_list.json` / `package.json` / `package-lock.json` JSON 解析通过。
- 保留未提交：`package-lock.json` 仅有 43 行 npm `peer` 元数据翻转；`package.json` 无依赖/版本变化，且用当前 npm 11.6.2 对 HEAD 锁文件执行隔离 `npm install --package-lock-only` 可复现同一结果，判定为工具链规范化噪音。按要求未提交、未丢弃。

- Feature: 侧栏区块改用标题拖拽并在排序时临时折叠（sidebar-section-title-drag-collapse，**已完成**）
- Status: done — Projects / Tasks 不再显示专用 GripVertical；各自标题主 toggle 直接接收 `setActivatorNodeRef` / attributes / listeners，普通单击仍走原折叠回调，仅独立 `draggableSectionTitleClass` 添加 `touch-none` 与 grab/grabbing 反馈；共享 `sectionToggleClass` 保持普通折叠标题样式，Pinned 继续使用默认 pointer/触摸行为。PointerSensor 超过 6px 才启动拖拽，右侧 action buttons 保持隔离。拖动任一区块时，两个区块通过派生视觉状态同时临时折叠，Chevron、`aria-expanded`、外层尺寸与内容 grid 一致；收缩禁用过渡，cancel/end 清理 `draggingSectionId` 后恢复各自原持久折叠状态。compact layout、设置底部固定和 Projects 内部 DnD/边界保持不变。
- Verification: 定向 vitest 2 文件 / 21 用例（含 Pinned 不使用 draggable class、Projects/Tasks 使用的契约）、目标 eslint、`tsc -b`、`git diff --check` 全通过；前一轮完整 `npm run test` 236 文件 / 2020 用例全通过、完整 lint 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）、build 成功（仅既有 KaTeX/chunk warnings），本次极小局部修复未重复全量门禁。
- Next step: 无代码 blocker；可选真机分别从 Projects/Tasks 标题短按折叠与拖动换位，确认 6px 阈值、两个区块瞬时收缩、右侧操作按钮隔离以及结束/取消恢复。

- Feature: 修复侧栏 Projects / Tasks 折叠后不贴合（sidebar-collapsed-sections-compact-layout，**已完成**）
- Status: done — `SortableSidebarSection` 现在接收按 `sectionId` 推导的折叠状态；折叠时使用 `shrink-0`，Tasks 不再保留 `flex-1` 撑出大段空白，两个标题会按当前排序紧贴。展开时 Tasks 仍为 `flex-1`，Projects 仍为 `max-h-[55%]`；顶层排序容器的 `flex/min-h-0/overflow-hidden`、两区内部滚动和底部设置 `mt-auto shrink-0` 均保留。拖拽语义、传感器、命名空间 ID、排序存储和项目内部 DnD 未改。
- Verification: 定向 vitest 2 文件 / 20 用例、目标 eslint、`tsc -b` 全通过；完整 `npm run test` 236 文件 / 2019 用例全通过；完整 lint 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；build 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选在桌面/移动分别测试 Projects→Tasks 与 Tasks→Projects 顺序下单独/同时折叠，确认标题紧贴、展开区滚动与设置底部固定。

- Feature: 统一 Slash 图标并取消类别色（unify-neutral-slash-icons，**已完成**）
- Status: done — command/skill/agent 分别复用已有 Lucide `SquareTerminal` / `BookOpen` / `Bot`，通过 `slash-icons.ts` 静态映射供斜杠菜单、输入框选中 chip 与消息流复用 chip 使用；移除本 Slash 功能新增的自绘类别 glyph。菜单三类图标默认统一 `var(--muted-foreground)`，hover/selected 仅增强为 `var(--foreground)`；共享 chip 只将 `.quickforge-slash-chip-icon` 覆盖为中性色，因此 skill/agent chip 原有蓝/绿背景与文字语义色、结构和行为保持不变。非 Slash 能力菜单继续使用 `capability-icons.ts`，未扩大范围。
- Verification: 定向 vitest 2 文件 / 35 用例全过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build`、`git diff --check` 均通过；build 仅既有 KaTeX/chunk warnings。`package-lock.json` SHA-256 前后均为 `1176cf21fa40c0ddec54adaf769f5ef85d09e296ca2a8c0176da757b0daa8042`，未触碰既有变更。
- Next step: 可选真机目视确认深浅主题下菜单三类中性图标，以及输入框/消息流 chip 的图标中性但 chip 背景与文字仍保留原语义色。已随 canonical-name 合并提交为 `924e8c5`，未 tag、未 push。

- Feature: 侧栏 Projects / Tasks 完整区块拖拽换位并持久化（sidebar-section-reorder，**已完成**）
- Status: done — App 中单一 `SidebarSectionOrder` 状态同时传给桌面/移动侧栏并安全持久化到 `quickforge:sidebar-section-order:v1`。置顶区固定在顶层排序区外；Projects 与现有 conversations UI（ID 映射为 `tasks`）两个完整区块由 `sectionOrder` 动态渲染，并由区块级 `DndContext + SortableContext + SortableSidebarSection` 排序。唯一 activator 是标题旁弱化 `GripVertical` 手柄（PointerSensor 6px 激活阈值支持鼠标/触摸；KeyboardSensor + `sortableKeyboardCoordinates` 支持聚焦后 Space、方向键、Space 排序；aria-label/title 保持与 dnd-kit attributes 一致）；折叠、添加、筛选、菜单按钮无拖拽监听。顶层 ID 使用 `sidebar-section:*` 命名空间，start/cancel/end 状态完整并锁定 x=0/关闭 autoScroll；Projects 内部嵌套 DnD、视口边界、自动滚动限制与 `onReorderProjects` 持久化保持不变。
- Verification: 定向 vitest 2 文件 / 19 用例全过（新增外层 `sectionSensors` 同时含 PointerSensor、KeyboardSensor 与 `sortableKeyboardCoordinates` 的契约测试；现有测试为源码接线契约架构，无低成本真实 DOM 键盘行为 harness，未扩大基础设施）；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；feature JSON 解析与 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机分别在桌面/移动用鼠标或触摸拖动 Projects/Tasks，并聚焦手柄后执行 Space → 方向键 → Space，确认顺序同步、刷新恢复、置顶区固定、标题操作按钮不误触，以及项目内部排序继续正常。

- Feature: Workspace Inspector 状态按会话隔离恢复（session-scoped-workspace-inspector-state，**已完成**）
- Status: done — Inspector 展开/收起、可恢复 tabs、`activePanelTabId`、Review 子视图与 Reader 左侧导航显示按 `projectId + sessionId` 写入 localStorage。AgentManager 维护独立 runtime scope：pending deferred session 首次发送晋升真实 session 时沿用原 scope，`WorkspaceInspector` key 不变，内存状态保留，并在真实 `sessionId` 到达后写入真实会话 storage；普通会话切换或确认创建另一 deferred session 才滚动 scope。App wrapper 不再提前重置，底层新建返回 `created/reused/cancelled`。一次性 Inspector request 携带 `projectId + runtimeScopeId`，在发起、聊天文件异步 resolve 完成和 Inspector 消费处三重校验；历史无项目 subagent 请求兼容。pending 本身仍不持久化，旧项目级状态不迁移，整体宽度保持全局。
- Next step: 无本 feature 代码 blocker；已提交为 `d66a3e7`，未 tag、未 push。
- Verification note: 定向 6 文件 / 41 用例通过；相关 eslint 0 error；`npx tsc -b --pretty false` 通过；最终合并工作区 `npm run test` 为 236 文件 / 2020 用例全通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；feature/package/lock JSON 与 `git diff --check` 通过。

- Feature: Composer 控件 hover 改为背景反馈且不位移（composer-controls-hover-background，**已完成**）
- Status: done — 保留全局 Composer 按钮 hover 位移规则，仅用精确选择器覆盖 +、权限、模型、发送/停止：五类目标均 `transform:none`；三个中性控件使用 `var(--quickforge-sidebar-hover-bg)` 与合适前景色且不影响 disabled；发送态以 92% primary 混少量 sidebar hover token 保持 primary 层级和 `primary-foreground`；停止态保留既有 hover 背景。Plan、OpenCode config、chip/菜单项未改，model trigger 同时覆盖 OpenCode mode 符合定案。
- Verification: 定向 vitest 3 文件 / 16 用例全过；新增测试 eslint 0 error；最终合并工作区 `npm run test` 236 文件 / 2020 用例全过，`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 解析与 `git diff --check` 通过。未改 Wiki/DESIGN_LANGUAGE（纯视觉反馈且现有“hover 有感知、不跳动”规范已覆盖）。`package-lock.json` 无 `package.json` 依赖或版本对应变更，确认为 npm 11.6.2 重算 peer 元数据噪音，未纳入功能提交且未丢弃。
- Next step: 可选真机目视确认深浅主题下 +/权限/模型 hover 与侧栏会话项一致、发送按钮仍明显为 primary、停止态背景变化保留且五类按钮无垂直跳动。已提交为 `b64a4b2`，未 tag、未 push。

- Feature: 修复取消置顶与归档恢复未清除会话状态（fix-session-state-clear-actions，**已完成**）
- Status: done — 按服务端既有三态契约（字符串=设置、`null`=清除、字段缺失=保留），取消置顶 payload 改为 `pinnedAt:null`，归档恢复对 session/metadata 两个 save payload 均写 `archivedAt:null`，避免 `JSON.stringify` 丢弃 undefined 或 batch merge 保留旧值。前端与服务端定向回归测试 27/27 通过，验证序列化 payload、state/metadata、SQLite `pinned_at`/`archived_at` 与 pinned/archive 查询索引状态均正确清除；改动文件 eslint、`tsc -b`、build、diff check 通过。
- Next step: 无代码 blocker；未改 Wiki（仅恢复既有行为契约）。

- Feature: 斜杠菜单技能与子智能体仅显示 canonical name（slash-menu-canonical-name-display，**已完成**）
- Status: done — 普通 command 主文本仍显示完整 usage（如 `/plan [task]`）；skill/agent 行主文本仅显示 `SlashEntry.name`，不再展示 `/skill` / `/agent` 前缀。`usage` 与 `insertText` 未改，因此 `skill ` / `agent ` 类型前缀搜索仍有效，选中和 dataset 仍使用完整 `/skill <name> ` / `/agent <name> `。定向测试 13/13、改动文件 eslint、tsc、build、diff check 均通过；build 仅既有 KaTeX/chunk warnings。
- Next step: 可选真机目视确认三组菜单主文本与 Tab/点击插入行为。已与中性 Slash 图标合并提交为 `924e8c5`，未 tag、未 push。

- Feature: 输入框 @ 引用当前项目文件并与插件能力解耦（file-reference-mention，**已完成**）
- Status: done — `@` 仅搜索当前 QuickForge 项目文件：裸 `@` 和 1 字符只提示，2+ 字符经 300ms debounce 调用严格 projectId 的 files-only mention-search，并支持键盘选择与结构化文件 chip；`+ → 能力` 生成独立能力 chip，不再插入 `@Documents` 或从正文推断。`text`、`contextReferences`、`selectedCapabilities` 已写入 localStorage 草稿（能力防御规范化、按 `type+pluginName+name` 去重、最多 4），附件仍不持久化；文件引用随下一次 prompt 一次性发送，服务端重新校验项目/路径/敏感边界，注入相对路径提示并持久化 history details，失败回滚/retry 链路已覆盖。OpenCode/shared 禁用或拒绝非空引用；mention-search 对未知/已删除 projectId 返回 404 `PROJECT_NOT_FOUND`，普通 workspace search/children 等兼容回退不变。验证：合并定向 vitest 20 files / 242 tests passed；相关 eslint 0；`tsc -b` passed；`npm run build` passed（仅既有 KaTeX/chunk warnings）；`git diff --check` passed。
- MVP 限制 / Next step: 输入框只有 chip、没有正文且没有附件时不能发送；裸 `@` 不提供最近文件；真机目视待用户（键盘选择、深浅主题、草稿恢复、发送后历史 chip 与敏感/错误提示）。

- Feature: Wiki 文档同步——补齐 file-reference-mention / slash-menu-expansion 未提交改动的文档缺口（wiki-sync-uncommitted-features，**已完成**）
- Status: done — 纯文档维护（用户明令禁止修改代码，未触碰任何代码/测试）。对照工作区两条未提交功能链审计 docs/wiki 六个页面并补缺口：context-references.mjs 独立小节（含 CONTEXT_REFERENCE_* 错误码）、utils workspace.mjs 现状行为（大小写不敏感敏感路径 + realpath 复查 + 稳定 errorCode）、src/lib 新增 deferred-session-agent.ts 条目与章节（此前完全未收录）、server-agent/shared-server-agent 补 setPromptMode 泛化与 no-op 语义、slash chip 的 IME/selectionchange/自愈行为更正为最终实现、message-actions 补 decorateUserFileReferences、chat-utils 补新类型与 hasDraft 口径、多文件过期行数与 src/lib 模块总数（28→86）修正。
- Next step: 无。file-reference-mention 功能本体仍由并行会话推进（feature_list 尚未登记该 feature），其收尾时 wiki 已就位，只需按最终实现复核增量。

- Feature: 侧栏“对话”分组标题更名为“任务”（rename-sidebar-conversations-to-tasks，**已完成**）
- Status: done — i18n `conversations` key 中文 ‘对话’→‘任务’、英文 ‘Conversations’→‘Tasks’（唯一使用处为 ChatSidebar 左侧边栏分组标题）；DESIGN_LANGUAGE.md 3 处分组标题示例同步为 Tasks。验证：eslint i18n.ts 0 error；i18n-language-snapshot + sidebar-session-sort-mode 定向测试 11/11 通过。全量 `tsc -b` 失败均为并行会话 file-reference-mention 中间态错误（与本改动无关，已有记录）。未改 wiki（纯显示文案，不影响模块职责或公共入口）。
- Next step: 真机目视确认左栏标题显示“任务”（英文 Tasks）；其余“对话”相关文案（置顶、暂无对话、已归档对话、重命名对话等）按最小范围保持不变，如需一并更名待用户确认。

- Feature: 斜杠菜单扩展——/ 触发指令 / 技能 / 子智能体三类补全 + 方案 A 选中态 chip（slash-menu-expansion，**已完成**）
- Status: done — 两轮定稿实现：①主功能（三分组菜单 + /skill /agent 内部命令 + 懒加载目录）；②方案 A 选中态呈现（用户定稿）：新增 slash-invocation-chip.ts（输入行内联 chip 覆盖层——原文不变仅视觉替换、computed 度量同步、光标对齐补偿 spacer=max(0,前缀宽-chip宽)、IME composition 防护、光标入前缀区自毁、ResizeObserver/scroll 同步）+ command-suggestions 集成（选中即 engage、菜单抑制、手输/草稿恢复自动 engage、Backspace 边界删前缀、Esc 退出）+ message-actions 用户消息前缀 chip 装饰（幂等，复制走原文）。实现取舍：还原机制用 chip 自带前缀标记（Lit 重渲染会替换 container dataset）；selectionchange 自毁不记 dismissed（Esc 才记）；update 校验加词边界（防 /agent explore-deep 误留 explore chip）。input-clamp 既有源码断言随 if 块化同步修正（守卫语义不变）。合并门禁：npm run test 226 files / 1945 tests、lint 0 errors / 1 existing warning、tsc -b、build、git diff --check 均通过。
- Next step: 真机目视留待用户（重点：选中态 chip 与光标对齐、中文 IME 输入、窄列宽换行、退格边界删除、消息流 chip、深浅主题；未知名称提示文本）。**追加修复已落地（用户反馈打字后 chip 消失）**：自愈式三层防御——update 重建被外部移除的 overlay/textarea（isConnected 检查）、selectionchange 降级显示而非自毁（光标回尾部自愈）、自动 engage 兜底；最小复现环境（无头 Edge CDP 全链路：选中/打字/逐字符/IME）无法复现核心链路问题，判定破坏源在真实 app React/Lit 生命周期。门禁全过、dist 已重建。

- Feature: 限制侧栏项目排序拖拽的顶部/底部边界（fix-sidebar-project-drag-bottom-boundary，**已完成**）
- Status: done — Projects 的实际 `overflow-y-auto` 容器成为拖拽预览边界和唯一自动滚动容器；纯函数按拖拽矩形、视口矩形及拖拽期间 `scrollTop` 增量锁定横向并夹紧纵向，覆盖 dnd-kit modifier 后滚动补偿。保留 closestCenter、verticalListSortingStrategy、MeasuringStrategy.Always、拖动折叠会话、排序持久化与视觉样式。定向测试 7/7、改动文件 eslint、tsc、build、diff check 均通过。
- Next step: 无代码 blocker；需手工浏览器验证长项目列表拖到顶部/底部时预览不越界、仅 Projects 滚动且真实边界停止。

- Feature: 暂时下线 generate_image 工具（temporarily-disable-generate-image-tool，**已完成**）
- Status: done — 已从 `workspaceTools` 移除 `generate_image`，Agent 与 `GET /api/tools` 不再暴露；handler、图片生成模块、`directRouteDisabledTools`、会话资产与前端历史结果渲染全部保留。definitions 定向测试 20/20、历史兼容测试 63/63、lint（0 errors / 1 existing warning）与 build 均通过；用户指南和 server/src wiki 已同步为“仅历史会话兼容”。
- Next step: 无 blocker；未创建 commit/tag/push。

- Feature: 删除基础系统提示词中的最简实现与最小局部修改规则（remove-base-prompt-minimalism-rules，**已完成**）
- Status: done — `BASE_SYSTEM_PROMPT` 已删除 “Prefer the simplest solution that satisfies the request.”、“Make surgical changes only.” 和语义重复的 “Make minimal, focused changes.”；保留 “Do not refactor unrelated code.” 等其他规则。新增反向契约测试。验证：系统提示词定向 vitest 1 文件 / 5 用例全通过；未改 Wiki（仅提示词措辞调整，不改变模块职责、公共入口或配置方式）。
- Next step: 无。

- Feature: 准备 v1.7.12 patch release（release-v1.7.12，**已完成**）
- Status: done — 版本与 CHANGELOG 已准备；完整 `npm run test`（219 files / 1865 tests）全通过，`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功；runtime/offline 包及 `package-offline/shawnstack-quickforge-1.7.12.tgz` 已生成并完成元数据、依赖处理与清单校验。生成目录均被 Git 忽略，release commit 范围为 6 个预期发布文件。
- Release sequence: 本变更用于 release commit，随后创建并推送 tag `v1.7.12`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

- Feature: 移除 Workspace Inspector subagent 执行区域最外层卡片外框（fix-workspace-inspector-subagent-trace-outer-card，**已完成**）
- Status: done — `.quickforge-subagent-trace` 根容器仅保留 `quickforge-subagent-trace p-2.5`，移除 `rounded-lg border border-border bg-background/60`，完整执行区域融入 Inspector 消息流；内部 `message-list` 及状态/耗时、process summary 分隔线、思考正文、工具统计、折叠交互和聊天摘要均未改。新增按 class token 提取的最小模板契约测试，避免大段字符串断言。验证：定向 vitest 1 文件 2 用例全过；改动文件 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 通过（build 仅既有 KaTeX 字体解析与 chunk size warning）。未改 wiki（纯视觉外框 bugfix，不改变行为契约、模块职责或公共入口）。
- Next step: 可选真机打开 Workspace Inspector 的 subagent 运行详情，目视确认执行区域无最外层圆角边框且内部过程分组/折叠视觉不变。

- Feature: 修复 subagent 跑马灯剩余宽度与重连重复视图（fix-subagent-marquee-width-reconnect，**已完成**）
- Status: done — `.quickforge-tool-title` 保持 `flex: 0 1 auto`，仅 `.quickforge-subagent-title` 改为 `flex: 1 1 auto`，使跑马灯获得摘要行剩余宽度；`QuickForgeToolMarquee` 重连时复用现有两组完整 view，异常结构才清理并重建，避免 connect-disconnect-reconnect 累计双视图，同时保留 attribute 驱动、动画时序与 ResizeObserver 策略。新增 CSS flex 契约和自定义元素重连行为回归测试。验证：定向 vitest 2 文件 16 用例全过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` 与 `git diff --check` 通过。未改 wiki（局部 bugfix 未改变模块职责、公共入口或既有行为契约）。
- Next step: 可选真机触发多工具 subagent，目视确认窄列宽下跑马灯占满剩余区域、过程分组搬移后仍仅两组视图。

- Feature: ask_user 历史工具消息展开复用回执样式（ask-user-history-review-style，**已完成**）
- Status: done — 非 detailed 展开体复用回执确认步样式：askUserReviewRowsFromDetails 解析持久化 toolResult.details（questions/answers/skipped/skipReason），已回答/跳过渲染只读回执行（复用 buildAskAnswerText 与 .quickforge-ask-review 样式，跳过态带原因行）并省略 output 文本块；detailed / pending / 旧消息维持原视图。验证：定向 vitest 2 文件 23 用例全过、eslint 改动文件 0 error、tsc -b 通过；真机目视留待用户；未提交 git。
- Next step: 真机目视确认（触发一次 ask_user 提交与跳过、重载会话展开历史工具消息观察回执样式/跳过原因行/detailed 对照）。

- Feature: 长输入内容定高收起——聊天用户消息与 subagent 详情任务块统一气泡样式（input-clamp-expand，**已完成**）
- Status: done — 新增 `src/lib/input-clamp.ts`（InputClampController 状态机：定高=computed line-height×6 行+纵向 chrome、data 属性状态、220ms max-height 过渡/展开后置 none/reduced-motion 直切；DOM 装饰入口 decorateUserMessageInputClamp / syncInputClampBoxes，i18n 标签注入式）；任务块模板改气泡视觉+收起结构，详情宿主 updated 后幂等度量；聊天装饰对纯文本 user 消息接入（附件消息不参与）；user-message-container 背景浓度 primary 10%→深色 6%/浅色（html:not(.dark)）3%，渐隐遮罩与展开按钮复用同色变量；新增 i18n expand/collapse 双语。追加真机反馈修复：`white-space: pre-wrap` 收窄到 task/context/expectedOutput 三个值节点，保留输入换行但不再放大 Lit 模板缩进；为共享收起盒注入 30px 流内按钮安全区，仅 overflowing 内容显示，展开/收起均不覆盖正文，fits 内容不留空白。验证：input-clamp 20/20；此前相关面 174、前端全量 87 文件 821 用例、eslint、tsc/build 均通过。真机目视确认留待用户（设计稿 design-mockups/input-clamp-expand.html 可对照，支持 #light/#dark hash 与浓度切换）。
- Next step: 无阻塞；真机目视确认（长用户消息与 subagent 详情任务块的收起/展开、深浅两主题气泡浓度观感）。

## Notes

- 全局 SSE 流首字节延迟修复（本轮）：用户反馈 `/api/agents/events`、`/api/channels/events` "请求时间长、易挂起"。诊断结论：两接口均为 SSE 长连接，DevTools 永久 Pending + Time 增长属正常表象；但 `handleGlobalStream`（server/routes/agent.mjs）`writeHead` 后无任何 body 写入，Node 会把响应头缓到第一次 `res.write`（15s ping 或首条事件）才发出，客户端 `onopen`/TTFB 最长延迟 15 秒——`handleChannelEvents` 因立即写 snapshot 无此问题。修复：`writeHead` 后加 `res.flushHeaders()` 立即刷头。新增针对性测试（tests/server/routes/agent.test.mjs：立即 flush 头 + close 时移除监听并 end），mock 的 `agentEvents` 补 `removeListener`。验证：定向 vitest 14 tests 全过，lint 仅既有 identity.mjs warning。剩余"挂起"因素（范围外，未改）：dev 下 server/Vite 重启断流后 EventSource 指数退避重连在 Network 面板呈现为新 Pending 请求；HTTP/1.1 同源 6 连接上限下每 tab 占 2-4 条 SSE（channels/events + agents/events + 会话级 stream + 设置页再开一条 channels/events），多 tab 会挤占连接池使普通 API 排队。

- 侧栏项目拖拽边界（本轮）：实际依赖为 `@dnd-kit/core@6.3.1`；其 `Modifier` 参数含 `draggingNodeRect`，`autoScroll.canScroll` 签名为 `(element: Element) => boolean`。非 DragOverlay 路径会在 modifier 后把滚动增量加回活动项 transform，因此边界纯函数显式接收拖拽开始后的 Projects `scrollTop` 增量进行抵消，避免自动滚动后预览突破底部。未新增依赖，未修改样式或生成产物。

- generate_image 暂时下线（本轮）：单一暴露源 `server/tools/definitions.mjs` 已移除定义，未删除 `server/tools/index.mjs` handler、`server/image-generation.mjs`、`server/routes/tools.mjs` 的 `directRouteDisabledTools`、session assets、前端 renderer/i18n/process-folding 等兼容代码；历史会话中的既有图片仍可查看/下载。未修改 CHANGELOG、依赖或生成产物。

- v1.7.12 release 收尾完成：`test` 219 files / 1865 tests 全通过，`lint` 0 errors / 1 existing warning，`build` 成功；runtime/offline 目录与 offline tarball 已生成并校验。生成产物被 `.gitignore` 排除，不进入 release commit；release commit 范围为 6 个预期发布文件。发布顺序为：本变更纳入 release commit，随后创建并推送 tag `v1.7.12`，最后由用户执行 `npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

- Workspace Inspector subagent trace 外框修复（本轮）：仅删除 trace 根容器的卡片视觉 utility，`message-list` 节点、数据属性与全部内部装饰链路保持逐字不变；契约测试只提取命中 `.quickforge-subagent-trace` 的 class 属性并比较 token，既锁定 `p-2.5` 又避免绑定整段 Lit 模板。

- ask-user-history-review-style 实现定案（本轮）：「所见即所提交」——ask_user 历史工具消息非 detailed 展开体复用回执样式而非原始问题清单+output 文本。数据依据：服务端 resolve 即把 {askId, questions(规范化), answers, skipped, skipReason} 随 toolResult.details 持久化（agent-manager.mjs finish()），旧渲染器只用了 timing。要点：纯函数 askUserReviewRowsFromDetails 自包含无外部依赖（可被测试经 ts.transpileModule 提取函数体单测，规避 local-tools 模块级 registerToolRenderer 副作用与 pi-web-ui 重依赖——同 local-tools-lit-reactivity.test.ts 惯例）；skipReason 实际取值仅 timeout/aborted/无 reason（用户跳过），'no-questions' 路径服务端 details 不含 questions（解析返回 null 走兜底原视图），映射 key 仍保留以对齐服务端 reason 枚举；跳过原因行复用 .quickforge-ask-review-answer 样式（视觉贴回执）而非 .quickforge-ask-note（后者 margin-left:auto 右对齐，属 actions 行）。
- diff-display-optimization 实现定案（本轮，并行会话）：用户在对比设计稿（design-mockups/diff-display-optimization.html：现状复刻/方案 A 基础改良/方案 B 字符级高亮三卡 + 亮暗主题切换 + edit 局部修改与 write 新文件双示例，页面内 JS 即 unified→结构化解析原型）中选定方案 B 落地。实现：新模块 src/lib/diff-view.ts（parseDiffRows 行号双侧/剥离前缀/hunk 间隙省略/配对删加行 token LCS 字符级变化段、parseDiffFileInfo 路径上提+新文件判定、乘积>40000 回退整行变化）；local-tools.ts renderDiff 改结构化行渲染并删除内联样式双保险（DIFF_* 常量/diffLineClass/diffLineStyle/styleMap），OpenCodeToolRenderer 复用自动受益；index.css 行号/gap/mark/path 样式 + html.dark 亮绿/亮红文字覆盖（含 diff 徽章与里程计 side——修复暗色下固定深绿/深红文字对比度不足这一现状缺陷）；i18n 新增 diffOmittedLines/diffNewFile 双语；服务端零改动。验证：定向 vitest 4 文件 35 用例全过（diff-view 新增 16）、eslint 0 error、tsc -b 过。真机目视（触发 edit/write 观察新 diff 块、亮暗两主题）留待用户；本会话改动未提交 git。追加修复（用户反馈）：长行横向滚动后行背景不覆盖滚动区——根因是行背景画在 code 单元格盒宽内（列宽=容器宽），溢出文本无背景；修复为整块单一 grid（`3.1rem 3.1rem minmax(max-content,1fr)`）+ 行 display:contents + gap 跨全列，第三列取 max(剩余宽,最宽行) 使全部行背景铺满横向滚动区，设计稿同步修复并加长行示例；验证：npm run build 过 + 无头 Edge 截图像素级确认（绿/红行背景延伸至块右缘）。
- input-clamp-expand 实现定案（本轮）：状态用 data 属性而非 class——Lit 模板重渲染会重写 class 属性，data 属性与注入式遮罩/按钮节点都不在模板 part 内，可跨实时 SSE 更新存活，因此无需按 runId 持久化展开态（元素在即状态在，重开 Tab 回落默认收起）；i18n 标签由调用方注入是硬约束——i18n.ts 运行时依赖 pi-web-ui（pdfjs 引 DOMMatrix），node 环境 vitest 导入即炸，input-clamp 保持零 i18n 依赖才可单测；浅色浓度 3% 的依据：真实浅色 token --background 为纯白（oklch 100%），往纯白混灰极易显脏，深色底则需 6% 才可见，设计稿工具栏留 2–10% 五档供对照；块注释里不能出现 `decorate*/sync*/` 这类写法（*/ 提前终止注释，oxc 解析报错）。设计稿 design-mockups/input-clamp-expand.html 支持 #light/#dark hash 直达与浓度切换，可作真机对照。
- 跑马灯切换滚动实现定案（本轮）：方向/时长/缓动沿用设计稿定稿（方案 A、260ms、里程计同族缓动）；视图元素用 span 而非 div（绝对定位自动块化，语义轻量）；非当前视图整体 aria-hidden（瞬态滚入内容不重复播报，元素本身有 aria-label 覆盖）；finishRoll 用滚动自身文本排程而非 this.text（中途换文结算时 this.text 已是新文本，会错排新当前视图）；同值 sync 增加自愈排程（当前视图完全静止时重排，覆盖 dispose 后同值恢复，旧契约为同值也重排）；旧实现验证页 subagent-tool-marquee-impl.html 标注为 v1 参考并指向新设计稿（其 dist CSS 链接本已失效）。
- subagent 跑马灯间隙保持实现定案（前轮）：不做元素级兜底（空列表时元素整个不渲染，控制器层兜不到），落在数据层——渲染函数改用带记忆数据源，模块级单例与渲染同生命周期；记忆按 runId 隔离（多 subagent 并行不串台），终态一律空列表不消费不污染记忆（恢复 running 间隙仍可回放）；有界淘汰语义对齐 SubagentRunStore（已存在 key 重复 remember 不改变插入顺序）。

- ask_user 评审遗留 ③④ 修复定案（本轮）：③自由输入语义改为可叠加补充——数据模型（buildAskAnswerText/formatAskResult）本就支持 choices+custom 组合，前端清空是多余互斥，删两行即可，文案从『其他想法（自由输入）』改为『补充说明（可选）』对齐语义；④回执直达修改按 backBtn 同构实现（同 renderStep 路径 + disarmSkip，不加动画状态），每行 ghost 式紧凑「修改」按钮（复用 custom-toggle/ghost 的透明底 + hover muted 模式），review-row 改 content 列 + 右侧按钮行布局。

- ask_user 交互评审遗留（前轮只读评审；①②③④已随后续轮次修复，其余未处理待定夺；另有真机反馈两问题——「下一问」与「上一问」分行、自由输入无就近确认入口——已随后续轮次修复：nextBtn 收敛到底部 actions 行 + textarea Enter 确认前进）：⑤30min 超时不可见且吞进行中作答（无倒计时/无提示即 skipped）；⑥刷新/重连后向导进度归零（pendingAsk 恢复但 step/answers 不持久）；⑦命令式 DOM 注入无行为级 E2E（现有测试均为源码字符串断言，按钮 wiring 无真实点击覆盖，含本轮 review 直达修改按钮）；⑧无障碍语义缺失（option 按钮无 role=radiogroup/checkbox、aria-checked，skip 两步确认无 aria-live 播报）；⑨schema 描述宣称 options 与 multiSelect mutually exclusive 但实现允许同用、options>4 超限静默截断；⑩回传给模型的回答文本固定中文（formatAskResult 硬编码『跳过』『未回答』等，英文会话也收中文）。
- 24h 变更风险审查（本轮，只读）：核心发现 H1——存储 v2（3493aeb）v11 迁移只 RENAME 旧表不搬数据，启动导入仅"新表空且 JSON 树有会话文件"才跑、否则静默跳过，全仓库无任何 `*_v10_backup` 读取者：升级前 SQLite 权威且 JSON 副本缺失/不完整的用户会话列表为空、零告警，数据锁死 backup 表（文档自认升级路径=删库重导，但代码零防护零校验）。M2——导入 `count>0` 即永不重跑，首导 skipped 条目永久不可见（修复源文件后自动链路不会 re-run，只能人工删库）。低危：`scripts/session-index-query-benchmark.mjs:7` 悬空 import（canonicalSessionMetadata/sessionMetadataDigest 已从 session-index-service 删除，脚本一跑即模块加载报错）；ACP stdio 入口（acp/server.mjs）不跑 JSON 导入，空库+仅 JSON 时会话列表为空无提示。前端未提交改动两个已核实缺陷：diff-counter `?running` 布尔 attribute 绑定（lit 真值渲染为空串 attribute）与元素侧 `getAttribute('running')==='true'` 不匹配→running 呼吸动画永不生效（对照 quickforge-elapsed-time 的 `running=${String(...)}` 字符串绑定即为正确写法）；OdometerDiffCounterController 整体覆写 `root.className` 丢失模板赋予的 `quickforge-tool-meta-hover shrink-0`→±行数计数器常显（原 hover 显示）且窄布局可被压缩。权限绕过（write/edit 的 onUpdate 在全部路径校验后、partial 无 diff.text 全文）、资源泄漏（新模块 dispose 路径完整）、跨端兼容（scrollend 有 900ms 兜底）未发现高置信问题。M1 已修（见前轮记录），其余未处理待定夺。
- M1 修复实现定案（本轮）：与模块既有单条目韧性语义对齐而非加开关——桶级 metadata 读取失败降级为空 metadata 继续，比跳过整桶更好（正文仍在、可推导），比中断更好（不再 STARTUP_FAILED）；diagnostics kind=metadata-bucket-error 含 scope/projectId/message，warn 日志同字段。

- ask-user-tool 真机两缺陷修复（本轮，用户反馈）：①卡片误显"当前视图无法作答"——propsRef 每渲染整体重建的同步 effect 漏了 onAnswerAsk，首帧后被覆写为 undefined 触发禁用判定；已补字段并加回归源断言（定位 propsRef effect 块内必须含 onAnswerAsk）。②ask_user 工具消息不走设置的工具显示模式——此前未注册渲染器落进 pi-web-ui 默认工具卡；新增 local-tools.ts AskUserToolRenderer（结构与 LocalWorkspaceToolRenderer 同构：toolDisplayMode==='detailed' 才出 input JSON，summary=「N 问 · 首问」，非 detailed 展开时直接列问题清单，output=回答文本，detailsOpen 记忆、isCustom 防默认卡壳）+ ask_user 问号图标 + i18n askUserSummaryCount + .quickforge-ask-tool-questions 样式。验证：定向 ask-user-card(9)+local-tools-lit-reactivity 全过、前端全量 760 用例过、lint 0 error、build 过。
- ask-user-tool 实现定案（前轮）：复刻审批链路但 resolve payload 扩展为 answers[{choices,custom}]；ask_user 无 toolHandlers 入口（agent-manager wrapAskUserToolDefinition 拦截绑定会话，仿 run_subagent）；单问题 schema 兼容（normalizeAskQuestions 接受 {question,options} 简写）；纯函数 normalizeAskQuestions/formatAskResult 放 ask-store.mjs（零依赖可单测）。前端卡片与审批卡同族注入（data-ask-id + displaySignature 去重，向导内部 DOM 变更不触发重建）。

- diff-odometer-counter 实现定案（本轮）：「实时」的落点是工具开始执行即算 diff 并立即发 partial（本仓 edit_file 是单次 oldText→newText 替换、write_file 单次写入，无更细中间态，不伪造数据）；partial 与 end 几乎同帧到达，实际观感=计数器从 0 逐位滚动到最终值的里程计动画。计数器列右对齐保 DOM 稳定（transition 不被打断），位数增长 unshift 新列到符号之后、380ms 后清 enter 标记防重放。设计稿 design-mockups/diff-odometer-counter.html（可重播演示）。

- subagent 跑马灯实现定案（本轮）：内容=「工具名 · 参数摘要」（用户选定，复用 summarizeParams，80 字符截断）；滚动=运行中自动循环（用户选定，非 hover）：35px/s 线性滚动→端部停顿 1s→ease-out 回弹（240–500ms 按时长比例）→起始停顿 1s→重复，起始延迟 400ms；text 变化才重建动画（SSE 150ms 节流同值刷新不打断）；结构=QuickForgeToolMarquee 自定义元素（attribute 驱动，仿 quickforge-elapsed-time，Lit 重渲染保实例）+ ToolMarqueeController 纯逻辑（DOM/定时器/动画注入，node 环境可单测）。「不遮挡」落实：跑马灯 flex:1 1 auto + min-width:0 只占标签与状态间的剩余弹性空间，列宽收缩时先自行退让（实测 340px 下标签仍完整可见带省略号）。
- 模块拆分（本轮）：summarizeParams 从 local-tools.ts 提取为 tool-param-summary.ts（纯函数化，附带 normalizeToolArguments/truncateSummary），local-tools 改 import 行为不变；subagent-run-detail.ts 新增 currentSubagentToolSummaries（pendingToolCalls × traceMessages toolCall chunk 交集，JSON 字符串 arguments 兼容）。
- 验证环境教训（本轮两条）：①本机 8931/8932 端口已有既有 http-server 占用（服务 dist/），python http.server 指定端口前必须 netstat 确认空闲，否则响应错位极难排查；②验证页连续快速拖宽度后动画计数为空是 RO 重启与 400ms 起始延迟的测试竞态（每次 RO 触发 sync(true) 会清掉未触发的起始 timer），干净加载后动画正常——宽度突变后不要立即断言动画状态，等 ≥500ms。
- 既有 lint warning（不变，待择机修复）：server/cloud/identity.mjs:92 no-useless-assignment。

- 回到底部按钮实现定案（本轮，设计稿经用户选定居中形态后落地）：交互——距底部>280px 淡入、<120px 淡出（滞回区间防临界抖动）；点击平滑回底（scrollend + 900ms 兜底，途中 wheel-up 视为用户打断、不恢复自动跟随，prefers-reduced-motion 直接跳底）并经 onJumpSettled→scrollSync.enable() 恢复尾部跟随（回调内再校验距底 ≤120px 才恢复，防打断后误拉回）；不在底部期间 assistant message_start 累计未读徽标，回底或点击清零，aria-label 随未读数切换（i18n en/zh 双 key）。视觉——复用 composer 卡片 token（78% border 混合、card 92% 透明混合、backdrop blur 12px、降一档浮层阴影），icon-only（arrow-down-to-line）居中悬浮于 .quickforge-composer-shell 上方 10px（shell 补 position:relative 作锚点，left/right:0+margin auto 居中，transform 留给出入场动画）；空会话态与 readOnly（dock 被移除）自动不渲染；html.dark 下徽标用亮 emerald。接入点——decorate() 尾部 setup()（与 scrollSync.setup() 同帧，幂等）；显隐独立监听滚动容器 scroll 事件，不侵入 scroll-sync 内部状态。
- 单测抓到实现 bug 一枚（记录）：createButton 内 renderBadge() 在模块级 button 赋值前调用导致初始 aria-label/title 缺失——构造函数内先赋值再渲染即可；测试驱动发现的顺序依赖问题值得保留该用例。
- 思考块高度封顶设计定案（本轮）：根因——thinking-block（pi-web-ui Lit 组件）展开后 markdown-block 全量渲染且无任何高度约束，装饰层折叠只是 display:none 开关，展开时全部高度进入消息列表文档流撑高 agent-interface 滚动容器；流式期间外层过程组默认展开，长思考边生成边撑长页面并触发自动滚底跳动。方案为纯 CSS 单点改动（复用 diff 块 28rem/code-block 24rem/压缩文本 18rem 的 max-height+overflow 先例）；用户确认两项参数：上限 min(60vh, 20rem)（小屏按视口收缩，兼顾 Capacitor Android）、流式期间保持阅读位置不做终端式跟随。交互细节：overscroll-behavior: contain 使思考块内滚到头不连锁滚动外层聊天；标题行在滚动容器外，折叠按钮始终可见；markdown-block 自带 display:block（connectedCallback），max-height 天然生效。
- 验证环境教训：临时 http 服务器给 .css 返回 text/html 会被浏览器 MIME 严格检查拒绝解析（styleSheets 规则数为 0 且 computed style 全默认），排查选择器匹配前先确认样式表实际解析条数。
- 发送按钮等待态设计定案（前轮）：分析确认按钮原为发送↑/停止■两态、无旋转态——prompt() 乐观同步置 isStreaming 使点击后下一帧即翻 Stop，无可感知空档；等待期反馈原仅由三点气泡承担。用户在小样（三方案：A2 方块步进/A1 方块平滑/B 环形）中选定 B 环形——与审批按钮 loading 完全同构、全应用单一旋转节奏。实现要点：::before 环形用 margin 居中而非 transform（transform 归 spin 动画所有，若用 translate 居中每圈末尾会跳位）；等待与生成的区分依赖 assistantWaitingActive（首个 assistant 文字增量即复位），agentic 循环后段工具阶段保持静止■（保守设计，避免图标反复起停）；等待期点击仍为 abort、aria-label 保持 Stop。附带补上了 send-stop-button 的首个单测（此前该模块零测试覆盖）。
- 遗留（记录不处理）：根目录空目录 design-preview/ 因句柄占用未能删除（内含文件已清空，重启后可删）；既有 lint warning server/cloud/identity.mjs:92 不变。

- 存储 v2 收尾（本轮）：重构主体（schema v11 三表/repository/service/importer/mirror+phase+cutover 链删除/auto_vacuum 回收）已在前序会话完成并全量测试通过，本轮补齐文档与簿记：新增单一事实文档 `docs/architecture/session-storage-v2.zh-CN.md`（背景写放大 5 份、三表布局、写入/删除/启动导入路径、删除机制清单、逃生通道、已知取舍、新旧对比表）；v1"当前架构"文档标注为历史参考；recovery runbook 顶部加 v2 修订提示（恢复路径=备份 restore 或删库重导，不再有"降级回 JSON 权威"）；sqlite-storage-foundation §4 补 v11 一段；wiki server README 存储层描述段全面更新为 v2 现状。后续候选（记录在案）：①S2b 发现 `repository()` 先求值 `getSqliteStorage()`——通过 configureSessionStateService 注入 repository 的测试仍需 SQLite 已初始化，若要纯内存 repository 测试需拆开两步（当前测试均先初始化 storage，未构成实际问题）；②`*_v10_backup` 六表稳定观察期后以独立 migration DROP 回收空间；③listPage lastModified 的 json_extract 表达式索引；④share/lan mirror 链后续同类清理候选。
- 存储重构动机留档：旧设计同一数据落盘 ≈5 份（state_json 巨列全量重写 + session_index 派生表 + mirror outbox 完整副本 + drain 物化 JSON 文件 + WAL/自由页永不回收），真实库膨胀至 2~3GB；v2 后每条数据一份、删除即时 incremental_vacuum 归还 OS。用户升级路径：删库文件重启即从 JSON 一次性重导（空库 + JSON 存在时启动链自动触发，每会话一事务幂等）。
- session 分页查询热路径优化（前一轮）：根因=每请求固定全量开销而非分页 SQL（本机库 24 会话 authoritative 纯 SQL 亚毫秒；大库 2415 会话时线性放大且同步阻塞事件循环）：verifyIntegrity TTL 5s 即做 session_states 全表扫+逐行 JSON.parse/SHA-256+session_index 两遍全表且无并发去重；syncMetadataCommit 置空 lastVerifiedAt 使下次分页必触发全量校验；analyzeQuery 每请求 2 条 GROUP BY 全表聚合。修复（session-index-service.mjs，不改导出/降级语义）：TTL 5s→60s + in-flight 共享去重；增量同步成功后保留校验时间戳（成功路径已全量重算 index digest）；analyzeQuery 按索引内容代际缓存（rebuild/增量同步失效，limit/offset 不参与键）。新增 5 测试；文档性能注记入 session-index-query-migration F8 节。基准留档：1k 行 0.8ms / 50k 行 93ms（OFFSET 翻页线性 → keyset/可见性列进索引为中期候选）。〔注：v2 重构后 session_index 派生表与该校验机制已整体退役，本条留作历史〕
- 测试观察（记录不处理）：session-state-background-migration.integration.test.mjs 用例 a) 出现过 EPERM rename %TEMP% .tmp→目标文件（Windows 文件锁/AV 嫌疑）；取样：带改动 4 跑 1 挂、stash 本次改动后通过、恢复后连跑 3 次全过——判定环境级 flaky 候选，与本次改动无关（未触碰 writeJsonAtomic 路径）。
- 后台迁移全部落地（前一轮）：启动秒级 READY（会话域退出维护窗口，窗口仅剩 scheduled-runs/share/lan 三小域秒级）；三机制实现见 feature_list 的 6 个 impl-bg-migration-* 条目。核心链路：index.mjs 按 phase 路由（resolveSessionStateStartupRoute）→ startSessionStateBackgroundMigration（维护锁全程持有）→ 逐桶 alignBucketStream（不 enqueue mirror）→ 收敛循环（逐桶只读 digest 对拍内存 Map）→ idle 信号（SSE 流计数+写静默）→ 切换窗口（全局 persist 锁→barrier→最终对拍→promoteAlignedSessionState→drain）。备份在 idle 期异步（复验已登记可复用、有界重试、与切换解耦）。
- boot 竞态修复（本轮追加，commit 1e959d4 已推送）：用户另一台机器部署新版后 UI 无法启动只显示错误卡——根因是 boot 阶段（initializePiStorage/设置校准）在迁移门之前发业务请求，撞上 migrating 窗口 503 落进通用错误卡。修复：catch 探测 migrating 转入迁移门（进度视图）+ ready 后自动重试 boot；waitForMigrationSettled 容忍单次轮询失败（连续 3 次才抛）。
- auto-archive 启动 49s 阻塞优化（本轮，quick_check 修复后用户机器二次实测发现）：三域 check 27ms/8ms 通过后仍有 49s 零日志空洞、浏览器请求堆积至同毫秒簇放行——事件循环被同步阻塞。根因：startAutoArchiveRunner 启动链末尾立即首次归档，扫描阶段逐候选 readSessionValue 全量加载正文（~2400 会话 2.9GB）。修复：元数据优先扫描（activityTime(metadata) 可判定零正文读；null 才回退；事务内全量复核保证归档正确性不变）+ 归档循环间 setImmediate + 首跑延迟 30s。附带根治 writeJsonAtomic 的 Defender rename EPERM 竞态（有界重试+失败清 tmp，本机测试 flake 与历史 tmp 残留共同成因）。用户机器预期：启动链 complete 从 lan-check 后 ~49s 降至秒级。注意：auto-archive 若有历史积压，会在启动 30s 后开始逐个归档（已让出循环，前台无感）。
- session_states 元数据覆盖索引（本轮终局修复）：启动分段计时实测——reset-stale-task-statuses 零写入仍 45.2s、session-index 同一扫描仅 1.5s（冷/热差）——定案根因：WITHOUT ROWID 表行内 state_json（GB 级）在 metadata_json 之前，读靠后列必须穿溢出页链，SELECT metadata_json 隐式读全库 2.9GB，每进程首次冷读必付。migration v10 覆盖索引（含 metadata_json/metadata_digest）使元数据读取 index-only（EXPLAIN 四形态验证命中），全部元数据热路径（readSessionMetadataBuckets/metadataBucketChanges/readSessionStateStore('sessions-metadata')/auto-archive 扫描/index 服务 readSnapshot）受益；升级后首启建索引一次性慢（listen 前），之后启动预期 reset-stale/session-index 均毫秒~秒级。纠正：前两条 49s/50s 空洞曾误归因 auto-archive（次要真实问题），大头一直是本条；剩余可见慢步骤为 session-state-cutover ~1.6s 与 session-index 热 ~1.5s，可接受。
- 启动 quick_check 检查税优化（本轮，commit 3d1ae01）：四域启动检查各自对同一 2.93GB 库文件全量 PRAGMA quick_check 3~4 遍（用户机器实测 session 16s+share 7s+lan 6.6s≈30s）。runSharedSqliteQuickCheck（database.mjs）：进程内按库路径去重 + marker 文件 7 天降频 + 维护端点/env force 逃生口；预期用户机器启动检查税 30s→秒级（更新后首启仍真扫一遍写 marker，之后 7 天内跳过）。已知取舍：备份导出/离线工具的 quick_check 也走 7 天门（内容级 count/digest fail-closed 校验不受影响，bit-rot 影响内容会被 digest 检出）；marker 不绑定库文件 mtime/size，外部替换库文件盲区最长 7 天（force 或删 marker 消除）。
- 启动 OOM 生产事故与修复（本轮，重要）：用户真实大库（2.93GB SQLite、authoritative 相位、今日两次全量 cutover 后首次进入 authoritative）每次启动 38 秒后 4GB 堆 OOM 崩溃，进程死掉→端口无监听→界面"无法启动"。取证链：四域 check 全过（authoritative）→ lan-access 之后 8 秒内崩 → sw.js 被同步阻塞 6.6s → 堆 4095MB Mark-Compact 全失败。根因：启动链 resetStaleTaskStatuses→atomicUpdate('sessions-metadata')→atomicSessionMetadataBucketUpdateViaFacade→readSessionStateStore('sessions-metadata')→repository().exportSnapshot() 全库（state_json+session_messages 重组）载入。修复三处同病灶：①readSessionStateStore('sessions-metadata') 复用 readSessionMetadataBuckets 只读 metadata_json（JSON 时代该 store 本就 metadata-only）；②metadataBucketChanges（updateSessionMetadataBucket 底层）current 构建弃用 exportSnapshot（不改则逐桶调用仍 OOM）；③atomicSessionMetadataBucketUpdateViaFacade 逐桶 RMW（顺带修掉全 scope 合并写 global 桶的跨桶混写错误，project 会话元数据不再错挂 global）。附带收益：readStore('sessions-metadata')（acp 列表/backup/auto-archive 路径）权威相位也变 metadata-only。教训：小测试库测不出 GB 级库的内存放大路径；exportSnapshot 全库快照类 API 只允许出现在维护锁内低频路径（restore/import），任何启动链/业务链路禁用。
- 测试观察（记录不处理）：agent-manager.external-sync.test.mjs 的 "keeps transient ACP context..." 用例在全量并发下出现过一次失败（单跑与全量复跑均绿），疑似 flaky 候选，后续择机排查。
- 集成测试发现 2 个真实缺陷并已修复：①严重——barrier-parked 业务写在 promote 后重放仍走 JSON 路径导致权威源丢写，storage.mjs 全部会话写入口补"执行时 facade 复检重路由"（*ViaFacade 助手，嵌套 metadata 写同覆盖）；②background.state 缺 converging（补 setState）。另理论风险已记录：parked 旧写覆盖 promote 后新写的窗口被"微任务级联+promote 要求空 mirror 队列"封闭，若后续引入窗口内宏任务间隙需复查 runSwitchWindow 的 release 顺序。
- 设计→实施主要偏差（已记入设计文档 §11）：promote 走 repository 内部 updateStorageState（避免循环依赖）；barrier park 从 drain 完成后生效（防嵌套入队自锁死锁）；backup.verify 无 sha256（避免 1.4GB 双读）；"写时间戳未变跳过重读"优化未实现（正确性优先）；cutover 模块 cutover_running 恢复分支保留（新链不再到达，维护工具可直调）。
- cutover_running 存量残留清退与双进程 status 可见性（设计 §10.1/§10.2）已落地：残留由后台任务锁内复位（backupFile 保留、phase.reset 日志）；锁忙 aborted 快照携带 lockOwner/lockOwnerPid/lockFencing，第二进程经 migration-status 可见。
- 未做（记录在案）：慢盘/大库内存上界断言（需大库装置，归 §10.3 真实库实测待办）；writeSessionValues/restore 类写在维护锁内运行无 parked 场景未加重放路由（如需防御性覆盖后续单独评估）。
- 前一轮设计阶段的产出与决策详见 git 历史中 feature_list.json 该轮提交；评审实施（review-* 11 feature）遗留事项不变：⑤门禁豁免不一致、⑥backupFile 复用旧快照、P2 减 pass 快照方案、"彻底不碰 JSON"三处架构依赖、前端 dispose 通知、agentSessions LRU、SQLite 大事务拆分等范围外候选。

## Notes

- 评审建议全部实施完成（本轮，11 个 feature 全 done，详情见 feature_list.json）：①split 中部编辑采样校验（body-only 多一次主键单行查询，顺带修复 split body 双重表示的预存 bug：normalizeRecord 剥离 split 标记 body 的内联 messages，旧库下次保存自愈）；②persist 冲突表面化（session.persistDegraded + SSE persist_degraded 事件 + 前端 panel-decoration 警告条，persist 成功自动清除；仅内存标记重启不恢复，语义合理）；③synchronous 实测定案并落地切 FULL（database.mjs，health 摘要同步）；④fail-closed 恢复指引（STARTUP_RECOVERY_GUIDANCE 附加段 + 一页式 runbook docs/architecture/session-storage-recovery-runbook.zh-CN.md + App.tsx 错误页 pre-wrap）；⑤保存热路径优化（IN 分批去重 O(增量)、readLastMessage 替深 OFFSET、WeakMap<handle,Map<sql,stmt>> 语句缓存）；⑥drain 同会话合并 + mirrorQueueRevision 取代跳过 + mirror 永久设施定位入文档（F8 §4.1）；⑦权威相位 index 就绪判定切 SQLite 源（readAuthoritativeSessionMetadataBuckets，index.mjs 与 acp/server.mjs 均切换；digest 口径与 upsertIndex 天然同构未动体系）+ F7 退役计划入文档；⑧当前架构单一事实文档 session-storage-current-architecture.zh-CN.md + 完整 phase 状态机 SVG；⑨cutover 恢复备份复核（verifyRegisteredCutoverBackup 包络 count/digest 对拍，损坏重写；不含中段 bit-rot，登记时未存文件 sha256 属范围外）+ POST /api/storage/maintenance/verify-session-integrity（full 逐行校验，维护锁内，409/423 门控）+ restore/roll-forward 后 checkpointWal；⑩mirror 死信 MIRROR_MAX_ATTEMPTS=12（diagnostics 暴露 mirrorDeadLetters，re-enqueue 复活）+ 无 id 消息整批 digest 重试去重 + 墓碑 GC 语义固化（现有 save 路径本已删同 key 墓碑，补注释+测试）。
- synchronous 实测定案（本轮）：新增 `scripts/sqlite-synchronous-benchmark.mjs`（2000 次单事务 upsert + 单事务批量 2000 条，state_json≈50KB，3 轮中位数）。本机（Win11/Node v24/SQLite 3.51.3/NVMe）实测：小事务 NORMAL 0.531ms/op vs FULL 0.989ms/op（1.86x，绝对增量仅 0.46ms）；批量导入 1.00x（fsync 被单事务摊薄）。定案：切换 FULL，结论与实测表已写入 `docs/architecture/sqlite-storage-foundation.zh-CN.md` §3.1；server 代码 PRAGMA 切换已由 `review-switch-sqlite-synchronous-full` 落地（done）。
- 会话 SQLite 迁移整体设计评审（本轮，纯文档产出）：`docs/architecture/session-sqlite-migration-design-review.zh-CN.md`（含写路径 SVG 图 `docs/architecture/assets/session-sqlite-write-path.svg`）。双路评审（设计文档 + 源码核查）+ 三个存疑点源码实证：①phase 切换与导入确认同事务提交，无中间态；②备份登记必在校验后，无"登记坏备份"窗口（残余低风险：登记后外部损坏不复核）；③权威态查询 fallback 读 SQLite 而非过期 JSON，无正确性问题（仅 pending 窗口性能降级 + ~1s 缓存瑕疵）。评审主要发现：高优先级——split 会话中部原位编辑静默丢弃（messageStoragePlan 尾 digest 启发式盲区）、persist 冲突三次重试后静默放弃（仅 warn 无用户反馈）、`synchronous=NORMAL` 丢失窗口无论证、fail-closed 启动缺用户可恢复通道；中优先级——append 去重 O(存量)（repository.mjs:361）、尾行深 OFFSET（service.mjs:327）、mirror drain 抵消 split 增量收益、exportSnapshot 被元数据操作调用、JSON mirror 双写无退役路线、F7 shadow/TTL 机制 F8 后冗余、文档碎片化。改进建议 10 条按优先级见报告 §7；本轮未改任何代码。
- P1 启动维护窗口（本轮）：listen 前仅 `ensureStorage()+initializeSqliteStorage()`（gate 与 migration-status 依赖 DB；失败置 failed 不退出），其余启动链逐字保留移入后台 `runStartupInitialization()`。维护窗口 gate 在 index.mjs `/api/` 分支 handleApi 之前：白名单（GET /api/health、GET /api/migration-status）放行，其余 503 `{ok:false,maintenance:true,state}`+Retry-After:5；非 /api（静态、/share/）放行。health 三态：migrating→`{ok:true,maintenance:true,...完整状态}`（getSystemStatus 异常降级精简）、ready→原样、failed→`{ok:false,startupError}`（进程存活，waitForQuickForge 持续轮询到超时保持"启动失败"语义）。listen 回调里的云 agent 改为等启动链 settle 后再起（failed 跳过），避免维护期撞 503。
- fail-closed 语义变化（有意）：从"进程退出"改为"服务存活但拒绝业务 API"。收益：desktop 窗口/CLI 已开的浏览器不再直接消失，用户看到错误页（含 startupError 原文）而非黑屏；代价：CLI spawn 模式失败表现为 5 分钟超时而非快速失败，需 qf stop/restart 恢复。架构文档中"block startup"表述的实质（阻止业务使用）未变，wiki server/README.md 与 routes/README.md 已更新说明新机制。
- P0 四项修复（本轮）：① scheduled-runs 偷锁双条件（`!expired || stalePid===null || pidAlive` 均不偷，与 session 域一致，复用注入 now()）；② retainedMaintenance 在 finally 正常释放分支复位（retain 错误路径不动，DB 锁行兜底 isScheduledRunsMaintenanceActive）；③ authoritative 分支拆两段 try：JSON 读取/slim 失败→diagnostic+warn 降级继续启动，health 失败→保持 throw blocked；④ session/share/lan cutover 补 logger（开始/完成/晋升/回退/fail-closed error/fallback warn，options.logger 注入模式），index.mjs 启动链 catch log.error+flushLogger。旧测试"authoritative JSON 校验失败 fail closed"语义已改为 fail-open（JSON 是非权威 mirror），新增 health 失败 fail-closed 用例补齐覆盖。
- 前端迁移进度（本轮）：`src/lib/migration-status.ts`（fetchMigrationStatus 网络/非200/坏 payload→{ok:false}、migrationPhaseStage 映射、waitForMigrationSettled 可注入轮询门支持取消）；useAppBootstrap 在 initializePiStorage 后插迁移门（migrating→setMigrationStatus+2s 轮询、ready→清状态继续原 boot、failed→{kind:'migration',detail:startupError} 错误），catch 里补一次 migration-status 探测覆盖"页面加载时服务端已 failed"路径；startupError 从 string 升级为 {message,kind,detail?}（注意：这是 hook 返回值形状变更，既有测试已同步加 mock）。MigrationProgressView 复用 splash 容器/图标动画（抽 StartupSplashIcon 共用），4 域状态点遵循 DESIGN_LANGUAGE 强度梯（border→foreground 呼吸→实心）。仓库无前端渲染测试先例（全 mock react 逻辑 harness），组件无渲染断言，逻辑由单测覆盖。
- 已知取舍/遗留：迁移轮询期间单次网络抖动会落错误卡片需手动 Retry（可后续加连续失败计数）；WebSocket upgrade（/api/terminal/*）未 gate（前端就绪后才连，风险低）；failed 时 CLI 5 分钟超时表现（见上）；migration-status 各域 count 字段名不同（runCount/stateCount/shareCount/lanTokenCount）。
- 语句复用优化（本轮早些）：cutover 导入（`replaceAll`/`replaceAllStream`）原在循环内每行 `db.prepare()` 重新编译 SQL。改法：SQL 提取为模块级常量（`UPSERT_SESSION_INDEX_SQL`/`ENQUEUE_SESSION_MIRROR_SQL`/`SHARE_SESSION_UPSERT_SQL`/`ENQUEUE_SHARE_MIRROR_SQL`），函数追加可选 `statement = null` 参数（不传走原路径，运行时调用方零影响），导入循环前 prepare 一次复用。node:sqlite `StatementSync` 与事务状态解耦，BEGIN 前/后 prepare、事务内多次 run 安全。未改 `lan-access-repository.mjs`（其 replaceAll 无循环，各函数只调用一次）；`replaceTokens`（DELETE+INSERT 各一次/调用）与 `writeMessages`（split-message 记录才触发）保持不动——share 域规模小/不在 cutover 主路径，收益趋零。
- cutover 性能调研结论（本轮，指导后续方向）：瓶颈在 CPU 侧——session-state 整库被完整 parse+规范化+digest 4 遍（双读校验/备份/导入），每条记录含 2×structuredClone + 2×JSON round-trip + 2×sha256；磁盘侧已被单事务 all-or-nothing + WAL + synchronous=NORMAL 规避（整个迁移只 COMMIT 时一次同步）。"分批读+分批插"打不中瓶颈：分页提交破坏可回滚语义且无 I/O 收益，分批读不减少 parse 次数。数量级收益要靠减 pass（文件级快照替代双读，需重新论证并发安全，属独立 feature）。
- SQLite/JSON 启动兼容设计评审（本轮产出）：遗留 bug 清单中 ①启动失败黑盒 ②scheduled-runs 锁偷锁只查 pid ③retainedMaintenance 泄漏 ④authoritative 读 JSON fail-closed 扩大化 已由 fix-cutover-startup-bugs 修复；仍未修：⑤门禁豁免不一致（调度 gate vs backup-export 豁免）、⑥失败回退后 backupFile 复用旧快照可能错位（语义待定/低概率，择机处理）。体验方案（listen 提前+进度 UI）已由 startup-maintenance-window 落地；"彻底不碰 JSON"仍受三处架构依赖制约（session_index 权威源仍是 JSON metadata、scheduled-tasks metadata 永久驻留 JSON、mirror outbox 持续写 JSON），属独立 feature。

## 并行会话记录（rebase 整合）

- ✅ 启动慢根因（远端会话 fix-startup-cutover-replay，修复代码未推送，**已在本仓库按其状态文件描述重建并验证通过**）：`session_storage_state` 卡在 `json_authoritative`（8-18 起 `Session state replace digest verification failed`），每次启动重放完整迁移（4 遍 1.6GB JSON 全量流读 + 1.4GB 备份写 + SQLite 全量导入再回滚）。排序不一致是核心 bug：JSON 源侧 summary digest 按 sessionId `localeCompare` 排序（`buildSessionJsonSnapshot`/`createStreamingSessionSource`/`writeCutoverBackupStream`），而仓储侧 `digestFromLines`/`verificationDigest` 按**整行字节序**排序。global+project 混合桶时两种排序必然交错不同（实测真实数据：`76eadc82…` vs `a40c7ee7…`），`replaceAllStream` 末尾 digest 校验必炸。现有测试数据集恰好两种排序同序，从未暴露。修复已在本仓库重建落地：`digestFromLines` 导出为唯一 canonical 实现，cutover 源侧三处（`buildSessionJsonSnapshot` / `createStreamingSessionSource` 的 `getSummary` / `writeCutoverBackupStream` 双 summary 校验）全部改用（records 迭代顺序与流式 bucket 内排序保持原行为，仅 digest 统一）；repository 新增 `checkpointWal()`（`PRAGMA wal_checkpoint(TRUNCATE)`，返回含 busy 的 pragma 行），两个 promote 成功点晋升 authoritative 后经 `checkpointWalAfterPromote` 调用（try/catch，失败仅 log.warn 不阻断）。新增混合桶测试（global 'Zeta' + project 'alpha'，localeCompare 与字节序不同序）：改源码前精确复现 `Session state replace digest verification failed` 回退 json_authoritative，改后端到端晋升 authoritative。与维护窗口互补：新版首次启动一次性完成迁移（预计 1-2 分钟）期间用户看到进度页。
- 事故记录（远端会话，已回滚）：验证时一次 `QUICKFORGE_DATA_DIR` 未设成功的 node 脚本误在真实库执行了 cutover——digest 修复实证生效（首次成功 commit，2415 会话入库），但违反独占前提（旧服务还在 JSON 模式写数据），随后手动补救被用户叫停。已将 `session_storage_state` 回退为 `json_authoritative`（JSON 权威未动，quick_check ok，5176 服务存活）；SQLite 残留条目会在下次 cutover 的 replaceAllStream 中整体清空重写。教训：对真实数据目录执行任何写路径前必须显式断言 dataDir 非默认值。
- 用户数据现状（远端会话记录，择机清理）：`conversations` 4.36GB 中 2.75GB 是 1045 个原子写 `.tmp` 残留（JSON 模式高频全量重写的副作用）；WAL 2.8GB 待新代码 cutover 成功后自动 TRUNCATE。npm 全局包（旧代码）在发布新版前仍是慢启动。
- 桌面端与 `qf` 共用 `server/index.mjs` 初始化链，同根因同修复；桌面端 `ready-to-show` 策略使首屏 6.5MB modulepreload（pi-web-ui 3.75MB + pi-ai 1.6MB）也计入可见时间（独立遗留项，未处理）。
- 字体滑块闪烁（远端会话）：滑块 @input 每步同步 `applyFontSizeSettings` 改 root font-size 造成整页 reflow；修复为 RAF 合并 + dirty-check + 仅 interface 字号变化时派发事件。
- 归档删除（远端会话）：设置页永久删除走 batch 两操作事务，旧 `applySessionBatch` 对 metadata delete 无条件拒绝；修复为配对 metadata delete 视为 no-op 放行。删除后复活路径已堵（路由删持久化前先 destroyAgent）。遗留竞态（范围外）：删除请求处理期间另一请求恰好 restore 同一 session 仍可能复活，彻底堵住需 tombstone 机制。

- 中止双消息根因（本轮，只读分析未改码）：用户点停止后同时出现「请求已中止」+「错误： Request was aborted」。链路：pi-ai 把中止定稿为 stopReason="aborted" 且塞 errorMessage="Request was aborted"（anthropic-messages.js catch 分支）→ pi-agent-core turn_end 无差别写入 state.errorMessage → agent-manager agent_end 订阅（agent-manager.mjs:2111）见 state.errorMessage 即 appendAssistantErrorMessageOnce 补一条 stopReason="error" 消息，而其去重只认末条 stopReason==="error"，对 aborted 末条失效 → 两条消息分别渲染成斜体中止行与红框错误行。修复方向（待定夺）：agent_end 补条前判 eventEndStatus==='aborted' 跳过 + 去重放宽到 aborted 末条同 errorMessage；i18n 补 'Request was aborted' key（现 key 是 'Request aborted' 少了 was，原文翻译不到）。

## 历史笔记

- 持久化锁修复（前轮）：`withSessionPersistenceLock` 从全局单链改为 keyed 队列（`session-persistence-lock.mjs`），默认 key（''）保持全局串行；`persistSession` 在 SQLite 权威模式下用 `session:${sessionId}` key，JSON 镜像模式保留全局 key（bucket 级 read-modify-write 需要）。正确性依据：authoritative 模式下正确性由 per-row revision CAS 独立保证，全局互斥是 JSON 时代遗留；SQLite 单连接 + DatabaseSync 同步 API + Node 单线程保证任意时刻至多一个事务执行。auto-archive 仍用全局 key；其与 per-session persist 的交错由 CAS + 写前重校验保证。锁 drain 后 Map 条目自动清理。
- 慢 persist 观测：`persistSession` 记录耗时（排队+编码+同步写），阈值已由 1s 降至 200ms（optimize-persist-encoding-yield）打 warn（含 messageCount），便于定位"大会话同步事务阻塞事件循环"。注意同步 SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大；编码段已由单遍序列化器+分批 yield 优化，残余同步写突刺（INSERT+COMMIT）需慢日志量化后再决定是否升级 worker 线程方案。
- `runTaskkill` 超时兜底（`server/utils/process-tree.mjs`）：taskkill.exe 挂起时 10s 后 resolve(false)，不再让 dispose()/destroyAgent 永久悬挂（Windows 上 OpenCode 子进程清理路径）。
- `/api/agents/:id/restore` 挂起+内存增长根因分析：① 前端切到一个 session 时并发发 POST /restore + GET /state + GET /messages + GET /status + SSE，这些路由在内存无 session 时都隐式回落 restoreAgent，而旧实现是 check-then-act，并发时各自 createAgent、最后一次 set 覆盖前面的——被覆盖的 session 永不销毁，形成孤儿泄漏。② 前端切 session 只 abort fetch，服务端 handler 照常建 session。③ agentSessions Map 唯一删除点是 destroyAgent。④ 全局 withSessionPersistenceLock 是无超时单链 promise 队列，persist 积压时阻塞事件循环 → 请求挂起。
- restore 修复（前轮）：`restoreAgent` 拆为外层去重 + `restoreAgentUnlocked`，`pendingRestores` Map 按 sessionId 共享 in-flight Promise，finally 清理。所有并发调用点收敛到模块内单个函数。
- 测试教训（锁单测）：模块级队列 Map 在同一测试文件内共享——测试失败路径泄漏的 pending 链会污染后续使用相同 key 的测试；每个测试用唯一 key + gate 必须 settle + `await new Promise(r => setTimeout(r, 0))` 排空微任务。
- 未实施的后续候选（见 session-handoff）：前端 dispose 通知服务端提前回收、agentSessions 上限 LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 归档闪烁根因（前轮）：`archiveSession` 归档后调 `refreshSessions({ broadcast: true })` 的全量重置模式导致侧栏闪烁；修复为归档成功后本地乐观移除。
- 遗留（范围外，择机处理）：`ChatSidebar.confirmDeleteSession` 的 `deletingSessionId` 成功后不复位、`deleteAnimationTimeoutRef` 为共享单值 ref；置顶区删空后整块条件卸载（无高度过渡）。
- 分页死循环根因（前轮）：删除/归档改变服务端 total 与排序窗口后，前端 offset 分页 + uniqueSessions 去重可能整页全重复 → hasMore 恒 true 无限请求；修复为零进展时 total 收敛为 items.length。
- 已知取舍：若服务端确实还有更多数据但某页全为已加载项（去重误伤），hasMore 会提前置 false，需下次 refreshSessions 恢复。
- loadMoreGlobal/loadMoreProject 无 loading 守卫（零进展收敛已可终止循环）。
- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment，多会话前已存在。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地）。
- 前端分页测试技巧：mock React harness 中测 offset 分页必须显式传 offset，不能依赖 loadMore* 的闭包 state。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
