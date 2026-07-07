import { describe, it, expect, vi, afterEach } from 'vitest'
import { compareVersions, checkForUpdates, checkDesktopRelease } from '../../../server/utils/package-update.mjs'

describe('package update utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  describe('checkForUpdates', () => {
    it('marks npm runtime update metadata explicitly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '9.9.9' } }),
      })

      const result = await checkForUpdates(process.cwd())

      expect(result.channel).toBe('npm-runtime')
      expect(result.distribution).toBe('npm')
      expect(result.updateAvailable).toBe(true)
      expect(result.installCommand).toBe(`npm install -g ${result.name}@latest`)
      expect(result.releaseUrl).toBe('https://github.com/shawnstack/quickforge/releases/latest')
    })
  })

  describe('checkDesktopRelease', () => {
    it('checks GitHub Releases without returning an npm install command', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v9.9.9',
          html_url: 'https://github.com/shawnstack/quickforge/releases/tag/v9.9.9',
        }),
      })

      const result = await checkDesktopRelease(process.cwd())

      expect(result.channel).toBe('desktop-app')
      expect(result.distribution).toBe('github-releases')
      expect(result.updateAvailable).toBe(true)
      expect(result.installable).toBe(false)
      expect(result.installCommand).toBeUndefined()
      expect(result.releaseUrl).toBe('https://github.com/shawnstack/quickforge/releases/tag/v9.9.9')
    })
  })
})
