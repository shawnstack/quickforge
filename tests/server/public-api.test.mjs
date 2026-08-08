import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { getQuickForgeHealthVersion, isQuickForgeHealthCompatible, prepareQuickForgeEnv, buildEnv, stopQuickForge } from '../../server/public-api.mjs'

describe('QuickForge public startup API', () => {
  it('reads health versions from current and legacy payload shapes', () => {
    expect(getQuickForgeHealthVersion({ version: '1.5.5' })).toBe('1.5.5')
    expect(getQuickForgeHealthVersion({ package: { version: '1.5.4' } })).toBe('1.5.4')
    expect(getQuickForgeHealthVersion({ packageInfo: { version: '1.5.3' } })).toBe('1.5.3')
  })

  it('allows existing services by default for SDK compatibility', () => {
    expect(isQuickForgeHealthCompatible({ ok: true, pid: 123 })).toBe(true)
  })

  it('only reuses same-version services when requested', () => {
    expect(isQuickForgeHealthCompatible(
      { ok: true, pid: 123, version: '1.5.5' },
      { reuseExisting: 'same-version', expectedVersion: '1.5.5' },
    )).toBe(true)

    expect(isQuickForgeHealthCompatible(
      { ok: true, pid: 123, version: '1.5.4' },
      { reuseExisting: 'same-version', expectedVersion: '1.5.5' },
    )).toBe(false)
  })

  it('does not reuse existing services when reuseExisting is false', () => {
    expect(isQuickForgeHealthCompatible(
      { ok: true, pid: 123, version: '1.5.5' },
      { reuseExisting: false, expectedVersion: '1.5.5' },
    )).toBe(false)
  })

  it('maps remote agent options into the child and inline environment', () => {
    const env = buildEnv({
      qfAgentPath: 'C:\\runtime\\qf-agent.exe',
      qfAgentIdentityDir: 'C:\\identity',
      qfAgentEnabled: false,
      runtimeKind: 'desktop',
    })
    expect(env.QUICKFORGE_QF_AGENT_PATH).toBe(path.resolve('C:\\runtime\\qf-agent.exe'))
    expect(env.QUICKFORGE_QF_AGENT_IDENTITY_DIR).toBe(path.resolve('C:\\identity'))
    expect(env.QUICKFORGE_QF_AGENT_ENABLED).toBe('0')
    expect(env.QUICKFORGE_RUNTIME_KIND).toBe('desktop')
  })

  it('prefers an instance stop method and never stops reused services', async () => {
    const stop = vi.fn(async () => true)
    await expect(stopQuickForge({ reused: false, stop })).resolves.toBe(true)
    expect(stop).toHaveBeenCalledTimes(1)
    await expect(stopQuickForge({ reused: true, stop })).resolves.toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('prepares inline runtime environment without requiring system node/npm/qf', () => {
    const previousHost = process.env.QUICKFORGE_HOST
    const previousPort = process.env.QUICKFORGE_PORT
    const previousNoOpen = process.env.QUICKFORGE_NO_OPEN
    const previousElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE
    const previousAtomRunAsNode = process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE

    try {
      process.env.ELECTRON_RUN_AS_NODE = '1'
      process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE = '1'
      prepareQuickForgeEnv({ host: '127.0.0.1', port: 61234, openBrowser: false })
      expect(process.env.QUICKFORGE_HOST).toBe('127.0.0.1')
      expect(process.env.QUICKFORGE_PORT).toBe('61234')
      expect(process.env.QUICKFORGE_NO_OPEN).toBe('1')
      expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE).toBeUndefined()
    } finally {
      if (previousHost === undefined) delete process.env.QUICKFORGE_HOST
      else process.env.QUICKFORGE_HOST = previousHost
      if (previousPort === undefined) delete process.env.QUICKFORGE_PORT
      else process.env.QUICKFORGE_PORT = previousPort
      if (previousNoOpen === undefined) delete process.env.QUICKFORGE_NO_OPEN
      else process.env.QUICKFORGE_NO_OPEN = previousNoOpen
      if (previousElectronRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE
      else process.env.ELECTRON_RUN_AS_NODE = previousElectronRunAsNode
      if (previousAtomRunAsNode === undefined) delete process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE
      else process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE = previousAtomRunAsNode
    }
  })
})
