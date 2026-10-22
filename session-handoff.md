## 当前交接：dsh-trajectory-design（done，2026-10-22）

- Current Objective（当前目标）: 只读调研 **DSH（DeepSeek Harness）会话轨迹（trajectory / session log）的存储与事件设计**，供 QuickForge Goal/会话轨迹对标参考。纯调研，**未改任何代码/文档/wiki**（调研结论沉淀在本交接，非架构变更，无需同步 docs/wiki）；未提交 Git。
- 结论（DSH 轨迹设计一句话）: **追加式 zstd 多帧 JSONL 事件日志**——`~\.dsh\sessions\<workspace-slug>\<sessionId>\session.v4.jsonl.zstd`，每次 append 写一个独立 zstd 帧（帧内 1..n 行 JSON），事件信封 `{type, seq, time, data, surfaceOp?, sourceEventSeqs?}`，seq 从 0 连续递增（实测 12 会话 0 gap）；恢复即顺序重放。
- 解压要点（避坑）: 整个文件是**多帧 zstd 拼接**，`zlib.zstdDecompressSync`/流式解压都只吐第一帧；必须按 zstd magic `28 B5 2F FD` 切帧逐帧解压再拼接（最大会话 3.7MB = 2671 帧 / 4499 事件，帧压缩比 ~0.27）。
- 头事件与信封: 首行 `{"type":"session", version:4, id, createdAt, cwd, isSeeded, delegationDepth, agentPreset}`（无 seq），子代理会话带 `parentSession` + `origin:"subagent"` + `delegationDepth:1`。其余事件 `seq`(int) + `time`(epoch ms)；`surfaceOp` 是 UI 呈现提示（`"append"` 或 `{op,startSeq,endSeq}`，非模型可见）；`sourceEventSeqs` 把派生事件（tool/result: 1842 条、system/message: 5、user/message: 1）回链源事件，压缩摘要 user/message 可指向多个源 seq。
- 事件分层（41 种，实测）:
  1. **会话配置**: `permission/preset`、`sandbox/mode`、`approval/policy`（带 `source:'delegation'`，会随 `/permission danger-full-access` 等命令变化）。
  2. **轮次骨架**: `turn/start{turn}` → `step/start{turn,step}` → 模型交互 → `step/end` → `turn/end{reason}`；reason：`completed` / `error{error:{message,code}}` / `aborted{reason:{kind:'user'|'parent'}}`。
  3. **模型交互**: `request/header`（config{provider,model,maxTokens,reasoningEffort} + adapterDefaults + **tools 全量定义快照**，31 个工具）；`request/context`（contextWindow、`systemPromptUpdate:"in-history"`）；`system/message` / `user/message`（content blocks，user source.kind 有 `user{rpcId,clientTimeZone}`、`user-approval`、`time-context`、`tool-jobs`、`skill-catalog`、`compact-checkpoint`）；`assistant/message`（message.content: reasoning/text/tool-call 块；`source.replayState`={response:{kind:'deepseek-messages',version:1,model}, blocks:[{type:'reasoning',signature}]} 可重放回源；`usage{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens}`；**`stream[]` 全量流记录**：chunk/block-start、chunk/block-end、chunk/usage、chunk/finish、reasoning-chunks(dt+texts 差分)、tool-call-chunks、text-chunks）；失败重试另有 `assistant/attempt`（原始失败流）+ `llm/retry-started`/`llm/retry{retryId,policyKey,retry,maxRetries,delayMs,failure}`；`model/selection`。
  4. **工具生命周期**: `tool/call{turn,step,callId,name,arguments}` → `job/registered{jobId,owner,kind,label,startedAt,toolCall{callId,rootCallId}}` → `job/settled{finishedAt,status,cause,producerReported,detail}` → `tool/result{message{role:'tool',source{kind:'tool',callId},content,isError,id},error?,meta?}`。`meta` 按工具结构化：read→`{path,offset,lines[{number,text}],totalLines,lang}`、grep→`{shape:'matches',files,total,truncated}`、glob→`{shape:'paths',paths}`、edit/write→`{path,diffs,operation}`。工具分布（9931 事件统计）: edit 763 > pwsh 444 > read 377 > grep 116 > write 37 > job_output 28。
  5. **审批/命令**: `approval/asked{id,toolName,callId,reason}` → `approval/decided{outcome:'allowed-once'}`；`command/run{commandId,name,args,source}` → `command/done{kind:'success',text}`。
  6. **注入/收件箱**: `agent/inbox/spliced{target:'next-turn',start,inserted[]}`——steering/子代理提示注入，含会话内多次 spliced。
  7. **Goal（事件溯源）**: `goal/change{kind:'goal/change',version:1,operation:'create'|'complete',goal{id,revision,objective,phase,maxGoalRounds},roundsStarted,createdAt,updatedAt}`——**完整快照 + revision CAS**，这正是 QuickForge Goal v2 对标的源头契约。`todo/write{todos[]}` 同族。
  8. **压缩/上下文管理**: `compaction/prune{shadowedRange,shadowedSeqs,shadowedTokenCount}`（裁剪审计，57 条）→ `compaction/start/end{compactionId,turn,error?}` → `compaction/summary{summary[]}`（结构化摘要）；摘要以 `user/message` + `compact-checkpoint` 投放进上下文。
  9. **工作流/子代理**: `tool-workflow/run-start|agent-start{runId,seq,label,phase,childId}|agent-end{outcome}|run-end{stopReason}` + `subagent/descriptor{version,mode:'continuable',provider:'spawn',label,agentProvider,agentModel,agentReasoningEffort}` + `subagent/catalog{version,childId,childCreatedAt,mode,label}`；子代理是**独立 session 文件**（裸 UUID 目录），与父会话双向链接。
  10. **元数据/遥测**: `session/title`、`session/title-llm-request`、`session-log-deepseek/delivery-accepted{sessionId,sessionFormatVersion,throughSeq}`（日志投递水位 ack）。
