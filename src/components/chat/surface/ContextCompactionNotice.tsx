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

/** Compaction state as published on the server agent (`state.contextCompaction`). */
export type ContextCompactionState = {
  compactedUpToIndex?: number
  summaryMessage?: unknown
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

export function ContextCompactionNotice({ summaryText, boundaryIndex }: { summaryText: string; boundaryIndex: number }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
  }, [])

  const tooltip = t('contextCompactedTooltip')
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
  } as const

  if (!summaryText) {
    return (
      <div {...noticeProps}>
        <div className="quickforge-context-compaction-summary" role="separator">
          <div className="quickforge-context-compaction-line" />
          <div className="quickforge-context-compaction-pill">
            <span className="quickforge-context-compaction-dot" aria-hidden="true" />
            <span>
              <strong>{t('contextCompactedLabel')}</strong> · {t('contextCompactedTimelineLabel')}
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
              <strong>{t('contextCompactedLabel')}</strong> · {t('contextCompactedTimelineLabel')} · <span className="quickforge-context-compaction-toggle-label">{toggleLabel}</span>
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
