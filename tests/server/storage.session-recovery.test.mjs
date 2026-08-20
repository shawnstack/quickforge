import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-storage-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  const database = await import('../../server/sqlite/database.mjs')
  try {
    await database.closeSqliteStorage().catch(() => {})
    await database.initializeSqliteStorage()
    const storageUrl = new URL(`../../server/storage.mjs?test=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    await testFn(storage, tmpDir)
  } finally {
    await database.closeSqliteStorage().catch(() => {})
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

// Storage v2: SQLite is authoritative and the legacy JSON layout is only a
// source for the one-shot startup import. The recovery guarantee that used to
// be "a body file without metadata is still readable" is now "a body-only
// JSON file is imported (metadata derived) and then readable through the
// authoritative store".
describe('session storage recovery', () => {
  it('imports a body-only JSON session file even when sessions-metadata is missing the entry', async () => {
    await withTempStorage(async (storage, tmpDir) => {
      await storage.ensureStorage()
      const sessionId = 'session-with-missing-meta'
      const sessionDir = path.join(tmpDir, 'storage', 'conversations', 'global', 'sessions')
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.writeFile(
        path.join(sessionDir, `${sessionId}.json`),
        `${JSON.stringify({
          id: sessionId,
          scope: 'global',
          stateVersion: 1,
          title: 'Recovered',
          messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
        }, null, 2)}\n`,
        'utf8',
      )

      const { importSessionStateFromJson } = await import('../../server/session-state-import.mjs')
      const { imported, skipped, diagnostics } = await importSessionStateFromJson({ storage })
      expect(imported).toBe(1)
      expect(skipped).toBe(0)
      expect(diagnostics).toEqual([{ kind: 'body-only', scope: 'global', projectId: null, sessionId }])

      const value = await storage.readSessionValue(sessionId)
      expect(value?.id).toBe(sessionId)
      expect(value?.messages).toHaveLength(1)
      const metadata = await storage.readStore('sessions-metadata')
      expect(metadata[sessionId]).toMatchObject({ id: sessionId, title: 'Recovered', messageCount: 1 })
    })
  })

  it('imports project-scoped body-only sessions and keeps their bucket', async () => {
    await withTempStorage(async (storage, tmpDir) => {
      await storage.ensureStorage()
      const sessionId = 'project-session-with-missing-meta'
      const projectId = 'project-a'
      const sessionDir = path.join(tmpDir, 'storage', 'conversations', 'projects', projectId, 'sessions')
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.writeFile(
        path.join(sessionDir, `${sessionId}.json`),
        `${JSON.stringify({
          id: sessionId,
          scope: 'project',
          projectId,
          stateVersion: 1,
          title: 'Project recovered',
          messages: [{ role: 'user', content: 'hello project', timestamp: Date.now() }],
        }, null, 2)}\n`,
        'utf8',
      )

      const { importSessionStateFromJson } = await import('../../server/session-state-import.mjs')
      const { imported } = await importSessionStateFromJson({ storage })
      expect(imported).toBe(1)

      const value = await storage.readSessionValue(sessionId)
      expect(value?.id).toBe(sessionId)
      expect(value?.scope).toBe('project')
      expect(value?.projectId).toBe(projectId)
      const buckets = await storage.readAuthoritativeSessionMetadataBuckets()
      expect(buckets).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'project', projectId }),
      ]))
    })
  })
})
