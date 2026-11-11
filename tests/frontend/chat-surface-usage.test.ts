import { describe, expect, it } from 'vitest'
import type { Usage } from '../../src/components/chat/surface/ChatTypes'
import { formatCost, formatTokenCount, formatUsage } from '../../src/components/chat/surface/usage-format'

/**
 * The aggregated stats row under the composer is gone; the per-message usage
 * line still renders, so these helpers keep their formatting contract:
 * `↑10 ↓20 R100 W5 $0.0030`.
 */

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 10,
    output: 20,
    cacheRead: 100,
    cacheWrite: 5,
    totalTokens: 135,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    ...overrides,
  }
}

describe('chat surface usage formatting', () => {
  it('formats usage like the package (tokens + cost)', () => {
    expect(formatUsage(usage())).toBe('↑10 ↓20 R100 W5 $0.0030')
    expect(formatUsage(usage({ cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }))).toBe('↑10 ↓20')
    expect(formatUsage(usage({ input: 1500, output: 25000 }))).toBe('↑1.5k ↓25k R100 W5 $0.0030')
  })

  it('formats token counts with the k suffix thresholds', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(9999)).toBe('10.0k')
    expect(formatTokenCount(10000)).toBe('10k')
    expect(formatTokenCount(800_000)).toBe('800k')
  })

  it('always prints costs with four decimals', () => {
    expect(formatCost(0)).toBe('$0.0000')
    expect(formatCost(0.003)).toBe('$0.0030')
  })
})
