# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：放开浏览器单窗口守卫（2026-11-18 16:20）

- 目标：用户明确要「放开单窗口守卫，能开两个窗口」。先核对原守卫的立论——每窗口 2-4 条常驻 SSE 占满 HTTP/1.1 同源 6 连接池——已失效：`channels/events` 流已删除、会话级 `stream` 仓内零调用方，现在每窗口只剩 1 条常驻 SSE。
- 改动文件：删 `src/lib/window-guard.ts`、`src/components/WindowGuardNotice.tsx`、`tests/frontend/window-guard.test.ts`；改 `src/main.tsx`（去 bootstrap，直接挂 App，109 行）、`src/lib/i18n.ts`（删 `windowGuardTitle/Description` 中英 4 行）、`server/agent-approval-responses.mjs`（404 加 `APPROVAL_ALREADY_SETTLED` / `ASK_ALREADY_SETTLED`）、`src/lib/server-agent/approval-actions.ts`（识别后幂等收敛，不弹错）、`server/routes/agent.mjs`（`DELETE` 挂 `assertSessionWriteAccess`）、`src/lib/browser-connection-diagnostics.ts`（Proxy 包装 `EventSource` 统计常驻 SSE）、`src/components/workspace/workspace-api.ts`（过时注释「两条常驻 SSE」→「每窗口 1 条」）；新测试 `tests/frontend/approval-actions-settled.test.ts`（5 例）；`tests/server/routes/agent.test.mjs` +3 例（DELETE 租约）；`tests/frontend/browser-connection-diagnostics.test.ts` +1 例（EventSource）；wiki 4 处 + `server/routes/README.md` 租约段落。
- 判据：三处都实测「换回旧写法会红」——`settledElsewhereCode` 改 `return false` → 3 例红；去掉 `DELETE` 守卫 → 1 例红（resolved instead of rejecting）；关掉 `installEventSourceTracking` → 1 例红。
- 验证：`npm run test` 611 文件 / 6526 例通过 / 2 skipped / 0 失败（本轮并发全量未复现 goal 域 hookTimeout 抖动）；`npm run lint` 净；`npm run build` 通过；`npm run check:wiki` bad=0。
- 状态：未 commit / tag / push。工作区同时含**上一轮**未提交的 goal v2 修复（`server/goal/runner.mjs`、`tests/server/goal-services-cache.test.mjs`），提交时注意区分两轮改动。
- Blocker：无。
- 下一步：第二阶段两项（未做，已记 progress Notes）——localStorage 三个整表读-改-写（`composer-drafts` / `message-queue` / `system-notifications-recent`）两窗口并发会吞条目；备份 `restoreValidatedBackup` replace 模式整表覆盖、无 import 互斥。「两个窗口看不同项目」明确不做（需要把 project 做成 per-client）。

