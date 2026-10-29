import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockEventSource {
  static instances: MockEventSource[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(listener)
  }

  emit(type: string, data: Record<string, unknown>): void {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  close(): void {}
}

vi.mock('@/lib/types', () => ({
  agentAccessModeFromYoloMode: (yoloMode?: boolean) => yoloMode ? 'full-access' : 'default',
  agentAccessModeToYoloMode: (accessMode: string) => accessMode === 'full-access',
  normalizeAgentAccessMode: (accessMode?: string, fallback = 'default') => accessMode ?? fallback,
}), { virtual: true })

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}), { virtual: true })

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}), { virtual: true })

vi.mock('@/lib/random-id', () => ({
  randomId: () => '11111111-1111-4111-8111-111111111111',
}), { virtual: true })

const sessionCacheMock = vi.hoisted(() => ({
  read: null as unknown,
  reset() {
    this.read = null
  },
}))

vi.mock('@/lib/session-message-cache', () => ({
  SESSION_MESSAGE_CACHE_TAIL_MESSAGES: 200,
  resolveServerCacheKey: (baseUrl = '') => baseUrl || 'unknown',
  readSessionMessageSnapshot: async () => sessionCacheMock.read ?? null,
  writeSessionMessageSnapshot: vi.fn(),
  flushPendingSessionMessageWrites: async () => {},
  cancelPendingSessionMessageWrites: () => {},
}), { virtual: true })

async function createServerAgent(config: ConstructorParameters<typeof import('../../src/lib/server-agent').ServerAgent>[0]) {
  const { ServerAgent } = await import('../../src/lib/server-agent')
  return new ServerAgent(config)
}

async function flushAllAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setImmediate(resolve))
}

function latestEventSource(): MockEventSource {
  const eventSource = MockEventSource.instances.at(-1)
  if (!eventSource) throw new Error('Expected an EventSource instance')
  return eventSource
}

/**
 * 「final answer 偶发看不见、刷新才看到」的回归防线。
 *
 * 触发链：SSE 断连窗口吞掉最终 assistant 的 message_end/agent_end（服务端已
 * 持久化，本地 messages 停在流式前，正文只在 streamingMessage）→ 重连后的
 * state 帧报告 isStreaming=false（UI 停止转圈）并触发 /messages 拉尾 →
 * 拉尾恰好瞬时失败。修复前这里静默放弃、watchdog 已停，最终回答永久缺失；
 * 修复后按退避表重试，瞬时失败可自愈，刷新不再是唯一恢复手段。
 */
