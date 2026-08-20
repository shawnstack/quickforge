import { describe, expect, it, vi } from 'vitest'
import {
  MARQUEE_END_PAUSE_MS,
  MARQUEE_RESTART_PAUSE_MS,
  MARQUEE_ROLL_DURATION_MS,
  MARQUEE_SCROLL_SPEED_PX_PER_SECOND,
  MARQUEE_START_DELAY_MS,
  ToolMarqueeController,
  type ToolMarqueeAnimation,
  type ToolMarqueeEnv,
  type ToolMarqueeSpan,
  type ToolMarqueeView,
} from '../../src/lib/tool-marquee'

function createFakeSpan(scrollWidth: number): ToolMarqueeSpan {
  return {
    textContent: '',
    scrollWidth,
    style: { visibility: '', display: '', transform: '' },
  }
}

function createFakeView(scrollWidth: number): ToolMarqueeView {
  return {
    el: { style: { transform: '', visibility: '' } },
    staticSpan: createFakeSpan(0),
    movingSpan: createFakeSpan(scrollWidth),
  }
}

type FakeTimer = { handler: () => void; ms: number; cleared: boolean }

type FakeAnimation = ToolMarqueeAnimation & {
  cancelled: boolean
  resolveFinished: () => void
  target: ToolMarqueeSpan | ToolMarqueeView['el']
}

function createHarness(options: { reducedMotion?: boolean; clientWidth?: number; scrollWidth?: number } = {}) {
  const views: [ToolMarqueeView, ToolMarqueeView] = [
    createFakeView(options.scrollWidth ?? 500),
    createFakeView(options.scrollWidth ?? 500),
  ]
  const timers: FakeTimer[] = []
  const animations: FakeAnimation[] = []
  const env: ToolMarqueeEnv = {
    prefersReducedMotion: () => options.reducedMotion ?? false,
    animate: vi.fn(((target: ToolMarqueeSpan | ToolMarqueeView['el'], keyframes: Array<{ transform: string }>) => {
      let resolveFinished: () => void = () => undefined
      const finished = new Promise<void>((resolve) => { resolveFinished = resolve })
      const animation: FakeAnimation = {
        cancelled: false,
        resolveFinished,
        finished,
        target,
        cancel() { animation.cancelled = true },
      }
      animations.push(animation)
      void keyframes
      return animation
    }) as ToolMarqueeEnv['animate']),
    setTimeout: vi.fn(((handler: () => void, ms: number) => {
      const timer: FakeTimer = { handler, ms, cleared: false }
      timers.push(timer)
      return timer
    }) as ToolMarqueeEnv['setTimeout']),
    clearTimeout: vi.fn(((token: unknown) => {
      (token as FakeTimer).cleared = true
    }) as ToolMarqueeEnv['clearTimeout']),
  }
  const controller = new ToolMarqueeController({
    views,
    getClientWidth: () => options.clientWidth ?? 200,
  }, env)

  const fireTimer = (index: number) => {
    const timer = timers[index]
    if (!timer || timer.cleared) throw new Error(`timer ${index} missing or cleared`)
    timer.handler()
  }

  // 结算一次纵向滚动：resolve 两个 roll 动画并冲刷微任务链。
  const settleRoll = async (rollAnimations: Array<FakeAnimation>) => {
    rollAnimations.forEach((animation) => animation.resolveFinished())
    await Promise.all(rollAnimations.map((animation) => animation.finished))
    await Promise.resolve()
    await Promise.resolve()
  }

  return { controller, views, timers, animations, env, fireTimer, settleRoll }
}

