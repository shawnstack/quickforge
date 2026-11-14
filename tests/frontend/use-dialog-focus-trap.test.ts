// @vitest-environment jsdom
/* eslint-disable react-hooks/refs -- 测试宿主要把 ref 交给 createElement，值只在钩子 effect 里读，渲染期不取 current */
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDialogFocusTrap, type DialogFocusTrapOptions } from '@/hooks/useDialogFocusTrap'

/**
 * 焦点陷阱的最小宿主：两个按钮，够验证首尾循环与「焦点在弹窗外」两条路径。
 * 真实组件里同一个钩子挂在整个面板上，行为完全一样。
 */
function TrapHarness(options: DialogFocusTrapOptions) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocusTrap(ref, options)
  return createElement(
    'div',
    { ref, 'data-testid': 'dialog' },
    createElement('button', { type: 'button', 'data-slot': 'first' }, 'first'),
    createElement('button', { type: 'button', 'data-slot': 'last' }, 'last'),
  )
}

/** jsdom 没有布局，`offsetParent` 恒为 null，钩子会把所有控件判成不可见；这里让它有值。 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('useDialogFocusTrap', () => {
  let container: HTMLDivElement
  let trigger: HTMLButtonElement
  let root: Root
  let unmounted: boolean

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
    trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.textContent = 'trigger'
    document.body.appendChild(trigger)
    root = createRoot(container)
    unmounted = false
  })

  afterEach(() => {
    if (!unmounted) act(() => root.unmount())
    container.remove()
    trigger.remove()
    if (realOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
    }
  })

  function mount(options: DialogFocusTrapOptions = {}) {
    act(() => root.render(createElement(TrapHarness, options)))
  }

  function unmount() {
    act(() => root.unmount())
    unmounted = true
  }

  function first(): HTMLElement {
    return container.querySelector('[data-slot="first"]') as HTMLElement
  }

  function last(): HTMLElement {
    return container.querySelector('[data-slot="last"]') as HTMLElement
  }

  /** 返回 preventDefault 是否被调用：命中「循环」时钩子必须接管这次 Tab。 */
  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  it('焦点在最后一个控件时，Tab 回到第一个', () => {
    mount()
    act(() => last().focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(first())
  })

  it('焦点在第一个控件时，Shift+Tab 落到最后一个', () => {
    mount()
    act(() => first().focus())

    expect(pressTab(true)).toBe(true)
    expect(document.activeElement).toBe(last())
  })

  it('焦点在弹窗中途时不接管，正常往后走', () => {
    mount()
    act(() => first().focus())

    expect(pressTab()).toBe(false)
    expect(document.activeElement).toBe(first())
  })

  it('焦点跑到弹窗外时，Tab 拉回第一个、Shift+Tab 拉回最后一个', () => {
    mount()
    act(() => trigger.focus())
    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(first())

    act(() => trigger.focus())
    expect(pressTab(true)).toBe(true)
    expect(document.activeElement).toBe(last())
  })

  it('恢复焦点：卸载后回到打开前的元素', async () => {
    act(() => trigger.focus())
    mount({ restoreFocus: true })
    act(() => first().focus())

    unmount()
    // 归还在下一个宏任务里发生，先让出队列。
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(trigger)
  })

  it('不恢复焦点时（默认），卸载后不动焦点', async () => {
    act(() => trigger.focus())
    mount()
    act(() => first().focus())

    unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).not.toBe(trigger)
  })

  it('enabled: false 时完全不介入 Tab', () => {
    mount({ enabled: false })
    act(() => last().focus())

    expect(pressTab()).toBe(false)
    expect(document.activeElement).toBe(last())
  })
})
