import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The startup order exercised by server/index.mjs:
//   initializeSqliteStorage → initializeShareCutover →
//   initializeShareService → drainShareJsonMirror
// share-service/share-cutover/storage pin storageDir at module evaluation, so
// every module must be imported from one fresh graph after QUICKFORGE_DATA_DIR
// is set (vi.resetModules + dynamic imports) and the same graph must own the
// SQLite storage handle.

let sequence = 0
function shareId() {
  sequence += 1
  return `qfs_${String(sequence).padStart(18, '0')}`
}

function record(overrides = {}) {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id || shareId(),
    sessionId: overrides.sessionId || 'session-one',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Shared session',
    scope: overrides.scope || 'global',
    projectId: overrides.scope === 'project' ? overrides.projectId || 'project-a' : undefined,
    authVersion: 1,
    allowCloudUsage: false,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: overrides.tokens === undefined ? [] : overrides.tokens,
    ...overrides,
  }
}

function sharesStore(...records) {
  return Object.fromEntries(records.map((entry) => [entry.id, entry]))
}

describe('share lifecycle (startup order, fail closed, shutdown)', () => {
  let directory
  let backupDirectory
  let previousDataDir
  let storage
  let repository
  let service
  let cutover
  let databaseModule
  let repositoryModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-lifecycle-'))
    process.env.QUICKFORGE_DATA_DIR = directory
    backupDirectory = path.join(directory, 'backups')
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    repositoryModule = await import('../../server/sqlite/share-repository.mjs')
    storage = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = repositoryModule.createShareRepository(storage)
    service = await import('../../server/share-service.mjs')
    cutover = await import('../../server/share-cutover.mjs')
    service.configureShareService({ repository, mirror: null, phase: 'json_authoritative' })
  })

  afterEach(async () => {
    service.configureShareService({ repository: null, mirror: null, phase: 'json_authoritative' })
    service.stopShareService()
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(directory, { recursive: true, force: true })
  })

  it('wires the startup chain: cutover → service init → mirror drain activates the share facade', async () => {
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
    const source = sharesStore(record())
    const state = await cutover.initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => source),
      mirror,
      owner: { id: '301:test', pid: 301 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')

    const serviceState = service.initializeShareService()
    expect(serviceState.phase).toBe('authoritative')
    expect(service.isShareStorageAuthoritative()).toBe(true)

    const drained = await service.drainShareJsonMirror()
    expect(drained.pending).toBe(0)
    expect(mirror.upsert).toHaveBeenCalledTimes(1)

    // Maintenance is no longer active after startup cutover completes.
    expect(cutover.isShareMaintenanceActive(storage)).toBe(false)
  })

  it('continues authoritative startup without scanning optional-domain rows', async () => {
    const source = sharesStore(record())
    const state = await cutover.initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => source),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '302:test', pid: 302 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')

    const restarted = await cutover.initializeShareCutover({
      storage,
      repository,
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '303:test', pid: 303 },
      pidAlive: () => false,
    })
    expect(restarted.phase).toBe('authoritative')
    expect(service.readShareStorageState().phase).toBe('authoritative')
  })

  it('keeps the legacy JSON path when cutover fails back to json_authoritative', async () => {
    let reads = 0
    const unstable = await cutover.initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => {
        reads += 1
        return sharesStore(record({ id: `qfs_${String(reads).padStart(18, '0')}` }))
      }),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '304:test', pid: 304 },
      pidAlive: () => false,
    })
    expect(unstable.phase).toBe('json_authoritative')
    expect(repository.count()).toBe(0)
    expect(service.isShareStorageAuthoritative()).toBe(false)

    // The share-store legacy JSON path remains readable and writable.
    const shareStore = await import('../../server/share-store.mjs')
    const share = await shareStore.createConversationShare({ sessionId: 'json-session', permission: 'read', scope: 'global' })
    expect(repository.count()).toBe(0)
    const { readSharesJsonFile } = await import('../../server/share-json-file.mjs')
    expect((await readSharesJsonFile())[share.id]).toMatchObject({ sessionId: 'json-session', permission: 'read' })
  })

  it('keeps the mirror queue on failure and drains on a later startup', async () => {
    const failMirror = { upsert: vi.fn(async () => { throw new Error('mirror unavailable') }), delete: vi.fn() }
    const source = sharesStore(record())
    const pending = await cutover.initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => source),
      mirror: failMirror,
      owner: { id: '305:test', pid: 305 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    expect(repository.listMirrorQueue()).toHaveLength(1)

    // Restart with a working mirror: the queue drains and the phase promotes.
    const okMirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    const recovered = await cutover.initializeShareCutover({
      storage,
      repository,
      mirror: okMirror,
      owner: { id: '306:test', pid: 306 },
      pidAlive: () => false,
    })
    expect(recovered.phase).toBe('authoritative')
    expect(repository.listMirrorQueue()).toEqual([])
    expect(okMirror.upsert).toHaveBeenCalledTimes(1)
  })

  it('releases the service on shutdown so the database can close cleanly', async () => {
    repository.create(record(), { expectedRevision: 0 })
    service.configureShareService({
      repository,
      mirror: { upsert: vi.fn(async () => { throw new Error('mirror down') }), delete: vi.fn() },
      phase: 'authoritative',
    })
    const drained = await service.drainShareJsonMirror()
    expect(drained.pending).toBe(1)
    // stopShareService clears the scheduled retry timer; the queue is preserved
    // so a future drain can still recover it.
    service.stopShareService()
    expect(repository.listMirrorQueue()).toHaveLength(1)
    const afterStop = await service.drainShareJsonMirror()
    expect(afterStop.pending).toBe(1)
    await databaseModule.closeSqliteStorage()
    storage = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = repositoryModule.createShareRepository(storage)
    expect(repository.listMirrorQueue()).toHaveLength(1)
  })
})
