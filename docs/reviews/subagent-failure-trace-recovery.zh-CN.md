# Subagent 失败后过程记录消失：诊断报告

- 日期：2026-09-15（当前会话本地时间 UTC+08:00；执行验证时 UTC 日期为 2026-09-14）。
- 范围：`run_subagent` 已完成工具调用后失败，聊天/置顶摘要打开 Inspector 时过程记录缺失的恢复链路。
- 本次交付：诊断报告；配套诊断测试由父任务新增。未修改生产代码、生成产物或三状态文件。
- **结论边界：未取得真实故障样本、原始 SSE 或现场持久化消息，不能认定现场根因。以下区分已复现的数据变换条件和待现场核实的触发来源。**

## 1. 结论与证据等级

证据等级定义：

| 等级 | 含义 | 本报告边界 |
|---|---|---|
| 测试实证 | 本轮实际运行的合成输入测试断言通过 | 证明函数在指定输入下的行为，不等于浏览器、真实供应商或持久化端到端复现 |
| 源码推导 | 当前源码可定位的分支、调用与数据结构 | 可解释机制，不能证明现场走过该分支；仅阅读的既有测试也不算本轮实跑 |
| 未验证假设 | 缺少现场输入、时序或运行验证的候选解释 | 必须通过第 5 节取证后才能升格 |

核心结论：

1. **终态 `details` 非空但缺 `messages` 时，前端不回填上一快照的过程记录。** 当前判断是“是否存在任意 metadata”，而非“是否存在 trace”；仅含 `quickforgeTiming` 或 `toolCallId` 都会阻止回填。配套测试已复现 6 条过程消息变成空数组，错误正文仍保留（测试实证，[T1]）。
2. **终态 `details` 为空不等于必丢。** 有可解析的上一快照 `details.messages` 时可恢复；没有上一快照时无内容可恢复。恢复依赖 JSON details，不是直接复制 `previousPayload.traceMessages`（测试实证及源码推导，[T1]、[F1]）。
3. **残缺终态 store 可以遮蔽完整历史载荷。** 相同 canonical ID 点击优先 store，不比较 trace 完整度；renderer 也不会覆盖已有终态 store。测试证明选择结果为空，不意味着历史原对象被删除（测试实证及源码推导，[T1]、[F3]）。
4. **轻量载荷 + store miss 是另一条明确退化路径。** 置顶已结束摘要主动省略 trace/input/details；命中完整 store 可恢复，未命中则缺过程。完整历史载荷在 store miss 时仍保留过程，所以不能把所有 miss 都归为丢失（测试实证，[T1]）。
5. 当前 runner 对普通对象错误、超时、父运行中止均有终态 details 保护。不能直接认定“所有失败只保留错误文本”或把旧问题当作当前现场根因；这些保护是否在现场执行及经过上游库后是否完整到达，需要抓取证据（源码推导，[B1]、[B2]）。

## 2. 调用链与两类数据源

```text
父 Agent 的 run_subagent tool.execute
  └─ wrapSubagentToolDefinition → runSubagent
       ├─ subscribe → latestMessages / pendingToolCalls
       ├─ onUpdate(partialResult.details.messages) → tool_execution_update
       ├─ 成功 → result.details.messages
       └─ 错误 → error.quickforgeSubagentDetails
                    → stash(toolCallId) → afterToolCall 取回 details
                            ↓
父 Agent tool_execution_end / 权威 toolResult
  ├─ addToolTimingToEvent → updateRuntimeToolExecution → SSE
  │    → ServerAgent → SubagentRunEventPublisher
  │    → subagentRunPayloadFromToolEvent(previousPayload)
  │    → buildSubagentRunPayload → subagentRunStore
  └─ agent.state.messages → persistSession → 历史消息加载
       ├─ local-tools renderer → 完整 payload → 有条件补 store
       └─ 已结束摘要提取 → lightweight payload
                            ↓
点击聊天/摘要 → store 优先 → WorkspaceInspector → renderSubagentRunBody
```

