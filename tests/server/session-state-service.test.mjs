import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  applySessionBatch,
  configureSessionStateService,
  getSessionStateDiagnostics,
  initializeSessionStateService,
  isSessionStateAuthoritative,
  readSessionStateStore,
  readSessionStateValue,
  readSessionStorageState,
  saveSessionBody,
  saveSessionMetadata,
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

describe('session state service facade (storage v2)', () => {
  let directory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-service-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null })
    stopSessionStateService()
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('is always authoritative and reports a constant authoritative state', () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
    expect(isSessionStateAuthoritative()).toBe(true)
    initializeSessionStateService()
    const state = readSessionStorageState()
    expect(state).toMatchObject({ phase: 'authoritative', stateCount: 1 })
    expect(state.updatedAt).toBeTruthy()
    expect(getSessionStateDiagnostics()).toMatchObject({
      phase: 'authoritative',
      authority: 'sqlite',
      integrity: { ok: true, count: 1, lightweight: true },
    })
  })

  it('preserves opaque body/metadata/message fields and metadata-owned pin/archive on body saves', () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
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
    })
    // Storage v2: the body never carries the messages array inline — the rows
    // are authoritative and reads reassemble them.
    expect(saved.state).not.toHaveProperty('messages')
    expect(saved.state.messageStorage).toBe('split')
    expect(readSessionStateValue('one').messages).toEqual([expect.objectContaining({ anotherUnknown: true })])
    expect(saved.metadata).toMatchObject({ metadataUnknown: { keep: true }, pinnedAt: '2026-01-01T00:00:00.000Z', messageCount: 1 })
  })

  it('requires an existing body for metadata-only writes and synchronizes body-owned projections', () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
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

  it('updates metadata buckets transactionally and reports integrity diagnostics', () => {
    repository.save(initialRecord('one'), { expectedRevision: 0 })
    repository.save(initialRecord('two'), { expectedRevision: 0 })
    const updated = updateSessionMetadataBucket('global', null, (current) => ({
      ...current,
      one: { ...current.one, archivedAt: '2026-03-01T00:00:00.000Z' },
      two: { ...current.two, pinnedAt: null },
    }))
    expect(updated.one.archivedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(repository.findBySessionId('one').state.archivedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(getSessionStateDiagnostics()).toMatchObject({
      phase: 'authoritative',
      authority: 'sqlite',
      integrity: { ok: true, count: 2, lightweight: true, digest: null },
    })
  })

  it('reads sessions-metadata as a metadata-only store without full repository snapshots', () => {
    const exportSnapshot = repository.exportSnapshot.bind(repository)
    const tracked = { ...repository, exportSnapshot: (...args) => exportSnapshot(...args) }
    configureSessionStateService({ repository: tracked })
    const trackedExport = tracked.exportSnapshot
    tracked.exportSnapshot = (...args) => {
      calls += 1
      return trackedExport(...args)
    }
    let calls = 0
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
    expect(calls).toBe(0)
    expect(repository.findBySessionId('project-one').metadata).toMatchObject({ taskStatus: 'idle' })
  })

  it('reassembles split bodies on reads without the inline threshold', () => {
    saveSessionBody('small', { messages: [{ role: 'user', content: 'only one' }], title: 'Small' })
    const record = repository.findBySessionId('small')
    expect(record.state.messageStorage).toBe('split')
    expect(record.state).not.toHaveProperty('messages')
    expect(readSessionStateValue('small')).toMatchObject({ title: 'Small', messages: [{ role: 'user', content: 'only one' }] })
  })
})
