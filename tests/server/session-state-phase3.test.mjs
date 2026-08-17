import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  MESSAGES_SPLIT_THRESHOLD,
  configureSessionStateService,
  drainSessionJsonMirror,
  readSessionStateValue,
  saveSessionBody,
  saveSessionStatePair,
  storedMessagesState,
} from '../../server/session-state-service.mjs'
import { exportSessionStateForBackup, restoreSessionStateSnapshot } from '../../server/session-state-backup.mjs'

function messages(count, start = 0) {
  const result = []
  for (let index = start; index < start + count; index += 1) {
    result.push({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `m${index}`,
      timestamp: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z`,
    })
  }
  return result
}

function state(sessionId, count, version = 1) {
  return {
    id: sessionId,
    scope: 'global',
    stateVersion: version,
    title: `Session ${sessionId}`,
    messages: messages(count),
    bodyOpaque: { keep: true },
  }
}

function metadata(sessionId, count, version = 1) {
  return {
    id: sessionId,
    scope: 'global',
    stateVersion: version,
    title: `Session ${sessionId}`,
    messageCount: count,
    metadataOpaque: { keep: true },
  }
}

describe('F9 Phase 3 service integration (split session full chain)', () => {
  let directory
  let storage
  let repository
  let mirrorUpserts
  let mirrorDeletes

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-phase3-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    mirrorUpserts = []
    mirrorDeletes = []
    configureSessionStateService({
      repository,
      mirror: {
        upsert: vi.fn(async (entry) => { mirrorUpserts.push(entry) }),
        delete: vi.fn(async (entry) => { mirrorDeletes.push(entry) }),
      },
      phase: 'authoritative',
    })
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('savePair reports the storage plan and exact persisted message count', () => {
    // First save below the threshold stays inline.
    const inline = saveSessionStatePair({ state: state('one', 5), metadata: metadata('one', 5) })
    expect(inline.messageStoragePlan).toBe('inline')
    expect(inline.messageCount).toBe(5)
    expect(inline.state.messages).toHaveLength(5)

    // Crossing the threshold splits in one transaction.
    const split = saveSessionStatePair({ state: state('two', MESSAGES_SPLIT_THRESHOLD + 10), metadata: metadata('two', MESSAGES_SPLIT_THRESHOLD + 10) })
    expect(split.messageStoragePlan).toBe('replace')
    expect(split.messageCount).toBe(MESSAGES_SPLIT_THRESHOLD + 10)
    expect(split.state.messageStorage).toBe('split')
    expect(split.state).not.toHaveProperty('messages')

    // A growing split session appends only the tail.
    const grown = messages(MESSAGES_SPLIT_THRESHOLD + 15, 0)
    const appended = saveSessionStatePair({
      state: state('two', grown.length),
      metadata: metadata('two', grown.length),
      expectedRevision: split.revision,
    })
    expect(appended.messageStoragePlan).toBe('append')
    expect(appended.messageCount).toBe(MESSAGES_SPLIT_THRESHOLD + 15)
    expect(repository.messageCount({ scope: 'global', sessionId: 'two' })).toBe(MESSAGES_SPLIT_THRESHOLD + 15)
    expect(readSessionStateValue('two').messages).toHaveLength(MESSAGES_SPLIT_THRESHOLD + 15)
  })

  it('storedMessagesState reports split count/tail digest and non-split inline count', () => {
    saveSessionStatePair({ state: state('inline-one', 3), metadata: metadata('inline-one', 3) })
    const inlineState = storedMessagesState('inline-one')
    expect(inlineState).toMatchObject({ split: false, count: 3 })
    expect(inlineState.tailDigest).toMatch(/^[0-9a-f]{64}$/)

    saveSessionStatePair({ state: state('split-one', MESSAGES_SPLIT_THRESHOLD + 2), metadata: metadata('split-one', MESSAGES_SPLIT_THRESHOLD + 2) })
    const splitState = storedMessagesState('split-one')
    expect(splitState).toMatchObject({ split: true, count: MESSAGES_SPLIT_THRESHOLD + 2 })
    expect(splitState.tailDigest).toMatch(/^[0-9a-f]{64}$/)

    expect(storedMessagesState('missing')).toMatchObject({ split: false, count: 0, tailDigest: '' })
  })

  it('backup/restore roundtrips a split session with an exact digest', async () => {
    saveSessionStatePair({ state: state('big', MESSAGES_SPLIT_THRESHOLD + 10), metadata: metadata('big', MESSAGES_SPLIT_THRESHOLD + 10) })
    saveSessionBody('small', { messages: messages(3), title: 'Small' })

    const exported = await exportSessionStateForBackup()
    expect(exported.count).toBe(2)
    // The exported snapshot reassembles split messages into the body.
    expect(exported.sessions.big.messages).toHaveLength(MESSAGES_SPLIT_THRESHOLD + 10)
    expect(exported.sessions.small.messages).toHaveLength(3)

    const restored = await restoreSessionStateSnapshot(
      { sessions: exported.sessions, sessionsMetadata: exported.sessionsMetadata },
      { mode: 'replace' },
    )
    expect(restored.sessions).toBe(2)
    // Exact representation roundtrip: stored digest is unchanged after restore.
    const after = repository.exportSnapshot()
    expect(after.count).toBe(2)
    expect(after.digest).toBe(exported.digest)
    expect(readSessionStateValue('big').messages).toHaveLength(MESSAGES_SPLIT_THRESHOLD + 10)
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(MESSAGES_SPLIT_THRESHOLD + 10)
  })

  it('mirror drains split sessions to a reassembled full body with pending 0', async () => {
    saveSessionStatePair({ state: state('big', MESSAGES_SPLIT_THRESHOLD + 10), metadata: metadata('big', MESSAGES_SPLIT_THRESHOLD + 10) })
    // Append a few more messages, then drain.
    const grown = messages(MESSAGES_SPLIT_THRESHOLD + 15, 0)
    saveSessionStatePair({ state: state('big', grown.length), metadata: metadata('big', grown.length) })
    const result = await drainSessionJsonMirror()
    expect(result.pending).toBe(0)

    // The mirror entry must be the reassembled body (marker + full messages).
    const entry = mirrorUpserts.at(-1)
    expect(entry.state.messageStorage).toBe('split')
    expect(Array.isArray(entry.state.messages)).toBe(true)
    expect(entry.state.messages).toHaveLength(MESSAGES_SPLIT_THRESHOLD + 15)
    expect(entry.state.messages.at(-1).content).toBe(`m${MESSAGES_SPLIT_THRESHOLD + 14}`)
  })
})
