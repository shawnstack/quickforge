import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'
import { configureShareService, readShareStorageState, setShareStoragePhase, SHARE_STORAGE_PHASES } from '../../server/share-service.mjs'
import { initializeShareCutover } from '../../server/share-cutover.mjs'
import { restoreShareStateSnapshot } from '../../server/share-backup.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const exportScript = path.join(projectRoot, 'server', 'maintenance', 'export-share-v1.mjs')
const downgradeScript = path.join(projectRoot, 'server', 'maintenance', 'downgrade-share-v1.mjs')

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
    allowCloudUsage: false,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: overrides.tokens === undefined ? [] : overrides.tokens,
    ...overrides,
  }
}

function sharesStore(...records) {
  return Object.fromEntries(records.map((entry) => [entry.id, entry]))
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

// Mirror adapter that materializes the canonical records into the temp data
// dir's conversation-shares.json (the same path the offline tools use), so the
// authoritative setup never touches the real ~/.quickforge JSON files.
function tempShareMirror(directory) {
  const file = path.join(directory, 'storage', 'shares', 'conversation-shares.json')
  return {
    async upsert(record) {
      await mkdir(path.dirname(file), { recursive: true })
      const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
      data[record.id] = record
      await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    },
    async delete(shareId) {
      const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
      delete data[shareId]
      await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    },
  }
}

async function buildAuthoritativeShareDataDir(seedRecords = [record(), record({ sessionId: 'session-two', titleSnapshot: 'Two' })]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-'))
  const storage = await initializeSqliteStorage({ dataDir: directory })
  const repository = createShareRepository(storage)
  configureShareService({ repository, mirror: null, phase: 'json_authoritative' })
  const state = await initializeShareCutover({
    storage,
    repository,
    backupDirectory: path.join(directory, 'storage', 'backups'),
    readJson: vi.fn(async () => structuredClone(sharesStore(...seedRecords))),
    mirror: tempShareMirror(directory),
    owner: { id: '600:test', pid: 600 },
    pidAlive: () => false,
  })
  await closeSqliteStorage()
  if (state.phase !== 'authoritative') throw new Error(`expected authoritative, got ${state.phase}`)
  return directory
}

describe('offline share v1 export and downgrade', () => {
  const directories = []
  afterEach(async () => {
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete authoritative backup without starting the server', async () => {
    const withToken = record({
      sessionId: 'token-session',
      titleSnapshot: 'With token',
      tokens: [{ tokenHash: 'token-hash-1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 }],
    })
    const directory = await buildAuthoritativeShareDataDir([record({ sessionId: 'seed', titleSnapshot: 'Seed' }), withToken])
    directories.push(directory)
    const output = path.join(directory, 'export.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1, scope: 'shares', includeSecrets: false })
    expect(backup.shareState).toMatchObject({ phase: 'authoritative', count: 2 })
    expect(Object.keys(backup.data.shares)).toHaveLength(2)
    expect(backup.data.shares[withToken.id].id).toBe(withToken.id)
    expect(backup.data.shares[withToken.id].tokens).toEqual([
      { tokenHash: 'token-hash-1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', authVersion: 1 },
    ])
    expect(backup.data.shares[withToken.id]).not.toHaveProperty('revision')
  })

  it('restores the exported backup into a fresh authoritative data dir (roundtrip)', async () => {
    const sourceDir = await buildAuthoritativeShareDataDir()
    directories.push(sourceDir)
    const output = path.join(sourceDir, 'export.json')
    const exported = await spawnTool(exportScript, sourceDir, [output])
    expect(exported.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))

    const targetDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-roundtrip-'))
    directories.push(targetDir)
    const storage = await initializeSqliteStorage({ dataDir: targetDir })
    const repository = createShareRepository(storage)
    configureShareService({ repository, mirror: null, phase: 'json_authoritative' })
    const state = await initializeShareCutover({
      storage,
      repository,
      backupDirectory: path.join(targetDir, 'storage', 'backups'),
      readJson: vi.fn(async () => structuredClone({})),
      mirror: tempShareMirror(targetDir),
      owner: { id: '601:test', pid: 601 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')
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

  it('refuses export in json_authoritative and cutover_running phases', async () => {
    const jsonDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-json-'))
    directories.push(jsonDir)
    await initializeSqliteStorage({ dataDir: jsonDir })
    await closeSqliteStorage()
    const refused = await spawnTool(exportScript, jsonDir, [path.join(jsonDir, 'refused.json')])
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toMatch(/authoritative export requires/)
    expect(await exists(path.join(jsonDir, 'refused.json'))).toBe(false)

    const runningDir = await mkdtemp(path.join(os.tmpdir(), 'qf-share-offline-running-'))
    directories.push(runningDir)
    const storage = await initializeSqliteStorage({ dataDir: runningDir })
    setShareStoragePhase(SHARE_STORAGE_PHASES.CUTOVER_RUNNING, { diagnostic: { operation: 'test' } })
    await closeSqliteStorage()
    const running = await spawnTool(exportScript, runningDir, [path.join(runningDir, 'running.json')])
    expect(running.code).not.toBe(0)
    expect(running.stderr).toMatch(/cutover is still running/)
    expect(await exists(path.join(runningDir, 'running.json'))).toBe(false)
  })

  it('reports a dry-run downgrade without writing JSON or changing the phase', async () => {
    const directory = await buildAuthoritativeShareDataDir()
    directories.push(directory)
    const sharesFile = path.join(directory, 'storage', 'shares', 'conversation-shares.json')
    // Remove the on-disk JSON store so a write would be visible.
    await rm(sharesFile, { force: true })

    const result = await spawnTool(downgradeScript, directory, ['--dry-run'])
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: true, count: 2, phase: 'authoritative' })
    expect(await exists(sharesFile)).toBe(false)

    const storage = await initializeSqliteStorage({ dataDir: directory })
    expect(readShareStorageState().phase).toBe('authoritative')
    await closeSqliteStorage()
  })

  it('materializes the JSON mirror and --commit flips authority back to JSON', async () => {
    const directory = await buildAuthoritativeShareDataDir()
    directories.push(directory)
    const sharesFile = path.join(directory, 'storage', 'shares', 'conversation-shares.json')
    // Create a pending mirror entry by writing through the repository without draining.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createShareRepository(storage)
    configureShareService({ repository, mirror: null, phase: 'authoritative' })
    repository.create(record({ id: shareId(), sessionId: 'pending-session', titleSnapshot: 'Pending' }))
    expect(repository.listMirrorQueue().length).toBeGreaterThan(0)
    await closeSqliteStorage()

    const materialized = await spawnTool(downgradeScript, directory)
    expect(materialized.code).toBe(0)
    const report = JSON.parse(materialized.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: false, commit: false, count: 3, phase: 'authoritative' })
    // After materialization the JSON mirror is readable and matches SQLite.
    const json = JSON.parse(await readFile(sharesFile, 'utf8'))
    expect(Object.keys(json).length).toBe(3)
    expect(Object.values(json).every((entry) => entry && typeof entry.id === 'string')).toBe(true)

    const committed = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(committed.code).toBe(0)
    const committedReport = JSON.parse(committed.stdout.trim())
    expect(committedReport).toMatchObject({ ok: true, phase: 'json_authoritative', phaseChanged: true })

    const reopened = await initializeSqliteStorage({ dataDir: directory })
    expect(readShareStorageState().phase).toBe('json_authoritative')
    await closeSqliteStorage()
  })

  it('refuses downgrade when the JSON mirror does not match the authoritative snapshot', async () => {
    const directory = await buildAuthoritativeShareDataDir()
    directories.push(directory)
    const sharesFile = path.join(directory, 'storage', 'shares', 'conversation-shares.json')
    // Corrupt one record (no pending mirror entry) so the verification fails.
    const stale = JSON.parse(await readFile(sharesFile, 'utf8'))
    const firstId = Object.keys(stale)[0]
    stale[firstId] = { ...stale[firstId], titleSnapshot: 'Corrupted' }
    await writeFile(sharesFile, `${JSON.stringify(stale, null, 2)}\n`, 'utf8')

    const result = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/mirror verification failed/)
    const storage = await initializeSqliteStorage({ dataDir: directory })
    expect(readShareStorageState().phase).toBe('authoritative')
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
