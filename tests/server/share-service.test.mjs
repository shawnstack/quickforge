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
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: [],
    ...overrides,
  }
}

describe('share storage service', () => {
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
  })

  afterEach(async () => {
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('builds the repository from the process SQLite handle and honors test injection', () => {
    const fromHandle = service.getShareRepository()
    expect(fromHandle.count()).toBe(0)

    service.configureShareService({ repository })
    expect(service.getShareRepository()).toBe(repository)

    // An unrelated option object leaves the injected repository in place.
    service.configureShareService({})
    expect(service.getShareRepository()).toBe(repository)
  })

  it('reports constant authoritative diagnostics with a live share count', () => {
    service.configureShareService({ repository })
    expect(service.readShareStorageState()).toEqual({
      phase: 'authoritative',
      shareCount: 0,
      digest: null,
      backupFile: null,
      diagnostic: null,
      updatedAt: null,
    })

    repository.create(shareRecord(), { expectedRevision: 0 })
    const initialized = service.initializeShareService()
    expect(initialized).toMatchObject({ phase: 'authoritative', shareCount: 1 })
    expect(initialized.updatedAt).toBeTruthy()
    expect(service.readShareStorageState().updatedAt).toBe(initialized.updatedAt)

    // Diagnostics never fail the status endpoint: a closed store only degrades
    // the live count to null.
    service.stopShareService()
    return databaseModule.closeSqliteStorage().then(() => {
      expect(service.readShareStorageState()).toMatchObject({ phase: 'authoritative', shareCount: null })
    })
  })
})
