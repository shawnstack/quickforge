# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：记忆体系整体设计评审（2026-11-18）

- 目标：用户要求评审当前项目记忆设计，指出过度设计与不足。全程只读，未改代码。
- 方法：读 `docs/architecture/memory-system.zh-CN.md` + explore 调研实现规模（服务端约 3200 行 / 测试约 2440 行 130 例 / 前端约 1560 行 / 18 个 API 端点）+ 实测 `~/.quickforge/memory` 与 `dreaming_runs` 真实数据（28 轮成功 / 427 会话 / 626 新建 / 33 改写 / 106 归档；notes 活跃 173、_archive 14；experiences 105 条、index 108 行；MEMORY.md 632 字节）+ 抽样阅读产出质量。
- 结论（详版见 progress.md Notes 与评审回复）：
  - 过度设计：`experiences/index.md` 生成机器（上限/重建/掉出策略）仍在维护，但系统提示词已不再注入索引全文，消费者只剩设置页；`move_memory_note` 改名顺手改 title 的 `titleSynced` 三态引入了「改名后笔记写不进去」的新软失败态。
  - 不足：① 提示词/工具耦合 bug——`<experiences>` 块无条件注入并指名四个记忆工具，工具却受 `isWorkingMemoryEnabled()` 门控（工作记忆默认关），本会话实测提示词指路一个不存在的工具；② 容量无解——notes 173/200、experiences 105/200 两处都按 mtime 静默截断，写入不设限，约一个月撞线，且缺 `search_memory_notes` 之类检索面；③ 文档漂移——memory-system.md §4/§5 与 system-prompt.mjs:148-160 实现不符。
- 改动文件：仅 `progress.md`（Notes 记录三条待修缺陷）、本文件。未改源码、未 commit、未新增依赖、未改生成产物。
- 验证：评审为只读任务，未跑 test/lint/build；引用的实现事实均经 read_file/grep 复核（其中 explore 报告的「pruneSnapshots 未接线」有误，实际 runner.mjs:223 有调用）。
- Blocker：无。
- 下一步：若用户认可，按优先级修 —— ①解耦读工具挂载与工作记忆开关（或让注入块跟随工具可用性）；②加记忆检索工具 + 整理员合并配额；③索引机器二选一（真注入 or 拆掉并同步文档）。

