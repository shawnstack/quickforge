import { createWriteStream } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The modules under test resolve storageDir/dataDir from QUICKFORGE_DATA_DIR
// at import time, so every dynamic import below happens only after the env
// points at a throwaway temp directory (established in beforeEach together
// with vi.resetModules, the agent-manager test pattern).

let tmpDir
let previousDataDir
let modules
let dbSerial = 0

async function loadModules() {
  vi.resetModules()
  modules = {
    database: await import('../../server/sqlite/database.mjs'),
    repository: await import('../../server/sqlite/session-state-repository.mjs'),
    service: await import('../../server/session-state-service.mjs'),
    cutover: await import('../../server/session-state-cutover.mjs'),
    migration: await import('../../server/session-state-background-migration.mjs'),
  }
  return modules
}

function sessionPair(sessionId = 'one', overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  const state = {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    title: 'Session',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides.state,
  }
  const metadata = {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    messageCount: 1,
    ...overrides.metadata,
  }
  return { state, metadata }
}

function bucket(sessionId = 'one', overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  const { state, metadata } = sessionPair(sessionId, overrides)
  return { scope, projectId, sessions: { [sessionId]: state }, metadata: { [sessionId]: metadata } }
}

function addSession(datasetBucket, sessionId) {
  const { state, metadata } = sessionPair(sessionId, { scope: datasetBucket.scope, projectId: datasetBucket.projectId })
  datasetBucket.sessions[sessionId] = state
  datasetBucket.metadata[sessionId] = metadata
}

// In-memory fsAdapter (same injection interface as the cutover tests); the
// backing dataset stays live so tests can simulate concurrent JSON writes.
function fakeFsAdapter(buckets, overrides = {}) {
  const bucketFor = (candidate) => buckets.find((entry) => entry.scope === candidate.scope && (entry.projectId || null) === (candidate.projectId || null))
  return {
    async *listBuckets() {
      for (const entry of buckets) yield { scope: entry.scope, projectId: entry.projectId || null }
    },
    async *listSessionFiles(candidate) {
      for (const sessionId of Object.keys(bucketFor(candidate).sessions).sort()) yield sessionId
    },
    async readSessionState(candidate, sessionId) {
      if (overrides.readSessionState) return overrides.readSessionState(candidate, sessionId, bucketFor(candidate).sessions[sessionId] ?? null)
      return bucketFor(candidate).sessions[sessionId] ?? null
    },
    async readMetadataBucket(candidate) {
      return { ...bucketFor(candidate).metadata }
    },
  }
}

function captureLogger(hook = null) {
  const entries = []
  const record = (level) => (message, fields) => {
    const entry = { level, message, ...(fields || {}) }
    entries.push(entry)
    hook?.(entry)
  }
  return { info: record('info'), warn: record('warn'), error: record('error'), entries }
}

const E = (name) => `session.background_migration.${name}`
const namesOf = (log) => log.entries.map((entry) => entry.event)
const eventsOf = (log, name) => log.entries.filter((entry) => entry.event === E(name))

function isSubsequence(names, expected) {
  let index = 0
  for (const name of names) {
    if (name === expected[index]) index += 1
  }
  return index === expected.length
}

function fastOptions(overrides = {}) {
  return {
    roundDelayMs: 1,
    idlePollIntervalMs: 1,
    idleThresholdMs: 0,
    idleTimeoutMs: 60_000,
    backupRetries: 3,
    readLastSessionWriteFinishedAt: () => 0,
    ...overrides,
  }
}

// Gates the idle signal on the fire-and-forget backup finishing, so the
// switch window deterministically observes a registered backup_file.
const gatedByBackup = () => (modules.migration.readSessionStateBackgroundMigrationStatus()?.backup?.state === 'done' ? 0 : 1)

function createFlakyBackupWriteStream({ failAttempts = 0 } = {}) {
  let attempt = 0
  return (file, options) => {
    attempt += 1
    const real = createWriteStream(file, options)
    if (attempt > failAttempts) return real
    let index = 0
    return {
      write(chunk, encoding, callback) {
        const current = index
        index += 1
        // Chunk 3 is the metadata entry — halving it breaks the byte
        // verification (same corruption vector as the cutover tests).
        const payload = current === 3 ? chunk.slice(0, Math.max(1, Math.floor(chunk.length / 2))) : chunk
        return real.write(payload, encoding, callback)
      },
      end(callback) { real.end(callback) },
      once(event, listener) { real.once(event, listener); return this },
      on(event, listener) { real.on(event, listener); return this },
      off(event, listener) { real.off(event, listener); return this },
    }
  }
}

async function pollUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return predicate()
}