- Evidence（验证方式）: Node 24 `zlib.zstdDecompressSync` 按帧切分解压 12 个会话（含 C:\Users\xiaohao\.dsh 两个 workspace、QuickForge 目录下 8 主会话 + 3 子代理会话），共 9931 事件全部 JSON 可解析、seq 0 个缺口；配置面 `~\.dsh\profiles\desktop\cordis.patch.yml`（provider/model 注入）与 `storages\workspace.json`（workspace↔session 索引）一并读过。
- 可复用脚本（保留在仓库根，未纳入 git 提交范围）: `.tmp-dsh-lib.mjs`（多帧解压+事件统计+落盘 dump）、`.tmp-dsh-zframes.mjs`（zstd 帧边界/seq 连续性分析）、`.tmp-dsh-inspect.mjs`（单文件概览）、`.tmp-dsh-src.mjs`（sourceEventSeqs/meta/request-header 形状）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 若启动 QuickForge「轨迹/Goal v2 对标 DSH」改造，直接按上面第 7/8 节契约做事件溯源（goal/change 完整快照 + revision CAS + compaction/prune 裁剪审计）；② 若要把 QuickForge 会话存储也改成 zstd 多帧追加，注意按 magic 切帧的读取约定；③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：tool-running-text-shimmer（done，2026-10-22）

- Current Objective（当前目标）: 用户先问「运动命令时候的扫光是不是黑色的，白色会不会更好」，看完白色变体与 8 个样式方案后选定 **C 方案：渐变高光在文字内部流过（复用思考 shimmer 范式）**。**已完成**，未提交、未创建 commit。
- 根因（一句话）: 原扫光是 `.quickforge-tool-running-sweep::after` 覆盖层，用 `color-mix(in oklab, currentColor 12%, transparent)` 取文字色 —— 而文字色是 `--muted-foreground`，于是浅色主题下是灰带（观感像黑色）、暗色下近白，同一份代码两套观感；且光带压在文字上层拉低可读性。用户提的「纯白」方案在浅色主题（白底）下会完全失效。
- 改动（`src/index.css`，仅 CSS）:
  1. 删除 `::after` 覆盖层与 `@keyframes quickforge-tool-running-sweep`，改由标签自身承载渐变：`background-image: linear-gradient(90deg, muted-foreground 25%, foreground 50%, muted-foreground 75%)` + `background-size: 200% 100%` + `background-clip: text` + `color: transparent`，动画**直接复用既有 `shimmer 2s ease-in-out infinite`**（与 ThinkingBlock 同一 keyframes/节奏）。
  2. **底色兜底** `background-color: var(--muted-foreground)`：渐变只覆盖 200% 幅面的一部分，端点相位会让整段文字不可见；底色与渐变两端同色，任意相位都可读且无接缝。这一步是踩坑点，删掉会看到文字周期性消失。
  3. `.quickforge-tool-running-sweep .quickforge-tool-summary-detail { color: var(--muted-foreground) }`：保护参数摘要（` · npm run build`）不被父级 `color: transparent` 吞掉。
  4. `prefers-reduced-motion` 回退：`background-image: none` + `background-clip: border-box` + `background-color: transparent` + `color: inherit` + `animation: none`，不留静态渐变运行态。
- 测试迁移（改断言到新语义，不是糊过去）: `tests/frontend/local-tool-running-sweep.test.ts` 的三条 CSS 契约重写为「text-clip 渐变 + shimmer 复用 + 底色兜底 + detail 不透明 + reduced-motion 回退」，新增「不再存在 `::after`」的负向断言；`tests/frontend/motion-design.test.ts` 的长循环豁免锚点从 `quickforge-tool-running-sweep 1.8s` 改为 `animation: shimmer 2s ease-in-out infinite`。
- Evidence（验证）: 最终全量 `npm run test` → **417 文件 4775 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功。定向 `npx vitest run local-tool-running-sweep / motion-design / chat-surface-css-contract / subagent-run-detail / tool-param-summary` → 5 文件 178 passed。Playwright 实测深浅两主题：计算样式为 `background-clip: text` / `color: rgba(0,0,0,0)` / `background-color: oklch(0.556 0 0)`（暗色 0.708），`-200%…200%` 五个相位文字均完整可读，亮部落在字形中部，`· npm run build` 保持自身灰色。
- 顺带修复（并行会话遗留，非本次 feature）:
  1. `src/lib/session-lease-client.ts:129` `failureFromStatus` 返回类型从 `SessionLeaseFailure | null` 收窄为 `SessionLeaseFailure` —— 三个分支都返回值、恒不返回 `null`，注解让 TS 把 `null` 漏进第 171 行，导致 `server-agent-events-types.test.ts`（真实 tsc 诊断）失败。
  2. `src/components/chat/surface/MessageEditor.tsx` 的 `readOnlyPlaceholderKey` 原本声明但未使用（占位符写死为 `sessionLeaseComposerPlaceholder`），改为真正使用该 prop，父组件透传 `composerReadOnlyPlaceholderKey`，两处类型由 `string` 收窄为 `AppTextKey`（`t()` 只接受字面量联合）。这才让「旁观者 / 降级」两种只读文案能分开。
- 文档: `DESIGN_LANGUAGE.md` 动效章节新增「工具运行态流光」一条（范式、底色兜底、detail 保护、reduced-motion 回退）；对比稿 `design-mockups/tool-running-feedback-styles.html`（8 方案）与 `design-mockups/tool-running-sweep-white.html`（白色 4 档）。`docs/wiki` 无需更新：纯视觉状态反馈，模块职责与公共入口未变。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 可选真机目视 running → done 切换、reduced-motion、以及 `run_command` 长命令下流光与后台命令删除线的共存；② 若觉得流光偏弱，只能调渐变停靠点（`25%/50%/75%` 与 `foreground` 权重），**不要**引入 filter/box-shadow（被契约测试禁止）；③ 会话租约那批改动（`ChatSurface` / `ConnectionNotices` / `server-agent` / `i18n` / `session-lease-client`）仍未被本次 feature 覆盖验证，仅修了它们的两个编译错误；④ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：abort-lease-header（done，2026-10-22）

- Current Objective（当前目标）: 用户报「点击暂停无效，控制台 `POST /api/agents/:id/abort 409 (Conflict)`」。**已完成**，未提交。
- 根因（一句话）: `ServerAgent.abort()` 是唯一漏发租约头的写入口。服务端 abort 挂了 `assertSessionWriteAccess`，读不到 `x-quickforge-client-id` 即视作匿名客户端，租约被持有时 409 `SESSION_LEASE_HELD`；而前端 `canWrite()` 先放行（本页确实是持有者），请求才真的发出并撞 409。原实现只 `.catch()` 网络错误、不检查 `response.ok`，409 因此完全隐身 —— 用户看到的就是「点了没反应、agent 继续跑」。
- 改动:
  1. `src/lib/server-agent.ts:865` `abort()` 补 `headers: this.writeHeaders()`（与 prompt/steer/followUp/updateModel/thinking-level 等写入口对齐）。
  2. 同处增加非 2xx 的 `logger.warn('Abort request rejected:', { status })`，让同类拒绝不再静默。
  3. `tests/frontend/server-agent-session-lease.test.ts` 新增 1 例：abort 请求必须带 `x-quickforge-client-id`。
