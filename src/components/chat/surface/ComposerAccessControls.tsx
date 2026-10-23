/* eslint-disable react-refresh/only-export-components -- exports the control components plus the shared access-mode labels used by the menu and the trigger. */
import { forwardRef, type RefObject, type SyntheticEvent } from 'react'
import { t } from '@/lib/i18n'
import type { AgentAccessMode } from '@/lib/types'

/**
 * Composer plan-mode and agent-access controls, previously rendered by
 * `panel-decoration/plan-mode-controls.ts` (`syncPlanModeButton`) and
 * `panel-decoration/agent-access-menu.ts` (`setupAgentAccessMenu`).
 *
 * Both were injected into the composer's **left control row** on every decorate
 * pass: the access trigger was appended, the plan trigger inserted right after
 * it, and the agent-access menu was appended to `document.body` with
 * `getBoundingClientRect`/`offsetHeight` positioning plus four capture-phase
 * dismissal listeners. React renders the two triggers now, and the menu is a
 * fixed-position layer measured from the trigger — the same shape as the
 * thinking selector and the "+" menu.
 *
 * Class names, `aria-pressed` / `aria-expanded` mirrors, the full-access
 * warning tone and the menu/trigger label copy are unchanged: `src/styles/chat/composer-controls.css`
 * styles them and the compact-layout rules key off these classes.
 */

export function agentAccessLabel(mode: AgentAccessMode): string {
  return mode === 'full-access' ? t('agentAccessFullLabel') : t('agentAccessDefaultLabel')
}

function agentAccessTitle(mode: AgentAccessMode): string {
  return mode === 'full-access' ? t('agentAccessFullTitle') : t('agentAccessDefaultTitle')
}

function ShieldIcon() {
  return (
    <svg className="quickforge-agent-access-trigger-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 19 6v5c0 4.5-2.8 8.4-7 10-4.2-1.6-7-5.5-7-10V6l7-3Z" />
      <path d="M9 12h6" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg className="quickforge-agent-access-option-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function AccessChevronIcon() {
  return (
    <svg className="quickforge-agent-access-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function AccessCheckIcon() {
  return (
    <svg className="quickforge-agent-access-check" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export type AgentAccessTriggerProps = {
  mode: AgentAccessMode
  expanded: boolean
  disabled?: boolean
  onToggle: () => void
}

export const AgentAccessTrigger = forwardRef<HTMLButtonElement, AgentAccessTriggerProps>(function AgentAccessTrigger(
  { mode, expanded, disabled = false, onToggle }: AgentAccessTriggerProps,
  ref,
) {
  const full = mode === 'full-access'
  const title = agentAccessTitle(mode)
  return (
    <button
      ref={ref}
      type="button"
      className={`quickforge-agent-access-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground${full ? ' quickforge-agent-access-inline-full' : ''}`}
      title={title}
      aria-label={title}
      aria-haspopup="menu"
      aria-expanded={expanded}
      data-quickforge-agent-access-mode={mode}
      disabled={disabled}
      // `pointerdown` (not click) so opening the menu never moves focus out of
      // the textarea — the same reason the decoration opened on pointerdown.
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (disabled) return
        onToggle()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
        event.preventDefault()
        if (disabled) return
        onToggle()
      }}
    >
      {full ? <WarningIcon /> : <ShieldIcon />}
      <span className="quickforge-agent-access-label">{agentAccessLabel(mode)}</span>
      <AccessChevronIcon />
    </button>
  )
})

const MENU_WIDTH = 196
const MENU_GAP = 8
const MENU_EDGE = 12
/** Fallback height before the menu can be measured (2 items + padding). */
const MENU_FALLBACK_HEIGHT = 96

export type AgentAccessMenuProps = {
  mode: AgentAccessMode
  anchor: { left: number; top: number; width: number } | null
  menuRef: RefObject<HTMLDivElement | null>
  onSelect: (mode: AgentAccessMode) => void
}

/** Measure the fixed menu position for a trigger rect. */
export function positionAgentAccessMenu(rect: { left: number; top: number; width: number }, measuredHeight: number, viewport: { width: number; height: number }) {
  const width = Math.min(MENU_WIDTH, viewport.width - MENU_EDGE * 2)
  return {
    width,
    left: Math.max(MENU_EDGE, Math.min(rect.left, viewport.width - width - MENU_EDGE)),
    top: Math.max(MENU_EDGE, rect.top - (measuredHeight || MENU_FALLBACK_HEIGHT) - MENU_GAP),
  }
}

export function AgentAccessMenu({ mode, anchor, menuRef, onSelect }: AgentAccessMenuProps) {
  return (
    <div
      ref={menuRef}
      className="quickforge-agent-access-menu"
      role="menu"
      aria-label={t('agentAccessMenuLabel')}
      style={anchor
        ? { left: `${anchor.left}px`, top: `${anchor.top}px`, width: `${anchor.width}px` }
        : // First frame before measurement: render off-screen so the menu can be
          // measured without flashing at the wrong place.
          { left: '-9999px', top: '-9999px', width: `${MENU_WIDTH}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {(['default', 'full-access'] as const).map((itemMode) => {
        const selected = itemMode === mode
        return (
          <button
            key={itemMode}
            type="button"
            className="quickforge-agent-access-item"
            role="menuitemradio"
            aria-checked={selected}
            data-quickforge-agent-access-mode={itemMode}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSelect(itemMode)
            }}
          >
            <span className="quickforge-agent-access-check-slot">{selected ? <AccessCheckIcon /> : null}</span>
            <span className="quickforge-agent-access-option-icon-wrap">
              {itemMode === 'full-access' ? <WarningIcon /> : <ShieldIcon />}
            </span>
            <span className="quickforge-agent-access-item-label">{agentAccessLabel(itemMode)}</span>
          </button>
        )
      })}
    </div>
  )
}

export type PlanModeTriggerProps = {
  planMode: boolean
  onToggle: () => void
}

export function PlanModeTrigger({ planMode, onToggle }: PlanModeTriggerProps) {
  const title = t('planModeEnabledTitle')
  const toggle = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onToggle()
  }
  return (
    <button
      type="button"
      className="quickforge-plan-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground"
      title={title}
      aria-label={title}
      aria-pressed={planMode}
      onPointerDown={toggle}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        toggle(event)
      }}
    >
      {/* Both glyphs are always rendered: CSS reveals one or the other on
          hover / focus / pressed, which is how the decoration's `patchContent`
          pair behaved. */}
      <svg className="quickforge-plan-mode-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h1" /><path d="M4 12h1" /><path d="M4 18h1" /><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" />
      </svg>
      <svg className="quickforge-plan-remove-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
      </svg>
      <span>{t('planModeLabel')}</span>
    </button>
  )
}
