// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitGraphDialog } from '@/components/git/GitGraphDialog'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key, getDateLocale: () => 'en-US' }))
vi.mock('@/components/workspace/workspace-api', () => ({
  getGitLog: vi.fn(async () => ({ commits: [] })),
}))

/**
 * 调用方回归：提交图是 portal 出来的 aria-modal 弹窗。Tab 必须留在弹窗内，
 * Esc 关闭（Esc 是既有行为，这里一并守住不许退化）。
 *
 * 取样口径：首帧是 loading、刷新按钮 disabled 不参与 Tab 循环，所以先等数据落地
 * （两个 act：一次挂载、一次让 refresh 的异步链跑完），再按 `:not([disabled])` 取样。
 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('GitGraphDialog focus trap', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: () => void

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.ownerDocument?.body ?? null
      },
    })
    onClose = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(GitGraphDialog, { projectId: 'p1', projectName: 'quickforge', onClose }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
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

  /** 与钩子同口径：跳过 disabled 控件。 */
  function dialogButtons(): HTMLElement[] {
    const dialog = document.querySelector('[role="dialog"]')
    return Array.from(dialog?.querySelectorAll('button:not([disabled])') ?? []) as HTMLElement[]
  }

  it('弹窗渲染出 aria-modal 与可聚焦的头部按钮', () => {
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialogButtons().length).toBeGreaterThanOrEqual(2)
  })

  it('焦点在最后一个按钮时，Tab 回到第一个', () => {
    const buttons = dialogButtons()
    act(() => buttons[buttons.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('焦点在弹窗外时，Tab 拉回弹窗内', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(dialogButtons()[0])
    outside.remove()
  })

  it('Esc 仍然关闭弹窗', () => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
