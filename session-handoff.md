# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：普通运行会话进工作台在跑/进港（2026-11-13 11:55）

- 目标：用户问普通 session 运行中如何显示。已实现并验证，未 commit。
- 改动：Workbench.tsx（轮询 /api/agents，running 普通会话进在跑+统计+进港，点击打开会话，排除 bot/任务会话）、workbench.css、i18n（wbSession/wbNowEmpty）、workbench.test.ts（14 例）、设计 README。
- 验证：tsc/eslint/vitest 14/build 全绿；隔离实例 + hang fixture 实测在跑行/统计/进港/消失全链路，零 console error；截图目视确认。
- Blocker：无。下一步：无遗留；承接 bot-memory-writes-global pending、跨刷新保留进港/NOTAM 需服务端心跳环形记录（另排）。

