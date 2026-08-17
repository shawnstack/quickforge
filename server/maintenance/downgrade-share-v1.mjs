#!/usr/bin/env node
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createShareRepository } from '../sqlite/share-repository.mjs'
import { buildShareJsonSnapshot } from '../share-cutover.mjs'
import {
  SHARE_STORAGE_PHASES,
  configureShareService,
  createDefaultShareMirror,
  drainShareJsonMirror,
  readShareStorageState,
  setShareStoragePhase,
} from '../share-service.mjs'
import { readSharesJsonFile } from '../share-json-file.mjs'
import { dataDir } from '../storage.mjs'

// F10 Phase 3 offline share downgrade (shutdown-time only). Mirrors
// downgrade-session-state-v1.mjs in the independent share storage domain:
// --dry-run reports without writing anything or changing the phase; the default
// run drains the share JSON mirror (materializing the whole conversation-shares
// store) and verifies the on-disk JSON against the authoritative SQLite
// snapshot with an exact count/digest comparison; --commit then flips authority
// back to json_authoritative. Any failure leaves no partial output or phase
// change.
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
  const repository = createShareRepository(storage)
  configureShareService({ repository, mirror: createDefaultShareMirror() })
  const state = readShareStorageState()
  if (state.phase === 'cutover_running') {
    throw new Error('Share cutover is still running; stop all QuickForge processes and retry')
  }
  if (state.phase === SHARE_STORAGE_PHASES.JSON_AUTHORITATIVE) {
    throw new Error('Share storage is already JSON authoritative; nothing to downgrade')
  }
  if (!AUTHORITATIVE_PHASES.has(state.phase)) {
    throw new Error(`Share storage is ${state.phase}; downgrade requires pending or authoritative phase`)
  }
  const integrity = repository.verifyIntegrity({ quickCheck: true })
  if (!integrity.ok) throw new Error('Share storage integrity verification failed')
  const snapshot = repository.exportSnapshot()
  if (snapshot.count !== integrity.count || snapshot.digest !== integrity.digest) {
    throw new Error('Share storage snapshot count/digest verification failed')
  }
  const report = {
    ok: true,
    phase: state.phase,
    count: snapshot.count,
    digest: snapshot.digest,
    dryRun,
    commit,
    sharesFile: path.join(dataDir, 'storage', 'shares', 'conversation-shares.json'),
  }

  if (dryRun) {
    // Read-only: report what a real run would do without writing anything or
    // changing the phase.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const drained = await drainShareJsonMirror()
    if (drained.pending !== 0) {
      throw new Error(`Share JSON mirror drain failed: ${drained.pending} pending`)
    }
    // Verify the on-disk JSON store exactly matches the authoritative SQLite
    // snapshot before allowing any phase change.
    const mirror = buildShareJsonSnapshot(await readSharesJsonFile())
    if (mirror.count !== snapshot.count || mirror.digest !== snapshot.digest) {
      throw new Error(`Share JSON mirror verification failed: SQLite ${snapshot.count}/${snapshot.digest} vs JSON ${mirror.count}/${mirror.digest}`)
    }
    report.materialized = drained.drained
    if (commit) {
      setShareStoragePhase(SHARE_STORAGE_PHASES.JSON_AUTHORITATIVE, {
        shareCount: snapshot.count,
        digest: snapshot.digest,
        diagnostic: { operation: 'downgrade', materialized: drained.drained },
      })
      report.phase = SHARE_STORAGE_PHASES.JSON_AUTHORITATIVE
      report.phaseChanged = true
    } else {
      report.phaseChanged = false
      report.message = 'Share JSON mirror materialized; run with --commit after stopping all QuickForge processes to switch authority back to JSON'
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
} catch (error) {
  exitError(error?.message || String(error))
} finally {
  await closeSqliteStorage().catch(() => {})
}
