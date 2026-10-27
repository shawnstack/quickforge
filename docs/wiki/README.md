# 速构 QuickForge — Wiki 文档

> AI chat application with Agent access modes for local workspace tools.
> React 19 + Vite 8 + Tailwind CSS 4 frontend, local Node.js storage server.

## 目录结构

```
quickforge/
├── android/           # Capacitor Android 原生工程（远程客户端薄壳）
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
| `android/` | Capacitor Android 原生工程；内置服务器连接页，通过 Tailscale 加载远端 QuickForge 页面；`QuickForgeNotificationService` 前台服务在后台轮询 `/api/agents`，任务结束时发通知栏提醒（由 `window.QuickForgeBridge` 控制启停） |
| [bin/](bin/) | CLI 入口脚本 (`quickforge.mjs`) |
| `desktop/` | Electron 桌面端入口（Windows/macOS/Linux 构建），复用 `server/public-api.mjs`；通过隔离 preload 暴露窄系统通知桥接，由主进程创建原生通知并在点击时恢复/聚焦窗口、打开对应会话；桌面包内置 `server/` 与 `dist/` runtime，不依赖用户本机 Node/npm/qf，且只复用同版本的本地 QuickForge 服务 |
| [server/](server/) | 后端服务 (HTTP、Agent管理、存储、路由、工具) |
| [src/](src/) | 前端 React 应用 (组件、Hooks、工具库) |
| [scripts/](scripts/) | 打包辅助脚本 |
| [public/](public/) | 静态资源 |
| [.github/](.github/) | CI、Issue/PR 模板 |
| [根目录配置](root-config.md) | 项目根配置文件说明 |

## 架构与设计文档

| 文档 | 说明 |
|------|------|
| [工作流编排架构](../architecture/workflow-orchestration.zh-CN.md) | `run_workflow` 脚本编排 Agent 与工具（hook 契约、并发与审批、worker 隔离） |
| [会话存储 v2](../architecture/session-storage-v2.zh-CN.md) | 会话域存储的当前事实源（SQLite 单一权威、写入/删除/空间回收、备份恢复入口） |
| [SQLite 存储基础层](../architecture/sqlite-storage-foundation.zh-CN.md) | `node:sqlite` 连接、PRAGMA、append-only migration 协议 |
| [会话状态事务化存储](../architecture/session-state-transactional-storage.zh-CN.md) | F8/F9 历史决策记录（CAS、tombstone、拆分写入） |
| [Session Index 基础](../architecture/session-index-foundation.zh-CN.md) / [查询迁移](../architecture/session-index-query-migration.zh-CN.md) | F6/F7 历史决策记录（列表分页索引与降级） |
| [定时任务运行记录 Repository](../architecture/scheduled-task-runs-repository.zh-CN.md) / [权威切换](../architecture/scheduled-task-runs-authoritative-cutover.zh-CN.md) | F3/F5 历史决策记录 |
| [分享令牌存储迁移](../architecture/share-token-storage-migration.zh-CN.md) / [LAN 访问存储迁移](../architecture/lan-access-storage-migration.zh-CN.md) | F10/F11 历史决策记录 |
| [插件系统](../architecture/plugin-system.zh-CN.md) / [Agent 能力插件系统](../architecture/agent-plugin-system.zh-CN.md) | 当前 V1 能力与目标架构 |
| [自定义 Agent / Agent Profile](../architecture/custom-agents-design.zh-CN.md) | Agent Profile 架构与存储 |
| [浏览器缓存策略](../architecture/browser-cache-strategy.zh-CN.md) | 应用层缓存分级与已实施范围 |
| [会话打开快路径](../architecture/session-open-fast-path.zh-CN.md) | 打开历史会话的耗时构成、交互契约红线、内容寻址渲染缓存与后续里程碑 |
| [对话轨迹](../architecture/conversation-trace.zh-CN.md) | 对话区的只读运行时视图（Turn→Step→Tool 投影、三轨时间总览、检查器、不虚构耗时） |
| [Dreaming 记忆固化](../architecture/dreaming-memory.zh-CN.md) | 后台把已结束会话沉淀为长期记忆（结构化经验库 + FTS5 检索 + MEMORY.md 自动区 + `recall_experience`） |
| [日志系统设计](../architecture/logging-design.zh-CN.md) | 日志分级、落盘与清理 |
| [Android 远程客户端](../architecture/android-remote-client.zh-CN.md) | Capacitor 薄壳、Tailscale 直连与通知 |
| [小版本发布 Runbook](../architecture/patch-release-runbook.zh-CN.md) | patch 版本发布流程 |
| [Bug 追踪](../bug/README.md) | server / 前端待修 bug 清单 |

## 项目概览

- **名称**: `@shawnstack/quickforge`
- **许可证**: MIT
- **技术栈**: React 19, Vite 8, Tailwind CSS 4, TypeScript 6
- **后端**: Node.js (ESM), 纯 `http` 模块, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`
- **四端入口**: CLI (`bin/quickforge.mjs`)、SDK (`server/public-api.mjs`)、Desktop (`desktop/electron-main.mjs`)、Android (`android/` + `capacitor.config.ts`)
- **桌面运行时隔离**: Desktop 安装包包含自身的 `server/` 与 `dist/` runtime，启动时通过 Electron 自带 Node 能力调用 `server/public-api.mjs`，不要求用户安装 Node/npm/qf；server 默认以独立子进程运行（避免同步 SQLite 大事务/GC 停顿冻结 Electron 主进程），设 `QUICKFORGE_DESKTOP_INLINE=1` 才以 inline 内嵌模式运行（需要 Chromium 代理栈/自定义 PAC 地址时使用）；内联服务不得向 Electron 主进程保留 `ELECTRON_RUN_AS_NODE`，该标志仅传给明确使用 Electron 执行 Node 脚本的子进程，避免 Renderer Helper 被误以 Node 模式启动；桌面端默认使用 `QUICKFORGE_DESKTOP_PORT` 或独立端口 `5177`，与 `qf` CLI 默认的 `5176` 分离；仅当已有本地 QuickForge 服务版本与桌面包版本一致时才复用，避免新版桌面壳加载旧 npm 服务的前端资源导致样式/API 错配。
- **桌面托盘**: Desktop 端支持 Windows 系统托盘和 macOS 顶部菜单栏；关闭窗口隐藏到托盘，托盘菜单退出时停止桌面端启动的本地服务
- **ACP Agent**: `quickforge acp` 通过 `@agentclientprotocol/sdk` 的 `AgentSideConnection` 暴露 stdio ACP Agent，桥接现有 `server/agent-manager.mjs` 会话和工具事件。
- **数据存储**: 本地 `~/.quickforge/` 目录 (config / storage / cache / logs)
- **Agent 权限模式**: 默认权限允许读取/搜索当前 workspace，并对写入、命令、MCP/Plugin 等可能影响系统的工具请求审批；完全访问权限等同开发者授权，在既有 workspace 沙箱和敏感文件限制内自动执行工具
- **工作流编排**: 主会话可按需调用 `run_workflow`，用一段短 JavaScript 编排多个 Subagent 与工作区工具（`agent` / `tool` / `parallel` / `pipeline` / `phase` / `log` / `args`）；脚本在独立 worker 线程的 vm 上下文中运行，不暴露 Node globals，最终结果必须 JSON 可序列化；Agent 步骤可点击进入 Subagent 运行详情面板。脚本上限 20KB；默认权限下启动前展示完整脚本并审批一次，**步骤强制串行（并发恒为 1）**以保证审批卡可见，每个 Agent 与 `tool()` 的调用仍走既有审批；只有完全访问模式才使用配置的 `concurrency`（默认 4，上限 8）。默认 24 个 Agent、64 次工具调用、1 小时总时长，可在 `options` 中按 `maxAgents` 1–64 / `maxTools` 1–128 / `concurrency` 1–8 / `maxRuntimeMs` 1 秒–2 小时调整。不开放直接 REST 执行，Subagent 不能递归编排。详见 [工作流编排架构](../architecture/workflow-orchestration.zh-CN.md)
- **Goal 模式（v2 默认）**: 主聊天与定时任务可用 `/goal <目标>` 设定带可验收标准的目标；ACP 与 shared 请求仍拒绝 Goal。v2 使用 4 个持久 phase（active / paused / blocked / complete）+ 进程本地 armed/disarmed，goal 变更以 `goal/change` 事件日志持久化并支持 `{id, revision}` CAS；规划轮整轮只读，正常轮末持久化后自动执行，模型只能提交绑定真实工具结果的证据，`complete` 经证据检查、正常轮末与持久化屏障后自动完成。重启/fork 后 active 目标保持 active 但 disarmed，必须显式 `/goal resume`；`clear` 写 tombstone。旧会话继续走 legacy 13 状态引擎（设置·通用「Goal 引擎」可切换或 `QUICKFORGE_GOAL_ENGINE=legacy`）。详见 [服务端 Goal v2 契约](server/README.md#goal-v2默认servergoal)

- **多模型供应商**: OpenAI 兼容 `/v1/chat/completions` 和 Anthropic Messages API

## 快速链接

- [README](https://github.com/shawnstack/quickforge#readme)
- [CHANGELOG](../../CHANGELOG.md)
- [CONTRIBUTING](../../CONTRIBUTING.md)
- [DESIGN_LANGUAGE](../../DESIGN_LANGUAGE.md)
- [LICENSE](../../LICENSE)
- [SECURITY](../../SECURITY.md)
