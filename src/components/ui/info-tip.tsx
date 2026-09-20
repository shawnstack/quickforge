import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/lib/i18n'

type InfoTipProps = {
  label: string
}

/** React counterpart of the legacy info tip, sharing its existing classes and timing. */
export function InfoTip({ label }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = `quickforge-info-tip-${useId()}`

  function clearTimer() {
    clearTimeout(timerRef.current)
    timerRef.current = undefined
  }

  function updateOpen(next: boolean, delay = 0) {
    clearTimer()
    if (delay) timerRef.current = setTimeout(() => setOpen(next), delay)
    else setOpen(next)
  }

  function reposition() {
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return
    const rect = trigger.getBoundingClientRect()
    const { width, height } = popover.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    let top = rect.bottom + 6
    if (top + height > window.innerHeight - 8) {
      const above = rect.top - 6 - height
      if (above > 8) top = above
    }
    popover.style.top = `${Math.round(top)}px`
    popover.style.left = `${Math.round(left)}px`
  }

  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, label])

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    if (!open) return
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) return
      updateOpen(false)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      updateOpen(false)
    }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('keydown', keyDown, true)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  })

  return (
    <span className="quickforge-info-tip">
      <button
        ref={triggerRef}
        type="button"
        className="quickforge-info-tip-trigger"
        aria-label={t('help')}
        aria-expanded={open}
        aria-describedby={open && label ? tooltipId : undefined}
        onMouseEnter={() => updateOpen(true, 150)}
        onMouseLeave={() => updateOpen(false, 120)}
        onFocus={() => updateOpen(true)}
        onBlur={() => updateOpen(false, 120)}
        onClick={() => updateOpen(!open)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      </button>
      {open && label && createPortal(<div ref={popoverRef} id={tooltipId} className="quickforge-info-tip-popover" role="tooltip">{label}</div>, document.body)}
    </span>
  )
}
