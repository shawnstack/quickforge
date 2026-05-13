import { useCallback, useState } from 'react'
import type { ToastItem } from '@/components/ui/toast'
import type { BackgroundTaskStatus } from '@/lib/types'
import { randomId } from '@/lib/random-id'

export function useTaskToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((toast: Omit<ToastItem, 'id' | 'createdAt'>) => {
    setToasts((prev) => [...prev, {
      ...toast,
      id: randomId(),
      createdAt: Date.now(),
    }])
  }, [])

  const handleTaskComplete = useCallback(
    (sessionId: string, title: string, status: BackgroundTaskStatus) => {
      addToast({ sessionId, title, status })
    },
    [addToast],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return {
    toasts,
    handleTaskComplete,
    addToast,
    dismissToast,
  }
}
