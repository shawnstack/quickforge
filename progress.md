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
