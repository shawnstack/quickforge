import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'

const [databasePath, sessionId, expectedRevisionText, marker] = process.argv.slice(2)
try {
  const storage = await initializeSqliteStorage({ databasePath })
  const repository = createSessionStateRepository(storage)
  const current = repository.findBySessionId(sessionId)
  const saved = repository.save({
    ...current,
    state: { ...current.state, marker },
    metadata: current.metadata,
  }, { expectedRevision: Number(expectedRevisionText) })
  process.stdout.write(`${JSON.stringify({ ok: true, revision: saved.revision, marker })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, errorCode: error?.errorCode, actualRevision: error?.actualRevision, marker })}\n`)
} finally {
  await closeSqliteStorage()
}
