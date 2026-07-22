import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  normalizeAutoCompactSettings,
} from '../../server/auto-compaction.mjs'

describe('auto compact settings', () => {
  it('defaults to enabled with confirmation and three recent turns while preserving explicit settings', () => {
    expect(normalizeAutoCompactSettings(null)).toEqual(DEFAULT_AUTO_COMPACT_SETTINGS)
    expect(normalizeAutoCompactSettings({})).toMatchObject({
      enabled: true,
      keepRecentTurns: 3,
      requireConfirmation: true,
    })
    expect(normalizeAutoCompactSettings({ enabled: false, keepRecentTurns: 2, requireConfirmation: false })).toMatchObject({
      enabled: false,
      keepRecentTurns: 2,
      requireConfirmation: false,
    })
  })
})
