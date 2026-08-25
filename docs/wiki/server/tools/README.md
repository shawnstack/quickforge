# `server/tools/` — 工作区工具

工作区工具定义和执行 handler 都在此目录。Agent 默认权限下安全读取工具可自动执行，写入、编辑、命令等可能改变状态的工具需要审批；完全访问权限会在 workspace 沙箱和敏感文件限制内自动执行。

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [definitions.mjs](../../server/tools/definitions.mjs) | 工具元数据定义 (名称、参数 Schema) | 210 |
| [index.mjs](../../server/tools/index.mjs) | 工具执行 handler | 1182 |

---

## definitions.mjs

使用 TypeBox 定义工具参数 Schema，是工具元数据的单一数据源。

### 内置工具列表

| 工具名 | 说明 |
|--------|------|
| `run_subagent` | 委托有边界的任务给启用的临时 Agent Profile；需要文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现或影响面分析时优先使用只读 `explore`，有边界的复杂多步骤实现或更广泛独立任务使用 `general`，自定义 Agent 也可启用为 sub agent |
| `read_file` | 读取文件内容 |
| `grep_files` | 文本/正则搜索文件 |
| `write_file` | 创建或覆写文件 |
| `edit_file` | 替换文件中的文本 |
| `run_command` | 在工作区目录执行 shell 命令，也用于查看目录内容 |
| `present_files` | 仅在用户适合直接检查实际交付物时展示少量相关文件，例如视觉产物、报告、文档、生成资源，或用户明确要求查看/审阅的文件；普通实现改动、测试和辅助代码不应仅因被修改就批量展示。HTML/SVG/图片进入 Browser，Markdown、代码、配置与普通文本进入 Reader |
| `activate_skill` | 加载 Agent Skill 指令 |
| `read_skill_resource` | 读取 Skill 资源文件 |
| `ask_user` | 向用户提出 1-4 个问题并等待回答：execute 阻塞在 `server/ask-store.mjs` 的 pendingAsks Promise 上，SSE `ask_user_required` 通知前端注入向导式提问卡，用户提交/跳过后经 `POST /api/agents/:id/answer-ask` resolve，回答以纯文本回给模型；30 分钟超时、跳过、abort 均按"用户未回答"继续而非中断；免审批（beforeToolCall 直接放行），`/plan` 白名单包含它；无 toolHandlers 入口，由 agent-manager 的 `wrapAskUserToolDefinition` 拦截并绑定会话 |
| `todo_write` | 为非简单的多步骤任务记录简短当前计划；每次调用必须提交包含已完成项在内的**完整最新快照**。唯一参数 `todos` 最多 20 项，每项仅含非空 `content`（最多 200 字符）与 `status` 三态：`pending` / `in_progress` / `completed`；空数组表示显式清空。工具为 `sequential`，默认免审批但不属于安全读取工具，`/plan` 明确禁止调用，直接工具 REST 也禁止 |

`activate_skill`、`read_skill_resource`、`run_subagent` 和 `todo_write` 对所有运行中的 Agent 可用；文件/命令工作区工具需要绑定项目。`todo_write`、`write_file`、`edit_file` 和 `run_command` 标记为 `executionMode: 'sequential'` 以确保执行顺序。

`generate_image` 当前已从 `workspaceTools` 移除，不再向 Agent 或 `GET /api/tools` 暴露。相关 handler、图片生成模块、会话资产路由与前端渲染仍保留，仅用于兼容历史会话。

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
| `generateSessionImages` | `generate_image`（历史兼容） | 保留的 OpenRouter Images handler；当前不再由工具定义暴露，仅用于兼容历史会话与既有结果链路 |
| `toolPresentFiles` | `present_files` | 校验并声明本轮需要展示的产物文件，推断 HTML、图片、Markdown、代码和可读文本类型，返回 `present_files_result` 供前端分流到 Browser 或 Reader |
| `toolActivateSkill` | `activate_skill` | 激活 Agent Skill |
| `toolReadSkillResource` | `read_skill_resource` | 读取技能资源 |
| Agent-manager handler | `run_subagent` | 在父会话内创建短生命周期临时 Agent，使用受限工具执行专门子任务并返回建议性结果 |

