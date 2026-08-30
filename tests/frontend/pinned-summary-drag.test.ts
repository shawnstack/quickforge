import { describe, expect, it } from 'vitest'
import {
  clampPinnedSummaryPosition,
  getPinnedSummaryOutsideAction,
  hasPinnedSummaryDragThreshold,
  shouldSuspendPinnedSummary,
} from '../../src/lib/pinned-summary-drag'

describe('pinned summary drag helpers', () => {
  it('clamps all four viewport edges with the default margin', () => {
    const size = { width: 120, height: 80 }
    const viewport = { width: 800, height: 600 }

    expect(clampPinnedSummaryPosition({ x: -20, y: -30 }, size, viewport)).toEqual({ x: 12, y: 12 })
    expect(clampPinnedSummaryPosition({ x: 900, y: 900 }, size, viewport)).toEqual({ x: 668, y: 508 })
    expect(clampPinnedSummaryPosition({ x: 240, y: 180 }, size, viewport)).toEqual({ x: 240, y: 180 })
  })

  it('uses a stable margin fallback when the viewport is smaller than the widget', () => {
    expect(clampPinnedSummaryPosition(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      { width: 500, height: 400 },
      { width: 240, height: 180 },
    )).toEqual({ x: 12, y: 12 })

    expect(clampPinnedSummaryPosition(
      { x: Number.NEGATIVE_INFINITY, y: -100 },
      { width: Number.NaN, height: Number.POSITIVE_INFINITY },
      { width: Number.NaN, height: -1 },
    )).toEqual({ x: 12, y: 12 })
  })

  it('suspends only for the real desktop Inspector sidebar layout', () => {
    expect(shouldSuspendPinnedSummary({ inspectorOpen: true, desktopInspectorViewport: true, mobileShell: false })).toBe(true)
    expect(shouldSuspendPinnedSummary({ inspectorOpen: false, desktopInspectorViewport: true, mobileShell: false })).toBe(false)
    expect(shouldSuspendPinnedSummary({ inspectorOpen: true, desktopInspectorViewport: false, mobileShell: false })).toBe(false)
    expect(shouldSuspendPinnedSummary({ inspectorOpen: true, desktopInspectorViewport: true, mobileShell: true })).toBe(false)
  })

  it('maps outside presses to desktop panel minimization while keeping capsules resident', () => {
    expect(getPinnedSummaryOutsideAction(true, 'panel')).toBe('minimize')
    expect(getPinnedSummaryOutsideAction(true, 'capsule')).toBe('stay')
    expect(getPinnedSummaryOutsideAction(true, 'closed')).toBe('stay')
    expect(getPinnedSummaryOutsideAction(false, 'panel')).toBe('close')
    expect(getPinnedSummaryOutsideAction(false, 'capsule')).toBe('close')
  })

  it('activates at the four pixel Euclidean drag threshold', () => {
    const start = { x: 10, y: 10 }
    expect(hasPinnedSummaryDragThreshold(start, { x: 13, y: 12 })).toBe(false)
    expect(hasPinnedSummaryDragThreshold(start, { x: 14, y: 10 })).toBe(true)
    expect(hasPinnedSummaryDragThreshold(start, { x: 13, y: 13 })).toBe(true)
  })
})
