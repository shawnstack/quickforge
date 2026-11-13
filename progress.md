# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 工作台 TODAY 统计带（2026-11-13 22:06）

- 需求：用户问「还有哪些信息可以展示」，否掉会话回收（内部机制），点名「今日的会话次数」。调研确认数据全现成后按推荐落地：通告与主区之间一条恒暗仪器带 `今天 TODAY · 会话 N · TOKEN X · 任务 N 成功率 Y%`。
- 实现：新增 `src/lib/workbench-today-stats.ts`（startOfToday / summarizeTodaySessions / formatTokenCount 纯函数 + fetchTodayStats 分源降级）；Workbench load 并行拉取渲染统计带；i18n 4 键 en/zh；CSS 恒暗仪器条（铂金数字 + 翡翠标签）。零服务端改动。
- 数据源：会话/token 走 `GET /api/storage/sessions-metadata/index/lastModified` 倒序翻页到本地零点；**实测发现索引两条路径返回的都是扁平 metadata（usage 在顶层，非 metadata.usage）**，首版按嵌套写导致 token 恒 0，已修。任务走 `/api/scheduled-tasks/runs?status=success|failed&pageSize=1` 取 total（startedFrom/To 为 UTC ISO，与库内 startedAt 同基准）；成功率只算已完成运行。
- 验证：新增 tests/frontend/workbench-today-stats.test.ts 10 例；tsc -b 净 + eslint 净 + build 绿 + 全量 550 文件 6167 例绿 + check:wiki 292/292 bad=0（i18n 4663→4671）。隔离库注入真实用量/成功运行后 Electron offscreen 复测：DOM 与独立重算逐格一致（会话 19 / 61.1K / 任务 21 / 10%），恒暗/铂金/翡翠/亮色仍暗/窄屏单行无溢出全过，零 console/page error；截图目视确认。服务与孤儿进程已清理。
- Notes：① token 是「今日活跃会话」累计用量近似（usage 按会话累计、无按日切片），界面不冒充精确按日统计；② 提交范围含已提交 feature 遗留的状态/wiki 行数补记（sidebar 14:56 段、wake 14:38 追加、wiki src/README App.tsx 1594→1602 与 lib 123→124），合为一个 commit。

