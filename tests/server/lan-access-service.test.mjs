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

describe('LAN access storage service', () => {
  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-service-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    const { createLanAccessRepository } = await import('../../server/sqlite/lan-access-repository.mjs')
    await databaseModule.closeSqliteStorage()
    database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createLanAccessRepository(database)
    service = await import('../../server/lan-access-service.mjs')
    service.configureLanAccessService({ repository })
  })

  afterEach(async () => {
    service.configureLanAccessService({ repository: null })
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('exposes the injected repository as the single storage accessor', () => {
    expect(service.getLanAccessRepository()).toBe(repository)
  })

  it('reports a constant authoritative storage state with the live token count', () => {
    expect(service.readLanAccessStorageState()).toMatchObject({ phase: 'authoritative', stateCount: 0, digest: null })

    repository.updateSettings({
      enabled: true,
      passwordHash: 'hash',
      passwordSalt: 'salt',
      passwordVersion: 1,
      sessionTtlHours: 12,
    })
    repository.issueToken({ remoteAddress: '192.168.1.30', userAgent: 'Service Browser' })
    expect(service.readLanAccessStorageState()).toMatchObject({ phase: 'authoritative', stateCount: 1 })

    const initialized = service.initializeLanAccessService()
    expect(initialized).toMatchObject({ phase: 'authoritative', stateCount: 1 })
    expect(initialized.updatedAt).toBeTruthy()
  })

  it('degrades the token count (never the phase) when SQLite is closed', async () => {
    await databaseModule.closeSqliteStorage()
    expect(service.readLanAccessStorageState()).toMatchObject({ phase: 'authoritative', stateCount: null })
    expect(service.stopLanAccessService()).toBeUndefined()
  })
})
