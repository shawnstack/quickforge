# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：goal 控制条不被助手形象遮挡（2026-11-12 03:25）

- 目标：用户投喂反馈「助手形象 会遮挡 goal 命令的执行 看看可不可以拖拽 bot」——后半句（bot 拖动排序 + 改名）上一班已交付不动，本轮只修前半句：goal 控制条不得被吉祥物遮挡。
- 改动：`src/components/chat/surface/ChatSurface.tsx`（条占行时吉祥物上移 2.375rem 站到条顶 + 条/让位共用 `goalState`）、新增 `tests/frontend/bot-mascot-goal-strip.test.ts`、`docs/wiki/server/bots.md` §7.2/§8 同步。未 commit（用户未要求）。
- 验证：相关批 vitest 13 文件 209 例全绿（新增 3 例）；eslint 改动文件 0 problems；`npx tsc -b` 通过；`npm run build` 通过。未跑全量 test/lint（局部小改动按 AGENTS 走针对性检查；发布前仍需全量）。
- 未完 / 下一步：①重启 QuickForge 后实机目验：bot 拖动/改名（上一班交付）+ 本次吉祥物在 goal 运行时站到条顶、条上按钮可点；②吉祥物与「+」弹层/TodoWrite 摘要行的同排重叠是既有另一档问题，仅记录在 progress Notes。

