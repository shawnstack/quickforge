/* eslint-disable react-refresh/only-export-components -- exports the notice component plus the pure boundary/summary helpers covered by tests. */
import { useEffect, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { assistantText, copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import type { AgentMessage } from './ChatTypes'

/**
 * Context-compaction divider, previously injected by
 * `panel-decoration/context-compaction.ts`.
 *
 * The decoration found-or-created a `<div class="quickforge-context-compaction-notice">`
 * on every pass, rebuilt its `innerHTML` when the summary text changed, bound
 * click/toggle handlers manually, and then had to re-position the node among the
 * message rows by walking the DOM. React renders it now:
 * - the boundary position is an array index in `MessageList` (see
 *   `resolveCompactionBoundary`), so no DOM walking happens;
 * - the `<details>` disclosure is plain component state instead of a
 *   `dataset`-flagged manual listener;
 * - the copy feedback is a timeout-backed state flag instead of
 *   `replaceSvg` + inline style mutation.
 *
 * The class names are unchanged: `src/styles/chat/context-compaction.css` styles this subtree and the
 * layout must stay pixel-identical.
 */

/** One entry in `contextCompaction.history` (see the server-side contract). */
export type ContextCompactionHistoryEntry = {
  compactedAt?: string
  occurredAtIndex?: number
  boundaryIndex?: number
  summaryMessage?: unknown
}

/** Compaction state as published on the server agent (`state.contextCompaction`). */
export type ContextCompactionState = {
  compactedUpToIndex?: number
  summaryMessage?: unknown
  compactedAt?: string
  /**
   * Every compaction this session went through, oldest first. Each one keeps a
   * divider of its own; `compactedUpToIndex` stays as the newest entry's range
   * edge for older payloads and for the context-usage projection.
   */
  history?: ContextCompactionHistoryEntry[]
}

/**
 * 把服务端的**会话绝对**压缩位置换算成本地窗口坐标。
 *
 * `compactedUpToIndex` 与 `history[].occurredAtIndex/boundaryIndex` 都是会话
 * 绝对 seq；消息列表渲染的是从 `messageBaseSeq` 开始的窗口。两者混用会让分割
 * 线落到错误行——窗口起点 > 0 时整条线要么消失（被判为"超过窗口末尾"），
 * 要么贴到窗口顶部。窗口起点为 0 时是恒等变换，旧数据保持不变。
 */
export function shiftCompactionToLocal(
  compaction: ContextCompactionState | null | undefined,
  baseSeq: number,
): ContextCompactionState | null {
  if (!compaction) return null
  if (!Number.isFinite(baseSeq) || baseSeq <= 0) return compaction
  const shift = (value: number | undefined): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value - baseSeq) : value
  )
  return {
    ...compaction,
    compactedUpToIndex: shift(compaction.compactedUpToIndex),
    history: Array.isArray(compaction.history)
      ? compaction.history.map((entry) => ({
          ...entry,
          occurredAtIndex: shift(entry.occurredAtIndex),
          boundaryIndex: shift(entry.boundaryIndex),
        }))
      : compaction.history,
  }
}

/**
 * Extract the human-readable summary body.
 *
 * Historical summaries are wrapped in `<compact_summary>…</compact_summary>`;
 * unwrapped text is used as-is. Both message roles are handled because the
 * summary is stored as an assistant message in current sessions and as a user
 * message in older persisted ones.
 */
export function readCompactionSummaryText(summaryMessage: unknown): string {
  const message = summaryMessage as AgentMessage | undefined
  if (!message) return ''
  const rawText = message.role === 'assistant'
    ? assistantText(message)
    : draftTextFromUserMessage(message)
  const match = rawText.match(/<compact_summary>\s*([\s\S]*?)\s*<\/compact_summary>/i)
  return (match?.[1] ?? rawText).trim()
}

export type CompactionBoundary =
  /** The divider is hidden entirely (no compaction, nothing rendered, or a stale boundary). */
  | { kind: 'hidden' }
  /** Render before the row at `rowIndex` within the rendered message rows. */
  | { kind: 'at'; rowIndex: number; boundaryIndex: number; summaryText: string }

/**
 * Resolve where the divider belongs.
 *
 * `compactedUpToIndex` is absolute in the session's message array, while the
 * list renders a window starting at `messageIndexOffset`. The divider marks the
 * END of the compacted history:
 * - boundary ≤ window start → before the first rendered row;
 * - boundary in the middle → before the first rendered row after it (a boundary
 *   landing on a `toolResult` naturally falls on the next visible message);
 * - boundary at the window end (the latest turn was compacted) → after the last
 *   rendered row. Strictly past the window end can only come from stale state
 *   (messages shrank on rollback) and stays hidden.
 *
 * Counting uses the same "standalone row" predicate `MessageList` renders with,
 * so the index always names a real row.
 */
