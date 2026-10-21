## session-open-fast-path-m4（部分实施，2026-10-21）

- Goal：把 `panel-decoration` 的命令式 DOM 注入器改为 React 渲染（M4）。
- **先划清边界**：按「输入能否完全从 snapshot/props 得到」分类 36 个模块 —— 可 React 化 12（其中 5 个本就是纯函数）、必须保留命令式 10、混合 14。真正的阻塞不是代码量而是契约：全仓 **232 条**「读源码文本 + toContain」断言（`assistant-artifact-card` 独占 114 条）锁的是**命令式实现**（`insertBefore`/`className =`），React 写不出这些字符串，改造等于重写测试；且装饰层测试多用 `vi.stubGlobal('document', fake)` 的假 DOM，**无法承载 `createRoot().render()`**，任何 React 化必须整文件切 jsdom。`process-folding.ts`（1717 行）与 `ChatSurface` 的所有权租约强耦合，属「节点搬运」而非渲染，不在 M4 范围。
- 落地 ①**发送/停止按钮**（`send-stop-button.ts` 50 行整文件删除）：`MessageEditor` 用 `isWaiting` 渲染等待环、`onPointerDownCapture` 中止（`stopImmediatePropagation`）、`onBeforeAbort` 先收建议弹层；宿主 `assistantWaitingActive` 提升为 `replyWaiting` state。
- 落地 ②**持久化降级提示**（`persist-degraded-notice.ts` 37 行整文件删除）：`MessageList` 按 `persistDegraded` 渲染为 `.qf-message-list` 首子。前提是把 `persist_degraded` 加入 `ChatSurface` 的 `SUBSCRIBED_EVENTS`——缺它则 `state.persistDegraded` 变化不触发快照刷新，提示永不出现。
- **主动回退 ③ goal 迭代分隔线**：一度按 React 实现（在 `AssistantMessage` 末尾渲染），随后回退。原因是两个无法用 React 忠实表达的事实：宿主在**渲染后**才确定（通常 assistant，本轮无 assistant 时回退到该轮 user 行 —— 两个不同组件负责同一节点）；且分隔线必须是根的**最后一个子元素**，而 `message-actions` 其后仍会往同一根 append（这正是它原本需要幂等重定位的原因）。改为把决策逻辑抽成纯函数 `readGoalIterationMarker` + `buildGoalIterationDivider`，`syncGoalIterationDivider` 只留 DOM 写入 —— 67 条既有断言全过，证明这次重构行为等价。**回退不是失败，是把「能等价的部分」和「不能等价的部分」分开**。
- 两个必须记住的等价性细节：① 停止按钮的 `title`/`aria-label` 必须是**字面量 `"Stop"`**——装饰层一直写的是字面量，改用 `t('stop')` 会改变非英文环境的可见 tooltip；② 等待环的清除时刻**不等于** `isStreaming && !streamingMessage`：宿主在 assistant 的 `message_start` 就清除，而 `streamingMessage` 要到第一个 `message_update` 才有值，从 snapshot 推导会让等待环多显示一段（像素相同、时刻不同）。
- 验证：`npm run test` 405 文件 4639 用例通过；`lint` 0 error（1 个既有 warning）；`tsc -b` 通过；`build` 成功（3.53s）。专项 send-stop-button 8 例（jsdom 渲染断言）、persist-degraded-notice 4 例（新增）、goal-iteration-divider 67 例。
- Notes：M4 的正确形态是**逐模块绞杀**：保留类名与 DOM 层级、把文本锁改为渲染断言、并删除宿主里对应的 decorate 调用（否则 `MutationObserver` 会让 pass 空转）。剩余按代价排序：零文本锁的 5 个 → 1–3 条文本锁的 6 个 → `assistant-artifact-card`(114) / `message-actions`(44) / `message-queue`(27) 三件套放最后。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m3（done，2026-10-21）

- Goal：消除切换会话时的**整树 remount**（准则 4 的最后一块），且用户可见交互零变化。
- 方案决策（关键）：调研确认 `ServerAgent.dispose()` 不清 `state`（`server-agent.ts:1236` 明确注释 dispose 后仍可安全读取），因此「保留渲染结果」与「保留 agent 运行时」可以分开。**只保活渲染子树，不调大 `MAX_IDLE_AGENT_TASKS`**——避免常驻 MB 级 messages，也避免跨项目 `workspaceRoot` 污染（`server/project-config.mjs` 是进程级单值，这是调研中风险最高的一项，本方案直接绕开）。
- 实现：新增 `src/components/chat/SessionViewPool.tsx`（类组件，非活跃视图 `display:none`、活跃视图 `display:contents`）、`src/lib/session-view-pool.ts`（纯策略：默认 1 个非活跃槽 + 1500 行预算，活跃视图先计入预算且永不淘汰）、`src/lib/session-view-activity.ts`（活跃广播）。`App.tsx` 把 `ChatPanelHost` 包进池，池 key 与 `ChatSurface` 的 key 完全一致（`runtimeScopeId`），「同 key 不重挂载」语义不变。
- 为什么用类组件：冻结「离开时那个元素」必须发生在**本次 render 仍在输出它**的时候，否则 React 在这一提交里已经卸载了它。这个读写发生在 render 期间，用 ref 会违反 Rules of React、用 setState 在 effect 里会被 `react-hooks/set-state-in-effect` 拒绝且实测会丢槽位（切到 B 后 B 整个消失）。实例字段是唯一既能持久又不参与 render 输入的存放处。
- 三条必须显式迁移的「卸载副作用」（冻结 props 让保活视图收不到更新，无法从 props 得知自己已离开屏幕）：① 草稿末次落盘（原在卸载 cleanup；不补则切走前 400ms 防抖窗口内的输入**直接丢失**）；② 回前台复位滚动并贴底；③ 装饰层重扫。②③ 是实测发现的：隐藏期 `display:none` 下测量值全为 0 且 `[agent]` effect 不重跑，不回前台补装饰，切回后就停在失真状态。
- 可见性门控：`runDecorate` 开头跳过隐藏视图，`ChatSurface` 贴底写 `scrollTop` 前也跳过（隐藏态 `scrollHeight` 为 0，写下去会把容器停到顶部）。判据用**DOM 可见性**（`isInsideHiddenView`）而非活跃性信号——信号在 `useLayoutEffect` 发布，本视图刚变可见的那次提交上信号可能仍指向旧视图，会把唯一一次权威装饰跳过。
- 顺带修掉的多面板缺陷（保活让「同时两个面板」成为常态，暴露了原本被「只有一个面板」掩盖的问题）：`thinking-level-controls.ts` 无参清理会删掉任意面板的 thinking 按钮、`model-controls.ts` 的 `aria-expanded` 取全局、`useModelActions.ts` 读**第一个**面板的草稿与附件。现全部按 `closest('.qf-chat-panel')` 归属。新增 `tests/frontend/composer-popover-panel-scope.test.ts` 锁定。
- 实测（83 行会话 ↔ 16 行会话，SPA 内切换，独立端口实例，`PerformanceObserver` longtask 收集器）：离开大会话 **1 个 longtask / 55ms**；切回大会话（保活命中）**4 个 / 累计 249ms / 最大 83ms**。对照改动前同链路基线（618 行 ↔ 171 行）小→大 **2360ms / 最大 854ms**——会话规模不同不能直接相减，但可确认**量级**：原先 500–850ms 的「整树卸载 + 重建」单项尖峰已不存在，剩余成本是数据重取（`/view`）与一次装饰 pass。
- 交互契约实测（同一 SPA 会话内切走再切回）：**节点身份复用**——切回后同一 `[data-quickforge-view]` wrapper 与同一 `.qf-user-message` 节点（`===` 成立），`.qf-scroll-container` 探针属性存活；装饰产物与切走前**完全一致**（4 个过程组、83 行）；切回**复位贴底**（`distance = 0`），含「先脱离 899px → 切走 → 切回」后仍贴底；两个视图并存（1 活跃 `contents` + 1 保活 `none`）。真实滚轮验证滚动滞回（距底 399 / 1499px 稳定脱离、不自动回底）；回底按钮 `display:flex` 可见且点击后 `distance = 0`；草稿隔离与恢复 `isolated=true, restored=true`；composer 四钩子齐全且 textarea 可编辑。
- 三次误判的排除（教训同上一轮：自动化给出的「异常」先用规则本身对照）：① 一个 4 轮会话的轮次导航节点为 0，一度判定为回归，实际是轮次导航有显示阈值 `TURN_NAVIGATION_MIN_TURNS = 5`，**空轨道才是正确行为**；② 用 `page.goto` 换 URL 会整页重载、绕过 SPA，测不到保活，改用侧栏点击在 SPA 内切换才有效；③ **直接赋值 `scrollTop` 会被自动跟随逻辑立刻回弹**，在补充验证里表现为「滚上去又回到贴底」，一度疑似回归——改用真实 `wheel`/`scrollBy` 后滞回完全正常。这是既有设计（程序化滚动不算阅读意图），不是本轮引入。
- 验证：`npm run test` 全量 404 文件 4633 用例通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.04s）。临时实例 32210 已清理，主实例 5176 全程 health 200。
- Notes：M4（装饰层 20+ 命令式注入器改 React 兄弟节点）仍未做，其价值是可维护性而非性能（装饰 pass 12–17ms 不是瓶颈）。若将来要调大 `MAX_IDLE_AGENT_TASKS`，必须先给 server agent 绑定 projectId 而不是读全局 active project。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m2（done，2026-10-21）

- Goal：为「打开历史会话」提供不重建 Agent 运行时的读取通道，把 `/restore` 与运行时 attach 移出首屏关键路径，且不改变任何用户可见交互。
- 根因：`GET /state`、`GET /messages`、`POST /restore` 三条读路径在会话不在内存时都 fallback 到 `restoreAgent`，而它走 `createAgent` 全套（`buildSystemPrompt` / `createServerTools` / `readProjectConfig` / 模型解析 / MCP）。**只为显示一段历史，却要重建整个 Agent 运行时。**
- 服务端：新增 `server/routes/session-view.mjs`（`GET /api/sessions/:sessionId/view`），在 `server/index.mjs` 的 `handleApi` 注册 `/api/sessions/` 前缀。内存命中直接委派 `getSessionState`（活跃会话的待审批/流式/上下文用量只存在于进程内存，原样返回即完全等价）；未命中直接 `readSessionStateValue` 读 SQLite，**绝不调用 `restoreAgent`**。响应形状与 `getSessionState` 对齐，可空字段统一用 `null`——否则 `JSON.stringify` 会丢掉 `undefined` 字段，形状随会话状态漂移（这是实现中实际踩到并修正的问题）。
- 前端：`ServerAgent.loadView` 打入该端点；`useAgentManager.performLoadSession` 改为「`loadView` 优先，任何失败回退 `restore`」，并在 `attachTaskToView` 之后用 `isLatestRequest` 守卫发起后台 `syncState` 校准（冷会话此时才 restore，但用户已看到内容）。
- 工具渲染（关键耦合点）：只读视图不返回 `tools`（存储层没有工具定义）。调研确认工具卡图标/label/摘要来自静态渲染器注册表，`state.tools` 只在 `AssistantMessage` 做一次 `find(name)` 且 `ToolMessage` 有 `toolCall.name` 兜底——**唯一例外是 MCP 卡**（应用期动态注册，且注册点只在面板初始化 effect 跑一次、依赖数组不含 `tools`，晚到不会自愈）。修复：`ToolMessage` 注册表未命中时对 `mcp__server__tool` 形态直接构造 `McpToolRenderer`，server 与原工具名从名字解析，不读 `tool.label`。
- 一次自我纠正：最初让 `ToolMessage` 经 `local-tools` 导入，但该模块在 import 时注册全部内置渲染器，改变了「哪些卡能解析」的既有语义，`chat-surface-message-list` 的顺序断言立刻变红。改为直接 import `tool-renderers/mcp-tool-renderer`，零导入副作用。
- 测试：新增 `tests/server/routes/session-view.test.mjs`（5 例，每例显式断言 `restoreAgent` 未被调用）；`server-agent.test.ts` 新增 `loadView` 2 例（不出现 `POST /restore`、失败可回退）；`chat-surface-tool-message.test.ts` 新增 MCP 无 `state.tools` 不降级 + 非 MCP 未知工具仍走通用卡。
- 验证：定向 vitest 全绿（session-view 5、server-agent 140、chat-surface-tool-message 10、chat-surface-message-list 19、chat-surface-behavior-alignment 10 等）；`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（2 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功。
- Notes：M3（会话视图实例池 keep-alive，需先把滚动状态归约为 `ScrollAnchor` 才能开窗口化，否则改变「滚动到顶部」行为）、M4（装饰层 20+ 命令式注入器改 React 兄弟节点）未实施，设计与风险在架构文档里。未新增/升级依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-round3（done，2026-10-21）

- Goal：把「切换会话时全量重算」的最后一块——Markdown 解析——也纳入内容寻址缓存。
- **推翻上一轮结论**：上一轮我判断「缓存 `react-markdown` 元素树无效，因为 remount 时 React 会重新执行 `ReactMarkdown`」。这个判断假设了它必须是 JSX 组件。本轮查证 `node_modules/react-markdown/index.js`：默认导出 `Markdown(options)` 是**普通函数**（`post(processor.runSync(processor.parse(file)), options)`），不是带 hook 的组件。因此可以在渲染期直接调用它拿到元素树并缓存，remount 时真正跳过 parse + 插件流水线。
- 改动：`Markdown.tsx` 新增 `markdownElementCache`（`ContentCache<ReactNode>`，上限 300），`renderMarkdownTree` 改为 `ReactMarkdown({ children, ... })` 普通调用，`MarkdownBlock` 用 `memoizeContent` 取缓存；新增 `clearMarkdownElementCache` 供测试隔离。缓存键只需 `content`：`remarkPlugins`/`components` 是模块级常量，`rehypePlugins` 只携带由同一 content 决定的 math token 映射（token 本身也已按内容缓存）。
- 正确性论证：React 元素是不可变描述，复用不会让渲染结果取决于挂载历史；`CodeBlock` 等外层组件读取的 context 变化仍由 React 正常传播，跳过的只是字符串解析与插件执行。
- 测试：`chat-math.test.ts` 新增 3 例——同一 content 两次渲染输出完全一致（缓存命中路径）、不同 content 互不串染、数学公式在缓存树上仍正确。
- 验证：`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.79s）。定向：chat-math 13、chat-surface-css-contract + chat-surface-message-list + chat-surface-render 83。
- 文档纠正：`docs/architecture/session-open-fast-path.zh-CN.md` 里那句「明确未做：缓存元素树是无效的」已改写为「更正」，说明上一版判断错在哪、为什么现在成立。
- Notes：至此四类渲染产物（Markdown 解析 / 代码高亮 / Mermaid / KaTeX）全部跨 mount 复用，准则 2 的「消除切换会话时的全量重算」已完整兑现。准则 4 的「消除整树 remount」仍未做——`ChatSurface` 的 `key` 不能直接删（同时承担丢弃上一会话草稿恢复/编辑器状态的职责），需要先设计显式的会话级状态迁移。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-acceptance（done，2026-10-21）

- Goal：对照交互契约清单做一次系统性可见交互验收，确认准则 5（不改用户可见交互）成立。
- 浏览器实测（独立端口实例，361 条消息会话）结果全部符合契约：
  - **滚动滞回**：初始贴底（距底 0）；小滚 40px 仍跟随；大幅上滚后脱离（距底 1141px）。
  - **回底按钮**：脱离后出现且可见。
  - **轮次导航**：存在、6 个节点、未被 CSS 隐藏。
  - **折叠**：6 个过程组、5 条终答标记为「不折叠」——终答常显契约成立。
  - **composer 契约**：`.qf-message-editor` / `.quickforge-composer` / `-shell` / `-dock` 四个钩子齐全；发送、`+`、权限、模型触发都在；textarea 可编辑。
  - **草稿隔离与恢复**：在 A 输入 → 切到 B（草稿为空，未串染）→ 切回 A（草稿恢复）。
- **一次误报的排查过程（值得记录）**：侧栏点击会话行在我用「合成 click」和「强制点击」时都不切换，一度被判定为产品回归。用 `git stash` 在**基线代码上复现同样现象**后排除——真实原因是会话行位于 **dnd-kit 可拖拽排序容器**内，其指针事件被 DnD 拦截，自动化点击打不到行按钮。改用 deep-link 路由切换后，草稿隔离/恢复验证全部通过。教训：自动化交互失败时，先用基线对照排除「不是自己引入的」，再判断是否产品问题。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.41s）。主实例 5176 全程运行（health 200 复核），临时实例 32190/32191/32192 均已清理。
- Notes：生产代码零改动（本轮是验收）。中途 `git stash` 已 `pop`，改动完整保留（31 个已跟踪文件 + 13 个新增文件）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-hydrate-batching-probe（done，2026-10-21）

- Goal：验证「把补齐历史切成小批、逐帧渲染」能否削平首屏后的长任务。
- **两个新发现（都是正面或决定性的）**：
  1. **首屏本身已经很快**：小→大切换实测 `click 1ms → load-start 35ms → first-paint/ready 303ms`。之前的 2360ms 累计阻塞**发生在 ready 之后**，是补齐历史造成的，不在首屏关键路径上。
  2. **切断补齐则零长任务**：把 `hydrateFullHistory` 的全量请求 abort 掉后，实测 `longTasks: []`、`totalBlockMs: 0`。证明剩余阻塞的唯一来源就是那一次全量替换。
- 尝试并**被实测否决**：把全量替换改成「按 60 条逐帧向前扩展」。
  - 预期：长任务被切碎。
  - 实测：**更差** —— 累计阻塞从 ~1.1s 涨到 **5006ms**、长任务从 2 个变成 **35 个**、最大单项从 609ms 降到 324ms 但总量翻 4 倍。
  - 原因：每次提交都要重建整张列表（React 协调 + 装饰重算），增量收益被重复成本吃掉。已完整回退，并把「不要分批」的实测数据写进代码注释。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.27s）。主实例 5176 全程运行（health 200 复核），临时实例 32188 已清理。
- Notes：**生产代码零净改动**（分批尝试已完整回退，仅保留说明性注释）。这条结论很重要：剩余阻塞不能用「切小批」解决，只能减少总渲染量（窗口化）或不重建（DOM 保活），两者都属 M3。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-remount-memo-probe（done，2026-10-21）

- Goal：在已确认「remount 成本在 fiber 创建」的前提下，尝试低风险组件层优化，看能否在不改 `key` 的情况下削减成本。
- 两个候选优化，**都被测试否决并完整回退**：
  1. **给 `ThinkingBlock` 加 `memo`**（该会话有 125 个实例，是 surface 中唯一未 memo 的组件）。失败原因：`thinking-block-interaction.test.ts` 直接调用组件函数来断言 pointerdown-first 契约，memo 返回的是对象而非函数，4 个用例全部报 `ThinkingBlock is not a function`。而且即便不冲突，memo 对 remount 本就无效——全新 fiber 一定会执行组件函数，这正是上一轮实测得出的结论。
  2. **按消息对象身份缓存 `messageDecorationFingerprint`**（每行每帧两次 `JSON.stringify`）。失败原因：`message-actions.test.ts:561` 明确断言「**原地修改 details（数组引用不变）→ 指纹变化 → 行重新装饰**」。这是被测试锁定的语义，与「同对象必然同指纹」的缓存前提直接冲突，2 个用例失败。
- 结论：这两个方向都不通，且都不是「测试写错了」——测试锁定的是真实契约（组件可被直接调用、原地变更必须被发现）。M3 若要走，仍必须动 `key` 或做 DOM 保活，没有组件层的捷径。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.49s）。主实例 5176 全程运行（health 200 复核），临时实例 32187 已清理。
- Notes：本轮**生产代码零净改动**（两处尝试均已回退）。唯一留下的是这段记录，避免后续重复尝试同样两条死路。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-remount-profiling（done，2026-10-21）

- Goal：为准则 4 的剩余部分（消除整树 remount）建立可执行的成本基线，并排除错误方向。
- 实测（A=618 行/10425 节点，B=171 行，来回切换，只读视图与渲染缓存均已生效）：

  | 切换方向 | longtask 数 | 累计阻塞 | 最大单项 |
  |---|---|---|---|
  | 大 → 小 | 8 | 1034ms | 238ms |
  | 小 → 大 | 10 | **2360ms** | **854ms** |

  分段（点击为 0）：+5ms 首个 longtask 140ms → +148ms `load-start` → **+383ms 618 行旧 DOM 整体销毁（MutationObserver 记录移除 578 节点）** → +592ms `first-paint`/`ready`。
- **三个被数据排除的方向**（这是本轮的主要价值）：
  - 不是 DOM 解析：1.47MB `innerHTML` 重建单次仅 **23ms**；
  - 不是布局：10425 节点强制同步布局单次 **0.1ms**；
  - 不是网络：首个 140ms longtask **早于** `load-start`。
  结论：成本在 React 创建约 1 万个 fiber + 组件函数执行（该会话 125 个 `ThinkingBlock`、191 个工具行、19 个 markdown 块）。这解释了为什么「内容寻址缓存」只解决了字符串解析、没解决 remount 本身。
- 本轮产出：上述数据全部写入 `docs/architecture/session-open-fast-path.zh-CN.md` 的 M3 章节，作为后续改造的基线与方向约束。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 通过。主实例 5176 全程运行（health 200 复核），临时实例仅用 32185/32186 并在结束时清理。
- Notes：**未修改生产代码**——本轮是诊断，不是修复。M3 的保活改造（`SessionViewStore` + `ChatSurface` 的 `key` 迁移策略）需要产品决策支撑：`key` 除 remount 外还承担「换会话时丢弃上一会话草稿恢复/编辑器状态」，替换它必须先确定该状态如何显式迁移。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-message-rows（done，2026-10-21）

- Goal：消除准则 4 明确点名的「命令式 DOM 后置注入的重复扫描」。
- 发现：`getPrimaryMessageElements` 在 **4 个装饰器**里各写了一份完整实现（`message-actions`、`assistant-waiting-bubble`、`context-compaction`、`approval-card`），每份都是 `querySelectorAll('.qf-user-message, .qf-assistant-message')` + `closest` 过滤。一次 decorate pass 会对同一张列表重复全表扫描多遍。
- 改动：新增 `src/components/chat/panel-decoration/message-rows.ts` 作为唯一枚举实现（`readMessageRows` / `getPrimaryMessageList`），4 处改为复用；`context-compaction`、`assistant-waiting-bubble`、`decorateMessages` 增加可选 `messageRows` 入参，`ChatPanelHost.decorate` 在 pass 开始时枚举**一次**并向下传递。
- 一个实现细节：`readMessageRows` 里把 `closest('message-list, .qf-message-list')` 拆成两次单选择器查询。真实 DOM 两者等价，但测试脚手架只支持单选择器形式——合并写法会让 4 个既有用例失败。这是「实现要适配最小 DOM 契约」的一个具体例子。
- 测试：新增 `tests/frontend/message-rows.test.ts`（3 例：只保留本列表的行并跳过流式尾行、无列表时返回空、**每次调用只做一次全表扫描**）。最后一条锁定的正是本轮要解决的问题。
- 验证：`npm run test` 全量 400 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.58s）。浏览器实测（独立端口 32184，361 条会话）：171 行、消息动作 8、压缩横线 1、过程组 6、composer 与贴底均正常。主实例 5176 全程运行（health 200 复核）。
- Notes：准则 4 的「消除重复扫描」部分已有实质进展，但「消除整树 remount」仍未动——那需要 M3 的 `SessionViewStore`，且受 `ChatSurface` 的 `key` 约束。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-scroll-anchor（done，2026-10-21）

