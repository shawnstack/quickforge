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
