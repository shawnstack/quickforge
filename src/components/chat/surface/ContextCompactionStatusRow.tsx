import { t } from '@/lib/i18n'
import type { ServerAgentCompactionNotice } from '@/lib/server-agent'

/**
 * In-flight compaction row ("整理上下文…").
 *
 * Why this exists
 * ---------------
 * Auto-compaction runs *inside* an active turn: it is an extra summarization LLM
 * call between two model calls, so the run stalls for tens of seconds with no
 * tokens streaming. Before this row existed the panel rendered nothing at all
 * during that window — the waiting bubble stays hidden as soon as the assistant
 * produced any content (see `resolveAssistantWaitingRow`), no text streams, and
 * the only other feedback was a divider that appeared *after* the work finished.
 * The work therefore looked like a hang.
 *
 * Design
 * ------
 * The row is a projection of `state.compactionNotice`:
 * - **impossible to desync** — the server publishes the complete phase on every
 *   enter/exit and `null` means idle, so the surface never has to infer state
 *   from the arrival (or absence) of individual events;
 * - **owned by React inside the message list**, at the position where the work
 *   happens, instead of a decoration-layer node that would need a mutation
 *   observer to stay anchored;
 * - **only the summarizing phase** is rendered here. `awaiting_confirmation` is
 *   `ContextCompactionDecisionRow`'s job (it carries the two actions); rendering
 *   a second copy of the same sentence next to it would just be noise.
 *
 * It returns `null` when idle, so the message list's child sequence is unchanged
 * in the common case and no test-only placeholder is introduced.
 */
export type ContextCompactionStatusRowProps = {
  notice?: ServerAgentCompactionNotice | null
}

export function ContextCompactionStatusRow({ notice }: ContextCompactionStatusRowProps) {
  if (!notice || notice.phase !== 'summarizing') return null

  const percent = Math.round(Number(notice.usage?.percent) || 0)
  const label = t('compactionSummarizingLabel')
  const detail = t('compactionSummarizingDetail')

  return (
    <div
      className="quickforge-context-compaction-status"
      // `status` (not `alert`): expected work in progress, not an error. It must
      // not interrupt a screen reader mid-sentence the way an alert would.
      role="status"
      aria-live="polite"
      aria-label={percent > 0 ? `${label} ${t('compactionSummarizingDetailWithPercent', { percent })}` : `${label} ${detail}`}
      data-compaction-phase={notice.phase}
      data-compaction-percent={String(percent)}
    >
      <span className="quickforge-context-compaction-status-dot" aria-hidden="true" />
      {/* Streaming shimmer on the label, same recipe as the running tool title
          (DESIGN_LANGUAGE "工具运行态流光"): the gradient lives on the text
          itself so it never paints a sliding band over the row, and
          reduced-motion falls back to plain muted text. */}
      <span
        className="quickforge-context-compaction-status-label"
        data-quickforge-compaction-streaming="true"
      >
        {label}
      </span>
      <span className="quickforge-context-compaction-status-detail">{detail}</span>
    </div>
  )
}
