import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import type { ServerAgent } from '../../src/lib/server-agent'

vi.mock('@/lib/types', () => ({
  agentAccessModeToYoloMode: (accessMode: string) => accessMode === 'full-access',
  normalizeAgentAccessMode: (accessMode?: string, fallback = 'default') => accessMode ?? fallback,
}), { virtual: true })

vi.mock('@/lib/random-id', () => ({
  randomId: () => 'test-id',
}), { virtual: true })

vi.mock('@/lib/managed-cloud-model', () => ({
  isManagedQuickForgeCloudModel: (model: { provider?: string; quickforgeModelSource?: string }) => model?.provider === 'quickforge-cloud' && model?.quickforgeModelSource === 'cloud',
}), { virtual: true })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

async function createDeferredAgent(
  createAgent: () => Promise<ServerAgent>,
  options?: { scope?: 'global' | 'project'; project?: { id: string; name: string; path: string; lastOpenedAt: string }; harness?: 'quickforge' | 'opencode' },
) {
  const { DeferredSessionAgent } = await import('../../src/lib/deferred-session-agent')
  return new DeferredSessionAgent({
    scope: options?.scope ?? 'global',
    project: options?.project,
    model: {
      provider: 'quickforge-cloud',
      id: 'test-model',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'test-model',
    } as Model<Api>,
    thinkingLevel: 'off',
    accessMode: 'default',
    harness: options?.harness ?? 'quickforge',
    yoloMode: false,
    createAgent,
  })
}

function createRealAgent() {
  const state = { messages: [] as AgentMessage[] }
  const prompt = vi.fn(async (message: AgentMessage) => {
    state.messages = [...state.messages, message]
  })
  return {
    state,
    prompt,
    setNextPromptCapabilities: vi.fn(),
    setPlanMode: vi.fn(),
  } as unknown as ServerAgent
}

describe('DeferredSessionAgent', () => {
  it('shows the first user message before the server session is ready', async () => {
    const realAgent = deferred<ServerAgent>()
    const createAgent = vi.fn(() => realAgent.promise)
    const agent = await createDeferredAgent(createAgent)
    const events: string[] = []
    agent.subscribe((event: AgentEvent) => events.push(event.type))

    void agent.prompt('hello')

    expect(agent.state.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'hello' }),
    ])
    expect(agent.state.isStreaming).toBe(true)
    expect(events).toEqual(['message_start', 'agent_start'])
    expect(createAgent).toHaveBeenCalledOnce()
  })

  it('hands the optimistic message to the real agent without duplicating it', async () => {
    const pendingAgent = deferred<ServerAgent>()
    const createAgent = vi.fn(() => pendingAgent.promise)
    const agent = await createDeferredAgent(createAgent)
    const realAgent = createRealAgent()

    const promptPromise = agent.prompt('hello')
    const optimisticMessage = agent.state.messages[0]
    pendingAgent.resolve(realAgent)
    await promptPromise

    expect(realAgent.prompt).toHaveBeenCalledWith(optimisticMessage)
    expect(realAgent.state.messages).toEqual([optimisticMessage])
    expect((optimisticMessage as AgentMessage & { metadata?: Record<string, unknown> }).metadata?.quickforgeClientMessageId).toMatch(/^qfcm_test-id$/)
    expect(createAgent.mock.calls[0]?.[0]).not.toHaveProperty('messages')
  })

  it('passes the selected project to the real session', async () => {
    const project = {
      id: 'project-1',
      name: 'Project 1',
      path: '/workspace/project-1',
      lastOpenedAt: '',
    }
    const createAgent = vi.fn(async () => createRealAgent())
    const agent = await createDeferredAgent(createAgent, { scope: 'project', project })

    await agent.prompt('hello')

    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Object),
      'test-id',
      expect.objectContaining({ scope: 'project', project }),
    )
  })

  it('creates an OpenCode deferred session with its Harness and no optimistic model updates', async () => {
    const createAgent = vi.fn(async () => createRealAgent())
    const agent = await createDeferredAgent(createAgent, { harness: 'opencode' })
    const originalModel = agent.state.model

    await agent.updateModel({ provider: 'other', id: 'other-model' } as Model<Api>)
    await agent.prompt('hello')

    expect(agent.state.model).toBe(originalModel)
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Object),
      'test-id',
      expect.objectContaining({ harness: 'opencode' }),
    )
  })

  it('rolls back the optimistic message when session creation fails', async () => {
    const pendingAgent = deferred<ServerAgent>()
    const agent = await createDeferredAgent(() => pendingAgent.promise)
    const events: string[] = []
    agent.subscribe((event: AgentEvent) => events.push(event.type))

    const promptPromise = agent.prompt('hello')
    pendingAgent.reject(new Error('Failed to create session'))

    await expect(promptPromise).rejects.toThrow('Failed to create session')
    expect(agent.state.messages).toEqual([])
    expect(agent.state.isStreaming).toBe(false)
    expect(agent.state.errorMessage).toBe('Failed to create session')
    expect(events).toEqual(['message_start', 'agent_start', 'error', 'agent_end'])
  })

  it('ignores a second prompt while the first session is being created', async () => {
    const pendingAgent = deferred<ServerAgent>()
    const createAgent = vi.fn(() => pendingAgent.promise)
    const agent = await createDeferredAgent(createAgent)

    void agent.prompt('first')
    void agent.prompt('second')

    expect(createAgent).toHaveBeenCalledOnce()
    expect(agent.state.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'first' }),
    ])
  })
})
