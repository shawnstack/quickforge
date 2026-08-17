import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { configureSessionStateService } from '../../server/session-state-service.mjs'

// share-store falls back to direct storage writes only when the session is not
// loaded in the agent manager; simulate that path without pulling the full
// agent runtime into this test.
vi.mock('../../server/agent-manager.mjs', () => ({
  rollbackSessionMessages: vi.fn(async () => {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }),
  rollbackStartIndexFromMessage: (messages, messageIndex) => {
    let rollbackIndex = Number(messageIndex)
    if (!Number.isInteger(rollbackIndex) || rollbackIndex < 0 || rollbackIndex >= messages.length) return -1
    if (messages[rollbackIndex]?.role === 'assistant') {
      for (let index = rollbackIndex - 1; index >= 0; index--) {
        if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
          rollbackIndex = index
          break
        }
      }
    }
    const message = messages[rollbackIndex]
    if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
    return rollbackIndex
  },
}))

// The repository is Object.freeze()d (no vi.spyOn and no Proxy overrides), so
// counting calls requires a spread wrapper the service is configured with.
function trackedRepository(repository, counts) {
  return {
    ...repository,
    save: (...args) => { counts.save += 1; return repository.save(...args) },
    applyBatch: (...args) => { counts.applyBatch += 1; return repository.applyBatch(...args) },
  }
}

describe('shared conversation rollback in authoritative mode', () => {
  let tmpDir
  let previousDataDir
  let database
  let repository
  let storageModule
  let shareStore
  let counts

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-rollback-'))
    process.env.QUICKFORGE_DATA_DIR = tmpDir
    await closeSqliteStorage()
    database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createSessionStateRepository(database)
    counts = { save: 0, applyBatch: 0 }
    configureSessionStateService({
      repository: trackedRepository(repository, counts),
      mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
      phase: 'authoritative',
    })
    const testId = `${Date.now()}-${Math.random()}`
    storageModule = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
    shareStore = await import('../../server/share-store.mjs')
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('rolls back body + metadata in one atomic session record update', async () => {
    const sessionId = 'shared-one'
    const messages = [
      { role: 'user', content: 'm0' },
      { role: 'assistant', content: 'reply a1' },
      { role: 'user', content: 'm2' },
      { role: 'assistant', content: 'reply a3' },
    ]
    await storageModule.writeSessionValue(sessionId, {
      id: sessionId, scope: 'global', stateVersion: 1, title: 'shared', messages,
    })

    const saveBefore = counts.save
    const result = await shareStore.rollbackSharedSessionMessages({ sessionId }, 3)

    expect(result.rollbackIndex).toBe(2)
    expect(result.session.messages).toHaveLength(2)
    // One atomic record save keeps body + metadata consistent (no half state).
    expect(counts.save - saveBefore).toBe(1)
    const record = repository.findBySessionId(sessionId)
    expect(record.state.messages).toEqual(messages.slice(0, 2))
    expect(record.metadata).toMatchObject({ messageCount: 2, preview: 'reply a1' })
  })

  it('preserves metadata-owned pin across the atomic rollback and rejects missing bodies', async () => {
    const sessionId = 'shared-pinned'
    await storageModule.writeSessionValue(sessionId, {
      id: sessionId, scope: 'global', stateVersion: 1, title: 'shared',
      messages: [{ role: 'user', content: 'm0' }, { role: 'assistant', content: 'reply a1' }, { role: 'user', content: 'm2' }],
    })
    await storageModule.atomicUpdate('sessions-metadata', (data) => {
      data[sessionId] = { ...data[sessionId], pinnedAt: '2026-01-01T00:00:00.000Z' }
      return data
    })

    const result = await shareStore.rollbackSharedSessionMessages({ sessionId }, 2)
    expect(result.rollbackIndex).toBe(2)
    const record = repository.findBySessionId(sessionId)
    expect(record.state.messages).toEqual([{ role: 'user', content: 'm0' }, { role: 'assistant', content: 'reply a1' }])
    expect(record.metadata).toMatchObject({ messageCount: 2, pinnedAt: '2026-01-01T00:00:00.000Z' })

    await expect(shareStore.rollbackSharedSessionMessages({ sessionId: 'missing' }, 0)).rejects.toThrow(/Session not found/)
  })
})
