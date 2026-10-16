# QuickForge 死代码评审报告（round3）

- **日期**：2026-10-16
- **基线**：dev 工作区（v2.2.6，含 prefer-background-commands 未提交改动）
- **性质**：评审后已执行 A 区高置信度清理；B/C/D 区未处理
- **前置**：round2（`dead-code-candidates-2026-09-16.zh-CN.md`）已执行项不重复计入

---

## 一、方法学

三路独立扫描交叉验证，互相印证后只保留有 grep 证据的结论：

1. **import 引用图**：857 个源文件（server/src/bin/desktop/scripts/tests/.husky + 根配置），从真实入口 BFS（`server/index.mjs`、`server/public-api.mjs`、`bin/quickforge.mjs`、`desktop/electron-main.mjs`、`desktop/electron-builder.config.cjs`、`desktop/nsis-patch/apply.mjs`、`scripts/prepare-patch-release.cjs`、`src/main.tsx`、`vite.config.ts`、`eslint.config.js`），446 可达。修复了扫描器自身 `@/` 别名解析缺陷（曾误拼成 `src/src/...` 导致前端整棵树假性不可达）。
2. **server 子任务**：147 个 .mjs acorn AST 级扫描（不可达语句/重复 case/常量条件）+ 标识符级全仓引用分析。
3. **前端子任务**：302 个 .ts/.tsx 标识符引用分析 + 字符串协议配对（i18n / 自定义事件 / 工具渲染器 / BroadcastChannel / CSS 类）。

**排除**：`dist/`、`package-dist/`、`package-offline/`、`node_modules/`、`desktop-dist/`、android 生成资产。**tests/ 引用单独归类，不算生产引用。**

## 二、总览结论（均为"干净"）

| 维度 | 结论 |
|---|---|
| 僵尸文件 | **0**。18 个静态不可达文件全部有引用：`electron-preload.cjs`（electron-main preload 路径）、`sqlite/session-state-worker.mjs`（Worker 字符串目标）、`restart-supervisor.mjs`/`update-supervisor.mjs`（spawn + 直测 + 文档）、`maintenance/*-v1.mjs` ×7（迁移 runbook 手动工具 + 直测 + 文档）、`prepare-offline/runtime-package.cjs`（patch-release runbook）、`vendor-node-pty.mjs`（prepare-patch-release 调用链）、benchmark/spike 脚本 ×5（wiki/架构文档记载的手动工具，spike 见 D 区） |
| 不可达分支 | **0**。return/throw 后语句、`if(true/false)`、`while(false)`、重复 case、`if(A)...else if(A)`、`x && !x`——双端扫描零命中；round2 K7 前端恒假链确认已删净 |
| 死环境变量门控 | **0**。全部 `QUICKFORGE_*` 变量有用户侧写入（HOST/PORT/LOG_LEVEL 等）或内部写入点（SHARE_LAN←bin、ALLOW_REMOTE←index、VITE_PORT←public-api 等） |
| context-eviction 移除残留 | **0**。`contextEviction`/`context-eviction`/`context_forget` 等在 server/、src/、bin/、desktop/、scripts/、skills/、plugins/ 零命中（仅 feature_list/progress 历史记录） |
| 协议孤儿 | **0**。SSE 事件（服务端 emit ↔ 前端 29 种订阅，含 `turn_start` 经 agent_event 动态转发）、工具渲染器（前端 14 ↔ 服务端 13+generate_image）、window 自定义事件 6 组、BroadcastChannel 4 类消息——全部双向配对 |
| server 模块内私有函数 / 前端非导出函数 | **0** 死函数 |

## 三、A 区：零引用死代码（连 tests 都不引用，置信度高）

| # | 位置 | 内容 | 建议 |
|---|---|---|---|
| A1 | `server/session-state-service.mjs:432` | 初步扫描误判为零引用；实际是 `storage.mjs` 动态 facade 的接口，测试会通过 facade 委托调用 | **不清理，保留** |
| A2 | `src/components/chat/panel-decoration/icons.ts:7` | `runIcon`（同组 rollback/fork/retry/plan 均在用） | **已清理** |
| A3 | `src/components/settings/tabs/shared.tsx:59` | `sliderProgressStyle()` | **已清理** |
| A4 | `src/components/chat/surface/ChatSurface.tsx:225` | `CHAT_SURFACE_REFRESH_EVENTS`（`SUBSCRIBED_EVENTS` 纯别名，本体经 `isSnapshotRefreshEvent` 存活） | **已清理** |
| A5 | `src/lib/i18n.ts` | 6 个孤儿键（en+zh 各 6 行）：`displayLanguage`、`openLocalFile`、`execute`、`taskScheduleSavePreview`、`taskList`、`artifacts`；已排除动态 `t()` | **已清理 12 行** |
| A6 | `src/index.css` | capability-suggestions 建议列表整组 CSS及 `message-queue.ts` 死查询项；该 UI 已删，仅剩 command/file-reference/context-chip/capability-chip | **已清理** |
| A7 | `src/index.css` 零散死类 | 已确认无源码/测试消费者的 settings、context usage、project picker 类；`quickforge-tool-message` 因已有 CSS 契约测试保留 | **已清理已确认项** |
| A8 | `server/text-attachments.mjs:53` | `isSessionTextAttachmentPath()` | **保留**（round2 K8：附件沙箱安全预留，待产品决策） |

