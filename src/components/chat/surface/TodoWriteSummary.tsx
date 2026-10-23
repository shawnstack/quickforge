import { useEffect, useId, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { todoStatusLabel } from '@/lib/todo-status'
import { TodoStatusIcon } from '@/lib/todo-status-icon'
import {
  shouldRetireTodoSummary,
  todoWriteCounts,
  type TodoWriteItem,
  type TodoWriteSnapshot,
} from '../panel-decoration/todo-write-summary'

/**
 * TodoWrite capsule above the composer.
 *
 * Collapsed by default: the capsule is only a progress pill (arc + completed/
 * total). Pointing at it — or focusing it with the keyboard — pops the task list
 * up *above* the pill; leaving collapses it again. The popover carries nothing
 * but the tasks: no heading, no stats line, no per-row status word, no "updated"
 * marker. Status is told by the glyph, the colour and the weight, and the status
 * word survives only as screen-reader text.
 *
 * The DOM is intentionally flat (`section > trigger > [pill, popover]`) so the
 * popover is a *descendant* of the pointer target: the pointer can travel from
 * the pill into the card without leaving the subtree, which is what removes the
 * classic "popover closes while I move towards it" flicker. The gap itself
 * belongs to the popover box (`padding-bottom`), so it is part of the hit area.
 *
 * Open/closed is React state, not CSS `:hover`, so `aria-expanded` can never
 * disagree with what is on screen:
 * - `hovered` / `focused` open it for mouse and keyboard;
 * - `pinned` is the click latch, the only way in on touch (no hover) and the
 *   thing Escape clears;
 * - a cleanly finished round leaves the composer once the agent is idle
 *   (`retiredKey`), after one exit fade so the dock does not jump;
 * - an explicit empty snapshot / rollback resets everything.
 *
 * The snapshot itself arrives pre-resolved (`{snapshot, key} | null`): the
 * surface derives it once per agent snapshot and caches it by message-array
 * identity. Scanning the message list backwards here — which this component used
 * to do inside `useMemo` — made every composer re-render an O(messages) walk.
 */

const RING_CIRCUMFERENCE = 2 * Math.PI * 9
/** Matches `--quickforge-dur-exit`: the leave transition, then unmount. */
const RETIRE_DURATION_MS = 140
/**
 * Leave grace before the popover collapses. The popover is a descendant of the
 * pointer target, so this is not needed for gap crossing — it only absorbs a
 * pointer that clips the edge for a frame (and keeps a diagonal path calm).
 */
const HOVER_CLOSE_DELAY_MS = 120

export type TodoWriteSummaryProps = {
  snapshot: { snapshot: TodoWriteSnapshot; key: string } | null
  /**
   * The agent is not streaming right now. This is the retirement trigger, and it
   * is a *state* predicate rather than a one-shot `agent_end`: a finished list
   * must stay hidden after a reload, a session switch or a resume too, and those
   * never deliver an `agent_end`.
   */
  idle: boolean
}

/** `(hover: none)`: touch surfaces cannot hover, so they need the click latch. */
function hoverUnavailable(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: none)').matches
}

