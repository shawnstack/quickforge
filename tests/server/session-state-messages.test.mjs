import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import {
  MESSAGES_SPLIT_THRESHOLD,
  applySessionBatch,
  atomicSessionStateUpdate,
  configureSessionStateService,
  deleteSessionState,
  drainSessionJsonMirror,
  readSessionStateValue,
  saveSessionBody,
  saveSessionStatePair,
} from '../../server/session-state-service.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const workerScript = path.join(projectRoot, 'tests', 'fixtures', 'session-state-messages-cas-worker.mjs')

function createHandle(database) {
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
    transaction(callback, { mode = 'immediate' } = {}) {
      database.exec(`BEGIN ${mode.toUpperCase()}`)
      try {
        const result = callback(this)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

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

function record(sessionId = 'one', count = 0) {
  return {
    scope: 'global',
    sessionId,
    stateVersion: 1,
    state: {
      id: sessionId,
      scope: 'global',
      stateVersion: 1,
      title: `Session ${sessionId}`,
      messages: messages(count),
      bodyOpaque: { keep: true },
    },
    metadata: {
      id: sessionId,
      scope: 'global',
      stateVersion: 1,
      title: `Session ${sessionId}`,
      messageCount: count,
      metadataOpaque: { keep: true },
    },
  }
}

function spawnWorker(databasePath, sessionId, expectedRevision, marker) {
  const child = spawn(process.execPath, [workerScript, databasePath, sessionId, String(expectedRevision), marker], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QUICKFORGE_LOG_LEVEL: 'ERROR' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CAS worker timed out: ${stderr}`))
    }, 15_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`CAS worker failed (${code}): ${stderr}`))
      else resolve(JSON.parse(stdout.trim()))
    })
  })
}

describe('F9 schema v7 message incremental storage', () => {
  let directory
  let databasePath
  let storage
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-messages-'))
    databasePath = path.join(directory, 'state.sqlite3')
    await closeSqliteStorage()
    storage = await initializeSqliteStorage({ databasePath })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }, phase: 'authoritative' })
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('splits via replaceMessages, appends incrementally, and pages with stable ordering', () => {
    const saved = repository.replaceMessages(record('one'), messages(3), { expectedRevision: 0 })
    expect(saved.revision).toBe(1)
    expect(repository.findBySessionId('one').state.messageStorage).toBe('split')
    expect(repository.findBySessionId('one').state).not.toHaveProperty('messages')
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(3)

    const page = repository.readMessagesPage({ scope: 'global', sessionId: 'one', limit: 2 })
    expect(page.total).toBe(3)
    expect(page.messages.map((row) => row.message.content)).toEqual(['m0', 'm1'])
    expect(page.hasMore).toBe(true)
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'one', limit: 2, offset: 2 }).messages.map((row) => row.message.content)).toEqual(['m2'])
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'one', limit: 2, afterSeq: 1 }).messages.map((row) => row.message.content)).toEqual(['m2'])

    const appended = repository.appendMessages(repository.findBySessionId('one'), messages(2, 3), { expectedRevision: 1 })
    expect(appended.revision).toBe(2)
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(5)
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'one', limit: 10 }).messages.map((row) => row.message.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
  })

  it('deduplicates appended messages carrying the same message id and rejects append on non-split sessions', () => {
    const duplicate = { role: 'user', content: 'dup', id: 'dup-1' }
    repository.replaceMessages(record('one'), [duplicate], { expectedRevision: 0 })
    repository.appendMessages(repository.findBySessionId('one'), [duplicate], { expectedRevision: 1 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(1)

    repository.save(record('inline', 1), { expectedRevision: 0 })
    expect(() => repository.appendMessages(repository.findBySessionId('inline'), [{ role: 'user', content: 'x' }], { expectedRevision: 1 }))
      .toThrow(/not split/)
  })

  it('defines split digest semantics and roundtrips exportSnapshot through replaceAll', () => {
    const inline = repository.save(record('inline', 2), { expectedRevision: 0 })
    const splitRecord = repository.replaceMessages(record('split', 2), messages(2), { expectedRevision: 0 })
    expect(inline.stateDigest).not.toBe(splitRecord.stateDigest)
    expect(splitRecord.state).not.toHaveProperty('messages')

    const snapshot = repository.exportSnapshot()
    const splitRow = snapshot.records.find((entry) => entry.sessionId === 'split')
    const inlineRow = snapshot.records.find((entry) => entry.sessionId === 'inline')
    expect(splitRow.messages).toHaveLength(2)
    expect(splitRow.messagesDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(inlineRow.messages).toBeUndefined()
    expect(inlineRow.messagesDigest).toBe('')

    repository.replaceAll(snapshot.records)
    expect(repository.digest()).toBe(snapshot.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2 })
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'split', limit: 10 }).messages.map((row) => row.message.content)).toEqual(['m0', 'm1'])
  })

  it('reads v6-migrated inline sessions compatibly and splits only on rewrite', () => {
    const v6Path = path.join(directory, 'v6.sqlite3')
    const v6 = new DatabaseSync(v6Path)
    applySqliteMigrations(v6, { migrations: SQLITE_MIGRATIONS.slice(0, 6) })
    const v6Repository = createSessionStateRepository(createHandle(v6))
    v6Repository.save(record('legacy', 3), { expectedRevision: 0 })
    v6.close()

    // Reopen and migrate v6 -> v7; the inline session must stay readable.
    const migrated = new DatabaseSync(v6Path)
    applySqliteMigrations(migrated)
    const repo = createSessionStateRepository(createHandle(migrated))
    expect(repo.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
    const recordRow = repo.findBySessionId('legacy')
    expect(recordRow.state.messages).toHaveLength(3)
    expect(recordRow.state.messageStorage).toBeUndefined()
    migrated.close()
  })

  it('splits message-heavy sessions on write, appends incrementally, and derives metadata', () => {
    const initial = messages(MESSAGES_SPLIT_THRESHOLD)
    const saved = saveSessionStatePair({
      state: { id: 'big', scope: 'global', stateVersion: 1, title: 'Big', messages: initial },
      metadata: {},
    })
    expect(saved.state.messageStorage).toBe('split')
    expect(saved.state).not.toHaveProperty('messages')
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(MESSAGES_SPLIT_THRESHOLD)
    expect(saved.metadata.messageCount).toBe(MESSAGES_SPLIT_THRESHOLD)

    const assembled = readSessionStateValue('big')
    expect(assembled.messages).toHaveLength(MESSAGES_SPLIT_THRESHOLD)

    const appended = saveSessionBody('big', { messages: [...initial, { role: 'user', content: 'tail', timestamp: '2026-01-01T00:00:00.500Z' }] })
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(MESSAGES_SPLIT_THRESHOLD + 1)
    expect(appended.metadata.messageCount).toBe(MESSAGES_SPLIT_THRESHOLD + 1)
    expect(readSessionStateValue('big').messages.at(-1).content).toBe('tail')
  })

  it('keeps small sessions inline and clears message rows when a split session empties', () => {
    const small = saveSessionStatePair({
      state: { id: 'small', scope: 'global', stateVersion: 1, messages: [{ role: 'user', content: 'hi' }] },
      metadata: {},
    })
    expect(small.state.messages).toHaveLength(1)
    expect(small.state.messageStorage).toBeUndefined()
    expect(repository.messageCount({ scope: 'global', sessionId: 'small' })).toBe(0)

    saveSessionBody('big', { messages: messages(MESSAGES_SPLIT_THRESHOLD) })
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(MESSAGES_SPLIT_THRESHOLD)
    saveSessionBody('big', { messages: [] })
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(0)
    expect(readSessionStateValue('big').messages).toEqual([])
    expect(repository.findBySessionId('big').state.messageStorage).toBe('split')
  })

  it('falls back to a full replace when the boundary message changed in place', () => {
    saveSessionBody('big', { messages: messages(MESSAGES_SPLIT_THRESHOLD) })
    const edited = [...messages(MESSAGES_SPLIT_THRESHOLD)]
    edited[edited.length - 1] = { ...edited[edited.length - 1], content: 'edited' }
    saveSessionBody('big', { messages: edited })
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(MESSAGES_SPLIT_THRESHOLD)
    expect(readSessionStateValue('big').messages.at(-1).content).toBe('edited')
  })

  it('applies message-heavy batch writes as a single split transaction', () => {
    const result = applySessionBatch([
      { store: 'sessions', type: 'set', key: 'batch', value: { id: 'batch', scope: 'global', stateVersion: 1, messages: messages(MESSAGES_SPLIT_THRESHOLD) } },
    ])
    expect(result.saved).toBe(1)
    expect(repository.findBySessionId('batch').state.messageStorage).toBe('split')
    expect(repository.messageCount({ scope: 'global', sessionId: 'batch' })).toBe(MESSAGES_SPLIT_THRESHOLD)
  })

  it('passes assembled messages to atomic state updates on split sessions', async () => {
    saveSessionBody('big', { messages: messages(MESSAGES_SPLIT_THRESHOLD) })
    const updated = await atomicSessionStateUpdate('big', (state) => ({
      ...state,
      messages: [...state.messages, { role: 'user', content: 'atomic', timestamp: '2026-01-01T00:00:00.600Z' }],
    }))
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(MESSAGES_SPLIT_THRESHOLD + 1)
    expect(readSessionStateValue('big').messages.at(-1).content).toBe('atomic')
    expect(updated).not.toBeNull()
  })

  it('cascades message rows on delete and keeps integrity clean', () => {
    saveSessionBody('big', { messages: messages(MESSAGES_SPLIT_THRESHOLD) })
    expect(deleteSessionState('big')).toBe(true)
    expect(repository.messageCount({ scope: 'global', sessionId: 'big' })).toBe(0)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 0 })
  })

  it('reassembles split messages when materializing the JSON mirror', async () => {
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
    configureSessionStateService({ repository, mirror, phase: 'authoritative' })
    saveSessionBody('big', { messages: messages(MESSAGES_SPLIT_THRESHOLD) })
    await drainSessionJsonMirror()
    expect(mirror.upsert).toHaveBeenCalled()
    const entry = mirror.upsert.mock.calls.at(-1)[0]
    expect(entry.state.messageStorage).toBe('split')
    expect(entry.state.messages).toHaveLength(MESSAGES_SPLIT_THRESHOLD)
  })

  it('detects corrupt message digests, orphaned message rows, and double representations', () => {
    saveSessionBody('big', { messages: messages(MESSAGES_SPLIT_THRESHOLD) })
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true })
    storage.prepare('UPDATE session_messages SET message_digest = ? WHERE seq = 0').run('f'.repeat(64))
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, invalidMessageDigests: 1 })
    storage.prepare('UPDATE session_messages SET message_digest = ? WHERE seq = 0').run(repository.readMessagesPage({ scope: 'global', sessionId: 'big', limit: 1 }).messages[0].digest)

    storage.prepare(`INSERT INTO session_messages (scope, project_id, session_id, seq, message_json, message_digest, created, updated)
      VALUES ('global', '', 'ghost', 0, '{"role":"user"}', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run('a'.repeat(64))
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, orphanMessages: 1 })
    storage.prepare('DELETE FROM session_messages WHERE session_id = ?').run('ghost')

    storage.prepare('UPDATE session_states SET state_json = json_set(state_json, ?, json_array()) WHERE session_id = ?').run('$.messages', 'big')
    expect(repository.verifyIntegrity()).toMatchObject({ ok: false, invalidMessageRepresentations: 1 })
  })

  it('allows exactly one multi-process append CAS winner with a hard timeout', async () => {
    repository.replaceMessages(record('race'), [{ role: 'user', content: 'base', id: 'base' }], { expectedRevision: 0 })
    await closeSqliteStorage()
    const results = await Promise.all([
      spawnWorker(databasePath, 'race', 1, 'first'),
      spawnWorker(databasePath, 'race', 1, 'second'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toMatchObject([{ errorCode: 'SESSION_STATE_CONFLICT', actualRevision: 2 }])
    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA busy_timeout = 5000')
    expect(raw.prepare('SELECT revision FROM session_states WHERE session_id = ?').get('race').revision).toBe(2)
    const repo = createSessionStateRepository(createHandle(raw))
    expect(repo.messageCount({ scope: 'global', sessionId: 'race' })).toBe(2)
    expect(repo.readMessagesPage({ scope: 'global', sessionId: 'race', limit: 10 }).messages.some((row) => row.message.id === 'base')).toBe(true)
    raw.close()
  }, 20_000)
})
