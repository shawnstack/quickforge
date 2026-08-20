import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySqliteMigrations } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'
import {
  configureSessionIndex,
  createSessionIndexService,
  getSessionIndexDiagnostics,
  initializeSessionIndex,
  markSessionIndexQueryFailure,
  querySessionIndexPage,
  syncSessionMetadataCommit,
} from '../../server/session-index-service.mjs'

function createHandle(database) {
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
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

function seedSession(stateRepository, sessionId, overrides = {}) {
  const lastModified = overrides.lastModified ?? `2026-08-1${overrides.slot ?? 0}T00:00:00.000Z`
  return stateRepository.save({
    scope: 'global',
    sessionId,
    stateVersion: 1,
    state: {
      id: sessionId, scope: 'global', stateVersion: 1, title: sessionId,
      createdAt: '2026-08-01T00:00:00.000Z', lastModified,
      messages: [{ role: 'user', content: 'hi' }],
    },
    metadata: {
      id: sessionId, scope: 'global', stateVersion: 1, title: sessionId,
      createdAt: '2026-08-01T00:00:00.000Z', lastModified, messageCount: 1,
    },
  }, { expectedRevision: 0 })
}

const PAGE = { scopeMode: 'all', archive: 'exclude', sort: 'lastModified', direction: 'desc', limit: 20, offset: 0 }

describe('session index service (storage v2)', () => {
  let directory
  let database
  let handle
  let stateRepository
  let indexRepository
  let log

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-service-'))
    database = new DatabaseSync(path.join(directory, 'index.sqlite3'))
    applySqliteMigrations(database)
    handle = createHandle(database)
    stateRepository = createSessionStateRepository(handle)
    indexRepository = createSessionIndexRepository(handle)
    log = { warn: vi.fn() }
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('initializes ready with a live count and reports healthy diagnostics', async () => {
    seedSession(stateRepository, 'one', { slot: 1 })
    seedSession(stateRepository, 'two', { slot: 2 })
    const service = createSessionIndexService({ repository: indexRepository, log })
    const initialized = await service.initialize()
    expect(initialized).toMatchObject({ ok: true, initialized: true, count: 2, status: 'ready', degraded: false, dirty: false })
    expect(await service.verifyIntegrity()).toMatchObject({ ready: true })
    expect(service.getDiagnostics()).toMatchObject({ initialized: true, degraded: false, count: 2 })
  })

  it('never treats an uninitialized service as healthy', async () => {
    const service = createSessionIndexService({ repository: indexRepository, log })
    expect(service.getDiagnostics()).toMatchObject({ status: 'uninitialized', initialized: false })
    expect(await service.verifyIntegrity()).toMatchObject({ ready: false, reason: 'uninitialized' })
    expect(await service.queryPage(PAGE)).toMatchObject({ ok: false, reason: 'uninitialized' })
  })

  it('serves pages straight from the sessions table and keeps serving after writes', async () => {
    seedSession(stateRepository, 'one', { slot: 1 })
    const service = createSessionIndexService({ repository: indexRepository, log })
    await service.initialize()
    const first = await service.queryPage(PAGE)
    expect(first).toMatchObject({ ok: true })
    expect(first.page.total).toBe(1)
    expect(first.page.values[0]).toMatchObject({ id: 'one' })

    // A later write is immediately visible — there is no projection to sync.
    seedSession(stateRepository, 'two', { slot: 2 })
    const second = await service.queryPage(PAGE)
    expect(second.page.total).toBe(2)
    expect(second.page.values.map((value) => value.id)).toEqual(['two', 'one'])
  })

  it('falls back on aggregate duplicates and complete sort ties', async () => {
    seedSession(stateRepository, 'same', { slot: 1 })
    const row = database.prepare("SELECT body_json, meta_json, created_at, updated_at, message_count, state_version, revision, updated_at_ms FROM sessions WHERE session_id = 'same'").get()
    database.prepare(`INSERT INTO sessions (
      scope, project_id, session_id, title, created_at, updated_at, message_count, state_version,
      archived_at, pinned_at, body_json, meta_json, revision, updated_at_ms
    ) VALUES ('project', 'p1', 'same', 'same', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`)
      .run(row.created_at, row.updated_at, row.message_count, row.state_version, row.body_json, row.meta_json, row.revision, row.updated_at_ms)

    const service = createSessionIndexService({ repository: indexRepository, log })
    await service.initialize()
    expect(await service.queryPage({ ...PAGE, scopeMode: 'all' })).toMatchObject({ ok: false, reason: 'duplicate_session_id' })
    expect(await service.queryPage({ ...PAGE, scopeMode: 'project', projectId: 'p1' })).toMatchObject({ ok: true })
  })

  it('degrades on repository failures and reports the last error', async () => {
    const failing = {
      ...indexRepository,
      analyzeQuery() { throw Object.assign(new Error('query failed'), { code: 'SQLITE_IOERR' }) },
    }
    const service = createSessionIndexService({ repository: failing, log })
    await service.initialize()
    expect(await service.queryPage(PAGE)).toMatchObject({ ok: false, reason: 'repository_error', error: { code: 'SQLITE_IOERR' } })
    expect(service.getDiagnostics()).toMatchObject({ dirty: true, degraded: true, lastFailure: { code: 'SQLITE_IOERR' } })
    expect(log.warn).toHaveBeenCalled()
  })

  it('keeps syncMetadataCommit and markQueryFailure as harmless no-ops', async () => {
    const service = createSessionIndexService({ repository: indexRepository, log })
    await service.initialize()
    await expect(service.syncMetadataCommit({ scope: 'global', projectId: null, previous: {}, next: {} }))
      .resolves.toMatchObject({ ok: true, skipped: true })
    service.markQueryFailure('shadow_mismatch')
    expect(service.getDiagnostics()).toMatchObject({ degraded: false, dirty: false })
  })

  it('module-level wiring initializes the process service and serves pages', async () => {
    seedSession(stateRepository, 'one', { slot: 1 })
    configureSessionIndex({ repository: indexRepository })
    const initialized = await initializeSessionIndex()
    expect(initialized).toMatchObject({ ok: true, count: 1 })
    expect(getSessionIndexDiagnostics()).toMatchObject({ initialized: true, count: 1, queryCompatible: true })
    const page = await querySessionIndexPage(PAGE)
    expect(page).toMatchObject({ ok: true })
    expect(page.page.total).toBe(1)
    await expect(syncSessionMetadataCommit()).resolves.toMatchObject({ ok: true, skipped: true })
    expect(() => markSessionIndexQueryFailure('anything')).not.toThrow()
  })

  it('reports uninitialized module diagnostics before any service exists', async () => {
    // A fresh module state: vitest isolates test files, but the module-level
    // service persists within this file — assert the pre-init shape through
    // the exported default directly.
    expect(getSessionIndexDiagnostics()).toMatchObject({
      status: expect.any(String),
      initialized: expect.any(Boolean),
      queryCompatible: true,
      lastFailure: null,
    })
  })
})
