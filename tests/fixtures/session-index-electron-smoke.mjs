import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionIndexRepository } from '../../server/sqlite/session-index-repository.mjs'
import { createSessionIndexService } from '../../server/session-index-service.mjs'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-index-smoke-'))
try {
  const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })
  const repository = createSessionIndexRepository(storage)
  const service = createSessionIndexService({
    repository,
    readBuckets: async () => [{
      scope: 'global',
      projectId: null,
      metadata: {
        smoke: {
          id: 'smoke',
          title: 'Smoke',
          scope: 'global',
          createdAt: '2026-08-17T00:00:00.000Z',
          lastModified: '2026-08-17T01:00:00.000Z',
          messageCount: 1,
          stateVersion: 1,
        },
      },
    }],
    log: { warn() {} },
  })
  const initialized = await service.initialize()
  const row = repository.get('global', null, 'smoke')
  const query = await service.queryPage({
    scopeMode: 'global', archive: 'exclude', pinnedOnly: false,
    sort: 'lastModified', direction: 'desc', limit: 10, offset: 0,
  })
  if (storage.health().schemaVersion !== 10 || !initialized.ok || row?.stateVersion !== 1 || query.page?.values?.[0]?.id !== 'smoke') {
    throw new Error('Session index Electron smoke verification failed')
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, sqlite: process.versions.sqlite },
    schemaVersion: storage.health().schemaVersion,
    count: repository.count(),
    queryTotal: query.page.total,
  })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
