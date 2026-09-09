## Feature：产物卡「审查」打开卡死修复——file-diff 20s 超时 + 终态 diff tab 重拉（2026-09-09）

- 现象：用户报告点击生成产物卡的「审查」，若审查内容已被删除，会一直显示「打开中」，并导致其他请求卡住。
- 调研结论（explore subagent 只读 + 主 Agent 溯源）：服务端 `handleGitFileDiff`（server/routes/workspace.mjs:1464）所有分支都有界且必回复——文件已删除/已无工作区变更 → 404 `File has no working tree changes`（7157293 起前端转友好空态），tracked 删除 → 200 删除 diff，git 子进程 2 分钟硬超时，throw 全被全局 catch sendError。挂死在前端：`getGitFileDiff` 是 workspace-api 里唯一无超时的 git 请求；连接池排队/服务端极慢时 `await` 永不 settle → reader tab 永远 `loading:true`「打开中」，且挂起请求一直占同源 6 连接池一个槽位拖住其他请求；`openDiffTab` 对已存在 diff tab 只激活不重拉，卡死后再次点「审查」永远无法恢复。guard 早退（项目切换中途）与 tab 持久化恢复均排除（diff reader 不被持久化恢复；换项目时 tabs 整体替换）。
- 修复：① `workspace-api.ts` `getGitFileDiff` 加 `GIT_FILE_DIFF_TIMEOUT_MS=10s` 超时（对齐 `getGitStatus` 的 TimeoutError AbortController 模式，成功后清 timer），同时覆盖 `openDiffTab` 与 `toggleReviewDiff` 两个调用点；② `WorkspaceInspector.tsx` openDiffTab 的 fetch/写回抽为共享 `loadDiffIntoReaderTab`（guard 失效放弃写入不变），已存在 diff reader 分两态：在途仅激活；终态（diff/error/noChanges）重置为 loading 重拉——再次点「审查」即可恢复/刷新。
- 验证：定向 vitest 6 files / 71 tests 全过（新 `tests/frontend/workspace-diff-review-recovery.test.ts` 6 用例）；误触发全量 `npm run test` 294 files / 2832 tests 全过；eslint 三改动文件 0 error；`npx tsc -b`；`npm run build` 通过（dist 已刷新）；`git diff --check` 通过。
- 下一步：真机冒烟——删除/回滚产物文件后点「审查」应显示空态或删除 diff（不再卡「打开中」）；人为断网/挂起时 10s 后出红色超时错误，再次点「审查」重新拉取可恢复；其余请求不被拖住。
- Notes（与 feature 无关，未处理）：① 请求 effect 里 `openPanelTab('review', view)` 与紧随的 `openDiffTab(path)` 在同一同步块内，两处闭包的 `panelTabs` 都不含刚 append 的 review tab——项目+会话首次点「审查」（之前无 review tab）会 append 两个 review panel tab（diff reader 挂第二个，后续点击挂第一个）；② workspace-api 其余 git 读（branches/log）与 workspace 读（children/file）同样无超时，连接池极端场景仍可能被钉住，可按 getGitFileDiff 模式逐步补。

## Feature：对话报错重试一行式轻量错误行（2026-09-09）

- 背景：用户问「当前页面报错的重试有没有更优雅的交互」，澄清目标为对话回合失败的终态错误层（与 SSE 重连、模型流自动重试并列的第三层：恢复失败后的用户决策）。
- 调研结论：现状 = pi-web-ui 红块（`bg-destructive/10` + `<strong>Error:</strong>` 恒英文前缀 + 原文/译文直出）+ 错误旁 icon-only ▶「继续生成」（`onContinueAfterError` 两分支：stash 重发或发「继续」消息，语义不定）+ 真正的「重试」（`retryFromMessage` 裁剪重生成）藏在最后一条用户消息 hover 行（触屏不可发现）；无重试过程反馈、反复失败无升级引导。
- 设计：先出交互稿 `design-mockups/conversation-error-retry.html`（token 镜像 pi-web-ui 真实 oklch 值、现状 DOM 复刻对照、可操作演示、编号清单），浏览器实操验证过状态机；用户选定方案 A 并两轮收敛（更简洁 + 补「详情」），定稿一行式：`⚠ 生成失败 · 译文或原文 [重试] [详情]`，重试中转「⟳ 正在重试…」，连续失败 ≥2 追加琥珀「已重试 n 次仍失败 · 切换模型」。
- 实现：见 feature_list.json 同 id 条目（新模块 turn-error-row.ts / turn-error-state.ts；message-actions.ts 移除「继续生成」接入新错误行；ChatPanelHost 统一重试语义 + onSwitchModel + 主 effect 内创建 tracker；i18n 5 新 key 移除 errorContinueAction；index.css quickforge-error* 段复用 reconnect/琥珀词汇）。
- 验证：定向 vitest 4 files / 62 tests 全过（含新建 turn-error-state 7 用例、message-actions 重写的 turn error row 用例组）；相关回归 14 files / 186 tests 全过；`npm run test` 全量 292 files / 2799 tests 全过；eslint 改动文件 0 error 0 warning（全量 0 error / 5 个 server/ 既有 warnings）；tsc -b；`npm run build` 通过（仅既有 chunk 提示）；dist 抽查含新样式与 zh 文案。
- 边界：不动 SSE 重连/模型流重试两层与「已停止」标签；数据层 errorMessage 保持英文原文；不自动重试；详情只读；hover ↻ 与门控保留。
- 下一步：真机弱网验证——制造回合失败应看到一行式错误行（译文 + 就地重试 + 详情原文）；点重试转「正在重试…」后恢复或再失败（第二次起出现琥珀升级行，「切换模型」打开模型选择）；发送失败场景点「重试」应原样重发 stash 消息。备选后续：subagent 错误原因卡（local-tools.ts 红卡）对齐同款轻量行词汇。

## Feature：SSE 流式帧节流 + 背压保护（2026-09-09）

- 背景：第一轮调研发现但一直未处理的两个 SSE 问题。
- 调研结论：每帧同时携带 `message` 与 `assistantMessageEvent.partial`（同一份完整消息），单帧 ≈2× 累积 JSON，一个 N token 回合累计传输 O(N²)；前端 pi-web-ui 是全量替换 + rAF 批处理，不依赖每个 delta；`writeSseEvent` 从不检查 `res.write` 返回值。
- 实现：`message_update` 50ms trailing 合并（`SSE_MESSAGE_UPDATE_THROTTLE_MS`，非 message_update 事件先 flush pending 保序，cleanup dispose）+ `writableLength` 超 4MB（`SSE_BACKPRESSURE_BYTES`）时丢弃可丢弃帧（终态帧永不丢弃，不 await drain）。
- 验证：定向 39 tests 全过（新增 5 个用例）；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2825 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Notes：既有「SSE 写失败只 WARN 一次」用例的触发事件由 `message_update` 改为 `message_end`（前者现在延迟 50ms 写出，会被 socket error 抢占），断言意图不变。
- 下一步：真机观察长对话的 SSE 帧量/内存；剩余候选 = ChatPanelHost 接入 git status light（等并行会话收尾）、settings/custom-providers 逐 key 请求批量化、`message_update` 改增量 delta（高风险）。

## Feature：/api/git/status 单次耗时优化（合并 git 子进程 + light 模式）（2026-09-09）

- 背景：连接池优化后，`git status` 成为最大单一负担（最近 1.5 分钟 10 次、每次 400-670ms）。
- 根因：4 次串行 git 子进程（Windows 每次 60-130ms），其中 `numstat` 最贵（125ms）且只有 WorkspaceInspector 需要。
- 实现：见 feature_list.json 同 id 条目（A `--branch` 合并 branch 查询、B 退出码判仓库、C light 模式跳过 numstat + 行数统计）。
- 实测：subagent 基准 full **419.3ms → 256.7ms**（-38.8%，git 子进程 4→2）、light **106.2ms**（-74.7%）；重启后真机复测 full **276/272/295ms**、light **107/111/109ms**（改前真机 400-670ms），light 返回 branch/files 且首条文件不含 `additions`。
- 验证：定向 27 tests 全过；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2820 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Notes：实施中发现 App 标题栏不能走 light（`titleGitStatus` 被 `GitToolsPinnedSummary` / `GitCommitPushDialog` 共享，需要 `additions/deletions`），已回退并同步测试断言与 wiki；light 能力保留待 ChatPanelHost 分支探测接入（该文件正被另一会话改动）。

## Feature：会话列表重复请求收敛：refreshSessions 合并 + /api/agents 触发收敛（2026-09-09）

- 背景：承接浏览器连接池优化。实测重启后 2.5 分钟内 `/api/storage/sessions-metadata/index/lastModified` 23 次、`pinnedAt` 13 次、`/api/agents` 16 次（单请求 1-5ms，但数量占满 6 连接池）。
- 根因：①`agent_end` 双路 `refreshSessions`（App 全局订阅 + `syncSessionUI`），而 `refreshSessions` 无 in-flight 合并；②`useVisibleRuntimeStatuses` 的刷新 effect 依赖每次重建的 Set 身份。
- 修复：见 feature_list.json 同 id 条目（`REFRESH_SESSIONS_MERGE_MS=250` in-flight 合并 + broadcast 合并到轮尾；effect 依赖收敛为 `visibleSessionKey`）。
- 验证：定向 vitest 45 tests + 新增 1 test 全过（含变异验证）；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2813 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Notes：修复期间修正了新测试文件的一处 `react-hooks/rules-of-hooks` lint error（测试 harness 直接调用 hook，改为定向禁用注释）。
- 下一步：刷新页面后观察 `lastModified`/`pinnedAt`/`/api/agents` 频率是否下降；剩余候选是 `git status` 单次 400-670ms 的服务端耗时（`--untracked-files=all` + numstat）与 settings/custom-providers 逐 key 请求批量化。

## Feature：浏览器连接池压力缓解：git status 去重 + sessions-changed 并入全局 SSE（2026-09-09）

- 背景：承接上一条 runtime-diagnostics-instrumentation 的实测数据，定位「流式正常但普通 API 卡」的主因并修复。
- 实测结论：服务端无阻塞（lag p99 33.62ms ≈ Windows 基线、89% 请求 <50ms、6 并发 git status 下 health 45ms）；浏览器同源 6 连接池被 2 条常驻 SSE 占 2 条；服务端观测普通请求并发峰值 6 → 需 8 条连接；高并发时刻来自页面加载静态 chunk、切回窗口时的数十个并发请求，以及 `/api/git/status` 3 个互不协调调用点（峰值 3 并发、每个 400-500ms）。
- 修复：见 feature_list.json 同 id 条目（A：getGitStatus 在途共享 + 引用计数 abort + 1s 缓存 + force 绕过 + gitPostJson 失效缓存 + onProjectsChanged 走缓存；B：sessions-changed 并入 `/api/agents/events`，删除 App 常驻 channels EventSource）。
- 验证：定向 vitest 4+3 files（36+87 tests）全过；改动文件 eslint 0 error；`npx tsc -b` 通过；`npm run test` 292 files / 2809 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过；`git diff --check` 通过。
- 真机验证（08:28 通过 POST /api/system/restart 重启为新 pid 28120）：重启后 2.5 分钟窗口内 `/api/channels/events` 请求 0 次、`/api/diagnostics` 的 inFlight 仅 1 条 `/api/agents/events`、`git status` maxOverlap 从修复前最多 3（压测 6-7）降到 1、sockets 从 7 降到 3。
- Notes：跨标签页项目列表在 onProjectsChanged 走缓存后最多 15s 可见；设置页渠道 Tab 打开时仍会额外建一条 `/api/channels/events`（保留既有行为）。

## Feature：运行时诊断采集：event loop lag / 在途请求 / 浏览器连接池排队（2026-09-09）

- 背景：用户反馈「对话流式输出正常，但其他普通 API 经常卡住」，运行方式 CLI/npm start + 浏览器。本次会话目标为「先加诊断能力，用数据定位主因」。
- 调研结论（双 explore 只读）：服务端已有每请求 durationMs 的 INFO 日志，但缺阈值告警、在途计数、event loop lag 与连接池指标。三类候选根因——①浏览器 HTTP/1.1 同源 6 连接池被每窗口 2-4 条常驻长连接 + 无超时慢请求占满（最可能，Notes 已有同机制历史复盘）；②服务端单事件循环被同步 SQLite 大事务阻塞；③单个 handler 慢（如大仓库 git status）。
- 用户确认：新增 `GET /api/diagnostics`（仅本机）；服务端 + 前端浏览器侧都采集；默认开启、`QUICKFORGE_DIAGNOSTICS=0` 关闭。
- 实现：见 feature_list.json 同 id 条目（服务端 `server/runtime-diagnostics.mjs` + `server/index.mjs` 埋点与端点；前端 `src/lib/browser-connection-diagnostics.ts` + `main.tsx` 挂 `window.__quickforgePerf`）。
- 验证：定向 vitest 4 files / 42 tests + 前端 1 file / 15 tests 全过；改动文件 eslint 0 error 0 warning；`node --check`；`npm run build` 通过（仅既有警告）；`npm run test` 292 files / 2799 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`git diff --check` 通过；真机冒烟（独立实例 127.0.0.1:5999）本机 200、隧道头 403、隧道头 health 仍 200。
- Notes（与 feature 无关）：本工作区同时存在另一会话的 conversation-error-retry 改动（`src/components/chat/*`、`src/lib/i18n.ts`、`tests/frontend/error-messages.test.ts`、`tests/frontend/message-actions.test.ts`、`design-mockups/conversation-error-retry.html`、`docs/reports/`），本 feature 未触碰这些文件；全量 test/build 在该并发改动存在时仍全绿。
- 下一步：真机按判据读数据——浏览器执行 `window.__quickforgePerf()`：若「最大排队大 / 耗时接近」且 `activeLongLived` 接近 6 → 浏览器连接池耗尽；若服务端 `eventLoop.p99Ms` 高且所有请求耗时同步变长 → 事件循环阻塞；若个别 path `totalMs` 突出而 lag 正常 → 单 handler 慢。确认主因后再决定优化 feature（SSE 背压 / 连接池治理 / 同步 SQLite 下放）。

## Feature：diff 无工作区变更时友好空态 + 产物卡 ±0 统计隐藏（2026-09-08）

- 现象：Agent 修改文件后用户 commit/revert/撤销，聊天产物卡仍显示「N 个文件已更改」；点「审查」打开 diff 得到红色英文错误 "File has no working tree changes"，与卡片文案互相矛盾；净变化为 0 时标题还显示 `+0 -0`。
- 根因：产物卡是会话累计（工具调用）口径，而「审查」的 `/api/git/file-diff` 是 Git 工作区实时口径；服务端对无变更文件正确返回 404（`server/routes/workspace.mjs` 固定 message），但前端 `openDiffTab`/`toggleReviewDiff` 把 `err.message` 原样作为红色错误渲染，且 API 层错误不携带 HTTP status。
- 实现：① `workspace-api.ts` 的 `fetchJson`/`postJson` 抛错时附加 `status`（导出 `WorkspaceApiError`）；② `WorkspaceInspector.tsx` 新增 `isNoWorkingTreeChangesError`（匹配服务端固定 message），`openDiffTab` 把该 404 转为 readerTab `noChanges` 空态——i18n 新 key `workspaceFileNoWorkingTreeChanges`（该文件当前没有工作区变更，可能已提交或还原）+ `workspaceOpenCurrentFile`（查看文件当前内容）按钮经 `openFileTab` 降级打开 file reader；`ReaderTab` 类型增加 `noChanges?: boolean`；③ `toggleReviewDiff` 内联展开同款：`expandedDiffNoChanges` state → `WorkspaceChangesList(expandedNoChanges)` → `WorkspaceInlineDiffPreview(noChanges)` 渲染纯文案空态（列表行已有打开文件入口，不放按钮）；其他错误仍显示红色 `err.message`，成功/复位路径清 `noChanges`；④ `assistant-artifact-card.ts` 头部统计条件改为 `hasDiff && (total.added > 0 || total.removed > 0)`，净变化 0 不再渲染 `+0 -0` 与 diffbar（空 headerStats div 保留布局）。
- 测试：`tests/frontend/workspace-diff-no-changes.test.ts`（新，5 用例：API status 附加、openDiffTab 404 分支、InlineReader 空态与降级回调、内联路径透传、i18n en/zh 成对 key）；`assistant-artifact-card.test.ts` +1（净 0 隐藏 ± 统计契约）。
- 验证：定向 vitest 4 files / 45 tests 全过；eslint 九个改动源码/测试文件 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- 文档：`docs/wiki/src/components/README.md` Review tab 条目补 404 根因、双口径说明与两条路径的空态交互；产物卡条目补净 0 隐藏统计。
- 边界：服务端检测逻辑零改动；产物卡会话累计口径与行内各文件 ± 显示不变；未新增依赖、未手工修改生成产物、未 commit/tag/push。

---

## Bugfix：聊天消息队列流式发送时无变化重渲染闪烁修复（2026-09-08）

- 现象：聊天正在流式生成且消息队列内容没有变化时，队列区域仍随每个流式 delta 全量重建，表现为队列或队列项闪一下。
- 根因：消息装饰流程会高频调用消息队列 `render()`，旧实现每次都执行 `root.replaceChildren()`，没有判断队列的可见状态是否实际变化。
- 修复：`message-queue.ts` 增加 `renderedSignature`，覆盖 `items`、`paused`、`isStreaming()`、`steeringEnabled()`、`jumpingId`、`editingId`；root 已连接且签名不变时保留现有 DOM。首次创建、脱离后重挂载或任一可见状态变化时仍完整渲染；签名仅在 DOM 重建完成后提交。拖拽发生位移后主动失效签名，确保 `pointercancel` 也会按权威数据恢复临时调整过的 DOM 顺序。
- 测试：`message-queue.test.ts` 增加源码契约，锁定同状态跳过、签名覆盖范围，以及新建/脱离 root 时不得跳过重建。
- 验证：`npx vitest run tests/frontend/message-queue.test.ts`（1 file / 15 tests）通过；相关 ESLint 0 error；`npm run build` 通过（仅既有字体解析与 chunk 体积提示）；`git diff --check` 通过。
- 边界：拖拽延期渲染、编辑输入恢复、空队列移除、排队/立即发送/暂停恢复等既有语义不变；无需更新 docs/wiki（纯组件内部渲染稳定性修复，不改架构、职责或公共入口）；未新增依赖、未手工修改生成产物、未 commit/tag/push。

---

## Feature：手动停止的助手消息显示灰色「已停止」（2026-09-08）

- 目标：用户手动终止生成后，部分回答末尾以灰色「已停止」标明终态，替换现状的红色斜体英文 "Request aborted"。
- 对齐过程：v1 对齐稿（假气泡面板 + meta 行/灰线/行内三方案）被否；v2 先摸清真实渲染——pi-web-ui AssistantMessage 对 `stopReason:'aborted'` 渲染 `<span class="text-sm text-destructive italic">Request aborted</span>`（红、斜体、英文、无 px-4 缩进贴左缘，且应用未安装 pi-web-ui 翻译，恒英文），稿子改为镜像真实消息区结构（design-mockups/assistant-stopped-message-preview.html），用户确认方案①（灰色、与正文同号、左缘对齐、常显）执行。
- 实现：`message-actions.ts` 新增 `decorateAssistantStoppedText`（与 `decorateAssistantErrorText` 同一先例）：仅 assistant 且 `stopReason==='aborted'`；先找 `quickforge-message-stopped-label` 标记 span（幂等/语言切换路径），否则发现 `span.text-sm.text-destructive.italic` 且 `parentElement.parentElement === 消息元素`（渲染根 div 直接子级，避免误伤 tool 卡内同款 aborted 标签——工具级状态由 process-folding `processAborted` 负责）；改写为移除 text-destructive/italic、挂标记类、`dataset.quickforgeStoppedLabel` 记录当前文案；i18n 新 key `messageStoppedLabel`（zh 已停止 / en Stopped）；`index.css` 新增 `.quickforge-message-stopped-label`（display:block、margin-top 6px、padding 0 1rem、color var(--muted-foreground)，字号沿用节点自带 text-sm=应用根覆盖下与正文同号）。Lit 重建的新红 span 由下一装饰周期重新发现改写；不动 pi-web-ui、服务端零改动，红色语义保留给错误。
- 测试：`message-actions.test.ts` 新增 describe 3 用例——标记 span 本地化改写且重跑幂等、非 aborted 消息不动、发现路径/类交换/CSS 样式源码契约（FakeNode 选择器引擎不支持复合选择器，发现路径沿用错误装饰的源码契约形态）。
- 验证：定向 vitest 3 files / 49 tests 全过；eslint 三改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有警告）；产物 CSS 含 `.quickforge-message-stopped-label`；`git diff --check` 通过。
- 边界：tool 卡内部 aborted 红字、共享会话页（未走装饰管线的渲染面）不在本 feature 范围；未新增依赖、未手工修改生成产物、未 commit/tag/push。
- Revision（用户中止不再显示失败痕迹）：用户反馈手动停止后仍出现「错误：请求已中止。」红块与重试按钮。根因链路：用户停止 → pi-ai 抛 "Request was aborted" → pi-agent-core `handleRunFailure` 落 `stopReason:'aborted'` 终态消息（灰「已停止」那条）并把 errorMessage 经 processEvents 写入 `state.errorMessage`（agent.js:394）→ agent-manager agent_end 据此再 `appendAssistantErrorMessageOnce` 合成 `stopReason:'error'` 红块消息 → 前端终态错误行挂「继续生成」。修复：① 服务端 agent-manager agent_end 对 `signal.aborted` 的运行跳过合成并清 `state.errorMessage`（状态面板不把用户停止报成 error；非用户中止失败——超时/HTTP 等仍照常合成）；② 前端 `decorateMessages` 新增 `trailingTurnAborted`（尾部 assistant stopReason=aborted）门控，用户中止回合最后一条 user 消息隐藏重试按钮（回滚/复制/错误终态「继续生成」不受影响；重装饰随回合状态变化恢复）。测试：abort.test.mjs +2（用户中止不合成/非中止失败仍合成）、message-actions.test.ts +1（中止隐藏重试、正常恢复）。验证：定向 vitest abort 3 + message-actions 34 + routes/agent 21 全过；eslint 0 error；node --check；tsc -b；build 通过。边界：历史会话已持久化的「错误：请求已中止。」消息为存量数据不迁移（新停止干净）。

---

## Feature：桌面侧栏默认宽度略微收窄（2026-09-08）

- 目标：让左侧项目/对话区域稍微窄一点，为中间内容保留更多空间。
- 实现：`src/components/sidebar/ChatSidebar.tsx` 将桌面侧栏默认宽度和最小宽度从 320px 调整为 304px；最大宽度 520px、拖拽调整、收缩态和移动端全屏宽度保持不变。同步 `docs/wiki/src/components/README.md` 的宽度说明。
- 验证：定向 vitest 2 files / 9 tests 全过（workspace-inspector-width-range、mobile-fullscreen-adaptation）；ChatSidebar ESLint 通过；`npm exec tsc -- --noEmit` 通过；`git diff --check` 通过。
- 边界：仅调整桌面展开态宽度，不改 Inspector 约束逻辑、交互和生成产物；未 commit/tag/push。

---

## Feature：右侧 Inspector 拖动保留对话区最小宽度（2026-09-08）

- 目标：右侧面板向左拖动时，不再无限压缩中间对话区；对话区最小宽度采用用户确认的 440px。
- 实现：`ChatSidebar` 通过桌面 `ResizeObserver` 回报实际侧栏宽度；`App` 将侧栏宽度与 440px 对话区约束传给 `WorkspaceInspector`。Inspector 最大宽度统一取 1200px、75vw、`viewport - sidebar - 440px - 1px` 的较小值（仍保留 340px 最小值），覆盖恢复、拖动、窗口/侧栏变化、640px 自动展开、`maxWidth` 与 `aria-valuemax`。
- 文档：同步 `docs/wiki/src/components/README.md` 的 Inspector 宽度说明。
- 验证：定向 vitest 2 files / 9 tests 全过；相关 ESLint 0 error；`npm exec tsc -- --noEmit` 通过；`git diff --check` 通过。
- 边界：视口过窄导致 440px 对话区与 Inspector 340px 同时不可满足时，保留 Inspector 最小宽度作为降级；移动 fullscreen/overlay 和 Inspector 内部导航拖动不变；未新增依赖、未修改生成产物、未 commit/tag/push。

---

## Feature：字号滑块松手后统一应用并保存（2026-09-08）

- 目标：拖动外观设置中的界面字号、消息字号滑块时，只更新当前设置页的数值徽章和进度；松手触发 change 后才保存并全局应用。
- 实现：`appearance-settings-tab.ts` 将原 `previewFontSize` 收敛为本地 `updateFontSize`，input 只 normalize、更新两个本地字号字段并 `requestUpdate`；删除 `scheduleFontSizePreview` 调用。change 保持既有 `saveFontSize` 链路，但先同步 `applyFontSizeSettings`，再调用 `saveFontSizeSettings` 持久化，避免网络延迟阻塞松手后的视觉反馈；成功后的重复 apply 由既有 dirty-check 跳过。`font-size-settings.ts` 删除已无调用方的 RAF 预览调度函数及状态。
- 测试：新增 `appearance-settings-tab.test.ts`，以两个滑块参数化验证 input 仅更新本地状态，不持久化、不改 root font-size/CSS 变量；change 当下即应用并开始保存，持久化结束后状态保持。删除 `font-size-settings-apply.test.ts` 中已废弃预览调度测试。
- 验证：定向 vitest 3 files / 13 tests 全过；相关 ESLint 0 error；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积提示）；`git diff --check` 通过。首次单独 `npx tsc -b --pretty false` 碰到并行 `src/App.tsx` 两个未使用变量中间态，稍后包含 tsc 的 build 已通过。
- 边界：保存失败行为、字号范围/默认值、主题设置均不变；无需更新 docs/wiki（纯组件内交互时机调整，不改架构/职责/公共入口）；未新增依赖、未手工修改生成产物、未 commit/tag/push。

---

## Revision 19：Inspector Tab 下拉列表 hover / 选中态背景修复（2026-09-08）

- 目标：修复右侧 Inspector 左上角 ChevronDown 打开的 Tab 列表中，非选中项 hover 时没有背景反馈的问题，并保证选中项状态不被 hover 弱化。
- 根因：列表项使用的 `hover:bg-muted/34` 与 `bg-muted/55` 在当前 Tailwind 产物中未生成，因此 hover 和 active 背景均可能失效。
- 实现：`WorkspaceInspector.tsx` 将非选中项改为既有 `hover:bg-[var(--quickforge-sidebar-hover-bg)]`，选中项改为 `bg-[var(--quickforge-sidebar-active-bg)]`；两者仍由 `active` 条件分支隔离。`workspace-inspector-tab-list-scroll.test.ts` 新增局部源码契约，锁定 hover/active token。
- 验证：定向 vitest 1 file / 2 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积提示）；产物确认包含 hover/active 变量；`git diff --check` 通过。
- 边界：不改列表项高度、点击激活、关闭按钮、Tab 排序或持久化；无需更新 docs/wiki（纯组件内视觉反馈修复，复用既有设计 token）；未新增依赖、未手工修改生成目录。已提交（当前提交），未 push；待真机在亮/暗主题确认 hover 与选中态层级。

---

## Feature：侧栏任务分组新建对话按钮默认隐藏（2026-09-08）

- 目标：让左侧栏「任务」分组右侧的新建对话按钮默认隐藏，仅在标题行 hover 或 focus-within 时显示。
- 实现：`ChatSidebar.tsx` 中该按钮改为复用既有 `sectionActionButtonClass`，获得默认 `opacity-0`/`pointer-events-none` 与 `group-hover`、`group-focus-within` 显示和交互恢复；原 `onClick`、`stopPropagation`、`aria-label`、图标保持不变。
- 测试：`sidebar-section-header-hit-area.test.ts` 新增契约，确认按钮复用该类，并锁定类中 hover/focus-within 的可见性和 pointer-events 行为。
- 验证：定向 vitest 2 files / 29 tests 全过；eslint 2 个改动 TS/TSX 文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积提示）。
- 边界：纯组件内样式复用，不改架构/公共入口，无需更新 docs/wiki；未新增依赖、未手工修改生成目录、未 commit/push。

---

## Revision 18：Inspector 顶栏回归 56px 对齐 + 顶部按钮组高度与 hover 统一（2026-09-08）

- 背景：用户反馈 Revision 17 引入两个回归——① `+`/全屏按钮与右上角浮动工具栏的终端/关闭右侧边栏按钮高度不一致；② Inspector 顶栏底部横线与对话区 header 底部横线不齐（44px vs 56px）。并确认「顶部 tab 最左侧 ChevronDown 下拉没有 hover 背景」。
- 方案（用户确认「统一回 56px」）：Inspector 顶栏 `h-11`→`h-14`，与 `src/App.tsx:2152` 对话区 header、`fixed right-2 top:0.625rem` 浮动工具栏同高（13px 根字号下均 45.5px，两条底线对齐）；`+`/全屏/终端/关闭四个 `Button` 去掉 `size-8` 覆盖，回到 `size="icon"`（29.25px）与浮动工具栏按钮同尺寸；左侧下拉按钮 `size-8`→`size-9`（保留 `rounded-xl`）；两处下拉菜单 `top-10`→`top-12`（按钮变高后恢复原有间距）。Tab 条保留 Revision 17 的紧凑 `h-8` + 隐藏滚动条。
- hover 排查结论：`hover:bg-[var(--quickforge-sidebar-hover-bg)]` 已存在于产物 CSS 且实际生效——用 headless Chrome + CDP 实测（`Input.dispatchMouseEvent` + `getComputedStyle`），四个按钮 hover 均得到 `rgb(229,231,235)`；用户看到的「没有 hover」应为改动前的旧产物或页面未强刷。顺带把 `App.tsx` 右上角浮动工具栏的终端/关闭右侧边栏按钮从**未生成**的 `hover:bg-muted/45` 换成同一 token（此前这两个按钮完全没有 hover 反馈），对应两处硬编码类名断言同步更新。
- 验证：headless Chrome 实测两条 header 底线均 45.5px、六个按钮均 29.25px、四个按钮 hover 背景均生效；`npm run test` 287 files / 2742 tests 全过；`npm run lint` 0 error（5 个既有 warning）；`npm run build` 通过。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`src/App.tsx`、`tests/frontend/mobile-fullscreen-adaptation.test.ts`、`tests/frontend/side-chat-workspace-tab.test.ts`、`docs/wiki/src/components/README.md`、`progress.md`、`session-handoff.md`。未 commit、未 push。
- 下一步：真机强刷（Ctrl+Shift+R）后确认——两条顶栏横线齐平、`+`/全屏与终端/关闭四个按钮等高、最左侧 ChevronDown hover 有浅灰背景（亮/暗各看一次）、两处下拉菜单定位正常。

