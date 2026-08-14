import { beforeEach, describe, expect, it, vi } from 'vitest'

// i18n 由调用方注入：这里用与真实 t 相同形状的 stub（与 process-folding 测试一致）。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

const mocks = vi.hoisted(() => ({
  decorateProcessBlocks: vi.fn(),
}))

// 只替换 decorateProcessBlocks，其余纯函数保持真实实现。
vi.mock('../../src/components/chat/panel-decoration/process-folding', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/components/chat/panel-decoration/process-folding')>()
  return { ...original, decorateProcessBlocks: mocks.decorateProcessBlocks }
})

import { decorateSubagentProcessBlocks } from '../../src/components/chat/panel-decoration/message-actions'

type StubNode = {
  closest: (selector: string) => unknown
  querySelectorAll: (selector: string) => StubNode[]
  dataset?: Record<string, string | undefined>
}

function childNode(): StubNode {
  return {
    closest: () => null,
    querySelectorAll: () => [],
  }
}

function messageList(children: StubNode[], streaming: string | undefined, markedAsSubagentProcess = true): StubNode {
  const scope: StubNode = {
    closest: () => null,
    querySelectorAll: (selector) => (selector === 'user-message, assistant-message' ? children : []),
    dataset: {
      quickforgeSubagentProcess: markedAsSubagentProcess ? 'true' : undefined,
      quickforgeSubagentStreaming: streaming,
    },
  }
  // 让每个尚未归属其他作用域的子节点 closest 指向本 message-list
  // （getMessageElements 依赖它过滤作用域；已归属其他列表的保持原样）。
  children.forEach((child) => {
    if (child.closest('message-list') === null) {
      child.closest = (selector) => (selector === 'message-list' ? scope : null)
    }
  })
  return scope
}

function panel(messageLists: StubNode[]): StubNode {
  return {
    closest: () => null,
    // 模拟 CSS 属性选择器：只返回带 data-quickforge-subagent-process="true" 的列表。
    querySelectorAll: (selector) => {
      if (selector !== 'message-list[data-quickforge-subagent-process="true"]') return []
      return messageLists.filter((list) => list.dataset?.quickforgeSubagentProcess === 'true')
    },
  }
}

describe('decorateSubagentProcessBlocks', () => {
  beforeEach(() => {
    mocks.decorateProcessBlocks.mockClear()
  })

  it('decorates every subagent process message-list with its own children and streaming flag', () => {
    const listAChildren = [childNode(), childNode()]
    const listBChildren = [childNode()]
    const listA = messageList(listAChildren, 'true')
    const listB = messageList(listBChildren, 'false')

    decorateSubagentProcessBlocks(panel([listA, listB]) as unknown as HTMLElement)

    expect(mocks.decorateProcessBlocks).toHaveBeenCalledTimes(2)
    expect(mocks.decorateProcessBlocks).toHaveBeenNthCalledWith(1, listA, listAChildren, true)
    expect(mocks.decorateProcessBlocks).toHaveBeenNthCalledWith(2, listB, listBChildren, false)
  })

  it('ignores message-lists that are not marked as a subagent process', () => {
    const plainList = messageList([], undefined, false)

    decorateSubagentProcessBlocks(panel([plainList]) as unknown as HTMLElement)

    expect(mocks.decorateProcessBlocks).not.toHaveBeenCalled()
  })

  it('filters out elements that belong to an outer message-list scope', () => {
    const outer = messageList([], undefined)
    const childFromOtherScope = childNode()
    childFromOtherScope.closest = (selector) => (selector === 'message-list' ? outer : null)
    const list = messageList([childFromOtherScope], 'true')

    decorateSubagentProcessBlocks(panel([list]) as unknown as HTMLElement)

    expect(mocks.decorateProcessBlocks).toHaveBeenCalledTimes(1)
    expect(mocks.decorateProcessBlocks.mock.calls[0]?.[1]).toEqual([])
  })

  it('is a no-op when the panel has no subagent message-list', () => {
    decorateSubagentProcessBlocks(panel([]) as unknown as HTMLElement)
    expect(mocks.decorateProcessBlocks).not.toHaveBeenCalled()
  })
})