export function resolveCompactionBoundary(options: {
  compaction: ContextCompactionState | null | undefined
  messages: readonly AgentMessage[]
  messageIndexOffset: number
  isRenderable: (message: AgentMessage) => boolean
}): CompactionBoundary {
  const { compaction, messages, messageIndexOffset, isRenderable } = options
  if (!compaction || messages.length === 0) return { kind: 'hidden' }

  const compactedUpToIndex = Math.max(0, Number(compaction.compactedUpToIndex) || 0)
  const windowEnd = messageIndexOffset + messages.length
  if (compactedUpToIndex <= 0 || compactedUpToIndex > windowEnd) return { kind: 'hidden' }

  const boundaryIndex = Math.max(0, compactedUpToIndex - messageIndexOffset)
  let rowIndex = 0
  for (let index = 0; index < messages.length && index < boundaryIndex; index++) {
    if (isRenderable(messages[index])) rowIndex += 1
  }
  return {
    kind: 'at',
    rowIndex,
    boundaryIndex,
    summaryText: compaction.summaryMessage ? readCompactionSummaryText(compaction.summaryMessage) : '',
  }
}

/**
 * One divider to render.
 *
 * Rolling compaction happens repeatedly during a long session, and each pass
 * only summarizes "previous summary + the delta since the last cut", so every
 * pass deserves its own line at the moment it ran. Two coordinates are kept
 * apart on purpose:
 * - `occurredAtIndex` (absolute) is the messages length at the instant
 *   compaction ran → the physical timeline position, which never moves again;
 * - `boundaryIndex` is the right edge of the summarized range, which sits
 *   several messages earlier whenever recent turns are kept.
 */
export type CompactionMarker = {
  /** Row index within the rendered message rows. */
  rowIndex: number
  /** Range edge, relative to the rendered window. */
  boundaryIndex: number
  /** Physical position, absolute in the session's message array. */
  occurredAtIndex: number
  summaryText: string
  compactedAt?: string
  /** Newest entry: its summary is still the one the model receives. */
  isLatest: boolean
}

function compactionEntries(compaction: ContextCompactionState): ContextCompactionHistoryEntry[] {
  const history = Array.isArray(compaction.history)
    ? compaction.history.filter((entry) => entry && typeof entry === 'object')
    : []
  if (history.length > 0) return history
  // Payloads written before `history` existed: a single record, where the range
  // edge is all the position information there is.
  if (compaction.compactedUpToIndex === undefined && !compaction.summaryMessage) return []
  return [{
    compactedAt: compaction.compactedAt,
    occurredAtIndex: compaction.compactedUpToIndex,
    boundaryIndex: compaction.compactedUpToIndex,
    summaryMessage: compaction.summaryMessage,
  }]
}

/**
 * Resolve every divider position.
 *
 * Unlike `resolveCompactionBoundary` (kept for the single-record shape and its
 * stale-boundary contract), a marker outside the rendered window is **clamped**
 * to the window edge instead of being dropped: a compaction that silently
 * produces no line is the failure mode this list exists to prevent.
 *
 * Clamping is safe because `occurredAtIndex` is immutable — the line never
 * drifts afterwards. A marker above the window lands on the first row, one below
 * lands on the last row, and markers that collapse onto the same row keep only
 * the newest (scrolling up through history would otherwise stack one identical
 * line per past compaction at the window top).
 */
