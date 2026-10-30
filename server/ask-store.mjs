/**
 * Ask-user store — shared pending-question state.
 *
 * The Promise-based ask flow (createAskUserPromise) lives in
 * agent-approval-orchestrator.mjs because it depends on the agent event buses;
 * this module holds the pending queue, the per-session ask ordering chain, and
 * the pure helpers, mirroring approval-store.mjs.
 */

// Waiting for a user decision is not a security gate — allow generous time
// before resolving as skipped so the agent can continue on its own.
export const ASK_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/** askId → { finish, sessionId, toolCallId, questions, requestedAt, expiresAt } */
export const pendingAsks = new Map()

/**
 * Ask-user queue — one visible question per session at a time.
 *
 * `ask_user` blocks the agent loop while it waits (see `createAskUserPromise`),
 * so a session can legitimately have several asks in flight when the model
 * emits more than one in the same assistant message. The pending-ask
 * projection and the composer card are both single-slot, so a second ask must
 * not register itself on top of the first: the earlier one would never be
 * shown again and would sit there until its 30-minute timeout. Extra asks are
 * therefore chained behind the active one and only register (and emit
 * `ask_user_required`) once it settles.
 */
export const ASK_QUEUE_MAX_WAITING = 3

/** sessionId → tail of that session's serialized ask chain. */
const askChains = new Map()
/** sessionId → number of asks still waiting behind the active one. */
const askQueueDepth = new Map()

/**
 * Serialize `start` behind every earlier ask of the same session.
 *
 * Returns `null` when the session already has `ASK_QUEUE_MAX_WAITING` asks
 * queued; the caller answers the model with a "busy" result instead of hanging
 * forever behind a queue nobody can see.
 */
export function enqueueAskForSession(sessionId, start) {
  const depth = askQueueDepth.get(sessionId) ?? 0
  if (depth >= ASK_QUEUE_MAX_WAITING) return null
  const track = (run) => {
    const tail = run.then(() => undefined, () => undefined)
    askChains.set(sessionId, tail)
    void tail.then(() => {
      if (askChains.get(sessionId) === tail) askChains.delete(sessionId)
    })
    return run
  }
  const previous = askChains.get(sessionId)
  if (!previous) {
    // Nothing queued for this session: start right away so registering the ask
    // and emitting `ask_user_required` stay synchronous with the tool call.
    let run
    try {
      run = Promise.resolve(start())
    } catch (error) {
      run = Promise.reject(error)
    }
    return track(run)
  }
  askQueueDepth.set(sessionId, depth + 1)
  const run = previous.then(() => {
    // This ask is the active one now; it stops counting as waiting. The timer
    // for its own 30-minute budget starts here, not at enqueue time.
    const waiting = (askQueueDepth.get(sessionId) ?? 1) - 1
    if (waiting > 0) askQueueDepth.set(sessionId, waiting)
    else askQueueDepth.delete(sessionId)
    return start()
  })
  return track(run)
}

/** Test seam: drops every chain/depth entry (they are pure bookkeeping). */
export function clearAskQueues() {
  askChains.clear()
  askQueueDepth.clear()
}

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
export function formatAskResult(questions, answers, skipped, reason, remark) {
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
  const remarkText = typeof remark === 'string' && remark.trim() ? remark.trim() : ''
  if (remarkText) lines.push(`补充信息：${remarkText}`)
  return `用户的回答：\n${lines.join('\n')}`
}

/**
 * Render the tool-result text for an ask that never reached the user because
 * the session's ask queue was full. It must not look like "the user skipped":
 * the model should wait for the visible question instead of falling back to
 * its own assumptions.
 */
export function formatAskBusyResult() {
  return '这个问题没有显示给用户：已经有问题在等待用户回答。请等用户回答当前问题后再继续，不要重复追问同一个问题。'
}
