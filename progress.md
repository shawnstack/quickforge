# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 隔离刀 4：三处声明式弹层接 useModalIsolation，并纠正 ref 应该从遮罩起算（2026-11-17 14:55）

- 任务：接续隔离刀 3（`bf98c1c6`），把余下声明式弹层按同一配方接入——`SidebarSearchDialog`（内联、非 portal）、`NewBotDialog` 与 `BotSettingsDialog`（`enabled` 分别与 `open` / `bot` 联动）。范围 3 源文件 + 1 测试文件 + 2 个 wiki 文件。
- 本刀纠正的约定：ref 取**遮罩层**，不取卡片。`BotSettingsDialog` 的遮罩里有一颗 `absolute inset-0` 全屏关闭按钮，它是卡片的兄弟——拿卡片当起点会把它一并 `inert`，而 `inert` 会拦掉点击，遮罩就点不动了；`SidebarSearchDialog` 的遮罩自带 `onMouseDown` 关闭，同理。这条已写进注释、测试与 hooks wiki，后续刀次照此办理。
- 测试（先证红）：`tests/frontend/modal-isolation.test.ts` 新增 3 例——SidebarSearchDialog 的内联拓扑（遮罩不 portal，靠沿途兄弟一路隔到 body）、NewBotDialog、BotSettingsDialog（额外断言全屏关闭热区不带 `inert`）。接钩子前三例红在 `expected false to be true`，接后 13 例全绿。
- 验证：相关 3 个测试文件 32 例全绿；`tsc -b` 净；eslint 3 个改动文件净；`check:wiki` matched=401 resolved=400 historical=1 bad=0；全量 `npm run test` 6457 passed + 2 skipped。
- wiki 同步：`docs/wiki/src/hooks/README.md`（接入面「七处」→「十处」，并写明 ref 取遮罩的规则）、`docs/wiki/src/components/README.md`（`BotDialogs.tsx` 行数 650→659 并补两个弹层的钩子接线；ChatSidebar 装配层那条补搜索弹层）。
- Notes：剩余未接点位与「工作台全屏根算不算弹层」的判断见 session-handoff 的「下一步」。

