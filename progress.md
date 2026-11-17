# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 隔离刀 2：命令式 createRoot 两处接 useModalIsolation（2026-11-17 11:40）

- 任务：主助手 09:23 派下（被两跳漏掉）、11:13 确认「先做这一段」——`ApiKeyPromptDialog.tsx` 与 `AttachmentOverlay.tsx` 各接 `useModalIsolation`，范围就 2 源文件 + 1 测试文件。接法与隔离刀 1（`b0ad53d5`，confirm/prompt 两处）完全同构：import 一行 + `useDialogFocusTrap` 调用后紧跟一行调用。
- 两种挂载形态都被覆盖：`promptApiKey` 是 inline（createRoot 自建容器 append 到 body，dialog div 在容器里，#root 是容器的兄弟）；`openAttachmentOverlay` 是 portal（overlay div 经 createPortal 直挂 body，#root 与它互为兄弟，createRoot 容器是另一个兄弟）。钩子「只隔兄弟、不碰祖先链」对两种拓扑都成立。
- 测试（先证红）：`tests/frontend/modal-isolation.test.ts` 新增 2 例真实调用点（例 6 promptApiKey 点遮罩关闭、例 7 openAttachmentOverlay Esc 关闭），jsdom 真渲染，断言 body 级兄弟（#root）挂载时带 inert、卸载后**不等宏任务**同步摘掉。接钩子前 2 例红在 `expected false to be true`，接后全绿——把实现换回「不接钩子」测试必红，判据成立。
- 验证：modal-isolation 7 例 + chat-surface-api-key-dialog 20 例全绿；`tsc -b` 净；eslint 3 个改动文件净；`check:wiki` matched=401 resolved=401 historical=1 bad=0；全量 `npm run test` 结果见 session-handoff。
- wiki 同步：`docs/wiki/src/hooks/README.md`（useModalIsolation 接入面「两处」→「四处」）、`docs/wiki/src/components/README.md`（两条组件条目补挂载形态与钩子接线）。
- Notes：`AttachmentPreviewErrorFallback`（overlay 崩溃兜底，role=alertdialog，自带 focus trap）未接 useModalIsolation——不在本刀范围；后续刀次可考虑。起点核过：HEAD `6ec506c8`、dev、工作树干净。

