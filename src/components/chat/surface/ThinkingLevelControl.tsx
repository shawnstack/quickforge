/* eslint-disable react-refresh/only-export-components -- exports the control component plus the level vocabulary/label helper covered by tests. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import type { AppTextKey } from '@/lib/i18n'
import type { ThinkingLevel } from './ChatTypes'

/**
 * QuickForge thinking-level selector, previously injected into the composer's
 * right-hand control row by `panel-decoration/thinking-level-controls.ts`.
 *
 * The decoration built the button by hand, appended its menu to `document.body`
 * (to escape the panel's clipping context), positioned it with
 * `getBoundingClientRect`/`offsetHeight`, registered capture-phase
 * pointerdown/keydown/resize/scroll listeners, and kept an `aria-expanded`
 * mirror on the trigger. React renders the button and the menu; the only
 * imperative part left is the measurement, which is inherent to a fixed-position
 * popover.
 *
 * The menu renders outside the composer in a portal-free fixed layer: the CSS
 * (`.quickforge-thinking-menu`) is `position: fixed`, so it is placed inside the
 * component tree but positioned from the trigger's rect.
 */

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

const THINKING_LABEL_KEY: Record<ThinkingLevel, AppTextKey> = {
  off: 'thinkingOff',
  low: 'thinkingLow',
  medium: 'thinkingMedium',
  high: 'thinkingHigh',
  xhigh: 'thinkingXHigh',
} as Record<ThinkingLevel, AppTextKey>

export function thinkingLevelLabel(level: ThinkingLevel): string {
  return t(THINKING_LABEL_KEY[level] ?? 'thinkingOff')
}

function BrainIcon() {
  return (
    <svg className="quickforge-thinking-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a3 3 0 0 0-5.997-.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 0 1 5.997-.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="quickforge-thinking-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="quickforge-agent-access-check" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

const MENU_WIDTH = 148
const MENU_GAP = 8
const MENU_EDGE = 12

export type ThinkingLevelControlProps = {
  level: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
  /** Close every other composer popover before opening (menus are exclusive). */
  onBeforeOpen?: () => void
  /**
   * Render the trigger in its disabled state. Side Chat keeps the control
   * visible but inert — the decoration disabled it through
   * `disableComposerControls` rather than removing it.
   */
  disabled?: boolean
}

export function ThinkingLevelControl({ level, onChange, onBeforeOpen, disabled = false }: ThinkingLevelControlProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const label = thinkingLevelLabel(level)
  const title = `${t('thinkingLevel')}: ${label}`

  // Measure after the menu exists (its height is not known before render), and
  // re-measure on resize/scroll while open — the same triggers the decoration
  // listened to on `window`.
  useEffect(() => {
    if (!open) return undefined
    const reposition = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(MENU_WIDTH, window.innerWidth - MENU_EDGE * 2)
      const measuredHeight = menu?.offsetHeight || 160
      setPosition({
        width,
        left: Math.max(MENU_EDGE, Math.min(rect.left, window.innerWidth - width - MENU_EDGE)),
        top: Math.max(MENU_EDGE, rect.top - measuredHeight - MENU_GAP),
      })
    }
    reposition()
    // `resize`/`scroll` (capture) keep the fixed layer glued to the trigger.
    window.addEventListener('resize', reposition, true)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition, true)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (menuRef.current?.contains(target ?? null)) return
      if (triggerRef.current?.contains(target ?? null)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const items = useMemo(() => THINKING_LEVELS.map((value) => ({
    value,
    label: thinkingLevelLabel(value),
    selected: value === level,
  })), [level])

  const openMenu = () => {
    onBeforeOpen?.()
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="quickforge-thinking-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-quickforge-thinking-level={level}
        disabled={disabled}
        // `pointerdown` (not click): the decoration opened on pointerdown so the
        // focus never left the textarea's selection.
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (disabled) return
          if (open) setOpen(false)
          else openMenu()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
          event.preventDefault()
          if (disabled) return
          if (open) setOpen(false)
          else openMenu()
        }}
      >
        <BrainIcon />
        <span className="quickforge-thinking-label">{label}</span>
        <ChevronIcon />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="quickforge-thinking-menu"
          role="menu"
          aria-label={t('thinkingLevel')}
          style={position
            ? { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }
            : // First frame before measurement: render off-screen so the menu can
              // be measured without flashing at the wrong place.
              { left: '-9999px', top: '-9999px', width: `${MENU_WIDTH}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              className="quickforge-thinking-item"
              role="menuitemradio"
              aria-checked={item.selected}
              data-quickforge-thinking-level={item.value}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
                if (!item.selected) onChange(item.value)
              }}
            >
              <span className="quickforge-thinking-check-slot">{item.selected ? <CheckIcon /> : null}</span>
              <span className="quickforge-thinking-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
