# `scripts/` — 构建/打包辅助脚本

## 文件清单

| 文件 | 说明 |
|------|------|
| [prepare-offline-package.cjs](prepare-offline-package.cjs.md) | 准备离线安装包 |
| [prepare-runtime-package.cjs](prepare-runtime-package.cjs.md) | 准备运行时发行包 |

---

### `prepare-offline-package.cjs` (22 行)

- 创建 `package-offline/` 目录
- 复制 `bin/`, `server/`, `skills/`, `dist/`, `README.md`, `LICENSE` 到包目录
- 生成精简版 `package.json` (移除 devDependencies 和 scripts，添加 bundledDependencies)

### `prepare-runtime-package.cjs` (17 行)

- 创建 `package-dist/` 目录
- 复制与离线包相同的内容
- 生成精简版 `package.json` (移除 devDependencies 和 scripts)