- Goal：把重复的滚动锚点补偿逻辑收敛为单一抽象，为 M3（展示层跟随「会话」而非「agent 实例」）打地基。
- 发现的问题：同一套公式在 `ChatSurface` 里存在两处独立实现——`captureReadingAnchor`/`applyReadingAnchor`（后台补齐历史）与 `loadMoreMessages`（加载更早一页）。公式相同但各自维护，且都嵌在组件里无法单测。
- 改动：新增 `src/components/chat/scroll-anchor.ts`，导出 `readScrollAnchor` / `resolveAnchorRow` / `anchoredScrollTop` 与 `ScrollAnchor` 类型。两处调用点改为复用；`loadMoreMessages` 通过 `requireMessageIndex: true` 表达「分页必须锚在真实消息行上，不能锚折叠组（分页会重建它们）」。
- 顺带修复一个实测暴露的既有缺陷：顶部可见行是**折叠过程组**（无 `data-message-index`）时，原实现回退到 ordinal，前置 142 行后该 ordinal 指向了别的行——浏览器实测 `scrollTop` 保持不变而顶部文字被换掉。修复为「优先锚在带索引的真实消息行，找不到才退回任意行」。修复后实测 `topText` 保持一致。
- 测试：新增 `tests/frontend/scroll-anchor.test.ts`（9 例，覆盖锚点选取、`requireMessageIndex` 行为、按索引优先/按 ordinal 回退、补偿值计算、无需调整时返回 null）。这两个函数此前完全没有单测覆盖。
- 验证：`npm run test` 全量 399 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.78s）。浏览器实测（446 条会话，独立端口 32182 临时实例）：补齐后 `topText` 保持一致、`hydrated` 从 99 → 203 行。主实例 5176 全程运行（health 200 复核）。
- Notes：M3 的下一步是在这个抽象之上建 `SessionViewStore`。`ChatSurface` 的 `key` 仍是硬约束（承担「换会话时丢弃草稿恢复/编辑器状态」）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-decorate-measurement（done，2026-10-21）

- Goal：量化装饰层在真实长会话上的成本，判断是否值得为 M4（装饰层 React 化）投入重构。
- 实测（618 行已完整补齐的会话，单次强制装饰 pass）：**16.5–17.2ms**，首帧后第一次是 5.1ms（干净状态）。其中「枚举本列表拥有的行」这一步占约 6.2ms。
- 尝试并回退的优化：把选择器从 `user-message, assistant-message, .qf-user-message, .qf-assistant-message` 收窄为纯类名（实测遗留自定义元素匹配数 = 0，走查从 6.94ms 降到 4.91ms）。**被测试否决**：`message-actions.test.ts` 用 `createFakeElement('user-message')` 显式锁定遗留标签兼容行为，收窄后该用例失败。收益仅约 2ms/次（16.5 → 14.5ms），远低于 50ms longtask 阈值，不值得拿一个被测试锁定的契约去换。已完整回退，理由与实测数据写进代码注释。
- 结论：装饰层在当前规模（618 行）不是瓶颈。M4 的价值在于「消除命令式 DOM 注入带来的状态复杂度与自愈逻辑」，不在性能；不应以性能为由推进 M4。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（6.18s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32181。
- Notes：本轮没有留下生产代码改动（唯一改动是注释记录了实测结论与回退理由）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-cache-proof（done，2026-10-21）

- Goal：为「内容寻址渲染缓存」提供真正能证伪的证据，而不是「输出一致」这种自证式断言。
- 发现的问题：`chat-math.test.ts` 里的元素树缓存测试原本只断言「同一 content 两次渲染输出一致」。这个断言有缺陷——**即使每次都重新解析，输出也必然一致**，它无法区分「命中缓存」与「重新解析」，等于没有测到缓存本身。
- 修复：spy `react-markdown` 模块并统计调用次数。`react-markdown` 默认导出是普通函数（已在 Node 中确认 `typeof default === 'function'`），所以可以直接测量 unified 流水线实际运行次数。新增两例：
  - 命中缓存时调用数不增（真正跳过 parse + 插件）；
  - `clearMarkdownElementCache()` 之后调用数增加（缓存确实承载了复用）。
- 验证：`chat-math.test.ts` 15 例全通过；`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` 成功（5.82s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32180。
- Notes：这条测试的意义不在于覆盖率，而在于它现在**能真正失败**——如果有人把缓存改回每次都解析，第一例立刻变红。M3（会话视图实例池 keep-alive）与 M4（装饰层全量 React 化）仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-idle-hydration（done，2026-10-21）

- Goal：对首屏链路做精确耗时归因，找出剩余的可优化项。
- 归因结果（1279 条消息，点击切换）：`/view` 8ms / 592KB、`/state` 18ms / 77KB、尾部对账 `/messages` 2ms / 2.4KB，`click → first-paint` 275ms；但**全量补齐 `/messages` 是 141–186ms / 10MB**，且原本在 first-paint 的同一时刻发起——正好与用户首次交互抢主线程。
- 修复：`hydrateFullHistory` 改到 `requestIdleCallback`（`timeout: 2000` 兜底；无该 API 时 300ms `setTimeout`），给它独立取消句柄。实测补齐启动点从「首帧同时」推迟到**首帧后 270ms**，且补齐结果正确（`minIdx=0` / `maxIdx=1277`、贴底正常、composer 正常）。
- 一个被避免的 bug：最初把 idle 句柄赋给 `cancelInitialRenderReady`，会覆盖首帧就绪通知的取消函数，导致卸载时无法取消就绪通知。已改为独立的 `cancelHydration`，并在 cleanup 中一并调用；加了源码契约测试锁定「不得覆盖」。
- 测试：`chat-surface-behavior-alignment.test.ts` 新增 1 例（补齐必须走 idle 槽、取消句柄独立）。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.95s）。主实例 5176 全程运行（health 200 复核），仅清理临时实例 32179。
- Notes：`clickToFirstPaint` 在一次未命中缓存的测量里是 458ms（首次加载该会话），命中缓存时 275ms——这是既有差异，不是本轮回归。10MB 全量补齐本身仍是成本，但它已不在关键路径上；进一步压缩需要服务端分页 + 窗口化（M3 范畴）。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-decorate-timing（done，2026-10-21）

- Goal：把「首帧后第一轮 DOM 装饰」的耗时也纳入观测——它不在 `ready` 之前，但决定按钮/折叠何时可用，属于打开会话的用户感知成本。
- 问题：首版埋点只到 `ready`，而装饰在 `ready` 之后由 rAF 触发。DevTools trace 到「已上屏」就结束，真正阻塞首次交互的那段成本是隐形的，无法判断装饰层是否值得继续优化。
- 改动：`session-open-timing.ts` 新增 `recordFirstDecorateTiming` / `readSessionOpenTiming().firstDecorateMs`，同时打一个 `qf:session-open:decorate:<sid>` mark（带 `durationMs` detail）；`ChatPanelHost` 的 `runDecorate` 在结束时记录。只记第一轮：流式期后续装饰是常规开销，混入会掩盖打开会话的真实数字。
- 实测（1279 条消息的活跃会话，独立端口临时实例）：`click → first-paint/ready = 441ms`（上轮同链路 608ms），补齐后 `minIdx=0` / `maxIdx=1277` 正常；`data-message-list` 有 203 行时，单次强制装饰 pass 约 12–17ms，无 longtask。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.24s）。主实例 5176 全程运行（`/api/health` 200 复核），临时实例只清理了 32178 这一个进程。
- Notes：装饰 pass 12–17ms 未达 longtask 阈值（50ms），在当前规模下不是瓶颈，因此**本轮没有为它做进一步优化**——先把成本变成可见数据，避免凭直觉优化非瓶颈。M3（会话视图实例池 keep-alive）与 M4（装饰层全量 React 化）仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-active-window（done，2026-10-21）

- Goal：实机测量完整首屏链路（点击 → 可交互），定位并修复残余的耗时来源。
- **发现并修复的第二个真实缺陷**：只读视图的**内存命中分支**直接返回 `getSessionState`，后者携带完整消息列表。实测 1279 条消息的活跃会话：`/view` 响应 **9.5MB / 1946ms**，首屏 `click → first-paint` 高达 **3202ms**。也就是说只读端点在最需要它的场景（大会话、活跃会话）完全没有生效。修复：内存命中同样应用尾部窗口，但保留 `tools`、待审批、流式等运行时字段。同一条链路降到 **592KB / 7ms**，首屏 **608ms（−81%）**。
- 验证方式：因用户要求不关闭现有实例，起了独立端口（32177）的临时实例加载新代码验证，验证完成后只清理该临时进程，主实例（5176）始终保持运行（`/api/health` 200 已复核）。
- 实测数据（1279 条会话）：冷 `view` 592KB/11ms；`restore` 76KB + 内存命中 `view(tail=200)` 592KB/7ms（此前 9.5MB/1946ms）；前端 `click→first-paint` 3202ms → 608ms，且补齐仍正常（`minIdx=0`、`maxIdx=1277`）。
- 测试：`session-view.test.mjs` 新增 2 例——活跃会话也走尾部窗口（断言窗口取尾部而非头部、`messagesSummary.count` 正确、`tools` 运行时字段保留）、活跃会话消息未超窗口时不带 summary。当前 9 例全部通过。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.67s）。
- Notes：这次修复说明「按分支写测试」比按路径写更可靠——第一版测试只覆盖了冷会话（storage 分支），内存分支漏测，直接导致 9.5MB 的回归上线到实测阶段才被发现。M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit；未关闭用户正在使用的实例。

---

## session-open-fast-path-hydration-anchor（done，2026-10-21）

- Goal：在浏览器实机验证 M2 只读视图链路的用户可见行为，并修复补齐历史带来的滚动跳变。
- **发现并修复的真实回归**：尾部窗口在头部插入 100~200 行历史时，`scrollTop` 不变而上方内容变高，用户视口整体下跳。实测（886 条会话）：补齐后 `scrollTop` 完全不变，顶部可见行从「已测试完成」变成「异步 shell 测试通过」——用户读的内容被推走了。
- 修复方案经历三次失败才成立，全部记录在代码注释与架构文档里：① 在发起请求时捕获锚点（错：网络往返期间用户会滚动，用过期位置）；② 用 `offsetTop` 算 delta（错：测量发生在插入行高度稳定之前）；③ 用 DOM 节点身份（部分错：折叠过程组会被重建）；④ **视口偏移 + 绝对 `data-message-index`（无索引用 ordinal 回退）**（通过）。
- 实现：`hydrateFullHistory(beforeReplace?)` 在替换前一刻同步调用回调，宿主用它调 `surfaceRef.current.captureScrollAnchor()`；`ChatSurface` 的 layout effect 在提交时按 delta 补偿 `scrollTop`。补齐触发点从 `useAgentManager` 移到 `ChatPanelHost`（那里才有 surface ref）。
- 另一处修复：`server-agent.ts` 里 `window.requestAnimationFrame` 未做环境判断，非 DOM 环境（测试、ACP）直接抛 `window is not defined`。已改为带 `typeof window !== 'undefined'` 守卫。
- 浏览器实测证据：端点级——1179 条会话 `/view` 601KB/20ms（全量视图 4.6MB/57ms）；网络请求顺序 `/view` → `/state` → `/messages?after=360`（证明窗口偏移换算正确）；UI 级——361 条与 1179 条会话均能滚到 `data-message-index=0`，贴底、composer、回底按钮、轮次导航全部正常；补齐时 `topText` 不变且 `scrollTop` 精确补偿。
- 测试：`chat-surface-behavior-alignment.test.ts` 新增 5 例（替换时刻捕获、delta 度量方式、锚点识别方式、宿主触发位置、非 DOM 守卫）；`server-agent-message-window.test.ts` 8 例锁定窗口偏移换算；`session-agent.test.ts` 新增窗口补齐 2 例。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（3.85s）。
- Notes：残余 67px 漂移来自补齐前后折叠过程组自身高度变化（折叠头文案随时长变化），不是定位错误。M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-tail-window（done，2026-10-21）

- Goal：实机验证 M2 只读视图通道的真实收益，并修掉实测暴露的设计缺陷与回归。
- **实测推翻了原假设**：第一版 `/view` 全量返回，1179 条消息的会话单次响应 4.6MB / 57ms，而完整 restore 链路（restore 78KB + messages 4.5MB）共 151ms。只读端点确实省掉了一次串行往返，但**字节数完全没降**——瓶颈从「服务端重建运行时」转移成「单次超大响应 + 前端主线程解析」，实际更糟。
- 修正：新增 `readSessionStateTail`（SQLite 只取末 N 条 + total），默认尾部 200 条，支持 `?tail=N`。实测 1179 条会话 **4.6MB/112ms → 601KB/20ms（−87% / −82%）**，`tail=50` 时 128KB / 5ms。
- 尾部窗口引入两个正确性问题，均已修复并加测试：
  - **前缀永远补不回**（真实可见回归）：只读视图只带 200 条，增量对账只往后拉、不补前缀，用户从完整 restore 的 361 条退化为只能看到 200 条。修复：`hydrateFullHistory()` 首屏后做一次全量替换并归零窗口偏移。
  - **增量对账索引基准错**：`mergeIncrementalMessages` 与所有 `summary.count === localCount` 比较都隐含「本地索引 == 服务端索引」，窗口场景下会误判为服务端截断并触发无意义全量重拉。修复：新增 `messageWindowOffset`，比较改用 `localEnd`，合并改走新增的 `mergeWindowedMessages`（丢弃落在被省略前缀里的尾部条目）。
- 另一处修正（测试发现）：`readSessionStateTail` 的非 split 分支原本无条件返回 `total`，导致全量返回时也带上 `messagesSummary`，短会话被误判为「有更早历史」。改为仅在窗口被截断时返回。
- 测试：新增 `tests/frontend/server-agent-message-window.test.ts`（8 例，锁定窗口偏移换算，偏差一格就会让整段对话渲染错位）；`server-agent.test.ts` 新增 2 例（窗口补齐为全量、全量时不再多发请求）；`session-view.test.mjs` 新增 2 例（返回尾部而非头部、短会话不下发 summary）。
- 验证：`npm run test` 全量 398 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（4.60s）。
- Notes：实机验证用 `node server/index.mjs --dev` + curl 直接打端点测得。**未做浏览器 UI 级验证**（未在真实界面点击会话观察渲染与滚动），这是下一步应补的验证。M3（会话视图实例池 keep-alive）与 M4 全量 React 化仍未实施。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-round2（done，2026-10-21）

- Goal：补齐「会话打开快路径」的第二个渲染缓存缺口（KaTeX），并继续削减装饰热路径的重复工作，全程不改可见行为。
- 改动：① `KatexMath.tsx` 接入内容寻址缓存（`(display, latex)` → html）。`katex.renderToString` 是纯函数，但 React `memo` 只在同一次挂载内生效；会话切换整树 remount 会让历史公式逐个重算。只缓存成功结果，异常路径仍回退红色原文。新增 `clearKatexHtmlCache` 供测试隔离。② `ChatPanelHost.tsx#artifactsInputKey` 按 `messages` 数组身份加 `WeakMap` 记忆。依据是既有不变量「`state.messages` 从不原地修改」——已全仓核实无 `push`/`splice`/`pop`/`shift`/`unshift` 写入，所有写入方一律替换整个数组，与 `readAgentSnapshot` 的身份复用契约一致。
- 被测试否决并回退：给 `goal-iteration-divider` 加「details 指纹相同就跳过」的短路。该装饰器既有语义是**每周期重新确认分隔线仍挂在宿主末尾**（其它装饰器可能在它之后追加内容），`goal-iteration-divider.test.ts` 显式锁定该幂等重定位行为。已回退，理由写入架构文档 M1.6。
- 测试同步：`chat-math.test.ts` 的「renderToString 抛错」用例需要在断言前 `clearKatexHtmlCache()`——缓存生效后，前序用例缓存的成功结果会让它走不到失败分支。这是缓存的正常行为，不是回归。
- 验证：`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npx tsc -b` 通过；`npm run build` 成功（5.69s）。定向：chat-math 10、goal-iteration-divider 67、chat-surface-render + chat-surface-behavior-alignment 27。
- Notes：`KatexMath.tsx` 新增非组件导出触发 `react-refresh/only-export-components`，按仓内既有先例（`Markdown.tsx`、`MessageList.tsx`）在文件首行加 `eslint-disable` 说明。M3 未实施，且发现一个新约束：`ChatSurface` 的 `key` 不能直接去掉——它同时承担「换会话时丢弃上一会话的草稿恢复/编辑器状态」的职责，需要先用显式的会话级 key 迁移策略替代。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m4-slice（done，2026-10-21）

