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
| 内嵌 AI 浏览器（桌面端） | Electron 主进程 WebContentsView + 唯一 CDP 连接 + 主进程内 StreamableHTTP MCP server；详见 [桌面端内嵌 AI 浏览器架构](../architecture/desktop-agent-browser.zh-CN.md) |
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
| [Bot 模式（已落地）](server/bots.md) | 一个 bot = 一条持久会话 + 独占目录 `~/.quickforge/bots/bot-<id 前 8 位>` + 独立 `MEMORY.md` + 可开关心跳；左上角「对话 / BOT」分段切换（仅侧栏展开时显示，折叠态只留展开侧栏按钮）。目录名跟显示名解耦：名字可随时改、可含中文。bot 目录是 `kind: 'bot'` 的注册项目，但不算「用户的当前项目」；bot 模式下主区不显示项目/分支 |
| [Bot 主动性](../architecture/bot-proactivity.zh-CN.md) | 设计文档（**已立项待实施**）：提示词驱动为主轴——引导式心跳指令（自由探索、`[报告]` 首行契约、记忆自我迭代 + 渐进披露、不 commit 留痕可回滚）；harness 只补三个硬缺口（`[报告]` 事件 → 现有 toast/桌面通知、催醒按钮接线、`POST /api/bots/:id/inbox` 投喂口）；项目半径零代码复用 qf-api（`sessions` 自发现 + `spawn` 绑定项目的子会话读写），判活扩展/单跳超时等列为阶段 3 可选 |
| [自进化回路](../architecture/self-evolution-loop.zh-CN.md) | 设计文档（**部分落地**）：把「让 AI 自己改进自己」拆成六环回路（目标→感知→诊断→生成→验证→准入 + 回滚/预算横切），给出三条架构约束（最弱环决定上限、验证者必须与生成者隔离、准入按影响半径而非对错分级）与 R0/R1/R2 三档半径闸门；§10 记录 2026-11-10 落地的 `<continuity>` 提示词块与自约任务删除边界，以及「服务端识别不了调用方时改用声明式校验」这条取舍 |
| [会话消息实时一致性](../architecture/message-log-consistency.zh-CN.md) | 消息日志版本、连接级投递游标、SSE 续传与 `applyLog` 单一投影（双端一致契约） |
| [会话存储 v2](../architecture/session-storage-v2.zh-CN.md) | 会话域存储的当前事实源（SQLite 单一权威、baseline v19 三表、写入/删除/空间回收、备份恢复入口） |
| [SQLite 存储基础层](../architecture/sqlite-storage-foundation.zh-CN.md) | `node:sqlite` 连接、PRAGMA、append-only migration 协议与 baseline v19（历史迁移链已折叠） |
| [会话状态事务化存储](../architecture/session-state-transactional-storage.zh-CN.md) | F8/F9 历史决策记录（CAS、tombstone、拆分写入） |
| [Session Index 基础](../architecture/session-index-foundation.zh-CN.md) / [查询迁移](../architecture/session-index-query-migration.zh-CN.md) | F6/F7 历史决策记录（列表分页索引与降级） |
| [定时任务运行记录 Repository](../architecture/scheduled-task-runs-repository.zh-CN.md) / [权威切换（归档）](../architecture/scheduled-task-runs-authoritative-cutover.zh-CN.md) | F3 当前 repository 契约；F5 为归档历史（phase 状态机与 cutover coordinator 已删除，现为单路径权威） |
| [分享令牌存储迁移（归档）](../architecture/share-token-storage-migration.zh-CN.md) / [LAN 访问存储迁移（归档）](../architecture/lan-access-storage-migration.zh-CN.md) | F10/F11 归档历史（phase 状态机、mirror 队列与 cutover 链已删除，两域均为单路径 SQLite 权威） |
| [插件系统](../architecture/plugin-system.zh-CN.md) / [Agent 能力插件系统](../architecture/agent-plugin-system.zh-CN.md) | 当前 V1 能力与目标架构 |
| [自定义 Agent / Agent Profile](../architecture/custom-agents-design.zh-CN.md) | Agent Profile 架构与存储 |
| [浏览器缓存策略](../architecture/browser-cache-strategy.zh-CN.md) | 应用层缓存分级与已实施范围 |
| [会话打开快路径](../architecture/session-open-fast-path.zh-CN.md) | 打开历史会话的耗时构成、交互契约红线、内容寻址渲染缓存与后续里程碑 |
| [渲染内存与附件边界](../architecture/render-memory-and-attachment-boundary.zh-CN.md) | 流式单份帧、定稿缓存、有界渲染窗口、附件引用与按需读取、首屏压缩 |
| [对话渲染性能与内存评审](../architecture/chat-render-perf-review.zh-CN.md) | 流式稳定块冻结、工具事件合并、装饰固定成本、缓存字节预算与序列化共享（含 5 项否决候选与理由） |
| [对话轨迹](../architecture/conversation-trace.zh-CN.md) | 对话区的只读运行时视图（Turn→Step→Tool 投影、三轨时间总览、检查器、不虚构耗时） |
| [记忆体系：工作记忆 + 经验库](../architecture/memory-system.zh-CN.md) | 三层记忆（`MEMORY.md` 偏好 / `working-memory/` 活笔记 / `experiences/` 经验库）+ 生成式索引的渐进式披露 + 记忆整理员「一次一个会话」逐轮起 agent + 整目录快照回滚 |
| [QuickForge 本地 API Skill](../architecture/quickforge-api-skill.zh-CN.md) | 内置 `quickforge-api`：Agent 通过本机 HTTP API 自省与自我操作。为什么是 skill 而不是通用 HTTP 工具、`run_command` 的环境变量身份注入、白名单端点与不给出口的破坏性端点 |
| [前端状态管理迁移（Zustand）](../architecture/zustand-migration.zh-CN.md) | App 级状态迁入 `src/stores/` 的 10 个 zustand store（兼容层模式、请求信号替代 window 事件桥、迁移守则与测试适配） |
| [日志系统设计](../architecture/logging-design.zh-CN.md) | 日志分级、落盘与清理 |
| [Android 远程客户端](../architecture/android-remote-client.zh-CN.md) | Capacitor 薄壳、Tailscale 直连与通知 |
| [桌面端内嵌 AI 浏览器](../architecture/desktop-agent-browser.zh-CN.md) | 内置 WebContentsView 浏览器、CDP 引用世代、安全边界与 annotations 审批粒度；会话坏死（崩溃/断开/命令超时）整套视图作废重建，不复用坏会话 |
| [小版本发布 Runbook](../architecture/patch-release-runbook.zh-CN.md) | patch 版本发布流程 |
| [Bug 追踪](../bug/README.md) | server / 前端待修 bug 清单 |

