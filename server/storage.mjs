import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// --- Log retention ---
const LOG_RETENTION_DAYS = 7
const LOG_MAX_TOTAL_SIZE_MB = 100

export async function cleanOldLogs() {
  try {
    await fs.mkdir(logsDir, { recursive: true })
    const files = await fs.readdir(logsDir)
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    let totalSize = 0
    const fileStats = []

    for (const name of files) {
      if (!name.startsWith('server-') || !name.endsWith('.log')) continue
      const filePath = path.join(logsDir, name)
      try {
        const stat = await fs.stat(filePath)
        totalSize += stat.size
        fileStats.push({ name, path: filePath, mtime: stat.mtimeMs, size: stat.size })
      } catch { /* file may have been removed */ }
    }

    // Remove files older than retention
    for (const f of fileStats) {
      if (f.mtime < cutoff) {
        try { await fs.unlink(f.path); totalSize -= f.size } catch { /* ignore */ }
      }
    }

    // If still over size limit, remove oldest first
    if (totalSize > LOG_MAX_TOTAL_SIZE_MB * 1024 * 1024) {
      const remaining = fileStats.filter((f) => f.mtime >= cutoff).sort((a, b) => a.mtime - b.mtime)
      for (const f of remaining) {
        if (totalSize <= LOG_MAX_TOTAL_SIZE_MB * 1024 * 1024) break
        try { await fs.unlink(f.path); totalSize -= f.size } catch { /* ignore */ }
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

export const stores = new Set([
  'settings',
  'provider-keys',
  'custom-providers',
  'sessions',
  'sessions-metadata',
  'scheduled-tasks',
  'custom-agents',
])

// --- In-memory session bucket index ---
// Avoids O(n) directory scanning in findSessionBucket() by caching
// sessionId → { scope, projectId } lookups.  Populated lazily on first
// lookup and kept up-to-date by write/delete paths.
/** @type {Map<string, { scope: string, projectId?: string }>} */
const sessionBucketIndex = new Map()
let bucketIndexBuilt = false

// Monotonic in-process revisions for cache invalidation in route-level indexes.
const storeRevisions = new Map()

function bumpStoreRevision(storeName) {
  storeRevisions.set(storeName, (storeRevisions.get(storeName) || 0) + 1)
}

export function getStoreRevision(storeName) {
  return storeRevisions.get(storeName) || 0
}

const configStores = new Set(['settings', 'provider-keys', 'custom-providers'])
const sessionStores = new Set(['sessions', 'sessions-metadata'])

const configStoreSections = {
  settings: ['app', 'settings'],
  'provider-keys': ['credentials', 'providerKeys'],
  'custom-providers': ['providers', 'customProviders'],
}

export function getDataDir() {
  if (process.env.QUICKFORGE_DATA_DIR) return path.resolve(process.env.QUICKFORGE_DATA_DIR)
  return path.join(os.homedir(), '.quickforge')
}

export const dataDir = getDataDir()
export const configDir = path.join(dataDir, 'config')
export const storageDir = path.join(dataDir, 'storage')
export const cacheDir = path.join(dataDir, 'cache')
export const logsDir = path.join(dataDir, 'logs')

const quickForgeConfigFile = path.join(configDir, 'config.json')
const configMigrationMarkerFile = path.join(configDir, '.layout-migrated')
const legacyStorageMigrationMarkerFile = path.join(storageDir, '.layout-migrated')

export function storeFile(storeName) {
  assertStore(storeName)
  if (configStores.has(storeName)) return quickForgeConfigFile
  return sessionStoreFile(storeName, { scope: 'global' })
}

export function configFile() {
  return quickForgeConfigFile
}

function legacyFlatStoreFile(storeName) {
  return path.join(storageDir, `${storeName}.json`)
}

function legacyNestedStoreFile(storeName) {
  const paths = {
    settings: ['config', 'settings.json'],
    'provider-keys': ['credentials', 'provider-keys.json'],
    'custom-providers': ['providers', 'custom-providers.json'],
  }
  return path.join(storageDir, ...paths[storeName])
}

function legacyFlatProjectConfigFile() {
  return path.join(storageDir, 'project.json')
}

function legacyNestedProjectConfigFile() {
  return path.join(storageDir, 'projects', 'project.json')
}

function defaultProjectConfig() {
  return {
    activeProjectId: null,
    globalSkills: [],
    projects: [],
  }
}

function defaultConfig() {
  return {
    layoutVersion: 1,
    updatedAt: new Date().toISOString(),
    app: {
      settings: {},
    },
    providers: {
      customProviders: {},
    },
    credentials: {
      providerKeys: {},
    },
    projects: defaultProjectConfig(),
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function normalizeProjectConfig(value) {
  const base = defaultProjectConfig()
  if (!value || typeof value !== 'object') return base
  const projects = Array.isArray(value.projects)
    ? value.projects.map((project) => ({
      ...project,
      skills: normalizeStringArray(project?.skills),
    }))
    : base.projects
  return {
    activeProjectId: typeof value.activeProjectId === 'string' ? value.activeProjectId : base.activeProjectId,
    globalSkills: normalizeStringArray(value.globalSkills),
    projects,
  }
}

function normalizeConfig(value) {
  const base = defaultConfig()
  const input = value && typeof value === 'object' ? value : {}

  return {
    ...input,
    layoutVersion: Number(input.layoutVersion || base.layoutVersion),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    app: {
      ...(input.app && typeof input.app === 'object' ? input.app : {}),
      settings:
        input.app?.settings && typeof input.app.settings === 'object'
          ? input.app.settings
          : base.app.settings,
    },
    providers: {
      ...(input.providers && typeof input.providers === 'object' ? input.providers : {}),
      customProviders:
        input.providers?.customProviders && typeof input.providers.customProviders === 'object'
          ? input.providers.customProviders
          : base.providers.customProviders,
    },
    credentials: {
      ...(input.credentials && typeof input.credentials === 'object' ? input.credentials : {}),
      providerKeys:
        input.credentials?.providerKeys && typeof input.credentials.providerKeys === 'object'
          ? input.credentials.providerKeys
          : base.credentials.providerKeys,
    },
    projects: normalizeProjectConfig(input.projects),
  }
}

function configSection(config, storeName) {
  const [section, key] = configStoreSections[storeName]
  return config?.[section]?.[key] && typeof config[section][key] === 'object' ? config[section][key] : {}
}

function setConfigSection(config, storeName, data) {
  const [section, key] = configStoreSections[storeName]
  config[section] = config[section] && typeof config[section] === 'object' ? config[section] : {}
  config[section][key] = data && typeof data === 'object' ? data : {}
}

function sessionBucket(value) {
  if (value?.scope === 'project' && value?.projectId) {
    return { scope: 'project', projectId: String(value.projectId) }
  }
  return { scope: 'global' }
}

function assertSafePathSegment(segment) {
  if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) {
    const error = new Error(`Invalid path segment: ${segment}`)
    error.statusCode = 400
    throw error
  }
}

function sessionStoreFile(storeName, bucket) {
  if (bucket.scope === 'project') {
    assertSafePathSegment(bucket.projectId)
    return path.join(storageDir, 'conversations', 'projects', bucket.projectId, `${storeName}.json`)
  }
  return path.join(storageDir, 'conversations', 'global', `${storeName}.json`)
}

function sessionDataDir(bucket) {
  if (bucket.scope === 'project') {
    assertSafePathSegment(bucket.projectId)
    return path.join(storageDir, 'conversations', 'projects', bucket.projectId, 'sessions')
  }
  return path.join(storageDir, 'conversations', 'global', 'sessions')
}

function sessionDataFile(sessionId, bucket) {
  assertSafePathSegment(sessionId)
  return path.join(sessionDataDir(bucket), `${sessionId}.json`)
}

export async function ensureProjectCache(projectId) {
  const safeProjectId = String(projectId || '')
  assertSafePathSegment(safeProjectId)
  const projectCacheDir = path.join(cacheDir, 'projects', safeProjectId)
  const projectStorageDir = path.join(storageDir, 'conversations', 'projects', safeProjectId)

  await Promise.all([
    fs.mkdir(path.join(projectCacheDir, 'workspace', 'file-index'), { recursive: true }),
    fs.mkdir(path.join(projectCacheDir, 'workspace', 'grep'), { recursive: true }),
    fs.mkdir(path.join(projectCacheDir, 'llm', 'responses'), { recursive: true }),
    fs.mkdir(path.join(projectCacheDir, 'llm', 'reasoning'), { recursive: true }),
    fs.mkdir(path.join(projectCacheDir, 'assets'), { recursive: true }),
    fs.mkdir(path.join(projectCacheDir, 'tmp'), { recursive: true }),
    fs.mkdir(path.join(projectStorageDir, 'sessions'), { recursive: true }),
    ensureJsonFile(path.join(projectStorageDir, 'sessions-metadata.json')),
  ])

  return projectCacheDir
}

async function ensureJsonFile(file, defaultValue = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  if (!existsSync(file)) await fs.writeFile(file, `${JSON.stringify(defaultValue, null, 2)}\n`, 'utf8')
}

async function readJsonFile(file, defaultValue = {}) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const json = text.trimStart()
    return json ? JSON.parse(json) : defaultValue
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultValue
    throw error
  }
}

async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
}

async function readConfigFile() {
  return normalizeConfig(await readJsonFile(quickForgeConfigFile, defaultConfig()))
}

async function writeConfigFile(config) {
  const next = normalizeConfig(config)
  next.layoutVersion = 1
  next.updatedAt = new Date().toISOString()
  await writeJsonAtomic(quickForgeConfigFile, next)
}

async function listProjectSessionFiles(storeName) {
  const projectsDir = path.join(storageDir, 'conversations', 'projects')
  let entries = []
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDir, entry.name, `${storeName}.json`))
}

