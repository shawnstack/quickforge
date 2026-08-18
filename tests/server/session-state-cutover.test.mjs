import { createWriteStream } from 'node:fs'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  acquireSessionStateMaintenanceLock,
  buildSessionJsonSnapshot,
  createStreamingSessionSource,
  initializeSessionStateCutover,
  releaseSessionStateMaintenanceLock,
  renewSessionStateMaintenanceLock,
} from '../../server/session-state-cutover.mjs'
import { configureSessionStateService, readSessionStorageState } from '../../server/session-state-service.mjs'

function bucket(sessionId = 'one', overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  const state = {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    title: 'Session',
    messages: [{ role: 'user', content: 'hello', unknown: true }],
    bodyUnknown: { keep: true },
    ...overrides.state,
  }
  const metadata = overrides.metadata === undefined ? {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    messageCount: 1,
    pinnedAt: '2026-01-01T00:00:00.000Z',
    metadataUnknown: { keep: true },
  } : overrides.metadata
  return { scope, projectId, sessions: { [sessionId]: state }, metadata: metadata === null ? {} : { [sessionId]: metadata } }
}

// In-memory fsAdapter for the streaming cutover source: buckets shaped like
// readPhysicalSessionStateBuckets output, mapped onto the injectable adapter
// interface so tests never touch a real QUICKFORGE_DATA_DIR layout.
function fakeFsAdapter(buckets) {
  const bucketFor = (bucket) => buckets.find((candidate) => candidate.scope === bucket.scope && (candidate.projectId || null) === (bucket.projectId || null))
  return {
    async *listBuckets() {
      for (const bucket of buckets) yield { scope: bucket.scope, projectId: bucket.projectId || null }
    },
    async *listSessionFiles(bucket) {
      for (const sessionId of Object.keys(bucketFor(bucket).sessions).sort()) yield sessionId
    },
    async readSessionState(bucket, sessionId) {
      return bucketFor(bucket).sessions[sessionId] ?? null
    },
    async readMetadataBucket(bucket) {
      return { ...bucketFor(bucket).metadata }
    },
  }
}

