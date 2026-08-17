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
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-persist-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    vi.resetModules()

    const { initializeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    const { createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs')
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createSessionStateRepository(database)
    configureSessionStateService({
      repository,
      mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
      phase: 'authoritative',
    })

    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    agentManager = await import('../../server/agent-manager.mjs')
    storageModule = await import('../../server/storage.mjs')
  })

  afterEach(async () => {
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
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
      expect(record.state).toMatchObject({ id: sessionId, title: 'Agent title', messages: [{ role: 'user', content: 'hello' }] })
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
      saveSessionMetadata(sessionId, { pinnedAt: PINNED_AT })
      expect(repository.findBySessionId(sessionId).revision).toBe(first.revision + 1)

      // The run appends messages and persists again: revision CAS must merge
      // the storage-owned pin and retry instead of dropping the whole persist.
      session.agent.state.messages.push({ role: 'assistant', content: 'done', timestamp: '2026-01-02T00:00:00.000Z' })
      await agentManager.persistSessionState(session)
      const after = repository.findBySessionId(sessionId)
      expect(after.revision).toBe(first.revision + 2)
      expect(after.metadata).toMatchObject({ pinnedAt: PINNED_AT })
      expect(after.state).toMatchObject({ pinnedAt: PINNED_AT, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'done' }] })
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
      expect(after.state.messages).toEqual([{ role: 'user', content: 'external write' }])
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
      saveSessionMetadata(sessionId, { archivedAt: '2026-02-01T00:00:00.000Z' })
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
})
