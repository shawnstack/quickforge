# 调研报告：subagent 失败后刷新页面丢失执行过程（只见最终报错）

- **Feature id**: `subagent-failed-run-trace-refresh-loss-review`
- **类型**: 纯只读调研（不修改生产代码）
- **日期**: 2026-09-14
- **基线**: 当前 dev 工作树（package.json version 2.1.0，`node -e "console.log(require('./package.json').version)"` 输出 2.1.0）
- **用户报障**: Subagent 执行过程中已经调用了多个 tools，最后失败后，刷新页面只能看到最终的报错，之前调用过的 tools 及其过程看不到了；部分场景正常、部分场景存在。
- **关联交付**: 并行会话已交付同主题诊断报告 `docs/reviews/subagent-failure-trace-recovery.zh-CN.md`（feature `subagent-failure-trace-recovery`，含 7 个测试实证用例）；本报告与其交叉验证一致，补充版本考古、进程生命周期场景、入口差异判定与修复方案对比，并吸收其实证发现（见第五节 P2/P3）。现场根因认定建议结合其第 5 节取证步骤与本报告第六节二分定位共同使用。

---

## 一、结论速览

1. **过程数据（trace）的唯一持久化载体是终态 `run_subagent` toolResult 的 `details.messages`**。服务端自 **1.10.2**（2026-09-04，CHANGELOG.md:97 "preserving traces across refreshes"，progress.md:1278-1292 / feature_list.json:1650-1653 `subagent-timeout-structured-progress` Revision 2）起，对「已开始执行后失败」的 subagent（超时/父中止/模型流错误等运行期失败）统一把全量 messages 注入错误 toolResult 持久化（server/agent-subagent-runner.mjs:529-541 内层 catch → agent-manager.mjs:189-195 stash → :755-759 afterToolCall 注入）。
2. **「有些正常有些丢失」的两类根因**：
   - **主线（显示层）**：失败 run 的完整过程在详情页能否显示，取决于打开入口与 store 状态——**从聊天工具卡点击**永远从持久化 details 现场重建完整载荷（local-tools.ts:785）；**从置顶摘要「智能体 · 已结束」行点击**拿到的是**轻量载荷**（traceMessages/input/details 全空，subagent-run-detail.ts:644 + :744-748），只有 `subagentRunStore`（纯内存，刷新即空，:109-160）命中时才有 trace；未命中即详情只剩 error 块（WorkspaceInspector.tsx:1040-1043 的 `store.get ?? 轻量payload` 兜底）。
   - **辅线（数据源）**：≤1.10.1 版本持久化的错误 toolResult details 为空（旧会话不可回溯补全）；prompt 开始前的失败、审批/权限拒绝本来就没有过程可带；服务器进程在 subagent 运行中崩溃/重启会丢运行中快照（partial 仅内存）；终态 toolResult 在 400ms 持久化 debounce 窗口内崩溃则连终态结果都不落盘。
3. **并行调研交叉验证**：并行会话已交付同主题诊断报告 `docs/reviews/subagent-failure-trace-recovery.zh-CN.md`（含 7 个测试实证用例 `tests/frontend/subagent-failure-trace-recovery.test.ts`），其结论与本报告一致，并测试实证了两条本报告以源码推导列入的**更隐蔽退化路径**（见第五节主线 P2/P3）：①终态 details 非空但缺 `messages`（如仅含服务端注入的 `quickforgeTiming`，agent-session-events.mjs:177-182）时，SSE 转换层的 previous 快照回填被「任意 metadata 存在」的宽判断阻止（subagent-run-detail.ts:798-804 判 `Object.keys(details).length > 0` 而非 messages 存在），6 条过程消息实测变空；②残缺终态快照一旦进入 store，canonical 点击优先 store 且 renderer 门禁不允许终态→终态覆盖（shouldPublishSubagentRunPayload :489-498），完整历史载荷被遮蔽。本报告补充其未覆盖的版本考古（1.10.2 分界）、服务器进程生命周期场景、入口差异判定与修复方案对比，两份报告互补。
4. **渲染层没有「error 时抑制 trace」的分支**：详情块顺序 `subagentRunBodyBlocks`（subagent-run-detail.ts:445-466）中 trace 块只要求 `traceMessages.length > 0`（:457），error 块无条件加入（:458）——error 与 trace 并存。**「只见最终报错、无过程」在渲染层的唯一充分条件就是 payload.traceMessages 为空**（数据缺失或拿到轻量载荷）。

