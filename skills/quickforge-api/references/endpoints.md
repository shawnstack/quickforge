# 白名单端点速查

脚本 `scripts/qf-api.mjs` 的每个子命令都对应下表中的一行。**加新子命令 = 修改这张表和脚本，
不要绕过脚本直接用 curl 调其它端点。**

反过来的约束同样成立：**脚本新增任何调用，都要同步进这张表。** 这张表一旦和脚本不一致，它就不再是安全边界，
只是一份过期的说明——而「说明里没写」最容易被下一个人（或模型）当成「漏了，顺手补上」。

本机回环即认证（`server/access-policy.mjs`），没有 token。所以这张表同时也是安全边界。

## 只读

| 方法 | 路径 | 子命令 | 备注 |
|---|---|---|---|
| GET | `/api/health` | `whoami` | `ok` / `pid` / `port` / `mode` / `version` / `dataDir` / `workspaceRoot` / `project` |
| GET | `/api/agents` | `agents` | 只含**内存中活跃**的会话；已归档的冷会话不在里面 |
| GET | `/api/agents/:id/status` | `whoami` / `wait` | 轻量状态；会话不在内存时返回 404 |
| GET | `/api/sessions/:id/view?tail=N` | `show` | 只读视图，**不唤醒**会话；长会话默认只回尾窗 |
| GET | `/api/agents/:id/messages?from=&limit=` | `messages` | 会触发会话恢复 |
| GET | `/api/storage/sessions-metadata/index/lastModified?direction=desc&limit=&offset=` | `sessions` | 返回 `{ values, total }` |
| GET | `/api/instructions?projectId=` | `instructions` | `{ base, systemPrompt, skills, ... }`，`systemPrompt` 体量大 |
| GET | `/api/skills?available=true&projectId=` | `skills` | 当前会话真正能 `activate_skill` 的列表 |
| GET | `/api/agents/:id/state` | `whoami` / `spawn` / `task-add` | 读**自己**的 `modelRef` / `thinkingLevel`：`spawn` 靠它继承思考档，`task-add` 靠它把任务绑到同一个模型上。会话被驱逐或未建好时 404，调用方必须能接受 |
| GET | `/api/agents/:id/context-usage` | `context` | 上下文预算「油表」：`usage.inputTokens` / `contextWindow` / `percent` / `remainingTokens` / `breakdown` / `inputTokenSource`。轻量，不返回消息体；会话被驱逐时先尝试恢复，仍无则 404 |
| GET | `/api/models/catalog` | `task-add` | 模型目录。只在 `--model` 显式指定、或读不到自己状态时用；`task-add --model` 收的是目录里的模型 id，不是引用对象 |

## 写（默认只作用于自己）

| 方法 | 路径 | 子命令 | 请求体 |
|---|---|---|---|
| POST | `/api/agents/:id/title` | `title` | `{ title }` |
| POST | `/api/agents/:id/model` | `model` | `{ modelRef }` |
| POST | `/api/agents/:id/thinking-level` | `thinking` | `{ thinkingLevel }`，取值 `off/low/medium/high/xhigh` |
| POST | `/api/agents/:id/goal` | `goal` | `{ action, objective? }` |
| POST | `/api/agents/:id` | `spawn` | `{ title, scope, projectId, thinkingLevel, accessMode?, modelRef? }`，**sessionId 由调用方生成**；`accessMode` 只允许 `default` / `full-access` |
| POST | `/api/agents/:id/prompt` | `spawn` / `prompt` | `{ message }`，正在跑时 409 |
| POST | `/api/agents/:id/abort` | `abort` | `{}` |
| POST | `/api/agents/:id/compact` | `compact` | `{ reason? }`。**时机由服务端判定**：空闲 → 同步压完，回 `{ compacted: true, summary, usageBefore, usageAfter }`；在跑 → 只登记一次 `session.forceCompaction`，回 `{ scheduled: true, reason: 'deferred_to_next_model_request' }`，由下一次模型请求前的 `transformSessionContext` 消费。**写租约不在入口**：守卫作为回调沉到 running 判定之后，脚本额外带 `x-quickforge-agent-session: <自己的 sessionId>`，于是「正在跑 + 压自己」跳过租约（该分支不落库）；空闲分支会写库，仍须持有租约。压缩可逆（原文保留在会话与备份里，摘要本身是一条 `quickforgeCompaction` 消息），所以放进白名单 |

## 定时任务

定时任务是 QuickForge 自己的功能（界面上的「定时任务」页），到点开一个**新会话**执行 `instruction`。
可逆动作全放开：建、暂停、恢复、立即执行、读历史、解析排期。删除不可逆（会连带删运行历史），所以只放开 `createdBy: 'agent'` 那一种——即 AI 自己用 `--self-scheduled` 排的班。

