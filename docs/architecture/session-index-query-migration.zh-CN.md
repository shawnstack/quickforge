# Session Index Query Migration（F7）

## 权威与边界

JSON physical `sessions-metadata.json` 继续是唯一业务权威。F7 只让 `server/routes/storage.mjs` 中一小部分可证明等价的分页列表请求尝试 SQLite；ACP `session/list`、auto-archive、stale reset、backup/restore 与 session 主体读写仍沿用 JSON。

SQL 入口必须同时满足：

- store 为 `sessions-metadata`，index 仅 `createdAt` / `lastModified` / `pinnedAt`；
- `limit` 是十进制正 safe integer，`offset` 缺省或十进制非负 safe integer；
- direction、archive、pinned 和 scope 形态在固定 allowlist 内；
- index 已 initialized、非 dirty/degraded，TTL integrity 的 source/index count+digest 相同；
- source snapshot 可精确投影，且查询无 aggregate duplicate sessionId、无完整排序键 tie。

其他请求保留原 `readIndexedValues()`、`parseInt`、`slice` 与异常边角语义。fallback 是预期正确路径，而不是错误。

## Schema v5

v5 只增加五个查询索引，不修改表和 F5 权威数据：

- scoped global/project：created、modified；
- projects timeline：created、modified；
- aggregate 常用 modified + pinned/archive。

repository 测试用 `EXPLAIN QUERY PLAN` 验证 projects timeline 命中索引。v4→v5 故障在同一 migration 事务回滚，`scheduled_task_runs` 数据和 v4 `session_index` 保持不变。

## Repository 与排序兼容

repository 使用固定 allowlist 生成 WHERE/ORDER BY，不直接拼接用户字段。`listPage()` 在 deferred 事务内执行 `COUNT(*)` 和真正的 `LIMIT/OFFSET`：

- scopeMode：`all/global/project/projects`；
- archive：`exclude/only/include`；
- message count：`message_count IS NULL OR message_count <> 0`；
- pinnedOnly：只匹配服务层已证明为 canonical ISO 的 pin；
- 普通 created/modified 排序始终先 `is_pinned DESC, pinned_at DESC`；
- sort 列沿用旧 JSON 的 asc/desc NULL placement。

不增加 sessionId tie-break。完整排序键相同会 fallback，避免改变 V8 stable sort 对原 JSON 枚举顺序的保留。aggregate `all/projects` 出现重复 sessionId 时 fallback；scoped bucket 可继续 SQL。

## Readiness、兼容性与重建

诊断显式区分 `uninitialized/ready/degraded`，未初始化固定 `dirty=true`、`degraded=true`。摘要包含 source/index count+digest、`lastVerifiedAt`、query compatibility、rebuild generation 与脱敏错误。

source snapshot 检查：

- metadata key/id mismatch；
- physical bucket 与正文 scope/projectId 冲突；
- created/modified/pinned 不是 canonical ISO string；
- archivedAt 非字符串且为 SQLite 投影无法表达的值；
- canonical JSON 与原 metadata 不同。

TTL 后重读 JSON source 并比较 SQLite verification；digest mismatch 或查询/影子失败会标 dirty/degraded，并以 single-flight 后台 rebuild 修复。dirty 期间 route 只走 JSON。

## Shadow 对拍

route 的 sampler 可注入。生产默认低比例采样；每种 query shape 首次、每次 rebuild generation 变化后的首次强制对拍。比较 total、顺序和完整 canonical metadata。mismatch 时当前请求返回 JSON、标记 degraded/dirty、安排 rebuild；日志只记录 operation/reason/error name/code，不记录 title、preview、正文或 project/session ID。

## Benchmark 与验证

`scripts/session-index-query-benchmark.mjs` 默认运行 1k/10k，可传 `50000`。输出 JSON Lines，包括 JSON 耗时、warm SQL 耗时、结果等价性和 EXPLAIN；不进入 runtime，也不使用绝对时间 CI 阈值。

F8 若继续推进，应只在积累实际 fallback/影子诊断后扩大 eligibility；不得直接切 ACP 或删除 JSON fallback。

## F8 之后的定位（2026-08 补充）

F8 把 `session_index` 维护收敛进与 `session_states` 相同的 immediate 事务后，本文的前提已经发生根本变化：

- **保护对象基本消失**：readiness/TTL/dirty/shadow sampler/single-flight rebuild 整套机制是为"JSON 唯一权威 + SQLite 派生索引可能漂移"设计的。权威态下索引与 body/metadata 同事务提交，漂移源不复存在；残余的漂移窗口只剩 pending 相位 mirror drain 前（物理 JSON 镜像滞后于 SQLite）。
- **fallback 语义已变**：权威态下"fallback 回 JSON"这一表述过时。源码实证（设计评审报告附录 A.3）：fallback 路径（`routes/storage.mjs` → `readIndexedValues` → `readStore`）经 facade 路由到 SQLite `exportSnapshot()`（`sqliteReadable()` 门控），读到的是权威新数据而非过期 JSON——fallback 仍是预期正确路径，但数据源已是 SQLite。
- **已知残余问题（性能，非正确性）**：index 就绪判定仍以物理 JSON 镜像为源（`readPhysicalSessionMetadataBuckets`），pending 相位 drain 前 digest 不匹配会频繁降级到"全量导出 + 内存排序分页"路径，大库下有可见开销；fallback 路径 `metadataIndexCache` 另有最长 ~1s 的旧值窗口（低优先）。
- **退役计划**：shadow 对拍 sampler 保留 1–2 个版本作为观察期（积累 fallback/影子诊断）后移除；fallback 机制保留（仍是 degraded 时的正确路径），但其数据源固定为 SQLite 权威快照；readiness/TTL/dirty 机制的简化视观察期诊断另行决策。移除前不得把 shadow 机制的日志/诊断管道一并删除，以免影响可观测性。
- **性能注记（2026-08）**：分页热路径已按权威相位优化（`server/session-index-service.mjs`）：verify TTL 5s→60s；`verifyIntegrity` 并发去重（in-flight 共享，并发等待者拿到同一结果，前端一次刷新的并发分页请求只做一次校验）；`analyzeQuery` 结果按索引内容代际缓存（rebuild/增量同步成功即失效；`limit`/`offset` 不参与缓存键，分析 SQL 不使用它们）；增量同步成功后保留校验时间戳（成功路径已用 `indexedVerification()` 重算 digest，索引与源一致性由构造保证，不再强制下一次分页做全量校验；失败路径仍标 dirty/degraded 并调度 rebuild）。理由：权威相位下索引与状态同事务提交，每请求全量校验是纯开销——大库 2415 会话实测瓶颈在逐行 `JSON.parse`/SHA-256 与全表聚合，分页 SQL 本身亚毫秒。
- 当前架构的单一事实描述见 [`session-storage-current-architecture.zh-CN.md`](./session-storage-current-architecture.zh-CN.md)；本文其余章节保留为 F7 时期的历史决策记录。