---

## 二、数据链路

### 2.1 服务端持久化链（权威数据源）

```
runSubagent (server/agent-subagent-runner.mjs:211)
  ├─ 运行期：subscribe 维护内存 latestMessages（:448-461），emitSubagentTrace 经 onUpdate
  │   发 tool_execution_update（150ms 节流，messages 截尾最近 50 条 + messagesTotal，:38-41/:324-353）
  │   → 父会话 agent.subscribe（agent-manager.mjs:896-943）→ updateRuntimeToolExecution
  │   → session.runtimeToolExecutions（纯内存 Map，agent-session-events.mjs:193-222）
  │   → SSE 推送（不持久化，背压时可丢弃 tool_execution_update，wiki server/README.md:144）
  ├─ 终态成功（:506-528）：toolResult.details = 全量 messages/tools/pendingToolCalls
  ├─ 终态失败-超时（:495-498）/父中止（:500-503）：error.quickforgeSubagentDetails =
  │   buildTerminalSubagentDetails({timedOut:true}/{aborted:true})（messages 全量）
  ├─ 终态失败-其余运行期错误（内层 catch :529-541）：未携带 details 的错误统一挂
  │   buildTerminalSubagentDetails({})（messages 全量，无标记）
  │   ↓ 抛错
  │   wrapSubagentToolDefinition catch（agent-manager.mjs:189-195）按 toolCallId stash
  │   → pi-agent-core 把抛错 execute 收口为错误 toolResult
  │   → afterToolCall（agent-manager.mjs:755-759）取回 stash 注入 toolResult.details
  │   → toolResult 消息进入 state.messages 并持久化
  └─ 外层 catch（:547-553）：prompt 开始前失败（模型解析/工具创建/Agent 构造），无 details
      （此时尚未执行任何工具，无过程可丢；测试 agent-manager.subagents.test.mjs:322）
```

持久化时机：`message_end` 走 **400ms debounce**（agent-persistence.mjs:382-392），`agent_end` / 显式 persist **立即 flush**（:399-405）。刷新后 `GET /api/agents/:id/state`（routes/agent.mjs:280-296）优先取内存会话；split 会话消息经 `GET /messages` 分页物化（:298-327，默认 500 条/页、上限 5000）。

### 2.2 前端恢复链（刷新后）

```
刷新 → ServerAgent.create（server-agent.ts:2713-2776）
  GET /state + （split 会话）分页拉全消息 → state.messages（含终态 toolResult.details 全量）
  ├─ 聊天 message-list 渲染 run_subagent 卡 → SubagentToolRenderer.render
  │   （local-tools.ts:782-796）：buildSubagentRunPayload 从持久化 details 重建完整载荷；
  │   shouldPublishSubagentRunPayload 首次 canonical 发布回填 subagentRunStore（:788-789）
  ├─ 置顶摘要（App.tsx:563-578）：extractLatestTerminalSubagentRuns 从 messages 提取，
  │   每行 payload 为轻量载荷（subagent-run-detail.ts:644 lightweight:true → :744-748 置空）
  └─ 运行中的 run：服务端 getSessionState 把 runtimeToolExecutions 快照（尾部 50 条）合入
      messages（agent-manager.mjs:1629 / agent-session-events.mjs:224-243）→ 前端恢复 running 显示
```

打开详情的两条入口：

| 入口 | 载荷来源 | 刷新后 trace |
|---|---|---|
| 聊天工具卡点击（local-tools.ts:623-628） | `resolveSubagentRunPayloadForOpen(payload, store.get(runId))`——renderer 现场从持久化 details 重建的**完整载荷**做 fallback（subagent-run-detail.ts:500-507：非 canonical 直接返回 renderer 载荷；canonical 命中 store 用 store） | **完整可见**（数据在即有） |
| 置顶摘要行点击（GitToolsPinnedSummary.tsx:835/:872 → App.tsx:1146-1160 → WorkspaceInspector.tsx:1040-1043） | `subagentRunStore.get(runId) ?? request.payload`——request.payload 是**轻量载荷** | store 命中→完整；**未命中→无 trace/input/details**（subagent-run-detail.ts:696-698 注释明示该边界） |

