# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：隔离刀 4——侧栏搜索 + bot 两处弹层接 useModalIsolation（2026-11-17 14:55）

- 目标：接续刀 3（`bf98c1c6`）继续逐刀收口 `aria-modal` 的背景隔离；本刀 3 处声明式弹层：`SidebarSearchDialog`、`NewBotDialog`、`BotSettingsDialog`。
- 改动文件：`src/components/sidebar/chat-sidebar/SidebarSearchDialog.tsx`（+4 行）、`src/components/bots/BotDialogs.tsx`（+9 行）、`tests/frontend/modal-isolation.test.ts`（+3 例 / +85 行，partial mock `fetchBotMemory`）、`docs/wiki/src/hooks/README.md`（七处 → 十处 + ref 取遮罩规则）、`docs/wiki/src/components/README.md`（BotDialogs 行数与接线、ChatSidebar 装配层那条补搜索弹层）。
- 本刀新增的判据：**ref 取遮罩，不取卡片**——`BotSettingsDialog` 遮罩里有 `absolute inset-0` 全屏关闭按钮，用卡片当起点会把它 `inert` 掉、遮罩点不动；测试里专门断言那颗按钮不带 `inert`。
- 验证：先证红（3 例红在 `expected false to be true`）→ 接钩子后 13 例全绿；相关 3 个测试文件 32 例全绿；`tsc -b` 净；eslint 3 个改动文件净；`check:wiki` matched=401 resolved=400 historical=1 bad=0；全量 `npm run test` **6457 passed + 2 skipped**。
- 状态：起点核过（HEAD `3c76920c`、dev、工作树干净），按惯例完成即 commit（hash 见 git log），`dev` 无任何 push。
- Blocker：无。
- 下一步（余下未接点位，逐刀收）：`ShareLinksSettingsPage`（分享管理 sheet，role=dialog+aria-modal）、`MobileServerConnectPage`（删除确认，`enabled: Boolean(deletingUrl)`）、`HooksSettingsTab`（hook 编辑面板，`enabled: editorOpen`）、`SkillsPageHead`（路径 popover，`enabled: pathsOpen`）、`AttachmentPreviewErrorFallback`（overlay 崩溃兜底 role=alertdialog）、`App.tsx` 移动侧栏抽屉（`useMobileSidebar` 里已有 focus trap）。`Workbench` / `WorkbenchAnalog` 的 role=dialog 根是全屏视图而非弹层，接前先判断语义；`CodeBlock` 语言菜单不挂 focus trap，也不需要接。

