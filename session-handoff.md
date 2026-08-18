# Session Handoff

## 最近改动（上下文统计纯输入口径，已提交）

- Feature: 上下文统计纯输入口径 + 删除预留输出展示（context-usage-input-only-metrics）
- Status: **done**（已提交：仅本 feature 相关文件单独 commit；工作区其他遗留改动未提交，见下节）
- 背景：真实请求链路 pi-ai `clampMaxTokensToContext` 每次都会按窗口收缩 max_tokens，统计侧模拟“预留输出”不增加安全性且让口径复杂；本次 percent 改为 `inputTokens / contextWindow` 纯输入口径，自动压缩阈值同口径，UI 彻底删除“预留输出”行。
- 改动文件：
  - `server/context-usage.mjs`（删 OUTPUT_SAFETY_TOKENS/clampReservedOutputTokens；percent 纯输入；删返回对象 reserved 字段；totalTokens 对齐 inputTokens 兼容保留；shouldCompactContextByPercent 判据改 inputTokens）
  - `server/auto-compaction.mjs`（空会话分支删 reserved 字段）
  - `server/agent-manager.mjs`（零改动：grep 确认仅透传 usage 对象）
  - `src/components/chat/chat-utils.ts`（删 TS 版 clamp/常量/类型字段；getContextUsage 去 maxTokens 参数、纯输入口径）
  - `src/components/chat/context-usage.ts`（类型/normalize/tooltip/popover 删 reserved；popover 删冗余“总量”行、输入行值改 input / window；label 用 inputTokens；getMaxTokens 管线移除）
  - `src/components/chat/ChatPanelHost.tsx`（删 getMaxTokens 传参）
  - `src/lib/server-agent.ts`（类型删 reserved 字段）
  - `src/lib/i18n.ts`（删 contextUsageReservedOutputLabel/contextUsageReservedOutput/contextUsageTotal × 中英）
  - 测试：删除 `tests/frontend/context-usage-clamp.test.ts`；`tests/frontend/context-usage.test.ts`（fixture 更新 + 迁入 3 项纯输入用例）；`tests/server/auto-compaction.test.mjs`（两场景改写 + percent 12.5→8.5）
  - 文档：`docs/wiki/server/README.md`（L102/L355 两处公式改纯输入口径）
- 验证：针对性 `npx vitest run tests/server/auto-compaction.test.mjs tests/frontend/context-usage.test.ts` 22/22；`npm run test` 205 文件 1670 项 100%；`npm run lint` 0 error（仅既有 identity warning）；`npm run build` 通过（仅既有 KaTeX/大 chunk warning）。残留 grep（reservedOutputTokens/ReservedOutput/clampReservedOutputTokens/OUTPUT_SAFETY_TOKENS/contextUsageTotal）源码与测试无残留。
- 状态文件：progress.md、feature_list.json（context-usage-input-only-metrics = done）已同步。
- 取舍记录：① `totalTokens` 字段保留但对齐 inputTokens（SSE/state 消费者与前端展示兼容，属任务默认方案）；② popover 删除与输入数值完全重复的独立“总量”行，保留带标签“输入 / 上下文”行并展示 `input / window`；③ `contextUsageTotal` i18n key 随总量行删除（无其他消费者）；④ `node --test tests/server/auto-compaction.test.mjs` 不可用为既有情况（文件 import 'vitest'），项目测试统一走 `vitest run`。

## 前一个会话遗留（均未 commit，与本 feature 无关）

- `src/components/sidebar/ChatSidebar.tsx`：sidebar 分割线遮挡补充修复（1392 行容器 `overflow-hidden` + 滚动容器 `pb-2`）；待人工确认 UI 效果。
- `src/index.css`：subagent 运行详情 Tab 字体跟随「消息字体大小」（+11 行）；build 已验证。
- 模型配置即时生效（model-config-instant-refresh，done）：`server/agent-manager.mjs`、`server/routes/storage.mjs`、`server/routes/backup.mjs`、`src/hooks/useAgentManager.ts`、`tests/server/model-config-refresh.test.mjs`、`docs/wiki/server/README.md`。
- `package-lock.json` 曾有 43 行 `peer: true` 元数据抖动（npm install 版本差异，无依赖增删），已在本会话还原，与 HEAD 一致。

## Blockers

- 无。

## Next step

- 人工 UI 验证：模型环 hover popover 不再出现“预留输出”行，“输入 / 上下文”行显示 `input / window`；上下文百分比按纯输入口径（同输入量下百分比整体下降，如原 95.9% 的退化场景现显示 31%）。
- 若随下个 patch 发布，发布前完整运行 `npm run test`、`npm run lint`、`npm run build`。
