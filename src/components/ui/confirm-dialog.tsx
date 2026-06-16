/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ConfirmOptions = {
  title?: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
}

export type AlertOptions = {
  title?: string
  description: string
  confirmLabel?: string
}

type DialogAction = {
  label: string
  onClick: () => void
  variant?: ButtonProps['variant']
  autoFocus?: boolean
  // When false, this action is not triggered by the Enter key. Defaults to true.
  // Used to avoid confirming destructive actions via a stray Enter press.
  enter?: boolean
}

function MessageDialog({
  title,
  description,
  actions,
  onCancel,
}: {
  title?: string
  description: string
  actions: DialogAction[]
  onCancel: () => void
}) {
  const focusRef = useRef<HTMLButtonElement>(null)
  const resolvedRef = useRef(false)

  const resolveCancelOnce = useCallback(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onCancel()
  }, [onCancel])

  const runAction = useCallback((action: DialogAction) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    action.onClick()
  }, [])

  useEffect(() => {
    focusRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resolveCancelOnce()
      if (event.key === 'Enter') {
        // Trigger the last action that is still reachable via Enter.
        // Actions with `enter: false` (e.g. destructive confirm) are skipped
        // so a stray Enter press cannot confirm an irreversible operation.
        let primary: DialogAction | undefined
        for (let i = actions.length - 1; i >= 0; i--) {
          if (actions[i].enter !== false) {
            primary = actions[i]
            break
          }
        }
        if (primary) runAction(primary)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [resolveCancelOnce, runAction, actions])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resolveCancelOnce()
      }}
    >
      <div
        className={cn(
          'w-full max-w-[420px] rounded-2xl border border-border bg-background p-5 shadow-xl',
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'message-dialog-title' : undefined}
        aria-describedby="message-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title ? <h2 id="message-dialog-title" className="text-base font-semibold text-foreground/90">{title}</h2> : null}
        <p id="message-dialog-description" className={cn('text-sm leading-6 text-muted-foreground/72', title ? 'mt-2' : undefined)}>{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          {actions.map((action, index) => (
            <Button
              key={`${action.label}-${index}`}
              ref={action.autoFocus ? focusRef : undefined}
              variant={action.variant}
              size="sm"
              onClick={() => runAction(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function renderMessageDialog<T>(
  build: (resolve: (value: T) => void) => ReactElement,
): Promise<T> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)

    function cleanup() {
      root.unmount()
      setTimeout(() => container.remove(), 0)
    }

    function handleResolve(value: T) {
      cleanup()
      resolve(value)
    }

    root.render(build(handleResolve))
  })
}

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return renderMessageDialog((resolve) => (
    <MessageDialog
      title={options.title}
      description={options.description}
      onCancel={() => resolve(false)}
      actions={[
        {
          label: options.cancelLabel ?? 'Cancel',
          variant: 'outline',
          onClick: () => resolve(false),
          // Focus the cancel button first for destructive actions so an
          // accidental Enter does not perform an irreversible operation.
          autoFocus: options.variant === 'destructive',
        },
        {
          label: options.confirmLabel ?? 'Confirm',
          variant: options.variant === 'destructive' ? 'destructive' : 'default',
          autoFocus: options.variant !== 'destructive',
          enter: options.variant !== 'destructive',
          onClick: () => resolve(true),
        },
      ]}
    />
  ))
}

export function showAlert(options: AlertOptions | string): Promise<void> {
  const normalized = typeof options === 'string' ? { description: options } : options
  return renderMessageDialog((resolve) => (
    <MessageDialog
      title={normalized.title}
      description={normalized.description}
      onCancel={() => resolve()}
      actions={[
        {
          label: normalized.confirmLabel ?? 'OK',
          autoFocus: true,
          onClick: () => resolve(),
        },
      ]}
    />
  ))
}
