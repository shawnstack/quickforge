import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScrollSync } from '../../src/components/chat/scroll-sync'

const originalWindow = globalThis.window
const originalResizeObserver = globalThis.ResizeObserver

function createEnv() {
  const listeners = new Map<string, EventListener>()
  const scrollContainer = {
    scrollTop: 120,
    scrollHeight: 1000,
    clientHeight: 100,
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: vi.fn(),
    querySelector: vi.fn(() => null),
  }
  const setAutoScroll = vi.fn()
  const panel = {
    querySelector: vi.fn((selector: string) => {
      if (selector === '.qf-scroll-container') return scrollContainer
      return null
    }),
  } as unknown as HTMLElement

  return {
    panel,
    scrollContainer,
    setAutoScroll,
    dispatch(type: string, event: Partial<Event> = {}) {
      listeners.get(type)?.(event as Event)
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    performance: { now: () => 1000 },
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  vi.stubGlobal('window', originalWindow)
  vi.stubGlobal('ResizeObserver', originalResizeObserver)
})

describe('scroll sync programmatic navigation', () => {
  it('keeps auto-scroll disabled when programmatic navigation reaches the top', () => {
    const env = createEnv()
    const sync = createScrollSync({ panel: env.panel, setAutoScroll: env.setAutoScroll })
    sync.setup()

    const end = sync.beginProgrammaticScroll()
    env.scrollContainer.scrollTop = 0
    env.dispatch('scroll')

    expect(sync.isEnabled).toBe(false)
    end()
  })

  it('forwards the auto-scroll flag to the React ChatSurface handle', () => {
    const env = createEnv()
    const sync = createScrollSync({ panel: env.panel, setAutoScroll: env.setAutoScroll })
    sync.setup()

    expect(env.setAutoScroll).toHaveBeenCalledWith(true)

    // Real user scroll-up (wheel + scroll while away from the bottom).
    env.dispatch('wheel', { deltaY: -1 } as Partial<WheelEvent>)
    env.scrollContainer.scrollTop = 0
    env.dispatch('scroll')

    expect(sync.isEnabled).toBe(false)
    expect(env.setAutoScroll).toHaveBeenLastCalledWith(false)
  })

  it('keeps smooth scrolling while the programmatic guard is active until completion', () => {
    const source = readFileSync(new URL('../../src/components/chat/turn-navigation.ts', import.meta.url), 'utf8')

    expect(source).toContain("behavior: 'smooth'")
    expect(source).toContain("addEventListener('scrollend'")
    expect(source).toMatch(/setTimeout\(settle,\s*900\)/)
    expect(source.indexOf('waitForScrollCompletion()')).toBeLessThan(source.indexOf("behavior: 'smooth'"))
  })

  it('does not re-enable auto-scroll while a programmatic jump passes near the bottom', () => {
    const env = createEnv()
    const sync = createScrollSync({ panel: env.panel, setAutoScroll: env.setAutoScroll })
    sync.setup()

    const end = sync.beginProgrammaticScroll()
    env.scrollContainer.scrollTop = 850
    env.dispatch('scroll')

    expect(sync.isEnabled).toBe(false)
    expect(env.setAutoScroll).toHaveBeenLastCalledWith(false)
    end()
  })
})

describe('scroll sync sent-message anchor', () => {
  const originalDocument = globalThis.document

  /**
   * Anchor-flavored environment. Default geometry: viewport 200px, content
   * 980px, the last user message spans content offsets 900..980 (its top sits
   * 80px above the viewport top once tail-following pins the bottom).
   */
  function createAnchorEnv(options: { userMessageRect?: { top: number; height: number } | null } = {}) {
    const userMessageRect = options.userMessageRect ?? { top: -80, height: 80 }
    const listeners = new Map<string, EventListener>()
    let spacerConnected = false
    const spacer = {
      style: { height: '' },
      get isConnected() { return spacerConnected },
      setAttribute: vi.fn(),
      remove: vi.fn(() => { spacerConnected = false }),
    }
    const column = { appendChild: vi.fn(() => { spacerConnected = true }) }
    const userMessage = { getBoundingClientRect: () => ({ ...userMessageRect }) }
    const scrollContainer = {
      scrollTop: 0,
      scrollHeight: 980,
      clientHeight: 200,
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
      querySelector: vi.fn((selector: string) => (selector === '.max-w-3xl' ? column : null)),
      querySelectorAll: vi.fn((selector: string) => (selector === '.qf-user-message' ? [userMessage] : [])),
      getBoundingClientRect: () => ({ top: 0 }),
    }
    const panel = {
      querySelector: vi.fn((selector: string) => (selector === '.qf-scroll-container' ? scrollContainer : null)),
    } as unknown as HTMLElement

    return {
      panel,
      scrollContainer,
      column,
      spacer,
      dispatch(type: string, event: Partial<Event> = {}) {
        listeners.get(type)?.(event as Event)
      },
    }
  }

  let env: ReturnType<typeof createAnchorEnv>
  let flushFrame: () => void
  let resizeCallback: ResizeObserverCallback | undefined

  beforeEach(() => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('window', {
      performance: { now: () => 1000 },
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
    })
    flushFrame = () => {
      const callbacks = frames.splice(0)
      for (const callback of callbacks) callback(16)
    }
    resizeCallback = undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('document', { createElement: () => env?.spacer ?? {} })
    env = createAnchorEnv()
  })

  afterEach(() => {
    vi.stubGlobal('document', originalDocument)
  })

  /** setup + enableWithAnchor + the two frames the after-paint anchor waits. */
  function anchor(sync: ReturnType<typeof createScrollSync>) {
    sync.setup()
    sync.enableWithAnchor()
    flushFrame()
    flushFrame()
  }

  it('anchors the freshly sent user message 12px below the viewport top with a bottom spacer', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    // Message top offset 900, only 80px of content below it: the spacer pads
    // the remaining viewport (clientHeight 200 - 80) plus the 12px top-margin
    // offset so maxScrollTop === 888 (message top - 12).
    expect(env.column.appendChild).toHaveBeenCalledWith(env.spacer)
    expect(env.spacer.style.height).toBe('108px')
    expect(env.spacer.setAttribute).toHaveBeenCalledWith('data-quickforge-anchor-spacer', '')
    expect(env.scrollContainer.scrollTop).toBe(888)
    expect(sync.isEnabled).toBe(true)
  })

  it('shrinks the spacer as the reply grows and removes it once exhausted', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    // Reply grows 40px below the message (content 980→1020, spacer still 108).
    env.scrollContainer.scrollHeight = 1140
    resizeCallback?.([], {} as ResizeObserver)
    expect(env.spacer.style.height).toBe('56px')
    expect(env.spacer.remove).not.toHaveBeenCalled()

    // Growth past exhaustion (content 1124 ≥ anchorScrollTop 888 + viewport 200).
    env.scrollContainer.scrollHeight = 1180
    resizeCallback?.([], {} as ResizeObserver)
    expect(env.spacer.remove).toHaveBeenCalled()
    expect(sync.isEnabled).toBe(true)
    // Tail-following resumed from the removal point.
    flushFrame()
    expect(env.scrollContainer.scrollTop).toBe(1180)
  })

  it('keeps compensating the spacer without following after the user scrolls up', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    env.dispatch('wheel', { deltaY: -1 } as Partial<WheelEvent>)
    expect(sync.isEnabled).toBe(false)

    env.scrollContainer.scrollHeight = 1140
    resizeCallback?.([], {} as ResizeObserver)
    // The spacer still absorbs content growth (stable total height, no jump),
    // but the anchored scroll position is left untouched while disabled.
    expect(env.spacer.style.height).toBe('56px')
    expect(env.spacer.remove).not.toHaveBeenCalled()
    flushFrame()
    expect(env.scrollContainer.scrollTop).toBe(888)
  })

  it('falls back to plain bottom-following when no user message is found', () => {
    env.scrollContainer.querySelectorAll = vi.fn(() => [])
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    expect(env.column.appendChild).not.toHaveBeenCalled()
    expect(sync.isEnabled).toBe(true)
    flushFrame()
    expect(env.scrollContainer.scrollTop).toBe(980)
  })

  it('writes no spacer when the sent message is taller than the viewport', () => {
    env = createAnchorEnv({ userMessageRect: { top: -600, height: 600 } })
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    // Message top at content offset 380 (980 - 600), anchor target 368
    // (380 - 12): the 600px of content below it exceeds the 200px viewport,
    // so no padding is needed for the anchor.
    expect(env.column.appendChild).not.toHaveBeenCalled()
    expect(env.scrollContainer.scrollTop).toBe(368)
    expect(sync.isEnabled).toBe(true)
  })

  it('cancels a pending anchor and removes an active spacer on cleanup', () => {
    const sync = createScrollSync({ panel: env.panel })
    sync.setup()
    sync.enableWithAnchor()
    sync.cleanup()
    flushFrame()
    flushFrame()
    expect(env.column.appendChild).not.toHaveBeenCalled()

    sync.setup()
    sync.enableWithAnchor()
    flushFrame()
    flushFrame()
    expect(env.column.appendChild).toHaveBeenCalled()
    sync.cleanup()
    expect(env.spacer.remove).toHaveBeenCalled()
  })
})
