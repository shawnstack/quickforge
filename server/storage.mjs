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
  'mcp',
  'provider-keys',
  'custom-providers',
  'plugins',
  'sessions',
  'sessions-metadata',
  'scheduled-tasks',
  'custom-agents',
  'agent-profile-overrides',
])

// Monotonic in-process revisions for cache invalidation in route-level indexes.
const storeRevisions = new Map()

function bumpStoreRevision(storeName) {
  storeRevisions.set(storeName, (storeRevisions.get(storeName) || 0) + 1)
}

export function getStoreRevision(storeName) {
  return storeRevisions.get(storeName) || 0
}

// Each configuration store is persisted to its own file under config/.
// "Solo" stores own a file whose root object *is* the store data.
// "Shared" stores share one file (providers.json) keyed by section, so that
// strongly-coupled provider definitions and their API keys stay in sync under
// a single write queue.
const soloConfigStores = {
  settings: 'settings.json',
  mcp: 'mcp-servers.json',
  plugins: 'plugins.json',
  'agent-profile-overrides': 'agent-profile-overrides.json',
}

const sharedConfigGroups = {
  'providers.json': {
    queue: 'providers',
    sections: {
      'provider-keys': 'providerKeys',
      'custom-providers': 'customProviders',
    },
  },
}

// Reverse index: storeName -> { file, queue, sectionKey|null }
const configStoreLocations = (() => {
  const map = {}
  for (const [store, file] of Object.entries(soloConfigStores)) {
    map[store] = { file, queue: store, sectionKey: null }
  }
  for (const [file, group] of Object.entries(sharedConfigGroups)) {
    for (const [store, sectionKey] of Object.entries(group.sections)) {
      map[store] = { file, queue: group.queue, sectionKey }
    }
  }
  return map
})()

function isConfigStore(storeName) {
  return Boolean(configStoreLocations[storeName])
}

function configStoreFilePath(storeName) {
  return path.join(configDir, configStoreLocations[storeName].file)
}

// Coerce a value into a plain object record (the shape every config store holds).
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// Where each config store lived in the legacy unified config.json, used only as
// a read fallback (D6 read-side safety net).  Note: `mcp` was lifted out of
// `settings.mcpServers` — its legacy source is nested, not a direct section.
const legacyConfigSectionReaders = {
  settings: (config) => asRecord(config.app?.settings),
  mcp: (config) => ({ mcpServers: Array.isArray(config.app?.settings?.mcpServers) ? config.app.settings.mcpServers : [] }),
  plugins: (config) => asRecord(config.extensions?.plugins),
  'provider-keys': (config) => asRecord(config.credentials?.providerKeys),
  'custom-providers': (config) => asRecord(config.providers?.customProviders),
}

// Read a single config store from its (possibly shared) file, with a fallback
// to the legacy unified config.json section when the split file is absent and
// the split migration has not completed yet (D6 read-side safety net, so an
// interrupted or partially-completed migration can never surface empty data).
async function readConfigStore(storeName) {
  const loc = configStoreLocations[storeName]
  const file = configStoreFilePath(storeName)

  if (existsSync(file)) {
    const content = await readJsonFile(file, {})
    if (loc.sectionKey) return asRecord(content?.[loc.sectionKey])
    return asRecord(content)
  }

  // Split file missing: only fall back to the legacy section while the split
  // migration is still pending. Once `.split-migrated` exists the split files
  // are authoritative, so a genuinely missing file means an empty store.
  if (!existsSync(splitMigrationMarkerFile)) {
    const reader = legacyConfigSectionReaders[storeName]
    if (reader) return reader(await readConfigFile())
  }

  return {}
}

