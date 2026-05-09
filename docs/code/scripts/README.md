# `scripts/` — 构建和打包脚本

**路径**: `scripts/`

---

## prepare-runtime-package.cjs (17 行)

**用途**: 准备运行时分发包。将 `bin/`、`server/`、`skills/`、`dist/`、`README.md`、`LICENSE` 复制到 `package-dist/` 目录，并生成精简的 `package.json`（移除 devDependencies 和 scripts）。

## prepare-offline-package.cjs (19 行)

**用途**: 准备离线安装包。与 `prepare-runtime-package` 类似，但额外复制 `node_modules/`，并将依赖标记为 `bundledDependencies`，生成到 `package-offline/` 目录。
