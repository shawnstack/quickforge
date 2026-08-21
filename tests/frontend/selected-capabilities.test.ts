import { describe, expect, it } from 'vitest'
import {
  normalizeSelectedCapabilities,
  selectedCapabilitiesFromDetails,
  selectedCapabilitySnapshots,
  withSelectedCapabilitiesSnapshot,
} from '../../src/lib/selected-capabilities'

const raw = [
  { type: 'plugin', pluginName: ' documents ', name: ' documents ', label: ' Documents ', description: ' Create docs ' },
  { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Duplicate' },
  { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Lint' },
  { type: 'skill', pluginName: 'demo', name: 'review', label: 'Review' },
  { type: 'command', pluginName: 'demo', name: 'ship', label: 'Ship' },
  { type: 'plugin', pluginName: 'ignored', name: 'fifth', label: 'Fifth' },
]

describe('selected capability normalization', () => {
  it('trims, deduplicates, caps at four, preserves order, and snapshots without description', () => {
    expect(normalizeSelectedCapabilities(raw)).toEqual([
      { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents', description: 'Create docs' },
      { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Lint' },
      { type: 'skill', pluginName: 'demo', name: 'review', label: 'Review' },
      { type: 'command', pluginName: 'demo', name: 'ship', label: 'Ship' },
    ])
    expect(selectedCapabilitySnapshots(raw)[0]).toEqual({ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' })
  })

  it('ignores invalid values and enforces string length boundaries', () => {
    const normalized = normalizeSelectedCapabilities([
      null,
      'documents',
      { type: 'unknown', pluginName: 'x', name: 'x', label: 'x' },
      { type: 'plugin', pluginName: '', name: 'x', label: 'x' },
      { type: 'plugin', pluginName: 'p'.repeat(140), name: 'n'.repeat(140), label: 'l'.repeat(180), description: 'd'.repeat(450) },
    ])
    expect(normalized).toHaveLength(1)
    expect(normalized[0].pluginName).toHaveLength(120)
    expect(normalized[0].name).toHaveLength(120)
    expect(normalized[0].label).toHaveLength(160)
    expect(normalized[0].description).toHaveLength(400)
  })

  it('reads history with the same snapshot boundary as the server', () => {
    const details = {
      selectedCapabilities: [{
        type: 'plugin',
        pluginName: ' documents ',
        name: ' documents ',
        label: ' Documents ',
        description: 'forged historical description',
      }],
    }
    expect(selectedCapabilitiesFromDetails(details)).toEqual([
      { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' },
    ])
  })

  it('overwrites forged details while preserving unrelated details and removes stale selections when empty', () => {
    const message = withSelectedCapabilitiesSnapshot({
      role: 'user',
      content: 'hello',
      details: { selectedCapabilities: [{ type: 'plugin', pluginName: 'forged', name: 'forged', label: 'Forged' }], keep: true },
    }, raw)
    expect(selectedCapabilitiesFromDetails(message.details)).toEqual(selectedCapabilitySnapshots(raw))
    expect(withSelectedCapabilitiesSnapshot(message, []).details).toEqual({ keep: true })
  })
})
