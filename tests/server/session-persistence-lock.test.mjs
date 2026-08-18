import { describe, expect, it } from 'vitest'
import { withSessionPersistenceLock } from '../../server/session-persistence-lock.mjs'

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// The module-level queue map is shared across tests in this file, so each test
// uses a unique key and always settles its gates to avoid leaking a pending
// chain into the next test.
let keySeq = 0
function nextKey(prefix) {
  keySeq += 1
  return `${prefix}-${keySeq}`
}

// Drain microtasks: a setTimeout(0) macrotask runs after every pending
// microtask of the promise chains has settled.
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('session persistence lock', () => {
  it('serializes operations that share a key', async () => {
    const order = []
    const gate = deferred()
    const key = nextKey('same')
    const first = withSessionPersistenceLock(async () => {
      order.push('first-start')
      await gate.promise
      order.push('first-end')
    }, key)
    const second = withSessionPersistenceLock(async () => {
      order.push('second-start')
    }, key)

    await tick()
    expect(order).toEqual(['first-start'])

    gate.resolve()
    await first
    await second
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('runs operations under different keys concurrently', async () => {
    const order = []
    const gate = deferred()
    const first = withSessionPersistenceLock(async () => {
      order.push('a-start')
      await gate.promise
      order.push('a-end')
    }, nextKey('a'))

    await withSessionPersistenceLock(async () => {
      order.push('b-run')
    }, nextKey('b'))

    expect(order).toEqual(['a-start', 'b-run'])
    gate.resolve()
    await first
    expect(order).toEqual(['a-start', 'b-run', 'a-end'])
  })

  it('serializes default-key operations with an explicit empty-string key', async () => {
    const order = []
    const gate = deferred()
    const key = nextKey('global')
    const first = withSessionPersistenceLock(async () => {
      order.push('first-start')
      await gate.promise
      order.push('first-end')
    })
    const second = withSessionPersistenceLock(async () => {
      order.push('second-start')
    }, '')

    await tick()
    expect(order).toEqual(['first-start'])

    gate.resolve()
    await first
    await second
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('keeps the queue usable after a rejected operation', async () => {
    const key = nextKey('reject')
    const failing = withSessionPersistenceLock(async () => {
      throw new Error('boom')
    }, key)
    await expect(failing).rejects.toThrow('boom')

    const value = await withSessionPersistenceLock(async () => 42, key)
    expect(value).toBe(42)
  })
})