- Evidence（验证）: `npm run test` **417 文件 4774 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc --noEmit -p tsconfig.json` 通过；`npm run build` 成功（6.70s）。
- 文档: 无需更新。`docs/wiki/src/lib/README.md:179` 原本就写「所有写请求经 `writeHeaders()` 携带 `x-quickforge-client-id` 供服务端二次校验」，是代码漏实现而非文档不实，本次修复后描述才真正成立。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 复查其它新增写入口是否漏发 `writeHeaders()`（本次暴露的是「文档已声明、代码漏一处」这类漂移，建议加一条”写路由 ↔ 客户端头”的契约测试把 13 条路由与前端写方法对齐）；② 承接上一条 session-write-lease 的遗留：A1（pin/归档改字段级 patch）、C6/C7（`bodyUnchanged` 仍比整份 canonical JSON）、多进程共享 dataDir 无文件锁、`session.sseConnected` 死代码。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：session-write-lease（done，2026-10-22）

- Current Objective（当前目标）: 用户先问「消息保存失败，请刷新或重试，以免丢失最近的对话记录」是什么意思；解释根因后用户选择落地 **A2 会话级独占（防多标签/多设备并发写同一会话）**。**已完成**，未提交，未创建 commit。
- 产品决策（用户未在追问中回复，按默认方案执行）: 非持有者降级为**只读旁观 + 可手动「在此窗口接管」**；不做自动抢占、不做硬拒绝；门禁覆盖全部写路由，但**不含审批与 `ask_user` 应答**（避免非持有卡片的页面把运行卡死）。
- 根因（一句话）: 写权限只有两层 —— 进程内 per-session FIFO 锁（只有 `persistSession` 走）+ SQLite revision CAS。真实并发写入口（第二标签页、局域网第二设备、多进程共享 dataDir）从不经过该锁；`runPrompt` 的业务门禁只有本地 `state.isStreaming`，且与真正开跑之间有多处 `await`（TOCTOU）。CAS 冲突时策略是「拒绝覆盖 + `persist_degraded` 告警」，于是并发写退化成用户可见的「消息保存失败」。原 `session.sseConnected` 独占链（重复连接 409）**早已无消费方** —— 前端改用全局事件流后失效。
- 服务端改动:
  1. `server/session-lease.mjs`（新增，纯同步 = 无 TOCTOU 窗口）: `acquire`（续约不广播）/ `forceTake`（显式接管，广播）/ `release`（仅持有者可）/ `get`（过期视作无人持有）/ `canWrite`（无租约放行，保持 ACP/定时任务/共享会话与升级前单端行为）/ `clear`（带 fence 防跨代误释放）。TTL 60s；`publish` 抛错被吞（租约是并发保护，不是可用性依赖）。
  2. `server/agent-session-lease.mjs`（新增，装配层）: 接 `agentSessions` + `emitSessionEvent`，变化以 `session_lease` 帧广播；6 个函数由 `agent-manager.mjs` facade re-export（导出面契约 +6）。
  3. `server/routes/agent.mjs`: 新增 `GET|POST|DELETE /api/agents/:id/lease`；新增 `assertSessionWriteAccess` 挂到 **13 条写路由入口**，位置在 `await readJsonBody` 之前 —— 被拦下的请求不读 body、不进 `runPrompt`，正是对旧 TOCTOU 空窗的补位。
  4. `getSessionState`/`getSessionStatus` 增加 `lease` 字段；`destroyAgent` 结束处 force 清除租约。
- 前端改动:
  5. `src/lib/session-lease-client.ts`（新增）: `clientId` 存 sessionStorage（刷新不变、新标签页新值）；`acquireLease`/`takeOverLease`/`releaseLease`；**409 与网络失败一律不降级为可写**。
  6. `ServerAgent`: `enableSessionLease()`（申领 + 20s 心跳）/ `takeOverSessionLease()` / `canWrite()` / `subscribeSessionLease()`；`dispose()` 释放并停表；`state.sessionLease` 由心跳与 SSE 帧共同维护且同值去重；**10 个写入口**本地拦截（一个请求都不发，避免「先乐观插入再回滚」的界面闪烁）；写请求统一带客户端头。
  7. UI: `ChatPanelHost` 挂载时申领 + `useSyncExternalStore` 订阅；`ChatSurface` 新增 `SessionLeaseStrip`（提示条 + 「在此窗口接管」）与 `composerReadOnly`（textarea `readOnly` + 占位文案、发送按钮禁用、paste/drag/drop 短路），复用 `composerControlsDisabled` 禁用「+」/模型/access 控件；`index.css` 新增 `.quickforge-lease-*`；i18n 新增 6 条中英文案。
- Evidence（验证）: `npm run test` **417 文件 4773 passed / 2 skipped**（新增 `session-lease.test.mjs` 17 例、`session-lease-client.test.ts` 14 例、`server-agent-session-lease.test.ts` 11 例、路由 409/守卫 8 例）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 成功（5.03s）。
- 两次返工（避坑记录）: ① `agent-manager.mjs` 的 `export { ... }` 漏 `from` → rolldown `Duplicated export`，一度让 28 个测试文件整体加载失败；② 起初把租约函数挂在 `agent-manager` facade 供路由导入，导致 9 个既有 `vi.mock('server/agent-manager.mjs')` 测试全报 `No "canWriteSession" export` —— 最终改为**路由直接 import `agent-session-lease.mjs`**，facade 仍 re-export 保住导出面契约，既有 mock 零改动。
- Blockers（阻塞）: 无。
- Next Session（下一步，按收益排序）: ① **A1（用户本次未选，但是最高频诱因）**：pin/归档改字段级 patch —— 侧栏 pin 仍会回写客户端整份缓存 metadata（`lastModified/title/taskStatus`），而 agent 侧冲突白名单只有 `pinnedAt/archivedAt`。② **C6/C7**：`bodyUnchanged` 仍比整份 canonical JSON，冲突后仍是「放弃写入」而非「重读 + 合并 messages 再写一次」。③ 多进程共享 dataDir 无进程级文件锁，跨进程仍靠 CAS 兜底。④ `session.sseConnected` 独占链可在确认无外部依赖后删除。⑤ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：composer-typing-latency（done，2026-10-22）

- Current Objective（当前目标）: 修用户反馈「对话轮次多了之后，输入框打字非常卡」。**P1+P2 已完成**（用户明确选择 P1+P2，且要求「内部重构，外观/交互零变化」）。未提交。
- 根因（一句话）: 卡顿不是某个组件慢，而是**热路径的归属错了**——输入文本存于 `ChatSurface` 顶层 `useState`（原 `:843`），于是每按一个键就重渲染整个 surface（1417 行），其中 `UsageBar` 的 `aggregateUsage`（`filter`+`reduce` 全量 assistant 消息，每次新建数组）与 `TodoWriteSummary` 的倒序扫描都是 O(消息数)。成本随轮次线性增长，所以只有长会话才卡。`MessageArea` 早已被 memo 围栏挡住（`:571`），但围栏越加越多、热路径仍在顶层。
- 三条叠加的成本链:
  1. **渲染**：按键 → `applyEditorText` → `setEditorValue` → 整个 ChatSurface 重渲染；`MessageEditor`/`GoalStrip`/`PlusMenu`/`ThinkingControl` 全部未 memo。
  2. **命令式联动**：`editor.onInput` 同步串联 4 个控制器；`command-suggestions`/`file-reference-suggestions` 每键 `innerHTML=''` + 全量重建（含 `setActiveRow` 重新 `querySelectorAll`）；`handleEditorInput` 每键两次 `querySelector`。
  3. **装饰放大**：面板级 `MutationObserver{childList,subtree}`（原 `ChatPanelHost.tsx:1679`）把菜单/chip/附件 tile 的节点增删都当成「需要全量 decorate」，而 decorate 内含约 39 项 O(消息数)/O(DOM 数) 操作。
- 修复（按架构分层，不是打补丁）:
  1. **U1 热路径下沉**（新增 `src/components/chat/surface/composer-store.ts`）：`text` / `attachments` 两个独立切片的外部 store + `useSyncExternalStore`。`ChatSurface` 删除 `editorValue`/`editorValueRef`/`editorAttachments`/`editorAttachmentsRef` 四个副本与两个镜像 effect；`MessageEditor` 拆成 `ComposerTextarea` / `ComposerAttachmentRow` / `ComposerActionButton` 三个叶子，各自只订阅需要的切片。bridge（`.qf-message-editor` 的 `value`/`attachments`）改为**纯适配器**：getter 读 store、setter 写 store，自身不存状态——顺带消灭了「同一值每键写 2–3 次 + 2 次 `handleEditorInput`」的旁路。
  2. **U4 派生投影前移**：`AgentSurfaceSnapshot` 新增 `usage` 与 `todoSnapshot`，由 `readAgentSnapshot` 一次算出并按 `messages` 数组身份用 WeakMap 缓存（与既有 R1 F1a 身份复用同一机制）。`UsageBar` 改收 `totals: Usage` 并 memo 化；`TodoWriteSummary` 改收 `{snapshot,key}|null`，组件内不再 `useMemo` 扫消息。
  3. **U3 装饰作用域收窄**：`MutationObserver` 仍在 `panel` 上（消息列表可能尚未挂载），但回调先按 `closest('.qf-scroll-container')` 过滤——只有 added/removed/target 落在消息区时才 `scheduleDecorate()`。composer 侧的节点增删不再喂全量 decorate。
  4. **U2 菜单按签名协调**：`command-suggestions` 与 `file-reference-suggestions` 各加 `renderedSignature`（query + 命中条目 + loading/directory/state），签名不变直接 return，`remove()`/`removeMenu()` 清空签名保证重开必重建。菜单 DOM 现在只在「可见内容真的变了」时重写。
  5. **热路径查询缓存**：`handleEditorInput`/`handleEditorFilesChange` 改用 `resolveEditor()`——`isConnected` 校验的缓存节点，替代每键两次 `querySelector`；文件变更分支不再多查一次 textarea。
- 收益（结构性，不依赖实测数字）: 打字期间 `ChatSurface` **零重渲染**，只有 `<textarea>` 与发送按钮重渲染；usage/todo 从「每键 O(消息数)」降为「每次快照提交 1 次 WeakMap 查询」；菜单 DOM 重写从「每键」降为「命中集变化时」；装饰 pass 不再由 composer 变动触发。
- Evidence（验证）: `npm run test` **415 文件全通过**（新增 `composer-store-isolation.test.ts` 5 例、`suggestion-menu-reconcile.test.ts` 3 例；迁移 `chat-surface-editor`/`chat-surface-usage`/`chat-surface-css-contract`/`send-stop-button`/`composer-model-trigger`/`todo-write-summary` 到新 API）；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.66s）。
- 新增回归护栏（锁定「打字不惊动 surface」这条不变量）:
  - `composer-store-isolation.test.ts`：text setter 只通知 text 订阅者 / attachment setter 只通知 attachment 订阅者 / 同值写入不通知（`Object.is` 稳定）/ **打字后 `.qf-message-editor` 与卡片节点身份不变**（等价于「组件没重渲染」）/ 发送按钮仍随文字变活。
  - `suggestion-menu-reconcile.test.ts`：签名不变时行节点**同一批** / query 变化时重建且高亮正确 / 关闭后重开拿到新节点（不命中陈旧签名）。
- 未做（用户已确认只做 P1+P2）:
  - **U5 恢复窗口化**：`createMessageWindow({ enabled: false })` 仍是全量渲染。阻塞项：过程组展开态键含窗口内 `turnIndex` 需改绝对下标；窗口翻转会被 `shouldReleaseProcessGroups` 当成结构变化而全量 release+refold；另需同时改两条源码锁定断言（`chat-surface-behavior-alignment.test.ts:88-89`、`chat-surface-render.test.ts:224`）。
  - **U6 滚动 reflow**：`scroll-sync` 仍观察 `composerDock`，`fieldSizing:'content'` 自动增高 → 每键 resize → rAF 读 `scrollHeight`（强制 reflow）。P1/P2 后已不是主导项，但仍是单帧成本。
  - **P4 process-folding React 化**：`process-folding.ts`（1717 行）把 React 渲染的节点 re-parent 进装饰组，是所有窗口化/虚拟滚动方案的唯一根本障碍，也是大量「读源码文本」断言的主要对象。
- Blockers（阻塞）: 无。**未做真实浏览器 profile**——本轮收益是结构性的（重渲染范围与 O(n) 调用次数都从代码里消失了），但「长会话实际打字延迟」建议下次用 1000+ 消息会话配 `PerformanceObserver` longtask 采一轮，作为 P3 基线。
- Next Session（下一步）: ① 继续则做 P3：改 `process-folding` 展开态键为绝对 messageIndex + 让 release 门控区分「消息变更」与「窗口位移」，再启用窗口化，同时更新两条源码锁定测试。② 采一轮真实 profile 作为 P3 准入基线。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：turn-navigation-anchor（done，2026-10-22）

- Current Objective（当前目标）: 修用户反馈「对话区域左边的导航点，对于非用户输入的消息无法正确定位」。**已完成**。未提交。
- 用户约束: 现象确认为「导航点数量偏多，多的是 goal 续跑/后台任务通知」；修复范围明确要求**先只修定位锚点、不动节点数量**，所以内部消息仍各占一个导航点。
- 根因（一句话）: 导航节点来自**全量消息**（只看 `role`），可滚动目标只有实际渲染的行；两者用「窗口内第 n 个 `.qf-user-message`」的**序号算术**对齐，而 goal 续跑提示（`metadata.quickforgeGoalRun`）与后台命令通知（`details.quickforgeBackgroundCommand`）虽 `role: 'user'`，却被 `index.css:4245-4248` 以 `.quickforge-goal-internal-user-message` 整行 `display: none`。这类行没有布局盒、`getBoundingClientRect()` 全 0，但 `querySelectorAll` 不筛可见性 → 序号被它占位；`0 <= 阈值` 恒成立让高亮跳格，点击则算出 `scrollTop + 0 - containerTop - 24` 这种与内容无关的位置（表现为「几乎没反应 / 轻微往回一格」）。
- 修复（新增 `src/components/chat/turn-navigation-anchor.ts`，把口径收成单一真相）:
  1. 锚点改用 `MessageList` 写在行上的绝对 `data-message-index`（与 `turns[].messageIndex` 同一套坐标，与窗口起点无关），只扫 `.qf-message-list` 直接子级，避开 subagent 嵌套列表。
  2. `getClientRects().length === 0` 判定 `display: none`（不读 rect 值，避免「0 也是合法坐标」的歧义）。
  3. 三级回退：自身行可见 → 用它；被隐藏 → 其后第一个可见行，没有则之前最后一个可见行；自身行不在 DOM → `null`，不猜。
  4. `turn-navigation.ts` 删掉 `renderedTurnOrdinals` / `userElements` 序号算术，测量缓存改存 `anchors`；顺带补上旧 `renderedTurnOrdinals` **缺窗口上界**的隐患。
- Evidence（验证）: `npm run test` **412 文件 4716 passed / 2 skipped**；`npm run lint` 0 error（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 成功。
- 新增/改造测试: `tests/frontend/turn-navigation.test.ts` 共 11 例，新增 `never marks a display:none user row as the active turn`、`jumps a hidden turn to the next visible row instead of scrolling to 0`；桩补 `data-message-index` / `getClientRects` / `scrollTop` / `scrollTo`。
- Blockers（阻塞）: 无。**未做真实浏览器手点**——本项是纯测量与锚点解析改动，假 DOM 已覆盖可见性分支，但建议下次开面板时用长会话（含 goal 运行或后台命令）点几个点确认手感。
- Next Session（下一步）: ① 若用户后续要收敛**节点数量**，在 `turn-navigation-data.ts` 复用 `isGoalInternalUserMessage`（`panel-decoration/goal-internal-message.ts`）过滤内部消息，并把该轮次的 assistant 内容归入上一个真实用户轮次；注意 `tooltip` 的 `userText`/`finalAnswerText` 配对也走同一函数。② `src/components/workspace/SubagentRunDetailContent.tsx:121-124` 有同构的 `.qf-user-message` 扫描，口径一致、当前不受影响，改动时一并核对即可。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：composer-native-attachment-hidden（done，2026-10-22）

- Current Objective（当前目标）: 修用户反馈「输入框附件按钮跑到『完全访问』右边了，但『+』添加菜单里本来就有添加附件」。**已完成**。未提交。
- 根因（一句话）: 附件入口的唯一性一直由**装饰层的副作用**维持，不是由 CSS 或 props 表达。旧 `panel-decoration/composer-plus-menu.ts` 的 `setupComposerPlusMenu` 每次 pass 都执行 `findNativeAttachmentButton(leftControls)?.classList.add('quickforge-native-attachment-hidden')`，配合 `index.css:4984` 的 `display:none !important` 把原生回形针藏起来。M4 整文件删除该模块后，这行副作用一起消失，回形针重新可见 → 与「完全访问」触发器并排。
- 修复（把隐含契约改成显式渲染门禁）:
  1. `ChatSurface`：`showAttachmentButton={enableAttachments && !activePlusMenu}`。
  2. `MessageEditor`：spinner 从 `showAttachmentButton` 分支里提出（`processingFiles ? spinner : showAttachmentButton ? 按钮 : null`），否则「+」接管后粘贴/拖拽的长文档解析（PDF/DOCX 最长 30s）没有任何进度提示。
  3. `input[type=file]` 始终挂载，「+」菜单经由 `pickAttachment` 回调点它。
- 等价性差异（已知且可接受）: 旧实现是「先渲染再 `display:none`」，回形针仍在 DOM 里；新实现根本不渲染。可见行为一致，且不再依赖 decorate 时序。
- Evidence（验证）: `npm run test` **412 文件 4714 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.46s）。
- 真实浏览器回归（CDP + headless Chrome，`127.0.0.1:5176`，临时探针脚本已删除）:
  1. 左侧控制行只剩 `+`（title「添加」）与 `完全访问`，回形针查询**返回空数组**；`input[type=file]` 仍为 1 个。
  2. 点 `+` → 弹层 `inDock=true`、位于编辑卡片之前，菜单项 `["附件","插件"]`：附件入口确实还在「+」里。
  3. 真实走隐藏 file input 传 1×1 PNG：附件行是卡片**第一个子节点**（`attachRowInsideCard` / `attachRowIsFirstChild` 均 true），tile 1 个、`img` 实测 56×56、`tileInsideCard=true`、`removeButtonClippedPx=0`（删除按钮未被 `overflow:hidden` 裁掉）、发送按钮由禁用转可用；点删除后 tile 归零、发送按钮回禁用。
  4. 右侧控制行未受影响：context-usage / 模型 / thinking / 发送，顺序正常。
- Blockers（阻塞）: 无。
- 一条环境事实（**不是本轮改动**，但会污染回归结论）: 会话期间有**其他进程**在改 `src/components/chat/turn-navigation.ts`、新增 `turn-navigation-anchor.ts`、改 `tests/frontend/turn-navigation.test.ts`（时间戳 10:19–10:21）。10:21 的全量测试因此报 2 文件 4 例失败（`skips display:none user rows...`、`env.getAnchorScanCount is not a function`、`scrollTargets` 为空等，全是改到一半的瞬时态）；对方写完后 `turn-navigation` 11 例与全量 412 文件全绿。**多 Agent 并行时，回归结论必须带时间戳与文件 mtime 对照**，否则会把别人的中间态当成自己的回归。
- Next Session（下一步）: ① **M4 收尾检查项**——整文件删除装饰模块时，除了「功能搬到 React」，还要逐条盘它写的 `classList.add/remove`、`dataset`、`style`：这些「顺手做的可见性/状态抑制」不会出现在函数名里，测试也常不覆盖（本轮就是典型）。建议对已删的 13 个模块做一次同样口径的回扫。② 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。③ 工作区里 `tmp-attach-shot.png`、`tmp-attach-shot2.png`、`tmp-test-attachment.png` 是更早会话遗留的未跟踪文件（时间戳 9:59–10:00），非本轮产物，未删除。

---

## 当前交接：session-open-fast-path-m4-slice4（done，2026-10-22）

- Current Objective（当前目标）: 把 M4 剩余可 React 化的 3 个装饰模块迁到 surface，并对整轮改造做自我代码评审。**已完成**。未提交。
- 落地 3 个（累计 13 个）:
  - `assistant-waiting-bubble.ts`（113 行，删除）→ `resolveAssistantWaitingRow` 用消息数组算**行索引** + `AssistantWaitingBubble` 作为 keyed 兄弟。「其后是否已有 assistant 输出」从 DOM 探针（查 `.qf-thinking-block`/`.qf-tool-message`/`.qf-markdown-block` + 克隆节点剔除动作行）改为读消息体，并保留旧的 `isStreaming` 前置条件。
  - `plan-mode-controls.ts` 的 `syncPlanModeButton`（删除）→ `PlanModeTrigger`，**仅 planMode 为 true 时渲染**（保持旧「关闭时 remove」的可见行为）。Shift+Tab 快捷键仍留在装饰层（绑定 textarea）。
  - `agent-access-menu.ts` 的触发器与菜单渲染（删除）→ `AgentAccessTrigger` + `AgentAccessMenu`；位置计算抽成纯函数 `positionAgentAccessMenu`，关闭改为**握手**。
- **自我评审发现并修掉 2 个高危缺陷**（都是"测试全绿但功能已坏"，务必记住）:
  1. **压缩横线与等待气泡的索引错位**：两者都按消息行计数，却用两次 `splice` 插入——插入横线会把之后每个位置推后一位，于是**横线在上方时气泡被挤到该行之前**（本该在最后一条 user 行之后）。任何发生过上下文压缩的会话，下一轮等待必中。改法：`MessageList` 的子节点数组**单次正序构建**；另加两条测试锁定「横线在上方时气泡仍是最后一个子节点」「同索引时横线在前」。
  2. **装饰层删除 React 拥有的菜单节点**：`removeAgentAccessMenu` 仍 `menu.remove()`，之后 React 卸载抛 `NotFoundError: The node to be removed is not a child of this node`，被 error boundary 接管后**整块聊天区不可用**。触发链：打开权限菜单 → 点「+」或子代理指示器 → `dismissComposerMenus()`。改法：装饰层只调 closer（`registerAgentAccessMenuCloser`），节点由 React 自己卸载。**探针已确认「外部移除后再卸载必抛」——这是形态问题，不是概率问题。**
- 另修 4 处行为偏差:
  1. 等待气泡漏了 `isStreaming` 前置条件（旧实现要求 `isStreaming && isActive`），会与停止按钮的等待环脱节。
  2. 空 thinking chunk 被算作「已输出」→ 气泡提前一帧消失（`content-parts` 会丢掉空 thinking，不渲染）。
  3. 侧聊的权限控件从「可见但禁用」变成完全不渲染（门禁漏了 `sideChatMode ||`）。
  4. 权限菜单在门禁变化后自动重开（门禁变 false 时菜单卸载但 `open` 仍为 true）。
- Evidence（验证）: `npm run test` **412 文件 4710 passed / 2 skipped**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（3.67s）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 明确不做且已写入拒因的 5 类——`process-folding`（节点所有权移交）、`message-actions`/`assistant-artifact-card`/`message-queue`（位置语义 + 100+ 条文本锁）、`scroll-to-bottom-button`（测量驱动的可见性，无快照数据可推导）、`subagent-running-indicator`（body 浮层 + 就地 diff 防 hover 闪断）、审批卡/ask 卡/回滚弹层（定位原语与浮层）。② 仍未跑真实浏览器：`+`/思考/权限三个弹层的定位、侧聊禁用观感、压缩横线 + 等待气泡在长列表里的相对位置，都值得手点一遍（jsdom 只覆盖顺序与属性，不覆盖像素）。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：run-command-silent-console-and-log-viewer（done，2026-10-22）

- Current Objective（当前目标）: 让 `run_command` 的前台与后台都不再弹出 Windows 控制台窗口，同时提供「点击查看完整运行日志」的入口，日志落在右侧 Reader 面板。**已完成**。未提交。
- 关键前提（先说清，避免复现错方向）: 用户最初报的是「普通前台命令也弹窗」。实机实测（250ms 轮询可见顶层窗口）结论相反——**只有 `run_in_background: true` 会弹**，前台 `detached:false` 时 `CREATE_NO_WINDOW` 生效、无窗口。抓到的证据：`WindowsTerminal | ping -n 4 127.0.0.1`；用户机器 `HKCU\Console\%%Startup\DelegationConsole = {2EACA947-...}`（默认终端是 Windows Terminal）。
- 根因: libuv 在 `detached:true` 时加 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`；WinBase.h 对 `CREATE_NO_WINDOW`（= Node 的 `windowsHide`）明确注明「ignored if ... used with either CREATE_NEW_CONSOLE or DETACHED_PROCESS」。**`detached` 与 `windowsHide` 在 Windows 上互斥**，所以原 `detached: runInBackground || process.platform !== 'win32'` 让后台分支的隐藏完全失效。
- 修复要点:
  1. `server/tools/index.mjs`：`detached: process.platform !== 'win32'`（后台语义由 `unref()` 承担，Windows 杀进程走 `taskkill /T /F`，都不需要进程组）；`details.detached` 如实反映实际参数。
  2. `server/utils/platform.mjs` 的 `openBrowser()`：原本 `cmd /c start` + `detached:true` + **无** `windowsHide`，每次启动应用闪一次 cmd 窗口；改为 Windows 不开 detached 并补 `windowsHide: true`。
  3. 日志查看：新增 `server/utils/command-log.mjs`（`isCommandLogPath` 共享 + `readCommandLog` 尾部窗口）→ 新增 `GET /api/agents/:sessionId/command-log`（只放行 `<dataDir>/logs/commands/*.log`）→ 前端 Reader 新增 `source: 'command-log'` 虚拟文件通道 → 工具卡 console 块与后台命令浮层各加一个「查看完整日志」按钮，经 `quickforge:view-command-log` 事件由 `App.tsx` 转成 Reader 请求。