---

## Revision 17：WorkspaceInspector 顶部 Tab 条收窄并消除滚动条高度跳动（2026-09-08）

- 背景：右侧 Inspector 顶部 Tab 在多个时出现横向原生滚动条（Windows/Electron 占位式），撑高自动高度的滚动容器，父容器 `items-center` 居中导致 Tab 视觉上移，滚动条出现/消失时来回跳。
- 方案（用户确认 A）：顶栏 `h-14`(56px)→`h-11`(44px)；Tab 按钮 `h-10`(40px)→`h-8`(32px)、`rounded-2xl`→`rounded-xl`；横向滚动容器固定 `h-8`，并在 `src/index.css` 增加 unlayered 自定义类 `.quickforge-inspector-tab-strip` 隐藏原生滚动条（滚轮/触控板滚动与拖拽排序保留）；左侧 Tab 下拉按钮 `size-9`→`size-8`、`rounded-2xl`→`rounded-xl`；`+`/全屏/终端/折叠图标按钮 className 补 `size-8`；两处下拉菜单 `top-12`→`top-10`（与顶栏底保持 2px 间距）；分隔线 `h-3.5`→`h-3`。下拉列表条目 `h-10` 与滚动区类名不动（有测试断言）。
- 根因（首版 Tailwind arbitrary 类未生效）：`[scrollbar-width:none]` / `[&::-webkit-scrollbar]:hidden` 被编译进 `@layer utilities`，而 pi-web-ui 的 unlayered `*{scrollbar-width:thin}` 与 `::-webkit-scrollbar{width:8px;height:8px}` 在层叠中优先于任何 `@layer`；Chromium 在标准 `scrollbar-width` 生效时又忽略 `::-webkit-scrollbar` 自定义，滚动条仍以 8px 占位挤压 Tab。改用 unlayered 类后正常覆盖。
- 追加修复（顶部工具栏 hover 背景失效）：`hover:bg-muted/45` 这类带透明度修饰符的颜色类在本项目 Tailwind 产物中**未生成**（本项目 theme 缺 `--color-muted`/`--color-foreground` 映射，仅 pi-web-ui 预构建 CSS 里恰好存在的 `/30 /50 /60` 等可用），导致顶部左侧 Tab 下拉与 `+`/全屏/终端图标按钮 hover 无任何背景。改用项目既有、亮暗主题都可见的 `hover:bg-[var(--quickforge-sidebar-hover-bg)]`（亮色 `#e5e7eb`、暗色 `muted/74%`，composer 按钮已在用）。这是既有系统性问题的局部修复，其他 `bg-muted/NN`、`text-foreground/NN` 类同样可能未生成，后续如遇 hover/文字层级异常可按此排查。
- 验证：`npx vitest run workspace-inspector` 6 files / 46 tests 全过；`npx eslint src/components/workspace/WorkspaceInspector.tsx` 0 error；`npm run build` 通过；产物 CSS 确认 `.quickforge-inspector-tab-strip{scrollbar-width:none}` 为 unlayered 且位于全局 `*{scrollbar-width:thin}` 之后，`.hover\:bg-\[var\(--quickforge-sidebar-hover-bg\)\]` 已生成且变量亮色为 `#e5e7eb`。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`src/index.css`、`docs/wiki/src/components/README.md`、`progress.md`、`session-handoff.md`。未 commit、未 push。
- 下一步：真机冒烟——多 Tab 溢出时 Tab 不再上下跳且整体更紧凑；顶部左下拉与 `+`/全屏/终端按钮 hover 有可见浅灰背景（亮/暗主题各看一次）；Tab 下拉与 `+` 菜单定位正确；拖拽排序与滚轮横向滚动仍可用。

---

## 提交收尾：侧栏置顶分区独占展示 + 产物卡文件图标与打开方式（2026-09-08）

- 提交：`70a587a feat: 置顶会话改为分区独占展示并收紧悬停操作`；`b39c120 feat: 完善产物卡文件图标与打开方式`；`7a0ecae fix: 侧栏运行状态指示器贴齐时间槽`。均为本地 commit，未 push。
- 完整门禁全绿：`npm run test` 287 files / 2742 tests 全过；`npm run lint` 0 errors、5 个既有 warnings；`npm run build` 成功（仅既有 KaTeX 字体与大 chunk warnings）；`git diff --check` 通过。后续 spinner 补丁定向 vitest 1 file / 9 tests、相关 ESLint 与 diff-check 通过。此前侧栏 2 个失败为过程记录，现已修复并纳入全绿结果。
- Blocker：无。下一步：真机冒烟侧栏置顶/hover 交互与产物卡图标、分裂按钮及外部打开目标。

---

## Revision 16：assistant-reply-artifact-card 打开下拉扩展 VS Code/IDEA 目标（2026-09-08）

- 背景：用户要求打开下拉也提供 IDEA、资源管理器、VSCode 选项且带 icon。
- 实现：① `assistant-artifact-card.ts` 菜单项数组扩展——预览打开（行内 eye 描边 SVG）+ explorer 定位 + vscode + idea 三个外部目标（品牌图标 import `@/assets/icons/{file-manager,vscode,idea}.svg`，与工作区 ProjectOpenMenu 同款资源），`onRevealFile?.(artifact.path ?? '', target)` 传目标；deps 类型 `onRevealFile?: (relativePath, target?: WorkspaceExternalOpenTarget) => void`。② `ChatPanelHost.tsx` 两处 prop 类型同步 + type import。③ `App.tsx` `revealFileFromArtifactCard(relativePath, target = 'explorer')` 按目标转发 `openWorkspaceExternal`，失败 toast 按目标区分（openInVSCodeFailed/openInIDEAFailed/assistantArtifactRevealFailed，均既有 key 零新增）。④ CSS：菜单项 display:block→flex（图标槽 0.875rem + gap 0.5rem），svg 变体描边规则。
- 服务端零改动（open-external 路由本就支持三目标）；readOnly 不传 onRevealFile 时菜单仅预览项（既有门控不变）。
- 测试：新增契约（三图标 import、targets 数组三项、onRevealFile 双参转发、App target 转发与失败 key 分流、CSS flex 图标槽）；两处旧单参断言同步。
- Verification: 定向 vitest assistant-artifact-card 18 + message-actions 30 全过；eslint 四改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki 菜单描述同步。
- Boundaries: 主区直接预览/审查/撤销不受影响；i18n 零新增（复用既有 openIn* key）；未新增依赖；已提交 `b39c120`，未 push。

## Revision 15：assistant-reply-artifact-card 打开/审查按钮感升级描边档（2026-09-08）

- 背景：用户觉得分裂按钮版「按钮感不够强」，经 AskUserQuestion 三档选型（软填充/描边/主色淡底）确认为**描边 outline 档**，「审查」同步升级、「撤销」保持 ghost。
- 实现：index.css——基础 ghost 规则后追加描边档覆盖：`.quickforge-assistant-artifact-card-open, .quickforge-assistant-artifact-card-review` 常显 `border: 1px solid var(--border)`（复用卡片表面边框强度，遵守 DESIGN_LANGUAGE 不自造弱化混色）+ `var(--background)` 底 + `var(--foreground)` 文字；hover 仍走既有 muted 45% 浮底规则、active scale 回缩/focus-visible 不变。分裂胶囊接缝改描边实现：主区 `border-right: 0` 让位、箭头区 `border-left: 1px solid var(--border)` 即内部分隔线；退化 single 形态恢复整圆角并保留完整四边描边（删 border-left:0）。「撤销」及 rollback hover 转红规则零改动。
- 测试：assistant-artifact-card.test.ts——split 契约更新（分隔线 var(--border)、single 整圆角且不去边框、主区 border-right:0）+ 新增 outline/ghost 分层契约（open/review 描边三要素、基础规则仍 border:0、rollback hover:not(:disabled) 保留）。
- Verification: 定向 vitest assistant-artifact-card 17 tests 全过；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 按钮档位描述同步。
- Boundaries: 仅改 CSS 与测试，DOM 结构/交互零变化；compact/响应式规则自动继承描边；未新增依赖；已提交 `b39c120`，未 push。

## Revision 14：assistant-reply-artifact-card 「打开」改分裂按钮（2026-09-08）

- 背景：用户要求「打开」参考顶部设置按钮形态做分裂按钮——主区点击直接预览、箭头点击弹菜单选择后直接打开；设计先行过稿确认（菜单保留「预览打开」、行内 compact 同样分裂、主区不加图标）。
- 实现：`createOpenMenuControl` 重构——canPreview 时渲染主区按钮（`-open-main`，点击 `onOpenFilePreview(path)` 直接预览、title「预览打开」）+ 箭头区按钮（`-open-menu-zone`，aria-haspopup/expanded + aria-label「更多打开方式」，点击弹菜单，菜单项预览打开/在文件管理器中显示选择即执行）；无预览能力时主区不渲染、wrapper 标记 `-open-single`，箭头区补「打开」文字整颗弹菜单（=原形态）；菜单 fixed 定位/点外/Escape/滚动即关/模块级互斥机制原样保留（trigger 换为箭头区按钮）。CSS：主区左圆角、箭头区右圆角 + 细分隔线（border-left，--border 52%），compact 箭头区内距收窄，single 退化恢复整圆角/常规内距；各点击区独立 hover（复用基础 ghost 规则）。i18n 新增 `assistantArtifactOpenMenu`（zh 更多打开方式 / en More ways to open）。
- 测试：assistant-artifact-card.test.ts 新增分裂按钮契约（主区直连预览、箭头区 aria、退化形态保留文字、CSS 分隔线/圆角/退化恢复）。
- Verification: 定向 vitest assistant-artifact-card 16 + message-actions 30 + i18n-language-snapshot 2 全过；eslint 三改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 打开控件描述同步。
- Boundaries: 审查/撤销按钮不动；菜单内容与执行行为不变（仅入口变化）；无 path 或无任何回调仍不渲染；未新增依赖；已提交 `b39c120`，未 push。

## Revision 13：assistant-reply-artifact-card 产物图标对齐文件管理 Material 图标（2026-09-08）

- 背景：用户希望产物卡片的文件图标使用「文件管理」的图标。原实现是按 kind（code/markdown/pdf…）的单色内联 SVG + primary 着色 chip 底；文件管理（文件树/变更列表）用的是 Material Icon Theme 彩色图标，按路径解析（扩展名 + 特例名如 package.json/tsconfig/README）。
- 实现：① 新增 `src/components/workspace/file-icon-assets.ts`——自 file-icon.tsx 拆出 fileIconUrls/directoryIconUrls 静态资源映射并导出 `fileIconUrl(path)`（纯 TS，非渲染层可复用；拆分原因：react-refresh/only-export-components 禁止 tsx 组件文件混出非组件导出）；file-icon.tsx 瘦身为纯组件，改从 assets 模块导入，行为不变。② `assistant-artifact-card.ts` 删除 ARTIFACT_KIND_ICONS/FILE_DOCUMENT_ICON/artifactIcon/createIconSpan，新增 `createFileIcon(className, path, kind)`——img 元素 + `fileIconUrl(path)`，两处调用点（单文件卡 line297、折叠卡行 line421）传 `artifact.path`；kind 仍用于 title 与「类别 · KIND」副标题。③ CSS：两类图标类从 chip（border/primary 底/居中 18px svg 描边）改为裸 img——单文件卡 1.25rem、行内 1rem（与文件树行 size-4 同档），删除 svg 描边规则与行内 chip 尺寸规则。
- 效果：同一文件在文件树、变更列表、产物卡片三处图标完全一致（同一资源同一解析）。
- 测试：assistant-artifact-card.test.ts 新增契约（fileIconUrl 导入 + createFileIcon 两调用点 + 旧体系移除 + CSS 裸图标尺寸/无 svg 规则）。
- Verification: 定向 vitest assistant-artifact-card 15 + message-actions 30 全过；eslint 四改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 两处措辞同步。
- Boundaries: 文件树/变更列表渲染路径零改动（仅 file-icon.tsx 内部拆分）；i18n 类别副标题、± 统计、按钮布局不动；无扩展名文件回落 document 图标（getFileIconName 既有默认）；未新增依赖；已提交 `b39c120`，未 push。

## Revision 12：assistant-reply-artifact-card 审查关闭 ambiguous unicode 提示（2026-09-08）

- 背景：用户反馈审查页面每次都弹 “This document contains many ambiguous unicode characters / Disable Ambiguous Highlight”——Monaco unicodeHighlight 对中文/全角内容默认开启 ambiguous 字符检测，文档命中多字符即弹通知。
- 实现：`MonacoDiffViewer.tsx` options 增加 `unicodeHighlight: { ambiguousCharacters: false }`（IDiffEditorOptions extends IEditorOptions，作用于左右两栏）；invisibleCharacters/nonBasicASCII 保持默认。
- 测试：monaco-local.test.ts 新增 unicodeHighlight 契约。
- Verification: 定向 vitest monaco-local 8 tests 全过；eslint 两改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过。
- Boundaries: 只动审查 diff；MonacoCodeViewer（文件查看）未动——若文件预览同样弹此提示可按需同款处理；未新增依赖；已提交 `b39c120`，未 push。

## Revision 11：assistant-reply-artifact-card 审查 diff 单列行号（2026-09-08）

- 背景：用户反馈审查视图「序号有 2 列，只需要 1 列」——MonacoDiffViewer `renderSideBySide: true` 左右两栏各带一列行号（左原文件/右新文件）。
- 实现：`MonacoDiffViewer.tsx` 挂 `onMount`（DiffOnMount），`editor.getOriginalEditor().updateOptions({ lineNumbers: 'off' })` 隐藏左栏行号，仅保留右栏（新文件）一列行号；左右两栏布局、diff 高亮、gutter 变更指示不变；options prop 后续更新只设传入键，不会重新打开行号；`key={status:path}` 换文件重挂载时 onMount 重新生效。
- 测试：monaco-local.test.ts 新增契约（type DiffOnMount import、getOriginalEditor 关行号、onMount={handleDiffMount} 接线）。
- Verification: 定向 vitest monaco-local 7 tests 全过；eslint 两改动文件 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 干净。
- Boundaries: 只动审查 diff（MonacoDiffViewer 唯一消费方是 WorkspaceInspector InlineReader）；MonacoCodeViewer（文件查看）行号不受影响；未新增依赖、未触碰生成产物、未 commit。

## Revision 10：assistant-reply-artifact-card 审查视图纯 diff——收起右侧文件列表（2026-09-08）

- 背景：用户反馈产物卡片更改区域点「审查」打开后「只用展示 diff 就好了，不要右边的旁边还有东西」——WorkspaceInspector 打开 diff tab 时 `readerNavigationVisible` 默认 true，diff 右侧还挂着「更改文件列表」导航面板。
- 实现：WorkspaceInspector 请求处理 effect 中，带 `path` 的 review 请求（仅产物卡「审查」使用，App.tsx:933）直达 diff tab 时同步 `setReaderNavigationVisible(false)`，审查视图只展示 diff 本身；reader 头部文件夹按钮可随时切回列表；无 `path` 的 review 请求（App.tsx:755）与其他面板不受影响。该状态沿既有 per project+session 持久化链路（writePersistedPanelTabs）。
- 测试：新增 workspace-inspector-on-demand-source.test.ts 契约（if (request.path) 块内 openDiffTab + setReaderNavigationVisible(false) 顺序）；同步 assistant-artifact-card.test.ts 既有断言（旧单行 `if (request.path) openDiffTab...` 锚点改块级正则）。
- Verification: 定向 vitest 4 files / 47 tests 全过（on-demand-source 4 + tabs 9 + request 20 + artifact-card 14）；eslint 三改动文件 0 error；`npx tsc -b --pretty false` 通过。
- Boundaries: 仅收起导航不隐藏 reader 头部/面板 tab 栏（文件名、± 统计、复制/打开菜单保留）；收起态会持久化到该 project+session（用户可用文件夹按钮恢复，与手动收起同语义）；无 path 的 review 请求、文件树、terminal 等面板不受影响；未新增依赖、未触碰生成产物、未 commit。

## Revision 4：sidebar-pin-hover-alignment——hover 浮层紧凑贴尾（2026-09-08）

- 需求：用户反馈 hover 置顶/归档按钮"太靠前、分太开"，应更靠尾部、更紧密。
- 根因：Rev1 为对齐静置 pin 把 Archive 胶囊扩到 44px；Rev3 删静置 pin 后该约束失效，44px 胶囊成为纯粹的松散来源（图标间距 24px、Archive 图标中心距右缘 30px、浮层渐变多占 20px）。
- 修复：`overlayArchiveButtonClass` `h-6 w-11`→`size-6`（与 Pin 同 24px 圆形槽），gap-1 不变——图标间距 14px、Archive 图标中心距右缘 20px、右锚仍 right-2(8px)。测试注释/描述/断言同步（`size-6` + not w-11/w-9）。
- Verification: 定向 vitest 2 files / 31 tests、eslint 0 error、`npx tsc -b`、`npm run build` 全过（dist 已重建）。
- Boundaries: 一处类常量改动，4 处浮层共用生效；已提交 `70a587a`，未 push。

## Revision 3：sidebar-pin-hover-alignment——置顶分区独占展示（2026-09-08）

- 需求（用户决策）：置顶会话只在置顶分区展示，项目/时间线/全部会话列表全部隐藏；hover 浮层保留归档按钮；置顶区取消置顶用 PinOff 图标。
- 实现（general subagent 执行、主 Agent 审查）：① 服务端 `pinned=exclude` 三态——storage.mjs 白名单 + legacy readIndexedValues 镜像过滤、session-index-repository buildQuery `pinned_at IS NULL`（与 archived 对称；选服务端过滤因分页 total/LIMIT 口径天然一致，前端 filter 会破坏 hasMore 判定）；② 前端 global/project/timeline 三个加载带 `pinned:'exclude'`，`upsertSessionMetadata` 置顶会话只进 pinnedPage 直接 return（toggle 后 refreshSessions 收敛）；③ ChatSidebar 删全部静置 pin 按钮 + size-6 占位 span（时间槽成最右元素），置顶区浮层 Pin→PinOff，三列表浮层 aria-label 恒 pinSession，`pinnedSessionButtonClass` 常量删除；④ 搜索结果不动（主动查找场景保留置顶会话）。
- 测试：对齐测试重写（占位 0、Pin×3+PinOff×1、静置无 pin 契约、resting order 改静置仅 [time]）；bootstrap 补 only/exclude 各 1 次断言 + project 恢复加载 exclude；repository/路由新增 pinnedExclude SQL 与 legacy 回退用例。
- Verification: 定向 5 files / 58 tests、eslint 7 文件 0 error、tsc -b、node --check、`npm run build`（dist 已重建）全过。全量 `npm run test` 287 files：286 过 / 2740 tests 过，仅剩 `sidebar-new-chat-routing.test.ts` 2 用例失败——见 Notes。
- Notes：全量失败 2 用例（断言 `onClick={() => onStartNewProjectChat(item)}` 等源码字符串）由并行会话 sidebar-section-header-hit-area/project-row-hit-area 的 onClick stopPropagation 重构导致契约过时，非本 feature 改动；首次全量另有 1 文件 2 用例失败、复跑已自愈，属并行会话中间态。归属该会话修复，本 feature 不扩大范围。
- Boundaries: legacy 与 SQL 对非法 pinnedAt 语义差异为既有现状；wiki 无该查询参数条目；未新增依赖；已提交 `70a587a`，未 push。

## Bugfix：sidebar-pin-hover-alignment Revision 2——状态并入时间槽（2026-09-08）

- 需求：用户确认运行/未读状态时可以不显示时间，但 pin 位置也要与 hover 一致。
- 根因（Revision 1 遗留的次要偏差）：状态指示器（running spinner 12px/未读点 6px）插在 pin 与时间之间单独占位（running 时静置 pin 左移 16px、未读左移 10px）；且项目/全局行 running/未读时时间槽整体省略（pin 无对齐目标，偏差最大 ~30px）。
- 修复：`sessionStatusIndicator` 改造为 `sessionTimeSlotContent(session, timeText)`——running → spinner、未读 → emerald 点、否则时间文本，三选一渲染在固定 `w-11 text-right` 时间槽内；删除『状态时省略时间槽』条件分支，槽恒定渲染；置顶区/项目行/全局行 3 处调用统一（置顶区原为状态+时间同时显示，现状态优先替代时间）。槽为 text-right 行内上下文（非 flex），dot 补 `inline-block` 生效宽高。效果：pin 右侧几何恒 `[gap-1][w-11 槽]`，任何状态下静置 pin 中心恒 68px 与 hover pin 完全重合；状态随槽一起 group-hover 淡出（原状态指示器 hover 不淡出被渐变半掩）。
- 测试：新增契约用例——`sessionStatusIndicator` 旧模式移除、`? null : (` 时间省略模式移除、`sessionTimeSlotContent(session, formatSessionTime` 恰 3 处、槽函数含 Loader2/animate-spin/bg-emerald-500/inline-block。
- Verification: 定向 vitest 2 files / 30 tests 全过（alignment 8 含新用例 + section-order 22）；eslint 两改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（dist 已重建，仅既有警告）。
- Boundaries: 时间线行本无状态指示器未补（行为不变）；wiki 无需更新（纯组件内渲染调整）；未新增依赖、未触碰生成产物（build 为验证目的重建 dist 属正常流程）、未 commit。

## Bugfix：sidebar-pin-hover-alignment（2026-09-08）

- 现象：项目会话行的置顶 icon 在 hover 时向右跳 8px（两态交叉淡入淡出期间肉眼可见横移）。
- 根因（几何推算，距行右缘）：静置态 pin 中心 68px（行内流 [pin 24][gap 4][时间槽 44] + 右 padding 8）；hover 态 pin 中心 60px（浮层 absolute right-2 [Pin 24][gap 4][Archive 36]）；偏差 8px = 时间槽 w-11(44) 与 Archive 胶囊 w-9(36) 宽度差。`sidebar-session-action-alignment.test.ts` 头注释声称『两 pin 中心重合、Archive 精确覆盖时间槽』，但 w-9≠w-11 该不变量不成立（测试仅断言类名字符串存在）。
- 修复：`overlayArchiveButtonClass`（ChatSidebar.tsx）`w-9`→`w-11`，置顶区/时间线/项目行/全局行 4 处共用一处生效；Archive 胶囊精确覆盖时间槽、两 pin 中心重合（68px）。测试同步：注释 w-9→w-11、it 描述、断言 `toContain('w-11')` + 新增 `not.toContain('w-9')` 防回归。不改时间槽（sidebar-session-time-nowrap 刚为中文『23小时』扩到 44px）。
- Verification: 定向 vitest 2 files / 29 tests（alignment 7 + section-order 22）全过；eslint 两改动文件 0 error；`npx tsc -b --pretty false` 通过。
- Boundaries: running spinner/未读点插在 pin 与时间之间导致的次要偏差（16/10px）未处理（hover 移出布局会引入新跳动）；running/未读时时间槽省略的最大 ~30px 偏差属既有设计；wiki 无需更新；未新增依赖、未触碰生成产物、未 commit。

## Bugfix：sidebar-project-row-hit-area（2026-09-08）

- 现象：侧栏「项目」分组下项目行整行点击无响应，可点区只有最左 icon 按钮（24×24）和标题按钮（高约 20px）；上下留白、左右 padding、中间 gap 全是死区；右侧操作 overlay hover 时全高拦截右缘点击。
- 根因：项目行 div（挂 useSortable `{...listeners}{...attributes}`，L1559 一带）本身没有 onClick，展开/收起只绑在内层两个小按钮上；对照会话行是整行挂 onClick。
- 修复：① 行 div 新增 onClick 统一 `toggleProjectExpanded(item.id)`，内层 icon/标题按钮移除各自 onClick（点击与键盘 Enter 的 click 冒泡到行级统一处理，按钮/aria-label/title 保留，a11y 不回退）；② 新增 `suppressProjectRowClickRef = useRef(false)` 三段式防拖拽误触——`handleDragStart` 与 `finishProjectDrag`（dragEnd/dragCancel 共用出口）置 true，行 onClick 命中则复位 ref 并 return，吞掉拖拽结束后浏览器同手势补发的 click；行 div 另挂 `onPointerDown` 先复位 ref 再转发 `listeners?.onPointerDown?.(event)`（JSX 后写属性覆盖 spread 的 dnd listener，必须手动转发保拖拽），新手势开始即清位，Escape 取消拖拽后不吞下一次真实点击；③ 右侧 overlay 两个 Button（Ellipsis 菜单、MessageSquarePlus 新建）onClick 显式 `event.stopPropagation()` 防误触行级切换（openProjectMenu 内部原有 stopPropagation 保留不动）。
- 测试：新增 `tests/frontend/project-row-hit-area.test.ts` 5 用例（源码字符串契约，touchAction 唯一锚点切出行块）——行级 onClick + 抑制守卫 + toggle + onPointerDown 清位转发 listeners、内层两按钮无 onClick、overlay 两按钮 stopPropagation、finishProjectDrag 置抑制 ref、handleDragStart 置抑制 ref。
- Verification: 定向 vitest 4 files / 44 tests 全过（新 5 + project-drag-boundary 10 + sidebar-section-order 22 + sidebar-session-action-alignment 7，既有断言无冲突）；eslint 两改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（dist 已重建，仅既有警告）。
- Boundaries: 只修项目行，未动分区头/会话行/其他区域与样式类名；残余边界——拖拽结束 click 落在行外祖先时标记驻留至下次手势 pointerdown 清除（物理点击无感）；键盘 Enter 在拖拽取消后无 pointerdown 直接触发的极端组合仍可能被吞一次；wiki 无需更新（纯组件内交互修复）；未新增依赖、未触碰生成产物、未 commit。

### Revision：三个分区头整行可点（2026-09-08）

- 现象：用户复查反馈置顶/项目/任务三个分区头（sectionHeaderClass 行）同款死区——标题按钮外整行（左右 padding、右侧按钮间空隙）点击无反应。
- 修复（与项目行同款模式）：新增 `suppressSectionHeaderClickRef = useRef(false)`（与项目行 ref 相邻）；三个 header div 各挂 `onPointerDown` 清位（listeners 挂在内层标题按钮上、冒泡到 header div 才触发，无 spread 覆盖问题、无需转发）与带守卫的 `onClick`（置顶调 `onTogglePinnedCollapsed()`、项目调 `toggleProjectsCollapsed()`、任务调 `toggleConversationsCollapsed()`）；三个内层标题按钮移除各自 onClick（activator ref/listeners/attributes/aria-expanded 保留，键盘 Enter 的 click 冒泡到 header 生效，a11y 不回退）；`handleSectionDragStart` 与 `finishSectionDrag`（dragEnd/dragCancel 共用出口）置抑制 ref；右侧 4 个 action Button（项目头 openViewSortMenu/toggleAllProjectsExpanded/onSelectProjectDirectory + 任务头 onStartNewGlobalChat）onClick 包 `event.stopPropagation()` 原调用保留。
- 测试：新增 `tests/frontend/sidebar-section-header-hit-area.test.ts` 6 用例（源码字符串契约，`className={sectionHeaderClass}` 三处按 indexOf 顺序切片锚定置顶/项目/任务头）——header div 三件套（清位/守卫/toggle）、标题按钮无 onClick 且 activator 属性保留、4 个 action Button stopPropagation + 原调用、finishSectionDrag/handleSectionDragStart 置位、ref 声明。另同步 `sidebar-section-order.test.ts` 一处用例锚点（旧锚绑定标题按钮自带 onClick 与单行 div 写法；断言语义不变）。
- Verification: 定向 vitest 5 files / 50 tests 全过（section-header-hit-area 6 新 + project-row-hit-area 5 + project-drag-boundary 10 + sidebar-section-order 22 + sidebar-session-action-alignment 7）；eslint 三个改动文件 0 error；`npx tsc -b --pretty false` 通过。
- Boundaries: 未动项目行（上轮已修）、会话行、其他区域与样式类名；残余边界与项目行一致（拖拽结束 click 落头外祖先时标记驻留至下次手势、键盘 Enter 极端组合）；wiki 无需更新；未新增依赖、未触碰生成产物、未 commit。

## Revision 9：assistant-reply-artifact-card 改为会话累计口径（2026-09-08）

- 背景：用户反馈「产物和修改应该是当前 session 的总和，而不是单次的」——上一版「最近产物轮」只展示最后一个有产物轮的文件，此前轮次的产物/修改不显示。
- 实现：提取改 `extractSessionArtifacts(messages)`（全会话跨轮求和，含此前各轮 write/edit/present），卡片挂最后一条 assistant（对话尾部）；新轮无产物时签名一致原地不动，有产物时增量更新；卡片随对话尾部迁移到新宿主时展开态回退读旧卡自身 `data-quickforge-artifact-expanded`（不因迁移回折）。与「撤销」语义对齐——rollbackFiles 本就是会话级回滚，卡片口径与其一致。`extractArtifactsFromMessages` 收回内部（卡片改用 extractSessionArtifacts 后无外部使用方）。
- Verification: 定向 44；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。

## Revision 8：assistant-reply-artifact-card 合并文件 ± 语义——churn 改净变化（2026-09-08）

- 现象：用户对照 diff（纯新增）质疑卡片出现 -N。排查确认方向无反（createTextDiff insert→addedLines、调用点 old 在前、行渲染 +→绿 -→红均正确）；根因是 Revision 7 的合并取累计 churn——「先建 (+N) 后小改 (+a −r)」显示 +N+a −r，纯新增文件凭空多出 -r。
- 修复：mergeChangedArtifactsByPath 多次写入分支改净变化：net = Σ加 − Σ减，addedLines=max(net,0)、removedLines=max(-net,0)（任一侧有统计才赋值），与 git diff/新增文件观感一致；单次调用不进合并分支，保留真实 hunk ±（与 diff 视图逐段一致）。折叠头 diffTotal 随行之自动一致。
- Verification: 定向 14；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。

