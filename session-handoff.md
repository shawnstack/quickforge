# Session Handoff

## 当前状态

- 本会话目标：ask_user 工具——模型向用户提问（多问题、选项+自由输入），经三轮设计稿对齐（单问题卡 → 多问题向导"点完自动进下一问、末步统一提交" → 已答后像工具一样折叠）后落地。
- 最终状态：**已完成并验证**（全量 test 217 文件 1795 用例 / lint 0 error / build 通过；真实会话内目视确认留待用户）。

## 实现要点（速览）

- 服务端：
  - `server/tools/definitions.mjs`：新增 `askUserTool`（questions 1-4，每问 options≤4 / multiSelect / allowCustom），加入 workspaceTools。
  - `server/ask-store.mjs`（新）：`pendingAsks` Map、`getPendingAskForSession`、`ASK_TIMEOUT_MS=30min`、纯函数 `normalizeAskQuestions`（兼容 `{question,options}` 单问简写）/`formatAskResult`（回答→纯文本回给模型；超时/跳过/abort→"用户没有回答…请按默认方案继续"）。
  - `server/agent-manager.mjs`：`wrapAskUserToolDefinition` 拦截（仿 run_subagent，无 toolHandlers 入口）；`createAskUserPromise`（execute 阻塞 + SSE `ask_user_required` / 回答后 `ask_user_answered`）；`answerAsk(sessionId, askId, {answers, skipped})`；state 快照增加 `pendingAsk`；beforeToolCall 对 ask_user 直接放行（免审批）。
  - `server/approval-store.mjs`：planAllowedTools 加入 ask_user；`server/routes/agent.mjs`：`POST /api/agents/:id/answer-ask`。
- 前端：
  - `src/lib/server-agent.ts`：事件 `ask_user_required`/`ask_user_answered`、`state.pendingAsk`（构造/快照/恢复/state 帧全套）、`answerAsk()`。
  - `src/components/chat/panel-decoration/ask-user-card.ts`（新）：向导式卡（单选点选自动前进 150ms 淡出/200ms 淡入、多选/自由输入显式"下一问"、末步回执摘要统一提交、整卡跳过、上一步可回改）；`data-ask-id`+displaySignature 去重，向导内部 DOM 变更不重建。
  - 接线：`panel-decoration.ts` re-export、`ChatPanelHost.tsx`（pendingAskRef + SSE 事件 + decorate 注入/移除 + readOnly 禁用）、`App.tsx`（`handleAnswerAsk` → `onAnswerAsk` prop）、`src/lib/i18n.ts`（en/zh 各 18 键）、`src/index.css`（.quickforge-ask-* 全套，复用审批卡 token）。
- 已答折叠语义：提交/跳过后交互卡直接移除，ask_user 调用+结果作为普通工具消息留在消息流，由既有工具折叠机制收纳——不引入独立折叠状态机。

## 本会话改动文件

- 新增：`server/ask-store.mjs`、`src/components/chat/panel-decoration/ask-user-card.ts`、`tests/server/ask-user-tool.test.mjs`、`tests/frontend/ask-user-card.test.ts`、`design-mockups/ask-user-tool.html`（此前会话产出）
- 修改：`server/tools/definitions.mjs`、`server/agent-manager.mjs`、`server/approval-store.mjs`、`server/routes/agent.mjs`、`src/lib/server-agent.ts`、`src/components/chat/panel-decoration.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/App.tsx`、`src/lib/i18n.ts`、`src/index.css`、`tests/server/tools/definitions.test.mjs`（工具数 8→9 + ask_user 断言）
- 簿记：`docs/wiki/server/tools/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`（done）、`progress.md`、`session-handoff.md`
- 前轮未提交改动（diff-odometer-counter / scroll-to-bottom-button / marquee / thinking-cap 等）仍保持未提交状态。

## 验证记录

- 定向：vitest ask-user-tool(10) + ask-user-card(7) + definitions(20) + agent-manager 相关 + routes/tools 全过。
- `npm run lint` 0 error（仅既有无关 warning server/cloud/identity.mjs:92）；`tsc --noEmit` 通过。
- 全量 `npm run test`（217/1795 全过）+ `npm run build`：通过。

## 遗留与下一步

- 本会话改动未提交 git（遵循约定）。
- 真实会话内 ask_user 交互目视确认留待用户（模型需自发调用；可在对话中要求"用 ask_user 问我一个问题"触发）。

## 真机反馈修复（同会话追加）

- 缺陷①卡片误显"当前视图无法作答"：`ChatPanelHost` 的 propsRef 同步 effect（每渲染整体重建 ref）漏了 `onAnswerAsk`，首帧后被覆写为 undefined 触发禁用；已补字段，并加回归测试（断言 effect 块内含 onAnswerAsk）。
- 缺陷②ask_user 工具消息不受设置的工具显示模式控制：新增 `src/lib/local-tools.ts` `AskUserToolRenderer` 并 `registerToolRenderer('ask_user', …)`——与其他内置渲染器同构（`toolDisplayMode==='detailed'` 才显示 input JSON；summary「N 问 · 首问」；非 detailed 展开直接列问题；output 显示回答文本；detailsOpen 记忆），加 ask_user 问号图标、i18n `askUserSummaryCount`、`.quickforge-ask-tool-questions` 样式。
- 验证：定向 + 前端全量 760 用例、lint 0 error、build 通过。
