import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { initializeScheduledRunsCutover, splitScheduledTasksRuns } from '../../server/scheduled-runs-cutover.mjs'
import { readScheduledTasksForBackup, recoverScheduledRunsRestorePlan, restoreScheduledTasks } from '../../server/scheduled-runs-backup.mjs'

function run(id, overrides = {}) {
  return { id, status: 'success', trigger: 'manual', startedAt: '2026-01-01T00:00:00.000Z', result: id, ...overrides }
}

async function missing(file) {
  try { await access(file); return false } catch (error) { return error.code === 'ENOENT' }
}

describe('authoritative scheduled runs backup and restore', () => {
  let directory
  let storage
  let repository
  let planFile
  let metadata

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-runs-backup-'))
    planFile = path.join(directory, 'restore-plan.json')
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'quickforge.sqlite3') })
    repository = createScheduledTaskRunsRepository(storage)
    metadata = { 'task-a': { id: 'task-a', title: 'A', runs: [run('old')] } }
    await initializeScheduledRunsCutover({
      storage,
      repository,
      backupDirectory: path.join(directory, 'backups'),
      readTasks: async () => structuredClone(metadata),
      writeTasks: async (tasks) => { metadata = structuredClone(tasks) },
    })
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  const readLogical = () => readScheduledTasksForBackup({
    readTasks: async () => structuredClone(metadata),
    repository,
  })
  const writeMetadata = async (tasks) => { metadata = structuredClone(tasks) }

  it('exports version-1 compatible scheduledTasks with full SQLite runs', async () => {
    repository.upsert('task-a', run('new'), { source: 'runtime' })
    const tasks = await readLogical()
    expect(tasks['task-a'].runs.map((value) => value.id).sort()).toEqual(['new', 'old'])
    expect(metadata['task-a']).not.toHaveProperty('runs')
  })

  it('fails closed when authoritative repository export is unavailable or inconsistent', async () => {
    await expect(readScheduledTasksForBackup({
      readTasks: async () => structuredClone(metadata),
      repository: { ...repository, list: () => { throw new Error('read failed') } },
    })).rejects.toThrow('read failed')
    await expect(readScheduledTasksForBackup({
      readTasks: async () => structuredClone(metadata),
      repository: { ...repository, count: () => repository.count() + 1 },
    })).rejects.toThrow(/count\/digest verification failed/)
  })

  it('restores old v1 replace and merge targets into SQLite plus metadata-only JSON', async () => {
    const replacement = { 'task-b': { id: 'task-b', title: 'B', runs: [run('same', { legacyField: true })] } }
    await restoreScheduledTasks(replacement, { mode: 'replace', repository, readCurrent: readLogical, writeTasks: writeMetadata, planFile })
    expect(repository.get('task-a', 'old')).toBeNull()
    expect(repository.get('task-b', 'same')).toMatchObject({ legacyField: true })
    expect(metadata['task-b']).not.toHaveProperty('runs')

    await restoreScheduledTasks({ 'task-c': { id: 'task-c', title: 'C', runs: [run('same')] } }, { mode: 'merge', repository, readCurrent: readLogical, writeTasks: writeMetadata, planFile })
    expect(repository.get('task-b', 'same')).not.toBeNull()
    expect(repository.get('task-c', 'same')).not.toBeNull()
  })

  it('compensates SQLite apply failure back to the before logical state', async () => {
    const before = await readLogical()
    const fake = {
      ...repository,
      replaceAll: vi.fn()
        .mockImplementationOnce(() => { throw new Error('apply failed') })
        .mockImplementationOnce((entries, options) => repository.replaceAll(entries, options)),
    }
    await expect(restoreScheduledTasks({ 'task-x': { id: 'task-x', runs: [run('x')] } }, {
      repository: fake, readCurrent: async () => before, writeTasks: writeMetadata, planFile,
    })).rejects.toThrow('apply failed')
    expect(await readLogical()).toEqual(before)
    expect(await missing(planFile)).toBe(true)
  })

  it('compensates JSON write failure and persists a plan when compensation also fails', async () => {
    const before = await readLogical()
    const writeTasks = vi.fn()
      .mockRejectedValueOnce(new Error('json write failed'))
      .mockImplementationOnce(writeMetadata)
    await expect(restoreScheduledTasks({ 'task-x': { id: 'task-x', runs: [run('x')] } }, {
      repository, readCurrent: async () => before, writeTasks, planFile,
    })).rejects.toThrow('json write failed')
    expect(await readLogical()).toEqual(before)

    await expect(restoreScheduledTasks({ 'task-y': { id: 'task-y', runs: [run('y')] } }, {
      repository,
      readCurrent: async () => before,
      writeTasks: vi.fn(async () => { throw new Error('all writes fail') }),
      planFile,
    })).rejects.toThrow(/compensation failed/)
    expect(JSON.parse(await readFile(planFile, 'utf8'))).toMatchObject({ status: 'compensation_failed' })
  })

  it('rolls back compensating plans and rejects missing or mismatched digests', async () => {
    const before = await readLogical()
    const target = { 'task-target': { id: 'task-target', runs: [run('target')] } }
    const beforeSnapshot = splitScheduledTasksRuns(before)
    const targetSnapshot = splitScheduledTasksRuns(target)
    repository.replaceAll(targetSnapshot.entries, { source: 'restore' })
    metadata = targetSnapshot.metadata
    await writeFile(planFile, JSON.stringify({
      version: 1, operation: 'scheduled_tasks_restore', status: 'compensation_failed', before, target,
      beforeCount: beforeSnapshot.count, beforeDigest: beforeSnapshot.digest,
      targetCount: targetSnapshot.count, targetDigest: targetSnapshot.digest,
    }), 'utf8')
    await recoverScheduledRunsRestorePlan({ repository, writeTasks: writeMetadata, planFile })
    expect(await readLogical()).toEqual(before)

    await writeFile(planFile, JSON.stringify({
      version: 1, operation: 'scheduled_tasks_restore', status: 'applying', before, target,
      beforeCount: beforeSnapshot.count, beforeDigest: 'wrong',
      targetCount: targetSnapshot.count, targetDigest: targetSnapshot.digest,
    }), 'utf8')
    await expect(recoverScheduledRunsRestorePlan({ repository, writeTasks: writeMetadata, planFile })).rejects.toThrow(/digest is invalid/)
  })

  it('recovers a persisted restore plan before runtime startup', async () => {
    const target = { 'task-r': { id: 'task-r', title: 'R', runs: [run('r')] } }
    const before = await readLogical()
    const beforeSnapshot = splitScheduledTasksRuns(before)
    const targetSnapshot = splitScheduledTasksRuns(target)
    await writeFile(planFile, JSON.stringify({
      version: 1,
      operation: 'scheduled_tasks_restore',
      status: 'applying',
      before,
      target,
      beforeCount: beforeSnapshot.count,
      beforeDigest: beforeSnapshot.digest,
      targetCount: targetSnapshot.count,
      targetDigest: targetSnapshot.digest,
    }), 'utf8')
    await recoverScheduledRunsRestorePlan({ repository, writeTasks: writeMetadata, planFile })
    expect(repository.get('task-r', 'r')).not.toBeNull()
    expect(metadata['task-r']).not.toHaveProperty('runs')
    expect(await missing(planFile)).toBe(true)
  })
})
