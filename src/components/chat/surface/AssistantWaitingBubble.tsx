/* eslint-disable react-refresh/only-export-components -- exports the bubble component plus the pure row-resolution helper covered by tests. */
import { t } from '@/lib/i18n'
import type { AgentMessage } from './ChatTypes'
import { assistantText } from '@/lib/message-utils'

/**
 * "Assistant is working" bubble, previously injected by
 * `panel-decoration/assistant-waiting-bubble.ts`.
 *
 * The decoration decided visibility from the DOM: it found the last user row,
 * then asked whether any *rendered* assistant row after it had visible content
 * (querying `.qf-thinking-block` / `.qf-tool-message` / `.qf-markdown-block`,
 * rebuilding a clone with action rows stripped), and re-anchored the bubble
 * after that user row on every pass.
 *
 * React renders the bubble inside the message list now, at the row index
 * `resolveAssistantWaitingRow` returns, and the predicate works on the message
 * array instead of the DOM: the React rows render exactly the content the DOM
 * probe was looking for.
 *
 * `waiting` stays host-owned: it clears on the assistant's `message_start`,
 * which is *earlier* than the first content arriving (see the host comment).
 */

export type AssistantWaitingBubbleProps = {
  messages: readonly AgentMessage[]
  /** Host-owned "still waiting for the first assistant output". */
  waiting: boolean
}

/** True when the assistant message carries any renderable body. */
function assistantHasContent(message: AgentMessage): boolean {
  if (message.role !== 'assistant') return false
  if (assistantText(message as Parameters<typeof assistantText>[0]).trim().length > 0) return true
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return false
  return content.some((part) => {
    if (!part || typeof part !== 'object') return false
    const record = part as { type?: string; thinking?: unknown }
    // A thinking block or a tool call is a visible row inside the assistant
    // bubble, so either one means "output started" — the decoration reached the
    // same conclusion by finding a `.qf-thinking-block` / `.qf-tool-message`
    // outside a process group.
    if (record.type === 'toolCall') return true
    // An empty thinking chunk renders nothing (`content-parts` drops it), so it
    // must not count as output either — otherwise the bubble disappears a frame
    // before anything is visible.
    if (record.type === 'thinking') return typeof record.thinking === 'string' && record.thinking.trim().length > 0
    return false
  })
}

/**
 * Row index the bubble belongs *before* (i.e. right after the last user row), or
 * `-1` when it must not render.
 *
 * `isRenderable` is the same standalone-row predicate `MessageList` renders
 * with, so the index always names a real sibling position. A window starting
 * mid-turn still shows the bubble when its last user row has no assistant
 * output after it (the decoration made the same decision from `displayEntries`).
 *
 * `streaming` is the host's `isStreaming`: the decoration required
 * `isStreaming && isActive`, and keeping that condition means the bubble and the
 * stop button's waiting ring stay in step (the ring is driven by
 * `isStreaming` too).
 */
export function resolveAssistantWaitingRow(options: {
  messages: readonly AgentMessage[]
  waiting: boolean
  streaming?: boolean
  isRenderable: (message: AgentMessage) => boolean
}): number {
  const { messages, waiting, streaming = true, isRenderable } = options
  if (!waiting || !streaming) return -1

  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const role = messages[index]?.role
    if (role === 'user' || role === 'user-with-attachments') {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex < 0) return -1

  for (let index = lastUserIndex + 1; index < messages.length; index++) {
    if (assistantHasContent(messages[index])) return -1
  }

  // The index counts RENDERED rows, not array positions: toolResult and artifact
  // messages get no row of their own (`MessageList` renders them inline or not at
  // all), so an array index would push the bubble past the end of the rows.
  let rowIndex = 0
  for (let index = 0; index < messages.length; index++) {
    if (isRenderable(messages[index])) rowIndex += 1
    // The bubble goes immediately after the last user row.
    if (index === lastUserIndex) return rowIndex
  }
  return rowIndex
}

export function AssistantWaitingBubble() {
  return (
    <div
      className="quickforge-assistant-waiting"
      role="status"
      aria-live="polite"
      aria-label={t('assistantWaitingAriaLabel')}
    >
      <div className="quickforge-assistant-waiting-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}
