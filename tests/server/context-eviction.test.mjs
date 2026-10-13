import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONTEXT_EVICTION_SETTINGS,
  appendReminderMessage,
  applyContextEviction,
  buildContextUsageNotice,
  ensureMessageIds,
  evaluateContextForgetRule,
  forgottenMessageIds,
  handleContextForget,
  handleContextRecall,
  handleContextReport,
  normalizeContextEviction,
  normalizeContextEvictionSettings,
  toolResultPlaceholder,
  userTurnsAfter,
} from '../../server/context-eviction.mjs'
import { sessionProjectionMessages } from '../../server/auto-compaction.mjs'

function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: 1 }
}

function assistantTextMessage(text) {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp: 1, stopReason: 'stop' }
}

function assistantToolCallMessage(id = 'call-1', name = 'read_file') {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'let me check' },
      { type: 'toolCall', id, name, arguments: { path: 'a.ts' } },
    ],
    timestamp: 1,
    stopReason: 'toolCall',
  }
}

function toolResultMessage(toolCallId = 'call-1', toolName = 'read_file', text = 'x'.repeat(500)) {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    timestamp: 1,
  }
}

describe('context eviction settings', () => {
  it('defaults to disabled and ignores unknown fields', () => {
    expect(normalizeContextEvictionSettings(null)).toEqual(DEFAULT_CONTEXT_EVICTION_SETTINGS)
    expect(normalizeContextEvictionSettings({ enabled: true, exemptRecentTurns: 1, whatever: 'x' })).toEqual({ enabled: true })
    // enabled 默认关闭：只有显式 true 才开启
    expect(normalizeContextEvictionSettings({ exemptRecentTurns: 20 }).enabled).toBe(false)
  })
})

describe('ensureMessageIds', () => {
  it('backfills missing ids once and keeps existing ids stable', () => {
    const messages = [userMessage('u'), assistantTextMessage('a')]
    ensureMessageIds(messages)
    const first = messages.map((message) => message.id)
    expect(first.every((id) => typeof id === 'string' && id.length > 10)).toBe(true)
    ensureMessageIds(messages)
    expect(messages.map((message) => message.id)).toEqual(first)
  })
})

describe('userTurnsAfter / rule evaluation', () => {
  function history() {
    return [
      { id: 'u1', ...userMessage('turn 1') },
      { id: 'a1', ...assistantToolCallMessage('call-1') },
      { id: 'r1', ...toolResultMessage('call-1') },
      { id: 'a1t', ...assistantTextMessage('done 1') },
      { id: 'u2', ...userMessage('turn 2') },
      { id: 'a2', ...assistantToolCallMessage('call-2', 'run_command') },
      { id: 'r2', ...toolResultMessage('call-2', 'run_command') },
      { id: 'u3', ...userMessage('turn 3') },
      { id: 'a3', ...assistantToolCallMessage('call-3', 'grep_files') },
      { id: 'r3', ...toolResultMessage('call-3', 'grep_files') },
    ]
  }

  it('counts user turns after an index', () => {
    const messages = history()
    expect(userTurnsAfter(messages, 2)).toBe(2) // r1 之后有 u2、u3
    expect(userTurnsAfter(messages, 8)).toBe(0) // r3 之后没有 user
  })

  it('forgets tool results by kind, age and tool filter', () => {
    const messages = history()
    // olderThanTurns 1：r1/r2 之后各有 >= 1 个 user 回合；r3 之后 0
    expect(evaluateContextForgetRule(messages, { kind: 'toolResult', olderThanTurns: 1 })).toEqual(['r1', 'r2'])
    // tools 过滤只留 run_command
    expect(evaluateContextForgetRule(messages, { kind: 'toolResult', olderThanTurns: 1, tools: ['run_command'] })).toEqual(['r2'])
    // assistantText 只匹配 assistant 消息
    expect(evaluateContextForgetRule(messages, { kind: 'assistantText', olderThanTurns: 1 })).toEqual(['a1', 'a1t', 'a2'])
    // exceptMessageIds 排除
    expect(evaluateContextForgetRule(messages, { kind: 'toolResult', olderThanTurns: 1, exceptMessageIds: ['r1'] })).toEqual(['r2'])
  })

  it('olderThanTurns 0 applies regardless of age (no server-side floor)', () => {
    const messages = history()
    // 0（或不传）= 不限轮龄：包含最近一轮的 r3/a3
    expect(evaluateContextForgetRule(messages, { kind: 'toolResult', olderThanTurns: 0 })).toEqual(['r1', 'r2', 'r3'])
    expect(evaluateContextForgetRule(messages, { kind: 'toolResult' })).toEqual(['r1', 'r2', 'r3'])
    expect(evaluateContextForgetRule(messages, { kind: 'assistantText', olderThanTurns: 0 })).toEqual(['a1', 'a1t', 'a2', 'a3'])
  })

  it('never targets user or compact summary messages', () => {
    const summary = {
      id: 's1',
      role: 'user',
      content: [{ type: 'text', text: '<compact_summary>earlier</compact_summary>' }],
      details: { quickforgeCompaction: { kind: 'summary' } },
    }
    const messages = [summary, { id: 'u1', ...userMessage('q') }, { id: 'r1', ...toolResultMessage() }]
    expect(evaluateContextForgetRule(messages, { kind: 'toolResult', olderThanTurns: 0 })).toEqual(['r1'])
    expect(evaluateContextForgetRule([summary, { id: 'u1', ...userMessage('q') }], { kind: 'assistantText', olderThanTurns: 0 })).toEqual([])
  })
})

