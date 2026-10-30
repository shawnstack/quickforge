import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingAsks, clearAskQueues, ASK_QUEUE_MAX_WAITING } from '../../server/ask-store.mjs'
import { APPROVAL_TIMEOUT_MS, pendingApprovals, pendingAutoCompactApprovals } from '../../server/approval-store.mjs'

const mocks = vi.hoisted(() => ({
  emitSessionEvent: vi.fn(),
  notifyGoalApprovalOutcome: vi.fn(),
  notifyGoalApprovalRequested: vi.fn(),
  notifyGoalAskOutcome: vi.fn(),
  notifyGoalAskRequested: vi.fn(),
}))

vi.mock('../../server/agent-session-events.mjs', () => ({
  emitSessionEvent: mocks.emitSessionEvent,
}))
vi.mock('../../server/goal/engine.mjs', () => ({
  notifyGoalApprovalOutcome: mocks.notifyGoalApprovalOutcome,
  notifyGoalApprovalRequested: mocks.notifyGoalApprovalRequested,
  notifyGoalAskOutcome: mocks.notifyGoalAskOutcome,
  notifyGoalAskRequested: mocks.notifyGoalAskRequested,
}))

const {
  createApprovalPromise,
  createAskUserPromise,
  createAutoCompactApprovalPromise,
} = await import('../../server/agent-approval-orchestrator.mjs')

function makeSession(overrides = {}) {
  return {
    sessionId: 'session-1',
    agent: {},
    ...overrides,
  }
}

function firstPendingApproval() {
  return pendingApprovals.values().next().value
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  pendingApprovals.clear()
  pendingAutoCompactApprovals.clear()
  pendingAsks.clear()
  clearAskQueues()
})

describe('createApprovalPromise', () => {
  it('blocks immediately without a session', () => {
    const result = createApprovalPromise(null, 'call-1', 'write_file', {}, 'agent')
    expect(result).toEqual({ block: true, reason: 'No active session for tool approval.' })
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.emitSessionEvent).not.toHaveBeenCalled()
  })

  it('registers the pending approval and emits the required event', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', { path: 'a.txt' }, 'agent')

    expect(pendingApprovals.has('call-1')).toBe(true)
    const entry = firstPendingApproval()
    expect(entry.toolName).toBe('write_file')
    expect(entry.args).toEqual({ path: 'a.txt' })
    expect(entry.source).toBe('agent')
    expect(entry.sessionId).toBe('session-1')
    expect(entry.expiresAt - entry.requestedAt).toBe(APPROVAL_TIMEOUT_MS)

    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, {
      type: 'tool_approval_required',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'write_file',
      args: { path: 'a.txt' },
      source: 'agent',
    })
    expect(mocks.notifyGoalApprovalRequested).toHaveBeenCalledTimes(1)
    expect(mocks.notifyGoalApprovalRequested).toHaveBeenCalledWith(session)

    // The promise stays pending until a decision or timeout arrives.
    const sentinel = Symbol('pending')
    const stillPending = await Promise.race([promise, Promise.resolve(sentinel)])
    expect(stillPending).toBe(sentinel)
    pendingApprovals.get('call-1').resolve(true)
    await expect(promise).resolves.toBeUndefined()
  })

  it('resolves with undefined when the user approves', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    firstPendingApproval().resolve(true)

    await expect(promise).resolves.toBeUndefined()
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledTimes(1)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'approved' })
  })

  it('resolves with a block reason when the user rejects', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    firstPendingApproval().resolve(false)

    await expect(promise).resolves.toEqual({ block: true, reason: 'User rejected write_file' })
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'rejected' })
  })

  it('propagates errors through the stored reject callback', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    const failure = new Error('route failure')
    firstPendingApproval().reject(failure)

    await expect(promise).rejects.toBe(failure)
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).not.toHaveBeenCalled()
  })

  it('fails closed by resolving as blocked after the 5 minute timeout', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')

    // One millisecond before the deadline the approval is still pending.
    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS - 1)
    expect(pendingApprovals.size).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toEqual({ block: true, reason: 'Approval timeout for write_file' })
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledTimes(1)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'timeout' })
  })

  it('keeps the settled value after the timeout even if a late decision arrives', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    const storedResolve = firstPendingApproval().resolve

    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS)
    await expect(promise).resolves.toEqual({ block: true, reason: 'Approval timeout for write_file' })

    // The promise itself never re-settles, but the stored resolve callback still
    // emits a goal outcome notification even after the fail-closed timeout
    // (source behavior: notifyGoalApprovalOutcome runs unconditionally).
    storedResolve(true)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toEqual({ block: true, reason: 'Approval timeout for write_file' })
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledTimes(2)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenLastCalledWith(session, { outcome: 'approved' })
  })

  it('settles only once: the timeout cannot override an earlier decision', async () => {
    const session = makeSession()
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    firstPendingApproval().resolve(true)

    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS + 1000)
    await expect(promise).resolves.toBeUndefined()
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledTimes(1)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'approved' })
  })

  it('rejects immediately when the run is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const session = makeSession({ agent: { signal: controller.signal } })

    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    await expect(promise).rejects.toThrow('Run aborted')

    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'aborted' })
    expect(mocks.emitSessionEvent).not.toHaveBeenCalled()
    expect(mocks.notifyGoalApprovalRequested).not.toHaveBeenCalled()
  })

  it('rejects when the user stops the run while the approval is pending', async () => {
    const controller = new AbortController()
    const session = makeSession({ agent: { signal: controller.signal } })
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    expect(pendingApprovals.size).toBe(1)

    controller.abort()
    await expect(promise).rejects.toThrow('Run aborted')
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'aborted' })
  })

  it('rejects when a workflow step signal aborts while the session run stays active', async () => {
    const sessionController = new AbortController()
    const workflowController = new AbortController()
    const session = makeSession({ agent: { signal: sessionController.signal } })
    const promise = createApprovalPromise(
      session,
      'call-1',
      'write_file',
      {},
      { type: 'subagent', workflowLabel: 'wf-1' },
      { signal: workflowController.signal },
    )
    expect(pendingApprovals.size).toBe(1)

    workflowController.abort()
    await expect(promise).rejects.toThrow('Run aborted')
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledWith(session, { outcome: 'aborted' })
  })

  it('rejects immediately when the workflow step signal is already aborted', async () => {
    const workflowController = new AbortController()
    workflowController.abort()
    const session = makeSession({ agent: { signal: new AbortController().signal } })

    await expect(createApprovalPromise(
      session,
      'call-1',
      'write_file',
      {},
      { type: 'subagent' },
      { signal: workflowController.signal },
    )).rejects.toThrow('Run aborted')
    expect(pendingApprovals.size).toBe(0)
    expect(mocks.emitSessionEvent).not.toHaveBeenCalled()
  })

  it('removes the abort listener once the approval is decided', async () => {
    const controller = new AbortController()
    const session = makeSession({ agent: { signal: controller.signal } })
    const promise = createApprovalPromise(session, 'call-1', 'write_file', {}, 'agent')
    firstPendingApproval().resolve(true)
    await expect(promise).resolves.toBeUndefined()

    // Aborting afterwards must not produce unhandled rejections or extra outcomes.
    controller.abort()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.notifyGoalApprovalOutcome).toHaveBeenCalledTimes(1)
  })
})