async function listProjectIds() {
  const projectsDir = path.join(storageDir, 'conversations', 'projects')
  let entries = []
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function listSessionDataFiles(bucket) {
  const dir = sessionDataDir(bucket)
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
}

async function readSessionValuesScoped(scope, projectId) {
  const bucket = scope === 'project' ? { scope: 'project', projectId } : { scope: 'global' }
  const files = await listSessionDataFiles(bucket)
  const result = {}
  for (const file of files) {
    const value = await readJsonFile(file, null)
    if (value?.id) result[value.id] = value
  }
  return result
}

async function readAllSessionValues() {
  const result = await readSessionValuesScoped('global')
  for (const projectId of await listProjectIds()) {
    Object.assign(result, await readSessionValuesScoped('project', projectId))
  }
  return result
}

function sessionMetadataQueueName(bucket) {
  return bucket.scope === 'project' ? `sessions-metadata:${bucket.projectId}` : 'sessions-metadata:global'
}

function sameSessionBucket(left, right) {
  if (!left || !right) return false
  return left.scope === right.scope && (left.projectId || undefined) === (right.projectId || undefined)
}

function updateSessionMetadataBucketIndex(bucket, previousData, nextData) {
  const ids = new Set([
    ...Object.keys(previousData || {}),
    ...Object.keys(nextData || {}),
  ])

  for (const sessionId of ids) {
    const meta = nextData?.[sessionId]
    if (meta && typeof meta === 'object') {
      sessionBucketIndex.set(sessionId, sessionBucket(meta))
      continue
    }

    if (sameSessionBucket(sessionBucketIndex.get(sessionId), bucket)) {
      sessionBucketIndex.delete(sessionId)
    }
  }
}

async function writeSessionValueFile(sessionId, value) {
  await writeJsonAtomic(sessionDataFile(sessionId, sessionBucket(value)), value)
  // Keep in-memory index current
  if (value) sessionBucketIndex.set(sessionId, sessionBucket(value))
}

async function writeSessionValues(data) {
  const nextIds = new Set(Object.keys(data || {}))
  const existingFiles = [
    ...(await listSessionDataFiles({ scope: 'global' })),
    ...(await Promise.all(
      (await listProjectIds()).map((projectId) => listSessionDataFiles({ scope: 'project', projectId })),
    )).flat(),
  ]

  await Promise.all(
    existingFiles.map(async (file) => {
      const sessionId = path.basename(file, '.json')
      if (!nextIds.has(sessionId)) {
        await fs.rm(file, { force: true })
        sessionBucketIndex.delete(sessionId)
      }
    }),
  )

  await Promise.all(
    Object.entries(data || {}).map(([sessionId, value]) => writeSessionValueFile(sessionId, value)),
  )
}

async function rebuildBucketIndex() {
  sessionBucketIndex.clear()
  // Global bucket
  try {
    const globalMeta = await readJsonFile(sessionStoreFile('sessions-metadata', { scope: 'global' }), {})
    for (const [id, meta] of Object.entries(globalMeta)) {
      if (meta && typeof meta === 'object') sessionBucketIndex.set(id, sessionBucket(meta))
    }
  } catch { /* ignore */ }
  // Project buckets
  for (const projectId of await listProjectIds()) {
    try {
      const meta = await readJsonFile(sessionStoreFile('sessions-metadata', { scope: 'project', projectId }), {})
      for (const [id, entry] of Object.entries(meta)) {
        if (entry && typeof entry === 'object') sessionBucketIndex.set(id, sessionBucket(entry))
      }
    } catch { /* ignore */ }
  }
  bucketIndexBuilt = true
}

export async function findSessionBucket(sessionId) {
  if (!bucketIndexBuilt) {
    await ensureStorage()
    await rebuildBucketIndex()
  }
  return sessionBucketIndex.get(sessionId) ?? null
}

export async function readSessionValue(sessionId) {
  const bucket = await findSessionBucket(sessionId)
  if (!bucket) return null
  return readJsonFile(sessionDataFile(sessionId, bucket), null)
}

export async function writeSessionValue(sessionId, value) {
  return enqueueWrite('sessions', async () => {
    await ensureStorage()
    await writeSessionValueFile(sessionId, value)
  })
}

export async function deleteSessionValue(sessionId) {
  return enqueueWrite('sessions', async () => {
    const bucket = await findSessionBucket(sessionId)
    if (!bucket) return
    await fs.rm(sessionDataFile(sessionId, bucket), { force: true })
    sessionBucketIndex.delete(sessionId)
  })
}

async function listSessionStoreFiles(storeName) {
  return [
    sessionStoreFile(storeName, { scope: 'global' }),
    ...(await listProjectSessionFiles(storeName)),
  ]
}

async function readSessionStore(storeName) {
  if (storeName === 'sessions') return readAllSessionValues()

  const files = await listSessionStoreFiles(storeName)
  const result = {}
  for (const file of files) {
    Object.assign(result, await readJsonFile(file, {}))
  }
  return result
}

export async function readSessionStoreScoped(storeName, scope, projectId) {
  await ensureStorage()
  if (storeName === 'sessions') return readSessionValuesScoped(scope, projectId)

  const file = sessionStoreFile(storeName, { scope, projectId })
  return readJsonFile(file, {})
}

async function writeSessionStore(storeName, data) {
  if (storeName === 'sessions') {
    await writeSessionValues(data)
    return
  }

  const buckets = new Map()

  for (const [key, value] of Object.entries(data || {})) {
    const bucket = sessionBucket(value)
    const bucketKey = bucket.scope === 'project' ? `project:${bucket.projectId}` : 'global'
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { bucket, data: {} })
    buckets.get(bucketKey).data[key] = value
  }

  const filesToWrite = new Set(await listSessionStoreFiles(storeName))
  for (const { bucket } of buckets.values()) {
    filesToWrite.add(sessionStoreFile(storeName, bucket))
  }

  const previousByFile = new Map()
  if (storeName === 'sessions-metadata') {
    await Promise.all(
      [...filesToWrite].map(async (file) => {
        previousByFile.set(file, await readJsonFile(file, {}))
      }),
    )
  }

  await Promise.all(
    [...filesToWrite].map(async (file) => {
      const bucketEntry = [...buckets.values()].find((entry) => sessionStoreFile(storeName, entry.bucket) === file)
      await writeJsonAtomic(file, bucketEntry?.data ?? {})
    }),
  )

  // Keep in-memory bucket index current for metadata writes
  if (storeName === 'sessions-metadata') {
    for (const file of filesToWrite) {
      const bucketEntry = [...buckets.values()].find((entry) => sessionStoreFile(storeName, entry.bucket) === file)
      const bucket = bucketEntry?.bucket ?? (file === sessionStoreFile(storeName, { scope: 'global' })
        ? { scope: 'global' }
        : { scope: 'project', projectId: path.basename(path.dirname(file)) })
      updateSessionMetadataBucketIndex(bucket, previousByFile.get(file) ?? {}, bucketEntry?.data ?? {})
    }
    bumpStoreRevision(storeName)
  }
}

