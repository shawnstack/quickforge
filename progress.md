# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## goal 控制条不被助手形象遮挡（2026-11-12 03:25）

- 需求（用户投喂反馈原话）：「助手形象 会遮挡 goal 命令的执行 看看可不可以拖拽 bot」；后半句（bot 拖动排序 + 改名）上一班已交付，本轮只做前半句，未动那部分代码。
- 根因：bot 模式输入框上方的吉祥物（size 79，球径约 46px）用 `-translate-y-[80%]` 站在编辑器顶上，而 Goal 控制条占着编辑器正上方一行（高 2rem + 下边距 0.375rem ≈ 38px），球整球压住条右端的主操作/「⋯」按钮；球本体 `pointer-events: auto`，既挡视线也截走点击。
- 修法：`ChatSurface` 与 `GoalControlStrip` 同用 `buildGoalControlStripView` 判「条占行」（终态 goal 不渲染条，两边规则不漂移），占行时吉祥物 wrapper 的 `top` 上移 2.375rem 站到条顶（`transition-[top]` 平滑过渡），与条零重叠；球顶对消息区的探出量与无条时完全一致（约 46px，App.tsx 选型注释锁的量不变）。条与让位共用同一份 `goalState`。
- 测试：新增 `tests/frontend/bot-mascot-goal-strip.test.ts`（3 例：占行判据同源、top 随占行切换、上移量与条几何同步防漂移）；`docs/wiki/server/bots.md` §7.2/§8 同步。
- Evidence：vitest 相关批 13 文件 209 例全绿（含新 3 例）；eslint 改动文件 0 problems；`npx tsc -b` 通过；`npm run build` 通过（确认 `-top-[2.375rem]` / `transition-[top]` 任意值类进了产物 CSS）。
- Notes：①服务端无改动，无需重启；②feature_list.json 未新增条目——本条是一次性反馈修复且当轮完成，非长期 feature（与上一班 bot 拖动排序同例）；③吉祥物与编辑器上方的「+」弹层/TodoWrite 摘要行同排时的重叠是另一档既有问题（无 goal 条时也存在），只记录不扩大范围。

