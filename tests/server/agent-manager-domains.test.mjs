import { afterEach, describe, expect, it, vi } from 'vitest'
import * as manager from '../../server/agent-manager.mjs'
import { agentSessions } from '../../server/agent-session-store.mjs'
import { pendingApprovals, pendingAutoCompactApprovals } from '../../server/approval-store.mjs'
import { pendingAsks } from '../../server/ask-store.mjs'
import { normalizeAccessMode, yoloModeFromAccessMode } from '../../server/agent-access-mode.mjs'

const id = 'manager-domains-fixture'
const toolId = `${id}-tool`
const askId = `${id}-ask`
const compactId = `${id}-compact`

function session() {
  const value = {
    sessionId: id, scope: 'global', status: 'running', title: 'Fixture',
    stateVersion: 3, persistedMessageStorage: 'split', persistDegraded: true,
    agent: { state: { messages: [], tools: [], pendingToolCalls: new Set(), isStreaming: false } },
    eventBus: {}, runtimeToolExecutions: new Map(),
  }
  agentSessions.set(id, value)
  return value
}

afterEach(() => {
  agentSessions.delete(id)
  pendingApprovals.delete(toolId)
  pendingAutoCompactApprovals.delete(compactId)
  pendingAsks.delete(askId)
})

describe('agent manager domain contracts before and after extraction', () => {
  it('preserves legacy access mode precedence and fallback', () => {
    expect(manager.hasFullAccess({ yoloMode: true })).toBe(true)
    expect(manager.hasFullAccess({ accessMode: 'default', yoloMode: true })).toBe(false)
    expect(manager.hasFullAccess({ accessMode: 'invalid', yoloMode: true })).toBe(true)
    expect(manager.hasFullAccess(null)).toBe(false)
    expect(normalizeAccessMode('true')).toBe('full-access')
    expect(normalizeAccessMode('false')).toBe('default')
    expect(normalizeAccessMode('bad', 'bad')).toBe('default')
    expect(normalizeAccessMode('bad', 'full-access')).toBe('full-access')
    expect(yoloModeFromAccessMode('invalid')).toBe(false)
  })

  it('returns absent-session query results without creating state', () => {
    expect(manager.getSessionState(id)).toBeNull()
    expect(manager.getSessionStatus(id)).toBeNull()
    expect(manager.isSessionFileRollbackBusy(id)).toBe(false)
    expect(manager.tryAcquireSse(id)).toBe(false)
    expect(manager.isSseConnected(id)).toBe(false)
    expect(manager.getSessionEventBus(id)).toBeNull()
    expect(manager.releaseSse(id)).toBeUndefined()
    expect(agentSessions.has(id)).toBe(false)
  })

  it('shares the existing session SSE slot and event bus, including unset slot', () => {
    const value = session()
    expect(manager.isSseConnected(id)).toBeUndefined()
    expect(manager.getSessionEventBus(id)).toBe(value.eventBus)
    expect(manager.tryAcquireSse(id)).toBe(true)
    expect(value.sseConnected).toBe(true)
    expect(manager.tryAcquireSse(id)).toBe(false)
    manager.releaseSse(id)
    expect(manager.isSseConnected(id)).toBe(false)
    expect(manager.tryAcquireSse(id)).toBe(true)
  })

  it('preserves the lightweight status shape and abort UI masking', () => {
    const value = session()
    value.agent.state.messages = [{ role: 'user', timestamp: 123 }]
    value.agent.state.isStreaming = true
    value.abortPending = true
    expect(manager.getSessionStatus(id)).toMatchObject({
      sessionId: id, messageCount: 1, lastMessageTimestamp: 123,
      isStreaming: false, stateVersion: 3, persistDegraded: true,
    })
    expect(manager.getSessionStatus(id)).not.toHaveProperty('messages')
    expect(manager.isSessionFileRollbackBusy(id)).toBe(true)
  })

  it('projects pending queues into state without exposing resolvers', () => {
    session()
    pendingApprovals.set(toolId, { sessionId: id, toolName: 'edit_file', args: {}, resolve: vi.fn() })
    pendingAutoCompactApprovals.set(compactId, { sessionId: id, usage: { percent: 90 } })
    pendingAsks.set(askId, { sessionId: id, questions: [{ question: '?' }], finish: vi.fn() })
    const state = manager.getSessionState(id)
    expect(state).toMatchObject({ sessionId: id, messageStorage: 'split', stateVersion: 3, persistDegraded: true })
    expect(state.pendingToolApproval).toMatchObject({ toolCallId: toolId, toolName: 'edit_file' })
    expect(state.pendingToolApproval).not.toHaveProperty('resolve')
    expect(state.pendingAutoCompactApproval.approvalId).toBe(compactId)
    expect(state.pendingAsk.askId).toBe(askId)
    expect(state.pendingAsk).not.toHaveProperty('finish')
    expect(manager.isSessionFileRollbackBusy(id)).toBe(true)
  })

  it.each([
    ['approveToolCall', pendingApprovals, toolId, true, 'No pending approval for this tool call'],
    ['rejectToolCall', pendingApprovals, toolId, false, 'No pending approval for this tool call'],
    ['approveAutoCompact', pendingAutoCompactApprovals, compactId, true, 'No pending auto compact approval for this session'],
    ['rejectAutoCompact', pendingAutoCompactApprovals, compactId, false, 'No pending auto compact approval for this session'],
  ])('%s resolves only the matching session and keeps exact errors', (name, store, key, approved, message) => {
    const resolve = vi.fn()
    store.set(key, { sessionId: id, resolve })
    expect(() => manager[name]('other-session', key)).toThrow(expect.objectContaining({ message, statusCode: 404 }))
    expect(resolve).not.toHaveBeenCalled()
    const result = manager[name](id, key)
    expect(resolve).toHaveBeenCalledWith(approved)
    expect(result).toEqual({ [approved ? 'approved' : 'rejected']: true, [store === pendingApprovals ? 'toolCallId' : 'approvalId']: key })
    store.delete(key)
    expect(() => manager[name](id, key)).toThrow(expect.objectContaining({ message, statusCode: 404 }))
  })

  it('bounds ask answers without trimming accepted custom text', () => {
    const finish = vi.fn()
    pendingAsks.set(askId, { sessionId: id, questions: [{ question: '?' }], finish })
    const result = manager.answerAsk(id, askId, { answers: [
      { choices: [123, ...Array(10).fill('x'.repeat(600))], custom: ` ${'y'.repeat(4500)}` },
      { custom: 'extra answer' },
    ] })
    expect(result).toEqual({ answered: true, askId, skipped: false })
    expect(finish).toHaveBeenCalledWith({ answers: [{ choices: Array(8).fill('x'.repeat(500)), custom: ` ${'y'.repeat(3999)}` }] })
  })

  it('rejects foreign asks and preserves skip response', () => {
    const finish = vi.fn()
    pendingAsks.set(askId, { sessionId: id, questions: [], finish })
    expect(() => manager.answerAsk('other', askId)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(finish).not.toHaveBeenCalled()
    expect(manager.answerAsk(id, askId, { skipped: true })).toEqual({ answered: true, askId, skipped: true })
    expect(finish).toHaveBeenCalledWith({ skipped: true })
  })
})
