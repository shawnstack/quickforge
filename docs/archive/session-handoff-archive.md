# Session Handoff Archive

更早的会话交接记录已从 session-handoff.md 移入本文件（2026-09-04 归档，仅保留最近 30 个 feature 对应的交接内容）。按归档时顺序排列（新→旧），追加归档时新内容插入本标题之后。2026-09-15 起按用户要求全部归档，主文件保持全新空状态。

## 当前交接：process 折叠子级层级关系（缩进 + 左侧连接线）（2026-09-22）

- 当前目标（已完成，待真机验收）：聊天「已执行 N 个工具调用」折叠结构的子级层级可视化——组头 / stage 头 / 思考头 / 工具行原先全部左对齐 x=0。同日按用户反馈调整：首版共享规则两级 body 都挂缩进+连接线，用户反馈「顶层组头到 stage 这一层不要缩进和细线」；最终态仅 `.quickforge-process-stage-body` 独立规则带「0.75rem 左缩进 + 1px 弱化左侧连接线（color-mix(in oklab, var(--border) 60%, transparent)，与主结构分割线同配方）」，`.quickforge-process-body` 恢复原规则（不缩进、无连接线），组头与 stage 头对齐；纯思考段直挂顶层 body 的 step 因此不再缩进（预期）。收起态 body `visibility: hidden`，连接线随内容隐藏。不改 DOM 结构、不改 process-folding.ts。
- 改动文件：`src/index.css`（共享规则恢复原样 + 新增 stage-body 独立缩进/连接线规则与注释）、`tests/frontend/chat-surface-css-contract.test.ts`（`process fold hierarchy contract` describe：钉住 stage-body 规则 padding-left/border-left；负向断言共享规则与 `.quickforge-process-body` 规则不得含 padding-left/border-left、叶子节点不得带 border-left）、`DESIGN_LANGUAGE.md`（「例外：对话折叠的阶段内子级用缩进 + 细连接线」小节，仅阶段展开区挂线、顶层组不缩进）、`feature_list.json`（新增 process-fold-hierarchy，done；同日调整未回写条目描述——无 note 字段格式）、`progress.md`、`session-handoff.md`。
- 验证（定向，CSS 小改动未跑全量）：首版 `npx vitest run`（process-folding + process-folding-incremental + chat-surface-css-contract + thinking-header-adoption）→ **4 files / 87 passed（exit 0）**；调整后 `npx vitest run tests/frontend/chat-surface-css-contract.test.ts tests/frontend/process-folding.test.ts` → **2 files / 76 passed（exit 0）**；两次 `npx eslint tests/frontend/chat-surface-css-contract.test.ts` → **exit 0**。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：展开过程组后组头与 stage 头对齐（无缩进、无连接线），stage 展开后思考头/工具行相对 stage 头缩进一层并带细竖线，浅/深主题下竖线均柔和；纯思考回合直挂 step 与组头同层（不缩进，预期）；② 真机验收清单沿用上条（reasoning 默认 high / 设置下拉收窄 / 折叠默认值与工具详情默认收起）。

---
## 历史交接：reasoning 模型默认思考等级 medium → high（2026-09-22）

- 当前目标（已完成）：reasoning 模型的默认思考等级从 medium 改为 high。改动三处硬编码 fallback + 一处 wiki：`src/lib/pi-chat.ts` `defaultThinkingLevelForModel`（前端唯一 fallback，消费方自动跟随）、`server/acp/server.mjs` `resolveInitialThinkingLevel`（ACP 镜像，含注释）、`server/routes/scheduled-tasks.mjs` 创建定时任务缺省 fallback；`docs/wiki/server/README.md` 同步。用户显式保存的默认思考等级优先级不变，非 reasoning 模型仍 'off'。
- 改动文件：`src/lib/pi-chat.ts`、`server/acp/server.mjs`、`server/routes/scheduled-tasks.mjs`、`docs/wiki/server/README.md`、`feature_list.json`（新增 default-thinking-level-high，done）、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run`（default-options-settings-tab + default-options-settings-react）→ **2 files / 20 passed（exit 0）**；`npx vitest run tests/server/acp/ tests/server/scheduled-tasks.execution.test.mjs` → **6 files / 60 passed（exit 0）**；`npm run lint` → **exit 0**；`npx tsc -b --pretty false` → **exit 0**。
- Blocker：无。
- 下一步：① 真机冒烟：新会话选 reasoning 模型（未保存过默认思考等级时）初始等级为「高」，非 reasoning 模型为「关」；保存过 default-options.thinkingLevel 的用户不受影响；② settings-row-control-compact 的真机验收与「MCP 服务→MCP」措辞确认沿用下条。

---
## 历史交接：设置页「常规」语言/思考等级下拉框收窄 settings-row-control-compact（2026-09-22）

- 当前目标（已完成，待真机验收）：设置页「常规」tab「语言」「默认模型思考等级」两个下拉容器统一收窄为固定 8.5rem——`src/index.css` 新增 `.quickforge-settings-row-control-compact { width: 8.5rem; min-width: 8.5rem; }`（仿 `.quickforge-share-expiration-select` 先例），移动端 row-control 撑满选择器组显式列入 compact（100% 满宽、min-width:0，窄屏不溢出）；语言行弃用误用的 wide，「默认模型」行保持 wide 不动；共享 wide 类本身未改。
- 改动文件：`src/index.css`（+compact 类与移动端选择器）、`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`（两处容器类名）、`feature_list.json`（新增 settings-row-control-compact，done）、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run`（default-options-settings-react + default-options-settings-tab + quickforge-settings-select）→ **3 files / 26 passed（exit 0）**；`npx eslint src/components/settings/tabs/DefaultOptionsSettingsTab.tsx` → **exit 0**。未跑全量 test/lint/build（UI 微调定向验证）。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收设置「常规」tab：语言/思考等级下拉宽 8.5rem（不再 432px 撑开）、窄屏移动端满宽不溢出、「默认模型」下拉保持 wide；② 确认工作区混入的「MCP 服务→MCP」措辞改动（`src/lib/i18n.ts` 22 行 + 根 `README.md` 2 行）去留（沿用上条交接）；③ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：需求修正——工具卡详情固定收起（无配置）+ 阶段层默认展开可配置 expandProcessStageByDefault（2026-09-22）

- 当前目标（已完成，待真机验收）：`tool-call-rows-expand-details-collapse` 需求理解修正后定稿（上一版 `expandToolDetailsByDefault`「工具详情默认展开」语义被用户推翻）。① 工具卡参数/输出详情（`ToolDetails`，5 渲染器 + `DefaultToolCardBody` 默认卡）**固定默认收起**（`initiallyOpen={false}`），无任何设置项；手动开合记忆（`toolDetailsOpenMemory`）优先；「简洁/详细」（toolDisplayMode）只控内容渲染；② 可配置项为 `tool-display-settings.expandProcessStageByDefault: boolean`（默认 `true`），控制「已执行 N 个工具调用」阶段层（stage）默认收起/展开（`processStageDefaultExpanded()` 读 `getCachedToolDisplaySettings()`），手动开合记忆优先，顶层过程组默认（流式展开/历史收起）不变；③ 设置页「常规 → Tool 显示模式」开关为「工具调用列表默认展开」（默认开），i18n key `expandProcessStageByDefault(+Description)`（en+zh）；④ 旧字段 `expandToolDetailsByDefault` 与 helper `toolDetailsDefaultExpanded()` 已删除，normalize 白名单重建时与 legacy `showToolDetails`/`expandToolsByDefault` 一并剥离。
- 改动文件：`src/lib/tool-display-settings.ts`、`src/lib/tool-renderers/shared.tsx`、5 个 tool-renderer（ask-user / goal-report / local-workspace / mcp / todo-write）、`src/components/chat/surface/ToolMessage.tsx`、`src/components/chat/panel-decoration/process-folding.ts`、`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`、`src/lib/i18n.ts`、`src/index.css`、测试 7 个（chat-surface-tool-message / process-folding / settings-normalizers / goal-report-renderer / tool-renderer-shared-state / chat-surface-css-contract / default-options-settings-react）、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`（双副本同步）、`docs/wiki/src/README.md`（旧语义 0 残留）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：全量 `npm run test` → **376 files / 4492 passed / 1 skipped（exit 0；历史 4 个既有服务端失败连续两轮未复现）**；`npm run lint` → **无告警（exit 0）**；`npm run build` → **成功（exit 0）**；前端回归 **2605 用例通过**。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：设置开关「工具调用列表默认展开」开合生效（默认开 = 阶段层默认展开）与阶段层默认形态（工具卡 params/output 详情始终默认收起、手动开合记忆优先于默认值与设置）；② 确认工作区混入的「MCP 服务→MCP」措辞改动（`src/lib/i18n.ts` 22 行 + 根 `README.md` 2 行，与本 feature 无关）去留；③ 此前登记的 4 个既有服务端测试失败连续两轮未复现，待确认是否已修复或环境相关；④ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：对话工具调用默认展开到工具行层 + 工具卡细节默认收起且可配置（2026-09-22，需求理解已修正，最终语义见当前交接）

- 当前目标（已完成，待真机验收）：对话工具调用默认展开到工具行层、工具卡 params/output 细节默认收起且可配置。① process-folding 内层 stage 默认展开（`processStageDefaultExpanded()` 返回 true，用户手动开合记忆优先），展开过程组后每条工具调用直接可见，顶层组默认不变（流式展开/历史收起）；② 工具卡 params/output 细节区（`ToolDetails`，含 5 个渲染器与 DefaultToolCardBody 默认卡）默认收起，由新设置 `tool-display-settings.expandToolDetailsByDefault`（默认 false）控制初始开合，手动开合记忆优先；③ 简洁/详细（toolDisplayMode）只控内容渲染不再控初始开合；④ 设置页「常规 → Tool 显示模式」新增「工具详情默认展开」开关（i18n en+zh 新增 key）。
- 改动文件：`src/lib/tool-display-settings.ts`、`src/lib/tool-renderers/shared.tsx`、5 个 tool-renderer（ask-user / goal-report / local-workspace / mcp / todo-write）、`src/components/chat/surface/ToolMessage.tsx`、`src/components/chat/panel-decoration/process-folding.ts`、`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`、`src/lib/i18n.ts`（仅新增 key）、`src/index.css`、测试 7 个（chat-surface-tool-message / process-folding / settings-normalizers / goal-report-renderer / tool-renderer-shared-state / chat-surface-css-contract / default-options-settings-react）、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：全量 `npm run test` → **376 files / 4492 passed / 1 skipped（exit 0；此前登记的 4 个既有服务端失败本次未复现）**；`npm run lint` → **无告警（exit 0）**；`npm run build` → **成功（exit 0）**。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：展开过程组后每条工具调用直接可见（stage 默认展开）、工具卡 params/output 细节默认收起、设置开关「工具详情默认展开」开合生效（手动开合记忆优先于默认值与设置）；② 确认工作区混入的「MCP 服务→MCP」措辞改动（`src/lib/i18n.ts` 22 行 + 根 `README.md` 2 行，与本 feature 无关）去留；③ 此前登记的 4 个既有服务端测试失败本次未复现，待确认是否已修复或环境相关；④ 之前各轮真机验收项见 progress.md 各条 Notes。

---
## 历史交接：过程折叠第二轮——纯思考段不渲染空 stage 头（2026-09-22）

- 当前目标（已完成，待真机验收）：第一轮两层折叠（顶层组「已执行 · 耗时」→ 内层 stage「已执行 N 个工具调用 · M 条命令 ·（K 项失败）」→ 工具行直挂 step）之后，纯思考段会出现空壳「已执行」stage 头。本轮新增导出 `processSectionNeedsStage(items)`（段内含任何 tool-message 才需要 stage，含 run_subagent/generate_image 不可分组工具行），`populateProcessGroup` 中 detail 段或不需要 stage 的段走 `populateProcessContainer` 直挂顶层组 body——纯思考回合展开顶层组直接见思考块，无空「已执行」行；工具行到来后结构变化触发全量重建恢复包 stage（thinking+tool 同一 step）。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`（processSectionNeedsStage + populateProcessGroup 应用 + appendProcessToolSuffix 注释同步）、`tests/frontend/process-folding.test.ts`（纯函数 3 例）、`tests/frontend/process-folding-incremental.test.ts`（DOM 级 thinking-only 无 stage 头 / 工具到来重建出 stage）、`docs/wiki/src/components/README.md`（两份副本：stage 条目补纯思考段规则 + 所有权租约条目 appendProcessToolSuffix 描述同步）、`docs/wiki/src/lib/README.md`（tool-display-settings 条目补纯思考段）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run`（process-folding + incremental）→ **2 files / 47 passed（exit 0）**；前端全量 `tests/frontend/` → **203 files / 2590 passed（exit 0）**；全量 `npm run test` → **4470 passed + 4 failed**（4 处失败 = 既有服务端 ACP channel/workspace-mapping/sqlite quick_check，重跑清单与第一轮一致；另一次全量出现的第 5 个失败未复现，系并行偶发 flaky）；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：纯思考回合展开顶层组直接见思考块（无空「已执行」行）；带工具回合展开见 stage 头（收起）→ 点开直见工具行；含失败工具 stage 头带「· N 项失败」；「简洁/详细」只影响单行摘要；② 用户提到「有一些小优化」，本轮只处理了纯思考段一项，待确认是否还有其他优化点；③ 主分支既有服务端测试失败 4 例（ACP channel/workspace-mapping/sqlite quick_check gate）待另开 feature 修复。

---
## 历史交接：过程折叠移除「调用了 N 项工具」最内层（2026-09-22）

- 当前目标（已完成，待真机验收）：用户要求保留「已执行 N 个工具调用 · M 条命令」阶段层、移除其下还要再点一次的「调用了 N 项工具」工具摘要组；用户裁决普通回合（无中间 Markdown）也统一包 stage 头（方案 B），失败计数「N 项失败」挪到 stage 头。现结构为两层折叠：顶层组「已执行 · 耗时」→ 内层 stage「已执行 N 个工具调用 · M 条命令 ·（K 项失败）」→ 点开直接见工具行（工具行挂 stage-body inner 的 step）。
- 改动文件：`src/components/chat/panel-decoration/process-folding.ts`（splitProcessStageSections 全过程段包 stage / populateProcessContainer 直挂 step / stage 标题加 errorCount / appendProcessToolSuffix 校验链改 step / 删 tools 组全部代码）、`src/lib/i18n.ts`（删 5 key 双语 + toolDisplayModeDescription 微调）、`src/index.css`（清理 .quickforge-process-tools-*）、`tests/frontend/process-folding.test.ts`、`tests/frontend/process-folding-incremental.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`tests/frontend/chat-surface-api-key-dialog.test.ts`、`docs/wiki/src/components/README.md`（两份副本）、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 8 files / 212 passed（process-folding 相关全部，exit 0）；全量 `npm run test` → **4467 passed + 4 failed**（失败为服务端 ACP/sqlite **主分支既有失败**，git stash 验证与本轮无关）；`npm run lint` → **0 errors（exit 0）**；`npm run build` → **exit 0**。
- Blocker：无。
- 下一步：① 真机 `npm run dev` 验收：普通回合展开顶层组后见 stage 头（收起）→ 点开直接见工具行；含失败工具时 stage 头带「· N 项失败」；「简洁/详细」设置只影响单行摘要详细程度不再影响折叠；② 主分支既有服务端测试失败 4 例（ACP channel/workspace-mapping/sqlite quick_check gate）待另开 feature 修复。

---
## 历史交接：run_subagent 部分成果回传（2026-09-22）

- 当前目标（已完成，待真机验收）：subagent 中止/失败时把已产生的 AI 回复正文与工具调用清单回传主 agent（部分成果回传）。`server/agent-subagent-runner.mjs` 四路径统一追加「Work done 报告」：成功 = 最终回复 + 报告（跳过重复正文）；运行期失败 = 上游原文首行 + 报告（含 still running 行）；超时/父运行中止 = 既有首句（逐字保留）+ 报告。全量不限条数/行数（用户明确），唯一截断为工具参数单行摘要 200 字符。前端零改动（trace 去重/翻译契约自洽）。
- 改动文件：`server/agent-subagent-runner.mjs`、`tests/server/agent-manager.subagents.test.mjs`（+2 用例、2 处断言扩展）、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run`（agent-manager.subagents + subagents）→ **2 files / 21 passed（exit 0）**；前端回归 4 files / **126 passed（exit 0）**；`npx eslint` 两改动文件 + `npx tsc -b` → **exit 0**。未跑全量 test/build（定向验证）。
- Blocker：无。
- 下一步：① 真机验收：派 explore subagent 跑一半让它失败/超时，确认主 agent 收到的工具结果含「Work done by subagent …」报告（工具清单 + 全量输出）并能据此续接；成功场景确认结果 = 最终回复 + 报告；② 后续 feature（方案已过稿）：subagent 瞬时网络错误自动重跑 + 主 agent 网络错误自动 continue 续跑 + UI 自动重试提示。

---

## 历史交接：修复排队消息切换 session 后不发送（2026-09-22）

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
- 下一步：git commit `chore(release): v2.2.0` + tag `v2.2.0` + push 已完成（用户确认）；npm publish 按用户指令另行执行（默认不直接发布）。

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

---

## 当前交接：status-files-archive-2026-09-15（归档操作，无生产代码改动）

- 目标：按既有归档惯例（docs/archive/ 三文件）把主状态文件清理到「保留最近 30 个 feature + 全部未完成项」：feature_list.json 121→36 条（85 条 done 移入 docs/archive/feature-list-archive.json 前部，含用户点名的 remove-opencode-harness）；progress.md 历史段移入 docs/archive/progress-archive.md（保留 ## Notes 与全部未完成项段）；session-handoff.md 保留最近 30 个 feature + 未完成项交接段（6 个 done 段移入 docs/archive/session-handoff-archive.md）。
- 改动文件（6 个）：feature_list.json、progress.md、session-handoff.md、docs/archive/feature-list-archive.json、docs/archive/progress-archive.md、docs/archive/session-handoff-archive.md。纯记录搬移，未动任何生产代码/测试/wiki。
- Blocker：无。
- Notes：条目内容原样搬移未改写；共享工作树存在并行会话未提交 WIP（goal i18n / subagent failure trace），归档基于当时文件内容原子读改写；执行时并行会话已在顶部新增 dead-code-cleanup-and-server-blindspot-tests（done），按「前 30 + 全部未完成项」以当时文件计算，goal-ui-p0-budget-120 随之移出保留集归档；主文件剩余 needs-review 10 个 + in_progress 1 个不变。
- 下一步：无待办；下个 feature 会话按 feature_list.json 顶部选择。

---

## 当前交接：dead-code-cleanup-and-server-blindspot-tests（done，清理与测试补齐及全量验证完成）

- 目标：依据健康度分析报告（docs/reviews/project-improvement-analysis.zh-CN.md）清理死代码与垃圾文件、为 server 盲区模块补单元测试。
- 改动（源码 6 + 测试改 2 / 新增 8 + 状态 3）：goal-card.ts（删 accepting 字段/硬编码构造/不可达 accept 按钮分支，resume 条件简化，STATUS_ICON 副本换 icons.ts 的 goalStatusIcon，localizedGoalBlockerHint 去 export）、goal-control-strip.ts（STATUS_ICON 副本删除改共享 import）、icons.ts（新增 goalStatusIcon，type-only import GoalCardTone）、GoalInspectorContent.tsx（footer 删 accepting 按钮与 variant 三元）、i18n.ts（删 10 个死 key en/zh 成对）、server/cloud/identity.mjs（去无用赋值）；goal-card.test.ts / goal-card-controller.test.ts 同步（not.toContain 固化无验收按钮契约）；新增 tests/server/plugins/{manifest,loader}.test.mjs、channels/channel-logs、cloud/index、routes/{instructions,mcp,static,terminal}.test.mjs 共 8 文件 78 用例；另删除根目录两个 0 字节垃圾文件。
- 验证：npm run test 全量 333 files / 3746 passed + 1 skipped（零回归）；npm run lint 0 error 0 warning（项目历史首次全绿）；npm run build 成功（仅既有 KaTeX/chunk warning）；node 断言死 key 零残留；核心 diff 父 Agent 亲读复审。
- Blocker：无。
- Notes：服务端 accept API 按 wiki 契约保留；goalCanAccept（生产零导入）、confirmable 恒 false 通道、STATUS_KEY/toneForStatus 双副本、goal-plan-confirmation 空壳模块均未动（独立决策点）；agent-subagent-runner 执行级测试与 subagent trace 修复方案 A 仍是待办（后者待用户采纳）；static.mjs 403 防线跨平台不对称已记录未修。工作树中另有前序 feature（goal-mode-i18n-chinese 等 23 M）未提交改动，与本 feature 无冲突。
- 下一步：可选浏览器验收（goal 卡片无 accept 按钮，预期无视觉变化——按钮本就不可达）；用户可选择实施 subagent trace 方案 A 或批量浏览器验收积压；全部改动未提交，待用户决定 commit 时机。

---

## 上一轮交接：goal-mode-i18n-chinese（done，实现与全量自动验证完成；浏览器中文界面视觉未实测）

- 目标：goal 模式中残留的未国际化文案调整为支持中文（中文界面不再显示英文透传文案）。
- 改动（源码 10 + 测试 9 + wiki 3 + 三状态文件）：`src/lib/i18n.ts`（40 个新 key en/zh 成对：goalBlocker* 14 / goalError* 11 / goalReportError* 15）、`src/components/chat/panel-decoration/goal-card.ts`（BLOCKER_KEY 扩至 13+1 码 + GOAL_BUDGET_HINT_TEXT 镜像 + localizedGoalBlockerHint，buildGoalCardViewModel 统一本地化 blocker/blockerHint，三消费面 TSX 零改动）、`src/lib/server-agent.ts`（updateGoal 解析错误 body code 挂 Error.code）、`src/lib/goal-ui.ts`（goalActionErrorMessage 按 11 静态码映射）、`src/lib/goal-report-history.ts`（按 details.type='goal_report_error' 的 code 映射 15 key，无码透传原文）、`server/agent-goal-runner.mjs`（goalReportError 15 处附码 + execute 返回式错误结果；startGoalPlanning 错误附 errorCode）、`server/agent-manager.mjs`（afterToolCall 对 goal_report 返回式错误提升 isError）、`server/agent-prompt-commands.mjs` + 新增 `server/goal-command-messages.mjs`（textResponse 按 settings.language='zh' 出中文，fail-open 英文）、`server/routes/agent.mjs`（400/404 补 errorCode）；测试 8 改 1 新增；wiki 三处新增契约小节 + server README 目录树两行。
- 验证：合并定向 vitest 15 文件 525/525；node i18n en/zh 成对断言（各 1820 key，40 新 key 齐备）；tsc -b 0 error；npm run lint 0 error（仅既有 warning）；npm run test 全量 325 files / 3669 tests；npm run build 成功（仅既有 warning）。
- Blocker：无。
- Notes：未知码/无码一律回退原文（零回归）；模型自由文本 blocker 与 GOAL_ACCEPT_BLOCKED 不映射（有意边界）；历史持久化英文保留当时事实；blockerHint 靠常量镜像全等匹配。共享工作树有并行会话（subagent-failure-trace 系列，untracked 报告与测试 + 三状态文件顶部条目），无文件冲突。未新增依赖、无 Git 提交。
- 下一步：浏览器切中文验收五类文案（blockerHint/blocker 码/动作错误行/goal_report 错误卡//goal 命令错误）；验收后可考虑 commit。

---

## 上一轮交接：subagent-failed-run-trace-refresh-loss-review（needs-review，纯调研+方案对比交付完成；待用户采纳）

- 目标：排查「subagent 失败后刷新只见最终报错、工具调用过程不可见，部分场景正常部分丢失」的存在场景与根因，产出调研报告，不修改生产代码。
- 交付（1+3 文件）：`docs/reviews/subagent-failed-run-trace-refresh-loss.zh-CN.md`（双数据链路、9 类失败终态枚举、15 行可见/丢失场景矩阵、根因 P1/P2/P3 主线+辅线、二分定位验证步骤、修复方案 A/B/C/D 对比）+ 三状态文件。
- 根因速览：主线 P1=置顶摘要「已结束」行轻量载荷（subagent-run-detail.ts:644/:744-748）+ WorkspaceInspector.tsx:1042 store 未命中直落 fallback（store 纯内存刷新即空）；P2=timing-only 终态 details 阻止 SSE 回填（:798-804 判任意 metadata）；P3=残缺终态 store 遮蔽完整历史（:489-507 终态不覆盖）；辅线=≤1.10.1 旧会话空 details、运行中进程重启、400ms debounce 窗口崩溃、prompt 前失败/审批拒绝。聊天卡入口从持久化 details 现场重建永远完整——入口差异即「有些正常有些丢失」。
- 关联：与并行会话 docs/reviews/subagent-failure-trace-recovery.zh-CN.md（feature subagent-failure-trace-recovery，含 7 个测试实证）交叉验证一致、互补（本报告补版本考古/进程生命周期/入口判定/方案对比）。
- 验证：父 Agent 亲读核实报告全部 文件:行号 引用（含 P2/P3 关键源码独立确认）；grep 五要素结构断言；node JSON.parse；git status 归属（src/server/tests/docs/wiki 零本轮改动）。docs-only 未跑 test/lint/build。
- Blocker：无。
- Notes：全部修复方案未实施；建议用户采纳方案 A（打开/回填完整度统一规则，与并行报告 6.1 对齐），实施前按报告第六节+并行报告第 5 节取证确认现场触发链；场景 6 store 未命中属时序/容量边界未动态复现。
- 下一步：用户评审两份报告并选择方案后另开生产 feature；实施时同步 wiki（store 权威、轻量载荷、点击恢复契约）。

---

## 上一轮交接：subagent-failure-trace-recovery（done，诊断报告与场景测试交付完成；未实施生产修复）

- 目标：诊断 subagent 失败后过程记录消失，区分终态回填、store 来源选择、轻量载荷降级与权威持久化，不修改生产代码。
- 改动（2+3 文件）：`docs/reviews/subagent-failure-trace-recovery.zh-CN.md`、`tests/frontend/subagent-failure-trace-recovery.test.ts` + 三状态文件；报告含场景矩阵、证据等级、调用链与取证/修复建议，诊断测试含 3 个已完成工具调用及 3 个结果（6 条 trace）。
- 结论：非空 details 缺 messages 阻止回填；空 details 有 previous 时恢复、无 previous 时不可恢复；残缺终态 store 遮蔽完整历史；轻量 payload + store miss 独立降级，完整历史 + store miss 则保留过程。成功/普通错误/超时/取消链路为源码推导，不能据此认定现场触发来源。
- 验证：父任务运行 `npx --no-install vitest run tests/frontend/subagent-failure-trace-recovery.test.ts`，1 文件、7/7 通过；三状态同步后以 node JSON.parse、顶部 feature/status/章节断言和 `git diff --check -- feature_list.json progress.md session-handoff.md` 校验 JSON/格式。未运行全量 test/lint/build 或真实模型/浏览器/持久化端到端。
- Blocker：诊断交付无阻断；确认现场根因仍缺真实故障样本、原始 SSE 与权威持久化读回。
- Notes：done 不表示生产修复；现状诊断断言在后续修复时应改为恢复契约。未改生产代码、依赖或生成产物，无 Git commit/tag/push/发布，交付物未提交。未变更架构/职责/公共入口/发布流程，本轮无需更新 wiki。
- 下一步：授权后取得同一 toolCallId 的脱敏 SSE/持久化/刷新前后载荷，按证据选择字段级回填、完整度优先打开或轻量 miss 恢复方案，再另开生产修复 feature。

---

## 上一轮交接：goal-inspector-hint-popover-width（done，修复与定向验证完成；浏览器未实测）

- 目标：修复右侧 Goal Tab 状态行「已完成」旁 ？ 提示浮层文字竖排（一字一行）。
- 改动（2+3 文件）：`goal-inspector.css`——position:relative 由 18px ？ 锚点（规则已删）移到状态行，pop-body 宽度 `min(290px,100%)` → `max-content + max-width:min(290px, calc(100vw - 48px))`（根因：100% 按 18px 包含块解析导致逐字换行竖排）；`GoalInspectorContent.tsx`——状态行 GoalHintPopover 移到 time 之后（续修：用户反馈浮层未紧贴 icon；？ 落行末后浮层右缘与 icon 右缘任意面板宽度精确对齐、不裁剪）。
- 验证：定向 vitest goal-inspector-lifecycle + goal-budget-inspector 13/13（两轮复跑）；tsc -b 0 error；git diff --check 通过；两轮 diff 亲读复审。
- Blocker：无。
- Notes：基于并行会话 release-v2.1.0 提交（22fe294）之后基线，当前未提交改动仅本修复 CSS + 三状态文件。浏览器视觉为人工验收项。
- 下一步：浏览器点 ？ 验收横排显示；可随下次发布提交。

---

## 上一轮交接：release-v2.1.0（done，Git 发布完成；npm publish 待用户手动执行）

- 目标：按用户指令「发布一个版本 2.1.0」完成 minor 发布（v2.0.0..HEAD 17 个提交的 dev 全量，不含 Android），遵循 docs/architecture/patch-release-runbook.zh-CN.md 手动流程（minor 版本号由用户显式指定）。
- 改动（4+3 文件）：`package.json`/`package-lock.json`（2.0.0→2.1.0）、`CHANGELOG.md`（[2.1.0] - 2026-09-13 章节补全 17 提交内容 + Released 小节含离线包路径与安装命令）、`README.md`（当前版本徽章 2.1.0）+ 三状态文件。
- 验证：`npm run test` 323 files / 3649 tests 全过；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npm run build` 成功（仅既有 KaTeX/chunk 警告）；`package-offline/shawnstack-quickforge-2.1.0.tgz` 已生成（7.5 MB / 471 files / 版本 2.1.0）。
- Git：commit `22fe294`（4 文件）+ tag `v2.1.0` + master ff-only 快进，dev/master/tags 已全部推送；HEAD=22fe294 四 ref 同步，推送后工作区干净（状态文件本轮更新除外）。
- Blocker：无。npm 未登录（npm whoami ENEEDAUTH），publish 留给用户（需先 `npm login`）。
- Notes：本条目与 progress/feature_list 的状态更新未提交，下个 feature 会话顺带提交；GitHub Release（Desktop Build 工作流由 v* tag 触发）非本轮范围；未手工修改 dist/package-dist/package-offline。
- 下一步：用户手动 `npm login` + `npm publish`（命令见本轮会话总结）；继续下一个 feature。

---

## 上一轮交接：pinned-summary-subagent-finished-show-all（done，实现与定向自动验证完成；浏览器未实测）

- 目标：落地置顶摘要「智能体 · 已结束」调研报告方案 A（用户采纳）：真实计数 + 展开显示全部 + 提取轻量化。
- 改动（7+3 文件）：`src/lib/subagent-run-detail.ts`（MAX_TERMINAL_SUBAGENT_RUNS=100 常量、clamp 1..5→1..100、buildSubagentRunPayload 可选 lightweight：traceMessages/input/details 置空跳过全量 stringify，status/error 本地推导，默认行为零变化）、`src/App.tsx`（提取显式传上限常量）、`src/components/git/GitToolsPinnedSummary.tsx`（删 slice(0,3)）、两测试文件（clamp 1..100 + 105 条截断 + 轻量契约 + 5 条 finished 计数/源码断言）、wiki 两段（components/README.md 已结束段、lib/README.md 提取函数段）、三状态文件。
- 验证（父 Agent 实跑）：亲读全部 diff；定向 vitest 7 文件 352/352 通过；`npx --no-install tsc -b` 0 error；`npm run lint` 0 error（仅既有 warning）；`git diff --check` 通过；grep wiki 旧措辞零残留；JSON.parse 通过。实现由 general subagent 完成，父 Agent 复审。
- Blocker：无。
- Notes：点击行 Inspector 仍优先 subagentRunStore 完整快照；仅 store 未命中（>100 旧 run）详情降级无 trace/input/details（文档化边界）。并行会话同期完成 goal-report-flat-style、goal-report-expanded-body-frame，与本 feature 无文件交集。未新增依赖、无 Git 提交。
- 下一步：浏览器验收（>3 个已结束 subagent：展开全部、真实计数、点击详情、面板滚动、Goal 胶囊密度不受影响）；验收后可考虑 commit。

---

## 上一轮交接：goal-report-expanded-body-frame（done，实现与全量自动验证完成；浏览器未实测）

- 目标：goal_report 展开内容区加轻量边框，复用项目 code-block 框配方（用户：点开才见内容可以框起来，参考其他设计）。
- 改动（3+3 文件）：`src/index.css`（.quickforge-goal-report-tool-body 加 border 1px var(--border) + radius var(--radius) + padding 0.625rem 0.875rem，复用 mini-lit CodeBlock.js:64 的 border-border/rounded-lg 配方，无背景无阴影；字号契约保留）、`tests/frontend/goal-report-renderer.test.ts`（新增框契约用例）、`docs/wiki/src/lib/README.md`（呈现契约一句）、三状态文件。不改 local-tools.ts。
- 验证：node 源码断言 8/8 PASS；定向 vitest 46/46；全量 `npm run test` 323 文件 / 3647 tests 通过；`npm run lint` 0 error（仅既有 warning）；`npm run build` 成功（仅既有 warning）。
- Blocker：无。
- Notes：details 收起时内容隐藏，框仅展开后可见；详细模式下 code-block 嵌套框为层级语义。本轮写入 feature_list/session-handoff 时发现并行会话（pinned-summary-subagent-finished-review）已插入条目，本条目置于其上。未新增依赖、无 Git 提交。
- 下一步：浏览器点开真实 goal_report 历史卡验收观感；验收后可考虑 commit。

