// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createThinkingSlider,
  THINKING_SLIDER_LEVELS,
  type ThinkingSliderHandle,
} from '../../src/lib/thinking-slider'
import { THINKING_LEVELS, thinkingLevelLabel } from '../../src/lib/thinking-levels'

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

/**
 * 思考等级控件从「独立小菜单（五个 menuitemradio）」改成「模型弹层底部的滑杆」。
 * 这些用例锁定新的交互契约：
 * - 档位词表不变（服务端同步与持久化都依赖 off/low/medium/high/xhigh）；
 * - 滑杆暴露 `role="slider"` + `aria-valuenow/valuetext`；
 * - 点击轨道按位置跳档，只在档位真正变化时回调；
 * - 方向键 / Home / End 可切换，disabled 时全部失效；
 * - 翻滚数值用「常驻整列 + translateY」实现，不产生重叠节点。
 */
describe('thinking level vocabulary', () => {
  it('keeps the cross-module level vocabulary', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    expect(THINKING_SLIDER_LEVELS).toEqual(THINKING_LEVELS)
  })

  it('resolves labels through i18n', () => {
    expect(thinkingLevelLabel('off')).toBe('thinkingOff')
    expect(thinkingLevelLabel('xhigh')).toBe('thinkingXHigh')
  })
})

