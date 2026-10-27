import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import {
  createDreamingRepository,
  memoryFingerprint,
} from '../../server/sqlite/dreaming-repository.mjs'
import { applyDreamingOperations, parseDreamingOutput } from '../../server/dreaming/apply.mjs'
import { collectTranscript, detectContentLanguage } from '../../server/dreaming/collect.mjs'
import { buildDreamingUserPrompt } from '../../server/dreaming/prompt.mjs'
import { recallExperiences, rankMemories } from '../../server/dreaming/recall.mjs'

let directory
let databasePath
let storage
let repository

async function setup() {
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-test-'))
  databasePath = path.join(directory, 'quickforge.sqlite3')
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath })
  repository = createDreamingRepository(storage)
}

beforeEach(setup)

afterEach(async () => {
  await closeSqliteStorage()
  await rm(directory, { recursive: true, force: true })
})

function insertSession({ sessionId = 's1', projectId = 'p1', messages = [], updatedAtMs = 1000 }) {
  storage.prepare(`INSERT INTO sessions (
      scope, project_id, session_id, title, created_at, updated_at, message_count,
      state_version, body_json, meta_json, revision, updated_at_ms
    ) VALUES ('project', ?, ?, 'test session', '2026-10-26T00:00:00.000Z', '2026-10-26T00:10:00.000Z', ?, 1, '{"split":true}', '{}', 1, ?)`)
    .run(projectId, sessionId, messages.length, updatedAtMs)
  messages.forEach((message, index) => {
    storage.prepare(`INSERT INTO session_messages (scope, project_id, session_id, seq, message_id, message_json, message_digest)
      VALUES ('project', ?, ?, ?, ?, ?, ?)`)
      .run(projectId, sessionId, index, `${sessionId}-m${index}`, JSON.stringify(message), 'a'.repeat(64))
  })
}

function createOperation(overrides = {}) {
  return {
    action: 'create',
    kind: 'pitfall',
    scope: 'project',
    projectId: 'p1',
    content: '发布前必须完整运行 npm run test、npm run lint 和 npm run build。',
    evidence: [{ sessionId: 's1', seq: 3, note: 'tool result' }],
    confidence: 0.9,
    ...overrides,
  }
}

describe('dreaming schema v13', () => {
  it('creates the memory, run and audit tables', () => {
    const tables = storage.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name")
      .all().map((row) => row.name)
    expect(tables).toContain('memories')
    expect(tables).toContain('memories_fts')
    expect(tables).toContain('memory_events')
    expect(tables).toContain('dreaming_runs')
  })

  it('rejects project-scope rows without a project id', () => {
    expect(() => storage.prepare(`INSERT INTO memories (
        id, scope, project_id, kind, content, fingerprint, evidence_json, confidence, strength, status, created_at, updated_at
      ) VALUES ('mem_x', 'project', '', 'fact', 'x', ?, '[]', 0.5, 1, 'active', 1, 1)`)
      .run('b'.repeat(64))).toThrow()
  })
})