- Goal：在不改变任何可见行为的前提下，削减装饰层与滚动路径上的重复全表扫描与临时分配（准则 4 的可证明等价切片；M3 的 keep-alive 与 M4 的全量 React 化仍未实施）。
- 改动：① `panel-decoration/message-actions.ts` 的 `getMessageElements` 由「`Array.from(querySelectorAll)` + 两次 `filter`」改为单遍遍历 + 提前 `continue`，语义不变（嵌套列表仍排除、流式 partial 仍排除），每次装饰少一次中间数组与一轮祖先遍历。② `panel-decoration/process-folding.ts` 的 `decorateProcessBlocks` 用 `flushTurn` 闭包单遍分组，避免每轮回调都新建数组；分组结果与原来逐字一致。③ `scroll-sync.ts` 的 `scrollToBottom` 调整读取顺序：先读 `scrollTop` 再读 `scrollHeight`，让「已贴底」的短路判断尽可能避免触发不必要布局失效。
- 判据：三处都只重排执行路径，不改变任何阈值（脱离 50px / 吸附 10px / 近底 80px / 回底按钮 280↔120）、不改变分组规则、不改变 DOM 结构或类名。
- 验证：定向 vitest 全绿（process-folding 系列 4 文件 118 passed、scroll-sync + scroll-to-bottom-button 29 passed）；`npm run test` 全量 397 文件全通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` 成功（5.66s）。
- Notes：这是准则 4 的**部分**进展，不是达成。真正消除整树 remount 需要 M3：`SessionViewStore` 让展示层跟随「会话」而非「agent 实例」，且必须先把滚动状态归约为单一 `ScrollAnchor`（`{ turnId, offsetPx }`）才能安全开启窗口化——否则「滚动到顶部」的可见行为会变。装饰层全量 React 化（M4）同样未做。未新增依赖；未手工修改生成产物；未创建 Git commit。

---

## session-open-fast-path-m0-m1（done，2026-10-21）

- Goal：优化「点击历史会话 → 首帧可交互」的耗时，且不改变任何用户可见交互（滚动阈值、折叠规则、遮罩过渡、DOM 契约、只读/分享/侧聊能力矩阵全部不变）。
- 根因（只读调研结论）：① 读路径被写路径绑架——`GET /state`、`GET /messages`、`POST /restore` 在服务端全部 fallback 到 `restoreAgent`，而它走 `createAgent` 全套（`buildSystemPrompt` / `createServerTools` / `readProjectConfig` / `readStore(settings)` / MCP），只为显示一段历史却重建整个 Agent 运行时；② 展示与运行时耦合——`ChatSurface` 的 `key={agentRuntimeScopeId ?? agent.sessionId}` 让切会话 = 整树 remount = 全部历史 Markdown 重新解析、代码块重新高亮、Mermaid 重新渲染，而这三者都没有跨 mount 缓存；③ 重复计算——`createAgent` 内 `readProjectConfig` 实读 3 次、`readStore('settings')` 至少 4 次、skills 目录扫描 3 次（其中 `createSkillTools` 与 `loadSkillToolContext` 是同一批目录扫两遍）；④ 前端 `fetchAllSessionMessages` 串行分页，默认 500 导致长会话 ⌈N/500⌉ 次串行往返。
- 改动（M0 埋点）：新增 `src/lib/session-open-timing.ts`，`performance.mark` 四段（click / load-start / first-paint / ready），`readSessionOpenTiming` 汇总 `clickToReadyMs` / `clickToFirstPaintMs` / `loadToReadyMs`；接入 `useAppLoadingTransitions`（click / load-start / ready）与 `ChatPanelHost` 就绪回调（first-paint）。纯旁路：Performance API 缺失、id 非法、重复打点全部静默处理。
- 改动（M1.1 渲染缓存）：新增 `src/lib/render-cache.ts`——`ContentCache`（有界 LRU，FNV-1a 摘要定位桶 + **命中时逐段严格比较原字符串**，摘要碰撞只会退化为 miss）、`memoizeContent`、`memoizeContentAsync`（并发调用共享 in-flight promise，失败不入缓存）。接入三处纯函数：`chat-math.ts`（定界符预处理结果含 token Map）、`code-highlight.ts`（`(language, code)` → segment 数组）、`mermaid-renderer.ts`（源码 → SVG）。
- 改动（M1.2 消除重复技能扫描）：`server/tools/definitions.mjs` 的 `createSkillTools` 新增可选 `resolvedSkills`；`server/agent-manager.mjs` 的 `createServerTools` 改为先 `loadSkillToolContext` 一次、`createSkillTools` 通过 `resolvedSkills: mergeSkills(...)` 复用。`loadSkillToolContext` 改为无条件执行（原先在 `includeSkillTools=false` 时被跳过），保持 toolContext 字段形状不变。
- 改动（M1.3 配置读取缓存）：`server/storage.mjs` 新增按 `(mtimeMs, size)` 校验的 `readJsonFileCached`（命中返回 `structuredClone`，保持调用方「可随意修改返回值」的既有语义）；`writeJsonAtomic` 在 rename 成功后 `invalidateJsonFileCache(file)`，避免文件系统 mtime 粒度较粗时读到写入前的值。`readProjectConfigData` 与 `readConfigStore` 改走该缓存。外部直接编辑文件同样被 `(mtime, size)` 变化捕获，与原先「每次都读盘」的新鲜度一致。
- 改动（M1.4 分页对齐上限）：`server/routes/agent.mjs` 的 `GET /api/agents/:id/messages` 默认 `limit` 由 500 提升到服务端上限 5000；显式传 `limit` 仍可降级到任意较小页，返回形状与语义不变。
- 文档：新增 `docs/architecture/session-open-fast-path.zh-CN.md`（问题链路、交互契约红线、已实施改动、M2/M3/M4 设计与重写原则）；`docs/wiki/README.md` 增加导航；`docs/wiki/src/lib/README.md` 增加 `render-cache.ts` 与 `session-open-timing.ts` 条目；`docs/architecture/session-state-transactional-storage.zh-CN.md` 同步默认 5000。
- 明确不做：缓存 `react-markdown` 的元素树。remount 时 React 会为新 fiber 重新执行 `ReactMarkdown`，缓存元素对象无法跳过 parse + 插件流水线；真正解法是让会话切换不 remount（M3），不是缓存元素。该尝试已实施并回退，理由写在代码注释与架构文档里。
- 验证：定向 vitest 全部通过——render-cache 8、session-open-timing 5、project-config-read-cache 4、code-highlight 60、chat-math 10、mermaid-renderer 3、app-domain-hooks 14、chat-surface-behavior-alignment 10、chat-surface-css-contract 37、chat-surface-message-list 19、server-agent 138、routes/agent 44、agent-manager.persist-session-state 34、definitions 22、storage-config-split 8、storage-layer 15、storage.session-metadata-pin 2；`npx tsc -b` 通过；`npx eslint`（改动文件）0 error。
- Notes：M2（只读视图通道 `/api/sessions/:id/view` 不走 `restoreAgent`，`attachRuntime` 移出首屏关键路径）、M3（会话视图实例池 keep-alive，消灭 remount；需先归约 `ScrollAnchor` 再开窗口化，否则会改变「滚动到顶部」行为）、M4（`panel-decoration` 20+ 命令式注入器改为 React 兄弟节点）均未实施，设计与风险已写入架构文档。未新增/升级依赖；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 Git commit。

---

## compaction-divider-at-compacted-end（done，2026-10-21）

- Goal：用户要求「自动触发上下文压缩时，压缩线应该显示在对应位置（被压缩历史的末尾），而不是挂在对话上方」。
- 根因：`src/components/chat/panel-decoration/context-compaction.ts` 的 `alignBoundaryToUserTurn` 把服务端 `compactedUpToIndex` **向前回溯**到包含边界的用户回合，横线因此插在该轮用户提问之前。自动压缩默认 `keepRecentTurns=0`（`server/auto-compaction.mjs` 的 `tailStartForRecentTurns` 直接返回 `source.length`），边界 = 消息总数，回溯后落点永远是「最新一轮提问上方」——用户看到的横线不在压缩结束处。同时 `insertBeforeMessageElement` 在找不到目标行时 `messageList.prepend(notice)`，把横线挂到列表最顶部。
- 改动：`context-compaction.ts` 删除 `alignBoundaryToUserTurn`（及仅供它使用的 `isUserMessage`），边界直接用 `compactedUpToIndex - messageIndexOffset`；`insertBeforeMessageElement` 重写为 `insertNoticeAtBoundary`——按「边界之前的可见消息条数」定位插入行（边界落在 `toolResult` 等不单独渲染的消息上时自然插到其后第一条可见消息之前），边界在已渲染末尾之后时 `lastElement.after(notice)` 跟到最后一条消息之后，仅在完全无消息行时才 `append` 到列表末尾（不再 `prepend`）。`dataset.tailStart` 改名为 `dataset.boundaryIndex`。
- 测试同步：`tests/frontend/context-compaction-notice.test.ts` 假 DOM 增补 `lastElementChild` / `after` / `append`，用例预期从「对齐到用户回合之前」改为「紧跟被压缩历史之后」；原「边界=窗口末尾显示在最后一个用户回合之前」改为「跟在最后一条消息之后」，原「非 user 边界对齐回用户回合」改为「不回退到用户回合」（toolResult 边界）。7 passed。
- 验证：定向 `npx vitest run tests/frontend/context-compaction-notice.test.ts` 7 passed；`npx vitest run tests/frontend` 223 文件 / 2673 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过；`npm run lint`、`npm run build` 见本会话记录。
- boundaries：只改横线的定位规则；不动服务端压缩链（`server/auto-compaction.mjs`、`conversation-compaction.mjs`）与 `compactedUpToIndex` 语义，不动 `windowed-messages` 窗口语义、审批卡的 `findKeepBoundaryTarget`、样式表 `.quickforge-context-compaction-*`；未引入新视觉模式；未手工修改生成产物。

---

## dead-code-cleanup（done，2026-10-21）

- Goal：按审计结论清理全量死代码——确定死代码全删，仅测试可达的实现一并删除，完全下线会话级文件回滚能力。
- 改动（服务端）：`server/goal/prompts.mjs` 删 `_criteriaBlock`/`_evidenceBlock`/`goalPlanningPromptV2`/`goalWrapupPromptV2`/`scopeEntry` 与随之无用的 `attachmentBlock`/`escapeXmlAttribute`；`server/goal/state.mjs` 删 `isGoalActivation`/`isGoalRuntime`/`isGoalTerminalPhase`/`goalRoundsRemaining`/`goalProgressSignatureV2` 与常量 `GOAL_ACTIVATIONS`/`GOAL_RUNTIMES`（保留在用的 `isGoalPhase`/`isGoalActivePhase`）；`server/goal/errors.mjs` 删 `isGoalError`；`server/hooks/hooks-settings.mjs` 删 `DEFAULT_HOOKS_SETTINGS`；`server/utils/network.mjs` 删 `isTailscaleAddress`；`server/utils/scheduled-tasks.mjs` 删 `cronMatches`；`server/subagents.mjs` 删 `getSubagentDefinition` 与随之无用的 `subagentByName`；`server/ai-provider-options.mjs` 删 `DEFAULT_AI_STREAM_DEADLINE_MS`；`server/session-state-backup.mjs` 删私有 `planValuesDigest` 并把内部调用改走 `computeSessionSnapshotDigest`（该导出因此转为生产使用）。
- 改动（会话级文件回滚整链下线）：`server/routes/agent.mjs` 删 `GET /file-changes`、`GET /rollback-files/preview`、`POST /rollback-files` / `rollback-file`；`server/session-file-backups.mjs` 删会话级 `inspectEntry`/`inspectEntryState`/`inspectBatch`/`getSessionFileRollbackPreview`/`getSessionFileChanges`/`rollbackSessionFiles`/`rollbackSessionFile`/`selectRollback`/`rollbackSelection`/`readBackupContent` 及 `createTextDiff` 导入（写入侧 `backupFileBeforeWrite`/`recordFileAfterWrite` 与轮级链路保留）；`src/lib/server-agent.ts` 删 `getFileRollbackPreview`/`rollbackFiles`/`rollbackFile` 与 `isFileRollbackPreview`/`isFileRollbackResult`；`src/lib/server-agent-types.ts` 删 `ServerFileRollbackPreview`/`ServerFileRollbackResult`；`src/components/chat/file-rollback-state.ts` 只保留 `TurnRollback*`；`src/components/chat/FileRollbackDialog.tsx` 只保留 `TurnRollbackDialogContent`/`TurnRollbackDialog`；`src/lib/i18n.ts` 删 19 个仅会话级弹窗使用的 `fileRollback*` key（保留 23 个轮级共用）。
- 改动（其余前端死代码）：`tool-param-summary.ts` 删 `truncateSummary`；`workflow-run-detail.ts` 删 `workflowAgentStatusKey`/`workflowActiveAgentLabels`/`formatWorkflowDuration`；`indexeddb-cache.ts` 删 `isIndexedDbCacheAvailable`；`tool-artifacts.ts` 删 `extractCurrentTurnArtifacts` 与 `latestUserMessageIndex`；`message-queue.ts` 删 `clearStoredMessageQueueState`；`pinned-summary-drag.ts` 删 `clampPinnedSummaryPosition`；`browser-connection-diagnostics.ts` 删 `summarizeResourceEntries` 与随之无用的 `SummarizeResourceEntriesOptions`/`DiagnosticsSummary`/`queueMetric`；`chat-capabilities.ts` 删别名 `SIDE_CHAT_CAPABILITIES`；`workspace-tree-state.ts` 删别名 `loadedExpandedWorkspaceTreePaths`；`process-folding.ts` 删 `processGroupTargetIndex` 与 `ProcessGroupTargetSource`、`latestThinkingLine`；`input-clamp.ts` 删 `INPUT_CLAMP_TRANSITION_MS`（改注释说明 .22s）；`code-highlight.ts` 删 `HIGHLIGHT_LANGUAGES`；`hooks-settings.ts` 删 `DEFAULT_HOOKS_SETTINGS`。
- 改动（样式）：`src/index.css` 删 `.quickforge-model-sheet-section`（label 变体仍在用）、`.quickforge-goal-strip-duration`（44f75ee 删节点未删样式）、`.quickforge-file-rollback-single` 基样式+hover+响应式一行、`--qf-console-fade` 两处声明（从未被 var() 消费）及空壳规则 `.qf-console-block.border-destructive\/50`。
- 测试同步：`file-rollback-state`/`file-rollback-dialog`/`file-rollback-api` 三个测试只保留轮级用例；`session-file-backups.test.mjs` 重写为「写入侧 shadow backup journal + 轮级 rollback」，丢弃 37 个会话级用例；`routes/agent.test.mjs` 只留轮级路由；其余 14 个测试文件的对应断言改为使用现役函数名或直接删除；`code-highlight.test.ts` 的语言覆盖改用「每种语言必须产出有色 token」的真实样本（不再依赖被删的 `HIGHLIGHT_LANGUAGES`）。
- 验证：`npm run test` 393 文件 / 4534 passed、2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` exhaustive-deps warning）；`npm run build` 通过（仅既有大 chunk warning）。未提交 Git。
- Notes：保留项均属刻意：`resetStartupState`/`__resetSlashCatalogCacheForTests`/`terminateSessionStateWorkerForTests` 是测试隔离钩子；4 个 barrel 的 66 个「无消费者再导出」本次未动（本体全活，删 export 行属独立机械重构，避免混入本次语义删除）；`dist/` 为构建产物由 build 重新生成，未手工修改。

---

## docs-cleanup-stale-assets（done，2026-10-22）

- Goal：评审并清理仓库内过时的文档与资产，同时修复文档链接 bug。
- 改动（删除，共 71 个文件 + 4 个目录）：`docs/analysis/`、`docs/prototypes/`、`docs/reports/`、`docs/reviews/`、`docs/design/`（19 个已落地设计稿）、`docs/archive/goal-test-demo.md`；`docs/architecture/` 下 8 篇一次性设计/评审与被 v2 取代的存储 v1 文档（`session-storage-current-architecture`、`session-storage-recovery-runbook`、`session-sqlite-migration-design-review`、`session-storage-background-migration-design`、`sqlite-compatibility-spike`、`config-split-design`、`storage-cache-directory-design`、`scheduled-task-runs-shadow-integration`）及其 4 个 svg；`docs/wiki/src/lib/.git`（误建的空嵌套仓库）与 `.gitignore`；根目录误产文件 `0`/`new`/`nul`/`m[1])`/`$null`/`{try{require.resolve('jsdom')`、`.qf-agent-debug.log`、`.tmp-*` 分析残留、`review-01~06.png`。
- 改动（修复）：`docs/wiki/` 下 71 处相对链接层级错误（wiki 在深度 2/3，指向仓库根与 `src/`、`server/` 的 `../` 少一层）；`docs/wiki/README.md` 新增「架构与设计文档」导航表；`docs/wiki/src/README.md` 目录结构补 components/hooks/lib 子文档链接；`docs/architecture/session-*` 中 3 处指向已删文档的引用改指 `session-storage-v2.zh-CN.md`；`tests/frontend/code-highlight.test.ts` 注释去掉指向已删 parity 报告的路径；`feature_list.json`/`progress.md`/`session-handoff.md` 中指向已删报告的引用改为文字说明。
- 判据：markdown 链接反向图 + 全文引用扫描；被删项均为「零入链 + 自述已被取代/已执行完毕」或「已被实现取代的一次性设计稿」。
- 补充（同日第二轮）：`design/`（1 个动效 demo）、`design-review/`（6 个含 1 个 svg）整体删除，`design-mockups/` 删除 24 个零外部引用的旧设计稿（`assistant-reply-file-card`、`chat-task-launcher`、`diff-display-optimization`、`diff-odometer-counter*`、`execution-summary-groups`、`file-reference-mention`、`goal-inspector-optimization`、`goal-pinned-summary`、`goal-ux-ui-optimization`、`hooks-settings`、`message-queue`、`model-compact-icon-options`、`pinned-summary-capsule-expand-icon`、`pinned-summary-drag-capsule`、`safe-undo`、`scheduled-tasks-frequency`、`scroll-to-bottom-button`、`session-tail-status-indicator`、`subagent-marquee-roll-switch`、`subagent-running-indicator`、`subagent-tool-marquee-impl`、`todo-capsule-summary`、`todo-pending-icon-options`），保留 12 个仍被 `src/`、`docs/wiki`、`feature_list.json` 引用的设计稿（`design-mockups` 从 36 文件 1040KB 收敛到 12 文件 301KB）。
- 补充（引用修正）：`docs/architecture/logging-design.zh-CN.md` 误写为已不存在的 `logging-design.md`；`docs/architecture/agent-plugin-system.zh-CN.md` 的 hooks 能力表指向不存在的 `server/plugins/events.mjs`、`server/plugins/hooks.mjs`，改为复用实际存在的 `server/hooks/hook-engine.mjs`、`server/hooks/hook-executor.mjs`；`design-mockups/goal-plan-tool-card-redesign.html` 注释里对已删 `todo-capsule-summary.html` 的引用改为文字描述。
- 验证：脚本复核 docs 内 0 失效链接、0 孤立文档（仅 3 个 `docs/archive/*` 状态归档按机制无需入链）；`feature_list.json`/`package*.json`/`tsconfig.json` JSON 解析通过；`npx vitest run tests/frontend/code-highlight.test.ts` 60 passed；`npx eslint` 该文件通过；`npx tsc -b` 通过。
- Notes：未触碰生成产物（`dist/`、`package-dist/`、`package-offline/`）；未提交 Git。剩余 `design-mockups/` 的 12 个文件均有 `src/` 或 wiki 引用，属活跃设计参照。`.agentbridge/`、`.playwright-mcp/`、`.zcode/`、`.idea/` 为本地工具缓存且已被 `.gitignore` 忽略，可按需手动清理（约 320KB，不影响仓库）。

---

## settings-search-autofill-guard（done，2026-10-21）

- Goal：防止设置页搜索框偶发被浏览器自动填充历史网址、账号等。
- 改动：`SettingsWorkspacePage` 提取 `SETTINGS_SEARCH_INPUT_PROPS`，桌面与移动搜索框统一加 `name="qf-settings-search"`、`autoComplete="off"`、`autoCorrect="off"`、`autoCapitalize="off"`、`spellCheck={false}`；`LanAccessSettingsTab` 的局域网密码与 `CustomProvidersSettingsTab` 的 API Key 分别补 `name` + `autoComplete="new-password"`；`settings-workspace-react.test.ts` 新增输入框属性与源码契约断言。
- 原因：原输入框无 name/autocomplete，Chromium 的自动填充/表单历史会按启发式猜测字段并向其中填值。设置页还包含 `type=password` 的局域网密码、API Key 输入，且相关 tab 常驻挂载，Chromium 会把整页当登录表单，并把最前面的搜索框猜成用户名框，出现搜索框填网址/账号、密码框填密码。
- 验证：定向 vitest 15 passed；`npx eslint` 改动文件通过；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有大 chunk warning）。未跑全量 test；浏览器自动填充无实机复现，仅做属性层修复。
- Notes：若个别浏览器/密码管理器仍强行填充，可再叠加 `data-1p-ignore` / `data-lpignore="true"` / `data-bwignore`，或改用只读至聚焦的方案；当前先采用标准属性。无依赖变更；未修改生成产物；未提交 Git。

---

## appearance-settings-preview-redesign（done，2026-10-21）

- Goal：用户认为设置页分组方案里的外观设计稿更好看，要求把实际外观页调整成设计稿风格。
- 改动：`AppearanceSettingsTab` 主题选择从分段按钮改为两张主题预览卡片（浅色/深色迷你侧栏 + 内容区 + 气泡，固定明暗配色），选中态用边框 + 勾选圆点；字号独立成组，保留滑杆与 px 值；新增“对话预览”卡片，头部使用界面字号、消息使用对话字号实时预览。
- 样式/文案：`index.css` 新增主题卡片、迷你预览、分组说明、对话预览样式；移动端主题卡片单列；`FontSizeSlider` 补 `ariaLabel`；i18n 补 `fontSize`、`appearancePreview`、预览用户/助手文案中英文案。
- 范围：主题/字号持久化与即时应用逻辑不变；不改后端/API/依赖；纯设置页视觉与预览增强，docs/wiki 无需更新。
- 验证：定向 vitest 4 文件 30 passed（appearance 3、settings-workspace 13、default-options 13、network-proxy 1）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Vite dev + Chrome CDP 1440×900 明暗主题与 390×844 移动端验证主题卡片选中、迷你预览、字号滑杆、实时对话预览，无 console error。
- Notes：未提交 Git；build 正常重生成 `dist/`，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## settings-grouped-navigation（done，2026-10-21）

- Goal：用户认为设置页 16 个标签页平铺过多，要求参考 Codex 等主流设置页做分组优化，并在两轮反馈后压缩为 3 个分组。
- 改动：`settings-tabs.ts` 增加 `group`/`keywords` 元数据并派生三组（基础 / AI 与扩展 / 自动化与数据）；`SettingsWorkspacePage` 按组渲染桌面与移动导航，新增设置搜索（按名称/描述/关键词/组名过滤，选择后清空，Escape 可清空）、关于置底；新增 `data`/`network` 状态保留 tab。
- 数据/网络：新增 `DataSettingsTab`（备份与恢复 / 已归档对话 / 分享链接子标签，首次访问后保持挂载，`active` 向下转发；分享链接页增加 `embedded`/`active`，隐藏重复标题并在重新激活时刷新）；新增 `NetworkSettingsTab`（局域网访问 + 从 `DefaultOptionsSettingsTab` 提取的 `NetworkProxySettingsSection`），`DefaultOptions` 移除代理逻辑并按基础/交互/上下文管理/终端四段展示。
- 文案/视觉：常规 → 通用、自定义模型 → 模型与提供商；补三组标签、搜索、空结果、数据管理与网络设备中英文案；`index.css` 增加设置分组标题与页内子标签样式；保留现有轻量分割线、淡选中态与圆角语言。
- 测试：更新设置注册表/导航用例（14 个 key、三组顺序、搜索过滤与选择后清空、data/network active 转发、状态保留），新增 `network-proxy-settings-react.test.ts` 验证 active 加载与连续刷新；代理刷新用例从 default-options 测试移出。
- 验证：定向 vitest 3 文件 27 passed；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Vite dev + Chrome CDP 实机 1440×900 和 390×844 验证三组导航、搜索“代理/备份”、数据管理三子标签与状态保留、网络与设备、模型与提供商重命名，无 console error。
- Notes：全量 `npm run test` 两次各出现 1 个既有 `tests/server/scheduled-tasks.commands.test.mjs` 随机失败（两次用例不同，单文件 24 passed），判定为并行 SQLite 抖动，与本次前端改动无关；未提交 Git；build 正常重生成 `dist/`，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## new-chat-project-row-branch（done，2026-10-21）

- Goal：新建对话底部项目行去掉整条背景块，项目本身默认无底色；分支紧贴项目显示（有则显示），并可复用分支选择菜单切换/新建分支。
- 改动：`NewChatProjectPicker` 新增 `branch` 与 `branchMenu`（projectId/dirtyCount/onCheckout/onCreated/onOpenGraph/onOpenChanges），项目 chip 后渲染分支按钮，点击经 portal 复用 `GitBranchMenu`（fixed 定位到分支上方，按视口收敛宽度/高度，外部点击或 Escape 关闭，切换后关闭）；`App.tsx` 传入 `titleGitStatus` 分支与既有 `handleCheckoutTitleBranch`/`handleBranchCreated`、Git 图谱与变更入口；`index.css` 移除 trigger 背景/圆角，chip 默认背景改 `transparent`（hover/focus 才显示），分支改为紧邻布局并带 hover/展开反馈。
- 范围：只改新建对话空状态项目行及其分支菜单复用；项目选择弹层、正常会话 composer 与 header 分支入口不变；未自动执行真实分支切换；无依赖变更；未手工修改生成产物；模块职责未变，docs/wiki 无需更新。
- 验证：定向 vitest 3 文件 43 passed（picker 4、分支菜单 jsdom 交互 2、css-contract 37）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 通过；Chrome CDP 实机 1400×900 与 390×844：chip/trigger 背景 `rgba(0,0,0,0)`、分支紧邻项目约 9px，菜单含分支列表/未提交更改/新建分支/Git 图谱、不超出视口、Escape 可关闭。未跑全量 `npm run test`。

---

## composer-pasted-text-tile-radius（done，2026-10-21）

- Goal：用户反馈输入框粘贴大段文本时，文本附件显示为圆形，不符合设计语言，要求与界面整体圆角对齐。
- 根因：`.quickforge-composer button { border-radius: 999px !important; }` 是给 composer 内图标按钮用的统一全圆规则；粘贴文本生成的附件 tile 主体也是 `<button>`，被该规则覆盖成圆形，而消息区同名 AttachmentTile 保持 `rounded-lg`。
- 改动：`src/index.css` 在全圆按钮规则后新增 `.quickforge-composer .qf-attachment-tile button:not(.qf-attachment-tile-remove)`，显式使用 0.5rem 中等圆角；`AttachmentTile.tsx` 给删除按钮补 `qf-attachment-tile-remove` 类，使其继续使用全圆。
- 范围：只影响 composer 内附件 tile 圆角；消息区附件、图片/PDF 预览、删除按钮交互均不变；未新增依赖；未手工修改生成产物；纯样式调整，无需更新 wiki。
- 验证：浏览器实机在 composer 粘贴 3200 字符生成文本附件，计算样式 tile 7px（根字号 14px 下的 0.5rem）、删除按钮 999px；定向 vitest 3 文件 69 passed；`npx eslint src/components/chat/surface/AttachmentTile.tsx` 通过；`npm run build` exit 0，产物 CSS 含新规则。

---

## workflow-summary-single-line-marquee（done，2026-10-21）

- Goal：用户反馈 run_workflow 折叠头右侧的运行中摘要会换行，要求固定单行、溢出滚动。
- 根因：`run_workflow` 摘要行通过 `renderToolMarquee(..., 'quickforge-workflow-marquee')` 渲染跑马灯，但 `src/index.css` 的 `.quickforge-workflow-marquee` 只设置了 `flex: 1 1 auto; min-width: 0`，缺少单行/定高/双视图绝对定位/隐藏 moving 视图的规则。custom element 因此按普通块级文本换行，且 static 与 moving 两份文本同时可见；640px 列宽下折叠头被撑到 55px（3 行）。
- 改动：为 `.quickforge-workflow-marquee` 补齐 `inline-flex`、`flex: 1 1 auto`、`min-width: 0`、定高 `1.125rem`、`overflow: hidden`、`white-space: nowrap`、mono 0.75rem，并补 `.quickforge-marquee-view` 绝对定位、`.quickforge-marquee-static` 省略号、`.quickforge-marquee-moving` 默认 `display: none`。复用现有 `ToolMarqueeController`：剩余槽位内溢出才横向滚动，短文本静止，`prefers-reduced-motion` 退化为省略号。
- 范围：只改 workflow 折叠头；内嵌工具行本就单行横滑，`run_subagent` 摘要行行为不变；`workflow-tool-renderer.tsx` 结构未动。
- 验证：定向 vitest 3 文件 56 passed（workflow-renderer 14、workflow-step-interaction 5、chat-surface-css-contract 37）；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；构建 CSS 静态复测 640px 列宽下摘要行 18px 单行、长文本溢出 205px 可滚动、moving 默认隐藏。
- Notes：未提交 Git；build 正常重生成 `dist/`，未手工修改生成产物；无依赖变更。

---

## workflow-inner-tool-open-memory-isolation（done，2026-10-21）