`subagentRunStore`：全局纯内存 Map，上限 100 条 FIFO 淘汰（subagent-run-detail.ts:98-99/:109-160）；刷新即清空，**没有启动时从消息批量重建的逻辑**，回填只依赖 ①SSE 事件（运行中，server-agent.ts:1008-1016/:2177-2210）②聊天渲染该 toolResult 卡时 renderer 发布（local-tools.ts:785-789）。当前聊天窗口化被禁用（ChatPanelHost.tsx:656-658 `createMessageWindow({ enabled: false })`，为 turn navigation 全量预渲染），因此正常时序下刷新后聊天首渲染会自动回填全部 canonical run。

---

## 三、失败终态枚举（各自 toolResult.details 内容）

| # | 终态 | 触发 | details 内容 | 过程可恢复性 |
|---|---|---|---|---|
| 1 | 成功（对照） | 正常完成（:506-528） | 全量 messages | ✅ 刷新后可见 |
| 2 | 超时 | 超过 timeoutMs（:495-498） | 全量 + timedOut:true | ✅（≥1.10.2） |
| 3 | 父运行中止 | 父 abort signal（:500-503） | 全量 + aborted:true | ✅（≥1.10.2） |
| 4 | 其余运行期错误 | 模型流错误等（内层 catch :529-541） | 全量、无标记 | ✅（≥1.10.2） |
| 5 | prompt 前失败 | profile 校验/模型解析/工具创建/Agent 构造（外层 catch :547-553） | 空 `{}`（pi-agent-core 收口，无注入） | ❌ 无过程可带（尚未执行任何工具） |
| 6 | 审批/权限/goal 只读拒绝 | beforeToolCall block（agent-manager.mjs:760-803） | 无（不经过 runSubagent） | ❌ 无过程可带（未启动） |
| 7 | 进程崩溃/重启（运行中） | subagent 未到终态 | **无终态 toolResult**（partial 仅内存，restore 即清 agent-manager.mjs:1613） | ❌ run 本身已死，过程全丢 |
| 8 | 持久化窗口崩溃 | 终态后 400ms debounce 内/flush 前进程崩溃（agent-persistence.mjs:382-405） | toolResult 未落盘 | ❌ 刷新后无该 toolResult |
| 9 | 旧版本（≤1.10.1）失败 | Revision 2 修复前持久化 | details 为空对象 | ❌ 永久丢失（不可回溯） |

测试锚点：超时注入 agent-manager.subagents.test.mjs:363/:426、通用失败注入 :531、父中止 :575、初始化失败（外层）:322、运行期截尾 50 vs 终态全量 :273、运行中刷新快照合并 :811；前端超时/通用错误恢复保 trace subagent-run-detail.test.ts:300/:347、轻量载荷契约 :132、store 最新快照解析 :828。

---

## 四、场景矩阵：刷新后「过程可见 vs 丢失」

