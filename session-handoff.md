# Session Handoff

## 当前状态

- 本会话目标：存储 v2 改造收尾——文档同步 + 项目簿记 + 完整验证门（重构主体由前序会话完成）。
- 最终状态：**会话存储 v2 全部完成，全绿**：`npm run test` 210 文件 1729 测试全过、`npm run lint` 通过（仅既有 `server/cloud/identity.mjs:92` warning）、`npm run build`（tsc -b + vite build）通过。**所有改动未 commit。**

## 存储改造要点（速览）

- schema v11 三表：`sessions`（小行：提升列 + body_json/meta_json，无巨列）、`session_messages`（逐行 append-only，`UNIQUE(…, message_id)` + FK CASCADE + 行级 digest）、`session_tombstones`（极小墓碑）；旧 6 表 RENAME `*_v10_backup` 保留。
- 写入：save 统一抽取 messages；service 增量计划（body-only/replace/append，尾 digest + 中部采样校验）；单事务 CAS。旧设计同一数据写 ≈5 份（巨列全量重写 + session_index + mirror outbox + JSON 物化 + 自由页不回收，实测库 2~3GB）→ v2 每条数据 1 份。
- 删除：FK 级联 + 墓碑 + `incremental_vacuum(512)`（`auto_vacuum=INCREMENTAL`，仅新库生效）。
- 启动：会话域恒 SQLite authoritative；空库 + JSON 文件存在 → `importSessionStateFromJson` 一次性幂等导入（每会话一事务、JSON 只读）。
- 删除的机制：JSON mirror 全链、phase 状态机、`session_index` 派生表、cutover 与 background-migration 两模块、写屏障；维护锁迁出为 `server/session-state-maintenance.mjs`；`downgrade` 工具重写为纯导出。
- 单一事实文档：`docs/architecture/session-storage-v2.zh-CN.md`。

## 本会话改动文件（收尾部分）

- 新增 `docs/architecture/session-storage-v2.zh-CN.md`（v2 单一事实文档）。
- 更新 `docs/architecture/session-storage-current-architecture.zh-CN.md`（标注为 v1 历史参考 + 指向 v2）、`docs/architecture/session-storage-recovery-runbook.zh-CN.md`（顶部 v2 修订提示：恢复=备份 restore 或删库重导，无"降级回 JSON 权威"）、`docs/architecture/sqlite-storage-foundation.zh-CN.md`（§4 补 v11 一段）、`docs/wiki/server/README.md`（存储层/repository 契约段全面更新为 v2 现状）。
- 簿记：`feature_list.json`（+`session-storage-v2` done）、`progress.md`、`session-handoff.md`（本文件）。
- （重构主体的代码/测试改动见 `git status`，约 70 文件：migrations/database/session-state-repository/session-state-import(新增)/session-state-service/session-state-maintenance(新增)/session-index-*/storage/agent-manager/index/startup-state/session-state-backup/routes/维护工具 + 删除 cutover、background-migration 两模块 + 约 40 个测试文件重写/删除。）

## 用户下一步操作（测试机）

1. 部署新版后，关闭所有 QuickForge 进程；
2. 删除 `~/.quickforge/storage/quickforge.sqlite3`（连同 `-wal`/`-shm` 三件套一起删）；
3. 重启——空库 + JSON 会话文件存在时启动链自动一次性重导（维护窗口内，`/api/*` 短暂 503 后 READY）；
4. 观察新库体积（旧 JSON 布局的巨列放大消失）与启动耗时；后续删除会话应能看到库文件缩小。

注意：不删库文件也能跑（v11 直接在旧库上 RENAME 建新表），但旧库没有 `auto_vacuum` 增量回收、`*_v10_backup` 旧体积也仍在文件里——要验证空间回收必须走删库重导路径。

## 已知取舍（详见 v2 文档 §8）

- `listPage` 的 `lastModified` 排序走 `json_extract(meta_json)`（temp b-tree 排序；EXPLAIN 已验证 scope 过滤走 `idx_sessions_list`）。
- 删除后同 key CAS 的 `actualRevision` 报 0（墓碑无 revision；stale 写仍 409、fresh 重建仍成功）。
- `repository()` 先求值 `getSqliteStorage()`：注入 repository 的测试仍需 SQLite 已初始化（S2b 疑点，未构成实际问题）。
- `auto_vacuum` 仅新库生效；升级用户需删库重导才获得空间回收。
- 备份信封 `sessionState { phase, count, digest }` 不变（phase 恒 `authoritative`），旧 v1 备份可正常恢复。

## 下一步候选

- `*_v10_backup` 六表清理：v2 稳定运行观察期（真实大库验证 + 至少一个 patch 发布）后，以独立 migration DROP 回收空间。
- `lastModified` 表达式索引（`json_extract(meta_json, '$.lastModified')`）消除列表排序 temp b-tree。
- `repository()` 注入疑点拆分（见上，供纯内存 repository 测试）。
- share / lan-access 域 mirror/cutover 链的同类 v2 化候选（本次明确不动）。
- 工作区清理：根目录遗留 `.vitest-*.txt`（13 个未跟踪的测试输出残留），建议删除或加入 `.gitignore`。

## 最近提交

- 本会话改动未 commit；之前批次提交状态见 `git log --oneline` 与 progress.md。

## Next step

- 择机 commit（重构主体 + 收尾文档/簿记可分两个 commit 或合一）。
- 测试机删库重导验证（见上「用户下一步操作」）。
- 发布 patch 版本前按 `docs/architecture/patch-release-runbook.zh-CN.md` 完整运行 test/lint/build。