- Goal：用户反馈 run_workflow 展开体里的内部 tool 调用看起来默认展开，希望默认收起。
- 根因：内层 `WorkflowToolCallRow` 与外层 `run_workflow` 卡都在同一个 `.qf-tool-message` 宿主内，`ToolDetails` 默认按最近宿主的 toolCall id 记忆开合。外层卡手动展开一次后，内层行在流式刷新、新增步骤或重挂载时读到同一个 `true`，于是自动展开；反向内层展开也会污染外层卡记忆。
- 改动：`ToolDetails` 新增可选 `stateKey`（显式 key 优先于宿主 toolCall id，空字符串表示不记忆）；`WorkflowToolCallRow` 传入 `workflow:${runId}:tool:${id}`，外层卡保持原 key。补 `tool-renderer-shared-state.test.ts` stateKey 单测与 `workflow-step-interaction.test.ts` 两条交互回归：外层展开后新增/重渲染内层仍收起；内层展开不污染外层，重挂载后各自恢复。
- 验证：`npm run test` 390 文件 4689 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；`npx tsc -b --pretty false` exit 0；定向 3 文件 36 passed。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常重生成 `dist/`）。

---

## workflow-agent-live-detail-parity（done，2026-10-21）

- Goal：用户反馈“workflow 点击 subagent 跳转后不能实时看到内部 tools 调用，显示与内部细节不一致，有时看不到 detail”，要求与 run_subagent 卡片保持一致、按最佳体验实现而非最小改动。
- 根因：① `run_workflow` 的 SSE 只更新聊天卡片，未像 `run_subagent` 那样实时写入 `subagentRunStore`，已打开详情不刷新；② 点击时用当前渲染帧覆盖 store，打开的是陈旧快照；③ 服务端 details 总量超 100KB 会把所有 Agent 的 trace 一起丢掉；④ `compactSubagentRunDetails` 从最旧消息逐条丢，容易拆散 toolCall/toolResult，且窗口化后与 run_subagent 显示不一致。
- 实时通路：新增 `src/lib/workflow-agent-run-events.ts`。`ServerAgent` 在 `tool_execution_start/update/end` 直接调用发布器，以 `${workflowRunId}:agent:${id}` 稳定 runId 将每个 Agent 映射为 `SubagentRunPayload` 写入全局 store；重连时以 `details.workflow === true` 兜底识别；终态不被迟到的 running 帧回退；缓存有界（120）。
- 载荷一致：重写 `workflow-subagent-detail.ts`，复用导出的 `subagentRunStatus` / `subagentRunError`；trace 经同一个 `subagentProcessTraceMessages`；timing 使用 Agent 真实 `startedAt`；缺 trace 时回填上一次可见载荷并标 `traceDropped`；input 增加 phase，details 保留摘要与 agent.error；任务说明取 `promptPreview`，并透传 `context` / `expectedOutput`（服务端 bounded 2,000 字符，预算超限缩到 400），与 run_subagent 详情的 task/context/expectedOutput 同构。
- 打开一致：`workflow-tool-renderer.tsx` 点击优先取 store 最新快照，只有历史恢复/首帧无快照时才用渲染帧并 publish；Agent 行构建载荷时传入 store previous；行状态/耗时改为统一 payload 推导（与 run_subagent 摘要卡同源）。Composer 的“运行中 subagent”指示器在 `run_workflow` 仍 pending 时按 `${toolCallId}:agent:` 前缀列出嵌套 Agent，点击打开同一 store 快照。
- 卡片复用：`WorkflowAgentRow` 不再复制 `run_subagent` 的按钮标记，直接调用 `subagent-tool-renderer.tsx` 的 `renderSubagentRunSummary`；workflow 只追加 meta/错误悬停文案与历史回填发布（onOpen），状态/耗时/跑马灯/点击打开事件完全同源。
- 服务端预算：运行中 details 240K、终态 500K；日志独立 50K；单 Agent 运行中 50 条/80KB、终态 200 条/200KB；单条 text/toolCall/thinking 2000、toolResult.details 4000；新增 `sliceMessagesWithToolPairs`（配对窗口）与 `dropOrphanToolResults`；批量 10 条缩减避免二次方 stringify；按 Agent 优先级裁剪（done 先、running 最后），先缩到 10 条/20KB，再整体移除并标 `subagentRunDropped`；不再因总量超限丢掉所有 Agent trace。
- 透明提示：`SubagentRunPayload.traceDropped` 纳入指纹与 body blocks；详情页新增 `subagentTraceTruncated` 中英文案与 `traceNotice` 块，被服务端裁剪时明确提示“过程记录不完整”，同时保留最后一次可见 trace。
- 测试：新增 `tests/frontend/workflow-agent-run-events.test.ts`（实时发布与增量、dropped 回填、终态不回退、忽略非 workflow）；`workflow-step-interaction.test.ts` 新增“store 领先渲染帧时点击打开最新 running 快照”；`subagent-running-indicator.test.ts` 新增“pending run_workflow 下列出嵌套运行 Agent”；`agent-workflow-runner.test.mjs` 新增终态完整尾部、toolCall/toolResult 配对窗口、总预算超限保留最新 Agent trace，并断言 context/expectedOutput 透传；`workflow-renderer.test.ts` 契约改为断言 Agent 行调用 `renderSubagentRunSummary`（不再复制卡片标记）。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md` 同步预算表、`detailsTruncated`/`subagentRun`/`subagentRunDropped`、Agent record 的 prompt/context/expectedOutput、7.3 实时详情通道与 Composer 指示器、测试清单与相关文件；`docs/wiki/src/lib/README.md` 新增发布器条目并同步 subagent 载荷/面板块与 store list；`docs/wiki/server/README.md` 同步 details 预算与裁剪优先级；`docs/wiki/src/components/README.md` 同步 Composer 指示器覆盖范围。
- 评审补强（2026-10-21）：① 服务端 `trimSubagentTraces` 部分缩容时标 `subagentRunTruncated`，前端把它与 `subagentRunDropped` 一致对待：保留最后一次可见的更长 trace 并显示“过程记录不完整”，终态装得下时自动恢复完整过程，不再静默缩掉用户已看到的工具卡。② `WorkflowAgentRow` 用 `shouldPublishSubagentRunPayload` 在 effect/onOpen 安全回填 store：历史首帧、或 SSE 断连漏掉结束帧导致 store 仍 running 而渲染帧已终态时修正，已有终态不被覆盖；发布器 previous 改为优先取 store、再回落本地缓存，避免渲染层已修正的完整 trace 被迟到帧缩回旧缓存。③ 日志预算改为从最新往前保留至多 50 条且累计 ≤50K，修正“50 条大日志仍可超 50K”的口径。新增 4 个回归用例（部分缩容保留长 trace、store 优先回填、终态渲染修复 stale running、日志累计预算）。
- 验证：`npm run test` 390 文件 4685 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0；`npx tsc -b --pretty false` exit 0；定向 6 文件 172 passed。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 正常重生成 `dist/`）。已持久化的旧 workflow 结果没有实时 trace，需重跑一次。未做浏览器实机验证。

---

## goal-v2-dsh-round-driver（done，2026-10-19）

- Goal：用户反馈 Goal 执行中会不必要阻塞、恢复时显示"正在收尾运行"。根因是 v2 runner 保留了太多 QuickForge legacy 逻辑。完全对标 DSH 重写 round driver。
- 删除的 legacy 逻辑：规划阶段（goal_report plan）、证据门禁（criteria+evidence 检查）、防空转检测（no_progress）、重复失败暂停（repeated_failures）、`goalRunSettling` 结算屏障。
- DSH 对标行为：每轮都是执行轮（objective + round number）；轮次正常结束 → complete/blocked 停止，否则直接下一轮；错误 disarm 不重试；轮次上限 block `round_limit`；`update_goal complete` 在执行轮内直接生效（无证据检查）；`/goal <objective>` 创建后返回文本响应，driver 通过 setImmediate 启动第一轮。
- Round 提示词改为 DSH 式 `<goal_round>`（objective + round + 继续工作指令），不含 criteria/evidence。
- 验证：`npm run test` 389 文件 4672 passed / 2 skipped；`npm run lint` 0 error；`npm run build` exit 0。定向：v2 manager 6 passed（round limit、update_goal complete、create_goal、pause/resume/clear、重启 disarmed）。

---

## workflow-subagent-trace-budget（done，2026-10-19）

- Goal：workflow 里点进 Subagent 详情，工具过程应和直接 `run_subagent` 一样可见。
- 根因：`compactSubagentRunDetails` 把每个 Agent 的 `subagentRun` 压到 6KB。元数据占掉大部分后，从最旧消息丢起，一次 toolCall + toolResult 先被丢掉，详情页只剩最终回复。
- 改动：单 Agent trace 上限改为 80KB、最近 50 条（与直接 subagent 的运行期 trace 截尾一致）。单条文本仍 1000 字符，toolResult.details 仍 2000 字符。`workReport` 继续关闭，编排脚本只拿最终文本。整份 workflow details 超过 100KB 仍会丢 `subagentRun`。
- 验证：见本轮 `tests/server/agent-workflow-runner.test.mjs`。
- Notes：未提交 Git；未手工修改生成产物。已持久化的旧 workflow 结果没有这份 trace，需重跑一次才能在详情里看到工具卡。

---

## latest-code-review（reviewed，2026-10-19）

- 范围：未提交 diff（workflow 内部行对齐、运行中 subagent trace）+ 已提交 Goal v2 / `run_workflow`。只读评审，未改产品代码。
- 确认问题：Goal v2 执行轮可用 `update_goal complete` 直接完成，`service.complete(..., { by: 'user' })` 不走 `checkGoalCompletionV2`。测试 `lets the model complete from an execution round through update_goal` 明确允许无证据完成。`goal_report complete` 仍要求证据、正常轮末和持久化。工具说明、`prompts.mjs` 与 wiki 把证据路径写成完成方式，和这条旁路不一致。
- 风险：workflow 内部 `ToolDetails` 与外层卡共用 `.qf-tool-message` 的同一 toolCall id 记忆。展开内部工具行会把外层 `run_workflow` 卡的开合状态一起记住，流式重挂载后两者同步打开或收起。
- 风险：`trimDetails` 先截断 agent 预览，超限才丢 `subagentRun`。大 trace 会先牺牲已完成 Agent 的结果预览；截断后的 trace 仍计入体积，可能继续触发丢弃。
- 未改：内部工具行没有外部卡的 diff/预览/终止按钮；`run_workflow` 仍排除在过程折叠组外。这是对齐范围取舍，不是回归。
- 验证：定向 vitest 9 文件 exit 0（5.2s）；定向 eslint + `npx tsc -b --pretty false` exit 0（17.6s）。未跑全量 test/lint/build。

## workflow-inner-tool-parity（done，2026-10-19）

- Goal：workflow 展开体内的工具行、Agent 行与外部普通工具卡、sub-agent 卡保持同一套交互。
- 工具行：改为 `quickforge-local-tool` 的 `ToolDetails`。摘要是图标 + 名称 · 参数 + chevron + 状态/耗时；运行中隐藏状态并加 running sweep；点击展开 `input`/`output`，`run_command` 仍用控制台块。
- Agent 行：改为 `quickforge-subagent-tool` 整行按钮。Bot 图标 + 状态文案 · profile/工具次数/schema；运行中显示当前工具跑马灯并隐藏状态；点击打开 Inspector 运行详情。
- 删除内部专用的步骤 chevron、状态圆点、external-link 与「查看运行详情」按钮及其 CSS。
- 验证：定向 vitest 2 文件 14 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- 后续：工作流结果改为默认收起的 `<details>`，点击标题才展开。
- 后续：workflow Agent 详情对齐外部 subagent。运行中也写入有界 `subagentRun`；toolResult 保留 `details`（耗时、diff、命令状态）；详情 `detailed` 跟随当前工具显示模式，不再强制展开。
- Notes：未提交 Git；未手工修改生成产物。刷新前端后才会看到新行。

---

## goal-tool-card-display（done，2026-10-19）

- Goal：把 `get_goal`、`create_goal`、`update_goal` 从带边框的默认工具卡改为与 `goal_report` 一致的无边框只读折叠卡片。
- 实现：新增 `src/lib/goal-tool-history.ts` 与 `src/lib/tool-renderers/goal-tool-renderer.tsx`；`local-tools.ts` 导入时注册三个工具。摘要显示读取/创建/更新、动作、phase 和目标；展开显示目标、阶段、activation、轮次和阻塞原因。完整 JSON 仅详细模式可见。
- 边界：不改变 Goal 工具行为、权限、状态机或服务端返回结构，也不改 Goal 条带和 Inspector。卡片不提供操作按钮。
- 字号：`goal_report` 与 get/create/update goal 的展开结果统一为消息字号 ×0.8，和普通工具正文一致。
- 验证：`npx vitest run tests/frontend/goal-tool-renderer.test.ts` 11 passed；定向 eslint exit 0；`npx tsc -b --pretty false` exit 0。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。运行中的前端需刷新后才会加载新卡片。

---

## goal-v2-event-sourced（done，2026-10-19）

- Goal：按 DSH 式持久状态骨架完整实施 Goal v2，同时保留 QuickForge 的只读规划、criteria、工具证据与服务端完成门禁；新目标默认 v2，旧 13 状态会话保留 legacy 引擎。
- 服务端：新增 `server/goal/{state,store,service,errors,prompts,report-tool,tools,authority,runner,engine}.mjs`。4 个持久 phase + 进程本地 armed/disarmed + 派生 runtime；`goal/change` 事件日志严格 fold 与 tombstone；全量 `{id,revision}` CAS；规划轮不占 execution round；`goal_report complete` 只写 `pendingCompletion`/`verifying`，runner 在正常轮末持久化后提交 `complete`；`get_goal`/`create_goal`/`update_goal` 对 v2 会话常驻，模型可从直接人类轮次自动创建/编辑/暂停/恢复（`server/goal/authority.mjs`），goal 轮完成仍走 `goal_report` 证据，直接人类可用 `update_goal complete` 强制完成。`agent-manager` 改注入 `goal/engine` 并 `await beginGoalRun`；`agent-persistence` 持久化 `goalEvents`/`goalEngine`；restore 保留 v2 active+disarmed，旧快照 `migrateLegacyGoal` 转换（failed/cancelled → tombstone）。
- 命令与设置：`/goal` 支持裸状态、`edit/pause/resume/clear`；动作命令不产生模型轮次。`goal-settings` 增加 `engine`（默认 v2），设置·常规页新增「Goal 引擎」选择；`QUICKFORGE_GOAL_ENGINE` 可覆盖。`tests/setup-goal-engine.mjs` 让历史测试默认 legacy，v2 专项测试显式 `goalEngine:'v2'`。
- 前端：`src/lib/goal.ts` 增加 `phase/activation/runtime/plan/maxRounds/roundsStarted/blockerInfo` 归一化与 v2 helpers；`goal-control-strip.ts` 对 v2 显示 phase/轮次与目标第二行、active+disarmed 显示“已中断”、complete 隐藏；`goal-card.ts` 与 Inspector/Summary 复用 v2 投影；i18n 中英新增 phase 文案；设置页与 normalizer 同步 engine。
- 验证：`npm run test` 388 文件 4672 passed / 2 skipped；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npm run build` exit 0。定向：v2 state/store/service 24 passed、v2 manager 6 passed（规划→执行、证据完成屏障、执行轮 update_goal complete、模型直接人类创建 goal、pause/resume/clear、重启 active+disarmed、active-disarmed resume）、legacy goal 7 文件 211 passed。
- Notes：未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。v2 的 `failed/cancelled` 不再作为 phase，由 tombstone `lastRun.outcome` 表达；legacy 代码保留用于旧快照与设置回退。测试目录 `tests/setup-goal-engine.mjs` 默认 legacy 以保留历史契约。

---

## run-workflow-scripted-orchestration（done，2026-10-19）

- Goal：按用户要求以 workflow 模式为 QuickForge 增加接近 DSH workflow 的脚本化多 Agent 编排能力（`run_workflow`），并完成测试、文档与全量验证。
- 服务端新增：`server/agent-workflow-runner.mjs`（参数/预算校验、worker 生命周期、resourceLimits、总 deadline、父 signal 传播、有界 Agent 队列、agent 失败降级 `null`、TypeBox `Value.Check` JSON Schema 校验、details 构建与 100KB 文本裁剪、失败/超时/中止时 queued/running Agent 统一标记 `aborted`、已完成 Agent 摘要附加到错误正文）；`server/agent-workflow-worker.mjs`（worker_threads + vm guest bridge：hooks 在 guest 内创建，`args` 以 JSON 字符串进入并在 guest 内解析/深冻结，唯一 host 函数 `__hostCall` 为 null-prototype 且在用户脚本编译前删除，host 回复只以 JSON 字符串经 guest pump 投递；`console` 置空、`codeGeneration.strings/wasm` 关闭、同步段 10s、结果 `structuredClone` + `JSON.stringify` ≤1MB）。
- 复用与接线：`agent-subagent-runner.mjs` 新增 `runWorkflowSubagent`（命名 Profile、按步覆盖 model/预算、schema hint、trace/workReport 关闭）并抽取 `executeSubagentRun`，补 setup 期 abort 检查与审批 signal 绑定；`agent-manager.mjs` 增加 `wrapWorkflowToolDefinition`、`includeWorkflowTool`（Subagent/Profile 关闭）、默认权限审批分支、`afterToolCall` 注入失败 details；`tools/definitions.mjs` 增加 `workflowTool`；`approval-store.mjs` 纳入 `/plan` 与 `allowSubagents:false` 限制；`routes/tools.mjs` 禁止直接 REST；`system-prompt.mjs` 增加使用引导。
- 默认行为与安全：默认权限下启动前展示**完整脚本**（脚本上限 20KB）并审批一次，`effectiveConcurrency=1` 串行执行，避免前端单槽位审批卡被并发覆盖；完全访问才使用配置并发。风险说明明确“以服务进程权限运行本地 JavaScript”；worker 隔离仍是可终止性/纵深防御，不是 OS 沙箱，审批是信任边界。工作流 step 的 pending 审批额外监听步骤 signal，超时/中止立即 reject，不再等 5 分钟审批超时。
- 前端：新增 `src/lib/workflow-run-detail.ts`（状态/阶段/Agent/日志/计数/当前阶段/i18n key）、`workflow-tool-renderer.tsx`（摘要行 + 跑马灯 + 阶段分组 + 可点击步骤行 + 结果/脚本/错误 + preparing/无 details 终态错误回退）、注册/图标/标题刷新；i18n 中英 32 键；`index.css` 增加 `quickforge-workflow-*`（正文跟随消息字号、Agent 结果 6rem/结果 16rem 内滚、运行点动画 reduced-motion 关闭）；approval-card 增加 `runWorkflow` 标签、workflow 来源本地化徽标与风险说明。视图状态先判 `aborted` 再判 `result.isError`，用户停止不再显示为失败。
- 审查修复（workflow 模式的只读审查发现）：guest bridge 阻断 `agent.constructor` / `args.constructor` 等 host 原型逃逸（测试覆盖）；审批展示完整脚本而非 4000 字符预览；默认权限串行避免并发审批互相覆盖；超时/中止/孤儿 Agent 不再残留 `running`；setup 期 abort 与审批 signal 中止；无 details 的终态错误不再永久显示“正在准备”；details 总文本 100KB 裁剪；CSS 字号选择器修正；`schema:false` 与 schema hint；worker resourceLimits。
- 迭代②（tool() 工具步骤 + QuickForge 交互适配，2026-10-19）：新增 `server/agent-workflow-tools.mjs`，`tool(name, args?, options?)` 复用 `createServerTools` 的会话工具集（排除 subagent/workflow/ask_user/todo/memory/goal_report）、命令权限与 workspace 沙箱，默认权限下按 `safeReadTools`/Skill 免审批、其余走 `createApprovalPromise`（source `workflow-tool`，监听步骤 signal），写入归因父会话；拒绝 `run_command run_in_background`。Runner 将 Agent 与工具合并到同一有界步骤队列（`activeSteps`），新增 `maxTools`（默认 64/上限 128）、`toolCount`/`failedToolCount`/`tools` details 与 `seq` 提交序号；worker 新增 `tool` 协议与 guest hook；前端 `workflow-run-detail.ts` 归一工具、按 `seq` 交错 Agent/工具，`workflow-tool-renderer.tsx` 新增可点击步骤行：每个 Agent/工具行是独立 `<details>`（默认收起，点击摘要展开任务/参数与结果，chevron 旋转；run_command 结果用控制台块、其余用代码块），摘要行含工具图标/本地化名称/`summarizeParams`/状态/耗时；参数 JSON/脚本/原始 details 只在详细模式显示。CSS 适配 QuickForge 工具摘要交互（单行横滑/隐藏滚动条/H5 touch、消息字号、running sweep、aria-busy、focus-visible、reduced-motion），i18n 新增工具计数/参数/结果/任务键（中英共 32 键），审批卡 `workflow-tool` 显示 Workflow 徽标。`run_workflow` 与 `run_subagent` 一样不进入 process-folding 工具摘要组，保持顶层可点击卡片；新增 `workflow-step-interaction.test.ts` 用真实 React DOM 验证外层/步骤两级展开互不干扰。Agent 行新增 external-link 入口与展开体「查看运行详情」按钮，经 `workflow-subagent-detail.ts` 构建 `SubagentRunPayload` 并派发 `OPEN_SUBAGENT_RUN_EVENT`，进入 Workspace Inspector 的 Subagent 运行详情；runner 在 Agent 完成/失败时持久化有界 `subagentRun`（最近 40 条消息、tools、allowedTools、model/thinkingLevel，单 Agent≈6KB，超限标记 `subagentRunDropped`）。
- 文档：新增 `docs/architecture/workflow-orchestration.zh-CN.md`（背景、架构、hooks、限制、失败语义、安全模型、details/UI、测试清单），同步 `docs/wiki/README.md`、`server/README.md`、`server/tools/README.md`、`src/lib/README.md`、`src/components/README.md` 与根 `README.md`。
- 验证：本 feature 定向 9 文件 174 passed（workflow runner 26、approval orchestrator 23、subagent 集成 18（含真实 `tool("read_file")` 与 `run_in_background` 拒绝）、approval-store 16、definitions 22、workflow-renderer 13、approval-card 7、process-folding 48、workflow-step-interaction 1）；`npx tsc -b` 通过；`npm run lint` exit 0（仅既有 GitToolsPinnedSummary warning）；`npm run build` exit 0（既有 externalized/大 chunk warning）；`npm run test` 全量 388 文件 4675 passed / 2 skipped（exit 0，含同工作区已收敛的 Goal v2 改动）。
- Notes：未提交 Git。未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 仅正常重生成 `dist/`）。工作区既有未跟踪临时文件 `0`、`m[1])`、`new`、`{try{require.resolve('jsdom')` 未纳入。默认权限串行是产品取舍：并发审批需要前端多槽位队列，留作后续；完全访问不受影响。同一工作区存在并行 Goal v2/scheduled 改动（`server/goal/**`、`src/lib/goal.ts`、`goal-control-strip.ts`、`server/goal-settings.mjs`、`server/routes/scheduled-tasks.mjs` 等）；该并行改动已收敛，全量 4675 passed，本 feature 未触碰其文件。

---

## dead-code-cleanup-round3（done，2026-10-16）

