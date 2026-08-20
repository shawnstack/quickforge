import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const serverSourceUrl = new URL('../../server/index.mjs', import.meta.url)
const acpSourceUrl = new URL('../../server/acp/server.mjs', import.meta.url)

describe('SQLite storage lifecycle integration', () => {
  it('initializes after JSON storage and closes during server shutdown', async () => {
    const source = await readFile(serverSourceUrl, 'utf8')
    const ensureStorage = source.indexOf('await ensureStorage()')
    const initializeSqlite = source.indexOf('await initializeSqliteStorage({ dataDir })')
    const startListening = source.indexOf('server.listen(')
    const closeHttp = source.indexOf('await closeHttpServer()')
    const closeSqlite = source.indexOf('await closeSqliteStorage()')

    expect(ensureStorage).toBeGreaterThan(-1)
    expect(initializeSqlite).toBeGreaterThan(ensureStorage)
    expect(startListening).toBeGreaterThan(initializeSqlite)
    expect(closeSqlite).toBeGreaterThan(closeHttp)
    expect(source.slice(source.indexOf('async function shutdownRuntime()'), source.indexOf('export function stopQuickForgeServer()'))).toContain('finally {')
    expect(source).toContain('sqlite: getSqliteStorageSummary()')
  })

  it('initializes ACP storage before agent creation and closes it in finally without a top-level SQLite import', async () => {
    const source = await readFile(acpSourceUrl, 'utf8')
    const runnerStart = source.indexOf('export async function runQuickForgeAcpStdio()')
    const dynamicImport = source.indexOf("import('../sqlite/database.mjs')", runnerStart)
    const ensureStorage = source.indexOf('await storageModule.ensureStorage()', runnerStart)
    const initializeSqlite = source.indexOf('await sqliteModule.initializeSqliteStorage()', runnerStart)
    const createAgent = source.indexOf('const quickForgeAgent = await createQuickForgeAcpAgent()', runnerStart)
    const closeSqlite = source.indexOf('await sqliteStorage?.closeSqliteStorage()', runnerStart)

    expect(source.slice(0, runnerStart)).not.toContain("from '../sqlite/database.mjs'")
    expect(dynamicImport).toBeGreaterThan(runnerStart)
    expect(ensureStorage).toBeGreaterThan(dynamicImport)
    expect(initializeSqlite).toBeGreaterThan(ensureStorage)
    expect(createAgent).toBeGreaterThan(initializeSqlite)
    expect(closeSqlite).toBeGreaterThan(createAgent)
  })
})
