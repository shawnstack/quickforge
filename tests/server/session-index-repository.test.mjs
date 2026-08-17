import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'

function createHandle(database) {
  let depth = 0
  const handle = {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
    transaction(callback) {
      const savepoint = `test_sp_${depth}`
      if (depth === 0) database.exec('BEGIN IMMEDIATE')
      else database.exec(`SAVEPOINT ${savepoint}`)
      depth += 1
      try {
        const result = callback(handle)
        depth -= 1
        if (depth === 0) database.exec('COMMIT')
        else database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return result
      } catch (error) {
        depth -= 1
        if (depth === 0) database.exec('ROLLBACK')
        else database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`)
        throw error
      }
    },
  }
  return handle
}

function row(scope, projectId, sessionId, overrides = {}) {
  const metadata = {
    id: sessionId,
    title: `Session ${sessionId}`,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    ...overrides.metadata,
  }
  return {
    scope,
    projectId,
    sessionId,
    createdAt: null,
    lastModified: '2026-08-17T00:00:00.000Z',
    messageCount: 1,
    pinnedAt: null,
    archivedAt: null,
    stateVersion: null,
    metadata,
    metadataDigest: overrides.metadataDigest ?? 'a'.repeat(64),
    indexedAt: '2026-08-17T01:00:00.000Z',
    ...overrides,
    metadata,
  }
}

describe('session index migration v4 and repository', () => {
  let directory
  let database
  let storage
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-repo-'))
    database = new DatabaseSync(path.join(directory, 'index.sqlite3'))
    applySqliteMigrations(database)
    storage = createHandle(database)
    repository = createSessionIndexRepository(storage)
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('creates constrained schema and stable bucket/partial indexes on a new database', () => {
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(9)
    expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().at(-1))
      .toEqual({ version: 9, name: 'lan_access_storage_migration' })
    const columns = database.prepare('PRAGMA table_info(session_index)').all()
    expect(columns.find((column) => column.name === 'scope')).toMatchObject({ pk: 1, notnull: 1 })
    expect(columns.find((column) => column.name === 'project_id')).toMatchObject({ pk: 2, notnull: 1 })
    expect(columns.find((column) => column.name === 'session_id')).toMatchObject({ pk: 3, notnull: 1 })
    const indexes = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'session_index' AND sql IS NOT NULL ORDER BY name").all()
    expect(indexes.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'session_index_archived_idx',
      'session_index_created_idx',
      'session_index_modified_idx',
      'session_index_pinned_idx',
    ]))
    expect(indexes.find((entry) => entry.name === 'session_index_pinned_idx').sql).toContain('WHERE is_pinned = 1')
    expect(() => database.prepare(`INSERT INTO session_index (
      scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at
    ) VALUES ('global', 'not-empty', 'bad', 0, 0, '{}', ?, 'now')`).run('a'.repeat(64))).toThrow()
  })

  it('rolls back v3 to v4 failure without changing the scheduled-runs schema or data', () => {
    database.close()
    const rollbackPath = path.join(directory, 'rollback.sqlite3')
    database = new DatabaseSync(rollbackPath)
    applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 3) })
    database.prepare(`INSERT INTO scheduled_task_runs (
      task_id, id, status, started_at, extra_json, source, updated_at
    ) VALUES (?, ?, ?, ?, '{}', ?, ?)`).run('task', 'run', 'success', '2026-01-01T00:00:00.000Z', 'test', '2026-01-01T00:00:00.000Z')
    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 4
      ? { ...migration, up(db) { migration.up(db); throw new Error('after session index') } }
      : migration)

    expect(() => applySqliteMigrations(database, { migrations: failing })).toThrow(/migration 4.*after session index/)
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(3)
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'session_index'").get()).toBeUndefined()
    expect(database.prepare('SELECT task_id, id FROM scheduled_task_runs').all()).toEqual([{ task_id: 'task', id: 'run' }])
  })

  it('supports composite-key CRUD, atomic changes, bucket replace, full replace, count and verification', () => {
    repository.upsert(row('global', null, 'same'))
    repository.upsert(row('project', 'project-a', 'same', { metadataDigest: 'b'.repeat(64) }))
    expect(repository.count()).toBe(2)
    expect(repository.get('global', null, 'same').metadata.title).toBe('Session same')
    expect(repository.get('project', 'project-a', 'same').metadataDigest).toBe('b'.repeat(64))

    repository.applyChanges({
      deletes: [{ scope: 'global', projectId: null, sessionId: 'same' }],
      upserts: [row('project', 'project-a', 'next', { pinnedAt: '2026-08-17T02:00:00.000Z', metadataDigest: 'c'.repeat(64) })],
    })
    expect(repository.get('global', null, 'same')).toBeNull()
    expect(repository.get('project', 'project-a', 'next')).toMatchObject({ isPinned: true })

    repository.replaceBucket('project', 'project-a', [row('project', 'project-a', 'only', { archivedAt: '2026-08-17T03:00:00.000Z' })])
    expect(repository.count()).toBe(1)
    expect(repository.get('project', 'project-a', 'only')).toMatchObject({ isArchived: true })

    repository.replaceAll([
      row('global', null, 'shared'),
      row('project', 'project-b', 'shared', { metadataDigest: 'd'.repeat(64) }),
    ])
    expect(repository.listVerification()).toEqual([
      { scope: 'global', projectId: null, sessionId: 'shared', metadataDigest: 'a'.repeat(64) },
      { scope: 'project', projectId: 'project-b', sessionId: 'shared', metadataDigest: 'd'.repeat(64) },
    ])
    expect(() => repository.replaceAll([row('global', null, 'duplicate'), row('global', null, 'duplicate')])).toThrow(/Duplicate/)
    expect(repository.count()).toBe(2)
    expect(repository.delete('project', 'project-b', 'shared')).toBe(true)
  })
})
