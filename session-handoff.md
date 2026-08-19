# Session Handoff

## 当前状态

- Feature `fix-startup-cutover-replay`（启动 30s~167s：cutover digest 排序 bug 导致迁移永久失败反复重放）已完成，改动三个文件：
  - `server/sqlite/session-state-repository.mjs`：导出 `digestFromLines` 作为 canonical 全行字节序排序实现（附排序契约注释）。
  - `server/session-state-cutover.mjs`：`buildSessionJsonSnapshot` / `createStreamingSessionSource` / `writeCutoverBackupStream` 三处源侧 digest 全部改用 `digestFromLines`（此前按 sessionId localeCompare 排序，混合 global+project 桶时与仓储侧整行排序不一致，`replaceAllStream` 校验必炸）；成功 promote 后 `checkpointSessionStorageWal` 执行 `PRAGMA wal_checkpoint(TRUNCATE)` 回收反复失败积累的 GB 级 WAL。
  - `tests/server/session-state-cutover.test.mjs`：新增回归测试（global zulu + project alpha，sessionId 序与行序交叉，断言 cutover 进 authoritative 且 digest 一致）。
- 根因链：8-18 起 cutover 每次在 `replaceAllStream` 末尾 digest 校验失败回滚 → `session_storage_state` 永卡 `json_authoritative` → 每次启动重放 4 遍 1.6GB JSON 流读 + 备份写 + SQLite 全量导入再回滚（实测真实数据两种排序 digest `76eadc82…` vs `a40c7ee7…`；一遍流读 23s）。既有测试数据恰好两种排序同序故从未暴露。
- 验证：session-state 相关 6 个测试文件 52/52 通过（含新回归用例）；3 个改动文件 eslint 干净。
- 事故与回滚（重要）：验证期间一次 `QUICKFORGE_DATA_DIR` 未设成功的脚本误在真实库执行 cutover（digest 修复实证生效、首次成功 commit），但违反独占前提；手动补救中途被叫停。已回退 `session_storage_state` 为 `json_authoritative`（JSON 权威未动、quick_check ok、5176 存活），残留 SQLite 条目会被下次 cutover 清空重写。临时脚本/数据已清理。
- 用户数据遗留（范围外，择机）：1045 个 `.tmp` 残留共 2.75GB 可手动删除；WAL 2.8GB 待新代码 cutover 成功后自动回收；npm 全局包发布新版前仍是旧代码慢启动；新版首次启动会一次性完成迁移（预计 1-2 分钟）。
- feature_list.json / progress.md / session-handoff.md 已同步；docs/wiki 未描述 digest 排序细节，无需更新。
- 工作区未提交改动：本轮三个文件 + 状态文件，以及此前会话遗留改动（storage/字体/侧栏修复等，见 git status）；按项目规则不做 git commit。

## 最近提交

- `2f0e01e` chore(status): record completed leftover features and update handoff
- `65c95d8` fix(ui): follow message font size in subagent run detail tabs
- `50a88e0` fix(sidebar): clip conversations section and keep footer divider visible
- `dbc0ca9` feat(agent): refresh session model bindings when custom providers change
- `73be13d` fix(context-usage): report pure input usage and drop reserved output row

## Next step

- `fix-startup-cutover-replay` 仍为 in_progress（会话存储 cutover 迁移反复重放导致启动 30s~167s），恢复时先读 progress.md 对应 Notes。
- restore/内存问题剩余候选（范围外，按性价比排序）：
  1. 前端 `ServerAgent.dispose()` 只关本地 SSE，不通知服务端；可在 dispose 时触发服务端提前回收（或缩短 idle 超时 / agentSessions 加 LRU 上限）。
  2. SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大；超大 session 可评估拆事务/更激进的 split 阈值。
  3. `server/mcp/registry.mjs` / `server/plugins/registry.mjs` 的 `withTimeout` 超时后 `new Promise(() => {})` 吞错，底层操作永不 settle（慢性泄漏）。
  4. 复现验证：观察新加的 `persist took ...ms (queue wait + write)` warn 日志是否出现在原问题场景。
- 其他范围外遗留（详见 progress.md Notes）：loadMore 无 loading 守卫、`server/cloud/identity.mjs:92` lint warning、ChatSidebar 删除定时器共享 ref 等前端问题。（storage 删除"复活"路径已由本轮 fix-archived-session-delete-batch 堵住。）
- 发布 patch 版本：说「发布一个小版本」，按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行（发布前完整跑 test/lint/build）。
