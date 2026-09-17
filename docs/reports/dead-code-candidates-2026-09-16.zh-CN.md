# QuickForge 死代码清理候选清单（round2）

- **日期**：2026-09-16
- **分支**：`cleanup/dead-code`
- **基线**：`dev@10ecfebe8e6b29cf40f010e2df40efc70653003c`
- **状态**：已执行（2026-09-17），15 组确认删除、K8 保留（执行结果见第五节）

---

## 一、方法学

扫描采用「入口可达性 + 动态引用排查」双重防线，全部为只读调研，未修改任何代码。

**入口白名单**（从真实入口出发判定可达性）：

- `bin/quickforge.mjs`
- `server/index.mjs`
- `public-api.mjs`
- `restart/update-supervisor.mjs`
- `maintenance/*-v1.mjs`
- `sqlite/session-state-worker*.mjs`
- `acp/server.mjs`
- `src/main.tsx`、`App.tsx` 及 5 个 lazy 目标
- `desktop/electron-main.mjs`

**动态引用排查清单**（防止静态零引用被误判为死代码）：

- `spawn` 目标：`index.mjs:76-77`
- `Worker` 目标：`session-state-worker-client.mjs:40`
- `createRequire` 目标：`terminal-manager`、`ripgrep`
- plugins loader manifest
- 变量 import 仅两处：`public-api.mjs:240` 与 `plugins/loader.mjs:27`
- 字符串 import 枚举

**grep 排除目录**：`coverage`、`.goal-runtime-refactor-baseline`、`.dev-ui-review`、`docs/archive`、`dist` 等生成物目录。

---

## 二、候选清单（18 项）

以下每项按「位置｜类型｜证据｜动态引用排查结论｜风险｜建议动作」呈现。**全部候选均未执行删除，逐项待用户确认。**

### 前端 A 区

#### A1 · 完全死类型（3 个）

- **位置**：`src/lib/chat-utils.ts:45` `CapabilitySuggestionElement`、`chat-utils.ts:54` `CapabilityTextareaElement`、`src/components/chat/pi-chat.ts:36` `ConfiguredModel`
- **类型**：纯死类型定义
- **证据**：全仓 word 级检索仅命中定义行本身，无任何引用
- **动态引用排查结论**：类型无运行时形态，不参与字符串/变量 import
- **风险**：极低（无消费者）
- **建议动作**：删除 3 处类型定义

#### A2 · 48 个零引用值导出（去 `export` 或删函数/常量）

- **位置与证据**：全仓 word 级检索零引用，分三批：
  - **12 个单发函数**：`goal-ui.ts:386` `goalActionErrorMessage`、`model-identity.ts:12` `normalizeModelBaseUrl`、`message-queue.ts:140` `isRealQueueSessionId`、`panel-decoration/thinking-level-controls.ts:16` `isQuickForgeThinkingLevel`、`panel-decoration/message-actions.ts:292` `decorateTextAttachmentTiles`、`workspace-inspector-tabs.ts:229` `findSubagentRunTab`、`workspace/side-chat-client.ts:50` `serializeSideChatRequest`、`system-notifications.ts:62` `syncNativeNotificationService`、`startup-model.ts:17` `sameStartupModel`、`workspace-tree-state.ts:44` `workspaceTreeDepth`、`subagent-run-detail.ts:333/340` `subagentRunLabel`/`subagentRunStatusLabel`
  - **14 条常量**：`workspace-api.ts:90` `GIT_STATUS_CACHE_TTL_MS`、`side-chat-agent.ts:8` `MAX_SIDE_CHAT_INPUT_CHARS`、`model-list-cache.ts:5` `MODEL_LIST_CACHE_TTL_MS`、`memory-settings.ts` `MEMORY_SETTINGS_KEY`、`mermaid-renderer.ts` `MERMAID_SOURCE_MAX_LENGTH`、`sidebar-section-order.ts` `SIDEBAR_SECTION_IDS`、`session-message-cache.ts` `SESSION_MESSAGE_SNAPSHOT_SCHEMA_VERSION`、`app-settings-cache.ts` `APP_SETTINGS_SNAPSHOT_SCHEMA_VERSION` + `APP_SETTING_SNAPSHOT_KEYS`、`workspace-cache.ts:13` `WORKSPACE_CACHE_SCHEMA_VERSION`、`tool-marquee.ts` `MARQUEE_ROLL_EASING`、`window-guard.ts:16` `WINDOW_GUARD_RETRY_DELAY_MS` + `WINDOW_GUARD_MAX_RETRIES`、`pinned-summary-drag.ts:31` `PINNED_SUMMARY_VIEWPORT_INSET`、`indexeddb-cache.ts:12` `CACHE_DB_NAME` + `CACHE_STORE_NAME`、`panel-decoration/assistant-artifact-card.ts:12` `ASSISTANT_ARTIFACT_CARD_CLASS`
  - **其余零散项**：`chat-utils.ts` 6 函数、`browser-connection-diagnostics.ts` 5 项、`cloud-remote-client.ts` 4 项、`input-clamp.ts` 4 项、`custom-providers-only-tab.ts` 整类导出、`model-aggregation.ts` `sameAvailableModel`、`cloud-client.ts` `requestCloudJson`
