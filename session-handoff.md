# Session Handoff

- Feature: 启动 health 等待默认 15s→5min + 子进程死亡提前退出（startup-health-timeout-5min）
- Status: **done**（已随 v1.7.9 发布；release commit 与 tag 推送后补充；npm publish 待用户手动执行）

## 当前目标（已达成）

升级后首次启动的 SQLite cutover 迁移不再撞上 15 秒 health check 窗口：CLI（`qf start`/`lan`/`restart`）与 public-api（desktop/SDK spawn 模式）默认最长等待 5 分钟；子进程崩溃/端口占用导致提前退出时秒级失败并报出退出码/信号，不挂满 5 分钟。

## 改动文件

- `bin/quickforge.mjs`：`waitForHealth` 默认 `timeoutMs` 15000→`STARTUP_HEALTH_TIMEOUT_MS`（300000）；轮询内 `expectedPid && !isProcessRunning(expectedPid)` 时 `sleep(300)` 后返回 null（给 exit 事件派发机会，调用方优先报 `process exited early`）。
- `server/public-api.mjs`：新增 `STARTUP_HEALTH_TIMEOUT_MS` 与 `isProcessRunning()`；`waitForQuickForge` 默认 300000 + `expectedPid` 死亡提前退出（同样 300ms grace）；仅 spawn 调用点传 `{ ...options, expectedPid: child.pid }`，inline 模式不变。
- `tests/server/startup-health-timeout.test.mjs`（新增）：4 项源码断言 + 1 项行为测试（blocker 占端口→spawn server EADDRINUSE exit(1)→秒级 rejects `process exited early`，elapsed<45s；mkdtemp 隔离）。
- `docs/wiki/bin/README.md`：启动流程第 3 条补默认 5 分钟与提前退出（start/lan/restart 共用）。
- 状态文件：`feature_list.json`（新条目 done）、`progress.md`、`session-handoff.md`。
- 未改 `docs/wiki/server/README.md`：无 public-api/SDK 小节与启动超时描述，无需同步。

## 验证结果

- `node --check bin/quickforge.mjs server/public-api.mjs`：通过。
- `npx eslint bin/quickforge.mjs server/public-api.mjs tests/server/startup-health-timeout.test.mjs`：0 error / 0 warning。
- `npx vitest run tests/server/startup-health-timeout.test.mjs tests/server/public-api.test.mjs`：2 文件 12 项通过（行为测试 1.6s，证明提前退出生效）。
- 发布门禁：`npm run test` 204 文件 / 1646 项 100% 通过；`npm run lint` 0 error（仅既有 identity.mjs warning）；`npm run build` exit 0。
- 打包：`package-offline/shawnstack-quickforge-1.7.9.tgz`（shasum 14895da046ac634bdde6d347b15b2c530f91f748）；已验证包内 bin/ 与 server/ 均含 5 分钟默认值与提前退出逻辑。

## Blockers

- 无。

## Next step

- v1.7.9 Git 发布（release commit、tag v1.7.9、push）由主 Agent 执行；npm publish 待用户手动执行：`cd package-offline && npm publish --access public`。
- 备注：desktop/electron-main.mjs 调 `startQuickForge` 未传 `timeoutMs`，自动继承新默认 5 分钟与提前退出，无需改动。
