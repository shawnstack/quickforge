import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ODOMETER_ENTER_MS,
  OdometerDiffCounterController,
  type OdometerElementLike,
  type OdometerEnv,
} from '../../src/lib/diff-counter'

type FakeTimer = { handler: () => void; ms: number; cleared: boolean }

function createElement(tag: string): OdometerElementLike & { tag: string; classes: Set<string> } {
  const classes = new Set<string>()
  const element = {
    tag,
    className: '',
    textContent: '',
    style: { transform: '' },
    classes,
    classList: {
      toggle(token: string, force?: boolean) {
        const enabled = force ?? !classes.has(token)
        if (enabled) classes.add(token)
        else classes.delete(token)
        return enabled
      },
    },
    children: [] as Array<OdometerElementLike & { tag: string }>,
    appendChild(child: OdometerElementLike) {
      element.children.push(child as OdometerElementLike & { tag: string })
      return child
    },
    insertBefore(child: OdometerElementLike, ref: OdometerElementLike | null) {
      const index = ref ? element.children.indexOf(ref as OdometerElementLike & { tag: string }) : -1
      if (index === -1) element.children.push(child as OdometerElementLike & { tag: string })
      else element.children.splice(index, 0, child as OdometerElementLike & { tag: string })
      return child
    },
    removeChild(child: OdometerElementLike) {
      element.children = element.children.filter((item) => item !== child)
      return child
    },
  }
  return element
}

function createHarness(options: { reducedMotion?: boolean } = {}) {
  const root = createElement('quickforge-diff-counter')
  const timers: FakeTimer[] = []
  const env: OdometerEnv = {
    prefersReducedMotion: () => options.reducedMotion ?? false,
    createElement: (tag) => createElement(tag),
    setTimeout: vi.fn(((handler: () => void, ms: number) => {
      const timer: FakeTimer = { handler, ms, cleared: false }
      timers.push(timer)
      return timer
    }) as OdometerEnv['setTimeout']),
    clearTimeout: vi.fn(((token: unknown) => {
      (token as FakeTimer).cleared = true
    }) as OdometerEnv['clearTimeout']),
  }
  const controller = new OdometerDiffCounterController(root, env)
  return { root, timers, controller }
}

function sideDigits(root: OdometerElementLike, kind: 'add' | 'del') {
  const group = (root.children as Array<OdometerElementLike & { className: string; tag: string }>)
    .find((child) => child.tag === 'span' && child.className === `quickforge-odometer-side ${kind}`)
  expect(group).toBeDefined()
  const holders = group!.children.filter((child) => child.className.startsWith('quickforge-odometer-digit'))
  return holders.map((holder) => {
    const strip = holder.children[0]
    return {
      enter: holder.className.includes('enter'),
      transform: strip.style.transform,
    }
  })
}

