import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createLanAccessRepository } from '../../server/sqlite/lan-access-repository.mjs'
import {
  acquireLanAccessMaintenanceLock,
  buildLanAccessJsonSnapshot,
  initializeLanAccessCutover,
  releaseLanAccessMaintenanceLock,
  renewLanAccessMaintenanceLock,
} from '../../server/lan-access-cutover.mjs'
import { configureLanAccessService, readLanAccessStorageState } from '../../server/lan-access-service.mjs'

function lanConfig(overrides = {}) {
  const updatedAt = '2026-01-01T00:00:00.000Z'
  return {
    enabled: false,
    passwordHash: undefined,
    passwordSalt: undefined,
    passwordVersion: undefined,
    authVersion: 1,
    sessionTtlHours: 12,
    updatedAt,
    tokens: [],
    ...overrides,
  }
}

function enabledConfig(tokens = []) {
  return lanConfig({
    enabled: true,
    passwordHash: 'aGVsbG8td29ybGQ',
    passwordSalt: 'c2FsdC1mb3ItbGFu',
    passwordVersion: 1,
    tokens,
  })
}

describe('LAN access storage cutover', () => {
  let directory
  let backupDirectory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-cutover-'))
    backupDirectory = path.join(directory, 'backups')
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createLanAccessRepository(storage)
    configureLanAccessService({ repository, mirror: null, phase: 'json_authoritative' })
  })

  afterEach(async () => {
    configureLanAccessService({ repository: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('validates the JSON shape: enabled/passwordHash pairing, tokens structure, malformed config blocker', () => {
    expect(buildLanAccessJsonSnapshot(enabledConfig())).toMatchObject({ tokenCount: 0 })
    expect(buildLanAccessJsonSnapshot(enabledConfig([{ tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }])).tokenCount).toBe(1)

    expect(() => buildLanAccessJsonSnapshot([])).toThrow(/object/)
    expect(() => buildLanAccessJsonSnapshot(lanConfig({ enabled: true }))).toThrow(/password/)
    expect(() => buildLanAccessJsonSnapshot(lanConfig({ passwordHash: 'hash-without-salt' }))).toThrow(/salt/)
    expect(() => buildLanAccessJsonSnapshot(lanConfig({ passwordSalt: 'salt-without-hash' }))).toThrow(/salt/)
    expect(() => buildLanAccessJsonSnapshot(enabledConfig('not-an-array'))).toThrow(/array/)
    expect(() => buildLanAccessJsonSnapshot(enabledConfig([{ tokenHash: '' }]))).toThrow(/token hash/)
    expect(() => buildLanAccessJsonSnapshot(enabledConfig([{ tokenHash: 'x', authVersion: 0 }]))).toThrow(/authVersion/)
  })

  it('requires a stable double snapshot, writes a count/digest backup, and commits pending before mirror', async () => {
    const source = enabledConfig([{ tokenHash: 'token-hash-1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }])
    const mirror = { upsert: vi.fn(async () => { throw new Error('mirror failed') }), delete: vi.fn() }
    const state = await initializeLanAccessCutover({
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
    expect(backup).toMatchObject({ version: 1, scope: 'lan-access', lanAccess: { tokenCount: 1, digest: state.digest } })
    expect(backup.data.lanAccess).toMatchObject({ enabled: true })
    expect(readLanAccessStorageState().phase).toBe('sqlite_authoritative_json_pending')
  })

  it('returns to JSON before pending on an unstable source', async () => {
    let reads = 0
    const unstable = await initializeLanAccessCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => {
        reads += 1
        return enabledConfig([{ tokenHash: `t-${reads}`, issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }])
      }),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '101:test', pid: 101 },
      pidAlive: () => false,
    })
    expect(unstable.phase).toBe('json_authoritative')
    expect(repository.getConfig()).toBeNull()
  })

  it('drains pending mirror without rescanning business rows and preserves cutover metadata', async () => {
    let failMirror = true
    const mirror = {
      upsert: vi.fn(async () => { if (failMirror) throw new Error('mirror failed') }),
      delete: vi.fn(),
    }
    const source = enabledConfig([{ tokenHash: 'stable-hash', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }])
    const pending = await initializeLanAccessCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '102:test', pid: 102 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    storage.prepare(`UPDATE lan_access_storage_state SET lan_token_count = 77, digest = ?, backup_file = ?, diagnostic_json = ? WHERE singleton = 1`)
      .run('legacy-state-digest', 'kept-backup.json', JSON.stringify({ legacy: true }))
    storage.prepare('UPDATE lan_access_state SET session_ttl_hours = 24 WHERE singleton = 1').run()
    storage.prepare('UPDATE lan_access_tokens SET auth_version = auth_version + 1').run()

    failMirror = false
    const recovered = await initializeLanAccessCutover({
      storage,
      repository,
      mirror,
      owner: { id: '103:test', pid: 103 },
      pidAlive: () => false,
    })
    expect(recovered).toMatchObject({
      phase: 'authoritative',
      lanTokenCount: 77,
      digest: 'legacy-state-digest',
      backupFile: 'kept-backup.json',
      diagnostic: { legacy: true },
    })
    expect(repository.listMirrorQueue()).toEqual([])
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, tokenAuthVersionMismatch: 1 })
  })

  it('recovers cutover_running by safely rerunning JSON cutover and preserves the authoritative row', async () => {
    storage.prepare("UPDATE lan_access_storage_state SET phase = 'cutover_running', backup_file = 'existing-backup.json' WHERE singleton = 1").run()
    const source = enabledConfig()
    const result = await initializeLanAccessCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '105:test', pid: 105 },
      pidAlive: () => false,
    })
    expect(result.phase).toBe('authoritative')
    expect(repository.getConfig()).toMatchObject({ enabled: true, authVersion: 1 })
  })

  it('authoritative restart succeeds again after issuing a token', async () => {
    const source = enabledConfig()
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    const first = await initializeLanAccessCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '107:test', pid: 107 },
      pidAlive: () => false,
    })
    expect(first.phase).toBe('authoritative')

    repository.issueToken({ remoteAddress: '192.168.1.20' })

    const restarted = await initializeLanAccessCutover({
      storage,
      repository,
      mirror,
      owner: { id: '108:test', pid: 108 },
      pidAlive: () => false,
    })
    expect(restarted.phase).toBe('authoritative')
    expect(repository.getConfig().tokens).toHaveLength(1)
  })

  it('roundtrips exportSnapshot records through replaceAll with exact digests after cutover', async () => {
    const source = enabledConfig([{ tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z', authVersion: 1 }])
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    await initializeLanAccessCutover({
      storage,
      repository,
      backupDirectory,
      readJson: vi.fn(async () => structuredClone(source)),
      mirror,
      owner: { id: '106:test', pid: 106 },
      pidAlive: () => false,
    })
    const snapshot = repository.exportSnapshot()
    expect(snapshot.tokenCount).toBe(1)
    expect(snapshot.config.tokens).toEqual([{
      id: expect.stringMatching(/^legacy_/),
      tokenHash: 't1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2100-01-01T00:00:00.000Z',
      authVersion: 1,
      remoteAddress: undefined,
      userAgent: undefined,
    }])
    repository.replaceAll(snapshot.config, { expectedCount: snapshot.tokenCount, expectedDigest: snapshot.digest })
    expect(repository.exportSnapshot().digest).toBe(snapshot.digest)
  })

  it('acquires a fencing maintenance lock with expiry and heartbeat renewal', async () => {
    const first = acquireLanAccessMaintenanceLock(storage, { owner: { id: '1:test', pid: 1 }, pidAlive: () => false, ttlMs: 10_000 })
    expect(first).toMatchObject({ owner: '1:test', ownerPid: 1, fencing: 1 })
    // A second owner cannot take the lock while it is alive.
    expect(acquireLanAccessMaintenanceLock(storage, { owner: { id: '2:test', pid: 2 }, pidAlive: () => false, ttlMs: 10_000 })).toBeNull()
    // The same owner can renew its lease (heartbeat).
    expect(renewLanAccessMaintenanceLock(storage, first, { ttlMs: 20_000 })).toBe(true)
    expect(Date.parse(first.expiresAt)).toBeGreaterThan(Date.now() + 15_000)

    // After expiry with a dead owner, the next acquirer bumps fencing.
    const nowMs = Date.now() + 60_000
    const takeover = acquireLanAccessMaintenanceLock(storage, {
      owner: { id: '2:test', pid: 2 },
      pidAlive: () => false,
      ttlMs: 10_000,
      now: () => nowMs,
    })
    expect(takeover).toMatchObject({ owner: '2:test', ownerPid: 2, fencing: 2 })
    expect(releaseLanAccessMaintenanceLock(storage, takeover)).toBe(true)
  })
})
