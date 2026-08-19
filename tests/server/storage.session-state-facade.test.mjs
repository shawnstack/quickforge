import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  configureSessionStateService,
  readSessionStateValue,
} from '../../server/session-state-service.mjs'

// ---------------------------------------------------------------------------
// Storage facade delegation + batch route endpoint, authoritative mode.
// ---------------------------------------------------------------------------

function sessionBody(id, overrides = {}) {
  return {
    id,
    scope: 'global',
    stateVersion: 1,
    title: `Title ${id}`,
    messages: [{ role: 'user', content: `hello ${id}` }],
    ...overrides,
  }
}

function req(method, body) {
  const value = body === undefined ? undefined : JSON.stringify(body)
  return {
    method,
    [Symbol.asyncIterator]() {
      let sent = false
      return {
        next: async () => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: value === undefined ? Buffer.alloc(0) : Buffer.from(value, 'utf8') }
        },
      }
    },
  }
}

function res() {
  return {
    headersSent: false, status: null, body: '',
    writeHead(status) { this.status = status; this.headersSent = true },
    end(body) { this.body = body ?? '' },
  }
}

async function callRoute(route, method, pathname, body) {
  const response = res()
  const url = new URL(`http://localhost${pathname}`)
  try {
    await route.handleStorageApi(req(method, body), response, url, { isLocalRequest: true })
    return { ok: true, status: response.status, payload: response.body ? JSON.parse(response.body) : null }
  } catch (error) {
    return { ok: false, status: error?.statusCode ?? 500, code: error?.errorCode, message: error?.message }
  }
}

// The repository is Object.freeze()d (no vi.spyOn and no Proxy overrides), so
// counting calls requires a spread wrapper the service is configured with.
function trackedRepository(repository, counts) {
  return {
    ...repository,
    save: (...args) => { counts.save += 1; return repository.save(...args) },
    applyBatch: (...args) => { counts.applyBatch += 1; return repository.applyBatch(...args) },
  }
}

async function withAuthoritativeFacade(testFn) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-session-facade-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  try {
    await closeSqliteStorage()
    const database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    const repository = createSessionStateRepository(database)
    const counts = { save: 0, applyBatch: 0 }
    const tracked = trackedRepository(repository, counts)
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
    configureSessionStateService({ repository: tracked, mirror, phase: 'authoritative' })
    const testId = `${Date.now()}-${Math.random()}`
    const storageModule = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
    const routeModule = await import(/* @vite-ignore */ new URL(`../../server/routes/storage.mjs?test=${testId}`, import.meta.url).href)
    await testFn({ storageModule, routeModule, repository, mirror, database, counts })
  } finally {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    await rm(tmpDir, { recursive: true, force: true })
  }
}