// Write a single config store back to its (possibly shared) file.  For shared
// files the sibling sections are preserved.  Must run inside the store's queue.
async function writeConfigStore(storeName, data) {
  const loc = configStoreLocations[storeName]
  const file = configStoreFilePath(storeName)
  if (loc.sectionKey) {
    const content = await readJsonFile(file, {})
    content[loc.sectionKey] = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    await writeJsonAtomic(file, content)
    return
  }
  await writeJsonAtomic(file, data && typeof data === 'object' && !Array.isArray(data) ? data : {})
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
export const userCommandsDir = path.join(dataDir, 'commands')
export const userAgentsDir = path.join(dataDir, 'agents')
export const builtinAgentsDir = path.join(userAgentsDir, 'builtin')
export const tempAgentsDir = path.join(cacheDir, 'global', 'tmp', 'agents')

const quickForgeConfigFile = path.join(configDir, 'config.json')
const configMigrationMarkerFile = path.join(configDir, '.layout-migrated')
const splitMigrationMarkerFile = path.join(configDir, '.split-migrated')
const projectsConfigFile = path.join(configDir, 'projects.json')
const legacyStorageMigrationMarkerFile = path.join(storageDir, '.layout-migrated')

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
    extensions: {
      plugins: {},
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
    extensions: {
      ...(input.extensions && typeof input.extensions === 'object' ? input.extensions : {}),
      plugins:
        input.extensions?.plugins && typeof input.extensions.plugins === 'object'
          ? input.extensions.plugins
          : base.extensions.plugins,
    },
    projects: normalizeProjectConfig(input.projects),
  }
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
  // Windows AV (e.g. Defender real-time scan) can briefly hold the freshly
  // written tmp file between writeFile and rename, surfacing as EPERM/EBUSY.
  // A bounded retry closes that window; the rename stays atomic either way.
  const delays = [25, 50, 100]
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (error) {
      if (attempt >= delays.length || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) {
        try { await fs.unlink(tmp).catch(() => {}) } catch { /* best effort cleanup */ }
        throw error
      }
      await new Promise((resolve) => { setTimeout(resolve, delays[attempt]) })
    }
  }
}

// --- Offline JSON export helpers (v1 downgrade escape hatch) ---
// Storage v2 keeps SQLite authoritative; nothing here runs on the live write
// path. The offline downgrade tool writes the legacy v1 JSON layout (per
// session body file + per-bucket sessions-metadata.json) through these
// helpers so the file layout and path-safety rules stay owned by storage.mjs.
export async function writeSessionStateJsonBody(bucket, sessionId, state) {
  await ensureStorage()
  await writeJsonAtomic(sessionDataFile(sessionId, bucket), state)
}

export async function writeSessionStateMetadataBucket(bucket, metadata) {
  await ensureStorage()
  await writeJsonAtomic(sessionStoreFile('sessions-metadata', bucket), metadata ?? {})
}

export async function removeSessionStateJsonBody(bucket, sessionId) {
  await fs.rm(sessionDataFile(sessionId, bucket), { force: true })
}

// Streaming filesystem adapter over the legacy session-state JSON layout,
// kept for the one-shot startup import (importSessionStateFromJson) and the
// offline downgrade/export tools. It consumes sessions one file at a time so a
// multi-GB library never needs to be fully resident:
// - listBuckets(): global bucket + one bucket per project directory
// - listSessionFiles(bucket): session ids from sessions/<id>.json file names
// - readSessionState(bucket, sessionId): parsed session body (null if absent)
// - readMetadataBucket(bucket): parsed sessions-metadata bucket (default {})
export function createPhysicalSessionStateFsAdapter() {
  return {
    async *listBuckets() {
      await ensureStorage()
      yield { scope: 'global', projectId: null }
      for (const projectId of await listProjectIds()) yield { scope: 'project', projectId }
    },
    async *listSessionFiles(bucket) {
      for (const file of await listSessionDataFiles(bucket)) yield path.basename(file, '.json')
    },
    readSessionState(bucket, sessionId) {
      return readJsonFile(sessionDataFile(sessionId, bucket), null)
    },
    readMetadataBucket(bucket) {
      return readJsonFile(sessionStoreFile('sessions-metadata', bucket), {})
    },
  }
}

// Storage v2: SQLite is always authoritative, so every session-domain facade
// call routes straight to the session state service (single dynamic import,
// shared process singleton).
async function sessionStateFacade() {
  const service = await import('./session-state-service.mjs')
  return service
}

function saveSessionBodyViaFacade(facade, sessionId, value) {
  const saved = facade.saveSessionBody(sessionId, value)
  bumpStoreRevision('sessions-metadata')
  return saved.state
}

async function atomicSessionStateUpdateViaFacade(facade, sessionId, updateFn) {
  const updated = await facade.atomicSessionStateUpdate(sessionId, updateFn)
  bumpStoreRevision('sessions-metadata')
  return updated
}

