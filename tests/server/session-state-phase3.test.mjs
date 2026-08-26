import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  configureSessionStateService,
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

describe('F9 Phase 3 service integration (split session full chain, storage v2)', () => {
  let directory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-phase3-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('savePair reports the storage plan and exact persisted message count', async () => {
    // Storage v2: every session splits on its first save — the inline
    // threshold is gone; the plan for a fresh session is 'replace'.
    const first = await saveSessionStatePair({ state: state('one', 5), metadata: metadata('one', 5) })
    expect(first.messageStoragePlan).toBe('replace')
    expect(first.messageCount).toBe(5)
    expect(first.state.messageStorage).toBe('split')
    expect(first.state).not.toHaveProperty('messages')

    // A growing split session appends only the tail.
    const grown = messages(20, 0)
    const appended = await saveSessionStatePair({
      state: state('one', grown.length),
      metadata: metadata('one', grown.length),
      expectedRevision: first.revision,
    })
    expect(appended.messageStoragePlan).toBe('append')
    expect(appended.messageCount).toBe(20)
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(20)
    expect(readSessionStateValue('one').messages).toHaveLength(20)

    // Same-length in-place edits rewrite in full (replace), truncations too.
    const edited = await saveSessionStatePair({
      state: state('one', 20),
      metadata: metadata('one', 20),
      expectedRevision: appended.revision,
    })
    expect(edited.messageStoragePlan).toBe('body-only')
    const truncated = await saveSessionStatePair({
      state: state('one', 10),
      metadata: metadata('one', 10),
      expectedRevision: edited.revision,
    })
    expect(truncated.messageStoragePlan).toBe('replace')
    expect(truncated.messageCount).toBe(10)
  })

  it('storedMessagesState reports the split count and tail digest', () => {
    saveSessionStatePair({ state: state('one', 3), metadata: metadata('one', 3) })
    const splitState = storedMessagesState('one')
    expect(splitState).toMatchObject({ split: true, count: 3 })
    expect(splitState.tailDigest).toMatch(/^[0-9a-f]{64}$/)

    expect(storedMessagesState('missing')).toMatchObject({ split: false, count: 0, tailDigest: '' })
  })

  it('backup/restore roundtrips a split session with an exact digest', async () => {
    saveSessionStatePair({ state: state('big', 210), metadata: metadata('big', 210) })
    saveSessionBody('small', { messages: messages(3), title: 'Small' })

    const exported = await exportSessionStateForBackup()
    expect(exported.count).toBe(2)
    // The exported snapshot reassembles split messages into the body.
    expect(exported.sessions.big.messages).toHaveLength(210)
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
    expect(readSessionStateValue('big').messages).toHaveLength(210)
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(210)
  })
})
