#!/usr/bin/env node
import { createHash } from 'node:crypto'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createSessionStateRepository, snapshotDigestLine } from '../sqlite/session-state-repository.mjs'
import { buildSessionJsonSnapshot } from '../session-state-cutover.mjs'
import {
  SESSION_STORAGE_PHASES,
  configureSessionStateService,
  drainSessionJsonMirror,
  readSessionStorageState,
  setSessionStoragePhase,
} from '../session-state-service.mjs'
import {
  dataDir,
  materializeSessionJsonMirrorEntry,
  readPhysicalSessionStateBuckets,
} from '../storage.mjs'

const AUTHORITATIVE_PHASES = new Set(['sqlite_authoritative_json_pending', 'authoritative'])

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))
const dryRun = args.has('--dry-run')
const commit = args.has('--commit')

function mirrorAdapter() {
  async function materialize(entry) {
    await materializeSessionJsonMirrorEntry(entry)
  }
  return { upsert: materialize, delete: materialize }
}

function exitError(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

// F9 split sessions: the downgrade materializes the JSON mirror as full bodies
// (split marker + messages inline) via drainSessionJsonMirror, so the SQLite
// side must be digested over the ASSEMBLED representation — not the stored
// stripped body + messages digest — to compare against buildSessionJsonSnapshot.
function assembledSnapshotDigest(snapshot) {
  const rows = snapshot.records.map((record) => {
    const state = record.state?.messageStorage === 'split'
      ? { ...record.state, messages: record.messages ?? [] }
      : record.state
    return snapshotDigestLine(record.scope, record.projectId || '', record.sessionId, digestJson(state), digestJson(record.metadata), '')
  })
  return createHash('sha256').update(rows.sort().join('\n')).digest('hex')
}

try {
  const storage = await initializeSqliteStorage({ dataDir })
  storage.health({ quickCheck: true })
  const repository = createSessionStateRepository(storage)
  configureSessionStateService({ repository, mirror: mirrorAdapter() })
  const state = readSessionStorageState()
  if (state.phase === 'cutover_running') {
    throw new Error('Session state cutover is still running; stop all QuickForge processes and retry')
  }
  if (state.phase === SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE) {
    throw new Error('Session state is already JSON authoritative; nothing to downgrade')
  }
  if (!AUTHORITATIVE_PHASES.has(state.phase)) {
    throw new Error(`Session state is ${state.phase}; downgrade requires pending or authoritative phase`)
  }
  const integrity = repository.verifyIntegrity({ quickCheck: true })
  if (!integrity.ok) throw new Error('Session state integrity verification failed')
  const snapshot = repository.exportSnapshot()
  if (snapshot.count !== integrity.count || snapshot.digest !== integrity.digest) {
    throw new Error('Session state snapshot count/digest verification failed')
  }
  const report = {
    ok: true,
    phase: state.phase,
    count: snapshot.count,
    digest: snapshot.digest,
    dryRun,
    commit,
    sessionsDirectory: path.join(dataDir, 'storage', 'conversations'),
  }

  if (dryRun) {
    // Read-only: report what a real run would materialize without writing
    // anything or changing the phase.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    await drainSessionJsonMirror()
    // Verify the on-disk JSON mirror exactly matches the authoritative SQLite
    // snapshot before allowing any phase change. Split sessions are compared
    // over their assembled representation (full body with messages), which is
    // what the JSON mirror materializes.
    const mirror = buildSessionJsonSnapshot(await readPhysicalSessionStateBuckets())
    const targetDigest = assembledSnapshotDigest(snapshot)
    if (mirror.count !== snapshot.count || mirror.digest !== targetDigest) {
      throw new Error(`JSON mirror verification failed: SQLite ${snapshot.count}/${targetDigest} vs JSON ${mirror.count}/${mirror.digest}`)
    }
    if (commit) {
      setSessionStoragePhase(SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE, {
        stateCount: snapshot.count,
        digest: snapshot.digest,
        diagnostic: { operation: 'downgrade', materialized: mirror.count },
      })
      report.phase = SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE
      report.phaseChanged = true
    } else {
      report.phaseChanged = false
      report.message = 'JSON mirror materialized; run with --commit after stopping all QuickForge processes to switch authority back to JSON'
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
} catch (error) {
  exitError(error?.message || String(error))
} finally {
  await closeSqliteStorage().catch(() => {})
}