// Session delete: the authoritative row removal commits first, then the
// sidecar cleanup (assets + cloud chat idempotency keys) runs best-effort and
// never rolls the delete back — the ordering the JSON mirror drain used to
// provide, inlined now that there is no mirror.
async function deleteSessionStateViaFacade(facade, sessionId) {
  const record = facade.readSessionStateRecord(sessionId)
  const bucket = record ? (record.scope === 'project' ? { scope: 'project', projectId: record.projectId } : { scope: 'global' }) : null
  const deleted = facade.deleteSessionState(sessionId)
  if (deleted) {
    bumpStoreRevision('sessions-metadata')
    if (bucket) {
      try {
        const { deleteSessionAssets } = await import('./session-assets.mjs')
        await deleteSessionAssets(bucket, sessionId)
      } catch { /* Sidecars are best-effort after the authoritative commit. */ }
      try {
        const { deleteCloudChatIdempotencySession } = await import('./cloud/chat-idempotency-store.mjs')
        await deleteCloudChatIdempotencySession(sessionId)
      } catch { /* Best-effort after the authoritative commit. */ }
    }
  }
  return deleted
}

async function atomicSessionMetadataUpdateViaFacade(facade, scope, projectId, updateFn) {
  const updated = await facade.atomicSessionMetadataStateUpdate(scope, projectId, updateFn)
  bumpStoreRevision('sessions-metadata')
  return updated
}

async function atomicSessionRecordUpdateViaFacade(facade, sessionId, updateFn) {
  const updated = await facade.atomicSessionRecordUpdate(sessionId, updateFn)
  bumpStoreRevision('sessions-metadata')
  return updated
}

// Legacy 'sessions-metadata' semantics: a set of per-bucket stores, each an
// independent read-modify-write unit. The authoritative equivalent applies
// updateFn to each bucket's metadata map and writes every bucket back through
// updateSessionMetadataBucket — never merging all scopes into one global map.
// Session ids are unique across buckets, so the per-bucket maps partition the
// legacy merged-store view and per-entry updateFns see exactly the same
// sessions, one bucket at a time. Empty store: updateFn still runs once
// against the (empty) global bucket, matching the legacy empty-file behavior.
function atomicSessionMetadataBucketUpdateViaFacade(facade, updateFn) {
  const buckets = facade.readSessionMetadataBuckets()
  const targets = buckets.length > 0 ? buckets : [{ scope: 'global', projectId: null, metadata: {} }]
  let updated = {}
  for (const bucket of targets) {
    const updatedBucket = updateFn({ ...bucket.metadata })
    updated = facade.updateSessionMetadataBucket(bucket.scope, bucket.projectId, () => updatedBucket)
  }
  bumpStoreRevision('sessions-metadata')
  return updated
}

async function atomicSessionStoreReplaceViaFacade(facade, updateFn) {
  const current = facade.readSessionStateStore('sessions')
  const updated = await updateFn(current)
  facade.replaceSessionStateStore('sessions', updated)
  bumpStoreRevision('sessions-metadata')
  return updated
}

async function readConfigFile() {
  return normalizeConfig(await readJsonFile(quickForgeConfigFile, defaultConfig()))
}

// Used only within the migration chain (migrateUnifiedConfig). It persists the
// unified (pre-split) layout at layoutVersion 1 as an intermediate step; the
// subsequent migrateSplitConfig() then demotes config.json to metadata-only
// (layoutVersion 2). Do not use for normal runtime config writes.
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

