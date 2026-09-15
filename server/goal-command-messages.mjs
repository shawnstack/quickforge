import { readStore } from './storage.mjs'
import { GOAL_MAX_OBJECTIVE_CHARS } from './agent-goal-state.mjs'

/**
 * Localized `/goal` command error texts, keyed by the errorCode returned from
 * `startGoalPlanning`. The `en` entries exist for parity review only: the
 * English message always comes from `result.error` (the runner composes it
 * with runtime context, e.g. the active status), so only `zh` is looked up.
 */
export const GOAL_COMMAND_MESSAGES = Object.freeze({
  en: Object.freeze({
    GOAL_COMMAND_USAGE: 'Usage: /goal <objective>',
    GOAL_COMMAND_OBJECTIVE_TOO_LONG: `Goal objective must be at most ${GOAL_MAX_OBJECTIVE_CHARS} characters.`,
    GOAL_COMMAND_UNAVAILABLE: 'Goal mode is only available in a QuickForge main chat.',
    GOAL_COMMAND_SESSION_RUNNING: 'The session is still running. Stop it or wait for it to finish before setting a goal.',
    GOAL_ACTIVE: 'This chat already has an active goal. Pause, cancel or revise it before starting a new one.',
    SESSION_PERSIST_FAILED: 'Failed to persist the goal. Try again.',
  }),
  zh: Object.freeze({
    GOAL_COMMAND_USAGE: '用法：/goal <目标描述>',
    GOAL_COMMAND_OBJECTIVE_TOO_LONG: `目标描述最长 ${GOAL_MAX_OBJECTIVE_CHARS} 个字符。`,
    GOAL_COMMAND_UNAVAILABLE: 'Goal 模式仅在 QuickForge 主聊天中可用。',
    GOAL_COMMAND_SESSION_RUNNING: '会话仍在运行中。请先停止或等待其结束，再设定目标。',
    GOAL_ACTIVE: '本会话已有进行中的目标，请先暂停、取消或修订后再开始新目标。',
    SESSION_PERSIST_FAILED: '目标状态持久化失败，请重试。',
  }),
})

/**
 * Resolve the settings language. A missing/unreadable store or any value other
 * than 'zh' fails open to English (the original server message).
 */
async function readGoalCommandLanguage() {
  try {
    const settings = await readStore('settings')
    return settings?.language === 'zh' ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

/**
 * Localize a `/goal` command failure. `result` is the `{ error, errorCode }`
 * returned by `startGoalPlanning`; without a mapped code (or for any non-zh
 * language) the original English `result.error` is returned unchanged, so the
 * English path never depends on this table.
 */
export async function goalCommandText(result, fallback = '') {
  const english = result?.error ?? fallback
  const code = result?.errorCode
  if (!code) return english
  if (await readGoalCommandLanguage() !== 'zh') return english
  return GOAL_COMMAND_MESSAGES.zh[code] ?? english
}
