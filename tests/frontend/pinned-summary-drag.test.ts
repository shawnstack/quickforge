import { describe, expect, it } from 'vitest'
import {
  PINNED_SUMMARY_PANEL_MIN_HEIGHT,
  clampPinnedSummaryPosition,
  getPinnedSummaryOutsideAction,
  hasPinnedSummaryDragThreshold,
  resolvePinnedSummaryInitialPosition,
  resolvePinnedSummaryLayout,
  shouldClosePinnedSummaryBeforeInspectorOpen,
  shouldSuspendPinnedSummary,
} from '../../src/lib/pinned-summary-drag'

describe('pinned summary drag helpers', () => {
  it('resolves the first desktop position below and inset from the conversation header', () => {
    expect(resolvePinnedSummaryInitialPosition({
      anchorRect: { bottom: 88.2, right: 1080 },
      fallbackRect: { x: 940, y: 30, right: 1060 },
      targetSize: { width: 320, height: 240 },
    })).toEqual({ x: 748, y: 99 })
  })

  it('uses the provided fallback rect when the conversation header is unavailable', () => {
    expect(resolvePinnedSummaryInitialPosition({
      fallbackRect: { x: 940, y: 30, right: 1060 },
      targetSize: { width: 320, height: 240 },
    })).toEqual({ x: 740, y: 30 })
  })

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

  it('keeps panel top when there is enough space below', () => {
    expect(resolvePinnedSummaryLayout(
      { x: 720, y: 96 },
      { width: 320, height: 360 },
      { width: 1200, height: 800 },
      'panel',
    )).toEqual({ position: { x: 720, y: 96 }, panelMaxHeight: 692 })
  })

  it('limits an over-tall panel without moving its top', () => {
    expect(resolvePinnedSummaryLayout(
      { x: 720, y: 96 },
      { width: 320, height: 1400 },
      { width: 1200, height: 800 },
      'panel',
    )).toEqual({ position: { x: 720, y: 96 }, panelMaxHeight: 692 })
  })

  it('moves an extremely low panel up only enough for the named minimum height', () => {
    expect(resolvePinnedSummaryLayout(
      { x: 720, y: 740 },
      { width: 320, height: 420 },
      { width: 1200, height: 800 },
      'panel',
    )).toEqual({
      position: { x: 720, y: 788 - PINNED_SUMMARY_PANEL_MIN_HEIGHT },
      panelMaxHeight: PINNED_SUMMARY_PANEL_MIN_HEIGHT,
    })
  })

  it('uses the whole safe region when the viewport is shorter than the panel minimum', () => {
    expect(resolvePinnedSummaryLayout(
      { x: 40, y: 170 },
      { width: 320, height: 420 },
      { width: 360, height: 160 },
      'panel',
    )).toEqual({ position: { x: 28, y: 12 }, panelMaxHeight: 136 })
  })

  it('suspends only for the real desktop Inspector sidebar layout', () => {
    expect(shouldSuspendPinnedSummary({ inspectorOpen: true, desktopInspectorViewport: true, mobileShell: false })).toBe(true)
    expect(shouldSuspendPinnedSummary({ inspectorOpen: false, desktopInspectorViewport: true, mobileShell: false })).toBe(false)
    expect(shouldSuspendPinnedSummary({ inspectorOpen: true, desktopInspectorViewport: false, mobileShell: false })).toBe(false)
    expect(shouldSuspendPinnedSummary({ inspectorOpen: true, desktopInspectorViewport: true, mobileShell: true })).toBe(false)
  })

  it('keeps summary state only when the upcoming Inspector layout can suspend it', () => {
    expect(shouldClosePinnedSummaryBeforeInspectorOpen(true)).toBe(false)
    expect(shouldClosePinnedSummaryBeforeInspectorOpen(false)).toBe(true)
  })

  it('keeps desktop outside presses and closes mobile outside presses', () => {
    expect(getPinnedSummaryOutsideAction(true)).toBe('stay')
    expect(getPinnedSummaryOutsideAction(false)).toBe('close')
  })

  it('activates at the four pixel Euclidean drag threshold', () => {
    const start = { x: 10, y: 10 }
    expect(hasPinnedSummaryDragThreshold(start, { x: 13, y: 12 })).toBe(false)
    expect(hasPinnedSummaryDragThreshold(start, { x: 14, y: 10 })).toBe(true)
    expect(hasPinnedSummaryDragThreshold(start, { x: 13, y: 13 })).toBe(true)
  })
})