async function migrateLegacySessionStore(storeName) {
  const file = legacyFlatStoreFile(storeName)
  if (!existsSync(file)) return

  const legacy = await readJsonFile(file, {})
  const current = await readSessionStore(storeName)
  const merged = { ...legacy, ...current }
  await writeSessionStore(storeName, merged)
}

async function migrateUnifiedConfig() {
  if (existsSync(configMigrationMarkerFile)) return

  const current = await readConfigFile()
  const flatSettings = await readJsonFile(legacyFlatStoreFile('settings'), {})
  const nestedSettings = await readJsonFile(legacyNestedStoreFile('settings'), {})
  const flatProviderKeys = await readJsonFile(legacyFlatStoreFile('provider-keys'), {})
  const nestedProviderKeys = await readJsonFile(legacyNestedStoreFile('provider-keys'), {})
  const flatCustomProviders = await readJsonFile(legacyFlatStoreFile('custom-providers'), {})
  const nestedCustomProviders = await readJsonFile(legacyNestedStoreFile('custom-providers'), {})
  const flatProjects = normalizeProjectConfig(await readJsonFile(legacyFlatProjectConfigFile(), defaultProjectConfig()))
  const nestedProjects = normalizeProjectConfig(await readJsonFile(legacyNestedProjectConfigFile(), defaultProjectConfig()))

  current.app.settings = {
    ...flatSettings,
    ...nestedSettings,
    ...current.app.settings,
  }
  current.credentials.providerKeys = {
    ...flatProviderKeys,
    ...nestedProviderKeys,
    ...current.credentials.providerKeys,
  }
  current.providers.customProviders = {
    ...flatCustomProviders,
    ...nestedCustomProviders,
    ...current.providers.customProviders,
  }

  if (current.projects.projects.length === 0) {
    current.projects = nestedProjects.projects.length > 0 ? nestedProjects : flatProjects
  }

  await writeConfigFile(current)

  if (!existsSync(legacyStorageMigrationMarkerFile)) {
    await migrateLegacySessionStore('sessions-metadata')
    await fs.mkdir(path.dirname(legacyStorageMigrationMarkerFile), { recursive: true })
    await fs.writeFile(legacyStorageMigrationMarkerFile, `${new Date().toISOString()}\n`, 'utf8')
  }

  await fs.mkdir(path.dirname(configMigrationMarkerFile), { recursive: true })
  await fs.writeFile(configMigrationMarkerFile, `${new Date().toISOString()}\n`, 'utf8')
}

