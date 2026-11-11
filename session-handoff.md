# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：界面文案「吉祥物」→「助手形象」（2026-11-12 00:50）

- 目标：用户要求界面不再叫「吉祥物」，改叫「助手形象」。
- 结论：只改两处用户可见中文文案——`botMascot: '形象'` → `'助手形象'`（bot 设置弹窗形象区标题）、`botMascotComposerHint` 里的「这只吉祥物 / 小吉祥物」→「助手形象 / 小头像」。英文（Mascot）与代码内部注释、wiki 术语未动。
- 改动文件：`src/lib/i18n.ts`、`progress.md`、本文件。
- 验证：定向 3 files / 24 passed；eslint 0；`npm run build` 通过（`dist/` 已重建）。纯前端，硬刷新即生效。
- 未完 / 下一步：① 上一轮 bot 弹窗功能（`bot-settings-composer-toggle`，已归档）仍需**重启 QuickForge** 才能让「在输入框上方显示」开关真正保存；② 实机肉眼确认弹窗视觉与开关行为。
- 未提交，无 commit / tag / push。

## 本轮：harness 状态文件归档机制（2026-11-12 00:45）

- 目标：用户要求优化 harness——状态文件每轮堆积很长，且每次提交代码需要归档。
- 一句话结论：新增幂等归档脚本 `node scripts/archive-harness.mjs`（`--dry-run` 预览），三个触发点：feature 标 done 当轮、提交代码前、会话结束前；活文件只留当前状态，历史进 `docs/archive/{features,progress,handoffs}/` 按月分文件。首次全量归档已执行：1.2MB → 约 5KB。
- 改动文件：`scripts/archive-harness.mjs`（新）、`AGENTS.md`（归档节 + Startup / End of Session）、`docs/archive/`（新）、`feature_list.json`、`progress.md`、本文件。
- 验证：dry-run 与实跑一致、JSON 有效且条数守恒（139 = 64 + 74 + 1）、重跑幂等。
- 未做 / 下一步：① 下次提交代码前先跑归档脚本（新规则首次实践）；② docs/wiki 无需更新——本变更只影响 harness 流程文件，不涉及代码架构、模块职责或发布流程。
- 已提交：bot 三项改动（`d3cecaac`）与 harness 归档机制（本 commit）各一个 commit，未 push。

