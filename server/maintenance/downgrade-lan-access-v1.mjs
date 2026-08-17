#!/usr/bin/env node
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createLanAccessRepository } from '../sqlite/lan-access-repository.mjs'
import { buildLanAccessJsonSnapshot } from '../lan-access-cutover.mjs'
import {
  LAN_ACCESS_STORAGE_PHASES,
  configureLanAccessService,
  createDefaultLanAccessMirror,
  drainLanAccessJsonMirror,
  readLanAccessStorageState,
  setLanAccessStoragePhase,
} from '../lan-access-service.mjs'
import { readLanAccessJsonFile } from '../lan-access-json-file.mjs'
import { dataDir } from '../storage.mjs'

// F11 Phase 3 offline LAN access downgrade (shutdown-time only). Mirrors
// downgrade-share-v1.mjs in the independent lan-access storage domain:
// --dry-run reports without writing anything or changing the phase; the default
// run drains the lan-access JSON mirror (materializing the whole config into
// security/lan-access.json) and verifies the on-disk JSON against the
// authoritative SQLite snapshot with an exact count/digest comparison; --commit
// then flips authority back to json_authoritative. Any failure leaves no
// partial output or phase change.
const AUTHORITATIVE_PHASES = new Set(['sqlite_authoritative_json_pending', 'authoritative'])

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))
const dryRun = args.has('--dry-run')
const commit = args.has('--commit')

function exitError(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

try {
  const storage = await initializeSqliteStorage({ dataDir })
  storage.health({ quickCheck: true })
  const repository = createLanAccessRepository(storage)
  configureLanAccessService({ repository, mirror: createDefaultLanAccessMirror() })
  const state = readLanAccessStorageState()
  if (state.phase === 'cutover_running') {
    throw new Error('LAN access cutover is still running; stop all QuickForge processes and retry')
  }
  if (state.phase === LAN_ACCESS_STORAGE_PHASES.JSON_AUTHORITATIVE) {
    throw new Error('LAN access storage is already JSON authoritative; nothing to downgrade')
  }
  if (!AUTHORITATIVE_PHASES.has(state.phase)) {
    throw new Error(`LAN access storage is ${state.phase}; downgrade requires pending or authoritative phase`)
  }
  const integrity = repository.verifyIntegrity({ quickCheck: true })
  if (!integrity.ok) throw new Error('LAN access storage integrity verification failed')
  const snapshot = repository.exportSnapshot()
  if (snapshot.tokenCount !== integrity.count || snapshot.digest !== integrity.digest) {
    throw new Error('LAN access storage snapshot count/digest verification failed')
  }
  const report = {
    ok: true,
    phase: state.phase,
    count: snapshot.tokenCount,
    digest: snapshot.digest,
    dryRun,
    commit,
    lanAccessFile: path.join(dataDir, 'storage', 'security', 'lan-access.json'),
  }

  if (dryRun) {
    // Read-only: report what a real run would do without writing anything or
    // changing the phase.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const drained = await drainLanAccessJsonMirror()
    if (drained.pending !== 0) {
      throw new Error(`LAN access JSON mirror drain failed: ${drained.pending} pending`)
    }
    // Verify the on-disk JSON store exactly matches the authoritative SQLite
    // snapshot before allowing any phase change.
    const mirror = buildLanAccessJsonSnapshot(await readLanAccessJsonFile())
    if (mirror.tokenCount !== snapshot.tokenCount || mirror.digest !== snapshot.digest) {
      throw new Error(`LAN access JSON mirror verification failed: SQLite ${snapshot.tokenCount}/${snapshot.digest} vs JSON ${mirror.tokenCount}/${mirror.digest}`)
    }
    report.materialized = drained.drained
    if (commit) {
      setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.JSON_AUTHORITATIVE, {
        lanTokenCount: snapshot.tokenCount,
        digest: snapshot.digest,
        diagnostic: { operation: 'downgrade', materialized: drained.drained },
      })
      report.phase = LAN_ACCESS_STORAGE_PHASES.JSON_AUTHORITATIVE
      report.phaseChanged = true
    } else {
      report.phaseChanged = false
      report.message = 'LAN access JSON mirror materialized; run with --commit after stopping all QuickForge processes to switch authority back to JSON'
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
} catch (error) {
  exitError(error?.message || String(error))
} finally {
  await closeSqliteStorage().catch(() => {})
}
