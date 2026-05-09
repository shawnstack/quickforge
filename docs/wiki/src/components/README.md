# `src/components/` — React 组件

## 目录结构

```
components/
├── chat/
│   ├── ChatPanelHost.tsx           # 聊天面板宿主 (937 行)
│   └── ModelSetupEmptyState.tsx    # 模型未配置时的空状态引导 (44 行)
├── scheduled-tasks/
│   └── ScheduledTasksPage.tsx      # 定时任务页面 (608 行)
├── share/
│   ├── ShareConversationDialog.tsx # 分享对话对话框 (277 行)
│   └── SharedConversationPage.tsx  # 查看分享的对话页面 (268 行)
├── sidebar/
│   └── ChatSidebar.tsx             # 聊天侧边栏 (540 行)
├── ui/
│   ├── button.tsx                  # 按钮组件 (41 行)
│   ├── confirm-dialog.tsx          # 确认对话框 (91 行)
│   ├── input.tsx                   # 输入框组件 (20 行)
│   ├── prompt-dialog.tsx           # 提示输入对话框 (117 行)
│   └── toast.tsx                   # Toast 通知组件 (114 行)
├── ErrorBoundary.tsx               # 错误边界组件 (53 行)
├── project-directory-picker.tsx    # 项目目录选择器 (248 行)
└── skills-dialog.tsx               # Skills 管理对话框 (255 行)
```

## 核心组件说明

### `ChatPanelHost.tsx` (937 行)

- 核心聊天面板宿主
- 封装 `@mariozechner/pi-web-ui` 的 `ChatPanel` 组件
- 集成 YOLO 模式切换、工作区工具渲染、分享对话渲染
- 支持本地工具渲染器 (`getLocalWorkspaceTools`)
- 消息回滚、分叉、复制功能
- 草稿恢复支持

### `ChatSidebar.tsx` (540 行)

- 左侧聊天列表面板
- 支持全局会话 / 项目会话切换
- 搜索、删除、重命名会话
- 折叠/展开项目分组
- 无限滚动加载会话 (Intersection Observer)
- 定时任务入口、Skills 管理入口

### `ScheduledTasksPage.tsx` (608 行)

- 定时任务管理页面
- 创建/编辑/删除/手动触发定时任务
- 支持多种调度类型: once / daily / weekly / monthly / interval / cron
- 任务运行历史查看
- AI 模型选择、参数配置

### `ShareConversationDialog.tsx` (277 行)

- 创建/管理对话分享链接
- 设置权限 (read / operate)
- 可选密码保护
- 分享列表管理 (撤销/删除)

### `SharedConversationPage.tsx` (268 行)

- 查看他人分享的对话
- 支持只读和操作模式
- SSE 流式加载分享对话消息
- 密码验证

### `skills-dialog.tsx` (255 行)

- Skills 选择和搜索结果展示
- 支持全局和项目级别 Skills
- 搜索过滤

### `project-directory-picker.tsx` (248 行)

- 文件系统目录选择器
- 树形浏览，支持选择任意目录作为项目路径
- 导航 (返回上级 / 进入子目录)

### UI 组件 (button, input, confirm, prompt, toast)

- shadcn 风格的轻量 UI 原语
- 使用 `class-variance-authority` 管理变体
- 使用 `tailwind-merge` 合并 class
- confirm / prompt 通过 `createPortal` 实现模态对话框
- toast 支持自动消失和动画
