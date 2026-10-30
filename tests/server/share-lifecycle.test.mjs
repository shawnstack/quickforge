import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The startup order exercised by server/index.mjs is now a single SQLite path:
//   initializeSqliteStorage → initializeShareService → recoverShareRestorePlan
// There is no JSON→SQLite cutover and no mirror drain any more, so the share
// store is usable immediately after the repository is wired. Storage-dependent
// modules pin storageDir at module evaluation, so every module must be imported
// from one fresh graph after QUICKFORGE_DATA_DIR is set.

let sequence = 0
function shareId() {
  sequence += 1
  return `qfs_${String(sequence).padStart(18, '0')}`
}

function record(overrides = {}) {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id || shareId(),
    sessionId: overrides.sessionId || 'session-one',
    permission: overrides.permission || 'read',
    titleSnapshot: overrides.titleSnapshot || 'Shared session',
    scope: overrides.scope || 'global',
    projectId: overrides.scope === 'project' ? overrides.projectId || 'project-a' : undefined,
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    tokens: overrides.tokens === undefined ? [] : overrides.tokens,
    ...overrides,
  }
}

describe('share lifecycle (startup wiring, single store path, shutdown)', () => {
  let directory
  let previousDataDir
  let storage
  let repository
  let service
  let backup
  let shareStore
  let databaseModule
  let repositoryModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-lifecycle-'))
    process.env.QUICKFORGE_DATA_DIR = directory
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    repositoryModule = await import('../../server/sqlite/share-repository.mjs')
    storage = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = repositoryModule.createShareRepository(storage)
    service = await import('../../server/share-service.mjs')
    backup = await import('../../server/share-backup.mjs')
    shareStore = await import('../../server/share-store.mjs')
    service.configureShareService({ repository })
  })

  afterEach(async () => {
    await databaseModule.closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(directory, { recursive: true, force: true })
  })

  it('wires the startup chain: service init → restore-plan recovery → share-store writes hit SQLite only', async () => {
    expect(service.initializeShareService()).toMatchObject({ phase: 'authoritative', shareCount: 0 })
    expect(await backup.recoverShareRestorePlan({ planFile: path.join(directory, 'missing-plan.json') })).toBe(false)

    const share = await shareStore.createConversationShare({ sessionId: 'startup-session', permission: 'read', scope: 'global' })
    expect(repository.get(share.id)).toMatchObject({ sessionId: 'startup-session', permission: 'read' })
    expect(service.readShareStorageState().shareCount).toBe(1)

    // The retired JSON store is never created or written again.
    await expect(access(path.join(directory, 'storage', 'shares', 'conversation-shares.json'))).rejects
      .toMatchObject({ code: 'ENOENT' })
  })

  it('rolls an interrupted restore plan forward at startup', async () => {
    const seeded = record({ sessionId: 'planned' })
    await writeFile(path.join(directory, 'restore-plan.json'), `${JSON.stringify({
      version: 1,
      operation: 'share_state_restore',
      status: 'applying',
      createdAt: '2026-01-01T00:00:00.000Z',
      before: { shares: {} },
      target: { shares: { [seeded.id]: seeded } },
      beforeCount: 0,
      beforeDigest: backup.computeShareSnapshotDigest({ shares: {} }),
      targetCount: 1,
      targetDigest: backup.computeShareSnapshotDigest({ shares: { [seeded.id]: seeded } }),
    }, null, 2)}\n`, 'utf8')

    expect(await backup.recoverShareRestorePlan({ planFile: path.join(directory, 'restore-plan.json') })).toBe(true)
    expect(repository.get(seeded.id)).toMatchObject({ sessionId: 'planned' })
    await expect(access(path.join(directory, 'restore-plan.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps shares across a restart and shuts the service down cleanly', async () => {
    const share = await shareStore.createConversationShare({ sessionId: 'restart-session', permission: 'read', scope: 'global' })
    await databaseModule.closeSqliteStorage()

    storage = await databaseModule.initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = repositoryModule.createShareRepository(storage)
    service.configureShareService({ repository })
    expect(await shareStore.readConversationShare(share.id)).toMatchObject({ sessionId: 'restart-session' })
    expect(service.initializeShareService().shareCount).toBe(1)

    service.stopShareService()
    await databaseModule.closeSqliteStorage()
  })
})
