// One process-wide queue for every session's write/edit and rollback. Callers must
// not re-enter this lock; the before/read, journal, write and after commit belong
// to one critical section. This cannot lock out editors or other processes.
let tail = Promise.resolve()

export function withSessionFileLock(operation) {
  const result = tail.then(operation)
  tail = result.catch(() => {})
  return result
}
