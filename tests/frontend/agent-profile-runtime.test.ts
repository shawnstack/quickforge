import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_RUNTIME_MINUTES,
  MIN_RUNTIME_MINUTES,
  isMaxRuntimeMinutesValid,
  maxRuntimeMinutesToMs,
  maxRuntimeMsToMinutes,
} from '../../src/components/agent-profiles/agent-runtime'

describe('agent profile max runtime conversion', () => {
  it('keeps the UI input minimum aligned with the one-second runtime limit', async () => {
    const source = await readFile(new URL('../../src/components/agent-profiles/AgentProfilesPage.tsx', import.meta.url), 'utf8')

    expect(source).toContain('min={MIN_RUNTIME_MINUTES}')
    expect(source).toContain("{t('maxRuntimeMinutesHelp')}")
  })

  it('defaults missing persisted values to 60 minutes', () => {
    expect(DEFAULT_MAX_RUNTIME_MINUTES).toBe(60)
    expect(maxRuntimeMsToMinutes()).toBe('60')
  })

  it('converts persisted milliseconds to concise editable minutes without losing millisecond precision', () => {
    expect(maxRuntimeMsToMinutes(3_600_000)).toBe('60')
    expect(maxRuntimeMsToMinutes(90_000)).toBe('1.5')
    expect(maxRuntimeMsToMinutes(1_000)).toBe('0.016667')
    expect(maxRuntimeMinutesToMs(maxRuntimeMsToMinutes(1_000))).toBe(1_000)
  })

  it('rounds editable minutes back to persisted milliseconds without dropping below one second', () => {
    expect(maxRuntimeMinutesToMs('1')).toBe(60_000)
    expect(maxRuntimeMinutesToMs('1.5')).toBe(90_000)
    expect(maxRuntimeMinutesToMs(String(MIN_RUNTIME_MINUTES))).toBe(1_000)
    expect(maxRuntimeMinutesToMs('0.00001')).toBe(1_000)
  })

  it('accepts only values from one second through 60 minutes', () => {
    expect(MIN_RUNTIME_MINUTES).toBe(1000 / 60_000)
    expect(isMaxRuntimeMinutesValid(String(MIN_RUNTIME_MINUTES))).toBe(true)
    expect(isMaxRuntimeMinutesValid('0.016667')).toBe(true)
    expect(isMaxRuntimeMinutesValid('0.5')).toBe(true)
    expect(isMaxRuntimeMinutesValid('60')).toBe(true)
    expect(isMaxRuntimeMinutesValid('')).toBe(false)
    expect(isMaxRuntimeMinutesValid('0')).toBe(false)
    expect(isMaxRuntimeMinutesValid('0.016666')).toBe(false)
    expect(isMaxRuntimeMinutesValid('-1')).toBe(false)
    expect(isMaxRuntimeMinutesValid('60.01')).toBe(false)
    expect(isMaxRuntimeMinutesValid('not-a-number')).toBe(false)
  })
})
