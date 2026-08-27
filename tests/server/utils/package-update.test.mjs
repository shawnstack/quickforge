import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  compareVersions,
  checkForUpdates,
  checkDesktopRelease,
  fetchLatestVersion,
  getUpdateCheckState,
  resolveRegistry,
} from '../../../server/utils/package-update.mjs'

const PACKAGE_NAME = '@shawnstack/quickforge'

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-package-update-'))
}

async function makeProjectDir(version = '1.0.0') {
  const dir = await makeTempDir()
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version }), 'utf8')
  return dir
}

// 手动控制的 fetch mock：每个请求挂起直到 resolve/reject，便于断言快照接口不等网络。
function deferredFetchMock() {
  const pending = []
  const impl = vi.fn(() => new Promise((resolve, reject) => {
    pending.push({ resolve, reject })
  }))
  return {
    impl,
    resolveLast(value) {
      pending.shift().resolve(value)
    },
    rejectLast(error) {
      pending.shift().reject(error)
    },
  }
}

// 后台检查在读取 package.json、解析 registry 之后才发起 fetch，需等待其就绪。
async function waitForFetchCall(impl, count = 1) {
  const started = Date.now()
  while (impl.mock.calls.length < count && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (impl.mock.calls.length < count) throw new Error(`fetch was not called ${count} time(s)`)
}

async function untilUpdateStatus(projectRoot, status) {
  const started = Date.now()
  while (Date.now() - started < 2000) {
    if (getUpdateCheckState(projectRoot).status === status) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`update check state did not become '${status}'`)
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

    it('still rejects for the explicit update flow when the registry fails', async () => {
      const projectRoot = await makeProjectDir()
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('request timeout'))

      await expect(checkForUpdates(projectRoot)).rejects.toThrow('request timeout')
      expect(getUpdateCheckState(projectRoot)).toMatchObject({ status: 'error', checkError: 'request timeout' })
    })
  })

  describe('getUpdateCheckState', () => {
    it('returns a checking snapshot immediately without waiting for the registry', async () => {
      const projectRoot = await makeProjectDir('1.0.0')
      const { impl, resolveLast } = deferredFetchMock()
      vi.spyOn(globalThis, 'fetch').mockImplementation(impl)

      const snapshot = getUpdateCheckState(projectRoot)

      // 快照同步返回，不等 registry（此刻请求甚至可能尚未发起）
      expect(snapshot.status).toBe('checking')

      await waitForFetchCall(impl)
      // fetch 仍挂起时再次获取快照，依然是立即返回 checking
      expect(getUpdateCheckState(projectRoot).status).toBe('checking')

      resolveLast({ ok: true, json: async () => ({ 'dist-tags': { latest: '2.0.0' } }) })
      await untilUpdateStatus(projectRoot, 'ok')

      const done = getUpdateCheckState(projectRoot)
      expect(done.status).toBe('ok')
      expect(done.currentVersion).toBe('1.0.0')
      expect(done.latestVersion).toBe('2.0.0')
      expect(done.updateAvailable).toBe(true)
    })

    it('reuses a fresh result without a second registry request', async () => {
      const projectRoot = await makeProjectDir()
      const { impl, resolveLast } = deferredFetchMock()
      vi.spyOn(globalThis, 'fetch').mockImplementation(impl)

      getUpdateCheckState(projectRoot)
      await waitForFetchCall(impl)
      resolveLast({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.1.0' } }) })
      await untilUpdateStatus(projectRoot, 'ok')

      const cached = getUpdateCheckState(projectRoot)

      expect(cached.status).toBe('ok')
      expect(cached.latestVersion).toBe('1.1.0')
      expect(impl).toHaveBeenCalledTimes(1)
    })

    it('reports registry failures as an error snapshot instead of throwing', async () => {
      const projectRoot = await makeProjectDir()
      const { impl, rejectLast } = deferredFetchMock()
      vi.spyOn(globalThis, 'fetch').mockImplementation(impl)

      getUpdateCheckState(projectRoot)
      await waitForFetchCall(impl)
      rejectLast(new Error('registry returned HTTP 404'))
      await untilUpdateStatus(projectRoot, 'error')

      const failed = getUpdateCheckState(projectRoot)

      expect(failed.status).toBe('error')
      expect(failed.checkError).toBe('registry returned HTTP 404')
      // 失败退避期内不自动重试
      expect(impl).toHaveBeenCalledTimes(1)
    })

    it('skips cache and error backoff when forced', async () => {
      const projectRoot = await makeProjectDir('1.0.0')
      const { impl, resolveLast } = deferredFetchMock()
      vi.spyOn(globalThis, 'fetch').mockImplementation(impl)

      getUpdateCheckState(projectRoot)
      await waitForFetchCall(impl)
      resolveLast({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.1.0' } }) })
      await untilUpdateStatus(projectRoot, 'ok')

      const forced = getUpdateCheckState(projectRoot, { force: true })

      expect(forced.status).toBe('checking')
      expect(forced.latestVersion).toBe('1.1.0') // 上次结果随快照保留
      await waitForFetchCall(impl, 2)
      expect(impl).toHaveBeenCalledTimes(2)

      resolveLast({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.2.0' } }) })
      await untilUpdateStatus(projectRoot, 'ok')
      expect(getUpdateCheckState(projectRoot).latestVersion).toBe('1.2.0')
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
