import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository, MIRROR_MAX_ATTEMPTS } from '../../server/sqlite/session-state-repository.mjs'
import {
  applySessionBatch,
  configureSessionStateService,
  drainSessionJsonMirror,
  getSessionStateDiagnostics,
  initializeSessionStateService,
  readSessionStateStore,
  readSessionStateValue,
  saveSessionBody,
  saveSessionMetadata,
  setSessionStoragePhase,
  stopSessionStateService,
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
      integrity: { ok: true, count: 2, lightweight: true, digest: null },
      mirrorPending: 2,
    })
  })

  it('reads sessions-metadata as a metadata-only store without full repository snapshots', () => {
    const exportSnapshot = vi.fn(() => repository.exportSnapshot())
    configureSessionStateService({ repository: { ...repository, exportSnapshot }, phase: 'authoritative' })
    saveSessionBody('global-one', { title: 'Global', messages: [{ role: 'user', content: 'hi' }] })
    saveSessionBody('project-one', { title: 'Project', scope: 'project', projectId: 'p1', messages: [{ role: 'user', content: 'yo' }] })
    const globalMetadata = repository.findBySessionId('global-one').metadata
    const projectMetadata = repository.findBySessionId('project-one').metadata

    const all = readSessionStateStore('sessions-metadata')
    expect(Object.keys(all).sort()).toEqual(['global-one', 'project-one'])
    expect(all['global-one']).toEqual(globalMetadata)
    expect(all['project-one']).toEqual(projectMetadata)
    expect(all['project-one']).not.toHaveProperty('messages')

    expect(readSessionStateStore('sessions-metadata', { scope: 'global' })).toEqual({ 'global-one': globalMetadata })
    expect(readSessionStateStore('sessions-metadata', { scope: 'project', projectId: 'p1' })).toEqual({ 'project-one': projectMetadata })
    expect(readSessionStateStore('sessions-metadata', { scope: 'project', projectId: 'other' })).toEqual({})

    // Metadata reads and bucket updates stay metadata-only: no exportSnapshot
    // (full state bodies + message rows) on either path, even with a filter.
    updateSessionMetadataBucket('project', 'p1', (current) => ({ ...current, 'project-one': { ...current['project-one'], taskStatus: 'idle' } }))
    expect(exportSnapshot).not.toHaveBeenCalled()
    expect(repository.findBySessionId('project-one').metadata).toMatchObject({ taskStatus: 'idle' })
  })

  it('drains the mirror queue in bounded pages, skipping failed entries without looping', async () => {
    for (const id of Array.from({ length: 10 }, (_, index) => `bulk-${index}`)) {
      repository.save(initialRecord(id), { expectedRevision: 0 })
    }
    const failing = new Set(['bulk-3', 'bulk-8'])
    const mirror = {
      upsert: vi.fn(async (entry) => { if (failing.has(entry.sessionId)) throw new Error('mirror unavailable') }),
      delete: vi.fn(),
    }
    configureSessionStateService({ repository, mirror, phase: 'authoritative' })
    const result = await drainSessionJsonMirror()
    expect(result).toMatchObject({ drained: 8, pending: 2 })
    expect(repository.countMirrorQueue()).toBe(2)
    expect(repository.listMirrorQueue().map((entry) => entry.sessionId).sort()).toEqual(['bulk-3', 'bulk-8'])
    for (const entry of repository.listMirrorQueue()) {
      expect(entry.attempts).toBeGreaterThanOrEqual(1)
      expect(entry.lastError).toBe('mirror unavailable')
    }
    stopSessionStateService()
  })

  it('drains more than one page of healthy mirror entries to pending 0', async () => {
    for (const id of Array.from({ length: 10 }, (_, index) => `ok-${index}`)) {
      repository.save(initialRecord(id), { expectedRevision: 0 })
    }
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    configureSessionStateService({ repository, mirror, phase: 'authoritative' })
    const result = await drainSessionJsonMirror()
    expect(result).toMatchObject({ drained: 10, pending: 0 })
    expect(repository.countMirrorQueue()).toBe(0)
    stopSessionStateService()
  })

  it('skips mirror entries superseded by a mid-drain save and materializes only the newest payload', async () => {
    repository.save(initialRecord('one'), { expectedRevision: 0 })
    repository.save(initialRecord('two'), { expectedRevision: 0 })
    const mirror = {
      upsert: vi.fn(async (entry) => {
        if (entry.sessionId === 'one') {
          // A save landing mid-drain supersedes the queued snapshot of 'two'.
          repository.save({ ...initialRecord('two'), state: { ...initialRecord('two').state, title: 'two v2' } }, { expectedRevision: 1 })
        }
      }),
      delete: vi.fn(),
    }
    configureSessionStateService({ repository, mirror, phase: 'authoritative' })
    const result = await drainSessionJsonMirror()
    expect(result).toMatchObject({ pending: 0 })
    // The stale 'two' snapshot was never materialized; only the newest payload.
    const twoTitles = mirror.upsert.mock.calls.map(([entry]) => entry).filter((entry) => entry.sessionId === 'two').map((entry) => entry.state.title)
    expect(twoTitles).toEqual(['two v2'])
    expect(repository.countMirrorQueue()).toBe(0)
    stopSessionStateService()
  })

  it('surfaces mirror dead letters in diagnostics once attempts are exhausted', async () => {
    repository.save(initialRecord('one'), { expectedRevision: 0 })
    const mirror = { upsert: vi.fn(async () => { throw new Error('mirror down') }), delete: vi.fn() }
    configureSessionStateService({ repository, mirror, phase: 'authoritative' })
    for (let round = 0; round < MIRROR_MAX_ATTEMPTS; round += 1) {
      await drainSessionJsonMirror()
    }
    expect(mirror.upsert).toHaveBeenCalledTimes(MIRROR_MAX_ATTEMPTS)
    // Dead letter: no more retries, no longer pending, but visible.
    const result = await drainSessionJsonMirror()
    expect(result).toMatchObject({ drained: 0, pending: 0, deadLetters: 1 })
    expect(mirror.upsert).toHaveBeenCalledTimes(MIRROR_MAX_ATTEMPTS)
    setSessionStoragePhase('authoritative', { stateCount: 1, digest: repository.digest() })
    expect(getSessionStateDiagnostics()).toMatchObject({ mirrorPending: 0, mirrorDeadLetters: 1 })
    stopSessionStateService()
  })
})
