import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  applySessionBatch,
  configureSessionStateService,
  getSessionStateDiagnostics,
  initializeSessionStateService,
  readSessionStateStore,
  readSessionStateValue,
  saveSessionBody,
  saveSessionMetadata,
  setSessionStoragePhase,
  updateSessionMetadataBucket,
} from '../../server/session-state-service.mjs'

function initialRecord(id = 'one') {
  return {
    scope: 'global',
    sessionId: id,
    stateVersion: 1,
    state: {
      id,
      scope: 'global',
      stateVersion: 1,
      title: 'Original',
      messages: [{ role: 'user', content: 'hi', unknownMessage: 1 }],
      bodyUnknown: { keep: true },
    },
    metadata: {
      id,
      scope: 'global',
      stateVersion: 1,
      title: 'Original',
      messageCount: 1,
      pinnedAt: '2026-01-01T00:00:00.000Z',
      metadataUnknown: { keep: true },
    },
  }
}

describe('session state service facade', () => {
  let directory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-service-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('never reads SQLite in json_authoritative/cutover_running and uses SQLite strictly in pending/authoritative', () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
    const json = {
      readState: vi.fn(() => ({ id: 'one', source: 'json' })),
      readMetadata: vi.fn(() => ({ id: 'one', source: 'json-meta' })),
      readRecord: vi.fn(() => ({ state: { source: 'json-record' } })),
      readStore: vi.fn(() => ({ one: { source: 'json-store' } })),
    }
    configureSessionStateService({ repository, json, phase: 'json_authoritative' })
    expect(readSessionStateValue('one')).toEqual({ id: 'one', source: 'json' })
    expect(readSessionStateStore('sessions')).toEqual({ one: { source: 'json-store' } })
    configureSessionStateService({ phase: 'cutover_running' })
    expect(readSessionStateValue('one')).toEqual({ id: 'one', source: 'json' })

    configureSessionStateService({ phase: 'sqlite_authoritative_json_pending' })
    expect(readSessionStateValue('one')).toMatchObject({ bodyUnknown: { keep: true } })
    expect(json.readState).toHaveBeenCalledTimes(2)
    configureSessionStateService({ phase: 'authoritative' })
    expect(readSessionStateValue('one')).toMatchObject({ title: 'Original' })
  })

  it('preserves opaque body/metadata/message fields and metadata-owned pin/archive on body saves', () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
    configureSessionStateService({ repository, phase: 'authoritative' })
    const saved = saveSessionBody('one', {
      title: 'Updated',
      messages: [{ role: 'assistant', content: 'done', anotherUnknown: true }],
      newOpaque: ['kept'],
      pinnedAt: null,
    })
    expect(saved.state).toMatchObject({
      title: 'Updated',
      bodyUnknown: { keep: true },
      newOpaque: ['kept'],
      pinnedAt: '2026-01-01T00:00:00.000Z',
      messages: [{ anotherUnknown: true }],
    })
    expect(saved.metadata).toMatchObject({ metadataUnknown: { keep: true }, pinnedAt: '2026-01-01T00:00:00.000Z', messageCount: 1 })
  })

  it('requires an existing body for metadata-only writes and synchronizes body-owned projections', () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
    configureSessionStateService({ repository, phase: 'authoritative' })
    try {
      saveSessionMetadata('missing', { pinnedAt: 'x' })
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'SESSION_STATE_REQUIRED' })
    }
    const saved = saveSessionMetadata('one', {
      title: 'Metadata title',
      pinnedAt: null,
      archivedAt: '2026-02-01T00:00:00.000Z',
      custom: 42,
    })
    expect(saved.metadata).toMatchObject({ title: 'Metadata title', archivedAt: '2026-02-01T00:00:00.000Z', custom: 42 })
    expect(saved.metadata).not.toHaveProperty('pinnedAt')
    expect(saved.state).toMatchObject({ title: 'Metadata title', archivedAt: '2026-02-01T00:00:00.000Z' })
    expect(saved.state).not.toHaveProperty('pinnedAt')
  })

  it('applies multi-session set/delete atomically and rolls back every record on conflict', () => {
    repository.save(initialRecord('one'), { expectedRevision: 0 })
    repository.save(initialRecord('two'), { expectedRevision: 0 })
    configureSessionStateService({ repository, phase: 'authoritative' })
    const result = applySessionBatch([
      { store: 'sessions', type: 'set', key: 'one', value: { title: 'One changed' }, expectedRevision: 1 },
      { store: 'sessions-metadata', type: 'set', key: 'one', value: { pinnedAt: null } },
      { store: 'sessions', type: 'delete', key: 'two', expectedRevision: 1 },
      { store: 'sessions', type: 'set', key: 'three', value: { scope: 'global', stateVersion: 1, messages: [] }, expectedRevision: 0 },
    ])
    expect(result).toMatchObject({ saved: 2, deleted: 1 })
    expect(repository.findBySessionId('one').state).toMatchObject({ title: 'One changed' })
    expect(repository.findBySessionId('one').state).not.toHaveProperty('pinnedAt')
    expect(repository.findBySessionId('two')).toBeNull()
    expect(repository.findBySessionId('three')).not.toBeNull()

    const before = repository.exportSnapshot()
    expect(() => applySessionBatch([
      { store: 'sessions', type: 'set', key: 'one', value: { title: 'must rollback' }, expectedRevision: 2 },
      { store: 'sessions', type: 'set', key: 'three', value: { title: 'conflict' }, expectedRevision: 99 },
    ])).toThrow(/conflict/i)
    expect(repository.exportSnapshot()).toEqual(before)
  })

  it('updates metadata buckets transactionally and reports phase/integrity/outbox diagnostics', () => {
    repository.save(initialRecord('one'), { expectedRevision: 0 })
    repository.save(initialRecord('two'), { expectedRevision: 0 })
    configureSessionStateService({ repository, phase: 'authoritative' })
    const updated = updateSessionMetadataBucket('global', null, (current) => ({
      ...current,
      one: { ...current.one, archivedAt: '2026-03-01T00:00:00.000Z' },
      two: { ...current.two, pinnedAt: null },
    }))
    expect(updated.one.archivedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(repository.findBySessionId('one').state.archivedAt).toBe('2026-03-01T00:00:00.000Z')

    setSessionStoragePhase('authoritative', { stateCount: 2, digest: repository.digest() })
    initializeSessionStateService()
    expect(getSessionStateDiagnostics()).toMatchObject({
      phase: 'authoritative',
      authority: 'sqlite',
      integrity: { ok: true, count: 2 },
      mirrorPending: 2,
    })
  })
})
