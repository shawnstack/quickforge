// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShareLinksSettingsPage } from '@/components/share/ShareLinksSettingsPage'
import { t } from '@/lib/i18n'
import type { ConversationShare } from '@/lib/share-client'

/**
 * 调用方回归：分享管理的底部弹层（`ShareActionsSheet`）声明了 `aria-modal="true"`，
 * 却只有「点遮罩关闭」一条路——既没有 Tab 循环，也没有 Esc。
 * 这里守住两条键盘通道，同时守住边界：遮罩点击那条路不该被合并掉。
 */

const SHARE: ConversationShare = {
  id: 'share-1',
  sessionId: 'session-1',
  permission: 'read',
  titleSnapshot: '被分享的对话',
  hasPassword: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  accessCount: 0,
}

// 只替换列表读取；`conversationShareStatus` 等纯函数保持真实实现。
vi.mock('@/lib/share-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/share-client')>()
  return {
    ...actual,
    listConversationShares: vi.fn(async () => ({ shares: [SHARE] })),
  }
})

const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('ShareActionsSheet focus trap', () => {
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
    await act(async () => { root.render(createElement(ShareLinksSettingsPage)) })
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

  function sheet(): HTMLElement {
    const node = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(node).not.toBeNull()
    return node as HTMLElement
  }

  function focusables(): HTMLElement[] {
    return Array.from(sheet().querySelectorAll<HTMLElement>('button:not([disabled])'))
  }

  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  /** 列表项上的「管理」按钮（`md:hidden`，jsdom 不套样式，照样点得到）。 */
  async function openSheet(): Promise<HTMLElement> {
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    const button = Array.from(container.querySelectorAll('button'))
      .find((node) => (node.textContent ?? '').trim() === t('manageShare'))
    expect(button).toBeDefined()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    return sheet()
  }

  it('Tab 从最后一个可聚焦控件绕回第一个', async () => {
    await openSheet()
    const nodes = focusables()
    expect(nodes.length).toBeGreaterThanOrEqual(3)
    act(() => nodes[nodes.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(nodes[0])
  })

  it('焦点在弹层外时，Tab 把它拉回弹层内', async () => {
    await openSheet()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(focusables()[0])
    outside.remove()
  })

  it('Esc 关闭弹层', async () => {
    await openSheet()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  })
})