describe('session state background migration (feature 2)', () => {
  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bg-migration-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await loadModules()
  })

  afterEach(async () => {
    try { modules.service.stopSessionStateService() } catch { /* no timer running */ }
    await modules.database.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function setup() {
    const storage = await modules.database.initializeSqliteStorage({ databasePath: path.join(tmpDir, `state-${++dbSerial}.sqlite3`) })
    const repository = modules.repository.createSessionStateRepository(storage)
    modules.service.configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
    return { storage, repository }
  }

  it('runs importing → converging → idle → switch → done end-to-end, prunes vanished SQLite buckets and registers the backup', async () => {
    const { storage, repository } = await setup()
    // A SQLite-only bucket from an earlier crashed run: JSON no longer has it.
    const ghost = sessionPair('ghost-session', { scope: 'project', projectId: 'ghost-project' })
    repository.save({ scope: 'project', projectId: 'ghost-project', sessionId: 'ghost-session', stateVersion: 1, state: ghost.state, metadata: ghost.metadata })
    // repository.save enqueues a mirror entry (runtime semantics); the
    // background migration requires an empty outbox, so clear the residue.
    storage.prepare('DELETE FROM session_json_mirror_queue').run()

    const dataset = [bucket('one'), bucket('two', { scope: 'project', projectId: 'demo' })]
    const log = captureLogger()
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
    const result = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      mirror,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      owner: { id: '700:bg', pid: 700 },
      pidAlive: () => false,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })

    expect(result).toMatchObject({ started: true, outcome: 'done' })
    expect(result.promoted).toMatchObject({ phase: 'authoritative', stateCount: 2 })

    const status = modules.migration.readSessionStateBackgroundMigrationStatus()
    expect(status).toMatchObject({
      state: 'done',
      buckets: { total: 2, imported: 2 },
      convergeRound: 1,
      diffBuckets: 0,
      backup: { state: 'done', bytes: expect.any(Number) },
    })
    expect(status.backup.path).toBeTruthy()
    expect(status.taskId).toBe(result.taskId)
    expect(status.lastEventAt).toBeTruthy()

    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    const snapshot = modules.cutover.buildSessionJsonSnapshot(structuredClone(dataset))
    expect(state.digest).toBe(snapshot.digest)
    expect(state.stateCount).toBe(2)
    expect(state.backupFile).toBe(status.backup.path)
    expect((await stat(state.backupFile)).isFile()).toBe(true)

    expect(repository.count()).toBe(2)
    expect(repository.listMirrorQueue()).toEqual([])
    expect(mirror.upsert).not.toHaveBeenCalled()
    expect(mirror.delete).not.toHaveBeenCalled()
    expect(repository.listBucketKeys()).toEqual([{ scope: 'global', projectId: null }, { scope: 'project', projectId: 'demo' }])

    expect(isSubsequence(namesOf(log), [
      E('started'),
      E('bucket.pruned'),
      E('bucket.import.started'),
      E('bucket.imported'),
      E('converge.round'),
      E('converge.converged'),
      E('idle.enter'),
      E('backup.started'),
      E('backup.bucket.progress'),
      E('backup.verify'),
      E('backup.done'),
      E('idle.signal'),
      E('switch.lock.acquire'),
      E('switch.verify'),
      E('switch.promoted'),
      E('switch.done'),
      E('task.done'),
    ])).toBe(true)
    expect(eventsOf(log, 'bucket.import.started')).toHaveLength(2)
    expect(eventsOf(log, 'bucket.imported')).toHaveLength(2)
    expect(eventsOf(log, 'backup.bucket.progress')).toHaveLength(2)
    expect(eventsOf(log, 'task.failed')).toEqual([])
    expect(eventsOf(log, 'task.aborted')).toEqual([])
    // Two buckets and the ghost prune: removedStates surfaces in the log.
    expect(eventsOf(log, 'bucket.pruned')[0]).toMatchObject({ bucket: 'project:ghost-project', removedStates: 1 })
  })

  it('keeps converging while writes land between rounds and completes afterwards', async () => {
    const { storage, repository } = await setup()
    const dataset = [bucket('one')]
    let addedFirst = false
    let addedSecond = false
    const log = captureLogger((entry) => {
      if (entry.event === E('bucket.imported') && !addedFirst) {
        addedFirst = true
        addSession(dataset[0], 'late-1')
      }
      if (entry.event === E('converge.round') && entry.round === 1 && !addedSecond) {
        addedSecond = true
        addSession(dataset[0], 'late-2')
      }
    })
    const result = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })
    expect(result.outcome).toBe('done')
    const rounds = eventsOf(log, 'converge.round')
    expect(rounds).toHaveLength(2)
    expect(rounds[0]).toMatchObject({ round: 1, diffBuckets: 1 })
    expect(rounds[1]).toMatchObject({ round: 2, diffBuckets: 0 })
    expect(repository.count()).toBe(3)
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.digest).toBe(modules.cutover.buildSessionJsonSnapshot(structuredClone(dataset)).digest)
  })

  it('falls back from a final-verification diff, realigns and completes on the second switch', async () => {
    const { repository } = await setup()
    const dataset = [bucket('one')]
    let drifted = false
    const log = captureLogger((entry) => {
      if (entry.event === E('idle.enter') && !drifted) {
        drifted = true
        addSession(dataset[0], 'switch-drift')
      }
    })
    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })
    expect(result.outcome).toBe('done')
    expect(eventsOf(log, 'switch.verify.retry')).toHaveLength(1)
    expect(eventsOf(log, 'switch.verify.retry')[0]).toMatchObject({ diffBuckets: 1, diffList: ['global'] })
    expect(eventsOf(log, 'idle.enter')).toHaveLength(2)
    expect(eventsOf(log, 'switch.promoted')).toHaveLength(1)
    expect(repository.count()).toBe(2)
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.digest).toBe(modules.cutover.buildSessionJsonSnapshot(structuredClone(dataset)).digest)
  })

  it('abandons the idle wait on timeout, returns to convergence and finishes once streams settle', async () => {
    const { repository } = await setup()
    const dataset = [bucket('one')]
    let activeStreams = 1
    const log = captureLogger((entry) => {
      if (entry.event === E('idle.abandon')) activeStreams = 0
    })
    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: () => activeStreams,
      ...fastOptions({ idleTimeoutMs: 30 }),
    })
    expect(result.outcome).toBe('done')
    expect(eventsOf(log, 'idle.abandon')).toHaveLength(1)
    expect(eventsOf(log, 'idle.abandon')[0]).toMatchObject({ timeoutMs: 30 })
    expect(eventsOf(log, 'idle.enter').length).toBeGreaterThanOrEqual(2)
    expect(eventsOf(log, 'converge.round').length).toBeGreaterThanOrEqual(2)
    expect(eventsOf(log, 'task.done')).toHaveLength(1)
    expect(modules.service.readSessionStorageState().phase).toBe('authoritative')
  })

  it('retries a failing backup with warns, then succeeds and never blocks the switch', async () => {
    const { repository } = await setup()
    const dataset = [bucket('one')]
    const log = captureLogger()
    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      backupDirectory: path.join(tmpDir, 'backups'),
      createBackupWriteStream: createFlakyBackupWriteStream({ failAttempts: 2 }),
      logger: log,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })
    expect(result.outcome).toBe('done')
    expect(eventsOf(log, 'backup.retried')).toHaveLength(2)
    expect(eventsOf(log, 'backup.retried')[0]).toMatchObject({ attempt: 1 })
    expect(eventsOf(log, 'backup.done')).toHaveLength(1)
    const status = modules.migration.readSessionStateBackgroundMigrationStatus()
    expect(status.backup).toMatchObject({ state: 'done', attempts: 3 })
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.backupFile).toBe(status.backup.path)
    expect(await readdir(path.join(tmpDir, 'backups'))).toHaveLength(1)
  })

  it('completes the switch even when every backup attempt fails (bounded retries, no registration)', async () => {
    const { repository } = await setup()
    const dataset = [bucket('one')]
    const log = captureLogger()
    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      backupDirectory: path.join(tmpDir, 'backups'),
      createBackupWriteStream: createFlakyBackupWriteStream({ failAttempts: 99 }),
      logger: log,
      activeStreamCount: () => 0,
      ...fastOptions({ backupRetries: 2 }),
    })
    expect(result.outcome).toBe('done')
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.backupFile).toBeNull()
    expect(await pollUntil(() => modules.migration.readSessionStateBackgroundMigrationStatus()?.backup?.state === 'failed')).toBe(true)
    expect(eventsOf(log, 'backup.retried')).toHaveLength(2)
    expect(eventsOf(log, 'backup.done')).toEqual([])
    expect(eventsOf(log, 'switch.promoted')).toHaveLength(1)
  })

  it('defers an import failure to the convergence rounds and still completes', async () => {
    const { repository } = await setup()
    const dataset = [bucket('one'), bucket('broken', { scope: 'project', projectId: 'demo' })]
    let failReads = 1
    const adapter = fakeFsAdapter(dataset, {
      readSessionState: async (candidate, sessionId, value) => {
        if (sessionId === 'broken' && failReads > 0) {
          failReads -= 1
          throw new Error('disk hiccup')
        }
        return value
      },
    })
    const log = captureLogger()
    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter: adapter,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })
    expect(result.outcome).toBe('done')
    expect(eventsOf(log, 'bucket.import.failed')).toHaveLength(1)
    expect(eventsOf(log, 'bucket.import.failed')[0]).toMatchObject({ bucket: 'project:demo', attempt: 1 })
    expect(repository.count()).toBe(2)
    expect(modules.service.readSessionStorageState().phase).toBe('authoritative')
  })

  it('does not start when the phase is not json_authoritative', async () => {
    await setup()
    modules.service.setSessionStoragePhase(modules.service.SESSION_STORAGE_PHASES.AUTHORITATIVE)
    const log = captureLogger()
    const result = await modules.migration.startSessionStateBackgroundMigration({
      fsAdapter: fakeFsAdapter([bucket()]),
      logger: log,
      ...fastOptions(),
    })
    expect(result).toMatchObject({ started: false, outcome: 'skipped', reason: 'phase-not-json-authoritative', phase: 'authoritative' })
    expect(modules.migration.readSessionStateBackgroundMigrationStatus()).toBeNull()
    expect(namesOf(log)).toEqual([E('skipped')])
  })

  it('routes json_authoritative/cutover_running stores to the background chain and settled stores to the legacy cutover', () => {
    const { SESSION_STORAGE_PHASES: phases } = modules.service
    expect(modules.migration.resolveSessionStateStartupRoute(phases.JSON_AUTHORITATIVE)).toBe('background')
    expect(modules.migration.resolveSessionStateStartupRoute(phases.CUTOVER_RUNNING)).toBe('background')
    expect(modules.migration.resolveSessionStateStartupRoute(phases.JSON_PENDING)).toBe('cutover')
    expect(modules.migration.resolveSessionStateStartupRoute(phases.AUTHORITATIVE)).toBe('cutover')
    // Unknown values keep the fail-closed legacy chain as the backstop.
    expect(modules.migration.resolveSessionStateStartupRoute('future_phase')).toBe('cutover')
  })

  it('resets a cutover_running residue to json_authoritative under the maintenance lock and completes the migration (design §10.1)', async () => {
    const { repository } = await setup()
    // Legacy synchronous-cutover crash residue: phase stuck mid-window with a
    // registered (stale) backup file.
    const staleBackup = path.join(tmpDir, 'stale-backup.json')
    modules.service.setSessionStoragePhase(modules.service.SESSION_STORAGE_PHASES.CUTOVER_RUNNING, { backupFile: staleBackup })
    const dataset = [bucket('one')]
    let observedReset = false
    const log = captureLogger((entry) => {
      // By the first task event the residue must already be gone: phase back
      // to json_authoritative while the stale registration survived verbatim
      // (the backup pass re-verifies it later and rewrites it here).
      if (entry.event === E('started')) {
        observedReset = true
        const state = modules.service.readSessionStorageState()
        expect(state.phase).toBe('json_authoritative')
        expect(state.backupFile).toBe(staleBackup)
      }
    })
    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter: fakeFsAdapter(dataset),
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })
    expect(result).toMatchObject({ started: true, outcome: 'done' })
    expect(observedReset).toBe(true)
    expect(eventsOf(log, 'phase.reset')).toHaveLength(1)
    expect(eventsOf(log, 'phase.reset')[0]).toMatchObject({ previousPhase: 'cutover_running', backupFile: staleBackup })
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.stateCount).toBe(1)
    // The stale registration failed the backup re-check (missing file), so a
    // fresh backup was written and registered instead.
    expect(state.backupFile).not.toBe(staleBackup)
    expect((await stat(state.backupFile)).isFile()).toBe(true)
    expect(repository.count()).toBe(1)
    expect(eventsOf(log, 'task.failed')).toEqual([])
  })

  it('aborts with lock-busy (and owner diagnostics) when another process holds the maintenance lock', async () => {
    const { storage } = await setup()
    const lease = modules.cutover.acquireSessionStateMaintenanceLock(storage, {
      owner: { id: '999:other', pid: 999 },
      pidAlive: () => true,
      operation: 'other-maintenance',
    })
    expect(lease).toBeTruthy()
    const log = captureLogger()
    const result = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      fsAdapter: fakeFsAdapter([bucket()]),
      logger: log,
      owner: { id: '701:bg', pid: 701 },
      pidAlive: () => false,
      ...fastOptions(),
    })
    expect(result).toMatchObject({ started: true, outcome: 'aborted', reason: 'lock-busy' })
    expect(modules.migration.readSessionStateBackgroundMigrationStatus()).toMatchObject({
      state: 'aborted',
      reason: 'lock-busy',
      // §10.2: the owner diagnostics ride on the snapshot itself so the
      // second process's /api/migration-status is not blank.
      lockOwner: '999:other',
      lockOwnerPid: 999,
      lockFencing: expect.any(Number),
    })
    expect(eventsOf(log, 'task.aborted')[0]).toMatchObject({ reason: 'lock-busy', lockOwner: '999:other', lockOwnerPid: 999 })
    expect(modules.service.readSessionStorageState().phase).toBe('json_authoritative')
    expect(modules.cutover.releaseSessionStateMaintenanceLock(storage, lease)).toBe(true)
  })
})
