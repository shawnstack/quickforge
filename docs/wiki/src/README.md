# `src/` — React 前端

基于 React 19 + TypeScript 6 + Tailwind CSS 4 的前端应用。

## 目录结构

```
src/
├── components/          # React 组件
│   ├── chat/            # 聊天面板（含多个子模块）
│   ├── preview/          # 网页预览内容组件（iframe 加载本地 dev server URL）
│   ├── scheduled-tasks/ # 定时任务页面
│   ├── share/           # 对话分享
│   ├── sidebar/         # 侧边栏
│   ├── terminal/         # xterm.js 多终端 Dock
│   ├── ui/              # 基础 UI 组件
├── hooks/               # 自定义 React Hooks (14 个)
├── lib/                 # 前端工具库 (28 个模块)
├── App.tsx              # 主应用组件 (625 行)
├── index.css            # 全局样式 (293 行)
└── main.tsx             # 入口文件，初始化补丁并注册生产环境 PWA Service Worker
```

## 顶层文件

| 文件 | 说明 | 行数 |
|------|------|------|
| [main.tsx](../src/main.tsx) | React 入口，挂载 App，生产环境注册 PWA Service Worker | 24 |
| [App.tsx](../src/App.tsx) | 主组件，管理全局状态、Agent、路由、调度 | 684 |
| [index.css](../src/index.css) | 全局样式 (Tailwind + pi-web-ui + 自定义) | 346 |

### main.tsx (24 行)

- 从 `react-dom/client` 创建根节点
- 应用全局 CSS（`index.css`）
- 调用 `patchThinkingSelector()` 修补 pi-web-ui 的模型选择器
- 设置弹窗由 `hooks/useModelActions.ts` 组装多个 `SettingsTab`，包含 `lib/channels-settings-tab.ts` 的“渠道”页，用于管理本地外部应用 bridge（当前内置微信渠道，通过 `weixin-acp` 接入 `qf acp`，默认使用全局默认工作区，也可选择已有项目启动；渠道事件会触发主应用刷新外部 ACP 写入的 session），底部包含 `lib/about-settings-tab.ts` 的“关于”页，用于展示 GitHub、检查 npm 更新并触发本机一键更新
- 调用 `applyClipboardPolyfill()` 应用剪贴板兼容处理
- 生产环境注册 `/sw.js`，启用轻量 PWA 安装和前端静态资源缓存
- 在 `<StrictMode>` 中渲染 `<App />` 组件

### App.tsx (684 行)

**用途**: 应用主组件，协调所有子组件和 hooks。

**核心状态**:
- `storageRef` — 存储实例引用
- `activeModelRef` — 当前活动模型
- `agentAccessModeRef` — Agent 权限模式状态（默认权限 / 完全访问权限）
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
7. **终端 Dock** (`TerminalDock`) — 本地多开交互式终端，显示在对话区底部
8. **工作区面板** (`WorkspaceInspector`) — 右侧统一工作区入口，包含概览、工作空间文件、浏览器预览和 Git 变更；Overview 展示当前 Session 产生/修改的文件，HTML 产物通过 Browser 打开
9. **项目目录选择器** (`ProjectDirectoryPicker`)
10. **Skills 对话框** (`SkillsDialog`)
11. **Toast 容器** — 后台任务通知
12. **错误边界** (`ErrorBoundary`) — 全局错误捕获

**关键函数**:
- `handleChatPanelEvent()` — 处理聊天面板事件
- `handleScheduledTaskNotification()` — 处理定时任务通知事件
- `subscribeToAgentEvents()` — 订阅全局 Agent 事件
