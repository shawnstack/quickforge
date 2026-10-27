import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../../server/sqlite/database.mjs'
import { createDreamingRepository } from '../../../server/sqlite/dreaming-repository.mjs'
import { handleDreamingApi } from '../../../server/routes/dreaming.mjs'
import { normalizeDreamingSettings } from '../../../server/dreaming/settings.mjs'
import { Readable } from 'node:stream'

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
let repository

function request(method) {
  const req = Readable.from([])
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

async function get(pathname) {
  const res = response()
  await handleDreamingApi(request('GET'), res, new URL(`http://localhost${pathname}`))
  return JSON.parse(res.body)
}

function createMemory(overrides = {}) {
  return repository.insertMemory({
    scope: 'project',
    projectId: 'p1',
    kind: 'pitfall',
    content: '发布前必须跑 build',
    evidence: [{ sessionId: 's1', note: 'build 成功' }],
    confidence: 0.7,
    strength: 1,
    now: 1000,
    ...overrides,
  })
}

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings(null)
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-detail-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
  repository = createDreamingRepository(storage)
})

afterEach(async () => {
  await closeSqliteStorage()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('dreaming run detail', () => {
  it('exposes what was read, what was proposed and what was rejected', async () => {
    const memory = createMemory()
    const run = repository.createRun({
      trigger: 'manual',
      periodFrom: 0,
      periodTo: 2000,
      startedAt: 2000,
      modelLabel: 'mock/mock-model',
      inputChars: 812,
      sessions: [{
        sessionId: 's1',
        projectId: 'p1',
        title: '发布小版本',
        updatedAt: 1500,
        messageCount: 4,
        chars: 812,
        preview: '[session:s1]\nuser: 发布一个小版本\nassistant: 已发布',
      }],
    })
    repository.finishRun(run.id, {
      status: 'succeeded',
      sessionCount: 1,
      createdCount: 1,
      rejectedCount: 1,
      rawResponse: '{"summary":"x","operations":[]}',
      operations: [
        { action: 'create', phase: 'applied', id: memory.id, kind: 'pitfall', scope: 'project', content: memory.content },
        { action: 'create', phase: 'rejected', reason: 'content 超过 500 字符', kind: 'fact', content: 'x'.repeat(600) },
        { action: 'retire', phase: 'decayed', id: memory.id },
      ],
      finishedAt: 3000,
      durationMs: 1000,
    })

    const detail = await get(`/api/dreaming/runs/${run.id}`)

    expect(detail.run.modelLabel).toBe('mock/mock-model')
    expect(detail.run.inputChars).toBe(812)
    expect(detail.run.sessions).toHaveLength(1)
    expect(detail.run.sessions[0]).toMatchObject({ sessionId: 's1', chars: 812 })
    expect(detail.run.sessions[0].preview).toContain('user: 发布一个小版本')
    expect(detail.run.rawResponse).toContain('"summary"')

    // The applied operation resolves to the stored memory, so the page can show
    // confidence/strength/evidence without extra requests.
    expect(detail.memories[memory.id]).toMatchObject({ id: memory.id, status: 'active' })
    expect(detail.memories[memory.id].evidence[0].sessionId).toBe('s1')

    // The rejected operation keeps the proposal, which is the whole point.
    const rejected = detail.run.operations.find((operation) => operation.phase === 'rejected')
    expect(rejected).toMatchObject({ kind: 'fact', reason: 'content 超过 500 字符' })
    expect(rejected.content).toHaveLength(600)
  })

  it('returns the before/after audit snapshot for an updated memory', async () => {
    const memory = createMemory()
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 2000, startedAt: 2000 })
    repository.updateMemory(memory.id, { content: '发布前必须跑 test、lint、build' }, 3000)
    repository.logEvent({
      memoryId: memory.id,
      action: 'update',
      before: memory,
      after: repository.findById(memory.id),
      runId: run.id,
      now: 3000,
    })
    repository.finishRun(run.id, {
      status: 'succeeded',
      updatedCount: 1,
      operations: [{ action: 'update', phase: 'applied', id: memory.id, content: '发布前必须跑 test、lint、build' }],
      finishedAt: 4000,
    })

    const detail = await get(`/api/dreaming/runs/${run.id}`)
    expect(detail.events).toHaveLength(1)
    expect(detail.events[0].before.content).toBe('发布前必须跑 build')
    expect(detail.events[0].after.content).toBe('发布前必须跑 test、lint、build')
    expect(detail.memories[memory.id].content).toBe('发布前必须跑 test、lint、build')
  })

  it('keeps working for runs written before the detail columns existed', async () => {
    // A run created by the old code path has no sessions/raw response.
    const run = repository.createRun({ trigger: 'schedule', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    repository.finishRun(run.id, { status: 'skipped', finishedAt: 1100 })
    const detail = await get(`/api/dreaming/runs/${run.id}`)
    expect(detail.run.sessions).toEqual([])
    expect(detail.run.rawResponse).toBeNull()
    expect(detail.run.inputChars).toBe(0)
    expect(detail.memories).toEqual({})
  })
})
