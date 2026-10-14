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
