import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createLanAccessRepository } from '../../server/sqlite/lan-access-repository.mjs'
import { configureLanAccessService, drainLanAccessJsonMirror, readLanAccessStorageState, setLanAccessStoragePhase, LAN_ACCESS_STORAGE_PHASES } from '../../server/lan-access-service.mjs'
import { initializeLanAccessCutover } from '../../server/lan-access-cutover.mjs'
import { restoreLanAccessStateSnapshot } from '../../server/lan-access-backup.mjs'
import { defaultLanAccessConfig } from '../../server/lan-access-json-file.mjs'

// F11 Phase 3 offline tools: export-lan-access-v1.mjs must produce a
// shutdown-time authoritative v1 export (token hashes only, no revision,
// count/digest fail closed) and downgrade-lan-access-v1.mjs must support
// --dry-run (zero writes), default materialization of the whole JSON mirror and
// --commit phase flips, with exact digest comparison and no partial output.
const projectRoot = path.resolve(import.meta.dirname, '../..')
const exportScript = path.join(projectRoot, 'server', 'maintenance', 'export-lan-access-v1.mjs')
const downgradeScript = path.join(projectRoot, 'server', 'maintenance', 'downgrade-lan-access-v1.mjs')

function lanAccessFile(directory) {
  return path.join(directory, 'storage', 'security', 'lan-access.json')
}

