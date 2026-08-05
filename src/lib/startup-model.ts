import type { Api, Model } from '@earendil-works/pi-ai'
import { isManagedQuickForgeCloudModel } from './managed-cloud-model'

type ModelLike = Pick<Model<Api>, 'id' | 'provider' | 'api' | 'baseUrl'>

function normalizedBaseUrl(value: string) {
  return String(value || '').trim().replace(/\/$/, '')
}

export function sameStartupModel(left: ModelLike, right: ModelLike) {
  return left.id === right.id
    && left.provider === right.provider
    && left.api === right.api
    && normalizedBaseUrl(left.baseUrl) === normalizedBaseUrl(right.baseUrl)
}

export function chooseStartupModel(
  availableModels: ReadonlyArray<Model<Api>>,
  preferredModel?: Model<Api> | null,
  savedModel?: Model<Api> | null,
): Model<Api> | null {
  if (availableModels.length === 0) return null
  if (preferredModel) {
    const preferred = availableModels.find((model) => sameStartupModel(model, preferredModel))
    if (preferred) return preferred
  }
  if (savedModel) {
    const saved = availableModels.find((model) => sameStartupModel(model, savedModel))
    if (saved) return saved
  }
  return availableModels[0]
}

export function chooseNewSessionModel(
  requestedModel: Model<Api>,
  configuredModels: ReadonlyArray<Model<Api>>,
  cloudModels: ReadonlyArray<Model<Api>>,
): Model<Api> | null {
  if (!isManagedQuickForgeCloudModel(requestedModel)) return requestedModel

  const matchedCloudModel = cloudModels.find((candidate) => sameStartupModel(candidate, requestedModel))
  return matchedCloudModel ?? chooseStartupModel([...configuredModels, ...cloudModels])
}
