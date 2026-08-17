#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createLanAccessRepository } from '../sqlite/lan-access-repository.mjs'
import { buildLanAccessJsonSnapshot } from '../lan-access-cutover.mjs'
import { readLanAccessStorageState } from '../lan-access-service.mjs'
import { dataDir } from '../storage.mjs'

// F11 Phase 3 offline authoritative LAN access export (shutdown-time only).
// Mirrors export-share-v1.mjs in the independent lan-access storage domain:
// refuses cutover_running and json_authoritative, runs quick_check +
// verifyIntegrity + exportSnapshot with fail-closed count/digest checks, and
// only renames the temporary file into place after re-reading and re-verifying
// what was written. The exported config carries token hashes only (never the
// raw secrets) and strips the repository-internal revision.
const AUTHORITATIVE_PHASES = new Set(['sqlite_authoritative_json_pending', 'authoritative'])

function outputPath() {
  const argument = process.argv[2]
  if (argument) return path.resolve(argument)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(process.cwd(), `quickforge-lan-access-${stamp}.json`)
}

const finalPath = outputPath()
const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`

function publicConfig(config) {
  const rest = { ...config }
  delete rest.revision
  return rest
}

try {
  const storage = await initializeSqliteStorage({ dataDir })
  storage.health({ quickCheck: true })
  const repository = createLanAccessRepository(storage)
  const state = readLanAccessStorageState()
  if (state.phase === 'cutover_running') {
    throw new Error('LAN access cutover is still running; stop all QuickForge processes and retry')
  }
  if (!AUTHORITATIVE_PHASES.has(state.phase)) {
    throw new Error(`LAN access storage is ${state.phase}; authoritative export requires the SQLite cutover to be complete`)
  }
  const integrity = repository.verifyIntegrity({ quickCheck: true })
  if (!integrity.ok) throw new Error('LAN access storage integrity verification failed')
  const snapshot = repository.exportSnapshot()
  if (snapshot.tokenCount !== integrity.count || snapshot.digest !== integrity.digest) {
    throw new Error('LAN access backup count/digest verification failed')
  }
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'lan-access',
    includeSecrets: false,
    lanAccessState: { phase: state.phase, count: snapshot.tokenCount, digest: snapshot.digest },
    data: {
      lanAccess: publicConfig(snapshot.config),
    },
  }
  await fs.mkdir(path.dirname(finalPath), { recursive: true })
  await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
  const recheck = buildLanAccessJsonSnapshot(verified.data?.lanAccess)
  if (verified.lanAccessState?.count !== snapshot.tokenCount || verified.lanAccessState?.digest !== snapshot.digest
    || recheck.tokenCount !== snapshot.tokenCount || recheck.digest !== snapshot.digest) {
    throw new Error('LAN access export verification failed')
  }
  await fs.rename(temporaryPath, finalPath)
  process.stdout.write(`${finalPath}\n`)
} catch (error) {
  await fs.rm(temporaryPath, { force: true }).catch(() => {})
  process.stderr.write(`${error?.message || error}\n`)
  process.exitCode = 1
} finally {
  await closeSqliteStorage().catch(() => {})
}
