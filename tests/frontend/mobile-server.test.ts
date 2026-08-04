import { describe, expect, it, vi } from 'vitest'
import {
  buildMobileServerAppUrl,
  normalizeTailscaleServerUrl,
  readMobileServerAliasFromUrl,
  readMobileServerSettings,
  saveMobileServerSettings,
} from '../../src/lib/mobile-server'

const legacyStorageKey = 'quickforge:mobile-server-url'
const settingsStorageKey = 'quickforge:mobile-server-settings:v1'

function createStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

describe('mobile QuickForge server URL', () => {
  it('normalizes a MagicDNS address and applies the default port', () => {
    expect(normalizeTailscaleServerUrl('devbox.example.ts.net')).toBe('http://devbox.example.ts.net:5176')
  })

  it('accepts a Tailscale IPv4 address', () => {
    expect(normalizeTailscaleServerUrl('https://100.100.20.30:8443')).toBe('https://100.100.20.30:8443')
  })

  it('rejects unsupported addresses', () => {
    expect(() => normalizeTailscaleServerUrl('https://example.com')).toThrow(/不受支持/)
    expect(() => normalizeTailscaleServerUrl('http://192.168.1.10:5176')).toThrow(/不受支持/)
    expect(() => normalizeTailscaleServerUrl('http://100.128.0.1:5176')).toThrow(/不受支持/)
  })

  it('rejects credentials and non-root paths', () => {
    expect(() => normalizeTailscaleServerUrl('http://user:pass@100.64.0.1:5176')).toThrow(/用户名或密码/)
    expect(() => normalizeTailscaleServerUrl('http://100.64.0.1:5176/share/test')).toThrow(/根地址/)
  })

  it('marks navigation as a mobile shell session', () => {
    expect(buildMobileServerAppUrl('http://100.64.0.1:5176')).toBe('http://100.64.0.1:5176/?quickforgeMobile=1')
  })

  it('carries the server alias in the shell URL when one is saved', () => {
    vi.stubGlobal('window', {
      localStorage: createStorage({
        [settingsStorageKey]: JSON.stringify({
          urls: ['http://100.64.0.1:5176'],
          lastUsedUrl: 'http://100.64.0.1:5176',
          aliases: { 'http://100.64.0.1:5176': '公司开发机' },
        }),
      }),
    })
    try {
      expect(buildMobileServerAppUrl('http://100.64.0.1:5176'))
        .toBe('http://100.64.0.1:5176/?quickforgeMobile=1&quickforgeAlias=%E5%85%AC%E5%8F%B8%E5%BC%80%E5%8F%91%E6%9C%BA')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('omits the alias when the server has none', () => {
    vi.stubGlobal('window', { localStorage: createStorage() })
    try {
      expect(buildMobileServerAppUrl('http://100.64.0.1:5176')).toBe('http://100.64.0.1:5176/?quickforgeMobile=1')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads the server alias from the shell URL', () => {
    expect(readMobileServerAliasFromUrl('?quickforgeMobile=1&quickforgeAlias=%E5%85%AC%E5%8F%B8%E5%BC%80%E5%8F%91%E6%9C%BA')).toBe('公司开发机')
    expect(readMobileServerAliasFromUrl('?quickforgeMobile=1')).toBeUndefined()
    expect(readMobileServerAliasFromUrl('?quickforgeMobile=1&quickforgeAlias=%20%20')).toBeUndefined()
  })
})

describe('mobile QuickForge server settings', () => {
  it('migrates the legacy single-server value', () => {
    const storage = createStorage({ [legacyStorageKey]: 'devbox.example.ts.net' })

    expect(readMobileServerSettings(storage)).toEqual({
      urls: ['http://devbox.example.ts.net:5176'],
      lastUsedUrl: 'http://devbox.example.ts.net:5176',
      aliases: {},
    })
  })

  it('normalizes and deduplicates saved server addresses', () => {
    const storage = createStorage({
      [settingsStorageKey]: JSON.stringify({
        urls: ['devbox.example.ts.net', 'http://devbox.example.ts.net:5176', 'https://100.100.20.30:8443'],
        lastUsedUrl: 'https://100.100.20.30:8443',
      }),
    })

    expect(readMobileServerSettings(storage)).toEqual({
      urls: ['http://devbox.example.ts.net:5176', 'https://100.100.20.30:8443'],
      lastUsedUrl: 'https://100.100.20.30:8443',
      aliases: {},
    })
  })

  it('falls back to the first address when the last-used address is unavailable', () => {
    const storage = createStorage({
      [settingsStorageKey]: JSON.stringify({
        urls: ['http://100.64.0.1:5176', 'http://100.64.0.2:5176'],
        lastUsedUrl: 'http://100.64.0.3:5176',
      }),
    })

    expect(readMobileServerSettings(storage).lastUsedUrl).toBe('http://100.64.0.1:5176')
  })

  it('falls back to the legacy value when the settings data is malformed', () => {
    const storage = createStorage({
      [settingsStorageKey]: '{',
      [legacyStorageKey]: 'http://100.64.0.1:5176',
    })

    expect(readMobileServerSettings(storage)).toEqual({
      urls: ['http://100.64.0.1:5176'],
      lastUsedUrl: 'http://100.64.0.1:5176',
      aliases: {},
    })
  })

  it('saves multiple addresses and mirrors the last-used address for compatibility', () => {
    const storage = createStorage()

    saveMobileServerSettings({
      urls: ['devbox.example.ts.net', 'https://100.100.20.30:8443'],
      lastUsedUrl: 'https://100.100.20.30:8443',
    }, storage)

    expect(JSON.parse(storage.getItem(settingsStorageKey) || '{}')).toEqual({
      urls: ['http://devbox.example.ts.net:5176', 'https://100.100.20.30:8443'],
      lastUsedUrl: 'https://100.100.20.30:8443',
      aliases: {},
    })
    expect(storage.getItem(legacyStorageKey)).toBe('https://100.100.20.30:8443')
  })

  it('clears the legacy value when the server list becomes empty', () => {
    const storage = createStorage({ [legacyStorageKey]: 'http://100.64.0.1:5176' })

    saveMobileServerSettings({ urls: [], lastUsedUrl: '' }, storage)

    expect(readMobileServerSettings(storage)).toEqual({ urls: [], lastUsedUrl: '', aliases: {} })
    expect(storage.getItem(legacyStorageKey)).toBeNull()
  })

  it('persists server aliases and reads them back', () => {
    const storage = createStorage()

    saveMobileServerSettings({
      urls: ['http://100.64.0.1:5176', 'http://100.64.0.2:5176'],
      lastUsedUrl: 'http://100.64.0.1:5176',
      aliases: { 'http://100.64.0.1:5176': '公司开发机' },
    }, storage)

    expect(readMobileServerSettings(storage)).toEqual({
      urls: ['http://100.64.0.1:5176', 'http://100.64.0.2:5176'],
      lastUsedUrl: 'http://100.64.0.1:5176',
      aliases: { 'http://100.64.0.1:5176': '公司开发机' },
    })
  })

  it('normalizes alias keys and drops invalid or empty aliases', () => {
    const storage = createStorage({
      [settingsStorageKey]: JSON.stringify({
        urls: ['http://100.64.0.1:5176', 'http://100.64.0.2:5176'],
        lastUsedUrl: 'http://100.64.0.1:5176',
        aliases: {
          '100.64.0.1': '开发机',
          'http://100.64.0.2:5176': '  ', // whitespace-only alias
          'http://100.64.0.3:5176': '未知服务器', // address not in the list
          'not-a-url': '乱写',
        },
      }),
    })

    expect(readMobileServerSettings(storage).aliases).toEqual({
      'http://100.64.0.1:5176': '开发机',
    })
  })

  it('removes aliases for servers that are no longer in the list on save', () => {
    const storage = createStorage()

    saveMobileServerSettings({
      urls: ['http://100.64.0.1:5176'],
      lastUsedUrl: 'http://100.64.0.1:5176',
      aliases: {
        'http://100.64.0.1:5176': '开发机',
        'http://100.64.0.2:5176': '旧服务器',
      },
    }, storage)

    expect(readMobileServerSettings(storage).aliases).toEqual({
      'http://100.64.0.1:5176': '开发机',
    })
  })
})
