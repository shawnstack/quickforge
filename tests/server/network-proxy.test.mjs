import { describe, expect, it } from 'vitest'
import { normalizeNetworkProxyConfig, validateManualProxyUrl, validatePacUrl } from '../../server/network-proxy.mjs'

describe('network proxy configuration', () => {
  it('defaults to direct mode', () => {
    expect(normalizeNetworkProxyConfig(undefined)).toEqual({ mode: 'direct', proxyUrl: '' })
    expect(normalizeNetworkProxyConfig({ mode: 'invalid', proxyUrl: 123 })).toEqual({ mode: 'direct', proxyUrl: '' })
  })

  it('normalizes supported proxy modes', () => {
    expect(normalizeNetworkProxyConfig({ mode: 'system' })).toEqual({ mode: 'system', proxyUrl: '' })
    expect(normalizeNetworkProxyConfig({ mode: 'manual', proxyUrl: '  http://127.0.0.1:7890  ' }))
      .toEqual({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' })
    expect(normalizeNetworkProxyConfig({ mode: 'pac', proxyUrl: '  https://example.com/proxy.pac  ' }))
      .toEqual({ mode: 'pac', proxyUrl: 'https://example.com/proxy.pac' })
  })

  it('accepts HTTP and HTTPS manual proxy URLs with an explicit port', () => {
    expect(validateManualProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(validateManualProxyUrl('https://proxy.example.com:8443/')).toBe('https://proxy.example.com:8443')
  })

  it('rejects unsupported or unsafe manual proxy URLs', () => {
    expect(() => validateManualProxyUrl('socks5://127.0.0.1:1080')).toThrow(/HTTP and HTTPS/)
    expect(() => validateManualProxyUrl('http://proxy.example.com')).toThrow(/host and port/)
    expect(() => validateManualProxyUrl('http://user:secret@proxy.example.com:8080')).toThrow(/credentials/)
    expect(() => validateManualProxyUrl('http://proxy.example.com:8080/path')).toThrow(/path/)
  })

  it('accepts HTTP and HTTPS PAC URLs with paths and query strings', () => {
    expect(validatePacUrl('http://example.com/proxy.pac')).toBe('http://example.com/proxy.pac')
    expect(validatePacUrl('https://example.com:8443/proxy.pac?channel=stable'))
      .toBe('https://example.com:8443/proxy.pac?channel=stable')
  })

  it('rejects unsupported or unsafe PAC URLs', () => {
    expect(() => validatePacUrl('file:///proxy.pac')).toThrow(/HTTP and HTTPS/)
    expect(() => validatePacUrl('https://user:secret@example.com/proxy.pac')).toThrow(/Credentials/)
    expect(() => validatePacUrl('https://example.com/proxy.pac#section')).toThrow(/fragment/)
    expect(() => validatePacUrl('not a url')).toThrow(/valid HTTP or HTTPS/)
  })
})
