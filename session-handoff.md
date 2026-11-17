# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：隔离刀 4+5——九处声明式弹层接完 useModalIsolation，并与非模态弹层划清边界（2026-11-17 15:00）

- 目标：接续刀 3（`bf98c1c6`）把 `aria-modal` 的背景隔离收口。刀 4 三处：`SidebarSearchDialog`、`NewBotDialog`、`BotSettingsDialog`；刀 5 三处：`ShareActionsSheet`（在 `ShareLinksSettingsPage.tsx` 内）、`MobileServerConnectPage` 删除确认、`HooksSettingsTab` 编辑面板。
- 改动文件：`src/components/sidebar/chat-sidebar/SidebarSearchDialog.tsx`、`src/components/bots/BotDialogs.tsx`、`src/components/share/ShareLinksSettingsPage.tsx`、`src/components/mobile/MobileServerConnectPage.tsx`、`src/components/settings/tabs/HooksSettingsTab.tsx`；测试 `tests/frontend/modal-isolation.test.ts`（+3 例 jsdom 真渲染）、`tests/frontend/modal-isolation-wiring.test.ts`（新文件，3 例源码契约）；wiki `docs/wiki/src/hooks/README.md`（七处 → 十三处 + 三条规则）、`docs/wiki/src/components/README.md`（BotDialogs 650→659、HooksSettingsTab 865→868、ChatSidebar 装配层那条补搜索弹层）。
- 本刀新增的两条判据：① **ref 取遮罩，不取卡片**——`BotSettingsDialog` 遮罩里那颗 `absolute inset-0` 关闭按钮是卡片的兄弟，用卡片当起点会被 `inert` 掉、遮罩点不动（测试专断言它不带 `inert`）；② **常挂 + 条件显隐必须传 `enabled`**——DOM 拔掉不会重跑 effect，计数不归零、`inert` 留在背景上。
- 反向契约：非模态弹层一例都不接（`SkillsPageHead` 路径 popover、`CodeBlock` 语言菜单），谁手滑接上，`modal-isolation-wiring.test.ts` 第 3 例就红。
- 验证：`modal-isolation` 13 例 + `modal-isolation-wiring` 3 例全绿；契约测试用 `git stash` 掉接线实测变红（2 例红）再恢复；`tsc -b` 净；eslint 改动文件净；`check:wiki` matched=401 resolved=400 historical=1 bad=0；全量 `npm run test` **601 文件 / 6460 passed + 2 skipped**。
- 状态：起点核过（HEAD `3c76920c`、dev、工作树干净）；刀 4 已提交 `4c389eae`，刀 5 同轮提交（hash 见 git log）；`dev` 无任何 push。
- Blocker：无。
- 下一步（只剩判断题，不是机械清单）：`App.tsx` 移动侧栏抽屉（`useMobileSidebar` 里已有 focus trap，值是 role=dialog+aria-modal，方向可行）；`Workbench` / `WorkbenchAnalog` 的全屏 `role=dialog` 根是「全屏视图」还是「弹层」需要先定语义，别为了凑数量硬接；`AttachmentPreviewErrorFallback`（role=alertdialog）渲染在已接隔离的 overlay 里，父层已隔背景，不必重复接。
