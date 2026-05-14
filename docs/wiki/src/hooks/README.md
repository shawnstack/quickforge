# `src/hooks/` — 自定义 React Hooks

包含 14 个自定义 React Hook，用于封装应用状态管理和业务逻辑。

---

| Hook 文件 | 行数 | 用途 |
|-----------|------|------|
| [useAppBootstrap.ts](../../src/hooks/useAppBootstrap.ts) | 163 | 应用启动引导：初始化 Storage、加载项目、恢复会话 |
| [useAgentManager.ts](../../src/hooks/useAgentManager.ts) | 361 | Agent 生命周期管理：创建、加载、切换会话 |
| [useChatActions.ts](../../src/hooks/useChatActions.ts) | 234 | 聊天操作：发送消息、回滚、分叉、复制 |
| [useModelActions.ts](../../src/hooks/useModelActions.ts) | 206 | 模型操作：选择模型、切换 yolo、管理工具 |
| [useSessionActions.ts](../../src/hooks/useSessionActions.ts) | 83 | 会话操作：删除、重命名、刷新 |
| [useSessionPagination.ts](../../src/hooks/useSessionPagination.ts) | 139 | 会话分页加载 |
| [useProject.ts](../../src/hooks/useProject.ts) | 96 | 项目状态管理 |
| [useProjectActions.ts](../../src/hooks/useProjectActions.ts) | 67 | 项目操作：切换、添加、删除 |
| [useYoloActions.ts](../../src/hooks/useYoloActions.ts) | 52 | YOLO 模式操作 |
| [useYoloMode.ts](../../src/hooks/useYoloMode.ts) | 22 | YOLO 模式状态 |
| [useCrossTabSync.ts](../../src/hooks/useCrossTabSync.ts) | 75 | 跨标签页同步 |
| [useSentinel.ts](../../src/hooks/useSentinel.ts) | 36 | 哨兵元素（用于 Infinite Scroll） |
| [useTaskToasts.ts](../../src/hooks/useTaskToasts.ts) | 29 | 后台任务 Toast 通知管理 |
| [useVisibleRuntimeStatuses.ts](../../src/hooks/useVisibleRuntimeStatuses.ts) | 80 | 可见会话的后台任务状态轮询 |

---

## 核心 Hooks 说明

### useAppBootstrap.ts (163 行)

应用启动时执行的一次性初始化:
1. 初始化 `HttpStorageBackend` 作为存储后端绑定
2. 加载语言设置 (`initializeAppLanguage`)
3. 初始化 PI 存储 (`initializePiStorage`)
4. 加载上次使用的模型 (`loadInitialConfiguredModel`)
5. 加载 YOLO 模式状态
6. 加载项目列表和活跃项目
7. 加载全局会话列表
8. 标记模型是否已配置 (`needsModelSetup`)

### useAgentManager.ts (361 行)

核心 Agent 管理 Hook，封装了 Agent 的完整生命周期:
- **创建/销毁 Agent**: `createAgent()`, `destroyAgent()`
- **会话加载**: `loadSession(sessionId)` — 恢复 Agent 状态
- **消息同步**: `syncSessionUI()` — 从 ServerAgent 同步消息到 UI
- **会话列表**: `refreshSessions()` — 刷新会话元数据列表
- **标题生成**: 自动为无标题会话生成 AI 标题
- **后台任务**: 管理后台运行的任务状态
- **对话压缩**: 支持 compact 命令压缩长对话

### useChatActions.ts (234 行)

聊天交互操作:
- `sendMessage(text)` — 发送消息给 Agent
- `rollbackConversationFromMessage(index)` — 回滚到指定消息
- `forkConversationFromMessage(index)` — 从指定消息分叉新对话
- `copyAnswer(text)` — 复制回答到剪贴板
- `generateTitle(sessionId)` — AI 生成会话标题

### useModelActions.ts (206 行)

模型/供应商配置操作:
- `openModelSetup()` — 打开设置对话框
- `selectModel(model)` — 切换当前模型
- 初始化/切换活动模型
- YOLO 模式与 workspace 工具的启用/禁用同步

### useCrossTabSync.ts (75 行)

- 使用 `BroadcastChannel` API (`quickforge-sync`)
- 同步事件: `sessions-changed`, `projects-changed`, `settings-changed`
- 页面可见性变化时自动刷新 (`visibilitychange`)

### useSessionPagination.ts (139 行)

- 全局/项目会话分页 (每页 20 条)
- 展开/折叠项目时自动加载
- 跟踪加载状态 (`hasMore`, `loading`)

### useVisibleRuntimeStatuses.ts (80 行)

- 监听可见会话的后台任务运行状态
- 通过 `fetchActiveAgentStatuses` 轮询 + SSE 订阅
- 每 5 秒自动刷新
