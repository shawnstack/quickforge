## 当前交接：session-open-fast-path-m3（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮完成准则 4 的剩余部分——**消除切换会话的整树 remount**（M3）。未提交。
- 方案（已落地）: 会话视图保活池。非活跃会话的渲染子树保留在 DOM（`display:none`），切回时按行 key 复用 fiber。**关键前提**：`ServerAgent.dispose()` 不清 `state`（`server-agent.ts:1236`），所以「保留渲染产物」不需要「保留 agent 运行时」——`MAX_IDLE_AGENT_TASKS` 保持 0，agent 生命周期零改动，也就不会引入跨项目 `workspaceRoot` 污染。
- 本轮核心改动: 新增 `src/components/chat/SessionViewPool.tsx`、`src/lib/session-view-pool.ts`、`src/lib/session-view-activity.ts`；`App.tsx` 用池包裹 `ChatPanelHost`；`ChatPanelHost` 新增活跃性订阅，在离开/回到前台时显式重放三条原本靠卸载完成的动作（草稿末次落盘、复位滚动、装饰重扫）；`ChatSurface` 贴底写 `scrollTop` 前跳过隐藏视图。顺带修掉多面板下弹层取「文档中第一个面板」的缺陷（`thinking-level-controls.ts`、`model-controls.ts`、`useModelActions.ts`）。
- 两处实现取舍（都有实测依据，别绕回去）: ① **池必须是类组件**——冻结「离开时那个元素」只能在本次 render 仍输出它的时候做，用 ref 在 render 期读写违反 Rules of React、用 effect 里 setState 会被 lint 拒绝且实测**丢槽位**（切到 B 后 B 整个消失）。② **装饰门控用 DOM 可见性而非活跃性信号**——信号在 `useLayoutEffect` 发布，本视图刚变可见的那次提交上信号可能仍指旧视图，会把唯一一次权威装饰跳过。
- Files（本轮改动文件）: 上述新增 3 个 + `src/App.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/panel-decoration.ts`、`src/components/chat/panel-decoration/thinking-level-controls.ts`、`src/components/chat/panel-decoration/model-controls.ts`、`src/hooks/useModelActions.ts`、新增测试 `session-view-pool.test.ts` / `session-view-pool-dom.test.ts` / `session-view-activity.test.ts` / `composer-popover-panel-scope.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 83↔16 行会话 SPA 内切换（`PerformanceObserver` longtask）——离开 1 个/55ms；切回（保活命中）4 个/累计 249ms/最大 83ms；对照改动前基线（618↔171 行）小→大 2360ms/最大 854ms，**500–850ms 的整树重建尖峰已消失**。交互契约实测：`.qf-scroll-container` 探针属性切回后存活（**同一 DOM 容器**）、装饰产物与切走前完全一致（4 过程组 / 6 消息动作 / 83 行）、贴底 `-0.5`、两视图并存、真实滚轮滚动滞回（脱离 1400px 时回底按钮出现且可见，回底后距离 0 且按钮自动隐藏）、草稿隔离 `isolated=true` 与恢复 `restored=true`、composer 四钩子齐全。`npm run test` 404 文件 4633 用例通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.66s）。临时实例 32210/32212/32214/32216/32218 已清理，主实例 5176 全程 health 200。
- Blockers（阻塞）: 无。两次误判已排除，教训复用：① 一个 4 轮会话的轮次导航节点为 0，一度判定回归，实际是 `TURN_NAVIGATION_MIN_TURNS = 5`，**空轨道才是正确行为**；② `page.goto` 换 URL 会整页重载、绕过 SPA，测不到保活，必须在 SPA 内切换（侧栏点击）。
- Next Session（下一步）: 只剩 M4（把 `panel-decoration` 的 20+ 命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构）。它的价值是可维护性，不是性能——装饰 pass 12–17ms 不是瓶颈。若要做，必须先按 `scroll-anchor.ts` / `message-rows.ts` 的既有抽象逐项替换，每项单独可回滚。**不要重试已否决方案**：切小批、ThinkingBlock memo、指纹按对象缓存。未提交 Git；未手工修改生成产物；不要关闭用户正在使用的实例（5176）。

---

## 当前交接：session-open-fast-path-round3（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮把 Markdown 解析纳入内容寻址缓存，至此准则 2 完整兑现。M3（消除整树 remount）仍未开始。未提交。
- 本轮核心改动: **推翻上一轮结论并落地**。上一轮判断「缓存 `react-markdown` 元素树无效」，前提是它必须是 JSX 组件；查证 `node_modules/react-markdown/index.js` 后确认默认导出 `Markdown(options)` 是普通函数（`post(processor.runSync(processor.parse(file)), options)`）。因此改为渲染期直接调用它、缓存返回的元素树：`Markdown.tsx` 新增 `markdownElementCache` + `renderMarkdownTree` + `clearMarkdownElementCache`，`MarkdownBlock` 经 `memoizeContent` 取缓存。缓存键只需 `content`（插件列表是模块级常量，math token 由同一 content 决定）。
- Files（本轮改动文件）: `src/components/chat/surface/Markdown.tsx`、`tests/frontend/chat-math.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: `npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.79s）。定向：chat-math 13（新增 3 例元素树缓存契约）、chat-surface-css-contract + chat-surface-message-list + chat-surface-render 83。
- Blockers（阻塞）: 无技术阻塞。环境侧：本机 32176 端口已有旧版 QuickForge 实例在跑，新代码的 `/api/sessions/:id/view` 在该实例上返回 404（说明是旧进程），因此本轮未做浏览器实机验证；单元/集成测试已覆盖端点契约。
- Next Session（下一步）: 准则 4 的剩余部分（消除整树 remount）。关键约束已确认：`ChatSurface` 的 `key={agentRuntimeScopeId ?? agent.sessionId}` **不能直接去掉**——它同时承担「切换会话时丢弃上一会话的草稿恢复与编辑器状态」的职责，直接删会引入跨会话草稿串染。正确路径是先把会话级瞬态状态（草稿恢复代次、编辑器值、折叠展开集）迁到显式的会话键作用域，再让 `ChatSurface` 复用实例。M3/M4 与三项现网待确认事实（附件跨会话保留预期、过程组自动收起预期、`MAX_IDLE_AGENT_TASKS` 真实值）记录见 `docs/architecture/session-open-fast-path.zh-CN.md` 与 `progress.md`。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-acceptance（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮做系统性可见交互验收（准则 5）。未提交。
- 验收结果（浏览器实测，独立端口实例，361 条会话）：滚动滞回（初始贴底 0 / 小滚 40px 仍跟随 / 大滚后脱离 1141px）、回底按钮出现、轮次导航 6 节点未隐藏、折叠 6 组 + 5 条终答常显、composer 四钩子齐全且可编辑、草稿隔离与恢复——**全部符合契约**。
- 一次误报的排查: 侧栏点击会话行在合成 click / 强制点击下都不切换，一度判定为产品回归。用 `git stash` 在**基线代码复现同样现象**后排除——真实原因是会话行在 **dnd-kit 可拖拽排序容器**内，指针事件被 DnD 拦截。改用 deep-link 路由切换后草稿验证全部通过。教训：自动化交互失败先用基线对照排除自引入，再判断产品问题。
- Files（本轮改动文件）: `progress.md`、`session-handoff.md`、`feature_list.json`。**生产代码零改动**（`git stash` 已 pop，31 个已跟踪 + 13 个新增文件完整保留）。
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.41s）。主实例 5176 全程运行（health 200 复核），临时实例 32190/32191/32192 均已清理。
- Blockers（阻塞）: 无技术阻塞。准则 4 的「消除整树 remount」仍未做，需产品决策：`ChatSurface` 的 `key` 承担「换会话时丢弃上一会话草稿恢复/编辑器状态」——本轮已用实测确认这条职责真实存在且工作正常（草稿隔离与恢复通过），去掉它必须先设计显式迁移；另需确定附件跨会话保留、过程组自动收起、`MAX_IDLE_AGENT_TASKS` 三项事实。
- Next Session（下一步）: 两条路——① 动 `key` + 显式会话级状态迁移（收益最大，需先定迁移方案）；② 最近 N 个会话 DOM 保活（隐藏而非卸载，风险低，需定 N）。**不要再试「切小批」（已实测更差）或给 ThinkingBlock 加 memo / 指纹按对象缓存（已被测试锁定否决）。** 未提交 Git；未手工修改生成产物；不要关闭用户正在使用的实例。

---

## 当前交接：session-open-fast-path-hydrate-batching-probe（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮验证「分批补齐」能否削平首屏后的长任务——**被实测否决并回退**，但顺带确认了两条重要事实。未提交。
- 本轮两个发现:
  1. **首屏已足够快**：小→大切换 `click 1ms → load-start 35ms → first-paint/ready 303ms`。此前测到的 2360ms 累计阻塞**发生在 ready 之后**，属补齐，不在关键路径。
  2. **切断补齐 = 零长任务**：abort 掉 `hydrateFullHistory` 的全量请求后，实测 `longTasks: []`、`totalBlockMs: 0`。剩余阻塞的唯一来源就是那一次全量替换。
- 被否决的尝试: 全量替换改为「按 60 条逐帧向前扩展」。实测**更差**——累计阻塞 ~1.1s → **5006ms**、长任务 2 个 → **35 个**、最大单项 609ms → 324ms 但总量翻 4 倍。原因是每次提交都要重建整张列表，增量收益被重复成本吃掉。已完整回退，数据写进代码注释。
- Files（本轮改动文件）: `progress.md`、`session-handoff.md`、`feature_list.json`、`src/lib/server-agent.ts`（仅注释：记录「不要分批」的实测结论）。**生产逻辑零净改动。**
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.27s）。主实例 5176 全程运行（health 200 复核），临时实例 32188 已清理。
- Blockers（阻塞）: 无技术阻塞。剩余阻塞只能靠「减少总渲染量（窗口化）」或「不重建（DOM 保活）」解决，两者都属 M3，都需要产品决策：`ChatSurface` 的 `key` 承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换前必须定该状态迁移方式；另需确定附件跨会话保留、过程组自动收起、`MAX_IDLE_AGENT_TASKS` 三项事实。
- Next Session（下一步）: 只剩两条路——① 动 `key` + 显式会话级状态迁移（收益最大）；② 最近 N 个会话 DOM 保活（隐藏而非卸载，风险低，需定 N）。两者都需要你先确认上述事实。**不要再尝试「切小批」这类方案，已被实测否决。** 未提交 Git；未手工修改生成产物；不要关闭用户正在使用的实例。

---

## 当前交接：session-open-fast-path-remount-memo-probe（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮尝试用组件层优化削减 remount 成本——**两条候选路径都被测试否决并回退**，生产代码零净改动。未提交。
- 本轮结论（避免后续重复踩）:
  1. **不能给 `ThinkingBlock` 加 memo**：`thinking-block-interaction.test.ts` 直接调用组件函数断言 pointerdown-first 契约，memo 返回对象后 4 例全报 `ThinkingBlock is not a function`。且 memo 对 remount 本就无效（全新 fiber 必执行）。
  2. **不能按消息对象身份缓存 `messageDecorationFingerprint`**：`message-actions.test.ts:561` 断言「原地修改 details（数组引用不变）→ 指纹变化 → 行重新装饰」，与「同对象同指纹」的缓存前提冲突，2 例失败。
  两者都不是测试写错——测试锁定的是真实契约。**M3 没有组件层捷径**，必须动 `key` 或做 DOM 保活。
- Files（本轮改动文件）: `progress.md`、`session-handoff.md`、`feature_list.json`。**生产代码零净改动**（`ThinkingBlock.tsx`、`message-actions.ts` 的尝试均已完整回退，仅 `ThinkingBlock.tsx` 保留一段说明「为何刻意不 memo」的注释）。
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.49s）。主实例 5176 全程运行（health 200 复核），临时实例 32187 已清理。
- Blockers（阻塞）: 无技术阻塞。M3 仍需产品决策：`ChatSurface` 的 `key` 除 remount 外还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换前必须先定该状态的迁移方式；另三项事实（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）决定实例池大小与折叠默认态。
- Next Session（下一步）: 只剩两条可行路径——① 动 `key` + 显式会话级状态迁移（收益最大，风险最高）；② 最近 N 个会话 DOM 保活（隐藏而非卸载，风险低，但需定 N）。两者都需要你先确认上面的事实。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-remount-profiling（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮为准则 4 的剩余部分（消除整树 remount）建立成本基线并排除错误方向。M3 主体未动。未提交。
- 本轮产出（**未改生产代码，是诊断**）: 实测 A(618 行/10425 节点)↔B(171 行) 来回切换 —— 大→小 8 个 longtask/累计 1034ms/最大 238ms；小→大 10 个 longtask/**累计 2360ms**/**最大 854ms**。分段（点击为 0）：+5ms 首个 longtask 140ms（**早于 load-start，属旧树同步成本**）→ +148ms `load-start` → **+383ms 618 行旧 DOM 整体销毁（MutationObserver 记录移除 578 节点）** → +592ms first-paint/ready。
- 三个被数据排除的方向: 不是 DOM 解析（1.47MB `innerHTML` 重建单次 23ms）；不是布局（10425 节点强制布局 0.1ms）；不是网络（首个长任务早于请求）。→ 成本在 React 创建约 1 万个 fiber + 组件函数执行（会话含 125 个 ThinkingBlock、191 工具行、19 个 markdown 块）。
- Files（本轮改动文件）: `docs/architecture/session-open-fast-path.zh-CN.md`（M3 章节补实测数据与排除项）、`progress.md`、`session-handoff.md`、`feature_list.json`。**生产代码零改动。**
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 通过。主实例 5176 全程运行（health 200 复核），临时实例 32185/32186 均已清理。
- Blockers（阻塞）: 无技术阻塞。**但 M3 保活改造需要产品决策才能安全实施**——`ChatSurface` 的 `key` 除 remount 外还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换它必须先确定该状态如何显式迁移；另三项事实（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）决定实例池大小与折叠默认态。这些不是难度问题，是一致性基准无法由我单方面判定。
- Next Session（下一步）: 若确认可动 `key`：按 M3 实施 `SessionViewStore`（纯数据不可变 `Turn[]`）+ 显式会话级状态迁移，预期可消除 2360ms 累计阻塞中的大部分。若暂不动 `key`：可先做「最近 N 个会话 DOM 保活」（隐藏而非卸载），风险更低，但仍需决定保活数量。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-message-rows（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮消除准则 4 点名的「命令式 DOM 后置注入的重复扫描」。M3 主体（消除整树 remount）与 M4 未开始。未提交。
- 本轮核心改动: 新增 `src/components/chat/panel-decoration/message-rows.ts`（`readMessageRows` / `getPrimaryMessageList`）作为唯一枚举实现；此前 4 个装饰器各写一份 `querySelectorAll('.qf-user-message, .qf-assistant-message')` + `closest` 过滤（`message-actions`、`assistant-waiting-bubble`、`context-compaction`、`approval-card`）。`context-compaction` / `assistant-waiting-bubble` / `decorateMessages` 增加可选 `messageRows` 入参，`ChatPanelHost.decorate` 在 pass 开始时枚举一次并向下传递。
- 实现细节: `readMessageRows` 把 `closest('message-list, .qf-message-list')` 拆成两次单选择器查询——真实 DOM 等价，但测试脚手架只支持单选择器，合并写法会让 4 个既有用例失败。
- Files（本轮改动文件）: `src/components/chat/panel-decoration/message-rows.ts`（新增）、`message-actions.ts`、`assistant-waiting-bubble.ts`、`context-compaction.ts`、`approval-card.ts`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/message-rows.test.ts`（新增）、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.58s）。浏览器实测（独立端口 32184，361 条会话）：171 行、消息动作 8、压缩横线 1、过程组 6、composer 与贴底正常。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 准则 4 还剩「消除整树 remount」，唯一路径是 M3：在已收敛的 `scroll-anchor` 抽象之上建 `SessionViewStore`（纯数据、不可变 `Turn[]`），让展示层跟随「会话」而非「agent 实例」，并为 `ChatSurface` 的 `key` 设计显式的会话级状态迁移策略。这是压缩 10MB 全量补齐（分页 + 窗口化）的前置。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-scroll-anchor（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮把重复的滚动锚点逻辑收敛为单一抽象（M3 前置），并修掉实测暴露的一个既有缺陷。M3 主体与 M4 未开始。未提交。
- 本轮核心改动: 新增 `src/components/chat/scroll-anchor.ts`（`readScrollAnchor` / `resolveAnchorRow` / `anchoredScrollTop` / `ScrollAnchor`），`ChatSurface` 的 `captureReadingAnchor`、`applyReadingAnchor`、`loadMoreMessages` 三处改为复用；`loadMoreMessages` 用 `requireMessageIndex: true` 表达「分页必须锚在真实消息行」。
- 顺带修复的既有缺陷: 顶部可见行是折叠过程组（无 `data-message-index`）时，原实现回退 ordinal，前置 100+ 行后 ordinal 指向错误的行，浏览器实测「scrollTop 不变但顶部文字被换掉」。改为优先锚在带索引的真实消息行。修复后实测 `topText` 保持一致。
- Files（本轮改动文件）: `src/components/chat/scroll-anchor.ts`（新增）、`src/components/chat/surface/ChatSurface.tsx`、`tests/frontend/scroll-anchor.test.ts`（新增）、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `npm run test` 全量 399 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.78s）。浏览器实测（446 条会话，独立端口 32182）：补齐后 `topText` 一致、`hydrated` 99 → 203 行。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 在 `scroll-anchor` 之上建 `SessionViewStore`（纯数据、不可变 `Turn[]`），让展示层跟随「会话」而非「agent 实例」，这是准则 4 的唯一实质路径；随后才能安全开启窗口化以压缩 10MB 全量补齐。M4 的价值在可维护性，不在性能（已实测装饰 pass 16–17ms 非瓶颈）。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-decorate-measurement（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮量化装饰层真实成本，判断 M4 是否值得投入。M3/M4 均未开始。未提交。
- 结论：**装饰层在当前规模不是瓶颈，M4 不应以性能为由推进。** 618 行完整会话单次装饰 pass 16.5–17.2ms（首次 5.1ms），低于 50ms longtask 阈值。M4 的真正价值是消除命令式 DOM 注入的状态复杂度与自愈逻辑，属可维护性收益。
- 一次尝试并回退的优化：选择器收窄为纯类名（实测遗留标签匹配 0，走查 6.94ms → 4.91ms），但 `message-actions.test.ts` 用 `createFakeElement('user-message')` 锁定了遗留标签兼容行为，收窄后用例失败。收益约 2ms/次，不值得换一个被测试锁定的契约。已完整回退，理由与数据写入代码注释。
- Files（本轮改动文件）: `src/components/chat/panel-decoration/message-actions.ts`（仅注释：记录实测结论与回退理由）、`progress.md`、`session-handoff.md`、`feature_list.json`。**无生产逻辑改动。**
- Evidence（验证）: 独立端口临时实例（32181）Playwright 实测——618 行、装饰 pass 16.5/17.2/16.5ms（首次 5.1ms）、行枚举 6.2ms、遗留标签匹配 0。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（6.18s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3 是准则 4 的唯一实质路径——把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor`，再在其上建 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」），并以此为基础压缩 10MB 全量补齐（服务端分页 + 前端窗口化）。若不做 M3，准则 4 无法达成，目标应保持 active。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-cache-proof（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮把「渲染缓存生效」从自证式断言改成可证伪证据。M3/M4 未开始。未提交。
- 本轮核心改动: `tests/frontend/chat-math.test.ts` 新增 `react-markdown` 模块 spy，统计 unified 流水线实际运行次数；新增 2 例——命中缓存时调用数不增、`clearMarkdownElementCache()` 后调用数增加。原实现只断言「同一 content 两次渲染输出一致」，而这个断言在「每次都重新解析」时同样成立，无法区分命中与未命中。
- 事实核实: 在 Node 中确认 `react-markdown` 默认导出是普通函数（`typeof default === 'function'`，源码为 `function Markdown(options)`），因此在渲染期直接调用并缓存元素树是可行的——这也印证了更早轮次对「无法缓存元素树」这一错误结论的更正。
- Files（本轮改动文件）: `tests/frontend/chat-math.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `chat-math.test.ts` 15 例全通过（含新增 2 例）；`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` 成功（5.82s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32180。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3——把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor` 抽象，再在其上建 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）；这是压缩 10MB 全量补齐（服务端分页 + 前端窗口化）的前置。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点。装饰 pass 12–17ms 不是瓶颈，暂不优化。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-idle-hydration（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮做首屏精确耗时归因并把全量补齐移出关键路径。M3/M4 未开始。未提交。
- 归因结论（1279 条会话，点击切换）：`/view` 8ms/592KB、`/state` 18ms/77KB、尾部对账 `/messages` 2ms/2.4KB、`click → first-paint` 275ms（命中缓存）；**全量补齐 `/messages` 141–186ms / 10MB，原本在 first-paint 同时发起**。
- 本轮核心改动: `ChatPanelHost` 的补齐触发从 first-paint 回调改为 `requestIdleCallback`（`timeout: 2000` 兜底，无该 API 时 300ms `setTimeout`），并使用独立取消句柄 `cancelHydration`（cleanup 中调用）。实测补齐启动点推迟到首帧后 270ms，补齐结果正确。
- Files（本轮改动文件）: `src/components/chat/ChatPanelHost.tsx`、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 独立端口临时实例（32179）Playwright 实测——补齐请求启动点 = 首帧后 270ms（修复前与首帧同时），补齐后 `minIdx=0`/`maxIdx=1277`、贴底、composer 正常。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.95s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例。
- 被避免的 bug: 最初把 idle 句柄赋给 `cancelInitialRenderReady`，会覆盖首帧就绪通知的取消函数。已改为独立 `cancelHydration` 并加源码契约测试锁定。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 剩余最大单项是 10MB 全量补齐（已不在关键路径，但仍是带宽与内存成本）。压缩它需要服务端分页 + 前端窗口化，属 M3 范畴：先把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor`，再建 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点。装饰 pass 12–17ms 不是瓶颈，暂不优化。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-decorate-timing（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮补齐「首帧后第一轮装饰」的观测盲区，并实测确认它在当前规模下不是瓶颈。M3/M4 未开始。未提交。
- 本轮核心改动: `session-open-timing.ts` 新增 `recordFirstDecorateTiming` / `firstDecorateMs`（并额外打 `qf:session-open:decorate:<sid>` mark，带 durationMs detail）；`ChatPanelHost.runDecorate` 在结束时记录首轮耗时。只记第一轮，避免流式期常规装饰掩盖真实数字。
- Files（本轮改动文件）: `src/lib/session-open-timing.ts`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/session-open-timing.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 独立端口临时实例（32178）实测——1279 条消息活跃会话 `click → first-paint/ready = 441ms`（上轮同链路 608ms），补齐后 `minIdx=0`/`maxIdx=1277` 正常；203 行时单次强制装饰 pass 约 12–17ms，无 longtask（<50ms 阈值）。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.24s）。主实例 5176 全程运行（health 200 复核），仅清理临时进程 32178。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值）；`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3——把 `captureScrollAnchor` / `applyReadingAnchor` 提升为通用 `ScrollAnchor` 抽象，再在其上做 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。装饰 pass 当前 12–17ms 不是瓶颈，暂不优化。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-active-window（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上完成「会话打开快路径」的实机端到端测量与收尾。M3（实例池 keep-alive）与 M4（装饰层全量 React 化）未开始。未提交。
- **本轮最重要的发现**：只读视图的**内存命中分支**直接返回 `getSessionState`（含完整消息列表），导致 1279 条消息的活跃会话 `/view` 返回 9.5MB/1946ms、首屏 3202ms——端点在最需要它的场景没有生效。修复为「内存命中同样走尾部窗口，但保留 `tools`/待审批/流式等运行时字段」后：592KB/7ms、首屏 608ms（−81%）。
- 核心改动: `server/routes/session-view.mjs` 的内存命中分支加尾部裁剪 + `messagesSummary`；`tests/server/routes/session-view.test.mjs` 补 2 例锁定该行为（活跃会话走尾部窗口、未超窗口时不带 summary）。
- Files（本轮改动文件）: `server/routes/session-view.mjs`、`tests/server/routes/session-view.test.mjs`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 独立端口临时实例（32177）实测——冷 `view` 592KB/11ms；`restore` 76KB + 内存命中 `view(tail=200)` 592KB/7ms（此前 9.5MB/1946ms）；Playwright 首屏 `click→first-paint` 3202ms → 608ms，补齐后 `minIdx=0`/`maxIdx=1277` 正常。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.67s）。主实例 5176 始终运行（`/api/health` 200 复核）。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项产品决策（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值），且 `ChatSurface` 的 `key` 不能直接去掉——它还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: 优先补 M3 的前置：把本轮与上轮的滚动锚点实现（`captureScrollAnchor` / `applyReadingAnchor`）提升为通用 `ScrollAnchor` 抽象，再在其上做 `SessionViewStore`（展示层跟随「会话」而非「agent 实例」）。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。未提交 Git；未手工修改生成产物；**不要关闭用户正在使用的实例**。

---

## 当前交接：session-open-fast-path-hydration-anchor（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上完成「会话打开快路径」的 M2 实机验证，并修复补齐历史导致的滚动跳变。M3（实例池 keep-alive）与 M4（装饰层全量 React 化）未开始。未提交。
- 本轮核心改动: ① 新增阅读锚点补偿——`ChatSurface` 暴露 `captureScrollAnchor()`（记录顶部可见行的视口偏移 + 绝对 `data-message-index`，无索引时用 ordinal 回退以覆盖折叠过程组），layout effect 在提交时按 delta 补偿 `scrollTop`；② `hydrateFullHistory(beforeReplace?)` 在替换前一刻同步调回调，宿主在 `ChatPanelHost` 的就绪回调里接上；③ 修复 `server-agent.ts` 中未做环境判断的 `window.requestAnimationFrame`（非 DOM 环境抛错）。
- Files（本轮改动文件）: `src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/ChatPanelHost.tsx`、`src/hooks/useAgentManager.ts`、`src/lib/server-agent.ts`、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 浏览器实机（Playwright）——网络顺序 `/view` → `/state` → `/messages?after=360`；361 条与 1179 条会话均可滚到 `data-message-index=0`，贴底/composer/回底按钮/轮次导航正常；补齐时 `topText` 不变且 `scrollTop` 从 258 精确补偿到 404（886 条会话）。端点级：1179 条会话 `/view` 601KB/20ms（全量 4.6MB/57ms）。`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.85s）。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项需产品决策的事实（附件跨会话是否保留、过程组流式结束是否自动收起、`MAX_IDLE_AGENT_TASKS` 实际值），且 `ChatSurface` 的 `key` 不能直接去掉——它还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」的职责。
- Next Session（下一步）: M3——`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」，先把滚动状态归约为单一 `ScrollAnchor`（本轮已有一个面向「头部插入」的锚点实现可复用为起点），再考虑开启窗口化。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-tail-window（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。本轮实机验证 M2 只读视图通道，修正了实测暴露的设计缺陷与两处正确性问题。M3/M4 未开始。未提交。
- **本轮最重要的发现**：第一版 `/view` 全量返回虽然省掉一次串行往返（151ms → 57ms），但**字节数完全没降**（4.6MB 不变），瓶颈只是从「服务端重建运行时」转移成「单次超大响应 + 前端主线程解析」。改为尾部窗口后才真正同时拿到时间与体积收益：1179 条会话 4.6MB/112ms → 601KB/20ms。
- 核心改动: ① `server-state-service.mjs` 新增 `readSessionStateTail`（SQLite 只取末 N 条 + total，仅在窗口被截断时返回 total）；② `session-view.mjs` 默认 `tail=200` 并支持 `?tail=N`，只在截断时下发 `messagesSummary.count`；③ `server-agent.ts` 新增 `messageWindowOffset`（修正增量对账的索引基准）+ `hydrateFullHistory()`（补齐被省略的前缀）+ `mergeWindowedMessages()`（丢弃落在省略前缀里的尾部条目）；④ `useAgentManager.ts` 在 `loadedViaView` 时并行发起 `syncState()` 与 `hydrateFullHistory()`。
- Files（本轮改动文件）: `server/session-state-service.mjs`、`server/routes/session-view.mjs`、`src/lib/server-agent.ts`、`src/hooks/useAgentManager.ts`、`tests/server/routes/session-view.test.mjs`、`tests/frontend/server-agent.test.ts`、`tests/frontend/server-agent-message-window.test.ts`（新增）、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 实机 curl 实测（1179 条会话：`/view` 601KB/20ms、`tail=50` 128KB/5ms、全量视图 4.6MB；361 条会话 815KB/24ms）；`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.60s）。
- Blockers（阻塞）: 无技术阻塞。**但有一项验证缺口必须先补**：本轮只做了 curl 端点级实测，**没有在真实浏览器里点击会话验证渲染与滚动**。尾部窗口 + 后台补齐这条链路涉及滚动位置、`messagesSummary` 对账、`hydrateFullHistory` 触发时机，端点级测试无法覆盖，必须补 UI 级验证才能确认「用户可见交互不变」。
- Next Session（下一步）: ① **优先补浏览器实机验证**：打开一个 300+ 条消息的会话，确认首屏立即显示尾部内容、可向上滚动到最早历史、滚动位置正确贴底、`messagesSummary` 被正确消费。② 之后才推进 M3——`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」；注意 `ChatSurface` 的 `key` 不能直接去掉，它同时承担「换会话时丢弃上一会话的草稿恢复/编辑器状态」的职责，需先用显式的会话级状态迁移策略替代。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-round2（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上继续推进「会话打开快路径」。本轮补齐 KaTeX 渲染缓存（第二个里程碑缺口）并扩大装饰热路径的重复扫描削减；M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未开始。未提交。
- 本轮核心改动: ① `KatexMath.tsx` 接入内容寻址缓存（`(display, latex)` → html），让会话切换 remount 时历史公式不再重复 `renderToString`；增加 `clearKatexHtmlCache` 供测试隔离。② `ChatPanelHost.tsx#artifactsInputKey` 按 `messages` 数组身份加 `WeakMap` 记忆——依据是既有不变量「`state.messages` 从不原地修改」（已全仓核实无 `push`/`splice`/`pop`/`shift`/`unshift` 写入）。
- 被测试否决并回退的改动: 给 `goal-iteration-divider` 加「details 指纹相同就跳过」短路。该装饰器的既有语义是**每周期重新确认分隔线仍挂在宿主末尾**（其它装饰器可能在它之后追加内容），`goal-iteration-divider.test.ts` 显式锁定了这个幂等重定位行为。已回退，理由写入架构文档。
- Files（本轮改动文件）: `src/components/chat/surface/KatexMath.tsx`、`src/components/chat/ChatPanelHost.tsx`、`tests/frontend/chat-math.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: `npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.69s）。定向：chat-math 10、goal-iteration-divider 67、chat-surface-render + chat-surface-behavior-alignment 27。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项需现网验收的事实（与上轮相同）：附件跨会话丢失是 bug 还是预期；过程组流式结束后是否应自动收起；`MAX_IDLE_AGENT_TASKS = 0` 与 wiki 写的「保留 5 个」不符。
- Next Session（下一步）: M3——`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」，**先把滚动状态归约为单一 `ScrollAnchor`（`{ turnId, offsetPx }`）**再开窗口化。注意 `ChatSurface` 的 `key` 不能直接去掉：它同时承担「换会话时丢弃上一会话的草稿恢复/编辑器状态」的职责，需要先用显式的会话级 key 迁移策略替代。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-m4-slice（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进「会话打开快路径」。M0 埋点基线、M1 消除重复计算、M1.5 MCP 渲染器按名字兜底、M2 只读视图通道、M4 首个可证明等价切片（装饰层与滚动路径的重复扫描削减）已完成；M3（会话视图实例池 keep-alive）与 M4 全量 React 化未开始。未提交。
- 本轮核心改动: ① `message-actions.ts` 的 `getMessageElements` 改为单遍遍历 + 提前 `continue`（原为 `Array.from` + 两次 `filter`），语义不变、少一次中间数组与一轮祖先遍历；② `process-folding.ts` 的 `decorateProcessBlocks` 用 `flushTurn` 闭包单遍分组，避免每轮回调新建数组；③ `scroll-sync.ts` 的 `scrollToBottom` 先读 `scrollTop` 再读 `scrollHeight`，尽量让「已贴底」短路避免布局失效。三者都只重排执行路径，阈值/分组规则/DOM 结构/类名一律未动。
- Files（本轮改动文件）: `src/components/chat/panel-decoration/message-actions.ts`、`src/components/chat/panel-decoration/process-folding.ts`、`src/components/chat/scroll-sync.ts`、`progress.md`、`session-handoff.md`。（M2 的文件清单见下一条交接。）
- Evidence（验证）: 定向 vitest——process-folding 系列 4 文件 118 passed、scroll-sync + scroll-to-bottom-button 29 passed；`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（5.66s）。
- Blockers（阻塞）: 无技术阻塞。M3 仍缺三项需现网验收的事实：① 附件跨会话丢失是 bug 还是预期（无任何测试断言）；② 过程组在流式结束后是否应自动收起（`process-folding.ts:147-149` 把流式期默认展开写入 saved state，与注释矛盾）；③ `MAX_IDLE_AGENT_TASKS = 0` 与 wiki 写的「保留 5 个」不符，该值决定实例池大小。
- Next Session（下一步）: M3——`SessionViewStore`（纯数据、不可变 `Turn[]`）让展示层跟随「会话」而非「agent 实例」；**先把滚动状态归约为单一 `ScrollAnchor`（`{ turnId, offsetPx }`）**，四组滞回阈值降为独立策略常量表，再开窗口化，否则会改变「滚动到顶部」的可见行为。之后才是 M4 全量 React 化（`panel-decoration` 的 20+ 命令式注入器改 React 兄弟节点，保留现有类名与 DOM 结构）。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-m2（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上，为「打开历史会话」提供不重建 Agent 运行时的读取通道，把 `/restore` 与运行时 attach 移出首屏关键路径。M0/M1/M2 已完成；M3/M4 未开始。未提交。
- 核心改动: ① 服务端新增 `server/routes/session-view.mjs`（`GET /api/sessions/:sessionId/view`），`server/index.mjs` 的 `handleApi` 注册 `/api/sessions/` 前缀；内存命中委派 `getSessionState`，未命中直接 `readSessionStateValue`，**绝不调用 `restoreAgent`**；响应形状对齐 `getSessionState`，可空字段统一用 `null`。② 前端 `ServerAgent.loadView` + `useAgentManager.performLoadSession` 改为「`loadView` 优先、失败回退 `restore`、`attachTaskToView` 之后后台 `syncState` 校准（`isLatestRequest` 守卫）」。③ `ToolMessage` 注册表未命中时对 `mcp__server__tool` 直接构造 `McpToolRenderer`，解决只读视图无 `state.tools` 与工具集晚到导致的 MCP 卡降级。
- Files（改动文件）: 新增 `server/routes/session-view.mjs`、`tests/server/routes/session-view.test.mjs`；改动 `server/index.mjs`、`src/lib/server-agent.ts`、`src/hooks/useAgentManager.ts`、`src/lib/local-tools.ts`、`src/components/chat/surface/ToolMessage.tsx`、`tests/frontend/server-agent.test.ts`、`tests/frontend/chat-surface-tool-message.test.ts`、`docs/architecture/session-open-fast-path.zh-CN.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: `npm run test` 全量 397 文件全通过；`npm run lint` 0 error（2 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.54s）。定向：session-view 5、server-agent 140、chat-surface-tool-message 10、chat-surface-message-list 19、chat-surface-behavior-alignment 10。
- Blockers（阻塞）: 无。M3 存在需要产品决策的前置事实（与上一轮相同，仍未取得现网验证）：① 附件跨会话丢失是 bug 还是预期（无任何测试断言）；② 过程组在流式结束后是否应自动收起（`process-folding.ts:147-149` 把流式期默认展开写入 saved state，与注释矛盾）；③ `MAX_IDLE_AGENT_TASKS = 0` 与 wiki 写的「保留 5 个」不符，该值决定 M3 实例池大小。
- Next Session（下一步）: M3——`SessionViewStore`（纯数据、不可变 `Turn[]`）让展示层跟随「会话」而非「agent 实例」，并把滚动状态归约为单一 `ScrollAnchor`（`{ turnId, offsetPx }`），四组滞回阈值降为独立策略常量表。**必须先归约 ScrollAnchor 再开窗口化**，否则会改变「滚动到顶部」的可见行为。M4 把 `panel-decoration` 的命令式注入器改为 React 兄弟节点，保留现有类名与 DOM 结构。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-m0-m1（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上优化「点击历史会话 → 首帧可交互」耗时，且不改变任何用户可见交互。M0（埋点基线）与 M1（消除重复计算）已完成；M2/M3/M4 为后续里程碑。未提交。
- 核心改动: ① M0 新增 `src/lib/session-open-timing.ts`（performance.mark 四段 click/load-start/first-paint/ready），接入 `useAppLoadingTransitions` 与 `ChatPanelHost`；② M1.1 新增 `src/lib/render-cache.ts`（FNV-1a 摘要定位 + 命中逐段严格比较的 LRU、异步 in-flight 合并），接入 `chat-math.ts` / `code-highlight.ts` / `mermaid-renderer.ts`；③ M1.2 `createServerTools` 消除 skills 目录重复扫描（`createSkillTools` 新增 `resolvedSkills`，复用 `loadSkillToolContext` 的结果）；④ M1.3 `server/storage.mjs` 新增 `(mtimeMs, size)` 校验的 `readJsonFileCached`（命中返回 structuredClone，`writeJsonAtomic` rename 后主动失效），`readProjectConfigData` 与 `readConfigStore` 改走缓存；⑤ M1.4 `GET /api/agents/:id/messages` 默认 limit 500 → 5000（服务端上限）。
- Files（改动文件）: 新增 `src/lib/render-cache.ts`、`src/lib/session-open-timing.ts`、`tests/frontend/render-cache.test.ts`、`tests/frontend/session-open-timing.test.ts`、`tests/server/project-config-read-cache.test.mjs`、`docs/architecture/session-open-fast-path.zh-CN.md`；改动 `src/lib/chat-math.ts`、`src/lib/code-highlight.ts`、`src/lib/mermaid-renderer.ts`、`src/hooks/useAppLoadingTransitions.ts`、`src/components/chat/ChatPanelHost.tsx`、`server/storage.mjs`、`server/agent-manager.mjs`、`server/routes/agent.mjs`、`server/tools/definitions.mjs`、`docs/architecture/session-state-transactional-storage.zh-CN.md`、`docs/wiki/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 全部通过（render-cache 8、session-open-timing 5、project-config-read-cache 4、code-highlight 60、chat-math 10、mermaid-renderer 3、app-domain-hooks 14、chat-surface-behavior-alignment 10、chat-surface-css-contract 37、chat-surface-message-list 19、server-agent 138、routes/agent 44、agent-manager.persist-session-state 34、definitions 22、storage-config-split 8、storage-layer 15、storage.session-metadata-pin 2）；`npx tsc -b` 通过；`npx eslint`（改动文件）0 error；`npm run test` 全量 exit 0。
- Blockers（阻塞）: 无。但 M2/M3/M4 存在需要产品决策的前置事实：① 附件跨会话丢失目前是未定义行为（代码路径推断、无测试断言）；② 过程组在流式结束后是否应自动收起，现有实现代码路径与注释矛盾（`process-folding.ts:147-149` 把流式期默认展开写入 saved state）；③ `MAX_IDLE_AGENT_TASKS = 0` 与 wiki 文档写的「保留 5 个」不符，该值直接决定 M3 实例池大小。这三项需先在现网验收取得事实，否则「复制旧行为」与「修复旧 bug」无法区分。
- Next Session（下一步）: 按 `docs/architecture/session-open-fast-path.zh-CN.md` 推进 M2——新增只读视图端点（复用 `readSessionStateValue`，完全不触碰 `restoreAgent`），前端把 `ServerAgent.restore` 拆成 `loadSessionView()`（首屏）与 `attachRuntime()`（后台），让 `/restore` 从关键路径降级为后台预取。M3 之前必须先归约 `ScrollAnchor`（`{ turnId, offsetPx }` 为唯一 truth），否则开启窗口化会改变「滚动到顶部」的行为。未提交 Git；未手工修改生成产物。