- **类型**：零引用值导出（死函数/死常量）
- **动态引用排查结论**：均为具名导出的值，不属于变量/字符串 import 目标，动态引用可排除
- **风险**：低；**注意**：3 个 `*_SCHEMA_VERSION`（`SESSION_MESSAGE_SNAPSHOT_SCHEMA_VERSION`、`APP_SETTINGS_SNAPSHOT_SCHEMA_VERSION`、`WORKSPACE_CACHE_SCHEMA_VERSION`）疑似公共契约常量，需单列确认后再动
- **建议动作**：纯死函数直接删；有本地使用者的去 `export`；3 个 SCHEMA_VERSION 单列确认

#### A3 · 153 个零引用类型导出（去 `export type` 或删纯死类型）

- **位置与证据**：聚集文件：`cloud-client.ts` 10 类型、`subagent-run-detail.ts` 7、`process-folding.ts` 6、`slash-invocation-chip.ts` 4、`remote-tunnel.ts` 5、`pinned-summary-drag.ts` 5、`workspace-cache.ts` 5、`workspace-tree-state.ts` 4、`window-guard.ts` 4、`indexeddb-cache.ts` 4、`diff-view.ts` 4、`todo-write-history.ts` 4、`useUpdateCheck.ts` 3、`cloud-account-settings-state.ts` 3、`migration-status.ts` 3、`approval-card.ts` 3；长尾约 65 个散布约 40 个文件
- **类型**：零引用类型导出
- **动态引用排查结论**：类型无运行时形态，不参与动态 import；`verbatimModuleSyntax` 下 `export type` 可安全移除
- **风险**：中低（数量大，个别可能被测试或生成代码引用，需逐项复核）
- **建议动作**：纯死类型删除；有本地使用者的去 `export type`；可脚本化批量处理但需逐项复核

### server B 区

#### K1 · `GET /api/workspace/tree`

- **位置**：`server/routes/workspace.mjs:478` handler 分支，`handleWorkspaceTree:78`；注册于 `server/index.mjs:508`
- **类型**：兼容路由
- **证据**：`src/`、`tests/`、`desktop/` 全 0 引用；仅 wiki `docs/wiki/server/routes/README.md:318,335` 记载"兼容旧客户端"
- **动态引用排查结论**：HTTP 路由无字符串 import 形态；前端调用方为零
- **风险**：低（仅外部旧客户端理论可达）
- **建议动作**：删 handler + 路由分支 + wiki 对应 2 行

#### K2 · `GET /api/workspace/mention-search`

- **位置**：`server/routes/workspace.mjs:494`
- **类型**：兼容路由
- **证据**：`src/` 0 引用；但 `tests/` 有 3 文件 5 处：`workspace-mention-dispatcher.test.mjs:8`、`workspace-tree-on-demand.test.mjs:370,416`、`workspace-mention-project-context.test.mjs:95,112`
- **动态引用排查结论**：同 K1，无动态引用形态
- **风险**：低-中（需同步改测试）
- **建议动作**：删路由分支，同步更新上述测试引用与 wiki 对应 2 行