// Legacy JSON body file scan: after the offline downgrade escape hatch the
// authoritative SQLite store can be empty while body files exist on disk.
async function findSessionBucketByDataFile(sessionId) {
  assertSafePathSegment(sessionId)
  const buckets = [
    { scope: 'global' },
    ...(await listProjectIds()).map((projectId) => ({ scope: 'project', projectId })),
  ]

  for (const bucket of buckets) {
    const file = sessionDataFile(sessionId, bucket)
    try {
      const stat = await fs.stat(file)
      if (stat.isFile()) return bucket
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  return null
}

// Session bucket lookup for asset sidecars: the authoritative store first,
// then the legacy JSON body files (offline downgrade escape hatch layout).
export async function findSessionBucket(sessionId) {
  const facade = await sessionStateFacade()
  const record = facade.readSessionStateRecord(sessionId)
  if (record) return record.scope === 'project' ? { scope: 'project', projectId: record.projectId } : { scope: 'global' }
  return findSessionBucketByDataFile(sessionId)
}

export async function readSessionValue(sessionId) {
  const facade = await sessionStateFacade()
  return facade.readSessionStateValue(sessionId)
}

export async function writeSessionValue(sessionId, value) {
  const facade = await sessionStateFacade()
  return saveSessionBodyViaFacade(facade, sessionId, value)
}

export async function atomicSessionValueUpdate(sessionId, updateFn) {
  const facade = await sessionStateFacade()
  return atomicSessionStateUpdateViaFacade(facade, sessionId, updateFn)
}

export async function deleteSessionValue(sessionId) {
  const facade = await sessionStateFacade()
  return deleteSessionStateViaFacade(facade, sessionId)
}

/**
 * Whether the session state service is currently authoritative (SQLite-backed).
 * Storage v2: always true — kept for callers that branch write behavior
 * (e.g. auto-archive's single atomic transaction path).
 */
export async function isSessionStateAuthoritative() {
  return true
}

/**
 * Write a session body and ensure its derived metadata exists so a single PUT
 * never leaves a body orphaned: one SQLite transaction for body + derived/
 * merged metadata.
 */
export async function writeSessionValueWithMetadata(sessionId, value) {
  const facade = await sessionStateFacade()
  return saveSessionBodyViaFacade(facade, sessionId, value)
}

/**
 * Delete an entire session (body + metadata): one SQLite transaction; sidecar
 * cleanup (assets, cloud chat idempotency) runs best-effort afterwards and
 * failures never roll back the committed session delete.
 */
export async function deleteSessionWithMetadata(sessionId) {
  const facade = await sessionStateFacade()
  return deleteSessionStateViaFacade(facade, sessionId)
}

/**
 * Atomically update a session record (body + metadata together): single
 * SQLite transaction with CAS retry on conflict.
 */
export async function atomicSessionRecordUpdate(sessionId, updateFn) {
  const facade = await sessionStateFacade()
  return atomicSessionRecordUpdateViaFacade(facade, sessionId, updateFn)
}

/**
 * Apply a multi-session batch of set/delete operations across
 * `sessions`/`sessions-metadata` in a single SQLite transaction.
 */
export async function applySessionBatch(operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new TypeError('Session batch operations are required')
  const facade = await sessionStateFacade()
  // Resolve buckets for the deletions before the transaction so sidecar
  // cleanup (assets, cloud chat idempotency) can run after the commit —
  // best-effort, never rolling the batch back.
  const deletedRecords = []
  for (const operation of operations) {
    if (operation?.type !== 'delete' || operation?.store !== 'sessions') continue
    const record = facade.readSessionStateRecord(operation.key)
    if (record) deletedRecords.push(record)
  }
  const result = facade.applySessionBatch(operations)
  for (const record of deletedRecords) {
    const bucket = record.scope === 'project' ? { scope: 'project', projectId: record.projectId } : { scope: 'global' }
    try {
      const { deleteSessionAssets } = await import('./session-assets.mjs')
      await deleteSessionAssets(bucket, record.sessionId)
    } catch { /* Sidecars are best-effort after the authoritative commit. */ }
    try {
      const { deleteCloudChatIdempotencySession } = await import('./cloud/chat-idempotency-store.mjs')
      await deleteCloudChatIdempotencySession(record.sessionId)
    } catch { /* Best-effort after the authoritative commit. */ }
  }
  bumpStoreRevision('sessions-metadata')
  return result
}

async function listSessionStoreFiles(storeName) {
  return [
    sessionStoreFile(storeName, { scope: 'global' }),
    ...(await listProjectSessionFiles(storeName)),
  ]
}

// JSON bucket-store reader for the non-SQLite stores that still live as
// per-bucket files under conversations/ (scheduled-tasks, custom-agents).
// Session stores read through the SQLite facade (see readStore).
async function readSessionStore(storeName) {
  const result = { ...await readJsonFile(sessionStoreFile(storeName, { scope: 'global' }), {}) }
  for (const projectId of await listProjectIds()) {
    const data = await readJsonFile(sessionStoreFile(storeName, { scope: 'project', projectId }), {})
    Object.assign(result, data)
  }
  return result
}

export async function readSessionStoreScoped(storeName, scope, projectId) {
  await ensureStorage()
  if (storeName === 'sessions' || storeName === 'sessions-metadata') {
    const facade = await sessionStateFacade()
    return facade.readSessionStateStore(storeName, { scope, projectId })
  }
  const file = sessionStoreFile(storeName, { scope, projectId })
  return readJsonFile(file, {})
}

// Physical JSON bucket reader (offline tooling / post-downgrade layout).
export async function readPhysicalSessionMetadataBuckets() {
  await ensureStorage()
  const buckets = [
    {
      scope: 'global',
      projectId: null,
      metadata: await readJsonFile(sessionStoreFile('sessions-metadata', { scope: 'global' }), {}),
    },
  ]
  for (const projectId of await listProjectIds()) {
    buckets.push({
      scope: 'project',
      projectId,
      metadata: await readJsonFile(sessionStoreFile('sessions-metadata', { scope: 'project', projectId }), {}),
    })
  }
  return buckets
}

// Authoritative metadata bucket summaries straight from the sessions table.
export async function readAuthoritativeSessionMetadataBuckets() {
  const facade = await sessionStateFacade()
  return facade.readSessionMetadataBuckets()
}

// JSON bucket-store writer for the non-SQLite stores that still live as
// per-bucket files under conversations/ (scheduled-tasks, custom-agents) and
// for the one-shot legacy layout migration. Session bodies/metadata go
// through the SQLite facade instead (see writeStore).
async function writeSessionStore(storeName, data) {
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

  await Promise.all(
    [...filesToWrite].map(async (file) => {
      const bucketEntry = [...buckets.values()].find((entry) => sessionStoreFile(storeName, entry.bucket) === file)
      await writeJsonAtomic(file, bucketEntry?.data ?? {})
    }),
  )
}

// One-shot legacy layout migration (ancient flat storage/*.json stores):
// reads/writes the physical JSON bucket files only. Modern session data is
// imported into SQLite by importSessionStateFromJson during startup.
async function migrateLegacySessionStore(storeName) {
  const file = legacyFlatStoreFile(storeName)
  if (!existsSync(file)) return

  const legacy = await readJsonFile(file, {})
  const current = await readJsonFile(sessionStoreFile(storeName, { scope: 'global' }), {})
  const merged = { ...legacy, ...current }
  await writeJsonAtomic(sessionStoreFile(storeName, { scope: 'global' }), merged)
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

// Split the legacy unified config.json into per-store files under config/.
// Each target file is only written when it does not already exist, so a
// partially-completed migration can safely resume.  config.json is demoted to
// metadata only after the split succeeds.
async function migrateSplitConfig() {
  if (existsSync(splitMigrationMarkerFile)) return

  // Fresh installs have no unified config.json to split — just record marker.
  if (!existsSync(quickForgeConfigFile)) {
    await fs.writeFile(splitMigrationMarkerFile, `${new Date().toISOString()}\n`, 'utf8')
    return
  }

  const config = await readConfigFile()

  // settings.json — mcpServers is stripped out (moved to its own store below)
  if (!existsSync(path.join(configDir, 'settings.json'))) {
    const oldSettings = config.app?.settings && typeof config.app.settings === 'object'
      ? { ...config.app.settings }
      : {}
    delete oldSettings.mcpServers
    await writeJsonAtomic(path.join(configDir, 'settings.json'), oldSettings)
  }

  // mcp-servers.json — lifted out of settings.mcpServers
  if (!existsSync(path.join(configDir, 'mcp-servers.json'))) {
    const mcpServers = config.app?.settings?.mcpServers
    await writeJsonAtomic(path.join(configDir, 'mcp-servers.json'), {
      mcpServers: Array.isArray(mcpServers) ? mcpServers : [],
    })
  }

  // providers.json — customProviders + providerKeys kept together (coupled)
  if (!existsSync(path.join(configDir, 'providers.json'))) {
    const customProviders = config.providers?.customProviders && typeof config.providers.customProviders === 'object'
      ? config.providers.customProviders
      : {}
    const providerKeys = config.credentials?.providerKeys && typeof config.credentials.providerKeys === 'object'
      ? config.credentials.providerKeys
      : {}
    await writeJsonAtomic(path.join(configDir, 'providers.json'), { customProviders, providerKeys })
  }

  // plugins.json
  if (!existsSync(path.join(configDir, 'plugins.json'))) {
    const plugins = config.extensions?.plugins && typeof config.extensions.plugins === 'object'
      ? config.extensions.plugins
      : {}
    await writeJsonAtomic(path.join(configDir, 'plugins.json'), plugins)
  }

  // projects.json
  if (!existsSync(projectsConfigFile)) {
    await writeJsonAtomic(projectsConfigFile, normalizeProjectConfig(config.projects))
  }

  // Demote config.json to metadata only.
  await writeJsonAtomic(quickForgeConfigFile, { layoutVersion: 2, migratedAt: new Date().toISOString() })

  await fs.writeFile(splitMigrationMarkerFile, `${new Date().toISOString()}\n`, 'utf8')
}

const writeQueues = new Map()

// Serialized FIFO write queues for the config stores and the JSON bucket
// stores (projects, providers, scheduled-tasks, custom-agents, …). Session
// state writes go through the SQLite facade (synchronous transactions with
// per-row CAS), so no queue is needed for them any more.
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
  const facade = await sessionStateFacade()
  if (storeName === 'sessions-metadata') return atomicSessionMetadataBucketUpdateViaFacade(facade, updateFn)
  if (storeName === 'sessions') return atomicSessionStoreReplaceViaFacade(facade, updateFn)
  const queueName = isConfigStore(storeName) ? configStoreLocations[storeName].queue : storeName
  return enqueueWrite(queueName, async () => {
    await ensureStorage()
    if (isConfigStore(storeName)) {
      const data = await readConfigStore(storeName)
      const updated = updateFn(data)
      await writeConfigStore(storeName, updated)
      return updated
    }
    const data = await readSessionStore(storeName)
    const updated = updateFn(data)
    await writeSessionStore(storeName, updated)
    return updated
  })
}

/**
 * Atomically read-modify-write one bucket's session metadata through the
 * authoritative store (updateSessionMetadataBucket under the hood).
 *
 * @param {string} scope
 * @param {string|null|undefined} projectId
 * @param {(data: object) => object} updateFn — receives current scoped metadata, returns updated metadata
 * @returns {Promise<object>} the updated scoped metadata
 */
export async function atomicSessionMetadataUpdate(scope, projectId, updateFn) {
  const facade = await sessionStateFacade()
  return atomicSessionMetadataUpdateViaFacade(facade, scope, projectId, updateFn)
}

/**
 * Atomically read-modify-write the project config within the config queue.
 */
export async function atomicProjectConfigUpdate(updateFn) {
  return enqueueWrite('projects', async () => {
    await ensureStorage()
    const projectConfig = normalizeProjectConfig(await readJsonFile(projectsConfigFile, defaultProjectConfig()))
    const updated = updateFn(projectConfig)
    await writeJsonAtomic(projectsConfigFile, normalizeProjectConfig(updated))
    return updated
  })
}

export async function cleanOldTempAgents(retentionMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    await fs.mkdir(tempAgentsDir, { recursive: true })
    const cutoff = Date.now() - retentionMs
    const sessionDirs = await fs.readdir(tempAgentsDir, { withFileTypes: true }).catch(() => [])
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue
      const sessionPath = path.join(tempAgentsDir, sessionDir.name)
      const runDirs = await fs.readdir(sessionPath, { withFileTypes: true }).catch(() => [])
      await Promise.all(runDirs.map(async (runDir) => {
        if (!runDir.isDirectory()) return
        const runPath = path.join(sessionPath, runDir.name)
        try {
          const stat = await fs.stat(runPath)
          if (stat.mtimeMs < cutoff) await fs.rm(runPath, { recursive: true, force: true })
        } catch { /* ignore cleanup errors */ }
      }))
      const remaining = await fs.readdir(sessionPath).catch(() => [])
      if (remaining.length === 0) await fs.rm(sessionPath, { recursive: true, force: true }).catch(() => {})
    }
  } catch {
    // ignore cleanup errors
  }
}

