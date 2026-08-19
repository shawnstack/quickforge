import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { initializeScheduledRunsCutover } from '../../server/scheduled-runs-cutover.mjs'
import {
  MAINTENANCE_API_WHITELIST,
  STARTUP_RECOVERY_GUIDANCE,
  STARTUP_STATES,
  getStartupError,
  getStartupState,
  readMigrationStatus,
  resetStartupState,
  resolveMaintenanceGate,
  setStartupState,
  withStartupRecoveryGuidance,
} from '../../server/startup-state.mjs'

describe('startup maintenance state machine', () => {
  afterEach(() => {
    resetStartupState()
  })

  it('starts in migrating at module evaluation and tracks ready/failed transitions', () => {
    expect(getStartupState()).toBe(STARTUP_STATES.MIGRATING)

    setStartupState(STARTUP_STATES.READY)
    expect(getStartupState()).toBe(STARTUP_STATES.READY)
    expect(getStartupError()).toBeNull()

    setStartupState(STARTUP_STATES.FAILED, 'cutover integrity failure')
    expect(getStartupState()).toBe(STARTUP_STATES.FAILED)
    expect(getStartupError()).toBe('cutover integrity failure')

    setStartupState(STARTUP_STATES.FAILED)
    expect(getStartupError()).toBe('Startup failed')

    resetStartupState()
    expect(getStartupState()).toBe(STARTUP_STATES.MIGRATING)
    expect(getStartupError()).toBeNull()
  })

  it('clears the error when leaving the failed state', () => {
    setStartupState(STARTUP_STATES.FAILED, 'boom')
    setStartupState(STARTUP_STATES.MIGRATING)
    expect(getStartupError()).toBeNull()
  })
})

describe('startup recovery guidance', () => {
  it('keeps the original error text and appends actionable recovery steps', () => {
    const message = withStartupRecoveryGuidance('cutover integrity failure')
    expect(message.startsWith('cutover integrity failure')).toBe(true)
    expect(message).toContain('node server/maintenance/downgrade-session-state-v1.mjs --dry-run')
    expect(message).toContain('node server/maintenance/export-session-state-v1.mjs')
    expect(message).toContain('docs/architecture/session-storage-recovery-runbook.zh-CN.md')
    // Multi-line: the original message and the guidance stay separate paragraphs.
    expect(message.split('\n').length).toBeGreaterThan(3)
  })

  it('falls back to a generic prefix when the error message is missing', () => {
    expect(withStartupRecoveryGuidance(null).startsWith('Startup failed')).toBe(true)
    expect(withStartupRecoveryGuidance(undefined)).toContain(STARTUP_RECOVERY_GUIDANCE)
  })
})

describe('startup maintenance gate', () => {
  afterEach(() => {
    resetStartupState()
  })

  it('allows every request once the startup chain completed', () => {
    setStartupState(STARTUP_STATES.READY)
    expect(resolveMaintenanceGate('GET', '/api/agents')).toBeNull()
    expect(resolveMaintenanceGate('POST', '/api/storage/session')).toBeNull()
    expect(resolveMaintenanceGate('POST', '/api/health')).toBeNull()
  })

  it('only allows the whitelisted GET endpoints while migrating', () => {
    setStartupState(STARTUP_STATES.MIGRATING)
    for (const pathname of MAINTENANCE_API_WHITELIST) {
      expect(resolveMaintenanceGate('GET', pathname)).toBeNull()
    }
    expect(resolveMaintenanceGate('POST', '/api/health')).toEqual({ status: 503, state: STARTUP_STATES.MIGRATING })
    expect(resolveMaintenanceGate('GET', '/api/agents')).toEqual({ status: 503, state: STARTUP_STATES.MIGRATING })
    expect(resolveMaintenanceGate('GET', '/api/shares')).toEqual({ status: 503, state: STARTUP_STATES.MIGRATING })
  })

  it('keeps the same gate once the startup chain failed', () => {
    setStartupState(STARTUP_STATES.FAILED, 'boom')
    expect(resolveMaintenanceGate('GET', '/api/health')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/api/migration-status')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/api/storage/sessions')).toEqual({ status: 503, state: STARTUP_STATES.FAILED })
  })

  it('never gates non-API paths so static assets and /share/ stay reachable', () => {
    setStartupState(STARTUP_STATES.MIGRATING)
    expect(resolveMaintenanceGate('GET', '/')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/share/qfs_123')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/assets/index.js')).toBeNull()
  })
})

describe('readMigrationStatus', () => {
  let directory
  let storage

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-startup-maintenance-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'quickforge.sqlite3') })
  })

  afterEach(async () => {
    resetStartupState()
    await closeSqliteStorage()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('reports the four domain phases created by the SQLite migrations', () => {
    const status = readMigrationStatus(storage)

    expect(status.ok).toBe(true)
    expect(status.state).toBe(STARTUP_STATES.MIGRATING)
    expect(Object.keys(status.domains).sort()).toEqual(['lanAccess', 'scheduledRuns', 'sessionState', 'share'])
    expect(status.domains.scheduledRuns.phase).toBe('hybrid')
    expect(status.domains.sessionState.phase).toBe('json_authoritative')
    expect(status.domains.share.phase).toBe('json_authoritative')
    expect(status.domains.lanAccess.phase).toBe('json_authoritative')
    for (const domain of Object.values(status.domains)) {
      expect(domain.updatedAt).toBeTruthy()
    }
  })

  it('degrades a domain to phase unknown instead of failing the whole endpoint', async () => {
    // Close SQLite: every domain read now throws and must surface as unknown.
    await closeSqliteStorage()
    const status = readMigrationStatus()

    expect(status.ok).toBe(true)
    expect(Object.keys(status.domains).sort()).toEqual(['lanAccess', 'scheduledRuns', 'sessionState', 'share'])
    for (const domain of Object.values(status.domains)) {
      expect(domain.phase).toBe('unknown')
      expect(typeof domain.error).toBe('string')
    }
  })

  it('passes through the live scheduled-runs phase after the cutover ran', async () => {
    const repository = createScheduledTaskRunsRepository(storage)
    const finalState = await initializeScheduledRunsCutover({
      storage,
      repository,
      backupDirectory: path.join(directory, 'backups'),
      readTasks: vi.fn(async () => ({})),
      writeTasks: vi.fn(async () => {}),
      logger: { warn: vi.fn() },
    })
    expect(finalState.phase).not.toBe('unknown')

    const status = readMigrationStatus()
    expect(status.domains.scheduledRuns.phase).toBe(finalState.phase)
    expect(status.domains.scheduledRuns.runCount).toBe(finalState.runCount)
    expect(status.domains.scheduledRuns.updatedAt).toBeTruthy()
  })

  it('exposes startupError only in the failed state', () => {
    setStartupState(STARTUP_STATES.MIGRATING)
    expect(readMigrationStatus(storage)).not.toHaveProperty('startupError')

    setStartupState(STARTUP_STATES.FAILED, 'integrity failure')
    const status = readMigrationStatus(storage)
    expect(status.state).toBe(STARTUP_STATES.FAILED)
    expect(status.startupError).toBe('integrity failure')
    expect(status.ok).toBe(true)
  })
})
