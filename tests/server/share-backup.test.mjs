import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// share-backup.mjs pins storageDir at module evaluation, so it is imported from
// a fresh module graph after QUICKFORGE_DATA_DIR is set.
describe('share backup snapshot helpers', () => {
  let directory
  let previousDataDir
  let databaseModule
  let storage
  let repository
  let backup

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-backup-'))
    process.env.QUICKFORGE_DATA_DIR = directory
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    const { createShareRepository } = await import('../../server/sqlite/share-repository.mjs')
    storage = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createShareRepository(storage)
    backup = await import('../../server/share-backup.mjs')
  })

  afterEach(async () => {
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(directory, { recursive: true, force: true })
  })

  it('validates the v1 share shape: shareId/sessionId required, tokens array, password fields, duplicate blocker', () => {
    const validRecord = record()
    expect(backup.buildShareJsonSnapshot(sharesStore(validRecord))).toMatchObject({ count: 1 })
    expect(backup.buildShareJsonSnapshot(sharesStore(validRecord)).records[0]).toMatchObject({ id: validRecord.id, sessionId: 'session-one', tokens: [] })

    expect(() => backup.buildShareJsonSnapshot({})).not.toThrow()
    expect(() => backup.buildShareJsonSnapshot([])).toThrow(/object/)
    expect(() => backup.buildShareJsonSnapshot(sharesStore(record({ sessionId: undefined })))).toThrow(/sessionId/)
    expect(() => backup.buildShareJsonSnapshot(sharesStore(record({ tokens: 'not-an-array' })))).toThrow(/array/)
    expect(() => backup.buildShareJsonSnapshot(sharesStore(record({ tokens: [{ tokenHash: '' }] })))).toThrow(/token hash/)
    expect(() => backup.buildShareJsonSnapshot(sharesStore(record({ passwordHash: 'hash-without-salt' })))).toThrow(/salt/)
    expect(() => backup.buildShareJsonSnapshot(sharesStore(record({ passwordSalt: 'salt-without-hash' })))).toThrow(/salt/)
    const mismatched = record()
    expect(() => backup.buildShareJsonSnapshot({ [mismatched.id]: { ...mismatched, id: `qfs_${String(999).padStart(18, '0')}` } })).toThrow(/mismatch/)

    // Duplicate shareId across keys is rejected before anything is written.
    const first = record()
    const duplicate = { ...record(), id: first.id }
    const otherKey = `qfs_${String(888).padStart(18, '0')}`
    expect(() => backup.buildShareJsonSnapshot({ [first.id]: first, [otherKey]: duplicate })).toThrow(/Duplicate share ids/)
  })

  it('computes the exact repository digest for a backup snapshot', () => {
    const seeded = record({ tokens: [{ tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }] })
    repository.replaceAll([seeded], {})
    const snapshot = repository.exportSnapshot()
    expect(snapshot.count).toBe(1)
    expect(backup.computeShareSnapshotDigest({ shares: sharesStore(seeded) })).toBe(snapshot.digest)
  })

  it('roundtrips exportSnapshot records through replaceAll with exact digests', () => {
    const seeded = record({ tokens: [{ tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }] })
    repository.replaceAll([seeded], {})
    const snapshot = repository.exportSnapshot()
    expect(snapshot.records[0].tokens).toEqual([
      { tokenHash: 't1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 },
    ])
    repository.replaceAll(snapshot.records, { expectedCount: snapshot.count, expectedDigest: snapshot.digest })
    expect(repository.exportSnapshot().digest).toBe(snapshot.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
  })

  it('exports under the maintenance lock with count/digest only', async () => {
    repository.replaceAll([record({ sessionId: 'export-one' })], {})
    const exported = await backup.exportShareStateForBackup({ maintenance: true, storage })
    expect(exported).toMatchObject({ count: 1 })
    expect(exported.digest).toBe(repository.digest())
    expect(Object.keys(exported.shares)).toHaveLength(1)
    expect(exported).not.toHaveProperty('phase')
    // The export releases the lock again.
    const { isShareMaintenanceActive } = await import('../../server/share-maintenance.mjs')
    expect(isShareMaintenanceActive(storage)).toBe(false)
  })

  it('rejects invalid restore values without leaving a plan file behind', async () => {
    const planFile = path.join(directory, 'share-restore-plan.json')
    await expect(backup.restoreShareStateSnapshot({ shares: [] }, { planFile })).rejects.toBeInstanceOf(TypeError)
    await expect(backup.restoreShareStateSnapshot({
      shares: { [`qfs_${String(777).padStart(18, '0')}`]: { id: `qfs_${String(777).padStart(18, '0')}`, permission: 'read' } },
    }, { planFile })).rejects.toThrow(/sessionId/)
    await expect(access(planFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