describe('applyContextEviction', () => {
  it('replaces toolResult content with a placeholder while keeping pairing fields', () => {
    const original = { id: 'r1', ...toolResultMessage('call-1', 'run_command') }
    const { messages, replacedIds } = applyContextEviction([original], { forgotten: [{ messageId: 'r1', kind: 'toolResult' }] })
    expect(replacedIds).toEqual(['r1'])
    expect(messages[0]).not.toBe(original)
    expect(messages[0].toolCallId).toBe('call-1')
    expect(messages[0].toolName).toBe('run_command')
    expect(messages[0].content).toEqual([{ type: 'text', text: toolResultPlaceholder(original) }])
    expect(messages[0].content[0].text).toContain('run_command')
    // 原消息不被修改
    expect(original.content[0].text).toBe('x'.repeat(500))
  })

  it('replaces assistant text/thinking with a preview placeholder and keeps toolCall blocks', () => {
    const original = {
      id: 'a1',
      ...assistantToolCallMessage('call-1'),
      content: [
        { type: 'thinking', thinking: 'long reasoning '.repeat(50) },
        { type: 'text', text: 'Here is the conclusion of this step.' },
        { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
      ],
    }
    const { messages } = applyContextEviction([original], { forgotten: [{ messageId: 'a1', kind: 'assistantText' }] })
    const content = messages[0].content
    expect(content).toHaveLength(2)
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('Here is the conclusion')
    expect(content[1]).toEqual({ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } })
  })

  it('is a no-op for unknown ids and non-forgetable roles', () => {
    const user = { id: 'u1', ...userMessage('q') }
    const { messages, replacedIds } = applyContextEviction([user], { forgotten: [{ messageId: 'missing', kind: 'toolResult' }, { messageId: 'u1', kind: 'toolResult' }] })
    expect(replacedIds).toEqual([])
    expect(messages[0]).toBe(user)
  })

  it('sessionProjectionMessages only filters while the feature flag is on', () => {
    const session = {
      contextEvictionEnabled: false,
      contextEviction: { forgotten: [{ messageId: 'r1', kind: 'toolResult' }] },
    }
    const original = { id: 'r1', ...toolResultMessage() }
    const disabledInput = [original]
    expect(sessionProjectionMessages(session, disabledInput)).toBe(disabledInput)
    session.contextEvictionEnabled = true
    const projected = sessionProjectionMessages(session, [original])
    expect(projected[0].content[0].text).toContain('context eviction')
    // 空账本零开销路径返回原数组
    session.contextEviction = { forgotten: [] }
    const emptyLedgerInput = [original]
    expect(sessionProjectionMessages(session, emptyLedgerInput)).toBe(emptyLedgerInput)
  })
})

