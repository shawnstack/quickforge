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

// Model resolution decides which provider a run bills. The mock keeps the three
// sources separate so tests can assert the precedence order.
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
    readStore: async () => (modelState.active ? { 'active-model': { modelSnapshot: modelState.active } } : {}),
  }
})

vi.mock('../../server/global-memory.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, isGlobalMemoryEnabled: async () => true }
})

// The index rebuild and the folder copy both land on the real data directory, so
// they are replaced here; the real filesystem behaviour is covered by
// tests/server/dreaming-snapshot.test.mjs and tests/server/memory-notes.test.mjs.
const snapshotCalls = []
const snapshotState = { fail: null }
vi.mock('../../server/dreaming/snapshot.mjs', () => ({
  MAX_SNAPSHOTS: 10,
  snapshotMemory: async ({ runId }) => {
    if (snapshotState.fail) throw new Error(snapshotState.fail)
    snapshotCalls.push(runId)
    return { dir: `/tmp/snap/${runId}`, workingMemoryFiles: 2, experienceFiles: 1 }
  },
  restoreMemorySnapshot: async () => ({ workingMemoryFiles: 0, experienceFiles: 0 }),
  pruneSnapshots: async () => ({ removed: 0 }),
  snapshotDirOf: (runId) => `/tmp/snap/${runId}`,
}))
const indexRefreshes = []
vi.mock('../../server/experiences.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readExperienceIndex: async () => {
      indexRefreshes.push(Date.now())
      return { markdown: '', entries: [], changed: false, file: '/tmp/index.md' }
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

const MESSAGES = [
  { role: 'user', content: [{ type: 'text', text: '发布一个小版本' }] },
  { role: 'assistant', content: [{ type: 'toolCall', name: 'run_command', arguments: { command: 'npm run build' } }] },
  { role: 'toolResult', toolName: 'run_command', content: [{ type: 'text', text: 'built in 6.36s' }] },
  { role: 'assistant', content: [{ type: 'text', text: '已经发好了。' }] },
]

/** Records each curator turn so tests can assert order, count and inputs. */
function createCuratorStub(results = []) {
  const calls = []
  const stub = async (input) => {
    calls.push(input)
    const next = results[calls.length - 1]
    return next ?? {
      ok: true,
      sessionId: input.session.sessionId,
      reply: '整理完了。',
      toolCalls: 3,
      blockedCalls: [],
      actions: [],
      durationMs: 5,
    }
  }
  stub.calls = calls
  return stub
}

beforeEach(async () => {
  settingsState.current = normalizeDreamingSettings({ enabled: true })
  modelState.catalog = MODEL
  modelState.active = MODEL
  modelState.explicit = null
  modelState.bindingThrows = false
  snapshotCalls.length = 0
  snapshotState.fail = null
  indexRefreshes.length = 0
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-runner-'))
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath: path.join(directory, 'quickforge.sqlite3') })
  repository = createDreamingRepository(storage)
})

afterEach(async () => {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
})

