# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 桌面端「开机自启动」开关：读写系统登录项 + 自启动拉起只驻留托盘（2026-11-17 16:40）

- 任务：用户问「当前 QF 能不能设置开机自启动」。仓库里一处都没有（`desktop/`、`src/` 里 `setLoginItemSettings` / `openAtLogin` / `launchAtLogin` 零命中），只有托盘常驻。新做成关于页的一个桌面端专属开关，状态真相留在系统登录项里。
- 三个不显眼但会坏事的点各自收进 `desktop/autostart-contract.mjs`（纯函数，可单测）：
  1. **读和写必须用同一份 path/args**。Electron 在 Windows 上按 path + 参数匹配注册表启动项：读的时候用默认参数（path=execPath、args=[]）永远匹配不到带 `--hidden` 的那一条，开关会点完自己弹回去；关闭时省掉 args 也删不掉那一项。`buildLoginItemQuery` / `buildLoginItemSettings` 由同一处推导，测试直接断言两边 path/args 相等。
  2. **portable 版必须写 `PORTABLE_EXECUTABLE_FILE`**。portable 每次启动都解包到新的临时目录，`process.execPath` 指向临时文件，写进登录项下次开机就失效。
  3. **自启动拉起时只驻留托盘**。Windows 靠我们写进登录项的 `--hidden` 参数判断（`wasOpenedAtLogin` 只有 macOS 有意义，Windows 上信它会把握手动双击也吞成静默启动）；macOS 走 `wasOpenedAtLogin`。`ready-to-show` 里按 `startHidden` 决定不 `show()`，托盘照旧建。
- 前端：`useDesktopAutostart` 是状态机，状态真相在系统里（不落服务端 settings、不进 `app-settings-cache`）。两条守卫按 AGENTS.md 里那两类历史缺陷写的：**读与写共用一条请求序号**，晚到的旧响应整条丢弃（连点两次「后发的先回、先发的后回」会被整块盖回去）；**不做乐观更新**，`checked` 只在主进程回读系统状态之后变，写失败时开关停在真实值上 + `launchAtStartupFailed`。
- 安全边界：渲染进程只有 `getState` / `setEnabled`。路径、启动参数、注册表细节全在主进程，`parseAutostartRequest` 白名单把多传 `path` / `args` 的请求整条丢弃（结构测试另断言 preload 里不出现 `openAtLogin` / `setLoginItemSettings`）。
- 测试（22 例新增）：`tests/server/desktop-autostart-contract.test.mjs`（10，真跑纯函数）、`tests/frontend/use-desktop-autostart.test.ts`（4，harness 驱动状态机）、`tests/frontend/desktop-autostart-bridge.test.ts`（4，jsdom）、`tests/frontend/electron-autostart-structure.test.ts`（4，源码契约）。**两条变异验证实测变红**：去掉写响应的序号守卫 → 「晚到旧响应」用例红；`buildLoginItemQuery` 改成返回 `{}` → 「读写同一份 path/args」用例红。
- 验证：定向 4 文件 22 例 + 受影响既有 3 文件全绿；`tsc -b` 净；改动文件 eslint 净；全量 `npm run lint` 净；`npm run build` 通过；`npm run check:wiki` matched=403 resolved=402 historical=1 bad=0；全量 `npm run test` **605 文件 / 6482 passed + 2 skipped**。
- wiki 同步：`docs/wiki/README.md`（桌面端能力清单加「开机自启动」一条）、`src/lib/README.md`（新增 `desktop-autostart-bridge.ts`，`i18n.ts` 4866→4872）、`src/hooks/README.md`（新增 `useDesktopAutostart.ts`）、`src/components/README.md`（`AboutSettingsTab.tsx` 497→521 并补开关说明）。
- Notes：① Linux 上 `setLoginItemSettings` 是空实现，开关不渲染（`isAutostartSupported` 只收 win32/darwin）；开发模式（`app.isPackaged` 为 false）同样不显示——那时 `process.execPath` 是 electron.exe，写进登录项会在开机时拉起空壳；② 卸载时 electron-builder 不会清理我们自己写的 Run 项，会残留一条指向已删 exe 的无效项（Windows 忽略），将来要收口就挂 `installer.nsh` 的 `customUnInstall`；③ 未改 `installer.nsh`，安装后默认不自启（opt-in）；④ 未 commit / tag / push；`npm run build` 重新生成的 `dist/` 未被 git 跟踪，工作树只有源码与 wiki 变更。