describe('buildContextUsageNotice', () => {
  function loopHistory() {
    return [
      { id: 'u1', ...userMessage('turn 1') },
      { id: 'a1', ...assistantToolCallMessage('call-1') },
      { id: 'r1', ...toolResultMessage('call-1', 'read_file', 'y'.repeat(4000)) },
      { id: 'u2', ...userMessage('turn 2') },
      { id: 'r2', ...toolResultMessage('call-2', 'run_command', 'z'.repeat(8000)) },
      { id: 'u3', ...userMessage('turn 3') },
    ]
  }

  const settings = { ...DEFAULT_CONTEXT_EVICTION_SETTINGS, enabled: true }

  it('returns null when disabled or usage is missing', () => {
    const session = { contextEviction: null }
    expect(buildContextUsageNotice({ session, loopMessages: loopHistory(), settings: { ...settings, enabled: false }, usage: { contextWindow: 100000, percent: 72 } })).toBeNull()
    expect(buildContextUsageNotice({ session, loopMessages: loopHistory(), settings, usage: {} })).toBeNull()
  })

  it('always reports the usage ratio with a ledger counts line and fixed hint, regardless of how low it is', () => {
    const session = { contextEviction: null }
    const notice = buildContextUsageNotice({ session, loopMessages: loopHistory(), settings, usage: { contextWindow: 100000, percent: 12, inputTokens: 12000 } })
    expect(notice).not.toBeNull()
    expect(notice.message.role).toBe('user')
    expect(notice.message.content[0].text).toContain('<system-reminder>')
    expect(notice.message.content[0].text).toContain('12%')
    // 账本计数行（仅计数，无清单）：a1/r1/r2 三条可裁
    expect(notice.message.content[0].text).toContain('Forgotten ledger: 0 item(s) already replaced by placeholders; 3 forgettable item(s) remaining.')
    // 候选 > 0 时保持固定工具指引
    expect(notice.message.content[0].text).toContain('context_report')
    expect(notice.message.content[0].text).toContain('context_forget')
    expect(notice.message.content[0].text).not.toContain('Largest forgettable')
    expect(notice.message.details).toMatchObject({ forgottenCount: 0, forgettableCandidates: 3 })
  })

  it('never includes the forgettable list regardless of usage level', () => {
    const session = { contextEviction: null }
    const notice = buildContextUsageNotice({ session, loopMessages: loopHistory(), settings, usage: { contextWindow: 100000, percent: 92, inputTokens: 92000 } })
    expect(notice.message.content[0].text).toContain('92%')
    // 高占比也不列清单：查什么、忘什么由 agent 调 context_report 自主决定
    expect(notice.message.content[0].text).not.toContain('Largest forgettable items')
    expect(notice.message.content[0].text).not.toContain('- id ')
    expect(notice.topConsumers).toBeUndefined()
  })

  it('ledger state feeds the counts line but never a list', () => {
    const session = { contextEviction: { forgotten: [{ messageId: 'r1', kind: 'toolResult' }, { messageId: 'r2', kind: 'toolResult' }] } }
    const notice = buildContextUsageNotice({ session, loopMessages: loopHistory(), settings, usage: { contextWindow: 100000, percent: 90 } })
    expect(notice.message.content[0].text).toContain('90%')
    expect(notice.message.content[0].text).toContain('Forgotten ledger: 2 item(s) already replaced by placeholders; 1 forgettable item(s) remaining.')
    expect(notice.message.content[0].text).not.toContain('Largest forgettable')
    expect(notice.message.content[0].text).not.toContain('- id ')
    expect(notice.message.details).toMatchObject({ forgottenCount: 2, forgettableCandidates: 1 })
  })

  it('tells the agent to skip context_forget when nothing forgettable remains', () => {
    const session = { contextEviction: { forgotten: [
      { messageId: 'a1', kind: 'assistantText' },
      { messageId: 'r1', kind: 'toolResult' },
      { messageId: 'r2', kind: 'toolResult' },
    ] } }
    const notice = buildContextUsageNotice({ session, loopMessages: loopHistory(), settings, usage: { contextWindow: 100000, percent: 90 } })
    const text = notice.message.content[0].text
    expect(text).toContain('Forgotten ledger: 3 item(s) already replaced by placeholders; 0 forgettable item(s) remaining.')
    // 候选为 0：明确止步，不再附「frees space」指引催促空转调用
    expect(text).toContain('All forgettable items are already trimmed')
    expect(text).toContain('skip context_forget')
    expect(text).not.toContain('context_report lists forgettable items')
    expect(text).not.toContain('frees space')
  })

  it('does not mutate session state (transient by design)', () => {
    const session = { contextEviction: null }
    buildContextUsageNotice({ session, loopMessages: loopHistory(), settings, usage: { contextWindow: 100000, percent: 72 } })
    expect(session).toEqual({ contextEviction: null })
  })

  it('appendReminderMessage appends a transient trailing user message', () => {
    const messages = [{ id: 'u1', ...userMessage('q') }]
    const withReminder = appendReminderMessage(messages, { role: 'user', content: [{ type: 'text', text: 'reminder' }] })
    expect(withReminder).toHaveLength(2)
    expect(messages).toHaveLength(1)
  })
})

