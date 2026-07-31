import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  constructor(options = {}) {
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

describe('agent manager external session state synchronization', () => {
  let tmpDir
  let previousDataDir

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-channel-sync-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
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