describe('thinking slider', () => {
  let host: HTMLDivElement
  let handle: ThinkingSliderHandle | null
  let onChange: ReturnType<typeof vi.fn>
  let observerCallbacks: ResizeObserverCallback[]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    handle = null
    onChange = vi.fn()
    observerCallbacks = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  afterEach(() => {
    handle?.destroy()
    handle = null
    host.remove()
    vi.unstubAllGlobals()
  })

  /** jsdom 无布局：兜底行高 = CSS 的 1.2rem，按 16px 根字号换算。 */
  const FALLBACK_LINE_PX = 1.2 * 16

  function translateFor(index: number, line = FALLBACK_LINE_PX) {
    return `translateY(${(-index * line).toFixed(2)}px)`
  }

  function fireResizeObserver() {
    for (const callback of observerCallbacks) callback([], {} as ResizeObserver)
  }

  function mount(level: 'off' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium', disabled = false) {
    handle = createThinkingSlider({
      level,
      title: 'thinkingLevel',
      labelFor: (value) => thinkingLevelLabel(value),
      disabled,
      onChange: onChange as never,
    })
    host.append(handle.element)
    return handle
  }

  const track = () => host.querySelector<HTMLElement>('.quickforge-model-thinking-track')!
  const knob = () => host.querySelector<HTMLElement>('.quickforge-model-thinking-knob')!

  it('exposes the slider semantics for the current level', () => {
    mount('medium')

    const element = track()
    expect(element.getAttribute('role')).toBe('slider')
    expect(element.getAttribute('aria-valuemin')).toBe('0')
    expect(element.getAttribute('aria-valuemax')).toBe('4')
    expect(element.getAttribute('aria-valuenow')).toBe('2')
    expect(element.getAttribute('aria-valuetext')).toBe('thinkingMedium')
    expect(element.getAttribute('aria-disabled')).toBe('false')
    // 圆圈只有一个，且位于该档位对应的位置。
    expect(host.querySelectorAll('.quickforge-model-thinking-knob')).toHaveLength(1)
    expect(knob().style.left).toBe('50%')
  })

  it('renders one rolling column with all levels, never stacked nodes', () => {
    mount('low')

    const rows = Array.from(host.querySelectorAll('.quickforge-model-thinking-stack > span'))
    expect(rows.map((row) => row.textContent))
      .toEqual(['thinkingOff', 'thinkingLow', 'thinkingMedium', 'thinkingHigh', 'thinkingXHigh'])
    // 翻滚是整列位移，不是插入新节点：栈内元素数量恒等于档位数。
    expect(rows).toHaveLength(THINKING_SLIDER_LEVELS.length)
  })

  it('applies the level on click and reports it once', () => {
    mount('off')
    const element = track()
    element.getBoundingClientRect = () => ({
      left: 0, right: 100, top: 0, bottom: 32, width: 100, height: 32, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect

    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 95 }))

    expect(onChange).toHaveBeenCalledWith('xhigh')
    expect(element.getAttribute('aria-valuenow')).toBe('4')
  })

  it('does not report a level that is already selected', () => {
    mount('high')
    const element = track()
    element.getBoundingClientRect = () => ({
      left: 0, right: 100, top: 0, bottom: 32, width: 100, height: 32, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect

    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 72 }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('walks the levels from the keyboard and clamps at both ends', () => {
    mount('off')
    const element = track()

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(onChange).not.toHaveBeenCalled()

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith('low')

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith('xhigh')

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('becomes inert when disabled', () => {
    mount('medium', true)
    const element = track()

    expect(element.getAttribute('aria-disabled')).toBe('true')
    expect(element.tabIndex).toBe(-1)

    element.getBoundingClientRect = () => ({
      left: 0, right: 100, top: 0, bottom: 32, width: 100, height: 32, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5 }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('syncs an externally applied level without reporting it back', () => {
    const slider = mount('off')

    slider.setLevel('xhigh')
    expect(track().getAttribute('aria-valuenow')).toBe('4')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('mounts a canvas layer for particles clipped to the track', () => {
    mount('medium')
    const canvas = host.querySelector<HTMLCanvasElement>('.quickforge-model-thinking-fx')

    expect(canvas).not.toBeNull()
    // 粒子层与轨道同尺寸并被圆角裁剪，不能溢出滑动条。
    expect(canvas!.parentElement).toBe(track())
  })

  /**
   * 首帧定位回归：滑杆是「先 createThinkingSlider()、后 append 到弹层」的，
   * 创建那一刻文字行 `offsetHeight` 恒为 0。旧实现拿不到行高就 return，
   * `translateY` 从未写入 → 五档常驻文字停在第一行，用户看到的就是
   * 「打开模型选择，思考等级显示为关」，而圆圈（百分比定位）却在正确档位。
   */
  it('positions the rolling column before the element has layout', () => {
    mount('high')

    const stackElement = host.querySelector<HTMLElement>('.quickforge-model-thinking-stack')!
    // jsdom 没有布局：行高为 0，此时必须按根字号兜底写入真实位移，
    // 否则整列文字停在第一行（= 显示「关」）。
    expect(stackElement.style.transform).toBe(translateFor(3))
  })

  it('rewrites the offset when the measured line height becomes available', () => {
    mount('high')
    const stackElement = host.querySelector<HTMLElement>('.quickforge-model-thinking-stack')!

    // 模拟真实布局：行高 20px（与兜底 1.2rem/16px = 19.2px 不同）。
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.quickforge-model-thinking-stack > span'))
    for (const row of rows) {
      Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 20 })
    }
    fireResizeObserver()

    expect(stackElement.style.transform).toBe(translateFor(3, 20))
  })

  it('keeps the column at the fallback offset while layout still measures 0', () => {
    mount('low')
    const stackElement = host.querySelector<HTMLElement>('.quickforge-model-thinking-stack')!

    fireResizeObserver()

    expect(stackElement.style.transform).toBe(translateFor(1))
  })

  it('falls back to the first level for an unsupported thinking level', () => {
    handle = createThinkingSlider({
      // 上游 ThinkingLevel 含滑杆没有的 minimal，外部也可能传非法值。
      level: 'minimal' as never,
      title: 'thinkingLevel',
      labelFor: (value) => thinkingLevelLabel(value),
      onChange: vi.fn() as never,
    })
    host.append(handle.element)

    // minimal 收敛到相邻的 low，不能变成 NaN / 正向偏移。
    expect(track().getAttribute('aria-valuenow')).toBe('1')
    expect(knob().style.left).toBe('27.5%')
    expect(host.querySelector<HTMLElement>('.quickforge-model-thinking-stack')!.style.transform)
      .toBe(translateFor(1))
  })

  it('renders the first level for an unknown level', () => {
    handle = createThinkingSlider({
      level: 'bogus' as never,
      title: 'thinkingLevel',
      labelFor: (value) => thinkingLevelLabel(value),
      onChange: vi.fn() as never,
    })
    host.append(handle.element)

    expect(track().getAttribute('aria-valuenow')).toBe('0')
    expect(track().getAttribute('aria-valuetext')).toBe('thinkingOff')
    expect(knob().style.left).toBe('5%')
  })

  it('syncs an externally applied unsupported level to a valid one', () => {
    const slider = mount('off')

    slider.setLevel('bogus' as never)

    expect(track().getAttribute('aria-valuenow')).toBe('0')
    expect(host.querySelector<HTMLElement>('.quickforge-model-thinking-stack')!.style.transform)
      .toBe(translateFor(0))
  })
})
