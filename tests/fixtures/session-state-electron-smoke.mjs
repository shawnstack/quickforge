import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  configureSessionStateService,
  readSessionStateValue,
  saveSessionBody,
} from '../../server/session-state-service.mjs'

const directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-state-smoke-'))
try {
  const storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
  const repository = createSessionStateRepository(storage)
  repository.save({
    scope: 'global',
    sessionId: 'smoke',
    state: { id: 'smoke', scope: 'global', stateVersion: 1, messages: [], opaque: { electron: true } },
    metadata: { id: 'smoke', scope: 'global', stateVersion: 1, messageCount: 0, unknown: 'kept' },
  }, { expectedRevision: 0 })
  configureSessionStateService({ repository, phase: 'authoritative' })
  saveSessionBody('smoke', { messages: [{ role: 'user', content: 'hello' }] })
  const state = readSessionStateValue('smoke')
  if (storage.health().schemaVersion !== 10 || state?.opaque?.electron !== true || state?.messages?.length !== 1) {
    throw new Error('Session state Electron smoke verification failed')
  }
  process.stdout.write(`${JSON.stringify({ ok: true, schemaVersion: 10, revision: repository.findBySessionId('smoke').revision })}\n`)
} finally {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
}
