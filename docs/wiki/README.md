## Goal 当前契约：自动执行与无限累计时间

规划整轮只读，正常轮末及持久化成功后自动执行，不需要计划确认。新 Goal 的 maxActiveDurationMs 为 JSON null（无限），累计用时仍记录，默认轮次8，保留防空转/重复失败、工具审批、必要提问、暂停取消及单工具超时。旧快照不自动执行或改写终态；显式 resume/extend_resume/revise 移除旧时间上限，extend_resume 保留 CAS 且只给耗尽轮次 +8。有计划恢复 running，无计划重新 planning。complete 保留可信证据与正常轮末持久化屏障；needs_review 报告改为 blocked 并说明无法验证原因，不伪造 passed。历史 human evidence 与 accept API 兼容。当前聊天 controller 不再生成确认按钮，Inspector/card 不提供验收动作；历史 renderer 保留当时事实。多会话（含共享同一工作区的全局对话）可各自持有并并行执行活跃 goal，互斥仅限同一会话内，`/goal` 不再因其它对话的活跃 goal 返回 409。

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
- **Goal 模式**: 主聊天可用 `/goal <目标>` 设定带可验收标准的目标——先整轮只读规划，正常轮末持久化后自动在有限轮次内执行（累计时间无限）；模型只能提交绑定真实工具结果的证据；`complete` 经证据检查、本轮正常结束及消息/最终状态持久化成功后自动 `completed`，不需人工 accept；无法自动验证时 `needs_review` 报告落 `blocked` 并说明原因，不要求人工签字（共享会话、ACP 与定时任务不可用）。生产 UI 不挂完整 Goal 卡：输入框上方运行条显示真实状态、服务端已记录累计时长（服务端结算值为最终基准，快照之间由 1s ticker 插值当前轮流逝时间实时递增，goal 结束/移除即停）与取消 / 暂停或继续 / 编辑三个 icon（按状态与 pending 门禁）；置顶摘要 Goal 首分区为带标题分组（「Goal/目标」标题 + passed/total 计数 + 规划 criteria 只读行 + 导航按钮），点击导航按钮打开 Workspace Inspector 的 progress 视图。`GoalInspectorContent` 集中展示进度、验收与阶段动作，并提供 edit 目标编辑器；Goal Tab 按 session + goal 复用，仅运行时保留、不持久化。`goal-ui.ts` 保留运行中草稿与外部冲突的 dirty 文本，dirty 仍允许 pause/cancel；`goal-edit.ts` 运行中保存先经确认 pause，再等权威 paused 且非 streaming 后 revise。关闭侧栏会取消尚未派发的后续保存，已发 POST 不能撤回；预算耗尽可经侧栏内联确认仅给耗尽轮次追加 8 轮并移除旧时间上限并恢复同一 Goal，保留累计 usage 与计划证据；仅新增 `extend_resume` 动作使用 goalId/revision CAS，其他动作（包括 revise）仍无客户端 revision CAS，不保证跨客户端原子性；同一会话同时最多一个活跃 goal，不同会话（含共享同一工作区的全局对话）可并行执行。详见 [服务端预算恢复契约](server/README.md#goal-预算追加与恢复) 与 [客户端编排](src/lib/README.md#goal-预算追加客户端契约)
- **多模型供应商**: OpenAI 兼容 `/v1/chat/completions` 和 Anthropic Messages API

## 快速链接

- [README](https://github.com/shawnstack/quickforge#readme)
- [CHANGELOG](../CHANGELOG.md)
- [CONTRIBUTING](../CONTRIBUTING.md)
- [DESIGN_LANGUAGE](../DESIGN_LANGUAGE.md)
- [LICENSE](../LICENSE)
- [SECURITY](../SECURITY.md)
