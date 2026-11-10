# QuickForge 本地 API Skill（`quickforge-api`）

> 状态：已落地（v1）
> 位置：`skills/quickforge-api/`、`server/runtime-info.mjs`
> 目标：让 Agent 能查看和操作 QuickForge 自己（自省、改自己的设置、派生并驱动子会话），而不是只能操作用户的业务代码。

## 1. 为什么是一个 skill 而不是一个新工具

QuickForge 的本地 API 已经覆盖了「创建会话 → 发消息 → 读消息 → 中止 → 改设置」的完整闭环，缺的只是**让 Agent 知道它存在、知道怎么安全地用它**。这正好是 Agent Skill 的形状：一份按需加载的说明书 + 随包分发的小脚本。

加一个通用 `http_request` 工具看起来更直接，但它是更差的默认值：本机回环即认证（`server/access-policy.mjs` 里 `isLocalRequest === true` 直接放行），通用 HTTP 出口等于把「删除会话、切换访问模式、局域网访问、终端、备份恢复」一起交出去。skill 自带脚本用**固定子命令 → 固定端点**，出口是枚举出来的。

## 2. 三个决定设计形态的事实

1. **本机回环即认证，没有 token。** 任何能在本机发 HTTP 的进程都被信任，包括 `run_command` 拉起的脚本。所以安全边界只能画在脚本层（白名单）和提示词层（红线），不能指望鉴权。
2. **给自己发 prompt 必然 409 `GENERATION_ALREADY_RUNNING`。** 「自己操作自己」不是自我对话循环，实际价值是：自省、改自己的标题/模型/思考档/goal、派生子会话干活、回看自己实际收到的提示词。
3. **内置 ≠ 启用。** skill 存在于 `skills/` 只代表能被发现，进 `config.globalSkills` 才算启用。因此 `defaultGlobalSkillNames` 增加 `quickforge-api`，并把迁移标记升到 `.default-skills-v2`——否则存量安装永远看不到它（v1 marker 已经存在，不会重跑）。

## 3. 组件

| 文件 | 职责 |
|---|---|
| `skills/quickforge-api/SKILL.md` | 何时用、命令表、红线、报错对照、典型配方 |
| `skills/quickforge-api/scripts/qf-api.mjs` | 零依赖最小客户端（只用 `node:` 内置模块），子命令 → 端点写死映射 |
| `skills/quickforge-api/references/endpoints.md` | 白名单端点速查 + 明确不给出口的端点清单 |
| `server/runtime-info.mjs` | 进程内记录 `{ host, port, baseUrl }`，并提供 `buildChildProcessEnv(context)` |
| `server/index.mjs` | listen 回调里 `setRuntimeInfo({ host, port: boundPort })` |
| `server/tools/index.mjs` | `toolRunCommand` 的 `spawn` 传 `env: buildChildProcessEnv(context)` |

### 3.1 身份自省：环境变量注入

暴露给模型的信息本来只有系统提示词里的 `<workspace_context>`（项目名 / 路径 / 项目 id），**它不知道自己的 sessionId，也不知道 API 端口**。没有这两样，「自己操作自己」无从谈起。

`buildChildProcessEnv()` 在每个 `run_command` 子进程上注入：

| 变量 | 来源 |
|---|---|
| `QUICKFORGE_API_BASE` | `setRuntimeInfo()`，端口取 listen 后的真实 `boundPort` |
| `QUICKFORGE_SESSION_ID` | `toolContext.sessionId` |
| `QUICKFORGE_PROJECT_ID` | `toolContext.projectId` |
| `QUICKFORGE_WORKSPACE_ROOT` | `toolContext.workspaceRoot` |

**不落盘**：dev 实例（32176）和正式实例（5176）会同时运行，自定义端口更不可预期；写同一个文件只会互相覆盖。进程内变量天然是「谁 listen 谁写」。代价是外部程序读不到——那是另一个问题，不要为它牺牲正确性。

### 3.2 端口探测的兜底与可信度排序

脚本在 `QUICKFORGE_API_BASE` 缺席时依次探测 `5176`、`32176`（若设了 `QUICKFORGE_PORT` 则优先），按可信度挑选：

1. `~/.quickforge/quickforge.pid` 与 `/api/health` 的 `pid` 一致；
2. `health.dataDir` 与预期数据目录一致；
3. 唯一可用实例。

pid 文件**只是优先级，不是门槛**：应用内重启不会更新它，实测本机 pid 文件停在 54436、真实进程是 69209。硬校验会把能用的实例挡掉（这是实现期间踩到的真实坑），所以不匹配时降级为 warning 输出在 `whoami` 里。

## 4. 安全边界

### 4.1 脚本不给的出口

`DELETE /api/agents/:id`、`DELETE /api/storage/sessions/*`、`access-mode` / `yolo-mode`、`/api/lan-access/*`、`/api/terminal/*`、`/api/backup/*`、`/api/plugins/*`、`/api/mcp*`、`/api/agents/events`（会话级 SSE 单连接，抢了会把用户的页面踢掉，改用轮询 `status`）。

测试 `tests/server/runtime-info.test.mjs` 对脚本正文做黑名单断言（无 `DELETE`、无上述前缀），防止后续「顺手加个子命令」把边界放开。

### 4.2 写在 SKILL.md 里的红线

只操作自己或自己 `spawn` 的会话；不给自己发 prompt；不做破坏性操作；不用 `curl` 绕过脚本；不把响应内容原样倒进回答（里面有绝对路径与会话 id）；读长会话先 `--limit`。

还有一条不写在模型侧、写在这里的原因：脚本请求**不带 `x-quickforge-client-id`**，因此不受前端写入租约约束，技术上能写用户正开着的会话。所以第 1 条才那么严。

## 5. 验证

- `tests/server/runtime-info.test.mjs`（10 例）：baseUrl 归一化（`0.0.0.0` → `127.0.0.1`、显式 host 保留、非法端口返回 null）、`buildChildProcessEnv` 不污染 `process.env`、`run_command` 子进程真的读得到三个变量、SKILL.md front matter 合法、`--help` 不触网、脚本安全黑名单、自我 prompt 提前拒绝。
- `tests/server/skills.test.mjs`：默认启用列表断言更新为三项。
- 手工冒烟（本机运行实例上）：`whoami` / `agents` / `sessions` / `skills` / `instructions` 全部返回预期结构。

## 6. 已知限制与后续

- **运行中的实例需要重启**才会加载新代码（注入与默认启用都在服务端）。
- `agents` 列表项比 `status` 窄（`agent-manager.listSessions` 不含 `messageCount` / `lastModified` / `isStreaming`），脚本对两者用不同映射，不要混用形状。
- 不提供任意 path/method 参数是**故意的**。要扩能力就加子命令 + 进 `references/endpoints.md` + 补黑名单测试，不要改成通用 HTTP 客户端。
- 如果将来需要「免审批的只读自省」，更合适的是加一个只读工具（如 `get_session_info`），而不是放宽 `run_command` 的审批。
