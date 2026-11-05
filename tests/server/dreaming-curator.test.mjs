import { describe, expect, it } from 'vitest'
import {
  CURATOR_MAX_TOOL_CALLS,
  createCuratorToolGuard,
  curatorSessionIdFor,
} from '../../server/dreaming/curator.mjs'
import { CURATOR_SYSTEM_PROMPT, buildCuratorUserPrompt } from '../../server/dreaming/prompt.mjs'
import { MEMORY_NOTE_TOOL_NAMES } from '../../server/tools/memory-notes.mjs'

/**
 * The curator edits the user's memory unattended, so the parts worth testing are
 * the ones that hold even when the model misbehaves: which tools it can reach, how
 * much it can do, and what the prompt promises it cannot do.
 */

const toolCall = (name) => ({ toolCall: { id: 't1', name, arguments: {} } })

describe('curator tool guard', () => {
  it('allows only the memory note tools', async () => {
    const guard = createCuratorToolGuard()
    for (const name of MEMORY_NOTE_TOOL_NAMES) {
      await expect(guard.beforeToolCall(toolCall(name))).resolves.toBeUndefined()
    }
    for (const name of ['run_command', 'write_file', 'read_file', 'activate_skill']) {
      await expect(guard.beforeToolCall(toolCall(name))).resolves.toMatchObject({ block: true })
    }
    expect(guard.state.blocked.every((entry) => entry.reason === 'not_allowed')).toBe(true)
  })

  it('stops at the tool-call budget instead of running forever', async () => {
    const guard = createCuratorToolGuard({ maxToolCalls: 2 })
    await expect(guard.beforeToolCall(toolCall('list_memory_notes'))).resolves.toBeUndefined()
    await expect(guard.beforeToolCall(toolCall('read_memory_note'))).resolves.toBeUndefined()
    await expect(guard.beforeToolCall(toolCall('read_memory_note'))).resolves.toMatchObject({ block: true })
    expect(guard.state.toolCalls).toBe(3)
    expect(guard.state.blocked.at(-1)?.reason).toBe('over_budget')
    expect(CURATOR_MAX_TOOL_CALLS).toBeGreaterThan(2)
  })

  it('uses a namespaced agent session id so curator turns never appear as chats', () => {
    expect(curatorSessionIdFor('run1', 'sess1')).toBe('dreaming:run1:sess1')
  })
})

describe('curator prompt contract', () => {
  it('says one session only and forbids touching the skills folder', () => {
    expect(CURATOR_SYSTEM_PROMPT).toMatch(/one finished session/i)
    expect(CURATOR_SYSTEM_PROMPT).toContain('~/.quickforge/skills')
    expect(CURATOR_SYSTEM_PROMPT).toMatch(/never create or edit/i)
  })

  it('forbids deleting and names archiving as the way out', () => {
    expect(CURATOR_SYSTEM_PROMPT).toMatch(/Never delete/)
    expect(CURATOR_SYSTEM_PROMPT).toContain('_archive/')
  })

  it('tells the model the index is generated, so it must not write it', () => {
    expect(CURATOR_SYSTEM_PROMPT).toMatch(/index\.md.*generated|generated.*index\.md/is)
  })

  it('puts the session header, language directive and transcript in the user message', () => {
    const prompt = buildCuratorUserPrompt({
      session: {
        sessionId: 'sess-1',
        projectId: 'proj-1',
        title: '发布小版本',
        updatedAt: Date.UTC(2026, 0, 2),
        messageCount: 12,
      },
      transcript: 'user: 发布一个小版本',
      periodFrom: Date.UTC(2026, 0, 2),
      periodTo: Date.UTC(2026, 0, 3),
      contentLanguage: 'zh',
    })
    expect(prompt).toContain('Session: sess-1')
    expect(prompt).toContain('Project: proj-1')
    expect(prompt).toContain('发布小版本')
    expect(prompt).toContain('Simplified Chinese')
    expect(prompt).toContain('<transcript>')
  })

  it('leaves the language unconstrained when detection failed', () => {
    const prompt = buildCuratorUserPrompt({
      session: { sessionId: 's', projectId: null, title: '', updatedAt: 0, messageCount: 1 },
      transcript: 'user: hi',
      periodFrom: 0,
      periodTo: 1,
      contentLanguage: null,
    })
    expect(prompt).toContain('the language the user uses')
  })
})
