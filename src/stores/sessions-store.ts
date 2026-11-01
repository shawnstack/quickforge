import { create } from 'zustand'
import type { SessionPage } from '@/lib/session-list-updates'

/** 单页更新入参：与 React setState 同形——直接值或基于前一值的 updater。 */
type SessionPageUpdate = SessionPage | ((prev: SessionPage) => SessionPage)
type ProjectPagesUpdate = Record<string, SessionPage> | ((prev: Record<string, SessionPage>) => Record<string, SessionPage>)

function resolveUpdate<T>(update: T | ((prev: T) => T), prev: T): T {
  return typeof update === 'function' ? (update as (prev: T) => T)(prev) : update
}

interface SessionsStore {
  /** 置顶分区（pinned=only 拉取，独立于其余三路）。 */
  pinnedPage: SessionPage
  /** 全局会话（scope=global, pinned=exclude）。 */
  globalPage: SessionPage
  /** 每个已加载项目的分页（scope=project, pinned=exclude），key 为 projectId。 */
  projectPages: Record<string, SessionPage>
  /** 项目时间线（scope=projects, pinned=exclude）。 */
  projectTimelinePage: SessionPage
  setPinnedPage: (update: SessionPageUpdate) => void
  setGlobalPage: (update: SessionPageUpdate) => void
  setProjectPages: (update: ProjectPagesUpdate) => void
  setProjectTimelinePage: (update: SessionPageUpdate) => void
}

/** 会话四路分页状态的单一数据源（zustand）。
 *
 *  语义与旧 useSessionPagination 内部 useState 完全等价：
 *  - setXxx 的 updater 在 set 时同步执行，调用返回后
 *    `useSessionsStore.getState()` 立即可读到新值——这正是旧实现里
 *    globalPageRef / projectPagesRef / projectTimelinePageRef 手动 ref
 *    镜像所保证的“同步读最新值”，因此镜像整体删除、改为 getState() 读取；
 *  - updater 返回与前一值相同（Object.is）的引用时切片引用保持不变，
 *    useSyncExternalStore 订阅侧按切片比较后跳过重渲染，效果等同
 *    React setState 的 bail-out（removeSession 等依赖该语义）；
 *  - action 引用恒定，React 侧经 useSessionPagination 兼容层订阅消费，
 *    非 React 编排代码可直接 `useSessionsStore.getState().setXxx(...)`。
 *
 *  并发控制（requestVersion 版本守卫、REFRESH_SESSIONS_MERGE_MS 的
 *  250ms in-flight 合并轮）留在 useSessionPagination hook 内：它们是
 *  hook 实例级的 useRef 生命周期语义，与 App.tsx 的挂载/重渲染节奏
 *  绑定，下沉为 store 模块级变量反而会改变“每个 hook 实例独立一轮”的
 *  行为，故选择保留在 hook 内（改动最小、行为完全等价）。
 */
export const useSessionsStore = create<SessionsStore>((set) => ({
  pinnedPage: { items: [], total: 0, loading: false },
  globalPage: { items: [], total: 0, loading: false },
  projectPages: {},
  projectTimelinePage: { items: [], total: 0, loading: false },

  setPinnedPage: (update) => {
    set((state) => ({ pinnedPage: resolveUpdate(update, state.pinnedPage) }))
  },
  setGlobalPage: (update) => {
    set((state) => ({ globalPage: resolveUpdate(update, state.globalPage) }))
  },
  setProjectPages: (update) => {
    set((state) => ({ projectPages: resolveUpdate(update, state.projectPages) }))
  },
  setProjectTimelinePage: (update) => {
    set((state) => ({ projectTimelinePage: resolveUpdate(update, state.projectTimelinePage) }))
  },
}))
