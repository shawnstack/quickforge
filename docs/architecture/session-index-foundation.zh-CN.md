# Session Index Foundation（F6）

## 目标与边界

F6 为会话列表元数据建立可重建的 SQLite 索引，但不切换任何业务权威或查询入口：

- JSON `sessions-metadata.json` 仍是唯一权威；现有 Storage metadata route 与 ACP `listSessions` 继续读取 JSON。
- `session_index` 仅是可删除、可重建的派生索引，不进入 backup；恢复流程不依赖索引。
- SQLite 文件同时保存 F5 已权威化的 `scheduled_task_runs`，因此不能为重建 session index 而删除整个 `quickforge.sqlite3`。
- F6 不新增 route，不实现 F7 的 SQL 会话分页/过滤切换。

## 物理数据源

scope 由真实文件路径决定，不能信任 metadata 正文中的 `scope/projectId`：

```text
<dataDir>/storage/conversations/global/sessions-metadata.json
<dataDir>/storage/conversations/global/sessions/<sessionId>.json
<dataDir>/storage/conversations/projects/<projectId>/sessions-metadata.json
<dataDir>/storage/conversations/projects/<projectId>/sessions/<sessionId>.json
```

`storage.mjs` 的 `readPhysicalSessionMetadataBuckets()` 只读取这些 metadata 文件，不扫描配置凭据或安全目录。任一 metadata 文件 JSON 损坏时，启动初始化降级并保留旧索引，不执行清空。

## Schema v4

`session_index` 使用 `(scope, project_id, session_id)` 复合主键。global bucket 在数据库中以空字符串 `project_id=''` 表示；project bucket 要求非空 project ID。表保存：

- 可查询列：`created_at`、`last_modified`、`message_count`、pin/archive 时间与布尔位、`state_version`；
- 完整 canonical metadata 对象 JSON；
- 单行 SHA-256 `metadata_digest` 与 `indexed_at`；
- scope/project created、modified 索引，以及 pinned/archived partial indexes。

同一 `session_id` 可同时存在于不同 physical bucket；诊断会统计跨 bucket 重复 ID，但复合键不会冲突。

## Canonical 与 digest

服务按 key 排序 canonicalize metadata，并用真实 bucket 覆盖 `id/scope/projectId`。单行 digest 覆盖完整 canonical metadata，因此 pin/archive、仅 `stateVersion` 或未知字段变化都会触发同步，不以 stateVersion 大小阻挡写入。aggregate digest 对 `(scope, projectId, sessionId, metadataDigest)` 排序后计算。

## 启动与重建

Server 在 `resetStaleTaskStatuses()` 后、runner/listen 前初始化；ACP 在 SQLite 初始化后、创建 agent 前初始化。

1. 读取所有 physical metadata buckets 并生成 source snapshot。
2. 比较 SQLite `count + aggregate digest`。
3. 不同则用 repository 单事务 `replaceAll`。
4. 再读 JSON source 与 SQLite verification；源在重建期间变化时有限重试。
5. 任一 malformed source、SQLite 错误或持续变化会标记 dirty 并降级，但不阻止 JSON 业务。

## 增量同步

`storage.mjs` 在两个中央 JSON 成功提交点调用注册 hook：

- `atomicSessionMetadataUpdate()`：单 physical bucket previous/next；
- bulk `writeSessionStore('sessions-metadata')`：对所有实际写入/清空的 physical buckets 分别提供 previous/next。

hook 在初始化前为 no-op。SQLite 同步失败不会回滚或改变 JSON 返回结果，只标记 dirty；后续启动或显式 rebuild 可恢复。日志只记录 operation、scope、是否 project 和错误 name/code，不记录 title、preview 或 metadata 正文。

## Backup 与恢复

backup version 和字段保持不变，仅包含 JSON sessions 与 sessionsMetadata，不包含 `session_index`。缺失/incomplete metadata 的 fallback 可从 session JSON 复制 `stateVersion`。恢复先提交 JSON，再由中央 bulk hook best-effort 同步；即使索引不可用，恢复结果仍由 JSON 决定。

## F7 查询迁移

F7 在 v5 仅增加查询索引，并让 storage sessions metadata route 对严格 eligible 的分页请求尝试 SQL `COUNT + LIMIT/OFFSET`。JSON 仍是权威；readiness/digest/source compatibility、duplicate sessionId、完整排序键 tie、repository/shadow mismatch 或任意 legacy 参数都会回到原 `readIndexedValues()`。详见 [Session Index Query Migration](session-index-query-migration.zh-CN.md)。ACP、backup、auto-archive、stale reset 与 session 主体没有切换。

## F8 下一步

F8 才可根据 F7 的真实 fallback/影子诊断评估扩大查询覆盖；必须继续保留 JSON fallback、复合 bucket 语义和 backup 独立性。
