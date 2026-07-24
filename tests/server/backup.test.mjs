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

async function callImportWithToken(backup, body) {
  const url = new URL('http://localhost/api/backup/import')
  const req = { method: 'POST', ...mockReq(body) }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

async function callExport(backup, urlText = 'http://localhost/api/backup/export') {
  const url = new URL(urlText)
  const req = { method: 'GET' }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

describe('backup export — settings sections', () => {
  it('defaults to core config and excludes conversations', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { theme: 'dark' })
      await storage.writeStore('sessions', { session1: { title: 'large history' } })
      await storage.writeStore('sessions-metadata', { session1: { id: 'session1' } })

      const { res, json } = await callExport(backup)

      expect(res._status).toBe(200)
      expect(json.scope).toBe('config')
      expect(json.data.settings).toEqual({ theme: 'dark' })
      expect(json.data.projects).toBeUndefined()
      expect(json.data.sessions).toBeUndefined()
      expect(json.data.sessionsMetadata).toBeUndefined()
    })
  })

  it('exports only selected settings sections, including provider keys', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { theme: 'dark' })
      await storage.writeStore('provider-keys', { openai: 'key' })
      await storage.writeStore('custom-providers', { local: { id: 'local' } })

      const { res, json } = await callExport(backup, 'http://localhost/api/backup/export?sections=settings,providerKeys')

      expect(res._status).toBe(200)
      expect(json.exportedSections).toEqual(['settings', 'providerKeys'])
      expect(json.data.settings).toEqual({ theme: 'dark' })
      expect(json.data.providerKeys).toEqual({ openai: 'key' })
      expect(json.data.customProviders).toBeUndefined()
      expect(json.data.sessions).toBeUndefined()
    })
  })

  it('rejects projects in the section-based export API', async () => {
    await withTempBackup(async (backup) => {
      await expect(callExport(backup, 'http://localhost/api/backup/export?sections=settings,projects'))
        .rejects.toThrow('Invalid export section: projects')
    })
  })

  it('rejects conversations in the new section-based export API', async () => {
    await withTempBackup(async (backup) => {
      await expect(callExport(backup, 'http://localhost/api/backup/export?sections=settings,conversations'))
        .rejects.toThrow('Invalid export section: conversations')
    })
  })
})

async function callInspectFile(backup, text) {
  const url = new URL('http://localhost/api/backup/inspect-file')
  const req = {
    method: 'POST',
    [Symbol.asyncIterator]() {
      let done = false
      return {
        async next() {
          if (done) return { done: true }
          done = true
          return { value: Buffer.from(text), done: false }
        },
      }
    },
  }
  const res = mockRes()
  await backup.handleBackupApi(req, res, url)
  return { res, json: JSON.parse(res._body || '{}') }
}

describe('backup import — file inspect', () => {
  it('extracts settings from a full backup and reports ignored conversations', async () => {
    await withTempBackup(async (backup) => {
      const fullBackupText = JSON.stringify(makeBackup({
        settings: { theme: 'dark' },
        sessions: { big: { id: 'big', messages: ['history'] } },
        sessionsMetadata: { big: { id: 'big' } },
      }))

      const { res, json } = await callInspectFile(backup, fullBackupText)

      expect(res._status).toBe(200)
      expect(json.importToken).toBeTruthy()
      expect(json.sections.settings).toBe(1)
      expect(json.sections.sessions).toBeUndefined()
      expect(json.ignoredConversations).toBe(true)
    })
  })

  it('ignores legacy project data while preserving valid settings', async () => {
    await withTempBackup(async (backup) => {
      const text = JSON.stringify(makeBackup({
        settings: { theme: 'dark' },
        projects: { activeProjectId: 'local', globalSkills: ['example'], projects: [] },
      }))

      const { res, json } = await callInspectFile(backup, text)

      expect(res._status).toBe(200)
      expect(json.sections.settings).toBe(1)
      expect(json.sections.projects).toBeUndefined()
      expect(json.ignoredProjects).toBe(true)
      expect(json.warnings.some((warning) => warning.includes('local machine data'))).toBe(true)
    })
  })
})

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
      await storage.writeProjectConfigData({
        activeProjectId: 'project-1',
        globalSkills: ['example'],
        projects: [{ id: 'project-1', name: 'Local', path: 'C:\\local', skills: [], commandDir: '' }],
      })

      const bk = makeBackup({ settings: { replaced: true } })
      const { json } = await callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        mode: 'replace',
      })

      expect(json.safetyBackupPath).toBeTruthy()
      // The safety backup should be a real file
      const safetyBackup = JSON.parse(await fs.readFile(json.safetyBackupPath, 'utf8'))
      expect(safetyBackup.scope).toBe('config')
      expect(safetyBackup.data.settings).toEqual({ important: 'data' })
      expect(safetyBackup.data.projects.projects[0].id).toBe('project-1')
      expect(safetyBackup.data.sessions).toBeUndefined()
    })
  })

  it('keeps full safety backup when restoring conversations', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { important: 'data' })
      await storage.writeStore('sessions', { local: { id: 'local', title: 'local' } })
      await storage.writeStore('sessions-metadata', { local: { id: 'local' } })

      const bk = makeBackup({
        sessions: { incoming: { title: 'incoming' } },
        sessionsMetadata: { incoming: { id: 'incoming' } },
      })
      const { json } = await callImport(backup, storage, {
        backup: bk,
        sections: ['conversations'],
        mode: 'replace',
      })

      const safetyBackup = JSON.parse(await fs.readFile(json.safetyBackupPath, 'utf8'))
      expect(safetyBackup.scope).toBe('all')
      expect(safetyBackup.data.sessions.local.title).toBe('local')
    })
  })
})

