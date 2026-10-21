/**
 * Keep-alive policy for session views.
 *
 * ## Why this exists
 *
 * Switching sessions used to destroy the whole chat subtree: React threw away
 * every fiber (a ~600-message conversation is ~10k DOM nodes) and rebuilt it
 * from scratch, then re-parsed all history Markdown. Browser measurements on
 * this repo (2026-10-21) put the cost of one small→large switch at 10 long
 * tasks / 2360ms cumulative blocking / 854ms max, dominated by fiber creation
 * for the incoming rows.
 *
 * Keeping the rendered subtree alive lets React reconcile row by row instead of
 * mounting a fresh tree; everything content-derived (Markdown trees, highlighted
 * code, KaTeX, Mermaid SVG) is already covered by `render-cache.ts`.
 *
 * ## What this policy deliberately does NOT do
 *
 * `MAX_IDLE_AGENT_TASKS` stays 0: a resident `ServerAgent` holds that session's
 * full message list (tool results and diffs reach the MB range), and keeping ~7
 * of them was explicitly rejected. A kept-alive *view* holds a rendered subtree
 * instead — a different and much smaller kind of memory — but it is still
 * bounded here so the pool cannot grow into the situation that decision avoided.
 *
 * This module is pure and deterministic so the admission rules can be tested
 * without a DOM: it only answers "given these views, which ones stay mounted".
 */

/** One pooled view: a session's chat subtree that may stay mounted but hidden. */
export type SessionViewEntry = {
  /** Stable identity of the view (the runtime scope id of its agent). */
  key: string
  /**
   * Relative cost of keeping this view alive.
   *
   * Callers pass an approximation (rendered row count) rather than an exact DOM
   * node count: measuring `querySelectorAll('*')` on a 10k-node subtree costs a
   * full traversal on every switch, and only the ratio between views matters.
   */
  weight: number
  /** Monotonic access stamp; larger is more recent. */
  lastAccessedAt: number
}

export type SessionViewPoolOptions = {
  /**
   * How many *inactive* views stay mounted alongside the active one.
   *
   * 1 covers the dominant workflow (flip back and forth between two sessions)
   * at the lowest memory cost. Each extra slot pins a full rendered history, so
   * this is deliberately small rather than "a few".
   */
  maxInactive?: number
  /**
   * Total weight budget for the whole pool, active view included, measured in
   * rendered rows. Two ~600-row conversations fit; two 1500-row ones do not, in
   * which case the pool degrades to keeping only the active view — identical to
   * today's behaviour for those sessions.
   */
  weightBudget?: number
}

export const DEFAULT_MAX_INACTIVE_VIEWS = 1
export const DEFAULT_VIEW_WEIGHT_BUDGET = 1500

export function resolvePoolOptions(options: SessionViewPoolOptions = {}) {
  const maxInactive = options.maxInactive ?? DEFAULT_MAX_INACTIVE_VIEWS
  const weightBudget = options.weightBudget ?? DEFAULT_VIEW_WEIGHT_BUDGET
  return {
    maxInactive: Math.max(0, Math.floor(maxInactive)),
    weightBudget: Math.max(0, Math.floor(weightBudget)),
  }
}

/**
 * Select the views to keep mounted.
 *
 * The active view is always kept — it is on screen. Inactive views are admitted
 * by recency, subject to both the slot count and the weight budget. The active
 * view is charged against the budget too, so a single huge conversation may
 * leave no room for a second one.
 *
 * Returned keys are ordered least-recently-used first, which is the mount order
 * that keeps React's sibling reconciliation stable across renders.
 */
export function selectSessionViews(
  entries: readonly SessionViewEntry[],
  activeKey: string | null,
  options: SessionViewPoolOptions = {},
): string[] {
  const { maxInactive, weightBudget } = resolvePoolOptions(options)
  const active = entries.find((entry) => entry.key === activeKey) ?? null

  const candidates = entries
    .filter((entry) => entry.key !== activeKey)
    .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)

  const kept: SessionViewEntry[] = active ? [active] : []
  let used = active?.weight ?? 0
  let admitted = 0
  for (const candidate of candidates) {
    if (admitted >= maxInactive) break
    // `continue`, not `break`: an oversized recent view must not starve a
    // cheaper older one, otherwise a single giant conversation would disable
    // keep-alive for every other session.
    if (used + candidate.weight > weightBudget) continue
    kept.push(candidate)
    used += candidate.weight
    admitted += 1
  }

  return kept
    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)
    .map((entry) => entry.key)
}

/**
 * Stamp a view as just accessed.
 *
 * `stamp` is injected so callers (and tests) control the clock; the pool only
 * needs a total order, not real time.
 */
export function touchSessionView(
  entries: readonly SessionViewEntry[],
  key: string,
  weight: number,
  stamp: number,
): SessionViewEntry[] {
  const existing = entries.find((entry) => entry.key === key)
  if (!existing) return [...entries, { key, weight, lastAccessedAt: stamp }]
  return entries.map((entry) => (
    entry.key === key ? { key, weight, lastAccessedAt: stamp } : entry
  ))
}

/** Drop everything the policy did not keep. */
export function pruneSessionViews(
  entries: readonly SessionViewEntry[],
  activeKey: string | null,
  options: SessionViewPoolOptions = {},
): SessionViewEntry[] {
  const keep = new Set(selectSessionViews(entries, activeKey, options))
  return entries.filter((entry) => keep.has(entry.key))
}
