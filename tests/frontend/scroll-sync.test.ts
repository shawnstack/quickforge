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

  // pi-web-ui parity: `_handleScroll` only released `_autoScroll` once the
  // container was more than 50px from the tail, and re-armed it below 10px.
  it('keeps tail-following while a user scroll-up stays within 50px of the tail', () => {
    const env = createEnv()
    const sync = createScrollSync({ panel: env.panel, setAutoScroll: env.setAutoScroll })
    sync.setup()

    env.scrollContainer.scrollTop = 900 // distance 0
    env.dispatch('scroll')
    env.dispatch('wheel', { deltaY: -1 } as Partial<WheelEvent>)
    env.scrollContainer.scrollTop = 870 // distance 30, scrolled up
    env.dispatch('scroll')
    expect(sync.isEnabled).toBe(true)

    env.dispatch('wheel', { deltaY: -1 } as Partial<WheelEvent>)
    env.scrollContainer.scrollTop = 800 // distance 100, scrolled up
    env.dispatch('scroll')
    expect(sync.isEnabled).toBe(false)
  })

  it('re-arms tail-following as soon as the viewport is back within 10px of the tail', () => {
    let now = 1000
    vi.stubGlobal('window', {
      performance: { now: () => now },
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    })
    const env = createEnv()
    const sync = createScrollSync({ panel: env.panel, setAutoScroll: env.setAutoScroll })
    sync.setup()

    env.dispatch('wheel', { deltaY: -1 } as Partial<WheelEvent>)
    env.scrollContainer.scrollTop = 0
    env.dispatch('scroll')
    expect(sync.isEnabled).toBe(false)

    now = 5000 // the 500ms user-scroll intent window has long expired
    env.scrollContainer.scrollTop = 895 // distance 5
    env.dispatch('scroll')

    expect(sync.isEnabled).toBe(true)
    expect(env.setAutoScroll).toHaveBeenLastCalledWith(true)
  })
})