## Revision 7：assistant-reply-artifact-card 修改文件重复显示修复（2026-09-08）

- 现象：用户反馈修改文件列表出现重复行。根因：`artifactKey` 去重键含 toolCallId——同一文件一轮内多次 write/edit（或多次 present_files、父/子会话都写）每次工具调用各产出一条产物，卡片逐条渲染即重复。
- 修复：去重放在卡片层（共享提取器保持「每次工具调用一条」的产物面板语义）——`buildCardPlans` 前置 `mergeChangedArtifactsByPath`（changed 按归一路径合并为一行：行序取首现、kind/preview 取最新、± 为各次累计 churn）与 `dedupePresentedArtifacts`（present 同文件去重，字段取最新、保首现顺序）；路径键统一反斜杠归一（不做大小写折叠，避免大小写敏感文件系统误合并）。折叠头总数 diffTotal 随合并后数据自动一致。
- Verification: 定向 44；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。

## Revision 6 修正：assistant-reply-artifact-card 提取源回归——刷新不出卡（2026-09-08）

- 现象：用户刷新页面后卡片消失。根因是 Revision 6 把产物提取从完整 `messages` 挪到了 `displayEntries`——后者是只含 user/assistant 的过滤视图，**不含 `toolResult` 消息**，而 `extractArtifactsFromMessages` 恰恰从 `toolResult.details` 取 path/diff，导致提取永远为空、卡片在任何状态下都不再渲染（刷新加载新构建后暴露）。
- 修复：`findLastArtifactTurn` 改回在完整 `messages` 上扫描（user/user-with-attachments 为轮边界），返回该轮最后一条 assistant 的**消息对象**；sync 经对象引用（displayEntries 与 messages 同源同引用）`entry.message === turn.lastAssistantMessage` 定位 display 下标取元素。deps 恢复 `messages` 字段（message-actions 调用点同步恢复）。服务端 restore 链路核实无问题：persistSession 持久化完整 `state.messages`（含 toolResult+details），客户端 IndexedDB 快照同源，刷新后数据支持出卡。
- 测试加固：契约断言提取必须跑在 `messages.slice(turnStart, end)`（完整消息）而非 displayEntries，并断言 deps 携带 `messages: getMessages()`——防止同类回归再从字符串层面溜过。
- Verification: 定向 44；全量前端 132 files / 1379 tests 全过；eslint 改动文件 0 error；`npx tsc -b`、`npm run build` 通过。

## Revision 6：assistant-reply-artifact-card 卡片生命周期——流式保留旧产物（2026-09-08）

- 背景：用户反馈「发送一个新消息卡片就消失了」——旧实现 streaming 一到就 removeArtifactCards，新一轮哪怕只是问答、没有任何文件改动，上一轮产物卡也被清掉。
- 实现：① sync 流式分支改为纯 `return`（不清卡），上一轮卡片原地保留；② 产物提取从「当前轮（最后一条 user 之后）」改为 `findLastArtifactTurn`——在 displayEntries 上从最新轮向旧按 user 边界扫描，取最近一个产出 write/edit/present 文件产物的轮，卡片挂到该轮最后一条 assistant（displayEntries 与 messageElements 对齐且 message 为同引用，直接切片跑 `extractArtifactsFromMessages`，tool-artifacts 导出该函数）；③ 换卡时机自然成立：新轮流式结束后的 idle sync 中，若新轮有产物 → 目标轮切换 → 签名不同 → removeArtifactCards + 挂新卡；若无产物 → 目标轮仍是旧轮 → 签名一致跳过，旧卡保留；④ 整段会话扫描不到任何产物轮才清卡；⑤ deps 删除不再需要的 `messages` 字段（message-actions 调用点同步），撤销重新武装仍由 App onArtifactsChange（产物变化）驱动，语义不变。
- 边界：恢复旧会话/分支时，最后一个产物轮即使是历史轮也会重新出卡（与「卡片代表最近产物轮」一致）；流式中若 Lit 重建旧宿主元素导致卡片短暂丢失，流式结束的 idle sync 会重挂。
- Verification: 定向 44；全量前端 132 files / 1371 tests 全过；eslint 改动文件 0 error；`npx tsc -b`（含并行会话 http-storage-backend 中间态自愈后）、`npm run build` 通过。

## Feature：provider-keys-send-cache（2026-09-08）

- 现象：发送消息到乐观上屏之间存在可感知延迟，服务端忙时更明显。
- 根因：发送路径 `providerKeys.get(provider)` 无缓存——pi 库 AgentInterface.sendMessage 在乐观上屏前 await 该调用，QuickForge 的 HttpStorageBackend 每次都发无缓存 HTTP GET /api/storage/provider-keys/key/:provider（cache:'no-store'），往返被服务端排队拉长。
- 实现：① 新增 `src/lib/provider-keys-cache.ts`——模块级 Map（provider→key，null=已确认无 key）+ in-flight 去重 + load 失败不缓存；跨标签 BroadcastChannel('quickforge-sync') 'provider-keys-changed' 广播互失效（sourceTabId 自忽略，与 useCrossTabSync 共用频道且未知类型互相安全忽略）；通道惰性建立 + unref 兜底 + clear 时关闭重置（实测 Node 未关闭通道会挂住事件循环，import 期建立会挂死 vitest worker），不可用静默降级。② `http-storage-backend.ts` 挂接：get 读穿（命中零 HTTP）、has 命中短路不回填、set/delete/clear 写通 + 广播，全部位于 fakeProviderKeys/storeOverrides 短路与 assertStoreAccess 之后；transaction legacy 路径自动继承；keys 不缓存。③ `backup-settings-tab.ts` 导入成功后统一失效 + 广播（备份导入绕过 backend 直写服务端）。
- 测试：新增 `tests/frontend/provider-keys-cache.test.ts` 10 用例；`tests/frontend/http-storage-backend.test.ts` 新增 8 用例（缓存命中/写穿/清除/has 语义/fake 与 override 不污染/legacy 继承/非 provider-keys 不缓存）。
- Verification: 定向 vitest 3 files / 33 tests 全过；eslint 5 改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（仅既有警告）；提交前全量前端 132 files / 1379 tests 复跑通过。
- Boundaries: 模块级缓存（AppStorage 会被多处重建，实例字段会丢）；跨标签一致性尽力而为（写通保证本标签永不过期，他标签滞后到刷新/写操作）；未新增依赖、未触碰生成产物、已提交（artifact-card Rev2-6 同批先行单独提交）。

## Revision 5：assistant-reply-artifact-card 字体统一 + 浮层遮挡修复（2026-09-08）

- 背景：用户复查要求检查字体大小与弹窗遮挡。核查发现三个真实问题：① Revision 4 的明细动画层 `.quickforge-assistant-artifact-card-details-body { overflow:hidden }` 会把行内「打开▾」菜单裁掉（展开后靠后的行菜单不可见）；② 消息列表 `overflow-y-auto` 裁剪 absolute 浮层——产物卡恰在本轮最后一条消息底部（输入框正上方），「撤销」确认弹层/打开菜单向下弹最易被裁；③ 字体不一致——行内 ± 统计与「打开/审查/撤销」按钮继承消息正文字号（~14px），大于折叠头统计（12px）与卡片标题（13px）。
- 实现：① 新增 `panel-decoration/floating-position.ts` `positionFixedDropdown(trigger, dropdown, margin)`——fixed 视口定位（右对齐触发器、整体 clamp 进视口、下方空间不足向上翻转），fixed 不受祖先 overflow:hidden/滚动容器裁剪；② 打开菜单与撤销确认弹层（共享 rollback-confirm-popover，消息级回滚同样受益）改经此定位，均增补 scroll(capture)/resize 即关；弹层向上翻转加 `-up` 变体（箭头移底边），CSS 去 absolute top/right 改 fixed；③ 字体统一到卡片 12px 档——`-file-stats` 显式 `font-size: 0.75rem`，按钮基础 `font: inherit` 改 `font-family: inherit; font-size: 0.75rem; line-height: 1.25`（行内 compact 11px 不变）；④ 健壮性——`removeArtifactCards` 内统一 `closeActiveOpenMenu()`（流式/清空分支移除卡片时同步清 document 级监听）。
- Verification: 定向 43；全量前端 131 files / 1360 tests 全过；eslint 改动文件 0 error；`npx tsc -b`、`npm run build` 通过。

## Revision 4：assistant-reply-artifact-card 样式定稿——diff 红绿 + 对话宽度（2026-09-08）

- 背景：功能确认后用户要求样式对齐：± 有红绿区分、宽度与对话一致；先画 `design-mockups/assistant-reply-file-card-v2.html`（浅/深色、折叠/展开、打开▾下拉、比例条/ghost/参考线三个开关）对齐后按 6 项定稿执行。
- 实现：① ± 红绿——`-added/-removed` 色值与应用 `.quickforge-diff-stats-add/del` 同源（light green-700/red-700、dark green-300/red-300），折叠头统计组与行内统计统一；② 宽度——容器 `min(100%,620px)` → `width:100%` 填满消息容器（与正文/输入框同边），删 640px 断点的 `margin-inline:0.5rem`；③ 折叠头重排——标题 `flex:0 1 auto`，新增 `-header-stats`（margin-left:auto + mono tabular-nums）装比例条与 ±，流式 +N 增长不推标题；④ 比例条——`createDiffBar`（段宽按 +N/−N flex 占比，纯新增仅绿段），折叠头与行内都有；⑤ 按钮 Ghost 化——打开/审查/撤销去边框改透明底，hover 浮中性浅底，撤销 hover 转红（同组红绿 token）；⑥ 展开动画——details 三层结构（grid 动画层 / overflow 钳高层 / padding 列表层），`grid-template-rows 0fr→1fr` 过渡，`visibility` 延迟 dur-base 切换防折叠区 Tab 聚焦，reduced-motion 关闭。
- Verification: 定向 vitest assistant-artifact-card + message-actions（41）；全量前端 131 files / 1358 tests 全过；eslint 改动文件 0 error；`npx tsc -b`、`npm run build` 通过。

## Revision 3：assistant-reply-artifact-card 完全对齐截图两类卡（2026-09-08）

- 背景：用户给出第二张目标截图（两张 present 单文件卡 + 折叠的「13 个文件已更改 +353 -134」条），要求一次做完剩余全部差异并保持交互一致。
- 实现：① 卡片拆分——present_files 每文件独立单文件卡（类型 SVG 图标 + 文件名 + i18n「类别 · KIND」副标题 + 「打开▾」），write_file/edit_file 聚合为默认折叠「N 个文件已更改 +X -Y」卡，header role=button 点击/Enter/Space 切换 chevron 展开，展开态持久在宿主消息元素 dataset；行内 = 类型图标 + 文件名/路径同行 + +N/-N + 「审查」+「打开▾」。② 「打开」升级「打开▾」下拉：预览打开（onOpenFilePreview）+ 在文件管理器中显示（onRevealFile → `openWorkspaceExternal(…,'explorer')` 复用既有 open-external，服务端零改动），菜单模块级互斥。③ 「审查」落地 diff：`WorkspaceInspectorOpenRequest` review 分支加可选 `path`，App `onReviewFileChanges(path)` → requestWorkspaceInspector review/changes+path → WorkspaceInspector `openDiffTab` 单文件 Monaco diff（git 工作区口径，与 ± 统计会话影子备份口径不同，注释标注）。④ 装饰幂等重写为签名跳过重建：卡片 `dataset.quickforgeArtifactSignature` 与计划一致仅校正位置不重建——确认弹层/下拉菜单/展开态在任意 DOM mutation 触发的重装饰中存活（同时修复 Revision 2 撤销弹层会被装饰周期立刻清掉的隐患）。⑤ i18n 删旧 key（标题/说明/范围/切换等）+ 增类别/菜单 key，CSS 重写两类卡共享容器/折叠 header/菜单/响应式。
- Verification: 全量前端 vitest 130 files / 1350 tests 全过；eslint 改动 11 文件 0 error；`npx tsc -b`、`npm run build` 通过。
- Notes（与 feature 无关）：顺带修复既有失败测试 sidebar-session-action-alignment——源码 518c176 有意 `w-9`→`w-11`（中文断行修复），测试断言未同步，更新为 w-11（一行断言 + 用例名/注释）。

## Bugfix：settings-select-reactive-shadowing（2026-09-08）

- 现象：设置「默认模型/思考等级/语言/默认运行时/终端 Shell」选择后触发按钮不立即回显新选中项，再点一次才显示；数据保存链路正常（重开设置显示正确值）。
- 根因：`src/lib/quickforge-settings-select.ts` static properties（Lit 在 prototype 生成响应式 accessor）与真实类字段初始化（value=''、options=[] 等 8 个）混用；tsconfig target es2023 且 useDefineForClassFields 默认 true，原生字段在实例上创建 own property 永久遮蔽 prototype accessor，父组件 `.value=...` 属性绑定赋值不触发 requestUpdate（值本身写入实例所以保存/重开正确，但 UI 不重渲染）；再点一次显示是 `_openMenu`/`_close` 手动 requestUpdate 的副作用。
- 修复：8 个 reactive 属性改 `declare` 声明（对齐 info-tip.ts/local-tools.ts 项目范式）+ 默认值移 constructor 经 accessor 赋值（Lit 官方模式；options 被 render 直接 .find/.map 必须保留 [] 默认值），行为完全不变。
- 测试：新增 `tests/frontend/quickforge-settings-select.test.ts` 6 用例——ES2023+useDefineForClassFields transpile AST 契约防字段声明复发；Node stub 最小 DOM（HTMLElement/customElements/document/window + 手动 finalize 模拟 customElements.define 的 accessor 安装 + enableUpdating 模拟 connectedCallback 放行首轮更新 + 遮蔽 performUpdate 阻断真实渲染）直接实例化组件，验证属性赋值触发 requestUpdate（isUpdatePending/performUpdate spy）、默认值经 accessor 无 own property、_select change 派发、_open/_close 周期 label 不回退；bug 复发形态实测 4/6 失败，回归有效。
- Verification: 定向 vitest quickforge-settings-select 6 + default-options-settings-tab 2 + local-tools-lit-reactivity 2 全过（3 files/10 tests）；eslint 两改动文件 0 error；npx tsc -b 通过。
- Boundaries: 纯 bug 修复；wiki 无该组件条目未动；default-options-settings-tab 5 处使用点均显式绑定属性，其余 grep 命中为原生 select 的 CSS 类复用；未新增依赖、未触碰生成产物、未 commit。

## Bugfix：sidebar-session-time-nowrap（2026-09-08）

- 现象：中文界面侧栏会话时间「15小时」在 36px 固定列内断成两行（「15小/时」），行高被撑开；「2天」不受影响。
- 修复：`src/components/sidebar/ChatSidebar.tsx` `timeClass` 一行——`w-9`→`w-11`（36→44px，容纳最长 zh 输出「23小时」≈36-40px）+ 补 `whitespace-nowrap` 禁止 CJK 断行。4 处引用（置顶 1131 / 项目 1476、1680 / 时间线 1839）共用该变量，一处生效；固定宽度保证整列右对齐（非 min-w 自适应）。`formatSessionTime` 无绝对日期兜底、i18n 仅 zh/en，44px 覆盖所有输出。
- Verification: eslint ChatSidebar.tsx 0 error；npm run build 通过（仅既有 chunk 警告）；纯 className 字符串改动，无对应单测，未跑全量。
- Boundaries: 未动 i18n 文案、未动 en 布局（w-11 对「15h」等短文案仅加空白）；已提交 dev，未 push。

## Revision：assistant-reply-artifact-card 补撤销与行内打开（2026-09-08）

- 背景：评审发现卡片与目标形态差异——缺「撤销」入口（服务端 rollback-files 已就绪但前端无 UI）、缺每文件「打开」（头部按钮只开第一个可预览文件）。「审查」diff 视图暂用行内预览顶替。
- 实现：① 头部「撤销」按钮（`quickforge-assistant-artifact-card-rollback`，包 `.quickforge-rollback-action` 供弹层锚定）——点击弹共享确认层（原 message-actions 私有实现抽为 `panel-decoration/rollback-confirm-popover.ts`，onConfirm 泛化无参），确认后调 App `rollbackFilesFromArtifactCard` → `ServerAgent.rollbackFiles()`（POST rollback-files，幂等）；成功按会话 id 记 `rolledBackFilesSessionId` 置灰「已撤销」，`onArtifactsChange` 重新武装；部分失败/异常走 addToast；流式中防御拦截（卡片本就不显示）。② 每文件行 stats 后追加「打开」小按钮（`artifact.preview && artifact.path` 才渲染），替代原头部仅开首个可预览文件的按钮。③ readOnly 面板 ChatPanelHost 不传 onRollbackFiles 隐藏撤销；卡片模块不引用消息级 onRollbackFromMessage。
- Verification: vitest assistant-artifact-card + message-actions（38 tests）+ 关联 18 文件（320 tests）全过；`npx tsc -b`、eslint 改动 8 文件 0 error、`npm run build` 通过。
- Boundaries: 服务端零改动；整卡折叠、类型专属图标、「审查」diff 视图未做（后续可选）；未 commit。

## Completed Feature：assistant-reply-artifact-card（2026-09-07，Revision）

- 目标：仅在最后一条已渲染 assistant 回复底部显示“本次回复涉及的文件”卡片；流式中、user、历史 assistant 或无当前轮 artifacts 时不显示。
- 实现：新增 `src/components/chat/panel-decoration/assistant-artifact-card.ts`，复用 `extractCurrentTurnArtifacts`，只纳入有 path 的 `write_file`/`edit_file`/`present_files`；按设计稿展示文件图标、标题/说明、总 +N/-N、类型徽标、文件名、路径/类型辅助信息、每文件差异、统一「打开」预览按钮，以及「变更范围 · 本次回复」和详情展开/收起。`message-actions.ts` 每次 decorate 先清理并同步卡片，保证 Lit 重建幂等；流式或无 artifact 清除。旧 change-summary-strip UI、CSS、i18n key 和测试已删除；服务端影子备份/回滚实现保留。
- 测试：新增 `tests/frontend/assistant-artifact-card.test.ts` 覆盖最后 assistant/流式过滤、actions 前插入、preview 接线、CSS 类与 reduced-motion 契约；前端全套 130 files / 1351 tests 通过。
- Verification：定向 `npx vitest run tests/frontend --reporter=dot`、`npx eslint` 改动 TS/TSX、`npx tsc -b --pretty false`、`git diff --check` 均通过；提交前全量 `npm run test`（283 files / 2688 tests）、`npm run lint`（0 error，仅既有 warning）、`npm run build` 通过。
- Boundaries：未修改服务端、生成产物；已提交 dev，未 push。

## Completed Feature：session-change-summary-rollback（2026-09-07，needs-review）

- Feature: 对话底部会话级代码变更摘要条——修改文件数、对账真实 ±行数、影子备份安全回滚、HTML 预览（session-change-summary-rollback）。
- 决策（用户确认）：影子备份机制（非 git restore）、整会话回滚粒度、真实 diff 行数口径（首次备份内容 vs 当前内容）。
- 实现：`server/session-file-backups.mjs`（备份/摘要/回滚/7 天 TTL；同会话同文件只备份首次、新建登记 created）；`server/tools/index.mjs` write_file/edit_file 写盘前备份（失败仅 WARN 不阻断）；`server/agent-subagent-runner.mjs` 子 Agent 工具上下文补 sessionId 使写入归因父会话；新路由 GET `/api/agents/:id/file-changes` + POST `/api/agents/:id/rollback-files`。前端 `panel-decoration/change-summary-strip.ts`（composer dock 上方常驻条、两步确认回滚、流式禁用、html 预览经 App `onOpenHtmlPreview` → `workspacePreviewUrl` → Inspector browser tab）；ChatPanelHost 主 effect 创建（sideChatMode||readOnly 不挂）、decorate 周期 sync 按消息 write/edit toolResult 签名变化节流 fetch；i18n 中英 +7 key；CSS 中性条 + 绿/红 ±行数（含 dark）。
- Verification: 定向 vitest session-file-backups 5 + routes/agent 21 + tools 68 + agent-manager.subagents 16 + 前端契约 10 全过；eslint 改动 ts 0 error；node --check 4 模块；tsc -b；npm run build ✓（仅既有 chunk 警告）。未跑全量。
- Boundaries: run_command 产生的文件改动不纳入备份/回滚（见 Notes）；OpenCode harness 不经 QuickForge 工具链无备份；未新增依赖、未触碰生成产物、未 commit。
- Revision（预览对齐产物体系）：用户指出既有产物预览支持 html/md/txt/word 等全类型——变更摘要条预览从仅 `.html` 对齐为复用 `artifactPreviewMode` 判定（html/图片 → Browser、markdown/代码 → Reader、pdf/docx/excel → Document），回调改名 `onOpenFilePreview`，App 删除自拼 `workspacePreviewUrl` 的旁路改为直接调产物预览统一入口 `openArtifactPreview(projectId, relativePath)`，与产物列表点开同一文件行为完全同源（含 tab 复用/重载）；unknown 类型与无项目上下文的全局会话不显示按钮（与产物预览一致）。复验：契约测试 10、eslint、tsc -b 通过。
- Next step: 真机冒烟——项目会话让 Agent 编辑/新建文件 → 底部条出现文件数与 ±行数 → 展开列表 → md/txt/html/docx 等点「预览」分流到 Reader/Browser/Document → 「回滚」两步确认后文件恢复原样、新建文件被删除；流式中回滚按钮禁用；Side Chat 无条。

## Completed Feature：sqlite-heavy-op-worker-thread（本轮，已完成）

- Feature: SQLite 会话域重操作迁入 worker_threads 专职线程（sqlite-heavy-op-worker-thread，**已完成**）——"保存设置被同进程同步大事务阻塞"的治本项。
- 架构（方案 A 双连接分区）：worker 持自开 DatabaseSync 连接，白名单 op（save/saveMany/applyBatch/replaceMessages/appendMessages/delete/deleteBySessionId/replaceAll/exportSnapshot/verifyIntegrity/checkpointWal/readMessagesPage）经 postMessage RPC 在 worker 侧执行；主线程保留小读与 share/lan/scheduled-runs/session-index/maintenance-lock。正确性靠既有 revision CAS + BEGIN IMMEDIATE + busy_timeout（worker 侧 SQLITE_BUSY 有限重试），postMessage FIFO 保持 per-session 串行；错误序列化保留 statusCode/errorCode 控制流属性。`QUICKFORGE_SQLITE_WORKER=0` kill-switch；`configureSessionStateService({repository})` 注入恒优先不经 worker（测试/维护注入可达）。savePairChunked 保留主线程分批编码（快照契约不变），事务移 worker。
- 实现关键点：database.mjs 新增 getSqliteDatabasePath + 持久关闭钩子集合（closeSqliteStorage 先关 worker）；service heavyOp 路由 + 11 个导出方法 async 化；storage.mjs 调用点补 await；**异步化暴露两处真实缺陷已修**——①`atomicSessionMetadataStateUpdate` 的 `return updateSessionMetadataBucket(...)` 无 await 导致 conflict 重试从未捕获异步 rejection（改 return await）；②storage.mjs pin 路径 `atomicSessionMetadataBucketUpdateViaFacade` 原靠同步 run-to-completion 串行化，异步交错后按 service 同款 maxRetries=3 用新鲜桶状态重算 updateFn。附带：writePlan rename 补 Windows AV 25/50/100ms 重试（并行全量跑下 backup 测试在用户真实目录 EPERM 偶发，同 writeJsonAtomic 既有模式）。
- 验证：worker 单测 6 用例 ×3 稳定；sqlite+session-state 全族 97×4 稳定；受影响面 25 files / 212 tests 全过；全量 281 files / 2662 tests → 2642 过，剩 20 失败均属并行会话未提交改动（git-status-request-lifecycle 2 / git-tools-pinned-summary 1 / side-chat-workspace-tab 1 为其 App.tsx/ChatPanelHost 改动的源码契约失败；routes/side-chat 16 为其 text-attachments.mjs import cacheDir 撞 vi.mock 缺导出）；eslint 改动文件 0 error；node --check；build ✓。
- Boundaries：repository 零改动；session-state-import 启动导入未迁移；share/lan 等域留主线程（后续可评估）；未新增依赖；未触碰生成产物。
- Next step: 真机验证（长会话 agent 运行中保存设置/切会话不再卡顿、desktop 与 npm web 各一次；观察日志无 SESSION_STATE_WORKER_CRASHED）；kill-switch 验证 QUICKFORGE_SQLITE_WORKER=0 回退。

## Completed Feature：desktop-fork-default（本轮，已完成）

- Feature: 桌面端默认以独立子进程运行 server，inline 变显式 opt-in（desktop-fork-default，**已完成**）。
- 背景：用户追问"修改默认模型/思考等级接口慢"的根因链路：①设置页加载链（catalog 重复请求 + Cloud 2s 等待，另行立项）；②同进程单事件循环被会话持久化同步 SQLite 大事务阻塞——桌面端默认 inline 内嵌 server 使该阻塞直接冻结 Electron 主进程窗口。用户决策：翻转 fork 默认 + 立项 worker_threads 治本（见后续 feature）。
- 实现：`desktop/electron-main.mjs` 默认判定改 `QUICKFORGE_DESKTOP_INLINE === '1'`（opt-in inline，附注释说明动机与 PAC 逃生门）；dev（`!app.isPackaged`）传 `stdio: 'inherit'` 保住子进程 stderr，打包版保持 ignore；`server/public-api.mjs` 新增 `stopChildProcess`（SIGTERM→`waitForChildExit` 10s→SIGKILL→5s，对齐 qf CLI `terminateProcess` 语义），instance.stop 与 stopQuickForge 兜底分支均走升级链。
- 语义变化：默认 fork 下桌面代理走 node 侧 os-proxy-resolver（自定义 PAC URL 需 opt-in inline）；同版本端口复用（'same-version'）生效——退出不复用进程、attach 既有同版本服务；顺带修复 inline 三缺陷：UI restart 杀整个 App、EADDRINUSE 静默 process.exit(1)、启动失败傻等 300s。
- Verification：定向 vitest 3 files / 16 tests（desktop-fork-default 4 新契约 + startup-health-timeout 5 + public-api 7）全过；eslint 3 文件 0 error；node --check；npm run build ✓（仅既有 chunk 警告）。
- Boundaries：未新增依赖；未触碰生成产物；Windows fork 退出为硬杀（WAL 可恢复、日志尾 ≤5s 可能丢）已记录为接受项。
- Next step: 真机冒烟（启动/退出无孤儿进程、托盘主题刷新、UI restart 窗口保留并重连、杀子进程前端显示断连）；随后执行 sqlite-heavy-op-worker-thread。

## Completed Feature：sidebar-session-running-unread-status（本轮）

- 侧栏会话行尾新增状态反馈：运行中显示旋转 Loader2，成功完成且用户尚未点击时显示 emerald 绿色未读点，点击对应会话清除。覆盖 Pinned、Projects/Timeline、Tasks 三类会话行。
- 未读状态仅存在于当前前端生命周期；错误/中止不显示成功未读点。新增 `design-review/sidebar-session-status.html` 交互预览。
- 验证：`npx tsc -b --pretty false`、相关 ESLint、`git diff --check` 通过。未修改生成产物、未新增依赖。
- Revision（移除标题左侧加载 spinner）：用户反馈点击/刷新会话时标题左侧的加载 icon 出现/消失会把标题挤得抖动一下。删除 `sessionLoadingIndicator` 定义及 5 处渲染（置顶/时间线/项目分组/全局会话/搜索结果列表，最后一处为调研时发现的搜索弹窗），行按钮 `aria-busy` 语义保留，行尾运行中/未读状态不受影响；`Loader2` import 因行尾状态与加载占位仍在使用而保留。验证：ESLint ChatSidebar.tsx、`npx tsc -b`、定向 vitest 6 files / 52 tests 全过。

# Progress

## Completed Feature：sidebar-show-more-refocus-spinner（2026-09-07，已完成）

- Feature: 切回浏览器时「显示更多」按钮 spinner 闪烁修复（sidebar-show-more-refocus-spinner，**done**）——用户在 sidebar-pinned-refocus-flash 修复后报告"显示更多按钮也闪烁一下"，调研确认属实（详见 Notes）。
- 根因：切回 → refreshSessions 把各会话列表统一置 `loading:true`，`SessionDisplayControls` 的 `loading ? Loader2 : '显示更多'` + `disabled={loading}`（`disabled:opacity-45`）在切回期间切换；本地快时 React 合批掩盖、稍慢环境跨渲染帧呈现——闪烁时有时无。
- 实现：`SessionPage` 增加可选 `appending` 字段（session-list-updates.ts，spread 天然保留）——四个 loader 置位 `loading:true, appending: offset>0`，成功/失败/timeline 收尾统一清 `appending:false`；hook 新增导出 `projectTimelineAppending`/`globalAppending`/`projectAppending`；ChatSidebar 三处 SessionDisplayControls（timeline/项目/全局）`loading` prop 改读 appending 变体；App 两处传参接线。原 `*Loading` getter 保留：timeline/project 空态 spinner、`LoadMoreSentinel enabled={!pinnedCollapsed && pinnedHasMore && !pinnedLoading}` 防重复门控、App 首次展开项目守卫均不动；ChatSidebar/App 的 `globalLoading` 死链（全局区唯一消费点已换 appending）一并移除，hook 导出保留。用户点「显示更多」的 spinner 反馈与首载/分页/防并发语义零变化。
- 测试：session-pagination-bootstrap 更新 3 处状态断言（补 `appending:false`）+ 新增 2 用例（静默 refresh 阻塞时 `loading:true, appending:false`、loadMore 阻塞时 `appending:true`，deferred + offset=0 调用计数区分首载与 refresh）；sidebar-section-order 新增按钮接线契约（三处 loading 用 appending 变体、不再直接消费 globalLoading/projectLoading/projectTimelineLoading、空态 spinner 与 sentinel 保留）。
- Verification: 定向 vitest 5 files / 47 tests 全过；eslint 6 改动文件 0 error；`npx tsc -b --pretty false` 通过；浏览器实测同 120ms 延迟条件修复前 spinner 切换（t=197ms）→ 修复后 `svgChanges:[]`、`disabledFlips:0`。未跑全量（非发布）。
- Boundaries: 不改 LoadMoreSentinel/空态 spinner/分页/防并发；hook 导出面只增不减；未新增依赖；未触碰生成产物；未 commit。
- Next step: 无 blocker；用户真机切走/切回确认按钮静止；真机点「显示更多」确认 spinner 反馈仍正常。

