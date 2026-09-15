import { describe, expect, it } from 'vitest'
import * as cloud from '../../../server/cloud/index.mjs'

const expectedExportTypes = {
  readCloudConfig: 'function',
  parseCloudBaseUrl: 'function',
  cloudEndpoint: 'function',
  readCloudServiceConfig: 'function',
  saveCloudServiceConfig: 'function',
  publicCloudServiceConfig: 'function',
  DEFAULT_CLOUD_URL: 'string',
  CloudClient: 'function',
  CloudApiError: 'function',
  createCloudCredentialStore: 'function',
  publicCloudCredentialRecord: 'function',
  CloudIdentityManager: 'function',
  ManagedCloudModels: 'function',
  isManagedCloudModel: 'function',
  toPublicCloudModel: 'function',
  QUICKFORGE_CLOUD_PROVIDER: 'string',
  createCloudRuntime: 'function',
  getCloudRuntime: 'function',
  invalidateCloudRuntime: 'function',
  resolveManagedCloudProvider: 'function',
}

describe('cloud module export contract', () => {
  it('re-exports the complete cloud API surface', () => {
    expect(Object.keys(expectedExportTypes)).toHaveLength(20)
    for (const [name, type] of Object.entries(expectedExportTypes)) {
      expect(cloud, `expected export ${name}`).toHaveProperty(name)
      expect(cloud[name], `typeof ${name}`).toBeDefined()
      expect(typeof cloud[name], `typeof ${name}`).toBe(type)
    }
  })

  it('exports real classes and stable constants', () => {
    expect(new cloud.CloudApiError('boom')).toBeInstanceOf(Error)
    expect(cloud.CloudClient).toHaveProperty('prototype')
    expect(cloud.ManagedCloudModels).toHaveProperty('prototype')
    expect(cloud.CloudIdentityManager).toHaveProperty('prototype')
    expect(cloud.QUICKFORGE_CLOUD_PROVIDER).toBe('quickforge-cloud')
    expect(cloud.DEFAULT_CLOUD_URL).toMatch(/^https:\/\//)
  })
})