describe('scroll sync sent-message anchor', () => {
  const originalDocument = globalThis.document

  /**
   * Anchor-flavored environment. Default geometry: viewport 200px, content
   * 980px, the sent user message spans content offsets 900..980. The mock
   * keeps `getBoundingClientRect` consistent with scrollTop (messageDocTop
   * is the stable document-space offset) and exposes a mutable user-message
   * list so each test controls when the optimistic append lands in the DOM
   * (and which element holds the last slot).
   */
  function createAnchorEnv(options: { messageDocTop?: number } = {}) {
    let messageDocTop = options.messageDocTop ?? 900
    const listeners = new Map<string, EventListener>()
    let userMessages: { isConnected: boolean; detach: () => void; getBoundingClientRect: () => { top: number; height: number } }[] = []
    let spacerConnected = false
    const spacer = {
      style: { height: '' },
      get isConnected() { return spacerConnected },
      setAttribute: vi.fn(),
      remove: vi.fn(() => { spacerConnected = false }),
    }
    const column = { appendChild: vi.fn(() => { spacerConnected = true }) }
    const scrollContainer = {
      scrollTop: 0,
      scrollHeight: 980,
      clientHeight: 200,
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
      querySelector: vi.fn((selector: string) => (selector === '.max-w-3xl' ? column : null)),
      querySelectorAll: vi.fn((selector: string) => (selector === '.qf-user-message' ? [...userMessages] : [])),
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
      get userMessage() { return userMessages[userMessages.length - 1] },
      /** The optimistic user message commits into the DOM (a fresh node). */
      appendUserMessage() {
        let connected = true
        const message = {
          get isConnected() { return connected },
          detach() { connected = false },
          getBoundingClientRect: () => ({ top: messageDocTop - scrollContainer.scrollTop, height: 80 }),
        }
        userMessages = [...userMessages, message]
      },
      detachUserMessage() {
        userMessages[userMessages.length - 1]?.detach()
      },
      /** Simulate a layout shift above the message (e.g. fold re-fold). */
      shiftMessageDocTop(next: number) {
        messageDocTop = next
      },
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
    let now = 1000
    vi.stubGlobal('window', {
      performance: { now: () => now },
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
    })
    // One flushed frame == one 60fps tick; the wait loop's 1000ms timeout
    // expires after ~63 flushed frames.
    flushFrame = () => {
      now += 16
      const callbacks = frames.splice(0)
      for (const callback of callbacks) callback(now)
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

  /**
   * setup + enableWithAnchor + the optimistic message committing + the frame
   * in which the wait loop finds and anchors it.
   */
  function anchor(sync: ReturnType<typeof createScrollSync>) {
    sync.setup()
    sync.enableWithAnchor()
    env.appendUserMessage()
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
    expect(env.userMessage.getBoundingClientRect().top).toBe(12)
    expect(sync.isEnabled).toBe(true)
  })

  it('keeps waiting for the message when it commits later than a double rAF', () => {
    const sync = createScrollSync({ panel: env.panel })
    sync.setup()
    sync.enableWithAnchor()

    // The optimistic append is late (busy main thread): the old fixed
    // double-rAF deadline has passed and nothing must be anchored yet.
    flushFrame()
    flushFrame()
    expect(env.column.appendChild).not.toHaveBeenCalled()

    // The message lands on a later frame; the wait loop still picks it up.
    env.appendUserMessage()
    flushFrame()
    expect(env.column.appendChild).toHaveBeenCalledWith(env.spacer)
    expect(env.spacer.style.height).toBe('108px')
    expect(env.scrollContainer.scrollTop).toBe(888)
  })

  it('falls back to plain bottom-following when no user message appears before the wait timeout', () => {
    const sync = createScrollSync({ panel: env.panel })
    sync.setup()
    sync.enableWithAnchor()

    // >1000ms of frames without the message: fallback to enable().
    for (let i = 0; i < 70; i += 1) flushFrame()
    expect(env.column.appendChild).not.toHaveBeenCalled()
    expect(sync.isEnabled).toBe(true)
    expect(env.scrollContainer.scrollTop).toBe(980)
  })

  it('follows the message live when content above it shrinks and expands again', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    // Process groups above the message re-fold: content shrinks by 60px and
    // the message document offset moves up by the same amount. (The mock's
    // scrollHeight is the total including the 108px spacer.)
    env.scrollContainer.scrollHeight = 1028
    env.shiftMessageDocTop(840)
    resizeCallback?.([], {} as ResizeObserver)
    expect(env.scrollContainer.scrollTop).toBe(828)
    expect(env.spacer.style.height).toBe('108px')
    expect(env.userMessage.getBoundingClientRect().top).toBe(12)
    expect(env.spacer.remove).not.toHaveBeenCalled()

    // The groups expand back: the viewport re-follows the new position.
    env.scrollContainer.scrollHeight = 1088
    env.shiftMessageDocTop(900)
    resizeCallback?.([], {} as ResizeObserver)
    expect(env.scrollContainer.scrollTop).toBe(888)
    expect(env.userMessage.getBoundingClientRect().top).toBe(12)
  })

  it('shrinks the spacer as the reply grows and removes it once exhausted', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    // Reply grows below the message (content 980→1032, spacer still 108).
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

  it('writes no spacer when the sent message is taller than the viewport', () => {
    // Message spans content offsets 380..980 (600px tall > 200px viewport).
    env = createAnchorEnv({ messageDocTop: 380 })
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    // The 600px of content below the message top exceeds the 200px viewport,
    // so the anchor target is reachable without padding: the anchor exits
    // immediately and plain tail-following owns the position (the mock does
    // not clamp scrollTop, a real browser pins to maxScrollTop).
    expect(env.column.appendChild).not.toHaveBeenCalled()
    expect(env.scrollContainer.scrollTop).toBe(980)
    expect(sync.isEnabled).toBe(true)
  })

  it('exits the anchor without throwing when the anchored message node is removed', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)

    env.detachUserMessage()
    expect(() => resizeCallback?.([], {} as ResizeObserver)).not.toThrow()
    expect(env.spacer.remove).toHaveBeenCalled()
    expect(sync.isEnabled).toBe(true)
    // No dangling anchor state: later updates take the plain follow path.
    expect(() => resizeCallback?.([], {} as ResizeObserver)).not.toThrow()
  })

  it('resets state and re-anchors to the newest message on a second enableWithAnchor', () => {
    const sync = createScrollSync({ panel: env.panel })
    anchor(sync)
    expect(env.scrollContainer.scrollTop).toBe(888)

    // A second send before any cleanup: the active spacer is torn down and
    // the wait restarts against the *current* last user message.
    sync.enableWithAnchor()
    expect(env.spacer.remove).toHaveBeenCalled()

    env.appendUserMessage()
    flushFrame()
    expect(env.column.appendChild).toHaveBeenCalledTimes(2)
    expect(env.spacer.style.height).toBe('108px')
    expect(env.scrollContainer.scrollTop).toBe(888)
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
    env.appendUserMessage()
    flushFrame()
    expect(env.column.appendChild).toHaveBeenCalled()
    sync.cleanup()
    expect(env.spacer.remove).toHaveBeenCalled()
  })
})
