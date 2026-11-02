import { describe, expect, it } from 'vitest'
import { DEFAULT_BOUNDS, MIN_VIEW_SIZE, clampBounds, isFiniteRect } from '../../desktop/browser/layout.mjs'

/**
 * 原生视图几何：渲染进程上报的矩形必须被夹进窗口内容区。
 * 这条不变量是「不变现有交互」的保险丝——布局算错时网页会盖住整个应用，
 * 而宿主文件依赖 electron 无法直接单测，所以几何计算单独成模块。
 */
describe('desktop browser view geometry', () => {
  const windowSize = { width: 1200, height: 800 }

  it('keeps a valid rect and rounds sub-pixel values', () => {
    expect(clampBounds({ x: 100.4, y: 60.6, width: 500.2, height: 400.8 }, windowSize))
      .toEqual({ x: 100, y: 61, width: 500, height: 401 })
  })

  it('never lets the view start outside the content area', () => {
    expect(clampBounds({ x: -50, y: -10, width: 300, height: 200 }, windowSize))
      .toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })

  it('keeps the view from spilling past the right or bottom edge', () => {
    expect(clampBounds({ x: 1100, y: 760, width: 900, height: 700 }, windowSize))
      .toEqual({ x: 1080, y: 680, width: 120, height: 120 })
  })

  it('floors tiny rects at the minimum size instead of collapsing', () => {
    expect(clampBounds({ x: 10, y: 10, width: 1, height: 2 }, windowSize))
      .toEqual({ x: 10, y: 10, width: MIN_VIEW_SIZE, height: MIN_VIEW_SIZE })
  })

  it('falls back to the default size when the window size is unknown', () => {
    const rect = clampBounds({ x: 0, y: 0, width: 5000, height: 5000 }, null)
    expect(rect).toEqual({ x: 0, y: 0, width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height })
  })

  it('still works when the window itself is smaller than the minimum', () => {
    expect(clampBounds({ x: 40, y: 40, width: 300, height: 300 }, { width: 50, height: 50 }))
      .toEqual({ x: 0, y: 0, width: MIN_VIEW_SIZE, height: MIN_VIEW_SIZE })
  })

  it('rejects rects with missing or non-finite fields', () => {
    expect(isFiniteRect(null)).toBe(false)
    expect(isFiniteRect(undefined)).toBe(false)
    expect(isFiniteRect({ x: 0, y: 0, width: 10 })).toBe(false)
    expect(isFiniteRect({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBe(false)
    expect(isFiniteRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(true)
  })
})
