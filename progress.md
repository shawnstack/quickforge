# Progress

按时间倒序追加。每个 feature 一段，完成后在此留档。

## chat-render-dom-perf-followup（done，2026-10-31）

- Goal：在「不影响体验和交互」前提下，把 CSS/DOM 防卡顿清单里可等价实现的部分一次做完。
- 结论（一句话）：只动了不会改变视觉与交互时序的路径——回底按钮不再在每个装饰 pass 里强制布局，工具控制台/消息拖动消除读写交替，清理了布局属性的 `will-change` 与非必要过渡。
- 改动：
  1. `scroll-to-bottom-button.ts`：`ResizeObserver` 观察滚动容器 + `.max-w-3xl` 内容列，滚动时缓存距离；重复 `setup()` 只重放缓存判断。无 `ResizeObserver` 的环境仍走原测量兜底。顺带修复：只读会话移除 dock 后 `visible` 状态保留，重建新按钮时补写 `is-visible`。
  2. `tool-renderers/shared.tsx`：`syncConsoleScrollFades` 先读完水平几何再写 `scrollTop`，并跳过值未变化的 `data-overflow-*` 写入。
  3. `message-queue.ts`：`pointermove` 只记录坐标，兄弟节点 rect 读取与占位符移动统一进既有 `tick()`；`pointerup` 前用 `lastClientY` 结算落点。
  4. `WorkspaceInspector.tsx`：删除静态 `will-change-[width,opacity,transform]`；`width` 不是可合成属性，静态 `will-change` 不能省布局。
  5. `foundation.css`：用户气泡 `transition: all` 收窄为显式列表（颜色/阴影 + 原有 `max-width`），窗口缩放行为不变。
  6. `MessageList.tsx`：`data-message-index` 值未变化时不再写属性。
  7. `context-usage.ts`：tooltip 的 scroll/resize 定位合并到 rAF，关闭时取消挂起帧。
  8. `WorkspaceTabStrip.tsx`：关闭按钮的 `transition-all` 收窄为 `opacity/background-color/color`。
- 明确不做（原因）：`content-visibility`/CSS containment（测试禁止消息宿主、破坏滚动锚定）；虚拟列表（既有否决）；`width` 过渡改 `transform`（改变动画观感）；shimmer/box-shadow/backdrop-filter（可见视觉，需先 profile）；`startTransition`（改变流式调度）；scroll rAF 节流（既有否决）；装饰 pass 写后读重排（测量依赖装饰后布局）。
- 验证：定向 11 files / 206 passed；新增断言后 scroll-to-bottom-button 12 / message-queue 21 passed；复核后相关 9 files / 204 passed。全量：`npm run test` → 465 files / 5376 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功（`[precompress] 224 files: 12.67MB → 6.48MB`），`tsc -b` 随 build 通过。
- 未创建 Git commit，未手工修改生成产物。

## model-sheet-check-immediate（done，2026-10-30）

- Goal：用户反馈「对话框，模型选择，点击不会马上勾选」，先定位再修。
- 结论（一句话）：抽屉式模型选择里点击后勾选不动，是因为 `selectModel` 还在往已废弃的 `.quickforge-model-menu-item-suffix` 写 `✓`，而勾选图标早在 `createMenuItem` 里就渲染进左侧 `.quickforge-model-menu-item-check-slot` 且只写一次；抽屉又保持打开不重渲染，所以只有 `aria-checked`（背景高亮）变了。
- 改动：`src/lib/custom-model-selector.ts`
  1. `selectModel` 改为重写 check-slot 的 `innerHTML`（`agentAccessCheckIcon` / 空），删掉失效的 suffix 分支 —— 勾选随点击立即移动。
  2. 滚动守卫从「最近 300ms 有过 scroll 就丢弃 click」改为 `isTapGesture`：记录 pointerdown 起点 + `SCROLL_SETTLE_MS=150` 内是否在滚动，位移超过 `TAP_SLOP_PX=12` 或按下时仍在滚动才忽略 —— 滑完列表马上点不再需要点第二次。
- 受影响入口：聊天输入框模型弹层（`useModelActions.ts` → `openCustomOnlyModelSelector`，`innerWidth <= 768`）、设置/Agent 配置页模型选择（`AgentProfilesPage.tsx:347` → `openModelSheet`，桌面也强制走 sheet）。桌面菜单不变（pointerdown 选中后立即关闭）。
- 关键约束（别踩）：勾选图标的唯一来源是 `.quickforge-model-menu-item-check-slot` 的 innerHTML；不要再按 `aria-checked` 之外的旧 class（suffix）写文本，CSS 里 `aria-checked="true"` 只给背景高亮。
- 验证：`npx vitest run custom-model-selector + model-selector-thinking-sync + composer-model-trigger` → 3 files / 31 passed（含新增用例）；`npx eslint` 改动文件 0 problems；`npx tsc -p tsconfig.app.json --noEmit` 0 错误。未创建 Git commit，未手工修改生成产物。

## chat-render-perf-memory（done，2026-10-30）

- Goal：用户要求「分析对话功能的显示性能和内存，评审可优化技术，前提不损害交互和用户体验」，随后要求「架构最优、完整实现、必要可重构等价实现、一次完成」。
- 结论（一句话）：三处真实成本被削掉——流式 Markdown 从「每帧全量解析」变成「稳定块缓存 + 只解析尾块」；工具事件从「一次事件双 full decorate + 服务端不合并」变成「单次 streaming/full pass + 50ms 合并」；装饰与列表的固定成本（artifact 建 DOM 后丢弃、轮次导航强制 reflow、折叠时间线扫两遍、每帧重建 items/keys/rows）改为「先判后建 / 复用时间线 / 记忆化」。
- 逐项：
  1. **流式稳定块冻结**（`markdown-stream-chunks.ts` + `Markdown.tsx`）：`blocks`（已闭合、可缓存）+ `tail`（每帧解析）。保守切分：只在空行切，两侧都不能是列表项/引用/缩进代码/表格行/setext/HTML 块；冻结前缀必须数学定界符成对；任一不满足返回 null 退回整段解析。元素树对象相同 → React bailout，稳定块内的代码块也不会重新高亮。
  2. **工具事件**：`tool_execution_update` 走 `streaming` 装饰；`start`/`end`/`background_commands` 走一次 full。`scheduleToolInterfaceUpdate` 改走 `decorateScheduler`（不再 rAF 内直接 `runDecorate`）。服务端 `tool_execution_update` 纳入 50ms trailing，双槽共享计时器（单槽会互相顶掉），非合并事件先 flush。
  3. **装饰固定成本**：artifact 卡签名前置（`resolveArtifactCardInputs` / `artifactCardSignatures`）；turn-navigation 测量缓存改为「输入变化 + 锚点 isConnected」失效；`collectProcessTimeline` 每 turn 一次；scroll-sync 缓存滚动容器。
  4. **列表每帧分配**：`items` / 已提交行 key / 已提交行元素数组按 `messages` 记忆化；流式行 key 用 `createRenderKeyIndex().appendKey`（O(1)，与整体求 key 逐字等价）。
  5. **渲染缓存**：单槽快路径（同字符串引用 O(1)）+ 字节预算（8/12/4/4/8MB）+ in-flight 严格比较。
  6. **SSE 序列化共享**：WeakMap 按对象身份复用 `JSON.stringify` 结果。
- 经评估否决（写进 `docs/architecture/chat-render-perf-review.zh-CN.md` §3）：scroll rAF 合并（浏览器已把 scroll 事件合并到每帧）、折叠 turn 级指纹前置短路（需行结构签名，与「每轮重新确认」语义冲突，有 goal-iteration-divider 前例）、流式自适应降频（不改变单帧成本）、保活视图字节权重（预算语义是渲染行数）、SSE delta / 虚拟列表 / 裁 `state.messages`。
- 关键约束（别踩）：
  - `appendKey` 必须**只读** occurrence 计数：递增会让同一流式行每帧换 key → 整行 remount。
  - 稳定块切分是「保守优先」：宁可返回 null 退回整段解析，也不能切在列表/引用/围栏/表格/HTML/跨块数学定界符中间。
  - `streamingBlockCache` 与 `markdownElementCache` 分开限额：块缓存生命周期只有一回合，不能把历史整段渲染挤出去。
  - `tool_execution_update` 的合并前提是「每帧携带完整累积 partialResult」（客户端按替换语义写入）；如果将来上游改成 delta，必须同时撤掉合并。
- 验证：定向 175 例全绿（assistant-artifact-card 20 / turn-navigation 12 / process-folding 63 / render-key-index 3 / render-cache-bounds 4 / markdown-stream-chunks 11 / streaming-render-cache 5 / routes/agent 57）；`npm run test` → 465 files / 5373 passed / 2 skipped；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功（`[precompress] 224 files: 12.66MB → 6.48MB`）。未创建 Git commit，未手工修改生成产物。

## remove-storage-backward-compat（done，2026-10-30）

- Goal：用户看到启动时的「数据库 migration（当前 v11）」问这是干嘛，讨论后决定「大版本不需要向前兼容」，把 JSON→SQLite 兼容层、迁移进度页与 18 条迁移历史一起删掉。
- 决策依据（写下来免得以后反复）：迁移引擎本身（schema_migrations + user_version + 事务应用，约 120 行）保留，因为删了等于「每次改表删库」；真正能删的是**兼容旧数据的代码**——cutover 三件套 1076 行、双路径 store、phase 状态机、进度页、18 条迁移折叠成 1 条 baseline。
- ① 四域单路径：删 `share-cutover.mjs`/`lan-access-cutover.mjs`/`scheduled-runs-cutover.mjs`/`share-json-file.mjs`/`lan-access-json-file.mjs`/`maintenance/downgrade-{share,lan-access}-v1.mjs`；维护锁提取为 `share-maintenance.mjs`/`lan-access-maintenance.mjs`/`scheduled-runs-maintenance.mjs`（照 `session-state-maintenance.mjs` 既有模式，锁表 share/lan_access/scheduled_runs_maintenance_lock）；`*-service.mjs` 只剩 repository 访问器与注入；`*-store.mjs` 删 JSON 分支/mirror 入队/phase 判断；`*-backup.mjs` 去掉 phase 字段与 authoritative 前置；仓储层删掉 mirror 队列 API 与 storage_state 计数更新；maintenance 只剩 `export-*-v1` 逃生通道。
- ② 启动窗口收窄：`startup-state.mjs` 状态 starting/ready/failed（删 MIGRATING、`readMigrationStatus` 域名投影），`/api/migration-status` 路由删除，白名单只剩 `/api/health`；前端删 `src/lib/migration-status.ts`、`components/migration-progress-view.tsx` 及 2 个测试，`useAppBootstrap` 失败时改从 `/api/health` 读 `startupError` 作详情，启动期只显示 `StartupSplash`，i18n 删 14 个 `migration.*` 键。
- ③ 迁移折叠：`server/sqlite/migrations.mjs` 由 18 条 875 行折叠为单条 `version=19 name='baseline'`（一次建 15 表 + 13 索引），兼容期对象（`*_v10_backup`、两个 mirror 队列、三个 `*_storage_state`、`scheduled_runs_state`、`session_index` 备份表）一个都不建；`inspectSqliteMigrationState` 对 `user_version<19` 的旧库直接报错并给恢复指引（备份数据目录 → 从导出恢复或空库启动），没有就地升级；新迁移仍 append-only，与 `schema_migrations` 行、`user_version` 同事务。
- 测试与文档：help 里的 schema helper 改为按最后一条迁移推导版本；`sqlite-storage-foundation` 删掉 v10/v11/v12 历史迁移回归、改成基线结构断言 + pre-baseline 拒绝用例；share/lan/scheduled 三域的 store/service/backup/export 测试改单路径；`session-state-full-chain-electron-smoke` fixture 去掉 cutover/downgrade 段，改成「运行期不写 JSON + 离线 export 逃生」；`scheduled-tasks.commands` 的 runs 读取改走 SQLite repository。文档侧 sqlite 基础层/session-storage-v2/wiki server 全面改写，三份 cutover 文档标 archived，CHANGELOG 增 Removed。
- 关键约束（别踩）：
  - `*-store.mjs` 里 `defaultLanAccessConfig` 已迁入 store；`readXxxStorageState()` 仍保留为常量诊断（`phase:'authoritative'` + 实时计数），因为 backup 信封与 CLI 还读它，这不是阶段机残留。
  - 空库首次启动必须走 `initializeLanAccessService()` 物化 disabled 配置行，否则 backup 导出的 LAN 完整性校验会失败（多个测试的 helper 已按此修正）。
  - 旧库只有「备份 + 导出/删库」两条路；不要再加 downgrade 工具，也不要把 baseline 版本号写回 1（会与已有 v19 库冲突）。
- 验证：分域定向 vitest 全绿（share 27 例、lan-access 20 例、scheduled-runs 58 例、schema 56 例）；`npm run test` 462 files 全绿；`npm run lint` 0 problems；`npx tsc -b` 0 错误；`npm run build` 成功（precompress 224 files）。未创建 Git commit，未手工改生成产物。

## goal-strip-drop-spinner（done，2026-10-30）

- Goal：用户提出「goal 在对话前面显示时原点已经有呼吸效果，是不是可以不要那个旋转状态了」。
- 结论：旋转弧确实是冗余信号。`spinning` 只在 `runtime` 为 executing/planning/verifying（legacy running/verifying/planning）时为真，而这三个 runtime 的状态词都收敛到 `goalStateRunning` → `data-state="running"`，该状态本就有 2s `quickforge-goal-breathe` 呼吸动画。条带上同时有旋转弧 + 呼吸点＝同一个「正在推进」画了两遍，还抢了唯一强调色状态词的注意力。
- 改动：`GoalControlStrip.tsx` 删 spinner 渲染（只留 `.quickforge-goal-strip-dot`）；`goal-control-strip.ts` 删视图字段 `spinning`、`isWorkingSpin()` 与 legacy/v2 两处赋值；`goal-workflow.css` 删 `.quickforge-goal-strip-spinner`、`@keyframes quickforge-goal-spin` 与 reduced-motion 中的 spinner 覆盖（呼吸点 reduced-motion 下仍关停）；`goal-card.test.ts` CSS 契约反转（不含 spinner / keyframes），`goal-control-strip.test.ts` 删「spins only while a step is actually being worked on」用例与分散断言；`docs/wiki/src/components/README.md` 同步。
- 边界：聊天内 goal 卡自身的 `spinning`（`src/lib/goal.ts#isGoalSpinning` 驱动状态图标旋转）不属于运行条，未改。
- 验证：定向 vitest 4 files / 120 passed；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰生成产物。

## message-log-realtime-consistency（done，2026-10-30）

- Goal：用户反馈「手机 Tailscale 访问显示的对话内容与 web 不一致（同一 session）」，明确目标是**双端实时一致**、按最优架构落地、不打补丁。
- 根因（六条，完整版见 `docs/architecture/message-log-consistency.zh-CN.md`）：
  1. 增量投递游标 `session.deliveredMessageCount` 是**会话级单值**：两个客户端共享同一投递位置，后加入者从别人的进度开始收增量 → 结构性漏消息。
  2. `stateVersion` 是每个 token 都 +1 的**事件计数器**，不是快照版本，不能回答「消息变没变」。
  3. SSE 无 `id:`/无重放，全局流连接时**零初始帧**：断线期间事件永久丢失，非流式期间丢了也发现不了。
  4. 只读视图只给尾部 200 条，补齐靠一次性 `hydrateFullHistory`：失败静默 + 期间有 SSE 帧就整段丢弃 + 调用方只调一次 → 手机拉 MB 级请求失败后永久停在 200 条。
  5. `mergeIncrementalMessages`（假设本地从服务端索引 0 开始）与 `mergeWindowedMessages`（唯一处理窗口偏移）双轨并存，三个 SSE 调用点走前者 → 窗口态必然错位。
  6. 8 处「整体替换」只换数组、不换偏移；`reset()` 也不重置偏移。
- 改动（架构级）：
  - 服务端新增 `server/message-log.mjs`：`logVersion`（只随消息变化递增，指纹 = 条数 + 尾消息身份）、`tailWindow`、`projectSessionSnapshot`（尾部窗口 + `messagesAfter` + `logVersion` + 绝对 seq 的 goal 标记）、`createConnectionProjector`（**每连接一份**投递游标；`messages_replaced` 或总数回退视为替换）。
  - 服务端新增 `server/event-log.mjs`：全局单调 `seq` + 轻量事件环（容量 1000，仅存定位字段，流式帧不入环），`since(lastSeq)` 返回 `{ frames, gap }`。
  - `agent-session-events.mjs`：`emitSessionEvent` 改为发**完整事件**（裁剪下沉到连接层），新增 `trackMessageLogVersion`（logVersion 守卫），删除 `deliveredMessageCount` 裁剪；`stripSplitSessionState` 改为 `projectSessionSnapshot` 的别名。
  - `routes/agent.mjs`：两个 SSE handler 各自建 `createConnectionProjector`；`writeSseEvent` 支持 `id:`；全局流解析 `Last-Event-ID`/`?lastEventId=` 重放，缺口发 `resync`；会话级流初始帧后 `projector.seed`；`/messages` 支持 `from`（`after` 同义）并返回 `logVersion/total`。
  - `routes/session-view.mjs`：`messagesAfter` + `logVersion` + `messagesSummary.logVersion`；`agent-session-queries.mjs`：`/state`、`/status` 带 `logVersion`。
  - 客户端新增 `src/lib/message-log.ts`：`applyMessageLogOp` 纯函数（`snapshot`/`append`/`replace`/`update`；空洞返回 `gap`，重复段返回 `noop`），`baseSeq` 是唯一坐标。
  - `ServerAgent`：`messageWindowOffset` → `messageBaseSeq`，新增 `messageLogVersion`/`messageOffset` getter/`applyLog`/`localMessageEndSeq`；state/agent_end/message_end/turn_end/messages_replaced/`/state` 刷新/补齐全部改走 `applyLog`；删除 `mergeIncrementalMessages`/`mergeWindowedMessages`；3 处「本地长度 == 服务端下标」判据改为绝对位置；四条构造路径统一 `applySnapshotCoordinates`；`reset()` 同时清坐标。
  - `ServerAgent.rollback`：本地数组下标 + `messageBaseSeq` 换算成绝对 seq 再发给服务端（窗口态回滚错轮次的修复）。
  - `applyGoalIterationMarkers`：marker 的绝对 `seq/index` 减去 `baseSeq`，窗口外丢弃。
  - 压缩分割线：新增 `shiftCompactionToLocal`，`ChatSurface` 用 `agent.messageOffset` 换算后再交给列表。
  - `hydrateFullHistory` 改为幂等 + 返回 `boolean`；新增 `ensureFullHistory()`（退避 `[0,1s,3s,8s,20s]`，dispose 可中断）；拉取期间有 SSE 落地时以服务端全量为基底、保留本地更新尾部（不再整段丢弃）；`ChatPanelHost` 改调 `ensureFullHistory`，并在 `visibilitychange` / `online` 时重新收敛。
  - `global-agent-sse-client`：注册并分发 `resync` 帧（全局帧，遍历所有活跃会话），`ServerAgent` 收到后 `syncState()`。
