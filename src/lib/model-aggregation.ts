import type { Api, Model } from '@earendil-works/pi-ai'

function normalizedBaseUrl(value?: string) {
  return (value ?? '').trim().replace(/\/$/, '')
}

export function sameAvailableModel(a: Model<Api>, b: Model<Api>) {
  return a.id === b.id
    && a.provider === b.provider
    && a.api === b.api
    && normalizedBaseUrl(a.baseUrl) === normalizedBaseUrl(b.baseUrl)
}

export function mergeModelGroups(
  normalize: (model: Model<Api>) => Model<Api>,
  isUsable: (model: unknown) => model is Model<Api>,
  ...groups: ReadonlyArray<ReadonlyArray<Model<Api>>>
): Model<Api>[] {
  const merged: Model<Api>[] = []
  for (const group of groups) {
    for (const candidate of group) {
      if (!isUsable(candidate)) continue
      const model = normalize(candidate)
      if (!merged.some((existing) => sameAvailableModel(existing, model))) merged.push(model)
    }
  }
  return merged
}
