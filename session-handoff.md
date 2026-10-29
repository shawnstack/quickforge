# Current Session Handoff

## dreaming-prune-settings-and-auto-delete（done，2026-10-29）

- Current Objective（当前目标）：把 `NOTE_PRUNE_MIN_NOTES=40` / `NOTE_UNUSED_DAYS=60` 放进梦境记忆的「高级配置」，并新增「到期自动删除」。
- 结论（一句话）：四个 `prune*` 设置字段（`pruneStaleNotes` / `pruneMinNotes` / `pruneUnusedDays` / `pruneMaxRecalls`）+ 设置页折叠的高级配置；开关关闭时冷笔记仍只是候选段，开启后在**模型运行前**按「距 `created_at` ≥ N 天 且 召回次数 ≤ M」直接删除并记入 `operations.pruned`。
- 改动文件：`server/dreaming/settings.mjs`、`server/dreaming/runner.mjs`、`server/sqlite/dreaming-repository.mjs`（`toRun` 白名单补 `pruned`）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`、`tests/server/{dreaming-memory,dreaming-runner}.test.mjs`、`tests/server/routes/dreaming{,-detail}.test.mjs`、`tests/frontend/dreaming-prune-settings.test.ts`（新）、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- 关键约束（别踩）：
  - `toRun()` 的 operations 是白名单，新增字段必须同时加在那里，否则 API 与前端都拿到 `undefined`（本轮真实踩过）。
  - 无 stat 行的手写笔记绝不能自动删除：`created_at` 未知不等于「很老」。
  - 漂移告警与 summary 的基准是 `notesForModel`（模型看到的列表），不是原始笔记数；否则「先删一批」会被误判成记忆漂移。
  - 被删条目**不在**本轮 `notesAfter` 里，所以在「运行详情 → 恢复到该版本」对这个 run 无用；要找回只能恢复到更早一次 run。
  - 前端数字输入的「外部值变化 → 重置草稿」必须用渲染期调整 state，不要写成 `useEffect` + `setDraft`（`react-hooks/set-state-in-effect` 会报错）。
- Blockers（阻塞）：无。
- Evidence（验证）：dreaming 服务端 4 files / 68 tests 全过；前端契约 4 tests 全过；`npx tsc -b` 0 错误；`npm run lint` 0 problems；`npm run build` 成功；`npm run test` 全量结果见本次会话收尾记录。未创建 Git commit。
- Next Session（下一步）：
  1. 真机：设置 → 梦境记忆 → 高级配置 → 开「到期自动删除」，把冷笔记天数临时调成 1，点「立即处理」，确认 `DREAMING.md` 里超过 1 天的笔记消失、运行详情出现「到期自动删除」分组且 summary 带「其中到期自动删除 N 条」。
  2. 关掉开关再跑一次：确认候选段 `## Never recalled` 回来、笔记不再被自动删。
  3. 手写一行笔记进 `DREAMING.md` 再跑：确认它不会被删（无 stat 行）。
  4. 老用户升级后第一轮不会成批删除（`created_at` 从此轮开始算），若要提前验证可把 `pruneUnusedDays` 设为 1 并跑两次。

## rollback-orphan-assistant-turn（done，2026-10-29）

- Current Objective（当前目标）：去掉对话回滚「没有可回滚的对话轮次」的限制——任何情况下点回滚都必须能滚，不弹拒绝提示。
- 结论（一句话）：回滚拒绝路径清零：`rollbackStartIndexFromMessage`（前后端同构）把索引 clamp 进有效范围、非 user 角色统一回退到本轮 user（找不到以自身截断），仅空会话返回 -1 静默无操作；服务端删 400 分支；前端三处调用点删弹窗守卫；i18n 死 key 删除。
- 根因（第一轮没修完）：回滚按钮传的全量 index 来自 UI 窗口数组，点击瞬间读的权威数组可能与之瞬时错位（压缩替换 / 乐观尾插 / 会话切换），index 落在 toolResult 或越界 → -1 → 弹窗。
- 改动文件：`src/lib/message-utils.ts`、`server/agent-manager.mjs`（含 `rollbackSessionMessages` 删 400）、`src/hooks/useChatActions.ts`、`src/components/share/SharedConversationPage.tsx`、`src/lib/i18n.ts`（删 `noConversationTurnToRollback` en/zh）、`tests/frontend/message-utils.test.ts`、`tests/server/rollback-start-index.test.mjs`、`feature_list.json`、`progress.md`、本文件。
- 关键约束（别踩）：
  - 前后端两份 `rollbackStartIndexFromMessage` 必须同构（服务端权威，前端先本地预览再调服务端）。
  - `-1` 语义 = 空会话无操作（静默），不是错误；不要再往回加「没有可回滚」弹窗。
  - 锚点非 user 时草稿回填空串是预期（无用户原文可恢复）。
- Blockers（阻塞）：无。
- Evidence（验证）：回滚相关 6 files / 50 tests 全过；i18n 快照 2 files / 15 tests 全过；`npx tsc -b` 0 错误；eslint 改动文件 0 problems；`npm run build` 成功。未创建 Git commit。
- Next Session（下一步）：
  1. 真机：原来报「没有可回滚的对话轮次」的那个对话再点一次回滚，应直接成功截断。
  2. 回归：正常轮回滚、报错轮回滚、压缩后的会话回滚行为正常。

## dreaming-run-detail-shadcn-ui（done，2026-10-28）

- Current Objective（当前目标）：优化「梦境记忆」运行详情 UI，参考 shadcn ui。
- 结论（一句话）：详情页重构为 shadcn 卡片结构（页头徽标区 → 语义色统计瓦片 → 错误告警 + 结论 + +/−/✕ 行 diff + 折叠原始响应 → 页脚恢复区），并顺手修掉原始响应 `<pre>` 引用不存在 CSS 类导致一直无样式的 bug；详情此前不显示 `run.summary`，本轮补上。
- 改动文件：`src/components/dreaming/DreamingSettingsTab.tsx`（RunDetail 重构 + 新 `StatStrip`/`DiffList`，总览卡改用 StatStrip）、`src/styles/settings/dreaming.css`（alert/diff/stat-tone 新类 + `.quickforge-dreaming-code` 边距修正）、`docs/architecture/dreaming-memory.zh-CN.md`（前端节同步）、`docs/design/dreaming-run-detail.html`（静态预览，新）、`feature_list.json`、`progress.md`、本文件。
- 关键约束（别踩）：
  - tone 色只落在 diff 标记、分组标题和统计数值上，正文保持 `--foreground`——整行染色会伤长句可读性。
  - `dropped` 行的 `reason` 是独立小字行，不要拼回「内容（原因）」字符串（那是旧实现）。
  - 统计条与总览卡共用 `StatStrip`；`data-tone` 只接受 `added/removed/dropped`，配色复刻 `.quickforge-dreaming-metrics` 的三组 color-mix 配方，别另开新色。
  - i18n 零新增：`dreamingRunBack` / `dreamingRunSummary` / `dreamingRunNoOperations` 等都是既有 key，别重复添加。
- Blockers（阻塞）：无。
- Evidence（验证）：`npx tsc -b` 0 错误；eslint 改动组件 0 problems；`npx vitest run tests/frontend` 全量 267 files / 3220 passed；`npm run build` 成功。未创建 Git commit。
- Next Session（下一步）：
  1. 真机：设置 → 梦境记忆 → 运行历史 → 点开一条成功 run：看页头徽标行、六个统计瓦片（新增绿 +N / 移除红 -N）、+/−/✕ 三组 diff（丢弃行应有原因小字）、折叠的原始响应展开后是等宽灰底代码块；页脚「恢复这些笔记」。
  2. 点开一条失败 run：错误应为浅红告警条带三角图标，变更区显示「本次运行没有产生变更」。
  3. `docs/design/dreaming-run-detail.html` 可直接浏览器打开目检深浅两色。

## compaction-remove-skip-gates（done，2026-10-28）

- Current Objective（当前目标）：移除自动压缩的三道静默跳过门槛——`minSourceChars`(1600)、30 秒压缩间隔、拒绝后 10 分钟抑制；「上下文不够（过阈值）就该压缩」。
- 结论（一句话）：`maybeAutoCompactSession` 过阈值后的前置只剩结构性检查（可压缩消息 ≥2 条、自上次压缩后有新消息）；拒绝只跳过当前尝试，下次过阈值重新询问。
- 改动文件：
  - 服务端：`server/auto-compaction.mjs`（删两个常量、三个 suppression helper、minSourceChars 参数与两处 gate；二次追补后不再向 `compactConversation` 传 `minSourceChars`）、`server/agent-compaction.mjs`（手动命令调用点去掉 `minSourceChars: 0`）、`server/conversation-compaction.mjs`（二次追补：删除 `MIN_SUMMARY_SOURCE_CHARS` 常量、`minSourceChars` 参数与字符地板，跳过条件只剩 `compactRange.length === 0`）、`server/agent-approval-orchestrator.mjs`（评审追补：修正「suppress for 10 minutes」陈旧注释）。
  - 前端：`src/lib/auto-compact-settings.ts`（默认值/类型/normalizer 删字段）、`src/components/settings/tabs/DefaultOptionsSettingsTab.tsx`（save 不再带 `minSourceChars: 1600`）。
  - 测试/文档：`tests/server/auto-compaction-history.test.mjs`、`tests/server/auto-compaction-notice.test.mjs`（decline 不再记录抑制）、`tests/server/agent-compaction.test.mjs`、`tests/frontend/settings-normalizers.test.ts`、`tests/frontend/default-options-settings-react.test.ts`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- 关键约束（别踩）：
  - `not_enough_new_messages` 必须保留：它是滚动压缩防空转的结构性护栏（没有新增量就不压），也天然截断「摘要压摘要」循环；不要当成保护性门槛删掉。
  - `lastAutoCompactRejected` 不再写入，但 `resetSessionCompaction` / agent 初始化的置空保留（兼容旧持久化数据），`tests/server/agent-compaction.test.mjs` 有断言。
  - `conversation-compaction.mjs` 已在二次追补中彻底删除 `MIN_SUMMARY_SOURCE_CHARS` / `minSourceChars`；`compactConversation` 唯一跳过条件是结构性的 `compactRange.length === 0`（如 `/summary keep=N` 大于实际回合数时留不出可压缩段）。
- Blockers（阻塞）：无。
- Evidence（验证）：`npx tsc -b` 0 错误；`npx eslint 改动文件` 0 problems；`npx vitest run` 压缩+设置相关 8 个测试文件 84 例全过；评审追补后 5 个压缩测试文件 57 例全过、eslint 0 problems；二次追补（删除 `MIN_SUMMARY_SOURCE_CHARS` 本体）后同 5 文件 57 例全过、`feature_list.json` parse 通过、eslint 0 problems、源码 `git grep` 零残留。未创建 Git commit。
- Next Session（下一步）：
  1. 真机自测：设置→默认选项把阈值调到 50、关确认，长会话连灌长文本，间隔几秒就应连续压缩出多条线（不再需要等 30 秒）；拒绝一次后下一次请求应重新弹决策行。
  2. 上一 feature 的真机待验项（多线位置/窗口钳制）仍有效。
  3. 剩余压缩问题（审批超时无抑制、摘要失败无退避、摘要请求不接 abort signal、决策行点击无反馈、窄屏 pill 溢出）仍未处理，按需另开 feature。

## compaction-timeline-history（done，2026-10-28）

