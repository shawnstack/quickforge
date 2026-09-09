## 当前交接：subagent-run-detail-model-thinking 已完成（2026-09-09，done）

- 当前状态：代码、测试、文档完成；定向前端 99 tests、服务端 14 tests、`npm run lint`（0 error）、`npx tsc -b`、`npm run build` 全部通过；未 commit（遵循项目规则，等待用户指示）。
- 需求：点击 subagent 摘要打开的运行详情页（Workspace Inspector `kind:'subagent'` Tab）展示本次运行实际使用的模型与思考等级，范围仅详情页。样式两轮调整（用户确认）：最终为任务说明块上方独立一行、居中，只显示「模型名 · 思考等级」，不带标签与继承标记。
- 改动文件（7，i18n 无净新增）：`server/agent-subagent-runner.mjs`（新增 `subagentRuntimeDetails`，三处 details 展开）、`src/lib/subagent-run-detail.ts`（新增类型/payload 字段/解析/`'meta'` block/两个展示纯函数）、`src/lib/local-tools.ts`（新增 `renderSubagentRunMeta`，任务说明块上方独立一行居中）、`tests/frontend/subagent-run-detail.test.ts`、`tests/server/agent-manager.subagents.test.mjs`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/README.md`。
- 关键设计：服务端继承模型时补 `provider/id/name`（旧快照只有 `{mode:'inherit',inherited:true}`）；thinkingLevel 复用主 Agent i18n；meta 块不受 `detailed` 门控；产出条件为「有可显示模型标识或 thinkingLevel」（父 Agent 审查时修复的空块缺陷，已加回归用例）；渲染层 meta 独立于任务气泡，位于其上方一行。用户反馈「没看到思考等级」：该字段只对改动后新产生的运行生效，历史 details 无此字段，需重启 dev server 重跑验证。
- Blocker：无。
- 下一步：① 浏览器冒烟——点开运行中/已完成 subagent 详情，任务气泡顶部居中显示「provider / id · 高」，非推理模型显示「关」，长任务收起/展开不遮挡该行；② 用户决定 commit/发布（发布走 `docs/architecture/patch-release-runbook.zh-CN.md`）；③ 工作区仍有他人未提交 WIP，提交时注意分离。
- 上一轮：remove-opencode-harness（详见 progress.md）。

---

## 上一轮交接：remove-opencode-harness 已完成（2026-09-09，done）

- 当前状态：代码、测试、文档全部完成；`npm run test`、`npm run lint`、`npm run build` 全量验证通过；未 commit（遵循项目规则，等待用户指示）。
- 本次改动概览（一句话级清单）：
  - server：删 `opencode-acp-agent.mjs`、`agent-harness.mjs`（访问模式 helper 迁回 agent-manager.mjs 并新增内部导出 `hasFullAccess`，agent-subagent-runner 的 import 已改）；routes/agent.mjs 删 harness/config-option、harness/mode、fork 三条路由；agent-persistence 删 harness/harnessSessionId/openCodeUsage；agent-approval-orchestrator 删 createAcpApprovalPromise；sqlite v11 迁移与 session-state-repository/session-state-service 去 harness 列/字段；另有 agent-compaction/context-references/routes/side-chat/agent-session-store 清理。
  - src：新增 `src/lib/chat-capabilities.ts`（QUICKFORGE_CHAT_CAPABILITIES/SIDE_CHAT_UI_CAPABILITIES/applyChatPagePolicy/shouldSendComposerInput）与 `src/lib/cross-tab-events.ts`（getCrossTabSyncSourceId）；删 opencode-config-mode-usage 三个菜单文件、deferred-session-harness.ts、default-harness-events.ts、chat-harness-capabilities.ts；types.ts/server-agent.ts/startup-model.ts/pi-chat.ts/local-tools.ts/todo-write-history.ts/panel-decoration 系/ChatPanelHost.tsx/App.tsx/三个 hooks/default-options-settings-tab.ts（整个默认 Harness 选择器删除）/i18n.ts（openCode* 与 defaultHarness* 文案）/index.css（三段样式）清理完毕。
  - tests：删 opencode-acp-agent.test.mjs、agent-harness.test.mjs（appendAssistantErrorMessageOnce 用例迁至新建 `tests/server/agent-session-events.test.mjs`）、opencode-config-menu.test.ts、deferred-session-harness.test.ts、chat-harness-capabilities.test.ts（新建 `tests/frontend/chat-capabilities.test.ts`）；修复/改写约 30 个测试文件（含源码契约切片边界与 vi.mock 清理）；另为满足 harness 0 命中将 17 个测试文件的通用脚手架标识符（createHarness→createEnv 等）中性化重命名。
  - docs：删 `docs/architecture/agent-harness-selection.zh-CN.md`；更新 docs/wiki 各 README 与 session-storage-v2 架构文档。
  - CHANGELOG：顶部新增 `[Unreleased]` Removed/Breaking Changes 英文条目。
- 模块变更说明：`src/lib/chat-harness-capabilities.ts` → `src/lib/chat-capabilities.ts`（能力常量与页面策略，去 harness 语义）；`src/lib/default-harness-events.ts` → `src/lib/cross-tab-events.ts`（getCrossTabSyncSourceId）；`hasFullAccess` 访问模式 helper 从 agent-harness.mjs 迁回 agent-manager.mjs 内部导出（agent-subagent-runner 改从该处 import）；sqlite v11 迁移不再创建 harness 列，repository/service 同步去字段。
- 兼容性说明：存量 OpenCode 会话降级为 QuickForge 会话，不做向前兼容（harness/harnessSessionId/openCodeUsage 持久化字段直接消失，旧数据按 QuickForge 会话恢复），已在 CHANGELOG Breaking Changes 记录。保留项已验证完好：`.opencode/` 目录生态兼容、`@agentclientprotocol/sdk` 与 `server/acp/`、session_forked 事件、审批共享流。
- Blocker：无。
- 下一步：① 用户 review 并决定 commit/发布——发布需走 `docs/architecture/patch-release-runbook.zh-CN.md` 或用户指定流程，注意工作区还有他人未提交 WIP（new-chat-greeting、file-rollback、session-file-backups 等）需先分离提交；② package-dist/package-offline 生成产物待下次打包自然更新；③ 如需回退测试脚手架标识符中性化重命名（createHarness→createEnv 等）可单独处理。
