// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MessageList } from '../../src/components/chat/surface/MessageList'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'

/**
 * The persist-degraded warning used to be prepended into `.qf-message-list` by a
 * command-mutating decoration (`syncPersistDegradedNotice`), which found-or-created
 * its own node on every pass and had to keep the text in sync by hand. React
 * renders it now, so these cases pin the two things that decoration was
 * responsible for: it is the list's **first** child (CSS + reading order), and it
 * disappears the moment the flag clears.
 */
const userMessage: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 }

describe('persist-degraded notice', () => {
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

  function render(persistDegraded: boolean) {
    act(() => {
      root.render(createElement(MessageList, { messages: [userMessage], persistDegraded }))
    })
  }

  function list() {
    return container.querySelector<HTMLElement>('.qf-message-list')!
  }

  it('renders nothing when the flag is clear', () => {
    render(false)

    expect(container.querySelector('.quickforge-persist-degraded-notice')).toBeNull()
  })

  it('renders the warning as the first child of the message list', () => {
    render(true)

    const notice = container.querySelector('.quickforge-persist-degraded-notice')
    expect(notice).not.toBeNull()
    expect(notice!.getAttribute('role')).toBe('alert')
    // First child matters: the CSS positions it above the conversation and the
    // decoration this replaced prepended it.
    expect(list().firstElementChild).toBe(notice)
    // Message rows must still be present below it.
    expect(container.querySelectorAll('.qf-user-message, .qf-message-row').length).toBeGreaterThan(0)
  })

  it('keeps the dot and text spans the stylesheet targets', () => {
    render(true)

    expect(container.querySelector('.quickforge-persist-degraded-notice .quickforge-persist-degraded-dot')).not.toBeNull()
    const text = container.querySelector('.quickforge-persist-degraded-notice .quickforge-persist-degraded-text')
    expect(text).not.toBeNull()
    expect(text!.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('removes the warning once a persist succeeds', () => {
    render(true)
    expect(container.querySelector('.quickforge-persist-degraded-notice')).not.toBeNull()

    render(false)
    expect(container.querySelector('.quickforge-persist-degraded-notice')).toBeNull()
  })
})
