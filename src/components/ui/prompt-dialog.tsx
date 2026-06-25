/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PromptOptions = {
  title: string
  description?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  placeholder?: string
}

function PromptDialogInner({
  options,
  onResolve,
}: {
  options: PromptOptions
  onResolve: (value: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(options.defaultValue ?? '')
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  // Initial focus + select once on mount
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Keyboard shortcuts with latest value via ref
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onResolve(null)
      if (event.key === 'Enter' && valueRef.current.trim()) onResolve(valueRef.current.trim())
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onResolve])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(null)
      }}
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-quickforge',
          'mx-4',
        )}
      >
        <h2 className="text-base font-semibold text-foreground">{options.title}</h2>
        {options.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{options.description}</p>
        ) : null}
        <div className="mt-4">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={options.placeholder}
            className="w-full"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResolve(null)}
          >
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            size="sm"
            onClick={() => value.trim() ? onResolve(value.trim()) : undefined}
            disabled={!value.trim()}
          >
            {options.confirmLabel ?? 'Save'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function showPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)

    function cleanup() {
      root.unmount()
      setTimeout(() => container.remove(), 0)
    }

    function handleResolve(value: string | null) {
      cleanup()
      resolve(value)
    }

    root.render(<PromptDialogInner options={options} onResolve={handleResolve} />)
  })
}
