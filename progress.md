# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 普通运行会话显示进工作台「在跑 / 进港」（2026-11-13 11:55）

- 用户问「普通的 session 在运行中怎么显示」。补全：轮询 GET /api/agents，把 status==='running' 且不属于任何 bot/定时任务会话的普通会话显示进「在跑 NOW」（会话图标 + 标题 + 会话内观察的已跑时长），计入顶栏在跑统计；点击直接 requestOpenSession 打开该会话；running→结束记进「进港 ARRIVALS」（ok=status==='idle'，note=结束状态）。bot/任务会话排除避免与 bot/任务进港重复计数。
- 改动：Workbench.tsx（sessions state + runningSessions memo + observe 会话分支 + sessionSince + NOW 会话行 + stats）、workbench.css（session-icon）、i18n（wbSession、wbNowEmpty 更新）、workbench.test.ts（+会话契约，14 例）、设计 README（在跑/进港数据映射）。
- 验证：tsc -b / 定向 eslint / vitest 14/14 / npm run build 全绿；隔离实例 + 本地 hang fixture（模型请求挂起保持 streaming）实测：在跑栏出现该会话（标题 hang run + 已跑）、在跑统计=1、abort 后进进港（aborted）并从在跑消失，零 console/page error；进港截图目视确认（含新空态文案）。
- Notes：未 commit；隔离服务/hang fixture 与子进程已清理；承接 bot-memory-writes-global 仍 pending。

