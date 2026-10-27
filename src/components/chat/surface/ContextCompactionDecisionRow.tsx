import { t } from '@/lib/i18n'
import type { ServerAgentCompactionNotice } from '@/lib/server-agent'

/**
 * Blocking compaction decision, rendered inline in the message list.
 *
 * This replaces the decoration-layer approval card
 * (`panel-wiring/approval-cards.ts` → `injectApprovalCard(..., tone: 'info')`)
 * for the compaction case. Three concrete problems went away with the move:
 *
 * 1. **No forced scroll jump.** The card called `scrollIntoView({ behavior:
 *    'smooth' })` whenever it could not anchor to a kept turn boundary, so a user
 *    reading history was yanked to the bottom mid-sentence. A React row inside the
 *    list is never scrolled into view by its own code.
 * 2. **No stale card.** The card lived until a *later* event removed it. When the
 *    server dropped the approval on timeout without emitting anything, the card
 *    stayed clickable and every click returned 404. This row is rendered from
 *    `state.compactionNotice` — the same projection the server clears on every
 *    terminal path — so it disappears in the same frame the approval dies.
 * 3. **No "waiting for you" ambiguity.** The row states both the measured usage
 *    and the threshold, and stays visible while the run is blocked, so it is
 *    obvious the run is waiting on a human rather than on the model.
 *
 * The row is `alert`-free on purpose: the composer is still usable and the
 * blocking nature is already expressed by the run not progressing. `role="group"`
 * with an explicit label keeps it a normal form region for assistive tech.
 */
export type ContextCompactionDecisionRowProps = {
  notice?: ServerAgentCompactionNotice | null
  /** Read-only / Side Chat: render the same notice without actionable buttons. */
  readOnly?: boolean
  disabledReason?: string
  approveDisabled?: boolean
  rejectDisabled?: boolean
  approvePending?: boolean
  rejectPending?: boolean
  onApprove?: () => void
  onReject?: () => void
}

export function ContextCompactionDecisionRow({
  notice,
  readOnly = false,
  disabledReason,
  approveDisabled = false,
  rejectDisabled = false,
  approvePending = false,
  rejectPending = false,
  onApprove,
  onReject,
}: ContextCompactionDecisionRowProps) {
  if (!notice || notice.phase !== 'awaiting_confirmation') return null

  const percent = Math.round(Number(notice.usage?.percent) || 0)
  const threshold = Math.round(Number(notice.thresholdPercent) || 0)
  const title = t('autoCompactApprovalTitle')
  const waiting = t('autoCompactApprovalWaiting', { percent, threshold })
  const description = t('autoCompactApprovalPreview', { keepRecentTurns: notice.keepRecentTurns ?? 0 })
  const disabled = readOnly || approveDisabled || rejectDisabled

  return (
    <div
      className="quickforge-context-compaction-decision"
      role="group"
      aria-label={title}
      data-compaction-phase={notice.phase}
      data-compaction-percent={String(percent)}
      data-compaction-threshold={String(threshold)}
    >
      <div className="quickforge-context-compaction-decision-head">
        <span className="quickforge-context-compaction-decision-status">
          {t('autoCompactApprovalStatus')}
        </span>
        {percent > 0 ? (
          <span className="quickforge-context-compaction-decision-meter" aria-hidden="true">
            <span
              className="quickforge-context-compaction-decision-meter-fill"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </span>
        ) : null}
      </div>
      <p className="quickforge-context-compaction-decision-title">{title}</p>
      <p className="quickforge-context-compaction-decision-waiting">{waiting}</p>
      <p className="quickforge-context-compaction-decision-preview">{description}</p>
      {readOnly ? (
        // Read-only views cannot answer the approval; state why instead of
        // rendering dead buttons (previously `injectApprovalCard` rendered them
        // disabled, which invited clicks that could never work).
        <p className="quickforge-context-compaction-decision-note">
          {disabledReason ?? t('autoCompactApprovalUnavailable')}
        </p>
      ) : (
        <div className="quickforge-context-compaction-decision-actions">
          <button
            type="button"
            className="quickforge-context-compaction-decision-button"
            data-variant="reject"
            disabled={disabled || rejectPending}
            onClick={onReject}
          >
            {t('autoCompactApprovalReject')}
          </button>
          <button
            type="button"
            className="quickforge-context-compaction-decision-button"
            data-variant="approve"
            disabled={disabled || approvePending}
            onClick={onApprove}
          >
            {t('autoCompactApprovalAccept')}
          </button>
        </div>
      )}
    </div>
  )
}
