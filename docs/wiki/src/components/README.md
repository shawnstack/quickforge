# `src/components/` — React 组件

## 目录结构

```
components/
├── chat/
│   ├── ChatPanelHost.tsx           # 聊天面板宿主 (439 行)
│   ├── ModelSetupEmptyState.tsx    # 模型未配置时的空状态引导 (43 行)
│   ├── chat-utils.ts               # 共享类型、DOM 工具、token 估算 (267 行)
│   ├── command-suggestions.ts      # 聊天输入框命令建议下拉菜单 (174 行)
│   ├── context-usage.ts            # 上下文用量环状指示器 (78 行)
│   ├── panel-decoration.ts         # 聊天面板 DOM 装饰兼容入口 / editor 编排 facade (175 行)
│   └── scroll-sync.ts              # 自动滚动同步 (174 行)
├── git/
│   ├── GitBranchMenu.tsx           # 标题栏 / Git 工具中的分支搜索、切换、创建分支和 Git 图谱入口
│   ├── GitCommitPushDialog.tsx     # Git 提交 / 提交并推送 / 推送弹窗，支持 AI 生成提交信息
│   ├── GitToolsPinnedSummary.tsx   # 顶部工具栏 Git 置顶摘要，支持收起胶囊和展开工具卡片
│   └── GitGraphDialog.tsx          # Git 提交图谱大弹窗
├── agent-profiles/
│   └── AgentProfilesPage.tsx        # Agent Profiles 独立管理页面
├── scheduled-tasks/
│   └── ScheduledTasksPage.tsx      # 定时任务和执行历史页面
├── share/
│   ├── ShareConversationDialog.tsx # 分享对话对话框 (199 行)
│   └── SharedConversationPage.tsx  # 查看分享的对话页面 (266 行)
├── sidebar/
│   └── ChatSidebar.tsx             # 聊天侧边栏 (551 行)
├── workspace/
│   ├── WorkspaceInspector.tsx      # 右侧统一工作区检查器，顶部 Tab 支持拖动排序并按项目持久化；Overview/Files/Browser/Changes；HTML/图片产物进入 Browser，Markdown/代码/文本产物进入 Reader
│   ├── WorkspaceFileTree.tsx       # 项目文件树
│   ├── WorkspaceChangesList.tsx    # Git 工作区变更列表
│   ├── MonacoCodeViewer.tsx        # Monaco 只读代码查看器
│   └── MonacoDiffViewer.tsx        # Monaco 单文件 Diff 查看器
├── terminal/
│   ├── TerminalDock.tsx             # 多会话终端 Dock，支持新建时选择 Shell profile
│   ├── TerminalPane.tsx             # xterm.js 终端实例面板
│   ├── terminal-api.ts              # 终端 REST API 客户端
│   └── terminal-types.ts            # 终端会话/能力/Profile 类型
├── ui/
│   ├── button.tsx                  # 按钮组件 (40 行)
│   ├── confirm-dialog.tsx          # 确认对话框 (95 行)
│   ├── input.tsx                   # 输入框组件 (19 行)
│   ├── prompt-dialog.tsx           # 提示输入对话框 (116 行)
│   └── toast.tsx                   # Toast 通知组件 (113 行)
├── ErrorBoundary.tsx               # 错误边界组件 (53 行)
├── project-directory-picker.tsx    # 项目目录选择器 (247 行)
└── skills-dialog.tsx               # Skills 管理面板与项目技能对话框
```

## 核心组件说明

### ChatPanelHost.tsx (439 行)

- 核心聊天面板宿主
- 封装 `@earendil-works/pi-web-ui` 的 `ChatPanel` 组件
- 集成 Agent 权限模式选择器、Plan 模式输入态、工作区工具渲染、分享对话渲染
- 支持本地工具渲染器 (`getLocalWorkspaceTools`)；`generate_image` 不并入普通工具汇总，仍独立显示图片、模型信息、打开原图与下载入口，但与中间 Markdown、Thinking 和其他工具过程一起归入当前回合唯一的“执行中/已执行”顶层折叠区域
- 分享页使用 `/api/shared/:shareId/assets/:assetId` 加载已授权会话的生成图片
- 工具审批卡片会展示 subagent 来源，避免 General 子任务请求写文件/跑命令时与主 Agent 混淆
- 消息回滚、分叉、复制功能
- 草稿恢复支持；Composer 草稿持久化由 `src/lib/composer-drafts.ts` 直接使用浏览器 `localStorage`，不再经过 `AppStorage/settings` 或后端存储；回滚、模型切换等外部恢复草稿按一次性事件消费，发送、编辑或 Session 切换会取消旧的延迟恢复任务；已消费恢复草稿 ID 使用有界 Set，发送或明确清空会立即删除运行时与持久化草稿。

