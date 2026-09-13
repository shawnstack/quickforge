# 置顶摘要「智能体 · 已结束」只显示 3 个：根因调研与修复方案

- 调研日期：本轮会话（基线：当前工作树；撰写期间并行会话完成 goal-report-tool-flat-style，改动 local-tools.ts/index.css 等，与本调研引用的 App.tsx/subagent-run-detail.ts/GitToolsPinnedSummary.tsx/相关测试无文件交集）
- 调研性质：纯只读调研 + 修复方案，不修改生产代码；方案采纳由用户决定
- 方法：两路 explore 只读调研（数据链路 + 设计意图/测试现状）交叉验证，父 Agent 亲读全部关键源码引用逐条核实
- 引用门槛：本文所有 `文件:行号` 引用均由父 Agent 在当前工作树逐条亲自读取核实

---

## 一、问题与结论速览

**现象**：会话中已结束的 subagent 有很多个（例如一个 goal 执行多轮、每轮委派多个 explore/general），置顶摘要「智能体」分组的「已结束」小节展开后只显示 3 条，且标题计数也是 3，与会话真实情况明显不符。

**一句话结论**：这不是数据丢失，而是**显示侧三层截断叠加 + 计数口径失真**——数据源（服务端会话消息、前端 `ServerAgent.state.messages`）对 subagent 终态结果**全量保留、零截断**；"只显示 3 个"是提取层默认值、提取层硬上限、UI 层二次截断三层叠加的结果，且标题「已结束 · N」与胶囊计数用的都是**截断后**的长度。用户判断"应该有很多个才对"成立。

| # | 截断层 | 位置 | 行为 |
|---|---|---|---|
| ① | App 调用层 | `src/App.tsx:562-568` | 调 `extractLatestTerminalSubagentRuns(...)` **未传第 5 参 `limit`** → 走默认值 3 |
| ② | 提取层默认值 | `src/lib/subagent-run-detail.ts:619` | `limit = 3`（函数签名默认参数） |
| ③ | 提取层硬上限 | `src/lib/subagent-run-detail.ts:654` | `boundedLimit = Math.min(5, Math.max(1, ...))`——**即使显式传更大也会被钳到 5** |
| ④ | UI 层二次截断 | `src/components/git/GitToolsPinnedSummary.tsx:221` | `visibleSubagentRuns = finishedSubagentRuns.slice(0, 3)`——**与展开/折叠无关**，展开后仍只渲染 3 条（`:864`） |
| ⑤ | 计数口径失真 | `GitToolsPinnedSummary.tsx:857`、`:227`、`:274-278` | 标题「已结束 · N」、胶囊 agents 段 `running/finished`、aria 全部使用**截断后**的 `finishedSubagentRuns.length`（≤3），真实总数被低估 |

**对照（旁证设计不对称）**：同组件的任务组没有此问题——`GitToolsPinnedSummary.tsx:219-220` `showAllTasks` 展开显示全部，`:811-815` 提供「查看全部 {count} 项任务 / 收起」入口（i18n `pinnedViewAllTasks`/`pinnedCollapseTasks`，`src/lib/i18n.ts:1258-1259`（en）/`:3054-3055`（zh））；智能体「运行中」小节也无限制（`extractRunningSubagentRuns` 返回全部 pending 中的调用，`:828` 全量渲染）。唯独「已结束」小节被三层截断。

---

## 二、根因链逐层证据（已亲读核实）

### 2.1 提取层：`extractLatestTerminalSubagentRuns`

`src/lib/subagent-run-detail.ts:614-663`：

- `:619` 签名默认 `limit = 3`；
- `:624-643` 扫描传入消息分支，收集 `role === 'toolResult' && toolName === 'run_subagent'` 的终态结果（排除 `pendingToolCalls` 中的），逐条调用 `buildSubagentRunPayload` 构建完整载荷；
- `:645-650` 按 timestamp（缺失回退消息索引）**最近优先**排序；
- `:653-661` `boundedLimit = Math.min(5, Math.max(1, ...))`，按 canonicalToolCallId 去重后**最多保留 5 条**。

