// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillDetailDialog } from '@/components/skills/SkillDetailDialog'
import type { SkillSummary } from '@/lib/types'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * 调用方回归：技能详情弹窗一直是 aria-modal，但此前只有遮罩点击和关闭按钮能退出。
 * 这条守住两件事：Tab 留在弹窗里、Esc 能关。
 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

const skill = {
  name: 'demo-skill',
  displayName: 'Demo Skill',
  description: 'summary',
  scope: 'global',
  path: '/skills/demo-skill',
  triggers: ['demo'],
  tags: ['tag'],
} as unknown as SkillSummary

describe('SkillDetailDialog focus trap', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: () => void

  beforeEach(() => {
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
    act(() => {
      root.render(createElement(SkillDetailDialog, {
        skill,
        scope: 'global',
        content: null,
        contentLoading: false,
        contentError: '',
        enabled: true,
        pending: false,
        bulkSaving: false,
        listLoading: false,
        copiedTarget: null,
        onToggle: () => {},
        onReloadContent: () => {},
        onCopyText: () => {},
        onClose,
      }))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('[role="dialog"]').forEach((node) => node.remove())
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

  function dialog(): HTMLElement {
    return document.querySelector('[role="dialog"]') as HTMLElement
  }

  function focusables(): HTMLElement[] {
    return Array.from(dialog().querySelectorAll('button, input')) as HTMLElement[]
  }

  it('弹窗渲染出 aria-modal 与可聚焦控件', () => {
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(focusables().length).toBeGreaterThanOrEqual(3)
  })

  it('焦点在最后一个控件时，Tab 回到第一个', () => {
    const items = focusables()
    act(() => items[items.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(items[0])
  })

  it('焦点在弹窗外时，Tab 拉回弹窗内', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(focusables()[0])
    outside.remove()
  })

  it('Esc 关闭弹窗（新增行为）', () => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
