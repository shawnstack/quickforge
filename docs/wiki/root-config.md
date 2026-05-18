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
- 注册 CLI: `quickforge` / `qf` → `bin/quickforge.mjs`
- 核心依赖: `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`
- 发布包含: `bin/`, `server/`, `skills/`, `dist/`, `README.md`, `LICENSE`

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
- 全局忽略: `dist`

### `.editorconfig`

- 缩进: 2 空格
- 编码: UTF-8
- 行尾: LF (bat 文件使用 CRLF)
- 文件末尾空行: 是

### `.nvmrc`

- Node 版本管理配置