export function resolveCompactionMarkers(options: {
  compaction: ContextCompactionState | null | undefined
  messages: readonly AgentMessage[]
  messageIndexOffset: number
  isRenderable: (message: AgentMessage) => boolean
}): CompactionMarker[] {
  const { compaction, messages, messageIndexOffset, isRenderable } = options
  if (!compaction || messages.length === 0) return []

  const windowStart = messageIndexOffset
  const windowEnd = messageIndexOffset + messages.length
  const entries = compactionEntries(compaction)
  const byRow = new Map<number, CompactionMarker>()
  entries.forEach((entry, entryIndex) => {
    const absolute = Math.max(0, Number(entry.occurredAtIndex ?? entry.boundaryIndex) || 0)
    if (absolute <= 0) return
    const clamped = Math.min(Math.max(absolute, windowStart), windowEnd)
    const boundaryIndex = clamped - windowStart
    let rowIndex = 0
    for (let index = 0; index < messages.length && index < boundaryIndex; index++) {
      if (isRenderable(messages[index])) rowIndex += 1
    }
    byRow.set(rowIndex, {
      rowIndex,
      boundaryIndex,
      occurredAtIndex: absolute,
      summaryText: entry.summaryMessage ? readCompactionSummaryText(entry.summaryMessage) : '',
      compactedAt: entry.compactedAt,
      isLatest: entryIndex === entries.length - 1,
    })
  })
  return [...byRow.values()]
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CopiedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

const COPIED_FEEDBACK_MS = 1200

/** Localized timestamp for the divider tooltip; empty when unparseable. */
function formatCompactionTimestamp(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return ''
  try {
    return new Date(parsed).toLocaleString()
  } catch {
    return ''
  }
}

export function ContextCompactionNotice({ summaryText, boundaryIndex, compactedAt, mergedIntoLater = false }: {
  summaryText: string
  boundaryIndex: number
  /** When this compaction ran (ISO). Shown in the tooltip so the line is datable. */
  compactedAt?: string
  /**
   * Older compaction whose summary was folded into a later one. The line stays
   * where it happened; only the label changes, because the summary it carries is
   * no longer the one the model receives.
   */
  mergedIntoLater?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
  }, [])

  const timestamp = compactedAt ? formatCompactionTimestamp(compactedAt) : ''
  const tooltip = timestamp ? `${t('contextCompactedTooltip')} (${timestamp})` : t('contextCompactedTooltip')
  // `data-*` attributes are part of the decoration's public surface (stylesheet
  // and issue reports read them); keep them supplied by React so they stay
  // truthful without a second writer.
  const noticeProps = {
    className: 'quickforge-context-compaction-notice',
    title: tooltip,
    'aria-label': tooltip,
    'data-boundary-index': String(boundaryIndex),
    'data-summary-text': summaryText,
    'data-has-summary': String(Boolean(summaryText)),
    ...(compactedAt ? { 'data-compacted-at': compactedAt } : {}),
    ...(mergedIntoLater ? { 'data-merged-into-later': 'true' } : {}),
  } as const

  const pillTail = (
    <>
      {mergedIntoLater ? <> · {t('contextCompactedMergedLabel')}</> : null}
    </>
  )

  if (!summaryText) {
    return (
      <div {...noticeProps}>
        <div className="quickforge-context-compaction-summary" role="separator">
          <div className="quickforge-context-compaction-line" />
          <div className="quickforge-context-compaction-pill">
            <span className="quickforge-context-compaction-dot" aria-hidden="true" />
            <span>
              <strong>{t('contextCompactedLabel')}</strong> · {t('contextCompactedTimelineLabel')}
              {pillTail}
            </span>
          </div>
          <div className="quickforge-context-compaction-line" />
        </div>
      </div>
    )
  }

  const copyLabel = t('contextCompactedCopySummary')
  const toggleLabel = open ? t('contextCompactedHideSummary') : t('contextCompactedViewSummary')

  return (
    <div {...noticeProps}>
      {/* `onToggle` instead of a click handler that prevented the native toggle
          and set `details.open` by hand: the boolean stays React state, so the
          toggle label and the disclosure can never disagree. */}
      <details className="quickforge-context-compaction-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="quickforge-context-compaction-summary">
          <div className="quickforge-context-compaction-line" />
          <div className="quickforge-context-compaction-pill">
            <span className="quickforge-context-compaction-dot" aria-hidden="true" />
            <span>
              <strong>{t('contextCompactedLabel')}</strong> · {t('contextCompactedTimelineLabel')}
              {pillTail} · <span className="quickforge-context-compaction-toggle-label">{toggleLabel}</span>
            </span>
          </div>
          <div className="quickforge-context-compaction-line" />
        </summary>
        <div className="quickforge-context-compaction-card">
          <div className="quickforge-context-compaction-card-header">
            <span>{t('contextCompactedSummaryTitle')}</span>
            <button
              type="button"
              className="quickforge-context-compaction-copy"
              data-quickforge-action="copy-compact-summary"
              title={copied ? t('copied') : copyLabel}
              aria-label={copied ? t('copied') : copyLabel}
              // The decoration flipped the icon, the title and a hard-coded
              // green inline color for 1200ms; that timing is the contract.
              style={copied ? { color: 'rgb(5 150 105)' } : undefined}
              onClick={async (event) => {
                event.preventDefault()
                event.stopPropagation()
                await copyTextToClipboard(summaryText)
                setCopied(true)
                if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
                copiedTimerRef.current = setTimeout(() => {
                  copiedTimerRef.current = null
                  setCopied(false)
                }, COPIED_FEEDBACK_MS)
              }}
            >
              {copied ? <CopiedIcon /> : <CopyIcon />}
              <span>{copyLabel}</span>
            </button>
          </div>
          <pre className="quickforge-context-compaction-text">{summaryText}</pre>
        </div>
      </details>
    </div>
  )
}