describe('storage facade delegation in authoritative mode', () => {
  it('single body PUT derives metadata in one transaction and never leaves an orphan', async () => {
    await withAuthoritativeFacade(async ({ storageModule, repository, counts }) => {
      const before = counts.save
      await storageModule.writeSessionValue('one', sessionBody('one'))
      const record = repository.findBySessionId('one')
      expect(record).not.toBeNull()
      expect(record.state).toMatchObject({ id: 'one', title: 'Title one' })
      expect(record.metadata).toMatchObject({ id: 'one', messageCount: 1, title: 'Title one' })
      expect(counts.save - before).toBe(1)
      expect(await storageModule.readStore('sessions-metadata')).toMatchObject({ one: { messageCount: 1 } })
    })
  })

  it('body PUT merge preserves metadata-owned pin/archive and unknown fields', async () => {
    await withAuthoritativeFacade(async ({ storageModule }) => {
      await storageModule.writeSessionValue('one', sessionBody('one'))
      await storageModule.atomicUpdate('sessions-metadata', (data) => {
        data.one = { ...data.one, pinnedAt: '2026-01-01T00:00:00.000Z', custom: 'keep' }
        return data
      })
      await storageModule.writeSessionValue('one', { ...sessionBody('one'), title: 'Updated', newOpaque: { keep: true } })
      const record = await storageModule.readSessionValue('one')
      expect(record).toMatchObject({ title: 'Updated', newOpaque: { keep: true }, pinnedAt: '2026-01-01T00:00:00.000Z' })
      expect((await storageModule.readStore('sessions-metadata')).one).toMatchObject({ pinnedAt: '2026-01-01T00:00:00.000Z', custom: 'keep' })
    })
  })

  it('delete is idempotent and commits before best-effort mirror materialization', async () => {
    await withAuthoritativeFacade(async ({ storageModule, repository, mirror }) => {
      await storageModule.writeSessionValue('one', sessionBody('one'))
      expect(await storageModule.deleteSessionWithMetadata('one')).toBe(true)
      expect(repository.findBySessionId('one')).toBeNull()
      // Second delete is a no-op but stays successful.
      expect(await storageModule.deleteSessionWithMetadata('one')).toBe(false)
      // The JSON mirror materialization ran (delete entries) but never blocks or
      // rolls back the committed SQLite deletion.
      expect(mirror.delete).toHaveBeenCalled()
    })
  })

  it('clears the whole sessions store and blocks metadata-only orphans', async () => {
    await withAuthoritativeFacade(async ({ storageModule }) => {
      await storageModule.writeStore('sessions', {
        one: sessionBody('one'),
        two: sessionBody('two'),
      })
      expect(await storageModule.readStore('sessions')).toMatchObject({ one: { id: 'one' }, two: { id: 'two' } })
      await storageModule.writeStore('sessions', {})
      expect(await storageModule.readStore('sessions')).toEqual({})
      expect(await storageModule.readStore('sessions-metadata')).toEqual({})

      await storageModule.writeStore('sessions', { one: sessionBody('one') })
      const countError = await storageModule.writeStore('sessions-metadata', {}).catch((e) => e)
      expect(countError).toMatchObject({ statusCode: 409, errorCode: 'SESSION_FULL_DELETE_REQUIRED' })
      const orphanError = await storageModule.writeStore('sessions-metadata', { orphan: { id: 'orphan' } }).catch((e) => e)
      expect(orphanError).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_REQUIRED' })
    })
  })

  it('applies a multi-session batch in one repository transaction without half state', async () => {
    await withAuthoritativeFacade(async ({ storageModule, counts }) => {
      const before = counts.applyBatch
      const result = await storageModule.applySessionBatch([
        { store: 'sessions', type: 'set', key: 'a', value: sessionBody('a') },
        { store: 'sessions-metadata', type: 'set', key: 'a', value: { title: 'Batch A', messageCount: 1 } },
        { store: 'sessions', type: 'set', key: 'b', value: sessionBody('b') },
        { store: 'sessions-metadata', type: 'set', key: 'b', value: { title: 'Batch B', messageCount: 1 } },
      ])
      expect(result.saved).toBe(2)
      expect(counts.applyBatch - before).toBe(1)
      const sessions = await storageModule.readStore('sessions')
      expect(Object.keys(sessions).sort()).toEqual(['a', 'b'])
      const metadata = await storageModule.readStore('sessions-metadata')
      expect(metadata.a).toMatchObject({ title: 'Batch A' })
      expect(metadata.b).toMatchObject({ title: 'Batch B' })
    })
  })

  it('batch delete removes body + metadata in one transaction and is idempotent', async () => {
    await withAuthoritativeFacade(async ({ storageModule, counts }) => {
      await storageModule.writeSessionValue('a', sessionBody('a'))
      await storageModule.writeSessionValue('b', sessionBody('b'))
      const before = counts.applyBatch
      const first = await storageModule.applySessionBatch([
        { store: 'sessions', type: 'delete', key: 'a' },
        { store: 'sessions', type: 'delete', key: 'b' },
      ])
      expect(first.deleted).toBe(2)
      expect(counts.applyBatch - before).toBe(1)
      expect(await storageModule.readStore('sessions')).toEqual({})
      expect(await storageModule.readStore('sessions-metadata')).toEqual({})
      const second = await storageModule.applySessionBatch([{ store: 'sessions', type: 'delete', key: 'a' }])
      expect(second.deleted).toBe(0)
    })
  })

  it('atomic session record update keeps body + metadata consistent', async () => {
    await withAuthoritativeFacade(async ({ storageModule, repository, counts }) => {
      await storageModule.writeSessionValue('one', sessionBody('one', { messages: [1, 2, 3].map((i) => ({ role: 'user', content: `m${i}` })) }))
      const before = counts.save
      const updated = await storageModule.atomicSessionRecordUpdate('one', ({ state, metadata }) => ({
        state: { ...state, messages: state.messages.slice(0, 2) },
        metadata: { ...metadata, messageCount: 2, preview: 'preview' },
      }))
      expect(updated.state.messages).toHaveLength(2)
      expect(counts.save - before).toBe(1)
      expect(repository.findBySessionId('one').metadata).toMatchObject({ messageCount: 2, preview: 'preview' })
    })
  })

  it('metadata PUT without an existing body is rejected with a stable 409', async () => {
    await withAuthoritativeFacade(async ({ storageModule }) => {
      const error = await storageModule.atomicUpdate('sessions-metadata', (data) => {
        data.ghost = { id: 'ghost', title: 'ghost' }
        return data
      }).catch((e) => e)
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_REQUIRED' })
    })
  })
})

