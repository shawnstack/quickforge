import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  INPUT_CLAMP_SETTLE_TIMEOUT_MS,
  INPUT_CLAMP_TRANSITION_MS,
  InputClampController,
  inputClampHeight,
  inputClampPhase,
  type InputClampBox,
  type InputClampEnv,
  type InputClampPhase,
} from '../../src/lib/input-clamp'

function createFakeEnv(options: { reduced?: boolean } = {}) {
  const timers: Array<() => void> = []
  const env: InputClampEnv = {
    prefersReducedMotion: () => Boolean(options.reduced),
    setTimeout: (handler) => { timers.push(handler); return timers.length },
    clearTimeout: () => { timers.length = 0 },
  }
  return {
    env,
    flushTimers: () => { timers.splice(0).forEach((run) => run()) },
    pendingTimers: () => timers.length,
  }
}

type FakeBox = {
  box: InputClampBox
  attrs: Map<string, string>
  style: { maxHeight: string }
  reflowReads: () => number
}

function createFakeBox(): FakeBox {
  const attrs = new Map<string, string>()
  const style = { maxHeight: '' }
  let reflowReads = 0
  const box: InputClampBox = {
    scrollHeight: 0,
    get offsetHeight() { reflowReads += 1; return 10 },
    style,
    setAttribute: (name, value) => { attrs.set(name, value) },
  }
  return { box, attrs, style, reflowReads: () => reflowReads }
}

function createController(options: {
  natural: number
  clamp: number
  reduced?: boolean
  states?: Array<{ expanded: boolean; phase: InputClampPhase }>
}) {
  const fakeBox = createFakeBox()
  const fakeEnv = createFakeEnv({ reduced: options.reduced })
  const controller = new InputClampController({
    box: fakeBox.box,
    env: fakeEnv.env,
    getClampHeightPx: () => options.clamp,
    getNaturalHeightPx: () => options.natural,
    ...(options.states ? { onStateApplied: (expanded: boolean, phase: InputClampPhase) => options.states!.push({ expanded, phase }) } : {}),
  })
  return { controller, ...fakeBox, ...fakeEnv }
}

describe('inputClampHeight', () => {
  it('computes lines times line height plus vertical chrome, rounded up', () => {
    expect(inputClampHeight(22.75, 26)).toBe(Math.ceil(6 * 22.75 + 26))
    expect(inputClampHeight(20, 0)).toBe(120)
  })

  it('supports custom line counts and clamps invalid inputs', () => {
    expect(inputClampHeight(20, 10, 3)).toBe(70)
    expect(inputClampHeight(0, 10)).toBe(0)
    expect(inputClampHeight(Number.NaN, 10)).toBe(0)
    expect(inputClampHeight(20, -5)).toBe(120)
  })
})

describe('inputClampPhase', () => {
  it('treats an unusable clamp height or fitting content as fits', () => {
    expect(inputClampPhase(500, 0, false)).toBe('fits')
    expect(inputClampPhase(163, 163, false)).toBe('fits')
    expect(inputClampPhase(163.5, 163, true)).toBe('fits')
  })

  it('returns collapsed or expanded for overflowing content', () => {
    expect(inputClampPhase(164, 163, false)).toBe('collapsed')
    expect(inputClampPhase(164, 163, true)).toBe('expanded')
  })
})