---

## 上一轮交接：pinned-summary-subagent-finished-review（needs-review，纯调研+方案交付完成；待用户选择方案）

- 目标：调研置顶摘要「智能体 · 已结束」只显示 3 个的根因并给出修复方案（用户：先调研，再给出方案）。
- 交付：`docs/reviews/pinned-summary-subagent-finished-count.zh-CN.md`（根因链逐层证据/数据链路核验/设计考证/方案 A/B/C 对比/方案 A 实施设计/影响面清单/验证建议/风险边界）。
- 根因速览：数据源零截断；显示侧三层截断（App.tsx:562 默认 limit 3 → subagent-run-detail.ts:654 硬上限 5 → GitToolsPinnedSummary.tsx:221 slice(0,3) 与展开态无关）+ 标题/胶囊计数用截断后长度（:857/:227/:271-282）。mockup 未规定 3，属 feature 逐代继承的实现边界。
- 方案：A 真实计数+展开全部（推荐，必做提取轻量化——buildSubagentRunPayload 对每个 run stringify 全量 trace details，App 每个工具事件重算；轻量化与点击打开详情的兼容见报告 6.1 推荐 b）；B 提高上限；C 仅修计数。
- 验证：报告全部 文件:行号 引用亲读核实；extractLatestTerminalSubagentRuns 唯一生产调用方 grep 确认；node JSON.parse feature_list.json 通过；git status 前后基线对比 src/server/tests 零新增改动（src 既有 M 为前序/并行 feature 遗留，非本轮）。docs-only 未跑 test/lint/build。
- Blocker：无。
- Notes：撰写期间并行会话完成 goal-report-tool-flat-style，与本调研引用文件无交集。方案 A 的轻量化与「点击行打开完整详情」（非 canonical 历史 run Inspector fallback）是实施关键决策点。
- 下一步：用户选择方案；采纳后按报告第六节开实施 feature（A/B/C 互不冲突，A 前两步与 B/C 可组合）。

---

## 上一轮交接：goal-report-tool-flat-style（done，实现与全量自动验证完成；浏览器未实测）

- 目标：按用户反馈修订 goal_report 工具卡：默认收起与其他工具一致、去掉 tone 卡框与染色（确认染色 label 完全去掉；展开内容状态视觉保留）。
- 改动（4+3 文件）：`src/lib/local-tools.ts`（默认收起 `?? detailed`、删 data-tone/toneFor）、`src/index.css`（删卡片配方/tone 选择器/padding 特化/label 染色；blocker 固定 #d97706；保留标记 class 与消息字号契约）、`tests/frontend/goal-report-renderer.test.ts`（默认收起断言、去 tone 断言）、`docs/wiki/src/lib/README.md`（呈现契约两行）、三状态文件。
- 验证：node 残留断言 10/10 PASS；定向 vitest 3 文件 67/67（goal-card 22 确认 Inspector 侧不受影响）；全量 `npm run test` 323 文件 / 3646 tests 通过；`npm run lint` 0 error（仅既有 warning）；`npm run build` 成功（仅既有 warning）。
- Blocker：无。
- Notes：tone 体系仅在 goal-report 工具卡移除；`.quickforge-goal-card`（Inspector 常驻卡）与 goal strip tone 未动；`quickforge-goal-report-tool` class 保留为标记。未新增依赖、无 Git 提交。
- 下一步：浏览器验收真实 goal_report 历史卡（默认收起、muted 摘要行、展开内容状态视觉）；验收后可考虑 commit。

---

## 上一轮交接：goal-plan-tool-card-font-consistency（done，实现与全量自动验证完成；浏览器未实测）

- 目标：落地上一 goal 设计稿 `design-mockups/goal-plan-tool-card-redesign.html` 的 S01–S05——goal 期间计划工具调用卡（goal_report/todo_write）字号切换到消息字号体系（`--quickforge-message-font-size`），与对话正文一致。
- 改动（2+3 文件）：`src/index.css` 四处（① 摘要行组规则 `0.875rem` → `calc(×0.875)`；② `.quickforge-goal-report-tool-body` 增字号/行高 token（subagent-run-detail-body 同模式+注释）；③ 新增 unlayered 覆盖规则 goal/todo 卡 body 内 `.text-xs` 节标签 → `calc(×0.8)`（`> div` 避开 summary 行内 renderTiming）；④ scope-chip `0.7rem` → `calc(×0.8)` 保留 mono）、`tests/frontend/goal-report-renderer.test.ts`（新增 message font contract describe 3 用例）、三状态文件。
- 验证：定向 vitest 3 文件 48/48；`npm run test` 全量 323 文件 / 3646 tests 通过；`npm run lint` 0 error（仅既有 warning）；`npm run build` 成功（仅既有 KaTeX/chunk 警告）；node 源码断言 10/10 PASS；`git diff --check` 通过；git status 改动面仅 2 M（index.css + goal-report-renderer.test.ts）+ 1 ??（上一 goal 设计稿）。
- Blocker：无。
- Notes：Process 折叠时间线 summary 行（index.css:2882/:3015 的 0.875rem）不在设计稿范围未动；summary 规则全局作用于全部工具卡（默认 13/13 零视觉回归，分开调整后与对话正文一致）；wiki 未更新（纯样式字号行为变更，非架构/职责/入口）。未新增依赖、无 Git 提交。
- 下一步：浏览器验收（设置·外观分开调整界面/消息字号 + 真实 goal_report/todo_write 历史卡）；验收后可考虑 commit。

---

## 上一轮交接：goal-configurable-iterations（done，实现与定向自动验证完成；浏览器未实测）

- 目标：goal 最大轮次默认 8→20，并可在设置·常规页配置（样式与项目匹配）。
- 改动（25 个文件，3 新增）：`server/agent-goal-state.mjs`（GOAL_BUDGET_DEFAULTS 8→20）、`server/goal-settings.mjs`（新增：settings 键 `goal-settings`、clamp 1–100、fail-open 回落 20）、`server/agent-goal-runner.mjs`（startGoalPlanning 锁内读配置传 budget；extendResumeGoal 追加量用配置值）、`src/lib/goal-settings.ts`（新增）、`src/lib/default-options-settings-tab.ts`（常规页新增「Goal 最大轮次」数值行，零新增 CSS）、`src/lib/goal.ts`（goalBudgetExtension 参数化默认 20）、`src/lib/i18n.ts`（goalMaxIterations(+Description) en+zh）、`src/components/workspace/GoalInspectorContent.tsx`（useEffect 读配置展示追加增量）、测试 7 文件（server goal-settings 新增、state/runner 断言 8/16/24→20/40/60 重推、frontend 镜像 +8→+20、settings-normalizers 新用例）、wiki 7 文件（契约速记行 ×4 + README:56 + server 预算段 + routes/src/lib/src 段落）与三状态文件。
- 验证（父 Agent 实跑）：合并定向 vitest 10 文件 238/238 通过（manager 日志 round 0/20 生效；agent-goal-runtime 15/15）；`npm run lint` 0 error（仅既有 warning）；`npx tsc -b` 0；`npm run build` 成功。实现由两个 general subagent 并行（服务端/前端），父 Agent 亲读 diff 复审。
- Blocker：无。
- Notes：extend 追加量与配置值同源（解耦属评审 B4）；存量 goal 已持久化 maxIterations 不改写；settings 读取失败 fail-open 回落 20。未新增依赖、无 Git 提交。
- 下一步：浏览器验收设置·常规页新行（观感/窄屏/中英文）；验收后可考虑 commit。

---

## 上一轮交接：goal-p0-fixes（done，实现与定向自动验证完成；浏览器未实测）

- 目标：落地 Goal 显示交互评审报告的 P0 三项（用户指示「修复p0」）。
- 改动（9 个文件）：`goal-control-strip.ts`（openSummary(view) 参数化：预算耗尽 resume → 'progress' 对齐 wiki :148；编辑 icon 保持 'edit'、aria/title 换 goalEditObjective）、`goal-iteration-divider.ts`（execution error/blocked/cancelled 轮换警示叹号，budget/completed/paused/needs_review 保留对勾）、`i18n.ts`（六组 key en+zh 去确认承诺：goalCommandDescription/goalResumeNote/goalScopeChangeNote/goalHintPaused/goalPauseSaveNote/goalReportWasWaiting）、两个测试（strip 预算耗尽 WithArgs('progress') + aria 断言、divider 新增 3 组 execution 图标用例）、wiki components README :19 补图标语义、三状态文件。
- 验证：定向 vitest 7 文件 194/194 通过（divider 67、strip 28）；lint 0 error（仅既有 warning）；tsc 0；i18n 断言旧措辞零残留/新措辞齐备；JSON.parse 通过；归属脚本通过。
- Blocker：无。
- Notes：评审报告的 P1（ND-05 语境失效/ND-07 时长口径/ND-13 键盘/C-01 tone/ND-08 终态过滤）与 P2（ND-01 accept/ND-02 死代码包等）待用户选择；本轮零依赖变更、无 Git 提交。
- 下一步：浏览器验收（aria 播报、图标观感）；验收后可考虑 commit。

---

## 上一轮交接：goal-display-interaction-review（needs-review，纯评审交付完成；结论已复核并交付，待用户评审采纳）

- 目标：评审 Goal 功能「显示与交互」层可优化点并给出结论；产出 `docs/reviews/goal-display-interaction-review.zh-CN.md`；纯只读，不修改生产代码。上一轮 c6 快照断言因共享工作树既有未提交改动 blocked 后重新规划收口。
- 交付：报告 305 行，覆盖 7 个 surface，含历史编号全量对照表（12 项待复核全部给出源码结论）、撞号说明（G-10≠G10、S-01≠S1）、P0/P1/P2 优化建议 18 条。结论已复核并交付：骨架质量好，优化集中四类——P0：ND-03 预算追加落点错视图、ND-04 六组 i18n 文案契约漂移、G10 失败轮对勾；P1：ND-05 语境失效、ND-07 时长口径矛盾、ND-13 键盘缺口、C-01 tone 4 组、ND-08 终态过滤；P2：ND-01 accept 恒不可达、ND-02 死代码包等。
- 复核（重新规划轮）：3 个 P0 依据 node 断言在当前工作树仍成立；归属验证通过（untracked 仅交付文件、四目录零变更、17 个非本轮 prod M 全部归属：13 前序续报 + 4 并行会话布局修复（message-queue/todo-write-summary 的 goal-strip 兄弟容忍，diff 抽查确认非本轮），unexpected=0）。
- 已验：node JSON.parse feature_list.json 通过；报告结构断言（c1）、P0 源码依据断言（c2）、归属脚本（c3）均退出码 0。docs-only 未跑 npm test/lint/build。
- Blocker：无。
- Notes：共享工作树持续有并行会话写入（本轮新增 4 个布局修复文件已核实归属）；死代码清理（ND-02）涉及契约测试，建议独立 feature。
- 下一步：用户评审报告并决定采纳项（建议优先 P0 三项：ND-03/ND-04/G10，纯文案项低风险高收益）；采纳后另开生产 feature 落地。

---

## 上一轮交接：goal-ui-live-ticker-grouped-summary（done，实现与定向自动验证完成；浏览器视觉未实测）

- 目标：用户要求的三项 goal 模式 UI 修复——运行条「已记录 N 秒」实时递增、规划中清单图标、置顶摘要 Goal 分组化；续报微调 Inspector 累计用时上限无限时整行隐藏、规划 icon 停转 + 运行条宽度 fit-content 收缩、运行条锚定输入框紧前（任务摘要出现时仍贴输入框）、运行条水平居中。新增独立 feature（无依赖），已完成。
- 改动文件（22 个）：`src/components/chat/panel-decoration/goal-control-strip.ts`（1s ticker 实时插值「已记录 N 秒」；锚点从 shell 首位改为 suggestionMenu ?? editor 紧前）、`src/components/chat/panel-decoration/goal-card.ts`（STATUS_ICON.info 同步换为 list-todo 清单 SVG，planning/awaiting_confirmation 专用）、`src/components/chat/panel-decoration/todo-write-summary.ts`（isSettled 容忍 quickforge-goal-strip 后继）、`src/components/chat/panel-decoration/message-queue.ts`（isQueueAnchorFollower 容纳 quickforge-goal-strip）、`src/components/git/GoalSummarySection.tsx`（带标题「目标」+ passed/total 计数的 section 分组，组内渲染 criteria 只读行，保留导航按钮）、`src/components/workspace/GoalInspectorContent.tsx`（续报微调：duration 预算行 maxActiveDurationMs 为 null 时整行隐藏）、`src/lib/i18n.ts`（pinnedGoalTitle en Goal / zh 目标）、`src/lib/goal.ts`（SPINNING_STATUSES 移除 planning，清单图标静止、仅忙碌态旋转）、`src/index.css`（`.quickforge-goal-strip` 宽度 fit-content + max-width:100%；margin 0 auto 0.375rem 水平居中）、`tests/frontend/{goal-control-strip,goal-summary-section,git-tools-pinned-summary,goal-budget-inspector,goal-card,goal-state,todo-write-summary,message-queue}.test.ts`、`docs/wiki/src/components/README.md`、`docs/wiki/README.md` 与三状态文件。`GitToolsPinnedSummary.tsx` 零改动。
- 验证：定向 vitest 5 文件 120/120 tests 通过（ticker 递增/清理/再锚点、新 icon 断言、criteria 渲染断言、分组 section/标题契约）；`npm run lint` 0 error；`npm run build` 成功。续报微调另验：定向 vitest 3 文件 45/45（goal-budget-inspector 无限时长行隐藏断言）；eslint 两改动文件通过；`tsc -b` 通过。续报微调二另验：定向 vitest 3 文件 83/83（spinning 分类契约移除 planning、planning 视图 spinning:false、CSS 宽度契约 fit-content+max-width）；eslint 四改动文件通过；`tsc -b` 通过。续报微调三另验：定向 vitest 3 文件 68/68（goal strip 锚定 editor/建议菜单紧前、todo-summary 容忍 goal-strip 场景、queue follower 契约）；eslint 六改动文件通过；`tsc -b` 通过。续报微调四另验：定向 vitest 2 文件 50/50（goal-card CSS 契约新增 margin 居中断言）；eslint 0 error；`npm run build` 成功。
- Blocker/限制：无。done 不表示浏览器视觉通过；服务端结算值为最终基准，ticker 仅做快照间插值显示。
- Notes：wiki 旧约束「不以挂载时间或浏览器计时伪造实时用量」已按用户要求改为「服务端结算为最终基准；快照之间由 1s ticker 插值当前轮流逝时间（用户要求时长可见递增）；goal 结束/移除即停」；≥1 分钟按分钟向下取整规则保留。未新增/升级依赖、未手工改 `dist/`/`package-dist/`/`package-offline/`、无 commit/tag/push/发布。
- 下一步：无待办；可选后续为真实浏览器视觉验收。改动未提交。

---

## 上一轮交接：goal-report-tone-card（done，实现与定向自动验证完成；浏览器视觉为人工判断项未实测）

- 目标：把上一轮已验收的 goal 工具对话显示设计（tone 卡片 + 靶心图标 + 状态化验收标准 + scope chip + blocker 警示框）落进生产，依赖 `goal-report-renderer`（done）。
- 改动文件（8 个）：`src/lib/goal-report-history.ts`（新增 `criteriaDetails` 并保留 `criteria`）、`src/lib/local-tools.ts`（`GoalReportToolRenderer` 加 `data-tone`/`quickforge-goal-report-tool`、靶心 `GoalIcon`、四态准则图标、scope chip、blocker 警示框）、`src/index.css`（`.quickforge-goal-report-tool` 5 个 tone 选择器 + 3px 强调条 + 四态配色 + chip/blocker 样式）、`tests/frontend/goal-report-renderer.test.ts`（新增断言）、`docs/wiki/src/lib/README.md` 与三状态文件。前三者源码改动为本 feature 范围，续跑时已在工作树。
- 验证：`npx vitest run tests/frontend/goal-report-renderer.test.ts` 退出码 0（34 tests passed）；`npm run lint` 退出码 0（仅既有 `server/cloud/identity.mjs:92` warning）；`npx --no-install tsc -b --pretty false` 退出码 0；`git diff --check` 通过。
- Blocker/限制：无实现或自动验证阻断。done 不表示浏览器视觉通过（c8 人工判断项）；未做真实浏览器/窄屏/主题/焦点验收。
- Notes：新 renderer 方法内联在类内以通过 VM 测试；未改后端/无关文件、未新增/升级依赖、未手工改 `dist/`/`package-dist/`/`package-offline/`、无 commit/tag/push/发布。工作树中无关联的既有未跟踪文件（`docs/design/goal-*`、`goal-demo/`、`iter-demo/`）为设计阶段遗留，本 feature 未触碰。
- 下一步：浏览器打开真实 goal_report 历史消息验收视觉（c8）；改动未提交。

---

## 上一轮交接：retry-preserve-tool-history（done，实现与全量自动验证完成；浏览器未验收）

- 目标：用户提出「点重试会清掉对话、丢掉已执行 tools 调用，模型上下文对已改文件无感知」，确认按方案 A（按失败阶段分流）改造重试语义——被重试回合已产生 `toolResult` 时保留整段历史并在末尾追加一条「继续」用户消息续跑，纯文本失败仍走截断重生成。新增独立 feature，无依赖。
- 调研要点：现状是刻意的「原地重生成」（前端 `useChatActions.ts` slice + 服务端 `continueSession` slice），副作用是丢弃失败轮已完成的工具调用；pi-ai 会把 `stopReason: error/aborted` 的 assistant 整条跳过，所以收益只在保住工具记录。只改服务端会坏（服务端消息数多于本地 → split 位置合并永久错位，summary 对账只在服务端更少时自愈），因此前端必须同步去掉截断并乐观追加同一条消息（role+timestamp 对齐）。
- 实现：`src/lib/message-utils.ts` 新增 `hasToolResultsAfter`；`src/hooks/useChatActions.ts` `retryFromMessage` 分流；`src/lib/server-agent.ts` `continue(appendMessage?)`（照 `steer` 的乐观 push + `message_start` + 失败回滚，Cloud 模型补 `quickforgeClientMessageId`）；`src/lib/deferred-session-agent.ts` 透传；`server/agent-manager.mjs` 新增 `normalizeRetryAppendMessage` 与 `continueSession(sessionId, modelAccessContext, appendMessage)` 追加模式（canonical capabilities/refs 覆盖 details、新 timestamp、服务端新铸 logical id）；`server/routes/agent.mjs` continue 路由读可选 body `{message}`。未传 `message` 时截断逻辑逐字保留，ACP/其他调用方零影响。
- 改动文件（16个）：`server/agent-manager.mjs`、`server/routes/agent.mjs`、`src/hooks/useChatActions.ts`、`src/lib/server-agent.ts`、`src/lib/deferred-session-agent.ts`、`src/lib/message-utils.ts`、`tests/server/agent-manager.context-references.test.mjs`、`tests/frontend/server-agent.test.ts`、`tests/frontend/message-utils.test.ts`、`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 `npx vitest run tests/server/agent-manager.context-references.test.mjs tests/frontend/server-agent.test.ts tests/frontend/message-utils.test.ts tests/frontend/message-actions.test.ts tests/server/routes/agent.test.mjs tests/server/agent-manager.external-sync.test.mjs` 退出码 0（5 files / 244 tests passed）；`npm run test` 退出码 0（322 files / 3617 tests passed，较上轮 +1 file/+6 tests）；`npm run lint` 退出码 0（仅既有 `server/cloud/identity.mjs:92` warning）；`npm run build` 退出码 0（仅既有 KaTeX 字体与 chunk 体积 warning）。覆盖追加模式保留 `toolResult` 且模型上下文仍含工具结果、timestamp 与 canonical references、无 `message` 时仍截断、前端乐观追加与请求体、失败回滚。
- Blocker/限制：无实现或自动验证阻断。done 不代表真实浏览器/真实模型验收；未验证项为 provider 对连续两条 user 消息的接受度（自动压缩 summary 是既有同形态先例，未线上验证）。追加正文复用 i18n `errorContinueMessage`，随当时语言持久化。发送失败仍走 `retryFailedPrompt` 原样重发；分享页重试仍为 no-op。
- Notes：既有 `retryFromMessage` 可对任意 user 消息重试而服务端始终取最后一条 user 消息的口径不一致，未在本轮扩大处理。未新增/升级依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist），无 Git commit/tag/push/发布。
- 下一步：加载新前端后实测一次「多步工具中断 → 点重试」，确认 provider 接受追加消息且工具历史保留；改动未提交。

---

## 上一轮交接：goal-parallel-sessions（done，实现与全量自动验证完成；浏览器未验收）

- 目标：用户确认将 Goal 互斥由「同一工作区最多一个活跃 goal」改为「同一会话最多一个活跃 goal」；不同会话（含共享同一合成默认工作区的全部全局对话、两个 projectId 指向同一目录的场景）可各自持有活跃 goal 并真正并行执行，`/goal` 不再返回工作区冲突 409。依赖 `goal-stage-order-target-icon`（done），其历史 diff 与下文全部记录原样保留。
- 实现：删除 `GOAL_WORKSPACE_CONFLICT`(409)、`findWorkspaceGoalConflict`/`assertWorkspaceFree`/`workspaceKeyForSession`/`workspaceKeyForMetadata`/`activeSessionGoal`、`goalWorkspaceKey`/`normalizeWorkspaceKey`，以及 `agent-manager` 只为该互斥注入的 `resolveWorkspaceRoot` 与 runner 侧对应依赖；start/confirm/resume/revise/extend_resume 由按 sessionId 串行的 admission 队列执行锁内 re-check + 提交所有权，同会话 `session.goal` 读写不交错、不同会话互不阻塞。
- X1 修复：`startGoalPlanning` 的「本会话已有活跃 goal」检查与 `clearGoalTermination` 移入会话锁内（此前在锁外，同会话并发 `/goal` 存在双写窗口）。
- 改动文件：`server/{agent-goal-runner,agent-goal-state,agent-manager}.mjs`、`server/agent-persistence.mjs`（仅一处陈旧注释）、`tests/server/{agent-goal-runner,agent-goal-state}.test.mjs`、`docs/wiki/README.md`、`docs/wiki/server/README.md`（wiki 由另一 subagent 完成）；本轮另同步 `CHANGELOG.md` 与三状态文件。
- 验证：父 Agent 实跑定向 `npx vitest run tests/server/agent-goal-runner.test.mjs tests/server/agent-goal-state.test.mjs tests/server/agent-goal-manager.test.mjs tests/server/routes/agent.goal.test.mjs` 退出码 0（4 files / 176 tests passed）；`npm run test` 退出码 0（321 files / 3611 tests passed）；`npm run lint` 退出码 0（仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning）；`npm run build` 退出码 0（仅既有 KaTeX 字体解析与 chunk 体积 warning）。覆盖同会话第二个 goal 被拒、不同会话与同路径两个 projectId 各自开 goal、两个不同会话并发 start 均成功且各持 own goal、同会话并发两次 `/goal` 恰好一个成功且 persistSession 仅 1 次；grep 确认删除符号零残留引用。
- Blocker/限制：无实现或自动验证阻断；done 表示实现与全量自动验证完成，未做真实浏览器/真实模型验收。语义变更：同一工作区（尤其全局对话共享的默认工作区目录）可同时有多个 goal 并行跑工具，可能互相写文件或执行命令，互不隔离；「别的对话已有活跃 goal」的 409 提示与持久化 metadata 冲突扫描复核逻辑永久移除。
- Notes：`docs/reviews` 下历史评审文档按历史保留原样；未新增/升级依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常刷新 dist），无 Git commit/tag/push/发布。发现但未修的无关问题：无。
- 下一步：父 Agent 最终审查后补真实浏览器验证（多对话并行开 goal、同会话并发 `/goal` 只成功一个）；改动未提交。

---

## 上一轮交接：goal-stage-order-target-icon（done，实现与针对性自动验证完成；浏览器未测）

- 目标：用户已授权的阶段分隔线顺序与 Goal 靶心图标调整，依赖 `goal-stage-divider-live-sync`（done）；divider `order: 3` 排在 actions `order: 2` 下方，新共享 `GoalIcon` 为 24 viewBox、currentColor、2px 双圆箭中靶心线条 SVG。摘要行、胶囊 Goal 段、Inspector Tab/溢出菜单共四身份入口复用；其他状态图标、导航及执行逻辑不变。
- 改动文件（源码与测试10个）：`src/index.css`、`src/components/goal-icon.tsx`、`src/components/git/{GoalSummarySection,GitToolsPinnedSummary}.tsx`、`src/components/workspace/WorkspaceInspector.tsx`、`tests/frontend/{goal-icon,goal-iteration-divider,goal-summary-section,git-tools-pinned-summary,workspace-inspector-tabs}.test.ts`；另有 `docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`，完整14路径见 feature。此收尾委派仅编辑 Wiki 与三状态文件。
- 验证：实现委派及父 Agent 复跑定向9文件/196测试通过；委派 `npm run lint` 退出0，仅既有 `server/cloud/identity.mjs:92` warning，tsc通过。父 Agent 独立复跑 `npm run lint` 退出0，仅既有 `server/cloud/identity.mjs:92` warning；`npx --no-install tsc -b --pretty false` 退出0；本委派仅做 JSON、唯一ID、依赖、14文件路径、历史保留及 `git diff --check` 检查。
- Blocker/限制：实现与已执行针对性自动验证无阻断；父 Agent 最终审查待收尾。done 不表示真实浏览器通过，CSS/fallback与SVG/入口契约测试不替代真实布局、窄屏/主题/焦点/读屏或模型实测。未跑全量 test/build，无依赖/生成产物/Git commit/tag/push/发布。
- Notes：全部旧 feature、历史、既有未提交 diff 及前轮 `docs/reviews/goal-ux-ui-review.zh-CN.md`、`design-mockups/goal-ux-ui-optimization.html` 保留，不修其他评审问题。Wiki 仅补视觉顺序和共享图标职责，不改 server/架构总览；SVG 本身已是所需小图标，无需新解释图。
- 下一步：父 Agent 完成最终审查后交付；补真实浏览器确认操作栏下方分隔线及四入口图标的亮暗/窄屏观感。改动未提交。

---

## 当前交接：goal-ux-ui-review-prototype（done，仅评审交付与自动验证完成）

- 目标/交付：依赖 `goal-stage-divider-live-sync`（done），接续复核完善轮初已存在的未跟踪报告与原型草稿，非从零新建。`docs/reviews/goal-ux-ui-review.zh-CN.md` 提供完整旅程评审、G01–G11、文案/信息架构与分阶段建议；`design-mockups/goal-ux-ui-optimization.html` 为九场景模拟交互，已有交接/状态 SVG。
- 改动文件：上述报告、原型及 `feature_list.json`、`progress.md`、`session-handoff.md`；本次收尾仅四文件（报告验证段 + 三状态），不动原型或其他文件。原型此前仅修 planning 同 scene 重新保存 timer 复用，generation + revision guard 隔离旧回调；生产问题未修。
- 验证：父 Agent Node 内联 `vm.Script`、71 唯一 ID、18 HTML 引用、零外部资源、9 场景、4 种规划双屏障、预算/编辑冲突、G01–G11 映射检查退出 0；28 组 fake DOM 事件及 timer guard 通过；定向 Vitest 8 文件/187 测试退出 0，完整命令在报告。委派 6 项虚拟时钟及负对照通过，不混入父级 28 组。
- Blocker/限制：交付无自动验证阻断；done 只表示评审交付与自动验证，不代表 G01–G11 产品缺陷修复或真实浏览器通过，不预写本 Goal 运行状态 completed。fake DOM 不是浏览器；无可用真实 browser/Playwright 通道，不装依赖；真实模型、布局、焦点/读屏仍未实测。本轮未跑全量 test/lint/build。
- Notes/边界：父级首次静态检查操作数字面顺序断言写反，更正检查重跑退出 0；委派长命令包装失败拆短后通过，非生产测试失败。所有旧 feature、历史与既有改动保留；不改生产代码/测试/Wiki/依赖/生成产物，无 Git 提交/tag/push/发布。纯提案未改变现行契约、架构或公共入口，Wiki 无需更新。
- 下一步：父 Agent 整合交付；另开独立生产修复优先 G01/G02/G04，并按报告补真实浏览器与采纳后回归。报告与原型仍未跟踪、改动未提交，不把旧评审缺陷标为解决。

---

## 当前交接：goal-stage-divider-live-sync（done，实现与全量自动验证完成）

- 目标：Goal 规划/执行分隔线实时可见且持久化；依赖 `goal-plan-handoff-fix`（done）。该轮历史 diff、旧 feature 状态及无关问题全部保留，本轮不扩范围。
- 实现契约：planning/execution marker，legacy 无 kind 按 execution；规划 iteration 可 0 但 UI 不显示轮数。有效 plan 正常轮末+保存成功才「计划已就绪」，completed 同屏障；staged pair + 消息数组/长度/条目引用 guard，settling 拒绝 runPrompt，冲突保留 live history 暂停、取消优先。内部 forceMessagesReplace 保存非尾 assistant marker，不绕 CAS；chunked 派发前 canPersist 再验。
- 同步契约：split state/GET 稀疏 goalIterationMarkers 不传正文，索引+身份校验，最新 snapshot 在后到消息后重放；full metadata 不放宽正文 streaming 门禁。专用本地 message_metadata_updated 刷新 Host 窗口消息/装饰，不清 process、不恢复 draft；marker 实际变化推进消息 watermark，goal_updated 不推进。
- 改动文件：server/{agent-goal-runner,agent-manager,agent-persistence,agent-session-events,session-state-service}.mjs；src/components/chat/{ChatPanelHost.tsx,panel-decoration/goal-iteration-divider.ts}；src/lib/{i18n,server-agent}.ts；tests/server/{agent-goal-runner,agent-session-events,session-state-service}.test.mjs；tests/frontend/{goal-iteration-divider,message-actions,server-agent}.test.ts；docs/wiki/{server,src/lib,src/components}/README.md 与三状态文件。完整 21 文件清单见 feature_list.json；上轮独有 system-prompt/对应测试、server/tools Wiki、runtime 新测试不计入本次。本次收尾委派仅更新三状态文件；Wiki 现行契约此前已同步，无需再改。
- 验证：父 Agent 最终实跑 npm run test 退出0，320 files/3605 tests 通过；npm run lint 退出0，仅既有 server/cloud/identity.mjs:92 warning；npm run build 退出0，仅既有 KaTeX 字体/chunk warning。此前联合定向 13 files/502 tests 通过；文档委派 JSON 解析、feature 依赖/唯一性、21 文件路径、HEAD 旧历史保留校验与 git diff --check 均通过，本次不重跑生产测试。
- 复审：父 Agent 已审查并整合 staged 消息冲突、split 分页打断重放、full streaming marker 独立采纳三个竞态修正；正文 streaming 门禁不放宽。
- Blocker/Notes：无实现或自动验证阻断，done 表示实现与全量自动验证完成。浏览器 c7 明确未实测，无现成浏览器通道（无 playwright 等工具，仅 electron runtime），不冒称现场模型/刷新/视觉验收，也不以人审阻塞自动验证结论；历史无关问题保留。完全存储故障/任意 I/O 崩溃窗口不保证补偿持久化。
- 边界/下一步：考虑 SVG 后复用现有细线/SVG 无需额外图；无依赖、Git 提交/发布或手工产物。加载新服务/前端后可真 UI 观察规划/执行、刷新、暂停取消与窄屏主题；新规划 marker 不会回填无 marker 旧记录。改动未提交，上轮 diff 保留。

---

## 当前交接：goal-plan-handoff-fix（done，修复与全量自动验证通过）

- 目标：防止 plan 后同一规划轮的执行期报告覆盖计划、阻断自动执行；阶段门禁改用 `isGoalPlanning(session)` 或未确认 awaiting_confirmation，重复 plan 原有拒绝保持。system prompt 明确显式 `/goal` 目标范围授权、不重复确认，必要澄清/工具审批/安全与正常轮末持久化不变。
- 改动文件：server/{agent-goal-runner,system-prompt}.mjs、tests/server/{agent-goal-runner,system-prompt}.test.mjs、新 tests/server/agent-goal-runtime.test.mjs、docs/wiki/server/README.md、docs/wiki/server/tools/README.md、三状态文件；本委派只同步后五个文档/状态文件，历史全部保留。
- 测试覆盖：真实 pi Agent + manager + SQLite 与脚本模型；prompt/persist 两种先后顺序均等双屏障后恰好一次 execution，必要 ask 不自动回答；runner 多组阶段和取消/失败保护。
- 父 Agent 实跑：定向20 files/390 tests通过；npm run lint退出0，仅既有identity.mjs:92 warning；npm run build退出0，仅KaTeX/fonts/chunk警告。最终全量 npm run test 退出0：320 files/3475 tests通过（含 runtime 失败路径清理修正）；父 Agent 审查及独立只读复审完成。
- Blocker/边界：无自动验证阻断；不声称现场会话根因已确认或真实模型/浏览器通过。Notes：调度门禁静默返回为静态风险，未复现未修，不扩范围。
- 无 UI/历史文案变更，不需 src Wiki；考虑 SVG 后采用简短流程文字。无依赖/手工产物/Git提交或发布；build 正常生成 dist，但 Git 无产物修改。
- 下一步：改动未提交；重启加载新服务代码后可验证新 Goal。旧阻塞 Goal 不自动重放，需显式继续；真实模型与浏览器未实测。

---

## 当前交接：goal-changes-commit（in_progress，提交准备快照）

- 目标：用户已授权提交并推送既有 42 个 Goal 文件；子任务只 commit，父 Agent 负责 push/远端核验。分支 dev，上游 origin/dev；不读取凭据/远端 URL 配置，不 reset/rebase/force/pull，不创建 tag。
- 本轮修改仅 feature_list.json、progress.md、session-handoff.md 追加提交准备与验证记录；其余既有 Goal server/src/tests/wiki/review 内容保留。明确路径暂存，提交前复核完整暂存差异。
- 实跑验证：npm run test 退出0（319 files/3457 tests）；npm run lint 退出0（仅既有 identity.mjs:92 warning）；npx --no-install tsc -b --pretty false 退出0；git diff --check通过。状态同步后再次 JSON 与 diff 校验。
- 边界：本段写于 commit 前，不预填哈希，不宣称 push 完成；真实 commit hash/status 由工具输出回报。无依赖/生成产物/build/npm 发布操作。真实浏览器验收及历史评审问题未解决。
- Notes：Wiki 的 renderer 无 mount 描述与保留空 mount 的源码有偏差，无运行时确认按钮；本次不修生产或 Wiki。首次分号组合只读 git 命令被当参数拒绝，已拆为单命令成功执行，不影响验证结果。
- 下一步：创建单个 commit 后父 Agent 执行 push 并核验远端；完成后同步最终状态。

---

## goal-auto-start-unlimited-time（done，实现与全量自动验证完成；浏览器待验收）

- 实现：planning 整轮及最终 persist 窗口只读，正常持久化后自动执行；新 Goal null 无限累计时间，usage 保留；resume/extend/revise 移除旧时间上限，extend 仅耗尽轮次 +8 且保留 CAS。当前 UI 无计划确认/验收，Inspector 显示无限与累计用时。
- 收尾：补 goalRun 清除后的 planning 最后持久化窗口只读门禁；needs_review→blocked 本轮仅 read_file/grep_files/必要 ask_user，禁止写/命令/委派/goal_report，问答与 error 结束均不续跑，不伪造 passed。历史 human evidence/accept API 保留。
- 验证：定向 2 files/107 tests；全量 npm run test 退出0，319 files/3457 tests passed；npm run lint 退出0，仅既有 server/cloud/identity.mjs:92 warning；npx tsc -b --pretty false 退出0；git diff --check通过。补 duration-only resume、null预算SSR无NaN、planning persist只读、needs_review提问后idle/error不续跑。
- 文档：逐条同步 Wiki 总入口/server/routes/tools/src/lib/components 现行段落，不改历史 reviews/features。保留 inert chat confirmation controller 与 Host 接线，避免扩大装饰生命周期清理；无 DOM/confirm 派发，非运行时确认入口。
- 边界/下一步：父 Agent 最终审查与浏览器真实模型/刷新/暂停取消/窄屏主题/焦点验收待办；done 仅表示实现与自动验证完成。其他历史评审问题未修。无 build、依赖/生成产物变更、Git commit/tag/push/发布。

---

## 当前交接：goal-hide-internal-run-messages（done，实现与自动验证完成；父 Agent 最终审查待办）

- 目标：隐藏合法metadata execution/planning内部user正文/操作/空白，保留user DOM分轮边界、原消息索引、模型上下文和历史；保留user回退/空assistant source直接divider。普通同文本不隐藏，class可逆，计划确认仍读完整messages。
- 文件：goal-internal-message.ts（新）、message-actions.ts、index.css、agent-goal-runner.mjs、新internal测试、message-actions/divider/runner测试、server/components wiki、三状态文件。保留旧改动及所有旧feature状态。
- 验证：定向8 files/329 tests通过；npm run lint退出0仅既有identity.mjs:92 warning；npx tsc -b --pretty false退出0。不build、不依赖变更/生成产物、不commit/tag/push/发布。
- Blocker/边界：无自动验证阻断；父Agent最终审查待办。渲染后装饰不能保证零闪现，窗口高度估算/滚动与CSS :has真实布局、焦点/屏幕阅读器待浏览器验证。提示词不能保证模型百分百不重复；不按字符串删助手内容，不迁移旧无metadata正文。
- 下一步：父Agent审查CSS及完整消息/原索引契约；用户浏览器验收自动续跑、重新规划、无assistant回退divider、刷新历史、窄屏/亮暗与键盘导航。

---

## 当前交接：goal-chat-plan-confirmation（done，实现与自动验证完成；父 Agent 最终审查待办）

- 当前目标：最新有效 Goal plan 聊天内确认执行；历史快照不可执行，侧栏动作保留。新 controller `src/components/chat/panel-decoration/goal-plan-confirmation.ts` 由 ChatPanelHost 注入当前agent，renderer仅空mount；同Goal revise仍按最新toolCallId/revision和计划内容/criterion IDs验证，未确认允许轮末+1 revision。
- 改动文件：新controller、ChatPanelHost.tsx、local-tools.ts、i18n.ts、新goal-plan-confirmation.test.ts、goal-report-renderer.test.ts、docs/wiki/src/lib/README.md、docs/wiki/src/components/README.md、三状态文件。旧修改与feature状态全部保留。
- 验证：定向9 files/295 tests通过（controller/host21，renderer32）；npm run lint退出0仅既有identity.mjs:92 warning；npx tsc -b --pretty false退出0；git diff --check通过。不build、不新增依赖/生成产物、不commit/tag/push/发布。
- Blocker/边界：无自动验证阻断；父Agent最终审查待办。fake DOM及host源码契约不等于浏览器；真实规划结束、HTTP/SSE时序、窄屏主题/焦点/屏幕阅读器/刷新待人工。没有新增后端CAS，已发HTTP跨客户端替换仍既有边界；无法证明最新记录时保守隐藏聊天入口、Inspector不变。
- 下一步：父Agent审查身份/时序门禁与工具mount实际Lit行为，用户浏览器验收；done不表示浏览器已验收。

---

## 当前交接：goal-report-renderer（done，实现与自动验证完成；浏览器待验收）

- 目标：用户确认的 Goal 计划确认工具样式最小修复，专属 renderer 已注册，默认结构化历史计划内容，JSON 只在详细模式。非 plan 动作只作历史报告，运行中/失败/缺失结果不冒充成功，不新增历史确认操作，当前状态与动作仍在 Inspector。
- 改动文件：`src/lib/local-tools.ts`、`src/lib/goal-report-history.ts`、`src/lib/i18n.ts`、`tests/frontend/goal-report-renderer.test.ts`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。保留全部旧改动/旧feature状态；无其他评审修复或后端/CSS改动。
- 验证：定向 vitest 8 files / 121 tests通过（新renderer31）；npm run lint退出码0，只有既有identity.mjs:92 warning；npx tsc -b --pretty false退出码0；git diff --check通过。模板测试非真实浏览器。
- Blocker：无实现或自动验证阻断；浏览器窄屏/长文本/亮暗主题/折叠键盘焦点/屏幕阅读器、真实刷新/新Goal尚未验收。
- 下一步：父Agent审查整合；用户按真实规划确认流程查看工具样式及历史「当时等待确认」文案。不build生成产物、不依赖变更、不commit/tag/push/发布；done不表示浏览器已验收。

---

## 当前交接：goal-auto-complete-validation（done，仅审查与自动验证完成；浏览器 needs-review）

- 当前目标：用户授权的 Goal 自动完成/迭代分隔线验证报告已产出，不修缺陷；依赖 `goal-auto-complete-iteration-divider`，所有既有 feature 状态保留。
- 本次改动文件：`docs/reviews/goal-auto-complete-validation.zh-CN.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。历史记录原样保留在下方；报告足够，无需修改 Wiki 现行契约。
- 验证：父 Agent 本次 16 files / 472 tests 退出码 0（完整命令/计数见报告）；Node 纯函数复现 S1：passed→failed→passed 无新 evidence 仍 goalCompletionCheck ok:true，非真实模型。末轮完成、异常不完成、SQLite marker 恢复测试通过，不代表整条浏览器流程通过。
- Notes / 未修复：高 S1 旧证据复用；中 S2 needs_review persist 中 abort 意图未复核、S3 refreshTools reject 阻断完成通知（静态）；中 U1 预算入口误开 edit、U2 浮层极窄/裁切风险、U3 空宿主隐藏 divider 风险；低 U4 aria 名称、U5 click span 键盘缺口、U6 整链重复移末尾。observer suppression 存在，不声称无限循环；旧评审未重新核实项不混入新结论。
- Blocker：浏览器 c6 待人工；无专用 browser 工具，playwright/puppeteer/jsdom/happy-dom 不可 resolve，electron 有但未启动；不装依赖、不新建 harness。没有截图/真实布局/IME/屏幕阅读器验收结果。
- 下一步：父 Agent 整合交付；用户确认独立修复项，优先 S1 与 S2/S3 回归、U1 导航、U2/U3 真实浏览器复现；按报告 c1-c8 补人工验收。done 只表示审查与自动验证完成，发现问题并未修复。
- 边界：不改生产/测试/生成产物，不作 Git 提交或发布；本次只报告与状态同步，考虑 SVG 后采用问题表/清单。

