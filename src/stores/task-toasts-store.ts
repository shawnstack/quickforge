import { create } from 'zustand'
import type { ToastItem } from '@/components/ui/toast'
import type { BackgroundTaskStatus } from '@/lib/types'
import { randomId } from '@/lib/random-id'

interface TaskToastsStore {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id' | 'createdAt'>) => void
  handleTaskComplete: (sessionId: string, title: string, status: BackgroundTaskStatus) => void
  dismissToast: (id: string) => void
}

/** 全局任务 Toast 通知的单一数据源。
 *
 *  action 引用恒定，可直接在事件回调 / 非 React 编排代码中通过
 *  `useTaskToastsStore.getState().addToast(...)` 调用；
 *  React 侧经 `useTaskToasts()` 兼容层或 selector 订阅消费。
 */
export const useTaskToastsStore = create<TaskToastsStore>((set) => {
  const addToast = (toast: Omit<ToastItem, 'id' | 'createdAt'>) => {
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          ...toast,
          id: randomId(),
          createdAt: Date.now(),
        },
      ],
    }))
  }

  return {
    toasts: [],
    addToast,
    handleTaskComplete: (sessionId: string, title: string, status: BackgroundTaskStatus) => {
      addToast({ sessionId, title, status })
    },
    dismissToast: (id: string) => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },
  }
})
