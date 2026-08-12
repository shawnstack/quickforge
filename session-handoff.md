# Session Handoff

- Feature: `auto-compaction-trigger-and-usage-refresh`
- Status: `done`
- Current Objective: 自动压缩触发与压缩后上下文百分比刷新问题已完成修复并通过完整验证。
- Files touched: server/auto-compaction.mjs, server/context-usage.mjs, tests/server/auto-compaction.test.mjs, docs/wiki/server/README.md, feature_list.json, progress.md, session-handoff.md
- Blockers: none
- Recommended Next Step: 由用户在真实长对话中验证阈值触发和压缩后百分比即时下降；若仍偶发不触发，优先检查 pending approval、5 分钟审批超时和 10 分钟拒绝抑制日志。
- Last Updated: 2026-08-12
- Verification Evidence: 针对性压缩/回滚测试 14/14 通过；完整 `npm run test` 141 files / 1088 tests 全通过；`npm run lint` 无 error；`npm run build` 成功。
- Notes: 压缩后会先使用摘要与尾部的本地估算刷新 UI，首个压缩后 assistant usage 到达后再恢复 provider 权威统计；已有压缩后出现一条新消息即可再次做阈值检查。工作区仍有本任务之外的并发改动和未跟踪项，均保留未触碰。
- 追加记录（settings-tab-select-alignment）：宽度对齐 + 已选值字号与菜单一致。改动文件：src/index.css（仅 `.quickforge-settings-select-trigger-label` 加 font-size: 0.9rem; line-height: 1.35;）、src/lib/default-options-settings-tab.ts（沿用此前两处 quickforge-settings-row-control-wide，未改动）、feature_list.json、progress.md、session-handoff.md。未新增依赖、未触碰生成目录、未改 wiki。
- 追加验证（settings-tab-select-alignment）：`npm run lint` exit code 0，仅 7 个既有 warning（desktop/nsis-patch/apply.mjs no-console、server/cloud/identity.mjs no-useless-assignment），无 error；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。
