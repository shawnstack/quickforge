# Session Handoff

## 当前状态

- 本会话目标：评审"对话记录迁移到 SQLite"整体设计（缺陷/性能/UX），并**全部实施**评审报告 §7 的 10 条建议。
- 最终状态：**11 个 feature 全部 done**（10 个 review-* + review-switch-sqlite-synchronous-full），全量验证通过：`npm run test` 211 文件 1748 测试全过、`npm run lint` 0 错误（1 个预存 warning `server/cloud/identity.mjs:92`）、`npm run build` 通过。**所有改动未 commit。**

## 本会话产出（未 commit）

- 评审报告：`docs/architecture/session-sqlite-migration-design-review.zh-CN.md`（含附录 A 三个存疑点源码实证）+ `docs/architecture/assets/session-sqlite-write-path.svg`。
- 核心存储修复/优化（`server/sqlite/session-state-repository.mjs`、`server/session-state-service.mjs`）：split 中部编辑采样校验（+split body 双重表示预存 bug 修复）、append IN 分批去重、readLastMessage 替深 OFFSET、WeakMap 语句缓存、drain 合并/取代跳过、mirror 死信（MIRROR_MAX_ATTEMPTS=12）、无 id 消息整批重试去重、墓碑 GC 语义固化。
- persist 冲突表面化（`server/agent-manager.mjs`、`src/lib/server-agent.ts`、`src/components/chat/panel-decoration/persist-degraded-notice.ts` 等）：persistDegraded 标记 + SSE 事件 + 前端警告条，成功自动清除。
- synchronous 切 FULL：`scripts/sqlite-synchronous-benchmark.mjs` 实测定案（小事务 1.86x 但均次仅 +0.46ms，批量 ≈1.0x）→ `server/sqlite/database.mjs` 落地 + foundation 文档 §3.1 记录决策与回退条件。
- fail-closed 恢复通道：`server/startup-state.mjs` STARTUP_RECOVERY_GUIDANCE + `server/index.mjs` 接入 + `src/App.tsx` 错误页 pre-wrap + 一页式 runbook `docs/architecture/session-storage-recovery-runbook.zh-CN.md`。
- 权威相位 index 就绪判定切 SQLite 源：`readSessionMetadataBuckets`/`readAuthoritativeSessionMetadataBuckets`（`server/session-state-service.mjs`、`server/storage.mjs`、`server/index.mjs`、`server/acp/server.mjs`）；digest 口径天然同构未动体系。
- 加固（`server/session-state-cutover.mjs`、`server/session-state-backup.mjs`、`server/routes/storage.mjs`）：恢复路径备份复核（verifyRegisteredCutoverBackup）、POST /api/storage/maintenance/verify-session-integrity（full 逐行校验）、restore/roll-forward 后 checkpointWal。
- 文档：新增 `session-storage-current-architecture.zh-CN.md`（单一事实源，F2-F8 降级为历史决策记录）+ phase 状态机 SVG；F8 文档修正启动链描述/补 downgrade 回退边/mirror 定位/digest 指纹警示；F7 文档追加退役计划；wiki server/README 同步。
- 测试：新增/扩展约 20 个用例，分布在 session-state-*/session-index-*/startup-maintenance-gate/agent-manager.persist/session-state-backup/storage.session-state-facade/server-agent 等测试文件。

## 已知取舍与范围外遗留

- persistDegraded 仅内存标记，重启不恢复（语义合理：重启后存储状态本身一致）。
- 备份复核检测首尾/包络损坏，不含文件中段 bit-rot（登记时未存文件 sha256，改登记语义属范围外）。
- 无 id 消息去重的保守边界：与库尾完全相同的单条新消息会被判为重试跳过（代码注释与测试已记录）。
- 其余遗留同前（详见 progress.md）：⑤门禁豁免不一致、⑥backupFile 复用旧快照、P2 减 pass 快照方案、"彻底不碰 JSON"、前端 dispose 通知、agentSessions LRU、SQLite 大事务拆分等范围外候选。

## 最近提交

- 本会话及上一会话（fix-startup-cutover-replay digest 修复三连）改动均未 commit。
- 此前：rebase 后包含远端 3 个修复提交（sidebar/font/metadata-delete）+ 语句复用 / 维护窗口 2 个提交，详见 `git log --oneline -6`。

## Next step

- 择机 commit 本轮全部改动（可按主题拆分：digest 修复 / 评审实施 / 文档）。
- 真实库（2.8GB WAL、约 2415 会话、`session_storage_state` 仍为 `json_authoritative`）下次启动验证：cutover 一次性成功晋升 sqlite authoritative（进度页约 1-2 分钟）且 WAL 被 TRUNCATE 回收；成功后择机手动清理 `conversations` 下 1045 个 `.tmp` 残留（2.75GB，非代码）。
- 发布 patch 版本前完整运行 `npm run test`、`npm run lint`、`npm run build`，按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行。
