import { useTaskToastsStore } from '@/stores/task-toasts-store'

/** Toast 状态已迁入 useTaskToastsStore（zustand）。
 *  本 hook 保留为兼容层：返回结构与旧实现一致，App.tsx 接线不变；
 *  action 引用恒定（等价于旧 useCallback([])），下游依赖数组的稳定性不受影响。
 */
export function useTaskToasts() {
  const toasts = useTaskToastsStore((s) => s.toasts)
  const handleTaskComplete = useTaskToastsStore((s) => s.handleTaskComplete)
  const addToast = useTaskToastsStore((s) => s.addToast)
  const dismissToast = useTaskToastsStore((s) => s.dismissToast)

  return {
    toasts,
    handleTaskComplete,
    addToast,
    dismissToast,
  }
}