describe('InputClampController', () => {
  it('sync applies the collapsed state with data attributes and no inline max-height', () => {
    const { controller, attrs, style } = createController({ natural: 500, clamp: 163 })
    controller.sync()
    expect(attrs.get('data-quickforge-fits')).toBe('false')
    expect(attrs.get('data-quickforge-clamped')).toBe('true')
    expect(attrs.get('data-quickforge-expanded')).toBe('false')
    expect(style.maxHeight).toBe('')
  })

  it('sync keeps fitting content natural and unclamped', () => {
    const { controller, attrs, style } = createController({ natural: 100, clamp: 163 })
    controller.sync()
    expect(attrs.get('data-quickforge-fits')).toBe('true')
    expect(attrs.get('data-quickforge-clamped')).toBe('false')
    expect(style.maxHeight).toBe('')
  })

  it('expanding animates to the natural height then settles to none', () => {
    const { controller, style, flushTimers, pendingTimers } = createController({ natural: 500, clamp: 163 })
    controller.sync()
    controller.setExpanded(true)
    expect(style.maxHeight).toBe('500px')
    expect(pendingTimers()).toBe(1)
    flushTimers()
    expect(style.maxHeight).toBe('none')
  })

  it('collapsing transitions through the natural height back to the CSS clamp', () => {
    const { controller, style, flushTimers, reflowReads, attrs } = createController({ natural: 500, clamp: 163 })
    controller.sync()
    controller.setExpanded(true)
    flushTimers()
    expect(style.maxHeight).toBe('none')

    controller.setExpanded(false)
    // 收起路径：先回到自然高度 px，读一次 offsetHeight 强制 reflow，再清空回落到 CSS 定高。
    expect(reflowReads()).toBeGreaterThanOrEqual(1)
    expect(style.maxHeight).toBe('')
    expect(attrs.get('data-quickforge-clamped')).toBe('true')
    expect(attrs.get('data-quickforge-expanded')).toBe('false')
  })

  it('reports state through onStateApplied for each sync and toggle', () => {
    const states: Array<{ expanded: boolean; phase: InputClampPhase }> = []
    const { controller } = createController({ natural: 500, clamp: 163, states })
    controller.sync()
    controller.toggle()
    expect(states.map((state) => state.phase)).toEqual(['collapsed', 'expanded'])
    expect(controller.isExpanded()).toBe(true)
  })

  it('skips the animation when the user prefers reduced motion', () => {
    const { controller, style, pendingTimers } = createController({ natural: 500, clamp: 163, reduced: true })
    controller.sync()
    controller.setExpanded(true)
    expect(style.maxHeight).toBe('none')
    expect(pendingTimers()).toBe(0)

    controller.setExpanded(false)
    expect(style.maxHeight).toBe('')
  })

  it('re-setting the same expanded value re-syncs and settles immediately', () => {
    const { controller, style, pendingTimers } = createController({ natural: 500, clamp: 163 })
    controller.setExpanded(true)
    expect(pendingTimers()).toBe(1)
    controller.setExpanded(true)
    // 同值重复调用走 sync：直接应用终态并清掉待续定时器（不再等待过渡兜底）。
    expect(pendingTimers()).toBe(0)
    expect(style.maxHeight).toBe('none')
  })

  it('dispose cancels the pending settle timer', () => {
    const { controller, style, flushTimers } = createController({ natural: 500, clamp: 163 })
    controller.setExpanded(true)
    controller.dispose()
    flushTimers()
    expect(style.maxHeight).toBe('500px')
  })

  it('uses a settle timeout slightly longer than the transition for safety', () => {
    expect(INPUT_CLAMP_SETTLE_TIMEOUT_MS).toBeGreaterThan(INPUT_CLAMP_TRANSITION_MS)
  })
})

describe('input clamp wiring sources', () => {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  const localToolsSource = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
  const messageActionsSource = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
  const inputClampSource = readFileSync(new URL('../../src/lib/input-clamp.ts', import.meta.url), 'utf8')
  const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

  it('lightens the user message bubble per theme: 6% dark default and 3% in light theme', () => {
    expect(css).toMatch(/--quickforge-input-clamp-bg:\s*color-mix\(in oklab,\s*var\(--primary\) 6%,\s*var\(--card\)/)
    expect(css).toMatch(/html:not\(\.dark\) user-message \.user-message-container,[\s\S]*?--quickforge-input-clamp-bg:\s*color-mix\(in oklab,\s*var\(--primary\) 3%,\s*var\(--card\)/)
    expect(css).not.toMatch(/user-message-container[^{]*\{[^{}]*--primary\) 10%/s)
  })

  it('keeps the clamp transition duration in sync between CSS and the controller constant', () => {
    expect(css).toMatch(/\.quickforge-input-clamp\s*\{[\s\S]*?transition:\s*max-height \.22s/)
    expect(inputClampSource).toMatch(/INPUT_CLAMP_TRANSITION_MS = 220/)
  })

  it('styles the clamp box, fade, and toggle with fits state hiding both affordances', () => {
    expect(css).toMatch(/\.quickforge-input-clamp\[data-quickforge-clamped='true'\]\s*\{[\s\S]*?overflow:\s*hidden/)
    expect(css).toMatch(/\.quickforge-input-clamp\[data-quickforge-fits='true'\] \.quickforge-input-clamp-fade,[\s\S]*?display:\s*none/)
    expect(css).toMatch(/\.quickforge-input-clamp-toggle\s*\{[\s\S]*?border-radius:\s*999px/)
  })

  it('restyles the subagent task block as a user-message bubble with the shared clamp', () => {
    expect(css).toMatch(/\.quickforge-subagent-task\.quickforge-input-clamp\s*\{[\s\S]*?border-radius:\s*1\.125rem 1\.125rem 0\.375rem 1\.125rem/)
    expect(localToolsSource).toMatch(/quickforge-subagent-task quickforge-input-clamp" data-quickforge-input-clamp="true"/)
    expect(localToolsSource).toMatch(/syncInputClampBoxes\(this, subagentInputClampLabels\)/)
  })

  it('decorates only plain user messages in the chat decoration pass', () => {
    expect(messageActionsSource).toMatch(/if \(entry\.message\.role === 'user'\) decorateUserMessageInputClamp\(element, inputClampLabels\)/)
    expect(messageActionsSource).not.toMatch(/role !== 'assistant'\) decorateUserMessageInputClamp/)
  })

  it('adds bilingual expand and collapse labels', () => {
    expect(i18nSource).toMatch(/expand: 'Expand',\s*\n\s*collapse: 'Collapse',/)
    expect(i18nSource).toMatch(/expand: '展开',\s*\n\s*collapse: '收起',/)
  })
})