describe('batch route endpoint (POST /api/storage/batch)', () => {
  it('commits sessions + sessions-metadata set/delete in one request', async () => {
    await withAuthoritativeFacade(async ({ routeModule, repository, counts }) => {
      const before = counts.applyBatch
      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [
          { store: 'sessions', type: 'set', key: 'a', value: sessionBody('a') },
          { store: 'sessions-metadata', type: 'set', key: 'a', value: { title: 'Route A', messageCount: 1 } },
        ],
      })
      expect(response).toMatchObject({ ok: true, status: 200 })
      expect(response.payload).toMatchObject({ ok: true, saved: 1, deleted: 0 })
      expect(counts.applyBatch - before).toBe(1)
      const record = repository.findBySessionId('a')
      expect(record.state).toMatchObject({ id: 'a' })
      expect(record.metadata).toMatchObject({ title: 'Route A' })
    })
  })

  it('maps expectedStateVersion conflicts to stable 409 SESSION_STATE_CONFLICT', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      await storageModule.writeSessionValue('a', sessionBody('a'))
      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [
          { store: 'sessions', type: 'set', key: 'a', value: sessionBody('a', { title: 'Stale' }), expectedStateVersion: 99 },
        ],
      })
      expect(response.ok).toBe(false)
      expect(response.status).toBe(409)
      expect(response.code).toBe('SESSION_STATE_CONFLICT')
    })
  })

  it('maps cross-bucket duplicates to stable 409 SESSION_STATE_DUPLICATE_ID', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      // A batch groups operations by sessionId, so the duplicate surfaces when
      // a second scope tries to claim an id that already exists elsewhere.
      await storageModule.writeSessionValue('dup', sessionBody('dup'))
      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [
          { store: 'sessions', type: 'set', key: 'dup', value: sessionBody('dup', { scope: 'project', projectId: 'p' }) },
        ],
      })
      expect(response.ok).toBe(false)
      expect(response.status).toBe(409)
      expect(response.code).toBe('SESSION_STATE_DUPLICATE_ID')
    })
  })

  it('rejects invalid batch input with 400', async () => {
    await withAuthoritativeFacade(async ({ routeModule }) => {
      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', { operations: [] })
      expect(response).toMatchObject({ ok: false, status: 400 })
      const badStore = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [{ store: 'settings', type: 'set', key: 'x', value: {} }],
      })
      expect(badStore).toMatchObject({ ok: false, status: 400 })
    })
  })

  // pi-web-ui's SessionsStore.delete() commits a `sessions` delete plus a
  // `sessions-metadata` delete for the same key in one transaction. The
  // settings page "archived conversations" permanent delete (and the empty
  // session rollback in useChatActions) both send this exact shape.
  it('accepts the pi-web-ui two-operation delete as one transaction', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule, repository }) => {
      await storageModule.writeSessionValue('del', sessionBody('del'))
      expect(repository.findBySessionId('del')).not.toBeNull()

      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [
          { store: 'sessions', type: 'delete', key: 'del' },
          { store: 'sessions-metadata', type: 'delete', key: 'del' },
        ],
      })

      expect(response).toMatchObject({ ok: true, status: 200, payload: { deleted: 1 } })
      expect(repository.findBySessionId('del')).toBeNull()
      expect(await storageModule.readSessionValue('del')).toBeNull()
      expect((await storageModule.readStore('sessions-metadata')).del).toBeUndefined()
    })
  })

  it('still rejects a metadata-only delete without a paired sessions delete', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      await storageModule.writeSessionValue('keep', sessionBody('keep'))
      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [{ store: 'sessions-metadata', type: 'delete', key: 'keep' }],
      })
      expect(response).toMatchObject({ ok: false, status: 400, message: 'Metadata-only delete is not allowed' })
      expect(await storageModule.readSessionValue('keep')).not.toBeNull()
    })
  })

  it('destroys the in-memory agent before the batch delete commits', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      await storageModule.writeSessionValue('gone', sessionBody('gone'))
      const destroyed = []
      routeModule.configureStorageSessionAgentDisposal({ destroy: async (id) => { destroyed.push(id) } })
      const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
        operations: [
          { store: 'sessions', type: 'delete', key: 'gone' },
          { store: 'sessions-metadata', type: 'delete', key: 'gone' },
        ],
      })
      expect(response).toMatchObject({ ok: true, status: 200 })
      expect(destroyed).toEqual(['gone'])
      expect(await storageModule.readSessionValue('gone')).toBeNull()
    })
  })

  it('destroys the in-memory agent before the single-key sessions DELETE', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      await storageModule.writeSessionValue('one', sessionBody('one'))
      const destroyed = []
      routeModule.configureStorageSessionAgentDisposal({ destroy: async (id) => { destroyed.push(id) } })
      const response = await callRoute(routeModule, 'DELETE', '/api/storage/sessions/key/one')
      expect(response).toMatchObject({ ok: true, status: 200 })
      expect(destroyed).toEqual(['one'])
      expect(await storageModule.readSessionValue('one')).toBeNull()
    })
  })

  it('is gated while session state maintenance is active (423)', async () => {
    await withAuthoritativeFacade(async ({ routeModule, database }) => {
      const now = new Date().toISOString()
      const expires = new Date(Date.now() + 60_000).toISOString()
      database.prepare(`INSERT INTO session_state_maintenance_lock
        (singleton, owner, owner_pid, fencing, operation, acquired_at, heartbeat_at, expires_at)
        VALUES (1, 'route-test-owner', 424242, 1, 'test', ?, ?, ?)`).run(now, now, expires)
      try {
        const response = await callRoute(routeModule, 'POST', '/api/storage/batch', {
          operations: [{ store: 'sessions', type: 'set', key: 'a', value: sessionBody('a') }],
        })
        expect(response).toMatchObject({ ok: false, status: 423 })
      } finally {
        database.prepare("DELETE FROM session_state_maintenance_lock WHERE singleton = 1").run()
      }
    })
  })

  it('single PUT is atomic (no orphan) and DELETE is idempotent', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      const put = await callRoute(routeModule, 'PUT', '/api/storage/sessions/key/p1', { value: sessionBody('p1') })
      expect(put).toMatchObject({ ok: true, status: 200 })
      expect((await storageModule.readStore('sessions-metadata')).p1).toMatchObject({ messageCount: 1 })

      const firstDelete = await callRoute(routeModule, 'DELETE', '/api/storage/sessions/key/p1')
      expect(firstDelete).toMatchObject({ ok: true, status: 200 })
      expect(await storageModule.readStore('sessions')).toEqual({})
      const secondDelete = await callRoute(routeModule, 'DELETE', '/api/storage/sessions/key/p1')
      expect(secondDelete).toMatchObject({ ok: true, status: 200 })
    })
  })

  it('keeps GET/API shapes unchanged for existing read endpoints', async () => {
    await withAuthoritativeFacade(async ({ routeModule, storageModule }) => {
      await storageModule.writeSessionValue('one', sessionBody('one'))
      const has = await callRoute(routeModule, 'GET', '/api/storage/sessions/has/one')
      expect(has).toMatchObject({ ok: true, status: 200, payload: { exists: true } })
      const value = await callRoute(routeModule, 'GET', '/api/storage/sessions/key/one')
      expect(value).toMatchObject({ ok: true, status: 200 })
      expect(value.payload.value).toMatchObject({ id: 'one' })
      expect(readSessionStateValue('one')).toMatchObject({ id: 'one' })
    })
  })
})

