// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiKeyPromptDialog } from '@/components/chat/surface/ApiKeyPromptDialog'

/**
 * 调用方回归：API key 提示框声明了 `aria-modal="true"`，键盘却只有 Esc
 * （`isDialogEscapeKey`）——Tab 能一路走到背后的对话界面。本用例只管 Tab 循环，
 * Esc 的既有语义由 `chat-surface-api-key-dialog.test.ts` 覆盖。
 */

const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('ApiKeyPromptDialog focus trap', () => {
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(ApiKeyPromptDialog, {
        provider: 'custom-provider',
        getKey: async () => null,
        saveKey: async () => {},
        onResolve: () => {},
        // 轮询只是对话框的既有副作用；拉长间隔免得用例跑完还在计数。
        pollIntervalMs: 60_000,
      }))
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

  function dialog(): HTMLElement {
    const node = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(node).not.toBeNull()
    return node as HTMLElement
  }

  /** 空输入时「保存」是禁用的，实际可聚焦的是输入框和「取消」。 */
  function focusables(): HTMLElement[] {
    return Array.from(
      dialog().querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'),
    )
  }

  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  it('Tab 从最后一个可聚焦控件绕回输入框', () => {
    const nodes = focusables()
    expect(nodes.length).toBeGreaterThanOrEqual(2)
    const last = nodes[nodes.length - 1]
    act(() => last.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(nodes[0])
  })

  it('焦点在提示框外时，Tab 把它拉回框内', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(focusables()[0])
    outside.remove()
  })
})