---

## 当前交接：goal-auto-complete-iteration-divider（done，自动验证完成；无浏览器验收）

- 目标：Goal 有证据正常结束且最终状态持久化后自动完成；execution 每轮历史分隔线。
- 修改：runner/manager/persistence/tools definitions；前端 goal-iteration-divider/message-actions/index.css/i18n；3测试文件；4wiki；三状态文件。详见 feature_list。本轮复审仅追加runner末轮预算修复、3测试增强、server wiki及三状态同步，保留其他现有改动。
- 复审结论：第maxIterations轮验证成功可completed，预算只阻止下一轮；错误/abort/时长超限不能自动完成。commitCompletedGoal完成前后意图守卫、persistSession锁内canPersist及取消后串行补偿保存无新增阻断。分隔线按消息持久化元数据恢复，不依赖当前Goal；幂等且其他装饰追加内容后重置到根末尾。
- 验证：npm run test退出码0，316 files / 3397 tests passed；npm run lint退出码0，仅既有server/cloud/identity.mjs:92 warning；npx tsc -b --pretty false退出码0。按要求未build，无依赖或生成产物变更，无Git提交。
- Blocker：无实现/自动验证阻断；完全存储故障/任意I/O崩溃窗口不保证补偿持久化。
- 下一步：父Agent整合结果；用户浏览器视觉、真实刷新与新Goal验收尚未进行，done不代表浏览器已验收。

---

## 上一轮交接：goal-design-review Goal 功能设计评审（needs-review，待用户评审采纳）

- 当前目标：对当前 Goal 功能做设计层评审（与 UI 评审互补），产出报告 + 状态机图，纯只读零生产改动（git status 核实仅新增 2 交付物 + 3 状态文件）。
- 产物：`docs/reviews/goal-design-review.zh-CN.md`（七维度 + 高2/中8/低10 问题分级 + 设计债 8 条核实 + P0/P1/P2 建议，全部 文件:行号 亲读核实）+ `docs/reviews/goal-state-diagram.svg`（13 状态，node 校验零缺失 + XML well-formed）。
- 核心结论：骨架优秀（revision 单点/意图只升不降/fail-closed/settle barrier/证据信任链/重启不重放/goal 水位隔离）；🔴 X1 并发 /goal 双写窗口（runner:863-876 锁外 + :347-348 跳过同 session + commitGoal 无守卫）、🔴 X2 clear/compact 与回滚守卫不对称（manager:1209-1228 vs :1058-1065）；新发现 D1 死状态 failed（零入边）、D2 disposition 吞 error、D3 结算窗口中止语义、B1 等待计费、B3 双 commit、E1 降级不清证据；设计债核实：retry=已缓解、其余按历史仍开放/部分缓解。
- Blocker：无。时序结论（X1/D3/B3）未动态复现，建议修复时并发用例先行。
- 下一步：① 用户评审报告决定采纳项；② 若做 P0：X1（startGoalPlanning 锁内补活跃 goal re-check，约 5 行 + 并发用例）与 X2（clear/summary/compact 分支移到 GOAL_ACTIVE 之后或 clear 终态化 + 用例）；③ P1 清单见报告第九节；④ 上一轮 goal-ui-p0-budget-120 的浏览器视觉验收仍待用户。

---

## 上一轮交接：goal-ui-review-optimization-example Goal UI 评审与优化示例（needs-review，待用户验收）

- 当前目标：响应用户浏览器验收反馈（右侧边栏大量样式问题、说明性文字过多），产出完整评审 + Before/After 优化示例；不修改生产代码。改动仅 2 个新交付物 + 3 状态文件，`src/`、`server/`、`tests/`、`dist/` 等均未触碰，无 commit。
- 产物：`docs/reviews/goal-ui-review.zh-CN.md`（四 surface 完整评审，G/S/C/K/T 问题编号体系，设计语言对照表，P0/P1/P2 路线图，全部 文件:行号 引用经父 Agent 亲自核实）+ `design-mockups/goal-inspector-optimization.html`（自包含 Before/After：滚动、token 按钮、状态 badge、时间/预算本地化、Note 一行 + ? 浮层、确认组容器、控制条极简；主题/宽度/状态切换）。
- 核心结论：右侧边栏 3 高危（G-01 内容链路无滚动被裁剪、G-03 按钮体系脱节、G-04 textarea 260px）+ 8 中 + 5 低；说明性文字 100 key 中 25 条、Note 3 条连排且聊天卡/侧栏同屏双份（K-01）；收敛策略 T-A~T-G 对齐 DESIGN_LANGUAGE L187-191。修正：G-02（动作行溢出）经 goal.ts 谓词核实不实际发生，下调为中优健壮性问题。新发现 C-02：控制条实现与自身设计注释矛盾（objective 全文 + 时长进单行，注释却承诺 objective 归摘要视图）。
- 验证：内联 JS vm.Script 语法通过；无外部资源全 0；getElementById 9 引用全定义；fake DOM 动态冒烟 9/9；feature_list.json JSON.parse 通过。真实浏览器视觉/交互待用户验收。
- Blocker：无。
- 下一步：① 用户浏览器打开示例（340/420、亮/暗、两状态）+ 阅读报告，确认优化方向；② 确认后另开 feature 落地生产修复（建议 P0：G-01/G-03/G-04 + T-A/T-B）；③ G-16 外壳问题（Tab 关闭 hover、aside 分隔线、pr-[5.5rem]）另开 feature。

---

## 上一轮交接：goal-pinned-summary-interaction-prototype Goal 置顶摘要交互设计原型（2026-09-10，needs-review，待用户视觉验收）

- 当前状态：设计原型完成，三份状态文件已记录，feature 标 `needs-review`——明确待用户视觉验收，不偷标 done，也不把既有中优先级问题标为已解决。未 commit（原型文件当前为未跟踪状态）。
- 授权与范围（用户明确）：本 feature 只是设计原型对齐，不做生产落地；不改生产组件/后端/依赖，不跑生产整套 test/lint/build。
- 产物与覆盖：`design-mockups/goal-pinned-summary.html`（自包含中文 HTML/CSS/JS/SVG，无外部资源/网络调用）——置顶摘要三态（关闭/胶囊/面板）+ 移动端弹层；输入框上方状态短标识 + pause/resume + 打开摘要两个 icon（无 more 完整卡）；胶囊短目标/状态/验收数；面板验收详情折叠 + 阶段主操作；more 编辑/取消；编辑 dirty 保护；pause → pausing(800ms) → paused（pausing 期间暂停 icon 真实 disabled、aria-disabled 同步）；审批/问答聊天样例不自动授权（拒绝工具→paused 且进展/验收数不变）；accept 一次完成、continue 保留进度；取消不回滚 + 确认态焦点圈闭；预算 8 轮 / 30 分钟；设计说明独立于产品 UI。
- 改动文件（1 交付物 + 3 状态文件）：`design-mockups/goal-pinned-summary.html`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证（2026-09-10，针对最终修订版；两类结果分开记）：**父 Agent 独立静态**——内联 JS `node --check` 通过；67 个唯一 id 全部有定义、50 处 `getElementById` 引用零缺失；无外部资源与网络/API 调用（http(s) 0 命中、无 fetch/XHR）；改动范围仅 4 文件（原型 + 3 状态文件）；`feature_list.json` JSON parse 与 `git diff --check` 通过。**委派动态**（Node VM + 最小 fake DOM，父 Agent 转述）——最终 54 条断言全部通过，分组 R1 15 / R2 12 / R3 10 / R4 7 / R5 10，覆盖输入框上方 2 icon 控条（含 pausing 的 disabled/aria-disabled 同步）、胶囊短目标/状态/验收数、pause→pausing(800ms)→paused 时序、continue 与工具被拒后进展/验收数保持不变、拒绝工具→paused、blocked 详情展开、accept 一次完成、编辑 dirty 保护、取消确认态焦点圈闭与 Tab/Escape 模拟。最终修订已修 pausing 的 aria-disabled 同步与「拒绝工具→paused」。旧版草稿的 686 条断言属修订前历史结果，不作为最终依据。展示文件由父 Agent 用 present_files 交付。
- Blocker：无（动态断言已完成；真实浏览器/CSS 布局/屏幕阅读器/中文输入法（IME）视觉验收仍未完成）。
- 未做（明确不宣称）：真实浏览器、CSS 布局、屏幕阅读器与中文输入法（IME）实测；无网络、真实 API 与真实模型；未跑生产整套 test/lint/build（本轮无生产代码变更）。
- 边界：未改生产源码/依赖/生成产物（`dist/`、`package-dist/`、`package-offline/` 未触碰），未 commit/tag/push；不改之前 feature 状态、保留历史；既有中优先级遗留问题（同 session 并发、clear/compact 守卫、retry 生命周期、SSE 快照卡片刷新、验收证据一致性等）仍开放；无需生产 Wiki 同步（仅设计产物，未变公共入口）。
- 下一步：① 用户视觉验收该 HTML（摘要三态、输入框上方 icon、胶囊信息、面板折叠与主操作、pause→pausing→paused 时序与拒绝工具→paused、编辑 dirty 与取消语义、焦点圈闭、预算文案），并补真实浏览器/屏幕阅读器/中文输入法（IME）验收；② 验收通过后再决定是否另开 feature 推进生产落地。

---

## 上一轮交接：ai-goal-objective-edit-actions 高优先级按钮问题修复（2026-09-10，needs-review，仍待用户验收）

- 当前状态：代码完成、独立评审无阻断、父 Agent 针对性验证通过，feature 标 `needs-review`（代码/自动验证通过待用户验收，不宣称整个 Goal 已无缺陷）。未 commit（遵循项目规则，等待用户指示）。
- 目标与范围（用户明确）：本轮 Goal 只修高优先级按钮问题——goal 卡「修改目标/确认」按钮 disabled 只在整卡重渲染时按当时的 draft 计算，导致输入过程中状态不同步、点击时可能拿过期状态。上轮评审六项问题中的其余五类中优先级问题仍未修（见 feature_list.json boundaries）。
- 改动文件（仅 2 个代码/测试 + 3 状态文件）：`src/components/chat/panel-decoration/goal-card.ts`、`tests/frontend/goal-card-controller.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 关键设计：输入事件改为局部同步 dirty 相关按钮、不重建输入节点（textarea 节点/value/focus/选区保留属「输入不重绘」的代码保障，未做真实浏览器实测；`syncDraftActions` 闭包按 render 隔离，旧输入节点的处理器不更新新按钮）；按钮新增 `disabledForDraft(dirty)` 仅由输入事件调用（dirty 实时由 `editing && draftObjective.trim() !== view.objective.trim()` 推导），click 不重求 `disabledForDraft`，过期 confirm 提交由 `objectiveDirty()` 实时 return 防线拦截；dirty 按钮在 awaiting_confirmation/paused/blocked 各状态按同一规则 re-arm，草稿回退后 confirm 自动恢复。
- 测试：新增 6 条 controller 行为测试（输入即时启用 revise / dirty 时 confirm 不可用并回退 re-arm / 过期 confirm 点击被拒 / in-flight 重复鼠标提交与 Ctrl+Enter 被阻断等）。
- 验证（父 Agent 针对性）：`npx vitest run tests/frontend/goal-card-controller.test.ts tests/frontend/goal-card.test.ts tests/frontend/goal-state.test.ts` **3 files / 54 tests passed**（controller 19 / card 20 / state 15）；两改动文件 `npx eslint` **0 error**；`npx tsc -b` 无错误；JSON parse 与 `git diff --check` 通过。子 Agent 委派：先红（4 失败）后绿，`npx vitest run tests/frontend` **149 files / 1667 tests passed**。未跑全套 build。
- Blocker：无。
- 未做（明确不宣称）：真实浏览器焦点/选区实测与 IME 组合输入实测——测试用最小 fake DOM，仅断言输入过程未替换输入节点、未写入选区。
- 边界：未改架构/状态机/API 契约/i18n/视觉，无需更新 wiki；未改后端/依赖/生成产物；未 commit/tag/push。
- 下一步：① 浏览器真实输入冒烟（中文输入法、光标/选区、dirty 时 confirm 置灰、回退后恢复、点击无误提交）；② 用户验收后决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。
- 上一轮：ai-goal-mode（done，详见下方摘要与 progress.md）。

---

## 上一轮交接：goal-ui-p0-budget-120 Goal UI 生产落地 + 预算 120 分钟（done，实现与全量自动验证完成，浏览器待验收）

- 当前目标：按已验收的评审/示例方向落地生产（P0+G-09+C-02）并把预算默认时长 30→120 分钟（追加 +120 跟随默认、轮次 8 不变）。实现与父 Agent 最终全量验证完成，未 commit，浏览器视觉验收待用户。
- 改动文件（22 个，完整清单见 feature_list.json）：预算（server/agent-goal-state.mjs、src/lib/goal.ts、3 个测试、wiki 6 处）；侧栏（GoalInspectorContent.tsx、goal-inspector.css 重写）；控制条（goal-control-strip.ts、src/index.css）；i18n（+16 key/-1 key/改 1 key）；测试（goal-budget-inspector/goal-control-strip/goal-inspector-lifecycle 重写或增补）；CHANGELOG [Unreleased] Changed；三状态文件。
- 父 Agent 审查要点：重构后组件 abort/focus/Escape 契约逐行核对保留；删除了子 Agent 实现中状态行与提示行重复的第二个 ? 浮层（唯一入口在状态行，edit 视图可达）；CSS token 引用全部存在；控制条 objective 六处移除干净。
- 最终验证：npm run test 315 files / 3381 tests 退出码 0；lint 0 error（仅既有 identity.mjs warning）；build 退出码 0（仅既有警告）。
- Blocker：无。
- 已知残留（下轮候选）：popover note 文案「上方的卡片」语境（G-10/T-E，涉及聊天卡 view model 共享）；tone 色值三处复制（C-01 token 全局化）；K-01 聊天卡 Note 双显；G-16 外壳三问题；formatGoalTime 可精简为相对时间；S 系列/字号单位/阴影等 P2 打磨项。
- 下一步：① 用户浏览器验收（侧栏滚动/动作栏/状态行 ? 浮层/badge/计量条/控制条单行/预算 120 分钟展示）；② 验收通过后决定 commit（发布走 docs/architecture/patch-release-runbook.zh-CN.md）。

---

## 上一轮交接：goal-budget-extension-resume（done，实现与全量自动验证完成，浏览器待验收）

- 当前目标：预算耗尽后显式追加默认额度、恢复同一 Goal；实现与父 Agent 最终全量自动验证完成，标记 done，浏览器验收尚未完成。本子任务仅同步三状态文件。旧交接保留历史，旧无 CAS/取消重建描述不代表新追加动作。
- 契约：`extend_resume` 只接收 `{action,goalId,expectedRevision}`（revision 正 safe integer）；仅该动作锁内 CAS，旧请求不重复追加，其他动作不泛化 CAS。耗尽维度 +8 轮/+30 分钟，usage/计划证据保留；同次 persist 成功后才恢复。仍不足 paused 不调度；足够后无计划 planning、未确认 awaiting_confirmation、已确认 running。planConfirmed 持久化仅 confirm 置 true，revise/plan 清 false；旧 planning/awaiting_confirmation 强制 false，其余优先显式布尔值、缺字段以 usage.iterations > 0 兼容。统一预算 gate 防错误越额续跑，旧 resume 耗尽仍409但有新出口。
- 前端：Inspector 内联确认真实 usage/额度/增量，运行条耗尽继续转 progress；预检绑定旧 revision，失败权威对账、不盲重发；关闭只取消未发 POST，已发不可撤回、等待结算再释放锁。不会隐式确认计划。
- 相关实现：`server/{agent-goal-state,agent-goal-runner}.mjs`、`server/routes/agent.mjs`；`src/lib/{goal,server-agent,deferred-session-agent,i18n}.ts`、`src/components/workspace/GoalInspectorContent.tsx`、`src/components/chat/panel-decoration/{goal-control-strip,goal-card}.ts`。测试：`tests/server/{agent-goal-state,agent-goal-runner,agent-goal-manager}.test.mjs`、`tests/server/routes/agent.goal.test.mjs`、`tests/frontend/{goal-budget-inspector,goal-state,server-agent,goal-control-strip,goal-card,goal-card-controller,goal-ui}.test.ts`。完整清单见 feature_list.json，30个文件已核实存在。
- 本次最终同步仅改 `feature_list.json` / `progress.md` / `session-handoff.md`；此前六份 Wiki README（总入口、server、server/routes、src、src/lib、src/components）已同步，无需再次修改。保留历史、不改生产/测试。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，315 files / 3377 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体解析与 chunk 体积 warning。此前子 Agent 定向后端166/前端270 tests通过，不替代最终全量结果。本子任务未重跑生产测试；浏览器视觉、真实交互/IME/焦点未验收。
- Notes：旧 pendingDisposition 优先于 error 仅落 needs_review、非 completed，本轮未修、不扩范围。
- Blocker / 下一步：实现与最终全量自动验证完成，done 不表示浏览器验收完成；仍需浏览器视觉、真实交互/IME/焦点验收。未新增/升级依赖、无 Git commit/tag/push/发布、未手工修改生成产物 `dist/`/`package-dist/`/`package-offline/`。

---

## 上一轮交接：goal-inspector-progress-editor Goal 侧栏进度/编辑重设计（done，实现与全量自动验证完成，浏览器视觉未验收）

- 当前目标/状态：实现与父 Agent 最终全量自动验证已完成，标记 `done`，用户视觉与真实浏览器验收尚未完成；依赖 `goal-pinned-summary-production-ui`。本次委派仅同步三状态文件，保留已有生产改动和所有历史 feature 状态，无 commit。
- 当前路径：运行条真实状态/已记录累计时长 + 取消/暂停或继续/编辑三个 icon → 编辑打开侧栏 edit；摘要两行纯导航 → 侧栏 progress。`GoalInspectorContent` 统一进度、验收、阶段动作与编辑，Workspace Inspector Tab 按 session + goal 复用、仅 runtime、不持久化。
- 安全边界：`goal-ui` 保留运行中草稿与外部冲突 dirty 文本，dirty 允许 pause/cancel。`goal-edit` 经用户确认 pause，等待权威 paused 且非 streaming 再 revise；App 绑定 `refreshGoalForSave` 单次严格快照。关闭侧栏的 layoutEffect 取消后续等待/尚未派发保存，已发 POST 不能撤回且须结算后才释放锁；不自动 confirm/resume、不重试 POST。Goal 动作 API 无客户端 revision CAS，不保证跨客户端原子性，也不保证服务端拒绝所有外部冲突；检测到冲突或服务端返回错误时保留草稿并报错。
- 本次改动文件：仅 `feature_list.json`、`progress.md`、`session-handoff.md`；此前四份 Wiki（根、src、src/components、src/lib 的 README）已同步，无需再次修改。相关实现（已核实路径存在）：`src/App.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/components/chat/panel-decoration/goal-control-strip.ts`、`src/components/git/{GoalSummarySection.tsx,goal-summary.css,GitToolsPinnedSummary.tsx}`、`src/components/workspace/{WorkspaceInspector.tsx,GoalInspectorContent.tsx,goal-inspector.css,workspace-types.ts,workspace-inspector-tabs.ts,workspace-inspector-request.ts}`、`src/lib/{goal-ui.ts,goal-edit.ts,server-agent.ts,i18n.ts}`、`src/index.css`。测试：`tests/frontend/{goal-edit,goal-ui,goal-inspector-lifecycle,goal-inspector-tabs,goal-control-strip,goal-summary-section,git-tools-pinned-summary,server-agent}.test.ts`；完整清单见 `feature_list.json`。
- 最终验证（父 Agent 实际执行）：`npm run test` **退出码 0，314 files / 3292 tests passed**；`npm run lint` **退出码 0**，仅既有 `server/cloud/identity.mjs:92` no-useless-assignment warning；`npm run build` **退出码 0**，仅既有 KaTeX 字体解析与大 chunk warning。本次状态子任务不重跑生产测试。历史记录：最后修复前父 Agent 313 files / 3288 tests passed，子 Agent 定向 5 files / 141 tests passed、lint/build 通过，不替代最终全量结果。
- Notes：此前一次全量在 `qf-agent-process.test.mjs:269` 重启 timer 测试失败，未改相关源码原样复跑全绿；未定位根因、不标已修复，不扩大范围。
- Blocker / 下一步：实现与自动验证无待办；用户仍需验收三 icon、两行导航、progress/edit 与真实暂停保存。浏览器视觉、IME、焦点保持/关闭回焦、响应式布局仍未实测；后端 CAS 属明确边界，非本轮扩展项。
- 未做：未新增/升级依赖、不改 `server/`、生成产物未手工修改、无 commit/tag/push/发布；不混入网络容错、不修无关后端问题。下方旧交接仅作历史保留，不代表当前 UI。

---

## 上一轮交接：goal-pinned-summary-production-ui Goal 置顶摘要生产 UI 落地（2026-09-10，done，实现与全量自动验证完成，仍保留用户视觉验收）

- 当前状态：原型已由用户明确确认落地，生产 UI 主路径已完成；父 Agent 完整验证通过（`npm run test` 311 files / 3263 tests、`npm run lint` 0 error 仅 1 个既有 warning、`npm run build` 退出码 0），feature 标 `done`。本会话最终一轮只做**文档/状态同步**（不改后端 `server/`）。未 commit（遵循项目规则）。
- 目标与范围：完整 Goal 卡不再由 `ChatPanelHost` 挂载，旧 `panel-decoration/goal-card.ts` controller/viewmodel 保留兼容（`buildGoalCardViewModel` 仍是三 surface 共用纯投影）；生产主路径 = 置顶摘要置顶的 Goal 首分区（`git/GoalSummarySection.tsx` + `goal-summary.css`）+ 输入框上方控制条（`panel-decoration/goal-control-strip.ts`，单行状态 + pause/resume + 打开摘要两个 icon）。摘要在只有 goal 的会话也挂载（goal-only），胶囊首段为「目标·真实状态·已验收准则数」再接任务/文件/智能体段（总段数截断 3）；控制条固定插在 composer shell 首位，不插进 TodoWrite 摘要/排队消息锚点之间；主会话门禁排除 ACP，控制条再加 `capabilities.goal`、非共享页、非 side chat；其他 surface 经 `quickforge:open-goal-summary` 打开摘要，`App` 只认当前会话 + 当前 goal 并先关闭已打开的 Workspace Inspector。
- 关键设计：新增 `src/lib/goal-ui.ts` 按 `sessionId + goalId` 持有 pending/dirty/error/草稿，三 surface 同源锁（脏草稿除 `revise` 全拒并写原因，失败广播不抛出）；草稿连 `editing` 存 store（基线为服务端 objective），`retainGoalUi`/`releaseGoalUi` 让关闭摘要、最小化、桌面↔移动重挂后重开恢复同一文本与 dirty 锁（`clearGoalUi` 才丢弃，无人挂载草稿 LRU 最多 6 份）；取消确认是内联行（焦点进入「继续工作」，Escape 只关该行/菜单并把焦点还给触发按钮）。控制条不复制原型 800ms 假延迟：pause 直接 POST 真实后端，`pausing` 为服务端真实状态；goal 快照/`goal_updated` 只推进独立 `goalSeq` 水位（同 id 比 revision、跨 id/清空比水位），HTTP 动作响应与 `/state` 刷新带请求前水位做竞态守卫，只有真正改变 goal 才广播，且**不**推进消息 `stateVersion`（避免作废在途消息对账）。
- 改动文件（最终一轮文档/状态同步，均在本 feature 允许清单内）：`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`（本 feature 早前轮次另含 `docs/wiki/README.md`）。被文档描述的生产改动（实现）：`src/components/git/GoalSummarySection.tsx`、`src/components/git/goal-summary.css`、`src/components/git/GitToolsPinnedSummary.tsx`、`src/components/chat/panel-decoration/goal-control-strip.ts`、`src/components/chat/panel-decoration.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/App.tsx`、`src/lib/goal-ui.ts`、`src/index.css`、`src/lib/server-agent.ts` 及 5 份前端测试；完整清单见 `feature_list.json`。
- 验证（父 Agent 完整验证，全部通过，2026-09-10）：`npm run test` 退出码 0，**311 files / 3263 tests passed**；`npm run lint` 退出码 0，**0 error**（仅 1 个既有 warning `server/cloud/identity.mjs:92` no-useless-assignment，与本 feature 无关）；`npm run build` 退出码 0（TypeScript 类型检查与 Vite 生产构建通过，仍有既有 KaTeX 字体路径未构建解析警告与大 chunk 体积警告）；子 Agent 针对性回归 `npx vitest run tests/frontend/goal-control-strip.test.ts tests/frontend/goal-summary-section.test.ts tests/frontend/goal-ui.test.ts tests/frontend/goal-card.test.ts tests/frontend/goal-card-controller.test.ts tests/frontend/goal-state.test.ts` → **6 files / 113 tests passed**（control-strip 20 / summary-section 20 / goal-ui 17 / goal-card 22 / card-controller 19 / goal-state 15）；`feature_list.json` JSON parse 与 `git diff --check` 通过。
- 收尾修复（已并入并有测试覆盖）：① `syncGoalUiState` 由 `App` 的 effect 在每次 goal 变化时调用（非可编辑状态或 objective 被替换清旧 draft/dirty，保留真实 in-flight pending）；② 关闭/重挂只在同一可编辑目标下保留草稿；③ 被移除的焦点节点回填到摘要入口或 composer 编辑器；④ `server-agent` 的 `/state` 消息版本早退只允许「同 goal id + 严格更高 revision + `goalSeq` capture 未变」的 goal 独立采纳，跨 id/`null` 不越过 guard。
- Blocker：无。待办仅剩用户浏览器验收。
- 未做（明确不宣称）：真实浏览器实测（摘要三态与 goal-only 布局、控制条两个 icon 与 `pausing` disabled、焦点圈闭、屏幕阅读器、中文输入法 IME、pause 的真实后端时序）均属代码/单测保障；无依赖变更、未 commit/tag/push、未发布 npm、未手工修改 `dist/`、`package-dist/`、`package-offline/`。
- 边界：保留旧记录——`goal-pinned-summary-interaction-prototype`（needs-review）与 `ai-goal-mode`（done）状态不擅改。Notes：上轮六类中优先级问题中 SSE 快照卡片刷新已补，其余四类后端旧问题（同 session 并发、clear/compact 守卫、retry 生命周期、验收证据一致性）仍不修、不标已解决；消息版本回退属广义 SSE epoch/消息对账基础设施问题，本轮不扩、不声称已解决。
- 下一步：① 用户浏览器验收（摘要三态与 goal-only、控制条、胶囊、编辑 dirty 跨挂载保留、取消内联确认、pause 真实时序）；② 验收通过后决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。

---

## 上一轮交接：ai-goal-mode Goal 模式（2026-09-10，done）

- 当前状态：服务端/前端实现、测试、wiki 文档全部完成，父 Agent 完整验证通过（`npm run test` 308 files / 3180 tests passed、`npm run lint` 0 error 仅 1 个既有 warning、`npm run build` 成功仅既有 KaTeX 字体与大 chunk 警告、`git diff --check` 通过、`git status` 无生成产物变更），feature 已标 `done`。未 commit（遵循项目规则，等待用户指示）。
- 目标：主聊天 `/goal <目标>` 先只读规划、用户 `confirm` 后有限轮执行，最终 `needs_review` 交回用户——`accept` 是唯一人审完成动作，`resume` 只继续执行；模型不能自行验收。
- 改动文件：新增 `server/agent-goal-state.mjs`、`server/agent-goal-runner.mjs`、`src/lib/goal.ts`、`src/components/chat/panel-decoration/goal-card.ts` 及 4 份服务端/3 份前端测试；改动 `server/agent-manager.mjs`、`server/agent-persistence.mjs`、`server/agent-prompt-commands.mjs`、`server/agent-approval-orchestrator.mjs`、`server/approval-store.mjs`、`server/custom-commands.mjs`、`server/routes/agent.mjs`、`server/routes/shared-conversation.mjs`、`server/tools/definitions.mjs`、`src/lib/server-agent.ts`、`src/lib/deferred-session-agent.ts`、`src/lib/chat-capabilities.ts`、`src/lib/i18n.ts`、`src/components/chat/{ChatPanelHost.tsx,panel-decoration.ts,command-suggestions.ts}`、`src/index.css` 及关联测试；wiki 6 份 + 三份状态文件。完整清单见 `feature_list.json`。
- 关键设计：预算默认 8 轮 / 30 分钟累计活跃（`revise` 保留累计用量，耗尽 `resume` 409 提示 cancel 新建）；每轮仅在运行真正结束且最终状态持久化成功后调度下一轮（fail-closed）；显式 settle barrier + abort generation 观测中止；goal body 随会话 CAS 持久化、重启 in-flight→`paused` 不自动重放；同一规范化工作区路径互斥；`goal_report` 会话专用（不在 `workspaceTools`/`GET /api/tools`、无 REST handler），证据只信任真实成功工具结果的 `toolCallId`，human 证据只由用户 `accept` 写入。
- 验证（父 Agent 完整验证，全部通过）：`npm run test` 退出码 0，308 files / 3180 tests passed；`npm run lint` 退出码 0，0 error（仅 1 个既有 warning `server/cloud/identity.mjs:92`），与本 feature 无关；`npm run build` 退出码 0（TypeScript 与 Vite 通过）；`git diff --check` 通过；`git status` 无 `dist/`、`package-dist/`、`package-offline/` 变更。cancel/settlement 收尾竞态已修复并有测试覆盖。未做浏览器 E2E、未做真实模型实测。
- Blocker：无（cancel/settlement 收尾竞态已修复并有测试覆盖）。
- 下一步：① 浏览器真实模型验收——`/goal` 规划→确认→执行→人审双按钮（accept/resume）→暂停/继续/修改/取消；② 用户决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）。
- Notes：`server/context-references.mjs` 会话级残留 `modelAccessContext.source === 'shared'` 可能误拒 owner 首条带引用 prompt，另行 feature，本轮未修。
- 上一轮：subagent-run-detail-model-thinking（详见 progress.md）。

---

## 上一轮交接：subagent-run-detail-model-thinking 已完成（2026-09-09，done）

- 当前状态：代码、测试、文档完成；定向前端 99 tests、服务端 14 tests、`npm run lint`（0 error）、`npx tsc -b`、`npm run build` 全部通过；未 commit（遵循项目规则，等待用户指示）。
- 需求：点击 subagent 摘要打开的运行详情页（Workspace Inspector `kind:'subagent'` Tab）展示本次运行实际使用的模型与思考等级，范围仅详情页。样式两轮调整（用户确认）：最终为任务说明块上方独立一行、居中，只显示「模型名 · 思考等级」，不带标签与继承标记。
- 改动文件（7，i18n 无净新增）：`server/agent-subagent-runner.mjs`（新增 `subagentRuntimeDetails`，三处 details 展开）、`src/lib/subagent-run-detail.ts`（新增类型/payload 字段/解析/`'meta'` block/两个展示纯函数）、`src/lib/local-tools.ts`（新增 `renderSubagentRunMeta`，任务说明块上方独立一行居中）、`tests/frontend/subagent-run-detail.test.ts`、`tests/server/agent-manager.subagents.test.mjs`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`。
- 关键设计：服务端继承模型时补 `provider/id/name`（旧快照只有 `{mode:'inherit',inherited:true}`）；thinkingLevel 复用主 Agent i18n；meta 块不受 `detailed` 门控；产出条件为「有可显示模型标识或 thinkingLevel」（父 Agent 审查时修复的空块缺陷，已加回归用例）；渲染层 meta 独立于任务气泡，位于其上方一行。用户反馈「没看到思考等级」：该字段只对改动后新产生的运行生效，历史 details 无此字段，需重启 dev server 重跑验证。
- Blocker：无。
- 下一步：① 浏览器冒烟——点开运行中/已完成 subagent 详情，任务气泡顶部居中显示「provider / id · 高」，非推理模型显示「关」，长任务收起/展开不遮挡该行；② 用户决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）；③ 工作区仍有他人未提交 WIP，提交时注意分离。