describe('dreaming repository', () => {
  it('deduplicates by normalized fingerprint', () => {
    const first = repository.insertMemory({
      scope: 'project',
      projectId: 'p1',
      kind: 'fact',
      content: '  Uses   SQLite   FTS5  ',
      evidence: [],
      confidence: 0.8,
      strength: 1,
      now: 1000,
    })
    expect(first.content).toBe('Uses SQLite FTS5')
    expect(repository.findByFingerprint('project', 'p1', memoryFingerprint('uses sqlite fts5'))?.id).toBe(first.id)
    expect(repository.findByFingerprint('project', 'p2', first.fingerprint)).toBeNull()
  })

  it('finds CJK substrings through the trigram FTS index', () => {
    repository.insertMemory({
      scope: 'global',
      projectId: '',
      kind: 'preference',
      content: '用户偏好用中文沟通，并要求 python 项目创建虚拟环境',
      evidence: [],
      confidence: 0.9,
      strength: 1,
      now: 1000,
    })
    const found = repository.listMemories({ scope: 'global', query: '虚拟环境' })
    expect(found).toHaveLength(1)
    expect(found[0].content).toContain('虚拟环境')
  })

  it('keeps the FTS index in sync after an update', () => {
    const memory = repository.insertMemory({
      scope: 'global',
      projectId: '',
      kind: 'fact',
      content: 'old wording about vite',
      evidence: [],
      confidence: 0.5,
      strength: 1,
      now: 1000,
    })
    repository.updateMemory(memory.id, { content: 'new wording about rollup' }, 2000)
    expect(repository.listMemories({ scope: 'global', query: 'vite' })).toHaveLength(0)
    expect(repository.listMemories({ scope: 'global', query: 'rollup' })).toHaveLength(1)
  })

  it('only retires memories that fail strength, confidence and recency together', () => {
    const weak = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'fact', content: 'weak', evidence: [],
      confidence: 0.2, strength: 0.5, now: 1000,
    })
    const confident = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'fact', content: 'confident', evidence: [],
      confidence: 0.9, strength: 0.5, now: 1000,
    })
    const strong = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'fact', content: 'strong', evidence: [],
      confidence: 0.2, strength: 5, now: 1000,
    })
    const retired = repository.retireWeakMemories({ now: 10_000_000, staleBefore: 2_000_000 })
    expect(retired).toEqual([weak.id])
    expect(repository.findById(confident.id).status).toBe('active')
    expect(repository.findById(strong.id).status).toBe('active')
  })

  it('records recall as a usage signal', () => {
    const memory = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'experience', content: 'x', evidence: [],
      confidence: 0.6, strength: 1, now: 1000,
    })
    repository.recordRecall([memory.id, 'mem_missing'], 5000)
    const after = repository.findById(memory.id)
    expect(after.recallCount).toBe(1)
    expect(after.lastRecalledAt).toBe(5000)
    expect(after.strength).toBeCloseTo(1.2)
  })
})

describe('dreaming apply', () => {
  it('applies a create and logs an event', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    const result = applyDreamingOperations([createOperation()], { repository, runId: run.id, now: 2000 })
    expect(result.created).toBe(1)
    expect(result.rejected).toHaveLength(0)
    const memory = repository.findById(result.createdIds[0])
    expect(memory).toMatchObject({ kind: 'pitfall', scope: 'project', status: 'active' })
    expect(memory.evidence).toHaveLength(1)
    expect(repository.listEvents(memory.id).map((event) => event.action)).toContain('create')
  })

  it('downgrades a duplicate create to an update instead of adding a row', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    const first = applyDreamingOperations([createOperation()], { repository, runId: run.id, now: 2000 })
    const second = applyDreamingOperations([createOperation()], { repository, runId: run.id, now: 3000 })
    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(1)
    expect(second.updatedIds[0]).toBe(first.createdIds[0])
    expect(repository.countMemories()).toBe(1)
    expect(repository.findById(first.createdIds[0]).strength).toBeCloseTo(1.5)
  })

  it('rejects invalid operations with reasons and still applies valid ones', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    const result = applyDreamingOperations([
      createOperation(),
      createOperation({ kind: 'nonsense' }),
      createOperation({ evidence: [] }),
      createOperation({ scope: 'project', projectId: '' }),
      createOperation({ action: 'update', targetId: 'mem_ghost' }),
      createOperation({ content: 'x'.repeat(600) }),
    ], { repository, runId: run.id, now: 2000 })
    expect(result.created).toBe(1)
    expect(result.rejected).toHaveLength(5)
    expect(result.rejected.map((entry) => entry.index)).toEqual([1, 2, 3, 4, 5])
    expect(result.rejected.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0)).toBe(true)
    expect(repository.listMemories({ status: 'any' })).toHaveLength(1)
  })

  it('caps confidence by evidence breadth', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    const result = applyDreamingOperations([
      createOperation({ confidence: 0.99, evidence: [{ sessionId: 's1', seq: 1 }] }),
    ], { repository, runId: run.id, now: 2000 })
    expect(repository.findById(result.createdIds[0]).confidence).toBeCloseTo(0.7)
  })

  it('supersedes instead of deleting and refuses to touch retired rows', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    const oldOne = applyDreamingOperations([createOperation({ content: '发布只需 build' })], { repository, runId: run.id, now: 2000 })
    const newOne = applyDreamingOperations([createOperation({ content: '发布需 test、lint、build' })], { repository, runId: run.id, now: 3000 })
    const superseded = applyDreamingOperations([
      { action: 'supersede', targetId: oldOne.createdIds[0], replacementId: newOne.createdIds[0] },
    ], { repository, runId: run.id, now: 4000 })
    expect(superseded.retired).toBe(1)
    expect(repository.findById(oldOne.createdIds[0]).status).toBe('superseded')
    expect(repository.findById(oldOne.createdIds[0]).supersededBy).toBe(newOne.createdIds[0])

    const secondAttempt = applyDreamingOperations([
      { action: 'retire', targetId: oldOne.createdIds[0] },
    ], { repository, runId: run.id, now: 5000 })
    expect(secondAttempt.retired).toBe(0)
    expect(secondAttempt.rejected[0].reason).toContain('superseded')
  })

  it('drops sensitive content only when the setting forbids it', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    const secret = createOperation({ content: 'The deploy token is sk-abcdefghijklmnopqrstuvwx' })
    const blocked = applyDreamingOperations([secret], { repository, runId: run.id, now: 2000, allowSensitive: false })
    expect(blocked.created).toBe(0)
    expect(blocked.rejected[0].reason).toContain('凭据')

    const allowed = applyDreamingOperations([secret], { repository, runId: run.id, now: 3000, allowSensitive: true })
    expect(allowed.created).toBe(1)
  })
})

