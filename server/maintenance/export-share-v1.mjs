#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../sqlite/database.mjs'
import { createShareRepository } from '../sqlite/share-repository.mjs'
import { buildShareJsonSnapshot } from '../share-backup.mjs'
import { runShareMaintenance } from '../share-maintenance.mjs'
import { dataDir } from '../storage.mjs'

// Offline share escape hatch (shutdown-time only). Mirrors
// export-session-state-v1.mjs: runs under the share maintenance lock, does
// quick_check + verifyIntegrity + exportSnapshot with fail-closed count/digest
// checks, and only renames the temporary file into place after re-reading and
// re-verifying what was written.
function outputPath() {
  const argument = process.argv[2]
  if (argument) return path.resolve(argument)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(process.cwd(), `quickforge-shares-${stamp}.json`)
}

const finalPath = outputPath()
const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`

try {
  const storage = await initializeSqliteStorage({ dataDir })
  storage.health({ quickCheck: true })
  const repository = createShareRepository(storage)
  await runShareMaintenance(async () => {
    const integrity = repository.verifyIntegrity({ quickCheck: true })
    if (!integrity.ok) throw new Error('Share storage integrity verification failed')
    const snapshot = repository.exportSnapshot()
    if (snapshot.count !== integrity.count || snapshot.digest !== integrity.digest) {
      throw new Error('Share backup count/digest verification failed')
    }
    const backup = {
      app: 'quickforge',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: 'shares',
      includeSecrets: false,
      shareState: { count: snapshot.count, digest: snapshot.digest },
      data: {
        shares: Object.fromEntries(snapshot.records.map((record) => {
          const rest = { ...record }
          delete rest.revision
          delete rest.deletedAt
          return [record.id, rest]
        })),
      },
    }
    await fs.mkdir(path.dirname(finalPath), { recursive: true })
    await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
    const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
    const recheck = buildShareJsonSnapshot(verified.data?.shares)
    if (verified.shareState?.count !== snapshot.count || verified.shareState?.digest !== snapshot.digest
      || recheck.count !== snapshot.count || recheck.digest !== snapshot.digest) {
      throw new Error('Share export verification failed')
    }
    await fs.rename(temporaryPath, finalPath)
  }, { storage, operation: 'share-export-v1' })
  process.stdout.write(`${finalPath}\n`)
} catch (error) {
  await fs.rm(temporaryPath, { force: true }).catch(() => {})
  process.stderr.write(`${error?.message || error}\n`)
  process.exitCode = 1
} finally {
  await closeSqliteStorage().catch(() => {})
}
