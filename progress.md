# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 前端三处「延迟写 / 延迟发，卸载或抢占就静默丢」（2026-11-16 16:40）

- 问题：把「用户输入 → 持久层」或「用户点击 → 请求」放进定时器，中间就多出一个窗口；窗口里卸载、切 tab、切项目、连点，动作就静默消失（没有报错、没有提示，界面还显示已保存）。扫了 `src` 里 163 处 `setTimeout`，真正「延迟写持久层」的只有 5 处：三处做对（`WorkbenchScreensaverSettings` 卸载 flush、`ChatPanelHost` 草稿卸载＋视图切走双 flush、`message-queue` 的 `cleanup()` 两分支），三处是洞。
- P0 `ProjectCommandsSettingsTab.tsx`：800ms 防抖的 cleanup 只 `clearTimeout` 不 flush，而该 tab 不在 `STATE_PRESERVING_TAB_KEYS` 里（切走即真卸载），于是「填完命令目录 800ms 内切走 / 关设置」＝PUT 从未发出。改法：新增**卸载专用** flush effect（放在 `save` 定义之后，避免 use-before-define），并**删掉挂载 effect cleanup 里的 timer 清理**——React 卸载时按 effect 声明顺序正向跑 cleanup，旧的若先清 timer，后面新的 flush 会以为没有待写值而提前返回（子会话实测过：保留旧清理，新用例就是红的）。
- P1 同文件 `selectProject`：切项目前 `clearSaveTimer()` 把待写值直接扔掉。改法：有待写就先 `clearSaveTimer()` + `save()`，再切 `projectRef` / `commandDirRef`。
- P2 `ChatSidebar.tsx`：`onDeleteSession` / `onDeleteProject` 被塞进 140ms 动画定时器——140ms 内卸载不补发，且 140ms 内确认第二个会把前一个 `clearTimeout` 掉，**第一个删除请求永远发不出**。改法：请求在确认时同步发出，定时器只负责 `setConfirmingDelete*` 复位。
- 测试（全部先证会红）：`tests/frontend/project-commands-settings-tab.test.ts` 加 2 例（卸载 flush / 切项目 flush，新增 `mountWithCleanups` 自行收集 `harness.effects` 的 cleanup——原 harness 只 push 不执行）；新建 `tests/frontend/sidebar-delete-request-flush.test.ts` 2 例（同步派发 / 连点两次都发出）。**修复前 4 例红在断言上**：`expected [] to deeply equal ['typed-then-left']`、`expected "vi.fn()" to be called 1 times, but got 0 times`。
- 验证：主助手独立复核，不看自述——把 P0 的 flush 跳过（`if (1 === 1) return`）后**只有 P0 那条红**，其余 13 条绿；把 P2 的同步调用注释掉后两条全红；两次还原后文件 sha1 与备份一致、无探针残留。全量 585 文件 / 6387 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净。
- Notes：`confirmDelete*` 失败分支仍只复位状态、没有用户可见错误提示（与修复前一致，未扩大范围）；同族观察保留不改：卸载时若有 save 在飞，`pendingSaveAfterCurrentRef` 会让它的 `finally` 再排一个 800ms 定时器并最终发出 PUT——修复前就有的路径，语义是「最终写出去」。判据与三对三错表在 `~/.quickforge/bots/bot-b9c0e755/.bot/decisions.md` §21。

