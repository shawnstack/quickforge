import { describe, it, expect } from 'vitest'
import { compareVersions } from '../../../server/utils/package-update.mjs'

describe('package update utilities', () => {
  describe('compareVersions', () => {
    it('compares semantic version numbers', () => {
      expect(compareVersions('1.4.1', '1.4.2')).toBeLessThan(0)
      expect(compareVersions('1.5.0', '1.4.9')).toBeGreaterThan(0)
      expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    })

    it('handles v prefixes and prerelease ordering', () => {
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
      expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBeGreaterThan(0)
    })
  })
})