### ChatSidebar.tsx

- 左侧聊天列表面板
- 支持全局会话 / 项目会话切换
- 搜索、置顶、归档会话；底部“已归档对话”入口复用设置页中的归档管理，可恢复或永久删除
- 折叠/展开项目分组
- 无限滚动加载会话 (Intersection Observer)
- 搜索入口、全局 Skills 设置入口
- 项目分组和会话列表折叠/展开
- 渠道会话在列表、搜索和对话页标题中按普通文字显示“渠道名 · 标题”，不改变真实标题，也不使用徽标或差异化样式
- 当前对话顶部“更多”菜单由 `src/App.tsx` 管理，提供置顶、重命名、分享和归档操作

### ScheduledTasksPage.tsx

- 定时任务管理页面，包含 Tasks / History 两个页签
- 创建/编辑/删除/手动触发定时任务
- 支持多种调度类型: once / daily / weekly / monthly / interval / cron
- 任务运行历史查看
- AI 模型选择、参数配置
- 定时任务可选择执行 Agent；任务卡片、详情和运行历史展示 Agent 信息
- 每个定时任务可配置执行模式：默认串行，避免同一任务重叠执行；可切换为并行以允许同一任务重叠运行，不同任务之间仍并行触发

### AgentProfilesPage.tsx

- 与定时任务平级的 Agent Profiles 独立管理页面
- 创建自定义 Agent，配置系统提示词、模型、思考等级、工具白名单、运行时间、工具调用次数和是否启用为 sub agent
- 创建/编辑弹窗支持用默认模型 AI 填充 Agent 名称、显示名称、描述和系统提示词，不自动修改工具白名单或运行限制
- 展示内置 Agent Profiles；内置项的定义只读，但允许设置继承模型或固定模型

### skills-dialog.tsx

- `SkillsManagerPanel` 提供可嵌入的 Skills 选择、搜索、阅读和保存能力
- 全局 Skills 通过设置页 Skills tab 嵌入展示，左侧 Skills 图标会跳转到该设置 tab
- 项目级 Skills 仍由项目菜单打开 `SkillsDialog` 对话框
- 支持搜索过滤和读取 Skill 内容

### 聊天子模块

**chat-utils.ts** (267 行)
- 共享类型定义（MessageEditorElement, CommandSuggestionElement 等）
- DOM 工具函数（`replaceSvg`, `patchContent` 等）
- Token 估算和上下文用量计算（`getContextUsage`, `estimateTokens`）；前端仅作为后端 `contextUsage` 缺失时的回退估算
- 草稿运行时管理（`hasDraft` 等）；持久化在 `src/lib/composer-drafts.ts`，使用浏览器 `localStorage` 保存当前浏览器本地草稿，不迁移旧的 settings 后端草稿，也不参与后端备份/跨设备同步

**command-suggestions.ts** (174 行)
- 聊天输入框 "/" 命令建议下拉菜单
- 支持内置命令（/init, /plan, /review, /summary, /compact, /clear, /help）和自定义命令（用户级 + 项目级 + 插件）
- Tab 补全命令；Shift+Tab 保留给 Composer 的 Plan 模式切换
- 草稿恢复支持

**context-usage.ts**
- 上下文用量环状指示器，优先展示后端 session state 返回的权威 `contextUsage`（后端统计复用 `pi-agent-core` / `pi-ai`），缺失时回退到前端本地估算
- 在现有模型选择按钮左侧单独显示中心镂空的彩色环，指示当前对话所占模型上下文窗口比例；悬停、聚焦或点击后显示结构化 Token 明细、统计来源与上下文范围；该圆环及详情可在“设置 → 常规”中开启，默认关闭