---

## 当前交接：compaction-divider-at-compacted-end（done，2026-10-21）

- Current Objective（当前目标）: 自动触发上下文压缩时，压缩横线显示在被压缩历史的末尾（对应位置），而不是被回溯挂到最新一轮提问上方、或兜底挂到列表最顶部。已完成，未提交。
- 核心改动: `src/components/chat/panel-decoration/context-compaction.ts` 删除 `alignBoundaryToUserTurn`（及仅供它用的 `isUserMessage`）——原实现把服务端 `compactedUpToIndex` 向前回溯到包含边界的用户回合，自动压缩默认 `keepRecentTurns=0` 时边界 = 消息总数，回溯后落点恒为「最新一轮提问上方」；边界改为直接 `compactedUpToIndex - messageIndexOffset`。`insertBeforeMessageElement` 重写为 `insertNoticeAtBoundary`：按「边界之前的可见消息条数」定位插入行（边界落在 `toolResult` 等不单独渲染的消息上时自然插到其后第一条可见消息之前）；边界在已渲染末尾之后时 `after(lastElement)` 跟到最后一条消息之后；仅在完全无消息行时才 `append` 到列表末尾（旧实现是 `prepend` 到最顶部）。`dataset.tailStart` 改名 `dataset.boundaryIndex`。
- Files（改动文件）: `src/components/chat/panel-decoration/context-compaction.ts`、`tests/frontend/context-compaction-notice.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 `npx vitest run tests/frontend/context-compaction-notice.test.ts` 7 passed；`npx vitest run tests/frontend` 223 文件 / 2673 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机触发一次自动压缩，确认横线出现在被压缩历史末尾（跟随最后一条已压缩消息之后），随后回复追加时横线位置不动；`npm run lint` / `npm run build` 若需发布再完整跑。未提交 Git；未手工修改生成产物。

---

## 当前交接：dead-code-cleanup（done，2026-10-21）

- Current Objective（当前目标）: 清理全仓死代码 / 未使用样式；确定死代码全删、仅测试可达的实现一并删、会话级文件回滚完全下线。已完成，未提交。
- 核心改动: 会话级「撤销全部文件」整链下线——删 `server/routes/agent.mjs` 的 `/file-changes` 与 `/rollback-files*` 路由、`server/session-file-backups.mjs` 的会话级实现（`inspectBatch`/`rollbackSelection`/`getSessionFileChanges` 等）、`ServerAgent` 的三个会话级方法、`ServerFileRollback*` 类型、`FileRollback*` 控制器与 `FileRollbackDialog` 组件、19 个专属 i18n key；轮级 `/rollback-turn*` 链路与写入侧 shadow backup 完整保留。另删 server/goal 11 个死导出 + 2 个私有死函数、`isTailscaleAddress`/`cronMatches`/`getSubagentDefinition`/`DEFAULT_HOOKS_SETTINGS` 等仅测试可达实现，以及前端 12 个仅测试可达函数/常量；CSS 删 3 个未使用类与 `--qf-console-fade`。
- Files（改动文件）: 31 个生产文件（server/ 11、src/ 20）+ 19 个测试文件 + `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md` + `progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: `npm run test` 393 文件 / 4534 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` 通过（仅既有大 chunk warning）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 如需继续瘦身，可清理 4 个 barrel 的 66 个「无消费者再导出」（本体全活，只删 export 行，属独立机械重构）。`.tmp-audit/` 为审计脚本与报告目录，可随时删除。未提交 Git；`dist/` 由 build 重新生成，未手工修改。

---

## 当前交接：docs-cleanup-stale-assets（done，2026-10-22）

- Current Objective（当前目标）: 评审并删除仓库内过时文档/资产，并修复文档链接失效问题。已完成，未提交。
- 核心改动: 删除 71 个过时文件与 4 个目录（一次性 reports/reviews/prototypes/analysis、已落地设计稿 `docs/design`、`docs/archive/goal-test-demo.md`、8 篇被取代的架构文档与 4 个 svg、误建的 `docs/wiki/src/lib/.git`、根目录误产文件与 `.tmp-*` 残留、`review-01~06.png`）；第二轮追加删除 `design/`、`design-review/` 全目录与 `design-mockups/` 中 24 个零外部引用的旧设计稿（现余 12 个，均有 `src/` 或 wiki 引用）；修复 `docs/wiki` 下 71 处相对链接层级错误；`docs/wiki/README.md` 新增「架构与设计文档」导航表；3 处架构文档交叉引用改指 `session-storage-v2.zh-CN.md`；修正 `logging-design.zh-CN.md`、`agent-plugin-system.zh-CN.md` 与 `design-mockups/goal-plan-tool-card-redesign.html` 中指向不存在文件的引用。
- Files（改动文件）: `docs/wiki/README.md`、`docs/wiki/src/README.md`、`docs/wiki/root-config.md`、`docs/wiki/{bin,public,scripts}/README.md`、`docs/wiki/server/{tools,utils}/README.md`、`docs/wiki/src/hooks/README.md`、`docs/architecture/{session-index-query-migration,session-state-transactional-storage,session-storage-v2,logging-design,agent-plugin-system}.zh-CN.md`、`design-mockups/goal-plan-tool-card-redesign.html`、`tests/frontend/code-highlight.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 自写链接/孤立文档校验脚本结果——docs 内 broken links 0、orphan docs 3（均为 `docs/archive/*` 状态归档，按机制无需入链）；JSON 解析（feature_list/package/package-lock/tsconfig）通过；`npx vitest run tests/frontend/code-highlight.test.ts` 60 passed；`npx eslint tests/frontend/code-highlight.test.ts` 通过；`npx tsc -b` 通过。未跑全量 `npm run test`/`npm run build`（本次仅文档、设计稿与注释改动）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 剩余 `design-mockups/` 12 个文件都仍被源码或 wiki 引用，如需彻底清理须先改掉这些引用；另外 `.agentbridge/`（248KB）、`.playwright-mcp/`、`.zcode/`、`.idea/` 为本地工具缓存（已被 `.gitignore` 忽略），可手动删除；未提交 Git；未修改生成产物。

