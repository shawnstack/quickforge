// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 调用方回归：设置页 hooks 编辑器面板（`role="dialog"` + `aria-modal`）补上 Tab 循环。
 * Esc 原本绑在遮罩的 onKeyDown 上（靠事件冒泡），这里一并守住「补陷阱之后 Esc 仍然关得掉」。
 */
const { storageValues } = vi.hoisted(() => ({ storageValues: new Map<string, unknown>() }))

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn(async () => true) }))
vi.mock('@/storage', () => ({
  getAppStorage: () => ({
    settings: {
      get: async (key: string) => storageValues.get(key),
      set: async (key: string, value: unknown) => { storageValues.set(key, value) },
    },
  }),
}))

import { HooksSettingsTab } from '@/components/settings/tabs/HooksSettingsTab'

const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })

describe('HooksSettingsTab editor focus trap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.ownerDocument?.body ?? null
      },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/hooks/executions')) return json({ executions: [], total: 0 })
      if (url.includes('/api/hooks')) return json({ hooks: [] })
      return json({})
    }))
    storageValues.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(HooksSettingsTab))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    if (realOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
    }
  })

  function buttonByText(text: string): HTMLElement | undefined {
    return (Array.from(container.querySelectorAll('button')) as HTMLElement[])
      .find((node) => (node.textContent ?? '').trim() === text)
  }

  async function openEditor(): Promise<HTMLElement> {
    const addButton = buttonByText('hooksAdd')
    expect(addButton).toBeDefined()
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    return dialog
  }

  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  /** 与钩子同口径：跳过 disabled 控件。 */
  function focusables(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')) as HTMLElement[]
  }

  it('编辑器面板带 aria-modal，且 Tab 从最后一个控件回到第一个', async () => {
    const dialog = await openEditor()
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const items = focusables(dialog)
    expect(items.length).toBeGreaterThanOrEqual(2)
    act(() => items[items.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(items[0])
  })

  it('焦点在面板外时，Tab 拉回面板内', async () => {
    const dialog = await openEditor()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(focusables(dialog)[0])
    outside.remove()
  })

  it('补陷阱后 Esc 仍然关闭面板（沿用遮罩 onKeyDown，不新增监听）', async () => {
    const dialog = await openEditor()
    const firstInput = dialog.querySelector('input') as HTMLElement
    act(() => firstInput.focus())

    act(() => {
      firstInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
