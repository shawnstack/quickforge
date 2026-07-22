let persistenceQueue = Promise.resolve()

export function withSessionPersistenceLock(operation) {
  const result = persistenceQueue
    .catch(() => undefined)
    .then(operation)
  persistenceQueue = result.then(() => undefined, () => undefined)
  return result
}
