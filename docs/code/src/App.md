# `src/App.tsx` — 主应用组件

**行数**: 548 | **用途**: 应用主组件，协调所有子组件和 hooks

## 导入的依赖

**外部库**: `react`, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `lucide-react`

**内部模块**:
- 组件: `ChatPanelHost`, `ModelSetupEmptyState`, `ChatSidebar`, `Button`, `ToastContainer`, `ShareConversationDialog`, `SharedConversationPage`, `ScheduledTasksPage`, `ProjectDirectoryPicker`, `SkillsDialog`, `ErrorBoundary`
- Hooks: `useProject`, `useYoloMode`, `useCrossTabSync`, `useAgentManager`, `useSessionPagination`, `useTaskToasts`, `useAppBootstrap`, `useModelActions`, `useChatActions`, `useProjectActions`, `useSessionActions`, `useYoloActions`, `useVisibleRuntimeStatuses`
- Lib: `pi-chat`, `i18n`, `types`, `http-storage-backend`, `server-agent`

## 核心状态

- `storageRef` — 存储实例引用
- `activeModelRef` — 当前活动模型
- `yoloModeRef` — YOLO 模式状态
- `activeProjectRef` — 当前活动的项目
- `needsModelSetup` — 是否需要模型设置
- `view` — 当前视图（chat / scheduled-tasks / share-view）
- `toasts` / `toastDismiss` — Toast 通知管理

## 主要 UI 区域

1. **侧边栏** (`ChatSidebar`) — 左侧导航
2. **聊天面板** (`ChatPanelHost`) — 主聊天区域
3. **空状态** (`ModelSetupEmptyState`) — 未配置模型时显示
4. **定时任务页面** (`ScheduledTasksPage`) — 定时任务管理
5. **分享对话框** (`ShareConversationDialog`) — 分享会话
6. **共享会话页面** (`SharedConversationPage`) — 查看已分享的会话
7. **项目目录选择器** (`ProjectDirectoryPicker`) — 选择项目目录
8. **Skills 对话框** (`SkillsDialog`) — 管理 Agent Skills
9. **Toast 容器** (`ToastContainer`) — 后台任务通知
10. **错误边界** (`ErrorBoundary`) — 全局错误捕获

## 关键函数

- `handleChatPanelEvent()` — 处理聊天面板事件（选择模型、打开设置、切换 YOLO、回滚、分叉、复制）
- `handleScheduledTaskNotification()` — 处理定时任务通知事件
- `subscribeToAgentEvents()` — 订阅全局 Agent 事件
