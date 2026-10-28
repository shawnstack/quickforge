/** Pure turn-based window controller; React owns rendering and scroll state. */
import type { AgentMessage } from './surface/ChatTypes'

/** Conversations with at most this many turns render exactly as before. */
export const WINDOW_ENABLE_TURNS = 6
/** Message-heavy conversations window even when they contain few user turns. */
export const WINDOW_ENABLE_MESSAGES = 48
/** Approximate content characters before a short-turn conversation is windowed. */
export const WINDOW_ENABLE_CONTENT_CHARS = 80_000
/** Initial window width: how many recent turns are rendered before paging. */
export const WINDOW_TURNS = 3
/**
 * How many older turns are added each time the user scrolls to the top.
 *
 * `loadMore` WIDENS the window (start moves back, end stays put). Sliding the
 * whole window forward instead would unmount every rendered row, which breaks
 * the scroll anchor and lands the viewport at the bottom of the swapped page.
 */
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
  /**
   * Feed the full message array; returns the window array to render.
   *
   * `followTail` (default true) says whether the reader is at the tail: it only
   * decides whether a paged window keeps tracking the tail on its right edge.
   */
  setFullMessages(messages: AgentMessage[], followTail?: boolean): AgentMessage[]
  /** Full-array index of the first rendered message (used to offset rollback/retry indices). */
  getWindowStart(): number
  /** The window array currently rendered by `MessageList` (turn slice + required toolResults). */
  getWindowMessages(): AgentMessage[]
  /** Whether windowing is active for the current conversation. */
  isEnabled(): boolean
  /** Whether earlier turns exist that can still be loaded. */
  hasMore(): boolean
  /**
   * Whether the rendered window IS the tail window (no older turns paged in).
   *
   * Distinct from "the newest turn is inside the window": while following the
   * tail every window contains the newest turn, and so does a window that has
   * paged nine turns of history back in. Callers that need to know whether
   * anything would be dropped by re-slicing must ask this, not `atTail`.
   */
  isAtTail(): boolean
  /** Extend the window one page of turns back; returns the new window array (or null when nothing to load). */
  loadMore(): AgentMessage[] | null
  /** Whether newer turns exist beyond the window's right edge. */
  hasMoreNewer(): boolean
  /**
   * Extend the window one page FORWARD; returns the new window array (or null).
   *
   * The mirror of `loadMore`: content is appended below the viewport, so no
   * scroll compensation is needed. Without this, a window that was moved back to
   * an early turn would simply end there and the reader could not scroll through
   * the conversation that follows.
   */
  loadNewer(): AgentMessage[] | null
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
  /**
   * Exclusive end ordinal of the rendered window.
   *
   * Held as state (not derived as `startOrdinal + activeWindowTurns`) because
   * `loadMore` must WIDEN the window: extending the start while the end slides
   * along with it replaced every rendered row with an older page, which dropped
   * the row the user was reading from the DOM, made anchor resolution fail, and
   * left the viewport parked at the bottom of the freshly swapped page — the
   * "I scroll up and get thrown back down" feel.
   */
  let endOrdinal = 0
  let windowStart = 0
  let windowMessages: AgentMessage[] = []
  let pinned = false
  let enabled = false

  const tailOrdinal = (turnCount: number) => Math.max(0, turnCount - activeWindowTurns)

  /** Same rows in the same order — used to keep the array identity stable. */
  const sameRows = (a: AgentMessage[], b: AgentMessage[]) => {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  const rebuild = () => {
    // Window covers turns [startOrdinal, endOrdinal). If it reaches all the way
    // back to the first turn, include any leading non-user messages (artifacts
    // etc.) from index 0.
    const start = startOrdinal === 0 ? 0 : turnStarts[startOrdinal]
    const end = endOrdinal < turnStarts.length ? turnStarts[endOrdinal] : allMessages.length
    const next = buildWindow(allMessages, start, end)
    // Keep the previous identity when the window did not move: `ChatSurface` and
    // `MessageList` both bail out on identity, so re-slicing an unchanged window
    // would re-render every row (and re-run the decoration pass) for nothing.
    if (windowStart === start && sameRows(next, windowMessages)) return
    windowStart = start
    windowMessages = next
  }

  return {
    setFullMessages(messages, followTail = true) {
      // Whether the window's right edge already reached the tail BEFORE this
      // update. Only then may it keep following: a window that was moved back to
      // an early turn must not jump to the tail on the next snapshot (that both
      // mounts the whole conversation at once and yanks the viewport to the
      // bottom). Scrolling forward is what advances it, one page at a time
      // (`loadNewer`).
      const wasAtEnd = endOrdinal >= turnStarts.length
      allMessages = messages
      turnStarts = collectTurnStarts(messages)
      const turnCount = turnStarts.length
      activeWindowTurns = Math.min(windowTurns, Math.max(1, turnCount - 1))
      enabled = windowingEnabled && turnCount > 1 && (turnCount > enableTurns
        || messages.length > enableMessages
        || exceedsContentThreshold(messages, enableContentChars))
      if (!enabled) {
        startOrdinal = 0
        endOrdinal = turnCount
        windowStart = 0
        windowMessages = messages
        pinned = false
        return messages
      }
      if (!pinned) {
        startOrdinal = tailOrdinal(turnCount)
        endOrdinal = turnCount
      } else {
        // Keep the pinned position, but clamp if the history shrank (rollback / compaction).
        startOrdinal = Math.max(0, Math.min(startOrdinal, tailOrdinal(turnCount)))
        // Follow the tail only when the window was already at it AND the reader is
        // following. Extending during streaming would otherwise re-render every
        // row of a large window on every token, and moving an early window to the
        // tail would replace the content under the viewport.
        endOrdinal = wasAtEnd && followTail
          ? turnCount
          : Math.max(startOrdinal + 1, Math.min(endOrdinal, turnCount))
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

    hasMoreNewer() {
      return enabled && endOrdinal < turnStarts.length
    },

    isAtTail() {
      // A disabled window renders the whole array, so it is always "at tail".
      return !enabled || startOrdinal >= tailOrdinal(turnStarts.length)
    },

    loadMore() {
      if (!enabled || startOrdinal <= 0) return null
      pinned = true
      startOrdinal = Math.max(0, startOrdinal - pageTurns)
      rebuild()
      return windowMessages
    },

    loadNewer() {
      if (!enabled || endOrdinal >= turnStarts.length) return null
      // Appended below the viewport: no anchor needed, the reader keeps their
      // position and scrolls into the newly mounted turns.
      endOrdinal = Math.min(turnStarts.length, endOrdinal + pageTurns)
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

      const currentEndOrdinal = Math.min(turnStarts.length, endOrdinal)
      if (targetOrdinal >= startOrdinal && targetOrdinal < currentEndOrdinal) return windowMessages

      pinned = true
      // A jump gets a fixed-width window around its target, so "jump to turn 3 of
      // 50" does not mount 3..50. The reader scrolls forward page by page from
      // there (`loadNewer`).
      startOrdinal = Math.min(targetOrdinal, tailOrdinal(turnStarts.length))
      endOrdinal = Math.min(turnStarts.length, startOrdinal + activeWindowTurns)
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

