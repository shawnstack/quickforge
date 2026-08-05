import { describe, expect, it } from 'vitest'
import { filterSelectableModels, isModelSelectable } from '../../src/lib/model-visibility'

describe('configured model visibility', () => {
  it('keeps legacy models selectable by default', () => {
    expect(isModelSelectable({})).toBe(true)
  })

  it('filters only explicitly hidden models', () => {
    const models = [
      { id: 'visible' },
      { id: 'hidden', quickforgeHidden: true },
    ]

    expect(filterSelectableModels(models).map((model) => model.id)).toEqual(['visible'])
    expect(models.map((model) => model.id)).toEqual(['visible', 'hidden'])
  })
})
