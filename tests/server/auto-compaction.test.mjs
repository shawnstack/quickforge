import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  normalizeAutoCompactSettings,
} from '../../server/auto-compaction.mjs'

describe('auto compact settings', () => {
  it('defaults to enabled with confirmation while preserving explicit opt-outs', () => {
    expect(normalizeAutoCompactSettings(null)).toEqual(DEFAULT_AUTO_COMPACT_SETTINGS)
    expect(normalizeAutoCompactSettings({})).toMatchObject({
      enabled: true,
      requireConfirmation: true,
    })
    expect(normalizeAutoCompactSettings({ enabled: false, requireConfirmation: false })).toMatchObject({
      enabled: false,
      requireConfirmation: false,
    })
  })
})