- 目标：按死代码评审清理高置信度 A 区僵尸代码。
- 已清理：`runIcon`、`sliderProgressStyle`、`CHAT_SURFACE_REFRESH_EVENTS`；i18n 中英各删除 `displayLanguage`、`openLocalFile`、`execute`、`taskScheduleSavePreview`、`taskList`、`artifacts`；删除 capability-suggestions 专属 CSS 与 message-queue 死查询项；删除已确认无源码/测试消费者的 settings/context/project picker CSS。
- 复核保留：`server/session-state-service.mjs` 的 `readSessionIdentityRows` 是 `storage.mjs` 动态 facade 接口，不能删除；`quickforge-tool-message` 有 CSS 契约测试，不能按源码无创建方误删；K8 安全预留、B/C/D 灰色项未处理。
- 文档：Wiki `openLocalFile` 示例改为仍在使用的 `openLocalFileWithPath`；评审报告同步实际清理结果和误报修正。
- 验证：定向 vitest 6 文件 96 passed；`npx tsc --noEmit` 通过；`npm run lint` 通过（1 个既有 GitToolsPinnedSummary warning）；`npm run build` 通过；`git diff --check` 通过。
- 边界：工作区同时存在用户此前 channels-removal 等未提交改动，本次未覆盖或回滚；未提交。

---

## channels-removal（removed，2026-10-16）

- 目标：应用户要求**彻底移除**设置中的「渠道」功能（微信 weixin-acp bridge、渠道 API/SSE、sessions-changed 事件链、channelId/channelName 字段与渠道 Tab），且不影响 ACP、分享、通知、跨标签同步等其他功能。
- 用户确认的两个决策：sessions-changed 死链一并删除；存量渠道会话标题前缀（channelName）一并移除（旧会话标题退化为纯标题，持久化字段成为无主数据被读侧忽略，无需迁移）。
- 删除文件：server/channels/**（registry/process-channel/channel-logs/event-relay/providers/wechat）、server/routes/channels.mjs、src/components/settings/tabs/ChannelsSettingsTab.tsx、tests/server/channels/**、tests/server/routes/channels.test.mjs、tests/server/agent-manager.channel-{sync,source,events}.test.mjs、tests/server/acp/server-channel-source.test.mjs（共 15 个专用文件）。
- 服务端清理：server/index.mjs（import、/api/channels 路由分发、initializeChannels 启动、shutdownChannels 关停、openPathInFileManager 仅供渠道使用后移除 import）；routes/agent.mjs（channelEvents import、SSE sessions-changed 转发监听、会话摘要 channelId/channelName）；agent-manager.mjs（createAgent 参数、session 字段、restore 回填、恢复会话传参、listSessions 导出）；agent-persistence.mjs（event-relay import、字段解构、session data/metadata 落盘、ACP 渠道事件 fire-and-forget）；agent-session-queries.mjs（两处快照字段）；session-state-service.mjs（metadata→state 白名单）；acp/server.mjs（QUICKFORGE_ACP_CHANNEL_* 环境变量传参）；agent-goal-runner.mjs 注释措辞。
- 前端清理：settings-tabs.ts / react-settings-tabs.tsx / SettingsWorkspacePage.tsx（tab 定义、lazy、图标表 Share2 条目、STATE_PRESERVING_TAB_KEYS）；App.tsx（ChannelWorkspace/ChannelRefreshEvent/channelEventProjectId 类型与函数、handleSessionsChanged 订阅、externalProjectIds state 与 useSessionPagination 传参、标题栏 sessionTitle 第二参数、loadGlobalSessions 未使用解构）；useSessionPagination.ts（externalProjectIds 可选参数与 ref）；useAgentManager.ts（createAgent options 与 loadSession hints 字段）；types.ts（两个会话元数据类型字段、sessionTitle 签名简化为单参数）；server-agent.ts / server-agent-types.ts（config 字段、POST body 透传、快照字段、sessions-changed 提前 return）；global-agent-sse-client.ts（allowlist 项）；ChatSidebar.tsx（7 处）/ ArchivedConversationsSettingsTab.tsx（2 处）sessionTitle 第二参数；i18n.ts 中英各删 24 键（start/restart/channels*/channel*，**保留 stop**——MessageEditor 仍在用）；index.css 两处 .quickforge-channel-qr-text 规则。
- 测试清理：routes/agent.test.mjs 删 2 个渠道事件用例；agent.goal.test.mjs 删 registry mock；7 个 agent-manager/scheduled-tasks/slash-skill 测试删 event-relay mock；external-sync.test.mjs 删渠道事件发布用例；agent-goal-runner.test.mjs 用例名与来源列表去掉 channel；settings-workspace-react.test.ts（tab 数 17→16、en:channels、active 契约、生命周期守卫文件列表）；session-title.test.ts 重写（渠道前缀用例改为本地化用例）；server-agent.test.ts 删 channel sessions-changed forwarding describe。
- 文档清理：docs/wiki/README.md（Goal 拒绝来源措辞）、src/README.md（渠道页描述）、src/lib/README.md（tab 列表）、src/components/README.md（两处渠道标题展示规则）、server/README.md（目录树、channels/ 整节、启动链、ACP 渠道环境变量句、Goal 可用范围措辞）、server/routes/README.md（channels.mjs 行、/api/agents/events 转发说明、goal 来源措辞）。
- 保留（与渠道无关，勿回退）：ACP 全链（source:'acp'、qf acp、server/acp）、BroadcastChannel 跨标签（useCrossTabSync/cross-tab-events/provider-keys-cache，其 sessions-changed 是跨标签事件同名）、Electron IPC 通知通道、Android NotificationChannel、npm-runtime 更新 channel、sessionTitle 函数本体、stop i18n 键、Share2 import 的其余使用方。
- 验证：全仓 grep（git ls-files 限 src/server/tests/bin/scripts/desktop/docs/wiki）残留仅剩无关命中；npm run test 全量 381 文件 4595 passed / 2 skipped；npm run lint exit 0（仅 GitToolsPinnedSummary 既有 warning）；npm run build exit 0；npx tsc --noEmit 通过。

---

## dead-code-audit-round3（评审完成，未清理，2026-10-16）

- 目标：应用户要求全面评审僵尸代码（无引用代码 / 永远走不到的分支）。
- 方法：import 引用图（857 文件、四端入口 BFS、修复扫描器自身 @/ 别名解析缺陷）+ 2 个只读子任务（server 147 文件 AST 级、前端 302 文件标识符级）+ word-boundary grep 抽检复核，对照 round2 报告去重。
- 结论：0 僵尸文件（18 个静态不可达文件全为 preload/Worker/spawn/runbook 字符串或手动工具引用）；0 不可达分支（return 后语句、恒真假、重复条件、重复 case 双端零命中）；0 死 env 门控；0 context-eviction 残留；SSE/工具渲染器/自定义事件/BroadcastChannel 协议双向配对无孤儿。
- 僵尸清单曾沉淀至 `docs/reports/dead-code-candidates-2026-10-16.zh-CN.md`（该报告已随一次性评审文档清理删除，结论已并入本条目）：A 区零引用 8 组（readSessionIdentityRows 双定义、runIcon、sliderProgressStyle、CHAT_SURFACE_REFRESH_EVENTS、6 个 i18n 孤儿键（en+zh）、capability-suggestions CSS 组 + message-queue 死查询项、零散死 CSS 类；K8 安全预留保留）；B 区仅测试存活 27 项（最典型 3 个：cronMatches、revokeLanAccessToken、DEFAULT_AI_STREAM_DEADLINE_MS）；C 区导出冗余 ~114 项（本体存活，不建议动）；D 区 sqlite-compatibility-spike 归档候选。
- Notes：清理范围待用户决策（A / A+B前3 / A+B全部 / 暂不清理），本次未改任何产品代码；执行清理时需同步直测与 wiki。

---

## prefer-background-commands（done，2026-10-15）

- 目标：基础系统提示词中的命令运行规则从“可能超出当前回合才后台”改为“可行时优先后台运行”。
- 改动：`BASE_SYSTEM_PROMPT` 要求设置 `run_command run_in_background` 为 true；仍通过返回的输出文件读取结果，并禁止 `&`、`nohup`、`Start-Process`。
- 验证：`npx vitest run tests/server/system-prompt.test.mjs` 8 passed。
- 复审：2026-10-16 再次检查源码、测试、Wiki、入口和 Android 资产；精确渠道专用标识 0 残留，`npm run android:sync` 后旧 ChannelsSettingsTab bundle 已移除。修正 feature_list 中两处过期文件路径。保留项（BroadcastChannel、Electron IPC、npm-runtime、messages channel）均确认与渠道功能无关。

---

## agent-context-eviction-removal（removed，2026-10-14）

- 目标：应用户要求**彻底移除**「上下文主动遗忘（context eviction）」特性——实现不理想（模型重复裁剪、空转调用等观感问题，迭代⑤-⑧多轮修补仍未收敛）；移除后 auto-compaction、过程折叠、最终回复可见性修复等其余功能完全不受影响。
- 删除文件：server/context-eviction.mjs、src/lib/context-eviction-settings.ts、src/components/chat/surface/ContextEvictedBadge.tsx、src/lib/tool-renderers/context-eviction-tool-renderer.tsx、tests/server/context-eviction.test.mjs、tests/frontend/context-eviction-renderer.test.ts、docs/architecture/context-eviction-design.zh-CN.svg。
- 服务端清理：agent-manager.mjs（import、contextEvictionToolHandlers/wrapContextEvictionToolDefinition、createServerTools 注册块、beforeToolCall 免审批分支、refreshContextEvictionState 及调用、session 初始字段、restore/sync 字段、transformSessionContext 的 ensureMessageIds/投影/占比通知块——maybeAutoCompactSession 日志与 applyActiveCommandPrompt/applyActiveCapabilityPrompt 链路原样保留）；auto-compaction.mjs（sessionProjectionMessages 及 import、摘要源包装、估算缓存 key 的账本字段；estimateSessionContextUsage 其余行为不变）；agent-persistence.mjs（contextEviction 解构与落盘）；agent-session-queries.mjs（快照字段）；tools/definitions.mjs（三工具定义）；routes/tools.mjs（import、directRouteDisabledTools 三名、GET /api/tools 暴露）。agent-session-events.mjs 无 eviction 专属代码（其 767565c 改动为最终回复可见性修复，保留）。
- 前端清理：surface-context.ts（ContextEvictionEntriesContext/useContextEvictionEntries）；ChatSurface.tsx（evictedEntries 派生、sameMapItems、AgentSurfaceSnapshot 字段、Provider 包裹、SUBSCRIBED_EVENTS 的 context_eviction_updated）；ToolMessage.tsx / AssistantMessage.tsx 徽标接线；DefaultOptionsSettingsTab.tsx（开关行 UI、state/ref、加载/保存函数、import）；server-agent-types.ts / server-agent.ts（ServerAgentContextEviction 类型、快照映射、state 帧处理、case 'context_eviction_updated'、类型 re-export）；local-tools.ts / tool-renderers/index.ts / shared.tsx（渲染器注册、导出、三个专属 icon）；i18n.ts 中英各删 18 键（对称）。global-agent-sse-client.ts 无该事件注册，无需改动。
- 测试清理：删除两份专项测试；default-options-settings-react.test.ts 与 default-options-settings-tab.test.ts 仅删 context-eviction-settings 的 vi.mock；agent-session-events.test.mjs、server-agent.test.ts 中 767565c 增加的断言属最终回复可见性修复，**全部保留**；process-folding-final-reply.test.ts、thinking-final-reply-visibility.test.ts、server-agent-final-answer-recovery.test.ts、process-folding.ts 明确保留未动。
- 文档清理：docs/wiki/server/README.md 删 context-eviction.mjs 整节并去掉 auto-compaction 段的遗忘投影句；docs/wiki/server/routes/README.md、docs/wiki/src/components/README.md（两处）、docs/wiki/src/lib/README.md 同步删除。
- 遗留数据：旧会话 JSON 的 `contextEviction` 字段与 settings.json 的 `context-eviction-settings` 键不再被读取（无主数据），无害、无需迁移。
- 验证：全仓 grep（排除 node_modules/dist/package-dist/package-offline/.git）源码与测试零残留（仅 feature_list/progress/session-handoff 历史记录条目）；npm run test / lint / build 全部通过（详见 session-handoff）。

---

## fix-process-folding-source-empty（done，2026-10-13）

- 症状：工具调用→思考→最终回复时，最终回复渲染了但整行被隐藏（刷新才恢复）；仅 OpenAI 系 reasoning 形态触发（正文无流式 tick、紧跟 message_end）。
- 取证链：[sse-frame]（服务端）+ [sse-rx]（前端）帧流水日志证明发送/接收/数据合入全部正常；用户 DOM 检查定位 `quickforge-process-source-empty` class；jsdom 级折叠测试（分阶段/一次性/节点重建）先证明核心豁免逻辑无恙，最终场景 4 精确复现。
- 根因：`decorateProcessTurn` 流式期间（正文未到）为只剩 thinking 的 assistant 行打上 source-empty（CSS 隐藏整行，当时正确）；message_end 正文到达后 agent_end 装饰走 skip 短路（终答指纹排除后与 thinking-only 态匹配）且三条提前 return 路径（skip/update/空 nodes）全部跳过 `updateEmptyProcessSources` → empty 永不清除 → 正文随整行被隐藏。
- 修复：`src/components/chat/panel-decoration/process-folding.ts` 三处提前 return 前补 `updateEmptyProcessSources(assistants)`——skip 只跳过组重建，不跳过行级可见性维护。
- 验证：`tests/frontend/process-folding-final-reply.test.ts` 4 用例（含用户精确复现场景）全绿；mutation 验证（回退修复即红、恢复即绿）；折叠层 4 文件 79/79；eslint/build 通过；用户真机确认修复。
- 附带：两端帧流水取证日志保留（server/agent-session-events.mjs [sse-frame] + src/lib/global-agent-sse-client.ts [sse-rx]，仅关键帧），后续可按需移除。
- 顺带修正过时断言：tests/frontend/server-agent.test.ts「merges incremental message tails」同 id 断言改为「内容不同必须替换」（sameMessageShape 注释即此 bug 家族警告）。

---

## agent-context-eviction（done，2026-10-13）

- Goal：设置门控的 Agent 主动遗忘——对话记录完全保留，agent 运行时可自行把不需要的工具结果/旧回复裁剪出运行时上下文；每次请求向 agent 注入上下文占比（无 60% 门槛）；含 recall/report 工具与前端「已裁剪」标记（feature 1+2 一次完成）。
- 设计：存储与运行时视图分离的既有架构（transformContext 投影不回写）上叠加遗忘通道。① 会话级账本 `session.contextEviction`（按稳定消息 id，ensureMessageIds 在投影前兜底补 UUID；回滚后失配 id 惰性失效）② 工具族 `context_forget`（messageIds 精确 / rule 批量：kind+olderThanTurns+tools 过滤+except 豁免）/ `context_recall`（按 id 或 all 召回，账本移除即回上下文）/ `context_report`（完整可遗忘清单+账本摘要）；永不遗忘 user 与 compact summary；免审批、执行时双重校验设置 ③ 投影把命中消息替换为一行占位符（toolResult 保 toolCallId/toolName 配对；assistant 折叠 text/thinking 留 toolCall），`sessionProjectionMessages` 为同步共用投影（estimateSessionContextUsage 缓存 key 加账本、压缩摘要源跳过被忘内容）④ `buildContextUsageNotice` 每次请求注入瞬态 user `<system-reminder>`（不落存储）：恒含占比，≥40% 附 top3 清单与工具族用法。设置 `context-eviction-settings` 默认关闭（enabled + exemptRecentTurns 两项）；enabled 翻转经 refreshContextEvictionState（每次 runPrompt 前）重建工具集。前端：ServerAgent.state.contextEviction（state 帧 + context_eviction_updated 事件→广播 message_metadata_updated）、ChatSurface 快照派生 identity-stable evictedMessageIds 经 ContextEvictedIdsContext 下发、ToolMessage/AssistantMessage 剪刀徽标（卡外顶部，a11y 安全）、原文始终完整展示。
- 验证：context-eviction 29 passed；tests/server 全量 1919 passed / 2 skipped、仅 1 failed 属并行会话的 split-final-answer-delivery-cursor；eslint 改动文件通过；npm run build 仅挂该并行工作的 server-agent.ts:1483 类型错误，与本 feature 无关。
- 迭代⑧（通知减负：只留占比行，2026-10-13）：用户决定通知不再带账本计数与工具指引。`buildContextUsageNotice` 签名收敛为 `({ settings, usage })`（去掉 session / loopMessages 与 forgottenCount / forgettableCandidates 统计），通知只剩一行占比（`Context usage: X% of the N-token window (T tokens).`），删掉账本计数行与两条分支指引句（M>0 固定指引、M=0 止步句）；`settings?.enabled !== true` / 窗口缺失 / percent ≤ 0 仍返回 null；details 只含 percent/inputTokens/contextWindow；账本与投影行为不变（条数与清单改由 agent 自行调 context_report）。`server/agent-manager.mjs` transformSessionContext 调用点同步新签名与注释。测试通知契约重写（只报占比行 + 负向断言：无 Forgotten ledger / context_forget / context_report / frees space，details 只含三项；删除计数行与止步句用例）。文档：`docs/wiki/server/README.md` 占比通知段改写为「只注入一行占比（role=user 的 <system-reminder>，不落存储），不再附带计数行、清单或工具指引」；`docs/architecture/context-eviction-design.zh-CN.svg` ② 卡改「只有占比行 · 每轮都注入」、② 下方 note 改「只有占比行：无计数、无清单、无工具指引」、⑥ 改为「残留问题：模型自发重复调用（通知侧已实施修复，不再催促）」并把 ①④ 卡与根因/方向文字改为已实施+残留表述（xml.dom.minidom 解析通过）。验证：`npx vitest run tests/server/context-eviction.test.mjs` 30 passed；`npx eslint server/context-eviction.mjs server/agent-manager.mjs` 0 error 0 warning；grep 确认 server/ 与 tests/ 无残留 forgettableCandidates 与旧计数行/止步句文案（forgottenCount 仅存于 context_report details，供工具卡渲染）。
- 迭代⑦（状态感知占比通知，止住 forget 空转循环，2026-10-13）：用户反馈每轮都出现「N 条均已裁剪过」重复调用。根因：投影本身每轮都发裁剪后上下文（agent-manager transformSessionContext 先 sessionProjectionMessages 再发模型，无 bug），但 `buildContextUsageNotice` 是无状态的——恒注入同一句「context_forget frees space」，不告诉模型账本已裁完，模型每轮被催促、每轮空转调一次 forget。修复：通知增账本计数行（已裁 N 条（仅 live id）/ 剩余可裁 M 条，仅计数无清单，保持迭代④自主性设计）；M>0 附原固定指引；M=0 改明确止步句「All forgettable items are already trimmed — skip context_forget until new tool results or replies accumulate」；`context_forget` 结果「全部已裁剪过」文案同步附 call again only after new tool results accumulate；details 增 forgottenCount/forgettableCandidates。验证：context-eviction 32 passed（通知契约重写：计数行、账本计数不入清单、M=0 止步且不再含 frees space 指引）；eslint 改动文件通过。
- 迭代⑥（修复重复遗忘 + 工具卡下拉详情，2026-10-13）：① 服务端 `resolveForgetTargets` 接收账本 id 集——规则求值与显式 messageIds 中已入账 id 拆入 `alreadyForgotten`（数量 + `alreadyForgottenNow` 清单）单独上报，`forgotten`/`tokensFreed` 只统计本次新裁；content 文案区分「全部已裁剪过 / 规则无匹配 / 混合 no-change」，重复调用同一规则不再返回误导性的 forgotten:0；`forgottenNow` 逐项带 `{ id, kind, toolName, tokens }`，`context_recall` details 增 `recalledItems`（`{ id, kind, toolName }`）；工具描述补「重复调用安全」说明。② 前端 `ContextEvictionToolRenderer`：forget 摘要区分三种 0 语义（新裁剪 `contextForgetToolSummary` / 全部已裁剪过 `contextForgetToolAllForgotten` / 无新增裁剪 `contextForgetToolNone`，混合时追加 `contextForgetToolAlreadySuffix`）；展开体默认恒有明细区（forget 逐条 `#短id · 工具名/早期回复 · ~tokens`、recall 逐条、report 完整报告文本），detailed 模式再追加 input/details JSON；i18n 中英新增 7 键。验证：context-eviction 31 passed（新增重复规则/混合规则 2 用例）+ 新增 context-eviction-renderer 7 passed + i18n 快照 8 + local-tool-running-sweep 7；eslint 改动文件 0 error 0 warning；npx tsc -b 通过。
- 迭代⑤（工具卡渲染器 + 徽标 reason，2026-10-13）：① 三个工具获专属 icon（forget=剪刀/recall=回退箭头/report=柱状图，shared.tsx renderToolIcon）；② 新增 ContextEvictionToolRenderer（tool-renderers/context-eviction-tool-renderer.tsx，todo_write 同构折叠卡）：摘要行=icon+结果计数（已裁 {count} 条·释放 ~{tokens} tokens / 已召回 {count} 条 / 上下文报告·占用 {percent}%·已裁剪 {count} 条）+斜体 reason（来自 params，悬停全文）+状态/耗时；detailed 模式展开 input/details JSON；local-tools.ts 注册三个工具名，i18n 中英 6 键。③ 徽标升级：ContextEvictedIdsContext(Set)→ContextEvictionEntriesContext(Map id→entry 含 reason/kind/forgottenAt)，共享组件 ContextEvictedBadge.tsx（剪刀+文案+斜体 reason 截断+title 全文），ChatSurface 快照 evictedMessageIds→evictedEntries（新增 sameMapItems 保 identity-stable），ToolMessage/AssistantMessage 接线。验证：eslint 通过、i18n 对称测试通过、npm run build 通过、前端全量 2716 passed/1 failed（失败为并行会话 server-agent.ts 的 mergeIncrementalMessages id 语义回归，非本 feature，其测试注释「Message-id equality wins over content comparison」给出修复方向）。
- 迭代④（去通知清单，2026-10-13）：占比通知不再附带任何清单、无 ≥40% 触发阈值——恒为 `<system-reminder>` 包裹的占比行 + 一句固定工具指引（report 列清单/forget 释放/recall 恢复）；删 NOTICE_TOP_CONSUMERS/NOTICE_LIST_MIN_PERCENT 常量与候选计算，查什么/忘什么/何时忘完全由 agent 自主（需要清单时自己调 context_report）。29 个单测全绿（新增"高占比也不列清单"与"账本状态不影响通知格式"用例）。
- 迭代③（去轮次豁免，2026-10-13）：设置只剩 enabled 单开关；rule.olderThanTurns 降级为纯过滤参数（0/缺省=不限轮龄，clamp 0–100）；显式 messageIds 与占比清单同样不受轮次限制；仅保结构性保护——user 消息与 compact summary 永不可忘。同步：工具描述、前端设置 UI（删豁免数字项）、i18n、wiki、29 个单测（新增 olderThanTurns 0 与"仅保护对象时无候选"用例）。注意：迭代②曾补的"显式 id 过豁免下限检查"已按用户要求移除，其配套单测随语义一并移除。
- E2E 真机验证（2026-10-13 同会话）：用当前源码在 5199 端口起第二实例（真实数据目录），创建 eviction-e2e-test 会话跑 6 回合真实 LLM 会话——① GET /api/tools 门控双向：enabled→3 工具出现、disabled→消失 ② context_report 如实报占比/豁免窗口/候选 ③ 豁免下限：olderThanTurns 1 被 exempt 4 拦截（matched nothing）④ context_forget 规则 4 轮命中 2 条 toolResult，释放 ~14488 tokens，上下文占比 6.3%→1.9%，账本（含 reason/forgottenAt）持久化且消息原文完整 ⑤ context_recall all：账本清空、占比回升 6.4%。测试会话/工作区文件已清除，5199 实例已停。
- 顺带修复：显式 messageIds 遗忘未过豁免下限检查（与文案/规则路径不一致）——补 exempt 检查 + 2 个单测；handler settings 注入语义改为「传入即用、缺省读实时」（单测不再受真实 settings store 状态影响）。
- Notes：未提交。演进轨迹：① 去 60% 水位门槛→占比通知每请求恒注入 ② 并行会话补显式 id 豁免检查+E2E ③ 去轮次豁免→设置只剩 enabled 单开关（见上）。类型契约靠 vitest server-agent-events-types + tsc -b 兜住（根 npx tsc --noEmit 是 solution 空检查）；后台 vitest 非 TTY 输出被吞（既有）。用户 settings.json 已开启该特性（旧字段 exemptRecentTurns 已无意义、normalize 忽略）。工作区有并行会话的 split-final-answer-delivery-cursor 改动（agent-session-events.mjs deliveredMessageCount + server-agent.ts messagesSummary reconcile）：其"keeps the final answer in an end frame"测试失败（after=min(delivered,count)=3 空 tail，测试期望 after=2 保留末条）且 server-agent.ts:1483 messagesSummary 可选性类型错误连带 build 失败——非本 feature 引入、未触碰，待其作者收敛。

