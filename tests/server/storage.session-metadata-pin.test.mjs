import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-pin-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  try {
    const storageUrl = new URL(`../../server/storage.mjs?test=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    await testFn(storage)
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

const PINNED_AT = '2024-01-01T00:00:00.000Z'

// Regression coverage for the bug where a session's pinnedAt disappeared after
// refresh: the client pin toggle (PUT -> atomicUpdate('sessions-metadata')) and
// persistSession (atomicSessionMetadataUpdate) used separate write queues, so
// they could run concurrently and clobber each other. persistSession rebuilds
// metadata without pinnedAt, so when it won the race it dropped pinnedAt.
describe('sessions-metadata write serialization (pin vs persist)', () => {
  it('keeps pinnedAt when a persist rebuild follows a pin (sequential)', async () => {
    await withTempStorage(async ({ ensureStorage, atomicUpdate, atomicSessionMetadataUpdate, readStore }) => {
      await ensureStorage()
      const sessionId = 's1'

      // Existing session record on disk.
      await atomicUpdate('sessions-metadata', (data) => {
        data[sessionId] = { id: sessionId, title: 't', messageCount: 5 }
        return data
      })
      // User pins the session (client -> full-store read-modify-write).
      await atomicUpdate('sessions-metadata', (data) => {
        data[sessionId] = { ...data[sessionId], pinnedAt: PINNED_AT }
        return data
      })
      // A run persists the session: scoped rebuild that omits pinnedAt and only
      // keeps it by merging onto the record it read (post-fix behaviour).
      await atomicSessionMetadataUpdate('global', null, (data) => {
        const existing = data[sessionId]
        data[sessionId] = { ...existing, id: sessionId, title: 't', messageCount: 9 }
        return data
      })

      const final = await readStore('sessions-metadata')
      expect(final[sessionId]?.pinnedAt).toBe(PINNED_AT)
    })
  })

  // Concurrent variant: before the fix the two writes used independent queues
  // and the persist rebuild (which drops pinnedAt unless it read it back) could
  // land after the pin write, erasing pinnedAt. With a shared queue the writes
  // are serialized, so pinnedAt always survives.
  it('does not drop pinnedAt when pin and persist race (concurrent)', async () => {
    await withTempStorage(async ({ ensureStorage, atomicUpdate, atomicSessionMetadataUpdate, readStore }) => {
      await ensureStorage()
      const sessionId = 's1'

      await atomicUpdate('sessions-metadata', (data) => {
        data[sessionId] = { id: sessionId, title: 't', messageCount: 1 }
        return data
      })

      for (let i = 0; i < 30; i += 1) {
        await Promise.all([
          atomicUpdate('sessions-metadata', (data) => {
            data[sessionId] = { ...data[sessionId], pinnedAt: PINNED_AT }
            return data
          }),
          atomicSessionMetadataUpdate('global', null, (data) => {
            const existing = data[sessionId]
            data[sessionId] = { ...existing, id: sessionId, title: 't', messageCount: 2 + i }
            return data
          }),
        ])
      }

      const final = await readStore('sessions-metadata')
      expect(final[sessionId]?.pinnedAt).toBe(PINNED_AT)
    })
  })
})
