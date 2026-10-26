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

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    handle = null
    onChange = vi.fn()
  })

  afterEach(() => {
    handle?.destroy()
    handle = null
    host.remove()
  })

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
})
