// Keyed FIFO persistence queues. Each key owns one promise chain, so
// operations under the same key run strictly in order while operations under
// different keys run independently. The default (global) key serializes
// everything; per-session keys are used once SQLite session state is
// authoritative, where correctness relies on per-row revision CAS instead of
// global mutual exclusion. JSON-mirror mode and auto-archive keep the global
// key for their bucket-wide read-modify-write atomicity.
const persistenceQueues = new Map()

export function withSessionPersistenceLock(operation, key = '') {
  const previous = persistenceQueues.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  persistenceQueues.set(key, tail)
  tail.then(() => {
    // Drop the queue entry once it drains so idle keys do not linger.
    if (persistenceQueues.get(key) === tail) persistenceQueues.delete(key)
  })
  return result
}
