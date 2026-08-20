import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { configureSessionStateService } from '../../server/session-state-service.mjs'
import { importSessionStateFromJson } from '../../server/session-state-import.mjs'
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

function sessionJson(id, overrides = {}) {
  return {
    id,
    scope: 'global',
    stateVersion: overrides.stateVersion ?? 1,
    title: overrides.title ?? `Session ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: overrides.lastModified ?? '2026-01-01T00:00:00.000Z',
    messages: overrides.messages ?? [{ role: 'user', content: 'hello' }],
  }
}

function metadataJson(session) {
  return {
    id: session.id,
    scope: 'global',
    stateVersion: session.stateVersion,
    title: session.title,
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    messageCount: session.messages.length,
  }
}

// Build a v2-authoritative data dir by running the real startup import over
// physical JSON session files (the same path server/index.mjs uses).
async function buildAuthoritativeDataDir(sessions) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-offline-'))
  const globalDir = path.join(directory, 'storage', 'conversations', 'global')
  await mkdir(path.join(globalDir, 'sessions'), { recursive: true })
  await writeFile(path.join(globalDir, 'sessions-metadata.json'), `${JSON.stringify(
    Object.fromEntries(sessions.map((session) => [session.id, metadataJson(session)])),
  )}\n`, 'utf8')
  for (const session of sessions) {
    await writeFile(path.join(globalDir, 'sessions', `${session.id}.json`), `${JSON.stringify(session)}\n`, 'utf8')
  }
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = directory
  try {
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
    // A query-string storage instance resolves dataDir from the env at ITS
    // evaluation, so the importer walks the temp dir's JSON tree — never any
    // other data dir.
    const testId = `${Date.now()}-${Math.random()}`
    const storageModule = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
    const { imported } = await importSessionStateFromJson({ storage: storageModule })
    if (imported !== sessions.length) throw new Error(`expected ${sessions.length} imported, got ${imported}`)
    await closeSqliteStorage()
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
  }
  return directory
}

describe('offline session state v1 export and downgrade (escape hatch)', () => {
  const directories = []
  afterEach(async () => {
    configureSessionStateService({ repository: null })
    await closeSqliteStorage()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('exports a complete authoritative backup without starting the server', async () => {
    const directory = await buildAuthoritativeDataDir([
      sessionJson('one'),
      sessionJson('two', { stateVersion: 2 }),
    ])
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
    const sourceDir = await buildAuthoritativeDataDir([
      sessionJson('one'),
      sessionJson('two', { stateVersion: 2 }),
    ])
    directories.push(sourceDir)
    const output = path.join(sourceDir, 'export.json')
    const exported = await spawnTool(exportScript, sourceDir, [output])
    expect(exported.code).toBe(0)
    const backup = JSON.parse(await readFile(output, 'utf8'))

    const targetDir = await mkdtemp(path.join(os.tmpdir(), 'qf-session-offline-roundtrip-'))
    directories.push(targetDir)
    const storage = await initializeSqliteStorage({ dataDir: targetDir })
    const repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
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

  it('reports a dry-run downgrade without writing any JSON', async () => {
    const directory = await buildAuthoritativeDataDir([sessionJson('one'), sessionJson('two')])
    directories.push(directory)
    // No JSON mirror files exist yet (the import does not write back); a
    // dry-run must leave it that way.
    const sessionsDir = path.join(directory, 'storage', 'conversations', 'global', 'sessions')
    await rm(sessionsDir, { recursive: true, force: true })

    const result = await spawnTool(downgradeScript, directory, ['--dry-run'])
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: true, count: 2 })
    expect(report.message).toContain('escape hatch')
    expect(await exists(path.join(sessionsDir, 'one.json'))).toBe(false)
  })

  it('materializes the v1 JSON layout from the authoritative snapshot', async () => {
    const directory = await buildAuthoritativeDataDir([sessionJson('one'), sessionJson('two', { stateVersion: 2 })])
    directories.push(directory)
    const sessionsDir = path.join(directory, 'storage', 'conversations', 'global', 'sessions')
    await rm(sessionsDir, { recursive: true, force: true })
    // A stale body file that no longer exists in the store must be removed.
    await mkdir(sessionsDir, { recursive: true })
    await writeFile(path.join(sessionsDir, 'stale.json'), '{}\n', 'utf8')

    const materialized = await spawnTool(downgradeScript, directory)
    expect(materialized.code).toBe(0)
    const report = JSON.parse(materialized.stdout.trim())
    expect(report).toMatchObject({ ok: true, dryRun: false, count: 2, materialized: 2 })

    const one = JSON.parse(await readFile(path.join(sessionsDir, 'one.json'), 'utf8'))
    expect(one).toMatchObject({ id: 'one', title: 'Session one' })
    expect(one.messages).toHaveLength(1)
    const metadata = JSON.parse(await readFile(path.join(directory, 'storage', 'conversations', 'global', 'sessions-metadata.json'), 'utf8'))
    expect(metadata.two).toMatchObject({ id: 'two', messageCount: 1 })
    expect(await exists(path.join(sessionsDir, 'stale.json'))).toBe(false)

    // SQLite stays authoritative: reopening the store keeps the data intact.
    const storage = await initializeSqliteStorage({ dataDir: directory })
    const repository = createSessionStateRepository(storage)
    expect(repository.count()).toBe(2)
    await closeSqliteStorage()
  })

  it('materializes a split session into a complete v1 JSON body', async () => {
    const bigMessages = []
    for (let index = 0; index < 205; index += 1) {
      bigMessages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z` })
    }
    const directory = await buildAuthoritativeDataDir([sessionJson('big', { title: 'Big', messages: bigMessages })])
    directories.push(directory)
    const bigJson = path.join(directory, 'storage', 'conversations', 'global', 'sessions', 'big.json')
    await rm(bigJson, { force: true })

    const dryRun = await spawnTool(downgradeScript, directory, ['--dry-run'])
    expect(dryRun.code).toBe(0)
    expect(await exists(bigJson)).toBe(false)

    const materialized = await spawnTool(downgradeScript, directory)
    expect(materialized.code).toBe(0)
    const materializedJson = JSON.parse(await readFile(bigJson, 'utf8'))
    expect(materializedJson.messageStorage).toBe('split')
    expect(Array.isArray(materializedJson.messages) && materializedJson.messages).toHaveLength(205)
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
