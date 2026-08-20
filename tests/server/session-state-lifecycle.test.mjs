import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { importSessionStateFromJson } from '../../server/session-state-import.mjs'
import {
  configureSessionStateService,
  initializeSessionStateService,
  readSessionStorageState,
  stopSessionStateService,
} from '../../server/session-state-service.mjs'
import { isSessionStateMaintenanceActive } from '../../server/session-state-maintenance.mjs'

function seedJsonSession(dataDir, sessionId, overrides = {}) {
  const scope = overrides.scope || 'global'
  const dir = scope === 'project'
    ? path.join(dataDir, 'storage', 'conversations', 'projects', overrides.projectId, 'sessions')
    : path.join(dataDir, 'storage', 'conversations', 'global', 'sessions')
  const state = {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId: overrides.projectId } : {}),
    stateVersion: 1,
    title: `Session ${sessionId}`,
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides.state,
  }
  return { dir, state }
}

// The startup order exercised by server/index.mjs (storage v2):
//   initializeSqliteStorage → initializeSessionStateService →
//   (empty store + JSON files present?) importSessionStateFromJson →
//   recoverSessionStateRestorePlan
describe('session state lifecycle (startup order, import, shutdown)', () => {
  let directory
  let previousDataDir
  let storage
  let repository
  let storageModule

  beforeEach(async () => {
    await closeSqliteStorage()
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-session-lifecycle-'))
    process.env.QUICKFORGE_DATA_DIR = directory
    storage = await initializeSqliteStorage({ dataDir: directory })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
    const testId = `${Date.now()}-${Math.random()}`
    storageModule = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
  })

  afterEach(async () => {
    configureSessionStateService({ repository: null })
    stopSessionStateService()
    await closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(directory, { recursive: true, force: true })
  })

  it('wires the startup chain: service init → empty-store JSON import activates the facade', async () => {
    await storageModule.ensureStorage()
    const { dir, state } = seedJsonSession(directory, 'one')
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'one.json'), `${JSON.stringify(state)}\n`, 'utf8')
    const globalDir = path.join(directory, 'storage', 'conversations', 'global')
    await writeFile(path.join(globalDir, 'sessions-metadata.json'), `${JSON.stringify({
      one: { id: 'one', scope: 'global', stateVersion: 1, title: 'Session one', createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z', messageCount: 1 },
    })}\n`, 'utf8')

    const serviceState = initializeSessionStateService()
    expect(serviceState).toMatchObject({ phase: 'authoritative', stateCount: 0 })
    const logger = { info: vi.fn(), warn: vi.fn() }
    const result = await importSessionStateFromJson({ storage: storageModule, logger })
    expect(result).toMatchObject({ imported: 1, skipped: 0 })
    expect(logger.info).toHaveBeenCalled()

    // The storage facade reads the imported session from SQLite, not JSON.
    expect(await storageModule.isSessionStateAuthoritative()).toBe(true)
    const sessions = await storageModule.readStore('sessions')
    expect(sessions.one).toMatchObject({ id: 'one', title: 'Session one' })
    expect((await storageModule.readStore('sessions-metadata')).one).toMatchObject({ messageCount: 1 })
    expect(readSessionStorageState().stateCount).toBe(1)
    expect(isSessionStateMaintenanceActive(storage)).toBe(false)
  })

  it('re-import is a no-op for live SQLite data that has no JSON counterpart', async () => {
    await storageModule.ensureStorage()
    repository.save({
      scope: 'global',
      sessionId: 'live',
      stateVersion: 1,
      state: { id: 'live', scope: 'global', stateVersion: 1, title: 'Live', messages: [] },
      metadata: { id: 'live', scope: 'global', stateVersion: 1, title: 'Live', messageCount: 0 },
    }, { expectedRevision: 0 })

    // No JSON session files exist: the importer walks the (empty) physical
    // tree and changes nothing. This is the same predicate server/index.mjs
    // uses on the populated-store fast path (count > 0 → never import).
    const result = await importSessionStateFromJson({ storage: storageModule, logger: { info: () => {}, warn: () => {} } })
    expect(result.imported).toBe(0)
    expect(repository.findBySessionId('live').state.title).toBe('Live')
    expect(repository.count()).toBe(1)
  })

  it('is idempotent and can be re-run after any interruption', async () => {
    await storageModule.ensureStorage()
    const { dir, state } = seedJsonSession(directory, 'one')
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'one.json'), `${JSON.stringify(state)}\n`, 'utf8')

    const first = await importSessionStateFromJson({ storage: storageModule, logger: { info: () => {}, warn: () => {} } })
    expect(first.imported).toBe(1)
    const second = await importSessionStateFromJson({ storage: storageModule, logger: { info: () => {}, warn: () => {} } })
    expect(second.imported).toBe(1)
    expect(repository.count()).toBe(1)
    expect(repository.messageCount({ scope: 'global', sessionId: 'one' })).toBe(1)
  })

  it('reports the authoritative phase throughout and shuts down cleanly', async () => {
    initializeSessionStateService()
    expect(readSessionStorageState()).toMatchObject({ phase: 'authoritative' })
    stopSessionStateService()
    await closeSqliteStorage()
    storage = await initializeSqliteStorage({ dataDir: directory })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
    expect(repository.count()).toBe(0)
  })
})
