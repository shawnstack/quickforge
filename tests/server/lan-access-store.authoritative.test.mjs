import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// LAN access storage: SQLite is the single authoritative store. Every test uses
// an isolated dataDir + SQLite database and asserts the store reads/writes the
// repository only (no security/lan-access.json, no mirror, no phase gate).
// Authentication is a security gate: no path may ever fail open.
describe('lan-access-store single-path storage', () => {
  let tmpDir
  let dataDir
  let previousDataDir
  let databaseModule
  let database
  let repository
  let service
  let store

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-store-auth-'))
    dataDir = path.join(tmpDir, 'data')
    process.env.QUICKFORGE_DATA_DIR = dataDir
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    const { createLanAccessRepository } = await import('../../server/sqlite/lan-access-repository.mjs')
    await databaseModule.closeSqliteStorage()
    database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createLanAccessRepository(database)
    service = await import('../../server/lan-access-service.mjs')
    store = await import('../../server/lan-access-store.mjs')
    service.configureLanAccessService({ repository })
  })

  afterEach(async () => {
    service.configureLanAccessService({ repository: null })
    service.stopLanAccessService()
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('runs the full lifecycle through the store: settings, issue/verify, revoke-all, logout, revoke-by-id', async () => {
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

  it('keeps SQLite as the only copy: no security/lan-access.json is written', async () => {
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const issued = await store.issueLanAccessToken('password123', { remoteAddress: '192.168.1.44', userAgent: 'Single Path' })
    await store.readLanAccessStatus()

    const jsonFile = path.join(dataDir, 'storage', 'security', 'lan-access.json')
    await expect(access(jsonFile)).rejects.toMatchObject({ code: 'ENOENT' })

    const config = repository.getConfig()
    expect(config).toMatchObject({ enabled: true, authVersion: 2 })
    expect(config.tokens).toHaveLength(1)
    expect(config.tokens[0]).toMatchObject({ remoteAddress: '192.168.1.44', userAgent: 'Single Path' })
    expect(config.tokens[0]).not.toHaveProperty('revision')
    const status = await store.readLanAccessStatus()
    expect(status).not.toHaveProperty('revision')
    expect(status.activeDevices[0]).not.toHaveProperty('tokenHash')
    expect(await store.verifyLanAccessToken(issued.token)).toBe(true)
  })

  it('maps CAS conflicts to 409 and blocks writes under the maintenance lock with 423', async () => {
    const maintenance = await import('../../server/lan-access-maintenance.mjs')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const currentRevision = repository.getConfig().revision
    try {
      repository.updateSettings({ sessionTtlHours: 24 }, { expectedRevision: currentRevision + 5 })
      throw new Error('expected CAS conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'LAN_ACCESS_STATE_CONFLICT', actualRevision: currentRevision })
    }

    const lease = maintenance.acquireLanAccessMaintenanceLock(database, { owner: { id: 'lock:test', pid: process.pid } })
    expect(lease).toBeTruthy()
    await expect(store.updateLanAccessSettings({ enabled: true, password: 'anotherpass123' }))
      .rejects.toMatchObject({ statusCode: 423, errorCode: 'LAN_ACCESS_MAINTENANCE_ACTIVE' })
    await expect(store.issueLanAccessToken('password123')).rejects.toMatchObject({ statusCode: 423 })
    await expect(store.revokeLanAccessTokens()).rejects.toMatchObject({ statusCode: 423 })
    await expect(store.revokeLanAccessTokenById('any-id')).rejects.toMatchObject({ statusCode: 423 })
    expect(maintenance.releaseLanAccessMaintenanceLock(database, lease)).toBe(true)

    // Writes resume once the lock is released.
    await expect(store.issueLanAccessToken('password123')).resolves.toMatchObject({ maxAge: expect.any(Number) })
  })

  it('starts disabled on a fresh database without a config row (fail closed, never open)', async () => {
    expect(repository.getConfig()).toBeNull()
    const status = await store.readLanAccessStatus()
    expect(status).toMatchObject({ enabled: false, hasPassword: false, activeTokenCount: 0, activeDevices: [] })
    await expect(store.issueLanAccessToken('password123')).rejects.toMatchObject({ statusCode: 403 })
    expect(await store.verifyLanAccessToken('1.whatever')).toBe(false)

    const created = await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    expect(created).toMatchObject({ enabled: true, hasPassword: true })
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 0 })
  })

  it('enforces the ≤100 token cap through the store', async () => {
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })

    const first = await store.issueLanAccessToken('password123')
    // Fill to 100 directly through the repository to avoid 100 password checks.
    for (let index = 1; index < 100; index += 1) repository.issueToken({ remoteAddress: `192.168.1.${index}` })
    expect((await store.readLanAccessStatus()).activeTokenCount).toBe(100)

    await store.issueLanAccessToken('password123', { remoteAddress: '192.168.1.250' })
    const status = await store.readLanAccessStatus()
    expect(status.activeTokenCount).toBe(100)
    // The oldest token fell out of the cap, the newest is addressable.
    expect(status.activeDevices.some((device) => device.id === repository.getConfig().tokens.at(-1).id)).toBe(true)
    expect(await store.verifyLanAccessToken(first.token)).toBe(false)
  })

  it('fails closed when SQLite is unavailable', async () => {
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const issued = await store.issueLanAccessToken('password123')
    await databaseModule.closeSqliteStorage()

    expect(await store.verifyLanAccessToken(issued.token)).toBe(false)
    await expect(store.readLanAccessStatus()).rejects.toThrow()
    await expect(store.updateLanAccessSettings({ enabled: false })).rejects.toThrow()
  })
})
