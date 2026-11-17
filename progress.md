# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 隔离刀 4+5：九处声明式弹层全部接完 useModalIsolation，并与非模态弹层划清边界（2026-11-17 15:00）

- 任务：接续隔离刀 3（`bf98c1c6`），把余下声明式弹层按同一配方收口。刀 4 三处——`SidebarSearchDialog`（内联、非 portal）、`NewBotDialog` 与 `BotSettingsDialog`（`enabled` 与 `open` / `bot` 联动）；刀 5 三处——`ShareActionsSheet`（分享操作面板）、`MobileServerConnectPage` 删除确认（`enabled: Boolean(deletingUrl)`）、`HooksSettingsTab` 编辑面板（`enabled: editorOpen`）。
- 本刀纠正的约定：ref 取**遮罩层**，不取卡片。`BotSettingsDialog` 的遮罩里有一颗 `absolute inset-0` 全屏关闭按钮，它是卡片的兄弟——拿卡片当起点会把它一并 `inert`，而 `inert` 会拦掉点击，遮罩就点不动了；`SidebarSearchDialog` 的遮罩自带 `onMouseDown` 关闭，同理。这条已写进注释、测试与 hooks wiki，后续刀次照此办理。
- 「常挂 + 条件显隐」的弹层必须传 `enabled`：DOM 被拔掉不会重跑 effect，ref 变 null 也不触发，计数永不归零、`inert` 会留在背景上。移动端删除确认与 hooks 编辑面板都是这个形态。
- 边界：非模态弹层一例都不接。`SkillsPageHead` 的路径 popover 与 `CodeBlock` 的语言菜单刻意不声明 `aria-modal`（页头其余按钮仍可用），接上会把它们一起 inert 掉——这条写成了反向契约断言，谁手滑接上就红。
- 测试（先证红）：`tests/frontend/modal-isolation.test.ts` 新增 3 例（SidebarSearchDialog 内联拓扑 / NewBotDialog / BotSettingsDialog 断言全屏关闭热区不带 `inert`），接线前三例红在 `expected false to be true`，接后 13 例全绿。刀 5 三个宿主是页面级组件（挂载要 mock 一整页请求），用源码契约法锁接线：新增 `tests/frontend/modal-isolation-wiring.test.ts` 3 例，删掉接线 / 去掉 `enabled` 实测变红（`git stash` 掉接线跑过）。
- 验证：`modal-isolation` 13 例 + `modal-isolation-wiring` 3 例 + 相关 3 个测试文件 32 例全绿；`tsc -b` 净；eslint 改动文件净；`check:wiki` matched=401 resolved=400 historical=1 bad=0；全量 `npm run test` 结果见 session-handoff。
- wiki 同步：`docs/wiki/src/hooks/README.md`（接入面「七处」→「十三处」，写明 ref 取遮罩、必须带 `enabled`、非模态弹层不接三条规则）、`docs/wiki/src/components/README.md`（`BotDialogs.tsx` 行数 650→659 并补两个弹层的钩子接线；`HooksSettingsTab.tsx` 行数 865→868 补接线；ChatSidebar 装配层那条补搜索弹层）。
- Notes：`AttachmentPreviewErrorFallback`（overlay 崩溃兜底，role=alertdialog）未接——它渲染在已接隔离的 overlay 里，父层已隔背景；`App.tsx` 移动侧栏抽屉（`useMobileSidebar` 已有 focus trap）与 `Workbench` / `WorkbenchAnalog` 的全屏 `role=dialog` 根待判断语义，见 handoff 下一步。

