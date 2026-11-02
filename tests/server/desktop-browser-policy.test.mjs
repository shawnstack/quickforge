import { describe, expect, it } from 'vitest'
import { normalizeNavigableUrl } from '../../desktop/browser/policy.mjs'

describe('desktop browser navigation policy', () => {
  it('accepts public http(s) urls and defaults bare hosts to https', () => {
    expect(normalizeNavigableUrl('https://example.com/path?q=1')).toMatchObject({
      ok: true,
      url: 'https://example.com/path?q=1',
      origin: 'https://example.com',
      hostname: 'example.com',
    })
    expect(normalizeNavigableUrl('example.com')).toMatchObject({ ok: true, url: 'https://example.com/' })
    expect(normalizeNavigableUrl('  http://docs.example.org/a  ')).toMatchObject({ ok: true, origin: 'http://docs.example.org' })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['file:///C:/Windows/win.ini', 'protocol'],
    ['javascript:alert(1)', 'protocol'],
    ['ftp://example.com', 'protocol'],
    ['chrome://settings', 'protocol'],
    ['not a url at all', 'invalid'],
  ])('rejects %s (%s)', (input, reason) => {
    const result = normalizeNavigableUrl(input)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe(reason)
    expect(typeof result.message).toBe('string')
  })

  it.each([
    'http://localhost:5176',
    'http://LOCALHOST/',
    'http://app.localhost',
    'http://127.0.0.1:32176/api/health',
    'http://127.1.2.3',
    'http://10.0.0.5',
    'http://172.16.4.4',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://[::1]:5176',
    'http://[fe80::1]',
    'http://[fd00::1]',
    'http://[::ffff:127.0.0.1]',
  ])('blocks local/private target %s', (input) => {
    const result = normalizeNavigableUrl(input)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blocked-host')
    expect(result.message).toContain('Blocked by the desktop browser policy')
  })

  it('keeps public IPv4 addresses reachable', () => {
    expect(normalizeNavigableUrl('http://8.8.8.8/')).toMatchObject({ ok: true, hostname: '8.8.8.8' })
    expect(normalizeNavigableUrl('http://172.32.0.1/')).toMatchObject({ ok: true, hostname: '172.32.0.1' })
  })
})
