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
    this.continue = vi.fn(async () => {})
    this.prompt = vi.fn(async () => {})
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
  subscribeMcpToolsetChanged: vi.fn(() => () => {}),
}))
vi.mock('../../server/plugins/registry.mjs', () => ({
  callPluginTool: vi.fn(),
  createPluginToolDefinitions: vi.fn(async () => []),
  getEnabledPluginCommandSources: vi.fn(async () => []),
  getEnabledPluginSkillSources: vi.fn(async () => []),
  isPluginToolName: vi.fn(() => false),
}))

// Fault injection for saveSessionStatePair: while `remaining` > 0 every save
// throws a SESSION_STATE_CONFLICT so the CAS merge-retry loop in agent-manager
// can be driven to exhaustion deterministically.
const saveConflictFault = vi.hoisted(() => ({ remaining: 0 }))
// vi.resetModules() clears the module registry but NOT factory mocks: a plain
// `{ ...actual }` spread captured on first load would keep binding the first
// test's (already closed) SQLite storage handle for every later test. The
// production session-state paths that read buckets via storage() would then
// see a closed handle, so delegate every property lookup to the CURRENT
// actual instance, refreshed by each beforeEach below.
const sessionStateActual = vi.hoisted(() => ({ module: null }))
vi.mock('../../server/session-state-service.mjs', async (importActual) => {
  const actual = await importActual()
  sessionStateActual.module = actual
  const faultingSavePair = (...args) => {
    if (saveConflictFault.remaining > 0) {
      saveConflictFault.remaining -= 1
      const error = new Error('injected CAS conflict')
      error.errorCode = 'SESSION_STATE_CONFLICT'
      throw error
    }
    return sessionStateActual.module.saveSessionStatePair(...args)
  }
  // Own enumerable getters (one per actual export) keep named imports valid
  // while delegating every access to the CURRENT actual instance.
  const delegated = {}
  for (const key of Object.keys(actual)) {
    Object.defineProperty(delegated, key, {
      enumerable: true,
      get() {
        if (key === 'saveSessionStatePair') return faultingSavePair
        const value = sessionStateActual.module?.[key]
        return typeof value === 'function' ? value.bind(sessionStateActual.module) : value
      },
    })
  }
  return delegated
})

const PINNED_AT = '2026-01-01T00:00:00.000Z'

function firstMessage() {
  return [{ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }]
}

