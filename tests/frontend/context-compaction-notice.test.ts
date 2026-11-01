// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Assert against i18n keys so the copy can change without touching contracts.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { MessageList } from '../../src/components/chat/surface/MessageList'
import { readCompactionSummaryText } from '../../src/components/chat/surface/ContextCompactionNotice'
import { isCompactionMessage } from '../../src/components/chat/surface/compaction-message'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'

/**
 * 方案 B：压缩点是一条真实消息（role:user + details.quickforgeCompaction）。
 * 位置由它在消息数组里的下标给出，分割线只是这条消息的渲染结果。
 * 这里锁三件事：识别（details 优先、旧数据退回文本）、MessageList 按消息顺序
 * 渲染成一行、折叠摘要与「已并入后续摘要」仍是组件状态与 details 的函数。
 */
function userMessage(content = ''): AgentMessage {
  return { role: 'user', content, timestamp: 1 } as AgentMessage
}

function assistantMessage(content = ''): AgentMessage {
  return { role: 'assistant', content: [{ type: 'text', text: content }], timestamp: 2 } as AgentMessage
}

function compactionMessage(summary = 'summary body', compactedAt = '2026-01-01T00:00:00.000Z'): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: 'The previous conversation has been compacted.\n\n<compact_summary>\n' + summary + '\n</compact_summary>' }],
    timestamp: 3,
    details: { quickforgeCompaction: { version: 1, kind: 'summary', compactedAt, keepRecentTurns: 1, sourceMessageCount: 3 } },
  } as unknown as AgentMessage
}

function legacyCompactionMessage(summary = 'legacy summary'): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: '<compact_summary>\n' + summary + '\n</compact_summary>' }],
    timestamp: 4,
  } as unknown as AgentMessage
}

describe('compaction message detection', () => {
  it('recognises the details contract and the legacy text form', () => {
    expect(isCompactionMessage(compactionMessage())).toBe(true)
    expect(isCompactionMessage(legacyCompactionMessage())).toBe(true)
    expect(isCompactionMessage(userMessage('hello'))).toBe(false)
    expect(isCompactionMessage({ role: 'user', content: 'x', details: { quickforgeCompaction: { kind: 'notice' } } })).toBe(false)
  })

  it('reads the summary body out of the wrapped text', () => {
    expect(readCompactionSummaryText(compactionMessage('hello summary'))).toBe('hello summary')
  })
})

describe('compaction message rendering', () => {
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

  function renderList(messages: AgentMessage[]) {
    act(() => {
      root.render(createElement(MessageList, { messages }))
    })
    return Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > *'))
  }

  it('renders the compaction message at its own index as one divider row', () => {
    const children = renderList([userMessage('a'), compactionMessage(), assistantMessage('b')])

    expect(children).toHaveLength(3)
    expect(children[1].className).toContain('quickforge-compaction-message')
    expect(children[1].querySelector('.quickforge-context-compaction-notice')).not.toBeNull()
    expect(children[0].className).toContain('qf-user-message')
    expect(children[2].className).toContain('qf-assistant-message')
  })

  it('keeps every compaction row and marks the older one as merged', () => {
    const children = renderList([userMessage('a'), compactionMessage('first'), assistantMessage('b'), compactionMessage('second'), assistantMessage('c')])

    const notices = Array.from(container.querySelectorAll<HTMLElement>('.quickforge-context-compaction-notice'))
    expect(notices).toHaveLength(2)
    expect(notices[0].dataset.mergedIntoLater).toBe('true')
    expect(notices[1].dataset.mergedIntoLater).toBeUndefined()
    expect(notices[0].dataset.summaryText).toBe('first')
    expect(notices[1].dataset.summaryText).toBe('second')
    expect(children).toHaveLength(5)
  })

  it('renders a bare separator when the compaction carries no summary', () => {
    const bare = {
      role: 'user',
      content: [],
      timestamp: 5,
      details: { quickforgeCompaction: { version: 1, kind: 'summary', compactedAt: '2026-01-01T00:00:00.000Z' } },
    } as unknown as AgentMessage

    renderList([bare])

    const notice = container.querySelector<HTMLElement>('.quickforge-context-compaction-notice')!
    expect(notice.dataset.hasSummary).toBe('false')
    expect(notice.querySelector('.quickforge-context-compaction-details')).toBeNull()
    expect(notice.querySelector('.quickforge-context-compaction-summary')!.getAttribute('role')).toBe('separator')
  })

  it('follows the native details toggle', () => {
    renderList([compactionMessage()])

    const details = container.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')!
    expect(details.open).toBe(false)
    expect(container.querySelector('.quickforge-context-compaction-toggle-label')!.textContent).toBe('contextCompactedViewSummary')

    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(container.querySelector('.quickforge-context-compaction-toggle-label')!.textContent).toBe('contextCompactedHideSummary')
  })
})