## Completed Feature：sidebar-pinned-refocus-flash（2026-09-07，已完成）

- Feature: 切回浏览器时侧栏项目列表闪烁修复（sidebar-pinned-refocus-flash，**done**）——用户报告"切回浏览器到页面，左边项目的列表闪烁一下"。
- 根因（调研 + 实测实证，详见 Notes 2026-09-07 条目）：切回 → `useCrossTabSync` visibilitychange → `refreshSessions` → `loadPinnedSessions(0)` 先 `setPinnedPage({...prev, loading:true})`（useSessionPagination.ts:90，空 items 保留）→ 无置顶会话时 `ChatSidebar.tsx:1299` 挂载条件 `length > 0 || pinnedLoading` 因 loading 短暂成立 → 整个 Pinned 区块（标题 + `px-3 pb-1` 容器，侧栏第一个区块）挂载 → fetch 返回无置顶 → 卸载；MutationObserver 两次复现存活 42-62ms，下方项目列表被挤下再弹回即"闪烁"。触发条件 = 无置顶会话；App 首启同路径但整页加载期不显眼。
- 实现：挂载条件收紧为 `pinnedSessionItems.length > 0`（内容驱动，附注释说明约束）；删除随之不可达的区块内 loading spinner 占位分支（`length === 0 ? spinner : list` 三元收敛为直接渲染）；`pinnedLoading` 保留于 `LoadMoreSentinel enabled={!pinnedCollapsed && pinnedHasMore && !pinnedLoading}` 防重复加载更多，分页/loading 语义零改动。有置顶会话时区块常驻行为不变。
- 测试：`sidebar-section-order.test.ts` 新增契约——挂载条件含 `length > 0`、不含 `|| pinnedLoading`、区块内无 `length === 0` 死分支、LoadMoreSentinel 仍受 `!pinnedLoading` 门控。
- Verification: 定向 vitest 3 files / 33 tests（含 sidebar-section-order 21）全过；eslint 2 改动文件 0 error；`npx tsc -b --pretty false` 通过；修复后 dev server + MutationObserver 复验切回事件，Pinned 区块插拔消失（仅剩 dnd-kit 无位移 transition 写入）。未跑全量 test/lint/build（非发布）。
- Boundaries: 不改 useSessionPagination/loading/分页语义；不动 dnd-kit；未新增依赖；未触碰生成产物；未 commit。调研中发现的其余工作区级候选（rAF 补跑滚动跳变、SSE 重连提示条插拔、watchdog 全量替换、scrollbar-gutter）保持 Notes 备查，不在本 feature 扩大范围。
- Next step: 无 blocker；用户真机切走/切回确认项目列表不再闪。

## Completed Feature：large-paste-text-attachment（本轮）

- 长文本粘贴达到 3,000 字符时写入 qf 临时目录 `cache/global/tmp/conversations`，消息仅保存路径元数据；模型侧按受限路径读取，不把全文重复写入消息。
- 输入框内复用现有附件 tile；不显示“打开”文字，点击附件自动调用系统文件管理器；对话记录显示完整路径文本。
- 修复 pending 会话打开附件时的 400：不再直接在编辑器层拼接 agent endpoint，统一交给 App 的本地路径处理。
- 验证：文本附件与消息转换测试 9/9 通过；tsc、相关 ESLint、npm run build、git diff --check 通过。构建仅有既有 KaTeX/chunk warnings。
- Revision（真机冒烟报错修复，2026-09-07）：用户报告点击附件报「无法打开文件 Path is outside the selected project」。排查结论：该报错来自旧构建渲染进程（feature 中间态：编辑器粘贴已有、App.tsx 专用分支未上），重启加载新 dist 后不复现；但当前代码存在两个真实缺陷一并修复——① `openPathInFileManager` 仅接受目录，而 open-text-attachment 路由传入 .txt 文件，必然 400「Directory does not exist」：改为支持文件定位（win32 `explorer /select,<file>`、darwin `open -R`、Linux `xdg-open <父目录>`，参数构造抽为纯函数 `createFileManagerOpenArgs`，缺失文案统一 `Path does not exist`）；② message-actions 附件装饰无幂等守卫（Lit index-keyed 复用 user-message DOM，每装饰周期重复 append 路径行 + 叠加 once 点击监听），且多附件时 `:last-of-type` 全绑到最后一个 tile：重写为 `decorateTextAttachmentTiles`（tile 按 attachment 下标对齐、每 tile 仅一个读取当前 dataset 路径的持久监听、路径行按内容比对后重建）；editor-bindings 点击监听同步去 `once`（第二次点击不再落回 pi 附件预览）。新增测试：platform 2（三平台目录/文件参数矩阵）、agent 路由 3（创建/合法路径透传文件本身/非法路径 400）、message-actions 3（绑定+路径行、重复装饰幂等+持续可点、多附件对齐+路径变化跟随）。定向 vitest message-actions 30 / agent 19 / platform 5 / text-attachments+message-converters+editor-bindings+channels 17 全过；eslint 0 error；tsc -b；node --check；npm run build 通过。wiki server/utils 平台条目同步。
- Revision 2（UI 微调，2026-09-07）：用户反馈对话内不要显示完整路径。移除消息内 `.quickforge-text-attachment-path` 路径行（CSS 两条规则删除；装饰函数保留对该行的清理，防止同会话旧装饰残留），完整路径仅在附件 tile hover 提示（title）里，点击打开行为不变。message-actions 测试同步（路径行不存在 + 旧残留被清理），定向 vitest message-actions 30 + editor-bindings 2 全过；eslint 0 error；tsc -b；npm run build 通过。
- 边界：未新增依赖，未 commit/tag/push。


## Completed Feature：backup-settings-only-and-snapshot-fast-path（本轮，已完成）

- 本轮完成并验证：消息队列、活跃 Agent destroy-first、scheduled task updater、IndexedDB 事件收窄、`exportSnapshot` 的 keys/has/identity 快路径优化，以及用户 HTTP backup 的 settings-only boundary。
- 结果：相关实现与测试已完成；用户备份 HTTP 边界明确为 settings-only，不扩展到其他数据；本轮状态文件仅做最小追加/更新，保留工作区历史未提交改动。
- Revision（提交前定向验证与测试修复，2026-09-07）：发现新增并行用例「preserves a concurrently started parallel run」从未跑绿（HEAD 源码下同样失败，非源码回归），两处测试缺陷：①mock `createAgent` 的 timeout 模式 `continue()` 永不 resolve，`finish()` 仅 emit `agent_end` 无法唤醒 `runPromise`，用例只能卡在超时路径——mock 暴露 `resolveContinue` 并在 `finish()` 中结算；②`sessionId` 嵌入真实（未 fake 的）`Date.now()` 毫秒时间戳，同毫秒两次 run 共用 sessionId/事件总线使 listenerCount 断言失败——第二次 run 前自旋等待跨毫秒。修复后定向 vitest 8 files / 131 tests 全过（scheduled-tasks.execution 连跑 3 次 13/13 稳定）；eslint 16 个改动文件 0 error；随后创建 commit（docs/reports/ 12 份分析报告按用户决策保持未跟踪，另行整理）。
- Notes：未修改生成产物，未覆盖历史条目；未处理项沿用既有 Notes，不在本轮扩大范围。

## Completed Feature：desktop-memory-session-idle-eviction（2026-09-05）

- Feature: 桌面端内存暴涨排查 + 修复会话永不淘汰问题（desktop-memory-session-idle-eviction，**已完成**）。
- Status: done — 用户报告桌面端「内存爆炸卡死」。三轮只读调研（渲染端 / 服务端 / Electron 主进程）+ 关键点人工核实，结论：①根因之一为会话级 SSE keepAlive 每 15s `touchSession` 重置 10 分钟闲置计时器（agent.mjs），前端全局 SSE 常开导致本次运行打开过的所有会话连同全量消息历史永久驻留内嵌主进程堆；②其余主要问题见下方 Notes（渲染端窗口化禁用、装饰全量扫描、进程内嵌等，未在本条处理）。
- 实现：`server/routes/agent.mjs` keepAlive 心跳移除 `touchSession(sessionId)`（connect 时单次 arm 保留，与 restoreAgent 行为一致），并补注释说明心跳不得重置闲置计时的约束。删除安全性已核实：数据路由（state/messages/status/HEAD）与 `runPrompt`→`syncSessionFromStorage` 均自动 restore 被闲置销毁的会话（销毁不丢数据，历史在 SQLite）；闲置计时器对 running 会话自动续命（agent-manager.mjs:411-416）；`sseConnected` 挂在 session 对象上，销毁后无 409 死锁；前端实际只用全局流 `/api/agents/events`（server-agent.ts:208，挂模块级 emitter，不受销毁/恢复影响），会话级 `/stream` 端点在 src/、android/ 无消费方；`8e75c78` 引入该 touch 时前端尚用会话级流，现已不适用。
- Verification: 定向 vitest `tests/server/routes`（24 files / 183 tests，含 agent.test.mjs）+ agent-manager.abort / acp.prompt-cleanup / exports-contract 全过；eslint server/routes/agent.mjs 0 error。
- Boundaries: 单文件最小改动；未动 `dist/` 等生成产物；未 commit/tag/push。docs/wiki 无需更新（内部行为修复，不涉及架构/职责/公共入口/发布流程）。
- Next step: 无 blocker；后续候选见 Notes（渲染端窗口化恢复、装饰增量化、desktop fork 隔离、SSE 背压）。
- Revision（前端空闲会话副本缓存清零）：用户决策「不要存 7 个副本」——`agent-task-retention.ts` `MAX_IDLE_AGENT_TASKS` 5→0：taskMap 仅作为活动注册表（当前会话 + 后台 running/streaming 任务），切走的空闲会话立即销毁、切回走服务端 restore（网络往返换内存）；`useAgentManager.ts` `startDeferredSession` 视图切换后补 `pruneIdleTasks(undefined)`，堵住「新建空白会话后上一个空闲会话滞留到下次事件」的口子（running/streaming 不受影响，后台运行/完成 toast/状态角标/隧道恢复同步等 taskMap 消费方均兼容）。渲染端驻留副本 ~7 → 当前 + 后台运行数。新增契约用例 `MAX_IDLE_AGENT_TASKS === 0`。验证：定向 vitest 5 files / 26 tests 全过；eslint 3 文件 0 error；tsc -b；build ✓（仅既有警告）。

## Completed Feature：subagent-capability-inheritance（2026-09-04）

- Feature: Subagent MCP 与 Agent Skills Profile 开关及父工具集交集继承（**已完成**）。
- 实现：Agent Profile 新增 `allowMcpTools` / `allowAgentSkills`，Markdown/API 缺失默认关闭；QuickForge 自定义 Profile 可编辑，外部只读 Profile 不可编辑，内置 `general` / `explore` 通过 `agent-profile-overrides` 保存两个开关。
- 子 Agent 运行时只从父会话当前 `agent.state.tools` 继承对应 MCP 与 `activate_skill` / `read_skill_resource` 工具，不从全局额外扩展；开关默认关闭；MCP 仍走父会话审批/完全访问策略；Skills 无需审批；继续禁止递归 subagent。关闭 Skills 时动态移除继承的 `<available_skills>` 目录，避免系统提示词与工具列表不一致。
- 文件：`server/agent-profile-schema.mjs`、`server/agent-profile-files.mjs`、`server/agent-profiles.mjs`、`server/routes/agent-profiles.mjs`、`server/tools/definitions.mjs`、`server/agent-subagent-runner.mjs`、`server/agent-manager.mjs`、`server/subagents.mjs`、`src/components/agent-profiles/AgentProfilesPage.tsx`、`src/lib/i18n.ts`、相关测试与 Wiki。
- Verification：定向 Vitest 7 files / 64 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false`、相关 `node --check`、`npm run build` 全通过（build 仅既有 KaTeX 字体与 chunk size warnings）。
- Boundaries：未新增依赖，未修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push。

> 归档说明（2026-09-04）：更早的 33 个条目已移至 docs/archive/progress-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json。

## Completed Feature：composer-borderless-thinking-control（2026-09-04）

- Feature: Composer 底栏控件去框 + 思考等级独立选择器（composer-borderless-thinking-control，**已完成**）
- Status: done — 用户分四步驱动，逐轮设计稿对齐（design-mockups/composer-borderless.html，v1 两方案 → v2 思考等级独立 → v3 最终稿）：①标签「完全访问权限」→「完全访问」（agentAccessFullLabel），完全访问模式整体琥珀 #d97706（复用审批卡警告色）；②方案 A 完全去框——模型选择与 Agent 权限按钮移除 1px 边框与浅色填充，「计划」/子智能体胶囊不动；③顺序保持不变（左：[+] [完全访问]；右：[模型] [发送]），思考等级从模型按钮「· 等级」后缀拆为独立选择器（模型右侧、发送左侧），大脑 icon 归思考等级（icon + 等级文字形态、模型选择补下拉小箭头均经 AskUserQuestion 确认）。
- 实现：新 `panel-decoration/thinking-level-controls.ts`（按钮 + 五档向上弹出菜单，关/低/中/高/超高，menuitemradio + 勾选态，样式与 Agent 权限菜单共用选择器组；与其他 Composer 弹层互斥、Escape/点外关闭、resize/scroll 重定位）；`model-controls.ts` 移除思考后缀逻辑；`panel-decoration.ts` 接线（deps 新增 onThinkingLevelChange，dismissComposerMenus 纳入 thinking 菜单，disableComposerControls 纳入 thinking 按钮）；`ChatPanelHost.tsx` 回调写 `agent.state.thinkingLevel` + `updateThinkingLevel` 同步服务端 + 重跑装饰；`icons.ts` 新增 thinkingBrainIcon；`index.css`：模型按钮 ::before 大脑换盒形 icon 且默认隐藏、::after 由等级后缀改为 chevron（紧凑/移动端反转显示），thinking-inline 无框样式与 icon-only 紧凑规则，Agent 权限/模型按钮展开态不再强制前景色边框。
- Verification: npm run build ✓（仅既有 warnings）；eslint 改动文件 0 error；定向 tests/frontend 126/127 files 通过——唯一失败 `local-tool-running-sweep.test.ts` 为 **HEAD 上即失败的既有问题**（ruleFor 朴素正则被规则上方注释 glue，git show HEAD 对比证实，与本次无关），其余 1312 tests 全过；chat-compact-controls / composer-control-hover 两处断言旧结构的回归测试同步新设计。
- Boundaries: 未动服务端与 thinking 协议；模型选择弹层（custom-model-selector 及移动端 sheet 内的思考区块）保持原样，两处入口写同一 state；Side Chat 禁用态纳入 thinking 按钮；未新增依赖；未 commit/tag/push。
- Next step: 无 blocker；可选真机过一遍：切换思考等级后发送确认生效（服务端日志）、不支持推理模型下按钮隐藏、窄屏 icon-only 形态。
- Revision（用户追加三连改）：①「+」按钮同样去框；②模型选择弹层（桌面菜单 + 移动端 sheet）移除思考等级区块，custom-model-selector 删 thinking 渲染与 `thinkingLevel`/`onThinkingLevelSelect`/`showThinking` 选项，useModelActions / SharedConversationPage 调用点同步清理（保留切非推理模型自动归零守卫），桌面菜单头部「推理」→「模型」，无主 model-menu-separator / model-menu-note / model-sheet-thinking* CSS 删除；③思考等级按钮补下拉小箭头（thinkingChevronIcon，紧凑/移动端与文字一起隐藏为 :is() 组）。**事故记录**：本轮用 Python 正则批量删死 CSS 时，可选注释前缀 `(?:^[^\n]*\n)*?` 从文件首个单行注释起吞掉 4638 行；发现后 `git show HEAD` 恢复并用 Edit 工具逐块重放全部会话内 CSS 改动，最终 diff +97/−57 与预期一致，build + 1312 tests 复验全绿。
- Revision 2（用户四连改）：①误伤审查——全量 `npm run test` 276 files / 2626 tests，唯一失败仍为 HEAD 既有 local-tool-running-sweep，grep 无残留引用（THINKING_LEVELS 仅存于新模块）；②「完全访问」hover/展开背景删 12% 琥珀淡底、回归与其他控件一致的中性浅色底，文字/图标保持琥珀；③桌面模型菜单合并单一列表（去掉当前模型行→hover 子菜单二级结构、positionModelSubmenu 与 .quickforge-model-submenu CSS；「模型」头部 + 全部模型勾选项 + 设置入口；空列表恢复 .quickforge-model-menu-note 提示）；④模型按钮删 max-width min(14rem,38vw)，窗口缩放不截断模型名（<768px / 紧凑模式仍按设计收成 icon）。复验：build ✓、eslint 0 error、前端 126 files / 1312 tests 全过。
- Revision 3：紧凑模型 icon 经 6 候选对比页（design-mockups/model-compact-icon-options.html）评审维持 Box，同时补齐 mask 内部棱线（顶棱 m3.29 7 8.71 5 8.71-5 + 正面竖线 M12 22V12）使应用内显示与设计稿一致（此前只有外轮廓、呈空心六边形）；紧凑/移动端 icon-only 形态按钮行改 flex-start + gap 0.5rem，图标控件连续排列间距统一（消除权限 icon 与模型/思考之间的 justify-between 弹性空隙），发送/停止按钮 margin-left auto 保持右缘。复验 build ✓ + 前端 1312 tests 全过。
- Revision 4（上下文圆环紧凑态槽位修复）：`context-usage.ts` 在模型按钮前源码创建 `quickforge-context-usage-slot`，紧凑态由 `index.css` 提供固定 32px flex 槽位，14px 圆环居中；百分比与数据计算不变。新增 `chat-compact-controls` / `context-usage` 契约测试锁定槽位、插入顺序、14px 环和 compact 分组布局。定向 Vitest 2 files / 24 tests、ESLint、tsc -b、build、git diff --check 通过；未 commit/tag/push。
- Revision 5：Agent 输入框底部权限控件去除 `border-transparent` 透明边框类，保留原有尺寸、圆角、间距与 hover/展开反馈；新增 `tests/frontend/agent-access-menu.test.ts` 源码契约，确认触发按钮无透明边框且下拉菜单仍保留实际边框。改动文件：`src/components/chat/panel-decoration/agent-access-menu.ts`、`tests/frontend/agent-access-menu.test.ts`。定向 3 files / 18 tests、ESLint、tsc -b、git diff --check 通过；未 commit/tag/push。

- Revision 6：模型选择弹窗（桌面与移动端共用）选中勾改为复用 `agentAccessCheckIcon` SVG，勾选槽位移至左侧并与思考等级菜单统一 1rem 栅格、13px 图标和前景色；新增 `custom-model-selector.test.ts` 契约断言。定向模型选择器 8/8、ESLint、git diff --check、tsc -b 和 build 均通过；未 commit/tag/push。
- Revision 7（运行中 Subagent 控件去框）：完成 `src/components/chat/panel-decoration/subagent-running-indicator.ts` 的运行中控件去框，并同步 `tests/frontend/subagent-running-indicator.test.ts` 与 `tests/frontend/composer-control-hover.test.ts` 契约覆盖。定向 2 files / 15 tests、ESLint、tsc、build、git diff --check 均通过。

## Notes

- 置顶摘要分支菜单改为旁挂弹层（2026-09-09，用户两轮指令：先「屏蔽一下」后改为「不要移除 不要在里面打开、从旁边打开」，按最终指令完成，未提交）：`GitToolsPinnedSummary` 桌面分支菜单不再在 panel 内容流中向下展开（原 `md:absolute md:top-full md:w-full` 嵌在滚动区里），改为作为 desktop widget 直接子节点旁挂弹出——默认左侧（`right-full mr-1 origin-top-right`），左侧空间不足 340px 翻右侧（`left-full ml-1 origin-top-left`）；打开时用分支行与 widget 的 rect 差算 top、viewport 12px 安全区算 maxHeight（22rem 上限/160px 下限），`GitBranchMenu` 新增可选 `style` 透传承接动态定位；拖动/收起/suspend/桌面移动形态切换（`desktopDraggable` 变化经 queueMicrotask 收起）即关闭。移动端保持原 fixed `top-[9.25rem]`/`max-h-[calc(100dvh-9.75rem)]` 契约（原 `md:absolute` 桌面类整体删除）。中间曾按「屏蔽」指令做过只读分支行版本（移除 onCheckout/onCreated/onOpenGraph props），本轮已完整恢复接线。契约测试 git-tools-pinned-summary.test.ts 同步（新旁挂用例替换只读用例）；wiki docs/wiki/src/components/README.md 六处同步。验证：定向 vitest 2 files / 38 tests、eslint 4 文件、tsc -b 全过。
- session-change-summary-rollback 边界（2026-09-07）：影子备份只覆盖 write_file/edit_file 写盘；`run_command`（npm install、脚本生成文件等）与 OpenCode harness 的文件改动不进备份/摘要/回滚——命令产生的变更若需纳入，需另行评估 run_command 前置目录快照（成本高）或提示用户用 git 兜底。备份文件按会话目录存放，7 天 TTL 惰性清理，超大会话备份的磁盘占用未设上限（单文件内容级备份，与源文件同量级，暂可接受）。

- 「显示更多」按钮切回闪烁调研（2026-09-07，实测实证，**已修复**，见 Completed Feature sidebar-show-more-refocus-spinner）：用户在 sidebar-pinned-refocus-flash 修复后报告"显示更多按钮也闪烁一下"。确认属实：切回 → refreshSessions 把 pinned/global/各项目会话列表全部置 `loading:true`（useSessionPagination.ts 四个 loader 置位处）→ `SessionDisplayControls`（ChatSidebar.tsx）按钮内容 `loading ? Loader2 : '显示更多'` + `disabled={loading}`（`disabled:opacity-45`）在切回期间切换。dev server 实测：本地无延迟时 React 把 loading:true/false 两次 setState 合批在同一渲染帧、中间态不进 DOM（MutationObserver 0 记录）；hook fetch 加 120ms 延迟模拟稍慢环境后确定性复现——dispatch 触发 5 个列表 API，t=197ms 按钮从 spinner 恢复文字（parentText="显示更多"）。闪烁时有时无的根源即"请求耗时是否跨过渲染帧边界"。与 Pinned 区块闪烁同根：切回 refresh 的 loading 态误伤已挂载 UI。修复：SessionPage 增加 `appending` 字段（offset>0 追加才置位），SessionDisplayControls spinner/disabled 只读 appending 变体；`*Loading` getter 保留给空态 spinner 与 LoadMoreSentinel 门控。
- 切回浏览器时工作区显示"抖一下"调研（2026-09-07，双 explore 只读调研 + 关键点人工核实 + dev server 实测复现）：切回必然执行的只有 `useCrossTabSync.ts:78-91`（visibilitychange → visible 时 refreshSessions + loadProject(true)，loading:true 一帧 + App 全树重渲染，聊天面板不重建）与 `useVisibleRuntimeStatuses.ts:98-106`（侧栏状态点刷新）。**用户澄清闪烁位置为侧栏项目列表，根因已实测实证**：refreshSessions → `loadPinnedSessions(0)` 先 `setPinnedPage({...prev, loading:true})`（useSessionPagination.ts:90，loading 保留空 items）→ 无置顶会话时 `pinnedSessionItems.length===0`，`ChatSidebar.tsx:1299` 挂载条件 `length > 0 || pinnedLoading` 因 loading 短暂成立 → 整个 Pinned 区块（"置顶会话"标题 + `px-3 pb-1` 容器，侧栏滚动区第一个区块）挂载 → 本地 fetch 返回无置顶 → `items:[], loading:false` → 区块卸载；MutationObserver 两次复现存活 42-62ms，下方项目列表被挤下再弹回即"闪烁一下"。**该条已修复**（sidebar-pinned-refocus-flash，挂载条件收紧为内容驱动 + 契约测试，修复后复验区块插拔消失）。次要伴随变化（视觉基本无感）：8 个项目行 dnd-kit `style.transition` 写入又清空（SortableProjectItem，无 transform 位移）、"显示更多"Loader2 短暂切换（已单独立项为上一条 Notes）。工作区级其余候选保留：①隐藏期 rAF/RO 挂起，切回第一帧集中补跑——`ChatPanelHost.tsx:1313-1321` scheduleDecorate、`scroll-sync.ts:80-87` 双重 rAF scrollToBottom + `:173-180` RO 触发，叠加 pi-web-ui AgentInterface 内部 RO 无条件 `scrollTop=scrollHeight`，流式中切回滚动跳变；②后台 SSE 断连时 `reconnect-notice.ts:89` 提示行为 `messageList.append` 文档流内插拔、`unreachable-strip.ts` 常驻条挂载/移除挤压 composer；③流式中切走 watchdog（server-agent.ts:48-49）补跑 `refreshStateFromServer({forceMessages:true})` 全量替换 messages；④消息滚动容器无 `scrollbar-gutter`，滚动条出现/消失致整列 reflow。自证：DevTools Performance 录制切回瞬间 + 对 `.quickforge-reconnect` 设 DOM 断点。
- scheduled-tasks 并行 run 的 sessionId 为 `scheduled-${taskId}-${Date.now().toString(36)}`（server/routes/scheduled-tasks.mjs executeTask），同一毫秒并发启动的两个 run 会共用 sessionId/事件总线（测试中同毫秒冲突已实证）；生产修复（追加随机后缀等）另行立项，不在本轮扩大范围。
- 桌面端内存排查（2026-09-05）遗留候选，按收益排序：①渲染端消息窗口化被 `ChatPanelHost.tsx:600` `{enabled:false}` 整体禁用（commit 32be493 为 turn-navigation 关闭），长会话全量 DOM 常驻 + 流式期每 rAF 全量装饰扫描（message-actions.ts querySelectorAll 全面板、artifacts key 全量构建）→ 卡死主因；恢复窗口化或装饰增量化（code-blocks.ts:574-588 command 块已有指纹跳过模式可参照；mermaid/SVG 块每帧 atob+哈希未跳过）。②desktop 默认 inline 内嵌 server 于主进程（electron-main.mjs:519），server 同步 SQLite 大事务（agent-persistence 每次全量序列化会话消息）与 GC 停顿直接冻结窗口/托盘；fork 模式路径已存在（QUICKFORGE_DESKTOP_INLINE=0，stdio ignore）。③SSE 无背压（res.write 返回值未检查，慢客户端无界缓冲）+ message_update 每次携带全量 partial。④storage 路由 keys/has/index 触发 exportSnapshot 全库物化（session-state-repository.mjs:723-745）。⑤ACP 会话 idleRetention:'always'（acp/server.mjs:656）+ 渠道进程 taskkill 强杀 → 旧 ACP 会话无界驻留。⑥pdfjs loadingTask 卸载竞态泄漏（WorkspaceDocumentContent.tsx:116-133）、xlsx 全 sheet 物化。
- 已修复测试基础设施问题：`tests/frontend/local-tool-running-sweep.test.ts` 的 CSS `ruleFor` 正则此前会把规则上方注释 glue 进 selector 文本，导致 `.quickforge-tool-running-sweep` 误报缺失；现参考 `chat-compact-controls.test.ts` 先剥离 CSS 注释，定向测试 6/6 通过。

## Completed Feature：sidebar-pin-hover-alignment（2026-09-04）

- Feature: 侧栏会话行置顶按钮 hover 对齐修复——镜像槽位交叉淡入淡出（sidebar-pin-hover-alignment，**done**）
- Status: done — 根因修复 + 契约测试与 wiki 同步完成；未 commit。
- 根因：① 静置 pin（in-flow、时间文本左侧、size-5/size-3 图标）与 hover 浮层 pin（absolute right-1、size-6/size-3.5）位置和尺寸均不一致，hover 跳位约 5-20px 且放大，过渡期双影；② pinnedSessionButtonClass 的 transition-opacity + transition-colors 被 twMerge 去重为后者，静置 pin opacity 实为瞬变；③ 全局会话行归档图标误用 size-4；浮层 right-1(4px) 与行内容右缘 px-2(8px) 错位。
- 实现：镜像槽位几何——静置 [pin 槽 size-6][gap-1][时间槽 w-9 右对齐]，未置顶行渲染 size-6 空 span 占位（时间列/标题列跨行对齐，pin/unpin 不挤压布局）；hover 浮层 right-2 锚点 + [Pin size-6][gap-1][Archive h-6 w-9]，与静置簇几何完全镜像，pin 原位交叉淡入淡出零位移零缩放、归档胶囊精确覆盖时间槽；图标统一 size-3.5；pin 过渡改单一 transition-[color,opacity]；会话浮层与行内主按钮间距统一 gap-1（初版 gap-2 被用户反馈太宽后收窄，两态间距必须一致以保持镜像）、项目行浮层保持 gap-px（基类不再携带 gap）；四处行结构（Pinned 分区/时间线/项目子会话/全局会话）同步。
- 测试：新增 tests/frontend/sidebar-session-action-alignment.test.ts（7 用例源码契约：pin 几何/过渡、时间固定槽、空槽占位×3、浮层镜像锚点与间距、归档 w-9、图标尺寸统一 8×pin/4×archive、静置与浮层顺序）。
- Verification: 定向 vitest 4 files / 44 tests 全过；回归 3 files / 21 tests 全过；eslint 2 文件 0 error；tsc -b 通过；npm run build 通过（仅既有 chunk 警告）。未跑全量 test/lint。
- Boundaries: 不改悬停提示/确认归档流/actionsSuppressed/删除退出动效；纯 Tailwind 几何无新 CSS 模式，DESIGN_LANGUAGE 未改；未置顶行标题可用宽度减少约 32px（换取全列对齐与零跳变）。
- Next step: 真机冒烟——置顶/未置顶行 hover 时 pin 原位淡入淡出、归档落位时间槽、时间列跨行对齐、pin/unpin 切换无布局挤压、确认归档与 hover 提示回归。

## Completed Feature：motion-design-batch-2（2026-09-04）

- Feature: 动效统一第二批——大弹窗复用、菜单展开、Toast 调优、列表项淡入、侧栏删除退出 retune（motion-design-batch-2，**已完成**）
- Status: done — 四步方案 + 可选第 5 项全部落地，源码、契约测试与 DESIGN_LANGUAGE.md 已同步；未 commit。
- 实现：① skills/GitGraph/ShareConversation/project-directory-picker 四个大弹窗复用第一批 dialog-backdrop-in / panel-in；② 新增 `--quickforge-dur-exit: 140ms` token 与 `quickforge-menu-in` 原语（origin 由组件按对齐设置 origin-top-left/right），接线 GitBranchMenu（条件渲染确认无机制改动）与 ProjectOpenMenu；③ toast 调优：`transition-[translate,opacity]`、enter/exit 时长分设两分支类（180/140ms）、卸载超时对齐 token、加 motion-reduce 降级；④ `quickforge-list-item-in` 接线 WorkspaceChangesList（不改 key 语义，状态变化重放淡入属可接受）；⑤ 侧栏会话删除退出 360ms → 140ms（deleteSessionFadeMs 常量 + 5 处配对类全部 token 化，机制不变）。
- 测试：motion-design.test.ts 扩至 13 用例（exit token、menu 原语+两处接线、四弹窗复用、toast 契约、列表项接线、5 处删除 retune）。
- Verification: 定向 vitest 3 files / 42 tests 全过；eslint 10 文件 0 error；tsc -b 通过；npm run build 通过；产物 CSS 抽查（menu/list keyframes、exit token 压缩为 .14s、toast transition-property）确认。未跑全量 test/lint。
- Boundaries: 菜单退出保持瞬时卸载；不改 ChangesList key；路由页（MobileServerConnect/ShareLinksSettings）不接线；无新依赖。
- Next step: 真机冒烟——四个大弹窗落位、Git 分支菜单/项目打开菜单从触发角展开、后台任务 toast 进出节奏、git 变更列表新文件淡入、侧栏删除会话的快速退出、reduced-motion 全降级。

## Completed Feature：agent-manager-module-split（2026-09-04）

- Feature: agent-manager.mjs 上帝模块无损拆分（agent-manager-module-split，**done**）——纯机械搬移，零行为变更。
- 结果：agent-manager.mjs 4014 → 约 1966 行，保留会话生命周期编排 + facade re-export；新模块 agent-session-store / agent-session-events / agent-harness / agent-compaction / agent-prompt-commands / agent-approval-orchestrator / agent-subagent-runner / agent-persistence，函数逐字符搬移，消费方 import 路径零改动。
- 执行序列（每块独立 commit，均过门禁）：b55c3d8 安全网（导出面契约测试 + agentSessions/pendingRestores/subagent 错误暂存收口）→ 557b748 事件核心（agentEvents/emitSessionEvent/分帧/消息构造器/context usage）→ 61d316d harness 常量 + /summary /compact /clear → 9fe9758 斜杠命令解析与 prompt 模板 → e841aad 审批 Promise 编排 → f33e70b run_subagent 生命周期 → 1f7a8fd 会话持久化（persistSessionState 经 facade 保持公共 API）。
- 门禁：每块全量 npm run test 与基线一致（275 files / 2612 tests，唯一失败为既有前端 CSS 契约，与 server 无关）、eslint 0 error、build 通过；契约测试锁定 47 个消费面符号不变，内部共享导出（resetIdleTimer/createServerTools，persistSession 已随块4收回）单独登记；tunnel-host 集成测试捕获一处链接期缺导出（persistSession 未导出）并即时修复。两个既有源码契约测试（model-retry-notice、agent-harness）同步覆盖符号新位置，行为断言不变。
- 文档：docs/wiki/server/README.md 模块地图同步（目录树 + agent-manager 条目 + 拆分模块清单）。
- Notes: ① 前端 App.tsx / ChatPanelHost.tsx 上帝组件拆分另行立项；② 工具构建（createServerTools 等）与 SSE 路由仍在 agent-manager，后续可继续拆；③ 工作区基线的 local-tool-running-sweep 前端 CSS 契约失败为拆分前既有问题（motion-design 批次遗留），与本 feature 无关。

---

## Planned Feature：agent-manager-module-split（2026-09-04 立项，未开始）

- Feature: agent-manager.mjs 上帝模块无损拆分（agent-manager-module-split，**pending**）——纯机械搬移，零行为变更。
- 背景：架构审查（双 explore 调研）确认 agent-manager.mjs 约 4000 行混杂 8+ 类职责，模块级可变状态 agentSessions/stashedSubagentErrorDetails/pendingRestores 无唯一 owner、36 处直接引用，为最大风险聚集点。
- 方案：① 第零步建安全网：全量 test/lint/build 基线数字、导出符号契约测试、高风险区（persist CAS / subagent 超时中止 details / 审批 Promise）补行为用例；② 状态收口到 server/agent-session-store.mjs；③ 绞杀式逐块抽取 agent-compaction → agent-prompt-commands → agent-subagent-runner → agent-persistence → agent-approval-orchestrator → 工具包装，agent-manager 保留 facade re-export，消费方零改动；每块独立 commit，门禁=契约测试+全量 test 与基线一致+lint+无新增循环 import。函数体逐字符搬移，不改任何语法语义/逻辑/导出面。
- Boundaries: 只拆模块不改功能；前端 App.tsx/ChatPanelHost.tsx 拆分另行立条目；发现的问题只记 Notes。
- Next step: 执行第零步（基线 + 导出契约测试）。

---

## Completed Feature：motion-design-batch-1（2026-09-04）

- Feature: 动效统一第一批——motion token、弹窗进入动画、侧栏文字淡入双通道、按钮按压微交互、工具扫光纳管（motion-design-batch-1，**已完成**）
- Status: done — 五项动效按确认方案落地，源码、契约测试与 DESIGN_LANGUAGE.md 已同步；未 commit。
- 实现：`src/index.css` 顶层 `:root` 新增 `--quickforge-dur-fast/base/slow`（120/180/280ms）与 `--quickforge-ease-out`（cubic-bezier(0.2,0,0,1)）token；新增共享进入原语 `quickforge-dialog-backdrop-in` / `quickforge-dialog-panel-in`（遮罩淡入 + 面板 translateY 4px、scale 0.97 落位，进入-only）接线 prompt-dialog 与 confirm-dialog；`quickforge-sidebar-label-in`（opacity 淡入）挂 ChatSidebar `sidebarSessionTitleClass` 与 `sectionHeaderClass`，侧栏展开时文字随宽度过渡淡入；`ui/button.tsx` cva 基类升级 `transition-[background-color,color,border-color,scale] duration-(--quickforge-dur-fast) ease-(--quickforge-ease-out) active:scale-[0.97]` 全局按压回缩；工具扫光保持 1.8s 循环并注释为时长刻度豁免类。全部 keyframes 带 prefers-reduced-motion 降级。
- 测试：新增 `tests/frontend/motion-design.test.ts` 7 用例（token 定义、弹窗原语+接线、侧栏淡入挂载点、按钮按压契约含 v4 scale 属性、扫光豁免、reduced-motion 守卫）；同步更新 `sidebar-section-order.test.ts` 对 `sidebarSessionTitleClass` 的既有精确字符串断言。
- Verification: 定向 vitest 2 files / 27 tests 全过；eslint 6 文件 0 error；`npx tsc -b` 通过；`npm run build` 通过（仅既有 chunk size 警告）；产物 CSS 抽查确认 token var、`transition-property` 含 scale、`.active\:scale-\[0\.97\]:active{scale:.97}` 与 dialog/label keyframes 均正确编译。未跑全量 test/lint。
- Boundaries: 不新增依赖/动画库；仅进入动画；只动 opacity/transform/scale；大型功能弹窗（skills/GitGraph/ShareConversation）与 toast/菜单/列表 enter-exit 属后续批次。
- Next step: 真机冒烟——弹窗打开淡入落位、侧栏展开时标签/分区头淡入、任意按钮按压缩放反馈、系统开启「减弱动态效果」时以上全部瞬时呈现。

## 1.10.2 发布状态（2026-09-04）

- 已 bump 版本至 1.10.2，并完成当前 dev 分支待发布提交的文档整理。
- 发布前门禁已通过：`npm run test`（273 files / 2602 tests 全过）、`npm run lint`（0 error，1 个既有 warning）、`npm run build`（通过，含既有 KaTeX/chunk warnings）。
- qf-agent 测试夹具已最小修复：Windows `taskkill` mock 正确触发 exit，并在每个测试前恢复 real timers；定向测试 28/28 通过。
- runtime/offline 包已生成并复核，`package-offline/shawnstack-quickforge-1.10.2.tgz` 约 7.4 MB，包内版本为 1.10.2。
- v1.10.2 Git 发布已完成：release commit `40deadb`、tag `v1.10.2` 已创建，并已推送 `origin/dev`；本次不执行 npm publish。
- 当前 `pinned-summary-draggable-capsule` needs-review feature 已按用户确认纳入本次发布，仍保留 needs-review 状态。

---

## Completed Feature：dead-code-cleanup-round-1

- Feature: 僵尸代码清理（dead-code-cleanup-round-1，**已完成**）——删除全仓库零引用的导出符号与遗留文件。
- Status: done — 三路只读调研（src/、server/、scripts/tests/外围）产出候选清单，随后逐符号 `grep -w` 全仓库复核（排除 dist/package-dist/package-offline/desktop-dist/node_modules/android），仅删除复核确认的高置信度项；未 commit。
- 删除内容：① 前端 6 个零引用导出（openCodeUsageIcon、getWorkspaceTree 及其独占类型 WorkspaceTreeResponse、clearApiCache、INPUT_CLAMP_EASING、selectableModelsFromProviders、sessionScope）；② server 19 个零引用导出，其中 skills.mjs 的 5 个无后缀旧包装（loadSkills/listSkillSummaries/findSkill/filterKnownSkillNames/loadSelectedSkills，现行 API 为 Global/Project 变体）、storage/share-store 各 2 个、agent-manager/sqlite/session-state-service/access-policy/lan-access-store/project-config/share-service/subagents/utils/workspace/agent-profile-files 各 1 个；③ 级联死链：requireShareJsonAdapter 删除后 share-service.mjs 的 `jsonAdapter` 只写变量、`configureShareService` 的 `json` 参数与 share-lifecycle 测试的 `json: null` 一并移除；④ 遗留文件：`dev-server.log`（gitignore 本地文件）、根目录 3 张 `oom-*.svg`、`artifacts/`（单文件后删空目录）、`design-preview/`（空目录）、`tests/fixtures/` 5 个零引用 electron-smoke 脚本（scheduled-runs-cutover/scheduled-task-runs/scheduled-task-runs-service/session-index/session-state）。
- 保留依据：restart-supervisor/update-supervisor 与 maintenance/*-v1 为运行时动态路径加载非孤儿；quickforge-settings-select.ts 为副作用 import；design-mockups/ 被源码注释引用为设计出处；generateSharePassword 前端同名函数来自 share-client.ts 非删除对象。
- 文档同步：`docs/architecture/browser-cache-strategy.zh-CN.md` 删 clearApiCache 条目、`docs/wiki/server/README.md` 删 requireShareJsonAdapter 提及、`docs/wiki/server/utils/README.md` 删 invalidateDirectorySizeCache 提及、feature_list.json 清理 browser-oom-first-aid files 数组中 3 张已删 SVG。
- Verification: 删除后复查 25 个符号代码零残留，级联候选（pruneTokenRecords/verificationDigest/messagesDigestFromValues/subagentDefinitions/readJsonFile 等）均有其他调用方；`node --check` 14 个改动 server/测试文件通过；`npm run test` 273 files / 2602 tests 全过；`npm run lint` 0 error（仅 identity.mjs:92 既有 warning，见 Notes）；`npm run build` 通过（仅既有 chunk size 警告）。
- Boundaries: 未新增依赖；未触碰 dist/、package-dist/、package-offline/、desktop-dist/；未 commit/tag/push；中低置信度候选（约 200 项"仅文件内使用的冗余 export"、生产-测试僵尸、scripts/ 一次性基准脚本）未动，留待后续轮次。

---

## Completed Feature：sidebar-collapse-zoom-width

- Feature: 桌面侧栏收缩态避免 resize 恢复展开宽度（sidebar-collapse-zoom-width，**已完成**）
- Status: done — 按已确认的最小方案修改源码、源码契约测试、ChatSidebar wiki 与状态文件，未 commit。
- 实现：`ChatSidebar.tsx` 的桌面 `window.resize` effect 现在在 `isMobile || !sidebarOpen` 时直接跳过，浏览器缩放或视口变化不会在收缩态调用 `finishResizing(nextWidth)` 写回展开宽度；`finishResizing()` 无 `finalWidth` 的收缩/移动清理路径调用 `asideRef.current?.style.removeProperty('width')`，避免遗留内联样式覆盖 `w-14`。展开拖拽、reset 与移动端语义不变。
- 测试：`tests/frontend/sidebar-section-order.test.ts` 新增源码契约，锁定 resize effect 的 `!sidebarOpen` 守卫、resize listener 与收缩清理的 `removeProperty('width')`。
- Docs：`docs/wiki/src/components/README.md` 的 ChatSidebar 条目补充桌面收缩态不会因 `window.resize`/浏览器缩放恢复宽度，以及清理遗留内联 width 的语义。
- Verification: 定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 20 tests 全过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` 通过；未 commit/tag/push，未修改生成产物。
- Boundaries: 不新增依赖，不触碰 `dist/`、`package-dist/`、`package-offline/`，不 commit/tag/push；工作区其他未提交改动保留。

