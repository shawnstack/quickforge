import type { Api, Model } from '@earendil-works/pi-ai'

type ModelIdentity = Pick<Model<Api>, 'provider' | 'id' | 'api' | 'baseUrl'>

type ModelReference = {
  provider: string
  modelId: string
  api?: string
  baseUrl?: string
}

export function normalizeModelBaseUrl(value?: string) {
  return (value ?? '').trim().replace(/\/$/, '')
}

export function modelIdentityKey(model: ModelIdentity) {
  return JSON.stringify([
    model.provider,
    model.id,
    model.api,
    normalizeModelBaseUrl(model.baseUrl),
  ])
}

export function sameModelIdentity(left?: ModelIdentity, right?: ModelIdentity) {
  return Boolean(left && right && modelIdentityKey(left) === modelIdentityKey(right))
}

export function modelMatchesReference(model: ModelIdentity, reference: ModelReference) {
  return model.provider === reference.provider
    && model.id === reference.modelId
    && (!reference.api || model.api === reference.api)
    && (!reference.baseUrl || normalizeModelBaseUrl(model.baseUrl) === normalizeModelBaseUrl(reference.baseUrl))
}

export function includeCurrentModel<T extends ModelIdentity>(
  selectableModels: readonly T[],
  currentModel?: T,
): T[] {
  if (!currentModel || selectableModels.some((model) => sameModelIdentity(model, currentModel))) {
    return [...selectableModels]
  }
  return [currentModel, ...selectableModels]
}