即：无论会话里有多少个已结束 subagent，函数最多吐出 5 条；默认（不传 limit）只有 3 条。该行为被测试显式锁定：`tests/frontend/subagent-run-detail.test.ts:112-122`「clamps limit to 1..5」断言 `limit=99 → 长度 5`、`limit=0 → 长度 1`。

**唯一生产调用方**（已核验，全仓库 grep）：`src/App.tsx:562`。签名/limit 语义改动的影响面仅此一处 + 测试，影响面小。

### 2.2 App 层：未传 limit

`src/App.tsx:562-568`：

```ts
const pinnedSummarySubagentRuns = useMemo(() => extractLatestTerminalSubagentRuns(
  pinnedSummaryMessages,
  agentManager.agent?.state.pendingToolCalls,
  getCachedToolDisplaySettings().toolDisplayMode,
  t,
), [agentManager.agent, pinnedSummaryRevision])
```

未传 `limit` → 默认 3。`:538-555` 订阅 tool/message/goal 相关事件递增 `pinnedSummaryRevision` 触发重算——即**每个工具事件都会重新全量扫描并重建（最多 3 条）payload**。

### 2.3 UI 层：与展开态无关的二次截断

`src/components/git/GitToolsPinnedSummary.tsx`：

- `:221` `const visibleSubagentRuns = finishedSubagentRuns.slice(0, 3)`；
- `:849-889` 「已结束」小节：`:851-861` 标题行整行 button 切换折叠（`finishedSubagentRunsCollapsed`，默认收起），`:857` 显示 `{t('pinnedSubagentsFinishedSection')} · {finishedSubagentRuns.length}`；`:862-886` 展开时渲染 `visibleSubagentRuns`（仍 ≤3）；
- `:227` `agentFinishedCount = finishedSubagentRuns.length` → `:271-282` 胶囊 agents 段 `<span>{agentRunningCount}/{agentFinishedCount}</span>` 与 `pinnedSummaryCapsuleAgentsAria`（i18n.ts:1249/:3045）同样使用截断后长度。

由于上游本来就只给 3 条，当前 `slice(0, 3)` 是 no-op；但它是独立的第二道闸门，即使将来放开上游，UI 仍会截到 3。

### 2.4 计数为何"看起来就是 3"

标题、胶囊、aria 三处的 N 全部来自 `finishedSubagentRuns.length`——上游截断后的数组长度。会话有 8 个已结束 subagent 时显示「已结束 · 3」、胶囊 `0/3`，用户无从知道还有 5 个。

---

## 三、数据链路核验：数据源无任何截断

| 层 | 是否截断 | 证据 |
|---|---|---|
| 服务端 subagent 执行器 | ❌ 无 | `server/agent-subagent-runner.mjs:36-41`：`SUBAGENT_TRACE_MESSAGES_LIMIT=50` **只用于运行期 trace update 的 `details.messages`**（并附 `messagesTotal`），终态 toolResult 的 `details.messages` 保持**全量** |
| 服务端会话存储 | ❌ 无 | `server/agent-session-store.mjs` 无 slice/truncate/limit 类消息截断，全量持久化；`server/agent-session-events.mjs:88-141` split-message SSE 只发增量尾是传输优化，消息本体不丢 |
| 前端会话状态 | ❌ 无 | `src/lib/server-agent.ts:949-970` `state.messages` 全量；`:1040/:1046` 初始 snapshot 全量拷贝；`:901-908/:1986-2062` 增量尾经 `mergeIncrementalMessages` 合并，客户端保留全量历史 |
| 运行中 subagent 提取 | ❌ 无 | `src/lib/subagent-run-detail.ts:671-686` `extractRunningSubagentRuns` 返回全部 pending 中的 `run_subagent` 调用 |

**结论**：会话消息里每一个 `run_subagent` 的终态 toolResult 都完整存在；置顶摘要只要放开提取与 UI 两层截断即可显示全部。另注：`SubagentRunStore` 的 `MAX_SUBAGENT_RUN_SNAPSHOTS=100` 滚动淘汰（`subagent-run-detail.ts:98-116`）只影响 SSE 实时快照 store（运行指示器/Inspector），**不是**置顶摘要已结束列表的数据源（后者每次从当前消息分支重新提取，见 `docs/wiki/src/lib/README.md:215` 记载的既有契约）。

