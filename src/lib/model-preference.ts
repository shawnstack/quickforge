import type { Api, Model } from '@earendil-works/pi-ai'
import { modelReferenceFromModel, type ModelReference } from './model-reference'

export type StoredModelPreference = {
  modelRef?: ModelReference
  modelSnapshot?: Model<Api>
}

export function storedModelPreference(model: Model<Api>): StoredModelPreference {
  return {
    modelRef: modelReferenceFromModel(model),
    modelSnapshot: model,
  }
}

export function modelFromStoredPreference(value: unknown): Model<Api> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const stored = value as StoredModelPreference & Partial<Model<Api>>
  const snapshot = stored.modelSnapshot || (stored.id ? stored as Model<Api> : undefined)
  if (!snapshot?.id || !snapshot.provider || !snapshot.api || !snapshot.baseUrl) return undefined
  return {
    ...snapshot,
    ...(stored.modelRef ? { quickforgeModelRef: stored.modelRef } : {}),
  } as Model<Api>
}