---

## Completed Feature：manual-compact-adaptive-retention

- Feature: 手动 `/compact` 放宽并始终压缩全部当前可压缩历史。
- Status: done — 已按用户确认调整为固定全量压缩，核心源码、边界测试、server wiki 与状态文件已同步，未 commit。
- 实现：`server/agent-manager.mjs` 手动 compact 固定传入 `keepRecentTurns: 0` 和 `minSourceChars: 0`；`server/auto-compaction.mjs` 默认 `keepRecentTurns` 改为 `0`，设置归一化支持 `0-20`，并保留 keep=0 的 tailStart 与 in-place 支持；`src/lib/auto-compact-settings.ts` 与设置页同步默认值、`min=0` 和显式 0 输入；审批展示兜底同步为 0。
- 测试：`tests/server/auto-compaction.test.mjs` 覆盖 keep=0 时 tailStart 等于完整消息长度；`tests/server/conversation-compaction.test.mjs` 覆盖短历史在 `minSourceChars: 0` 下全量压缩且 recentTail 为空。
- Verification: 定向 Vitest 6 files / 39 tests 全部通过；相关 ESLint 通过；`node --check server/auto-compaction.mjs`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 与 `feature_list.json` JSON parse 均通过。build 仅有既有 KaTeX 字体与 chunk size 警告；未跑全量 test/lint。
- Boundaries: 不修改 `/summary`、自动压缩阈值/minSourceChars/确认/间隔与保护逻辑，仅将自动压缩 `keepRecentTurns` 默认值改为 0 并支持 0；不碰 dist/package-dist/package-offline，不新增依赖。

---

## Completed Feature：known-exception-i18n

- Feature: 已知代码异常文案国际化——展示层把 Request was aborted / AI stream 超时等已知英文异常映射为本地化文案（known-exception-i18n，**已完成**）
- Status: done — 用户实测「错误：Request was aborted.」英文原文后提出；源码、测试与 wiki 已同步；未 commit。
- 调研：错误正文来源为 pi-ai（各 provider abort 抛 'Request was aborted'、流异常结束两串）、server/ai-http-logger.mjs（'AI stream idle/total timeout after Nms'，idle 覆盖首事件/后续事件两档）、undici（'fetch failed'）、server-agent.ts（'Failed to send prompt: HTTP N' 兜底）。数据层必须保持英文原文——SQLite 持久化、客户端 appendAssistantErrorMessageOnce 去重、subagent trace 去重（错误原因与 trace 终态错误文本精确相等比较）都依赖原始字符串，翻译只能做展示层。
- 实现 ①：新增 `src/lib/error-messages.ts` `translateErrorMessage(message)`——规则表 trim + 忽略大小写 + 容忍句尾句点 + ms/status 参数捕获走 `t(key, params)` 插值；未匹配的动态正文（provider 错误、subagent 超时进度复合句）原样返回。
- 实现 ②（主聊天/Side Chat）：message-actions.ts `decorateAssistantErrorText` 在 decorate 周期把 pi-web-ui 错误红块（`div.bg-destructive/10`）内 `<strong>` 后动态文本改写为译文；保留原 strong 节点（前缀本地化/加粗）、`dataset.quickforgeErrorText` 幂等、语言切换下一轮自动收敛、译文===原文（未匹配）不改写 Lit 节点；对全部错误消息生效（含历史错误）。
- 实现 ③（subagent 卡）：local-tools.ts `renderSubagentRunBody` 错误原因卡（聊天摘要卡与 Inspector 详情共用）改 `translateErrorMessage(payload.errorMessage) || t('subagentErrorUnavailable')`。
- 实现 ④：i18n 中英成对 +7 key（errorRequestAborted「请求已中止。」、errorAiStreamIdleTimeout「模型连接空闲超时（{ms}ms 无响应）。」、errorAiStreamTotalTimeout、errorAnthropicStreamEnded、errorStreamNoFinishReason、errorFetchFailed「网络请求失败。」、errorSendPromptHttp「发送消息失败（HTTP {status}）。」）。服务端零改动、无新依赖、无视觉变化。
- Verification: 定向 vitest 6 files / 193 tests 全过（error-messages 新建：10 条映射断言含句点/大小写/空白容忍与插值、动态正文透传、空值、两处接线契约；message-actions/i18n-snapshot/subagent-run-detail/local-tools-lit-reactivity/server-agent 回归）；eslint 5 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量；未 commit。
- Boundaries: 数据层（errorMessage 字段、持久化、去重比较）保持英文原文，仅展示层翻译；OpenCode ACP 动态错误、provider 返回的动态错误正文、subagent 超时进度复合句不在映射表内（原样显示）；规则表按需追加（新增已知异常在 error-messages.ts 加一条规则 + i18n 一对 key 即可）。
- Next step: 真机冒烟：中文界面下停止生成/弱网超时/断网发送失败 → 错误红块分别显示「请求已中止。」「模型连接空闲超时（60000ms 无响应）。」「发送消息失败（HTTP xxx）。」；subagent 失败卡同理；英文界面文案不变；未知 provider 错误仍显示原文。

---

## Completed Feature：todo-summary-completed-icon-emerald

- Feature: 对话上方 Todo 摘要完成项图标改绿色——与置顶摘要 Todo 的 emerald 完成语义保持一致（todo-summary-completed-icon-emerald，**已完成**）
- Status: done —— 纯 CSS 颜色改动 + 测试契约，源码与测试已同步；未 commit。
- 起因：用户反馈「对话上方的 todo 显示，完成的 icon 换一下绿色的，和摘要的保持一致」。置顶摘要（GitToolsPinnedSummary 的 TodoStatusIcon）完成项是 CheckCircle2 + text-emerald-600，而对话上方 todo-write-summary 行级完成项图标是 var(--muted-foreground) 灰色。
- 实现：`src/index.css` 中 `.quickforge-todo-summary-item--completed .quickforge-todo-summary-status-icon` 的 color 由 muted 改为本组件「全部完成」圆环对勾的既有 emerald 配方（light `rgb(4 143 101)` / 新增 `html.dark` 变体 `rgb(110 231 183)`），复用 slash agent chip 语义色、不新增颜色体系，light 下与置顶摘要 emerald-600 视觉一致；完成项文字保持 muted + 删除线不变；ring-check 上方注释措辞同步为「绿色用于 Todo 完成语义（行级图标 + 圆环对勾）」。
- 测试：`tests/frontend/todo-write-renderer.test.ts` 既有 emerald 契约用例（改名 colors completed checks…）扩展断言行级完成项图标 light/dark 绿色。
- Verification: 定向 vitest todo-write-renderer 10 tests 全过；回归 todo-write-summary 26 + git-tools-pinned-summary 24 全过；eslint 测试文件 0 error（css 被 lint 配置忽略）；feature JSON parse 通过；npm run build 通过（仅既有 chunk size 警告）。纯 CSS 改动未跑 tsc/全量。
- Boundaries: 不改图标形状（同为圆圈打勾语义）、不改完成项文字样式、不触碰置顶摘要与 in_progress/pending 图标；无架构/公共入口变化，wiki 无需更新（纯视觉微调，components wiki 未描述行级图标颜色粒度）。
- Next step: 真机复核 light/dark 下对话上方 Todo 摘要展开列表的完成项绿色图标与置顶摘要一致。

---

## Completed Feature：error-continue-retry-button

- Feature: 错误旁「继续生成」按钮——会话末尾错误消息挂常显继续操作行，发送「继续」消息或重发未送达的原始消息（error-continue-retry-button，**已完成**）
- Status: done — 调研方案经用户两轮确认（改「重试=发继续用户消息」语义）后实现；源码、测试与 wiki 已同步；未 commit。
- 调研结论：错误渲染为消息末尾 `{role:'assistant', stopReason:'error', errorMessage, 空文本}`（pi-web-ui 红块），decorateMessages 空文本早退导致错误消息无任何操作行；既有 retryFromMessage/continueSession 会截断 user 消息之后全部内容（丢弃失败轮已完成工具进度、重放工具副作用）；pi-ai transform-messages 构建请求时整条跳过 error/aborted assistant 消息并为孤儿 toolCall 合成 toolResult，因此「发继续消息」链路安全且与用户手动打字恢复完全同路径。
- 实现 ①（UI）：message-actions.ts 终态错误（会话最后一条 display 消息为错误）挂常显弱化操作行——runIcon icon-only「继续生成」+ 时间戳，不依赖 hover（触屏可用），无 copy/fork；创建路径与 message-bottom 快路径均管理 continue 按钮存在性/禁用态；错误不再最后一条或门控关闭时整行移除（历史错误无操作行）。门控沿用 allowRetry(capabilities.retry，OpenCode 隐藏)/readOnly/historyActionsDisabled(Side Chat 禁用)/流式禁用。
- 实现 ②（接线）：ChatPanelHost `onContinueAfterError`——错误带 quickforgeFailedPrompt 时优先 `retryFailedPrompt`（重发原始消息），否则 `agent.prompt(t('errorContinueMessage'))` 发「继续」。
- 实现 ③（重发）：server-agent.ts prompt HTTP 失败合成错误时挂客户端专用 `quickforgeFailedPrompt`（原始未送达消息）；`retryFailedPrompt` 非流式时把 stash 的 capabilities/contextReferences 预置回 nextPrompt*（防空快照剥除 details）、移除错误消息后原样重发。i18n 中英 +2 key（errorContinueAction「继续生成」/errorContinueMessage「继续」）。服务端零改动、无新依赖、无新 CSS 段。
- 测试：新增 message-actions「error message continue action」10 用例（常显行+点击回传、幂等+禁用、历史错误、陈旧行、四门控、接线契约）+ server-agent 4 用例（stash 挂载、重发保真+错误条目移除、无 stash false、流式拒绝）；附带修复测试假 DOM harness 的 querySelectorAll 按选择器分组拼接 bug（改文档顺序，否则 user/assistant 交错与消息 index 错位）。
- Verification: 定向 vitest 3 files / 84 tests 全过；回归 3 files / 32 tests（capabilities/side-chat/message-queue）全过；eslint 6 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量 test/lint；未 commit。
- Boundaries: 仅终态错误显示按钮（历史错误无入口，避免误截断语义）；OpenCode（capabilities.retry=false）与 Side Chat（禁用）/readOnly（隐藏）沿用现有门控——prompt 语义理论上可支持 OpenCode，留作后续小迭代；错误消息不进 LLM 上下文（pi-ai 既有行为），模型只看到「继续」指令与失败前已完成的工作；消息队列在 agent_end error 后暂停的行为不变，继续按钮不自动恢复队列。
- Next step: 真机冒烟：模型流超时/断网杀后端产生错误 → 错误旁出现常显 ▶ 按钮 → 点击发出「继续」消息、模型从失败前进度接着做、错误消息保留在历史；断网时发送失败错误 → 点击重发原始消息（含插件/文件引用 chip 保真）；流式中按钮禁用；OpenCode 会话无按钮。

---

## Completed Feature：sidebar-drag-vertical-boundary

- Feature: 侧栏项目/任务拖拽纵向边界——区块标题拖拽 clamp 到可见视口，修复可无限向下拖动（sidebar-drag-vertical-boundary，**已完成**）
- Status: done — 源码、测试与 wiki 已同步；未 commit。
- 起因：用户反馈「项目和任务拖动的时候注意不能无限向下拖动」。调研确认：项目条目拖拽（restrictProjectDragToViewport，d07f18a）已夹取在 Projects 列表 ∩ 共享滚动视口内；但 72ac7e0 后加的「项目/任务」顶层区块标题拖拽（section DndContext）没有任何 modifier，`SortableSidebarSection` 仅锁横向、纵向 transform 无界——拖动区块标题可无限向下，正是用户看到的问题。
- 实现：`ChatSidebar.tsx` 新增 `sectionsDragBoundaryRef`（挂在区块排序容器 div）与 `sectionDragStartScrollTopRef`（`handleSectionDragStart` 记录起始 scrollTop），新 modifier `restrictSectionDragToViewport` 复用 `src/lib/project-drag-boundary.ts` 纯函数（可见交集 + 纵向 clamp + 滚动补偿），接入区块 DndContext `modifiers`；区块拖拽预览被夹取在区块排序容器与侧栏共享滚动视口的可见交集内，不能向下越出可见区、也不会上移越过 Pinned。dnd-kit `collisionRect` 使用 modifier 后 transform，落点同步受限；拖拽期间两区块本就临时折叠（dnd-kit `useRect` 对 active node 有 ResizeObserver，折叠后重新测量），换位所需位移远小于边界，排序语义不变。同时 `clampProjectDragTransform` fallback 收紧为 fail-closed：rect 缺失/退化（minY>maxY）时横向纵向同时锁定，项目条目与区块两条路径共用，边界未知时不再放任纵向无界拖动。
- 测试：`project-drag-boundary.test.ts` fallback 用例改写为 x/y 均锁 0；`sidebar-section-order.test.ts` 新增区块拖拽边界 wiring 契约（ref/起始 scrollTop/modifier 声明与 section DndContext 接线、autoScroll=false 保持）。
- Docs: `docs/wiki/src/components/README.md` ChatSidebar 两条（项目拖拽 fail-closed 说明 + 新增区块拖拽边界条目）；`docs/wiki/src/lib/README.md` 补 `project-drag-boundary.ts` 表格条目（此前索引缺失，现记录双消费方与 fail-closed 语义）。
- Verification: 定向 vitest 4 files / 37 tests 全过（project-drag-boundary 10、sidebar-section-order 19、mobile-fullscreen-adaptation 3、sidebar-new-chat-routing 5）；eslint 4 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX/chunk 警告）。未跑全量 test/lint。
- Boundaries: 未新增依赖；未改 dnd-kit 配置语义（section autoScroll 仍为 false、KeyboardSensor 不受影响）；未触碰生成产物；工作区其他未提交改动保留。
- Next step: 真机冒烟：拖动「项目」「任务」区块标题向下应停在可见区域底部；向上不越过 Pinned；松手换位正常；项目条目拖拽回归正常。

---

## Completed Feature：subagent-timeout-structured-progress