// Cached storage-initialization promise.  ensureStorage() is idempotent (mkdir
// recursive, one-shot migration gated by a marker file, ensureJsonFile), so once
// it succeeds we can skip the redundant syscalls (~20 per call) every later call
// would perform.  Reset on failure so the next call can retry.
let storageInitPromise = null

export function ensureStorage() {
  if (storageInitPromise) return storageInitPromise
  storageInitPromise = (async () => {
    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(storageDir, { recursive: true })
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.mkdir(logsDir, { recursive: true })
    await Promise.all([
      fs.mkdir(path.join(cacheDir, 'global', 'llm'), { recursive: true }),
      fs.mkdir(path.join(cacheDir, 'global', 'tmp'), { recursive: true }),
      fs.mkdir(tempAgentsDir, { recursive: true }),
      fs.mkdir(userAgentsDir, { recursive: true }),
      fs.mkdir(builtinAgentsDir, { recursive: true }),
      fs.mkdir(path.join(cacheDir, 'projects'), { recursive: true }),
      fs.mkdir(path.join(storageDir, 'conversations', 'global', 'sessions'), { recursive: true }),
      fs.mkdir(path.join(storageDir, 'conversations', 'projects'), { recursive: true }),
      // Default workspace directory for global (non-project) conversations, so
      // they share the same file-tool capabilities as project conversations.
      fs.mkdir(path.join(dataDir, 'workspace'), { recursive: true }),
      cleanOldLogs(),
      cleanOldTempAgents(),
    ])

    await migrateUnifiedConfig()
    await migrateSplitConfig()

    await Promise.all([
      ensureJsonFile(quickForgeConfigFile, { layoutVersion: 2 }),
      ensureJsonFile(sessionStoreFile('sessions-metadata', { scope: 'global' })),
    ])
  })()
  // Reset on failure so the next call can retry instead of caching a rejection.
  storageInitPromise.catch(() => { storageInitPromise = null })
  return storageInitPromise
}

