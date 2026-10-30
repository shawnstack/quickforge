## Goal 当前契约：自动执行与无限累计时间

规划整轮只读，正常轮末及持久化成功后自动执行，不需要计划确认。新 Goal 的 maxActiveDurationMs 为 JSON null（无限），累计用时仍记录，默认轮次20（设置·通用可配置），保留防空转/重复失败、工具审批、必要提问、暂停取消及单工具超时。旧快照不自动执行或改写终态；显式 resume/extend_resume/revise 移除旧时间上限，extend_resume 保留 CAS 且只给耗尽轮次追加配置轮次（默认 20）。有计划恢复 running，无计划重新 planning。complete 保留可信证据与正常轮末持久化屏障；needs_review 报告改为 blocked 并说明无法验证原因，不伪造 passed。历史 human evidence 与 accept API 兼容。当前聊天 controller 不再生成确认按钮，Inspector/card 不提供验收动作；历史 renderer 保留当时事实。

# `server/tools/` — 工作区工具

工作区工具定义和执行 handler 都在此目录。Agent 默认权限下安全读取工具可自动执行，写入、编辑、命令等可能改变状态的工具需要审批；完全访问权限会在 workspace 沙箱和敏感文件限制内自动执行。

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [definitions.mjs](../../../../server/tools/definitions.mjs) | 工具元数据定义 (名称、参数 Schema) | 210 |
| [index.mjs](../../../../server/tools/index.mjs) | 工具执行 handler | 1182 |

---

## definitions.mjs

使用 TypeBox 定义工具参数 Schema，是工具元数据的单一数据源。

### 内置工具列表

