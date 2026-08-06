import { describe, expect, it } from 'vitest'
import {
  CLOUD_SERVICE_SETTINGS_KEY,
  DEFAULT_CLOUD_URL,
  readCloudServiceConfig,
  saveCloudServiceConfig,
} from '../../../server/cloud/service-config.mjs'

function settingsReader(value) {
  return async (name) => {
    expect(name).toBe('settings')
    return value
  }
}

describe('cloud service config', () => {
  it('uses saved over env over product default', async () => {
    await expect(readCloudServiceConfig({
      readSettings: settingsReader({ [CLOUD_SERVICE_SETTINGS_KEY]: { cloudUrl: 'https://saved.example/base' } }),
      env: { QUICKFORGE_CLOUD_URL: 'https://env.example' },
    })).resolves.toMatchObject({ source: 'saved', cloudUrl: 'https://saved.example/base/' })

    await expect(readCloudServiceConfig({
      readSettings: settingsReader({}),
      env: { QUICKFORGE_CLOUD_URL: 'https://env.example' },
    })).resolves.toMatchObject({ source: 'env', cloudUrl: 'https://env.example/' })

    await expect(readCloudServiceConfig({ readSettings: settingsReader({}), env: {} })).resolves.toMatchObject({
      source: 'default', cloudUrl: DEFAULT_CLOUD_URL,
    })
  })

  it('persists only the managed service record in settings', async () => {
    let updated
    await saveCloudServiceConfig('http://localhost:8082', {
      updateSettings: async (name, updater) => {
        expect(name).toBe('settings')
        updated = updater({ theme: 'dark' })
        return updated
      },
    })
    expect(updated).toEqual({
      theme: 'dark',
      [CLOUD_SERVICE_SETTINGS_KEY]: {
        schemaVersion: 1,
        serviceType: 'quickforge-cloud',
        cloudUrl: 'http://localhost:8082/',
      },
    })
    expect(JSON.stringify(updated)).not.toContain('providerKeys')
    expect(JSON.stringify(updated)).not.toContain('customProviders')
  })

  it('surfaces invalid saved configuration without blocking repair reads', async () => {
    await expect(readCloudServiceConfig({
      readSettings: settingsReader({ [CLOUD_SERVICE_SETTINGS_KEY]: { cloudUrl: 'http://192.168.1.2:8082' } }),
      env: {},
      strict: false,
    })).resolves.toMatchObject({ source: 'saved', valid: false, cloudUrl: 'http://192.168.1.2:8082' })
  })
})