describe('runDreaming', () => {
  it('does nothing when dreaming is disabled', async () => {
    settingsState.current = normalizeDreamingSettings({ enabled: false })
    insertSession({ messages: MESSAGES })
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result).toMatchObject({ skipped: true, reason: 'disabled' })
  })

  it('skips without touching memory when the window holds no sessions', async () => {
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository })
    expect(result).toMatchObject({ skipped: true, reason: 'no_sessions' })
    expect(snapshotCalls).toEqual([])
  })

  it('processes every session, one curator turn each, oldest first', async () => {
    insertSession({ sessionId: 'later', updatedAtMs: 8000, messages: MESSAGES })
    insertSession({ sessionId: 'earlier', updatedAtMs: 4000, messages: MESSAGES })
    const curator = createCuratorStub()
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })

    expect(curator.calls.map((call) => call.session.sessionId)).toEqual(['earlier', 'later'])
    expect(result.run).toMatchObject({ status: 'succeeded', sessionCount: 2 })
    expect(result.run.operations.sessions).toHaveLength(2)
  })

  it('takes the memory snapshot before the first curator turn', async () => {
    insertSession({ messages: MESSAGES })
    const order = []
    const curator = async (input) => {
      order.push('curator')
      return { ok: true, sessionId: input.session.sessionId, reply: '', toolCalls: 0, actions: [], durationMs: 1 }
    }
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    order.push(...snapshotCalls.map(() => 'snapshot'))
    // The snapshot is recorded before the turn runs, so the first entry is the copy.
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]).toBe(result.run.id)
    expect(order).toContain('curator')
    expect(result.run.operations.snapshotFiles).toEqual({ workingMemory: 2, experiences: 1 })
  })

  it('refuses to run when the snapshot cannot be taken', async () => {
    insertSession({ messages: MESSAGES })
    snapshotState.fail = 'disk full'
    const curator = createCuratorStub()
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    // An agent editing memory with no way back is worse than a night of no curation.
    expect(curator.calls).toEqual([])
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toContain('disk full')
  })

  it('summarises what the sessions wrote, promoted and archived', async () => {
    insertSession({ messages: MESSAGES })
    const curator = createCuratorStub([{
      ok: true,
      sessionId: 's1',
      reply: '写了两篇。',
      toolCalls: 4,
      actions: [
        { kind: 'write', scope: 'working', name: '一.md', title: '一', chars: 20 },
        { kind: 'write', scope: 'working', name: '二.md', title: '二', chars: 20 },
        { kind: 'write', scope: 'experience', name: '经验.md', title: '经验', chars: 30 },
        { kind: 'rename', scope: 'working', from: '旧.md', name: '新.md' },
        { kind: 'archive', scope: 'working', from: '过时.md', name: '过时.md' },
      ],
    }])
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    expect(result.run.createdCount).toBe(3)
    expect(result.run.updatedCount).toBe(1)
    expect(result.run.retiredCount).toBe(1)
    expect(result.run.summary).toContain('写工作记忆 2 篇')
    expect(result.run.summary).toContain('沉淀经验 1 条')
    expect(result.run.operations.actions).toHaveLength(5)
    expect(result.run.operations.actions.every((action) => action.sessionId === 's1')).toBe(true)
  })

  it('keeps going when one session fails, and only fails the run if every session did', async () => {
    insertSession({ sessionId: 'a', updatedAtMs: 4000, messages: MESSAGES })
    insertSession({ sessionId: 'b', updatedAtMs: 5000, messages: MESSAGES })
    insertSession({ sessionId: 'c', updatedAtMs: 6000, messages: MESSAGES })
    const mixed = createCuratorStub([
      { ok: false, sessionId: 'a', error: '模型超时', toolCalls: 0, actions: [], durationMs: 1 },
      { ok: true, sessionId: 'b', reply: '好了', toolCalls: 2, actions: [], durationMs: 1 },
      { ok: false, sessionId: 'c', error: '模型超时', toolCalls: 0, actions: [], durationMs: 1 },
    ])
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator: mixed })
    expect(result.run.status).toBe('succeeded')
    expect(result.run.error).toContain('2 个会话处理失败')
  })

  it('fails the run when every session failed', async () => {
    insertSession({ sessionId: 'a', updatedAtMs: 4000, messages: MESSAGES })
    insertSession({ sessionId: 'b', updatedAtMs: 5000, messages: MESSAGES })
    const allFail = createCuratorStub([
      { ok: false, sessionId: 'a', error: 'x', toolCalls: 0, actions: [], durationMs: 1 },
      { ok: false, sessionId: 'b', error: 'x', toolCalls: 0, actions: [], durationMs: 1 },
    ])
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator: allFail })
    expect(result.run.status).toBe('failed')
  })

  it('stops at a session boundary when the wall-clock budget runs out', async () => {
    insertSession({ sessionId: 'a', updatedAtMs: 4000, messages: MESSAGES })
    insertSession({ sessionId: 'b', updatedAtMs: 5000, messages: MESSAGES })
    const curator = createCuratorStub()
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator, maxRunMs: -1 })
    expect(curator.calls).toEqual([])
    expect(result.run.operations.stopped).toContain('时间预算用尽')
    // Nothing was attempted, so this is a skip rather than a failure.
    expect(result.run.status).toBe('skipped')
  })

  it('rebuilds the experience index once at the end', async () => {
    insertSession({ sessionId: 'a', updatedAtMs: 4000, messages: MESSAGES })
    insertSession({ sessionId: 'b', updatedAtMs: 5000, messages: MESSAGES })
    await runDreaming({ trigger: 'manual', now: 10_000, repository, curator: createCuratorStub() })
    expect(indexRefreshes).toHaveLength(1)
  })

  it('guards against concurrent runs', async () => {
    insertSession({ messages: MESSAGES })
    const curator = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true, sessionId: input.session.sessionId, reply: '', toolCalls: 0, actions: [], durationMs: 1 }
    }
    const first = runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    await vi.waitFor(() => expect(isDreamingRunning()).toBe(true))
    const second = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    expect(second).toMatchObject({ skipped: true, reason: 'already_running' })
    await first
    expect(isDreamingRunning()).toBe(false)
  })

  it('passes the detected language down to the curator', async () => {
    insertSession({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '帮我把这个接口改成支持分页，然后跑一下测试' }] },
        { role: 'assistant', content: [{ type: 'text', text: '已经改成支持分页了，测试也通过了。' }] },
      ],
    })
    const curator = createCuratorStub()
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    expect(result.run.contentLanguage).toBe('zh')
    expect(curator.calls[0].contentLanguage).toBe('zh')
  })

  it('lets an explicit language setting override detection', async () => {
    insertSession({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'please refactor this module and run the tests' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Refactored, tests pass.' }] },
      ],
    })
    settingsState.current.contentLanguage = 'zh'
    const curator = createCuratorStub()
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    expect(result.run.contentLanguage).toBe('zh')
    expect(curator.calls[0].contentLanguage).toBe('zh')
  })

  it('pins the model chosen in settings and records which one ran', async () => {
    insertSession({ messages: MESSAGES })
    const pinned = { provider: 'zhipu', id: 'glm-4-plus', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.explicit = pinned
    settingsState.current.modelRef = { version: 1, source: 'custom', providerId: 'prov-1', modelId: 'glm-4-plus' }
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator: createCuratorStub() })
    expect(result.run.modelLabel).toBe('zhipu/glm-4-plus')
  })

  it('falls back to the model last used in chat instead of the first catalog entry', async () => {
    insertSession({ messages: MESSAGES })
    const chatModel = { provider: 'deepseek', id: 'deepseek-chat', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.catalog = { provider: 'zhipu', id: 'glm-4.6v', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    modelState.active = chatModel
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator: createCuratorStub() })
    expect(result.run.modelLabel).toBe('deepseek/deepseek-chat')
  })

  it('falls back when the pinned model was deleted', async () => {
    insertSession({ messages: MESSAGES })
    settingsState.current.modelRef = { version: 1, source: 'custom', providerId: 'gone', modelId: 'gone' }
    modelState.bindingThrows = true
    modelState.active = { provider: 'deepseek', id: 'deepseek-chat', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator: createCuratorStub() })
    expect(result.run.status).toBe('succeeded')
    expect(result.run.modelLabel).toBe('deepseek/deepseek-chat')
  })

  it('fails cleanly when no model is configured', async () => {
    insertSession({ messages: MESSAGES })
    modelState.catalog = null
    modelState.active = null
    const curator = createCuratorStub()
    const result = await runDreaming({ trigger: 'manual', now: 10_000, repository, curator })
    expect(result).toMatchObject({ skipped: false, reason: 'no_model' })
    expect(curator.calls).toEqual([])
    expect(snapshotCalls).toEqual([])
  })
})

describe('model resolution', () => {
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
})
