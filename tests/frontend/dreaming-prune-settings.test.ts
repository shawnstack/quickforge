import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The pruning controls live inside a fairly large settings component whose data
// flow is already covered server-side. What is easy to break by accident is the
// wiring: a renamed field, or a label that only exists in one locale. Both are
// source-level facts, so they are asserted here instead of standing up the whole
// fetch/mock tree.
const component = readFileSync(
  new URL('../../src/components/dreaming/DreamingSettingsTab.tsx', import.meta.url),
  'utf8',
)
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

const PRUNE_KEYS = [
  'dreamingAdvanced',
  'dreamingPruneStaleNotes',
  'dreamingPruneStaleNotesInfo',
  'dreamingPruneUnusedDays',
  'dreamingPruneUnusedDaysInfo',
  'dreamingPruneMaxRecalls',
  'dreamingPruneMaxRecallsInfo',
  'dreamingPruneMinNotes',
  'dreamingPruneMinNotesInfo',
  'dreamingRunPruned',
  'dreamingRunPrunedNote',
]

describe('dreaming pruning settings', () => {
  it('carries every pruning key in both locales', () => {
    for (const key of PRUNE_KEYS) {
      const occurrences = (i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length
      expect(occurrences, `${key} must exist in en and zh`).toBe(2)
    }
  })

  it('saves each pruning field through the shared settings patch', () => {
    // A field name typed on only one side (control vs. patch) saves silently
    // nothing, which is exactly the failure this catches.
    for (const field of ['pruneStaleNotes', 'pruneUnusedDays', 'pruneMaxRecalls', 'pruneMinNotes']) {
      expect(component).toContain(`updateSettings({ ${field}:`)
    }
  })

  it('keeps the pruning controls behind the advanced toggle', () => {
    expect(component).toContain("t('dreamingAdvanced')")
    expect(component).toContain('advancedOpen')
    // The number inputs clamp to the same ranges as the server normalizer, so a
    // typed value is never rejected by the API after the UI accepted it.
    expect(component).toContain('max={3650}')
    expect(component).toContain('max={1000}')
    expect(component).toContain('max={500}')
  })

  it('shows auto-deleted notes as their own diff group in a run', () => {
    expect(component).toContain('diff.pruned ?? []')
    expect(component).toContain("t('dreamingRunPruned')")
  })
})
