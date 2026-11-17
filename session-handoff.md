# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：隔离刀 2——命令式 createRoot 两处接 useModalIsolation（2026-11-17 11:38）

- 目标：主助手 09:23 派下（被两跳漏掉）、11:13 确认「先做这一段」——`ApiKeyPromptDialog.tsx`（inline 挂载：createRoot 自建容器、dialog div 在容器内）与 `AttachmentOverlay.tsx`（portal 挂载：createPortal 直挂 body）各接 `useModalIsolation`，范围就 2 源文件 + 1 测试文件，与隔离刀 1（`b0ad53d5`）同构。
- 改动文件：`src/components/chat/surface/ApiKeyPromptDialog.tsx`（+2 行）、`src/components/chat/surface/AttachmentOverlay.tsx`（+2 行）、`tests/frontend/modal-isolation.test.ts`（+2 例真实调用点：promptApiKey 点遮罩关闭 / openAttachmentOverlay Esc 关闭）、`docs/wiki/src/hooks/README.md`（useModalIsolation 接入面「两处」→「四处」）、`docs/wiki/src/components/README.md`（AttachmentOverlay/ApiKeyPromptDialog 两条补挂载形态与钩子接线）。
- 验证：先证红——接钩子前 2 个新用例红在 `expected false to be true`（inert 无人设置），接后全绿；`npx vitest run` modal-isolation 7 例 + chat-surface-api-key-dialog 20 例；`tsc -b` 净；eslint 3 改动文件净；`check:wiki` matched=401 resolved=401 historical=1 bad=0；全量 `npm run test`：**600 文件 / 6451 passed + 2 skipped**。
- 状态：起点核过（HEAD `6ec506c8`、dev、工作树干净），按派活要求完成即 commit（hash 见 git log），`dev` 仍无任何 push。
- 运行实例：本刀不含 `dist/`（生成产物不手工改），未重建未重启——主助手按自己节奏决定何时重建/刷新。
- Blocker：无。
- 下一步：隔离刀后续刀次——受控弹层走 `enabled` 联动、其余 focus-trap 调用点逐刀接入；`AttachmentPreviewErrorFallback`（overlay 崩溃兜底）未接，见 progress.md Notes。

