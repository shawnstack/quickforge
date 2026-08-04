import { describe, expect, it, vi } from 'vitest'
import { ManagedCloudModels, toPublicCloudModel } from '../../../server/cloud/models.mjs'

const catalog = [{
  id: 'qf-fast', name: 'QuickForge Fast', available: true,
  capabilities: { tools: true, vision: false, reasoning: true },
}]

describe('managed cloud models', () => {
  it('returns a public model without cloud URL, credentials, or headers', () => {
    const model = toPublicCloudModel(catalog[0])
    expect(model).toMatchObject({
      id: 'qf-fast', provider: 'quickforge-cloud', baseUrl: 'quickforge://cloud/qf-fast',
      quickforgeModelSource: 'cloud', quickforgeCatalogId: 'qf-fast',
    })
    expect(JSON.stringify(model)).not.toContain('Authorization')
    expect(JSON.stringify(model)).not.toContain('https://')
    expect(model).not.toHaveProperty('apiKey')
    expect(model).not.toHaveProperty('headers')
  })

  it('ignores client-controlled URL, headers, key, and model payload fields', async () => {
    const identity = {
      models: vi.fn(async () => catalog),
      chat: vi.fn(async (payload) => payload),
    }
    const managed = new ManagedCloudModels({ identity })
    const response = await managed.chat({
      ...toPublicCloudModel(catalog[0]),
      baseUrl: 'https://attacker.example/v1',
      headers: { Authorization: 'steal' },
      apiKey: 'steal',
    }, {
      model: 'attacker-model', messages: [{ role: 'user', content: 'hello' }],
      baseUrl: 'https://attacker.example', headers: { Authorization: 'steal' }, apiKey: 'steal',
    })
    expect(response.model).toBe('qf-fast')
    expect(response).not.toHaveProperty('baseUrl')
    expect(response).not.toHaveProperty('headers')
    expect(response).not.toHaveProperty('apiKey')
    expect(identity.chat).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      undefined,
    )
  })

  it('rejects unavailable catalog ids even if the public model shape is forged', async () => {
    const managed = new ManagedCloudModels({ identity: { models: async () => catalog } })
    await expect(managed.resolve({
      provider: 'quickforge-cloud', quickforgeModelSource: 'cloud', quickforgeCatalogId: 'forged',
    })).rejects.toMatchObject({ code: 'cloud_model_unavailable' })
  })
})
