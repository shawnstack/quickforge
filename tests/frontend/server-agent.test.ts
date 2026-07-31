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

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}), { virtual: true })

vi.mock('@/lib/tool-execution-events', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/tool-execution-events')>('../../src/lib/tool-execution-events')
  return actual
}, { virtual: true })

async function createServerAgent(config: ConstructorParameters<typeof import('../../src/lib/server-agent').ServerAgent>[0]) {
  const { ServerAgent } = await import('../../src/lib/server-agent')
  return new ServerAgent(config)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function latestEventSource(): MockEventSource {
  const eventSource = MockEventSource.instances.at(-1)
  if (!eventSource) throw new Error('Expected an EventSource instance')
  return eventSource
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('ServerAgent', () => {
  beforeEach(() => {
    vi.resetModules()
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refreshes visible messages from the server on demand', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        stateVersion: 2,
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'second' },
        ],
        isStreaming: false,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [{ role: 'user', content: 'first' }] as AgentMessage[],
        stateVersion: 1,
      },
    })

    try {
      await agent.syncState()

      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/state')
      expect(agent.state.messages.map((message) => message.content)).toEqual(['first', 'reply', 'second'])
    } finally {
      agent.dispose()
    }
  })

  it('rolls back the optimistic user message when sending fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [{ role: 'assistant', content: 'ready' }] as AgentMessage[] },
    })

    try {
      await agent.prompt('hello')
      expect(agent.state.messages).toEqual([
        { role: 'assistant', content: 'ready' },
        expect.objectContaining({ role: 'user', content: 'hello' }),
      ])

      await flushPromises()

      expect(agent.state.messages).toEqual([{ role: 'assistant', content: 'ready' }])
      expect(agent.state.isStreaming).toBe(false)
      expect(agent.state.errorMessage).toBe('Failed to send prompt: HTTP 409')
    } finally {
      agent.dispose()
      vi.clearAllTimers()
    }
  })

  it('ignores duplicate prompts while already streaming', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const messages = [{ role: 'user', content: 'first' }] as AgentMessage[]
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages, isStreaming: true },
    })

    try {
      await agent.prompt('second')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(agent.state.messages).toEqual(messages)
      expect(agent.state.isStreaming).toBe(true)
    } finally {
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('does not let a stale forced state refresh overwrite newer messages', async () => {
    const stateResponse = deferred<Record<string, unknown>>()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => stateResponse.promise,
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [{ role: 'user', content: 'before' }] as AgentMessage[],
        isStreaming: true,
        stateVersion: 1,
      },
    })

    try {
      const eventSource = latestEventSource()
      eventSource.emit('agent_end', { sessionId: 'session-1', stateVersion: 2 })
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/state')

      const rolledBackMessages = [] as AgentMessage[]
      eventSource.emit('messages_replaced', {
        sessionId: 'session-1',
        stateVersion: 3,
        messages: rolledBackMessages,
      })
      expect(agent.state.messages).toEqual(rolledBackMessages)

      stateResponse.resolve({
        stateVersion: 2,
        messages: [
          { role: 'user', content: 'before' },
          { role: 'assistant', content: 'stale response' },
        ],
        isStreaming: false,
      })
      await flushPromises()

      expect(agent.state.messages).toEqual(rolledBackMessages)
    } finally {
      agent.dispose()
    }
  })

  it('keeps streaming after an error event until agent_end arrives', async () => {
    vi.useFakeTimers()
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [], stateVersion: 1 },
    })

    try {
      const eventSource = latestEventSource()
      eventSource.emit('agent_start', { sessionId: 'session-1', stateVersion: 2 })
      expect(agent.state.isStreaming).toBe(true)

      eventSource.emit('error', {
        sessionId: 'session-1',
        stateVersion: 3,
        error: 'tool failed',
      })
      expect(agent.state.errorMessage).toBe('tool failed')
      expect(agent.state.isStreaming).toBe(true)

      eventSource.emit('agent_end', {
        sessionId: 'session-1',
        stateVersion: 4,
        messages: [],
        errorMessage: 'tool failed',
      })
      expect(agent.state.isStreaming).toBe(false)
    } finally {
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('ignores SSE events older than the latest server state version', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [{ role: 'user', content: 'current' }] as AgentMessage[],
        stateVersion: 3,
      },
    })

    try {
      latestEventSource().emit('messages_replaced', {
        sessionId: 'session-1',
        stateVersion: 2,
        messages: [{ role: 'user', content: 'stale' }],
      })

      expect(agent.state.messages).toEqual([{ role: 'user', content: 'current' }])
    } finally {
      agent.dispose()
    }
  })

  it('restores messages and running state from the server when recreating an evicted agent', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({}) }
      if (url.endsWith('/state')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stateVersion: 7,
            isStreaming: true,
            messages: [
              { role: 'user', content: 'server request' },
              { role: 'assistant', content: 'server partial response' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const agent = await ServerAgent.create('evicted-session', {
      messages: [{ role: 'user', content: 'stale local state' }] as AgentMessage[],
    })

    try {
      expect(agent.state.messages).toEqual([
        { role: 'user', content: 'server request' },
        { role: 'assistant', content: 'server partial response' },
      ])
      expect(agent.state.isStreaming).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/evicted-session/state')
    } finally {
      agent.dispose()
    }
  })

  it('restores running tool snapshots and pending calls from the server when recreating an evicted agent', async () => {
    const runningToolResult = {
      role: 'toolResult',
      toolCallId: 'tool-call-subagent',
      toolName: 'run_subagent',
      content: [],
      details: {
        sessionId: 'evicted-session:subagent:explore:1',
        toolCallId: 'tool-call-subagent',
        messages: [{ role: 'assistant', content: 'checking files' }],
        tools: [{ name: 'read_file' }],
        pendingToolCalls: ['nested-tool-call'],
      },
      isError: false,
      timestamp: 123,
    } as AgentMessage
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({}) }
      if (url.endsWith('/state')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stateVersion: 7,
            isStreaming: true,
            pendingToolCalls: ['tool-call-subagent'],
            messages: [
              { role: 'user', content: 'server request' },
              runningToolResult,
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const agent = await ServerAgent.create('evicted-session', {
      messages: [{ role: 'user', content: 'stale local state' }] as AgentMessage[],
    })

    try {
      expect(agent.state.messages).toEqual([
        { role: 'user', content: 'server request' },
        runningToolResult,
      ])
      expect(Array.from(agent.state.pendingToolCalls)).toEqual(['tool-call-subagent'])
      expect((agent.state.messages[1] as { details?: { messages?: AgentMessage[] } }).details?.messages).toEqual([
        { role: 'assistant', content: 'checking files' },
      ])
      expect(agent.state.isStreaming).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/evicted-session/state')
    } finally {
      agent.dispose()
    }
  })

  it('clears streaming when status reports completion even if the state version went backwards', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ stateVersion: 1, isStreaming: false, status: 'idle' }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ stateVersion: 1, isStreaming: false, messages: [] }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [{ role: 'user', content: 'waiting' }] as AgentMessage[],
        isStreaming: true,
        stateVersion: 5,
      },
    })

    try {
      await vi.advanceTimersByTimeAsync(15_000)

      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/status')
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/state')
      expect(agent.state.isStreaming).toBe(false)
    } finally {
      agent.dispose()
      vi.useRealTimers()
    }
  })
})
