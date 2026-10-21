## 当前交接：session-open-fast-path-m4（部分实施，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上推进 M4 —— 把 `panel-decoration` 的命令式 DOM 注入器改为 React 渲染。**部分实施**：2 个模块已落地，1 个模块主动回退。未提交。
- 本轮最重要的产出是**边界**，不是数量：按「输入能否完全从 snapshot/props 得到」分类 36 个模块 —— 可 React 化 12（其中 5 个本就是纯函数）、必须保留命令式 10、混合 14。真正的阻塞不是代码量，是**契约**：
  - 全仓 **232 条**「读源码文本 + `toContain`」断言（`assistant-artifact-card` 独占 114 条）锁的是**命令式实现**（`hostElement.insertBefore(card, anchor)`、`rollbackButton.className = ...`）。React 写不出这些字符串 → 改造等于**重写测试**。
  - 装饰层测试多用 `vi.stubGlobal('document', fake)` 的假 DOM（vitest 默认 `node` 环境），**无法承载 `createRoot().render()`** → 任何 React 化必须整文件切 jsdom。
  - `process-folding.ts`（1717 行）与 `ChatSurface` 的所有权租约强耦合（`getSnapshotBeforeUpdate` → `releaseProcessGroups`），是节点搬运/所有权移交，不是渲染 → 不在 M4 范围。
- 已落地两个模块（都是整文件删除 + 宿主删 decorate 调用）:
  - `send-stop-button.ts`（50 行）→ `MessageEditor` 渲染：`isWaiting` 控等待环、`onPointerDownCapture` 中止、`onBeforeAbort` 先收建议弹层；宿主 `assistantWaitingActive` 提升为 `replyWaiting` state（按钮现在由 React 渲染，翻转必须触发 render）。
  - `persist-degraded-notice.ts`（37 行）→ `MessageList` 渲染为 `.qf-message-list` 首子。**前提**：把 `persist_degraded` 加进 `ChatSurface` 的 `SUBSCRIBED_EVENTS`，否则 `state.persistDegraded` 变化不触发快照刷新，提示永不出现也不消失。
- **主动回退的一个模块**（重要，避免下轮重做）：`goal-iteration-divider` 一度在 `AssistantMessage` 末尾按 React 渲染，随后回退。两个无法用 React 忠实表达的事实：① 宿主**渲染后**才确定——通常 assistant，但本轮无 assistant 时回退到该轮 **user 行**（`quickforge-goal-internal-user-message`），两个不同组件负责同一节点；② 分隔线必须是根的**最后一个子元素**，而 `message-actions` 其后仍会 append 到同一根（这正是它原本需要幂等重定位的原因）。要 React 化就得把消息列表兄弟顺序提升为共享状态，那是重写折叠/装饰模型。→ 改为抽出纯函数 `readGoalIterationMarker` + `buildGoalIterationDivider`，`syncGoalIterationDivider` 只留 DOM 写入；**67 条既有断言全过**，证明行为等价。
- 两个必须记住的等价性细节（想当然就会改坏可见行为）:
  1. 停止按钮 `title`/`aria-label` 必须是**字面量 `"Stop"`** —— 装饰层一直写的是字面量，改用 `t('stop')` 会改变非英文环境的可见 tooltip。
  2. 等待环清除时刻**不等于** `isStreaming && !streamingMessage`：宿主在 assistant 的 `message_start` 就清除，而 `streamingMessage` 要到第一个 `message_update` 才有值 → 从 snapshot 推导会让等待环多显示一段（像素相同、时刻不同）。故该状态仍由宿主显式提供。
- Evidence（验证）: `npm run test` 405 文件 4639 用例通过；`lint` 0 error（1 既有 warning）；`tsc -b` 通过；`build` 成功（3.53s）。专项：send-stop-button 8 例（jsdom 渲染断言，含 pointerdown 抢占祖先冒泡、键盘激活、字面量 Stop、等待环清除时机）、persist-degraded-notice 4 例（新增）、goal-iteration-divider 67 例。
- Next Session（下一步）: M4 按**逐模块绞杀**继续，每步必须同时做三件事 —— 保留类名与 DOM 层级、把源码文本锁改为渲染断言、删除宿主里对应的 decorate 调用（否则 `MutationObserver` 会让 pass 空转）。按代价排序：零文本锁的 5 个（`composer-plus-menu`、`thinking-level-controls`、`model-controls`、`context-compaction`、`editor-bindings`）→ 1–3 条文本锁的 6 个（`todo-write-summary`、`goal-control-strip`、`local-file-path-links`、`model-retry-notice`、`reconnect-notice`、`unreachable-strip`）→ `assistant-artifact-card`(114) / `message-actions`(44) / `message-queue`(27) 三件套放最后。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-open-fast-path-m3（done，2026-10-21）

