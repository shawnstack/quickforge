import { beforeEach, describe, expect, it, vi } from 'vitest'

const customProviders = [{
  id: 'provider-one',
  models: [
    { id: 'visible', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://visible.example/v1' },
    { id: 'hidden', provider: 'Provider One', api: 'openai-completions', baseUrl: 'https://hidden.example/v1', quickforgeHidden: true },
  ],
}]

const cloudModel = {
  id: 'cloud-fast',
  name: 'Cloud Fast',
  provider: 'quickforge-cloud',
  api: 'openai-completions',
  baseUrl: 'quickforge://cloud/cloud-fast',
  quickforgeModelSource: 'cloud',
  quickforgeCatalogId: 'cloud-fast',
}

const cloudRuntime = {
  enabled: true,
  models: {
    list: vi.fn(async () => [cloudModel]),
    resolve: vi.fn(async () => ({ publicModel: cloudModel })),
  },
}

vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async (name) => name === 'custom-providers' ? customProviders : {}),
}))

vi.mock('../../server/cloud/runtime.mjs', () => ({
  getCloudRuntime: vi.fn(async () => cloudRuntime),
}))

describe('model catalog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists selectable custom and Cloud models with canonical references', async () => {
    const { listModelCatalog } = await import('../../server/model-catalog.mjs')
    const models = await listModelCatalog({ context: { isLocalRequest: true } })
    expect(models.map((model) => model.id)).toEqual(['visible', 'cloud-fast'])
    expect(models[0].quickforgeModelRef).toEqual({ version: 1, source: 'custom', providerId: 'provider-one', modelId: 'visible' })
    expect(models[1].quickforgeModelRef).toEqual({ version: 1, source: 'cloud', catalogId: 'cloud-fast' })
  })

  it('keeps only the current hidden binding and prevents another hidden selection', async () => {
    const { listModelCatalog, resolveModelBinding } = await import('../../server/model-catalog.mjs')
    const current = customProviders[0].models[1]
    const models = await listModelCatalog({ context: { isLocalRequest: true }, currentModel: current })
    expect(models.map((model) => model.id)).toEqual(['hidden', 'visible', 'cloud-fast'])

    await expect(resolveModelBinding({
      modelRef: { version: 1, source: 'custom', providerId: 'provider-one', modelId: 'hidden' },
    }, { context: { isLocalRequest: true } })).rejects.toMatchObject({ code: 'model_not_selectable' })

    await expect(resolveModelBinding({
      modelRef: { version: 1, source: 'custom', providerId: 'provider-one', modelId: 'hidden' },
    }, { context: { isLocalRequest: true }, currentModel: current, allowCurrentHidden: true })).resolves.toMatchObject({ model: current })
  })

  it('allows Cloud for authenticated remote clients and denies untrusted share contexts', async () => {
    const { resolveModelBinding } = await import('../../server/model-catalog.mjs')
    const input = { modelRef: { version: 1, source: 'cloud', catalogId: 'cloud-fast' } }
    await expect(resolveModelBinding(input, {
      context: { isLocalRequest: false, remoteAddress: '192.168.1.10', remoteAuthorized: true },
    })).resolves.toMatchObject({ model: cloudModel })
    await expect(resolveModelBinding(input, {
      context: { isLocalRequest: false, remoteAuthorized: false },
    })).rejects.toMatchObject({ statusCode: 403, code: 'cloud_access_denied' })
    await expect(resolveModelBinding(input, {
      context: { isLocalRequest: true, source: 'shared', allowCloud: false },
    })).rejects.toMatchObject({ statusCode: 403, code: 'cloud_access_denied' })
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