describe('handleContextForget', () => {
  function buildSession() {
    return {
      sessionId: 's1',
      agent: { state: { messages: [
        { id: 'u1', ...userMessage('turn 1') },
        { id: 'a1', ...assistantToolCallMessage('call-1') },
        { id: 'r1', ...toolResultMessage('call-1', 'read_file') },
        { id: 'u2', ...userMessage('turn 2') },
        { id: 'r2', ...toolResultMessage('call-2', 'run_command') },
        { id: 'u3', ...userMessage('turn 3') },
      ] } },
      contextEviction: null,
    }
  }

  const settings = { ...DEFAULT_CONTEXT_EVICTION_SETTINGS, enabled: true }
  const deps = { persistSession: vi.fn().mockResolvedValue(true), emitSessionEvent: vi.fn() }

  it('rejects when the feature is disabled (double-check on execution)', async () => {
    const session = buildSession()
    await expect(handleContextForget({ session, params: { messageIds: ['r1'] }, settings: { enabled: false }, deps }))
      .rejects.toThrow('disabled in Settings')
  })

  it('forgets explicit ids, persists the ledger and emits an event', async () => {
    const session = buildSession()
    const result = await handleContextForget({ session, params: { messageIds: ['r1', 'u1', 'missing'], reason: 'stale read' }, settings, deps })
    expect(result.details.forgotten).toBe(1)
    expect(result.details.forgottenNow[0]).toMatchObject({ id: 'r1', kind: 'toolResult', toolName: 'read_file' })
    expect(result.details.alreadyForgotten).toBe(0)
    expect(session.contextEviction.forgotten).toHaveLength(1)
    expect(session.contextEviction.forgotten[0]).toMatchObject({ messageId: 'r1', kind: 'toolResult', reason: 'stale read' })
    expect(result.details.skipped).toEqual(['u1', 'missing'])
    expect(deps.persistSession).toHaveBeenCalledWith(session)
    expect(deps.emitSessionEvent).toHaveBeenCalledWith(session, expect.objectContaining({ type: 'context_eviction_updated' }))
  })

  it('forgets by rule and is idempotent for repeated targets', async () => {
    const session = buildSession()
    const first = await handleContextForget({ session, params: { rule: { kind: 'toolResult', olderThanTurns: 1 } }, settings, deps })
    expect(first.details.forgotten).toBe(2) // r1、r2
    expect([...forgottenMessageIds(session.contextEviction)].sort()).toEqual(['r1', 'r2'])
    const second = await handleContextForget({ session, params: { messageIds: ['r1'] }, settings, deps })
    expect(second.details.forgotten).toBe(0)
    expect(second.details.alreadyForgotten).toBe(1)
    expect(second.content).toContain('already forgotten')
  })

  it('repeated identical rule reports already-forgotten targets separately', async () => {
    const session = buildSession()
    const first = await handleContextForget({ session, params: { rule: { kind: 'toolResult', olderThanTurns: 1 } }, settings, deps })
    expect(first.details.forgottenNow.map((item) => item.id).sort()).toEqual(['r1', 'r2'])
    expect(first.details.forgottenNow[0]).toMatchObject({ id: 'r1', kind: 'toolResult', toolName: 'read_file' })
    expect(first.details.alreadyForgotten).toBe(0)
    const second = await handleContextForget({ session, params: { rule: { kind: 'toolResult', olderThanTurns: 1 } }, settings, deps })
    expect(second.details.forgotten).toBe(0)
    expect(second.details.alreadyForgotten).toBe(2)
    expect(second.content).toContain('already forgotten')
    expect(second.content).not.toContain('matched nothing')
    expect(second.details.tokensFreed).toBe(0)
    // 账本不重复入账
    expect(session.contextEviction.forgotten).toHaveLength(2)
  })

  it('mixed rule forget returns new and already-forgotten counts separately', async () => {
    const session = buildSession()
    await handleContextForget({ session, params: { messageIds: ['r1'] }, settings, deps })
    const result = await handleContextForget({ session, params: { rule: { kind: 'toolResult', olderThanTurns: 1 } }, settings, deps })
    expect(result.details.forgotten).toBe(1) // r2 新裁
    expect(result.details.alreadyForgotten).toBe(1) // r1 已裁过
    expect(result.content).toContain('already forgotten (no change)')
    expect([...forgottenMessageIds(session.contextEviction)].sort()).toEqual(['r1', 'r2'])
  })

  it('forgets recent-turn content when olderThanTurns is 0', async () => {
    const session = buildSession()
    const result = await handleContextForget({ session, params: { rule: { kind: 'toolResult', olderThanTurns: 0 } }, settings, deps })
    expect(result.details.forgotten).toBe(2) // 无服务端豁免：轮龄不设限
  })

  it('prunes stale ledger entries whose messages no longer exist (rollback)', async () => {
    const session = buildSession()
    session.contextEviction = normalizeContextEviction({ forgotten: [{ messageId: 'gone', kind: 'toolResult' }, { messageId: 'r1', kind: 'toolResult' }] })
    await handleContextForget({ session, params: { messageIds: ['r2'] }, settings, deps })
    expect([...forgottenMessageIds(session.contextEviction)].sort()).toEqual(['r1', 'r2'])
  })

  it('reports helpful content when the rule matches nothing', async () => {
    const session = buildSession()
    const result = await handleContextForget({ session, params: { rule: { kind: 'toolResult', olderThanTurns: 5, tools: ['generate_image'] } }, settings, deps })
    expect(result.details.forgotten).toBe(0)
    expect(result.content).toContain('matched nothing')
  })

  it('without ids or rule it explains the expected input', async () => {
    const session = buildSession()
    const result = await handleContextForget({ session, params: {}, settings, deps })
    expect(result.content).toContain('messageIds or a rule')
  })
})

