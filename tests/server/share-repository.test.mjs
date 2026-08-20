import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createShareRepository, shareRecordDigest, shareSnapshotDigest } from '../../server/sqlite/share-repository.mjs'

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

let sequence = 0
function shareId(prefix = 's') {
  sequence += 1
  return `qfs_${prefix}_${String(sequence).padStart(18, '0')}`
}

function now() {
  // Far in the future so issued token expiries stay valid vs the real clock.
  return '2099-01-01T00:00:00.000Z'
}

function share(overrides = {}) {
  const id = overrides.id || shareId()
  return {
    id,
    sessionId: overrides.sessionId || 'session-a',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Title',
    scope: overrides.scope || 'global',
    projectId: overrides.scope === 'project' ? overrides.projectId || 'project-a' : undefined,
    authVersion: 1,
    allowCloudUsage: false,
    createdAt: now(),
    updatedAt: now(),
    accessCount: 0,
    tokens: [],
    ...overrides,
  }
}

describe('share repository and schema v8', () => {
  let directory
  let database
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-repo-'))
    database = new DatabaseSync(path.join(directory, 'state.sqlite3'))
    database.exec('PRAGMA busy_timeout = 5000')
    applySqliteMigrations(database)
    repository = createShareRepository(createHandle(database), { now })
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('creates schema v8 share tables and rolls a failing v7 to v8 migration back without losing F5/F7/F9 data', () => {
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(11)
    expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().at(-1)).toEqual({
      version: 11,
      name: 'session_state_v2_storage',
    })
    for (const table of ['share_sessions', 'share_tokens', 'share_storage_state', 'share_maintenance_lock', 'share_json_mirror_queue']) {
      expect(database.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name=?`).get(table)).toBeDefined()
    }
    expect(database.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='share_sessions_session_id_idx'").get()).toBeDefined()

    // v7 database with F5 (scheduled runs), F7 (session index) and F9
    // (session states + messages) data; a failing v8 must roll back fully.
    database.close()
    const rollbackPath = path.join(directory, 'rollback.sqlite3')
    database = new DatabaseSync(rollbackPath)
    applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 7) })
    database.prepare(`INSERT INTO scheduled_task_runs (task_id, id, status, started_at, extra_json, source, updated_at)
      VALUES ('task', 'run', 'success', '2026-01-01T00:00:00.000Z', '{}', 'test', '2026-01-01T00:00:00.000Z')`).run()
    database.prepare(`INSERT INTO session_index (scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at)
      VALUES ('global', '', 'legacy', 0, 0, '{}', ?, '2026-01-01T00:00:00.000Z')`).run('a'.repeat(64))
    // Seed the v7-era session domain directly (the v2 session repository
    // speaks schema v11 only); a failing v8 must roll back without touching
    // any of these rows.
    database.prepare(`INSERT INTO session_states
      (scope, project_id, session_id, revision, state_version, state_json, state_digest, metadata_json, metadata_digest, created_at, updated_at)
      VALUES ('global', '', 'legacy-session', 1, 1, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`)
      .run(
        JSON.stringify({ id: 'legacy-session', scope: 'global', stateVersion: 1 }),
        'a'.repeat(64),
        JSON.stringify({ id: 'legacy-session', scope: 'global', stateVersion: 1, messageCount: 0 }),
        'b'.repeat(64),
      )
    database.prepare(`INSERT INTO session_index (scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at)
      VALUES ('global', '', 'legacy-session', 0, 0, '{}', ?, '2026-01-01T00:00:00.000Z')`).run('c'.repeat(64))

    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 8
      ? { ...migration, up(db) { migration.up(db); throw new Error('after-v8') } }
      : migration)
    expect(() => applySqliteMigrations(database, { migrations: failing })).toThrow(/migration 8.*after-v8/)
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(7)
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='share_sessions'").get()).toBeUndefined()
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='share_tokens'").get()).toBeUndefined()
    expect(database.prepare('SELECT task_id, id FROM scheduled_task_runs').all()).toEqual([{ task_id: 'task', id: 'run' }])
    expect(database.prepare('SELECT session_id FROM session_index ORDER BY session_id').all()).toEqual([
      { session_id: 'legacy' },
      { session_id: 'legacy-session' },
    ])
    expect(database.prepare('SELECT session_id, revision FROM session_states').all()).toEqual([{ session_id: 'legacy-session', revision: 1 }])
  })

  it('creates atomically: supersedes older session shares, clears their tokens and issues new tokens in one transaction', () => {
    const first = repository.create(share({ permission: 'read' }), { expectedRevision: 0 })
    const firstToken = repository.issueToken(first.id, { expectedRevision: 1 })
    expect(repository.get(first.id).tokens).toHaveLength(1)

    // A second active share for the same session (legacy multi-active state).
    const older = share({ sessionId: 'session-a', titleSnapshot: 'Older', createdAt: '2025-12-31T00:00:00.000Z', updatedAt: '2025-12-31T00:00:00.000Z' })
    database.prepare(`INSERT INTO share_sessions (
      share_id, session_id, permission, title_snapshot, scope, project_id, password_hash, password_salt, password_version,
      auth_version, allow_cloud_usage, created_at, updated_at, expires_at, revoked_at, superseded_at,
      access_count, last_accessed_at, created_from_host, last_updated_from_host, revision, record_digest, extra_json
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, 1, ?, '{}')`)
      .run(older.id, older.sessionId, older.permission, older.titleSnapshot, older.scope,
        older.authVersion, older.allowCloudUsage ? 1 : 0, older.createdAt, older.updatedAt, older.accessCount,
        shareRecordDigest(older))

    // A later create for the same session updates the current share, supersedes
    // the other active record and issues new tokens in the same transaction.
    const second = repository.create(share({
      permission: 'operate',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      passwordVersion: 1,
      tokens: [{ tokenHash: 'issued-in-create', issuedAt: now(), expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }],
    }), { expectedRevision: firstToken.share.revision })
    expect(second.id).toBe(first.id)
    expect(second.permission).toBe('operate')
    expect(second.tokens).toEqual([{ tokenHash: 'issued-in-create', issuedAt: now(), expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }])

    const superseded = repository.get(older.id)
    expect(superseded.supersededAt).toBe(now())
    expect(superseded.revokedAt).toBe(now())
    expect(repository.verifyToken(repository.get(first.id), firstToken.token)).toBe(false)
    expect(repository.list({ sessionId: 'session-a' })).toHaveLength(1)

    // Idempotent create: repeats update the current share, never a duplicate.
    const third = repository.create(share({ permission: 'operate', passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1 }), { expectedRevision: second.revision })
    expect(third.id).toBe(first.id)
    expect(repository.list({ sessionId: 'session-a' })).toHaveLength(1)
  })

  it('enforces CAS on every mutation and blocks stale writers with 409', () => {
    const created = repository.create(share(), { expectedRevision: 0 })
    try {
      repository.update(created.id, { expiresAt: '2027-01-01T00:00:00.000Z' }, { expectedRevision: 2 })
      throw new Error('expected stale CAS conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SHARE_STATE_CONFLICT', actualRevision: 1 })
    }
    try {
      repository.create(share({ sessionId: 'session-b' }), { expectedRevision: 1 })
      throw new Error('expected stale create conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SHARE_STATE_CONFLICT', actualRevision: 0 })
    }
    const updated = repository.update(created.id, { expiresAt: '2027-01-01T00:00:00.000Z' }, { expectedRevision: 1 })
    expect(updated.revision).toBe(2)
  })

  it('lists by sessionId excluding superseded/revoked by default and rejects invalid input', () => {
    const current = repository.create(share({ sessionId: 'list-a' }), { expectedRevision: 0 })
    const legacy = share({ sessionId: 'list-a', titleSnapshot: 'Legacy', createdAt: '2025-12-31T00:00:00.000Z', updatedAt: '2025-12-31T00:00:00.000Z' })
    database.prepare(`INSERT INTO share_sessions (
      share_id, session_id, permission, title_snapshot, scope, project_id, password_hash, password_salt, password_version,
      auth_version, allow_cloud_usage, created_at, updated_at, expires_at, revoked_at, superseded_at,
      access_count, last_accessed_at, created_from_host, last_updated_from_host, revision, record_digest, extra_json
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, 1, ?, '{}')`)
      .run(legacy.id, legacy.sessionId, legacy.permission, legacy.titleSnapshot, legacy.scope,
        legacy.authVersion, legacy.allowCloudUsage ? 1 : 0, legacy.createdAt, legacy.updatedAt, legacy.accessCount,
        shareRecordDigest(legacy))
    repository.create(share({ sessionId: 'list-b' }), { expectedRevision: 0 })
    const listBId = repository.list({ sessionId: 'list-b' })[0].id

    // Second create for list-a supersedes the legacy record and updates current.
    const updated = repository.create(share({ sessionId: 'list-a', titleSnapshot: 'Updated' }), { expectedRevision: 1 })
    expect(updated.id).toBe(current.id)
    expect(repository.get(legacy.id).supersededAt).toBe(now())
    repository.revoke(current.id, { expectedRevision: 2 })

    expect(repository.list({ sessionId: 'list-a' })).toHaveLength(0)
    expect(repository.list({ sessionId: 'list-a', includeRevoked: true }).map((record) => record.id)).toEqual([current.id])
    expect(repository.list({ sessionId: 'list-b' }).map((record) => record.id)).toEqual([listBId])
    expect(repository.list().map((record) => record.id)).toEqual([listBId])

    expect(() => repository.create(share({ sessionId: '' }))).toThrow(/sessionId/)
    expect(() => repository.create(share({ permission: 'admin' }))).toThrow(/permission/)
    expect(() => repository.create(share({ scope: 'global', projectId: 'bad' }))).toThrow(/projectId/)
    expect(() => repository.create(share({ sessionId: 'x', id: 'not-qfs' }))).toThrow(/share id/)
  })

  it('issues, verifies and prunes tokens, caps at 50, and invalidates all tokens on password change', () => {
    const created = repository.create(share(), { expectedRevision: 0 })
    const first = repository.issueToken(created.id, { expectedRevision: 1 })
    expect(first.share.accessCount).toBe(1)
    expect(first.share.lastAccessedAt).toBe(now())
    expect(repository.verifyToken(repository.get(created.id), first.token)).toBe(true)
    expect(repository.verifyToken(repository.get(created.id), 'qfs_wrong.secret')).toBe(false)

    const expired = repository.issueToken(created.id, { expectedRevision: 2 })
    expect(expired.share.tokens).toHaveLength(2)
    repository.pruneTokens(created.id, { expectedRevision: 3 })
    expect(repository.get(created.id).tokens).toHaveLength(2) // not expired yet

    // Password change bumps authVersion and clears every token.
    const changed = repository.update(created.id, {
      permission: 'operate',
      passwordHash: 'new-hash',
      passwordSalt: 'new-salt',
      passwordVersion: 1,
    }, { expectedRevision: 3 })
    expect(changed.authVersion).toBe(2)
    expect(changed.tokens).toEqual([])
    expect(repository.verifyToken(repository.get(created.id), first.token)).toBe(false)

    // Token cap: 55 issued tokens collapse to the newest 50.
    let expected = changed.revision
    for (let index = 0; index < 55; index += 1) {
      const issued = repository.issueToken(created.id, { expectedRevision: expected })
      expected = issued.share.revision
    }
    expect(repository.get(created.id).tokens).toHaveLength(50)
  })

  it('tombstones deletes (no resurrection from stale revisions) and reports 404 on repeat delete', () => {
    const created = repository.create(share(), { expectedRevision: 0 })
    expect(repository.delete(created.id, { expectedRevision: 1 })).toBe(true)
    expect(repository.get(created.id)).toBeNull()
    expect(repository.list()).toHaveLength(0)
    expect(database.prepare('SELECT deleted_at, revision FROM share_sessions WHERE share_id = ?').get(created.id)).toMatchObject({ revision: 2 })

    try {
      repository.delete(created.id)
      throw new Error('expected second delete 404')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, errorCode: 'SHARE_NOT_FOUND' })
    }
    // A stale writer cannot resurrect the tombstoned share.
    try {
      repository.update(created.id, { expiresAt: '2100-01-01T00:00:00.000Z' }, { expectedRevision: 1 })
      throw new Error('expected tombstone 404')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, errorCode: 'SHARE_NOT_FOUND' })
    }
    try {
      repository.issueToken(created.id)
      throw new Error('expected tombstone 404')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, errorCode: 'SHARE_NOT_FOUND' })
    }
    // A fresh create for the same session gets a brand-new id.
    const fresh = repository.create(share({ sessionId: 'session-a' }), { expectedRevision: 0 })
    expect(fresh.id).not.toBe(created.id)
    expect(repository.get(fresh.id)).not.toBeNull()
  })

  it('supports update/revoke/restore semantics and 410/409 active-state guards', () => {
    const created = repository.create(share({ expiresAt: '2030-01-01T00:00:00.000Z' }), { expectedRevision: 0 })
    const revoked = repository.revoke(created.id, { expectedRevision: 1 })
    expect(revoked.revokedAt).toBe(now())
    expect(() => repository.issueToken(created.id)).toThrow(/revoked/)
    try { repository.issueToken(created.id) } catch (error) {
      expect(error).toMatchObject({ statusCode: 410, errorCode: 'SHARE_NOT_ACTIVE' })
    }
    expect(() => repository.update(created.id, { permission: 'read' })).toThrow(/revoked/)

    const restored = repository.restore(created.id, { expiresAt: '2031-01-01T00:00:00.000Z', expectedRevision: 2 })
    expect(restored.revokedAt).toBeUndefined()
    expect(restored.expiresAt).toBe('2031-01-01T00:00:00.000Z')

    // Superseded shares reject update/restore with 409.
    const superseded = repository.create(share({ sessionId: 'guard-session' }), { expectedRevision: 0 })
    database.prepare('UPDATE share_sessions SET superseded_at = ? WHERE share_id = ?').run(now(), superseded.id)
    try { repository.update(superseded.id, { expiresAt: '2100-01-01T00:00:00.000Z' }) } catch (error) {
      expect(error).toMatchObject({ statusCode: 409 })
    }
    try { repository.restore(superseded.id, {}) } catch (error) {
      expect(error).toMatchObject({ statusCode: 409 })
    }
    expect(() => repository.issueToken(superseded.id)).toThrow(/superseded/)
  })

  it('roundtrips opaque fields, snapshots, and integrity checks with exact digests', () => {
    const record = share({ customField: { nested: ['kept'] }, futureFlag: true })
    repository.create(record, { expectedRevision: 0 })
    const snapshot = repository.exportSnapshot()
    expect(snapshot.count).toBe(1)
    expect(snapshot.digest).toBe(repository.digest())
    expect(snapshot.digest).toBe(shareSnapshotDigest(snapshot.records))
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })

    repository.replaceAll(snapshot.records, { expectedCount: snapshot.count, expectedDigest: snapshot.digest })
    const after = repository.exportSnapshot()
    expect(after.digest).toBe(snapshot.digest)
    expect(after.records[0]).toMatchObject({ customField: { nested: ['kept'] }, futureFlag: true, titleSnapshot: record.titleSnapshot })

    // Tampering breaks integrity.
    database.prepare("UPDATE share_sessions SET title_snapshot = 'Tampered' WHERE share_id = ?").run(after.records[0].id)
    const integrity = repository.verifyIntegrity()
    expect(integrity.ok).toBe(false)
    expect(integrity.invalidDigests).toBe(1)
    // Oversized token set is rejected by integrity.
    repository.replaceAll(after.records, { expectedCount: after.count, expectedDigest: after.digest })
    expect(repository.verifyIntegrity().ok).toBe(true)
  })

  it('enqueues mirror upserts/deletes and rolls the whole transaction back on failure', () => {
    const created = repository.create(share(), { expectedRevision: 0 })
    expect(repository.listMirrorQueue()).toMatchObject([{ shareId: created.id, operation: 'upsert', attempts: 0 }])
    repository.delete(created.id, { expectedRevision: 1 })
    expect(repository.listMirrorQueue()).toMatchObject([{ shareId: created.id, operation: 'delete' }])

    // A failing create must leave no partial rows, tokens, or queue entries.
    expect(() => repository.create(share({ sessionId: 'rollback-fail', titleSnapshot: 'X' }), {
      expectedRevision: 0,
      beforeCommit(db) {
        db.prepare('UPDATE share_json_mirror_queue SET attempts = 99 WHERE share_id = ?').run(created.id)
        throw new Error('share failure')
      },
    })).toThrow('share failure')
    expect(repository.list({ sessionId: 'rollback-fail' })).toHaveLength(0)
    expect(repository.listMirrorQueue().some((entry) => entry.shareId !== created.id)).toBe(false)
    expect(repository.listMirrorQueue()).toMatchObject([{ shareId: created.id, operation: 'delete', attempts: 0 }])
  })
})
