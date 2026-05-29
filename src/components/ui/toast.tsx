import { useEffect, useRef, useState } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { BackgroundTaskStatus } from '@/lib/types'

export type ToastItem = {
  id: string
  sessionId: string
  title: string
  status: BackgroundTaskStatus
  message?: string
  createdAt: number
}

type ToastProps = {
  toast: ToastItem
  onDismiss: (id: string) => void
  onClick: (sessionId: string) => void
}

function Toast({ toast, onDismiss, onClick }: ToastProps) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const dismissTimerRef = useRef<number | null>(null)

  useEffect(() => {
    // Trigger enter animation
    const enterTimer = window.setTimeout(() => setVisible(true), 10)

    // Auto-dismiss after 5s
    dismissTimerRef.current = window.setTimeout(() => {
      setLeaving(true)
      dismissTimerRef.current = window.setTimeout(() => onDismiss(toast.id), 200)
    }, 5000)

    return () => {
      window.clearTimeout(enterTimer)
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current)
    }
  }, [toast.id, onDismiss])

  const handleDismiss = () => {
    setLeaving(true)
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = window.setTimeout(() => onDismiss(toast.id), 200)
  }

  const isError = toast.status === 'error'

  return (
    <div
      role="alert"
      onClick={() => onClick(toast.sessionId)}
      className={cn(
        'pointer-events-auto flex w-80 cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3 shadow-lg transition-all duration-200 ease-out',
        visible && !leaving
          ? 'translate-x-0 opacity-100'
          : 'translate-x-4 opacity-0',
      )}
    >
      <div className="mt-0.5 shrink-0">
        {isError ? (
          <XCircle className="size-5 text-destructive" />
        ) : (
          <CheckCircle className="size-5 text-emerald-500" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground/90">
          {toast.title}
        </p>
        <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
          {toast.message || (isError ? t('taskError') : t('taskCompleted'))}
        </p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleDismiss()
        }}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label={t('close')}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

type ToastContainerProps = {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
  onClick: (sessionId: string) => void
}

export function ToastContainer({ toasts, onDismiss, onClick }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onClick={onClick}
        />
      ))}
    </div>
  )
}
