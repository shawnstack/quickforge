#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createSessionStateRepository } from '../sqlite/session-state-repository.mjs'
import { dataDir } from '../storage.mjs'

function outputPath() {
  const argument = process.argv[2]
  if (argument) return path.resolve(argument)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(process.cwd(), `quickforge-session-state-${stamp}.json`)
}

const finalPath = outputPath()
const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`

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
    throw new Error('Session state backup count verification failed')
  }
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'sessions',
    includeSecrets: false,
    sessionState: { phase: 'authoritative', count: snapshot.count, digest: snapshot.digest },
    data: {
      sessions: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.state?.messageStorage === 'split'
        ? { ...record.state, messages: record.messages ?? [] }
        : record.state])),
      sessionsMetadata: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.metadata])),
    },
  }
  await fs.mkdir(path.dirname(finalPath), { recursive: true })
  await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
  if (verified.sessionState?.count !== snapshot.count || verified.sessionState?.digest !== snapshot.digest) {
    throw new Error('Session state export verification failed')
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
