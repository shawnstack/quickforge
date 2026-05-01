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

export function getDataDir() {
  if (process.env.QUICKFORGE_DATA_DIR) return path.resolve(process.env.QUICKFORGE_DATA_DIR)
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