| 工具名 | 说明 |
|--------|------|
| `run_subagent` | 委托有边界的任务给启用的临时 Agent Profile；需要文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现或影响面分析时优先使用只读 `explore`，有边界的复杂多步骤实现或更广泛独立任务使用 `general`，自定义 Agent 也可启用为 sub agent |
| `run_workflow` | 用一段 JavaScript 脚本编排多个 Subagent 与工作区工具：`agent(prompt, options?)` 返回该步最终文本（带 `schema` 时返回校验后的对象，失败为 `null`）；`tool(name, args?, options?)` 直接调用当前会话工具并返回文本（失败为 `null`）；`parallel(thunks)` 并发执行并按输入顺序返回；`pipeline(items, ...stages)` 让每个 item 独立过阶段、单项失败降为 `null`；`phase(title)` / `log(message)` 记录进度；`args` 是调用方传入的 JSON。脚本在独立 worker 线程的 vm 上下文中运行，无 Node globals，必须 `return` 一个 JSON 可序列化结果。默认 24 个 Agent、64 次工具调用、4 并发、1 小时，可在 `options` 中按 1–64 / 1–128 / 1–8 / 1 秒–2 小时调整（超出范围会 clamp）；默认权限下步骤实际串行（并发 1）以保证审批卡可见，完全访问才使用配置并发 |
| `read_file` | 读取文件内容 |
| `grep_files` | 文本/正则搜索文件 |
| `write_file` | 创建或覆写文件 |
| `edit_file` | 替换文件中的文本 |
| `run_command` | 在工作区目录执行 shell 命令，也用于查看目录内容 |
| `present_files` | 仅在用户适合直接检查实际交付物时展示少量相关文件，例如视觉产物、报告、文档、生成资源，或用户明确要求查看/审阅的文件；普通实现改动、测试和辅助代码不应仅因被修改就批量展示。HTML/SVG/图片进入 Browser，Markdown、代码、配置与普通文本进入 Reader，PDF/DOCX/XLS/XLSX 进入 Document |
| `activate_skill` | 加载 Agent Skill 指令 |
| `read_skill_resource` | 读取 Skill 资源文件 |
| `ask_user` | 向用户提出 1-4 个问题并等待回答：execute 阻塞在 `server/ask-store.mjs` 的 pendingAsks Promise 上，SSE `ask_user_required` 通知前端注入向导式提问卡，用户提交/跳过后经 `POST /api/agents/:id/answer-ask` resolve，回答以纯文本回给模型；30 分钟超时、跳过、abort 均按"用户未回答"继续而非中断；免审批（beforeToolCall 直接放行），`/plan` 白名单包含它；无 toolHandlers 入口，由 agent-manager 的 `wrapAskUserToolDefinition` 拦截并绑定会话。**同会话同一时刻只展示一张提问卡**：`ask-store.mjs` 的 `enqueueAskForSession` 把同会话后续 ask_user 按到达顺序串起来，前一条结算（作答/跳过/超时/中止）后下一条才注册并发出自己的 `ask_user_required`，因此不会出现后一张卡覆盖前一张、前一张只能干等 30 分钟超时；30 分钟计时从该条**变为可见**时开始，排队期间不计时。累计排队达到 `ASK_QUEUE_MAX_WAITING`（3）后，多余提问不注册，直接以 `details.skipReason: 'busy'` 的文本结果回到模型（提示等当前提问被回答后再继续），不会挂死。`pendingAsks` 是进程内 Map：服务重启后待答提问随进程消失，该轮不再有 tool result（历史里留下一条 `called` 状态的 ask_user 卡），也不会出现幽灵卡片或自动代答 |
| `todo_write` | 为非简单的多步骤任务记录简短当前计划；每次调用必须提交包含已完成项在内的**完整最新快照**。唯一参数 `todos` 最多 20 项，每项仅含非空 `content`（最多 200 字符）与 `status` 三态：`pending` / `in_progress` / `completed`；空数组表示显式清空。工具为 `sequential`，默认免审批但不属于安全读取工具，`/plan` 明确禁止调用，直接工具 REST 也禁止 |
| `goal_report` | 仅 Goal 模式：会话有活跃 goal 时注入，规划轮必须且只能以 `action:"plan"` 提交 2-8 条可验收准则、范围与摘要，执行轮用 `progress` / `blocked` / `needs_review` / `complete` 回报。证据必须引用本会话真实成功工具结果的 `toolCallId`（控制面/委派/Skill/记忆类工具不算），准则只能在有此类证据时标记 `passed`；`complete` 通过证据检查后等待正常轮末和最终持久化，成功才自动 `completed`；显式 `needs_review` 转为 blocked 并说明验证限制。不在 `workspaceTools`、不进入 `GET /api/tools`，也没有 REST handler（直接调用返回 404） |

### run_workflow 与 run_subagent 的分工

| 维度 | `run_subagent` | `run_workflow` |
|------|----------------|----------------|
| 适用 | 单个有边界的委派 | 多个独立委派或分阶段流水线 |
| 输入 | `subagent` / `task` / `context` / `expectedOutput` | `script` / `args?` / `options?` |
| 工具调用 | Agent 内部自行调用 | `tool()` 直接调用会话工具，默认 64 次（上限 128，`maxTools`）；写/命令/MCP 等仍按会话审批 |
| 并发 | 单次一个 Agent | 每个 `agent()`/`tool()` 一步，默认 4 并发、24 个 Agent（上限 8 / 64，可在 `options` 调整）；默认权限下实际串行 1 |
| 超时 | Profile 默认/上限 2 小时 | 整条工作流默认 1 小时、上限 2 小时 |
| 结构化输出 | 无内建 schema 校验 | 每个 `agent()` 可选 JSON Schema |
| 失败 | 该次委派失败 | 单步失败返回 `null`，脚本可继续；脚本异常/超时/中止才整体失败 |
| 审批 | 每个受保护工具按会话策略 | 默认权限下启动前一次审批；每步工具仍按原策略 |
| 递归 | 子 Agent 不能再用 `run_subagent` | Subagent/Profile 不注入 `run_workflow` |