---

## 当前交接：settings-search-autofill-guard（done，2026-10-21）

- Current Objective（当前目标）: 防止设置页桌面/移动搜索框偶发被浏览器自动填充网址、账号等。已完成，未提交。
- 核心改动: `SettingsWorkspacePage` 新增 `SETTINGS_SEARCH_INPUT_PROPS`（name/autoComplete/autoCorrect/autoCapitalize/spellCheck），两个搜索输入框共用；`LanAccessSettingsTab` 的局域网密码与 `CustomProvidersSettingsTab` 的 API Key 补 `name` + `autoComplete="new-password"`，避免 Chromium 把常驻密码框所在页当登录表单并把搜索框当用户名框；测试新增属性与源码契约断言。
- Files（改动文件）: `src/components/settings/SettingsWorkspacePage.tsx`、`src/components/settings/tabs/LanAccessSettingsTab.tsx`、`src/components/settings/tabs/CustomProvidersSettingsTab.tsx`、`tests/frontend/settings-workspace-react.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 15 passed；`npx eslint` 改动文件通过；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有大 chunk warning）。未跑全量 `npm run test`；浏览器自动填充未实机复现。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 在真实浏览器（Chrome/Edge，含移动端）打开设置页确认搜索框不再弹出历史网址/账号填充；若密码管理器仍注入，追加对应 ignore 属性或只读至聚焦方案。未提交 Git；未修改生成产物。

---

## 当前交接：appearance-settings-preview-redesign（done，2026-10-21）

- Current Objective（当前目标）: 把设置·外观从简单分段按钮 + 滑杆调整成设计稿风格：主题大卡片预览、字号分组、实时对话预览。已完成，未提交。
- 核心改动: `AppearanceSettingsTab` 新增 `ThemePreview` 迷你明暗预览；主题选择改为两张 `quickforge-appearance-theme-tile` 卡片（aria-pressed + 勾选圆点）；字号独立分组；新增“对话预览”卡片，头部用 `interfaceFontSizePx`、消息用 `messageFontSizePx` 实时渲染；`FontSizeSlider` 增加 `ariaLabel`。`index.css` 新增主题卡片/预览/分组说明/对话预览样式，移动端单列；i18n 补预览与字号文案。
- Files（改动文件）: `src/components/settings/tabs/AppearanceSettingsTab.tsx`、`src/index.css`、`src/lib/i18n.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 4 文件 30 passed；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Vite dev + Chrome CDP 1440×900 明暗主题与 390×844 移动端验证主题卡片选中、迷你预览、字号滑杆、实时对话预览，无 console error。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 如需继续统一设置页视觉，可把“模型与提供商”“智能体”等管理页也按同一套分组说明和卡片密度微调；发布前在空闲环境补跑全量 `npm run test`。未提交 Git；build 正常重生成 `dist/`。

