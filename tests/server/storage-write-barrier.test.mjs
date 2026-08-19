import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

// QUICKFORGE_DATA_DIR must point at a temp dir BEFORE server/storage.mjs is
// imported so dataDir/storageDir never touch a real data layout.
async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-write-barrier-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  try {
    const storageUrl = new URL(`../../server/storage.mjs?test=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    await testFn(storage)
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Poll until predicate() holds; bounded so a broken condition fails fast.
async function until(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met before timeout')
    await delay(5)
  }
}

// 'settled' only if the promise resolved (not rejected) within the grace window.
async function resolutionLabel(promise, ms) {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  await delay(ms)
  return settled ? 'settled' : 'pending'
}

function bodyFixture(sessionId, extra = {}) {
  return {
    id: sessionId,
    title: `title-${sessionId}`,
    messages: [],
    stateVersion: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
    ...extra,
  }
}

// Coverage for the session-domain write barrier (background migration design
// §3.3 / §9 feature 3): in-flight session writes drain before the barrier is
// achieved, writes enqueued while held park in FIFO order and replay after
// release, concurrent acquires serialize, and the last-write-finished
// timestamp feeds idle detection.
describe('storage session-domain write barrier', () => {
  it('tracks the last session-domain write completion timestamp (0 before any write)', async () => {
    await withTempStorage(async ({
      ensureStorage,
      readLastSessionWriteFinishedAt,
      atomicSessionMetadataUpdate,
      acquireSessionJsonWriteBarrier,
    }) => {
      expect(readLastSessionWriteFinishedAt()).toBe(0)
      await ensureStorage()

      const before = Date.now()
      await atomicSessionMetadataUpdate('global', null, (data) => {
        data.s1 = { id: 's1' }
        return data
      })
      const firstStamp = readLastSessionWriteFinishedAt()
      expect(firstStamp).toBeGreaterThanOrEqual(before)
      expect(firstStamp).toBeLessThanOrEqual(Date.now())

      // A write parked by the barrier still bumps the timestamp once it replays.
      const release = await acquireSessionJsonWriteBarrier()
      const parked = atomicSessionMetadataUpdate('global', null, (data) => {
        data.s2 = { id: 's2' }
        return data
      })
      release()
      await parked
      expect(readLastSessionWriteFinishedAt()).toBeGreaterThanOrEqual(firstStamp)
    })
  })

  it('achieves only after in-flight session writes finish (both queues)', async () => {
    await withTempStorage(async ({
      ensureStorage,
      registerSessionMetadataCommitHook,
      writeSessionValueWithMetadata,
      acquireSessionJsonWriteBarrier,
    }) => {
      await ensureStorage()
      const events = []
      // The commit hook is awaited inside the 'sessions-metadata' queue op,
      // giving a deterministic block point for the in-flight write. The
      // exported write helpers enqueue only after awaiting
      // sessionStateFacade(), so wait for the op to actually start before
      // acquiring the barrier.
      const gate = deferred()
      registerSessionMetadataCommitHook(async () => { events.push('hook:entered'); await gate.promise; events.push('hook:done') })

      const write = writeSessionValueWithMetadata('s1', bodyFixture('s1'))
      await until(() => events.includes('hook:entered'))
      const barrierPromise = acquireSessionJsonWriteBarrier()

      // Body write may finish, but the metadata write is blocked on the hook,
      // so the barrier cannot achieve yet.
      expect(await resolutionLabel(barrierPromise, 50)).toBe('pending')

      gate.resolve()
      const release = await barrierPromise
      await write
      // The drain waited for the in-flight metadata write, hook included.
      expect(events).toEqual(['hook:entered', 'hook:done'])
      release()
    })
  })

  it('waits for writes enqueued during the drain, then parks only post-achievement writes', async () => {
    await withTempStorage(async ({
      ensureStorage,
      registerSessionMetadataCommitHook,
      atomicSessionMetadataUpdate,
      acquireSessionJsonWriteBarrier,
    }) => {
      await ensureStorage()
      const order = []
      const gate = deferred()
      registerSessionMetadataCommitHook(async () => { await gate.promise })

      // W1 blocks inside its queue op on the hook; wait until it is actually
      // in flight (updateFn ran) because the helper only enqueues after an
      // await, so the barrier below is guaranteed to observe its tail.
      const w1 = atomicSessionMetadataUpdate('global', null, (data) => {
        order.push('w1')
        data.s1 = { id: 's1' }
        return data
      })
      await until(() => order.includes('w1'))
      const barrierPromise = acquireSessionJsonWriteBarrier()
      // W2 is enqueued while the barrier is still draining: it must be waited
      // for (it is in flight by achievement time), not silently parked. W1 is
      // blocked on the hook gate until after this enqueue settles, so W2 is
      // deterministically part of the drained set.
      const w2 = atomicSessionMetadataUpdate('global', null, (data) => {
        order.push('w2')
        data.s2 = { id: 's2' }
        return data
      })
      await delay(10)

      gate.resolve()
      const release = await barrierPromise
      expect(order).toEqual(['w1', 'w2'])
      release()
      await Promise.all([w1, w2])
    })
  })

  it('parks writes enqueued while held and replays them in FIFO order without losing any', async () => {
    await withTempStorage(async ({
      ensureStorage,
      readStore,
      readSessionValue,
      atomicSessionMetadataUpdate,
      writeSessionValue,
      acquireSessionJsonWriteBarrier,
    }) => {
      await ensureStorage()
      const release = await acquireSessionJsonWriteBarrier()

      const order = []
      const writes = []
      for (let i = 1; i <= 3; i += 1) {
        writes.push(atomicSessionMetadataUpdate('global', null, (data) => {
          order.push(`metadata-${i}`)
          data[`s${i}`] = { id: `s${i}`, title: `t${i}` }
          return data
        }))
      }
      // A 'sessions' queue write parks behind the same barrier.
      const bodyWrite = writeSessionValue('s9', bodyFixture('s9'))

      await delay(50)
      expect(order).toEqual([])

      release()
      await Promise.all([...writes, bodyWrite])

      expect(order).toEqual(['metadata-1', 'metadata-2', 'metadata-3'])
      const finalMetadata = await readStore('sessions-metadata')
      expect(finalMetadata.s1).toEqual({ id: 's1', title: 't1' })
      expect(finalMetadata.s2).toEqual({ id: 's2', title: 't2' })
      expect(finalMetadata.s3).toEqual({ id: 's3', title: 't3' })
      expect(await readSessionValue('s9')).toEqual(bodyFixture('s9'))
    })
  })

  it('serializes concurrent acquires (second holder waits for the first release)', async () => {
    await withTempStorage(async ({
      ensureStorage,
      atomicSessionMetadataUpdate,
      acquireSessionJsonWriteBarrier,
    }) => {
      await ensureStorage()
      const order = []

      const releaseA = await acquireSessionJsonWriteBarrier()
      const barrierB = acquireSessionJsonWriteBarrier()
      const parked = atomicSessionMetadataUpdate('global', null, (data) => {
        order.push('parked-write')
        data.s1 = { id: 's1' }
        return data
      })

      expect(await resolutionLabel(barrierB, 50)).toBe('pending')

      releaseA()
      await parked
      const releaseB = await barrierB
      // B achieved only after A released and the parked write settled.
      expect(order).toEqual(['parked-write'])
      releaseB()

      // Writes flow normally after both releases.
      await atomicSessionMetadataUpdate('global', null, (data) => {
        order.push('after-release')
        data.s2 = { id: 's2' }
        return data
      })
      expect(order).toEqual(['parked-write', 'after-release'])
    })
  })
})
