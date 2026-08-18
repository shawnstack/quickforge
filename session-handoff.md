# Session Handoff

## 最近改动（上下文统计纯输入口径，已提交）

- Feature: 上下文统计纯输入口径 + 删除预留输出展示（context-usage-input-only-metrics）
- Status: **done**（commit `73be13d`）
- 背景：真实请求链路 pi-ai `clampMaxTokensToContext` 每次都会按窗口收缩 max_tokens，统计侧模拟“预留输出”不增加安全性且让口径复杂；本次 percent 改为 `inputTokens / contextWindow` 纯输入口径，自动压缩阈值同口径，UI 彻底删除“预留输出”行。
- 改动文件与验证细节见 progress.md「上下文统计纯输入口径 — 完成」小节。

## 遗留改动清理（本会话，已提交）

用户确认人工 UI 验证全部 OK 后，将前几个会话完成的遗留改动按 feature 分别提交：

- `dbc0ca9 feat(agent): refresh session model bindings when custom providers change`——模型配置即时生效（model-config-instant-refresh，done）：agent-manager/storage 路由/backup 路由/useAgentManager + tests/server/model-config-refresh.test.mjs + docs/wiki/server/README.md。
- `50a88e0 fix(sidebar): clip conversations section and keep footer divider visible`——侧栏分割线遮挡补充修复（overflow-hidden + pb-2），人工 UI 已确认。
- `65c95d8 fix(ui): follow message font size in subagent run detail tabs`——subagent 运行详情 Tab 字体跟随「消息字体大小」。
- 清理前针对性验证：vitest（model-config-refresh + storage-config-split）12/12、改动文件 ESLint 0 问题、tsc --noEmit 0 错误。

## 当前状态

- feature_list.json：42 个 feature 全部 done，无 pending。
- 人工 UI 验证：已由用户确认 OK（模型环 popover 无“预留输出”行、纯输入口径百分比、sidebar 视觉、subagent 字号）。
- 工作区：清理后应仅剩状态文件（feature_list.json / progress.md / session-handoff.md）随 chore 提交，其余 clean。

## Blockers

- 无。

## Next step

- 无待办 feature。新需求按 feature_list.json 登记后推进。
- `server/cloud/identity.mjs:92` 有一条既有 `no-useless-assignment` lint warning（多会话前已存在，与本批改动无关），可择机修复。
- 若需发布 patch 版本，说“发布一个小版本”按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行（发布前完整跑 test/lint/build）。
