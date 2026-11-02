import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 最小 EventSource 桩：这些用例只关心消息日志。 */
class MinimalEventSource {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(public readonly url: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

/**
 * 回滚响应必须被**按全量坐标采纳**进本地消息窗口。
 *
 * 服务端返回的是截断后的完整会话历史，而本连接的 SSE 替换帧只带尾部窗口；
 * 本地如果正处于尾部窗口（`messageBaseSeq > 0`）时把全量数组直接赋给
 * `state.messages`，「数组」与「起点」就拆开了——之后所有下标换算、增量落位
 * 整体偏移，表现为回滚后显示的历史不对。这里锁定：采纳后
 * `messageOffset + messages.length` 恒等于服务端总数，且后续增量落在尾部。
 */

function message(index: number) {
  return { role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: 1000 + index }
}

function rollbackResponse(messages: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ ok: true, rollbackIndex: messages.length, session: { messages } }) }
}

const HOST = 'http://127.0.0.1:32176'

function stateFrame(options: { messages: unknown[]; messagesAfter: number; total: number }) {
  return {
    type: 'state',
    stateVersion: 3,
    logVersion: 7,
    source: '',
    messages: options.messages,
    messagesAfter: options.messagesAfter,
    messagesSummary: { count: options.total, logVersion: 7 },
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MinimalEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rollback response adoption', () => {
  it('re-adds the truncated full history with a zero window offset and notifies listeners', async () => {
    const truncated = [0, 1, 2, 3, 4].map(message)
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/rollback')) return rollbackResponse(truncated)
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ServerAgent } = await import('../../src/lib/server-agent')
    const agent = new ServerAgent({ sessionId: 'rollback-adopt', baseUrl: HOST, initialState: { messages: [] as never[] } })
    const events: string[] = []
    const unsubscribe = agent.subscribe((event) => events.push(event.type))
    try {
      // 先进入窗口态：本地只有 [m4, m5]，起点 seq = 4。
      ;(agent as unknown as { handleSseEvent?: (event: Record<string, unknown>) => void })
        .handleSseEvent?.(stateFrame({ messages: [message(4), message(5)], messagesAfter: 4, total: 6 }))
      expect(agent.messageOffset).toBe(4)
      expect(agent.state.messages).toHaveLength(2)

      // 从本地下标 1 回滚 → 服务端按绝对 seq 5 截断，返回全量 [m0..m4]。
      const result = await agent.rollback(1)
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/rollback')
      expect(JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as { body?: string })?.body))).toEqual({ messageIndex: 5 })
      expect(result.session.messages).toBe(truncated)

      // 不变式：窗口起点 + 窗口长度 = 服务端总数，且起点归零。
      expect(agent.messageOffset).toBe(0)
      expect(agent.state.messages).toHaveLength(5)
      expect(agent.messageOffset + agent.state.messages.length).toBe(5)

      // 表面靠这条通知重建窗口；不回滚时列表会停在采纳前的切片上。
      expect(events).toContain('message_metadata_updated')

      // 后续增量按绝对 seq 落位：新回答追加到尾部，而不是覆盖窗口内某条旧消息。
      ;(agent as unknown as { handleSseEvent?: (event: Record<string, unknown>) => void })
        .handleSseEvent?.({ type: 'message_end', message: message(5), messagesAfter: 5, messagesSummary: { count: 6, logVersion: 8 } })
      expect(agent.state.messages.map((entry) => (entry as { content?: string }).content))
        .toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
      expect(agent.messageOffset).toBe(0)
    } finally {
      unsubscribe()
      agent.dispose()
    }
  })

  it('keeps the window offset when only the local tail is trimmed (retry)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))

    const { ServerAgent } = await import('../../src/lib/server-agent')
    const agent = new ServerAgent({ sessionId: 'rollback-trim', baseUrl: HOST, initialState: { messages: [] as never[] } })
    try {
      ;(agent as unknown as { handleSseEvent?: (event: Record<string, unknown>) => void })
        .handleSseEvent?.(stateFrame({ messages: [message(4), message(5)], messagesAfter: 4, total: 6 }))

      agent.trimTrailingMessages(1)

      // 前缀截断不动起点：窗口仍是 [4, 5)，与服务端坐标自洽。
      expect(agent.messageOffset).toBe(4)
      expect(agent.state.messages).toHaveLength(1)
      expect(agent.messageOffset + agent.state.messages.length).toBe(5)
      expect((agent.state.messages[0] as { content?: string }).content).toBe('m4')
    } finally {
      agent.dispose()
    }
  })
})
