import { describe, expect, it } from 'vitest'
import { cloudEndpoint, parseCloudBaseUrl, readCloudConfig } from '../../../server/cloud/config.mjs'

describe('cloud config', () => {
  it('accepts HTTPS and normalizes its trailing slash', () => {
    const url = parseCloudBaseUrl('https://cloud.example.com/base')
    expect(url.href).toBe('https://cloud.example.com/base/')
    expect(cloudEndpoint(url, '/v1/models').href).toBe('https://cloud.example.com/base/v1/models')
  })

  it('rejects credentials, query, fragments, and insecure production URLs', () => {
    expect(() => parseCloudBaseUrl('https://user:pass@cloud.example.com')).toThrow()
    expect(() => parseCloudBaseUrl('https://cloud.example.com?q=1')).toThrow()
    expect(() => parseCloudBaseUrl('https://cloud.example.com/#x')).toThrow()
    expect(() => parseCloudBaseUrl('http://cloud.example.com')).toThrow()
  })

  it('keeps an environment URL disabled until the saved service switch is enabled', () => {
    expect(readCloudConfig({ QUICKFORGE_CLOUD_URL: 'https://env.example' })).toMatchObject({
      enabled: false,
      baseUrl: new URL('https://env.example/'),
    })
  })

  it('allows HTTP only for loopback addresses without an environment switch', () => {
    expect(parseCloudBaseUrl('http://127.0.0.1:8080').origin).toBe('http://127.0.0.1:8080')
    expect(parseCloudBaseUrl('http://localhost:8082').href).toBe('http://localhost:8082/')
    expect(() => parseCloudBaseUrl('http://192.168.1.2:8080')).toThrow()
  })
})