**panel-decoration.ts** (175 行)
- 聊天面板 DOM 装饰的兼容入口，继续向 `ChatPanelHost.tsx` re-export 消息装饰、草稿、审批卡、上下文压缩提示和等待气泡等能力
- `decorateEditor` 仅保留 Composer/editor 编排：占位符、只读清理、model selector 开关、left/right controls 定位，以及调用各 focused helper
- 细分实现位于 `panel-decoration/` 子目录：`message-actions.ts`（复制/回滚/重试/分叉）、`composer-plus-menu.ts`（附件和内置插件菜单）、`agent-access-menu.ts`、`plan-mode-controls.ts`、`send-stop-button.ts`、`model-controls.ts`、`editor-bindings.ts`、`code-blocks.ts`、`process-folding.ts`、`context-compaction.ts` 等；`process-folding.ts` 为每个用户回合维护唯一的“执行中/已执行 · 耗时”顶层状态与折叠入口，中间 Markdown、Thinking、工具和 Subagent 均位于该层级；每段中间 Markdown 后的过程片段继续显示内层阶段聚合标题（状态 + 工具调用数、命令数、编辑文件数），运行中和已完成阶段均默认收起并维护独立折叠状态，普通连续工具仍保留更内层的工具摘要，只有最终回答正文留在组外
- Plan 按钮和 Shift+Tab 切换前端 Plan 模式；发送时复用 `/plan <任务>` 的单轮计划逻辑
- Assistant Markdown 中的 ```svg 和 ```mermaid 代码块会在流式输出结束后默认进入安全图片预览，可在代码块右上角切换预览/源码；Mermaid 按需加载并在失败时保留源码

**scroll-sync.ts** (174 行)
- 自动滚动同步管理
- 新消息时自动滚到底部；用户主动上滚时暂停自动滚动
- 用户滚回底部时重新启用自动滚动

### 标题栏 Git 组件 (`git/`)

- `GitBranchMenu.tsx` 挂载在主对话标题栏的分支 chip 和 `GitToolsPinnedSummary` 展开卡片中，提供分支搜索、当前未提交变更摘要、分支切换、创建并检出新分支，以及 Git 图谱入口。
- `GitToolsPinnedSummary.tsx` 显示在顶部窗口工具栏的终端按钮左侧，提供收起胶囊（更改 +增删行）和展开 Git 工具卡；更改入口跳转右侧 Changes/审查面板，分支入口复用 `GitBranchMenu`，提交入口打开 `GitCommitPushDialog`。
- `GitCommitPushDialog.tsx` 提供提交、提交并推送、推送操作；默认只提交已暂存文件，可展开确认文件范围并显式选择是否包含全部未暂存更改；AI 仅生成可编辑的提交文案，不会自动继续提交。弹窗打开时刷新 Git 状态，detached HEAD 会阻止提交/推送；提交成功但推送失败时会保留成功状态并提供仅重试推送。
- `GitGraphDialog.tsx` 使用 `/api/git/log` 渲染居中的 Git 提交图谱弹窗，包含图线、描述、日期、作者和提交短哈希列，并支持刷新和关闭。

### Workspace Inspector (`workspace/`)

- 右侧专业工作区检查器入口为 `WorkspaceInspector.tsx`，采用类浏览器顶部 Tab 工作区；`+` 菜单提供 Files / Review / Terminal / Browser 入口。Tab 列表、活动 `activePanelTabId` 和 Review 的 Overview/Changes 子视图按 `projectId` 写入浏览器 `localStorage`，活动 Tab 是恢复事实源；项目切换通过 React `key` 重建 Inspector，从而加载新项目各自的 Tab 状态。
- 标题栏 Git、聊天文件链接、文件 Reader 和产物 Browser 等外部入口通过携带 `projectId` 的一次性请求打开对应 Tab；Inspector 仅在请求项目与当前项目一致时消费并清除请求，普通折叠后重新展开不会重放已处理请求。
- Files tab 通过后端 `/api/workspace/tree` 浏览当前项目文件，顶部支持路径筛选和手动刷新；Files、Review、Reader Tab 与产物文件标题统一使用 Material Icon Theme 官方文件类型图标，搜索、刷新、预览等操作图标继续使用 Lucide。从 Files 中打开普通文件时，会提升为独立顶部 reader tab，Tab 标题显示文件名，内容区左侧使用 Monaco Editor / Markdown Reader 只读展示，右侧保留可显隐、可拖拽调宽的工作目录树；Reader 顶部左侧显示“项目名 > 工作区相对路径”的分段面包屑，当前文件名增强显示，长路径自动截断并通过悬停展示完整路径；复制路径、复制文件内容和自动换行收拢到更多菜单，提供当前文件的资源管理器 / VS Code / IntelliJ IDEA 外部打开入口。Markdown Reader 默认展示预览，并在右侧操作区通过“查看源代码 / 返回预览”切换；更多操作始终保留，自动换行仅在源码视图可用。普通代码文件默认关闭自动换行并常驻横向滚动条，用户可按文件临时启用自动换行；文件 reader tab 按项目保存路径，恢复时重新加载最新内容。Markdown 和代码产物进入 reader，HTML、SVG 和图片产物进入 Browser。
- Review tab 通过 `/api/git/status` 展示 Git 工作区变更，并在同一个 Review/Changes tab 内通过 `/api/git/file-diff` 展示单文件差异；Changes 顶部刷新按钮右侧提供提交入口并打开 `GitCommitPushDialog`，提交入口左侧常驻项目打开方式菜单：未选择变更文件时在资源管理器、VS Code 或 IntelliJ IDEA 中打开项目，选择文件后则在资源管理器中打开其所在目录或在编辑器中直接打开该文件；Changes 列表提供单文件还原、暂存、退回未暂存、在新标签中打开文件，以及底部批量还原/暂存/退回操作，分别调用 `/api/git/restore`、`/api/git/stage`、`/api/git/unstage`、`/api/git/restore-all`、`/api/git/stage-all`、`/api/git/unstage-all`；标题栏 Git 更改入口会聚焦该 Review/Changes 工作区。
- 标题栏 Git 分支 chip 通过 `/api/git/branches`、`/api/git/checkout`、`/api/git/create-branch` 和 `/api/git/log` 提供分支切换、创建并检出新分支和 Git 图谱弹窗；Workspace Inspector 仍聚焦文件浏览、产物预览和 diff review
- AI 产物展示统一进入 Workspace Inspector：`present_files` 可用于 HTML、SVG/图片、Markdown、代码、配置、报告和其他可读文本；Markdown/代码/文本打开项目级 Reader Tab，HTML/SVG/图片打开项目级 Browser Tab，不支持直接展示的文件仍保留在产物列表。工具卡片的预览按钮使用相同分流规则，可在关闭后重新打开对应 Reader 或 Browser Tab；Tab 恢复由项目级持久化状态负责。Browser 在加载工作区文件前通过预检接口统一识别文件不存在、不支持类型、文件过大、路径受限和服务异常等状态，以轻量空状态展示友好说明，并在可展开的“错误详情”中保留状态码、错误代码、文件路径和后端原始报错。