- 必须记住的取舍:
  1. 日志 tab **不持久化**（`serializePanelTabs` 跳过 `source === 'command-log'`）：刷新后重载日志必然 403/ENOENT，恢复只会得到一个红色错误页。
  2. 日志 tab **隐藏**「在资源管理器中显示 / 用编辑器打开」入口（`/api/workspace/open-external` 对工作区外路径 403）。
  3. 日志路径只认 `details.outputFile` 的**绝对路径**，且判定只保留 `isCommandLogPath` 一份，禁止各路由另写 `startsWith`。
- Evidence（验证）: 实机后台命令全程轮询新增可见窗口 `[]`；`details.running=true` 调用仍立即返回；`npx tsc -b --noEmit` 通过；`npx eslint` 改动文件 0 error；新增/更新 5 个测试文件。
- Blockers（阻塞）: 无。**未做真实浏览器手点**：「查看完整日志」按钮 → Reader tab 的观感、后台浮层新增按钮的排版都只做了 jsdom/源码断言，建议下次发布前手点一遍。
- Next Session（下一步）: ① 真机手点验证 Reader 日志 tab 与后台命令浮层按钮排版；② 用户机器上残留的 `WindowsTerminal.exe`（`node -e "setInterval(() => {}, 1000)"`，来自 `run-command-background.test.mjs` 的后台用例）属既有测试清理缺口，可考虑在该用例里显式杀掉；③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---


