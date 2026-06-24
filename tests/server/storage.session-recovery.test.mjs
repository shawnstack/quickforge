import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-storage-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  try {
    const storageUrl = new URL(`../../server/storage.mjs?test=${Date.now()}-${Math.random()}`, import.meta.url)
    const storage = await import(/* @vite-ignore */ storageUrl.href)
    await testFn(storage, tmpDir)
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

describe('session storage recovery', () => {
  it('reads a session data file even when sessions-metadata is missing the bucket entry', async () => {
    await withTempStorage(async ({ ensureStorage, readSessionValue }, tmpDir) => {
      await ensureStorage()
      const sessionId = 'session-with-missing-meta'
      const sessionDir = path.join(tmpDir, 'storage', 'conversations', 'global', 'sessions')
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.writeFile(
        path.join(sessionDir, `${sessionId}.json`),
        `${JSON.stringify({
          id: sessionId,
          scope: 'global',
          messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
        }, null, 2)}\n`,
        'utf8',
      )

      const value = await readSessionValue(sessionId)

      expect(value?.id).toBe(sessionId)
      expect(value?.messages).toHaveLength(1)
    })
  })

  it('recovers project-scoped sessions when metadata is missing', async () => {
    await withTempStorage(async ({ ensureStorage, readSessionValue }, tmpDir) => {
      await ensureStorage()
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
          messages: [{ role: 'user', content: 'hello project', timestamp: Date.now() }],
        }, null, 2)}\n`,
        'utf8',
      )

      const value = await readSessionValue(sessionId)

      expect(value?.id).toBe(sessionId)
      expect(value?.scope).toBe('project')
      expect(value?.projectId).toBe(projectId)
    })
  })
})