const writeQueues = new Map()

function enqueueWrite(queueName, operation) {
  const previous = writeQueues.get(queueName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(operation)
  writeQueues.set(queueName, next)
  return next
}

/**
 * Atomically read-modify-write a store within its serialized write queue.
 * Eliminates the race condition where concurrent read-modify-write operations
 * from multiple browser tabs would overwrite each other.
 *
 * @param {string} storeName
 * @param {(data: object) => object} updateFn — receives current data, returns updated data
 * @returns {Promise<object>} the updated data
 */
export async function atomicUpdate(storeName, updateFn) {
  assertStore(storeName)
  const queueName = configStores.has(storeName) ? 'config' : storeName
  return enqueueWrite(queueName, async () => {
    await ensureStorage()
    if (configStores.has(storeName)) {
      const config = await readConfigFile()
      const data = configSection(config, storeName)
      const updated = updateFn(data)
      setConfigSection(config, storeName, updated)
      await writeConfigFile(config)
      return updated
    }
    const data = await readSessionStore(storeName)
    const updated = updateFn(data)
    await writeSessionStore(storeName, updated)
    return updated
  })
}

/**
 * Atomically read-modify-write the scoped sessions metadata file within its serialized write queue.
 *
 * @param {string} scope
 * @param {string|null|undefined} projectId
 * @param {(data: object) => object} updateFn — receives current scoped metadata, returns updated metadata
 * @returns {Promise<object>} the updated scoped metadata
 */
export async function atomicSessionMetadataUpdate(scope, projectId, updateFn) {
  const bucket = scope === 'project' ? { scope: 'project', projectId } : { scope: 'global' }
  const file = sessionStoreFile('sessions-metadata', bucket)
  return enqueueWrite(sessionMetadataQueueName(bucket), async () => {
    await ensureStorage()
    const data = await readJsonFile(file, {})
    const previousData = { ...data }
    const updated = updateFn(data)
    await writeJsonAtomic(file, updated)
    updateSessionMetadataBucketIndex(bucket, previousData, updated)
    bumpStoreRevision('sessions-metadata')
    return updated
  })
}

/**
 * Atomically read-modify-write the project config within the config queue.
 */
export async function atomicProjectConfigUpdate(updateFn) {
  return enqueueWrite('config', async () => {
    await ensureStorage()
    const config = await readConfigFile()
    const projectConfig = normalizeProjectConfig(config.projects)
    const updated = updateFn(projectConfig)
    config.projects = normalizeProjectConfig(updated)
    await writeConfigFile(config)
    return updated
  })
}

export async function ensureStorage() {
  await fs.mkdir(configDir, { recursive: true })
  await fs.mkdir(storageDir, { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.mkdir(logsDir, { recursive: true })
  await Promise.all([
    fs.mkdir(path.join(cacheDir, 'global', 'llm'), { recursive: true }),
    fs.mkdir(path.join(cacheDir, 'global', 'tmp'), { recursive: true }),
    fs.mkdir(path.join(cacheDir, 'projects'), { recursive: true }),
    fs.mkdir(path.join(storageDir, 'conversations', 'global', 'sessions'), { recursive: true }),
    fs.mkdir(path.join(storageDir, 'conversations', 'projects'), { recursive: true }),
    cleanOldLogs(),
  ])

  await migrateUnifiedConfig()

  await Promise.all([
    ensureJsonFile(quickForgeConfigFile, defaultConfig()),
    ensureJsonFile(sessionStoreFile('sessions-metadata', { scope: 'global' })),
  ])
}

export async function readStore(storeName) {
  assertStore(storeName)
  await ensureStorage()

  if (configStores.has(storeName)) {
    const config = await readConfigFile()
    return configSection(config, storeName)
  }

  return readSessionStore(storeName)
}

export async function writeStore(storeName, data) {
  assertStore(storeName)
  const queueName = configStores.has(storeName) ? 'config' : storeName

  return enqueueWrite(queueName, async () => {
    await ensureStorage()

    if (configStores.has(storeName)) {
      const config = await readConfigFile()
      setConfigSection(config, storeName, data)
      await writeConfigFile(config)
      return
    }

    await writeSessionStore(storeName, data)
  })
}

export async function readProjectConfigData() {
  await ensureStorage()
  const config = await readConfigFile()
  return normalizeProjectConfig(config.projects)
}

export async function writeProjectConfigData(projectConfig) {
  return enqueueWrite('config', async () => {
    await ensureStorage()
    const config = await readConfigFile()
    config.projects = normalizeProjectConfig(projectConfig)
    await writeConfigFile(config)
  })
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
