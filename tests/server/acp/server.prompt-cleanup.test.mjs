import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  eventBus: null,
  runPrompt: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', async () => {
  const { EventEmitter } = await import('node:events')
  mocks.eventBus = new EventEmitter()
  return {
    abortRun: vi.fn(async () => {}),
    createAgent: vi.fn(),
    destroyAgent: vi.fn(),
    getSessionEventBus: vi.fn(() => mocks.eventBus),
    getSessionState: vi.fn(() => ({ sessionId: 'acp-session', model: null, thinkingLevel: 'off' })),
    listAgentSessions: vi.fn(() => []),
    loadAgentSession: vi.fn(),
    rejectToolCall: vi.fn(),
    resolveToolCall: vi.fn(),
    restoreAgent: vi.fn(),
    runPrompt: mocks.runPrompt,
    setSessionAgentAccessMode: vi.fn(),
    updateSessionModel: vi.fn(),
    updateSessionThinkingLevel: vi.fn(),
  }
})

class MockSignal {
  aborted = false
  listeners = new Set()
  addEventListener = vi.fn((_type, listener) => {
    this.listeners.add(listener)
  })
  removeEventListener = vi.fn((_type, listener) => {
    this.listeners.delete(listener)
  })
}

beforeEach(() => {
  mocks.runPrompt.mockReset()
  mocks.eventBus?.removeAllListeners()
  vi.resetModules()
})

describe('ACP prompt lifecycle', () => {
  it('rejects a concurrent prompt without failing the active prompt', async () => {
    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    const connection = { sessionUpdate: vi.fn(async () => {}) }
    const signal = new MockSignal()
    mocks.runPrompt.mockResolvedValue(undefined)

    const first = agent.prompt({
      sessionId: 'acp-session',
      prompt: [{ type: 'text', text: 'first' }],
    }, connection, signal)
    await Promise.resolve()

    await expect(agent.prompt({
      sessionId: 'acp-session',
      prompt: [{ type: 'text', text: 'second' }],
    }, connection, signal)).rejects.toThrow('already running')

    mocks.eventBus.emit('agent_event', { type: 'agent_end', status: 'idle' })
    await expect(first).resolves.toEqual({ stopReason: 'end_turn' })
    expect(mocks.runPrompt).toHaveBeenCalledOnce()
  })

  it('cleans pending state and listeners when runPrompt fails to start', async () => {
    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    const connection = { sessionUpdate: vi.fn(async () => {}) }
    const signal = new MockSignal()
    mocks.runPrompt.mockRejectedValueOnce(new Error('prompt startup failed'))

    await expect(agent.prompt({
      sessionId: 'acp-session',
      prompt: [{ type: 'text', text: 'hello' }],
    }, connection, signal)).rejects.toThrow('prompt startup failed')

    expect(mocks.eventBus.listenerCount('agent_event')).toBe(0)
    expect(signal.listeners.size).toBe(0)
    expect(signal.removeEventListener).toHaveBeenCalledOnce()

    mocks.runPrompt.mockImplementationOnce(async () => {
      queueMicrotask(() => mocks.eventBus.emit('agent_event', { type: 'agent_end', status: 'idle' }))
    })
    await expect(agent.prompt({
      sessionId: 'acp-session',
      prompt: [{ type: 'text', text: 'retry' }],
    }, connection, signal)).resolves.toEqual({ stopReason: 'end_turn' })
    expect(mocks.runPrompt).toHaveBeenCalledTimes(2)
  })
})