- 验证：`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；定向测试 `tests/server/message-log.test.mjs`（19）、`tests/server/event-log.test.mjs`（6）、`tests/frontend/message-log.test.ts`（14）、`tests/frontend/server-agent-history-convergence.test.ts`（4）全过；`tests/frontend` 全量 271 files / 3266 passed；`npm run test` → 465 files / 5409 passed / 2 skipped；`npm run build` → 成功（`[precompress] 224 files: 12.67MB → 6.48MB`）。未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。
- 边界与遗留：
  - 事件环在进程内存：服务重启后首个客户端必然走 `resync`（一次全量 `/state` 校准），属预期。
  - 仍是单进程假设：跨实例实时一致需要外部 pub/sub，未做。
  - `tests/frontend/server-agent-message-window.test.ts` 随双轨合并函数一起删除，能力由 `tests/frontend/message-log.test.ts` 覆盖（窗口后追加、窗口内原位覆盖、丢弃前缀条目、整尾早于窗口）。
  - `tests/server/scheduled-tasks.commands.test.mjs` 仍为既有 flaky（单跑通过，与本次改动无关）。
  - 真机待验：手机 Tailscale 打开大会话后滚到顶能继续加载更早历史；断网 30s 再恢复，两端内容一致；同时打开两端流式期间不重复/不错位。

## ask-user-blocking-coordination（done，2026-10-30）

- Goal：用户要求按「架构最优」修掉 ask_user 弹窗与阻塞语义之间的缺口，保持现有交互与功能一致（允许重构）。
- 结论：`ask_user` 保持阻塞语义（execute 返回未 resolve 的 Promise，`runLoop` 停在 `executeToolCalls`，模型不会继续推理），本轮改的是它与**单槽 UI**、**steer 队列**之间的三处不一致：同会话并发提问改为串行排队、待答期间输入框文本改为直接作答、重启丢失语义写清。
- 根因（三条独立链）：
  1. 并发 ask_user 互相顶掉：`pendingAsks` 允许同会话多条、`getPendingAskForSession` 只回溯第一条、前端 `pendingAskRef` + 卡片都单槽 → 后一张顶掉前一张，先发出的那条只能干等 30 分钟超时；`ask_user` 又没标 `executionMode:'sequential'`（默认并行），一条 assistant message 里的两个 ask_user 会同时开始执行。
  2. 待答期间输入框文本静默入队：待答时 `state.isStreaming` 仍为 true，Enter 被消息队列的 capture keydown 收走 → `agent.steer`；而 steering 只在**轮边界**由 `getSteeringMessages` drain，被 ask_user 阻塞的这一轮永远走不到轮边界，用户那句话最长 30 分钟后才可能被模型看到。
  3. 重启语义不明：`pendingAsks` 是进程内 Map，服务重启后提问随进程消失（无幽灵卡片、也不会代答），但文档没写清。
- 改动（架构级，不是补丁）：
  - `server/ask-store.mjs`：新增 `enqueueAskForSession`（同会话串行链 + 深度计数；**首个提问同步激活**，保持原来「注册 + emit 与工具调用同步」的时序）、`ASK_QUEUE_MAX_WAITING = 3`、`clearAskQueues()`（测试缝）、`formatAskBusyResult()`；头注释改为当前事实源（Promise 编排在 orchestrator，store 只管队列与纯函数）。
  - `server/agent-approval-orchestrator.mjs`：`createAskUserPromise` = 归一 + 入队（队列满 → `details.skipReason:'busy'` 的文本结果，不注册、不 emit）；原实现整体下沉为 `activateAsk`，注册/`ask_user_required`/超时/abort/`ask_user_answered` 全部不变，**30 分钟计时从激活（变为可见）起算**，排队期间不计时。
  - `src/components/chat/panel-decoration/ask-user-card.ts`：`advance()` 返回 boolean；新增 `applyComposerText` 与 `WeakMap<HTMLElement, handler>` 登记，导出 `submitAskTextToPendingAsk(panel, text)`——问题步把文本写入该问的自由补充并前进（等价卡片内回车）；`allowCustom:false` 时按选项标签精确匹配（忽略大小写/首尾空白），匹配不上返回 false 交回原逻辑不吞字；回执步追加为卡片级补充信息。
  - `panel-decoration/message-queue.ts`：控制器新增 `isAskPending` / `submitAskText`，capture keydown 先走提问卡再入队；placeholder 待答时用 `askUserComposerPlaceholder`。
  - `panel-wiring/message-queue.ts`：透传两个新依赖；排队消息的「立即」按钮同样先走提问通道，避免同一条消息被 steer 静默挂住。
  - `ChatPanelHost.tsx`：`isAskPending` 取 `pendingAskRef` ?? `state.pendingAsk`（与卡片对账同源）；i18n 新增 `askUserComposerPlaceholder`（en/zh）。
- 测试：`agent-approval-orchestrator` 29 例（新增：第二条排队且前一条结算后才注册/emit、排队期间不计时 + 激活后满 30 分钟才超时、排队中 abort 直接 aborted、队列满返回 busy 且不注册、跨会话互不排队）；新增 `tests/frontend/ask-user-composer-routing.test.ts` 5 例（jsdom：自由补充并推进/选项精确匹配/不匹配交回/回执步进 remark/disabled 忽略）；`message-queue` 21 例（新增待答分流与 placeholder 源码契约）；`ask-user-card` 27 例（i18n 双语言列表加入新 key）。
- 验证：针对性 40 + 53 例全过；`npm run test` → 462 files / 5327 passed / 31 failed / 2 skipped（**31 例失败全部落在 3 个与本次无关的文件**：`tests/server/backup.test.mjs`、`tests/server/backup.authoritative-session.test.mjs`（LAN access state integrity）、`tests/server/scheduled-tasks.commands.test.mjs`，来自工作区里既有的 lan-access / scheduled-runs 未提交重构）；`npm run lint` → 0 errors（1 个既有 warning：`server/scheduled-task-runs-service.mjs` 未使用变量）；`npx tsc -b` → 0 错误；`npm run build` → 成功（`[precompress] 224 files: 12.66MB → 6.48MB`）。未创建 Git commit，未手工改生成产物。
- 范围/边界：阻塞语义、30 分钟超时、跳过/abort 文案、workflow 排除 `ask_user`、subagent 绑父会话 pending 通道均未变；未给 `ask_user` 加 `executionMode:'sequential'`（会连带把同批 `read_file` 等工具一起卡住 30 分钟，排队放在服务端更精准）。
- Notes（与本 feature 无关、未处理）：① 三条 backup / scheduled-task 测试失败属工作区既有未提交改动（lan-access cutover 删除、scheduled runs repository 改道），需另开会话收敛；② 首次跑 `npm run lint` 时出现过一次 `ENOENT: src/lib/migration-status.ts`（该文件在工作区已被删除），重跑即恢复正常，判断为当时并发跑测试造成的瞬态，非代码问题。

## subagent-mobile-horizontal-scrollbar（done，2026-10-30）

- Goal：用户反馈「subagent tools 在手机端访问显示有一个滑动的条」，确认是否异常并修掉。
- 根因（三者叠加，只有手机暴露）：
  1. subagent 摘要行必然横向溢出：`.quickforge-subagent-marquee{width:max-content;flex:0 0 auto}`（`process-timeline.css:24-37`）+ label 关掉省略号（`running-state.css:20-26`）。
  2. 兜底容器给了 `overflow-x:auto; touch-action:pan-x`（`tool-summary.css:98-105`），但隐藏滚动条只写了标准属性 `scrollbar-width:none`。
  3. `::-webkit-scrollbar` 隐藏规则只覆盖 `:has(.quickforge-command-summary)`（`tool-summary.css:107-109`），subagent 行漏写 → 忽略 `scrollbar-width` 的引擎（旧 Android WebView / Chromium <121、Safari <18.2）回落到 `foundation.css:49-66` 的全局 `*::-webkit-scrollbar{height:8px}` + `thumb=var(--border)`，行底出现常驻灰色横条并额外占 8px 高度（跑马灯定高 1.125rem 的度量前提被破坏）。桌面 Chromium/Safari 支持 `scrollbar-width` 所以看不到。
- 改动：`src/styles/chat/tool-summary.css` 把 `::-webkit-scrollbar` 隐藏组扩展到两条横向兜底行（`width:0;height:0;display:none`），并注明必须 unlayered（`[&::-webkit-scrollbar]:hidden` 在 `@layer utilities` 内会被全局 `*` 覆盖，参见 `inspector-tabs.css:1-20`）。
- 验证：`npm run lint` → 0 problems；`npm run build` → 成功（`[precompress] 224 files: 12.66MB → 6.48MB`）；产物 `dist/assets/index-BOaN4A3z.css` 已含新选择器。
- 范围/边界：保留 `overflow-x:auto` 的横向拖动能力（用户明确要可横向滚动）；iOS <18.2 的 overlay 瞬时滚动条由系统绘制，CSS 无法隐藏，如需彻底消除只能取消横向滚动容器（会与跑马灯契约冲突，需另行评估）。未改 TSX、未改生成产物。

## window-scroll-transaction（done，2026-10-29）

- Goal：用户反馈「优化后，从下往上翻页会回弹到底部，从上往下翻页会直接到最下面」。
- 根因（两条链，同一批状态漂移）：
  1. 向上回弹：`trimPagedWindow` 把「12 轮 / 160k 字符」当硬限，`loadMore` 从窗口**下方**逐轮裁。字符预算在长对话里必然超标，可能一路裁到只剩 1 轮，连视口所在行一起卸载；`loadMoreMessages` 的旧兜底 `(anchor.scrollTop ?? 0) + max(0, scrollHeight - heightBefore)` 在内容变矮时把增量钳成 0，等于写回旧 `scrollTop`，被浏览器 clamp 到新的 `maxScrollTop`（新窗口底部）。随后 scroll 事件命中 `distance < 10` 分支，被当成「用户回到底部」→ 重新 arm 跟随 → 下一帧 `scrollTop = scrollHeight`。
  2. 向下直达末尾：`distance < 10` 同一分支既 arm 跟随又 `onReachBottom`；`enableAutoScroll()` 无条件 `scheduleScrollToBottom()`，`setAutoScroll(true)` 又顺带 `loadNewer()`，而 `pageInFlight` 只在单次 Promise 内有效 → 「触底 → 贴底 → 再触底」逐页连播到 `endOrdinal === turnCount`，届时 `atTail` 变真，layout effect 再补一刀 `scrollTop = scrollHeight`。
- 改动（架构级，不是补丁）：
  - `windowed-messages.ts`：新增 `setViewport()` / `coversTail()` / `restoreEviction()`；`WINDOW_MAX_TURNS|CHARS` 降级为目标值，裁剪只允许发生在视口之外的整轮，视口占满预算时允许超限；字符统计改为按消息身份 `WeakMap` 缓存 + 逐轮累加（原来每次 drop 全量重扫），并记录逐出区间。
  - 新增 `scroll-owner.ts`：`scrollTop` 唯一写者。`anchor` 只按绝对 `data-message-index` 解析，行消失返回 `blocked`（不回退 ordinal、不写旧值）；`tail` 仅在 `coversTail()` 时生效；写入一律 clamp-aware，`clamped` 作为「裁多了」的信号。
  - `ChatSurface.tsx`：四条路径（loadMore / loadNewer / showMessageIndex / hydrate 锚点）统一 `runWindowTransaction`——上报视口 → 冻结（loadNewer 保持）跟随 → 捕获锚点 → 变更 → 在挂载新行的同一次 commit 里恢复（`clamped` 则 `restoreEviction()` 并重新发布）→ resolve；`publishWindow` 无变化时改 microtask flush；`setAutoScroll(true)` 只 arm 跟随；layout effect 贴底改走 owner。
  - `scroll-sync.ts`：降级为意图探测，`getFollowing()` 读 surface 的跟随标志（单一真相），`canFollowTail()` 决定触底是「恢复跟随」还是「只补下一页」，`scrollToBottom` 同样受 `canFollowTail()` 约束；`ChatPanelHost` 注入这两个回调。
- 测试：`windowed-messages` 新增 5 例（视口保护、只在视口下方逐出、`restoreEviction`、`coversTail`、disabled 覆盖尾部）→ 30 例；新增 `scroll-owner.test.ts` 7 例（含「锚点被逐出时一个字节都不写」回归）；`scroll-sync` 新增 2 例（窗口未到末尾时触底不 arm 跟随、到末尾才 arm）→ 21 例；`chat-surface-behavior-alignment` 的两处源码字符串断言改为行为断言（owner tail 意图 / blocked 语义）。
- 验证：`npm run test` → 462 files / 5372 passed / 2 skipped；`npm run lint` → 0；`npx tsc -b` → 0；`npm run build` → 成功。未创建 Git commit，未手工改生成产物。
- 遗留：浏览器实机的手感（连续上下翻页、流式中触底补页）未自动化覆盖，需人工确认；`turn-navigation` 与「回到底部」按钮的 `scrollTop` 写入仍各在自己的组件内（显式导航，不参与分页锚点事务），未纳入 `scroll-owner`。

## message-copy-window-index（done，2026-10-29）

- Goal：用户反馈「对话里用户消息的复制用不了了——复制到空/错的内容，所有用户消息都这样」。
- 根因：消息窗口化（4c4c0e1）后，装饰层把每行 index 算成**全对话绝对索引**（`index + messageIndexOffset`，`message-actions.ts:470`），而 `ChatPanelHost` 传进来的 `getMessages` 是 `getWindowMessages()` 的**窗口切片**（`ChatPanelHost.tsx:1193`，起点即 `messageIndexOffset`）。复制回调（`message-actions.ts:706` assistant / `:722` user）仍写 `getMessages()[entry.index]`：窗口起点 > 0 时绝对索引落在切片长度范围内，却指向窗口里的另一条消息 → 复制成别人的内容；命中的是 assistant / toolResult 时 `draftTextFromUserMessage` 返回 `''`，点击静默无任何反馈。同文件 173-183 行注释本就声明「copy 用全对话索引」，与实现自相矛盾；既有测试 `messageIndexOffset` 恒为 0，故未暴露。
- 改动：新增 `messageAtFullIndex(fullIndex)`（`fullIndex - messageIndexOffset` 再读切片，越界返回 `undefined`），两处复制回调改用它，并在取到空文本时回退渲染时快照 `text`；rollback / retry / fork 仍用绝对索引（服务端语义），不动。
- 测试：`tests/frontend/message-actions.test.ts` 新增 1 例「窗口起点 2 + 窗口内含不渲染的 toolResult」——用户行、助手行复制各自拿到自己那行的文本；临时把修复退回（`localIndex = fullIndex`）时该例失败并复现「复制成另一条消息」，确认用例能拦住回归。
- 验证：`npx vitest run message-actions inline-message-editor` → 2 files / 53 passed；`npm run test` → 455 files / 5325 passed / 2 skipped；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功。未创建 Git commit，未手工改生成产物。
- 范围：只改复制取值这一处 + 1 例测试；未动窗口化控制器、装饰短路 key、回滚/重试链路。

## composer-pasted-text-attachment-remove（done，2026-10-29）

- Goal：用户反馈「对话框粘贴附件无法删除」。
- 根因：`decorateComposerTextAttachmentTile`（`src/components/chat/panel-decoration/editor-bindings.ts`）给粘贴文本附件 tile 挂的「在系统文件管理器中打开」点击劫持用的是**捕获阶段** + `stopPropagation()`。tile 在 React 事件根之下，事件被拦在捕获阶段后既不会到达 `.qf-attachment-tile-remove` 按钮 target，也不会冒泡回根节点，`onDelete` 永远不会执行；同一路径还会把点击转成「打开文件管理器」，体感就是点 × 没反应。图片/文件选择走 `MessageEditor.addFiles`，没有这层劫持，因此不受影响。
- 改动：捕获监听在 `stopPropagation()` 之前加一层放行——`(event.target as Element).closest('.qf-attachment-tile-remove')` 命中即 return；tile 主体点击仍打开系统文件管理器。
- 测试：`tests/frontend/editor-bindings.test.ts` 的 `FakeTile` 改为记录 click handler，新增 1 例断言「删除按钮的点击不被 stopPropagation、不触发打开文件管理器；tile 主体点击仍然如此」。
- 验证：定向 vitest 5 files / 89 passed；`npx eslint` 两文件 0 problems；`npx tsc -b` 通过。
- 范围：只改这一个 capture 监听；未动 composer store/draft/AttachmentTile 的删除逻辑；未触碰生成产物；纯前端交互修复，无 API/模块职责变化，wiki 无需更新。

## release-2-3-5（done，2026-10-29）

- 触发：「发布一个小版本」。
- 结论（一句话）：把 v2.3.4 之后 dev 上的 7 个提交以 **2.3.5** 发布——版本递增、CHANGELOG/README 更新、test/lint/build 硬门禁通过、runtime/offline 包与 tarball 生成、release commit + tag `v2.3.5` 推送 `origin/dev`；`npm publish` 按 runbook 留给用户手动执行。
- 发布内容概要：
  1. Dreaming 记忆沉淀（`~/.quickforge/DREAMING.md` 单一 bullet 列表、每日定时、运行历史与 line diff、快照回滚、`recall_experience`、设置页概览/笔记/设置三段）。
  2. Dreaming 冷笔记阈值进「高级配置」+ 到期自动删除（`pruneStaleNotes` / `pruneMinNotes` / `pruneUnusedDays` / `pruneMaxRecalls`，`operations.pruned`）。
  3. 插件 UI 扩展（plugin API v2 `contributes.ui`、13 种白名单节点 DSL、slot/action/KV/audit、iframe 沙箱面板与 assets 路由 CSP、`plugin-creator` skill、`hello-ui` 示例）。
  4. 消息渲染窗口化默认开启 + 双向分页（窗口只增不减）。
  5. 每次压缩一条留痕线（`contextCompaction.history[]`、`occurredAtIndex` 锚定、窗口外双向钳制）。
  6. 回滚改为就地编辑并直接重发；回滚拒绝路径清零（索引 clamp + 轮锚定）。
  7. 本地工具卡 header + panel 两层，停止按钮紧跟摘要；设置导航 shadcn 重排；自动压缩非结构性门槛移除。
- 改动文件：`package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：
  - `npm run test` → 455 files / 5323 passed / 2 skipped（串行复跑，退出码 0）。首次与 lint 并行跑出现 1 例时序抖动（vitest 只报计数、未打印到 tail 段），串行复跑全绿，按既有 flaky 处理。
  - `npm run lint` → `eslint .` 无输出（0 problems）。
  - `npm run build` → 成功（`✓ built in 6.37s`，仅既有 >500kB chunk 提示）。
  - `node scripts/prepare-runtime-package.cjs` → `package-dist/`（package.json 版本 2.3.5）。
  - `node scripts/prepare-offline-package.cjs` → `package-offline/`（package.json 版本 2.3.5）。
  - `cd package-offline && npm pack` → `shawnstack-quickforge-2.3.5.tgz`（7.9 MB packed / 24.0 MB unpacked / 578 files、shasum `df210d9b…`）。
- Notes：
  - `[Unreleased]` 里原有的 5 条 Composer 任务清单改动在 2.3.4 之前就已写入但未转正，本次一并并入 2.3.5 的 Changed。
  - 未推送 `master`（本地 master 仍停在 `9ded6c0 chore(release): v2.0.0`），与 2.3.4 的发布方式一致，只推 `origin/dev` 与 tag。
  - 未执行 `npm publish`；离线包与 tarball 均在 `.gitignore` 覆盖的生成目录内，不进入提交。

## dreaming-prune-settings-and-auto-delete（done，2026-10-29）

- 反馈：「`NOTE_PRUNE_MIN_NOTES=40 / NOTE_UNUSED_DAYS=60` 希望可以在梦境的高级配置里面设置，然后增加到期自动删除的功能」。
- 需求确认（用户选择）：判定口径 = 召回次数 ≤ M 次 + 存在 ≥ N 天；自动删除发生在**模型重写之前**；**不设任何保护**（无单轮条数上限、无 kind 白名单），满足条件就删。
- 设置层（`server/dreaming/settings.mjs`）：
  1. `DEFAULT_DREAMING_SETTINGS` 新增 `pruneMinNotes: 40` / `pruneUnusedDays: 60` / `pruneMaxRecalls: 0` / `pruneStaleNotes: false`。
  2. 新增本地 `clampNumber`（与 `goal-settings.mjs` 同形，取整 + 上下界），范围 1–500 / 1–3650 / 0–1000。非法值回默认而不是回边界值——打错字不能变成「删掉所有超过 1 天的笔记」。
  3. `pruneStaleNotes` 只认 `=== true`，与 `enabled` 同风格；默认关闭，因为写进 `DREAMING.md` 的删除不可逆。
- 运行层（`server/dreaming/runner.mjs`）：
  1. 删除 `NOTE_PRUNE_MIN_NOTES` / `NOTE_UNUSED_DAYS` 常量（源码零残留，`grep` 确认）。
  2. 新增并导出纯函数 `selectStaleNotes({ notes, stats, minAgeDays, maxRecalls, now })`：`recallCount ≤ maxRecalls` 且 `now - createdAt ≥ minAgeDays` → 选中；**没有 stat 行的手写笔记永远不选中**（年龄未知，按猜测删比留着更坏）。
  3. 开关开启时先算 stale → 先 `writeDreamingNotes(composeAutoSection(remaining))` 再 `syncNoteStats(remaining)`，然后才调模型；写盘失败则回滚为「什么都没删」，把 `notesForModel` 保持为原列表，并把错误挂到 `pruneWarning`。
  4. 统计不再包在「候选段」分支里：`listNoteStats()` 一次读取两处共用，读失败只 warn（降级为「没有冷笔记」）。
  5. 开关开启后不再生成 `## Never recalled` 候选段（已删过，重复语义）；关闭时保留原门槛，但阈值改读设置。
  6. 漂移告警的基准改为 `notesForModel`（模型真正看到的列表），避免「先删 20 条」把 churn 比推到 100% 误报。
  7. 记录口径：`operations.pruned`（被规则删掉的原文）、`retiredCount = removed + pruned`、summary 追加「，其中到期自动删除 N 条」；`模型回复里没有任何笔记条目` 的失败分支也标注本轮已先删 N 条（文件已改写，要让人知道）。
- 仓储（`server/sqlite/dreaming-repository.mjs`）：`toRun()` 的 operations 白名单补 `pruned`（不补会被静默丢弃，这是本轮实测踩到的——测试拿到的是 `undefined`）。
- 前端：
  1. `dreaming-data.ts` 的 `DreamingSettings` 补四个字段，`DreamingRunDiff` 补 `pruned?: string[]`。
  2. `DreamingSettingsTab.tsx` 设置卡内新增「高级配置」折叠区（inline 展开按钮，不另起卡片），依次是开关 + 冷笔记天数 / 召回次数上限 / 候选列表启用条数。数字输入抽成本地 `NumberField`：草稿态 + 失焦/Enter/步进提交 + 与服务端同范围 clamp；外部值变化用「渲染期调整 state」而不是 effect（`react-hooks/set-state-in-effect` 不允许 effect 里同步 setState）。
  3. 运行详情新增 `DiffList` 分组「到期自动删除」，每行备注「由到期规则在模型运行前删除，不是模型的判断」；`hasChanges` 一并计入。
  4. i18n 新增 11 个 key（en/zh 成对）：`dreamingAdvanced`、四个 `dreamingPrune*` 及其 `Info`、`dreamingRunPruned`、`dreamingRunPrunedNote`。
  5. `dreaming.css` 新增 `.quickforge-dreaming-advanced-toggle`（语义 token + 复用 `.quickforge-dreaming-chevron` 的旋转，含 reduced-motion 分支）。
- 测试：`dreaming-memory` 加 3 例（默认值 / clamp 与非法值回默认 / 布尔只认字面 true）；`dreaming-runner` 加 5 例（模型前删除 + 空列表 + 两次写盘 / 召回次数超限保留 / 无 stat 的手写笔记不删 / 可配天数双向验证 / 关闭时用可配候选门槛）；`routes/dreaming` 加 1 例 PUT 往返与 clamp；`tests/frontend/dreaming-prune-settings.test.ts` 新增 4 例源码契约（en/zh 成对、字段名与 patch 对齐、折叠区、run diff 分组）。`routes/dreaming{-detail}` 三处 operations 精确断言补 `pruned: []`；`tests/server/dreaming.test.mjs` 的 `finishRun` 整对象断言（最初漏改，被全量测试抓出）同步补 `pruned: []`。
- 文档：`docs/architecture/dreaming-memory.zh-CN.md` 的 5.4 反馈闭环（两种模式 + 年龄语义）、§6 API、§7 设置 JSON 与 clamp 说明、§8 前端、§9 质量信号行、§10 已知取舍全部改写；`docs/wiki/server/README.md` 的反馈闭环条目同步。
- 验证：见下方 Notes（全量结果在本次会话末尾补入）。
- Notes：
  - **自动删除与「信息而不是规则」冲突，是本轮用户明确裁定的取舍**：默认仍关闭（保持原设计取向），开启后模型没有否决权。恢复路径只剩「更早一次 run 的 `notesAfter` 快照」——被删条目不在本轮 `notesAfter` 里，`POST /runs/:id/restore` 恢复的是删除之后的状态。
  - `created_at` 是 Dreaming 首次见到该措辞的时间，不是笔记真实年龄：老版本升级后第一轮会给现存笔记写入「今天」的 stat，所以 60 天后才会成批到期。
  - 界面与前几轮一致：`enabled: false` 时高级配置只读（与执行时间/敏感内容同规则），要先开启 Dreaming 才能调。

## rollback-orphan-assistant-turn（done，2026-10-29）

- 反馈：「对话回滚的时候报错：没有可回滚的对话轮次。应该不用这么限制，可能中间有报错的对话，所以去掉这个限制」；放宽孤立 assistant 后用户真机仍报错，二次反馈「就不应该有这个限制」。
- 根因：回滚按钮挂在 user 行并传全量 index，但 `performRollback` 读取的是 `agentRef.current.state.messages`（权威数组）；UI 窗口数组（`getWindowMessages()`，可含 append-only extras）与权威数组瞬时错位（压缩替换、乐观尾插、会话切换等）时，index 落在 toolResult 或越界 → 返回 -1 → 弹「没有可回滚的对话轮次」。
- 最终方案（回滚永远可用，拒绝路径清零）：
  1. `rollbackStartIndexFromMessage`（前端 `message-utils.ts` + 服务端 `agent-manager.mjs` 同构）：索引 clamp 到 `[0, length-1]`；user → 自身；其他角色（assistant/toolResult/孤立轮）→ 向前找本轮 user，找不到以自身截断；仅空会话或非有限数返回 -1（无操作）。
  2. 服务端 `rollbackSessionMessages`：删除 400 "There is no conversation turn to roll back." 分支，-1 clamp 为 0（空会话幂等无操作）。
  3. 前端 `performRollback`（`useChatActions.ts`）与 `SharedConversationPage.tsx` 两处：去掉「没有可回滚」弹窗，-1 静默返回；`rollbackMessage` 可为 undefined 时草稿回填空串。
  4. i18n：删除 `noConversationTurnToRollback`（en/zh）死 key。
- 验证：`npx vitest run`（message-utils / rollback-start-index / exports-contract / rollback-compaction / share-store.rollback-atomic / chat-surface-render）6 files / 50 tests 全过；i18n 快照 2 files / 15 tests 全过；`npx tsc -b` 0 错误；eslint 改动文件 0 problems；`npm run build` 成功。未创建 Git commit，未触碰生成产物。
- Notes：历史第一轮只放宽了「assistant 无前置 user」一种形态，未覆盖 index 错位 / toolResult / 越界，本轮已全部收敛为 clamp + 统一轮锚定。`tests/server/share-store.rollback-atomic.test.mjs` 内嵌旧实现副本用于 mock share-store 原子性路径，不校验锚点语义，未改动。

## dreaming-run-detail-shadcn-ui（done，2026-10-28）

- 反馈：「优化一下梦境记忆的详情 UI，参考 shadcn ui」。
- 改动（只动前端，无 API/数据变更）：
  1. `DreamingSettingsTab.tsx` 的 `RunDetail` 从「一张卡平铺」重构为 shadcn 卡片结构：页头（`dreamingRunBack` 返回按钮带 ArrowLeft 图标 + 标题 + 时间/字符 meta + 右侧状态/触发/模型/语言徽标）→ 统计瓦片条 → 正文（错误告警 / 结论 / 变更 diff / 原始响应折叠）→ 页脚（恢复按钮 + 提示）。统计瓦片与总览卡共用新抽取的 `StatStrip`；tone 只作用于数值（`+2/-1/✕1` 复用 metrics 语义色配方），丢弃为 0 时不占格。
  2. 新增 `DiffList`：`+/−/✕` 行 diff，tone 落在标记与分组标题、正文保持 foreground；`dropped` 的 `reason` 从「内容（原因）」拼接串拆成独立 muted 小字。无变更时显示 `dreamingRunNoOperations` 空态。
  3. 详情此前根本不显示 `run.summary`——补「结论」段（复用 `dreamingRunSummary`）。
  4. 修死类名：`<pre className="quickforge-dreaming-raw">` 在 CSS 里不存在（原始响应一直无样式），改用 `.quickforge-dreaming-code`（等宽/滚动/22rem 限高），`SectionToggle` 接入 `description`（`dreamingRunRawResponseDescription`）并给展开区补 `px-5` 对齐；`.quickforge-dreaming-code` 自身删掉旧的 1.25rem 侧边距。
  5. `run.error` 在详情里升级为浅色 destructive 告警条（AlertTriangle 图标 + `role="alert"`，7% 背景 + 24% 边框，符合「危险克制但真失败可用」）；列表行内的 error 仍是原纯文本样式。
  6. i18n 零新增：全部复用既有 key（含此前未消费的 `dreamingRunBack` / `dreamingRunSummary` / `dreamingRunNoOperations`）。
  7. `dreaming.css` 新增 `.quickforge-dreaming-alert`（+`-text`）与 `.quickforge-dreaming-diff*` 六个类、`stat[data-tone]` 三个着色规则；全部留在 settings 域，无跨模块 selector。
- 静态预览：`docs/design/dreaming-run-detail.html`（token/组件样式同源拷贝，深浅色切换，成功/失败两变体）。
- 验证：`npx tsc -b` 0 错误；`npx eslint src/components/dreaming/DreamingSettingsTab.tsx` 0 problems；`npx vitest run tests/frontend` 全量 267 files / 3220 passed；`npm run build` 成功。未创建 Git commit，未触碰 `dist/`（build 产物）等生成目录。
- Notes：`quickforge-recall-list`（chat 域）在 Dreaming 笔记页签仍被复用，本次未动；若以后要按域收紧 CSS 归属，需先把 settings 对它的消费迁到本域类。

## compaction-remove-skip-gates（done，2026-10-28）

- 反馈：「源 <1600 字符 / 距上次 <30s / 10 分钟内拒绝过——这些奇怪的约束都应该去掉，上下文不够就该压缩」。
- 改动：
  1. 删除 `AUTO_COMPACT_MIN_INTERVAL_MS`（30s 间隔）与 `AUTO_COMPACT_REJECTION_SUPPRESS_MS`（拒绝后 10 分钟抑制）常量及全部检查；`shouldSuppressAfterRejection` / `markAutoCompactRejected` / `clearAutoCompactRejected` 一并删除，`declined` 决定只跳过当前这一次尝试。
  2. `minSourceChars` 从前后端 `DEFAULT_AUTO_COMPACT_SETTINGS` / `normalizeAutoCompactSettings` 及 `compactSessionInPlace` 参数中删除；自动路径的前置只剩结构性检查：可压缩消息 ≥2 条、自上次压缩后有新消息。旧存储里的 `minSourceChars` 由 normalizer 丢弃。
  3. `lastAutoCompactRejected` 不再写入；`resetSessionCompaction` / agent 初始化保留置空，兼容旧持久化数据。
  4. 防空转的结构性护栏保留：`not_enough_new_messages`（滚动压缩没有新增量就不压，天然截断「摘要压摘要」循环）与 `sourceMessages.length < 2`；`manual_compact` 继续向 `compactConversation` 传 `minSourceChars: 0`，conversation-compaction 内部 `MIN_SUMMARY_SOURCE_CHARS` 结构性下限不动。
- 代价（用户知情）：开着确认时，拒绝后下一次过阈值请求会重新弹决策行；极小会话也可能触发一次摘要调用。
- 验证：`npx tsc -b` 0 错误；`npx eslint 改动文件` 0 problems；`npx vitest run` 压缩+设置相关 8 个测试文件 84 例全过。未创建 Git commit。
- 评审追补（同日）：`compactConversation` 的自动路径没显式传 `minSourceChars`，继承 `conversation-compaction.mjs:8` 默认的 1600 地板（`compactRange < 4 且 transcript < 1600` 时 `not_enough_history` 静默跳过），与移除意图相悖；改为自动/手动统一传 `minSourceChars: 0`，`MIN_SUMMARY_SOURCE_CHARS` 常量保留但压缩入口已无实际作用面。另修正 `agent-approval-orchestrator.mjs:206` 注释仍写「suppress for 10 minutes」的陈旧表述。验证：5 个压缩测试文件 57 例全过、`npx eslint` 两文件 0 problems。
- 二次追补（同日，用户裁定限制代码本身也删）：`MIN_SUMMARY_SOURCE_CHARS` 常量、`compactConversation` 的 `minSourceChars` 参数与归一化、`compactRange < 4 && transcript < N` 字符门槛全部删除；跳过条件只剩结构性的 `compactRange.length === 0`。调用方不再传 `minSourceChars`（`auto-compaction.mjs`、`agent-compaction.mjs` /summary 路径——后者此前一直在吃 1600 默认地板，短会话 `/summary` 会静默不压，现在只要有可压缩消息就压）。测试删除 6 处 `minSourceChars: 0` 传参并改名短历史用例；`git grep` 确认源码零残留（前端 normalizer 对旧存储值的丢弃测试保留）。验证：5 个压缩测试文件 57 例全过、`feature_list.json` JSON parse 通过、eslint 0 problems。