#### K3 · `GET /api/system/status`

- **位置**：`server/routes/system.mjs:60`；注册于 `server/index.mjs:555`
- **类型**：死路由
- **证据**：全仓（src/tests/desktop）0 引用；`getSystemStatus` 被 `index.mjs:557` 复用，函数本体保留
- **动态引用排查结论**：无动态引用形态
- **风险**：极低
- **建议动作**：仅删路由分支

#### K4 · `GET /api/system/update/desktop` + 孤儿链 `checkDesktopRelease`

- **位置**：`server/routes/system.mjs:17`；注册于 `server/index.mjs:555`；孤儿链 `server/utils/package-update.mjs:263` `checkDesktopRelease`
- **类型**：死路由 + 孤儿函数
- **证据**：路由唯一生产消费在 `index.mjs:561`；`checkDesktopRelease` 有直测 `tests/server/package-update.test.mjs:8,283,293`
- **动态引用排查结论**：无动态引用形态
- **风险**：低（需同步删直测）
- **建议动作**：删路由分支 + `checkDesktopRelease` + 同步删其直测

#### K5 · `GET/PUT /api/mcp/config`

- **位置**：`server/routes/mcp.mjs:28,64`；注册于 `server/index.mjs:480`
- **类型**：被取代的兼容路由
- **证据**：已被 `/api/mcp/servers` 取代；`tests/server/routes/mcp.test.mjs:134,147,157,195` 四用例仍覆盖；wiki `routes/README.md:390` 与 `docs/wiki/browser-cache-strategy.md:17` 有记载
- **动态引用排查结论**：无动态引用形态
- **风险**：中（测试 + 两处文档需同步）
- **建议动作**：删两个路由分支，同步删 4 个测试用例、更新 wiki 2 处

#### K6 · `POST /api/lan-access/logout`

- **位置**：`server/routes/lan-access.mjs:418`；注册于 `server/index.mjs:381`
- **类型**：死路由
- **证据**：`tests/server/lan-access.test.mjs:89` 一处；wiki `routes/README.md:293`
- **动态引用排查结论**：无动态引用形态
- **风险**：低
- **建议动作**：删路由分支 + 同步测试 1 处 + wiki 1 行

#### K7 · 前端 confirm 恒假链

- **位置**：`src/lib/goal.ts:297-299`（恒 `false`）→ `src/components/chat/panel-decoration/goal-card.ts:185`（`confirmable`）→ `src/components/workspace/GoalInspectorContent.tsx:268`（恒不渲染分支）；`GoalAction` 的 `'confirm'` 字面量在 `goal.ts:101,145`
- **类型**：恒假条件死链
- **证据**：`goal.ts:297-299` 硬编码恒 `false`，下游 confirm UI 恒不渲染
- **动态引用排查结论**：纯前端逻辑链，无动态引用形态
- **风险**：低；**注意**：server 端 `agent-goal-state.mjs:102-103` 与 `agent-goal-runner.mjs:1112-1132` 的 confirm 处理仍活跃，**保留不动**
- **建议动作**：删前端恒假链 + `GoalAction` 的 `'confirm'` 字面量 + i18n `goalConfirm` key

#### K8 · `isSessionTextAttachmentPath`

- **位置**：`server/text-attachments.mjs:53`
- **类型**：零引用函数（安全预留）
- **证据**：代码引用 0
- **动态引用排查结论**：无动态引用形态
- **风险**：属附件沙箱豁免的潜在接线点（见 `goal-attachment-missing-marker` boundaries 遗留①）
- **建议动作**：安全预留待产品决策，**默认保留**

#### K9 · `server/cloud/index.mjs` facade

