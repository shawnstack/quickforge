import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { filterSelectableModels, isModelSelectable } from '../../src/lib/model-visibility'

const visibleModel = {
  id: 'visible',
  name: 'Visible',
  provider: 'provider-a',
  api: 'openai-completions',
  baseUrl: 'https://example.com/v1',
} as Model<Api>

const hiddenModel = {
  ...visibleModel,
  id: 'hidden',
  name: 'Hidden',
  quickforgeHidden: true,
} as Model<Api> & { quickforgeHidden: true }

describe('configured model visibility', () => {
  it('keeps legacy and explicitly visible models selectable by default', () => {
    expect(isModelSelectable({})).toBe(true)
    expect(isModelSelectable({ quickforgeHidden: false })).toBe(true)
    expect(isModelSelectable({ quickforgeHidden: undefined })).toBe(true)
  })

  it('filters only explicitly hidden models without mutating the input', () => {
    const models = [visibleModel, hiddenModel]

    expect(filterSelectableModels(models).map((model) => model.id)).toEqual(['visible'])
    expect(models.map((model) => model.id)).toEqual(['visible', 'hidden'])
  })

  it('preserves Model<Api>[] typing for readonly model catalogs', () => {
    const models: readonly Model<Api>[] = [visibleModel, hiddenModel]
    const selectableModels: Model<Api>[] = filterSelectableModels(models)

    expect(selectableModels).toEqual([visibleModel])
  })
})