---

## 当前交接：settings-grouped-navigation（done，2026-10-21）

- Current Objective（当前目标）: 设置页从 16 个平铺标签页改为 3 组导航（基础 / AI 与扩展 / 自动化与数据），关于置底，并合并数据与网络低频页。已完成，未提交。
- 核心改动: `settings-tabs.ts` 增加分组与搜索关键词；`SettingsWorkspacePage` 渲染分组桌面/移动导航、设置搜索、关于置底，新增 `data`/`network` 状态保留 tab。新增 `DataSettingsTab`（备份与恢复/已归档对话/分享链接子标签，活跃转发与状态保留）与 `NetworkSettingsTab`（局域网访问 + 网络代理）；`NetworkProxySettingsSection` 从 DefaultOptions 提取，DefaultOptions 移除代理并按基础/交互/上下文管理/终端分段。分享链接页新增 `embedded`/`active`；常规改名通用、自定义模型改名模型与提供商。
- Files（改动文件）: `src/lib/settings-tabs.ts`、`src/lib/react-settings-tabs.tsx`、`src/components/settings/SettingsWorkspacePage.tsx`、`src/components/settings/tabs/{DataSettingsTab,NetworkSettingsTab,NetworkProxySettingsSection,DefaultOptionsSettingsTab}.tsx`、`src/components/share/ShareLinksSettingsPage.tsx`、`src/lib/i18n.ts`、`src/index.css`、`tests/frontend/settings-workspace-react.test.ts`、`tests/frontend/default-options-settings-react.test.ts`、`tests/frontend/network-proxy-settings-react.test.ts`、README 与 docs/wiki 相关页、3 个状态文件。
- Evidence（验证）: 定向 vitest 3 文件 27 passed；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Vite dev + Chrome CDP 实机 1440×900 与 390×844 验证三组导航、搜索“代理/备份”、数据管理三子标签及状态保留、网络与设备、模型与提供商重命名，无 console error。全量 `npm run test` 仅既有 `tests/server/scheduled-tasks.commands.test.mjs` 随机 1 例失败，单文件 24 passed，判定为并行 SQLite 抖动；未跑串行全量。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 如需发布，先在空闲环境完整运行 `npm run test`；重点复测分享链接在“数据管理 → 分享链接”切走再回来仍保留子标签并刷新数据、网络代理在“网络与设备”重新激活时重新读取系统代理。未提交 Git；build 正常重生成 `dist/`，未手工修改生成产物。

---

## 当前交接：new-chat-project-row-branch（done，2026-10-21）

- Current Objective（当前目标）: 新建对话底部项目行去掉整条背景块、项目默认无底色；分支紧贴项目显示，并复用分支选择菜单切换/新建分支。已完成，未提交。
- 核心改动: `NewChatProjectPicker` 新增 `branch` 与 `branchMenu`，项目 chip 后渲染分支按钮；点击经 portal 复用 `GitBranchMenu`（fixed 定位到分支上方、按视口收敛宽高、外部点击/Escape 关闭、切换后关闭）；`App.tsx` 传入 `titleGitStatus` 分支与既有 checkout/create/graph/changes 入口；`index.css` 移除 trigger 背景/圆角，chip 默认背景 `transparent`（hover/focus 才显示），分支紧邻并带 hover/展开反馈。
- Files（改动文件）: `src/components/chat/NewChatProjectPicker.tsx`、`src/App.tsx`、`src/index.css`、`tests/frontend/new-chat-project-picker.test.ts`、`tests/frontend/new-chat-project-picker-branch-menu.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 3 文件 43 passed；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Chrome CDP 实机 1400×900 与 390×844：chip/trigger 背景 `rgba(0,0,0,0)`、分支紧邻项目约 9px，菜单含分支列表/未提交更改/新建分支/Git 图谱且不超出视口，Escape 关闭。未跑全量 `npm run test`；未实际执行分支切换，避免改动仓库分支。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端查看新建对话：项目无底色、右侧紧邻分支；点击分支确认可切换/新建（真实切换会改动仓库，按需验证）；非 Git 项目/全局新对话不显示分支。未提交 Git；build 正常重生成 `dist/`，未手工修改生成产物。

---

## 当前交接：composer-pasted-text-tile-radius（done，2026-10-21）

- Current Objective（当前目标）: 输入框粘贴大段文本生成的附件 tile 从圆形改为与消息区附件一致的中等圆角方形。已完成，未提交。
- 核心改动: `src/index.css` 在 `.quickforge-composer button` 全圆规则后新增 `.quickforge-composer .qf-attachment-tile button:not(.qf-attachment-tile-remove)` → `border-radius: 0.5rem !important`；`AttachmentTile.tsx` 的删除按钮补 `qf-attachment-tile-remove` 类，保持 999px 全圆。根因是 composer 图标按钮的全圆规则误伤了附件 tile 主体按钮。
- Files（改动文件）: `src/index.css`、`src/components/chat/surface/AttachmentTile.tsx`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 浏览器实机粘贴 3200 字符生成文本附件，计算样式 tile 圆角 7px（根字号 14px）、删除按钮 999px，截图为圆角方形；定向 vitest 3 文件 69 passed；eslint 通过；`npm run build` exit 0，产物 CSS 含新规则。未跑全量 `npm run test`。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 如需发布，运行完整 test/lint；未提交 Git；build 正常重生成 `dist/`，未手工修改生成产物。

---

## 当前交接：workflow-summary-single-line-marquee（done，2026-10-21）

- Current Objective（当前目标）: run_workflow 折叠头右侧的运行中摘要固定单行，溢出横向滚动，不再换行或重复显示。已完成，未提交。
- 核心改动: `src/index.css` 为 `.quickforge-workflow-marquee` 补齐单行容器与双视图样式（inline-flex / flex: 1 1 auto / min-width: 0 / 定高 1.125rem / overflow: hidden / nowrap / mono 0.75rem；view 绝对定位、static 省略号、moving 默认 display: none），复用现有 `ToolMarqueeController` 做溢出测量与横向滚动，reduced-motion 退化为省略号。`workflow-tool-renderer.tsx` 结构未动；内嵌工具行与 `run_subagent` 摘要行不变。
- Files（改动文件）: `src/index.css`、`tests/frontend/workflow-renderer.test.ts`、`docs/architecture/workflow-orchestration.zh-CN.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 3 文件 56 passed（workflow-renderer 14、workflow-step-interaction 5、chat-surface-css-contract 37）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；构建 CSS 静态复测：640px 列宽下摘要行 18px 单行，长文本溢出 205px 由控制器滚动，moving 视图默认隐藏、static 显示省略号。未跑全量 `npm run test`。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端后运行一次多 Agent/多工具的 workflow，确认折叠头保持单行、长步骤列表自动横向滚动、chevron/耗时不被遮挡；系统开启 reduced-motion 时确认静态省略号。未提交 Git；build 正常重生成 `dist/`，未手工修改生成产物。

---

## 当前交接：workflow-inner-tool-open-memory-isolation（done，2026-10-21）

- Current Objective（当前目标）: 修复 run_workflow 展开后内部工具行随外层卡开合记忆自动展开的问题，内层行保持默认收起。已完成，未提交。
- 核心改动: `src/lib/tool-renderers/shared.tsx` 的 `ToolDetails` 新增可选 `stateKey`（显式 key 优先于最近 `.qf-tool-message` 的 toolCall id，空字符串表示不记忆）；`src/lib/tool-renderers/workflow-tool-renderer.tsx` 的内层工具行传入 `workflow:${runId}:tool:${id}`，外层 `run_workflow` 卡保持原 key。此前内外层共用同一宿主 key，外层展开一次后内层行在流式刷新、新增步骤或重挂载时自动展开。
- Files（改动文件）: `src/lib/tool-renderers/shared.tsx`、`src/lib/tool-renderers/workflow-tool-renderer.tsx`、`tests/frontend/tool-renderer-shared-state.test.ts`、`tests/frontend/workflow-step-interaction.test.ts`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: `npm run test` 390 文件 4689 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；`npx tsc -b --pretty false` exit 0；定向 3 文件 36 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端，展开一次 `run_workflow` 确认内部工具行保持收起；运行中确认新增步骤不再自动展开；手动展开某个内部行后重挂载，确认该行状态保留且外层卡不受影响。未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：workflow-agent-live-detail-parity（done，2026-10-21）

- Current Objective（当前目标）: 让 workflow 里点击 Agent 打开的详情与直接 `run_subagent` 卡片体验一致——实时工具过程、统一状态/错误、点击取最新快照、终态 trace 完整、被裁时有提示。已完成，未提交。
- 核心改动: 新增 `src/lib/workflow-agent-run-events.ts`（run_workflow SSE → subagentRunStore，稳定 runId `${workflowRunId}:agent:${id}`）；`ServerAgent` 在 tool_execution_start/update/end 调用并在 dispose 清理；点击优先取 store，历史恢复才用渲染帧回填；`workflow-subagent-detail.ts` 复用 `subagentRunStatus`/`subagentRunError`，previous 回填 + `traceDropped`，并透传 task/context/expectedOutput；卡片直接调用 `renderSubagentRunSummary`（与 run_subagent 同一函数，只追加 meta/错误文案与历史回填 onOpen）；Composer “运行中 subagent”指示器在父 run_workflow pending 时按 `${toolCallId}:agent:` 前缀列出嵌套 Agent；服务端 details 预算 240K/500K、日志独立 50K、单 Agent 50 条/80KB（运行中）与 200 条/200KB（终态），toolCall/toolResult 配对裁剪、按 Agent 优先级缩减；详情页新增裁剪提示文案。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `workflow-agent-live-detail-parity` 条目（源码/测试 + 架构文档 + wiki + 3 个状态文件）。
- 评审补强（2026-10-21）: 6 个评审重点逐项核对通过；补三处缺口——① 总预算“部分缩容”原先静默替换长 trace：服务端新增 `subagentRunTruncated`，客户端保留最后一次可见的更长 trace 并提示“过程记录不完整”，终态装得下时恢复完整过程；② SSE 断连漏掉结束帧时 store 会停留 running：`WorkflowAgentRow` 用 `shouldPublishSubagentRunPayload` 在 effect/onOpen 安全回填（已有终态不覆盖），发布器 previous 改为优先取 store、再回落本地缓存；③ 日志预算收紧为至多 50 条且累计 ≤50K。新增 4 个回归用例。
- Evidence（验证）: `npm run test` 390 文件 4685 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；`npx tsc -b --pretty false` exit 0；定向 6 文件 172 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 重启服务后跑一次带工具调用的 workflow，点击 Agent 行确认详情实时刷新、工具卡与 run_subagent 一致、Composer 指示器出现嵌套 Agent；制造总预算超限确认出现“过程记录不完整”且工具卡不被缩没；断连/重连后确认详情能从 running 自动转终态。旧持久化结果不会回填。未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。未做浏览器实机验证。

---

## 当前交接：goal-v2-dsh-round-driver（done，2026-10-19）

- Current Objective（当前目标）: 完全对标 DSH 重写 Goal v2 round driver，删除所有 QuickForge legacy 阻塞逻辑。已完成，未提交。
- 核心改动: `server/goal/runner.mjs` 完全重写为 DSH round driver——删除规划阶段、证据门禁、no_progress/repeated_failures 检测、goalRunSettling 结算屏障。每轮都是执行轮（objective + round number）；正常结束→complete/blocked 停止/直接下一轮；错误 disarm；轮次上限 block round_limit。`server/goal/prompts.mjs` 的 round prompt 改为 DSH 式（不含 criteria/evidence）。`agent-prompt-commands.mjs` 的 `/goal` 创建后返回文本响应（不产生规划模型轮次）。`update_goal complete` 在执行轮内直接生效。
- Files: `server/goal/runner.mjs`、`server/goal/prompts.mjs`、`server/agent-prompt-commands.mjs`、`tests/server/goal-v2-manager.test.mjs`、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- Evidence（验证）: `npm run test` 389 文件 4672 passed / 2 skipped；`npm run lint` 0 error；`npm run build` exit 0。v2 manager 6 passed。
- Blockers: 无。
- Next Session: 1) 真实模型跑 `/goal` 验证 DSH 流（无规划轮、直接执行、update_goal complete 即完成）；2) 验证错误后 disarm→用户 resume 可继续；3) 验证轮次上限后 blocked `round_limit` 可 extend_resume。未提交 Git。

---

## 当前交接：workflow-subagent-trace-budget（done，2026-10-19）

- Current Objective（当前目标）: workflow 内 Subagent 详情与直接 `run_subagent` 一样能看到工具调用。已完成，未提交。
- 核心改动: `MAX_SUBAGENT_RUN_JSON` 6000 → 80000，`MAX_SUBAGENT_TRACE_MESSAGES` 40 → 50。压缩仍从最旧消息丢起，但一次正常 toolCall/toolResult/最终回复可以留下。
- Files（改动文件）: `server/agent-workflow-runner.mjs`、`tests/server/agent-workflow-runner.test.mjs`、`docs/wiki/server/README.md`、`docs/architecture/workflow-orchestration.zh-CN.md`、`progress.md`、`session-handoff.md`、`feature_list.json`。
- Evidence（验证）: 见本轮定向 vitest。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 重启服务后重跑一次带工具调用的 workflow，点进 Agent 详情确认工具卡。旧的已保存结果不会回填。

