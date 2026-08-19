import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'

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

function row(sessionId, overrides = {}) {
  const scope = overrides.scope ?? 'global'
  const projectId = scope === 'project' ? overrides.projectId : null
  const metadata = {
    id: sessionId,
    scope,
    ...(projectId ? { projectId } : {}),
    title: sessionId,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    lastModified: overrides.lastModified ?? '2026-01-02T00:00:00.000Z',
    messageCount: overrides.messageCount,
    ...(overrides.pinnedAt ? { pinnedAt: overrides.pinnedAt } : {}),
    ...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {}),
  }
  return {
    scope, projectId, sessionId,
    createdAt: metadata.createdAt,
    lastModified: metadata.lastModified,
    messageCount: overrides.messageCount ?? null,
    pinnedAt: overrides.pinnedAt ?? null,
    archivedAt: overrides.archivedAt ?? null,
    stateVersion: null,
    metadata,
    metadataDigest: typeof overrides.digest === 'string' && overrides.digest.length === 64
      ? overrides.digest
      : (overrides.digest ?? sessionId.charCodeAt(0).toString(16).padStart(2, '0')).repeat(64).slice(0, 64),
    indexedAt: '2026-01-03T00:00:00.000Z',
  }
}

function query(overrides = {}) {
  return {
    scopeMode: 'all', archive: 'exclude', pinnedOnly: false,
    sort: 'lastModified', direction: 'desc', limit: 20, offset: 0,
    ...overrides,
  }
}

describe('session index query migration v5', () => {
  let directory
  let database
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-query-'))
    database = new DatabaseSync(path.join(directory, 'query.sqlite3'))
    applySqliteMigrations(database)
    repository = createSessionIndexRepository(createHandle(database))
  })

  afterEach(async () => {
    database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('adds only the five query indexes and rolls v4 to v5 failure back without touching F5 data', () => {
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(10)
    const names = database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name LIKE 'session_index_%_query_idx' ORDER BY name").all().map((row) => row.name)
    expect(names).toEqual([
      'session_index_aggregate_modified_query_idx',
      'session_index_projects_created_query_idx',
      'session_index_projects_modified_query_idx',
      'session_index_scope_created_query_idx',
      'session_index_scope_modified_query_idx',
    ])

    const rollback = new DatabaseSync(path.join(directory, 'rollback.sqlite3'))
    try {
      applySqliteMigrations(rollback, { migrations: SQLITE_MIGRATIONS.slice(0, 4) })
      rollback.prepare("INSERT INTO scheduled_task_runs (task_id,id,status,started_at,extra_json,source,updated_at) VALUES ('t','r','success','x','{}','test','x')").run()
      const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 5
        ? { ...migration, up(db) { migration.up(db); throw new Error('after v5 indexes') } }
        : migration)
      expect(() => applySqliteMigrations(rollback, { migrations: failing })).toThrow(/migration 5.*after v5 indexes/)
      expect(rollback.prepare('PRAGMA user_version').get().user_version).toBe(4)
      expect(rollback.prepare('SELECT task_id,id FROM scheduled_task_runs').all()).toEqual([{ task_id: 't', id: 'r' }])
      expect(rollback.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'session_index_%_query_idx'").all()).toEqual([])
    } finally {
      rollback.close()
    }
  })

  it('filters scopes/archive/pinned/message_count and preserves JSON sorting/NULL placement', () => {
    repository.replaceAll([
      row('global-null', { messageCount: null, lastModified: null, digest: 'a' }),
      row('global-zero', { messageCount: 0, digest: 'b' }),
      row('global-normal', { messageCount: 2, lastModified: '2026-01-04T00:00:00.000Z', digest: 'c' }),
      row('global-pinned', { messageCount: 1, pinnedAt: '2026-02-01T00:00:00.000Z', lastModified: '2025-01-01T00:00:00.000Z', digest: 'd' }),
      row('archived', { messageCount: 1, archivedAt: 'truthy', digest: 'e' }),
      row('project-a', { scope: 'project', projectId: 'p1', messageCount: 1, digest: 'f' }),
    ])

    expect(repository.listPage(query({ scopeMode: 'global' })).values.map((value) => value.id)).toEqual(['global-pinned', 'global-normal', 'global-null'])
    expect(repository.listPage(query({ scopeMode: 'project', projectId: 'p1' })).values.map((value) => value.id)).toEqual(['project-a'])
    expect(repository.listPage(query({ scopeMode: 'projects' })).total).toBe(1)
    expect(repository.listPage(query({ archive: 'only' })).values.map((value) => value.id)).toEqual(['archived'])
    expect(repository.listPage(query({ archive: 'include' })).total).toBe(5)
    expect(repository.listPage(query({ pinnedOnly: true, sort: 'pinnedAt' })).values.map((value) => value.id)).toEqual(['global-pinned'])
    expect(repository.listPage(query({ direction: 'asc', sort: 'createdAt' })).values.at(0).id).toBe('global-pinned')
  })

  it('uses deferred count+LIMIT/OFFSET, detects aggregate duplicates and complete sort ties', () => {
    repository.replaceAll([
      row('same', { messageCount: 1, digest: 'a' }),
      row('same', { scope: 'project', projectId: 'p1', messageCount: 1, digest: 'b' }),
      row('other', { messageCount: 1, lastModified: '2026-01-03T00:00:00.000Z', digest: 'c' }),
    ])
    expect(repository.listPage(query({ limit: 1, offset: 1 }))).toMatchObject({ total: 3, values: [expect.any(Object)] })
    expect(repository.analyzeQuery(query())).toMatchObject({ duplicateSessionIdCount: 1, fullSortKeyTieCount: 1 })
    expect(repository.analyzeQuery(query({ scopeMode: 'global' })).duplicateSessionIdCount).toBe(0)
    const plan = repository.explainQueryPlan(query({ scopeMode: 'projects' })).map((row) => row.detail).join('\n')
    expect(plan).toContain('session_index_projects_modified_query_idx')
    expect(plan).not.toContain('SCAN session_index')
  })

  it('rejects user-controlled query fields outside the allowlist', () => {
    expect(() => repository.listPage(query({ sort: 'metadata_json; DROP TABLE session_index' }))).toThrow(/sort/)
    expect(() => repository.listPage(query({ direction: 'sideways' }))).toThrow(/direction/)
    expect(() => repository.listPage(query({ scopeMode: 'project', projectId: '' }))).toThrow(/projectId/)
    expect(() => repository.listPage(query({ limit: Number.POSITIVE_INFINITY }))).toThrow(/limit/)
  })
})