// Mirror adapter that materializes the canonical config into the temp data
// dir's security/lan-access.json (the same path the offline tools use), so the
// authoritative setup never touches the real ~/.quickforge JSON files.
function tempLanAccessMirror(directory) {
  const file = lanAccessFile(directory)
  return {
    async upsert(config) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    },
    async delete() {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify(defaultLanAccessConfig(), null, 2)}\n`, 'utf8')
    },
  }
}

// Stable JSON source for the cutover: defaultLanAccessConfig() stamps updatedAt
// at call time, which would change the snapshot digest between the cutover
// double reads. A fixed updatedAt keeps the double-snapshot check stable.
function stableDefaultLanAccessConfig() {
  return { ...defaultLanAccessConfig(), updatedAt: '2026-01-01T00:00:00.000Z' }
}

async function buildAuthoritativeLanAccessDataDir({ seedToken = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-'))
  const storage = await initializeSqliteStorage({ dataDir: directory })
  const repository = createLanAccessRepository(storage)
  configureLanAccessService({ repository, mirror: null, phase: 'json_authoritative' })
  const state = await initializeLanAccessCutover({
    storage,
    repository,
    backupDirectory: path.join(directory, 'storage', 'backups'),
    // Explicit JSON source so the parent test process never touches the real
    // ~/.quickforge data dir (storageDir is fixed at import time).
    readJson: vi.fn(async () => structuredClone(stableDefaultLanAccessConfig())),
    mirror: tempLanAccessMirror(directory),
    owner: { id: '800:test', pid: 800 },
    pidAlive: () => false,
  })
  if (state.phase !== 'authoritative') {
    const diagnostic = readLanAccessStorageState().diagnostic
    throw new Error(`expected authoritative, got ${state.phase}; diagnostic=${JSON.stringify(diagnostic)}`)
  }
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

describe('offline lan-access v1 export and downgrade', () => {
  const directories = []
  afterEach(async () => {
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete authoritative backup without starting the server', async () => {
    const directory = await buildAuthoritativeLanAccessDataDir({ seedToken: true })
    directories.push(directory)
    const output = path.join(directory, 'export.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1, scope: 'lan-access', includeSecrets: false })
    expect(backup.lanAccessState).toMatchObject({ phase: 'authoritative', count: 1 })
    expect(backup.data.lanAccess.enabled).toBe(true)
    expect(backup.data.lanAccess.tokens).toHaveLength(1)
    expect(backup.data.lanAccess.tokens[0].tokenHash).toBeTruthy()
    expect(backup.data.lanAccess.tokens[0]).toMatchObject({ remoteAddress: '192.168.1.60', userAgent: 'Offline Export' })
    expect(backup.data.lanAccess).not.toHaveProperty('revision')
  })

  it('restores the exported backup into a fresh authoritative data dir (roundtrip)', async () => {
    const sourceDir = await buildAuthoritativeLanAccessDataDir({ seedToken: true })
    directories.push(sourceDir)
    const output = path.join(sourceDir, 'export.json')
    const exported = await spawnTool(exportScript, sourceDir, [output])
    expect(exported.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))

    const targetDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-roundtrip-'))
    directories.push(targetDir)
    const storage = await initializeSqliteStorage({ dataDir: targetDir })
    const repository = createLanAccessRepository(storage)
    configureLanAccessService({ repository, mirror: null, phase: 'json_authoritative' })
    const state = await initializeLanAccessCutover({
      storage,
      repository,
      backupDirectory: path.join(targetDir, 'storage', 'backups'),
      readJson: vi.fn(async () => structuredClone(stableDefaultLanAccessConfig())),
      mirror: tempLanAccessMirror(targetDir),
      owner: { id: '801:test', pid: 801 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')
    expect(repository.getConfig().tokens).toHaveLength(0)

    const restored = await restoreLanAccessStateSnapshot({ lanAccess: backup.data.lanAccess }, {
      mode: 'replace',
      planFile: path.join(targetDir, 'lan-access-restore-plan.json'),
    })
    expect(restored).toEqual({ lanAccess: 1 })
    expect(repository.digest()).toBe(backup.lanAccessState.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    await closeSqliteStorage()
  })

  it('refuses export in json_authoritative and cutover_running phases', async () => {
    const jsonDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-json-'))
    directories.push(jsonDir)
    await initializeSqliteStorage({ dataDir: jsonDir })
    await closeSqliteStorage()
    const refused = await spawnTool(exportScript, jsonDir, [path.join(jsonDir, 'refused.json')])
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toMatch(/authoritative export requires/)
    expect(await exists(path.join(jsonDir, 'refused.json'))).toBe(false)

    const runningDir = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-running-'))
    directories.push(runningDir)
    const storage = await initializeSqliteStorage({ dataDir: runningDir })
    setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.CUTOVER_RUNNING, { diagnostic: { operation: 'test' } })
    await closeSqliteStorage()
    const running = await spawnTool(exportScript, runningDir, [path.join(runningDir, 'running.json')])
    expect(running.code).not.toBe(0)
    expect(running.stderr).toMatch(/cutover is still running/)
    expect(await exists(path.join(runningDir, 'running.json'))).toBe(false)
  })

  it('reports a dry-run downgrade without writing JSON or changing the phase', async () => {
    const directory = await buildAuthoritativeLanAccessDataDir({ seedToken: true })
    directories.push(directory)
    const file = lanAccessFile(directory)
    // Remove the on-disk JSON mirror so a write would be visible.
    await rm(file, { force: true })

    const result = await spawnTool(downgradeScript, directory, ['--dry-run'])
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: true, count: 1, phase: 'authoritative' })
    expect(await exists(file)).toBe(false)

    const storage = await initializeSqliteStorage({ dataDir: directory })
    expect(readLanAccessStorageState().phase).toBe('authoritative')
    await closeSqliteStorage()
  })

  it('materializes the JSON mirror and --commit flips authority back to JSON', async () => {
    const directory = await buildAuthoritativeLanAccessDataDir()
    directories.push(directory)
    // Create a pending mirror entry by writing through the repository without
    // draining so the offline downgrade tool has something to materialize.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createLanAccessRepository(storage)
    configureLanAccessService({ repository, mirror: null, phase: 'authoritative' })
    repository.updateSettings({
      enabled: true,
      passwordHash: 'bWF0ZXJpYWxpemUtaGFzaA==',
      passwordSalt: 'bWF0ZXJpYWxpemUtc2FsdA==',
      passwordVersion: 1,
      sessionTtlHours: 12,
    })
    repository.issueToken({ remoteAddress: '192.168.1.61', userAgent: 'Materialize' })
    expect(repository.listMirrorQueue().length).toBeGreaterThan(0)
    await closeSqliteStorage()

    const materialized = await spawnTool(downgradeScript, directory)
    expect(materialized.code).toBe(0)
    const report = JSON.parse(materialized.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: false, commit: false, count: 1, phase: 'authoritative' })
    expect(report.materialized).toBeGreaterThan(0)
    // After materialization the JSON mirror is readable and matches SQLite.
    const json = JSON.parse(await readFile(lanAccessFile(directory), 'utf8'))
    expect(json.enabled).toBe(true)
    expect(json.tokens).toHaveLength(1)
    expect(json.tokens[0].remoteAddress).toBe('192.168.1.61')

    const committed = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(committed.code).toBe(0)
    const committedReport = JSON.parse(committed.stdout.trim())
    expect(committedReport).toMatchObject({ ok: true, phase: 'json_authoritative', phaseChanged: true })

    const reopened = await initializeSqliteStorage({ dataDir: directory })
    expect(readLanAccessStorageState().phase).toBe('json_authoritative')
    await closeSqliteStorage()
  })

  it('refuses downgrade when the JSON mirror does not match the authoritative snapshot', async () => {
    const directory = await buildAuthoritativeLanAccessDataDir({ seedToken: true })
    directories.push(directory)
    const file = lanAccessFile(directory)
    // Drain the pending mirror queue in the parent so the downgrade tool finds
    // nothing to materialize and the corrupted file is what gets verified.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createLanAccessRepository(storage)
    configureLanAccessService({ repository, mirror: tempLanAccessMirror(directory), phase: 'authoritative' })
    const drained = await drainLanAccessJsonMirror()
    if (drained.pending !== 0) throw new Error(`expected drained mirror, got pending=${drained.pending}`)
    await closeSqliteStorage()
    // Corrupt the on-disk config so verification fails.
    const stale = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, `${JSON.stringify({ ...stale, enabled: false }, null, 2)}\n`, 'utf8')

    const result = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/mirror verification failed/)
    const reopened = await initializeSqliteStorage({ dataDir: directory })
    expect(readLanAccessStorageState().phase).toBe('authoritative')
    await closeSqliteStorage()
  })

  it('fails cleanly without partial output when quick_check/open fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-lan-offline-fail-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'storage'), 'not-a-directory', 'utf8')
    const output = path.join(directory, 'failed.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).not.toBe(0)
    expect(await exists(output)).toBe(false)
  })
})
