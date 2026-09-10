# Goal 功能设计评审报告

> **评审对象**：Goal 模式的**设计层**——服务端状态模型（`server/agent-goal-state.mjs`，610 行，纯函数）、执行编排（`server/agent-goal-runner.mjs`，1406 行）、goal 端点（`server/routes/agent.mjs:212-247`）、持久化与重启恢复（`agent-manager.mjs` / `agent-persistence.mjs` / `agent-compaction.mjs` 集成）、前端同步契约（`src/lib/goal.ts` / `goal-ui.ts` / `goal-edit.ts` / `server-agent.ts`）。
> **与 UI 评审的关系**：视觉/样式/文案层已由 `docs/reviews/goal-ui-review.zh-CN.md`（26 项问题 + 优化示例）覆盖并落地 P0，本报告不重复，仅在交互语义与前端契约处交叉引用。
> **方法**：两路只读调研（服务端设计面全量转换表 + 历史开放问题逐条核实）+ 父 Agent 亲读 `agent-goal-state.mjs` 全文与 `agent-goal-runner.mjs` 关键段（约 700 行）、goal 端点、manager 命令分发顺序，**本报告全部 文件:行号 引用均经亲自读取核实**。
> **现状基线**：预算默认 8 轮 / **120 分钟**（本轮已从 30 分钟调整，`agent-goal-state.mjs:49-52`）；侧栏 UI 已按 After 形态重构。
> **性质**：静态代码设计评审 + 状态机图（`docs/reviews/goal-state-diagram.svg`）。无运行动态复现，时序类结论为代码路径推断，已单独标注。

---

## 一、设计总览与总体评价

### 1.1 分层架构

```
POST /goal 命令 ──┐                        POST /api/agents/:id/goal (action)
                  ▼                                        ▼
agent-prompt-commands ──► agent-manager (runPrompt/continueSession/hook 编排)
                  │                        │
                  ▼                        ▼
          agent-goal-runner.mjs（I/O 编排：admission 队列、settle barrier、
                  │           watchdog、用户动作、goal_report 工具注入）
                  ▼
          agent-goal-state.mjs（纯函数：13 状态机、预算核算、证据校验、
                                人审验收、恢复映射、revision 单点递增）
                  ▼
          agent-persistence.mjs（goal body 随会话权威 CAS 同事务持久化，
                                 metadata 只存 {id,status,updatedAt} 投影）
```

配套设计见 `docs/reviews/goal-state-diagram.svg`（13 状态 + 主要转换）。

### 1.2 总体结论

**骨架设计质量高**，多处工程纪律值得肯定：

| 亮点 | 证据 |
|---|---|
| revision/updatedAt 单点递增，所有变更必经 `withGoal` | `agent-goal-state.mjs:234-242` |
| 终止意图「只升不降」：cancel 不可被 abort/pause 降级，提交守卫拒绝旧结算覆写 | `agent-goal-runner.mjs:152-166`、`:243-246` |
| persist fail-closed：持久化失败绝不续跑（用户动作回滚并报 503；内部流转落 `paused/persist_failed`） | `agent-goal-runner.mjs:237-274`、`:813-828` |
| 显式 settle barrier：结算等待 promptPromise 而非假设 persist 顺序 | `agent-goal-runner.mjs:616-619`、manager `:982-993` |
| 证据信任链：toolCallId 只认「本 goal 版本内真实成功的验证工具」，human 证据唯一入口是用户 API | `agent-goal-runner.mjs:1218-1253`、state `:338-371` |
| 重启不重放：IN_FLIGHT 一律映射 paused | `agent-goal-state.mjs:40-47`、`:567-580` |
| goal 水位不污染消息 stateVersion（防丢消息对账） | `src/lib/server-agent.ts:1650-1662` |

**但存在三类设计问题**（详细论证见后文，编号沿用本报告）：

| 级别 | 问题 | 编号 |
|---|---|---|
| 🔴 高 | 并发 `/goal` 双写窗口：已有活跃 goal 的检查在 admission 锁外、`commitGoal` 无二次守卫、工作区冲突检查明确跳过同 sessionId——两个并发 `/goal` 后者覆盖前者 | X1 |
| 🔴 高 | `/clear`、`/compact` 先于 GOAL_ACTIVE 检查执行且完全不触碰 goal——与消息回滚守卫（明确 409 防"evidence/criteria 与对话脱钩"）**同类风险不对称防护**；调度间隙 clear 后续跑仍在已清空会话上执行 | X2 |
| 🟡 中 | `failed` 是死状态（零入边）；pendingDisposition 吞掉 error 计数；结算窗口内用户中止仍可能得到 needs_review；criterion 降级不清理证据绑定；预算超时+已完成报告双重提交 | D1/D2/E1/B3 |