describe('session state cutover', () => {
  let directory
  let backupDirectory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-cutover-'))
    backupDirectory = path.join(directory, 'backups')
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('validates source shapes/path scope, blocks duplicate IDs, drops metadata orphans, and derives body-only metadata with diagnostics', () => {
    expect(() => buildSessionJsonSnapshot([{ scope: 'project', projectId: '../bad', sessions: {}, metadata: {} }])).toThrow(/bucket/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', projectId: 'bad', sessions: {}, metadata: {} }])).toThrow(/projectId/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', sessions: { one: [] }, metadata: {} }])).toThrow(/state/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', sessions: { one: { messages: {} } }, metadata: {} }])).toThrow(/messages/)
    const orphanSnapshot = buildSessionJsonSnapshot([{ scope: 'global', sessions: {}, metadata: { one: {} } }])
    expect(orphanSnapshot).toMatchObject({ count: 0, diagnostics: { metadataOnly: ['one'], orphanDeletes: [{ scope: 'global', projectId: null, sessionId: 'one' }] } })
    expect(orphanSnapshot.records).toEqual([])
    expect(() => buildSessionJsonSnapshot([bucket('same'), bucket('same', { scope: 'project', projectId: 'p' })])).toThrow(/Duplicate session ids/)

    const snapshot = buildSessionJsonSnapshot([bucket('body-only', { metadata: null })])
    expect(snapshot).toMatchObject({ count: 1, diagnostics: { bodyOnly: ['body-only'], metadataOnly: [], duplicateSessionIds: [] } })
    expect(snapshot.records[0].metadata).toMatchObject({ id: 'body-only', messageCount: 1 })
  })

  it('streams session records that match buildSessionJsonSnapshot for count, digest, diagnostics and records', async () => {
    const globalBucket = bucket('alpha', { metadata: null })
    globalBucket.sessions.beta = { id: 'beta', scope: 'global', stateVersion: 2, title: 'Beta', messages: [{ role: 'assistant', content: 'hi' }] }
    globalBucket.metadata.beta = { id: 'beta', scope: 'global', stateVersion: 2, messageCount: 1, pinnedAt: '2026-02-02T00:00:00.000Z' }
    globalBucket.metadata['stale-orphan'] = { id: 'stale-orphan', scope: 'global', messageCount: 0 }
    const dataset = [globalBucket, bucket('gamma', { scope: 'project', projectId: 'demo' })]

    const snapshot = buildSessionJsonSnapshot(structuredClone(dataset))
    const source = createStreamingSessionSource(fakeFsAdapter(dataset))()
    const streamed = []
    for await (const record of source.iterate()) streamed.push(record)
    const summary = source.getSummary()
    expect(summary.count).toBe(snapshot.count)
    expect(summary.digest).toBe(snapshot.digest)
    expect(summary.diagnostics).toEqual(snapshot.diagnostics)
    expect(streamed).toEqual(snapshot.records)
  })

  it('cuts over end-to-end from a streaming fs adapter without readBuckets and writes a parseable v1 backup', async () => {
    const source = bucket('one')
    source.metadata['stale-orphan'] = { id: 'stale-orphan', scope: 'global', messageCount: 0 }
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      fsAdapter: fakeFsAdapter(structuredClone([source])),
      mirror,
      owner: { id: '112:test', pid: 112 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')
    expect(repository.count()).toBe(1)
    expect(repository.findBySessionId('one')).not.toBeNull()
    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global', sessionId: 'stale-orphan', operation: 'delete', revision: 1 }))
    expect(repository.listMirrorQueue()).toEqual([])
    const files = await readdir(backupDirectory)
    expect(files).toHaveLength(1)
    const backup = JSON.parse(await readFile(path.join(backupDirectory, files[0]), 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1, scope: 'sessions', includeSecrets: false, sessionState: { count: 1, digest: state.digest } })
    expect(backup.data.sessions).toEqual({ one: repository.findBySessionId('one').state })
    expect(backup.data.sessionsMetadata).toEqual({ one: repository.findBySessionId('one').metadata })
  })

  it('fails closed when the streaming source changes between the double reads', async () => {
    const dataset = [bucket('one')]
    const adapter = fakeFsAdapter(dataset)
    let passes = 0
    const unstable = {
      ...adapter,
      async *listBuckets() {
        passes += 1
        if (passes === 2) {
          dataset.length = 0
          dataset.push(bucket('two'))
        }
        yield* adapter.listBuckets()
      },
    }
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      fsAdapter: unstable,
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '113:test', pid: 113 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('json_authoritative')
    expect(state.diagnostic).toMatchObject({ operation: 'cutover', error: 'Session JSON source changed during cutover double read' })
    expect(repository.count()).toBe(0)
  })

  it('fails closed with a byte-verification error when the backup write stream is corrupted mid-file', async () => {
    // Chunk order for one session: header, state entry, sections join,
    // metadata entry, footer — index 3 is the metadata entry.
    const createCorruptingWriteStream = (corruptAt) => (file, options) => {
      const real = createWriteStream(file, options)
      let index = 0
      return {
        write(chunk, encoding, callback) {
          const current = index
          index += 1
          const payload = current === corruptAt ? chunk.slice(0, Math.max(1, Math.floor(chunk.length / 2))) : chunk
          return real.write(payload, encoding, callback)
        },
        end(callback) { real.end(callback) },
        once(event, listener) { real.once(event, listener); return this },
        on(event, listener) { real.on(event, listener); return this },
        off(event, listener) { real.off(event, listener); return this },
      }
    }
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      fsAdapter: fakeFsAdapter([bucket()]),
      createBackupWriteStream: createCorruptingWriteStream(3),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '114:test', pid: 114 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('json_authoritative')
    expect(state.diagnostic).toMatchObject({ operation: 'cutover', error: 'Session cutover backup verification failed' })
    expect(repository.count()).toBe(0)
    expect(await readdir(backupDirectory)).toEqual([])
  })

  it('routes streaming orphan metadata into mirrorDeletes and the paged mirror delete queue', async () => {
    const source = bucket('one')
    source.metadata['stale-orphan'] = { id: 'stale-orphan', scope: 'global', messageCount: 0 }
    const mirror = {
      upsert: vi.fn(async () => {}),
      delete: vi.fn(async () => { throw new Error('mirror delete failed') }),
    }
    const pending = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      fsAdapter: fakeFsAdapter(structuredClone([source])),
      mirror,
      owner: { id: '115:test', pid: 115 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global', sessionId: 'stale-orphan', operation: 'delete', revision: 1 }))
    // The paged drain retries the orphan delete in a second page after the
    // 'one' upsert succeeds in page 1 (attempts ends at 2).
    expect(repository.listMirrorQueue()).toMatchObject([{ scope: 'global', projectId: null, sessionId: 'stale-orphan', operation: 'delete', revision: 1, attempts: 2 }])
  })

  // Step 2 streaming semantics: the backup is written via createWriteStream
  // and verified by re-reading bytes (chunked sha256), not by re-parsing the
  // whole file into a snapshot — the assertions below still confirm the file
  // parses and carries the correct sessionState envelope.
  it('requires a stable double summary, writes and stream-verifies a v1 count/digest backup, and atomically enters pending before mirror', async () => {
    const source = [bucket()]
    const mirror = { upsert: vi.fn(async () => { throw new Error('mirror failed') }), delete: vi.fn() }
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '100:test', pid: 100 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('sqlite_authoritative_json_pending')
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    expect(repository.listMirrorQueue()).toMatchObject([{ sessionId: 'one', attempts: 1, operation: 'upsert' }])
    const files = await readdir(backupDirectory)
    expect(files).toHaveLength(1)
    const backup = JSON.parse(await readFile(path.join(backupDirectory, files[0]), 'utf8'))
    expect(backup).toMatchObject({ version: 1, sessionState: { count: 1, digest: state.digest } })
    expect(readSessionStorageState().phase).toBe('sqlite_authoritative_json_pending')
  })

  it('drops metadata-only orphans during cutover, keeps them in diagnostics, and excludes them from the backup', async () => {
    const source = bucket('one')
    source.metadata['stale-orphan'] = { id: 'stale-orphan', scope: 'global', messageCount: 0 }
    const mirror = { upsert: vi.fn(), delete: vi.fn() }
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => structuredClone([source])),
      mirror,
      owner: { id: '107:test', pid: 107 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')
    expect(repository.count()).toBe(1)
    expect(repository.findBySessionId('one')).not.toBeNull()
    expect(repository.findBySessionId('stale-orphan')).toBeNull()
    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global', sessionId: 'stale-orphan', operation: 'delete', revision: 1 }))
    expect(repository.listMirrorQueue()).toEqual([])
    const finalState = readSessionStorageState()
    expect(finalState.diagnostic).toMatchObject({ bodyOnly: [], metadataOnly: ['stale-orphan'], duplicateSessionIds: [] })
    const files = await readdir(backupDirectory)
    expect(files).toHaveLength(1)
    const backup = JSON.parse(await readFile(path.join(backupDirectory, files[0]), 'utf8'))
    expect(backup.sessionState).toMatchObject({ count: 1, digest: state.digest })
    expect(Object.keys(backup.data.sessions)).toEqual(['one'])
    expect(Object.keys(backup.data.sessionsMetadata)).toEqual(['one'])
    const restarted = await initializeSessionStateCutover({
      storage,
      repository,
      readBuckets: vi.fn(async () => structuredClone([bucket('one')])),
      mirror,
      owner: { id: '108:test', pid: 108 },
      pidAlive: () => false,
    })
    expect(restarted.phase).toBe('authoritative')
  })

  it('returns to JSON before pending, never falls back after pending, and completes pending recovery after mirror succeeds', async () => {
    let reads = 0
    const unstable = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => {
        reads += 1
        return [bucket(reads === 1 ? 'one' : 'two')]
      }),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '101:test', pid: 101 },
      pidAlive: () => false,
    })
    expect(unstable.phase).toBe('json_authoritative')
    expect(repository.count()).toBe(0)

    let failMirror = true
    const mirror = {
      upsert: vi.fn(async () => { if (failMirror) throw new Error('mirror failed') }),
      delete: vi.fn(),
    }
    const pending = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => [bucket()]),
      mirror,
      owner: { id: '102:test', pid: 102 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    failMirror = false
    const recovered = await initializeSessionStateCutover({
      storage,
      repository,
      mirror,
      owner: { id: '103:test', pid: 103 },
      pidAlive: () => false,
    })
    expect(recovered.phase).toBe('authoritative')
    expect(repository.listMirrorQueue()).toEqual([])

    storage.prepare("UPDATE session_storage_state SET phase = 'sqlite_authoritative_json_pending' WHERE singleton = 1").run()
    // Startup verification is lightweight (SQL-level): corrupt with an active
    // tombstone shadowing a live row — SQL-detectable and not healable by the
    // index self-heal rebuild, so the re-check still fails closed.
    storage.prepare("INSERT INTO session_state_tombstones (scope, project_id, session_id, revision, deleted_at) VALUES ('global', '', 'one', 9, '2026-01-01T00:00:00.000Z')").run()
    await expect(initializeSessionStateCutover({
      storage,
      repository,
      mirror,
      owner: { id: '104:test', pid: 104 },
      pidAlive: () => false,
    })).rejects.toThrow(/pending integrity/)
    expect(readSessionStorageState().phase).toBe('sqlite_authoritative_json_pending')
  })

  it('self-heals orphan index backflow after a failed mirror delete by rebuilding the index on restart', async () => {
    const source = bucket('one')
    source.metadata['stale-orphan'] = { id: 'stale-orphan', scope: 'global', messageCount: 0 }
    let failDelete = true
    const mirror = {
      upsert: vi.fn(async () => {}),
      delete: vi.fn(async () => { if (failDelete) throw new Error('mirror delete failed') }),
    }
    const pending = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => structuredClone([source])),
      mirror,
      owner: { id: '109:test', pid: 109 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    // The paged drain retries failed entries while the batch makes progress:
    // 'one' succeeds in page 1, so the orphan delete is retried in page 2
    // before the all-failing page stops the loop (attempts ends at 2).
    expect(repository.listMirrorQueue()).toMatchObject([{ scope: 'global', sessionId: 'stale-orphan', operation: 'delete', revision: 1, attempts: 2 }])
    // Simulate a later boot where initializeSessionIndex re-imports the orphan
    // JSON residue into session_index while authoritative states stay clean.
    storage.prepare(`INSERT INTO session_index (scope, project_id, session_id, is_pinned, is_archived, metadata_json, metadata_digest, indexed_at)
      VALUES ('global', '', 'stale-orphan', 0, 0, '{}', ?, '2026-01-01T00:00:00.000Z')`).run('a'.repeat(64))
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, orphanIndex: 1 })
    failDelete = false
    const healed = await initializeSessionStateCutover({
      storage,
      repository,
      readBuckets: vi.fn(async () => structuredClone([bucket('one')])),
      mirror,
      owner: { id: '110:test', pid: 110 },
      pidAlive: () => false,
    })
    expect(healed.phase).toBe('authoritative')
    expect(repository.listMirrorQueue()).toEqual([])
    expect(Number(storage.prepare("SELECT COUNT(*) AS count FROM session_index WHERE session_id = 'stale-orphan'").get().count)).toBe(0)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
  })

  it('recovers cutover_running by safely rerunning JSON cutover and preserves pending/authoritative SQLite rows', async () => {
    storage.prepare("UPDATE session_storage_state SET phase = 'cutover_running', backup_file = 'existing-backup.json' WHERE singleton = 1").run()
    const result = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => [bucket()]),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '105:test', pid: 105 },
      pidAlive: () => false,
    })
    expect(result.phase).toBe('authoritative')
    expect(repository.findBySessionId('one')).not.toBeNull()
    repository.save({ ...repository.findBySessionId('one'), state: { ...repository.findBySessionId('one').state, runtime: true } }, { expectedRevision: 1 })
    const repeated = await initializeSessionStateCutover({
      storage,
      repository,
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '106:test', pid: 106 },
      pidAlive: () => false,
    })
    expect(repeated.phase).toBe('authoritative')
    expect(repository.findBySessionId('one').state.runtime).toBe(true)
  })

  it('fences maintenance locks, heartbeats leases, and steals only expired leases with confirmed dead PIDs', () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const first = acquireSessionStateMaintenanceLock(storage, {
      owner: { id: '111:first', pid: 111 }, now: () => now, ttlMs: 30, pidAlive: () => true,
    })
    expect(first).toMatchObject({ owner: '111:first', fencing: 1 })
    now += 20
    expect(renewSessionStateMaintenanceLock(storage, first, { now: () => now, ttlMs: 30 })).toBe(true)
    now += 20
    expect(acquireSessionStateMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, now: () => now, ttlMs: 30, pidAlive: () => false,
    })).toBeNull()
    now += 20
    const second = acquireSessionStateMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, now: () => now, ttlMs: 30, pidAlive: () => false,
    })
    expect(second).toMatchObject({ owner: '222:second', fencing: 2 })
    expect(releaseSessionStateMaintenanceLock(storage, first)).toBe(false)
    expect(releaseSessionStateMaintenanceLock(storage, second)).toBe(true)
  })
})
