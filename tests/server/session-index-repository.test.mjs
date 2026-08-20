import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'

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

// Seed a session row through the authoritative repository so the promoted
// list columns (created_at, message_count, pinned_at, archived_at, meta_json)
// carry exactly what production writes.
function seed(stateRepository, sessionId, overrides = {}) {
  const scope = overrides.scope ?? 'global'
  const projectId = scope === 'project' ? (overrides.projectId ?? 'p1') : null
  const lastModified = overrides.lastModified ?? `2026-08-1${overrides.slot ?? 0}T00:00:00.000Z`
  return stateRepository.save({
    scope,
    projectId,
    sessionId,
    stateVersion: 1,
    state: {
      id: sessionId,
      scope,
      ...(scope === 'project' ? { projectId } : {}),
      stateVersion: 1,
      title: `Session ${sessionId}`,
      createdAt: overrides.createdAt ?? '2026-08-01T00:00:00.000Z',
      lastModified,
      messages: overrides.messages ?? [{ role: 'user', content: 'hello' }],
      ...(overrides.pinnedAt ? { pinnedAt: overrides.pinnedAt } : {}),
      ...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {}),
    },
    metadata: {
      id: sessionId,
      scope,
      ...(scope === 'project' ? { projectId } : {}),
      stateVersion: 1,
      title: `Session ${sessionId}`,
      createdAt: overrides.createdAt ?? '2026-08-01T00:00:00.000Z',
      lastModified,
      messageCount: overrides.messages?.length ?? 1,
      ...(overrides.pinnedAt ? { pinnedAt: overrides.pinnedAt } : {}),
      ...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {}),
      ...overrides.metadata,
    },
  }, { expectedRevision: overrides.expectedRevision ?? 0 })
}

function query(overrides = {}) {
  return {
    scopeMode: 'all', archive: 'exclude', pinnedOnly: false,
    sort: 'lastModified', direction: 'desc', limit: 20, offset: 0,
    ...overrides,
  }
}