describe('ServerAgent final-answer recovery across SSE reconnect', () => {
  beforeEach(() => {
    vi.resetModules()
    MockEventSource.instances = []
    sessionCacheMock.reset()
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const userMessage: AgentMessage = { role: 'user', content: 'go', timestamp: 1 }
  const finalAnswer: AgentMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: 'final answer' }],
    timestamp: 100,
  } as unknown as AgentMessage

  function streamingPartial(): AgentMessage {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: 'final answ' }],
      timestamp: 100,
    } as unknown as AgentMessage
  }

  /** 拉起一个流式中的回合：isStreaming=true，正文在 streamingMessage 里。 */
  async function startStreamingTurn(agent: Awaited<ReturnType<typeof createServerAgent>>) {
    const source = latestEventSource()
    source.emit('agent_start', { sessionId: 'session-1', stateVersion: 2 })
    source.emit('message_update', { sessionId: 'session-1', stateVersion: 2, message: streamingPartial() })
    expect(agent.state.isStreaming).toBe(true)
    expect(agent.state.streamingMessage).toBeDefined()
  }

  /** SSE 重连后的初始 state 帧：split 会话只带 count 摘要，回合已结束。 */
  function emitReconnectStateFrame() {
    latestEventSource().emit('state', {
      sessionId: 'session-1',
      stateVersion: 5,
      isStreaming: false,
      messagesSummary: { count: 2 },
    })
  }

  function tailPageOk() {
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [finalAnswer], count: 2, hasMore: false }),
    }
  }

  function tailPageUnavailable() {
    return { ok: false, status: 502, json: async () => ({}) }
  }

  it('recovers the final answer by retrying the failed tail fetch (was: lost until refresh)', async () => {
    vi.useFakeTimers()
    const messageFetchCalls: string[] = []
    let tailFailuresLeft = 3
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        messageFetchCalls.push(href)
        if (tailFailuresLeft > 0) {
          tailFailuresLeft -= 1
          return Promise.resolve(tailPageUnavailable())
        }
        return Promise.resolve(tailPageOk())
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })

    try {
      await startStreamingTurn(agent)
      emitReconnectStateFrame()
      await vi.advanceTimersByTimeAsync(0)

      // UI 认为回合结束，但最终回答还没进消息列表（首拉失败）。
      expect(agent.state.isStreaming).toBe(false)
      // 修复附带：state 帧报告结束时不再残留流式 partial。
      expect(agent.state.streamingMessage).toBeUndefined()
      expect(messageFetchCalls.length).toBe(1)
      expect(agent.state.messages).toHaveLength(1)

      // 退避重试：1s → 2s → 4s，第三次重试成功。
      await vi.advanceTimersByTimeAsync(1_000)
      expect(messageFetchCalls.length).toBe(2)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(messageFetchCalls.length).toBe(3)
      await vi.advanceTimersByTimeAsync(4_000)

      expect(messageFetchCalls.length).toBe(4)
      expect(agent.state.messages).toHaveLength(2)
      expect(JSON.stringify(agent.state.messages)).toContain('final answer')
    } finally {
      agent.dispose()
    }
  })

  it('gives up after the bounded retry table instead of retrying forever', async () => {
    vi.useFakeTimers()
    const messageFetchCalls: string[] = []
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        messageFetchCalls.push(href)
        return Promise.resolve(tailPageUnavailable())
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })

    try {
      await startStreamingTurn(agent)
      emitReconnectStateFrame()
      await vi.advanceTimersByTimeAsync(0)
      expect(messageFetchCalls.length).toBe(1)

      // 推进整个退避表（1+2+4+8+16s）之后：1 次首拉 + 5 次重试 = 6 次。
      await vi.advanceTimersByTimeAsync(31_000)
      expect(messageFetchCalls.length).toBe(6)
      expect(agent.state.messages).toHaveLength(1)

      // 再等很久也不再发请求（耗尽即放弃；恢复交给 reconnect-notice/watchdog 兜底）。
      await vi.advanceTimersByTimeAsync(60_000)
      expect(messageFetchCalls.length).toBe(6)
    } finally {
      agent.dispose()
    }
  })

  it('fills a final answer omitted by an incremental end frame', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        return Promise.resolve(tailPageOk())
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })

    try {
      await startStreamingTurn(agent)
      latestEventSource().emit('agent_end', {
        sessionId: 'session-1',
        stateVersion: 5,
        messagesIncremental: true,
        messagesAfter: 1,
        messages: [],
        messagesSummary: { count: 2 },
      })
      await flushAllAsync()
      await flushAllAsync()

      expect(agent.state.isStreaming).toBe(false)
      expect(agent.state.messages).toHaveLength(2)
      expect(JSON.stringify(agent.state.messages)).toContain('final answer')
    } finally {
      agent.dispose()
    }
  })

  it('recovers the final answer when the same reconnect tail fetch succeeds (control)', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        return Promise.resolve(tailPageOk())
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })

    try {
      await startStreamingTurn(agent)
      emitReconnectStateFrame()
      await flushAllAsync()
      await flushAllAsync()

      expect(agent.state.isStreaming).toBe(false)
      expect(agent.state.streamingMessage).toBeUndefined()
      expect(agent.state.messages).toHaveLength(2)
      expect(JSON.stringify(agent.state.messages)).toContain('final answer')
    } finally {
      agent.dispose()
    }
  })

  /**
   * 拉尾成功后 UI 必须收到事件：state 帧路径的 agent_end 在拉尾前同步发出
   * （当时读到的还是旧消息列表），ChatSurface 只靠订阅事件重渲染，合入后
   * 若无 message_metadata_updated 补发，最终回答会停留在内存里不显示，
   * 直到刷新页面重新初始化。
   */
  it('broadcasts message_metadata_updated after the state-frame tail lands (was: silent until refresh)', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        return Promise.resolve(tailPageOk())
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })

    const received: string[] = []
    const unsubscribe = agent.subscribe((event: { type: string }) => {
      received.push(event.type)
    })

    try {
      await startStreamingTurn(agent)
      received.length = 0
      emitReconnectStateFrame()
      await flushAllAsync()
      await flushAllAsync()

      expect(agent.state.messages).toHaveLength(2)
      expect(received).toContain('agent_end')
      expect(received).toContain('message_metadata_updated')
      // 合入通知必须晚于（补齐数据前的）agent_end，二者顺序不可颠倒。
      expect(received.indexOf('message_metadata_updated')).toBeGreaterThan(received.indexOf('agent_end'))
    } finally {
      unsubscribe()
      agent.dispose()
    }
  })

  /** 断连窗口丢的消息超过单页上限（500）时，尾部跨页：整体重跑续拉下一页。 */
  it('keeps fetching when the reconnect tail spans multiple pages', async () => {
    const middleAnswer: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'middle' }],
      timestamp: 99,
    } as unknown as AgentMessage
    const messageUrls: string[] = []
    let call = 0
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        messageUrls.push(href)
        call += 1
        if (call === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ messages: [middleAnswer], count: 3, hasMore: true }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ messages: [finalAnswer], count: 3, hasMore: false }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })

    try {
      await startStreamingTurn(agent)
      latestEventSource().emit('state', {
        sessionId: 'session-1',
        stateVersion: 6,
        isStreaming: false,
        messagesSummary: { count: 3 },
      })
      await flushAllAsync()
      await flushAllAsync()

      expect(messageUrls.length).toBe(2)
      expect(messageUrls[0]).toContain('after=1')
      expect(messageUrls[1]).toContain('after=2')
      expect(agent.state.messages).toHaveLength(3)
      expect(JSON.stringify(agent.state.messages)).toContain('middle')
      expect(JSON.stringify(agent.state.messages)).toContain('final answer')
    } finally {
      agent.dispose()
    }
  })

  /** 回滚/清理场景（服务端条数少于本地）走全量重拉；重拉失败同样进退避重试。 */
  it('retries the full refetch after a rollback when the refetch fails transiently', async () => {
    vi.useFakeTimers()
    let failuresLeft = 1
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/agents/session-1/messages')) {
        if (failuresLeft > 0) {
          failuresLeft -= 1
          return Promise.resolve(tailPageUnavailable())
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ messages: [userMessage], count: 1, hasMore: false }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage, finalAnswer] as AgentMessage[], stateVersion: 1 },
    })

    try {
      // 服务端已回滚到只剩 1 条：summary.count < localCount 触发全量重拉。
      latestEventSource().emit('state', {
        sessionId: 'session-1',
        stateVersion: 7,
        isStreaming: false,
        messagesSummary: { count: 1 },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/agents/session-1/messages')).length).toBe(1)
      // 全量重拉首拉失败：退避 1s 后重试成功，本地列表被服务端版本替换。
      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.state.messages).toHaveLength(1)
      expect(agent.state.messages[0]).toBe(userMessage)
    } finally {
      agent.dispose()
    }
  })
})
