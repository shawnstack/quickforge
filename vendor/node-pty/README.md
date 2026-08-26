# Vendored node-pty runtime

[node-pty](https://github.com/microsoft/node-pty) 的最小运行时分发副本。上游 npm 包为全平台一锅端
（tarball 15MB / 解压 61MB，其中约 48MB 为 `.pdb` 调试符号），且 npm 无法按平台裁剪；
此目录只保留运行所需文件（约 5MB，含 4 个平台），随 `@shawnstack/quickforge` 直接分发，
使终端功能在 win32/darwin 平台无需安装原生依赖即可使用。

- 布局与上游一致：`lib/`（运行时 JS）与 `prebuilds/<platform>-<arch>/`（原生二进制，
  N-API 构建，跨 Node 版本 ABI 稳定）保持兄弟目录关系，`lib/utils.js` 的
  `loadNativeModule` 按相对路径解析，无需任何安装脚本。
- 平台覆盖见 `VENDOR.json`（win32-x64 / win32-arm64 / darwin-x64 / darwin-arm64）。
  上游 1.1.0 未提供 Linux 预编译，Linux 终端仍依赖外部安装 node-pty 或不可用（服务端优雅降级）。
- 许可：上游根 `LICENSE`（MIT）随目录分发；`licenses/` 内为上游 npm 包未携带的
  winpty / conpty 第三方许可文本，重新生成时保持不动。

重新生成（升级 node-pty devDependency 后）：

```bash
npm install && node scripts/vendor-node-pty.mjs
```

`scripts/vendor-node-pty.mjs` 只重建 `lib/`、`prebuilds/`、`LICENSE`、`VENDOR.json`，
`licenses/` 与本 README 由仓库维护。

注意：macOS 上 node-pty 会直接 `posix_spawn` 执行 `prebuilds/darwin-*/spawn-helper`，
该文件需要可执行位。运行时 `terminal-manager` 的 `ensureVendoredSpawnHelperExecutable()`
会在 darwin 上自愈补上；若在 Windows 上重新生成后提交，需重设 git index 执行位：

```bash
git update-index --chmod=+x vendor/node-pty/prebuilds/darwin-*/spawn-helper
```