### 2.1 服务端：更新、终态、持久化不是同一个容器

- runner 在订阅事件时更新 `latestMessages`，工具开始/结束及消息结束立即发 trace，其余事件节流。流式 trace 使用尾部窗口；成功及构建的错误终态直接引用 `latestMessages`（[B1]）。因此运行中看到的窗口不一定等于最终全量。
- 普通运行期对象错误在 catch 附 `quickforgeSubagentDetails`；超时/中止的显式分支加 `timedOut`/`aborted`。若 `prompt` 直接 reject，控制流先到通用 catch，不能保证走到这两个显式标记分支。初始化阶段的外层 catch 只记录并重抛；primitive throw、既有但残缺的 `quickforgeSubagentDetails` 等属于保护边界（源码推导，不代表现场触发，[B1]）。
- wrapper 暂存错误 details，父 Agent 的 `afterToolCall` 取回并返回 `{ details }`。源码注释说明上游对 execute 抛错只保留错误文本，因此该桥接承担恢复职责；本轮未直接验证上游库到数据库的完整链路（[B2]）。
- `addToolTimingToEvent` 在已有 timing 且存在 result 时合入 `quickforgeTiming`；原本空 details 可因此成为 timing-only。这是前端已复现输入的一种**源码上可达的候选来源**，并非证明当前 runner 必然产出空终态（[B3]）。
- runtime 快照把既有 details 与新 details 浅合并，可能暂时保留旧 messages；但权威消息里已有相同 `toolCallId` 的 toolResult 时，runtime 快照会被移除，不按完整度补权威结果。`persistSession` 默认取 `agent.state.messages`，不能把“runtime 快照曾完整”当成“已持久化完整”（[B3]、[B4]）。

### 2.2 前端：变换、缓存、打开、渲染分别检查

- ServerAgent 的 start/update/end 分支调用 publisher；publisher 以 toolCallId 取上一 store 快照、转换后发布，end 后清理 args/name 缓存（[F1]、[F2]）。缺 args 且无缓存时转换不产出 payload，也是恢复前提。
- `buildSubagentRunPayload` 从 `details.messages` 构建 trace；轻量模式最后主动清空 trace/input/details。过程过滤只保留 assistant 与能匹配 assistant toolCall ID 的 toolResult；孤立 toolResult 会被滤掉，因此 messages 非空不保证可见 trace 完整（[F4]、[F5]）。
- store 为纯内存、上限 100、按首次插入顺序淘汰；发布为快照替换而非字段级恢复。完整 renderer 仅能补空 store 或把已有非终态纠正为终态，不能修补已有残缺终态（[F3]）。
- 聊天点击调用 canonical ID resolver；Inspector 打开处再次以 `store.get(runId) ?? request.payload` 取值，并订阅后续更新。因此只修改一个点击入口不足以覆盖全部打开/已打开 Tab 路径（[F6]、[F7]）。

## 3. 场景矩阵

以下“完整”指指定调用的过程消息存在，并非证明无限历史无截断。场景可叠加，例如“普通错误 + timing-only + 残缺 store”。

