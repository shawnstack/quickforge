import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'

// Multi-process CAS worker for F9 incremental message appends: two workers race
// to append their own message to the same split session with the same
// expectedRevision; exactly one must win and the loser must report a stable
// SESSION_STATE_CONFLICT.
const [databasePath, sessionId, expectedRevisionText, marker] = process.argv.slice(2)
try {
  const storage = await initializeSqliteStorage({ databasePath })
  const repository = createSessionStateRepository(storage)
  const current = repository.findBySessionId(sessionId)
  if (!current) throw new Error(`session ${sessionId} not found`)
  const saved = repository.appendMessages(
    { ...current },
    [{ role: 'assistant', content: marker, id: `msg-${marker}` }],
    { expectedRevision: Number(expectedRevisionText) },
  )
  process.stdout.write(`${JSON.stringify({ ok: true, revision: saved.revision, marker })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, errorCode: error?.errorCode, actualRevision: error?.actualRevision, marker })}\n`)
} finally {
  await closeSqliteStorage()
}
