/* eslint-disable react-refresh/only-export-components -- exports the MessageList component plus the pure toolResult collection helper covered by tests. */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { AgentMessage, AgentTool, AssistantMessage as AssistantMessageType, ToolResultMessage } from './ChatTypes'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { isRenderableMessage, messageRenderKeys } from './content-parts'

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

export function MessageList({ messages, messageIndexOffset = 0, tools, pendingToolCalls, streamingAssistant, onCostClick }: MessageListProps) {
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
  // place.
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

  return (
    <div ref={listRef} className="qf-message-list flex flex-col gap-3" data-window-start={messageIndexOffset}>
      {rows}
    </div>
  )
}
