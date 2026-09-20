/* eslint-disable react-refresh/only-export-components -- exports the MessageList component plus the pure toolResult collection helper covered by tests. */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { AgentMessage, AgentTool, ToolResultMessage } from './ChatTypes'
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
 *   transition; the separate streaming container in `ChatSurface` hides its
 *   own pending rows instead of duplicating them.
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

export function MessageList({ messages, messageIndexOffset = 0, tools, pendingToolCalls, onCostClick }: MessageListProps) {
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
  // Identity keys stay aligned with the original array indices (items keep them).
  const renderKeys = messageRenderKeys(messages)

  return (
    <div ref={listRef} className="qf-message-list flex flex-col gap-3" data-window-start={messageIndexOffset}>
      {items.map(({ message, index }) => {
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
      })}
    </div>
  )
}