| # | 场景 | 判定 | 依据 |
|---|---|---|---|
| 1 | 运行中不刷新（SSE 在线） | ✅ 实时可见（update 截尾 50 条滚动窗） | agent-subagent-runner.mjs:324-353；wiki server/README.md:148 |
| 2 | 运行中刷新、服务器进程存活 | ✅ 尾部 50 条（runtime 快照合入 state） | agent-session-events.mjs:224-243；agent-manager.mjs:1629；测试 :811 |
| 3 | 运行中刷新、服务器进程已重启/会话被逐出后 restore | ❌ 运行中过程全丢（快照仅内存，restore 即清；run 已死无终态 toolResult） | agent-manager.mjs:1613 |
| 4 | 失败终态后刷新（≥1.10.2），从聊天工具卡点击 | ✅ 完整 trace（renderer 从持久化 details 重建） | local-tools.ts:785；subagent-run-detail.test.ts:300/:347 |
| 5 | 失败终态后刷新（≥1.10.2），从置顶摘要点击、store 已回填（聊天已渲染该卡） | ✅ 完整 trace（store 命中） | WorkspaceInspector.tsx:1042 |
| 6 | 失败终态后刷新，从置顶摘要点击、**store 未命中**（点击早于聊天首渲染回填 / 同会话 >100 个 run 被 store FIFO 淘汰 / 多窗口各自 store 独立） | ❌ **只剩 error 块，无 trace/input/details（轻量载荷直落 fallback）**——主线嫌疑 | subagent-run-detail.ts:644/:744-748/:696-698；WorkspaceInspector.tsx:1040-1043 |
| 7 | 服务器版本 ≤1.10.1 时的失败 + 刷新 | ❌ 持久化 details 为空，只见错误正文 | progress.md:1282/:1290；CHANGELOG.md:97 |
| 8 | ≥1.10.2 但会话是修复前（≤1.10.1）持久化的旧错误 toolResult | ❌ 永久丢失（不可回溯补全） | progress.md:1290 |
| 9 | prompt 开始前失败（profile/模型解析/工具创建/Agent 构造） | ❌ 无 details——但此时无任何工具调用，**无过程可丢** | agent-subagent-runner.mjs:547-553 |
| 10 | 审批/权限/goal 只读拒绝 | ❌ 无 details——同上，未启动即拒绝 | agent-manager.mjs:760-803 |
| 11 | 终态 toolResult 落盘前进程崩溃（400ms debounce 窗口内） | ❌ 该 toolResult 整条丢失 | agent-persistence.mjs:382-405 |
| 12 | 刷新前已打开的 Inspector subagent 详情 Tab | ⚠️ 刷新后 **Tab 消失**（serialize 明确丢弃 kind==='subagent'，不持久化），需重新点击——预期落差，非数据丢失 | workspace-inspector-tabs.ts:170-171 |
| 13 | SSE 背压丢弃 tool_execution_update | ✅ 不影响刷新恢复（只影响实时帧） | wiki server/README.md:144 |
| 14 | 失败终态 details 仅含 `quickforgeTiming`（timing-only，服务端注入产物；注入链未生效时持久化也如此） | ❌ SSE 终态载荷 trace 空（previous 回填被「任意 metadata」宽判断阻止）；若持久化 details 同为 timing-only，刷新后也无 trace | subagent-run-detail.ts:798-804；agent-session-events.mjs:177-182；并行调研测试实证 |
| 15 | store 已有无 trace 终态快照（如 14 的 end 载荷先到），聊天 renderer 稍后从持久化 details 重建完整载荷 | ❌ 任一入口点击均无过程：canonical 点击优先 store 且终态→终态不覆盖，完整历史被遮蔽 | subagent-run-detail.ts:489-507；并行调研测试实证 |

注：聊天内本来就不展开过程（卡只是一行摘要 + 跑马灯，local-tools.ts:607-646；wiki src/lib/README.md:199），过程只在 Inspector 详情里——「聊天里看不到过程」不是本问题。

---

## 五、根因分析

### 主线：显示层退化路径（数据其实在持久化里）

**P1 置顶摘要轻量载荷 + store 未命中 fallback**

- 置顶摘要「智能体 · 已结束」行（pinned-summary-subagent-finished-show-all 引入展开全部后，每行都是轻量载荷：traceMessages=[]、input=''、details=''，subagent-run-detail.ts:644 + :744-748；wiki src/lib/README.md:215 明示「未命中时详情缺 trace/input/details」）。
- 点击链路 `GitToolsPinnedSummary.tsx:872 onOpenSubagentRun(payload)` → `App.tsx:1146-1148` → `WorkspaceInspector.tsx:1042 subagentRunStore.get(runId) ?? request.payload`。
- store 是页面级内存（刷新即空、100 条 FIFO），回填依赖聊天渲染回填（local-tools.ts:785-789）或 SSE。刷新后立刻点击、>100 run 淘汰、多窗口等时序/容量边界下未命中 → 详情只有 task/meta/error/output 块，**无 trace 块**（subagentRunBodyBlocks :457 要求 traceMessages.length>0）。
- **同一 run 从聊天卡打开完整、从置顶摘要打开丢过程**，正是「有些情况正常、有些情况存在问题」的最直接解释之一。
- 前提：该场景要求持久化 details 非空（即 ≥1.10.2 新会话）；旧版本会话则叠加辅线数据缺失。

**P2 timing-only/identity-only 终态 details 阻止 SSE 转换层回填（并行调研测试实证）**

