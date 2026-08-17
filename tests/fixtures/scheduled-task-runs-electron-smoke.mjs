import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-scheduled-runs-smoke-'))
try {
  const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })
  const repository = createScheduledTaskRunsRepository(storage)
  const created = repository.create('smoke-task', {
    id: 'smoke-run',
    status: 'success',
    trigger: 'manual',
    startedAt: '2026-08-17T00:00:00.000Z',
    agentId: null,
    agentLabel: null,
    agentSnapshot: { unknown: 'preserved' },
  })
  const listed = repository.list({ taskId: 'smoke-task' })
  if (storage.health().schemaVersion !== 9 || created.id !== 'smoke-run' || listed.total !== 1) {
    throw new Error('Scheduled task runs Electron smoke verification failed')
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, sqlite: process.versions.sqlite },
    schemaVersion: storage.health().schemaVersion,
    count: listed.total,
  })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
