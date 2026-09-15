import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GOAL_MAX_OBJECTIVE_CHARS } from '../../server/agent-goal-state.mjs'

const mocks = vi.hoisted(() => ({ readStore: vi.fn(async () => ({})) }))

vi.mock('../../server/storage.mjs', () => ({ readStore: mocks.readStore }))

const { GOAL_COMMAND_MESSAGES, goalCommandText } = await import('../../server/goal-command-messages.mjs')

// The runner-returned English errors (GOAL_ACTIVE is parameterized by status).
const EN_RESULTS = {
  GOAL_COMMAND_USAGE: { error: 'Usage: /goal <objective>' },
  GOAL_COMMAND_OBJECTIVE_TOO_LONG: { error: `Goal objective must be at most ${GOAL_MAX_OBJECTIVE_CHARS} characters.` },
  GOAL_COMMAND_UNAVAILABLE: { error: 'Goal mode is only available in a QuickForge main chat.' },
  GOAL_COMMAND_SESSION_RUNNING: { error: 'The session is still running. Stop it or wait for it to finish before setting a goal.' },
  GOAL_ACTIVE: { error: `This chat already has an active goal (running). Pause, cancel or revise it from the goal card before starting a new one.` },
  SESSION_PERSIST_FAILED: { error: 'Failed to persist the goal. Try again.' },
}

describe('goal command messages', () => {
  beforeEach(() => {
    mocks.readStore.mockReset()
    mocks.readStore.mockResolvedValue({})
  })

  it('returns the localized zh text when the settings language is zh', async () => {
    mocks.readStore.mockResolvedValue({ language: 'zh' })
    for (const [code, result] of Object.entries(EN_RESULTS)) {
      expect(await goalCommandText({ ...result, errorCode: code })).toBe(GOAL_COMMAND_MESSAGES.zh[code])
    }
    expect(mocks.readStore).toHaveBeenCalledWith('settings')
  })

  it('keeps the original English error for the en language and any other value', async () => {
    mocks.readStore.mockResolvedValue({ language: 'en' })
    expect(await goalCommandText({ ...EN_RESULTS.GOAL_COMMAND_USAGE, errorCode: 'GOAL_COMMAND_USAGE' })).toBe(EN_RESULTS.GOAL_COMMAND_USAGE.error)
    mocks.readStore.mockResolvedValue({ language: 'fr' })
    expect(await goalCommandText({ ...EN_RESULTS.GOAL_COMMAND_USAGE, errorCode: 'GOAL_COMMAND_USAGE' })).toBe(EN_RESULTS.GOAL_COMMAND_USAGE.error)
  })

  it('fails open to the original English error when the store is unreadable', async () => {
    mocks.readStore.mockRejectedValue(new Error('storage unavailable'))
    expect(await goalCommandText({ ...EN_RESULTS.GOAL_COMMAND_SESSION_RUNNING, errorCode: 'GOAL_COMMAND_SESSION_RUNNING' }))
      .toBe(EN_RESULTS.GOAL_COMMAND_SESSION_RUNNING.error)
  })

  it('returns the original error without an errorCode or with an unmapped code', async () => {
    mocks.readStore.mockResolvedValue({ language: 'zh' })
    expect(await goalCommandText({ error: EN_RESULTS.GOAL_COMMAND_USAGE.error })).toBe(EN_RESULTS.GOAL_COMMAND_USAGE.error)
    expect(await goalCommandText({ error: EN_RESULTS.GOAL_COMMAND_USAGE.error, errorCode: 'GOAL_COMMAND_UNKNOWN' })).toBe(EN_RESULTS.GOAL_COMMAND_USAGE.error)
    expect(await goalCommandText(null, EN_RESULTS.GOAL_COMMAND_USAGE.error)).toBe(EN_RESULTS.GOAL_COMMAND_USAGE.error)
  })

  it('keeps the en table identical to the runner messages except the status-parameterized GOAL_ACTIVE', () => {
    expect(GOAL_COMMAND_MESSAGES.en.GOAL_COMMAND_USAGE).toBe(EN_RESULTS.GOAL_COMMAND_USAGE.error)
    expect(GOAL_COMMAND_MESSAGES.en.GOAL_COMMAND_OBJECTIVE_TOO_LONG).toBe(EN_RESULTS.GOAL_COMMAND_OBJECTIVE_TOO_LONG.error)
    expect(GOAL_COMMAND_MESSAGES.en.GOAL_COMMAND_UNAVAILABLE).toBe(EN_RESULTS.GOAL_COMMAND_UNAVAILABLE.error)
    expect(GOAL_COMMAND_MESSAGES.en.GOAL_COMMAND_SESSION_RUNNING).toBe(EN_RESULTS.GOAL_COMMAND_SESSION_RUNNING.error)
    expect(GOAL_COMMAND_MESSAGES.en.SESSION_PERSIST_FAILED).toBe(EN_RESULTS.SESSION_PERSIST_FAILED.error)
    expect(GOAL_COMMAND_MESSAGES.zh.GOAL_ACTIVE).toBe('本会话已有进行中的目标，请先暂停、取消或修订后再开始新目标。')
  })
})
