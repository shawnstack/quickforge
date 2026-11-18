# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 放开浏览器单窗口守卫：多窗口写入安全补齐（2026-11-18 16:20）

- 判断依据：原 `browser-single-window-guard` 的立论是「每窗口 2-4 条常驻 SSE 占满 HTTP/1.1 同源 6 连接池」（见 `docs/archive/progress-archive.md:3079-3081`）。该前提已失效——`channels/events` 整条流已删除、会话级 `/api/agents/:sid/stream` 仓内零调用方，现在每窗口只剩 1 条常驻 SSE（`/api/agents/events`）。为一个消失的问题保留「第二窗口直接进不去」，代价不再划算。
- 关键事实（写进 `src/main.tsx` 注释与 wiki）：**多窗口 ≠ 多项目**。`activeProjectId` / `workspaceRoot` 是服务端进程级全局量（`server/project-config.mjs` `setActiveProjectPath` → `setWorkspaceRoot`），且 `projects-changed` 会广播，两个窗口始终共享同一个当前项目，只能各自看不同会话。已有会话的工具工作区绑定在 `session.projectContext.workspaceRoot`，不会串目录。
- 改动：① 删除 `src/lib/window-guard.ts`、`src/components/WindowGuardNotice.tsx`、`tests/frontend/window-guard.test.ts`，`src/main.tsx` 去掉 `bootstrap()` 异步入口直接挂载 App（109 行），i18n 删 `windowGuardTitle/Description` 中英 4 行。② 审批幂等：`server/agent-approval-responses.mjs` 给「条目已被消费」的 404 加 `errorCode: APPROVAL_ALREADY_SETTLED` / `ASK_ALREADY_SETTLED`，`src/lib/server-agent/approval-actions.ts` 识别后按幂等成功收敛（清本地 pending、不抛错）——两个窗口都能看到同一张卡，后点的那个不再看到英文红字。③ `DELETE /api/agents/:sid` 挂 `assertSessionWriteAccess`（销毁是终态动作，此前靠单窗口守卫兜着；持有者崩溃时租约 60s TTL 过期，不会出现谁都删不掉）。④ `browser-connection-diagnostics.ts` 用 Proxy 包装 `window.EventSource` 统计常驻 SSE（`close()` 或 readyState→CLOSED 才释放，CONNECTING 自动重连不算）——只包 fetch 看不到 SSE，放开后就没法用 `window.__quickforgePerf()` 验证连接池。⑤ `workspace-api.ts` 过时注释「两条常驻 SSE」改为「每窗口 1 条」。⑥ wiki 4 处 + `server/routes/README.md` 租约段落同步。
- 测试（三处先红后绿，都实测过退化会红）：新增 `tests/frontend/approval-actions-settled.test.ts`（5 例：approve/reject/answerAsk 幂等收敛 + 无 code 的 404 与 5xx 仍抛错且不清 pending；把 `settledElsewhereCode` 改成 `return false` 后 3 例红）；`tests/server/routes/agent.test.mjs` 新增 3 例 DELETE 租约（非持有者 409 且不销毁 / 持有者可删 / 无租约可删；去掉守卫后第一例红在「promise resolved instead of rejecting」）；`tests/frontend/browser-connection-diagnostics.test.ts` 新增 EventSource 用例（计数、重连不释放、CLOSED 与 close 释放且不重复减、stop 还原；关掉 `installEventSourceTracking` 后红）。
- 验证：`npm run test` 611 文件 6526 例通过 / 2 skipped / 0 失败（本轮并发全量没复现 goal 域 hookTimeout 抖动）；`npm run lint` 净；`npm run build` 通过；`npm run check:wiki` matched=402 resolved=401 bad=0。
- 边界：未 commit / tag / push；未新增依赖；`dist/` 由 build 重新生成（未手工改）；**未支持「两个窗口看不同项目」**，那是 per-client project 量级的独立 feature，本次明确不做。
- 下一步（第二阶段，未做）：localStorage 三个整表读-改-写（`composer-drafts` / `message-queue` / `system-notifications-recent`）两窗口并发会吞条目；备份 `restoreValidatedBackup` replace 模式整表覆盖无「同时只允许一个 import」互斥。

## Notes

- 全量测试并发模式下 server 侧 goal/scheduled 域存在负载敏感的 hookTimeout 抖动：UI 刀 A 期间两轮并发全量分别有 6/5 个文件 7 例超时失败（agent-goal-runtime、agent-goal-manager、goal-v2-manager、scheduled-tasks.commands、agent-manager.persist-session-state、session-index-query），同批文件单独跑 103/103 全过、干净基线亦全过、串行全量 0 失败。与纯前端改动无关，建议后续给这些 server 测试加 hookTimeout 或隔离标记。

