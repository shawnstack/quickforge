import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository, digestFromLines, snapshotDigestLine } from '../../server/sqlite/session-state-repository.mjs'

// Same hermetic setup as session-state-repository.test.mjs: a raw DatabaseSync
// on a throwaway temp directory behind the thin handle shim. Nothing here
// touches the real QUICKFORGE_DATA_DIR (the repository handle is always
// injected, so getSqliteStorage is never resolved lazily).
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

const FIXED_NOW = '2026-01-01T00:00:02.000Z'

function record(sessionId = 'session-a', overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  return {
    scope,
    projectId,
    sessionId,
    stateVersion: 3,
    state: {
      id: sessionId,
      scope,
      ...(scope === 'project' ? { projectId } : {}),
      stateVersion: 3,
      title: `Session ${sessionId}`,
      messages: [{ role: 'user', content: 'hello' }],
    },
    metadata: {
      id: sessionId,
      scope,
      ...(scope === 'project' ? { projectId } : {}),
      stateVersion: 3,
      createdAt: '2026-02-01T00:00:00.000Z',
      lastModified: '2026-02-01T00:00:01.000Z',
      messageCount: 1,
    },
  }
}

async function* stream(records) {
  yield* records
}

function countOf(database, table, where = '', ...params) {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params).count)
}

function bucketRowCounts(database, scope, projectId) {
  return {
    states: countOf(database, 'session_states', 'WHERE scope = ? AND project_id = ?', scope, projectId),
    messages: countOf(database, 'session_messages', 'WHERE scope = ? AND project_id = ?', scope, projectId),
    index: countOf(database, 'session_index', 'WHERE scope = ? AND project_id = ?', scope, projectId),
    tombstones: countOf(database, 'session_state_tombstones', 'WHERE scope = ? AND project_id = ?', scope, projectId),
  }
}

function insertTombstone(database, scope, projectId, sessionId) {
  database.prepare('INSERT INTO session_state_tombstones (scope, project_id, session_id, revision, deleted_at) VALUES (?, ?, ?, 4, ?)')
    .run(scope, projectId, sessionId, FIXED_NOW)
}