## compaction-timeline-history（done，2026-10-28）

- 反馈：「每次压缩都要有线出现，压缩的时机点显示要准确，一定是真实时序来的」+「第一次压缩后，第二次压缩会把第一次压缩后面的内容再压缩」。
- 现状诊断（三条根因）：
  1. `session.contextCompaction` 是**单值**（`auto-compaction.mjs:355` 直接赋值），SQLite 无 compaction 表、会话事件不落库 → 历次压缩的切点/摘要/用量不可还原，界面永远只有一条线，第 2 次压缩是把第 1 条线**挪走**而不是新增。
  2. 线的位置用的是 `compactedUpToIndex`（= `tailStart`，摘要覆盖范围的右边界），而「压缩发生时刻」是压缩那一刻的 `messages.length`。保留最近 n 轮时两者差若干条消息，用户读到的是「压缩发生在上一轮回答之后」，实际发生在这一轮的中间。
  3. 定位靠数组下标，而压缩在 `transformContext` 里跑的是 `state.messages.slice()` 副本；尾部截断、整体替换、前端乐观尾插都会让下标失真，`compactedUpToIndex > windowEnd` 时旧实现直接 **hidden** → 「这次压缩没有线」。
- 方案（用户选 A：每次压缩都留一条线，旧线原地不动）：
  1. `compactSessionInPlace()` 追加 `contextCompaction.history[]`，每条 `{ compactedAt, occurredAtIndex, boundaryIndex, summaryMessage, keepRecentTurns, sourceMessageCount, usageBefore, thresholdPercent }`，上限 `MAX_CONTEXT_COMPACTION_HISTORY = 20`（超出丢最旧）；顶层字段保持「最新一次」语义不变。`body_json` 存完整对象，**没有表结构迁移**。
  2. 前端 `resolveCompactionMarkers()` 按 history 每条生成一条线，锚定 `occurredAtIndex`；`boundaryIndex` 只作为范围信息留着，不再决定线的位置。
  3. 窗口外**双向钳制**而不是隐藏：低于窗口 → 钳到首行，高于窗口 → 钳到末行；同渲染位置只保留最新一条（窗口化上翻时不会在顶部堆一摞同样的线）。
  4. 非最新条目 pill 追加 i18n `contextCompactedMergedLabel`（已并入后续摘要），`compactedAt` 写进 tooltip 与 `data-compacted-at`。
  5. `MessageList` 由单 `compactionBoundary` 扩展为 `compactionMarkers[]`（旧 prop 保留给单记录 payload 与既有测试），每条线独立 `<details>` 状态。
- 顺带修掉的两个既有缺陷：
  - `session-state-service.applyMetadataToState()` 曾用扁平 metadata（无 `summaryMessage`）覆盖 `state.contextCompaction` → 改标题/置顶这类元数据写入会把摘要降级为空、history 整个丢掉。现在按字段合并，保留 body 侧富字段。
  - 分享页 `sanitizeContextCompaction()` 原来只清洗顶层 `summaryMessage`，history 里每条摘要会带着 `contextReferences` 泄漏 → 现在逐条 `sanitizeMessage`；`sanitizeEvent` 的触发条件也从「有 summaryMessage」改为「有 contextCompaction」。
- 没动的：`buildCompactionSourceMessages()` 的滚动压缩语义（旧摘要 + 上次切点之后的增量）、`compactedUpToIndex` 的裁剪口径、`resolveCompactionBoundary()` 的既有契约（含过期即 hidden）都没改。
- 验证：`npx tsc -b` 0 错误；`npx eslint 改动文件` 0 problems；`npm run lint` 0 problems；`npm run build` 成功；`npm run test` → 450 files / 5268 passed / 2 skipped；唯一失败 `tests/server/scheduled-tasks.commands.test.mjs` 是既有 flaky（该文件未被本改动触碰，失败点在 goal run 计数断言，同一文件单跑时通时不通——三次运行分别是全量挂、单跑过、单跑挂）。未创建 Git commit。
- 追加修复（同日）：`resolveAutoCompactTailStart()` 原来在切点落到 index 0 时回退到 `tailStartForRecentTurns(source, configured)`，而该回退目标在单用户回合会话里同样是 0 → 自动压缩永远 `not_enough_history`。现在改为逐级降级保留回合（n → n-1 → … → 1），仍留不出可压缩段时**压缩全部历史**。单用户回合的 agentic 会话不再出现「上下文涨到 provider 报错但从不压缩」，也不会再出现「一条线都没有」。
- 有意保留的限制：`minSourceChars`（1600 字符）、30 秒最小间隔、拒绝后抑制都原样保留——它们防的是「没内容可压」「抖动式反复压缩」「用户刚拒绝又弹」，不是「凑不齐保留回合就放弃」那类会导致静默失效的限制。（同日晚些时候用户裁定这三条也属「静默不压」应全部移除，见上文 compaction-remove-skip-gates。）

## chat-message-windowing（done，2026-10-28）

- 反馈：「当前是全量加载对话显示，希望做到窗口化，每次只加载 10 条这种渲染页面，这样多了界面不会卡顿」。
- 范围取舍（用户确认）：**只改渲染层**，服务端仍全量取数（`agent.state.messages` 恒为全量、`/restore` 仍一次拉完）；粒度**按轮 3 轮/窗**，复用现有实现而不新增「条数」维度。
- 现状盘点：`windowed-messages.ts` 能力完整（按轮切片、`loadMore` 纯本地扩窗、`showMessageIndex` 移窗、pinned 保位、toolResult 补齐），14 条单测覆盖；但 `ChatSurface` 自 `32be493` 起用 `createMessageWindow({ enabled: false })` 全量渲染，唯一理由是轮次导航要直接滚到已存在的 DOM 节点。装饰层 `messageIndexOffset` 数学、`data-message-index` / `data-window-start` 契约早已按窗口化接线，`enabled:false` 时 offset 恒 0。
- 改动：
  1. `ChatSurface.tsx` 构造点改回 `createMessageWindow()`（默认启用）。短会话仍全量：控制器自己的 `WINDOW_ENABLE_TURNS`(6) / `WINDOW_ENABLE_MESSAGES`(48) / `WINDOW_ENABLE_CONTENT_CHARS`(8 万) 门槛原样保留。
  2. 新增**填满视口兜底** layout effect：窗口内容高度不超过视口时容器没有滚动范围，宿主的 `onReachTop`（挂在 scroll/wheel 上）永远不会触发——触摸端连 `scroll` 都不会发，历史就彻底不可达。现在尾部跟随状态下继续 `loadMore()` 直到填满或到达首轮，`pageInFlight` 在下一个 window commit 回调里释放；隐藏视图（`isInsideHiddenView`，布局盒为 0）与 `clientHeight <= 0` 直接跳过，避免无限扩窗。
  3. 轮次导航不需要改：`turn-navigation.ts` 已经是「先 `showMessageIndex` 移窗 → 等 React 布局提交 → rAF 里按绝对 `data-message-index` 测量」。
  4. 测试护栏换向：`chat-surface-behavior-alignment.test.ts` 原来断言源码含 `createMessageWindow({ enabled: false })`，改为断言默认构造 + 不含 `enabled: false`，并新增一条锁住 `showMessageIndex(...).then(finish, ...)` 这条「先移窗再测量」的契约。
  5. 注释/文档同步：`message-actions.ts` 的 `messageIndexOffset` 说明从「offset 恒为 0，将来重开窗口化时才用得上」改为窗口化下的实际语义（含 extras 只追加在尾部、前 `end-start` 项保持全量下标这一前提）；`docs/wiki/src/components/README.md` 目录条目与「对话消息渲染」条目由「窗口化默认关闭」改为默认开启；`docs/architecture/session-open-fast-path.zh-CN.md` 的「仍未改动」段落补落地说明。