其余为中低优先级设计债与既定边界，见第八、九节。

---

## 二、状态机设计（维度①）

### 2.1 状态全集与分区

13 状态（`agent-goal-state.mjs:19-33`）分四区：**终态** completed/failed/cancelled（`:37`）；**IN_FLIGHT**（重启映射 paused，`:40-47`）planning/running/verifying/awaiting_input/awaiting_approval/pausing；**用户等待态** awaiting_confirmation/paused/blocked/needs_review；运行态 running/verifying。可编辑（revise）仅 awaiting_confirmation/paused/blocked（`:94-96`）；动作门控 `goalCanConfirm/Pause/Resume`（`:108-118`，与前端 `src/lib/goal.ts:280-294` 一致——本轮 UI 评审曾据此修正「三按钮溢出」误判）。

主要转换（全量 32 条转换表见调研附录，关键路径）：

- `/goal` → **planning**（`runner:853-883`）；`goal_report(plan)` → **awaiting_confirmation**（state `:288-311`，criteria 服务端分配 id、清证据、planConfirmed=false）
- **confirm** → running（runner `:950-969`，锁内二次复查 + planConfirmed=true）；**revise** → planning（state `:314-326`，计划/证据清空、**usage 保留防绕预算**）
- running ↔ **awaiting_approval**/**awaiting_input**（审批/ask hook，runner `:1118-1161`）；审批拒绝/超时、ask 跳过 → paused
- `goal_report(complete|needs_review)` → **verifying** → 轮真正结束且持久化后 → **needs_review**（runner `:1319-1331`、`:729-735`）
- **needs_review** → accept → **completed**（唯一人审完成路径，state `:441-496`）；resume/extend_resume → running/awaiting_confirmation/planning（runner `:983-1016`、`:912-948`）
- **cancel** → cancelled（intent 先行 + 失败回滚，runner `:1041-1076`）
- **重启**：IN_FLIGHT → paused（state `:567-580`）

### 2.2 发现的问题

#### D1【中】死状态 `failed`：状态枚举含一个永远不可达的终态

`GOAL_STATUSES` 包含 `failed`（state `:31`），但 runner 全文**没有任何 `setGoalStatus(..., 'failed')` 调用**（全文检索仅注释/日志/`continuation_failed` blocker 字符串）。错误路径统一落 `paused` + `repeated_failures`（runner `:766-771`）。前端却为它准备了状态标签「失败」（i18n goalStatusFailed）与 Note 文案（goalFailedNote）。
**影响**：① 死代码与永不触发的 UI 分支；② 「执行失败」语义上应为终态的场景（如 repeated_failures 后用户放弃）只能以 paused/cancelled 表达，用户无法区分「失败的目标」与「暂停的目标」除 blocker 外的语义差异。
**方向**：要么把 repeated_failures 达到上限且无进展时落 `failed`（终态化），要么从枚举与前端删除该状态；二选一，保持状态机最小完备。

#### D2【中】pendingDisposition 优先于 error：错误被吞、repeated_failures 保护失效

`finishGoalRun` 决策序中 `run.pendingDisposition` 分支（runner `:729-736`）位于 `endStatus === 'error'` 分支（`:766-773`）**之前**。模型 `goal_report(complete)` 后本轮运行以 error 收尾时：goal 直接落 needs_review，`consecutiveFailures` 不 +1，error 计数与 no-progress 计数全部跳过。
**影响**：模型可以「先报告后出错」绕过连续失败保护（需两次+错误才触发），把错误包装进 needs_review 交给人审。人审兜底存在（用户会看到证据），但保护机制在此路径失效。
**方向**：disposition 提交时若 `info.status === 'error'`，仍累加 `consecutiveFailures`（或在该分支记录 error 标记供人审卡片展示）。改动点集中在 `finishGoalRun`，影响面小。

#### D3【中】结算窗口内用户中止仍可能得到 needs_review

用户在 goal_report 已发生、轮尚未完全结束时点「停止」：`notifyGoalAbort` 在 settling 时只记 intent 即返回（runner `:1182`），而 `finishGoalRun` 的 pendingDisposition 分支直接提交 needs_review 后 return（`:729-735`），**不经过 abort 检查与 generation 复查**（那些在更靠后的分支）。
**影响**：用户明确中止后看到的是「待复核」而非「已暂停/user_aborted」，与 abort 的直觉语义冲突（报告已验证完成是事实，needs_review 也说得通，但用户意图被忽略）。cancel 不受影响（commitGoal 的 cancel-intent 守卫 `:243-246` 拒绝非终态覆写）。
**方向**：pendingDisposition 分支提交前检查 `goalTerminationIntent === 'abort'`，若用户在报告后明确中止，落 paused(user_aborted) 并保留 pendingDisposition 供 resume 后再结算，或至少在 needs_review blocker 中标注「你已中止本轮」。

#### D4【低】planning 期 notifyGoalAbort 的 pausing 分支无 goalCanPause 限制

runner `:1183-1186`：有 run 在飞且非 pausing 即转 pausing——包括 planning 轮。planning 的 abort 语义最终落 paused(user_aborted) 合理，但与 `goalCanPause`（仅 running/verifying，state `:112-114`）的门控口径不一致，属实现细节而非缺陷，记录备查。

---

## 三、预算模型（维度②）

### 3.1 规则总结

- **默认 8 轮 / 120 分钟**（state `:49-52`）；`createGoalState` 对传入 budget 做下限钳制（时长 < 默认值抬到默认，`:256-262`）——**时长下限恒等于默认值**，改默认即改下限。
- **iterations**：仅 `beginGoalRun('execution')` 时 +1（runner `:482`），planning 轮不计；递增发生在 run 实际启动**前**。
- **activeDurationMs**：轮结束时以 `Date.now() - run.startedAt` 墙钟一次性累计（runner `:722-723`；persist 失败路径同样累计 `:824`）。运行期间不实时累计。
- **watchdog**：`beginGoalRun` 设 `setTimeout(remaining)`（runner `:489-495`）；到期无 disposition → pausing + duration_budget + abort；有 disposition → 直接提交 needs_review + abort（`:500-524`）。**只在 finish/fail/cancel/stop 清除**（`:716`、`:818`、`:1067`、`:1198`）。
- **耗尽判定与门控**：`goalBudgetExhausted`（state `:537-541`）；confirm/resume/revise/续跑前均 `assertGoalBudget`（runner `:459-464` 等）；resume 耗尽 409 提示 extend_resume 出口。
- **extend_resume**：仅耗尽维度 +默认值（+8 轮 / +120 分钟），usage 保留（runner `:934-936`）。
- **核算不 bump revision**（runner `:276-284`）；progress signature 刻意排除 revision/usage（state `:548-554`）——no-progress 判定不被记账噪声污染，设计正确。

### 3.2 发现的问题

#### B1【中】watchdog 在人审等待期持续计时：等待审批/回答消耗「活跃时长」预算

awaiting_approval / awaiting_input 期间 run 不结束、watchdog 不清除（清除点仅 `:716/:818/:1067/:1198`）。「累计活跃时长」名义上计量模型工作时长，实际把**等人**的时间也计入。120 分钟预算下影响减轻，但一次长时间审批等待（用户离开）仍可能耗尽预算并触发 pausing。
**方向**：等待态进入时暂停 watchdog（记录已用），恢复时重设 remaining；或至少把等待时长从墙钟中扣除（需要分段计时）。涉及 runner 的审批/ask hook 与 beginGoalRun，属中等改动。

#### B2【低】iterations 在 run 实际启动前消耗

`beginGoalRun` 先 +1（runner `:482`），随后 `startGoalRun` 若 prompt 立即抛错（`:620-622`）该轮已计数。失败轮消耗预算与「8 轮执行机会」的用户直觉略有偏差（现行实现把启动失败也当作一次机会）。低影响，记录备查。

#### B3【中】预算超时 × 已报告结果：一次结算两次 commit、revision 双跳

`handleBudgetTimeout` 的 pendingDisposition 分支（runner `:504-514`）立即 commit needs_review 并 abort；随后 agent_end → `finishGoalRun` 再次累计时长并再次 commit 同一 disposition（`:722-735`）。同一逻辑结算产生两次 revision bump、两次 SSE `goal_updated`（前端 goalSeq 会消化第二次，无功能性错误），但 revision 语义被稀释（「数值变了两次」），且两次 commit 之间窗口内用户动作可能插入。
**方向**：timeout 分支只记 `run.pendingDisposition` 已存在的标志 + abort，把唯一 commit 留给 finishGoalRun；或 finishGoalRun 检测「disposition 已提交」跳过第二次 commit。

#### B4【低】追加额度=默认值跟随（本轮用户已选定的权衡）

`extend_resume` 直接 `+= GOAL_BUDGET_DEFAULTS`（runner `:935-936`），无独立 tranche 常量。已文档化的后果：默认改 120 分钟后，**旧 30 分钟 goal 首次追加直接 +120 分钟**（wiki server/README 已注明）。技术上 `runner:937-941` 的「追加后仍耗尽 → paused」分支实际不可达（iterations 不会超 max；duration 超出量受 watchdog abort 延迟约束远小于 120 分钟）——属防御性代码，无害但可注明。
**方向**：如后续需要「默认与追加解耦」，先拆独立常量 `GOAL_BUDGET_EXTENSION`（服务端 + `src/lib/goal.ts:96-97` 前端镜像 + 测试三处同步）；当前权衡可接受。

#### B5【记录】无自定义预算、无环境变量覆盖

API 严格拒绝自定义预算（extend 三键校验 runner `:913-917`；历史测试锁定「不允许自定义预算」契约）。这是防绕预算的有意设计，但对「我只想跑 2 轮」的轻量场景无出口——只能 cancel 重建。记录为产品权衡，非缺陷。

---

## 四、证据与人审验收模型（维度③）

### 4.1 设计总结（亮点为主）

- **可信工具白名单**：仅 `run_command / read_file / grep_files`（runner `:62-66`）；控制面/委派/Skill/记忆工具永不作为证据。
- **成功判定严谨**：`run_command` 要求 `details.code === 0` 且无 timedOut/aborted/signal（runner `:208-220`）；`event.isError` 只反映传输层不可信，代码专门处理了这一陷阱。
- **信任链**：可信集合 = 运行时 map ∪ 已持久化 evidence（runner `:1218-1226`）；map 仅在 start/revise 重置（`:881`、`:1100`）——「当前 goal 版本」边界清晰。
- **goal_report 校验链**：active + 本轮未报告（`:1263-1270`）→ toolCallId 可信（`:1240-1253`）→ mergeGoalEvidence 拒 human/要 toolCallId+description/上限 40（state `:338-371`）→ criterion passed 必须有全部已知 evidenceIds（state `:397-407`）→ 任一步失败整单 400（runner `:1303`）。
- **完成闸**：`goalCompletionCheck` 要求 ≥1 required criterion、全部 passed、每条证据绑定 toolCallId 或可信人审（state `:507-535`）；`complete` 报告失败即零提交。
- **人审**：`accept` 唯一入口；failed required 阻断（state `:445-455`）；human 证据无伪造 toolCallId、溢出优先丢弃未被引用条目（`:472-486`）。「模型不能自我验收」的核心安全属性成立。

### 4.2 发现的问题

#### E1【中】criterion 状态降级不清理/不校验旧证据绑定：状态与证据单向一致

`applyGoalCriterionUpdates`（state `:374-418`）：仅 `passed` 方向校验 evidenceIds 已知且非空；**非 passed 方向**（pending/failed/needs_review）在 `raw.evidenceIds` 缺省时**沿用旧绑定**（`:394-396`），并以 `{ status, evidenceIds }` 直接合入（`:409`）。模型可以把 criterion 置 failed/pending 而保留「通过语义」的旧证据，或后续用旧轮 evidenceId 再次置 passed。
**影响**：needs_review 时 criterion 状态与证据指向可能不同步（人审看到 failed 的准则仍挂着通过证据）；但都在「本 goal 版本内真实验证工具」的信任圈内，无伪造风险，属**一致性弱点而非安全缺口**。
**方向**：非 passed 更新时若未显式给出 evidenceIds 则清空绑定；或降级时保留但 UI 标注「证据来自此前判定」。改动集中在 state 纯函数 + 测试。

#### E2【低】evidence 无轮次概念

evidence 条目不含轮次字段（state `:158-175`），第 1 轮的证据可在第 8 轮支撑判定。对「验收标准已满足」的语义而言可接受（通过即为通过），但与 no-progress signature（`:548-554`）组合时，重复引用旧证据不触发 no-progress。记录备查。

#### E3【低】planning 期只读工具进入信任集且跨阶段保留

`recordGoalToolExecution` 在 planning 状态也记录（runner `:189`），且 confirm/resume 不重置信任集（仅 start/revise 重置）——规划期的 grep/read 结果可在执行期作为证据引用。与注释「current goal version」自洽（planning 属同一 goal version），但「规划期证据」与「执行期证据」无区分。低影响。

#### E4【低】重启后信任集仅靠持久化 evidence 回填

重启后运行时 map 为空，旧证据 toolCallId 仍可信（经持久化 evidence 回填，runner `:1218-1226`），但**重启前成功却未写入 evidence 的工具调用**不可再引用（goal_report 400）。模型需要重跑验证命令。行为安全（宁可重验），对用户是轻微体验损失。记录备查。

---

## 五、执行与持久化（维度④）

### 5.1 设计总结（亮点为主）

- **工作区互斥**：per-key admission 队列（runner `:295-306`）串行化 start/confirm/resume/revise/extend 的「检查+提交」；冲突检测扫内存 + metadata 投影并对候选回读权威 body（`:329-363`）；规范化 path key 使两个 projectId 指向同一目录也无法并行（state `:595-605`）。
- **每轮纪律**：`scheduleGoalContinuation` → `waitForGoalIdle`（200ms 轮询、15s 上限）→ `canStartGoalRun` 全量守卫（同实例、预算、pauseRequested、状态、无流/无 pending 工具/审批/ask）→ `beginGoalRun` → `startGoalRun` 接管 activeCommand token 防旧清理覆写（runner `:526-624`）。
- **结算纪律**：agent_end 先 `flushSessionPersist` 再 settle（manager `:982-993`）；persist 失败 fail-closed（manager `:500-523` → runner `:813-828`）。
- **cancel 语义**：intent 先于 commit 记录（防旧结算覆写）、失败回滚 intent（`:1056-1065`）、teardown 只在 durable 之后（`:1066-1074`）。
- **会话独占**：普通 prompt/retry/steer/followUp 在活跃 goal 下一律 409 GOAL_ACTIVE（manager `:1221-1228`、`:1327-1347`、`:1476-1516`）。
- **重启恢复**：goal body 随会话同事务 CAS 持久化（persistence `:188`、`:233-236`、`:303-314`）；空会话清理在有 goal 时跳过（`:193`）；runtime 簿记全内存、destroy 先 stop 再终 persist（manager `:1726-1748`）。

### 5.2 发现的问题

#### X1【高】并发 `/goal` 双写窗口：锁外检查 + commitGoal 无守卫 + 冲突检查跳过同 session

三个证据链共同构成缺口：
1. `startGoalPlanning` 的「已有活跃 goal」检查（runner `:863-868`）在 `withWorkspaceAdmission` **锁外**；锁内（`:873-876`）只做 createGoalState + commitGoal，**无二次 re-check**——对比 confirm/resume/revise 均有锁内 re-check（`:958-960`、`:1005-1007`、`:1089-1091`）。
2. `commitGoal` 无「已有活跃 goal」守卫（仅 cancel-intent 守卫 `:243-246`）。
3. `findWorkspaceGoalConflict` 明确跳过同 sessionId（`:347-348`），同会话第二个 `/goal` 在锁内不可见。

`runPrompt` 入口 isStreaming 检查到 `startGoalPlanning` 首个 await 之间有多个 await 点，Node 单线程下两个并发 HTTP 请求可在微任务边界交错：A 读旧 goal → B 读旧 goal → A commit 新 goal → B commit 新 goal（**覆盖 A**）。A 的 goal 成为孤儿（无运行、不可达，直到下一次普通 prompt 触发终态清理——而它不是终态，清理不触发）。
**影响**：数据一致性缺口（窄窗口、需用户主动并发双发）；孤儿 goal 会永久占用会话（活跃态阻塞普通消息，用户需手动 cancel 一个自己没见过的 goal）。
**方向**：在 `withWorkspaceAdmission` 锁内补「session.goal 仍无活跃 goal」re-check（一行守卫，模式与 confirm 一致），即可关闭该窗口。属小改动。

#### X2【高】`/clear`、`/compact` 先于 GOAL_ACTIVE 执行且不触碰 goal：与回滚守卫不对称

- 命令分发顺序：clear/summary/compact 分支（manager `:1209-1219`）在 GOAL_ACTIVE 检查（`:1223-1228`）**之前**。
- `clearSession`（agent-compaction `:285-316`）只检查 isStreaming，清空消息/标题/状态，**全程不触碰 `session.goal`**；`compactSession`（`:194-206`）同样。
- 对照：消息回滚有专门守卫（manager `:1058-1065`，注释明确「Rolling back the transcript of a goal would desync the goal's evidence and criteria…require pause/cancel first」→ 409）——**同一类「证据/准则与对话脱钩」风险，回滚有防护、clear/compact 没有**。

两个具体后果：
1. paused goal 下 `/clear`：消息清空、goal 原样残留（goal body 存在 session state，persistence `:235`），用户后续普通消息仍被 GOAL_ACTIVE 拒，需回 goal 卡操作一个上下文已被清空的 goal。
2. 更严重：调度间隙（`goalContinuationPending=true`、isStreaming=false）时 `/clear` 可执行，消息清空后 **continuation 仍在清空后的会话上续跑**——goal 的证据/准则与已消失的对话彻底脱钩，正是回滚守卫注释所担心的 desync。
**方向**（两选一或组合）：① clear/compact 分支移到 GOAL_ACTIVE 检查之后（活跃 goal 直接 409，提示先 pause/cancel）；② clearSession 检测活跃 goal 时自动 cancel（终态化）。方案①改动最小且与 rollback 口径一致。

#### X3【低】终态清理依赖「下一次普通 prompt」

`clearTerminalGoal`（runner `:1106-1112`）只在用户下一次普通 prompt/retry 时触发（manager `:1229-1232`、`:1345-1347`）。completed/cancelled 的 goal 会一直挂在会话上（UI 呈现终态卡）直到用户主动发消息。产品语义可辩护（历史可查），记录备查。

#### X4【低】`normalizeGoalState` 不交叉校验 criteria.evidenceIds ⊆ evidence

state `:182-231` 归一化各字段独立处理，不校验引用完整性；悬空引用只在 `goalCompletionCheck`（`:507-535`）被发现。防御性归一化的完整性缺口，低影响（持久化 body 由本模块写出，正常路径自洽）。

#### X5【低】workspace key 内存扫描不对称

`findWorkspaceGoalConflict` 对其他内存会话只用 `projectContext.workspaceRoot`（runner `:331-337`），当前会话走 `workspaceKeyForSession` 的 `resolveWorkspaceRoot` 兜底（`:309-313`）。其他会话 workspaceRoot 缺失时 key 退化为 project:/global，可能漏判同目录冲突（内存路径）。metadata 路径有回读兜底，影响窄。

---

## 六、API 设计（维度⑤）

### 6.1 设计总结

单端点 `POST /api/agents/:sessionId/goal`（routes `:212-247`）：action 枚举校验（400）、restoreAgent 404、请求级 source 门禁（共享/ACP/定时任务 409 GOAL_UNAVAILABLE，**请求级而非会话级**——与 context-references 的会话级残留旧问题形成对照，见 §8-8）、extend_resume 传整个 body 其余只传 objective。错误码体系完整（409 GOAL_CONFLICT/SESSION_BUSY/WORKSPACE_CONFLICT/BUDGET_EXHAUSTED/BUDGET_NOT_EXHAUSTED/REVISION_CONFLICT/ACTION_INVALID/ACCEPT_BLOCKED/UNAVAILABLE/ACTIVE；400 ACTION_INVALID/OBJECTIVE_REQUIRED；404；503 SESSION_PERSIST_FAILED）。

### 6.2 发现的问题

#### A1【中】仅 extend_resume 有 revision CAS：多标签页动作竞态（既定边界）

routes `:242-244` 只为 extend_resume 传完整 body；`handleGoalAction` 仅 extend 分支做 goalId+revision 严格匹配（runner `:912-923`）。confirm/pause/resume/cancel/revise/accept 无跨客户端原子防护——两标签页同时对同一 goal 操作时后到者直接生效，仅靠状态机状态校验兜底（如 goalCanConfirm）。前端有替代缓解（`adoptGoalState` 水位拒绝旧响应，server-agent.ts `:1636-1648`；extend 前严格快照预检 `:1542-1548`），feature 历史已明示此为既定边界。
**方向**：如需收紧，可将 extend_resume 的三键模式推广为所有动作可选的乐观锁（向后兼容：不带 revision 走现状）。属 API 契约扩展，需前后端 + 测试同步。

#### A2【低】输入严格性不对称

extend_resume 拒绝任何额外字段（runner `:913-917`），其余动作静默忽略未知键（routes `:244` 只取 objective）。一个端点两种输入哲学。低影响，记录备查。

#### A3【低】注释与实现漂移

runner 头注释 `:16-17`「Only a user `resume` completes it」——实际完成路径是 `accept`（state `:488`），resume 是继续执行。注释应修正，避免误导后续维护。

---

## 七、前端同步契约（维度⑥）

已在位的设计（本轮核实，无需改动）：

- **goalSeq 独立水位**：同 id 比 revision、跨 id/null 比水位、相同回显不推进（server-agent.ts `:1636-1648`）；HTTP 动作响应与 `/state` 刷新都带请求前水位守卫（`:2316-2351` 双捕获）。
- **不污染消息 stateVersion**：goal 帧推进 goalSeq 而不推进消息版本（`:1650-1662`、SSE case `:2025-2039`），避免作废在途消息对账导致丢消息；SSE 帧版本下界拒绝回退帧（`:2148-2156`）。
- **goal-ui 共享锁**：按 sessionId+goalId 持有 pending/dirty/error/草稿，三个 surface 同源锁，脏草稿拒绝除 revise 外的动作；关闭侧栏由 layoutEffect 取消未发请求（UI 评审已覆盖展示层）。
- **goal-edit 暂停保存**：运行中保存先确认 pause，等权威 paused 且非 streaming 后 revise；App 绑定单次严格快照预检（`refreshGoalForSave`，server-agent.ts `:1542-1548`）。

残留边界（与历史口径一致）：广义 SSE epoch/多端消息对账（重连、多标签页）仍开放，goal 特有部分已闭合；`context-references.mjs:62` 仍按会话级 `modelAccessContext.source === 'shared'` 判定（goal 侧已改请求级线程传递，manager `:1182` 注释明确对照），共享访客 prompt 后 owner 首条带文件引用消息可能被误拒——无关旧问题另行 feature（§8-8）。

---

## 八、已知设计债核实（维度⑦）

对 feature 历史记录的开放问题逐条核实（历史出处：feature_list.json goal 各 feature boundaries/Notes）：

| # | 问题 | 判定 | 评级 | 当前证据 |
|---|---|---|---|---|
| 1 | **同 session 并发** | **部分缓解，仍开放** | 🔴 高 | 守卫面已较完备（prompt/retry/steer/followUp 409，manager `:1221-1228/:1327-1347/:1476-1516`；动作 assertQuiescent runner `:834-847`），**但并发 `/goal` 双写窗口真实存在**（=X1：锁外检查 `runner:863-868`、commitGoal 无守卫、冲突检查跳过同 session `:347-348`）。时序推断，未动态复现 |
| 2 | **clear/compact 守卫** | **仍开放** | 🔴 高 | =X2：分发顺序 manager `:1209-1219` 先于 `:1223`；clearSession/compactSession 不触碰 goal（agent-compaction `:285-316/:194-206`）；与 rollback 守卫 `:1058-1065` 不对称 |
| 3 | **retry 生命周期** | **已缓解** | ✅ | continueSession 全活跃状态 409 GOAL_ACTIVE + 终态先清理（manager `:1338-1347`，测试 agent-goal-manager.test `:273-276` 锁定）；静态推演无可达绕预算路径。历史所指具体场景无原始评审文档可比对 |
| 4 | **验收证据一致性** | **部分缓解，仍开放** | 🟡 中 | 证据信任域/绑定校验已收窄（runner `:1218-1253`、state `:338-418`）；**残留 = E1**：criterion 非 passed 更新沿用旧 evidenceIds 且不校验（state `:394-409`），状态-证据单向一致 |
| 5 | **pendingDisposition 优先于 error** | **仍开放** | 🟡 中 | =D2：runner `:729-736` 分支先于 `:766` error 分支，error 计数被吞；与历史记录「只会落 needs_review 而非 completed」一致（注：complete 恒落 needs_review 本身是防自验收的有意设计，`:1324-1331`） |
| 6 | **非 extend_resume 无客户端 CAS** | **仍开放（既定边界）** | 🟡 中低 | routes `:242-244` + runner `:885-917`；前端 server-agent.ts `:1556-1560` 非 extend 不带 revision。历史明示不泛称原子防护 |
| 7 | **SSE epoch/消息对账** | **goal 特有已修复；广义仍开放** | 🟡 中 | goal 水位/双捕获/版本下界全部在位（server-agent.ts `:1636-1662/:2025-2039/:2316-2351/:2148-2156`）；跨连接 epoch/多端对账基础设施无对应机制，历史明确不扩范围 |
| 8 | **context-references 会话级残留** | **仍开放（无关旧问题）** | ⚪ 低 | context-references.mjs `:62` 会话级读取；goal 侧已改请求级（manager `:1182` 注释对照）。历史记入「另行 feature」 |

**本轮新发现**（历史未记录）：D1 死状态 `failed`（🟡 中）、D3 结算窗口中止语义（🟡 中）、B1 人审等待计费（🟡 中）、B3 双重 commit（🟡 中）、X4/X5/B2/B4/E2/E3/E4/A2/A3（⚪ 低/记录）。

---

## 九、改进建议分级

### P0（数据一致性/守卫对称，改动小、收益明确）

| 建议 | 修复 | 影响面 | 验证方式 |
|---|---|---|---|
| 并发 `/goal` 锁内 re-check | X1：`startGoalPlanning` 的 admission 锁内补「session.goal 无活跃 goal」二次检查（复用 confirm 的锁内 re-check 模式） | `server/agent-goal-runner.mjs`（约 5 行）+ 新增并发用例 | `tests/server/agent-goal-runner.test.mjs`（或 manager 层）并发双 /goal 只成功一次 |
| clear/compact 守卫 | X2：将 clear/summary/compact 分支移至 GOAL_ACTIVE 检查之后（活跃 goal 409，提示先 pause/cancel），或 clearSession 对活跃 goal 自动终态化 | `server/agent-manager.mjs:1209-1228`（顺序调整）或 `agent-compaction.mjs` + 测试 | 新用例：活跃 goal 下 /clear、/compact 与 /rollback 同口径 |

### P1（语义正确性，中等改动）

| 建议 | 修复 | 影响面 | 验证方式 |
|---|---|---|---|
| error 计数不被 disposition 吞 | D2：finishGoalRun 的 pendingDisposition 分支在 `info.status==='error'` 时仍累加 consecutiveFailures（或附 error 标记） | `agent-goal-runner.mjs:729-736` + 用例 | 报告后 error 收尾的 repeated_failures 触发用例 |
| 结算窗口中止语义 | D3：pendingDisposition 提交前检查 abort intent，用户中止时落 paused(user_aborted) 或标注 | `agent-goal-runner.mjs` + 用例 | 报告后、结算前 abort 的状态断言 |
| criterion 降级清理证据绑定 | E1：非 passed 更新未显式给 evidenceIds 时清空（或 UI 标注旧证据） | `agent-goal-state.mjs:394-409` + 用例 | 降级后 evidenceIds 清空/保留语义用例 |
| 超时×报告双 commit 合并 | B3：timeout 分支不 commit，留给 finishGoalRun 唯一结算 | `agent-goal-runner.mjs:504-514` + 用例 | revision 单跳断言 |
| 等待期预算暂停 | B1：awaiting_approval/awaiting_input 时暂停 watchdog、恢复时重设 | `agent-goal-runner.mjs` 审批/ask hook + beginGoalRun | 模拟长等待不耗尽预算的用例 |
| 注释修正 | A3：runner `:16-17` 「resume completes」→「accept completes」 | 注释一行 | 无（文档性） |

### P2（打磨/可选）

死状态 `failed` 处置（D1：接入或删除，含前端标签）；全动作可选 CAS（A1：API 契约扩展）；normalizeGoalState 交叉校验（X4）；workspace key 扫描对称（X5）；extend tranche 独立常量（B4，仅当需要解耦时）；UI 评审遗留的 P1/P2 项（K-01 聊天卡 Note 双显、C-01 tone token 全局化、G-16 外壳问题、G-10/T-E popover 文案语境——见 `goal-ui-review.zh-CN.md` 路线图，不在此重复）。

---

## 十、与 UI 评审报告的边界

本报告覆盖**设计/架构/契约层**；视觉、样式、信息密度、文案冗余见 `docs/reviews/goal-ui-review.zh-CN.md`（其 P0+G-09+C-02 已落地生产，goal-ui-p0-budget-120 feature）。两份报告共同的前端残留（K-01 聊天卡与侧栏 Note 双显、G-10 「上方的卡片」语境、C-01 tone 三处复制）已在 UI 评审路线图 P1/P2 登记，本报告不重复展开。

---

## 附录：证据文件清单

| 文件 | 核读范围 |
|---|---|
| `server/agent-goal-state.mjs` | 全文 610 行（亲读） |
| `server/agent-goal-runner.mjs` | :1-320、:440-624、:700-830、:852-1112、:1176-1329（亲读）+ 全文 failed 检索 |
| `server/routes/agent.mjs` | :210-247（亲读） |
| `server/agent-manager.mjs` | :913-918、:982-993、:1058-1065、:1200-1232、:1327-1347、:1476-1516、:1572-1577、:1726-1748、:622-628、:724-729、:1828-1830（调研+抽查亲读 :1200-1228） |
| `server/agent-compaction.mjs` | :194-206、:285-316（调研） |
| `server/agent-persistence.mjs` | :188、:193、:233-236、:300-314（调研） |
| `src/lib/goal.ts` | :95-105、:280-294（亲读，本会话前轮） |
| `src/lib/server-agent.ts` | :1536-1560、:1636-1662、:2025-2039、:2148-2156、:2316-2351（调研） |
| `feature_list.json` / `progress.md` | goal 各 feature boundaries/Notes（历史出处） |
| 交叉引用 | `docs/reviews/goal-ui-review.zh-CN.md`（UI 层，已落地） |

> 时序类结论（X1 并发窗口、D3 结算窗口、B3 双 commit）为代码路径推断，未做运行动态复现；建议修复时以并发用例先行验证。
