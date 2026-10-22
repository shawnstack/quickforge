// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  registerAgentAccessMenuCloser,
  removeAgentAccessMenu,
} from '../../src/components/chat/panel-decoration/agent-access-menu'
import { AgentAccessMenu } from '../../src/components/chat/surface/ComposerAccessControls'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * Regression: the agent-access menu is a React node now, so the decoration layer
 * must not remove it. An externally removed React child makes the later unmount
 * throw `NotFoundError: The node to be removed is not a child of this node`,
 * which takes down the whole chat panel through the error boundary (probed
 * against react-dom 19). The decoration therefore only *asks* the surface to
 * close, and React removes the node itself.
 */
describe('agent access menu close handshake', () => {
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
    registerAgentAccessMenuCloser(null)
  })

  function Harness({ open }: { open: boolean }) {
    return open
      ? createElement(AgentAccessMenu, {
          mode: 'default',
          anchor: null,
          menuRef: { current: null } as never,
          onSelect: () => {},
        })
      : null
  }

  it('closes through the registered callback instead of touching the DOM', () => {
    const closer = vi.fn()
    registerAgentAccessMenuCloser(closer)

    removeAgentAccessMenu(document.createElement('div'))

    expect(closer).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when scoped and no surface registered a closer', () => {
    const closer = vi.fn()
    // Scoped calls must not fire a closer that belongs to another panel; with no
    // registration there is nothing to close at all.
    removeAgentAccessMenu(document.createElement('div'), true)
    expect(closer).not.toHaveBeenCalled()
  })

  it('leaves the React menu mounted, so the unmount stays clean', () => {
    let open = true
    act(() => { root.render(createElement(Harness, { open })) })
    expect(container.querySelector('.quickforge-agent-access-menu')).not.toBeNull()

    // A decoration pass requests a close: state flips, React removes the node.
    registerAgentAccessMenuCloser(() => {
      open = false
      act(() => { root.render(createElement(Harness, { open })) })
    })
    removeAgentAccessMenu(document.createElement('div'))

    expect(container.querySelector('.quickforge-agent-access-menu')).toBeNull()
    // The subsequent unmount must not throw (it would if the node had been
    // removed behind React's back).
    expect(() => act(() => root.unmount())).not.toThrow()
    root = createRoot(container)
  })
})
