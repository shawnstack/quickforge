import { pendingApprovals, pendingAutoCompactApprovals } from './approval-store.mjs'
import { pendingAsks } from './ask-store.mjs'


/**
 * Approve a pending tool call, allowing it to execute.
 */
export function approveToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), { statusCode: 404 })
  }
  approval.resolve(true)
  return { approved: true, toolCallId }
}


/**
 * Reject a pending tool call, skipping its execution.
 */
export function rejectToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), { statusCode: 404 })
  }
  approval.resolve(false)
  return { rejected: true, toolCallId }
}


export function approveAutoCompact(sessionId, approvalId) {
  const approval = pendingAutoCompactApprovals.get(approvalId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending auto compact approval for this session'), { statusCode: 404 })
  }
  approval.resolve(true)
  return { approved: true, approvalId }
}


export function rejectAutoCompact(sessionId, approvalId) {
  const approval = pendingAutoCompactApprovals.get(approvalId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending auto compact approval for this session'), { statusCode: 404 })
  }
  approval.resolve(false)
  return { rejected: true, approvalId }
}


/**
 * Resolve a pending ask_user call with the user's answers (or a skip).
 * `answers` is an array aligned with the ask's questions:
 * `[{ choices: string[], custom?: string }]`.
 */
export function answerAsk(sessionId, askId, { answers, skipped = false } = {}) {
  const ask = pendingAsks.get(askId)
  if (!ask || ask.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending ask for this session'), { statusCode: 404 })
  }
  const normalizedAnswers = (Array.isArray(answers) ? answers : []).slice(0, ask.questions.length).map((answer) => ({
    choices: (Array.isArray(answer?.choices) ? answer.choices : [])
      .filter((choice) => typeof choice === 'string')
      .map((choice) => choice.slice(0, 500))
      .slice(0, 8),
    ...(typeof answer?.custom === 'string' && answer.custom.trim()
      ? { custom: answer.custom.slice(0, 4000) }
      : {}),
  }))
  if (skipped) ask.finish({ skipped: true })
  else ask.finish({ answers: normalizedAnswers })
  return { answered: true, askId, skipped: !!skipped }
}
