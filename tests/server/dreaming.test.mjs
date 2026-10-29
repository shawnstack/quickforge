import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createDreamingRepository } from '../../server/sqlite/dreaming-repository.mjs'
import { collectTranscript, detectContentLanguage } from '../../server/dreaming/collect.mjs'
import { DREAMING_SYSTEM_PROMPT, buildDreamingUserPrompt } from '../../server/dreaming/prompt.mjs'
import { noteIdOf } from '../../server/dreaming/notes.mjs'

let directory
let databasePath
let storage
let repository

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-test-'))
  databasePath = path.join(directory, 'quickforge.sqlite3')
  storage = await initializeSqliteStorage({ dataDir: directory, databasePath })
  repository = createDreamingRepository(storage)
})

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

describe('dreaming schema v18', () => {
  it('keeps only the run log and the note usage table', () => {
    const tables = storage.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all().map((row) => row.name)
    expect(tables).toContain('dreaming_runs')
    // Recall feedback needs one row per note; the notes themselves are a file.
    expect(tables).toContain('dreaming_note_stats')
    // v17: the notes live in MEMORY.md now, so no memory rows, no FTS shadow
    // tables, no audit trail and no vectors.
    for (const dropped of ['memories', 'memories_fts', 'memory_events', 'memory_embeddings']) {
      expect(tables).not.toContain(dropped)
    }
  })

  it('records a run with its window and status', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    expect(run).toMatchObject({ trigger: 'manual', status: 'running', periodFrom: 0, periodTo: 1000 })
    const finished = repository.finishRun(run.id, {
      status: 'succeeded',
      sessionCount: 2,
      createdCount: 3,
      retiredCount: 1,
      operations: { added: ['a'], removed: ['b'], dropped: [] },
      finishedAt: 2000,
      durationMs: 1000,
    })
    expect(finished).toMatchObject({ status: 'succeeded', sessionCount: 2, createdCount: 3, retiredCount: 1 })
    expect(finished.operations).toEqual({ added: ['a'], removed: ['b'], dropped: [], pruned: [], notesAfter: null })
    expect(repository.latestSucceededPeriodTo()).toBe(1000)
    expect(repository.countRuns()).toBe(1)
    expect(repository.listRuns()).toHaveLength(1)
  })

  it('rejects an unknown trigger or status', () => {
    expect(() => repository.createRun({ trigger: 'nope', periodFrom: 0, periodTo: 1, startedAt: 1 })).toThrow(/trigger/)
    const run = repository.createRun({ trigger: 'schedule', periodFrom: 0, periodTo: 1, startedAt: 1 })
    expect(() => repository.finishRun(run.id, { status: 'nope' })).toThrow(/status/)
  })
})

