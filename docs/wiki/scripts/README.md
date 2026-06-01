# `scripts/` — 构建/打包辅助脚本

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [prepare-offline-package.cjs](../../scripts/prepare-offline-package.cjs) | 准备 package-offline 发布包 | 32 |
| [prepare-runtime-package.cjs](../../scripts/prepare-runtime-package.cjs) | 准备运行时发行包 | 19 |
| [prune-offline-package.cjs](../../scripts/prune-offline-package.cjs) | 清理离线包中的非运行文件 | 50 |

---

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
