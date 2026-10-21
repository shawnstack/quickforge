import { Component, type ReactElement, type ReactNode } from 'react'
import { resolvePoolOptions } from '@/lib/session-view-pool'
import { setActiveSessionView } from '@/lib/session-view-activity'

/**
 * Keeps recently visited session views mounted (hidden) so switching back does
 * not rebuild the whole chat subtree.
 *
 * ## Why
 *
 * `ChatPanelHost` used to be keyed by the session's runtime scope, so switching
 * sessions unmounted one ~10k-node subtree and mounted another from scratch.
 * Measured on this repo (2026-10-21): small→large switch = 10 long tasks /
 * 2360ms cumulative blocking / 854ms max, dominated by fiber creation for the
 * incoming rows.
 *
 * `ChatSurface` already updates in place when only the `agent` prop changes
 * (`tests/frontend/chat-surface-agent-swap.test.ts` pins that), so a view that
 * stays mounted reconciles row by row instead of mounting from scratch.
 *
 * ## The active view is untouched
 *
 * The active child is rendered with *exactly* the props the caller passes on
 * every render — no snapshotting, no indirection. Only views that are no longer
 * active get an element captured when they were left, so React can bail out of
 * them (same element ⇒ no re-render of that subtree) and they cost one wrapper
 * div.
 *
 * Keeping the fibers alive does not actually depend on that bailout: React
 * preserves a subtree as long as the element type and key at that position are
 * unchanged, so even a re-render would not remount. The captured element is only
 * there to keep hidden views from doing work on every parent render.
 *
 * ## One wrapper per view, stable position for the view's whole lifetime
 *
 * Each pooled view always renders inside a keyed wrapper; only its `display`
 * flips between `contents` (active) and `none` (kept). That stability is
 * load-bearing twice over:
 *
 * - If the wrapper element or key changed between active and kept, React would
 *   unmount the wrapper and take the preserved subtree with it.
 * - If a view changed position among its siblings, React would move the DOM
 *   node. Slots are therefore kept in insertion order and never rearranged;
 *   only whole slots are removed, oldest first.
 *
 * - Active wrapper `display: contents` introduces no box: the chat panel stays
 *   a direct flex child of the conversation surface, exactly as before.
 * - Kept wrapper `display: none` removes it from layout and from the a11y tree,
 *   and gives it zero width, so its resize observer reports nothing.
 *
 * ## Lifecycle
 *
 * Freezing an element also means its props stop updating, so a kept view cannot
 * observe "I am no longer active" through props. The pool publishes the active
 * key through `session-view-activity`, which views subscribe to directly — that
 * is how a kept panel flushes its composer draft on the way out.
 *
 * ## Why a class
 *
 * The freeze has to happen while the outgoing view is still part of this
 * render's output; anything later and React has already unmounted it. That means
 * the pool's bookkeeping is read and written during `render`, which the hooks
 * rules cannot express without refs-in-render or setState-in-effect. An instance
 * field is exactly the right home for it: it is per-pool, survives renders, and
 * needs no state because the pool is always re-rendered by its parent when the
 * active key changes.
 */
export type SessionViewPoolProps = {
  /** Identity of the view that should be visible. */
  activeKey: string
  /** Element for the active view; used verbatim, never snapshotted. */
  activeView: ReactNode
  /**
   * Relative cost of the active view (rendered row count), for the budget.
   * Only the ratio between views matters, so an approximation is enough.
   */
  activeWeight?: number
  /** How many inactive views may stay mounted (default 1). */
  maxInactive?: number
  /** Total weight budget for the pool, active view included. */
  weightBudget?: number
}

type CapturedView = { key: string; node: ReactNode; weight: number }

export class SessionViewPool extends Component<SessionViewPoolProps> {
  /** Insertion-ordered slot keys. Never reordered while a view is alive. */
  private order: string[] = [this.props.activeKey]
  /** Elements captured when each kept view stopped being active. */
  private kept = new Map<string, CapturedView>()
  /** The active view as of the last render, i.e. what to freeze on a switch. */
  private committed: CapturedView = {
    key: this.props.activeKey,
    node: this.props.activeView,
    weight: this.props.activeWeight ?? 0,
  }

  override componentDidMount(): void {
    setActiveSessionView(this.props.activeKey)
  }

  override componentDidUpdate(previous: SessionViewPoolProps): void {
    if (previous.activeKey !== this.props.activeKey) {
      setActiveSessionView(this.props.activeKey)
    }
  }

  override render(): ReactElement {
    const { activeKey, activeView, activeWeight = 0, maxInactive, weightBudget } = this.props
    this.reconcile(activeKey, activeView, activeWeight, { maxInactive, weightBudget })
    return (
      <>
        {this.order.map((key) => {
          const active = key === activeKey
          return (
            <div
              key={key}
              style={active ? { display: 'contents' } : { display: 'none' }}
              data-quickforge-view={key}
              data-quickforge-view-active={active ? 'true' : 'false'}
            >
              {active ? activeView : this.kept.get(key)?.node}
            </div>
          )
        })}
      </>
    )
  }

  /**
   * Freeze the outgoing view, admit the incoming one, then evict down to policy.
   *
   * Runs during `render` (see the class note above) and is idempotent: calling it
   * twice for the same props leaves the same slot set, so React re-rendering the
   * same props cannot grow the pool.
   */
  private reconcile(
    activeKey: string,
    activeView: ReactNode,
    activeWeight: number,
    options: { maxInactive?: number; weightBudget?: number },
  ): void {
    if (this.committed.key !== activeKey) {
      // Capture the outgoing view before it leaves the output. `this.committed`
      // holds the element from the previous render, so the kept subtree receives
      // an unchanged element and React skips it.
      this.kept.set(this.committed.key, this.committed)
      this.committed = { key: activeKey, node: activeView, weight: activeWeight }
    } else {
      // Still active: refresh so a later switch freezes the freshest element.
      this.committed = { key: activeKey, node: activeView, weight: activeWeight }
    }

    if (!this.order.includes(activeKey)) {
      this.order = [...this.order, activeKey]
    }

    const { maxInactive: slots, weightBudget: budget } = resolvePoolOptions(options)
    // The active view is always kept and is charged against the budget first: a
    // single huge conversation may leave no room for a second one, in which case
    // the pool degrades to exactly today's behaviour for that session.
    const keep = new Set<string>([activeKey])
    let used = Math.max(0, activeWeight)
    for (let index = this.order.length - 1; index >= 0; index -= 1) {
      if (keep.size - 1 >= slots) break
      const key = this.order[index]
      if (key === activeKey) continue
      const weight = this.kept.get(key)?.weight ?? 0
      // `continue`, not `break`: an oversized recent view must not starve a
      // cheaper older one, otherwise one giant conversation would disable
      // keep-alive for every other session.
      if (used + weight > budget) continue
      keep.add(key)
      used += weight
    }

    if (keep.size !== this.order.length) {
      // Dropping whole slots is the only reordering-free way to shrink the pool.
      this.order = this.order.filter((key) => keep.has(key))
      for (const key of [...this.kept.keys()]) {
        if (!keep.has(key)) this.kept.delete(key)
      }
    }
  }
}
