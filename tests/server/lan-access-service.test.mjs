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

describe('LAN access storage service and JSON mirror', () => {
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
    service.configureLanAccessService({ repository, mirror: service.createDefaultLanAccessMirror(), phase: 'authoritative' })
  })

  afterEach(async () => {
    service.configureLanAccessService({ repository: null, mirror: null, phase: 'json_authoritative' })
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reports phase state and routes mirror drains by phase', async () => {
    service.configureLanAccessService({ phase: 'json_authoritative' })
    expect(service.getLanAccessStoragePhase()).toBe('json_authoritative')
    expect(service.isLanAccessStorageAuthoritative()).toBe(false)
    expect(await service.drainLanAccessJsonMirror()).toEqual({ pending: 0, drained: 0, failed: 0 })

    const state = service.setLanAccessStoragePhase('authoritative', { lanTokenCount: 0 })
    expect(state.phase).toBe('authoritative')
    expect(service.isLanAccessStorageAuthoritative()).toBe(true)
  })

  it('materializes repository writes into the lan-access.json mirror file', async () => {
    const created = repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    const issued = repository.issueToken({ remoteAddress: '192.168.1.30', userAgent: 'Mirror Browser' }, { expectedRevision: created.revision })

    const { readLanAccessJsonFile, lanAccessJsonPath } = await import('../../server/lan-access-json-file.mjs')
    const fileBefore = await readLanAccessJsonFile()
    expect(fileBefore).toMatchObject({ enabled: false })

    const drained = await service.drainLanAccessJsonMirror()
    expect(drained).toMatchObject({ pending: 0, drained: 1, failed: 0 })
    const file = await readLanAccessJsonFile()
    expect(file).toMatchObject({ enabled: true, authVersion: 2 })
    expect(file.tokens).toHaveLength(1)
    expect(file.tokens[0]).toMatchObject({ remoteAddress: '192.168.1.30', userAgent: 'Mirror Browser' })
    expect(file.tokens[0]).not.toHaveProperty('revision')
    expect(file).not.toHaveProperty('revision')
    expect(lanAccessJsonPath()).toContain('lan-access.json')
  })

  it('keeps failed mirror entries with attempts and completes them on retry', async () => {
    let fail = true
    const flaky = {
      upsert: vi.fn(async () => { if (fail) throw new Error('disk full') }),
      delete: vi.fn(),
    }
    service.configureLanAccessService({ mirror: flaky })
    const created = repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )

    const first = await service.drainLanAccessJsonMirror()
    expect(first).toMatchObject({ pending: 1, drained: 0, failed: 1 })
    expect(service.listLanAccessMirrorQueue()).toMatchObject([{ operation: 'upsert', attempts: 1, lastError: 'disk full' }])

    fail = false
    const second = await service.drainLanAccessJsonMirror()
    expect(second).toMatchObject({ pending: 0, drained: 1, failed: 0 })
    expect(service.listLanAccessMirrorQueue()).toEqual([])
  })

  it('falls back to the default disabled config when the mirror file is missing or corrupt', async () => {
    const { lanAccessJsonPath, readLanAccessJsonFile, ensureLanAccessJsonFile } = await import('../../server/lan-access-json-file.mjs')
    // Missing file: ensure creates the default config (ENOENT fallback).
    const { readFile } = await import('node:fs/promises')
    await ensureLanAccessJsonFile()
    const created = JSON.parse(await readFile(lanAccessJsonPath(), 'utf8'))
    expect(created).toMatchObject({ enabled: false, authVersion: 1, sessionTtlHours: 12, tokens: [] })
    expect(await readLanAccessJsonFile()).toMatchObject({ enabled: false })

    // Corrupt JSON is surfaced by the reader (mirror drain keeps retrying) and
    // the cutover source reader rewrites it to the stable default config.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lanAccessJsonPath(), '{ not valid json', 'utf8')
    await expect(readLanAccessJsonFile()).rejects.toThrow()
    const cutover = await import('../../server/lan-access-cutover.mjs')
    const source = await cutover.readLanAccessJsonSource()
    expect(source).toMatchObject({ enabled: false })
    const repaired = JSON.parse(await readFile(lanAccessJsonPath(), 'utf8'))
    expect(repaired).toMatchObject({ enabled: false })
    expect(cutover.buildLanAccessJsonSnapshot(source).tokenCount).toBe(0)
  })
})
