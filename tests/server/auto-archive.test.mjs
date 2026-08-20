import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-auto-archive-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  const database = await import('../../server/sqlite/database.mjs')
  try {
    await database.closeSqliteStorage().catch(() => {})
    await database.initializeSqliteStorage()
    const testId = `${Date.now()}-${Math.random()}`
    const storage = await import(/* @vite-ignore */ new URL(`../../server/storage.mjs?test=${testId}`, import.meta.url).href)
    const autoArchive = await import(/* @vite-ignore */ new URL(`../../server/auto-archive.mjs?test=${testId}`, import.meta.url).href)
    const service = await import('../../server/session-state-service.mjs')
    await testFn(storage, autoArchive, service)
  } finally {
    await database.closeSqliteStorage().catch(() => {})
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

// Wrap storage so tests can assert whether the scan/archiver loaded session
// bodies at all (metadata-first scanning should avoid body reads).
function withReadSessionValueCounter(storage) {
  let readSessionValueCalls = 0
  const wrapped = {
    ...storage,
    readSessionValue: async (...args) => {
      readSessionValueCalls += 1
      return storage.readSessionValue(...args)
    },
  }
  return { storage: wrapped, getReadSessionValueCalls: () => readSessionValueCalls }
}

// Give genuine (unfaked) file I/O a few event-loop turns to settle. Used with
// fake timers that keep setImmediate real.
async function flushRealEventLoop(turns = 30) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

// Real-timer sleep usable while fake timers own globalThis.setTimeout
// (captured at import time, before any vi.useFakeTimers call).
const realSetTimeout = globalThis.setTimeout
const sleepReal = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms))

// Poll an async condition on a real wall-clock cadence: the archive runs
// fire-and-forget with sequential file I/O, so pure setImmediate spinning can
// exhaust before real I/O progresses.
async function waitForRealCondition(condition, { attempts = 200, intervalMs = 5 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (await condition()) return true
    await sleepReal(intervalMs)
  }
  return condition()
}

