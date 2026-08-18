# `scripts/` — 构建/打包辅助脚本

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [prepare-offline-package.cjs](../../scripts/prepare-offline-package.cjs) | 准备 package-offline 发布包 | 32 |
| [prepare-patch-release.cjs](../../scripts/prepare-patch-release.cjs) | patch 发布准备（版本/文档/test-lint-build/打包；不执行 Git/publish） | 351 |
| [prepare-runtime-package.cjs](../../scripts/prepare-runtime-package.cjs) | 准备运行时发行包 | 19 |
| [prune-offline-package.cjs](../../scripts/prune-offline-package.cjs) | 清理离线包中的非运行文件 | 50 |
| [sqlite-compatibility-spike.mjs](../../scripts/sqlite-compatibility-spike.mjs) | 开发期 `node:sqlite` 共同 API、WAL 与双进程锁等待兼容性探针 | 374 |
| [session-index-query-benchmark.mjs](../../scripts/session-index-query-benchmark.mjs) | 开发期 1k/10k（可传 50k）JSON 与 warm SQL 会话分页对比，输出 JSON Lines 与 EXPLAIN | 110 |

---

### `prepare-patch-release.cjs` (351 行)

- 提升 patch 版本并更新 `README.md` / `CHANGELOG.md`
- 依次执行 `npm run test`、`npm run lint`、`npm run build`（任一失败即停止；`--no-test` / `--no-lint` / `--no-build` 跳过）
- 生成 `package-dist/`、`package-offline/` 及离线 tarball（`--no-pack` 跳过）
- 不执行 Git commit/tag/push，也不 npm publish；只输出待人工复核的命令
- 支持 `--dry-run` 预览、`--notes` / `--notes-file` 指定发布说明、`--skip-version` 续跑

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

### `prepare-runtime-package.cjs` (13 行)

- 创建 `package-dist/` 目录
- 复制与离线包相同的内容
- 生成精简版 `package.json` (移除 devDependencies 和 scripts)

### `prune-offline-package.cjs` (50 行)

- 默认清理 `package-offline/node_modules/`
- 删除 sourcemap、TypeScript 类型/源码和 tsbuildinfo 等非运行文件
- 仅用于需要生成带 `node_modules` 的本地离线归档时控制体积；标准 npm 发布流程不再安装或 bundle `node_modules`