- `subagentRunPayloadFromToolEvent` 的 previous 快照回填判断是「终态 details 是否存在任意键」（subagent-run-detail.ts:798-800 `Object.keys(terminalDetails).length > 0`），而非「是否存在 messages」：终态 details 仅含服务端 `addToolTimingToEvent` 注入的 `quickforgeTiming`（agent-session-events.mjs:177-182，把空 details merge 成 timing-only 非空对象）时回填被跳过，trace 变空、错误正文保留——测试实证见 `tests/frontend/subagent-failure-trace-recovery.test.ts`（6 条过程消息变空数组）。
- 该路径影响实时 SSE 在线路径（end 事件发布的终态载荷）；刷新后 renderer 从持久化 details 重建不受影响——但若持久化 details 本身也是 timing-only（注入链未生效时），则刷新后同样无 trace。

**P3 残缺终态 store 遮蔽完整历史载荷（并行调研测试实证）**

- canonical 点击 `resolveSubagentRunPayloadForOpen`（:500-507）优先 store、不比较 trace 完整度；renderer 回填门禁 `shouldPublishSubagentRunPayload`（:489-498）只允许「首次发布」或「running→终态修正」，**不允许终态→终态覆盖**。一旦 store 里躺着一个无 trace 的终态快照（例如 P2 的 end 载荷先到），即使聊天 renderer 后来从持久化 details 重建了完整载荷也不会发布替换，点击时选择残缺 store——完整历史被遮蔽而非删除（测试实证）。
- 与 P1 叠加时，用户无论从哪个入口点击都看不到过程，且无任何提示。

### 辅线：数据源缺失（持久化 details 为空或 toolResult 不存在）

- **版本分界**：Revision 2（1.10.2）之前所有运行期失败的错误 toolResult details 为空——**旧版本用户必然复现**；且修复前已持久化的空 details 历史会话永远无法恢复（progress.md:1290）。新旧会话混存时表现分裂。
- **运行中崩溃/重启**：partial 快照只在 `runtimeToolExecutions` 内存 Map，restore 即清（agent-manager.mjs:1613），不写持久化（wiki server/README.md:148「该快照不写入持久化会话」）。
- **持久化窗口**：终态 toolResult 靠 message_end 400ms debounce / agent_end flush 落盘，窗口内进程崩溃则连终态结果都没有。
- **无过程可带类**（prompt 前失败、审批拒绝）：details 为空是设计内行为，与用户描述「已调用多个 tools 后失败」不符，列出仅为完整性。

### 预期落差（非 bug）

- Inspector subagent Tab 不持久化（workspace-inspector-tabs.ts:171）：刷新前开着的详情 Tab 刷新后消失，需重新点击。
- 聊天内不展开过程：过程只能通过点击打开 Inspector 查看。

---

## 六、二分定位验证步骤（给用户/复现会话）

1. **确认服务器版本 ≥1.10.2**（当前 2.1.0）。若复现会话来自 ≤1.10.1 时期的持久化数据，属已知已修复缺陷（场景 7/8），无排查价值。
2. **查数据源**：打开复现会话所在存储（`~/.quickforge/` 会话存储，或浏览器 DevTools Network 里 `GET /api/agents/:id/messages` 响应），定位该失败 `run_subagent` 的 toolResult：
   - `details.messages` 非空 → 数据在，问题在显示层（走第 3 步）；
   - `details` 为空/缺失 → 数据源问题：按场景 7/8/9/10/11 归类（版本、prompt 前失败、审批拒绝、运行中崩溃）。
3. **对比两个入口**（同一失败 run）：
   - 从聊天消息里的 run_subagent 工具卡点击 → 详情应有完整 trace；
   - 从置顶摘要「智能体 · 已结束」行点击 → 若无 trace（只见错误原因卡 + 摘要），即命中主线场景 6。
   - 两者同时刷新后立即操作，注意时序（聊天首渲染回填 store 需要一两秒）。
4. **运行中失败类**：若失败发生在服务器重启/升级窗口，确认会话是否被 restore（run 无终态 toolResult）→ 场景 3。

---

## 七、修复方案候选（未实施，待决策）

