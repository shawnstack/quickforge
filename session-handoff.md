# Session Handoff

## 当前状态

- Feature `fix-persistence-lock-stall`（修复全局持久化锁串行链导致的请求挂起与会话滞留）已完成，与上轮 `fix-concurrent-restore-session-leak` 共同构成 `/api/agents/:id/restore` 挂起+内存增长问题的完整修复：
  1. `server/session-persistence-lock.mjs`：全局单链 promise 队列改为 keyed 队列（Map<key, tail>），同 key 严格串行、不同 key 独立并发，drain 后自动清理条目；默认 key（''）保持全局语义。
  2. `server/agent-manager.mjs` `persistSession`：SQLite 权威模式下用 `session:${sessionId}` 分锁（正确性由 per-row revision CAS + storage-owned 字段合并保证，全局互斥是 JSON 时代遗留）；JSON 镜像模式保留全局 key。跨 session 的 persist/destroyAgent 不再互相排队——旧模式下一个 session 的大同步事务会把其他 session 的 idle 销毁堵在全局链尾，销毁完不成 → agentSessions 只增不减。新增 ≥1s 慢 persist warn 日志（含 messageCount）。
  3. `server/utils/process-tree.mjs` `runTaskkill`：taskkill.exe 挂起时 10s 超时 resolve(false)，防 Windows 上 OpenCode 子进程清理路径悬挂 dispose()/destroyAgent。
  4. 上轮：`restoreAgent` 按 sessionId 共享 in-flight Promise（`pendingRestores` + `restoreAgentUnlocked`），并发路由只建一个 agent 实例，消除孤儿 session 泄漏。
- 验证：`npx vitest run tests/server` 全量 130 文件 / 1003 测试通过（含新增 `tests/server/session-persistence-lock.test.mjs` 4 项、`tests/server/process-tree.test.mjs` taskkill 超时项）；改动文件 eslint 干净（非发布场景，未跑前端测试与完整 build）。
- wiki 已同步：`docs/wiki/server/README.md` auto-archive 段（锁语义）、`docs/wiki/server/routes/README.md` restore 端点（并发去重）。
- feature_list.json / progress.md / session-handoff.md 已同步。
- 工作区未提交改动：`server/session-persistence-lock.mjs`、`server/agent-manager.mjs`、`server/utils/process-tree.mjs`、两个测试文件、wiki 两处、状态文件，以及之前会话遗留的未跟踪 `docs/analysis/conversation-loading-timeline.svg`；按项目规则不做 git commit。

## 最近提交

- `2f0e01e` chore(status): record completed leftover features and update handoff
- `65c95d8` fix(ui): follow message font size in subagent run detail tabs
- `50a88e0` fix(sidebar): clip conversations section and keep footer divider visible
- `dbc0ca9` feat(agent): refresh session model bindings when custom providers change
- `73be13d` fix(context-usage): report pure input usage and drop reserved output row

## Next step

- 无待办 feature。新需求先登记进 feature_list.json 再推进（One Feature at a Time）。
- restore/内存问题剩余候选（本次范围外，按性价比排序）：
  1. 前端 `ServerAgent.dispose()` 只关本地 SSE，不通知服务端；可在 dispose 时触发服务端提前回收（或缩短 idle 超时 / agentSessions 加 LRU 上限）。
  2. SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大；超大 session 可评估拆事务/更激进的 split 阈值。
  3. `server/mcp/registry.mjs` / `server/plugins/registry.mjs` 的 `withTimeout` 超时后 `new Promise(() => {})` 吞错，底层操作永不 settle（慢性泄漏）。
  4. 复现验证：观察新加的 `persist took ...ms (queue wait + write)` warn 日志是否出现在原问题场景。
- 其他范围外遗留（详见 progress.md Notes）：storage 删除不销毁内存会话（“复活”+lastModified 漂移）、loadMore 无 loading 守卫、`server/cloud/identity.mjs:92` lint warning、ChatSidebar 删除定时器共享 ref 等前端问题。
- 发布 patch 版本：说「发布一个小版本」，按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行（发布前完整跑 test/lint/build）。
