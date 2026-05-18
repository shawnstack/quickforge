# `src/` — React 前端

基于 React 19 + TypeScript 6 + Tailwind CSS 4 的前端应用。

## 目录结构

```
src/
├── components/          # React 组件
│   ├── chat/            # 聊天面板（含多个子模块）
│   ├── scheduled-tasks/ # 定时任务页面
│   ├── share/           # 对话分享
│   ├── sidebar/         # 侧边栏
│   └── ui/              # 基础 UI 组件
├── hooks/               # 自定义 React Hooks (14 个)
├── lib/                 # 前端工具库 (28 个模块)
├── App.tsx              # 主应用组件 (625 行)
├── index.css            # 全局样式 (293 行)
└── main.tsx             # 入口文件 (14 行)
```

## 顶层文件

| 文件 | 说明 | 行数 |
|------|------|------|
| [main.tsx](../src/main.tsx) | React 入口，挂载 App | 16 |
| [App.tsx](../src/App.tsx) | 主组件，管理全局状态、Agent、路由、调度 | 684 |
| [index.css](../src/index.css) | 全局样式 (Tailwind + pi-web-ui + 自定义) | 346 |

### main.tsx (16 行)

- 从 `react-dom/client` 创建根节点
- 应用全局 CSS（`index.css`）
- 调用 `patchThinkingSelector()` 修补 pi-web-ui 的模型选择器
- 在 `<StrictMode>` 中渲染 `<App />` 组件

### App.tsx (684 行)

**用途**: 应用主组件，协调所有子组件和 hooks。

**核心状态**:
- `storageRef` — 存储实例引用
- `activeModelRef` — 当前活动模型
- `yoloModeRef` — YOLO 模式状态
- `activeProjectRef` — 当前活动的项目
- `needsModelSetup` — 是否需要模型设置
- `view` — 当前视图（chat / scheduled-tasks / share-view）

**主要 UI 区域**:
1. **侧边栏** (`ChatSidebar`) — 左侧导航
2. **聊天面板** (`ChatPanelHost`) — 主聊天区域
3. **空状态** (`ModelSetupEmptyState`) — 未配置模型时显示
4. **定时任务页面** (`ScheduledTasksPage`)
5. **分享对话框** (`ShareConversationDialog`)
6. **共享会话页面** (`SharedConversationPage`)
7. **项目目录选择器** (`ProjectDirectoryPicker`)
8. **Skills 对话框** (`SkillsDialog`)
9. **Toast 容器** — 后台任务通知
10. **错误边界** (`ErrorBoundary`) — 全局错误捕获

**关键函数**:
- `handleChatPanelEvent()` — 处理聊天面板事件
- `handleScheduledTaskNotification()` — 处理定时任务通知事件
- `subscribeToAgentEvents()` — 订阅全局 Agent 事件
