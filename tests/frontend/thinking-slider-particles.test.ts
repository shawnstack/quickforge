// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createThinkingSlider, type ThinkingSliderHandle } from '../../src/lib/thinking-slider'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * 粒子是否真的画出来。
 *
 * 这类问题 jsdom 默认抓不到：没有 canvas 实现时 `getContext` 抛错、`getBoundingClientRect`
 * 恒为 0，代码看起来「正常运行」，但真实浏览器里一个像素都没画。
 *
 * 真实故障：滑杆在 append 到弹层之前就调用了 `startFlow()`，那一刻轨道尺寸是 0。
 * 旧实现仍然排了一帧 rAF，该帧里 `knobX = 0` 使续跑条件 `knobX > 6` 为假，
 * 循环就此永久停止且再无恢复机会——现象就是用户看到的「完全没有粒子」。
 * 现在改为等 ResizeObserver 报告真实尺寸后才启动，这些用例锁定该行为。
 */

type Stats = { arcs: number; fills: number; cleared: number }

let stats: Stats
let rafQueue: FrameRequestCallback[]
let observerCallbacks: ResizeObserverCallback[]
let handle: ThinkingSliderHandle | null
let host: HTMLDivElement

beforeEach(() => {
  stats = { arcs: 0, fills: 0, cleared: 0 }
  rafQueue = []
  observerCallbacks = []

  const context = {
    globalAlpha: 1,
    fillStyle: '',
    clearRect: () => { stats.cleared += 1 },
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    roundRect: () => {},
    rect: () => {},
    clip: () => {},
    arc: () => { stats.arcs += 1 },
    fill: () => { stats.fills += 1 },
    setTransform: () => {},
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => context as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      observerCallbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafQueue.push(callback)
    return rafQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => { rafQueue = [] })

  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  handle?.destroy()
  handle = null
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 只跑绘制帧，跳过翻转数值的 `data-instant` 收尾回调。 */
function runDrawFrames(count: number) {
  let executed = 0
  while (executed < count && rafQueue.length) {
    const callback = rafQueue.shift()!
    const before = stats.cleared
    callback(performance.now())
    // 绘制帧一定会 clearRect；instant 回调不会。
    if (stats.cleared > before) executed += 1
  }
}

function mount(level: 'off' | 'low' | 'medium' | 'high' | 'xhigh') {
  handle = createThinkingSlider({
    level,
    title: 'thinkingLevel',
    labelFor: (value) => value,
    onChange: () => {},
  })
  host.append(handle.element)
  return handle
}

/** 给轨道一个真实矩形，并触发 ResizeObserver（模拟插入布局后的回调）。 */
function applyLayout(width = 300, height = 34) {
  const track = host.querySelector<HTMLElement>('.quickforge-model-thinking-track')!
  track.getBoundingClientRect = () => ({
    left: 0, right: width, top: 0, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
  for (const callback of observerCallbacks) callback([], {} as ResizeObserver)
}

describe('thinking slider particles', () => {
  it('does not paint anything before the track has a size', () => {
    mount('xhigh')

    // 尺寸为 0 时不排绘制帧，避免"排一帧 → 条件不成立 → 永久停摆"。
    // （`renderValue(true)` 会排一个翻转数值的收尾回调，那不是绘制帧，
    //  所以这里按「有没有 clearRect」判断，而不是按队列长度。）
    runDrawFrames(3)
    expect(stats.arcs).toBe(0)
    expect(stats.cleared).toBe(0)
  })

  it('starts painting once the track reports a real size', () => {
    mount('xhigh')
    applyLayout()

    expect(rafQueue.length).toBeGreaterThan(0)
    runDrawFrames(3)

    expect(stats.arcs).toBeGreaterThan(0)
    expect(stats.fills).toBeGreaterThan(0)
  })

  it('keeps painting frame after frame and clears the canvas each time', () => {
    mount('xhigh')
    applyLayout()
    runDrawFrames(2)

    const arcsAfterWarmup = stats.arcs
    const clearsAfterWarmup = stats.cleared
    runDrawFrames(3)

    expect(stats.arcs).toBeGreaterThan(arcsAfterWarmup)
    expect(stats.cleared).toBeGreaterThan(clearsAfterWarmup)
  })

  it('paints noticeably more at xhigh than at off', () => {
    mount('off')
    applyLayout()
    runDrawFrames(6)
    const offArcs = stats.arcs

    handle!.destroy()
    handle = null
    rafQueue = []
    observerCallbacks = []
    stats.arcs = 0
    host.replaceChildren()

    mount('xhigh')
    applyLayout()
    runDrawFrames(6)

    expect(stats.arcs).toBeGreaterThan(offArcs)
  })

  it('stops painting after destroy', () => {
    const slider = mount('xhigh')
    applyLayout()
    runDrawFrames(2)
    const before = stats.arcs

    slider.destroy()
    handle = null
    runDrawFrames(3)

    expect(stats.arcs).toBe(before)
  })
})
