import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import {
  acquireSessionStateMaintenanceLock,
  initializeSessionStateCutover,
  releaseSessionStateMaintenanceLock,
} from '../../server/session-state-cutover.mjs'
import {
  configureSessionStateService,
  exportSessionStateSnapshot,
  normalizeSessionSnapshotValues,
  readSessionStorageState,
} from '../../server/session-state-service.mjs'
import {
  computeSessionSnapshotDigest,
  exportSessionStateForBackup,
  recoverSessionStateRestorePlan,
  restoreSessionStateSnapshot,
} from '../../server/session-state-backup.mjs'

function bucket(sessionId, overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  const state = {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    title: 'Session',
    messages: [{ role: 'user', content: 'hello', unknown: true }],
    ...overrides.state,
  }
  const metadata = overrides.metadata === undefined ? {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    messageCount: 1,
    metadataUnknown: { keep: true },
  } : overrides.metadata
  return { scope, projectId, sessions: { [sessionId]: state }, metadata: metadata === null ? {} : { [sessionId]: metadata } }
}

function flakyRepository(repository, { failTimes = 1 } = {}) {
  let failures = 0
  return {
    ...repository,
    replaceAll: (inputs, options) => {
      if (failures < failTimes) {
        failures += 1
        throw new Error('simulated replace failure')
      }
      return repository.replaceAll(inputs, options)
    },
  }
}

function snapshotValuesFromRepository(repository) {
  const snapshot = repository.exportSnapshot()
  return {
    sessions: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.state])),
    sessionsMetadata: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.metadata])),
    count: snapshot.count,
    digest: snapshot.digest,
  }
}

