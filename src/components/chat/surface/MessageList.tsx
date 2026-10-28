/* eslint-disable react-refresh/only-export-components -- exports the MessageList component plus the pure toolResult collection helper covered by tests. */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { AgentMessage, AgentTool, AssistantMessage as AssistantMessageType, ToolResultMessage } from './ChatTypes'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { isRenderableMessage, messageRenderKeys } from './content-parts'
import { ContextCompactionNotice, type CompactionBoundary, type CompactionMarker } from './ContextCompactionNotice'
import { ContextCompactionStatusRow } from './ContextCompactionStatusRow'
import { ContextCompactionDecisionRow } from './ContextCompactionDecisionRow'
import { AssistantWaitingBubble } from './AssistantWaitingBubble'
import { t } from '@/lib/i18n'
import type { ServerAgentCompactionNotice } from '@/lib/server-agent'

/**
 * React replacement for the legacy `<message-list>` component.
 *
 * Build rules (aligned with the legacy `<message-list>` implementation):
 * - `artifact` messages are skipped (session persistence only, no UI).
 * - `toolResult` message bodies are not rendered standalone; they are
 *   collected into a `toolCallId → result` map and inlined into the assistant
 *   message that issued the tool call.
 * - `user` / `user-with-attachments` render as `UserMessage`.
 * - `assistant` renders as `AssistantMessage`. Pending tool calls stay
 *   rendered in the list — before, during and after `message_end` — so a
 *   long-running tool row (spinner) keeps its DOM node across the streaming
 *   transition.
 * - the streaming assistant partial (when the caller provides one) renders as
 *   the list's last row, keyed by the same `messageRenderIdentity` the
 *   committed row will use: `message_end` swaps the row from streaming to
 *   committed **in place** (same key ⇒ React reuses the DOM subtree) instead
 *   of migrating the message between two React subtrees — the old unmount/
 *   remount dropped the thinking-block disclosure state, restarted code
 *   highlights and moved every folded process node twice. Pending tool calls
 *   stay hidden on the streaming row (the committed rows own them), matching
 *   the previous split.
 *   Two structural rules make that hand-off a true fiber reuse:
 *   1. committed rows and the streaming tail row live in ONE keyed `rows`
 *      array — React matches keyed siblings within a single array, while a
 *      streaming row rendered as a sibling JSX slot after `items.map(...)`
 *      lands in its own reconcile scope (an implicit index-keyed child) and
 *      remounts on commit even with a matching key;
 *   2. the row element type never changes across the hand-off — the streaming
 *      gate provider lives *inside* `AssistantMessage` (a wrapper element that
 *      vanishes at `message_end` would remount the whole row just the same).
 *   The key array covers the streaming row too, so `messageRenderKeys`'s
 *   occurrence suffix keeps a same-identity duplicate (not produced by the
 *   agent loop) collision-free and identical between the two states.
 *
 * Rows are keyed by message identity (`content-parts#messageRenderKeys`), not by
 * their visible index: a sliding window must drop the leading row instead of
 * re-keying every row to a different message (which re-rendered every Markdown
 * subtree on each commit).
 */

type MessageListProps = {
  messages: AgentMessage[]
  messageIndexOffset?: number
  tools?: AgentTool[]
  pendingToolCalls?: ReadonlySet<string>
  /**
   * Streaming assistant partial, rendered as the list's last row. `undefined`
   * (or a non-assistant body) renders nothing extra: the caller decides when
   * the surface is at the tail and streaming, this component only renders.
   */
  streamingAssistant?: AssistantMessageType
  onCostClick?: () => void
  /** Show the persist-degraded warning as the list's first child. */
  persistDegraded?: boolean
  /**
   * Context-compaction divider positions (see `resolveCompactionMarkers`): one
   * divider per compaction, anchored to the moment it ran. Empty/absent means
   * no divider is rendered.
   */
  compactionMarkers?: CompactionMarker[]
  /**
   * Single-divider form, kept for callers that only have the legacy
   * one-record payload (and for the boundary tests). `compactionMarkers` wins
   * when both are supplied.
   */
  compactionBoundary?: CompactionBoundary
  /**
   * Assistant-waiting bubble position (see `resolveAssistantWaitingRow`):
   * the row index it renders before, or `-1` when hidden.
   */
  assistantWaitingRow?: number
  /**
   * In-flight compaction phase (`state.compactionNotice`). Rendered as the list's
   * trailing child: the summarization runs inside the current turn, so the row
   * belongs after everything produced so far. Absent/null renders nothing.
   */
  compactionNotice?: ServerAgentCompactionNotice | null
  /** Callbacks for the blocking compaction decision row (approval id is bound by the list). */
  onApproveCompaction?: (approvalId: string) => void
  onRejectCompaction?: (approvalId: string) => void
  compactionDecisionReadOnly?: boolean
  compactionDecisionDisabledReason?: string
  compactionApprovePending?: boolean
  compactionRejectPending?: boolean
}

