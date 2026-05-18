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
├── scheduled-tasks/
│   └── ScheduledTasksPage.tsx      # 定时任务页面 (913 行)
├── share/
│   ├── ShareConversationDialog.tsx # 分享对话对话框 (199 行)
│   └── SharedConversationPage.tsx  # 查看分享的对话页面 (266 行)
├── sidebar/
│   └── ChatSidebar.tsx             # 聊天侧边栏 (551 行)
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
- 封装 `@mariozechner/pi-web-ui` 的 `ChatPanel` 组件
- 集成 YOLO 模式切换、工作区工具渲染、分享对话渲染
- 支持本地工具渲染器 (`getLocalWorkspaceTools`)
- 消息回滚、分叉、复制功能
- 草稿恢复支持

### ChatSidebar.tsx (551 行)

- 左侧聊天列表面板
- 支持全局会话 / 项目会话切换
- 搜索、删除、重命名会话
- 折叠/展开项目分组
- 无限滚动加载会话 (Intersection Observer)
- 定时任务入口、Skills 管理入口

### ScheduledTasksPage.tsx (913 行)

- 定时任务管理页面
- 创建/编辑/删除/手动触发定时任务
- 支持多种调度类型: once / daily / weekly / monthly / interval / cron
- 任务运行历史查看
- AI 模型选择、参数配置

### skills-dialog.tsx (410 行)

- Skills 选择和搜索结果展示
- 支持全局和项目级别 Skills
- 搜索过滤

### 聊天子模块

**chat-utils.ts** (267 行)
- 共享类型定义（MessageEditorElement, CommandSuggestionElement 等）
- DOM 工具函数（`replaceSvg`, `patchContent` 等）
- Token 估算和上下文用量计算（`getContextUsage`, `estimateTokens`）
- 草稿管理（`hasDraft`, `serializeDraft`, `deserializeDraft`）

**command-suggestions.ts** (174 行)
- 聊天输入框 "/" 命令建议下拉菜单
- 支持内置命令（/compact, /clear）和项目级自定义命令
- 草稿恢复支持

**context-usage.ts** (78 行)
- 上下文用量环状指示器
- 在输入框旁显示彩色环，指示当前对话所占模型上下文窗口比例

**panel-decoration.ts** (554 行)
- 消息操作按钮注入（复制、回滚、分叉）
- Composer 区域装饰（发送/停止切换、YOLO 按钮、占位符）
- 命令绑定和草稿指示器

**scroll-sync.ts** (174 行)
- 自动滚动同步管理
- 新消息时自动滚到底部；用户主动上滚时暂停自动滚动
- 用户滚回底部时重新启用自动滚动

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
