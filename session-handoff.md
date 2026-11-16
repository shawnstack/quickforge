# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：三处「延迟写 / 延迟发，卸载或抢占就静默丢」+ DoD 补两条判据（2026-11-16 16:45）

- 目标：`src` 里共 163 处 `setTimeout`，其中「用户输入 → 持久层」或「用户点击 → 请求」被延迟的有 5 处——3 处做对、3 处是真洞（定时器与卸载之间的窗口里动作静默消失：不报错、无提示、界面还显示已保存）。
- 改动文件：`src/components/settings/tabs/ProjectCommandsSettingsTab.tsx`（新增**卸载专用** flush effect；并删掉挂载 effect cleanup 里的 `clearTimeout`——React 卸载按 effect 声明顺序正向跑 cleanup，旧的先清 timer，新的 flush 就会以为没有待写值而提前返回）、同文件 `selectProject`（切项目前先 flush 待写值）、`src/components/sidebar/ChatSidebar.tsx`（删除请求改为确认时同步发出，140ms 定时器只负责动画状态复位）、`tests/frontend/project-commands-settings-tab.test.ts`（+2 例，新增 `mountWithCleanups` 自行收集 `harness.effects` 的 cleanup）、`tests/frontend/sidebar-delete-request-flush.test.ts`（新建 2 例）、`AGENTS.md`（DoD 第 5 条随 `562d434e` 落地，第 6 条本轮补）、`docs/wiki/src/components/README.md`（396→408）、`progress.md`。
- 验证：4 例先证会红（`expected [] to deeply equal ['typed-then-left']`、`expected "vi.fn()" to be called 1 times, but got 0 times`）；独立反转复核：跳过 P0 的 flush 后**只有该条红**、注释掉 P2 的同步调用两条全红，还原后文件 sha1 与备份一致。全量 585 文件 / 6387 例绿 / 2 skipped、`tsc -b` 净、`eslint .` 净、`check:wiki` matched=399 resolved=399 bad=0。
- 状态：代码已在本地 commit `562d434e`；`dev` 领先 `origin/dev` **90+ 笔，没有任何 push**（用户未明说就不推）。
- 运行实例：2026-11-16 14:20:15 重启（pid 5384 / bootId c2981e39），此前所有 `server/**` 改动已生效；`dist/` 已按 `src` 重建并校验，前端刷新即可看到。
- Blocker：无。
- 下一步：①push 等用户明说；②继续按 triage 找缺陷，已结论面别重扫（「替换串」族三处已修、见 `docs/wiki/server/README.md`「替换串语义」；「延迟写」族已修、判据进 `AGENTS.md` DoD 第 6 条）；③动结构（如 `App.tsx` 拆分）前先确认 `tests/` 里那批**以源码文本断言**的用例，改结构会让它们变红。

