/**
 * Single writer for the chat scroll container's `scrollTop`.
 *
 * Before this module the position was written from four places (surface anchor
 * restore, surface tail pin, scroll-sync follow, scroll-to-bottom button) with
 * three different formulas. The one that caused the reported bug was the
 * fallback: when the reading anchor could not be resolved, the caller wrote
 * "old scrollTop + height delta" — a formula that silently degrades to "write
 * the old scrollTop" as soon as the content SHRANK (the delta is clamped to 0).
 * The browser then clamps that stale value to the new maximum, which parks the
 * viewport at the bottom of the freshly evicted window: "I scroll up and get
 * bounced to the bottom".
 *
 * The rule here is deliberately narrow:
 * - `anchor` restores the captured row, clamped to the real range. If the row
 *   is gone, nothing is written at all (`blocked`) — a stale position is never
 *   guessed, because a wrong write is what produces the jump.
 * - `tail` pins to the bottom only when the window's right edge actually covers
 *   the conversation tail (`canFollowTail`). While the rendered window ends
 *   before the last turn, `scrollHeight` is not the end of the conversation and
 *   pinning to it makes "scroll down" skip the unmounted turns.
 */
import { anchoredScrollTop, readScrollAnchor, resolveAnchorRow, type ScrollAnchor } from './scroll-anchor'

export type ScrollIntent =
  /** Keep the reading position: the captured row must stay at the same viewport offset. */
  | { kind: 'anchor'; anchor: ScrollAnchor }
  /** Pin to the bottom; only legal when the window covers the conversation tail. */
  | { kind: 'tail' }
  /** Do not touch the position. */
  | { kind: 'hold' }

export type ScrollOutcome =
  /** Written, and the position was reachable. */
  | 'applied'
  /** Written, but clamped: the requested position no longer exists (content shrank). */
  | 'clamped'
  /** Nothing written: the anchor row is unmounted, the container is missing, or tail-pinning is not allowed. */
  | 'blocked'
  /** Nothing to do: already at the target. */
  | 'noop'

export type ScrollOwnerOptions = {
  getContainer: () => HTMLElement | null
  /** Whether the rendered window's right edge reaches the conversation tail. */
  canFollowTail: () => boolean
}

export type ScrollOwner = {
  capture(): ScrollAnchor | null
  apply(intent: ScrollIntent): ScrollOutcome
}

export function createScrollOwner({ getContainer, canFollowTail }: ScrollOwnerOptions): ScrollOwner {
  const maxScrollTop = (container: HTMLElement) => Math.max(0, container.scrollHeight - container.clientHeight)

  const write = (container: HTMLElement, next: number): ScrollOutcome => {
    const max = maxScrollTop(container)
    const target = Math.max(0, Math.min(next, max))
    container.scrollTop = target
    return target === next ? 'applied' : 'clamped'
  }

  return {
    capture() {
      const container = getContainer()
      if (!container) return null
      // Prefer a real message row: paging rebuilds decoration-owned rows, so a
      // non-message row is not a stable identity across the mutation.
      return readScrollAnchor(container, { requireMessageIndex: true }) ?? readScrollAnchor(container)
    },

    apply(intent) {
      const container = getContainer()
      if (!container) return 'blocked'
      if (intent.kind === 'hold') return 'noop'

      if (intent.kind === 'tail') {
        if (!canFollowTail()) return 'blocked'
        const max = maxScrollTop(container)
        if (Math.abs(container.scrollTop - max) <= 1) return 'noop'
        container.scrollTop = max
        return 'applied'
      }

      const anchor = intent.anchor
      // A captured message index is an absolute identity: if that row is gone
      // the eviction removed it, and the rendered ordinal now points at a
      // DIFFERENT message. Falling back to it would compensate against the
      // wrong row (and every wrong compensation is a visible jump), so an
      // indexed anchor is resolved by index only.
      const list = container.querySelector<HTMLElement>('.qf-message-list')
      const indexedRow = anchor.messageIndex === undefined || !list
        ? null
        : container.querySelector<HTMLElement>(`.qf-message-list > [data-message-index="${anchor.messageIndex}"]`)
      if (anchor.messageIndex !== undefined && !indexedRow) return 'blocked'
      const retained = indexedRow ?? resolveAnchorRow(container, anchor)
      // The row is gone: the eviction removed the row the reader was on. Writing
      // anything here would be a guess, and every guess is a visible jump.
      if (!retained) return 'blocked'
      const next = indexedRow
        ? anchoredScrollTop(container, anchor, { requireMessageIndex: true })
        : anchoredScrollTop(container, anchor)
      // `null` means "the row did not move" — not "no anchor".
      if (next === null) return 'noop'
      return write(container, next)
    },
  }
}
