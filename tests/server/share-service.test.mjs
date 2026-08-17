import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// storage.mjs fixes `storageDir` at module evaluation (via the logger chain),
// so every storage-dependent module must be imported AFTER QUICKFORGE_DATA_DIR
// is set, with vi.resetModules() keeping a single fresh module graph per test.

let tmpDir
let previousDataDir
let databaseModule
let database
let repository
let service

let sequence = 0
function shareId() {
  sequence += 1
  return `qfs_${String(sequence).padStart(18, '0')}`
}

function shareRecord(overrides = {}) {
  const now = '2099-01-01T00:00:00.000Z'
  return {
    id: shareId(),
    sessionId: overrides.sessionId || 'session-one',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Shared session',
    scope: 'global',
    authVersion: 1,
    allowCloudUsage: false,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: [],
    ...overrides,
  }
}

describe('share storage service and JSON mirror', () => {
  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-service-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    const { createShareRepository } = await import('../../server/sqlite/share-repository.mjs')
    await databaseModule.closeSqliteStorage()
    database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createShareRepository(database)
    service = await import('../../server/share-service.mjs')
    service.configureShareService({ repository, mirror: service.createDefaultShareMirror(), phase: 'authoritative' })
  })

  afterEach(async () => {
    service.configureShareService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reports phase state and routes mirror drains by phase', async () => {
    service.configureShareService({ phase: 'json_authoritative' })
    expect(service.getShareStoragePhase()).toBe('json_authoritative')
    expect(service.isShareStorageAuthoritative()).toBe(false)
    expect(await service.drainShareJsonMirror()).toEqual({ pending: 0, drained: 0, failed: 0 })

    const state = service.setShareStoragePhase('authoritative', { shareCount: 0 })
    expect(state.phase).toBe('authoritative')
    expect(service.isShareStorageAuthoritative()).toBe(true)
  })

  it('materializes repository writes into the conversation-shares.json mirror file', async () => {
    const created = repository.create(shareRecord(), { expectedRevision: 0 })
    const { readSharesJsonFile } = await import('../../server/share-json-file.mjs')
    expect(await readSharesJsonFile()).toEqual({})

    const drained = await service.drainShareJsonMirror()
    expect(drained).toMatchObject({ pending: 0, drained: 1, failed: 0 })
    const file = await readSharesJsonFile()
    expect(file[created.id]).toMatchObject({ id: created.id, sessionId: 'session-one', permission: 'read' })
    expect(file[created.id]).not.toHaveProperty('revision')

    // Delete mirrors as a removal from the whole-file store.
    repository.delete(created.id, { expectedRevision: created.revision })
    const second = await service.drainShareJsonMirror()
    expect(second).toMatchObject({ drained: 1, failed: 0 })
    expect(await readSharesJsonFile()).toEqual({})
  })

  it('keeps failed mirror entries with attempts and completes them on retry', async () => {
    let fail = true
    const flaky = {
      upsert: vi.fn(async () => { if (fail) throw new Error('disk full') }),
      delete: vi.fn(),
    }
    service.configureShareService({ mirror: flaky })
    const created = repository.create(shareRecord(), { expectedRevision: 0 })

    const first = await service.drainShareJsonMirror()
    expect(first).toMatchObject({ pending: 1, drained: 0, failed: 1 })
    expect(service.listShareMirrorQueue()).toMatchObject([{ shareId: created.id, attempts: 1, lastError: 'disk full' }])

    fail = false
    const second = await service.drainShareJsonMirror()
    expect(second).toMatchObject({ pending: 0, drained: 1, failed: 0 })
    expect(service.listShareMirrorQueue()).toEqual([])
  })
})
