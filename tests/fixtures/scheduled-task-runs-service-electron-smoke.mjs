import { rm, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { createScheduledTaskRunsService } from '../../server/scheduled-task-runs-service.mjs'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-scheduled-runs-service-smoke-'))
try {
  const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })
  const repository = createScheduledTaskRunsRepository(storage)
  const tasks = [{
    id: 'smoke-task',
    title: 'Smoke Task',
    scheduleRule: 'manual',
    projectName: null,
    runs: [{
      id: 'smoke-run',
      status: 'running',
      trigger: 'manual',
      inputContent: 'smoke input',
      startedAt: '2026-01-01T00:00:00.000Z',
    }],
  }]
  const service = createScheduledTaskRunsService({
    readTasks: async () => tasks,
    getRepository: () => repository,
    isAuthoritative: () => true,
    logger: { warn() {} },
  })

  await service.syncRun('smoke-task', tasks[0].runs[0], { phase: 'created' })
  tasks[0].runs[0] = {
    ...tasks[0].runs[0],
    status: 'success',
    result: 'smoke result',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
  }
  await service.syncRun('smoke-task', tasks[0].runs[0], { phase: 'terminal' })
  const listed = await service.listRuns({ keyword: 'Smoke Task' })
  if (listed.total !== 1 || listed.runs[0]?.result !== 'smoke result') {
    throw new Error('Scheduled task runs service smoke failed')
  }
  process.stdout.write(`${JSON.stringify({
    node: process.versions.node,
    sqlite: process.versions.sqlite,
    status: listed.runs[0].status,
    diagnostics: service.getDiagnostics(),
  })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