| 方法 | 路径 | 子命令 | 请求体 / 备注 |
|---|---|---|---|
| GET | `/api/scheduled-tasks` | `tasks` | 返回被削过：`id / title / status / scheduleType / scheduleRule / nextRunAt / lastRunAt / projectId / modelId / thinkingLevel` |
| POST | `/api/scheduled-tasks` | `task-add` | `{ task: { title, instruction, ...排期, enabled, executionMode }, modelRef, thinkingLevel, projectId?, createdBy? }`。**`modelRef` 必填**，缺了服务端 400 `invalid_model_reference`。`createdBy` 只认 `'agent'`（缺省/其它值都记成 `'user'`），由脚本的 `--self-scheduled` 写入 |
| POST | `/api/scheduled-tasks/parse` | `task-parse` | `{ instruction }`，只回排期草稿 + `next` 提示，**不落库** |
| GET | `/api/scheduled-tasks/runs` | `task-runs` | 参数 `taskId` / `status`；运行记录存在 SQLite 的 `scheduled_task_runs` |
| POST | `/api/scheduled-tasks/:id/pause` | `task-pause` | 可逆 |
| POST | `/api/scheduled-tasks/:id/resume` | `task-resume` | 可逆 |
| POST | `/api/scheduled-tasks/:id/run` | `task-run` | `{}`，**同步阻塞**：服务端等这次运行结束才回包。超时只断本地连接，服务端照跑 |
| DELETE | `/api/scheduled-tasks/:id?selfScheduledOnly=1` | `task-delete` | 带这个参数时**只放行 `createdBy === 'agent'`**（即 `task-add --self-scheduled` 建的那条），其它一律 403 且无副作用。界面上用户删自己的日程**不带**该参数，所以不受影响。会连带删掉该任务的全部运行历史 |

跑起来的会话权限**不来自任务本身**，而是读全局 `yolo-mode` 设置（`server/routes/scheduled-tasks.mjs` 的 `executeTask`）：
全局开着完全访问，任务会话也是完全访问；全局没开，任务会话每步等审批——而无人值守时没人点。
所以排任务时要按「这两种设置下都不能卡住」来设计，优先只读、只产报告。会话标题会被套成 `[定时任务] <title>`。

## 明确不给出口的端点（存在，但不进白名单）

| 前缀 | 为什么禁止 |
|---|---|
| `DELETE /api/agents/:id`、`DELETE /api/storage/sessions/*` | 删会话不可逆 |
| `DELETE /api/scheduled-tasks/:id?selfScheduledOnly=1` 且 `createdBy` 不是 `'agent'` | 删任务会**先删掉它的全部运行历史**再删本体，不可逆。所以脚本只能收自己 `--self-scheduled` 排的班，服务端 403 兜底；界面删除不带这个参数，用户删自己的日程不受影响 |
| `PUT` / `PATCH /api/scheduled-tasks/:id` | 覆盖用户排好的日程属破坏性操作；要改让用户自己在「定时任务」页改 |
| `/api/agents/:id/access-mode`、`/yolo-mode` | 等于自我提升权限 |
| `/api/agents/:id/prompt` 里的 `/compact` 命令 | 那是**别人**的会话入口：要求目标会话空闲，请求方是它自己时必然 409。自己压缩走 `POST /api/agents/:id/compact` |
| `/api/lan-access/*` | 决定谁能从局域网进来 |
| `/api/terminal/*` | 直接执行命令，绕过工具审批 |
| `/api/backup/*` | 覆盖存储 |
| `/api/plugins/*`、`/api/mcp*` | 装代码、装外部通道 |
| `DELETE /api/memory`、`/api/working-memory` 写接口 | 已有专门工具，且这些工具带用户授权语义 |
| `/api/agents/events`（SSE） | 会话级 SSE 单连接，抢了会把用户的页面踢掉；要用轮询 `status` 代替 |

## 身份与环境变量

`server/tools/index.mjs` 的 `toolRunCommand` 通过
`server/runtime-info.mjs` 的 `buildChildProcessEnv(context)` 注入：

| 变量 | 来源 | 没有时 |
|---|---|---|
| `QUICKFORGE_API_BASE` | `setRuntimeInfo()`（`server/index.mjs` 的 listen 回调） | 脚本回退到端口探测 |
| `QUICKFORGE_SESSION_ID` | `toolContext.sessionId` | `whoami` 返回 `session: null`，写操作要求 `--sessionId` |
| `QUICKFORGE_PROJECT_ID` | `toolContext.projectId` | 同上 |
| `QUICKFORGE_WORKSPACE_ROOT` | `toolContext.workspaceRoot` | — |

运行时信息**只存在进程内**，不落盘：dev 与正式实例、以及自定义端口会互相覆盖文件。
