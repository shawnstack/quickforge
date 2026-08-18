# Session Handoff

- Feature: Session cutover 全链路流式化（session-cutover-streaming-migration，依赖并叠加 session-cutover-metadata-orphan-tolerance）
- Status: **done**（实现、测试、文档、状态文件完成；未 commit）

## 当前目标（已达成）

孤儿容忍修复后用户环境（2507 会话 JSON / 1.6GB，最大单会话 46MB）实测仍在迁移第一遍全量快照构建即 OOM（exit 134，phase 表时间戳停在迁移前，证明死在 readPhysicalSessionStateBuckets 全量加载）。本 feature 把迁移链路全流式化：内存上界 = 最大单会话 + 小累加器，不再随库规模线性增长。

## 改动文件

- `server/sqlite/session-state-repository.mjs`：replaceAllStream（单事务流式导入，逐条 digest line 累加，expectedCount/Digest 事务内校验，失败整体回滚，mirrorDeletes 增量 key 冲突检测）；verifyIntegrity quickCheck:true 改纯 SQL（sqlIntegrityCounts 共享提取，lightweight:true、digest:null；完整校验不变）；listMirrorQueue({limit}) 分页 + countMirrorQueue()。
- `server/session-state-service.mjs`：drainSessionJsonMirror 分页（MIRROR_DRAIN_BATCH_LIMIT=8，整批零确认即停防死循环，pending 走 COUNT）；getSessionStateDiagnostics 轻量化。
- `server/session-state-cutover.mjs`：normalizeSessionEntry 单源逐会话规范化（buildSessionJsonSnapshot 复用，行为不变=parity 锚点）；createStreamingSessionSource(fsAdapter) 流式源工厂（每 pass 独立 {iterate,getSummary}）；createReadBucketsSessionSource 注入兼容；writeCutoverBackupStream 流式备份（v1 形状不变、写侧 sha256+分块重读复核+首尾字节校验）；主流程 4 pass + replaceAllStream + mirrorDeletes(orphanDeletes)；quickCheck 适配（digest 用持久化 current.digest）；verifyIntegrityWithIndexSelfHeal 保留。
- `server/storage.mjs`：createPhysicalSessionStateFsAdapter()（包装 listProjectIds/listSessionDataFiles/sessionDataFile/sessionStoreFile/readJsonFile）。
- `server/session-state-backup.mjs`、`server/maintenance/export-session-state-v1.mjs`、`downgrade-session-state-v1.mjs`：移除与轻量 digest(null) 的交叉比对（保留 ok+count 校验，digest 由 exportSnapshot 自算）。
- 测试：repository +5、service +2、cutover +5（parity/流式 e2e/pass2 不稳定/备份损坏自检/孤儿流式），lifecycle/cutover fail-closed 用例改 active tombstone 损坏（quickCheck 不再逐行重算 digest 的语义调整）。
- 文档：docs/architecture/session-state-transactional-storage.zh-CN.md（流式导入/quickCheck 轻量/mirror 分页/4 pass/备份字节哈希校验）、docs/wiki/server/README.md。
- `feature_list.json` / `progress.md` / `session-handoff.md`：状态更新。

## 验证结果

- `npm run test`：**205 文件 / 1667 项 100% 通过**（发布硬门禁满足）。
- `npm run lint`：通过。
- `npm run build`：通过（仅既有 KaTeX 字体/大 chunk warning）。
- node --check、目标 ESLint 0/0（subagent 批次内）。

## 边界确认

- 未触碰 `dist/`（build 生成）、`package-dist/`、`package-offline/`；未新增依赖；未 git commit。
- 工作区还有其他会话的未提交改动（context-usage.mjs、chat-utils.ts、auto-compaction.test.mjs 等），提交时须限定文件。

## Blockers

- 无代码 blocker。

## Next step

- **用户环境实测**：`qf start`（工作区 D:\quickforge 新代码）首次迁移——多遍磁盘读 + SQLite 写入耗时较长属预期（health 等待已放宽 5 分钟）；成功后 `session_storage_state.phase=sqlite_authoritative`、session_states≈2426 行、21 孤儿条目从列表消失；二次启动应秒级且内存正常。桌面版仍带旧代码，需发布新版或继续用 qf。
- 迁移成功后首次 drain 会重写全部会话 JSON 镜像（2507 文件，分批进行），属一次性。
- 若实测仍有问题：查 server 日志 + `session_storage_state.diagnostic_json`。
- 发布前重跑 test/lint/build（本次已全绿）。