`run_workflow` 与 `run_subagent` 一样属于 `workspaceTools`，会出现在 `GET /api/tools` 的元数据中，但**没有 `tools/index.mjs` handler**：执行由 `agent-manager.mjs` 的 `wrapWorkflowToolDefinition` 绑定会话后调用 `server/agent-workflow-runner.mjs`。`server/routes/tools.mjs` 把它列入 `directRouteDisabledTools`，因此 `POST /api/tools/run_workflow`（含 `/api/projects/:id/tools/run_workflow`）返回 404，不能绕过 Agent 会话直接执行。

`run_workflow` 的可用范围还受命令与 Goal 权限约束：`/plan` 只读白名单不包含它（返回 `Command /plan is read-only and cannot use run_workflow.`），Goal planning 使用同一只读边界并拒绝它（`Goal planning is read-only and cannot use run_workflow.`），命令显式 `allowSubagents:false` 时返回 `Command /<name> does not allow running workflows.`，`goal_report complete` 后的结算窗口只允许 `read_file` / `grep_files`（验证阻塞时另允许必要 `ask_user`）。工具本身标记 `executionMode: 'sequential'`，同一轮内与其他顺序工具串行执行。

`activate_skill`、`read_skill_resource`、`run_subagent`、`run_workflow` 和 `todo_write` 对运行中的主 Agent 可用（`run_workflow` 不注入 Subagent/Profile 会话）；文件/命令工作区工具需要绑定项目。`todo_write`、`write_file`、`edit_file` 和 `run_command` 标记为 `executionMode: 'sequential'` 以确保执行顺序。`goal_report` 是 Goal 模式专用：仅在会话有活跃 goal 时由 `agent-manager.mjs` 的 `createGoalReportTool` 绑定会话注入，不进入默认工具集，也不经 `tools/index.mjs` handler。

`generate_image` 工具及其服务端实现（`server/image-generation.mjs`、handler 注册、`directRouteDisabledTools` 条目）已整体移除。历史会话的图片文件仍保留在会话资产目录，`/api/session-assets/...` 与分享资产路由继续提供只读访问，永久删除会话时同步清理。

### Goal 报告阶段与授权

显式 `/goal` 已授权目标范围内自动执行，不再重复请求计划确认；必要澄清、工具审批与安全边界仍生效。只读规划 → `goal_report plan` → 正常轮末与持久化双屏障 → 自动 execution；plan 工具返回不代表已进入执行期。

`agent-goal-runner.mjs` 以 `isGoalPlanning(session)`（包含当前与结算中的 planning run）或未确认 awaiting_confirmation 拒绝执行期报告。即使 plan 已把 goal 状态改为 awaiting_confirmation，同一规划轮也不能调用 `progress` / `blocked` / `needs_review` / `complete` 覆盖计划；重复 plan 仍由既有门禁拒绝。执行轮 `needs_review` 转 blocked 的契约不变。真正必要的 `ask_user` 继续等待用户回答，不由自动交接代答或跳过；取消、异常及持久化失败不启动执行。

## index.mjs

实现每个工具的 execute handler。

### 工具处理器清单

