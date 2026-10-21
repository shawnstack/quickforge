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
  after: (notice: FakeElement) => void
  remove: () => void
}

type FakeMessageList = {
  children: FakeElement[]
  firstElementChild: FakeElement | null
  lastElementChild: FakeElement | null
  querySelectorAll: () => FakeElement[]
  prepend: (notice: FakeElement) => void
  append: (notice: FakeElement) => void
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
    closest: (selector) => selector === '.qf-message-list' ? element.parent : null,
    before: (notice) => insertAt(element, notice, 'before'),
    after: (notice) => insertAt(element, notice, 'after'),
    remove: () => removeElement(element),
  }
  return element
}

function syncSiblings(messageList: FakeMessageList) {
  messageList.firstElementChild = messageList.children[0] ?? null
  messageList.lastElementChild = messageList.children[messageList.children.length - 1] ?? null
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

function insertAt(target: FakeElement, notice: FakeElement, position: 'before' | 'after') {
  const messageList = target.parent
  if (!messageList) return
  messageList.children = messageList.children.filter((child) => child !== notice)
  const targetIndex = messageList.children.indexOf(target)
  messageList.children.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, notice)
  syncSiblings(messageList)
}

function createPanel(messageCount: number) {
  const messages = Array.from({ length: messageCount }, () => createElement())
  const messageList: FakeMessageList = {
    children: messages,
    firstElementChild: null,
    lastElementChild: null,
    querySelectorAll: () => messages,
    prepend: (notice) => {
      messageList.children = messageList.children.filter((child) => child !== notice)
      messageList.children.unshift(notice)
      syncSiblings(messageList)
    },
    append: (notice) => {
      messageList.children = messageList.children.filter((child) => child !== notice)
      messageList.children.push(notice)
      syncSiblings(messageList)
    },
  }
  syncSiblings(messageList)

  const panel = {
    querySelector: (selector: string) => {
      if (selector === '.qf-message-list') return messageList
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

describe('syncContextCompactionNotice boundary positioning', () => {
  it('places the divider before the message right after the compacted range', () => {
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

  it('places the divider at the window top when the boundary is at or before the window start', () => {
    const { panel, messageList, messageElements } = createPanel(4)

    sync(panel, userMessages(4), 8, 10)

    expect(messageList.children[0]).toMatchObject({ className: 'quickforge-context-compaction-notice' })
    expect(messageList.children.slice(1)).toEqual(messageElements)
  })

  it('does not snap the boundary back to the containing user turn', () => {
    const { panel, messageList, messageElements } = createPanel(5)
    // 边界 4 落在 toolResult 上：已压缩历史到第 4 条（含）为止，横线必须紧跟它之后的
    // 可见消息，而不是回溯到本轮用户消息上方。
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
      messageElements[2],
      messageElements[3],
      expect.objectContaining({ className: 'quickforge-context-compaction-notice' }),
      messageElements[4],
    ])
  })

  it('hides the divider when the boundary is after the rendered window', () => {
    const { panel, messageList } = createPanel(4)

    sync(panel, userMessages(4), 12, 10)
    sync(panel, userMessages(4), 15, 10)

    expect(messageList.children).toHaveLength(4)
    expect(messageList.children.some((element) => element.className === 'quickforge-context-compaction-notice')).toBe(false)
  })

  it('trails the last message when the boundary lands on the window end (latest turn compacted)', () => {
    const { panel, messageList, messageElements } = createPanel(3)
    const messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'latest question' },
    ] as MessageWithUsage[]

    sync(panel, messages, 3)

    expect(messageList.children).toEqual([
      messageElements[0],
      messageElements[1],
      messageElements[2],
      expect.objectContaining({ className: 'quickforge-context-compaction-notice' }),
    ])
  })

  it('keeps the divider after the compacted latest question once the reply is appended', () => {
    const { panel, messageList, messageElements } = createPanel(4)
    // 压缩完成时边界 = 3（第一轮问答 + 最新提问都已压缩），后续回复追加在边界之后——
    // 横线稳定停在最新提问与其回复之间，位置不变。
    const messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'latest question' },
      { role: 'assistant', content: 'latest answer' },
    ] as MessageWithUsage[]

    sync(panel, messages, 3)

    expect(messageList.children).toEqual([
      messageElements[0],
      messageElements[1],
      messageElements[2],
      expect.objectContaining({ className: 'quickforge-context-compaction-notice' }),
      messageElements[3],
    ])
  })

  it('trails the window end inside a scrolled window', () => {
    const { panel, messageList, messageElements } = createPanel(3)
    const messages = [
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'latest question' },
      { role: 'assistant', content: 'latest answer' },
    ] as MessageWithUsage[]

    sync(panel, messages, 13, 10)

    expect(messageList.children).toEqual([
      messageElements[0],
      messageElements[1],
      messageElements[2],
      expect.objectContaining({ className: 'quickforge-context-compaction-notice' }),
    ])
  })
})
