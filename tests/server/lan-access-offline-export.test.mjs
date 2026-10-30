import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createLanAccessRepository } from '../../server/sqlite/lan-access-repository.mjs'
import { restoreLanAccessStateSnapshot } from '../../server/lan-access-backup.mjs'

// Offline lan-access escape hatch: export-lan-access-v1.mjs must produce a
// shutdown-time v1 export from the authoritative SQLite store (token hashes
// only, no repository revision, count/digest fail closed, maintenance lock held)
// and the exported envelope must round-trip through the restore path.
const projectRoot = path.resolve(import.meta.dirname, '../..')
const exportScript = path.join(projectRoot, 'server', 'maintenance', 'export-lan-access-v1.mjs')

async function buildLanAccessDataDir({ seedToken = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-'))
  const storage = await initializeSqliteStorage({ dataDir: directory })
  const repository = createLanAccessRepository(storage)
  if (seedToken) {
    repository.updateSettings({
      enabled: true,
      passwordHash: 'b2ZmbGluZS1oYXNo',
      passwordSalt: 'b2ZmbGluZS1zYWx0',
      passwordVersion: 1,
      sessionTtlHours: 12,
    })
    repository.issueToken({ remoteAddress: '192.168.1.60', userAgent: 'Offline Export' })
  }
  await closeSqliteStorage()
  return directory
}

function spawnTool(script, dataDir, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
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

describe('offline lan-access v1 export', () => {
  const directories = []
  afterEach(async () => {
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete backup from a closed database without starting the server', async () => {
    const directory = await buildLanAccessDataDir({ seedToken: true })
    directories.push(directory)
    const output = path.join(directory, 'export.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1, scope: 'lan-access', includeSecrets: false })
    expect(backup.lanAccessState).toMatchObject({ count: 1 })
    expect(backup.lanAccessState.digest).toBeTruthy()
    expect(backup.lanAccessState).not.toHaveProperty('phase')
    expect(backup.data.lanAccess.enabled).toBe(true)
    expect(backup.data.lanAccess.tokens).toHaveLength(1)
    expect(backup.data.lanAccess.tokens[0].tokenHash).toBeTruthy()
    expect(backup.data.lanAccess.tokens[0]).toMatchObject({ remoteAddress: '192.168.1.60', userAgent: 'Offline Export' })
    expect(backup.data.lanAccess).not.toHaveProperty('revision')
  })

  it('restores the exported backup into a fresh data dir (roundtrip)', async () => {
    const sourceDir = await buildLanAccessDataDir({ seedToken: true })
    directories.push(sourceDir)
    const output = path.join(sourceDir, 'export.json')
    const exported = await spawnTool(exportScript, sourceDir, [output])
    expect(exported.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))

    const targetDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-roundtrip-'))
    directories.push(targetDir)
    const storage = await initializeSqliteStorage({ dataDir: targetDir })
    const repository = createLanAccessRepository(storage)
    expect(repository.getConfig()).toBeNull()

    const restored = await restoreLanAccessStateSnapshot({ lanAccess: backup.data.lanAccess }, {
      mode: 'replace',
      planFile: path.join(targetDir, 'lan-access-restore-plan.json'),
      repository,
      storage,
    })
    expect(restored).toEqual({ lanAccess: 1 })
    expect(repository.digest()).toBe(backup.lanAccessState.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    await closeSqliteStorage()
  })

  it('fails closed without partial output when the authoritative state is damaged', async () => {
    const directory = await buildLanAccessDataDir({ seedToken: true })
    directories.push(directory)
    // Orphan token rows (no config row) make verifyIntegrity fail closed.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    storage.prepare('DELETE FROM lan_access_state').run()
    await closeSqliteStorage()

    const output = path.join(directory, 'damaged.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/integrity verification failed/)
    expect(await exists(output)).toBe(false)
  })

  it('fails cleanly without partial output when quick_check/open fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-fail-'))
    directories.push(directory)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(directory, 'storage'), 'not-a-directory', 'utf8')
    const output = path.join(directory, 'failed.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).not.toBe(0)
    expect(await exists(output)).toBe(false)
  })
})
