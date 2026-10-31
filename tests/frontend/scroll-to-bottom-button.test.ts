import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appCss } from '../helpers/app-css'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

import { createScrollToBottomButton } from '../../src/components/chat/panel-decoration/scroll-to-bottom-button'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

class FakeElement {
  tagName: string
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  type = ''
  innerHTML = ''
  title = ''
  textContent = ''
  private classSet = new Set<string>()
  private attributes = new Map<string, string>()
  private listeners = new Map<string, Array<(event: Partial<Event>) => void>>()

  constructor(tag: string) {
    this.tagName = tag
  }

  get className() {
    return [...this.classSet].join(' ')
  }

  set className(value: string) {
    this.classSet = new Set(value.split(/\s+/).filter(Boolean))
  }

  get classList() {
    return {
      add: (...names: string[]) => names.forEach((name) => this.classSet.add(name)),
      remove: (...names: string[]) => names.forEach((name) => this.classSet.delete(name)),
      toggle: (name: string, force?: boolean) => {
        const next = force ?? !this.classSet.has(name)
        if (next) this.classSet.add(name)
        else this.classSet.delete(name)
        return next
      },
      contains: (name: string) => this.classSet.has(name),
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  addEventListener(type: string, listener: (event: Partial<Event>) => void) {
    const arr = this.listeners.get(type) ?? []
    arr.push(listener)
    this.listeners.set(type, arr)
  }

  removeEventListener(type: string, listener: (event: Partial<Event>) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener))
  }

  dispatch(type: string, event: Partial<Event> = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
  }

  append(child: FakeElement) {
    child.parentElement?.removeChild(child)
    this.children.push(child)
    child.parentElement = this
  }

  removeChild(child: FakeElement) {
    this.children = this.children.filter((item) => item !== child)
    child.parentElement = null
  }

  remove() {
    this.parentElement?.removeChild(this)
  }
}

function createEnv() {
  const scrollContainer = Object.assign(new FakeElement('div'), {
    scrollTop: 696,
    scrollHeight: 1244,
    clientHeight: 548,
    scrollTo: vi.fn(),
  }) as unknown as FakeElement & {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    scrollTo: ReturnType<typeof vi.fn>
  }
  const shell = new FakeElement('div')
  let shellAvailable = true
  const panel = {
    querySelector: (selector: string) => {
      if (selector === '.qf-chat-panel .qf-scroll-container') return scrollContainer
      if (selector === '.quickforge-composer-shell') return shellAvailable ? shell : null
      return null
    },
  } as unknown as HTMLElement

  return {
    panel,
    scrollContainer,
    shell,
    setShellAvailable: (available: boolean) => { shellAvailable = available },
    setDistance: (px: number) => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight - px
    },
    button: () => shell.children[0],
    badge: () => shell.children[0]?.children[0] as FakeElement | undefined,
  }
}

let currentTimeouts: Array<() => void> = []
let currentMatchMedia: ReturnType<typeof vi.fn> = vi.fn(() => ({ matches: false }))

beforeEach(() => {
  currentTimeouts = []
  currentMatchMedia = vi.fn(() => ({ matches: false }))
  vi.stubGlobal('window', {
    performance: { now: () => 1000 },
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => {
      currentTimeouts.push(callback)
      return currentTimeouts.length
    }),
    clearTimeout: vi.fn(),
    get matchMedia() { return currentMatchMedia },
  })
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) })
})

afterEach(() => {
  vi.stubGlobal('window', originalWindow)
  vi.stubGlobal('document', originalDocument)
  currentTimeouts = []
})

function flushTimeouts() {
  const pending = [...currentTimeouts]
  currentTimeouts = []
  pending.forEach((callback) => callback())
}