| Handler | 对应工具 | 功能描述 |
|---------|---------|---------|
| `toolReadFile` | `read_file` | 读取文件，支持 offset/limit 分页 |
| `toolGrepFiles` | `grep_files` | 使用内置 ripgrep 优先搜索文件内容，支持正则、glob、上下文和只返回匹配文件；异常时回退 Node.js 搜索 |
| `toolWriteFile` | `write_file` | 写入文件，自动创建父目录 |
| `toolEditFile` | `edit_file` | 查找并替换文本，验证唯一性 |
| `toolRunCommand` | `run_command` | 执行 shell 命令，支持可控超时、流式 tail 输出和完整日志落盘 |
| `toolTodoWrite` | `todo_write` | 严格校验并规范化完整 Todo 快照，返回 `todo_write_result`（含 `todos` 与 pending/inProgress/completed 汇总）；空数组返回清空语义。结果沿普通 `toolResult` 消息链随会话持久化，不建立独立 todo store 或存储表 |
| `toolPresentFiles` | `present_files` | 校验并声明本轮需要展示的产物文件，推断 HTML、图片、Markdown、代码、可读文本以及 PDF/DOCX/XLS/XLSX 文档类型，返回 `present_files_result` 供前端分流到 Browser、Reader 或 Document |
| `toolActivateSkill` | `activate_skill` | 激活 Agent Skill |
| `toolReadSkillResource` | `read_skill_resource` | 读取技能资源 |
| Agent-manager handler | `run_subagent` | 在父会话内创建短生命周期临时 Agent，使用受限工具执行专门子任务并返回建议性结果 |
| Agent-manager handler（`wrapWorkflowToolDefinition`） | `run_workflow` | 绑定会话并调用 `agent-workflow-runner.mjs`：worker + vm 执行编排脚本，按有界队列复用 `run_subagent` 生命周期执行每个 `agent()`，并由 `agent-workflow-tools.mjs` 复用会话工具集/审批执行每个 `tool()`，聚合阶段/Agent/工具/日志/结果 details；失败时经 `afterToolCall` 回填部分 details |
| Agent-manager handler（`createGoalReportTool`） | `goal_report` | 仅活跃 goal 会话注入：校验并记录 plan / progress / blocked / needs_review / complete；证据只信任本会话真实成功工具结果的 toolCallId，`complete` 经正常轮末/持久化屏障后自动完成，失败或中止不完成 |

