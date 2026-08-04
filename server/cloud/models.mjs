import { randomUUID } from 'node:crypto'

const CLOUD_PROVIDER = 'quickforge-cloud'
const CLOUD_SOURCE = 'cloud'

export function toPublicCloudModel(model) {
  const id = String(model?.id || '').trim()
  if (!id) throw new Error('Cloud model is missing an id.')
  const capabilities = model.capabilities || {}
  return {
    id,
    name: String(model.name || id),
    provider: CLOUD_PROVIDER,
    api: 'openai-completions',
    baseUrl: `quickforge://cloud/${encodeURIComponent(id)}`,
    reasoning: Boolean(capabilities.reasoning),
    input: capabilities.vision ? ['text', 'image'] : ['text'],
    contextWindow: Number(model.contextWindow || 128_000),
    maxTokens: Number(model.maxTokens || 8_192),
    quickforgeModelSource: CLOUD_SOURCE,
    quickforgeCatalogId: id,
    quickforgeCapabilities: {
      tools: Boolean(capabilities.tools),
      vision: Boolean(capabilities.vision),
      reasoning: Boolean(capabilities.reasoning),
    },
  }
}

export function isManagedCloudModel(model) {
  return model?.provider === CLOUD_PROVIDER && model?.quickforgeModelSource === CLOUD_SOURCE && typeof model?.quickforgeCatalogId === 'string'
}

export class ManagedCloudModels {
  constructor({ identity } = {}) {
    if (!identity) throw new Error('ManagedCloudModels requires an identity manager.')
    this.identity = identity
  }

  async list(signal, options) {
    return (await this.identity.models(signal, options)).map(toPublicCloudModel)
  }

  async resolve(model, signal) {
    if (!isManagedCloudModel(model)) return undefined
    const catalogId = model.quickforgeCatalogId
    const available = await this.identity.models(signal)
    const entry = available.find((item) => item?.id === catalogId && item?.available !== false)
    if (!entry) {
      const error = new Error(`QuickForge Cloud model is unavailable: ${catalogId}`)
      error.code = 'cloud_model_unavailable'
      throw error
    }
    return {
      publicModel: toPublicCloudModel(entry),
      catalogId,
    }
  }

  async chat(model, payload, signal) {
    const resolved = await this.resolve(model, signal)
    if (!resolved) throw new Error('Model is not managed by QuickForge Cloud.')
    const request = {
      ...payload,
      model: resolved.catalogId,
    }
    delete request.baseUrl
    delete request.headers
    delete request.apiKey
    return this.identity.chat(request, randomUUID(), signal)
  }
}

export const QUICKFORGE_CLOUD_PROVIDER = CLOUD_PROVIDER
