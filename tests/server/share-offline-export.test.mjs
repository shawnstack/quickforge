import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'
import { restoreShareStateSnapshot } from '../../server/share-backup.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const exportScript = path.join(projectRoot, 'server', 'maintenance', 'export-share-v1.mjs')

let sequence = 200
function shareId(prefix) {
  sequence += 1
  return `qfs_${prefix || ''}${String(sequence).padStart(18 - (prefix || '').length, '0')}`
}

function record(overrides = {}) {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id || shareId(),
    sessionId: overrides.sessionId || 'session-one',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Shared session',
    scope: overrides.scope || 'global',
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: overrides.tokens === undefined ? [] : overrides.tokens,
    ...overrides,
  }
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

// Seeded straight through the authoritative repository: there is no JSON store
// to import and no cutover to run any more.
async function buildShareDataDir(seedRecords = [record(), record({ sessionId: 'session-two', titleSnapshot: 'Two' })]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-'))
  const storage = await initializeSqliteStorage({ dataDir: directory })
  const repository = createShareRepository(storage)
  repository.replaceAll(seedRecords.map((entry) => ({ ...entry })), {})
  await closeSqliteStorage()
  return directory
}

describe('offline share v1 export', () => {
  const directories = []
  afterEach(async () => {
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete backup without starting the server', async () => {
    const withToken = record({
      sessionId: 'token-session',
      titleSnapshot: 'With token',
      tokens: [{ tokenHash: 'token-hash-1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }],
    })
    const directory = await buildShareDataDir([record({ sessionId: 'seed', titleSnapshot: 'Seed' }), withToken])
    directories.push(directory)
    const output = path.join(directory, 'export.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1, scope: 'shares', includeSecrets: false })
    expect(backup.shareState).toMatchObject({ count: 2 })
    expect(backup.shareState.digest).toBeTruthy()
    expect(backup.shareState).not.toHaveProperty('phase')
    expect(Object.keys(backup.data.shares)).toHaveLength(2)
    expect(backup.data.shares[withToken.id].id).toBe(withToken.id)
    expect(backup.data.shares[withToken.id].tokens).toEqual([
      { tokenHash: 'token-hash-1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 },
    ])
    expect(backup.data.shares[withToken.id]).not.toHaveProperty('revision')
  })

  it('restores the exported backup into a fresh data dir (roundtrip)', async () => {
    const sourceDir = await buildShareDataDir()
    directories.push(sourceDir)
    const output = path.join(sourceDir, 'export.json')
    const exported = await spawnTool(exportScript, sourceDir, [output])
    expect(exported.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))

    const targetDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-roundtrip-'))
    directories.push(targetDir)
    const storage = await initializeSqliteStorage({ dataDir: targetDir })
    const repository = createShareRepository(storage)
    expect(repository.count()).toBe(0)

    const restored = await restoreShareStateSnapshot({ shares: backup.data.shares }, {
      mode: 'replace',
      planFile: path.join(targetDir, 'share-restore-plan.json'),
    })
    expect(restored).toEqual({ shares: 2 })
    expect(repository.digest()).toBe(backup.shareState.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2 })
    await closeSqliteStorage()
  })

  it('fails cleanly without partial output when quick_check/open fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-fail-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'storage'), 'not-a-directory', 'utf8')
    const output = path.join(directory, 'failed.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).not.toBe(0)
    expect(await exists(output)).toBe(false)
  })
})
