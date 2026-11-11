# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## bot 设置弹窗：文案「吉祥物」改「助手形象」（2026-11-12 00:50）

- 需求（用户原话）：「不要叫吉祥物 应该叫 助手形象吧」。属上一条 `bot-settings-composer-toggle`（已归档）的文案追加。
- 改动（纯 i18n 值，两处）：`botMascot` 中文 `形象` → `助手形象`（设置弹窗形象区标题，即 botMascotComposer 开关所在区）；`botMascotComposerHint` 的「这只吉祥物 / 小吉祥物」→「助手形象 / 小头像」。全 i18n 仅这两处用户可见文案含该词。
- 不动：英文文案仍用 Mascot；代码注释 / wiki 的内部术语「吉祥物」、`mascot` 命名未改（用户诉求是界面叫法，内部术语另议）。
- Evidence：定向 `i18n-language-snapshot` + `bot-mascot-composer-toggle` + `bot-status-summary` → 3 files / 24 passed；`npx eslint src/lib/i18n.ts` 0 problems；`npm run build` 通过（`dist/` 已重建，硬刷新即生效，无服务端改动）。
- Notes：上一条弹窗改动的生效前提不变——**服务端要重启 QuickForge** 才认识 `showOnComposer` 字段。

## harness 状态文件归档机制（2026-11-12）

- 需求：三个状态文件只增不减（`feature_list.json` 373KB/139 条、`progress.md` 506KB、`session-handoff.md` 349KB），AGENTS.md 还要求每个新会话全量读取；用户要求优化堆积、且每次提交代码时归档。方案经用户拍板：仓库内归档目录 + 三个触发时机。
- 改动：新增 `scripts/archive-harness.mjs`（无依赖、幂等、支持 `--dry-run`）；`AGENTS.md` 新增「归档」一节并同步 Startup Workflow / End of Session；新建 `docs/archive/{features,progress,handoffs}/` 按月分文件 + README。
- 规则：`feature_list.json` 只留未完成 feature（done/superseded 移走）；`progress.md` 只留日期最新一段 + Notes 段；`session-handoff.md` 只留最近一轮；归档按 feature id / md 标题去重保证幂等。
- 首次归档结果：138 条 feature → `features/2026-10.json`(64) + `2026-11.json`(74)；progress 152 段、handoff 145 轮分别按月归档；三个活文件合计约 1.2MB → 约 5KB。
- 验证：`--dry-run` 预览与实跑一致；归档前后各 JSON 均可解析、条数守恒（64+74+1=139）；重复执行报「无需归档」；`node --check` 通过。
- Notes：① 归档执行时有并行会话在写 harness 文件（bot-mode-restore-on-refresh 当轮登记），脚本幂等，内容被写回旧态时重跑即可收敛，无需手工干预。② `scripts/*.mjs` 不在 eslint flat config 覆盖内（只配了 ts/tsx 与 server、desktop），故用 `node --check` 校验语法。③ 提交代码前先跑归档再 commit，规则已写入 AGENTS.md。

