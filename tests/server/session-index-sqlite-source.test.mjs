import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// storage.mjs resolves dataDir at module evaluation (and is pulled into the
// module graph transitively via utils/logger.mjs), so the data dir env must be
// set before a resetModules + dynamic import cycle. All server modules under
// test are imported dynamically to share one fresh registry. Vitest isolates
// test files in separate workers, so mutating process.env cannot leak.
let dataRoot
let previousDataDir
let databaseModule
let stateService
let storageModule
let createSessionIndexRepository
let createSessionStateRepository
let createSessionIndexService

function globalMetadataFile() {
  return path.join(dataRoot, 'storage', 'conversations', 'global', 'sessions-metadata.json')
}

function canonicalMetadata(id, overrides = {}) {
  return {
    id,
    scope: 'global',
    stateVersion: 1,
    title: `Title ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-02T00:00:00.000Z',
    messageCount: 1,
    ...overrides,
  }
}

async function writePhysicalGlobalMetadata(values) {
  await mkdir(path.dirname(globalMetadataFile()), { recursive: true })
  await writeFile(globalMetadataFile(), `${JSON.stringify(values, null, 2)}\n`, 'utf8')
}

const PAGE_OPTIONS = { scopeMode: 'all', archive: 'exclude', sort: 'lastModified', direction: 'desc', limit: 20, offset: 0 }

describe('session index phase-aware bucket source', () => {
  let directory
  let database
  let stateRepository
  let indexRepository
  let log

  beforeAll(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qf-session-index-data-'))
    process.env.QUICKFORGE_DATA_DIR = dataRoot
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    stateService = await import('../../server/session-state-service.mjs')
    storageModule = await import('../../server/storage.mjs')
    ;({ createSessionIndexRepository } = await import('../../server/sqlite/session-index-repository.mjs'))
    ;({ createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs'))
    ;({ createSessionIndexService } = await import('../../server/session-index-service.mjs'))
  })

  afterAll(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(dataRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await databaseModule.closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-index-source-'))
    database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    stateRepository = createSessionStateRepository(database)
    indexRepository = createSessionIndexRepository(database)
    log = { warn: vi.fn() }
  })

  afterEach(async () => {
    stateService.stopSessionStateService()
    stateService.configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await databaseModule.closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  function createService() {
    // Same wiring as server/index.mjs: configureSessionIndex({ readBuckets: readAuthoritativeSessionMetadataBuckets })
    return createSessionIndexService({ repository: indexRepository, readBuckets: storageModule.readAuthoritativeSessionMetadataBuckets, log })
  }

  it('keeps the index ready and serves SQL pages in the pending phase while the JSON mirror lags', async () => {
    stateService.configureSessionStateService({ repository: stateRepository, phase: 'sqlite_authoritative_json_pending' })
    stateService.saveSessionBody('alpha', { title: 'Alpha', messages: [{ role: 'user', content: 'hello alpha' }] })
    stateService.saveSessionBody('beta', { scope: 'project', projectId: 'p1', title: 'Beta', messages: [{ role: 'user', content: 'hello beta' }] })

    // The mirror is deliberately not drained: the physical JSON metadata is
    // absent/stale while SQLite (and the transactionally maintained
    // session_index) is authoritative.
    expect(stateRepository.countMirrorQueue()).toBeGreaterThan(0)

    const service = createService()
    expect(await service.initialize()).toMatchObject({ ok: true, degraded: false, dirty: false, count: 2 })
    expect(await service.verifyIntegrity({ force: true })).toMatchObject({ ready: true, dirty: false, degraded: false })

    const page = await service.queryPage(PAGE_OPTIONS)
    expect(page.ok).toBe(true)
    expect(page.page.total).toBe(2)
    expect(page.page.values.map((value) => value.title).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('still detects real index drift in the authoritative phase and self-heals from SQLite', async () => {
    stateService.configureSessionStateService({ repository: stateRepository, phase: 'authoritative' })
    stateService.saveSessionBody('one', { title: 'One', messages: [{ role: 'user', content: 'hi' }] })

    const service = createService()
    await service.initialize()

    database.prepare("DELETE FROM session_index WHERE session_id = 'one'").run()
    const drifted = await service.verifyIntegrity({ force: true })
    expect(drifted).toMatchObject({ ready: false, reason: 'digest_mismatch', dirty: true, degraded: true })

    // verifyIntegrity schedules a rebuild; the rebuild source is the same
    // phase-aware reader, so the projection is rebuilt from SQLite.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await service.verifyIntegrity({ force: true })).toMatchObject({ ready: true, dirty: false, degraded: false })
    expect(indexRepository.get('global', null, 'one')).not.toBeNull()
  })

  it('keeps JSON-authoritative and cutover phases on the physical JSON source', async () => {
    stateService.configureSessionStateService({ repository: stateRepository, phase: 'json_authoritative' })
    await writePhysicalGlobalMetadata({ gamma: canonicalMetadata('gamma') })

    const buckets = await storageModule.readAuthoritativeSessionMetadataBuckets()
    expect(buckets).toEqual([{ scope: 'global', projectId: null, metadata: { gamma: canonicalMetadata('gamma') } }])
    expect(() => stateService.readSessionMetadataBuckets()).toThrow(/SQLite-readable phase/)

    const service = createService()
    expect(await service.initialize()).toMatchObject({ ok: true, rebuilt: true, count: 1 })

    stateService.configureSessionStateService({ phase: 'cutover_running' })
    expect(() => stateService.readSessionMetadataBuckets()).toThrow(/SQLite-readable phase/)
    expect(await storageModule.readAuthoritativeSessionMetadataBuckets()).toEqual(buckets)
    expect(await service.verifyIntegrity({ force: true })).toMatchObject({ ready: true, dirty: false })
  })

  it('computes identical digests from SQLite buckets and equivalent JSON buckets across the phase boundary', async () => {
    const metadata = canonicalMetadata('one')
    stateRepository.save({
      scope: 'global',
      sessionId: 'one',
      stateVersion: 1,
      state: { id: 'one', scope: 'global', stateVersion: 1, title: metadata.title, messages: [{ role: 'user', content: 'hi' }] },
      metadata,
    }, { expectedRevision: 0 })
    await writePhysicalGlobalMetadata({ one: metadata })

    stateService.configureSessionStateService({ repository: stateRepository, phase: 'authoritative' })
    const service = createService()
    expect(await service.initialize()).toMatchObject({ ok: true, degraded: false })

    // Switching phases (and therefore the readiness source) must not flap the
    // index when both sources carry the same logical metadata.
    stateService.configureSessionStateService({ phase: 'json_authoritative' })
    expect(await service.verifyIntegrity({ force: true })).toMatchObject({ ready: true, dirty: false })
    stateService.configureSessionStateService({ phase: 'sqlite_authoritative_json_pending' })
    expect(await service.verifyIntegrity({ force: true })).toMatchObject({ ready: true, dirty: false })
  })
})