## 当前交接：session-open-fast-path-m4-slice3（done，2026-10-21）

- Current Objective（当前目标）: 把 `panel-decoration` 里剩余**可 React 化**的命令式注入器全部迁移为 surface 内 React 渲染（M4），每个模块单独可验证，最后自我评审。**已完成**。未提交。
- 落地 8 个（累计 10 个）：`model-controls`（24 行）、`context-compaction`（190 行）、`todo-write-summary` 控制器（约 230 行 → 96 行纯函数）、`reconnect-notice`+`model-retry-notice`+`unreachable-strip`（约 640 行 → 一个 `ConnectionNotices.tsx`）、`goal-control-strip` 控制器（约 520 行）、`local-file-path-links` 的 DOM 部分、`composer-plus-menu`（234 行）、`thinking-level-controls`（242 行）。映射表与拒因见 `docs/architecture/session-open-fast-path.zh-CN.md` §4 M4。
- **自我评审发现并修掉 3 个真实缺陷**（都是"测试全绿但功能已坏"的类型，务必记住）:
  1. **rehype 插件递归进自己的产物**：`qf-file-path` 的子文本仍是同一路径，插件再次拆分 → 无限嵌套 → `RangeError: Maximum call stack size exceeded`。后果是 **Markdown 里出现任何本地路径就白屏**。修法：产物标签加入跳过集合 + 只递归**原始**子节点。`tests/frontend/local-file-path-markdown.test.ts` 用「无嵌套 + 确实生成链接」双向锁定——只测纯函数发现不了这个，必须走 `MarkdownBlock` 渲染。
  2. **`+` 菜单弹层放错位置**：被渲染成触发器所在控制行的兄弟，而不是编辑卡片之前的独立块，`.quickforge-plus-popover` 的间距/宽度全部错位。修法：拆 `ComposerPlusTrigger` / `ComposerPlusPopover` 两个组件共用一个 `useComposerPlusMenu` controller，各自放回原插入点。
  3. **侧聊控件不再禁用**：装饰层删除后，`+`、思考档位、模型三个触发器在侧聊里仍可点（原本由 `disableComposerControls` 置灰）。修法：`composerControlsDisabled` prop，三个控件渲染 `disabled` 且忽略 pointerdown/keydown。