| 方案 | 内容 | 影响面/代价 |
|---|---|---|
| **A（推荐）打开/回填的完整度统一规则：从消息兜底重建 + 允许完整历史补齐残缺终态** | 与并行报告 6.1 建议 1-3 同向：①Inspector 处理 `kind==='subagent'` 请求时，store 未命中或命中的快照缺 trace 且请求载荷也缺 trace 的，从当前 `ServerAgent.state.messages` 按 runId（toolCallId）重新 `buildSubagentRunPayload`（完整载荷）；②相同 canonical ID 下允许完整历史补齐残缺终态的 trace（不回退状态/耗时/错误正文），放宽 `shouldPublishSubagentRunPayload` 的终态→终态门禁为「仅当新载荷 trace 更完整」；③SSE 转换层回填判断从「任意 metadata」改为「messages 存在性」 | 改动集中在 WorkspaceInspector.tsx 请求处理 + subagent-run-detail.ts 两个纯函数；消息已在内存（置顶摘要列表本身就来自 messages，能列出该行说明消息已物化），重建成本与聊天 renderer 同级；一次性修复场景 6/14/15；需先定义 `messages: []`/非数组/较短终态的恢复契约（并行报告 6.1.1 提示避免误保留已撤销 run 的历史）；对 SSE 实时路径的权威性影响需评估（门禁放宽方向只增不减 trace） |
| B 轻量载荷携带最小 trace 指针，按需拉取 | 置顶摘要行保留轻量，点击后经消息索引或专用 API 拉取完整 details | 需要前端按 runId 检索消息的逻辑（本质回到 A）或新 API；复杂度高于 A，收益不明显 |
| C renderer 无条件发布完整快照进 store | 去掉 shouldPublishSubagentRunPayload 的限制 | 违背既有设计意图（SSE 权威、防旧快照覆盖）；粗粒度放宽可能让旧快照回退 timing/error 状态；不推荐（若做应取 A②的「仅 trace 更完整才覆盖」精细门禁） |
| D 服务端兜底（数据源类） | 场景 3/8/11 属进程生命周期/历史数据边界：运行中 partial 可考虑周期性增量持久化（成本高）；旧空 details 不可回溯（无数据来源） | 收益低、成本高，建议仅记录边界不实施；timing-only 持久化（场景 14 后半）若取证证实存在，属 afterToolCall 注入链缺口，按并行报告 6.1.4 最小补齐 |

配套建议：无论是否实施 A，可在 Inspector 轻量 fallback 时给出可感知提示（当前静默缺块，用户无法区分「无过程」与「加载失败」）。

---

## 八、本次核实引用清单（父 Agent 亲读）

- 服务端：agent-subagent-runner.mjs:30-45/:306-353/:481-553；agent-manager.mjs:170-199/:750-803/:893-947/:1605-1665；agent-session-events.mjs:161-243（含 addToolTimingToEvent :169-182 的 quickforgeTiming 注入）；agent-persistence.mjs:375-405；routes/agent.mjs:280-327
- 前端：subagent-run-detail.ts:94-160/:270-311/:440-507/:618-662/:680-756/:758-831（subagentRunPayloadFromToolEvent 回填判断 :790-804）/:851-936；local-tools.ts:612-646/:770-796；server-agent.ts:1005-1016/:2170-2210/:2713-2776；App.tsx:555-578/:1140-1160；GitToolsPinnedSummary.tsx:820-879；WorkspaceInspector.tsx:1028-1048；workspace-inspector-tabs.ts:160-181；ChatPanelHost.tsx:655-659（窗口化禁用）
- 测试：tests/frontend/subagent-run-detail.test.ts:132/:300/:347/:828；tests/server/agent-manager.subagents.test.mjs:210/:273/:322/:363/:426/:475/:531/:575/:811
- 文档/历史：docs/wiki/server/README.md:148；docs/wiki/src/lib/README.md:143/:199/:215/:217；progress.md:1278-1292；feature_list.json:1650-1653（并行交付后顺延）；CHANGELOG.md:91-97；package.json（version 2.1.0）
- 并行调研交叉核实：docs/reviews/subagent-failure-trace-recovery.zh-CN.md 全文（1-168，其 P2/P3 对应的两条退化路径关键源码 subagent-run-detail.ts:798-804 与 agent-session-events.mjs:177-182 已由父 Agent 独立亲读确认成立）

三路并行 explore 调研（服务端持久化链、前端恢复链、历史修复与文档契约）结论与本报告一致；其中「消息窗口化导致 renderer 不回填」的推断经亲读 ChatPanelHost.tsx:658 勘误排除（窗口化当前被禁用，全量渲染）。
