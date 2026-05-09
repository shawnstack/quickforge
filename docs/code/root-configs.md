# 根目录配置文件

---

## `package.json` (82 行)

**包名**: `@shawnstack/quickforge` | 版本: `1.2.2` | 许可证: MIT

**关键配置**:
- CLI 入口: `bin/quickforge.mjs`（别名 `qf`）
- 发布文件: `bin/`, `server/`, `skills/`, `dist/`, `README.md`, `LICENSE`
- 核心依赖: `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`（运行时）
- 开发依赖: React 19, Vite 8, Tailwind CSS 4, Lit 3, TypeScript 6 等
- NPM 脚本:
  - `dev` — 启动开发服务器
  - `dev:web` — Vite 前端开发
  - `build` — TypeScript 编译 + Vite 构建
  - `lint` — ESLint 检查
  - `start` / `preview` — 生产启动

## `vite.config.ts` (67 行)

**构建配置**:
- 插件: `@vitejs/plugin-react`, `@tailwindcss/vite`
- 开发代理: `/api` → `http://127.0.0.1:32176`（SSE 超时关闭）
- 路径别名: `@/` → `src/`
- 构建分块优化:
  - `react-vendor`: React/ReactDOM/Scheduler
  - `lit-vendor`: Lit/LitHTML/LitElement
  - `icons`: Lucide React
  - `css-utils`: clsx/class-variance-authority/tailwind-merge
- 编译时常量: `__QUICKFORGE_SERVER_PORT__`

## `tsconfig.app.json` (31 行)

**TypeScript 配置**:
- 目标: `ES2023`
- JSX: `react-jsx`
- 模块: `esnext` / `bundler`
- 路径别名: `@/*` → `./src/*`
- 严格检查: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`

## `tsconfig.json` / `tsconfig.node.json`

根 tsconfig（项目引用）和 Node.js 配置。

## `eslint.config.js` (23 行)

ESLint 扁平配置:
- 忽略 `dist/`
- `typescript-eslint` 推荐规则
- `react-hooks` 规则
- `react-refresh` Vite 规则

## `.editorconfig` (216 行)

统一编辑器配置（缩进、编码、换行符等）。

## `.gitignore` (317 行)

忽略 `dist/`, `node_modules/`, `.env`, `*.tgz`, 日志等。

## `index.html` (14 行)

HTML 入口文件。标题: "速构 QuickForge"，挂载点: `#root`。

## 其他根文件

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | AI Agent 协作指南 |
| `CHANGELOG.md` | 变更日志 |
| `CODE_OF_CONDUCT.md` | 行为准则 |
| `CONTRIBUTING.md` | 贡献指南 |
| `DESIGN_LANGUAGE.md` | 设计语言文档 |
| `LICENSE` | MIT 许可证 |
| `README.md` | 项目说明 |
| `SECURITY.md` | 安全策略 |
| `deploy.bat` | Windows 部署脚本 |
| `dev-quickforge.bat` | Windows 开发启动脚本 |
| `start-quickforge.bat` | Windows 启动脚本 |
