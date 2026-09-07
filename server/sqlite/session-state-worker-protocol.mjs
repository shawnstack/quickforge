// Shared protocol between the main-thread heavy-op client
// (session-state-worker-client.mjs) and the worker_threads entry
// (session-state-worker.mjs). Both sides import this module so the operation
// whitelist and the error wire format cannot drift apart.
//
// The whitelist covers the session-state repository operations whose cost is
// dominated by message encoding (canonical JSON + sha256) and/or large
// synchronous SQLite transactions — the work that stalls the main event loop
// when a long session persists. Small point reads (get/findBySessionId/
// messageCount/readLastMessage/...) stay on the main-thread connection and
// are deliberately NOT routed here.

export const SESSION_STATE_WORKER_OPS = Object.freeze([
  'save',
  'saveMany',
  'applyBatch',
  'replaceMessages',
  'appendMessages',
  'delete',
  'deleteBySessionId',
  'replaceAll',
  'exportSnapshot',
  'verifyIntegrity',
  'checkpointWal',
  'readMessagesPage',
])

// `beforeCommit` callbacks and other function-valued options cannot cross the
// worker boundary; session-state production call sites do not use them (only
// the share/lan repositories use beforeCommit internally, and those stay on
// the main thread).
export function isSessionStateWorkerOp(op) {
  return SESSION_STATE_WORKER_OPS.includes(op)
}

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return { name: 'Error', message: String(error), props: {} }
  }
  const props = {}
  for (const [key, value] of Object.entries(error)) {
    if (typeof value !== 'function' && typeof value !== 'object') props[key] = value
  }
  return { name: error.name || 'Error', message: error.message ?? String(error), props }
}

export function serializeSessionStateWorkerError(error) {
  return serializeError(error)
}

// Rebuild an Error with the enumerable properties the repository attaches for
// control flow (statusCode/errorCode/expectedRevision...), so CAS-conflict
// retries and HTTP status mapping on the main thread keep working unchanged.
export function deserializeSessionStateWorkerError(payload) {
  if (!payload || typeof payload !== 'object') return new Error('Unknown session state worker error')
  const error = new Error(payload.message ?? 'Session state worker failed')
  error.name = payload.name || 'Error'
  if (payload.props && typeof payload.props === 'object') {
    for (const [key, value] of Object.entries(payload.props)) error[key] = value
  }
  return error
}

export function createSessionStateWorkerCrashError(detail) {
  const error = new Error(`Session state worker crashed before replying: ${detail}`)
  error.errorCode = 'SESSION_STATE_WORKER_CRASHED'
  return error
}
