import { afterEach, describe, expect, it } from 'vitest'
import {
  MAINTENANCE_API_WHITELIST,
  STARTUP_RECOVERY_GUIDANCE,
  STARTUP_STATES,
  getStartupError,
  getStartupState,
  resetStartupState,
  resolveMaintenanceGate,
  setStartupState,
  withStartupRecoveryGuidance,
} from '../../server/startup-state.mjs'

describe('startup state machine', () => {
  afterEach(() => {
    resetStartupState()
  })

  it('starts in starting at module evaluation and tracks ready/failed transitions', () => {
    expect(getStartupState()).toBe(STARTUP_STATES.STARTING)

    setStartupState(STARTUP_STATES.READY)
    expect(getStartupState()).toBe(STARTUP_STATES.READY)
    expect(getStartupError()).toBeNull()

    setStartupState(STARTUP_STATES.FAILED, 'integrity failure')
    expect(getStartupState()).toBe(STARTUP_STATES.FAILED)
    expect(getStartupError()).toBe('integrity failure')

    setStartupState(STARTUP_STATES.FAILED)
    expect(getStartupError()).toBe('Startup failed')

    resetStartupState()
    expect(getStartupState()).toBe(STARTUP_STATES.STARTING)
    expect(getStartupError()).toBeNull()
  })

  it('clears the error when leaving the failed state', () => {
    setStartupState(STARTUP_STATES.FAILED, 'boom')
    setStartupState(STARTUP_STATES.STARTING)
    expect(getStartupError()).toBeNull()
  })

  it('rejects unknown states', () => {
    expect(() => setStartupState('migrating')).toThrow(TypeError)
  })
})

describe('startup recovery guidance', () => {
  it('keeps the original error text and appends safe domain-neutral recovery steps', () => {
    const message = withStartupRecoveryGuidance('integrity failure')
    expect(message.startsWith('integrity failure')).toBe(true)
    expect(message).toContain('Stop all QuickForge processes')
    expect(message).toContain('complete copy of the entire QuickForge dataDir')
    expect(message).toContain('SQLite database and any -wal/-shm files')
    expect(message).toContain('server logs')
    expect(message).toContain('failing storage domain')
    expect(message).toContain('do not delete the database')
    expect(message).not.toContain('/api/migration-status')
    expect(message).not.toContain('downgrade-session-state-v1.mjs')
    expect(message).not.toContain('export-session-state-v1.mjs')
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

  it('only allows the whitelisted GET endpoint while starting', () => {
    setStartupState(STARTUP_STATES.STARTING)
    for (const pathname of MAINTENANCE_API_WHITELIST) {
      expect(resolveMaintenanceGate('GET', pathname)).toBeNull()
    }
    expect(MAINTENANCE_API_WHITELIST).toEqual(['/api/health'])
    expect(resolveMaintenanceGate('POST', '/api/health')).toEqual({ status: 503, state: STARTUP_STATES.STARTING })
    expect(resolveMaintenanceGate('GET', '/api/agents')).toEqual({ status: 503, state: STARTUP_STATES.STARTING })
    expect(resolveMaintenanceGate('GET', '/api/shares')).toEqual({ status: 503, state: STARTUP_STATES.STARTING })
  })

  it('keeps the same gate once the startup chain failed', () => {
    setStartupState(STARTUP_STATES.FAILED, 'boom')
    expect(resolveMaintenanceGate('GET', '/api/health')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/api/storage/sessions')).toEqual({ status: 503, state: STARTUP_STATES.FAILED })
  })

  it('never gates non-API paths so static assets and /share/ stay reachable', () => {
    setStartupState(STARTUP_STATES.STARTING)
    expect(resolveMaintenanceGate('GET', '/')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/share/qfs_123')).toBeNull()
    expect(resolveMaintenanceGate('GET', '/assets/index.js')).toBeNull()
  })
})
