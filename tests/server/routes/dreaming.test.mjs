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

vi.mock('../../../server/global-memory.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isGlobalMemoryEnabled: async () => true,
    readGlobalMemory: async () => ({ file: 'MEMORY.md', markdown: '# 交互习惯\n' }),
  }
})

// The experience library lives in the user's data directory; the mock keeps the
// folder contents in memory so a route test never reads the real files. The real
// folder behaviour is covered by tests/server/memory-notes.test.mjs.
const experiencesState = { entries: [], index: '' }
vi.mock('../../../server/experiences.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    listExperiences: async () => experiencesState.entries,
    readExperienceIndex: async () => ({
      markdown: experiencesState.index,
      entries: experiencesState.entries,
      changed: false,
      file: '/tmp/index.md',
    }),
    listArchivedExperiences: async () => [],
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
  settingsState.current = normalizeDreamingSettings({ enabled: true })
  experiencesState.entries = []
  experiencesState.index = ''
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-routes-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
})

afterEach(async () => {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
})

describe('GET /api/dreaming', () => {
  it('reports the experience library and the generated index', async () => {
    experiencesState.entries = [
      { name: '构建失败先清 dist.md', title: '构建失败先清 dist', whenToUse: '构建报错时', candidateSkill: true, chars: 90, updatedAt: 1 },
      { name: '改配置前先备份.md', title: '改配置前先备份', whenToUse: '', candidateSkill: false, chars: 60, updatedAt: 2 },
    ]
    experiencesState.index = '# 经验库索引\n\n- ★ 构建失败先清 dist —— 构建报错时\n'
    const { status, json } = await call('GET', '/api/dreaming')
    expect(status).toBe(200)
    expect(json.counts).toMatchObject({ experiences: 2, candidateSkills: 1 })
    expect(json.experienceIndex).toContain('★ 构建失败先清 dist')
    expect(json.manual).toContain('交互习惯')
    expect(json.settings.enabled).toBe(true)
  })

  it('does not carry the removed pruning knobs', async () => {
    const { json } = await call('GET', '/api/dreaming')
    expect(json.settings).not.toHaveProperty('pruneStaleNotes')
    expect(json.settings).not.toHaveProperty('pruneUnusedDays')
    expect(json.settings).not.toHaveProperty('pruneMaxRecalls')
    expect(json.settings).not.toHaveProperty('pruneMinNotes')
  })
})

describe('PUT /api/dreaming/settings', () => {
  it('schedules the next run when dreaming is turned on', async () => {
    settingsState.current = normalizeDreamingSettings({ enabled: false })
    const { json } = await call('PUT', '/api/dreaming/settings', { enabled: true })
    expect(json.enabled).toBe(true)
    expect(json.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('drops the schedule when dreaming is turned off', async () => {
    settingsState.current = normalizeDreamingSettings({ enabled: true, nextRunAt: Date.now() + 60_000 })
    const { json } = await call('PUT', '/api/dreaming/settings', { enabled: false })
    expect(json.nextRunAt).toBeNull()
  })

  it('ignores pruning fields an older client might still send', async () => {
    const { json } = await call('PUT', '/api/dreaming/settings', { pruneStaleNotes: true, pruneUnusedDays: 3 })
    expect(json).not.toHaveProperty('pruneStaleNotes')
    expect(json).not.toHaveProperty('pruneUnusedDays')
  })
})

describe('GET /api/dreaming/experiences', () => {
  it('lists experiences with their generated index', async () => {
    experiencesState.entries = [
      { name: '一.md', title: '一', whenToUse: '某天', candidateSkill: false, chars: 10, updatedAt: 1 },
    ]
    experiencesState.index = '# 经验库索引\n\n- 一 —— 某天\n'
    const { status, json } = await call('GET', '/api/dreaming/experiences')
    expect(status).toBe(200)
    expect(json.experiences).toHaveLength(1)
    expect(json.index).toContain('- 一 —— 某天')
    expect(json.archived).toBe(0)
  })
})

describe('removed endpoints', () => {
  it('no longer exposes the note list or single-note deletion', async () => {
    await expect(call('GET', '/api/dreaming/notes')).rejects.toMatchObject({ statusCode: 404 })
    await expect(call('DELETE', '/api/dreaming/notes/abc')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /api/dreaming/run', () => {
  it('refuses to run while dreaming is disabled', async () => {
    settingsState.current = normalizeDreamingSettings({ enabled: false })
    await expect(call('POST', '/api/dreaming/run')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reports a skip when the window has no sessions', async () => {
    createDreamingRepository(storage)
    const { status, json } = await call('POST', '/api/dreaming/run')
    expect(status).toBe(200)
    expect(json).toMatchObject({ skipped: true, reason: 'no_sessions' })
  })
})
