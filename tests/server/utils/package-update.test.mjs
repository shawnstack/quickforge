import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  compareVersions,
  checkForUpdates,
  checkDesktopRelease,
  fetchLatestVersion,
  resolveRegistry,
} from '../../../server/utils/package-update.mjs'

const PACKAGE_NAME = '@shawnstack/quickforge'

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-package-update-'))
}

async function writeTempNpmrc(content) {
  const dir = await makeTempDir()
  const npmrcPath = path.join(dir, '.npmrc')
  const text = Array.isArray(content) ? content.join('\n') : content
  await fs.writeFile(npmrcPath, text, 'utf8')
  return npmrcPath
}

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

  describe('resolveRegistry', () => {
    it('defaults to the official registry when nothing is configured', async () => {
      const missingNpmrc = path.join(await makeTempDir(), 'missing.npmrc')

      await expect(resolveRegistry(PACKAGE_NAME, { env: {}, npmrcPath: missingNpmrc })).resolves.toBe(
        'https://registry.npmjs.org/',
      )
    })

    it('prefers environment registry over npmrc', async () => {
      const npmrcPath = await writeTempNpmrc('registry=https://npmrc.example.com/\n')

      await expect(
        resolveRegistry(PACKAGE_NAME, {
          env: { npm_config_registry: 'https://env.example.com/' },
          npmrcPath,
        }),
      ).resolves.toBe('https://env.example.com')

      await expect(
        resolveRegistry(PACKAGE_NAME, {
          env: { NPM_CONFIG_REGISTRY: 'https://upper-env.example.com' },
          npmrcPath,
        }),
      ).resolves.toBe('https://upper-env.example.com')
    })

    it('reads the registry from the user npmrc', async () => {
      const npmrcPath = await writeTempNpmrc(
        ['# mirror config', '; legacy comment', '', 'registry = https://registry.npmmirror.com/', 'save-exact=true'],
      )

      await expect(resolveRegistry(PACKAGE_NAME, { env: {}, npmrcPath })).resolves.toBe(
        'https://registry.npmmirror.com',
      )
    })

    it('prefers the scoped registry key over the generic one', async () => {
      const npmrcPath = await writeTempNpmrc(
        `registry=https://generic.example.com\n${PACKAGE_NAME.split('/')[0]}:registry=https://scoped.example.com\n`,
      )

      await expect(resolveRegistry(PACKAGE_NAME, { env: {}, npmrcPath })).resolves.toBe(
        'https://scoped.example.com',
      )
    })

    it('falls back to the official registry for empty or invalid npmrc values', async () => {
      const emptyValue = await writeTempNpmrc('registry=\n')
      await expect(resolveRegistry(PACKAGE_NAME, { env: {}, npmrcPath: emptyValue })).resolves.toBe(
        'https://registry.npmjs.org/',
      )

      const garbage = await writeTempNpmrc('not-an-ini-line\nplain-text\n')
      await expect(resolveRegistry(PACKAGE_NAME, { env: {}, npmrcPath: garbage })).resolves.toBe(
        'https://registry.npmjs.org/',
      )
    })

    it('respects NPM_CONFIG_USERCONFIG as the npmrc location', async () => {
      const npmrcPath = await writeTempNpmrc('registry=https://userconfig.example.com\n')

      await expect(resolveRegistry(PACKAGE_NAME, { env: { NPM_CONFIG_USERCONFIG: npmrcPath } })).resolves.toBe(
        'https://userconfig.example.com',
      )
    })
  })

  describe('fetchLatestVersion', () => {
    it('requests the registry resolved from npm configuration', async () => {
      const previous = process.env.npm_config_registry
      process.env.npm_config_registry = 'https://mirror.example.com'
      try {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({ 'dist-tags': { latest: '9.9.9' } }),
        })

        await expect(fetchLatestVersion(PACKAGE_NAME)).resolves.toBe('9.9.9')
        expect(fetchMock.mock.calls[0][0]).toBe(`https://mirror.example.com/${encodeURIComponent(PACKAGE_NAME)}`)
      } finally {
        if (previous === undefined) delete process.env.npm_config_registry
        else process.env.npm_config_registry = previous
      }
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
