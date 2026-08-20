import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

function createHarness() {
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
      if (selector === 'agent-interface .overflow-y-auto') return scrollContainer
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
    const harness = createHarness()
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled })

    harness.setDistance(50)
    controller.setup()
    expect(harness.button()).toBeDefined()
    expect(harness.button()!.classList.contains('is-visible')).toBe(false)

    harness.setDistance(400)
    harness.scrollContainer.dispatch('scroll')
    expect(harness.button()!.classList.contains('is-visible')).toBe(true)
  })

  it('uses a hysteresis band so the threshold never flickers', () => {
    const harness = createHarness()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled: vi.fn() })

    const visibleAt = (distance: number) => {
      harness.setDistance(distance)
      harness.scrollContainer.dispatch('scroll')
      return harness.button()!.classList.contains('is-visible')
    }

    controller.setup()
    expect(visibleAt(400)).toBe(true) // shown beyond 280
    expect(visibleAt(200)).toBe(true) // inside the band stays visible
    expect(visibleAt(100)).toBe(false) // hidden below 120
    expect(visibleAt(200)).toBe(false) // inside the band stays hidden
  })

  it('counts unread assistant messages only while visible and clears on return', () => {
    const harness = createHarness()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled: vi.fn() })

    controller.setup()
    controller.notifyNewAssistantMessage()
    controller.notifyNewAssistantMessage()
    expect(harness.badge()!.classList.contains('quickforge-scroll-bottom-badge-empty')).toBe(true)
    expect(harness.button()!.getAttribute('aria-label')).toBe('scrollToBottomLabel')

    harness.setDistance(400)
    harness.scrollContainer.dispatch('scroll')
    controller.notifyNewAssistantMessage()
    controller.notifyNewAssistantMessage()
    controller.notifyNewAssistantMessage()
    expect(harness.badge()!.textContent).toBe('3')
    expect(harness.badge()!.classList.contains('quickforge-scroll-bottom-badge-empty')).toBe(false)
    expect(harness.button()!.getAttribute('aria-label')).toBe('scrollToBottomUnreadLabel')

    harness.setDistance(50)
    harness.scrollContainer.dispatch('scroll')
    expect(harness.badge()!.classList.contains('quickforge-scroll-bottom-badge-empty')).toBe(true)
    expect(harness.button()!.getAttribute('aria-label')).toBe('scrollToBottomLabel')
  })

  it('jump hides the button, smooth-scrolls, then resumes tail-following', () => {
    const harness = createHarness()
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled })

    controller.setup()
    harness.setDistance(400)
    harness.scrollContainer.dispatch('scroll')
    harness.button()!.dispatch('click')

    expect(harness.button()!.classList.contains('is-visible')).toBe(false)
    expect(harness.scrollContainer.scrollTo).toHaveBeenCalledWith({
      top: harness.scrollContainer.scrollHeight - harness.scrollContainer.clientHeight,
      behavior: 'smooth',
    })
    expect(onJumpSettled).not.toHaveBeenCalled()
    flushTimeouts()
    expect(onJumpSettled).toHaveBeenCalledTimes(1)
  })

  it('a wheel-up during the jump cancels the resume of tail-following', () => {
    const harness = createHarness()
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled })

    controller.setup()
    harness.setDistance(400)
    harness.scrollContainer.dispatch('scroll')
    harness.button()!.dispatch('click')
    harness.scrollContainer.dispatch('wheel', { deltaY: -3 })
    flushTimeouts()

    expect(onJumpSettled).not.toHaveBeenCalled()
  })

  it('jumps instantly without smooth scrolling under reduced motion', () => {
    const harness = createHarness()
    currentMatchMedia = vi.fn(() => ({ matches: true }))
    const onJumpSettled = vi.fn()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled })

    controller.setup()
    harness.setDistance(400)
    harness.scrollContainer.dispatch('scroll')
    harness.button()!.dispatch('click')

    expect(harness.scrollContainer.scrollTo).not.toHaveBeenCalled()
    expect(harness.scrollContainer.scrollTop).toBe(harness.scrollContainer.scrollHeight - harness.scrollContainer.clientHeight)
    expect(onJumpSettled).toHaveBeenCalledTimes(1)
  })

  it('removes the button when the composer dock is gone (read-only sessions)', () => {
    const harness = createHarness()
    const controller = createScrollToBottomButton({ panel: harness.panel, onJumpSettled: vi.fn() })

    controller.setup()
    expect(harness.shell.children.length).toBe(1)

    harness.setShellAvailable(false)
    controller.setup()
    expect(harness.shell.children.length).toBe(0)
  })
})

describe('scroll-to-bottom button wiring', () => {
  it('ships the centered floating styles with empty-host and dark handling', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(css).toContain('.quickforge-scroll-bottom-button')
    expect(css).toContain('.quickforge-chat-panel-empty-host .quickforge-scroll-bottom-button')
    expect(css).toContain('html.dark .quickforge-scroll-bottom-badge')
    expect(css).toContain('.quickforge-scroll-bottom-button {\n    transition: none;\n  }')
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