- Current Objective（当前目标）：让「每次上下文压缩」都在时间线上留一条分割线，并且线的位置是压缩真实发生的时刻。
- 结论（一句话）：`contextCompaction` 从单值改为「顶层最新一次 + `history[]` 历次记录」，界面按 `history` 每项渲染一条线，锚定压缩那一刻的 messages 长度（`occurredAtIndex`），而不是摘要覆盖范围的右边界（`boundaryIndex`）。
- 改动文件：
  - 服务端：`server/auto-compaction.mjs`（`MAX_CONTEXT_COMPACTION_HISTORY` + history 追加）、`server/session-state-service.mjs`（元数据覆盖时保留 `summaryMessage`/`history`）、`server/routes/shared-conversation.mjs`（history 逐条脱敏 + 事件触发条件）。
  - 前端：`src/lib/server-agent-types.ts`（`ServerAgentContextCompactionEntry`）、`src/components/chat/surface/ContextCompactionNotice.tsx`（`resolveCompactionMarkers` + 合并标注 + 时间 tooltip）、`src/components/chat/surface/MessageList.tsx`（多条线 + `compactionMarkers` prop）、`src/components/chat/surface/ChatSurface.tsx`、`src/lib/i18n.ts`（`contextCompactedMergedLabel`）。
  - 测试/文档：`tests/server/auto-compaction-history.test.mjs`（新增）、`tests/frontend/context-compaction-notice.test.ts`（新增 5 例）、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、本文件。
- 关键约束（别踩）：
  - 线的位置只能用 `occurredAtIndex`。换成 `boundaryIndex` 就退回「线画在保留回合之前 = 误读压缩时刻」的老问题。
  - 窗口外不能重新改成 `hidden`：双向钳制（低→首行、高→末行）+ 同位置只留最新，是「压缩了却没有线」和「上翻历史顶部堆一摞线」两个故障的平衡点。
  - `resolveCompactionBoundary()` 必须保留原语义（单记录、越界即 hidden），`tests/frontend/context-compaction-notice.test.ts` 与 `tests/frontend/assistant-waiting-bubble.test.ts` 都在用它。
  - 历史条数上限 20 条，每条带一份摘要正文；要放大上限先评估 `body_json` 体积。
- Blockers（阻塞）：无。
- Evidence（验证）：`npx tsc -b` 0 错误；`npx eslint 改动文件` 0 problems；`npm run lint` 0 problems；`npm run build` 成功；`npm run test` → 450 files / 5268 passed / 2 skipped，唯一失败 `tests/server/scheduled-tasks.commands.test.mjs` 为既有 flaky（该文件未被改动触碰，失败点在 goal run 计数断言，同一文件单跑时通时不通）。未创建 Git commit。
- Next Session（下一步）：
  1. 真机跑一个长会话触发两次以上压缩：应看到两条独立的线，第一条带「已并入后续摘要」，位置不随第二次压缩移动；点开各自能看到当次摘要，tooltip 有当次时间。
  2. 上翻到窗口更早的位置：早期压缩点应贴在该窗口首行，且不会一条变多条。
  3. ~~修 `resolveAutoCompactTailStart` 的 `tailStart <= 0` 回退~~ 已修：切点落到 index 0 时逐级降级保留回合（n → n-1 → … → 1），仍留不出可压缩段就压缩全部历史；单用户回合会话不再 `not_enough_history`。回归护栏在 `tests/server/auto-compaction.test.mjs`（`degrades the kept-turn count…` / `compacts the whole history when the only user turn starts at index 0`）与 `tests/server/auto-compaction-history.test.mjs`（`still compacts a single-user-turn session with an empty tail`）。
  4. 剩余压缩问题（审批超时无抑制、摘要失败无退避、摘要请求不接 abort signal、决策行点击无反馈、窄屏 pill 溢出）仍未处理，按需另开 feature。

## chat-message-windowing（done，2026-10-28）

- Current Objective（当前目标）：把对话消息渲染从「全量加载」改成窗口化，长会话每次只渲染少数几条，避免消息多时界面卡顿。
- 结论（一句话）：`ChatSurface` 改回 `createMessageWindow()` 默认构造，超过 6 轮 / 48 条消息 / 8 万字符的会话初始只挂载最近 3 轮，上翻时**向右扩展**窗口（起点前移、终点不动）逐页补 3 轮；另外补了「窗口内容不足一屏时自动续扩」的兜底，否则容器没有滚动范围、`onReachTop` 永远不触发。
- 第二轮修复（用户反馈「从下往上翻会回弹到最下面」）：根因是 `loadMore` 把窗口**滑动**（`[start, start+3)`）而不是扩展，翻页后用户正在读的行离开 DOM → 锚点解析失败 → `scrollTop` 落到 `scrollHeight - clientHeight`（对话末尾）。现在 `endOrdinal` 是控制器状态、`loadMore` 只前移起点；`loadMoreMessages` 的兜底从「贴底」改为「按上方新增高度补偿」。
- 第三轮修复（用户反馈「从上往下也是一下到底」）：根因是 `resumeTail` 主动缩窗 —— `scroll-sync` 在距底 80px 内向下滚动时每帧调 `setPanelAutoScroll(true)`，已扩展的窗口被缩回 3 轮、脚下内容换成尾部。现在**窗口只增不减**：`setFullMessages(messages, followTail)` 的 `followTail`（= `autoScrollRef`）决定右边界是否跟到末尾，读者停在历史时冻结；`endPinned` 只给 `showMessageIndex` 用；`resumeTail` 只清 pinned + 追右边界，不缩窗；`rebuild()` 在窗口未变时复用数组引用；`scroll-sync` 向下 re-arm 补 `!autoScrollEnabled` 过渡判断。窗口真正收缩只在会话切换时发生。
- 第四轮修复（用户反馈「从第一条往下滚直接到最后，没有中间的对话」）：窗口化只有向上翻页。轮次导航跳到早期轮后窗口是固定宽 `[start, start+3)`，向下滚到底时右边界被拉到 `turnCount`，中间轮次从未挂载。新增**向下翻页**：`hasMoreNewer()` / `loadNewer()`（追加在视口下方，无需锚点）、`scroll-sync` 的 `onReachBottom`（触底 scroll + 短内容时的向下 wheel）、`ChatPanelHost` → `loadNewerMessages()`、`setAutoScroll(true)` 只补一页、`setFullMessages` 右边界改为「原本在末尾且读者跟随」才跟随（`wasAtEnd`），`endPinned` 删除。
- 改动文件：`src/components/chat/surface/ChatSurface.tsx`、`src/components/chat/windowed-messages.ts`、`src/components/chat/scroll-sync.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/components/chat/panel-decoration/message-actions.ts`（注释）、`tests/frontend/windowed-messages.test.ts`、`tests/frontend/chat-surface-behavior-alignment.test.ts`、`docs/wiki/src/components/README.md`、`docs/architecture/session-open-fast-path.zh-CN.md`、`feature_list.json`、`progress.md`、本文件。
- 关键约束（别踩）：
  - 窗口模型是 `[startOrdinal, endOrdinal)`，`loadMore` 只前移起点、`loadNewer` 只前移终点——**两者都不能变成滑动窗口**，否则用户正在读的行会离开 DOM、锚点失效。`setFullMessages` 的右边界只在「原本就在末尾（`wasAtEnd`）且读者跟随」时才跟到 `turnCount`，不要为了「新消息可见」放宽这个条件。
  - `setAutoScroll(true)` 只补一页（`loadNewer`），**不能**调 `resumeTail`/把右边界拉到 `turnCount`；显式回尾（发送消息、切会话）才走 `resumeTail`。
  - 窗口粒度按轮（3 轮/窗、3 轮/页），不要为了「10 条」再加条数维度。
  - 装饰层的 `messageIndexOffset = getWindowStart()` 必须继续加在全量下标上：回滚/重试/分支/压缩提示都按全量索引寻址，传窗口内序号会删错消息。
  - 窗口数组尾部可能追加窗口外的 `toolResult`（lookup-only、不渲染），所以前 `end - start` 项的全量下标 = `offset + 窗口内序号` 这一前提才成立。
  - 不要再给 `ChatSurface` 加自己的 scroll 监听来做分页，宿主 `ChatPanelHost` 的 `scroll-sync` 拥有 follow 与 `onReachTop` / `onReachBottom`。
