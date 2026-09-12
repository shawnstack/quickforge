import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readStore: vi.fn(async () => ({})) }))

vi.mock('../../server/storage.mjs', () => ({ readStore: mocks.readStore }))

const {
  DEFAULT_GOAL_SETTINGS,
  GOAL_SETTINGS_KEY,
  normalizeGoalSettings,
  readGoalSettings,
  resolveGoalMaxIterations,
} = await import('../../server/goal-settings.mjs')

describe('goal settings', () => {
  it('normalizes missing or malformed settings to the default budget', () => {
    expect(DEFAULT_GOAL_SETTINGS.maxIterations).toBe(20)
    expect(normalizeGoalSettings(undefined)).toEqual({ maxIterations: 20 })
    expect(normalizeGoalSettings('nope')).toEqual({ maxIterations: 20 })
    expect(normalizeGoalSettings({ maxIterations: 'many' })).toEqual({ maxIterations: 20 })
  })

  it('clamps the configured maxIterations into the integer range 1-100', () => {
    expect(normalizeGoalSettings({ maxIterations: 0 }).maxIterations).toBe(1)
    expect(normalizeGoalSettings({ maxIterations: 5 }).maxIterations).toBe(5)
    expect(normalizeGoalSettings({ maxIterations: 5.4 }).maxIterations).toBe(5)
    expect(normalizeGoalSettings({ maxIterations: 1000 }).maxIterations).toBe(100)
  })

  it('reads the configured budget from the settings store key', async () => {
    mocks.readStore.mockResolvedValueOnce({ [GOAL_SETTINGS_KEY]: { maxIterations: 5 } })
    await expect(readGoalSettings()).resolves.toEqual({ maxIterations: 5 })
    await expect(resolveGoalMaxIterations()).resolves.toBe(20)
    expect(mocks.readStore).toHaveBeenCalledWith('settings')
  })

  it('falls back to the default budget when the store is empty or unreadable', async () => {
    mocks.readStore.mockResolvedValueOnce(null)
    await expect(readGoalSettings()).resolves.toEqual({ maxIterations: 20 })
    mocks.readStore.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(resolveGoalMaxIterations()).resolves.toBe(20)
  })
})