describe('createAskUserPromise', () => {
  it('skips immediately when the params contain no usable question', async () => {
    const result = await createAskUserPromise(makeSession(), 'call-1', {})
    expect(result.details).toEqual({ askId: null, skipped: true })
    expect(result.content[0].text).toContain('问题列表无效')
    expect(pendingAsks.size).toBe(0)
    expect(mocks.emitSessionEvent).not.toHaveBeenCalled()
  })

  it('registers the ask and resolves with formatted answers', async () => {
    const session = makeSession({ sessionId: 'session-7' })
    const params = { questions: [{ question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }] }] }
    const promise = createAskUserPromise(session, 'call-1', params)

    expect(pendingAsks.size).toBe(1)
    const [askId, entry] = pendingAsks.entries().next().value
    expect(entry.sessionId).toBe('session-7')
    expect(entry.toolCallId).toBe('call-1')
    expect(entry.questions[0].question).toBe('Which option?')
    expect(entry.expiresAt - entry.requestedAt).toBe(30 * 60 * 1000)
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, {
      type: 'ask_user_required',
      sessionId: 'session-7',
      askId,
      toolCallId: 'call-1',
      questions: entry.questions,
    })

    entry.finish({ answers: [{ choices: ['A'] }] })
    const result = await promise
    expect(result.details).toMatchObject({ askId, skipped: false, answers: [{ choices: ['A'] }] })
    expect(result.content[0].text).toContain('Which option? → A')
    expect(pendingAsks.size).toBe(0)
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, {
      type: 'ask_user_answered',
      sessionId: 'session-7',
      askId,
      toolCallId: 'call-1',
      skipped: false,
      answers: [{ choices: ['A'] }],
    })
    expect(mocks.notifyGoalAskRequested).toHaveBeenCalledWith(session)
  })

  it('resolves as skipped after the 30 minute ask timeout', async () => {
    const session = makeSession()
    const promise = createAskUserPromise(session, 'call-1', { question: 'Still there?' })

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    const result = await promise
    expect(result.details).toMatchObject({ skipped: true, skipReason: 'timeout' })
    expect(result.content[0].text).toContain('等待超时')
    expect(pendingAsks.size).toBe(0)
    expect(mocks.notifyGoalAskOutcome).toHaveBeenCalledWith(session, { skipped: true, reason: 'timeout' })
  })

  it('resolves as skipped when the run aborts while waiting', async () => {
    const controller = new AbortController()
    const session = makeSession({ agent: { signal: controller.signal } })
    const promise = createAskUserPromise(session, 'call-1', { question: 'Keep going?' })

    controller.abort()
    const result = await promise
    expect(result.details).toMatchObject({ skipped: true, skipReason: 'aborted' })
    expect(result.content[0].text).toContain('运行被停止')
    expect(pendingAsks.size).toBe(0)
  })

  it('queues a second ask of the same session behind the visible one', async () => {
    const session = makeSession({ sessionId: 'session-queue' })
    const first = createAskUserPromise(session, 'call-1', { question: 'First?' })
    const second = createAskUserPromise(session, 'call-2', { question: 'Second?' })

    // Single-slot UI: only the first ask may register / emit.
    expect(pendingAsks.size).toBe(1)
    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
    const [firstAskId, firstEntry] = pendingAsks.entries().next().value
    expect(firstEntry.toolCallId).toBe('call-1')

    firstEntry.finish({ answers: [{ choices: ['A'] }] })
    await first
    await vi.advanceTimersByTimeAsync(0)

    // The queued ask becomes visible once the first one settled.
    expect(pendingAsks.size).toBe(1)
    const [secondAskId, secondEntry] = pendingAsks.entries().next().value
    expect(secondAskId).not.toBe(firstAskId)
    expect(secondEntry.toolCallId).toBe('call-2')
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, {
      type: 'ask_user_required',
      sessionId: 'session-queue',
      askId: secondAskId,
      toolCallId: 'call-2',
      questions: secondEntry.questions,
    })

    secondEntry.finish({ skipped: true })
    const secondResult = await second
    expect(secondResult.details).toMatchObject({ askId: secondAskId, skipped: true })
    expect(pendingAsks.size).toBe(0)
  })

  it('starts the timeout of a queued ask only when it becomes visible', async () => {
    const session = makeSession({ sessionId: 'session-timeout' })
    const first = createAskUserPromise(session, 'call-1', { question: 'First?' })
    let secondSettled = false
    const second = createAskUserPromise(session, 'call-2', { question: 'Second?' }).then((result) => {
      secondSettled = true
      return result
    })

    // Waiting behind another ask must not burn this ask's own 30 minutes.
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000)
    expect(secondSettled).toBe(false)

    const [, firstEntry] = pendingAsks.entries().next().value
    firstEntry.finish({ skipped: true })
    await first
    await vi.advanceTimersByTimeAsync(0)
    expect(secondSettled).toBe(false)

    // Visible now: a full 30 minutes from this point.
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000)
    expect(secondSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    const secondResult = await second
    expect(secondResult.details).toMatchObject({ skipped: true, skipReason: 'timeout' })
    expect(pendingAsks.size).toBe(0)
  })

  it('settles a queued ask as aborted instead of leaking it into the next run', async () => {
    const controller = new AbortController()
    const session = makeSession({ sessionId: 'session-abort', agent: { signal: controller.signal } })
    const first = createAskUserPromise(session, 'call-1', { question: 'First?' })
    const second = createAskUserPromise(session, 'call-2', { question: 'Second?' })

    controller.abort()
    await expect(first).resolves.toMatchObject({ details: { skipReason: 'aborted' } })
    await vi.advanceTimersByTimeAsync(0)
    await expect(second).resolves.toMatchObject({ details: { skipReason: 'aborted' } })
    expect(pendingAsks.size).toBe(0)
  })

  it('answers the model with a busy result when the ask queue is full', async () => {
    const session = makeSession({ sessionId: 'session-full' })
    const asks = Array.from({ length: ASK_QUEUE_MAX_WAITING + 2 }, (_, index) => (
      createAskUserPromise(session, `call-${index + 1}`, { question: `Q${index + 1}?` })
    ))

    // 1 active + ASK_QUEUE_MAX_WAITING waiting; the rest are rejected outright.
    expect(pendingAsks.size).toBe(1)
    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
    const overflow = await asks[asks.length - 1]
    expect(overflow.details).toMatchObject({ askId: null, skipped: true, skipReason: 'busy' })
    expect(overflow.content[0].text).toContain('没有显示给用户')

    // Drain the accepted asks so nothing is left waiting on a timer.
    for (let index = 0; index < ASK_QUEUE_MAX_WAITING + 1; index += 1) {
      const entry = pendingAsks.values().next().value
      if (!entry) break
      entry.finish({ skipped: true })
      await vi.advanceTimersByTimeAsync(0)
    }
    await Promise.all(asks.slice(0, ASK_QUEUE_MAX_WAITING + 1))
    expect(pendingAsks.size).toBe(0)
  })

  it('keeps the ask queue per session', () => {
    const first = makeSession({ sessionId: 'session-a' })
    const second = makeSession({ sessionId: 'session-b' })
    createAskUserPromise(first, 'call-a', { question: 'A?' })
    createAskUserPromise(second, 'call-b', { question: 'B?' })
    expect(pendingAsks.size).toBe(2)
  })
})

