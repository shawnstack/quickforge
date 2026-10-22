import { useEffect, useState } from 'react'
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
 * TodoWrite capsule above the composer, previously injected by
 * `panel-decoration/todo-write-summary.ts`.
 *
 * The decoration maintained the subtree by hand: it created the ring/stats/
 * chevron once and then mutated `textContent`, `hidden`, `style` and
 * `dataset` in place so the CSS capsule morph and the progress arc could
 * animate between snapshots. React renders the same structure, and the
 * animation contract survives because the element types and keys are stable —
 * the DOM nodes are reused across renders exactly like the hand-written
 * "create once, mutate after" path did.
 *
 * Four behaviours are stateful and therefore explicit here:
 * - the capsule starts expanded, and a new snapshot round re-expands it (the
 *   list is the point of the capsule while a round is running);
 * - a new (non-first) snapshot briefly shows the "updated" marker;
 * - a cleanly finished round leaves the composer once the agent is idle
 *   (`retiredKey`), after one exit fade so the dock does not jump;
 * - an explicit empty snapshot / rollback resets everything.
 *
 * The snapshot itself arrives pre-resolved (`{snapshot, key} | null`): the
 * surface derives it once per agent snapshot and caches it by message-array
 * identity. Scanning the message list backwards here — which this component
 * used to do inside `useMemo` — made every composer re-render an O(messages)
 * walk, and the composer re-rendered on every keystroke before the input state
 * moved into `composer-store.ts`.
 */

const RING_CIRCUMFERENCE = 2 * Math.PI * 9
const UPDATED_MARKER_DURATION_MS = 1800
/** Matches `--quickforge-dur-exit`: the leave transition, then unmount. */
const RETIRE_DURATION_MS = 140

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

export function TodoWriteSummary({ snapshot, idle }: TodoWriteSummaryProps) {
  const latest = snapshot
  const todos = latest?.snapshot.todos ?? []
  const counts = todoWriteCounts(todos)
  const complete = counts.total > 0 && counts.completed === counts.total
  const snapshotKey = latest?.key ?? ''

  const [trackedKey, setTrackedKey] = useState('')
  const [expanded, setExpanded] = useState(true)
  const [updatedKey, setUpdatedKey] = useState<string | null>(null)
  // The snapshot key whose capsule has already left. Keying the retirement (and
  // not a bare boolean) is what makes a new round come back for free: a new
  // snapshot has a new key, so it is never "retired" on arrival.
  const [retiredKey, setRetiredKey] = useState<string | null>(null)

  // Adjust state during render (React's documented "derive from props" path):
  // a new snapshot round re-expands the capsule and arms the "updated" marker.
  // Doing it here instead of in an effect avoids a second render pass with a
  // stale snapshot visible.
  if (trackedKey !== snapshotKey) {
    setTrackedKey(snapshotKey)
    // Every new snapshot (including an explicit clear) starts expanded.
    setExpanded(true)
    // The first snapshot of a session is not an "update".
    setUpdatedKey(!snapshotKey || todos.length === 0 || trackedKey === '' ? null : snapshotKey)
  }

  // The marker is a timed announcement: clear it after the display window. The
  // effect only touches state from the timer callback, never synchronously.
  useEffect(() => {
    if (updatedKey === null) return undefined
    const timer = setTimeout(() => setUpdatedKey(null), UPDATED_MARKER_DURATION_MS)
    return () => clearTimeout(timer)
  }, [updatedKey])

  // Finished list + idle agent ⇒ leave the composer. `fading` is derived, not
  // stored: the exit attribute is on from the first commit, the CSS exit
  // transition runs against the previously rendered opacity, and the effect only
  // schedules the unmount once that transition is over.
  //
  // `retired` is keyed by snapshot and sticky: once this snapshot's list has left,
  // it stays gone. Without the stickiness the next user message (which flips
  // `idle` back to false) re-armed `shouldRetire` as false and the finished list
  // flashed back in for the duration of the round. A new `todo_write` produces a
  // new key, which is what brings the capsule back.
  const shouldRetire = shouldRetireTodoSummary({ todos, idle })
  const retired = snapshotKey !== '' && retiredKey === snapshotKey
  const fading = shouldRetire && !retired

  useEffect(() => {
    if (!fading) return undefined
    const timer = setTimeout(() => setRetiredKey(snapshotKey), RETIRE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [fading, snapshotKey])

  if (todos.length === 0) return null
  if (retired) return null

  const progress = counts.total > 0 ? counts.completed / counts.total : 0
  const ringOffset = (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2)

  return (
    <section
      className="quickforge-todo-summary"
      aria-label={t('todoWriteTitle')}
      data-expanded={String(expanded)}
      data-complete={String(complete)}
      data-running={String(counts.inProgress > 0)}
      data-fading={String(fading)}
      inert={fading ? true : undefined}
    >
      <div className="quickforge-todo-summary-toggle-row">
        <button
          type="button"
          className="quickforge-todo-summary-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
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
          <span className="quickforge-todo-summary-heading">{t('todoWriteTitle')}</span>
          <span className="quickforge-todo-summary-stats">{t('todoWriteStats', counts)}</span>
          <span className="quickforge-todo-summary-stats-compact" aria-hidden="true">{`${counts.completed}/${counts.total}`}</span>
          {/* Always rendered, hidden via the `hidden` attribute: the marker is a
              live region, and removing it would drop the announcement. */}
          <span className="quickforge-todo-summary-updated" aria-live="polite" hidden={updatedKey === null}>
            {t('todoWriteUpdated')}
          </span>
          <span className="quickforge-todo-summary-spacer" aria-hidden="true" />
          <span className="quickforge-todo-summary-chevron">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </button>
      </div>
      <div className="quickforge-todo-summary-body" hidden={!expanded}>
        <div className="quickforge-todo-summary-body-inner">
          {/* The body is just the list. No per-status tally and no "working on"
              restatement: each row already carries its own status (icon, colour,
              weight), and the running row is the highlighted one. */}
          <ul className="quickforge-todo-summary-list">
            {todos.map((todo: TodoWriteItem, index) => (
              <li
                key={`${index}:${todo.content}`}
                className={`quickforge-todo-summary-item quickforge-todo-summary-item--${todo.status}`}
              >
                <span className="quickforge-todo-summary-status-icon">
                  <TodoStatusIcon status={todo.status} />
                </span>
                <span className="quickforge-todo-summary-content">{todo.content}</span>
                <span className="quickforge-todo-summary-status-label">{todoStatusLabel(todo.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
