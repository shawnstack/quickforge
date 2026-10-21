// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageEditor } from '../../src/components/chat/surface/MessageEditor'

/**
 * The composer's action button is React-owned: the panel decoration used to
 * toggle its waiting class, write `title`/`aria-label`, and install a capture
 * phase stop handler. All of that now lives here, so these cases replace the old
 * `syncSendStopButton` unit tests with render-level assertions — same contracts,
 * asserted against the component that owns the DOM.
 */
describe('composer action button', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: Record<string, unknown>) {
    act(() => {
      root.render(createElement(MessageEditor, { value: '', ...props }))
    })
  }

  function stopButton() {
    return container.querySelector<HTMLButtonElement>('.quickforge-stop-button')
  }

  function sendButton() {
    return container.querySelector<HTMLButtonElement>('.quickforge-send-button')
  }

  it('shows the waiting ring while streaming without assistant output', () => {
    render({ isStreaming: true, isWaiting: true })

    const button = stopButton()
    expect(button).not.toBeNull()
    expect(button!.classList.contains('quickforge-stop-button--waiting')).toBe(true)
    expect(button!.disabled).toBe(false)
    // Literal "Stop" matches what the decoration layer always wrote while
    // streaming; using the translated string here would change the tooltip.
    expect(button!.title).toBe('Stop')
    expect(button!.getAttribute('aria-label')).toBe('Stop')
  })

  it('leaves the waiting class off once assistant output started', () => {
    render({ isStreaming: true, isWaiting: false })

    expect(stopButton()!.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('defaults to not waiting', () => {
    render({ isStreaming: true })

    expect(stopButton()!.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('drops the waiting ring when the first assistant delta arrives', () => {
    render({ isStreaming: true, isWaiting: true })
    expect(stopButton()!.classList.contains('quickforge-stop-button--waiting')).toBe(true)

    render({ isStreaming: true, isWaiting: false })
    expect(stopButton()!.classList.contains('quickforge-stop-button--waiting')).toBe(false)
  })

  it('keeps the React-owned base classes untouched', () => {
    render({ isStreaming: true, isWaiting: true })

    const button = stopButton()!
    expect(button.classList.contains('quickforge-stop-button')).toBe(true)
    expect(button.classList.contains('quickforge-send-button')).toBe(false)
  })

  it('aborts on pointerdown before any other handler sees the event', () => {
    const onAbort = vi.fn()
    const onBeforeAbort = vi.fn()
    const order: string[] = []
    onBeforeAbort.mockImplementation(() => order.push('dismiss'))
    onAbort.mockImplementation(() => order.push('abort'))
    render({ isStreaming: true, onAbort, onBeforeAbort })

    const button = stopButton()!
    // A bubble-phase listener on an ancestor must never run: the decoration used
    // a capture listener plus `stopImmediatePropagation` for exactly this.
    const ancestor = vi.fn()
    container.addEventListener('pointerdown', ancestor)
    act(() => {
      button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    container.removeEventListener('pointerdown', ancestor)

    expect(order).toEqual(['dismiss', 'abort'])
    expect(ancestor).not.toHaveBeenCalled()
  })

  it('aborts via keyboard activation', () => {
    const onAbort = vi.fn()
    const onBeforeAbort = vi.fn()
    render({ isStreaming: true, onAbort, onBeforeAbort })

    act(() => {
      stopButton()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })

    expect(onBeforeAbort).toHaveBeenCalledTimes(1)
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('renders the send button when not streaming', () => {
    render({ isStreaming: false })

    expect(stopButton()).toBeNull()
    expect(sendButton()).not.toBeNull()
  })
})
