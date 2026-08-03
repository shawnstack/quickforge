import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-lan-access-store-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tmpDir, { recursive: true, force: true })
})

describe('LAN access store sessions', () => {
  it('lists session metadata and revokes one session by public id', async () => {
    const store = await import('../../server/lan-access-store.mjs')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })

    const first = await store.issueLanAccessToken('password123', {
      remoteAddress: '::ffff:192.168.1.20',
      userAgent: 'Test Browser One',
    })
    const second = await store.issueLanAccessToken('password123', {
      remoteAddress: '192.168.1.21',
      userAgent: 'Test Browser Two',
    })

    const status = await store.readLanAccessStatus()
    expect(status.activeTokenCount).toBe(2)
    expect(status.activeDevices).toHaveLength(2)
    expect(status.activeDevices[0]).toMatchObject({
      address: '192.168.1.20',
      userAgent: 'Test Browser One',
    })
    expect(status.activeDevices[0].id).toBeTruthy()
    expect(status.activeDevices[0]).not.toHaveProperty('tokenHash')

    const updated = await store.revokeLanAccessTokenById(status.activeDevices[0].id)
    expect(updated.activeTokenCount).toBe(1)
    await expect(store.verifyLanAccessToken(first.token)).resolves.toBe(false)
    await expect(store.verifyLanAccessToken(second.token)).resolves.toBe(true)
  })

  it('revokes the current session from its cookie token', async () => {
    const store = await import('../../server/lan-access-store.mjs')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const session = await store.issueLanAccessToken('password123')

    await expect(store.revokeLanAccessToken(session.token)).resolves.toBe(true)
    await expect(store.verifyLanAccessToken(session.token)).resolves.toBe(false)
    await expect(store.readLanAccessStatus()).resolves.toMatchObject({ activeTokenCount: 0, activeDevices: [] })
  })
})
