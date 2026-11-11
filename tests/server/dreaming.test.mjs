import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createDreamingRepository } from '../../server/sqlite/dreaming-repository.mjs'
import { collectSessionEntries, collectTranscript, detectContentLanguage } from '../../server/dreaming/collect.mjs'

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

describe('dreaming schema', () => {
  it('keeps only the run log', () => {
    const tables = storage.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all().map((row) => row.name)
    expect(tables).toContain('dreaming_runs')
    for (const dropped of ['memories', 'memories_fts', 'memory_events', 'memory_embeddings']) {
      expect(tables).not.toContain(dropped)
    }
  })

  it('records a run with its window and its per-session report', () => {
    const run = repository.createRun({ trigger: 'manual', periodFrom: 0, periodTo: 1000, startedAt: 1000 })
    expect(run).toMatchObject({ trigger: 'manual', status: 'running', periodFrom: 0, periodTo: 1000 })
    const finished = repository.finishRun(run.id, {
      status: 'succeeded',
      sessionCount: 2,
      createdCount: 3,
      retiredCount: 1,
      operations: {
        sessions: [{ ok: true, sessionId: 's1', toolCalls: 2, actions: [], durationMs: 10 }],
        actions: [{ kind: 'write', scope: 'working', name: '一.md', title: '一' }],
        snapshot: '/tmp/snap/run',
        snapshotFiles: { workingMemory: 1, experiences: 0 },
        stopped: null,
      },
      finishedAt: 2000,
      durationMs: 1000,
    })
    expect(finished).toMatchObject({ status: 'succeeded', sessionCount: 2, createdCount: 3, retiredCount: 1 })
    expect(finished.operations).toMatchObject({
      sessions: [{ sessionId: 's1' }],
      actions: [{ kind: 'write', name: '一.md' }],
      snapshot: '/tmp/snap/run',
      stopped: null,
    })
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

describe('transcript projection', () => {
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

describe('per-session collection for the curator', () => {
  it('returns one unmerged entry per session, oldest first', () => {
    insertSession({ sessionId: 'b', messages: [{ role: 'user', content: '后来' }], updatedAtMs: 9000 })
    insertSession({ sessionId: 'a', messages: [{ role: 'user', content: '先' }], updatedAtMs: 3000 })
    const collected = collectSessionEntries({ from: 0, to: 10_000 })
    expect(collected.sessions.map((session) => session.sessionId)).toEqual(['a', 'b'])
    expect(collected.sessions[0].transcript).toContain('user: 先')
    expect(collected.sessions[1].transcript).toContain('user: 后来')
  })

  it('does not drop a session just because earlier ones were long', () => {
    // The merged-transcript budget used to cut sessions off. The curator handles
    // them one at a time, so every session in the window must be reachable.
    for (let index = 0; index < 5; index += 1) {
      insertSession({
        sessionId: `long-${index}`,
        messages: [{ role: 'user', content: 'x'.repeat(20_000) }],
        updatedAtMs: 1000 + index,
      })
    }
    const collected = collectSessionEntries({ from: 0, to: 10_000 })
    expect(collected.sessions).toHaveLength(5)
  })

  it('counts correction signals so the run page can explain why a session mattered', () => {
    insertSession({ sessionId: 'corrected', messages: [{ role: 'user', content: '这个实现不对，应该先跑测试' }], updatedAtMs: 2000 })
    const collected = collectSessionEntries({ from: 0, to: 10_000 })
    expect(collected.sessions[0].correctionSignals).toBe(1)
  })
})

describe('content language', () => {
  it('detects Chinese from the user turns', () => {
    expect(detectContentLanguage(['帮我改一下这个接口', '顺便跑下 npm run test'])).toBe('zh')
    expect(detectContentLanguage(['please refactor this module', 'and run the tests'])).toBe('en')
    expect(detectContentLanguage([''])).toBeNull()
    expect(detectContentLanguage(['ok'])).toBeNull()
  })
})
