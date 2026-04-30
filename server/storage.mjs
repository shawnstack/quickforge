import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const stores = new Set([
  'settings',
  'provider-keys',
  'custom-providers',
  'sessions',
  'sessions-metadata',
])

function platformDataDir(appName) {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName)
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName)
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName)
}

export function getDataDir() {
  if (process.env.QUICKFORGE_DATA_DIR) return path.resolve(process.env.QUICKFORGE_DATA_DIR)
  if (process.env.FASTCODE_DATA_DIR) return path.resolve(process.env.FASTCODE_DATA_DIR)
  return path.join(os.homedir(), '.quickforge')
}

export const dataDir = getDataDir()
export const storageDir = path.join(dataDir, 'storage')

export function storeFile(storeName) {
  return path.join(storageDir, `${storeName}.json`)
}

export function projectConfigFile() {
  return path.join(storageDir, 'project.json')
}

const writeQueues = new Map()

export async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true })
  await Promise.all(
    [...stores].map(async (store) => {
      const file = storeFile(store)
      if (!existsSync(file)) await fs.writeFile(file, '{}\n', 'utf8')
    }),
  )
}

export async function readStore(storeName) {
  assertStore(storeName)
  await ensureStorage()
  const file = storeFile(storeName)
  try {
    const text = await fs.readFile(file, 'utf8')
    return text.trim() ? JSON.parse(text) : {}
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export async function writeStore(storeName, data) {
  assertStore(storeName)
  const previous = writeQueues.get(storeName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await ensureStorage()
      const file = storeFile(storeName)
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, file)
    })
  writeQueues.set(storeName, next)
  return next
}

function assertStore(storeName) {
  if (!stores.has(storeName)) {
    const error = new Error(`Unknown storage store: ${storeName}`)
    error.statusCode = 404
    throw error
  }
}

export function getComparable(value, key) {
  if (!value || typeof value !== 'object') return undefined
  return key.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return current[part]
  }, value)
}

export async function directoryExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export async function readJsonObject(file) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const parsed = text.trim() ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function mergeJsonObjectFile(sourceFile, targetFile) {
  const source = await readJsonObject(sourceFile)
  if (!source) return false

  const target = (await readJsonObject(targetFile)) ?? {}
  let changed = false
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) continue
    target[key] = value
    changed = true
  }

  if (!changed) return false

  await fs.mkdir(path.dirname(targetFile), { recursive: true })
  const tmp = `${targetFile}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(target, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, targetFile)
  return true
}

export async function copyMissingRecursive(source, target) {
  const stat = await fs.stat(source).catch(() => null)
  if (!stat) return false

  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true })
    let copied = false
    const entries = await fs.readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      copied = (await copyMissingRecursive(path.join(source, entry.name), path.join(target, entry.name))) || copied
    }
    return copied
  }

  if (!stat.isFile() || (await directoryExists(target))) return false

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  return true
}

export function uniquePaths(paths) {
  const seen = new Set()
  return paths.filter((item) => {
    const resolved = path.resolve(item)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function migrateLegacyDataDir(sourceDir) {
  const resolvedSource = path.resolve(sourceDir)
  const resolvedTarget = path.resolve(dataDir)
  const sourceKey = process.platform === 'win32' ? resolvedSource.toLowerCase() : resolvedSource
  const targetKey = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget
  if (sourceKey === targetKey) return false

  const sourceStorageDir = path.join(resolvedSource, 'storage')
  if (!(await directoryExists(sourceStorageDir))) return false

  await fs.mkdir(storageDir, { recursive: true })

  let migrated = false
  for (const store of stores) {
    const sourceFile = path.join(sourceStorageDir, `${store}.json`)
    const targetFile = storeFile(store)
    if (!(await directoryExists(sourceFile))) continue
    if (await directoryExists(targetFile)) {
      migrated = (await mergeJsonObjectFile(sourceFile, targetFile)) || migrated
    } else {
      await fs.copyFile(sourceFile, targetFile)
      migrated = true
    }
  }

  const sourceProjectFile = path.join(sourceStorageDir, 'project.json')
  if ((await directoryExists(sourceProjectFile)) && !(await directoryExists(projectConfigFile()))) {
    await fs.copyFile(sourceProjectFile, projectConfigFile())
    migrated = true
  }

  migrated = (await copyMissingRecursive(sourceStorageDir, storageDir)) || migrated
  if (migrated) console.log(`Migrated legacy QuickForge data from ${resolvedSource} to ${resolvedTarget}`)
  return migrated
}

export async function migrateLegacyDataDirs() {
  if (process.env.QUICKFORGE_DATA_DIR || process.env.FASTCODE_DATA_DIR) return

  const legacyDirs = uniquePaths([
    platformDataDir('QuickForge'),
    platformDataDir('FastCode'),
    path.join(os.homedir(), '.fastcode'),
  ])

  for (const dir of legacyDirs) {
    await migrateLegacyDataDir(dir)
  }
}
