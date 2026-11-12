# 前端状态管理迁移（Zustand）

> 2026-11 引入。本文记录 App 级状态从「App.tsx 手写 useState + 自定义 hook + props 下发」迁移到 Zustand store 的架构决策、分阶段实施结果与后续守则。

## 背景与动机

迁移前，App.tsx（约 2000 行）编排约 30 个自定义 hook，全部状态经 props 下发（`sidebarCommonProps` 约 45 字段、`ChatSidebar` 66 个 props、`ChatPanelHost` 约 52 个 props），无应用级 Context。痛点：

- 状态散落各 hook，跨组件共享靠 prop drilling，深层组件拿不到回调时只能用 window CustomEvent 桥（7 处 workaround）。
- 桌面/移动双 `ChatSidebar` 实例共享状态依赖 App 层转发。
- 调试与测试缺少统一状态快照。

## 技术选型

- **zustand@^5**（devDependencies，与 react/react-dom 同列——前端依赖构建时打进 `dist/`，server 运行时不需要）。
- 每个业务域一个独立 store（非单一巨型 store、不引 slice 组合机制），目录 `src/stores/`。
- 与 `src/storage/stores/`（IndexedDB 持久化层）是**两个概念**：前者是 UI/会话域内存状态，后者是数据持久化对象仓库。

## Store 清单（P0–P4 实施结果）

| 阶段 | Store | 承载状态 | 备注 |
|---|---|---|---|
| P1 | `task-toasts-store.ts` | toasts[] + addToast/dismiss | 非 React 代码可 `getState().addToast()` |
| P1 | `sidebar-ordering-store.ts` | 区块顺序 + 视图/排序模式 | localStorage 持久化（action 内直写） |
| P2 | `ui-store.ts` | useUIState 全部 16 项 UI 状态 + 3 toggle | 另含请求信号（见下）；2026-11-12 god-module③ 追加 `sidebarWidth` 与 `workspaceInspectorOpenScopeId`（原 App.tsx 本地 useState，属 App 级纯 UI 状态，收敛后 App 只读消费，render 期 scope 清空模式保留、写入 store） |
| P3 | `runtime-statuses-store.ts` | statuses / completedSessionIds | 轮询+SSE 副作用留 hook |
| P3 | `update-check-store.ts` | result | fetch/持久化留 hook |
| P3 | `agent-access-mode-store.ts` | agentAccessMode | initialize 留 hook |
| P3 | `sessions-store.ts` | 四路会话分页 | requestVersion 守卫与 250ms 合并轮留 hook；refs 镜像删除（getState 同步读） |
| P3 | `project-store.ts` | activeProject/projects/defaultWorkspace/expandedProjectIds 等 | expandedProjectIds 持久化直写 |
| P3 | `git-store.ts` | titleGitStatus + 4 开合状态 | fetch/SSE 400ms debounce/请求守卫 ref 留 hook |
| P4 | `agent-session-store.ts` | currentSessionId/currentRuntimeScopeId/currentTitle/chatScope/currentToolProject/taskStatuses/chatPanelRevision/loadingSessionId | agent 实例与全部 ref/副作用留 hook |

## 兼容层模式（本次迁移的核心手法）

hook 保留为**薄兼容层**：逐字段 selector 订阅 + 返回结构与签名完全不变，调用方（App.tsx、依赖注入 hook、组件 props）零改动：

```ts
// src/hooks/useTaskToasts.ts（示例）
export function useTaskToasts() {
  const toasts = useTaskToastsStore((s) => s.toasts)
  const addToast = useTaskToastsStore((s) => s.addToast)
  // ...返回结构与旧实现一致
}
```

setter 统一 `Dispatch<SetStateAction<T>>` 签名（支持函数式更新），action 引用恒定（等价旧 `useCallback([])`），下游 useCallback 依赖数组语义不变；exhaustive-deps 将其显式列入 deps（恒定引用 → 回调稳定性不变）。

**组件直连 store（去 props）**：`ChatSidebar`（UI 开合 + ordering 域，14 个 props 删除）、`ConversationHeader`（conversationMenu + 移动侧栏按钮）、`useMobileSidebar` 已改为组件内部 selector 订阅。其余域保留兼容层（props 链路不变），后续按需渐进推进。

## window CustomEvent 桥替换（3 处）

树外/模块级代码向 React 侧发请求改为 store 请求信号（`{ payload, nonce }` + clear）：

| 原事件 | 信号 | 发起方 | 订阅方 |
|---|---|---|---|
| `quickforge:open-settings-tab` | `requestSettingsTab` | ~~MemorySettingsTab~~（无生产方，信号与订阅保留备用） | SettingsWorkspacePage |
| `quickforge:preview-artifact` | `requestArtifactPreview` | tool-renderers/shared.tsx（React 树外） | App.tsx（结合 agentManager 闭包处理） |
| `quickforge:open-session-from-settings` | `requestOpenSession` | react-settings-tabs、system-notifications（OS 通知） | App.tsx |

nonce 保证相同 payload 的重复请求也能触发订阅方 effect；订阅方处理即清除（丢弃语义与旧事件一致）。

## 迁移守则（后续新增状态必须遵守）

1. **只允许 selector 订阅**（`useStore(s => s.x)`），禁止整对象订阅——`ChatSidebar` 的 `memo` 与 SessionViewPool 保活依赖引用稳定性。
2. **非序列化对象不进 store**：ServerAgent 实例、taskMap、unsubscribe、abort controller 等留在 hook 的 `useRef`/闭包。
3. **副作用留 hook**：fetch、SSE 订阅、debounce、轮询、localStorage 读写（或 action 内直写，参照 sidebar-ordering-store）不进 store；store 只承载可序列化状态 + 纯 set action。
4. **行为等价优先**：并发控制（版本守卫、合并窗口、in-flight 去重）原样保留，选择改动最小的落位（hook 闭包或 store 闭包），并注释说明。
5. **契约测试同步更新意图**：源码契约测试锁的是「共享一份状态 + 持久化 + 接线不漂移」的意图，迁移后断言指向 store/新调用形式，禁止直接删除保护。

## 测试适配

- **vitest inline zustand**：`vitest.config.ts` `server.deps.inline: ['zustand']`——否则外部化的 zustand 内部 `import React from 'react'` 不经 `vi.mock('react')` 拦截。
- **hookRuntime 增强**：`tests/frontend/helpers/hook-lifecycle.ts` 补 `useSyncExternalStore`/`useDebugValue`，并提供 `reactMockWithRuntime(original)`——mock 的 react 必须带 **default 导出**（zustand 以 `React.*` 消费）。
- **store 单测**：`getState()/setState()` 纯对象断言（无 React 环境），`beforeEach` 显式复位（store 是模块级单例）。

## 已知行为差异（有意为之）

- store 为模块级单例：dev StrictMode 重挂/HMR 下已迁域状态跨挂载保留（原 useState 会重置）；生产整页加载语义不变。
- 持久化域初始加载不再把默认值写回 localStorage（无变化不落盘）。
