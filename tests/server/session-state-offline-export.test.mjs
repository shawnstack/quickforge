import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  configureSessionStateService,
  readSessionStorageState,
  saveSessionBody,
} from '../../server/session-state-service.mjs'
import { initializeSessionStateCutover } from '../../server/session-state-cutover.mjs'
import { restoreSessionStateSnapshot } from '../../server/session-state-backup.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const exportScript = path.join(projectRoot, 'server', 'maintenance', 'export-session-state-v1.mjs')
const downgradeScript = path.join(projectRoot, 'server', 'maintenance', 'downgrade-session-state-v1.mjs')

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

// Mirror adapter that materializes into the temp data dir, so the authoritative
// setup never touches the real ~/.quickforge JSON files.
function tempMirror(directory) {
  const globalDir = path.join(directory, 'storage', 'conversations', 'global')
  return {
    async upsert(entry) {
      if (entry.operation !== 'upsert') return
      await mkdir(path.join(globalDir, 'sessions'), { recursive: true })
      await writeFile(path.join(globalDir, 'sessions', `${entry.sessionId}.json`), `${JSON.stringify(entry.state)}\n`, 'utf8')
      const file = path.join(globalDir, 'sessions-metadata.json')
      const metadata = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
      metadata[entry.sessionId] = entry.metadata
      await writeFile(file, `${JSON.stringify(metadata)}\n`, 'utf8')
    },
    async delete(entry) {
      await rm(path.join(globalDir, 'sessions', `${entry.sessionId}.json`), { force: true })
      const file = path.join(globalDir, 'sessions-metadata.json')
      const metadata = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
      delete metadata[entry.sessionId]
      await writeFile(file, `${JSON.stringify(metadata)}\n`, 'utf8')
    },
  }
}

function seedBuckets(sessions) {
  return [{
    scope: 'global',
    projectId: null,
    sessions: Object.fromEntries(Object.entries(sessions).map(([id, state]) => [id, state])),
    metadata: Object.fromEntries(Object.entries(sessions).map(([id, state]) => [id, {
      id,
      scope: 'global',
      stateVersion: state.stateVersion ?? 1,
      title: state.title || 'Session',
      createdAt: state.createdAt || '2026-01-01T00:00:00.000Z',
      lastModified: state.lastModified || '2026-01-01T00:00:00.000Z',
      messageCount: Array.isArray(state.messages) ? state.messages.length : 0,
      thinkingLevel: 'off',
      taskStatus: 'idle',
      taskStartedAt: null,
      taskFinishedAt: null,
    }])),
  }]
}

async function buildAuthoritativeDataDir(sessions = {
  'one': { id: 'one', scope: 'global', stateVersion: 1, title: 'One', messages: [{ role: 'user', content: 'hello' }] },
  'two': { id: 'two', scope: 'global', stateVersion: 2, title: 'Two', messages: [] },
}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-offline-'))
  const storage = await initializeSqliteStorage({ dataDir: directory })
  const repository = createSessionStateRepository(storage)
  configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
  const state = await initializeSessionStateCutover({
    storage,
    repository,
    backupDirectory: path.join(directory, 'storage', 'backups'),
    readBuckets: vi.fn(async () => seedBuckets(sessions)),
    mirror: tempMirror(directory),
    owner: { id: '301:test', pid: 301 },
    pidAlive: () => false,
  })
  await closeSqliteStorage()
  if (state.phase !== 'authoritative') throw new Error(`expected authoritative, got ${state.phase}`)
  return directory
}

