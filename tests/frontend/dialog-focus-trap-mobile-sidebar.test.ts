// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useMobileSidebar } from '@/hooks/useMobileSidebar'
import { useUIStore } from '@/stores/ui-store'

/**
 * 移动端侧栏是全应用最大的一块 `role="dialog" aria-modal="true"`：aria-modal 声明
 * 「抽屉之外的界面不可交互」，键盘就得跟着守住——Tab / Shift+Tab 必须留在抽屉内。
 *
 * 这套语义最早写在 App.tsx 的内联抽屉里，Esc 与「关闭后还原焦点」已由 useMobileSidebar
 * 负责；Tab 陷阱是后来抽出的 useDialogFocusTrap 统一补的（confirm-dialog / 技能弹窗 /
 * 钩子编辑器 / 手机删除确认框都挂了），而抽屉这块最大的反而漏着。这里把三条都钉住：
 * 末位 Tab 回首位、焦点逃到外面被拉回、Esc 仍按原路关闭并还原焦点（防回归）。
 */
const noop = () => {}

function MobileSidebarHarness() {
  const open = useUIStore((s) => s.mobileSidebarOpen)
  const { mobileSidebarDrawerRef } = useMobileSidebar({
    loadSessionWithTransition: noop,
    startNewDefaultSession: noop,
    startNewExplicitGlobalSession: noop,
    startNewProjectChatWithInspectorReset: noop,
    openGlobalSkills: noop,
    openMcp: noop,
    openAgents: noop,
    openScheduledTasks: noop,
    openProjectSkills: noop,
  })
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', 'data-slot': 'outside' }, 'outside'),
    open
      ? createElement(
          'div',
          {
            ref: mobileSidebarDrawerRef,
            tabIndex: -1,
            role: 'dialog',
            'aria-modal': 'true',
            'data-testid': 'drawer',
          },
          createElement('button', { type: 'button', 'data-slot': 'backdrop' }, 'backdrop'),
          createElement('button', { type: 'button', 'data-slot': 'last' }, 'last'),
        )
      : null,
  )
}

/** jsdom 不布局：`offsetParent` 恒为 null，陷阱会把里面所有控件判成不可见，这里给个替身。 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

describe('mobile sidebar drawer focus trap', () => {
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
    act(() => root.render(createElement(MobileSidebarHarness)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useUIStore.setState({ mobileSidebarOpen: false })
    if (realOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
    }
  })

  function openDrawer(): void {
    act(() => useUIStore.setState({ mobileSidebarOpen: true }))
  }

  function slot(name: string): HTMLElement {
    return container.querySelector(`[data-slot="${name}"]`) as HTMLElement
  }

  function pressTab(shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    return event.defaultPrevented
  }

  it('抽屉末位按 Tab 回到抽屉首位，而不是交给浏览器跳出抽屉', () => {
    openDrawer()
    const last = slot('last')
    act(() => last.focus())
    expect(document.activeElement).toBe(last)

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(slot('backdrop'))
  })

  it('焦点已被挪到抽屉外时，Tab 把它拉回抽屉首位', () => {
    openDrawer()
    const outside = slot('outside')
    act(() => outside.focus())
    expect(document.activeElement).toBe(outside)

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(slot('backdrop'))
  })

  it('Esc 仍按原路关闭抽屉，并把焦点还原给打开前的元素', () => {
    const outside = slot('outside')
    act(() => outside.focus())
    openDrawer()
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })

    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(document.activeElement).toBe(outside)
  })
})
