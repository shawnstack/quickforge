import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  static instances = []

  constructor(options = {}) {
    MockAgent.instances.push(this)
    this.options = options
    this.state = {
      ...(options.initialState || {}),
      messages: options.initialState?.messages ? [...options.initialState.messages] : [],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.signal = new AbortController().signal
    this.listeners = new Set()
    this.lastTransformedMessages = null
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(message) {
    this.state.messages.push(message)
    this.lastTransformedMessages = await this.options.transformContext(this.state.messages, this.signal)
    for (const listener of this.listeners) await listener({ type: 'message_end', message })
    for (const listener of this.listeners) await listener({ type: 'agent_end', messages: this.state.messages })
  }

  async continue() {
    this.lastTransformedMessages = await this.options.transformContext(this.state.messages, this.signal)
    for (const listener of this.listeners) await listener({ type: 'agent_end', messages: this.state.messages })
  }

  abort() {}
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

describe('agent manager external session synchronization', () => {
  let tmpDir
  let previousDataDir
  let databaseModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-external-sync-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    MockAgent.instances = []
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
  })

  afterEach(async () => {
    await databaseModule?.closeSqliteStorage().catch(() => {})
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('keeps transient ACP context out of visible and persisted user messages', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, getSessionState, runPrompt } = await import('../../server/agent-manager.mjs')
    const { readSessionValue } = await import('../../server/storage.mjs')
    const sessionId = 'transient-context-session'
    await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      await runPrompt(sessionId, 'Hi', [], null, '<acp_context>\nWorkspace root: test\n</acp_context>')
      await vi.waitFor(() => expect(getSessionState(sessionId)?.messages).toHaveLength(1))
      await vi.waitFor(async () => expect((await readSessionValue(sessionId))?.messages).toHaveLength(1))

      expect(getSessionState(sessionId)?.messages[0].content).toBe('Hi')
      expect((await readSessionValue(sessionId))?.messages[0].content).toBe('Hi')
      expect(MockAgent.instances[0].lastTransformedMessages[0].content).toContain('<acp_context>')
      expect(MockAgent.instances[0].lastTransformedMessages[0].content).toContain('User request:\nHi')
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('persists a stable logical message ID for Cloud prompts and reuses it after restore', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { continueSession, createAgent, destroyAgent, getSessionState, restoreAgent, runPrompt } = await import('../../server/agent-manager.mjs')
    const { readSessionValue } = await import('../../server/storage.mjs')
    const sessionId = 'cloud-idempotency-session'
    const model = {
      provider: 'quickforge-cloud',
      id: 'qf-fast',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'qf-fast',
    }
    await createAgent(sessionId, {
      scope: 'global',
      model,
      systemPrompt: '',
      idleRetention: 'always',
    })

    await runPrompt(sessionId, 'Hi', [])
    await vi.waitFor(async () => expect((await readSessionValue(sessionId))?.messages).toHaveLength(1))
    const storedMessage = (await readSessionValue(sessionId)).messages[0]
    const logicalMessageId = storedMessage.metadata?.quickforgeClientMessageId

    expect(logicalMessageId).toMatch(/^qfcm_[0-9a-f-]{36}$/)
    await destroyAgent(sessionId)
    const { setCloudRuntimeForTests } = await import('../../server/cloud/runtime.mjs')
    setCloudRuntimeForTests({
      enabled: true,
      models: { resolve: vi.fn(async () => ({ publicModel: model })) },
    })
    const restored = await restoreAgent(sessionId)

    try {
      expect(getSessionState(sessionId)?.messages[0].metadata?.quickforgeClientMessageId).toBe(logicalMessageId)
      await continueSession(sessionId, { isLocalRequest: true })
      await vi.waitFor(() => expect(restored.agent.lastTransformedMessages).not.toBeNull())
      expect(restored.agent.lastTransformedMessages[0].metadata?.quickforgeClientMessageId).toBe(logicalMessageId)
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('persists each Cloud user message before continuing to the provider loop', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, runPrompt } = await import('../../server/agent-manager.mjs')
    const { readSessionValue } = await import('../../server/storage.mjs')
    const sessionId = 'cloud-second-message-session'
    await createAgent(sessionId, {
      scope: 'global',
      model: {
        provider: 'quickforge-cloud',
        id: 'qf-fast',
        quickforgeModelSource: 'cloud',
        quickforgeCatalogId: 'qf-fast',
      },
      systemPrompt: '',
      messages: [
        { role: 'user', content: 'first', timestamp: '2025-01-01T00:00:00.000Z' },
        { role: 'assistant', content: 'reply', timestamp: '2025-01-01T00:00:01.000Z' },
      ],
      idleRetention: 'always',
    })

    try {
      await runPrompt(sessionId, 'second', [])
      await vi.waitFor(() => expect(MockAgent.instances[0].lastTransformedMessages).not.toBeNull())
      const stored = await readSessionValue(sessionId)
      expect(stored.messages.at(-1).metadata?.quickforgeClientMessageId).toMatch(/^qfcm_[0-9a-f-]{36}$/)
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('does not add logical Cloud metadata to non-Cloud prompts', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, getSessionState, runPrompt } = await import('../../server/agent-manager.mjs')
    const { readSessionValue } = await import('../../server/storage.mjs')
    const sessionId = 'non-cloud-idempotency-session'
    await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      await runPrompt(sessionId, 'Hi', [])
      await vi.waitFor(() => expect(getSessionState(sessionId)?.messages).toHaveLength(1))
      expect(getSessionState(sessionId)?.messages[0].metadata?.quickforgeClientMessageId).toBeUndefined()
      await vi.waitFor(async () => expect(await readSessionValue(sessionId)).toBeTruthy())
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('publishes a channel session event after an ACP session is persisted', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { publishChannelSessionChanged } = await import('../../server/channels/event-relay.mjs')
    const { createAgent, destroyAgent, runPrompt } = await import('../../server/agent-manager.mjs')
    const sessionId = 'channel-event-session'
    await createAgent(sessionId, {
      scope: 'global',
      source: 'acp',
      channelId: 'wechat',
      channelName: '微信',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      await runPrompt(sessionId, 'Hi', [])
      await vi.waitFor(() => expect(publishChannelSessionChanged).toHaveBeenCalled())
      expect(publishChannelSessionChanged).toHaveBeenLastCalledWith(expect.objectContaining({
        channelId: 'wechat',
        channelName: '微信',
        sessionId,
        projectId: null,
        workspace: { id: 'default', kind: 'default' },
        change: 'upsert',
        metadata: expect.objectContaining({ id: sessionId, source: 'acp', channelId: 'wechat' }),
      }))
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('loads messages appended by another process into an idle in-memory session', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, getSessionState, syncSessionFromStorage } = await import('../../server/agent-manager.mjs')
    const { writeSessionValue } = await import('../../server/storage.mjs')
    const sessionId = 'external-message-session'
    const firstMessage = { role: 'user', content: 'first', timestamp: '2025-01-01T00:00:00.000Z' }
    await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: [firstMessage],
      lastModified: '2025-01-01T00:00:00.000Z',
      stateVersion: 1,
      idleRetention: 'always',
    })

    await writeSessionValue(sessionId, {
      id: sessionId,
      title: 'External conversation',
      titleSource: 'fallback',
      scope: 'global',
      messages: [
        firstMessage,
        { role: 'assistant', content: 'reply', timestamp: '2025-01-01T00:00:01.000Z' },
        { role: 'user', content: 'second', timestamp: '2025-01-01T00:00:02.000Z' },
      ],
      lastModified: '2025-01-01T00:00:02.000Z',
      stateVersion: 5,
      taskStatus: 'idle',
    })

    try {
      await syncSessionFromStorage(sessionId)
      expect(getSessionState(sessionId)?.messages.map((message) => message.content)).toEqual(['first', 'reply', 'second'])
      expect(getSessionState(sessionId)?.stateVersion).toBe(5)
    } finally {
      await destroyAgent(sessionId)
    }
  })
})
