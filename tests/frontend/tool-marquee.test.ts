import { describe, expect, it, vi } from 'vitest'
import {
  MARQUEE_END_PAUSE_MS,
  MARQUEE_RESTART_PAUSE_MS,
  MARQUEE_SCROLL_SPEED_PX_PER_SECOND,
  MARQUEE_START_DELAY_MS,
  ToolMarqueeController,
  type ToolMarqueeAnimation,
  type ToolMarqueeEnv,
  type ToolMarqueeSpan,
} from '../../src/lib/tool-marquee'

function createFakeSpan(scrollWidth: number): ToolMarqueeSpan {
  return {
    textContent: '',
    scrollWidth,
    style: { visibility: '', display: '', transform: '' },
  }
}

type FakeTimer = { handler: () => void; ms: number; cleared: boolean }

type FakeAnimation = ToolMarqueeAnimation & {
  cancelled: boolean
  resolveFinished: () => void
}

function createHarness(options: { reducedMotion?: boolean; clientWidth?: number; scrollWidth?: number } = {}) {
  const staticSpan = createFakeSpan(0)
  const movingSpan = createFakeSpan(options.scrollWidth ?? 500)
  const timers: FakeTimer[] = []
  const animations: FakeAnimation[] = []
  const env: ToolMarqueeEnv = {
    prefersReducedMotion: () => options.reducedMotion ?? false,
    animate: vi.fn((span, keyframes, animateOptions) => {
      expect(span).toBe(movingSpan)
      let resolveFinished: () => void = () => undefined
      const finished = new Promise<void>((resolve) => { resolveFinished = resolve })
      const animation: FakeAnimation = {
        cancelled: false,
        resolveFinished,
        finished,
        cancel() { animation.cancelled = true },
      }
      animations.push(animation)
      void keyframes
      void animateOptions
      return animation
    }),
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
    staticSpan,
    movingSpan,
    getClientWidth: () => options.clientWidth ?? 200,
  }, env)

  const fireTimer = (index: number) => {
    const timer = timers[index]
    if (!timer || timer.cleared) throw new Error(`timer ${index} missing or cleared`)
    timer.handler()
  }

  return { controller, staticSpan, movingSpan, timers, animations, env, fireTimer }
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
    expect(harness.staticSpan.style.visibility).toBe('hidden')
    expect(harness.movingSpan.style.display).toBe('inline-block')
    expect(harness.staticSpan.textContent).toBe('run_command · npm run test')
    expect(harness.movingSpan.textContent).toBe('run_command · npm run test')
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
      expect(harness.staticSpan.style.visibility).toBe('')
      expect(harness.movingSpan.style.display).toBe('')
    }
  })

  it('keeps scrolling on same-text refreshes and rebuilds on text change', () => {
    const harness = createHarness()
    harness.controller.sync('tool A', true)
    harness.fireTimer(0)
    expect(harness.animations).toHaveLength(1)

    // 同值刷新（SSE 高频路径）：不打断进行中的动画。
    harness.controller.sync('tool A', true)
    expect(harness.animations).toHaveLength(1)
    expect(harness.animations[0].cancelled).toBe(false)

    // 文本变化：取消旧动画并重新排程。
    harness.controller.sync('tool B', true)
    expect(harness.animations[0].cancelled).toBe(true)
    expect(harness.staticSpan.style.visibility).toBe('')
    expect(harness.timers).toHaveLength(2)
    harness.fireTimer(1)
    expect(harness.animations).toHaveLength(2)
    expect(harness.movingSpan.textContent).toBe('tool B')
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
    expect(harness.staticSpan.style.visibility).toBe('')
    expect(harness.movingSpan.style.display).toBe('')
    expect(harness.movingSpan.style.transform).toBe('')
    expect(harness.timers).toHaveLength(2)
    expect(harness.timers[1].ms).toBe(MARQUEE_RESTART_PAUSE_MS)

    harness.fireTimer(1)
    expect(harness.animations).toHaveLength(2)
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
    expect(harness.staticSpan.style.visibility).toBe('')
    expect(harness.movingSpan.style.display).toBe('')
  })
})
