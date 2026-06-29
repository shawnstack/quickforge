import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

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

function getRegistryPackageUrl(packageName) {
  const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/+$/, '')
  return `${registry}/${encodeURIComponent(packageName)}`
}

export async function fetchLatestVersion(packageName) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(getRegistryPackageUrl(packageName), {
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

export async function checkForUpdates(projectRoot) {
  const pkg = await getPackageInfo(projectRoot)
  const latestVersion = await fetchLatestVersion(pkg.name)
  const comparison = compareVersions(pkg.version, latestVersion)
  return {
    ...pkg,
    currentVersion: pkg.version,
    latestVersion,
    updateAvailable: comparison < 0,
    localVersionIsNewer: comparison > 0,
    installCommand: `npm install -g ${pkg.name}@latest`,
  }
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