describe('dreaming output parsing', () => {
  it('accepts a fenced JSON reply', () => {
    const parsed = parseDreamingOutput('```json\n{"summary":"s","operations":[{"action":"create"}]}\n```')
    expect(parsed.summary).toBe('s')
    expect(parsed.operations).toHaveLength(1)
  })

  it('rejects a reply without JSON', () => {
    expect(() => parseDreamingOutput('nothing useful here')).toThrow(/no JSON object/i)
  })

  it('caps the operation list', () => {
    const operations = Array.from({ length: 40 }, () => ({ action: 'create' }))
    expect(parseDreamingOutput(JSON.stringify({ operations })).operations).toHaveLength(25)
  })
})

describe('dreaming transcript collection', () => {
  it('projects only user turns and assistant final answers', () => {
    insertSession({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '实现 dreaming 功能' }] },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'run_command', arguments: { command: 'npm run test' } }] },
        { role: 'toolResult', toolName: 'run_command', content: [{ type: 'text', text: `RESULT_START${'x'.repeat(2000)}RESULT_END` }] },
        { role: 'assistant', content: [{ type: 'text', text: '测试全部通过，接下来改 schema。' }] },
        { role: 'user', content: [{ type: 'text', text: '好' }] },
        { role: 'assistant', content: [{ type: 'text', text: '已按方案改完。' }], stopReason: 'stop' },
      ],
      updatedAtMs: 5000,
    })
    const collected = collectTranscript({ from: 0, to: 10_000 })
    expect(collected.sessionCount).toBe(1)
    expect(collected.transcript).toContain('user: 实现 dreaming 功能')
    expect(collected.transcript).toContain('assistant: 测试全部通过')
    expect(collected.transcript).toContain('assistant: 已按方案改完')
    // Tool calls and their output must never reach the prompt.
    expect(collected.transcript).not.toContain('tool(run_command)')
    expect(collected.transcript).not.toContain('RESULT_START')
    expect(collected.sessions[0].preview.length).toBeLessThanOrEqual(1300)
  })

  it('keeps compaction summaries and drops tool-only and aborted answers', () => {
    insertSession({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '<compact_summary>之前做完了 dreaming 的存储层</compact_summary>' }],
          details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
        },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'read_file', arguments: { path: 'a.mjs' } }] },
        { role: 'assistant', content: [{ type: 'text', text: '被中断的中间推理' }], stopReason: 'aborted' },
        { role: 'assistant', content: [{ type: 'text', text: '最终结论：用 FTS5。' }] },
      ],
      updatedAtMs: 5000,
    })
    const collected = collectTranscript({ from: 0, to: 10_000 })
    expect(collected.transcript).toContain('history(compacted): 之前做完了 dreaming 的存储层')
    expect(collected.transcript).toContain('assistant: 最终结论：用 FTS5。')
    expect(collected.transcript).not.toContain('被中断的中间推理')
    expect(collected.transcript).not.toContain('read_file')
  })

  it('only reads sessions inside the window', () => {
    insertSession({ sessionId: 'inside', messages: [{ role: 'user', content: 'a' }], updatedAtMs: 5000 })
    insertSession({ sessionId: 'outside', messages: [{ role: 'user', content: 'b' }], updatedAtMs: 90_000 })
    const collected = collectTranscript({ from: 0, to: 10_000 })
    expect(collected.transcript).toContain('session:inside')
    expect(collected.transcript).not.toContain('session:outside')
  })
})

