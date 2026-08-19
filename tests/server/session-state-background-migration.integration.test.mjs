import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Integration-level test matrix for the session-state background migration
// (docs/architecture/session-storage-background-migration-design.zh-CN.md
// §9 feature 5). Unlike tests/server/session-state-background-migration.test.mjs
// (injected in-memory fsAdapter + mock mirror), these tests run the REAL
// components end to end:
//   - a real QUICKFORGE_DATA_DIR temp layout (env set before every dynamic
//     import — the vi.resetModules cache-bust pattern),
//   - the real physical fs adapter (createPhysicalSessionStateFsAdapter),
//   - a real repository over a real temp SQLite database,
//   - the real storage.mjs session write/read path
//     (writeSessionValueWithMetadata / deleteSessionWithMetadata /
//     readSessionValue) including the facade routing before and after the
//     promote, plus the real JSON mirror adapter wired by the orchestrator.
// Test-controlled injections are limited to TIMING and CRASH POINTS:
// fastOptions (short round delay / idle polling), activeStreamCount, and
// fsAdapter wrappers that only delay or fail around real file reads.
//
// Matrix (design §9 feature 5 acceptance):
//   a) concurrent-write convergence + per-bucket digest/content parity,
//   b) switch-window queuing semantics (boundary write + barrier-parked write
//      both durable in the authoritative source after promote),
//   c) crash recovery idempotency mid-importing and mid-converging,
//   d) stale maintenance-lock takeover (expired + dead pid).

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
    storage: await import('../../server/storage.mjs'),
  }
  return modules
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
const eventsOf = (log, name) => log.entries.filter((entry) => entry.event === E(name))

function fastOptions(overrides = {}) {
  return {
    roundDelayMs: 1,
    idlePollIntervalMs: 1,
    idleThresholdMs: 0,
    idleTimeoutMs: 60_000,
    backupRetries: 3,
    ...overrides,
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met before timeout')
    await delay(5)
  }
}

function sessionBody(sessionId, overrides = {}) {
  const scope = overrides.scope || 'global'
  return {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId: overrides.projectId || 'demo' } : {}),
    title: `Title ${sessionId}`,
    stateVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    messages: [{ role: 'user', content: `hello ${sessionId}` }],
    ...overrides.body,
  }
}

function withExtraMessage(body, tag) {
  return {
    ...body,
    stateVersion: (body.stateVersion || 0) + 1,
    lastModified: new Date().toISOString(),
    messages: [...body.messages, { role: 'assistant', content: `reply-${tag}` }],
  }
}

// Wraps the REAL physical adapter; hooks only control timing or inject a
// one-shot failure around real file reads. Reads themselves stay real.
function wrappedPhysicalAdapter({ beforeListSessionFiles, beforeReadSessionState, beforeReadMetadataBucket } = {}) {
  const real = modules.storage.createPhysicalSessionStateFsAdapter()
  return {
    async *listBuckets() {
      yield* real.listBuckets()
    },
    async *listSessionFiles(bucket) {
      if (beforeListSessionFiles) await beforeListSessionFiles(bucket)
      yield* real.listSessionFiles(bucket)
    },
    async readSessionState(bucket, sessionId) {
      if (beforeReadSessionState) await beforeReadSessionState(bucket, sessionId)
      return real.readSessionState(bucket, sessionId)
    },
    async readMetadataBucket(bucket) {
      if (beforeReadMetadataBucket) await beforeReadMetadataBucket(bucket)
      return real.readMetadataBucket(bucket)
    },
  }
}

// Full JSON-side summary (count + canonical digest) over the real files.
async function jsonSummary() {
  const source = modules.cutover.createStreamingSessionSource(modules.storage.createPhysicalSessionStateFsAdapter())()
  return modules.cutover.summarizeSessionSource(source)
}

// Per-session content parity: every normalized JSON record must match its
// SQLite row exactly (state + metadata), with no extra SQLite rows.
async function expectRepositoryMatchesJson(repository) {
  const adapter = modules.storage.createPhysicalSessionStateFsAdapter()
  const stream = modules.cutover.createSessionBucketRecordStream(adapter)
  const seen = []
  for await (const bucket of adapter.listBuckets()) {
    for await (const record of stream(bucket)) {
      const row = repository.findBySessionId(record.sessionId)
      expect(row, `session ${record.sessionId} must exist in SQLite`).not.toBeNull()
      expect(row.scope).toBe(record.scope)
      expect(row.projectId ?? null).toBe(record.projectId ?? null)
      expect(row.state).toEqual(record.state)
      expect(row.metadata).toEqual(record.metadata)
      seen.push(record.sessionId)
    }
  }
  expect(repository.count()).toBe(seen.length)
  return seen
}

