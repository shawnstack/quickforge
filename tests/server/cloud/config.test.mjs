import { describe, expect, it } from 'vitest'
import { cloudEndpoint, parseCloudBaseUrl } from '../../../server/cloud/config.mjs'

describe('cloud config', () => {
  it('accepts HTTPS and normalizes its trailing slash', () => {
    const url = parseCloudBaseUrl('https://cloud.example.com/base')
    expect(url.href).toBe('https://cloud.example.com/base/')
    expect(cloudEndpoint(url, '/v1/models').href).toBe('https://cloud.example.com/base/v1/models')
  })

  it('rejects credentials, query, and fragments', () => {
    expect(() => parseCloudBaseUrl('https://user:pass@cloud.example.com')).toThrow()
    expect(() => parseCloudBaseUrl('https://cloud.example.com?q=1')).toThrow()
    expect(() => parseCloudBaseUrl('https://cloud.example.com/#x')).toThrow()
  })

  it('allows HTTP and HTTPS for any host without an environment switch', () => {
    expect(parseCloudBaseUrl('https://cloud.example.com').href).toBe('https://cloud.example.com/')
    expect(parseCloudBaseUrl('http://cloud.example.com').href).toBe('http://cloud.example.com/')
    expect(parseCloudBaseUrl('http://192.168.1.2:8080').origin).toBe('http://192.168.1.2:8080')
    expect(parseCloudBaseUrl('http://127.0.0.1:8080').origin).toBe('http://127.0.0.1:8080')
    expect(parseCloudBaseUrl('http://localhost:8082').href).toBe('http://localhost:8082/')
    expect(parseCloudBaseUrl('http://[::1]:8081').href).toBe('http://[::1]:8081/')
    expect(parseCloudBaseUrl('http://dev.localhost:8083').href).toBe('http://dev.localhost:8083/')
  })

  it('labels invalid URLs as client errors without hardcoding the env var name', () => {
    expect(() => parseCloudBaseUrl('not a url')).toThrowError(
      expect.objectContaining({ statusCode: 400, message: 'QuickForge Cloud URL must be a valid URL.' }),
    )
    expect(() => parseCloudBaseUrl('ftp://cloud.example.com')).toThrowError(
      expect.objectContaining({ statusCode: 400, message: expect.not.stringContaining('QUICKFORGE_CLOUD_URL') }),
    )
  })
})