describe('dreaming recall', () => {
  it('prefers project scope and marks recalled entries', () => {
    const globalMemory = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'preference', content: '用中文沟通',
      evidence: [], confidence: 0.8, strength: 2, now: 1000,
    })
    const projectMemory = repository.insertMemory({
      scope: 'project', projectId: 'p1', kind: 'fact', content: '本项目使用 SQLite 存储',
      evidence: [], confidence: 0.8, strength: 1, now: 1000,
    })
    const recalled = recallExperiences({ projectId: 'p1', now: 2000, repository, markRecalled: true })
    // Both scopes are searched; ordering stays honest (higher strength first)
    // rather than hard-coding project-first.
    expect(recalled.map((memory) => memory.id).sort()).toEqual([globalMemory.id, projectMemory.id].sort())
    expect(repository.findById(projectMemory.id).recallCount).toBe(1)
    expect(repository.findById(globalMemory.id).recallCount).toBe(1)
  })

  it('decays older memories in the ranking', () => {
    const oldMemory = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'fact', content: 'old', evidence: [],
      confidence: 0.8, strength: 2, now: 0,
    })
    const newMemory = repository.insertMemory({
      scope: 'global', projectId: '', kind: 'fact', content: 'new', evidence: [],
      confidence: 0.8, strength: 2, now: 90 * 24 * 60 * 60 * 1000,
    })
    const ranked = rankMemories([oldMemory, newMemory], { now: 90 * 24 * 60 * 60 * 1000 })
    expect(ranked[0].id).toBe(newMemory.id)
  })
})
describe('dreaming content language', () => {
  it('detects Chinese from the user turns', () => {
    expect(detectContentLanguage(['帮我改一下这个接口', '顺便跑下 npm run test'])).toBe('zh')
    expect(detectContentLanguage(['please refactor this module', 'and run the tests'])).toBe('en')
    expect(detectContentLanguage([''])).toBeNull()
    expect(detectContentLanguage(['ok'])).toBeNull()
  })

  it('states the language as a hard requirement in the user prompt', () => {
    const base = { transcript: '', existingMemories: [], periodFrom: 0, periodTo: 1000, allowSensitive: true }
    const zh = buildDreamingUserPrompt({ ...base, contentLanguage: 'zh' })
    expect(zh).toContain('## Output language')
    expect(zh).toContain('Simplified Chinese')
    expect(zh).toContain('hard requirement')
    expect(zh.indexOf('## Output language')).toBeLessThan(zh.indexOf('<transcript>'))

    const en = buildDreamingUserPrompt({ ...base, contentLanguage: 'en' })
    expect(en).toContain('English')
    expect(en).not.toContain('Simplified Chinese')

    const unknown = buildDreamingUserPrompt({ ...base, contentLanguage: null })
    expect(unknown).toContain('the language the user uses in the transcript')
  })

  it('asks the model to rewrite existing foreign-language rows instead of duplicating them', () => {
    const prompt = buildDreamingUserPrompt({
      transcript: '',
      existingMemories: ['- mem_1 [fact/global] User prefers Chinese'],
      periodFrom: 0,
      periodTo: 1000,
      allowSensitive: true,
      contentLanguage: 'zh',
    })
    expect(prompt).toContain('Entries already written in another language')
    expect(prompt).toContain('instead of creating a second entry')

    const noLanguage = buildDreamingUserPrompt({
      transcript: '', existingMemories: ['- mem_1 [fact/global] x'], periodFrom: 0, periodTo: 1000, allowSensitive: true,
    })
    expect(noLanguage).not.toContain('Entries already written in another language')
  })
});
