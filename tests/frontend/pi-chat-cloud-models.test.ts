import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { mergeModelGroups } from '../../src/lib/model-aggregation'

const custom = {
  id: 'same', name: 'Custom', provider: 'custom', api: 'openai-completions', baseUrl: 'https://custom.example/v1',
} as Model<Api>
const cloud = {
  id: 'same', name: 'Cloud', provider: 'quickforge-cloud', api: 'openai-completions', baseUrl: 'quickforge://cloud/same',
} as Model<Api>
const usable = (model: unknown): model is Model<Api> => Boolean((model as Model<Api>)?.id)
const normalize = (model: Model<Api>) => model

describe('available model aggregation', () => {
  it('keeps custom models first and same ids from different providers distinct', () => {
    const models = mergeModelGroups(normalize, usable, [custom], [cloud])
    expect(models.map((model) => model.provider)).toEqual(['custom', 'quickforge-cloud'])
  })

  it('deduplicates the same provider model identity', () => {
    expect(mergeModelGroups(normalize, usable, [custom], [{ ...custom }])).toHaveLength(1)
  })
})
