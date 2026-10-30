import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Single authoritative path: every share-store read/write goes through the
// share repository (SQLite). The historical JSON file path and its mirror queue
// drain are gone, so no conversation-shares.json is ever written.
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
    service.configureShareService({ repository })
  })

  afterEach(async () => {
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

    // A second active record for the same session is superseded (single
    // transaction) by the next create, and its tokens are cleared.
    const legacy = {
      id: 'qfs_legacy_000000000000000001',
      sessionId: 'session-a',
      permission: 'read',
      titleSnapshot: 'Legacy',
      scope: 'global',
      authVersion: 1,
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
        legacy.authVersion, 0, legacy.createdAt, legacy.updatedAt, legacy.accessCount)

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
    // tokens; inherited password fields are not a password change.
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

  it('rejects expiration times that are not in the future', async () => {
    const share = await shareStore.createConversationShare({ sessionId: 'session-exp', permission: 'read', scope: 'global' })
    const past = new Date(Date.now() - 1000).toISOString()
    const future = new Date(Date.now() + 120_000).toISOString()

    await expect(shareStore.restoreConversationShare(share.id, past)).rejects.toMatchObject({ statusCode: 400 })
    await expect(shareStore.updateConversationShareExpiration(share.id, past)).rejects.toMatchObject({ statusCode: 400 })

    const extended = await shareStore.updateConversationShareExpiration(share.id, future)
    expect(extended.expiresAt).toBe(future)
    expect(repository.get(share.id).expiresAt).toBe(future)

    const revoked = await shareStore.revokeConversationShare(share.id)
    expect(revoked.revokedAt).toBeTruthy()
    const restored = await shareStore.restoreConversationShare(share.id, future)
    expect(restored.revokedAt).toBeUndefined()
  })

  it('rejects an editable share without a password and keeps password semantics on update', async () => {
    const share = await shareStore.createConversationShare({ sessionId: 'session-pass', permission: 'read', scope: 'global' })
    await expect(shareStore.createConversationShare({ sessionId: 'session-pass-operate', permission: 'operate', scope: 'global' }))
      .rejects.toMatchObject({ statusCode: 400 })

    const token = await shareStore.issueConversationShareToken(share.id)
    const secured = await shareStore.updateConversationShare(share.id, { permission: 'operate', password: 'secret123' })
    expect(secured).toMatchObject({ permission: 'operate', hasPassword: true })
    expect(shareStore.verifyShareToken(repository.get(share.id), token.token)).toBe(false)

    await expect(shareStore.updateConversationShare(share.id, { permission: 'operate', password: '' }))
      .rejects.toMatchObject({ statusCode: 400 })

    const passwordless = await shareStore.updateConversationShare(share.id, { permission: 'read', password: '' })
    expect(passwordless.hasPassword).toBe(false)
    const kept = await shareStore.updateConversationShare(share.id, { permission: 'read' })
    expect(kept).toMatchObject({ hasPassword: false, permission: 'read' })
    await expect(shareStore.readConversationShare('not-a-share-id')).rejects.toMatchObject({ statusCode: 400 })
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

    const { acquireShareMaintenanceLock, releaseShareMaintenanceLock } = await import('../../server/share-maintenance.mjs')
    const lease = acquireShareMaintenanceLock(database, {
      owner: { id: 'lock:test', pid: process.pid },
      now: () => Date.now(),
    })
    expect(lease).toBeTruthy()
    await expect(shareStore.createConversationShare({ sessionId: 'lock-session', permission: 'read', scope: 'global' }))
      .rejects.toMatchObject({ statusCode: 423, errorCode: 'SHARE_MAINTENANCE_ACTIVE' })
    expect(releaseShareMaintenanceLock(database, lease)).toBe(true)
  })

  it('never writes the retired conversation-shares.json store', async () => {
    const share = await shareStore.createConversationShare({ sessionId: 'fileless-session', permission: 'read', scope: 'global' })
    expect(repository.get(share.id)).toBeTruthy()
    await expect(access(path.join(tmpDir, 'data', 'shares', 'conversation-shares.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
