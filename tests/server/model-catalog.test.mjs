import { beforeEach, describe, expect, it, vi } from 'vitest'

const customProviders = [{
  id: 'provider-one',
  models: [
    { id: 'visible', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://visible.example/v1' },
    { id: 'hidden', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://hidden.example/v1', quickforgeHidden: true },
  ],
}]

vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async (name) => name === 'custom-providers' ? customProviders : {}),
}))

describe('model catalog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists selectable custom models with canonical references', async () => {
    const { listModelCatalog } = await import('../../server/model-catalog.mjs')
    const models = await listModelCatalog({ context: { isLocalRequest: true } })
    expect(models.map((model) => model.id)).toEqual(['visible'])
    expect(models[0].quickforgeModelRef).toEqual({ version: 1, source: 'custom', providerId: 'provider-one', modelId: 'visible' })
  })

  it('keeps only the current hidden binding and prevents another hidden selection', async () => {
    const { listModelCatalog, resolveModelBinding } = await import('../../server/model-catalog.mjs')
    const current = customProviders[0].models[1]
    const models = await listModelCatalog({ context: { isLocalRequest: true }, currentModel: current })
    expect(models.map((model) => model.id)).toEqual(['hidden', 'visible'])

    await expect(resolveModelBinding({
      modelRef: { version: 1, source: 'custom', providerId: 'provider-one', modelId: 'hidden' },
    }, { context: { isLocalRequest: true } })).rejects.toMatchObject({ code: 'model_not_selectable' })

    await expect(resolveModelBinding({
      modelRef: { version: 1, source: 'custom', providerId: 'provider-one', modelId: 'hidden' },
    }, { context: { isLocalRequest: true }, currentModel: current, allowCurrentHidden: true })).resolves.toMatchObject({ model: current })
  })

  it('keeps the persisted current model even when it is no longer listed', async () => {
    const { listModelCatalog } = await import('../../server/model-catalog.mjs')
    const currentModel = { id: 'removed', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://removed.example/v1' }
    const models = await listModelCatalog({ context: { isLocalRequest: true }, currentModel })
    expect(models.map((model) => model.id)).toEqual(['removed', 'visible'])
    expect(models[0].quickforgeModelRef).toEqual({
      version: 1,
      source: 'legacy-custom',
      provider: 'Provider One',
      modelId: 'removed',
      api: 'openai-completions',
      baseUrl: 'https://removed.example/v1',
    })
  })

  it('rejects a legacy cloud reference as an invalid model reference', async () => {
    const { resolveModelBinding } = await import('../../server/model-catalog.mjs')
    await expect(resolveModelBinding({
      modelRef: { version: 1, source: 'cloud', catalogId: 'cloud-fast' },
    }, { context: { isLocalRequest: true } })).rejects.toMatchObject({ code: 'invalid_model_reference' })
  })

  it('does not trust custom transport submitted with a canonical reference', async () => {
    const { resolveModelBinding } = await import('../../server/model-catalog.mjs')
    const binding = await resolveModelBinding({
      modelRef: { version: 1, source: 'custom', providerId: 'provider-one', modelId: 'visible' },
      model: { id: 'visible', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://attacker.example/v1' },
    }, { context: { isLocalRequest: true } })
    expect(binding.model.baseUrl).toBe('https://visible.example/v1')
    await expect(resolveModelBinding({
      model: { id: 'ghost', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://attacker.example/v1' },
    }, { context: { isLocalRequest: true }, forExecution: true })).rejects.toMatchObject({ code: 'model_not_configured' })
  })
})
