import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { initializeScheduledRunsCutover } from '../../server/scheduled-runs-cutover.mjs'
import { readScheduledTasksForBackup } from '../../server/scheduled-runs-backup.mjs'

const directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-scheduled-runs-cutover-smoke-'))
try {
  const storage = await initializeSqliteStorage({ dataDir: directory })
  const repository = createScheduledTaskRunsRepository(storage)
  let tasks = {
    smoke: {
      id: 'smoke',
      title: 'Smoke',
      runs: [{ id: 'run', status: 'success', trigger: 'manual', startedAt: '2026-01-01T00:00:00.000Z', result: 'ok' }],
    },
  }
  const state = await initializeScheduledRunsCutover({
    storage,
    repository,
    backupDirectory: path.join(directory, 'backups'),
    readTasks: async () => structuredClone(tasks),
    writeTasks: async (value) => { tasks = structuredClone(value) },
  })
  const backupTasks = await readScheduledTasksForBackup({ readTasks: async () => structuredClone(tasks), repository })
  if (state.phase !== 'authoritative' || tasks.smoke.runs !== undefined || backupTasks.smoke.runs?.[0]?.result !== 'ok') {
    throw new Error('Scheduled runs cutover/authoritative backup smoke failed')
  }
  process.stdout.write(`${JSON.stringify({ node: process.versions.node, sqlite: process.versions.sqlite, phase: state.phase, backupRuns: backupTasks.smoke.runs.length })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
}
