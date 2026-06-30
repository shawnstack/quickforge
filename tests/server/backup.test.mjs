import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

/**
 * Create a temp data dir, reset module cache, and freshly import backup + storage
 * so that dataDir / storageDir pick up the temp QUICKFORGE_DATA_DIR.
 */
async function withTempBackup(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-backup-test-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  try {
    const backup = await import('../../server/routes/backup.mjs')
    const storage = await import('../../server/storage.mjs')
    await storage.ensureStorage()
    await testFn(backup, storage)
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function mockRes() {
  const res = { headersSent: false, _status: null, _body: '' }
  res.writeHead = (status) => { res._status = status; res.headersSent = true }
  res.end = (body) => { res._body = body ?? '' }
  return res
}

function mockReq(jsonBody) {
  const text = JSON.stringify(jsonBody)
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      const chunks = [text]
      return {
        async next() {
          if (i < chunks.length) return { value: Buffer.from(chunks[i++]), done: false }
          return { done: true }
        },
      }
    },
  }
}

function makeBackup(data, { includeSecrets = false } = {}) {
  return {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'all',
    includeSecrets,
    data,
  }
}

async function callImport(backup, storage, body) {
  const url = new URL('http://localhost/api/backup/import')
  const req = { method: 'POST', ...mockReq(body) }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

describe('backup import — restore modes', () => {
  it('replace mode overwrites local settings entirely', async () => {
    await withTempBackup(async (backup, storage) => {
      // Seed local data
      await storage.writeStore('settings', { theme: 'dark', lang: 'en', legacy: true })

      const bk = makeBackup({ settings: { theme: 'light', fontSize: 14 } })
      const { res, json } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        mode: 'replace',
      })

      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)

      const result = await storage.readStore('settings')
      expect(result).toEqual({ theme: 'light', fontSize: 14 })
      // local-only key 'legacy' is gone in replace mode
      expect(result.legacy).toBeUndefined()
    })
  })

  it('merge mode preserves local-only keys and backup wins on conflict', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { theme: 'dark', lang: 'en', legacy: true })

      const bk = makeBackup({ settings: { theme: 'light', fontSize: 14 } })
      const { res, json } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        mode: 'merge',
      })

      expect(res._status).toBe(200)
      expect(json.ok).toBe(true)

      const result = await storage.readStore('settings')
      expect(result).toEqual({ theme: 'light', lang: 'en', legacy: true, fontSize: 14 })
    })
  })

  it('defaults to replace when mode is omitted', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { keep: 1 })

      const bk = makeBackup({ settings: { new: 2 } })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        // mode intentionally omitted
      })

      expect(res._status).toBe(200)
      const result = await storage.readStore('settings')
      expect(result).toEqual({ new: 2 })
      expect(result.keep).toBeUndefined()
    })
  })

  it('merge mode works across multiple sections simultaneously', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { a: 'local' })
      await storage.writeStore('custom-providers', { existing: { id: 'existing', baseUrl: 'http://old' } })

      const bk = makeBackup({
        settings: { b: 'backup' },
        customProviders: { incoming: { id: 'incoming', baseUrl: 'http://new' } },
      })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings', 'customProviders'],
        mode: 'merge',
      })

      expect(res._status).toBe(200)
      expect(await storage.readStore('settings')).toEqual({ a: 'local', b: 'backup' })
      expect(await storage.readStore('custom-providers')).toEqual({
        existing: { id: 'existing', baseUrl: 'http://old' },
        incoming: { id: 'incoming', baseUrl: 'http://new' },
      })
    })
  })

  it('replace mode overwrites provider keys entirely', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('provider-keys', { openai: 'sk-old', anthropic: 'sk-ant-old' })

      const bk = makeBackup({ providerKeys: { openai: 'sk-new' } }, { includeSecrets: true })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['providerKeys'],
        mode: 'replace',
      })

      expect(res._status).toBe(200)
      const result = await storage.readStore('provider-keys')
      expect(result).toEqual({ openai: 'sk-new' })
      expect(result.anthropic).toBeUndefined()
    })
  })

  it('merge mode preserves local-only provider keys', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('provider-keys', { openai: 'sk-old', local: 'sk-local' })

      const bk = makeBackup({ providerKeys: { openai: 'sk-new' } }, { includeSecrets: true })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['providerKeys'],
        mode: 'merge',
      })

      expect(res._status).toBe(200)
      const result = await storage.readStore('provider-keys')
      expect(result).toEqual({ openai: 'sk-new', local: 'sk-local' })
    })
  })
})

describe('backup import — mcp section', () => {
  it('replace mode overwrites local MCP servers entirely', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('mcp', { mcpServers: [{ name: 'old', type: 'stdio' }] })

      const bk = makeBackup({ mcp: { mcpServers: [{ name: 'new', type: 'stdio' }] } })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['mcp'],
        mode: 'replace',
      })

      expect(res._status).toBe(200)
      const result = await storage.readStore('mcp')
      expect(result.mcpServers).toEqual([{ name: 'new', type: 'stdio' }])
    })
  })

  it('merge mode replaces the mcpServers array as a whole (backup wins)', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('mcp', { mcpServers: [{ name: 'local' }, { name: 'shared' }] })

      const bk = makeBackup({ mcp: { mcpServers: [{ name: 'backup' }, { name: 'shared' }] } })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['mcp'],
        mode: 'merge',
      })

      expect(res._status).toBe(200)
      // The mcp store is a shallow object { mcpServers: [...] }; merge lets the
      // backup array win for the mcpServers key (no element-level dedupe).
      const result = await storage.readStore('mcp')
      expect(result.mcpServers).toEqual([{ name: 'backup' }, { name: 'shared' }])
    })
  })

  it('lifts legacy settings.mcpServers into the mcp section on import', async () => {
    await withTempBackup(async (backup, storage) => {
      // Legacy backup shape: MCP servers nested under settings.mcpServers
      const bk = makeBackup({
        settings: { theme: 'dark', mcpServers: [{ name: 'legacy-mcp', type: 'stdio' }] },
      })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings', 'mcp'],
        mode: 'replace',
      })

      expect(res._status).toBe(200)
      const settings = await storage.readStore('settings')
      expect(settings.mcpServers).toBeUndefined()
      expect(settings.theme).toBe('dark')
      const mcp = await storage.readStore('mcp')
      expect(mcp.mcpServers[0].name).toBe('legacy-mcp')
    })
  })
})

describe('backup import — safety backup', () => {
  it('writes a safety backup before restoring', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { important: 'data' })

      const bk = makeBackup({ settings: { replaced: true } })
      const { json } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        mode: 'replace',
      })

      expect(json.safetyBackupPath).toBeTruthy()
      // The safety backup should be a real file
      const stat = await fs.stat(json.safetyBackupPath)
      expect(stat.isFile()).toBe(true)
    })
  })
})

describe('backup import — validation', () => {
  it('rejects unknown restore mode gracefully (falls back to replace)', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { keep: 1 })

      const bk = makeBackup({ settings: { new: 2 } })
      const { res } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        mode: 'bogus-mode',
      })

      // normalizeMode falls back to 'replace' for unknown values
      expect(res._status).toBe(200)
      expect(await storage.readStore('settings')).toEqual({ new: 2 })
    })
  })
})
