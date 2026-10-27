# run_workflow 脚本化多 Agent 与工具编排

> 状态：已实现。本文以 `server/agent-workflow-runner.mjs`、`server/agent-workflow-worker.mjs`、`server/agent-manager.mjs`、`server/agent-subagent-runner.mjs` 及前端消费方源码为准；schema、默认值或错误码变化时先改代码再改本文。

## 1. 背景与目标

`run_subagent` 解决的是**一次有边界的委派**：父 Agent 把一段任务交给一个 Agent Profile，等待它返回结果。但有些工作天然是多个独立委派或分阶段流水线，例如：

- fan-out 调研：同时让多个 `explore` 分别扫描不同目录、模块或测试面；
- 每个文件/模块一个 Agent：按文件清单并行实现或审查；
- 多阶段流水线：先扫描、再分派修复、最后统一验证；
- 需要对每一步产物做结构化校验（JSON Schema）后再继续。

如果让模型手工串行调用 N 次 `run_subagent`，编排逻辑会散落在对话轮次里，难以表达并发、阶段与失败隔离。`run_workflow` 的目标是让模型提交一段**短 JavaScript 编排脚本**，由 QuickForge 在受控环境中执行：

- 脚本只描述“怎么编排”，不直接读写文件、不访问网络、不创建定时器；
- 每个 `agent()` 调用仍复用 `run_subagent` 的完整生命周期（工具集、审批、预算、超时、workspace 归因）；
- `tool()` 让脚本在 Agent 步骤之间直接调用当前会话的工作区工具（读/搜/写/编辑/命令/文件展示/Skill/MCP/Plugin），与主 Agent 使用同一套工具定义、审批与 workspace 沙箱；
- 阶段、Agent 状态、日志与最终结果进入 toolResult `details`，前端工具卡可观察；
- Agent 数量、工具调用数、并发、总时长、脚本大小与结果大小都有硬上限。

### 1.1 run_workflow vs run_subagent

| 维度 | `run_subagent` | `run_workflow` |
|------|----------------|----------------|
| 适用场景 | 单个有边界的任务委派 | 多个独立委派或分阶段流水线 |
| 输入 | `task` / `context` / `expectedOutput`，一次一个 Profile | JavaScript 脚本 + 可选 `args` + 可选 `options` |
| Agent 数量 | 1 | 默认最多 24，硬上限 64（`maxAgents`） |
| 工具调用 | Agent 内部自行调用 | `tool()` 直接调用当前会话工具，默认最多 64，硬上限 128（`maxTools`） |
| 并发 | 不适用（单次调用） | 默认 4，硬上限 8（`concurrency`）；默认权限下实际串行 1（保证审批卡可见） |
| 运行时长 | Profile 默认/上限 2 小时 | 整条工作流默认 1 小时，硬上限 2 小时（`maxRuntimeMs`） |
| 结构化输出 | 无内建 schema 校验 | 每个 `agent()` 可选 JSON Schema，返回校验后的对象 |
| 失败语义 | 失败即该次委派失败 | 单个 agent/tool 失败解析为 `null`，脚本可继续；脚本异常/超时/中止才让工作流失败 |
| 审批 | 每个受保护工具按会话审批策略 | 默认权限下启动脚本前先审批一次；每个 Agent 与 `tool()` 的调用仍按原策略审批 |
| 递归 | 子 Agent 不能再调用 `run_subagent` | 子 Agent 不注入 `run_workflow`，不能递归编排 |
| REST | 无直接 REST 执行入口 | 无直接 REST 执行入口 |

选择建议：

- 只有一个明确、可独立完成的子任务：用 `run_subagent`，更简单；
- 需要 2 个以上独立委派、按文件/模块 fan-out、或存在先后阶段与结构化产物：用 `run_workflow`；
- 脚本里不应该“只包一层 `agent()` 再返回”，这层编排没有收益；直接 `run_subagent` 更清晰。

### 1.2 非目标

- 不是通用 JavaScript 运行时：没有文件系统、网络、定时器、`process`、`require`、`console`。
- 不是 OS 级安全沙箱：worker thread 与 vm context 用于**隔离和可终止**，不是不可信代码的强隔离边界。
- 不是持久化工作流引擎：没有跨会话恢复、断点续跑、定时重试或人工审核节点。
- Subagent 运行详情与直接 `run_subagent` 共用同一个 Inspector、同一套状态/错误推导与实时 store。运行中和结束后都从 `subagentRun.messages` 渲染工具卡；trace **不做任何体积预算裁剪**（与直接 `run_subagent` 一致，全量保留），唯一的结构性控制是运行中帧只携带仍处于 running/queued 的 Agent trace（上限为 `concurrency`），已结束 Agent 标 `subagentRunDeferred` 并由前端复用上一次可见快照，终态帧一次性带全部 Agent 的全量 trace。因此详情页不会出现“过程记录被裁剪”的提示。渲染帧若已终态而 store 仍是 running（例如 SSE 断连漏掉结束帧），渲染回填会安全修正 store。改动前的历史运行没有这份 trace。
- 不是 REST API：`POST /api/tools/run_workflow` 明确返回 404（见 §8）。

## 2. 架构

### 2.1 模块职责

