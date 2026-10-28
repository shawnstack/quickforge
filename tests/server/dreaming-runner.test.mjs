import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createDreamingRepository } from '../../server/sqlite/dreaming-repository.mjs'
import {
  isDreamingRunning,
  nextScheduledRunAt,
  resolveDreamingModel,
  runDreaming,
} from '../../server/dreaming/runner.mjs'
import { normalizeDreamingSettings } from '../../server/dreaming/settings.mjs'

// Hermetic settings: the real module writes `~/.quickforge/config/settings.json`.
const settingsState = { current: normalizeDreamingSettings(null) }
vi.mock('../../server/dreaming/settings.mjs', async (importOriginal) => {
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

const modelReply = { text: '', prompt: '' }
vi.mock('../../server/ai-http-logger.mjs', () => ({
  streamSimpleWithAiHttpLogging: (_model, context) => {
    // Capture the user prompt so tests can assert the language directive and the
    // "edit the current list" contract.
    modelReply.prompt = String(context?.messages?.[0]?.content ?? '')
    const message = { role: 'assistant', content: [{ type: 'text', text: modelReply.text }] }
    return { result: async () => message }
  },
}))

// Model resolution is what decides which provider Dreaming bills. The mock keeps
// the three sources separate so tests can assert the precedence order.
const modelState = { catalog: null, active: null, explicit: null, bindingThrows: false }
vi.mock('../../server/model-catalog.mjs', () => ({
  resolveModelBinding: async () => {
    if (modelState.bindingThrows) throw new Error('model_not_configured')
    return modelState.explicit ? { model: modelState.explicit, modelRef: null } : null
  },
  resolveImplicitModelPreference: async (value) => (value ? modelState.active : modelState.catalog),
}))
vi.mock('../../server/storage.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // 'active-model' is what the runner reads to decide the chat-model fallback.
    readStore: async () => (modelState.active ? { 'active-model': { modelSnapshot: modelState.active } } : {}),
  }
})

// global-memory resolves its data directory from the process env at import time,
// so a real read/write would land in the developer's ~/.quickforge. Both sides of
// the notes round-trip are mocked here; the real file handling is covered by
// tests/server/dreaming-memory.test.mjs against a temp directory.
const memoryWrites = []
const notesState = { content: '' }
vi.mock('../../server/global-memory.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isGlobalMemoryEnabled: async () => true,
    readDreamingNotes: async () => notesState.content,
    writeDreamingNotes: async (markdown) => {
      memoryWrites.push(markdown)
      notesState.content = markdown
      return { changed: true, markdown, path: '~/.quickforge/DREAMING.md' }
    },
  }
})

let directory
let storage
let repository

const MODEL = { provider: 'mock', id: 'mock-model', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }

function insertSession({ sessionId = 's1', projectId = 'p1', updatedAtMs = 5000, messages }) {
  storage.prepare(`INSERT INTO sessions (
      scope, project_id, session_id, title, created_at, updated_at, message_count,
      state_version, body_json, meta_json, revision, updated_at_ms
    ) VALUES ('project', ?, ?, 'work', '2026-10-26T00:00:00.000Z', '2026-10-26T00:10:00.000Z', ?, 1, '{"split":true}', '{}', 1, ?)`)
    .run(projectId, sessionId, messages.length, updatedAtMs)
  messages.forEach((message, index) => {
    storage.prepare(`INSERT INTO session_messages (scope, project_id, session_id, seq, message_id, message_json, message_digest)
      VALUES ('project', ?, ?, ?, ?, ?, ?)`)
      .run(projectId, sessionId, index, `${sessionId}-m${index}`, JSON.stringify(message), 'a'.repeat(64))
  })
}