---

## 当前交接：latest-code-review（reviewed，2026-10-19）

- Current Objective（当前目标）: 只读评审最新代码。已完成，未改产品代码。
- 范围: 未提交的 workflow 内部行对齐与运行中 subagent trace；已提交的 Goal v2 与 `run_workflow`。
- 确认问题: `server/goal/tools.mjs` 的 `update_goal complete` 调 `service.complete(..., { by: 'user' })`，不检查 criteria/evidence。`server/goal/runner.mjs` 允许执行轮调用。`goal_report complete` 仍有证据与正常轮末/持久化门禁。`tests/server/goal-v2-manager.test.mjs` 把无证据完成当成通过。工具说明、`server/goal/prompts.mjs` 与 `docs/wiki/src/lib/README.md` 未标明这条旁路。
- 风险: `src/lib/tool-renderers/shared.tsx` 的 `ToolDetails` 只用最近 `.qf-tool-message` 的 toolCall id。workflow 内外两层 details 共用该 key，手动展开内部工具行会污染外层卡开合记忆。
- 风险: `server/agent-workflow-runner.mjs` `trimDetails` 先截断 agent 预览，之后才丢 `subagentRun`；大 trace 会先损失结果预览，截断 trace 仍占预算。
- Evidence（验证）: 定向 vitest 9 文件 exit 0；定向 eslint + `npx tsc -b --pretty false` exit 0。未跑全量 test/lint/build。
- Blockers（阻塞）: 无。是否收紧 `update_goal complete` 需要产品决定。
- Next Session（下一步）: 若要修，先决定执行轮完成是否必须绑定证据；再给 workflow 内层 details 单独记忆 key。

## 当前交接：workflow-inner-tool-parity（done，2026-10-19）

- Current Objective（当前目标）: workflow 内部工具行对齐外部普通工具卡，Agent 行对齐外部 sub-agent 卡。已完成，未提交。
- 核心改动: `WorkflowToolCallRow` 改用 `quickforge-local-tool`；`WorkflowAgentRow` 改用 `quickforge-subagent-tool` 整行打开详情。删除步骤 chevron、状态圆点、external-link 与展开体内的详情按钮。
- Files（改动文件）: `src/lib/tool-renderers/workflow-tool-renderer.tsx`、`src/index.css`、`tests/frontend/workflow-renderer.test.ts`、`tests/frontend/workflow-step-interaction.test.ts`、`docs/wiki/src/lib/README.md`、`progress.md`、`session-handoff.md`。
- Evidence（验证）: 定向 vitest 2 文件 14 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端，展开一次 `run_workflow`，确认工具行点击展开、Agent 行整行打开 Inspector、结果默认收起。未跑全量 test/lint/build。
- 后续：工作流结果块改为默认收起的 details。workflow Agent 详情改为运行中即有有界 trace，工具结果保留 details，显示模式跟随外部工具设置。需重启服务后验证。

---

## 当前交接：goal-tool-card-display（done，2026-10-19）

- Current Objective（当前目标）: 优化 `get_goal`、`create_goal`、`update_goal` 的聊天工具卡显示。已完成，未提交。
- 核心改动: 新增 `src/lib/goal-tool-history.ts`、`src/lib/tool-renderers/goal-tool-renderer.tsx`；注册三个工具；补中英 `goalTool*` 文案。卡片为无边框、默认收起的只读历史投影。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `goal-tool-card-display` 条目。
- Evidence（验证）: 定向 vitest 10 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 刷新前端后实际调用三个 Goal 工具，确认摘要、展开内容和详细模式 JSON；未跑全量 test/lint/build。

---

## 当前交接：goal-v2-event-sourced（done，2026-10-19）

- Current Objective（当前目标）: 按 DSH 的持久状态骨架完整实施 Goal v2，同时保留 QuickForge 的规划/证据/完成门禁；新目标默认 v2，旧会话保留 legacy。已完成，未提交。
- 核心改动: 新增 `server/goal/{state,store,service,errors,prompts,report-tool,tools,authority,runner,engine}.mjs`（4 phase + armed/disarmed + 事件日志 + 全量 CAS + Round Driver + goal_report/get_goal/create_goal/update_goal）。模型可从直接人类轮次自动创建/编辑/暂停/恢复 goal，goal 轮完成仍走 `goal_report` 证据，直接人类可用 `update_goal complete` 强制完成；`agent-manager` 为 v2 会话常驻注入 goal 控制工具并 `await beginGoalRun`；`agent-persistence` 持久化 `goalEvents`/`goalEngine`；restore 保留 v2 active+disarmed，旧快照 `migrateLegacyGoal` 转换。`/goal` 支持裸状态与 edit/pause/resume/clear；`goal-settings` 增加 `engine`（默认 v2）并提供设置页选择；`tests/setup-goal-engine.mjs` 让历史测试默认 legacy。
- 前端: `src/lib/goal.ts` v2 字段归一化/helpers；`goal-control-strip.ts` 显示 phase/轮次/目标第二行、“已中断”，complete 隐藏；`goal-card.ts`/Inspector/Summary 复用 v2 投影；i18n 中英 phase 文案；`index.css` v2 条带布局。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `goal-v2-event-sourced` 条目。
- Evidence（验证）: `npm run test` 388 文件 4672 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0。定向：v2 state/store/service 24 passed、v2 manager 6 passed、legacy goal 7 文件 211 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 1) 用真实模型/浏览器验收 v2：`/goal` 规划→自动执行→证据→complete、`/goal pause|resume|clear`、重启后 active+disarmed 显示“已中断”并手动继续；2) 检查设置页「Goal 引擎」切换与 legacy 回退；3) 把 `.tmp-vitest-shim.mjs` 删除或替换为正式测试运行方式（沙箱内 Vite 需要 `net use`/`.vite-temp` 写权限）；4) 后续可补 v2 的 failed/cancelled tombstone UI 标记与调度任务专项测试。未提交 Git。

---

## 当前交接：run-workflow-scripted-orchestration（done，2026-10-19）

