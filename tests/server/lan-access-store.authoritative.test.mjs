import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// F11 Phase 2: lan-access-store read/write paths route through the repository
// while the LAN access storage is pending/authoritative; the JSON file degrades
// to a best-effort mirror. Every test uses an isolated dataDir + SQLite
// database and follows the real startup order (cutover → service → mirror
// drain). Authentication is a security gate: no path may ever fail open.
describe('lan-access-store authoritative lifecycle', () => {
  let tmpDir
  let previousDataDir
  let databaseModule
  let database
  let repository
  let service
  let store
  let cutover
  let jsonFile

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-store-auth-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    const { createLanAccessRepository } = await import('../../server/sqlite/lan-access-repository.mjs')
    await databaseModule.closeSqliteStorage()
    database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createLanAccessRepository(database)
    service = await import('../../server/lan-access-service.mjs')
    store = await import('../../server/lan-access-store.mjs')
    cutover = await import('../../server/lan-access-cutover.mjs')
    jsonFile = await import('../../server/lan-access-json-file.mjs')
  })

  afterEach(async () => {
    service.configureLanAccessService({ repository: null, mirror: null, phase: 'json_authoritative' })
    service.stopLanAccessService()
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('runs the full authoritative lifecycle through the store: settings, issue/verify, revoke-all, logout, revoke-by-id', async () => {
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository })
    expect(state.phase).toBe('authoritative')

    const created = await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    expect(created).toMatchObject({ enabled: true, hasPassword: true, sessionTtlHours: 12 })

    const first = await store.issueLanAccessToken('password123', { remoteAddress: '::ffff:192.168.1.20', userAgent: 'Browser One' })
    const second = await store.issueLanAccessToken('password123', { remoteAddress: '192.168.1.21', userAgent: 'Browser Two' })
    expect(await store.verifyLanAccessToken(first.token)).toBe(true)
    const status = await store.readLanAccessStatus()
    expect(status.activeTokenCount).toBe(2)
    expect(status.activeDevices).toHaveLength(2)
    expect(status.activeDevices[0]).toMatchObject({ address: '192.168.1.20', userAgent: 'Browser One' })
    expect(status.activeDevices[0]).not.toHaveProperty('tokenHash')

    // A password change bumps authVersion and clears every token atomically.
    const changed = await store.updateLanAccessSettings({ enabled: true, password: 'newpassword456', sessionTtlHours: 12 })
    expect(changed.authVersion).toBe(created.authVersion + 1)
    expect(changed.activeTokenCount).toBe(0)
    expect(await store.verifyLanAccessToken(first.token)).toBe(false)
    expect(await store.verifyLanAccessToken(second.token)).toBe(false)

    const third = await store.issueLanAccessToken('newpassword456')
    expect(await store.verifyLanAccessToken(third.token)).toBe(true)

    // revoke-all bumps authVersion and invalidates everything.
    const revoked = await store.revokeLanAccessTokens()
    expect(revoked.authVersion).toBe(changed.authVersion + 1)
    expect(revoked.activeTokenCount).toBe(0)
    expect(await store.verifyLanAccessToken(third.token)).toBe(false)

    // logout is version-gated and takes the raw cookie token.
    const fourth = await store.issueLanAccessToken('newpassword456')
    expect(await store.revokeLanAccessToken(`999.${fourth.token.split('.')[1]}`)).toBe(false)
    expect(await store.revokeLanAccessToken(fourth.token)).toBe(true)
    expect(await store.revokeLanAccessToken(fourth.token)).toBe(false)
    expect(await store.verifyLanAccessToken(fourth.token)).toBe(false)

    // revoke by unknown id stays 404.
    await expect(store.revokeLanAccessTokenById('does-not-exist')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('maps CAS conflicts to 409 and blocks authoritative writes under the maintenance lock with 423', async () => {
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository })
    expect(state.phase).toBe('authoritative')

    const created = await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const currentRevision = repository.getConfig().revision
    try {
      repository.updateSettings({ sessionTtlHours: 24 }, { expectedRevision: currentRevision + 5 })
      throw new Error('expected CAS conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'LAN_ACCESS_STATE_CONFLICT', actualRevision: currentRevision })
    }

    const lease = cutover.acquireLanAccessMaintenanceLock(database, { owner: { id: 'lock:test', pid: process.pid } })
    expect(lease).toBeTruthy()
    await expect(store.updateLanAccessSettings({ enabled: true, password: 'anotherpass123' }))
      .rejects.toMatchObject({ statusCode: 423, errorCode: 'LAN_ACCESS_MAINTENANCE_ACTIVE' })
    await expect(store.issueLanAccessToken('password123')).rejects.toMatchObject({ statusCode: 423 })
    await expect(store.revokeLanAccessTokens()).rejects.toMatchObject({ statusCode: 423 })
    await expect(store.revokeLanAccessTokenById('any-id')).rejects.toMatchObject({ statusCode: 423 })
    expect(cutover.releaseLanAccessMaintenanceLock(database, lease)).toBe(true)

    // Writes resume once the lock is released.
    await expect(store.issueLanAccessToken('password123')).resolves.toMatchObject({ maxAge: expect.any(Number) })
  })

  it('falls back to the legacy JSON store in json_authoritative/cutover_running without touching SQLite', async () => {
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository, mirror })
    expect(state.phase).toBe('authoritative')

    service.configureLanAccessService({ phase: 'json_authoritative' })
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const file = await jsonFile.readLanAccessJsonFile()
    expect(file).toMatchObject({ enabled: true })
    // The SQLite copy keeps its cutover state: JSON writes never touch it.
    expect(repository.getConfig()).toMatchObject({ enabled: false })

    const token = await store.issueLanAccessToken('password123')
    expect(await store.verifyLanAccessToken(token.token)).toBe(true)
    expect((await store.readLanAccessStatus()).activeTokenCount).toBe(1)

    service.configureLanAccessService({ phase: 'cutover_running' })
    expect((await store.readLanAccessStatus()).activeTokenCount).toBe(1)
  })

  it('materializes authoritative store writes into lan-access.json after the mirror drains', async () => {
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository })
    expect(state.phase).toBe('authoritative')

    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    // Before the drain the mirror file still holds the cutover-time default.
    expect(await jsonFile.readLanAccessJsonFile()).toMatchObject({ enabled: false })

    const drained = await service.drainLanAccessJsonMirror()
    expect(drained).toMatchObject({ pending: 0, drained: 1, failed: 0 })
    const file = await jsonFile.readLanAccessJsonFile()
    expect(file).toMatchObject({ enabled: true, authVersion: 2, sessionTtlHours: 12 })
    expect(file.tokens).toEqual([])
    expect(file).not.toHaveProperty('revision')
  })

  it('follows the startup order cutover → service → drain and releases resources on shutdown', async () => {
    expect(service.getLanAccessStoragePhase()).toBe('json_authoritative')

    // 1. initializeLanAccessCutover (JSON source is the default disabled file).
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository })
    expect(state.phase).toBe('authoritative')

    // 2. initializeLanAccessService.
    expect(service.initializeLanAccessService().phase).toBe('authoritative')

    // 3. drainLanAccessJsonMirror is idempotent after cutover drained.
    await expect(service.drainLanAccessJsonMirror()).resolves.toMatchObject({ pending: 0, drained: 0, failed: 0 })

    // The store is now repository-backed.
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const token = await store.issueLanAccessToken('password123')
    expect(await store.verifyLanAccessToken(token.token)).toBe(true)

    // Shutdown releases the mirror timer and the SQLite handle can reopen.
    service.stopLanAccessService()
    await databaseModule.closeSqliteStorage()
    const reopened = await databaseModule.initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    expect(reopened.prepare('SELECT phase FROM lan_access_storage_state WHERE singleton = 1').get()).toMatchObject({ phase: 'authoritative' })
  })

  it('keeps pending startup non-scanning while verifyIntegrity remains the relationship maintenance boundary', async () => {
    const mirror = { upsert: vi.fn(async () => { throw new Error('mirror failed') }), delete: vi.fn() }
    const pending = await cutover.initializeLanAccessCutover({ storage: database, repository, mirror })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')

    // Pending is already SQLite-readable: the store writes through the repository.
    const created = await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    expect(created.enabled).toBe(true)
    expect(repository.getConfig()).toMatchObject({ enabled: true })

    await store.issueLanAccessToken('password123')
    database.prepare('UPDATE lan_access_tokens SET auth_version = auth_version + 1').run()
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, tokenAuthVersionMismatch: 1 })
    await expect(cutover.initializeLanAccessCutover({ storage: database, repository, mirror }))
      .resolves.toMatchObject({ phase: 'sqlite_authoritative_json_pending' })
  })

  it('enforces the ≤100 token cap through the store', async () => {
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository })
    expect(state.phase).toBe('authoritative')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })

    const first = await store.issueLanAccessToken('password123')
    // Fill to 100 directly through the repository to avoid 100 password checks.
    for (let index = 0; index < 99; index += 1) repository.issueToken({ remoteAddress: `192.168.1.${index}` })
    expect(repository.getConfig().tokens).toHaveLength(100)

    // The 101st token issued through the store evicts the oldest one.
    const last = await store.issueLanAccessToken('password123')
    expect(await store.verifyLanAccessToken(last.token)).toBe(true)
    expect(await store.verifyLanAccessToken(first.token)).toBe(false)
    const status = await store.readLanAccessStatus()
    expect(status.activeTokenCount).toBe(100)
    expect(status.activeDevices).toHaveLength(100)
  })

  it('rejects invalid, expired, version-mismatched and missing-record tokens (never fails open)', async () => {
    const state = await cutover.initializeLanAccessCutover({ storage: database, repository })
    expect(state.phase).toBe('authoritative')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })

    const issued = await store.issueLanAccessToken('password123')
    const [version, secret] = issued.token.split('.')
    expect(await store.verifyLanAccessToken(issued.token)).toBe(true)
    expect(await store.verifyLanAccessToken(`${Number(version) + 1}.${secret}`)).toBe(false)
    expect(await store.verifyLanAccessToken(`${version}.wrong-secret`)).toBe(false)
    expect(await store.verifyLanAccessToken(`${version}.`)).toBe(false)
    expect(await store.verifyLanAccessToken(secret)).toBe(false)
    expect(await store.verifyLanAccessToken('')).toBe(false)
    expect(await store.verifyLanAccessToken(null)).toBe(false)
    expect(await store.verifyLanAccessToken(undefined)).toBe(false)
    expect(await store.verifyLanAccessToken(12345)).toBe(false)
    expect(await store.verifyLanAccessToken({})).toBe(false)

    // An expired token is rejected.
    database.prepare('UPDATE lan_access_tokens SET expires_at = ?').run('2020-01-01T00:00:00.000Z')
    expect(await store.verifyLanAccessToken(issued.token)).toBe(false)

    // Missing token rows are rejected.
    database.prepare('DELETE FROM lan_access_tokens').run()
    expect(await store.verifyLanAccessToken(issued.token)).toBe(false)

    // A missing config row is rejected (never fails open on damaged storage).
    database.prepare('DELETE FROM lan_access_state').run()
    expect(await store.verifyLanAccessToken(issued.token)).toBe(false)
  })
})
