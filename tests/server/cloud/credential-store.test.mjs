import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCloudCredentialStore } from '../../../server/cloud/credential-store.mjs'

let directory
let filePath

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-cloud-store-'))
  filePath = path.join(directory, 'security', 'cloud-identity.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('cloud credential store', () => {
  it('creates an Ed25519 installation identity and exposes only a safe summary', async () => {
    const store = createCloudCredentialStore({
      filePath,
      ensureBaseStorage: async () => {},
      installationName: 'Test Workstation',
      platform: 'linux',
      clientVersion: '1.2.3',
    })
    const record = await store.ensureInstallation()
    expect(record.publicKey).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(record.privateKeyPkcs8).toMatch(/^[A-Za-z0-9_-]+$/)

    await store.update((current) => ({ ...current, refreshToken: 'refresh-secret', pendingRegistrationKey: 'pending-secret' }))
    const publicStatus = await store.readPublic()
    expect(publicStatus.hasInstallationKey).toBe(true)
    expect(publicStatus).not.toHaveProperty('refreshToken')
    expect(publicStatus).not.toHaveProperty('privateKeyPkcs8')
    expect(publicStatus).not.toHaveProperty('pendingRegistrationKey')
    expect(publicStatus).not.toHaveProperty('filePath')

    const disk = JSON.parse(await readFile(filePath, 'utf8'))
    expect(disk.refreshToken).toBe('refresh-secret')
    expect(disk.privateKeyPkcs8).toBeTruthy()
    if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('clears the cloud session but keeps the installation keypair', async () => {
    const store = createCloudCredentialStore({ filePath, ensureBaseStorage: async () => {} })
    const initial = await store.ensureInstallation()
    await store.update((record) => ({ ...record, mode: 'guest', installationId: 'i-1', refreshToken: 'secret' }))
    const cleared = await store.clearSession()
    expect(cleared.mode).toBe('local')
    expect(cleared.refreshToken).toBeUndefined()
    expect(cleared.publicKey).toBe(initial.publicKey)
    expect(cleared.privateKeyPkcs8).toBe(initial.privateKeyPkcs8)
  })

  it('rotates the installation keypair before a new guest registration', async () => {
    const store = createCloudCredentialStore({ filePath, ensureBaseStorage: async () => {} })
    const initial = await store.ensureInstallation()
    await store.clearSession({ rotateInstallationBeforeRegistration: true })
    expect((await store.read()).rotateInstallationBeforeRegistration).toBe(true)
    const rotated = await store.rotateInstallation()
    expect(rotated.publicKey).not.toBe(initial.publicKey)
    expect(rotated.privateKeyPkcs8).not.toBe(initial.privateKeyPkcs8)
    expect(rotated.rotateInstallationBeforeRegistration).toBeUndefined()
  })
})
