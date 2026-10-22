// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingLevelControl, THINKING_LEVELS, thinkingLevelLabel } from '../../src/components/chat/surface/ThinkingLevelControl'

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => (
    params ? `${key}:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}` : key
  ),
}))

/**
 * The thinking-level selector used to be injected into the composer's right-hand
 * control row by `panel-decoration/thinking-level-controls.ts`: it created the
 * button, wrote its label/`aria-expanded` every pass, appended the menu to
 * `document.body`, positioned it from `getBoundingClientRect`/`offsetHeight` and
 * registered capture-phase pointerdown/keydown/resize/scroll listeners.
 *
 * React renders the button and menu now. These cases pin the interaction
 * contract the decoration implemented: open on pointerdown (so the textarea
 * selection survives), toggle closed on a second press, close on outside press
 * or Escape, apply the level only on a different item, and keep the menu
 * keyboard reachable.
 */
describe('thinking level control', () => {
  let container: HTMLDivElement
  let root: Root
  let onChange: ReturnType<typeof vi.fn>
  let onBeforeOpen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onChange = vi.fn()
    onBeforeOpen = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(level: 'off' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium') {
    act(() => {
      root.render(createElement(ThinkingLevelControl, {
        level,
        onChange: onChange as never,
        onBeforeOpen: onBeforeOpen as never,
      }))
    })
  }

  const trigger = () => container.querySelector<HTMLButtonElement>('.quickforge-thinking-inline')
  const menu = () => document.querySelector<HTMLElement>('.quickforge-thinking-menu')
  const items = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.quickforge-thinking-item'))

  function openWithPointer() {
    act(() => {
      trigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
  }

  it('exposes the level vocabulary and labels', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    expect(thinkingLevelLabel('xhigh')).toBe('thinkingXHigh')
    expect(thinkingLevelLabel('off')).toBe('thinkingOff')
  })

  it('renders the trigger with the current level and menu semantics', () => {
    render('medium')

    const button = trigger()!
    expect(button.dataset.quickforgeThinkingLevel).toBe('medium')
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('thinkingLevel: thinkingMedium')
    expect(button.querySelector('.quickforge-thinking-label')!.textContent).toBe('thinkingMedium')
    expect(button.querySelector('.quickforge-thinking-icon')).not.toBeNull()
    expect(button.querySelector('.quickforge-thinking-chevron')).not.toBeNull()
  })

  it('opens on pointerdown and closes on a second press', () => {
    render()
    openWithPointer()

    expect(trigger()!.getAttribute('aria-expanded')).toBe('true')
    expect(menu()).not.toBeNull()
    expect(items().map((item) => item.dataset.quickforgeThinkingLevel))
      .toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    // The current level is marked, not just styled.
    expect(items().find((item) => item.dataset.quickforgeThinkingLevel === 'medium')!.getAttribute('aria-checked'))
      .toBe('true')

    openWithPointer()
    expect(trigger()!.getAttribute('aria-expanded')).toBe('false')
    expect(menu()).toBeNull()
  })

  it('closes the other composer popovers before opening', () => {
    render()
    openWithPointer()
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)
  })

  it('applies a different level and closes; re-picking the current one only closes', () => {
    render('medium')
    openWithPointer()

    act(() => {
      items().find((item) => item.dataset.quickforgeThinkingLevel === 'medium')!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(menu()).toBeNull()

    openWithPointer()
    act(() => {
      items().find((item) => item.dataset.quickforgeThinkingLevel === 'high')!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(onChange).toHaveBeenCalledWith('high')
    expect(menu()).toBeNull()
  })

  it('closes on an outside pointerdown and on Escape, keeping the level', () => {
    render()
    openWithPointer()
    expect(menu()).not.toBeNull()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    openWithPointer()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens from the keyboard (Enter, Space, ArrowDown)', () => {
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      render()
      act(() => {
        trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })
      expect(menu(), `key ${key}`).not.toBeNull()
      // Close again so the next iteration starts from a known state.
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
    }
  })

  it('renders disabled and does not open (Side Chat keeps it inert)', () => {
    act(() => {
      root.render(createElement(ThinkingLevelControl, {
        level: 'medium',
        onChange: onChange as never,
        disabled: true,
      }))
    })

    expect(trigger()!.disabled).toBe(true)
    act(() => {
      trigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(menu()).toBeNull()
    expect(trigger()!.getAttribute('aria-expanded')).toBe('false')
  })

  it('tracks the trigger rect so the fixed menu stays glued to it', () => {
    render()
    // The menu is fixed-positioned; the first frame places it off-screen so it
    // can be measured, then the layout effect writes the real coordinates.
    const button = trigger()!
    button.getBoundingClientRect = () => ({ left: 400, top: 300, right: 460, bottom: 332, width: 60, height: 32, x: 400, y: 300, toJSON: () => ({}) }) as DOMRect

    openWithPointer()
    const element = menu()!
    expect(element.style.left).not.toBe('')
    expect(element.style.top).not.toBe('')
    expect(Number.parseFloat(element.style.left)).toBeGreaterThan(0)
  })
})