describe('agent persist in authoritative session state', () => {
  let tmpDir
  let previousDataDir
  let database
  let repository
  let agentManager
  let storageModule

  beforeEach(async () => {
    saveConflictFault.remaining = 0
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-persist-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    vi.resetModules()
    // Rebind the mocked session-state-service to this test's fresh module
    // instance (see the comment above the vi.mock factory).
    sessionStateActual.module = await vi.importActual('../../server/session-state-service.mjs')

    const { initializeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    const { createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs')
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createSessionStateRepository(database)
    // Storage v2: SQLite is authoritative by construction; only the
    // repository override remains testable (json/mirror/phase are ignored).
    configureSessionStateService({ repository })

    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    agentManager = await import('../../server/agent-manager.mjs')
    storageModule = await import('../../server/storage.mjs')
  })

  afterEach(async () => {
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: null })
    const { closeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    await closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('persists body + metadata as one record, restoring persisted revision/stateVersion', async () => {
    const sessionId = 'agent-one'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Agent title',
      stateVersion: 3,
    })

    try {
      await agentManager.persistSessionState(session)
      const record = repository.findBySessionId(sessionId)
      expect(record).not.toBeNull()
      // Storage v2: bodies never store the messages array inline (rows are
      // authoritative in session_messages); the reassembled read view keeps
      // the full body shape callers expect.
      expect(record.state).toMatchObject({ id: sessionId, title: 'Agent title' })
      expect(record.state).not.toHaveProperty('messages')
      const { readSessionStateValue } = await import('../../server/session-state-service.mjs')
      expect(await readSessionStateValue(sessionId)).toMatchObject({
        id: sessionId,
        title: 'Agent title',
        messages: [{ role: 'user', content: 'hello' }],
      })
      expect(record.metadata).toMatchObject({ id: sessionId, title: 'Agent title', messageCount: 1 })
      expect(session.persistedStorageRevision).toBe(record.revision)
      expect(session.persistedStateVersion).toBe(3)
      expect(session.persistedStateJson).toEqual(expect.any(String))

      const restored = await agentManager.restoreAgent(sessionId)
      expect(restored).not.toBeNull()
      expect(restored.persistedStorageRevision).toBe(record.revision)
      expect(restored.persistedStateVersion).toBe(3)
      expect(restored.persistedStateJson).toEqual(expect.any(String))
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  async function evictSession(sessionId, { messages = firstMessage(), goal = null, compactedUpToIndex = 0 } = {}) {
    const model = { provider: 'cold-provider', id: 'cold-model', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    await storageModule.writeStore('custom-providers', {
      'cold-provider': { id: 'cold-provider', models: [model] },
    })
    const session = await agentManager.createAgent(sessionId, { scope: 'global', model, messages, systemPrompt: '' })
    if (goal) session.goal = goal
    if (compactedUpToIndex) session.contextCompaction = {
      summaryMessage: { role: 'user', content: 'Earlier history summary' },
      compactedUpToIndex,
      sourceMessageCount: messages.length,
    }
    await agentManager.persistSessionState(session)
    await agentManager.destroyAgent(sessionId)
    expect(agentManager.getSessionState(sessionId)).toBeNull()
    expect(session.agent.continue).not.toHaveBeenCalled()
    expect(session.agent.prompt).not.toHaveBeenCalled()
    return session
  }

  it.each([false, true])('continues a cold session without losing history outside retry semantics (append=%s)', async (append) => {
    const sessionId = 'cold-continue'
    const messages = [
      ...firstMessage(),
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'edit_file', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'edit_file', content: [{ type: 'text', text: 'done' }] },
      { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'upstream failed' },
    ]
    await evictSession(sessionId, { messages })
    try {
      expect(await agentManager.continueSession(sessionId, null, append ? { role: 'user', content: '继续' } : null))
        .toEqual({ sessionId, status: 'running' })
      const restored = await agentManager.restoreAgent(sessionId)
      const next = restored.agent.state.messages
      expect(next).toHaveLength(append ? 5 : 1)
      if (append) {
        expect(next.slice(0, 4)).toEqual(messages)
        expect(next[4]).toMatchObject({ role: 'user', content: '继续' })
      } else expect(next[0]).toEqual(messages[0])
      expect(restored.agent.continue).toHaveBeenCalledTimes(1)
      expect(restored.agent.prompt).not.toHaveBeenCalled()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it.each([[7, 6, true], [3, 2, false]])('rolls back cold compacted history at %s', async (index, count, keepCompaction) => {
    const sessionId = 'cold-rollback'
    const messages = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message-${i}` }))
    await evictSession(sessionId, { messages, compactedUpToIndex: 4 })
    try {
      const result = await agentManager.rollbackSessionMessages(sessionId, index)
      expect(result.rollbackIndex).toBe(count)
      expect(result.session.messages).toEqual(messages.slice(0, count))
      const restored = await agentManager.restoreAgent(sessionId)
      if (keepCompaction) expect(restored.contextCompaction.compactedUpToIndex).toBe(4)
      else expect(restored.contextCompaction).toBeNull()
      expect(restored.agent.continue).not.toHaveBeenCalled()
      expect(restored.agent.prompt).not.toHaveBeenCalled()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it.each([
    ['updateSessionAccessMode', 'full-access', { accessMode: 'full-access', yoloMode: true }],
    ['updateSessionYoloMode', true, { accessMode: 'full-access', yoloMode: true }],
    ['updateSessionModel', { provider: 'cold-provider', id: 'next-model' }, { model: { provider: 'cold-provider', id: 'next-model' } }],
    ['updateSessionThinkingLevel', 'high', { thinkingLevel: 'high' }],
  ])('restores a cold session for %s without starting generation', async (operation, value, expected) => {
    const sessionId = 'cold-settings'
    await evictSession(sessionId)
    try {
      expect(await agentManager[operation](sessionId, value)).toMatchObject({ sessionId, ...expected })
      const restored = await agentManager.restoreAgent(sessionId)
      expect(agentManager.getSessionState(sessionId)).toMatchObject(expected)
      expect(restored.agent.state.messages).toEqual(firstMessage())
      expect(restored.agent.continue).not.toHaveBeenCalled()
      expect(restored.agent.prompt).not.toHaveBeenCalled()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('keeps the warm setter path in memory instead of synchronizing storage', async () => {
    const sessionId = 'warm-settings'
    await evictSession(sessionId)
    const session = await agentManager.restoreAgent(sessionId)
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: { ...repository, findBySessionId() { throw new Error('warm setter must not read storage') } } })
    try {
      await expect(agentManager.updateSessionThinkingLevel(sessionId, 'high')).resolves.toMatchObject({ thinkingLevel: 'high' })
      await expect(agentManager.updateSessionModel(sessionId, session.model)).resolves.toMatchObject({ model: session.model })
      expect(session.agent.state.messages).toEqual(firstMessage())
    } finally {
      configureSessionStateService({ repository })
      await agentManager.destroyAgent(sessionId)
    }
  })

  it.each(['continueSession', 'rollbackSessionMessages'])('restores a cold Goal before enforcing the %s guard', async (operation) => {
    const sessionId = 'cold-goal'
    const { createGoalState } = await import('../../server/agent-goal-state.mjs')
    await evictSession(sessionId, { goal: createGoalState({ sessionId, objective: 'Keep the goal isolated' }) })
    try {
      await expect(agentManager[operation](sessionId, 0)).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_ACTIVE' })
      const restored = await agentManager.restoreAgent(sessionId)
      expect(restored.goal.status).toBe('paused')
      expect(restored.agent.state.messages).toEqual(firstMessage())
      expect(restored.agent.continue).not.toHaveBeenCalled()
      expect(restored.agent.prompt).not.toHaveBeenCalled()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it.each(['continueSession', 'rollbackSessionMessages', 'updateSessionAccessMode', 'updateSessionYoloMode', 'updateSessionModel', 'updateSessionThinkingLevel'])('keeps genuine missing sessions as 404 for %s', async (operation) => {
    await expect(agentManager[operation]('missing-session')).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([500, 503])('does not turn storage restore failure %s into not-found and retries after single-flight failure', async (statusCode) => {
    const sessionId = 'cold-storage-failure'
    await evictSession(sessionId)
    const original = Object.assign(new Error('internal storage detail'), { statusCode, errorCode: 'STORAGE_UNAVAILABLE' })
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: { ...repository, findBySessionId() { throw original } } })
    const a = agentManager.restoreAgent(sessionId)
    const b = agentManager.restoreAgent(sessionId)
    expect(a).toBe(b)
    const results = await Promise.allSettled([a, b])
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (statusCode === 503) expect(result.reason).toBe(original)
      else expect(result.reason).toMatchObject({ statusCode: 500, errorCode: 'SESSION_RESTORE_FAILED', message: 'Failed to restore session. Please try again.', cause: original })
    }
    expect(agentManager.getSessionState(sessionId)).toBeNull()
    configureSessionStateService({ repository })
    try {
      expect(await agentManager.restoreAgent(sessionId)).not.toBeNull()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('allows the current hidden model on the main model route after cold restore', async () => {
    const sessionId = 'cold-hidden-model'
    const previous = await evictSession(sessionId)
    const model = { ...previous.model, quickforgeHidden: true }
    await storageModule.writeStore('custom-providers', {
      'cold-provider': { id: 'cold-provider', models: [model] },
    })
    const { Readable } = await import('node:stream')
    const { handleAgentApi } = await import('../../server/routes/agent.mjs')
    const req = Readable.from([Buffer.from(JSON.stringify({ model }))])
    req.method = 'POST'
    req.headers = {}
    const res = { writeHead: vi.fn(), end: vi.fn() }
    try {
      await handleAgentApi(req, res, new URL(`http://localhost/api/agents/${sessionId}/model`))
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ sessionId, model: { id: model.id, quickforgeHidden: true } })
      expect(agentManager.getSessionState(sessionId).messages).toEqual(firstMessage())
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('surfaces safe construction failures and permits the next cold operation to retry', async () => {
    const sessionId = 'cold-construction-failure'
    await evictSession(sessionId)
    const registry = await import('../../server/mcp/registry.mjs')
    registry.createMcpToolDefinitions.mockRejectedValueOnce(new Error('internal tool construction detail'))
    await expect(agentManager.updateSessionThinkingLevel(sessionId, 'high')).rejects.toMatchObject({
      statusCode: 500, errorCode: 'SESSION_RESTORE_FAILED', message: 'Failed to restore session. Please try again.',
    })
    expect(agentManager.getSessionState(sessionId)).toBeNull()
    try {
      expect(await agentManager.updateSessionThinkingLevel(sessionId, 'high')).toEqual({ sessionId, thinkingLevel: 'high' })
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('dedupes concurrent restore calls into one shared agent instance', async () => {
    const sessionId = 'agent-concurrent-restore'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Concurrent restore',
    })
    await agentManager.persistSessionState(session)
    await agentManager.destroyAgent(sessionId)

    // Concurrent route handlers (POST /restore, GET /state, GET /messages,
    // SSE) restore the same session in parallel; they must share one
    // in-flight restore instead of building racing agent instances.
    const [a, b, c] = await Promise.all([
      agentManager.restoreAgent(sessionId),
      agentManager.restoreAgent(sessionId),
      agentManager.restoreAgent(sessionId),
    ])
    try {
      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a.sessionId).toBe(sessionId)
      expect(await agentManager.restoreAgent(sessionId)).toBe(a)

      // A failed restore must not leave a cached promise behind.
      const missing = await Promise.all([
        agentManager.restoreAgent('agent-not-persisted'),
        agentManager.restoreAgent('agent-not-persisted'),
      ])
      expect(missing).toEqual([null, null])
      expect(await agentManager.restoreAgent('agent-not-persisted')).toBeNull()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('restores sessions with a cached MCP tool snapshot instead of waiting for MCP connects', async () => {
    const sessionId = 'agent-mcp-cached-restore'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'MCP cached restore',
    })
    await agentManager.persistSessionState(session)
    await agentManager.destroyAgent(sessionId)

    const registryMock = await import('../../server/mcp/registry.mjs')
    registryMock.createMcpToolDefinitions.mockClear()

    // The restore critical path (POST /restore, GET /state fallback, SSE)
    // must not block on MCP (re)connects: it takes the current snapshot
    // (waitForConnections:false) and converges via the background refresh.
    const restored = await agentManager.restoreAgent(sessionId)
    try {
      expect(restored).not.toBeNull()
      expect(restored.sessionId).toBe(sessionId)
      expect(registryMock.createMcpToolDefinitions).toHaveBeenCalledTimes(1)
      expect(registryMock.createMcpToolDefinitions).toHaveBeenCalledWith({ waitForConnections: false })
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('merges concurrent metadata-only (pin) changes with bounded CAS retries and keeps pinnedAt', async () => {
    const sessionId = 'agent-pin'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Pin session',
    })

    try {
      await agentManager.persistSessionState(session)
      const first = repository.findBySessionId(sessionId)
      // Sidebar pin: a concurrent metadata-only update bumps the revision.
      const { saveSessionMetadata } = await import('../../server/session-state-service.mjs')
      await saveSessionMetadata(sessionId, { pinnedAt: PINNED_AT })
      expect(repository.findBySessionId(sessionId).revision).toBe(first.revision + 1)

      // The run appends messages and persists again: revision CAS must merge
      // the storage-owned pin and retry instead of dropping the whole persist.
      session.agent.state.messages.push({ role: 'assistant', content: 'done', timestamp: '2026-01-02T00:00:00.000Z' })
      await agentManager.persistSessionState(session)
      const after = repository.findBySessionId(sessionId)
      expect(after.revision).toBe(first.revision + 2)
      expect(after.metadata).toMatchObject({ pinnedAt: PINNED_AT })
      expect(after.state).toMatchObject({ pinnedAt: PINNED_AT })
      const { readSessionStateValue } = await import('../../server/session-state-service.mjs')
      expect((await readSessionStateValue(sessionId)).messages).toMatchObject([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'done' },
      ])
      expect(session.persistConflictCount).toBe(0)
      expect(session.persistedStorageRevision).toBe(after.revision)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('records an agent-owned conflict and never overwrites the other writer', async () => {
    const sessionId = 'agent-conflict'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Conflict session',
    })

    try {
      await agentManager.persistSessionState(session)
      const first = repository.findBySessionId(sessionId)
      // Another writer changed agent-owned fields (messages) concurrently.
      repository.save({
        ...first,
        state: { ...first.state, messages: [{ role: 'user', content: 'external write' }] },
        metadata: { ...first.metadata, messageCount: 1 },
      }, { expectedRevision: first.revision })
      const external = repository.findBySessionId(sessionId)
      expect(external.revision).toBe(first.revision + 1)

      session.agent.state.messages.push({ role: 'assistant', content: 'agent thinks it wins', timestamp: '2026-01-03T00:00:00.000Z' })
      await agentManager.persistSessionState(session)

      const after = repository.findBySessionId(sessionId)
      expect(after.revision).toBe(first.revision + 1)
      const { readSessionStateValue } = await import('../../server/session-state-service.mjs')
      expect((await readSessionStateValue(sessionId)).messages).toEqual([{ role: 'user', content: 'external write' }])
      expect(session.persistConflictCount).toBe(1)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('deletes an empty session with one authoritative delete', async () => {
    const sessionId = 'agent-empty'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: [],
    })

    try {
      await agentManager.persistSessionState(session)
      expect(repository.findBySessionId(sessionId)).toBeNull()
      expect(session.persistedStorageRevision).toBeNull()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('preserves unknown storage state fields and metadata-owned archive across persists', async () => {
    const sessionId = 'agent-opaque'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Opaque session',
    })

    try {
      await agentManager.persistSessionState(session)
      const { saveSessionMetadata } = await import('../../server/session-state-service.mjs')
      await saveSessionMetadata(sessionId, { archivedAt: '2026-02-01T00:00:00.000Z' })
      // Unknown state fields adopted from storage (e.g. written by a plugin or
      // carried over from a previous cutover) must survive the agent's rebuild.
      const withArchive = repository.findBySessionId(sessionId)
      repository.save({
        ...withArchive,
        state: { ...withArchive.state, storageUnknown: { keep: true } },
      }, { expectedRevision: withArchive.revision })
      // The session acknowledges the adopted baseline before persisting again.
      session.persistedStorageRevision = repository.findBySessionId(sessionId).revision

      session.agent.state.messages.push({ role: 'assistant', content: 'second', timestamp: '2026-01-04T00:00:00.000Z' })
      await agentManager.persistSessionState(session)

      const record = repository.findBySessionId(sessionId)
      expect(record.state).toMatchObject({
        storageUnknown: { keep: true },
        archivedAt: '2026-02-01T00:00:00.000Z',
      })
      const { readSessionStateValue } = await import('../../server/session-state-service.mjs')
      expect(await readSessionStateValue(sessionId)).toMatchObject({
        storageUnknown: { keep: true },
        archivedAt: '2026-02-01T00:00:00.000Z',
        messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'second' }],
      })
      expect(record.metadata).toMatchObject({ archivedAt: '2026-02-01T00:00:00.000Z' })
      expect(session.persistConflictCount).toBe(0)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('splits a large session on persist and maintains the message counters', async () => {
    const sessionId = 'agent-split'
    const bigMessages = []
    for (let index = 0; index < 210; index += 1) {
      bigMessages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z` })
    }
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: bigMessages,
      title: 'Split session',
    })

    try {
      await agentManager.persistSessionState(session)
      const record = repository.findBySessionId(sessionId)
      expect(record.state.messageStorage).toBe('split')
      expect(record.state).not.toHaveProperty('messages')
      expect(repository.messageCount({ scope: 'global', sessionId })).toBe(210)
      expect(session.persistedMessageStorage).toBe('split')
      expect(session.persistedMessageCount).toBe(210)
      expect(session.persistedTailDigest).toMatch(/^[0-9a-f]{64}$/)

      // Incremental append: the agent adds 5 tail messages; the save must route
      // through the append plan and keep the stored rows in sync.
      for (let index = 210; index < 215; index += 1) {
        session.agent.state.messages.push({ role: 'user', content: `tail${index}`, timestamp: `2026-01-02T00:00:00.${String(index).padStart(3, '0')}Z` })
      }
      await agentManager.persistSessionState(session)
      expect(session.persistedMessageCount).toBe(215)
      expect(repository.messageCount({ scope: 'global', sessionId })).toBe(215)
      const assembled = repository.exportSnapshot().records.find((recordEntry) => recordEntry.sessionId === sessionId)
      expect(assembled.messages.map((message) => message.content).slice(-5)).toEqual(['tail210', 'tail211', 'tail212', 'tail213', 'tail214'])
      expect(session.persistConflictCount).toBe(0)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('restores a split session with split-aware persisted counters', async () => {
    const sessionId = 'agent-restore-split'
    const bigMessages = []
    for (let index = 0; index < 205; index += 1) {
      bigMessages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z` })
    }
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: bigMessages,
      title: 'Restore split',
    })

    try {
      await agentManager.persistSessionState(session)
      await agentManager.destroyAgent(sessionId)

      const restored = await agentManager.restoreAgent(sessionId)
      expect(restored).not.toBeNull()
      expect(restored.persistedMessageStorage).toBe('split')
      expect(restored.persistedMessageCount).toBe(205)
      expect(restored.persistedTailDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(restored.persistedStorageRevision).toBe(repository.findBySessionId(sessionId).revision)
      expect(restored.agent.state.messages).toHaveLength(205)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('surfaces persist degradation after CAS retries are exhausted and clears it on recovery', async () => {
    const sessionId = 'agent-degraded'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Degraded session',
    })

    try {
      await agentManager.persistSessionState(session)
      expect(session.persistDegraded).toBeNull()
      expect(agentManager.getSessionState(sessionId).persistDegraded).toBeUndefined()

      // Every save conflicts with an unchanged body, so the merge-retry loop
      // adopts the fresh baseline and retries until the attempt budget runs out.
      saveConflictFault.remaining = 10
      session.agent.state.messages.push({ role: 'assistant', content: 'at risk', timestamp: '2026-01-05T00:00:00.000Z' })
      await agentManager.persistSessionState(session)

      expect(session.persistConflictCount).toBe(1)
      expect(session.persistDegraded).toMatchObject({ attempts: 3 })
      expect(agentManager.getSessionState(sessionId).persistDegraded).toBe(true)
      expect(agentManager.getSessionStatus(sessionId).persistDegraded).toBe(true)

      // A later successful persist clears the degradation marker everywhere.
      saveConflictFault.remaining = 0
      session.agent.state.messages.push({ role: 'user', content: 'recovered', timestamp: '2026-01-06T00:00:00.000Z' })
      await agentManager.persistSessionState(session)

      expect(session.persistDegraded).toBeNull()
      expect(agentManager.getSessionState(sessionId).persistDegraded).toBeUndefined()
      expect(agentManager.getSessionStatus(sessionId).persistDegraded).toBeUndefined()
      const { readSessionStateValue } = await import('../../server/session-state-service.mjs')
      expect((await readSessionStateValue(sessionId)).messages.at(-1).content).toBe('recovered')
    } finally {
      saveConflictFault.remaining = 0
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('marks persist degradation when the other writer changed agent-owned fields', async () => {
    const sessionId = 'agent-degraded-conflict'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: firstMessage(),
      title: 'Degraded conflict',
    })

    try {
      await agentManager.persistSessionState(session)
      const first = repository.findBySessionId(sessionId)
      repository.save({
        ...first,
        state: { ...first.state, messages: [{ role: 'user', content: 'external write' }] },
        metadata: { ...first.metadata, messageCount: 1 },
      }, { expectedRevision: first.revision })

      session.agent.state.messages.push({ role: 'assistant', content: 'agent loses', timestamp: '2026-01-07T00:00:00.000Z' })
      await agentManager.persistSessionState(session)

      expect(session.persistConflictCount).toBe(1)
      expect(session.persistDegraded).toMatchObject({ attempts: 1 })
      expect(agentManager.getSessionState(sessionId).persistDegraded).toBe(true)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('detects a concurrent split-message append as an agent-owned conflict', async () => {
    const sessionId = 'agent-split-conflict'
    const bigMessages = []
    for (let index = 0; index < 210; index += 1) {
      bigMessages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z` })
    }
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: bigMessages,
      title: 'Split conflict',
    })

    try {
      await agentManager.persistSessionState(session)
      const first = repository.findBySessionId(sessionId)
      // Another writer (e.g. share-store rollback or a second agent process)
      // appends a message: the split body is UNCHANGED, so only the row-level
      // message comparison can detect the conflict.
      repository.appendMessages(first, [{ role: 'user', content: 'external append', timestamp: '2026-01-03T00:00:00.000Z' }], { expectedRevision: first.revision })

      session.agent.state.messages.push({ role: 'assistant', content: 'agent message', timestamp: '2026-01-04T00:00:00.000Z' })
      await agentManager.persistSessionState(session)

      const after = repository.findBySessionId(sessionId)
      // The other writer's append must survive; the agent must not clobber it.
      expect(repository.messageCount({ scope: 'global', sessionId })).toBe(211)
      const stored = repository.readMessagesPage({ scope: 'global', sessionId, limit: 5000 })
      expect(stored.messages.at(-1).message.content).toBe('external append')
      expect(session.persistConflictCount).toBe(1)
      expect(session.persistedStorageRevision).toBe(first.revision)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('resetStaleTaskStatuses flips stale running metadata to idle across global and project buckets', async () => {
    const staleBody = (id, overrides = {}) => ({
      id,
      scope: 'global',
      stateVersion: 1,
      title: `Stale ${id}`,
      messages: [{ role: 'user', content: 'hi' }],
      taskStatus: 'running',
      ...overrides,
    })
    await storageModule.writeSessionValue('stale-global', staleBody('stale-global'))
    await storageModule.writeSessionValue('stale-project', staleBody('stale-project', { scope: 'project', projectId: 'p1' }))
    await storageModule.writeSessionValue('fresh', staleBody('fresh', { taskStatus: 'idle' }))

    await agentManager.resetStaleTaskStatuses()

    expect(repository.findBySessionId('stale-global').metadata).toMatchObject({ taskStatus: 'idle' })
    const projectRecord = repository.findBySessionId('stale-project')
    expect(projectRecord.scope).toBe('project')
    expect(projectRecord.metadata).toMatchObject({ taskStatus: 'idle', projectId: 'p1' })
    expect(typeof projectRecord.metadata.taskFinishedAt).toBe('string')
    expect(repository.findBySessionId('fresh').metadata).toMatchObject({ taskStatus: 'idle' })
  })
})