describe('scroll-to-bottom button', () => {
  it('stays hidden near the bottom and appears beyond the show threshold', () => {
    const env = createEnv()
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled })

    env.setDistance(50)
    controller.setup()
    expect(env.button()).toBeDefined()
    expect(env.button()!.classList.contains('is-visible')).toBe(false)

    env.setDistance(400)
    env.scrollContainer.dispatch('scroll')
    expect(env.button()!.classList.contains('is-visible')).toBe(true)
  })

  it('refreshes from the resize observer instead of measuring on every setup', () => {
    class TestResizeObserver {
      static latest: TestResizeObserver | null = null
      private callback: () => void
      disconnected = false

      constructor(callback: () => void) {
        this.callback = callback
        TestResizeObserver.latest = this
      }

      observe() {}

      disconnect() {
        this.disconnected = true
      }

      trigger() {
        this.callback()
      }
    }

    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    try {
      const env = createEnv()
      const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled: vi.fn() })
      controller.setup()
      const observer = TestResizeObserver.latest
      expect(observer).not.toBeNull()

      // A steady-state setup replays the cached distance: it must not pick up
      // the new geometry synchronously (that is the forced-layout path).
      env.setDistance(400)
      controller.setup()
      expect(env.button()!.classList.contains('is-visible')).toBe(false)

      observer!.trigger()
      expect(env.button()!.classList.contains('is-visible')).toBe(true)

      controller.cleanup()
      expect(observer!.disconnected).toBe(true)
    } finally {
      vi.stubGlobal('ResizeObserver', undefined)
    }
  })

  it('uses a hysteresis band so the threshold never flickers', () => {
    const env = createEnv()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled: vi.fn() })

    const visibleAt = (distance: number) => {
      env.setDistance(distance)
      env.scrollContainer.dispatch('scroll')
      return env.button()!.classList.contains('is-visible')
    }

    controller.setup()
    expect(visibleAt(400)).toBe(true) // shown beyond 280
    expect(visibleAt(200)).toBe(true) // inside the band stays visible
    expect(visibleAt(100)).toBe(false) // hidden below 120
    expect(visibleAt(200)).toBe(false) // inside the band stays hidden
  })

  it('counts unread assistant messages only while visible and clears on return', () => {
    const env = createEnv()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled: vi.fn() })

    controller.setup()
    controller.notifyNewAssistantMessage()
    controller.notifyNewAssistantMessage()
    expect(env.badge()!.classList.contains('quickforge-scroll-bottom-badge-empty')).toBe(true)
    expect(env.button()!.getAttribute('aria-label')).toBe('scrollToBottomLabel')

    env.setDistance(400)
    env.scrollContainer.dispatch('scroll')
    controller.notifyNewAssistantMessage()
    controller.notifyNewAssistantMessage()
    controller.notifyNewAssistantMessage()
    expect(env.badge()!.textContent).toBe('3')
    expect(env.badge()!.classList.contains('quickforge-scroll-bottom-badge-empty')).toBe(false)
    expect(env.button()!.getAttribute('aria-label')).toBe('scrollToBottomUnreadLabel')

    env.setDistance(50)
    env.scrollContainer.dispatch('scroll')
    expect(env.badge()!.classList.contains('quickforge-scroll-bottom-badge-empty')).toBe(true)
    expect(env.button()!.getAttribute('aria-label')).toBe('scrollToBottomLabel')
  })

  it('jump hides the button, smooth-scrolls, then resumes tail-following', () => {
    const env = createEnv()
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled })

    controller.setup()
    env.setDistance(400)
    env.scrollContainer.dispatch('scroll')
    env.button()!.dispatch('click')

    expect(env.button()!.classList.contains('is-visible')).toBe(false)
    expect(env.scrollContainer.scrollTo).toHaveBeenCalledWith({
      top: env.scrollContainer.scrollHeight - env.scrollContainer.clientHeight,
      behavior: 'smooth',
    })
    expect(onJumpSettled).not.toHaveBeenCalled()
    flushTimeouts()
    expect(onJumpSettled).toHaveBeenCalledTimes(1)
  })

  it('a wheel-up during the jump cancels the resume of tail-following', () => {
    const env = createEnv()
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled })

    controller.setup()
    env.setDistance(400)
    env.scrollContainer.dispatch('scroll')
    env.button()!.dispatch('click')
    env.scrollContainer.dispatch('wheel', { deltaY: -3 })
    flushTimeouts()

    expect(onJumpSettled).not.toHaveBeenCalled()
  })

  it('jumps instantly without smooth scrolling under reduced motion', () => {
    const env = createEnv()
    currentMatchMedia = vi.fn(() => ({ matches: true }))
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled })

    controller.setup()
    env.setDistance(400)
    env.scrollContainer.dispatch('scroll')
    env.button()!.dispatch('click')

    expect(env.scrollContainer.scrollTo).not.toHaveBeenCalled()
    expect(env.scrollContainer.scrollTop).toBe(env.scrollContainer.scrollHeight - env.scrollContainer.clientHeight)
    expect(onJumpSettled).toHaveBeenCalledTimes(1)
  })

  it('restores the visible state when the composer dock is rebuilt', () => {
    const env = createEnv()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled: vi.fn() })

    controller.setup()
    env.setDistance(400)
    env.scrollContainer.dispatch('scroll')
    expect(env.button()!.classList.contains('is-visible')).toBe(true)

    env.setShellAvailable(false)
    controller.setup()
    env.setShellAvailable(true)
    controller.setup()

    expect(env.button()!.classList.contains('is-visible')).toBe(true)
  })

  it('removes the button when the composer dock is gone (read-only sessions)', () => {
    const env = createEnv()
    const controller = createScrollToBottomButton({ panel: env.panel, onJumpSettled: vi.fn() })

    controller.setup()
    expect(env.shell.children.length).toBe(1)

    env.setShellAvailable(false)
    controller.setup()
    expect(env.shell.children.length).toBe(0)
  })
})

describe('scroll-to-bottom button wiring', () => {
  it('ships the centered floating styles with empty-host and dark handling', () => {
    const css = appCss

    expect(css).toContain('.quickforge-scroll-bottom-button')
    expect(css).toContain('.quickforge-chat-panel-empty-host .quickforge-scroll-bottom-button')
    expect(css).toContain('html.dark .quickforge-scroll-bottom-badge')
    expect(css).toContain('.quickforge-scroll-bottom-button {\n    transition: none;\n  }')
  })

  it('keeps steady-state setup off the layout path', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/scroll-to-bottom-button.ts', import.meta.url), 'utf8')

    // Geometry growth must arrive through ResizeObserver; repeated decoration
    // passes may only re-apply the cached distance.
    expect(source).toContain('new ResizeObserver(handleScroll)')
    expect(source).toContain('if (!resizeObserver || resizeObserver !== previousObserver || measuredDistance === null) handleScroll()')
    expect(source).toContain('else applyVisibility()')
  })

  it('is wired into the panel lifecycle and assistant message events', () => {
    const source = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')

    expect(source).toContain('scrollBottomButton.setup()')
    expect(source).toContain('scrollBottomButton.cleanup()')
    expect(source).toContain('scrollBottomButton.notifyNewAssistantMessage()')
  })

  it('provides localized labels for both languages', () => {
    const source = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

    expect(source.match(/scrollToBottomLabel: 'Scroll to bottom'/g)).toHaveLength(1)
    expect(source.match(/scrollToBottomLabel: '回到底部'/g)).toHaveLength(1)
    expect(source).toContain("scrollToBottomUnreadLabel: 'Scroll to bottom ({count} new messages)'")
    expect(source).toContain("scrollToBottomUnreadLabel: '回到底部({count} 条新消息)'")
  })
})
