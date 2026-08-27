import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectToolResultToolCallIds, isNewlyPresentedArtifact } from '../../src/components/workspace/artifact-preview-utils'

describe('collectToolResultToolCallIds', () => {
  it('collects toolCallIds from toolResult messages only', () => {
    const ids = collectToolResultToolCallIds([
      { role: 'user' },
      { role: 'assistant', toolCallId: 'call-a' },
      { role: 'toolResult', toolCallId: 'call-a' },
      { role: 'toolResult', toolCallId: 'call-b' },
    ])
    expect(ids).toEqual(new Set(['call-a', 'call-b']))
  })

  it('skips non-string or empty toolCallIds', () => {
    const ids = collectToolResultToolCallIds([
      { role: 'toolResult' },
      { role: 'toolResult', toolCallId: 42 },
      { role: 'toolResult', toolCallId: '' },
      { role: 'toolResult', toolCallId: 'call-a' },
    ])
    expect(ids).toEqual(new Set(['call-a']))
  })

  it('returns an empty set when there are no toolResult messages', () => {
    expect(collectToolResultToolCallIds([{ role: 'user' }, { role: 'assistant' }]).size).toBe(0)
    expect(collectToolResultToolCallIds([]).size).toBe(0)
  })
})

describe('isNewlyPresentedArtifact', () => {
  it('returns false when every id is already in the history snapshot', () => {
    expect(isNewlyPresentedArtifact(['call-a', 'call-b'], new Set(['call-a', 'call-b']))).toBe(false)
  })

  it('returns true when any id is missing from the history snapshot', () => {
    expect(isNewlyPresentedArtifact(['call-a', 'call-new'], new Set(['call-a']))).toBe(true)
  })

  it('returns false for missing or empty toolCallIds (conservative no-popup)', () => {
    expect(isNewlyPresentedArtifact(undefined, new Set(['call-a']))).toBe(false)
    expect(isNewlyPresentedArtifact([], new Set(['call-a']))).toBe(false)
  })

  it('returns true when the history snapshot is empty but ids exist', () => {
    expect(isNewlyPresentedArtifact(['call-a'], new Set())).toBe(true)
  })
})

describe('auto preview fresh-present source contract', () => {
  it('gates auto preview on the attach-time history snapshot instead of session storage', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
    const utilsSource = readFileSync(new URL('../../src/components/workspace/artifact-preview-utils.ts', import.meta.url), 'utf8')

    expect(appSource).toContain('isNewlyPresentedArtifact(artifact.toolCallIds')
    expect(appSource).toContain('collectToolResultToolCallIds(')
    expect(appSource).toContain('autoPreviewHistoryRef')
    expect(appSource).not.toContain('hasSeenAutoPreviewSignature')
    expect(appSource).not.toContain('useWorkspaceInspectorOpenState')
    expect(appSource).not.toContain('auto-preview-seen-signatures')
    expect(utilsSource).toContain('export function collectToolResultToolCallIds(')
    expect(utilsSource).toContain('export function isNewlyPresentedArtifact(')
  })
})