## 前一会话状态：chat-message-queue（已完成）

- 目标：为聊天 Composer 增加「排队 + 插队」——AI 回合运行期间继续输入的消息进入队列、回合结束后按序自动发送；队列项可「立即」在当前工具轮结束后注入进行中回合。先出 `design-mockups/message-queue.html` 交互稿，用户手动验证通过后实现。
- 实现：新增 `src/lib/message-queue.ts`（纯函数队列操作 + localStorage 持久化 + steer 客户端，175 行）与 `src/components/chat/panel-decoration/message-queue.ts`（面板 controller，385 行）；`ChatPanelHost.tsx` 接入 capture-phase Enter 入队、decorate 更新、`agent_end` 冲刷/暂停分支、会话恢复与卸载保存；`todo-write-summary.ts` 锚点容忍相邻队列面板防抖动交换；capabilities 新增 `messageSteering`（QuickForge true / Side Chat、OpenCode false）；i18n 双语 15 key；index.css 追加 `.quickforge-msg-queue*` 样式段；panel-decoration 桶文件导出。插队走既有 `POST /api/agents/:id/steer`（pi-agent-core steering 在轮间 drain，服务端零改动）；OpenCode/Side Chat 通过能力位降级。
- 验证：定向 vitest message-queue(新) + todo 两件套 → 47 tests 全过；capabilities/side-chat/ChatPanelHost 引用族 6 files / 72 tests 全过；eslint 改动文件 0 error；tsc -b 通过；npm run build 成功（仅既有 warnings）。未跑全量 test/lint；未 commit/tag/push。
- 复审修订（用户截图反馈）：队头排队项去掉特殊深边框（三参 color-mix 无效回退 currentColor 所致，现与其余项一致 var(--border)）；删除「AI 结束后按顺序自动发送」文案、messageQueueAutoHint 双语 key 及相关死 CSS/DOM 属性；复验 eslint/定向 vitest 37 tests/tsc/build 全过。
- 拖拽排序设计稿轮次：应要求设计排队项拖动排序，`design-mockups/message-queue.html` 已扩展可操作演示（⠿ 手柄、幽灵跟随、占位换位、边缘自动滚动），浏览器自动化实测换位/序号刷新/无残留全过；修复 move/up 事件路由（改挂 window capture）与 ghost 清理两个 bug。mockup 内「自动发送」hint 文案已同步删除。
- 拖拽排序组件落地（Revision 3）：`message-queue.ts` 新增 beginRowDragSession 指针 mini-sortable（window capture 三监听、6px 阈值、占位+幽灵换位、边缘自动滚动），lib 新增 moveQueuedMessage 纯函数，CSS/i18n（DragTitle 双语）同步；验证 4 files / 57 tests 全过、eslint/tsc/build 全过。未 commit。
- 拖拽正确性评审修复（Revision 4，用户指出实际功能不正确）：修复 4 个真 bug——①流式期间 decorate 周期 render() 无条件取消进行中拖拽（队列恰在流式期使用，拖拽必被打断；静态稿无重渲染所以没测出）→ 拖拽会话存续期间挂起重渲染、会话结束统一从权威 items 重建；②取消的拖拽遗留脏行序不复位 → 同一重建路径修复；③拖拽会话为模块级全局、跨控制器实例误杀 → 改为每控制器持有（beginRowDragSession 工厂返回 {cancel}，onCommit/onEnd 回调）；④流式期间行内编辑被重渲染冲掉（重置为已提交文本+抢焦点）→ 编辑输入框跨重渲染保值/保焦点/保光标（dataset.queueItemId 同项判定）。复验 4 files / 59 tests、eslint/tsc/build 全过。未 commit。
- 「立即」插队乐观显示（Revision 5，用户提出点击后马上显示）：`ServerAgent.steer(message)` 改 async——点击即乐观把 user 消息追加进 state.messages 并 emit message_start（面板立即渲染），POST 同一消息对象（客户端 timestamp）；服务端在工具轮边界注入同一消息经 message_end 回显，upsertMessage 按 role+timestamp 原位替换乐观副本不重复；HTTP 失败回滚乐观副本+二次 message_start+reject（队列项保留）。ChatPanelHost submitJump 改调 agent.steer，删除 steerSessionMessage 死代码及其测试。复验 vitest 2 files / 54 tests（server-agent 新增乐观/回滚两用例）、eslint/tsc/build 全过。未 commit。
- 提交前完整门禁（Revision 6）：完整 npm run test 暴露 todo-write-renderer 无界切片契约被追加在后的队列 CSS 污染 → 队列 CSS 段移至 todo 摘要注释之前；期间 src/index.css 曾被脚本误截断，从 HEAD + 事故前 dist 编译产物（含 @supports color-mix 原值）重建并经 bundle 逐条比对确认等价。最终门禁：260 files / 2365 tests 全过、lint 0 error、build ✓；随后 chat-message-queue 全部改动作为 feature commit 提交。
- Blocker：无。
- 下一步：可选真机冒烟（多连发排队、点「立即」消息立即出现且轮边界后不重复、停止/出错后的暂停恢复、流式中拖拽排序与行内编辑）。

---

## 前一会话：release-v1.9.1（已完成）

- 目标：按用户指令「发布版本」，以 `v1.9.0` tag 之后 dev 的 6 个提交为基线，经用户选型确认按 **patch** 发布 **v1.9.1**。
- 基线提交：cdc97d0（云设置页 URL 行重设计+删开关）、b28a4ee（状态文件记录）、2b96c30（检查更新遵循 npm registry 配置）、5905e1c（Todo 胶囊摘要）、163e637（云设置页删远程/身份/设备区块）、1c39bd9（侧栏显示更多颜色）。
- 已完成：`npm version patch` 1.9.0→1.9.1；CHANGELOG.md 新增 `[1.9.1] - 2026-08-27` 章节（Added/Changed/Fixed/Released）；README.md 当前版本徽章 → 1.9.1。
- 门禁：完整 `npm run test` → **259 files / 2349 tests 全部通过**（硬门禁）；`npm run lint` → 0 errors / 1 既有 warning（identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）。
- 打包：runtime/offline 包已生成，`package-offline/shawnstack-quickforge-1.9.1.tgz`（7.0MB / unpacked 约24MB / 453 files）；元数据校验 version 1.9.1、8 运行时 deps + @vscode/ripgrep optional、无 devDeps/scripts。
- 文件：package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- 发布序列：本变更构成 release commit（在 dev 上），随后 master `--ff-only` 快进、`v1.9.1` tag、原子推送 `master`/`dev`/tag。
- Blocker：无。剩余人工步骤：GitHub Desktop Release 与 `npm publish ./package-offline/shawnstack-quickforge-1.9.1.tgz --access public`（用户执行，需 npm 登录）。
- 下一步：无。可从 feature_list.json 选择下一个 feature；遗留决策（用户未答）：新装实例云服务默认 enabled=false 是否改为默认开启。

---

## 当前状态：plugins-remove-description（已完成）

- 目标：移除插件设置页描述文案「管理本地 QuickForge 插件。当前首版支持通过 manifest 声明并贡献 Agent 工具的插件。」。
- 实现：`PluginsPage.tsx` 删除标题下方描述行；`settings-tabs.ts` 插件项 `getDescription` 改为 `undefined`（mcp 项同先例）；`i18n.ts` 中英文成对删除 `pluginsDescription` key（grep 无残留）。
- 验证：eslint 改动 3 文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）；tests/ 无相关引用。未跑全量 test/lint。
- 文件：src/components/plugins/PluginsPage.tsx、src/lib/settings-tabs.ts、src/lib/i18n.ts、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无。上一改动 lan-access-remove-risk-warning 已提交（91d0c4d），本改动未 commit。

---

## 当前状态：lan-access-remove-risk-warning（已完成）

- 目标：移除局域网访问设置页顶部「高风险：通过密码的局域网设备可以访问你的对话、项目和可用工具。请只在可信网络中开启。」警告文案。
- 实现：`src/lib/lan-access-settings-tab.ts` render 删除 `quickforge-settings-warning` 警告 div；`src/lib/i18n.ts` 中英文成对删除 `lanAccessRiskWarning` key（grep 确认无残留）。`.quickforge-settings-warning` 样式保留（cloud/backup/skills/plugins 页仍用）。
- 验证：eslint 改动文件 0 error；npm run build 成功（仅既有 chunk size warning）；tests/ 无 lan-access-settings-tab 相关测试，未跑全量 test/lint。
- 文件：src/lib/lan-access-settings-tab.ts、src/lib/i18n.ts、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无。未 commit/tag/push。

---

## 当前状态：cloud-settings-url-row-redesign（已完成，方案 A 已实现）

- 目标：删除「登录或注册」安全说明文字与「启用云服务」开关行；Cloud API 地址行调整样式（先设计稿，用户选 A）。
- 实现：两项删除 + 方案 A 均已落地——`CloudAccountSettingsPage.tsx` URL 行改为 `quickforge-settings-row-form` 紧凑表单组（标签上置、「来源」caption 移至标签行右端、输入框通栏与「测试连接」「保存修改」同排，错误提示/重建身份入口保持下方）；`src/index.css` 新增 row-form 三条规则（纵向堆叠 / min-height 0 / 悬停不高亮）；`tests/frontend/cloud-account-settings-page.test.ts` 新增方案 A 布局源码契约 describe；设计稿 `design-mockups/cloud-url-row-redesign.html` 保留。
- 验证：定向 vitest 3 files / 23 tests 全通过（含 2 条新契约）；eslint 改动文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）。未跑全量 test/lint。
- 文件：src/components/cloud/CloudAccountSettingsPage.tsx、src/index.css、src/lib/i18n.ts、tests/frontend/cloud-i18n.test.ts、tests/frontend/cloud-account-settings-page.test.ts、design-mockups/cloud-url-row-redesign.html（新）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无。遗留决策（用户未答）：新装实例云服务默认 enabled=false 且无 UI 开关，是否改 `server/cloud/service-config.mjs` candidateFrom 默认值。下方另有并行会话条目（update-check-npm-registry-config、todo-summary-capsule-redesign），未触碰。

---

## 当前状态：update-check-npm-registry-config（已完成）

- 目标：用户询问「检查更新 npm 包更新是哪种方式、是否走接口、npm 命令检查是否更好」，调研确认当前为直接 fetch registry packument 取 `dist-tags.latest`（`server/utils/package-update.mjs`，仅读 `npm_config_registry` 环境变量、不读 `.npmrc`）；用户确认按「读取当前 npm 配置的源」落地（明确不采用 `npm view` 命令方案——更慢、依赖本机 npm、底层请求同一接口）。
- 实现：`server/utils/package-update.mjs` 新增导出 `resolveRegistry(packageName, options)`——环境变量 `npm_config_registry`/`NPM_CONFIG_REGISTRY` > 用户级 `.npmrc`（路径取 `NPM_CONFIG_USERCONFIG` 或 `~/.npmrc`；`@scope:registry` 覆盖通用 `registry` 键；容忍注释/空行/引号值；只读 registry 相关键、不触碰凭据）> 默认官方源，缺文件/空值/非法内容静默回退；`getRegistryPackageUrl` 改 async 接入，`fetchLatestVersion`/`checkForUpdates`（`/api/system/update/check`）生效，5 分钟冷却缓存不变。`bin/quickforge.mjs` 删除本地复制的 registry/fetch 副本，初始化网络代理后委托 server 模块 `fetchLatestVersion`。
- 验证：定向 vitest 1 file / 11 tests 全通过（resolveRegistry 7 用例 + fetchLatestVersion 按 npm 配置构造 URL）；eslint 3 文件 0 error；node --check 通过；真实冒烟 `node bin/quickforge.mjs check-update` 走共享模块与本机 npm 配置成功返回 latest 1.9.0。未跑全量。
- 文件：server/utils/package-update.mjs、bin/quickforge.mjs、tests/server/utils/package-update.test.mjs、docs/wiki/server/utils/README.md、docs/wiki/bin/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无（可选后续见 progress.md：packument → 轻量 `/-/package/<name>/dist-tags` 端点；bin 与 server 模块仍各有一份相同的 compareVersions 复制，本轮未动）。

---

## 当前状态：cloud-settings-remove-remote-identity-sections（已完成）

- 目标：用户确认「远程访问」「云身份」状态展示均不需要，要求下线（用户贴文中还含上一轮已删除的「绑定服务 http://127.0.0.1:5176/」，属旧构建/未刷新界面）。
- 实现：`CloudAccountSettingsPage.tsx` 整块移除远程访问 section（标题/描述/Agent 状态徽标/授权提示/错误警告）及 remoteStatus 轮询等全部关联逻辑，不再请求 `/api/cloud/remote-status`；「云身份」section 去掉头部状态行与警告，连接后仅保留邮箱/套餐、额度、退出登录行，未连接时不渲染。`cloud-account-settings-state.ts` 移除 shouldPollCloudRemoteStatus/getCloudRemoteAuthorizationUi/getCloudAccountViewState；`i18n.ts` 中英文成对删 31 个 key（cloudSessionServiceMismatch 保留供错误码映射）；两个测试文件同步；docs/wiki src/README.md 与 components/README.md 已同步。cloud-client.ts API 绑定与服务端 remote-status/installations 端点保留。
- 验证：定向 vitest 3 files / 21 tests 全通过；eslint 5 文件 0 error；tsc -b 通过；删除标识符/key 无残留。未跑全量。
- 文件：src/components/cloud/CloudAccountSettingsPage.tsx、src/components/cloud/cloud-account-settings-state.ts、src/lib/i18n.ts、tests/frontend/cloud-account-settings-page.test.ts、tests/frontend/cloud-i18n.test.ts、docs/wiki/src/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无。注意本文件下方另有并行会话的 todo-summary-capsule-redesign（设计稿待用户确认）条目，未触碰。

---

## 当前状态：todo-summary-capsule-redesign（已完成）

- 目标：优化输入框上方 TodoWrite 任务摘要 UI——未展开时收缩成一个显示进度的胶囊（水平居中），展开/收起带动画过渡；先设计稿确认后实现。
- 实现：`todo-write-summary.ts`（311→360 行）toggle 外加居中 `.quickforge-todo-summary-toggle-row`，toggle 子元素一次性持久（ring + heading + stats + stats-compact(aria-hidden) + updated + spacer + chevron），弧进度经内联 `--quickforge-todo-ring-offset` CSS 变量驱动，root 增 data-complete/data-running；`index.css` 整段替换 todo 摘要样式——胶囊⇄整行形态过渡（flex-grow 0→1 插值、圆角/背景/文字交叉淡化、grid-rows 0fr→1fr、列表项阶梯淡入、箭头旋转），body hidden 即时赋值 + `allow-discrete` display 延迟 + `@starting-style` 进入动画，环双 SVG grid 同格叠放（无 absolute，保住 renderer 测试的正常流契约），reduced-motion/移动端同步。wiki 两处同步。
- 验证：定向 vitest 3 files / 58 tests 全通过（todo-write-summary 新增 5 个胶囊结构用例）；eslint 0 error；tsc -b 通过；npm run build 成功，dist CSS 保留 @starting-style/allow-discrete/ring-offset。设计稿阶段经临时 HTTP 服务 + IAB 交互断言。未跑全量 test/lint。用户追加完成态绿色对勾（复用 slash agent chip emerald：浅 rgb(4 143 101)/深 rgb(110 231 183)）后复跑 todo-write-summary + todo-write-renderer 2 files / 36 tests 全通过（renderer 新增绿色双主题契约用例）、eslint 0 error。
- 文件：design-mockups/todo-capsule-summary.html、src/components/chat/panel-decoration/todo-write-summary.ts、src/index.css、tests/frontend/todo-write-summary.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无 blocker；可选真机目视深浅主题动画效果。未 commit/tag/push。

---


## 当前状态：cloud-settings-remove-devices-simplify（已完成）

- 目标：用户要求云服务设置页移除「绑定服务 http://127.0.0.1:5176/」展示、去掉设备管理并精简界面。
- 实现：`CloudAccountSettingsPage.tsx` 删除远程访问区的绑定服务 URL 行与 Agent PID 行（保留标题/描述/状态徽标/授权提示/错误警告），整块移除「已连接设备」管理区块及 revoke/installation 辅助逻辑；`cloud-account-settings-state.ts` 详情加载与状态移除 installations（cloud-unavailable 判定 3→2 全失败）；`i18n.ts` 中英文成对删除 13 个设备 UI 专属 key；两个测试文件同步更新。cloud-client.ts API 绑定、服务端 /api/cloud/installations 端点、移动端 CloudRemotePage 设备列表均保留（远程连接功能仍需）。
- 验证：定向 vitest 3 files / 27 tests 全通过；eslint 5 文件 0 error；tsc -b 通过；删除 key 无残留引用。未跑全量。
- 文件：src/components/cloud/CloudAccountSettingsPage.tsx、src/components/cloud/cloud-account-settings-state.ts、src/lib/i18n.ts、tests/frontend/cloud-account-settings-page.test.ts、tests/frontend/cloud-i18n.test.ts、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无。

---

## 当前状态：sidebar-show-more-muted-color（已完成）

- 目标：用户反馈项目会话列表「显示更多」颜色太深、与会话标题区分不开，应对齐「项目」分区标题的灰色。
- 实现：ChatSidebar.tsx 的 SessionDisplayControls（项目视图/时间线/全局对话三处共用）按钮 resting 色 `text-muted-foreground/60`→`/50`（与分区标题一致、与会话标题 `/70` 拉开差距），hover `/80` 保留；tests/frontend/sidebar-section-order.test.ts:198 硬编码断言同步更新。
- 验证：定向 vitest sidebar-section-order → 1 file / 18 tests 全通过；eslint 两个改动文件 0 error。未跑全量。
- 文件：src/components/sidebar/ChatSidebar.tsx、tests/frontend/sidebar-section-order.test.ts、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：无。

---

## 当前状态：release-v1.9.0（已完成）

- 目标：按用户指令「发布一个版本」，在 `v1.8.1` tag 之后以 dev HEAD（2dd87cb，11 个新提交）为基线发布 **v1.9.0（minor，用户确认）**；npm 1.8.1 从未发布，用户决策跳过、由 1.9.0 直接取代。
- 已完成：`npm version minor` 1.8.1→1.9.0；CHANGELOG.md 顶部新增 `[1.9.0] - 2026-08-26` 章节（基于 v1.8.1..HEAD 11 个提交：文档预览+移动端 H5、Monaco 本地打包、SSE/Cloud/git 状态修复、SQLite persist 优化与 synchronous=NORMAL、vendor node-pty、包体裁剪、todo 图标）；README.md 版本徽章 → 1.9.0。
- 门禁：完整 `npm run test` → **259 files / 2340 tests 全部通过**（硬门禁）；`npm run lint` → 0 errors / 1 既有 warning（identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX/chunk size warnings）。
- 打包：runtime/offline 包已生成，`package-offline/shawnstack-quickforge-1.9.0.tgz`（7.4MB / unpacked 24.2MB / 453 files）；元数据校验 version 1.9.0、8 运行时 deps + @vscode/ripgrep optional。
- 文件：package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- 发布序列：本变更构成 release commit（在 dev 上），随后 master `--ff-only` 快进、`v1.9.0` tag、原子推送 `master`/`dev`/tag。
- Blocker：无。剩余人工步骤：GitHub Desktop Release 与 `npm publish ./package-offline/shawnstack-quickforge-1.9.0.tgz --access public`（用户执行，需 npm 登录）。
- 下一步：发布完成后新会话从 `feature_list.json` 选择下一个非 done feature。

---

## 当前状态：git-status-connection-pool-guard（已完成）

- 目标：用户反馈 `GET http://localhost:5176/api/git/status?projectId=e14ed8a7-…` 「导致后续请求全部被阻止」。
- 诊断：日志 `~/.quickforge/logs/server-2026-08-26.log` 双结论——①用户所贴 e14ed8a7 请求三次 503/0ms（12:15:35×2、12:22:01），均命中 dev server 重启后的启动维护窗口（listen → startup initialization complete 之间，`resolveMaintenanceGate` 对非白名单 API fail-closed），~1 秒即过、非 bug；②真正的「后续请求全部被阻止」：12:28:46 页面刷新后 4 个无 signal/无超时的 git/status（default×2、97e168b3×2，来源 App.tsx 标题栏 + ChatPanelHost 分支探测）在大仓库各跑 141-146s，加 2 条常驻 SSE 占满 HTTP/1.1 同源 6 连接池；同期服务端其他请求 1ms 正常、慢请求结束后积压请求成串放出，证实浏览器侧连接耗尽。慢的根因是服务端 `listGitStatus`（`server/routes/workspace.mjs:433`，`--untracked-files=all` + numstat + 行数统计）在这两个仓库上极慢（73cb87e5 仅 ~500ms）。
- 实现：`src/components/workspace/workspace-api.ts` `getGitStatus` 组合 20s 超时（`composeGitStatusSignal`：TimeoutError DOMException、成功后 `dispose` 清计时器、桥接外部 signal abort）；`src/App.tsx` `refreshTitleGitStatus` 增 `titleGitAbortRef`（新请求先 abort 上一条、catch 首行 `controller.signal.aborted` 静默、finally 清 ref），项目 scope 切换 effect 同步 abort；`src/components/chat/ChatPanelHost.tsx` 分支探测挂 AbortController，cleanup/`gitProjectId`/`revision` 变化即中止。WorkspaceInspector 不变（超时走既有 error+重试）。
- 验证：定向 `npx vitest run tests/frontend/git-status-request-lifecycle.test.ts` → 1 file / 8 tests 全通过；相关回归 5 files / 29 tests；eslint 4 文件 0 error；`npx tsc -b` 通过。未跑全量。
- 文件：src/components/workspace/workspace-api.ts、src/App.tsx、src/components/chat/ChatPanelHost.tsx、tests/frontend/git-status-request-lifecycle.test.ts（新）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：可选真机复现验证（大仓库打开 Git 面板，20s 后超时出重试按钮、其余请求不再被钉死）。Notes：`listGitStatus` 大仓库 100-146s 性能问题与服务端轻量化（标题栏/分支徽标只需 branch/counts 却调全量端点）留作后续独立 feature；release-v1.8.1 发布门禁需含本改动全量重跑 test/lint/build。

---

## 当前状态：switch-sqlite-synchronous-normal（已完成）

- 目标：按用户知情决策把 SQLite `synchronous` 从 FULL 切回 NORMAL，消除大 persist COMMIT 段逐事务 fsync（及其在杀毒扫描/机械盘/网络盘上的延迟尖刺）；接受 OS 崩溃/断电回滚「最后一次 checkpoint 以来已提交事务」的有界窗口（进程崩溃安全）。
- 实现：`server/sqlite/database.mjs` `SQLITE_SYNCHRONOUS` 2→1；`configurePragmas` 用常量注入；`publicHealth` synchronous 摘要改为 `SQLITE_SYNCHRONOUS_NAMES` 派生（原硬编码 'full'）；safety argument 注释改写为 NORMAL 语义（WAL 帧校验和 → 任意崩溃事务原子/不撕裂，仅放弃逐 COMMIT fsync）。文档：`sqlite-storage-foundation.zh-CN.md` §3.1 追加 2026-08-26 修订段（按其预设回退条款格式；明确存储 v2 无 mirror 兜底、窗口内丢失即真实丢失）、`session-storage-current-architecture.zh-CN.md`、wiki pragma 行。测试：foundation pragma 断言 2→1、health 'full'→'normal'。
- 验证：定向 vitest 8 SQLite 相关文件 / 66 tests 全通过；eslint 0 error。
- 文件：server/sqlite/database.mjs、tests/server/sqlite-storage-foundation.test.mjs、docs/architecture/sqlite-storage-foundation.zh-CN.md、docs/architecture/session-storage-current-architecture.zh-CN.md、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：与同会话完成的 optimize-persist-encoding-yield（单遍序列化 + 分批 yield + 慢日志 200ms，见下节）叠加后观察慢日志分布；release-v1.8.1（in_progress）发布门禁需含两项改动全量重跑 test/lint/build。工作区另有 cloud-models-timeout-nonblocking 等未提交改动，无冲突。

---

## 当前状态：optimize-persist-encoding-yield（已完成）

- 目标：消除「大 session 持久化时消息 3 遍 JSON 序列化 + 同步编码独占事件循环 → 全局接口卡顿」，按用户决策实施评估项 ①单遍序列化器 + ③分批让出（安全子集）+ 慢日志阈值 1000→200ms；synchronous=NORMAL 与 SQLite worker 线程暂不动（NORMAL 已向用户解释为崩溃持久性权衡，待单独拍板）。
- 实现：新增 `server/sqlite/canonical-json.mjs`（canonicalJsonStringify，与旧三遍流水线字节级等价，差分测试 `tests/server/canonical-json.test.mjs` 54 用例钉死）；`session-state-repository.mjs` encodeMessage/messageDigest 切换新序列化器（digest 与既有库行兼容）、新增 `encodeMessagesChunked`（50 条/批 + 批间 setImmediate）与 normalizeRecord 的 `messagesEncoded` 预编码旁路；`session-state-service.mjs` savePair 拆 savePairWithPlan + savePairChunked（仅 expectedRevision/CAS 调用方走 yield 编码路径，其余同步路径零波及），`saveSessionStatePair` 变 async（唯一调用方 agent-manager:2424 已补 await）；`agent-manager.mjs` SLOW_PERSIST_LOG_MS=200。**否决项备忘**：跨 yield 持 SQLite 事务分批 INSERT 不可行——事务挂起期间其他同步写者经 savepoint 加入同一事务，中途失败 ROLLBACK 会回滚其已确认写入；独立连接则 busy_timeout 同步阻塞重造全局停顿。
- 验证：定向 vitest 13 文件 / 166 tests 全通过（含新增 yield 有序性、预编码旁路字节一致、错位抛 TypeError 用例）；eslint 改动文件 0 error；feature_list.json/progress.md/本文件已同步，docs/wiki/server/README.md 的 repository/service 两条已更新。
- 文件：server/sqlite/canonical-json.mjs（新）、server/sqlite/session-state-repository.mjs、server/session-state-service.mjs、server/agent-manager.mjs、tests/server/canonical-json.test.mjs（新）、tests/server/session-state-repository.test.mjs、tests/server/session-state-phase3.test.mjs、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：跑一段时间观察 200ms 慢日志分布——若同步写突刺（INSERT+COMMIT 段）仍显著，候选升级路径：SQLite 移 worker 线程（根治）/ replace 按 digest 差异只重写变更行（缩事务）；synchronous=FULL→NORMAL 需用户拍板（会削弱断电/OS 崩溃下的已提交事务持久性，与 7 天 quick_check 节奏的安全论证绑定）。注意 `release-v1.8.1` 仍 in_progress，发布门禁需含本改动全量重跑 test/lint/build。工作区另有 cloud-models-timeout-nonblocking 等未提交改动，与本改动无冲突。

