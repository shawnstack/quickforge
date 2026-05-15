/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}

function ConfirmDialogInner({
  options,
  onResolve,
}: {
  options: ConfirmOptions
  onResolve: (confirmed: boolean) => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const resolvedRef = useRef(false)

  const resolveOnce = useCallback((confirmed: boolean) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolve(confirmed)
  }, [onResolve])

  useEffect(() => {
    cancelRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resolveOnce(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [resolveOnce])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <div
        className={cn(
          'w-full max-w-[420px] rounded-2xl border border-border bg-background p-5 shadow-xl',
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-foreground/90">{options.title}</h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm leading-6 text-muted-foreground/72">{options.description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            onClick={() => resolveOnce(false)}
          >
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => resolveOnce(true)}
          >
            {options.confirmLabel ?? 'Delete'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)

    function cleanup() {
      root.unmount()
      setTimeout(() => container.remove(), 0)
    }

    function handleResolve(confirmed: boolean) {
      cleanup()
      resolve(confirmed)
    }

    root.render(<ConfirmDialogInner options={options} onResolve={handleResolve} />)
  })
}