| 场景 | 触发前提/载荷形状 | 当前行为与可能损失层 | 证据等级 |
|---|---|---|---|
| 成功 | runner 正常返回且 `latestMessages` 含完整过程 | 成功 details 带 messages，非轻量 builder 保留经过滤的 trace；无“成功必丢”的证据 | 源码推导 [B1][F4] |
| 普通错误 | 内层运行期抛对象错误，未已有 quickforgeSubagentDetails | catch 附终态 details，经 stash/afterToolCall 恢复；现场缺失需查该保护是否生效 | 源码推导 [B1][B2] |
| 超时 | timer abort，prompt settle 后进入 timedOut 分支 | 附 messages 与 timedOut；若 prompt reject 先到 catch，不保证相同标记；不推断真实网络超时行为 | 源码推导 [B1] |
| 取消 | 父 signal abort，prompt settle 后进入 aborted 分支 | 附 messages 与 aborted；与“模型普通错误”不同，具体中止时序待测 | 源码推导 [B1] |
| details 空、有 previous | `{}`，上一 details 是含 messages 的合法 JSON | 6 条 trace 全部恢复，toolCalls/error 保留；本用例 timing 沿用上一快照 | 测试实证 [T1:81–91] |
| details 空、无 previous | `{}`，store miss/未收到先前更新等 | 无 trace 可回填，终态仍显示错误 | 测试实证 [T1:110–116]；miss 的现场来源为未验证假设 |
| details 非空缺 messages | timing-only 或 identity-only，previous 含 6 条 trace | 新终态 trace 为空、toolCalls 缺失，上一对象未被就地修改；发布后可能替换 store | 测试实证 [T1:93–108]；发布替换为源码推导 [F1][F3] |
| 轻量/store miss | 历史 builder `lightweight=true`，无匹配 store | trace/input/details 为空；完整 store 命中则可恢复 | 测试实证 [T1:118–129] |
| 残缺 store 覆盖完整历史 | canonical ID 相同、store 是无 trace 终态、renderer 完整 | resolver 选择残缺 store，完整历史被遮蔽而非删除 | 测试实证 [T1:131–143]；补 store 门禁为源码推导 [F3] |
| 完整历史/store miss（反例） | renderer 非轻量且有 messages，无 store | 直接使用完整历史 payload，trace 不消失 | 测试实证 [T1:145–150] |

## 4. 数据丢失层级与判定标准

| 层级 | 怎样才算该层缺失 | 不应混淆的现象 |
|---|---|---|
| L0 子运行采集/窗口 | 子 Agent 完成工具，但 runner latestMessages 或发出的 update 已缺对应调用/结果 | update 尾部窗口与过滤造成的截断不等于数据库删记录 |
| L1 终态/权威持久化 | end 或权威 toolResult.details.messages 缺失；持久化读取也证实缺失 | 浏览器缓存为空不能证明落盘为空；runtime 完整不能证明权威完整 |
| L2 SSE→payload→store | 同一 ID 的 earlier update 完整，terminal 非空缺 messages，转换后 trace 空 | 测试仅证明变换结果，不能证明真实 end 的来源 |
| L3 打开来源选择 | 持久化/renderer 完整，但打开选择了残缺 store，或轻量 payload 无 store 可补 | 这是恢复/展示信息不可达，不等于源数据被删除 |
| L4 过滤/渲染 | payload 有原始 messages，但 toolCall 配对过滤后少；或可显示 trace 有而视图未展示 | 终态错误去重不应笼统称为工具历史删除；本轮未做 DOM/浏览器验证 |

最小诊断顺序：先按 `toolCallId` 比较原始 messages 与配对 ID，再比较 payload、store 和点击所选对象，最后检查 UI。只看“已结束 · N”或 `toolCalls` 数字不能证明 N 个已完成结果都在：runner 在 beforeToolCall 计数，可能包含未完成/被阻止的调用（[B1]）。

## 5. 如何取证：SSE、持久化、刷新前后

本轮没有读取真实会话存储，也没有取得现场故障数据。后续仅在获授权的工作区内处理脱敏导出，不读取 `.env`、认证头、token、私钥或其他秘密；不要把完整敏感工具输出贴进报告。

### 5.1 刷新前先冻结证据

1. 记录客户端/服务端版本、父 sessionId、外层 `run_subagent` toolCallId、子 sessionId、发生时间、打开入口（聊天卡/置顶摘要）与是否已打开 Tab。
2. 保存对应 start、最后几个 update、end，以及 agent_end/消息重新加载事件的脱敏 SSE 内容与顺序。重点保留 `isError`、`args` 是否存在、`result/partialResult.details` 的键、`messagesTotal`、messages 长度与 role/toolCall ID、pendingToolCalls、timing、timedOut/aborted。
3. 在转换/打开断点记录同 ID 的 previousPayload、terminal payload、store payload、renderer payload 和最终选用对象；记录 trace 长度、details 是否含 messages、canonicalToolCallId、status、fingerprint。不要假定 store 已暴露为浏览器全局变量；必要时使用源映射断点，无需改生产代码。

