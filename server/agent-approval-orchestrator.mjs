// agent-manager 模块拆分（agent-manager-module-split）：工具审批 / ask_user /
// 自动压缩审批三类 Promise 编排从 agent-manager.mjs 逐字符搬移至此；
// 行为与注释语义保持不变。

import { randomUUID } from 'node:crypto'
import { emitSessionEvent } from './agent-session-events.mjs'
import {
  APPROVAL_TIMEOUT_MS,
  pendingApprovals,
  pendingAutoCompactApprovals,
} from './approval-store.mjs'
import {
  ASK_TIMEOUT_MS,
  pendingAsks,
  normalizeAskQuestions,
  formatAskResult,
} from './ask-store.mjs'
import {
  notifyGoalApprovalOutcome,
  notifyGoalApprovalRequested,
  notifyGoalAskOutcome,
  notifyGoalAskRequested,
} from './goal/engine.mjs'

/**
 * Create a Promise that only resolves when the user accepts or rejects the tool call.
 * The agent loop's `await config.beforeToolCall(...)` pauses on this promise,
 * effectively freezing the agent until the user decides.
 */
export function createApprovalPromise(session, toolCallId, toolName, args, source, options = {}) {
  if (!session) return { block: true, reason: 'No active session for tool approval.' }
  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS
    const abortSignals = []

    const timeout = setTimeout(() => {
      if (settled) return
      cleanup()
      void notifyGoalApprovalOutcome(session, { outcome: 'timeout' })
      resolve({ block: true, reason: `Approval timeout for ${toolName}` })
    }, APPROVAL_TIMEOUT_MS)

    let onAbort = null

    const cleanup = () => {
      clearTimeout(timeout)
      if (onAbort) {
        for (const signal of abortSignals) signal.removeEventListener('abort', onAbort)
        abortSignals.length = 0
        onAbort = null
      }
      if (settled) return
      settled = true
      pendingApprovals.delete(toolCallId)
    }

    // Listen for the session run's abort (user stop) and, for workflow steps,
    // the step's own combined signal (workflow timeout/parent abort). Without
    // the extra signal a timed-out workflow could leave its approval pending
    // until the 5-minute approval timeout.
    const signals = [...new Set([session.agent?.signal, options.signal].filter((signal) => signal && typeof signal.addEventListener === 'function'))]
    if (signals.length > 0) {
      onAbort = () => {
        cleanup()
        void notifyGoalApprovalOutcome(session, { outcome: 'aborted' })
        reject(new Error('Run aborted'))
      }
      for (const signal of signals) {
        if (signal.aborted) {
          cleanup()
          void notifyGoalApprovalOutcome(session, { outcome: 'aborted' })
          reject(new Error('Run aborted'))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
        abortSignals.push(signal)
      }
    }

    pendingApprovals.set(toolCallId, {
      resolve: (approved) => {
        cleanup()
        void notifyGoalApprovalOutcome(session, { outcome: approved ? 'approved' : 'rejected' })
        resolve(approved ? undefined : { block: true, reason: `User rejected ${toolName}` })
      },
      reject: (err) => {
        cleanup()
        reject(err)
      },
      sessionId: session.sessionId,
      toolName,
      args,
      source,
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'tool_approval_required',
      sessionId: session.sessionId,
      toolCallId,
      toolName,
      args,
      source,
    })
    // Goal runs surface the wait state on the goal card (reusing this exact
    // approval mechanism); non-goal runs are unaffected.
    void notifyGoalApprovalRequested(session)
  })
}

/**
 * Create a Promise that resolves when the user answers (or skips) an ask_user
 * tool call. The tool's execute blocks on this promise, pausing the agent loop
 * until the user responds.
 */
