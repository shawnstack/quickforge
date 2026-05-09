# `src/hooks/` — 自定义 React Hooks

自定义 Hooks 用于管理前端状态和与后端的交互。

## 文件清单

| Hook | 文件 | 说明 | 行数 |
|------|------|------|------|
| useAgentManager | [useAgentManager.ts](useAgentManager.ts.md) | Agent 全生命周期管理 | 399 |
| useAppBootstrap | [useAppBootstrap.ts](useAppBootstrap.ts.md) | 应用初始化引导 | 171 |
| useChatActions | [useChatActions.ts](useChatActions.ts.md) | 聊天操作 (发送、回滚、复制、分叉) | 257 |
| useCrossTabSync | [useCrossTabSync.ts](useCrossTabSync.ts.md) | 跨标签页状态同步 | 90 |
| useModelActions | [useModelActions.ts](useModelActions.ts.md) | 模型配置操作 (设置对话框) | 225 |
| useProject | [useProject.ts](useProject.ts.md) | 项目管理状态 | 104 |
| useProjectActions | [useProjectActions.ts](useProjectActions.ts.md) | 项目操作 (删除) | 72 |
| useSentinel | [useSentinel.ts](useSentinel.ts.md) | IntersectionObserver 哨兵 | 43 |
| useSessionActions | [useSessionActions.ts](useSessionActions.ts.md) | 会话操作 (加载、重命名、删除) | 90 |
| useSessionPagination | [useSessionPagination.ts](useSessionPagination.ts.md) | 会话分页/无限滚动 | 158 |
| useTaskToasts | [useTaskToasts.ts](useTaskToasts.ts.md) | 后台任务完成 Toast 通知 | 34 |
| useVisibleRuntimeStatuses | [useVisibleRuntimeStatuses.ts](useVisibleRuntimeStatuses.ts.md) | 可见会话的运行状态 | 94 |
| useYoloActions | [useYoloActions.ts](useYoloActions.ts.md) | YOLO 模式切换操作 | 53 |
| useYoloMode | [useYoloMode.ts](useYoloMode.ts.md) | YOLO 模式状态 | 15 |

---

## 核心 Hooks 说明

### `useAgentManager.ts` (399 行)

核心 Agent 管理 Hook，封装了 Agent 的完整生命周期:

- **创建/销毁 Agent**: `createAgent()`, `destroyAgent()`
- **会话加载**: `loadSession(sessionId)` — 恢复 Agent 状态
- **消息同步**: `syncSessionUI()` — 从 ServerAgent 同步消息到 UI
- **会话列表**: `refreshSessions()` — 刷新会话元数据列表
- **标题生成**: 自动为无标题会话生成 AI 标题
- **后台任务**: 管理后台运行的任务状态
- **对话压缩**: 支持 compact 命令压缩长对话

### `useAppBootstrap.ts` (171 行)

应用启动时执行的一次性初始化:

1. 初始化 `HttpStorageBackend` 作为存储后端绑定
2. 加载语言设置 (`initializeAppLanguage`)
3. 初始化 PI 存储 (`initializePiStorage`)
4. 加载上次使用的模型 (`loadInitialConfiguredModel`)
5. 加载 YOLO 模式状态
6. 加载项目列表和活跃项目
7. 加载全局会话列表
8. 标记模型是否已配置 (`needsModelSetup`)

### `useChatActions.ts` (257 行)

聊天交互操作:

- `sendMessage(text, attachments)` — 发送消息给 Agent
- `rollbackConversationFromMessage(index)` — 回滚到指定消息
- `forkConversationFromMessage(index)` — 从指定消息分叉新对话
- `copyAnswer(text)` — 复制回答到剪贴板
- `generateTitle(sessionId)` — AI 生成会话标题
- `shouldSaveSession()` — 判断会话是否需要保存

### `useModelActions.ts` (225 行)

模型/供应商配置操作:

- `openModelSetup()` — 打开设置对话框
- `selectModel(model)` — 切换当前模型
- `openSettings()` — 打开完整设置 (含自定义供应商、备份、语言等)

### `useCrossTabSync.ts` (90 行)

跨标签页同步:

- 使用 `BroadcastChannel` API (`quickforge-sync`)
- 同步事件: `sessions-changed`, `projects-changed`, `settings-changed`
- 页面可见性变化时自动刷新 (`visibilitychange`)

### `useSessionPagination.ts` (158 行)

会话分页加载:

- 全局/项目会话分页 (每页 20 条)
- 展开/折叠项目时自动加载
- 支持会话变动时广播通知

### `useVisibleRuntimeStatuses.ts` (94 行)

- 监听可见会话的后台任务运行状态
- 通过 `fetchActiveAgentStatuses` 轮询 + `subscribeToAgentEvents` SSE 订阅
- 每 5 秒自动刷新

### `useProject.ts` (104 行)

- 加载/切换项目
- 管理项目列表、展开状态、目录选择器状态

### `useSentinel.ts` (43 行)

- IntersectionObserver 哨兵，用于无限滚动检测
- 当哨兵元素进入视口时触发回调
