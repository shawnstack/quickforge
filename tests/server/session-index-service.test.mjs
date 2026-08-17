import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySqliteMigrations } from '../../server/sqlite/migrations.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'
import {
  createSessionIndexService,
  sessionIndexAggregateDigest,
} from '../../server/session-index-service.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const multiprocessWorker = path.join(projectRoot, 'tests', 'fixtures', 'session-index-multiprocess-worker.mjs')
const convergenceWorker = path.join(projectRoot, 'tests', 'fixtures', 'session-index-convergence-worker.mjs')

function spawnScript(script, args, delayMs = 0) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: projectRoot,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, QUICKFORGE_LOG_LEVEL: 'ERROR' },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.once('error', reject)
      child.once('close', (code) => {
        if (code !== 0) reject(new Error(stderr))
        else resolve(JSON.parse(stdout.trim()))
      })
    }, delayMs)
  })
}

function spawnWorker(databasePath, title, delayMs = 0) {
  return spawnScript(multiprocessWorker, [databasePath, title], delayMs)
}

function createHandle(database) {
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
    transaction(callback) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const result = callback(this)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function metadata(id, overrides = {}) {
  return {
    id,
    title: `Title ${id}`,
    createdAt: '2026-08-17T00:00:00.000Z',
    lastModified: '2026-08-17T01:00:00.000Z',
    messageCount: 1,
    scope: 'global',
    stateVersion: 1,
    ...overrides,
  }
}

function buckets(global = {}, projects = {}) {
  return [
    { scope: 'global', projectId: null, metadata: global },
    ...Object.entries(projects).map(([projectId, value]) => ({ scope: 'project', projectId, metadata: value })),
  ]
}

describe('session index service', () => {
  let directory
  let database
  let repository
  let log

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-service-'))
    database = new DatabaseSync(path.join(directory, 'index.sqlite3'))
    applySqliteMigrations(database)
    repository = createSessionIndexRepository(createHandle(database))
    log = { warn: vi.fn() }
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('handles empty/missing index, stale content, and same-count content changes with count+digest rebuilds', async () => {
    let source = buckets({ a: metadata('a') })
    const service = createSessionIndexService({ repository, readBuckets: async () => source, log })
    expect(await service.initialize()).toMatchObject({ ok: true, rebuilt: true, count: 1, rebuildCount: 1 })
    expect(repository.get('global', null, 'a').metadata.title).toBe('Title a')

    source = buckets({ b: metadata('b') })
    const restarted = createSessionIndexService({ repository, readBuckets: async () => source, log })
    expect(await restarted.initialize()).toMatchObject({ ok: true, rebuilt: true, count: 1 })
    expect(repository.get('global', null, 'a')).toBeNull()
    expect(repository.get('global', null, 'b')).not.toBeNull()

    const stable = createSessionIndexService({ repository, readBuckets: async () => source, log })
    expect(await stable.initialize()).toMatchObject({ ok: true, rebuilt: false, count: 1, rebuildCount: 0 })
  })

  it('does not clear a valid old index when any source bucket is malformed', async () => {
    const good = createSessionIndexService({ repository, readBuckets: async () => buckets({ kept: metadata('kept') }), log })
    await good.initialize()
    const before = repository.listVerification()
    const malformed = createSessionIndexService({
      repository,
      readBuckets: async () => [{ scope: 'global', projectId: null, metadata: { bad: 'not-an-object' } }],
      log,
    })

    expect(await malformed.initialize()).toMatchObject({ ok: false, degraded: true, dirty: true })
    expect(repository.listVerification()).toEqual(before)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('Title kept')
  })

  it('retries a rebuild when the source changes during replacement and converges', async () => {
    const first = buckets({ a: metadata('a') })
    const second = buckets({ b: metadata('b') })
    const snapshots = [first, second, second]
    let reads = 0
    const service = createSessionIndexService({
      repository,
      readBuckets: async () => snapshots[Math.min(reads++, snapshots.length - 1)],
      maxRebuildAttempts: 3,
      log,
    })

    expect(await service.initialize()).toMatchObject({ ok: true, rebuilt: true, rebuildCount: 1 })
    expect(reads).toBeGreaterThanOrEqual(3)
    expect(repository.get('global', null, 'a')).toBeNull()
    expect(repository.get('global', null, 'b')).not.toBeNull()
  })

  it('incrementally upserts/deletes composite buckets and treats stateVersion-only changes as digest changes', async () => {
    let source = buckets({ same: metadata('same') }, {
      project: { same: metadata('same', { scope: 'project', projectId: 'project', title: 'Project same' }) },
    })
    const service = createSessionIndexService({ repository, readBuckets: async () => source, log })
    await service.initialize()
    const beforeDigest = repository.get('global', null, 'same').metadataDigest

    await service.syncMetadataCommit({
      scope: 'global',
      projectId: null,
      previous: source[0].metadata,
      next: { same: metadata('same', { stateVersion: 2 }) },
    })
    expect(repository.get('global', null, 'same').stateVersion).toBe(2)
    expect(repository.get('global', null, 'same').metadataDigest).not.toBe(beforeDigest)
    expect(repository.get('project', 'project', 'same').metadata.title).toBe('Project same')

    await service.syncMetadataCommit({
      scope: 'project',
      projectId: 'project',
      previous: source[1].metadata,
      next: {},
    })
    expect(repository.get('project', 'project', 'same')).toBeNull()
    expect(service.getDiagnostics()).toMatchObject({ count: 1, dirty: false })
  })

  it('marks dirty on SQLite incremental failure without throwing to the JSON caller', async () => {
    const failingRepository = {
      ...repository,
      applyChanges() { throw Object.assign(new Error('disk unavailable'), { code: 'SQLITE_IOERR' }) },
    }
    const service = createSessionIndexService({ repository: failingRepository, readBuckets: async () => buckets(), log })
    await service.initialize()
    await expect(service.syncMetadataCommit({
      scope: 'global', projectId: null, previous: {}, next: { a: metadata('a') },
    })).resolves.toMatchObject({ ok: false, degraded: true })
    expect(service.getDiagnostics()).toMatchObject({ dirty: true, lastFailure: { name: 'Error', code: 'SQLITE_IOERR' } })
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('Title a')
  })

  it('computes a stable aggregate digest independent of row order', () => {
    const rows = [
      { scope: 'global', projectId: null, sessionId: 'a', metadataDigest: 'a'.repeat(64) },
      { scope: 'project', projectId: 'p', sessionId: 'a', metadataDigest: 'b'.repeat(64) },
    ]
    expect(sessionIndexAggregateDigest(rows)).toBe(sessionIndexAggregateDigest([...rows].reverse()))
  })

  it('converges across processes through serialized SQLite writers and a final JSON-authoritative initialize', async () => {
    database.close()
    const databasePath = path.join(directory, 'multiprocess.sqlite3')
    const results = await Promise.all([
      spawnWorker(databasePath, 'first'),
      spawnWorker(databasePath, 'second', 30),
    ])
    expect(results.every((result) => result.ok)).toBe(true)

    database = new DatabaseSync(databasePath)
    repository = createSessionIndexRepository(createHandle(database))
    const finalMetadata = { shared: metadata('shared', { title: 'final-authoritative' }) }
    const service = createSessionIndexService({
      repository,
      readBuckets: async () => buckets(finalMetadata),
      log,
    })
    expect(await service.initialize()).toMatchObject({ ok: true })
    expect(repository.get('global', null, 'shared').metadata.title).toBe('final-authoritative')
  })

  it('keeps independent bucket changes when two processes sync concurrently', async () => {
    database.close()
    const databasePath = path.join(directory, 'concurrent-buckets.sqlite3')
    const sourcePath = path.join(directory, 'physical-buckets.json')
    const source = buckets(
      { global: metadata('global') },
      { project: { project: metadata('project', { scope: 'project', projectId: 'project' }) } },
    )
    await writeFile(sourcePath, JSON.stringify(source), 'utf8')

    const results = await Promise.all([
      spawnScript(convergenceWorker, [databasePath, sourcePath, '30', 'left']),
      spawnScript(convergenceWorker, [databasePath, sourcePath, '30', 'right']),
    ])
    expect(results.every((result) => result.ok)).toBe(true)

    database = new DatabaseSync(databasePath)
    repository = createSessionIndexRepository(createHandle(database))
    expect(repository.listAll().map((entry) => `${entry.scope}:${entry.projectId || ''}:${entry.sessionId}`)).toEqual([
      'global::global',
      'project:project:project',
    ])
  })
})

describe('session metadata storage hook', () => {
  let directory
  let previousDataDir

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-storage-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    process.env.QUICKFORGE_DATA_DIR = directory
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    vi.resetModules()
    await rm(directory, { recursive: true, force: true })
  })

  it('reports exact physical previous/next buckets for scoped and bulk writes, including clear', async () => {
    const storageUrl = new URL(`../../server/storage.mjs?hook=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    const commits = []
    storage.registerSessionMetadataCommitHook(async (change) => commits.push(change))
    await storage.ensureStorage()
    await storage.atomicSessionMetadataUpdate('project', 'p1', (data) => {
      data.shared = metadata('shared', { scope: 'global', projectId: 'wrong' })
      return data
    })
    expect(commits.at(-1)).toMatchObject({ scope: 'project', projectId: 'p1', previous: {}, next: { shared: expect.any(Object) } })

    commits.length = 0
    await storage.writeStore('sessions-metadata', {
      global: metadata('global'),
      project: metadata('project', { scope: 'project', projectId: 'p2' }),
    })
    expect(commits).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'global', next: { global: expect.any(Object) } }),
      expect.objectContaining({ scope: 'project', projectId: 'p1', next: {} }),
      expect.objectContaining({ scope: 'project', projectId: 'p2', next: { project: expect.any(Object) } }),
    ]))

    commits.length = 0
    await storage.writeStore('sessions-metadata', {})
    expect(commits.some((entry) => entry.scope === 'global' && Object.keys(entry.next).length === 0)).toBe(true)
    expect(commits.some((entry) => entry.scope === 'project' && entry.projectId === 'p2' && Object.keys(entry.next).length === 0)).toBe(true)
  })

  it('keeps JSON writes successful when the registered index hook fails', async () => {
    const storageUrl = new URL(`../../server/storage.mjs?hook-failure=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    storage.registerSessionMetadataCommitHook(async () => { throw new Error('sqlite failed') })
    await storage.ensureStorage()
    await expect(storage.atomicSessionMetadataUpdate('global', null, (data) => {
      data.saved = metadata('saved')
      return data
    })).resolves.toMatchObject({ saved: expect.any(Object) })
    expect((await storage.readStore('sessions-metadata')).saved.title).toBe('Title saved')
  })

  it('rejects a malformed physical metadata file so startup can preserve the old index', async () => {
    const storageUrl = new URL(`../../server/storage.mjs?malformed=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    await storage.ensureStorage()
    const projectDir = path.join(directory, 'storage', 'conversations', 'projects', 'bad-project')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'sessions-metadata.json'), '{broken', 'utf8')
    await expect(storage.readPhysicalSessionMetadataBuckets()).rejects.toThrow()
  })
})
