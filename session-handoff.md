# Session Handoff

## 当前状态

- 本会话（已 rebase 整合远端并行会话改动后推送）完成 3 个 feature，与远端并行会话的 `fix-startup-cutover-replay`（digest 排序修复）在同一批 cutover 文件上自动合并成功：
  1. `optimize-cutover-statement-reuse`：4 域 cutover 导入循环内语句复用（SQL 提取为常量 + 可选 statement 参数，行为/事务语义不变）。
  2. `fix-cutover-startup-bugs`（P0 四项）：scheduled-runs 偷锁补 expires_at 双条件；retainedMaintenance 正常释放分支复位；authoritative 分支 JSON mirror 损坏降级不阻止启动 / SQLite health 失败保持 fail-closed；3 个 cutover 模块补关键日志 + 启动链失败 flushLogger。
  3. `startup-maintenance-window`（P1）：listen 提前（listen 前仅 ensureStorage+SQLite），其余启动链后台执行；维护 gate（白名单 /api/health、/api/migration-status，其余 /api/* 503+Retry-After，静态放行）；新模块 `server/startup-state.mjs`；fail-closed 从"进程退出"改为"服务存活拒绝业务 API"；前端 migration-status.ts + useAppBootstrap 迁移门 + MigrationProgressView + i18n。新版首次启动 1-2 分钟迁移期间用户看到进度页而非静默。
- 远端并行会话（rebase 带入）：字体滑块 RAF 合并、归档删除 batch 修复 + 删除前 destroyAgent 堵复活、侧栏列表高度，共 3 个提交；其状态文件还描述了 `fix-startup-cutover-replay`（digest 排序修复），但**该修复代码未推送**（不在库中），待该会话提交后整合。
- 验证：本会话全量 `npm run test` 209 文件/1709 用例、`npm run lint`、`npm run build` 通过；rebase 整合远端 3 个提交（sidebar/font/metadata-delete 修复）后重跑全量验证再推送。
- wiki 已同步：`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`。
- feature_list.json / progress.md / session-handoff.md 已同步。

## 最近提交

- 见 `git log --oneline -6`：rebase 后包含远端 3 个修复提交 + 本会话 2 个提交（perf(sqlite) statement reuse / feat(startup) maintenance window）。

## Next step

- 无待办 feature。新需求先登记进 feature_list.json 再推进（One Feature at a Time）。
- 发布 patch 版本（用户数据侧高价值）：新版包含 digest 排序修复 + 维护窗口进度 UI，首次启动会一次性完成 cutover（预计 1-2 分钟，期间显示进度页），之后启动恢复秒级；发布前完整跑 test/lint/build，按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行。
- 用户数据遗留（择机清理，非代码）：`conversations` 下 1045 个 `.tmp` 残留共 2.75GB 可手动删除；WAL 2.8GB 待新版 cutover 成功后自动 TRUNCATE 回收。
- P1 已知取舍（择机迭代，详见 progress.md）：迁移轮询网络抖动落错误卡片需手动 Retry；WebSocket upgrade 未 gate；failed 时 CLI spawn 5 分钟超时表现；MigrationProgressView 无渲染测试（仓库无先例）。
- cutover 遗留候选：⑤门禁豁免不一致、⑥backupFile 复用旧快照；P2 减 pass 快照方案（数量级提速，独立立项）；"彻底不碰 JSON"（session_index 权威源/metadata 驻留/mirror outbox，独立 feature）；桌面端首屏 6.5MB modulepreload 计入可见时间（独立遗留项）。
- restore/内存问题剩余候选：前端 dispose 通知服务端提前回收、agentSessions LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 其他范围外遗留（详见 progress.md）：loadMore 无 loading 守卫、`server/cloud/identity.mjs:92` lint warning、ChatSidebar 删除定时器共享 ref、删除-restore 竞态需 tombstone。