describe('OdometerDiffCounterController', () => {
  it('renders +/− sides with per-digit columns', () => {
    const { root, controller } = createHarness()
    controller.sync(12, 3, true)

    expect(root.classes.has('quickforge-diff-counter-running')).toBe(true)
    expect(sideDigits(root, 'add')).toEqual([
      { enter: true, transform: 'translateY(-1em)' },
      { enter: true, transform: 'translateY(-2em)' },
    ])
    expect(sideDigits(root, 'del')).toEqual([{ enter: true, transform: 'translateY(-3em)' }])
  })

  it('scrolls existing digit columns without re-entering when digit count stays the same', () => {
    const { root, timers, controller } = createHarness()
    controller.sync(12, 3, true)
    timers.splice(0).forEach((timer) => timer.handler())

    controller.sync(87, 9, true)
    expect(sideDigits(root, 'add')).toEqual([
      { enter: false, transform: 'translateY(-8em)' },
      { enter: false, transform: 'translateY(-7em)' },
    ])
  })

  it('enters a new leftmost column on digit-count growth and clears the enter flag after the animation', () => {
    const { root, timers, controller } = createHarness()
    controller.sync(9, 0, true)
    timers.splice(0).forEach((timer) => timer.handler())

    controller.sync(42, 0, false)
    const digits = sideDigits(root, 'add')
    expect(digits).toHaveLength(2)
    expect(digits[0]).toEqual({ enter: true, transform: 'translateY(-4em)' })
    expect(digits[1]).toEqual({ enter: false, transform: 'translateY(-2em)' })
    expect(root.classes.has('quickforge-diff-counter-running')).toBe(false)

    const enterTimer = timers.at(-1)
    expect(enterTimer?.ms).toBe(ODOMETER_ENTER_MS)
    enterTimer?.handler()
    expect(sideDigits(root, 'add')[0].enter).toBe(false)
  })

  it('removes leftmost columns when digit count shrinks', () => {
    const { root, timers, controller } = createHarness()
    controller.sync(123, 0, false)
    timers.splice(0).forEach((timer) => timer.handler())

    controller.sync(7, 0, false)
    const digits = sideDigits(root, 'add')
    expect(digits).toHaveLength(1)
    expect(digits[0]).toEqual({ enter: false, transform: 'translateY(-7em)' })
  })

  it('marks reduced motion and disables running breathing class', () => {
    const { root, controller } = createHarness({ reducedMotion: true })
    controller.sync(1, 1, true)
    expect(root.classes.has('quickforge-odometer-reduced')).toBe(true)
    expect(root.classes.has('quickforge-diff-counter-running')).toBe(true)
  })

  it('dispose clears pending enter timers', () => {
    const { timers, controller } = createHarness()
    controller.sync(5, 2, true)
    controller.dispose()
    expect(allCleared(timers)).toBe(true)
  })

  it('does not duplicate sides when a fresh controller attaches to a root that already has children (DOM move / clone scenario)', () => {
    const { root, controller } = createHarness()
    controller.sync(21, 4, true)

    // 模拟装饰层搬移或 cloneNode(true)：根上带着旧子树重新挂载一个新 controller。
    const reattached = new OdometerDiffCounterController(root, {
      prefersReducedMotion: () => false,
      createElement: (tag) => createElement(tag),
      setTimeout: () => undefined,
      clearTimeout: () => undefined,
    })
    reattached.sync(21, 4, false)

    const sides = (root.children as Array<OdometerElementLike & { className: string }>)
      .filter((child) => child.className.startsWith('quickforge-odometer-side'))
    expect(sides.map((side) => side.className)).toEqual(['quickforge-odometer-side add', 'quickforge-odometer-side del'])
    expect(sideDigits(root, 'add')).toHaveLength(2)
    expect(sideDigits(root, 'del')).toHaveLength(1)
  })

  it('preserves foreign classes on the root (Lit-assigned layout classes) across syncs', () => {
    const { root, controller } = createHarness()
    root.classes.add('quickforge-tool-meta-hover')
    root.classes.add('shrink-0')

    controller.sync(12, 3, true)
    controller.sync(87, 9, false)

    expect(root.classes.has('shrink-0')).toBe(true)
    expect(root.classes.has('quickforge-tool-meta-hover')).toBe(true)
    expect(root.classes.has('quickforge-diff-counter')).toBe(true)
    expect(root.classes.has('quickforge-diff-counter-running')).toBe(false)
  })

  it('dispose then sync reuses the existing side DOM instead of rebuilding (DOM move reuse)', () => {
    const { root, timers, controller } = createHarness()
    controller.sync(12, 3, true)
    timers.splice(0).forEach((timer) => timer.handler())
    const addGroupBefore = root.children.find((child) => child.className === 'quickforge-odometer-side add')

    controller.dispose()
    controller.sync(12, 3, false)

    expect(root.children.find((child) => child.className === 'quickforge-odometer-side add')).toBe(addGroupBefore)
    expect(sideDigits(root, 'add')).toHaveLength(2)
  })
})

describe('QuickForgeDiffCounter element lifecycle source contract', () => {
  // 元素类未导出且依赖真实 DOM，这里对源码做结构性断言：
  // 搬移（disconnect→connect）必须复用 controller，否则过程分组重装饰时
  // 所有计数器会清空重建、数字列重播入场动画（整屏抖动回归）。
  const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
  const elementSource = source.slice(
    source.indexOf('class QuickForgeDiffCounter'),
    source.indexOf("customElements.get('quickforge-diff-counter')"),
  )

  it('reuses the controller across DOM moves instead of recreating it', () => {
    expect(elementSource).toContain('if (!this.controller)')
    expect(elementSource).not.toContain('this.controller = undefined')
  })
})

function allCleared(timers: FakeTimer[]) {
  return timers.every((timer) => timer.cleared)
}