function sqliteBucketCounts(storage) {
  return storage.prepare('SELECT scope, project_id, COUNT(*) AS count FROM session_states GROUP BY scope, project_id').all()
    .map((row) => ({ scope: row.scope, projectId: row.scope === 'project' ? row.project_id : null, count: Number(row.count) }))
}

function sessionFileRelative(bucket, sessionId) {
  return path.join('storage', 'conversations', bucket.scope === 'project' ? path.join('projects', bucket.projectId) : 'global', 'sessions', `${sessionId}.json`)
}

async function readJsonSessionFile(bucket, sessionId) {
  return JSON.parse(await readFile(path.join(tmpDir, 'data', sessionFileRelative(bucket, sessionId)), 'utf8'))
}

describe('session state background migration integration (feature 5)', () => {
  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bg-migration-int-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await loadModules()
  })

  afterEach(async () => {
    try { modules.service.stopSessionStateService() } catch { /* no timer running */ }
    // Settle any in-flight mirror drain (e.g. the fire-and-forget drain kicked
    // by a parked-write replay) before the database closes, so a background
    // materialization cannot race the teardown into an unhandled rejection.
    try { await modules.service.drainSessionJsonMirror() } catch { /* drained or store closed */ }
    await modules.database.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function setup() {
    await modules.storage.ensureStorage()
    const storage = await modules.database.initializeSqliteStorage({ databasePath: path.join(tmpDir, `state-${++dbSerial}.sqlite3`) })
    const repository = modules.repository.createSessionStateRepository(storage)
    modules.service.configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
    return { storage, repository }
  }

  it('a) converges and promotes while real business writes keep landing, with zero loss and digest parity', async () => {
    const { storage, repository } = await setup()
    // Seed the JSON layout through the real write API: two buckets.
    const live = new Map()
    for (const [id, overrides] of [['g1'], ['g2'], ['p1', { scope: 'project' }], ['p2', { scope: 'project' }]]) {
      const bodyValue = sessionBody(id, overrides)
      live.set(id, bodyValue)
      await modules.storage.writeSessionValueWithMetadata(id, bodyValue)
    }

    // A concurrent business writer: six rounds of modify/create/delete through
    // the real storage write APIs while the task runs. The injected sleep
    // paces each post-diff round delay on writer progress so rounds genuinely
    // interleave; activeStreamCount keeps the switch window closed until the
    // writer finishes (the real "no active stream" idle signal).
    const plan = [
      ['modify', 'g1'], ['create', 'g3'], ['delete', 'g2'],
      ['modify', 'g1'], ['create', 'p3', { scope: 'project' }], ['delete', 'p2'],
      ['modify', 'g1'], ['modify', 'g3'], ['create', 'g4'],
      ['modify', 'g1'], ['modify', 'p3'], ['create', 'p4', { scope: 'project' }],
      ['modify', 'g1'], ['delete', 'g3'], ['modify', 'p4'],
      ['modify', 'g1'], ['create', 'g5'], ['delete', 'p4'],
    ]
    let roundsDone = 0
    let writerDone = false
    let lastRoundsSeen = 0
    const pacedSleep = async () => {
      if (writerDone) return
      await until(() => roundsDone > lastRoundsSeen || writerDone)
      lastRoundsSeen = roundsDone
    }
    const log = captureLogger()
    const taskPromise = modules.migration.startSessionStateBackgroundMigration({
      storage,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: () => (writerDone ? 0 : 1),
      sleep: pacedSleep,
      ...fastOptions(),
    })
    for (let index = 0; index < plan.length; index += 1) {
      const [action, id, overrides] = plan[index]
      if (action === 'create') {
        const bodyValue = sessionBody(id, overrides)
        live.set(id, bodyValue)
        await modules.storage.writeSessionValueWithMetadata(id, bodyValue)
      } else if (action === 'modify') {
        const next = withExtraMessage(live.get(id), `round-${Math.floor(index / 3) + 1}`)
        live.set(id, next)
        await modules.storage.writeSessionValueWithMetadata(id, next)
      } else {
        live.delete(id)
        await modules.storage.deleteSessionWithMetadata(id)
      }
      if (index % 3 === 2) roundsDone += 1
    }
    writerDone = true

    const result = await taskPromise
    expect(result).toMatchObject({ started: true, outcome: 'done' })
    expect(result.promoted).toMatchObject({ phase: 'authoritative' })

    // The task must have gone through multiple convergence rounds: the writer
    // forced at least one diff round after the initial import.
    const rounds = eventsOf(log, 'converge.round')
    expect(rounds.length).toBeGreaterThanOrEqual(2)
    expect(rounds.some((round) => round.diffBuckets > 0)).toBe(true)

    // Global digest parity: SQLite's registered digest/count equals the final
    // JSON snapshot, and the repository holds exactly the surviving sessions.
    const summary = await jsonSummary()
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.stateCount).toBe(summary.count)
    expect(state.digest).toBe(summary.digest)
    expect(repository.count()).toBe(live.size)
    expect(repository.listMirrorQueue()).toEqual([])

    // Per-bucket parity: SQLite bucket rows match the JSON bucket layout
    // (no orphan buckets, no missing buckets).
    const jsonBuckets = [
      { scope: 'global', projectId: null },
      { scope: 'project', projectId: 'demo' },
    ]
    expect(sqliteBucketCounts(storage)).toEqual(jsonBuckets.map((bucket) => ({ ...bucket, count: [...live.keys()].filter((id) => {
      const value = live.get(id)
      return value.scope === bucket.scope && (bucket.scope !== 'project' || value.projectId === bucket.projectId)
    }).length })))

    // Business zero-loss + per-session content parity (state AND metadata).
    const seen = await expectRepositoryMatchesJson(repository)
    expect([...seen].sort()).toEqual([...live.keys()].sort())
    for (const [id, expected] of live) {
      const read = await modules.storage.readSessionValue(id)
      expect(read.messages).toEqual(expected.messages)
      expect(read.title).toBe(expected.title)
      expect(read.stateVersion).toBe(expected.stateVersion)
    }
    // Deleted sessions must be gone from both stores.
    for (const id of ['g2', 'g3', 'p2', 'p4']) {
      expect(await modules.storage.readSessionValue(id)).toBeNull()
      expect(repository.findBySessionId(id)).toBeNull()
    }
    expect(eventsOf(log, 'task.failed')).toEqual([])
  })

  it('b) queues business writes across the switch window: the boundary write realigns, the parked write replays durably', async () => {
    const { repository } = await setup()
    await modules.storage.writeSessionValueWithMetadata('g1', sessionBody('g1'))

    // Boundary write: fired the moment the task enters its first idle wait
    // (before the switch window). It lands in JSON, the window's final
    // verification must see the diff, release, realign and promote on a
    // second window.
    let boundaryWrite = null
    let boundaryWriteResolved = false
    // Parked write: fired from INSIDE the second window's verification reads
    // (deterministically after the barrier gate closed) — it must park until
    // the window ends and stay durable in the authoritative store afterwards.
    let parkedWrite = null
    let parkedWriteResolvedAt = 0
    let promotedEmittedAt = 0
    let switchAcquires = 0
    let parkedFired = false
    const fireBoundaryWrite = () => {
      boundaryWrite = modules.storage.writeSessionValueWithMetadata('g-late', sessionBody('g-late'))
      void boundaryWrite.then(() => { boundaryWriteResolved = true }, () => { boundaryWriteResolved = false })
    }
    const fireParkedWrite = () => {
      parkedWrite = modules.storage.writeSessionValueWithMetadata('g-parked', sessionBody('g-parked'))
      void parkedWrite.then(() => { parkedWriteResolvedAt = Date.now() }, () => { parkedWriteResolvedAt = -1 })
    }
    const log = captureLogger((entry) => {
      if (entry.event === E('idle.enter') && !boundaryWrite) fireBoundaryWrite()
      if (entry.event === E('switch.lock.acquire')) switchAcquires += 1
      if (entry.event === E('switch.promoted')) promotedEmittedAt = Date.now()
    })
    const gatedByBackup = () => (modules.migration.readSessionStateBackgroundMigrationStatus()?.backup?.state === 'done' ? 0 : 1)
    const fsAdapter = wrappedPhysicalAdapter({
      beforeReadSessionState: () => {
        if (switchAcquires >= 2 && !parkedFired) {
          parkedFired = true
          fireParkedWrite()
        }
      },
      beforeReadMetadataBucket: () => {
        if (switchAcquires >= 2 && !parkedFired) {
          parkedFired = true
          fireParkedWrite()
        }
      },
    })

    const result = await modules.migration.startSessionStateBackgroundMigration({
      repository,
      fsAdapter,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: gatedByBackup,
      ...fastOptions(),
    })

    expect(result).toMatchObject({ started: true, outcome: 'done' })
    expect(parkedFired).toBe(true)
    // Exactly one verification diff (the boundary write) and one promote.
    expect(eventsOf(log, 'switch.verify.retry')).toHaveLength(1)
    expect(eventsOf(log, 'switch.verify.retry')[0]).toMatchObject({ diffBuckets: 1, diffList: ['global'] })
    expect(eventsOf(log, 'switch.promoted')).toHaveLength(1)

    // Both writes completed without error; the parked one only settled after
    // the promote had been emitted (it sat in the barrier queue meanwhile).
    await until(() => boundaryWriteResolved && parkedWriteResolvedAt !== 0)
    expect(parkedWriteResolvedAt).toBeGreaterThanOrEqual(promotedEmittedAt)
    await boundaryWrite
    await parkedWrite

    // The authoritative read path is SQLite now: both writes must be readable
    // through the facade (readSessionValue routes via the repository).
    expect((await modules.storage.readSessionValue('g-late')).messages).toEqual(sessionBody('g-late').messages)
    const parkedRead = await modules.storage.readSessionValue('g-parked')
    expect(parkedRead).not.toBeNull()
    expect(parkedRead.messages).toEqual(sessionBody('g-parked').messages)
    expect(parkedRead.title).toBe('Title g-parked')
    expect(repository.count()).toBe(3)

    // Both sides eventually consistent: drain the mirror and compare the JSON
    // files (mirror side) with the authoritative rows.
    await modules.service.drainSessionJsonMirror()
    expect(repository.listMirrorQueue()).toEqual([])
    expect(await readJsonSessionFile({ scope: 'global' }, 'g-parked')).toMatchObject({ id: 'g-parked', title: 'Title g-parked' })
    expect(await readJsonSessionFile({ scope: 'global' }, 'g-late')).toMatchObject({ id: 'g-late' })
    const summary = await jsonSummary()
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    // Promote happened with the two aligned sessions; the parked replay added
    // the third row right after, through the authoritative write path.
    expect(result.promoted).toMatchObject({ phase: 'authoritative', stateCount: 2 })
    expect(summary.count).toBe(3)
    expect(state.stateCount).toBe(2)
    expect(eventsOf(log, 'task.failed')).toEqual([])
  })

  it('c1) crashes mid-importing, then a fresh task run completes idempotently (no duplicates, no orphans)', async () => {
    const { storage, repository } = await setup()
    for (const [id, overrides] of [['g1'], ['g2'], ['p1', { scope: 'project' }]]) {
      await modules.storage.writeSessionValueWithMetadata(id, sessionBody(id, overrides))
    }

    // Crash point: the importing loop enumerates buckets global-first; let the
    // global bucket align (rows committed), then fail the project bucket's
    // file listing — the failure escapes the importing loop and terminates the
    // task (phase untouched, committed bucket rows left behind).
    let crashed = false
    const fsAdapter = wrappedPhysicalAdapter({
      beforeListSessionFiles: async (bucket) => {
        if (bucket.scope === 'project' && !crashed) {
          crashed = true
          throw new Error('simulated crash while enumerating the project bucket')
        }
      },
    })
    const first = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      fsAdapter,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: captureLogger(),
      ...fastOptions(),
    })
    expect(first).toMatchObject({ started: true, outcome: 'failed', stage: 'importing' })
    // Partial residue, phase NOT reset, nothing cleaned up.
    expect(modules.service.readSessionStorageState().phase).toBe('json_authoritative')
    expect(repository.count()).toBe(2)
    expect(modules.migration.readSessionStateBackgroundMigrationStatus()).toMatchObject({ state: 'failed' })

    // Restart with a clean, fully real configuration (real physical adapter,
    // no injections beyond the fast pacing options).
    const log = captureLogger()
    const second = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      activeStreamCount: () => 0,
      ...fastOptions(),
    })
    expect(second).toMatchObject({ started: true, outcome: 'done' })
    expect(second.promoted).toMatchObject({ phase: 'authoritative', stateCount: 3 })

    // Idempotency: the rerun realigned over the committed residue instead of
    // duplicating it; digests/counts settle at the JSON snapshot's values.
    const summary = await jsonSummary()
    const state = modules.service.readSessionStorageState()
    expect(state.phase).toBe('authoritative')
    expect(state.stateCount).toBe(summary.count)
    expect(state.digest).toBe(summary.digest)
    expect(repository.count()).toBe(3)
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true })
    expect(repository.listMirrorQueue()).toEqual([])
    expect(sqliteBucketCounts(storage)).toEqual([
      { scope: 'global', projectId: null, count: 2 },
      { scope: 'project', projectId: 'demo', count: 1 },
    ])
    await expectRepositoryMatchesJson(repository)
    expect(eventsOf(log, 'task.failed')).toEqual([])
  })

  it('c2) crashes mid-converging after a reconciled diff, then a fresh task run converges without residue', async () => {
    const { storage, repository } = await setup()
    await modules.storage.writeSessionValueWithMetadata('g1', sessionBody('g1'))

    // A write lands right after the import finishes (armed at the first
    // bucket.imported event); the wrapper makes the next JSON read wait for
    // it, so convergence round 1 deterministically sees the diff. The round's
    // post-reconcile sleep then throws, terminating the task mid-converging —
    // after the diff bucket was already realigned into SQLite.
    let lateWrite = null
    let observedConvergingState = false
    const log = captureLogger((entry) => {
      if (entry.event === E('bucket.imported') && !lateWrite) {
        lateWrite = modules.storage.writeSessionValueWithMetadata('g-late', sessionBody('g-late'))
      }
      // Design §6.2: the background status domain must expose the converging
      // state while convergence rounds run (not stay on 'importing').
      if (entry.event === E('converge.round')
        && modules.migration.readSessionStateBackgroundMigrationStatus()?.state === 'converging') {
        observedConvergingState = true
      }
    })
    let lateWriteWaited = false
    const fsAdapter = wrappedPhysicalAdapter({
      beforeReadMetadataBucket: async () => {
        if (lateWrite && !lateWriteWaited) {
          lateWriteWaited = true
          await lateWrite
        }
      },
    })
    const first = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      fsAdapter,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      ...fastOptions(),
      sleep: async () => { throw new Error('simulated crash during the convergence round delay') },
    })
    expect(first).toMatchObject({ started: true, outcome: 'failed', stage: 'converging' })
    expect(observedConvergingState).toBe(true)
    await lateWrite
    expect(modules.service.readSessionStorageState().phase).toBe('json_authoritative')
    // Both sessions were already reconciled before the crash.
    expect(repository.count()).toBe(2)

    const second = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: captureLogger(),
      activeStreamCount: () => 0,
      ...fastOptions(),
    })
    expect(second).toMatchObject({ started: true, outcome: 'done' })
    const summary = await jsonSummary()
    const state = modules.service.readSessionStorageState()
    expect(summary.count).toBe(2)
    expect(state.stateCount).toBe(2)
    expect(state.digest).toBe(summary.digest)
    expect(repository.count()).toBe(2)
    expect(repository.verifyIntegrity({ quickCheck: true })).toMatchObject({ ok: true })
    expect(repository.listMirrorQueue()).toEqual([])
    await expectRepositoryMatchesJson(repository)
  })

  it('d) takes over an expired maintenance lock left behind by a dead pid', async () => {
    const { storage, repository } = await setup()
    await modules.storage.writeSessionValueWithMetadata('g1', sessionBody('g1'))

    // A genuinely dead pid: spawn a throwaway node process and let it exit.
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    const deadPid = await new Promise((resolve) => {
      child.on('exit', () => { resolve(child.pid) })
    })
    await delay(50)

    const expiredAt = new Date(Date.now() - 120_000).toISOString()
    storage.prepare(`INSERT INTO session_state_maintenance_lock
      (singleton, owner, owner_pid, fencing, operation, acquired_at, heartbeat_at, expires_at)
      VALUES (1, '999:ghost', ?, 1, 'legacy-cutover', ?, ?, ?)`)
      .run(deadPid, expiredAt, expiredAt, expiredAt)

    const log = captureLogger()
    const result = await modules.migration.startSessionStateBackgroundMigration({
      storage,
      backupDirectory: path.join(tmpDir, 'backups'),
      logger: log,
      owner: { id: '702:takeover', pid: process.pid },
      activeStreamCount: () => 0,
      ...fastOptions(),
    })
    expect(result).toMatchObject({ started: true, outcome: 'done' })
    // The takeover bumped the fencing token (stale row had fencing 1).
    expect(eventsOf(log, 'started')[0]).toMatchObject({ lockFencing: 2 })
    expect(eventsOf(log, 'task.aborted')).toEqual([])
    expect(eventsOf(log, 'task.failed')).toEqual([])
    expect(modules.service.readSessionStorageState().phase).toBe('authoritative')
    expect(repository.count()).toBe(1)
    // The task released the lock it took over.
    expect(Number(storage.prepare('SELECT COUNT(*) AS count FROM session_state_maintenance_lock').get().count)).toBe(0)
  })
})
