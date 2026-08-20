/**
 * Ask-user store — shared pending-question state.
 *
 * The Promise-based ask flow (createAskUserPromise) lives in agent-manager.mjs
 * because it depends on the agent event buses; this module only holds the
 * pending queue, mirroring approval-store.mjs.
 */

// Waiting for a user decision is not a security gate — allow generous time
// before resolving as skipped so the agent can continue on its own.
export const ASK_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/** askId → { finish, sessionId, toolCallId, questions, requestedAt, expiresAt } */
export const pendingAsks = new Map()

export function getPendingAskForSession(sessionId) {
  for (const [askId, ask] of pendingAsks) {
    if (ask.sessionId === sessionId) {
      return {
        askId,
        toolCallId: ask.toolCallId,
        questions: ask.questions,
        requestedAt: ask.requestedAt,
        expiresAt: ask.expiresAt,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Pure helpers (no dependencies — unit-tested directly)
// ---------------------------------------------------------------------------

/** Normalize ask_user params into a bounded questions list (robust against model shorthand). */
export function normalizeAskQuestions(params) {
  const rawQuestions = Array.isArray(params?.questions)
    ? params.questions
    : (typeof params?.question === 'string' ? [{ ...params }] : [])
  return rawQuestions
    .filter((q) => q && typeof q.question === 'string' && q.question.trim())
    .slice(0, 4)
    .map((q) => ({
      question: String(q.question),
      multiSelect: q.multiSelect === true,
      allowCustom: q.allowCustom === false ? false : true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((option) => option && typeof option.label === 'string' && option.label.trim())
        .slice(0, 4)
        .map((option) => ({
          label: String(option.label),
          ...(typeof option.description === 'string' && option.description ? { description: option.description } : {}),
        })),
    }))
}

/** Render the tool-result text returned to the model. */
export function formatAskResult(questions, answers, skipped, reason) {
  if (skipped) {
    const note = reason === 'timeout'
      ? '（等待超时）'
      : reason === 'aborted'
        ? '（运行被停止）'
        : reason === 'no-questions'
          ? '（问题列表无效）'
          : '（用户跳过）'
    return `用户没有回答这些问题${note}。请按你的默认方案继续，不要再重复追问。`
  }
  const lines = questions.map((q, index) => {
    const answer = answers?.[index]
    if (!answer) return `${index + 1}. ${q.question} → 用户未回答`
    const choiceText = Array.isArray(answer.choices) && answer.choices.length ? answer.choices.join('、') : ''
    const customText = typeof answer.custom === 'string' && answer.custom.trim() ? answer.custom.trim() : ''
    const text = [choiceText, customText].filter(Boolean).join('　补充：')
    return `${index + 1}. ${q.question} → ${text || '用户未回答'}`
  })
  return `用户的回答：\n${lines.join('\n')}`
}
