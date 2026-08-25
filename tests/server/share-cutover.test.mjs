import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'
import {
  acquireShareMaintenanceLock,
  buildShareJsonSnapshot,
  initializeShareCutover,
  releaseShareMaintenanceLock,
  renewShareMaintenanceLock,
} from '../../server/share-cutover.mjs'
import { configureShareService, readShareStorageState } from '../../server/share-service.mjs'

let sequence = 0
function shareId() {
  sequence += 1
  return `qfs_${String(sequence).padStart(18, '0')}`
}

function record(overrides = {}) {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id || shareId(),
    sessionId: overrides.sessionId || 'session-one',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Shared session',
    scope: overrides.scope || 'global',
    projectId: overrides.scope === 'project' ? overrides.projectId || 'project-a' : undefined,
    authVersion: 1,
    allowCloudUsage: false,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: overrides.tokens === undefined ? [] : overrides.tokens,
    ...overrides,
  }
}

function sharesStore(...records) {
  return Object.fromEntries(records.map((entry) => [entry.id, entry]))
}

describe('share storage cutover', () => {
  let directory
  let backupDirectory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-cutover-'))
    backupDirectory = path.join(directory, 'backups')
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createShareRepository(storage)
    configureShareService({ repository, mirror: null, phase: 'json_authoritative' })
  })

  afterEach(async () => {
    configureShareService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('validates the v1 JSON shape: shareId/sessionId required, tokens array, password fields, duplicate blocker', () => {
    const validRecord = record()
    const valid = sharesStore(validRecord)
    expect(buildShareJsonSnapshot(valid)).toMatchObject({ count: 1 })
    expect(buildShareJsonSnapshot(valid).records[0]).toMatchObject({ id: validRecord.id, sessionId: 'session-one', tokens: [] })

    expect(() => buildShareJsonSnapshot({})).not.toThrow()
    expect(() => buildShareJsonSnapshot([])).toThrow(/object/)
    expect(() => buildShareJsonSnapshot(sharesStore(record({ sessionId: undefined })))).toThrow(/sessionId/)
    expect(() => buildShareJsonSnapshot(sharesStore(record({ tokens: 'not-an-array' })))).toThrow(/array/)
    expect(() => buildShareJsonSnapshot(sharesStore(record({ tokens: [{ tokenHash: '' }] })))).toThrow(/token hash/)
    expect(() => buildShareJsonSnapshot(sharesStore(record({ passwordHash: 'hash-without-salt' })))).toThrow(/salt/)
    expect(() => buildShareJsonSnapshot(sharesStore(record({ passwordSalt: 'salt-without-hash' })))).toThrow(/salt/)
    const mismatched = record()
    expect(() => buildShareJsonSnapshot({ [mismatched.id]: { ...mismatched, id: `qfs_${String(999).padStart(18, '0')}` } })).toThrow(/mismatch/)

    // Duplicate shareId across keys blocks the whole cutover.
    const first = record()
    const duplicate = { ...record(), id: first.id }
    const otherKey = `qfs_${String(888).padStart(18, '0')}`
    expect(() => buildShareJsonSnapshot({ [first.id]: first, [otherKey]: duplicate })).toThrow(/Duplicate share ids/)
  })

  it('requires a stable double snapshot, writes a count/digest backup, and commits pending before mirror', async () => {
    const source = sharesStore(record({ tokens: [{ tokenHash: 'token-hash-1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }] }))
    const mirror = { upsert: vi.fn(async () => { throw new Error('mirror failed') }), delete: vi.fn() }
    const state = await initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '100:test', pid: 100 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('sqlite_authoritative_json_pending')
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    expect(repository.listMirrorQueue()).toMatchObject([{ attempts: 1, operation: 'upsert' }])
    const files = await readdir(backupDirectory)
    expect(files).toHaveLength(1)
    const backup = JSON.parse(await readFile(path.join(backupDirectory, files[0]), 'utf8'))
    expect(backup).toMatchObject({ version: 1, shares: { count: 1, digest: state.digest } })
    expect(readShareStorageState().phase).toBe('sqlite_authoritative_json_pending')
  })

  it('returns to JSON before pending on an unstable source', async () => {
    let reads = 0
    const unstable = await initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => {
        reads += 1
        return sharesStore(record({ id: `qfs_${String(reads).padStart(18, '0')}` }))
      }),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '101:test', pid: 101 },
      pidAlive: () => false,
    })
    expect(unstable.phase).toBe('json_authoritative')
    expect(repository.count()).toBe(0)
  })

  it('drains pending mirror without rescanning business rows and preserves cutover metadata', async () => {
    let failMirror = true
    const mirror = {
      upsert: vi.fn(async () => { if (failMirror) throw new Error('mirror failed') }),
      delete: vi.fn(),
    }
    const sourceRecord = record({ customField: { schemaValid: true } })
    const source = sharesStore(sourceRecord)
    const pending = await initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '102:test', pid: 102 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    storage.prepare(`UPDATE share_storage_state SET share_count = 77, digest = ?, backup_file = ?, diagnostic_json = ? WHERE singleton = 1`)
      .run('legacy-state-digest', 'kept-backup.json', JSON.stringify({ legacy: true }))
    storage.prepare("UPDATE share_sessions SET title_snapshot = 'Schema-valid business change' WHERE share_id = ?").run(sourceRecord.id)
    storage.prepare(`INSERT INTO share_tokens (share_id, token_hash, issued_at, expires_at, auth_version)
      VALUES (?, 'maintenance-boundary-token', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 2)`).run(sourceRecord.id)

    failMirror = false
    const recovered = await initializeShareCutover({
      storage,
      repository,
      mirror,
      owner: { id: '103:test', pid: 103 },
      pidAlive: () => false,
    })
    expect(recovered).toMatchObject({
      phase: 'authoritative',
      shareCount: 77,
      digest: 'legacy-state-digest',
      backupFile: 'kept-backup.json',
      diagnostic: { legacy: true },
    })
    expect(repository.listMirrorQueue()).toEqual([])
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, tokenAuthVersionMismatch: 1 })
  })

  it('recovers cutover_running by safely rerunning JSON cutover and preserves authoritative rows', async () => {
    storage.prepare("UPDATE share_storage_state SET phase = 'cutover_running', backup_file = 'existing-backup.json' WHERE singleton = 1").run()
    const source = sharesStore(record())
    const result = await initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '105:test', pid: 105 },
      pidAlive: () => false,
    })
    expect(result.phase).toBe('authoritative')
    expect(repository.list()).toHaveLength(1)
  })

  it('authoritative restart succeeds again after issuing a token', async () => {
    const source = sharesStore(record())
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    const first = await initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '107:test', pid: 107 },
      pidAlive: () => false,
    })
    expect(first.phase).toBe('authoritative')

    const share = repository.list()[0]
    repository.issueToken(share.id, { expectedRevision: share.revision })

    const restarted = await initializeShareCutover({
      storage,
      repository,
      mirror,
      owner: { id: '108:test', pid: 108 },
      pidAlive: () => false,
    })
    expect(restarted.phase).toBe('authoritative')
    expect(repository.get(share.id).tokens).toHaveLength(1)
  })

  it('roundtrips exportSnapshot records through replaceAll with exact digests after cutover', async () => {
    const source = sharesStore(record({ tokens: [{ tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }] }))
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    await initializeShareCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '106:test', pid: 106 },
      pidAlive: () => false,
    })
    const snapshot = repository.exportSnapshot()
    expect(snapshot.count).toBe(1)
    expect(snapshot.records[0].tokens).toEqual([{ tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }])
    repository.replaceAll(snapshot.records, { expectedCount: snapshot.count, expectedDigest: snapshot.digest })
    expect(repository.exportSnapshot().digest).toBe(snapshot.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
  })

  it('fences maintenance locks, heartbeats leases, and steals only expired leases with confirmed dead PIDs', () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const first = acquireShareMaintenanceLock(storage, {
      owner: { id: '111:first', pid: 111 }, now: () => now, ttlMs: 30, pidAlive: () => true,
    })
    expect(first).toMatchObject({ owner: '111:first', fencing: 1 })
    now += 20
    expect(renewShareMaintenanceLock(storage, first, { now: () => now, ttlMs: 30 })).toBe(true)
    now += 20
    expect(acquireShareMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, now: () => now, ttlMs: 30, pidAlive: () => false,
    })).toBeNull()
    now += 20
    const second = acquireShareMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, now: () => now, ttlMs: 30, pidAlive: () => false,
    })
    expect(second).toMatchObject({ owner: '222:second', fencing: 2 })
    expect(releaseShareMaintenanceLock(storage, first)).toBe(false)
    expect(releaseShareMaintenanceLock(storage, second)).toBe(true)
  })
})
