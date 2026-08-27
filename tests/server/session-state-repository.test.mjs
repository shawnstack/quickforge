import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository, encodeMessagesChunked, messageDigest } from '../../server/sqlite/session-state-repository.mjs'

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

describe('session state repository and schema v11', () => {
  let directory
  let databasePath
  let database
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-state-repo-'))
    databasePath = path.join(directory, 'state.sqlite3')
    database = new DatabaseSync(databasePath)
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec('PRAGMA foreign_keys = ON')
    applySqliteMigrations(database)
    repository = createSessionStateRepository(createHandle(database), { now: () => '2026-01-01T00:00:02.000Z' })
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  const tableNames = (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map((row) => row.name)

  it('creates the v11 schema: new session tables live, old session tables renamed to *_v10_backup', () => {
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(12)
    expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().at(-1)).toEqual({
      version: 12,
      name: 'remove_share_lan_record_digests',
    })
    const tables = tableNames(database)
    for (const name of ['sessions', 'session_messages', 'session_tombstones', 'session_state_maintenance_lock']) {
      expect(tables).toContain(name)
    }
    for (const name of [
      'session_states_v10_backup',
      'session_messages_v10_backup',
      'session_index_v10_backup',
      'session_state_tombstones_v10_backup',
      'session_json_mirror_queue_v10_backup',
      'session_storage_state_v10_backup',
    ]) {
      expect(tables).toContain(name)
    }
    for (const gone of ['session_states', 'session_index', 'session_json_mirror_queue', 'session_state_tombstones', 'session_storage_state']) {
      expect(tables).not.toContain(gone)
    }
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name LIKE 'idx_sessions%' ORDER BY name").all().map((row) => row.name))
      .toEqual(['idx_sessions_list', 'idx_sessions_pinned', 'idx_sessions_session_id'])
  })

  it('renames v10 session tables on upgrade and keeps their rows as a safety net', () => {
    database.close()
    database = new DatabaseSync(path.join(directory, 'v10.sqlite3'))
    database.exec('PRAGMA foreign_keys = ON')
    applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 10) })
    database.prepare(`INSERT INTO session_states
      (scope, project_id, session_id, revision, state_version, state_json, state_digest, metadata_json, metadata_digest, created_at, updated_at)
      VALUES ('global', '', 'legacy', 1, 0, '{}', '${'a'.repeat(64)}', '{}', '${'b'.repeat(64)}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run()
    applySqliteMigrations(database)
    expect(database.prepare('PRAGMA user_version').get().user_version).toBe(12)
    expect(database.prepare('SELECT session_id FROM session_states_v10_backup').all()).toEqual([{ session_id: 'legacy' }])
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0)
    const v10Repository = createSessionStateRepository(createHandle(database), { now: () => '2026-01-01T00:00:02.000Z' })
    expect(v10Repository.save(record(), { expectedRevision: 0 }).revision).toBe(1)
  })

  it('saves with message extraction, opaque fields preserved, and never stores messages in body_json', () => {
    const saved = repository.save(record(), { expectedRevision: 0 })
    expect(saved.revision).toBe(1)
    const stored = repository.get('global', null, 'session-a')
    expect(stored.state).toMatchObject({ unknownStateField: { nested: ['kept'] }, messageStorage: 'split' })
    expect(stored.state).not.toHaveProperty('messages')
    expect(stored.metadata).toMatchObject({ unknownMetadataField: { kept: 1 } })
    expect(saved.stateDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(saved.stateDigest).toBe(stored.stateDigest)
    expect(repository.messageCount({ scope: 'global', sessionId: 'session-a' })).toBe(1)
    const row = database.prepare('SELECT body_json, message_count, updated_at_ms, revision FROM sessions WHERE session_id = ?').get('session-a')
    expect(row.body_json).not.toContain('"messages"')
    expect(row.message_count).toBe(1)
    expect(row.updated_at_ms).toBe(Date.parse('2026-01-01T00:00:02.000Z'))
    expect(row.revision).toBe(1)

    // Body-only save (no messages key) leaves the message rows untouched.
    const bodyOnly = { ...record(), state: { ...record().state }, metadata: record().metadata }
    delete bodyOnly.state.messages
    repository.save(bodyOnly, { expectedRevision: 1 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'session-a' })).toBe(1)
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'session-a', limit: 10 }).messages[0].message).toEqual({
      role: 'user', content: 'hello', unknownMessageField: { keep: true },
    })
  })

  it('extracts messages from legacy split-marked bodies and honors explicit input.messages', () => {
    const legacy = record('legacy-split')
    legacy.state.messageStorage = 'split'
    repository.save(legacy, { expectedRevision: 0 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'legacy-split' })).toBe(1)
    expect(repository.findBySessionId('legacy-split').state).not.toHaveProperty('messages')

    const override = record('override')
    repository.save({ ...override, messages: [{ role: 'user', content: 'explicit' }] }, { expectedRevision: 0 })
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'override', limit: 10 }).messages.map((row) => row.message.content)).toEqual(['explicit'])
  })

  it('enforces CAS with 409 SESSION_STATE_CONFLICT and stable revisions across tombstones', () => {
    const first = repository.save(record(), { expectedRevision: 0 })
    try {
      repository.save(record(), { expectedRevision: 0 })
      throw new Error('expected stale save conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_CONFLICT', actualRevision: 1 })
    }
    expect(repository.save(record(), { expectedRevision: 1 }).revision).toBe(2)
    expect(first.revision).toBe(1)

    expect(repository.delete({ scope: 'global', sessionId: 'session-a', expectedRevision: 2 })).toBe(true)
    const tombstone = database.prepare('SELECT deleted_at FROM session_tombstones WHERE session_id = ?').get('session-a')
    expect(Number(tombstone.deleted_at)).toBe(Date.parse('2026-01-01T00:00:02.000Z'))
    try {
      repository.save(record(), { expectedRevision: 2 })
      throw new Error('expected post-delete conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_CONFLICT' })
    }
    // A save (any) collects the same-key tombstone; tombstones of untouched
    // sessions stay behind by design.
    expect(repository.save(record(), { expectedRevision: 0 }).revision).toBe(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM session_tombstones').get().count).toBe(0)
  })

  it('detects cross-bucket duplicate session ids on write and read', () => {
    repository.save(record(), { expectedRevision: 0 })
    try {
      repository.save(record('session-a', { scope: 'project', projectId: 'project-a' }), { expectedRevision: 0 })
      throw new Error('expected duplicate id rejection')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_DUPLICATE_ID' })
    }
    database.prepare(`INSERT INTO sessions (scope, project_id, session_id, created_at, updated_at, body_json, meta_json, revision, updated_at_ms)
      VALUES ('project', 'project-b', 'session-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '{}', '{}', 1, 0)`).run()
    expect(() => repository.findBySessionId('session-a')).toThrow(/Duplicate authoritative session id/)
  })

  it('cascades message rows on delete and reclaims space best-effort', () => {
    repository.save(record('gone'), { expectedRevision: 0 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'gone' })).toBe(1)
    expect(repository.delete({ scope: 'global', sessionId: 'gone', expectedRevision: 1 })).toBe(true)
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?').get('gone').count).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ?').get('gone').count).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM session_tombstones WHERE session_id = ?').get('gone').count).toBe(1)
    // FK cascade also holds for raw session-row deletions.
    repository.save(record('raw-delete'), { expectedRevision: 0 })
    database.prepare('DELETE FROM sessions WHERE session_id = ?').run('raw-delete')
    expect(database.prepare('SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ?').get('raw-delete').count).toBe(0)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 0 })
  })

  it('supports atomic multi-record batches with full rollback on conflict', () => {
    repository.save(record('one'), { expectedRevision: 0 })
    repository.save(record('two'), { expectedRevision: 0 })
    expect(() => repository.applyBatch({
      upserts: [
        { record: { ...record('one'), state: { ...record('one').state, changed: true } }, expectedRevision: 1 },
        { record: record('two'), expectedRevision: 0 },
      ],
    })).toThrow(/conflict/i)
    expect(repository.findBySessionId('one').revision).toBe(1)

    const batch = repository.applyBatch({
      upserts: [{ record: record('three'), messages: [{ role: 'user', content: 'batch' }] }],
      deletes: [{ scope: 'global', sessionId: 'two', expectedRevision: 1 }],
    })
    expect(batch.saved).toHaveLength(1)
    expect(batch.deleted).toEqual([true])
    expect(repository.messageCount({ scope: 'global', sessionId: 'three' })).toBe(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM session_tombstones WHERE session_id = ?').get('two').count).toBe(1)
  })

  it('roundtrips replaceAll and exportSnapshot with reassembled messages and digest verification', () => {
    const records = [record('global'), record('project', { scope: 'project', projectId: 'p' })]
    expect(repository.replaceAll(records)).toBe(2)
    const snapshot = repository.exportSnapshot()
    expect(snapshot.count).toBe(2)
    expect(snapshot.digest).toBe(repository.digest())
    const globalRow = snapshot.records.find((entry) => entry.sessionId === 'global')
    expect(globalRow.state.messages).toEqual(record('global').state.messages)
    expect(globalRow.messages).toEqual(record('global').state.messages)
    expect(globalRow.messagesDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(repository.messageCount({ scope: 'global', sessionId: 'global' })).toBe(1)

    // exportSnapshot records re-enter through replaceAll with count + digest
    // verification against the snapshot they came from (same extraction path).
    expect(repository.replaceAll(snapshot.records, { expectedCount: snapshot.count, expectedDigest: snapshot.digest })).toBe(2)
    expect(repository.digest()).toBe(snapshot.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2 })

    // Verification failures roll the wipe back to the previous state.
    expect(() => repository.replaceAll([record('fresh')], { expectedCount: 5 })).toThrow('Session state replace count verification failed')
    expect(repository.count()).toBe(2)
    expect(repository.findBySessionId('global')).not.toBeNull()
    expect(() => repository.replaceAll([record('fresh')], { expectedDigest: 'f'.repeat(64) })).toThrow('Session state replace digest verification failed')
    expect(repository.count()).toBe(2)
  })

  it('verifies integrity: lightweight counts and message_count checks, full row digest recomputation', () => {
    repository.replaceAll([record()])
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true, lightweight: true, digest: null, count: 1 })
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1, digest: expect.any(String) })

    // Derived message_count drift is caught by BOTH modes.
    database.prepare('UPDATE sessions SET message_count = message_count + 1').run()
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: false, messageCountMismatches: 1 })
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, messageCountMismatches: 1 })
    expect(() => repository.save(record(), { expectedRevision: 1 })).not.toThrow()
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true })

    // Row-level corruption is invisible to the lightweight mode...
    database.prepare('UPDATE session_messages SET message_digest = ? WHERE seq = 0').run('f'.repeat(64))
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true })
    // ...but fail-closes in the full mode.
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, invalidMessageDigests: 1 })

    // A body carrying a messages array is a double representation.
    repository.replaceAll([record()])
    database.prepare("UPDATE sessions SET body_json = json_set(body_json, '$.messages', json_array()) WHERE session_id = 'session-a'").run()
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, invalidMessageRepresentations: 1 })

    // Structural corruption: orphan message rows (FK bypassed) and duplicate ids.
    repository.replaceAll([record()])
    database.exec('PRAGMA foreign_keys = OFF')
    database.prepare(`INSERT INTO session_messages (scope, project_id, session_id, seq, message_json, message_digest)
      VALUES ('global', '', 'ghost', 0, '{}', '${'a'.repeat(64)}')`).run()
    database.exec('PRAGMA foreign_keys = ON')
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: false, orphanMessages: 1 })
    database.prepare('DELETE FROM session_messages WHERE session_id = ?').run('ghost')
    database.prepare(`INSERT INTO sessions (scope, project_id, session_id, created_at, updated_at, body_json, meta_json, revision, updated_at_ms)
      VALUES ('project', 'p2', 'session-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '{}', '{}', 1, 0)`).run()
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: false, duplicateIds: 1 })
  })

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

  it('prepares each runtime hot-path statement once per storage handle', () => {
    const sqlLog = []
    const loggingRepository = createSessionStateRepository(createLoggingHandle(sqlLog), { now: () => '2026-01-01T00:00:03.000Z' })
    loggingRepository.save(record(), { expectedRevision: 0 })
    loggingRepository.save(record(), { expectedRevision: 1 })
    loggingRepository.findBySessionId('session-a')
    loggingRepository.findBySessionId('session-a')
    const prepares = (needle) => sqlLog.filter((sql) => sql.includes(needle)).length
    expect(prepares('FROM sessions WHERE session_id = ?')).toBe(1)
    expect(prepares('INSERT INTO sessions')).toBe(1)
    expect(prepares('SELECT revision, state_version, created_at, message_count FROM sessions')).toBe(1)
    expect(prepares('DELETE FROM session_tombstones')).toBe(1)
    expect(prepares('INSERT INTO session_messages')).toBe(1)
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
    expect(database.prepare('SELECT revision FROM sessions WHERE session_id = ?').get('race').revision).toBe(2)
  }, 20_000)

  it('digest helpers keep their canonical semantics', () => {
    const messages = [{ id: 'a', content: 'x' }, { content: 'y' }]
    expect(messageDigest(messages[0])).toMatch(/^[0-9a-f]{64}$/)
    const saved = repository.save(record('digest-check'), { expectedRevision: 0 })
    const page = repository.readMessagesPage({ scope: 'global', sessionId: 'digest-check', limit: 10 })
    expect(page.messages.map((row) => row.digest)).toEqual([messageDigest(record('digest-check').state.messages[0])])
    expect(saved.stateDigest).toBe(repository.findBySessionId('digest-check').stateDigest)
  })

  it('encodeMessagesChunked yields to the event loop between batches', async () => {
    const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const events = []
    const encode = encodeMessagesChunked(messages, { batchSize: 1 })
    // This immediate is queued after the first batch's inter-batch yield, so
    // FIFO immediates run it BEFORE the remaining batches finish: proof the
    // event loop got control mid-encode. A fully synchronous encode would
    // settle the promise (microtask) before any immediate runs.
    const external = new Promise((resolve) => setImmediate(() => {
      events.push('external')
      resolve()
    }))
    await encode
    events.push('done')
    await external
    expect(events).toEqual(['external', 'done'])
  })

  it('pre-encoded chunked rows write byte-identical rows to the synchronous encode path', async () => {
    const messages = []
    for (let index = 0; index < 120; index += 1) {
      messages.push({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `message ${index}` })
    }
    const encoded = await encodeMessagesChunked(messages, { batchSize: 25 })
    expect(encoded).toHaveLength(messages.length)

    const syncSaved = repository.replaceMessages(record('sync-encode'), messages, { expectedRevision: 0 })
    const bypassSaved = repository.replaceMessages({ ...record('bypass-encode'), messagesEncoded: encoded }, messages, { expectedRevision: 0 })
    expect(bypassSaved.messageCount).toBe(syncSaved.messageCount)

    const rows = (sessionId) => database
      .prepare('SELECT seq, message_json, message_digest FROM session_messages WHERE session_id = ? ORDER BY seq')
      .all(sessionId)
    expect(rows('bypass-encode')).toEqual(rows('sync-encode'))
    expect(rows('bypass-encode').map((row) => row.message_digest)).toEqual(encoded.map((row) => row.messageDigest))
  })

  it('rejects a misaligned messagesEncoded array', () => {
    expect(() => repository.replaceMessages(
      { ...record('misaligned'), messagesEncoded: [{ messageId: null, messageJson: '{}', messageDigest: '0'.repeat(64) }] },
      [{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }],
      { expectedRevision: 0 },
    )).toThrow(TypeError)
  })

  it('skips the state.messages deep clone when pre-encoded rows are provided', async () => {
    const message = { role: 'user', content: 'snapshot' }
    const [encoded] = await encodeMessagesChunked([message])
    // The messagesEncoded bypass never serializes state.messages (the encoded
    // rows are the payload) — only its length is read for alignment. The
    // uncloneable function property proves the deep clone is gone: cloning
    // would throw DataCloneError, the bypass must not.
    const messages = [{ ...message, fn: () => {} }]
    const saved = repository.replaceMessages(
      { ...record('no-deep-clone'), state: { ...record('no-deep-clone').state, messages }, messagesEncoded: [encoded] },
      messages,
      { expectedRevision: 0 },
    )
    expect(saved.messageCount).toBe(1)
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'no-deep-clone', limit: 10 }).messages[0].message)
      .toEqual(message)
  })
})