### 安全特性
- **路径安全**: `resolveWorkspacePath()` 确保操作不超出工作区范围
- **敏感路径保护**: `assertSafeWorkspacePath()` 阻止访问 `.git/`、`.env`、密钥文件等
- **ripgrep 内置搜索**: `grep_files` 优先使用 `@vscode/ripgrep` 随包提供的 `rg`，支持 glob、上下文行、只返回匹配文件；不可用或正则不兼容时回退 Node.js 实现
- **搜索安全边界**: ripgrep 调用使用 `spawn(..., { shell: false })`，强制排除敏感文件 glob，并默认保持旧搜索行为（`--hidden --no-ignore` + 内置排除规则）
- **写入防误**: `write_file` 验证文件在项目内；`edit_file` 确保 `oldText` 唯一匹配
- **命令超时与长输出**: `run_command` 默认超时 1 小时，支持通过 `timeoutMs` 在安全上下限内调整；运行中和最终结果默认只向模型/界面返回 stdout/stderr 预览：每路最多最后 200 行，且 `stdout_preview + stderr_preview` 合计最多 10,000 字符。若发生行数或字符数截断，结果会设置 `truncated: true`，并同时提供 `stdout_truncated`/`stderr_truncated` 及兼容旧字段 `stdoutTruncated`/`stderrTruncated`/`outputTruncated`。完整 stdout/stderr 会写入 `~/.quickforge/logs/commands/`，结果通过 `outputFile` 指向日志文件。Agent 运行中的 `run_command` 会按 `toolCallId` 登记，前端工具卡片可手动终止。
- **图片生成历史兼容**: `generate_image` 当前不在 `workspaceTools` 中，不向 Agent、`GET /api/tools` 或直接工具 REST 暴露；`directRouteDisabledTools`、handler、OpenRouter Images 实现、会话资产与历史结果渲染继续保留。历史能力支持 PNG/JPEG/WebP/GIF，单图最多 25 MiB、单次最多 4 张且总计最多 50 MiB；图片二进制位于会话资产目录，永久删除会话时同步清理。
- **Error 对象传递**: 工具错误通过 `statusCode` 属性传递 HTTP 状态码
- **TodoWrite 权限与数据边界**: `todo_write` 在普通 Agent 运行中由审批 hook 默认直接放行，但不加入 `safeReadTools`；只读 `/plan` 的命令权限检查明确拒绝它。`server/routes/tools.mjs` 将其列入 `directRouteDisabledTools`，因此不能通过 `POST /api/tools/todo_write` 绕过 Agent 会话调用。成功结果作为普通 `toolResult` 消息持久化，Composer Dock 内 `message-editor` 前的正常流任务摘要与历史 renderer 均从消息快照恢复；服务端不新增独立 todo store、SQLite 表或其他权威状态源。
- **Subagent 约束**: `run_subagent` 只在 Agent 内部可用，不开放直接 REST 执行；子 Agent 为短生命周期、不持久化、不允许递归调用 `run_subagent`，且不注入 MCP 或 Agent Skill 工具。可调用启用为 sub agent 的 Agent Profile；内置 `explore` 允许 `read_file`/`grep_files`/`run_command`，是文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现和影响面分析的首选只读探索 Agent，不包含写入或编辑工具，`run_command` 应只用于安全的检查/诊断命令；内置 `general` 可使用完整内置工作区工具（读、搜、写、编辑、命令），适合有边界的复杂多步骤实现或更广泛独立任务；自定义 Agent 按 `allowedTools` 白名单限制，危险工具在 YOLO 关闭时仍走父会话审批。
