import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../../server/sqlite/database.mjs'
import { handleDreamingApi } from '../../../server/routes/dreaming.mjs'
import { createDreamingRepository } from '../../../server/sqlite/dreaming-repository.mjs'
import { normalizeDreamingSettings } from '../../../server/dreaming/settings.mjs'
import { noteIdOf } from '../../../server/dreaming/notes.mjs'

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

// MEMORY.md / DREAMING.md live in the user's data directory; the mock keeps both
// in memory so a route test never reads or writes the real files.
const memoryState = { markdown: '', dreaming: '' }
vi.mock('../../../server/global-memory.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isGlobalMemoryEnabled: async () => true,
    readGlobalMemory: async () => ({ file: 'MEMORY.md', markdown: memoryState.markdown }),
    readDreamingNotes: async () => memoryState.dreaming,
    writeDreamingNotes: async (markdown) => {
      memoryState.dreaming = markdown
      return { changed: true, markdown, path: '~/.quickforge/DREAMING.md' }
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

const NOTES_MARKDOWN = [
  '## 记忆笔记（Dreaming 维护，请勿手工编辑本文件）',
  '',
  '- 用户偏好中文交互',
  '- [pitfall] 回滚前先用 git log 确认后续没有改动',
  '- 发布前必须跑完整测试',
].join('\n')

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings(null)
  memoryState.markdown = ''
  memoryState.dreaming = ''
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
    expect(json.counts).toMatchObject({ notes: 0, runs: 0 })
    expect(json.lastRun).toBeNull()
  })

  it('counts the notes file', async () => {
    memoryState.dreaming = NOTES_MARKDOWN
    const { json } = await call('GET', '/api/dreaming')
    expect(json.counts.notes).toBe(3)
    expect(json.memoryDocument.dreamingNotes).toBe(true)
  })

  it('persists settings and computes the next scheduled run when enabled', async () => {
    const saved = await call('PUT', '/api/dreaming/settings', { enabled: true, executeTime: '04:30' })
    expect(saved.status).toBe(200)
    expect(saved.json).toMatchObject({ enabled: true, executeTime: '04:30' })
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
    repository.finishRun(run.id, {
      status: 'succeeded',
      sessionCount: 2,
      createdCount: 1,
      retiredCount: 1,
      operations: { added: ['新的笔记'], removed: ['旧的笔记'], dropped: [] },
      finishedAt: 2000,
      durationMs: 1000,
    })

    const list = await call('GET', '/api/dreaming/runs?page=1&pageSize=10')
    expect(list.status).toBe(200)
    expect(list.json.total).toBe(1)
    expect(list.json.runs[0]).toMatchObject({ id: run.id, status: 'succeeded', sessionCount: 2 })

    const detail = await call('GET', `/api/dreaming/runs/${run.id}`)
    expect(detail.status).toBe(200)
    expect(detail.json.run.id).toBe(run.id)
    // The diff IS the audit trail now: there are no per-entry rows to join.
    expect(detail.json.run.operations).toEqual({ added: ['新的笔记'], removed: ['旧的笔记'], dropped: [], notesAfter: null })
  })

  it('returns 404 for an unknown run', async () => {
    await expect(call('GET', '/api/dreaming/runs/dream_missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('serves the notes list and filters it by query and kind', async () => {
    memoryState.dreaming = NOTES_MARKDOWN

    const all = await call('GET', '/api/dreaming/notes')
    expect(all.status).toBe(200)
    expect(all.json.total).toBe(3)
    expect(all.json.hasNotes).toBe(true)
    expect(all.json.notes[0]).toMatchObject({ kind: null, text: '用户偏好中文交互' })
    expect(all.json.notes[1]).toMatchObject({ kind: 'pitfall', text: '回滚前先用 git log 确认后续没有改动' })
    // Notes have no identity, so the id is derived from the text.
    expect(all.json.notes[1].id).toMatch(/^note_/)

    const searched = await call('GET', `/api/dreaming/notes?query=${encodeURIComponent('发布')}`)
    expect(searched.json.notes.map((note) => note.text)).toEqual(['发布前必须跑完整测试'])

    const byKind = await call('GET', '/api/dreaming/notes?kind=pitfall')
    expect(byKind.json.notes.map((note) => note.kind)).toEqual(['pitfall'])
  })

  it('reports which run first wrote each note', async () => {
    memoryState.dreaming = NOTES_MARKDOWN
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    repository.finishRun(run.id, {
      status: 'succeeded',
      operations: { added: ['用户偏好中文交互'], removed: [], dropped: [], notesAfter: ['用户偏好中文交互'] },
      finishedAt: 2000,
    })

    const { json } = await call('GET', '/api/dreaming/notes')
    // The note a run recorded points back at it; one that was only ever written
    // outside a recorded run has no origin.
    expect(json.notes.find((note) => note.text === '用户偏好中文交互').firstSeen)
      .toMatchObject({ runId: run.id, at: 1000 })
    expect(json.notes.find((note) => note.text === '发布前必须跑完整测试').firstSeen).toBeNull()
  })

  it('restores the notes snapshot recorded by a run', async () => {
    memoryState.dreaming = `${NOTES_MARKDOWN}\n- 后来才有的笔记`
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    repository.finishRun(run.id, {
      status: 'succeeded',
      operations: { added: [], removed: [], dropped: [], notesAfter: ['旧的笔记'] },
      finishedAt: 2000,
    })

    const restored = await call('POST', `/api/dreaming/runs/${run.id}/restore`)
    expect(restored.status).toBe(200)
    expect(restored.json.restored).toBe(1)
    expect(memoryState.dreaming).toContain('旧的笔记')
    expect(memoryState.dreaming).not.toContain('后来才有的笔记')
  })

  it('refuses to restore a run that recorded no snapshot', async () => {
    const repository = createDreamingRepository(storage)
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    repository.finishRun(run.id, { status: 'succeeded', finishedAt: 2000 })
    await expect(call('POST', `/api/dreaming/runs/${run.id}/restore`)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('reports how often each note was recalled', async () => {
    memoryState.dreaming = NOTES_MARKDOWN
    const repository = createDreamingRepository(storage)
    repository.recordNoteRecall([{ id: noteIdOf('用户偏好中文交互'), text: '用户偏好中文交互' }], 1000)

    const { json } = await call('GET', '/api/dreaming/notes')
    expect(json.notes.find((note) => note.text === '用户偏好中文交互'))
      .toMatchObject({ recallCount: 1, lastRecalledAt: 1000 })
    expect(json.notes.find((note) => note.text === '发布前必须跑完整测试'))
      .toMatchObject({ recallCount: 0, lastRecalledAt: null })
  })

  it('deletes a single note from the file', async () => {
    memoryState.dreaming = NOTES_MARKDOWN
    const res = await call('DELETE', `/api/dreaming/notes/${noteIdOf('用户偏好中文交互')}`)
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ removed: 1, total: 2 })
    expect(memoryState.dreaming).not.toContain('用户偏好中文交互')
    // The other notes survive: this is a single-line edit, not a rewrite.
    expect(memoryState.dreaming).toContain('回滚前先用 git log')
  })

  it('returns 404 when deleting an unknown note', async () => {
    memoryState.dreaming = NOTES_MARKDOWN
    await expect(call('DELETE', `/api/dreaming/notes/${noteIdOf('不存在')}`)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns an empty notes page when the section does not exist', async () => {
    const { json } = await call('GET', '/api/dreaming/notes')
    expect(json).toMatchObject({ total: 0, hasNotes: false, notes: [] })
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
    // The old per-entry memory endpoints are gone with the table.
    await expect(call('GET', '/api/dreaming/memories')).rejects.toMatchObject({ statusCode: 404 })
    await expect(call('POST', '/api/dreaming/embeddings/backfill')).rejects.toMatchObject({ statusCode: 404 })
  })
})
