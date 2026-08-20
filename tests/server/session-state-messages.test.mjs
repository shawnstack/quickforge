import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySqliteMigrations } from '../../server/sqlite/migrations.mjs'
import { createSessionStateRepository, messageDigest } from '../../server/sqlite/session-state-repository.mjs'

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

describe('schema v11 message row storage', () => {
  let directory
  let databasePath
  let database
  let repository

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-messages-'))
    databasePath = path.join(directory, 'state.sqlite3')
    database = new DatabaseSync(databasePath)
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec('PRAGMA foreign_keys = ON')
    applySqliteMigrations(database)
    repository = createSessionStateRepository(createHandle(database))
  })

  afterEach(async () => {
    try { database.close() } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  it('stores every session row-per-message regardless of how the messages arrived', () => {
    // Inline save (legacy "inline" plan), replaceMessages (legacy "replace"
    // plan) and split-marked bodies all land in session_messages now.
    repository.save(record('inline', 2), { expectedRevision: 0 })
    repository.replaceMessages(record('split', 2), messages(2), { expectedRevision: 0 })
    const legacy = record('legacy-split', 2)
    legacy.state.messageStorage = 'split'
    repository.save(legacy, { expectedRevision: 0 })
    for (const sessionId of ['inline', 'split', 'legacy-split']) {
      expect(repository.messageCount({ scope: 'global', sessionId })).toBe(2)
      expect(repository.findBySessionId(sessionId).state).not.toHaveProperty('messages')
      expect(repository.findBySessionId(sessionId).state.messageStorage).toBe('split')
    }
    // Unified representation: re-saving the same messages through the replace
    // path (body rebuilt from the stored marker body) reproduces the exact
    // same body digest — inline vs split no longer changes the stored shape.
    const viaInline = repository.save(record('one', 2), { expectedRevision: 0 })
    const viaReplace = repository.replaceMessages(repository.findBySessionId('one'), messages(2), { expectedRevision: 1 })
    expect(viaReplace.stateDigest).toBe(viaInline.stateDigest)
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(2)

    // An empty message array clears the rows and keeps the session.
    repository.replaceMessages(repository.findBySessionId('inline'), [], { expectedRevision: 1 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'inline' })).toBe(0)
    expect(repository.findBySessionId('inline')).not.toBeNull()
  })

  it('appends incrementally, pages with stable ordering, and keeps the count column in sync', () => {
    repository.replaceMessages(record('one'), messages(3), { expectedRevision: 0 })
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
    expect(Number(database.prepare('SELECT message_count FROM sessions WHERE session_id = ?').get('one').message_count)).toBe(5)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 1 })
  })

  it('deduplicates appended messages carrying the same message id', () => {
    const duplicate = { role: 'user', content: 'dup', id: 'dup-1' }
    repository.replaceMessages(record('one'), [duplicate], { expectedRevision: 0 })
    repository.appendMessages(repository.findBySessionId('one'), [duplicate, { role: 'user', content: 'fresh', id: 'fresh-1' }], { expectedRevision: 1 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(2)
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'one', limit: 10 }).messages.map((row) => row.message.id)).toEqual(['dup-1', 'fresh-1'])
  })

  it('skips an exact id-less tail batch retry but appends new or partial id-less batches', () => {
    repository.replaceMessages(record('one'), messages(3), { expectedRevision: 0 })
    // Retry of an append whose payload exactly equals the stored tail: the
    // rows already persisted, so the batch is skipped wholesale.
    repository.appendMessages(repository.findBySessionId('one'), messages(2, 1), { expectedRevision: 1 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(3)
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'one', limit: 10 }).messages.map((row) => row.message.content)).toEqual(['m0', 'm1', 'm2'])

    // Only a partial overlap with the tail: not a retry, appended as usual.
    const fresh = { role: 'user', content: 'fresh', timestamp: '2026-01-01T00:00:01.000Z' }
    repository.appendMessages(repository.findBySessionId('one'), [messages(1, 2)[0], fresh], { expectedRevision: 2 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(5)

    // Documented conservative edge: a single id-less message identical to the
    // current tail is indistinguishable from a retry and is skipped...
    repository.appendMessages(repository.findBySessionId('one'), [fresh], { expectedRevision: 3 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(5)
    // ...while any newer id-less content still appends.
    repository.appendMessages(repository.findBySessionId('one'), [{ role: 'assistant', content: 'newer', timestamp: '2026-01-01T00:00:02.000Z' }], { expectedRevision: 4 })
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(6)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true })
  })

  it('reads the tail row and single-seq digests through the dedicated probes', () => {
    repository.replaceMessages(record('one'), messages(3), { expectedRevision: 0 })
    const last = repository.readLastMessage({ scope: 'global', sessionId: 'one' })
    expect(last.message.content).toBe('m2')
    expect(last.seq).toBe(2)
    expect(last.digest).toBe(messageDigest(messages(3)[2]))
    expect(last.digest).toBe(repository.readMessageDigestAt({ scope: 'global', sessionId: 'one', seq: 2 }))
    expect(repository.readMessageDigestAt({ scope: 'global', sessionId: 'one', seq: 0 })).toMatch(/^[0-9a-f]{64}$/)
    expect(repository.readMessageDigestAt({ scope: 'global', sessionId: 'one', seq: 9 })).toBeNull()
    expect(repository.readLastMessage({ scope: 'global', sessionId: 'missing' })).toBeNull()
  })

  it('roundtrips exportSnapshot through replaceAll with reassembled messages', () => {
    repository.save(record('inline', 2), { expectedRevision: 0 })
    repository.replaceMessages(record('split', 2), messages(2), { expectedRevision: 0 })
    const snapshot = repository.exportSnapshot()
    for (const entry of snapshot.records) {
      expect(entry.state.messages).toHaveLength(2)
      expect(entry.messages).toHaveLength(2)
      expect(entry.messagesDigest).toMatch(/^[0-9a-f]{64}$/)
    }
    repository.replaceAll(snapshot.records)
    expect(repository.digest()).toBe(snapshot.digest)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 2 })
    expect(repository.readMessagesPage({ scope: 'global', sessionId: 'split', limit: 10 }).messages.map((row) => row.message.content)).toEqual(['m0', 'm1'])
  })

  it('applies message-heavy batch writes as a single transaction', () => {
    const bulk = messages(300)
    const result = repository.applyBatch({
      upserts: [{ record: record('batch'), messages: bulk, messagesMode: 'append' }],
    })
    expect(result.saved).toHaveLength(1)
    expect(repository.messageCount({ scope: 'global', sessionId: 'batch' })).toBe(300)
    expect(Number(database.prepare('SELECT message_count FROM sessions WHERE session_id = ?').get('batch').message_count)).toBe(300)
  })

  // Handle variant that logs every prepare() call; the transaction callback
  // receives the handle itself, so in-transaction prepares are logged too.
  function createLoggingHandle(sqlLog) {
    return {
      exec: (sql) => database.exec(sql),
      prepare(sql) { sqlLog.push(sql); return database.prepare(sql) },
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

  it('dedups appended message ids against only the incoming ids in bounded IN chunks', () => {
    const sqlLog = []
    const loggingRepository = createSessionStateRepository(createLoggingHandle(sqlLog), { now: () => '2026-01-01T00:00:03.000Z' })
    loggingRepository.replaceMessages(record('one'), [
      { role: 'user', content: 's0', id: 's0' },
      { role: 'user', content: 's1', id: 's1' },
    ], { expectedRevision: 0 })
    sqlLog.length = 0
    const incoming = [
      { role: 'user', content: 's0-duplicate', id: 's0' },
      ...Array.from({ length: 600 }, (_, index) => ({ role: 'user', content: `n${index}`, id: `n${index}` })),
    ]
    loggingRepository.appendMessages(loggingRepository.findBySessionId('one'), incoming, { expectedRevision: 1 })
    // The stored-id duplicate is skipped; everything else lands exactly once.
    expect(loggingRepository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(602)
    // The dedup probe targets only the incoming ids (601 unique ids -> two
    // chunks of <=500) instead of scanning the whole stored id set.
    expect(sqlLog.filter((sql) => sql.includes('message_id IN'))).toHaveLength(2)
    expect(sqlLog.some((sql) => sql.includes('message_id IS NOT NULL'))).toBe(false)
    expect(loggingRepository.verifyIntegrity()).toMatchObject({ ok: true })
  })

  it('allows exactly one multi-process append CAS winner with a hard timeout', async () => {
    repository.replaceMessages(record('race'), [{ role: 'user', content: 'base', id: 'base' }], { expectedRevision: 0 })
    database.close()
    const results = await Promise.all([
      spawnWorker(databasePath, 'race', 1, 'first'),
      spawnWorker(databasePath, 'race', 1, 'second'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toMatchObject([{ errorCode: 'SESSION_STATE_CONFLICT', actualRevision: 2 }])
    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA busy_timeout = 5000')
    expect(raw.prepare('SELECT revision FROM sessions WHERE session_id = ?').get('race').revision).toBe(2)
    const repo = createSessionStateRepository(createHandle(raw))
    expect(repo.messageCount({ scope: 'global', sessionId: 'race' })).toBe(2)
    expect(repo.readMessagesPage({ scope: 'global', sessionId: 'race', limit: 10 }).messages.some((row) => row.message.id === 'base')).toBe(true)
    raw.close()
  }, 20_000)
})
