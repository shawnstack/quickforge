import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

/**
 * Set up a real authoritative session state environment (temp data dir +
 * SQLite schema v6 + cutover to authoritative) and freshly import the route so
 * dataDir/storageDir/sqlite paths all resolve inside the temp dir.
 */
async function withAuthoritativeBackup(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-backup-auth-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  let database
  try {
    const backup = await import('../../server/routes/backup.mjs')
    const storage = await import('../../server/storage.mjs')
    database = await import('../../server/sqlite/database.mjs')
    const repoModule = await import('../../server/sqlite/session-state-repository.mjs')
    const service = await import('../../server/session-state-service.mjs')
    const cutover = await import('../../server/session-state-cutover.mjs')
    await storage.ensureStorage()
    const sqliteStorage = await database.initializeSqliteStorage({ dataDir: tmpDir })
    const repository = repoModule.createSessionStateRepository(sqliteStorage)
    service.configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
    const globalDir = path.join(tmpDir, 'storage', 'conversations', 'global')
    await fs.mkdir(path.join(globalDir, 'sessions'), { recursive: true })
    await fs.writeFile(
      path.join(globalDir, 'sessions', 'seed.json'),
      `${JSON.stringify({ id: 'seed', scope: 'global', stateVersion: 1, messages: [{ role: 'user', content: 'hello' }], title: 'Seed' })}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(globalDir, 'sessions-metadata.json'),
      `${JSON.stringify({ seed: { id: 'seed', scope: 'global', stateVersion: 1, title: 'Seed', createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z', messageCount: 1 } })}\n`,
      'utf8',
    )
    const state = await cutover.initializeSessionStateCutover({
      storage: sqliteStorage,
      repository,
      backupDirectory: path.join(tmpDir, 'storage', 'backups'),
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

async function callExport(backup, urlText = 'http://localhost/api/backup/export?scope=sessions') {
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

describe('backup route — authoritative session state', () => {
  it('exports sessions with phase/count/digest and round-trips to the repository', async () => {
    await withAuthoritativeBackup(async (backup, storage, service, repository) => {
      const { res, json } = await callExport(backup)
      expect(res._status).toBe(200)
      expect(json.scope).toBe('sessions')
      expect(json.sessionState).toMatchObject({ phase: 'authoritative', count: 1 })
      expect(json.sessionState.digest).toBe(repository.digest())
      expect(Object.keys(json.data.sessions)).toEqual(['seed'])
      expect(json.data.sessions.seed.messages[0].content).toBe('hello')
      expect(json.data.sessionsMetadata.seed.title).toBe('Seed')
    })
  })

  it('imports conversations in replace mode through the authoritative restore path', async () => {
    await withAuthoritativeBackup(async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          app: 'quickforge',
          version: 1,
          exportedAt: new Date().toISOString(),
          scope: 'all',
          data: {
            sessions: { 'imported': { id: 'imported', scope: 'global', stateVersion: 1, messages: [], title: 'Imported' } },
            sessionsMetadata: {},
          },
        },
        sections: ['conversations'],
        mode: 'replace',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.summary.sessions).toBe(1)
      expect(repository.findBySessionId('imported').state.title).toBe('Imported')
      expect(repository.findBySessionId('seed')).toBeNull()
      expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    })
  })

  it('imports conversations in merge mode preserving local sessions', async () => {
    await withAuthoritativeBackup(async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          app: 'quickforge',
          version: 1,
          exportedAt: new Date().toISOString(),
          scope: 'all',
          data: {
            sessions: { 'added': { id: 'added', scope: 'global', stateVersion: 1, messages: [], title: 'Added' } },
            sessionsMetadata: {},
          },
        },
        sections: ['conversations'],
        mode: 'merge',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      expect(json.summary.sessions).toBe(2)
      expect(repository.findBySessionId('seed')).not.toBeNull()
      expect(repository.findBySessionId('added')).not.toBeNull()
    })
  })

  it('accepts a legacy v1 backup without the envelope and derives metadata', async () => {
    await withAuthoritativeBackup(async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          data: {
            sessions: {
              legacy: { id: 'legacy', scope: 'global', stateVersion: 3, messages: [], title: 'Legacy' },
            },
          },
        },
        sections: ['conversations'],
        mode: 'replace',
      }
      const { res, json } = await callImport(backup, payload)
      expect(res._status).toBe(200)
      const record = repository.findBySessionId('legacy')
      expect(record.stateVersion).toBe(3)
      expect(record.metadata.title).toBe('Legacy')
    })
  })

  it('rejects import with 423 while session state maintenance is active', async () => {
    await withAuthoritativeBackup(async (backup, storage, service, repository, sqliteStorage, cutover) => {
      const lease = cutover.acquireSessionStateMaintenanceLock(sqliteStorage, {
        owner: { id: '999:test', pid: 999 },
        pidAlive: () => true,
        operation: 'other-maintenance',
      })
      expect(lease).not.toBeNull()
      const payload = {
        backup: {
          data: {
            sessions: { 'blocked': { id: 'blocked', scope: 'global', stateVersion: 1, messages: [], title: 'Blocked' } },
            sessionsMetadata: {},
          },
        },
        sections: ['conversations'],
        mode: 'replace',
      }
      const url = new URL('http://localhost/api/backup/import')
      await expect(backup.handleBackupApi({ method: 'POST', ...mockReq(payload) }, mockRes(), url))
        .rejects.toMatchObject({ statusCode: 423, errorCode: 'session_state_maintenance' })
      expect(repository.count()).toBe(1)
      cutover.releaseSessionStateMaintenanceLock(sqliteStorage, lease)
    })
  })

  it('rejects metadata-only conversation restore in authoritative mode with 400', async () => {
    await withAuthoritativeBackup(async (backup, storage, service, repository) => {
      const payload = {
        backup: {
          data: {
            sessionsMetadata: { ghost: { id: 'ghost', title: 'Ghost' } },
          },
        },
        sections: ['conversations'],
        mode: 'replace',
      }
      const url = new URL('http://localhost/api/backup/import')
      await expect(backup.handleBackupApi({ method: 'POST', ...mockReq(payload) }, mockRes(), url))
        .rejects.toMatchObject({ statusCode: 400 })
      expect(repository.count()).toBe(1)
      expect(repository.findBySessionId('seed')).not.toBeNull()
    })
  })
})
