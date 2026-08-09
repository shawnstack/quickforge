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
  it('uses saved over env over product default without implicitly enabling Cloud', async () => {
    await expect(readCloudServiceConfig({
      readSettings: settingsReader({ [CLOUD_SERVICE_SETTINGS_KEY]: { enabled: true, cloudUrl: 'https://saved.example/base' } }),
      env: { QUICKFORGE_CLOUD_URL: 'https://env.example' },
    })).resolves.toMatchObject({ source: 'saved', enabled: true, cloudUrl: 'https://saved.example/base/' })

    await expect(readCloudServiceConfig({
      readSettings: settingsReader({}),
      env: { QUICKFORGE_CLOUD_URL: 'https://env.example' },
    })).resolves.toMatchObject({ source: 'env', enabled: false, cloudUrl: 'https://env.example/' })

    await expect(readCloudServiceConfig({ readSettings: settingsReader({}), env: {} })).resolves.toMatchObject({
      source: 'default', enabled: false, cloudUrl: DEFAULT_CLOUD_URL,
    })

    await expect(readCloudServiceConfig({
      readSettings: settingsReader({ [CLOUD_SERVICE_SETTINGS_KEY]: { cloudUrl: 'https://legacy.example' } }),
      env: {},
    })).resolves.toMatchObject({ source: 'saved', enabled: false, cloudUrl: 'https://legacy.example/' })
  })

  it('persists only the managed service record in settings', async () => {
    let updated
    await saveCloudServiceConfig({ cloudUrl: 'http://localhost:8082', enabled: true }, {
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
        enabled: true,
        cloudUrl: 'http://localhost:8082/',
      },
    })
    expect(JSON.stringify(updated)).not.toContain('providerKeys')
    expect(JSON.stringify(updated)).not.toContain('customProviders')
  })

  it('persists an invalid legacy URL only when explicitly allowed for switch-only repair', async () => {
    let updated
    await saveCloudServiceConfig({ cloudUrl: 'ftp://invalid.example', enabled: false, allowInvalidUrl: true }, {
      updateSettings: async (_name, updater) => { updated = updater({}) },
    })
    expect(updated[CLOUD_SERVICE_SETTINGS_KEY]).toMatchObject({ enabled: false, cloudUrl: 'ftp://invalid.example' })
    await expect(saveCloudServiceConfig({ cloudUrl: 'ftp://invalid.example', enabled: true }, {
      updateSettings: async () => undefined,
    })).rejects.toThrow()
  })

  it('surfaces invalid saved configuration without blocking repair reads', async () => {
    await expect(readCloudServiceConfig({
      readSettings: settingsReader({ [CLOUD_SERVICE_SETTINGS_KEY]: { enabled: true, cloudUrl: 'ftp://invalid.example' } }),
      env: {},
      strict: false,
    })).resolves.toMatchObject({ source: 'saved', enabled: true, valid: false, cloudUrl: 'ftp://invalid.example' })
  })
})
