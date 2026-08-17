import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

let sequence = 100
function shareId(prefix) {
  sequence += 1
  return `qfs_${prefix || ''}${String(sequence).padStart(18 - (prefix || '').length, '0')}`
}

function record(overrides = {}) {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id || shareId(),
    sessionId: overrides.sessionId || 'session-one',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Shared session',
    scope: overrides.scope || 'global',
    authVersion: 1,
    allowCloudUsage: false,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: overrides.tokens === undefined ? [] : overrides.tokens,
    ...overrides,
  }
}

/**
 * Set up a real authoritative share state environment (temp data dir + SQLite
 * schema v8 + share cutover to authoritative with seeded v1 JSON) and freshly
 * import the route so dataDir/storageDir/sqlite paths all resolve inside the
 * temp dir.
 */
async function withAuthoritativeShareBackup(seedShares, testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-backup-share-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  let database
  try {
    const backup = await import('../../server/routes/backup.mjs')
    const storage = await import('../../server/storage.mjs')
    database = await import('../../server/sqlite/database.mjs')
    const repoModule = await import('../../server/sqlite/share-repository.mjs')
    const service = await import('../../server/share-service.mjs')
    const cutover = await import('../../server/share-cutover.mjs')
    await storage.ensureStorage()
    const sqliteStorage = await database.initializeSqliteStorage({ dataDir: tmpDir })
    const repository = repoModule.createShareRepository(sqliteStorage)
    service.configureShareService({ repository, mirror: null, phase: 'json_authoritative' })
    const sharesFile = path.join(tmpDir, 'storage', 'shares', 'conversation-shares.json')
    await fs.mkdir(path.dirname(sharesFile), { recursive: true })
    await fs.writeFile(sharesFile, `${JSON.stringify(seedShares)}\n`, 'utf8')
    const state = await cutover.initializeShareCutover({
      storage: sqliteStorage,
      repository,
      backupDirectory: path.join(tmpDir, 'storage', 'backups'),
      mirror: { upsert: async () => {}, delete: async () => {} },
      owner: { id: '500:test', pid: 500 },
      pidAlive: () => false,
    })
    if (state.phase !== 'authoritative') throw new Error(`expected authoritative, got ${state.phase}`)
    await testFn(backup, storage, service, repository, sqliteStorage, cutover)
  } finally {
    await database.closeSqliteStorage().catch(() => {})
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function mockRes() {
  const res = { headersSent: false, _status: null, _body: '' }
  res.writeHead = (status) => { res._status = status; res.headersSent = true }
  res.end = (body) => { res._body = body ?? '' }
  return res
}

function mockReq(jsonBody) {
  const text = JSON.stringify(jsonBody)
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      const chunks = [text]
      return {
        async next() {
          if (i < chunks.length) return { value: Buffer.from(chunks[i++]), done: false }
          return { done: true }
        },
      }
    },
  }
}

