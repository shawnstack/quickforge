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
  const dialogRef = useRef<HTMLDivElement>(null)
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
      if (event.key === 'Tab') {
        // Focus trap: the dialog is aria-modal, so keyboard focus must not
        // escape to the background content while it is open.
        const dialog = dialogRef.current
        if (!dialog) return
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        const focusInsideDialog = active instanceof HTMLElement && dialog.contains(active)
        if (event.shiftKey) {
          if (active === first || !focusInsideDialog) {
            event.preventDefault()
            last.focus()
          }
        } else if (active === last || !focusInsideDialog) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [resolveCancelOnce, runAction, actions])

  return createPortal(
    <div
      className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resolveCancelOnce()
      }}
    >
      <div
        ref={dialogRef}
        className={cn(
          'quickforge-dialog-panel-in w-full max-w-[420px] rounded-2xl border border-border bg-background p-5 shadow-quickforge',
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

// Module-level mutex: message dialogs are modal, so a second dialog must never
// stack on top of a live one. Rapid double clicks on a destructive entry point
// used to open two overlapping dialogs that could both be confirmed.
let messageDialogActive = false

function renderMessageDialog<T>(
  rejectedWith: () => T,
  build: (resolve: (value: T) => void) => ReactElement,
): Promise<T> {
  if (messageDialogActive) {
    // Another message dialog is already open: treat this request as cancelled
    // instead of stacking a second modal layer.
    return Promise.resolve(rejectedWith())
  }
  messageDialogActive = true
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // Restore focus to the trigger when the dialog closes; without this the
    // focus fell back to <body> and keyboard users lost their place.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const root = createRoot(container)

    function cleanup() {
      root.unmount()
      setTimeout(() => {
        container.remove()
        if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
      }, 0)
    }

    function handleResolve(value: T) {
      messageDialogActive = false
      cleanup()
      resolve(value)
    }

    try {
      root.render(build(handleResolve))
    } catch (error) {
      messageDialogActive = false
      cleanup()
      throw error
    }
  })
}

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return renderMessageDialog(() => false, (resolve) => (
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
  return renderMessageDialog<void>(() => undefined, (resolve) => (
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