- 必须记住的等价性细节（第三轮追加 1 条，前两条沿用）:
  1. 停止按钮 `title`/`aria-label` 是**字面量 `"Stop"`**。
  2. 等待环清除时刻**不等于** `isStreaming && !streamingMessage`，仍由宿主显式提供。
  3. **模型按钮的 `aria-expanded` 不能由 React 声明**——菜单（`lib/custom-model-selector.ts`）自己写；React 一旦声明，每次流式快照重渲染都会把展开态抹掉。
- Evidence（验证）: `npm run test` **236 文件 2793 passed**；`npm run lint` **0 error**（仅既有 `GitToolsPinnedSummary` warning）；`npx tsc -b` 通过；`npm run build` 成功（4.22s）。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 剩下四件**不是"还没做"而是"不该按渲染迁移做"**——`assistant-artifact-card` / `message-actions` / `message-queue` 需要「消息根最后一个子元素」的位置语义且被 100+ 条源码文本锁保护，`process-folding.ts` 与 `ChatSurface` 的所有权租约强耦合是节点搬运而非渲染；若将来真要动，正确形态是「插入点仍命令式、内容 React 化」，并先补位置语义的测试。② 本轮只做了 jsdom 渲染断言，**没有跑真实浏览器**：`+`/思考弹层的定位、侧聊禁用态的观感、压缩横线在长列表里的位置都值得手点一遍。③ 未提交 Git；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 当前交接：workflow-detail-no-trace-trim（done，2026-10-21）