- Current Objective（当前目标）: 在分支 `feat/session-view-rewrite` 上完成「会话打开快路径」准则 4 的最后一块——消除切换会话时的整树 remount。**已完成**。未提交。
- 本轮核心判断: **保活渲染子树，不保活 agent 运行时**。依据是 `ServerAgent.dispose()` 不清 `state`（`server-agent.ts:1236` 明确注释 dispose 后仍可安全读取），所以「保留渲染结果」与「保留 agent 运行时」可以分开。这一划分同时绕开了调研中风险最高的两项：常驻 MB 级 messages（`MAX_IDLE_AGENT_TASKS` 保持 0 未动）与跨项目 `workspaceRoot` 污染（`server/project-config.mjs` 的 `activeProjectId` 是进程级单值）。
- 新增文件: `src/components/chat/SessionViewPool.tsx`（类组件；非活跃 `display:none`、活跃 `display:contents`、槽位恒定不重排）、`src/lib/session-view-pool.ts`（纯策略：默认 1 个非活跃槽 + 1500 行预算，活跃视图先计费且永不淘汰）、`src/lib/session-view-activity.ts`（活跃广播 + `isInsideHiddenView`）、`tests/frontend/session-view-pool.test.ts`、`session-view-pool-dom.test.ts`、`session-view-activity.test.ts`、`composer-popover-panel-scope.test.ts`。
- 关键实现约束（踩过坑，勿重试）:
  - **必须用类组件**：冻结「离开时那个元素」要发生在本次 render 仍输出它的时候，读写发生在 render 期间——用 ref 违反 Rules of React（lint `react-hooks/refs`），在 effect 里 setState 被 `react-hooks/set-state-in-effect` 拒绝，且实测**会丢刚切入的槽位**（切到 B 后 B 整个消失）。实例字段是唯一合适的存放处。
  - **wrapper 与位置必须恒定**：换元素类型/key 会卸载整棵子树；移动 keyed sibling 会让 React 搬动 DOM。淘汰只整槽移除。
  - **门控用 DOM 可见性而非活跃信号**：信号在 `useLayoutEffect` 发布，本视图刚变可见的那次提交上信号可能仍指向旧视图，会把唯一一次权威装饰跳过（表现为切回后轮次导航为空）。
- 三条必须显式迁移的「卸载副作用」: ① 草稿末次落盘（不补则切走前 400ms 防抖内的输入**直接丢失**，已提取 `flushComposerDraft()` 供停用与卸载共用）；② 回前台复位滚动并贴底（`surface.setAutoScroll(true)`）；③ 装饰层重扫。
- 顺带修掉的既有缺陷: `thinking-level-controls.ts` 无参清理会删任意面板的 thinking 按钮、`model-controls.ts` 的 `aria-expanded` 读全局、`useModelActions.ts` 读**第一个**面板的草稿/附件。全部改为 `closest('.qf-chat-panel')` 归属；这三点在「主聊天 + 侧聊并存」下本就是真实 bug。
- Evidence（验证）: 实机（32210，83↔16 行 SPA 内切换）——切走→切回**同一 wrapper / 同一消息行节点**（`===`）、切回贴底（`distance=0`，含脱离 899px 后再切回）、两视图并存、真实滚轮滞回稳定脱离、回底按钮可见且生效、草稿 `isolated=true restored=true`、composer 四钩子可编辑；longtask 切回 **4 个 / 累计 249ms / 最大 83ms**（改造前 10 / 2360ms / 854ms，500–850ms 单项尖峰消失）。`npm run test` 404 文件 4633 通过；`lint` 0 error（1 既有 warning）；`tsc -b` 通过；`build` 成功（4.04s）。临时实例已清理，主实例 5176 全程 health 200。
- 一条验证方法教训: **直接赋值 `scrollTop` 会被自动跟随立刻回弹**（程序化滚动不算阅读意图），表现为「滚上去又贴底」，极易误判为回归。滚动验证必须用真实 `wheel`/`scrollBy`。另：`page.goto` 换 URL 会整页重载、绕过 SPA，测不到保活，须在 SPA 内点击切换。
- Next Session（下一步）: M4（`panel-decoration` 20+ 命令式注入器改 React 兄弟节点）仍未做，价值在可维护性而非性能（装饰 pass 12–17ms 不是瓶颈）。若将来要调大 `MAX_IDLE_AGENT_TASKS`，**必须**先给 server agent 绑定 projectId 而不是读全局 active project。未提交 Git；未手工修改生成产物。

---


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

