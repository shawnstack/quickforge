import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  static instances = []

  constructor(options = {}) {
    MockAgent.instances.push(this)
    this.state = {
      ...(options.initialState || {}),
      messages: [],
      pendingToolCalls: new Set(),
      isStreaming: true,
    }
    this.listeners = new Set()
    this.signal = new AbortController().signal
    this.abort = vi.fn()
    this.waitForIdle = vi.fn(() => new Promise(() => {}))
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: MockAgent,
  estimateContextTokens: vi.fn(() => 0),
  estimateTokens: vi.fn(() => 0),
  shouldCompact: vi.fn(() => false),
}))
vi.mock('../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: vi.fn() }))
vi.mock('../../server/mcp/registry.mjs', () => ({
  createMcpToolDefinitions: vi.fn(async () => []),
  isMcpToolName: vi.fn(() => false),
  subscribeMcpToolsetChanged: vi.fn(() => () => {}),
}))
vi.mock('../../server/plugins/registry.mjs', () => ({
  callPluginTool: vi.fn(),
  createPluginToolDefinitions: vi.fn(async () => []),
  getEnabledPluginCommandSources: vi.fn(async () => []),
  getEnabledPluginSkillSources: vi.fn(async () => []),
  isPluginToolName: vi.fn(() => false),
}))
vi.mock('../../server/channels/event-relay.mjs', () => ({
  publishChannelSessionChanged: vi.fn(async () => true),
}))

describe('agent manager abort', () => {
  let tmpDir
  let previousDataDir

  beforeEach(async () => {
    vi.useFakeTimers()
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-abort-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    MockAgent.instances = []
    vi.resetModules()
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns after a bounded wait when the agent never becomes idle', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { abortRun, createAgent, destroyAgent, getSessionStatus } = await import('../../server/agent-manager.mjs')
    const sessionId = 'stuck-abort-session'
    const session = await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })
    session.status = 'running'

    try {
      const resultPromise = abortRun(sessionId)
      await vi.advanceTimersByTimeAsync(3000)

      await expect(resultPromise).resolves.toEqual({ sessionId, aborted: true })
      expect(session.agent.abort).toHaveBeenCalledOnce()
      expect(getSessionStatus(sessionId)?.status).toBe('aborted')
      expect(getSessionStatus(sessionId)?.isStreaming).toBe(false)
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('does not append the request-aborted error message when the user stopped the run', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, getSessionStatus } = await import('../../server/agent-manager.mjs')
    const sessionId = 'user-abort-no-error-message'
    const session = await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })
    session.status = 'running'
    // 用户点击停止后的终态：signal 已 abort，pi-agent-core 已落 stopReason='aborted'
    // 消息，state.errorMessage 还带着 pi-ai 抛出的 "Request was aborted."
    const controller = new AbortController()
    controller.abort()
    session.agent.signal = controller.signal
    session.agent.state.messages = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'partial answer' }], stopReason: 'aborted', errorMessage: 'Request was aborted.' },
    ]
    session.agent.state.errorMessage = 'Request was aborted.'

    try {
      for (const listener of session.agent.listeners) {
        await listener({ type: 'agent_end', messages: session.agent.state.messages })
      }
      expect(session.agent.state.messages).toHaveLength(2)
      expect(session.agent.state.messages.at(-1).stopReason).toBe('aborted')
      expect(session.agent.state.errorMessage).toBeUndefined()
      expect(getSessionStatus(sessionId)?.status).toBe('aborted')
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('still appends the error message when the run failed without a user abort', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, getSessionStatus } = await import('../../server/agent-manager.mjs')
    const sessionId = 'natural-failure-error-message'
    const session = await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })
    session.status = 'running'
    session.agent.state.messages = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'partial answer' }] },
    ]
    session.agent.state.errorMessage = 'AI stream idle timeout after 60000ms'

    try {
      for (const listener of session.agent.listeners) {
        await listener({ type: 'agent_end', messages: session.agent.state.messages })
      }
      expect(session.agent.state.messages).toHaveLength(3)
      expect(session.agent.state.messages.at(-1).stopReason).toBe('error')
      expect(session.agent.state.messages.at(-1).errorMessage).toBe('AI stream idle timeout after 60000ms')
      expect(getSessionStatus(sessionId)?.status).toBe('error')
    } finally {
      await destroyAgent(sessionId)
    }
  })
})
