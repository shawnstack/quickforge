import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-share-store-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tmpDir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('conversation share lifecycle', () => {
  it('disables, restores and permanently deletes a share while invalidating old tokens', async () => {
    const store = await import('../../server/share-store.mjs')
    const share = await store.createConversationShare({
      sessionId: 'session-one',
      permission: 'read',
      titleSnapshot: 'Share lifecycle',
      scope: 'global',
    })
    const firstToken = await store.issueConversationShareToken(share.id)
    expect(store.verifyShareToken(await store.readConversationShare(share.id), firstToken.token)).toBe(true)

    const invalidations = []
    const removeListener = store.onConversationShareInvalidated((event) => invalidations.push(event))
    const updatedExpiration = await store.updateConversationShareExpiration(share.id, new Date(Date.now() + 120_000).toISOString())
    expect(updatedExpiration.expiresAt).toBeTruthy()
    expect(invalidations).toContainEqual({ shareId: share.id, reason: 'updated' })

    const disabled = await store.revokeConversationShare(share.id)
    expect(disabled.revokedAt).toBeTruthy()
    const disabledRecord = await store.readConversationShare(share.id)
    expect(() => store.assertShareActive(disabledRecord)).toThrow()
    expect(store.verifyShareToken(disabledRecord, firstToken.token)).toBe(false)
    expect(invalidations).toContainEqual({ shareId: share.id, reason: 'revoked' })

    const restored = await store.restoreConversationShare(share.id, new Date(Date.now() + 60_000).toISOString())
    expect(restored.revokedAt).toBeUndefined()
    const restoredRecord = await store.readConversationShare(share.id)
    expect(() => store.assertShareActive(restoredRecord)).not.toThrow()
    expect(store.verifyShareToken(restoredRecord, firstToken.token)).toBe(false)

    await store.deleteConversationShare(share.id)
    expect(await store.readConversationShare(share.id)).toBeNull()
    expect(invalidations).toContainEqual({ shareId: share.id, reason: 'deleted' })
    removeListener()
  })

  it('rejects restore expiration times that are not in the future', async () => {
    const store = await import('../../server/share-store.mjs')
    const share = await store.createConversationShare({
      sessionId: 'session-two',
      permission: 'read',
      titleSnapshot: 'Expired share',
      scope: 'global',
    })
    await store.revokeConversationShare(share.id)

    await expect(store.restoreConversationShare(share.id, new Date(Date.now() - 1000).toISOString()))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('updates permission and password while invalidating previous tokens', async () => {
    const store = await import('../../server/share-store.mjs')
    const share = await store.createConversationShare({
      sessionId: 'session-three',
      permission: 'read',
      titleSnapshot: 'Update test',
      scope: 'global',
    })
    const token = await store.issueConversationShareToken(share.id)
    const invalidations = []
    const removeListener = store.onConversationShareInvalidated((event) => invalidations.push(event))

    const updated = await store.updateConversationShare(share.id, {
      permission: 'operate',
      password: 'secret123',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(updated.permission).toBe('operate')
    expect(updated.hasPassword).toBe(true)
    expect(invalidations).toContainEqual({ shareId: share.id, reason: 'updated' })
    const updatedRecord = await store.readConversationShare(share.id)
    expect(store.verifyShareToken(updatedRecord, token.token)).toBe(false)

    await expect(store.updateConversationShare(share.id, { permission: 'operate', password: '' }))
      .rejects.toMatchObject({ statusCode: 400 })

    const passwordless = await store.updateConversationShare(share.id, { permission: 'read', password: '' })
    expect(passwordless.hasPassword).toBe(false)

    const kept = await store.updateConversationShare(share.id, { permission: 'read' })
    expect(kept.hasPassword).toBe(false)
    expect(kept.permission).toBe('read')
    removeListener()
  })
})