const SAMPLE_MESSAGES = [
  { role: 'user', content: [{ type: 'text', text: '发布一个小版本' }] },
  { role: 'assistant', content: [{ type: 'toolCall', name: 'run_command', arguments: { command: 'npm run build' } }] },
  { role: 'toolResult', toolName: 'run_command', content: [{ type: 'text', text: 'built in 6.36s' }] },
]

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings({ enabled: true })
  modelState.catalog = MODEL
  modelState.active = MODEL
  modelState.explicit = null
  modelState.bindingThrows = false
  modelReply.text = ''
  modelReply.prompt = ''
  memoryWrites.length = 0
  notesState.content = ''
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-runner-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
  repository = createDreamingRepository(storage)
})

afterEach(async () => {
  await closeSqliteStorage()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('dreaming runner', () => {
  it('skips without writing a run row when disabled', async () => {
    settingsState.current.enabled = false
    const result = await runDreaming({ trigger: 'manual', repository })
    expect(result).toMatchObject({ skipped: true, reason: 'disabled' })
    expect(repository.countRuns()).toBe(0)
  })

  it('records a skipped run when the window has no sessions', async () => {
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.skipped).toBe(true)
    expect(result.run).toMatchObject({ status: 'skipped', sessionCount: 0 })
    expect(settingsState.current.lastRunAt).toBe(10_000)
  })

  it('fails cleanly when no model is configured', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelState.catalog = null
    modelState.active = null
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run).toMatchObject({ status: 'failed' })
    expect(result.run.error).toContain('模型')
  })

  it('writes the returned bullet list back and records the diff', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- [experience] 发布前先跑 npm run build 再打包，避免 dist 过期。'

    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run).toMatchObject({ status: 'succeeded', sessionCount: 1, createdCount: 1, retiredCount: 0, rejectedCount: 0 })
    expect(result.run.operations).toMatchObject({ added: ['[experience] 发布前先跑 npm run build 再打包，避免 dist 过期。'] })
    expect(result.run.summary).toContain('1 条笔记')

    expect(memoryWrites).toHaveLength(1)
    expect(memoryWrites[0]).toContain('npm run build')
    // The file is rewritten wholesale, so the title is part of the payload.
    expect(memoryWrites[0]).toContain('记忆笔记')

    // The watermark advances only on a completed run, so the next pass resumes.
    expect(repository.latestSucceededPeriodTo()).toBe(10_000)
  })

  it('shows the current notes to the model and only reports real changes on a second pass', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 用户偏好中文交互'
    const first = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(first.run.operations).toMatchObject({ added: ['用户偏好中文交互'], removed: [] })

    // Second pass: a new session in the new window, and the model keeps the
    // existing note while adding one.
    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = '- 用户偏好中文交互\n- 发布前必须跑完整测试'
    const second = await runDreaming({ trigger: 'manual', now: 20_000, repository })
    expect(modelReply.prompt).toContain('- 用户偏好中文交互')
    expect(second.run.operations).toMatchObject({
      added: ['发布前必须跑完整测试'],
      removed: [],
    })
    expect(parseNoteLinesOfLastWrite(memoryWrites)).toEqual(['用户偏好中文交互', '发布前必须跑完整测试'])
  })

  it('reports removed notes when the model drops one', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 保留这条\n- 删掉这条'
    await runDreaming({ trigger: 'manual', now: 10_000, repository })

    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = '- 保留这条'
    const second = await runDreaming({ trigger: 'manual', now: 20_000, repository })
    expect(second.run.operations).toMatchObject({ added: [], removed: ['删掉这条'] })
  })

  it('fails on a prose reply instead of wiping the notes', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 已经存在的笔记'
    await runDreaming({ trigger: 'manual', now: 10_000, repository })
    memoryWrites.length = 0

    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = 'I could not find anything worth remembering today.'
    const result = await runDreaming({ trigger: 'manual', now: 20_000, repository })
    expect(result.run).toMatchObject({ status: 'failed' })
    expect(result.run.error).toContain('没有任何笔记条目')
    // Nothing written: the previous notes survive an off-contract reply.
    expect(memoryWrites).toEqual([])
  })

  it('treats a genuinely empty reply as "nothing durable" and clears the section', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 旧笔记'
    await runDreaming({ trigger: 'manual', now: 10_000, repository })
    memoryWrites.length = 0

    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = ''
    const result = await runDreaming({ trigger: 'manual', now: 20_000, repository })
    expect(result.run).toMatchObject({ status: 'succeeded', createdCount: 0, retiredCount: 1 })
    expect(memoryWrites).toEqual([''])
  })

  it('records the resulting notes so the run can be restored later', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 一\n- 二'
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run.operations.notesAfter).toEqual(['一', '二'])
  })

  it('flags a run that rewrites most of the list as possible drift', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = Array.from({ length: 6 }, (_value, index) => `- note ${index}`).join('\n')
    await runDreaming({ trigger: 'manual', now: 10_000, repository })

    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = Array.from({ length: 6 }, (_value, index) => `- different ${index}`).join('\n')
    const second = await runDreaming({ trigger: 'manual', now: 20_000, repository })

    // Still a success (the notes are the model's call), but the run carries a
    // warning so a human can spot the drift.
    expect(second.run).toMatchObject({ status: 'succeeded' })
    expect(second.run.error).toContain('记忆漂移')
    expect(second.run.operations.notesAfter).toHaveLength(6)
  })

  it('does not flag churn on a short list, where every run looks like a rewrite', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 一\n- 二'
    await runDreaming({ trigger: 'manual', now: 10_000, repository })

    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = '- 三\n- 四'
    const second = await runDreaming({ trigger: 'manual', now: 20_000, repository })
    expect(second.run.status).toBe('succeeded')
    expect(second.run.error).toBeNull()
  })

  it('hands never-recalled notes to the model as deletion candidates', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    // Pruning only kicks in on a long list; 40 notes is the threshold.
    const notes = Array.from({ length: 40 }, (_value, index) => `- note ${index}`)
    modelReply.text = notes.join('\n')
    await runDreaming({ trigger: 'manual', now: 10_000, repository })

    const day = 24 * 60 * 60 * 1000
    const later = 10_000 + 70 * day
    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: later - 1000 })
    modelReply.text = notes.join('\n')
    await runDreaming({ trigger: 'manual', now: later, repository })

    expect(modelReply.prompt).toContain('Never recalled')
    expect(modelReply.prompt).toContain('(70 days) note 0')
  })

  it('does not propose pruning while the list is still short', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 一\n- 二'
    await runDreaming({ trigger: 'manual', now: 10_000, repository })

    const later = 10_000 + 70 * 24 * 60 * 60 * 1000
    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: later - 1000 })
    modelReply.text = '- 一\n- 二'
    await runDreaming({ trigger: 'manual', now: later, repository })

    // Every note looks "never recalled" on a short list, so the section is omitted
    // rather than asking the model to consider deleting everything.
    expect(modelReply.prompt).not.toContain('Never recalled')
  })

  it('keeps the notes usage table in step with the file', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- 一\n- 二'
    await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect([...repository.listNoteStats().values()].map((stat) => stat.text).sort()).toEqual(['一', '二'])

    insertSession({ sessionId: 's2', messages: SAMPLE_MESSAGES, updatedAtMs: 15_000 })
    modelReply.text = '- 二\n- 三'
    await runDreaming({ trigger: 'manual', now: 20_000, repository })
    expect([...repository.listNoteStats().values()].map((stat) => stat.text).sort()).toEqual(['三', '二'])
  })

  it('guards against concurrent runs', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    modelReply.text = '- x'
    const first = runDreaming({ trigger: 'manual', now: 10_000, repository })
    // The second call observes the in-flight flag, not a queued pass.
    await vi.waitFor(() => expect(isDreamingRunning()).toBe(true))
    const second = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(second).toMatchObject({ skipped: true, reason: 'already_running' })
    await first
    expect(isDreamingRunning()).toBe(false)
  })

  it('pins the model chosen in settings and records which one ran', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    const pinned = { provider: 'zhipu', id: 'glm-4-plus', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.explicit = pinned
    settingsState.current.modelRef = { version: 1, source: 'custom', providerId: 'prov-1', modelId: 'glm-4-plus' }
    modelReply.text = '- x'
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run.modelLabel).toBe('zhipu/glm-4-plus')
  })

  it('falls back to the model last used in chat instead of the first catalog entry', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    const chatModel = { provider: 'deepseek', id: 'deepseek-chat', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.catalog = { provider: 'zhipu', id: 'glm-4.6v', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.active = chatModel
    modelReply.text = '- x'
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    // The regression this guards: the worker used to silently pick the first
    // configured model (glm-4.6v) even though chat used deepseek.
    expect(result.run.modelLabel).toBe('deepseek/deepseek-chat')
  })

  it('falls back when the pinned model was deleted', async () => {
    insertSession({ messages: SAMPLE_MESSAGES })
    settingsState.current.modelRef = { version: 1, source: 'custom', providerId: 'gone', modelId: 'gone' }
    modelState.bindingThrows = true
    modelState.active = { provider: 'deepseek', id: 'deepseek-chat', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelReply.text = '- x'
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run.status).toBe('succeeded')
    expect(result.run.modelLabel).toBe('deepseek/deepseek-chat')
  })

  it('reports the resolution source so the settings page can explain it', async () => {
    const pinned = { provider: 'zhipu', id: 'glm-4-plus', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.explicit = pinned
    settingsState.current.modelRef = { version: 1, source: 'custom', providerId: 'p', modelId: 'glm-4-plus' }
    await expect(resolveDreamingModel(settingsState.current)).resolves.toMatchObject({ source: 'explicit' })

    modelState.explicit = null
    modelState.active = pinned
    await expect(resolveDreamingModel({ ...settingsState.current, modelRef: null })).resolves.toMatchObject({ source: 'active' })

    modelState.active = null
    modelState.catalog = pinned
    await expect(resolveDreamingModel({ ...settingsState.current, modelRef: null })).resolves.toMatchObject({ source: 'catalog' })

    modelState.catalog = null
    await expect(resolveDreamingModel({ ...settingsState.current, modelRef: null })).resolves.toMatchObject({ model: null, source: 'none' })
  })

  it('schedules forward from the configured time', () => {
    const base = new Date('2026-10-27T03:00:00')
    const next = new Date(nextScheduledRunAt('03:00', base))
    expect(next.getTime()).toBeGreaterThan(base.getTime())
    expect(next.getDate()).toBe(28)
  })

  it('tells the model to answer in Chinese when the user writes Chinese', async () => {
    insertSession({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '帮我把这个接口改成支持分页，然后跑一下测试' }] },
        { role: 'assistant', content: [{ type: 'text', text: '已经改成支持分页了，测试也通过了。' }] },
      ],
    })
    modelReply.text = '- 分页改造已完成'
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run).toMatchObject({ status: 'succeeded', contentLanguage: 'zh' })
    expect(modelReply.prompt).toContain('## Output language')
    expect(modelReply.prompt).toContain('Simplified Chinese')
  })

  it('lets an explicit setting override detection', async () => {
    insertSession({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'please refactor this module and run the tests' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Refactored, tests pass.' }] },
      ],
    })
    settingsState.current.contentLanguage = 'zh'
    modelReply.text = '- x'
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result.run.contentLanguage).toBe('zh')
    expect(modelReply.prompt).toContain('Simplified Chinese')
  })
})

/** Bullets from the last payload handed to the writer, in written order. */
function parseNoteLinesOfLastWrite(writes) {
  const last = writes[writes.length - 1] ?? ''
  return last.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2))
}
