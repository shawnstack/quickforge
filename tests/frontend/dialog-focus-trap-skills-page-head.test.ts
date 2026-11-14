// @vitest-environment jsdom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsPageHead } from '@/components/skills/SkillsPageHead'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * 调用方回归：技能页头的搜索路径弹层声明了 role="dialog"，Tab 必须留在弹层里
 * （此前会飘到页头的「重新扫描」按钮上），Esc 收起弹层。
 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('SkillsPageHead focus trap', () => {
  let container: HTMLDivElement
  let root: Root
  let setPathsOpen: (open: boolean) => void
  let calls: boolean[]

  function Harness({ open }: { open: boolean }) {
    const popoverRef = useRef<HTMLDivElement>(null)
    return createElement(SkillsPageHead, {
      scope: 'global',
      searchPaths: ['/skills/a', '/skills/b'],
      pathsOpen: open,
      setPathsOpen,
      closeSourceMenu: () => {},
      pathsPopoverRef: popoverRef,
      copiedTarget: null,
      onCopyText: () => {},
      onRescan: () => {},
      busy: false,
      loading: false,
      refreshing: false,
    })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.ownerDocument?.body ?? null
      },
    })
    calls = []
    setPathsOpen = (open: boolean) => { calls.push(open) }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(Harness, { open: true })))
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

  function pressEscape(): void {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
  }

  function pathButtons(): HTMLElement[] {
    const popover = container.querySelector('.quickforge-skills-popover')
    return Array.from(popover?.querySelectorAll('button') ?? []) as HTMLElement[]
  }

  it('弹层里渲染出每个搜索路径的复制按钮', () => {
    expect(container.querySelector('.quickforge-skills-popover')).not.toBeNull()
    expect(pathButtons()).toHaveLength(2)
  })

  it('焦点在最后一个按钮时，Tab 回到第一个', () => {
    const buttons = pathButtons()
    act(() => buttons[buttons.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('焦点在弹窗外时，Tab 拉回弹层第一个按钮', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(pathButtons()[0])
    outside.remove()
  })

  it('Esc 收起弹层', () => {
    pressEscape()
    expect(calls).toEqual([false])
  })
})
