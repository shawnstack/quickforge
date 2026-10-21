import { describe, expect, it, beforeEach } from 'vitest'

import {
  markSessionOpen,
  readSessionOpenTiming,
  recordFirstDecorateTiming,
  resetSessionOpenTimings,
} from '../../src/lib/session-open-timing'

describe('session open timing marks', () => {
  beforeEach(() => {
    resetSessionOpenTimings()
  })

  it('records a full click → ready timeline', () => {
    markSessionOpen('session-a', 'click')
    markSessionOpen('session-a', 'load-start')
    markSessionOpen('session-a', 'first-paint')
    markSessionOpen('session-a', 'ready')

    const timing = readSessionOpenTiming('session-a')
    expect(timing.clickToReadyMs).toBeTypeOf('number')
    expect(timing.clickToReadyMs).toBeGreaterThanOrEqual(0)
    expect(timing.clickToFirstPaintMs).toBeGreaterThanOrEqual(0)
    expect(timing.loadToReadyMs).toBeGreaterThanOrEqual(0)
  })

  it('keeps the first mark when a phase is reported twice', () => {
    markSessionOpen('session-b', 'click')
    const before = readSessionOpenTiming('session-b')
    markSessionOpen('session-b', 'click')
    const after = readSessionOpenTiming('session-b')

    expect(after).toEqual(before)
  })

  it('returns an empty report for unknown sessions', () => {
    expect(readSessionOpenTiming('missing')).toEqual({})
  })

  it('ignores empty session ids', () => {
    markSessionOpen('', 'click')
    expect(readSessionOpenTiming('')).toEqual({})
  })

  it('reports only the phases that were recorded', () => {
    markSessionOpen('session-c', 'click')
    markSessionOpen('session-c', 'ready')

    const timing = readSessionOpenTiming('session-c')
    expect(timing.clickToReadyMs).toBeTypeOf('number')
    // 没有 load-start / first-paint 时不编造数值。
    expect(timing.loadToReadyMs).toBeUndefined()
    expect(timing.clickToFirstPaintMs).toBeUndefined()
  })

  it('records the first decorate pass once and ignores later ones', () => {
    // 首轮装饰决定按钮/折叠何时可用，属于打开会话的用户感知成本；流式期的后续
    // 装饰是常规开销，混入会掩盖真实数字。
    markSessionOpen('session-d', 'click')
    recordFirstDecorateTiming('session-d', 42.34)
    recordFirstDecorateTiming('session-d', 999)

    expect(readSessionOpenTiming('session-d').firstDecorateMs).toBe(42.3)
  })

  it('ignores decorate timings for sessions without a record', () => {
    recordFirstDecorateTiming('never-opened', 10)
    expect(readSessionOpenTiming('never-opened')).toEqual({})
  })
})
