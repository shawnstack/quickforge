import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'
import { createSessionIndexService } from '../../server/session-index-service.mjs'

const databasePath = process.argv[2]
const sourcePath = process.argv[3]
const iterations = Number(process.argv[4] || 20)
const workerId = process.argv[5] || 'worker'
if (!databasePath || !sourcePath) throw new Error('database path and source path are required')

async function readBuckets() {
  const text = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath, 'utf8'))
  return JSON.parse(text)
}

const scratch = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-convergence-worker-'))
try {
  const storage = await initializeSqliteStorage({ databasePath })
  const repository = createSessionIndexRepository(storage)
  const service = createSessionIndexService({ repository, readBuckets, log: { warn() {} } })
  await service.initialize()
  for (let index = 0; index < iterations; index += 1) {
    const buckets = await readBuckets()
    for (const bucket of buckets) {
      await service.syncMetadataCommit({
        scope: bucket.scope,
        projectId: bucket.projectId,
        previous: {},
        next: bucket.metadata,
      })
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, workerId, count: repository.count() })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(scratch, { recursive: true, force: true })
}