describe('session state repository bucket align (background migration feature 1)', () => {
  let directory
  let database
  let repository
  const databases = []

  function openDatabase() {
    const handle = new DatabaseSync(path.join(directory, `state-${databases.length}.sqlite3`))
    handle.exec('PRAGMA busy_timeout = 5000')
    applySqliteMigrations(handle)
    databases.push(handle)
    return handle
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-align-'))
    database = openDatabase()
    repository = createSessionStateRepository(createHandle(database), { now: () => FIXED_NOW })
  })

  afterEach(async () => {
    for (const handle of databases.splice(0)) {
      try { handle.close() } catch { /* already closed */ }
    }
    await rm(directory, { recursive: true, force: true })
  })

  it('aligns a bucket idempotently: a rerun keeps the digest and the row counts stable', async () => {
    const records = [record('alpha'), record('gamma')]
    const first = await repository.alignBucketStream({ scope: 'global' }, stream(records))
    expect(first).toEqual({ bucket: { scope: 'global', projectId: null }, count: 2, digest: expect.any(String) })

    const digestAfterFirst = repository.digest()
    const countsAfterFirst = {
      states: countOf(database, 'session_states'),
      messages: countOf(database, 'session_messages'),
      index: countOf(database, 'session_index'),
      tombstones: countOf(database, 'session_state_tombstones'),
    }
    expect(countsAfterFirst).toEqual({ states: 2, messages: 0, index: 2, tombstones: 0 })

    const second = await repository.alignBucketStream({ scope: 'global' }, stream(records))
    expect(second.count).toBe(2)
    expect(second.digest).toBe(first.digest)
    expect(repository.digest()).toBe(digestAfterFirst)
    expect({
      states: countOf(database, 'session_states'),
      messages: countOf(database, 'session_messages'),
      index: countOf(database, 'session_index'),
      tombstones: countOf(database, 'session_state_tombstones'),
    }).toEqual(countsAfterFirst)

    // digestFromLines parity: the bucket digest matches both the canonical
    // line aggregation over the same records (via the exported snapshot) and
    // the SQLite-side repository digest.
    const lines = repository.exportSnapshot().records.map((row) => snapshotDigestLine(
      row.scope, row.projectId || '', row.sessionId, row.stateDigest, row.metadataDigest, row.messagesDigest || '',
    ))
    expect(digestFromLines(lines)).toBe(first.digest)
    expect(repository.digest()).toBe(first.digest)
    expect(repository.verifyIntegrity({ quickCheck: true }).ok).toBe(true)
  })

  it('clears orphan rows for session ids the stream no longer carries, without mirror enqueue', async () => {
    repository.save(record('alpha'))
    repository.save(record('orphan-1'))
    repository.save(record('orphan-2'))
    repository.save(record('delta', { scope: 'project', projectId: 'project-a' }))
    // save() enqueues mirror rows; the align contract keeps the queue empty,
    // so scrub the seeding residue before asserting on it.
    database.exec('DELETE FROM session_json_mirror_queue')
    insertTombstone(database, 'global', '', 'tombstone-only')

    const result = await repository.alignBucketStream({ scope: 'global' }, stream([record('alpha')]))
    expect(result.count).toBe(1)

    expect(bucketRowCounts(database, 'global', '')).toEqual({ states: 1, messages: 0, index: 1, tombstones: 0 })
    for (const sessionId of ['orphan-1', 'orphan-2', 'tombstone-only']) {
      expect(repository.get('global', null, sessionId)).toBeNull()
      expect(countOf(database, 'session_index', 'WHERE session_id = ?', sessionId)).toBe(0)
      expect(countOf(database, 'session_state_tombstones', 'WHERE session_id = ?', sessionId)).toBe(0)
    }
    // Other buckets stay untouched.
    expect(bucketRowCounts(database, 'project', 'project-a')).toEqual({ states: 1, messages: 0, index: 1, tombstones: 0 })
    expect(repository.get('project', 'project-a', 'delta')).not.toBeNull()
    expect(repository.countMirrorQueue({ includeDeadLetters: true })).toBe(0)
    expect(repository.verifyIntegrity({ quickCheck: true }).ok).toBe(true)
  })

  it('rolls the whole bucket transaction back when the stream fails mid-way', async () => {
    repository.save(record('alpha'))
    database.exec('DELETE FROM session_json_mirror_queue')
    const rowsBefore = database.prepare('SELECT * FROM session_states ORDER BY session_id').all()
    const digestBefore = repository.digest()

    async function* failingStream() {
      yield record('gamma')
      throw new Error('stream exploded')
    }
    await expect(repository.alignBucketStream({ scope: 'global' }, failingStream())).rejects.toThrow('stream exploded')

    expect(database.prepare('SELECT * FROM session_states ORDER BY session_id').all()).toEqual(rowsBefore)
    expect(bucketRowCounts(database, 'global', '')).toEqual({ states: 1, messages: 0, index: 1, tombstones: 0 })
    expect(repository.digest()).toBe(digestBefore)
    expect(repository.countMirrorQueue({ includeDeadLetters: true })).toBe(0)
  })

  it('writes rows identical to replaceAllStream for the same records', async () => {
    await repository.alignBucketStream({ scope: 'global' }, stream([record('alpha'), record('gamma')]))
    await repository.alignBucketStream({ scope: 'project', projectId: 'project-a' }, stream([record('beta', { scope: 'project', projectId: 'project-a' })]))

    const other = openDatabase()
    const otherRepository = createSessionStateRepository(createHandle(other), { now: () => FIXED_NOW })
    await otherRepository.replaceAllStream(stream([
      record('alpha'),
      record('gamma'),
      record('beta', { scope: 'project', projectId: 'project-a' }),
    ]))

    for (const table of ['session_states', 'session_messages', 'session_index', 'session_state_tombstones']) {
      expect(database.prepare(`SELECT * FROM ${table} ORDER BY scope, project_id, session_id`).all())
        .toEqual(other.prepare(`SELECT * FROM ${table} ORDER BY scope, project_id, session_id`).all())
    }
    expect(repository.digest()).toBe(otherRepository.digest())
  })

  it('deleteBucketRows clears one bucket across all four tables without touching others', async () => {
    repository.save(record('g1'))
    repository.save({ ...record('p1', { scope: 'project', projectId: 'project-a' }), messages: [{ role: 'user', content: 'split me' }] })
    repository.save(record('p2', { scope: 'project', projectId: 'project-b' }))
    database.exec('DELETE FROM session_json_mirror_queue')
    insertTombstone(database, 'project', 'project-a', 'gone')

    const result = repository.deleteBucketRows({ scope: 'project', projectId: 'project-a' })
    expect(result).toEqual({ bucket: { scope: 'project', projectId: 'project-a' }, removedStates: 1 })

    expect(bucketRowCounts(database, 'project', 'project-a')).toEqual({ states: 0, messages: 0, index: 0, tombstones: 0 })
    expect(bucketRowCounts(database, 'global', '')).toEqual({ states: 1, messages: 0, index: 1, tombstones: 0 })
    expect(bucketRowCounts(database, 'project', 'project-b')).toEqual({ states: 1, messages: 0, index: 1, tombstones: 0 })
    expect(repository.countMirrorQueue({ includeDeadLetters: true })).toBe(0)
  })

  it('promoteAlignedSessionState flips json_authoritative to authoritative atomically', async () => {
    const aligned = await repository.alignBucketStream({ scope: 'global' }, stream([record('alpha')]))
    const promoted = repository.promoteAlignedSessionState({ digest: aligned.digest, expectedCount: 1 })
    expect(promoted).toEqual({ phase: 'authoritative', stateCount: 1, digest: aligned.digest })

    const state = database.prepare('SELECT phase, state_count, digest FROM session_storage_state WHERE singleton = 1').get()
    expect(state.phase).toBe('authoritative')
    expect(Number(state.state_count)).toBe(1)
    expect(state.digest).toBe(aligned.digest)
    expect(bucketRowCounts(database, 'global', '')).toEqual({ states: 1, messages: 0, index: 1, tombstones: 0 })
    expect(repository.countMirrorQueue({ includeDeadLetters: true })).toBe(0)

    // Already promoted: a second call fails closed instead of double-writing.
    expect(() => repository.promoteAlignedSessionState()).toThrow(/json_authoritative/)
  })

  it('promoteAlignedSessionState fails closed on a non-empty mirror queue', async () => {
    await repository.alignBucketStream({ scope: 'global' }, stream([record('alpha')]))
    database.prepare(`INSERT INTO session_json_mirror_queue
      (scope, project_id, session_id, operation, revision, updated_at) VALUES ('global', '', 'stale', 'delete', 1, ?)`)
      .run(FIXED_NOW)

    expect(() => repository.promoteAlignedSessionState()).toThrow(/mirror queue/)
    expect(database.prepare('SELECT phase FROM session_storage_state WHERE singleton = 1').get().phase).toBe('json_authoritative')
  })

  it('promoteAlignedSessionState fails closed on a count mismatch or a foreign phase', async () => {
    await repository.alignBucketStream({ scope: 'global' }, stream([record('alpha'), record('gamma')]))
    expect(() => repository.promoteAlignedSessionState({ expectedCount: 5 })).toThrow(/count/)
    expect(database.prepare('SELECT phase FROM session_storage_state WHERE singleton = 1').get().phase).toBe('json_authoritative')

    database.exec("UPDATE session_storage_state SET phase = 'authoritative' WHERE singleton = 1")
    expect(() => repository.promoteAlignedSessionState()).toThrow(/json_authoritative/)
  })

  it('rejects cross-bucket and duplicate stream records, rolling the bucket back', async () => {
    await expect(repository.alignBucketStream({ scope: 'global' }, stream([record('beta', { scope: 'project', projectId: 'project-a' })])))
      .rejects.toThrow(/mismatch/)
    await expect(repository.alignBucketStream({ scope: 'global' }, stream([record('alpha'), record('alpha')])))
      .rejects.toThrow(/Duplicate session id/)
    expect(bucketRowCounts(database, 'global', '')).toEqual({ states: 0, messages: 0, index: 0, tombstones: 0 })

    // Sync iterables are accepted too (same contract as replaceAllStream).
    const result = await repository.alignBucketStream({ scope: 'global' }, [record('alpha')])
    expect(result.count).toBe(1)
  })
})