export function TodoWriteSummary({ snapshot, idle }: TodoWriteSummaryProps) {
  const latest = snapshot
  const todos = latest?.snapshot.todos ?? []
  const counts = todoWriteCounts(todos)
  const complete = counts.total > 0 && counts.completed === counts.total
  const snapshotKey = latest?.key ?? ''
  const popoverId = `quickforge-todo-popover-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  // Collapsed is the resting state: a new snapshot does not re-expand anything,
  // because the list no longer lives in the composer at all.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  // Set while a pointer press is in flight. A mouse click on the pill also
  // focuses it; without this the popover would latch itself open on a plain
  // click (`focused` stays true after the pointer leaves) instead of closing
  // again. Only keyboard focus opens the popover.
  const pointerDownRef = useRef(false)
  // The snapshot key whose capsule has already left. Keying the retirement (and
  // not a bare boolean) is what makes a new round come back for free: a new
  // snapshot has a new key, so it is never "retired" on arrival.
  const [retiredKey, setRetiredKey] = useState<string | null>(null)
  // The snapshot key whose exit countdown is already running. Retirement is
  // latched per key: once a finished list has been seen while idle, the exit
  // runs to completion even if another round starts inside the exit window.
  // Without the latch, `idle` flipping back to false cancelled the timer and
  // re-armed the capsule at full opacity — with back-to-back rounds (goal
  // continuation, queued messages, background task notifications) the agent can
  // go idle for less than one exit transition, so a fully completed list could
  // live above the composer forever.
  const [retiringKey, setRetiringKey] = useState<string | null>(null)
  // The snapshot key the open flags currently belong to. A cleared snapshot (or a
  // rollback) has to drop them, otherwise the next round would inherit a latched
  // open popover from a list that no longer exists.
  const [trackedOpenKey, setTrackedOpenKey] = useState('')

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }

  // A pending collapse must not survive unmount.
  useEffect(() => clearCloseTimer, [])

  // A cleared / reset snapshot drops every open flag: nothing is left to show, and
  // the next round must not inherit a latched-open popover. Adjusted during render
  // (React's "derive from props" path) rather than in an effect, so no cascading
  // render pass is needed and the component never commits a stale open state.
  if (snapshotKey === '' && trackedOpenKey !== '') {
    setTrackedOpenKey('')
    setPinned(false)
    setHovered(false)
    setFocused(false)
  } else if (snapshotKey !== '' && trackedOpenKey !== snapshotKey) {
    setTrackedOpenKey(snapshotKey)
  }

  const open = todos.length > 0 && (hovered || focused || pinned)

  const scheduleCollapse = () => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setHovered(false)
    }, HOVER_CLOSE_DELAY_MS)
  }

  const closePopover = () => {
    clearCloseTimer()
    setHovered(false)
    setFocused(false)
    setPinned(false)
  }

  // The pill's own click is the pointerless path: on touch (no hover) it latches
  // the list open, and a second tap closes it. On a mouse the popover is already
  // open from hover, so a click must not pin content the pointer is about to
  // leave.
  const handlePillClick = () => {
    if (!hoverUnavailable()) return
    clearCloseTimer()
    setHovered(false)
    setFocused(false)
    setPinned((value) => !value)
  }

  // Finished list + idle agent ⇒ leave the composer. `fading` is derived, not
  // stored: the exit attribute is on from the first commit, the CSS exit
  // transition runs against the previously rendered opacity, and the effect only
  // schedules the unmount once that transition is over.
  //
  // `shouldRetire` alone is not enough to drive the exit: it is a *live*
  // predicate, so the instant another round starts it goes false and the capsule
  // re-arms at full opacity. The latch below makes the first observation of
  // "idle + all completed" for a snapshot irreversible.
  const shouldRetire = shouldRetireTodoSummary({ todos, idle })
  if (shouldRetire && snapshotKey !== '' && retiringKey !== snapshotKey) {
    // Adjust state during render (React's documented "derive from props" path):
    // the latch must be armed in the render that observed it, so the very first
    // commit already carries `data-fading`.
    setRetiringKey(snapshotKey)
  }
  const retired = snapshotKey !== '' && retiredKey === snapshotKey
  const latched = snapshotKey !== '' && retiringKey === snapshotKey
  const fading = (shouldRetire || latched) && !retired

  useEffect(() => {
    if (!fading) return undefined
    const timer = setTimeout(() => setRetiredKey(snapshotKey), RETIRE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [fading, snapshotKey])

  if (todos.length === 0) return null
  if (retired) return null

  const progress = counts.total > 0 ? counts.completed / counts.total : 0
  const ringOffset = (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2)
  const count = `${counts.completed}/${counts.total}`

  return (
    <section
      className="quickforge-todo-summary"
      aria-label={t('todoWriteTitle')}
      data-expanded={String(open)}
      data-complete={String(complete)}
      data-running={String(counts.inProgress > 0)}
      data-fading={String(fading)}
      inert={fading ? true : undefined}
    >
      {/* The pointer/focus target. The popover lives inside it so the pointer can
          travel from the pill into the card without leaving the subtree. */}
      <div
        className="quickforge-todo-summary-trigger"
        onPointerOver={(event) => {
          // Touch taps also emit pointerover but never a matching pointerout, so
          // they go through the click latch instead.
          if (event.pointerType === 'touch') return
          clearCloseTimer()
          setHovered(true)
        }}
        onPointerOut={(event) => {
          if (event.pointerType === 'touch') return
          const next = event.relatedTarget as Node | null
          if (next && event.currentTarget.contains(next)) return
          scheduleCollapse()
        }}
        onPointerDown={() => {
          pointerDownRef.current = true
        }}
        onPointerUp={() => {
          pointerDownRef.current = false
        }}
        onPointerCancel={() => {
          pointerDownRef.current = false
        }}
        onFocus={() => {
          // Clicking the pill focuses it too. Only keyboard focus opens the
          // popover, otherwise a click would latch it open and the popover would
          // stay after the pointer left (hover is the pointer's own signal).
          if (pointerDownRef.current) return
          clearCloseTimer()
          setFocused(true)
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setFocused(false)
        }}
      >
        <button
          type="button"
          className="quickforge-todo-summary-toggle"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={`${t('todoWriteTitle')} ${count}`}
          onClick={handlePillClick}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open) return
            event.stopPropagation()
            closePopover()
          }}
        >
          {/* Style carries only the arc offset so the CSS transition runs from
              the previous value instead of restarting on a rebuilt node. */}
          <span
            className="quickforge-todo-summary-ring"
            aria-hidden="true"
            style={{ '--quickforge-todo-ring-offset': ringOffset } as React.CSSProperties}
          >
            <svg viewBox="0 0 24 24">
              <circle className="quickforge-todo-summary-ring-track" cx="12" cy="12" r="9" />
              <circle className="quickforge-todo-summary-ring-bar" cx="12" cy="12" r="9" transform="rotate(-90 12 12)" />
            </svg>
            <svg className="quickforge-todo-summary-ring-check" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="m8.4 12.4 2.3 2.3 4.9-5.6" />
            </svg>
          </span>
          {/* The count is the whole collapsed state. The list itself is in the
              popover, and the pill's accessible name already carries the tally. */}
          <span className="quickforge-todo-summary-count" aria-hidden="true">{count}</span>
        </button>
        {/* Always mounted and driven by `data-open`: the collapse is a CSS
            transition (opacity + a small downward slide), and the closed state is
            `visibility: hidden` + `pointer-events: none` — it holds nothing
            focusable, so a closed popover cannot be tabbed into. */}
        <div className="quickforge-todo-summary-popover" id={popoverId} data-open={String(open)}>
          <div className="quickforge-todo-summary-popover-card">
            {/* The popover is just the list. No heading, no tally, no "working
                on" restatement: each row carries its own status through icon,
                colour and weight. */}
            <ul className="quickforge-todo-summary-list">
              {todos.map((todo: TodoWriteItem, index) => (
                <li
                  key={`${index}:${todo.content}`}
                  className={`quickforge-todo-summary-item quickforge-todo-summary-item--${todo.status}`}
                >
                  <span className="quickforge-todo-summary-status-icon">
                    <TodoStatusIcon status={todo.status} />
                  </span>
                  {/* Visually hidden, kept for screen readers: the glyph is the
                      only status signal on screen. */}
                  <span className="quickforge-todo-summary-status-label">{todoStatusLabel(todo.status)}</span>
                  <span className="quickforge-todo-summary-content">{todo.content}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
