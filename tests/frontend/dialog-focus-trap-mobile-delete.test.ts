// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MobileServerConnectPage } from '@/components/mobile/MobileServerConnectPage'

/**
 * 调用方回归：手机连接页只在「删除这台服务器？」这一层声明 dialog，
 * 补上 Tab 循环与 Esc（Esc 走「取消」那条既有路径 setDeletingUrl(null)）。
 * 同时守住边界：整页主体不该出现 role="dialog"。
 */
const STORAGE_KEY = 'quickforge:mobile-server-settings:v1'
const SERVER_URL = 'https://dev-machine.tail1234.ts.net:5176'
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('MobileServerConnectPage delete confirm focus trap', () => {
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
    // 只接受 Tailscale 主机名（*.ts.net）或 100.64–100.127.x.x，且落库是带端口的 origin。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      urls: [SERVER_URL],
      lastUsedUrl: SERVER_URL,
      aliases: { [SERVER_URL]: '公司开发机' },
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(createElement(MobileServerConnectPage)) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.removeItem(STORAGE_KEY)
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

  function clickButton(match: (node: HTMLElement) => boolean): void {
    const node = (Array.from(container.querySelectorAll('button')) as HTMLElement[]).find(match)
    expect(node).toBeDefined()
    act(() => {
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  /** 管理 → 删除服务器 → 打开确认框 */
  async function openConfirm(): Promise<HTMLElement> {
    clickButton((node) => (node.getAttribute('aria-label') ?? '').startsWith('管理 '))
    clickButton((node) => (node.textContent ?? '').trim() === '删除服务器')
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    return dialog
  }

  it('打开确认框：整页只多出这一个 dialog，且 Tab 末→首', async () => {
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    const dialog = await openConfirm()
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const buttons = Array.from(dialog.querySelectorAll('button')) as HTMLElement[]
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    act(() => buttons[buttons.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('焦点在确认框外时，Tab 拉回框内', async () => {
    const dialog = await openConfirm()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    const first = dialog.querySelector('button') as HTMLElement
    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(first)
    outside.remove()
  })

  it('Esc 关闭确认框（走既有关闭路径，不动其它弹层状态）', async () => {
    await openConfirm()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  })
})
