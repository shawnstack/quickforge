#!/usr/bin/env node
// Offline downgrade escape hatch (storage v2): materializes the authoritative
// SQLite session store back into the legacy v1 JSON layout (per-session body
// files + per-bucket sessions-metadata.json). The old phase-machine semantics
// are gone — SQLite stays authoritative and this tool NEVER flips authority;
// it only exports data so an older QuickForge build (or a human) can read it.
//
//   node downgrade-session-state-v1.mjs --dry-run   # report only, no writes
//   node downgrade-session-state-v1.mjs             # write the JSON layout
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createSessionStateRepository } from '../sqlite/session-state-repository.mjs'
import {
  createPhysicalSessionStateFsAdapter,
  dataDir,
  removeSessionStateJsonBody,
  writeSessionStateJsonBody,
  writeSessionStateMetadataBucket,
} from '../storage.mjs'

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))
const dryRun = args.has('--dry-run')

function exitError(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

try {
  const storage = await initializeSqliteStorage({ dataDir })
  storage.health({ quickCheck: true })
  const repository = createSessionStateRepository(storage)
  const integrity = repository.verifyIntegrity({ quickCheck: true })
  if (!integrity.ok) throw new Error('Session state integrity verification failed')
  const snapshot = repository.exportSnapshot()
  // Lightweight integrity has no digest; the count cross-check plus the
  // snapshot's own digest stay authoritative.
  if (snapshot.count !== integrity.count) {
    throw new Error('Session state snapshot count verification failed')
  }

  // Reassemble every record into a full v1 JSON body (split sessions carry
  // their messages inline again) and group metadata per bucket.
  const bodiesByBucket = new Map()
  const metadataByBucket = new Map()
  for (const record of snapshot.records) {
    const bucket = record.scope === 'project' ? { scope: 'project', projectId: record.projectId } : { scope: 'global' }
    const key = `${bucket.scope}\0${bucket.projectId || ''}`
    const state = record.state?.messageStorage === 'split'
      ? { ...record.state, messages: record.messages ?? [] }
      : record.state
    if (!bodiesByBucket.has(key)) {
      bodiesByBucket.set(key, { bucket, bodies: new Map() })
      metadataByBucket.set(key, { bucket, metadata: {} })
    }
    bodiesByBucket.get(key).bodies.set(record.sessionId, state)
    metadataByBucket.get(key).metadata[record.sessionId] = record.metadata
  }

  const report = {
    ok: true,
    count: snapshot.count,
    digest: snapshot.digest,
    dryRun,
    sessionsDirectory: path.join(dataDir, 'storage', 'conversations'),
    message: 'SQLite stays authoritative; the JSON layout is an exported copy (escape hatch), not a phase switch.',
  }

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const adapter = createPhysicalSessionStateFsAdapter()
    for (const { bucket, bodies } of bodiesByBucket.values()) {
      // Remove stale body files that no longer exist in the store before
      // writing the fresh snapshot.
      for await (const sessionId of adapter.listSessionFiles(bucket)) {
        if (!bodies.has(sessionId)) await removeSessionStateJsonBody(bucket, sessionId)
      }
      for (const [sessionId, state] of bodies) {
        await writeSessionStateJsonBody(bucket, sessionId, state)
      }
    }
    for (const { bucket, metadata } of metadataByBucket.values()) {
      await writeSessionStateMetadataBucket(bucket, metadata)
    }
    report.materialized = snapshot.count
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
} catch (error) {
  exitError(error?.message || String(error))
} finally {
  await closeSqliteStorage().catch(() => {})
}
