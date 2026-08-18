import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  initializeSessionStateCutover,
  isSessionStateMaintenanceActive,
} from '../../server/session-state-cutover.mjs'
import {
  configureSessionStateService,
  drainSessionJsonMirror,
  initializeSessionStateService,
  readSessionStorageState,
  setSessionStoragePhase,
  stopSessionStateService,
} from '../../server/session-state-service.mjs'

function bucket(sessionId = 'one', overrides = {}) {
  const scope = overrides.scope || 'global'
  const projectId = scope === 'project' ? overrides.projectId || 'project-a' : null
  const state = {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    title: 'Session',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides.state,
  }
  const metadata = overrides.metadata === undefined ? {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId } : {}),
    stateVersion: 1,
    messageCount: 1,
  } : overrides.metadata
  return { scope, projectId, sessions: { [sessionId]: state }, metadata: metadata === null ? {} : { [sessionId]: metadata } }
}

function initialRecord(id = 'one') {
  return {
    scope: 'global',
    sessionId: id,
    stateVersion: 1,
    state: { id, scope: 'global', stateVersion: 1, title: 'Original', messages: [{ role: 'user', content: 'hi' }] },
    metadata: { id, scope: 'global', stateVersion: 1, title: 'Original', messageCount: 1 },
  }
}

// The startup order exercised by server/index.mjs:
//   initializeSqliteStorage → initializeSessionStateCutover →
//   initializeSessionStateService → drainSessionJsonMirror
describe('session state lifecycle (startup order, fail closed, shutdown)', () => {
  let directory
  let backupDirectory
  let previousDataDir
  let storage
  let repository
  let storageModule

  beforeEach(async () => {
    await closeSqliteStorage()
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-lifecycle-'))
    process.env.QUICKFORGE_DATA_DIR = directory
    backupDirectory = path.join(directory, 'backups')
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })
    const testId = `${Date.now()}-${Math.random()}`
    storageModule = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null, json: null, mirror: null, phase: 'json_authoritative' })
    stopSessionStateService()
    await closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(directory, { recursive: true, force: true })
  })

  it('wires the startup chain: cutover → service init → mirror drain activates the authoritative facade', async () => {
    const mirror = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
    const state = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => [bucket('one')]),
      mirror,
      owner: { id: '201:test', pid: 201 },
      pidAlive: () => false,
    })
    expect(state.phase).toBe('authoritative')

    const serviceState = initializeSessionStateService()
    expect(serviceState.phase).toBe('authoritative')

    const drained = await drainSessionJsonMirror()
    expect(drained.pending).toBe(0)
    expect(mirror.upsert).toHaveBeenCalledTimes(1)

    // The storage facade is now active: reads come from SQLite, not JSON files.
    expect(await storageModule.isSessionStateAuthoritative()).toBe(true)
    const sessions = await storageModule.readStore('sessions')
    expect(sessions.one).toMatchObject({ id: 'one', title: 'Session' })
    expect((await storageModule.readStore('sessions-metadata')).one).toMatchObject({ messageCount: 1 })
    // Maintenance is no longer active after startup cutover completes.
    expect(isSessionStateMaintenanceActive(storage)).toBe(false)
  })

  it('fails closed and blocks startup when authoritative integrity fails', async () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
    setSessionStoragePhase('authoritative', {})
    // Startup verification is lightweight (SQL-level): corrupt with an active
    // tombstone shadowing a live row — SQL-detectable and not healable by the
    // index self-heal rebuild, so integrity verification fails closed.
    storage.prepare("INSERT INTO session_state_tombstones (scope, project_id, session_id, revision, deleted_at) VALUES ('global', '', 'one', 9, '2026-01-01T00:00:00.000Z')").run()
    await expect(initializeSessionStateCutover({
      storage,
      repository,
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '202:test', pid: 202 },
      pidAlive: () => false,
    })).rejects.toThrow(/authoritative integrity verification failed/)
    expect(readSessionStorageState().phase).toBe('authoritative')
  })

  it('keeps the legacy JSON path when cutover fails back to json_authoritative', async () => {
    await storageModule.ensureStorage()
    await storageModule.writeStore('sessions', { json: { id: 'json', title: 'JSON', scope: 'global', messages: [] } })

    let reads = 0
    const unstable = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => {
        reads += 1
        return [bucket(reads === 1 ? 'one' : 'two')]
      }),
      mirror: { upsert: vi.fn(), delete: vi.fn() },
      owner: { id: '203:test', pid: 203 },
      pidAlive: () => false,
    })
    expect(unstable.phase).toBe('json_authoritative')
    expect(await storageModule.isSessionStateAuthoritative()).toBe(false)
    const sessions = await storageModule.readStore('sessions')
    expect(sessions.json).toMatchObject({ id: 'json', title: 'JSON' })
  })

  it('keeps the mirror queue on failure and drains on a later startup', async () => {
    const failMirror = { upsert: vi.fn(async () => { throw new Error('mirror unavailable') }), delete: vi.fn() }
    const pending = await initializeSessionStateCutover({
      storage,
      repository,
      backupDirectory,
      readBuckets: vi.fn(async () => [bucket('one')]),
      mirror: failMirror,
      owner: { id: '204:test', pid: 204 },
      pidAlive: () => false,
    })
    expect(pending.phase).toBe('sqlite_authoritative_json_pending')
    expect(repository.listMirrorQueue()).toHaveLength(1)

    // Restart with a working mirror: the queue drains and the phase promotes.
    const okMirror = { upsert: vi.fn(async () => {}), delete: vi.fn() }
    const recovered = await initializeSessionStateCutover({
      storage,
      repository,
      mirror: okMirror,
      owner: { id: '205:test', pid: 205 },
      pidAlive: () => false,
    })
    expect(recovered.phase).toBe('authoritative')
    expect(repository.listMirrorQueue()).toEqual([])
    expect(okMirror.upsert).toHaveBeenCalledTimes(1)
  })

  it('releases the service on shutdown so the database can close cleanly', async () => {
    repository.save(initialRecord(), { expectedRevision: 0 })
    configureSessionStateService({ repository, mirror: { upsert: vi.fn(async () => { throw new Error('mirror down') }), delete: vi.fn() }, phase: 'authoritative' })
    const drained = await drainSessionJsonMirror()
    expect(drained.pending).toBe(1)
    // stopSessionStateService clears the scheduled retry timer; the queue is
    // preserved so a future drain can still recover it.
    stopSessionStateService()
    expect(repository.listMirrorQueue()).toHaveLength(1)
    const afterStop = await drainSessionJsonMirror()
    expect(afterStop.pending).toBe(1)
    await closeSqliteStorage()
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    expect(repository.listMirrorQueue()).toHaveLength(1)
  })
})
