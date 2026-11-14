// @vitest-environment jsdom
/* eslint-disable react-hooks/refs -- 测试宿主要把 ref 交给 createElement，值只在钩子 effect 里读，渲染期不取 current */
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarSearchDialog, type SidebarSearchResult } from '@/components/sidebar/chat-sidebar/SidebarSearchDialog'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * 调用方回归：确认 `useDialogFocusTrap` 真的挂在了搜索弹窗上（钩子自身的行为
 * 在 use-dialog-focus-trap.test.ts 里覆盖）。这条路径以前 Tab 会跑到背后的侧栏。
 */
const results: SidebarSearchResult[] = [
  { session: { id: 's1', title: 'alpha', lastModified: Date.now() } as never, projectName: 'quickforge' },
  { session: { id: 's2', title: 'beta', lastModified: Date.now() } as never, projectName: 'quickforge' },
]

function Harness() {
  const inputRef = useRef<HTMLInputElement>(null)
  return createElement(SidebarSearchDialog, {
    query: 'a',
    results,
    inputRef,
    onQueryChange: () => {},
    onClose: () => {},
    onSelectResult: () => {},
  })
}

const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('SidebarSearchDialog focus trap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.ownerDocument?.body ?? null
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(Harness)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (realOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
    }
  })

  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  it('渲染出输入框与两条结果', () => {
    expect(container.querySelector('input')).not.toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })

  it('焦点在最后一条结果时，Tab 回到搜索输入框', () => {
    const input = container.querySelector('input') as HTMLElement
    const buttons = Array.from(container.querySelectorAll('button'))
    act(() => buttons[buttons.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('焦点在输入框时，Shift+Tab 落到最后一条结果', () => {
    const input = container.querySelector('input') as HTMLElement
    const buttons = Array.from(container.querySelectorAll('button'))
    act(() => input.focus())

    expect(pressTab(true)).toBe(true)
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
  })
})