export async function readStore(storeName) {
  assertStore(storeName)
  await ensureStorage()

  if (storeName === 'sessions' || storeName === 'sessions-metadata') {
    const facade = await sessionStateFacade()
    return facade.readSessionStateStore(storeName)
  }

  if (isConfigStore(storeName)) {
    return readConfigStore(storeName)
  }

  return readSessionStore(storeName)
}

export async function writeStore(storeName, data) {
  assertStore(storeName)
  if (storeName === 'sessions' || storeName === 'sessions-metadata') {
    const facade = await sessionStateFacade()
    if (storeName === 'sessions') {
      // Whole-store replace: resolve removed sessions for best-effort sidecar
      // cleanup, then swap the store in one verified transaction.
      const removed = []
      for (const record of Object.values(facade.readSessionStateStore('sessions'))) {
        if (!Object.hasOwn(data || {}, record.id)) removed.push(record)
      }
      facade.replaceSessionStateStore(storeName, data)
      for (const record of removed) {
        const bucket = record.scope === 'project' ? { scope: 'project', projectId: record.projectId } : { scope: 'global' }
        try {
          const { deleteSessionAssets } = await import('./session-assets.mjs')
          await deleteSessionAssets(bucket, record.id)
        } catch { /* Sidecars are best-effort after the authoritative commit. */ }
      }
    } else {
      facade.replaceSessionStateStore(storeName, data)
    }
    bumpStoreRevision(storeName === 'sessions' ? 'sessions-metadata' : storeName)
    return
  }
  const queueName = isConfigStore(storeName) ? configStoreLocations[storeName].queue : storeName

  return enqueueWrite(queueName, async () => {
    await ensureStorage()

    if (isConfigStore(storeName)) {
      await writeConfigStore(storeName, data)
      return
    }

    await writeSessionStore(storeName, data)
  })
}

export async function readProjectConfigData() {
  await ensureStorage()
  return normalizeProjectConfig(await readJsonFile(projectsConfigFile, defaultProjectConfig()))
}

export async function writeProjectConfigData(projectConfig) {
  return enqueueWrite('projects', async () => {
    await ensureStorage()
    await writeJsonAtomic(projectsConfigFile, normalizeProjectConfig(projectConfig))
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
