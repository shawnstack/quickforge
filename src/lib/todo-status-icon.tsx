import { useId } from 'react'
import type { TodoStatus } from './todo-status'

/**
 * Status glyph shared by the composer capsule, the pinned summary and the
 * `todo_write` history card: hollow circle (pending), half-filled circle (in
 * progress), solid circle with a knocked-out check (completed).
 *
 * The markup carries its own `fill`/`stroke` so it stays colour-free — every
 * caller keeps owning the surface colour through the wrapper class it already
 * had (`.quickforge-todo-summary-item--*`, `.quickforge-todo-history-item--*`,
 * `.quickforge-todo-glyph--*`). The completed variant uses a mask so the check
 * reads on any background; `useId` keeps the mask unique per instance (the
 * history card used a module-level counter, which drifts between render passes).
 */
export function TodoStatusIcon({ status, className }: { status: TodoStatus; className?: string }) {
  const maskId = `quickforge-todo-check-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  if (status === 'completed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
        <mask id={maskId}>
          <rect width="24" height="24" fill="#fff" />
          <path
            d="m8.5 12.2 2.3 2.3 4.7-5"
            fill="none"
            stroke="#000"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
        <circle cx="12" cy="12" r="9" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }

  if (status === 'in_progress') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
