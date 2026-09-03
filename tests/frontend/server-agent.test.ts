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

// In-memory fake for the session message snapshot cache (F12). The mock
// replaces the debounce entirely: writeSessionMessageSnapshot only records a
// pending builder; tests flush explicitly and inspect the built payloads.
const sessionCacheMock = vi.hoisted(() => ({
  read: null as unknown,
  writes: [] as Array<{ key: string; payload: unknown }>,
  scheduled: 0,
  pending: new Map<string, () => unknown>(),
  reset() {
    this.read = null
    this.writes = []
    this.scheduled = 0
    this.pending.clear()
  },
}))

vi.mock('@/lib/session-message-cache', () => ({
  resolveServerCacheKey: (baseUrl = '') => baseUrl || 'unknown',
  readSessionMessageSnapshot: async () => sessionCacheMock.read ?? null,
  writeSessionMessageSnapshot: (serverKey: string, sessionId: string, build: () => unknown) => {
    sessionCacheMock.scheduled += 1
    sessionCacheMock.pending.set(`${serverKey}::${sessionId}`, build)
  },
  flushPendingSessionMessageWrites: async () => {
    for (const [key, build] of [...sessionCacheMock.pending]) {
      sessionCacheMock.pending.delete(key)
      const payload = build()
      if (payload !== null && payload !== undefined) sessionCacheMock.writes.push({ key, payload })
    }
  },
  cancelPendingSessionMessageWrites: () => {
    sessionCacheMock.pending.clear()
  },
}))

