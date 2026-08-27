import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  constructor(options = {}) {
    this.options = options
    this.state = {
      ...(options.initialState || {}),
      messages: options.initialState?.messages ? [...options.initialState.messages] : [],
      isStreaming: false,
    }
    this.signal = new AbortController().signal
    this.listeners = new Set()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(message) {
    this.state.messages.push(message)
    for (const listener of this.listeners) await listener({ type: 'message_end', message })
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

describe('agent manager channel session events', () => {
  let tmpDir
  let previousDataDir
  let databaseModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-channel-event-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
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

  it('publishes after an ACP channel session is persisted', async () => {
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
})
