import { describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { mergeModelGroups } from '../../src/lib/model-aggregation'

const piWebUiMocks = vi.hoisted(() => ({
  AppStorage: class {},
  CustomProvidersStore: class {},
  ProviderKeysStore: class {},
  SessionsStore: class {},
  SettingsStore: class {},
  setAppStorage: vi.fn(),
  translations: { en: {} },
}))

const modelReferenceMocks = vi.hoisted(() => ({
  loadModelCatalog: vi.fn(async () => [] as Model<Api>[]),
}))

vi.mock('@earendil-works/pi-web-ui', () => piWebUiMocks)
vi.mock('@/lib/model-reference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/model-reference')>()
  return { ...actual, loadModelCatalog: modelReferenceMocks.loadModelCatalog }
})

import { resolveNewSessionModel } from '../../src/lib/pi-chat'

const custom = {
  id: 'same', name: 'Custom', provider: 'custom', api: 'openai-completions', baseUrl: 'https://custom.example/v1',
} as Model<Api>
const cloud = {
  id: 'same', name: 'Cloud', provider: 'quickforge-cloud', api: 'openai-completions', baseUrl: 'quickforge://cloud/same',
} as Model<Api>
const usable = (model: unknown): model is Model<Api> => Boolean((model as Model<Api>)?.id)
const normalize = (model: Model<Api>) => model

const staleCloudModel = {
  id: 'cloud-persisted', name: 'Persisted Cloud', provider: 'quickforge-cloud', api: 'openai-completions',
  baseUrl: 'quickforge://cloud/cloud-persisted', quickforgeModelSource: 'cloud', quickforgeCatalogId: 'cloud-persisted',
} as Model<Api>

function storageWithCustomModel() {
  return {
    customProviders: {
      getAll: vi.fn(async () => [{
        id: 'provider-one', name: 'Provider One', type: 'openai-completions',
        baseUrl: custom.baseUrl, models: [custom],
      }]),
    },
    settings: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
  } as never
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

describe('available model aggregation', () => {
  it('keeps custom models first and same ids from different providers distinct', () => {
    const models = mergeModelGroups(normalize, usable, [custom], [cloud])
    expect(models.map((model) => model.provider)).toEqual(['custom', 'quickforge-cloud'])
  })

  it('deduplicates the same provider model identity', () => {
    expect(mergeModelGroups(normalize, usable, [custom], [{ ...custom }])).toHaveLength(1)
  })
})

describe('resolveNewSessionModel Cloud deadline', () => {
  it('falls back to the configured model after the Cloud catalog deadline', async () => {
    vi.useFakeTimers()
    try {
      const loadCloudModels = vi.fn(() => new Promise<Model<Api>[]>(() => {}))
      const pending = resolveNewSessionModel(storageWithCustomModel(), staleCloudModel, loadCloudModels)

      let settled = false
      void pending.then(() => { settled = true })
      await flushMicrotasks()
      expect(settled).toBe(false)

      vi.advanceTimersByTime(5_000)
      await expect(pending).resolves.toMatchObject({ id: 'same', provider: 'custom' })
      expect(loadCloudModels).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still falls back to the configured model when the Cloud load rejects', async () => {
    const loadCloudModels = vi.fn(async () => Promise.reject(new Error('cloud offline')))
    const model = await resolveNewSessionModel(storageWithCustomModel(), staleCloudModel, loadCloudModels)
    expect(model).toMatchObject({ id: 'same', provider: 'custom' })
  })
})