async function createServerAgent(config: ConstructorParameters<typeof import('../../src/lib/server-agent').ServerAgent>[0]) {
  const { ServerAgent } = await import('../../src/lib/server-agent')
  return new ServerAgent(config)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Flush the microtask AND macrotask queues so fire-and-forget SSE-driven
 *  reconciliation chains (multiple awaits through fetch mocks) fully settle. */
async function flushAllAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setImmediate(resolve))
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
    sessionCacheMock.reset()
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

  it('sends selected capabilities once, decorates the optimistic user message, and coexists with file references', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({ sessionId: 'session-capabilities', initialState: { model: { provider: 'mock', id: 'mock' }, messages: [] } })
    const refs = [{ type: 'file' as const, projectId: 'project-1', path: 'src/main.ts' }]
    const capabilities = [
      { type: 'plugin' as const, pluginName: 'documents', name: 'documents', label: 'Documents', description: 'Create docs' },
      { type: 'plugin' as const, pluginName: 'documents', name: 'documents', label: 'Duplicate' },
      { type: 'tool' as const, pluginName: 'demo', name: 'lint', label: 'Lint' },
    ]

    try {
      agent.setNextPromptCapabilities(capabilities)
      agent.setNextPromptContextReferences(refs)
      await agent.prompt({ role: 'user', content: 'inspect this', details: { keep: true } } as AgentMessage)
      const firstCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/prompt')) as [string, RequestInit]
      const firstBody = JSON.parse(String(firstCall[1].body))
      expect(firstBody.selectedCapabilities).toEqual([
        capabilities[0],
        capabilities[2],
      ])
      expect(agent.state.messages[0]).toMatchObject({
        details: {
          keep: true,
          contextReferences: refs,
          selectedCapabilities: [
            { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' },
            { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Lint' },
          ],
        },
      })

      agent.state.isStreaming = false
      await agent.prompt('next')
      const promptCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/prompt')) as Array<[string, RequestInit]>
      const nextBody = JSON.parse(String(promptCalls[1][1].body))
      expect(nextBody.selectedCapabilities).toEqual([])
      expect(nextBody.message).not.toHaveProperty('details.selectedCapabilities')
    } finally {
      agent.dispose()
    }
  })

  it('sends file context references once and decorates the optimistic user message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({ sessionId: 'session-refs', initialState: { model: { provider: 'mock', id: 'mock' }, messages: [] } })
    const refs = [{ type: 'file' as const, projectId: 'project-1', path: 'src/main.ts' }]

    try {
      const consumed = vi.fn()
      agent.setNextPromptContextReferences(refs, consumed)
      await agent.prompt('inspect this')
      expect(consumed).toHaveBeenCalledOnce()
      const firstCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/prompt')) as [string, RequestInit]
      const firstBody = JSON.parse(String(firstCall[1].body))
      expect(firstBody.contextReferences).toEqual(refs)
      expect(agent.state.messages[0]).toMatchObject({ details: { contextReferences: refs } })

      agent.state.isStreaming = false
      await agent.prompt('next')
      const promptCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/prompt')) as Array<[string, RequestInit]>
      expect(JSON.parse(String(promptCalls[1][1].body)).contextReferences).toEqual([])
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

  it('shows the concrete prompt HTTP error after rolling back the optimistic user message', async () => {
    const errorMessage = 'Selected model is not configured in QuickForge.'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: errorMessage, code: 'model_not_configured' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        model: { api: 'openai-completions', provider: 'mock', id: 'mock-model' },
        messages: [{ role: 'assistant', content: 'ready' }] as AgentMessage[],
      },
    })
    const events: Array<Record<string, unknown>> = []
    agent.subscribe((event) => events.push(event as unknown as Record<string, unknown>))

    try {
      await agent.prompt('hello')
      expect(agent.state.messages).toEqual([
        { role: 'assistant', content: 'ready' },
        expect.objectContaining({ role: 'user', content: 'hello' }),
      ])

      await vi.waitFor(() => {
        expect(agent.state.messages).toHaveLength(2)
        expect(agent.state.messages.at(-1)).toMatchObject({
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          api: 'openai-completions',
          provider: 'mock',
          model: 'mock-model',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'error',
          errorMessage,
          timestamp: expect.any(Number),
        })
      })

      expect(agent.state.messages).not.toContainEqual(expect.objectContaining({ role: 'user', content: 'hello' }))
      expect(agent.state.messages.filter((message) => message.role === 'assistant' && message.stopReason === 'error')).toHaveLength(1)
      expect(agent.state.isStreaming).toBe(false)
      expect(agent.state.streamingMessage).toBeUndefined()
      expect(agent.state.errorMessage).toBe(errorMessage)
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', error: errorMessage }))
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_end',
        status: 'error',
        errorMessage,
        messages: agent.state.messages,
      }))
    } finally {
      agent.dispose()
      vi.clearAllTimers()
    }
  })

  it('attaches the failed prompt to the synthesized error message for retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Selected model is not configured in QuickForge.', code: 'model_not_configured' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-failed-prompt-stash',
      initialState: {
        model: { api: 'openai-completions', provider: 'mock', id: 'mock-model' },
        messages: [{ role: 'assistant', content: 'ready' }] as AgentMessage[],
      },
    })
    try {
      await agent.prompt('hello')
      await vi.waitFor(() => {
        expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'error', errorMessage: 'Selected model is not configured in QuickForge.' })
      })
      expect((agent.state.messages.at(-1) as unknown as Record<string, unknown>).quickforgeFailedPrompt).toMatchObject({
        role: 'user',
        content: 'hello',
      })
    } finally {
      agent.dispose()
    }
  })

  it('retryFailedPrompt re-sends the original message with its capability snapshot and drops the error entry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'boom', code: 'model_not_configured' }),
      })
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-retry-failed-prompt',
      initialState: {
        model: { api: 'openai-completions', provider: 'mock', id: 'mock-model' },
        messages: [{ role: 'assistant', content: 'ready' }] as AgentMessage[],
      },
    })
    try {
      agent.setNextPromptCapabilities([{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }])
      await agent.prompt('hello')
      await vi.waitFor(() => {
        expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'error', errorMessage: 'boom' })
      })
      expect(agent.state.messages).toHaveLength(2)

      await expect(agent.retryFailedPrompt(agent.state.messages.at(-1) as AgentMessage)).resolves.toBe(true)

      expect(agent.state.messages).toHaveLength(2)
      expect(agent.state.messages.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
      expect(agent.state.messages.some((message) => (message as { stopReason?: string }).stopReason === 'error')).toBe(false)
      const resent = agent.state.messages.at(-1) as unknown as { details?: { selectedCapabilities?: Array<Record<string, unknown>> } }
      expect(resent.details?.selectedCapabilities).toEqual([
        { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' },
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
        message: { content: string; details?: { selectedCapabilities?: unknown[] } }
      }
      expect(retryBody.message.content).toBe('hello')
      expect(retryBody.message.details?.selectedCapabilities).toHaveLength(1)
    } finally {
      agent.dispose()
    }
  })

  it('retryFailedPrompt returns false for error entries without a stash', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-retry-no-stash',
      initialState: {
        model: { api: 'openai-completions', provider: 'mock', id: 'mock-model' },
        messages: [],
      },
    })
    try {
      await expect(agent.retryFailedPrompt({
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        stopReason: 'error',
        errorMessage: 'x',
      } as AgentMessage)).resolves.toBe(false)
    } finally {
      agent.dispose()
    }
  })

  it('retryFailedPrompt refuses to run while the agent is streaming', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'boom', code: 'model_not_configured' }),
      })
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-retry-streaming',
      initialState: {
        model: { api: 'openai-completions', provider: 'mock', id: 'mock-model' },
        messages: [{ role: 'assistant', content: 'ready' }] as AgentMessage[],
      },
    })
    try {
      await agent.prompt('hello')
      await vi.waitFor(() => {
        expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'error', errorMessage: 'boom' })
      })
      const errorEntry = agent.state.messages.at(-1) as AgentMessage

      await agent.prompt('second')
      expect(agent.state.isStreaming).toBe(true)

      await expect(agent.retryFailedPrompt(errorEntry)).resolves.toBe(false)
    } finally {
      agent.dispose()
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

  it('steer shows the message immediately and reconciles the server echo in place', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'working' },
        ] as AgentMessage[],
        isStreaming: true,
      },
    })

    try {
      const seenEvents: string[] = []
      agent.subscribe((event) => { seenEvents.push(event.type) })

      const steered = { role: 'user', content: 'jump ahead', timestamp: 4242 } as unknown as AgentMessage
      await agent.steer(steered)

      // Optimistic: the message is appended and the panel is notified before
      // the server has injected anything.
      expect(agent.state.messages.at(-1)).toBe(steered)
      expect(seenEvents).toContain('message_start')
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/steer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: steered }),
      })

      // The server drains the steering queue at the next tool-round boundary
      // and echoes the identical message; the copy is replaced in place, not
      // duplicated.
      latestEventSource().emit('message_end', { sessionId: 'session-1', message: steered })
      expect(agent.state.messages.filter((message) => (message as { timestamp?: number }).timestamp === 4242)).toHaveLength(1)
      expect(agent.state.messages).toHaveLength(3)
    } finally {
      agent.dispose()
    }
  })

  it('steer rolls the optimistic message back when the server rejects it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [{ role: 'user', content: 'first' }] as AgentMessage[],
        isStreaming: true,
      },
    })

    try {
      const seenEvents: string[] = []
      agent.subscribe((event) => { seenEvents.push(event.type) })
      const before = agent.state.messages

      const steered = { role: 'user', content: 'jump ahead', timestamp: 99 } as unknown as AgentMessage
      await expect(agent.steer(steered)).rejects.toThrow('Failed to steer: HTTP 409')

      // The UI must never keep a message the server never accepted.
      expect(agent.state.messages).toEqual(before)
      // A second message_start nudges the panel to re-render without it.
      expect(seenEvents.filter((type) => type === 'message_start')).toHaveLength(2)
    } finally {
      agent.dispose()
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

  it('publishes subagent run updates from tool_execution SSE events without the local tool renderer', async () => {
    const { subagentRunStore } = await import('../../src/lib/subagent-run-detail')
    subagentRunStore.clear()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: 'session-1', harness: 'quickforge', model: null, messages: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { harness: 'quickforge', model: null as unknown as never, messages: [] },
    })
    const source = latestEventSource()

    try {
      source.emit('tool_execution_start', {
        sessionId: 'session-1',
        toolCallId: 'call-9',
        toolName: 'run_subagent',
        args: { subagent: 'explore', task: 'Find' },
      })
      expect(subagentRunStore.get('call-9')?.status).toBe('running')
      expect(subagentRunStore.get('call-9')?.task).toBe('Find')

      source.emit('tool_execution_update', {
        sessionId: 'session-1',
        toolCallId: 'call-9',
        partialResult: { content: [], details: { messages: [] } },
      })
      expect(subagentRunStore.get('call-9')?.status).toBe('running')

      source.emit('tool_execution_end', {
        sessionId: 'session-1',
        toolCallId: 'call-9',
        toolName: 'run_subagent',
        result: {
          content: [{ type: 'text', text: 'ok' }],
          details: { quickforgeTiming: { startedAt: 1, finishedAt: 2, durationMs: 1 } },
        },
      })
      expect(subagentRunStore.get('call-9')?.status).toBe('done')
      expect(subagentRunStore.get('call-9')?.output).toBe('ok')
      expect(subagentRunStore.get('call-9')?.runId).toBe('call-9')
    } finally {
      agent.dispose()
      subagentRunStore.clear()
    }
  })

  it('merges incremental message tails positionally without duplication', async () => {
    const { mergeIncrementalMessages } = await import('../../src/lib/server-agent')
    const base = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ] as AgentMessage[]

    // Pure append: positions beyond the current length are pushed.
    expect(mergeIncrementalMessages(base, 2, [{ role: 'user', content: 'c' }]).map((message) => message.content))
      .toEqual(['a', 'b', 'c'])

    // Overlapping tail (already applied via message_end upserts) is skipped.
    expect(mergeIncrementalMessages(base, 1, [
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]).map((message) => message.content)).toEqual(['a', 'b', 'c'])

    // Same-position content change replaces the local version.
    expect(mergeIncrementalMessages(base, 1, [{ role: 'assistant', content: 'b-edited' }]).map((message) => message.content))
      .toEqual(['a', 'b-edited'])

    // Message-id equality wins over content comparison.
    const withIds = [{ role: 'user', content: 'old', id: 'm1' }] as AgentMessage[]
    expect(mergeIncrementalMessages(withIds, 0, [{ role: 'user', content: 'new-but-same-id', id: 'm1' }])).toEqual(withIds)
  })

  it('fills missing messages after a split-session reconnect through the messages channel', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/agents/session-1/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            after: 2,
            count: 4,
            hasMore: false,
            messages: [
              { role: 'assistant', content: 'third' },
              { role: 'user', content: 'fourth' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ] as AgentMessage[],
        stateVersion: 1,
      },
    })

    try {
      const source = latestEventSource()
      source.emit('state', { sessionId: 'session-1', stateVersion: 2, messagesSummary: { count: 4 } })
      await flushPromises()
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/messages?after=2', expect.objectContaining({ signal: expect.any(AbortSignal) }))
      expect(agent.state.messages.map((message) => message.content)).toEqual(['first', 'second', 'third', 'fourth'])
    } finally {
      agent.dispose()
    }
  })

  it('refetches and replaces when a split-session state summary is shorter than local state', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/agents/session-1/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            after: 0,
            count: 1,
            hasMore: false,
            messages: [{ role: 'user', content: 'only' }],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ] as AgentMessage[],
        stateVersion: 3,
      },
    })

    try {
      const source = latestEventSource()
      source.emit('state', { sessionId: 'session-1', stateVersion: 4, messagesSummary: { count: 1 } })
      await flushAllAsync()
      expect(agent.state.messages.map((message) => message.content)).toEqual(['only'])
    } finally {
      agent.dispose()
    }
  })

  it('merges incremental message_end tails without fetching the full history', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ] as AgentMessage[],
        stateVersion: 1,
      },
    })

    try {
      const source = latestEventSource()
      source.emit('message_end', {
        sessionId: 'session-1',
        stateVersion: 2,
        messagesAfter: 2,
        messagesIncremental: true,
        messages: [{ role: 'user', content: 'third' }],
        messagesSummary: { count: 3 },
      })
      expect(agent.state.messages.map((message) => message.content)).toEqual(['first', 'second', 'third'])
      // The incremental frame must not trigger a state refresh or message fetch.
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      agent.dispose()
    }
  })

  it('refetches everything when a split-session messages_replaced frame carries only a summary', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/agents/session-1/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            after: 0,
            count: 2,
            hasMore: false,
            messages: [
              { role: 'user', content: 'rolled-a' },
              { role: 'assistant', content: 'rolled-b' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ] as AgentMessage[],
        stateVersion: 3,
      },
    })

    try {
      const source = latestEventSource()
      source.emit('messages_replaced', { sessionId: 'session-1', stateVersion: 4, messagesSummary: { count: 2 } })
      await flushAllAsync()
      expect(agent.state.messages.map((message) => message.content)).toEqual(['rolled-a', 'rolled-b'])
    } finally {
      agent.dispose()
    }
  })

  it('materializes messages through the messages channel when /restore returns a summary', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/restore')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessionId: 'session-1', stateVersion: 1, messageStorage: 'split', messagesSummary: { count: 2 } }),
        }
      }
      if (url.startsWith('/api/agents/session-1/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            after: 0,
            count: 2,
            hasMore: false,
            messages: [
              { role: 'user', content: 'a' },
              { role: 'assistant', content: 'b' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')
    const { agent } = await ServerAgent.restore('session-1', { baseUrl: '' })
    try {
      expect(agent.state.messages.map((message) => message.content)).toEqual(['a', 'b'])
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/session-1/messages?after=0', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    } finally {
      agent.dispose()
    }
  })

  // --- Session message snapshot cache (F12 Phase 2+3) -----------------------

  function cachedEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      schemaVersion: 1,
      serverKey: 'unknown',
      sessionId: 'cached-session',
      stateVersion: 5,
      messageCount: 2,
      messages: [
        { role: 'user', content: 'cached q' },
        { role: 'assistant', content: 'cached a' },
      ],
      snapshot: { stateVersion: 5, title: 'Cached chat', systemPrompt: 'sys', isStreaming: false },
      savedAt: 1,
      ...overrides,
    }
  }

  it('hydrates from the snapshot cache and calibrates without POST /restore', async () => {
    sessionCacheMock.read = cachedEntry()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ stateVersion: 5, messagesSummary: { count: 2 }, isStreaming: false }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const { agent, snapshot } = await ServerAgent.restore('cached-session')

    try {
      expect(agent.state.messages).toEqual([
        { role: 'user', content: 'cached q' },
        { role: 'assistant', content: 'cached a' },
      ])
      expect(snapshot.title).toBe('Cached chat')

      await flushAllAsync()
      const urls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(urls.some((url) => url.endsWith('/restore'))).toBe(false)
      expect(urls.some((url) => url.includes('/messages'))).toBe(false)
      expect(urls.some((url) => url.endsWith('/state'))).toBe(true)
    } finally {
      agent.dispose()
    }
  })

  it('fills the missing tail through the messages channel when the cached snapshot is behind', async () => {
    sessionCacheMock.read = cachedEntry()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ stateVersion: 6, messagesSummary: { count: 3 }, isStreaming: false }),
        }
      }
      if (url.startsWith('/api/agents/cached-session/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            after: 2,
            count: 3,
            hasMore: false,
            messages: [{ role: 'user', content: 'third' }],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const { agent } = await ServerAgent.restore('cached-session')

    try {
      await flushAllAsync()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/cached-session/messages?after=2',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(agent.state.messages.map((message) => message.content)).toEqual(['cached q', 'cached a', 'third'])
    } finally {
      agent.dispose()
    }
  })

  it('schedules a snapshot write after a full restore materialization', async () => {
    sessionCacheMock.read = null
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/restore')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessionId: 'session-1', stateVersion: 4, messageStorage: 'split', messagesSummary: { count: 2 } }),
        }
      }
      if (url.startsWith('/api/agents/session-1/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            after: 0,
            count: 2,
            hasMore: false,
            messages: [
              { role: 'user', content: 'a' },
              { role: 'assistant', content: 'b' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const { agent } = await ServerAgent.restore('session-1', { baseUrl: '' })

    try {
      expect(agent.state.messages.map((message) => message.content)).toEqual(['a', 'b'])
      expect(sessionCacheMock.scheduled).toBeGreaterThanOrEqual(1)

      const cacheModule = await import('../../src/lib/session-message-cache')
      await cacheModule.flushPendingSessionMessageWrites()
      expect(sessionCacheMock.writes).toHaveLength(1)

      const write = sessionCacheMock.writes[0]
      expect(write.key).toBe('unknown::session-1')
      const payload = write.payload as { stateVersion: number; messages: Array<{ content: string }>; snapshot: Record<string, unknown> }
      expect(payload.stateVersion).toBe(4)
      expect(payload.messages.map((message) => message.content)).toEqual(['a', 'b'])
      expect(payload.snapshot.messages).toBeUndefined()
      expect(payload.snapshot.messagesSummary).toBeUndefined()
      expect(payload.snapshot.stateVersion).toBe(4)
    } finally {
      agent.dispose()
    }
  })

  it('schedules a snapshot write after create materializes the state', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/agents/create-1')) {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ stateVersion: 2, messages: [{ role: 'user', content: 'seed' }] }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const agent = await ServerAgent.create('create-1')

    try {
      expect(agent.state.messages).toEqual([{ role: 'user', content: 'seed' }])
      expect(sessionCacheMock.scheduled).toBeGreaterThanOrEqual(1)

      const cacheModule = await import('../../src/lib/session-message-cache')
      await cacheModule.flushPendingSessionMessageWrites()
      expect(sessionCacheMock.writes).toHaveLength(1)
      const payload = sessionCacheMock.writes[0].payload as { stateVersion: number; messages: Array<{ content: string }> }
      expect(payload.stateVersion).toBe(2)
      expect(payload.messages.map((message) => message.content)).toEqual(['seed'])
    } finally {
      agent.dispose()
    }
  })

  it('schedules a snapshot write after SSE message_end incremental frames', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ] as AgentMessage[],
        stateVersion: 1,
      },
    })

    try {
      expect(sessionCacheMock.scheduled).toBe(0)
      latestEventSource().emit('message_end', {
        sessionId: 'session-1',
        stateVersion: 2,
        messagesAfter: 2,
        messagesIncremental: true,
        messages: [{ role: 'user', content: 'third' }],
        messagesSummary: { count: 3 },
      })
      expect(sessionCacheMock.scheduled).toBe(1)

      const cacheModule = await import('../../src/lib/session-message-cache')
      await cacheModule.flushPendingSessionMessageWrites()
      const payload = sessionCacheMock.writes[0].payload as { stateVersion: number; messages: Array<{ content: string }> }
      expect(payload.stateVersion).toBe(2)
      expect(payload.messages.map((message) => message.content)).toEqual(['first', 'second', 'third'])
    } finally {
      agent.dispose()
    }
  })

  it('keeps cached messages when the post-hydration calibration request fails', async () => {
    sessionCacheMock.read = cachedEntry()
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ServerAgent } = await import('../../src/lib/server-agent')

    const { agent } = await ServerAgent.restore('cached-session')

    try {
      await flushAllAsync()
      expect(agent.state.messages).toEqual([
        { role: 'user', content: 'cached q' },
        { role: 'assistant', content: 'cached a' },
      ])
      expect(agent.state.isStreaming).toBe(false)
    } finally {
      agent.dispose()
    }
  })

  it('tracks the persist-degraded flag from dedicated SSE events and notifies listeners', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [{ role: 'user', content: 'first' }] as AgentMessage[], stateVersion: 1 },
    })

    try {
      const events: string[] = []
      agent.subscribe((event) => { events.push(String((event as { type?: unknown }).type)) })

      const source = latestEventSource()
      source.emit('persist_degraded', { sessionId: 'session-1', stateVersion: 2, persistDegraded: true })
      expect(agent.state.persistDegraded).toBe(true)
      expect(events).toContain('persist_degraded')

      source.emit('persist_degraded', { sessionId: 'session-1', stateVersion: 3, persistDegraded: false })
      expect(agent.state.persistDegraded).toBeUndefined()
    } finally {
      agent.dispose()
    }
  })

  it('applies persistDegraded from full state frames, clearing it when absent', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [{ role: 'user', content: 'first' }] as AgentMessage[], stateVersion: 1 },
    })

    try {
      const source = latestEventSource()
      source.emit('state', { sessionId: 'session-1', stateVersion: 2, persistDegraded: true })
      expect(agent.state.persistDegraded).toBe(true)

      // Full state snapshots are authoritative: no flag means healthy again.
      source.emit('state', { sessionId: 'session-1', stateVersion: 3 })
      expect(agent.state.persistDegraded).toBeUndefined()
    } finally {
      agent.dispose()
    }
  })

  it('picks up persistDegraded through a /state refresh', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/agents/session-1/state') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stateVersion: 2,
            messages: [{ role: 'user', content: 'first' }],
            persistDegraded: true,
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [{ role: 'user', content: 'first' }] as AgentMessage[], stateVersion: 1 },
    })

    try {
      await agent.syncState()
      expect(agent.state.persistDegraded).toBe(true)
    } finally {
      agent.dispose()
    }
  })

  describe('model_stream_retry forwarding', () => {
    it('forwards retry progress and recovery events to subscribers', async () => {
      const agent = await createServerAgent({ sessionId: 'model-retry-forward-1' })
      const events: Array<Record<string, unknown>> = []
      const unsubscribe = agent.subscribe((event) => events.push(event as Record<string, unknown>))
      try {
        latestEventSource().emit('model_stream_retry', { sessionId: 'model-retry-forward-1', attempt: 3, maxAttempts: 10 })
        expect(events.at(-1)).toMatchObject({ type: 'model_stream_retry', attempt: 3, maxAttempts: 10 })

        latestEventSource().emit('model_stream_retry', { sessionId: 'model-retry-forward-1', recovered: true })
        expect(events.at(-1)).toMatchObject({ type: 'model_stream_retry', recovered: true })
      } finally {
        unsubscribe()
        agent.dispose()
      }
    })
  })

  describe('SSE reconnect connection state', () => {
  it('counts attempts with backoff and notifies reconnecting progress', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState } = await import('../../src/lib/server-agent')
    const agent = await createServerAgent({ sessionId: 'sse-reconnect-1' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      const first = latestEventSource()
      first.onerror?.(new Event('error'))
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1, maxAttempts: 10 })
      expect((statuses.at(-1)!.nextRetryAt as number) - Date.now()).toBeLessThanOrEqual(1000)

      vi.advanceTimersByTime(1000)
      const second = latestEventSource()
      expect(second).not.toBe(first)
      second.onerror?.(new Event('error'))
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 2, maxAttempts: 10 })
      expect((statuses.at(-1)!.nextRetryAt as number) - Date.now()).toBeLessThanOrEqual(2000)
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('stops auto-reconnecting with a failed status after the attempt cap', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState, MAX_SSE_RECONNECT_ATTEMPTS } = await import('../../src/lib/server-agent')
    const agent = await createServerAgent({ sessionId: 'sse-reconnect-2' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      const instanceCount = () => MockEventSource.instances.length
      // Backoff ladder: 1s, 2s, 4s, 8s, 16s, 30s… — advance by each delay before the next error.
      let delay = 1000
      for (let attempt = 1; attempt <= MAX_SSE_RECONNECT_ATTEMPTS; attempt++) {
        latestEventSource().onerror?.(new Event('error'))
        expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt })
        vi.advanceTimersByTime(delay)
        delay = Math.min(delay * 2, 30000)
      }
      const instancesAtCap = instanceCount()
      latestEventSource().onerror?.(new Event('error'))
      expect(statuses.at(-1)).toEqual({ status: 'failed', maxAttempts: MAX_SSE_RECONNECT_ATTEMPTS })

      vi.advanceTimersByTime(60000)
      expect(instanceCount()).toBe(instancesAtCap)
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('reports a recovered connection on open and resets the attempt counter', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState } = await import('../../src/lib/server-agent')
    const agent = await createServerAgent({ sessionId: 'sse-reconnect-3' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      latestEventSource().onerror?.(new Event('error'))
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1 })

      vi.advanceTimersByTime(1000)
      latestEventSource().onopen?.(new Event('open'))
      expect(statuses.at(-1)).toEqual({ status: 'connected', recovered: true })

      latestEventSource().onerror?.(new Event('error'))
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1 })
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('retries immediately from the failed state via requestSseReconnectNow', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState, requestSseReconnectNow } = await import('../../src/lib/server-agent')
    const agent = await createServerAgent({ sessionId: 'sse-reconnect-4' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      let delay = 1000
      for (let i = 0; i <= 10; i++) {
        latestEventSource().onerror?.(new Event('error'))
        if (i < 10) {
          vi.advanceTimersByTime(delay)
          delay = Math.min(delay * 2, 30000)
        }
      }
      expect(statuses.at(-1)).toMatchObject({ status: 'failed' })

      const instancesBeforeRetry = MockEventSource.instances.length
      requestSseReconnectNow()
      expect(MockEventSource.instances.length).toBe(instancesBeforeRetry + 1)
      const reopened = latestEventSource()

      reopened.onerror?.(new Event('error'))
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1 })
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  // --- 重连期间 /api/health 后台探测（unreachable 持续重试 + bootId 重启检测） ---

  /** 冲刷微任务队列，让 fire-and-forget 的 health 探测链路（fetch → json → then）落定。 */
  async function settleHealthProbe() {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  /** /api/health 可控 fetch mock；其余 URL 一律 200 空对象，避免误伤其它调用。 */
  function stubHealthFetch(health: () => { ok: boolean; status: number; json: () => unknown }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/health')) return health()
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('keeps retrying past the cap with an unreachable flag when the health probe fails', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState, MAX_SSE_RECONNECT_ATTEMPTS } = await import('../../src/lib/server-agent')
    stubHealthFetch(() => ({ ok: false, status: 503, json: async () => ({}) }))
    const agent = await createServerAgent({ sessionId: 'sse-health-unreachable-1' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      // 探测结果落地：仍处重连中 → 广播带 unreachable:true。
      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1, unreachable: true })

      // 走完退避梯子并超出 10 次上限：不可达时仍不进 failed、持续自动重连。
      let delay = 1000
      for (let attempt = 2; attempt <= MAX_SSE_RECONNECT_ATTEMPTS + 1; attempt++) {
        vi.advanceTimersByTime(delay)
        delay = Math.min(delay * 2, 30000)
        latestEventSource().onerror?.(new Event('error'))
        await settleHealthProbe()
        expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt, unreachable: true })
      }
      expect(statuses.some((status) => status.status === 'failed')).toBe(false)

      const instancesAtCap = MockEventSource.instances.length
      vi.advanceTimersByTime(30000)
      expect(MockEventSource.instances.length).toBe(instancesAtCap + 1)
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('still stops at the failed cap when the backend health check stays reachable', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState, MAX_SSE_RECONNECT_ATTEMPTS } = await import('../../src/lib/server-agent')
    stubHealthFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, bootId: 'boot-green' }) }))
    const agent = await createServerAgent({ sessionId: 'sse-health-reachable-1' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      let delay = 1000
      for (let attempt = 1; attempt <= MAX_SSE_RECONNECT_ATTEMPTS; attempt++) {
        latestEventSource().onerror?.(new Event('error'))
        await settleHealthProbe()
        vi.advanceTimersByTime(delay)
        delay = Math.min(delay * 2, 30000)
      }
      latestEventSource().onerror?.(new Event('error'))
      expect(statuses.at(-1)).toEqual({ status: 'failed', maxAttempts: MAX_SSE_RECONNECT_ATTEMPTS })
      // health 可达时所有 reconnecting 广播都不携带 unreachable 字段。
      for (const status of statuses) {
        if (status.status === 'reconnecting') expect(status.unreachable).toBeUndefined()
      }
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('notifies restarted on recovery when the server bootId changed', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState } = await import('../../src/lib/server-agent')
    let bootId = 'boot-1'
    stubHealthFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, bootId }) }))
    const agent = await createServerAgent({ sessionId: 'sse-health-bootid-1' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      // 首次连接：仅记录 bootId 基线，不广播。
      latestEventSource().onopen?.(new Event('open'))
      await settleHealthProbe()
      expect(statuses).toHaveLength(0)

      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1 })

      vi.advanceTimersByTime(1000)
      bootId = 'boot-2'
      latestEventSource().onopen?.(new Event('open'))
      expect(statuses.at(-1)).toEqual({ status: 'connected', recovered: true })
      await settleHealthProbe()
      // 基线 boot-1 ≠ 新 boot-2 → 补播一次 restarted。
      expect(statuses.at(-1)).toEqual({ status: 'connected', recovered: true, restarted: true })
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('does not flag restarted when the bootId is unchanged on recovery', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState } = await import('../../src/lib/server-agent')
    stubHealthFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, bootId: 'boot-same' }) }))
    const agent = await createServerAgent({ sessionId: 'sse-health-bootid-2' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      latestEventSource().onopen?.(new Event('open'))
      await settleHealthProbe()

      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      vi.advanceTimersByTime(1000)
      latestEventSource().onopen?.(new Event('open'))
      await settleHealthProbe()

      expect(statuses.at(-1)).toEqual({ status: 'connected', recovered: true })
      expect(statuses.some((status) => status.restarted === true)).toBe(false)
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('stamps unreachableSince once per outage and clears it on recovery', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState } = await import('../../src/lib/server-agent')
    let reachable = false
    stubHealthFetch(() => ({ ok: reachable, status: reachable ? 200 : 503, json: async () => (reachable ? { ok: true, bootId: 'boot-since' } : {}) }))
    const agent = await createServerAgent({ sessionId: 'sse-health-since-1' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      const startedAt = Date.now()
      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      // 不可达广播携带窗口起始时间戳（false→true 沿记录一次）。
      const since = statuses.at(-1)!.unreachableSince
      expect(since).toBeTypeOf('number')
      expect(since as number).toBeGreaterThanOrEqual(startedAt)
      expect(since as number).toBeLessThanOrEqual(Date.now())

      vi.advanceTimersByTime(1000)
      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      // 同一轮不可达期间时间戳保持不变（后续重试广播复用）。
      expect(statuses.at(-1)!.unreachableSince).toBe(since)

      // 恢复：onopen 广播 connected 并清除不可达窗口。
      reachable = true
      vi.advanceTimersByTime(2000)
      latestEventSource().onopen?.(new Event('open'))
      expect(statuses.at(-1)).toEqual({ status: 'connected', recovered: true })
      await settleHealthProbe()

      // 再次断连且 health 可达：reconnecting 广播不再携带 unreachable/unreachableSince。
      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1 })
      expect(statuses.at(-1)!.unreachable).toBeUndefined()
      expect(statuses.at(-1)!.unreachableSince).toBeUndefined()
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })

  it('treats health probe fetch failures and timeouts as unreachable', async () => {
    vi.useFakeTimers()
    const statuses: Array<Record<string, unknown>> = []
    const { subscribeSseConnectionState } = await import('../../src/lib/server-agent')
    const agent = await createServerAgent({ sessionId: 'sse-health-error-1' })
    const unsubscribe = subscribeSseConnectionState((status) => statuses.push(status as Record<string, unknown>))

    try {
      // fetch 直接抛错 → reachable:false。
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('fetch failed')
      }))
      latestEventSource().onerror?.(new Event('error'))
      await settleHealthProbe()
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1, unreachable: true })

      // fetch 挂起直到 abort 超时（SSE_HEALTH_PROBE_TIMEOUT_MS=5000）→ reachable:false。
      vi.advanceTimersByTime(1000)
      vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })))
      latestEventSource().onerror?.(new Event('error'))
      vi.advanceTimersByTime(5000)
      await settleHealthProbe()
      expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 2, unreachable: true })
    } finally {
      unsubscribe()
      agent.dispose()
      vi.useRealTimers()
    }
  })
})
})
