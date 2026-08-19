# Session Handoff

## 当前状态

- 本会话目标：将 JSON→SQLite 迁移后台化（用户无感、启动不备份阻塞）：先设计，用户确认后"全部执行"设计 §9 的 6 个 feature。
- 最终状态：设计 + 6 个实施 feature 全部 done，全量验证通过：`npm run test` 215 文件 1780 测试全过、`npm run lint` 通过、`npm run build` 通过。**所有改动未 commit。**

## 本会话产出（未 commit）

- 设计（上一阶段）：`docs/architecture/session-storage-background-migration-design.zh-CN.md`（现状态"已实施（待真实大库验证）"，§11 实施偏差记录）+ `docs/architecture/assets/session-storage-background-migration-flow.svg`。
- 实施（本阶段，6 feature）：①`server/sqlite/session-state-repository.mjs`：alignBucketStream/deleteBucketRows/promoteAlignedSessionState/listBucketKeys；②`server/storage.mjs`：acquireSessionJsonWriteBarrier/readLastSessionWriteFinishedAt + parked 写执行时 facade 复检重路由（*ViaFacade，修数据丢失缺陷）；③`server/session-state-background-migration.mjs`（新）：编排状态机 + 全程日志 + cutover_running 锁内复位 + resolveSessionStateStartupRoute；④`server/index.mjs`/`server/startup-state.mjs`：启动链按 phase 路由、migration-status background 域；⑤`server/agent-manager.mjs`：countActiveSseStreams；`server/session-state-cutover.mjs`：共享函数补 export + 抽 createSessionBucketRecordStream；⑥文档 7 处同步（单一事实源/runbook/wiki/phase-machine SVG 等）。
- 测试：新增 4 文件 32 测试（align-bucket 9、write-barrier 5、orchestrator 单测 11、集成 5）+ 扩展 startup-maintenance-gate。
- 状态文件：feature_list.json（+design +6 impl 条目）、progress.md、session-handoff.md。

## 已知取舍与范围外遗留

- 集成测试修复 2 真实缺陷：parked 写重放丢写（严重，已修）、converging 状态缺失（已修）；理论风险已记录——parked 旧写覆盖新写窗口被微任务级联+空 mirror 队列封闭，引入窗口内宏任务间隙需复查 release 顺序。
- 未做：大库内存上界断言与真实库实测（设计 §10.3，收敛轮耗时/切换窗口时长/备份磁盘竞争待回填）；writeSessionValues/restore 写无重放路由（维护锁内无 parked 场景）。
- 极端持续写入不收敛的循环上限与告警阈值待实测后定（设计 §10.4）。
- 前序遗留不变：⑤门禁豁免不一致、⑥backupFile 复用旧快照、P2 减 pass 快照方案、"彻底不碰 JSON"三处架构依赖、前端 dispose 通知、agentSessions LRU、SQLite 大事务拆分等范围外候选。

## 最近提交

- 本会话（设计 + 6 feature 实施）与之前两轮（评审实施 11 feature、digest 修复三连）改动均未 commit。
- 此前：rebase 后包含远端 3 个修复提交（sidebar/font/metadata-delete）+ 语句复用 / 维护窗口 2 个提交，详见 `git log --oneline -6`。

## Next step

- 真实大库（~1.4GB、约 2415 会话、`session_storage_state` 仍为 `json_authoritative`）验证新链路：启动秒级 READY、后台迁移收敛与切换实测数据回填设计文档 §10.3；成功后 WAL 应被 checkpointWal 截断；择机手动清理 `conversations` 下 1045 个 `.tmp` 残留（2.75GB，非代码）。
- 择机 commit：可分主题（digest 修复 / 评审实施 / 后台迁移设计+实施）。
- 发布 patch 版本前完整运行 `npm run test`、`npm run lint`、`npm run build`，按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行。