describe('handleContextRecall', () => {
  function buildSession() {
    return {
      sessionId: 's1',
      agent: { state: { messages: [
        { id: 'u1', ...userMessage('turn 1') },
        { id: 'a1', ...assistantToolCallMessage('call-1') },
        { id: 'r1', ...toolResultMessage('call-1', 'read_file') },
        { id: 'u2', ...userMessage('turn 2') },
        { id: 'r2', ...toolResultMessage('call-2', 'run_command') },
      ] } },
      contextEviction: normalizeContextEviction({ forgotten: [
        { messageId: 'r1', kind: 'toolResult' },
        { messageId: 'r2', kind: 'toolResult' },
      ] }),
    }
  }

  const settings = { ...DEFAULT_CONTEXT_EVICTION_SETTINGS, enabled: true }
  const deps = { persistSession: vi.fn().mockResolvedValue(true), emitSessionEvent: vi.fn() }

  it('recalls explicit ids, persists and emits', async () => {
    const session = buildSession()
    const result = await handleContextRecall({ session, params: { messageIds: ['r1', 'missing'] }, settings, deps })
    expect(result.details.recalled).toBe(1)
    expect(result.details.notFound).toEqual(['missing'])
    expect(result.details.recalledItems).toEqual([{ id: 'r1', kind: 'toolResult', toolName: 'read_file' }])
    expect([...forgottenMessageIds(session.contextEviction)]).toEqual(['r2'])
    expect(deps.persistSession).toHaveBeenCalledWith(session)
    expect(deps.emitSessionEvent).toHaveBeenCalledWith(session, expect.objectContaining({ type: 'context_eviction_updated', recalledNow: ['r1'] }))
  })

  it('recalls everything with all: true', async () => {
    const session = buildSession()
    const result = await handleContextRecall({ session, params: { all: true }, settings, deps })
    expect(result.details.recalled).toBe(2)
    expect(session.contextEviction.forgotten).toEqual([])
  })

  it('explains the expected input when the ledger is empty', async () => {
    const session = buildSession()
    session.contextEviction = { forgotten: [] }
    const result = await handleContextRecall({ session, params: {}, settings, deps })
    expect(result.content).toContain('Nothing is currently forgotten')
  })

  it('reports ids that are not in the ledger', async () => {
    const session = buildSession()
    const result = await handleContextRecall({ session, params: { messageIds: ['nope'] }, settings, deps })
    expect(result.details.recalled).toBe(0)
    expect(result.content).toContain('in the forgotten ledger')
  })
})