| 文件 | 职责 |
|------|------|
| `server/tools/definitions.mjs` | `workflowTool` 的元数据与参数 Schema（`script` / `args` / `options`），`executionMode: 'sequential'` |
| `server/agent-manager.mjs` | `wrapWorkflowToolDefinition` 绑定会话并调用 runner；`beforeToolCall` 的审批分支；失败 details 的暂存与 `afterToolCall` 回填 |
| `server/agent-workflow-runner.mjs` | 主进程侧编排：校验、worker 生命周期、总 deadline、父 signal 传播、Agent/工具有界队列、超时/abort、details 构建、JSON Schema 校验 |
| `server/agent-workflow-worker.mjs` | worker 线程入口：vm context + guest bridge（hooks 在 guest 内创建、host 对象不进入脚本）、worker 协议、结果可序列化校验 |
| `server/agent-workflow-tools.mjs` | `tool()` 执行入口：复用 `createServerTools` 的工具定义/包装、按会话策略审批、workspace 归因，并排除递归/控制面工具 |
| `server/agent-subagent-runner.mjs` | `runWorkflowSubagent`：按 Profile 解析并复用 `executeSubagentRun` 的完整 subagent 生命周期 |
| `server/approval-store.mjs` | `run_workflow` 的命令权限限制（`/plan`、`allowSubagents:false`） |
| `server/routes/tools.mjs` | `directRouteDisabledTools` 禁止直接 REST 执行；`GET /api/tools` 仍返回元数据 |
| `src/lib/workflow-run-detail.ts` | 纯视图模型：details → 阶段/Agent/工具/日志/结果；另含 `workflowTimeline`（并行统计）与 `workflowPhaseSpan` |
| `src/lib/workflow-run-payload.ts` | 打开 Inspector 用的 payload 构建、`WorkflowRunStore`（50 条 FIFO）、`OPEN_WORKFLOW_RUN_EVENT` 与 `activeWorkflowRunStore`（卡片「已打开」广播） |
| `src/lib/workflow-subagent-detail.ts` | 由 workflow Agent record（含全量 `subagentRun`）构建 Inspector 复用的 `SubagentRunPayload` |
| `src/lib/workflow-agent-run-events.ts` | `run_workflow` 的 SSE 实时发布：把 `details.agents[]` 按 `${runId}:agent:${id}` 写入 `subagentRunStore`，`subagentRunDeferred` 帧复用上一份可见 trace |
| `src/components/workspace/WorkflowRunDetailContent.tsx` | Inspector 里的运行详情单页（概览 + 阶段头 + 步骤流 + 折叠日志 + 脚本/结果抽屉）；聊天卡自身不再展开 |
| `src/lib/tool-renderers/workflow-tool-renderer.tsx` | `run_workflow` 聊天卡：单行入口 `<button>`，点击打开 Inspector 运行详情 Tab |

### 2.2 执行链

```mermaid
flowchart TD
    M[模型调用 run_workflow] --> V{参数校验}
    V -- script 为空/超 20KB/args 不可克隆或过大 --> E0[WORKFLOW_INVALID 400 不启动]
    V -- 通过 --> P{默认权限?}
    P -- 是 --> A[审批: 完整脚本 + args + options]
    A -- 拒绝/超时 --> E1[不启动 worker]
    A -- 允许 --> W[创建 Worker: script + args]
    P -- 否 完全访问 --> W
    W --> C[vm context: agent/tool/parallel/pipeline/phase/log/args]
    C -- phase / log --> U[details 快照 200ms 节流 onUpdate]
    C -- agent 请求 --> Q[有界队列 maxAgents / concurrency]
    C -- tool 请求 --> QT[有界队列 maxTools / concurrency]
    Q --> S[runWorkflowSubagent 复用 subagent 生命周期]
    QT --> ST[runWorkflowTool 复用会话工具定义与审批]
    S -- 工具调用 --> T[会话既有工具审批/预算/沙箱]
    T --> S
    ST -- 工具调用 --> T2[会话既有工具审批/预算/沙箱]
    T2 --> ST
    S -- 结果/错误 --> C
    ST -- 结果/错误 --> C
    C -- return 结果 且 JSON ≤1MB --> D[status done + 终态 details]
    C -- 脚本异常/结果不可序列化 --> E2[WORKFLOW_FAILED + 部分 details]
    L[总 deadline / 父 signal abort] --> E3[WORKFLOW_TIMEOUT / WORKFLOW_ABORTED + 部分 details]
```

### 2.3 worker 协议

worker 与主进程只通过 `postMessage` 通信，消息形状如下。

worker → 父进程：

| 消息 | 字段 | 说明 |
|------|------|------|
| `agent` | `requestId`, `prompt`, `options` | 请求执行一步 Agent；`requestId` 单调递增 |
| `tool` | `requestId`, `name`, `args`, `options` | 请求执行一次工作区工具调用 |
| `phase` | `title`, `at` | 开始/切换命名阶段 |
| `log` | `message`, `phase`, `at` | 追加一条进度日志 |
| `done` | `result` | 脚本正常结束并返回结果 |
| `error` | `error` | 脚本语法错误、运行时异常、结果不可序列化/过大 |

父进程 → worker：

| 消息 | 字段 | 说明 |
|------|------|------|
| `agent-result` | `requestId`, `ok`, `hasValue?`, `value?`, `text?`, `content?`, `error?` | 回复 `agent()` / `tool()`；`hasValue:true` 时返回 schema 校验后的对象，否则返回文本；工具返回 `content`；`ok:false` 时脚本侧解析为 `null` |

关键点：

- 脚本以 `(async () => { ... })()` 包装后编译，因此可以 `await` 所有 hooks，并以 `return <JSON-serializable value>` 作为结果契约。
- guest 侧 hooks 全部由 bridge 在 vm 内创建；`args` 以 JSON 字符串进入、在 guest 内解析并深冻结；宿主函数不进入脚本作用域（`__hostCall` 为 null-prototype 且在用户脚本编译前删除），host 回复只以 JSON 字符串经 guest pump 投递。`console` 被显式置为 `undefined`，脚本必须用 `log()` 才能把进度送到工具卡。
- `codeGeneration: { strings: false, wasm: false }` 禁止 `eval`/`new Function`/WASM；测试覆盖 `agent.constructor`、`args.constructor` 等 host/guest 原型逃逸均为 `blocked`。
- 同步执行段有 10 秒 `timeout`；任何阶段卡死仍可由父进程 deadline 与 `worker.terminate()` 兜底。
- worker 设 `resourceLimits`（old generation 256MB / young 64MB），避免脚本或逃逸代码无界分配拖垮服务进程。
- 脚本结果先 `structuredClone` 再 `JSON.stringify`，两者任一失败或 JSON 超过 1MB 都按脚本错误处理。

### 2.4 agent()/tool() 代理与执行生命周期

`agent()` 不创建独立执行器，而是把请求代理回主进程，由 runner 的队列调度：