## 项目概览

- **名称**: `@shawnstack/quickforge`
- **许可证**: MIT
- **技术栈**: React 19, Vite 8, Tailwind CSS 4, TypeScript 6
- **后端**: Node.js (ESM), 纯 `http` 模块, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`
- **四端入口**: CLI (`bin/quickforge.mjs`)、SDK (`server/public-api.mjs`)、Desktop (`desktop/electron-main.mjs`)、Android (`android/` + `capacitor.config.ts`)
- **桌面运行时隔离**: Desktop 安装包包含自身的 `server/` 与 `dist/` runtime，启动时通过 Electron 自带 Node 能力调用 `server/public-api.mjs`，不要求用户安装 Node/npm/qf；server 默认以独立子进程运行（避免同步 SQLite 大事务/GC 停顿冻结 Electron 主进程），设 `QUICKFORGE_DESKTOP_INLINE=1` 才以 inline 内嵌模式运行（需要 Chromium 代理栈/自定义 PAC 地址时使用）；内联服务不得向 Electron 主进程保留 `ELECTRON_RUN_AS_NODE`，该标志仅传给明确使用 Electron 执行 Node 脚本的子进程，避免 Renderer Helper 被误以 Node 模式启动；桌面端默认使用 `QUICKFORGE_DESKTOP_PORT` 或独立端口 `5177`，与 `qf` CLI 默认的 `5176` 分离；仅当已有本地 QuickForge 服务版本与桌面包版本一致时才复用，避免新版桌面壳加载旧 npm 服务的前端资源导致样式/API 错配；子进程的工作目录固定为用户主目录（`app.getPath('home')`），因为打包后 `server/` 位于 `app.asar` 内、归档路径不是磁盘目录，拿它当 `spawn` 的 `cwd` 会直接 `ENOENT` 启动失败。
- **桌面托盘**: Desktop 端支持 Windows 系统托盘和 macOS 顶部菜单栏；关闭窗口隐藏到托盘，托盘菜单退出时停止桌面端启动的本地服务
- **内嵌 AI 浏览器（桌面端）**: Agent 通过内置 MCP server 驱动应用内的真实浏览器视图（navigate / snapshot / click / type / press_key / scroll / wait_for / screenshot / evaluate）；页面在独立 session 分区里运行，本地与私网地址被导航策略拒绝，只读工具凭 MCP annotations 免审批。详见 [桌面端内嵌 AI 浏览器架构](../architecture/desktop-agent-browser.zh-CN.md)
- **ACP Agent**: `quickforge acp` 通过 `@agentclientprotocol/sdk` 的 `AgentSideConnection` 暴露 stdio ACP Agent，桥接现有 `server/agent-manager.mjs` 会话和工具事件。
- **数据存储**: 本地 `~/.quickforge/` 目录 (config / storage / cache / logs)
- **Agent 权限模式**: 默认权限允许读取/搜索当前 workspace，并对写入、命令、MCP/Plugin 等可能影响系统的工具请求审批；完全访问权限等同开发者授权，在既有 workspace 沙箱和敏感文件限制内自动执行工具
- **工作流编排**: 主会话可按需调用 `run_workflow`，用一段短 JavaScript 编排多个 Subagent 与工作区工具（`agent` / `tool` / `parallel` / `pipeline` / `phase` / `log` / `args`）；脚本在独立 worker 线程的 vm 上下文中运行，不暴露 Node globals，最终结果必须 JSON 可序列化；Agent 步骤可点击进入 Subagent 运行详情面板。脚本上限 20KB；默认权限下启动前展示完整脚本并审批一次，**步骤强制串行（并发恒为 1）**以保证审批卡可见，每个 Agent 与 `tool()` 的调用仍走既有审批；只有完全访问模式才使用配置的 `concurrency`（默认 4，上限 8）。默认 24 个 Agent、64 次工具调用、1 小时总时长，可在 `options` 中按 `maxAgents` 1–64 / `maxTools` 1–128 / `concurrency` 1–8 / `maxRuntimeMs` 1 秒–2 小时调整。不开放直接 REST 执行，Subagent 不能递归编排。详见 [工作流编排架构](../architecture/workflow-orchestration.zh-CN.md)
- **Goal 模式（v2 默认）**: 主聊天与定时任务可用 `/goal <目标>` 设定带可验收标准的目标；ACP 与 shared 请求仍拒绝 Goal。v2 使用 4 个持久 phase（active / paused / blocked / complete）+ 进程本地 armed/disarmed，goal 变更以 `goal/change` 事件日志持久化并支持 `{id, revision}` CAS；**v2 没有规划轮**，每一轮都是执行轮，正常轮末持久化后自动进入下一轮。**v2 也没有证据门禁**：`update_goal complete` 是模型自声明的完成路径（`goal_report` 那套 plan + criteria + evidence 强校验只属于 legacy 引擎，v2 会话故意不挂载它）；提示词层面要求 `blocked` 前同一阻塞条件至少连续 3 轮。重启/fork 后 active 目标保持 active 但 disarmed，必须显式 `/goal resume`；`clear` 写 tombstone。旧会话继续走 legacy 13 状态引擎（设置·通用「Goal 引擎」可切换或 `QUICKFORGE_GOAL_ENGINE=legacy`）。详见 [服务端 Goal v2 契约](server/README.md#goal-v2默认servergoal)

- **多模型供应商**: OpenAI 兼容 `/v1/chat/completions` 和 Anthropic Messages API
- **存续与自约任务（`<continuity>`）**: 内置 `quickforge-api` skill 可用时，系统提示词注入 `<continuity>`——告诉 AI 它不必只在被叫的时候存在，可以给自己排一个定时任务班次，把「想做但本次做不完的事」交给未来的自己。配套的规矩写在同一块里：三个条件都成立才值得排（本次做不完 / 下一个你能从你写下的字明白为什么 / 值得一次模型调用）、说不出第一步就闭嘴、**什么都不做是正确的选择**、最多存在一条、建前先 `tasks` 查、`instruction` 当成给下一个自己的信来写、醒来先 `tasks` + `task-runs` 认领自己、干完先把结论写进工作记忆或经验库再删掉自己、在 `[自约]` 会话里不许再排班（防指数增长）。落地细节：`task-add --self-scheduled` 会自动把标题加上 `[自约]` 前缀并把 `createdBy` 记成 `'agent'`；只有这种任务允许 `task-delete` 收掉——脚本固定带 `?selfScheduledOnly=1`，服务端据此校验并对其余任务返回 403，而界面删除不带该参数所以行为不变。存量任务没有 `createdBy` 字段，一律按 `'user'` 处理。
- **工作记忆（Beta）**: 设置页可开启「工作记忆」（与「用户记忆」「记忆整理」同属设置里的「记忆」分组）。开启后系统提示词注入 `<working_memory>`：共享笔记目录 `~/.quickforge/memory/notes/`、几条原则和内部笔记提示词（以压缩摘要提示词为底本改写成大白话，属于内部契约，设置页不暴露也不接受修改）。原则只讲机制和触发点——开工前先列目录挑相关的读，**觉得任务做完时回头看一眼有没有值得留给下次的东西，没有就不写**，不规定固定小节模板。一个 Markdown 文件只记一件事，文件名就是内容的一句话总结；读写走 `list_memory_notes` / `read_memory_note` / `write_memory_note` / `move_memory_note` 四个工具（路径锁死在工作记忆与经验库两个目录内，不新增沙箱放宽，也**没有删除**——退休的笔记挪进 `_archive/`）。设置页的笔记区是只读的：按更新时间倒序分页列出标题与时间，每条可「打开」在系统文件管理器里选中该文件，目录行另有「打开文件夹」，不提供正文编辑。详见 [记忆体系：工作记忆 + 经验库](../architecture/memory-system.zh-CN.md)
- **经验库**: `~/.quickforge/memory/experiences/`，一条经验一个文件（文件名即结论；文件头是 front matter：`title` / `description` / `general` / `candidate_skill`，正文是「怎么做 / 坑 / 来源」）。系统提示词里**只注入扫描生成的 `index.md`**（200 行封顶，一行只有文件名，`（特殊）` 标记只对某个项目成立的条目），正文按需 `read_memory_note` 读——这就是渐进式披露。经验由记忆整理员自动写入、无需人工审核；`candidate_skill: true` 的条目在索引里显示 `★`，升级成 Agent Skill 仍需人点头，且只有 `general: true` 的经验才可能带 ★。设置·记忆整理页的经验库列表只读，但每条经验可「打开」在系统文件管理器里选中该文件，工具条另有「打开文件夹」（与工作记忆的笔记「打开」同一套服务端动作，`note-store.mjs` 的 `revealNoteFile`）

## 快速链接

- [README](https://github.com/shawnstack/quickforge#readme)
- [CHANGELOG](../../CHANGELOG.md)
- [CONTRIBUTING](../../CONTRIBUTING.md)
- [DESIGN_LANGUAGE](../../DESIGN_LANGUAGE.md)
- [LICENSE](../../LICENSE)
- [SECURITY](../../SECURITY.md)
