// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitCommitPushDialog } from '@/components/git/GitCommitPushDialog'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

/**
 * 调用方回归：提交/推送对话框声明了 `aria-modal="true"`，
 * 键盘就必须跟着守住——Tab 在框内循环，焦点若被挪到框外，下一次 Tab 拉回来。
 * Esc 归对话框自己的 window keydown（`busy` 时不关），本用例不碰它。
 */

// 默认模型来自 pi 存储：与本用例无关，不打桩会把整条存储初始化拖进 jsdom。
vi.mock('@/lib/pi-chat', () => ({
  initializePiStorage: async () => ({}),
  loadLastUsedSessionOptions: async () => ({}),
}))

const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

const STATUS: GitStatusResponse = {
  isGitRepository: true,
  branch: 'main',
  counts: { staged: 1, unstaged: 0, untracked: 0, conflicts: 0, total: 1 },
  files: [{ path: 'src/app.ts', status: 'modified', staged: true, additions: 3, deletions: 1 }],
}

describe('GitCommitPushDialog focus trap', () => {
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
      root.render(createElement(GitCommitPushDialog, {
        open: true,
        projectId: 'project-1',
        status: STATUS,
        onClose: () => {},
        onCheckout: async () => {},
        onRefreshStatus: async () => STATUS,
        onStatusChange: () => {},
        onCompleted: () => {},
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

  /** 对话框走 portal 挂到 `document.body`，不在 render 容器里。 */
  function dialog(): HTMLElement {
    const node = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(node).not.toBeNull()
    return node as HTMLElement
  }

  /** 陷阱按 `disabled` 过滤可聚焦集合，这里跟着只取没被禁用的按钮。 */
  function enabledButtons(): HTMLElement[] {
    return Array.from(dialog().querySelectorAll<HTMLElement>('button:not([disabled])'))
  }

  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  it('Tab 从最后一个可聚焦控件绕回第一个', () => {
    const buttons = enabledButtons()
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    const last = buttons[buttons.length - 1]
    act(() => last.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('Shift+Tab 从第一个绕回最后一个', () => {
    const buttons = enabledButtons()
    const first = buttons[0]
    act(() => first.focus())

    expect(pressTab(true)).toBe(true)
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
  })

  it('焦点在对话框外时，Tab 把它拉回框内', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(enabledButtons()[0])
    outside.remove()
  })
})