1. worker 生成 `requestId`，把 `{type:'agent', requestId, prompt, options}` 发给父进程，并挂起 Promise；
2. runner 的 `enqueueAgent()` 规范化请求、登记 agent record、检查 `maxAgents`，然后入队；
3. `drainQueue()` 在 `activeSteps < effectiveConcurrency` 时取出任务，Agent 调用 `runWorkflowSubagent()`、工具调用 `runWorkflowTool()`；`effectiveConcurrency` 在默认权限下固定为 1，完全访问下使用配置的 `concurrency`；
4. `runWorkflowSubagent()` 按 `profile`（默认 `general`）解析已启用 subagent 的 Agent Profile，再调用 `executeSubagentRun()`：创建子 session、解析模型/思考等级、构建工具集、执行 prompt，完整复用 `run_subagent` 的工具审批、预算、超时与错误 details 路径（trace 与部分成果回传关闭）；
5. 结果或错误回到 runner，runner 通过 `agent-result` 回传 worker，`agent()` 解析为文本、校验后的对象或 `null`。

`tool()` 走同一条队列：worker 把 `{type:'tool', requestId, name, args, options}` 发给父进程；runner 的 `enqueueTool()` 登记 Tool record、检查 `maxTools`，然后调用 `runWorkflowTool()`。后者在**首次调用时**懒构建当前会话工具集（`createServerTools`，结果在整个 workflow 生命周期内缓存复用），排除递归/控制面工具，按会话权限发起审批，再执行工具并把文本结果回传；工具失败记录到 `details.tools`，`tool()` 解析为 `null`。

**工具集的懒构建与缓存含义**：`createServerTools` 只在第一个 `tool()` 到达时执行一次，之后整条 workflow 复用同一个 Map。因此 workflow 运行期间新连上的 MCP server 不会出现在 `tool()` 里；构建失败会清空缓存的 Promise 以便下次重试。

每步的覆盖项：

| 参数 | 作用 |
|------|------|
| `profile` | Agent Profile 名（默认 `general`；`explore` 用于只读调研；也可是已启用的自定义 Profile） |
| `label` | 工具卡与 details 中的展示名；缺省为 `${profile} #<index>` |
| `phase` | 该 Agent 归属的阶段；缺省继承当前 `phase()` |
| `model` | 覆盖该步模型（仍需通过服务端模型引用校验） |
| `maxRuntimeMs` / `maxToolCalls` | 覆盖该步预算（clamp 到 1s–2h / 1–300） |

`runWorkflowSubagent` 使用 `trace: false`、`workReport: false`，因此工作流里的每一步不会像独立 `run_subagent` 那样把完整 trace/部分成果报告写入该工具结果；可观察性由 runner 的 details（阶段/状态/耗时/工具调用数/结果预览/错误）承担。

## 3. Hooks 契约

### 3.1 签名与返回值

| Hook | 签名 | 返回值 | 失败语义 |
|------|------|--------|----------|
| `agent` | `agent(prompt, options?) => Promise<string \| object \| null>` | 默认返回该 Agent 的最终文本；带 `schema` 时返回校验后的 JSON 值；失败返回 `null` | 只有**空/非字符串 prompt** 在 guest bridge 内抛 `TypeError`（脚本失败）。prompt 超长、未知 option key、option 类型或长度非法、`schema` 不可序列化/超 20,000 等参数错误都由 `hostCall` 捕获后以 `ok:false` 回投，`agent()` 解析为 `null`。运行失败（含 schema 不匹配、预算耗尽、被中止）同样返回 `null`，不 throw |
| `tool` | `tool(name, args?, options?) => Promise<string \| null>` | 返回该工具结果的文本内容；失败返回 `null` | 只有**空 tool name** 与 **`args` 非 plain object** 在 guest bridge 内抛 `TypeError`。未知/不可用/被排除的工具、未知 tool option、`run_command run_in_background`、命令权限限制、审批拒绝或工具异常都以 `ok:false` 回投，`tool()` 返回 `null`（错误记录在 details.tools，不中断脚本）；预算耗尽同样返回 `null` |
| `parallel` | `parallel(thunks) => Promise<Array<...>>` | 按输入顺序返回每个 thunk 的结果 | 非函数项直接为 `null`；thunk throw 时为 `null`；不会因单项失败整体 reject |
| `pipeline` | `pipeline(items, ...stages) => Promise<Array<...>>` | 每个 item 独立经过所有 stage，按输入顺序返回最终值 | stage 必须是函数；某个 stage throw 会把该 item 置为 `null` 并跳过它剩余的 stage，其他 item 不受影响；无 stage 时返回 `items.slice()` |
| `phase` | `phase(title) => string` | 规范化后的阶段标题 | 非字符串/空白直接抛 `TypeError`；**超过 120 字符非抛错**：`phase` 是 notify 类型消息（无 `requestId`），父进程的 `normalizePhaseTitle` 校验失败后因 `id` 为空而静默丢弃，脚本内 `currentPhase` 已更新但该阶段不会出现在 `details.phases`（后续 `log()` 会被归到上一个阶段） |
| `log` | `log(message) => void` | 无 | 非字符串按 `Error.message` / `JSON.stringify` 归一；空文本忽略；单条最多 2000 字符（超出截断，不报错） |
| `args` | `args`（只读值） | 调用方传入的 JSON 值，深冻结 | 无法 `structuredClone` 时在启动前 400 |

`pipeline` 的 stage 签名为 `(previousValue, item, index)`；`parallel` 的 thunk 无参数。两者都是**逻辑并发**，实际同时运行的 Agent/工具步骤数仍由 runner 的 `concurrency` 限制。`parallel` 最多 256 个 thunk，`pipeline` 最多 256 个 item（超限抛 `TypeError`）。

### 3.2 agent() options

| 字段 | 类型/边界 | 说明 |
|------|-----------|------|
| `label` | string，≤80 | 展示名 |
| `phase` | string，≤120 | 归属阶段 |
| `profile` | string，≤40 | Agent Profile，默认 `general` |
| `context` | string，≤100,000 | 传给子 Agent 的上下文 |
| `expectedOutput` | string，≤10,000 | 输出要求 |
| `schema` | JSON Schema 对象或布尔，序列化后 ≤20,000 | 校验最终文本；成功时返回对象而非文本 |
| `maxRuntimeMs` | number，clamp 1,000–7,200,000 | 该步超时 |
| `maxToolCalls` | number，clamp 1–300 | 该步工具调用预算 |
| `model` | 模型引用 | 覆盖该步模型 |

