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
    readDreamingNotes: async () => '',
    writeDreamingNotes: async (markdown) => ({ changed: true, markdown, path: '~/.quickforge/DREAMING.md' }),
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

async function call(method, pathname) {
  const res = response()
  await handleDreamingApi(request(method), res, new URL(`http://localhost${pathname}`))
  return { status: res.status, json: JSON.parse(res.body) }
}

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings(null)
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-detail-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
})

afterEach(async () => {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
})

describe('dreaming run detail', () => {
  it('exposes what the run read, what changed in the notes and what the model replied', async () => {
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({
      trigger: 'schedule',
      periodFrom: 0,
      periodTo: 1000,
      startedAt: 1000,
      modelLabel: 'mock/model',
      inputChars: 1200,
      sessions: [{ sessionId: 's1', projectId: 'p1', title: 'work', updatedAt: 900, messageCount: 3, chars: 400, preview: 'user: hi' }],
      contentLanguage: 'zh',
    })
    repository.finishRun(run.id, {
      status: 'succeeded',
      sessionCount: 1,
      createdCount: 1,
      retiredCount: 1,
      rejectedCount: 1,
      rawResponse: '- 新的笔记',
      operations: { added: ['新的笔记'], removed: ['旧的笔记'], dropped: [{ reason: 'sensitive', content: 'sk-live' }], notesAfter: ['新的笔记'] },
      finishedAt: 2000,
      durationMs: 1000,
    })

    const { json } = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(json.run).toMatchObject({ modelLabel: 'mock/model', inputChars: 1200, contentLanguage: 'zh' })
    // The run page shows the transcript previews that were actually sent.
    expect(json.run.sessions[0].preview).toBe('user: hi')
    // The notes diff is the whole audit trail: there are no memory rows left.
    expect(json.run.operations).toEqual({
      added: ['新的笔记'],
      removed: ['旧的笔记'],
      dropped: [{ reason: 'sensitive', content: 'sk-live' }],
      notesAfter: ['新的笔记'],
    })
    // The raw reply stays available for "why did it say that" debugging.
    expect(json.run.rawResponse).toBe('- 新的笔记')
  })

  it('normalizes runs written before the diff shape existed', async () => {
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    // Old rows stored an operation array under the same column.
    storage.prepare("UPDATE dreaming_runs SET operations_json = ? WHERE id = ?")
      .run(JSON.stringify([{ action: 'create', id: 'mem_1' }]), run.id)

    const { json } = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(json.run.operations).toEqual({ added: [], removed: [], dropped: [], notesAfter: null })
  })

  it('keeps working when a run never finished', async () => {
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })

    const { json } = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(json.run).toMatchObject({ status: 'running', finishedAt: null, durationMs: null })
  })
})
