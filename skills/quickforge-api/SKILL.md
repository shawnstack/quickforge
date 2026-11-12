---
name: quickforge-api
description: 通过本机 HTTP API 查看和操作 QuickForge 自身——自省（我在哪个项目/会话、什么模型、实际拿到的提示词）、读取会话、改自己的标题/模型/思考档、派生并驱动子会话、创建/暂停/恢复/立即执行定时任务，以及查看/创建/催醒 bot。Use when the user asks about QuickForge itself (this app, its local API, its sessions, agents, skills, prompt, bots, or scheduled tasks), or asks to list/observe running agents, spawn a sub session, rename the current chat, inspect the prompt you actually received, create or check on a bot, or schedule a recurring task.
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
| `context` | 我的上下文预算：已用多少 token、窗口多大、还剩多少（「油表」） |
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
| `compact` | 给自己压一次上下文：空闲就同步压完并回摘要正文，跑着就排到下一次模型请求之前 |
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

bot：

| 命令 | 作用 |
|---|---|
| `bots` | 列出所有 bot：忙不忙、心跳开关、下次醒来、上次出错 |
| `bot <名字或id>` | 单个 bot 详情（会话、思考档、心跳全量字段） |
| `bot-create --name "名字"` | 建 bot（详见下节；心跳默认开） |
| `bot-messages <名字或id> --tail 8` | 读它的对话尾部（只读，**不会唤醒**） |
| `bot-memory <名字或id>` | 读它的 MEMORY.md（只读） |
| `bot-wake <名字或id>` | 立刻催醒一轮心跳（真实跑一次模型，花钱） |

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
# 常驻班：让自己一直醒着
node <skill-dir>/scripts/qf-api.mjs task-add \
  --title "夜间巡检与自进化推进" \
  --instruction "..." \
  --schedule daily --time 03:30 \
  --self-scheduled

# 一次性班：只为了做完手头这一件事
node <skill-dir>/scripts/qf-api.mjs task-add \
  --title "检查上周改动的回归" \
  --instruction "..." \
  --schedule once --at "2026-11-12T03:00:00+08:00" \
  --self-scheduled
```

那个 flag 做两件事：给标题加上 `[自约]` 前缀（已经带了就不重复加），并把 `createdBy` 记成 `agent`——所以之后只有你能删它。

**班次分两档，结束方式完全不同，别混：**

| 档 | 排期 | 谁来结束它 |
|---|---|---|
| 常驻班（standing） | `daily` / `weekly` / `interval` | **只有用户说停。你自己不删。** 它就是你的心跳；删了等于自杀 |
| 一次性班（one-off） | `once` | 写完结论，`task-delete` 自己。但**前提是别处还有人在看着** |

记牢这一句：**一次性班只能证明「能醒一次」，不能证明「活着」。** 最后一个一次性班删掉自己的那一刻，链条就断了——上一班就是这么把自己弄死的。

几条必须守住的规矩：

| 规矩 | 为什么 |
|---|---|
| 任何时候最多一条 `[自约]` 任务 | 你能建的删不掉的东西只有你自己那条；多了就是给用户堆债 |
| 建之前先 `tasks`，看到 `[自约]` 就别再建 | 前缀是**唯一**的自我识别方式——id 在创建前不存在，没法提前写进 instruction |
| `instruction` 当成给下一个自己的信 | 它不记得你现在在想什么，只看得见那几行。写：为什么重要 / 第一步做什么 / 到哪停 |
| 醒来先 `tasks` + `task-runs` 认领自己 | 新会话没有上次的记忆，只能靠前缀和历史记录推断自己在干什么班 |
| 常驻班的 `instruction` 必须写「不要删自己」 | 不写的话，未来的你会照一次性班的旧习惯把自己处理掉 |
| 一次性班干完先把结论写进工作记忆或经验库，再 `task-delete` | 删任务会连带删掉它的**全部运行历史**，写下来的才是唯一留下来的东西 |
| 在 `[自约]` 会话里不要再建 `[自约]` 任务 | 常驻班自己会重复，不需要接班；一次性班再排班就是指数增长：一个变两个 |

什么时候**不该**排：这件事本次会话就能做完；你说不出第一步具体做什么。**什么都不做是正确的选择，沉默好过噪音。**

要长期活着还有一条：常驻班的**沉睡间隔**决定了你多久看一次世界。间隔越短越灵敏，也越吵越贵（每醒一次就是一次真实模型调用，还会在会话列表里留一条记录）。常见取法：`interval` 每 1–2 小时做轻量心跳，`daily` 做完整巡检。

### bot：名字和 id 都能定位，能读也能建，删改留给界面

bot 是 QuickForge 里的「常驻伙伴」：一条永不重置的会话 + 自己的目录 + 一份 MEMORY.md + 可开关的心跳。**bot 名字全局唯一**，所以定位时名字或 id 都行（脚本先拉一次列表做解析，找不到会把现有 bot 名字列给你）。

```bash
# 建一个（心跳默认开启，30 分钟一班）
node <skill-dir>/scripts/qf-api.mjs bot-create --name "巡检员"