---

## 当前状态：vendor-node-pty-runtime（已完成）

- 目标：把终端所需的 node-pty 运行时从 15MB/61MB 的上游 npm 包裁剪为最小运行集，直接随 `@shawnstack/quickforge` npm 包分发（用户要求四平台齐全）。
- 实现：新增 `vendor/node-pty/`（5.3MB，win32-x64/arm64 + darwin-x64/arm64，lib JS + prebuilds 去 pdb + 许可文本），内嵌 `{"type":"commonjs"}` package.json 标记规避仓库根 ESM 冲突，`VENDOR.json` 记录来源 node-pty@1.1.0；`scripts/vendor-node-pty.mjs` 负责从 devDependency 重新同步（保留 licenses/ 与 README）；`server/terminal/terminal-manager.mjs` loadPty() vendor 优先 → node-pty 回退 → 503 降级，导出 vendoredPtyEntryPath()，darwin 上 ensureVendoredSpawnHelperExecutable() 自愈 spawn-helper 执行位（git index 已标 100755，Windows 重新生成后需 `git update-index --chmod=+x` 重设）；node-pty 移 optionalDependencies → devDependencies；package.json files、两个 prepare 脚本 copyEntries、electron-builder files+asarUnpack 纳入 vendor。
- 验证：定向 vitest 5 tests（含 require.cache 断言 vendor-first）+ node 冒烟 spawn 通过；完整 `npm run test` 257 files / 2275 tests 全通过；`npm run lint` 0 errors / 1 既有 warning；`npm run build` 成功；`npm pack --dry-run` 7.4MB / 452 files（原 4.8MB）。
- 文件：vendor/node-pty/**（新）、scripts/vendor-node-pty.mjs（新）、tests/server/terminal-vendor-runtime.test.mjs（新）、server/terminal/terminal-manager.mjs、package.json、package-lock.json、scripts/prepare-runtime-package.cjs、scripts/prepare-offline-package.cjs、desktop/electron-builder.config.cjs、docs/wiki/server/README.md、docs/wiki/root-config.md、docs/architecture/patch-release-runbook.zh-CN.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：可选真机验证（npm 消费端终端开箱即用、macOS arm64、Electron asarUnpack）；升级 node-pty 时跑 `npm install && node scripts/vendor-node-pty.mjs`；`release-v1.8.1` 仍 in_progress，发布门禁需纳入本改动重新完整验证（tarball 现为 7.4MB）。
- Notes（与本次 feature 无关）：node-pty 1.1.0 Windows kill 阶段 conpty_console_list_agent 有 `AttachConsole failed` stderr 噪音（官方副本同样存在，疑似上游 bug，与 vendor 化无关）。

---

## 当前状态：global-sse-flush-headers（已完成）

- 目标：用户反馈 `http://localhost:5176/api/agents/events`、`/api/channels/events` 请求时间长、易挂起；诊断后修复 `/api/agents/events` 首字节延迟问题。
- 根因：两接口均为 SSE 长连接（永久 Pending + Time 增长是正常表象）。但 `handleGlobalStream`（`server/routes/agent.mjs`）`writeHead` 后无 body 写入，Node 将响应头缓存到第一次 `res.write`（15s ping 或首条事件）才发出，客户端 TTFB/`onopen` 最长延迟 15 秒；`handleChannelEvents` 因立即写 snapshot 无此问题。
- 实现：`handleGlobalStream` 在 `writeHead` 后加 `res.flushHeaders()` 立即刷出响应头（附一行注释说明缘由）。`tests/server/routes/agent.test.mjs` 新增 "agent global events stream" 用例：断言 200 + `text/event-stream` + `flushHeaders` 被调用 + 挂载 `agent_event` 监听，`req.emit('close')` 后移除监听并 end；mock 的 `agentEvents` 补 `removeListener: vi.fn()`（cleanup 路径需要）。
- 验证：定向 `npx vitest run tests/server/routes/agent.test.mjs` → 1 file / 14 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92`）。
- 范围外未改（已向用户说明）：dev 下 server/Vite 重启断流后 EventSource 指数退避重连（Network 面板呈现为新 Pending 请求）；HTTP/1.1 同源 6 连接上限下多 SSE（channels/events + agents/events + 会话 stream + 设置页再开一条）多 tab 挤占连接池。
- 文件：`server/routes/agent.mjs`、`tests/server/routes/agent.test.mjs`、`progress.md`、`session-handoff.md`。
- 边界：无架构/公共入口变化，docs/wiki 无需更新；未新增依赖，未 commit/tag/push，未触碰生成产物。
- 下一步：无 blocker；可选真机确认 `/api/agents/events` 在 DevTools 中 TTFB 即时（不再等 15s ping）。注意 `release-v1.8.1` 仍 in_progress，本改动需纳入其发布门禁重新完整验证。

---

## 当前状态：package-size-trim（已完成）

- 目标：按用户决策裁剪包体：1) qf-agent 功能暂时移除、不再引用/分发二进制；2) mermaid 等纯前端依赖按推荐移回 devDependencies；3) Monaco 只读查看器去掉 4 个语言 worker。
- 实现：①package.json files + prepare-runtime/offline copyEntries 去掉 runtime-assets；electron-builder.config.cjs 删 extraResources/平台 helper；electron-main.mjs 删 desktopAgentPath/qfAgentPath；git rm runtime-assets（52MB 五平台）。qf-agent-process.mjs 托管代码不动——缺二进制 → unavailable，QUICKFORGE_QF_AGENT_PATH 可外部指定，win32 dev 保留 ../quickforge-cloud/bin/agent.exe 回退。②mermaid/react-markdown/remark-gfm/@dnd-kit×3/@capacitor×3 → devDependencies，npm install --package-lock-only 同步（无版本变化）；消费端安装省 ~93MB。③monaco-local.ts 改 editor.api + editor.all + 新 monaco-basic-languages.ts（全部 Monarch 贡献聚合，按需懒加载）+ 仅 editor.worker，getWorker 不再按 label 分发；新增 src/monaco-esm.d.ts；已知取舍：JSON 无 Monarch 着色、纯文本呈现。
- 文件：package.json、package-lock.json、scripts/prepare-runtime-package.cjs、scripts/prepare-offline-package.cjs、desktop/electron-builder.config.cjs、desktop/electron-main.mjs、src/components/workspace/monaco-local.ts、src/components/workspace/monaco-basic-languages.ts（新）、src/monaco-esm.d.ts（新）、tests/frontend/monaco-local.test.ts、docs/architecture/quickforge-cloud-client.zh-CN.md、docs/design/remote-access-p2p.md、docs/wiki/server/README.md、docs/wiki/src/components/README.md、状态文件；git rm runtime-assets/agent 五平台二进制。
- 验证：定向 vitest 多组全通过；eslint/tsc/node --check/build 全通过（dist 26→17MB，四语言 worker 消失）；完整 npm run test 256 files / 2269 tests 全通过；npm run lint 0 errors / 1 既有 warning；package-dist 重建 npm pack --dry-run → 4.8MB / 414 files（v1.7.10 为 24.1MB），打包 dependencies 仅 9 个。
- 边界：vite.config.ts 未动（并行 Monaco 会话刚移除 monaco manual chunk，为 rolldown 首屏刻意决策，本轮构建沿用）；qf-agent-process.mjs / public-api.mjs 未动（测试全用注入 fake，无需改）；并行会话的 monaco-local-bundled-loading 改动完整保留，本轮 worker 裁剪叠加其上并同步了其 wiki 描述。未 commit/tag/push。
- 下一步：无 blocker。Cloud 远程访问暂不可用（unavailable），恢复=还原二进制与四处打包引用；release-v1.8.1 发布门禁需在含本轮改动的基线重跑完整 test/lint/build。

## 当前状态：monaco-local-bundled-loading（已完成）

- 目标：消除 Monaco 编辑器对 `cdn.jsdelivr.net` 的运行时依赖（Edge Tracking Prevention 提示 + package-offline 离线场景编辑器加载不出），并保证不拖慢首屏。
- 实现：`src/components/workspace/monaco-local.ts`（新）提供 `ensureLocalMonaco()` 模块级单例——函数内 `Promise.all` 动态 import `monaco-editor` 与 editor/json/css/html/ts 五个 `?worker`，设置 `self.MonacoEnvironment.getWorker` 按 label 分发，经 `@monaco-editor/react` 的 `loader.config({ monaco })` 注册本地实例；顶层只 import `loader`（Environment 为 type-only，编译期擦除）。`MonacoCodeViewer.tsx` / `MonacoDiffViewer.tsx` 增加 `monacoReady` gate（useEffect + cancelled 清理；config 先于 `loader.init()`，杜绝默认 CDN 注入；未 ready 返回 null，其余 props/options 不变）。`vite.config.ts` 删除 monaco manualChunks 分支并留注释说明：monaco 本体仅被 monaco-local 动态 import 引用，默认分包隔离为异步 chunk；若设 manual chunk，rolldown 会把共享 preload-helper 收编进 monaco chunk 并经 modulepreload 拖回首屏（已实测复现并修复）。
- 文件：`src/components/workspace/monaco-local.ts`（新）、`src/components/workspace/MonacoCodeViewer.tsx`、`src/components/workspace/MonacoDiffViewer.tsx`、`vite.config.ts`、`tests/frontend/monaco-local.test.ts`（新，源码契约）、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 4 files / 29 tests 全通过；eslint 改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（monaco 异步 chunk：editor.api2 3.63MB/gzip 926KB + 5 个独立 worker，与既存大 chunk 共同触发既有 size warning）；dist 只读检查：index.html modulepreload 11 项与入口静态闭包均不含 monaco；全 dist 仅 1 处 `cdn.jsdelivr.net` 死字符串（`@monaco-editor/loader` 默认 config，运行时被短路，无网络请求）。
- 边界：未新增依赖（monaco-editor 本就在 devDependencies）；未手工修改生成产物；未 commit/tag/push；cloud-models-timeout-nonblocking 并行改动未触碰。
- 下一步：无 blocker；可选真机断网验证代码/Diff 查看器。注意 `release-v1.8.1` 仍 in_progress，本改动需纳入其发布门禁完整 test/lint/build 重新验证。

---

## 当前状态：cloud-models-timeout-nonblocking（已完成）

- 背景与根因：用户报告 `http://localhost:5176/api/cloud/models` 500。`~/.quickforge/logs/server-2026-08-26.log` 证实：10:25:45 dev server 重启 → Cloud identity/模型内存缓存清空 → 首次回源 `https://qf.shawnstack.com/v1/models` 超时（默认 10s，`TimeoutError`）→ 非 `CloudApiError` 被全局 `sendError` 兜底为 500；同时 `/api/models/catalog` 在 `server/model-catalog.mjs` 串行 await 同一 in-flight promise，主模型目录同步挂 ~10s（阻塞功能使用）。
- 实现：`server/cloud/client.mjs` fetch 异常分类（TimeoutError→504 `cloud_timeout`、TypeError→502 `cloud_unreachable`、均 retryable，外部 AbortError 原样抛）；`server/model-catalog.mjs` 2s 短截止 + 底层请求继续暖缓存 + 防 unhandled rejection；`useCloudModels` 失败 30s 负缓存；`pi-chat.ts resolveNewSessionModel` 与 `useAppBootstrap` 5s 上限走既有本地回退；`default-options-settings-tab.ts` 设置页先渲染 catalog/local、Cloud 后台增量合并（loadSettings 代数守卫 + 手动改选保护），类加 export 供测试。
- 文件：`server/cloud/client.mjs`、`server/model-catalog.mjs`、`src/hooks/useAppBootstrap.ts`、`src/hooks/useCloudModels.ts`、`src/lib/pi-chat.ts`、`src/lib/default-options-settings-tab.ts`、5 个测试文件（新建 `tests/frontend/default-options-settings-tab.test.ts`）、`docs/architecture/quickforge-cloud-client.zh-CN.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/hooks/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 10 files / 98 tests 全通过；eslint 12 文件 0 error；`npx tsc -b` 通过；`npm run build` 成功（仅既有 KaTeX/chunk warnings）。未跑全量 test/lint。
- 边界：未新增依赖，未手工修改生成产物，未 commit/tag/push；工作区 Monaco 相关并行改动（`MonacoCodeViewer.tsx`、`MonacoDiffViewer.tsx`、`monaco-local.ts`、`tests/frontend/monaco-local.test.ts`、`vite.config.ts` monaco chunk 策略、`docs/wiki/src/components/README.md`）为其他任务未提交内容，本轮未触碰。
- 下一步：无 blocker。注意 `release-v1.8.1` feature 仍为 in_progress，本改动需纳入其发布门禁的完整 test/lint/build 重新验证。

---

## 当前状态：mobile-h5-fullscreen-sidebar-and-inspector（已完成）

- 目标：手机 H5 端左侧会话侧栏整屏展示（去掉 w-80 + max-w-[85vw] 两层限制），并让右侧 Workspace Inspector 的 PanelRight 开关在移动端可见、Inspector 以全屏覆盖可用。
- 实现：`ChatSidebar.tsx` 移动分支改为 `'flex h-full w-full flex-col'`，`App.tsx` 移动抽屉 div 移除 `max-w-[85vw]`；`App.tsx` PanelRight 按钮由 `hidden ... lg:inline-flex` 改为全断点 `inline-flex`；`WorkspaceInspector.tsx` 新增 `narrowViewport`（matchMedia 1024px，防御式）+ `mobileOverlay`，根 aside mobileOverlay 时 `quickforge-workspace-inspector-fullscreen z-20 flex rounded-none border-l-0`、无 width style、separator 加 `!mobileOverlay` 条件；桌面 fullscreen z-40/Maximize2/Escape 与 GitToolsPinnedSummary `hidden md:flex` 均不动。
- 文件：`src/App.tsx`、`src/components/sidebar/ChatSidebar.tsx`、`src/components/workspace/WorkspaceInspector.tsx`、`tests/frontend/side-chat-workspace-tab.test.ts`（首用例更新）、`tests/frontend/mobile-fullscreen-adaptation.test.ts`（新建）、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 7 files / 66 tests 全通过；eslint（5 个改动文件）0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature JSON 解析通过。未跑全量 test/lint。
- 边界：未新增依赖，未手工修改生成产物，未 commit/tag/push；GitTools 更改入口维持现状（小屏仍隐藏）。
- 下一步：无 blocker；可选真机目视验证移动侧栏整屏、PanelRight 开关与 Inspector 全屏覆盖关闭交互。注意 `release-v1.8.1` feature 仍为 in_progress，本轮改动需纳入其发布门禁重新验证。

---

## 当前状态：todo-pending-status-icon-hollow-circle（已完成）

- 目标：更换任务摘要面板中"未进行中（pending）"状态图标，先设计后选型。
- 实现：`design-mockups/todo-pending-icon-options.html` 提供 5 个候选方案（真实面板上下文 + 14px 实际尺寸 + 深浅主题切换），用户选定方案 A 空心圆。`src/components/chat/panel-decoration/todo-write-summary.ts` 的 `statusIcon()` pending 分支删除中心实心小圆点，只留 r=9 外圈；三态统一为「外圈+内部符号」语言（无符号=未开始、指针=进行中、对勾=已完成）。颜色/尺寸/stroke 约束不变，未改 CSS。
- 验证：定向 Vitest 2 files / 30 tests 全通过；目标 ESLint 0 error；`npm run build` 成功（仅既有 KaTeX/chunk size warnings）。未跑全量 test/lint。
- 边界：纯局部图标替换，docs/wiki 与 DESIGN_LANGUAGE 无需更新；未新增依赖，未手工修改生成产物，未 commit/tag/push；设计稿保留。
- 下一步：无 blocker；可选真机目视深浅主题下三态图标效果。

---

## 当前状态：workspace-document-preview（已完成）

- 目标：把已有的 PDF.js、docx-preview、SheetJS 能力接入 Workspace 文件预览链路，支持 PDF/DOCX/XLS/XLSX 只读预览（用户已确认方案并要求不过度设计）。
- 实现：WorkspaceInspector 新增顶层 `document` Tab（持久化仅 `{path, format}`，同路径复用 + `reloadNonce` 刷新）；Files 文件树与 `present_files`（自动+手动）统一按 `artifactPreviewMode` 三路分流；服务端 `inferPresentedFileKind` / 前端 `tool-artifacts` 识别 `pdf/docx/excel`；`/api/workspace/preview` 白名单与 MIME 扩展四种文档类型（沿用 50 MiB、安全校验、ETag、预检，未新增 API/HEAD/Range）；`WorkspaceDocumentContent` 按格式动态加载 pdfjs-dist（可见页懒渲染）、docx-preview（容器隔离）、xlsx（多 Sheet + 分页 + 5000 行上限）；三个解析库提升为直接 devDependencies（版本与既有锁定一致）。
- 文件：见 `feature_list.json` 的 `workspace-document-preview.files`（共 27 个：核心代码 + 测试 + wiki + 状态文件）。
- 验证：定向 6 files / 169 tests、完整 `npm run test`（253 files / 2247 tests）、`npm run lint`（0 errors / 1 既有 warning）、`npm run build` 全部通过；构建确认无重复打包。
- 边界：未新增库类别/版本升级（仅把已用传递依赖变为直接依赖），未手工修改生成产物，未 commit/tag/push；PPT/PPTX/DOC/XLSM 明确不支持。
- Blocker：无。可选下一步：Electron / Android 远程真机目视验证大文件 PDF/Excel；后续可考虑 Excel Worker 化与 PPTX 策略（不在本期）。
- 注意：`release-v1.8.1` feature 仍为 in_progress（发布门禁任务，见下文），与本 feature 无冲突；发布前需在其基线上重新完整运行 test/lint/build（本轮文档预览改动已包含在当前工作区，需一并纳入发布验证）。

---

## 当前状态：fix-cutover-startup-bugs（已完成，Share/LAN/Scheduled Runs 启动完整性收口）

- 目标：避免 Share、LAN Access、Scheduled Runs 可选存储域在日常启动中执行整库/全域完整性扫描并把整机置为 `FAILED`，同时保留 SQLite/schema/migration 和首次 cutover、backup/restore/export 等正确边界的严格门禁。
- 实现：新增 migration 12，在同一 `BEGIN IMMEDIATE` migration 事务中物理删除 `share_sessions.record_digest` 与 `lan_access_state.record_digest`；Share/LAN repository 移除在线逐行 digest 读写和 `invalidDigests` 校验。Share/LAN pending/authoritative 常规启动只 drain 事务性 mirror outbox，outbox 清空后提升 authoritative 并保留已有 storage state count/digest/backup/diagnostic 元数据；Scheduled Runs authoritative 不再调用 health quick check。首次 JSON→SQLite cutover 仍执行双读、备份重读、replace、快照 count/digest 与关系校验。Share 写入路径同步修复普通更新/重复 create 的 token 保留、密码变化 token 失效或替代 token 新 authVersion、supersede 物理清 token，以及 issue/prune 时间戳一致性。通用启动恢复指引已改为先停进程并完整复制整个 dataDir（含 SQLite/WAL/SHM），再按实际错误域处理，明确禁止删库和盲跑 session downgrade。
- 文件：核心为 `server/sqlite/migrations.mjs`、`server/share-store.mjs`、Share/LAN repositories 与 cutover、`server/scheduled-runs-cutover.mjs`、`server/startup-state.mjs`、`server/index.mjs`；覆盖 migration、repository、cutover、authoritative store、backup、startup gate、full-chain smoke 等测试；同步三份架构文档、server Wiki 与三个状态文件。
- 验证：定向 17 files / 135 tests 与 Share 聚焦 5 files / 34 tests 全通过；完整 `npm run test` → 253 files / 2219 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 与 feature JSON 解析通过。
- 边界：未新增依赖，未手工修改生成产物，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。未实现域级 degraded readiness、统一离线 restore CLI 或明确 Electron CI script，均不属于本轮范围。
- 下一步：无 blocker。

---

## 当前状态：sidebar-five-item-display-shared-scroll（已完成）

- 目标：左侧 Projects/Tasks 采用默认 5 条、每次增加 5 条的显式展示控件，并让 Pinned/Projects/Tasks 共用侧栏中部唯一滚动容器，同时保持项目 DnD 可见边界与自动滚动正确。
- 实现：`ChatSidebar.tsx` 新增实例本地 timeline/global/per-project 展示计数。Projects 时间线、单项目会话和 Tasks 都使用 `slice` + 唯一可见的“显示更多”行；该行复用普通 session 的字号、行高、水平布局、圆角与点击区域，仅以 muted 灰色降低层级，不显示“收起”，show-less i18n 已删除。共享折叠 props、展开项目集合与 `sessionViewMode` 变化会在桌面/移动两个独立实例中兜底恢复 5 条。视图模式使用 previous ref + effect 监听共享 prop，仅在真实变化时重置 timeline 并 invalidate generation，初始挂载无额外副作用；DnD 临时视觉折叠不触发重置。`sidebar-session-display.ts` 负责纯行为计算、快速点击去重与竞态失效：每个 timeline/global/project key 独立维护 generation 和 pending generation；只有 loadMore 成功且 generation 未变化才返回下一 count。Projects/Tasks/单项目折叠、折叠全部和时间线视图切换会立即使对应在途请求失效，旧 Promise 完成不能覆盖已恢复的 5 条；失败仍保持原数量并允许重试。Pinned sentinel 保留但折叠时禁用，其余三个 sentinel 删除。
- 布局 / DnD：Pinned、Projects、Tasks 放入单一 `sidebarScrollViewportRef` 的 `overflow-y-auto` 中，移除区块和项目子列表固定高度/内部滚动；footer 继续固定在外。`visibleProjectDragBoundary` 只返回 Projects 与共享视口的合法相交矩形，缺失或不相交时返回 undefined；`clampProjectDragTransform` 对反转上下界安全降级为仅横向锁定，autoScroll allowlist 仅允许共享视口。
- 文件：`src/components/sidebar/ChatSidebar.tsx`、`src/hooks/useSessionPagination.ts`、`src/lib/sidebar-session-display.ts`、`src/lib/project-drag-boundary.ts`、`src/lib/i18n.ts`、5 个侧栏/分页测试、components/lib Wiki 与三个状态文件。
- 验证：局部收口后，定向 Vitest 5 files / 48 tests 全通过（显示更多与普通 session 共用行/标题尺寸布局、muted 灰色、无可见收起/无 show-less key，并继续覆盖每次 +5、共享 `sessionViewMode`、折叠重置与 generation 竞态保护）；目标 ESLint 0 error；完整 `npm run test` → 253 files / 2210 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 与 feature JSON 解析通过。
- 边界：未新增依赖，未修改生成目录，未 commit/tag/push；两个既有未跟踪 design-mockups 文件未触碰。下一步仅可选桌面/移动真机目视长列表、显示更多、折叠重置与拖拽边界。

---

## 当前状态：release-v1.8.1（已完成）

- 事实：最终基线为 `35e0863`（b81effaa + 发布说明文档刷新），`v1.8.1` tag 已创建并推送远端，master/dev 已同步到该提交；npm 1.8.1 从未发布（latest 停留在 1.8.0），经用户决策跳过补发，由 v1.9.0 直接取代（见文首 release-v1.9.0）。
- 下一步：无；后续发布见 release-v1.9.0。

---


## 当前状态：remove-side-chat-title-entry-global-inspector-access（已完成）

- 目标：彻底移除主对话顶部 Side Chat 入口；桌面端 Workspace Inspector 在 global/无项目会话仍可从主工具栏右侧栏按钮打开；移动端不新增入口。
- 实现：`App.tsx` 删除标题区 Side Chat 按钮、`openWorkspaceSideChat`、`sideChatTabOpen`；`WorkspaceInspector` 删除 `onSideChatPresenceChange` prop/callback 链，只保留真正的 Side Chat reset/abort 清理。桌面 `PanelRight` 按钮的 disabled 条件由 `!currentToolProject.id || needsModelSetup` 收敛为 `needsModelSetup`，并让有活动 global session 时 Inspector 组件保持挂载；按钮仍是 `lg:inline-flex`，未增加移动入口。Inspector 内 `+` 菜单和空状态 Side Chat 入口、活动会话/模型限制、单实例和运行时非持久化语义均保留。无引用的 `sideChatOpen` 中英文 i18n 键已删除。
- 测试：扩展 `tests/frontend/side-chat-workspace-tab.test.ts`，锁定 App 无顶部入口/状态链、桌面右侧栏按钮不依赖项目且保持桌面断点、Inspector `+`/空状态入口、单实例查找和关闭生命周期。
- 验证：相关 Vitest 5 files / 46 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功，仅既有 KaTeX 字体解析与 chunk size warnings；`git diff --check` 通过。
- 文档与边界：`docs/wiki/src/components/README.md` 已同步入口与 global 可达性；无新视觉模式，无需更新 `DESIGN_LANGUAGE.md`。未新增依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push；既有未跟踪设计稿未触碰。
- 下一步：无 blocker；可选桌面真机验证 global/无项目会话打开 Inspector，以及 Inspector 内重复打开 Side Chat 只激活同一 Tab。

---

## 当前状态：remove-todo-summary-bottom-border（已完成）

- 目标：仅移除输入框上方 TodoWrite 任务摘要的底部分隔横线。
- 实现：删除 `src/index.css` 中 `.quickforge-todo-summary` 的 `border-bottom: 1px solid color-mix(...)`；其余任务摘要样式、交互和业务代码保持不变。
- 验证：`npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/slash-invocation-chip.test.ts` → 2 files / 44 tests 全通过；`npm run build` 成功，仅有既有 KaTeX 字体解析与 chunk size warning。
- 文档与边界：纯局部样式调整，不改变架构、模块职责或公共入口，因此 docs/wiki 与 `DESIGN_LANGUAGE.md` 无需更新。未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿保持不动。
- 下一步：无 blocker；可选真机目视确认底部横线已消失。

---

## 当前状态：prompt-http-error-message（已完成）

- 目标：Prompt HTTP 请求失败时，不只保留全局错误状态，还要在聊天区显示服务端返回的具体原因。
- 实现：`src/lib/server-agent.ts` 复用项目 assistant error 消息契约，新增最小构造/去重 helper。fetch catch 先按既有身份与长度条件回滚乐观 user message，再追加空 text block、当前模型字段、完整零 usage/cost、`stopReason:'error'`、具体 `errorMessage`、timestamp 的 assistant 消息；清理 streaming/watchdog；继续发 error 事件；`agent_end` 现携带 `status:'error'`、`errorMessage` 与最终 messages。
- 测试：`tests/frontend/server-agent.test.ts` 模拟 400 `{error:'Selected model is not configured in QuickForge.', code:'model_not_configured'}`，覆盖具体原因、乐观回滚、assistant error 消息完整契约、无重复、error/agent_end 事件和结束状态。
- 验证：定向 Vitest 1 file / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 与 `git diff --check` 通过。
- 文档与边界：`docs/wiki/src/lib/README.md` 已同步；不改架构/设计语言文档。未新增依赖，未修改生成产物，未 commit/tag/push；工作区其他未提交改动保持不动。
- 下一步：无 blocker。

---

## 当前状态：side-chat-workspace-tab（已完成，最终收敛）

- 目标：Side Chat 直接复用主聊天完整界面和核心交互，不为不适用功能重做一套实现；不支持控件原位禁用，服务端硬只读。
- 实现：`SideChatTabContent` 只包装共享 `ChatConversationSurface + ChatPanelHost mode="side-chat"`；同一 pi-web-ui ChatPanel/MessageList/MessageEditor 提供纯文本发送、停止、复制、Markdown/代码块、滚动与轮次导航。`+`、模型、Access、rollback/retry/fork 保持主控件外观并 native disabled；Slash、插件、附件、文件引用、thinking、Plan、审批、终端、context usage/compaction 等不启用。Agent/client 仅维护内存纯文本，最多 40 条，发请求时从最新向前按完整消息裁剪至 200,000 字符；Tab 非持久化，关闭与主会话 scope 变化时 abort/reset。入口要求活动主会话和可用模型。
- 安全与隔离：服务端读取活动主会话权威纯文本上下文，固定 `tools: []`，任何 toolcall/toolUse fail closed，不创建/调用/持久化主 Agent。Side Chat 初始化 ChatPanel 时保存并恢复主聊天全局 artifacts renderer；禁用控件只关闭当前 panel/anchor 所属模型与 Access 菜单，不干扰主聊天；Host 不触发草稿 localStorage、Git、通知、artifact、审批或终端副作用。
- 验证：定向 11 files / 97 tests，隔离修复聚焦 9 files / 71 tests；完整 `npm run test` → 249 files / 2148 tests；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体与 chunk warnings）；TS/MJS syntax/`git diff --check` 均通过。
- 边界：Plan pill 仅在主聊天已进入 Plan 模式后出现，Side Chat 从不进入该模式，因此不额外制造假控件。本次仅提交 Side Chat，未 tag/push，未新增依赖，未手工修改生成产物。

---

## 当前状态：fix-side-chat-assistant-usage-contract（已完成）

- 目标：最小修复 Side Chat 调用 pi-ai 时 assistant 上下文缺失 `usage.totalTokens` 导致的运行时异常。
- 实现：`server/routes/side-chat.mjs` 新增小 helper，仅在最终服务端模型解析后，将既有 `mainConversationMessages + normalizeSideMessages` 的纯文本结果物化为 pi-ai 消息。user 保持纯文本与 timestamp；assistant 为 `content:[{type:'text',text}]`，使用最终模型的 `api/provider/id`，完整零 usage/cost、`stopReason:'stop'`、timestamp。客户端 usage/details/tool/thinking 不进入模型上下文；字符预算、compact summary、权限、工具安全和 `tools: []` 不变。
- 测试：服务端首轮主上下文 assistant、第二轮侧聊历史 assistant 均断言完整模型字段、text block、`usage.totalTokens=0`、`cost.total=0`；另有全 assistant 完整 usage 契约与 `tools: []` 断言。前端 SideChatAgent 补 local stream update/final 的完整零 usage 断言。
- 验证：定向 Vitest 2 files / 13 tests 全通过；目标 ESLint 0 error；MJS `node --check` 通过；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- 文档与边界：routes Wiki 补一句服务端 pi-ai 消息物化契约；无架构/公共入口变化。未 commit/push，未修改生成产物，未触碰其他并行文件。
- 下一步：无 blocker。

---

## 当前状态：side-chat-shared-conversation-surface（已完成）

- 目标：Side Chat 不只复用 `ChatPanelHost` 内部，还与主聊天复用完整 conversation 显示壳；最终背景、布局、overflow、消息、Composer、轮次导航和装饰链一致，Side Chat 空状态仍保持普通空白。
- 实现：新增 16 行 `ChatConversationSurface.tsx`，只提供 `relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--quickforge-main-bg)]`。App 主聊天改用该组件，既有 empty/enter class、Hero、项目选择器、ErrorBoundary/Suspense 和首次引导层级不变；`SideChatTabContent` 用同一 surface 包住同一 `ChatPanelHost mode="side-chat"`，明确 `newChatEmptyState={false}`，删除 `showTurnNavigation={false}`，无自绘 textarea/messages/button 和 side-chat 视觉 class。`ChatPanelHost` 的 DOM 插入统一为无 mode 视觉分支的 `host.replaceChildren(panel)`；mode 仅继续控制安全能力、tools 为空、附件/模型/thinking 关闭、内存输入与副作用隔离。
- 文件：`src/components/chat/ChatConversationSurface.tsx`、`src/App.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/components/workspace/SideChatTabContent.tsx`、`tests/frontend/side-chat-workspace-tab.test.ts`、`docs/wiki/src/components/README.md`、状态文件。
- 验证：定向 Vitest 5 files / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 247 files / 2108 tests 全通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- 边界：安全策略 `SIDE_CHAT_CAPABILITIES` 仍全 false，`toolsFactory` 仍返回 `[]`；生命周期、无模型入口、非持久化与服务端路由未改。未触碰并行 `ChatSidebar.tsx` / `sidebar-section-order.test.ts`，未触碰无关原型和 `docs/prototypes/`，禁止 commit/push。
- 下一步：无 blocker；可选真机目视主聊天和不同 Inspector 宽度下的深浅主题、轮次导航与 Composer。合理可见差异仅为主聊天与 Inspector 实际容器宽度不同，同一响应式规则自然适配。

---

## 当前状态：context-usage-skills-mcp-breakdown（已完成）

- 目标：在现有上下文用量 Tooltip 构成区的系统提示词、工具定义、消息之后增加 `Skills`、`MCP` 两行；仅显示数字，字段缺失或 `<=0` 隐藏，总量与圆环不变。
- 实现：`server/context-usage.mjs` 新增 `skillsTokens` / `mcpTokens` 来源统计。最终审查收口后，Skills 以 `activate_skill` / `read_skill_resource` definition 参数枚举证明会话存在 enabled Skills，只选择系统提示词中最后一个带固定系统介绍且包含全部启用名称的真实 `<available_skills>` catalog，并统计 Skills definitions 与已关联调用/结果；无 enabled Skills 时指令伪标签与伪调用均不计。MCP definition 仅接受非数组对象 `mcp` 且 `serverName` / `toolName` 为非空字符串；名称回退通过共享 `server/mcp/tool-name.mjs` 复用 registry 的真实 server canonical 与 tool sanitize/encode 规则，解析后重建并要求原字符串完全一致，拒绝三处带空格、空 segment、非法 server 及未编码 tool 名，同时接受 helper 真实生成的 canonical 名称；未改变 `registry.isMcpToolName()` / `callMcpTool()` 公共行为。toolResult 有非空 `toolCallId` 时只按已识别 MCP call ID 关联，错误/孤立 ID 不再降级到名称；ID 缺失/空时才按已识别 canonical `toolName` 关联；ID/name 都缺失时才接受完整 `details: {mcp:true,server,tool}`。两项复用 `estimateTokens`，不进入 `estimatedInputTokens`、provider usage、`inputTokens` 或 percent 加总。前端类型均为可选字段，Tooltip 严格在现有三行后按正数追加 `Skills` / `MCP`。
- 文件：最终审查新增/修改 `server/context-usage.mjs`、`server/mcp/tool-name.mjs`、`server/mcp/config.mjs`、`server/mcp/registry.mjs`、`tests/server/context-usage.test.mjs`、`docs/wiki/server/README.md` 与状态文件；此前功能文件 `src/lib/server-agent.ts`、`src/components/chat/chat-utils.ts`、`src/components/chat/context-usage.ts`、`src/lib/i18n.ts`、`tests/frontend/context-usage.test.ts`、`docs/wiki/src/components/README.md` 保持现有实现不动。已确认原型 `docs/prototypes/context-usage-source-attribution.html` 保留且未移入业务演示控件。
- 验证：最终审查定向 Vitest 3 files / 40 tests 全通过；MCP registry 额外回归 1 file / 6 tests 全通过；完整 `npm run test` → 247 files / 2119 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- 文档与边界：server/components Wiki 已同步；架构、模块职责和公共入口未改变，无需更大文档更新。未新增依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`，未创建 commit/tag/push。
- 下一步：无 blocker；可选真机查看有 Skills/MCP 和无来源数据两种 Tooltip。

---

## 当前状态：tool-call-running-title-sweep（已完成）

- 目标：为普通工具调用的标题与参数增加克制的运行态扫光，同时移除同一区域重复的 spinner/耗时反馈。
- 实现：普通 `LocalWorkspaceToolRenderer` 仅在 running 时为 `quickforge-tool-label` 追加 `quickforge-tool-running-sweep`，标题与参数摘要低强度从左到右循环；运行态隐藏 `renderStatus` 的 spinner/耗时，done/error/called 原状态不变。保留 `aria-busy` 语义；reduced motion 关闭扫光且不增加静态运行状态；`run_command` 输出与终止按钮保持不变；共享 `renderStatus` 未修改。
- 文件：`src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/local-tool-running-sweep.test.ts`；设计探索稿 `design-mockups/tool-call-running-light-sweep.html`。
- 验证：目标 Vitest 4 files / 31 tests 全通过；目标 ESLint 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；`feature_list.json` JSON 可解析；`git diff --check` 通过。
- 文档与边界：局部视觉状态反馈不改架构、模块职责或公共入口，docs/wiki 无需更新；符合现有 DESIGN_LANGUAGE，未修改规范。未创建 commit/tag/push，未手工修改生成产物。
- 下一步：无 blocker；可选真机目视普通工具 running/done/error/called、reduced motion 与 `run_command` 终止按钮。

---

## 当前状态：subagent-tab-bot-icon（已完成）

- 目标：用户要求把右侧 Workspace Inspector 中显示 subagent 过程的 Tab 图标改为复用 subagent 设计里的 icon。
- 调研：设计稿 `design-mockups/subagent-tool-marquee-impl.html`、`subagent-marquee-roll-switch.html` 的 subagent 工具类型图标为 Lucide `Bot`（天线+方头+双耳+双眼 SVG），与聊天 run_subagent 摘要卡（`src/lib/local-tools.ts:537`）及 Slash agent 图标（`src/components/chat/slash-icons.ts` agent=Bot）完全一致；Inspector 现状为 `WorkspaceInspector.tsx` 两处内联 `SquareActivity`（顶部 Tab 栏、ChevronDown Tab 下拉列表），`panelTabMeta` 对 subagent 返回 undefined。
- 实现：`WorkspaceInspector.tsx` 两处 `SquareActivity` → `Bot`，import 同步替换（Bot 按字母序置于 Check 前，SquareActivity 移除；全仓库无其他使用处）。`tests/frontend/workspace-inspector-tabs.test.ts` 新增源码契约测试：两处 subagent 分支渲染 `<Bot …>`、源码不含 `SquareActivity`、import 含 `Bot, Check, ChevronDown`。
- 验证：`npx vitest run` inspector 相关 5 files / 37 tests 全通过；`npx eslint` 两改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。未跑全量 test/lint。
- 文档与边界：纯图标替换，不改架构、模块职责或公共入口，docs/wiki 无需更新；复用既有 Lucide 图标体系，无新视觉模式，DESIGN_LANGUAGE 无需修改。未新增依赖，未创建 commit/tag/push，未手工修改生成目录。
- 下一步：无 blocker；可选真机目视深浅主题下 subagent Tab 的 Bot 图标。

---

## 当前状态：side-chat-workspace-tab（已完成）

- 目标与结果：已完成“侧边聊天 Workspace Tab”完整闭环并真实复用主对话核心 UI。Tab 单实例、非持久化；主标题栏、Workspace `+` 和空状态入口重复打开只激活已有 Tab，无可用模型时三类入口均不可打开。App 稳定持有 SideChatAgent 与输入内存，切换其他 Workspace Tab 保留；关闭自身、关闭全部、在其他 Tab 执行 close others、切换主会话 runtime scope 时 abort/reset、清空并恢复主标题入口。
- 前端：新增内存态 `side-chat-agent.ts` 与 NDJSON `side-chat-client.ts`；`SideChatTabContent.tsx` 现在只是 `ChatPanelHost mode="side-chat"` 的薄包装，不再自绘消息、textarea 或按钮。Side Chat 复用主对话同一个 `ChatPanel` / `AgentInterface` / `MessageList` / `MessageEditor`、消息装饰、Markdown/代码块、滚动、Composer 键盘、复制和发送/停止；`SIDE_CHAT_CAPABILITIES` 全 false，Host 在首帧关闭附件/模型/thinking，并跳过草稿 localStorage、Slash、插件、文件引用、Git、context/compaction、artifacts、通知、审批/ask、workspace tools、历史操作、终端执行、Plan/Access。Agent tools setter 与 Host toolsFactory 均 fail closed 为空。`serializePanelTabs` 剔除 `side-chat`，刷新不恢复。i18n 和组件/lib Wiki 已同步。
- 服务端：新增并注册 `POST /api/side-chat/stream`。当前活动会话通过 `getSessionState` 权威读取主消息、模型、thinking 与 `contextCompaction`；主上下文复用压缩语义后仅投影 user/assistant 纯文本，忽略 system/tool/toolCall/thinking/details/非文本块，按 120,000 字符从最新向前确定性裁剪，并在预算内尽量保留 compact summary；主线与侧聊合计不超过 200,000 字符。QuickForge 会话使用服务端权威模型；OpenCode 使用请求中的已配置 QuickForge `modelRef`，不走 ACP。固定 `tools: []`；任何 `toolcall_*` / `toolUse` fail closed；不调用 `runPrompt`，不写 Session/主 Agent；断连 abort；响应 `no-store + nosniff`。
- 测试：服务端覆盖权威上下文、纯文本投影、长上下文裁剪、最新消息与 compact summary 保留、`tools: []`、OpenCode QuickForge 模型、安全角色拒绝和 tool-call fail closed；前端新增 SideChatAgent 事件顺序、delta、error、abort、可重发、tools fail closed 与 40 条上限，并锁定 SideChatTabContent 真实复用 ChatPanelHost、无自绘 textarea、复制可用、无模型入口一致、Tab presence 与清理生命周期。
- 验证：定向 Vitest 11 files / 76 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 245 files / 2095 tests 全通过；完整 `npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改 `dist/`、`package-dist/`、`package-offline/`；build 只重建被忽略的 `dist/`。未跟踪原型 `design-mockups/side-chat-tab.html` 未修改。工作区另有 `src/components/sidebar/ChatSidebar.tsx` 与 `tests/frontend/sidebar-section-order.test.ts` 的并行改动，本功能未触碰或覆盖。
- 下一步：无 blocker；可选真机确认深浅主题、入口/Tab 单实例、切换其他 Tab 保留、四种清理生命周期、OpenCode 主会话及流式停止。

---

## 当前状态：fix-tasks-collapse-flicker（已完成）

- 目标：最小修复左侧 Tasks 普通收起闪烁；只关闭收起动画，保留展开动画。
- 根因：Tasks 外层 `SortableSidebarSection` 在普通收起的同一次更新中从 `flex-1` 切为 `shrink-0`，内层内容面板却继续执行 200ms `grid-template-rows` / `opacity` transition；`h-full`、flex 与滚动容器组合产生中间绘制帧。
- 实现：`ChatSidebar.tsx` 的 Tasks 内容面板将 `transition-none` 条件从仅 `isSectionDragging` 改为 `conversationsVisuallyCollapsed`。因此普通收起和拖拽临时收起都瞬时关闭；展开时条件为 false，既有 `collapsePanelClass` 的 200ms 动画继续生效。Projects 路径未修改。
- 测试：`sidebar-section-order.test.ts` 新增聚焦源码契约，从 Tasks 面板单行锁定关闭态使用 `conversationsVisuallyCollapsed && 'transition-none'`，并确认共享面板基类仍含 200ms transition；同步修正拖拽路径计数断言，避免大范围脆弱匹配。
- 验证：`npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 15 tests 全通过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` → 0 error；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- 文档与边界：局部视觉 bugfix 不改变架构、模块职责或公共入口，未更新 docs/wiki；复用现有 `transition-none`，未引入视觉模式，未修改 DESIGN_LANGUAGE。未新增依赖、未创建 commit/tag/push、未手工修改生成目录；build 只重建被忽略的 `dist/`，`design-mockups/side-chat-tab.html` 未触碰。
- 下一步：无 blocker；可选真机确认桌面/移动 Tasks 普通收起无闪烁、展开仍有动画。

---

## 当前状态：tasks-new-chat-inherits-current-task-project（已完成，已纠正语义）

- 目标：拆分侧栏三个新建入口，避免 Tasks 标题 MessageSquarePlus 错误跟随当前任务或 `activeProject`。顶部“发起新对话”继续按默认项目规则；Tasks 标题始终显式新建 global；项目行继续绑定对应项目。
- 实现：`ChatSidebar` 新增语义独立的 `onStartNewDefaultChat`，顶部入口使用该回调；既有 `onStartNewGlobalChat` 仅供 Tasks 标题入口。`App.tsx` 恢复 `startNewDefaultSession` 的 `activeProject` 规则，并新增 `startNewExplicitGlobalSession`：先 `setEmptyStateProjectDismissed(true)`，再调用 `startNewGlobalSession()`。空状态 dismiss 标记改为离开当前空状态后复位，避免 explicit global 新建后被 active-project 自动 effect 切回项目。global 使用默认 Workspace（`~/.quickforge/workspace`），不读取 `chatScope` / `currentToolProject` / `activeProject`。
- 桌面/移动：桌面分别传 `startNewDefaultSession` 与 `startNewExplicitGlobalSession`；移动分别使用先 `closeMobileSidebar()` 的包装回调，关闭行为保持。项目行仍为 `onClick={() => onStartNewProjectChat(item)}`。
- 清理：删除错误的 `src/lib/new-chat-project-target.ts` 与 `tests/frontend/new-chat-project-target.test.ts`，移除 lib Wiki helper 条目；新增 `tests/frontend/sidebar-new-chat-routing.test.ts` 覆盖源码/纯逻辑契约。
- 文档：组件 Wiki 明确 global 默认 Workspace，以及顶部、Tasks 标题、项目行三类入口差异。无视觉模式变化，无需修改 DESIGN_LANGUAGE.md。
- 验证：`npx vitest run tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/sidebar-section-order.test.ts` → 2 files / 19 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；feature JSON 解析与 `git diff --check` 通过。
- 边界：未新增依赖，未手工修改生成目录，未创建 commit/tag/push；build 只重建被忽略的 `dist/`，无关未跟踪文件 `design-mockups/side-chat-tab.html` 保持不动。
- 下一步：无 blocker；可选真机验证桌面/移动顶部 default、Tasks explicit global 和项目行绑定三类入口。

---

## 当前状态：todo-write-sticky-summary（已完成，完整门禁通过）

- 目标：为非简单多步骤任务提供 QuickForge 原生 `todo_write` 完整快照工具，并把最新成功快照显示为 Composer Dock 内、`message-editor` 前的正常流任务摘要；同时兼容 OpenCode `todowrite` 当前消息与历史工具展示。
- 服务端实现：`server/tools/definitions.mjs` 定义 `todo_write` 严格 schema（完整最新 `todos` 快照、最多 20、每项仅 `content/status`、三态 `pending/in_progress/completed`、空数组清空、`executionMode: sequential`）；`server/tools/index.mjs` 的 `toolTodoWrite` 防御校验并返回 `todo_write_result`；`server/agent-manager.mjs` 默认免审批但不归入安全读取；`server/custom-commands.mjs` 既有 `/plan` 权限链明确拒绝；`server/routes/tools.mjs` 禁止 direct REST；`server/system-prompt.mjs` 指导仅在非简单多步骤任务维护简短当前计划。
- 数据语义：没有新增独立 todo store、SQLite 表或其他持久化权威源。成功快照随普通 `toolResult` 消息写入现有会话消息；空数组是显式清空。错误、畸形或未成功工具结果不覆盖上一有效快照。
- UI 实现：`src/components/chat/panel-decoration/todo-write-summary.ts` 负责严格规范化、QuickForge/OpenCode 消息提取与任务摘要 controller；`ChatPanelHost.tsx` 创建 controller、每轮装饰更新并在卸载 cleanup；`panel-decoration.ts` 只做兼容导出；`src/index.css` 与 `src/lib/i18n.ts` 提供轻盈内嵌样式和双语。摘要位于 Composer Dock 正常流，展开时自然压缩上方消息区，不覆盖消息或输入框；长列表内部滚动，桌面约显示 4 项、移动约显示 3 项。
- Composer 顺序与生命周期：sibling 顺序为任务摘要 → command/file 临时建议菜单 → `message-editor` → stats，菜单紧邻输入框。无有效 Todo 不显示；首次未完成自动展开；用户手动展开/收起状态在后续未完成快照保留；新 toolCall 即使内容相同也短暂显示“已更新”；全完成自动收起且可重开；成功空数组或回滚到无快照移除并重置；editor/shell 重建时按当前快照自愈；`readOnly` 页面无 Composer Dock 时不显示。
- Slash overlay：`slash-invocation-chip.ts` 的 invocation overlay 同时观察 textarea 与 `.quickforge-composer-shell`。任务摘要插入、展开或收起改变 Composer 几何时会重算 overlay；editor/shell 自愈重建时重新绑定，两路 observer 在重建与卸载路径成对 disconnect/cleanup。
- QuickForge/OpenCode：QuickForge 从成功 `todo_write` 的 `toolResult.details.todos` 读取；OpenCode 当前消息分支识别 `opencode_tool` 的 `todowrite` ACP metadata，按 `toolCallId` 向前配对 assistant tool call，从顶层 `arguments.todos` 或 `rawInput.todos` 取快照。历史工具消息仍留在既有过程折叠中，不被 Composer Dock 摘要替代。
- 历史 renderer：`src/lib/todo-write-history.ts` 提供纯视图模型；`src/lib/local-tools.ts` 注册原生 `todo_write` renderer，并只对 OpenCode `todowrite` metadata 走专用分支。状态准确区分 running、error、success、clear、neutral；历史文案只陈述“更新任务清单 / 清空任务清单”，不声称同步当前 UI；`detailed` 才显示 input/details JSON。
- 审查修复：两个 major 已修复：①摘要从聊天消息区顶部调整到 Composer Dock 正常流，并补齐 sibling 顺序、内部滚动、readOnly、重建自愈与清空/回滚移除；② Slash overlay 增加 composer shell 观察与 observer 成对 cleanup。`DESIGN_LANGUAGE.md` 无需更新，复用既有轻盈内嵌工具模式。
- 测试与最终门禁：定向 `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts tests/frontend/slash-invocation-chip.test.ts tests/server/tools/definitions.test.mjs tests/server/tools/index.test.mjs tests/server/routes/tools.todo-write.test.mjs` → 6 files / 89 tests passed；`npx tsc -b --pretty false` → exit 0。完整 `npm run test -- --reporter=dot` → 242 files / 2112 tests passed；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → passed，仅既有 KaTeX 字体解析与 chunk size warning。
- 验证过程：首次完整 `test/lint/build` 链通过；为了提取数量二次运行全量 test 时，`tests/server/cloud/qf-agent-process.test.mjs` 的 “does not double start while a restart timer is pending” 出现一次无关定时器波动（1 failed / 2111 passed），单文件复跑 28/28 通过，随后全量 242 files / 2112 tests 通过；未为此修改代码。
- Blocker / 下一步：无 blocker；下一步仅可选真机目视输入框上方任务摘要、长列表、`/` 与 `@` 菜单、slash chip、深浅主题及窄屏。
- 边界：不要把任务前 `package-lock.json` 的 43 行 peer 元数据噪音纳入功能；`artifacts/todo-write-interaction-prototype.html` 是保留原型，正式实现不依赖、未归入正式功能；无关未跟踪 `').Groups[1].Value` 未触碰、不纳入功能。未新增依赖/存储表，未手工修改生成产物。
- Git：未创建 commit、tag 或 push；本会话也未执行这些操作。

---

## 前轮会话：release-v1.8.0（已完成，发布记录）

- 本会话目标：完成 v1.8.0（minor）发布：整合当前功能改动、提升版本、准备 CHANGELOG、完整门禁、runtime/offline 打包、release commit/tag/push 与用户执行 npm publish 的发布顺序。
- 前置与版本：起始 `dev` 带全部当前改动（`/commit`、自定义模型入口、文档与簿记等 20 条目），已作为功能提交 `56d435d` 纳入；`master` 以 `--ff-only` 快进，无 merge commit。package 双文件已 1.7.12→1.8.0；CHANGELOG 已按 `v1.7.12..HEAD` 的 17 个提交准备；README 无固定版本引用，未修改。
- 发布门禁：`npm run test` → 239 files / 2068 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- 打包结果：prepare-runtime-package / prepare-offline-package 成功；package-offline 内 npm pack 成功。
- tarball：`package-offline/shawnstack-quickforge-1.8.0.tgz`，25,273,416 bytes，326 files 清单。
- 元数据：package-dist 与 package-offline 均 `@shawnstack/quickforge@1.8.0`，均无 devDependencies/scripts；offline 包保留 `@vscode/ripgrep` 与 `node-pty` 的 optionalDependencies 策略（与 v1.7.12 相同，打包脚本零改动）。
- Git：三个生成目录被 .gitignore 排除；release commit 范围为 6 个发布文件（CHANGELOG、package.json、package-lock.json、feature_list.json、progress.md、session-handoff.md）；发布后 `dev` 与 `master` 同步指向发布提交。
- 发布顺序：release commit → 创建 tag `v1.8.0` → `dev` 快进至发布提交 → 原子推送 `master`/`dev`/`v1.8.0` → 用户执行 npm publish。

---

## 前轮会话：main-chat-model-selector-settings-entry（已完成，要点归档）

- 目标：仅在主聊天的模型选择桌面浮层和移动抽屉底部增加低强调“自定义模型”，点击先关闭选择器，再进入设置 `customModels` 列表页；共享对话、Agent 表单等复用场景保持无入口。
- 实现：`ModelSelectorOptions` 新增语义独立的可选无参 `onOpenModelSettings`，保留第四个旧编辑回调参数兼容但不复用。`useModelActions` 主聊天调用在 options 中传既有 `openModelSettings`（其落点为 `openSettingsPage('customModels')`）；桌面 `quickforge-model-menu` 与移动 `quickforge-model-sheet` 均条件渲染共享设置按钮。按钮点击执行 `closeComposerModelMenu(anchor)` 后才调用回调，确保 DOM 已移除且 trigger `aria-expanded=false`。共享页与 `openModelSheet` 表单调用不传回调，入口不出现；原模型选择与思考等级行为未改。
- 样式/i18n：新增中英文可见文案与 aria-label。footer 使用既有 border/muted token、透明底与克制 hover/focus 背景，不位移；移动 footer 是 `flex: 0 0 auto`，位于 `flex:1 + overflow-y:auto` 的模型列表之后，长列表只滚动中部内容。
- 测试：新增 `tests/frontend/custom-model-selector.test.ts`，覆盖桌面/移动有回调显示、无回调隐藏、点击关闭后跳转顺序、aria、移动 footer 布局/hover/focus CSS 契约，以及桌面模型选择行为回归；扩展 `use-model-actions-cloud.test.ts` 覆盖主聊天确实传回调且落到 `customModels`。
- 文档：同步 `docs/wiki/src/lib/README.md` 的模块行数与可选回调/调用场景契约。`DESIGN_LANGUAGE.md` 无需修改，因为实现直接复用其既有轻盈、低强调、统一分隔线和 hover 不跳动原则，未引入新视觉范式。
- 验证：定向 Vitest 4 files / 15 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；需求文件 `git diff --check` 通过。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改 `dist/package-dist/package-offline`；build 仅重建被忽略的 `dist/`。工作区开始时已有 `/commit`、README/Wiki、package-lock 等其他未提交改动，本功能只做增量修改，未覆盖或回退。
- 下一步：无 blocker；可选真机确认桌面浮层、移动长列表抽屉、深浅主题及设置页打开动画衔接。

---

## 当前状态：file-reference-root-browser（已完成）

- 目标：Composer 输入 `@` 时从当前项目根目录一级开始浏览；目录可点击或用 Enter/Tab 逐层进入；文字只筛选当前目录；当前层全部展示并滚动浏览；文件继续使用既有结构化 context reference。
- 服务端：`server/routes/workspace.mjs` 新增 `listWorkspaceMentionChildren` 与 `GET /api/workspace/mention-children?projectId&path`。路由严格调用 `registeredProjectContextFromId`，未知/删除项目 404 `PROJECT_NOT_FOUND`，不回退默认 workspace；当前目录与每个子节点均走 mention 级 `allowSensitive:false` validator 和 realpath 复查，排除敏感项、项目外/敏感真实目标链接。审查修正补齐解析后 `SKIP_DIRS` 过滤：普通 `node_modules`、名为 `node_modules` 的目录链接、以及安全别名指向任意 `node_modules` 子树均不返回；普通安全目录符号链接继续允许。一次返回当前层全部直接子文件/目录，目录优先；不递归、不分页。`server/index.mjs` 已接入 dispatcher。旧 `mention-search` 保留兼容。
- 前端：`file-reference-suggestions.ts` 裸 `@` 立即加载根目录；目录行用独立 folder 图标，点击/Enter/Tab 只进入目录且不产生引用；文件选择继续复用原 token 删除、最多 8 个引用去重、chip/草稿/发送链。输入文字按当前层 `name` 大小写不敏感本地过滤，无 debounce/递归搜索请求；菜单不做 entries slice，全部行由既有 max-height/overflow-y 滚动。菜单关闭后重置到根目录；保留 IME、Esc、Arrow、菜单互斥和 context chip 行契约。审查补测确认旧目录请求迟到不会覆盖当前根目录，`remove()` 会中止 in-flight 请求，`cleanupTextareaHandler()` 会移除 keydown/composition listeners。
- 测试：前端覆盖裸 `@` 根目录加载、当前层筛选不追加请求、Enter 进入目录 + Tab 选文件、25 项不截断、请求竞态/Abort/cleanup、既有引用/chip 共存；服务端覆盖 205+ 当前层全部返回、直接子节点、不递归、普通与链接/别名 `node_modules` 过滤、安全普通目录链接、敏感项与链接过滤、路径拒绝、严格项目上下文及 dispatcher。
- 文档：更新 `docs/wiki/server/routes/README.md` 与 `docs/wiki/src/components/README.md`；`DESIGN_LANGUAGE.md` 无需修改（复用既有浮层、滚动与轻量图标模式，未引入新视觉范式）。
- 验证：审查收口 `npx vitest run tests/server/routes/workspace-tree-on-demand.test.mjs tests/frontend/file-reference-controller.test.ts` → 2 files / 29 tests 全通过；目标 `npx eslint` 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过（仅既有 CRLF→LF warning）。完整门禁：`npm run test` → 238 files / 2062 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- 边界：未新增依赖，未修改 dist/package-dist/package-offline，未创建 commit/tag/push；任务前已有 `/commit`、package-lock 等无关未提交改动，均保留未覆盖。

---

## 当前状态：slash-menu-click-outside-dismiss（已完成）

- 目标：用户反馈输入 `/` 弹出指令菜单后，点击非命令区域应收起菜单。
- 根因：第一层问题是 document pointerdown 对 `editor.contains(target)` 放行，导致点击输入框/Composer 控件不收起；去掉该放行后又暴露重开竞态——菜单 DOM `remove()` 会触发 MutationObserver → decorate → 无参数 `update()`，正文仍以 `/` 开头时菜单立即重建，catalog 回调同样可能无参数刷新。
- 实现：新增用户关闭抑制态与统一内部删除 `removeMenu()`。菜单外 pointerdown、Escape、公开 `remove()` 先置抑制再删除；无参数 `update()` 在抑制态仅保持关闭，下一次真实输入显式 `update(value)` 解除抑制并正常打开/过滤。选中行、chip 激活、非 Slash 文本和无结果等内部删除不进入抑制。document pointerdown handler 改为控制器级单例，所有删除路径及 `cleanupTextareaHandler()` 均经 `removeMenu()` 清理，避免 listener 泄漏/累积；handler 判断当前 suggestions，兼容内部重建。菜单本体 pointerdown 仍不关闭；`@` 菜单未改。
- 测试：fake document 真实记录 capture listener。共 18 用例，新增/扩展覆盖点 textarea/菜单外关闭、Esc、公开 remove；三种用户关闭后 `instance.update()` 不重开；下一次显式 `update('/...')` 重开；catalog resolve 回调与多次过滤重渲染始终只有一个 pointerdown listener；controller cleanup 后 listener 清零。
- 验证：`npx vitest run tests/frontend/command-suggestions.test.ts` → 1 file / 18 tests passed；`npx vitest run tests/frontend/command-suggestions.test.ts tests/frontend/slash-invocation-chip.test.ts tests/frontend/composer-plus-menu.test.ts` → 3 files / 49 tests passed；`npx eslint src/components/chat/command-suggestions.ts tests/frontend/command-suggestions.test.ts` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` → exit 0（仅 `feature_list.json` 既有 CRLF→LF warning）。
- 文档：`docs/wiki/src/components/README.md` 同步关闭抑制、显式输入解锁与统一 listener 清理契约，command-suggestions 行数更新为 495。DESIGN_LANGUAGE 无需更新（无新视觉模式，仅交互 bugfix）。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改生成目录；工作区并行未提交改动（/commit 功能、package-lock 噪音等）全部保留。
- 下一步：可选真机验证点击输入框/消息区收起、继续输入重开、点击菜单行仍正常插入（含触屏与深浅主题）。

---

## 当前状态：builtin-slash-commit（已完成）

- 目标：实现 QuickForge 内置 `/commit [message]`，可选提交信息，prompt 保持简短，并安全地只创建当前任务的一个本地 commit。
- 实现：`server/custom-commands.mjs` 增加 catalog/help、带/不带参数解析与项目限定；`server/agent-manager.mjs` 注入 `allowEdit=false / allowCommands=true / allowSubagents=false`，使用 6 条规则的短 prompt，覆盖仅提交任务文件、禁止批量 add、验证失败停止、不编辑/不混入/不绕过 hooks、最多一个本地 commit、禁止远端动作、缺省 message 生成与结果报告。前端 Slash 菜单增加 `/commit [message]`，点击/Tab 插入 `/commit `；i18n 中英文、README、server/components Wiki 已同步。
- 测试：custom commands 覆盖 catalog/help、带/不带参数、项目限定和权限；现有 Slash 集成测试扩展真实 runPrompt 命令状态与 prompt 关键约束；前端建议测试覆盖行数、usage/description 与插入行为。
- 验证：定向 Vitest 3 files / 78 tests passed；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 238 files / 2050 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- 边界：未修改 AGENTS.md/agents.md、未新增依赖、未手工修改生成目录、未创建 commit/tag/push；工作区任务前已有 `package-lock.json` peer 元数据差异，本轮未修改或还原。

---

## 当前状态：并行插件标签功能已提交（commit-only 会话）

- 本会话任务：用户要求提交工作区代码；未修改任何功能代码。
- 新增提交：`4f0182f fix(ui): 点击 slash chip 不再露出命令原文`（slash-invocation-chip.ts + 测试 + index.css 专属 pointer-events hunk，经 `git apply --cached` hunk 级拆分）；`abbc7cd feat(chat): 插件标签链路与用户消息插件回显`——composer-plugin-chips-inside-editor 与 user-message-selected-plugin-chips 两功能在 capability-suggestions / i18n / composer-drafts / chat-utils 等文件内改动交织，无法按文件干净拆分，合并为一笔，含 selected-capabilities 前后端新模块、服务端 canonical 权威链、用户消息/分享回显与三份 Wiki 同步；状态记录随后以独立 docs commit 收口。
- 提交前完整门禁（最终工作树）：`npm run test` → 238 files / 2043 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）。两个 commit 的 hook lint 均通过（同一既有 warning）。
- 未提交项：`package-lock.json` 仍为 npm 11.6.2 的 43 行 peer 元数据噪音，沿前几轮会话约定未提交也未丢弃，待用户在统一 npm 版本策略下定夺。
- 下一步：未 tag、未 push（除非用户明确要求）；可选真机验证项见各 feature 记录（slash chip 点击光标落末尾、插件/文件混合标签、分享页插件标签）。

---

## 当前状态：slash-chip-click-keeps-chip（已完成）

- 目标：修复用户真机反馈——选中 agent 后 Composer 内的小 tab（slash chip）被点击时直接露出 `/agent <name>` 命令原文，用户不希望点击显示文字。
- 根因：`.quickforge-slash-overlay` 整体 `pointer-events:none`，点击 chip 穿透到 textarea 的 `/skill|/agent` 前缀区，光标进入前缀触发 document selectionchange 的降级逻辑（隐藏覆盖层 + 卸透明 class → 原文可见）。
- 实现：`src/index.css` 新增 `.quickforge-slash-overlay .quickforge-slash-chip { pointer-events: auto; }`（仅输入框覆盖层内 chip 可点击，消息流 chip 保持纯展示）；`src/components/chat/slash-invocation-chip.ts` 的 `renderChipContent` 为覆盖层 chip 挂 `pointerdown` 监听（项目惯例同 capability-suggestions × 按钮）：preventDefault 吃掉默认行为后聚焦 textarea 并把光标移到文本末尾，chip 保持显示、不降级。共享工厂 `createSlashChipElement` 未改、不挂监听。键盘方向键进入前缀区的降级/自愈、IME composition、自愈重建逻辑均未触碰。
- 测试：`tests/frontend/slash-invocation-chip.test.ts` 新增 1 用例——chip 恰好 1 个 pointerdown 监听、preventDefault 调用、focus + 光标落文本末尾、选中态保留不降级（overlay 可见 + 透明 class 保留），并断言 CSS 只有覆盖层内 chip 开启 pointer-events。
- 验证：定向 vitest slash-invocation-chip + command-suggestions → 2 files / 36 tests；相邻 message-actions / composer-plus-menu / slash-catalog → 3 files / 29 tests；改动源码/测试 eslint 0 error；`npx tsc -b --pretty false` 通过。
- 文档：同步 `docs/wiki/src/components/README.md`（模块树与章节行数 528→541、交互契约补点击行为）；DESIGN_LANGUAGE 无需更新（无新视觉模式，仅 pointer-events 与既有交互习惯）。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改生成目录；工作区并行未提交改动（plugin-chips 会话等）全部保留。
- 下一步：可选真机验证点击 skill/agent chip 光标落末尾、原文不露出（含触屏与深浅主题）。

---

## 当前状态：user-message-selected-plugin-chips（已完成）

- 目标：发送后在用户消息气泡显示本轮已选插件标签；retry/continue 复用原插件；分享页保留插件标签。依赖未提交但已完成的 `composer-plugin-chips-inside-editor`，其差异完整保留。
- 数据规范：前端 `src/lib/selected-capabilities.ts` 与服务端 `server/selected-capabilities.mjs` 使用匹配规则——只收合法对象/字符串，type 限定 plugin/skill/tool/command，裁剪字段长度，按 `type+pluginName+name` 去重、保持顺序、最多 4 项。`details.selectedCapabilities` 快照仅持久化 type/pluginName/name/label；服务端历史读取 `selectedCapabilitiesFromMessage` 与前端 `selectedCapabilitiesFromDetails` 均再次投影快照字段，因此历史 `details.description` 即使伪造也会被丢弃，retry/continue prompt 不可读取。description 仅可来自新发送请求顶层 selectedCapabilities，参与该当前轮临时 capability prompt。未知插件不依赖 registry，可历史展示。
- 实时/权威链：ServerAgent、Deferred 首条乐观 user message 都写入快照，可与 `details.contextReferences` 共存；请求体继续发送 canonical selectedCapabilities，一次消费后下一轮不泄漏。`runPrompt` 不信任客户端消息 details，以顶层 canonical 数组覆盖；空数组删除伪造/陈旧字段但保留其他 details。activeCapabilityPrompt 使用同一 canonical 结果，message converter 仍剥离 details，正文/复制/标题不受标签污染。
- 历史/重试/分享：message-actions 只从 details 读取，在现有 context chip 行中插件在文件前，复用 createCapabilityChip 与三类专用图标/未知 fallback；只读调用不传 onRemove，无 ×，三态 aria、replaceChildren 幂等及空数据清理保留。审查收口仅最小导出 `decorateUserContextChips` 供 fake DOM 行为测试，实际覆盖混合顺序、二次调用不重复、混合→空删除、历史无 remove、三态 aria；另通过真实 `decorateMessages` copy 点击确认复制仍走原始 `draftTextFromUserMessage`。continueSession 从最后用户消息恢复 capability prompt，同时保留文件引用重校验，但 description 已由历史快照边界剥离。分享输出只删除 contextReferences，保留 selectedCapabilities。
- 文档：已同步 `docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/server/README.md`；未改 DESIGN_LANGUAGE（复用既有 chip 视觉模式）。
- 验证：审查收口定向 Vitest 9 文件 / 87 用例全通过；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` 238 文件 / 2043 用例 100% 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 与 feature JSON 解析通过。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改生成目录；build 仅重建被忽略的 `dist/`。`package-lock.json` 最终 blob hash 仍为 `a7f0bb9fcb4de96f8953024be8ac588435dcc3ab`，仅任务前既有 peer 元数据差异，本 feature 未修改/还原。严格未触碰并行 slash feature 的 `src/components/chat/slash-invocation-chip.ts`、其测试及专属逻辑；共享 Wiki/状态文件仅精确修正本 feature 记录并保留并行 feature 状态。

---

## 当前状态：composer-plugin-chips-inside-editor（已完成）

- 目标：把 Composer 用户界面的“能力”入口改为“插件”，并把插件/文件共享标签行稳定放进 `message-editor` 真正输入卡片内、textarea 上方；内部 capability 协议不重命名。
- 实现：`src/lib/i18n.ts` 保持 Plugins/插件、Selected plugins/已选插件、Remove plugin/移除插件，并新增混合态 `Selected plugins and referenced files / 已选插件和引用的文件`。`chat-utils.ts` 的 `ensureComposerContextChips` 继续以 textarea 父元素定位输入卡片，DOM/mock 不完整时安全返回 null；新增 `syncComposerContextChipsAriaLabel`，由 capability/file 两个控制器完成自身 chip 增删后统一调用：仅插件用已选插件、仅文件复用引用的文件、混合明确表达插件和文件，空容器移除。两类 chip 在任一同步/删除顺序下互不删除。插件标签按 `pluginName` 为 documents/spreadsheets/presentations 使用现有 document/spreadsheet/presentation 图标，未知插件回退 plugin 图标；多选、去重、草稿恢复、显式 × 删除和发送一次性消费保持。
- 样式/文档：`src/index.css` 仅收紧卡片内标签布局并降低有标签时 textarea 顶部 padding，未改 `.quickforge-composer > div:first-child` 根卡片选择器，文件标签语义色保留；组件 Wiki 已将 `chat-utils.ts` 更新为真实 340 行，并记录共享容器三态 aria-label/空容器契约。`DESIGN_LANGUAGE.md` 未修改（无新视觉模式）。
- 测试：真实近似双控制器 harness 参数化覆盖 file-first/plugin-first 两种同步顺序、同步不互删、分别删除后保留另一类、最后一项删除移除空容器，以及仅文件/仅插件/混合 aria-label；同时保留输入卡片位置、专用图标、插件文案、文件 helper、Composer drafts/恢复、Skill/Agent Slash 回归。定向 9 files / 77 tests 通过。
- 完整门禁：目标 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run test -- --reporter=dot` 236 files / 2024 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- 边界：feature 保持 done，无 blocker；未创建 commit/tag/push，未新增依赖。`package-lock.json` 仍是任务前既有 43 行 peer 元数据差异，本次未修改/还原。未手工修改 `dist/`、`package-dist/`、`package-offline/`；build 仅重建被忽略的 `dist/`。
- 下一步：可选真机目视深浅主题、窄宽度、多插件与文件混合标签、× 删除、发送后消费及读屏名称。

---

## 当前状态：工作区剩余功能已安全拆分提交

- 分支/基线：`dev`，起始 HEAD `72ac7e09`，无 upstream；未 amend 既有提交，未 tag、未 push。
- 新增提交：`d66a3e7 feat(ui): 按会话隔离 Workspace Inspector 状态`；`924e8c5 feat(ui): 优化 Slash 菜单名称与图标`；`b64a4b2 fix(ui): 调整 Composer 控件悬停反馈`；本状态记录将以独立 docs commit 收口。
- 完整门禁：`npm run test` → 236 files / 2020 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check`、`feature_list.json` / `package.json` / `package-lock.json` JSON 解析通过。每个 commit 前均复核 cached diff/stat/check，commit hook lint 也均通过（同一既有 warning）。
- 未提交项：`package-lock.json` 只有 npm `peer` 元数据变化，`package.json` 无依赖或版本变化；当前 npm 11.6.2 对 HEAD 锁文件隔离重算可产生相同结果，因此判定为工具链噪音。未擅自提交，也未 restore/checkout 丢弃，后续需在统一 npm 版本策略下决定是否单独规范化。
- 生成产物：`dist/`、`package-dist/`、`package-offline/` 均由 `.gitignore` 忽略，未纳入提交。
- 下一步：如需彻底干净工作树，请用户确认是否接受单独提交 npm 11.6.2 的 lockfile peer 元数据规范化；否则保留现状即可。不要 push，除非用户另行明确要求。

---

## 当前状态：sidebar-section-title-drag-collapse（已完成）

- 目标：移除 Projects / Tasks 专用六点拖拽按钮，改为直接拖动标题主 toggle；拖动任一区块时两个区块都临时收缩，结束/取消后恢复原折叠状态。
- 实现：`SortableSidebarSection` 的 `setActivatorNodeRef`、attributes、listeners 仅绑定 Projects / Tasks 标题 toggle；标题保留原 `onClick` 折叠回调，并通过独立 `draggableSectionTitleClass` 增加 `touch-none`、`cursor-grab` 与 dragging 时 `cursor-grabbing`。共享 `sectionToggleClass` 恢复普通折叠标题样式，Pinned 不使用 draggable class、activator 或 listeners，继续保持默认 pointer/触摸行为。外层 PointerSensor 保持 6px 激活阈值，KeyboardSensor 接线保留；右侧筛选、展开全部、添加、新建等 action buttons 未绑定 listeners。
- 临时折叠：`draggingSectionId !== undefined` 派生 `projectsVisuallyCollapsed` / `conversationsVisuallyCollapsed`，任一区块拖动时两者同时为 true；Chevron、`aria-expanded`、`SortableSidebarSection.collapsed` 与实际内容 grid 全部使用派生状态，内容收缩增加 `transition-none`。`finishSectionDrag` 同时服务 cancel/end，仅清空 dragging state，不调用 `onToggleProjectsCollapsed` / `onToggleConversationsCollapsed`，因此恢复各自原状态。
- 保留边界：折叠 `shrink-0`、展开 Tasks `flex-1`、展开 Projects `max-h-[55%]`、顶层 flex/min-h-0/overflow-hidden、设置区 `mt-auto shrink-0`、Projects 内部嵌套 DnD/MeasuringStrategy/视口边界/排序持久化均未改。
- 测试与文档：更新 `tests/frontend/sidebar-section-order.test.ts`（移除专用 handle 契约，覆盖标题 activator、Pinned 与 draggable class 隔离、action 隔离、双派生折叠、视觉恢复接线与 transition-none）；同步 `docs/wiki/src/components/README.md`。`DESIGN_LANGUAGE.md` 无需修改，未新增视觉模式。
- 验证：定向 vitest 2 files / 21 tests；目标 eslint 0 error；`npx tsc -b --pretty false` 与 `git diff --check` 通过；前一轮完整 `npm run test` 236 files / 2020 tests 全通过、`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）、`npm run build` 成功（仅既有 KaTeX/chunk warnings），本次极小局部修复未重复全量门禁。
- 边界：未新增依赖，未手工修改生成目录，未创建 commit/tag/push；工作区并行未提交改动全部保留。

---

## 当前状态：sidebar-collapsed-sections-compact-layout（已完成）

- 目标：修复 Projects / Tasks 顶层排序区块折叠后仍占据展开高度，导致按 Tasks→Projects 排序时两个折叠标题之间出现巨大空白。
- 根因：`SortableSidebarSection` 只按 ID 固定分配尺寸——Projects 始终 `max-h-[55%]`、Tasks 始终 `flex-1`，未考虑折叠状态；Tasks 折叠后仍吞掉排序容器剩余高度。
- 实现：`SortableSidebarSection` 新增 `collapsed` 参数，由调用处按 `sectionId` 在 `projectsCollapsed` / `conversationsCollapsed` 间推导。折叠统一使用 `shrink-0`；展开 Tasks 继续 `flex-1`，展开 Projects 继续 `max-h-[55%]`。保留排序容器 `flex min-h-0 flex-1 flex-col overflow-hidden`、Projects/Tasks 内部 `overflow-y-auto`、底部设置 `mt-auto shrink-0`，未改顶层/项目 DnD、顺序持久化或桌面/移动共享接线。
- 测试：扩展 `tests/frontend/sidebar-section-order.test.ts` 源码契约，覆盖 collapsed 传递、折叠 shrink-0、展开 Tasks/Projects 尺寸、排序容器、内部滚动及设置底部固定边界。
- 文档：同步 `docs/wiki/src/components/README.md`；`DESIGN_LANGUAGE.md` 无需修改（既有布局 bugfix，无新视觉模式）。
- 验证：定向 vitest 2 files / 20 tests；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` 236 files / 2019 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- 边界：未新增依赖，未修改/覆盖 `package-lock.json` 既有并行变更，未手工修改生成目录，未创建 commit/tag/push；工作区其他并行修改全部保留。

---

## 当前状态：unify-neutral-slash-icons（已完成）

- 目标：所有 Slash 图标去类别色，并让斜杠菜单 command/skill/agent 复用项目已有 Lucide `SquareTerminal` / `BookOpen` / `Bot`；不扩大到非 Slash 能力菜单。
- 实现：新增 `src/components/chat/slash-icons.ts`，使用项目已有 React 静态渲染模式把三个 Lucide 组件转换为 SVG 字符串；`command-suggestions.ts` 三类菜单行和骨架统一读取该映射，并与 canonical-name 显示调整一并收口；`slash-invocation-chip.ts` 的 skill/agent chip 同样读取映射，并删除旧 `slashAgentIcon` 自绘 glyph。CSS 菜单三类图标默认 `var(--muted-foreground)`，hover/selected 为 `var(--foreground)`；共享 `.quickforge-slash-chip-icon` 单独设为 `var(--muted-foreground)`，覆盖输入框与消息流全部复用位置。
- 颜色边界：按用户字面只中性化图标。skill/agent chip 的既有蓝/绿背景与文字语义色可通过图标子元素独立分离，因此保持不变；chip 结构、类型信息、边框/背景与行为未改。非 Slash `+ → 能力`、@ 文件引用等继续使用 `capability-icons.ts`，未受影响。
- 测试：`command-suggestions.test.ts` 断言菜单输出 `lucide-square-terminal` / `lucide-book-open` / `lucide-bot`，并锁定三类默认/hover/selected 中性 token、无类别 RGB；`slash-invocation-chip.test.ts` 断言 skill/agent 分别输出 BookOpen/Bot，旧 `slashAgentIcon` 不存在，chip icon 使用中性 token。
- 文档：`docs/wiki/src/components/README.md` 新增 slash-icons 导航，更新 command-suggestions/slash-invocation-chip 图标映射、颜色边界和模块行数。
- 验证：定向 vitest 2 files / 35 tests 全通过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` exit 0；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- 边界：未新增依赖，未手工修改生成目录；已随 canonical-name 合并提交为 `924e8c5`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。

---

## 当前状态：sidebar-section-reorder（已完成）

- 目标：完成已开始的侧栏 section reorder，让 Projects 与当前 Tasks（源码 conversations UI）两个完整区块可安全拖拽换位并在桌面/移动共用、刷新持久化。
- 实现：`src/lib/sidebar-section-order.ts` 定义 `projects/tasks` 规范化、排序和 `localStorage` 安全读写；`src/App.tsx` 持有唯一状态并传给两个 ChatSidebar。`ChatSidebar.tsx` 保持置顶区在外部固定，在区块级 `DndContext + SortableContext` 中按 `sectionOrder` 动态渲染完整 Projects / Tasks；`SortableSidebarSection` 使用 `sidebar-section:*` 命名空间 ID，水平 transform 锁定为 0、顶层 autoScroll 关闭。标题旁弱化 `GripVertical` 按钮是唯一 activator：PointerSensor 保留 6px 阈值以支持鼠标/触摸，外层另接入 KeyboardSensor + `sortableKeyboardCoordinates`，聚焦手柄后可用 Space → 方向键 → Space 完成排序；`useSortable` attributes/listeners、`aria-label` / `title` 仍绑定该手柄，折叠、添加、筛选、菜单等按钮不绑定监听。Projects 内原嵌套 DnD、视口 modifier/autoScroll、拖动折叠会话和 `onReorderProjects` 持久化未改。
- 测试：保留纯函数/storage 5 用例，源码接线契约现为 7 个，覆盖动态顺序、完整区块映射、置顶外置、外层 `sectionSensors` 同时配置 PointerSensor 与 KeyboardSensor/`sortableKeyboardCoordinates`、命名空间和安全手柄、start/cancel/end+x 锁定、项目嵌套 DnD/持久化保留、App 桌面/移动共用状态；与 project-drag-boundary 合计 19/19 通过。现有测试架构以源码契约为主，没有可低成本复用的真实 DOM dnd-kit 键盘行为 harness，因此未为本修复扩大测试基础设施。
- 文档：更新 `docs/wiki/src/components/README.md` 的 ChatSidebar 行数与交互契约；`docs/wiki/src/lib/README.md` 新增 sidebar-section-order 模块条目。未修改 DESIGN_LANGUAGE（实现直接遵循既有轻盈、克制、icon-only 可访问命名规范）。
- 验证：定向 vitest 2 文件 / 19 用例全过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；feature JSON 解析与 `git diff --check` 通过。
- 边界：未触碰 `package-lock.json` 及 Workspace Inspector、command suggestions、session actions 等并行改动；未手工修改生成目录，未新增依赖，未创建 commit/tag/push。

---

## 当前状态：session-scoped-workspace-inspector-state（已完成）

- 目标：Workspace Inspector 的展开/收起、tabs、`activePanelTabId` 与 Reader 左侧导航显示按 session 隔离恢复；Inspector 整体宽度等纯布局偏好继续全局。
- 实现：`useAgentManager` 新增稳定的 `currentRuntimeScopeId`。pending deferred session 使用自身 `pending-*` 身份；首次发送创建真实 Agent 时，`createAgent` 仅在原 deferred 仍是当前视图时附着，并通过 `attachTaskToView(task, previousAgent.sessionId)` 沿用原 scope，使 `WorkspaceInspector` 的 React `key` 不变化，组件内 open、tabs、activePanelTabId、Review 子视图、readerNavigationVisible 原样存活；`sessionId` 更新后 open hook 的 effect 与 Inspector tabs effect 把当前内存快照写入真实 `projectId + sessionId` localStorage。切换普通会话或成功附着另一 deferred session 才更换 scope；pending 自身仍不落盘。
- 请求隔离：`WorkspaceInspectorOpenRequest` 新增 `scope={projectId,runtimeScopeId}`。App 的 request bridge 发起前校验当前 scope；聊天文件 `resolveWorkspacePath` 完成/失败后同时校验 request id、project 和 runtime scope；Inspector 消费时再次校验。session A 的迟到请求不能打开或持久化到同项目 session B。历史无项目、无 scope 的 subagent 请求继续兼容。
- 新建边界：删除 App wrapper 预先递增 pending scope 的逻辑；`useChatActions` 新建动作返回 `created/reused/cancelled`，reuse、模型设置取消、无项目和异常均不会由 wrapper 提前滚动 Inspector scope。
- 测试/文档：扩展 `workspace-inspector-request.test.ts` 与 `workspace-inspector-tabs.test.ts`，覆盖同项目跨 session 拒绝、projectless subagent 兼容、pending→real key 不变及落盘接线、异步文件 scope 校验、新建 reuse/cancel 不提前滚动；同步 `docs/wiki/src/README.md`、`docs/wiki/src/components/README.md`。
- 验证：定向 6 files / 41 tests；相关 eslint 0 error；`npx tsc -b --pretty false` exit 0；最终合并工作区 `npm run test` 236 files / 2020 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 与 `git diff --check` 通过。
- 边界：未新增依赖，未手工修改生成目录；已提交为 `d66a3e7`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。

---

## 当前状态：composer-controls-hover-background（已完成）

- 目标：调整对话输入区 +、权限、模型、发送/停止按钮 hover，使用背景反馈代替 `translateY(-1px)` 跳动，同时保持中性/主操作/停止态层级。
- 实现：`src/index.css` 保留 `.quickforge-composer button:hover:not(:disabled)` 全局规则；新增精确覆盖——+、权限、模型 hover 使用 `var(--quickforge-sidebar-hover-bg)`、`var(--foreground)`、`transform:none` 且带 `:not(:disabled)`；发送 hover 使用 `color-mix(in oklab, var(--primary) 92%, var(--quickforge-sidebar-hover-bg))`、`primary-foreground`、`transform:none`；停止 hover 保留原 foreground/background 混合背景并补 `transform:none`。未改变 Plan、OpenCode config、chip/菜单项；model trigger 覆盖 OpenCode mode 为预期。
- 测试：新增 `tests/frontend/composer-control-hover.test.ts`，结构化读取 CSS 规则，验证全局规则仍存在、三个中性目标的精确 selector/token/前景/不位移、发送态 primary 混色与前景、停止态既有背景与不位移。
- 验证：定向 3 files / 16 tests 全通过；新增测试 eslint 0 error；最终合并工作区 `npm run test` 236 files / 2020 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 与 `git diff --check` 通过。
- 边界：未更新 `docs/wiki` 或 `DESIGN_LANGUAGE.md`（纯视觉反馈且现有“hover 有感知、不跳动”规范已覆盖）；未手工修改生成目录、未新增依赖；已提交为 `b64a4b2`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。
- 待确认：可选真机检查深浅主题 hover 对比度、发送 primary 层级和五类控件无垂直跳动。

---

## 当前状态：fix-session-state-clear-actions（已完成）

- 目标：修复两个同根因状态清除缺陷——取消置顶与归档恢复均需通过可序列化的 `null` 触发服务端 clear 语义。
- 实现：`src/hooks/useSessionActions.ts` 将取消置顶从 `pinnedAt:undefined` 改为 `pinnedAt:null`；`src/lib/archived-conversations-settings-tab.ts` 将删除 `archivedAt` 字段改为 session/metadata 两个 payload 都显式写 `archivedAt:null`。服务端代码未改，继续使用字符串=设置、null=清除、字段缺失=保留的三态契约。
- 测试：新增 `tests/frontend/session-state-clear-actions.test.ts`（2 用例），行为验证取消置顶传给 backend 的对象及 JSON 均含 `pinnedAt:null`，并验证归档恢复 helper 产生的两个 JSON payload 均含 `archivedAt:null`；扩展 `tests/server/storage.session-state-facade.test.mjs`，验证 null 同时清除 state/metadata、SQLite 提升列及 pinned/archive 查询过滤状态。
- 验证：合并定向 vitest 2 文件 / 27 用例全部通过；改动文件 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 通过。build 仅既有 KaTeX 字体解析与 chunk size warning。
- 边界：未修改 Wiki（仅恢复既有行为承诺，不影响架构/入口）；未修改用户已有 `package-lock.json`；未触碰生成目录，未新增依赖，未提交 Git。工作区同时存在并行会话的 slash-menu-canonical-name-display 改动，均已保留。

---

## 当前状态：slash-menu-canonical-name-display（已完成）

- 目标：普通 command 继续显示完整命令；skill/agent 菜单行只显示具体 canonical name，同时保持完整插入文本和既有类型前缀搜索。
- 实现：`command-suggestions.ts` 的 `appendUsageText` 仅切换可见主文本来源——command 继续使用 `usage`（并保留 argumentHint），skill/agent 使用 `name`；`usage`、`entryHaystack`、`insertText`、选中 chip 逻辑均未改变。
- 测试：`command-suggestions.test.ts` 断言 `/plan [task]`、`skill-creator`、`explore` 三类主文本；skill/agent 的 `data-quickforge-insert` 仍为完整命令；`/skill ` 与 `/agent ` 前缀过滤仍命中对应类型。
- 文档：`docs/wiki/src/components/README.md` 已同步显示、搜索和插入契约，并更新 command-suggestions 行数为 481。
- 验证：定向 vitest 1 文件 / 13 用例全过；改动源码/测试 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 均通过。build 仅既有 KaTeX 字体解析与 chunk size warning。
- 边界：未新增依赖、未手工修改生成目录；已与中性 Slash 图标合并提交为 `924e8c5`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。无 blocker。

---

## 当前状态：file-reference-mention（已完成）

- 目标：让聊天输入框使用 `@` 引用当前项目文件，并把插件能力选择解耦到 `+ → 能力`，保持结构化草稿、一次性发送与服务端安全边界一致。
- 关键实现：`@` 仅 files-only；裸 `@`/1 字符只提示，2+ 字符 300ms debounce 调 `/api/workspace/mention-search?projectId&query&limit=8`，支持键盘选择并生成结构化文件 chip。`+ → 能力` 生成独立能力 chip，不再插入 `@Documents`、不从正文推断。`text`、`contextReferences`、`selectedCapabilities` 写入 localStorage 草稿（能力防御规范化、按 `type+pluginName+name` 去重、最多 4；附件仍不持久化）；`contextReferences` 随下一次 prompt 一次性发送。服务端重新校验会话项目、路径、安全边界并只注入项目相对路径提示，history user message `details.contextReferences` 用于恢复文件 chip，失败回滚/retry 已覆盖。mention-search 过滤敏感文件与不安全符号链接，对未知/已删除 `projectId` 严格返回 404 `PROJECT_NOT_FOUND`，普通 workspace search/children 等兼容回退保持不变；OpenCode/shared 禁用或显式拒绝非空引用。
- 设计稿：`design-mockups/file-reference-mention.html`。
- 验证：合并定向 vitest 20 files / 242 tests passed；相关 eslint 0；`tsc -b` passed；`npm run build` passed（仅既有 KaTeX/chunk warnings）；`git diff --check` passed。未声称运行全量 `npm test` / `npm lint`。
- 限制 / 下一步：输入框只有 chip、没有正文且没有附件时不能发送；裸 `@` 不提供最近文件；真机目视待用户，重点确认键盘/IME、深浅主题、草稿恢复、发送后历史 chip、敏感路径及 404/重试提示。无代码 blocker。

---

## 当前状态：wiki-sync-uncommitted-features（已完成）

- 用户需求：同步更新当前 wiki 文档；**明令禁止修改代码，只能维护文档**。
- 最终状态：**已完成**。纯文档会话，未改任何代码/测试/生成产物。对照工作区两条未提交功能链（slash-menu-expansion 已 done、file-reference-mention 并行开发中）逐页审计 docs/wiki 并补缺口，改动集中在 6 个 md 文件：
  - `docs/wiki/server/README.md`：新增 `context-references.mjs` 独立小节（导出清单 + `CONTEXT_REFERENCE_SENSITIVE/OUTSIDE_PROJECT/NOT_FOUND/FORBIDDEN/VALIDATION_FAILED` 与 `CONTEXT_REFERENCES_INVALID/LIMIT` 错误码）；skills.mjs 小节补 `summarizeSkills()` 导出；修正 index/agent-manager/custom-commands/skills 过期行数（1006/3763/614/654）。
  - `docs/wiki/server/routes/README.md`：修正 agent/skills/agent-profiles/shared-conversation/workspace 行数（558/213/236/444/1614）。mention-search、prompt contextReferences、skills ?available、agent-profiles ?projectId、shared 拒绝等端点描述此前已由并行会话同步，核对无误。
  - `docs/wiki/server/utils/README.md`：workspace.mjs（232 行）更新为现状行为——敏感路径**大小写不敏感**匹配、realpath 后对真实目标**复查**（防符号链接伪装）、稳定 errorCode `WORKSPACE_SENSITIVE_PATH` / `WORKSPACE_PATH_ESCAPE`（403）、`createWorkspacePathValidator`。
  - `docs/wiki/src/README.md`：lib 模块数 28→86、index.css 行数 293/346→5345。
  - `docs/wiki/src/components/README.md`：ChatPanelHost 1456 / chat-utils 300（补 `FileContextReference`、`ComposerCapabilitySelection`、`MessageEditorElement` 扩展与 `hasDraft` 四元口径）/ command-suggestions 479（IME 描述更正 + 图标来源改 capability-icons.ts）/ file-reference-suggestions 404 / slash-invocation-chip 541（**行为更正为最终实现**：composition 期间覆盖层保持显示 + `.quickforge-slash-preedit` 预编辑镜像（Chromium 剥离去重 / WebKit end 拼接兜底）；selectionchange 光标入前缀区**降级显示**而非自毁、光标回尾部自愈；update 对外部移除的 overlay/textarea **自愈重建**）/ panel-decoration 286（message-actions 补 `decorateUserFileReferences`——用户消息 `details.contextReferences` 渲染 `.quickforge-message-context-references` chip 行；composer-plus-menu 补 `selectPluginCapability` 语义与浮层互斥）。
  - `docs/wiki/src/lib/README.md`：表新增 `deferred-session-agent.ts`（296 行，此前 wiki 完全未收录）+ 独立章节；server-agent 2047 行小节补 `setPromptMode('plan'|'ask'|null)` 泛化（'ask' 预留值、无发送方；`setPlanMode` 兼容包装）；shared-server-agent 488 行补结构化选择 no-op；i18n 3337；slash-catalog 102。
- 注意：`setPromptMode('ask')` 在 server-agent / deferred-session-agent / shared-server-agent 三处 API 均已存在但**当前无任何 UI 调用方**、服务端也无对应 command 消费——按源码现状如实文档化为预留值；若 file-reference 会话后续实现 ask 模式，记得回来更新。
- 验证：全部事实与源码逐一核对（wc -l / grep 导出 / 阅读最终实现）；git status 确认除并行会话既有改动外无代码变更。未创建 commit/tag/push。

---

## 前轮状态：rename-sidebar-conversations-to-tasks（已完成）

- 用户需求：左侧边栏的“对话”分组标题更名为“任务”。
- 最终状态：**已完成并验证**。`src/lib/i18n.ts` 的 `conversations` key（唯一使用处为 `src/components/sidebar/ChatSidebar.tsx` 左侧边栏分组标题 `t('conversations')`）：中文 `对话` → `任务`，英文 `Conversations` → `Tasks`；key 名、`conversationsCollapsed` 等组件状态与折叠逻辑未动。`DESIGN_LANGUAGE.md` 中 3 处以 Conversations 作为侧栏分组标题示例的提及同步为 Tasks。
- 验证：`npx eslint src/lib/i18n.ts` → 0 error；`npx vitest run tests/frontend/i18n-language-snapshot.test.ts tests/frontend/sidebar-session-sort-mode.test.ts` → 2 files / 11 tests 全通过。`npx tsc -b` 报错全部来自并行会话 file-reference-mention 功能中间态文件（file-reference-suggestions.ts、ChatPanelHost.tsx、capability-suggestions.ts、composer-plus-menu.ts、panel-decoration.ts），无一涉及 `src/lib/i18n.ts`。
- 遗留：真机目视确认左栏标题显示“任务”/英文 "Tasks"；其余“对话”相关文案（置顶、暂无对话、已归档对话、重命名对话等）按最小范围保持不变，如需一并更名待用户确认。本会话未创建 commit/tag/push，未手工修改生成目录。

---

## 前轮状态：slash-menu-expansion · 方案 A 选中态 chip（已完成）

- 用户需求演进：①/ 触发「指令/技能/子智能体」菜单（已完成）→ ②选中后输入框内联 chip + 消息流 chip（设计稿两轮澄清后定稿方案 A：输入行内联）。
- 最终状态：**已完成并验证**。新增 `src/components/chat/slash-invocation-chip.ts`（纯逻辑前缀解析/匹配/剥前缀计划/spacer 宽度 + env 注入可单测的控制器：engage/isActive/isDismissed/update/clear/removePrefix/cleanup；覆盖层挂 .quickforge-composer-shell，幽灵层同步 computed 字体/行高/padding/tabSize/scrollTop，ResizeObserver 重同步；IME compositionstart 隐藏恢复；selectionchange 光标入前缀区自毁不记 dismissed）；command-suggestions 集成（skill/agent 选中 engage、激活抑制菜单、catalog ready 自动 engage 含草稿恢复/手输、Backspace 在 cmd 长度处一次删前缀、Esc 退出记 dismissed）；message-actions decorateUserSlashInvocationChip（用户消息前缀 chip，chip 自带 dataset.quickforgeSlashChipPrefix 幂等还原，复制走 draftTextFromUserMessage 原文）；index.css slash-overlay/-ghost/-source-text/-spacer/-chip 全套 + html.dark 变体（.quickforge-composer-shell 已有 relative 未重复加）。
- 关键取舍（subagent 偏差均合理）：还原机制按 chip 标记而非 container 快照（Lit 重渲染会整体替换 markdown 子树）；selectionchange 自毁不记 dismissed（Esc 才记，防 Esc 被下次输入覆盖）；update 校验加词边界（/agent explore-deep 不匹配 /agent explore）；消息流装饰测试走纯函数 + 源码/CSS 断言（现有 harness 无浏览器 DOM 渲染 markdown-block）。
- 验证：npm run test → 226 files / 1945 tests 全通过（含 input-clamp 既有断言随 if 块化修正，守卫语义不变）；npm run lint → 0 errors / 1 existing warning；npx tsc -b → 0；npm run build 成功（仅既有 warning）；git diff --check 通过。
- 遗留：真机目视留待用户——重点验证方案 A 风险点（光标与幽灵文本对齐、中文 IME composition、窄列宽换行、字号设置缩放后重同步）；消息流 chip 深浅主题观感。若对齐在真机不可接受，回退路径：保留消息流 chip + 输入框退回纯文本（或改方案 B chip 行）。
- **追加修复（用户真机反馈「打字后 chip 消失」）**：最小复现环境（真实 MessageEditor + 真实装饰代码 + 无头 Edge CDP：选中→打字→多行→逐字符→IME 全链路）无法复现，判定破坏源为真实 app 的 React/Lit 生命周期操作（静态排查未定位唯一移除者）。修复为自愈式三层防御：① update 时 overlay/textarea 被外部移除或重建（isConnected 检查）→ 重建挂载而非放弃选中态（重 resolve targets、重建 overlay/chip/listeners/透明 class）；② selectionchange 光标入前缀区由「自毁」改为「降级显示原文」，光标回尾部自动恢复（防 selection 被程序重置的瞬时值 + 用户误点不再永久丢 chip）；③ 既有自动 engage（catalog 命中即重挂）继续兜底。测试更新：selectionchange 用例改降级/自愈语义，新增 overlay 外部移除重建、textarea 重建重挂两用例（19 通过）。临时复现文件已删（repro-slash.html/repro-slash-main.ts/repro-cdp.mjs），临时 vite(5199)/无头 Edge 进程已清理。
- 本会话未创建 commit/tag/push，未新增依赖，未手工修改生成目录。设计稿 design-mockups/slash-menu-expansion.html 已标注方案 A 定稿。

- **并行会话冲突记录（本轮）**：用户要求 build 时发现另一并行会话正在开发 file-reference-mention 功能（@ 文件引用，新增 file-reference-suggestions.ts / capability-icons.ts，改写 capability-suggestions.ts / chat-utils.ts / ChatPanelHost.tsx / composer-plus-menu.ts），其中图标注册表被抽到新模块 capability-icons.ts 导致 slash-invocation-chip.ts import 断链——已修复（改 import './capability-icons'）。该会话其余中间态错误（i18n key 缺失、类型未同步）未触碰，等其收尾后 build 才能恢复全绿；dist/ 保持本会话上次完整成功构建产物（含自愈修复，已验证）。

- **IME 期间 chip 保持显示（用户第二轮真机反馈「中文输入过程中标签消失，输入完恢复」）**：原 compositionstart 防护是「隐藏覆盖层 + 移除透明 class 回退原文」——正是消失元凶。改为 composition 期间覆盖层持续渲染：新增 compositionupdate 监听，预编辑（拼音串）镜像进幽灵层尾部（.quickforge-slash-preedit 弱下划线提示输入中；Chromium 下 value 已含预编辑则从任务文本中剥离避免重复，WebKit 兼容 end 手动拼接）；update 在 composition 中改为实时 render 而非挂起（pendingText 机制整体移除）；顺手修复 renderChipContent 重建时旧 textNode/preeditEl 残留 bug。测试：composition 用例重写为保持显示 + 预编辑镜像 + WebKit/Chromium 双路径 + 残留清理断言（19 全过）。验证：定向 vitest 32/32、eslint 0 error；全量 npm run test 有 29 个失败**全部来自并行 file-reference 会话中间态**（updateFileReferenceSuggestions/setPromptMode/composer-plus-menu 等，与本 feature 无关）；`npx vite build` 直接产出成功（tsc -b 被并行半成品阻断，vite 不做类型检查），三个 slash 标记（overlay/preedit/self-heal）均确认进入 dist。

---

## 前轮状态：slash-menu-expansion 主功能（已完成）

- 本会话目标：聊天输入框 `/` 触发的补全菜单扩展为「指令 / 技能 / 子智能体」三类。
- 最终状态：**已完成并验证**。设计稿 design-mockups/slash-menu-expansion.html 用户定稿选档（行图标开、Enter 发送原文、子智能体描述 label·description），由两个并行 subagent 实现（服务端 / 前端，契约：/api/skills?available=true、/api/agent-profiles?projectId、插入文本 /skill <name> 与 /agent <name> ），主 Agent 复查 diff 并跑完整门禁。
- 服务端：custom-commands.mjs 新增 /skill、/agent 解析与 formatSkillCommandPrompt/formatAgentCommandPrompt；agent-manager resolveCommandState 在 handleInternalCommand 前拦截（skill 用 loadSkillToolContext 同源校验、agent 按 workspaceRoot getAgentProfile 校验 enabledAsSubagent；失败 textResponse 用法+可用列表；通过注入 commandPrompt、无 permissions）；routes/skills.mjs ?available=true 合并视图；routes/agent-profiles.mjs 可选 projectId；skills.mjs summarizeSkills 导出。内部命令优先于同名自定义命令。
- 前端：command-suggestions.ts 三分组重写（sticky 组头+条数、图标行、argumentHint muted、命中加粗、底部键位提示条、骨架 shimmer+reduced-motion、aria-busy/option/selected）；懒加载状态机（idle→loading→ready/error，error 降级仅指令组、菜单关闭重开重试一次）；键盘 ↑↓ 循环/Tab 补全 active/Esc 关闭/Enter 不拦截；slash-catalog.ts（并行 fetch、enabledAsSubagent 过滤、失败 null、按 projectId 缓存）；ChatPanelHost ref 传 projectId；capabilityIcons 导出复用 + agent 翠绿新图标；i18n 7 新 key 双语、删孤儿 customCommandsHint/EmptyHint。
- 验证：npm run test → 225 files / 1918 tests 全通过；npm run lint → 0 errors / 1 existing warning（identity.mjs:92）；npx tsc -b → 0；npm run build 成功（仅既有 warning）；git diff --check 通过。
- 遗留：真机目视留待用户（/ 三分组、懒加载骨架、键盘、深浅主题；选中技能/子智能体发送验证语义；未知名称提示文本）。已知名义：/skill 任务可省略（激活后询问），/agent 任务必填；user-guide 无斜杠命令清单段落故未改（检索确认）。
- 本会话未创建 commit/tag/push，未新增依赖，未手工修改 dist/、package-dist/、package-offline/。

---

## 前轮状态：fix-sidebar-project-drag-bottom-boundary（已完成）

- 本会话目标：限制左侧 Projects 排序拖拽的顶部/底部边界，并让 dnd-kit 自动滚动只作用于 Projects 自身滚动视口。
- 最终状态：**已完成并验证**。`ChatSidebar.tsx` 为 Projects 的 `h-full overflow-y-auto` 容器增加 ref；`project-drag-boundary.ts` 纯函数按 `draggingNodeRect`、实时视口矩形和拖拽开始后的 `scrollTop` 增量锁定 `x=0` 并夹紧 `y`。滚动增量用于抵消 dnd-kit 非 DragOverlay 路径在 modifier 后追加的 scroll adjustment，确保预览在自动滚动后仍停于真实视口边界。
- 自动滚动：`DndContext autoScroll.canScroll` 仅接受 Projects 容器，拒绝 document 与所有外层滚动祖先；该容器到真实顶部/底部时由 dnd-kit 6.3.1 的 scroll-position 判断停止。
- 保留契约：`closestCenter`、`verticalListSortingStrategy`、`MeasuringStrategy.Always`、拖动期间折叠项目会话、`onReorderProjects` 排序持久化、现有拖拽视觉样式均未改变。
- 类型核对：实际安装 `@dnd-kit/core@6.3.1`；`Modifier` 由 core 导出，参数包含 `draggingNodeRect`；`autoScroll.canScroll` 类型是 `(element: Element) => boolean`。
- 改动文件：`src/components/sidebar/ChatSidebar.tsx`、`src/lib/project-drag-boundary.ts`、`tests/frontend/project-drag-boundary.test.ts`、`docs/wiki/src/components/README.md`，以及增量更新的 `feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 1 文件 / 7 用例全通过；改动文件 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- 遗留：未做手工浏览器验证。建议准备超过 Projects 视口高度的项目列表，分别拖到最顶部/最底部，确认预览不越界、只有 Projects 区滚动、到真实边界停止且放下后排序持久化。
- 并发保护：开始时 Wiki 与三份状态文件已有 generate_image / system-prompt 等其他任务未提交改动；本轮只在现有内容上增量追加，未覆盖或回退。未新增依赖，未创建 commit/tag/push，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 前轮状态：temporarily-disable-generate-image-tool（已完成）

- 本会话目标：暂时下线 `generate_image` 工具，同时完整保留历史会话兼容链路。
- 最终状态：**已完成并验证**。`server/tools/definitions.mjs` 的 `workspaceTools` 已移除 `generate_image`，因此 Agent 与 `GET /api/tools` 不再暴露该能力；`server/tools/index.mjs` handler、`server/image-generation.mjs`、`server/routes/tools.mjs` 的 `directRouteDisabledTools`、会话资产路由、前端 renderer/i18n/process-folding 等均未删除。
- 改动文件：`server/tools/definitions.mjs`、`tests/server/tools/definitions.test.mjs`、中英文用户指南、`docs/wiki/server/{README.md,tools/README.md}`、`docs/wiki/src/{lib,components}/README.md`，以及簿记文件 `feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：definitions 定向测试 1 文件 / 20 用例全通过；图片生成历史兼容测试 4 文件 / 63 用例全通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析和 chunk size warning）；`git diff --check` 通过。
- 文档：当前能力文档已明确图片生成暂时不可调用；源码/组件 Wiki 的 handler、资产和 renderer 描述改为仅历史会话兼容；未修改 CHANGELOG。
- Blocker：无。未新增依赖，未创建 commit/tag/push，未手工修改 `dist/`、`package-dist/`、`package-offline/`；`npm run build` 生成的 `dist/` 仍为被忽略产物。
- 并发保护：任务开始时 `feature_list.json`、`progress.md`、`session-handoff.md` 及系统提示词文件已有其他任务修改，本轮均在现有内容基础上增量追加，未覆盖。

---

## 前轮状态：remove-base-prompt-minimalism-rules（已完成）

- 本会话目标：按用户要求删除基础系统提示词中的“选择最简单的实现”和“只做最小、局部修改”规则。
- 最终状态：**已完成并验证**。`server/system-prompt.mjs` 的 `BASE_SYSTEM_PROMPT` 删除了 `Prefer the simplest solution that satisfies the request.`、`Make surgical changes only.`，并一并删除同义重复的 `Make minimal, focused changes.`；保留 `Do not refactor unrelated code.` 及其他规则。
- 改动文件：`server/system-prompt.mjs`、`tests/server/system-prompt.test.mjs`，以及簿记文件 `feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npm run test -- --run tests/server/system-prompt.test.mjs` → 1 file / 5 tests 全通过；grep 确认三条规则在基础提示词中无匹配。
- 文档：未修改 Wiki，因为这只是基础提示词措辞调整，不改变模块职责、公共入口或配置方式。
- 注意：`progress.md` 在本会话开始前已有其他智能体写入的“中止双消息根因”笔记，本次保留未覆盖；未创建 commit/tag/push。

---

## 前轮状态：release-v1.7.12（已完成，发布记录）

- 本会话目标：完成 v1.7.12 打包与发布状态收尾，记录 release commit、tag/push 与用户执行 npm publish 的发布顺序。
- 前置与版本：起始工作区干净、当前分支 `master`，发布准备阶段已确认目标 tag `v1.7.12` 尚未创建；`package.json` / `package-lock.json` 已由 1.7.11 更新为 1.7.12，CHANGELOG 1.7.12 已按 `v1.7.11..HEAD` 的 12 个提交准备；README 无固定版本引用，未修改。
- 发布门禁：`npm run test` → 219 files / 1865 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功。
- 打包结果：`node scripts/prepare-runtime-package.cjs` 成功；`node scripts/prepare-offline-package.cjs` 成功；在 `package-offline` 目录运行 `npm pack` 成功。
- tarball：`package-offline/shawnstack-quickforge-1.7.12.tgz` 存在，大小 25,255,113 bytes（24.09 MiB）；清单 324 files，包含 `bin/`、`server/`、`skills/`、`plugins/`、`runtime-assets/`、`dist/`、`README.md`、`LICENSE`、`package.json`。
- 元数据：`package-dist/package.json` 与 `package-offline/package.json` 均为 `@shawnstack/quickforge@1.7.12`，均无 `devDependencies` / `scripts`；offline 包按脚本将 `@vscode/ripgrep` 从 `dependencies` 移至 `optionalDependencies`，并保留 `node-pty` optional dependency。
- Git：`dist/`、`package-dist/`、`package-offline/` 均由 `.gitignore` 排除；生成产物不进入版本控制，release commit 范围为 6 个发布文件：`CHANGELOG.md`、`package.json`、`package-lock.json`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 发布顺序：本变更用于 release commit，随后创建并推送 tag `v1.7.12`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

---

## 前轮会话：fix-workspace-inspector-subagent-trace-outer-card（已完成，要点归档）

## 当前状态：fix-workspace-inspector-subagent-trace-outer-card（已完成）

- 本会话目标：移除 Workspace Inspector 中完整 subagent 执行区域的最外层圆角边框与弱背景，使其融入消息流。
- 最终状态：**已完成并验证**。`src/lib/local-tools.ts` 的 `.quickforge-subagent-trace` 根容器由 `quickforge-subagent-trace rounded-lg border border-border bg-background/60 p-2.5` 收敛为 `quickforge-subagent-trace p-2.5`；内部 `message-list`、状态/耗时、process summary 分隔线、思考正文、工具统计、折叠交互及聊天摘要未改。
- 改动文件：`src/lib/local-tools.ts`、`tests/frontend/local-tools-lit-reactivity.test.ts`；增量更新 `feature_list.json`、`progress.md`、`session-handoff.md`，新增独立 done bugfix，未改其他 feature 状态。
- 测试覆盖：从源码提取命中 `.quickforge-subagent-trace` 的 class 属性并拆分 token，断言保留 `p-2.5`，且不含 `rounded-lg`、`border`、`border-border`、`bg-background/60`；未使用脆弱的大段模板字符串断言。
- 验证：`npx vitest run tests/frontend/local-tools-lit-reactivity.test.ts` → 1 file / 2 passed；`npx eslint src/lib/local-tools.ts tests/frontend/local-tools-lit-reactivity.test.ts` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` → exit 0（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` → exit 0。
- 文档：未修改 `docs/wiki`，因为这是纯视觉外框 bugfix，不改变行为契约、模块职责、公共入口或可配置行为。
- 遗留：可选真机目视；本会话未创建 commit/tag/push，未新增依赖，未手工修改生成目录。

---

## 前轮会话：fix-subagent-marquee-width-reconnect（已完成，要点归档）

## 当前状态：fix-subagent-marquee-width-reconnect（已完成）

- 本会话目标：实施 subagent 跑马灯最小修复——摘要标题占据剩余宽度；custom element 断开再连接不重复追加双视图。
- 最终状态：**已完成并验证**。普通 `.quickforge-tool-title` 行为保持 `flex: 0 1 auto`，仅 `.quickforge-subagent-title` 使用 `flex: 1 1 auto`；`QuickForgeToolMarquee` 重连优先复用现有两组完整 view，仅异常 DOM 才清理重建，attribute 同步和现有动画/ResizeObserver 行为不变。
- 改动文件：`src/index.css`、`src/lib/local-tools.ts`、`tests/frontend/tool-marquee.test.ts`；增量更新 `feature_list.json`、`progress.md`、`session-handoff.md`。保留了工作区既有 `src/index.css`、input-clamp、wiki 与簿记改动，未覆盖或改写其他 active/done feature 状态。
- 测试覆盖：① CSS 源码契约断言普通 title 仍 `flex: 0 1 auto`、subagent title 为 `flex: 1 1 auto`；②执行转译后的 custom element 生命周期，覆盖 connect→disconnect→reconnect 后仍恰好两组原 view、控制器重建复用节点，并继续响应 `text`/`running` 属性。
- 验证：`npx vitest run tests/frontend/tool-marquee.test.ts tests/frontend/local-tools-lit-reactivity.test.ts` → 2 files / 16 passed；`npx eslint src/lib/local-tools.ts tests/frontend/tool-marquee.test.ts` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` → exit 0。
- 文档：未修改 `docs/wiki`，因为本次仅修复布局与生命周期幂等缺陷，没有改变模块职责、公共入口、动画语义或用户可配置行为。
- 遗留：可选真机目视；本会话未创建 commit/tag/push，生成目录未修改。

---

## 前轮会话：input-clamp-expand（已完成，要点归档）

## 当前状态：input-clamp-expand（已完成）

- 本会话目标：长输入内容定高收起——聊天用户消息与 subagent 详情任务块统一用户消息气泡视觉并定高收起（设计稿两轮迭代获用户确认后实现：`好的先执行吧`）。
- 最终状态：**已完成并验证**。追加真机反馈修复：① `white-space: pre-wrap` 仅作用于 task/context/expectedOutput 三个值节点，保留原始换行且不再把 Lit 模板缩进渲染成字段间大空白；②共享收起盒增加 30px 流内按钮安全区，仅 overflowing 内容显示，收起/展开态均不覆盖正文，fits 内容不留额外空白。`npx vitest run tests/frontend/input-clamp.test.ts` → 20/20 通过。
- 改动文件：本次追加 `src/lib/input-clamp.ts`（六行正文阈值与含按钮安全区的收起高度分离，注入流内 safe-area 节点）、`src/lib/local-tools.ts`（三字段值级 wrapper）、`src/index.css`（值级 pre-wrap、安全区/fade 样式）、`tests/frontend/input-clamp.test.ts`（20 用例，覆盖高度口径、字段值换行作用域与安全区接线）、`docs/wiki/src/lib/README.md`（行为说明）及簿记三件套。
- 关键决策：状态走 data 属性而非 class（Lit 重渲染重写 class，data 属性与注入节点可跨 SSE 实时更新存活，无需按 runId 持久化展开态，重开 Tab 回落收起）；浅色浓度 3%（浅色 token --background 纯白，混灰易显脏）、深色 6%；边框浓度用户反馈后再调淡——`primary 18%→12% 混 border`（气泡/任务块/展开按钮三处同步，按钮 hover 34%→26%，设计稿同步），测试与 feature 记录已验证/更新。
- 遗留：真机目视确认（长用户消息与详情任务块收起/展开、深浅主题气泡浓度观感；设计稿可对照）留待用户。本会话改动未提交 git。预览服务 `python -m http.server 8791 --bind 127.0.0.1 --directory D:/quickforge` 仍在后台（IAB 内核点击通道本会话中后期失效属环境问题，渲染正常）。

---

## 前轮会话（并行）：ask-user-history-review-style（已完成，要点归档）

- 本会话目标：ask_user 提交/跳过后的历史工具消息展开体复用回执确认步样式（所见即所提交，非 detailed 省略 output 文本块已获用户批准）。
- 最终状态：**已完成并验证**（定向 vitest 23/23、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/local-tools.ts`（新增导出纯函数 `askUserReviewRowsFromDetails`——自包含防御解析持久化 toolResult.details 的 questions/answers/skipped/skipReason，answers 对齐补 undefined、choices/custom 只收 string，坏形状返回 null；`ASK_USER_SKIP_REASON_KEYS` + `askUserSkipReasonText` 四映射；`AskUserToolRenderer` 非 detailed 且 review 非 null 时渲染 `quickforge-ask-review` 只读行——复用 `buildAskAnswerText` 合并答案、未答/跳过显示 `askUserUnanswered`、跳过态行区顶部加跳过原因行、无修改按钮，此态省略 input 问题清单与 output 文本块；detailed 一律维持 input JSON + output 原文，review null（pending/旧消息）维持原问题清单视图；import `buildAskAnswerText` 自 ask-user-card.ts，无循环依赖）、`src/lib/i18n.ts`（新增 askUserSkipReasonTimeout/Aborted/NoQuestions/User 双语）、`tests/frontend/ask-user-card.test.ts`（+7 用例：纯函数 4——经 ts.transpileModule 提取函数体单测（同 local-tools-lit-reactivity 惯例，规避模块级副作用）；源码断言 3——回执行渲染/无 edit 按钮、output 与问题清单门控、skip reason 映射与 i18n 双语文案）、`docs/wiki/src/lib/README.md`（local-tools 段补 ask_user 渲染器描述 + 工具清单加 ask_user）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/ask-user-card.test.ts tests/frontend/local-tools-lit-reactivity.test.ts` → `Tests 23 passed (23)`；`npx eslint src/lib/local-tools.ts src/lib/i18n.ts tests/frontend/ask-user-card.test.ts` → 0 error；`npx tsc -b` → exit 0。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：真机目视确认（触发一次 ask_user 提交与跳过、重载会话后展开历史工具消息观察回执行/跳过原因行；detailed 模式对照）留待用户。本会话改动未提交 git。

---

## 前轮会话：diff-display-optimization（已完成，要点归档）

- 本会话目标：优化对话区 write_file/edit_file 工具的 diff 显示（用户要求：调研 + 设计稿预览，确认后按推荐方案 B 落地）。
- 最终状态：**已完成并验证**（定向 vitest 35/35、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/diff-view.ts`（新增，unified diff 结构化解析纯函数：行号双侧/前缀剥离/hunk 间隙省略/配对删加行 token LCS 字符级变化段/路径与新文件判定）、`src/lib/local-tools.ts`（renderDiff 改结构化行渲染，删内联样式双保险与 diffLineClass/diffLineStyle/styleMap）、`src/index.css`（diff 行号/gap/mark/path/newfile 样式 + html.dark 亮绿/亮红文字覆盖，含徽章与里程计 side；**追加修复**：用户反馈横向滚动后行背景缺失——块改单一 grid `3.1rem 3.1rem minmax(max-content,1fr)` + 行 display:contents + gap 跨全列，第三列取 max(剩余宽,最宽行) 使所有行背景铺满整个横向滚动区，设计稿同步修复并加长行示例）、`src/lib/i18n.ts`（diffOmittedLines/diffNewFile 双语）、`tests/frontend/diff-view.test.ts`（新增 16 用例）、`docs/wiki/src/lib/README.md`（diff-view 模块行 + local-tools 段同步）、`design-mockups/diff-display-optimization.html`（对比设计稿留档）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/diff-view.test.ts tests/frontend/local-tools-lit-reactivity.test.ts tests/frontend/tool-artifacts-and-events.test.ts tests/frontend/diff-counter.test.ts` → 35 passed；`npx eslint` 四改动文件 0 error；`npx tsc -b` exit 0；修复后 `npm run build` 通过 + 无头 Edge 截图像素级验证（临时页复制 index.css 规则并预置 scrollLeft 最大：绿/红行背景延伸至块右缘、上下文行保持块底色，临时页已删）。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：真机目视确认（触发一次 edit/write 任务观察新 diff 块、亮暗两主题、多 hunk 省略行）留待用户；预览用本地静态服务 `python -m http.server 8941 --directory D:/quickforge/design-mockups`（后台运行中，设计稿也可直接双击打开）。本会话改动未提交 git。

---

## 并行会话：input-clamp-expand（设计阶段，待用户定稿）

- 本会话目标：subagent 阅读详情时顶部输入（任务说明块）定高收起 + 框底展开按钮；按用户第二轮反馈（与聊天用户消息样式统一、用户消息也定高、背景调浅）迭代出 v2 设计稿（input-clamp-expand）。
- 最终状态：**设计阶段完成，待用户定稿**。v2 设计稿 `design-mockups/input-clamp-expand.html`：聊天用户消息与 subagent 详情任务块统一复用用户消息气泡视觉（对齐 `src/index.css` user-message-container 公式：背景 primary 混 card、边框 primary 18% 混 border、圆角 1.125rem 右下 0.375rem、同款轻阴影、14px/1.625 文字）；长内容定高裁切不滚动 + 底部渐隐（渐隐色=气泡背景色）+ 居中「展开/收起」pill 按钮；气泡背景浓度默认 6%（比应用现状 primary 10% 浅，工具栏可切 4/6/8/10%）；收起高度可切 3/6/10 行；深浅色、列宽 380–960 可调；内容不足定高时按钮与渐隐整体不渲染。
- 改动文件：`design-mockups/input-clamp-expand.html`（新增）；`design-mockups/subagent-task-clamp-expand.html`（v1 样稿，被 v2 取代后删除）；簿记三件套（feature_list.json 登记 input-clamp-expand 为 in_progress）。
- 验证记录：浏览器打开样稿——初始四状态正确（短内容 fits 自动隐藏按钮 / 长消息收起 / 初始展开 / 任务块收起，类名与 aria-expanded 断言全过）；展开↔收起点击交互在 v1（同款交互 JS）端到端验证通过（expanded ↔ 收起 ↔ 展开）。预览服务：`python -m http.server 8791 --bind 127.0.0.1 --directory D:/quickforge`（后台运行中）；样稿零外部依赖，也可直接双击打开。
- 遗留/Blocker：等用户定稿两处选档——气泡背景浓度（4/6/8/10%）、收起高度（3/6/10 行）；确认后实现：共用 clamp 组件（max-height 裁切 + 渐隐 + 展开按钮）、聊天 user-message 装饰链路与 `renderSubagentRunBody` 任务块接入、气泡浓度调浅落 index.css。备注：本会话 IAB 自动化点击通道后期整体失效（顶部复选框也点不动，新标签页/重置面板不恢复），属环境问题非设计稿问题。本会话改动未提交 git。

---

## 前轮会话：fix-ask-user-nav-row-and-enter-confirm（已完成，要点归档）

- 本会话目标：修复 ask_user 卡片真机反馈两问题：①自由输入展开后无就近确认入口（「下一问」在选项区与 toggle 之间、位于 textarea 上方）；②上一问/下一问不在同一行（上一问在底部 actions 行、下一问在 body 内）。
- 最终状态：**已完成并验证**（定向 vitest 15/15 全过、eslint 改动文件 0 error）。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`（nextBtn 提升为注入时创建、常驻底部 .quickforge-ask-actions 行与 backBtn 同行，append 顺序 back/next/submit/skip/note；一次性绑定 isAskAnswered 校验 + advance；renderStep 按 `!isReview && (multiSelect || allowCustom)` 控制显隐，单选且无自由输入隐藏、点选自动前进不变；setSubmitting 补 nextBtn.disabled；body 模板删内联 next 按钮与逐次 querySelector/绑定；customInput 增 keydown——Enter 且 !shiftKey 时 preventDefault，isAskAnswered 通过则 advance 否则提示 askUserNeedAnswer，Shift+Enter 保持换行）、`src/index.css`（删 .quickforge-ask-next { align-self:flex-start } 规则；.quickforge-ask-actions 补 flex-wrap:wrap 防窄屏溢出）、`tests/frontend/ask-user-card.test.ts`（Next 用例按新实现重写：append 顺序/显隐条件/一次性绑定断言 + 反向断言模板与 CSS 不再含 quickforge-ask-next；新增 keydown Enter 用例）、`docs/wiki/src/components/README.md`（ask-user 段同步：导航按钮统一底部操作行、textarea Enter 确认前进 Shift+Enter 换行）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/ask-user-card.test.ts` → `Tests 15 passed (15)`；`npx eslint src/components/chat/panel-decoration/ask-user-card.ts tests/frontend/ask-user-card.test.ts` → 0 error；`npm run build`（tsc -b + vite build）通过（主 Agent 补跑）。未跑全量测试（小改动定向验证，符合项目规则）。
- 遗留：评审其余发现（⑤–⑩，见 progress.md Notes）待用户定夺；真机目视确认留待用户。该会话改动未提交 git。

---

## 前轮会话：subagent 跑马灯工具切换上下滚动过渡（已完成，要点归档）
- 最终状态：**已完成并验证**（tool-marquee 13/13、前端全量 85 文件 778 用例全过、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/tool-marquee.ts`（控制器双视图重写：text 切换旧视图 translateY 0→-100% 滚出、新视图自 +100% 滚入 260ms，滚动期间旧横向动画不中断、结束后按 400ms 起始延迟重建，滚动中遇新文本先就地结算再重滚；同值刷新不打断 + 静止自愈排程；reduced-motion/首次出现/终态直切）、`src/lib/local-tools.ts`（QuickForgeToolMarquee 构建双视图，非当前视图整体 aria-hidden）、`src/index.css`（容器定高 1.125rem + .quickforge-marquee-view 绝对铺满规则）、`tests/frontend/tool-marquee.test.ts`（重写 13 用例）、`docs/wiki/src/lib/README.md`（tool-marquee 与 local-tools 两行同步）、`design-mockups/subagent-tool-marquee-impl.html`（标注 v1 参考）；设计稿 `design-mockups/subagent-marquee-roll-switch.html`；簿记三件套。
- 效果：工具摘要切换时旧摘要上滚出、新摘要自下滚入（与横向滚动两轴独立），间隙保持与终态消失行为不变。
- 遗留：真机目视确认（触发多工具 subagent 任务观察切换滚动与窄列宽表现）留待用户。本会话改动未提交 git。

---

## 前轮会话（并行）：ask_user 卡片评审遗留 ③④ 修复（已完成，要点归档）

- 本会话目标：修复 ask_user 卡片评审遗留 ③④（fix-ask-user-custom-mix-and-review-edit：③展开自由输入清空已选 choices，与「选项 + 补充」数据模型矛盾；④回执步仅 backBtn 逐题回退，回改成本高）。
- 最终状态：**已完成并验证**（定向 vitest 14/14 全过、eslint 改动文件 0 error、tsc -b 通过）。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`（删除 customToggle 展开分支清空 choices 与移除勾选两行；review 每行末尾新增 quickforge-ask-review-edit 按钮，点击 message 复位 + disarmSkip + step=index + renderStep 直达该题，isReview 分支内重新绑定）、`src/index.css`（.quickforge-ask-review-edit 复用 ghost 视觉模式紧凑样式 + hover；review-row 改 content 列 + 右侧按钮行布局）、`src/lib/i18n.ts`（askUserCustomToggle/askUserCustomPlaceholder 双语改补充语义，新增 askUserEdit en『Edit』/zh『修改』）、`tests/frontend/ask-user-card.test.ts`（+3 用例：清空模式不存在、review-edit 绑定与样式、四条双语文案）、`docs/wiki/src/components/README.md`（ask-user 段同步）；簿记三件套。
- 遗留：评审其余发现（⑤–⑩，见 progress.md Notes）待用户定夺；真机目视确认（展开补充说明不清空已选、回执点「修改」直达对应题）留待用户。该会话改动未提交 git。

---

## 前轮会话：subagent 跑马灯工具间隙保持（已完成，要点归档）

- 本会话目标：优化 subagent 运行卡跑马灯——工具间隙（上一个工具已结束、下一个尚未开始）不要让工作过程显示消失（subagent-marquee-hold-between-tools）。
- 最终状态：**已完成并验证**（定向 vitest 91/91 全过、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/subagent-run-detail.ts`（新增 `SubagentToolSummaryMemory` 有界记忆 + `currentSubagentToolSummariesWithMemory` 带记忆数据源）、`src/lib/local-tools.ts`（`renderSubagentRunSummary` 改用带记忆版本，模块级单例）、`tests/frontend/subagent-run-detail.test.ts`（+5 用例：间隙回放与切换、终态恒空不污染、runId 隔离、空入参/clear、有界淘汰）、`docs/wiki/src/lib/README.md`（local-tools 与 subagent-run-detail 两处描述同步）；簿记三件套。
- 效果：running 期间跑马灯持续展示——pending 间隙回放该 run 最近一次非空摘要（元素保持挂载、text 不变动画不中断），下一个工具摘要出现即切换，运行结束照常消失；首个工具出现前行为与旧版一致。
- 验证记录：`npx vitest run tests/frontend/subagent-run-detail.test.ts tests/frontend/tool-marquee.test.ts` → 91 passed；`npx eslint` 三改动文件 0 error；`npx tsc -b` exit 0。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：真机目视确认（触发一次多工具 subagent 任务，观察工具间隙跑马灯保持显示）留待用户。本会话改动未提交 git。

---

## 前轮会话：ask_user 卡片两交互缺陷修复（已完成，要点归档）

- 本会话目标：修复 ask_user 卡片两个交互缺陷（fix-ask-user-skip-and-custom-forward，评审定案①跳过语义失真②单选+自由输入无前进路径）。
- 最终状态：**已完成并验证**（定向 vitest 11/11 全过、eslint 改动文件 0 error）。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`（skip 两步确认 + disarmSkip 助手；Next 条件 multi→multi||allowCustom）、`src/lib/i18n.ts`（askUserSkip 双语改『跳过全部提问』+ 新增 askUserSkipConfirm）、`tests/frontend/ask-user-card.test.ts`（+3 组源码断言）、`docs/wiki/src/components/README.md`（L156 向导交互描述同步）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/ask-user-card.test.ts` → `Tests 11 passed (11)`；`npx eslint` 三个改动 src/tests 文件 → 0 error。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：评审其余发现（③–⑩，见 progress.md Notes）待用户定夺；真机目视确认（跳过两步确认、单选自由输入点「下一问」）留待用户。本会话改动未提交 git。

---

## 前轮会话：session-import 元数据桶韧性修复（已完成，要点归档）

- 本会话目标：修复 24h 变更风险审查发现的 M1——单个损坏的 `sessions-metadata.json` 阻断整个启动（fail-closed 扩大化）。
- 最终状态：**已完成并验证**（定向测试 + 相关存储测试全过、eslint 0 error）。

## 实现要点（速览）

- `server/session-state-import.mjs`：桶级 `readMetadataBucket` 读取 + `isPlainObject` 形状校验纳入 try/catch——失败（损坏 JSON SyntaxError / Windows EACCES/EBUSY / 非对象内容）时该桶降级为**空 metadata 继续**导入，不再上抛置 `STARTUP_FAILED`。正文文件照常导入（走既有 body-only `deriveMetadata` 推导，title/时间戳取自正文），仅 metadata-only 条目丢失（本就不含消息、按设计 dropped）。记 `diagnostics`（`kind: 'metadata-bucket-error'`，含 scope/projectId/message）+ `logger.warn`，与模块既有单条目韧性语义对齐。
- 头部 Resilience 注释与 `docs/architecture/session-storage-v2.zh-CN.md` §5 导入清单同步补充该语义。

## 本会话改动文件

- 修改：`server/session-state-import.mjs`、`tests/server/session-state-import.test.mjs`（新增双桶降级用例：global 损坏 JSON + project 合法 JSON 但数组）、`docs/architecture/session-storage-v2.zh-CN.md`
- 簿记：`feature_list.json`（done）、`progress.md`、`session-handoff.md`

## 验证记录

- 定向：vitest `tests/server/session-state-import.test.mjs` 4 用例全过（新用例断言降级导入 2 会话、diagnostics 2 桶错 + 2 body-only、metadata 由正文推导）。
- 相关面：backup.authoritative-session / session-state-offline-export / session-state-lifecycle / storage.session-recovery 共 18 用例全过。
- `npx eslint` 改动文件 0 error。

## 遗留与下一步

- 本会话改动未提交 git（遵循约定）。
- 风险审查其余发现（本轮 progress.md Notes 已记）：H1 存储 v2 就地升级 backup 表零读取者/零告警、M2 导入 count>0 永不重跑、benchmark 脚本悬空 import、前端 diff-counter `?running` 布尔绑定失效 + className 覆写——均未处理，待用户定夺。
- 前轮遗留（更新）：v1.7.11 npm publish 待办已由当前 v1.7.12 release 流程取代；根目录空目录 design-preview/ 重启后可删；既有 lint warning server/cloud/identity.mjs:92。

---

## 前轮会话：ask-user-tool（已完成，要点归档）

- 服务端：`server/tools/definitions.mjs` 新增 `askUserTool`（questions 1-4，每问 options≤4 / multiSelect / allowCustom）；`server/ask-store.mjs`（pendingAsks Map、ASK_TIMEOUT_MS=30min、`normalizeAskQuestions` 兼容单问简写、`formatAskResult` 超时/跳过/abort→按默认方案继续）；`server/agent-manager.mjs` `wrapAskUserToolDefinition` + `createAskUserPromise`（SSE `ask_user_required`/`ask_user_answered`）+ `answerAsk` + state `pendingAsk` + 免审批；`server/approval-store.mjs` planAllowedTools 加 ask_user；`server/routes/agent.mjs` `POST /api/agents/:id/answer-ask`。
- 前端：`src/lib/server-agent.ts` 事件与 pendingAsk 全套、`answerAsk()`；`panel-decoration/ask-user-card.ts` 向导式卡（单选自动前进、末步统一提交、可跳过/回改，`data-ask-id`+displaySignature 去重）；ChatPanelHost/App 接线；i18n en/zh 各 18 键；`.quickforge-ask-*` 样式。
- 真机反馈修复：①propsRef effect 漏 `onAnswerAsk` 致卡片误禁用（已补+回归断言）；②ask_user 工具消息新增 `AskUserToolRenderer` 纳入工具显示模式（summary「N 问 · 首问」、output=回答文本）。
- 验证：全量 test 217 文件 1795 用例 / lint 0 error / build 通过；真实会话目视确认留待用户（可要求"用 ask_user 问我一个问题"触发）。
- 前轮未提交改动（diff-odometer-counter / scroll-to-bottom-button / marquee / thinking-cap 等）仍保持未提交状态。
