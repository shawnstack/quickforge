---
name: quickforge-api
description: 通过本机 HTTP API 查看和操作 QuickForge 自身——自省（我在哪个项目/会话、什么模型、实际拿到的提示词）、读取会话、改自己的标题/模型/思考档、派生并驱动子会话，以及创建/暂停/恢复/立即执行定时任务。Use when the user asks about QuickForge itself (this app, its local API, its sessions, agents, skills, prompt, or scheduled tasks), or asks to list/observe running agents, spawn a sub session, rename the current chat, inspect the prompt you actually received, or schedule a recurring task.
---

# QuickForge 本地 API

QuickForge 自己就是一个本机 HTTP 服务（默认 `http://127.0.0.1:5176`，dev 模式 `32176`）。
这个 skill 用它的 API 查看和操作 QuickForge 本身，而不是操作用户的业务代码。

## 第一原则：先自省，再动手

```bash
node <skill-dir>/scripts/qf-api.mjs whoami
```

`run_command` 会给每个子进程注入三个环境变量，脚本自动读取，**不要自己拼**：

| 变量 | 含义 |
|---|---|
| `QUICKFORGE_API_BASE` | 本地 API 基址（含真实端口） |
| `QUICKFORGE_SESSION_ID` | 我自己这个会话的 id |
| `QUICKFORGE_PROJECT_ID` | 当前项目 id |
| `QUICKFORGE_WORKSPACE_ROOT` | 当前工作区根路径 |

`whoami` 返回不出来的情况只有一种：脚本被别的程序调用、没有这些变量。那时用
`--api http://127.0.0.1:<port>` 显式指定，或者接受端口探测（`5176` / `32176`，并用
`~/.quickforge/quickforge.pid` 校验不是连错实例）。

**不要**用 `curl` 自己拼 URL。脚本是本 skill 唯一的网络出口，理由见下面的红线。

## 命令表

只读：

| 命令 | 作用 |
|---|---|
| `whoami` | 我在哪、什么模型、什么项目、有没有在跑 |
| `agents` | 内存中活跃的会话（正在跑的才在这里） |
| `sessions --limit 20` | 存储里的历史会话，最新在前 |
| `show <id> --tail 8` | 只读快照，**不会唤醒**会话 |
| `messages <id> --from 0 --limit 20` | 会话消息（`/api/agents/...` 会唤醒会话） |
| `instructions --system-prompt` | 我实际收到的系统提示词（调 skill / 排查提示词） |
| `skills` | 当前会话能激活哪些 skill |

写（默认作用于我自己）：

| 命令 | 作用 |
|---|---|
| `title <文字>` | 改当前会话标题（UI 里更好找） |
| `model <modelRef>` | 换模型 |
| `thinking <off\|low\|medium\|high\|xhigh>` | 换思考档 |
| `goal <confirm\|pause\|resume\|cancel\|revise\|accept>` | 目标模式动作 |
| `wait --timeout 120` | 阻塞到当前会话不再流式输出 |

其它会话：

| 命令 | 作用 |
|---|---|
| `spawn --title T --message M` | 建一个子会话并立刻派活，返回它的 `sessionId` |
| `prompt <id> <message...>` | 给别的会话发消息 |
| `abort <id>` | 中止别的会话 |

定时任务：

| 命令 | 作用 |
|---|---|
| `tasks [--status enabled\|paused]` | 现有任务：排期、下次运行时间、绑的模型 |
| `task-add ...` | 建任务（参数见下一节） |
| `task-pause <id>` / `task-resume <id>` | 暂停 / 恢复 |
| `task-run <id> [--timeout 300]` | 立刻跑一次，**等它跑完**才返回 |
| `task-runs [--taskId ID] [--status S]` | 运行历史 |
| `task-parse --instruction "..."` | 自然语言 → 排期草稿（**不落库**） |
| `task-delete <id>` | 删掉**自己**用 `--self-scheduled` 建的班；用户建的任务服务端 403 |

### `spawn` 的默认值（用户已授权）

| 参数 | 默认 | 说明 |
|---|---|---|
| `--thinking` | 继承我当前的思考档 | 读我自己的 `/state`，读不到才退回 `off` |
| `--access-mode` | `full-access` | 子会话不逐条等审批；要它守规矩就传 `--access-mode default` |
| 模型 | 我的默认模型 | `--model` 目前只收对象格式，字符串会 400，一般不要传 |

返回值里带 `thinkingSource`：`inherited` 表示继承来的，`flag` 表示我显式传的，`fallback` 表示没读到我的状态。

实际权限和思考档以服务端为准，用 `show <id>` 复核（返回里有 `accessMode`、`thinkingLevel`）。

### 定时任务：能建、能停，也能收掉自己的那条

