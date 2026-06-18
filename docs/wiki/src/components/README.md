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
│   ├── panel-decoration.ts         # 消息操作按钮和编辑器装饰 (554 行)
│   └── scroll-sync.ts              # 自动滚动同步 (174 行)
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
│   ├── WorkspaceInspector.tsx      # 右侧工作区检查器，Files/Changes + Monaco
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
└── skills-dialog.tsx               # Skills 管理对话框 (410 行)
```

## 核心组件说明

### ChatPanelHost.tsx (439 行)

- 核心聊天面板宿主
- 封装 `@earendil-works/pi-web-ui` 的 `ChatPanel` 组件
- 集成 YOLO 模式切换、Plan 模式输入态、工作区工具渲染、分享对话渲染
- 支持本地工具渲染器 (`getLocalWorkspaceTools`)
- 工具审批卡片会展示 subagent 来源，避免 General 子任务请求写文件/跑命令时与主 Agent 混淆
- 消息回滚、分叉、复制功能
- 草稿恢复支持

### ChatSidebar.tsx (551 行)

- 左侧聊天列表面板
- 支持全局会话 / 项目会话切换
- 搜索、删除、重命名会话
- 折叠/展开项目分组
- 无限滚动加载会话 (Intersection Observer)
- 定时任务入口、Agents 管理入口、Skills 管理入口

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
- 创建自定义 Agent，配置系统提示词、工具白名单、运行时间、工具调用次数和是否启用为 sub agent
- 创建/编辑弹窗支持用默认模型 AI 填充 Agent 名称、显示名称、描述和系统提示词，不自动修改工具白名单或运行限制
- 展示内置 Agent Profiles，但内置项只读

### skills-dialog.tsx (410 行)

- Skills 选择和搜索结果展示
- 支持全局和项目级别 Skills
- 搜索过滤

### 聊天子模块

**chat-utils.ts** (267 行)
- 共享类型定义（MessageEditorElement, CommandSuggestionElement 等）
- DOM 工具函数（`replaceSvg`, `patchContent` 等）
- Token 估算和上下文用量计算（`getContextUsage`, `estimateTokens`）；前端仅作为后端 `contextUsage` 缺失时的回退估算
- 草稿管理（`hasDraft`, `serializeDraft`, `deserializeDraft`）

**command-suggestions.ts** (174 行)
- 聊天输入框 "/" 命令建议下拉菜单
- 支持内置命令（/plan, /review, /compact, /clear, /help）和自定义命令（用户级 + 项目级 + 插件）
- Tab 补全命令；Shift+Tab 保留给 Composer 的 Plan 模式切换
- 草稿恢复支持

**context-usage.ts** (78 行)
- 上下文用量环状指示器，优先展示后端 session state 返回的权威 `contextUsage`（后端统计复用 `pi-agent-core` / `pi-ai`），缺失时回退到前端本地估算
- 在输入框旁显示彩色环，指示当前对话所占模型上下文窗口比例

**panel-decoration.ts** (554 行)
- 消息操作按钮注入（复制、回滚、分叉）
- Composer 区域装饰（发送/停止切换、YOLO 按钮、Plan 按钮、占位符）
- Plan 按钮和 Shift+Tab 切换前端 Plan 模式；发送时复用 `/plan <任务>` 的单轮计划逻辑
- 命令绑定和草稿指示器

**scroll-sync.ts** (174 行)
- 自动滚动同步管理
- 新消息时自动滚到底部；用户主动上滚时暂停自动滚动
- 用户滚回底部时重新启用自动滚动

### Workspace Inspector (`workspace/`)

- 右侧专业工作区检查器入口为 `WorkspaceInspector.tsx`
- Files tab 通过后端 `/api/workspace/tree` 和 `/api/workspace/file` 安全读取当前项目文件，使用 Monaco Editor 只读展示
- Changes tab 通过 `/api/git/status` 和 `/api/git/file-diff` 获取 Git 工作区变更，使用 Monaco DiffEditor 展示单文件差异
- 第一版仅提供只读浏览和 diff review，不提供编辑、stage、commit、branch 操作

### Terminal Dock (`terminal/`)

- `TerminalDock.tsx` 管理底部多会话终端、会话 tab、新建/关闭和高度拖拽。
- 新建终端默认使用后端返回的默认 Shell profile，也可以从 Dock 右侧 Shell 下拉列表选择指定 profile 创建新会话；下拉列表来自后端按当前平台自动识别的内置 profiles 加用户自定义 profiles。
- `TerminalDock` 还接收 Markdown shell 代码块触发的 pending command：AI 回复中的 `bash`/`sh`/`powershell` 等代码块会在复制按钮旁显示“在终端中执行”，点击后打开当前项目终端并写入命令执行；多行或高风险命令会先确认。
- `terminal-api.ts` 封装 `/api/terminal/capabilities`、`/api/terminal/sessions`、`/api/terminal/sessions/:id/input` 和 `/api/system/terminal-shell` 相关请求。

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