---

## split-final-answer-end-frame-gap（done，2026-10-13）

- Goal：回合已结束，最后总结仍偶发不出现。
- 根因：结束帧缺投递游标时回退到已保存条数，尾部为空；同一事件二次转换还会裁掉已补上的总结。
- 改动：缺游标从 0 取尾部；事件只转换一次。客户端发现条数缺口或最后一条原地替换时强制回读。
- 验证：事件、前端恢复、路由共 73 passed；eslint 通过。
- Notes：未提交。需要重启服务后验证。

---

## split-final-answer-delivery-cursor（done，2026-10-13）

- Goal：回合已结束但最后总结偶发缺失，刷新后才出现。
- 根因：持久化计数可能在结束帧发出前推进到最终条数；split 帧把该计数当作客户端游标，尾部变空。
- 改动：新增 `deliveredMessageCount`，结束帧按已投递与已持久化的较小值取尾部，再推进投递游标。
- 验证：事件、路由、持久化相关 109 passed；eslint 通过。
- Notes：未提交。

---

## release-v2.2.5（done，2026-10-13）

- Goal：发布 v2.2.5 小版本。
- 内容：后到最终答案不再折进收起过程组；工具卡文件名恢复点击预览；ResizeObserver 噪音降级与 summary 交互警告修复。
- 验证：test 388 文件 4606 passed / 2 skipped；lint exit 0（既有 useMemo warning）；build exit 0。tarball `package-offline/shawnstack-quickforge-2.2.5.tgz`，7.7MB / 549 files / shasum f6b0741484ec62d3fccdb86d69d395370d28cf17。
- Notes：npm publish 待用户执行。未跟踪 `new` 不纳入。

---

## late-final-answer-process-fold（done，2026-10-13）

- Goal：不断连时，最终答案偶发被收起的过程组藏住，刷新才出现。
- 根因：终答标记在流式阶段锁住当时最后一段文字；最终正文晚到后，旧标记仍优先，新正文被当成过程文本折进默认收起的组。
- 改动：过期终答标记立即清除；终答缺失或仍在过程组内时，跳过指纹短路并重装饰，让最新正文留在组外。
- 验证：process-folding 相关 4 个测试文件 80 passed；eslint 改动文件通过。
- Notes：未提交。未跑全量 test/build。

---

## tool-file-summary-span-click-preview（done，2026-10-10）

- Goal：恢复「点击工具卡文件名即预览」且不违反「summary 内禁嵌交互元素」规范（用户反馈上一 feature 后文件名无下划线、点击不跳转）；随后按用户要求去掉 write/edit/read 右侧眼睛按钮，文件名点击即唯一预览入口。
- 方案依据：HTML 规范与 DevTools 的 nested-interactive 警告针对的是 summary 内嵌**交互控件**（button / 带 href 的 a / role=button 等）；普通元素挂 click 不在禁止之列，且 span 无 role / tabindex 时在 a11y 树中不是交互控件、不会触发该警告。
- 改动：`renderToolFileSummary` 签名恢复 `(toolName, params)`，文件元素恒为静态 span——`resolvePreviewableArtifact` 有值时挂 `onClick` 复用 `previewArtifactClickHandler`（preventDefault + stopPropagation 阻断折叠后派发 `PREVIEW_ARTIFACT_EVENT`），恢复 `cursor-pointer` 与仅 basename 的 `hover:underline underline-offset-4` 暗示；不可预览路径仍纯静态。`renderPreviewButton` 收窄回仅 present_files（多文件摘要无法整体充当入口）。local-workspace-tool-renderer 调用传回 toolName；wiki shared.tsx 段同步。
- 验证：tool-renderer-file-icon 12 passed；连带 local-tool-running-sweep + tool-renderer-shared-state 共 35 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Notes：已随本条目一并提交（fix(chat) 提交）。取舍：write/edit/read 预览入口只剩文件名点击，span 不进 tab 序列，键盘/读屏用户不可达（用户明确要求去眼睛按钮）。span 不加 tabindex/role 是刻意的——加 tabindex 会把它变成 tab 序列内元素、加 role=button 又构成嵌套交互控件。

---

## summary-interactive-content-a11y（done，2026-10-10）

- Goal：消除 Chrome DevTools 的 18 个「Interactive element inside of a `<summary>` element」a11y 警告。
- 根因：write_file / edit_file / read_file 工具行摘要区的文件名元素整体是预览入口 `<button>`（renderToolFileSummary 可预览分支），嵌在折叠头 `<summary>` 内——HTML 规范禁止 summary 内嵌交互元素，每个文件读写工具行报一条，18 个即 18 个此类工具行。其余 summary（mcp/ask-user/goal-report/todo-write/默认卡/CodeBlock 菜单/context-compaction 等）排查均干净（button 都在展开区或 actions 区）。
- 改动：renderToolFileSummary 统一静态 span（去 button 分支、cursor-pointer、hover:underline；签名去 toolName 参数）；renderPreviewButton 扩展为 write/edit/read/present_files 共用右侧眼睛按钮（键盘可达，与 present_files 既有模式一致）；wiki shared.tsx 段同步。
- 验证：tool-renderer-file-icon 12 passed；连带 local-tool-running-sweep + diff-view + tool-renderer-shared-state 47 passed；eslint 改动文件通过；npx tsc --noEmit 通过。
- Notes：未提交。UX 变化：点击文件名不再预览，预览改点 summary 右侧眼睛按钮（用户未答复方案确认，按推荐方案 A 执行）。

---

## resize-observer-noise-filter（done，2026-10-10）

- Goal：消除控制台被 `ResizeObserver loop completed with undelivered notifications` 刷屏，并修复 apple-mobile-web-app-capable 废弃警告。
- 根因：ResizeObserver loop 报错是浏览器单帧内多次派发尺寸回调的良性噪音（scroll-sync、跑马灯等多个观察器并发观察/改写同批元素时常触发），`main.tsx` 全局 error 入口一律按 error 级别输出导致刷屏；index.html 仅有 iOS 旧语法的 apple-mobile-web-app-capable，Chrome 要求补 mobile-web-app-capable。
- 改动：新增 `src/lib/error-noise.ts`（isResizeObserverLoopError：字符串/Error.message 匹配，普通对象不识别）；`main.tsx` error 与 unhandledrejection 入口命中降级 logger.debug（quickforge_debug=1 才可见），真实错误不变；`index.html` 补 `<meta name="mobile-web-app-capable" content="yes">`（保留 apple 版供 iOS Safari）。
- 验证：定向 vitest error-noise 9 passed；eslint 改动文件通过；npx tsc --noEmit 通过。wiki 已同步 src/lib/README.md。
- Notes：未提交。android/ 下两份 index.html 为 cap copy/gradle 产物未手工修改，下次 cap sync 从 dist 带入。Intervention「Images loaded lazily」为浏览器优化提示，非错误，未处理。

---

## release-v2.2.3（done，2026-10-10）

- Goal：按 patch-release-runbook 发布 v2.2.3 小版本。
- 内容：v2.2.3 = state 帧拉尾合入后补发 UI 通知（5df3037）。fix 提交与 release 提交分开。版本 2.2.2→2.2.3；CHANGELOG.md 新增 [2.2.3] 节；README.md 版本文案。
- 验证：npm run test 387 文件 4596 passed / 2 skipped（exit 0，较 v2.2.2 +3 即本次新增用例）；npm run lint exit 0（1 个既有 GitToolsPinnedSummary useMemo warning）；npm run build exit 0（既有 externalized/大 chunk warning）。tarball：package-offline/shawnstack-quickforge-2.2.3.tgz（7.7MB / 549 files / shasum c44eaa6e6ef711723083ed3d0962264cc73952aa）。
- Git：fix `5df3037` + `chore(release): v2.2.3` + tag `v2.2.3`，push origin dev v2.2.3。
- Notes：npm whoami 401 未登录，publish 待用户执行。后台 vitest 非 TTY 输出被吞（既有），硬门禁以前台复跑为准。未跟踪 new（0 字节）维持不纳入。

---

## state-frame-tail-merge-notify（done，2026-10-10）

- Goal：用户在最新代码（含 4c653cd 拉尾重试）上仍复现「聊天回复的最终答案偶发不可见，刷新才显示」，重新分析根因并修复。
- 根因（重分析）：state 帧驱动恢复的时序倒挂——SSE 断连吞掉收尾帧后，state 帧（split 会话只带 messagesSummary）到达时先**同步** emit agent_end（ChatSurface syncSnapshot 读到的还是旧列表，任务收尾 UI 全部完成），再**异步** reconcile 拉尾合入最终回答；而合入后的通知 finish() 只在 `markers && ...` 时广播（无 goal 的普通会话 markers 为 undefined，marker replay 对 undefined 原引用返回），merge 分支也不 emit → 合入零通知 → ChatSurface 靠 SUBSCRIBED_EVENTS 重渲染，此后再无事件 → 最终答案停留在内存不渲染，刷新重建 agent 才显示。对照：message_end/agent_end 的 summary 分支（finally forward）、watchdog /status 路径（await 后 emit）、非 split state 帧（合入即 notify）均正确，唯独 split state 帧路径漏发。4c653cd 只修了「数据拉不回来」，本条修「拉回来了 UI 不知道」，重试成功后同样缺通知，故症状仍在。
- 附带缺陷一并修复：① 拉尾只取一页不看 hasMore（服务端单页 500 上限），断连窗口丢 >500 条时最终答案在第 2 页永不显示；② 回滚场景全量重拉失败时 fetchAllSessionMessages 静默返回 []，走 all.length===0 分支静默 return 不重试。
- 改动：finish() 去掉 markers 前置（stateVersion 前进即广播 message_metadata_updated；marker replay 自行改写时先广播不双发）；hasMore 时整体重跑续拉下一页（每页重置重试预算）；fetchAllMessagesFromServer 失败显式返回 null 与真空（[]）区分，失败进退避重试、真空替换本地（模块级 fetchAllSessionMessages 的 restore/create 静默降级语义不变）。
- 验证：server-agent-final-answer-recovery 6 passed（新增 3 用例：合入后补发通知且晚于 agent_end / 跨页续拉 after=1→2 / 回滚全量重拉失败重试；主用例红灯验证——临时还原 markers 条件，收到的只有 ['agent_end'] 精确复现症状）；连带 server-agent + events + http 166 passed；eslint 改动文件通过；npx tsc --noEmit 通过。wiki 已同步。
- Notes：未提交。边界：state 帧 agent_end 发出时序未动（同步清 streaming/pending 语义保留，靠合入后补发通知闭环）；SSE 重连上限、watchdog、后端分页 limit 未动。下次发布随 patch 版本带出。

---



## transformer-learning-project（done，2026-10-10）

- Goal：按用户要求在 `learning/transformer/` 创建 Transformer 模型学习项目（用户确认方向：Transformer 模型；形式：笔记 + 可运行示例）。非产品 feature，不进入 feature_list.json（产品功能清单只收 QuickForge 功能；学习项目完全隔离于 learning/ 目录，不涉及产品代码、依赖与构建）。
- 内容：7 章中文笔记（notes/00-overview ~ 06-training-and-sampling）+ 6 个纯 NumPy 可运行示例（01 注意力含缩放/掩码/饱和实验、02 多头、03 正弦位置编码、04 Pre-LN Block、05 完整可训练字符级 mini GPT（604,571 参数，手写逐层反向 + Adam + 数值梯度检查 + 生成）、06 采样策略对比）+ 架构 SVG（assets/transformer-architecture.svg）+ README 导航。Python venv（.venv，Python 3.10.8 + numpy 2.2.6）。
- 验证：示例 01-06 全部运行通过；05 梯度检查（单元：LayerNorm/Linear/FFN/Attention/Block 全部 <1e-6；整体 <1e-4 含数值微分噪声），训练 500 步损失 3.32→0.32，生成对比正常；06 train/val 分叉清晰（0.37 vs 1.72）、六种采样策略与温度-熵表输出正常。开发中修复了 05 手写 softmax 反向的经典错误（逐元素 dp·p·(1-p) → 正确的行内联合公式 p·(dp−Σdp·p)）。
- 文件：learning/transformer/{README.md, requirements.txt, notes/×7, examples/×6, assets/×1, .venv/}；.gitignore 追加 `learning/**/.venv/`。
- Notes：未提交。v2.2.2 发布记录中「未跟踪 learning/ 来源不明」即本目录（用户此前要求的会话产物），本次正式落地内容。示例 5/6 训练耗时约 1.5~2.5 分钟/500 步（纯 CPU）。
- 迁移（2026-10-10 同会话）：应用户要求项目移出本仓库——robocopy 至 `D:\transformer-learning`（排除 .venv 后重建 venv + numpy，抽验示例 01/05 梯度检查通过，README 路径同步），经 `POST /api/project/path` 注册为 qf 项目（id f2cde6ee-1a05-41ea-9af0-f7b17e8e40a7，设为 active）；`learning/` 已从仓库删除，.gitignore 的 learning 条目已回滚。quickforge 仓库不再含学习项目代码。

---



## release-v2.2.2（done，2026-10-10）

- Goal：按 patch-release-runbook 发布 v2.2.2 小版本。Git commit/tag/push 已完成，npm publish 待用户执行。
- 内容：v2.2.2 = run_command 摘要 description 优先（793a739）+ SSE 断连后最终回答拉尾重试（4c653cd）。版本 2.2.1→2.2.2；CHANGELOG.md 新增 [2.2.2] 节；README.md 版本文案。
- 验证：npm run test 387 文件 4593 passed / 2 skipped（exit 0）；npm run lint exit 0（1 个既有 GitToolsPinnedSummary useMemo warning，2026-09-28 已记录）；npm run build exit 0（既有 externalized/大 chunk warning）。tarball：package-offline/shawnstack-quickforge-2.2.2.tgz（7.7MB / 549 files / shasum 336abea4bf25ee643e39fe5fc76d8dc0d4ad56b7）。
- Git：`b2cbe4d chore(release): v2.2.2` + tag `v2.2.2`，已 push（`git push origin dev v2.2.2`）。
- Notes：npm whoami 401 未登录，publish 待用户 `npm login` 后执行。后台首轮 vitest 输出被吞（非 TTY），为硬门禁可信前台复跑全量。工作区新增未跟踪 learning/（测试运行后出现，来源不明）与 new（0 字节），均未纳入提交，待用户确认处置。

---

## sse-reconnect-final-answer-recovery（done，2026-10-10）

- Goal：修复「长任务 final answer 偶发看不见、刷新才看到」。
- 根因：SSE 断连窗口（日志频发 Global scope request_socket_error；前端 ServerAgent 走全局流 /api/agents/events，重连后不重放事件）吞掉收尾的 message_end/agent_end 后，重连 state 帧（split 会话只带 messagesSummary.count）内联合成 agent_end（UI 停止转圈）并触发 /messages 拉尾；拉尾瞬时失败（fetchSessionMessagesPage 返回 null）时 `if (!isCurrent() || !page) return` 静默放弃、无重试，watchdog 已随 isStreaming=false 停止 → 最终回答永久缺失，刷新全量拉取才恢复。次要缺陷：state 帧 isStreaming=false 分支未清 streamingMessage（agent_end case 与 watchdog 路径都清了）。排除项：会话 idle 回收（600s）与 SSE 断连无关，运行中会重置；聊天 DOM 折叠链路（process-folding）静态推演自洽，非根因。
- 改动：reconcileMessagesFromSummary 拉尾失败按 MESSAGE_RECONCILE_RETRY_DELAYS_MS（1s→16s 共 5 次）退避整体重跑（重跑重新快照 stateVersion，更新事件补齐即自然放弃；count 追平空转），成功清定时器、耗尽 logger.warn 放弃，dispose 清理；case 'state' isStreaming=false 内联 agent_end 分支补清 streamingMessage 与三类 pending。
- 验证：server-agent-final-answer-recovery 3 passed（重试恢复/上限放弃/成功对照，先以红灯复现无重试断链后改写）；server-agent + server-agent-events + server-agent-http 连带 160 passed；eslint 改动文件通过；npx tsc --noEmit 通过。wiki 已同步 src/lib/README.md（拉尾重试契约 + 行数）。
- Notes：未提交。边界：SSE 断连本身、global SSE 重连 10 次上限、后端事件不重放、refetch-all 失败路径均未动；后端彻底不可达场景仍由 reconnect-notice + watchdog 兜底。

---

## run-command-description-first（done，2026-10-08）

- Goal：run_command 带 description 参数时，对话工具行摘要优先显示 Description，而不是原始命令。
- 改动：`summarizeParams` run_command 分支改为非空 description（空白折叠）优先、空缺回退 command；`local-workspace-tool-renderer.tsx` 摘要 title 在描述与命令并存时改为「描述\n命令」，命令悬停仍可达。子任务跑马灯复用同一函数自动生效。
- 验证：定向 vitest tool-param-summary + subagent-run-detail + local-tool-running-sweep 129 passed；eslint 改动文件通过；npm run build 通过（tsc -b 首轮报 title 类型错误，已用 summaryText 收窄修复）。
- Notes：未提交。Composer 后台命令菜单本就 description 优先（label=description、command 次行），本次未动。approval 卡的 summarizeToolArgs 仍显示命令，属审批流不在本次范围。wiki 已同步 src/lib/README.md 的 summarizeParams 契约。

---



## release-v2.2.1（done，2026-09-30）

- Goal：按 patch-release-runbook 发布 v2.2.1 小版本：版本递增、CHANGELOG/README 更新、全量验证、runtime/offline 包、Git commit/tag/push；npm publish 交用户。
- 门禁修复：全量 test 首轮 4 failed（2 个 server 为并发抖动，单独跑通过；2 个 frontend 稳定失败，均为 8119283 提交时测试与实现即不一致的历史遗留）。`isProcessToolsGroupMember` 补 `running !== false`（运行中后台命令不折叠、退出终态折回过程组，与 shared.tsx:49 / ToolMessage.tsx:160 同款判定）；subagent-running-indicator 后台命令测试断言改为独立触发器 `.quickforge-background-command-trigger`（在 leftControls 内）与 innerHTML badge 断言。
- 验证：`npm run test` 386 文件 4586 passed / 2 skipped（exit 0）；`npm run lint` exit 0（1 个既有 GitToolsPinnedSummary useMemo warning，2026-09-28 已记录）；`npm run build` exit 0（既有 externalized module / 大 chunk warning）。tarball：`package-offline/shawnstack-quickforge-2.2.1.tgz`（7.7MB / 549 files / shasum 23a3ce711f6e...）。
- Git：`68fa8621 fix(chat): 后台命令退出后可折回过程组，修正摘要触发器过期断言` + `cf7c27b4 chore(release): v2.2.1` + tag `v2.2.1`，已 push（`git push origin dev v2.2.1`，无历史 tag 误推）。
- Notes：npm whoami 401 未登录，publish 指令已交用户手动执行。发布中途一次 `git stash` + checkout 8119283 验证历史失败时被 shell 管道中断短暂 detached HEAD，已恢复 dev 并 stash pop，无改动丢失。docs/wiki 无需更新：isProcessToolsGroupMember 行为变化与既有「运行中后台命令不折进过程组」wiki 契约一致（退出终态本来就该折回）。

---



## local-path-link-trailing-text（done，2026-09-29）

- Goal：修复对话路径显示把文件地址后紧贴的文字一起识别进链接的问题。
- 根因：`local-file-path-links.ts` 绝对路径两条分支的尾部字符类 `[^\s"'<>\`]+` 只排空白/引号/尖括号/反引号，CJK 正文（含中文标点 `，` `。`）全被贪心吞进匹配；`trimTrailingPathPunctuation` 只能剥末尾标点，救不回中间正文。
- 改动：正则保持宽松召回（保住含 CJK 段的合法路径如 `D:\文档\说明.md`），新增 `resolveLocalFilePathCandidate` 解析终点——剥末尾标点后无 CJK 或以扩展名结尾直接接受；否则从左到右取第一个使剩余以扩展名结尾的 CJK 截断点（`D:\...\index.css后面还有文字` → `D:\...\index.css` + 正文回填）；无扩展名定位不了终点放弃链接（宁可不链接不吞正文，用户确认取舍）。相对路径分支扩展名尾部加 `(?![A-Za-z0-9])` 防 >8 位英文粘连截半（`foo.tsxabcdefghij` 整体不匹配）；≤8 位粘连（`foo.tsxand`）视为真实扩展名维持现状（本质歧义）。
- 验证：定向 vitest local-file-path-links 17 passed（新增 8 用例；红灯验证：临时还原旧行为 6 failed，失败信息即整串吞字症状）；decorator-copy-i18n + message-actions 连带 69 passed；eslint 改动文件通过；tsc --noEmit 通过。
- Notes：未提交。中文标点 `，` 不在正则排除集内，无扩展名路径后接「，再改 xxx」会先整体吞到空格、再因无有效截断点放弃，原文完整保留，符合「不吞正文」。wiki 同步 components/README.md 两份副本的 panel-decoration 细分列表（新增 local-file-path-links.ts 条目）。DESIGN_LANGUAGE.md 无需更新：纯识别逻辑修正，无视觉变化。

---

## background-command-idle-keepalive（done，2026-09-29）

