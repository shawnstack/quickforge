import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-auto-archive-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  try {
    const testId = `${Date.now()}-${Math.random()}`
    const storage = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
    const autoArchive = await import(/* @vite-ignore */ new URL(`../../server/auto-archive.mjs?test=${testId}`, import.meta.url).href)
    await testFn(storage, autoArchive)
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function daysAgo(now, days) {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString()
}

async function seedSession(storage, metadata, session = metadata) {
  await storage.writeSessionValue(metadata.id, { ...session })
  await storage.atomicUpdate('sessions-metadata', (data) => {
    data[metadata.id] = { ...metadata }
    return data
  })
}

describe('automatic conversation archive', () => {
  it('does nothing while disabled', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await seedSession(storage, {
        id: 'old',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 40),
        lastModified: daysAgo(now, 40),
      })

      await expect(archiveInactiveSessions({ now, storage })).resolves.toMatchObject({ archivedCount: 0, disabled: true })
      expect((await storage.readStore('sessions-metadata')).old.archivedAt).toBeUndefined()
    })
  })

  it('archives only inactive non-empty idle conversations and preserves metadata', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await storage.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: true }
        return data
      })
      await seedSession(storage, {
        id: 'old',
        scope: 'global',
        messageCount: 3,
        createdAt: daysAgo(now, 50),
        lastModified: daysAgo(now, 31),
        pinnedAt: '2025-01-01T00:00:00.000Z',
      })
      await seedSession(storage, {
        id: 'recent',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 20),
        lastModified: daysAgo(now, 20),
      })
      await seedSession(storage, {
        id: 'running',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 40),
        lastModified: daysAgo(now, 40),
        taskStatus: 'running',
      })
      await seedSession(storage, {
        id: 'empty',
        scope: 'global',
        messageCount: 0,
        createdAt: daysAgo(now, 40),
        lastModified: daysAgo(now, 40),
      })

      const result = await archiveInactiveSessions({ now, storage })
      expect(result).toMatchObject({ archivedCount: 1, archivedSessionIds: ['old'] })
      const metadata = await storage.readStore('sessions-metadata')
      expect(metadata.old.archivedAt).toBe(new Date(now).toISOString())
      expect(metadata.old.pinnedAt).toBe('2025-01-01T00:00:00.000Z')
      expect(metadata.recent.archivedAt).toBeUndefined()
      expect(metadata.running.archivedAt).toBeUndefined()
      expect(metadata.empty.archivedAt).toBeUndefined()
      expect((await storage.readSessionValue('old')).archivedAt).toBe(new Date(now).toISOString())
    })
  })

  it('uses the newest activity from metadata, session data, and message timestamps', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await storage.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: true }
        return data
      })
      await seedSession(storage, {
        id: 'recent-session',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
      }, {
        id: 'recent-session',
        scope: 'global',
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 5),
        messages: [],
      })
      await seedSession(storage, {
        id: 'recent-message',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
      }, {
        id: 'recent-message',
        scope: 'global',
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
        messages: [{ role: 'user', timestamp: now - 2 * 24 * 60 * 60 * 1000 }],
      })
      await seedSession(storage, {
        id: 'recent-metadata',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 2),
      }, {
        id: 'recent-metadata',
        scope: 'global',
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
        messages: [],
      })

      await expect(archiveInactiveSessions({ now, storage })).resolves.toMatchObject({ archivedCount: 0 })
      const metadata = await storage.readStore('sessions-metadata')
      expect(metadata['recent-session'].archivedAt).toBeUndefined()
      expect(metadata['recent-message'].archivedAt).toBeUndefined()
      expect(metadata['recent-metadata'].archivedAt).toBeUndefined()
    })
  })

  it('keeps session and metadata unarchived when metadata becomes recent during the final check', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await storage.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: true }
        return data
      })
      await seedSession(storage, {
        id: 'race',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
      }, {
        id: 'race',
        scope: 'global',
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
        messages: [],
      })

      let metadataUpdates = 0
      const wrappedStorage = {
        ...storage,
        atomicUpdate: async (storeName, updateFn) => {
          if (storeName === 'sessions-metadata' && metadataUpdates++ === 0) {
            await storage.atomicUpdate(storeName, (data) => {
              data.race = { ...data.race, lastModified: daysAgo(now, 1) }
              return data
            })
          }
          return storage.atomicUpdate(storeName, updateFn)
        },
      }

      await expect(archiveInactiveSessions({ now, storage: wrappedStorage })).resolves.toMatchObject({ archivedCount: 0 })
      expect((await storage.readStore('sessions-metadata')).race.archivedAt).toBeUndefined()
      expect((await storage.readSessionValue('race')).archivedAt).toBeUndefined()
    })
  })

  it('falls back to createdAt, skips invalid dates, and does not restore existing archives when disabled', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await storage.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: true }
        return data
      })
      await seedSession(storage, {
        id: 'fallback',
        scope: 'global',
        messageCount: 1,
        createdAt: daysAgo(now, 35),
      })
      await seedSession(storage, {
        id: 'invalid',
        scope: 'global',
        messageCount: 1,
        createdAt: 'not-a-date',
      })
      await seedSession(storage, {
        id: 'archived',
        scope: 'global',
        messageCount: 1,
        createdAt: daysAgo(now, 60),
        archivedAt: '2025-12-01T00:00:00.000Z',
      })

      await archiveInactiveSessions({ now, storage })
      let metadata = await storage.readStore('sessions-metadata')
      expect(metadata.fallback.archivedAt).toBe(new Date(now).toISOString())
      expect(metadata.invalid.archivedAt).toBeUndefined()
      expect(metadata.archived.archivedAt).toBe('2025-12-01T00:00:00.000Z')

      await storage.atomicUpdate('settings', (data) => {
        data['auto-archive-settings'] = { enabled: false }
        return data
      })
      await archiveInactiveSessions({ now: now + 24 * 60 * 60 * 1000, storage })
      metadata = await storage.readStore('sessions-metadata')
      expect(metadata.fallback.archivedAt).toBe(new Date(now).toISOString())
      expect(metadata.archived.archivedAt).toBe('2025-12-01T00:00:00.000Z')
    })
  })
})