### 5.2 对照权威消息与持久化

1. 在确认本轮持久化完成后，通过已有受支持的历史加载/导出入口取得该父会话 toolResult，按 toolCallId 对齐，不凭错误文本搜索关联。
2. 区分运行态 API 快照、内存 agent.state.messages 与实际持久化读回；若只能取得其中一种，明确标注，不能称为三者一致。split/paged 历史应确认目标消息页已加载，不能把第一页缺记录当成落盘缺失。
3. 比较 end.details、持久化 toolResult.details、刷新后历史加载响应的键/长度与调用结果配对。若 end 完整而落盘缺失，调查 afterToolCall→权威消息→持久化；若落盘完整而 UI 空，优先 L2/L3/L4。

### 5.3 刷新对照的解释

- **刷新前空、刷新后聊天卡完整**：支持内存快照/来源选择问题，但需确认历史回填实际发生，不能只凭恢复现象定根因。
- **聊天卡完整、置顶摘要空**：核对轻量 payload 与 store miss、renderer 是否已经执行并补 store；入口差异是重要证据。
- **刷新后仍空、持久化也缺**：才有依据沿服务端终态/持久化链追查；仍需排除消息分页未加载。
- **刷新后仍空、持久化完整**：继续检查回填时序、残缺终态门禁与过滤；刷新重建纯内存 store 不代表一定以完整历史先回填。
- 刷新会改变内存证据，务必先保存 5.1，再做对照；不要为验证猜测而清库或删除历史。

## 6. 最小修复建议与测试缺口

以下是后续方案，不是本轮已实施修复。

### 6.1 建议按证据分层修复

1. **优先补前端终态字段级恢复**：将“任意 metadata 非空”改为明确的 trace 完整性判断，在终态缺 messages 且 previous 有合法 messages 时恢复；保留终态错误正文、isError、timing 及身份等权威字段。不要用 previous 整体覆盖终态。对显式 `messages: []`、非数组 messages、较短终态是否恢复先定义契约，避免误保留已撤销/错误 run 的历史。
2. **统一打开/回填的完整度规则**：相同 canonical ID 下，允许完整历史补齐残缺终态的 trace，但不回退状态、耗时或错误。覆盖 renderer 门禁、聊天 resolver、Inspector 再取 store 及订阅路径；不能只修改 `resolveSubagentRunPayloadForOpen` 就声称修复全部入口。
3. **轻量 miss 按需恢复**：优先由同 ID 的已有历史 toolResult 重建完整 payload，再考虑授权的按需历史加载；无需一开始扩大缓存、取消轻量化或引入新依赖。若无数据可恢复，明确降级提示，不能伪造 trace。
4. **服务端仅在取证定位后补缺口**：现有通用 catch 已保护普通对象错误；仅针对证实的提前失败、异常形状或 afterToolCall 桥接缺口做最小补充。保留错误原文与取消语义，不以广泛重构替代诊断。

### 6.2 测试缺口

