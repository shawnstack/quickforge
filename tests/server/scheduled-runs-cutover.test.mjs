import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import {
  acquireScheduledRunsMaintenanceLock,
  getScheduledRunsPhase,
  initializeScheduledRunsCutover,
  isScheduledRunsMaintenanceActive,
  releaseScheduledRunsMaintenanceLock,
  renewScheduledRunsMaintenanceLock,
  runScheduledRunsMaintenance,
  scheduledRunsDigest,
  splitScheduledTasksRuns,
} from '../../server/scheduled-runs-cutover.mjs'

function run(id, overrides = {}) {
  return { id, status: 'success', trigger: 'manual', startedAt: '2026-01-01T00:00:00.000Z', result: id, ...overrides }
}

function tasksWithRuns() {
  return {
    'task-a': { id: 'task-a', title: 'A', runs: [run('same'), run('a')] },
    'task-b': { id: 'task-b', title: 'B', runs: [run('same', { result: 'b' })] },
  }
}

describe('scheduled runs cutover coordinator', () => {
  let directory
  let storage
  let repository
  let currentTasks
  let backups

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-runs-cutover-'))
    backups = path.join(directory, 'backups')
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'quickforge.sqlite3') })
    repository = createScheduledTaskRunsRepository(storage)
    currentTasks = tasksWithRuns()
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  function options(overrides = {}) {
    return {
      storage,
      repository,
      backupDirectory: backups,
      readTasks: vi.fn(async () => structuredClone(currentTasks)),
      writeTasks: vi.fn(async (value) => { currentTasks = structuredClone(value) }),
      logger: { warn: vi.fn() },
      ...overrides,
    }
  }

  it('validates empty/multi-task data, permits cross-task duplicate IDs, and rejects same-task conflicts/invalid fields', () => {
    expect(splitScheduledTasksRuns({})).toMatchObject({ count: 0 })
    const snapshot = splitScheduledTasksRuns(tasksWithRuns())
    expect(snapshot.count).toBe(3)
    expect(snapshot.digest).toBe(scheduledRunsDigest(snapshot.entries))
    expect(() => splitScheduledTasksRuns({ bad: { id: 'bad', runs: [run('x'), run('x')] } })).toThrow(/Duplicate/)
    expect(() => splitScheduledTasksRuns({ bad: { id: 'bad', runs: [{ ...run('x'), status: 'queued' }] } })).toThrow(/status/)
    expect(() => splitScheduledTasksRuns({ bad: { id: 'bad', runs: [{ ...run('x'), startedAt: 'invalid' }] } })).toThrow(/startedAt/)
  })

  it('replaces old v2 shadow data, verifies digest, writes a logical v1 backup, and slims JSON', async () => {
    repository.create('shadow', run('old'), { source: 'v2_shadow' })
    const result = await initializeScheduledRunsCutover(options())
    expect(result.phase).toBe('authoritative')
    expect(getScheduledRunsPhase()).toBe('authoritative')
    expect(repository.count()).toBe(3)
    expect(repository.get('shadow', 'old')).toBeNull()
    expect(currentTasks['task-a']).not.toHaveProperty('runs')
    const files = await readdir(backups)
    expect(files).toHaveLength(1)
    const backup = JSON.parse(await readFile(path.join(backups, files[0]), 'utf8'))
    expect(backup).toMatchObject({ version: 1, scheduledRuns: { count: 3 } })
    expect(splitScheduledTasksRuns(backup.data.scheduledTasks).digest).toBe(result.digest)
  })

  it('returns to hybrid when failure occurs before authoritative commit', async () => {
    const writeTasks = vi.fn(async () => { throw new Error('not reached') })
    const failingRepository = { ...repository, replaceAll: vi.fn(() => { throw new Error('sqlite apply failed') }) }
    const result = await initializeScheduledRunsCutover(options({ repository: failingRepository, writeTasks }))
    expect(result.phase).toBe('hybrid')
    expect(currentTasks['task-a'].runs).toHaveLength(2)
    expect(writeTasks).not.toHaveBeenCalled()
  })

  it('keeps SQLite authoritative pending when JSON slimming fails and retries next startup', async () => {
    const first = await initializeScheduledRunsCutover(options({ writeTasks: vi.fn(async () => { throw new Error('json failed') }) }))
    expect(first.phase).toBe('sqlite_authoritative_json_pending')
    expect(repository.count()).toBe(3)
    expect(currentTasks['task-a'].runs).toHaveLength(2)

    const second = await initializeScheduledRunsCutover(options())
    expect(second.phase).toBe('authoritative')
    expect(currentTasks['task-a']).not.toHaveProperty('runs')
  })

  it('recovers cutover_running by rerunning JSON and preserves authoritative rows on repeated startup', async () => {
    const snapshot = splitScheduledTasksRuns(currentTasks)
    storage.prepare(`UPDATE scheduled_runs_state SET phase = 'cutover_running', run_count = ?, digest = ? WHERE singleton = 1`)
      .run(snapshot.count, snapshot.digest)
    const recovered = await initializeScheduledRunsCutover(options())
    expect(recovered.phase).toBe('authoritative')
    repository.upsert('task-a', run('new-runtime'), { source: 'runtime' })
    const repeated = await initializeScheduledRunsCutover(options())
    expect(repeated.phase).toBe('authoritative')
    expect(repository.get('task-a', 'new-runtime')).not.toBeNull()
  })

  it('keeps startup in hybrid when JSON validation fails before authoritative commit', async () => {
    currentTasks = { bad: { id: 'bad', runs: [run('x'), run('x')] } }
    const result = await initializeScheduledRunsCutover(options())
    expect(result.phase).toBe('hybrid')
    expect(result.diagnostic).toMatchObject({ operation: 'cutover' })
  })

  it('degrades without blocking authoritative startup when the JSON mirror is corrupt', async () => {
    const pending = await initializeScheduledRunsCutover(options({ writeTasks: vi.fn(async () => { throw new Error('json failed') }) }))
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    storage.prepare("UPDATE scheduled_runs_state SET phase = 'authoritative' WHERE singleton = 1").run()
    currentTasks = { bad: { id: 'bad', runs: [run('x'), run('x')] } }
    const opts = options()
    const result = await initializeScheduledRunsCutover(opts)
    expect(result.phase).toBe('authoritative')
    expect(result.diagnostic).toMatchObject({ operation: 'authoritative_validation' })
    expect(opts.logger.warn).toHaveBeenCalledWith('Scheduled runs authoritative JSON mirror is invalid; continuing startup', { errorName: 'TypeError' })
    expect(getScheduledRunsPhase()).toBe('authoritative')
  })

  it('does not repeat SQLite health scans during authoritative startup', async () => {
    await initializeScheduledRunsCutover(options())
    const health = vi.fn(() => { throw new Error('routine health scan must not run') })
    const routineStorage = { ...storage, health }
    await expect(initializeScheduledRunsCutover(options({ storage: routineStorage })))
      .resolves.toMatchObject({ phase: 'authoritative' })
    expect(health).not.toHaveBeenCalled()
    expect(getScheduledRunsPhase()).toBe('authoritative')
  })

  it('resets the retained maintenance state after a later maintenance run releases its lock', async () => {
    const retainError = new Error('restore retained the lock')
    retainError.retainScheduledRunsMaintenance = true
    await expect(runScheduledRunsMaintenance(async () => { throw retainError }, { storage, operation: 'test-retain' }))
      .rejects.toThrow('restore retained the lock')
    expect(isScheduledRunsMaintenanceActive(storage)).toBe(true)

    // Simulate the retained lease being recovered externally (e.g. next boot).
    storage.prepare('DELETE FROM scheduled_runs_maintenance_lock').run()
    await runScheduledRunsMaintenance(async () => 'done', { storage, operation: 'test-followup' })
    expect(isScheduledRunsMaintenanceActive(storage)).toBe(false)
  })

  it('fences lock ownership, renews leases, and only takes expired locks from a confirmed dead PID', () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const first = acquireScheduledRunsMaintenanceLock(storage, {
      owner: { id: '111:first', pid: 111 }, operation: 'first', now: () => now, ttlMs: 30, pidAlive: () => true,
    })
    expect(first).toMatchObject({ owner: '111:first', fencing: 1 })
    now += 20
    expect(renewScheduledRunsMaintenanceLock(storage, first, { now: () => now, ttlMs: 30 })).toBe(true)
    now += 20
    expect(acquireScheduledRunsMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, operation: 'second', now: () => now, ttlMs: 30, pidAlive: () => true,
    })).toBeNull()
    // A dead PID alone is not enough while the lease is still unexpired —
    // stealing requires expiry AND a confirmed dead owner, like the session
    // and share lock domains.
    expect(acquireScheduledRunsMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, operation: 'second', now: () => now, ttlMs: 30, pidAlive: () => false,
    })).toBeNull()
    now += 20
    const second = acquireScheduledRunsMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, operation: 'second', now: () => now, ttlMs: 30, pidAlive: (pid) => pid !== 111,
    })
    expect(second).toMatchObject({ owner: '222:second', fencing: 2 })
    expect(releaseScheduledRunsMaintenanceLock(storage, first)).toBe(false)
    expect(releaseScheduledRunsMaintenanceLock(storage, second)).toBe(true)
  })

  it('serializes concurrent coordinators through the SQLite lock', async () => {
    let releases = 0
    const writeTasks = vi.fn(async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      currentTasks = structuredClone(value)
      releases += 1
    })
    const [first, second] = await Promise.all([
      initializeScheduledRunsCutover(options({ writeTasks, owner: 'one' })),
      initializeScheduledRunsCutover(options({ writeTasks, owner: 'two' })),
    ])
    expect([first.phase, second.phase]).toEqual(['authoritative', 'authoritative'])
    expect(repository.count()).toBe(3)
    expect(releases).toBeGreaterThanOrEqual(1)
  })
})
