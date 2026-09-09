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
  const agentInterface = { setAutoScroll }
  const panel = {
    querySelector: vi.fn((selector: string) => {
      if (selector === 'agent-interface .overflow-y-auto') return scrollContainer
      if (selector === 'agent-interface') return agentInterface
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
  it('does not load older messages when programmatic navigation reaches the top', () => {
    const env = createEnv()
    const onReachTop = vi.fn()
    const sync = createScrollSync({ panel: env.panel, onReachTop })
    sync.setup()

    const end = sync.beginProgrammaticScroll()
    env.scrollContainer.scrollTop = 0
    env.dispatch('scroll')

    expect(onReachTop).not.toHaveBeenCalled()
    expect(sync.isEnabled).toBe(false)
    end()
  })

  it('still loads older messages when a real user scrolls to the top', () => {
    const env = createEnv()
    const onReachTop = vi.fn()
    const sync = createScrollSync({ panel: env.panel, onReachTop })
    sync.setup()

    env.dispatch('wheel', { deltaY: -1 } as Partial<WheelEvent>)
    env.scrollContainer.scrollTop = 0
    env.dispatch('scroll')

    expect(onReachTop).toHaveBeenCalledTimes(1)
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
    const sync = createScrollSync({ panel: env.panel })
    sync.setup()

    const end = sync.beginProgrammaticScroll()
    env.scrollContainer.scrollTop = 850
    env.dispatch('scroll')

    expect(sync.isEnabled).toBe(false)
    expect(env.setAutoScroll).toHaveBeenLastCalledWith(false)
    end()
  })
})