## 四、B 区：仅测试存活的生产零调用导出（server 27 项）

「被变体取代」特征最明显（建议优先处理）：

| # | 位置 | 内容 |
|---|---|---|
| B1 | `server/utils/scheduled-tasks.mjs:171` | `cronMatches()`——生产 cron 调度走 `nextCronRun` 内部直调 `cronRulesMatch`，完全绕过此导出 |
| B2 | `server/lan-access-store.mjs:283` | `revokeLanAccessToken(token)`——路由实际用 `revokeLanAccessTokenById`/`revokeLanAccessTokens`（routes/lan-access.mjs:415,423）；smoke fixture `tests/fixtures/session-state-full-chain-electron-smoke.mjs:281` 也在用 |
| B3 | `server/ai-provider-options.mjs:9` | `DEFAULT_AI_STREAM_DEADLINE_MS`——旧名别名（现名 `DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS`） |

其余 24 项（生产零调用、tests 直测维持存活；部分为测试注入点属有意设计）：

- `server/subagents.mjs:116` `getSubagentDefinition`
- `server/agent-profiles.mjs:351` `updateBuiltinAgentModelOverride`
- `server/mcp/config.mjs:188` `writeMcpServers`
- `server/utils/network.mjs:11` `isTailscaleAddress`
- `server/startup-state.mjs:61` `resetStartupState`
- `server/hooks/hook-engine.mjs:39` `getRecentHookExecutions`
- `server/text-attachments.mjs:48` `readTextAttachment`
- `server/runtime-diagnostics.mjs:79` `isRuntimeDiagnosticsEnabled`（其门控的 `QUICKFORGE_DIAGNOSTICS` 本身是活的）
- `server/lan-access-service.mjs:153` `listLanAccessMirrorQueue`、`server/share-service.mjs:151` `listShareMirrorQueue`（mirror 队列无读取方）
- `server/session-index-service.mjs:120/131/141` `configureSessionIndex`/`syncSessionMetadataCommit`/`markSessionIndexQueryFailure`
- `server/session-state-backup.mjs:172` `computeSessionSnapshotDigest`
- `server/session-state-service.mjs:67/493/716` `configureSessionStateService`/`saveSessionMetadata`/`getSessionStateDiagnostics`（`configureSessionStateService` 被 13 个测试文件用作注入点）
- `server/storage.mjs:653/663/764/784/990/1160` `writeSessionValue`/`deleteSessionValue`/`readPhysicalSessionMetadataBuckets`/`readAuthoritativeSessionMetadataBuckets`/`atomicSessionMetadataUpdate`/`writeProjectConfigData`（storage v2 facade 迁移后的孤儿层）
- `server/routes/backup.mjs:39` `createInternalBackupContext`

删除任意一项需同步其直测。命名明示测试专用的 2 项（`terminateSessionStateWorkerForTests`、`vendoredPtyEntryPath`）不计。

## 五、C 区：导出冗余（本体存活，仅 `export` 关键字无外部消费者，不建议动）

- server ~60 项：`isGoalPlanning`、`GOAL_PLANNING_PERMISSIONS`、`GOAL_MAX_EVIDENCE` 族、`agentProfileToMarkdown`、`loadUserAgentProfiles`、`AGENT_PROFILE_MODEL_INHERIT`、`CAPABILITY_POLICIES`、`listBuiltinAgentProfiles`、`COMPACT_SYSTEM_PROMPT`、`MODEL_REFERENCE_VERSION`、`PLUGIN_API_VERSION`、`askUserTool`、`SQLITE_*` PRAGMA 常量、`spawnCollect`、`verifyRipgrepExecutable` 等
- 前端 ~54 项：`GoalCriterion`、`GoalBudget`、`MathToken` 族、`ToolDisplaySettings`、`SessionTitleSource`、`SendMessageContext`、`runtimeIdsFromDetails`（内部 :541 在用）、`renderStatusIcon`（内部 :447 在用）等
- barrel 冗余转发：`tool-renderers/index.ts` 的 `renderSubagentRunSummary`/`elapsedMsFromTiming`、`panel-decoration.ts:69` 的 `normalizeTodoWriteTodos`

## 六、D 区：边界项（需产品决策）

- `scripts/sqlite-compatibility-spike.mjs` + `tests/server/sqlite-compatibility-spike.test.mjs` + `docs/architecture/sqlite-compatibility-spike.zh-CN.md`：历史实验脚本，仅靠文档与测试存活，可整体归档/删除。

## 七、验证记录

- 抽检复核：`readSessionIdentityRows` 通过动态 facade 与 storage 测试调用，确认为误报并保留；6 个 i18n 键、`quickforge-capability-suggestion*`、`sliderProgressStyle`、`runIcon`、`CHAT_SURFACE_REFRESH_EVENTS` 均无生产/测试消费者并已清理；`runtimeIdsFromDetails`/`renderStatusIcon` 确认为内部使用、非死代码。
- 18 个静态不可达文件的字符串引用逐一核实（源码/测试/文档/npm scripts 链）。本次仅执行 A 区高置信度前端/接口清理；B 区测试专用导出、K8 安全预留、C 区导出冗余、D 区历史 spike 均未处理。
- 注：行号为当前 dev 工作区快照，执行清理时以实际内容为准。
