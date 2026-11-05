import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../../server/sqlite/database.mjs'
import { handleDreamingApi } from '../../../server/routes/dreaming.mjs'
import { createDreamingRepository } from '../../../server/sqlite/dreaming-repository.mjs'
import { normalizeDreamingSettings } from '../../../server/dreaming/settings.mjs'

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

vi.mock('../../../server/global-memory.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isGlobalMemoryEnabled: async () => true,
    readGlobalMemory: async () => ({ file: 'MEMORY.md', markdown: '' }),
  }
})

vi.mock('../../../server/experiences.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    listExperiences: async () => [],
    readExperienceIndex: async () => ({ markdown: '', entries: [], changed: false, file: '' }),
    listArchivedExperiences: async () => [],
  }
})

// Rolling back is a filesystem operation with its own test
// (tests/server/dreaming-snapshot.test.mjs); here the route contract is what
// matters: it must pass the run id through and report what came back.
const restoreCalls = []
const restoreState = { error: null }
vi.mock('../../../server/dreaming/snapshot.mjs', () => ({
  snapshotMemory: async ({ runId }) => ({ dir: `/tmp/${runId}`, workingMemoryFiles: 0, experienceFiles: 0 }),
  restoreMemorySnapshot: async (runId) => {
    restoreCalls.push(runId)
    if (restoreState.error) throw Object.assign(new Error(restoreState.error), { statusCode: 409 })
    return { workingMemoryFiles: 3, experienceFiles: 1 }
  },
  pruneSnapshots: async () => ({ removed: 0 }),
  snapshotDirOf: (runId) => `/tmp/${runId}`,
  MAX_SNAPSHOTS: 10,
}))

let directory
let storage
let repository

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

async function call(method, pathname) {
  const res = response()
  await handleDreamingApi(request(method), res, new URL(`http://localhost${pathname}`))
  return { status: res.status, json: JSON.parse(res.body) }
}

function seedRun(overrides = {}) {
  const run = repository.createRun({
    trigger: 'schedule',
    periodFrom: 0,
    periodTo: 1000,
    startedAt: 1000,
    modelLabel: 'mock/mock-model',
    inputChars: 500,
    sessions: [{ sessionId: 's1', projectId: 'p1', title: 'work', updatedAt: 900, messageCount: 4, chars: 500, preview: 'user: hi' }],
    contentLanguage: 'zh',
  })
  return repository.finishRun(run.id, {
    status: 'succeeded',
    sessionCount: 1,
    createdCount: 2,
    updatedCount: 1,
    retiredCount: 1,
    rejectedCount: 0,
    summary: '1/1 个会话，写工作记忆 2 篇',
    operations: {
      sessions: [{
        ok: true,
        sessionId: 's1',
        reply: '写了两篇。',
        toolCalls: 4,
        actions: [],
        durationMs: 1200,
      }],
      actions: [
        { kind: 'write', scope: 'working', name: '一.md', title: '一', sessionId: 's1' },
        { kind: 'archive', scope: 'working', name: '旧.md', from: '旧.md', sessionId: 's1' },
      ],
      snapshot: '/tmp/snap/run-1',
      snapshotFiles: { workingMemory: 2, experiences: 0 },
      stopped: null,
    },
    rawResponse: '## s1\n写了两篇。',
    finishedAt: 3000,
    durationMs: 2000,
    ...overrides,
  })
}

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings({ enabled: true })
  restoreCalls.length = 0
  restoreState.error = null
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-detail-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
  repository = createDreamingRepository(storage)
})

afterEach(async () => {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
})

describe('GET /api/dreaming/runs', () => {
  it('paginates the run history', async () => {
    seedRun()
    const { status, json } = await call('GET', '/api/dreaming/runs?page=1&pageSize=10')
    expect(status).toBe(200)
    expect(json.total).toBe(1)
    expect(json.runs[0]).toMatchObject({ status: 'succeeded', sessionCount: 1, createdCount: 2 })
  })

  it('returns 404 for an unknown run', async () => {
    await expect(call('GET', '/api/dreaming/runs/nope')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/dreaming/runs/:id', () => {
  it('returns the per-session report and the snapshot path', async () => {
    const run = seedRun()
    const { json } = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(json.run.operations.sessions[0]).toMatchObject({ sessionId: 's1', ok: true, toolCalls: 4 })
    expect(json.run.operations.actions).toHaveLength(2)
    // The page enables "roll back" only when this is present.
    expect(json.run.operations.snapshot).toBe('/tmp/snap/run-1')
    expect(json.run.operations.snapshotFiles).toEqual({ workingMemory: 2, experiences: 0 })
  })

  it('normalises runs recorded before folder snapshots existed', async () => {
    const run = seedRun()
    // Simulate an old row by rewriting its operations blob.
    storage.prepare('UPDATE dreaming_runs SET operations_json = ? WHERE id = ?')
      .run(JSON.stringify({ added: ['旧笔记'], removed: [], notesAfter: ['旧笔记'] }), run.id)
    const { json } = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(json.run.operations).toMatchObject({ sessions: [], actions: [], snapshot: null })
  })
})

describe('POST /api/dreaming/runs/:id/restore', () => {
  it('rolls both folders back through the snapshot of that run', async () => {
    const run = seedRun()
    const { status, json } = await call('POST', `/api/dreaming/runs/${run.id}/restore`)
    expect(status).toBe(200)
    expect(restoreCalls).toEqual([run.id])
    expect(json.restored).toEqual({ workingMemoryFiles: 3, experienceFiles: 1 })
  })

  it('surfaces "snapshot is gone" as a conflict instead of pretending to restore', async () => {
    const run = seedRun()
    restoreState.error = '这次运行的文件快照已经不在了，无法回滚。'
    await expect(call('POST', `/api/dreaming/runs/${run.id}/restore`)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('returns 404 for an unknown run', async () => {
    await expect(call('POST', '/api/dreaming/runs/nope/restore')).rejects.toMatchObject({ statusCode: 404 })
  })
})
