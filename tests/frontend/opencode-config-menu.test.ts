import { describe, expect, it, vi } from 'vitest'

// Avoid pulling in the heavy i18n dependency tree (pi-web-ui/pdfjs) in the
// node test environment; the helpers under test only need `t` to exist.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { hasOpenCodeConfigContent } from '../../src/components/chat/panel-decoration/opencode-config-menu'
import { hasOpenCodeModes, opencodeModeButtonLabel } from '../../src/components/chat/panel-decoration/opencode-mode-menu'

const baseSession = {
  configOptions: [],
  modes: { currentModeId: 'default', availableModes: [] },
  availableCommands: [],
  sessionInfo: {},
  usage: null,
}

describe('hasOpenCodeConfigContent', () => {
  it('is false when the session is missing', () => {
    expect(hasOpenCodeConfigContent(null)).toBe(false)
    expect(hasOpenCodeConfigContent(undefined)).toBe(false)
  })

  it('is false when there are no config options', () => {
    expect(hasOpenCodeConfigContent(baseSession)).toBe(false)
    expect(hasOpenCodeConfigContent({ ...baseSession, modes: null })).toBe(false)
  })

  it('is false when only modes exist (modes moved to the composer mode button)', () => {
    expect(
      hasOpenCodeConfigContent({
        ...baseSession,
        modes: { currentModeId: 'default', availableModes: [{ id: 'm', name: 'Mode' }] },
      }),
    ).toBe(false)
  })

  it('is true when at least one config option exists', () => {
    expect(
      hasOpenCodeConfigContent({
        ...baseSession,
        configOptions: [{ id: 'c', name: 'Config', type: 'boolean', currentValue: false }],
      }),
    ).toBe(true)
  })

  it('is true when config options exist alongside modes', () => {
    expect(
      hasOpenCodeConfigContent({
        ...baseSession,
        modes: { currentModeId: 'plan', availableModes: [{ id: 'plan', name: 'Plan' }] },
        configOptions: [{ id: 'c', name: 'Config', type: 'boolean', currentValue: false }],
      }),
    ).toBe(true)
  })
})

describe('hasOpenCodeModes', () => {
  it('is false when the session is missing or modes are not reported', () => {
    expect(hasOpenCodeModes(null)).toBe(false)
    expect(hasOpenCodeModes(undefined)).toBe(false)
    expect(hasOpenCodeModes({ ...baseSession, modes: null })).toBe(false)
    expect(hasOpenCodeModes(baseSession)).toBe(false)
  })

  it('is true when at least one available mode exists', () => {
    expect(
      hasOpenCodeModes({
        ...baseSession,
        modes: { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }] },
      }),
    ).toBe(true)
  })
})

describe('opencodeModeButtonLabel', () => {
  it('is empty when the session is missing or has no current mode', () => {
    expect(opencodeModeButtonLabel(null)).toBe('')
    expect(opencodeModeButtonLabel(undefined)).toBe('')
    expect(opencodeModeButtonLabel({ ...baseSession, modes: null })).toBe('')
    expect(opencodeModeButtonLabel({ ...baseSession, modes: { currentModeId: '', availableModes: [] } })).toBe('')
  })

  it('uses the matching mode name', () => {
    expect(
      opencodeModeButtonLabel({
        ...baseSession,
        modes: {
          currentModeId: 'plan',
          availableModes: [
            { id: 'build', name: 'Build' },
            { id: 'plan', name: 'Plan' },
          ],
        },
      }),
    ).toBe('Plan')
  })

  it('falls back to the raw currentModeId when no mode matches', () => {
    expect(
      opencodeModeButtonLabel({
        ...baseSession,
        modes: { currentModeId: 'ghost', availableModes: [{ id: 'build', name: 'Build' }] },
      }),
    ).toBe('ghost')
  })
})