- **位置**：`server/cloud/index.mjs`（8 行 facade）+ `tests/server/cloud/index.test.mjs`
- **类型**：孤儿模块
- **证据**：生产 0 引用；`routes/cloud.mjs` 直引子模块；`package.json` 无 `exports` 字段（不存在子路径导入约束）
- **动态引用排查结论**：非字符串/变量 import 目标；非 package exports 入口
- **风险**：低
- **建议动作**：删 facade 及其测试

### 杂项 C/D 区

#### O1 · `.playwright-mcp/` 目录

- **位置**：仓库根 `.playwright-mcp/`
- **类型**：未跟踪运行产物
- **证据**：61 个日志文件，零引用，当前未跟踪（`git status` 可见 `?? .playwright-mcp/`）
- **动态引用排查结论**：纯运行日志，无代码引用
- **风险**：无
- **建议动作**：删除目录 + 补 `.gitignore` 条目

#### O2 · `$null` 文件

- **位置**：仓库根 `$null`
- **类型**：未跟踪误产物
- **证据**：cmd 误重定向产物（PowerShell `$null` 语法在 cmd 下被当作文件名），未跟踪
- **动态引用排查结论**：无
- **风险**：无
- **建议动作**：删除

#### DEP1 · `@emnapi/core` + `@emnapi/runtime` devDependencies

- **位置**：`package.json` devDependencies
- **类型**：冗余显式声明
- **证据**：代码与配置零引用；系 WASM 相关包的传递依赖，npm 会自动安装
- **动态引用排查结论**：非直接 import；为传递依赖
- **风险**：低——删除声明会损失版本 pin（由传递依赖方决定版本）
- **建议动作**：可删声明（接受失去显式 pin）或保留（维持版本锁定），待用户决策

#### D1 · `android/.../SignalReconnectBackoff.kt`

- **位置**：android SignalReconnectBackoff.kt
- **类型**：死类（被内联替代）
- **证据**：全仓仅测试（见 D2）与 `docs/design/remote-access-p2p.md:40,265,274` 命中；无反射字符串引用；替代实现已内联 `RemoteTunnelService.kt:1198-1205`
- **动态引用排查结论**：无反射字符串，内联替代已存在
- **风险**：低（需同步 design 文档 3 处）
- **建议动作**：删类 + 同步 design 文档 3 处描述

#### D2 · `android/.../SignalReconnectBackoffTest.kt`

- **位置**：android SignalReconnectBackoffTest.kt
- **类型**：死类直测
- **证据**：仅测试 D1 的用例，随 D1 一并失效
- **动态引用排查结论**：无
- **风险**：无（与 D1 绑定）
- **建议动作**：随 D1 一并删除

#### D3 · `scripts/prune-offline-package.cjs`

- **位置**：`scripts/prune-offline-package.cjs`
- **类型**：孤儿脚本
- **证据**：仅 wiki `docs/wiki/scripts/README.md:10,45` 引用；无 npm script、无 spawn 调用
- **动态引用排查结论**：非 npm script、非 spawn 目标
- **风险**：低（可能是手动运维脚本）
- **建议动作**：删 + 同步 wiki，或保留并在 wiki 标注"手动执行"

---

## 三、建议保留清单

以下在扫描中确认**不是**死代码，明确保留，勿删：

- `server/utils/process-tree.mjs`——health-check B3/P2 的收敛目标，勿删
- `benchmark/` 与 `vendor` 脚本——工具链用途
- `desktop/` 全部——Electron 入口链
- 全部其余依赖——`ws`/`xlsx`/`lit`/`monaco`/`@vscode/ripgrep` 等均有动态或配置引用
- 注释掉的代码块——全仓零命中（此前轮次已清理）
- `review-*.png` 与 `welcome.png`——文档引用中

---

## 四、执行注意

1. 删除获确认后需**同步 wiki 路由文档**（K1/K2/K5/K6 涉及 `docs/wiki/server/routes/README.md` 等）。
2. 涉及导出变更的批次需**跑导出契约测试**（A2/A3）。
3. 删除完成后跑**全量 `npm run test` / `npm run lint` / `npm run build`**。
4. A2/A3 可脚本化批量处理（AST 或正则），但**需逐项复核**，防止误伤测试/生成代码引用。
5. 按 goal 约束：**未经用户逐项确认，不得删除任何一项**；本轮零删除。

