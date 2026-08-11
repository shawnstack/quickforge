import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh' }))

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
  t: (key: string) => {
    const messages = {
      en: {
        generationAlreadyRunning: 'Generation is still running. Stop it or wait until it finishes.',
        generationStillRunning: 'Generation is still running. Stop it or wait until it finishes before rolling back.',
      },
      zh: {
        generationAlreadyRunning: '生成仍在进行中。请停止生成或等待完成。',
        generationStillRunning: '生成仍在进行中。请停止生成或等待完成后再回滚。',
      },
    }
    return messages[i18nState.language][key as keyof typeof messages.en] ?? key
  },
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

vi.mock('@/lib/managed-cloud-model', () => ({
  isManagedQuickForgeCloudModel: (model: { provider?: string; quickforgeModelSource?: string }) => model?.provider === 'quickforge-cloud' && model?.quickforgeModelSource === 'cloud',
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
    i18nState.language = 'en'
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('omits the frontend placeholder model from an OpenCode create request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ harness: 'opencode', model: null, messages: [] }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const agent = await ServerAgent.create('session-1', {
      harness: 'opencode',
      model: {
        provider: 'opencode',
        id: 'opencode-managed',
        api: 'openai-completions',
        baseUrl: 'opencode://managed',
      },
    })

    try {
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      expect(body).toMatchObject({ harness: 'opencode' })
      expect(body).not.toHaveProperty('model')
      expect(body).not.toHaveProperty('modelRef')
      expect(body).not.toHaveProperty('thinkingLevel')
    } finally {
      agent.dispose()
    }
  })

  it('updates the OpenCode harness config option and refreshes the local acpSession snapshot', async () => {
    const refreshedSession = {
      configOptions: [{ id: 'enabled', name: 'Enabled', type: 'boolean', currentValue: false }],
      modes: { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }] },
      availableCommands: [],
      sessionInfo: {},
      usage: null,
    }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: 'session-1', acpSession: refreshedSession }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { harness: 'opencode', messages: [], acpSession: { configOptions: [], modes: null, availableCommands: [], sessionInfo: {}, usage: null } },
    })
    const events: Array<Record<string, unknown>> = []
    agent.subscribe((event) => events.push(event as unknown as Record<string, unknown>))

    try {
      await agent.setConfigOption('enabled', false)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/session-1/harness/config-option',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ configId: 'enabled', value: false }),
        }),
      )
      expect(agent.state.acpSession).toEqual(refreshedSession)
      expect(events).toContainEqual(expect.objectContaining({ type: 'acp_session_update', acpSession: refreshedSession }))
    } finally {
      agent.dispose()
    }
  })

  it('switches the OpenCode harness mode and refreshes the local acpSession snapshot', async () => {
    const refreshedSession = {
      configOptions: [],
      modes: { currentModeId: 'plan', availableModes: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }] },
      availableCommands: [],
      sessionInfo: {},
      usage: null,
    }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: 'session-1', acpSession: refreshedSession }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { harness: 'opencode', messages: [], acpSession: { configOptions: [], modes: null, availableCommands: [], sessionInfo: {}, usage: null } },
    })
    const events: Array<Record<string, unknown>> = []
    agent.subscribe((event) => events.push(event as unknown as Record<string, unknown>))

    try {
      await agent.setMode('plan')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/session-1/harness/mode',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modeId: 'plan' }),
        }),
      )
      expect(agent.state.acpSession).toEqual(refreshedSession)
      expect(events).toContainEqual(expect.objectContaining({ type: 'acp_session_update', acpSession: refreshedSession }))
    } finally {
      agent.dispose()
    }
  })

  it('forks the entire OpenCode session through the session fork API', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: 'forked-1', title: 'Copy', scope: 'global', projectId: null }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { harness: 'opencode', harnessSessionId: 'acp-session-1', messages: [] },
    })

    try {
      const result = await agent.forkSession()
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/fork', expect.objectContaining({ method: 'POST' }))
      expect(result).toMatchObject({ sessionId: 'forked-1', title: 'Copy' })
    } finally {
      agent.dispose()
    }
  })

  it('applies acp_session_usage_update events to the OpenCode usage snapshot', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        harness: 'opencode',
        messages: [],
        acpSession: { configOptions: [], modes: null, availableCommands: [], sessionInfo: {}, usage: { used: 5, size: 100 } },
      },
    })

    try {
      latestEventSource().emit('acp_session_usage_update', {
        sessionId: 'session-1',
        usage: { used: 12, size: 100, cost: { amount: 1.5, currency: 'USD' } },
      })
      expect(agent.state.acpSession?.usage).toEqual({ used: 12, size: 100, cost: { amount: 1.5, currency: 'USD' } })
      // The usage event never maps into the QuickForge contextUsage estimate.
      expect(agent.state.contextUsage).toBeNull()
    } finally {
      agent.dispose()
    }
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

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/session-1/state',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(agent.state.messages.map((message) => message.content)).toEqual(['first', 'reply', 'second'])
    } finally {
      agent.dispose()
    }
  })

  it('adds and submits a stable logical message ID with the optimistic Cloud prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        model: {
          provider: 'quickforge-cloud',
          id: 'qf-fast',
          quickforgeModelSource: 'cloud',
          quickforgeCatalogId: 'qf-fast',
        },
        messages: [],
      },
    })

    try {
      await agent.prompt('hello')
      const promptCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/prompt')) as [string, RequestInit] | undefined
      const body = JSON.parse(String(promptCall?.[1]?.body))
      const messageId = body.message.metadata.quickforgeClientMessageId

      expect(messageId).toMatch(/^qfcm_[0-9a-f-]{36}$/)
      expect(agent.state.messages[0]).toMatchObject({ metadata: { quickforgeClientMessageId: messageId } })
    } finally {
      agent.dispose()
    }
  })

  it('keeps non-Cloud optimistic prompts unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { model: { provider: 'mock', id: 'mock-model' }, messages: [] },
    })

    try {
      await agent.prompt('hello')
      expect(agent.state.messages[0]).not.toHaveProperty('metadata.quickforgeClientMessageId')
    } finally {
      agent.dispose()
    }
  })

  it('localizes a generation conflict from its stable error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Generation is still running. Stop it or wait until it finishes.',
        code: 'GENERATION_ALREADY_RUNNING',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    i18nState.language = 'zh'
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [{ role: 'user', content: 'hello' }] as AgentMessage[] },
    })

    try {
      await expect(agent.continue()).rejects.toThrow('生成仍在进行中。请停止生成或等待完成。')
    } finally {
      agent.dispose()
    }
  })

  it('rolls back the optimistic user message when sending fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => null,
    })
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

      await vi.waitFor(() => {
        expect(agent.state.messages).toEqual([{ role: 'assistant', content: 'ready' }])
      })

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

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/session-1/state',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )

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

  it('restores messages and running state with a single restore request', async () => {
    const fetchMock = vi.fn(async () => ({
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
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const { agent } = await ServerAgent.restore('evicted-session')

    try {
      expect(agent.state.messages).toEqual([
        { role: 'user', content: 'server request' },
        { role: 'assistant', content: 'server partial response' },
      ])
      expect(agent.state.isStreaming).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/evicted-session/restore',
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      )
    } finally {
      agent.dispose()
    }
  })

  it('does not create an SSE client when restore is aborted', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')
    const controller = new AbortController()

    const restore = ServerAgent.restore('aborted-session', { signal: controller.signal })
    controller.abort()
    pending.resolve(new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(restore).rejects.toMatchObject({ name: 'AbortError' })
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('restores running tool snapshots and pending calls with a single restore request', async () => {
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
    const fetchMock = vi.fn(async () => ({
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
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const { agent } = await ServerAgent.restore('evicted-session')

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
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/evicted-session/restore',
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      )
    } finally {
      agent.dispose()
    }
  })

  it('retries status recovery after a timed out watchdog request', async () => {
    vi.useFakeTimers()
    let statusCalls = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/status')) {
        statusCalls += 1
        if (statusCalls === 1) {
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ stateVersion: 2, isStreaming: false, status: 'idle' }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ stateVersion: 2, isStreaming: false, messages: [] }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [], isStreaming: true, stateVersion: 1 },
    })

    try {
      await vi.advanceTimersByTimeAsync(25_000)
      expect(statusCalls).toBe(1)
      expect(agent.state.isStreaming).toBe(true)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(statusCalls).toBe(2)
      expect(agent.state.isStreaming).toBe(false)
    } finally {
      agent.dispose()
    }
  })

  it('clears a timed out state refresh so a later sync can retry', async () => {
    vi.useFakeTimers()
    let stateCalls = 0
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      stateCalls += 1
      if (stateCalls === 1) {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ stateVersion: 2, isStreaming: false, messages: [{ role: 'assistant', content: 'recovered' }] }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({ sessionId: 'session-1', initialState: { messages: [] } })
    try {
      const firstSync = agent.syncState()
      await vi.advanceTimersByTimeAsync(30_000)
      await firstSync

      await agent.syncState()
      expect(stateCalls).toBe(2)
      expect(agent.state.messages).toEqual([{ role: 'assistant', content: 'recovered' }])
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

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/session-1/status',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/session-1/state',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(agent.state.isStreaming).toBe(false)
    } finally {
      agent.dispose()
      vi.useRealTimers()
    }
  })
})
