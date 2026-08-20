import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Storage v2: the session index reads the authoritative sessions table
// directly — readSessionMetadataBuckets (meta_json-only projection) is the
// single bucket source for both the service wiring and the storage facade's
// per-bucket metadata updates. This file pins that contract.

let dataRoot
let previousDataDir
let databaseModule
let stateService
let storageModule
let createSessionStateRepository
let createSessionIndexRepository

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

function sessionRecord(id, metadata) {
  return {
    scope: 'global',
    sessionId: id,
    stateVersion: 1,
    state: { id, scope: 'global', stateVersion: 1, title: metadata.title, messages: [{ role: 'user', content: 'hi' }] },
    metadata,
  }
}

async function writePhysicalGlobalMetadata(values) {
  const file = path.join(dataRoot, 'storage', 'conversations', 'global', 'sessions-metadata.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(values, null, 2)}\n`, 'utf8')
}

const PAGE_OPTIONS = { scopeMode: 'all', archive: 'exclude', sort: 'lastModified', direction: 'desc', limit: 20, offset: 0 }

describe('session index bucket source (authoritative sessions table)', () => {
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
    ;({ createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs'))
    ;({ createSessionIndexRepository } = await import('../../server/sqlite/session-index-repository.mjs'))
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
    stateService.configureSessionStateService({ repository: stateRepository })
    log = { warn: vi.fn() }
  })

  afterEach(async () => {
    stateService.configureSessionStateService({ repository: null })
    await databaseModule.closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('serves SQL pages from the sessions table through the service wiring', async () => {
    stateService.saveSessionBody('alpha', { title: 'Alpha', messages: [{ role: 'user', content: 'hello alpha' }] })
    stateService.saveSessionBody('beta', { scope: 'project', projectId: 'p1', title: 'Beta', messages: [{ role: 'user', content: 'hello beta' }] })

    const buckets = await storageModule.readAuthoritativeSessionMetadataBuckets()
    expect(buckets.map((bucket) => bucket.scope).sort()).toEqual(['global', 'project'])
    expect(buckets.find((bucket) => bucket.scope === 'global').metadata.alpha).toMatchObject({ title: 'Alpha' })
    expect(buckets.find((bucket) => bucket.scope === 'project').metadata.beta).toMatchObject({ title: 'Beta', projectId: 'p1' })

    const { createSessionIndexService } = await import('../../server/session-index-service.mjs')
    const service = createSessionIndexService({ repository: indexRepository, log })
    expect(await service.initialize()).toMatchObject({ ok: true, count: 2 })
    const page = await service.queryPage(PAGE_OPTIONS)
    expect(page.ok).toBe(true)
    expect(page.page.total).toBe(2)
    expect(page.page.values.map((value) => value.title).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('sees writes immediately — the store and the index are the same rows', async () => {
    stateRepository.save(sessionRecord('one', canonicalMetadata('one')), { expectedRevision: 0 })
    const { createSessionIndexService } = await import('../../server/session-index-service.mjs')
    const service = createSessionIndexService({ repository: indexRepository, log })
    await service.initialize()
    expect((await service.queryPage(PAGE_OPTIONS)).page.total).toBe(1)

    stateRepository.save(sessionRecord('two', canonicalMetadata('two', { lastModified: '2026-01-05T00:00:00.000Z' })), { expectedRevision: 0 })
    const updated = await service.queryPage(PAGE_OPTIONS)
    expect(updated.page.total).toBe(2)
    expect(updated.page.values.map((value) => value.id)).toEqual(['two', 'one'])
  })

  it('metadata buckets never materialize state bodies or message rows', async () => {
    stateRepository.save(sessionRecord('one', canonicalMetadata('one')), { expectedRevision: 0 })
    const buckets = stateService.readSessionMetadataBuckets()
    expect(buckets).toHaveLength(1)
    expect(buckets[0].metadata.one).toEqual(canonicalMetadata('one'))
    expect(buckets[0].metadata.one).not.toHaveProperty('messages')
  })

  it('legacy physical JSON metadata stays untouched by the authoritative source', async () => {
    await writePhysicalGlobalMetadata({ gamma: canonicalMetadata('gamma') })
    const buckets = await storageModule.readAuthoritativeSessionMetadataBuckets()
    expect(buckets).toEqual([])
    // The physical reader is still available for the offline downgrade tool.
    const physical = await storageModule.readPhysicalSessionMetadataBuckets()
    expect(physical[0].metadata.gamma).toMatchObject({ title: 'Title gamma' })
  })
})