---

## 四、"3" 的来源考证：继承的实现边界，非产品决策

- **mockup 从未规定"只显示 3 个"**：`design-mockups/execution-summary-groups.html:764-768` 智能体组演示数据恰好 3 条，`:802-808` 展开后渲染**全部**演示行、无截断；`:746-747` 「默认 3 条 / 查看全部 / 收起至 3 项」的展开机制**只设计给了任务组**，智能体组没有对应设计。`design-mockups/pinned-summary-drag-capsule.html:713-736` 已结束子标题是折叠开关，`finishedRows` 含全部（2 条）演示行，展开即全显。
- **feature 演进把 3 固化为边界**：`feature_list.json:1720`（pinned-execution-summary-groups 原始引入）首次写入「按结束时间最近优先、canonical ID 去重并取 3 项」；`feature_list.json:1702` + `progress.md:1348`（pinned-summary-subagent-sections 双小节重做）boundary 明确「已结束小节**沿用现有最近 3 项**」——是被继承的实现边界，不是重新确认的产品决策。
- **wiki 记录的是现状而非承诺**：`docs/wiki/src/components/README.md:153`「已结束 · N ……按终态时间最近优先取 3 项」、`docs/wiki/src/lib/README.md:215`「限制最近 1–5 条」描述的是当前实现。
- **测试锁定的是 clamp 语义**：`tests/frontend/subagent-run-detail.test.ts:112-122` 断言 1..5 夹取，未断言默认值 3 本身；组件测试（`tests/frontend/git-tools-pinned-summary.test.ts`）对已结束列表**没有任何数量断言**（`:424-429` 只断言任务组 slice/展开与折叠状态机；`:473-487/:510-512` render 用例均传空 runs）——UI 层放开不会破坏现有测试。

---

## 五、候选方案

### 方案 A（推荐）：真实计数 + 展开显示全部（对齐任务组交互语义）

**行为定义**：
- 标题「已结束 · N」与胶囊 finished 计数显示**真实总数**（N = 当前消息分支去重后的终态 run 数）；
- 「已结束」小节折叠默认收起不变（既有 `finishedSubagentRunsCollapsed` 行为、关闭弹层恢复折叠均不动）；
- 展开后渲染**全部**已结束 runs（最近优先、canonical 去重排序不变），设**防御性上限**（建议 100，覆盖极端长会话）；
- 面板内长列表靠既有滚动承接（panel 内容体 `overflow-y-auto overscroll-contain` + 动态 max-height，见 6.2）。

**交互理由**：智能体小节已有一个「默认收起」的折叠开关，"展开 = 看全部"与任务组「查看全部」语义天然一致；折叠态本身就是列表预览的保护，**无需**再新增「查看全部 N 个」按钮和 i18n key（若产品后续想要，可按任务组同款补 `pinnedViewAllSubagents`/`pinnedCollapseSubagents`，属可选增强）。

**代价**：必须同步处理提取性能（见 6.1 的轻量化设计，这是方案 A 的必做配套，不是可选项）。

### 方案 B：仅提高上限（最小改动折中）

默认 `limit 3 → 10~20`，硬上限 `5 → 50`，同步更新 clamp 测试。计数 = 列表长度（上限内真实）。
- 优点：改动集中在 `subagent-run-detail.ts` 一处 + 一个测试用例，性能压力增幅有限；
- 缺点：仍是"最近 N 个"而非"全部"；subagent 超过上限的长会话（如 20 轮 × 多 subagent 的 goal）标题仍会低估，用户"应该有很多个"的观感问题只部分缓解。

### 方案 C：仅修计数口径（不动列表）

新增纯计数函数（只数不建 payload，O(messages) 极轻），标题/胶囊显示真实 N，列表保持最近 3 条。
- 优点：零性能风险、改动最小；
- 缺点：用户"看到很多个"的诉求未满足，标题 N 与列表 3 条并存反而可能显得更不一致。

