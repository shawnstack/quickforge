import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { initializeScheduledRunsCutover } from '../../server/scheduled-runs-cutover.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const script = path.join(projectRoot, 'server', 'maintenance', 'export-scheduled-runs-v1.mjs')

function run(id) {
  return { id, status: 'success', trigger: 'manual', startedAt: '2026-01-01T00:00:00.000Z', result: id }
}

function spawnExport(dataDir, output) {
  const child = spawn(process.execPath, [script, output], {
    cwd: projectRoot,
    windowsHide: true,
    shell: false,
    env: { ...process.env, QUICKFORGE_DATA_DIR: dataDir, QUICKFORGE_LOG_LEVEL: 'ERROR', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  return new Promise((resolve) => child.once('close', (code) => resolve({ code, stdout, stderr })))
}

async function exists(file) {
  try { await access(file); return true } catch { return false }
}

describe('offline scheduled runs v1 export', () => {
  const directories = []
  afterEach(async () => {
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete backup without starting the server or runner', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-offline-export-'))
    directories.push(directory)
    await mkdir(path.join(directory, 'storage', 'conversations', 'global'), { recursive: true })
    await writeFile(path.join(directory, 'storage', 'conversations', 'global', 'scheduled-tasks.json'), `${JSON.stringify({
      'task-a': { id: 'task-a', title: 'A', runs: [run('a')] },
    })}\n`, 'utf8')
    const databasePath = path.join(directory, 'storage', 'quickforge.sqlite3')
    const storage = await initializeSqliteStorage({ databasePath })
    let metadata = { 'task-a': { id: 'task-a', title: 'A', runs: [run('a')] } }
    await initializeScheduledRunsCutover({
      storage,
      repository: createScheduledTaskRunsRepository(storage),
      backupDirectory: path.join(directory, 'storage', 'backups'),
      readTasks: async () => structuredClone(metadata),
      writeTasks: async (tasks) => {
        metadata = structuredClone(tasks)
        await writeFile(path.join(directory, 'storage', 'conversations', 'global', 'scheduled-tasks.json'), `${JSON.stringify(tasks)}\n`, 'utf8')
      },
    })
    await closeSqliteStorage()

    const output = path.join(directory, 'export.json')
    const result = await spawnExport(directory, output)
    expect(result.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1 })
    expect(backup.data.scheduledTasks['task-a'].runs).toEqual([expect.objectContaining({ id: 'a' })])
  })

  it('does not leave a partial output when quick_check/open fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-offline-export-fail-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'storage'), 'not-a-directory', 'utf8')
    const output = path.join(directory, 'failed.json')
    const result = await spawnExport(directory, output)
    expect(result.code).not.toBe(0)
    expect(await exists(output)).toBe(false)
  })
})
