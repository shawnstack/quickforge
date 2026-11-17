# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：桌面端「开机自启动」开关（2026-11-17 16:40）

- 目标：用户问「当前 QF 能不能设置开机自启动」。此前没有任何实现，做成关于页的桌面端专属开关：读写系统登录项，自启动拉起时只驻留托盘。
- 改动文件：`desktop/autostart-contract.mjs`（新，请求白名单解析 + 登录项 path/args 推导 + portable 路径 + `shouldStartHidden`）、`desktop/electron-main.mjs`（IPC handler + 读回状态 + `resolveStartHidden` + `ready-to-show` 不弹窗）、`desktop/electron-preload.cjs`（`QuickForgeDesktopAutostart` 窄桥）、`src/lib/desktop-autostart-bridge.ts`（新）、`src/hooks/useDesktopAutostart.ts`（新）、`src/components/settings/tabs/AboutSettingsTab.tsx`（开关）、`src/lib/i18n.ts`（3 个键中英成对）；测试 4 个新文件 22 例；wiki 4 处。
- 本轮的判据：① 读写登录项必须共用同一份 path/args（Windows 按 path + args 匹配注册表项，读用默认参数匹配不到 `--hidden` 那条，开关会自己弹回去；关闭不带 args 删不掉）；② portable 写 `PORTABLE_EXECUTABLE_FILE`（`process.execPath` 是每次都会变的临时解包路径）；③ 自启动拉起不弹窗（Windows 认 `--hidden` 参数，macOS 认 `wasOpenedAtLogin`）；④ 前端读与写共用请求序号，晚到旧响应整条丢弃，且不做乐观更新；⑤ 开发模式（`app.isPackaged` 为 false）不开放——那时 execPath 是 electron.exe，写进登录项会在开机时拉起空壳。
- 验证：定向 22 例 + 受影响既有 3 文件全绿；两条变异实测变红（去掉序号守卫 / `buildLoginItemQuery` 返回 `{}`）；`tsc -b` 净；改动文件与全量 eslint 净；`npm run build` 通过；`check:wiki` bad=0；全量 `npm run test` **605 文件 / 6482 passed + 2 skipped**。
- 状态：未 commit / tag / push；工作树只有源码 + wiki 变更（`dist/` 未被 git 跟踪）。
- Blocker：无。
- 下一步：真机冒烟（打包 Windows 版看登录项写入/读回、自启动驻留托盘、从托盘点开正常出窗）；卸载清理 Run 项可挂 `installer.nsh` 的 `customUnInstall`（当前未做，残留项无害）。