describe('auto-archive in authoritative mode (single atomic transaction)', () => {
  function daysAgo(now, days) {
    return new Date(now - days * 24 * 60 * 60 * 1000).toISOString()
  }

  it('archives body + metadata in one repository transaction with no half state', async () => {
    await withAuthoritativeFacade(async ({ storageModule, repository, counts }) => {
      const now = Date.UTC(2026, 0, 31)
      await storageModule.ensureStorage()
      await storageModule.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: true }
        return data
      })
      await storageModule.writeSessionValue('old', sessionBody('old', {
        createdAt: daysAgo(now, 50),
        lastModified: daysAgo(now, 50),
        messages: [{ role: 'user', content: 'stale', timestamp: daysAgo(now, 50) }],
      }))
      await storageModule.atomicUpdate('sessions-metadata', (data) => {
        data.old = { id: 'old', scope: 'global', stateVersion: 1, title: 'old', createdAt: daysAgo(now, 50), lastModified: daysAgo(now, 50), messageCount: 1 }
        return data
      })
      await storageModule.writeSessionValue('fresh', sessionBody('fresh', {
        createdAt: daysAgo(now, 1),
        lastModified: daysAgo(now, 1),
      }))
      await storageModule.atomicUpdate('sessions-metadata', (data) => {
        data.fresh = { id: 'fresh', scope: 'global', stateVersion: 1, title: 'fresh', createdAt: daysAgo(now, 1), lastModified: daysAgo(now, 1), messageCount: 1 }
        return data
      })

      const before = counts.save
      const autoArchive = await import('../../server/auto-archive.mjs')
      const result = await autoArchive.archiveInactiveSessions({ now, storage: storageModule })

      expect(result).toMatchObject({ archivedCount: 1, archivedSessionIds: ['old'] })
      // One atomic record save: body and metadata archived together.
      expect(counts.save - before).toBe(1)
      const record = repository.findBySessionId('old')
      expect(record.state.archivedAt).toBe(new Date(now).toISOString())
      expect(record.metadata.archivedAt).toBe(new Date(now).toISOString())
      expect(repository.findBySessionId('fresh').state.archivedAt).toBeUndefined()
    })
  })

  it('skips without committing anything when the session is still active at archive time', async () => {
    await withAuthoritativeFacade(async ({ storageModule, repository, counts }) => {
      const now = Date.UTC(2026, 0, 31)
      await storageModule.ensureStorage()
      await storageModule.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: true }
        return data
      })
      await storageModule.writeSessionValue('recent', sessionBody('recent', {
        createdAt: daysAgo(now, 50),
        lastModified: daysAgo(now, 50),
      }))
      await storageModule.atomicUpdate('sessions-metadata', (data) => {
        data.recent = { id: 'recent', scope: 'global', stateVersion: 1, title: 'recent', createdAt: daysAgo(now, 50), lastModified: daysAgo(now, 1), messageCount: 1 }
        return data
      })

      const before = counts.save
      const autoArchive = await import('../../server/auto-archive.mjs')
      const result = await autoArchive.archiveInactiveSessions({ now, storage: storageModule })

      expect(result).toMatchObject({ archivedCount: 0 })
      expect(counts.save - before).toBe(0)
      expect(repository.findBySessionId('recent').state.archivedAt).toBeUndefined()
      expect(repository.findBySessionId('recent').metadata.archivedAt).toBeUndefined()
    })
  })
})