- Current Objective（当前目标）: 按用户要求以 workflow 模式为 QuickForge 增加接近 DSH workflow 的脚本化多 Agent 编排（`run_workflow`），并完成测试、文档与全量验证。已完成，未提交。
- 核心改动: 新增 `server/agent-workflow-runner.mjs`（worker 生命周期、有界队列、总 deadline/父 abort、agent 失败降级 `null`、JSON Schema、details 裁剪与坏状态标记）与 `server/agent-workflow-worker.mjs`（worker_threads + vm guest bridge，hooks 全在 guest 内创建，host 对象不进入脚本，args/结果 JSON 序列化，resourceLimits/同步 10s/1MB 结果上限）。`agent-subagent-runner.mjs` 新增 `runWorkflowSubagent` 并抽取 `executeSubagentRun`，补 setup 期 abort 与审批 signal；`agent-manager.mjs`/`tools/definitions.mjs`/`approval-store.mjs`/`routes/tools.mjs`/`system-prompt.mjs` 完成工具定义、包装、审批、限制与引导接线。新增 `server/agent-workflow-tools.mjs` 提供 `tool()` 工具步骤：复用 `createServerTools` 的会话工具集/命令权限/workspace 沙箱与 `createApprovalPromise` 审批（source `workflow-tool`），排除递归/控制面工具并拒绝 `run_command run_in_background`；Agent 与工具共用有界步骤队列（`maxTools` 默认 64/上限 128）。前端新增 `src/lib/workflow-run-detail.ts`、`workflow-tool-renderer.tsx`，并接入 local-tools/index/shared 图标、i18n 32 键、CSS（每个 Agent/工具行独立 `<details>` 默认收起、点击展开任务/参数与结果；工具摘要横滑/结果代码块/控制台块/详细模式门控/running sweep/aria-busy/focus-visible/reduced-motion）、`process-folding` 排除 `run_workflow` 保持顶层可点击卡片、`src/lib/workflow-subagent-detail.ts` 把 Agent record 的 bounded `subagentRun` 转成 `SubagentRunPayload` 并派发 `OPEN_SUBAGENT_RUN_EVENT` 打开 Inspector Subagent 运行详情、approval-card、title-git-status-refresh。Runner 在 Agent 完成/失败时从最终 details / `quickforgeSubagentDetails` 提取最近 40 条消息、tools、allowedTools、model/thinkingLevel、pendingToolCalls（单 Agent≈6KB；超总量时 `subagentRunDropped`，仍可 summary 打开）。
- 关键契约: 默认权限下启动前展示**完整脚本**（脚本 ≤20KB）并审批一次，Agent 串行（`effectiveConcurrency=1`）以保证单槽位审批卡可见；完全访问才使用配置并发（默认 4 / 上限 8）。单步失败解析为 `null` 可继续；脚本异常/超时/父中止才整体失败，失败 details 经 `afterToolCall` 持久化。超时/中止/孤儿 Agent 在终态 details 中统一标记 `aborted`，不再残留 `running`。worker 提供隔离与可终止性，但不是 OS 沙箱，审批是信任边界。
- 文档: 新增 `docs/architecture/workflow-orchestration.zh-CN.md`；同步 `README.md`、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`。
- Files（改动文件）: 完整清单见 `feature_list.json` 的 `run-workflow-scripted-orchestration` 条目；新增/改动的核心文件、测试与文档均已列入。
- Evidence（验证）: 本 feature 定向 9 文件 174 passed（workflow runner 26、approval orchestrator 23、subagent 集成 18，含真实 `tool("read_file")`、`run_in_background` 拒绝、approval-store 16、definitions 22、workflow-renderer 13、approval-card 7、process-folding 48、workflow-step-interaction 1）；`npx tsc -b` 通过；`npm run lint` exit 0；`npm run build` exit 0；`npm run test` 全量 388 文件 4675 passed / 2 skipped（exit 0，含同工作区已收敛的 Goal v2 改动）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 当前运行中的服务仍是旧代码，重启后才会加载 `run_workflow` 与 `tool()`。建议真机验证：① 让模型用 `run_workflow` 跑一个 `explore` + `general` 的 fan-out，确认工具卡摘要、阶段/Agent/工具/日志/结果与脚本折叠块；点击 Agent 行右侧 external-link（或展开体内的「查看运行详情」按钮），确认 Inspector 打开该 Agent 的 Subagent 运行详情（trace/tools/task/result），且行内 details 不被切换；② 脚本里用 `tool("read_file")` 与 `tool("write_file")`，确认工具行图标/摘要/展开参数与结果、写文件审批卡显示 Workflow 徽标；③ 默认权限下拒绝一次审批，确认卡片显示“失败 + 错误正文”而不是“正在准备”；④ 观察默认权限步骤串行、审批卡不互相覆盖；⑤ 超时/停止后确认所有 Agent/工具状态为 aborted；⑥ 完全访问下验证并发。未提交 Git；`dist/` 由 build 正常重生成，未手工修改 `package-dist/`/`package-offline/`。

---

## 当前交接：dead-code-cleanup-round3（done，2026-10-16）

- Current Objective（当前目标）: 按死代码评审清理高置信度 A 区僵尸代码。已完成，未提交。
- 改动文件: `src/components/chat/panel-decoration/icons.ts`、`message-queue.ts`、`ChatSurface.tsx`、`settings/tabs/shared.tsx`、`src/index.css`、`src/lib/i18n.ts`、`docs/wiki/src/lib/README.md`、评审报告、feature_list/progress/session-handoff。
- 已清理: 3 个无引用导出、6 个 i18n 孤儿键的中英词条、capability-suggestions 专属 CSS/死查询项、已确认无消费者的 settings/context/project picker CSS。
- 保留: `readSessionIdentityRows` 动态 facade 接口、`quickforge-tool-message` CSS 契约规则、K8 安全预留、B 区测试专用导出、C 区导出冗余、D 区历史 spike。
- Evidence（验证）: 定向 vitest 6 文件 96 passed；`npx tsc --noEmit` 通过；`npm run lint` 通过（1 个既有 warning）；`npm run build` 通过；`git diff --check` 通过。
- Blockers（阻塞）: 无。工作区另有用户此前 channels-removal 等未提交改动，本次未覆盖或回滚。
- Next Session（下一步）: 用户若需要可继续处理 B 区前 3 项或全部灰色项；当前清理未提交。

---

## 当前交接：channels-removal（removed，2026-10-16）

- Current Objective（当前目标）: 应用户要求彻底移除设置中的「渠道」功能（微信 bridge、渠道 API/SSE、sessions-changed 事件链、channelId/channelName 字段），不影响其他功能。已完成移除，未提交。
- 改动文件: 删除 15 个专用文件（server/channels/**、server/routes/channels.mjs、src/components/settings/tabs/ChannelsSettingsTab.tsx、tests/server/channels/**、tests/server/routes/channels.test.mjs、tests/server/agent-manager.channel-*.test.mjs ×3、tests/server/acp/server-channel-source.test.mjs）；修改 server/index.mjs、server/routes/agent.mjs、server/agent-manager.mjs、server/agent-persistence.mjs、server/agent-session-queries.mjs、server/session-state-service.mjs、server/acp/server.mjs、server/agent-goal-runner.mjs、src/lib/settings-tabs.ts、src/lib/react-settings-tabs.tsx、src/components/settings/SettingsWorkspacePage.tsx、src/App.tsx、src/hooks/useSessionPagination.ts、src/hooks/useAgentManager.ts、src/lib/types.ts、src/lib/server-agent.ts、src/lib/server-agent-types.ts、src/lib/global-agent-sse-client.ts、src/components/sidebar/ChatSidebar.tsx、src/components/settings/tabs/ArchivedConversationsSettingsTab.tsx、src/lib/i18n.ts、src/index.css、11 个混合测试文件、6 个 docs/wiki 文档、feature_list.json、progress.md、session-handoff.md。完整清单见 progress.md「channels-removal」节。
- 保留（与渠道无关，勿回退）: ACP 全链（qf acp / server/acp / source:'acp'）；BroadcastChannel 跨标签同步（其 sessions-changed 为跨标签事件同名）；Electron IPC 通知通道 / Android NotificationChannel / npm-runtime 更新 channel；sessionTitle 函数本体（签名简化为单参数，仍被 9 处使用）；i18n stop 键（MessageEditor 在用，start/restart 已删）。
- 遗留数据说明: 旧渠道会话持久化 data/metadata 的 channelId/channelName 字段与 ~/.quickforge/logs/channels/ 日志目录成为无主数据（不再被读取），无害、无需迁移；存量微信渠道会话标题退化为纯标题（用户已确认）。
- Evidence（验证）: 全仓 grep 残留仅无关命中；源码/测试/Wiki/入口精确标识检查为 0；Android 正规 `npm run android:sync` 已重新生成资产并移除旧 `ChannelsSettingsTab` bundle（剩余 `channel-*.js` 为 Monaco 语言包）；npm run test 381 文件 4595 passed / 2 skipped；npm run lint exit 0（1 个既有无关 warning）；npm run build exit 0；npx tsc --noEmit 通过。
- 复审结论（2026-10-16）: 渠道功能已完全从当前源码、测试、Wiki、入口及 Android 当前生成资产清除。修正 `feature_list.json` 中两处已删除 `ChannelsSettingsTab.tsx` 的过期文件路径。发现的 `BroadcastChannel`、Electron IPC notification channel、npm-runtime update channel、messages channel 均为独立功能，确认保留。
- Blockers（阻塞）: 无。工作区另有既存未跟踪临时文件 `0`、`m[1])`、`new`、`{try{require.resolve('jsdom')` 及 dead-code audit 报告，未纳入本 feature，未修改。
- Next Session（下一步）: 待用户决定提交时机；运行中的服务是旧代码，重启后设置页不再出现「渠道」Tab，/api/channels 返回 404（预期）。若将来要恢复渠道，可在 git 历史找回本次删除前的实现。

---

## 当前交接：dead-code-audit-round3（评审完成，未清理，2026-10-16）

- Current Objective（当前目标）: 全面评审僵尸代码（无引用代码/不可达分支）。评审已完成并沉淀报告，未改任何产品代码。
- Files（改动文件）: docs/reports/dead-code-candidates-2026-10-16.zh-CN.md（新增，已于 2026-10-22 文档清理时删除）、progress.md、session-handoff.md。
- Evidence（验证）: 三路独立扫描交叉验证 + grep 抽检复核；结论：0 僵尸文件 / 0 不可达分支 / 0 死 env 门控 / 0 context-eviction 残留 / 协议无孤儿；僵尸清单见报告 A/B/C/D 四区。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 待用户选定清理范围（仅 A 区 / A+B 前 3 项 / A+B 全部 / 暂不清理）；执行时行号以实际内容为准，需同步直测（B 区）与 wiki 文档。

---

## 当前交接：prefer-background-commands（done，2026-10-15）

- Current Objective（当前目标）: 基础系统提示词改为命令在可行时优先后台运行。已完成，未提交。
- 改动文件: server/system-prompt.mjs、tests/server/system-prompt.test.mjs、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: `npx vitest run tests/server/system-prompt.test.mjs` 8 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 无。

---

## 当前交接：agent-context-eviction-removal（removed，2026-10-14）

- Current Objective（当前目标）: 应用户要求彻底移除「上下文主动遗忘（context eviction）」特性（实现不理想：重复裁剪等）。已完成移除，未提交。
- 改动文件: 删除 7 个文件（server/context-eviction.mjs、src/lib/context-eviction-settings.ts、src/components/chat/surface/ContextEvictedBadge.tsx、src/lib/tool-renderers/context-eviction-tool-renderer.tsx、tests/server/context-eviction.test.mjs、tests/frontend/context-eviction-renderer.test.ts、docs/architecture/context-eviction-design.zh-CN.svg）；修改 server/agent-manager.mjs、auto-compaction.mjs、agent-persistence.mjs、agent-session-queries.mjs、tools/definitions.mjs、routes/tools.mjs、src/components/chat/surface/{surface-context.ts,ChatSurface.tsx,ToolMessage.tsx,AssistantMessage.tsx}、src/components/settings/tabs/DefaultOptionsSettingsTab.tsx、src/lib/{server-agent-types.ts,server-agent.ts,local-tools.ts,i18n.ts}、src/lib/tool-renderers/{index.ts,shared.tsx}、tests/frontend/{default-options-settings-react, default-options-settings-tab}.test.ts、docs/wiki/{server/README.md, server/routes/README.md, src/components/README.md, src/lib/README.md}、feature_list.json、progress.md、session-handoff.md。完整清单见 progress.md「agent-context-eviction-removal」节。
- 保留（与 eviction 无关，勿回退）: 767565c 夹带的最终回复可见性修复——process-folding.ts、thinking-final-reply-visibility.test.ts、process-folding-final-reply.test.ts、server-agent-final-answer-recovery.test.ts、agent-session-events.mjs 的 deliveredMessageCount/sse-frame 日志、global-agent-sse-client.ts 的 [sse-rx] 日志、server-agent.test.ts 的 mergeIncrementalMessages 断言、agent-session-events.test.mjs 的 split final-answer delivery 用例；auto-compaction 逻辑（maybeAutoCompactSession、压缩摘要、用量估算）仅去掉裁剪口径、行为不变。
- Evidence（验证）: 全仓 grep 零残留（源码/测试；feature_list/progress/session-handoff 历史条目允许保留）；npm run test 全量通过；npm run lint 通过；npm run build 通过（实测摘要见各自运行输出）。
- 遗留数据说明: 旧会话 JSON 的 contextEviction 字段与 settings.json 的 'context-eviction-settings' 键成为无主数据（不再被读取），无害、无需迁移。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 待用户决定提交时机；若后续想恢复类似能力，可在 git 历史中找回 767565c～本次移除前的实现。

---

## 当前交接：fix-process-folding-source-empty（done，2026-10-13）

- Current Objective（当前目标）: 修复「工具调用→思考→最终回复时最终回复被隐藏（刷新才恢复）」。已修复，用户真机确认（硬刷新后复现场景正常）。
- 根因/修复: `decorateProcessTurn` 流式期间为 thinking-only 行打 `quickforge-process-source-empty`（CSS 隐藏整行，当时正确）；正文后到时 agent_end 装饰走 skip 短路（终答指纹排除后匹配 thinking-only 态），三条提前 return 路径（skip/update/空 nodes）全部跳过 `updateEmptyProcessSources` → empty 残留 → 整行连同正文被隐藏。修复：三处提前 return 前补 `updateEmptyProcessSources(assistants)`（process-folding.ts）。取证链：[sse-frame]/[sse-rx] 两端帧流水日志（已保留，agent-session-events.mjs + global-agent-sse-client.ts，可按需移除）+ 用户 DOM console 输出定位 source-empty class。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-final-reply.test.ts、server/agent-session-events.mjs（取证日志）、src/lib/global-agent-sse-client.ts（取证日志）、tests/frontend/server-agent.test.ts（过时同 id 断言修正）。
- Evidence（验证）: 折叠层 4 文件 79/79 passed（含用户精确复现场景 4）；mutation 验证（回退即红/恢复即绿）；eslint + npm run build 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 待用户决定提交时机；取证日志（[sse-frame]/[sse-rx]）可在稳定后移除；feature_list.json 未单列此修复条目（记录于 progress.md 本节）。

---

## 当前交接：agent-context-eviction（done，2026-10-13）

- Current Objective（当前目标）: 设置门控的 Agent 主动遗忘上下文（feature 1+2+去轮次豁免：工具族 + 占位符投影 + 每请求占比通知 + 前端已裁剪标记 + 完全自主遗忘）。已实现并在本人会话完成真实 E2E，未提交。
- 改动内容: `server/context-eviction.mjs`（设置仅 enabled 单开关、账本、规则求值（olderThanTurns 纯过滤参数 0/缺省=不限轮龄、无服务端豁免）、占位符投影、buildContextUsageNotice 每请求恒注入占比通知（只有一行占比，无计数/清单/指引，条数与清单由 agent 自行调 context_report）、handleContextForget|Recall|Report）；`server/auto-compaction.mjs` sessionProjectionMessages 共用投影；`server/agent-manager.mjs`（transformSessionContext 投影链、三工具注册、免审批、refreshContextEvictionState、session 字段）；`server/agent-session-queries.mjs` 快照带账本；`server/agent-persistence.mjs` 账本持久化；`server/tools/definitions.mjs` + `server/routes/tools.mjs`。前端：`src/lib/context-eviction-settings.ts`（仅 enabled）+ `server-agent-types.ts`/`server-agent.ts`（contextEviction state+事件）+ DefaultOptionsSettingsTab 单开关 + i18n 中英。迭代⑤（工具卡显示优化）：三工具专属 icon（`tool-renderers/shared.tsx` renderToolIcon：剪刀/回退箭头/柱状图）+ `ContextEvictionToolRenderer` 折叠卡（计数摘要：已裁 {count} 条·释放 ~{tokens} tokens / 已召回 {count} 条 / 报告·{percent}%·已裁 {count} 条 + 斜体 reason（params，悬停全文）+ running/error 状态 + detailed JSON；`local-tools.ts` 注册；i18n 6 键中英）；徽标升级为共享 `ContextEvictedBadge`（剪刀+斜体 reason 截断+title 全文），surface context 由 Set 改 Map（id→entry 含 reason/kind），ChatSurface 快照 evictedEntries（新增 sameMapItems 保 identity-stable）。迭代⑥（修复重复遗忘 + 工具卡下拉详情）：`resolveForgetTargets` 接收账本 id 集——已入账 id 拆入 alreadyForgotten（数量+alreadyForgottenNow 清单）单独上报，forgotten/tokensFreed 只计本次新裁（content 区分全部已裁剪过/规则无匹配/混合 no-change）；forgottenNow 逐项带 { id, kind, toolName, tokens }、recall details 增 recalledItems；ContextEvictionToolRenderer 摘要区分三种 0 语义、展开体默认恒有明细区（forget 逐条 #短id·工具名·~tokens / recall 逐条 / report 完整文本）；i18n 中英 +7 键；工具描述补重复调用安全说明。迭代⑦（止住 forget 空转循环，2026-10-13）：buildContextUsageNotice 改状态感知——增账本计数行（已裁 N 条/剩余可裁 M 条，仅计数无清单）、候选 0 时明确「skip context_forget until new tool results or replies accumulate」替换 frees space 指引、details 增 forgottenCount/forgettableCandidates；context_forget「全部已裁剪过」文案附止步说明；根因为无状态通知每轮催促模型空转（投影链无 bug，裁剪后上下文确实每轮发出）。迭代⑧（通知减负，2026-10-13）：`buildContextUsageNotice` 收敛为 `({ settings, usage })`——去掉 session / loopMessages 与 forgettableCandidates 统计，通知只剩占比行（删账本计数行与两条分支指引句），details 只含 percent/inputTokens/contextWindow；`server/agent-manager.mjs` 调用点同步新签名与注释；`tests/server/context-eviction.test.mjs` 通知契约重写（只报占比行 + 负向断言）；`docs/wiki/server/README.md` 与 `docs/architecture/context-eviction-design.zh-CN.svg` 同步为「只有占比行：无计数、无清单、无工具指引」，⑥ 改为「残留：仅模型自发重复调用场景」。
- Files（改动文件）: 见 feature_list.json agent-context-eviction 条目。
- Evidence（验证）: context-eviction 29 passed（含 olderThanTurns 0 与仅保护对象用例）；真实 E2E 闭环（report→forget 357+339→recall→re-forget，占比 59.7%→28.8%）；tests/server 全量 1919 passed / 2 skipped / 1 failed（并行工作）；eslint 通过；build 仅挂并行工作的 server-agent.ts:1483。迭代⑦：context-eviction 32 passed。迭代⑧：`npx vitest run tests/server/context-eviction.test.mjs` 30 passed（通知只报占比行、details 只含 percent/inputTokens/contextWindow）；`npx eslint server/context-eviction.mjs server/agent-manager.mjs` 0 error 0 warning；grep 无残留计数行/清单指引文案（forgottenCount 仅存于 context_report details）；SVG XML 校验通过。
- Blockers（阻塞）: 无（本 feature 范围）。
- Next Session（下一步）: 并行会话坏点演进：server-agent.ts:1483 类型错误已由其自行修复、build 通过；当前残留 tests/frontend/server-agent.test.ts「merges incremental message tails positionally」失败（mergeIncrementalMessages id 相同时应保留旧消息，实现却新覆盖旧；测试注释「Message-id equality wins over content comparison」给出修复方向）——非本 feature 代码，待其作者收敛。本 feature：重启服务后真机验证工具卡显示（icon + 计数摘要 + 斜体 reason）与被裁消息徽标（剪刀 + reason）；迭代⑥追加验证项——重复调用同一 forget 规则时卡片摘要应显示「N 条均已裁剪过」而非「已裁剪 0 条」，混合场景显示新裁数 + 「另 M 条已裁剪过」，工具卡展开即见逐条明细（#短id · 工具名/早期回复 · ~tokens）、report 卡展开可见完整报告文本；迭代⑦追加验证项——重启后通知应为新格式（含「Forgotten ledger: N … M forgettable item(s) remaining.」计数行），已裁完的会话里模型不再每轮空转调 context_forget、不再重复出现「均已裁剪过」工具卡；迭代⑧替换该项——重启后通知只应有一行占比（无计数行 / 无清单 / 无 context_report·context_forget 指引），观察模型是否自行调 context_report 取条数与清单；待用户决定提交时机。

---

## 当前交接：split-final-answer-end-frame-gap（done，2026-10-13）

- Current Objective（当前目标）: 结束帧空尾部不再丢掉最终总结。已实现，未提交。
- 方案：缺投递游标时从 0 取尾部；事件只转换一次。客户端在 count 缺口或最后一条原地替换时强制回读。
- Files（改动文件）: server/agent-session-events.mjs、src/lib/server-agent.ts、tests/server/agent-session-events.test.mjs、tests/frontend/server-agent-final-answer-recovery.test.ts、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 相关测试 73 passed；eslint 通过。
- Blockers（阻塞）: 当前运行中的服务仍是旧代码，需重启后再测。
- Next Session（下一步）: 重启后跑一条带工具的长回复，确认结束后总结立即出现，刷新结果一致。

---

## 当前交接：split-final-answer-delivery-cursor（done，2026-10-13）

- Current Objective（当前目标）: 持久化抢先提交时，结束帧仍携带最终总结。已实现，未提交。
- 方案：`deliveredMessageCount` 与 `persistedMessageCount` 分离；结束帧取两者较小值作为未投递起点。
- Files（改动文件）: server/agent-session-events.mjs、server/agent-manager.mjs、tests/server/agent-session-events.test.mjs、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 相关服务端测试 109 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑长工具回合，确认结束后最终总结立即出现；刷新结果一致。

---

## 当前交接：release-v2.2.5（done，2026-10-13）

- Current Objective（当前目标）: 发布 v2.2.5。Git commit/tag/push 已完成，npm publish 待用户执行。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: test 4606 passed / 2 skipped；lint exit 0（既有 warning）；build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.5.tgz（7.7MB / 549 files / shasum f6b0741484ec62d3fccdb86d69d395370d28cf17）。
- Blockers（阻塞）: npm 发布未执行。
- Next Session（下一步）: 用户执行 `cd package-offline && npm publish --access public`，再用 `npm view @shawnstack/quickforge version` 验证。

---

## 当前交接：late-final-answer-process-fold（done，2026-10-13）

- Current Objective（当前目标）: 不断连时，最终答案不再被收进已折叠过程组。已实现，未提交。
- 方案：终答标记仅在它仍是最后一段正文时有效；否则清标记，并在终答缺失或仍位于过程组内时强制重装饰。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: process-folding 相关 4 个测试文件 80 passed；eslint 改动文件通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条带思考或工具、最终正文较晚出现的回复，确认正文在组外可见且无需刷新；展开状态与工具折叠动画无回归。

---

## 当前交接：tool-file-summary-span-click-preview（done，2026-10-10）

- Current Objective（当前目标）: 恢复「点击工具卡文件名即预览」，不违反「summary 内禁嵌交互元素」规范，并按用户要求去掉 write/edit/read 右侧眼睛按钮。已实现，已提交。
- 方案：规范禁的是 summary 内嵌**交互控件**（button/a 等）；文件名保持静态 span（无 role/tabindex）仅挂 click（复用 previewArtifactClickHandler，阻断折叠后派发 PREVIEW_ARTIFACT_EVENT），带 cursor-pointer + hover:underline 暗示；renderPreviewButton 收窄回仅 present_files，write/edit/read 文件名点击即唯一预览入口。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/lib/tool-renderers/local-workspace-tool-renderer.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: tool-renderer-file-icon 12 passed；连带 local-tool-running-sweep + tool-renderer-shared-state 35 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机打开含文件读写工具行的会话，点文件名直接预览且工具卡不折叠、hover 出下划线、右侧无眼睛按钮；DevTools Issues 确认无「Interactive element inside of a `<summary>` element」警告回归。取舍备忘：write/edit/read 预览入口无键盘路径（span 不进 tab 序列）。

---

## 当前交接：summary-interactive-content-a11y（done，2026-10-10）

- Current Objective（当前目标）: 消除 18 个「summary 内嵌交互元素」a11y 警告。已实现，未提交。
- 改动内容: renderToolFileSummary（write/edit/read 摘要文件名）统一静态 span；renderPreviewButton 扩展四类工具，预览入口统一为 summary 右侧动作区眼睛按钮（键盘可达）。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/lib/tool-renderers/local-workspace-tool-renderer.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: tool-renderer-file-icon 12 passed；连带 3 文件 47 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机打开含文件读写工具行的会话，DevTools Issues 确认警告消失；预览改用文件行右侧眼睛按钮，点文件名只展开/收起工具卡。

---

## 当前交接：resize-observer-noise-filter（done，2026-10-10）

- Current Objective（当前目标）: 控制台不再被 ResizeObserver loop 噪音刷屏，index.html 无废弃 meta 警告。已实现，未提交。
- 改动内容: 新增 `src/lib/error-noise.ts`（isResizeObserverLoopError）；`main.tsx` 全局 error/unhandledrejection 入口命中降级 logger.debug（quickforge_debug=1 可见）；`index.html` 补 mobile-web-app-capable meta（保留 apple 版）。
- Files（改动文件）: src/lib/error-noise.ts、src/main.tsx、index.html、tests/frontend/error-noise.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest error-noise 9 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机打开 DevTools 确认控制台不再出现 ResizeObserver loop 的 [ERROR] 行（如需查看可设 localStorage quickforge_debug=1 后看 debug 行）；`[Intervention] Images loaded lazily` 为浏览器优化提示，非错误，维持现状。

---

## 当前交接：release-v2.2.3（done，2026-10-10）

- Current Objective（当前目标）: 发布 v2.2.3 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 改动内容: 版本 2.2.3（package.json / package-lock.json）；CHANGELOG.md 新增 [2.2.3] 节（state 帧拉尾合入后补发 UI 通知 + 跨页续拉 + 回滚重拉重试）；README.md 版本文案 2.2.3。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: npm run test 387 文件 4596 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 warning）；npm run build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.3.tgz（7.7MB / 549 files / shasum c44eaa6e6ef711723083ed3d0962264cc73952aa）。
- Git: `5df3037 fix(chat): state 帧拉尾合入后补发 UI 通知，最终答案不再需刷新` + `chore(release): v2.2.3` + tag `v2.2.3`，已 push origin dev v2.2.3。
- Blockers（阻塞）: npm 未登录（whoami 401），publish 待用户 `npm login` 后执行 `cd package-offline && npm publish --access public`。
- Next Session（下一步）: 用户 publish 后 `npm view @shawnstack/quickforge version` 验证；真机验证长任务跨网络抖动后最终回答自动补回且无需刷新；确认处置工作区未跟踪的 new（0 字节，两次发布遗留）。

---

## 当前交接：state-frame-tail-merge-notify（done，2026-10-10）

- Current Objective（当前目标）: 修复用户在最新代码上仍复现的「最终答案偶发不可见、刷新才显示」。已实现，未提交。
- 根因: state 帧恢复路径时序倒挂——agent_end 在拉尾前同步发出（UI 读旧列表），reconcile 合入最终回答后 finish() 仅在 markers 存在时广播（无 goal 会话零通知），ChatSurface 再无事件驱动重渲染。4c653cd 只修了拉尾失败，未修「拉回后 UI 不知道」。
- 改动内容: `server-agent.ts` reconcileMessagesFromSummary——finish() 去掉 markers 前置（stateVersion 前进即广播 message_metadata_updated，marker replay 改写时先广播不双发）；hasMore 跨页整体重跑续拉（每页重置重试预算）；fetchAllMessagesFromServer 失败显式 null 与真空 [] 区分（失败进退避重试、真空替换本地；模块级 fetchAllSessionMessages 语义不变）。
- Files（改动文件）: src/lib/server-agent.ts、tests/frontend/server-agent-final-answer-recovery.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest final-answer-recovery 6 passed（新增 3 用例，主用例红灯验证：还原旧条件后仅收到 ['agent_end']）；连带 server-agent/events/http 166 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机验证长任务跨网络抖动后最终回答自动补回且无需刷新；随下次 patch 版本发布（v2.2.2 的 npm publish 仍挂起）。

---

## 当前交接：release-v2.2.2（done，2026-10-10）

- Current Objective（当前目标）: 发布 v2.2.2 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 改动内容: 版本 2.2.2（package.json / package-lock.json）；CHANGELOG.md 新增 [2.2.2] 节（run_command description 优先 + SSE 断连拉尾重试）；README.md 版本文案 2.2.2。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: npm run test 387 文件 4593 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 warning）；npm run build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.2.tgz（7.7MB / 549 files / shasum 336abea4bf25ee643e39fe5fc76d8dc0d4ad56b7）。
- Git: `b2cbe4d chore(release): v2.2.2` + tag `v2.2.2`，已 push origin dev v2.2.2（无历史 tag 误推）。
- Blockers（阻塞）: npm 未登录（whoami 401），publish 待用户 `npm login` 后执行 `cd package-offline && npm publish --access public`。
- Next Session（下一步）: 用户 publish 后 `npm view @shawnstack/quickforge version` 验证；确认处置工作区未跟踪的 new（0 字节）与 learning/（测试运行后出现，来源不明）。

---

## 当前交接：transformer-learning-project（done，2026-10-10）

- Current Objective（当前目标）: 创建 Transformer 学习项目并按用户要求迁出仓库。已完成，未提交。
- 内容: 7 章笔记 + 6 个纯 NumPy 示例 + 架构 SVG + README，最终位置 `D:\transformer-learning`（含重建的 .venv，Python 3.10.8 + numpy 2.2.6）；已通过 `POST /api/project/path` 注册为 qf 项目（id f2cde6ee-1a05-41ea-9af0-f7b17e8e40a7，注册时设为 active）。quickforge 仓库内 `learning/` 已删除，.gitignore 回滚。
- Files（改动文件）: .gitignore（净零变化）、progress.md、session-handoff.md；项目本体在 D:\transformer-learning（仓库外）。
- Evidence（验证）: 迁移后抽验：示例 01 运行通过、05 `--check-only` 梯度检查通过；qf /api/project 列表含 transformer-learning 且 workspaceRoot 已切换。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 无需跟进；qf 当前 active 项目变为 transformer-learning，用户如需回 quickforge 项目在 UI 项目列表切换即可。

---

## 当前交接：transformer-learning-project-initial（superseded，2026-10-10）

- 原 learning/transformer 创建记录见 progress.md「transformer-learning-project」条目；同会话已整体迁出至 D:\transformer-learning，本条仅存档。

---

## 当前交接：sse-reconnect-final-answer-recovery（done，2026-10-10）

- Current Objective（当前目标）: 修复「长任务 final answer 偶发看不见、刷新才看到」。已实现，未提交。
- 根因: SSE 断连窗口吞掉收尾帧（message_end/agent_end）后，重连 state 帧（split 会话只有 messagesSummary.count）内联合成 agent_end 并触发 /messages 拉尾；拉尾瞬时失败被 `if (!isCurrent() || !page) return` 静默放弃（无重试、watchdog 已停）→ 最终回答永久停留在服务端，刷新才恢复。state 帧 isStreaming=false 分支还残留 streamingMessage。
- 改动内容: `server-agent.ts` reconcileMessagesFromSummary 拉尾失败按 1s→16s 共 5 次退避整体重跑（版本守卫/追平空转/成功清理/耗尽放弃/dispose 清理）；case 'state' isStreaming=false 分支补清 streamingMessage 与三类 pending。新增回归 tests/frontend/server-agent-final-answer-recovery.test.ts。
- Files（改动文件）: src/lib/server-agent.ts、tests/frontend/server-agent-final-answer-recovery.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest final-answer-recovery 3 passed；server-agent + server-agent-events + server-agent-http 连带 160 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机验证长任务跨网络抖动（如断 Wi-Fi 数秒）后最终回答能在 ~31s 内自动补回；如仍遇到，查 global-agent-sse-client 10 次重连上限与后端不可达场景。

---

## 当前交接：run-command-description-first（done，2026-10-08）

- Current Objective（当前目标）: run_command 带 description 时，对话工具行摘要与子任务跑马灯优先显示 Description。已实现，未提交。
- 改动内容: `summarizeParams` run_command 分支优先返回非空 description（空白折叠）、空缺回退 command；`local-workspace-tool-renderer.tsx` 摘要 title 在描述与命令并存时为「描述\n命令」。子任务跑马灯复用同函数自动生效。
- Files（改动文件）: src/lib/tool-param-summary.ts、src/lib/tool-renderers/local-workspace-tool-renderer.tsx、tests/frontend/tool-param-summary.test.ts、tests/frontend/subagent-run-detail.test.ts、tests/frontend/local-tool-running-sweep.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 3 文件 129 passed；eslint 改动文件通过；npm run build 通过（tsc -b 首轮 title 类型错误已修复，externalized/大 chunk warning 为既有）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认带 description 的命令工具行显示描述、悬停可见命令；无 description 的命令仍显示命令本身。

---

## 当前交接：release-v2.2.1（done，2026-09-30）

- Current Objective（当前目标）: 发布 v2.2.1 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 改动内容: 版本 2.2.1（package.json / package-lock.json）；CHANGELOG.md 新增 [2.2.1] 节；README.md 版本文案。门禁修复：process-folding.ts 的 isProcessToolsGroupMember 补 `running !== false`（运行中后台命令不折叠、退出终态折回过程组）；subagent-running-indicator.test.ts 后台命令断言改为独立触发器 `.quickforge-background-command-trigger` + innerHTML badge 断言。
- Files（改动文件）: package.json、package-lock.json、CHANGELOG.md、README.md、src/components/chat/panel-decoration/process-folding.ts、tests/frontend/subagent-running-indicator.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: npm run test 386 文件 4586 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 warning）；npm run build exit 0。tarball：package-offline/shawnstack-quickforge-2.2.1.tgz（7.7MB / 549 files）。
- Git: `68fa8621`（fix）+ `cf7c27b4 chore(release): v2.2.1` + tag `v2.2.1`，已 push origin dev。
- Blockers（阻塞）: npm 未登录（whoami 401），publish 待用户 `npm login` 后执行 `cd package-offline && npm publish --access public`。
- Next Session（下一步）: 用户执行 npm publish 后可用 `npm view @shawnstack/quickforge version` 验证；真机回归后台命令退出后折回过程组的显示。

---

## 当前交接：local-path-link-trailing-text（done，2026-09-29）

- Current Objective（当前目标）: 对话路径显示不再把文件地址后紧贴的文字吞进链接。已实现，未提交。
- 根因: 绝对路径分支尾部字符类 `[^\s"'<>\`]+` 吞 CJK 正文（含中文标点）；末尾剥标点救不回中间文字。
- 改动内容: `local-file-path-links.ts` 新增 `resolveLocalFilePathCandidate` 终点解析（剥标点 → 无 CJK / 扩展名结尾直接接受 → CJK 截断到扩展名 → 无效则放弃链接）；相对路径分支扩展名尾部负向前瞻防超 8 位英文粘连截半。测试新增 8 用例并完成红灯验证。
- Files（改动文件）: src/components/chat/panel-decoration/local-file-path-links.ts、tests/frontend/local-file-path-links.test.ts、docs/wiki/src/components/README.md（两份副本）、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest local-file-path-links 17 passed；decorator-copy-i18n + message-actions 连带 69 passed；eslint 改动文件通过；tsc --noEmit 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机发一条「已修改 D:\quickforge\src\index.css后面还有文字」类消息，确认链接只覆盖路径、正文完整显示；含中文目录的路径（D:\文档\说明.md）仍可点击。

---

## 当前交接：background-command-idle-keepalive（done，2026-09-29）

- Current Objective（当前目标）: 后台命令不再因会话空闲 10 分钟回收被连带终止。已实现，未提交。
- 根因: `resetIdleTimer` 到点 `destroyAgent` → `stopBackgroundCommandTasksForSession` 杀掉该会话全部运行中后台命令；SSE keep-alive 故意不重置计时器、后台命令运行中不保活。
- 改动内容: `server/agent-manager.mjs` `resetIdleTimer` 回调新增豁免——仍有运行中后台命令（`listBackgroundCommandTasks` 非空）时只重置计时器（与 goal waiter 同型）；命令退出后经通知路径重置计时器再按常规回收。新增回归测试 `tests/server/agent-manager.background-idle.test.mjs`（含无后台命令对照组仍回收、显式销毁仍终止命令）。
- Files（改动文件）: server/agent-manager.mjs、tests/server/agent-manager.background-idle.test.mjs、docs/wiki/server/README.md、docs/wiki/server/tools/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest agent-manager.background-idle 2 passed；tests/server 全量 174 文件 passed；npx eslint 改动文件通过；npm run build 通过（chunk 警告既有）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条长后台命令（如 dev server）静置 15 分钟以上，确认进程仍在、退出时收到 task-notification；如需“用户停止 run 不杀后台命令”，再评估移除 detach 后的 run signal abort 监听（当前保持既有行为）。

---


## 当前交接：chat-h5-no-horizontal-scrollbar（done，2026-09-28）

- Current Objective（当前目标）: H5 聊天消息区不再出现底部横向滑动条，宽 KaTeX 公式块内横滑。已实现，未提交。
- 根因: 主滚动容器 overflow-y-auto 的另一轴按规范被计算为 auto；KaTeX 展示公式容器（裸 my-4 div）无溢出保护，宽公式撑破消息列。
- 改动内容: .qf-chat-panel > .qf-scroll-container 加 overflow-x:hidden（主滚动容器只管纵向）；KatexMath display 分支挂 quickforge-katex-scroll（unlayered：overflow-x auto + 隐藏滚动条 + touch 滑动）；chat-math 测试 3 处容器类名断言同步；css-contract 测试新增滚动契约用例。
- Files（改动文件）: src/index.css、src/components/chat/surface/KatexMath.tsx、tests/frontend/chat-surface-css-contract.test.ts、tests/frontend/chat-math.test.ts、docs/wiki/src/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 47 passed；npm run lint 通过（仅既有无关 warning）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机 H5 发一条宽公式（长积分/求和）与长表格消息，确认底部无横向滑动条、公式块可滑、纵向滚动正常。

---

## 当前交接：tool-summary-no-ellipsis（done，2026-09-28）

- Current Objective（当前目标）: 工具长摘要不再省略，超长可横滑，并完成 build。
- 改动内容: 去掉命令、生图、文件列表和子任务摘要的硬截断。工具行与子任务行改为完整文本横向滚动，H5 可触摸滑动。
- Files（改动文件）: src/lib/tool-param-summary.ts、src/lib/subagent-run-detail.ts、工具渲染器、src/index.css、相关测试、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 213 passed；npm run build 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看长命令、长搜索、长生图提示词和子任务行，确认没有省略号且能滑到末尾。

---

## 当前交接：run-command-summary-no-ellipsis（done，2026-09-28）

- Current Objective（当前目标）: run_command 摘要不再出现省略号，长命令可横向滚完。已实现，未提交。
- 根因: 摘要硬截 72 字加 …，父级 overflow:hidden 继续裁切。
- 改动内容: 摘要输出完整命令。超长时整行横向滚动，H5 可触摸滑动，滚动条隐藏。
- Files（改动文件）: src/lib/tool-renderers/local-workspace-tool-renderer.tsx、src/index.css、tests/frontend/chat-surface-css-contract.test.ts、tests/frontend/local-tool-running-sweep.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：chat-surface-css-contract + local-tool-running-sweep 42 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看一条超长 run_command，确认没有省略号，可横滑到命令末尾。

---

## 当前交接：edit-diff-long-line-scroll（done，2026-09-28）

- Current Objective（当前目标）: edit_file 长行在 diff 内滚动，不撑开对话，H5 可滑。已实现，未提交。
- 改动内容: diff 块限制在列宽内。长行横向滚动且增删背景铺满整行，行号列保持可见。H5 使用 touch 横滑和纵滑。
- Files（改动文件）: src/index.css、tests/frontend/diff-view.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：diff-view + chat-surface-css-contract 60 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机展开一条长 edit_file，确认可横滑，行底色不中断，手机上也能滑。

---

## 当前交接：tool-command-console-scroll（done，2026-09-28）

- Current Objective（当前目标）: run_command 长命令可在工具卡内滚动，且未溢出的文字不再被遮成空白。已实现，未提交。
- 根因: 控制台左右渐隐始终生效，短行两端也被虚化。
- 改动内容: 溢出侧改内阴影，不用 mask。H5 可触摸横滑和纵滑。未超出不提示；滚到中间两侧提示；滚到末尾只提示左侧。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、src/index.css、tests/frontend/tool-renderer-shared-state.test.ts、tests/frontend/chat-surface-css-contract.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：52 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机展开一条长 run_command，确认可横向滚动，短行和滚到尽头的一侧不再空白。

---

## 当前交接：subagent-title-command-gap（done，2026-09-28）

- Current Objective（当前目标）: 子任务输出很长时，标题和后面的命令显示中间不再空出一段。已实现，未提交。
- 根因: 标题和命令跑马灯都是 flex:1，剩余宽度被平分。
- 改动内容: 标题按内容收缩，长标题才省略；命令继续占用剩余空间。
- Files（改动文件）: src/index.css、tests/frontend/chat-surface-css-contract.test.ts、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest：chat-surface-css-contract 36 passed。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看一条长输出的子任务，确认标题紧挨后面的命令，过长时标题省略而不是中间留白。

---

## 当前交接：composer-console-fixed-width（done，2026-09-24）

- Current Objective（当前目标）: 输入框旁控制台弹出面板不再被长命令撑宽。已实现，未提交。
- 改动内容: 后台命令菜单固定宽度。长命令在条目内横向滚动，左右高斯模糊渐隐。
- Files（改动文件）: src/index.css、tests/frontend/subagent-running-indicator.test.ts、design-mockups/command-console-fixed-width.html、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机点输入框旁终端图标，确认面板宽度不变，长命令可横向滚动并看到左右模糊。

---

## 当前交接：background-command-presence（done，2026-09-24）

- Current Objective（当前目标）: 后台命令在对话和 Composer 运行摘要中可见，并可从摘要关闭。已实现并验证，未提交。
- 改动内容: 运行中的后台命令独立显示；摘要计数和列表包含它，列表项调用 abort-tool 关闭。退出后工具结果改为终态，摘要同步移除。
- Files（改动文件）: server/tools/index.mjs、server/agent-manager.mjs、server/agent-session-queries.mjs、src/lib/server-agent.ts、src/lib/server-agent-types.ts、src/lib/shared-server-agent.ts、src/lib/i18n.ts、src/index.css、src/components/chat/ChatPanelHost.tsx、src/components/chat/panel-decoration.ts、process-folding.ts、subagent-running-indicator.ts、ChatSurface.tsx、local-workspace-tool-renderer.tsx、相关测试、docs/wiki、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认后台命令在回合结束后仍单独显示，摘要可关闭并随退出消失。

---

## 当前交接：run-command-background（done，2026-09-24）

- Current Objective（当前目标）: `run_command` 支持后台分离执行。已实现并验证，未提交。
- 改动内容: `run_in_background: true` 立即返回输出文件和 taskId；进程跨回合运行，stdout/stderr 持续写入命令日志；退出后向原会话发 `<task-notification>`。流式中走 followUp，空闲时开下一轮，活跃 Goal 暂存。销毁会话会终止其后台命令。
- Files（改动文件）: server/tools/definitions.mjs、server/tools/index.mjs、server/tool-wiring.mjs、server/agent-manager.mjs、server/system-prompt.mjs、src/lib/tool-renderers/shared.tsx、src/components/chat/surface/ToolMessage.tsx、tests/server/tools/run-command-background.test.mjs、tests/server/tools/definitions.test.mjs、tests/server/system-prompt.test.mjs、docs/wiki/server/tools/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机跑一条长命令，确认当前回合可继续使用其他工具，并在进程退出后收到通知。

---

## 当前交接：thinking-before-tool-order（done，2026-09-24）

- Current Objective（当前目标）: 第一轮思考过程保持在后续工具调用之前。已补上组前插入与跨 assistant 两条路径，未提交。
- 根因: 折走时的 `sourceNextSibling` 在工具行插到它前面后仍然有效，还原会把思考放到工具后面。
- 改动内容: 锚点前移到新插入节点之前；全量重建按来源 content 序号排回源序。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认第一轮「思考 → 工具」不再颠倒。

---

## 当前交接：android-cloud-removal（done，2026-09-24）

- Current Objective（当前目标）: 移除安卓端云服务原生功能和页面残留。已完成并提交。
- 改动内容: 删除 RemoteTunnel 插件、云账户存储、云 API、WebRTC 隧道服务及测试；Manifest、Gradle、Capacitor 白名单和架构文档同步。保留 Tailscale/局域网直连与通知服务。
- Files（改动文件）: android/app/src/main/java/com/quickforge/mobile/remote/、android/app/src/test/java/com/quickforge/mobile/remote/、MainActivity.java、AndroidManifest.xml、android/app/build.gradle、capacitor.config.ts、docs/architecture/android-remote-client.zh-CN.md、docs/wiki/src/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 未执行 Android Gradle 构建。旧 APK 前端资源仍在 `android/app/src/main/assets/public/`。
- Next Session（下一步）: 需要新 APK 时运行 `npm run android:sync` 覆盖旧云页面资源。

---

## 当前交接：tool-file-underline-on-name（done，2026-09-23）

- Current Objective（当前目标）: 编写/写入文件的下划线只在悬停具体文件名时出现。已实现，未提交。
- 根因: 文件名 `group-hover:underline` 被整行 `group/tool` 触发。
- 改动内容: `renderToolFileSummary` 改为文件名自身 `hover:underline`，按钮去掉 `group`。
- Files（改动文件）: src/lib/tool-renderers/shared.tsx、tests/frontend/tool-renderer-file-icon.test.ts、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认悬停「已执行 / 编辑 / 写入」不再出下划线。

---

## 当前交接：inspector-tab-fade（done，2026-09-23）

- Current Objective（当前目标）: 右侧工作栏多个 Tab 时变短、无中间分隔线，标题右侧渐隐替代省略号。已实现，未提交。
- 改动内容: 多 Tab 在 `min-w-24` / `max-w-32` 之间均分，放不下横向滚动；去掉竖线，标题在关闭按钮左侧正常流里渐隐，文字不覆盖 X。下拉列表选中项与 hover 同为淡背景。
- Files（改动文件）: src/components/workspace/WorkspaceInspector.tsx、src/index.css、tests/frontend/workspace-inspector-tab-fade.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机看多 Tab 渐隐是否够柔和；其余未提交改动仍待按需发版。

---

## 当前交接：thinking-before-tool-order（done，2026-09-23）

- Current Objective（当前目标）: 第一轮思考过程保持在后续工具调用之前。已实现并验证，未提交。
- 根因: 思考块先折叠时还原锚点为 null，同一容器后追加的工具行在全量重建时被 append 到思考前面。
- 改动内容: `restoreGroupedProcessNode` 在锚点失效时插回过程组之前。新增同容器顺序回归；wiki 两份所有权租约已同步。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/process-folding-incremental.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 5 文件 86 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认第一轮「思考 → 工具」顺序不再颠倒；其余未提交改动仍待按需发版。

---

## 当前交接：thinking-hint-hide-when-thinking-ends（done，2026-09-23）

- Current Objective（当前目标）: 思考过程完成后，右侧尾行提示不再显示。已实现并验证，未提交。
- 根因: 右侧提示跟整条消息的 `isStreaming`，思考段结束后正文/工具仍在流式时提示不收。
- 改动内容: `process-folding.ts` 改为只显示仍是 content 末块、无 `thinkingSignature`、且消息仍在流式的思考段；结束后立即淡出。CSS 注释与 wiki 两份契约同步。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、src/index.css、tests/frontend/thinking-hint.test.ts、tests/frontend/thinking-streaming-stage.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 28 passed + 连带折叠/接管 74 passed；eslint 通过。
- Blockers（阻塞）: 无。
- Next Session（下一步）: 真机确认思考写完、正文开始后右侧提示淡出；其余未提交改动仍待按需发版。

---

## 当前交接：stage-collapsed-no-round-flip（done，2026-09-23）

- Current Objective（当前目标）: 修复用户反馈「关闭『工具调用列表默认展开』后，新的一轮消息来了仍会展开又收缩反复」。经确认按方案 A 实现：设置关闭时内层 stage 全程收起、不自动展开；正在流式的思考行（含尾行提示）改挂顶层组 body 显示，本轮结束后随重建收进 stage。已实现并验证（feature_list.json 标 done），改动未提交。
- 根因: `updateProcessStageGroups` 的 stage 默认值原为 `processStageDefaultExpanded() || processStageHasStreamingThinking(stageBody)`（含流式思考就强制展开）；而每轮工具调用结束的组全量重建让新 stage 元素回落设置默认（收起），下一轮流式思考再顶开 → 第 2 轮起逐轮开合往复。
- 改动内容:
  1. `src/components/chat/panel-decoration/process-folding.ts`：新增 `processThinkingAssistant` / `isStreamingThinkingItem` / 导出 `splitStreamingThinkingRuns`（按位置切 run：liveThinking 挂组 body、其余包 stage，顺序不变）；`populateProcessGroup` 仅在设置关闭时切分；`updateProcessStageGroups` 默认值回归 `processStageDefaultExpanded()`，删除 `processStageHasStreamingThinking` 与强制展开。
  2. 测试：thinking-streaming-stage 的 S2 / 流式结束回填 / 跨 assistant / 手动收起用例按新语义重写，新增多轮工具循环往复回归；process-folding 新增切分函数单测。
  3. 文档：`docs/wiki/src/components/README.md`（两份副本）+ `docs/wiki/src/lib/README.md` 的折叠默认值契约同步为 `isStreamingThinkingItem` / `splitStreamingThinkingRuns`。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/thinking-streaming-stage.test.ts、tests/frontend/process-folding.test.ts、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 3 文件 61 passed + 连带 6 文件 104 passed + tests/frontend 全量 210 文件 2674 passed；`npx eslint`（改动文件）/ `npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 382 文件 4561 passed / 1 skipped（无失败）。
- Blockers（阻塞）: 无。
- Notes:
  - 设置默认展开（默认 true）时结构与行为零变化；切分只在「关闭设置」时启用。
  - 观感取舍（用户已确认）：本轮思考结束后该思考行随重建收进已收起的 stage（即该行消失），换取不再有自动开合动画。
  - 工作区同时存在并行会话 `thinking-hint-growth-inplace` 的改动（同文件不同函数）与 `streaming-display-stability` 的未提交改动；本轮未提交 Git；未触碰生成产物。
  - `settings-row-infotip` 仍为 pending。
- Next Session（下一步）: 真机跑一轮多轮工具循环（关闭「工具调用列表默认展开」）确认不再逐轮开合、流式思考行与尾行提示可见、本轮结束收进 stage；确认后可与其它未提交改动一起按 runbook 发小版本。

---

## thinking-hint-growth-inplace（done，2026-09-23）

- Current Objective（当前目标）: 修复用户反馈「对话中思考过程中的右侧显示会一句话重复显示两次」——思考行右侧尾行提示（hint）在「同一行内增长」时被反复整行滚入，两个视图同显同一句。按用户确认的方案 A 完成：只在行切换时滚入，同一行内增长就地更新。已实现并验证（feature_list.json 标 done），改动未提交。
- 根因:
  1. hint 是 header 第四槽位的 `quickforge-tool-marquee`；`ToolMarqueeController` 对任何 text 变化都 `beginRoll`（旧文上滚出 + 新文下滚入，滚入期间两视图同时可见），而 `syncProcessThinkingHint` 在流式「同一行内增长」时也会每 ~300ms 写一次 `text` → 260ms 滚入被反复触发、两视图长期同显同一句（只差几个字）。
  2. 复现证据：直接驱动 `ToolMarqueeController` 跑序列，grow 帧 `v0[VIS/s=句子A] v1[VIS/s=句子A-grow]` 双视图 VISIBLE。
- 改动内容:
  1. `src/lib/tool-marquee.ts`：`sync(text, running, restart = false, roll = true)`——`roll=false` 时 text 变化走就地更新（`applyInstant`），不再整行滚入；默认 true 保持 subagent 摘要卡行为。
  2. `src/lib/tool-renderers/shared.tsx`：`QuickForgeToolMarquee` 增 observedAttributes `roll`，回调只记录意图（`rollOnChange`，connectedCallback 复位），`sync()` 一次性消费并透传；`scheduleRestart` 统一 `sync(true)`。
  3. `src/components/chat/panel-decoration/process-folding.ts`：textChanged 分支先写 `roll`（`lineSwitched ? 'true' : 'false'`）再写 `text`（标记必须每次随 text 写，元素消费后复位）。
  4. 文档：`DESIGN_LANGUAGE.md`、`docs/wiki/src/components/README.md`（接管契约两份副本）、`docs/wiki/src/lib/README.md`（tool-marquee.ts 条目）。
  5. 测试：`tool-marquee.test.ts` +2、`thinking-hint.test.ts` +1、新增 `tests/frontend/thinking-hint-marquee-inplace.test.ts`（jsdom 全链路：真 React ThinkingBlock → 装饰层 → 真 `quickforge-tool-marquee` 元素 → ToolMarqueeController，桩 `Element.prototype.animate` 观察滚入）。
- Files（改动文件）: src/lib/tool-marquee.ts、src/lib/tool-renderers/shared.tsx、src/components/chat/panel-decoration/process-folding.ts、tests/frontend/tool-marquee.test.ts、tests/frontend/thinking-hint.test.ts、tests/frontend/thinking-hint-marquee-inplace.test.ts、DESIGN_LANGUAGE.md、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest tool-marquee 17 passed（+2 新例）、thinking-hint 16 passed（+1 新例）、新 jsdom 全链路 1 passed、思考/折叠/跑马灯/接管相关 7 文件 133 passed；**旧实现红灯验证**（临时把 roll 恒写 `'true'`）新用例在症状级断言失败 `expected 0 to have length 2`（同行增长仍触发两次整行滚入）+ thinking-hint 新用例同时失败，改回后全绿；`npx tsc --noEmit` 通过；`npx eslint`（src + 新测试）通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 383 文件 4562 passed / 1 skipped（无失败）。
- Blockers（阻塞）: 无。
- Notes:
  - 前一次全量中失败的 `tests/server/session-state-repository.test.mjs`（multi-process CAS writer 时序用例）在最新全量中通过，确认为并发负载下 flaky，与本改动无关。
  - 未动：取段规则 / 500 码点截断 / 300ms 节流 / 淡入淡出 / 行切换滚入 / release gate / 思考头接管契约；subagent 摘要卡跑马灯默认行为不变（roll 缺省 true）。
  - 无依赖变更；未触碰 dist/package-dist/package-offline；未提交 Git。
  - settings-row-infotip 仍 pending（WIP 不在本轮）；上一轮 streaming-display-stability 的改动仍在工作区未提交。
- Next Session（下一步）: 真机跑一轮带思考的流式对话验证观感（重点：右tail提示不再同一句上下两份、行切换仍有滚入、长行溢出滚动仍在增长停止后恢复）；确认后可考虑与 streaming-display-stability 一起按 runbook 发小版本；处理 pending 的 settings-row-infotip、session-state-repository flaky 用例。
