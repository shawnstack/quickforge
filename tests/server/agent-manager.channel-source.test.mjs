import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  constructor(options = {}) {
    this.state = {
      ...(options.initialState || {}),
      messages: options.initialState?.messages ? [...options.initialState.messages] : [],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.listeners = new Set()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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

describe('agent manager channel source persistence', () => {
  let tmpDir
  let previousDataDir
  let databaseModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-channel-source-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
  })

  afterEach(async () => {
    await databaseModule?.closeSqliteStorage().catch(() => {})
    await databaseModule?.closeSqliteStorage().catch(() => {})
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('stores ACP channel identity in session data and metadata', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, persistSessionState } = await import('../../server/agent-manager.mjs')
    const { readSessionValue, readStore } = await import('../../server/storage.mjs')
    const sessionId = 'channel-session'
    const session = await createAgent(sessionId, {
      scope: 'global',
      source: 'acp',
      channelId: 'wechat',
      channelName: '微信',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello', timestamp: '2025-01-01T00:00:00.000Z' }],
      idleRetention: 'always',
    })

    try {
      await persistSessionState(session)
      expect(await readSessionValue(sessionId)).toMatchObject({
        source: 'acp',
        channelId: 'wechat',
        channelName: '微信',
      })
      expect((await readStore('sessions-metadata'))[sessionId]).toMatchObject({
        source: 'acp',
        channelId: 'wechat',
        channelName: '微信',
        stateVersion: session.stateVersion,
      })
    } finally {
      await destroyAgent(sessionId)
    }
  })
})
