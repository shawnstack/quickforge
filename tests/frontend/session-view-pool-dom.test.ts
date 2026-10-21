// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SessionViewPool } from '../../src/components/chat/SessionViewPool'

/**
 * 会话视图保活池的 DOM 契约。
 *
 * 这些用例锁定的是「切换会话时子树不被卸载」——也就是本方案唯一的技术前提。
 * 断言方式是**节点身份**（`toBe`），因为节点身份是 React 是否复用了同一批
 * fiber 的直接证据：只要重新挂载，节点一定是新对象，无论渲染结果多相似。
 */
describe('SessionViewPool keep-alive', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function view(label: string, count: number) {
    return createElement(
      'div',
      { className: 'view-body', 'data-label': label },
      Array.from({ length: count }, (_, index) => createElement(
        'p',
        { key: `${label}-${index}`, className: 'row' },
        `${label} ${index}`,
      )),
    )
  }

  function renderPool(activeKey: string, props: { maxInactive?: number; weightBudget?: number } = {}) {
    act(() => {
      root.render(createElement(SessionViewPool, {
        activeKey,
        activeView: view(activeKey, activeKey === 'a' ? 3 : 2),
        activeWeight: activeKey === 'a' ? 3 : 2,
        ...props,
      }))
    })
  }

  it('keeps the outgoing view mounted instead of unmounting it', () => {
    renderPool('a')
    // The row nodes are not wrapped in extra boxes: `display: contents` must
    // leave the panel a direct flex child of whatever wraps the surface.
    expect(container.querySelector('[data-quickforge-view="a"]')?.getAttribute('data-quickforge-view-active')).toBe('true')
    const firstRow = container.querySelector('.view-body[data-label="a"] .row')
    expect(container.querySelectorAll('.row')).toHaveLength(3)

    // Switch to `b` with the *same element shape* for `a`: a rebuilt pool would
    // hand back a brand-new node, so identity is the decisive assertion.
    const keptBefore = container.querySelector('.view-body[data-label="a"]')
    renderPool('b')

    expect(container.querySelector('.view-body[data-label="a"]')).toBe(keptBefore)
    expect(container.querySelectorAll('.view-body[data-label="a"] .row')[0]).toBe(firstRow as Element)
  })

  it('hides kept views and exposes exactly one active view', () => {
    renderPool('a')
    renderPool('b')

    const wrappers = Array.from(container.querySelectorAll('[data-quickforge-view]')) as HTMLElement[]
    expect(wrappers).toHaveLength(2)
    const activeWrappers = wrappers.filter((wrapper) => wrapper.dataset.quickforgeViewActive === 'true')
    expect(activeWrappers).toHaveLength(1)
    expect(activeWrappers[0].dataset.quickforgeView).toBe('b')
    // `display: contents` keeps the active panel a direct flex child.
    expect(activeWrappers[0].style.display).toBe('contents')
    const keptWrapper = wrappers.find((wrapper) => wrapper.dataset.quickforgeView === 'a')!
    expect(keptWrapper.style.display).toBe('none')
  })

  it('reuses the same DOM when switching back to a kept view', () => {
    renderPool('a')
    renderPool('b')
    const keptA = container.querySelector('.view-body[data-label="a"]')
    const keptB = container.querySelector('.view-body[data-label="b"]')

    renderPool('a')

    expect(container.querySelector('.view-body[data-label="a"]')).toBe(keptA)
    // `b` is now the kept one, and it is the same node it was while active.
    expect(container.querySelector('.view-body[data-label="b"]')).toBe(keptB)
    expect(container.querySelectorAll('[data-quickforge-view]')).toHaveLength(2)
  })

  it('drops the oldest kept view beyond the inactive slot count', () => {
    renderPool('a')
    renderPool('b')
    renderPool('c')

    expect(container.querySelector('.view-body[data-label="a"]')).toBeNull()
    expect(container.querySelector('.view-body[data-label="b"]')).not.toBeNull()
    expect(container.querySelector('.view-body[data-label="c"]')).not.toBeNull()
  })

  it('keeps more views when the inactive count allows it', () => {
    renderPool('a', { maxInactive: 2 })
    renderPool('b', { maxInactive: 2 })
    renderPool('c', { maxInactive: 2 })

    expect(container.querySelectorAll('[data-quickforge-view]')).toHaveLength(3)
  })

  it('never keeps an inactive view that does not fit the weight budget', () => {
    // Active alone already fills the budget, so the pool degrades to today's
    // behaviour: only the active view is mounted.
    renderPool('a', { weightBudget: 3 })
    renderPool('b', { weightBudget: 3 })

    expect(container.querySelectorAll('[data-quickforge-view]')).toHaveLength(1)
    expect(container.querySelector('[data-quickforge-view-active="true"]')?.getAttribute('data-quickforge-view')).toBe('b')
  })

  it('does not reorder surviving wrappers', () => {
    renderPool('a')
    renderPool('b')
    const orderBefore = Array.from(container.querySelectorAll('[data-quickforge-view]'))
      .map((wrapper) => wrapper.getAttribute('data-quickforge-view'))
    renderPool('a')
    const orderAfter = Array.from(container.querySelectorAll('[data-quickforge-view]'))
      .map((wrapper) => wrapper.getAttribute('data-quickforge-view'))

    // A kept view must never be relocated in the sibling list: moving a keyed
    // sibling makes React move the DOM node inside a large scroll container.
    expect(orderAfter).toEqual(orderBefore)
  })

  it('renders exactly one view when there is no switch history', () => {
    renderPool('a')
    expect(container.querySelectorAll('[data-quickforge-view]')).toHaveLength(1)
  })

  it('survives a parent re-render that keeps the same active key', () => {
    function Parent() {
      const [tick, setTick] = useState(0)
      return createElement('div', null,
        createElement('button', { onClick: () => setTick((value) => value + 1) }, `tick-${tick}`),
        createElement(SessionViewPool, {
          activeKey: 'a',
          activeView: view('a', 3),
          activeWeight: 3,
        }))
    }
    act(() => { root.render(createElement(Parent)) })
    const row = container.querySelector('.view-body[data-label="a"] .row')
    const button = container.querySelector('button')!
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(container.querySelector('button')?.textContent).toBe('tick-1')
    expect(container.querySelector('.view-body[data-label="a"] .row')).toBe(row as Element)
  })
})