describe('offline session state v1 export and downgrade', () => {
  const directories = []
  afterEach(async () => {
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete authoritative backup without starting the server', async () => {
    const directory = await buildAuthoritativeDataDir()
    directories.push(directory)
    const output = path.join(directory, 'export.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))
    expect(backup).toMatchObject({ app: 'quickforge', version: 1, scope: 'sessions', includeSecrets: false })
    expect(backup.sessionState).toMatchObject({ phase: 'authoritative', count: 2 })
    expect(Object.keys(backup.data.sessions).sort()).toEqual(['one', 'two'])
    expect(backup.data.sessions.one.messages[0].content).toBe('hello')
  })

  it('restores the exported backup into a fresh authoritative data dir (roundtrip)', async () => {
    const sourceDir = await buildAuthoritativeDataDir()
    directories.push(sourceDir)
    const output = path.join(sourceDir, 'export.json')
    const exported = await spawnTool(exportScript, sourceDir, [output])
    expect(exported.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))

    const targetDir = await mkdtemp(path.join(os.tmpdir(), 'qf-session-offline-roundtrip-'))
    directories.push(targetDir)
    const storage = await initializeSqliteStorage({ dataDir: targetDir })
    const repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory: path.join(targetDir, 'storage', 'backups'),
      readBuckets: vi.fn(async () => seedBuckets({})),
      mirror: tempMirror(targetDir),
      owner: { id: '302:test', pid: 302 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')
    expect(repository.count()).toBe(0)

    const restored = await restoreSessionStateSnapshot(
      { sessions: backup.data.sessions, sessionsMetadata: backup.data.sessionsMetadata },
      { mode: 'replace' },
    )
    expect(restored).toEqual({ sessions: 2, sessionsMetadata: 2 })
    expect(repository.digest()).toBe(backup.sessionState.digest)
    expect(repository.findBySessionId('two').stateVersion).toBe(2)
    await closeSqliteStorage()
  })

  it('reports a dry-run downgrade without writing JSON or changing the phase', async () => {
    const directory = await buildAuthoritativeDataDir()
    directories.push(directory)
    // Remove the on-disk JSON mirror for session "two" so a write would be visible.
    await rm(path.join(directory, 'storage', 'conversations', 'global', 'sessions', 'two.json'), { force: true })

    const result = await spawnTool(downgradeScript, directory, ['--dry-run'])
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: true, count: 2, phase: 'authoritative' })
    expect(await exists(path.join(directory, 'storage', 'conversations', 'global', 'sessions', 'two.json'))).toBe(false)

    const storage = await initializeSqliteStorage({ dataDir: directory })
    expect(readSessionStorageState().phase).toBe('authoritative')
    await closeSqliteStorage()
  })

  it('materializes the JSON mirror and --commit flips authority back to JSON', async () => {
    const directory = await buildAuthoritativeDataDir()
    directories.push(directory)
    // Create a pending mirror entry by writing through the repository without draining.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: null, phase: 'authoritative' })
    repository.save({
      scope: 'global',
      sessionId: 'three',
      state: { id: 'three', scope: 'global', stateVersion: 1, messages: [], title: 'Three' },
      metadata: { id: 'three', scope: 'global', stateVersion: 1, title: 'Three' },
    }, { expectedRevision: 0 })
    expect(repository.listMirrorQueue().length).toBeGreaterThan(0)
    await closeSqliteStorage()

    const materialized = await spawnTool(downgradeScript, directory)
    expect(materialized.code).toBe(0)
    const report = JSON.parse(materialized.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: false, commit: false, count: 3, phase: 'authoritative' })
    // After materialization the JSON mirror is readable and matches SQLite.
    const json = JSON.parse(await readFile(path.join(directory, 'storage', 'conversations', 'global', 'sessions', 'three.json'), 'utf8'))
    expect(json.title).toBe('Three')

    const committed = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(committed.code).toBe(0)
    const committedReport = JSON.parse(committed.stdout.trim())
    expect(committedReport).toMatchObject({ ok: true, phase: 'json_authoritative', phaseChanged: true })

    const reopened = await initializeSqliteStorage({ dataDir: directory })
    expect(readSessionStorageState().phase).toBe('json_authoritative')
    await closeSqliteStorage()
  })

  it('refuses downgrade when the JSON mirror does not match the authoritative snapshot', async () => {
    const directory = await buildAuthoritativeDataDir()
    directories.push(directory)
    // Stale JSON with no pending mirror entry must be rejected, not silently
    // downgraded into a diverged state.
    await writeFile(
      path.join(directory, 'storage', 'conversations', 'global', 'sessions', 'one.json'),
      `${JSON.stringify({ id: 'one', scope: 'global', stateVersion: 1, title: 'Corrupted', messages: [] })}\n`,
      'utf8',
    )
    const result = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/JSON mirror verification failed/)
    const storage = await initializeSqliteStorage({ dataDir: directory })
    expect(readSessionStorageState().phase).toBe('authoritative')
    await closeSqliteStorage()
  })

  it('materializes a split session into a complete v1 JSON body on downgrade (dry-run writes nothing)', async () => {
    const directory = await buildAuthoritativeDataDir({})
    directories.push(directory)

    // Create a split session (≥ MESSAGES_SPLIT_THRESHOLD messages) after the
    // cutover; its mirror entry stays PENDING so the downgrade dry-run probe can
    // verify zero writes.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: tempMirror(directory), phase: 'authoritative' })
    const bigMessages = []
    for (let index = 0; index < 205; index += 1) {
      bigMessages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z` })
    }
    saveSessionBody('big', { messages: bigMessages, title: 'Big' })
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(205)
    await closeSqliteStorage()

    const bigJson = path.join(directory, 'storage', 'conversations', 'global', 'sessions', 'big.json')
    // dry-run: no drain, no phase change, no JSON written.
    const dryRun = await spawnTool(downgradeScript, directory, ['--dry-run'])
    expect(dryRun.code).toBe(0)
    const dryReport = JSON.parse(dryRun.stdout.trim())
    expect(dryReport).toMatchObject({ ok: true, dryRun: true, count: 1, phase: 'authoritative' })
    expect(await exists(bigJson)).toBe(false)

    // Materialize: the split session's full body (marker + messages) is written.
    const materialized = await spawnTool(downgradeScript, directory)
    expect(materialized.code).toBe(0)
    const materializedJson = JSON.parse(await readFile(bigJson, 'utf8'))
    expect(materializedJson.messageStorage).toBe('split')
    expect(Array.isArray(materializedJson.messages) && materializedJson.messages).toHaveLength(205)

    // --commit: authority flips back to JSON and the mirror is fully readable.
    const committed = await spawnTool(downgradeScript, directory, ['--commit'])
    expect(committed.code).toBe(0)
    const commitReport = JSON.parse(committed.stdout.trim())
    expect(commitReport).toMatchObject({ ok: true, phase: 'json_authoritative', phaseChanged: true })
    const reopened = await initializeSqliteStorage({ dataDir: directory })
    expect(readSessionStorageState().phase).toBe('json_authoritative')
    await closeSqliteStorage()
  })

  it('fails cleanly without partial output when quick_check/open fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-offline-fail-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'storage'), 'not-a-directory', 'utf8')
    const output = path.join(directory, 'failed.json')
    const result = await spawnTool(exportScript, directory, [output])
    expect(result.code).not.toBe(0)
    expect(await exists(output)).toBe(false)
  })
})