- Feature: Subagent 超时结构化输出——错误正文携带进度摘要 + details 注入持久化 toolResult，默认超时 60 分钟 → 2 小时（subagent-timeout-structured-progress，**已完成**）
- Status: done — 源码、测试与 wiki 已同步；未 commit。
- 起因：用户实测「错误原因: Subagent general timed out after 60 minutes.」后提出超时报错应把 AI 已完成的工作结构化输出（"大概知道做了什么"），同时要求子 Agent 默认超时改为 2 小时。调研确认：pi-agent-core 把抛错的 execute 收口为纯文本错误结果（details 为空对象），details 又不进 LLM 上下文（`omitDetailsForLlm`），因此父模型只见一行字；前端实时 SSE 路径有运行中快照回填兜底，但持久化 toolResult.details 为空，刷新/恢复后过程全部丢失。
- 实现 ①（错误正文）：`server/agent-manager.mjs` 超时错误保持既有首句 `Subagent X timed out after N minutes.`，其后追加 `Progress before timeout: N tool calls; still running: toolA; last assistant message: …`——工具计数取 beforeToolCall 累计值；被中断工具由 pendingToolCalls（toolCallId 集合）× 消息历史 assistant toolCall 块求交集（与前端 currentSubagentToolSummaries 同一算法，新函数 pendingSubagentToolNames）；最后一条 assistant 文本经 lastAssistantText 提取、压缩空白并截断 600 字符（SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT），无内容时省略分句。
- 实现 ②（details 注入）：runSubagent 抛错前把 `quickforgeSubagentDetails`（与成功终态同构 + `timedOut:true` + toolCallId，messages 全量）挂到 error 上；`wrapSubagentToolDefinition.execute` catch 后按 toolCallId 存入模块级 stash（即取即删 + 6h TTL 兜底清理）；主 Agent 构造点新增 `afterToolCall`（仅 isError 且 run_subagent 时取回，返回 `{ details }`），错误 toolResult 因此携带完整过程持久化，刷新/恢复后 Inspector 可见。前端 `details.timedOut → error` 判定为既有预留逻辑，UI 侧零改动；isError、置顶摘要 ✗、SSE 协议不变。
- 实现 ③（2 小时）：SUBAGENT_DEFAULT_TIMEOUT_MS 与新增 SUBAGENT_MAX_TIMEOUT_MS（runSubagent clamp + 临时 subagent prompt 内 clamp 两处）同步 2 小时；内置 explore/general maxRuntimeMs、subagents.mjs markdown 回落、agent-profiles.mjs / agent-profile-files.mjs DEFAULT_MAX_RUNTIME_MS 一并上调；旧安装内置 markdown 由启动物化（全内容比对）自动重写。
- 测试：agent-manager.subagents 12 tests——既有超时用例改写为 2 小时默认 + 错误正文/quickforgeSubagentDetails/afterToolCall 注入·即取即删·非 run_subagent 早退断言；新增「有进度超时」用例（MockAgent hangAfterProgress 模式：真实驱动 beforeToolCall 计数、带未完成 toolCall 的 assistant 消息与 pending 集合）。前端 subagent-run-detail +2 契约：timedOut details 注入后 status=error、trace 保留、errorSource=output 不重复渲染 output 块；无 isError 时 details.timedOut 仍判 error。
- Verification: Revision 2 复验 2 files / 106 tests 全过（新增通用失败用例：failAfterProgress 模式驱动，正文不变/无标记/注入与即取即删；前端通用错误恢复契约）。此前 Revision 后复验 2 files / 104 tests 全过（父中止用例改写：新正文/quickforgeSubagentDetails.aborted/timedOut 未设置/注入与即取即删）；eslint 2 文件 0 error、node --check 通过。此前定向 vitest 5 files / 121 tests 全过（agent-manager.subagents 12、agent-profiles 4、agent-profile-files、subagents、subagent-run-detail 92）；回归 agent-manager.* 家族 9 files / 31 tests + routes/agent 16 tests 全过；eslint 6 个改动文件 0 error；node --check 4 个服务端模块通过；feature JSON parse、git diff --check 通过。未跑全量 test/lint/build。
- Revision（父运行中止复用）：`Subagent X aborted with parent run.` 首句不变，其后追加 `Progress before abort:` 同构摘要，details 以 `aborted:true` 标记走同一 stash/afterToolCall 注入——用户停止后错误 toolResult 同样持久化，下一回合模型可见部分进度、刷新后 Inspector 保留 trace（此前误判"父循环拆解后不可见"：toolResult 仍持久化并进入后续 LLM 上下文）。摘要分段抽为 subagentProgressSegments、终态 details 抽为 buildTerminalSubagentDetails 闭包，超时/父中止两分支共用；前端 `details.aborted → error` 判定与测试（subagent-run-detail :414）均为既有。
- Revision 2（通用失败全覆盖）：修复"只要报错就看不到 subagent 执行过程"——内层 catch 为所有未携带 details 的运行期失败统一挂 quickforgeSubagentDetails（同构终态、无 timedOut/aborted 标记），错误正文保持上游原文（前端 stripTerminalErrorFromTrace 依赖 errorMessage 与 trace 终态错误文本精确相等去重，改文本会破坏去重）；刷新/恢复后 Inspector trace 不再丢失。实时 SSE 路径的 previousPayload 合并兜底保留，错误 toolResult 现直接携带全量 details，两条路径一致。
- Boundaries: 外层失败（模型解析/工具创建/Agent 构造等 prompt 开始前）无进度可带，不挂 details；旧版本已持久化的空 details 错误 toolResult 无法回溯补全；日志仍只记 errorName 等元数据，符合 p0-subagent-observability 隐私边界；未新增依赖；未触碰生成产物。
- Notes: scheduled-tasks.mjs 的 `runtimeLimitMs`（定时任务会话运行上限，默认/上限仍 60 分钟）与 `run_command` 1 小时超时为独立语义，本 feature 未动，如需调整另行立项。
- Next step: 真机冒烟：长时间 subagent 触发超时（或调小 profile max-runtime-ms）→ 父 Agent 回复应能转述部分进度；聊天摘要卡「错误原因」显示进度摘要；刷新页面后 Inspector Subagent Tab 仍能看到完整 trace。父中止路径：运行中点停止 → 下一条消息父 Agent 能转述 subagent 中止前进度，刷新后 Inspector 同样保留 trace。

---

## Needs Review Feature：pinned-summary-draggable-capsule（普通任务置顶摘要一致性验收修订）

- Feature: 普通全局会话的非简单多步骤任务也应受 `todo_write` 通用计划规则指导，并在实际产生有效 Todo 后显示既有置顶摘要（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 最小修复系统提示词作用域与契约测试；本次修订已纳入提交。
- 根因与修复：普通 global 会话实际具备 `todo_write`，但 `server/system-prompt.mjs` 的通用规则误置于 `For project tasks:` 之下。现仅将该规则移到项目任务专属段之前，使所有具备工具的非简单多步骤任务适用；`For project tasks:` 内其他规则及工具权限不变。
- UI 边界：`App.tsx` / `GitToolsPinnedSummary.tsx` 继续按 Todo、Git、Subagent 实际内容驱动挂载；无有效内容时不显示入口，不实现常驻空摘要。
- 测试：`tests/server/system-prompt.test.mjs` 不只断言文案存在，而是同时锁定规则索引早于 `For project tasks:`、项目任务段内不含该规则、全文仅出现一次。
- Docs: `docs/wiki/server/README.md` 记录系统提示词作用域；`docs/wiki/src/components/README.md` 明确通用计划规则与内容驱动 UI 空态边界；无新视觉模式，`DESIGN_LANGUAGE.md` 无需更新。
- Verification: `npx vitest run tests/server/system-prompt.test.mjs` → 1 file / 7 tests 全过；`npx eslint server/system-prompt.mjs tests/server/system-prompt.test.mjs`、`node --check server/system-prompt.mjs`、`feature_list.json` JSON parse、`git diff --check` 全过。
- Boundaries: 未改前端源码/契约，故无需前端测试；未新增依赖，未触碰生成产物；已清理本轮临时未跟踪文件。
- Next step: 真机用普通全局会话发起非简单多步骤任务，确认 Agent 维护 Todo 后既有置顶摘要出现；无 Todo 内容时入口仍不常驻。通过前保持 needs-review。

---

## Completed Feature：diff-display-optimization（最终视觉收口）

- Feature: 对话区 `write_file` / `edit_file` 与 OpenCode Diff 改为更简洁的摘要和正文（diff-display-optimization，**已完成**）
- Status: done — 用户在「平衡精简」基础上继续确认：`+N/−N` 需要颜色区分、正文使用单列智能行号、减少说明性文字；源码、测试、Wiki 与状态文件已同步；未 commit。
- 摘要：删除滚动数字里程计、自定义元素和动画；静态 `+N` 绿色、`−N` 红色，仅文字着色且默认可见，无 badge/背景/边框。running count-only partial 可显示统计，但无完整 `text` 时不渲染正文。
- 正文：删除重复标题、路径、统计 chip 与字符级 token/LCS/`<mark>`；行号收敛为单列智能显示（删除行取旧行号，新增行取新行号，上下文取新行号），共享 grid 收敛为“行号 + 代码”两列，继续保留长行横向背景、浅色整行增删背景和 `display: contents`。hunk gap 可见内容仅显示 `⋯`。
- 状态语义：短文案为“新文件 / 已截断 / 无变化”；新建空文件同时显示新文件与无变化。截断尾标记只在 `details.truncated === true` 时移除，合法正文末行即使等于 marker 也不会误删。
- OpenCode：支持 raw 新文件文本与无 hunk pseudo-unified；raw 保留首字符、行号从 1 开始。服务端统一 CRLF/CR，修正尾随换行计数、相同内容 `0/0 + text:''`，真实超限时设置 `truncated:true`；临时测试 helper 未导出，不扩大公共接口。
- Files: `src/lib/local-tools.ts`、`src/lib/diff-view.ts`、`src/index.css`、`src/lib/i18n.ts`、`server/opencode-acp-agent.mjs`、`tests/frontend/diff-view.test.ts`、`tests/server/opencode-acp-agent.test.mjs`、`docs/wiki/src/lib/README.md`；删除 `src/lib/diff-counter.ts` 与 `tests/frontend/diff-counter.test.ts`。
- Verification: 此前全量 `npm run test` → 272 files / 2559 tests 全过；本轮最终视觉收口定向 Vitest 5 files / 119 tests 全过；定向 ESLint 4 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings。
- Boundaries: 未改通用“过程 → 工具组”折叠；未新增依赖；未提交/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。工作区其他 feature 的未提交改动完整保留。
- Docs: 当前模块行为已同步 `docs/wiki/src/lib/README.md`；`design-mockups/diff-display-optimization.html` 保留为历史方案对照，不作为当前规格，故未同步重绘。
- Next step: 建议真机复核 light/dark 下 edit、write 新文件、空文件、长行横向滚动与 OpenCode raw/pseudo-unified；无代码 blocker。

---

## Needs Review Feature：pinned-summary-draggable-capsule（desktop stay + 向下展开）

- Feature: GitToolsPinnedSummary desktop 外点/Escape 保持当前形态，显式 Minimize 才进入 capsule；capsule→panel 从同一 top 向下展开（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 源码、纯函数/契约测试和 wiki 已更新；未 commit。
- 状态转换：desktop panel/capsule 点击外部均 stay；desktop Escape 不安装摘要级 listener，因此无操作且不 preventDefault/stopPropagation。`minimizeDesktopPanel` 只由 panel 标题栏显式 Minimize 调用；capsule 主体打开 panel；panel/capsule 的 X 与顶部 List 完全关闭。mobile/mobileShell 继续 List + fixed panel，外点/Escape/X 关闭，无 capsule/minimize。branch menu 不再因摘要 outside 分支改变 panel/capsule，本轮未新增嵌套菜单 dismiss。
- 向下布局：`pinned-summary-drag.ts` 新增纯函数 `resolvePinnedSummaryLayout` 和具名常量 `PINNED_SUMMARY_PANEL_MIN_HEIGHT=180` / viewport inset 12。panel 优先保持当前 y，把 `viewportHeight - 12 - y` 作为动态 `panelMaxHeight`，复用 panel flex + 内容 `overflow-y-auto`；不再用整屏 panel 自然高度把 y 向上 clamp。仅当下方不足 180px 时向上移到刚好容纳最小高度；viewport 本身更矮时使用全部安全区域。首次定位、panel/capsule 形态切换、window resize、drag 过程/结束与 Inspector resume 复用同一策略；conversation header 默认锚点仍只在首次无位置时读取。
- 尺寸/动画：动态 max-height 通过 `--quickforge-pinned-summary-panel-max-height` 传入且只在 panel mode 更新/消费；`ResizeObserver` 继续读 offset 布局尺寸，panel 展开态用 `scrollHeight + (offsetHeight - clientHeight)` 记录含边框的自然高度，避免 2px morph 误差。observer 在拖动中以 `dragRef.current.current` 而非旧 `positionRef` 解析布局，拖动跨边界、结束/取消后统一由 `finishDrag` 收敛，不会把 panel max-height 回写到起点或令 position/capsule 回归。删除无效 `height: min(max-content, ...)`，依赖 auto + max-height 与 widget 高度变量。panel 内容区始终 `overflow-y-auto overscroll-contain`，branch menu 改在受限内容区内向下展开、宽度随 panel、带 viewport 约束的 max-height/自身滚动，不再为了菜单把普通内容切为 overflow-visible。panel/capsule 子层 `transform-origin: top right`；width/height 220ms 与 reduced-motion 保留。设计 mockup 为历史稿且与本轮语义差异较大，未做小修，wiki 明确源码为准；DESIGN_LANGUAGE 无需更新（仅修正既有几何/交互，无新视觉模式）。
- 图标决策：按已确认的设计原型推荐 B，将 capsule 主体末端展开提示由 `ChevronUp` 改为 `Maximize2`，与 panel 标题栏既有 `Minimize2` 配对。`Maximize2` 放在主体 button 内约 28px 的透明圆形视觉槽中（`aria-hidden`，不是独立 button），默认弱化，仅在主体 hover/focus 时以现有 `group-*` Tailwind 克制增强；顶部 `List`、独立 `X`、点击/拖动/关闭逻辑均不变，无新增 CSS 模式。
- Regression boundaries: Inspector suspension/resume、160ms closing timer、pointer capture/window listeners/body userSelect/rAF cleanup、header 首次锚点、移动端 overlay 行为保持。
- Verification: 图标终审后定向 `npx vitest run tests/frontend/git-tools-pinned-summary.test.ts` → 24 tests 全过（契约锁定 capsule `Maximize2` + panel `Minimize2`、约 28px 非 button/`aria-hidden` 视觉槽、独立 X 与无 `ChevronUp` 残留）；定向 ESLint 2 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。此前终审修复 5 files / 52 tests 与定向 ESLint 4 文件结果继续有效；build 仅既有 KaTeX 字体与 chunk size warnings，`git status` 确认生成产物无状态变化。
- Boundaries: 未新增依赖、未提交/tag/push、未手改生成产物；工作区其他 OOM 等未提交修改完整保留。
- Next step: 完成最终门禁后真机复核 desktop panel/capsule 外点与 Escape 均不变、Minimize 唯一收缩、capsule 展开 top 不上浮且内容在下方空间滚动；通过前保持 needs-review。

---

## Needs Review Feature：pinned-summary-draggable-capsule（首次 header 锚点调整）

- Feature: GitToolsPinnedSummary 无历史位置时改以主对话 header 为首次 desktop 锚点（pinned-summary-draggable-capsule，**待用户复核**）
- Status: needs-review — 最小源码、纯函数测试、契约测试和文档已更新；未 commit。
- 实现：`App.tsx` 在主对话 `<header>` 增加稳定 `conversationHeaderRef: RefObject<HTMLElement | null>`，通过 `initialAnchorRef` 传给 `GitToolsPinnedSummary`；无 `querySelector` 或 Tailwind selector。`pinned-summary-drag.ts` 新增 `resolvePinnedSummaryInitialPosition` 与显式常量 `PINNED_SUMMARY_INITIAL_GAP=10`、`PINNED_SUMMARY_INITIAL_RIGHT_INSET=12`：仅 desktop 且 `positionRef.current` 尚不存在的首次定位读取 header rect，坐标为 `y = ceil(header.bottom) + 10px`、`x = header.right - targetWidth - 12px`；header 不可用时先回退 toolbar root rect，toolbar root 也不可用时再回退 widget rect，最终继续走 `clampPinnedSummaryPosition` 的 12px viewport 安全区。
- 生命周期边界：用户拖动后、panel/capsule 切换、window resize、Inspector suspend/resume 都只 clamp 现有 position，不重读 header；mobile/mobileShell 的 List + fixed panel 不变。实现不含 28/32/56 titlebar 定位常量，真实 header rect 自然适配浏览器/Electron、字号与侧栏宽度。
- 测试：`pinned-summary-drag.test.ts` 真实测试 bottom+gap/right inset 与传入 fallback rect；`git-tools-pinned-summary.test.ts` 锁定 header ref 接线、conversation header → toolbar root → widget rect 回退顺序、仅初始分支读一次、无 querySelector/28/32/56 定位常量、Inspector 恢复不重锚。
- Docs: `docs/wiki/src/components/README.md` 两处与 `docs/wiki/src/lib/README.md` 同步；复用既有视觉模式，不改 DESIGN_LANGUAGE。
- Verification: 定向 Vitest 5 files / 48 tests 全过（pinned-summary-drag 8、git-tools-pinned-summary 24、workspace Inspector request/width 与 mobile fullscreen 回归 16）；定向 ESLint 5 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings，生成产物无 git 状态变化。本次 fallback 措辞收尾另跑相关 Vitest 2 files / 32 tests、feature JSON parse、`git diff --check` 全过；按要求未再次 build。
- Boundaries: 未新增依赖、未持久化位置、未触碰 `dist/`/`package-dist/`/`package-offline/`、未 commit；工作区其他 OOM 等未提交改动完整保留。
- Next step: 真机复核首次打开 panel 与首次缩为 capsule 均在对话 header 下方、主内容右侧内缩且不遮顶部栏；通过后再标 done。

## Completed Feature：browser-oom-first-aid

- Feature: 浏览器渲染进程 OOM 第一步止血——IndexedDbCache 去全量序列化/物化 + subagent 运行期 trace 截尾（browser-oom-first-aid，**已完成**）
- Status: done — 用户确认"页面一直开着导致 OOM"发生在浏览器渲染进程；三路 explore 调研（前端/服务端/Electron）+ 两路补充审计（pi-web-ui message-list 内部实现、单条消息体积链路）定位三层放大后，用户决策"两步走：先零体验风险止血，再做体验无损的窗口化"；本轮完成第一步。
- 根因结论（大白话版见 oom-plain-words.svg）：无典型泄漏，是设计上的无界——消息/工具记录只进不出 + DOM 无窗口化全量渲染（ChatPanelHost.tsx:600 enabled:false 禁用了已实现的窗口化，pi-web-ui MessageList 无原生虚拟化）+ 同一内容多份驻留（messages 数组 + code-block base64 属性/hljs span 树 3-5× + IndexedDB 快照 + subagent store 快照）；放大器为 session-message-cache 每 1.5s flush 的 estimateBytes 全量 JSON.stringify 与 evictIfNeeded getAll 全量物化（~40 会话快照），以及 run_subagent trace 每 150ms 全量 details.messages 重发（O(N²)）。
- 实现 ①：src/lib/indexeddb-cache.ts estimateBytes 改递归粗估（string length+2 / number 8 / 布尔空 4 / 节点 +2 键 +1，深度 16 + seen 防循环回溯删除，异常兜底 0；80 字符串估值 82>60 保住 maxBytes=120 测试口径）；新增实例私有 metaIndex（null 起步）：put 成功后可选链更新、首次 evict 单次 getAll 以 store 重建此后纯内存、get lastUsed 写回成功才同步、delete/clear 维护、非数组容错重试；磁盘格式/LRU 纯函数/API/schema 零改动。
- 实现 ②：server/agent-manager.mjs 新增 SUBAGENT_TRACE_MESSAGES_LIMIT=50，emitSubagentTrace 的 details.messages 截尾 slice(-50) + messagesTotal 总数（同一字面量同一 latestMessages 引用，无口径分裂；Array.isArray 防御），覆盖节流补发/工具边界/finally 全部 update 路径；终态 toolResult（:1799）保持全量；updateRuntimeToolExecution/persist/SSE 转发未动。explore 复核确认前端 update 消费方全部只依赖尾部（traceMessages 过滤、跑马灯尾部 chunk、终态判定逆向扫描），运行中 Inspector 最近 50 条滚动窗、结束全量恢复，体验无损；唯一可感知差异是运行中刷新恢复的 running 快照只含尾部 50 条。
- Wiki: docs/wiki/src/lib/README.md（subagent-run-detail 截尾语义）与 docs/wiki/server/README.md（run_subagent partial trace）同步；纯数据层改动无 UI/视觉变化，DESIGN_LANGUAGE 无需更新。
- Verification: 定向 vitest 5 files / 47 tests 全过（indexeddb-cache 15 含新 2：getAllCallCount===1、冷启动重建淘汰；agent-manager.subagents 11 含新 1：真实驱动 MockAgent 61 条消息，窗口 50/total 61/首元素 trace-message-11/终态全量 61）；ESLint 4 文件 0 问题；node --check；tsc -b；git diff --check；feature JSON parse。explore 独立复核 26/26 复跑通过。
- Boundaries: 未跑全量 test/lint/build；未 commit；未触碰 dist/、package-dist/、package-offline/；未新增依赖；多 tab 并发写缓存依赖现有 Web Locks 单窗口守卫（与改动前等价）；三张分析 SVG（oom-analysis-diagram/oom-browser-renderer/oom-plain-words）为调研产物一并列档。
- Next step: 第二步"智能货架"（恢复消息窗口化 + turn 导航/跳转适配）另行立项，需先 explore 调研 windowed-messages.ts 能力边界与 turn navigation/decorate/process-folding 对全量 DOM 的依赖面；建议真机长会话+长 subagent 运行观察渲染进程内存曲线确认止血效果。

## Completed Feature：project-picker-mkdir-and-roots

- Feature: 项目目录选择器移除 QuickForge 快捷入口并新增「新建目录」功能（project-picker-mkdir-and-roots，**已完成**）
- Status: done — 用户确认两项设计决策：新建目录交互为「当前路径行右侧按钮 + 列表顶部内联输入，成功后直接进入新目录」；mkdir 端点不加 local-only 守卫（与 POST /api/project/path 同性质，Android 远程客户端可用）。
- 实现：`server/routes/filesystem.mjs` 删除 `addRoot('QuickForge', projectRoot)`（projectRoot 保留为 `_activeWorkspaceRoot` 默认值）；提取 `isPathWithinRoots` 纯函数与 `getAllowedRootPaths()`（roots + home 兜底）供 directories 与新端点共用；新增 `POST /api/filesystem/mkdir`——名称校验（禁路径分隔符/`.`/`..`/`\0`/空白 → 400）、parentPath 缺失 400、越界白名单 403、父目录不存在映射 404（assertDirectory 原生 400 语义未动，仅本端点内映射）、EEXIST 409、EACCES/EPERM 403，`fs.mkdir` recursive:false。前端 `project-directory-picker.tsx`：路径行右侧 FolderPlus「新建目录」按钮（sm 以下 icon-only），点击在列表顶部插入内联输入 form（autoFocus、Enter 提交、Esc 关闭清空），成功 `loadDirectory(新路径)` 进入，失败保留输入行 + error 区提示；`creatingFolder` 禁用传播覆盖目录行/parent 行/新建/取消/选择/Escape 关弹窗/遮罩点击；创建中文案用专用 `creatingDirectory`。i18n 中英成对 +4 key。wiki：server/routes filesystem 小节修正 `list`→`directories` 过时端点并补 mkdir 与 roots 说明、src/README picker 条目补能力描述。
- Verification: 定向 vitest 2 files / 21 tests（新 server 12 + 新 frontend 契约 9）全过；定向 ESLint 5 文件 0 error；`node --check`；`npx tsc -b --pretty false`；`git diff --check` 全过。未跑全量 test/lint/build；未 commit。
- Boundaries: 未加 local-only 守卫（用户决策）；allowedRoots 白名单与 directories 共用同一逻辑；不触碰 dist/package-dist/package-offline；工作区其他未提交改动（pinned-summary 等）与本 feature 无关未触碰。
- Next step: 真机冒烟：打开选择项目目录确认快捷入口无 QuickForge；在任意目录点「新建目录」输入名称回车 → 直接进入新目录；重名/非法名/失败时输入行保留并显示错误；创建期间全部控件禁用、Esc/遮罩不关弹窗。

## Completed Feature：pinned-summary-draggable-capsule