- Goal：修复后台命令在会话空闲 10 分钟后被自动回收连带终止的问题。
- 根因：agent-manager `IDLE_TIMEOUT_MS`（10 分钟）到点即 `destroyAgent`，而 `destroyAgent` 会 `stopBackgroundCommandTasksForSession` 杀掉该会话全部运行中后台命令；SSE keep-alive 故意不重置该计时器，后台命令运行中也不保活，回合结束后约 10 分钟进程即被 taskkill。
- 改动：`resetIdleTimer` 回调增加豁免——`listBackgroundCommandTasks(sessionId)` 非空时仅重置计时器（与 goal waiter 同型）；最后一个命令退出经通知路径重置后按常规回收。显式销毁（删除会话/服务 shutdown）终止行为不变。新增 `tests/server/agent-manager.background-idle.test.mjs`：带后台命令的会话跨多个 10 分钟窗口存活 + 无后台命令对照组仍回收 + 命令退出后恢复回收 + 显式销毁仍终止命令。
- 验证：定向 vitest 2 passed；tests/server 全量 174 文件 passed；eslint 改动文件通过；npm run build 通过（chunk 警告既有）。
- Notes：未提交。既有行为未改：用户停止当前 run（abortRun → run signal abort）会终止该 run 内启动的后台命令（tools/index.mjs 的 abort 监听只随进程退出清理）；服务器 shutdown 仍终止全部后台命令。wiki 同步 server/README.md（冷会话操作段）与 server/tools/README.md（run_command 段）。

---



## chat-h5-no-horizontal-scrollbar（done，2026-09-28）

- Goal：H5 聊天消息区不再因过长内容在底部浮出横向滑动条。
- 根因：主滚动容器（qf-scroll-container）只有 overflow-y-auto，另一轴按 CSS 规范被计算为 auto；KaTeX 展示公式容器是裸 my-4 div（katex.min.css 无溢出处理），宽公式直接撑破消息列。
- 改动：主滚动容器加 overflow-x:hidden，只承担纵向滚动；展示公式容器挂 quickforge-katex-scroll（unlayered：公式块内横滑 + 隐藏滚动条 + touch 滑动）。
- 验证：定向 vitest：chat-surface-css-contract + chat-math 47 passed；npm run lint 通过。
- Notes：未提交。行内公式、mermaid/svg、表格、代码块既有溢出保护未动。lint 的 GitToolsPinnedSummary useMemo warning 为既有无关问题，未扩大范围修复。wiki 同步 src/README.md（KaTeX 段）与 components/README.md（scroll-sync 段两处）。

---

## tool-summary-no-ellipsis（done，2026-09-28）

- Goal：工具行长内容不再出现省略号，超长时横向滚动，并完成 build。
- 覆盖：run_command 72 字、generate_image 100 字、present_files 只显示 3 项、子任务跑马灯 80 字，以及工具标题 CSS ellipsis。
- 改动：摘要输出完整文本。工具行和子任务行横向滚动，H5 可触摸滑动，滚动条隐藏。
- 验证：定向 vitest 213 passed；npm run build 通过。
- Notes：展开区输出截断、附件名省略未改。未提交。

---

## run-command-summary-no-ellipsis（done，2026-09-28）

- Goal：run_command 摘要不再显示省略号，长命令可以滚完。
- 根因：摘要被硬截到 72 字并追加 …，父级 overflow:hidden 又裁掉剩余文字。
- 改动：显示完整命令。超长时摘要行横向滚动，H5 可触摸滑动，滚动条隐藏。
- 验证：定向 vitest：chat-surface-css-contract + local-tool-running-sweep 42 passed。
- Notes：未提交。子任务跑马灯截断未改。wiki 无需更新。

---

## edit-diff-long-line-scroll（done，2026-09-28）

- Goal：edit_file 长行在工具卡内可滚动，行背景不露底，H5 可触摸滑动。
- 改动：diff 块锁在列宽内。长代码行用 max-content 铺满背景，行号列 sticky。开启 touch 横滑和纵滑。
- 验证：定向 vitest：diff-view + chat-surface-css-contract 60 passed。
- Notes：未提交。wiki 无需更新，只是现有 diff 的溢出显示。

---

## tool-command-console-scroll（done，2026-09-28）

- Goal：run_command 命令内容特别长时可以滚动，且不要把文字显示成空白。
- 根因：控制台常驻左右渐隐，短行和未滚到的一侧也被遮掉。
- 改动：溢出侧只用内阴影提示，不用 mask 裁字。H5 开启 touch 横向/纵向滚动。内容未超出列宽时不提示。
- 验证：定向 vitest：tool-renderer-shared-state + chat-surface-css-contract 52 passed。
- Notes：未提交。wiki 无需更新，只是现有控制台的溢出显示。

---

## subagent-title-command-gap（done，2026-09-28）

- Goal：子任务输出很长时，标题和后面的命令显示不再中间空出一段。
- 根因：标题和命令跑马灯都是 `flex: 1`，剩余宽度被平分。
- 改动：标题改为按内容收缩，长标题才省略；命令继续吃剩余空间。
- 验证：定向 vitest：chat-surface-css-contract 36 passed。
- Notes：未提交。wiki 无需更新，只是现有摘要行的宽度分配。

---

## composer-console-fixed-width（done，2026-09-24）

- Goal：输入框旁控制台图标弹出的后台命令面板不再被长命令撑宽。
- 改动：菜单固定 `min(22.5rem, 视口)`。长命令在条目内横向滚动，左右高斯模糊渐隐。
- 验证：定向 vitest 11 passed。原有 1 个失败是后台命令单独触发器与旧断言不一致，与本次无关。
- Notes：未提交。wiki 无需更新，只是现有菜单的宽度约束。

---

## background-command-presence（done，2026-09-24）

- Goal：后台命令像 subagent 一样留在对话里，并出现在 Composer 运行摘要中，摘要项可直接关闭。
- 改动：运行中的后台命令不折进过程组。`backgroundCommands` 随会话状态、启动和退出事件同步。摘要列表合并后台命令，关闭按钮复用 abort-tool。退出后原工具结果替换为终态。
- 验证：定向 vitest 79 passed；eslint 与 tsc 通过。
- Notes：未提交。

---

## run-command-background（done，2026-09-24）

- Goal：`run_command` 支持 `run_in_background: true`，分离执行、不阻塞当前回合，跨回合运行到退出，并把完整输出写入日志后发 task-notification。
- 改动：后台命令 detached 启动后立即返回 `outputFile` 与 `taskId`；退出或终止后通知原会话。流式回合走 followUp，空闲回合直接 prompt，活跃 Goal 暂存。会话销毁会停止该会话仍在运行的后台命令。`read_file` 只额外放行命令日志绝对路径。工具卡在后台结果上保持运行态和终止按钮。
- 验证：定向 vitest 3 文件 31 passed；eslint 与 tsc 通过。
- Notes：未提交。后台任务不跨服务重启恢复。

---

## thinking-before-tool-order（done，2026-09-24）

- Goal：思考块先折走后，后续工具行无论追加在组后、插到组前，还是出现在另一条 assistant，第一轮思考仍排在工具前面。
- 根因：只信折走时的 `sourceNextSibling`。锚点还在但前面又插入了节点时，思考会被还原到工具后面，全量重建再按这个 DOM 序收集。
- 改动：失效锚点插回过程组之前；锚点前面的新节点改为插到这些节点之前。`orderRestoredProcessNodes` 再按来源 `message.content` 序号校正同一条 assistant 内的源序。
- 验证：折叠相关 74 passed；eslint 与 tsc 通过。
- Notes：未提交。

---

## android-cloud-removal（done，2026-09-24）

- Goal：移除安卓端已下线的 QuickForge Cloud 原生功能和页面残留。
- 改动：删除 `android/.../remote/` 云隧道源码与测试；取消 `RemoteTunnel` 插件注册、`RemoteTunnelService` 和仅供隧道使用的 WebRTC/OkHttp 依赖；导航白名单去掉云 API 地址。直连页与任务通知保留。
- Notes：前端云页面源码此前已不存在。`android/app/src/main/assets/public/` 仍是旧前端包，需下次 `android:sync` 覆盖。未跑 Android Gradle 构建。已提交。

---

## tool-file-underline-on-name（done，2026-09-23）

- Goal：编写/写入文件时，只有悬停到具体文件名才出下划线，悬停整块「已执行 / 编辑 / 写入」不再出。
- 根因：文件名用 `group-hover:underline`，而工具行 `details` 带 `group/tool`，悬停整行就会给文件名加下划线。
- 改动：文件名改为 `hover:underline`，按钮去掉 `group`。
- Notes：未提交。

---

## inspector-tab-fade（done，2026-09-23）

- Goal：多个 Tab 时变短、无中间分隔线，标题右侧高斯模糊/渐隐替代「…」。
- 改动：多于一个 Tab 在 `min-w-24` / `max-w-32` 之间均分，溢出整条横向滚动；去掉竖线。标题在关闭按钮左侧正常流里 mask 渐隐，文字不覆盖 X。下拉列表当前项与 hover 同色。
- 验证：见本次会话定向测试。
- Notes：未提交；未手工改生成产物。

---

## thinking-before-tool-order（done，2026-09-23）

- Goal：第一轮思考过程不再排到后面出现的工具调用下面。
- 根因：同一条 assistant 内容容器里，思考块先被折走时 `sourceNextSibling` 记成 null；工具行随后 append 进同一容器。全量重建的 `restoreGroupedProcessNode` 走 `append`，思考块落到工具行之后，再按这个顺序重新收集。
- 改动：锚点失效时插回仍在该容器内的过程组之前，不再 append 到容器末尾。有效锚点仍走 `insertBefore`。
- 验证：定向 vitest 5 文件 86 passed（含同容器思考→工具回归）；eslint 通过。
- Notes：未提交；未改生成产物。

---

## thinking-hint-hide-when-thinking-ends（done，2026-09-23）

- Goal：思考过程完成后，思考行右侧不再显示。
- 根因：`processThinkingHintSegment` 只看整条 assistant 的 `isStreaming`。思考写完后模型继续输出正文或工具时，消息仍在流式，右侧尾行提示一直留到 `message_end`。
- 改动：提示只在该思考段仍是 `content` 末块、仍在流式、且没有 `thinkingSignature` 时显示；思考一结束立即走既有淡出。
- 验证：thinking-hint / thinking-streaming-stage / thinking-hint-marquee-inplace 28 passed；process-folding / header-adoption / ownership 74 passed；eslint 通过。
- Notes：未提交；未改生成产物。

---

## stage-collapsed-no-round-flip（done，2026-09-23）

- Goal：用户反馈「工具调用列表默认展开 设置为关闭的时候，就不应该新的一轮消息来了之后展开又收缩反复这样操作，你实现的有问题」。只读定位后给出三种方案，用户选择方案 A：关闭设置 = 内层 stage 全程收起、不自动展开，正在流式的思考行（含尾行提示）改挂过程组 body。
- 根因：`process-folding.ts` 的 `updateProcessStageGroups` 用 `processStageDefaultExpanded() || processStageHasStreamingThinking(stageBody)` 作为 stage 默认值——只要 stage 内含流式思考行就强制展开（为的是不让收起态 `visibility:hidden` 藏住思考行与尾行提示）。但每轮工具调用结束（message_end：bridge isStreaming 翻 false + 工具行出现 → 结构变化 → 组全量重建）新 stage 元素回落到设置默认（收起），下一轮流式思考再把它顶开 → 第 2 轮起逐轮「展开 → 收起」往复。
- 改动：
  1. `src/components/chat/panel-decoration/process-folding.ts`：新增 `processThinkingAssistant`（思考块来源 assistant：processThinkingSources → processNodeOwners → closest assistant bridge）与 `isStreamingThinkingItem`；导出纯函数 `splitStreamingThinkingRuns`（按位置把段内项切成交替 run：liveThinking 挂组 body、其余照常包 stage，保持原顺序——toolCall chunk 先于 message_end 出现时流式思考行也可能夹在工具行之前，故不只抽段尾）；`populateProcessGroup` 仅在设置关闭（`!processStageDefaultExpanded()`）时切分；`updateProcessStageGroups` 的默认值回归纯 `processStageDefaultExpanded()`，删除 `processStageHasStreamingThinking` 与强制展开。
  2. 测试：`thinking-streaming-stage.test.ts` 改写 S2（设置关闭：stage 收起 + 思考行挂组 body + hint 仍 running）、「流式结束收进 stage」、跨 assistant 用例的开合预期、手动收起用例（改用默认展开设置）；新增多轮工具循环往复回归用例；`process-folding.test.ts` 新增 `splitStreamingThinkingRuns` 单测（含夹在工具行之前的形态）。
  3. 文档：`docs/wiki/src/components/README.md`（两份副本）与 `docs/wiki/src/lib/README.md` 的折叠默认值契约改为新规则。
- 验证 / Evidence：定向 vitest 3 文件 61 passed；连带（thinking-hint / thinking-header-adoption / process-folding-ownership 等）6 文件 104 passed；`tests/frontend` 全量 210 文件 2674 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 大小警告既有）；`npm run test` 全量 382 文件 4561 passed / 1 skipped（无失败）。
- Notes：设置默认展开（默认 true）时结构与行为零变化（切分只在关闭时启用）；saved state（用户手动开合）语义、group 默认展开、`appendProcessToolSuffix` 增量与轮指纹、release gate / reading-intent / 滚动时序均未动；观感取舍（用户确认）：本轮思考结束后该思考行随重建收进已收起的 stage（即行消失），但不再有自动开合；无依赖变更；未触碰 dist/package-dist/package-offline；改动未提交（工作区同时有并行会话 thinking-hint-growth-inplace 的改动，同文件不同函数，互不影响）。

---

## compaction-boundary-visible-at-tail（done，2026-09-23）

- Goal：用户要求「压缩时候如果是最新一轮，应该先显示压缩的摘要横线，用户再发送消息」——不要发完消息才知道被压缩。
- 根因：`src/components/chat/panel-decoration/context-compaction.ts` 的 `syncContextCompactionNotice` 以 `compactedUpToIndex >= windowEnd` 判定不渲染并移除横线。自动压缩默认 `keepRecentTurns: 0`（`tailStartForRecentTurns` 直接返回 `source.length`），压缩边界 = 消息总数，恰好等于窗口末尾（压缩覆盖到最新一轮、边界之后没有消息）→ 横线被移除；用户必须再发一条消息让 `messages.length` 超过边界，条件翻成 `<` 才显示。压缩完成时 decorate 已由 `auto_compact_completed` / `messages_replaced` 触发（ChatPanelHost.tsx:1713-1731），所以唯一阻塞就是这个隐藏条件。
- 改动：
  1. `context-compaction.ts`：隐藏条件收紧为 `compactedUpToIndex > windowEnd`（严格越过窗口末尾 = 回滚后消息变短等陈旧状态，仍隐藏）；`alignBoundaryToUserTurn` 补注释说明边界可正好落在列表末尾、回溯到最后一个用户回合的定位与随后追加消息时一致。
  2. `tests/frontend/context-compaction-notice.test.ts`：新增 3 用例（边界 = 窗口末尾显示在最后一个用户回合之前 / 回复追加后横线位置不变 / 窗口化 `messageIndexOffset` 下边界 = 窗口末尾显示）；原「边界越过窗口末尾隐藏」用例保留。
- 时序依据：服务端压缩只发生在新一轮首条 LLM 调用前（pi-agent-core 先 `message_end(prompt)` 提交本轮 user 消息，再 `transformContext` → `maybeAutoCompactSession`），因此边界对齐到的正是本轮用户消息——横线在压缩完成那一刻出现在它上方，与随后回复提交后的位置完全相同，无跳动；重新打开已全量压缩的会话也直接显示。
- 验证 / Evidence：定向 vitest `context-compaction-notice` 7 passed（含新增 3 例）+ 连带 4 文件 52 passed；旧实现红灯验证 2 failed / 5 passed；`npx eslint`（改动文件）通过；`npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run build` 通过（chunk 大小警告既有）；`npx vitest run` 全量 382 文件 4556 passed / 1 skipped（无失败）。
- Notes：只改可见性判断与注释——未动服务端压缩链、`insertBeforeMessageElement`/`alignBoundaryToUserTurn` 定位规则、`windowed-messages` 窗口语义与 release gate；未引入新视觉模式，`DESIGN_LANGUAGE.md` 无需更新；`docs/wiki` 的 panel-decoration 条目只列模块名、无该条件的契约描述，模块职责/公共入口未变，故无需更新（原因记于此）；无依赖变更；未手工修改生成产物（仅验证用 `npm run build` 重新生成 `dist/`）；改动未提交。
- Notes（遗留）：`settings-row-infotip` 仍为 pending，WIP 不在本轮。

---

## thinking-hint-growth-inplace（done，2026-09-23）

- Goal：用户反馈「对话中思考过程中的右侧显示会一句话重复显示两次，我不希望这样」→ 确认位置为思考行右侧尾行提示（hint），按方案 A 修复：只在行切换时整行滚入，同一行内增长就地更新。
- 根因（有复现证据）：hint 是 header 第四槽位 `quickforge-tool-marquee`，其 `ToolMarqueeController` 对任何 text 变化都 `beginRoll`（旧文上滚出 + 新文下滚入，两视图各含 static span，滚入期间同时可见）；装饰层 `syncProcessThinkingHint` 对「同一行内增长」在 300ms 节流窗后同样写 `text`（只是不重触发淡入），于是 260ms 滚入被每 ~300ms 反复触发，两个视图长期同显、内容又是同一句（只差几个字）＝同一句上下两份。用控制器直接跑序列复现：`grow v0[VIS/s=句子A] v1[VIS/s=句子A-grow]`。
- 改动：
  1. `src/lib/tool-marquee.ts`：`sync(text, running, restart = false, roll = true)` 新增 roll 开关，`roll=false` 时 text 变化走 `applyInstant`（就地更新 + 另一视图保持隐藏 + 按既有语义重建横向循环），默认 true 不动 subagent 摘要卡契约。
  2. `src/lib/tool-renderers/shared.tsx`：`QuickForgeToolMarquee` 增 observedAttributes `roll`，`attributeChangedCallback('roll')` 只记录意图（`rollOnChange`，默认 true、connectedCallback 复位），`sync()` 一次性消费并透传第四参；`scheduleRestart` 统一 `sync(true)`。
  3. `src/components/chat/panel-decoration/process-folding.ts`：`syncProcessThinkingHint` 在 textChanged 分支先写 `roll`（`lineSwitched ? 'true' : 'false'`）再写 `text`；标记每次随 text 必写（元素消费后复位，值比较跳过写会丢标记→行切换被误判成就地更新）。
  4. 文档：`DESIGN_LANGUAGE.md` 思考尾行提示条目、`docs/wiki/src/components/README.md` 思考头接管契约两份副本、`docs/wiki/src/lib/README.md` 的 `tool-marquee.ts` 条目。
- 测试：`tool-marquee.test.ts` +2（同行增长就地更新且行切换仍滚入 / 元素 roll 意图透传与一次性消费；原 wiring 两处断言随新签名补 `false, true`）、`thinking-hint.test.ts` +1（roll 意图：增长 false、行切换 true、流式结束清空）、新增 `tests/frontend/thinking-hint-marquee-inplace.test.ts`（jsdom 全链路：真 React `ThinkingBlock` → `decorateProcessThinkingBlocks` → 真 `quickforge-tool-marquee` 元素 → ToolMarqueeController，桩 `Element.prototype.animate` 观察滚入；断言同行增长零纵向滚入 + 恰好一个可见视图 + 文本就地追平、行切换仍两次滚入动画且视图摆位正确、流式结束淡出）。
- 验证 / Evidence：定向 vitest tool-marquee 17 passed、thinking-hint 16 passed、新 jsdom 全链路 1 passed、思考/折叠/跑马灯/接管相关 7 文件 133 passed；**旧实现红灯验证**（临时把 roll 恒写 `'true'`）新用例在症状级断言失败 `expected 0 to have length 2`（同行增长仍触发两次整行滚入），thinking-hint 新用例同时失败，改回后全绿；`npx tsc --noEmit` 通过；`npx eslint`（src + 新测试）通过；`npm run lint` 通过；`npm run build` 通过（chunk 警告既有）；`npm run test` 全量 383 文件 4562 passed / 1 skipped。
- Notes：
  - 上一轮全量中失败的 `tests/server/session-state-repository.test.mjs`（multi-process CAS writer 时序用例）本轮全量通过，确认为并发负载下的 flaky，与本改动无关。
  - 同行增长走就地更新后，横向跑马灯在增长期间会随每次 text 变化重建（与修复前每次滚入结算后 `scheduleHorizontal(..., true)` 的净效果一致：增长停止 400ms 后恢复滚动），长行溢出滚动不因此丢失。
  - 行切换的滚入、淡入（`hint-in`）、300ms 节流、取段规则、release gate 与思考头接管契约均未改动；无依赖变更；未触碰 dist/package-dist/package-offline；改动未提交。

---

## streaming-display-stability（done，2026-09-23）

- Goal：用户明确目标「不希望有展开态闪帧、执行中突然闪烁或重新加载，期望稳定增量显示」。基于只读审查（P1/P2/R1）全量修复，方案经用户确认（P1+P2+R1 全修；R1 选稳定 key 避免提升重挂载）。
- 修复内容：
  1. **P1 展开后视口被拉回底部**（「展开 stage 滚动跳/重新展开感」滚动侧根因）：`scroll-sync.ts` 新增 `READING_INTENT_EVENT`('quickforge:reading-intent') + `emitReadingIntent(target)`（dispatchEvent 存在才派发，兼容 node-env fake 宿主；CustomEvent 浏览器与 node 全局均可用已验证）；`setup()` 在 panel 上监听并 `disableAutoScroll()`，`cleanup()` 摘除。发射端：`process-folding.ts` group `toggleExpanded` / stage `onclick` 从开关元素冒泡；`ThinkingBlock.tsx` pointerdown 与键盘 click（detail===0）路径 `emitReadingIntent(event.currentTarget)`。跟随解除后按既有语义滚回距底 <10px 重挂（复用 disableAutoScroll，无新滚动模式）。
  2. **P2 替换路径一帧「已释放未重折叠」**：删除 `ChatPanelHost` 事件回调中的 `releaseStreamingProcessGroups(panel)` 预释放（1711）与 import；结构性释放全归 `ProcessGroupReleaseBoundary`（同提交释放 + `componentDidUpdate` 同步重折叠）；服务端 `auto_compact_completed` 必跟 `messages_replaced`（server/auto-compaction.mjs:274-288）保证结构提交必经 boundary；原两次 decorate rAF 兜底保留。`releaseStreamingProcessGroups` 无生产调用后随删除（process-folding.ts + panel-decoration.ts 桶导出），thinking-streaming-stage 测试 3 处改用 `releaseProcessGroups`（boundary 语义）。
  3. **R1 提升整树重挂载**：`ChatPanelHost` 新增 `agentRuntimeScopeId?: string` prop，ChatSurface key 改 `agentRuntimeScopeId ?? agent.sessionId`；`App.tsx` 传 `agentManager.currentRuntimeScopeId`。提升时 runtimeScopeId 保持 `pending-*`（useAgentManager.attachTaskToView(task, previousAgent.sessionId) 既有行为）→ 同 key 原地更新，乐观用户行 DOM 保留（readAgentSnapshot 身份复用使 MessageArea memo bail、零 DOM 写）；会话切换 runtimeScopeId=目标 sessionId → 仍整树重建；分享页/侧聊未传 prop → 回退 sessionId 语义不变。
