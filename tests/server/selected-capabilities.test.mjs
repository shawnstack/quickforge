import { describe, expect, it } from 'vitest'
import {
  normalizeSelectedCapabilities,
  selectedCapabilitiesFromMessage,
  selectedCapabilityPrompt,
  selectedCapabilitySnapshots,
  withCanonicalSelectedCapabilities,
} from '../../server/selected-capabilities.mjs'

const raw = [
  { type: 'plugin', pluginName: ' documents ', name: ' documents ', label: ' Documents ', description: ' Create docs ' },
  { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Duplicate' },
  { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Lint' },
  { type: 'skill', pluginName: 'demo', name: 'review', label: 'Review' },
  { type: 'command', pluginName: 'demo', name: 'ship', label: 'Ship' },
  { type: 'plugin', pluginName: 'ignored', name: 'fifth', label: 'Fifth' },
]

describe('server selected capability normalization', () => {
  it('matches the client trimming, dedupe, order, limit, and snapshot rules', () => {
    expect(normalizeSelectedCapabilities(raw)).toEqual([
      { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents', description: 'Create docs' },
      { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Lint' },
      { type: 'skill', pluginName: 'demo', name: 'review', label: 'Review' },
      { type: 'command', pluginName: 'demo', name: 'ship', label: 'Ship' },
    ])
    expect(selectedCapabilitySnapshots(raw)[0]).not.toHaveProperty('description')
  })

  it('reads persisted message selections as snapshots and matches the client history boundary', () => {
    const persisted = {
      role: 'user',
      details: {
        selectedCapabilities: [{
          type: 'plugin',
          pluginName: ' documents ',
          name: ' documents ',
          label: ' Documents ',
          description: 'forged historical description',
        }],
      },
    }
    expect(selectedCapabilitiesFromMessage(persisted)).toEqual([
      { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' },
    ])
  })

  it('uses canonical request selections as authoritative message details', () => {
    const message = withCanonicalSelectedCapabilities({
      role: 'user',
      content: 'hello',
      details: { selectedCapabilities: [{ type: 'plugin', pluginName: 'forged', name: 'forged', label: 'Forged' }], contextReferences: [{ path: 'keep' }] },
    }, raw)
    expect(selectedCapabilitiesFromMessage(message)).toEqual(selectedCapabilitySnapshots(raw))
    expect(message.details.contextReferences).toEqual([{ path: 'keep' }])
    expect(withCanonicalSelectedCapabilities(message, []).details).toEqual({ contextReferences: [{ path: 'keep' }] })
  })

  it('builds the prompt from the same normalized values while retaining descriptions only for the transient prompt', () => {
    const prompt = selectedCapabilityPrompt(raw)
    expect(prompt).toContain('Documents (plugin, plugin: documents, name: documents)')
    expect(prompt).toContain('Description: Create docs')
    expect(prompt).toContain('plugin__demo__lint')
    expect(prompt).not.toContain('Duplicate')
    expect(prompt).not.toContain('Fifth')
  })
})
