import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeSqliteStorage,
  getSqliteStorage,
  initializeSqliteStorage,
} from '../../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../../server/sqlite/session-state-repository.mjs'
import {
  getSessionStateHeavyRepository,
  isSessionStateWorkerEnabled,
  terminateSessionStateWorkerForTests,
} from '../../../server/sqlite/session-state-worker-client.mjs'
import { isSessionStateWorkerOp } from '../../../server/sqlite/session-state-worker-protocol.mjs'

let dataDir = null

function sampleRecord(sessionId, messages = []) {
  return {
    scope: 'global',
    sessionId,
    stateVersion: 1,
    state: { id: sessionId, messages },
    metadata: { id: sessionId },
  }
}

beforeEach(async () => {
  process.env.QUICKFORGE_LOG_LEVEL = 'ERROR'
  delete process.env.QUICKFORGE_SQLITE_WORKER
  await closeSqliteStorage()
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-worker-test-'))
  await initializeSqliteStorage({ dataDir })
})

afterEach(async () => {
  await closeSqliteStorage()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

describe('session state heavy-op worker', () => {
  it('executes whitelisted repository ops on the worker connection', async () => {
    const heavy = getSessionStateHeavyRepository()
    const saved = await heavy.save(sampleRecord('worker-1', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]), { expectedRevision: 0 })

    expect(saved.sessionId).toBe('worker-1')
    expect(saved.revision).toBe(1)
    expect(saved.messageCount).toBe(2)

    // The main-thread connection must observe the worker's WAL commit.
    const mainRepository = createSessionStateRepository(getSqliteStorage())
    expect(mainRepository.messageCount({ scope: 'global', projectId: '', sessionId: 'worker-1' })).toBe(2)

    const page = await heavy.readMessagesPage({ scope: 'global', projectId: '', sessionId: 'worker-1', limit: 10, offset: 0 })
    expect(page.messages).toHaveLength(2)
    expect(page.messages.map((row) => row.message.content)).toEqual(['hello', 'hi'])
  })

  it('propagates repository errors with their control-flow properties', async () => {
    const heavy = getSessionStateHeavyRepository()
    await heavy.save(sampleRecord('worker-conflict'), { expectedRevision: 0 })
    await expect(heavy.save(sampleRecord('worker-conflict'), { expectedRevision: 99 }))
      .rejects.toMatchObject({ errorCode: 'SESSION_STATE_CONFLICT', statusCode: 409 })
  })

  it('rejects unknown ops and preserves submit order', async () => {
    const heavy = getSessionStateHeavyRepository()
    expect(isSessionStateWorkerOp('nope')).toBe(false)
    // The frozen facade only exposes whitelisted ops, so unknown ops cannot
    // even be submitted from the main thread.
    expect(typeof heavy.nope).toBe('undefined')
    expect(Object.keys(heavy).sort()).toEqual([
      'appendMessages',
      'applyBatch',
      'checkpointWal',
      'delete',
      'deleteBySessionId',
      'exportSnapshot',
      'readMessagesPage',
      'replaceAll',
      'replaceMessages',
      'save',
      'saveMany',
      'verifyIntegrity',
    ])

    const first = heavy.appendMessages(sampleRecord('worker-order'), [
      { role: 'user', content: 'one' },
    ], { expectedRevision: 0 })
    const second = first.then((saved) => heavy.appendMessages(saved, [
      { role: 'user', content: 'two' },
    ], { expectedRevision: 1 }))
    await expect(second).resolves.toMatchObject({ revision: 2, messageCount: 2 })

    const page = await heavy.readMessagesPage({ scope: 'global', projectId: '', sessionId: 'worker-order', limit: 10, offset: 0 })
    expect(page.messages.map((row) => row.message.content)).toEqual(['one', 'two'])
  })

  it('rejects the in-flight op on crash and transparently respawns', async () => {
    const heavy = getSessionStateHeavyRepository()
    await heavy.save(sampleRecord('worker-crash'), { expectedRevision: 0 })

    // A big replace keeps the worker busy past the postMessage round trip so
    // the hard terminate deterministically lands mid-op.
    const bigMessages = Array.from({ length: 20000 }, (_, index) => ({ role: 'user', content: `message-${index}-${'x'.repeat(40)}` }))
    const inFlight = heavy.replaceMessages(sampleRecord('worker-crash', bigMessages), bigMessages, { expectedRevision: 1 })
    await new Promise((resolve) => setImmediate(resolve))
    await terminateSessionStateWorkerForTests()
    await expect(inFlight).rejects.toMatchObject({ errorCode: 'SESSION_STATE_WORKER_CRASHED' })

    // The next op respawns a fresh worker against the same database. The
    // crashed replace never committed, so the session keeps its original
    // (message-less) state.
    const page = await heavy.readMessagesPage({ scope: 'global', projectId: '', sessionId: 'worker-crash', limit: 10, offset: 0 })
    expect(page.messages).toEqual([])
  })

  it('honors the QUICKFORGE_SQLITE_WORKER=0 kill switch', async () => {
    expect(isSessionStateWorkerEnabled()).toBe(true)
    process.env.QUICKFORGE_SQLITE_WORKER = '0'
    try {
      expect(isSessionStateWorkerEnabled()).toBe(false)
      expect(() => getSessionStateHeavyRepository().save(sampleRecord('worker-off')))
        .toThrow(/worker is disabled/)
    } finally {
      delete process.env.QUICKFORGE_SQLITE_WORKER
    }
    expect(isSessionStateWorkerEnabled()).toBe(true)
  })

  it('terminates the worker when the main storage closes and respawns on the next op', async () => {
    const heavy = getSessionStateHeavyRepository()
    await heavy.save(sampleRecord('worker-lifecycle'), { expectedRevision: 0 })

    await closeSqliteStorage()
    await initializeSqliteStorage({ dataDir })

    const saved = await heavy.save(sampleRecord('worker-lifecycle-2'), { expectedRevision: 0 })
    expect(saved.sessionId).toBe('worker-lifecycle-2')
  })
})