describe('ToolMarqueeController', () => {
  it('starts the first cycle after the start delay when text overflows while running', () => {
    const harness = createHarness({ clientWidth: 200, scrollWidth: 500 })
    harness.controller.sync('run_command · npm run test', true)

    expect(harness.animations).toHaveLength(0)
    expect(harness.timers).toHaveLength(1)
    expect(harness.timers[0].ms).toBe(MARQUEE_START_DELAY_MS)

    harness.fireTimer(0)
    expect(harness.animations).toHaveLength(1)
    // 首次出现（无旧文本）不滚动：唯一的动画是当前视图的横向滚动。
    expect(harness.animations[0].target).toBe(harness.views[0].movingSpan)
    expect(harness.views[0].staticSpan.style.visibility).toBe('hidden')
    expect(harness.views[0].movingSpan.style.display).toBe('inline-block')
    expect(harness.views[0].staticSpan.textContent).toBe('run_command · npm run test')
    expect(harness.views[0].movingSpan.textContent).toBe('run_command · npm run test')
    // 另一视图初始隐藏为滚入位。
    expect(harness.views[1].el.style.visibility).toBe('hidden')
  })

  it('computes keyframes and duration from the measured distance', () => {
    const harness = createHarness({ clientWidth: 200, scrollWidth: 500 })
    harness.controller.sync('text', true)
    harness.fireTimer(0)

    const distance = 300
    const scrollDurationMs = distance / MARQUEE_SCROLL_SPEED_PX_PER_SECOND * 1000
    const returnDurationMs = Math.min(500, Math.max(240, scrollDurationMs * 0.25))
    const expectedDuration = scrollDurationMs + MARQUEE_END_PAUSE_MS + returnDurationMs
    expect(harness.env.animate).toHaveBeenCalledTimes(1)
    const call = vi.mocked(harness.env.animate).mock.calls[0]
    expect(call[0]).toBe(harness.views[0].movingSpan)
    expect(call[2]).toEqual({ duration: expectedDuration, fill: 'forwards' })
    expect(call[1][1]).toMatchObject({ transform: `translateX(-${distance}px)`, easing: 'linear' })
    expect(call[1][2]).toMatchObject({ transform: `translateX(-${distance}px)`, easing: 'ease-out' })
    expect(call[1][3]).toMatchObject({ transform: 'translateX(0)', offset: 1 })
    const offsets = call[1].map((frame) => frame.offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('stays static when not running, empty, reduced motion, or fitting', () => {
    const notRunning = createHarness()
    notRunning.controller.sync('run_command · npm test', false)
    const empty = createHarness()
    empty.controller.sync('', true)
    const reduced = createHarness({ reducedMotion: true })
    reduced.controller.sync('run_command · npm test', true)
    const fitting = createHarness({ clientWidth: 600, scrollWidth: 500 })
    fitting.controller.sync('run_command · npm test', true)

    for (const harness of [notRunning, empty, reduced, fitting]) {
      expect(harness.timers).toHaveLength(0)
      expect(harness.animations).toHaveLength(0)
      for (const view of harness.views) {
        expect(view.staticSpan.style.visibility).toBe('')
        expect(view.movingSpan.style.display).toBe('')
      }
    }
  })

  it('rolls the outgoing view up and the incoming view in on text change', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    const horizontal = harness.animations[0]

    harness.controller.sync('tool B', true)
    // 横向动画在纵向滚动期间不中断。
    expect(horizontal.cancelled).toBe(false)
    // 新增两条 roll 动画：旧视图 0 滚出、新视图 1 滚入。
    expect(harness.animations).toHaveLength(3)
    const [outRoll, inRoll] = harness.animations.slice(1)
    expect(outRoll.target).toBe(harness.views[0].el)
    expect(inRoll.target).toBe(harness.views[1].el)
    expect(harness.timers).toHaveLength(1)

    const calls = vi.mocked(harness.env.animate).mock.calls
    const [outFrames, outOptions] = [calls[1][1], calls[1][2]]
    const [inFrames, inOptions] = [calls[2][1], calls[2][2]]
    expect(outFrames[0]).toMatchObject({ transform: 'translateY(0)' })
    expect(outFrames[1]).toMatchObject({ transform: 'translateY(-100%)', offset: 1 })
    expect(inFrames[0]).toMatchObject({ transform: 'translateY(100%)' })
    expect(inFrames[1]).toMatchObject({ transform: 'translateY(0)', offset: 1 })
    expect(outOptions).toEqual({ duration: MARQUEE_ROLL_DURATION_MS, fill: 'forwards' })
    expect(inOptions).toEqual({ duration: MARQUEE_ROLL_DURATION_MS, fill: 'forwards' })

    // 新文本已就位于滚入视图并解除隐藏，滚出前先摆好起点。
    expect(harness.views[1].staticSpan.textContent).toBe('tool B')
    expect(harness.views[1].el.style.visibility).toBe('')
    expect(harness.views[1].el.style.transform).toBe('translateY(100%)')
    expect(harness.views[0].el.style.transform).toBe('translateY(0)')
  })

  it('finalizes the roll by swapping views and rebuilding horizontal for the new text', async () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    const horizontal = harness.animations[0]
    harness.controller.sync('tool B', true)
    const rollAnimations = harness.animations.slice(1)

    await harness.settleRoll(rollAnimations)

    // 旧视图横向动画停掉并隐藏为下一个滚入位；新视图就位为当前视图。
    expect(horizontal.cancelled).toBe(true)
    expect(harness.views[0].el.style.visibility).toBe('hidden')
    expect(harness.views[0].el.style.transform).toBe('')
    expect(harness.views[1].el.style.transform).toBe('')
    // 新文本按既有起始延迟重建横向循环。
    expect(harness.timers).toHaveLength(2)
    expect(harness.timers[1].ms).toBe(MARQUEE_START_DELAY_MS)
    expect(harness.timers[0].cleared).toBe(false)

    harness.fireTimer(1)
    expect(harness.animations).toHaveLength(4)
    expect(harness.animations[3].target).toBe(harness.views[1].movingSpan)
    expect(harness.views[1].movingSpan.textContent).toBe('tool B')
  })

  it('switches instantly without rolling when reduced motion, not running, or clearing text', () => {
    const reduced = createHarness({ reducedMotion: true })
    reduced.controller.sync('tool A', true)
    reduced.controller.sync('tool B', true)
    expect(reduced.animations).toHaveLength(0)
    expect(reduced.views[0].staticSpan.textContent).toBe('tool B')
    expect(reduced.views[0].el.style.visibility).toBe('')
    expect(reduced.views[1].el.style.visibility).toBe('hidden')

    const stopped = createHarness()
    stopped.controller.sync('tool A', true)
    stopped.fireTimer(0)
    const horizontal = stopped.animations[0]
    stopped.controller.sync('tool B', false)
    expect(stopped.animations).toHaveLength(1)
    expect(horizontal.cancelled).toBe(true)
    expect(stopped.views[0].staticSpan.textContent).toBe('tool B')
    expect(stopped.views[0].movingSpan.style.display).toBe('')

    const cleared = createHarness()
    cleared.controller.sync('tool A', true)
    cleared.fireTimer(0)
    cleared.controller.sync('', true)
    expect(cleared.animations).toHaveLength(1)
    expect(cleared.animations[0].cancelled).toBe(true)
    expect(cleared.views[0].staticSpan.textContent).toBe('')
  })

  it('keeps scrolling on same-text refreshes even while a roll is in flight', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    harness.controller.sync('tool B', true)
    expect(harness.animations).toHaveLength(3)
    const [outRoll, inRoll] = harness.animations.slice(1)

    // 同值刷新（SSE 高频、工具间隙保持）：不打断进行中的横向动画与纵向滚动。
    harness.controller.sync('tool B', true)
    expect(harness.animations).toHaveLength(3)
    expect(outRoll.cancelled).toBe(false)
    expect(inRoll.cancelled).toBe(false)
    expect(harness.animations[0].cancelled).toBe(false)
    expect(harness.timers).toHaveLength(1)
  })

  it('stops the horizontal animation on a same-text refresh once running ends', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    expect(harness.animations).toHaveLength(1)

    harness.controller.sync('tool A', false)
    expect(harness.animations[0].cancelled).toBe(true)
    expect(harness.views[0].staticSpan.style.visibility).toBe('')
    expect(harness.views[0].movingSpan.style.display).toBe('')
  })

  it('re-measures and rebuilds when restart is requested (width change path)', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    expect(harness.animations).toHaveLength(1)

    harness.controller.sync('tool A', true, true)
    expect(harness.animations[0].cancelled).toBe(true)
    expect(harness.timers).toHaveLength(2)
    harness.fireTimer(1)
    expect(harness.animations).toHaveLength(2)
    expect(harness.animations[1].target).toBe(harness.views[0].movingSpan)
  })

  it('loops with a restart pause after a cycle finishes', async () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    const first = harness.animations[0]

    first.resolveFinished()
    await first.finished
    await Promise.resolve()

    expect(first.cancelled).toBe(true)
    expect(harness.views[0].staticSpan.style.visibility).toBe('')
    expect(harness.views[0].movingSpan.style.display).toBe('')
    expect(harness.views[0].movingSpan.style.transform).toBe('')
    expect(harness.timers).toHaveLength(2)
    expect(harness.timers[1].ms).toBe(MARQUEE_RESTART_PAUSE_MS)

    harness.fireTimer(1)
    expect(harness.animations).toHaveLength(2)
  })

  it('finalizes an in-flight roll instantly when a newer text arrives mid-roll', async () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    harness.controller.sync('tool B', true)
    const firstRoll = harness.animations.slice(1)

    // 滚动进行中收到更新的文本：先就地结算（视图已完成一次交换），再从新当前视图滚向最新文本。
    harness.controller.sync('tool C', true)
    expect(firstRoll.map((animation) => animation.cancelled)).toEqual([true, true])
    // 结算后 view1（展示 tool B）成为当前视图，随即作为第二次滚动的滚出方保持可见。
    expect(harness.views[1].el.style.visibility).toBe('')
    expect(harness.views[1].staticSpan.textContent).toBe('tool B')
    expect(harness.animations).toHaveLength(5)
    const [secondOutRoll, secondInRoll] = harness.animations.slice(3)
    expect(secondOutRoll.target).toBe(harness.views[1].el)
    expect(secondInRoll.target).toBe(harness.views[0].el)
    expect(harness.views[0].staticSpan.textContent).toBe('tool C')
    expect(harness.views[0].el.style.transform).toBe('translateY(100%)')

    await harness.settleRoll([secondOutRoll, secondInRoll])
    harness.fireTimer(2)
    expect(harness.animations).toHaveLength(6)
    expect(harness.animations[5].target).toBe(harness.views[0].movingSpan)
    expect(harness.views[0].movingSpan.textContent).toBe('tool C')
  })

  it('dispose cancels the running animation and invalidates pending timers', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)

    // 起始延迟期内 dispose：排程的 timer 被清除，不再产生任何动画。
    harness.controller.dispose()
    expect(harness.timers[0].cleared).toBe(true)
    expect(harness.animations).toHaveLength(0)

    harness.controller.sync('tool A', true)
    harness.fireTimer(1)
    expect(harness.animations).toHaveLength(1)
    harness.controller.dispose()
    expect(harness.animations[0].cancelled).toBe(true)
    expect(harness.views[0].staticSpan.style.visibility).toBe('')
    expect(harness.views[0].movingSpan.style.display).toBe('')
  })

  it('dispose cancels an in-flight roll along with the horizontal animation', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    harness.controller.sync('tool B', true)
    expect(harness.animations).toHaveLength(3)

    harness.controller.dispose()
    for (const animation of harness.animations) {
      expect(animation.cancelled).toBe(true)
    }
    for (const view of harness.views) {
      expect(view.el.style.transform).toBe('')
      expect(view.staticSpan.style.visibility).toBe('')
      expect(view.movingSpan.style.display).toBe('')
    }
  })
})
