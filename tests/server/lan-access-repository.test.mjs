import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createLanAccessRepository, LAN_TOKEN_MAX_COUNT, lanAccessConfigDigest, normalizeLanAccessConfig } from '../../server/sqlite/lan-access-repository.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'

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

describe('lan-access repository and schema v9', () => {
  let directory
  let database
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-repo-'))
    database = new DatabaseSync(path.join(directory, 'state.sqlite3'))
    database.exec('PRAGMA busy_timeout = 5000')
    applySqliteMigrations(database)
    repository = createLanAccessRepository(createHandle(database), { now })
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('creates schema v9 lan-access tables and rolls a failing v8→v9 migration back without losing F5/F7/F9/F10 data', () => {
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(11)
    expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().at(-1)).toEqual({
      version: 11,
      name: 'session_state_v2_storage',
    })
    for (const table of ['lan_access_state', 'lan_access_tokens', 'lan_access_storage_state', 'lan_access_maintenance_lock', 'lan_access_json_mirror_queue']) {
      expect(database.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name=?`).get(table)).toBeDefined()
    }
    expect(database.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='lan_access_tokens_issued_idx'").get()).toBeDefined()

    // v8 database with F5 (scheduled runs), F7 (session index), F9 (session
    // states + messages) and F10 (shares + tokens) data; a failing v9 must
    // roll back fully without touching any of them.
    database.close()
    const rollbackPath = path.join(directory, 'rollback.sqlite3')
    database = new DatabaseSync(rollbackPath)
    applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 8) })
    database.prepare(`INSERT INTO scheduled_task_runs (task_id, id, status, started_at, extra_json, source, updated_at)
      VALUES ('task', 'run', 'success', '2026-01-01T00:00:00.000Z', '{}', 'test', '2026-01-01T00:00:00.000Z')`).run()
    database.prepare(`INSERT INTO session_index (scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at)
      VALUES ('global', '', 'legacy', 0, 0, '{}', ?, '2026-01-01T00:00:00.000Z')`).run('a'.repeat(64))
    // Seed the v8-era session domain directly (the v2 session repository
    // speaks schema v11 only); a failing v9 must roll back without touching
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
    const shareRepository = createShareRepository(createHandle(database), { now })
    shareRepository.create(share(), { expectedRevision: 0 })

    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 9
      ? { ...migration, up(db) { migration.up(db); throw new Error('after-v9') } }
      : migration)
    expect(() => applySqliteMigrations(database, { migrations: failing })).toThrow(/migration 9.*after-v9/)
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(8)
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='lan_access_state'").get()).toBeUndefined()
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='lan_access_tokens'").get()).toBeUndefined()
    expect(database.prepare('SELECT task_id, id FROM scheduled_task_runs').all()).toEqual([{ task_id: 'task', id: 'run' }])
    expect(database.prepare('SELECT session_id FROM session_index ORDER BY session_id').all()).toEqual([
      { session_id: 'legacy' },
      { session_id: 'legacy-session' },
    ])
    expect(database.prepare('SELECT session_id, revision FROM session_states').all()).toEqual([{ session_id: 'legacy-session', revision: 1 }])
    expect(database.prepare('SELECT COUNT(*) AS count FROM share_sessions').get().count).toBe(1)
  })

  it('applies settings changes and clears tokens atomically in one transaction', () => {
    const created = repository.updateSettings(
      { enabled: true, passwordHash: 'hash-one', passwordSalt: 'salt-one', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    expect(created.revision).toBe(1)
    expect(created.config).toMatchObject({ enabled: true, authVersion: 2, sessionTtlHours: 12 })

    const issued = repository.issueToken({ remoteAddress: '::ffff:192.168.1.20', userAgent: 'Browser One' })
    expect(repository.getConfig().tokens).toHaveLength(1)

    // A password change bumps authVersion and clears every token in the same
    // transaction: the issued token must be invalid immediately after commit.
    const updated = repository.updateSettings(
      { passwordHash: 'hash-two', passwordSalt: 'salt-two', passwordVersion: 1 },
      { expectedRevision: issued.revision },
    )
    expect(updated.config.authVersion).toBe(3)
    expect(updated.config.tokens).toEqual([])
    expect(repository.getConfig().tokens).toEqual([])
    expect(repository.verifyToken(issued.token)).toBe(false)
  })

  it('enforces the ≤100 token cap keeping the newest entries and prunes expired tokens', () => {
    repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    let revision = 1
    const issued = []
    for (let index = 0; index < LAN_TOKEN_MAX_COUNT + 5; index += 1) {
      const result = repository.issueToken({ remoteAddress: `192.168.1.${index}`, userAgent: `Agent ${index}` }, { expectedRevision: revision })
      issued.push(result)
      revision = result.revision
    }
    const config = repository.getConfig()
    expect(config.tokens).toHaveLength(LAN_TOKEN_MAX_COUNT)
    // The newest token survived the trim and verifies; the first issued token
    // was evicted so its secret no longer matches any stored hash.
    expect(repository.verifyToken(issued[issued.length - 1].token)).toBe(true)
    expect(repository.verifyToken(issued[0].token)).toBe(false)

    // Manually expiring the newest stored token fails verification.
    const newestId = config.tokens[config.tokens.length - 1].id
    database.prepare('UPDATE lan_access_tokens SET expires_at = ? WHERE token_id = ?').run('2020-01-01T00:00:00.000Z', newestId)
    expect(repository.verifyToken(issued[issued.length - 1].token)).toBe(false)
  })

  it('verifyToken fails closed on version mismatch, hash mismatch and disabled config', () => {
    repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    const issued = repository.issueToken({})
    const [version, secret] = issued.token.split('.')

    expect(repository.verifyToken(issued.token)).toBe(true)
    expect(repository.verifyToken(`${Number(version) + 1}.${secret}`)).toBe(false)
    expect(repository.verifyToken(`${version}.wrong-secret`)).toBe(false)
    expect(repository.verifyToken(`${version}.`)).toBe(false)
    expect(repository.verifyToken(secret)).toBe(false)
    expect(repository.verifyToken('')).toBe(false)
    expect(repository.verifyToken(null)).toBe(false)

    repository.updateSettings({ enabled: false }, { expectedRevision: issued.revision })
    expect(repository.verifyToken(issued.token)).toBe(false)
  })

  it('enforces CAS on settings and revoke-all and blocks stale writers with 409', () => {
    const created = repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    try {
      repository.updateSettings({ sessionTtlHours: 24 }, { expectedRevision: 5 })
      throw new Error('expected stale CAS conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'LAN_ACCESS_STATE_CONFLICT', actualRevision: 1 })
    }
    const issued = repository.issueToken({}, { expectedRevision: 1 })
    try {
      repository.revokeAll({ expectedRevision: issued.revision + 1 })
      throw new Error('expected stale revoke-all conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'LAN_ACCESS_STATE_CONFLICT', actualRevision: issued.revision })
    }
    const updated = repository.updateSettings({ sessionTtlHours: 24 }, { expectedRevision: issued.revision })
    expect(updated.revision).toBe(issued.revision + 1)
    expect(updated.config.sessionTtlHours).toBe(24)
  })

  it('revokes a single session by public id, logs out from a cookie token and revokes all', () => {
    repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    const first = repository.issueToken({ remoteAddress: '192.168.1.1' })
    const second = repository.issueToken({ remoteAddress: '192.168.1.2' })

    // Unknown session id: 404, nothing changes.
    expect(() => repository.revokeTokenById('does-not-exist')).toThrow(/not found/)
    expect(repository.getConfig().tokens).toHaveLength(2)

    const firstId = repository.getConfig().tokens[0].id
    repository.revokeTokenById(firstId)
    expect(repository.getConfig().tokens).toHaveLength(1)
    expect(repository.verifyToken(first.token)).toBe(false)
    expect(repository.verifyToken(second.token)).toBe(true)

    // Logout revoke takes the raw cookie token and is version-gated.
    expect(repository.revokeToken(`999.${second.token.split('.')[1]}`)).toBe(false)
    expect(repository.revokeToken(second.token)).toBe(true)
    expect(repository.verifyToken(second.token)).toBe(false)
    expect(repository.revokeToken(second.token)).toBe(false)

    const issued = repository.issueToken({ remoteAddress: '192.168.1.3' })
    const revoked = repository.revokeAll({ expectedRevision: issued.revision })
    expect(revoked.config.authVersion).toBe(issued.config.authVersion + 1)
    expect(revoked.config.tokens).toEqual([])
    expect(repository.verifyToken(issued.token)).toBe(false)
  })

  it('roundtrips exportSnapshot through replaceAll with exact digests and keeps hashes opaque', () => {
    repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    const issued = repository.issueToken({ remoteAddress: '192.168.1.9', userAgent: 'Roundtrip' })
    const secret = issued.token.split('.')[1]

    const snapshot = repository.exportSnapshot()
    expect(snapshot.tokenCount).toBe(1)
    expect(snapshot.config.tokens[0].tokenHash).not.toContain(secret)
    expect(snapshot.config.tokens[0]).toMatchObject({ remoteAddress: '192.168.1.9', userAgent: 'Roundtrip' })

    repository.replaceAll(snapshot.config, { expectedCount: snapshot.tokenCount, expectedDigest: snapshot.digest })
    const after = repository.exportSnapshot()
    expect(after.digest).toBe(snapshot.digest)
    expect(after.config.tokens).toHaveLength(1)
    expect(repository.verifyToken(issued.token)).toBe(true)
  })

  it('roundtrips unknown config fields and rejects mismatched replace counts/digests', () => {
    const snapshot = repository.exportSnapshot()
    const withUnknown = { ...snapshot.config, custom: { nested: true, kept: 'value' } }
    repository.replaceAll(withUnknown)
    expect(repository.getConfig().custom).toEqual({ nested: true, kept: 'value' })
    expect(repository.exportSnapshot().config.custom).toEqual({ nested: true, kept: 'value' })

    const second = repository.exportSnapshot()
    expect(() => repository.replaceAll(second.config, { expectedCount: 99 })).toThrow(/count verification failed/)
    expect(() => repository.replaceAll(second.config, { expectedDigest: 'a'.repeat(64) })).toThrow(/digest verification failed/)
  })

  it('keeps mirror queue entries in sync with transactions and rolls them back on failure', () => {
    const created = repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    let entries = repository.listMirrorQueue()
    expect(entries).toHaveLength(1)
    expect(entries[0].operation).toBe('upsert')
    expect(entries[0].config).toMatchObject({ enabled: true })
    expect(entries[0].config).not.toHaveProperty('revision')

    // A failed transaction must not leave a newer mirror entry behind.
    try {
      repository.updateSettings({ sessionTtlHours: 99 }, { expectedRevision: 5 })
      throw new Error('expected CAS conflict')
    } catch {
      /* expected */
    }
    expect(repository.listMirrorQueue()).toHaveLength(1)
    expect(repository.listMirrorQueue()[0].config.sessionTtlHours).toBe(12)

    expect(repository.acknowledgeMirror(entries[0])).toBe(true)
    expect(repository.listMirrorQueue()).toEqual([])

    const issued = repository.issueToken({}, { expectedRevision: created.revision })
    repository.failMirror(repository.listMirrorQueue()[0], new Error('disk full'))
    expect(repository.listMirrorQueue()).toMatchObject([{ attempts: 1, lastError: 'disk full', config: { tokens: [{ id: issued.config.tokens[0].id }] } }])
  })

  it('exposes count and a stable digest that includes tokens', () => {
    repository.updateSettings(
      { enabled: true, passwordHash: 'hash', passwordSalt: 'salt', passwordVersion: 1, sessionTtlHours: 12 },
      { expectedRevision: 0 },
    )
    expect(repository.count()).toBe(0)
    const first = repository.issueToken({})
    const before = repository.digest()
    expect(repository.count()).toBe(1)
    const second = repository.issueToken({}, { expectedRevision: first.revision })
    expect(repository.digest()).not.toBe(before)
    expect(repository.digest()).toBe(lanAccessConfigDigest(repository.getConfig()))
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2, invalidDigests: 0, overLimitTokens: 0 })
    expect(repository.verifyIntegrity().digest).toBe(repository.digest())
  })

  it('normalizes legacy tokens without an id deterministically', () => {
    const normalized = normalizeLanAccessConfig({
      enabled: true,
      passwordHash: 'hash',
      passwordSalt: 'salt',
      passwordVersion: 1,
      authVersion: 1,
      sessionTtlHours: 12,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tokens: [{ tokenHash: 'legacy-hash', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z' }],
    })
    expect(normalized.tokens[0].id).toMatch(/^legacy_/)
    expect(normalized.tokens[0].issuedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(normalizeLanAccessConfig({
      enabled: false,
      authVersion: 1,
      sessionTtlHours: 12,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tokens: [],
    })).toMatchObject({ enabled: false, passwordHash: undefined, authVersion: 1 })
  })
})
