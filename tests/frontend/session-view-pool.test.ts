import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_INACTIVE_VIEWS,
  DEFAULT_VIEW_WEIGHT_BUDGET,
  pruneSessionViews,
  resolvePoolOptions,
  selectSessionViews,
  touchSessionView,
  type SessionViewEntry,
} from '../../src/lib/session-view-pool'

function entry(key: string, weight: number, lastAccessedAt: number): SessionViewEntry {
  return { key, weight, lastAccessedAt }
}

describe('session view pool policy', () => {
  it('keeps the active view plus one inactive view by default', () => {
    expect(DEFAULT_MAX_INACTIVE_VIEWS).toBe(1)
    const entries = [entry('a', 100, 1), entry('b', 100, 2), entry('c', 100, 3)]
    // `b` is the most recent inactive view; `a` is dropped.
    expect(selectSessionViews(entries, 'c')).toEqual(['b', 'c'])
  })

  it('always keeps the active view even when it alone exceeds the budget', () => {
    const entries = [entry('huge', 50000, 1), entry('small', 100, 2)]
    // The active view is charged against the budget first, so an oversized
    // active view leaves no room and the pool degrades to today's behaviour
    // (only the active view mounted). Crucially it never evicts the active view
    // itself — that would unmount the panel the user is looking at.
    expect(selectSessionViews(entries, 'huge')).toEqual(['huge'])
  })

  it('rejects an inactive view that does not fit the budget', () => {
    const entries = [entry('active', 1400, 1), entry('large', 200, 2)]
    expect(DEFAULT_VIEW_WEIGHT_BUDGET).toBe(1500)
    expect(selectSessionViews(entries, 'active')).toEqual(['active'])
  })

  it('admits a cheaper view after skipping an oversized one', () => {
    const entries = [
      entry('active', 1400, 1),
      entry('recent-huge', 900, 3),
      entry('older-small', 50, 2),
    ]
    // `continue` (not `break`): an oversized recent view must not starve a
    // cheaper older one, otherwise one giant conversation would disable
    // keep-alive for every other session.
    expect(selectSessionViews(entries, 'active')).toEqual(['active', 'older-small'])
  })

  it('orders output least-recently-used first for stable reconciliation', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 5), entry('c', 10, 3)]
    expect(selectSessionViews(entries, 'b', { maxInactive: 2 })).toEqual(['a', 'c', 'b'])
  })

  it('honours a zero inactive budget', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 2)]
    expect(selectSessionViews(entries, 'b', { maxInactive: 0 })).toEqual(['b'])
  })

  it('returns nothing when there is no active view and no budget for inactive ones', () => {
    const entries = [entry('a', 10, 1)]
    expect(selectSessionViews(entries, null, { maxInactive: 0 })).toEqual([])
  })

  it('normalises invalid options', () => {
    expect(resolvePoolOptions({ maxInactive: -3, weightBudget: -1 })).toEqual({ maxInactive: 0, weightBudget: 0 })
    expect(resolvePoolOptions({ maxInactive: 2.7 })).toEqual({ maxInactive: 2, weightBudget: DEFAULT_VIEW_WEIGHT_BUDGET })
  })

  it('touches existing entries in place and appends new ones', () => {
    const entries = [entry('a', 10, 1)]
    const touched = touchSessionView(entries, 'a', 20, 9)
    expect(touched).toEqual([entry('a', 20, 9)])
    const added = touchSessionView(touched, 'b', 30, 10)
    expect(added).toEqual([entry('a', 20, 9), entry('b', 30, 10)])
  })

  it('prunes to the selected set', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 2), entry('c', 10, 3)]
    expect(pruneSessionViews(entries, 'c')).toEqual([entry('b', 10, 2), entry('c', 10, 3)])
  })
})
