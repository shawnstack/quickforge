import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { modelFromStoredPreference, storedModelPreference } from '../../src/lib/model-preference'

const model = {
  id: 'm1',
  name: 'Model One',
  provider: 'Provider',
  api: 'openai-completions',
  baseUrl: 'https://example.test/v1',
  quickforgeModelRef: { version: 1, source: 'custom', providerId: 'provider-1', modelId: 'm1' },
} as Model<Api>

describe('model preference persistence', () => {
  it('writes modelRef plus a non-authoritative snapshot', () => {
    expect(storedModelPreference(model)).toEqual({
      modelRef: model.quickforgeModelRef,
      modelSnapshot: model,
    })
  })

  it('reads both new and legacy preference shapes', () => {
    expect(modelFromStoredPreference({ modelRef: model.quickforgeModelRef, modelSnapshot: model }))
      .toMatchObject({ id: 'm1', quickforgeModelRef: model.quickforgeModelRef })
    expect(modelFromStoredPreference(model)).toMatchObject({ id: 'm1' })
  })
})