describe('handleContextReport', () => {
  const settings = { ...DEFAULT_CONTEXT_EVICTION_SETTINGS, enabled: true }

  function buildSession() {
    return {
      sessionId: 's1',
      model: { contextWindow: 100000 },
      agent: { state: {
        systemPrompt: 'system',
        tools: [],
        messages: [
          { id: 'u1', ...userMessage('turn 1') },
          { id: 'a1', ...assistantToolCallMessage('call-1') },
          { id: 'r1', ...toolResultMessage('call-1', 'read_file', 'y'.repeat(4000)) },
          { id: 'u2', ...userMessage('turn 2') },
          { id: 'r2', ...toolResultMessage('call-2', 'run_command', 'z'.repeat(8000)) },
          { id: 'u3', ...userMessage('turn 3') },
        ],
      } },
      contextEviction: normalizeContextEviction({ forgotten: [{ messageId: 'r1', kind: 'toolResult' }] }),
    }
  }

  it('lists forget candidates sorted by size and summarizes the ledger', async () => {
    const session = buildSession()
    const result = await handleContextReport({ session, settings })
    expect(result.details.type).toBe('context_report_result')
    expect(result.details.forgottenCount).toBe(1)
    expect(result.details.forgetCandidates.map((item) => item.id)).toEqual(['r2', 'a1'])
    expect(result.content).toContain('Context usage')
    expect(result.content).toContain('id r2')
    // r1 已被遗忘：不在候选，但计入账本 tokens
    expect(result.details.forgottenTokens).toBeGreaterThan(0)
  })

  it('reports no candidates when only protected messages remain', async () => {
    const session = buildSession()
    session.agent.state.messages = [
      { id: 'u1', ...userMessage('only turn') },
    ]
    const result = await handleContextReport({ session, settings })
    expect(result.details.forgetCandidates).toEqual([])
    expect(result.content).toContain('only user messages and compact summaries remain')
  })
})
