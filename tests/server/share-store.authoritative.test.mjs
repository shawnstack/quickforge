import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// F10 Phase 2: share-store write/read paths route through the share repository
// while the share storage is pending/authoritative; the JSON file degrades to a
// best-effort mirror. Every test uses an isolated dataDir + SQLite database.
describe('share-store authoritative lifecycle', () => {
  let tmpDir
  let previousDataDir
  let databaseModule
  let database
  let repository
  let service
  let shareStore

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-store-auth-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    const { createShareRepository } = await import('../../server/sqlite/share-repository.mjs')
    await databaseModule.closeSqliteStorage()
    database = await databaseModule.initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createShareRepository(database)
    service = await import('../../server/share-service.mjs')
    shareStore = await import('../../server/share-store.mjs')
    // The default mirror materializes queue entries into conversation-shares.json.
    service.configureShareService({ repository, mirror: service.createDefaultShareMirror(), phase: 'authoritative' })
  })

  afterEach(async () => {
    service.configureShareService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    service.stopShareService()
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('runs the full lifecycle through the repository: supersede, token invalidation, revoke/restore/update/delete', async () => {
    const events = []
    const removeListener = shareStore.onConversationShareInvalidated((event) => events.push(event))

    const share = await shareStore.createConversationShare({
      sessionId: 'session-a',
      permission: 'read',
      titleSnapshot: 'Auth share',
      scope: 'global',
    })
    expect(share.id).toMatch(/^qfs_/)
    expect(repository.get(share.id)).toMatchObject({ sessionId: 'session-a', permission: 'read' })

    // A second create for the same session updates the same record (no dupes).
    const again = await shareStore.createConversationShare({
      sessionId: 'session-a',
      permission: 'read',
      titleSnapshot: 'Auth share 2',
      scope: 'global',
    })
    expect(again.id).toBe(share.id)
    expect(repository.list({ sessionId: 'session-a' })).toHaveLength(1)

    // Issue a token and verify through the repository-backed path.
    const firstToken = await shareStore.issueConversationShareToken(share.id)
    expect(shareStore.verifyShareToken(await shareStore.readConversationShare(share.id), firstToken.token)).toBe(true)

    // A second active legacy record for the same session is superseded (single
    // transaction) by the next create, and its tokens are cleared.
    const legacy = {
      id: 'qfs_legacy_000000000000000001',
      sessionId: 'session-a',
      permission: 'read',
      titleSnapshot: 'Legacy',
      scope: 'global',
      authVersion: 1,
      allowCloudUsage: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      accessCount: 0,
      tokens: [],
    }
    database.prepare(`INSERT INTO share_sessions (
      share_id, session_id, permission, title_snapshot, scope, project_id, password_hash, password_salt, password_version,
      auth_version, allow_cloud_usage, created_at, updated_at, expires_at, revoked_at, superseded_at,
      access_count, last_accessed_at, created_from_host, last_updated_from_host, revision, extra_json
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, 1, '{}')`)
      .run(legacy.id, legacy.sessionId, legacy.permission, legacy.titleSnapshot, legacy.scope,
        legacy.authVersion, legacy.allowCloudUsage ? 1 : 0, legacy.createdAt, legacy.updatedAt, legacy.accessCount)

    const promoted = await shareStore.createConversationShare({
      sessionId: 'session-a',
      permission: 'operate',
      password: 'secret123',
      scope: 'global',
    })
    expect(promoted.id).toBe(share.id)
    expect(events).toContainEqual({ shareId: legacy.id, reason: 'superseded' })
    expect(events).toContainEqual({ shareId: share.id, reason: 'updated' })
    const superseded = repository.get(legacy.id)
    expect(superseded.supersededAt).toBeTruthy()
    expect(superseded.revokedAt).toBeTruthy()
    // Password change invalidates previously issued tokens.
    expect(shareStore.verifyShareToken(repository.get(share.id), firstToken.token)).toBe(false)

    // Re-share without a password keeps the existing password and newly issued
    // tokens (JSON semantics); inherited password fields are not a password change.
    const postPasswordToken = await shareStore.issueConversationShareToken(share.id)
    expect(shareStore.verifyShareToken(await shareStore.readConversationShare(share.id), postPasswordToken.token)).toBe(true)
    const authVersionBeforeReshare = repository.get(share.id).authVersion
    const reshared = await shareStore.createConversationShare({
      sessionId: 'session-a',
      permission: 'read',
      scope: 'global',
    })
    expect(reshared.id).toBe(share.id)
    expect(reshared.hasPassword).toBe(true)
    expect(repository.get(share.id).authVersion).toBe(authVersionBeforeReshare)
    expect(shareStore.verifyShareToken(await shareStore.readConversationShare(share.id), postPasswordToken.token)).toBe(true)

    // list includes revoked-but-not-superseded shares and excludes superseded ones.
    await shareStore.revokeConversationShare(share.id)
    const revokedList = await shareStore.listConversationShares('session-a')
    expect(revokedList.map((item) => item.id)).toContain(share.id)
    expect(revokedList.map((item) => item.id)).not.toContain(legacy.id)
    expect(events).toContainEqual({ shareId: share.id, reason: 'revoked' })
    expect(shareStore.verifyShareToken(await shareStore.readConversationShare(share.id), firstToken.token)).toBe(false)

    const restored = await shareStore.restoreConversationShare(share.id, new Date(Date.now() + 60_000).toISOString())
    expect(restored.revokedAt).toBeUndefined()
    expect(shareStore.verifyShareToken(await shareStore.readConversationShare(share.id), firstToken.token)).toBe(false)

    const updated = await shareStore.updateConversationShare(share.id, { permission: 'read', password: '' })
    expect(updated.permission).toBe('read')
    expect(updated.hasPassword).toBe(false)

    await shareStore.deleteConversationShare(share.id)
    expect(await shareStore.readConversationShare(share.id)).toBeNull()
    expect(events).toContainEqual({ shareId: share.id, reason: 'deleted' })
    removeListener()
  })

  it('maps CAS conflicts to 409 and blocks writes under the maintenance lock with 423', async () => {
    const share = await shareStore.createConversationShare({
      sessionId: 'cas-session',
      permission: 'read',
      scope: 'global',
    })
    const current = repository.get(share.id)
    try {
      repository.update(share.id, { expiresAt: '2027-01-01T00:00:00.000Z' }, { expectedRevision: current.revision + 1 })
      throw new Error('expected CAS conflict')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SHARE_STATE_CONFLICT', actualRevision: current.revision })
    }

    const { acquireShareMaintenanceLock, releaseShareMaintenanceLock } = await import('../../server/share-cutover.mjs')
    const lease = acquireShareMaintenanceLock(database, {
      owner: { id: 'lock:test', pid: process.pid },
      now: () => Date.now(),
    })
    expect(lease).toBeTruthy()
    await expect(shareStore.createConversationShare({ sessionId: 'lock-session', permission: 'read', scope: 'global' }))
      .rejects.toMatchObject({ statusCode: 423, errorCode: 'SHARE_MAINTENANCE_ACTIVE' })
    expect(releaseShareMaintenanceLock(database, lease)).toBe(true)
  })

  it('falls back to the legacy JSON store in json_authoritative/cutover_running without touching SQLite', async () => {
    const { readSharesJsonFile } = await import('../../server/share-json-file.mjs')
    service.configureShareService({ repository, mirror: service.createDefaultShareMirror(), phase: 'json_authoritative' })

    const share = await shareStore.createConversationShare({ sessionId: 'json-session', permission: 'read', scope: 'global' })
    expect(share.id).toMatch(/^qfs_/)
    expect(repository.list({ sessionId: 'json-session' })).toEqual([])
    expect((await readSharesJsonFile())[share.id]).toMatchObject({ sessionId: 'json-session', permission: 'read' })
    expect(await shareStore.readConversationShare(share.id)).toMatchObject({ sessionId: 'json-session' })

    service.configureShareService({ repository, mirror: service.createDefaultShareMirror(), phase: 'cutover_running' })
    const duringCutover = await shareStore.createConversationShare({ sessionId: 'json-session-2', permission: 'read', scope: 'global' })
    expect(duringCutover.id).not.toBe(share.id)
    expect((await readSharesJsonFile())[duringCutover.id]).toBeDefined()
    expect(repository.list({ sessionId: 'json-session-2' })).toEqual([])
  })

  it('materializes authoritative writes into conversation-shares.json after the mirror drains', async () => {
    const { readSharesJsonFile } = await import('../../server/share-json-file.mjs')
    const share = await shareStore.createConversationShare({
      sessionId: 'mirror-session',
      permission: 'read',
      scope: 'global',
    })
    expect(await readSharesJsonFile()).toEqual({})
    const drained = await service.drainShareJsonMirror()
    expect(drained).toMatchObject({ pending: 0, drained: 1, failed: 0 })
    const file = await readSharesJsonFile()
    expect(file[share.id]).toMatchObject({ id: share.id, sessionId: 'mirror-session', permission: 'read' })
    expect(file[share.id]).not.toHaveProperty('revision')
  })
})
