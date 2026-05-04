import { useCallback, useState } from 'react'
import type { ToastItem } from '@/components/ui/toast'
import type { BackgroundTaskStatus } from '@/lib/types'

export function useTaskToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const handleTaskComplete = useCallback(
    (sessionId: string, title: string, status: BackgroundTaskStatus) => {
      const toast: ToastItem = {
        id: crypto.randomUUID(),
        sessionId,
        title,
        status,
        createdAt: Date.now(),
      }
      setToasts((prev) => [...prev, toast])
    },
    [],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return {
    toasts,
    handleTaskComplete,
    dismissToast,
  }
}
