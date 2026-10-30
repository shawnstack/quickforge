import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 最小 EventSource 桩：这些用例只关心消息日志，不需要真实流。 */
class MinimalEventSource {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(public readonly url: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

/**
 * 全量历史补齐的收敛行为。
 *
 * 这些用例锁定的都是「手机端永远只有尾部 200 条」的成因：
 * - 拉取失败时不能静默吞掉（必须返回 false 让上层重试）；
 * - 拉取期间有 SSE 帧落地时不能整段丢弃（本地更新的尾部要保留）；
 * - 已经全量时零成本早退（`ensureFullHistory` 可被多次触发）。
 */

function message(index: number) {
  return { role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: 1000 + index }
}

function viewResponse(options: { messages: unknown[]; messagesAfter?: number; total?: number; stateVersion?: number }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      sessionId: 's1',
      title: 'Windowed',
      stateVersion: options.stateVersion ?? 3,
      logVersion: 7,
      messages: options.messages,
      messagesAfter: options.messagesAfter ?? 0,
      ...(typeof options.total === 'number' ? { messagesSummary: { count: options.total, logVersion: 7 } } : {}),
    }),
  }
}

function messagesPage(messages: unknown[], count = messages.length) {
  return { ok: true, status: 200, json: async () => ({ after: 0, count, total: count, logVersion: 8, hasMore: false, messages }) }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MinimalEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('history convergence', () => {
  it('merges a newer local tail instead of discarding the snapshot when SSE lands mid-flight', async () => {
    const windowed = [message(4), message(5)]
    const full = [0, 1, 2, 3, 4, 5].map(message)
    let agentRef: { handleSseEvent?: (event: Record<string, unknown>) => void } | null = null

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/view')) {
        return viewResponse({ messages: windowed, messagesAfter: 4, total: 6 })
      }
      // 拉取期间有新的定稿消息到达：旧实现会因 stateVersion 前进而整段丢弃
      // 这份全量，导致该端永远停在窗口里。
      agentRef?.handleSseEvent?.({ type: 'message_end', message: message(6), messagesSummary: { count: 7 } })
      return messagesPage(full, 6)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ServerAgent } = await import('../../src/lib/server-agent')
    const { agent } = await ServerAgent.loadView('s1')
    agentRef = agent as unknown as { handleSseEvent?: (event: Record<string, unknown>) => void }
    try {
      expect(agent.messageOffset).toBe(4)
      expect(agent.state.messages).toHaveLength(2)

      expect(await agent.hydrateFullHistory()).toBe(true)

      const contents = agent.state.messages.map((entry) => (entry as { content?: string }).content)
      // 全量 0..5 补齐，且中途到达的 m6 不被回退。
      expect(contents).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'])
      expect(agent.messageOffset).toBe(0)
    } finally {
      agent.dispose()
    }
  })

  it('reports failure instead of silently swallowing a failed hydration', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/view')) {
        return viewResponse({ messages: [message(4), message(5)], messagesAfter: 4, total: 6 })
      }
      return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ServerAgent } = await import('../../src/lib/server-agent')
    const { agent } = await ServerAgent.loadView('s1')
    try {
      expect(await agent.hydrateFullHistory()).toBe(false)
      // 窗口保持不变，等待下一次收敛。
      expect(agent.messageOffset).toBe(4)
      expect(agent.state.messages).toHaveLength(2)
    } finally {
      agent.dispose()
    }
  })

  it('returns immediately when the history is already full', async () => {
    const full = [message(0), message(1)]
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/view')) {
        // 未截断：没有 messagesAfter / messagesSummary，baseSeq 保持 0。
        return viewResponse({ messages: full })
      }
      return messagesPage(full)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ServerAgent } = await import('../../src/lib/server-agent')
    const { agent } = await ServerAgent.loadView('s1')
    try {
      const callsBefore = fetchMock.mock.calls.length
      expect(await agent.ensureFullHistory()).toBe(true)
      // 已全量 → 不再打 /messages。
      expect(fetchMock.mock.calls.length).toBe(callsBefore)
      expect(agent.state.messages).toHaveLength(2)
    } finally {
      agent.dispose()
    }
  })

  it('retries with backoff and converges after a transient failure', async () => {
    vi.useFakeTimers()
    const windowed = [message(4), message(5)]
    const full = [0, 1, 2, 3, 4, 5].map(message)
    let messageCalls = 0

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/view')) {
        return viewResponse({ messages: windowed, messagesAfter: 4, total: 6 })
      }
      messageCalls += 1
      if (messageCalls === 1) return { ok: false, status: 503, json: async () => ({}) }
      return messagesPage(full, 6)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ServerAgent } = await import('../../src/lib/server-agent')
    const { agent } = await ServerAgent.loadView('s1')
    try {
      const converged = agent.ensureFullHistory()
      // 第一次失败后按退避表等待 1s，再试一次。
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await converged).toBe(true)
      expect(messageCalls).toBe(2)
      expect(agent.messageOffset).toBe(0)
      expect(agent.state.messages).toHaveLength(6)
    } finally {
      agent.dispose()
    }
  })
})
