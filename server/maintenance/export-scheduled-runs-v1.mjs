#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { readScheduledTasksForBackup } from '../scheduled-runs-backup.mjs'
import { readScheduledRunsState } from '../scheduled-runs-cutover.mjs'
import { dataDir } from '../storage.mjs'

function outputPath() {
  const argument = process.argv[2]
  if (argument) return path.resolve(argument)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(process.cwd(), `quickforge-scheduled-runs-${stamp}.json`)
}

const finalPath = outputPath()
const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`

try {
  const storage = await initializeSqliteStorage({ dataDir })
  storage.health({ quickCheck: true })
  const state = readScheduledRunsState(storage)
  if (state.phase === 'cutover_running') throw new Error('Scheduled runs cutover is still running; stop all QuickForge processes and retry')
  const scheduledTasks = await readScheduledTasksForBackup()
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'config',
    includeSecrets: false,
    data: { scheduledTasks },
  }
  await fs.mkdir(path.dirname(finalPath), { recursive: true })
  await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
  await fs.rename(temporaryPath, finalPath)
  process.stdout.write(`${finalPath}\n`)
} catch (error) {
  await fs.rm(temporaryPath, { force: true }).catch(() => {})
  process.stderr.write(`${error?.message || error}\n`)
  process.exitCode = 1
} finally {
  await closeSqliteStorage().catch(() => {})
}