### 安全特性
- **路径安全**: `resolveWorkspacePath()` 确保操作不超出工作区范围
- **敏感路径保护**: `assertSafeWorkspacePath()` 阻止访问 `.git/`、`.env`、密钥文件等
- **ripgrep 内置搜索**: `grep_files` 优先使用 `@vscode/ripgrep` 随包提供的 `rg`，支持 glob、上下文行、只返回匹配文件；不可用或正则不兼容时回退 Node.js 实现
- **搜索安全边界**: ripgrep 调用使用 `spawn(..., { shell: false })`，强制排除敏感文件 glob，并默认保持旧搜索行为（`--hidden --no-ignore` + 内置排除规则）
- **写入防误**: `write_file` 验证文件在项目内；`edit_file` 确保 `oldText` 唯一匹配。二者共享 `session-file-lock.mjs` 全局进程内锁，覆盖读取旧内容、before/pending 日志、实际写入与预期 `afterHash` 提交；会话备份持久化失败阻止工具继续写入，写入中断保留不安全状态。续写校验与上次 after 的连续性，外部改动链不会被后续工具写入“洗白”；Windows 别名验证同一目标后去重，不可信路径拒绝。安全撤销支持每项独立 revision：普通兄弟项冲突/legacy 不影响安全单项，整批仍要求剩余全安全；会话忙、索引异常或失败回滚 intent 全局阻止。独立 `rollback-intent` marker 仅在最终索引提交成功后清除，失败保留 intent 并阻止后续受控写入；成功撤销项从剩余 preview/summary 排除，再写入该项以当次 before 新建记录。带父会话 `sessionId` 的子 Agent 同类工具也纳入备份/撤销；shell 及 MCP 独立写入不在覆盖范围，锁不阻止外部进程，也不扩展 Git index 操作。`write_file`/`edit_file` 的 toolResult `details` 返回 `turnId`（当次所属轮标识，由 toolContext `getTurnId` 供给；无轮次写入为 `null`，如合成路径或旧会话恢复后的写入），备份版本 meta 同步携带 `turnId` + `toolCallId`，供轮级回滚按轮归因。
- **命令超时与长输出**: `run_command` 默认超时 1 小时，支持通过 `timeoutMs` 在安全上下限内调整；运行中和最终结果默认只向模型/界面返回 stdout/stderr 预览：每路最多最后 200 行，且 `stdout_preview + stderr_preview` 合计最多 10,000 字符。若发生行数或字符数截断，结果会设置 `truncated: true`，并同时提供 `stdout_truncated`/`stderr_truncated` 及兼容旧字段 `stdoutTruncated`/`stderrTruncated`/`outputTruncated`。完整 stdout/stderr 会写入 `~/.quickforge/logs/commands/`，结果通过 `outputFile` 指向日志文件。Agent 运行中的 `run_command` 会按 `toolCallId` 登记，前端工具卡片可手动终止。`run_in_background: true` 时调用立即返回（`details.background/running/detached` 与 `taskId`），忽略 `timeoutMs`，进程脱离当前回合并持续把 stdout/stderr 追加到同一日志；进程退出或被终止后，会话收到 `<task-notification>`（含输出文件路径）。**Windows 上 `detached` 恒为 `false`（`details.detached` 为 `false`）**：`DETACHED_PROCESS` 会让 `CREATE_NO_WINDOW`（Node 的 `windowsHide`）失效，`cmd.exe` 会新建控制台并弹出默认终端窗口；后台的「调用已返回、进程继续运行」语义改由 `unref()` 承担，杀进程仍走 `taskkill /T /F`，不需要进程组。非 Windows 保持 `detached: true` 以便 `killProcessTree` 用 `process.kill(-pid)` 终止整个进程组。`openBrowser()`（`server/utils/platform.mjs`）同理：Windows 不开 `detached` 才能隐藏 `cmd /c start` 的启动器窗口。前端工具卡 console 块与「后台任务」Inspector 面板都提供「查看完整日志」入口：点击后派发 `quickforge:view-command-log` 事件，由 `App.tsx` 转成 `kind: 'command-log'` 的 Reader 请求，读取受限端点 `GET /api/agents/:sessionId/command-log?path=<绝对日志路径>`（只放行 `<dataDir>/logs/commands/*.log`，复用与 `read_file` 相同的 `isCommandLogPath` 判定）；日志 tab 不参与工作区文件缓存与 tab 持久化。当前回合仍在流式时通知走 `followUp`，空闲时直接开始下一轮；活跃 Goal 只暂存通知。`read_file` 可按返回的绝对路径读取该命令日志，其它工作区外路径仍拒绝。会话销毁或服务关闭会终止该会话仍在运行的后台命令；普通空闲回收不终止——会话 idle 计时器到点但仍有运行中后台命令时只重置计时器，最后一个命令退出后再按常规回收（退出通知依赖活跃会话对象投递）。运行列表通过会话状态和 `background_commands` 事件同步；进程退出时会把原 `toolResult` 替换为终态。前端「后台任务」Inspector 面板的终态历史即来自这份被替换的 `toolResult` `details`（`src/lib/background-tasks-model.ts` 的 `buildBackgroundTasks` 派生），因此没有新增服务端接口；`listBackgroundCommandTasks` 仍只返回 running——该语义是会话 idle 回收的判断依据，不可改为返回终态。服务端 `settleBackgroundCommandToolResult` 在找不到对应 `toolResult` 消息时返回 `false`（会话被驱逐/compaction 截断等边界场景），该任务不会出现在面板终态里。
- **会话资产只读兼容**: `generate_image` 工具、`server/image-generation.mjs` 与 handler 注册已整体移除，前端不再有图片渲染入口。历史会话的图片二进制仍位于会话资产目录（PNG/JPEG/WebP/GIF，单图最多 25 MiB），`/api/session-assets/:sessionId/:assetId` 与分享资产路由提供只读访问，永久删除会话时同步清理。
- **Error 对象传递**: 工具错误通过 `statusCode` 属性传递 HTTP 状态码
- **TodoWrite 权限与数据边界**: `todo_write` 在普通 Agent 运行中由审批 hook 默认直接放行，但不加入 `safeReadTools`；只读 `/plan` 的命令权限检查明确拒绝它。`server/routes/tools.mjs` 将其列入 `directRouteDisabledTools`，因此不能通过 `POST /api/tools/todo_write` 绕过 Agent 会话调用。成功结果作为普通 `toolResult` 消息持久化，Composer Dock 内 `message-editor` 前的正常流任务摘要与历史 renderer 均从消息快照恢复；服务端不新增独立 todo store、SQLite 表或其他权威状态源。
- **Subagent 约束**: `run_subagent` 只在 Agent 内部可用，不开放直接 REST 执行；子 Agent 为短生命周期、不持久化、不允许递归调用 `run_subagent`，且不注入 MCP 或 Agent Skill 工具。可调用启用为 sub agent 的 Agent Profile；内置 `explore` 允许 `read_file`/`grep_files`/`run_command`，是文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现和影响面分析的首选只读探索 Agent，不包含写入或编辑工具，`run_command` 应只用于安全的检查/诊断命令；内置 `general` 可使用完整内置工作区工具（读、搜、写、编辑、命令），适合有边界的复杂多步骤实现或更广泛独立任务；自定义 Agent 按 `allowedTools` 白名单限制，危险工具在 YOLO 关闭时仍走父会话审批。
- **Workflow 约束**: `run_workflow` 在默认权限下由 `beforeToolCall` 审批一次（展示**完整脚本** ≤20KB、`args` 与 `options`；风险说明明确“以服务进程权限运行本地 JavaScript”；拒绝或 5 分钟审批超时都不启动 worker），完全访问模式跳过该次审批；但脚本内每个 Agent 的写文件、命令、MCP/Plugin 等调用，以及 `tool()` 直接发起的工具调用，仍按各自会话的审批策略执行（`tool()` source 为 `workflow-tool`，审批卡显示 Workflow 徽标），审批只授权“启动编排”，不是永久授权。脚本运行在服务器进程内的 worker thread + vm context 中：hooks 由 guest bridge 在 vm 内创建，`args` 以 JSON 字符串进入并在 guest 内解析，host function 为 null-prototype 且在脚本编译前删除，host 回复只以 JSON 字符串经 guest pump 投递；不暴露 `process`/`require`/`fetch`/定时器/`console`，禁用 `eval`/WASM，同步段限时 10 秒，worker 设 `resourceLimits`，父进程可终止 worker；这提供隔离与可终止性，但**不是安全沙箱**，审批提示或完全访问模式才是信任边界。默认权限下步骤串行（并发 1）以保证审批卡不互相覆盖；完全访问才使用配置并发。预算：默认 24 个 Agent / 64 次工具调用 / 4 并发 / 1 小时，硬上限 64 / 128 / 8 / 2 小时（`options` 可在范围内调整，超出范围会 clamp）；脚本最多 20,000 字符、`args` JSON 最多 20,000 字符，工作流结果最多 1MB JSON；`tool()` 可调用工作区工具、Skill 与 MCP/Plugin，排除 `run_subagent`/`run_workflow`/`ask_user`/`todo_write`/`manage_global_memory`/`goal_report`，`run_command run_in_background` 在工作流内被拒绝；工具参数 4,000 字符、工具结果预览 2,000 字符；单 Agent prompt 与 context 各 100,000 字符、expectedOutput 10,000 字符、schema JSON 20,000 字符；**结果不截断**（脚本返回什么，模型与 Inspector 就收到什么；工具参数以结构化 `args` 透传，工作流结果预览即完整 JSON），日志最多 200 条，details 不按体积裁剪（无总量预算，与主 Agent 一致），超长结果交给上下文压缩兜底，进度 200ms 节流。单步失败解析为 `null` 且记 error 日志，脚本可继续；脚本语法错误/运行时异常/结果不可序列化/worker 崩溃/超时/父运行中止会让整条工作流失败并保留部分 details；脚本返回后未 `await` 的孤儿步骤会被 abort 并在终态 details 中标记为 `aborted`，不继续占用资源。`/plan`、Goal planning、`allowSubagents:false` 的命令权限和 Subagent/Profile 会话都不可用，也不开放直接 REST 执行。