### 对比

| 维度 | A 展开全部+真实计数 | B 提高上限 | C 仅修计数 |
|---|---|---|---|
| 满足"看到很多个" | ✅ 完全 | ⚠️ 上限内 | ❌ |
| 计数真实 | ✅ | ⚠️ ≤上限 | ✅ |
| 改动面 | 提取层+App+UI+测试+wiki | 提取层+测试+wiki | 新函数+UI 计数+测试+wiki |
| 性能风险 | 需轻量化配套 | 低 | 无 |
| 与任务组交互一致性 | ✅ | ⚠️ | ❌ |

---

## 六、推荐方案 A 实施设计

### 6.1 数据层 `src/lib/subagent-run-detail.ts`

1. **limit 语义**：`extractLatestTerminalSubagentRuns` 唯一生产调用方是 `App.tsx:562`（已核验），可安全调整：
   - `:654` `Math.min(5, …)` → `Math.min(100, …)`（防御上限）；
   - `App.tsx:562` 显式传大 limit（如 `100`）；默认值可保持 3 不动（避免隐式改变其他潜在语义）或同步改，实施时二选一并写进 feature 记录。
2. **性能配套（必做）**：`buildSubagentRunPayload`（`:721-745`）对每个 run 执行 `input: stringifyValue(params)`（`:737`）与 `details: stringifyValue(result?.details)`（`:738`），终态 `details.messages` 是**全量 trace**——单个 run 可能数十 KB 以上；且 `App.tsx:538-555` 每个 tool/message/goal 事件都递增 revision 触发重算。当前 limit=3 顺带封顶了该成本，放开后必须避免"每个工具事件 × 全部终态 run × 全量 trace 字符串化"。
   - **建议**：为提取路径提供轻量构建（置顶摘要行只消费 `name/label/task/status/timing.durationMs/canonicalToolCallId/runId`，`:829/:866` 渲染仅用这些），跳过 `traceMessages/tools/input/details/output` 的 stringify 与重指纹计算。
   - **关键兼容点——点击行打开详情**：`onOpenSubagentRun(payload)` 打开 Inspector 详情 Tab；canonical 载荷点击时 `resolveSubagentRunPayloadForOpen` 优先取 `subagentRunStore` 最新同 ID 快照，但 store 只保留最近 100 个、且**非 canonical 历史载荷的 fallback 直接使用 renderer 传入 payload**（见 `docs/wiki/src/lib/README.md:215` 契约）。轻量 payload 会使 fallback 路径的详情缺 trace/output。实施时二选一： 点击回调里按 `runId` 回消息分支重提取完整 payload 再打开； `onOpenSubagentRun` 事件链路保持完整 payload（轻量化只省略列表展示用不到的大字段，`details/output` 保留）。推荐，实现简单且不动 Inspector 链路。
3. **真实总数**：轻量化后全量提取的 `length` 即真实总数，直接供 `:857` 标题与 `:227` 胶囊使用，无需单独计数函数。

### 6.2 UI 层 `src/components/git/GitToolsPinnedSummary.tsx`

- `:221` `visibleSubagentRuns = finishedSubagentRuns.slice(0, 3)` → 直接 `= finishedSubagentRuns`（或删除该中间变量）；
- `:857` 标题计数、`:227` `agentFinishedCount`、`:271-282` 胶囊段随上游真实化，无需单独改；
- **面板高度契约无需新设计**：panel 内容主体已是 `overflow-y-auto overscroll-contain` + 动态 max-height（`docs/wiki/src/components/README.md:153` 记载），且高度测量 `useEffect` 依赖已含 `finishedSubagentRunsCollapsed`（`GitToolsPinnedSummary.tsx:629/:652`），展开列表变长时 ResizeObserver 会重新解析自然高度与 max-height，长列表在面板内滚动；
- 「运行中」小节零改动。

### 6.3 i18n

