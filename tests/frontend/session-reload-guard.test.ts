import { describe, expect, it, vi } from 'vitest'
import { shouldSkipSessionReload } from '../../src/lib/session-reload-guard'
import type { BackgroundTask } from '../../src/lib/types'

function createRunningTask(sessionId: string): BackgroundTask {
  return {
    sessionId,
    status: 'idle',
    lastAccessedAt: 1,
    scope: 'global',
    title: sessionId,
    unsubscribe: vi.fn(),
    agent: {
      state: { isStreaming: false },
      dispose: vi.fn(),
    } as unknown as BackgroundTask['agent'],
  }
}

describe('shouldSkipSessionReload', () => {
  it('skips when the running task already backs the current view (repeated click on the same session)', () => {
    const task = createRunningTask('bot-session')
    expect(shouldSkipSessionReload({
      sessionId: 'bot-session',
      runningTask: task,
      currentSessionId: 'bot-session',
      viewAgent: task.agent,
    })).toBe(true)
  })

  it('reloads when the running task is gone (idle agent was evicted)', () => {
    expect(shouldSkipSessionReload({
      sessionId: 'bot-session',
      runningTask: undefined,
      currentSessionId: 'bot-session',
      viewAgent: null,
    })).toBe(false)
  })

  it('reloads when the view shows a different session (real session switch)', () => {
    const task = createRunningTask('bot-session')
    expect(shouldSkipSessionReload({
      sessionId: 'bot-session',
      runningTask: task,
      currentSessionId: 'other-session',
      viewAgent: task.agent,
    })).toBe(false)
  })

  it('reloads when the view agent reference differs (attach still in flight)', () => {
    const task = createRunningTask('bot-session')
    const otherAgent = { state: { isStreaming: false }, dispose: vi.fn() }
    expect(shouldSkipSessionReload({
      sessionId: 'bot-session',
      runningTask: task,
      currentSessionId: 'bot-session',
      viewAgent: otherAgent,
    })).toBe(false)
    expect(shouldSkipSessionReload({
      sessionId: 'bot-session',
      runningTask: task,
      currentSessionId: 'bot-session',
      viewAgent: null,
    })).toBe(false)
  })
})