describe('authoritative session state backup/restore', () => {
  let directory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-backup-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }, phase: 'json_authoritative' })
    await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory: path.join(directory, 'backups'),
      readBuckets: vi.fn(async () => [bucket('one'), bucket('two', { scope: 'project', projectId: 'p1' })]),
      mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
      owner: { id: '201:test', pid: 201 },
      pidAlive: () => false,
    })
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('exports an integrity-verified snapshot with phase/count/digest', async () => {
    const exported = await exportSessionStateForBackup()
    expect(exported.count).toBe(2)
    expect(exported.digest).toBe(repository.digest())
    expect(exported.phase).toBe('authoritative')
    expect(Object.keys(exported.sessions)).toEqual(['one', 'two'])
    expect(Object.keys(exported.sessionsMetadata)).toEqual(['one', 'two'])
    expect(exported.sessions.one.messages[0].content).toBe('hello')
  })

  it('restores a full replace roundtrip and verifies count/digest', async () => {
    const before = repository.exportSnapshot()
    const target = {
      sessions: {
        'new-a': { id: 'new-a', scope: 'global', stateVersion: 1, messages: [], title: 'New A' },
        'new-b': { id: 'new-b', scope: 'global', stateVersion: 1, messages: [], title: 'New B' },
      },
      sessionsMetadata: {},
    }
    const restored = await restoreSessionStateSnapshot(target, { mode: 'replace' })
    expect(restored).toEqual({ sessions: 2, sessionsMetadata: 2 })
    const after = repository.exportSnapshot()
    expect(after.count).toBe(2)
    expect(after.digest).toBe(computeSessionSnapshotDigest({
      sessions: Object.fromEntries(after.records.map((record) => [record.sessionId, record.state])),
      sessionsMetadata: Object.fromEntries(after.records.map((record) => [record.sessionId, record.metadata])),
    }))
    expect(after.digest).not.toBe(before.digest)
    expect(repository.findBySessionId('new-a').state.title).toBe('New A')
    expect(repository.findBySessionId('new-b').metadata.title).toBe('New B')
    expect(repository.findBySessionId('one')).toBeNull()
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2 })
  })

  it('merge mode preserves local-only sessions and backup wins on conflict', async () => {
    const kept = {
      sessions: {
        'kept': { id: 'kept', scope: 'global', stateVersion: 1, messages: [], title: 'Kept' },
        'conflict': { id: 'conflict', scope: 'global', stateVersion: 1, messages: [], title: 'Local' },
      },
      sessionsMetadata: {
        'kept': { id: 'kept', scope: 'global', stateVersion: 1, title: 'Kept' },
        'conflict': { id: 'conflict', scope: 'global', stateVersion: 1, title: 'Local' },
      },
    }
    await restoreSessionStateSnapshot(kept, { mode: 'replace' })

    const merged = await restoreSessionStateSnapshot({
      sessions: {
        'conflict': { id: 'conflict', scope: 'global', stateVersion: 1, messages: [], title: 'Backup' },
        'from-backup': { id: 'from-backup', scope: 'global', stateVersion: 1, messages: [], title: 'Backup only' },
      },
      sessionsMetadata: {},
    }, { mode: 'merge' })
    expect(merged).toEqual({ sessions: 3, sessionsMetadata: 3 })
    expect(repository.findBySessionId('kept')).not.toBeNull()
    expect(repository.findBySessionId('conflict').state.title).toBe('Backup')
    expect(repository.findBySessionId('from-backup').metadata.title).toBe('Backup only')
    expect(repository.findBySessionId('one')).toBeNull()
  })

  it('compensates back to the exact before-state when the apply fails', async () => {
    const before = snapshotValuesFromRepository(repository)
    const fake = flakyRepository(repository, { failTimes: 1 })
    configureSessionStateService({ repository: fake, mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }, phase: 'authoritative' })
    const target = {
      sessions: { 'boom': { id: 'boom', scope: 'global', stateVersion: 1, messages: [], title: 'Boom' } },
      sessionsMetadata: {},
    }
    await expect(restoreSessionStateSnapshot(target, { mode: 'replace', repository: fake })).rejects.toThrow('simulated replace failure')
    const after = snapshotValuesFromRepository(repository)
    expect(after.count).toBe(before.count)
    expect(after.digest).toBe(before.digest)
    expect(repository.findBySessionId('one')).not.toBeNull()
  })

  it('leaves a compensation_failed plan and recovers by rolling back on the next start', async () => {
    const planFile = path.join(directory, 'session-state-restore-plan.json')
    const before = snapshotValuesFromRepository(repository)
    const fake = flakyRepository(repository, { failTimes: 2 })
    configureSessionStateService({ repository: fake, mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }, phase: 'authoritative' })
    const target = {
      sessions: { 'boom': { id: 'boom', scope: 'global', stateVersion: 1, messages: [], title: 'Boom' } },
      sessionsMetadata: {},
    }
    await expect(restoreSessionStateSnapshot(target, { mode: 'replace', repository: fake, planFile }))
      .rejects.toThrow('compensation failed')
    const plan = JSON.parse(await readFile(planFile, 'utf8'))
    expect(plan.status).toBe('compensation_failed')

    // Recovery must roll back to the before state and clean the plan.
    configureSessionStateService({ repository, mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }, phase: 'authoritative' })
    const recovered = await recoverSessionStateRestorePlan({ repository, planFile })
    expect(recovered).toBe(true)
    await expect(access(planFile)).rejects.toMatchObject({ code: 'ENOENT' })
    const after = snapshotValuesFromRepository(repository)
    expect(after.count).toBe(before.count)
    expect(after.digest).toBe(before.digest)
    expect(repository.findBySessionId('one')).not.toBeNull()
  })

  it('recovers an applying plan left behind by a crash', async () => {
    const planFile = path.join(directory, 'session-state-restore-plan.json')
    const before = repository.exportSnapshot()
    const target = {
      sessions: { 'forward': { id: 'forward', scope: 'global', stateVersion: 1, messages: [], title: 'Forward' } },
      sessionsMetadata: {},
    }
    const targetRecords = normalizeSessionSnapshotValues(target)
    const targetValues = {
      sessions: Object.fromEntries(targetRecords.map((record) => [record.sessionId, record.state])),
      sessionsMetadata: Object.fromEntries(targetRecords.map((record) => [record.sessionId, record.metadata])),
    }
    const plan = {
      version: 1,
      operation: 'session_state_restore',
      status: 'applying',
      createdAt: new Date().toISOString(),
      before: {
        sessions: Object.fromEntries(before.records.map((record) => [record.sessionId, record.state])),
        sessionsMetadata: Object.fromEntries(before.records.map((record) => [record.sessionId, record.metadata])),
      },
      target: targetValues,
      beforeCount: before.count,
      beforeDigest: before.digest,
      targetCount: targetRecords.length,
      targetDigest: computeSessionSnapshotDigest(targetValues),
    }
    await writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    const recovered = await recoverSessionStateRestorePlan({ repository, planFile })
    expect(recovered).toBe(true)
    expect(repository.count()).toBe(1)
    expect(repository.findBySessionId('forward')).not.toBeNull()
    await expect(access(planFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restore never touches scheduled_task_runs', async () => {
    const runsRepository = createScheduledTaskRunsRepository(storage)
    runsRepository.create('task-a', { id: 'run-1', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' })
    const target = {
      sessions: { 'fresh': { id: 'fresh', scope: 'global', stateVersion: 1, messages: [], title: 'Fresh' } },
      sessionsMetadata: {},
    }
    await restoreSessionStateSnapshot(target, { mode: 'replace' })
    const listed = runsRepository.list({ taskIds: ['task-a'], page: 1, pageSize: 10 })
    expect(listed.total).toBe(1)
    expect(listed.runs[0]).toMatchObject({ id: 'run-1', status: 'success' })
  })

  it('holds the maintenance lock during restore and releases it afterwards', async () => {
    const { isSessionStateMaintenanceActive } = await import('../../server/session-state-cutover.mjs')
    expect(isSessionStateMaintenanceActive(storage)).toBe(false)
    const target = {
      sessions: { 'fresh': { id: 'fresh', scope: 'global', stateVersion: 1, messages: [], title: 'Fresh' } },
      sessionsMetadata: {},
    }
    await restoreSessionStateSnapshot(target, { mode: 'replace' })
    expect(isSessionStateMaintenanceActive(storage)).toBe(false)
  })

  it('exportSnapshot reflects authoritative state after restore', async () => {
    const target = {
      sessions: { 'only': { id: 'only', scope: 'global', stateVersion: 1, messages: [], title: 'Only' } },
      sessionsMetadata: {},
    }
    await restoreSessionStateSnapshot(target, { mode: 'replace' })
    const snapshot = exportSessionStateSnapshot()
    expect(snapshot.count).toBe(1)
    expect(Object.keys(snapshot.sessions)).toEqual(['only'])
    expect(readSessionStorageState().phase).toBe('authoritative')
  })

  it('checkpoints the WAL after a successful restore, without failing the restore when the checkpoint fails', async () => {
    const target = {
      sessions: { 'fresh': { id: 'fresh', scope: 'global', stateVersion: 1, messages: [], title: 'Fresh' } },
      sessionsMetadata: {},
    }
    const spied = { ...repository, checkpointWal: vi.fn(() => repository.checkpointWal()) }
    await restoreSessionStateSnapshot(target, { mode: 'replace', repository: spied })
    expect(spied.checkpointWal).toHaveBeenCalledTimes(1)
    expect(repository.findBySessionId('fresh')).not.toBeNull()

    // A busy/failed checkpoint is best-effort: the restore still succeeds.
    const failing = { ...repository, checkpointWal: vi.fn(() => { throw new Error('checkpoint busy') }) }
    const second = await restoreSessionStateSnapshot(target, { mode: 'replace', repository: failing })
    expect(second).toEqual({ sessions: 1, sessionsMetadata: 1 })
    expect(failing.checkpointWal).toHaveBeenCalledTimes(1)
    expect(repository.findBySessionId('fresh')).not.toBeNull()
  })

  it('checkpoints the WAL after a successful restore plan roll-forward', async () => {
    const planFile = path.join(directory, 'session-state-restore-plan.json')
    const before = repository.exportSnapshot()
    const target = {
      sessions: { 'forward': { id: 'forward', scope: 'global', stateVersion: 1, messages: [], title: 'Forward' } },
      sessionsMetadata: {},
    }
    const targetRecords = normalizeSessionSnapshotValues(target)
    const targetValues = {
      sessions: Object.fromEntries(targetRecords.map((record) => [record.sessionId, record.state])),
      sessionsMetadata: Object.fromEntries(targetRecords.map((record) => [record.sessionId, record.metadata])),
    }
    const plan = {
      version: 1,
      operation: 'session_state_restore',
      status: 'applying',
      createdAt: new Date().toISOString(),
      before: {
        sessions: Object.fromEntries(before.records.map((record) => [record.sessionId, record.state])),
        sessionsMetadata: Object.fromEntries(before.records.map((record) => [record.sessionId, record.metadata])),
      },
      target: targetValues,
      beforeCount: before.count,
      beforeDigest: before.digest,
      targetCount: targetRecords.length,
      targetDigest: computeSessionSnapshotDigest(targetValues),
    }
    await writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    const spied = { ...repository, checkpointWal: vi.fn(() => repository.checkpointWal()) }
    const recovered = await recoverSessionStateRestorePlan({ repository: spied, planFile })
    expect(recovered).toBe(true)
    expect(spied.checkpointWal).toHaveBeenCalledTimes(1)
    expect(repository.findBySessionId('forward')).not.toBeNull()
    await expect(access(planFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
