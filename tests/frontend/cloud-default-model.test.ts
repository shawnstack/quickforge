import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { chooseNewSessionModel, chooseStartupModel } from '../../src/lib/startup-model'

const custom = {
  id: 'local', name: 'Local', provider: 'custom', api: 'openai-completions', baseUrl: 'http://localhost:4000/v1',
} as Model<Api>
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

  it('keeps ordinary custom Provider models unchanged', () => {
    const customSnapshot = { ...custom, name: 'Persisted custom snapshot' } as Model<Api>
    expect(chooseNewSessionModel(customSnapshot, [], [cloud])).toBe(customSnapshot)
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