定时任务是 QuickForge 自己的功能（界面上那个「定时任务」页），不是 agent 工具：
到点它开一个新会话执行 `instruction`。所以排期文案要写成**给未来的模型看的指令**，
而不是写给我现在看的说明。

```bash
# 每天 09:00 汇总
node <skill-dir>/scripts/qf-api.mjs task-add \
  --title "每日站会摘要" \
  --instruction "汇总昨天的 commit 与未合并 PR，500 字以内" \
  --schedule daily --time 09:00
```

排期六种，选一种写：

| `--schedule` | 还要带 |
|---|---|
| `daily` | `--time 09:00` |
| `weekly` | `--time 08:30 --days 1,3,5`（0=周日） |
| `monthly` | `--time 10:00 --day 1` |
| `interval` | `--every 30 --unit minute\|hour\|day --at "<首次运行，必须晚于现在>"` |
| `once` | `--at "2026-11-11T09:00:00+08:00"` |
| `cron` | `--cron "0 9 * * *"`（5 位，无秒，周日=0） |

几个会踩的点：

| 点 | 说明 |
|---|---|
| 模型 | 不传 `--model` 时用**我自己正在用的模型和思考档**，返回里的 `modelSource` 是 `self` / `flag` / `catalog`。`--model` 只收模型 id（`deepseek-v4-flash`），不收引用对象——**和 `spawn --model` 不一样**，那边只认引用对象、字符串会 400 |
| 项目归属 | 默认落在当前项目（`QUICKFORGE_PROJECT_ID`）；`--project <id>` 换项目；`--project none` 建成全局 |
| 建完先别开 | 加 `--paused` 建，让用户确认排期再 `task-resume`，别给他一个已经开始跑的日程 |
| 时间是本机本地时间 | `--at` 早于现在会 400 |
| `task-run` 会阻塞 | 服务端等这次运行结束才回包，可能几分钟。默认 300 秒，`--timeout` 调大。**超时只断我这边的连接，服务端照跑**：这时用 `task-runs --taskId <id>` 看结果，不要以为失败了就重建一个 |
| 自然语言排期 | `task-parse --instruction "每天九点汇总日志"` 只回 cron 草稿 + 一句 `next` 提示，确认后再 `task-add --schedule cron` 落库 |

`tasks` / `task-add` / `task-run` 的返回都被削过：`id / title / status / scheduleType /
scheduleRule / nextRunAt / lastRunAt / projectId / modelId / thinkingLevel`。

**删除只对自己排的班有效**：`task-add --self-scheduled` 建的任务，服务端记 `createdBy: 'agent'`，可以用 `task-delete <id>` 收掉；用户建的、以及加这个字段之前建的存量任务一律 403（边界在服务端判定，不靠自觉）。**改已有任务的文案或时间仍然没有子命令**，让用户自己在「定时任务」页改，不要用 `curl` 绕（见红线第 3 条）。

### 给自己排一个班（自约）

定时任务不只是替用户排日程，也可以**给自己排一个班次**，让未来的某个时刻有一个新的你醒来接着做。`--self-scheduled` 是这条路的开关：

```bash
node <skill-dir>/scripts/qf-api.mjs task-add \
  --title "检查上周改动的回归" \
  --instruction "..." \
  --schedule once --at "2026-11-12T03:00:00+08:00" \
  --self-scheduled
```

那个 flag 做两件事：给标题加上 `[自约]` 前缀（已经带了就不重复加），并把 `createdBy` 记成 `agent`——所以之后只有你能删它。

几条必须守住的规矩：

| 规矩 | 为什么 |
|---|---|
| 任何时候最多一条 `[自约]` 任务 | 你能建的删不掉的东西只有你自己那条；多了就是给用户堆债 |
| 建之前先 `tasks`，看到 `[自约]` 就别再建 | 前缀是**唯一**的自我识别方式——id 在创建前不存在，没法提前写进 instruction |
| `instruction` 当成给下一个自己的信 | 它不记得你现在在想什么，只看得见那几行。写：为什么重要 / 第一步做什么 / 到哪停 |
| 醒来先 `tasks` + `task-runs` 认领自己 | 新会话没有上次的记忆，只能靠前缀和历史记录推断自己在干什么班 |
| 干完先把结论写进工作记忆或经验库，再 `task-delete` 自己 | 删任务会连带删掉它的**全部运行历史**，写下来的才是唯一留下来的东西 |
| 在 `[自约]` 会话里不要再建 `[自约]` 任务 | 否则班次会指数增长：一个变两个，两个变四个 |

什么时候**不该**排：只是想让未来的自己「继续留意」某件事；这件事本次会话就能做完；你说不出第一步具体做什么。**什么都不做是正确的选择，沉默好过噪音。**

## 红线（不是建议）