async function callExport(backup, urlText = 'http://localhost/api/backup/export?scope=shares') {
  const url = new URL(urlText)
  const req = { method: 'GET' }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

async function callImport(backup, body) {
  const url = new URL('http://localhost/api/backup/import')
  const req = { method: 'POST', ...mockReq(body) }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

describe('backup route — authoritative share state', () => {
  it('exports shares with shareState phase/count/digest including tokens (scope=shares and scope=all)', async () => {
    const seeded = record({ id: shareId(), sessionId: 'seed', titleSnapshot: 'Seed' })
    const withToken = record({
      id: shareId(),
      sessionId: 'token-session',
      titleSnapshot: 'With token',
      tokens: [{ tokenHash: 'token-hash-abc', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }],
    })
    await withAuthoritativeShareBackup({ [seeded.id]: seeded, [withToken.id]: withToken }, async (backup, storage, service, repository) => {
      const { res, json } = await callExport(backup)
      expect(res._status).toBe(200)
      expect(json.scope).toBe('shares')
      expect(json.shareState).toMatchObject({ phase: 'authoritative', count: 2 })
      expect(json.shareState.digest).toBe(repository.digest())
      expect(Object.keys(json.data.shares).sort()).toEqual([seeded.id, withToken.id].sort())
      expect(json.data.shares[withToken.id].tokens).toEqual([
        { tokenHash: 'token-hash-abc', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 },
      ])
      expect(json.data.shares[seeded.id]).not.toHaveProperty('revision')

      const all = await callExport(backup, 'http://localhost/api/backup/export?scope=all')
      expect(all.res._status).toBe(200)
      expect(all.json.data.shares[withToken.id].id).toBe(withToken.id)
      expect(all.json.shareState.digest).toBe(repository.digest())
    })
  })

  it('imports shares in replace mode and leaves scheduled_task_runs untouched', async () => {
    const seedShare = record({ id: shareId(), sessionId: 'seed', titleSnapshot: 'Seed' })
    await withAuthoritativeShareBackup({ [seedShare.id]: seedShare }, async (backup, storage, service, repository, sqliteStorage) => {
      const runsModule = await import('../../server/sqlite/scheduled-task-runs-repository.mjs')
      const runsRepository = runsModule.createScheduledTaskRunsRepository(sqliteStorage)
      runsRepository.create('task-a', { id: 'run-1', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' })

      const importId = shareId('imp')
      const payload = {
        backup: {
          app: 'quickforge',
          version: 1,
          exportedAt: new Date().toISOString(),
          scope: 'shares',
          data: {
            shares: { [importId]: record({ id: importId, sessionId: 'imported', titleSnapshot: 'Imported' }) },
          },
        },
        sections: ['shares'],
        mode: 'replace',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.summary.shares).toBe(1)
      expect(repository.count()).toBe(1)
      expect(repository.get(importId).titleSnapshot).toBe('Imported')
      expect(repository.get(seedShare.id)).toBeNull()
      expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
      // F5 scheduled_task_runs must not be touched by a share restore.
      expect(runsRepository.list({ taskIds: ['task-a'], page: 1, pageSize: 10 }).total).toBe(1)
    })
  })

  it('imports shares in merge mode preserving local-only records and overriding same keys', async () => {
    const localOnly = record({ id: shareId(), sessionId: 'local', titleSnapshot: 'Local only' })
    const override = record({ id: shareId(), sessionId: 'override', titleSnapshot: 'Old title' })
    await withAuthoritativeShareBackup({ [localOnly.id]: localOnly, [override.id]: override }, async (backup, storage, service, repository) => {
      const added = record({ id: shareId(), sessionId: 'added', titleSnapshot: 'Added' })
      const payload = {
        backup: {
          data: {
            shares: {
              [added.id]: added,
              [override.id]: record({ ...override, titleSnapshot: 'New title' }),
            },
          },
        },
        sections: ['shares'],
        mode: 'merge',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.summary.shares).toBe(3)
      expect(repository.count()).toBe(3)
      expect(repository.get(localOnly.id).titleSnapshot).toBe('Local only')
      expect(repository.get(added.id).titleSnapshot).toBe('Added')
      expect(repository.get(override.id).titleSnapshot).toBe('New title')
    })
  })

  it('imports a legacy v1 conversation-shares.json shape without an envelope (single-token fields normalized)', async () => {
    const legacyId = shareId('legacy')
    const legacy = {
      id: legacyId,
      sessionId: 'legacy-session',
      permission: 'read',
      titleSnapshot: 'Legacy',
      scope: 'global',
      authVersion: 1,
      allowCloudUsage: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      accessCount: 0,
      tokenHash: 'legacy-token-hash',
      tokenIssuedAt: '2026-01-01T00:00:00.000Z',
      tokenExpiresAt: '2027-01-01T00:00:00.000Z',
    }
    await withAuthoritativeShareBackup({}, async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          data: {
            shares: { [legacyId]: legacy },
          },
        },
        sections: ['shares'],
        mode: 'replace',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.summary.shares).toBe(1)
      const stored = repository.get(legacyId)
      expect(stored.titleSnapshot).toBe('Legacy')
      expect(stored.tokens).toEqual([
        { tokenHash: 'legacy-token-hash', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 },
      ])
      expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    })
  })

  it('rejects import with 423 while share maintenance is active', async () => {
    const seedShare = record({ id: shareId(), sessionId: 'seed', titleSnapshot: 'Seed' })
    await withAuthoritativeShareBackup({ [seedShare.id]: seedShare }, async (backup, storage, service, repository, sqliteStorage, cutover) => {
      const lease = cutover.acquireShareMaintenanceLock(sqliteStorage, {
        owner: { id: '999:test', pid: 999 },
        pidAlive: () => true,
        operation: 'other-maintenance',
      })
      expect(lease).not.toBeNull()
      const importId = shareId('blocked')
      const payload = {
        backup: {
          data: {
            shares: { [importId]: record({ id: importId, sessionId: 'blocked', titleSnapshot: 'Blocked' }) },
          },
        },
        sections: ['shares'],
        mode: 'replace',
      }
      const url = new URL('http://localhost/api/backup/import')
      await expect(backup.handleBackupApi({ method: 'POST', ...mockReq(payload) }, mockRes(), url))
        .rejects.toMatchObject({ statusCode: 423, errorCode: 'share_maintenance' })
      expect(repository.count()).toBe(1)
      cutover.releaseShareMaintenanceLock(sqliteStorage, lease)
    })
  })

  it('defines empty-shares import semantics: replace wipes, merge keeps local', async () => {
    const local = record({ id: shareId(), sessionId: 'local', titleSnapshot: 'Local' })
    await withAuthoritativeShareBackup({ [local.id]: local }, async (backup, storage, service, repository) => {
      const wipe = {
        backup: { data: { shares: {} } },
        sections: ['shares'],
        mode: 'replace',
      }
      const replaced = await callImport(backup, wipe)
      expect(replaced.res._status).toBe(200)
      expect(replaced.json.summary.shares).toBe(0)
      expect(repository.count()).toBe(0)

      // Re-seed through the repository so merge has something to preserve.
      const seeded = record({ id: shareId(), sessionId: 'seeded', titleSnapshot: 'Seeded' })
      repository.replaceAll([record({ ...seeded })], {})
      const keep = {
        backup: { data: { shares: {} } },
        sections: ['shares'],
        mode: 'merge',
      }
      const merged = await callImport(backup, keep)
      expect(merged.res._status).toBe(200)
      expect(merged.json.summary.shares).toBe(1)
      expect(repository.count()).toBe(1)
      expect(repository.get(seeded.id).titleSnapshot).toBe('Seeded')
    })
  })
})