- Current Objective（当前目标）: 去掉 workflow subagent 详情的「本次运行的过程记录超出详情预算，已保留最近步骤」提示，即删除服务端所有详情裁剪逻辑（与主 Agent 一致）。**已完成**。未提交。
- 根因: 三层体积预算口径互相矛盾 —— 单 Agent trace 80K（运行中）/200K（终态）、details 总量 240K/500K、日志 50K。运行中 240K ÷ 80K = **3 个 Agent 必定触发裁剪**，而默认并发 4、maxAgents 24，多工具 Agent 的 50 条窗口几乎必然顶到 80K → 运行中帧几乎每次都在裁。裁剪标记 `subagentRunTruncated`/`subagentRunDropped` → 前端 `traceDropped` → `traceNotice` 块，就是那句提示；且 `traceTruncated` 只要为真就提示，即使前端已用 previous 回填出更完整的旧 trace。
- 修复: **全删裁剪 + 流式帧改结构性瘦身**。
  1. 服务端 `server/agent-workflow-runner.mjs` 删除 7 个预算常量 + 8 个裁剪函数（`compactJsonValue`/`compactSubagentMessage`/`sliceMessagesWithToolPairs`/`dropOrphanToolResults`/`compactSubagentRunDetails`/`detailsTextSize`/`trimSubagentTraces`/`trimDetails`，约 130 行），新增 `subagentRunDetails()` 仅挑字段、messages/tools 原样透传。`buildDetails` 不再包 `trimDetails`；运行中帧只给 running/queued 的 Agent 带 trace，其余打 `subagentRunDeferred: true`，终态帧带全部全量 trace。`MAX_LOG_ENTRIES = 200` 作为条数上限保留（非体积裁剪）。
  2. 前端删除 `traceDropped`、`traceNotice` 块、提示节点、`subagentTraceTruncated` 中英文案、`subagentRunDropped`/`subagentRunTruncated`；新增 `subagentRunDeferred`，`buildWorkflowSubagentRunPayload` 在 deferred 且本帧无消息时沿用 `previous.traceMessages`，不标「丢失」。
