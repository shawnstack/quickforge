/* eslint-disable react-refresh/only-export-components -- exports the notice component plus the pure boundary/summary helpers covered by tests. */
import { useEffect, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { assistantText, copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import type { AgentMessage } from './ChatTypes'

/**
 * 压缩分割线（方案 B：它是一条真实消息的渲染结果，不是拼接出来的节点）。
 *
 * 位置由消息在数组里的下标决定 —— 这里只负责“这一行长什么样”：横线 + pill +
 * 可展开的摘要卡。类名与 DOM 保持与装饰层时代像素一致，
 * `src/styles/chat/context-compaction.css` 直接复用。
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

export function readCompactionSummaryText(summaryMessage: unknown): string {
  const message = summaryMessage as AgentMessage | undefined
  if (!message) return ''
  const rawText = message.role === 'assistant'
    ? assistantText(message)
    : draftTextFromUserMessage(message)
  const match = rawText.match(/<compact_summary>\s*([\s\S]*?)\s*<\/compact_summary>/i)
  return (match?.[1] ?? rawText).trim()
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