- Feature: GitToolsPinnedSummary 顶部 List 常驻、桌面 closed/capsule/panel 三态浮动摘要，并在右侧 WorkspaceInspector 往返时恢复状态和位置（pinned-summary-draggable-capsule，**已完成**）
- Status: done — 已实现真实桌面右侧栏暂停/恢复；用户真机复核验收矩阵通过；未 commit。
- Inspector 往返：App 使用与 `WorkspaceInspector` 一致的 `(min-width: 1024px)`，以 `canSuspendPinnedSummaryOnInspectorOpen` 表达“未来打开 Inspector 是否具备 desktop sidebar suspension/preserve 能力”；仅 `workspaceInspectorOpen && capability` 时保持 `GitToolsPinnedSummary` 挂载并传 `suspended`。`<1024px` 和 `mobileShell` 仍按原条件卸载，保持移动端/全屏 overlay 行为。`suspended` 保留 panel/capsule、position、Todo 展开和智能体折叠。
- Inspector 打开分支：PanelRight 直接按钮、Git Changes 与智能体入口统一按 `canSuspendPinnedSummaryOnInspectorOpen` 分支；真实桌面右侧栏保留 panel，`<1024px`/`mobileShell` overlay 路径在 `setWorkspaceInspectorOpen(true)` 前先 `setGitToolsExpanded(false)`，关闭 Inspector 后摘要不自动重开。PanelRight 关闭分支不额外修改 summary；Commit/Push 始终先关闭。
- 真隐藏与副作用暂停：toolbar root 和 desktop fixed widget 同时使用 `hidden` class/属性、`inert`、`aria-hidden`，不进入布局、Tab 或辅助技术，也不遮挡 Inspector。暂停时不注册 outside pointerdown/Escape、resize/clamp、ResizeObserver/形态定位；进入暂停只结束 drag，清 window pointer listeners、capture、body userSelect、drag/responsive rAF，关闭 branch menu 与 pending focus。不会取消已代表用户明确关闭意图的 160ms close timer，也不使用可被 cleanup 取消的 rAF 去归一化 closing/mounted；timer 在隐藏期间自然完成 `closed => unmounted`。组件最终 unmount 时既有 cleanup 仍会清 timer；不清 position/capsule/expanded，不自动回焦。
- 恢复 clamp：`suspended true→false` 时按当前 `desktopMode` 的 `desktopPanelRef` / `capsuleRef` 目标布局尺寸（offsetWidth/offsetHeight，必要时 rect fallback）对原 position 重新 `clampPinnedSummaryPosition`，维持 12px 安全区；视口未变化通常原位，变化后仅夹取，不调用 openDesktopPanel/minimizeDesktopPanel、不抢焦点。
- 既有三态与拖动保持：desktop capsule 外点 stay、panel 外点 minimize、X close；pointerdown 后由 window 跟踪同 pointerId，越过 4px 才 capture/禁选/suppress click；finish/cancel/暂停/响应式降级/unmount 统一清理。移动端/mobileShell 仍 List + fixed panel，无 capsule/拖动/缩小。
- 测试边界：`pinned-summary-drag.test.ts` 是真实纯函数测试，覆盖 desktop/窄屏/mobileShell suspension 判定，以及以“未来可 suspend/preserve capability”为参数的 desktop preserve vs overlay close 分支，并继续覆盖 clamp/outside/4px threshold。`git-tools-pinned-summary.test.ts` 是源码契约测试，锁定 PanelRight 打开分支 desktop preserve/mobile close、关闭分支不改 summary、摘要 action 条件接线、hidden/inert/aria-hidden、suspension 不清 close timer/不归一化 closing/mounted、unmount 仍清 timer、side-effect gating、marker、恢复 clamp 与 focus cleanup，不是 React 组件挂载/真实点击拖动测试。
- Docs: `docs/wiki/src/components/README.md` 两处同步 suspended 生命周期、Inspector action 与移动端边界；不涉及新视觉模式，DESIGN_LANGUAGE 无需改。
- Verification: Revision 3 最终收口后，相关 Vitest 8 files / 165 tests 全过（git-tools-pinned-summary 23、pinned-summary-drag 6、workspace inspector tabs/width/request、mobile fullscreen、side chat、subagent detail）；定向 ESLint（App/摘要组件/纯函数/两测试）0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check`、`git status` 全部通过/已检查。build 仅既有 KaTeX 字体与 chunk size warnings；status 仅列出本 feature 的 10 个预期文件，无生成产物。前轮完整门禁记录保留：npm run test → 271 files / 2530 passed + 1 既有失败（见 Notes）；npm run lint → 0 errors。
- Boundaries: 无 localStorage、无新增依赖、未把完整摘要状态提升到 App；未触碰生成产物；共享文件中的其他未提交 feature 片段保留。
- Notes: 全量 test 中 `tests/server/cloud/qf-agent-process.test.mjs`「keeps the restart budget bounded when newly isolated identities keep getting rejected」稳定失败，经单文件 stash 对照确认 HEAD 同样失败（该测试仅依赖 `qf-agent-process/auto-approval/network-proxy`，均无未提交改动），属既有失败、与本次无关，未修复未扩大范围；该文件历史另有定时器波动记录（见早前条目）。
- 真机验收矩阵：① closed→打开右栏→关闭仍 closed，且 closing 160ms 内打开右栏不会出现幽灵 capsule；② capsule 拖动后往返原位恢复；③ panel 拖动、Todo 展开/智能体折叠后往返原位与状态恢复；④ PanelRight 鼠标/键盘不预先 minimize；⑤ desktop Git Changes/Subagent 打开并关闭 Inspector 恢复 panel；⑥ `<1024px`/mobileShell 从摘要打开 Git Changes/Subagent 后关闭 Inspector 不自动重开摘要；⑦ Commit/Push 仍关闭；⑧隐藏期间 Escape/外点/resize 不改摘要；⑨拖动中打开 Inspector 后 window listeners/capture/body userSelect/rAF 完整清理；⑩视口变化后恢复保持 12px 安全区且不抢焦点。
- Next step: 无（用户复核通过，已标 done）。

## Completed Feature：p0-subagent-observability

- Feature: P0 Subagent 可观测性——生命周期、AI stream 关联与 SSE 失败日志（p0-subagent-observability，**已完成**）
- Status: done — 不修改 timeout 语义、UI 或 SSE 协议，仅增加最小结构化诊断链路。
- 实现：`run_subagent` execute 将真实 `toolCallId` 透传到 `runSubagent`；profile/task/workspace/model 等前置校验通过后立即生成 `subagentSessionId` 并记录 `started`，后续模型解析、工具创建、system prompt、Agent 构造或 prompt 任一失败均通过终态守卫只记录一个 `failed`；保留 `timeout_triggered`、`parent_aborted`、`settled_after_abort`、`completed` 既有语义。统一字段为 `parentSessionId`、`subagentSessionId`、`toolCallId`、`subagent`、`timeoutMs`、`durationMs`、`toolCalls`，abort 后 prompt settle 另记录 `waitAfterAbortMs`、`outcome`、`abortReason`。失败仅记录 outcome/errorName，不记录完整错误正文。Subagent 内部 AI stream 显式传 `quickforgeInternalLogContext`；`ai-http-logger` 只提取安全白名单关联字段，并在调用 provider `streamSimple` 前删除内部字段，retry/timeout WARN 可关联父/子 session 和 toolCall。session/global SSE 增连接级幂等守卫：同一连接多重 write/socket error 只记录一次 failure WARN，cleanup/release/end 只执行一次；正常 close 只 cleanup、不记录 failure；日志不含 event payload，SSE 帧格式不变。
- Verification: 定向 Vitest 三文件共 47 tests 全过（agent-manager.subagents 10，含真实调用 MockAgent `streamFn` 的内部日志上下文接线断言与 Agent 构造初始化失败 started→唯一 failed；ai-http-logger 21；routes/agent 16，含重复 error 只 WARN/cleanup/release/end 一次）；定向 ESLint 6 个相关源码/测试文件 0 error；`node --check` 三个服务端模块通过；`git diff --check` 通过。未跑全量 test/lint/build；未 commit。
- Boundaries: 不修 timeout/abort settle 语义；不记录 task/context/expectedOutput/messages/system prompt/tool args/results/profilePath/完整错误正文；无前端或协议改动，因此未更新 src/lib/routes Wiki；未触碰生成产物和已有 Subagent UI 改动。
- Next step: 可选真机通过 server log 按 toolCallId 串联 started→terminal 生命周期，并模拟断连确认单连接只产生一次 SSE WARN 与 cleanup。

## Completed Feature：subagent-running-icon-badge

- Feature: Subagent 运行指示器改为 Bot 图标+数量角标并修复菜单 hover 闪烁（subagent-running-icon-badge，**已完成**）
- Status: done — 用户确认「静态 Bot 图标 + 右上角 emerald 数量小角标（无动画）」设计后执行；同时修复流式输出期间悬停运行列表时界面闪烁。
- 实现：`subagent-running-indicator.ts` trigger 子结构由 spinner/count/label 三段改为 icon（模块级 `BOT_ICON_SVG`，与项目 lucide-react v1.11.0 Bot 及聊天 run_subagent 摘要卡 local-tools.ts:539 同款天线+方头+双耳+双眼 SVG，14×14，currentColor；Revision：初版误用 lucide 旧版 bot path，用户反馈后对齐）+ badge（textContent=数量）两段，保持按类名复用 DOM、缺失才重建，每轮仅更新 badge 数字；删除 `subagentRunningIndicatorTriggerLabel` 文案。菜单闪烁主修复：`renderMenuItems` 由每轮 `replaceChildren(heading, list)` 全量重建改为按 runId 就地 diff——heading/list 复用，Map<runId,item> 复用现有元素，仅 label/task 文本、elapsed dataset 与文本、aria-label 变化时更新，onclick 重绑，`insertBefore` 仅乱序时移动，消失 runId 删除；元素身份稳定使流式 decorate 不再打断 :hover。trigger 重建闪烁次修复：trigger 查不到而新建时不再 `removeSubagentRunningIndicatorMenu`，ownedMenu 归属同 panel 时同步 `__quickforgeOwnerTrigger` 为新 trigger 并继续 renderMenuItems，菜单保持打开；dismiss 外点判断与 positionMenu 定位改为读取菜单当前 ownerTrigger，不依赖被替换的旧 trigger 闭包引用。`index.css`：trigger 改 `position:relative; width:2rem; padding:0`，删 spinner（含 dark/reduced-motion 段）与 count 样式，新增 icon（flex 居中）与 badge（参照 `.quickforge-scroll-bottom-badge`：absolute -0.3rem、min-width/height 1.05rem、emerald 背景、2px var(--background) 描边、dark 变体 rgb(52 211 153)/rgb(5 46 31)）；移动端 @media 与 compact 段中 subagent label 隐藏/宽度收缩规则随 label 删除而移除，三控件共用胶囊基础规则保留。测试：更新 icon/badge 断言与 i18n 5 key/CSS badge 契约，新增 3 用例（菜单 item/heading 元素跨 decorate 身份保持、runId 增删与顺序、trigger 重建后菜单保留且 ownerTrigger 更新）。wiki components 两处条目同步。
- Verification: 定向 Vitest 3 files / 109 tests 全过；定向 ESLint（ts 文件）0 error、index.css 被 eslint 配置忽略属预期；`npx tsc -b --pretty false` ✓；`npm run build` ✓（仅既有 KaTeX/chunk 警告）；`feature_list.json` JSON parse ✓；`git diff --check` ✓。未跑全量 test/lint；未 commit。
- Boundaries: 静态图标无动画（用户确认）；badge 样式复用 scroll-bottom-badge 既有视觉模式，未新增设计语言；菜单仍为轻量名称/任务/耗时，详细过程在 Inspector；未修改后端、公共入口与生成产物。
- Revision（文案）：用户要求更简短且中文用「智能体」——TriggerAria/MenuTitle/MenuAria 改为「{count} 个智能体运行中」「智能体运行中 · {count}」「智能体运行中」，英文对应 '{count} agents running'/'Agents running · {count}'/'Agents running'；复验 vitest（含 i18n-language-snapshot）+ eslint + tsc 通过。
- Next step: 真机冒烟：并行 2-3 个 subagent 验证角标数字增减、Bot 图标 Light/Dark 视觉、流式输出期间 hover 菜单不闪、流式中触发 leftControls 重建后菜单不消失。

## Completed Feature：pinned-summary-subagent-sections

- Feature: 置顶执行摘要 Subagent 分组改版为「运行中 / 已结束 · N」简约双小节（pinned-summary-subagent-sections，**已完成**）
- Status: done — 用户确认双小节设计后执行：运行中小节默认展开，已结束小节默认折叠且标题行整行切换；已结束条数随标题展示。后续文案修订（保持国际化）：Subagent 分组标题 i18n 改为「智能体 / Agents」，Git 分组标题改为「Git 工具 / Git Tools」。
- 实现：`GitToolsPinnedSummary` 的 Subagent 分组重写为双小节：分组标题中英文统一「Subagent」；「运行中」小节无折叠、0 条隐藏，行用弱色 `Loader2 animate-spin` + 名称 + task 弱副行，不显示耗时；「已结束 · N」标题行整行 button 切换折叠（`aria-expanded`，ChevronRight/Down size-3.5 弱色），默认收起，关闭弹层的三条路径（外部点击/Escape、toggle、X）均恢复默认折叠、不持久化；已结束行保持 ✓/✗ + 名称 + 静态耗时（Bot fallback）+ task 副行，仍是先关浮层再打开 Inspector Subagent Tab；两组全空时整个分组隐藏，组件空态与 App 挂载条件均纳入运行中列表；分组顺序、分割线、`aria-labelledby` 不变；删除「最近优先」span。数据层新增 `extractRunningSubagentRuns()`，与 `extractLatestTerminalSubagentRuns`（API 不变）共用新抽的 `collectRunSubagentToolCalls` 收集器（按出现顺序 id→args，重复调用块天然去重），仅收集 pendingToolCalls 中的 run_subagent 调用并复用 `buildSubagentRunPayload(args, undefined, true, …)` 构建 running 载荷（canonicalToolCallId/runId=toolCallId，label/name/task 回落一致）；App 在终态列表旁新增 `pinnedSummaryRunningSubagentRuns`（同一 revision 订阅）传入组件；`openSubagentRun` 经 `requestWorkspaceInspector(kind=subagent)`，Inspector 已按 store 取 running 快照，无需适配。i18n：`pinnedSubagentsTitle` 改 Subagent，新增 `pinnedSubagentsRunningSection`/`pinnedSubagentsFinishedSection`，删 `pinnedRecentFirst`。
- Verification: 定向 Vitest 3 files / 113 tests 全过（git-tools-pinned-summary 11、subagent-run-detail 90 含新增 3、model-retry-notice 12）；定向 ESLint 6 文件 0 error；`npx tsc -b` ✓；`feature_list.json` JSON parse ✓；`git diff --check` ✓。docs/wiki/src/components/README.md 三处（L28/L95/L224）已同步双小节描述（实现时曾误判 wiki 无需同步，冒烟后修正）。未跑全量 test/lint/build；未 commit。
- Boundaries: 已结束小节沿用现有最近 3 项（`extractLatestTerminalSubagentRuns` 默认 limit）；运行中行不显示耗时/不加定时器，详细过程由 Inspector Tab 承担；运行中集合以当前消息分支 + pendingToolCalls 为准，pending 中的 run 即使消息流里残留旧 toolResult 也按运行中展示；折叠状态不持久化；未修改后端与生成产物。
- Next step: 用户复核双小节视觉与折叠交互；真机冒烟：运行中 subagent 出现/结束迁移到已结束、点击两种行打开 Inspector、弹层重开恢复折叠、两组全空时分组隐藏、中英文标题。

## Completed Feature：pinned-execution-summary-groups

- Feature: 右上角现有“置顶摘要”按 Git、任务清单、已结束 Subagent 分组显示（pinned-execution-summary-groups，**已完成**）
- Status: done — 用户确认修正版 `design-mockups/execution-summary-groups.html` 后要求执行；实现准确复用顶部工具栏现有 `GitToolsPinnedSummary`，未在 Composer 新建同类摘要。
- 实现：保留 36×36 `List` 触发器、外部点击/Escape/X 关闭和 Workspace Inspector 打开时隐藏的既有规则。挂载条件由“必须 Git 仓库”泛化为 Todo、最近终态 Subagent 或 Git 任一存在，因此非 Git 会话也可查看前两类内容。用户视觉修订后，展开浮层移除顶部总标题与描述，只保留 absolute 右上角 X；实际存在的分组按 Git → Todo → 已结束 Subagent 排列，首组无顶部 margin/分割线，后续组使用紧凑浅色 0.5px 分割线，标题行预留 X 空间；Git 标题中英文均为 `Git`。Todo 复用当前消息分支最新合法 TodoWrite 完整快照，默认 3 项并可展开全部；终态 Subagent 新增 `extractLatestTerminalSubagentRuns()`，仅扫描当前 agent messages，按 toolCallId 配对 assistant 调用与 toolResult，以 `pendingToolCalls` 排除运行中临时结果，复用 `buildSubagentRunPayload`，按终态 timestamp 最近优先、canonical ID 去重并取最近 3 项，不枚举全局 store。App 订阅当前 agent 的 tool/message 相关事件轻量刷新摘要；点击终态项先收起浮层，再打开 Workspace Inspector 详情 Tab。Todo 展开、Subagent 标题右侧“最近优先”、Git changes/branch/menu/commit-push 行为保持；移动端 fixed 全浮层滚动，分支菜单 top/max-height 按 Git 首位成对调整，桌面保持 overflow visible 防裁剪。i18n 中英同步。
- Verification: 用户视觉修订后定向 Vitest 4 files / 125 tests 全过（git-tools-pinned-summary、subagent-run-detail、todo-write-summary、mobile-fullscreen-adaptation）；定向 ESLint 0 error；`npx tsc -b --pretty false` ✓；`feature_list.json` JSON parse ✓；`git diff --check` ✓。按要求未运行 build，未跑全量 test/lint。
- Boundaries: 已结束 Subagent 只显示当前消息分支最近 3 项；运行中项继续留在 Composer 胶囊；任务“查看全部”只在浮层内展开，不跳转独立详情；Inspector 打开期间入口仍隐藏；未修改后端、公共协议或生成产物，未 commit。
- Next step: 真机冒烟：Git/非 Git 会话分别验证三组/单组；完成和失败 Subagent 排序与点击跳转；回滚或切换会话后无旧记录；移动端、Light/Dark、中英文及分支菜单不被裁剪。

## Completed Feature：subagent-running-indicator

- Feature: Composer「完全访问权限」旁显示当前会话运行中的 Subagent 数量，点击具体运行跳转 Workspace Inspector 详情 Tab（subagent-running-indicator，**已完成**）
- Status: done — 用户确认设计稿后要求执行。实现沿用既有 `subagentRunStore` 和 `quickforge:open-subagent-run` 跳转链路，不新增依赖或后端接口。
- 实现：新增 `panel-decoration/subagent-running-indicator.ts`。当前会话运行集合只遍历 `agent.state.pendingToolCalls`，再按 toolCallId 读取全局 store 并筛选 `status=running`，避免跨会话污染；`tool_execution_start/update/end` 后调度 editor 重装饰，终态立即移除。胶囊插在 access 后、plan 前，显示绿色 spinner、数量与「运行中」；重复装饰时复用现有 spinner/count/label DOM，仅更新数量和文字，避免 CSS 旋转动画被反复重启造成闪烁；0 项隐藏，移动端/容器 compact 时隐藏文字。点击后创建 body-level fixed 菜单（名称、任务、每秒耗时），支持 Composer 菜单互斥、外部点击/Escape 关闭、resize/scroll 重定位、DOM 重挂更新与卸载清理；点击项读取 store 最新 payload 后派发既有事件打开 Inspector Subagent Tab。Side Chat、readOnly、disabledControls 不显示。i18n 中英 +6 key，CSS 对齐现有 Composer 胶囊/弹层视觉并支持 reduced motion。
- Verification: 定向 Vitest 5 files / 111 tests 全过（新增 7，回归 104）；eslint 改动源码/测试 0 error；`npx tsc -b --pretty false` ✓；`npm run build` ✓（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` ✓。未跑全量 test/lint。
- Boundaries: 指示器仅表示父会话仍在 `pendingToolCalls` 中且 store 快照为 running 的运行；store 缺快照时宁可不显示。列表本次保持轻量（名称/任务/耗时），当前工具的详细过程仍在 Inspector。未修改后端与公共 store payload；未 commit。
- Next step: 真机冒烟：并行启动 2-3 个 subagent，确认 access 后出现数量；点击展开并打开不同 Inspector Tab；逐个完成后数量递减并在 0 时消失；侧栏压窄时仅显示 spinner+数量。

## Completed Feature：model-stream-safe-retry-policy

- Feature: 模型流安全重试策略——仅首个实质事件前透明重试，避免回复中途重复运行（model-stream-safe-retry-policy，**已完成**）
- Status: done — 用户真机反馈模型回复会“中途重复运行”。根因是上一版允许流已产出实质内容后仍因 idle 超时从零重建整条模型请求，导致生成/工具调用重复执行、内容重写与重复计费。用户决策改为安全优先：仅零实质内容阶段自动重试。
- 实现：`server/ai-provider-options.mjs` 将默认预算调整为首个实质事件 90s、已有内容 idle 180s、total 20min；`server/ai-http-logger.mjs` 将 `MAX_STREAM_RETRIES` 收紧为 2，并以 `!hasSubstantiveEvent` 作为透明重试硬门槛，已有实质内容后的 idle timeout 直接失败，不再自动重跑；保留首事件前重试进度与恢复上报。三份测试覆盖预算、最多 2 次零内容重试、已有内容不重试、恢复事件及前端源码契约；wiki server 与 src/components 同步策略和提示边界。
- Verification: 定向 `npx vitest run` 7 files / 60 tests 全过；定向 ESLint 0 error；`node --check server/ai-provider-options.mjs` 与 `server/ai-http-logger.mjs` 通过；`npx tsc -b` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size warnings）；`git diff --check` 通过。未跑全量 `npm run test` / `npm run lint`。
- Boundaries: 首事件前上游可能已开始处理但尚未返回，透明重试仍可能产生重复计费，无法完全消除；收到实质内容后若网络停滞会直接报 idle timeout，由用户决定是否重新发起；total timeout 仍不重试；Side Chat/后台任务既有展示边界不变；未 commit。
- Next step: 真机观察弱网、大上下文 prefill 与长工具回合：确认不再出现“中途重复运行”，同时关注 90s 首事件预算是否误杀、180s 已有内容 idle 是否合适。

## Completed Feature：subagent-running-indicator-design

- Feature: Composer「完全访问权限」旁显示 Subagent 运行数量，并从列表跳转 Inspector 详情 Tab 的 HTML 设计稿（subagent-running-indicator-design，**已完成设计**）
- Status: done — 用户确认位置为「完全访问权限」旁，跳转目标为 Workspace Inspector 详情 Tab。本轮只做设计稿，不修改功能源码。
- 设计：新增 `design-mockups/subagent-running-indicator.html` 自包含演示。Composer 控件顺序为「+ / 完全访问权限 / Subagent 运行胶囊 / 计划」；运行胶囊对齐现有 2rem、999px 胶囊视觉，显示绿色 spinner、数量和“运行中”文字；0 个运行时淡出隐藏，窄模式收缩为 spinner+数字。点击胶囊向上展开运行列表，展示 agent 名、任务摘要、当前工具跑马灯和递增耗时；点击列表项滑入模拟 Inspector 详情面板。工具栏支持 light/dark、中文/英文、0/1/2/3 数量及宽/窄切换，支持 `prefers-reduced-motion`。
- Verification: Node 检查必要结构、无外链资源、内嵌脚本语法通过；`git diff --check` 通过；Playwright 实测默认布局、弹层、运行项→Inspector、0 数量隐藏、Dark 主题与窄模式均正常。仅 HTML 设计稿，未跑 npm test/lint/build。
- Boundaries: 未实现运行数订阅/会话过滤/实际 `quickforge:open-subagent-run` 派发；页面内已注明实际实现时需调整 `panel-decoration/agent-access-menu.ts` 的 plan 排序逻辑，才能让新指示器紧贴 access 按钮。未修改架构或源码行为，docs/wiki 无需更新；未 commit。
- Next step: 用户复核设计稿；确认后另开实现阶段 feature，补运行中集合 API/会话作用域、Composer 装饰挂载、Inspector 跳转与测试。

## Completed Feature：sse-unreachable-tiered-notice

- Feature: 后端不可达提示分层升级——Tier1 琥珀双行行内提示（+立即重试）→ 持续 ≥30s 升级 Tier2 composer 上方常驻条（断开时长+恢复指引按环境排序），恢复态 restarted 显示 4s（sse-unreachable-tiered-notice，**已完成**）
- Status: done — 起因：用户实测「后端服务不可达（健康检查失败）/ 8s 后重试」后反馈交互不够友好。诊断：unreachable 复用最弱的灰色 spinner 样式（视觉层级错位）、无操作入口、滚动后离开视口、无恢复指引。用户确认方案 A（分层升级，design-mockups/unreachable-notice.html）+ 30s 阈值 + 指引按环境自动排序。
- 实现：`server-agent.ts` reconnecting 状态新增 `unreachableSince` 时间戳；`reconnect-notice.ts` Tier1 改琥珀双行（主行三角图标+标题+立即重试按钮，副行健康检查失败+倒计时），≥30s 自动让位 Tier2；新 `panel-decoration/unreachable-strip.ts` Tier2 常驻条（composer dock 前插入、滚动容器外恒可见、断开时长 45s/1m 05s 格式、恢复指引两行=环境对应动作+日志、展开状态 sync 重挂保留）；ChatPanelHost 仅主聊天挂载；index.css 复用 failed/persist-degraded 琥珀配方零新 token；i18n 中英 +8 key、删 1 个被取代 key。
- Revision（用户反馈「恢复指引文字太多」）：展开区由 5 行按环境排序改为 2 行（环境对应动作 + 日志），删除「自动重连」行与 sseUnreachableHelpAuto key，四条指引文案缩短；strip 的 helpRowOrder→helpRows 过滤逻辑、测试改过滤断言、mockup/wiki/feature_list 同步。
- Verification: 定向 vitest 3 files / 82 tests 全过（unreachable-strip 新建 12 例：阈值/无广播自动出现、时长格式、环境排序、展开记忆、destroy 清理）；eslint 9 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。
- Boundaries: Tier2 恢复时直接移除（无离场动画）；unreachableSince 缺失时行内提示不隐藏（防御边界）；Tier1 副行倒计时到 0 显示 0s（完整句式，与 Tier0 独立倒计时清空行为不同属有意）；Side Chat/分享页不挂（同现状）；未 commit。
- Next step: 真机冒烟：杀后端 → 几秒内 Tier1 琥珀双行+按钮 → 持续断开 30s 后升级 composer 常驻条（展开指引看环境排序）→ 重启后端 → 常驻条消失 + 绿「已重新连接 · 服务已重启」显示 4s；弱网（health 通）维持 n/10。

## Completed Feature：chat-compact-composer-on-narrow-chat-area

- Feature: 对话区被左右侧栏挤压变窄时 Composer 控件 icon-only 紧凑模式（chat-compact-composer-on-narrow-chat-area，**已完成**）
- Status: done — 起因：用户需求中间对话区被左右侧栏拖宽挤压变窄时（viewport 宽度不变，`@media` 视口查询不触发），Composer 输入框控件应收起文字只留 icon（复用移动端紧凑形态）。
- 实现：① `ChatPanelHost.tsx` 模块级常量 `CHAT_COMPACT_WIDTH_THRESHOLD=640`（控件行极限约 530px+余量）/`CHAT_COMPACT_WIDTH_RELEASE=672`（32px 滞回防拖动抖动），新增 useEffect 以 ResizeObserver（`typeof` 防御式检查，vitest node 环境无 ResizeObserver，先例 WorkspaceInspector matchMedia）监听宿主 div `contentRect` 宽度：<640 挂 `quickforge-chat-compact`、≥672 摘除、区间内保持现状。② `index.css` 在移动端 `@media (max-width:768px)` 块（:5318 结束）之后新增 `.quickforge-chat-panel-host.quickforge-chat-compact` 段（+68 行）：agent-access/model-trigger 照抄移动端规则（收 2rem、label/chevron 隐藏、span.ml-1 sr-only、thinking 徽标隐藏），并补齐移动端没有的 plan（`> span` 只隐藏无 class 文字 span，svg icon 专用 class 不受影响）、opencode-config（label+chevron 隐藏）、opencode-mode（label 隐藏，icon 来自 model-trigger::before）三控件同样收 2rem；三 class 选择器特异性高于 @media 内两 class 规则且两态值一致，移动端零回归；未改动 @media 块内任何规则。③ 新增 `tests/frontend/chat-compact-controls.test.ts`（9 用例源码契约：阈值常量/ResizeObserver 防御/classList add/remove 滞回分支/CSS 五控件覆盖/@media 既有规则回归守卫；ruleFor 前剥 CSS 注释、`:is()` 含逗号规则改精确文本断言）。④ wiki `src/components/README.md` panel-decoration 段补一条紧凑模式说明。
- Verification: 定向 vitest 8 files / 48 tests 全过（新 9 tests）；eslint 改动 2 文件 0 error；npx tsc -b ✓；npm run build ✓（仅既有 KaTeX 字体与 chunk size 警告）。未跑全量。
- Boundaries: + 按钮、send/stop 本就是 2rem 纯 icon 无需处理；side chat 复用同一宿主，窄面板下同样进入紧凑（合理行为）；宽度在 640-672 区间保持现状（滞回有意为之）；空态聊天（quickforge-chat-panel-empty-host）与常驻 composer 同一宿主子树，紧凑 class 同样生效；未 commit。
- Next step: 真机冒烟（拖宽左右侧栏把对话区压到 <640px 控件应收成 icon-only，拖回 ≥672px 恢复文字；移动端窄视口行为不变）。
- Revision（本轮）：修正紧凑态布局回归——控件行恢复 `justify-content: space-between`，因此左侧控件组与右侧控件组仍左右分开；只对右侧末尾组覆盖 `gap: 0.5rem`，模型/思考等级槽位保持 2rem，发送/停止保持 `margin-left: auto`。`chat-compact-controls.test.ts` 增加对应契约断言；定向 Vitest 12/12、ESLint、tsc -b、git diff --check 均通过。

## Completed Feature：workspace-inspector-dynamic-width

- Feature: Workspace Inspector 拖动宽度动态上限（workspace-inspector-dynamic-width，**已完成**）
- Status: done — 起因：用户需求右侧 Workspace Inspector 面板拖动范围更大。确认方案：最小 340 不变；上限改动态 max(340, min(1200, 视口宽*0.75))（参照 ChatSidebar getSidebarMaxWidth/clampSidebarWidth 模式）；超宽屏封顶 1200px；自动展开仍固定 640。
- 实现：`WorkspaceInspector.tsx` 常量区 MAX 640→1200，新增 RATIO=0.75、AUTO_EXPAND=640 与模块级 `getInspectorMaxWidth()`/`clampInspectorWidth()`；readPersistedInspectorWidth 与 resize() 拖动 clamp 走 clampInspectorWidth；expandInspectorToMax 改用 AUTO_EXPAND_WIDTH（行为不变 640）；全屏退出恢复 maxWidth、aside 行内 maxWidth（保持三元结构契约）、separator aria-valuemax 改 getInspectorMaxWidth()；新增 window resize 同步 effect（fullscreen/mobileOverlay 跳过，已存宽度自动夹回上限内）。新增 `tests/frontend/workspace-inspector-width-range.test.ts` 源码契约测试；wiki src/components README 同步宽度说明。Storage key 沿用 v2 不变。
- Verification: 定向 vitest workspace-inspector-width-range（新 6 tests）+ mobile-fullscreen-adaptation（3 tests）全过；workspace-inspector-tabs 回归 19 tests 过；eslint 改动 2 文件 0 error；tsc -b ✓；build ✓（仅既有警告）。未跑全量。
- Boundaries: 窄视口（mobileOverlay）/全屏模式不参与宽度 clamp（按现状全屏覆盖布局）；自动展开目标是固定 640 而非动态上限（保持既有行为）；localStorage 旧值无需迁移（读取时即被重新夹取）。
- Next step: 可选真机冒烟（宽屏拖到 >640px、窗口缩窄后宽度自动收缩、打开 reader/browser 仍展开到 640）。

## Completed Feature：browser-single-window-guard

- Feature: 浏览器严格单窗口守卫——Web Locks 抢锁，第二个窗口只显示拦截页并尽力聚焦已有窗口（browser-single-window-guard，**已完成**）
- Status: done — 起因：用户问「浏览器打开能否只允许开一个窗口？开多个 SSE 会堵塞的吧」。双 explore 并行调研澄清：服务端 SSE 是单进程 EventEmitter 广播（无锁无队列、每连接独立 res.write），**不存在服务端互相阻塞**；真实堵塞是浏览器 HTTP/1.1 同源 6 连接池被每窗口 2-4 条常驻长连接占满（channels/events + agents/events（生产同源，仅 dev 直连 32176 绕开）+ Side Chat NDJSON fetch + 设置页 channels-settings-tab.ts:179 额外再开一条 channels/events），普通 API 全部排队——与 git-status-connection-pool-guard 当年诊断同一机制。
- 用户决策：① Web Locks 方案；② 检测到第二窗口时尽力自动把已有窗口带到前台（浏览器安全模型禁止脚本聚焦非自己打开的窗口，改为由已有窗口收到 BroadcastChannel 通知后自行 `window.focus()` + 标题闪烁兜底）；③ 严格单窗口、不提供「在此窗口继续使用（接管）」逃生门，因此旧窗口永远正常运行、不存在让位场景。
- 实现：① `src/lib/window-guard.ts`（257 行）——`acquireAppWindowGuard`：`navigator.locks.request(LOCK, {ifAvailable:true}, cb)` 抢锁，持锁时回调 `await` 永不结算的 promise（锁持有到页面卸载自动释放），成功判定靠回调内 acquired 标志经 acquiredPromise 在 `Promise.race` 胜出（不依赖永不结算的 request promise）；ifAvailable 拿不到锁（cb 收到 lock 为 null、request promise 随即结算）→ 同窗口刷新竞态按 400ms×2 重试（共 3 次尝试）后才判 blocked；Web Locks/BroadcastChannel 任一不可用 → unsupported 降级放行。持锁后 `startWindowFocusResponder` 监听专用频道 `quickforge-window-guard`，收到 focus-request → `window.focus()` + 「● 」前缀标题闪烁 5s（800ms 交替，重复请求重置截止计时）；`requestExistingWindowFocus` 广播后立即 close。全部依赖可注入单测。② `src/components/WindowGuardNotice.tsx`：全屏拦截页（内联 SVG 不依赖 LucideProvider、t() 双语、复用 Button 与既有 token、不 import App、不发任何 /api）。③ `src/main.tsx`：渲染前 `await acquireAppWindowGuard()`，blocked 先自动广播一次 focus 请求再只渲染拦截页；granted/unsupported 原样渲染 App（SW 注册/错误兜底/补丁原位不动）。④ i18n 中英成对 3 key；i18n import 时以 `browserDefaultLanguage()` 同步初始化，blocked 场景 t() 安全可用。⑤ wiki 3 处同步。
- Verification: 定向 vitest window-guard 10 tests（6 行为 + 4 源码契约）主 Agent 复核通过；i18n 回归 3 文件 31 tests 全过；eslint 5 文件 0 error；tsc -b 通过；npm run build 通过（仅既有警告）。未跑全量。
- Boundaries: ① 拦截页语言用浏览器默认语言（i18n import 时同步初始化；用户在设置里选了与浏览器不同的语言时拦截页显示浏览器语言，3 条文案的小妥协，换来拦截页零 /api 请求）；② Electron（5177 独立源）/ Android 壳 / 隐身窗口 / 不同浏览器 profile 为独立锁空间，天然互不拦截（它们的连接池也彼此隔离，无堵塞风险）；③ blocked 窗口仍会下载主 bundle（main.tsx 静态 import App 是有意的 HMR 设计，未改为动态 import）；④ Web Locks 在持锁窗口崩溃/关闭时由浏览器自动释放，无接管/让位机制（用户决策）。
- Notes: 同一根因的单 tab 内连接数优化候选（`channels-settings-tab.ts:179` 设置页常驻期间额外再开一条 channels/events SSE，可改为复用 App.tsx 的全局连接）记为潜在后续 feature，本次未动。
- Revision（用户真机反馈「点击切换到已有窗口不跳转、旧窗口完全没反应」）: 根因是双重浏览器限制——① 旧窗口在 BroadcastChannel message 回调中调 `window.focus()` 无 user activation，Chrome 防焦点劫持策略静默忽略；② 后台标签 setTimeout 被深度节流（低至 1 次/分钟），原实现首个标题变化要等 800ms 定时器 → 闪烁也完全不可见。修复：① `startWindowFocusResponder` 收到请求**立即**置「● 」标题（不依赖计时器，重复请求重置闪烁相位与截止）；② 新增系统通知聚焦路径——`Notification.permission === 'granted'` 且 `isSystemNotificationsEnabled()`（复用 system-notifications 开关，未复制逻辑）时 `new Notification`（`tag: quickforge-window-guard` 去重、10s 节流 `WINDOW_GUARD_NOTIFICATION_THROTTLE_MS`，标题闪烁不受节流），`onclick` close + focus（**通知点击自带 user activation，聚焦可靠**）；构造器不可用/抛错静默降级；③ focus 事件兜底：用户切回窗口时若闪烁已超截止立即恢复原标题（后台节流下截止定时器可能迟到，保证不留脏 title）；④ `WindowGuardNotice` 点击按钮后本地 state 显示 `windowGuardSwitchHint` 引导文案（系统通知或任务栏 ● 标记）。i18n +3 中英 key（windowGuardNotificationTitle/Body/SwitchHint）；window-guard import system-notifications（测试补 pi-web-ui/@capacitor/core 传递依赖桩）。通知未带 icon（观感小项未处理）。复验：vitest window-guard 10→15 用例全过（主 Agent 复核）+ i18n-language-snapshot/system-notifications 回归 20/20 + eslint 0 error + tsc -b + build ✓。
- Revision 2（用户决策「算了，就简单提示吧，也不显示跳转按钮，按钮改成关闭当前页面」）: 移除整套切换链路——删除 focus responder（系统通知/标题闪烁/focus 事件兜底）、BroadcastChannel 协商（WINDOW_GUARD_CHANNEL_NAME/startWindowFocusResponder/requestExistingWindowFocus）、isSystemNotificationsEnabled/t/randomId import；`window-guard.ts` 收缩为 118 行纯锁守卫（unsupported 判定仅看 navigator.locks；clearTimeout 注入链因 sleep 只注册从不取消、无调用路径一并删除，仅保留 setTimeout）；`WindowGuardNotice` 按钮改「关闭当前页面」（onClose 默认 `window.close()` 可注入），点击后显示 `windowGuardCloseHint` 手动关闭引导（浏览器不允许脚本关闭手动打开的标签页；成功关闭时页面消失、提示不可见，无需检测）；`main.tsx` blocked 分支不再自动广播，直接渲染拦截页；i18n 删 4 key（windowGuardSwitchButton/SwitchHint/NotificationTitle/NotificationBody）增 2 key（windowGuardCloseButton/CloseHint），Description 微调衔接关闭按钮（中英同步）；测试收缩至 10 用例（删通知/闪烁/BroadcastChannel 用例与传递依赖桩，unsupported 新语义：locks 可用即可）。复验：vitest window-guard 10 + i18n-language-snapshot 2 全过（主 Agent 复核）、eslint 0 error、tsc -b、build ✓；全仓搜索确认 src/ 无 requestExistingWindowFocus/startWindowFocusResponder/windowGuardSwitch/windowGuardNotification 残留。附带发现（未处理）：docs/wiki/src/components/README.md 中 ErrorBoundary.tsx 行数目录树与详细条目不一致（53 vs 44，既有问题）。
- Revision 3（用户真机实测「点击关闭按钮是无效的。所以按钮也不要了。有个提示就好了」）: `WindowGuardNotice.tsx` 再收缩为 34 行纯静态提示——删除「关闭当前页面」按钮、`useState`/`Button` import 与 `window.close()`（浏览器不允许脚本关闭手动打开的标签页，`window.close()` 对手动开的窗口必然静默失败，按钮已无意义）；仅保留内联 SVG 图标 + 双语标题/描述，文案引导用户关闭本窗口并回到已有窗口。i18n 删除 windowGuardCloseButton/windowGuardCloseHint（中英成对，grep 无残留）；测试契约同步（无按钮/无 window.close/无 useState，removedKeys 增 Close×2）；wiki src/components 两处条目同步。复验：vitest window-guard + i18n-language-snapshot 全过、eslint 0 error、tsc -b、build ✓。
- Next step: 真机复测（开第二个窗口只见纯提示卡片：图标 +「QuickForge 已在另一个窗口打开」+ 引导文案，无任何按钮；关掉第一个窗口后刷新第二个窗口应能正常接管运行；Web Locks 不可用的旧浏览器放行）。

