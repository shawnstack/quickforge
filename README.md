# 速构 QuickForge

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.3.19-blue" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" />
  <img alt="React" src="https://img.shields.io/badge/react-19-61DAFB?logo=react" />
  <img alt="Vite" src="https://img.shields.io/badge/vite-8-646CFF?logo=vite" />
</p>

<p align="center">
  <strong>本地优先的 AI 工作台：聊天、项目上下文、本地工具、MCP、Skills 与定时任务。</strong><br />
  <strong>A local-first AI workspace for chat, project context, local tools, MCP, Skills, and scheduled tasks.</strong>
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a> · <a href="./docs/user-guide.zh-CN.md">中文教程</a> · <a href="./docs/user-guide.en-US.md">User Guide</a>
</p>

---

## 中文

QuickForge 是一个运行在本机的 AI 对话与研发辅助工具。它保留 ChatGPT 类产品的对话体验，同时把会话、项目目录、模型配置和工具调用放在本地服务中管理。你可以用它做普通问答，也可以把它绑定到一个代码仓库，让模型在明确授权后阅读文件、搜索代码、编辑内容并运行命令。

它的目标不是替代 IDE，也不是承诺“全自动开发”，而是提供一个可控的本地 AI 工作流入口：先理解项目，再制定计划，最后在你信任的范围内执行改动和验证。

### 适合用来做什么

- **理解项目**：查看目录结构、搜索调用链、解释模块职责、梳理新人接手路径。
- **小步修改代码**：让模型在项目目录内读写文件，完成文案、配置、Bug 修复或局部功能改动。
- **运行验证命令**：在项目工作区执行 lint、build、test、grep 等命令，并把结果带回对话。
- **沉淀可复用流程**：用 Agent Skills 和项目自定义命令保存团队常用提示词、Runbook 和操作步骤。
- **连接外部工具**：通过 MCP 接入文件系统、数据库、浏览器、内部服务等工具能力（取决于你配置的 MCP Server）。
- **异步/周期任务**：创建一次性、每日、每周、每月、间隔或 cron 任务，让模型按计划运行指定工作。

### 核心特性

| 特性 | 说明 |
|---|---|
| 本地优先 | 配置、API Key、会话、项目列表、缓存和日志默认保存在 `~/.quickforge/`。QuickForge 不提供云同步，也不内置遥测。 |
| 多模型提供商 | 支持 OpenAI-compatible `/v1/chat/completions` 与 Anthropic Messages API。可配置 LiteLLM、OpenRouter、DeepSeek、Qwen、Ollama 等兼容服务。 |
| 普通对话与项目对话 | 普通对话适合问答；项目对话绑定本地目录，开启授权后可使用工作区工具。 |
| YOLO 本地工具 | 授权模型在项目目录内读取、搜索、创建、覆盖、精确编辑文件，并从工作区运行 shell 命令。 |
| MCP 集成 | 支持 stdio、SSE、Streamable HTTP (`http`) MCP Server，并将外部工具以命名空间形式注入到 Agent。 |
| Agent Skills | 支持全局、共享、项目级和内置 Skills，用于加载专门的工作流说明、参考资料和工具使用规范。 |
| 自定义命令 | 支持 `/compact`、`/clear` 等内置命令，也可从项目 `.ai/commands/` 或配置目录加载团队命令。 |
| 会话工作流 | 支持流式回复、复制、回滚、分支、草稿恢复、会话搜索、上下文用量提示和长对话压缩。 |
| 定时任务 | 支持创建、编辑、手动触发、查看历史，并为任务选择模型与参数。 |
| 对话分享 | 支持创建分享链接、只读/可操作权限、可选密码保护，以及撤销分享。 |
| CLI 与离线包 | 提供 `qf` / `quickforge` 命令，支持版本检查、更新，并可使用离线 tarball 安装。 |

### 安全边界

QuickForge 的工具能力很直接，因此也需要谨慎使用：

- 文件工具限制在绑定的项目根目录内。
- `run_command` 会从项目目录启动命令，但它不是系统级沙箱，命令会以当前 OS 用户权限运行。
- YOLO 模式不会为每次工具调用弹出确认；只建议在可信模型和可信项目中开启。
- API Key 保存在本机配置文件中，请不要提交或分享 `~/.quickforge/`。
- 重要仓库建议先提交 Git 或备份，再让模型执行修改。

### 安装

#### 从 npm 安装

```bash
npm install -g @shawnstack/quickforge@1.3.19
qf

# CLI 工具
qf --version
qf check-update
qf update
```

#### 离线安装

当前版本的离线包：

```text
package-offline/shawnstack-quickforge-1.3.19.tgz
```

在安装了 Node.js 20+ 和 npm 的机器上执行：

```bash
npm install -g ./package-offline/shawnstack-quickforge-1.3.19.tgz
qf
```