未知 option key 会抛 `TypeError`；`schema: null` 等价于不传。`agent` prompt 必须为非空字符串且 ≤100,000 字符。

`tool()` 的 `options` 只接受 `label`（展示名）与 `phase`（阶段）。可用工具是当前会话工具集的子集：排除 `run_subagent`、`run_workflow`、`ask_user`、`todo_write`、`manage_global_memory`、`goal_report`；其余工作区工具、Skill、MCP/Plugin 工具均可调用。`run_command` 的 `run_in_background: true` 在工作流内被拒绝（前台命令可用）。

### 3.3 JSON Schema 校验

当传入 `schema` 时，runner 对 Agent 的最终文本依次尝试：

1. 原文；
2. 围栏代码块（```` ```json ```` 或 ```` ``` ````）；
3. 第一个 `{` 到最后一个 `}` 的子串；
4. 第一个 `[` 到最后一个 `]` 的子串。

找到可解析 JSON 后，用 TypeBox `Value.Check` 校验：

- 成功：`agent()` 返回解析后的对象，record 标记 `schemaValidated: true`，`resultPreview` 存规范化后的 JSON；
- 失败：`agent()` 返回 `null`，record 状态为 `error`，错误文本说明“不是 JSON”或“未匹配 schema（含首个错误路径）”，脚本可自行决定是否继续。

**当前实现的边界**：`schema` **只在 runner 侧做事后校验，不会下发给子 Agent**。`agent-workflow-runner.mjs` 调用 `runAgent()` 时传的是 `prompt/profile/label/context/expectedOutput/workflowLabel/maxRuntimeMs/maxToolCalls/model`，不含 `schema`；`runWorkflowSubagent()` 里虽然有 `schemaHint` 分支（把 JSON Schema 拼进 `expectedOutput`），但只有在 `params.schema` 存在时才生效，而该字段不会从 workflow 路径传入。因此工作流里的 `schema` 是**纯后置断言**：模型看不到契约，只能靠 `prompt` / `expectedOutput` 自行描述输出格式；写成散文时更容易解析失败并返回 `null`。若需要前置约束，应在脚本里把 schema 也写进 `expectedOutput`（或等后续把 `schema` 透传给 subagent）。

## 4. 限制与预算

| 项 | 默认 | 硬上限/下限 | 超限行为 |
|----|------|-------------|----------|
| `maxAgents` | 24 | 1–64 | clamp 到范围内；达到上限后新的 `agent()` 返回 `null` 并记一条 error 日志，不中断脚本 |
| `maxTools` | 64 | 1–128 | clamp 到范围内；达到上限后新的 `tool()` 返回 `null` 并记一条 error 日志，不中断脚本 |
| `concurrency` | 4（默认权限下实际 1） | 1–8 | clamp；Agent 与工具共用一个步骤队列；默认权限下强制 1 以保证审批卡不互相覆盖（前端只有单个 pending approval 槽位） |
| `maxRuntimeMs` | 1 小时 | 1,000–7,200,000（2 小时） | clamp；到点按超时失败 |
| `script` | — | 20,000 字符 | 启动前 400 `WORKFLOW_INVALID` |
| `args` | — | 20,000 字符 JSON | 启动前 400 `WORKFLOW_INVALID` |
| 工作流结果 | — | 1,000,000 字符 JSON | 脚本错误，工作流失败 |
| 工具结果中的结果正文 | — | 不截断 | 脚本返回什么，模型就收到什么（受上一行 1 MB JSON 上限约束）；超长结果交给上下文压缩处理 |
| 单 Agent 结果预览 | — | 不截断 | 与脚本实际收到的文本一致，无 `resultTruncated` |
| 单 Agent `subagentRun` | — | 不裁剪 | 与直接 `run_subagent` 完全一致：messages 与 tools 全量透传，单条内容也不截断。运行中帧只携带 running/queued 的 Agent trace（上限为 `concurrency`），已结束 Agent 打 `subagentRunDeferred`，由前端复用上一次可见快照；终态帧一次性带全部 Agent 的全量 trace |
| 单工具参数 | — | 不截断 | 始终以结构化 `args` 传给前端，不再有 `argsPreview` 分支 |
| 单工具结果预览 | — | 不截断 | 与 `tool()` 返回给脚本的文本一致 |
| 工作流结果预览 | — | 不截断 | `resultPreview` 就是完整结果 JSON，不再有 `resultTruncated` |
| 进度日志条数 | — | 200 | 丢弃最旧条目 |
| details 文本总量 | — | 不裁剪 | 与主 Agent 一致：details 不再有总量预算，`trimDetails` / `trimSubagentTraces` / `detailsTruncated` 已整体移除；日志条数上限 200 条仍保留（丢弃最旧条目），日志文本不再按字符预算截断 |
| 单条错误文本 | — | 2,000 字符 | 截断 |
| 单 Agent prompt | — | 100,000 字符 | `TypeError`，通常脚本失败 |
| 单 Agent `context` | — | 100,000 字符 | `TypeError` |
| 单 Agent `expectedOutput` | — | 10,000 字符 | `TypeError` |
| `parallel` 项数 | — | 256 | `TypeError` |
| `pipeline` item 数 | — | 256 | `TypeError` |
| 同步脚本执行 | — | 10 秒 | vm timeout，脚本错误 |
| bridge 初始化 | — | 5 秒 | 沙箱初始化失败 → `WORKFLOW_FAILED` |
| 进度节流 | 200ms | — | trailing 合并，终态强制 flush |
| 审批卡脚本 | — | 20,000 字符（完整脚本） | 不再截断；审批展示的就是将执行的代码 |

`options` 必须是普通对象；非对象、`script` 为空/超 20KB、args 无法 `structuredClone` 或 JSON 超 20KB 都会在 worker 启动前以 HTTP 400 / `WORKFLOW_INVALID` 拒绝。数字型 options 非法时回退默认值，超出范围时 clamp，而不是报错。

