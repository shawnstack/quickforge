# `src/hooks/` — 自定义 React Hooks

**路径**: `src/hooks/`

包含 14 个自定义 React Hook，用于封装应用状态管理和业务逻辑。

---

| Hook 文件 | 行数 | 用途 |
|-----------|------|------|
| [`useAppBootstrap.ts`](#useappbootstrapts) | 171 | 应用启动引导：初始化 Storage、加载项目、恢复会话 |
| [`useAgentManager.ts`](#useagentmanagerts) | 399 | Agent 生命周期管理：创建、加载、切换会话 |
| [`useChatActions.ts`](#usechatactionsts) | 213 | 聊天操作：发送消息、回滚、分叉、复制 |
| [`useModelActions.ts`](#usemodelactionsts) | 186 | 模型操作：选择模型、切换 yolo、管理工具 |
| [`useSessionActions.ts`](#usesessionactionsts) | 86 | 会话操作：删除、重命名、刷新 |
| [`useSessionPagination.ts`](#usesessionpaginationts) | 160 | 会话分页加载 |
| [`useProject.ts`](#useprojectts) | 100 | 项目状态管理 |
| [`useProjectActions.ts`](#useprojectactionsts) | 66 | 项目操作：切换、添加、删除 |
| [`useYoloActions.ts`](#useyoloactionsts) | 39 | YOLO 模式操作 |
| [`useYoloMode.ts`](#useyolomodets) | 12 | YOLO 模式状态 |
| [`useCrossTabSync.ts`](#usecrosstabts) | 80 | 跨标签页同步 |
| [`useSentinel.ts`](#usesentineltls) | 20 | 哨兵元素（用于 Infinite Scroll） |
| [`useTaskToasts.ts`](#usetasktoaststs) | 16 | 后台任务 Toast 通知管理 |
| [`useVisibleRuntimeStatuses.ts`](#usevisibleruntimestatusests) | 100 | 可见会话的后台任务状态轮询 |

---

## useAppBootstrap.ts (171 行)

**用途**: 应用启动引导。在应用首次加载时执行初始化流程。

**执行流程**:
1. 初始化 Pi Storage（`initializePiStorage`）
2. 初始化应用语言
3. 加载默认选项（模型、思考级别）
4. 加载项目列表
5. 恢复上次活动会话
6. 处理 DeepSeek 思考模式的兼容修补

## useAgentManager.ts (399 行)

**用途**: Agent 管理器的核心 Hook，管理所有聊天会话的生命周期。

**暴露接口**:
- `createAgent()` — 创建新的 Agent 会话
- `loadSession()` — 加载已有会话
- `destroyAgent()` — 销毁 Agent
- `startTask()` / `abortTask()` — 后台任务控制
- `compactConversation()` — 压缩对话历史

**状态**: 维护 `agentRef`、`taskMapRef`、`currentSessionIdRef` 等稳定引用。

## useChatActions.ts (213 行)

**用途**: 封装聊天面板的操作回调。

**功能**:
- `handleSendMessage()` — 发送消息（附带草稿保存）
- `handleRollbackFromMessage()` — 从指定消息回滚
- `handleForkFromMessage()` — 从指定消息分叉
- `handleCopyAnswer()` — 复制 AI 回复
- `handleYoloToggle()` — 切换 YOLO 模式

## useModelActions.ts (186 行)

**用途**: 模型选择和工具管理。

**功能**:
- 初始化/切换活动模型
- 处理模型选择对话框回调
- YOLO 模式与 workspace 工具的启用/禁用同步
- 重新创建 Agent 以应用新模型

## useSessionActions.ts (86 行)

**用途**: 会话 CRUD 操作。

**功能**:
- `deleteSession()` — 删除会话
- `renameSession()` — 重命名会话
- `refreshSessions()` — 刷新会话列表（支持跨标签广播）

## useSessionPagination.ts (160 行)

**用途**: 实现会话列表的分页加载。

**功能**:
- 全局会话分页（`loadGlobalSessions`）
- 项目会话分页（`loadSessionsForProject`）
- 跟踪加载状态（`hasMore`, `loading`）

## useProject.ts (100 行)

**用途**: 项目状态管理。

**状态**: `activeProject`、`projects`、`expandedProjectIds`、`projectPickerOpen`、`selectingProject`

## useProjectActions.ts (66 行)

**用途**: 项目操作封装。

**功能**: `handleSelectProjectPath()` — 选择项目目录；`deleteProject()` — 删除项目。

## useYoloActions.ts (39 行)

**用途**: YOLO 模式操作。切换 YOLO 模式并保存设置。

## useYoloMode.ts (12 行)

**用途**: 简单的 YOLO 模式布尔状态管理。

## useCrossTabSync.ts (80 行)

**用途**: 跨标签页同步。使用 `BroadcastChannel` API 在多个标签页之间同步会话和项目变更。

## useSentinel.ts (20 行)

**用途**: 为 Intersection Observer 提供哨兵元素 ref，用于无限滚动。

## useTaskToasts.ts (16 行)

**用途**: 后台任务完成时的 Toast 通知。接收任务完成回调并添加到 Toast 列表。

## useVisibleRuntimeStatuses.ts (100 行)

**用途**: 定期轮询当前可见会话的后台任务状态。使用 `useRovingInterval` 避免不必要的渲染，仅更新有状态变化的会话。