该包由 `v1.3.19` 标签生成，包含离线安装所需的运行时依赖。

### 本地开发

```bash
# 安装依赖
npm install

# 开发模式：本地服务 + Vite，默认端口 5176
npm run dev

# 生产构建与启动
npm run build
npm start
```

打开 [http://localhost:5176](http://localhost:5176)。

Windows 用户也可以双击：

- `dev-quickforge.bat`：开发模式
- `start-quickforge.bat`：生产模式

### 首次配置模型

QuickForge 不内置默认模型。首次打开时，如果没有配置任何模型，聊天区会显示配置引导。

你可以在设置中添加任意兼容提供商，例如：

```text
Provider name: LiteLLM
Protocol type: OpenAI Compatible
Base URL: http://localhost:4000/v1
Model ID: anthropic/claude-sonnet-4
API Key: 按你的 LiteLLM 配置填写，可为空
```

也可以配置 OpenRouter、DeepSeek、Ollama 或其他 OpenAI-compatible / Anthropic-compatible 服务。模型请求会发送到你配置的提供商；QuickForge 只负责本地界面、存储、会话和工具编排。

### 常用环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `QUICKFORGE_DATA_DIR` | `~/.quickforge` | 数据目录 |
| `QUICKFORGE_WORKSPACE_DIR` | 项目根目录 | YOLO 工具默认工作区 |
| `QUICKFORGE_HOST` | `127.0.0.1` | 服务绑定地址 |
| `QUICKFORGE_PORT` | `32176`（dev）/ `5176`（prod） | 后端服务端口 |
| `QUICKFORGE_VITE_PORT` | `5176` | Vite 开发服务器端口 |
| `QUICKFORGE_MAX_BODY_BYTES` | `52428800` (50MB) | 请求体大小上限 |

### 数据位置

默认位于 `~/.quickforge/`（Windows 通常为 `%USERPROFILE%\.quickforge`）：

- `config/config.json` — 统一本地配置，包含应用设置、自定义 Provider、Provider API Key 和项目列表。该文件可能包含密钥，请勿分享。
- `storage/` — 会话、会话索引、分享数据等持久化数据。
- `cache/` — 可删除缓存。
- `logs/` — 本地日志。

### 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19, Vite 8, Tailwind CSS 4, TypeScript |
| UI | shadcn-style primitives, Lucide icons, `@mariozechner/pi-web-ui` |
| Agent / 模型编排 | `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, MCP SDK |
| 后端 | Node.js ESM，原生 `http` 模块 |
| 存储 | 本地 JSON 文件，默认在 `~/.quickforge/` |

### 项目结构

```text
├── bin/quickforge.mjs       # CLI 入口
├── server/                  # 本地 API、存储、Agent、工具、MCP、分享与任务服务
├── src/                     # React 前端
├── skills/                  # 内置 Agent Skills
├── scripts/                 # 打包与发布辅助脚本
├── public/                  # 静态资源
├── index.html               # HTML 入口
├── vite.config.ts           # Vite + Tailwind 配置
└── package.json
```

### 文档

- [中文使用教程](./docs/user-guide.zh-CN.md)
- [English User Guide](./docs/user-guide.en-US.md)
- [项目 Wiki](./docs/wiki/README.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

---

## English

QuickForge is a local-first AI chat and development workspace. It keeps the familiar chat experience, but connects it to local projects, local storage, configurable model providers, workspace tools, MCP servers, Agent Skills, and scheduled tasks.

It is not meant to replace your IDE or promise fully autonomous software development. The practical goal is narrower: give you a controllable place where an AI assistant can understand a project, propose a plan, make focused changes when authorized, and run the checks you ask for.

### What it is good for

- **Understanding a codebase**: inspect folders, search call chains, explain modules, and prepare onboarding notes.
- **Focused edits**: let the model read, search, create, overwrite, or precisely edit files inside an attached project directory.
- **Running verification commands**: run lint, build, tests, grep, and other shell commands from the project workspace.
- **Reusable workflows**: keep team prompts, runbooks, and operating procedures as Agent Skills or project commands.
- **External tools through MCP**: connect MCP servers for additional tools such as filesystem, database, browser, or internal service integrations, depending on your configuration.
- **Async and recurring work**: create once, daily, weekly, monthly, interval, or cron-based tasks and review their run history.

### Key features

| Feature | Details |
|---|---|
| Local-first storage | Settings, API keys, conversations, project list, caches, and logs are stored under `~/.quickforge/` by default. No built-in cloud sync or telemetry. |
| Bring your own model | Supports OpenAI-compatible `/v1/chat/completions` and Anthropic Messages API. Works with compatible providers such as LiteLLM, OpenRouter, DeepSeek, Qwen, Ollama, and others. |
| Regular and project chats | Regular chats are for general questions. Project chats attach to a local directory and can use workspace tools when authorized. |
| YOLO workspace tools | Allows the agent to read, search, create, overwrite, precisely edit files, and run shell commands from the attached workspace. |
| MCP integration | Supports stdio, SSE, and Streamable HTTP (`http`) MCP servers. External tools are injected with namespaced tool names. |
| Agent Skills | Supports global, shared, project-level, and bundled Skills for specialized workflows, references, and tool-use instructions. |
| Custom commands | Includes built-in commands such as `/compact` and `/clear`, and can load project commands from `.ai/commands/` or configured directories. |
| Conversation workflow | Streaming responses, copy, rollback, fork, draft recovery, search, context usage indicator, and conversation compaction. |
| Scheduled tasks | Create, edit, manually trigger, and inspect tasks, with model and parameter selection per task. |
| Conversation sharing | Share conversations with read-only or operate permissions, optional password protection, and revocation support. |
| CLI and offline package | Provides `qf` / `quickforge` commands, update checks, update command, and offline tarball installation. |

### Safety model

QuickForge intentionally exposes powerful local capabilities, so the boundaries matter:

- File tools are restricted to the attached project root.
- `run_command` starts in the project directory, but it is not an OS-level sandbox. Commands run with the current OS user's permissions.
- YOLO mode does not ask for confirmation before every tool call. Use it only with trusted models and trusted workspaces.
- API keys are stored locally. Do not commit or share your `~/.quickforge/` directory.
- Commit to Git or make a backup before asking the model to change important repositories.

### Installation

#### npm

```bash
npm install -g @shawnstack/quickforge@1.3.19
qf

# CLI utilities
qf --version
qf check-update
qf update
```

#### Offline tarball

The offline release package for `v1.3.19` is:

```text
package-offline/shawnstack-quickforge-1.3.19.tgz
```

Install it on a machine with Node.js 20+ and npm:

```bash
npm install -g ./package-offline/shawnstack-quickforge-1.3.19.tgz
qf
```

The package was generated from tag `v1.3.19` and includes bundled runtime dependencies for offline installation.

### Local development

```bash
# Install dependencies
npm install

# Development: local service + Vite, default port 5176
npm run dev

# Production
npm run build
npm start
```

Open [http://localhost:5176](http://localhost:5176).

On Windows, you can also double-click:

- `dev-quickforge.bat` for development mode
- `start-quickforge.bat` for production mode

### First model setup

QuickForge does not ship with a default model. If no model is configured on first launch, the chat area shows a setup guide.

You can add any compatible provider in Settings, for example:

```text
Provider name: LiteLLM
Protocol type: OpenAI Compatible
Base URL: http://localhost:4000/v1
Model ID: anthropic/claude-sonnet-4
API Key: optional, depending on your LiteLLM configuration
```

You can also configure OpenRouter, DeepSeek, Ollama, or any other OpenAI-compatible / Anthropic-compatible service. Model requests are sent to the provider you configure; QuickForge provides the local UI, storage, conversation management, and tool orchestration.

### Common environment variables

| Variable | Default | Description |
|---|---|---|
| `QUICKFORGE_DATA_DIR` | `~/.quickforge` | Data directory |
| `QUICKFORGE_WORKSPACE_DIR` | project root | Default workspace for YOLO tools |
| `QUICKFORGE_HOST` | `127.0.0.1` | Server bind address |
| `QUICKFORGE_PORT` | `32176` (dev) / `5176` (prod) | Backend server port |
| `QUICKFORGE_VITE_PORT` | `5176` | Vite dev server port |
| `QUICKFORGE_MAX_BODY_BYTES` | `52428800` (50MB) | Max request body size |

### Data location

Located under `~/.quickforge/` by default (`%USERPROFILE%\.quickforge` on Windows):

- `config/config.json` — unified local config, including app settings, custom providers, provider API keys, and project list. This file may contain secrets; do not share it.
- `storage/` — persistent conversations, indexes, shares, and related data.
- `cache/` — removable cache files.
- `logs/` — local logs.

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, TypeScript |
| UI | shadcn-style primitives, Lucide icons, `@mariozechner/pi-web-ui` |
| Agent / model orchestration | `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, MCP SDK |
| Server | Node.js ESM, plain `http` module |
| Storage | Local JSON files under `~/.quickforge/` by default |

### Project structure

```text
├── bin/quickforge.mjs       # CLI entry point
├── server/                  # Local API, storage, agents, tools, MCP, sharing, and task service
├── src/                     # React frontend
├── skills/                  # Bundled Agent Skills
├── scripts/                 # Build and packaging helpers
├── public/                  # Static assets
├── index.html               # HTML entry
├── vite.config.ts           # Vite + Tailwind config
└── package.json
```

### Documentation

- [中文使用教程](./docs/user-guide.zh-CN.md)
- [English User Guide](./docs/user-guide.en-US.md)
- [Project Wiki](./docs/wiki/README.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)

## License

[MIT](LICENSE)
