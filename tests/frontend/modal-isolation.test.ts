// @vitest-environment jsdom
import { act, createElement, type ReactElement, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { promptApiKey } from '@/components/chat/surface/ApiKeyPromptDialog'
import { openAttachmentOverlay } from '@/components/chat/surface/AttachmentOverlay'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { useModalIsolation } from '@/hooks/useModalIsolation'
import { setAppStorage, type AppStorage } from '@/storage'

/**
 * `aria-modal` 的背景隔离：弹层挂载期间沿途兄弟节点被设为 `inert`，卸载按引用计数还原。
 * jsdom 的 `inert` 只是纯字符串属性（没有行为语义），所以这里只断言属性本身，
 * 不断言「点不动 / Tab 不进去」——那种断言必假绿。
 *
 * 例 1–4 用最小 harness 直测钩子；弹层容器与兄弟节点都直接挂 body，
 * 与真实调用点的拓扑一致（`renderMessageDialog` 的容器自己 append 到 body，
 * `#root` 是它的兄弟）。例 5 走 `showConfirm` 真实调用点；例 6–7 走命令式
 * `createRoot` 的两种挂载形态：`promptApiKey`（inline，dialog 在自己的
 * container 里）与 `openAttachmentOverlay`（createPortal 直挂 body）。
 */

function ModalHost({
  dialogRef,
  enabled,
}: {
  dialogRef: RefObject<HTMLDivElement | null>
  enabled?: boolean
}): ReactElement {
  useModalIsolation(dialogRef, enabled === undefined ? undefined : { enabled })
  return createElement('div', { ref: dialogRef, role: 'dialog', 'aria-modal': 'true' })
}

describe('useModalIsolation', () => {
  const roots: Root[] = []
  const disposables: HTMLElement[] = []
  let baselineBodyChildren: Element[] = []

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    baselineBodyChildren = Array.from(document.body.children)
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots.length = 0
    for (const el of disposables) el.remove()
    disposables.length = 0
    // showConfirm 自己 append 的容器由它的 setTimeout 移除；这里兜底失败残留。
    for (const child of Array.from(document.body.children)) {
      if (!baselineBodyChildren.includes(child)) child.remove()
    }
  })

  function mountDialog(): {
    root: Root
    container: HTMLDivElement
    dialog: HTMLDivElement
  } {
    const container = document.createElement('div')
    document.body.appendChild(container)
    disposables.push(container)
    const root = createRoot(container)
    roots.push(root)
    const dialogRef: RefObject<HTMLDivElement | null> = { current: null }
    act(() => {
      root.render(createElement(ModalHost, { dialogRef }))
    })
    expect(dialogRef.current).toBeInstanceOf(HTMLDivElement)
    const dialog = dialogRef.current as HTMLDivElement
    return { root, container, dialog }
  }

  function bodySibling(id: string): HTMLDivElement {
    const el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
    disposables.push(el)
    return el
  }

  it('挂载后兄弟节点带 inert，卸载后摘掉', () => {
    const siblingA = bodySibling('sibling-a')
    const siblingB = bodySibling('sibling-b')
    const { root } = mountDialog()

    expect(siblingA.hasAttribute('inert')).toBe(true)
    expect(siblingB.hasAttribute('inert')).toBe(true)

    act(() => root.unmount())
    expect(siblingA.hasAttribute('inert')).toBe(false)
    expect(siblingB.hasAttribute('inert')).toBe(false)
  })

  it('兄弟本来就带 inert：挂载不动它，卸载后仍带 inert', () => {
    const sibling = bodySibling('sibling-already-inert')
    sibling.setAttribute('inert', '')
    const { root } = mountDialog()

    expect(sibling.hasAttribute('inert')).toBe(true)

    act(() => root.unmount())
    // prev 还原：这份 inert 是别人设的，弹层卸载不能替它摘掉。
    expect(sibling.hasAttribute('inert')).toBe(true)
  })

  it('两个实例同时挂载：依次卸载时 inert 不被提前摘掉（引用计数）', () => {
    const shared = bodySibling('shared-sibling')
    const first = mountDialog()
    const second = mountDialog()

    expect(shared.hasAttribute('inert')).toBe(true)
    // 第二个弹层不能把自己（或自己的祖先链）关掉。
    expect(second.dialog.hasAttribute('inert')).toBe(false)
    expect(second.container.hasAttribute('inert')).toBe(false)

    act(() => first.root.unmount())
    // 引用计数还剩 1：第二个弹层仍开着，第一个的 cleanup 不能摘掉共享兄弟的 inert。
    expect(shared.hasAttribute('inert')).toBe(true)

    act(() => second.root.unmount())
    expect(shared.hasAttribute('inert')).toBe(false)
  })

  it('弹层自身及其祖先链不带 inert', () => {
    const sibling = bodySibling('sibling')
    const { root, container, dialog } = mountDialog()

    expect(sibling.hasAttribute('inert')).toBe(true)
    expect(dialog.hasAttribute('inert')).toBe(false)
    expect(container.hasAttribute('inert')).toBe(false)
    expect(document.body.hasAttribute('inert')).toBe(false)

    act(() => root.unmount())
  })

  it('真实调用点：showConfirm 打开时 #root 被隔离，取消关闭后同步摘掉', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)
    disposables.push(appRoot)

    let settled: boolean | undefined
    await act(async () => {
      void showConfirm({ title: 'T', description: 'D' }).then((value) => {
        settled = value
      })
    })
    // renderMessageDialog 的容器自己 append 到 body，#root 正好是它的兄弟。
    expect(appRoot.hasAttribute('inert')).toBe(true)

    const cancel = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    )
    expect(cancel).toBeInstanceOf(HTMLElement)
    await act(async () => {
      cancel?.click()
    })
    // 不等宏任务就断言：卸载 cleanup 必须同步摘 inert，
    // 焦点归还是 setTimeout(0)，inert 晚一步摘就会让归还目标不可聚焦。
    expect(appRoot.hasAttribute('inert')).toBe(false)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(appRoot.hasAttribute('inert')).toBe(false)
    expect(settled).toBe(false)
  })

  it('真实调用点：promptApiKey 打开时背景被隔离，点遮罩关闭后同步摘掉', async () => {
    // promptApiKey 内部走 getAppStorage()，先塞一个最小 stub。
    setAppStorage({
      providerKeys: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
      },
      customProviders: {
        getAll: vi.fn(async () => []),
      },
    } as unknown as AppStorage)

    const appRoot = bodySibling('root')

    let settled: boolean | undefined
    await act(async () => {
      void promptApiKey('anthropic').then((value) => {
        settled = value
      })
    })
    // inline 挂载：dialog div 渲染在 promptApiKey 自己 append 的 container 里，
    // container 是 body 直接子节点，#root 正好是它的兄弟。
    expect(appRoot.hasAttribute('inert')).toBe(true)
    const dialog = document.querySelector<HTMLDivElement>('.qf-api-key-prompt-dialog')
    expect(dialog).toBeInstanceOf(HTMLDivElement)
    // 弹层自身与祖先链不被隔。
    expect(dialog?.hasAttribute('inert')).toBe(false)

    await act(async () => {
      dialog?.click() // 点击遮罩 → resolveFalse → finish(false)
    })
    // 不等宏任务就断言：unmount 的 cleanup 必须同步摘 inert。
    expect(appRoot.hasAttribute('inert')).toBe(false)
    expect(settled).toBe(false)
  })

  it('真实调用点：openAttachmentOverlay 打开时背景被隔离，Esc 关闭后同步摘掉', () => {
    const appRoot = bodySibling('root')

    const onClose = vi.fn()
    act(() => {
      openAttachmentOverlay(
        { id: 'att-1', type: 'image', fileName: 'shot.png', mimeType: 'image/png', size: 3, content: 'aGk=' },
        onClose,
      )
    })
    // portal 挂载：overlay div 直接落在 body 下，与 #root 互为兄弟
    // （createRoot 的 container 是它的另一个兄弟，被隔也不影响弹层自身）。
    expect(appRoot.hasAttribute('inert')).toBe(true)
    const overlay = document.querySelector<HTMLDivElement>('.qf-attachment-overlay')
    expect(overlay).toBeInstanceOf(HTMLDivElement)
    expect(overlay?.hasAttribute('inert')).toBe(false)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    // close() 里 root.unmount() 的 effect cleanup 必须同步摘 inert。
    expect(appRoot.hasAttribute('inert')).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
