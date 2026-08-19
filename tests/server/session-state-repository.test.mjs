import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository, MIRROR_MAX_ATTEMPTS } from '../../server/sqlite/session-state-repository.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const workerScript = path.join(projectRoot, 'tests', 'fixtures', 'session-state-cas-worker.mjs')

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

function record(sessionId = 'session-a', overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  return {
    scope,
    projectId,
    sessionId,
    stateVersion: 7,
    state: {
      id: sessionId,
      scope,
      ...(scope === 'project' ? { projectId } : {}),
      stateVersion: 7,
      messages: [{ role: 'user', content: 'hello', unknownMessageField: { keep: true } }],
      unknownStateField: { nested: ['kept'] },
    },
    metadata: {
      id: sessionId,
      scope,
      ...(scope === 'project' ? { projectId } : {}),
      stateVersion: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-01T00:00:01.000Z',
      messageCount: 1,
      unknownMetadataField: { kept: 1 },
    },
  }
}

function spawnWorker(databasePath, sessionId, expectedRevision, marker) {
  const child = spawn(process.execPath, [workerScript, databasePath, sessionId, String(expectedRevision), marker], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QUICKFORGE_LOG_LEVEL: 'ERROR' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CAS worker timed out: ${stderr}`))
    }, 15_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`CAS worker failed (${code}): ${stderr}`))
      else resolve(JSON.parse(stdout.trim()))
    })
  })
}

describe('session state repository and schema v7', () => {
  let directory
  let databasePath
  let database
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-state-repo-'))
    databasePath = path.join(directory, 'state.sqlite3')
    database = new DatabaseSync(databasePath)
    database.exec('PRAGMA busy_timeout = 5000')
    applySqliteMigrations(database)
    repository = createSessionStateRepository(createHandle(database), { now: () => '2026-01-01T00:00:02.000Z' })
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('creates schema v8 and rolls a failing v5 to v6 migration back without losing F5/F7 data', () => {
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(9)
    expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().at(-1)).toEqual({
      version: 9,
      name: 'lan_access_storage_migration',
    })
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'session_state%' ORDER BY name").all().map((row) => row.name)).toEqual([
      'session_state_maintenance_lock',
      'session_state_tombstones',
      'session_states',
    ])
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='session_messages'").get()).toBeDefined()

    database.close()
    database = new DatabaseSync(path.join(directory, 'rollback.sqlite3'))
    applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 5) })
    database.prepare(`INSERT INTO scheduled_task_runs (task_id, id, status, started_at, extra_json, source, updated_at)
      VALUES ('task', 'run', 'success', '2026-01-01T00:00:00.000Z', '{}', 'test', '2026-01-01T00:00:00.000Z')`).run()
    database.prepare(`INSERT INTO session_index (scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at)
      VALUES ('global', '', 'legacy', 0, 0, '{}', ?, '2026-01-01T00:00:00.000Z')`).run('a'.repeat(64))
    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 6
      ? { ...migration, up(db) { migration.up(db); throw new Error('after-v6') } }
      : migration)
    expect(() => applySqliteMigrations(database, { migrations: failing })).toThrow(/migration 6.*after-v6/)
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(5)
    expect(database.prepare('SELECT task_id, id FROM scheduled_task_runs').all()).toEqual([{ task_id: 'task', id: 'run' }])
    expect(database.prepare('SELECT session_id FROM session_index').all()).toEqual([{ session_id: 'legacy' }])
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='session_states'").get()).toBeUndefined()
  })

  it('rolls a failing v6 to v7 migration back without losing v6 session data', () => {
    database.close()
    database = new DatabaseSync(path.join(directory, 'v7-rollback.sqlite3'))
    applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 6) })
    const v6Repository = createSessionStateRepository(createHandle(database), { now: () => '2026-01-01T00:00:02.000Z' })
    const saved = v6Repository.save(record('v6-session'), { expectedRevision: 0 })
    expect(saved.revision).toBe(1)

    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 7
      ? { ...migration, up(db) { migration.up(db); throw new Error('after-v7') } }
      : migration)
    expect(() => applySqliteMigrations(database, { migrations: failing })).toThrow(/migration 7.*after-v7/)
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(6)
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='session_messages'").get()).toBeUndefined()
    expect(database.prepare('SELECT session_id, revision FROM session_states').all()).toEqual([{ session_id: 'v6-session', revision: 1 }])
    expect(database.prepare('SELECT session_id FROM session_index').all()).toEqual([{ session_id: 'v6-session' }])
  })

  it('atomically writes body, index and outbox, preserves opaque fields, and rolls all back on index/outbox failure', () => {
    const saved = repository.save(record(), { expectedRevision: 0 })
    expect(saved.revision).toBe(1)
    expect(repository.get('global', null, 'session-a')).toMatchObject({
      state: { unknownStateField: { nested: ['kept'] }, messages: [{ unknownMessageField: { keep: true } }] },
      metadata: { unknownMetadataField: { kept: 1 } },
    })
    expect(saved.stateDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(database.prepare('SELECT metadata_digest FROM session_index WHERE session_id = ?').get('session-a').metadata_digest).toBe(saved.metadataDigest)
    expect(repository.listMirrorQueue()).toMatchObject([{ sessionId: 'session-a', operation: 'upsert', revision: 1 }])

    expect(() => repository.save(record('index-fail'), {
      expectedRevision: 0,
      beforeCommit(db) { db.prepare('DELETE FROM session_index WHERE session_id = ?').run('index-fail'); throw new Error('index failure') },
    })).toThrow('index failure')
    expect(repository.findBySessionId('index-fail')).toBeNull()
    expect(repository.listMirrorQueue().some((entry) => entry.sessionId === 'index-fail')).toBe(false)

    expect(() => repository.save(record('outbox-fail'), {
      expectedRevision: 0,
      beforeCommit(db) { db.prepare('DELETE FROM session_json_mirror_queue WHERE session_id = ?').run('outbox-fail'); throw new Error('outbox failure') },
    })).toThrow('outbox failure')
    expect(repository.findBySessionId('outbox-fail')).toBeNull()
  })

  it('uses composite keys, detects cross-bucket duplicate IDs, and enforces stable CAS including delete tombstones', () => {
    const first = repository.save(record(), { expectedRevision: 0 })
    try {
      repository.save(record('session-a', { scope: 'project', projectId: 'project-a' }), { expectedRevision: 0 })
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_DUPLICATE_ID' })
    }
    expect(() => repository.save(record(), { expectedRevision: 0 })).toThrow(/conflict/i)
    expect(repository.delete({ scope: 'global', sessionId: 'session-a', expectedRevision: first.revision })).toBe(true)
    expect(database.prepare('SELECT revision FROM session_state_tombstones WHERE session_id = ?').get('session-a').revision).toBe(2)
    try {
      repository.save(record(), { expectedRevision: 1 })
      throw new Error('expected stale save conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_CONFLICT', actualRevision: 2 })
    }
    expect(repository.save(record(), { expectedRevision: 2 }).revision).toBe(3)

    database.exec('DROP INDEX session_states_session_id_idx')
    database.prepare(`INSERT INTO session_states
      (scope, project_id, session_id, revision, state_version, state_json, state_digest, metadata_json, metadata_digest, created_at, updated_at)
      SELECT 'project', 'project-b', session_id, revision, state_version,
        json_set(state_json, '$.scope', 'project', '$.projectId', 'project-b'), state_digest,
        json_set(metadata_json, '$.scope', 'project', '$.projectId', 'project-b'), metadata_digest, created_at, updated_at
      FROM session_states WHERE session_id = 'session-a'`).run()
    expect(() => repository.findBySessionId('session-a')).toThrow(/Duplicate authoritative session id/)
  })

  it('supports atomic multi-record batches, replace/export/integrity/rebuild, and full rollback on batch conflict', () => {
    repository.save(record('one'), { expectedRevision: 0 })
    repository.save(record('two'), { expectedRevision: 0 })
    expect(() => repository.applyBatch({
      upserts: [
        { record: { ...record('one'), state: { ...record('one').state, changed: true } }, expectedRevision: 1 },
        { record: record('two'), expectedRevision: 0 },
      ],
    })).toThrow(/conflict/i)
    expect(repository.findBySessionId('one').revision).toBe(1)

    repository.replaceAll([record('global'), record('project', { scope: 'project', projectId: 'p' })])
    const snapshot = repository.exportSnapshot()
    expect(snapshot.count).toBe(2)
    expect(snapshot.digest).toBe(repository.digest())
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2 })
    database.prepare('DELETE FROM session_index WHERE session_id = ?').run('project')
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, missingIndex: 1 })
    expect(repository.rebuildIndex()).toBe(2)
    expect(repository.verifyIntegrity().ok).toBe(true)
  })

  it('replaceAll enqueues mirror deletes for orphan keys and rejects entries duplicating record keys', () => {
    repository.save(record('existing'), { expectedRevision: 0 })
    repository.replaceAll([record()], {
      mirrorDeletes: [{ scope: 'global', sessionId: 'orphan' }, { scope: 'project', projectId: 'p2', sessionId: 'orphan-p' }],
    })
    expect(repository.listMirrorQueue()).toMatchObject([
      { scope: 'global', projectId: null, sessionId: 'orphan', operation: 'delete', revision: 1, state: null, metadata: null },
      { scope: 'global', projectId: null, sessionId: 'session-a', operation: 'upsert', revision: 1 },
      { scope: 'project', projectId: 'p2', sessionId: 'orphan-p', operation: 'delete', revision: 1, state: null, metadata: null },
    ])
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    expect(() => repository.replaceAll([record()], {
      mirrorDeletes: [{ scope: 'global', sessionId: 'session-a' }],
    })).toThrow(TypeError)
    expect(() => repository.replaceAll([record()], { mirrorDeletes: 'bad' })).toThrow(/mirrorDeletes/)
  })

  it('replaceAllStream produces the exact replaceAll tables for the same records', async () => {
    const records = [record('one'), record('two'), record('three', { scope: 'project', projectId: 'p1' })]
    const mirrorDeletes = [{ scope: 'global', sessionId: 'orphan' }]
    const dump = () => ({
      states: database.prepare('SELECT * FROM session_states ORDER BY session_id').all(),
      index: database.prepare('SELECT * FROM session_index ORDER BY session_id').all(),
      mirror: database.prepare('SELECT * FROM session_json_mirror_queue ORDER BY session_id').all(),
      tombstones: database.prepare('SELECT * FROM session_state_tombstones ORDER BY session_id').all(),
      messages: database.prepare('SELECT * FROM session_messages ORDER BY session_id').all(),
    })
    const count = repository.replaceAll(records, { mirrorDeletes })
    const expected = dump()
    const source = (async function* generate() { for (const entry of records) yield entry })()
    await expect(repository.replaceAllStream(source, {
      expectedCount: count,
      expectedDigest: repository.digest(),
      mirrorDeletes,
    })).resolves.toBe(count)
    expect(dump()).toEqual(expected)
    expect(repository.exportSnapshot()).toMatchObject({ count })
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count })
  })

  it('replaceAllStream rolls the whole transaction back on verification or iterator failure', async () => {
    repository.save(record('existing'), { expectedRevision: 0 })
    await expect(repository.replaceAllStream([record('fresh')], { expectedCount: 2 }))
      .rejects.toThrow('Session state replace count verification failed')
    await expect(repository.replaceAllStream([record('fresh')], { expectedDigest: 'f'.repeat(64) }))
      .rejects.toThrow('Session state replace digest verification failed')
    const exploding = (async function* generate() { yield record('fresh'); throw new Error('iterator exploded') })()
    await expect(repository.replaceAllStream(exploding)).rejects.toThrow('iterator exploded')
    // replaceAll semantics: the tables are wiped first, but a failed run rolls
    // back to the exact pre-existing state (rows and mirror outbox).
    expect(repository.count()).toBe(1)
    expect(repository.findBySessionId('existing')).not.toBeNull()
    expect(repository.listMirrorQueue()).toMatchObject([{ sessionId: 'existing', operation: 'upsert', revision: 1 }])
  })

  it('replaceAllStream validates inputs and imports a large async generator record-by-record', async () => {
    await expect(repository.replaceAllStream(null)).rejects.toThrow(/iterable/)
    await expect(repository.replaceAllStream([record()], { mirrorDeletes: 'bad' })).rejects.toThrow(/mirrorDeletes/)
    await expect(repository.replaceAllStream([record(), record()])).rejects.toThrow(TypeError)
    await expect(repository.replaceAllStream([record()], { mirrorDeletes: [{ scope: 'global', sessionId: 'session-a' }] }))
      .rejects.toThrow(TypeError)

    const records = Array.from({ length: 300 }, (_, index) => record(`bulk-${index}`))
    const source = (async function* generate() { for (const entry of records) yield entry })()
    await expect(repository.replaceAllStream(source)).resolves.toBe(300)
    expect(repository.count()).toBe(300)
    expect(repository.countMirrorQueue()).toBe(300)
    expect(repository.listMirrorQueue({ limit: 5 })).toHaveLength(5)
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true, count: 300 })
  })

  it('quickCheck stays SQL-level lightweight while full verification recomputes row digests', () => {
    repository.replaceAll([record()])
    // Row-level digest corruption is invisible to SQL-level checks...
    database.prepare("UPDATE session_states SET state_digest = ? WHERE session_id = 'session-a'").run('f'.repeat(64))
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true, lightweight: true, digest: null, count: 1, invalidDigests: 0 })
    // ...but the full verification still fail-closes on it.
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, invalidDigests: 1 })

    // SQL-structural corruption (orphan index row) is caught by both modes.
    repository.replaceAll([record()])
    database.prepare(`INSERT INTO session_index (scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at)
      VALUES ('global', '', 'orphan', 0, 0, '{}', ?, '2026-01-01T00:00:00.000Z')`).run('a'.repeat(64))
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: false, lightweight: true, orphanIndex: 1 })
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, orphanIndex: 1 })
  })

  it('paginates the mirror queue by updated_at order and counts it without loading rows', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      repository.save(record(id), { expectedRevision: 0 })
    }
    expect(repository.countMirrorQueue()).toBe(10)
    // Identical updated_at falls back to the scope/project/session ordering.
    expect(repository.listMirrorQueue({ limit: 3 }).map((entry) => entry.sessionId)).toEqual(['a', 'b', 'c'])
    expect(repository.listMirrorQueue()).toHaveLength(10)
    expect(() => repository.listMirrorQueue({ limit: 0 })).toThrow(/positive integer/)
  })

  it('allows exactly one multi-process CAS writer with shell disabled and a hard timeout', async () => {
    repository.save(record('race'), { expectedRevision: 0 })
    database.close()
    const results = await Promise.all([
      spawnWorker(databasePath, 'race', 1, 'first'),
      spawnWorker(databasePath, 'race', 1, 'second'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toMatchObject([{ errorCode: 'SESSION_STATE_CONFLICT', actualRevision: 2 }])
    database = new DatabaseSync(databasePath)
    expect(database.prepare('SELECT revision FROM session_states WHERE session_id = ?').get('race').revision).toBe(2)
  }, 20_000)

  // Handle variant that logs every prepare() call; the transaction callback
  // receives the handle itself, so in-transaction prepares are logged too.
  function createLoggingHandle(sqlLog) {
    return {
      exec: (sql) => database.exec(sql),
      prepare(sql) { sqlLog.push(sql); return database.prepare(sql) },
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

  it('dedups appended message ids against only the incoming ids in bounded IN chunks', () => {
    const sqlLog = []
    const loggingRepository = createSessionStateRepository(createLoggingHandle(sqlLog), { now: () => '2026-01-01T00:00:03.000Z' })
    loggingRepository.replaceMessages(record('one'), [
      { role: 'user', content: 's0', id: 's0' },
      { role: 'user', content: 's1', id: 's1' },
    ], { expectedRevision: 0 })
    sqlLog.length = 0
    const incoming = [
      { role: 'user', content: 's0-duplicate', id: 's0' },
      ...Array.from({ length: 600 }, (_, index) => ({ role: 'user', content: `n${index}`, id: `n${index}` })),
    ]
    loggingRepository.appendMessages(loggingRepository.findBySessionId('one'), incoming, { expectedRevision: 1 })
    // The stored-id duplicate is skipped; everything else lands exactly once.
    expect(loggingRepository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(602)
    // The dedup probe targets only the incoming ids (601 unique ids -> two
    // chunks of <=500) instead of scanning the whole stored id set.
    expect(sqlLog.filter((sql) => sql.includes('message_id IN'))).toHaveLength(2)
    expect(sqlLog.some((sql) => sql.includes('message_id IS NOT NULL'))).toBe(false)
    expect(loggingRepository.verifyIntegrity()).toMatchObject({ ok: true })
  })

  it('prepares each runtime hot-path statement once per storage handle', () => {
    const sqlLog = []
    const loggingRepository = createSessionStateRepository(createLoggingHandle(sqlLog), { now: () => '2026-01-01T00:00:03.000Z' })
    loggingRepository.save(record(), { expectedRevision: 0 })
    loggingRepository.save(record(), { expectedRevision: 1 })
    loggingRepository.findBySessionId('session-a')
    loggingRepository.findBySessionId('session-a')
    const prepares = (needle) => sqlLog.filter((sql) => sql.includes(needle)).length
    expect(prepares('FROM session_states WHERE session_id = ?')).toBe(1)
    expect(prepares('INSERT INTO session_states')).toBe(1)
    expect(prepares('SELECT revision, state_version, created_at FROM session_states')).toBe(1)
    expect(prepares('DELETE FROM session_state_tombstones')).toBe(1)
  })

  it('collects a same-key tombstone on the next successful save while keeping tombstones of deleted sessions', () => {
    repository.save(record('one'), { expectedRevision: 0 })
    repository.save(record('two'), { expectedRevision: 0 })
    expect(repository.delete({ scope: 'global', sessionId: 'one', expectedRevision: 1 })).toBe(true)
    expect(repository.delete({ scope: 'global', sessionId: 'two', expectedRevision: 1 })).toBe(true)
    const tombstones = () => database.prepare('SELECT session_id FROM session_state_tombstones ORDER BY session_id').all().map((row) => row.session_id)
    expect(tombstones()).toEqual(['one', 'two'])

    // Recreating 'one' collects its tombstone: the live row's CAS revision
    // chain has taken over resurrection protection. 'two' stays protected.
    repository.save(record('one'), { expectedRevision: 2 })
    expect(tombstones()).toEqual(['two'])

    // A shadowed tombstone below the live revision is collected on the next
    // successful save of the same key as well.
    database.prepare("INSERT INTO session_state_tombstones (scope, project_id, session_id, revision, deleted_at) VALUES ('global', '', 'one', 1, '2026-01-01T00:00:00.000Z')").run()
    repository.save(record('one'), { expectedRevision: 3 })
    expect(tombstones()).toEqual(['two'])
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, activeTombstones: 0 })
  })

  it('stops listing mirror entries after MIRROR_MAX_ATTEMPTS failures and revives them on re-enqueue', () => {
    repository.save(record(), { expectedRevision: 0 })
    for (let attempt = 0; attempt < MIRROR_MAX_ATTEMPTS; attempt += 1) {
      repository.failMirror(repository.listMirrorQueue()[0], new Error('mirror down'))
    }
    expect(repository.listMirrorQueue({ includeDeadLetters: true })).toMatchObject([{ sessionId: 'session-a', attempts: MIRROR_MAX_ATTEMPTS }])
    // Dead letter: no longer drained and no longer counted as pending...
    expect(repository.listMirrorQueue()).toEqual([])
    expect(repository.countMirrorQueue()).toBe(0)
    expect(repository.countMirrorQueue({ includeDeadLetters: true })).toBe(1)
    expect(repository.countMirrorDeadLetters()).toBe(1)
    // ...but a fresh save re-enqueues the key with attempts reset.
    repository.save(record(), { expectedRevision: 1 })
    expect(repository.listMirrorQueue()).toMatchObject([{ sessionId: 'session-a', attempts: 0 }])
    expect(repository.countMirrorDeadLetters()).toBe(0)
  })
})
