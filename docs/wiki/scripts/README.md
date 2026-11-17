# `scripts/` — 构建/打包辅助脚本

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [prepare-offline-package.cjs](../../../scripts/prepare-offline-package.cjs) | 准备 package-offline 发布包 | 32 |
| [prepare-patch-release.cjs](../../../scripts/prepare-patch-release.cjs) | patch 发布准备（版本/文档/test-lint-build/打包；不执行 Git/publish） | 379 |
| [check-release-consistency.mjs](../../../scripts/check-release-consistency.mjs) | 发版一致性体检（只读）：package.json / CHANGELOG 最新 `## [X.Y.Z]` / README 顶部「当前版本 **X.Y.Z**」三处对齐，并要求 CHANGELOG 有对应小节；`git status` 的未提交项只逐条打印、不计错；`npm run check:release`，退出码与 `check:wiki` 同口径（bad>0 为 1） | 68 |
| [prepare-runtime-package.cjs](../../../scripts/prepare-runtime-package.cjs) | 准备运行时发行包 | 19 |
| [sqlite-compatibility-spike.mjs](../../../scripts/sqlite-compatibility-spike.mjs) | 开发期 `node:sqlite` 共同 API、WAL 与双进程锁等待兼容性探针 | 374 |
| [session-index-query-benchmark.mjs](../../../scripts/session-index-query-benchmark.mjs) | 开发期 1k/10k（可传 50k）JSON 与 warm SQL 会话分页对比，输出 JSON Lines 与 EXPLAIN | 126 |
| [check-wiki-line-claims.mjs](../../../scripts/check-wiki-line-claims.mjs) | 校验 `docs/wiki` 里「某文件 N 行」声明与真实行数是否一致：wc 口径、目录感知、三级文件名解析，覆盖小节 / 表行 CELL / 链接式表行 LINKTABLE / 树注释 / 反引号表行 / 双文件标题 PAIRHEAD 六种形态（链接式第二格与反引号式曾长期漏检，2026-11-13 收编；双文件共用一个括号的「(16 / 1750 行)」2026-11-15 收编——那个 `/` 让 paren 失配，ChatPanelHost.tsx 漂了 45 行没人发现）。四条护栏（计数守恒 / 规模哨兵 / SKIP 分级与非仓库文件名白名单 / 同行去重）；`npm run check:wiki`，CI 语义用 `check:wiki:strict`。退出码 1 = 有漂移，2 = strict 下有解析不到的声明，3 = 校验器自身异常（计数不守恒或匹配数骤降） | 200 |
| [archive-harness.mjs](../../../scripts/archive-harness.mjs) | Harness 状态归档：done/superseded 的 feature 与进度写入 docs/archive/ | 213 |
| [migrate-bot-workspaces.mjs](../../../scripts/migrate-bot-workspaces.mjs) | 一次性迁移 bot 工作目录名（显示名 → bot- 加 id 前 8 位） | 166 |
| [precompress-assets.mjs](../../../scripts/precompress-assets.mjs) | 为构建产物生成 .br / .gz 兄弟文件（npm run build 末尾调用） | 81 |
| [session-message-benchmark.mjs](../../../scripts/session-message-benchmark.mjs) | 开发期基准：整身会话 messages 存储测量（拆表决策依据）；`sqliteCommitMs` 是派生值（saveMs − 单独测的 encodeMs），body-only 不再编码后可能算出负数，已夹到 0 | 416 |
| [sqlite-synchronous-benchmark.mjs](../../../scripts/sqlite-synchronous-benchmark.mjs) | 开发期基准：synchronous=NORMAL 与 FULL 的会话保存热路径对比 | 173 |
| [vendor-node-pty.mjs](../../../scripts/vendor-node-pty.mjs) | 同步最小 node-pty 运行时到 vendor/node-pty（lib + prebuilds） | 96 |

---

### `prepare-patch-release.cjs` (379 行)

- 提升 patch 版本并更新 `README.md` / `CHANGELOG.md`
- 依次执行 `npm run test`、`npm run lint`、`npm run build`（任一失败即停止；`--no-test` / `--no-lint` / `--no-build` 跳过）
- 生成 `package-dist/`、`package-offline/` 及离线 tarball（`--no-pack` 跳过）
- 不执行 Git commit/tag/push，也不 npm publish；只输出待人工复核的命令
- 支持 `--dry-run` 预览、`--notes` / `--notes-file` 指定发布说明、`--skip-version` 续跑

### `check-release-consistency.mjs` (68 行)

- 版本三处一致：`package.json` 的 `version` ↔ `CHANGELOG.md` 最新的 `## [X.Y.Z]`（只认 X.Y.Z 形状的标题，`[Unreleased]` 天然跳过）↔ `README.md` 顶部的「当前版本 **X.Y.Z**」
- `CHANGELOG` 小节存在：`package.json` 的版本号必须能在 `CHANGELOG.md` 找到对应标题
- 工作树交代：`git status --porcelain` 有未提交项就逐条打印——**不算错**，只提醒发版前确认每一项归属（v2.5.0 收尾时工作树里就有别人改到一半的文件）
- 只读、不改任何文件；输出照 `check:wiki` 风格（先计数、再明细、末行 `bad=N`），退出码同口径

### `session-index-query-benchmark.mjs`

- 默认生成 1k、10k 条 canonical session metadata；可传 `50000` 等正整数规模。
- 对同一 `lastModified DESC` 分页分别测 JSON 全量过滤/排序/slice 与 warm SQLite `count + LIMIT/OFFSET`。
- 每个规模打印一行结构化 JSON，包含耗时、等价结果和 `EXPLAIN QUERY PLAN`；不设置脆弱绝对时间阈值。
- 仅使用临时数据库并自动清理；不进入常规 server runtime、npm 包文件清单或 CI 默认命令。

### `prepare-offline-package.cjs` (32 行)

- 创建 `package-offline/` 目录
- 复制 `bin/`, `server/`, `skills/`, `dist/`, `README.md`, `LICENSE` 等存在的发布条目到包目录，跳过不存在的可选条目
- 生成精简版 `package.json`，移除 devDependencies 和 scripts
- 将 `@vscode/ripgrep` 保持为 optionalDependencies，避免固定构建机平台二进制
- 不写入 `bundledDependencies`，发布到 npm/cnpm 时由 npm 按目标平台安装依赖，避免包版本体积超过镜像同步限制

### `prepare-runtime-package.cjs` (19 行)

- 创建 `package-dist/` 目录
- 复制与离线包相同的内容
- 生成精简版 `package.json` (移除 devDependencies 和 scripts)
