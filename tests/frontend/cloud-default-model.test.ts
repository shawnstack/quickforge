import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { chooseNewSessionModel, chooseStartupModel } from '../../src/lib/startup-model'

const custom = {
  id: 'local', name: 'Local', provider: 'custom', api: 'openai-completions', baseUrl: 'http://localhost:4000/v1',
} as Model<Api>
const hiddenCustom = {
  ...custom,
  id: 'hidden-local',
  name: 'Hidden local',
  quickforgeHidden: true,
} as Model<Api> & { quickforgeHidden: true }
const cloud = {
  id: 'cloud-current', name: 'Cloud current', provider: 'quickforge-cloud', api: 'openai-completions', baseUrl: 'quickforge://cloud/cloud-current',
  quickforgeModelSource: 'cloud', quickforgeCatalogId: 'cloud-current',
} as Model<Api>
const staleCloud = {
  id: 'cloud-old', name: 'Cloud old', provider: 'quickforge-cloud', api: 'openai-completions', baseUrl: 'quickforge://cloud/cloud-old',
  quickforgeModelSource: 'cloud', quickforgeCatalogId: 'cloud-old',
} as Model<Api>

describe('startup model fallback', () => {
  it('does not let an unavailable persisted Cloud model override the current catalog', () => {
    expect(chooseStartupModel([cloud], staleCloud, staleCloud)).toEqual(expect.objectContaining({ id: 'cloud-current' }))
  })

  it('matches a current catalog model by canonical reference even when its transport changed', () => {
    const current = {
      ...custom,
      baseUrl: 'https://new.example/v1',
      quickforgeModelRef: { version: 1, source: 'custom', providerId: 'provider-1', modelId: 'local' },
    } as Model<Api>
    const saved = { ...current, baseUrl: 'https://old.example/v1' } as Model<Api>
    expect(chooseStartupModel([current], saved)).toBe(current)
  })

  it('prefers an available configured default and keeps custom providers compatible', () => {
    expect(chooseStartupModel([custom, cloud], custom, staleCloud)).toEqual(expect.objectContaining({ id: 'local', provider: 'custom' }))
  })
})

describe('new session model fallback', () => {
  it('falls back after Cloud logout leaves a persisted Cloud default', () => {
    expect(chooseNewSessionModel(staleCloud, [custom], []))
      .toEqual(expect.objectContaining({ id: 'local', provider: 'custom' }))
  })

  it('falls back when the active Cloud service catalog no longer contains the old model', () => {
    expect(chooseNewSessionModel(staleCloud, [], [cloud]))
      .toEqual(expect.objectContaining({ id: 'cloud-current', provider: 'quickforge-cloud' }))
  })

  it('refreshes an ordinary custom Provider snapshot from the selectable catalog', () => {
    const customSnapshot = { ...custom, name: 'Persisted custom snapshot' } as Model<Api>
    expect(chooseNewSessionModel(customSnapshot, [custom], [cloud])).toBe(custom)
  })

  it('does not reuse a hidden custom snapshot for a new session', () => {
    expect(chooseNewSessionModel(hiddenCustom, [custom], [])).toBe(custom)
    expect(chooseNewSessionModel(hiddenCustom, [], [])).toBeNull()
  })

  it('requires an exact Cloud catalog match before reusing a Cloud snapshot', () => {
    const sameIdFromAnotherService = {
      ...staleCloud,
      name: 'Same id, another service',
      baseUrl: 'quickforge://cloud/another-service/cloud-old',
    } as Model<Api>

    expect(chooseNewSessionModel(staleCloud, [], [sameIdFromAnotherService, cloud]))
      .toBe(sameIdFromAnotherService)
  })

  it('does not reuse an unavailable Cloud snapshot when no fallback model exists', () => {
    expect(chooseNewSessionModel(staleCloud, [], [])).toBeNull()
  })
})
