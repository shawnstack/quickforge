// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CodeBlock } from '@/components/chat/surface/CodeBlock'

/**
 * 调用方回归：SVG/mermaid 的放大 lightbox 声明了 `aria-modal="true"`，
 * 但里面只有一个 `<img>`——没有任何可聚焦元素。焦点留在背后的对话上，
 * 读屏念完 `aria-label` 就落空了，所以容器必须自己做「可落点」并接住焦点。
 * 注意：这里不该挂 `useDialogFocusTrap`（没有可循环的焦点，Tab 循环是空转），
 * 真正的键盘退出通道是 Esc。
 */

const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>'
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('CodeBlock lightbox keyboard entry', () => {
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
      root.render(createElement(CodeBlock, {
        language: 'svg',
        source: SVG_SOURCE,
        isAssistant: true,
        isStreaming: false,
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

  async function openLightbox(): Promise<HTMLElement> {
    const preview = container.querySelector<HTMLElement>('.quickforge-svg-code-preview img')
    expect(preview).not.toBeNull()
    await act(async () => {
      preview?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const lightbox = container.querySelector<HTMLElement>('.quickforge-svg-code-lightbox')
    expect(lightbox).not.toBeNull()
    return lightbox as HTMLElement
  }

  it('打开 lightbox 后容器可聚焦，并成为焦点落点', async () => {
    const lightbox = await openLightbox()
    expect(lightbox.getAttribute('role')).toBe('dialog')
    expect(lightbox.getAttribute('aria-modal')).toBe('true')
    expect(lightbox.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(lightbox)
  })

  it('Esc 关闭 lightbox', async () => {
    await openLightbox()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('.quickforge-svg-code-lightbox')).toBeNull()
  })
})
