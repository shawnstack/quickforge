# Progress

## Current State

- Feature: `auto-compaction-trigger-and-usage-refresh`
- Status: `done`
- Goal: 修复自动压缩偶发超过阈值仍未再次检查，以及压缩完成后上下文百分比仍沿用压缩前 provider usage 的问题。
- Files: server/auto-compaction.mjs, server/context-usage.mjs, tests/server/auto-compaction.test.mjs, docs/wiki/server/README.md, feature_list.json, progress.md, session-handoff.md
- Blockers: none
- Next step: 等待用户验证真实长对话场景；如仍有未触发情况，再重点排查审批超时/拒绝抑制和 provider 不返回 usage 的场景。
- Last Updated: 2026-08-12

## Completed Work

- 已有滚动压缩后，只要出现一条新消息即可再次执行阈值检查，不再固定等待三条新增消息。
- 压缩完成后忽略保留尾部中代表压缩前完整上下文的陈旧 provider usage，立即按 compact summary + tail 重新估算百分比。
- 压缩后出现新的 assistant provider usage 时自动恢复 provider 权威统计；兼容旧压缩元数据和 rollback 后重发场景。
- 补充自动压缩 usage、再次检查、legacy 时间戳和 rollback 重发回归测试。
- 同步更新 server Wiki。
- settings-tab-select-alignment：设置页下拉框宽度对齐（语言/默认 Harness 等行复用 quickforge-settings-row-control-wide）；并在 `.quickforge-settings-select-trigger-label` 显式设置 font-size: 0.9rem / line-height: 1.35，使收起态已选值与菜单选项字号一致。改动文件：src/index.css、src/lib/default-options-settings-tab.ts（保留此前两处 wide 修改）。

## Verification Evidence

- `npx vitest run tests/server/auto-compaction.test.mjs tests/server/agent-manager.rollback-compaction.test.mjs`：exit code 0，2 个测试文件、14 项测试通过。
- `npx eslint server/context-usage.mjs server/auto-compaction.mjs tests/server/auto-compaction.test.mjs`：exit code 0。
- `npm run test`：exit code 0，141 个测试文件、1088 项测试全部通过。
- `npm run lint`：exit code 0；仅 7 个既有 warning（desktop/nsis-patch/apply.mjs 的 no-console、server/cloud/identity.mjs 的 no-useless-assignment），无 error。
- `npm run build`：exit code 0；仅既有 KaTeX 字体解析与大 chunk warning。
- settings-tab-select-alignment 验证：`npm run lint` exit code 0，仅 7 个既有 warning（desktop/nsis-patch/apply.mjs no-console、server/cloud/identity.mjs no-useless-assignment），无 error；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。
- 独立 Explore 代码审查：两个修复无阻断问题；回滚后 provider usage 恢复边界已按建议修正并补测试。

## Notes

- 工作区存在与本任务无关的并发改动和未跟踪项，已保留且未主动修改。
- `dist/` 为 build 生成产物，未手工修改。
