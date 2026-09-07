// worker_threads entry for heavy session-state operations.
//
// Runs `createSessionStateRepository` on a dedicated worker thread with its
// own DatabaseSync connection to the same file, so message encoding and big
// synchronous transactions no longer stall the main event loop. The main
// thread talks to this module through session-state-worker-client.mjs using
// the protocol in session-state-worker-protocol.mjs.
//
// Messages in: { type: 'init', id, databasePath }
//              { type: 'op', id, op, args }
//              { type: 'close', id }
// Messages out: { type: 'ok', id, result }
//               { type: 'error', id, error }
//
// Messages from one parent are delivered and processed strictly in order, so
// per-session CAS semantics are preserved: the caller-side
// withSessionPersistenceLock already serializes per session, and the worker
// executes one repository call at a time.

import { parentPort } from 'node:worker_threads'
import { closeSqliteStorage, getSqliteStorage, initializeSqliteStorage } from './database.mjs'
import { createSessionStateRepository } from './session-state-repository.mjs'
import { isSessionStateWorkerOp, serializeSessionStateWorkerError } from './session-state-worker-protocol.mjs'

const SQLITE_BUSY_RETRIES = 2
const SQLITE_BUSY_RETRY_DELAY_MS = 50

function isSqliteBusy(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  return code.includes('SQLITE_BUSY') || message.includes('SQLITE_BUSY')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let repository = null

async function initialize(databasePath) {
  // The main thread has already applied migrations before the worker spawns;
  // the idempotent no-op migration transaction here only sanity-checks the
  // schema version under the shared busy_timeout.
  await initializeSqliteStorage({ databasePath })
  repository = createSessionStateRepository(getSqliteStorage())
}

// Both the worker and the main thread hold write connections to the same WAL
// database; busy_timeout absorbs normal contention, and this bounded retry
// covers the rare exhaustion during a main-thread write burst.
async function executeOp(op, args) {
  if (!isSessionStateWorkerOp(op)) throw new Error(`Unknown session state worker op: ${op}`)
  if (!repository) throw new Error('Session state worker is not initialized')
  let attempt = 0
  for (;;) {
    try {
      return repository[op](...args)
    } catch (error) {
      if (!isSqliteBusy(error) || attempt >= SQLITE_BUSY_RETRIES) throw error
      attempt += 1
      await sleep(SQLITE_BUSY_RETRY_DELAY_MS)
    }
  }
}

parentPort.on('message', async (message) => {
  const { type, id } = message ?? {}
  try {
    if (type === 'init') {
      await initialize(message.databasePath)
      parentPort.postMessage({ type: 'ok', id, result: null })
      return
    }
    if (type === 'op') {
      const result = await executeOp(message.op, message.args)
      parentPort.postMessage({ type: 'ok', id, result })
      return
    }
    if (type === 'close') {
      if (repository) await closeSqliteStorage()
      parentPort.postMessage({ type: 'ok', id, result: null })
      return
    }
    throw new Error(`Unknown session state worker message type: ${type}`)
  } catch (error) {
    parentPort.postMessage({ type: 'error', id, error: serializeSessionStateWorkerError(error) })
  }
})