describe('backup import — validation', () => {
  it('keeps an import token after a failed attempt and deletes it after success', async () => {
    await withTempBackup(async (backup, storage) => {
      const { json: inspect } = await callInspectFile(backup, JSON.stringify(makeBackup({ settings: { theme: 'light' } })))

      await expect(callImportWithToken(backup, {
        importToken: inspect.importToken,
        sections: ['settings'],
        mode: 'invalid',
      })).rejects.toThrow('Invalid restore mode: invalid')

      const { res } = await callImportWithToken(backup, {
        importToken: inspect.importToken,
        sections: ['settings'],
        mode: 'replace',
      })
      expect(res._status).toBe(200)
      expect(await storage.readStore('settings')).toEqual({ theme: 'light' })

      await expect(callImportWithToken(backup, {
        importToken: inspect.importToken,
        sections: ['settings'],
        mode: 'replace',
      })).rejects.toThrow('Import preview has expired')
    })
  })

  it('pauses imported scheduled tasks whose projects are not registered locally', async () => {
    await withTempBackup(async (backup, storage) => {
      const tasks = {
        global: { id: 'global', status: 'enabled', projectId: null },
        missing: { id: 'missing', status: 'enabled', projectId: 'missing-project', projectName: 'Missing' },
      }
      const { json: inspect } = await callInspectFile(backup, JSON.stringify(makeBackup({ scheduledTasks: tasks })))

      expect(inspect.warnings.some((warning) => warning.includes('will be paused'))).toBe(true)

      const { res } = await callImportWithToken(backup, {
        importToken: inspect.importToken,
        sections: ['scheduledTasks'],
        mode: 'replace',
      })

      expect(res._status).toBe(200)
      const restored = await storage.readStore('scheduled-tasks')
      expect(restored.global.status).toBe('enabled')
      expect(restored.missing.status).toBe('paused')
      expect(restored.missing.projectId).toBe('missing-project')
    })
  })

  it('rejects backup versions newer than the current format', async () => {
    await withTempBackup(async (backup) => {
      const futureBackup = { ...makeBackup({ settings: { theme: 'dark' } }), version: 99 }
      await expect(callInspectFile(backup, JSON.stringify(futureBackup)))
        .rejects.toThrow('Unsupported backup version: 99')
    })
  })

  it('rejects unknown restore modes', async () => {
    await withTempBackup(async (backup, storage) => {
      await storage.writeStore('settings', { keep: 1 })

      const bk = makeBackup({ settings: { new: 2 } })
      await expect(callImport(backup, storage, {
        backup: bk,
        sections: ['settings'],
        mode: 'bogus-mode',
      })).rejects.toThrow('Invalid restore mode: bogus-mode')

      expect(await storage.readStore('settings')).toEqual({ keep: 1 })
    })
  })
})