- 改动文件：见 feature_list.json 本条目（6 源码 + 5 测试 + wiki + 3 状态文件；新增 tests/frontend/chat-surface-agent-swap.test.ts）。
- 验证 / Evidence：定向 vitest 17 文件 272 passed（scroll-sync 19 含 reading-intent 3 新例、thinking-block-interaction 4 含 emit 1 新例、thinking-streaming-stage 12 含 stage/group emit 2 新例、chat-surface-agent-swap 2（jsdom：行 DOM 身份保留 + 提升后事件跟随）、behavior-alignment 10 含稳定 key / 无预释放 2 新契约、ownership/release-refold/streaming-handoff 回归 26、扩大面 203）；npx eslint（改动文件）通过；npx tsc --noEmit 通过；npm run lint 通过；npm run build 通过（chunk 警告既有）；npm run test 全量 382 文件 4553 passed / 1 skipped（本轮 4 个此前 dev 基线失败的 server 测试亦通过）。
- Notes：
  - 展开即解除跟随是「阅读意图」语义：解除后不再跟随流式尾部（回到底部按钮可返回，滚回 <10px 自动重挂）——与 turn-navigation 的 beginProgrammaticScroll 先例一致的取舍。
  - R1 依赖的既有时序（realAgent.prompt 在 React 刷新前同步乐观插入用户消息）未改动；jsdom agent-swap 测试已把「同 key 换 agent 不 remount、行 DOM 保留」固化为回归。
  - 子代理 trace（SubagentRunDetailContent 内的展开件）未接 reading-intent 事件（当前无用户反馈指向它）；如真机仍有该场景跳动，同模式补发即可。
  - 既有失败登记（与本次无关，dev 基线即失败）：tests/server/sqlite-quick-check-gate.test.mjs（1）、tests/server/acp/server-channel-source.test.mjs（1）、server.workspace-mapping.test.mjs（2）。
  - settings-row-infotip 仍为 pending，WIP 不在本轮。

---

## message-end-inplace-commit（done，2026-09-23）

- Goal：在新分支 `fix/message-end-remount-flicker` 上根治「思考过程结束后对话刷一下」——消除 message_end 时流式消息跨 React 子树的 unmount/remount（用户选定完整版：流式行进 MessageList + release gate 改渲染序列比较）。
- **三轮修复（用户反馈「展开 stage 时特定节点滚动跳/重新展开感」）**：工具循环的三个释放源已全部消除——(a) toolResult upsert（不可渲染行，不参与 gate 序列）；(b) message_end 同身份转正（同 key，序列不变）；(c) 下一轮流式 assistant 行出现（**纯尾部追加**，前缀匹配放行：React 只在列表尾 appendChild，已有行 memo bail 零 DOM 写，折叠组节点不受触碰）。至此工具循环全程（思考→工具→结果→下一轮）折叠组**零释放零重建**，仅 update/增量路径运行。剩余已知释放点：行删除/重排/身份替换（rollback、compaction、messages_replaced——低频且必要）。已排除的候选：stageKey 振荡（processTurnStateKey 以 turnIndex+首 assistant timestamp 构成，轮内稳定，saved 展开状态不失效；expandProcessStageByDefault 默认 true）；scrollToBottom 双 rAF 与 ≤1px 守卫；hint/stageLabel 均已值守卫。若真机仍有抖动，下一步用调试脚本（见 Next Session）捕获 scrollTop/scrollHeight 跳变序列定位滚动侧根因（候选：贴底跟随与展开阅读冲突、或装饰层 rAF 与 scrollToBottom rAF 的帧内顺序）。
- 根因：`ChatSurface` 双容器结构（MessageList 完成消息 + `.qf-streaming-message` 流式消息）。`message_end` 时 `streamingMessage` 清空、消息 upsert 进 `messages`，流式容器内整棵 AssistantMessage unmount，同一条消息以全新 DOM 挂进 MessageList（代码注释明言 "an unmount/remount"）。可见后果：展开的思考块 `isExpanded` 弹回收起、代码高亮/图片/动画重置、装饰层重建折叠组并 reparent 节点（重启 animate-spin）。此前 4 个 flicker feature 只能同帧压制，结构性迁移仍在。
- 关键可行性事实（已验证源码）：pi-ai 流式 partial 与 final 是同一 `output` 对象（`timestamp: Date.now()` 流开始一次赋值、`result()` 返回同一对象），agent-manager 原样透传 → 流式行与提交行 `messageRenderIdentity` 恒同；光标 span 本就被 CSS 隐藏（streaming 时 `display:none`、容器只有光标时整容器隐藏），AssistantMessage 移走后容器恒自隐藏、无观感变化。
- 改动：
  1. `MessageList.tsx`：新增 `streamingAssistant` prop，流式 partial 渲染为列表最后一行（key=`messageRenderIdentity`、Provider 只包该行、`hidePendingToolCalls`）；已完成行照旧 memo bail out，流式帧成本与旧结构等价。
  2. `ChatSurface.tsx`：流式容器只剩光标锚点；`MessageArea` 构造渲染序列（messages + 流式行）交给 boundary；`ProcessGroupReleaseGate` 删除 `isStreaming`/`streamingAssistant` 字段，`shouldReleaseProcessGroups` 收敛为纯序列 key 比较；清理未用导入/props（toolResultsById、AssistantMessage、AssistantStreamingContext、useMemo、collectToolResultsById）。
  3. `message-actions.ts`：`getStreamingAssistantMessage` 改为在 `.qf-message-list` 内按 bridge `isStreaming === true` 从尾部定位流式行；`getMessageElements` 过滤流式行（行级装饰职责与旧结构等价，避免流式行被收集两次/误入行级装饰）。
  4. `surface-context.ts`：Provider 位置注释更新。
  5. 测试：release-gate（message_end 同身份不释放 / abort 清空释放 / 纯流式帧序列形式）、release-refold（同上场景 + 新增 message_end 转正跳过用例）、process-folding-ownership（同上 + 新增 DOM 级「转正折叠组完好」用例）、behavior-alignment（源码断言改为 MessageList 内 Provider）、chat-surface-render 新增「流式行在列表内、光标容器之前」用例。
  6. `docs/wiki/src/components/README.md`：MessageList 构建规则 + process-folding gate 语义两处条目（各有两处副本，已同步）。
- 验证 / Evidence：定向 vitest 全绿（chat-surface 39、process-folding 系 70、message-actions/context-compaction 49、thinking/code-block/subagent 148）；`npm run test` 全量 4530 passed / 4 failed，4 个失败（sqlite-quick-check-gate 1 + acp 3）经 `git stash` 基线对比确认 dev 上同样失败、与本次无关；`npm run lint`、`npx tsc --noEmit`、`npm run build` 全部通过。
- Notes：
  - 同 timestamp 重复 assistant 行的 key 撞车（agent-loop 不产生）：四轮起由 `messageRenderKeys` 的 occurrence suffix 在合并 key 数组上消歧，不再撞 key。
  - `message_end` 帧仍有 React 局部 DOM 变化（usage 行出现、shimmer 类切换、光标容器卸载）——均为节点内部更新，折叠组不持有、零搬移；这是与旧「整行销毁重建」的本质区别。
  - 既有失败登记：tests/server/sqlite-quick-check-gate.test.mjs（1）、tests/server/acp/server-channel-source.test.mjs（1）、tests/server/acp/server.workspace-mapping.test.mjs（2）在 dev 基线即失败，待后续单独排查。
  - 分支 `fix/message-end-remount-flicker`（自 dev b633016 切出）已提交 `04be17f`、`--no-ff` 合并进 dev（`b9d6656`）并推送 origin/dev；未修改生成产物；依赖仅四轮新增 devDependency `jsdom`（package.json/package-lock.json 同步）。
- **四轮修复（代码评审 P1/P2，2026-09-23）**：
  - P1（高）：「同 key 就地转正」实际未生效——流式行外层 `AssistantStreamingContext.Provider`（元素类型前后不一致）与 `items.map` 之后的独立 JSX slot（隐式 index-keyed 子节点、独立 reconcile scope）都会让 `message_end` remount 整行。修复：`MessageList` 把已提交行与流式行推进同一个 `rows` 数组（`rows.push`），key 由合并数组 `[...messages, streamingAssistant]` 经 `messageRenderKeys` 一次计算；Provider 移入 `AssistantMessage` 内部（`surfaceStreaming || isStreaming`，subagent trace 整树语义不变），行元素类型前后一致。
  - P2（低）：流式行 key 原用裸 `messageRenderIdentity`，同 timestamp 撞车时与已提交行重复 key；合并 key 数组后由 occurrence suffix 消歧且两态一致。
  - 新增 `tests/frontend/chat-surface-streaming-handoff.test.ts`（`// @vitest-environment jsdom` + react-dom/client 真实生命周期：DOM 节点身份断言就地转正 / 身份变更仍 remount / 重复身份不撞 key）；旧实现红灯验证 2 failed + control 1 passed。`tests/frontend/chat-surface-behavior-alignment.test.ts` 源码契约随新结构更新。
  - 依赖变更：新增 devDependency `jsdom`（本轮唯一依赖变更）——真实 React reconciliation 回归测试需要 DOM 渲染器，原 Node-only 测试栈（renderToStaticMarkup + 源码断言）无法断言 remount（P1 正是因此漏过）。
  - 验证 / Evidence（四轮）：定向 vitest 7 文件 83 passed（streaming-handoff 3 + behavior-alignment 8 + render 17 + message-list 19 + release-gate 13 + release-refold 5 + ownership 18）；旧实现红灯验证 2 failed + control 1 passed（证明新用例确实能抓住 remount/重复 key 回归）；npm run test 全量 381 文件 4536 passed / 4 failed / 4 skipped——4 个失败为 dev 既有基线（sqlite-quick-check-gate 1 + acp 3，上方 Notes 已登记，与本轮无关）；npm run lint 通过；npm run build 通过（chunk 警告既有）。

---

## plugins-page-visual-polish（done，2026-09-23）

- Goal：优化「设置 → 插件」界面样式——用户选择「视觉微调 + 工具列表展示（同 MCP 卡片：最多 12 个 + 省略）」。
- 现状问题：列表项只显示名称+描述+开关且用 `--column` 变体包一层冗余 header；插件 tools 数据完全不展示；开关无 aria-label；空状态搜索路径 chips 平铺、长路径换行不齐。
- 改动：
  1. `src/components/plugins/PluginsPage.tsx`：提取导出 `PluginListItem`（结构对齐 MCP 卡片：`list-item` + `list-item-main` + `list-item-actions`）；meta 行渲染工具 chips（`label || name` 文本、`title = description || quickForgeName`，`VISIBLE_PLUGIN_TOOLS = 12`，超出折叠为 `pluginMoreTools` 的 +N muted 徽章）；开关补 `aria-label`（`pluginEnabledSwitchLabel`）；禁用插件在 article 上标 `data-quickforge-plugin-disabled="true"`；空状态搜索路径改 `quickforge-settings-meta quickforge-settings-code-list` 纵向列表；discovery 错误行加 `mt-0.5 leading-relaxed`。
  2. `src/index.css`：`data-quickforge-plugin-disabled='true'` 时 `list-item-main` opacity 0.55（过渡 160ms 挂在 `list-item-main` 基础类，启停双向平滑）。
  3. `src/lib/i18n.ts`：新增 `pluginMoreTools`（'+{count}'）、`pluginEnabledSwitchLabel`（'Enable plugin {name}' / '启用插件 {name}'）。
  4. 新增 `tests/frontend/plugins-page.test.ts`（9 用例：zh/en 本地化文案与开关 label、12+N 折叠、无折叠分支、label/title 优先级、禁用标记与受控开关、启用不标记、错误 alert）。
- 验证 / Evidence：定向 vitest 9 passed；连带 mcp-server-card + settings-react-infrastructure + decorator-copy-i18n + i18n-language-snapshot 30 passed；npx eslint 通过；npx tsc --noEmit 通过；npm run build 通过（chunk 警告既有）。
- Notes：测试要点——静态渲染断言用 `renderToStaticMarkup`，受控 `checked=false` 不输出属性、需经函数调用组件取元素 props（同 mcp-server-card.test.ts 模式）。未加状态徽章/版本/来源信息（用户明确只要视觉微调 + 工具展示）；无依赖变更；未修改生成产物；改动未提交。

---

## thinking-end-refold-flicker（done，2026-09-23）

- Goal：消除「思考过程之后界面闪一下」——思考段结束/整轮提交那一帧被真实绘制的「未折叠」状态。
- 根因：折叠组借用了 React 渲染的节点，`ProcessGroupReleaseBoundary.getSnapshotBeforeUpdate` 必须在提交前 release（节点搬回原位 + 解除 `data-quickforge-process-folded`，即恢复显示），但重新折叠排在 `ChatPanelHost` 的下一个 rAF（`requestSurfaceDecorate` → `scheduleDecorate` → `requestAnimationFrame`）——中间整整一帧「未折叠」被浏览器 paint，观感即闪一下。`ChatSurface.tsx` 的注释与 `session-handoff` 早先记录都已点名这个跨帧空档（同项目 `SubagentTrace` 早已是同提交内同步重折叠）。
- 改动：
  1. `ChatSurface.tsx`：`getSnapshotBeforeUpdate` 只做 release 并返回「是否真的交还了组」作为 snapshot；`componentDidUpdate(_, _, released)` 为真时才调 `onReleased`（同帧）；`componentWillUnmount` 只防御性释放；相关注释（boundary / MessageArea / Props）改成同一提交口径。
  2. `ChatPanelHost.tsx`：新增 `requestSurfaceDecorateNow`（`decorateFnRef` 就绪且不在装饰中 → 同步跑完整 decorate pass；否则回落 `scheduleDecorate` 的 rAF 兜底），`onProcessGroupsReleased` 改传它；`runDecorate` 增加 single-flight 守卫（`decorateInFlightRef`）。
  3. `process-folding.ts`：`releaseProcessGroups` 文档口径改为「同一 task 内重折叠」。
  4. `docs/wiki/src/components/README.md`：process-folding 所有权租约条目（315 与 635 两处副本）同步新契约。
- 测试：新增 `tests/frontend/chat-surface-release-refold.test.ts`（4 用例：释放阶段不回调 / `componentDidUpdate` 同帧才回调 / 未交还组不回调 / 纯流式帧两半都跳过 / 卸载只释放）；`tests/frontend/process-folding-ownership.test.ts` 4 处断言改为 snapshot 驱动 `componentDidUpdate`。
- 验证 / Evidence：定向 vitest 32 passed（refold 4 + ownership 18 + release-gate 10），另一批 13 文件 230 passed；`npm run test` 全量 379 文件 4525 passed / 1 skipped；`npm run lint` 通过；`npm run build` 通过。
- Notes：未改 release gate 判定与 `releaseProcessGroups` 的释放规则，只改「何时请求重折叠」；未动思考头接管/尾行提示动效与滚动时序。风险：同步装饰 pass 会在 React layout 阶段跑一次（含强制 layout 读取），仅发生在真正交还过组的提交帧；`runDecorate` 的 single-flight 守卫也可能吞掉"装饰中再次请求"的场景，此时由 rAF 兜底补一次。无依赖变更；未修改生成产物；改动未提交。

---

## thinking-end-refresh-flicker（done，2026-09-23）

- Goal：消除「思考过程结束之后页面重新刷一下」——思考段结束（`isStreaming` 翻转、正文开始输出）那一帧的可见重排。
- 根因（两处，同一帧）：
  1. 思考头接管路径（`decorateProcessThinkingBlocks`）在 React 重写 chevron/label 的 class 后短路失效，旧实现无条件重写 `label.textContent`（销毁重建文本节点）并 `prepend`/`append` 重排 header 子级——移动子级会重启其 CSS 动画（hint 淡入、跑马灯滚入），整行因此抖一下。
  2. 轮指纹 `processTurnFingerprint` 把终答 markdown 也算进结构，正文首次出现即被判为结构变化 → full 重建：整组节点搬动两次、组元素连同高度过渡一起重建。
- 改动文件：src/components/chat/panel-decoration/process-folding.ts（最小写路径 + 指纹排除 `excludeNode`，`decorateProcessTurn` 调整顺序）、tests/frontend/thinking-header-adoption.test.ts（+1 用例）、tests/frontend/process-folding.test.ts（+1 describe / 2 用例，含 fake assistant 指纹夹具）、docs/wiki/src/components/README.md（契约条目补充）、feature_list.json、progress.md、session-handoff.md。
- 验证 / Evidence：定向 vitest 8 文件 109 passed、2 文件 55 passed；npm run test 全量 4521 passed / 1 skipped；npm run lint 通过；npm run build 通过。
- Notes：指纹只排除「终答 markdown」，中间（可折叠）markdown 仍计入，结构变化仍走 full；未改释放/交还契约与 release gate，未动尾行提示滚动时序与对齐。无依赖变更；未修改生成产物；改动未提交。

---

## thinking-hint-align-left（done，2026-09-23）

- Goal：思考过程右侧的尾行提示文字（含行切换滚入）不要居中，改为靠左。
- 根因：接管后的思考头是 `<button>`，UA 默认 `text-align: center` 被继承到 header 第四槽位 `quickforge-tool-marquee`（hint）内部的静态度省略文本与纵向滚入的 static 视图上；横向滚动视图 `.quickforge-marquee-moving` 本身绝对定位在 `left: 0`，因此「静态/滚入居中、滚动靠左」不一致。装饰层把 header className 重置为 `thinking-header quickforge-process-thinking-header`，丢掉了可兜底的 `text-left`（子代理工具行 `<button>` 自带 `text-left`，所以只有思考过程暴露）。
- 改动文件：src/index.css（`.quickforge-process-thinking-hint` 显式 `text-align: left` + 注释）、tests/frontend/chat-surface-css-contract.test.ts（新增对齐契约断言）、feature_list.json、progress.md、session-handoff.md。
- 验证 / Evidence：定向 vitest 49 passed；连带 5 文件 76 passed；npx eslint 通过（src/index.css 被 eslint 配置忽略，属既有设定）。
- Notes：纯对齐修正，未改滚动时序/淡入淡出/字号，未动 subagent 跑马灯；无需更新 DESIGN_LANGUAGE.md 与 docs/wiki（未改模块职责、公共入口、发布流程，原因记于此）。无依赖变更；未修改生成产物；改动未提交。

---

## thinking-expand-flicker（done，2026-09-23）

- Goal：修复「运行中点击「思考过程」展开后页面一直重刷/闪烁」——定位并消除过程折叠层与终答 markdown 判定的逐帧互翻。
- 根因：流式期间 `ThinkingBlock` 展开会在 thinking-block 内渲染 `MarkdownBlock`（tag/class 命中 `PROCESS_DETAIL_NODE_SELECTOR`），`collectProcessTimeline` 的 filter 只按 owner/previousByNode 判定、未排除嵌套 detail，于是它被当折叠项搬进过程组 step；父链一变，`markdownCandidates`（按父链上最近的过程节点排除 thinking 内 markdown）不再排除它，它反而成为流式终答 markdown 候选并从折叠项中剔除；下一帧 full 路径的 `restoreProcessTurn` 又把它送回 thinking 块 → 每帧「收集→搬走→判为终答→归还」互翻，整组每帧全量重建、每个被折叠节点每帧搬动两次并重启 CSS 动画。
- 改动文件（4 个源/文档 + 3 个状态文件）：src/components/chat/panel-decoration/process-folding.ts（新增导出 `isFoldableProcessTimelineNode(node, trackedOrOwned)`；`collectProcessTimeline` filter 改用它）、tests/frontend/process-folding.test.ts（+2 回归用例）、docs/wiki/src/components/README.md（process-folding 所有权租约条目补折叠收集口径）、feature_list.json、progress.md、session-handoff.md。
- 验证 / Evidence：定向 7 文件 vitest 99 passed；npm run test 全量 378 文件 4518 passed / 1 skipped；npm run lint 通过；npm run build 通过。
- Notes：判定刻意**不**含「位于过程组内即非顶层」——组内节点父链无 detail 祖先、仍算顶层并被收集，`appendProcessToolSuffix` 增量追加与指纹短路依赖该序列稳定，加组内判定会让每帧全量重建（已在测试中固化）。修复会让工具卡/思考块内部的嵌套 markdown 一并退出折叠收集，属同口径修正。无依赖变更；未修改生成产物；改动未提交。

---

## harness 状态重置（done，2026-09-22）

- Last Updated: 2026-09-22
- Goal：三个状态文件（feature_list.json / progress.md / session-handoff.md）被清空为未提交空模板，导致无法恢复上下文；先按既有惯例把 HEAD 内容归档到 docs/archive/ 三个归档文件，再将主状态文件重置为全新状态。
- 改动文件（6 个）：feature_list.json、progress.md、session-handoff.md、docs/archive/feature-list-archive.json、docs/archive/progress-archive.md、docs/archive/session-handoff-archive.md。纯记录搬移，未动生产代码/测试/wiki。
- 验证 / Evidence: node JSON.parse 校验 feature_list.json 与 docs/archive/feature-list-archive.json 均通过；git status --porcelain 确认本次仅改动上述 6 个允许文件。
- Notes：工作区未提交 WIP 混杂两个主题（thinking-tail-hint 为主、settings-row-infotip 次要）；ChatSurface.tsx 有一处 pb-0→pb-4 归属不明改动；旧 progress 记录中的 4 个服务端测试失败与 flaky 登记随归档保留，但需后续重新验证是否已修复；docs/archive/feature-list-archive.json 历史条目引用的 docs/wiki/README.md:3 段落本次已删除（历史条目按惯例原样保留不回改）。

---

## thinking-tail-hint（done，2026-09-22）

- Goal：完成并验证 thinking-tail-hint——思考行尾行提示在真实 Chromium 下可正常显示，且跨 assistant 折叠 reparent 后归属/序号正确。
- 改动文件：src/components/chat/panel-decoration/process-folding.ts、src/index.css（另含 feature_list.json 列出的测试/文档文件与 tests/frontend/process-folding-incremental.test.ts）。
- 修复内容：
  1. 真实 Chromium 零宽根因与 `width:100%` 修复——header 未撑满导致尾行提示/跑马灯零宽不可见，为 `.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header` 补 `width:100%`。
  2. 跨 assistant reparent 的 source assistant / ordinal 修复——折叠后节点被搬进其它 assistant 组时，processNodeOwners/processThinkingSources 的 seed 与序号重排修复，groupedProcessNodeHasCurrentReplacement 改按 source index 判定替换。
  3. TS18048 及 ordinal 边界修复。
- 验证 / Evidence：定向 7 文件 vitest 128 passed；npm run lint 通过；npm run build 通过；npm run test 全量 4516 passed / 1 skipped。
- Notes：无依赖变更；未修改生成产物（dist/package-dist/package-offline）；本次改动未提交。
  - 本次状态文档一致性修复（2026-09-22）：仅同步 feature_list.json / progress.md / session-handoff.md，删除残留的 thinking-tail-hint in_progress 与“待验证”表述；未改源码、测试、Wiki 与生成产物。
  - Wiki 表述：本次修复不需要新增架构文档（未改变公共入口/模块职责）；工作区 docs/wiki 下已有 WIP 改动（docs/wiki/README.md、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md）不属本次修复，未回滚。
  - settings-row-infotip 仍为 pending，WIP 在同一工作区待验证；ChatSurface.tsx 的 pb-0→pb-4 属无关既有改动，本次未触碰。
