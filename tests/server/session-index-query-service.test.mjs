import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySqliteMigrations } from '../../server/sqlite/migrations.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'
import { createSessionIndexService } from '../../server/session-index-service.mjs'

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

function metadata(id, overrides = {}) {
  return {
    id,
    scope: 'global',
    title: id,
    messageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function buckets(global = {}, projects = {}) {
  return [
    { scope: 'global', projectId: null, metadata: global },
    ...Object.entries(projects).map(([projectId, values]) => ({ scope: 'project', projectId, metadata: values })),
  ]
}

describe('session index query readiness and compatibility', () => {
  let directory
  let database
  let repository
  let nowValue
  let log

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-readiness-'))
    database = new DatabaseSync(path.join(directory, 'readiness.sqlite3'))
    applySqliteMigrations(database)
    repository = createSessionIndexRepository(createHandle(database))
    nowValue = Date.parse('2026-01-03T00:00:00.000Z')
    log = { warn: vi.fn() }
  })

  afterEach(async () => {
    database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('never treats an uninitialized service as healthy and reports count/digest verification', async () => {
    const service = createSessionIndexService({
      repository, readBuckets: async () => buckets({ one: metadata('one') }),
      now: () => new Date(nowValue).toISOString(), nowMs: () => nowValue, log,
    })
    expect(service.getDiagnostics()).toMatchObject({ status: 'uninitialized', initialized: false, degraded: true, dirty: true })
    expect(await service.verifyIntegrity()).toMatchObject({ ready: false, reason: 'uninitialized' })
    expect(await service.initialize()).toMatchObject({ initialized: true, sourceCount: 1, indexCount: 1, queryCompatible: true })
    expect(await service.verifyIntegrity()).toMatchObject({ ready: true, sourceDigest: expect.any(String), indexDigest: expect.any(String) })
  })

  it.each([
    ['key/id mismatch', { id: 'wrong' }, 'keyIdMismatch'],
    ['scope conflict', { scope: 'project', projectId: 'p' }, 'scopeConflict'],
    ['non-canonical created', { createdAt: '2026-01-01' }, 'invalidCreatedAt'],
    ['non-string modified', { lastModified: 1 }, 'invalidLastModified'],
    ['invalid pinned', { pinnedAt: 'not-a-date' }, 'invalidPinnedAt'],
    ['non-string archive truthy value', { archivedAt: 1 }, 'invalidArchivedAt'],
  ])('falls back for source-incompatible metadata: %s', async (_name, overrides, issue) => {
    const service = createSessionIndexService({ repository, readBuckets: async () => buckets({ one: metadata('one', overrides) }), log })
    const initialized = await service.initialize()
    expect(initialized).toMatchObject({ initialized: true, degraded: true, dirty: false, queryCompatible: false })
    expect(initialized.compatibilityIssues[issue]).toBe(1)
    expect(await service.queryPage({ scopeMode: 'all', archive: 'exclude', sort: 'lastModified', direction: 'desc', limit: 20, offset: 0 }))
      .toMatchObject({ ok: false, reason: 'source_incompatible' })
  })

  it('detects digest mismatch after TTL, marks dirty/degraded and schedules a single-flight rebuild', async () => {
    let source = buckets({ one: metadata('one') })
    const service = createSessionIndexService({
      repository, readBuckets: async () => source,
      now: () => new Date(nowValue).toISOString(), nowMs: () => nowValue, verifyTtlMs: 100, log,
    })
    await service.initialize()
    source = buckets({ two: metadata('two') })
    nowValue += 101
    expect(await service.verifyIntegrity()).toMatchObject({ ready: false, reason: 'digest_mismatch', dirty: true, degraded: true })
    expect((await service.queryPage({ scopeMode: 'all', archive: 'exclude', sort: 'lastModified', direction: 'desc', limit: 20, offset: 0 })).ok).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(service.getDiagnostics().rebuildCount).toBe(2)
  })

  it('falls back on aggregate duplicates/ties and repository failures while scoped duplicates remain eligible', async () => {
    const source = buckets(
      { same: metadata('same'), tie: metadata('tie') },
      { p1: { same: metadata('same', { scope: 'project', projectId: 'p1' }) } },
    )
    const service = createSessionIndexService({ repository, readBuckets: async () => source, log })
    await service.initialize()
    const base = { archive: 'exclude', sort: 'lastModified', direction: 'desc', limit: 20, offset: 0 }
    expect(await service.queryPage({ ...base, scopeMode: 'all' })).toMatchObject({ ok: false, reason: 'duplicate_session_id' })
    expect(await service.queryPage({ ...base, scopeMode: 'global' })).toMatchObject({ ok: false, reason: 'sort_key_tie' })
    expect(await service.queryPage({ ...base, scopeMode: 'project', projectId: 'p1' })).toMatchObject({ ok: true })

    const failing = createSessionIndexService({
      repository: { ...repository, analyzeQuery() { throw Object.assign(new Error('query failed'), { code: 'SQLITE_IOERR' }) } },
      readBuckets: async () => buckets({ one: metadata('one') }), log,
    })
    await failing.initialize()
    expect(await failing.queryPage({ ...base, scopeMode: 'global' })).toMatchObject({ ok: false, reason: 'repository_error' })
    expect(failing.getDiagnostics()).toMatchObject({ dirty: true, degraded: true, lastFailure: { code: 'SQLITE_IOERR' } })
  })
})