- 新增测试是当前行为诊断：已知丢失断言不应永久作为产品期望。实施修复后应改为恢复契约，并保留触发 fixture。
- 增加 publisher+真实 store 的 update→end→打开集成测试，覆盖错误正文、timing、toolCalls、已完成工具调用/结果配对及无 args 缓存场景。
- 增加 runner→wrapper/stash→afterToolCall→父权威 toolResult→持久化→刷新恢复端到端测试，分别覆盖成功、普通错误、超时、取消，并含多个**已完成**工具结果，而非只有 pending tool call。
- 增加 details absent/null/{}、timing-only/identity-only、`messages: []`/非数组/较短窗口、previous.details 非 JSON，以及缺 messages 但保留其他元数据的组合。
- 增加残缺终态 store + 完整历史的门禁/Inspector 订阅测试，防止只修 resolver；增加超过 100 快照淘汰、刷新、历史分页、轻量 miss 后按需恢复测试。
- 增加 trace 窗口切断 toolCall/toolResult 配对、模型流重试、取消先 reject 与先 resolve、快速完成后旧 update 到达的时序测试。上述时序是否现场发生均未验证。
- 浏览器验证两种打开入口与已打开 Tab，确认错误摘要去重没有影响已完成工具卡；纯函数测试不覆盖渲染结果。

## 7. 验证记录、引用索引与文档影响

### 7.1 本轮实际验证

执行：`npx --no-install vitest run tests/frontend/subagent-failure-trace-recovery.test.ts`。

结果：**1 个文件、7 个测试全部通过**。fixture 为 3 个已完成工具调用及 3 个结果（6 条 trace），覆盖空 details 恢复、两种非空缺 messages、无 previous、轻量 miss、残缺 store 优先、完整历史 miss 反例。未运行真实模型、浏览器、持久化端到端或全量 test/lint/build，不据此宣称端到端修复。

文档影响：本报告记录既有架构与候选缺口，未变更公共入口、模块职责、发布流程或生产契约，因此本轮无需修改 wiki；实施修复时应同步 wiki 中 store 权威、轻量载荷与点击恢复契约。三状态文件由父任务统一维护，本报告任务不修改。

### 7.2 引用索引（当前源码行号）

以下路径相对于仓库根；行号是本轮读取快照的导航范围，后续修改后应按符号名复核。正文的 `[T1:81–91]` 表示 T1 文件中的对应子范围。

| 编号 | 文件与行号 | 支撑内容 |
|---|---|---|
| T1 | `tests/frontend/subagent-failure-trace-recovery.test.ts:9–151` | fixture、7 个诊断断言与证据边界 |
| B1 | `server/agent-subagent-runner.mjs:324–390,448–553`；计数前提 `422–433` | 流式窗口、终态 details、成功/错误/超时/取消分支、调用计数 |
| B2 | `server/agent-manager.mjs:177–198,755–759` | wrapper、stash、afterToolCall 注入 |
| B3 | `server/agent-session-events.mjs:161–242`；`server/agent-manager.mjs:895–943` | timing 注入、runtime 合并/淘汰、事件前转发 |
| B4 | `server/agent-persistence.mjs:188–239` | 持久化默认数据源是 agent.state.messages |
| F1 | `src/lib/subagent-run-detail.ts:778–830,866–935` | 终态回填条件、publisher 缓存/取 store/发布 |
| F2 | `src/lib/server-agent.ts:2183–2208` | start/update/end 调 publisher |
| F3 | `src/lib/subagent-run-detail.ts:98–160,475–507` | 内存上限、快照替换、renderer 门禁、canonical resolver |
| F4 | `src/lib/subagent-run-detail.ts:644,696–748` | 摘要轻量构建、messages→trace 与省略字段 |
| F5 | `src/lib/subagent-process-trace.ts:5–24` | assistant/toolResult 配对过滤 |
| F6 | `src/lib/local-tools.ts:607–626,668–670,785–793` | 聊天点击、body 数据源、历史 renderer 回填 |
| F7 | `src/components/workspace/WorkspaceInspector.tsx:1042,1344–1346` | 打开时再次 store 优先、订阅更新 |

**最终判断：已定位并测试复现两个前端恢复薄弱点（非空 details 缺 messages；残缺 store 遮蔽完整历史），并确认轻量/store miss 的独立降级条件；尚未证明这些条件就是用户真实故障的触发链。现场根因必须由同一 toolCallId 的 SSE、权威持久化与刷新前后载荷共同确认。**
