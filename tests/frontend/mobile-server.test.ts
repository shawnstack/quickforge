import { describe, expect, it } from 'vitest'
import {
  buildMobileServerAppUrl,
  normalizeTailscaleServerUrl,
} from '../../src/lib/mobile-server'

describe('mobile QuickForge server URL', () => {
  it('normalizes a MagicDNS address and applies the default port', () => {
    expect(normalizeTailscaleServerUrl('devbox.example.ts.net')).toBe('http://devbox.example.ts.net:5176')
  })

  it('accepts a Tailscale IPv4 address', () => {
    expect(normalizeTailscaleServerUrl('https://100.100.20.30:8443')).toBe('https://100.100.20.30:8443')
  })

  it('rejects public and non-Tailscale addresses', () => {
    expect(() => normalizeTailscaleServerUrl('https://example.com')).toThrow(/Tailscale/)
    expect(() => normalizeTailscaleServerUrl('http://192.168.1.10:5176')).toThrow(/Tailscale/)
    expect(() => normalizeTailscaleServerUrl('http://100.128.0.1:5176')).toThrow(/Tailscale/)
  })

  it('rejects credentials and non-root paths', () => {
    expect(() => normalizeTailscaleServerUrl('http://user:pass@100.64.0.1:5176')).toThrow(/用户名或密码/)
    expect(() => normalizeTailscaleServerUrl('http://100.64.0.1:5176/share/test')).toThrow(/根地址/)
  })

  it('marks navigation as a mobile shell session', () => {
    expect(buildMobileServerAppUrl('http://100.64.0.1:5176')).toBe('http://100.64.0.1:5176/?quickforgeMobile=1')
  })
})