/** Build the toolCallId → toolResult lookup used for inline rendering. */
export function collectToolResultsById(messages: AgentMessage[]): Map<string, ToolResultMessage> {
  const resultByCallId = new Map<string, ToolResultMessage>()
  for (const message of messages) {
    if (message.role === 'toolResult') {
      resultByCallId.set(message.toolCallId, message)
    }
  }
  return resultByCallId
}

/** Messages the list renders standalone (artifact/toolResult are excluded). */
type RenderableMessage = Extract<AgentMessage, { role: 'user' | 'user-with-attachments' | 'assistant' }>

export function MessageList({ messages, messageIndexOffset = 0, tools, pendingToolCalls, streamingAssistant, onCostClick, persistDegraded = false, compactionBoundary, compactionMarkers, assistantWaitingRow, compactionNotice = null, onApproveCompaction, onRejectCompaction, compactionDecisionReadOnly = false, compactionDecisionDisabledReason, compactionApprovePending = false, compactionRejectPending = false }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const elements = listRef.current?.querySelectorAll<HTMLElement>(':scope > .qf-user-message, :scope > .qf-assistant-message')
    let ordinal = 0
    messages.forEach((message, index) => {
      if (message.role !== 'user' && message.role !== 'user-with-attachments' && message.role !== 'assistant') return
      const element = elements?.[ordinal++]
      if (element) element.dataset.messageIndex = String(messageIndexOffset + index)
    })
  }, [messages, messageIndexOffset])
  // Memoized on `messages` (R1 F1b): a fresh Map per render would defeat the
  // memoized AssistantMessage rows below on every list re-render (streaming
  // events re-render this list via MessageArea's streamingAssistant prop).
  // With R1 F1a the messages identity only changes when content changed.
  const toolResultsById = useMemo(() => collectToolResultsById(messages), [messages])

  // Keep original indices before filtering lookup-only toolResults/artifacts.
  const items = messages.map((message, index) => ({ message, index })).filter((item): item is { message: RenderableMessage; index: number } => {
    const { message } = item
    // Skip artifact messages (session persistence only) and standalone
    // toolResult bodies (rendered inline in the paired assistant message).
    return isRenderableMessage(message)
  })
  // Identity keys stay aligned with the original array indices (items keep
  // them). The key array covers the streaming tail row too (index
  // `messages.length`): keys are computed over one combined array, so the
  // streaming row and the committed row it becomes at `message_end` always
  // receive the same key, and `messageRenderKeys`'s occurrence suffix keeps a
  // same-identity duplicate (same-timestamp collision, not produced by the
  // agent loop) unique within the pass.
  const renderKeys = messageRenderKeys(streamingAssistant ? [...messages, streamingAssistant] : messages)

  // Committed rows and the streaming tail row share ONE keyed array (see the
  // header comment): this is the exact sibling list React reconciles, so the
  // `message_end` hand-off matches the tail row by key and updates it in
  // place. The streaming row is appended here (not after the sibling assembly)
  // so the divider/bubble index arithmetic sees the full row list.
  const rows = items.map(({ message, index }) => {
    const key = renderKeys[index]
    if (message.role === 'user' || message.role === 'user-with-attachments') {
      return <UserMessage key={key} message={message} />
    }
    return (
      <AssistantMessage
        key={key}
        message={message}
        tools={tools}
        isStreaming={false}
        pendingToolCalls={pendingToolCalls}
        toolResultsById={toolResultsById}
        onCostClick={onCostClick}
      />
    )
  })
  if (streamingAssistant) {
    rows.push(
      // Same identity the committed row will use, so `message_end` commits the
      // row in place instead of remounting it (see the header comment).
      <AssistantMessage
        key={renderKeys[messages.length]}
        message={streamingAssistant}
        tools={tools}
        isStreaming
        pendingToolCalls={pendingToolCalls}
        toolResultsById={toolResultsById}
        hidePendingToolCalls
        onCostClick={onCostClick}
      />,
    )
  }

  // The compaction divider and the waiting bubble are keyed siblings inserted at
  // a position counted over the MESSAGE rows. Build the final child array in one
  // forward pass: two successive `splice` calls made the second index stale
  // (inserting the divider shifts every later position by one), so a divider
  // above the waiting row pushed the bubble one row too far.
  // One divider per compaction (rolling compaction appends a record each time),
  // keyed by its immutable physical position so each line keeps its own
  // disclosure state and never moves again.
  const markers: CompactionMarker[] = compactionMarkers && compactionMarkers.length > 0
    ? compactionMarkers
    : compactionBoundary?.kind === 'at'
      ? [{
        rowIndex: compactionBoundary.rowIndex,
        boundaryIndex: compactionBoundary.boundaryIndex,
        occurredAtIndex: compactionBoundary.boundaryIndex,
        summaryText: compactionBoundary.summaryText,
        isLatest: true,
      }]
      : []
  const markersByRow = new Map<number, CompactionMarker[]>()
  for (const marker of markers) {
    // Clamp to the row count: a compaction that just ran belongs at the bottom
    // edge of the list, not dropped.
    const row = Math.min(marker.rowIndex, rows.length)
    const bucket = markersByRow.get(row)
    if (bucket) bucket.push(marker)
    else markersByRow.set(row, [marker])
  }
  const waitingRow = assistantWaitingRow !== undefined && assistantWaitingRow >= 0
    ? Math.min(assistantWaitingRow, rows.length)
    : Number.POSITIVE_INFINITY

  const children: ReactNode[] = []
  for (let index = 0; index <= rows.length; index++) {
    // The dividers belong to the history flow, so at an equal index they are
    // emitted before the bubble.
    const rowMarkers = markersByRow.get(index)
    if (rowMarkers) {
      for (const marker of rowMarkers) {
        children.push(
          <ContextCompactionNotice
            key={`quickforge-context-compaction-${marker.occurredAtIndex}`}
            summaryText={marker.summaryText}
            boundaryIndex={marker.boundaryIndex}
            compactedAt={marker.compactedAt}
            mergedIntoLater={!marker.isLatest}
          />,
        )
      }
    }
    // The waiting bubble sits immediately after the last user row, i.e. after the
    // divider when both land on the same position.
    if (index === waitingRow) {
      children.push(<AssistantWaitingBubble key="quickforge-assistant-waiting" />)
    }
    if (index < rows.length) children.push(rows[index])
  }

  // Compaction UI is the list's trailing content, after every message row: the
  // summarization/decision happens inside the turn the user is watching, so the
  // row belongs where the run is, not anchored to an earlier boundary. Both
  // components return null when idle, which keeps the child sequence identical
  // to the pre-existing markup in the common case.
  const compactionTrailing = compactionNotice ? (
    <>
      <ContextCompactionDecisionRow
        key="quickforge-context-compaction-decision"
        notice={compactionNotice}
        readOnly={compactionDecisionReadOnly}
        disabledReason={compactionDecisionDisabledReason}
        approvePending={compactionApprovePending}
        rejectPending={compactionRejectPending}
        // Bind the approval id here, where the notice is in scope: the callbacks
        // stay id-less in the prop chain so nothing downstream has to re-derive
        // which approval the visible row belongs to.
        onApprove={onApproveCompaction && compactionNotice.approvalId
          ? () => onApproveCompaction(compactionNotice.approvalId as string)
          : undefined}
        onReject={onRejectCompaction && compactionNotice.approvalId
          ? () => onRejectCompaction(compactionNotice.approvalId as string)
          : undefined}
      />
      <ContextCompactionStatusRow key="quickforge-context-compaction-status" notice={compactionNotice} />
    </>
  ) : null

  return (
    <div ref={listRef} className="qf-message-list flex flex-col gap-3" data-window-start={messageIndexOffset}>
      {/*
        Authoritative persist was skipped after CAS conflicts. Rendered here (as
        the list's first child, matching where the `persist-degraded-notice`
        decoration used to prepend it) so React owns the node and clears it
        automatically once a persist succeeds.
      */}
      {persistDegraded ? (
        <div className="quickforge-persist-degraded-notice" role="alert">
          <span className="quickforge-persist-degraded-dot" aria-hidden="true" />
          <span className="quickforge-persist-degraded-text">{t('persistDegradedWarning')}</span>
        </div>
      ) : null}
      {children}
      {compactionTrailing}
    </div>
  )
}