- Evidence（验证）: 定向 `npx vitest run tests/server/agent-workflow-runner.test.mjs tests/frontend/workflow-agent-run-events.test.ts` 39 passed；`npm run test` 405 文件 4644 passed / 2 skipped；`npm run lint` 0 error（仅既有 GitToolsPinnedSummary warning）；`npx tsc -b` 通过；`npm run build` exit 0。
- Blockers（阻塞）: 无。
- Next Session（下一步）: ① 旧会话里已持久化的 details 带旧裁剪痕迹，无法回溯补全，需重跑该 workflow；② 若担心单步消息量继续增长，可给 `subagentRun.messages` 做增量/分片（当前整份 details 每 200ms 重发是唯一剩余成本点）。未提交 Git；未手工修改生成产物。

---

## 当前交接：session-view-ready-republish（done，2026-10-21）

- Current Objective（当前目标）: 修「切到一个正在生成的会话、再切回来，永久卡在『正在加载对话』，只能刷新页面」。**已修**。未提交。
- 根因（两个条件同时成立才触发，所以前三轮验收全部漏掉）:
  1. 目标会话**仍常驻 `taskMap`** —— 只在会话正在生成时发生。空闲会话切走即被 `selectAgentTaskEvictions` dispose（`MAX_IDLE_AGENT_TASKS = 0`），切回走 `/view` + `restore` 拿到**新 agent 对象**，主 effect 会重跑；运行中的会话留在 `taskMap`，`performLoadSession` 命中 `runningTask` 分支走 `attachTaskToView(runningTask)`，复用**同一个 agent 对象**。
  2. 视图被 `SessionViewPool` **保活** —— 切回只翻 `display`，不 remount。
- 叠加结果: `[agent, agentRuntimeScopeId]` 全不变 → `ChatPanelHost` 主 effect 不重跑 → `onInitialRenderReady` 一次都不发 → `renderedLoadingSessionId` 永远 `undefined` → 淡出 effect 的 `rendered === visible` 前置条件不成立。`agent_end` 不碰 loading 状态，所以**本轮生成结束也不会自愈**。
- 修复（两层，刻意保持「一个发布者」）:
  1. 源头 `ChatPanelHost`: 就绪发布收敛成 `publishViewReady()`，由面板初始化（同时置位 `pendingHistoryHydration`）与活跃性回调的「回到前台」分支共同调用。幂等——`handleSessionInitialRenderReady` 只在 `visibleLoadingSessionIdRef` 等于该会话时生效。**全量补齐不会重复**：开关只由初始化路径置位，发布时消费一次并置 `historyHydrated`。
  2. 兜底 `useAppLoadingTransitions`: 10s 过渡看门狗，把 `rendered` 置为当前 `visible`（复用既有 280ms 淡出）并 `logger.warn`。安全网不是第二条路径——实测打开都在 300ms 量级，10s 只命中真正的信号丢失；单信号协议的失败模式是**永久**卡死界面，比提前揭示更糟。`rendered === visible` 时不 arm，不与正常 ready 抢时序。
- Evidence（验证）: 定向 vitest — `app-domain-hooks` 16（新增 2 例）、`chat-surface-behavior-alignment` 18（新增 2 例）、`session-view-activity` 10、`session-view-pool-dom` 9、`message-queue` 20、`chat-compact-controls` 11 全过；`tsc -b` 通过；eslint 4 个改动文件 0 error。**旧实现红灯验证**：新契约断言在 `HEAD` 源码上 4 项全部不成立。
- Blockers（阻塞）: 无技术阻塞。**未做浏览器实机复现**（需构造「生成中途切走再切回」时序）；根因与修复位置已由源码契约 + 旧实现红灯对照锁定，建议下次发布前补一次手工回归。
- Next Session（下一步）: ① 若仍要自动化锁定该场景，最小可行做法是在 App 层用假 agent 驱动 `beginSessionTransition` + `handleSessionInitialRenderReady` 的时序（`app-domain-hooks` 已具备该基建），而不是渲染真实 `ChatPanelHost`（其主 effect 依赖真实 DOM 与全套子系统）；② M4 其余模块按逐模块绞杀继续（见下条交接）。未提交 Git；未手工修改生成产物。

---

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

