import type { Api, Model } from '@earendil-works/pi-ai'
import { isManagedQuickForgeCloudModel } from './managed-cloud-model'

export type ModelReference =
  | { version: 1; source: 'custom'; providerId: string; modelId: string }
  | { version: 1; source: 'cloud'; catalogId: string }
  | { version: 1; source: 'legacy-custom'; provider: string; modelId: string; api?: string; baseUrl?: string }

type ModelWithReference = Model<Api> & { quickforgeModelRef?: ModelReference }

export function modelReferenceFromModel(model: Model<Api>): ModelReference {
  const existing = (model as ModelWithReference).quickforgeModelRef
  if (existing) return existing
  if (isManagedQuickForgeCloudModel(model)) {
    const catalogId = String((model as Model<Api> & { quickforgeCatalogId?: string }).quickforgeCatalogId || model.id)
    return { version: 1, source: 'cloud', catalogId }
  }
  return {
    version: 1,
    source: 'legacy-custom',
    provider: model.provider,
    modelId: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
  }
}

export async function loadModelCatalog(refresh = false): Promise<Model<Api>[]> {
  const response = await fetch(`/api/models/catalog${refresh ? '?refresh=true' : ''}`, { cache: 'no-store' })
  const payload = await response.json().catch(() => null) as { models?: Model<Api>[]; error?: string } | null
  if (!response.ok) throw new Error(payload?.error || `Failed to load model catalog: HTTP ${response.status}`)
  return Array.isArray(payload?.models) ? payload.models : []
}
