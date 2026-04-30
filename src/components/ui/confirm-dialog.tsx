/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    cancelRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onResolve(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onResolve])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(false)
      }}
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg',
          'mx-4',
        )}
      >
        <h2 className="text-base font-semibold text-foreground">{options.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{options.description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            onClick={() => onResolve(false)}
          >
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onResolve(true)}
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
