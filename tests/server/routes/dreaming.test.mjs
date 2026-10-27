import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../../server/sqlite/database.mjs'
import { handleDreamingApi } from '../../../server/routes/dreaming.mjs'
import { createDreamingRepository } from '../../../server/sqlite/dreaming-repository.mjs'
import { normalizeDreamingSettings } from '../../../server/dreaming/settings.mjs'

// The settings module writes the real `settings` store, which resolves its path
// from the process environment at import time. Mock it so route tests stay
// hermetic and never touch the developer's ~/.quickforge config.
const settingsState = { current: normalizeDreamingSettings(null) }
vi.mock('../../../server/dreaming/settings.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readDreamingSettings: async () => settingsState.current,
    saveDreamingSettings: async (patch) => {
      settingsState.current = actual.normalizeDreamingSettings({ ...settingsState.current, ...patch })
      return settingsState.current
    },
  }
})

let directory
let storage

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = {}
  return req
}

function response() {
  return {
    status: 0,
    body: '',
    setHeader() {},
    writeHead(status) { this.status = status },
    end(chunk = '') { this.body = String(chunk) },
  }
}

async function call(method, pathname, body) {
  const res = response()
  await handleDreamingApi(request(method, body), res, new URL(`http://localhost${pathname}`))
  return { status: res.status, json: JSON.parse(res.body) }
}

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings(null)
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-route-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
})

afterEach(async () => {
  await closeSqliteStorage()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('dreaming API', () => {
  it('returns an overview with defaults and empty counters', async () => {
    const { status, json } = await call('GET', '/api/dreaming')
    expect(status).toBe(200)
    expect(json.settings.enabled).toBe(false)
    expect(json.settings.allowSensitive).toBe(true)
    expect(json.counts).toMatchObject({ active: 0, retired: 0, superseded: 0, runs: 0 })
    expect(json.lastRun).toBeNull()
  })

  it('persists settings and computes the next scheduled run when enabled', async () => {
    const saved = await call('PUT', '/api/dreaming/settings', { enabled: true, executeTime: '04:30' })
    expect(saved.status).toBe(200)
    expect(saved.json).toMatchObject({ enabled: true, executeTime: '04:30', scheduleEnabled: true })
    expect(saved.json.nextRunAt).toBeGreaterThan(Date.now())

    const disabled = await call('PUT', '/api/dreaming/settings', { enabled: false })
    expect(disabled.json.nextRunAt).toBeNull()
  })

  it('keeps runner-owned timestamps across a settings save', async () => {
    await call('PUT', '/api/dreaming/settings', { enabled: true, lastRunAt: 1_700_000_000_000 })
    const after = await call('PUT', '/api/dreaming/settings', { allowSensitive: false })
    expect(after.json.lastRunAt).toBe(1_700_000_000_000)
    expect(after.json.allowSensitive).toBe(false)
  })

  it('refuses a manual run while dreaming is disabled', async () => {
    await expect(call('POST', '/api/dreaming/run')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists runs and serves a run detail', async () => {
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    repository.finishRun(run.id, { status: 'succeeded', sessionCount: 2, createdCount: 1, finishedAt: 2000, durationMs: 1000 })

    const list = await call('GET', '/api/dreaming/runs?page=1&pageSize=10')
    expect(list.status).toBe(200)
    expect(list.json.total).toBe(1)
    expect(list.json.runs[0]).toMatchObject({ id: run.id, status: 'succeeded', sessionCount: 2 })

    const detail = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(detail.status).toBe(200)
    expect(detail.json.run.id).toBe(run.id)
  })

  it('returns 404 for an unknown run', async () => {
    await expect(call('GET', '/api/dreaming/runs/dream_missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('browses, searches and retires memories', async () => {
    const repository = createDreamingRepository(storage)
    const memory = repository.insertMemory({
      scope: 'project',
      projectId: 'p1',
      kind: 'pitfall',
      content: '发布前必须跑 npm run build，否则 dist 是旧的',
      evidence: [{ sessionId: 's1', seq: 2, note: 'tool result' }],
      confidence: 0.8,
      strength: 1,
      now: 1000,
    })

    const all = await call('GET', '/api/dreaming/memories?status=active')
    expect(all.json.total).toBe(1)

    const searched = await call('GET', `/api/dreaming/memories?query=${encodeURIComponent('npm run build')}`)
    expect(searched.json.memories.map((entry) => entry.id)).toEqual([memory.id])

    const retired = await call('POST', `/api/dreaming/memories/${memory.id}/retire`)
    expect(retired.status).toBe(200)
    expect(retired.json.memory.status).toBe('retired')
    expect(repository.listEvents(memory.id).map((event) => event.action)).toContain('retire')

    await expect(call('POST', `/api/dreaming/memories/${memory.id}/retire`)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('matches short CJK queries through the LIKE fallback', async () => {
    const repository = createDreamingRepository(storage)
    repository.insertMemory({
      scope: 'global',
      projectId: '',
      kind: 'fact',
      content: '发布流程需要 build',
      evidence: [],
      confidence: 0.7,
      strength: 1,
      now: 1000,
    })
    const short = await call('GET', `/api/dreaming/memories?query=${encodeURIComponent('发布')}`)
    expect(short.json.memories).toHaveLength(1)
  })


  it('reports the effective model and the selectable catalog', async () => {
    const { json } = await call('GET', '/api/dreaming')
    expect(json.model).toBeDefined()
    expect(['explicit', 'active', 'catalog', 'none']).toContain(json.model.source)
    expect(Array.isArray(json.model.available)).toBe(true)
  })

  it('rejects a model reference that does not resolve', async () => {
    await expect(call('PUT', '/api/dreaming/settings', {
      modelRef: { version: 1, source: 'custom', providerId: 'ghost', modelId: 'ghost' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects unknown subpaths and methods', async () => {
    await expect(call('GET', '/api/dreaming/nope')).rejects.toMatchObject({ statusCode: 404 })
    await expect(call('DELETE', '/api/dreaming/settings')).rejects.toMatchObject({ statusCode: 405 })
  })
})
