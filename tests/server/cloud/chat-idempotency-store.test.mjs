import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let directory
let storeDirectory

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-cloud-chat-idempotency-'))
  storeDirectory = path.join(directory, 'security', 'cloud-chat-idempotency')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('cloud chat idempotency store', () => {
  it('persists the key across store instances and separates logical messages', async () => {
    const { createCloudChatIdempotencyStore } = await import('../../../server/cloud/chat-idempotency-store.mjs')
    const firstStore = createCloudChatIdempotencyStore({ directory: storeDirectory, ensureBaseStorage: async () => {} })
    const firstKey = await firstStore.ensure('session-1', 'qfcm-message-1')
    const repeatedKey = await firstStore.ensure('session-1', 'qfcm-message-1')
    const secondMessageKey = await firstStore.ensure('session-1', 'qfcm-message-2')

    const restartedStore = createCloudChatIdempotencyStore({ directory: storeDirectory, ensureBaseStorage: async () => {} })
    const restoredKey = await restartedStore.ensure('session-1', 'qfcm-message-1')

    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(repeatedKey).toBe(firstKey)
    expect(restoredKey).toBe(firstKey)
    expect(secondMessageKey).not.toBe(firstKey)
  })

  it('removes private keys when the session is deleted', async () => {
    const { createCloudChatIdempotencyStore } = await import('../../../server/cloud/chat-idempotency-store.mjs')
    const store = createCloudChatIdempotencyStore({ directory: storeDirectory, ensureBaseStorage: async () => {} })
    const originalKey = await store.ensure('session-1', 'qfcm-message-1')
    await store.removeSession('session-1')
    const replacementKey = await store.ensure('session-1', 'qfcm-message-1')

    expect(replacementKey).not.toBe(originalKey)
  })
})
