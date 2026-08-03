# `src/hooks/` — 自定义 React Hooks

包含 18 个自定义 React Hook，用于封装应用状态管理和业务逻辑。

---

| Hook 文件 | 行数 | 用途 |
|-----------|------|------|
| [useAppBootstrap.ts](../../src/hooks/useAppBootstrap.ts) | 227 | 应用启动引导：初始化 Storage、加载项目、恢复会话 |
| [useAgentManager.ts](../../src/hooks/useAgentManager.ts) | 537 | Agent 生命周期管理：创建、加载、切换会话 |
| [useChatActions.ts](../../src/hooks/useChatActions.ts) | 311 | 聊天操作：发送消息、回滚、分叉、复制 |
| [useModelActions.ts](../../src/hooks/useModelActions.ts) | 232 | 模型操作：选择模型、切换访问模式、管理工具 |
| [useSessionActions.ts](../../src/hooks/useSessionActions.ts) | 105 | 会话操作：归档、置顶、重命名、刷新 |
| [useSessionPagination.ts](../../src/hooks/useSessionPagination.ts) | 312 | 会话分页加载 |
| [useProject.ts](../../src/hooks/useProject.ts) | 155 | 项目状态管理；含 `defaultWorkspace`（全局对话默认工作目录的合成 project，由 `/api/project` 的 `defaultWorkspaceRoot` 构造） |
| [useProjectActions.ts](../../src/hooks/useProjectActions.ts) | 58 | 项目操作：切换、添加、删除 |
| [useAgentAccessActions.ts](../../src/hooks/useAgentAccessActions.ts) | 66 | Agent 访问模式操作 |
| [useAgentAccessMode.ts](../../src/hooks/useAgentAccessMode.ts) | 17 | Agent 访问模式状态 |
| [useAppTheme.ts](../../src/hooks/useAppTheme.ts) | 23 | 应用主题状态 |
| [useCodeFontMetrics.ts](../../src/hooks/useCodeFontMetrics.ts) | 17 | 代码字体尺寸状态 |
| [useCrossTabSync.ts](../../src/hooks/useCrossTabSync.ts) | 104 | 跨标签页同步 |
| [useSentinel.ts](../../src/hooks/useSentinel.ts) | 57 | 哨兵元素（用于 Infinite Scroll） |
| [useTaskToasts.ts](../../src/hooks/useTaskToasts.ts) | 35 | 后台任务 Toast 通知管理 |
| [useUIState.ts](../../src/hooks/useUIState.ts) | 57 | 应用 UI 状态管理 |
| [useUpdateCheck.ts](../../src/hooks/useUpdateCheck.ts) | 129 | 应用更新检查 |
| [useVisibleRuntimeStatuses.ts](../../src/hooks/useVisibleRuntimeStatuses.ts) | 100 | 可见会话的后台任务状态轮询 |

---

## 核心 Hooks 说明

### useAppBootstrap.ts (227 行)

应用启动时执行的一次性初始化:
1. 初始化 `HttpStorageBackend` 作为存储后端绑定
2. 加载语言设置 (`initializeAppLanguage`)
3. 初始化 PI 存储 (`initializePiStorage`)
4. 加载上次使用的模型 (`loadInitialConfiguredModel`)
5. 加载 Agent 访问模式状态
6. 加载项目列表和活跃项目
7. Storage backend 就绪后，完整刷新当前会话视图（置顶、全局，以及已展开项目或时间线）
8. 标记模型是否已配置 (`needsModelSetup`)

### useAgentManager.ts (537 行)

核心 Agent 管理 Hook，封装了 Agent 的完整生命周期:
- **创建/销毁 Agent**: `createAgent()`, `destroyAgent()`
- **会话加载**: `loadSession(sessionId)` — 恢复 Agent 状态
- **消息同步**: `syncSessionUI()` — 从 ServerAgent 同步消息到 UI
- **会话列表**: `refreshSessions()` 负责完整刷新，`session_created` / `title_updated` SSE 分别用于局部插入会话和更新标题
- **标题生成**: 服务端先持久化首条消息及 fallback 标题，再异步生成 AI 标题；用户手动重命名优先
- **后台任务**: 管理后台运行的任务状态；采用保守 LRU，始终保留当前会话和 running/streaming Agent，最多保留 5 个非当前空闲 Agent，淘汰时统一 unsubscribe、dispose 并清理本地状态；再次打开会话时由 ServerAgent 从服务端权威状态恢复
- **对话压缩**: 支持 `/summary` 创建总结后的新对话，支持 `/compact` 在当前会话内滚动压缩上下文
- **全局会话默认工作目录**: 通过 `defaultWorkspaceRef`（来自 `useProject.defaultWorkspace`）为 global 作用域会话注入合成 project（id=`default`，指向 `~/.quickforge/workspace`），从而启用工作区面板/终端/Git；该合成 id 仅用于前端 UI 与 REST 端点，不会作为 `projectId` 发往后端创建 Agent

### useChatActions.ts (311 行)

聊天交互操作:
- `startNewGlobalChat()` / `startNewProjectChat()` — 创建延迟会话，首条消息发送时才创建真实 Session
- `rollbackFromMessage(index)` — 回滚到指定消息
- `forkFromMessage(index)` — 从指定消息分叉新对话
- `copyAnswer(text)` — 复制回答到剪贴板

### useModelActions.ts (232 行)

模型/供应商配置操作:
- `openModelSetup()` — 打开设置对话框
- `selectModel(model)` — 切换当前模型
- 初始化/切换活动模型
- Agent 访问模式与 workspace 工具的启用/禁用同步

### useCrossTabSync.ts (104 行)

- 使用 `BroadcastChannel` API (`quickforge-sync`)
- 同步事件: `sessions-changed`, `projects-changed`, `settings-changed`
- 页面可见性变化时自动刷新 (`visibilitychange`)

### useSessionPagination.ts (312 行)

- 全局/项目会话分页 (每页 20 条)
- 支持 `session_created` 局部插入与 `title_updated` 局部标题更新，避免纯标题变化触发全列表刷新
- 展开/折叠项目时自动加载；启动阶段会等待 Storage backend 就绪后再刷新已恢复的展开项目，避免残留虚假的加载状态
- 跟踪加载状态 (`hasMore`, `loading`)

### useVisibleRuntimeStatuses.ts (100 行)

- 监听可见会话的后台任务运行状态
- 通过 `fetchActiveAgentStatuses` 轮询 + SSE 订阅
- 每 5 秒自动刷新
