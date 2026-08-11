import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageWithUsage } from '../../src/components/chat/chat-utils'
import { syncContextCompactionNotice } from '../../src/components/chat/panel-decoration/context-compaction'

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}), { virtual: true })

vi.mock('@/lib/message-utils', () => ({
  assistantText: () => '',
  copyTextToClipboard: vi.fn(),
  draftTextFromUserMessage: () => '',
}), { virtual: true })

type FakeElement = {
  className: string
  dataset: Record<string, string>
  title: string
  innerHTML: string
  parent: FakeMessageList | null
  nextElementSibling: FakeElement | null
  setAttribute: ReturnType<typeof vi.fn>
  querySelector: () => null
  closest: (selector: string) => FakeMessageList | null
  before: (notice: FakeElement) => void
  remove: () => void
}

type FakeMessageList = {
  children: FakeElement[]
  firstElementChild: FakeElement | null
  querySelectorAll: () => FakeElement[]
  prepend: (notice: FakeElement) => void
}

function createElement(): FakeElement {
  const element: FakeElement = {
    className: '',
    dataset: {},
    title: '',
    innerHTML: '',
    parent: null,
    nextElementSibling: null,
    setAttribute: vi.fn(),
    querySelector: () => null,
    closest: (selector) => selector === 'message-list' ? element.parent : null,
    before: (notice) => insertBefore(element, notice),
    remove: () => removeElement(element),
  }
  return element
}

function syncSiblings(messageList: FakeMessageList) {
  messageList.firstElementChild = messageList.children[0] ?? null
  messageList.children.forEach((element, index) => {
    element.parent = messageList
    element.nextElementSibling = messageList.children[index + 1] ?? null
  })
}

function removeElement(element: FakeElement) {
  const messageList = element.parent
  if (!messageList) return
  messageList.children = messageList.children.filter((child) => child !== element)
  element.parent = null
  element.nextElementSibling = null
  syncSiblings(messageList)
}

function insertBefore(target: FakeElement, notice: FakeElement) {
  const messageList = target.parent
  if (!messageList) return
  messageList.children = messageList.children.filter((child) => child !== notice)
  messageList.children.splice(messageList.children.indexOf(target), 0, notice)
  syncSiblings(messageList)
}

function createPanel(messageCount: number) {
  const messages = Array.from({ length: messageCount }, () => createElement())
  const messageList: FakeMessageList = {
    children: messages,
    firstElementChild: null,
    querySelectorAll: () => messages,
    prepend: (notice) => {
      messageList.children = messageList.children.filter((child) => child !== notice)
      messageList.children.unshift(notice)
      syncSiblings(messageList)
    },
  }
  syncSiblings(messageList)

  const panel = {
    querySelector: (selector: string) => {
      if (selector === 'message-list') return messageList
      if (selector === '.quickforge-context-compaction-notice') {
        return messageList.children.find((element) => element.className === 'quickforge-context-compaction-notice') ?? null
      }
      return null
    },
  } as unknown as HTMLElement

  return { panel, messageList, messageElements: messages }
}

function userMessages(count: number): MessageWithUsage[] {
  return Array.from({ length: count }, () => ({ role: 'user', content: '' }))
}

function sync(panel: HTMLElement, messages: MessageWithUsage[], compactedUpToIndex: number, messageIndexOffset = 0) {
  syncContextCompactionNotice({
    panel,
    getMessages: () => messages,
    getContextCompaction: () => ({ compactedUpToIndex }),
    messageIndexOffset,
  })
}

const originalDocument = globalThis.document

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => createElement() })
})

afterEach(() => {
  vi.stubGlobal('document', originalDocument)
})

describe('syncContextCompactionNotice window positioning', () => {
  it('places a boundary before the matching message inside the rendered window', () => {
    const { panel, messageList, messageElements } = createPanel(4)

    sync(panel, userMessages(4), 12, 10)

    expect(messageList.children).toEqual([
      messageElements[0],
      messageElements[1],
      expect.objectContaining({ className: 'quickforge-context-compaction-notice' }),
      messageElements[2],
      messageElements[3],
    ])
  })

  it('places a boundary at the window top when it is at or before the window start', () => {
    const { panel, messageList, messageElements } = createPanel(4)

    sync(panel, userMessages(4), 8, 10)

    expect(messageList.children[0]).toMatchObject({ className: 'quickforge-context-compaction-notice' })
    expect(messageList.children.slice(1)).toEqual(messageElements)
  })

  it('aligns a legacy non-user boundary to the containing user turn', () => {
    const { panel, messageList, messageElements } = createPanel(5)
    const messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'kept question' },
      { role: 'assistant', content: 'tool call' },
      { role: 'toolResult', content: 'tool result' },
      { role: 'assistant', content: 'continued answer' },
    ] as MessageWithUsage[]

    sync(panel, messages, 4)

    expect(messageList.children).toEqual([
      messageElements[0],
      messageElements[1],
      expect.objectContaining({ className: 'quickforge-context-compaction-notice' }),
      messageElements[2],
      messageElements[3],
      messageElements[4],
    ])
  })

  it('hides the notice when the boundary is after the rendered window', () => {
    const { panel, messageList } = createPanel(4)

    sync(panel, userMessages(4), 12, 10)
    sync(panel, userMessages(4), 15, 10)

    expect(messageList.children).toHaveLength(4)
    expect(messageList.children.some((element) => element.className === 'quickforge-context-compaction-notice')).toBe(false)
  })
})