async function enableAutoArchive(storage) {
  await storage.atomicUpdate('settings', (data) => {
    data['auto-archive-settings'] = { enabled: true }
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
        lastModified: daysAgo(now, 40),
        // Storage v2: metadata owns the lastModified projection onto the body,
        // so a fresher body timestamp cannot survive a stale metadata write.
        // A recent message timestamp is the body-owned freshness signal.
        messages: [{ role: 'user', timestamp: now - 5 * 24 * 60 * 60 * 1000 }],
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
        // The archive's in-transaction re-check: bump the metadata to fresh
        // before the authoritative record update reads it, so the re-check
        // rejects the candidate.
        atomicSessionRecordUpdate: async (sessionId, updateFn, ...rest) => {
          metadataUpdates += 1
          await storage.atomicUpdate('sessions-metadata', (data) => {
            data.race = { ...data.race, lastModified: daysAgo(now, 1) }
            return data
          })
          return storage.atomicSessionRecordUpdate(sessionId, updateFn, ...rest)
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

  it('skips metadata-fresh sessions without loading session bodies', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await enableAutoArchive(storage)
      await seedSession(storage, {
        id: 'fresh',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 5),
      }, {
        id: 'fresh',
        scope: 'global',
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
        messages: [],
      })

      const { storage: wrapped, getReadSessionValueCalls } = withReadSessionValueCounter(storage)
      await expect(archiveInactiveSessions({ now, storage: wrapped })).resolves.toMatchObject({ archivedCount: 0 })
      expect(getReadSessionValueCalls()).toBe(0)
      const metadata = await storage.readStore('sessions-metadata')
      expect(metadata.fresh.archivedAt).toBeUndefined()
      expect((await storage.readSessionValue('fresh')).archivedAt).toBeUndefined()
    })
  })

  it('archives metadata-stale sessions without loading session bodies', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await enableAutoArchive(storage)
      await seedSession(storage, {
        id: 'stale',
        scope: 'global',
        messageCount: 3,
        createdAt: daysAgo(now, 50),
        lastModified: daysAgo(now, 40),
      })

      const { storage: wrapped, getReadSessionValueCalls } = withReadSessionValueCounter(storage)
      await expect(archiveInactiveSessions({ now, storage: wrapped })).resolves.toMatchObject({ archivedCount: 1, archivedSessionIds: ['stale'] })
      expect(getReadSessionValueCalls()).toBe(0)
      expect((await storage.readStore('sessions-metadata')).stale.archivedAt).toBe(new Date(now).toISOString())
      expect((await storage.readSessionValue('stale')).archivedAt).toBe(new Date(now).toISOString())
    })
  })

  it('falls back to the session body only when metadata has no timestamps', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }, service) => {
      const now = Date.UTC(2026, 0, 31)
      await enableAutoArchive(storage)
      // No createdAt/lastModified on metadata: the storage facade always
      // derives them, so timestamp-less metadata is only reachable through a
      // direct repository-shaped save (legacy imports); the scan must then
      // load the body.
      service.saveSessionStatePair({
        state: { id: 'no-timestamps-stale-body', scope: 'global', createdAt: daysAgo(now, 40), messages: [{ role: 'user', content: 'stale' }] },
        metadata: { id: 'no-timestamps-stale-body', scope: 'global', messageCount: 1 },
      })
      service.saveSessionStatePair({
        state: { id: 'no-timestamps-fresh-body', scope: 'global', createdAt: daysAgo(now, 60), lastModified: daysAgo(now, 5), messages: [{ role: 'user', content: 'fresh' }] },
        metadata: { id: 'no-timestamps-fresh-body', scope: 'global', messageCount: 1 },
      })

      const { storage: wrapped, getReadSessionValueCalls } = withReadSessionValueCounter(storage)
      await expect(archiveInactiveSessions({ now, storage: wrapped })).resolves.toMatchObject({ archivedCount: 1, archivedSessionIds: ['no-timestamps-stale-body'] })
      expect(getReadSessionValueCalls()).toBe(2)
      const metadata = await storage.readStore('sessions-metadata')
      expect(metadata['no-timestamps-stale-body'].archivedAt).toBe(new Date(now).toISOString())
      expect(metadata['no-timestamps-fresh-body'].archivedAt).toBeUndefined()
    })
  })

  it('keeps sessions unarchived when the full-state re-check finds the body still active', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await enableAutoArchive(storage)
      // Metadata says stale, the body is fresh: the metadata-first scan turns
      // this into a candidate, and only the in-transaction full-state re-check
      // can reject it.
      await seedSession(storage, {
        id: 'stale-metadata-fresh-body',
        scope: 'global',
        messageCount: 2,
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
      }, {
        id: 'stale-metadata-fresh-body',
        scope: 'global',
        createdAt: daysAgo(now, 60),
        lastModified: daysAgo(now, 40),
        // Metadata owns the lastModified projection onto the body in storage
        // v2, so body freshness that must survive a stale metadata write is
        // expressed through message timestamps.
        messages: [{ role: 'user', timestamp: now - 5 * 24 * 60 * 60 * 1000 }],
      })

      const { storage: wrapped, getReadSessionValueCalls } = withReadSessionValueCounter(storage)
      await expect(archiveInactiveSessions({ now, storage: wrapped })).resolves.toMatchObject({ archivedCount: 0 })
      expect(getReadSessionValueCalls()).toBe(0)
      expect((await storage.readStore('sessions-metadata'))['stale-metadata-fresh-body'].archivedAt).toBeUndefined()
      expect((await storage.readSessionValue('stale-metadata-fresh-body')).archivedAt).toBeUndefined()
    })
  })

  it('archives every candidate in scan order while yielding between commits', async () => {
    await withTempStorage(async (storage, { archiveInactiveSessions }) => {
      const now = Date.UTC(2026, 0, 31)
      await enableAutoArchive(storage)
      for (const id of ['stale-a', 'stale-b', 'stale-c']) {
        await seedSession(storage, {
          id,
          scope: 'global',
          messageCount: 2,
          createdAt: daysAgo(now, 50),
          lastModified: daysAgo(now, 40),
        })
      }

      await expect(archiveInactiveSessions({ now, storage })).resolves.toMatchObject({
        archivedCount: 3,
        archivedSessionIds: ['stale-a', 'stale-b', 'stale-c'],
      })
      const metadata = await storage.readStore('sessions-metadata')
      for (const id of ['stale-a', 'stale-b', 'stale-c']) {
        expect(metadata[id].archivedAt).toBe(new Date(now).toISOString())
        expect((await storage.readSessionValue(id)).archivedAt).toBe(new Date(now).toISOString())
      }
    })
  })

  it('delays the first archive run instead of firing it during startup', async () => {
    await withTempStorage(async (storage, { startAutoArchiveRunner, stopAutoArchiveRunner, AUTO_ARCHIVE_INITIAL_DELAY_MS }) => {
      const seededAt = Date.now()
      await enableAutoArchive(storage)
      await seedSession(storage, {
        id: 'stale',
        scope: 'global',
        messageCount: 3,
        createdAt: daysAgo(seededAt, 40),
        lastModified: daysAgo(seededAt, 40),
      })
      // Let the OS settle on the freshly written files (Windows Defender can
      // hold them briefly, which makes writeJsonAtomic's rename-over fail).
      await sleepReal(200)

      // Observe when the runner's first archive run starts touching storage
      // (first storage access of a run is the settings read) and capture the
      // run's final metadata write so the test can await it instead of polling
      // the file (reads collide with writeJsonAtomic's rename on Windows).
      let firstArchiveTouchClock = null
      let archiveMetadataWrite = null
      const trackingStorage = {
        ...storage,
        readStore: (storeName, ...rest) => {
          if (storeName === 'settings' && firstArchiveTouchClock === null) firstArchiveTouchClock = Date.now()
          return storage.readStore(storeName, ...rest)
        },
        atomicUpdate: (storeName, ...rest) => {
          const result = storage.atomicUpdate(storeName, ...rest)
          if (storeName === 'sessions-metadata') archiveMetadataWrite = result
          return result
        },
        // Storage v2 archives through the atomic record update; track it the
        // same way the legacy metadata write was tracked.
        atomicSessionRecordUpdate: (sessionId, ...rest) => {
          const result = storage.atomicSessionRecordUpdate(sessionId, ...rest)
          archiveMetadataWrite = result
          return result
        },
      }

      // Fake only the timer APIs + Date: setImmediate stays real so the test
      // can still flush genuine file I/O through the event loop. Inject the
      // test's storage so the runner works on this temp dir.
      const clockAtStart = seededAt
      vi.useFakeTimers({ now: clockAtStart, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
      try {
        startAutoArchiveRunner({ storage: trackingStorage })
        await flushRealEventLoop()
        // No immediate first pass on startup: only a delayed run is scheduled.
        expect(firstArchiveTouchClock).toBeNull()
        expect((await storage.readStore('sessions-metadata')).stale.archivedAt).toBeUndefined()

        await vi.advanceTimersByTimeAsync(AUTO_ARCHIVE_INITIAL_DELAY_MS)
        // The delayed timer fired exactly at the initial delay (clock still
        // frozen at +30s) and started the first archive run.
        expect(firstArchiveTouchClock).toBe(clockAtStart + AUTO_ARCHIVE_INITIAL_DELAY_MS)

        // Let the fire-and-forget archive's final metadata write settle, then
        // verify it took effect.
        const metadataWriteStarted = await waitForRealCondition(() => archiveMetadataWrite !== null)
        expect(metadataWriteStarted).toBe(true)
        await archiveMetadataWrite.catch(() => {})
        expect((await storage.readStore('sessions-metadata')).stale.archivedAt).toBeDefined()
        expect((await storage.readSessionValue('stale')).archivedAt).toBeDefined()
      } finally {
        stopAutoArchiveRunner()
        vi.useRealTimers()
      }
    })
  })
})
