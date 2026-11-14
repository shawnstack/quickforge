// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AttachmentOverlay, AttachmentPreviewErrorFallback } from '@/components/chat/surface/AttachmentOverlay'
import type { Attachment } from '@/components/chat/surface/ChatTypes'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/chat/surface/AttachmentPreview', () => ({
  DocxAttachmentPreview: () => null,
  ExcelAttachmentPreview: () => null,
  PdfAttachmentPreview: () => null,
}))

/**
 * 调用方回归：附件预览是整屏 aria-modal 弹窗，且内部还有一层 role="alertdialog" 的
 * 兜底界面。两处都必须把 Tab 关在里面，否则焦点会漏到背后的对话流。
 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

const imageAttachment = {
  id: 'a1',
  type: 'image',
  fileName: 'pic.png',
  mimeType: 'image/png',
  size: 3,
  content: 'AAAA',
} as unknown as Attachment

describe('attachment overlay focus trap', () => {
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
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('.qf-attachment-overlay').forEach((node) => node.remove())
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

  it('预览弹窗：Tab 从最后一个按钮回到第一个', () => {
    act(() => root.render(createElement(AttachmentOverlay, { attachment: imageAttachment, onClose: () => {} })))
    const buttons = Array.from(document.querySelectorAll('.qf-attachment-overlay button')) as HTMLElement[]
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    act(() => buttons[buttons.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('预览弹窗：焦点在弹窗外时拉回', () => {
    act(() => root.render(createElement(AttachmentOverlay, { attachment: imageAttachment, onClose: () => {} })))
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    const first = document.querySelector('.qf-attachment-overlay button') as HTMLElement
    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(first)
    outside.remove()
  })

  it('错误兜底：单按钮时 Tab 也不许把焦点放出去', () => {
    act(() => root.render(createElement(AttachmentPreviewErrorFallback, { message: 'boom', onClose: () => {} })))
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const close = dialog.querySelector('button') as HTMLElement
    expect(close).not.toBeNull()

    act(() => close.focus())
    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(close)
  })
})