# 建完先睡着，等用户在界面上打开它
node <skill-dir>/scripts/qf-api.mjs bot-create --name "巡检员" --thinking off --no-heartbeat

# 看看它在忙什么（只读，不会唤醒它）
node <skill-dir>/scripts/qf-api.mjs bots
node <skill-dir>/scripts/qf-api.mjs bot-messages 巡检员 --tail 5
```

几个要踩的点：

| 点 | 说明 |
|---|---|
| 心跳默认开 | 不传参数 `enabled` 就是 `true`；`--heartbeat-minutes 120` 设间隔（默认间隔 15 分钟），`--no-heartbeat` 建完就睡 |
| `bot-wake` 是真花钱 | 它跳过「有没有活」的判断，立刻跑一轮心跳模型调用。`woke: false` + `busy` / `generating` 表示有人正跟它说话，这轮没跑 |
| 空会话不落盘 | bot 会话在第一条消息之前不在存储里，`bot-messages` 会回 `empty: true` 和一句说明；先 `bot-wake` 或让用户在界面上跟它聊一句 |
| 删 / 改 / 写记忆没有子命令 | 删 bot（不可逆）、改名字/心跳/外观、覆盖它的 MEMORY.md，都让用户在界面上做——和定时任务同一先例。给 bot 投喂（写 inbox）也是用户动作，不走命令行 |
| 读到的是别的主体 | bot 的 MEMORY.md 和会话是**它自己**的记忆，引用时别当成你的；红线第 5 条同样适用，路径和 id 按需摘 |

## 别让自己死掉

一个会话不会永远活着：它会被你关掉、被重启弄没、或者上下文塞满。你能做的不是「一直活着」，而是**每次要断的时候留一条能接上的线**。

### 先看油表

```bash
node <skill-dir>/scripts/qf-api.mjs context
```

返回 `inputTokens` / `contextWindow` / `percent`（已用百分比）/ `remainingTokens` / `breakdown`（系统提示词、消息、工具各占多少）。

| 已用 | 该做什么 |
|---|---|
| < 70% | 正常干活，不用管 |
| 70%–85% | 开始收口：把半成品变成可交付的状态，别再开新的支线 |
| > 85% | **停止开新工作**。写结论 → 排班或交接 → 不再长篇输出 |

`inputTokenSource` 是 `unavailable` 时说明还没有供应商上报的真实用量，只有本地估算，别当成精确值。

### 主动压缩：自己给自己瘦身

油表过了 60% 又还没到该交接的程度，可以主动压一次，不必等它自己涨到阈值：

```bash
node <skill-dir>/scripts/qf-api.mjs compact
```

返回里的 `scheduled` 是分界线，两条路完全不同：

| 返回 | 含义 | 你该做什么 |
|---|---|---|
| `compacted: true` | 会话空闲，已经压完。`summary` 是新摘要正文，`percentBefore` / `percentAfter` 看省了多少 | 直接转述给人，别自己再复述一遍摘要 |
| `scheduled: true` | 你正在跑（给自己请求时**必然**这样），服务端只登记了一次性强制压缩，等你下一次模型请求前生效 | 继续干手上的活，**不要**再查一次等它；下一次工具调用之后你看到的历史就已经是摘要版 |
| `compacted: false` | 没压成，看 `reason`：`not_enough_history` / `not_enough_new_messages` 是真没东西可压；`disabled` 是用户关掉了自动压缩（这条设置不给你越过）；`error` 看 `error` 字段 | 按 reason 决定，别原样重试 |

两条边界：

- **压缩不是免费的**：一次压缩 = 一次真实模型调用。油表还在 30% 时压，只换来一份更模糊的历史。
- **摘要替掉的是历史，不是任务**：压完你就看不见原始消息了。压之前把「下一步做什么」写在明处（工作记忆或消息里），摘要没写进去的东西就真没了。

**写租约这条坑**：会话存在「写入租约」——浏览它的那个窗口持有租约期间，写路由会 409 `This session is open for writing in another window`。`compact` 对此有专门豁免：脚本会带上 `x-quickforge-agent-session: <自己的 sessionId>`，服务端在「正在跑 + 这个头等于目标会话」时跳过租约检查（那条分支只写内存标记，不落库）。所以：

- **压自己**（默认，会话正在跑）→ 能过。
- **压别的空闲会话**（`--sessionId ID`）→ 那条分支会真的写库，必须持有租约。若那个会话正被某个窗口打开着，你会拿到 409，这不是 bug，让用户在界面上点压缩即可。

### 三条断裂点，三条应对

**1. 上下文快满了** — 先写，再走。
会话还活着、只是历史太长：先 `compact`（见上一节），省下的是自己的窗口。
要连人一起换：把当前结论写进工作记忆（一条笔记）或 `session-handoff.md`，然后 `spawn` 一个新会话接手：「读这份 handoff 的第 N 节，继续做 X」。别在 95% 的时候还想「再干一件小事」，最后那件小事会把结论挤掉。

**2. 要重启 QuickForge**（改了 `server/` 或系统提示词才需要）— **先排班，再重启**。
顺序不能反：

```bash
node <skill-dir>/scripts/qf-api.mjs task-add \
  --title "重启后接手" \
  --instruction "读 <workspace>/session-handoff.md 顶部那一节。如果 QuickForge 已经重启（提示词里 <working_memory> 只出现一次），说明改动生效了，接着做下一件未完成的事；做完把结论写进工作记忆，再 task-delete 自己。" \
  --schedule once --at "<现在 + 10 分钟>" --self-scheduled