## Completed Feature：sse-health-probe-notice

- Feature: SSE 重连健康探测——后端被杀时 UI 显示「后端服务不可达（健康检查失败）」并无上限持续自动重试 + 恢复后 bootId 对比提示「服务已重启」（sse-health-probe-notice，**已完成**）
- Status: done — 起因：用户反馈后台被杀后前端只显示「重新连接中… 3/10」约 3 分钟才进失败态，且无法区分「后端死亡」与「弱网」；前端运行期无任何 /api/health 消费（仅关于页使用）。用户确认方案：A（重连失败尽早探测 health）+ 顺带服务已重启提示。
- 实现：`src/lib/server-agent.ts` GlobalAgentSseClient 重连期间每次调度失败后 single-flight 探测 /api/health（SSE_HEALTH_PROBE_TIMEOUT_MS=5s，异常/超时=不可达，baseUrl 跟随直连/代理切换，结果晚于状态切换到达时仅更新 bootId 基线）；不可达时 noteReconnectAttempt 豁免 10 次上限持续退避重试（封顶 30s，health 恢复且已超上限则照常进 failed），reconnecting 状态携带 unreachable:true；每次 onopen 探测 bootId，与基线不同补播 connected{restarted:true}（首连仅记基线）。`reconnect-notice.ts` unreachable 态切换文案 sseServerUnreachableLabel、隐藏 n/10 计数、保留 Xs 后重试倒计时；restarted 补播升级文案 sseReconnectedRestarted 并重置淡出计时器（已 dismiss 则忽略）。i18n 中英成对 +2 key；SseConnectionStatus 纯增量扩展（grep 确认消费方仅 reconnect-notice.ts）。
- Verification: 定向 vitest 2 files / 67 tests 全过（server-agent 新 5 例：unreachable 超上限持续重连、health 可达 10 次后照常 failed 回归、bootId 变化/相同、fetch 抛错/超时；reconnect-notice 新 3 例）；model-retry-notice 相邻回归 12 tests 过；eslint 5 个改动文件 0 error；tsc -b ✓。未跑全量。
- Boundaries: 「不可达」不区分「进程死」vs「彻底断网」（浏览器端两者都是 health 不通，无法分辨）；restarted 补播若恢复提示已淡出移除（2.2s 后）则忽略；Side Chat/分享页本就不挂该提示，未扩展；首次连接多一次 /api/health 请求（记录 bootId 基线）；未 commit。
- Next step: 真机验证：杀掉后端 → 界面几秒内切「后端服务不可达（健康检查失败）」且持续自动重试；重启后端 → 自动恢复「已重新连接 · 服务已重启」；弱网（health 通 SSE 断）→ 维持「重新连接中… n/10」。

## Completed Feature：session-switch-no-auto-preview-tab

- Feature: 切换 session 不再自动弹出预览 tab 与右面板（session-switch-no-auto-preview-tab，**已完成**）
- Status: done — 起因：用户反馈切换项目内 session 时 tab 自动打开。根因两条：① 面板开合状态按 (projectId, sessionId) localStorage 恢复，切回曾展开的 session 自动开面板；② 自动预览 effect 对恢复会话的全部历史 present_files 自动弹 tab 并强制开面板，sessionStorage 签名去重只覆盖浏览器标签页生命周期，冷启动后首次切换仍弹。
- 实现：① 删除 `src/hooks/useWorkspaceInspectorOpenState.ts`（及其测试），`workspaceInspectorOpen` 改 `useState(false)`——页面生命周期内默认收起、仅用户手动或自动预览请求打开；tab 列表仍按 (projectId, sessionId) 持久化恢复（WorkspaceInspector 重建逻辑不变）。② `artifact-preview-utils.ts` 新增 `collectToolResultToolCallIds` / `isNewlyPresentedArtifact` 纯函数；App.tsx 在自动预览 effect 前新增附着时刻快照 effect（restore 返回时消息已同步填充），历史门控仅放行「附着后新发生」的 present_files；删除 sessionStorage 去重，保留内存签名去重。
- Verification: 定向 vitest 4 files / 50 tests 全过（新 auto-preview-fresh-present 8 用例）；eslint 0 error；tsc -b ✓；build ✓（仅既有警告）；无残留引用。未跑全量。
- Boundaries: 缓存命中后后台校准补尾的 toolResult 会视为新产物（罕见、可接受，代码注释已说明）；live present 仍会 requestWorkspaceInspector 强制开面板（保留的预期行为）；用户浏览器中残留的旧 `quickforge:workspace-inspector-open:v1:` key 不再读写、无需迁移；未 commit。
- Next step: 可选真机冒烟（切回曾展开面板的 session 面板不再自动开；重启应用后首次切换含 present_files 的旧 session 不再弹 tab；新会话中 AI present 文件当次仍正常弹出）。

## Completed Feature：persist-skip-message-deep-clone

- Feature: 持久化路径消除全量 messages 双重 structuredClone 深拷贝——CPU 削减，事务边界不变（persist-skip-message-deep-clone，**已完成**）
- Status: done — 起因：/restore 偶发慢分析发现写路径每次 persist 对全量 messages 做两次深拷贝（synchronize 整 state 深拷贝 + normalizeRecord 预编码旁路仍深拷贝），replace 模式下与消息量线性相关的同步 CPU 突刺叠加在事件循环上。
- 实现：`server/session-state-service.mjs` — synchronize() 改「深拷贝 body + messages 浅拷贝」重组；savePairChunked() 入口浅拷贝冻结快照（plan 与所有编码批次读同一冻结数组，torn-read 防护）。`server/sqlite/session-state-repository.mjs` — normalizeRecord() 在 messagesEncoded 已提供时同样 body 深拷贝 + messages 浅拷贝（该旁路 messages 仅同步读长度对齐，写库内容为编码瞬间冻结的不可变字符串）；其余路径保持全量深拷贝。事务边界/锁/CAS 零改动。
- Verification: 定向 5 files / 95 tests 全过（新增：不可克隆探针证明旁路不再深拷贝；torn-read 防护——编码 yield 间隙 push+原地改已编码对象，写入仍为调用时快照，修复前会失败）；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- Boundaries: 未动事务分片/worker 线程（记录在案的待定升级项，待 200ms 慢日志量化残余 INSERT+COMMIT 分布再决定）；非数组 messages 路径与同步 savePair 全量深拷贝行为保留。
- Next step: 观察慢日志 `persist took Xms` 分布变化；若残余仍集中在事务 COMMIT 段，再评估 worker 线程方案。

## Completed Feature：mcp-restore-nonblocking

- Feature: restore 非阻塞 MCP——连接快照构建工具 + 后台重连 + 工具集变更刷新会话 + 启动预热（mcp-restore-nonblocking，**已完成**）
- Status: done — 起因：/restore 偶发慢根因之一为 MCP 重连挡在关键路径（error+过 30s 冷却同步等待 connect ≤15s + listTools ≤15s，single-flight 扩散到所有并发方）；启动无预热；disconnected 不自动重连。
- 实现：registry 增加 waitForConnections:false 快照模式 + reconnectDisconnected + subscribeMcpToolsetChanged 签名变更通知；agent-manager 的 createServerTools/createAgent 透传 mcpToolsMode，restoreAgentUnlocked 走 cached，模块级订阅变化后调现成 refreshAllSessionTools()（SSE state 推送新工具，无死循环）；index.mjs listen 回调预热（已确认覆盖 CLI/SDK/Desktop/Android 全入口）。新会话/subagent/工具调用保持 await 语义。
- Verification: 定向 12 files / 63 tests 全过（registry 3 新用例 + restore cached 行为断言 + 11 个测试文件 mock 补导出）；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- Boundaries: restore 后首个回合若恰好用到尚未重连完成的 MCP 工具，该工具调用按现状 503 报错自愈（重连完成后经工具集通知重建会话工具）；未改 callMcpTool/管理路由语义。
- Next step: 真机观察 restore durationMs（debug 日志）不再出现 MCP 重连量级的长尾；MCP server 掉线后恢复会话应能在后台重连完成后自动拿到工具。

## Completed Feature：agent-idle-timeout-10min

- Feature: Agent 空闲逐出时长 30 分钟收紧到 10 分钟（agent-idle-timeout-10min，**已完成**）
- Status: done — 用户反馈「冷恢复：30 分钟 idle 被 destroyAgent 踢出内存……缓存不要设置这么长，10 分钟就够了」。定位：`server/agent-manager.mjs:270` 常量 `IDLE_TIMEOUT_MS`（硬编码，无环境变量覆盖），唯一消费点 `resetIdleTimer()` 超时后调 `destroyAgent` 逐出内存会话；L1864 逐出日志以 `${IDLE_TIMEOUT_MS / 1000}s` 派生自动跟随，无需另改。
- 实现：仅一行 `30 * 60 * 1000 // 30 minutes` → `10 * 60 * 1000 // 10 minutes`。`idleRetention='always'`（ACP 会话）仍永不逐出；`touchSession` 各续期入口行为不变。
- Verification: node --check ✓；npx eslint 0 error；动态 import 冒烟 ✓；git diff 确认仅 1 行。tests/ 无该常量断言（grep 零匹配），未跑全量。
- Boundaries: 未动终端 PTY 断线保留 30 分钟（`RECONNECT_GRACE_MS`，`QUICKFORGE_TERMINAL_RECONNECT_MS` 可覆盖）与 ask_user 30 分钟超时（`ASK_TIMEOUT_MS`）——均为独立语义；`dist/`、`package-dist/`、`package-offline/` 生成产物未触碰；docs/wiki 无该时长描述、无需更新；未 commit。
- Notes: 收紧后冷恢复（`restoreAgent` 全量 `assembleState`）会更频繁触发，大会话首访尖峰（见 `docs/architecture/session-sqlite-migration-design-review.zh-CN.md` P6）出现频率升高，属预期行为变化而非代码风险。
- Next step: 无 blocker。

## Completed Feature：server-process-error-guards

- Feature: 服务器进程级异常兜底——uncaughtException 记录后优雅关闭退出、unhandledRejection 仅记录继续运行，后台不再无声死掉（server-process-error-guards，**已完成**）
- Status: done — 用户报告后台服务无声退出：8/27 23:10:29 日志断档（无错误、无优雅关闭标记、无系统重启事件），8.5 分钟后新实例才被拉起。根因：server/index.mjs 仅注册 SIGINT/SIGTERM，无 uncaughtException/unhandledRejection 处理器；服务器由 CLI 以 detached + stdio:'ignore' 启动，未捕获异常的默认 stderr 堆栈被丢弃，崩溃在 server-*.log 零痕迹。
- 实现：① 新增 `server/utils/process-error-guards.mjs` — `createProcessErrorHandlers({onFatalError, exitProcess, shutdownTimeoutMs=5000})` 返回纯处理器：uncaughtException 走 fatal 路径（re-entrancy 守卫 → `logger.error('Uncaught exception:', error, {fatal})` 含完整 stack → best-effort 优雅关闭 `Promise.race` 5s 上限、失败记 'Fatal shutdown failed:' → `flushLogger()` → `exit(1)`，先落盘再退出）；unhandledRejection 非fatal（仅记录：Error 取 `.stack`、非 Error 经 `util.inspect`；不 flush——flushLogger 会关闭日志流、不退出、不触发 onFatalError）。`installProcessErrorHandlers(options)` 向 process 注册两监听。② `server/index.mjs` 在模块级状态声明后、首个启动逻辑前（:101）尽早注册，覆盖顶层求值期与 `await ensureStorage()` 启动期异常窗口（`stopQuickForgeServer` 为 hoisted 声明、`shutdownRuntime` 对未启动服务防御、`closeHttpServer` 未 listen 安全）。③ 文档：wiki server/README（index.mjs bullet + 行数 1031）、server/utils/README（新模块条目）、logging-design §5 埋点表 +1 行。
- Verification: 定向 `npx vitest run tests/server/utils/process-error-guards.test.mjs` 6/6（含 flush-before-exit 与 re-entrancy 顺序断言、onFatalError 抛错/挂起 20ms 超时、rejection Error/非 Error）；回归 `tests/server/utils/` 全目录 9 files / 157 tests 全过；eslint 3 个改动文件 0 error 0 warning；`npm run build` 通过（tsc -b + vite build；KaTeX 字体/chunk size 提示为既有第三方警告）。定向验证 + build，未跑全量测试。
- Boundaries: 不改变 SIGINT/SIGTERM 既有优雅关闭语义；unhandledRejection 后继续运行属有意取舍（本地服务可用性优先）；注册点之前的 import 期同步异常仍走 Node 默认行为（与现状一致，窗口极小）；未改 CLI/bin 侧 spawn（stdio 仍 ignore，靠 logger 文件通道）；未 commit。
- Notes: ① 本会话为诊断驱动：崩溃时间线与排除项（22:38–22:45 update/check fetch failed 500 为网络问题非死因；系统未重启；无 OOM/EADDRINUSE 痕迹）已当面汇报；② update/check 弱网 500 修复（fdd7115）在 v1.10.0 之后合入，全局安装版本尚未包含，下个小版本随包生效；③ 并行会话同期在工作区推进 MCP warmup/agent-manager 相关改动（server/agent-manager.mjs、server/mcp/registry.mjs、tests/server/agent-manager.*、tests/server/mcp-registry.test.mjs、wiki mcp 条目），非本 feature 改动，未触碰。
- Next step: 可选真机验证：人为触发未捕获异常确认 server-*.log 出现 'Uncaught exception:' + stack + fatal 字段并 exit(1)；此后后台再无声退出时日志将直接给出死因。

## Completed Feature：update-check-async-snapshot

- Feature: 检查更新接口异步化——GET /api/system/update/check 立即返回状态快照、后台刷新 registry、弱网不再 500（update-check-async-snapshot，**已完成**）
- Status: done — 用户报告控制台 `Failed to load resource: 500 http://localhost:5176/api/system/update/check` 并指出「这个更新检查应该异步」。根因：路由 `await checkForUpdates()` 同步等待外部 npm registry fetch（5 秒超时），弱网/超时/registry 异常时抛错 → sendError 500，浏览器把非 2xx 记入控制台（启动静默检查每次触发）。
- 实现：① `server/utils/package-update.mjs` — npm 检查改进程内状态机：新 `getUpdateCheckState(projectRoot, {force})` 同步返回快照 `{status: 'checking'|'ok'|'error', ...上次结果, checkError?, checkedAt}` 永不等网络；结果过期（5 分钟冷却）/未检查/失败退避（30 秒）到期时后台 `startUpdateCheck` 刷新，失败只记 `checkError` 不抛给 HTTP 层；`force`（?force=1 手动检查）跳过缓存与退避。`checkForUpdates` 保留可等待语义供 `POST /api/system/update` 更新流程（成功走冷却缓存、与快照共享后台 Promise、失败如实 reject）；`checkDesktopRelease` 未动。② 路由改为 `sendJson(200, 快照)`，index.mjs context 换 `getUpdateCheckState(force)`。③ 前端新 `src/lib/update-check-poll.ts`（`requestUpdateCheck()`：默认 10 次 × 1s 有界轮询，fetch/sleep 可注入，一切失败返回 `{kind:'error'}` 不抛出，force 仅首请求，兼容无 status 字段旧 payload）；`useUpdateCheck`（启动静默）与 `about-settings-tab`（手动 force）接入，失败路径行为不变。
- Verification: 定向 3 files / 29 tests 全过（package-update 状态机 6 新用例：快照不等网络/冷却复用/错误快照+退避/force 重查/checkForUpdates reject；路由层 2 新用例：error 快照不 500、force 透传；update-check-poll 7 用例）；eslint 0 error（仅既有 identity.mjs:92 warning）；build ✓；`npm run test` 全量 **263 files / 2415 tests 全过**。
- Boundaries: 未动 `/api/system/update/desktop`（checkDesktopRelease，同形态阻塞+可能 500，但前端无调用方，见 Notes）；未新增依赖；无 UI/文案变化（About 错误文案沿用 updateCheckFailed / 服务端 checkError）；未 commit/tag/push。
- Notes: ① update/desktop 端点如后续被桌面壳启用，建议同样迁移到状态机；② identity.mjs:92 no-useless-assignment 为 dev 分支既有 lint warning，与本次无关。
- Next step: 真机验证：断网/代理失效时刷新页面，控制台不再出现 update/check 500；About 手动检查弱网下约 5 秒后显示检查失败文案，恢复网络后 force 重查成功。

## Completed Feature：model-stream-retry-notice

- Feature: 模型上游流重试可视化——任意 idle 超时重试（上限 10）+「模型连接重试中… n/10」（model-stream-retry-notice，**已完成**）
- Status: done — 用户实测上一特性后反馈：本机弱网场景（浏览器↔服务器 SSE 走 localhost 不断开）只看到 idle timeout 错误、没有重连文字；SSE 重连提示覆盖不到这层。按用户期望将上游模型流故障做成可见恢复：服务端重试条件放宽到任意 idle（有内容也重试、新流从零重放、消息原位替换），上限 10 次对齐 SSE 重连语义；重试进度经 `model_stream_retry` SSE 事件上报（agent-manager 两处 streamFn 闭包注入 onStreamRetry → emitSessionEvent），重试后首个实质事件上报 recovered；前端新 model-retry-notice controller 显示居中「模型连接重试中… n/10」（复用 reconnect-notice 样式词汇），message_update/message_end/agent_end/error 即隐藏，decorate 周期 sync 重挂。
- Verification: 服务端 2 files / 19 tests（重试上限/进度回调/有内容重试+恢复上报/停滞重试不立刻失败）；前端 model-retry-notice 12 tests + server-agent 透传 + 回归（compaction/side-chat/agent-manager/message-queue）全过；eslint 0 error；tsc -b；build ✓。测试适配：total 预算放大（10 次重试 × idle 需 11s+，真实 total 20min 不受影响）、reconnect-notice CSS 契约改并列选择器。
- Boundaries: total timeout 仍不重试；有内容重试丢弃半截内容重新生成（重新计费，恢复可用性优先）；Side Chat 不挂提示；conversation-compaction 流不注入回调（后台任务无 UI）；未 commit。
- Next step: 真机弱网验证：上游卡死时应看到「模型连接重试中… 1/10…」递增，网络恢复后提示消失、内容从零重写继续；持续断网 10 次用尽后报 idle timeout 错误。

## Completed Feature：ai-stream-idle-fast-detect-retry

- Feature: AI 流静默分档检测 + 零内容透明重试（ai-stream-idle-fast-detect-retry，**已完成**）
- Status: done — 起因：用户报告弱网下回合以「AI stream idle timeout after 300000ms」失败而非前端重连提示。链路分析确认这是服务端→模型 API 的上游流卡死（openai SDK 的 120s timeout 只覆盖到响应头、`finally clearTimeout` 后 body 读取无任何超时；pi-ai 在 headers 一回来就 push start，所以 idle timeout ≠ 请求没成功）；用户直觉「没成功的请求可重试」经修正为「按有无实质内容分流」，与用户确认后在 QuickForge 包装层简单实现（pi-ai 不透传自定义 fetch、patch globalThis.fetch 侵入过大，SDK 层方案否决）。
- 实现：① `ai-provider-options.mjs` — `DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS` 300s→60s（中断档），新增 `DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS`=120s（首实质事件前，容忍大上下文 prefill）；显式 idleTimeoutMs/deadlineMs 时两档同值（既有调用方语义不变）。② `ai-http-logger.mjs` — `wrapStreamWithTimeouts` 改流工厂模式；零内容静默超时（未达 1 次重试、用户 signal 未 abort）时内部 `createStream()` 重建：每次尝试独立 AbortController（`combineAbortSignals` 改多参修复第三个参数被丢弃）、换流打断上一次挂起连接、total timeout 跨尝试共享；托管云重试换新随机幂等键；对外吞掉重试流重复 `start`（agent-loop 后续 delta 的 message_update 以新 partial 自然接管已发布消息）；外部 `next()` 等待者跨重试存活由新流续喂；`result()` 等待者跟随当前流并在 swap 时迁移（旧流 abort settle 不再污染 result 归宿）；旧 pump 以 generation 守卫静默退出。有实质内容后超时或重试耗尽走原报错路径（文案不变）。
- Verification: 定向 ai-http-logger + ai-provider-options → 2 files / 19 tests 全过（6 个新增行为用例 + 2 个适配重试语义的既有用例）；消费方回归（conversation-compaction、side-chat 路由、agent-manager persist/abort/process-timing、rollback-compaction、auto-compaction）全过；eslint 0 error；node --check；build ✓（仅既有 warnings）。调试中修的三个自身 bug：`waiter(...)`→`waiter.resolve(...)` 笔误（重写时引入，对照 HEAD 原版发现）、`combineAbortSignals` 双参签名静默丢弃第三个 signal、`result()` 早调用绑定旧流（重试场景挂死/错误 settle）——后两个是重试机制引入的新边界，均以用例锁死。
- Boundaries: 未动 openai SDK/pi-ai/pi-agent-core；SSE 重连提示（sse-reconnect-notice）与本特性分属两层、互补；显式传 idleTimeoutMs 的调用方（compaction 等经 withDefaultAiProviderOptions 默认路径）行为不变；总时长 total 20min 不变；未 commit/tag/push。
- Revision（用户决策「都收紧到 60s 试试」）: DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS 120s→60s，与中断档统一；ai-provider-options 注释、两处测试断言/用例（首事件档 60s 触发重试、再 60s 失败报 after 60000ms）、wiki 与状态文件描述同步。复验定向 2 files / 19 tests 全过。prefill 误杀观察点：若大上下文场景出现「重试后仍首事件超时」，回调该常量或显式传 firstEventTimeoutMs。
- Next step: 无 blocker；可选真机验证：弱网制造上游卡死（断代理）观察 60s 快速失败 + 零内容时静默重试一次无感恢复；大上下文 prefill 确认 60s 首事件档不误杀。

## Completed Feature：sse-reconnect-notice

- Feature: 弱网重连提示——对话中显示「重新连接中… 8/10」（sse-reconnect-notice，**已完成**）
- Status: done — 先产出交互稿 `design-mockups/reconnect-indicator.html`（A/B/C 三方案 × 重连中/已重连/失败三状态 × 深浅主题 + 可操作断连→计数递增→成功淡出/上限失败演示），用户确认 **方案 A（消息流末尾居中轻量行）** 后实现。调研确认现状：`GlobalAgentSseClient`（src/lib/server-agent.ts）无限次指数退避（1s 起 ×2、封顶 30s）且断连对 UI 完全静默，弱网时用户只看到输出停住。
- 实现（连接层）：`MAX_SSE_RECONNECT_ATTEMPTS = 10` + `SseConnectionStatus` 类型；`onerror` 恢复路径（直连→同源代理切换计一次零等待尝试，随后调度重试）经 `noteReconnectAttempt` 广播 `reconnecting{attempt, maxAttempts, nextRetryAt}`；`onopen` 在此前确有断连时广播 `connected{recovered:true}` 并重置计数/退避；第 10 次重试仍失败广播 `failed` 并停止自动重连。导出 `subscribeSseConnectionState` / `getSseConnectionState` / `requestSseReconnectNow`（手动重试：disconnect 清退避后立即重连）；`disconnect()` 统一重置计数/退避/状态快照。
- 实现（UI 层）：新 `panel-decoration/reconnect-notice.ts` controller 订阅连接状态，在 `message-list` 末尾追加居中轻量行：重连中 spinner +「重新连接中… n/10」（计数稍加重色）+ 每秒倒计时（interval 只更新文本节点）；恢复后绿色「已重新连接」约 2.2s 带退场动画自动移除；上限后琥珀「连接失败，已重试 10 次」+「立即重试」按钮。元素幂等复用、decorate 周期 `sync()` 在消息列表被 Lit 重建后重挂回末尾，`destroy()` 退订 + 清计时器 + 移除 DOM。`ChatPanelHost` 仅主聊天挂载（Side Chat 走独立 NDJSON 流不共享该 SSE），decorate try 块内 `sync()`、清理段 `destroy()`。i18n 中英成对 5 key；`index.css` 新增 `.quickforge-reconnect*` 段（复用 muted token、todo 完成态 emerald、persist-degraded 琥珀 #d97706；reduced-motion 关动画；置于 TodoWrite 摘要注释之前避免 todo-write-renderer 无界切片契约污染）。文案全部 createElement/textContent，innerHTML 仅静态 SVG 常量。流式断连卡死仍由既有 15s 静默看门狗轮询 /status 兜底，两者互补不替代。
- Verification: 定向 vitest reconnect-notice + server-agent → 2 files / 58 tests 全通过（server-agent 新增 4 用例：退避计数与广播、上限后 failed 且不再新建连接、onopen recovered+重置、手动重连后从 attempt 1 重计；reconnect-notice 8 行为 + 6 组源码契约）；回归 i18n-language-snapshot + todo-write-renderer/summary + message-queue + side-chat-workspace-tab + chat-harness-capabilities → 6 files / 70 tests 全通过；eslint 改动 7 文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warnings），dist 确认含新样式与 key。**事故记录**：实现中途误把 `SSE_SILENCE_RECOVERY_MS` 15000 改成 15015（受调研报告笔误影响），导致两个既有 watchdog 用例在 15s 整刻差 15ms 不触发而失败——恢复原值后全绿；该常量与本次 feature 无关，最终 diff 未包含此变更。
- Boundaries: 未改服务端与 SSE 协议；重连节奏（1s→30s 退避）与看门狗行为不变，只加了计数/上限/广播；Side Chat / SharedServerAgent（分享页）未接入提示；未新增依赖；未 commit/tag/push。DESIGN_LANGUAGE 未更新（复用既有语义色与轻量行模式，无新视觉范式）。
- Next step: 无 blocker；可选真机弱网验证（断开网络观察计数递增与倒计时、恢复后绿色提示自动消失、持续断网到 10/10 后点「立即重试」）。

## Completed Feature：release-v1.10.0

- Feature: minor 发布 v1.10.0（release-v1.10.0，**已完成**）
- Status: done — v1.9.1 tag 之后 dev 待发布内容为 chat-message-queue 新功能（dfb2bcc：Composer 流式期排队自动发送、「立即」steer 轮边界插队 + 乐观显示、拖拽排序、localStorage 持久化），另有 plugins/lan-access 两个设置页文案精简（91d0c4d、9b52444，经 435c3bf 合入 dev，未包含在 v1.9.1 npm 包内）。新功能按 semver 应升 minor，经用户确认按 **minor** 发布 v1.10.0。
- Release changes: `npm version minor` 1.9.1→1.10.0（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.10.0] - 2026-08-27` 章节（Added/Changed/Released）；README.md 当前版本徽章更新为 1.10.0。
- Verification: 完整 `npm run test` → **260 files / 2365 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.10.0.tgz`（unpacked 24.2MB / 453 files）；打包元数据校验 version 1.10.0、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies、无 devDependencies/scripts。
- Release sequence: 本轮变更构成 release commit（7 个发布文件），随后 master 快进到发布提交、创建 `v1.10.0` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。
