import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSessionIndex } from '../../../server/session-index-service.mjs'

function req() { return { method: 'GET' } }
function res() {
  return {
    headersSent: false, status: null, body: '',
    writeHead(status) { this.status = status; this.headersSent = true },
    end(body) { this.body = body ?? '' },
  }
}

function metadata(id, overrides = {}) {
  return {
    id, scope: 'global', title: id, messageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

async function call(route, query) {
  const response = res()
  const url = new URL(`http://localhost/api/storage/sessions-metadata/index/lastModified?${query}`)
  await route.handleStorageApi(req(), response, url, { isLocalRequest: true })
  return JSON.parse(response.body)
}

describe('storage session index query route', () => {
  let directory
  let previousDataDir
  let databaseModule
  let route
  let storage
  let stateRepository
  let indexRepository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-route-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    process.env.QUICKFORGE_DATA_DIR = directory
    vi.resetModules()
    databaseModule = await import('../../../server/sqlite/database.mjs')
    const database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'index.sqlite3') })
    const stateRepositoryModule = await import('../../../server/sqlite/session-state-repository.mjs')
    const indexRepositoryModule = await import('../../../server/sqlite/session-index-repository.mjs')
    stateRepository = stateRepositoryModule.createSessionStateRepository(database)
    indexRepository = indexRepositoryModule.createSessionIndexRepository(database)
    storage = await import('../../../server/storage.mjs')
    route = await import('../../../server/routes/storage.mjs')
  })

  afterEach(async () => {
    await databaseModule?.closeSqliteStorage().catch(() => {})
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    vi.resetModules()
    await rm(directory, { recursive: true, force: true })
  })

  async function seed(values) {
    await storage.ensureStorage()
    for (const value of values) {
      await stateRepository.save({
        scope: 'global',
        sessionId: value.id,
        stateVersion: 1,
        state: { id: value.id, scope: 'global', stateVersion: 1, title: value.title, createdAt: value.createdAt, lastModified: value.lastModified, messages: [{ role: 'user', content: 'hi' }] },
        metadata: { ...value, messageCount: 1 },
      }, { expectedRevision: 0 })
    }
    const serviceModule = await import('../../../server/session-index-service.mjs')
    await serviceModule.initializeSessionIndex({ repository: indexRepository })
  }

  it('serves eligible SQL LIMIT/OFFSET with the exact legacy response shape', async () => {
    const values = [
      metadata('old', { lastModified: '2026-01-01T00:00:00.000Z' }),
      metadata('new', { lastModified: '2026-01-03T00:00:00.000Z' }),
    ]
    await seed(values)
    const payload = await call(route, 'direction=desc&limit=1&offset=0&scope=global')
    expect(payload.total).toBe(2)
    expect(payload.values).toEqual([expect.objectContaining({ id: 'new', lastModified: '2026-01-03T00:00:00.000Z' })])
  })

  it.each([
    'direction=desc&limit=0&offset=0&scope=global',
    'direction=desc&limit=1x&offset=0&scope=global',
    'direction=desc&limit=1&offset=-1&scope=global',
    'direction=desc&limit=1&offset=Infinity&scope=global',
    'direction=sideways&limit=1&offset=0&scope=global',
    'direction=desc&limit=1&offset=0&scope=global&projectId=unexpected',
    'direction=desc&limit=1&offset=0&scope=global&pinned=sometimes',
  ])('keeps invalid/legacy pagination and scope on the sorted-read fallback: %s', async (query) => {
    await seed([metadata('one')])
    const payload = await call(route, query)
    // Not SQL-eligible: served by the legacy sorted read (total preserved;
    // exotic offsets keep their legacy slice semantics).
    expect(payload.total).toBe(1)
    expect(Array.isArray(payload.values)).toBe(true)
  })

  it('fallback reads also come from the authoritative store', async () => {
    const values = [
      metadata('a', { lastModified: '2026-01-01T00:00:00.000Z' }),
      metadata('b', { lastModified: '2026-01-05T00:00:00.000Z' }),
    ]
    await seed(values)
    // No limit: not SQL-eligible, served by the sorted-read path.
    const payload = await call(route, 'direction=desc&scope=global')
    expect(payload.total).toBe(2)
    expect(payload.values.map((value) => value.id)).toEqual(['b', 'a'])
  })

  it('pinned=exclude stays SQL-eligible and filters pinned sessions out of list queries', async () => {
    const values = [
      metadata('plain', { lastModified: '2026-01-02T00:00:00.000Z' }),
      metadata('pinned', { lastModified: '2026-01-03T00:00:00.000Z', pinnedAt: '2026-01-01T00:00:00.000Z' }),
      // Non-date pinnedAt string: excluded by the SQL `pinned_at IS NULL`
      // predicate but kept by the legacy isValidPinnedAt filter — the
      // discriminator proving this query was served by the SQL path.
      metadata('weird', { lastModified: '2026-01-04T00:00:00.000Z', pinnedAt: 'not-a-date' }),
    ]
    await seed(values)
    const payload = await call(route, 'direction=desc&limit=10&offset=0&scope=global&pinned=exclude')
    expect(payload.total).toBe(1)
    expect(payload.values.map((value) => value.id)).toEqual(['plain'])
  })

  it('keeps an invalid pinned value on the sorted-read fallback (pinned passthrough)', async () => {
    const values = [
      metadata('plain', { lastModified: '2026-01-02T00:00:00.000Z' }),
      metadata('pinned', { lastModified: '2026-01-03T00:00:00.000Z', pinnedAt: '2026-01-01T00:00:00.000Z' }),
      metadata('weird', { lastModified: '2026-01-04T00:00:00.000Z', pinnedAt: 'not-a-date' }),
    ]
    await seed(values)
    // pinned=something-else is not SQL-eligible: the legacy sorted read keeps
    // every session (no pinned filtering at all), pinned or not.
    const payload = await call(route, 'direction=desc&limit=10&offset=0&scope=global&pinned=sometimes')
    expect(payload.total).toBe(3)
    expect(payload.values.map((value) => value.id).sort()).toEqual(['pinned', 'plain', 'weird'])
  })
})