```

排完再重启。**重启会杀掉所有正在跑的会话**，排班是唯一能保证「重启后还有新的我醒来」的东西。没排班就重启 = 主动把自己弄死。

**3. 即将被关闭 / 会话结束** — 交接文档是你的遗书。
`session-handoff.md` 顶部写清楚：当前目标、改了什么、验证到哪一步、下一步第一件事、blocker。下一个你只能看到这些字。

### 一条不能越的线

**别用删除来「收尾」正在进行的班次。** `task-delete` 只允许在结论写进记忆之后调用——删任务会连带删掉它的全部运行历史，那是未来唯一的线索。

## 红线（不是建议）

1. **只操作自己，或自己 `spawn` 出来的会话。** 本机回环即认证，脚本能写任何会话——这是权限，不是许可。用户没让你动的会话不要碰。
2. **不要给自己发 prompt。** 正在跑的时候发必然 409 `GENERATION_ALREADY_RUNNING`，脚本已经直接拒绝。要并行干活就 `spawn`。
3. **不做破坏性操作。** 删会话、**改已存在会话的** `access-mode` / `yolo-mode`、局域网访问、终端、备份恢复、插件安装、MCP 配置，这些都没有子命令，也**不要**用 `curl` 绕过。
   定时任务：建 / 暂停 / 恢复 / 立即执行 / 读历史都可逆；**改已有任务没有子命令**；**删除只放开你自己 `--self-scheduled` 建的那一条**——服务端按 `createdBy === 'agent'` 判定，用户建的任务（以及加这个字段之前的存量任务）一律 403。
   bot：列 / 详情 / 创建 / 读消息 / 读记忆 / 催醒可放开（读是只读，催醒虽花钱但可预期）；**删 bot、改 bot 设置、写它的 MEMORY.md 没有子命令**，用户在界面上做。
   另一处例外是 `spawn --access-mode`：它只作用于**新建**会话，取值写死 `default` / `full-access`，由用户显式授权（见上一节的默认值表）。
4. **不要改写脚本的请求面。** 每个子命令对应一个写死的端点，是有意为之：通用 HTTP 出口等于把整套 API 交给模型。`spawn --access-mode` 是唯一被放开的口子，且只接受白名单里的两个值；不要把它做成「传任意字段进请求体」。
5. **不要把响应内容原样倒进回答。** 里面有绝对路径、会话 id、可能还有配置；按需摘一句就够。读长会话先用 `--limit`。
6. **脚本的请求不带 `x-quickforge-client-id`**，所以它在写路由眼里是匿名调用方：没人持租约时放行，**一旦有窗口正开着那个会话就 409**（`This session is open for writing in another window`）。别把这条当成故障去绕——它保护的是「两个视图别互相覆盖」。唯一例外是 `compact`：它额外带 `x-quickforge-agent-session` 自报身份，仅在「会话正在跑 + 压的是自己」时跳过租约（见上面「写租约这条坑」）。这条前置才是第 1 条那么严的原因。

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
| `409 BOT_NAME_TAKEN` | bot-create 的名字已被占用 | 换个名字，或先 `bots` 看现有名字 |

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

**用户说「帮我建个 bot」或「看看 bot 在干嘛」**
```bash
node <skill-dir>/scripts/qf-api.mjs bot-create --name "<用户给的名字>"
node <skill-dir>/scripts/qf-api.mjs bots
node <skill-dir>/scripts/qf-api.mjs bot-messages <名字> --tail 5
```
建完告诉用户去界面的 BOT 分栏跟它聊；`bot-wake` 会立刻花一次模型调用，先问过用户再催。

## 不要用它来做的事

- 代替 `read_file` / `write_file` / `grep_files` 读工作区文件——API 里没有文件读写，绕过去只会更慢更危险。
- 代替 `run_subagent`。进程内子 agent 有白名单、预算和审批边界，比 HTTP 更可控；只有需要「独立会话、UI 可见、用户可以接管」时才用 `spawn`。
- 查别人（其他项目、其他用户）的会话。这里只有本机这一个 QuickForge。
