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

function mockReq(method, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    [Symbol.asyncIterator]() {
      let i = 0
      const chunks = [text]
      return {
        async next() {
          if (i < chunks.length) return { value: Buffer.from(chunks[i++]), done: false }
          return { done: true }
        },
      }
    },
  }
}

function mockRes() {
  const res = { headersSent: false, _status: null, _body: '' }
  res.writeHead = (status) => { res._status = status; res.headersSent = true }
  res.end = (body) => { res._body = body ?? '' }
  return res
}

const PROVIDER_ID = 'prov-refresh'
const MODEL = { provider: PROVIDER_ID, id: 'model-a', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }

function providerWithModel(maxTokens) {
  return { id: PROVIDER_ID, baseUrl: MODEL.baseUrl, models: [{ ...MODEL, maxTokens }] }
}

async function setupSession(sessionId, maxTokens) {
  const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
  setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
  const { writeStore } = await import('../../server/storage.mjs')
  const { createAgent } = await import('../../server/agent-manager.mjs')
  await writeStore('custom-providers', { [PROVIDER_ID]: providerWithModel(maxTokens) })
  return createAgent(sessionId, {
    scope: 'global',
    model: { ...MODEL, maxTokens },
    modelRef: { version: 1, source: 'custom', providerId: PROVIDER_ID, modelId: MODEL.id },
    systemPrompt: '',
    idleRetention: 'always',
  })
}

let tmpDir
let previousDataDir

describe('model config refresh for active sessions', () => {
  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-model-refresh-'))
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

  it('refreshes session.model and emits a state event when custom-providers changes via the storage route', async () => {
    const sessionId = 'model-refresh-session'
    const session = await setupSession(sessionId, 1000)
    const { destroyAgent, agentEvents } = await import('../../server/agent-manager.mjs')
    const route = await import('../../server/routes/storage.mjs')

    const events = []
    const onEvent = (event) => events.push(event)
    agentEvents.on('agent_event', onEvent)

    try {
      expect(session.model.maxTokens).toBe(1000)

      const res = mockRes()
      await route.handleStorageApi(
        mockReq('PUT', { value: providerWithModel(2000) }),
        res,
        new URL(`http://localhost/api/storage/custom-providers/key/${encodeURIComponent(PROVIDER_ID)}`),
      )
      expect(res._status).toBe(200)

      expect(session.model.maxTokens).toBe(2000)
      expect(session.agent.state.model.maxTokens).toBe(2000)
      const stateEvents = events.filter((event) => event.type === 'state' && event.sessionId === sessionId)
      expect(stateEvents).toHaveLength(1)
      expect(stateEvents[0].model.maxTokens).toBe(2000)
    } finally {
      agentEvents.off('agent_event', onEvent)
      await destroyAgent(sessionId)
    }
  })

  it('does not emit a state event when the model config is unchanged', async () => {
    const sessionId = 'model-refresh-noop'
    const session = await setupSession(sessionId, 1000)
    const { destroyAgent, refreshAllSessionModels, agentEvents } = await import('../../server/agent-manager.mjs')

    const events = []
    const onEvent = (event) => events.push(event)
    agentEvents.on('agent_event', onEvent)

    try {
      await refreshAllSessionModels()
      expect(session.model.maxTokens).toBe(1000)
      expect(events.filter((event) => event.type === 'state' && event.sessionId === sessionId)).toHaveLength(0)
    } finally {
      agentEvents.off('agent_event', onEvent)
      await destroyAgent(sessionId)
    }
  })

  it('skips streaming sessions and non-QuickForge harness sessions', async () => {
    const sessionId = 'model-refresh-skip'
    const session = await setupSession(sessionId, 1000)
    const { destroyAgent, refreshAllSessionModels, agentEvents } = await import('../../server/agent-manager.mjs')
    const { writeStore } = await import('../../server/storage.mjs')

    const events = []
    const onEvent = (event) => events.push(event)
    agentEvents.on('agent_event', onEvent)

    try {
      await writeStore('custom-providers', { [PROVIDER_ID]: providerWithModel(3000) })

      // Streaming sessions are skipped; runPrompt re-resolves on the next message.
      session.agent.state.isStreaming = true
      await refreshAllSessionModels()
      expect(session.model.maxTokens).toBe(1000)
      expect(events.filter((event) => event.type === 'state' && event.sessionId === sessionId)).toHaveLength(0)

      // OpenCode harness sessions are skipped: OpenCode owns its model selection.
      session.agent.state.isStreaming = false
      session.harness = 'opencode'
      await refreshAllSessionModels()
      expect(session.model.maxTokens).toBe(1000)
      expect(events.filter((event) => event.type === 'state' && event.sessionId === sessionId)).toHaveLength(0)
    } finally {
      agentEvents.off('agent_event', onEvent)
      await destroyAgent(sessionId)
    }
  })

  it('keeps the storage DELETE response successful when the model disappears', async () => {
    const sessionId = 'model-refresh-delete'
    const session = await setupSession(sessionId, 1000)
    const { destroyAgent, agentEvents } = await import('../../server/agent-manager.mjs')
    const route = await import('../../server/routes/storage.mjs')

    const events = []
    const onEvent = (event) => events.push(event)
    agentEvents.on('agent_event', onEvent)

    try {
      const res = mockRes()
      await route.handleStorageApi(
        mockReq('DELETE'),
        res,
        new URL(`http://localhost/api/storage/custom-providers/key/${encodeURIComponent(PROVIDER_ID)}`),
      )
      expect(res._status).toBe(200)
      // The model could not be re-resolved; the session keeps its last binding.
      expect(session.model.maxTokens).toBe(1000)
      expect(events.filter((event) => event.type === 'state' && event.sessionId === sessionId)).toHaveLength(0)
    } finally {
      agentEvents.off('agent_event', onEvent)
      await destroyAgent(sessionId)
    }
  })
})