**`concurrency` 是生效值而非配置值**：`effectiveConcurrency = hasFullAccess(parentSession) ? options.concurrency : 1`（`agent-workflow-runner.mjs`）。默认权限下无论传入多少都按 1 串行执行，且 `details.concurrency` 上报的是这个**生效值 1**——从 UI 上看不出「配了 4 但被降级」。完全访问模式下才使用 `options.concurrency`（默认 4）。

**`maxAgents` / `maxTools` 与队列的关系**：达到上限后新的 `agent()` / `tool()` 直接返回 `null` 且**不登记 record**（`details.agentCount` 不增长），只追加一条 error 日志；排队等待的是并发配额（`activeSteps < effectiveConcurrency`），与预算上限是两件事。

## 5. 失败、中止、超时与孤儿步骤

### 5.1 错误码

| 场景 | `status` | `errorCode` | details 标志 |
|------|----------|-------------|--------------|
| 启动前参数校验失败 | 未运行 | `WORKFLOW_INVALID`（HTTP 400） | 无 details |
| 脚本语法错误、运行时异常、结果不可序列化/超 1MB | `error` | `WORKFLOW_FAILED` | 部分 phases/agents/logs |
| worker 启动失败、`error` 事件、意外退出 | `error` | `WORKFLOW_FAILED` | 部分 details |
| 超过 `maxRuntimeMs` | `error` | `WORKFLOW_TIMEOUT` | `timedOut: true` |
| 父运行 signal 中止（含启动时已中止） | `aborted` | `WORKFLOW_ABORTED` | `aborted: true` |

失败时 `runWorkflow` reject，Error 上携带 `quickforgeWorkflowDetails`。`wrapWorkflowToolDefinition` 会把它暂存到 `toolCallId`，再由 `afterToolCall` 注入错误 toolResult 的 `details`，因此刷新/恢复后仍能看到失败前的阶段、Agent 与日志。

### 5.2 中止与超时的传播

- runner 内部有一个 `AbortController`；每个 Agent/工具步骤的 signal 是 `AbortSignal.any([controller.signal, parentSignal])`。
- 超时或父中止时：置状态 → `controller.abort()` → 把仍在队列中的 Agent/工具标为 `aborted`（错误文本 `Workflow stopped before this agent started.` / `Workflow stopped before this tool call started.`）→ 把仍在运行的步骤标为 `aborted`（错误文本 `Workflow stopped while this step was running.`）→ 清定时器 → 终止 worker → 最后一次 `onUpdate` → reject。
- 「仍在运行」的标记是**同步**做的（`markRunningStepsStopped`），因为 `controller.abort()` 之后在途步骤是异步 settle 的；若等它们收尾，终态帧与持久化 details 就会永久留下 `running`。
- 正在运行的 Agent 通过组合 signal 收到中止；runner 不等待它们逐个收尾。工具调用返回后也不会再回传 worker（`settled` 后 `sendAgentResult` 直接 return）。
- 父 signal 在启动前已中止时，直接返回 rejected completion，不创建 worker。

### 5.3 单个 Agent / 工具失败

- `runWorkflowSubagent` 抛错 → runner 捕获 → record 状态为 `error`（若因中止/超时则 `aborted`）→ `agent()` 解析为 `null` → 追加一条 error 日志。
- `runWorkflowTool` 抛错（未知工具、审批拒绝、参数/命令限制、handler 异常）→ record 状态为 `error`/`aborted` → `tool()` 解析为 `null` → 追加一条 error 日志。
- 工作流不会因为某个 Agent 或工具失败而自动失败；最终 `status` 仍可为 `done`，`failedAgentCount` / `failedToolCount` 分别记录失败数，结果文本会列出未成功的步骤。是否把 `null` 视为致命由脚本决定。

### 5.4 孤儿步骤

脚本 `return` 后，未 `await` 的 `agent()` / `tool()` 调用可能仍在运行。`completeWorkflow` 会立即：

1. 中止内部 controller，让在途 Agent 收到 abort；
2. 把队列中和运行中的步骤标为 `aborted`（运行中的错误文本为 `Workflow completed before this step settled.`，队列中的为 `Workflow stopped before this agent started.` / `...before this tool call started.`）；
3. 终止 worker，后续 `agent-result` 不再投递。

因此孤儿步骤不会继续占用会话资源；终态快照不等待它们收尾，但 `details.agents` / `details.tools` 中会显示 `aborted` 而不是永远 `running`。脚本应 `await` 自己需要的所有 Agent/工具。

## 6. 安全模型

- **一次审批，不是永久授权**：默认权限下，`beforeToolCall` 在 worker 启动前对 `run_workflow` 发起一次审批，展示**完整脚本**（≤20KB）、`args` 与 `options`；拒绝或 5 分钟审批超时都不会启动 worker。审批卡的风险说明明确写出“以服务进程权限运行本地 JavaScript”。完全访问模式下跳过这次审批。
- **每个 Agent / 工具的调用仍按原策略审批**：`run_workflow` 的审批只授权“启动编排脚本”，不授权脚本里每个 Agent 的写文件、命令、MCP/Plugin 等操作，也不授权 `tool()` 的写入/命令/MCP 调用；这些操作继续走会话的工具审批（`tool()` 的审批 source 为 `workflow-tool`，UI 显示 Workflow 徽标与对应风险说明）。
- **worker 隔离 ≠ 安全沙箱**：脚本运行在服务器进程内的 worker thread + 独立 vm context 中。guest bridge 不向脚本传递 host 对象（args 以 JSON 字符串进入并在 guest 内解析；host function 为 null-prototype 且在脚本编译前删除；host 回复只以 JSON 字符串回到 guest），测试覆盖常见 `constructor` 原型逃逸；但 worker 仍与服务器同进程，不能当作不可信代码的强隔离。审批提示（默认权限）或完全访问模式才是显式信任边界。
- **脚本自身无直接 IO**：脚本没有 `process`、`require`、`fetch`、`setTimeout`、`console`；文件、网络、命令等副作用只能通过 Agent 或 `tool()` 完成，因此仍受 workspace 沙箱、敏感路径保护与工具审批约束。worker 设 `resourceLimits`，失控分配被限制在 worker 内。
- **结果校验**：每个 Agent 可选 JSON Schema；工作流最终结果必须是可 JSON 序列化且 ≤1MB 的值。
- **不能递归**：Subagent/Profile 会话创建工具时显式 `includeWorkflowTool: false`，`run_workflow` 不会被注入，避免工作流里再嵌套工作流。

