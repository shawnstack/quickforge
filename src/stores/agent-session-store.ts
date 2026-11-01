import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { BackgroundTaskStatus, ChatScope, ProjectInfo } from '@/lib/types'
import { randomId } from '@/lib/random-id'

interface AgentSessionStore {
  /** 当前会话 id；undefined 表示尚未落库（空白新会话 / deferred session）。 */
  currentSessionId: string | undefined
  /** 当前运行时 scope key：已加载会话为其 sessionId，空白新会话为模块创建时
   *  生成的一次性随机 id。WorkspaceInspector / side-chat 等按它做 runtime key。 */
  currentRuntimeScopeId: string
  /** 当前会话标题（空白新会话为 'New chat'）。 */
  currentTitle: string
  /** 当前聊天 scope（global / project）。 */
  chatScope: ChatScope
  /** 当前会话关联的项目（chat tool project）。 */
  currentToolProject: ProjectInfo | undefined
  /** 后台任务状态表（sessionId → status），供侧栏运行时状态消费。 */
  taskStatuses: Record<string, BackgroundTaskStatus>
  /** ChatPanel 重建/刷新修订号（模型切换、deferred 首条消息等 bump）。 */
  chatPanelRevision: number
  /** 正在加载的会话 id（会话切换遮罩用）。 */
  loadingSessionId: string | undefined

  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>
  setCurrentRuntimeScopeId: Dispatch<SetStateAction<string>>
  setCurrentTitle: Dispatch<SetStateAction<string>>
  setChatScope: Dispatch<SetStateAction<ChatScope>>
  setCurrentToolProject: Dispatch<SetStateAction<ProjectInfo | undefined>>
  setTaskStatuses: Dispatch<SetStateAction<Record<string, BackgroundTaskStatus>>>
  setChatPanelRevision: Dispatch<SetStateAction<number>>
  setLoadingSessionId: Dispatch<SetStateAction<string | undefined>>
}

/** Agent 会话域可序列化状态的单一数据源（zustand）。
 *
 *  语义与旧 useAgentManager 内部 useState 完全等价：
 *  - setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（直接值或
 *    基于前一值的函数式更新），useChatActions / useModelActions /
 *    useAgentAccessActions 等依赖注入方的调用点签名不变；
 *  - action 引用恒定，等价于旧 useState setter 的稳定性，下游依赖数组的
 *    稳定性不受影响；非 React 代码可直接 `useAgentSessionStore.getState().setXxx(...)`；
 *  - 函数式更新返回与前一值相同（Object.is）的引用时切片引用保持不变，
 *    useSyncExternalStore 订阅侧按切片比较后跳过重渲染，效果等同 React
 *    setState 的 bail-out（removeTaskStatuses 的 no-op 分支依赖该语义）；
 *  - set 同步应用，调用返回后 getState() 立即可读到新值——这正是旧实现里
 *    currentSessionIdRef / currentChatScopeRef 等手动 ref 镜像保证的
 *    “稳定回调同步读最新值”（镜像仍保留，见 useAgentManager 注释）。
 *
 *  保留在 useAgentManager hook 内（不迁 store）的：agent 实例本身
 *  （ServerAgent / DeferredSessionAgent 不可序列化、含 dispose /
 *  unsubscribe 生命周期）、taskMapRef 等 ref、agent 事件订阅、LRU 淘汰、
 *  loadSession 的 abort / in-flight 去重与 deferred session 编排。
 */
export const useAgentSessionStore = create<AgentSessionStore>((set) => ({
  currentSessionId: undefined,
  currentRuntimeScopeId: randomId(),
  currentTitle: 'New chat',
  chatScope: 'global',
  currentToolProject: undefined,
  taskStatuses: {},
  chatPanelRevision: 0,
  loadingSessionId: undefined,

  setCurrentSessionId: (value) =>
    set((s) => ({ currentSessionId: typeof value === 'function' ? value(s.currentSessionId) : value })),
  setCurrentRuntimeScopeId: (value) =>
    set((s) => ({ currentRuntimeScopeId: typeof value === 'function' ? value(s.currentRuntimeScopeId) : value })),
  setCurrentTitle: (value) =>
    set((s) => ({ currentTitle: typeof value === 'function' ? value(s.currentTitle) : value })),
  setChatScope: (value) =>
    set((s) => ({ chatScope: typeof value === 'function' ? value(s.chatScope) : value })),
  setCurrentToolProject: (value) =>
    set((s) => ({ currentToolProject: typeof value === 'function' ? value(s.currentToolProject) : value })),
  setTaskStatuses: (value) =>
    set((s) => ({ taskStatuses: typeof value === 'function' ? value(s.taskStatuses) : value })),
  setChatPanelRevision: (value) =>
    set((s) => ({ chatPanelRevision: typeof value === 'function' ? value(s.chatPanelRevision) : value })),
  setLoadingSessionId: (value) =>
    set((s) => ({ loadingSessionId: typeof value === 'function' ? value(s.loadingSessionId) : value })),
}))
