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
  options?: { scope?: 'global' | 'project'; project?: { id: string; name: string; path: string; lastOpenedAt: string } },
) {
  const { DeferredSessionAgent } = await import('../../src/lib/deferred-session-agent')
  return new DeferredSessionAgent({
    scope: options?.scope ?? 'global',
    project: options?.project,
    model: {
      provider: 'custom',
      id: 'test-model',
    } as Model<Api>,
    thinkingLevel: 'off',
    accessMode: 'default',
    yoloMode: false,
    createAgent,
  })
}

function createRealAgent(handoffMessages: AgentMessage[] = []) {
  // 真实 agent 的 state 由 useAgentManager 的 handoff 装载；prompt 收到
  // messageAlreadyInState 时不再重复追加（与 ServerAgent.prompt 同语义）。
  const state = { messages: [...handoffMessages] }
  const prompt = vi.fn(async (message: AgentMessage, options?: { messageAlreadyInState?: boolean }) => {
    const last = state.messages[state.messages.length - 1]
    if (options?.messageAlreadyInState === true && last === message) return
    state.messages = [...state.messages, message]
  })
  const setNextPromptContextReferences = vi.fn((_references: unknown, onConsumed?: () => void) => onConsumed?.())
  return {
    state,
    prompt,
    setNextPromptCapabilities: vi.fn(),
    setNextPromptContextReferences,
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

  it('hands the optimistic message to the real agent instead of re-appending it', async () => {
    const pendingAgent = deferred<ServerAgent>()
    let handoffMessages: AgentMessage[] | undefined
    const createAgent = vi.fn(
      (_initialState?: unknown, _sessionId?: string, options?: { handoffMessages?: AgentMessage[] }) => {
        handoffMessages = options?.handoffMessages
        return pendingAgent.promise
      },
    )
    const agent = await createDeferredAgent(createAgent)

    const promptPromise = agent.prompt('hello')
    const optimisticMessage = agent.state.messages[0]
    // useAgentManager 负责把交接消息装进真实 agent（这里显式模拟）。
    const realAgent = createRealAgent(handoffMessages)
    pendingAgent.resolve(realAgent)
    await promptPromise

    // 真实 agent 必须带着这条消息上屏：attach 之后的第一帧不能是「0 条消息」
    // 的空会话（那会被当成全新空对话，触发自动落项目、回到欢迎页）。
    expect(handoffMessages).toEqual([optimisticMessage])
    expect(realAgent.state.messages).toEqual([optimisticMessage])
    expect(realAgent.prompt).toHaveBeenCalledWith(optimisticMessage, { messageAlreadyInState: true })
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

  it('forwards selected capabilities and file references to the real agent for the first prompt only', async () => {
    const realAgent = createRealAgent()
    const agent = await createDeferredAgent(async () => realAgent)
    const refs = [{ type: 'file' as const, projectId: 'project-1', path: 'src/main.ts' }]
    const capabilities = [
      { type: 'plugin' as const, pluginName: 'documents', name: 'documents', label: 'Documents', description: 'Create docs' },
      { type: 'plugin' as const, pluginName: 'documents', name: 'documents', label: 'Duplicate' },
      { type: 'tool' as const, pluginName: 'demo', name: 'lint', label: 'Lint' },
    ]
    const consumed = vi.fn()
    agent.setNextPromptCapabilities(capabilities)
    agent.setNextPromptContextReferences(refs, consumed)

    await agent.prompt({ role: 'user', content: 'first', details: { keep: true } } as AgentMessage)

    expect(realAgent.setNextPromptCapabilities).toHaveBeenCalledWith([capabilities[0], capabilities[2]])
    expect(realAgent.setNextPromptContextReferences).toHaveBeenCalledWith(refs, consumed)
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
  })
})