---

## 五、执行结果（2026-09-17）

用户确认删除 **15 组**；K8 按建议保留。逐项处置如下：

### 前端 A 区（A1-A3 合并执行）

- **处置**：零引用导出清理共处理 220 项——`lib/hooks` 155 项（154 项去 `export` + 1 项删除 `ConfiguredModel`）、`components` 65 项（63 项去 `export` + 2 项删除 `CapabilitySuggestionElement`/`CapabilityTextareaElement`），涉及 92 个 src 文件。
- **回归与修复**：其中 3 个符号（`serializePanelTabs`/`browserTabFilePath`/`decorateUserContextChips`）系审计漏报 tests 实际引用，删除后 18 用例失败，已恢复 export 并复验通过；**净清理 217 项**。

### server K 区

- **K1 已删除**：`GET /api/workspace/tree` handler+路由分支与 `server/index.mjs` 注册。
- **K2 已删除**：`GET /api/workspace/mention-search`；mention 相关 3 个测试文件同步。
- **K3 已删除**：`GET /api/system/status` 路由分支（`getSystemStatus` 函数本体保留）。
- **K4 已删除**：`GET /api/system/update/desktop` + 孤儿链 `checkDesktopRelease` 及 `cooldownLoad`/`updateCheckCooldowns`/`QUICKFORGE_LATEST_RELEASE_API_URL`（`server/utils/package-update.mjs`）；对应 describe 测试块删除。
- **K5 已删除**：`GET/PUT /api/mcp/config`；`tests/server/routes/mcp.test.mjs` 4 用例同步删除。
- **K6 已删除**：`POST /api/lan-access/logout`；`tests/server/routes/lan-access.test.mjs` 1 处同步。
- **K7 已删除（仅前端链）**：`goal.ts` `goalCanConfirm` 与 `GoalAction` 的 `'confirm'` 字面量、`goal-card.ts` `confirmable` 字段、`GoalInspectorContent.tsx` 恒假分支；3 个前端测试文件剔除恒假断言。**保留**：i18n `goalConfirm` key（`extend_resume` 活跃消费）；server 端 confirm API（`agent-goal-state.mjs`/`agent-goal-runner.mjs`）未动。
- **K8 保留**：`isSessionTextAttachmentPath`——附件沙箱豁免潜在接线点，安全预留待产品决策。
- **K9 已删除**：`server/cloud/index.mjs` + `tests/server/cloud/index.test.mjs` 整文件删除。
- **K 批文档同步**：`docs/wiki/server/routes/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/utils/README.md`、`docs/architecture/browser-cache-strategy.zh-CN.md`。

### 杂项 C/D 区

- **O1 已删除**：`.playwright-mcp/` 目录（59 个文件）；`.gitignore` 新增对应条目。
- **O2 已删除**：`$null` 文件。
- **DEP1 已删除声明**：`package.json` + `package-lock.json` 删除 `@emnapi/core`、`@emnapi/runtime` 声明（各 2 行）；传递依赖保留。
- **D1+D2 已删除**：`SignalReconnectBackoff.kt` + 其测试；`docs/design/remote-access-p2p.md` 3 处同步。
- **D3 已删除**：`scripts/prune-offline-package.cjs`；`docs/wiki/scripts/README.md` 同步。

### 保留确认

与第三节建议保留清单一致：`process-tree.mjs`（收敛目标）、`goalConfirm` i18n key、全部 `benchmark/` 与 `vendor` 脚本均保留。

### 最终验证（2026-09-17）

- `npm run test`：354 files / 4101 passed + 1 skipped，exit 0。
- `npm run lint`：0 errors（仅既有 coverage 3 warnings）。
- `npm run build`：exit 0（仅既有 KaTeX/chunk warning）。
- Android：零引用纯删除，未跑 gradle，静态验证。

全部删除改动位于 `cleanup/dead-code` 分支工作区，未提交（commit 时机由用户决定）。
