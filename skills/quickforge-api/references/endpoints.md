# 白名单端点速查

脚本 `scripts/qf-api.mjs` 的每个子命令都对应下表中的一行。**加新子命令 = 修改这张表和脚本，
不要绕过脚本直接用 curl 调其它端点。**

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

## 明确不给出口的端点（存在，但不进白名单）

| 前缀 | 为什么禁止 |
|---|---|
| `DELETE /api/agents/:id`、`DELETE /api/storage/sessions/*` | 删会话不可逆 |
| `/api/agents/:id/access-mode`、`/yolo-mode` | 等于自我提升权限 |
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
