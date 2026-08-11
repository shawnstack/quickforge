/**
 * Windowed message rendering for very long conversations.
 *
 * The chat message list is rendered by the third-party `message-list` web
 * component (from @earendil-works/pi-web-ui), which builds the DOM for the
 * whole `messages` array with no paging or virtualization. Very long
 * conversations (hundreds of tool-heavy messages) therefore become expensive
 * to render and scroll.
 *
 * This module installs a thin wrapper around the `message-list` element's
 * `messages` property setter: full message arrays keep flowing in exactly as
 * before (SSE `state` events, `/state` snapshots, streaming updates), but only
 * the most recent window (a tail slice measured in *turns*) is actually
 * handed to the element. When the user scrolls to the top, earlier turns are
 * loaded incrementally (see ChatPanelHost + scroll-sync `onReachTop`).
 *
 * A "turn" is one user message plus everything that follows it up to (not
 * including) the next user message — the assistant reply and any tool calls /
 * results in between. Small conversations bypass windowing; it is enabled when
 * the history exceeds the turn, message-count, or approximate content-size
 * thresholds below.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core'

/** Conversations with at most this many turns render exactly as before. */
export const WINDOW_ENABLE_TURNS = 6
/** Message-heavy conversations window even when they contain few user turns. */
export const WINDOW_ENABLE_MESSAGES = 48
/** Approximate content characters before a short-turn conversation is windowed. */
export const WINDOW_ENABLE_CONTENT_CHARS = 80_000
/** How many recent turns are rendered by default. */
export const WINDOW_TURNS = 3
/** How many older turns are loaded each time the user scrolls to the top. */
export const WINDOW_PAGE_TURNS = 3

type MessageWindowOptions = {
  /** Disable windowing and pass the complete message array through unchanged. */
  enabled?: boolean
  enableTurns?: number
  enableMessages?: number
  enableContentChars?: number
  windowTurns?: number
  pageTurns?: number
}

export type MessageWindowController = {
  /** Feed the full message array; returns the array that should be assigned to <message-list>. */
  setFullMessages(messages: AgentMessage[]): AgentMessage[]
  /** Full-array index of the first rendered message (used to offset rollback/retry indices). */
  getWindowStart(): number
  /** The window array currently assigned to <message-list> (turn slice + required toolResults). */
  getWindowMessages(): AgentMessage[]
  /** Whether windowing is active for the current conversation. */
  isEnabled(): boolean
  /** Whether earlier turns exist that can still be loaded. */
  hasMore(): boolean
  /** Extend the window one page of turns back; returns the new window array (or null when nothing to load). */
  loadMore(): AgentMessage[] | null
  /** Move the rendered window so the turn containing the full-array message index is visible. */
  showMessageIndex(messageIndex: number): AgentMessage[] | null
  /** Un-pin the window so it follows the tail again (e.g. user scrolled back to the bottom). */
  resetToTail(): void
  /** True when the argument is exactly the window array this controller last assigned. */
  isAssignedWindow(messages: AgentMessage[]): boolean
}

type ToolCallChunk = { type?: string; id?: string }

function isUserTurn(message: AgentMessage) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

/** Index of every user turn start within the full message array. */
function collectTurnStarts(messages: AgentMessage[]): number[] {
  const starts: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (isUserTurn(messages[i])) starts.push(i)
  }
  return starts
}

function approximateContentChars(value: unknown, limit: number): number {
  if (typeof value === 'string') return Math.min(value.length, limit)
  if (!Array.isArray(value)) return 0

  let chars = 0
  for (const chunk of value) {
    if (chars >= limit) break
    if (typeof chunk === 'string') {
      chars += Math.min(chunk.length, limit - chars)
      continue
    }
    if (!chunk || typeof chunk !== 'object') continue
    const record = chunk as Record<string, unknown>
    for (const field of ['text', 'content', 'arguments']) {
      const fieldValue = record[field]
      if (typeof fieldValue !== 'string') continue
      chars += Math.min(fieldValue.length, limit - chars)
      if (chars >= limit) break
    }
  }
  return chars
}

function exceedsContentThreshold(messages: AgentMessage[], threshold: number): boolean {
  let chars = 0
  for (const message of messages) {
    chars += approximateContentChars((message as { content?: unknown }).content, threshold - chars)
    if (chars >= threshold) return true
  }
  return false
}

function collectToolCallIds(message: AgentMessage, into: Set<string>) {
  if (message.role !== 'assistant') return
  const content = Array.isArray(message.content) ? message.content : []
  for (const chunk of content) {
    if (!chunk || typeof chunk !== 'object') continue
    const call = chunk as ToolCallChunk
    if (call.type !== 'toolCall' || !call.id) continue
    into.add(call.id)
  }
}

/**
 * Turn slice plus any toolResults referenced by assistant messages inside the
 * slice. Turn boundaries cut between turns, so this normally never triggers;
 * it is kept as a defensive measure for out-of-order data. ToolResults are not
 * rendered themselves (they are shown inline via `toolCallId` lookup), so
 * appending extras at the end is safe — every consumer either filters them out
 * or only matches them by id.
 */
function buildWindow(messages: AgentMessage[], start: number, end: number): AgentMessage[] {
  const slice = messages.slice(start, end)

  const neededIds = new Set<string>()
  for (let i = start; i < end; i++) collectToolCallIds(messages[i], neededIds)
  if (neededIds.size === 0) return slice

  const extras: AgentMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    if (i >= start && i < end) continue
    const message = messages[i]
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string' && neededIds.has(message.toolCallId)) {
      extras.push(message)
    }
  }
  return extras.length > 0 ? [...slice, ...extras] : slice
}

