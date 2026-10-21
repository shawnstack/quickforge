import { describe, it, expect, vi } from 'vitest'
import { isPrivateIpv4, isLoopbackAddress, getLanIpv4Addresses, getLanUrls } from '../../../server/utils/network.mjs'

describe('network', () => {
  describe('isPrivateIpv4', () => {
    it('recognizes 10.0.0.0/8 as private', () => {
      expect(isPrivateIpv4('10.0.0.1')).toBe(true)
      expect(isPrivateIpv4('10.255.255.255')).toBe(true)
    })

    it('recognizes 172.16.0.0/12 as private', () => {
      expect(isPrivateIpv4('172.16.0.1')).toBe(true)
      expect(isPrivateIpv4('172.31.255.255')).toBe(true)
    })

    it('recognizes 192.168.0.0/16 as private', () => {
      expect(isPrivateIpv4('192.168.0.1')).toBe(true)
      expect(isPrivateIpv4('192.168.1.100')).toBe(true)
    })

    it('rejects public IPs', () => {
      expect(isPrivateIpv4('8.8.8.8')).toBe(false)
      expect(isPrivateIpv4('1.2.3.4')).toBe(false)
      expect(isPrivateIpv4('172.15.0.1')).toBe(false)
      expect(isPrivateIpv4('172.32.0.1')).toBe(false)
    })

    it('rejects non-IPv4 inputs', () => {
      expect(isPrivateIpv4('')).toBe(false)
      expect(isPrivateIpv4('not-an-ip')).toBe(false)
      expect(isPrivateIpv4('::1')).toBe(false)
      expect(isPrivateIpv4(null)).toBe(false)
    })

    it('rejects IPs with invalid octets', () => {
      expect(isPrivateIpv4('10.999.0.1')).toBe(false)
      expect(isPrivateIpv4('10.0.0.256')).toBe(false)
    })
  })

  describe('isLoopbackAddress', () => {
    it('recognizes 127.0.0.1 as loopback', () => {
      expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    })

    it('recognizes ::1 as loopback', () => {
      expect(isLoopbackAddress('::1')).toBe(true)
    })

    it('recognizes localhost as loopback', () => {
      expect(isLoopbackAddress('localhost')).toBe(true)
    })

    it('strips ::ffff: prefix for IPv4-mapped IPv6', () => {
      expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    })

    it('rejects non-loopback addresses', () => {
      expect(isLoopbackAddress('192.168.1.1')).toBe(false)
      expect(isLoopbackAddress('10.0.0.1')).toBe(false)
    })

    it('handles empty / null input', () => {
      expect(isLoopbackAddress('')).toBe(false)
      expect(isLoopbackAddress(null)).toBe(false)
    })
  })

  describe('getLanIpv4Addresses', () => {
    it('returns an array', () => {
      const result = getLanIpv4Addresses()
      expect(Array.isArray(result)).toBe(true)
    })

    it('includes only private IPv4 addresses', () => {
      const result = getLanIpv4Addresses()
      for (const addr of result) {
        expect(isPrivateIpv4(addr)).toBe(true)
      }
    })
  })

  describe('getLanUrls', () => {
    it('returns URLs with the specified port', () => {
      const urls = getLanUrls(3000)
      for (const url of urls) {
        expect(url).toContain(':3000')
        expect(url).toMatch(/^http:\/\//)
      }
    })

    it('supports custom protocol', () => {
      const urls = getLanUrls(3000, 'https')
      for (const url of urls) {
        expect(url).toMatch(/^https:\/\//)
      }
    })

    it('omits port when port is 0', () => {
      const urls = getLanUrls(0)
      for (const url of urls) {
        expect(url).not.toMatch(/:0/)
      }
    })
  })
})