## 7. details / UI payload 契约

### 7.1 工作流 details

runner 在运行中与终态发送同一个形状（字段按可用性出现）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `workflow` | `true` | 前端识别工作流 details 的唯一标记 |
| `runId` | string | 优先取 toolCallId，否则 `workflow-<uuid>` |
| `status` | `running` \| `done` \| `error` \| `aborted` | 运行状态 |
| `startedAt` / `durationMs` | number | 起始时间与累计耗时 |
| `maxAgents` / `maxTools` / `concurrency` / `maxRuntimeMs` | number | 本次生效的预算 |
| `agentCount` | number | 已登记的 Agent record 数（达到预算被跳过的调用不登记） |
| `failedAgentCount` | number | `error` + `aborted` 的 Agent 数 |
| `toolCount` | number | 已登记的 tool record 数（达到预算被跳过的调用不登记） |
| `failedToolCount` | number | `error` + `aborted` 的工具调用数 |
| `phases` | `{title, startedAt}[]` | 首次出现顺序；同名阶段只记一次 |
| `agents` | Agent record[] | 见下表 |
| `tools` | Tool record[] | 见下表 |
| `logs` | `{at, phase, message, level}[]` | 最多 200 条；`level` 为 `info` 或 `error` |
| `resultPreview` | string | 完整工作流结果 JSON，不截断 |
| `error` | string | 失败/中止/超时原因 |
| `timedOut` | `true` | 超时时出现 |
| `aborted` | `true` | 中止时出现 |

Agent record：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | `agent-<index>` |
| `seq` | number | 提交顺序，前端据此把 Agent 与工具交错展示 |
| `label` / `profile` / `phase` | string | 展示名、Profile、阶段 |
| `status` | `queued` \| `running` \| `done` \| `error` \| `aborted` | 单步状态 |
| `startedAt` / `durationMs` | number | 起始时间与耗时 |
| `toolCalls` | number | 该步已执行的工具调用数 |
| `schemaValidated` | `true` | 仅 schema 校验通过时出现 |
| `promptPreview` | string | `agent()` 的 prompt 全文，不截断 |
| `context` / `expectedOutput` | string | `agent()` 的上下文与输出要求，完整不截断；Inspector 任务说明与直接 `run_subagent` 同构 |
| `resultPreview` | string | 最终文本或规范化 JSON，完整不截断 |
| `error` | string | 失败原因，最多 2,000 字符 |
| `subagentRun` | object | Inspector 用的 subagent trace，全量不裁剪：`subagent`、`label`、`sessionId`、`parentSessionId`、`toolCalls`、`allowedTools`、`model`、`thinkingLevel`、`source`、`lifecycle`、`profilePath`、`capabilityPolicy`、`durationMs`、`pendingToolCalls`、`messages`、`tools` 原样透传（与直接 `run_subagent` 一致） |
| `subagentRunDeferred` | `true` | 运行中帧省略了该 Agent 的 trace（该帧只携带 running/queued 的 Agent trace，数量上限为 `concurrency`）；前端复用上一次可见快照，不视为内容丢失；终态帧恢复全量 |

