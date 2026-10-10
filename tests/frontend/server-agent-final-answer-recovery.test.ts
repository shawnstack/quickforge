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
})
