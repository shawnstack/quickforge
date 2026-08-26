# 根目录配置文件

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [index.html](../index.html) | HTML 入口 | 13 |
| [package.json](../package.json) | npm 包定义 | 82 |
| [vite.config.ts](../vite.config.ts) | Vite + Tailwind 配置 | 66 |
| [tsconfig.json](../tsconfig.json) | TypeScript 项目引用 | 7 |
| [tsconfig.app.json](../tsconfig.app.json) | 前端 TS 配置 | 30 |
| [tsconfig.node.json](../tsconfig.node.json) | Node TS 配置 | 29 |
| [eslint.config.js](../eslint.config.js) | ESLint 扁平化配置 | 22 |
| [.editorconfig](../.editorconfig) | 编辑器格式配置 | 15 |
| [.gitignore](../.gitignore) | Git 忽略规则 | 30 |
| [.gitattributes](../.gitattributes) | Git 属性配置 | 27 |
| [.nvmrc](../.nvmrc) | Node 版本管理 | 1 |
| [README.md](../README.md) | 项目说明 (GitHub 首页) | — |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更日志 | — |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献指南 | — |
| [DESIGN_LANGUAGE.md](../DESIGN_LANGUAGE.md) | 设计语言规范 | — |
| [SECURITY.md](../SECURITY.md) | 安全策略 | — |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | 行为守则 | — |
| [LICENSE](../LICENSE) | MIT 许可证 | — |
| [AGENTS.md](../AGENTS.md) | Agent 使用说明 | — |
| [feature_list.json](../feature_list.json) | feature 状态清单 | — |
| [progress.md](../progress.md) | 当前 feature 进度 | — |
| [session-handoff.md](../session-handoff.md) | 会话交接记录 | — |
| [init.sh](../init.sh) | 基线验证脚本（bash init.sh） | — |
| [deploy.bat](../deploy.bat) | 部署脚本 (Windows) | — |
| [dev-quickforge.bat](../dev-quickforge.bat) | 开发启动脚本 (Windows) | — |
| [start-quickforge.bat](../start-quickforge.bat) | 快速启动脚本 (Windows) | — |

---

## 各文件说明

### `index.html`

- Vite 入口 HTML
- 挂载点: `<div id="root"></div>`
- 加载 `/src/main.tsx`
- 图标: `/favicon.svg`

### `package.json`

- 包名: `@shawnstack/quickforge`
- 类型: `module` (ESM)
- npm import 入口: `server/public-api.mjs` (`main` 字段)
- 注册 CLI: `quickforge` / `qf` → `bin/quickforge.mjs`
- Desktop 脚本: `desktop:dev`、`desktop:build`、`desktop:build:win/mac/linux`、`desktop:build:all`；桌面包通过 Electron 自带 Node 能力启动打包内置 runtime，不依赖用户系统 Node/npm/qf；如本地已有 QuickForge 服务，仅同版本才复用。Windows Desktop 默认启用打包内置的 `node-pty` 本地终端。Windows NSIS 安装器通过 `desktop/installer.nsh` 在安装、升级或卸载前请求 QuickForge 正常退出（`--quit-for-update`），并在超时后清理安装目录下残留的全部进程：按规范化安装目录前缀匹配可执行路径（大小写不敏感、避免误匹配相邻目录），涵盖主程序、agent、终端（node-pty）等子进程。安装器全程写诊断日志到 `%TEMP%\QuickForge-installer.log`（UTF-16LE，无 BOM；查看：`Get-Content "$env:TEMP\QuickForge-installer.log" -Encoding Unicode`）：文件头记录安装模式（per-user/per-machine）、是否 UAC 提权内层实例（`UAC_IsInnerInstance`，per-machine 升级时内层实例会跳过运行进程检查，这是排查“QuickForge 无法关闭”弹窗的首要判据）、安装器 PID、目标目录；运行进程检查阶段逐条记录每次探测/强杀到的 PID、进程名、可执行路径与结束结果，以及 `--quit-for-update` 的 ExecWait 卡点；旧版本卸载器结果通过 `customUnInstallCheck` / `customUnInstallCheckCurrentUser` 钩子记录最终退出码 $R0（非 0 即坐实弹窗来自旧卸载器 6 次失败链路 `installUtil.nsh`，而非进程检查）。Desktop 客户端更新通过 GitHub Releases / 桌面安装包分发；npm 的 `qf update` 和设置页 Runtime 更新只更新 npm 分发的 runtime。
- 核心依赖: `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@agentclientprotocol/sdk`
- 发布包含: `bin/`, `server/`, `skills/`, `plugins/`, `vendor/`, `dist/`, `README.md`, `LICENSE`；不包含 `desktop/` 和 Electron 构建产物。`vendor/node-pty/` 为终端功能自带的 node-pty 最小运行时（四平台预编译，详见 `docs/wiki/server/README.md` terminal/ 节），npm 消费端无需安装 node-pty 可选依赖。

### `vite.config.ts`

- 插件: `@vitejs/plugin-react`, `@tailwindcss/vite`
- 开发代理: `/api` → `http://127.0.0.1:32176`
- 路径别名: `@/` → `src/`
- 构建分包: `react-vendor`, `lit-vendor`, `icons`, `css-utils`
- SSE 支持: 禁用 Vite 代理的 SSE 超时

### TypeScript 配置

- `tsconfig.json`: 引用 `tsconfig.app.json` + `tsconfig.node.json`
- `tsconfig.app.json`: 前端配置 (target es2023, JSX react-jsx, 路径别名 `@/`)
- `tsconfig.node.json`: Node 配置 (target es2023, 用于 vite.config.ts)

### `eslint.config.js`

- ESLint 扁平化配置
- 规则集: JS recommended, TypeScript recommended, React Hooks, React Refresh
- 全局忽略: `dist`、`desktop-dist`、`package-dist`、`package-offline`

### `.editorconfig`

- 缩进: 2 空格
- 编码: UTF-8
- 行尾: LF (bat 文件使用 CRLF)
- 文件末尾空行: 是

### `.nvmrc`

- Node 版本管理配置
