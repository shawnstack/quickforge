# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## quickforge-api skill 增加 bot 六件套子命令（2026-11-12 02:20）

- 需求（用户原话）：「bot 的创建 api skills 有么」「也可以读取其他的bot的状态和消息 的功能我希望」→ 范围经确认：六件套（含催醒 wake），名字和 id 都能定位。
- 改动：`skills/quickforge-api/scripts/qf-api.mjs` 新增 bots 段——`bots`（列表）/ `bot`（详情）/ `bot-create`（创建，`--thinking` `--model` `--heartbeat-minutes` `--no-heartbeat`）/ `bot-messages`（读对话尾部，复用只读 session view 不唤醒，content 为 parts 数组时拼 text 段做 preview，空会话 404 转 `empty: true` 提示）/ `bot-memory`（只读，不回 `file` 绝对路径）/ `bot-wake`（催醒，返回带花钱提示）；名字→id 解析先拉一次 `GET /api/bots`（名字全局唯一）。
- 白名单裁决（记入架构文档 §4.1）：读全放开；`bot-create` 放开（加法、界面可删）；`bot-wake` 放开但 SKILL.md 要求先问用户（真实模型调用）；`DELETE` / `PATCH /api/bots/:id` 与 `PUT /api/bots/:id/memory` 不进白名单（不可逆 / 改用户配置 / 覆盖他人记忆）。
- 文档：SKILL.md（description、命令表、bot 小节、红线 3、报错表 BOT_NAME_TAKEN、典型用法）；references/endpoints.md（只读表 4 行 + Bot 段 + 禁止表 3 行）；docs/architecture/quickforge-api-skill.zh-CN.md §4.1 裁决；docs/architecture/bot-proactivity.zh-CN.md §4.3 表述修正（「不做 bots 子命令」→「不做投喂子命令」+ 追注）；docs/wiki/server/bots.md §6 加 skill 入口说明。
- Evidence：`node --check` 通过；`npx eslint skills/quickforge-api/` 0 problems；vitest `runtime-info`（10 例，脚本黑名单断言未破）+ `skills`（5 例）全过；本机实测 5/6 命令全通过（含建测试 bot「qf-api自测」验证 `--no-heartbeat` 生效与空会话分支）；`bot-wake` 未实测——真实跑一轮模型花钱，POST 链路与其余命令一致。
- Notes：①同一窗口的并行会话已落地 bot-proactivity 阶段 1+2（inbox 端点、催醒按钮、[报告] 通知），与本 feature 无代码交集，三处文档交叠已核对共存；②测试 bot「qf-api自测」留在 BOT 列表（心跳关、睡着、零 token），用户可在 BOT 分栏设置里删；③skill 脚本即时生效（每次 run_command 都从磁盘起进程），但 SKILL.md 说明文本要新会话激活 skill 才拿到新版，无需重启 QuickForge。

