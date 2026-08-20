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

function createHarness() {
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
    const harness = createHarness()

    // Seed the send-state marker so the stop branch runs against a "was send" button.
    harness.button.dataset.quickforgeSendIcon = 'arrow-up'
    harness.sync({ isStreaming: true, isWaiting: () => true })

    expect(harness.button.classList.contains('quickforge-stop-button')).toBe(true)
    expect(harness.button.classList.contains('quickforge-stop-button--waiting')).toBe(true)
    expect(harness.button.classList.contains('quickforge-send-button')).toBe(false)
    expect(harness.button.disabled).toBe(false)
    expect(harness.button.title).toBe('Stop')
    expect(harness.attributes['aria-label']).toBe('Stop')

    // Stop handler is wired in the capture phase on both pointerdown and click.
    const captureListeners = harness.listeners.filter((entry) => entry.capture)
    expect(captureListeners.map((entry) => entry.type).sort()).toEqual(['click', 'pointerdown'])
    const handler = harness.button.__quickforgeStopHandler
    expect(handler).toBeTypeOf('function')
    const stopEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as Event
    handler?.(stopEvent)
    expect(harness.abort).toHaveBeenCalledTimes(1)
  })

  it('leaves the waiting class off once assistant output started', () => {
    const harness = createHarness()
    harness.sync({ isStreaming: true, isWaiting: () => false })

    expect(harness.button.classList.contains('quickforge-stop-button')).toBe(true)
    expect(harness.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('defaults to not waiting when isWaiting is not provided', () => {
    const harness = createHarness()
    harness.sync({ isStreaming: true })

    expect(harness.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('clears the waiting ring when the first assistant delta arrives', () => {
    const harness = createHarness()
    harness.sync({ isStreaming: true, isWaiting: () => true })
    expect(harness.button.classList.contains('quickforge-stop-button--waiting')).toBe(true)

    harness.sync({ isStreaming: true, isWaiting: () => false })
    expect(harness.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
    expect(harness.button.classList.contains('quickforge-stop-button')).toBe(true)
  })

  it('restores the send button (and drops the waiting ring) when streaming ends', () => {
    const harness = createHarness()
    harness.sync({ isStreaming: true, isWaiting: () => true })

    harness.sync({ isStreaming: false, isWaiting: () => true })

    expect(harness.button.classList.contains('quickforge-stop-button')).toBe(false)
    expect(harness.button.classList.contains('quickforge-stop-button--waiting')).toBe(false)
    expect(harness.button.classList.contains('quickforge-send-button')).toBe(true)
    expect(harness.button.dataset.quickforgeSendIcon).toBe('arrow-up')
    // Capture-phase stop handlers are removed again.
    expect(harness.listeners.filter((entry) => entry.capture)).toHaveLength(0)
  })
})