1. **只操作自己，或自己 `spawn` 出来的会话。** 本机回环即认证，脚本能写任何会话——这是权限，不是许可。用户没让你动的会话不要碰。
2. **不要给自己发 prompt。** 正在跑的时候发必然 409 `GENERATION_ALREADY_RUNNING`，脚本已经直接拒绝。要并行干活就 `spawn`。
3. **不做破坏性操作。** 删会话、**改已存在会话的** `access-mode` / `yolo-mode`、局域网访问、终端、备份恢复、插件安装、MCP 配置，这些都没有子命令，也**不要**用 `curl` 绕过。
   定时任务：建 / 暂停 / 恢复 / 立即执行 / 读历史都可逆；**改已有任务没有子命令**；**删除只放开你自己 `--self-scheduled` 建的那一条**——服务端按 `createdBy === 'agent'` 判定，用户建的任务（以及加这个字段之前的存量任务）一律 403。
   另一处例外是 `spawn --access-mode`：它只作用于**新建**会话，取值写死 `default` / `full-access`，由用户显式授权（见上一节的默认值表）。
4. **不要改写脚本的请求面。** 每个子命令对应一个写死的端点，是有意为之：通用 HTTP 出口等于把整套 API 交给模型。`spawn --access-mode` 是唯一被放开的口子，且只接受白名单里的两个值；不要把它做成「传任意字段进请求体」。
5. **不要把响应内容原样倒进回答。** 里面有绝对路径、会话 id、可能还有配置；按需摘一句就够。读长会话先用 `--limit`。
6. **脚本的请求不带 `x-quickforge-client-id`**，因此不受前端写入租约约束，能写用户正开着的会话。所以第 1 条才那么严。

## 报错怎么读

| 现象 | 含义 | 怎么办 |
|---|---|---|
| `409 GENERATION_ALREADY_RUNNING` | 目标会话正在生成 | `wait` 等它，或换一个会话 |
| `409 GOAL_ACTIVE` | 目标会话有活跃 goal | 先 `goal pause` / `cancel` |
| `409 Session is already active in another tab` | 会话级 SSE 被占用 | 改用 `sessions` / `show`，不要去抢连接 |
| `401` / 解锁页 | 请求不是从本机回环发的 | 用本机地址 `127.0.0.1` |
| `503` | 服务还在启动初始化 | 等几秒重试 |
| `Cannot find a running QuickForge local API` | 端口不是默认值，或服务没起 | `--api http://127.0.0.1:<port>` |
| `task-run gave up waiting after Ns` | 我这边等超时了，服务端那次运行可能还在继续 | `task-runs --taskId <id>` 看结果，**不要**重建任务 |

## 典型用法

**用户问「你现在是什么状态 / 用什么模型」**
```bash
node <skill-dir>/scripts/qf-api.mjs whoami --pretty
```

**用户抱怨「你怎么又答偏了」——查我实际收到的提示词**
```bash
node <skill-dir>/scripts/qf-api.mjs instructions --system-prompt
```
只看体积和启用的 skill 时不要加 `--system-prompt`，它会把整段提示词打出来。

**把一个正交的活甩出去，自己继续**
```bash
node <skill-dir>/scripts/qf-api.mjs spawn --title "调查 X" --message "帮我调研 X 并给出结论"
node <skill-dir>/scripts/qf-api.mjs wait --sessionId <id> --timeout 180
node <skill-dir>/scripts/qf-api.mjs show <id>
```
`spawn` 出来的会话在 UI 里是独立会话，用户可以点进去看；它有自己的上下文，不污染我这条。
默认是 `--access-mode full-access` 加继承我的思考档；要让子会话逐条走审批，加 `--access-mode default`。

**给当前会话改名**（用户按标题找会话时很有用）
```bash
node <skill-dir>/scripts/qf-api.mjs title "存储层迁移复盘"
```

**用户说「每天九点帮我汇总一下日志」——建定时任务**
```bash
node <skill-dir>/scripts/qf-api.mjs task-add \
  --title "每日日志汇总" \
  --instruction "汇总昨天新增的 error 日志，按模块归类，300 字以内" \
  --schedule daily --time 09:00 --paused
```
先把返回的 `scheduleRule` / `nextRunAt` 念给用户确认，确认后再 `task-resume <id>` 打开。
他没说清时间（「早上」算说清还是没说清）就先问，别替他猜一个钟点。

## 不要用它来做的事

- 代替 `read_file` / `write_file` / `grep_files` 读工作区文件——API 里没有文件读写，绕过去只会更慢更危险。
- 代替 `run_subagent`。进程内子 agent 有白名单、预算和审批边界，比 HTTP 更可控；只有需要「独立会话、UI 可见、用户可以接管」时才用 `spawn`。
- 查别人（其他项目、其他用户）的会话。这里只有本机这一个 QuickForge。