Tool record：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` / `seq` | string / number | `tool-<index>` 与提交顺序；前端按 `seq` 把 Agent 与工具交错展示 |
| `name` / `label` / `phase` | string | 工具名、展示名、阶段 |
| `status` | `queued` \| `running` \| `done` \| `error` \| `aborted` | 单次工具调用状态 |
| `startedAt` / `durationMs` | number | 起始时间与耗时 |
| `args` | object | 参数原样保留，供前端按工具类型生成摘要 |
| `resultPreview` | string | 工具文本结果，完整不截断 |
| `error` | string | 失败原因，最多 2,000 字符 |

### 7.2 前端视图映射

`src/lib/workflow-run-detail.ts` 的 `buildWorkflowRunView(result, isStreaming)`：

- 仅当 `details.workflow === true` 时返回视图，否则返回 `null`；
- Agent/Tool 状态未知时归一为 `queued`；空日志消息丢弃；
- 阶段顺序：先按 `details.phases`，再补 Agent/工具/日志中出现但 phases 未列出的阶段；
- 运行状态优先级：`aborted` / `status === 'aborted'` → `aborted`（先于 `result.isError`，避免用户停止被显示成失败）；`timedOut` / `details.status === 'error'` / `result.isError` → `error`；`done` → `done`；`running` → `running`；缺失时按 streaming / 是否有 result 推导；
- 汇总字段：`agentCount`、`completedAgentCount`（done）、`failedAgentCount`（error/aborted）、`runningAgentCount`（running/queued）、`toolCount`、`failedToolCount`、`timedOut`、`aborted`；
- 阶段内按 `seq` 交错 Agent 与工具，并可用 `workflowPhaseSteps(phase)` 把连续的工具调用折叠成一个 `tools` 步骤（详情页「阶段 → Agent → 工具区」三级层级来源）；
- 辅助函数：`workflowStatusLabelKey`、`workflowCountParts`（Agent/工具计数片段，计数为 0 的片段整段省略）、`workflowSummaryText`（状态标签 + 计数片段，摘要卡与 Inspector 概览条共用）、`workflowAgentStatusKey`、`workflowActiveStepLabels`（Agent + 工具 running/queued label，按 `seq`；当前仅供视图模型测试消费）、`workflowCurrentPhase`（最后一个仍有 running 步骤的阶段，否则最后一个阶段）、`formatWorkflowDuration`；
- `workflowTimeline(view)`：把每个 Agent / 工具调用摊平成 `WorkflowTimelineEntry`（`startOffsetMs`、`durationMs`、`parallel`、`parallelGroupStart`、`parallelGroupSize`），并返回 `totalMs`（恒 ≥ 1）、`peakConcurrency`（扫描线算法）、`savedMs`（并行收益）。重叠段用并查集聚类，`parallelGroupStart` 只标组内 `seq` 最小的一条。缺 `startedAt` 的旧帧按 `seq` 顺延到「已有最大终点」，保持串行语义而不伪造并行。**详情页不再画时间轴**，只消费 `peakConcurrency` / `savedMs` 两个统计量；
- `workflowPhaseSpan(phase, timeline)`：阶段在时间轴上的事实跨度；无时间轴后保留给需要跨度的消费方与测试。

### 7.3 聊天卡与运行详情

`workflow-tool-renderer.tsx` 注册在 `local-tools.ts` 的 `registerToolRenderer('run_workflow', ...)`。**聊天区只有一行入口 `<button class="quickforge-workflow-card">`，没有展开体**：

- 摘要行 = 工具图标 + `workflowSummaryText`（状态标签 + 计数片段；**没有 `agent()` / `tool()` 时对应片段整段省略，两者都为 0 时只留状态**）+ 跑马灯 + 状态图标/耗时。跑马灯只在 `status === 'running'` 时渲染，内容是**最后一个阶段标题**（不是活跃步骤 label）：`marqueeText = view.phases.at(-1)?.title ?? ''`，renderToolMarquee 包 `.quickforge-workflow-marquee`，固定单行定高、溢出横向滚动、`prefers-reduced-motion` 退化为省略号；
- 运行态视觉：标题加 `.quickforge-tool-running-sweep`（与思考过程同一套 shimmer），此时右侧状态区隐藏。**没有「查看详情」文案、没有阶段刻度条**：整行即入口，动作提示只写在 `aria-label`（`workflowDetailOpenRun` / `workflowDetailOpened`）；
- 点击：先用 `buildWorkflowRunPayload` 回填 `workflowRunStore`（`shouldPublishWorkflowRunPayload` 拒绝终态回退），再派发 `OPEN_WORKFLOW_RUN_EVENT`；`App.tsx` 监听后 `requestWorkspaceInspector({ kind: 'workflow' })` 打开右侧 Tab。`activeWorkflowRunStore` 记录当前打开的 `runId`，卡片据此显示「已打开」（`data-open`）；
- 卡片重渲染时也会回填 store（`useEffect`），因此历史会话首帧或 SSE 漏帧仍能打开完整详情；
- 无视图时（尚无 result）显示 `workflowPreparing`；已有终态 result 但没有 workflow details（审批被拒、参数校验失败、缺 workspace/model）显示失败/完成状态 + `resultText` 错误正文，避免把失败永久显示成"正在准备"。

明细全部在 Inspector 的 `WorkflowRunDetailContent.tsx`（详见 `docs/wiki/src/components/README.md` 同名小节）：概览（状态点 + 总耗时 + 规模 + `peakConcurrency`/`savedMs` 统计 + 失败定位）+ 吸顶阶段头 + `workflowPhaseSteps` 交错的轻量 Agent 行与 `ToolMessage` 工具行 + 折叠日志 + 底部脚本/结果抽屉。Agent 行只做入口（图标 + 任务名 + profile + 状态 + 外链），点击经 `subagentRunStore` + `OPEN_SUBAGENT_RUN_EVENT` 打开原子 Agent 详情，queued 禁用；工具行直接复用聊天区 `ToolMessage`（`args` 合成 toolCall、`resultPreview || error` 合成 toolResult、`startedAt/durationMs` 写成 `quickforgeTiming`）。

**实时可达性**：`ServerAgent` 的 `tool_execution_start/update/end` 路径调用 `workflow-agent-run-events.ts` 的 `WorkflowAgentRunEventPublisher`，把 `details.agents[]` 按 `${workflowRunId}:agent:${agent.id}` 写进 `subagentRunStore`（保留 120 份上一载荷用于回填）。因此 Inspector 已打开的 Tab 持续刷新，**不依赖聊天卡片是否渲染 / 是否被窗口化卸载**；点击时优先取 store 最新快照，store 无快照（历史恢复/首帧）才用当前渲染帧回填。Composer 的「运行中 subagent」指示器在 `run_workflow` 仍 pending 时按同一前缀列出这些嵌套快照。

i18n 键（中英成对，位于 `src/lib/i18n.ts`）：`runWorkflow`、`workflowPreparing`、`workflowRunning`、`workflowCompleted`、`workflowFailed`、`workflowAborted`、`workflowAgentCountOne`、`workflowAgentCountMany`、`workflowToolCountOne`、`workflowToolCountMany`、`workflowToolParams`、`workflowToolResult`、`workflowCurrentPhase`、`workflowNoAgents`、`workflowStepCount`、`workflowError`、`workflowAgentDone`、`workflowAgentToolCalls`、`workflowAgentSchema`、`workflowAgentTask`、`workflowResult`、`workflowScript`、`workflowBadge`、`workflowRunDetails`、`workflowTabTitle`、`workflowTabTitleNoPhases`、`workflowSummaryRunning/Done/Failed/Aborted`、`toolApprovalRiskWorkflow`。详情面板的 `workflowDetail*` 系列：`StepCount`、`PhaseTotal`、`ParallelCount`（并行×N）、`PeakConcurrency`、`Saved`、`BudgetLine`（预算行，随脚本 sheet 头部）、`NoPhases`、`RunLogs`、`LocateFailure` / `Locate`、`FailedStepsOne/Many`、`Pending`、`OpenRun`、`Opened`。**已无消费方的残留键**（时间轴时代遗留，保留待清理）：`TimelineLegend*`、`TimelineHint`、`Now`/`NowTitle`、`LogsExpand`/`LogsCollapse`、`CopyTrace`——只有 `src/lib/i18n.ts` 自身定义，仓库内没有引用点。审批卡按 `run_workflow` 映射 `runWorkflow` 标签；`source.type === 'workflow'` 用本地化徽标与风险说明，workflow 内子 Agent 的审批在 `subagent` 徽标后追加 `workflowBadge`。

样式分两处：`src/styles/chat/goal-workflow.css` 只留聊天卡（`-card` / `-preparing` / `-title` / `-marquee*` / `-error*`，共 14 个类，已无 `-phase*` / `-tool-zone` / `-result-section` / `-script` / `-ticks`）；`src/styles/workspace/workflow-detail.css` 承担 Inspector 单页（`quickforge-workflow-detail-*`，含 overview / pill / phases / phase-head / phase-dot / step / agent / tool-line / logs* / failure / error-jump / sheet / script-sheet / result-sheet / foot）。渲染器 class 链是 CSS/DOM 装饰的契约，改名需同步样式与测试。

## 8. 路由与工具暴露

- `run_workflow` 属于 `workspaceTools`，因此 `GET /api/tools` 会返回其元数据供工具列表消费；工具卡图标与标签仍由本地渲染器和 i18n 固定提供。
- 它没有 `server/tools/index.mjs` handler；执行入口由 `agent-manager.mjs` 的 `wrapWorkflowToolDefinition` 绑定会话。
- `server/routes/tools.mjs` 的 `directRouteDisabledTools` 包含 `run_workflow`，所以 `POST /api/tools/run_workflow`（含项目级变体）返回 404 `Unknown tool`，不能绕过 Agent 会话直接执行。
- 命令/Goal 限制：
  - `/plan` 白名单不包含 `run_workflow`，返回 `Command /plan is read-only and cannot use run_workflow.`；
  - Goal planning 白名单同样不包含，返回 `Goal planning is read-only and cannot use run_workflow.`；
  - 命令显式 `allowSubagents: false` 时返回 `Command /<name> does not allow running workflows.`；
  - 报告 `complete` 后的结算窗口只允许 `read_file`/`grep_files`（验证阻塞时另允许必要 `ask_user`），`run_workflow` 被拒绝；
  - Subagent/Profile 会话通过 `includeWorkflowTool: false` 不注入该工具。

## 9. 测试与验证清单

| 测试 | 覆盖 |
|------|------|
| `tests/server/agent-workflow-runner.test.mjs` | 阶段/日志/命名 Agent、`tool()` 成功/失败/预算与 Agent+工具交错、并发上限与 `parallel` 顺序、默认权限串行、`pipeline` 单项失败隔离、单 Agent/工具失败 → `null`、JSON Schema 成功/失败与 `schema:false`、hooks 白名单、Node globals 缺失、host/guest `constructor` 逃逸阻断、`maxAgents`/`maxTools` 耗尽、脚本语法错误、不可序列化结果、超时/中止后无 `running` 残留、孤儿步骤、trace 全量不裁剪（终态完整、toolCall/toolResult 保留）、运行中帧 `subagentRunDeferred` 分帧、`parseStructuredAgentResult` 解析策略 |
| `tests/server/agent-manager.subagents.test.mjs` | 通过真实 `run_workflow` 工具执行脚本，复用真实 subagent 生命周期与真实 workspace 工具集（`tool("read_file")`、`run_in_background` 拒绝），校验内容、details、阶段与运行中更新 |
| `tests/server/approval-store.test.mjs` | `run_workflow` 的 `/plan` 白名单与 `allowSubagents:false` 拒绝语义 |
| `tests/server/agent-approval-orchestrator.test.mjs` | workflow step signal 中止时 pending 审批立即 reject，不等到 5 分钟审批超时 |
| `tests/server/tools/definitions.test.mjs` | `workflowTool` 元数据、参数与 `workspaceTools` 暴露 |
| `tests/frontend/workflow-renderer.test.ts` | 视图模型分组/状态映射/计数、阶段内 Agent+工具按 seq 交错、`workflowPhaseSteps` 折叠、`workflowTimeline` 并发/并行/跨度统计、`WorkflowRunStore` 指纹去重与终态不回退、打开请求归一化、聊天卡单行入口（无展开体、无刻度、shimmer、preparing 回退）、Inspector 详情页（概览/阶段头/步骤/日志/脚本 sheet/失败定位）、脚本只在 detailed 模式进 payload、注册/图标/刷新/审批接线、i18n 成对、CSS 契约 |
| `tests/frontend/approval-card.test.ts` | `run_workflow` 标签、`workflow` / `workflow-tool` 来源徽标与风险说明 |
| `tests/frontend/workflow-agent-run-events.test.ts` | `run_workflow` SSE → store 的实时发布、`subagentRunDeferred` 帧复用可见 trace、终止帧不被迟到 running 帧回退、非 workflow 事件忽略 |
| `tests/frontend/workflow-step-interaction.test.ts` | 聊天卡与 Inspector 详情互不干扰；Agent 行动作派发 `OPEN_SUBAGENT_RUN_EVENT`、优先打开 store 最新快照 |

针对性命令：

```bash
npx vitest run tests/server/agent-workflow-runner.test.mjs tests/server/agent-manager.subagents.test.mjs tests/server/agent-approval-orchestrator.test.mjs tests/server/approval-store.test.mjs tests/server/tools/definitions.test.mjs tests/frontend/workflow-renderer.test.ts tests/frontend/workflow-agent-run-events.test.ts tests/frontend/workflow-step-interaction.test.ts tests/frontend/process-folding.test.ts tests/frontend/approval-card.test.ts
```

完整验证仍以 `npm run test`、`npm run lint`、`npm run build` 为准；上述单测覆盖契约，但不等于真实模型行为或浏览器视觉/焦点验收。

## 10. 相关文件

- `server/agent-workflow-runner.mjs`（802 行）
- `server/agent-workflow-worker.mjs`（423 行）
- `server/agent-workflow-tools.mjs`（109 行）
- `server/agent-subagent-runner.mjs`
- `server/tools/definitions.mjs`
- `server/agent-manager.mjs`
- `server/approval-store.mjs`
- `server/routes/tools.mjs`
- `src/lib/workflow-run-detail.ts`（549 行）
- `src/lib/workflow-run-payload.ts`（190 行）
- `src/lib/workflow-subagent-detail.ts`（149 行）
- `src/lib/workflow-agent-run-events.ts`（135 行）
- `src/components/workspace/WorkflowRunDetailContent.tsx`（468 行）
- `src/lib/tool-renderers/workflow-tool-renderer.tsx`（164 行）
- `src/lib/local-tools.ts`
- `src/lib/i18n.ts`
- `src/styles/chat/goal-workflow.css`
- `src/styles/workspace/workflow-detail.css`
