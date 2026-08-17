import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  acquireSessionStateMaintenanceLock,
  buildSessionJsonSnapshot,
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

  it('validates source shapes/path scope, blocks duplicate IDs and metadata orphans, and derives body-only metadata with diagnostics', () => {
    expect(() => buildSessionJsonSnapshot([{ scope: 'project', projectId: '../bad', sessions: {}, metadata: {} }])).toThrow(/bucket/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', projectId: 'bad', sessions: {}, metadata: {} }])).toThrow(/projectId/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', sessions: { one: [] }, metadata: {} }])).toThrow(/state/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', sessions: { one: { messages: {} } }, metadata: {} }])).toThrow(/messages/)
    expect(() => buildSessionJsonSnapshot([{ scope: 'global', sessions: {}, metadata: { one: {} } }])).toThrow(/Metadata-only/)
    expect(() => buildSessionJsonSnapshot([bucket('same'), bucket('same', { scope: 'project', projectId: 'p' })])).toThrow(/Duplicate session ids/)

    const snapshot = buildSessionJsonSnapshot([bucket('body-only', { metadata: null })])
    expect(snapshot).toMatchObject({ count: 1, diagnostics: { bodyOnly: ['body-only'], metadataOnly: [], duplicateSessionIds: [] } })
    expect(snapshot.records[0].metadata).toMatchObject({ id: 'body-only', messageCount: 1 })
  })

  it('requires a stable double snapshot, writes and rereads a v1 count/digest backup, and atomically enters pending before mirror', async () => {
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
    storage.prepare('DELETE FROM session_index').run()
    await expect(initializeSessionStateCutover({
      storage,
      repository,
      mirror,
      owner: { id: '104:test', pid: 104 },
      pidAlive: () => false,
    })).rejects.toThrow(/pending integrity/)
    expect(readSessionStorageState().phase).toBe('sqlite_authoritative_json_pending')
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
