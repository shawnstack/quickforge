## 当前交接：thinking-end-refold-flicker（done，2026-09-23）

- Current Objective（当前目标）: 消除「思考过程之后界面闪一下」——定位到过程折叠的**所有权交还与重新折叠跨帧**：`ProcessGroupReleaseBoundary` 在 `getSnapshotBeforeUpdate` 里 release（节点搬回原位、恢复显示），重折叠却排在宿主的下一个 rAF，中间那一帧「未折叠」被真实绘制；已改为同一提交内同步重折叠并验证（feature_list.json 标记 done）。
- 根因（单一、确定）: `src/components/chat/surface/ChatSurface.tsx` 的 boundary 只实现了交还契约的一半。`ChatPanelHost.tsx:544` 的 `requestSurfaceDecorate` → `:1381-1389` `scheduleDecorate` 走 `requestAnimationFrame`，而 release 发生在提交前、commit 在同一 task 内完成，于是浏览器先 paint 了「未折叠」的那一帧；`ChatSurface.tsx` 的 MessageArea 注释原文即「an unfolded frame in between is visible as a flicker」，上一轮 session-handoff 也把它列为下一个候选点。同项目的 `SubagentTrace` 一直是同提交内同步重折叠的范例。
- 修复内容:
  1. `ChatSurface.tsx#ProcessGroupReleaseBoundary`：`getSnapshotBeforeUpdate` 只 release 并返回 `groups > 0` 作为 snapshot；`componentDidUpdate(_, _, released)` 为真才调 `onReleased`（同帧）；`componentWillUnmount` 只防御性释放、不再请求装饰；Props/MessageArea 注释改为「同帧重折叠」口径。
  2. `ChatPanelHost.tsx`：新增 `requestSurfaceDecorateNow`（`decorateFnRef` 就绪且未在装饰中 → 同步跑完整 decorate pass；否则回落 `scheduleDecorate` 的 rAF 兜底），`onProcessGroupsReleased` 改传它（`onWindowChanged` 仍走 rAF）；`runDecorate` 加 single-flight 守卫 `decorateInFlightRef`。
  3. `panel-decoration/process-folding.ts#releaseProcessGroups` 文档改为「同一 task 内重折叠」。
  4. `docs/wiki/src/components/README.md` process-folding 所有权租约条目（315 与 635 两处副本）同步新契约。
- Files（改动文件）: src/components/chat/surface/ChatSurface.tsx、src/components/chat/ChatPanelHost.tsx、src/components/chat/panel-decoration/process-folding.ts、tests/frontend/chat-surface-release-refold.test.ts（新增）、tests/frontend/process-folding-ownership.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 32 passed（chat-surface-release-refold 4 + process-folding-ownership 18 + chat-surface-release-gate 10）、另一批 13 文件 230 passed；npm run test 全量 379 文件 4525 passed / 1 skipped；npm run lint 通过；npm run build 通过。
- Blockers（阻塞）: 无。
- Notes:
  - 未改 release gate 判定与 `releaseProcessGroups` 的释放规则，只改「何时请求重折叠」；未动思考头接管路径、尾行提示动效、滚动时序与对齐。
  - 残留风险（真机验收点）: (a) 同步 pass 在 React layout 阶段执行，含 `hint.offsetWidth` 等强制 layout 读取，仅在真正交还过组的提交帧触发，量级应为「每轮回复几次」；(b) `runDecorate` 的 single-flight 守卫会吞掉「装饰中再次请求」的场景，此时经 rAF 兜底补一次；若真机仍见闪，下一步用 DevTools Performance 确认那一帧是 `.quickforge-process-group` 短暂消失（未折叠）还是别的机制（如 `.qf-streaming-message` 卸载/重挂 + mermaid 首次渲染）。
  - 同工作区本会话之前的两项已完成：thinking-end-refresh-flicker（思考头最小写路径 + 指纹排除终答 markdown）、thinking-hint-align-left。settings-row-infotip 仍为 pending。
  - 无依赖变更；未修改生成产物（dist/package-dist/package-offline）；改动未提交。
- Next Session（下一步）: 真机复看「思考结束→正文开始」「整轮回复结束」两个时机是否还有闪烁；处理 pending 的 settings-row-infotip。