export function createAskUserPromise(session, toolCallId, params) {
  const questions = normalizeAskQuestions(params)
  if (!questions.length) {
    return Promise.resolve({
      content: [{ type: 'text', text: formatAskResult(questions, null, true, 'no-questions') }],
      details: { askId: null, skipped: true },
    })
  }
  const askId = randomUUID()
  return new Promise((resolve) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + ASK_TIMEOUT_MS

    const timeout = setTimeout(() => {
      if (settled) return
      finish({ skipped: true, reason: 'timeout' })
    }, ASK_TIMEOUT_MS)

    let onAbort = null

    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (onAbort && session.agent.signal) session.agent.signal.removeEventListener('abort', onAbort)
      pendingAsks.delete(askId)
      const answers = payload.skipped ? null : payload.answers
      const remark = payload.skipped ? undefined : payload.remark
      // A skipped (or timed-out) question during a goal run pauses the goal
      // instead of letting it loop on assumptions.
      void notifyGoalAskOutcome(session, { skipped: !!payload.skipped, reason: payload.reason })
      resolve({
        content: [{ type: 'text', text: formatAskResult(questions, answers, payload.skipped, payload.reason, remark) }],
        details: {
          askId,
          questions,
          answers,
          skipped: !!payload.skipped,
          ...(remark ? { remark } : {}),
          ...(payload.reason ? { skipReason: payload.reason } : {}),
        },
      })
      emitSessionEvent(session, {
        type: 'ask_user_answered',
        sessionId: session.sessionId,
        askId,
        toolCallId,
        skipped: !!payload.skipped,
        answers: answers || [],
      })
    }

    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        finish({ skipped: true, reason: 'aborted' })
        return
      }
      onAbort = () => finish({ skipped: true, reason: 'aborted' })
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingAsks.set(askId, {
      finish: (payload) => finish(payload),
      sessionId: session.sessionId,
      toolCallId,
      questions,
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'ask_user_required',
      sessionId: session.sessionId,
      askId,
      toolCallId,
      questions,
    })
    void notifyGoalAskRequested(session)
  })
}

/**
 * Auto-compact confirmation promise.
 *
 * Resolves an `AUTO_COMPACT_DECISION` instead of a boolean so the caller can
 * distinguish "user said no" (suppress for 10 minutes) from "nobody answered"
 * (drop the card, do not suppress) and "no channel" (server misconfiguration).
 *
 * Every terminal path emits `auto_compact_approval_settled`. The timeout path
 * previously removed the server-side entry silently, which is what left a dead
 * approval card on screen: the client kept rendering it because nothing told it
 * the request was gone, and the next click could only return 404. With a settled
 * event the client drops the notice in the same frame the server drops the entry.
 */
export function createAutoCompactApprovalPromise(session, details = {}) {
  if (!session) return Promise.resolve('unavailable')
  // The caller publishes the notice (and therefore the approval id) before the
  // promise is created, so the row the user sees and the entry this promise
  // registers are keyed by the same id. Defaulting keeps the standalone use
  // (tests, future callers) working unchanged.
  const approvalId = typeof details.approvalId === 'string' && details.approvalId
    ? details.approvalId
    : randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    // Whether the client was ever told about this approval. A run that aborts
    // before `auto_compact_approval_required` was emitted has nothing to retract,
    // so no settled event is emitted for it (an unmatched "settled" frame would
    // just be noise on the SSE stream).
    let announced = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS

    const publishSettled = (outcome) => {
      if (!announced) return
      emitSessionEvent(session, {
        type: 'auto_compact_approval_settled',
        approvalId,
        outcome,
      })
    }

    const settle = (outcome, decision) => {
      // `settled` guards double-settlement (timeout racing a click, abort racing
      // a timeout). The event is emitted exactly once, before the promise
      // resolves, so listeners observe the state change before the run resumes.
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
      publishSettled(outcome)
      resolve(decision)
    }

    const fail = (error, outcome = 'cancelled') => {
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
      publishSettled(outcome)
      reject(error)
    }

    const timeout = setTimeout(() => {
      settle('timed_out', 'timed_out')
    }, APPROVAL_TIMEOUT_MS)

    let onAbort = null

    const cleanup = () => {
      clearTimeout(timeout)
      if (onAbort) {
        session.agent.signal?.removeEventListener('abort', onAbort)
        onAbort = null
      }
    }

    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        cleanup()
        fail(new Error('Run aborted'))
        return
      }
      onAbort = () => {
        cleanup()
        fail(new Error('Run aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingAutoCompactApprovals.set(approvalId, {
      resolve: (approved) => {
        cleanup()
        settle('decided', approved === true ? 'approved' : 'declined')
      },
      reject: (err) => {
        cleanup()
        fail(err)
      },
      sessionId: session.sessionId,
      usage: details.usage,
      thresholdPercent: details.settings?.thresholdPercent,
      keepRecentTurns: details.settings?.keepRecentTurns,
      requestedAt,
      expiresAt,
    })

    announced = true
    emitSessionEvent(session, {
      type: 'auto_compact_approval_required',
      approvalId,
      usage: details.usage,
      thresholdPercent: details.settings?.thresholdPercent,
      keepRecentTurns: details.settings?.keepRecentTurns,
    })
  })
}
