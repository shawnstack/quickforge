// Main-thread facade for the heavy session-state worker thread.
//
// `getSessionStateHeavyRepository()` mirrors the whitelisted repository
// methods as async functions backed by session-state-worker.mjs. The worker
// owns its own DatabaseSync connection to the same WAL database, so its
// encoding and big synchronous transactions never block the main event loop.
//
// Lifecycle:
// - The worker spawns lazily on the first call and is keyed to the current
//   database path; close/reopen cycles in tests respawn it transparently.
// - QUICKFORGE_SQLITE_WORKER=0 disables the worker entirely (kill switch);
//   callers then fall back to the synchronous in-thread repository.
// - registerSqliteStorageCloseHook terminates the worker when the main
//   storage closes, after letting it close its own connection.

import { Worker } from 'node:worker_threads'
import { getSqliteDatabasePath, registerSqliteStorageCloseHook } from './database.mjs'
import {
  SESSION_STATE_WORKER_OPS,
  createSessionStateWorkerCrashError,
  deserializeSessionStateWorkerError,
} from './session-state-worker-protocol.mjs'

export function isSessionStateWorkerEnabled() {
  return process.env.QUICKFORGE_SQLITE_WORKER !== '0'
}

let activeWorker = null
let spawnPromise = null

function settlePending(state, id, error, result) {
  const pending = state.pending.get(id)
  if (!pending) return
  state.pending.delete(id)
  if (error) pending.reject(error)
  else pending.resolve(result)
}

function spawnWorker(databasePath) {
  const worker = new Worker(new URL('./session-state-worker.mjs', import.meta.url), { type: 'module' })
  const state = { worker, databasePath, nextId: 1, pending: new Map() }
  worker.on('message', (message) => {
    if (!message || typeof message.id !== 'number') return
    if (message.type === 'ok') settlePending(state, message.id, null, message.result)
    else if (message.type === 'error') settlePending(state, message.id, deserializeSessionStateWorkerError(message.error))
  })
  worker.on('messageerror', (error) => {
    rejectAllPending(state, error instanceof Error ? error : new Error(String(error)))
  })
  worker.on('exit', (code) => {
    rejectAllPending(state, createSessionStateWorkerCrashError(`worker exited with code ${code}`))
    if (activeWorker === state) activeWorker = null
  })
  return state
}

function rejectAllPending(state, error) {
  for (const id of [...state.pending.keys()]) settlePending(state, id, error)
}

function request(state, type, payload) {
  return new Promise((resolve, reject) => {
    const id = state.nextId
    state.nextId += 1
    state.pending.set(id, { resolve, reject })
    try {
      state.worker.postMessage({ type, id, ...payload })
    } catch (error) {
      settlePending(state, id, error)
    }
  })
}

async function disposeWorker(state) {
  if (activeWorker === state) activeWorker = null
  try {
    await state.worker.terminate()
  } catch { /* Already exiting; pending ops settle through the exit handler. */ }
}

function ensureWorker(databasePath) {
  if (activeWorker && activeWorker.databasePath === databasePath) return Promise.resolve(activeWorker)
  if (spawnPromise) return spawnPromise
  spawnPromise = (async () => {
    if (activeWorker) await disposeWorker(activeWorker)
    const state = spawnWorker(databasePath)
    try {
      await request(state, 'init', { databasePath })
    } catch (error) {
      await disposeWorker(state)
      throw error
    }
    activeWorker = state
    return state
  })().finally(() => {
    spawnPromise = null
  })
  return spawnPromise
}

async function runOp(op, args) {
  const state = await ensureWorker(getSqliteDatabasePath())
  return request(state, 'op', { op, args })
}

const heavyRepositoryFacade = Object.freeze(
  Object.fromEntries(SESSION_STATE_WORKER_OPS.map((op) => [
    op,
    (...args) => {
      if (!isSessionStateWorkerEnabled()) {
        throw new Error(`Session state worker op ${op} requested while the worker is disabled`)
      }
      return runOp(op, args)
    },
  ])),
)

export function getSessionStateHeavyRepository() {
  return heavyRepositoryFacade
}

// Test-only: simulate a worker crash (hard terminate, no close handshake).
export async function terminateSessionStateWorkerForTests() {
  if (!activeWorker) return
  await activeWorker.worker.terminate()
}

registerSqliteStorageCloseHook(async () => {
  const state = activeWorker
  if (!state) return
  activeWorker = null
  try {
    await request(state, 'close', {})
  } catch { /* The worker may already be gone; terminate below is enough. */ }
  await disposeWorker(state)
})
