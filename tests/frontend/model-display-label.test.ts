import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { modelDisplayLabel } from '../../src/lib/model-display-label'
import {
  includeCurrentModel,
  modelIdentityKey,
  modelMatchesReference,
  sameModelIdentity,
} from '../../src/lib/model-identity'

const visible = {
  id: 'model-a',
  name: 'Internal provider name',
  provider: 'OpenRouter',
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
} as Model<Api>

const hidden = {
  ...visible,
  id: 'model-hidden',
  baseUrl: 'https://openrouter.ai/api/v1/',
} as Model<Api>

describe('modelDisplayLabel', () => {
  it('shows a stable provider and model id label without internal model names', () => {
    expect(modelDisplayLabel({ provider: 'OpenRouter', id: 'anthropic/claude-sonnet-4' }))
      .toBe('OpenRouter / anthropic/claude-sonnet-4')
    expect(modelDisplayLabel(visible)).not.toContain(visible.name)
  })
})

describe('model identity helpers', () => {
  it('keeps models with the same provider and id distinct when API endpoints differ', () => {
    const anotherEndpoint = { ...visible, baseUrl: 'https://gateway.example/v1' } as Model<Api>

    expect(modelIdentityKey(visible)).not.toBe(modelIdentityKey(anotherEndpoint))
    expect(sameModelIdentity(visible, anotherEndpoint)).toBe(false)
  })

  it('matches legacy Agent references that omit optional API fields', () => {
    expect(modelMatchesReference(visible, {
      provider: visible.provider,
      modelId: visible.id,
    })).toBe(true)
  })

  it('keeps the current hidden binding while excluding it from unrelated new choices', () => {
    expect(includeCurrentModel([visible], hidden)).toEqual([hidden, visible])
    expect(includeCurrentModel([visible], visible)).toEqual([visible])
  })
})