describe('session index repository (read-only query layer over sessions)', () => {
  let directory
  let database
  let stateRepository
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-repo-'))
    database = new DatabaseSync(path.join(directory, 'index.sqlite3'))
    applySqliteMigrations(database)
    const handle = createHandle(database)
    stateRepository = createSessionStateRepository(handle)
    repository = createSessionIndexRepository(handle)
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('is read-only: no write surface is exposed', () => {
    expect(Object.keys(repository).sort()).toEqual(['analyzeQuery', 'count', 'explainQueryPlan', 'listPage'])
  })

  it('filters scopes/archive/pinned/message_count and preserves legacy sorting/NULL placement', () => {
    seed(stateRepository, 'global-null', { lastModified: undefined, messages: [{ role: 'user', content: 'x' }] })
    // A session whose metadata carries no lastModified: json_extract yields
    // NULL, which sorts last under DESC (matching the retired index column).
    database.prepare("UPDATE sessions SET meta_json = json_remove(meta_json, '$.lastModified'), updated_at_ms = updated_at_ms + 1, revision = revision WHERE session_id = 'global-null'").run()
    seed(stateRepository, 'global-zero', { slot: 1, messages: [] })
    seed(stateRepository, 'global-normal', { slot: 2, lastModified: '2026-08-04T00:00:00.000Z' })
    seed(stateRepository, 'global-pinned', { slot: 3, lastModified: '2025-01-01T00:00:00.000Z', pinnedAt: '2026-02-01T00:00:00.000Z' })
    seed(stateRepository, 'archived', { slot: 4, archivedAt: '2026-01-01T00:00:00.000Z' })
    seed(stateRepository, 'project-a', { slot: 5, scope: 'project', projectId: 'p1' })

    expect(repository.listPage(query({ scopeMode: 'global' })).values.map((value) => value.id)).toEqual(['global-pinned', 'global-normal', 'global-null'])
    expect(repository.listPage(query({ scopeMode: 'project', projectId: 'p1' })).values.map((value) => value.id)).toEqual(['project-a'])
    expect(repository.listPage(query({ scopeMode: 'projects' })).total).toBe(1)
    expect(repository.listPage(query({ archive: 'only' })).values.map((value) => value.id)).toEqual(['archived'])
    expect(repository.listPage(query({ archive: 'include' })).total).toBe(5)
    expect(repository.listPage(query({ pinnedOnly: true, sort: 'pinnedAt' })).values.map((value) => value.id)).toEqual(['global-pinned'])
    expect(repository.listPage(query({ direction: 'asc', sort: 'createdAt' })).values.at(0).id).toBe('global-pinned')
  })

  it('serves LIMIT/OFFSET pages with counts and rows in the legacy shape', () => {
    seed(stateRepository, 'one', { slot: 1 })
    seed(stateRepository, 'two', { slot: 2 })
    seed(stateRepository, 'three', { slot: 3 })
    const page = repository.listPage(query({ limit: 1, offset: 1 }))
    expect(page).toMatchObject({ total: 3, values: [expect.any(Object)] })
    expect(page.values[0].id).toBe('two')
    expect(page.rows[0]).toMatchObject({
      scope: 'global',
      projectId: null,
      sessionId: 'two',
      isPinned: false,
      isArchived: false,
      stateVersion: 1,
    })
    expect(page.rows[0].metadata).toEqual(expect.objectContaining({ id: 'two', title: 'Session two' }))
    expect(page.rows[0].metadataDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('detects aggregate duplicates and complete sort ties, scoped duplicates stay eligible', () => {
    seed(stateRepository, 'same', { slot: 1 })
    // Cross-bucket duplicate ids are blocked by the service write path, but
    // historical rows (or direct SQL) can still carry them; the analysis
    // guards pagination against them.
    const row = database.prepare("SELECT body_json, meta_json, created_at, updated_at, message_count, state_version, revision, updated_at_ms FROM sessions WHERE session_id = 'same'").get()
    database.prepare(`INSERT INTO sessions (
      scope, project_id, session_id, title, created_at, updated_at, message_count, state_version,
      archived_at, pinned_at, body_json, meta_json, revision, updated_at_ms
    ) VALUES ('project', 'p1', 'same', 'Session same', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`)
      .run(row.created_at, row.updated_at, row.message_count, row.state_version, row.body_json, row.meta_json, row.revision, row.updated_at_ms)
    seed(stateRepository, 'other', { slot: 2, lastModified: '2026-08-03T00:00:00.000Z' })
    expect(repository.analyzeQuery(query())).toMatchObject({ duplicateSessionIdCount: 1, fullSortKeyTieCount: 1 })
    expect(repository.analyzeQuery(query({ scopeMode: 'global' })).duplicateSessionIdCount).toBe(0)
    expect(repository.listPage(query({ scopeMode: 'project', projectId: 'p1' })).total).toBe(1)
  })

  it('sorts by metadata lastModified (not the wall-clock updated_at)', () => {
    // Backdated session: metadata.lastModified is old while updated_at is now.
    seed(stateRepository, 'backdated', { lastModified: '2020-01-01T00:00:00.000Z' })
    seed(stateRepository, 'fresh', { lastModified: '2026-08-05T00:00:00.000Z' })
    expect(repository.listPage(query({ scopeMode: 'global' })).values.map((value) => value.id)).toEqual(['fresh', 'backdated'])
  })

  it('rejects user-controlled query fields outside the allowlist', () => {
    expect(() => repository.listPage(query({ sort: 'title; DROP TABLE sessions' }))).toThrow(/sort/)
    expect(() => repository.listPage(query({ direction: 'sideways' }))).toThrow(/direction/)
    expect(() => repository.listPage(query({ scopeMode: 'project', projectId: '' }))).toThrow(/projectId/)
    expect(() => repository.listPage(query({ limit: Number.POSITIVE_INFINITY }))).toThrow(/limit/)
    expect(() => repository.listPage(query({ archive: 'sometimes' }))).toThrow(/archive/)
  })

  it('counts sessions and exposes an EXPLAIN QUERY PLAN for debugging', () => {
    seed(stateRepository, 'one', { slot: 1 })
    expect(repository.count()).toBe(1)
    const plan = repository.explainQueryPlan(query({ scopeMode: 'global' })).map((row) => row.detail).join('\n')
    expect(plan).toContain('sessions')
  })
})
