import { useEffect, useState } from 'react'
import { t } from '@/lib/i18n'
import {
  isFinalTodoSnapshot,
  todoWriteCounts,
  type TodoWriteItem,
  type TodoWriteSnapshot,
  type TodoWriteStatus,
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
 * Two behaviours are stateful and therefore explicit here:
 * - a new snapshot round auto-collapses a fully completed list;
 * - a new (non-first) snapshot briefly shows the "updated" marker.
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

function StatusIcon({ status }: { status: TodoWriteStatus }) {
  if (status === 'completed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function statusLabel(status: TodoWriteStatus) {
  if (status === 'completed') return t('todoWriteStatusCompleted')
  if (status === 'in_progress') return t('todoWriteStatusInProgress')
  return t('todoWriteStatusPending')
}

export function TodoWriteSummary({ snapshot }: { snapshot: { snapshot: TodoWriteSnapshot; key: string } | null }) {
  const latest = snapshot
  const todos = latest?.snapshot.todos ?? []
  const counts = todoWriteCounts(todos)
  const complete = counts.total > 0 && counts.completed === counts.total
  const snapshotKey = latest?.key ?? ''

  const [trackedKey, setTrackedKey] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [updatedKey, setUpdatedKey] = useState<string | null>(null)

  // Adjust state during render (React's documented "derive from props" path):
  // a new snapshot round resets/collapses the capsule and arms the "updated"
  // marker. Doing it here instead of in an effect avoids a second render pass
  // with a stale snapshot visible.
  if (trackedKey !== snapshotKey) {
    setTrackedKey(snapshotKey)
    if (!snapshotKey || todos.length === 0) {
      // An explicit empty (or absent) snapshot resets the capsule entirely: the
      // old controller dropped the subtree and cleared the user's expanded
      // state, so a later snapshot starts collapsed.
      setExpanded(false)
      setUpdatedKey(null)
    } else {
      const isFirstSnapshot = trackedKey === ''
      // Every fully completed round collapses, including the first one.
      if (isFinalTodoSnapshot(todos)) setExpanded(false)
      // The first snapshot of a session is not an "update".
      setUpdatedKey(isFirstSnapshot ? null : snapshotKey)
    }
  }

  // The marker is a timed announcement: clear it after the display window. The
  // effect only touches state from the timer callback, never synchronously.
  useEffect(() => {
    if (updatedKey === null) return undefined
    const timer = setTimeout(() => setUpdatedKey(null), UPDATED_MARKER_DURATION_MS)
    return () => clearTimeout(timer)
  }, [updatedKey])

  if (todos.length === 0) return null

  const progress = counts.total > 0 ? counts.completed / counts.total : 0
  const ringOffset = (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2)

  return (
    <section
      className="quickforge-todo-summary"
      aria-label={t('todoWriteTitle')}
      data-expanded={String(expanded)}
      data-complete={String(complete)}
      data-running={String(counts.inProgress > 0)}
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
          <ul className="quickforge-todo-summary-list">
            {todos.map((todo: TodoWriteItem, index) => (
              <li
                key={`${index}:${todo.content}`}
                className={`quickforge-todo-summary-item quickforge-todo-summary-item--${todo.status}`}
              >
                <span className="quickforge-todo-summary-status-icon">
                  <StatusIcon status={todo.status} />
                </span>
                <span className="quickforge-todo-summary-content">{todo.content}</span>
                <span className="quickforge-todo-summary-status-label">{statusLabel(todo.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