describe('dreaming note stats', () => {
  it('counts a recall per note and keeps the latest timestamp', () => {
    const note = { id: noteIdOf('发布前必须跑完整测试'), text: '发布前必须跑完整测试' }
    repository.recordNoteRecall([note], 1000)
    repository.recordNoteRecall([note], 5000)

    const stats = repository.listNoteStats()
    expect(stats.get(note.id)).toMatchObject({ recallCount: 2, lastRecalledAt: 5000, createdAt: 1000 })
  })

  it('creates a row for every note in the file and drops rows for vanished notes', () => {
    const first = { id: noteIdOf('一'), text: '一' }
    const second = { id: noteIdOf('二'), text: '二' }
    const third = { id: noteIdOf('三'), text: '三' }

    repository.syncNoteStats([first, second], 1000)
    expect([...repository.listNoteStats().keys()].sort()).toEqual([first.id, second.id].sort())

    // '一' disappeared from the file: its row must go with it, so re-adding the
    // same wording later starts from zero instead of inheriting the old count.
    const result = repository.syncNoteStats([second, third], 2000)
    expect(result.removed).toBe(1)
    expect([...repository.listNoteStats().keys()].sort()).toEqual([second.id, third.id].sort())
    expect(repository.listNoteStats().get(third.id)).toMatchObject({ recallCount: 0, createdAt: 2000 })
  })

  it('clears every row when the notes file becomes empty', () => {
    repository.syncNoteStats([{ id: noteIdOf('一'), text: '一' }], 1000)
    repository.syncNoteStats([], 2000)
    expect(repository.listNoteStats().size).toBe(0)
  })

  it('deletes one row', () => {
    const note = { id: noteIdOf('一'), text: '一' }
    repository.syncNoteStats([note], 1000)
    repository.deleteNoteStat(note.id)
    expect(repository.listNoteStats().size).toBe(0)
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

  it('prefers a session where the user pushed back when the budget is tight', () => {
    insertSession({
      sessionId: 'old-correction',
      messages: [{ role: 'user', content: [{ type: 'text', text: '这个实现不对，应该先跑测试' }] }],
      updatedAtMs: 3000,
    })
    insertSession({
      sessionId: 'new-smooth',
      messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }] }],
      updatedAtMs: 9000,
    })
    // Enough for one block only: without the correction weight the newest wins.
    const collected = collectTranscript({ from: 0, to: 10_000, maxTotalChars: 100 })
    expect(collected.sessions).toHaveLength(1)
    expect(collected.sessions[0].sessionId).toBe('old-correction')
    expect(collected.sessions[0].correctionSignals).toBe(1)
  })

  it('only reads sessions inside the window', () => {
    insertSession({ sessionId: 'inside', messages: [{ role: 'user', content: 'a' }], updatedAtMs: 5000 })
    insertSession({ sessionId: 'outside', messages: [{ role: 'user', content: 'b' }], updatedAtMs: 90_000 })
    const collected = collectTranscript({ from: 0, to: 10_000 })
    expect(collected.transcript).toContain('session:inside')
    expect(collected.transcript).not.toContain('session:outside')
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
    const base = { transcript: '', existingNotes: [], periodFrom: 0, periodTo: 1000, allowSensitive: true }
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

  it('asks the model to rewrite foreign-language notes in place instead of duplicating them', () => {
    const prompt = buildDreamingUserPrompt({
      transcript: '',
      existingNotes: ['用户偏好中文'],
      periodFrom: 0,
      periodTo: 1000,
      allowSensitive: true,
      contentLanguage: 'zh',
    })
    expect(prompt).toContain('Notes already written in another language')
    expect(prompt).toContain('rather than adding a translated duplicate')
    // The current list is what the model edits, not a snapshot of row ids.
    expect(prompt).toContain('- 用户偏好中文')

    const noLanguage = buildDreamingUserPrompt({
      transcript: '', existingNotes: ['x'], periodFrom: 0, periodTo: 1000, allowSensitive: true,
    })
    expect(noLanguage).not.toContain('Notes already written in another language')
  })

  it('asks for the list ordered by importance because the tail gets dropped', () => {
    expect(DREAMING_SYSTEM_PROMPT).toContain('ordered from most to least important')
    expect(DREAMING_SYSTEM_PROMPT).toContain('the tail is dropped')
    // Conflicts need a rule, otherwise two runs can flip a note back and forth.
    expect(DREAMING_SYSTEM_PROMPT).toContain('the newest evidence wins')
  })

  it('lists never-recalled notes as deletion candidates only when there are some', () => {
    const base = { transcript: '', existingNotes: ['一'], periodFrom: 0, periodTo: 1000, allowSensitive: true }
    expect(buildDreamingUserPrompt(base)).not.toContain('Never recalled')

    const withUnused = buildDreamingUserPrompt({ ...base, unusedNotes: [{ text: '一', ageDays: 45 }] })
    expect(withUnused).toContain('Never recalled (deletion candidates)')
    expect(withUnused).toContain('(45 days) 一')
    // The signal is absence of searches, not evidence of being wrong.
    expect(withUnused).toContain('not that it is wrong')
  })

  it('tells the model the contract is a bullet list, not JSON operations', () => {
    const prompt = buildDreamingUserPrompt({
      transcript: '', existingNotes: [], periodFrom: 0, periodTo: 1000, allowSensitive: true,
    })
    expect(prompt).toContain('Reply with the bullet list only.')
    expect(prompt).not.toContain('"operations"')
    expect(prompt).toContain('return the full list you want to keep')
  })
})
