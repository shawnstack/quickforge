import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { BackgroundTaskStatus } from '@/lib/types'

interface RuntimeStatusesStore {
  statuses: Record<string, BackgroundTaskStatus>
  completedSessionIds: Set<string>
  setStatuses: Dispatch<SetStateAction<Record<string, BackgroundTaskStatus>>>
  setCompletedSessionIds: Dispatch<SetStateAction<Set<string>>>
}

/** 可见会话运行态的 App 级单一数据源。
 *
 *  setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（支持函数式更新），
 *  action 引用恒定；轮询 / SSE / visibilitychange 等副作用逻辑仍留在
 *  `useVisibleRuntimeStatuses` 兼容层内，经 selector 消费本 store。
 */
export const useRuntimeStatusesStore = create<RuntimeStatusesStore>((set) => ({
  statuses: {},
  completedSessionIds: new Set<string>(),

  setStatuses: (value) =>
    set((state) => ({ statuses: typeof value === 'function' ? value(state.statuses) : value })),
  setCompletedSessionIds: (value) =>
    set((state) => ({
      completedSessionIds: typeof value === 'function' ? value(state.completedSessionIds) : value,
    })),
}))
