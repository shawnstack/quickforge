import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const serverSourceUrl = new URL('../../server/index.mjs', import.meta.url)
const acpSourceUrl = new URL('../../server/acp/server.mjs', import.meta.url)
const storageRouteSourceUrl = new URL('../../server/routes/storage.mjs', import.meta.url)
const agentManagerSourceUrl = new URL('../../server/agent-manager.mjs', import.meta.url)
const backupSourceUrl = new URL('../../server/routes/backup.mjs', import.meta.url)
const autoArchiveSourceUrl = new URL('../../server/auto-archive.mjs', import.meta.url)

describe('session index F7 lifecycle and query boundary', () => {
  it('initializes after stale task reset and before runners/listen on Server', async () => {
    const source = await readFile(serverSourceUrl, 'utf8')
    const staleReset = source.indexOf('await resetStaleTaskStatuses()')
    const configure = source.indexOf('configureSessionIndex({ readBuckets: readAuthoritativeSessionMetadataBuckets })')
    const register = source.indexOf('registerSessionMetadataCommitHook(syncSessionMetadataCommit)')
    const initialize = source.indexOf('await initializeSessionIndex()')
    const runner = source.indexOf('startScheduledTaskRunner()')
    const listen = source.indexOf('server.listen(')

    expect(configure).toBeGreaterThan(staleReset)
    expect(register).toBeGreaterThan(configure)
    expect(initialize).toBeGreaterThan(register)
    expect(runner).toBeGreaterThan(initialize)
    expect(listen).toBeGreaterThan(runner)
  })

  it('initializes after SQLite and before ACP agent creation without switching ACP listSessions', async () => {
    const source = await readFile(acpSourceUrl, 'utf8')
    const runnerStart = source.indexOf('export async function runQuickForgeAcpStdio()')
    const sqlite = source.indexOf('await sqliteModule.initializeSqliteStorage()', runnerStart)
    const initialize = source.indexOf('await sessionIndexModule.initializeSessionIndex()', runnerStart)
    const agent = source.indexOf('const quickForgeAgent = await createQuickForgeAcpAgent()', runnerStart)

    expect(initialize).toBeGreaterThan(sqlite)
    expect(agent).toBeGreaterThan(initialize)
    const listFunction = source.slice(source.indexOf('async function listPersistedAcpSessions'), source.indexOf('function ensureDefaultWorkspaceRoot'))
    expect(listFunction).toContain("readStore('sessions-metadata')")
    expect(listFunction).not.toContain('session_index')
    expect(listFunction).not.toContain('SessionIndex')
  })

  it('keeps only the storage metadata route on guarded SQL while ACP/backup/auto-archive/stale reset remain JSON', async () => {
    const [route, acp, backup, autoArchive, agentManager] = await Promise.all([
      readFile(storageRouteSourceUrl, 'utf8'),
      readFile(acpSourceUrl, 'utf8'),
      readFile(backupSourceUrl, 'utf8'),
      readFile(autoArchiveSourceUrl, 'utf8'),
      readFile(agentManagerSourceUrl, 'utf8'),
    ])
    expect(route).toContain('querySessionIndexPage')
    expect(route).toContain('readIndexedValues')
    const listFunction = acp.slice(acp.indexOf('async function listPersistedAcpSessions'), acp.indexOf('function ensureDefaultWorkspaceRoot'))
    expect(listFunction).toContain("readStore('sessions-metadata')")
    expect(listFunction).not.toContain('querySessionIndexPage')
    expect(backup).not.toContain('querySessionIndexPage')
    expect(autoArchive).not.toContain('querySessionIndexPage')
    expect(agentManager).not.toContain('querySessionIndexPage')
  })

  it('persists metadata stateVersion while backup format remains JSON-only', async () => {
    const [agentManager, backup] = await Promise.all([
      readFile(agentManagerSourceUrl, 'utf8'),
      readFile(backupSourceUrl, 'utf8'),
    ])
    expect(agentManager).toContain('stateVersion: session.stateVersion || 0')
    expect(backup).toContain('stateVersion: session.stateVersion')
    expect(backup).not.toContain('session_index')
    expect(backup).not.toContain('sessionIndex')
  })
})