推荐形态**零新增 key**（展开全部由既有折叠开关承担）。可选增强：若要任务组同款「查看全部 {count} 个智能体」按钮，新增 `pinnedViewAllSubagents`/`pinnedCollapseSubagents`（en+zh，i18n.ts 两处块，参照 `:1258-1259/:3054-3055` 任务组同款）。

### 6.4 测试

- `tests/frontend/subagent-run-detail.test.ts:112-122`：clamp 断言按新语义更新（`99 → 100` 上限、默认值口径），并新增「返回全部终态（>5 条）」用例；
- `tests/frontend/git-tools-pinned-summary.test.ts`：新增「展开后渲染 >3 条已结束 run」「标题计数为真实总数」断言（现有无数量断言，安全）；`:41-42` 挂载条件（`length > 0`）不受影响；
- 若实施轻量化：`subagent-run-detail.test.ts` 补「轻量 payload 不含大字段、点击字段齐备」契约用例。

### 6.5 文档同步

- `docs/wiki/src/components/README.md:153`：「按终态时间最近优先取 3 项」→ 新行为（展开全部 + 防御上限 + 真实计数）；
- `docs/wiki/src/lib/README.md:215`：「限制最近 1–5 条」→ 新 limit 语义（若含轻量构建需补一句职责说明）；
- `feature_list.json`/`progress.md` 历史条目按项目惯例不改写。

---

## 七、影响面清单（方案 A 必改/必同步）

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/lib/subagent-run-detail.ts` | `:619`（默认 limit）、`:654`（clamp 1..5 → 1..100）、`:614-663`（可选轻量构建） | limit 语义放宽 + 轻量化配套 |
| `src/App.tsx` | `:562-568` | 显式传大 limit；（若轻量化）传轻量标志 |
| `src/components/git/GitToolsPinnedSummary.tsx` | `:221`（删 slice(0,3)） | 展开渲染全部；计数随上游自动真实化 |
| `src/lib/i18n.ts` | （仅可选增强）`en/zh` 两块 | 视图全部入口 key（推荐形态为零新增） |
| `tests/frontend/subagent-run-detail.test.ts` | `:112-122` 及新增用例 | clamp 断言更新 + >5 条/轻量契约 |
| `tests/frontend/git-tools-pinned-summary.test.ts` | 新增用例 | 展开全部 + 真实计数断言 |
| `docs/wiki/src/components/README.md` | `:153` | 「取 3 项」→ 新行为 |
| `docs/wiki/src/lib/README.md` | `:215` | 「1–5 条」→ 新语义 |
| `feature_list.json` / `progress.md` / `session-handoff.md` | — | 实施 feature 状态记录 |

---

## 八、验证建议（实施 feature 使用）

- 定向：`npx vitest run tests/frontend/subagent-run-detail.test.ts tests/frontend/git-tools-pinned-summary.test.ts`；
- `npx --no-install tsc -b --pretty false`；改动文件 ESLint；`node JSON.parse feature_list.json`；
- 手动冒烟：在一个已结束 subagent > 3 个的会话中确认——展开「已结束」显示全部、标题与胶囊计数为真实总数、点击任一行 Inspector 详情完整（trace/output 不缺）、长列表面板内滚动、Goal 存在时胶囊密度限制（`:291` slice(0,3)）不受影响（那是段数量限制，与本修复无关）。

---

## 九、风险与边界

- **性能是方案 A 的主要风险**：不轻量化则每个工具事件重算全量 payload（含全量 trace stringify），长 goal 会话有可感知的 GC/主线程压力；轻量化是必做配套而非优化项。
- **点击详情完整性**：见 6.1 第 2 点，非 canonical 历史 run 的 Inspector fallback 依赖 renderer payload，轻量化必须保留该路径所需字段（推荐 b 方案）。
- **防御上限取舍**：100 为建议值，实施时可与用户确认；超上限会话标题仍会封顶显示（可在标题注明，属实施细节）。
- **本报告纯调研**：未修改任何生产代码（`src/`、`server/`、`tests/` 零改动）；方案 B/C 与方案 A 的前两步（真实计数+放开截断）不冲突，可按用户决策组合。
