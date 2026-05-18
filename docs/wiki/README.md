# 速构 QuickForge — Wiki 文档

> AI chat application with YOLO-mode local workspace tools.
> React 19 + Vite 8 + Tailwind CSS 4 frontend, local Node.js storage server.

## 目录结构

```
quickforge/
├── bin/               # CLI entry point
├── server/            # Local API + storage server (Node.js ESM)
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
- **后端**: Node.js (ESM), 纯 `http` 模块, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`
- **数据存储**: 本地 `~/.quickforge/` 目录 (config / storage / cache / logs)
- **YOLO 模式**: 授权 agent 读取、写入、编辑工作区文件，执行 shell 命令
- **多模型供应商**: OpenAI 兼容 `/v1/chat/completions` 和 Anthropic Messages API

## 快速链接

- [README](https://github.com/shawnstack/quickforge#readme)
- [CHANGELOG](../CHANGELOG.md)
- [CONTRIBUTING](../CONTRIBUTING.md)
- [DESIGN_LANGUAGE](../DESIGN_LANGUAGE.md)
- [LICENSE](../LICENSE)
- [SECURITY](../SECURITY.md)