export function createMessageWindow(options: MessageWindowOptions = {}): MessageWindowController {
  const windowingEnabled = options.enabled ?? true
  const enableTurns = options.enableTurns ?? WINDOW_ENABLE_TURNS
  const enableMessages = options.enableMessages ?? WINDOW_ENABLE_MESSAGES
  const enableContentChars = options.enableContentChars ?? WINDOW_ENABLE_CONTENT_CHARS
  const windowTurns = options.windowTurns ?? WINDOW_TURNS
  const pageTurns = options.pageTurns ?? WINDOW_PAGE_TURNS

  let allMessages: AgentMessage[] = []
  let turnStarts: number[] = []
  let activeWindowTurns = windowTurns
  let startOrdinal = 0
  let windowStart = 0
  let windowMessages: AgentMessage[] = []
  let pinned = false
  let enabled = false

  const tailOrdinal = (turnCount: number) => Math.max(0, turnCount - activeWindowTurns)

  const rebuild = () => {
    // Window covers exactly `windowTurns` turns, starting at the first turn
    // of the window (`startOrdinal` = index into `turnStarts`). If the window
    // reaches all the way back to the first turn, include any leading
    // non-user messages (artifacts etc.) from index 0.
    const start = startOrdinal === 0 ? 0 : turnStarts[startOrdinal]
    const endOrdinal = Math.min(turnStarts.length, startOrdinal + activeWindowTurns)
    const end = endOrdinal < turnStarts.length ? turnStarts[endOrdinal] : allMessages.length
    windowStart = start
    windowMessages = buildWindow(allMessages, start, end)
  }

  return {
    setFullMessages(messages) {
      allMessages = messages
      turnStarts = collectTurnStarts(messages)
      const turnCount = turnStarts.length
      activeWindowTurns = Math.min(windowTurns, Math.max(1, turnCount - 1))
      enabled = windowingEnabled && turnCount > 1 && (turnCount > enableTurns
        || messages.length > enableMessages
        || exceedsContentThreshold(messages, enableContentChars))
      if (!enabled) {
        startOrdinal = 0
        windowStart = 0
        windowMessages = messages
        pinned = false
        return messages
      }
      if (!pinned) {
        startOrdinal = tailOrdinal(turnCount)
      } else {
        // Keep the pinned position, but clamp if the history shrank (rollback / compaction).
        startOrdinal = Math.max(0, Math.min(startOrdinal, tailOrdinal(turnCount)))
      }
      rebuild()
      return windowMessages
    },

    getWindowStart() {
      return windowStart
    },

    getWindowMessages() {
      return windowMessages
    },

    isEnabled() {
      return enabled
    },

    hasMore() {
      return enabled && startOrdinal > 0
    },

    loadMore() {
      if (!enabled || startOrdinal <= 0) return null
      pinned = true
      startOrdinal = Math.max(0, startOrdinal - pageTurns)
      rebuild()
      return windowMessages
    },

    showMessageIndex(messageIndex) {
      if (!enabled || turnStarts.length === 0) return null
      const clampedIndex = Math.max(0, Math.min(messageIndex, allMessages.length - 1))
      let targetOrdinal = 0
      for (let ordinal = 0; ordinal < turnStarts.length; ordinal++) {
        if (turnStarts[ordinal] > clampedIndex) break
        targetOrdinal = ordinal
      }

      const currentEndOrdinal = Math.min(turnStarts.length, startOrdinal + activeWindowTurns)
      if (targetOrdinal >= startOrdinal && targetOrdinal < currentEndOrdinal) return windowMessages

      pinned = true
      startOrdinal = Math.min(targetOrdinal, tailOrdinal(turnStarts.length))
      rebuild()
      return windowMessages
    },

    resetToTail() {
      pinned = false
    },

    isAssignedWindow(messages) {
      return messages === windowMessages
    },
  }
}

// ---------------------------------------------------------------------------
// <message-list> messages setter interception
// ---------------------------------------------------------------------------

type MessageListElementLike = HTMLElement & { messages: AgentMessage[] }

let patched = false
let activeWindow: MessageWindowController | null = null

function messageListPrototype(): { prototype: Record<string, unknown> } | null {
  const ctor = customElements.get('message-list')
  return ctor ? (ctor as unknown as { prototype: Record<string, unknown> }) : null
}

/**
 * Install (once, globally) a wrapper around `message-list`'s `messages`
 * setter. Every assignment — from AgentInterface rendering, SSE state events,
 * HTTP snapshots — goes through the active window controller. Sub-agent
 * process message lists opt out via the `data-quickforge-subagent-process`
 * attribute so their rendering is untouched.
 */
export function installMessageListWindow(getWindow: () => MessageWindowController | null) {
  activeWindow = getWindow()
  if (patched) return

  const tryInstall = () => {
    const proto = messageListPrototype()
    if (!proto) return false
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'messages')
    if (!descriptor || typeof descriptor.set !== 'function') return false

    patched = true
    const nativeSet = descriptor.set
    Object.defineProperty(proto, 'messages', {
      ...descriptor,
      set(this: MessageListElementLike, value: AgentMessage[]) {
        const window = activeWindow
        const isSubagentList = this.hasAttribute('data-quickforge-subagent-process')
        if (window && !isSubagentList) {
          if (window.isAssignedWindow(value)) {
            // Internal re-assignment (loadMore): pass straight through.
            nativeSet.call(this, value)
            return
          }
          nativeSet.call(this, window.setFullMessages(value))
          return
        }
        nativeSet.call(this, value)
      },
    })
    return true
  }

  if (!tryInstall()) {
    void customElements.whenDefined('message-list').then(() => {
      tryInstall()
    })
  }
}

export function uninstallMessageListWindow(window: MessageWindowController) {
  if (activeWindow === window) activeWindow = null
}