- Blockers（阻塞）：无。
- Evidence（验证）：`npm run test` → 452 files / 5290 passed / 2 skipped，1 failed = `tests/frontend/chat-surface-css-contract.test.ts`（他人未提交的 `src/styles/chat/process.css` 改动所致，与本次无关）；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`。
- Next Session（下一步）：
  1. 打开一个 >6 轮的真实长会话：首屏应只出现最近 3 轮，且内容不足一屏时自动补到填满。
  2. 连续上翻到底：每页补 3 轮，滚动位置要锚在原阅读行，不能跳到顶、不能被弹回底部。
  3. **轮次导航点第一个节点（对话开头），然后向下滚**：应该逐页补出中间的轮次，不能一屏就到底（第四轮修复的核心场景）。
  4. 左侧轮次导航点一个很早的轮次：应先移窗再平滑定位，落点不偏、不空白。
  5. 移动端（触摸）上滑到底验证能触发加载——这是加兜底的首要场景。
  6. 流式期间上翻到历史（pinned）时新内容不应把视口拽走；滚回底部后恢复跟随。
  7. 数据层仍全量：若要「连取数也分页」需另立项（统一 `reconcileMessagesFromSummary` / `mergeWindowedMessages` 的 offset 语义）。

## plugin-ui-extension（done，2026-10-28）

- Current Objective（当前目标）：给插件系统加 UI 扩展能力（L1 声明式 slot + L2 沙箱面板），并内置 `plugin-creator` 技能辅助写插件。
- 结论（一句话）：插件只能往固定 slot（`composer.actions` / `session.header` / `sidebar.footer`）插受限节点树或 `sandbox="allow-scripts"` 的 iframe 面板，不能改写界面；行为类扩展走服务端 hooks；面板只能通过 bridge 调 `kv` / `notify` 与**本插件自己的**工具。
- 设计文档：`docs/architecture/plugin-ui-extension.zh-CN.md`（15 节，含节点 DSL、slot/权限映射、事件协议、限额、非目标、分阶段验收、实现备注）。
- 改动文件：
  - 服务端：`server/plugins/{ui-schema,audit,manifest,loader,registry}.mjs`、`server/routes/plugins.mjs`、`server/index.mjs`、`server/storage.mjs`（注册 `plugin-audit`）、`server/skills.mjs`（`plugin-creator` 进 `defaultGlobalSkillNames`）。
  - 前端：`src/lib/plugin-ui-{types,client,resolve,bridge}.ts`、`src/components/plugins/{PluginSlot.tsx,PluginFrame.tsx,PluginsPage.tsx,plugin-api.ts}`、`src/components/app/ConversationHeader.tsx`、`src/components/chat/surface/ChatSurface.tsx`、`src/components/sidebar/chat-sidebar/SidebarFooter.tsx`、`src/App.tsx`、`src/lib/i18n.ts`。
  - 技能与示例：`skills/plugin-creator/**`、`plugins/hello-ui/**`。
  - 测试：`tests/server/plugins/{ui-schema,ui-route,hello-ui-example}.test.mjs`、`tests/frontend/{plugin-slot,plugin-ui-bridge,plugin-frame}.test.ts`，更新 `tests/server/plugins/manifest.test.mjs`、`tests/frontend/plugins-page.test.ts` 与 `tests/server/skills.test.mjs`。
- Evidence（验证）：`npx tsc -b` 0 错误；`npm run lint` 0 problems；`npm run build` 成功（`✓ built in 4.46s`）；本 feature 定向 11 files / 121 tests 全过；`npm run test` → 453 files / 5297 passed / 2 skipped，退出码 0（全量全绿，无排除）。为让全量转绿，`tests/frontend/chat-surface-css-contract.test.ts` 对 `.quickforge-process-stage-body` 的精确刻度断言改成了语义断言（连接线配方 + 缩进非零），因为刻度正被另一会话按用户反馈微调；其余三条断言原样保留。slot 快照缓存只缓存 `getSlots` 产出的节点（2s TTL，reload 与成功动作都失效），KV 状态每次现算。UI hook 超时在 `loader.mjs` 的调用边界（`handle` 5s → 504、`getSlots` 2s → 回退静态），registry 不重复计时。脚本手验 `validate-plugin.mjs plugins/hello-ui` 与 `scaffold-plugin.mjs --template panel` 均通过。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无。
- P0 自查（2026-10-29）：无 P0。补两个 P2 加固：assets 的 `text/html` 响应带 `Content-Security-Policy: sandbox allow-scripts` + `nosniff`（防插件 HTML 被顶层窗口打开时获得宿主同源权限），定向 10 files / 112 tests 复跑全过；文档 §6.3 改为如实描述（GET 只读端点不单独鉴权与仓库基线一致，POST/PUT/KV 写走 `assertAppClient`）。存量面（非本 feature）：本机 `/api` POST 无 Origin 校验，防 no-preflight CSRF 需独立 feature 在 `server/index.mjs` 统一处理。
- Next Session（下一步）：
  1. 真机：设置 → 插件 → 启用 `Hello UI`，确认输入框左侧出现 Hello 按钮；点一次应弹 toast 且按钮变成 `Hello ×1`；在插件卡片上点面板 chip，打开沙箱面板点 Bump，刷新面板后计数保留（kv 走 `plugins.json` 的 `kv` 段）。这一步同时验证刷新链路：启用/禁用后按钮应**立即**出现或消失，不需要刷新页面；点「重新加载插件」后 slot 内容应按新 catalog 重建。
  2. 想验 `callTool`：在 `plugins/hello-ui` 里加一个 `contributes.tools`（如 `plugin__hello-ui__ping`），面板里 `call('callTool', 'plugin__hello-ui__ping', {})` —— 默认权限模式应回 403（宿主原话），切到 full-access 才成功；再试 `call('callTool', 'run_command', {})`，应被 `plugin-ui-bridge.ts` 直接拒绝。
  3. 把 `plugins/hello-ui/plugin.json` 的 `permissions` 去掉 `ui:composer` 再点按钮，应得到 403 与一条 audit `denied`，界面不回退成空白。
  4. 想验证限额：把 `composer.actions` 节点数改成 25，插件卡片应显示 `status: error` 或该 slot 整块不渲染，其它插件不受影响。
  5. 下一个最划算的扩展是 `contributes.hooks`（`server/hooks/hook-engine.mjs` 已有 `HOOK_EVENTS`），不要先做 marketplace。

## dreaming-beta-badge-and-review-fixes（done，2026-10-28）

- Current Objective（当前目标）：给 Dreaming 加 Beta 标识，并按二轮评审修掉刚做的反馈闭环/删除里的偏差。
- 结论（一句话）：Beta 徽章出现在设置侧栏、tab 头部与页内标题（页内配 InfoTip）；冷笔记筛选加「≥ 40 条 + 60 天」双门槛；统计失败不再冒充写盘失败；删除后按剩余条数回退页码。
- 改动文件：`src/lib/settings-tabs.ts`、`src/components/settings/SettingsWorkspacePage.tsx`、`src/components/dreaming/DreamingSettingsTab.tsx`、`src/lib/i18n.ts`、`src/styles/settings/dreaming.css`、`server/dreaming/runner.mjs`、`tests/server/dreaming-runner.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 445 files / 5205 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机看设置侧栏「梦境记忆」后面是否显示 `BETA` 胶囊（桌面 + 窄屏移动列表各看一眼），页内标题旁应同时有徽章和两个 ⓘ。
  2. 把 `NOTE_PRUNE_MIN_NOTES` 临时改成 2 验证冷笔记段落出现；确认笔记数不足 40 时 prompt 里没有 `## Never recalled`。
  3. 删掉某页最后一条笔记，确认自动回到上一页而不是停在空页。
  4. 若发现好笔记因改写措辞被当成冷笔记，先调 `NOTE_UNUSED_DAYS` / `NOTE_PRUNE_MIN_NOTES`，不要给笔记加 id。

## dreaming-recall-feedback-and-note-delete（done，2026-10-28）

- Current Objective（当前目标）：补反馈闭环（召回计数/强度衰减）+ 单条笔记删除。
- 结论（一句话）：migration v18 加了一张 6 列的 `dreaming_note_stats`，`recall_experience` 命中即计数；每轮 dreaming 把「存在 ≥ 30 天且从未被召回」的笔记作为删除候选交给模型（信息而非规则，不自动淘汰）；`DELETE /api/dreaming/notes/:id` 直接改文件删单条。
- 改动文件：`server/sqlite/migrations.mjs`（v18）、`server/sqlite/dreaming-repository.mjs`（recordNoteRecall / listNoteStats / syncNoteStats / deleteNoteStat）、`server/dreaming/{notes,recall,runner,prompt}.mjs`、`server/routes/dreaming.mjs`、`server/tools/index.mjs`、`src/components/dreaming/{dreaming-data.ts,DreamingSettingsTab.tsx}`、`src/lib/i18n.ts`、`tests/server/{dreaming,dreaming-runner}.test.mjs`、`tests/server/routes/dreaming.test.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 445 files / 5204 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机：用 `recall_experience` 搜到某条笔记 → 设置页那一行应显示「被召回 1 次」。
  2. 把系统时间或 `createdAt` 推后 30 天（或临时把 `NOTE_UNUSED_DAYS` 调小）验证 `## Never recalled` 段出现在 prompt 里，且模型删掉它时 run 的 removed 里有这条。
  3. 设置页笔记行点「删除」→ 文件里那一行消失、`dreaming_note_stats` 对应行消失、下一轮 dreaming 不会写回来。
  4. 若发现模型把安全红线当冷笔记删了，先调 `NOTE_UNUSED_DAYS`（`server/dreaming/runner.mjs`），不要把自动淘汰加回来。

## dreaming-notes-hardening（done，2026-10-28）

- Current Objective（当前目标）：按 Claude Dreaming 的机制评审结果补齐短板，但不过度设计（不加表、不加迁移、不加依赖）。
- 结论（一句话）：prompt 补排序与冲突裁决；runner 补漂移告警 + `notesAfter` 快照；routes 补 `firstSeen` 来源与 restore 回滚；collect 补「纠正优先」采样；顺带删两处死代码。
- 改动文件：`server/dreaming/{prompt,notes,runner,collect}.mjs`、`server/sqlite/dreaming-repository.mjs`、`server/routes/dreaming.mjs`、`src/components/dreaming/{dreaming-data.ts,DreamingSettingsTab.tsx}`、`src/lib/i18n.ts`、`tests/server/{dreaming,dreaming-runner,dreaming-notes}.test.mjs`、`tests/server/routes/dreaming{,-detail}.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 445 files / 5194 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机跑两次 dreaming：第一次之后手动跑第二次，确认第二次的 run 详情里有「新增/移除/恢复到此版本」，笔记页每行显示「首次记录于 …」。
  2. 故意用一个弱模型重跑，观察是否触发「可能发生了记忆漂移」告警；点「恢复到此版本」应把笔记写回上一次快照。
  3. 想验证纠正优先：造两个会话（一个顺利、一个被用户纠正），把窗口预算压到只够一个，确认被纠正的那个进了 transcript。
  4. 仍缺反馈闭环；若以后要补，优先做「笔记被 recall_experience 命中时记一次计数」，而不是恢复 strength/衰减体系。

## dreaming-notes-file（done，2026-10-28）

- Current Objective（当前目标）：把 dreaming 的笔记拆成独立的一份，与用户手写的 `MEMORY.md` 互不干扰，两者共同注入提示词。
- 结论（一句话）：`~/.quickforge/MEMORY.md`（人写、自由格式）与 `~/.quickforge/DREAMING.md`（dreaming 整份覆盖、bullet 列表）分成两个文件，注入时分别是 `<global_user_memory>` 与 `<dreaming_memory>`；`MEMORY.md` 里的 `dreaming:auto` 标记段机制已整段移除。
- 改动文件：`server/global-memory.mjs`（新增 DREAMING.md 读写、删标记段机制与 `saveManualSection`）、`server/routes/memory.mjs`、`server/routes/dreaming.mjs`、`server/dreaming/{runner,recall,notes}.mjs`、`server/project-config.mjs`、`server/system-prompt.mjs`、`src/components/settings/tabs/MemorySettingsTab.tsx`、`src/components/dreaming/dreaming-data.ts`、`src/lib/i18n.ts`、`tests/server/{global-memory,dreaming-memory,dreaming-runner}.test.mjs`、`tests/server/routes/dreaming{,-detail}.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 445 files / 5186 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。首次全量有一次 `scheduled-tasks.commands.test.mjs` 时序用例偶发失败，单跑与复跑全量均通过，判定 flaky。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机跑一次「立即处理」：确认 `~/.quickforge/DREAMING.md` 被整份重写，而 `MEMORY.md` 的 mtime 不变（这是"两份互不干扰"最直接的证据）。
  2. 在设置 → 记忆里编辑并保存 `MEMORY.md`，确认 `DREAMING.md` 内容不变；再反过去跑 dreaming，确认 `MEMORY.md` 不被碰。
  3. 检查系统提示里两段都在：`<global_user_memory>` 与 `<dreaming_memory>` 各带自己的 source 路径；把记忆总开关关掉后两段都应消失。
  4. 若以后要加项目级记忆，复用同一套 `notes.mjs` 解析 + 多一个文件路径即可，不要恢复带 scope 字段的表。

## dreaming-notes-only（done，2026-10-28）

- Current Objective（当前目标）：把上一轮那套「结构化经验库 + 向量召回」简化成参考 Claude Dreaming 的**最简可用**机制。
- 结论（一句话）：记忆只剩 `MEMORY.md` 自动区里的一份 bullet 列表——每轮读「当前列表 + 新会话」→ 一次模型调用 → 校验后整段覆盖；`memories` / `memories_fts` / `memory_events` / `memory_embeddings` 四张表被 v17 直接 DROP，`apply.mjs` / `vector.mjs` / `embedding.mjs` 已删除。
- 改动文件：`server/sqlite/migrations.mjs`（v17）、`server/sqlite/dreaming-repository.mjs`（只留 runs）、`server/dreaming/notes.mjs`（新）、`prompt.mjs`、`recall.mjs`、`runner.mjs`、`settings.mjs`、`server/routes/dreaming.mjs`、`server/tools/{index,definitions}.mjs`、`server/project-config.mjs`、`server/system-prompt.mjs`、`src/components/dreaming/{dreaming-data.ts,DreamingSettingsTab.tsx}`、`src/lib/recall-experience-history.ts`、`src/lib/tool-renderers/recall-experience-tool-renderer.tsx`、`src/lib/i18n.ts`、`tests/server/dreaming-notes.test.mjs`（新）、`tests/server/{dreaming,dreaming-runner}.test.mjs`、`tests/server/routes/dreaming{,-detail}.test.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`tests/frontend/recall-experience-renderer.test.ts`、`docs/architecture/dreaming-memory.zh-CN.md`（重写 406→194 行）、三份 wiki、`feature_list.json`（语义召回那条标 superseded）、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 445 files / 5185 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机跑一次「立即处理」：确认 `MEMORY.md` 自动区被整段重写成 bullet 列表，人工区逐字不变；设置页「笔记」页签能搜到、能按 kind 筛。
  2. 故意让模型跑题（换一个很弱的模型）验证掉线保护：run 应显示 `failed`、错误是「模型回复里没有任何笔记条目」，且 `MEMORY.md` 里旧笔记仍在。
  3. 若觉得笔记增长过快，先调 `server/dreaming/notes.mjs` 的 `MAX_NOTE_LINES` / `MAX_NOTE_LINE_CHARS`，不要重新引入去重表。
  4. 想把「换述召回」找回来时，走「查询改写 + LLM 从候选挑选」，不要再加向量库——笔记几十条全量注入本来就够。

## dreaming-semantic-recall（done，2026-10-28）

- Current Objective（当前目标）：经验召回要语义化——换种说法也能召回，而不是只靠关键词。
- 结论（一句话）：不内嵌模型、不引入向量库，复用用户已有的 OpenAI 兼容 `/embeddings`（Ollama / LM Studio / llama.cpp / vLLM）；向量按 Float32 BLOB 存进新表 `memory_embeddings`（migration v16），召回时 Node 内算余弦并与 bm25 做 RRF 融合，embedding 不可用时自动退回原来的纯 bm25 路径。
- 改动文件：`server/sqlite/migrations.mjs`（v16）、`server/sqlite/dreaming-repository.mjs`（embedding 读写 + `updateMemory` 失效旧向量）、`server/dreaming/vector.mjs`（新）、`server/dreaming/embedding.mjs`（新）、`server/dreaming/recall.mjs`（`recallExperiencesHybrid` / `fuseRecallCandidates`）、`server/dreaming/runner.mjs`、`server/dreaming/settings.mjs`、`server/routes/dreaming.mjs`（overview.embedding + backfill 端点）、`server/tools/index.mjs`、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/lib/i18n.ts`、`tests/server/dreaming-embedding.test.mjs`（新）、`tests/server/routes/dreaming.test.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`tests/server/scheduled-task-runs-repository.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 445 files / 5203 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。新增 16 例单测覆盖编解码 / 余弦 / RRF / 端点回落 / 三种响应形状 / 幂等回填 / 换模型重算 / 改内容失效 / scope 过滤 / 换述召回 / 端点失败降级。未创建 Git commit，未手工改 `dist/`、`package-dist/`、`package-offline/`。
- Blockers（阻塞）：无（本机无本地推理服务，端到端只有 mock 级证据）。
- Next Session（下一步）：
  1. 起本地 embedding 服务：`ollama serve` + `ollama pull bge-m3`；在自定义 provider 里把 `bge-m3` 加成 model（baseUrl `http://127.0.0.1:11434/v1`）。
  2. 设置 → Dreaming → 「语义召回模型」选它 → 点「生成向量」，确认「已向量化 N / N 条记忆」。
  3. 真机验证换述召回：用一条与记忆文案不同措辞的 `recall_experience({query})`，对比配置前后的结果差异；若漏召，先调 `RECALL_MIN_COSINE`（`server/dreaming/recall.mjs`，当前 0.2）。
  4. 若后续仍觉得不够：可加"查询改写多路召回"或对候选做 LLM rerank，但不要直接上 `sqlite-vec`（打包与双端 Node 版本风险）。

## workflow-error-collapse（done，2026-10-28）

- Current Objective（当前目标）：工作流失败时把报错折叠起来，不要一上来就铺满整屏。
- 结论（一句话）：错误统一「只留一个错误图标、点击就地展开」——Inspector 的 `run.error` 与聊天区无 details 的失败帧折叠态都只有一个 `AlertTriangle` 图标按钮（原文只在展开后进 DOM，展开后 40vh 内滚动），阶段日志不再因为存在 error 级记录就自动展开，改为头部标记点。
- 改动文件：`src/components/workspace/WorkflowRunDetailContent.tsx`（`WorkflowErrorBanner` 图标折叠 + `PhaseLogs` 默认收起）、`src/lib/tool-renderers/workflow-tool-renderer.tsx`（`WorkflowFallbackError`）、`src/styles/workspace/workflow-detail.css`、`src/styles/chat/goal-workflow.css`、`src/lib/i18n.ts`（`workflowErrorExpand` / `workflowErrorCollapse`）、`tests/frontend/workflow-renderer.test.ts`、`docs/architecture/workflow-orchestration.zh-CN.md`、三份 wiki、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改生成产物（`dist/` 由 build 产出）。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机复现一次失败（例如给 `run_workflow` 传 `options` 为字符串触发参数校验失败）：聊天卡应只剩一个红色错误图标，点一下才展开完整原文，且不会把后续消息顶出屏幕。
  2. 打开同一运行的 Inspector 详情：错误横幅同样只有一个图标、阶段日志默认收起（error 阶段头有标记点）；点图标后错误区最高 40vh、内部滚动，并出现「定位失败步骤」。
  3. 图标按钮靠 `aria-label`/`title` 传达「展开报错详情 / 收起报错详情」；若真机上图标太隐蔽（看不出这里有错），可加一条极淡的 `-error` 左边框延伸或 hover 提示，但不要退回常显文字方案。

## sidebar-show-more-indent（done，2026-10-28）

- Current Objective（当前目标）：项目分区会话列表底部的「显示更多」与会话标题左对齐。
- 结论（一句话）：按钮改用 `sidebarRowClass(sidebarOpen)` 并支持 `indent`，项目分区传 `indent` 得到与项目会话行一致的 `pl-8`；`timeline` / 全局对话不缩进，收起态跟随会话行居中。
- 改动文件：`src/components/sidebar/chat-sidebar/SessionDisplayControls.tsx`、`src/components/sidebar/ChatSidebar.tsx`、`tests/frontend/sidebar-section-order.test.ts`、`progress.md`、本文件。
- Evidence（验证）：`npx vitest run tests/frontend/sidebar-section-order.test.ts` → 22 passed；`npx eslint` 三个改动文件 → 0 error；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改 `dist/` `package-dist/` `package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机看一眼项目展开、会话超过一屏（点两次「显示更多」）时，按钮文字左边缘应与会话标题左边缘重合。
  2. 若之后给 pinned/timeline 也加行缩进，记得同步 `indent` 传参，否则会复现同样的错位。

## rollback-inline-edit（done，2026-10-28）

- Current Objective（当前目标）：回滚去掉二次确认，点图标即就地变输入框，Enter 发送。
- 结论（一句话）：装饰层新增 `inline-message-editor.ts` 承担编辑态（预填原文 / 后续消息变淡 + 虚线说明 / 发送·取消），提交走「先静默截断、再由 composer.onSend 发送」两半步，旧 popover 只作为未接入方的降级路径。
- 改动文件：`src/components/chat/panel-decoration/inline-message-editor.ts`（新）、`message-actions.ts`、`src/components/chat/ChatPanelHost.tsx`（新 prop `onRollbackForResend` + `onEditMessageAndResend` 适配）、`src/hooks/useChatActions.ts`（`performRollback` 抽取 + `rollbackForResend`）、`src/App.tsx`、`src/components/share/SharedConversationPage.tsx`、`src/styles/chat/message-edit.css`（新）、`src/styles/index.css`、`src/lib/i18n.ts`、`tests/frontend/inline-message-editor.test.ts`（新）、`docs/design/rollback-inline-edit.html`（新）、三份 wiki。
- Evidence（验证）：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未手工改 `dist/` `package-dist/` `package-offline/`。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机走一遍：hover 第 3 条用户消息 → 点回滚图标 → 确认气泡原地变输入框、后续 2 条变淡、Enter 发出一轮新回复。
  2. 重点验证「回滚到第一条消息」：这条路径会重建会话（删旧 session + 新 agent），实现上已用 `waitForComposerSend` 轮询最多 12 帧等新的 composer 绑定；确认新文案发到新会话而不是旧 agent。
  3. 若之后想保留「回填输入框」入口，可在编辑态加一个「取消并回填」次级动作，而不是把确认弹窗加回来。

## process-stage-scroll 回滚（done，2026-10-28）

- Current Objective（当前目标）：撤回「执行中 · N 个工具调用 · N 条命令」展开区的限高 + 贴底跟随功能。
- 结论（一句话）：该功能原为单提交 `55923d4` 且之后无人改动过相关文件，故按文件精确回退到父提交 `ab1ff0b0`；未用 `git revert`（`feature_list.json` / `progress.md` 有他人未提交改动会冲突），状态文件只做标注。
- 改动文件：`src/styles/chat/process.css`、`src/components/chat/panel-decoration/process-folding.ts`、`tests/frontend/process-folding.test.ts`、`tests/frontend/process-folding-incremental.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md`（均恢复为 `55923d4` 之前的内容）；`feature_list.json`（标「已回滚」）、`progress.md`、本文件。
- Evidence（验证）：`npx vitest run` process-folding / -incremental / -ownership / chat-surface-css-contract / css-architecture → 5 files / 114 tests passed；`npx tsc -b` → 0 错误；`npm run lint` → 0 error；`npm run build` → 成功（4.24s）。未创建 Git commit，未手工改生成产物（dist 由 build 脚本产出）。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机确认展开区已恢复全高、不再有内部滚动条与贴底跳动。
  2. 若之后仍嫌「执行中」展开区太长，可改走更轻的方案（默认收起 stage / 只显示最近 3 条），不要再引入限高+跟随这套交互。

## dreaming-model-selection（done，2026-10-27）

- Current Objective（当前目标）：让 Dreaming 能自由选模型；并解释为什么它一直用 智谱/GLM-4.6V。
- 结论（一句话）：根因是未指定模型时走 `resolveImplicitModelPreference(null)` → 目录第一条，而设置页没有模型入口。现改为「指定 modelRef → 最近对话模型 → 目录第一条」三级解析，前端加可搜索模型下拉（首项「跟随对话模型」），meta 行显示实际生效模型与原因，保存时校验 modelRef（不可解析 400）。
- 改动文件：`server/dreaming/runner.mjs`、`server/routes/dreaming.mjs`、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`、两个测试文件、设计稿与 wiki。
- Evidence（验证）：dreaming-runner 14 passed；routes/dreaming 11 passed；`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交 Git。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机：设置 → Dreaming 的模型下拉选一个纯文本模型（例如 deepseek），保存后 meta 行应显示 `provider/model · 已指定`；切回「跟随对话模型」后应显示 `… · 跟随对话`。
  2. 历史 run 记录的 `model_label` 不会回填；旧记录仍显示当时实际用的模型（这正是排查“为什么是 GLM-4.6V”的证据）。
  3. 若希望按任务类型自动选（摘要用小模型、抽取用大模型），需要新增`能力标签`字段，当前刻意不做。

## dreaming-ui-polish（done，2026-10-28）

- Current Objective（当前目标）：Dreaming 设置页第二轮 UI 精修（美观/简洁/易用），不改后端。
- 结论（一句话）：状态点旁拼同色调状态词（颜色不再单独承载含义）；记忆行作用域下沉 meta 行、指标数字裸排+`title`；meta 与内联设置之间加 hairline；折叠箭头换 lucide chevron 旋转；搜索去按钮、300ms 防抖自动查询。
- 改动文件：`src/components/dreaming/DreamingSettingsTab.tsx`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（新增 dreamingStateOn/Off/Failed、dreamingAutoSectionOnShort/OffShort、dreamingInputMessages/Chars、dreamingMemoryRecallTitle 共 8 条双语）、`docs/architecture/dreaming-memory.zh-CN.md`、`feature_list.json`/`progress.md`/本文件。
- Evidence（验证）：`npx tsc -b` → 0 错误；eslint 改动文件 → 0 问题；4 个相关前端测试 → 45 passed；`npm run build` → ✓ built in 4.66s。未创建 Git commit。
- 追加修复（2026-10-28）：真机 `reading 'available'` 崩溃归因——崩溃行来自并行「模型选择」改动，触发是旧 server 进程的 overview 响应缺 `model` 字段；已把 `DreamingOverview.model` 改可选并给三处访问设防（旧 server 降级显示「无模型」），用户需重启旧 dev server 进程。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机看一次：头部标题「梦境记忆 · 已开启」各级配色（on 绿 / running 主色 / error destructive / off muted）与 hairline 分层效果；搜索输入停顿 300ms 后是否自动刷新列表。
  2. 共享组件隐患（未修，见 progress.md Notes）：`t()` 缺 key 静默返回 undefined，会让 `SettingsSelect`/`visibleSelectIndexes` 整页崩；建议 `t()` 开发态警告或防御性 `option.label?.`。开发态曾出现过一次（疑似 Vite 首载缓存，刷新即愈，双语 key 均在）。
  3. 并行会话新增的「Dreaming 模型选择」（`modelRef`/`overview.model`/`modelRefKey`）已与本轮 UI 合流；其 server 侧改动见对应 feature 记录，若尚未录入 feature_list 需补。

## dreaming-ui-and-language（done，2026-10-27）

- Current Objective（当前目标）：Dreaming 设置页更简洁易用；修掉“中文对话沉淀出英文记忆”的问题。
- 结论（一句话）：语言改由代码判定（`detectContentLanguage()` 只采样 user 消息，CJK 字权重≈4 拉丁字母，样本 <12 字母返回 null），并以 `## Output language` 硬要求写进 user message；设置项 `contentLanguage(auto|zh|en)` 可覆盖，结果记 `dreaming_runs.content_language` 并在详情页显示。UI 压成「头部状态块 + subtab（记忆/运行历史）+ 可折叠详情」。
- 改动文件：`server/dreaming/{collect,prompt,runner,settings}.mjs`、`server/sqlite/{migrations,dreaming-repository}.mjs`（migration v15）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`（新）、`src/styles/index.css`、`src/lib/i18n.ts`、三个 dreaming 测试文件、设计稿与 wiki。
- Evidence（验证）：五个 dreaming 测试 → 58 passed；`npm run test` → 442 files / 5166 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交 Git。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机看一次：设置 → 自动化 → Dreaming，确认头部状态块在窄宽度下换行正常（`quickforge-dreaming-settings` 是 flex-wrap），以及 subtab 在两个列表间切换时不清空筛选。
  2. 旧版写出的英文记忆不会自动消失：提示词已要求模型对已有条目用 `action="update"` 就地改写为目标语言，所以后续 run 会逐步转成中文；要一次性清空只能在记忆列表里批量淘汰。
  3. 若发现中文会话仍被判成 `en`（例如用户只给短指令、长文由助手产出），直接改设置里的「记忆语言」为「中文」即可，无需等判定逻辑调整。

## workflow-docs-sync-to-code（done，2026-10-27）

- Current Objective（当前目标）：以**最终代码**为准同步 run_workflow 的文档，不改代码；并回答「当前并发是多少」。
- 结论（一句话）：默认权限下并发**恒为 1**，完全访问模式才用 `options.concurrency`（默认 4、上限 8）；同时修掉 6 处文档与实现不符（hooks 失败语义、`phase()` 静默丢弃、`schema` 未透传、中止文本、Agent record `seq`、跑马灯内容）。
- 改动文件：`docs/architecture/workflow-orchestration.zh-CN.md`、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`node -e "JSON.parse(...)"` → `feature_list.json` OK；`git status --porcelain` 确认只改文档、未触碰 `server/` `src/` `tests/` `dist/`。逐条取证行号：`agent-workflow-runner.mjs:236`（并发）、`:548-558`（未传 schema）、`:442-460/472/502`（中止文本）、`:306-337`（subagentRun 字段）；`agent-workflow-worker.mjs:250/260/263`（bridge 抛错边界）、`:165/102/106-113/132`（回投 null）、`:141-144 + 191`（phase 静默丢弃）；`agent-subagent-runner.mjs:347-351`（schemaHint）；`workflow-tool-renderer.tsx:108`（跑马灯取最后阶段）；`agent-workflow-tools.mjs:41-66`（toolset 懒构建）。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 未跑 `npm run test` / `lint` / `build`——本轮零代码改动；若需要门禁记录请单独跑一次。
  2. 三处「代码 vs 文档」的实质问题按「不改代码」要求只写进文档，未修：① `schema` 未从 runner 透传给 `runAgent`（1 行改动，可显著降低 `agent({schema})` 失败率）；② 参数校验错误类型不统一（bridge throw vs 回投 `null`，模型无法区分「写错参数」与「运行失败」）；③ `phase()` 超 120 字符静默丢弃（应改为回投错误或截断）。
  3. 若修 `schema` 透传，需同步 `docs/architecture/workflow-orchestration.zh-CN.md` §3.3 与 `docs/wiki/server/README.md` 的「schema 只做后置校验」条目，并补 `tests/server/agent-workflow-runner.test.mjs` 用例。

## recall-experience-tool-card（done，2026-10-27）

- Current Objective（当前目标）：给 `recall_experience` 在对话里的工具调用设计并落地合适的展示样式（而不是继续用兜底卡的整段 JSON）。
- 结论（一句话）：新增 `RecallExperienceToolRenderer` + 纯视图模型 `recall-experience-history.ts`——折叠态一行（灯泡 + 回忆经验 + `· query` + 命中计数 + 状态），展开态是结构化经验列表（kind · scope · ×recallCount / 正文 / `confidence · strength · N 个会话 · N 天前`），并把「0 命中」从「绿色对勾 + JSON」改判为正常结果走中性说明。
- 改动文件：`src/lib/recall-experience-history.ts`（新）、`src/lib/tool-renderers/recall-experience-tool-renderer.tsx`（新）、`src/lib/tool-renderers/{shared,index}.ts(x)`、`src/lib/local-tools.ts`、`src/lib/tool-param-summary.ts`、`src/components/chat/panel-decoration/approval-card.ts`、`src/lib/i18n.ts`、`src/styles/chat/tool-output.css`、`tests/frontend/recall-experience-renderer.test.ts`（新）、`tests/frontend/tool-param-summary.test.ts`、`docs/wiki/src/lib/README.md`、`feature_list.json`/`progress.md`/本文件。
- Evidence（验证）：`npx vitest run tests/frontend/{recall-experience-renderer,tool-param-summary,tool-renderer-registry,chat-surface-tool-message}.test.ts` → 4 files / 41 passed；`npm run test` → 442 files / 5160 passed / 2 skipped；`npm run lint` → 0 问题；`npx tsc -b` → 0 错误；`npm run build` → ✓ built in 9.89s。未创建 Git commit。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机跑两次 `recall_experience`（有命中 / 无命中），确认暗色下 hover 计数与列表行距、以及空态文案的层级。
  2. 已知取舍：正文不截断。若某些经验条目很长导致过程组被撑高，可在 `tool-renderers/recall-experience-tool-renderer.tsx` 给 `.quickforge-recall-content` 加 `line-clamp` + `title`，但会牺牲可读性。
  3. `renderToolIcon` 仍是 if 链（`shared.tsx:406`），新增工具要同时改 `shared.tsx` 与 `local-tools.ts` 两处；整理成映射表是独立重构，未在本次展开。
  4. 同源遗留：`ToolMessage.tsx` 兜底卡的状态色（`Code + text-green-600/dark:text-green-500`）与内置渲染器的 `renderStatusIcon`（primary/destructive）不一致；本次只让 `recall_experience` 走内置体系，未动兜底卡。

## schema-version-test-hygiene（done，2026-10-27）

- Current Objective（当前目标）：结束“每次升 schema 都要改 7 个测试文件同一个版本号”的 churn，且不要用“从 `SQLITE_MIGRATIONS.length` 推导”这种恒真断言敷衍过去。
- 结论（一句话）：删掉所有“等于最新 schema 版本”的断言（`health().schemaVersion` / `user_version` / `schema_migrations` 末行 / 迁移计数），改为断言可观察结构（迁移行与迁移表逐项对齐、版本号连续、`user_version === 已应用行数`、表/列/索引/数据）；历史边界（v11 runtime 拒绝新库、migration 12 回滚、v7→v8 / v8→v9 / v2→v3 回滚）保持显式字面量。
- 改动文件：`tests/helpers/sqlite-schema.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`tests/server/scheduled-task-runs-repository.test.mjs`、`tests/server/session-state-repository.test.mjs`、`tests/server/share-repository.test.mjs`、`tests/server/lan-access-repository.test.mjs`、`tests/fixtures/session-state-full-chain-electron-smoke.mjs`、`tests/server/session-state-full-chain-electron-smoke.test.mjs`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：5 个 schema 相关仓库测试 → 5 files / 61 passed；全链路 smoke → 1 passed；`npx eslint` 8 个改动文件 → 0 problems。未跑全量 `npm run test` / `npm run build`（非发布改动）。未提交 Git。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 若后续新增迁移，只应在“确实是历史边界”处写数字；不要再加“等于最新版本”的断言，发现即删。
  2. `tests/helpers/sqlite-schema.mjs` 的 `LATEST_SCHEMA_VERSION` 仅用于构造“列表之后一条”的失败迁移；`NEXT_SCHEMA_VERSION` 同用途，注释已写明禁止用于版本断言。
  3. 发版前仍需完整跑 `npm run test` / `npm run lint` / `npm run build`。

## dreaming-run-detail（done，2026-10-27）

- Current Objective（当前目标）：Dreaming 只取「user 消息 + assistant 最终回答」（含压缩摘要），总预算 100k 字符；并设计/实现运行详情查看。
- 结论（一句话）：采集层改为只投影 user 与最终回答（`no toolCall && stopReason ∉ {toolUse,error,aborted}`，另加 `history(compacted)` 摘要行），工具调用与工具输出完全不进 prompt；详情页补 v14 四列（`model_label/input_chars/sessions_json/raw_response`）+ rejected 原提案 + `memories` 副作用查询，实现「概览 / 读取内容 / 变更 / 拒绝 / 衰减 / 原始响应」六段。
- 改动文件：`server/dreaming/{collect,prompt,apply,runner}.mjs`、`server/sqlite/{migrations,dreaming-repository}.mjs`、`server/routes/dreaming.mjs`、`src/components/dreaming/{dreaming-data.ts,DreamingSettingsTab.tsx}`、`src/lib/i18n.ts`、`tests/server/dreaming.test.mjs`、`tests/server/routes/dreaming-detail.test.mjs`（新）、`tests/helpers/sqlite-schema.mjs`（新）、5 个 schema 版本测试、`tests/fixtures/session-state-full-chain-electron-smoke.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`、`feature_list.json`/`progress.md`/本文件。
- Evidence（验证）：dreaming 相关五文件 → 52 passed；5 个 schema 版本测试 → 61 passed；`npm run test` → 441 files / 5144 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交 Git。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机点一次「立即处理」，确认详情页②段展示的确实是发送给模型的文本，且③段在「重复内容降级为 update」时能显示提案与库中结果的差异。
  2. 若发现记忆偏向“现象+结论”而缺少精确命令（因为工具输出已不进 prompt），可考虑在采集里按 kind 需要补一层「只取失败的 toolResult 首行」，但会重新引入预算压力，需先量化收益。
  3. `MAX_TOTAL_CHARS = 100_000` 是字符数，不是 token；如需按 token 控，改 `server/dreaming/collect.mjs` 单处常量并同步设计稿 §4.1。

## dreaming-memory（done，2026-10-27）

- Current Objective（当前目标）：实现全自动 Dreaming 记忆固化——回看已结束会话，沉淀长期记忆，并在后续任务中自动检索使用；先写设计稿再按稿实现。
- 结论（一句话）：设计稿落在 `docs/architecture/dreaming-memory.zh-CN.md`，实现为 server 内独立子系统 `server/dreaming/`：每日调度或手动触发回看窗口内会话，一份提示词驱动四个动作，代码只做硬校验后单事务落库；记忆存 SQLite（migration v13）+ FTS5 trigram，MEMORY.md 用标记段承载自动摘要，使用侧提供 `<experience_memory>` 注入与 `recall_experience` 工具。
- 改动文件：`docs/architecture/dreaming-memory.zh-CN.md`（新）、`server/sqlite/migrations.mjs`（v13）、`server/sqlite/dreaming-repository.mjs`（新）、`server/dreaming/{settings,collect,prompt,apply,runner,recall}.mjs`（新）、`server/routes/dreaming.mjs`（新）、`server/global-memory.mjs`（自动区读写）、`server/system-prompt.mjs`（experience_memory）、`server/project-config.mjs`（注入 top-N）、`server/tools/{definitions,index}.mjs`（recall_experience）、`server/agent-manager.mjs`（无项目会话也挂该工具）、`server/index.mjs`（路由 + runner 启停）、`src/components/dreaming/*`（新设置页）、`src/lib/{settings-tabs,react-settings-tabs}.tsx`、`src/components/settings/SettingsWorkspacePage.tsx`（图标）、`src/lib/i18n.ts`（双语）、4 个新测试文件、6 个受 schema 版本影响的既有测试、3 个 wiki 页、`feature_list.json`/`progress.md`/本文件。
- Evidence（验证）：四个新增测试 48 passed；`npm run test` → 441 files / 5127 passed / 2 skipped（退出码 0）；`npm run lint` → 0 error；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit（用户未要求）。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 真机确认一次：设置 → 自动化 → Dreaming，打开开关 → 点「立即处理」，检查运行历史与 MEMORY.md 自动段是否符合预期（需要已配置模型，否则 run 会以 failed + “未配置模型”记录）。
  2. `allowSensitive` 默认 true。若要默认更保守，改 `server/dreaming/settings.mjs` 的 `DEFAULT_DREAMING_SETTINGS` 与前端提示文案（两处都要改，normalize 会丢弃未知字段）。
  3. 若要真正的语义检索，需引入 embedding（会新增依赖）；当前 FTS5 + strength/新鲜度是刻意的最小实现。
  4. 已知取舍：单次 run 只有一次模型调用，输出 ≤ 25 条操作；若发现长期“只记到皮毛”，可考虑分两阶段（先摘要再抽取），代价是成本翻倍。

## fork-session-visible-immediately（done，2026-10-27）

- Current Objective（当前目标）：fork 出的新对话要立即出现在左侧会话列表。
- 结论（一句话）：根因是 `createAgent` 从不持久化——创建期唯一那次落库依赖「首条 user 消息 message_end」，而 fork 预置 messages 时该分支被 `sessionCreatedEmitted = messages.length > 0` 永久跳过，会话索引里没有记录；修法是 createAgent 返回前对非空且非 restore 的会话 `await persistSession(session)`，并把 `lastModified` 改为 `max(末尾消息时间, createdAt)`。
- 改动文件：`server/agent-manager.mjs`（createAgent 创建期持久化，不发事件）、`server/agent-persistence.mjs`（`sessionLastModifiedFromMessages` 取 max）、`src/hooks/useChatActions.ts`（fork 传 `refreshSessions:false`、去掉 `if (storage)` 门禁、删无用 storage 局部变量）、`tests/server/agent-manager.persist-session-state.test.mjs`（+3 例）、`tests/frontend/fork-session-visibility.test.ts`（新，4 例源码契约）、`docs/wiki/server/README.md`、`docs/wiki/src/hooks/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npm run test` → 437 files / 5119 passed / 2 skipped（退出码 0）；`npm run lint` → 0 error / 0 warning；`npm run build` → ✓ built in 7.06s；`npx tsc -b` → 0 错误。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 建议真机确认一次：fork 后侧栏是否立刻出现 `[fork] ...` 且排在最前（`lastModified` 现在取 max，理论上在顶部）。
  2. 创建期持久化让 `POST /api/agents/:id` 对带 messages 的创建多一次同步 SQLite 写。若以后 fork 超大历史感觉卡顿，可考虑改为「先写 metadata 索引、消息体后台补写」，但会增加索引/正文不一致窗口，需谨慎评估。
  3. 仍无 `forkedFromSessionId` 溯源（独立 feature）：改动面为 create 路由 + createAgent 配置 + `persistSessionUnlocked` 的 sessionData/metadata + 列表渲染。

## fork-title-prefix（done，2026-10-27）

- Current Objective（当前目标）：fork 出来的新对话应表现为“新 session”，并要求在标题上带 `[fork]` 前缀以便识别。
- 结论（一句话）：fork 本来就新建独立 sessionId，本轮补上标题标识——新增 `generateForkTitle()`，标题为 `[fork] + 首条用户消息`，前缀不占 46 字符预算，普通会话不受影响。
- 改动文件：`src/lib/message-utils.ts`（`FORK_TITLE_PREFIX`、`generateForkTitle`、`generateTitle(messages, prefix?)`）、`src/hooks/useChatActions.ts`（`forkFromMessage` 改用新函数）、`tests/frontend/message-utils.test.ts`（新增 4 例 fork title）、`docs/user-guide.zh-CN.md`、`docs/user-guide.en-US.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/hooks/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npx vitest run tests/frontend/message-utils.test.ts` → 10 passed；fork/标题相关 6 文件 → 6 files / 77 passed；`npx eslint` 改动 TS 文件 0 error；`npx tsc -b` 0 错误。未跑 `npm run test` / `npm run lint` / `npm run build` 全量（非发布改动）。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 若需要“分叉自 X”/分支树，需新增 `forkedFromSessionId`：改动面为 `server/routes/agent.mjs` create 路由 + `server/agent-manager.mjs` createAgent 配置 + `server/agent-persistence.mjs` 落库 + 会话列表渲染，独立 feature。
  2. fork 会话因 `titleSource='manual'` 不会走 AI 标题精修（`agent-manager.mjs:1192` 只放行 `fallback`）。若要放行，应在前端传标记而非放宽全局 `canApplyGeneratedTitle()`。
  3. `[fork] New chat` 不会被 `sessionTitle()` 本地化，仅影响“fork 出无语义首条消息”的极端场景。

## compaction-prompt-english-untruncated（done，2026-10-27）

- Current Objective（当前目标）：把压缩提示词全部改成英文；去掉 transcript 构造中的所有截断。
- 结论（一句话）：`COMPACT_SYSTEM_PROMPT` + 用户消息模板改为全英文（输出语言仍跟随会话），并删除三层长度上限（单条 10000 / transcript 160k / 工具参数 2000）；摘要看到完整历史，过大请求由 provider 报错并经 `auto_compact_failed` 显式暴露，而非静默产出不完整摘要。
- 改动文件：`server/conversation-compaction.mjs`（删 `truncateMiddle` / `transcriptCharLimit`、`safeJson` 去 `maxLength`、消息正文不截断、提示词英文化）、`tests/server/conversation-compaction.test.mjs`（新增 5 个提示词/不截断用例）、`docs/wiki/server/README.md`（新增「提示词（全英文）」与「不再做任何截断」两段）、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npx vitest run tests/server/conversation-compaction.test.mjs` → 11 passed；压缩相关四文件 → 4 files / 46 passed；`npx eslint` 改动文件 0 error；`npx tsc -b` 0 错误。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 观察小窗口模型下是否出现「输入过大导致压缩失败」。若有，正确修法是分块递进摘要（chunked rolling summary），**不要**恢复掐头留尾截断。
  2. `LEGACY_COMPACTION_NOTICE_PREFIX/SUFFIX` 保持中文不要翻译——它们是历史 notice 识别常量，翻译会让旧会话的压缩消息失去识别与过滤。
  3. 全量 `npm run test` 已在后台跑（`task_b61a99f9`），结果待确认；`npm run lint` / `npm run build` 本轮尚未重跑，如需完整门禁请补一次。

## compaction-ux-timing（done，2026-10-27）

- Current Objective（当前目标）：分析自动上下文压缩的显示时机是否合理，并把「必须要做」的体验缺口一次性补齐（架构/设计最优，允许重构该部分代码）。
- 结论（一句话）：压缩 UI 不再由服务端零散事件 + 装饰层注入式卡片驱动，而是由 `state.compactionNotice` 这一份单向状态投影驱动、由 React 渲染成消息列表尾部行；进行中静默、审批超时后死卡片、自动压缩切掉当前回合、阈值信号被丢弃、卡片强制滚动这五个缺陷同时消失。
- 改动文件：`server/auto-compaction.mjs`、`server/agent-approval-orchestrator.mjs`、`server/agent-compaction.mjs`、`server/agent-manager.mjs`、`server/agent-session-queries.mjs`、`src/lib/server-agent.ts`、`src/lib/server-agent-types.ts`、`src/lib/global-agent-sse-client.ts`、`src/lib/shared-server-agent.ts`、`src/lib/i18n.ts`、`src/components/chat/surface/ContextCompactionStatusRow.tsx`（新）、`ContextCompactionDecisionRow.tsx`（新）、`MessageList.tsx`、`ChatSurface.tsx`、`ChatTypes.ts`、`src/components/chat/panel-wiring/approval-cards.ts`、`src/components/chat/panel-decoration/approval-card.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/styles/chat/context-compaction.css`、`tests/server/auto-compaction-notice.test.mjs`（新）、`tests/frontend/context-compaction-rows.test.ts`（新）、`tests/server/auto-compaction.test.mjs`、`tests/server/agent-approval-orchestrator.test.mjs`、`tests/frontend/approval-card.test.ts`、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/hooks/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npx tsc -b` 0 错误；`npx eslint` 22 个改动文件 0 error；压缩相关 22 个测试文件 → 22 files / 299 tests passed；`npm run test` → 435 files / 5076 passed / 2 skipped（退出码 0）；`npm run lint` → 0 error；`npm run build` → 成功（5.82s）。
- Blockers（阻塞）：无。
- Next Session（下一步）：
  1. 设置页「保留最近回合」的说明仍写「0 = 不保留最近回合」，而自动压缩现在至少保留当前 1 个完整用户回合（手动 `/compact` 语义不变）。建议按「0 = 只保留当前回合」改写 `autoCompactKeepRecentTurnsDescription` 文案，或把设置项下限提到 1，二者选一；本轮未动，避免超出“显示时机”范围。
  2. 压缩失败目前只有 `auto_compact_failed` 的临时日志提醒，没有常驻错误行。若要补，建议复用状态行样式新增一个瞬时 dismiss 的错误行，注意不要让它在成功后被复活。
  3. 未做真机视觉确认（shimmer 与决策行在浅色/深色、窄窗下的观感；建议按本轮回复里的自查步骤走一遍）。
  4. 未创建 Git commit，未手工修改 `dist/` / `package-dist/` / `package-offline/`（`npm run build` 按既有脚本产出）。

## baseline-verification（done，2026-10-27）

- Current Objective（当前目标）：完整跑一次基线验证（`npm run test` / `npm run lint` / `npm run build`），确认无真实失败并留档。
- 结论（一句话）：三项全绿，无源码改动；多轮文档里遗留的「31 个 jsdom 缺包环境错误」已不存在（`node_modules/jsdom` 现在可解析）。
- 改动文件：`progress.md`、`session-handoff.md`、`feature_list.json`（均只加本轮验证记录）。
- Evidence（验证）：`npm run test` → 433 files / 5057 passed / 2 skipped，退出码 0（82.47s）；`npm run lint` → 无输出（0 error / 0 warning）；`npm run build` → `✓ built in 6.17s`。
- Blockers（阻塞）：无。
- Next Session（下一步）：`feature_list.json` 里 7 个 feature 全部 done，暂无待办；工作区有三个他人遗留未跟踪临时文件（`.tmp-cdp-probe4.cjs`、`.tmp-cdp-probe5.cjs`、`.tmp-cdp-result.json`），如需清理请先确认归属。未创建 Git commit，未手工修改生成产物。

## background-tasks-output-height（done，2026-10-27）

- Current Objective（当前目标）：后台任务面板的终端输出区（终端明细）太高，长日志时被拉成半屏、把任务列表挤到只剩两行；改矮到约 14~16 行。
- 结论（一句话）：输出区改为按内容占位并封顶 `max-height: 18rem`（保留 `min-height: 4rem`）、`flex: 0 1 auto`；`.quickforge-background-tasks-detail` 同步改为 `flex: 0 1 auto`（不再吃满剩余高度）；滚动区 `flex: 1` → `flex: 1 1 auto`（basis auto 才能让日志高度参与占位）；剩余竖向空间归还任务列表（`-list` 去掉 `max-height: 45%`，改 `flex: 1 1 auto`，仍是唯一滚动容器）。
- 改动文件：`src/styles/workspace/background-tasks.css`；`tests/frontend/background-tasks-tab.test.ts`（新增封顶用例）；`docs/design/background-tasks-align-preview.html`；`docs/wiki/src/styles/README.md`；`docs/wiki/src/components/README.md`；`feature_list.json`；`progress.md`；本文件。
- Evidence（验证）：`npx vitest run background-tasks-tab + css-architecture + subagent-running-indicator` → 3 files / 42 tests passed；`npm run lint` → 0 error；`npm run build` → 成功（5.82s）。
- Blockers（阻塞）：无。
- Next Session（下一步）：未做真机视觉确认（18rem 上限是否合适、340px 窄面板下 meta 行数多时的观感；如偏矮可只调 `.quickforge-background-tasks-output` 的 `max-height`）；`npm run test` 全量未跑（本轮只跑 3 个相关文件）。未创建 Git commit，未触碰生成产物。

## process-stage-scroll（done，2026-10-27；2026-10-28 已整体回滚，见本文件顶部）

- Current Objective（当前目标）：把「执行中 · 16 个工具调用 · 4 条命令 · 编辑 1 个文件」这条内层阶段展开后的工具列表收拢为固定高度、超出区域内部滚动，并在执行中自动贴底到最新一行。
- 结论（一句话）：限高 `min(50vh, 18rem)` 挂在折叠动画壳层 `.quickforge-process-body-inner`（stage 专属选择器，DOM 结构不变），滚动只在 `[data-expanded="true"]` 挂上 + `overscroll-behavior: contain`；执行中 `scheduleProcessStageStick`（rAF）贴底跟随，`resolveProcessStageScrollFollow` 24px/8px 双向滞回，跟随标记存 `dataset.quickforgeStageFollow`，手动收起复位。
- 改动文件：`src/styles/chat/process.css`；`src/components/chat/panel-decoration/process-folding.ts`；`tests/frontend/process-folding.test.ts`；`tests/frontend/process-folding-incremental.test.ts`；`tests/frontend/chat-surface-css-contract.test.ts`；`docs/wiki/src/styles/README.md`；`docs/wiki/src/components/README.md`；`feature_list.json`；`progress.md`；本文件。
- Evidence（验证）：`npx tsc -b` 0 错误；`npx eslint` 改动文件 0 error；`npx vitest run` process 相关 11 文件 → 11 files / 186 tests passed；`npm run lint` 0 error；`npm run build` 成功（6.08s）。
- Blockers（阻塞）：无。
- Next Session（下一步）：未做真机视觉确认（限高取值 `min(50vh, 18rem)` 是否合适、H5 窄屏滚动条宽度观感）；npm 全量测试未跑（本轮只跑 process 相关 11 文件）。未创建 Git commit，未触碰生成产物。

## models-providers-layered-settings · 跟进 5（删除连接分区头部行，done，2026-10-27）

- Current Objective（当前目标）：删掉「模型与提供商」页连接层顶部的「连接」标题行与右侧「测试连接」按钮（模型行已有逐模型测试），并一并清理随之变成死代码的 provider 级测试链路。
- 结论（一句话）：`ConnectionSection` 不再渲染分区头部，连接表单直接贴在详情卡顶部；`testStates` / `IDLE_TEST` / `testProvider` / `rowTestStatus`、`ConnectionSection` 的 `testState`+`onTest`、`ProviderDetailPane` 的 `testBadge`、`ProviderListPane` 的 `ProviderTestStatus`+`statusBadge` 全部删除；服务端移除 `POST /api/models/provider-test`（`provider-discover` 保留）；i18n 删除成对死 key `testConnection` / `testRequiresBaseUrl`。
- 改动文件：`src/components/settings/custom-providers/connection-section.tsx`、`provider-detail-pane.tsx`、`provider-list-pane.tsx`、`src/components/settings/tabs/CustomProvidersSettingsTab.tsx`、`server/routes/models.mjs`、`server/index.mjs`、`src/lib/i18n.ts`、`tests/frontend/custom-providers-tab.test.ts`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npx tsc -b` 0 错误；`npx vitest run custom-providers-tab + settings-workspace-react + css-architecture + i18n-language-snapshot` → 4 files / 43 tests passed；`npx eslint` 改动文件 0 error；`npm run lint` 0 error；`npm run build` 成功；`npm run test` → 433 files / 5052 passed（2 skipped），退出码 0。
- Blockers（阻塞）：无。
- Next Session（下一步）：`connectionOk` / `connectionFailed` / `testingConnection` / `connectionSection` 仍被模型行与连接分区 aria-label 复用，未删除；如需进一步精简可评估把 `connectionSection` 换成 aria-label 常量。未创建 Git commit，未触碰生成产物。

## background-tasks-sidebar · 跟进 2（入口重构，done，2026-10-27）

- Current Objective（当前目标）：把「打开后台任务面板」的入口收敛为置顶摘要「后台命令」区块 + Composer 左下角命令图标两处，删除会话顶栏入口与 Composer 浮层。
- 结论（一句话）：入口重构已完成——`ConversationHeader` 的后台任务图标（含运行中徽标）删除；置顶摘要区块提供「查看全部」+ 整行命令主体两个入口；Composer 终端图标（`.quickforge-background-command-trigger`）改为直接打开右侧面板，`openBackgroundCommandMenu` 与 `.quickforge-background-command-menu` 样式已删；新增 `src/lib/background-tasks-open.ts` 事件桥（`quickforge:open-background-tasks`），`App.tsx` 只接受当前会话或缺省 `sessionId` 的请求后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`。
- 改动文件：`src/components/app/ConversationHeader.tsx`（删除入口）；`src/components/git/PinnedSummarySections.tsx` + `src/components/git/GitToolsPinnedSummary.tsx`（「查看全部」+ 整行按钮 + 兄弟停止按钮，`onOpenBackgroundTasks` 透传）；`src/components/chat/panel-decoration/subagent-running-indicator.ts`（图标改 `dispatchOpenBackgroundTasks`）；`src/styles/chat/composer-controls.css`（删浮层样式）；`src/lib/background-tasks-open.ts`（新增）、`src/App.tsx`、`src/lib/i18n.ts`；`tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/subagent-running-indicator.test.ts`；`docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/lib/README.md`；`feature_list.json`、`progress.md`、本文件。
- Evidence（验证）：`npx tsc -b` 通过；`npx eslint` 相关改动文件 0 error；`npx vitest run` 相关 5 个测试文件 79 passed；`npm run build` 成功（3.39s）。
- Blockers（阻塞）：无。
- Next Session（下一步）：可选——后台命令输出改为 SSE 流式推送（替掉 2s 轮询）；把 Terminal Dock 与后台任务面板统一为「任务中心」。已知保留项：`renderBackgroundCommandItems` 仍被 subagent 运行浮层复用，`.quickforge-background-command-item/-copy/-stop/-log` 样式不能一并删。未创建 Git commit，未触碰生成产物。

## present-files-inline-links（done，2026-10-26）

- Current Objective（当前目标）：`present_files`（展示文件）工具卡去掉右上角眼睛（预览）按钮，改为摘要区逐文件「文件图标 + 文件名」，文件名 hover 出下划线、点击跳转预览；范围只限 present_files。
- 结论（一句话）：删除 `renderPreviewButton`，新增 `renderPresentedFilesSummary(params)` 在摘要区逐文件渲染可点文件名（复用 `previewArtifactClickHandler` → `PREVIEW_ARTIFACT_EVENT` 与 `underline-offset-4 hover:underline` 文案），不可预览/工作区外路径纯静态；动作区只剩终止命令按钮。
- 改动文件：`src/lib/tool-renderers/shared.tsx`、`src/lib/tool-renderers/local-workspace-tool-renderer.tsx`、`tests/frontend/tool-renderer-file-icon.test.ts`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Evidence（验证）：`npx tsc -b` 0 错误；定向 vitest 4 files / 39 passed；`npx eslint` 改动文件 0 error；`npm run lint` 0 error / 3 存量 warning；`npm run build` 成功；`npm run test` 402 files / 4731 tests（4727 passed / 3 failed / 1 skipped）——3 个失败在 `background-tasks-tab.test.ts` 与 `subagent-running-indicator.test.ts`，断言对象是工作区里其他未提交改动（`App.tsx` 缺 `kind: 'background-tasks'` 等），与 `tool-renderers/*` 无交集；另有 31 个 jsdom 缺包既有错误。
- Blockers（阻塞）：无。
- Next Session（下一步）：如需可视化确认，可启动应用查看 present_files 卡片在窄列下的换行表现（逐文件 `inline-flex` + 裸文本逗号分隔）；顺带清理与本轮无关的 `background-tasks-tab.test.ts` / `subagent-running-indicator.test.ts` 失败（属另一份未提交改动）。未创建 Git commit，未触碰生成产物。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Current Objective（当前目标）：
- 结论（一句话）：
- 改动文件：
- Evidence（验证）：
- Blockers（阻塞）：
- Next Session（下一步）：未创建 Git commit，未触碰生成产物。

## background-tasks-sidebar（done，2026-10-26）

- Current Objective（当前目标）：把后台运行命令的运行态与历史收进右侧边栏，提供筛选/搜索/详情/日志预览/跟随输出/停止，并补齐 docs/wiki、progress、feature 记录。
- 结论（一句话）：Inspector 新增 `background-tasks` 运行时 Tab（单实例复用、不持久化），运行中取 `backgroundCommands` 快照、终态由 `toolResult` 消息 `details` 派生，未新增服务端接口；顶栏 Activities 入口带运行中数量徽标。
- 改动文件：`src/lib/background-tasks-model.ts`（新增）；`src/components/workspace/BackgroundTasksTabContent.tsx`（新增）；`src/components/workspace/WorkspaceInspector.tsx`、`workspace-panel-tabs.ts`、`workspace-inspector-tabs.ts`、`useInspectorTabs.ts`；`src/components/app/ConversationHeader.tsx` + `src/App.tsx`；`src/styles/workspace/background-tasks.css`（新增）+ `src/styles/index.css`；`src/lib/i18n.ts`（新增面板文案，清理未使用的 `backgroundTaskTabLabel` en/zh 各一行）；`tests/frontend/background-tasks-model.test.ts`、`tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/server-agent-background-commands-frame.test.ts`（新增，6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 合并）；docs/wiki 四处（components、styles、server、server/tools）；`feature_list.json` / `progress.md` / 本文件。
- Evidence（验证）：`npm run test` → 402 files passed / 4722 tests passed（1 skipped），退出码 1 仅来自 31 个 `Cannot find package 'jsdom'` 的既有环境错误（31 个 `@vitest-environment jsdom` 测试文件的 worker 启动失败，无真实断言失败），其余断言全过；`npm run lint` 0 error / 3 存量 warning；`npm run build` 成功（3.78s）。
- Blockers（阻塞）：无。`npm run test` 仍有 31 个 `Cannot find package 'jsdom'` 的既有环境错误（`jsdom` 已声明为 devDependency 但未安装），与本改动无关。
- Next Session（下一步）：可选——后台命令输出改为 SSE 流式推送，替掉 2s 轮询；把 Terminal Dock 与后台任务面板统一为「任务中心」。已知限制：`backgroundTasks` 为服务端内存 Map，重启后终态丢失；`settleBackgroundCommandToolResult` 找不到对应 `toolResult` 消息时返回 false，该任务不进面板终态；`listBackgroundCommandTasks` 仍只返回 running（idle 回收语义依赖）。未创建 Git commit，未触碰生成产物。

- 跟进（2026-10-27，后台任务面板样式对齐 + 入口统一）：
  - Current Objective（当前目标）：把后台任务面板的横向基准、控件高度、间距与字号刻度对齐 Inspector 其余 tab（与 `workflow-detail.css` 同轴），消除切 tab 横跳与工具栏 1px 高低差；同时把入口收敛到一处。
  - 结论（一句话）：`background-tasks.css` 重写为 0.875rem 基准 + 1.625rem 控件同高 + 1/16 网格间距 + 4 档字号；行内操作与元信息共用网格第三列修掉压字；Composer 命令图标改为派发 `quickforge:open-background-tasks` 窗口事件，删除浮层菜单与顶栏后台任务入口。
  - 改动文件：`src/styles/workspace/background-tasks.css`（重写：0.875rem 水平基准、输出区三级统一 0.5rem、分段控件 1.375rem + 0.125rem 内距 = 搜索框 1.625rem、间距回到 0.375/0.5/0.75、字号 4 档 0.6875/0.75/0.8125/0.875、`.item-meta` 与 `.item-actions` 共用 `grid-template-columns: auto minmax(0,1fr) minmax(3.5rem, auto)`、选中态不显示行内操作、命令单行 ellipsis + `title`、详情头恢复 `border-bottom`、meta `padding-bottom: 0.5rem`、输出区 `min-height: 4rem` + `.detail { overflow: hidden }`、新增 `.quickforge-background-tasks-no-results`、`pointer: coarse` 图标按钮 2rem、`:focus-visible` / `:hover` 过渡与 reduced-motion）；`src/lib/i18n.ts`（`backgroundTaskElapsed` → `backgroundTaskMetaElapsed`，新增 `backgroundTaskNoResults`）；`src/components/workspace/BackgroundTasksTabContent.tsx`（详情命令加 `title`、footer 提示加单行截断类）；`src/lib/background-tasks-open.ts`（新增窗口事件入口）；`src/App.tsx`、Composer 命令图标、`src/components/app/ConversationHeader.tsx`（删除 `openBackgroundCommandMenu` 浮层与顶栏入口）；`tests/frontend/background-tasks-tab.test.ts`；`docs/design/background-tasks-align-preview.html`（新增对齐校验页）；`progress.md` / 本文件。
  - Evidence（验证）：`npx tsc -b` 通过；`npm run lint` 0 error（3 条 warning 在 `coverage/` 生成目录，存量）；`npm run build` 通过；`npx vitest run tests/frontend/` → 228 个文件中 227 通过，唯一失败 `tests/frontend/custom-providers-tab.test.ts` 属另一并行 feature（与本次无关），31 个 jsdom 缺包 worker 启动失败属既有环境问题；后台任务相关 67 个用例全绿。
  - Blockers（阻塞）：无。
  - Next Session（下一步）：可在实机上按 `docs/design/background-tasks-align-preview.html` 复核 340/380px 窄列与亮暗主题；日志预览仍是 2s 轮询，如需流式再单独排期。未创建 Git commit，未触碰生成产物。

## models-providers-layered-settings（done，2026-10-26）

- Current Objective（当前目标）：按 `docs/design/models-providers-settings-redesign.html` 把「模型与提供商」设置页重构为提供商列表 / 连接 / 模型三层，各层独立保存。
- 结论（一句话）：前端拆为编排器 + `settings/custom-providers/` 三层组件（存储结构不变、连接层保存迁移改名密钥），服务端新增 provider-test / provider-discover，窄屏详情变抽屉。
- 改动文件：`src/components/settings/tabs/CustomProvidersSettingsTab.tsx`（重写）；`src/components/settings/custom-providers/`（shared / provider-list-pane / provider-detail-pane / connection-section / model-list-section，新增）；`src/styles/settings/custom-providers.css`（新增）+ `src/styles/index.css`；`server/routes/models.mjs` + `server/index.mjs`（两个新接口）；`src/lib/i18n.ts`；`tests/frontend/custom-providers-tab.test.ts`（新增）+ `tests/frontend/settings-workspace-react.test.ts`；docs/wiki 三处；`feature_list.json` / `progress.md` / 本文件。
- Evidence（验证）：目标测试 28 passed（13 新用例 + 15 既有契约）；`npm run test` 399 files / 4684 tests 全过（31 个 jsdom 缺包 Unhandled Error 为存量）；`npm run lint` 0 error；`npm run build` 成功。
- Blockers（阻塞）：无（jsdom 环境缺失沿用 skills-settings-redesign 记录，待统一 `npm install`）。
- Next Session（下一步）：已做一轮视觉打磨（协议分段不换行并与输入框等高对齐、密钥行三段纵排、模型行徽标垂直居中、字号刻度统一、协议短标签）；剩余可选项——实机视觉走查三层布局与窄屏抽屉；自动发现类型（ollama/llama.cpp/vllm/lmstudio 的一等入口，store 类型已支持）与 provider 级连接状态持久化（当前仅会话内）。未创建 Git commit，未触碰生成产物。

## ask-user-echo-fix（done，2026-10-26）

- Current Objective（当前目标）：修复 ask_user 工具最后补充内容不回显的问题，按 `docs/design/ask-user-echo-fix.html` 方案 A 落地。
- 结论（一句话）：回执改为选项 chip + 独立补充段两段语义；跳过/超时 `answers: null` 也渲染回执并保留 `remark`；待答卡补充框显示「已填写」并预展开；Enter 增加 IME `isComposing` 守卫。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`；`src/lib/tool-renderers/ask-user-tool-renderer.tsx`；`src/styles/chat/interaction-cards.css`；`src/lib/i18n.ts`；`tests/frontend/ask-user-card.test.ts`；`tests/frontend/ask-user-renderer-remark.test.ts`；`docs/design/ask-user-echo-fix.html`；`docs/wiki/src/components/README.md`；`docs/wiki/src/lib/README.md`；`docs/wiki/src/styles/README.md`；`feature_list.json`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：目标测试 36 passed；ask_user 回归面 6 files / 103 tests passed；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。
- Blockers（阻塞）：无。验证期间存在并行的 CustomProviders 重构，已延时等待收敛；`npm run test` 全量仍有 31 个 `Cannot find package 'jsdom'` 既有环境错误（`jsdom` 已声明为 devDependency 但未安装）。
- Next Session（下一步）：可补 ask-user 卡片的按钮点击级行为测试（当前只有源码字符串断言 + 历史回执静态渲染）。未触碰生成产物。

## skills-settings-redesign（done，2026-10-26）

- Current Objective（当前目标）：重构设置页「技能」列表，最终按用户反馈改为「点击技能行打开居中详情弹窗」。
- 结论（一句话）：技能页现为全宽筛选/来源分组列表；点击行通过 portal 打开详情弹窗（概览/指令/元数据），批量启停、撤销、重新扫描和搜索路径均可用，原 Skills API 语义未变。
- 改动文件：`src/components/skills-dialog.tsx`；`src/styles/settings/skills.css`（新增）；`src/styles/index.css`；`src/styles/settings/shell.css`；`src/lib/react-settings-tabs.tsx`；`src/lib/i18n.ts`；`docs/wiki/src/components/README.md`；`docs/wiki/src/styles/README.md`；`docs/design/skills-settings-redesign.html`；`feature_list.json`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：`npm run build` 成功；`npx eslint src/components/skills-dialog.tsx src/lib/react-settings-tabs.tsx` 通过；`npm run lint` 0 error / 4 既有 warning；目标测试 43 passed；全量测试 398 files / 4664 tests passed，但退出码 1 来自缺失 `node_modules/jsdom` 的 31 个 jsdom 环境测试（依赖已在 devDependencies，未安装，与本次无关）。隔离数据目录 + Headless Chrome 在 1440×900 / 900×900、明暗主题验证筛选、弹窗、markdown、批量启用与撤销，控制台无错误。
- Blockers（阻塞）：无（jsdom 全量测试环境缺失待后续统一安装既有 devDependency）。
- Next Session（下一步）：如需继续打磨，可补充技能组件级交互测试（当前无 skills-dialog 渲染测试）；可评估详情弹窗焦点陷阱与关闭后焦点回到原技能行。未创建 Git commit，未触碰生成产物。

## default-context-window-1m（done，2026-10-26）

- Current Objective（当前目标）：把默认模型配置的上下文窗口从 200000 改为 1000000（1M），只改默认值，不动 `modelId`、不加设置项、不重构无关代码。
- 结论（一句话）：`DEFAULT_CONNECTION.contextWindow` 改为 `1000000`，全部回退点自动跟随，`maxTokens` 保持 `32768`。
- 改动文件：`src/lib/pi-chat.ts`（单行）、`progress.md`、`session-handoff.md`。
- Evidence（验证）：`npx vitest run tests/frontend/settings-workspace-react.test.ts tests/frontend/side-chat-agent.test.ts tests/frontend/context-usage.test.ts` → 36 passed；`npm run lint` → 0 errors / 4 既有 warnings；`npm run build` → 成功。
- Blockers（阻塞）：无。
- Next Session（下一步）：如需放大长会话压缩广度，评估 `server/conversation-compaction.mjs:203-206` 的 160000 字符硬上限；`maxTokens` 仍为 32768。未创建 Git commit，未触碰生成产物。

## run-command-stop-button-inline（done，2026-10-29）

- Current Objective（当前目标）：运行中的 `run_command` 工具行，停止 icon 从整行最右改回紧跟摘要/箭头的从左排列，且向下展开日志时位置不变。
- 结论（一句话）：本地工具卡改为「`.quickforge-tool-header`（details 仅包 summary + 终止按钮）+ `.quickforge-tool-panel` 展开面板」两层；有按钮时标题行按内容收缩，按钮始终紧跟摘要末尾，展开面板铺满整行且由 `details[open]` 驱动显隐。
- 改动文件：`src/lib/tool-renderers/local-workspace-tool-renderer.tsx`；`src/styles/chat/tool-summary.css`；`src/styles/chat/tool-output.css`；`tests/frontend/local-tool-running-sweep.test.ts`；`tests/frontend/chat-surface-css-contract.test.ts`；`feature_list.json` / `progress.md` / 本文件。
- Evidence（验证）：工具渲染器与 CSS 契约 8 files / 187 passed；`npx eslint` 改动源码/测试 0 problems；`npm run build` 成功；真实渲染实测收起/展开 header 均 200px（整行 624px），按钮距箭头 5px 且位置不随展开变化，展开面板 624px，完成态无按钮。
- Blockers（阻塞）：无。
- Next Session（下一步）：面板已移出 details，开合由 `:has(details[open])` 驱动；如后续需要浏览器查找自动展开或更严格的披露语义，可再评估 `aria-controls`/自定义披露头。未创建 Git commit，未触碰生成产物。
