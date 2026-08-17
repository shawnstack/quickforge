import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'
import { createSessionIndexService } from '../../server/session-index-service.mjs'

const databasePath = process.argv[2]
const title = process.argv[3] || 'worker'
if (!databasePath) throw new Error('database path is required')
const scratch = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-worker-'))
try {
  const storage = await initializeSqliteStorage({ databasePath })
  const repository = createSessionIndexRepository(storage)
  const metadata = {
    shared: {
      id: 'shared',
      title,
      scope: 'global',
      lastModified: title,
      messageCount: 1,
    },
  }
  const service = createSessionIndexService({
    repository,
    readBuckets: async () => [{ scope: 'global', projectId: null, metadata }],
    log: { warn() {} },
  })
  await service.initialize()
  await service.syncMetadataCommit({ scope: 'global', projectId: null, previous: {}, next: metadata })
  process.stdout.write(`${JSON.stringify({ ok: true, title: repository.get('global', null, 'shared')?.metadata?.title })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(scratch, { recursive: true, force: true })
}
