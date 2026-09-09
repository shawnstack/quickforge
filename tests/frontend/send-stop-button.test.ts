import { describe, expect, it, vi } from 'vitest'

// The project's vitest setup runs in a node environment without jsdom;
// replaceSvg touches `document`, so it is stubbed while the rest of
// chat-utils stays real.
vi.mock('../../src/components/chat/chat-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/chat/chat-utils')>()
  return { ...actual, replaceSvg: vi.fn() }
})

import { syncSendStopButton } from '../../src/components/chat/panel-decoration/send-stop-button'
import type { QuickForgeActionButton } from '../../src/components/chat/chat-utils'

class FakeClassList {
  private names = new Set<string>()
  add(...items: string[]) { items.forEach((name) => this.names.add(name)) }
  remove(...items: string[]) { items.forEach((name) => this.names.delete(name)) }
  toggle(name: string, force?: boolean) {
    const enable = force ?? !this.names.has(name)
    if (enable) this.names.add(name)
    else this.names.delete(name)
    return enable
  }
  contains(name: string) { return this.names.has(name) }
}

function createEnv() {
  const listeners: Array<{ type: string; handler: unknown; capture: boolean }> = []
  const attributes: Record<string, string> = {}
  const button = {
    disabled: true,
    title: '',
    classList: new FakeClassList(),
    dataset: {} as Record<string, string>,
    __quickforgeStopHandler: undefined as ((event: Event) => void) | undefined,
    addEventListener: (type: string, handler: unknown, capture?: unknown) => {
      listeners.push({ type, handler, capture: Boolean(capture) })
    },
    removeEventListener: (type: string, handler: unknown, capture?: unknown) => {
      const index = listeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === Boolean(capture))
      if (index >= 0) listeners.splice(index, 1)
    },
    setAttribute: (name: string, value: string) => { attributes[name] = value },
    querySelector: () => null,
  }
  const rightControls = {
    querySelector: (selector: string) => (selector === 'button:last-child' ? button : null),
  }
  const abort = vi.fn()
  const removeCommandSuggestions = vi.fn()
  const sync = (options: { isStreaming: boolean; isWaiting?: () => boolean }) => {
    syncSendStopButton({
      rightControls: rightControls as unknown as HTMLElement,
      isStreaming: () => options.isStreaming,
      isWaiting: options.isWaiting,
      abort,
      removeCommandSuggestions,
    })
  }
  return {
    button: button as unknown as QuickForgeActionButton & typeof button,
    listeners,
    attributes,
    abort,
    removeCommandSuggestions,
    sync,
  }
}

describe('syncSendStopButton', () => {
  it('renders the waiting ring while streaming without assistant output', () => {
    const env = createEnv()

    // Seed the send-state marker so the stop branch runs against a "was send" button.
    env.button.dataset.quickforgeSendIcon = 'arrow-up'
    env.sync({ isStreaming: true, isWaiting: () => true })

    expect(env.button.classList.contains('quickforge-stop-button')).toBe(true)
    expect(env.button.classList.contains('quickforge-stop-button--waiting')).toBe(true)
    expect(env.button.classList.contains('quickforge-send-button')).toBe(false)
    expect(env.button.disabled).toBe(false)
    expect(env.button.title).toBe('Stop')
    expect(env.attributes['aria-label']).toBe('Stop')

    // Stop handler is wired in the capture phase on both pointerdown and click.
    const captureListeners = env.listeners.filter((entry) => entry.capture)
    expect(captureListeners.map((entry) => entry.type).sort()).toEqual(['click', 'pointerdown'])
    const handler = env.button.__quickforgeStopHandler
    expect(handler).toBeTypeOf('function')
    const stopEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as Event
    handler?.(stopEvent)
    expect(env.abort).toHaveBeenCalledTimes(1)
  })

  it('leaves the waiting class off once assistant output started', () => {
    const env = createEnv()
    env.sync({ isStreaming: true, isWaiting: () => false })

    expect(env.button.classList.contains('quickforge-stop-button')).toBe(true)
    expect(env.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('defaults to not waiting when isWaiting is not provided', () => {
    const env = createEnv()
    env.sync({ isStreaming: true })

    expect(env.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('clears the waiting ring when the first assistant delta arrives', () => {
    const env = createEnv()
    env.sync({ isStreaming: true, isWaiting: () => true })
    expect(env.button.classList.contains('quickforge-stop-button--waiting')).toBe(true)

    env.sync({ isStreaming: true, isWaiting: () => false })
    expect(env.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
    expect(env.button.classList.contains('quickforge-stop-button')).toBe(true)
  })

  it('restores the send button (and drops the waiting ring) when streaming ends', () => {
    const env = createEnv()
    env.sync({ isStreaming: true, isWaiting: () => true })

    env.sync({ isStreaming: false, isWaiting: () => true })

    expect(env.button.classList.contains('quickforge-stop-button')).toBe(false)
    expect(env.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
    expect(env.button.classList.contains('quickforge-send-button')).toBe(true)
    expect(env.button.dataset.quickforgeSendIcon).toBe('arrow-up')
    // Capture-phase stop handlers are removed again.
    expect(env.listeners.filter((entry) => entry.capture)).toHaveLength(0)
  })
})
