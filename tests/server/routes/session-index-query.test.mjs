import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySqliteMigrations } from '../../../server/sqlite/migrations.mjs'
import { createSessionIndexRepository } from '../../../server/sqlite/session-index-repository.mjs'
import { initializeSessionIndex } from '../../../server/session-index-service.mjs'

function createHandle(database) {
  return {
    prepare: (sql) => database.prepare(sql),
    exec: (sql) => database.exec(sql),
    transaction(callback, { mode = 'immediate' } = {}) {
      database.exec(`BEGIN ${mode.toUpperCase()}`)
      try {
        const result = callback(this)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

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
  let database
  let route
  let storage

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-route-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    process.env.QUICKFORGE_DATA_DIR = directory
    vi.resetModules()
    database = new DatabaseSync(path.join(directory, 'index.sqlite3'))
    applySqliteMigrations(database)
    storage = await import('../../../server/storage.mjs')
    route = await import('../../../server/routes/storage.mjs')
  })

  afterEach(async () => {
    database.close()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    vi.resetModules()
    await rm(directory, { recursive: true, force: true })
  })

  async function seed(values, sampler = () => false) {
    await storage.ensureStorage()
    await storage.writeStore('sessions-metadata', Object.fromEntries(values.map((value) => [value.id, value])))
    const baseRepository = createSessionIndexRepository(createHandle(database))
    const repository = { ...baseRepository, listPage: vi.fn((options) => baseRepository.listPage(options)) }
    const serviceModule = await import('../../../server/session-index-service.mjs')
    await serviceModule.initializeSessionIndex({
      repository,
      readBuckets: async () => [{ scope: 'global', projectId: null, metadata: Object.fromEntries(values.map((value) => [value.id, value])) }],
      log: { warn: vi.fn() },
    })
    route.configureSessionIndexQueryShadow({ sample: sampler })
    return { repository, serviceModule }
  }

  it('serves eligible SQL LIMIT/OFFSET with the exact JSON shape and forces first-shape shadow', async () => {
    const values = [
      metadata('old', { lastModified: '2026-01-01T00:00:00.000Z' }),
      metadata('new', { lastModified: '2026-01-03T00:00:00.000Z' }),
    ]
    const { repository } = await seed(values)
    const payload = await call(route, 'direction=desc&limit=1&offset=0&scope=global')
    expect(payload).toEqual({ values: [values[1]], total: 2 })
    expect(repository.listPage).toHaveBeenCalledTimes(1)
  })

  it.each([
    'direction=desc&limit=0&offset=0&scope=global',
    'direction=desc&limit=1x&offset=0&scope=global',
    'direction=desc&limit=1&offset=-1&scope=global',
    'direction=desc&limit=1&offset=Infinity&scope=global',
    'direction=sideways&limit=1&offset=0&scope=global',
    'direction=desc&limit=1&offset=0&scope=global&projectId=unexpected',
  ])('keeps invalid/legacy pagination and scope on JSON: %s', async (query) => {
    const { repository } = await seed([metadata('one')])
    await call(route, query)
    expect(repository.listPage).not.toHaveBeenCalled()
  })

  it('falls back for incompatible source metadata, aggregate duplicates and complete sort ties', async () => {
    const incompatible = metadata('bad', { pinnedAt: 'invalid' })
    const first = await seed([incompatible])
    expect(await call(route, 'direction=desc&limit=20&offset=0&scope=global')).toEqual({ values: [incompatible], total: 1 })
    expect(first.repository.listPage).not.toHaveBeenCalled()
  })

  it('returns JSON and degrades on a deterministic shadow mismatch', async () => {
    const values = [metadata('one')]
    const { repository, serviceModule } = await seed(values, () => true)
    const original = repository.listPage.getMockImplementation()
    repository.listPage.mockImplementation((options) => ({ ...original(options), values: [{ ...values[0], title: 'wrong' }] }))
    const payload = await call(route, 'direction=desc&limit=20&offset=0&scope=global')
    expect(payload).toEqual({ values, total: 1 })
    expect(serviceModule.getSessionIndexDiagnostics()).toMatchObject({ dirty: true, degraded: true })
  })
})
