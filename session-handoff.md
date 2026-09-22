## 当前交接：thinking-end-refresh-flicker（done，2026-09-23）

- Current Objective（当前目标）: 消除「思考过程结束之后页面重新刷一下」——思考段结束（`isStreaming` 翻转、正文开始输出）那一帧的可见重排；已完成并验证（feature_list.json 标记 done）。
- 根因（同一帧的两处）:
  1. 思考头接管路径在 React 重写 chevron/label 的 class（shimmer、rotate-90）后短路失效，旧实现无条件重写 `label.textContent`（销毁重建文本节点）并 `prepend`/`append` 重排 header 子级；移动子级＝重启其 CSS 动画（hint 淡入、跑马灯滚入），整行抖一下。
  2. 轮指纹把终答 markdown 也算进结构，正文首次出现即被判为结构变化 → full 重建：整组节点搬动两次、组元素连同高度过渡一起重建 ＝ 「重新刷一下」。
- 修复内容:
  1. `process-folding.ts#decorateProcessThinkingBlocks` 改为最小写路径：dataset / class / 文案按值比较后再写，子级仅在顺序真的不对时 `prepend`+`append` 重排（就绪帧零 DOM 写，等价于原幂等短路）。
  2. `processTurnFingerprint(assistants, excludeNode)` 新增排除参数；`decorateProcessTurn` 先算 `finalSummaryMarkdown` 再算指纹并排除它——中间（可折叠）markdown 仍计入结构。
  3. 回归用例：`tests/frontend/thinking-header-adoption.test.ts`（React 重写 class 后恢复装饰但不重建文本节点/不重排子级）、`tests/frontend/process-folding.test.ts`（指纹排除终答 markdown、中间 markdown 仍计入）。
  4. `docs/wiki/src/components/README.md` 的 process-folding 契约条目补充上述两条口径。
- Files（改动文件）: src/components/chat/panel-decoration/process-folding.ts、tests/frontend/thinking-header-adoption.test.ts、tests/frontend/process-folding.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Evidence（验证）: 定向 vitest 8 文件 109 passed + 2 文件 55 passed；npm run test 全量 378 文件 4521 passed / 1 skipped；npm run lint 通过；npm run build 通过。
- Blockers（阻塞）: 无。
- Notes:
  - 未改过程组释放/交还契约（`ProcessGroupReleaseBoundary` / `releaseProcessGroups`）与 release gate；若真实环境仍能看到一帧「未折叠」空档，下一个候选点是该边界 release 后的重折叠走 host rAF（跨帧），可评估改为提交后同步重折叠（参考 `SubagentTrace` 的 `componentDidUpdate → decorateProcessBlocks`）。
  - 未动尾行提示的滚动时序、动效与对齐；未引入新视觉模式，DESIGN_LANGUAGE.md 无需更新。
  - 同工作区本会话前两项已完成：thinking-expand-flicker（点击展开持续重刷）、thinking-hint-align-left（提示文字靠左）。
  - 无依赖变更；未修改生成产物（dist/package-dist/package-offline）；改动未提交。settings-row-infotip 仍为 pending。
- Next Session（下一步）: 处理 pending 的 settings-row-infotip；如需要，在真实浏览器复看「思考结束→正文开始」这一帧是否还有抖动，并在有残留时评估 release 边界同步重折叠方案。
