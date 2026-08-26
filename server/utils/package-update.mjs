import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const QUICKFORGE_RELEASES_URL = 'https://github.com/shawnstack/quickforge/releases/latest'
const QUICKFORGE_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/shawnstack/quickforge/releases/latest'
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org/'

// 外部更新检查（npm registry / GitHub Releases）是应用中最慢的调用。
// 增加进程内冷却缓存：并发调用共享同一 Promise，TTL 内重复调用复用结果；
// 失败不缓存，下次调用立即重试。
const UPDATE_CHECK_COOLDOWN_MS = 5 * 60 * 1000
const updateCheckCooldowns = new Map() // key -> { at, promise }

function cooldownLoad(key, loader) {
  const now = Date.now()
  const entry = updateCheckCooldowns.get(key)
  if (entry && now - entry.at < UPDATE_CHECK_COOLDOWN_MS) return entry.promise

  const promise = Promise.resolve().then(loader)
  updateCheckCooldowns.set(key, { at: now, promise })
  promise.catch(() => {
    if (updateCheckCooldowns.get(key)?.promise === promise) updateCheckCooldowns.delete(key)
  })
  return promise
}

function normalizeRepositoryUrl(value) {
  if (!value || typeof value !== 'string') return ''
  return value
    .replace(/^git\+/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/\.git$/i, '')
}

export async function getPackageInfo(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json')
  try {
    const text = await fs.readFile(packageJsonPath, 'utf8')
    const pkg = JSON.parse(text)
    const repositoryUrl = normalizeRepositoryUrl(
      typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url,
    )

    return {
      name: pkg.name || 'quickforge',
      version: pkg.version || '0.0.0',
      repositoryUrl,
      homepage: pkg.homepage || repositoryUrl,
      bugsUrl: typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url || '',
    }
  } catch (error) {
    throw new Error(`Unable to read package metadata: ${error.message}`, { cause: error })
  }
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '')
}

function parseVersion(version) {
  const [main, prerelease = ''] = normalizeVersion(version).split('-', 2)
  const numbers = main.split('.').slice(0, 3).map((part) => {
    const value = Number(part)
    return Number.isFinite(value) ? value : 0
  })

  while (numbers.length < 3) numbers.push(0)
  return { numbers, prerelease }
}

function comparePrerelease(left, right) {
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1

  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let i = 0; i < maxLength; i += 1) {
    const leftPart = leftParts[i]
    const rightPart = rightParts[i]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null

    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1

    return leftPart > rightPart ? 1 : -1
  }

  return 0
}

export function compareVersions(left, right) {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)

  for (let i = 0; i < 3; i += 1) {
    if (parsedLeft.numbers[i] > parsedRight.numbers[i]) return 1
    if (parsedLeft.numbers[i] < parsedRight.numbers[i]) return -1
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

// registry 解析遵循 npm 配置的优先级子集：环境变量 > 用户级 .npmrc > 官方源。
// 项目级/全局 .npmrc 不参与（更新检查面向全局安装场景，用户级镜像配置是主要诉求）。
// 只读取 registry 相关键，不读取也不发送 .npmrc 中的任何凭据。
function normalizeRegistryUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function registryFromEnv(env) {
  return normalizeRegistryUrl(env.npm_config_registry || env.NPM_CONFIG_REGISTRY)
}

function userNpmrcPath(env) {
  const configured = String(env.NPM_CONFIG_USERCONFIG || env.npm_config_userconfig || '').trim()
  if (configured) return configured
  return path.join(os.homedir(), '.npmrc')
}

function parseNpmrcKeys(text) {
  const keys = new Map()
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["'](.*)["']$/, '$1')
    if (key) keys.set(key, value)
  }
  return keys
}

export async function resolveRegistry(packageName, options = {}) {
  const env = options.env || process.env
  const fromEnv = registryFromEnv(env)
  if (fromEnv) return fromEnv

  try {
    const keys = parseNpmrcKeys(await fs.readFile(options.npmrcPath || userNpmrcPath(env), 'utf8'))
    const scopeSeparator = packageName.indexOf('/')
    const scope = packageName.startsWith('@') && scopeSeparator > 0 ? packageName.slice(0, scopeSeparator) : ''
    const fromNpmrc = normalizeRegistryUrl((scope && keys.get(`${scope}:registry`)) || keys.get('registry'))
    if (fromNpmrc) return fromNpmrc
  } catch {
    // .npmrc 不存在或不可读时回退默认官方源
  }
  return DEFAULT_REGISTRY_URL
}

async function getRegistryPackageUrl(packageName) {
  const registry = await resolveRegistry(packageName)
  return `${registry}/${encodeURIComponent(packageName)}`
}

export async function fetchLatestVersion(packageName) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(await getRegistryPackageUrl(packageName), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)

    const metadata = await response.json()
    const latest = metadata?.['dist-tags']?.latest
    if (!latest || typeof latest !== 'string') throw new Error('latest version not found in registry response')
    return latest
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('request timeout', { cause: error })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function checkForUpdates(projectRoot) {
  return cooldownLoad(`npm:${projectRoot}`, async () => {
    const pkg = await getPackageInfo(projectRoot)
    const latestVersion = await fetchLatestVersion(pkg.name)
    const comparison = compareVersions(pkg.version, latestVersion)
    return {
      ...pkg,
      channel: 'npm-runtime',
      distribution: 'npm',
      currentVersion: pkg.version,
      latestVersion,
      updateAvailable: comparison < 0,
      localVersionIsNewer: comparison > 0,
      installCommand: `npm install -g ${pkg.name}@latest`,
      releaseUrl: QUICKFORGE_RELEASES_URL,
    }
  })
}

export function checkDesktopRelease(projectRoot) {
  return cooldownLoad(`desktop:${projectRoot}`, async () => {
    const pkg = await getPackageInfo(projectRoot)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch(QUICKFORGE_LATEST_RELEASE_API_URL, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `${pkg.name || 'quickforge'}-desktop-update-check`,
        },
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`GitHub releases returned HTTP ${response.status}`)

      const release = await response.json()
      const latestVersion = release?.tag_name || release?.name
      if (!latestVersion || typeof latestVersion !== 'string') throw new Error('latest release version not found in GitHub response')

      const comparison = compareVersions(pkg.version, latestVersion)
      return {
        ...pkg,
        channel: 'desktop-app',
        distribution: 'github-releases',
        currentVersion: pkg.version,
        latestVersion,
        updateAvailable: comparison < 0,
        localVersionIsNewer: comparison > 0,
        releaseUrl: release?.html_url || QUICKFORGE_RELEASES_URL,
        installable: false,
      }
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('request timeout', { cause: error })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  })
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

export async function installLatestVersion(packageName, options = {}) {
  const target = `${packageName}@latest`
  const child = spawn(getNpmCommand(), ['install', '-g', target], {
    cwd: options.cwd,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`npm install exited with code ${code}`))
    })
  })
}
