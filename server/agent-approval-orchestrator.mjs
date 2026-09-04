// agent-manager 模块拆分（agent-manager-module-split）：工具审批 / ask_user /
// ACP 审批 / 自动压缩审批四类 Promise 编排从 agent-manager.mjs 逐字符搬移至此；
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

/**
 * Create a Promise that only resolves when the user accepts or rejects the tool call.
 * The agent loop's `await config.beforeToolCall(...)` pauses on this promise,
 * effectively freezing the agent until the user decides.
 */
export function createApprovalPromise(session, toolCallId, toolName, args, source) {
  if (!session) return { block: true, reason: 'No active session for tool approval.' }
  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingApprovals.delete(toolCallId)
      resolve({ block: true, reason: `Approval timeout for ${toolName}` })
    }, APPROVAL_TIMEOUT_MS)

    let onAbort = null

    const cleanup = () => {
      clearTimeout(timeout)
      if (onAbort) {
        session.agent.signal?.removeEventListener('abort', onAbort)
        onAbort = null
      }
      if (settled) return
      settled = true
      pendingApprovals.delete(toolCallId)
    }

    // Listen for abort signal so the promise rejects when the user stops the run
    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(new Error('Run aborted'))
        return
      }
      onAbort = () => {
        cleanup()
        reject(new Error('Run aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingApprovals.set(toolCallId, {
      resolve: (approved) => {
        cleanup()
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
      resolve({
        content: [{ type: 'text', text: formatAskResult(questions, answers, payload.skipped, payload.reason) }],
        details: { askId, questions, answers, skipped: !!payload.skipped, ...(payload.reason ? { skipReason: payload.reason } : {}) },
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
  })
}

export function createAcpApprovalPromise(session, request) {  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingApprovals.delete(request.toolCallId)
      resolve({ outcome: { outcome: 'cancelled' } })
    }, APPROVAL_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      pendingApprovals.delete(request.toolCallId)
    }
    const allowOption = request.options.find((option) => option.kind === 'allow_once' || option.kind === 'allow_always')
    const rejectOption = request.options.find((option) => option.kind === 'reject_once' || option.kind === 'reject_always')

    pendingApprovals.set(request.toolCallId, {
      resolve: (approved) => {
        cleanup()
        const option = approved ? allowOption : rejectOption
        resolve(option
          ? { outcome: { outcome: 'selected', optionId: option.optionId } }
          : { outcome: { outcome: 'cancelled' } })
      },
      reject: (error) => {
        cleanup()
        reject(error)
      },
      sessionId: session.sessionId,
      toolName: request.toolName,
      args: request.args,
      source: 'opencode',
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'tool_approval_required',
      sessionId: session.sessionId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      args: request.args,
      source: 'opencode',
    })
  })
}

export function createAutoCompactApprovalPromise(session, details = {}) {
  if (!session) return Promise.resolve(false)
  const approvalId = randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
      resolve(false)
    }, APPROVAL_TIMEOUT_MS)

    let onAbort = null

    const cleanup = () => {
      clearTimeout(timeout)
      if (onAbort) {
        session.agent.signal?.removeEventListener('abort', onAbort)
        onAbort = null
      }
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
    }

    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(new Error('Run aborted'))
        return
      }
      onAbort = () => {
        cleanup()
        reject(new Error('Run aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingAutoCompactApprovals.set(approvalId, {
      resolve: (approved) => {
        cleanup()
        resolve(approved === true)
      },
      reject: (err) => {
        cleanup()
        reject(err)
      },
      sessionId: session.sessionId,
      usage: details.usage,
      thresholdPercent: details.settings?.thresholdPercent,
      keepRecentTurns: details.settings?.keepRecentTurns,
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'auto_compact_approval_required',
      approvalId,
      usage: details.usage,
      thresholdPercent: details.settings?.thresholdPercent,
      keepRecentTurns: details.settings?.keepRecentTurns,
    })
  })
}