- 没动的：`windowed-messages.ts` 一行未改（默认值本来就是 3 轮/窗）；`chat-surface-render.test.ts` 的 `data-window-start="0"` 断言天然仍成立（该用例只有 1 轮，不触发窗口化）。
- 验证：`npm run test` → 452 files / 5290 passed / 2 skipped，1 failed = `tests/frontend/chat-surface-css-contract.test.ts`（他人未提交的 `src/styles/chat/process.css` 改动所致，与本次无关）；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`。
- 反馈跟进：「为什么从下往上翻会回弹到最下面」。根因是控制器把窗口**滑动**而不是**扩展**：`rebuild` 用 `[startOrdinal, startOrdinal + activeWindowTurns)` 切片，`loadMore` 只减小 `startOrdinal`，于是整窗内容被换成更早的一页——用户正在读的那一行随之离开 DOM，`resolveAnchorRow` 必然失败，`anchoredScrollTop` 返回 `null`，`loadMoreMessages` 的兜底把 `scrollTop` 设成 `scrollHeight - clientHeight`（对话末尾）。修了三处：
  1. **`endOrdinal` 变成控制器状态**（`windowed-messages.ts`）：`loadMore` 只前移起点、终点不动，窗口 3 轮 → 6 轮 → 9 轮……已渲染行全部留在 DOM，锚点能解析，滚动位置精确复原。补回归测试 `widens the window on loadMore instead of sliding it forward`。
  2. **`isAtTail()`**：扩展后 `atTail`（最新轮是否在窗口内）仍为 true，`resumeTail` 原来靠它早退，导致翻页后永远不重新切回尾部；改问 `isAtTail()`（`startOrdinal >= tailOrdinal`）。补两条测试覆盖「含最新轮但不是尾部窗口」与 disabled 恒 true。
  3. **`loadMoreMessages` 兜底**：不再贴 `scrollHeight - clientHeight`，改为「按上方新增高度补偿」；锚点行没存活时也不会把人扔到对话末尾。
  另外 `fillInFlight` 与 `pageInFlight` 拆成两个标志，避免填满视口的扩窗和触顶分页互相提前解锁。
- 反馈跟进二：「从上往下也是有问题的一下到底了」。根因是 `resumeTail` **主动缩窗**：`scroll-sync` 在「距底 80px 内向下滚动」时每帧调 `setPanelAutoScroll(true)` → `resumeTail` → un-pin + 重新切片，已扩展的 9 轮窗口被缩回 3 轮，脚下内容被换成尾部，看起来就是「一滚就到底」。改为**窗口只增不减**：
  1. `setFullMessages(messages, followTail)`：`followTail` = `autoScrollRef`。读者跟随尾部时 `endOrdinal` 跟到 `turnCount`（右扩，新消息可见、不卸载任何行）；读者停在历史时冻结（既不重渲染大窗口，也不换掉脚下内容）。
  2. `endPinned` 只给 `showMessageIndex` 跳转用（固定宽窗口，避免「跳到第 3 轮却挂载到第 50 轮」）；`loadMore` 显式 `endPinned = false`。
  3. `resumeTail` 不再缩窗，只清 pinned + 把右边界追到尾部（`isAtTail()` 早退避免无谓重建）。
  4. `rebuild()` 在起点与行序列都没变时复用原数组引用，避免整窗重渲染 + 装饰 pass。
  5. `scroll-sync.ts` 向下滚动 re-arm 分支补 `!autoScrollEnabled` 过渡判断，不再每帧调宿主 setter。
  窗口真正收缩只发生在会话切换（控制器重建），这是有意的取舍：宁可多留已加载历史，也不让滚动中的内容消失。
- 反馈跟进三：「从第一条往下滚动鼠标滚轮会直接到最后，没有中间的对话」。根因是窗口化只有**向上**翻页：轮次导航跳到早期轮后窗口是固定宽 `[start, start+3)`，向下滚到底时 `setAutoScroll(true)` 走 `resumeTail` 把右边界拉到 `turnCount`，中间的轮次从未挂载，所以一滚就到底。补上向下翻页：`windowed-messages.ts` 加 `hasMoreNewer()` / `loadNewer()`（内容追加在视口下方，无需锚点，读者位置不动）；`scroll-sync.ts` 加 `onReachBottom`（触底 scroll 事件 + 内容不足一屏时的向下 wheel）；`ChatPanelHost` 转给 surface 的 `loadNewerMessages()`；`setAutoScroll(true)` 只补一页而不是拉满；`setFullMessages` 的右边界改为只有「原本就在末尾（`wasAtEnd`）且读者在跟随」时才跟到 `turnCount`，跳转后的早期窗口不会被拖到末尾。`endPinned` 状态随之删除（`wasAtEnd` 覆盖了它的场景）。补三条回归测试（前向分页、到末尾停止、早期窗口不被拖到尾部）。
- Notes（与本次改动无关，未扩大范围）：全量测试 452 files 里有 1 个失败 —— `tests/frontend/chat-surface-css-contract.test.ts` 断言 `.quickforge-process-stage-body` 的缩进规则，而工作区 `src/styles/chat/process.css` 有他人未提交的改动（新增 `.qf-hl-*` 高亮规则等）。本次只改 `windowed-messages.ts` / `ChatSurface.tsx` / `scroll-sync.ts` / `ChatPanelHost.tsx` 与对应测试，未触碰 `src/styles/`。
- 风险与后续：数据层仍全量持有，长会话内存占用不变；若之后要做「连取数也分页」，需要让 `agent.state.messages` 只保留窗口、并统一 `reconcileMessagesFromSummary` / `mergeWindowedMessages` 的 offset 语义——那是独立立项级别的改动。真机需要过的点：长会话上翻触顶加载是否稳定、轮次导航点远端轮次是否一次到位、移动端手指上滚能否触发加载。

## plugin-ui-extension（done，2026-10-28）

- 反馈：「插件可以修改当前界面的功能、可以结合 UI」+「设计完整方案，goal 模式执行，同时内置一个插件创建的 skill」。
- 设计结论（详见 `docs/architecture/plugin-ui-extension.zh-CN.md`）：
  - **插件只能插入界面、不能改写界面**。`contributes.ui.overrides` / CSS 注入 / 选择器 patch 一律不做，否则设计语言每次调整都会破坏第三方插件。
  - 三档：L1 受限节点 DSL（默认路径，无代码执行）→ L2 `iframe sandbox="allow-scripts"`（不加 `allow-same-origin`，靠 opaque origin 隔离）→ L3 既有 `registerToolRenderer`（只给内置插件）。
  - 明确不动态加载宿主 React：双 React 会炸 hooks、Tailwind 4 类是编译期生成的、Vite 产物 hash 不稳定、还要兼容 Capacitor。
  - 行为类诉求归 `contributes.hooks`（服务端），界面归 slot，职责分离。
  - 进程隔离（`utilityProcess` + Node `--permission`）推迟：现在插件来源等同用户自己放置的代码，威胁模型与 Koishi / Obsidian 一致。
- 落地：
  1. `manifest.mjs`：`PLUGIN_API_VERSION` 2 + 支持列表 `[1,2]`（v1 零改动），`contributes.ui` 归一化 + 不含绝对路径的 `uiDigest`。
  2. 新增 `plugins/ui-schema.mjs`：13 种白名单 type、剥离 `style`/`className`/`html`、限额（20 顶层 / 200 总数 / 深度 6 / 8 slot / 64KB / payload 8KB）、`$slot`·`$state` 引用。**未知 type 丢弃而不是抛错**，结构性超限才整块失败。
  3. 新增 `plugins/audit.mjs`：`plugin-audit` root-array store（300 条）。
  4. `registry.mjs`：`getUiSnapshot()`（静态节点 + 可选 `getSlots` 覆盖；**只缓存 `getSlots` 产出的节点**，2s TTL，`refreshPlugins` 与成功的 `dispatchUiAction` 都会失效缓存，元信息与 KV 状态每次现算）、`dispatchUiAction()`（action 白名单 400 → 声明 slot → `ui:*` 权限 403 → 并发 4 返回 429 → 返回节点二次校验失败则丢弃）、`getPluginKv/setPluginKv`（64KB / 单值 8KB，存 `plugins.json` 的 `kv` 段，**不新增文件也不迁移**）。UI hook 的超时**在 `loader.mjs` 的调用边界上**包：`handle` 5s → 504、`getSlots` 2s → 回退静态节点；registry 只判「允不允许」，不重复计时。
  5. `routes/plugins.mjs`：`GET /api/plugins/ui`、`POST /api/plugins/:name/ui`（app client 鉴权）、`GET|PUT /api/plugins/:name/kv`、`GET /api/plugins/audit`、`GET /api/plugins/:name/assets/*`（仅声明 panels、仅插件目录内、仅白名单扩展名）。
  6. 前端 `plugin-ui-types/client/resolve/bridge` 四件套 + `PluginSlot`（白名单渲染、未知 type 返回 null、`ErrorBoundary`、空贡献不渲染外壳）+ `PluginFrame`（iframe + postMessage bridge，`event.source` 校验，放行 kv/notify/callTool）+ `PluginUiToasts`。插件页展示每个插件的 slots / actions 数 / 可点开的面板 / 声明的 `ui:*` 权限。挂载点：`ConversationHeader` → `session.header`、`ChatSurface` 的 `leadingControls` → `composer.actions`、`SidebarFooter` → `sidebar.footer`、`App` → toast。沙箱属性（有 `allow-scripts`、无 `allow-same-origin`/`allow-top-navigation`/`allow-popups`、`no-referrer`、`src` 指向 assets 路由）由 `tests/frontend/plugin-frame.test.ts` 锁死——这是整个 L2 的安全要点，不能只靠代码评审。插件页还会显示 normaliser 产出的 warnings（例如 `style`/`className` 被剥离、未知节点类型被丢弃），否则插件作者只会看到“样式没生效”却查不到原因。
  7. 内置技能 `skills/plugin-creator/`（SKILL.md + manifest/ui-slots/examples 三份参考 + `scaffold-plugin.mjs` / `validate-plugin.mjs`），加入 `defaultGlobalSkillNames`。
  8. 示例插件 `plugins/hello-ui/`（默认禁用）：L1 按钮 + 可打开的沙箱面板。`tests/server/plugins/hello-ui-example.test.mjs` 守护它——用真实 normalizer 校验 manifest、断言 slot/action/panel 与权限声明自洽、panel 入口文件存在且扩展名可服务，并禁止面板里出现 `fetch('/api...')` 与 `localStorage`（opaque origin 下必然静默失效的写法）。
- 落地时发现并修掉的真实缺陷：
  1. **registry 只在 `tools.length > 0` 时实例化插件** → 纯 UI 插件被静默跳过。改为「有工具或 UI」即实例化。
  2. **`getSlots` 不能填充未声明的 slot** —— 这是权限映射成立的前提（`ui:*` 从声明 slot 派生），已在文档写明，不做放宽。
  3. **L2 bridge 的 `callTool` 收窄成两级门禁**：只接受本插件自有工具（`plugin__<plugin>__<tool>`），再转发到 `POST /api/tools/:name`，复用既有的 `assertAccessModeAllowsDirectTool`（默认权限模式下直接执行插件工具 403）。面板不比它所在的 UI 更有权限，也不会让 iframe 去触发 agent 审批链路；`callTool` 用服务端 2 分钟预算，其余方法 5 秒。
  4. `PluginListItem` 不能引入 hooks：`tests/frontend/plugins-page.test.ts` 直接调用组件函数取元素树。面板开关状态上提到 `PluginsPage`。
  5. **`refreshPluginUi()` 没有调用方**（本轮回查发现）：启用/禁用插件、点「重新加载插件」后，服务端 catalog 已更新，但前端 slot 快照是冷加载时的那份，界面上已渲染的按钮会一直停在那里直到整页刷新。已在 `PluginsPage` 的 reload 与 toggle 两处接上，并补三条测试：刷新是**整份替换**（移除的 slot 要消失）、单个插件的 `slots` 覆盖不能动邻居、返回空节点等于把该插件从 slot 摘掉。顺带把 toast 的 `window.setTimeout` 换成 `globalThis.setTimeout`——SSR/测试里没有 `window`，原来会抛错并被当成 action 失败。
- 验证：`npx tsc -b` 0 错误；`npm run lint` 0 problems；`npm run build` 成功（`✓ built in 4.46s`）；本 feature 定向 11 files / 121 tests 全过；`npm run test` → **453 files / 5297 passed / 2 skipped，退出码 0（无排除）**。
- Notes：
  - **改了别人家的一条断言，为的是让第 13 项可达成**：`tests/frontend/chat-surface-css-contract.test.ts` 的 `process fold hierarchy contract` 原来断言 `.quickforge-process-stage-body` 的**精确刻度**（`padding-left: 0.75rem`），而该刻度正被另一个会话按用户反馈微调成 `margin-left: 0.5rem` + `padding-left: 0.625rem`。现在改为语义断言：连接线必须是 `1px solid color-mix(in oklab, var(--border) 60%, transparent)`、横向缩进必须存在且非零。这样视觉微调不再误报，但「线被删掉 / 缩进归零」仍会被抓到；同一用例里「顶层 body 不缩进、线不落到叶子节点」三条断言原样保留。**产品 CSS 一行未改**。
  - 全量与 `npm run build` 并行、或别的会话在跑重活时，会出现 1~7 个时序用例抖动（`agent-goal-*` / `scheduled-tasks.commands` / `auto-compaction*` / `windowed-messages`），单跑必过（如 `scheduled-tasks.commands` 单跑 24/24），属存量 flaky；跑全量时不要与其他重活并行。
  - 测试文件名与最初描述有一处差异：`tests/frontend/plugin-slot.test.ts` 而非 `.tsx`。项目 `vitest.config.ts` 只收集 `tests/**/*.test.{mjs,ts}`，该测试用 `createElement` 不写 JSX，改扩展名没有收益。
  - 文档与实现的偏差已就地修正：设计文档原先写「`uiDigest` 不一致时要求重新确认（前端弹授权）」，实际只做 digest 可观测；已改为如实描述，自动确认留到有第三方分发渠道时再做。安全表里「permissions 首次渲染前要求确认」改为「插件页展示 + dispatch 时强制 403」。
  - `ui-schema.mjs` 与 `PluginSlot.tsx` 在编辑过程中被工具重复追加过代码，已截断修复并复跑测试确认；后续改这两个文件建议整体重写而不是局部替换。
  - **共享文件并发写入事故**：`progress.md` / `session-handoff.md` / `feature_list.json` 在同期被多会话反复覆盖（含一次非 UTF-8 写入把换行压平成单行、`feature_list.json` 回滚掉约 10 条未提交条目）。已重编码为合法 UTF-8 并重建本 feature 的段落/条目；权威验证明细另记在 `docs/architecture/plugin-ui-extension.zh-CN.md` §15.1，因为那份文件只由本会话维护。
  - 仍未做：`contributes.hooks`（下一个最划算的扩展点，`hook-engine` 已有事件模型）、`contributes.mcpServers` / `agents`、权限授权弹窗、`settings.tabs` slot、marketplace 安装器。
  - P0 自查（2026-10-29 复核，针对已实现代码）：无 P0。落地两个 P2 加固：① `GET /api/plugins/:name/assets/*` 对 `text/html` 响应补 `Content-Security-Policy: sandbox allow-scripts` + `x-content-type-options: nosniff`（防插件 HTML 被顶层窗口打开时获得宿主同源权限），定向 10 files / 112 tests 复跑全过；② 文档 §6.3 改为如实描述鉴权基线——GET 只读端点（`/api/plugins/ui`、`/api/plugins/audit`、assets）与仓库既有风格一致不单独鉴权，POST/PUT/KV 写走 `assertAppClient`。已知存量面（非本 feature 引入）：本机模式下 `/api` POST 端点对「本机恶意网页的 no-preflight `text/plain` POST」无 Origin 校验（`isAuthenticatedAppClient` 只看源 IP），建议以后独立 feature 在 `server/index.mjs` 统一做 Origin/Host 校验。

## dreaming-beta-badge-and-review-fixes（done，2026-10-28）

- 反馈：「加一个 beta 的表示 在设置里面给这个功能 然后再评审一下」。
- Beta 标识：
  - `settings-tabs.ts` 的 dreaming 项加 `beta: true`（在 map 里统一归一成 boolean）。
  - 设置侧栏（桌面 + 移动）、tab 头部、页内标题三处渲染 `quickforge-settings-beta` 徽章；页内另挂 `InfoTip(dreamingBetaInfo)`，**不用 `title`**——移动端 hover 不可见。
  - 样式落在 `src/styles/settings/dreaming.css`，只用语义 token（`--border` / `--muted-foreground`）。
- 二轮评审发现并修掉的三处偏差：
  1. **冷笔记筛选会在短列表上失控**。笔记本来就全量注入系统提示，`recall_experience` 很少被调用，所以「从没被召回」几乎是每条笔记的常态。原实现 30 天 + 无条数门槛 = 每隔一段时间把整份列表当作删除候选塞给模型。改为 **≥ 40 条才启用** + 阈值提到 **60 天**，并补「短列表不提议删除」的测试。
  2. **统计失败被误报成写盘失败**。`syncNoteStats()` 原来和 `writeDreamingNotes()` 在同一个 `try` 里，统计抛错会写进 run 的 `error`，让人以为笔记没保存。拆成独立 `catch`，只 warn。
  3. **删除末页唯一一条后停在空页**。`removeNote` 改为按剩余条数重算目标页（`min(当前页, ceil((total-1)/pageSize))`）。
- 验证：`npm run test` → 445 files / 5205 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 评审仍不同意的一个点：`noteIdOf` 是文本哈希，**模型改写措辞 = 计数归零**。这是「笔记没有身份」的直接后果，属于有意接受；如果之后发现好笔记因为改写被当成冷的，正确做法是提高门槛，而不是给笔记加 id（那会把文件变成需要同步的结构）。
  - 删除仍无二次确认（项目风格），也没有 undo；误删的恢复路径是「回滚到该条存在时的某次 run」。

## dreaming-recall-feedback-and-note-delete（done，2026-10-28）

- 反馈：「反馈闭环（召回计数/强度衰减）需要做 还有为什么没有删除功能」。
- 删除功能为什么之前没有：设计上笔记归模型所有，只支持「下一轮重写」和「run 回滚」两种整体操作，刻意没做单条编辑。现在补上。
- 做了什么：
  1. **迁移 v18** `dreaming_note_stats`（6 列：`note_id`(=noteIdOf(text)) / `note_text` / `recall_count` / `last_recalled_at` / `created_at` / `updated_at`）。没有 FTS、没有向量、没有评分字段。
  2. **计数**：`recall_experience` 真正返回某条笔记时 `recordNoteRecall()` +1 并记时间；工具在无 SQLite 的环境静默跳过，不影响调用。
  3. **衰减的形态**：`listNoteStats()` 找出「存在 ≥ 30 天且从未被召回」的笔记，作为 `## Never recalled (deletion candidates)` 段交给模型。系统提示明确写：进入这个列表是因为没人搜过它、不是因为它错了；只有本轮也证明失效或只是重复时才删，便宜留着但丢了很贵的东西（安全红线、发布门禁、危险命令警告）不要删。
     - 这是有意的取舍：**信息而不是规则**。旧实现的 `strength` 衰减会自动淘汰，那会把「少用但关键」的规则删掉。
  4. **对齐**：每轮写回后 `syncNoteStats()` —— 新笔记载入（记 `created_at`）、消失的笔记删行；同一措辞以后重新加回来从 0 开始，不继承旧计数。文件清空时整表清空。
  5. **删除单条**：`DELETE /api/dreaming/notes/:id` 直接改 `DREAMING.md` 并删统计。因为文件是唯一真相，下一轮 dreaming 看到的已经是删过的列表，不可能复活。id 不存在返回 404。
  6. 前端笔记行显示「被召回 N 次 / 从未被召回」+ 删除按钮；notes 接口返回 `recallCount` / `lastRecalledAt`。
- 验证：`npm run test` → 445 files / 5204 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。测试覆盖：计数累加与时间戳、sync 增删行、清空、单条删除、DELETE 路由（成功 / 404）、notes 返回 recallCount、冷笔记进 prompt 段、统计随文件对齐。
- Notes：
  - 召回计数只统计 `recall_experience` 的显式命中。笔记本来就已经全量注入系统提示，所以「没被召回」不等于「没用过」——这也是为什么冷笔记只是候选，不做自动淘汰。
  - 删除了 `recall.mjs` 的 `noteIdOf` 定义，改到 `notes.mjs`（repository 与 routes 都要用它算 id，放在纯函数模块里避免把 global-memory 拉进 SQLite 层）；`recall.mjs` 保留 re-export。

## dreaming-notes-hardening（done，2026-10-28）

- 背景：对照 Claude Dreaming 的机制做了一次评审，找出 4 个偏离和 4 个实现缺陷。用户要求「都实现，但不要过度设计」。
- 全部落在**不加表、不加迁移、不加依赖**的前提下：

| 问题 | 补法 | 量级 |
|---|---|---|
| 截断方向与 prompt 契约不一致 | prompt 要求「从最重要到最不重要排序，尾部会被丢弃」 | 1 行 |
| 冲突无裁决规则 | prompt 加「最新证据优先；跨会话重复只在新说法是一笔带过时才压过它」 | 1 行 |
| 死代码：`dreaming:auto` 行过滤 | 删掉 | 2 行 |
| 无漂移防护 | `added+removed` ≥ 改前/改后较大者的 80%，且改前 ≥ 5 条 → run 仍成功但 `error` 写「可能发生了记忆漂移」 | 10 行 |
| 无来源追溯 | `operations.notesAfter` 存完整快照；`GET /api/dreaming/notes` 扫最近 50 个 run 反推每条 `firstSeen` | 25 行 |
| 无回滚 | `POST /api/dreaming/runs/:id/restore` 写回快照，无快照 409 | 18 行 |
| 会话采样无优先级 | `correctionSignals()`：用户纠正词 / assistant error+aborted 计数，预算不够时先留这些会话 | 30 行 |
| 死代码：`summarizeMemory` | 删掉 | 4 行 |

- 取舍说明：
  - 漂移告警**不阻断**——笔记是模型的判断，代码只让它显形（run 页可见 + error 文案）。
  - 来源只到 **run 粒度**，不让模型写 `evidence`（会吃掉 300 字符预算）。快照本身就是证据。
  - 回滚拒绝旧 run（没有 `notesAfter` 时 409），而不是用半个 diff 猜一个列表。
  - 采集加权会让候选会话的尾部消息被**全部读出**（最多 40 个），牺牲一点后台耗时换取「不再先丢纠正会话」。
- 验证：`npm run test` → 445 files / 5194 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。测试覆盖：排序/冲突规则写进 prompt 的断言、churn 告警（大列表触发 / 短列表不触发）、`notesAfter` 快照、restore 成功 + 无快照 409、`firstSeen` 有来源/无来源、纠正会话优先入窗口。
- Notes：
  - 仍然没有反馈闭环（召回计数/强度衰减）。这是有意保留的唯一缺口：没有「这条笔记真被用过」的证据，靠人看改动率告警兜底。
  - 前端「恢复到此版本」按钮不做二次确认——与项目其他动作用同一风格；如果后续觉得危险，可加一个 inline 确认而不是弹窗。

## dreaming-notes-file（done，2026-10-28）

- 反馈：记忆「拆分成两份应该只是共同注入到提示词而已」，dreaming 只写它自己那份。
- 结论：`~/.quickforge/MEMORY.md`（人写）与 `~/.quickforge/DREAMING.md`（dreaming 写）彻底分成两个文件，互不读写；注入时各占一个 xml 段。
- 拆掉的东西：
  1. `MEMORY.md` 里的 `<!-- dreaming:auto:begin/end -->` 标记段机制整段移除。
  2. `global-memory.mjs` 删除 `DREAMING_SECTION_BEGIN/END`、`splitMemorySections()`、`composeMemoryDocument()`、`writeDreamingMemorySection()`、`saveManualSection()`。
  3. 由此消失的一整类问题：保存 MEMORY.md 时要先读盘重拼自动区、编辑器可能冲掉机器块、要判断"有没有自动区"、要按 16KB 总预算给自动段留额度。
- 新增：
  - `DREAMING_NOTES_FILE_NAME = 'DREAMING.md'`、`dreamingNotesFilePath()`、`readDreamingNotes()`、`writeDreamingNotes()`（原子写 + 8KB 上限 + 敏感内容校验 + 内容相同则 `changed: false`）、`readDreamingNotesPrompt()`。
  - `readGlobalMemoryDocument()` 返回 `{ markdown, dreaming, path, dreamingPath }`，两份文档一次取回。
  - 系统提示新增 `<dreaming_memory source="~/.quickforge/DREAMING.md">`，与 `<global_user_memory>` 并列——分段是为了让模型区分"用户告诉我的"和"过去会话总结出来的"。
- 连带：`PUT /api/memory` 与 `manage_global_memory` 直接写 `MEMORY.md`（不再有 merge 步骤）；`/api/memory` 多返回 `dreaming`；`/api/dreaming/notes` 的 `hasAutoSection` 改名 `hasNotes`；overview 的 `memoryDocument` 改为 `{ dreamingNotes, manual }`；`counts.active/retired/superseded` → `counts.notes/runs`；前端记忆页只编辑 MEMORY.md，并在 DREAMING.md 有内容时提示"它的笔记在另一个文件"。
- 验证：`npm run test` → 445 files / 5186 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。`tests/server/dreaming-memory.test.mjs` 重写为「两个文件互不影响」的 11 例（写 DREAMING.md 不动 MEMORY.md、第二次整份覆盖、空内容清空、内容相同不写盘、敏感拒绝、8KB 上限、两份文档同时返回、独立注入块、保存 MEMORY.md 不碰 DREAMING.md、落盘互不包含）。
- Notes：
  - 项目级记忆没有由 dreaming 实现（用户明确：项目那份是手工维护的，dreaming 只写全局）。若以后要加，最省的形式是复用同一套 notes 解析，只是多一个文件路径，不要回到带 scope 字段的表。
  - 迁移 v17 已经把 `memories` 系列表删掉，本次改动纯文件层，没有新迁移。
  - 全量跑第一次时 `tests/server/scheduled-tasks.commands.test.mjs` 有一条时序用例偶发失败（`/plan inspect the release`）；单跑该文件 24 passed，复跑全量 445 files / 5186 passed，判定为 flaky，与本次改动无关，未修改。

## dreaming-notes-only（done，2026-10-28）

- 反馈：上一轮的语义召回那套「太重了」，参照 Claude Dreaming 的机制做**最简单可用**的版本。用户选 A：记忆整层退化，旧记忆直接丢弃。
- 结论：记忆 = `MEMORY.md` 自动区里的一份 bullet 列表；每轮 dreaming 读「当前列表 + 窗口内会话」，**一次**模型调用拿回「新的完整列表」，代码只校验格式/大小/敏感内容后整段覆盖。没有第二份存储，就没有同步问题。
- 删掉的东西（这是重点，不是新增）：
  1. 表：`memories`、`memories_fts`、`memory_events`、`memory_embeddings` —— migration v17 `drop_structured_memory_store` 直接 DROP，旧数据不迁移。
  2. 模块：`apply.mjs`（JSON 操作清单 + 逐条硬校验）、`vector.mjs`、`embedding.mjs`。
  3. 机制：fingerprint 去重、confidence/strength、30 天半衰淘汰、`memory_events` 逐条审计、FTS5 bm25、向量余弦 + RRF、embedding 模型设置项、向量覆盖率 UI、`POST /embeddings/backfill`、记忆行 retire、`<experience_memory>` 注入段。
  4. 代码量：`dreaming-repository.mjs` 399 → 137 行，`recall.mjs` 215 → 56 行，`prompt.mjs` 122 → 100 行，`DreamingSettingsTab.tsx` 848 → 530 行，`dreaming.test.mjs` 382 → 215 行。
- 新增：`server/dreaming/notes.mjs`（`parseNoteLines` / `normalizeNoteLines` / `composeAutoSection` / `diffNoteLines`）。
  - 笔记契约：一行一条 `- `，可选 `[fact|preference|experience|pitfall|decision]` 前缀，单行 ≤ 300 字符、≤ 60 条、整段 ≤ 3800 字节，超限从尾部截断并计入 `dropped`。
  - **掉线保护**：回复非空但一条 bullet 都抽不出（模型跑题说散文）→ run 标 `failed` 且**不写盘**；真正空回复是合法的「今天没有值得记的」，会把段落清空。
- `recall_experience`：读自动区做子串过滤（多词要求每词命中），`kind` 只匹配 `[kind]` 前缀；工具 schema 删掉 `scope`，description 改成「笔记已在你 system prompt 里，这里只是显式过滤」。
- 运行记录保留：`dreaming_runs` 仍在，`operations_json` 改存 `{added, removed, dropped}` 行 diff（旧数组形状在 `toRun` 里归一为空 diff），详情页直接显示「本次新增/移除/丢弃了哪些行」+ 模型原始回复。
- 验证：`npm run test` → 445 files / 5185 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。新增 `tests/server/dreaming-notes.test.mjs`（12 例：解析/代码围栏/标记保护/去重/截断/敏感过滤/空散文/组装上限/diff），runner 测试重写为「写回列表 + 两次运行的 added/removed + 散文保护 + 空回复清空」。
- Notes：
  - 语义召回能力随表一起消失。真要换述召回，下一步是「LLM 查询改写 + 让模型从候选里挑」，而不是把向量库加回来 —— 笔记只有几十条，全量注入本来就没有召回不准的空间。
  - `scheduled-task-runs-repository.test.mjs` 里回退到 v2 的 DROP 列表仍列着已删表，`IF EXISTS` 下无害，未清理。
  - i18n 里 `dreamingMemoryConfidence/Strength/Evidence/Retire/…` 等旧 key 仍留着（`MemorySettingsTab` 可能复用），只删了确认无引用的 `recallExperienceSessions/UpdatedToday/UpdatedDays`。
  - 未做：笔记行的编辑入口（现在只能靠下一轮运行或手工改 MEMORY.md 人工区）；如需手工增删单条，应加「编辑自动区」的危险操作而不是恢复表结构。

## dreaming-semantic-recall（done，2026-10-28）

- 反馈：向量/语义召回缺失，「感觉语义召回不是很好」。先确认事实——原先全链路只有 FTS5 trigram bm25 + `strength × 时间半衰 × confidence` 排序，中文短查询退化成 `LIKE '%…%'`，多字查询被包成整串短语，任何换述都召回不到；`progress.md:338` 早就写着「没有真正的语义相似度」。
- 方案（用户选 A）：**不内嵌模型、不用向量库**。embedding 复用用户已有的 OpenAI 兼容 `/embeddings`（Ollama / LM Studio / llama.cpp / vLLM，项目 provider 类型本来就含这四家），向量存 `memory_embeddings` 的 Float32 BLOB，Node 内暴力余弦。零新增 npm 依赖；未引入 `sqlite-vec`（要开 `allowExtension` + 随包分发 `.dll/.so` + Node 22.19/Electron 双端未验证，三条风险换不到收益）。
- 改动：
  1. 迁移 v16 `memory_embeddings`（`model / dim / content_hash / vector` + `length(vector) = dim * 4` CHECK + FK `ON DELETE CASCADE`）。
  2. 新 `server/dreaming/vector.mjs`（Float32 编解码、余弦、RRF）与 `server/dreaming/embedding.mjs`（端点候选 `base/v1/embeddings → base/embeddings → base/api/embed`，仅 404/405 换路；兼容 `data[].embedding`、`embeddings:[[]]`、`embedding:[]` 三种响应；幂等批量回填）。
  3. `recall.mjs` 新增 `recallExperiencesHybrid()`：query 向量 → 余弦（下限 0.2）→ 与 bm25 做 RRF(k=60) 融合；`recallExperiences()` 保持同步语义不变，作为降级路径。
  4. `updateMemory()` 主动删除旧向量（否则内容改了仍按旧语义排序）；`runner.mjs` 在 apply 之后、finishRun 之前回填，失败只 `warn` 并并入 run 的 `error` 字段。
  5. 设置：`dreaming-settings.embeddingModelRef`、设置页「语义召回模型 + 向量索引覆盖 + 生成向量」、`POST /api/dreaming/embeddings/backfill`、overview 的 `embedding{model,configured,resolved,embedded,total,pending}`。
  6. `server/tools/index.mjs` 的 `recall_experience` 改走 hybrid。
- 验证：`npm run test` → 445 files / 5203 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。新增 `tests/server/dreaming-embedding.test.mjs`（16 例：编解码、余弦、RRF、端点候选与回落、响应形状、幂等回填、换模型重算、改内容失效、scope 过滤、换述召回、端点失败降级、无向量降级、余弦下限）。未提交 Git。
- Notes：
  - 修了一个连带失败：`tests/server/scheduled-task-runs-repository.test.mjs` 回退到 v2 时按表名逐个 DROP，漏了新模式下的 `memory_embeddings`，导致重跑迁移撞「table already exists」——已在 DROP 列表补上。
  - 本机探测 11434/1234/8000 全部 `ECONNREFUSED`，没有本地推理服务在跑，所以端到端只有 mock 级证据。真机需要先 `ollama serve` + `ollama pull bge-m3`，把 `http://127.0.0.1:11434/v1` 作为 provider、`bge-m3` 作为 model 加进自定义 provider，再在 Dreaming 设置里选中它。
  - 语义路径刻意「只增不减」：`recallExperiencesHybrid` 在无模型 / 端点不可达 / 无向量三种情况都 `catch` 后回到纯 bm25，因此升级不会让召回变差。
  - 未做：写入侧去重仍只靠 `fingerprint` 哈希 + LLM 快照，没有用向量先筛近似重复；本轮按用户选择只改召回。

## dreaming-always-scheduled（done，2026-10-28）

- 反馈：“定时处理”这个开关可以不要，默认开了就是定时处理。
- 改法：彻底移除 `scheduleEnabled`（DEFAULT、normalize、类型、UI、路由、测试共 0 残留）。语义改为 **开启即定时**：每天 `executeTime` 自跑一次，「立即处理」只是手动提前触发。
- 连带：
  1. `tick()` 只看 `enabled`；`PUT /api/dreaming/settings` 在 enabled 时必定算 `nextRunAt`，关闭时清空。
  2. 执行时间字段现在带 ⓘ 说明（`dreamingExecuteTimeHint`），顶替被删的开关描述；旧文案 `dreamingSchedule/Description` 删除。
  3. 旧配置文件里的 `scheduleEnabled: false` 会被 normalize 直接丢弃 → 行为变成“开启即定时”，与预期一致。
- 验证：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交。


## dreaming-memory-ownership（done，2026-10-28）

- 三个问题一起修：
  1. **不显示**：从 stats 条里拿掉「MEMORY.md 自动段落」（它只是一个事实陈述，不该占位）；stats 改为「下次运行 / 上次运行 / 生效条目 / 已淘汰」，CSS 改成 `repeat(auto-fit, minmax(8rem, 1fr))`，不再写死 4 列。
  2. **不可编辑**：以前记忆页 textarea 显示整份 MEMORY.md，保存会连同自动段一起写回（可能改掉或删标记）。现在 `readGlobalMemoryDocument()` 额外返回 `manual/auto/hasAutoSection`，前端只编辑 `manual`；`PUT /api/memory` 与 agent 的 `manage_global_memory` 都走新增的 `saveManualSection()`，它从磁盘重拼当前自动段，因此人工路径无法覆盖它。记忆页在有自动段时显示一行说明。
  3. **Bug：淘汰不同步**：`POST /api/dreaming/memories/:id/retire` 以前只改 DB 行，MEMORY.md 里那一条要等下次定时运行才消失。现在淘汰后立即 `writeDreamingMemorySection(renderAutoSection(...))`，并在响应里返回 `memoryFileSynced`；写失败只记 warning，不阻断淘汰。
- 测试：新增 3 例 `saveManualSection` 行为（暴露 manual/auto、保存不动自动段、无自动段时不新增），retire 路由测试补同步断言；测试里 `vi.mock` 掉 global-memory 的写盘，避免再次污染真实 `~/.quickforge/MEMORY.md`。
- 验证：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交。


## dreaming-auto-section-copy（done，2026-10-28）

- 用户问：“MEMORY.md 自动段落 · 已开启 这是啥”。
- 实际含义：该项表示 `~/.quickforge/MEMORY.md` 里是否已存在 Dreaming 维护的标记段（`<!-- dreaming:auto:begin/end -->`）。用户机器上为有（2493 字符）。
- 问题在文案：value 复用了开关语义的 `dreamingStateOn`（“已开启”），会让人以为是另一个开关。改为「已写入 / 尚未写入」，并在标签旁加 ⓘ 说明（写在哪个文件、只改标记之间、手工内容不动）。
- 实现：i18n 新增 `dreamingAutoSectionWritten/NotWritten/Hint`；stats 项支持可选 `hint` 并渲染 InfoTip。
- 验证：`npm run test` → 444 files / 5182 passed；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交。


## dreaming-model-row-removed（done，2026-10-28）

- 反馈：主卡 stats 里的“模型 HAPI/deepseek-v4-flash · 已指定”与下方模型下拉重复，可以去掉。
- 改法：stats 第 4 项换成「自动记忆段」开/关（原本只在旧 meta 行里出现过）；模型不另占一行，而是把当前生效模型写进下拉首项——“跟随对话模型 · HAPI/deepseek-v4-flash”，选“跟随”时不再看不见实际模型。
- 连带清理：删除只服务于那行的 `MODEL_SOURCE_KEY`/`modelSourceKey` 与本地 `effectiveModel`（tsc 报 unused）；运行详情页的 `modelLabel` 保留（那是单次运行的真实记录）。
- 验证：`npm run test` → 444 files / 5182 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交（等用户确认）。


## dreaming-model-label-dedupe（done，2026-10-28）

- 现象：梦境页模型下拉里供应商名字重复，如 “GLM-4.6V (智谱) (智谱)”。
- 根因：自定义模型在 providers.json 里的 `name` 本身常写成 “GLM-4.6V (智谱)”，前端又无条件拼 `${name} (${provider})`。
- 修法：新增 `formatModelOptionLabel(name, provider)`（dreaming-data.ts）——provider 已出现在 name 里（忽略大小写）则不追加；空值单边兵底。同时过滤掉 `ref` 为 null 的模型（其 select value 会是空串，与“跟随对话模型”撞键）。
- 验证：新增 `tests/frontend/dreaming-model-label.test.ts`（4 例）；`npm run test` → 444 files / 5182 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## workflow-error-collapse（done，2026-10-28）

- 现象：`run_workflow` 失败时错误原文（服务端不截断，多段 + 「已完成步骤」清单）直接铺满聊天消息流 / 详情页，阶段与步骤被挤出可视区。
- 修法（一律「先给结论、按需展开」）：
  1. Inspector 详情 `run.error` 抽成 `WorkflowErrorBanner`：**折叠态只渲染一个错误图标**（`AlertTriangle` 图标按钮，点击就地展开原文，`aria-expanded` + `workflowErrorExpand`/`Collapse` 作 `aria-label`/`title`），展开后 `max-height: 40vh` 内部滚动，并显示「定位失败步骤」；不按长度分叉，短错误同样折叠、原文只在展开后进 DOM。
  2. `PhaseLogs` 不再「阶段有 error 级日志就默认展开」——日志一律默认收起，error 只在头部保留 `-logs-flag` 标记点（原行为会让一屏全是日志）。
  3. 聊天区无 details 的失败帧（审批拒绝、参数校验失败、worker 启动失败）抽出 `WorkflowFallbackError`，套用同一 icon-only 折叠规则。
  4. i18n 新增 `workflowErrorExpand` / `workflowErrorCollapse`（中英成对，现作用为展开/收起按钮的无障碍文案）；样式改动落在 `workflow-detail.css` 与 `goal-workflow.css`，没有新增样式文件或依赖。
- 中途调整（同日，用户反馈「只要有错误 icon 就好了，点击再展开」）：第一版是「原文 clamp 两行 + 展开详情文字按钮 + 140 字符阈值」，按要求改为 icon-only，并删除 `isWorkflowErrorCollapsible` / `WORKFLOW_ERROR_COLLAPSE_THRESHOLD`（已无消费方），少一层长度判断。
- 测试：`workflow-renderer.test.ts` 新增「失败帧折叠为 icon-only（短/长错误都折叠、原文不进 DOM、aria 文案与 40vh 样式）」「详情页错误折叠 + 日志默认收起」断言；同步修正三条原先依赖「error 文本常显 / error 日志默认展开」的旧断言。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md`（错误展示与 i18n 键）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`（两处）、`docs/wiki/src/styles/README.md`。
- 验证：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes（本次不动）：`src/components/workspace/SubagentRunDetailContent.tsx` 的 subagent 错误块（`border-destructive/50` 那段）仍是无 clamp 的全量文本，属同类问题，等有反馈再统一。


## dream-page-shadcn-layout（done，2026-10-28）

- 更正：上一轮误改了设置页**左侧导航**（并动了全局 `.quickforge-settings-subtab`，影响数据管理页）。用户明确只要改 Dreaming 页内部，已全部回滚：`git diff` 对 `SettingsWorkspacePage.tsx` 与 `shell.css` 均为空；`quickforge:open-settings-tab` 监听保留（属上一个 feature）。
- 本轮只改 `src/components/dreaming/*` 与 `src/styles/settings/dreaming.css`：
  1. **一张 Card 一块事**：状态卡（标题 + 状态点/文字 + 立即处理 + 开关）→ 4 列 stats 条（下次/上次/生效/模型）→ 2 列字段网格（模型、执行时间、记忆语言、敏感、定时），全部用 `border-t` 发丝线分隔，不再堆 5 个 settings-row。
  2. **页内 tabs 用本页自己的 segmented**：`.quickforge-dreaming-tabs`（muted 轨道 + 选中项浮起），筛选器移到同一行右侧，省掉单独一行 toolbar。
  3. **列表改成 divide-y 行**：去掉 `min-height: 5rem` 与逐行 border（会与 divide-y 双线），行 padding 统一 0.875/1.25rem，空态改为居中弱化文字而非 `settings-empty-row`。
  4. **按钮改用 shadcn Button**：`@/components/ui/button` 的 `variant=ghost|outline size=sm`（立即处理、分页、淘汰、查看、返回）。
  5. 字段布局抽出本地 `Field`（label 在上、控件在下）+ 两个常量 `CARD`/`HAIRLINE`，避免同类 class 散落。
- DESIGN_LANGUAGE 里上一轮加的「分组导航（shadcn 惯例）」收窄为「页内切换（segmented）」，并注明侧栏菜单沿用既有实现、本轮不动。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功（DreamingSettingsTab 24.19 kB / gzip 5.70 kB）；`npx tsc -b` → 0 错误。


## settings-nav-shadcn（done，2026-10-28）

- Goal：设置页这部分菜单按 shadcn 风格重排布局。
- 结论（一句话）：左侧导航从“大圆角 + 自选阴影 + 11px 分组标题”改为 shadcn 惯例——菜单项 `h-8 rounded-md px-2 text-sm`、选中 `bg-[var(--sidebar-accent)]` 且去阴影、分组标题 `text-xs`、组间 `space-y-4` 组内 `space-y-0.5`；页内切换（记忆/运行历史）从下划线 tab 改为 segmented 轨道。
- 关键判断：
  1. 去掉 `shadow-[0_8px_22px_-20px_...]`：阴影属于浮层，不该出现在导航选中态（DESIGN_LANGUAGE 也禁止“每项都有明显阴影”）。
  2. 选中态改用 shadcn 语义 token `--sidebar-accent`/`--sidebar-accent-foreground`，不再用项目自建的 `--quickforge-sidebar-active-bg`（保留变量本身，侧栏其它地方仍在用）。
  3. 分组标题 `text-[11px]` → `text-xs`：去掉任意值，与 shadcn 的 `text-xs` 一致。
  4. 页内 tab 去下划线：设置面板里已有一层左侧导航，再来一条下划线会被读成第二层导航；segmented 轨道更贴近 shadcn Tabs。
  5. 同步修正间距：原 `pb-4`（分组内 padding-bottom）改到 nav 层的 `space-y-4`，避免“组内最后一项也带 16px”导致密度不均。
- 改动文件：`src/components/settings/SettingsWorkspacePage.tsx`（菜单项/分组/返回按钮/搜索框）、`src/styles/settings/shell.css`（subtab → segmented + section 内 gutter）、`DESIGN_LANGUAGE.md`（新增「分组导航（shadcn 惯例）」一节，固定 h-8/rounded-md/text-xs/组间距/选中态禁阴影）。
- 影响面：subtab 样式由 Dreaming 与 DataSettingsTab 共用，两处同步变为 segmented（纯视觉，交互与 aria 不变）。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## dreaming-button-layout-fix（done，2026-10-28）

- 现象：设置页记忆列表里的「淘汰」按钮一会儿横排一会儿竖排。
- 根因：按钮直接作为 `.quickforge-settings-list-item`（`display:flex; justify-content:space-between`）的子元素，没有包进 `.quickforge-settings-list-item-actions`（该类才有 `flex: 0 0 auto`），按钮自身也没有 `flex-shrink: 0` / `white-space: nowrap`。内容一长就挤压按钮宽度，两个中文字被折成两行 → 看起来是“竖着”。内容短时又正常 → “一会儿横一会儿竖”。
- 修法：
  1. `.quickforge-settings-button` 全局补 `flex: 0 0 auto` + `white-space: nowrap`（按钮标签永远不该竖排）。
  2. 记忆行的「淘汰」与运行详情的「查看/收起」按钮包进 `.quickforge-settings-list-item-actions`。
  3. 新增 `.quickforge-dreaming-list` 作用域：`align-items: flex-start`（按钮钉在首行，不随内容行数上下漂移）+ actions 区 `flex-wrap: nowrap`。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## sidebar-show-more-indent（done，2026-10-28）

- 问题：项目分区的会话列表底部「显示更多」左边缘与会话标题对不齐——会话行展开态是 `px-2 + pl-8`（32px），按钮只有 `w-full px-2`（8px）。
- 修复：`SessionDisplayControls` 改用 `sidebarRowClass(sidebarOpen)`，新增可选 `sidebarOpen` / `indent` props；项目分区调用点传 `indent`，`timeline` / 全局对话不加缩进。顺带修掉收起态的偏差——原来按钮固定 `px-2` 左对齐，现在跟随会话行的 `justify-center px-0` 居中。
- 改动文件：`src/components/sidebar/chat-sidebar/SessionDisplayControls.tsx`、`src/components/sidebar/ChatSidebar.tsx`（三处调用点传 `sidebarOpen`，项目处加 `indent`）、`tests/frontend/sidebar-section-order.test.ts`（契约断言改指 `sidebarRowClass(sidebarOpen)` 并新增缩进断言）、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：`npx vitest run tests/frontend/sidebar-section-order.test.ts` → 22 passed；`npx eslint` 三个改动文件 → 无输出（0 error）；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰 `dist/` 等生成产物。
- Notes：`pl-8` 在拆分前的 `SidebarSessionRow` 里就已存在，「显示更多」此前从未跟随这段缩进，不是本轮重构新引入的回归；只是按钮与会话行共用 `sidebarSessionRowBaseClass` 后视觉上更容易被看成“共用同一行样式却没对齐”。

## rollback-inline-edit（done，2026-10-28）

- 需求：回滚不要二次确认，点一下就把那条消息就地变成输入框，改完直接发送。
- 方案（一句话）：`inline-message-editor.ts` 把「确认弹窗」换成「就地编辑 + 后续消息变淡预览」，提交时先静默截断（`rollbackForResend`）再把新文案交给 composer 的 `onSend`，复用既有的 API key 检查 / plan-mode 包装 / 乐观消息 / 滚动锚定。
- 关键取舍：
  1. **不再有确认步骤，代价改用可视线索**：该行之后的消息加 `quickforge-message-doomed`（opacity .34 + grayscale）并插入 `quickforge-removal-divider` 虚线说明「以下 N 条消息将被移除」，比弹窗里那句抽象描述更具体。
  2. **发送链路不另起一套**：装饰层不直接调 `agent.prompt`，而是回滚成功后在 panel 上轮询 `.qf-message-editor` 的 `onSend`（最多 12 帧）再发送——回滚到第一条会重建会话（新 agent + 新 surface），桥要等 React 提交后才可用；非 DOM 环境（rAF 缺失）轮询立即失败并保持编辑态。
  3. **装饰层幂等**：编辑中的行打 `data-quickforge-editing`，行循环整行短路（不重写 dataset key），避免重装饰把用户正在输入的编辑框冲掉；流式开始 / 只读切换统一 `closeInlineMessageEditors`。
  4. **保留降级路径**：没传 `onRollbackForResend` 的调用方仍走旧的 `rollback-confirm-popover.ts`，侧聊等只读场景语义不变。
- 动过的文件：`inline-message-editor.ts`（新）、`message-actions.ts`、`ChatPanelHost.tsx`、`useChatActions.ts`（抽出 `performRollback(messageIndex, restoreDraft)` + 新导出 `rollbackForResend`）、`App.tsx`、`SharedConversationPage.tsx`、`src/styles/chat/message-edit.css`（新，index.css 里紧跟 messages.css 导入）、`i18n.ts`（双语 7 条）。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。单测 `tests/frontend/inline-message-editor.test.ts`（7 例，jsdom）：预填/变淡/虚线、提交成功关闭、提交失败保持编辑态、Enter vs Shift+Enter、Esc 还原、切换行互斥、装饰层点回滚不再出 popover 且二次点击取消。
- Notes：设计稿在 `docs/design/rollback-inline-edit.html`（整屏高保真，可切「现状 / 新方案」对比）。真机待确认：编辑态气泡变宽后长文本的折行观感、以及回滚到第一条消息时（重建会话）发送是否稳定落到新 agent。
- 追加调整（真机反馈）：「这条消息及之后 N 条会被移除…」与「Enter 发送 · Esc 取消」不再平铺，收进 footer 左侧的 ⓘ 提示（hover / focus / 点击展开，靠近消息区顶部时自动翻到按钮下方），footer 只留 ⓘ + 取消 + 发送；同时去掉 textarea 的 `focus-visible` outline 与气泡外扩的 3px ring——编辑态本身（主色描边 + 光标）已表达焦点，再套一层会在气泡内部形成深色边框。输入框默认书写高度提到 `min-height: 4rem`（约 2.5 行），自增高的 `resizeTextarea` 改为 `max(scrollHeight, computed min-height)` 取值，内容只有一行时不再缩成一条细缝。——随后按用户澄清「要的是宽度」回退了高度（min-height 回到 1.6rem），改为编辑态放宽宽度：行内 margin 收到 0.25rem、气泡 `max-width: 100%`，铺满消息列。
- 宽度再调整（用户反馈「还是很短」「不要超过对话消息」）：根因是气泡是 `align-self: flex-end` 的**收缩宽度**，只写 `max-width` 根本不会变宽——短消息的编辑框始终只有一行文本那么宽。改为编辑态 `align-self: stretch` + `width: 100%`，宽度 = 对话列宽（不超出）；中途试过的「编辑时把消息列放宽到 80rem」已撤销。

## process-stage-scroll（已回滚，2026-10-28）

- 决定：用户试用后觉得「执行中 · N 个工具调用 · N 条命令」展开区被限高（`min(50vh, 18rem)` + 区域内滚动 + 执行中自动贴底）不好用，要求撤回该功能。
- 回滚范围：整条 feature 的代码 / 测试 / wiki 全部还原——`src/styles/chat/process.css`（限高与展开态滚动规则）、`src/components/chat/panel-decoration/process-folding.ts`（`resolveProcessStageScrollFollow` / `bindProcessStageScrollFollow` / `applyProcessStageStick` / `scheduleProcessStageStick` / `resetProcessStageScrollFollow` 及 `updateProcessStageGroups` 内的绑定逻辑）、`tests/frontend/process-folding.test.ts`、`tests/frontend/process-folding-incremental.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md`。
- 回滚方式：该功能是一次独立提交 `55923d4`，且 `git log 55923d4..HEAD -- <上述文件>` 无任何结果（无后续提交改动过这些行），因此直接按文件回退到父提交 `ab1ff0b0` 的版本；**没有**用 `git revert`，因为 `feature_list.json` / `progress.md` 当时已有未提交改动（`dreaming-settings-discoverability`），revert 会在状态文件上冲突。
- 保留：`feature_list.json` 的 `process-stage-scroll` 条目与 `session-handoff.md` 的记录（标注已回滚，便于日后查到这段历史，避免重复实现）。
- 验证 / Evidence：`npx vitest run` process-folding + -incremental + -ownership + chat-surface-css-contract + css-architecture → 5 files / 114 tests passed；`npm run test` 全量 → 442 files / 5169 passed / 2 skipped（= 回滚前的 5172 减掉本 feature 的 3 个用例）；`npx tsc -b` → 0 错误；`npm run lint` → 0 error；`npm run build` → 成功（built in 4.24s）。未创建 Git commit。
- Notes：回滚后「执行中 N 个工具调用」的展开区恢复成随内容全高展开（工具多时会把对话拉长、也不会自动贴底）——这是回滚预期的旧行为。`src/styles/chat/process.css` 里所有 `quickforge-process-stage*` 结构与 `PROCESS_STAGE_DEFAULT_EXPANDED = true`（内层阶段恒默认展开）属于更早的功能，未受影响。

## dreaming-settings-discoverability（done，2026-10-27）

- 现象：用户反馈“运行时候没有模型这个选项”。
- 排查结论（代码本身没问题）：直接向正在运行的实例取了模块源码 —— `GET http://127.0.0.1:5176/src/components/dreaming/DreamingSettingsTab.tsx` 返回 130 KB 转译结果，确认包含 `dreamingModel` / `dreamingModelFollowChat`；`GET /api/dreaming` 也返回 `model.effective = HAPI/deepseek-v4-flash · source=active`，说明三级解析已生效。
- 真正原因：模型选择在「设置 → 自动化 → Dreaming」，而「设置 → 记忆」页对 Dreaming **一字未提**（`MemorySettingsTab.tsx` 里没有任何 dreaming 字样），从“记忆”找入口必然找不到。
- 修法：
  1. `MemorySettingsTab` 新增 Dreaming 区块：一行摘要（状态 · 条目数 · 当前生效模型）+「打开 Dreaming 设置」按钮。
  2. `SettingsWorkspacePage` 监听 `quickforge:open-settings-tab` 自定义事件跳转页签（项目里原先没有跨页签跳转机制）。
  3. 事件监听对非 DOM 环境做了守卫：`typeof window === 'undefined' || typeof window.addEventListener !== 'function'` 直接 return——单元测试渲染该页时不提供 window。
- 验证：`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## dreaming-model-selection（done，2026-10-27）

- Goal：Dreaming 要能自由选模型；先搞清楚为什么它一直在用 智谱/GLM-4.6V。
- 根因：未指定模型时 `resolveDreamingModel()` 直接调 `resolveImplicitModelPreference(null)`，它返回**模型目录第一条**；用户第一个配置的自定义模型就是 智谱/GLM-4.6V。同时设置页根本没有模型入口，所以既不可见也不可改。
- 结论（一句话）：改成三级解析——指定 `dreaming-settings.modelRef` → 最近对话模型（`settings['active-model']`）→ 目录第一条；设置页加可搜索模型下拉（首项「跟随对话模型」），并用 `overview.model` 把**实际生效的模型与原因**显示在 meta 行。
- 关键细节：
  1. 指定的模型被删/隐藏时，`resolveModelBinding` 抛错后不中断 run，降级到下一优先级（避免凌晨定时任务直接失败）。
  2. 只有在 `active-model` 真的存在时才走第二级；否则 `resolveImplicitModelPreference(undefined)` 会返回目录第一条，被误标成“跟随对话”。
  3. 保存设置时先校验 `modelRef` 可解析，不可解析直接 400，不把坏配置留到定时触发才暴露。
  4. 模型下拉展示 `name (provider)`，宽度单组控制（`quickforge-dreaming-field-model`），不挤压其他内联设置。
- 改动文件：`server/dreaming/runner.mjs`（三级解析 + `modelLabelOf`）、`server/routes/dreaming.mjs`（overview.model + PUT 校验）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（中英文案 14 条）、`tests/server/dreaming-runner.test.mjs`（+4 例回归）、`tests/server/routes/dreaming.test.mjs`（+2 例）、设计稿 §6.1 与 §10、wiki。
- 验证：dreaming-runner 14 passed；routes/dreaming 11 passed；`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 「跟随对话」用的是 `active-model`，即用户最近一次在对话里选中的模型；它不会随每个会话的临时切换变动。
  - 视觉模型（如 GLM-4.6V）用于文本摘要不是错误但浪费；现在用户可以在下拉里直接换成纯文本模型，代码不做能力判断。


## dreaming-ui-polish（done，2026-10-28）

- Goal：在 dreaming-ui-and-language 的结构上做第二轮 UI 精修——更美观、简洁、易用，不动后端。
- 结论（一句话）：状态不再只靠点的颜色表达（点旁永远拼同色调状态词）；徽章去碎（作用域下沉到 meta 行、名词挂 `title` 数字裸排）；内联设置与 meta 行之间加 hairline 分层；折叠箭头换 lucide chevron 旋转；搜索去掉按钮改为 300ms 防抖自动查询。
- 具体改动：
  1. 头部：标题从「开启 Dreaming」（开关的 label 兼标题，语义重复）改为功能名「梦境记忆」+ 状态文字（已开启/已关闭/进行中/上次运行失败，与状态点同色）；开关补 `aria-label`；meta 行去掉与 subtab 重复的「已淘汰」计数、自动区段两句长文案换短句（`dreamingAutoSectionOnShort/OffShort`）；保留并行会话新增的「生效模型」行。
  2. 记忆行：`ScopeBadge` 降为 meta 行文字（`全局 · 0.86 · 4.2 · 时间`），落地既有设计决策「数字裸排 + 名词挂 title」；行内徽章从 3 个收敛到 2 个（类型 + 召回次数），召回徽章带 `title`（`在对话中被召回 N 次`）。
  3. 运行行/详情：`+N/~N/-N/✕N/耗时` 每格补 `title` 全称；变更/衰减区的 `0.86 / 4.2` 裸数字徽章、读取内容区的消息数/字符数徽章同样补 `title`；折叠箭头由字符 `▸/▾` 换为 lucide `ChevronDown` + `--quickforge-dur-fast` 旋转（`data-open` 驱动，符合设计语言“动效挂 data 不挂 class”）。
  4. 筛选：删掉「搜索」按钮与回车触发，输入 300ms 防抖自动查询，状态下拉切换即查询（两者行为统一；首帧由初始加载覆盖，`useRef` 跳过首次）。
  5. CSS：`dreaming.css` 新增 `.quickforge-dreaming-status-text`（含 data-state 着色与 `·` 分隔）、`.quickforge-dreaming-chevron`（旋转过渡）、`.quickforge-dreaming-settings` 顶部 hairline。
- 改动文件：`src/components/dreaming/DreamingSettingsTab.tsx`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（新增 8 条双语）、`docs/architecture/dreaming-memory.zh-CN.md`（§10 页面结构描述同步）。
- 验证 / Evidence：`npx tsc -b` → 0 错误；`npx eslint` 改动 ts 文件 → 0 问题；`npx vitest run tests/frontend/{i18n-language-snapshot,settings-workspace-react,quickforge-settings-select,recall-experience-renderer}.test.ts` → 4 files / 45 passed；`npm run build` → ✓ built in 4.66s。
- 追加修复（同轮，2026-10-28）：真机出现 `Cannot read properties of undefined (reading 'available')` 崩溃（DreamingSettingsTab modelOptions）——崩溃行来自并行「模型选择」改动（`overview?.model.available` 只保护了 `overview` 没保护 `.model`），触发环境是**旧 server 进程**返回的 overview 无 `model` 字段（磁盘上 `server/routes/dreaming.mjs` 已总是返回该字段，5176 端口上有一个更早启动的实例在应答）。处理：`DreamingOverview.model` 改为可选类型 + 前端三处访问全部设防（`overview?.model?.available`、meta 行经局部 `effectiveModel` 收窄），旧 server 下页面降级显示「无模型」而不是整页崩。验证：tsc 0 错误、eslint 0 问题、settings-workspace-react + i18n 快照 23 passed。用户侧需重启旧的 dev server 进程才能看到完整的模型信息。
- Notes：
  - 开发态偶发崩溃：首次打开 Dreaming 页曾出现 `SettingsSelect` → `visibleSelectIndexes` 的 `option.label.toLowerCase()` TypeError（疑似 Vite 首载陈旧模块 + HMR websocket 失败的缓存现象，整页刷新后不可复现；相关 key 在 en/zh 双语均已确认存在）。`t()` 对缺失 key 会静默返回 undefined，缺 en 回填时任何消费 `label` 的组件都会整页崩——建议后续给 `t()` 加开发态缺 key 警告或给 `visibleSelectIndexes` 加防御，属共享组件改动，未在本次范围处理。
  - `dreamingMemorySearch`（搜索按钮文案）与 `dreamingAutoSectionOn/Off`（长文案）在本次改动后无生产消费方，保留未删（repo 有留档先例）。
  - 并行会话在 DreamingSettingsTab 里新增了「模型」选择（`modelRef` / `overview.model`），本轮改动已与其合流：meta 行保留生效模型、内联设置含模型下拉；其数据层细节见对应 feature 记录。

## dreaming-ui-and-language（done，2026-10-27）

- Goal：`Dreaming` 设置页要更简洁易用；同时修掉“用户中文对话、沉淀出的记忆却全是英文”的语言对齐问题。
- 结论（一句话）：语言不能靠提示词自觉——“write in the user's language” 被英文系统提示词淹没；改为代码从 **user 消息**里判定（CJK 字权重 ≈ 4 个拉丁字母，样本不足 12 个字母返回 null），再以 `## Output language` 硬要求写进 user message，设置项 `contentLanguage` 可覆盖，判定结果入库并在详情页显示。
- UI 改动：
  1. 原来的四组 settings-row（开关/定时/时间/敏感/运行/计数/自动区）压成一个「头部状态块」：状态点 + 开关 + 立即处理按钮；第二行单行 meta（下次/上次/生效/淘汰/自动区）；第三行内联设置（执行时间、记忆语言、敏感内容、定时开关）。
  2. 记忆列表与运行历史合并为一块，用 subtab 切换并带计数，避免两个长列表垂直堆叠。
  3. 运行历史改为整行可点的按钮式行：状态徽章 + 时间 + 单行指标（会话/+新增/~更新/-淘汰/✕拒绝/耗时）+ 结论，指标用语义色区分不加重底色。
  4. 详情页改为「状态条 + 统计条 + 元信息一行 + 可折叠分区」，读取内容/变更/拒绝/衰减/原始响应默认收起，减少滚动。
  5. 新增 `src/styles/settings/dreaming.css`（状态点含 running pulse 与 `prefers-reduced-motion` 降级），其余仍用既有 settings 令牌。
- 改动文件：`server/dreaming/{collect,prompt,runner,settings}.mjs`、`server/sqlite/{migrations,dreaming-repository}.mjs`（v15 `content_language`）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`（新）、`src/styles/index.css`、`src/lib/i18n.ts`（语言文案 14 条）、`tests/server/{dreaming,dreaming-memory,dreaming-runner}.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`。
- 验证 / Evidence：五个 dreaming 测试文件 → 58 passed；`npm run test` → 442 files / 5166 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功（DreamingSettingsTab 21.46 kB / gzip 4.79 kB）；`npx tsc -b` → 0 错误。
- Notes：
  - 已经存下的英文记忆不会自动重写——它们会在后续 run 里被 `update`/`supersede` 逐步替换为中文；想立刻重置只能在记忆列表里手工淘汰。
  - 判定只在“样本足够”时生效；纯代码会话会得到 `null`，此时提示词退回“跟随 transcript 语言”而不是瞎猜。
  - 记忆列表的置信度/强度仍显示在 meta 行，没有做成图表：这两个值目前只用于排序与淘汰阈值，做成可视化会夸大其精度。
- 补充（同轮）：真实 `~/.quickforge/MEMORY.md` 里已经有一批旧版写出的英文条目。为了不产生中英重复，提示词在 `## Existing memories` 后新增一句：已有条目若仍是另一种语言，应使用 `action="update"` 就地改写为目标语言，而不是为同一事实新建一条。这样历史条目会在后续 run 里逐步转成中文。


## workflow-docs-sync-to-code（done，2026-10-27）

- Goal：以**最终代码**为准同步 run_workflow 的文档，**不改任何代码**；并回答「当前并发是多少」。
- 结论（一句话）：默认权限下并发**恒为 1**（`effectiveConcurrency = hasFullAccess ? options.concurrency : 1`），只有完全访问模式才用 `options.concurrency`（默认 4、上限 8）；文档里「4 并发」的表述会让人误以为是常态，已改为「默认权限串行 1 / 完全访问默认 4」。另外修掉 6 处文档与实现不符的点。
- 关键对照（每条都落到行号）：
  1. **并发**：`agent-workflow-runner.mjs:236`。附带发现 `details.concurrency` 上报的是**生效值**（默认权限下恒 1），不是调用方传入值 —— UI 上看不出「配了 4 被降级」。
  2. **hooks 失败语义**：只有空/非字符串 prompt（`worker.mjs:250`）、空 tool name（`:260`）、`args` 非 plain object（`:263`）在 guest bridge 内抛 `TypeError`；其余参数错误（prompt 超长 `:165`、未知 option `:102`、schema 不可序列化/超限 `:106-113`、未知 tool option `:132`）由 `hostCall` 捕获后以 `ok:false` 回投 → `agent()`/`tool()` 返回 `null`。原文档说「参数非法会 throw」，与实现不符。
  3. **`phase()` 超 120 字符**：`phase` 是 notify 型消息（无 `requestId`），父进程 `normalizePhaseTitle` 校验失败后走 `if (!id) return`（`worker.mjs:191`）**静默丢弃**。脚本内 `currentPhase` 已更新，但该阶段不进 `details.phases`，后续 `log()` 归到上一阶段。原文档写「超 120 字符 throw」，是错的。
  4. **`schema` 未透传**：`runner.mjs:548-558` 调 `runAgent` 时只传 `prompt/profile/label/context/expectedOutput/workflowLabel/maxRuntimeMs/maxToolCalls/model`；`subagent-runner.mjs:347-351` 的 `schemaHint` 依赖 `params.schema`，工作流路径不会传 → 分支永不生效。所以 workflow 里的 `schema` 是**纯后置断言**，模型看不到契约，写散文时更容易返回 `null`。
  5. **中止/孤儿错误文本**按步骤位置区分：队列 Agent `Workflow stopped before this agent started.`、队列工具 `...before this tool call started.`、运行中 `Workflow stopped while this step was running.`（超时/父中止）或 `Workflow completed before this step settled.`（脚本已 return）。`markRunningStepsStopped` 是**同步**标记，因为 abort 后在途步骤是异步 settle 的。
  6. **details / 前端**：Agent record 漏了 `seq`；`subagentRun` 实际透传 16 个字段（补全 `subagent`/`sessionId`/`parentSource`…）；聊天卡跑马灯内容是**最后一个阶段标题**（`workflow-tool-renderer.tsx:108`），不是活跃步骤 label；`MaxWorkflowRunSnapshots` 是 50 不是 100（原文写「100→50」）；`workflowActiveStepLabels` 已无生产消费方（仅测试引用）。
- 改动文件（纯文档）：
  1. `docs/architecture/workflow-orchestration.zh-CN.md` — §2.1 模块表（补 `workflow-run-payload.ts` / `WorkflowRunDetailContent.tsx`）、§2.4 toolset 懒构建、§3.1 hooks 失败语义、§3.3 schema 边界、§4 并发与预算补充、§5.2/5.4 中止文本、§7.1 Agent record `seq` 与 `subagentRun` 字段、§7.2/7.3 前端契约合并重写（跑马灯、单行卡、实时通道、i18n 残留键、样式类清单）、§9 测试覆盖、§10 相关文件带行数。
  2. `docs/wiki/README.md` — 项目概览的并发表述（默认串行 1 / 完全访问默认 4）。
  3. `docs/wiki/server/README.md` — run_workflow 段：有界队列并发（生效值）、worker 协议补 phase/log 无 requestId、孤儿文本、schema 后置校验、toolset 懒构建缓存、限制表补 parallel/pipeline 256 与 bridge 5s、details 形状。
  4. `docs/wiki/src/lib/README.md` — 4 个 workflow 文件的行数与描述（549/190/149/135），渲染器契约（跑马灯取最后阶段、`activeWorkflowRunStore` 驱动 `data-open`、展开体已删的类清单）、残留 i18n 键。
  5. `docs/wiki/src/components/README.md` — 详情页条目补「样式已无 `--wf-tl-*`」与概览派生统计的显隐条件；历史段落加已移除提示。
  6. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `node -e "JSON.parse(...)"` → `feature_list.json` 语法 OK。
  - `git status --porcelain` → 本 feature 只涉及 5 个 md + 3 个记录文件；未触碰 `server/`、`src/`、`tests/`、`dist/` 等生成产物。
  - 逐条取证行号见「关键对照」。
- Notes：
  - **没有跑 `npm run test` / `lint` / `build`**：本轮零代码改动，这些门禁不会因文档变更而受影响。若需要门禁记录可单独跑一次。
  - 发现 3 处「代码 vs 文档」的实质问题（schema 未透传、参数校验错误类型不统一、`phase()` 静默丢弃），按「不要改代码」的要求**只写进文档**，未修。
  - 建议后续单独决策是否修 `schema` 透传（1 行改动，能显著降低 workflow 里 `agent({schema})` 的失败率）。


## recall-experience-tool-card（done，2026-10-27）

- Goal：`recall_experience` 在聊天里没有专属样式，只有兜底卡（工具名 + 整段 JSON），且 `count: 0` 会被渲染成绿色对勾，读起来像“成功查到了什么”。
- 结论（一句话）：新增专属渲染器 —— 折叠态一行读完（灯泡图标 + 回忆经验 + `· query` + 命中计数 + 状态），展开态是结构化经验列表（kind/scope/×recallCount + 正文 + 质量指标），并把「0 命中」重新定义为**正常结果**而非成功对勾 + JSON。
- 关键取舍：
  1. **计数分两种可见性**：命中时 `meta-hover`（默认隐形，避免每个工具行都挂一个数字）；0 命中时 `meta-important` 常显——因为「没查到」本身就是这次调用的结论。
  2. **0 命中与失败互斥**：`count === 0 && status === 'done'` 才渲染 `.quickforge-recall-empty` 中性说明；`isError` 走 `renderConsoleBlock(..., 'error')` + destructive 图标。旧兜底卡两者都不区分，是这次的主要体感问题。
  3. **正文不截断**：用户展开卡片就是为了读全文，`line-clamp` 只省一次点击但会藏掉关键限定条件。
  4. **质量指标不带标签**：行内 `0.86 · 4.2 · 2 个会话 · 3 天前` 已够读，完整名词挂在各段 `title` 上（`dreamingMemoryConfidence` / `dreamingMemoryStrength`），避免辅助信息抢正文层级。
  5. **复用而非新建视觉语言**：行配方复刻 `.quickforge-todo-history-item`（无分隔线、hover 仅 `muted 55%` 轻背景、无位移/边框/阴影）；颜色全走语义 token，暗色零覆盖；不自造 keyframes，运行态借用 `quickforge-tool-running-sweep`。
  6. **视图模型独立成纯函数**（`recall-experience-history.ts`）：只认 `details.type === 'recall_experience_result'`，其余返回 `available:false` 不伪造列表；空正文行整条丢弃；`confidence` 夹 0–1、`sessionCount` 按 evidence sessionId 去重（与设置页 `MemoryRow` 同口径）。
  7. **顺手补齐三处遗漏**：`renderToolIcon` 的 if 链（否则回落扳手图标）、`summarizeParams` 分支（subagent 跑马灯复用同一套摘要规则）、`approval-card` 的 `BUILTIN_TOOL_LABELS`（审批卡原本会显示原始工具名）。
- 改动文件：
  1. `src/lib/recall-experience-history.ts`（新，101 行）— 视图模型 + `recallRecencyDays`。
  2. `src/lib/tool-renderers/recall-experience-tool-renderer.tsx`（新，151 行）— 渲染器。
  3. `src/lib/tool-renderers/shared.tsx` — `renderToolIcon` 加 `recall_experience`（灯泡）分支。
  4. `src/lib/tool-renderers/index.ts` / `src/lib/local-tools.ts` — 导出 + `registerToolRenderer`。
  5. `src/lib/tool-param-summary.ts` — `recall_experience` 取 `query`（修剪空白）。
  6. `src/components/chat/panel-decoration/approval-card.ts` — `recall_experience: 'recallExperience'`。
  7. `src/lib/i18n.ts` — 9 个键 × 2 语言（标题/最强记忆/命中计数/无匹配/两条空态说明/会话数/今天/N 天前）。
  8. `src/styles/chat/tool-output.css` — `.quickforge-recall-{list,item,meta,kind,content,metrics,sep,count,empty}` + `.quickforge-recall-tool > div .text-xs`。
  9. `tests/frontend/recall-experience-renderer.test.ts`（新，16 例）、`tests/frontend/tool-param-summary.test.ts`（+2 例）。
  10. `docs/wiki/src/lib/README.md` — 渲染器条目 + 视图模型小节 + 文件表行。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/recall-experience-renderer.test.ts tests/frontend/tool-param-summary.test.ts tests/frontend/tool-renderer-registry.test.ts tests/frontend/chat-surface-tool-message.test.ts` → 4 files / 41 passed。
  - `npm run test` → 442 files / 5160 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 问题；`npx tsc -b` → 0 错误；`npm run build` → ✓ built in 9.89s（仅既有 chunk 体积 warning）。
- Notes：
  - 未跑「发布」流程，未创建 Git commit（用户未要求）。
  - 折叠态**不做** kind/scope 药丸：`DESIGN_LANGUAGE.md` 已否掉「折叠态堆状态短条」，这些信息只在展开态出现。
  - `renderToolIcon` 仍是 if 链而非映射表，每次新增工具都要改两处（`shared.tsx` + `local-tools.ts`）；本次未重构，留作后续独立 feature。
  - 未验证真机视觉：建议实际跑一次 `recall_experience`（有命中 / 无命中各一次）确认 hover 计数与列表行距在暗色下符合预期。

## schema-version-test-hygiene（done，2026-10-27）

- Goal：结束“每次升 schema 都要在 7 个测试文件里改同一个版本号”的 churn，同时不引入恒真断言。
- 结论（一句话）：**不是**把数值断言都换成 `SQLITE_MIGRATIONS.length` 推导，而是直接删掉“等于最新版本”这类断言（它对迁移写坏完全没有分辨力），把价值留在能真正抓 bug 的地方——历史迁移边界的显式字面量、迁移行与迁移表逐项对齐、版本号连续性与 `user_version === 已应用行数`、以及表/列/索引/数据内容。
- 关键取舍：
  1. `const LATEST_SCHEMA_VERSION = SQLITE_MIGRATIONS.length` 只是把 churn 从 7 处收敛到 1 处，测试依然在重述实现；`expect(health().schemaVersion).toBe(SQLITE_MIGRATIONS.length)` 永远为真，迁移少写一列、漏建索引它都抓不到。故直接删除。
  2. 历史边界必须写死：`slice(0, 11)` 后验“v11 runtime 拒绝新库”、`migration 12` 故意失败验回滚、v7→v8 / v8→v9 / v2→v3 回滚——这些是“某个历史版本之前的库”这种事实。改成从当前列表推导会静默从“测那一条迁移”漂移到“测最新两条”。
  3. 迁移行断言改为与 `SQLITE_MIGRATIONS` 逐项比对（`version/name` 全等）：既能抓改名/重排/重复，又不写死版本号。
  4. 并发初始化断言改为“版本号连续 + `user_version` 等于已应用行数”，语义是“没重复、没漏”，与原 `COUNT === 版本号` 等价但不依赖具体数字。
  5. electron smoke fixture 里的裸 `schemaVersion: 14` 改成读实际 `health()` 输出，并校验 `schemaVersion === migrationCount`。
  6. helper 收窄为“构造用”而非“断言用”：保留 `LATEST_SCHEMA_VERSION`（构造“列表之后一条”的失败迁移）与新增 `NEXT_SCHEMA_VERSION`，并在注释里写明它不该用于版本断言。
- 改动文件：`tests/helpers/sqlite-schema.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`tests/server/scheduled-task-runs-repository.test.mjs`、`tests/server/session-state-repository.test.mjs`、`tests/server/share-repository.test.mjs`、`tests/server/lan-access-repository.test.mjs`、`tests/fixtures/session-state-full-chain-electron-smoke.mjs`、`tests/server/session-state-full-chain-electron-smoke.test.mjs`。
- 验证 / Evidence：
  - `npx vitest run` 5 个 schema 相关仓库测试 → 5 files / 61 passed。
  - `npx vitest run tests/server/session-state-full-chain-electron-smoke.test.mjs` → 1 passed。
  - `npx eslint` 上述 8 个改动文件 → 0 problems。
- Notes：
  - 本次未跑全量 `npm run test` / `npm run build`（非发布改动，改动集中在测试与 fixture）；如需发版仍须完整跑三项。
  - `scheduled-task-runs-repository.test.mjs` 里 `DELETE FROM schema_migrations WHERE version >= 3` 与 `PRAGMA user_version = 2` 也是历史边界字面量，刻意保留。
  - `package-dist/`、`package-offline/` 内的同名 `migrations.mjs` 未触碰（生成产物）。

## dreaming-run-detail（done，2026-10-27）

- Goal：Dreaming 只取会话的「user 消息 + assistant 最终回答」（含压缩摘要），总预算 100k 字符；并为运行详情页补齐可追溯的数据与 UI。
- 结论（一句话）：采集层从「全消息投影 + 工具结果首尾截断」改为「只投影 user 与最终回答」——工具调用与工具输出根本不进 prompt，因此不需要任何截断启发式；「最终回答」用 `no toolCall && stopReason ∉ {toolUse,error,aborted}` 判定，顺带把过程式中间消息与被中断回复排除掉。
- 关键取舍：
  1. 压缩摘要保留且单独标记为 `history(compacted)`：它以 user 角色存储，是那段被压缩历史的唯一可见形式，丢了等于丢掉历史；提示词里明确它证据强度更弱（置信度上限 0.7）。
  2. evidence 从 `sessionId+seq` 改为 `sessionId+note`：transcript 已无行号，保留 seq 是假精度。
  3. 运行详情新增 v14 四列（`model_label/input_chars/sessions_json/raw_response`）：窗口内会话可能超出保留期，事后再也复现不出“当时送了什么”，所以采集时就把每会话投影文本裁到 1200 字符存库。
  4. rejected 保留模型原提案（kind/scope/content/targetId）：只存 reason 无法区分“规则太严”和“模型跑偏”。
  5. 详情页额外返回 `memories`（本次触及条目当前状态），前端一次请求即可渲染“提案 vs 库中结果”的 diff。
  6. schema 版本断言改为从 `SQLITE_MIGRATIONS.length` 推导（新增 `tests/helpers/sqlite-schema.mjs`）：此前每次升 schema 都要手改 7 个测试文件的同一个字面量，已连续踩两轮。
- 改动文件：
  1. `server/dreaming/collect.mjs` — 重写 `projectMessages()`（user + 最终回答 + history(compacted)），新增 `isFinalAnswer()`、`SESSION_PREVIEW_CHARS`，预算改为单会话 30k / 整体 100k，返回带 preview 的 `sessions`。
  2. `server/dreaming/prompt.mjs` — 系统提示改为说明 transcript 只含 user 与最终回答；新增 Transcript format 段；`history(compacted)` 置信度约束。
  3. `server/dreaming/apply.mjs` — evidence 去掉 seq。
  4. `server/dreaming/runner.mjs` — createRun 写 modelLabel/inputChars/sessions；finishRun 写 rawResponse；rejected 保留原提案。
  5. `server/sqlite/migrations.mjs` — v14 `dreaming_run_details`（4 个 ADD COLUMN）。
  6. `server/sqlite/dreaming-repository.mjs` — toRun/createRun/finishRun 支持新列。
  7. `server/routes/dreaming.mjs` — detail 返回 `memories`，事件收集覆盖 replacementId。
  8. `src/components/dreaming/dreaming-data.ts` / `DreamingSettingsTab.tsx` — 详情页六段式（概览 / 读取内容 / 变更 / 拒绝 / 衰减 / 原始响应），`OperationRow` 同时显示提案与库中结果。
  9. `src/lib/i18n.ts` — 14 个新文案（中英）。
 10. `tests/server/dreaming.test.mjs`（采集用例外重写 + 压缩摘要/中断回复两例）、`tests/server/routes/dreaming-detail.test.mjs`（新，3 例）、`tests/helpers/sqlite-schema.mjs`（新）、5 个 schema 版本测试改为推导、fixture 升到 14。
 11. `docs/architecture/dreaming-memory.zh-CN.md`（采集/提示词/数据模型/前端详情三节）、`docs/wiki/server/README.md`。
- 验证 / Evidence：
  - `npx vitest run tests/server/dreaming.test.mjs tests/server/dreaming-memory.test.mjs tests/server/dreaming-runner.test.mjs tests/server/routes/dreaming.test.mjs tests/server/routes/dreaming-detail.test.mjs` → 52 passed。
  - 5 个 schema 版本测试 → 61 passed。
  - `npm run test` → 441 files / 5144 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 100k 是**字符**不是 token。按 3 字符/token 粗算约 33k token；若只想按 token 计，改 `MAX_TOTAL_CHARS` 即可（单处常量）。
  - 不含工具输出后，模型只能依据“用户说了什么 + 助手最后答了什么”判断。这意味着**它看不到具体命令与报错文本**，所以 pitfall 类记忆会偏向“现象 + 结论”而不是精确命令；这是用 100k 预算换覆盖面的直接代价。
  - `sessions_json` 每会话存 1200 字符预览，40 会话上限时单行最大约 48KB，仍在 SQLite 常规行大小内，无需拆分。


## dreaming-memory（done，2026-10-27）

- Goal：新增全自动 Dreaming 后台记忆固化——回看已结束会话，沉淀结构化长期记忆，并在后续任务中自动检索使用。
- 结论（一句话）：四个动作（提取事实/总结经验/识别错误/更新认知）全部交给一份提示词，代码只做硬校验后单事务落库，因此既保持“全自动”又不会让模型幻觉直接污染记忆库；检索用 SQLite 自带 FTS5 trigram，不引入新依赖。
- 关键设计取舍：
  1. 不做独立进程 worker，改做 server 内子系统 `server/dreaming/`：desktop/Android 共用同一 server，多进程会带来打包与退出成本；要的是逻辑隔离（独立设置、独立 run 记录、独立单飞锁）。
  2. MEMORY.md 分人工区与 `<!-- dreaming:auto:begin/end -->` 自动区，自动区整体重写、人工字节逐字保留——全自动写入若沿用“全量替换”必然覆盖人工内容。
  3. 记忆不只存 MEMORY.md，还落 SQLite 结构化经验库（kind/confidence/strength/evidence），才可能做“更新认知”与“淘汰”而不靠模型自觉。
  4. 淘汰判据只用可观测量（strength<1 且 confidence<0.5 且 30 天未召回，三者同时满足），不用“模型决定忘掉”；淘汰是软删，可追溯。
  5. 中文检索：默认 unicode61 分词器无法匹配中文子串，实测 trigram 可以；不足 3 字符的查询回退 `LIKE`（表规模小，代价可忽略）。
- 改动文件：见 `feature_list.json` 的 `dreaming-memory` 条目（设计稿、migration v13、server 模块、前端设置页、4 个新增测试、6 个受 schema 版本升级影响的既有测试、3 个 wiki 页）。
- 验证 / Evidence：
  - 四个新增测试文件 → 48 passed。
  - `npm run test` → 441 files / 5127 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 error / 0 warning；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - schema 从 v12 升到 v13，6 个既有测试硬编码了“最新版本=12”，已同步；其中 `sqlite-storage-foundation` 的表清单断言额外包含 FTS5 的 5 张影子表（`memories_fts_*`），这是 SQLite 正常行为，不是新增业务表。
  - 测试隔离教训：`global-memory.mjs` 与 `storage.mjs` 在 import 时就从环境变量解析数据目录，route/runner 测试必须 mock 这两个模块，否则会写真实 `~/.quickforge/MEMORY.md` 与 `config/settings.json`（本轮已发生并已清理）。
  - 已知边界：单次 run 只做一次模型调用（不做 tool-calling 多轮），成本可预测但模型无法回看 transcript 细节；采集预算（单会话 6000 字符 / 总量 60000 字符 / 最多 40 会话）在代码里封顶，不靠模型自觉。
  - 尚未做：跨设备记忆同步、向量检索、per-session 记忆；`recall_experience` 目前只按 FTS5 + strength/新鲜度排序，没有真正的语义相似度。


## fork-session-visible-immediately（done，2026-10-27）

- Goal：fork 出的新对话必须马上出现在左侧会话列表，而不是等用户再发一条消息。
- 结论（一句话）：根因是服务端 `createAgent` 从不持久化——创建期唯一那次持久化依赖「首条 user 消息 message_end」，而 fork 预置了 messages 时 `sessionCreatedEmitted` 直接为 true、该分支永久跳过，会话索引里查不到；修法是在 `createAgent` 返回前对 `messages.length > 0` 且非 restore 的会话 `await persistSession(session)`。
- 改动文件：
  1. `server/agent-manager.mjs` — `createAgent` 末尾新增创建期持久化（`messages.length > 0 && typeof config.persistedStateJson !== 'string'`），失败只记日志不阻断创建；不调用 `emitSessionEvent`。
  2. `server/agent-persistence.mjs` — `sessionLastModifiedFromMessages` 改为 `max(末尾消息时间, createdAt)`，避免继承旧历史时间戳的 fork 被排到列表底部。
  3. `src/hooks/useChatActions.ts` — `forkFromMessage` 传 `refreshSessions: false`（由 createAgent 内部那次负责），并去掉 `if (storage)` 门禁；同时移除已无用的 `storage` 局部变量。
  4. `tests/server/agent-manager.persist-session-state.test.mjs` — 新增 3 例：seeded 会话创建即落库且 `lastModified` 为 now、无消息创建仍不落库、restore 不重写（revision 不变）。
  5. `tests/frontend/fork-session-visibility.test.ts`（新） — 4 例源码契约：创建期持久化存在且排除 restore、创建期不发事件、fork 刷新不被 storage 门禁、`refreshSessions:false` 去重。
  6. `docs/wiki/server/README.md` / `docs/wiki/src/hooks/README.md` — 记录 createAgent 持久化时机与 `lastModified` 语义。
- 验证 / Evidence：
  - `npm run test` → 437 files / 5119 passed / 2 skipped，退出码 0。
  - `npm run lint` → 0 error / 0 warning。
  - `npm run build` → ✓ built in 7.06s。
  - `npx tsc -b` → 0 错误。
  - 定向：`agent-manager.persist-session-state` 37 passed；agent-manager 相关 9 文件 72 passed；`fork-session-visibility` 4 passed。
- Notes：
  - 早期尝试在该处发 `session_created` 并置 `sessionCreatedEmitted`，会额外消耗一次 `stateVersion`（既有断言 3→4 被抓到），已改为只写库不发事件：创建端自己会 `refreshSessions`，其他端通过索引读到即可。
  - `/summary` 的 fork 路径本来就显式 `persistSession`，不受此缺陷影响；本轮修复让普通 fork 与之对齐。
  - 创建期持久化是同步 await，会让 `POST /api/agents/:id` 多一次 SQLite 写；仅限带 messages 的创建（fork/seeded），空会话创建不受影响。

## fork-title-prefix（done，2026-10-27）

- Goal：fork 出来的新对话在会话列表里要能一眼看出是分叉，先用标题 `[fork]` 前缀解决（不做溯源字段）。
- 结论（一句话）：fork 路径改用 `generateForkTitle()`，新会话标题为 `[fork] + 首条用户消息`；前缀独立于既有 46 字符预算，正文截断规则不变，普通会话标题零影响。
- 改动文件：
  1. `src/lib/message-utils.ts` — 新增 `FORK_TITLE_PREFIX = '[fork] '`、`generateForkTitle(messages)`；`generateTitle(messages, prefix = '')` 增加可选前缀参数（前缀在多语言下统一，不本地化）。
  2. `src/hooks/useChatActions.ts` — `forkFromMessage` 由 `generateTitle(messages)` 改为 `generateForkTitle(messages)`。
  3. `tests/frontend/message-utils.test.ts` — 新增 `describe('fork title')` 四例：前缀不吃字符预算、短提示词保留空格归一化、无 user 消息时为 `[fork] New chat`、普通标题不带前缀。
  4. `docs/user-guide.zh-CN.md` / `docs/user-guide.en-US.md` — 分支/Fork 段落补充前缀说明。
  5. `docs/wiki/src/lib/README.md` / `docs/wiki/src/hooks/README.md` — 同步生成函数与 fork 行为说明。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/message-utils.test.ts` → 10 tests passed。
  - fork/标题相关 6 个前端测试（message-utils / message-actions / side-chat-workspace-tab / project-new-chat-reuse-guard / session-title / chat-capabilities）→ 6 files / 77 tests passed。
  - `npx eslint` 三个改动 TS 文件 → 0 error。
  - `npx tsc -b` → 0 错误。
- Notes：
  - 服务端 `titleSource` 逻辑未动：客户端传入非 `New chat` 标题即 `titleSource='manual'`，因此 fork 会话不会被 AI 标题覆盖——这正是前缀能稳定保留的原因，但也意味着 fork 会话标题不会自动精修；若以后要允许精修，需按“前缀 + 可识别”判断放行，而不是改 `canApplyGeneratedTitle()` 的全局语义。
  - 未做 `forkedFromSessionId` 溯源：后端 `createAgent` 无该字段、持久化与列表渲染也都没有，属独立 feature（可支持“分叉自 X”与分支树）。
  - `sessionTitle()` 只对完全等于 `New chat` 的标题做本地化，`[fork] New chat` 会原样显示；该场景只在 fork 出无语义首条消息时出现，未额外处理。

## compaction-prompt-english-untruncated（done，2026-10-27）

- Goal：把压缩用的提示词全部改成英文；并去掉 transcript 构造中的所有截断。
- 结论（一句话）：`COMPACT_SYSTEM_PROMPT` 与用户消息模板改为全英文（输出语言仍跟随会话语言），同时删除三层长度上限（单条 10000 字符、transcript `min(160000, max(12000, contextWindow×1.6))`、工具参数 2000 字符）——摘要现在能看到完整历史，代价是请求过大时由 provider 报错并经 `auto_compact_failed` 显式暴露，而不是静默产出不完整的摘要。
- 改动文件：
  1. `server/conversation-compaction.mjs` — `COMPACT_SYSTEM_PROMPT` 英文重写（九段结构不变）；用户消息模板改英文；删除 `truncateMiddle()` 与 `transcriptCharLimit()`；`buildTranscript(messages)` 不再接收/使用 model；`safeJson(value)` 去掉 `maxLength`；`formatMessageForTranscript()` 不再对消息正文做 10000 字符截断；`approximateMessageChars()` 的 attachments 调用同步去掉长度参数。保留 `redactSensitive()`（定点替换，非截断）与 `[image omitted]` / `[attachments omitted]` 结构性占位。
  2. `tests/server/conversation-compaction.test.mjs` — 新增 `describe('conversation compaction prompt')` 五个用例：提示词全英文且不含 CJK、transcript 指令为英文；40k 字符正文完整上送且不含 `[truncated`；5000 字符工具参数完整上送；裸 `sk-*` 仍被脱敏且 20k 正文不丢；`token = sk-*` 赋值形式被折叠为 `[REDACTED]`。
  3. `docs/wiki/server/README.md` — `conversation-compaction.mjs` 段新增「提示词（全英文）」与「不再做任何截断」两段，写明取舍与保留项。
  4. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx vitest run tests/server/conversation-compaction.test.mjs` → 11 tests passed。
  - 压缩相关四文件（conversation-compaction / agent-compaction / auto-compaction / auto-compaction-notice）→ 4 files / 46 tests passed。
  - `npx eslint` 改动文件 0 error；`npx tsc -b` 0 错误。
- Notes：
  - 语义边界：`minSourceChars` 门槛用的是**未截断**的 transcript 长度，因此判断更贴近真实历史量（旧行为下超长历史被截断到 160k 后仍高于门槛，实际结论不变）。
  - 已知残留：`LEGACY_COMPACTION_NOTICE_PREFIX/SUFFIX` 仍是中文常量，那是**历史识别**用的（旧版本写入的 notice 文案），不是提示词，不能翻译，否则旧会话的压缩消息将无法被识别与过滤。
  - 若后续发现某些小窗口模型频繁因输入过大而压缩失败，正确做法是提高 `<conversation_to_compact>` 的收敛策略（例如按 token 分块递进摘要），而不是恢复「掐头留尾」式截断。

## compaction-ux-timing（done，2026-10-27）

- Goal：分析自动上下文压缩的显示时机是否合理，并把「必须做」的缺口一次性补齐——架构最优、设计最优、保证产品体验，允许重构该部分代码。
- 结论（一句话）：压缩 UI 由「服务端零散事件 → 装饰层注入式卡片」改为「服务端 `state.compactionNotice` 单向状态投影 → React 在消息列表尾部渲染」，五个缺陷一并消失：进行中不再静默、审批不再留下死卡片、自动压缩不再切掉当前回合、阈值信号不再被丢弃、卡片不再强制滚动。
- 改动文件：
  1. `server/auto-compaction.mjs` — 新增 `COMPACTION_NOTICE_PHASES`（`awaiting_confirmation` / `summarizing`）、`setCompactionNotice()` / `clearCompactionNotice()`、`AUTO_COMPACT_DECISION` 四种结果、`resolveAutoCompactTailStart()` + `AUTO_COMPACT_MIN_TAIL_USER_TURNS`；`maybeAutoCompactSession()` 在每个进入/退出路径发布或清空 notice，审批结果区分拒绝/超时/取消/不可用；`approvalId` 前置生成并写入 notice；catch 住 abort 拒绝不再伪装成压缩失败。删除 `auto_compact_threshold_reached`。
  2. `server/agent-approval-orchestrator.mjs` — `createAutoCompactApprovalPromise()` 返回 `AUTO_COMPACT_DECISION`、采纳调用方传入的 `approvalId`、每条终止路径发 `auto_compact_approval_settled`（`decided` / `timed_out` / `cancelled`），并区分「已通告」与未通告的失败。
  3. `server/agent-compaction.mjs` / `server/agent-manager.mjs` / `server/agent-session-queries.mjs` — 初始化、`resetSessionCompaction()` 清空 notice；`getSessionState()` 投影 `compactionNotice`。
  4. `src/lib/server-agent-types.ts` / `src/lib/server-agent.ts` — 新增 `ServerAgentCompactionNotice` 与 `state.compactionNotice`；`auto_compact_state` / `auto_compact_approval_settled` 两个 case；`state` 帧与 `/state` 刷新都按「整体快照」语义覆盖（缺失即空闲）。
  5. `src/lib/global-agent-sse-client.ts` / `src/lib/shared-server-agent.ts` — SSE 事件白名单更新。
  6. `src/components/chat/surface/ContextCompactionStatusRow.tsx`（新）/ `ContextCompactionDecisionRow.tsx`（新）/ `MessageList.tsx` / `ChatSurface.tsx` / `ChatTypes.ts` — 两个行组件作为消息列表尾部子节点渲染；`ChatSurface` 订阅两个新事件；snapshot 增加 `compactionNotice`。
  7. `src/components/chat/panel-wiring/approval-cards.ts` / `panel-decoration/approval-card.ts` / `ChatPanelHost.tsx` — 删除 auto-compact 注入卡与其 tone/copy/keepBoundary/scrollIntoView 链路（`findKeepBoundaryTarget`、`statusIcon(tone)`、`ApprovalCardCopy`、`getMessages`/`keepRecentTurns` 依赖），`ChatPanelHost` 把批准/拒绝回调接进 `ChatSurface`。
  8. `src/lib/i18n.ts` + `src/styles/chat/context-compaction.css` — 新增 `compactionSummarizing*` 文案（en/zh）；新增状态行/决策行样式（shimmer 复用 `shimmer` keyframes + `prefers-reduced-motion` 降级、决策行复用邻近卡片强度、按钮只做 scale 按压反馈）。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误。
  - `npx eslint`（22 个改动文件）→ 0 error；`npm run lint` → 0 error / 0 warning。
  - 压缩相关 22 个测试文件 → 22 files / 299 tests passed。
  - `npm run test` → 435 files / 5076 passed / 2 skipped，退出码 0。
  - `npm run build` → 成功（`✓ built in 5.82s`）。
- Notes：
  - 新增测试：`tests/server/auto-compaction-notice.test.mjs`（notice 相位序列、四种审批结果、抛错/取消清理）、`tests/frontend/context-compaction-rows.test.ts`（两个行组件的渲染/隐藏/只读/不滚动）；`tests/server/auto-compaction.test.mjs` 增加 `resolveAutoCompactTailStart` 三例；`tests/server/agent-approval-orchestrator.test.mjs` 与 `tests/frontend/approval-card.test.ts` 更新为废弃旧契约后的断言。
  - 未做的（与本轮边界无关，已记录）：失败态仍走 `auto_compact_failed` 的临时日志提醒，没有常驻错误行；`keepRecentTurns` 设置项仍写“0 = 不保留”，文案与实际自动路径行为（至少保留 1 个当前回合）存在轻微不一致，属设置页文案后续跟进。
  - 首次全量跑出现 1 个失败（`semantic-color-class-parity`），原因是 CSS 注释里字面写了旧文档的语义色类名示例；改为文字描述后通过，说明该测试会扫描注释，新增样式注释时不要在注释里写带透明度的语义色类名。

## baseline-verification（done，2026-10-27）

- Goal：跑一次完整基线验证（test / lint / build），确认仓库当前无真实失败；只记录结论，不做功能改动。
- 结论（一句话）：三项全绿——`npm run test` 433 files / 5057 passed（2 skipped，退出码 0），`npm run lint` 0 error / 0 warning，`npm run build` 成功；此前多轮记录的「31 个 `Cannot find package 'jsdom'` 环境错误」已消失（`jsdom` 现已可解析）。
- 改动文件：仅 `progress.md` / `session-handoff.md` / `feature_list.json` 记录，无源码改动。
- 验证 / Evidence：
  - `npm run test` → `Test Files 433 passed (433)`、`Tests 5057 passed | 2 skipped (5059)`、Duration 82.47s、退出码 0。
  - `npm run lint` → `eslint .` 无任何输出（0 error / 0 warning）。
  - `npm run build` → `✓ built in 6.17s`（仅有既有的 >500kB chunk size 提示 warning）。
- Notes：
  - 本轮为 goal 模式长跑验证，未新增 feature、未改业务代码、未创建 Git commit、未触碰 `dist/` 等生成产物（build 输出按既有脚本生成，未手工修改）。
  - 工作区存在他人遗留的未跟踪临时文件 `.tmp-cdp-probe4.cjs` / `.tmp-cdp-probe5.cjs` / `.tmp-cdp-result.json`，与本轮无关，未清理。

## background-tasks-output-height（done，2026-10-27）

- Goal：后台任务面板的日志输出区（终端明细）太高——长日志时被拉成半屏，把任务列表挤到只剩两行；希望改矮到约 14~16 行。
- 结论（一句话）：输出区从「吃满剩余高度」改为「按内容占位 + 封顶 18rem」——`.quickforge-background-tasks-output` 由 `flex: 1 1 auto` 改为 `flex: 0 1 auto` 并加 `max-height: 18rem`（保留 `min-height: 4rem`），`.quickforge-background-tasks-detail` 同步由 `flex: 1 1 auto` 改为 `flex: 0 1 auto`，滚动区 `-output-scroll` 的 `flex: 1`（basis 0）改为 `flex: 1 1 auto` 让日志高度真正参与占位；省下的竖向空间归还任务列表（`-list` 从 `flex: 0 1 auto + max-height: 45%` 改为 `flex: 1 1 auto`，仍是唯一滚动容器）。
- 改动文件：
  1. `src/styles/workspace/background-tasks.css` — 上述 4 条规则 + 设计注释（为什么 detail 不能 flex-grow、为什么 scroll 区 basis 必须是 auto、为什么列表不再按 45% 封顶）。
  2. `tests/frontend/background-tasks-tab.test.ts` — 新增 `caps the output area height instead of stretching it to half the panel`：锁定 output 的 `max-height: 18rem` / `min-height: 4rem` / `flex: 0 1 auto`（且不得 `flex: 1 1 auto`）、detail 不得 flex-grow、list 为 `flex: 1 1 auto` 且无 max-height 并保留 `overflow-y: auto`。
  3. `docs/design/background-tasks-align-preview.html` — 「本次修正」补一条输出区封顶 18rem 的说明（该页直接 link 真实 CSS，预览自动跟着变）。
  4. `docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md` — 同步竖向高度策略（detail/output 均 `flex: 0 1 auto`，输出 4rem~18rem，剩余高度归列表）。
  5. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/background-tasks-tab.test.ts tests/frontend/css-architecture.test.ts tests/frontend/subagent-running-indicator.test.ts` → 3 files / 42 tests passed。
  - `npm run lint` → 0 error。
  - `npm run build` → 成功（built in 5.82s）。
- Notes：
  - 没有新增文案 / i18n key，纯样式改动；用户所说的「终端明细」实为面板内的「输出」区（仓库里没有该文案）。
  - `max-height` 放在输出区而不是详情区：短日志时详情自然矮（不留大块空白），长日志才长到 18rem 为止；若把上限挂到 `.detail` 上，短日志的详情也会被撑成 18rem 高。
  - 未做真机视觉确认（18rem 是否合适、窄窗下 meta 行数较多时的观感）；`npm run test` 全量未跑（本轮只跑 3 个相关文件，其中含既有 jsdom 缺包噪音）。

## process-stage-scroll（done，2026-10-27）

- Goal：把「执行中 · 16 个工具调用 · 4 条命令 · 编辑 1 个文件」这条内层阶段（stage）展开后的工具列表收拢为固定高度，超出部分在区域内滚动；执行中新增工具行要自动贴底到最新一行，用户手动上翻后不再抢回阅读位置。
- 结论（一句话）：限高 `min(50vh, 18rem)` 挂在折叠动画壳层 `.quickforge-process-body-inner`（stage-body 的子级选择器，DOM 结构不变），滚动能力只在 `[data-expanded="true"]` 挂上并加 `overscroll-behavior: contain`；执行中由 `scheduleProcessStageStick`（rAF）贴底跟随，`resolveProcessStageScrollFollow` 用 24px/8px 双向滞回判断是否继续跟随，跟随标记存 inner 的 `dataset.quickforgeStageFollow`，手动收起时复位。
- 改动文件：
  1. `src/styles/chat/process.css` — 新增 `.quickforge-process-stage-body > .quickforge-process-body-inner { max-height: min(50vh, 18rem) }` 与展开态 `overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain`（含设计注释：为什么滚动容器必须是 inner、为什么限高两态都保留而滚动只在展开态）。
  2. `src/components/chat/panel-decoration/process-folding.ts` — 新增 `resolveProcessStageScrollFollow`（导出供测试）、`bindProcessStageScrollFollow`、`applyProcessStageStick`、`scheduleProcessStageStick`（WeakSet 去重 + rAF，无 rAF 环境退化为同步）、`resetProcessStageScrollFollow`；`updateProcessStageGroups` 在 label 写入后对 stage inner 绑监听并按 `expanded && stageStreaming` 排队贴底，收起态复位跟随标记；stage summary 的 onclick 收起时同样复位。
  3. `tests/frontend/process-folding.test.ts` — 新增 `resolveProcessStageScrollFollow` 滞回用例（24/25、8/9、NaN/Infinity）。
  4. `tests/frontend/process-folding-incremental.test.ts` — 新增「流式新增工具行后区域滚动贴底、用户上翻后不再贴底」用例（fake inner 上挂 scrollTop/scrollHeight/clientHeight）。
  5. `tests/frontend/chat-surface-css-contract.test.ts` — 新增 `caps the expanded stage body height and scrolls inside it`：限高只能挂 stage inner、滚动只在展开态、折叠壳层（body/stage-body）不得变成滚动容器、顶层组 inner 不得限高。
  6. `docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md` — 同步 process.css 条目与 process-folding 折叠说明（限高滚动 + 贴底跟随 + 滞回阈值）。
  7. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误；`npx eslint` 改动源码/测试文件 → 0 error。
  - `npx vitest run` process 相关 11 文件（process-folding / -incremental / -ownership、chat-surface-css-contract、css-architecture、thinking-streaming-stage、motion-design、thinking-hint、thinking-header-adoption、subagent-process-trace、scroll-sync）→ 11 files / 186 tests passed。
  - `npm run lint` → 0 error；`npm run build` → 成功（built in 6.08s）。
- Notes：
  - 没有给 stage body 插新包装层：滚动容器复用既有动画壳层 inner，`stage-body > inner > step` 的结构契约（`appendProcessToolSuffix` 的校验链、`process-folding-incremental.test.ts` 的选择器）因此零改动。
  - 限高放在两态共用的 inner 规则里、只把 `overflow` 放到展开态：收起瞬间若放开上限，内容会先弹回全高再塌陷（观感一次跳变）。
  - 贴底用 rAF 而不是装饰 pass 内同步读写：`scrollHeight`/`clientHeight` 是布局查询，装饰 pass 刚写完 DOM 时同步读会触发强制重排。
  - 滚动条画在 inner 右缘，stage body 的 `padding-left: 0.75rem` 缩进与左侧连接线留在滚动区外、不随内容滚动。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Goal：
- 结论（一句话）：
- 改动文件：
  1.
- 验证 / Evidence：
- Notes：

## present-files-inline-links（done，2026-10-26）

- Goal：`present_files`（展示文件）工具卡去掉右上角眼睛（预览）按钮，改为摘要区逐文件渲染「文件图标 + 文件名」，文件名 hover 出下划线、点击跳转预览（范围仅 present_files，write/edit/read 摘要保持不变）。
- 结论（一句话）：`renderPreviewButton` 整体删除，新增 `renderPresentedFilesSummary(params)` 在摘要区逐文件渲染，与 `renderToolFileSummary` 同一套 span + click（`previewArtifactClickHandler` → `PREVIEW_ARTIFACT_EVENT`）与 `underline-offset-4 hover:underline` 文案，不可预览文件纯静态。
- 改动文件：
  1. `src/lib/tool-renderers/shared.tsx` — 删除 `renderPreviewButton`（present_files 的眼睛按钮）与其 `t` 依赖路径；`resolvePreviewableArtifact` 收窄为 write/edit/read 单文件；新增 `presentedFileEntries`（files 归一化，兼容 string 与 `{ path, kind }`）与导出 `renderPresentedFilesSummary`（逐文件 FileIcon + basename，逗号分隔，可预览各挂 click；工作区外绝对路径经 `isNonWorkspaceClickablePath` 静态化）。
  2. `src/lib/tool-renderers/local-workspace-tool-renderer.tsx` — `present_files` 摘要改走 `renderPresentedFilesSummary`；`quickforge-tool-actions` 里移除 `renderPreviewButton`，只剩终止命令按钮。
  3. `tests/frontend/tool-renderer-file-icon.test.ts` — 眼睛按钮用例替换为 3 个新用例（逐文件可点 + 各自派发事件、不可预览/工作区外静态、无 files 时不渲染元素）；新增 `presentedFileNodes` 辅助函数；顶部注释同步。
  4. `docs/wiki/src/lib/README.md` — `shared.tsx` 条目把 `renderPreviewButton` 换为 `renderPresentedFilesSummary` 并说明「动作区不再有眼睛按钮」的理由。
  5. `feature_list.json` / `progress.md` / `session-handoff.md` 记录本轮。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误。
  - `npx vitest run tests/frontend/tool-renderer-file-icon.test.ts tests/frontend/local-tool-running-sweep.test.ts tests/frontend/tool-param-summary.test.ts tests/frontend/css-architecture.test.ts` → 4 files / 39 tests passed。
  - `npx eslint src/lib/tool-renderers/shared.tsx src/lib/tool-renderers/local-workspace-tool-renderer.tsx tests/frontend/tool-renderer-file-icon.test.ts` → 0 error。
  - `npm run test` → 402 files / 4731 tests（4727 passed，3 failed，1 skipped）。3 个失败均在 `tests/frontend/background-tasks-tab.test.ts`（1）与 `tests/frontend/subagent-running-indicator.test.ts`（3，并行跑时计 2）内，断言对象是工作区里既有的未提交改动（`src/components/app/ConversationHeader.tsx`、`src/components/chat/panel-decoration/subagent-running-indicator.ts`、`src/styles/workspace/background-tasks.css`、未跟踪的 `src/lib/background-tasks-open.ts`），与本轮改动的 `tool-renderers/*` 无交集（两文件均不引用 `tool-renderers` / `renderPreviewButton`）；另有 31 个 `Cannot find package 'jsdom'` 的既有环境错误。
  - `npm run lint` → 0 error / 3 存量 warning（`coverage/` 生成目录）。
  - `npm run build` → 成功（built in 5.47s）。
- Notes：
  - 摘要区逗号分隔符用裸文本 `', '`（未新增 CSS 类），避免引入无对应样式的选择器。
  - `quickforge-tool-actions` 现在只在 `run_command` 运行中出现（终止按钮）；CSS 的 `:has(> .quickforge-tool-actions > button)` 预留区规则保持不变，present_files 摘要因此不再被预留 1.75rem 右侧内边距。
  - 未改动 `summarizeParams` 的 present_files 纯文本分支——它仍供子代理跑马灯（`subagent-run-detail.ts`）与 MCP 渲染器使用。
  - 已知与本轮无关的失败：`background-tasks-tab.test.ts` / `subagent-running-indicator.test.ts` 的 3-4 个用例（源码断言指向工作区里其他未提交改动），记在此备查、未扩大改动范围。

## background-tasks-sidebar（done，2026-10-26）

- Goal：把「后台运行命令」的运行与历史从临时浮层收进右侧边栏，提供可筛选、可搜索、可看日志的统一面板；终态历史不新增服务端接口，直接派生自会话消息。
- 结论（一句话）：Workspace Inspector 新增 `background-tasks` 运行时 Tab（`BackgroundTasksTabContent`），运行中来自 `backgroundCommands` 快照、终态由 `toolResult` 消息 `details` 派生（`src/lib/background-tasks-model.ts`），入口为置顶摘要 + Composer 图标两处，顶栏不设入口（顶栏图标入口已于下方「跟进 2 · 入口重构」删除）。
- 改动文件：
  1. `src/lib/background-tasks-model.ts`（新增）— `buildBackgroundTasks` 统一视图模型：running 取后台命令快照，finished 从 `toolResult` 消息派生 `completed`/`failed`/`timed_out`/`aborted`、`exitCode`/`durationMs`；同 `taskId` 两边都有时以消息终态为准；筛选/搜索/时长格式化纯函数。
  2. `src/components/workspace/BackgroundTasksTabContent.tsx`（新增）— 面板内容：全部/运行中/已结束筛选 + 关键字搜索、任务列表与状态点、详情元信息、命令日志预览（`getCommandLog`）、跟随输出、复制命令/任务、停止任务与查看完整日志入口；选中项失效时回落到第一条 running。
  3. `src/components/workspace/WorkspaceInspector.tsx`、`workspace-panel-tabs.ts`、`workspace-inspector-tabs.ts`、`useInspectorTabs.ts` — 注册 `background-tasks` kind（`Activity` 图标）、单实例复用、`serializePanelTabs` 剔除（不持久化）。
  4. `src/components/app/ConversationHeader.tsx` + `src/App.tsx` — 会话头入口与运行中数量徽标，点击打开/激活后台任务 Tab（经 `requestWorkspaceInspector`）；该入口后来在「跟进 2 · 入口重构」中整体删除。
  5. `src/styles/workspace/background-tasks.css`（新增）+ `src/styles/index.css` — 面板样式，class 前缀 `.quickforge-background-tasks-*`。
  6. `src/lib/i18n.ts` — en/zh 成对新增后台任务面板文案；本次清理未使用的 `backgroundTaskTabLabel`（两段各删除一行）。
  7. `tests/frontend/background-tasks-model.test.ts`、`tests/frontend/background-tasks-tab.test.ts`（新增）、`tests/frontend/server-agent-background-commands-frame.test.ts`（新增，6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 合并逻辑）。
  8. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：
  - `npm run test` → **402 files passed / 4722 tests passed（1 skipped）**；退出码 1 仅来自 31 个标注 `@vitest-environment jsdom` 的文件无法启动 fork worker（`Cannot find package 'jsdom'`，既有环境缺失），无真实断言失败，其余断言全部通过。首轮全量曾出现 `tests/server/scheduled-tasks.commands.test.mjs` 2 个用例失败，单独重跑该文件 24 passed，重跑全量后全绿——判定为并发下的既有 flake，与本次改动无关（本次只删了一个 i18n key 并改文档）。
  - `npx vitest run tests/frontend/background-tasks-model.test.ts tests/frontend/background-tasks-tab.test.ts tests/frontend/server-agent-background-commands-frame.test.ts` → 全过（其中 `server-agent-background-commands-frame.test.ts` 6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 就地合并）。
  - `npm run lint` → 0 error / 3 warning（均为 `coverage/` 生成目录的 unused eslint-disable，存量）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.78s）。
- Notes：
  - 后台命令输出非流式：日志预览靠 2s 轮询（仅「跟随输出」开启且任务仍在运行时）。
  - `backgroundTasks` 是服务端内存 Map，服务重启后终态丢失，面板会变空。
  - `listBackgroundCommandTasks` 仍只返回 running，未改动——会话 idle 回收语义依赖它。
  - 服务端 `settleBackgroundCommandToolResult` 在找不到对应 `toolResult` 消息时返回 `false`，该任务不会出现在面板终态里（边界场景：会话被驱逐 / compaction 截断）。
  - 本机 `node_modules/jsdom` 缺失，31 个 `tests/frontend/*.test.ts`（jsdom 环境）无法启动，属既有环境问题。
  - Tab 条上的 tab 标签不显示任务数（运行中计数徽标在 Composer 命令图标上；原会话头入口在「跟进 2 · 入口重构」中删除），如需 tab 内计数需给 `panelTabLabel` 传入 count。

- 跟进（2026-10-27，后台任务面板样式对齐 + 入口统一）：
  - Goal：把后台任务面板的横向基准、控件高度、间距与字号刻度对齐 Inspector 其余 tab（`workflow-detail.css` 同轴），消除切 tab 时的横跳与工具栏 1px 高低差；同时把入口收敛到一处。
  - 样式对齐（`src/styles/workspace/background-tasks.css` 重写）：
    1. 水平基准从 0.5rem 改为 **0.875rem**，与 `workflow-detail.css` 同轴，切 Inspector tab 时正文不再横跳 5px。header / toolbar / detail-header / meta / output 外框统一落在基准线；列表用 `list 0.5rem + item 0.375rem` 叠出基准线。
    2. 输出区内部三级（标题条 / 滚动区 / 底部提示）统一横向 0.5rem，去掉原来的 0.4rem。
    3. 控件同高：分段控件 `1.375rem` + 容器 `0.125rem` 内距 = 搜索框 `1.625rem`，消除工具栏内 1px 高低差；输出标题条与底部提示也统一 `1.625rem`。
    4. 空间节奏回到 1/16 网格：`0.375 / 0.5 / 0.75`，清除 `0.3 / 0.35 / 0.4 / 1.05 / 1.15 / 1.6` 等零散值。
    5. 字号 4 档：`0.6875`（计数徽标）/ `0.75`（正文）/ `0.8125`（列表标题）/ `0.875`（面板标题与空态标题）。原面板标题 0.8125 小于 Inspector tab 的 13px，属层级倒挂，已提到 0.875。
    6. 行内操作不再绝对定位覆盖元信息：`.item-meta` 与 `.item-actions` 共用网格第三列（`grid-template-columns: auto minmax(0,1fr) minmax(3.5rem, auto)`），悬停只做透明度交换。修掉原先「操作区比元信息格宽 10px、透明底让命令字从图标间透出」的压字问题。
    7. 选中态（`is-active`）不再显示行内操作、也不淡出元信息——两者同格，常显会互相遮挡；选中行的停止/复制在详情区。
    8. 命令从 `word-break: break-all` 换行改为单行 `ellipsis` 截断 + `title` 展示完整值，避免长命令把复制/停止按钮挤到行中间。
    9. 详情头恢复 `border-bottom`（34% 弱线），meta 加 `padding-bottom: 0.5rem`，命令与元信息不再贴在一起。
    10. 输出区加 `min-height: 4rem`，面板被压矮时不会把日志挤成 0 高；`.detail` 加 `overflow: hidden`。
    11. 筛选/搜索无结果时新增 `.quickforge-background-tasks-no-results` 提示（新 i18n key `backgroundTaskNoResults`），不再复用「选择一个任务」空态文案。
    12. `pointer: coarse` 下图标按钮提到 `2rem`，满足触摸目标。
    13. 所有图标按钮、链接、跟随开关补 `:focus-visible` / `:hover` 过渡与 reduced-motion 关闭。
  - 配套改动：
    1. i18n（`src/lib/i18n.ts`）：`backgroundTaskElapsed`（`'{duration} elapsed'`，英文去参数后是小写 `elapsed`）替换为 `backgroundTaskMetaElapsed`（`'Elapsed'` / `'耗时'`）；新增 `backgroundTaskNoResults`。
    2. `src/components/workspace/BackgroundTasksTabContent.tsx`：详情命令加 `title`；输出 footer 提示文案加 `quickforge-background-tasks-output-footer-hint` 单行截断类。
    3. 入口统一：Composer 左下角命令图标不再弹浮层菜单（`openBackgroundCommandMenu` 已删），改为派发 `quickforge:open-background-tasks` 窗口事件（`src/lib/background-tasks-open.ts`），App 监听并按 `sessionId` 过滤后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`。顶栏 `ConversationHeader` 没有后台任务按钮。停止/查看日志只在面板内。
    4. `tests/frontend/background-tasks-tab.test.ts`：对齐断言改为 0.875rem 基准；新增「分段控件与搜索框同高」「操作区不与元信息压字（共用第三列）」「Composer 图标经窗口事件打开」三条；字号断言从 3 档改为 4 档。
  - 验证 / Evidence：`npx tsc -b` 通过；`npm run lint` 0 error（3 条 warning 在 `coverage/` 生成目录，存量）；`npm run build` 通过；`npx vitest run tests/frontend/` → 228 个文件中 227 通过，唯一失败 `tests/frontend/custom-providers-tab.test.ts` 属另一并行 feature（与本次无关），31 个 jsdom 缺包 worker 启动失败属既有环境问题；后台任务相关 67 个用例全绿。
  - Notes（跟进）：
    1. `docs/design/background-tasks-align-preview.html` 是可视化对齐校验页：直接引用真实 CSS + foundation token 子集，叠加 0.875rem / 0.5rem 基准线，可切亮暗与 340/380px 宽度。
    2. 列表正文比基准线多一个「圆点 + gap」的缩进，这是 bullet 列表固有缩进，圆点本身仍落在基准线上。
    3. 选中行不显示行内操作是刻意取舍（与元信息同格）。
    4. 日志预览仍是 2s 轮询，非流式（原限制未变）。

- 跟进 2（2026-10-27，后台任务入口重构：顶栏入口删除 + 置顶摘要双入口）：
  - Goal：把「打开后台任务面板」的入口从三方并存（顶栏图标、Composer 图标浮层、置顶摘要）收敛为「置顶摘要的后台命令区块」+「Composer 左下角命令图标」两个直开面板的入口，并清掉上一轮遗留的浮层代码与样式。
  - 完成内容：
    1. 会话顶栏：删除 `ConversationHeader` 的「后台任务」图标入口（含运行中数量徽标）。
    2. 置顶摘要：`PinnedSummarySections` 的「后台命令」区块成为主入口——标题右侧「查看全部」按钮（`backgroundTaskOpenPanel` / `backgroundTaskOpenPanelAria`）+ 每条命令的行主体（行本身是 button，aria 走 `backgroundTaskOpenAria`），停止按钮是同级兄弟按钮、点击冒泡不影响；区块内不再单独渲染「查看」入口。
    3. Composer 图标：`.quickforge-background-command-trigger`（终端图标 + 运行中角标）不再弹浮层，点击**直接打开右侧面板**；`openBackgroundCommandMenu` 与 `.quickforge-background-command-menu` 样式一并删除。
    4. 新增事件桥 `src/lib/background-tasks-open.ts`：`OPEN_BACKGROUND_TASKS_EVENT`（`quickforge:open-background-tasks`）+ `dispatchOpenBackgroundTasks()` + `normalizeOpenBackgroundTasksRequest()`；`App.tsx` 监听后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`，且只接受「当前会话或缺省 sessionId」的请求。
    5. 保留：subagent 浮层仍复用 `renderBackgroundCommandItems`，`.quickforge-background-command-item/-copy/-stop/-log` 样式必须保留。
  - 改动文件：
    1. `src/components/app/ConversationHeader.tsx` — 删除后台任务入口按钮与徽标。
    2. `src/components/git/PinnedSummarySections.tsx` + `src/components/git/GitToolsPinnedSummary.tsx` — 「后台命令」区块加「查看全部」按钮、命令行主体改为整行按钮 + 兄弟停止按钮，新增 `onOpenBackgroundTasks` 透传。
    3. `src/components/chat/panel-decoration/subagent-running-indicator.ts` — 图标点击改为 `dispatchOpenBackgroundTasks({ sessionId })`，删除浮层打开逻辑。
    4. `src/styles/chat/composer-controls.css` — 删除 `.quickforge-background-command-menu`，保留 trigger/badge 与 item/copy/stop/log。
    5. `src/lib/background-tasks-open.ts`（新增）、`src/App.tsx`（事件监听 + 会话过滤）、`src/lib/i18n.ts`（`backgroundTaskOpenPanel` / `backgroundTaskOpenPanelAria` / `backgroundTaskOpenAria`）。
    6. `tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/subagent-running-indicator.test.ts` — 对齐新入口断言。
    7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/lib/README.md`；`feature_list.json`、`progress.md`、`session-handoff.md`。
  - 验证 / Evidence：`npx tsc -b` 通过；`npx eslint` 相关改动文件 0 error；`npx vitest run` 相关 5 个测试文件 79 passed；`npm run build` 成功（built in 3.39s）。
  - Notes：
    1. 浮层删除后 `renderBackgroundCommandItems` 仍被 subagent 运行浮层复用，`.quickforge-background-command-item/-copy/-stop/-log` 相关 CSS 不能随手一并删除。
    2. 两处入口的打开路径不同：置顶摘要在 App 内直接持有 `requestWorkspaceInspector` 并顺带按既有规则收起摘要；Composer 图标在装饰层，只能经窗口事件回 App。事件 payload 只放 `sessionId`，App 侧做「只认当前会话」过滤，避免跨会话残留事件把面板切走。
    3. 后台命令输出仍是 2s 轮询（原限制未变）。

## models-providers-layered-settings（done，2026-10-26）

- Goal：按 `docs/design/models-providers-settings-redesign.html` 设计稿，把「模型与提供商」设置页从「一个表单管理全部配置」重构为分层设计：提供商列表 / 连接 / 模型三层各自保存。
- 结论（一句话）：`CustomProvidersSettingsTab` 拆为编排器 + `settings/custom-providers/` 三层子组件（列表+预设弹层 / 连接（密钥独立保存、提供商级测试）/ 模型（行内独立保存、可见性即时写回、模型级测试、服务器拉取）），存储结构不变，新增服务端 provider-test / provider-discover 两个接口。
- 改动文件：
  1. `src/components/settings/tabs/CustomProvidersSettingsTab.tsx` — 重写为编排器：providers/draft/选中态、L2 保存（改名迁移密钥 + 重建模型 headers/协议/baseUrl）、密钥独立保存、L3 读-改-写单提供商、provider-test / provider-discover / 模型级 test-connection 调用、active 生命周期与 `customProvider` 深链选中契约保持。
  2. `src/components/settings/custom-providers/`（新增目录）— `shared.ts`（预设、buildModel、草稿转换）、`provider-list-pane.tsx`（L1 + 添加预设弹层）、`provider-detail-pane.tsx`（头部 + 删除菜单）、`connection-section.tsx`（L2，含 `qf-provider-api-key` 密码字段契约）、`model-list-section.tsx`（L3 行内编辑）。
  3. `src/styles/settings/custom-providers.css`（新增）+ `src/styles/index.css` 挂载 — 主从布局、密钥行、脏标记条、模型行、窄屏抽屉（<768px 详情覆盖列表 + backdrop）。
  4. `server/routes/models.mjs`（68→144 行）+ `server/index.mjs` — 新增 `POST /api/models/provider-test`（GET baseUrl/models 探测，不依赖模型，OpenAI/Anthropic 两种鉴权）与 `POST /api/models/provider-discover`（返回模型 ID 列表）。
  5. `src/lib/i18n.ts` — en/zh 成对新增 40 个分层文案 key，删除 7 个弃用 key（editCustomModel / addCustomModel / presets / presetCustom / providerAdvanced / atLeastOneModel / noCustomModels / customHeadersHelp）。
  6. `tests/frontend/custom-providers-tab.test.ts`（新增，13 用例）+ `tests/frontend/settings-workspace-react.test.ts`（密码字段契约路径改指 connection-section.tsx）。
  7. `docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/routes/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：`npx vitest run tests/frontend/custom-providers-tab.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/css-architecture.test.ts tests/frontend/i18n-language-snapshot.test.ts` 全过；`npm run test` 399 files / 4684 tests 全过（31 个 `Cannot find package 'jsdom'` Unhandled Error 为存量环境缺失，jsdom 已声明未安装）；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。

- Notes（同日视觉打磨）：协议分段控件整行铺满、等分两段、`white-space: nowrap` 根除换行，字号 0.9375rem→0.8125rem、总高收到 2.25rem 与输入框对齐；协议独占连接网格整行（名称/Base URL 两列）；密钥行改「标题行/说明行/编辑行」三段纵排，标题与操作按钮同行对齐；模型行能力徽标取消 `.quickforge-settings-meta` 默认 margin-top（原先把 chips 顶歪 8px）并加 min-height 统一行高；模型 ID 0.78125→0.8125rem、规格 0.65625→0.6875rem 统一字号刻度；列表/详情头部协议徽标改短标签（OpenAI / Anthropic，`protocolShortLabel`），列表 meta 合并为单行。tsc / eslint / 18 目标用例 / `npm run build` 全过。

  - 跟进（2026-10-27）：草稿提供商删除补二次确认（`confirmDiscardDraft` 破坏性确认，取消保留草稿）；已保存提供商删除的确认原有。新增 1 个测试用例（14/14 全过）。

  - 跟进 2：主从卡片改固定高度（桌面 34rem / 窄屏 28rem，列表与详情卡内各自滚动，页面高度不随模型数变化）；新增「上次最后访问的提供商」记忆（localStorage `quickforge:custom-providers:last-selected:v1`，id 优先/名称兜底恢复，深链优先，草稿不写入，恢复时不自动展开窄屏抽屉）。测试 15/15 全过。

  - 跟进 3（参考用户截图样式）：连接层改为全宽竖排表单——名称 / Base URL / API 格式（`SettingsSelect` 下拉，选项带端点说明 `Chat Completions (/chat/completions)` / `Anthropic Messages (/v1/messages)`）/ API Key（常驻密码框 + 行内眼睛切换 + 状态徽标 + 「清除密钥」即时生效）；密钥输入计入连接层脏状态、随「保存连接」落库（留空保留现有密钥）；移除密钥卡片与「更换/保存密钥」流程及 protocolType 分段控件。测试 15/15、tsc / eslint / build 全过。

  - 跟进 4：每个模型行新增一键连通性测试图标（闪电 = 待测 / 旋转 = 测试中 / ✓ ✗ 徽标 = 结果，错误详情放 title 提示），用已保存的模型配置直接探测、无需展开编辑；展开编辑区里的「测试此模型」保留用于测试未保存的草稿参数。`ModelRow` 导出并补 1 个行内测试用例（16/16 全过）。

  - 跟进 8（2026-10-27，修复「查看 API Key」看不到内容）：已保存的密钥从不回填输入框（`keyValue` 初值空串），点眼睛只是切换一个空输入框的 type，所以看不到任何内容。改为按需读取：`ConnectionSection` 新增 `onRevealKey`，首次点眼睛时调用（编排器 `revealKey` 读 `provider-keys`，兜底 `provider.apiKey`），明文只进本地 state；新增 `keyFromStore` 标记，回显内容不计入连接层脏状态、保存时按「留空保留现有密钥」提交；占位文案在已配置且未回显时提示 `storedKeyHiddenHint`（中英成对）；读取期间按钮 disabled。新增 1 个用例（reveal-on-demand：明文可见、脏标记不出现、二次点击不重复读取），16/16 全过；tsc / lint / build 全过。

  - 跟进 7（2026-10-27，卡片高度跟视口）：`quickforge-providers-card` 从固定 `height: 34rem` 改为 `height: max(34rem, min(52rem, calc(100vh - 13rem)))`——桌面 34rem 起、最多 52rem、且始终给页面头尾留约 13rem，大屏能看到更多模型行，小屏不出视口；窄屏抽屉同步 `max(28rem, min(52rem, calc(100vh - 11rem)))`。列表与详情仍在卡内各自滚动，页面高度不随模型数变化。定向测试 20 项、`npm run lint`、`npm run build` 全过。

  - 跟进 6（2026-10-27，模型行开关尺寸收敛）：模型行「在选择器中显示」开关原用全局 3.125×1.75rem 轨道，比同行 1.875rem 图标按钮大一圈，且在窄列被 flex 压缩后滑块 `translateX(1.375rem)` 溢出轨道、显示不全。改为行内局部覆盖：轨道 2.25×1.25rem、滑块 0.875rem / 位移 1rem、`flex: 0 0 auto` 禁压缩；行本身 `min-height` 2.5→2.75rem、上下 padding 0.5→0.4375rem（行高由最高控件 1.875rem 撑开）。`tests/frontend/css-architecture.test.ts` 5 + `custom-providers-tab.test.ts` 15 全过；`npm run lint` 0 error；`npm run build` 成功。

  - 跟进 5（2026-10-27，删除连接分区头部行）：连接层顶部的「连接」标题行 + 右侧「测试连接」按钮整行删除（模型行已有逐模型测试，provider 级测试冗余）；表单直接贴在详情卡顶部。连带清理 provider 级测试死链：`CustomProvidersSettingsTab` 去 `testStates` / `IDLE_TEST` / `testProvider` / `rowTestStatus`，`ConnectionSection` 去 `testState` / `onTest` 与结果提示，`ProviderDetailPane` 去 `testBadge` 与 `testState`，`ProviderListPane` 去 `ProviderTestStatus` / `statusBadge` / `testStatus`；服务端删除 `POST /api/models/provider-test`（`provider-discover` 保留，复用同一 `fetchProviderModelIds`）；i18n 删除成对死 key `testConnection` / `testRequiresBaseUrl`（`connectionOk` / `connectionFailed` / `testingConnection` / `connectionSection` 仍被模型行复用，保留）。测试删去 provider 级测试用例，其余 15/15 全过；tsc / eslint / `npm run lint` / `npm run build` 全过。

- Notes：存储仍为 `custom-providers` + `provider-keys`（密钥按提供商名）；连接层保存语义 = 读-改-写整个提供商（协议/请求头下发到全部模型）并迁移改名密钥，密钥独立保存只写两个存储不触碰模型；草稿提供商（预设创建）在本地保存连接时落库。`customProviders` 深链从「打开编辑表单」改为「选中列表项」。工作区有并行会话（ask-user-echo-fix）在同文件 `src/lib/i18n.ts` 作业，本次 i18n 改动均为 provider 区块内成对增删，无交叉。

## ask-user-echo-fix（done，2026-10-26）

- Goal：修复 ask_user 工具「最后补充的问题/内容不回显」——回执行把选项与自定义补充合并成一行裸文本、跳过态丢失补充信息、待答卡无「已填写」指示、中文输入法 Enter 被当作下一问。
- 结论（一句话）：回执改为「选项 chip + 独立补充段」两段语义，跳过/超时（`answers: null`）也渲染回执并保留 `remark`，待答卡补充框显示已填写徽标并预展开，Enter 增加 IME 守卫。
- 改动文件：
  1. `src/components/chat/panel-decoration/ask-user-card.ts`（新增 `splitAskAnswer` / `renderReviewAnswer`、已填写徽标与预展开、`e.isComposing` 守卫）
  2. `src/lib/tool-renderers/ask-user-tool-renderer.tsx`（容忍 `answers: null`、`reviewRemark` 不再排除 skipped、分段渲染）
  3. `src/styles/chat/interaction-cards.css`（answer 分段与跳过态样式）
  4. `src/lib/i18n.ts`（新增 `askUserExtraLabel` / `askUserNoChoiceLabel` / `askUserFilledHint`，en + zh）
  5. `tests/frontend/ask-user-card.test.ts`、`tests/frontend/ask-user-renderer-remark.test.ts`
  6. `docs/design/ask-user-echo-fix.html`（方案设计稿）
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`
- 验证 / Evidence：`npx vitest run tests/frontend/ask-user-card.test.ts tests/frontend/ask-user-renderer-remark.test.ts` → 36 passed（28 + 8）；ask_user 回归面（含 server 侧 4 个测试文件）6 files / 103 tests passed；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。
- Notes：验证期间工作区存在并行的 CustomProviders 重构（`src/components/settings/custom-providers/`、`server/routes/models.mjs` 等），曾导致 build/test 瞬时失败；延时等待确认收敛后重新验证通过。提交时按文件隔离，`src/lib/i18n.ts` 只暂存 ask_user 相关的 2 个 hunk。`buildAskAnswerText` 死代码已随本次清理删除（回执与历史回显统一走 `splitAskAnswer`）。

## skills-settings-redesign（done，2026-10-26）

- Goal：重构设置页「技能」列表，让技能可扫、可筛选、可批量管理；最终交互按用户反馈定为「点击行打开居中详情弹窗」，不再使用右侧常驻详情栏。
- 结论（一句话）：`SkillsManagerPanel` 已重写为全宽筛选/来源分组列表 + 详情弹窗，保留 `/api/skills`、`/api/skills/content` 与全局/项目保存语义；宽窄屏、明暗主题与批量撤销均实机验证通过。
- 改动文件：
  1. `src/components/skills-dialog.tsx` — 重写技能管理面板：关键字/来源/状态筛选，按内置、个人（项目范围显示为项目）、插件分组；单行开关、筛选结果批量启用/停用与撤销 toast；重新扫描、搜索路径浮层与复制；点击行通过 portal 打开居中详情弹窗（概览/指令/元数据），`SKILL.md` 按需加载并以 markdown 渲染；保留串行保存队列、乐观更新、失败回滚和项目级 `SkillsDialog` 外壳。
  2. `src/styles/settings/skills.css`（新增）— 技能页布局、筛选工具条、分组吸顶头、行/开关、详情弹窗、markdown、toast、窄屏回退与 reduced-motion。
  3. `src/styles/index.css` — 在设置样式中登记 `skills.css`。
  4. `src/styles/settings/shell.css` — 新增 `quickforge-settings-stack-wide`（72rem），供列表型设置页使用。
  5. `src/lib/react-settings-tabs.tsx` — `SettingsPanel` 支持 `wide`，仅 Skills tab 启用；引入 `cn`。
  6. `src/lib/i18n.ts` — en/zh 同步新增技能页文案（筛选、批量、详情弹窗、元数据、搜索路径等），移除不再使用的详情占位文案。
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md` — 同步技能面板能力与新增样式模块。
  8. `docs/design/skills-settings-redesign.html` — 标注落地版将右侧详情改为点击行后的居中弹窗。
  9. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature 状态、验证与交接。
- 验证 / Evidence：
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.32s）。
  - `npx eslint src/components/skills-dialog.tsx src/lib/react-settings-tabs.tsx` → 无输出（0 error）。
  - `npm run lint` → 0 errors / 4 既有 warnings（`coverage/` 生成目录 3 个 unused disable + `usePinnedSummaryCapsule.tsx` exhaustive-deps，与本次无关）。
  - `npx vitest run tests/frontend/css-architecture.test.ts tests/frontend/motion-design.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 4 files / 43 tests passed。
  - `npm run test` → 398 个可运行测试文件全部通过（4664 passed / 1 skipped）；进程退出码为 1，原因是 31 个标注 `@vitest-environment jsdom` 的测试文件无法启动 fork worker：`Cannot find package 'jsdom'`。`jsdom` 已在 `package.json` devDependencies 中声明，但当前 `node_modules/jsdom` 未安装，属于环境缺失，与本次改动无关；未新增/升级依赖。
  - 实机视觉验证：使用隔离 `QUICKFORGE_DATA_DIR`/`QUICKFORGE_WORKSPACE_DIR` 启动 dev server，Headless Chrome 在 1440×900 与 900×900 下检查明/暗主题。页面宽度分别为 832px / 587px；详情弹窗 605px 宽、聚焦容器无多余 focus ring；筛选、来源菜单、指令 markdown、元数据、批量启用（1/4 → 4/4）与撤销（回到 1/4）均正常，浏览器控制台无错误。
- Notes：
  - 验证使用的示例技能只写入临时数据目录，没有触碰真实用户技能与配置；未创建 Git commit / tag / push，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`npm run build` 正常生成 `dist/`）。
  - 详情弹窗通过 `createPortal(document.body)` 渲染，避免项目级 `SkillsDialog` 的 `overflow-hidden` 与动画 transform 裁剪；关闭由 ESC、关闭按钮或点击遮罩触发。
  - 打开弹窗后焦点落在对话框容器（`tabIndex=-1`），Tab 可进入开关/标签页/操作按钮；未额外实现焦点陷阱。
  - 全量测试的 jsdom 缺失若需修复，应安装既有 devDependency（如 `npm install`），本次按“不新增/升级依赖”约束未处理。

## default-context-window-1m（done，2026-10-26）

- Goal：把 QuickForge 默认模型配置的上下文窗口从 200000 改为 1000000（1M）。只改默认值，不动 `modelId`，不加设置项，不重构无关代码。
- 结论（一句话）：`DEFAULT_CONNECTION.contextWindow` 由 `200000` 改为 `1000000`，所有回退点（`buildConnectionModel`、`CustomProvidersSettingsTab` 的模型表单默认/回退/保存归一化）自动跟随该常量，`maxTokens` 保持 `32768` 不变。
- 改动文件：
  1. `src/lib/pi-chat.ts` — `DEFAULT_CONNECTION.contextWindow: 200000 → 1000000`（单行 diff）。
  2. `progress.md` — 本条记录。
  3. `session-handoff.md` — 同步本次会话目标/改动/验证。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/settings-workspace-react.test.ts tests/frontend/side-chat-agent.test.ts tests/frontend/context-usage.test.ts` → 3 files / 36 tests passed。
  - `npm run lint` → 0 errors / 4 warnings（3 个 `coverage/` 生成目录 Unused eslint-disable + 1 个既有 `usePinnedSummaryCapsule.tsx` exhaustive-deps，均与本次改动无关）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.66s）。
- Notes：
  - 全仓库 `200000` / `200_000` grep 结论：无任何测试断言“默认值本身”，命中的都是无关常量或测试内联值，未做改动——`src/lib/auto-compact-settings.ts:48`（自动压缩 `minSourceChars` 上限）、`server/auto-compaction.mjs:44,237`（同上限 clamp）、`src/components/workspace/side-chat-agent.ts:9` + `server/routes/side-chat.mjs:12` + `server/routes/workspace-browser-service.mjs:30`（侧聊/搜索字符预算与行数护栏）、`tests/frontend/side-chat-agent.test.ts:16`（测试内联 `contextWindow: 100_000`）、`tests/frontend/settings-workspace-react.test.ts:21`（`DEFAULT_CONNECTION` 为 mock，`contextWindow: 128000`，与真实常量解耦）。`dist/`、`package-dist/`、`package-offline/`、`coverage/` 内的同名命中属生成产物，按约束未触碰。
  - `src/lib/i18n.ts` 只有 `contextWindow: 'Context Window'` 标签文案（en/zh 两处），没有写死 `200000` 或 “200K” 的表述，因此未改。
  - 遗留风险（未修改，仅记录）：`server/conversation-compaction.mjs:203-206` 的压缩 transcript 上限为 `Math.min(160000, Math.max(12000, Math.floor(contextWindow * 1.6)))`，即使 `contextWindow` 提升到 1M 也被 160000 字符硬顶，长会话压缩摘要的输入广度不会随 1M 窗口放大；另外 `maxTokens` 仍为 32768，1M 窗口下单次输出上限不变（本次按最小改动原则不动）。
  - 未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`；`feature_list.json` 当前为空（`{"features":[]}`），无对应 feature 条目，未改动。

## run-command-stop-button-inline（done，2026-10-29）

- Goal：运行中的 `run_command` 工具行，停止 icon 不再被顶到整行最右，而是从左到右紧跟摘要/箭头排列；向下展开日志时按钮也不能回到行尾。
- 结论（一句话）：本地工具卡改为「标题行 + 展开面板」两层——`.quickforge-tool-header` 只包 `<details><summary></details>` 和终止按钮，`.quickforge-tool-panel` 移到 details 外铺满整行，可见性由 `details[open]` 驱动。有按钮时标题行按内容收缩，按钮始终紧跟摘要末尾，展开/收起/超长命令都不会改变按钮位置。
- 改动文件：
  1. `src/lib/tool-renderers/local-workspace-tool-renderer.tsx` — 新增 `.quickforge-tool-header` 包装层，展开面板改为兄弟节点 `.quickforge-tool-panel`。
  2. `src/styles/chat/tool-summary.css` — 移除按钮绝对定位/行宽收紧规则，改为 header 收缩、按钮正常流式、面板 `:has(details[open])` 显隐。
  3. `src/styles/chat/tool-output.css` — 对话列宽约束补充 `.quickforge-tool-panel`。
  4. `tests/frontend/local-tool-running-sweep.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts` — 更新布局契约。
  5. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature 状态与验证。
- 验证 / Evidence：
  - `npx vitest run` 工具渲染器与 CSS 契约 8 个文件 → 187 passed。
  - `npx eslint src/lib/tool-renderers/local-workspace-tool-renderer.tsx tests/frontend/local-tool-running-sweep.test.ts tests/frontend/chat-surface-css-contract.test.ts` → 无输出。
  - `npm run build` → 成功（`tsc -b && vite build`）。
  - 真实渲染实测（复用 5176 dev server + 临时预览页，已删除）：收起态与展开态 header 均 200px（整行 624px），按钮距箭头 5px、位置不随展开变化；展开面板 624px；完成态无按钮、header 占满整行。
- Notes：
  - 面板移出 details 后不再依赖浏览器原生折叠内容槽，改由 `:has(details[open])` 控制显隐；开合记忆、键盘操作、chevron 旋转仍由原生 summary/details 承担。
  - 停止按钮仍在 `<summary>` 外（延续 `0c782f81` 的 nested-interactive 修复）；无按钮的普通工具行 header 仍占满整行，点击热区不变。
  - 未创建 Git commit / tag / push；未手工修改生成产物。

## render-memory-and-attachment-boundary（done，2026-10-29）

- Goal：按 P0–P3 消除浏览器打开 QuickForge 页面时的内存放大与卡顿，不改变交互；禁止打补丁。P0 流式链路、P1 首屏依赖与压缩、P2 有界窗口与快照、P3 附件传输边界一次做完。
- 结论（一句话）：流式帧只传一份消息且只缓存定稿内容；渲染窗口有界并按锚点驱逐；会话快照只存尾部 200 条；历史附件只传 `assetUrl`，字节按需读取并在客户端生成缩略图；首屏移除 `pi-ai`/xterm 并启用 br/gzip。
- 关键改动：
  1. `server/utils/sse-wire.mjs`（新）+ `routes/agent.mjs` / `routes/shared-conversation.mjs`：SSE `message_update` 删除 `assistantMessageEvent.partial`，50ms 合并不变；进程内事件不收敛，ACP/Goal/Hooks 不受影响。
  2. `MarkdownBlock` 增加 `finalized`（本行 `isStreaming` 传入）；`preprocessLatexDelimiters(content, cacheable)`；`highlightCode(..., { cache })`；流式不写 300/400 条中间缓存，`message_end` 写一次。
  3. `windowed-messages.ts` 增加 `WINDOW_MAX_TURNS=12` / `WINDOW_MAX_CHARS=160000`：向上翻页超限丢较新轮次，向下翻页超限丢较旧轮次；`ChatSurface.loadNewerMessages` 用 `readScrollAnchor`/`anchoredScrollTop` 补偿。
  4. `session-message-cache.ts` schema 2：仅尾部 200 条 + `windowOffset` + 服务端总数；IndexedDB 64MB 预算；`ServerAgent` 构建时切片、restore 缓存命中恢复 offset；旧 schema 直接 miss。
  5. `server/client-attachments.mjs` + `message-attachment-lookup.mjs` + `routes/message-attachments.mjs`：出站删除 `content`/`extractedText`、保留 ≤128KB `preview`、追加 `assetUrl`；新增 session/share 附件端点（`?raw=1` 字节 / 默认 JSON）；热会话扫内存、冷会话 `instr(message_json, JSON.stringify(id))`；作用于 state/restore/messages/rollback/SSE/view/shared。
  6. `attachment-client.ts` + `AttachmentTile` + `AttachmentOverlay` + `ChatTypes`：`content` 可选、`assetUrl` 新增；tile 用 160px canvas 生成 blob 缩略图（LRU 40，淘汰 revoke）；overlay 按需解析；`useChatActions` 回滚草稿与 fork 上传前解析附件；分享页回滚同样处理。
  7. `custom-model-selector.ts` 本地 `modelsAreEqual`；删除三个浏览器 agent 类上无消费的 `streamSimple`；`WorkspaceInspector` 内 `TerminalDock` lazy；`scripts/precompress-assets.mjs`（新）+ `server/routes/static.mjs` 协商 br/gzip；`package.json` build 末尾执行预压缩。
  8. 文档：新增 `docs/architecture/render-memory-and-attachment-boundary.zh-CN.md`，同步 `docs/wiki/README.md`、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- 验证 / Evidence：
  - `npm run test` → 461 files / 5357 passed / 2 skipped（最后一次全量；随后仅改 test fixture 与附件 raw/preview 细节，定向测试全过）。
  - `npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功，`[precompress] 224 files: 12.66MB → 6.48MB`。
  - 首屏：`dist/index.html` preload 无 `pi-ai`/`xterm`；初始 JS/CSS 2.10MB 原始 / 0.53MB gzip（原 3.6MB 未压缩）。
  - 隔离实例浏览器实测（临时数据目录，已删除）：1000 条消息会话打开峰值从 125MB 降至可控（6 行 13k DOM，深滚受 12 轮上限约束）；图片会话 view 响应 2KB 且附件仅 `id/assetUrl`，tile 以 `?raw=1` 生成 blob 缩略图，overlay 正常显示。
- Notes / 已知取舍：
  - 深度上翻超过 12 轮后滚动条长度会变化（正文位置不变）；旧图片首次渲染可能先显示图片占位图标再换缩略图；首次打开终端多一次本地 chunk 加载。
  - 附件端点 `cache-control: immutable`，改了响应形状后旧浏览器缓存仍可能返回旧 JSON（多一个 `preview` 字段）；客户端解析不依赖它。未做 URL 版本化，避免为一个未消费字段引入缓存失效逻辑。
  - 未做 SSE delta 协议、增量 Markdown、虚拟列表库、DB 压缩；939MB 会话库与服务端 idle retention 属独立议题。
  - 未创建 Git commit/tag/push；`dist/` 由 build 产出，未手工修改。
