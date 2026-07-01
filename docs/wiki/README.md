# 速构 QuickForge — Wiki 文档

> AI chat application with Agent access modes for local workspace tools.
> React 19 + Vite 8 + Tailwind CSS 4 frontend, local Node.js storage server.

## 目录结构

```
quickforge/
├── bin/               # CLI entry point
├── desktop/           # Electron desktop entry point for Windows/macOS/Linux builds
├── server/            # Local API + storage server (Node.js ESM), including ACP stdio agent adapter
├── src/               # React frontend (TypeScript/TSX)
├── scripts/           # Build/packaging helper scripts
├── public/            # Static assets (favicon)
├── .github/           # CI workflows, issue/PR templates
├── index.html         # HTML entry
├── vite.config.ts     # Vite + Tailwind config
├── tsconfig*.json     # TypeScript config
├── eslint.config.js   # ESLint flat config
├── package.json       # npm package definition
└── ...                # Other root config files
```

## Wiki 导航

| 目录 | 说明 |
|------|------|
| [bin/](bin/) | CLI 入口脚本 (`quickforge.mjs`) |
| `desktop/` | Electron 桌面端入口（Windows/macOS/Linux 构建），复用 `server/public-api.mjs` |
| [server/](server/) | 后端服务 (HTTP、Agent管理、存储、路由、工具) |
| [src/](src/) | 前端 React 应用 (组件、Hooks、工具库) |
| [scripts/](scripts/) | 打包辅助脚本 |
| [public/](public/) | 静态资源 |
| [.github/](.github/) | CI、Issue/PR 模板 |
| [根目录配置](root-config.md) | 项目根配置文件说明 |

## 项目概览

- **名称**: `@shawnstack/quickforge`
- **许可证**: MIT
- **技术栈**: React 19, Vite 8, Tailwind CSS 4, TypeScript 6
- **后端**: Node.js (ESM), 纯 `http` 模块, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`
- **三端入口**: CLI (`bin/quickforge.mjs`)、SDK (`server/public-api.mjs`)、Desktop (`desktop/electron-main.mjs`)
- **桌面托盘**: Desktop 端支持 Windows 系统托盘和 macOS 顶部菜单栏；关闭窗口隐藏到托盘，托盘菜单退出时停止桌面端启动的本地服务
- **ACP Agent**: `quickforge acp` 通过 `@agentclientprotocol/sdk` 的 `AgentSideConnection` 暴露 stdio ACP Agent，桥接现有 `server/agent-manager.mjs` 会话和工具事件。
- **数据存储**: 本地 `~/.quickforge/` 目录 (config / storage / cache / logs)
- **Agent 权限模式**: 默认权限允许读取/搜索当前 workspace，并对写入、命令、MCP/Plugin 等可能影响系统的工具请求审批；完全访问权限等同开发者授权，在既有 workspace 沙箱和敏感文件限制内自动执行工具
- **多模型供应商**: OpenAI 兼容 `/v1/chat/completions` 和 Anthropic Messages API

## 快速链接

- [README](https://github.com/shawnstack/quickforge#readme)
- [CHANGELOG](../CHANGELOG.md)
- [CONTRIBUTING](../CONTRIBUTING.md)
- [DESIGN_LANGUAGE](../DESIGN_LANGUAGE.md)
- [LICENSE](../LICENSE)
- [SECURITY](../SECURITY.md)