describe('session batch delete in JSON fallback mode', () => {
  // storage.mjs resolves its dataDir at module evaluation time, so the env
  // must point at the temp dir BEFORE the dynamic import below.
  async function withJsonFallback(testFn) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-session-batch-json-'))
    const previous = process.env.QUICKFORGE_DATA_DIR
    process.env.QUICKFORGE_DATA_DIR = tmpDir
    try {
      await closeSqliteStorage()
      configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
      const testId = `${Date.now()}-${Math.random()}`
      const storageModule = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
      await testFn({ storageModule })
    } finally {
      configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
      await closeSqliteStorage()
      if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
      else process.env.QUICKFORGE_DATA_DIR = previous
      await rm(tmpDir, { recursive: true, force: true })
    }
  }

  it('accepts the pi-web-ui two-operation delete', async () => {
    await withJsonFallback(async ({ storageModule }) => {
      await storageModule.ensureStorage()
      await storageModule.writeSessionValue('j1', sessionBody('j1'))
      const result = await storageModule.applySessionBatch([
        { store: 'sessions', type: 'delete', key: 'j1' },
        { store: 'sessions-metadata', type: 'delete', key: 'j1' },
      ])
      expect(result).toMatchObject({ deleted: 1 })
      expect(await storageModule.readSessionValue('j1')).toBeNull()
      expect((await storageModule.readStore('sessions-metadata')).j1).toBeUndefined()
    })
  })

  it('still rejects a metadata-only delete with SESSION_FULL_DELETE_REQUIRED', async () => {
    await withJsonFallback(async ({ storageModule }) => {
      await storageModule.ensureStorage()
      await storageModule.writeSessionValue('j2', sessionBody('j2'))
      await expect(storageModule.applySessionBatch([
        { store: 'sessions-metadata', type: 'delete', key: 'j2' },
      ])).rejects.toMatchObject({ errorCode: 'SESSION_FULL_DELETE_REQUIRED' })
      expect(await storageModule.readSessionValue('j2')).not.toBeNull()
    })
  })
})