### Terminal Dock (`terminal/`)

- `TerminalDock.tsx` 管理底部多会话终端、会话 tab、新建/关闭和高度拖拽。
- `TerminalPane.tsx` 在 WebSocket 建连并收到服务端 `ready` 超过 10 秒时判定超时，连接中断后按 1/2/4 秒最多自动重试 3 次；重试复用同一 xterm 实例和后端 PTY 会话，因此终端标签与已有输出不会消失。服务端明确返回 `SESSION_NOT_FOUND` 时视为原 PTY 已不可恢复，立即停止重试且不向终端缓冲区重复写错误，保留界面并提供“启动新终端 / 关闭”。其他自动重试失败场景提供手动“重试”。状态点区分连接中/重连中、已连接、断开、会话失效和进程退出。
- 新建终端默认使用后端返回的默认 Shell profile，也可以从 Dock 右侧 Shell 下拉列表选择指定 profile 创建新会话；下拉列表来自后端按当前平台自动识别的内置 profiles 加用户自定义 profiles。
- `TerminalDock` 还接收 Markdown shell 代码块触发的 pending command：AI 回复中的 `bash`/`sh`/`powershell` 等代码块会在复制按钮旁显示“在终端中执行”，点击后打开当前项目终端并写入命令执行；多行或高风险命令会先确认。
- `terminal-api.ts` 封装 `/api/terminal/capabilities`、`/api/terminal/sessions` 和 `/api/terminal/sessions/:id/input` 相关请求。

### ShareConversationDialog.tsx (199 行)

- 创建/管理对话分享链接
- 设置权限 (read / operate)
- 可选密码保护
- 分享列表管理 (撤销/删除)

### SharedConversationPage.tsx (266 行)

- 查看他人分享的对话
- 支持只读和操作模式
- SSE 流式加载分享对话消息
- 密码验证

### project-directory-picker.tsx (247 行)

- 文件系统目录选择器
- 树形浏览，支持选择任意目录作为项目路径
- 导航 (返回上级 / 进入子目录)
- 跨平台兼容（Windows 驱动器、macOS Volumes）

### UI 组件 (button, input, confirm, prompt, toast)

- shadcn 风格的轻量 UI 原语
- 使用 `class-variance-authority` 管理变体
- 使用 `tailwind-merge` 合并 class
- confirm / prompt 通过 `createPortal` 实现模态对话框
- toast 支持自动消失和动画

### ErrorBoundary.tsx (44 行)

React 类组件实现的错误边界，捕获子组件渲染错误并显示降级 UI。
