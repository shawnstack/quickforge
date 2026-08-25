import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

/**
 * F11 Phase 3: the backup route must export/restore the authoritative
 * lan-access state under the lan-access maintenance lock (quick_check +
 * verifyIntegrity + exportSnapshot, count/digest fail closed, token hashes
 * only), with replace/merge semantics, plan-file compensation, a 423 gate and
 * v1 lan-access.json normalization. The restore is scoped to the lan-access
 * tables and must never disturb F5 scheduled_task_runs, the storage-v2
 * session domain (sessions/session_messages) or F10 share_sessions.
 */

function lanConfig(overrides = {}) {
  return {
    enabled: false,
    passwordHash: undefined,
    passwordSalt: undefined,
    passwordVersion: undefined,
    authVersion: 1,
    sessionTtlHours: 12,
    updatedAt: '2026-01-01T00:00:00.000Z',
    tokens: [],
    ...overrides,
  }
}

/**
 * Set up a real authoritative lan-access state environment (temp data dir +
 * SQLite schema v9 + lan-access cutover to authoritative from a seeded JSON
 * file) and freshly import the route so dataDir/storageDir/sqlite paths all
 * resolve inside the temp dir.
 */
async function withAuthoritativeLanAccessBackup(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-backup-lan-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  let database
  try {
    const backup = await import('../../server/routes/backup.mjs')
    const storage = await import('../../server/storage.mjs')
    database = await import('../../server/sqlite/database.mjs')
    const repoModule = await import('../../server/sqlite/lan-access-repository.mjs')
    const service = await import('../../server/lan-access-service.mjs')
    const cutover = await import('../../server/lan-access-cutover.mjs')
    await storage.ensureStorage()
    const sqliteStorage = await database.initializeSqliteStorage({ dataDir: tmpDir })
    const repository = repoModule.createLanAccessRepository(sqliteStorage)
    service.configureLanAccessService({ repository, mirror: null, phase: 'json_authoritative' })
    const lanAccessFile = path.join(tmpDir, 'storage', 'security', 'lan-access.json')
    await fs.mkdir(path.dirname(lanAccessFile), { recursive: true })
    await fs.writeFile(lanAccessFile, `${JSON.stringify(lanConfig())}\n`, 'utf8')
    const state = await cutover.initializeLanAccessCutover({
      storage: sqliteStorage,
      repository,
      backupDirectory: path.join(tmpDir, 'storage', 'backups'),
      mirror: { upsert: async () => {}, delete: async () => {} },
      owner: { id: '700:test', pid: 700 },
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

async function callExport(backup, urlText = 'http://localhost/api/backup/export?scope=lan-access') {
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

async function callInspect(backup, body) {
  const url = new URL('http://localhost/api/backup/inspect')
  const req = { method: 'POST', ...mockReq(body) }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

// Seed the authoritative state with an enabled config plus one issued token.
function enableWithToken(repository) {
  repository.updateSettings({
    enabled: true,
    passwordHash: 'bGFuLWFjY2Vzcy1oYXNo',
    passwordSalt: 'bGFuLWFjY2Vzcy1zYWx0',
    passwordVersion: 1,
    sessionTtlHours: 12,
  })
  return repository.issueToken({ remoteAddress: '192.168.1.50', userAgent: 'Route Test' })
}

describe('backup route — authoritative lan-access state', () => {
  it('exports lanAccess with lanAccessState phase/count/digest including token hashes (scope=lan-access and scope=all)', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository) => {
      const issued = enableWithToken(repository)

      const { res, json } = await callExport(backup)
      expect(res._status).toBe(200)
      expect(json.scope).toBe('lan-access')
      expect(json.lanAccessState).toMatchObject({ phase: 'authoritative', count: 1 })
      expect(json.lanAccessState.digest).toBe(repository.digest())
      expect(json.data.lanAccess.enabled).toBe(true)
      expect(json.data.lanAccess.authVersion).toBe(repository.getConfig().authVersion)
      expect(json.data.lanAccess.tokens).toHaveLength(1)
      expect(json.data.lanAccess.tokens[0].tokenHash).toBeTruthy()
      expect(json.data.lanAccess.tokens[0].tokenHash).not.toContain(issued.token.split('.')[1])
      expect(json.data.lanAccess.tokens[0]).toMatchObject({ remoteAddress: '192.168.1.50', userAgent: 'Route Test' })
      expect(json.data.lanAccess).not.toHaveProperty('revision')

      const all = await callExport(backup, 'http://localhost/api/backup/export?scope=all')
      expect(all.res._status).toBe(200)
      expect(all.json.data.lanAccess.enabled).toBe(true)
      expect(all.json.lanAccessState.digest).toBe(repository.digest())
    })
  })

  it('imports lanAccess in replace mode and leaves F5/session/share domains untouched', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository, sqliteStorage) => {
      // Seed the other storage domains before the restore.
      const runsModule = await import('../../server/sqlite/scheduled-task-runs-repository.mjs')
      const runsRepository = runsModule.createScheduledTaskRunsRepository(sqliteStorage)
      runsRepository.create('task-a', { id: 'run-1', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' })
      // Storage v2: the session-domain anchor lives in the authoritative
      // sessions/session_messages tables (session_index is retired). Saving one
      // session with one message covers both rows.
      const sessionRepoModule = await import('../../server/sqlite/session-state-repository.mjs')
      const sessionRepository = sessionRepoModule.createSessionStateRepository(sqliteStorage)
      sessionRepository.save({
        scope: 'global',
        projectId: null,
        sessionId: 'sess-anchor',
        state: { id: 'sess-anchor', scope: 'global', stateVersion: 1, title: 'Anchor', messages: [{ role: 'user', content: 'hi' }] },
        metadata: { id: 'sess-anchor', scope: 'global', stateVersion: 1, title: 'Anchor', messageCount: 1 },
      })
      sqliteStorage.prepare(`INSERT INTO share_sessions (share_id, session_id, permission, scope, auth_version, allow_cloud_usage, created_at, updated_at, access_count, revision, extra_json)
        VALUES (?, ?, 'read', 'global', 1, 0, ?, ?, 0, 1, '{}')`)
        .run('qfs_test000000000000001', 'share-sess', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')

      const payload = {
        backup: {
          app: 'quickforge',
          version: 1,
          exportedAt: new Date().toISOString(),
          scope: 'lan-access',
          data: {
            lanAccess: lanConfig({
              enabled: true,
              passwordHash: 'aW1wb3J0ZWQtaGFzaA==',
              passwordSalt: 'aW1wb3J0ZWQtc2FsdA==',
              passwordVersion: 1,
              tokens: [{
                id: 'imported-token',
                tokenHash: 'aW1wb3J0ZWQtdG9rZW4=',
                issuedAt: '2026-01-01T00:00:00.000Z',
                expiresAt: '2027-01-01T00:00:00.000Z',
                authVersion: 1,
              }],
            }),
          },
        },
        sections: ['lanAccess'],
        mode: 'replace',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.summary.lanAccess).toBe(1)
      const config = repository.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.passwordHash).toBe('aW1wb3J0ZWQtaGFzaA==')
      expect(config.tokens).toHaveLength(1)
      expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })

      // F5 scheduled_task_runs must not be touched by a lan-access restore.
      expect(runsRepository.list({ taskIds: ['task-a'], page: 1, pageSize: 10 }).total).toBe(1)
      // Storage v2 session domain (sessions + session_messages) and F10
      // share_sessions untouched.
      expect(sqliteStorage.prepare('SELECT COUNT(*) AS c FROM sessions').get().c).toBe(1)
      expect(sqliteStorage.prepare('SELECT COUNT(*) AS c FROM session_messages').get().c).toBe(1)
      expect(sqliteStorage.prepare('SELECT COUNT(*) AS c FROM share_sessions').get().c).toBe(1)
    })
  })

  it('imports lanAccess in merge mode preserving local config fields and overriding same keys', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository) => {
      const issued = enableWithToken(repository)
      const before = repository.getConfig()
      expect(before.tokens).toHaveLength(1)

      // Backup only flips enabled off (no tokens key): everything local,
      // including the issued token, must survive the merge.
      const payload = {
        backup: { data: { lanAccess: { enabled: false } } },
        sections: ['lanAccess'],
        mode: 'merge',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)
      const config = repository.getConfig()
      expect(config.enabled).toBe(false)
      expect(config.passwordHash).toBe('bGFuLWFjY2Vzcy1oYXNo')
      expect(config.tokens).toHaveLength(1)
      expect(config.tokens[0].tokenHash).toBe(before.tokens[0].tokenHash)
      expect(repository.verifyIntegrity()).toMatchObject({ ok: true })
      expect(repository.verifyToken(issued.token)).toBe(false)
    })
  })

  it('normalizes a legacy v1 lan-access.json import without an envelope', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          data: {
            lanAccess: {
              enabled: true,
              passwordHash: 'bGVnYWN5LWhhc2g=',
              passwordSalt: 'bGVnYWN5LXNhbHQ=',
              passwordVersion: 1,
              authVersion: 1,
              sessionTtlHours: 24,
              updatedAt: '2020-01-01T00:00:00.000Z',
              tokens: [{ id: 'legacy-token', tokenHash: 'legacy-token-hash' }],
            },
          },
        },
        sections: ['lanAccess'],
        mode: 'replace',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)
      const config = repository.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.sessionTtlHours).toBe(24)
      expect(config.tokens).toEqual([
        {
          id: 'legacy-token',
          tokenHash: 'legacy-token-hash',
          issuedAt: '1970-01-01T00:00:00.000Z',
          expiresAt: undefined,
          authVersion: 1,
          remoteAddress: undefined,
          userAgent: undefined,
        },
      ])
      expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    })
  })

  it('rejects import with 423 while the lan-access maintenance lock is active', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository, sqliteStorage, cutover) => {
      enableWithToken(repository)
      const lease = cutover.acquireLanAccessMaintenanceLock(sqliteStorage, {
        owner: { id: '999:test', pid: 999 },
        pidAlive: () => true,
        operation: 'other-maintenance',
      })
      expect(lease).not.toBeNull()
      const payload = {
        backup: {
          data: { lanAccess: lanConfig({ enabled: true, passwordHash: 'aGFzaA==', passwordSalt: 'c2FsdA==', passwordVersion: 1 }) },
        },
        sections: ['lanAccess'],
        mode: 'replace',
      }
      const url = new URL('http://localhost/api/backup/import')
      await expect(backup.handleBackupApi({ method: 'POST', ...mockReq(payload) }, mockRes(), url))
        .rejects.toMatchObject({ statusCode: 423, errorCode: 'lan_access_maintenance' })
      expect(repository.getConfig().tokens).toHaveLength(1)
      cutover.releaseLanAccessMaintenanceLock(sqliteStorage, lease)
    })
  })

  it('warns in inspect that importing will replace the local LAN access config', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          app: 'quickforge',
          version: 1,
          scope: 'lan-access',
          data: {
            lanAccess: lanConfig({
              enabled: true,
              passwordHash: 'aGFzaA==',
              passwordSalt: 'c2FsdA==',
              passwordVersion: 1,
              tokens: [{ id: 'inspect-token', tokenHash: 'aW5zcGVjdC1oYXNo', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }],
            }),
          },
        },
      }
      const { res, json } = await callInspect(backup, payload)
      expect(res._status).toBe(200)
      expect(json.sections.lanAccess).toBe(1)
      expect(json.warnings.some((warning) => warning.includes('将替换局域网访问配置'))).toBe(true)
    })
  })

  it('keeps verifyLanAccessToken fail-closed after a restore', async () => {
    await withAuthoritativeLanAccessBackup(async (backup, storage, service, repository) => {
      const issued = enableWithToken(repository)
      const exported = await callExport(backup)
      const payload = {
        backup: { data: { lanAccess: exported.json.data.lanAccess } },
        sections: ['lanAccess'],
        mode: 'replace',
      }
      const { res } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      // The old token stays valid after the same-config roundtrip…
      expect(repository.verifyToken(issued.token)).toBe(true)
      // …but any malformed/foreign input still fails closed after the restore.
      expect(repository.verifyToken(`${Number(issued.token.split('.')[0]) + 1}.${issued.token.split('.')[1]}`)).toBe(false)
      expect(repository.verifyToken(`${issued.token.split('.')[0]}.wrong-secret`)).toBe(false)
      expect(repository.verifyToken(null)).toBe(false)
      expect(repository.verifyToken('')).toBe(false)
      expect(repository.verifyToken({})).toBe(false)
      expect(repository.verifyToken(12345)).toBe(false)
    })
  })
})