describe('POST /api/storage/maintenance/verify-session-integrity', () => {
  it('runs the lightweight check by default and the full per-row digest check with full: true', async () => {
    await withAuthoritativeFacade(async ({ storageModule, routeModule, repository }) => {
      await storageModule.writeSessionValue('one', sessionBody('one'))

      const quick = await callRoute(routeModule, 'POST', '/api/storage/maintenance/verify-session-integrity')
      expect(quick.status).toBe(200)
      expect(quick.payload).toMatchObject({ ok: true, count: 1, full: false, lightweight: true, digest: null })
      expect(quick.payload.durationMs).toBeGreaterThanOrEqual(0)

      const full = await callRoute(routeModule, 'POST', '/api/storage/maintenance/verify-session-integrity', { full: true })
      expect(full.status).toBe(200)
      expect(full.payload).toMatchObject({ ok: true, count: 1, full: true, invalidRecords: 0, invalidDigests: 0 })
      expect(full.payload.digest).toBe(repository.digest())
      expect(full.payload.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  it('full verification surfaces silent digest rot that the lightweight check misses', async () => {
    await withAuthoritativeFacade(async ({ storageModule, routeModule, database }) => {
      await storageModule.writeSessionValue('one', sessionBody('one'))
      // Simulate bit-rot: the stored state_digest no longer matches the body.
      database.prepare("UPDATE session_states SET state_digest = ? WHERE session_id = 'one'").run('f'.repeat(64))
      const quick = await callRoute(routeModule, 'POST', '/api/storage/maintenance/verify-session-integrity')
      expect(quick.payload).toMatchObject({ ok: true, lightweight: true })
      const full = await callRoute(routeModule, 'POST', '/api/storage/maintenance/verify-session-integrity', { full: true })
      expect(full.payload).toMatchObject({ ok: false, invalidDigests: 1 })
    })
  })

  it('rejects with 409 outside authoritative mode', async () => {
    await withAuthoritativeFacade(async ({ routeModule }) => {
      configureSessionStateService({ phase: 'json_authoritative' })
      const result = await callRoute(routeModule, 'POST', '/api/storage/maintenance/verify-session-integrity', { full: true })
      expect(result).toMatchObject({ ok: false, status: 409, code: 'SESSION_STATE_NOT_AUTHORITATIVE' })
    })
  })
})