describe('createAutoCompactApprovalPromise', () => {
  function compactDetails() {
    return {
      usage: { totalTokens: 9000 },
      settings: { thresholdPercent: 85, keepRecentTurns: 4 },
    }
  }

  it('resolves unavailable without a session', async () => {
    await expect(createAutoCompactApprovalPromise(null)).resolves.toBe('unavailable')
    expect(pendingAutoCompactApprovals.size).toBe(0)
  })

  it('registers the approval with usage details and emits the required event', async () => {
    const session = makeSession({ sessionId: 'session-3' })
    const promise = createAutoCompactApprovalPromise(session, compactDetails())

    expect(pendingAutoCompactApprovals.size).toBe(1)
    const [approvalId, entry] = pendingAutoCompactApprovals.entries().next().value
    expect(entry.sessionId).toBe('session-3')
    expect(entry.usage).toEqual({ totalTokens: 9000 })
    expect(entry.thresholdPercent).toBe(85)
    expect(entry.keepRecentTurns).toBe(4)
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, {
      type: 'auto_compact_approval_required',
      approvalId,
      usage: { totalTokens: 9000 },
      thresholdPercent: 85,
      keepRecentTurns: 4,
    })

    entry.resolve(true)
    await expect(promise).resolves.toBe('approved')
    expect(pendingAutoCompactApprovals.size).toBe(0)
    // The client is told the approval is gone in the same frame the server drops
    // it, so the decision row can never outlive the request.
    expect(mocks.emitSessionEvent).toHaveBeenLastCalledWith(session, {
      type: 'auto_compact_approval_settled',
      approvalId,
      outcome: 'decided',
    })
  })

  it('resolves declined when the user declines and reports the outcome', async () => {
    const session = makeSession()
    const promise = createAutoCompactApprovalPromise(session, compactDetails())
    const [approvalId, entry] = pendingAutoCompactApprovals.entries().next().value
    entry.resolve(false)

    await expect(promise).resolves.toBe('declined')
    expect(pendingAutoCompactApprovals.size).toBe(0)
    expect(mocks.emitSessionEvent).toHaveBeenLastCalledWith(session, {
      type: 'auto_compact_approval_settled',
      approvalId,
      outcome: 'decided',
    })
  })

  it('distinguishes a timeout from a decline so the client can drop the card', async () => {
    const session = makeSession()
    const promise = createAutoCompactApprovalPromise(session, compactDetails())
    const [approvalId] = pendingAutoCompactApprovals.entries().next().value

    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS)
    // Not `declined`: nobody answered, so the rejection suppression must not kick
    // in, and the client must be told the request expired.
    await expect(promise).resolves.toBe('timed_out')
    expect(pendingAutoCompactApprovals.size).toBe(0)
    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(2)
    expect(mocks.emitSessionEvent).toHaveBeenLastCalledWith(session, {
      type: 'auto_compact_approval_settled',
      approvalId,
      outcome: 'timed_out',
    })
  })

  it('adopts the approval id the caller already published', async () => {
    const session = makeSession()
    const promise = createAutoCompactApprovalPromise(session, { ...compactDetails(), approvalId: 'preset-id' })

    // The decision row renders from the published notice, so both sides must key
    // off the same id or the approve/reject route cannot find the entry.
    expect(pendingAutoCompactApprovals.has('preset-id')).toBe(true)
    pendingAutoCompactApprovals.get('preset-id').resolve(true)
    await expect(promise).resolves.toBe('approved')
  })

  it('rejects when the run aborts while the approval is pending', async () => {
    const controller = new AbortController()
    const session = makeSession({ agent: { signal: controller.signal } })
    const promise = createAutoCompactApprovalPromise(session, compactDetails())

    controller.abort()
    await expect(promise).rejects.toThrow('Run aborted')
    expect(pendingAutoCompactApprovals.size).toBe(0)
  })

  it('rejects immediately when the run is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const session = makeSession({ agent: { signal: controller.signal } })
    await expect(createAutoCompactApprovalPromise(session, compactDetails())).rejects.toThrow('Run aborted')
    expect(pendingAutoCompactApprovals.size).toBe(0)
    expect(mocks.emitSessionEvent).not.toHaveBeenCalled()
  })
})
