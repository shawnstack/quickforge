import { pendingApprovals } from './approval-store.mjs'
import { pendingAsks } from './ask-store.mjs'


/**
 * Approve a pending tool call, allowing it to execute.
 *
 * `APPROVAL_ALREADY_SETTLED`：多窗口下两个窗口可以同时看到同一张审批卡。第一个
 * 窗口点完就 `cleanup()` 掉了条目，第二个窗口再点必然查不到——这不是错误，是
 * 「别处已经处理过」。调用方据此静默收敛，而不是弹一个假 404。
 */
export function approveToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), {
      statusCode: 404,
      errorCode: 'APPROVAL_ALREADY_SETTLED',
    })
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
    throw Object.assign(new Error('No pending approval for this tool call'), {
      statusCode: 404,
      errorCode: 'APPROVAL_ALREADY_SETTLED',
    })
  }
  approval.resolve(false)
  return { rejected: true, toolCallId }
}


/**
 * Resolve a pending ask_user call with the user's answers (or a skip).
 * `answers` is an array aligned with the ask's questions:
 * `[{ choices: string[], custom?: string }]`.
 * `remark` is the review-step free-form note: it qualifies the whole
 * submission rather than any single question, so it travels separately.
 */
export function answerAsk(sessionId, askId, { answers, skipped = false, remark } = {}) {
  const ask = pendingAsks.get(askId)
  if (!ask || ask.sessionId !== sessionId) {
    // 与审批同理：两个窗口都能看到同一个 ask，先答的那个把它消费掉了。
    throw Object.assign(new Error('No pending ask for this session'), {
      statusCode: 404,
      errorCode: 'ASK_ALREADY_SETTLED',
    })
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
  const normalizedRemark = typeof remark === 'string' && remark.trim() ? remark.trim().slice(0, 4000) : undefined
  if (skipped) ask.finish({ skipped: true })
  else ask.finish({ answers: normalizedAnswers, ...(normalizedRemark ? { remark: normalizedRemark } : {}) })
  return { answered: true, askId, skipped: !!skipped }
}
