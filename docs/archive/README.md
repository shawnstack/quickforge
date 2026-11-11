# docs/archive

harness 状态文件的归档区，由 `scripts/archive-harness.mjs` 维护（规则与触发时机见根目录 AGENTS.md「归档」一节）：

- `features/YYYY-MM.json` — `feature_list.json` 中已 done / superseded 的 feature（按 updatedAt 分月，按 id 去重）
- `progress/YYYY-MM.md` — `progress.md` 中较早的段落（按段落标题日期分月）
- `handoffs/YYYY-MM.md` — `session-handoff.md` 中较早的轮次（按段落标题日期分月）

归档只搬移、不删改内容；需要历史细节（某个已完成 feature 的方案 / 边界 / 验证记录）时按月查这里。
