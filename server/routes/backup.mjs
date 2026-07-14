import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import {
  ensureStorage,
  readStore,
  writeStore,
  readProjectConfigData,
  writeProjectConfigData,
  storageDir,
} from '../storage.mjs'
import { initializeActiveProject } from '../project-config.mjs'
import { setActiveWorkspaceRootForFilesystem } from './filesystem.mjs'
import { getWorkspaceRoot } from '../utils/workspace.mjs'

const BACKUP_VERSION = 1
const BACKUP_APP = 'quickforge'
const IMPORT_UPLOAD_MAX_BYTES = Number(process.env.QUICKFORGE_IMPORT_UPLOAD_MAX_BYTES || 1024 * 1024 * 1024)
const backupScopes = new Set(['all', 'config', 'sessions'])
const settingsSectionIds = ['settings', 'mcp', 'providerKeys', 'customProviders', 'projects', 'scheduledTasks']
const exportSectionIds = new Set(settingsSectionIds)
const restoreSectionIds = new Set([...settingsSectionIds, 'conversations'])
const restoreModes = new Set(['replace', 'merge'])

function normalizeMode(value) {
  const mode = String(value || 'replace')
  if (restoreModes.has(mode)) return mode
  const error = new Error(`Invalid restore mode: ${mode}`)
  error.statusCode = 400
  throw error
}

function normalizeScope(value) {
  const scope = String(value || 'config')
  return backupScopes.has(scope) ? scope : 'config'
}

function parseBoolean(value) {
  const text = String(value || '').toLowerCase()
  return text === '1' || text === 'true' || text === 'yes'
}

function extractSettingsBackupFromText(text) {
  let ignoredConversations = false
  const backup = JSON.parse(text, (key, value) => {
    if (key === 'sessions' || key === 'sessionsMetadata' || key === 'sessions-metadata') {
      ignoredConversations = true
      return undefined
    }
    return value
  })
  if (backup && typeof backup === 'object' && !Array.isArray(backup)) {
    const normalized = backup.data && typeof backup.data === 'object' && !Array.isArray(backup.data)
      ? { ...backup, scope: 'config' }
      : {
          app: backup.app ?? BACKUP_APP,
          version: backup.version ?? BACKUP_VERSION,
          exportedAt: backup.exportedAt ?? null,
          scope: 'config',
          includeSecrets: backup.includeSecrets === true,
          data: backup,
        }
    return { backup: normalized, ignoredConversations }
  }
  const error = new Error('Invalid backup file')
  error.statusCode = 400
  throw error
}

async function readTextBody(req, maxBodyBytes = IMPORT_UPLOAD_MAX_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) {
      const error = new Error('Backup file is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function writePendingImportBackup(backup) {
  const dir = path.join(storageDir, 'pending-imports')
  await fs.mkdir(dir, { recursive: true })
  const token = randomUUID()
  const file = path.join(dir, `${token}.json`)
  await fs.writeFile(file, `${JSON.stringify(backup)}\n`, 'utf8')
  return token
}

async function readPendingImportBackup(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) {
    const error = new Error('Invalid import token')
    error.statusCode = 400
    throw error
  }
  const file = path.join(storageDir, 'pending-imports', `${token}.json`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      const error = new Error('Import preview has expired. Please select the backup file again.')
      error.statusCode = 400
      throw error
    }
    throw cause
  }
}

async function deletePendingImportBackup(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return
  const file = path.join(storageDir, 'pending-imports', `${token}.json`)
  await fs.rm(file, { force: true })
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function section(data, key, legacyKey) {
  if (!data || typeof data !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(data, key)) return data[key]
  if (legacyKey && Object.prototype.hasOwnProperty.call(data, legacyKey)) return data[legacyKey]
  return undefined
}

function assertObjectSection(value, name) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`Invalid backup section: ${name}`)
    error.statusCode = 400
    throw error
  }
  return value
}

function assertProjectConfig(value) {
  const projectConfig = assertObjectSection(value, 'projects')
  if (projectConfig === undefined) return undefined
  if (!Array.isArray(projectConfig.projects)) {
    const error = new Error('Invalid backup section: projects.projects must be an array')
    error.statusCode = 400
    throw error
  }
  return {
    activeProjectId: typeof projectConfig.activeProjectId === 'string' ? projectConfig.activeProjectId : null,
    globalSkills: Array.isArray(projectConfig.globalSkills) ? projectConfig.globalSkills : [],
    projects: projectConfig.projects,
  }
}

function filterSessionsByMetadata(sessions, metadata) {
  if (!sessions || !metadata) return sessions
  const metadataIds = new Set(Object.keys(metadata))
  return Object.fromEntries(Object.entries(sessions).filter(([sessionId]) => metadataIds.has(sessionId)))
}

function normalizeSessionMetadata(sessions, metadata) {
  if (!sessions) return metadata
  const sessionsObject = assertObjectSection(sessions, 'sessions')
  const metadataObject = metadata === undefined ? {} : assertObjectSection(metadata, 'sessionsMetadata')
  const nextMetadata = {}
  const now = new Date().toISOString()

  for (const [sessionId, session] of Object.entries(sessionsObject)) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) continue
    const existing = metadataObject?.[sessionId]
    nextMetadata[sessionId] = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing
      : {
          id: sessionId,
          title: typeof session.title === 'string' ? session.title : 'New chat',
          createdAt: typeof session.createdAt === 'string' ? session.createdAt : now,
          lastModified: typeof session.lastModified === 'string' ? session.lastModified : now,
          messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
          thinkingLevel: typeof session.thinkingLevel === 'string' ? session.thinkingLevel : 'off',
          preview: '',
          scope: session.scope === 'project' ? 'project' : 'global',
          projectId: session.scope === 'project' && session.projectId ? String(session.projectId) : undefined,
          taskStatus: session.taskStatus || 'idle',
          taskStartedAt: session.taskStartedAt ?? null,
          taskFinishedAt: session.taskFinishedAt ?? null,
        }
  }

  return nextMetadata
}

function normalizeExportSections(value) {
  if (value === null || value === undefined || value === '') return null
  const items = Array.isArray(value) ? value : String(value).split(',')
  const selected = new Set()
  for (const item of items) {
    const id = String(item).trim()
    if (!exportSectionIds.has(id)) {
      const error = new Error(`Invalid export section: ${id}`)
      error.statusCode = 400
      throw error
    }
    selected.add(id)
  }
  if (selected.size === 0) {
    const error = new Error('No export sections selected')
    error.statusCode = 400
    throw error
  }
  return selected
}

async function buildBackup(scope = 'all', options = {}) {
  const normalizedScope = normalizeScope(scope)
  const selected = normalizeExportSections(options.sections)
  const includeConfig = selected ? true : normalizedScope === 'all' || normalizedScope === 'config'
  const includeSessions = selected ? false : normalizedScope === 'all' || normalizedScope === 'sessions'
  const includeSecrets = selected ? selected.has('providerKeys') : Boolean(options.includeSecrets && includeConfig)
  const data = {}

  if (includeConfig) {
    const shouldInclude = (id) => !selected || selected.has(id)
    const entries = await Promise.all([
      shouldInclude('settings') ? readStore('settings').then((value) => ['settings', value]) : null,
      shouldInclude('mcp') ? readStore('mcp').then((value) => ['mcp', value]) : null,
      shouldInclude('providerKeys') ? readStore('provider-keys').then((value) => ['providerKeys', value]) : null,
      shouldInclude('customProviders') ? readStore('custom-providers').then((value) => ['customProviders', value]) : null,
      shouldInclude('projects') ? readProjectConfigData().then((value) => ['projects', value]) : null,
      shouldInclude('scheduledTasks') ? readStore('scheduled-tasks').then((value) => ['scheduledTasks', value]) : null,
    ])
    for (const entry of entries) {
      if (entry) data[entry[0]] = entry[1]
    }
  }

  if (includeSessions) {
    const [sessions, sessionsMetadata] = await Promise.all([
      readStore('sessions'),
      readStore('sessions-metadata'),
    ])
    Object.assign(data, {
      sessions,
      sessionsMetadata,
    })
  }

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    scope: selected ? 'config' : normalizedScope,
    exportedSections: selected ? settingsSectionIds.filter((id) => selected.has(id)) : undefined,
    includeSecrets,
    data,
  }
}

function normalizeBackupPayload(payload) {
  const backup = payload?.backup && typeof payload.backup === 'object' ? payload.backup : payload
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    const error = new Error('Invalid backup file')
    error.statusCode = 400
    throw error
  }

  const data = backup.data && typeof backup.data === 'object' && !Array.isArray(backup.data)
    ? backup.data
    : backup

  const sections = {
    settings: section(data, 'settings'),
    mcp: section(data, 'mcp'),
    providerKeys: section(data, 'providerKeys', 'provider-keys'),
    customProviders: section(data, 'customProviders', 'custom-providers'),
    projects: section(data, 'projects'),
    scheduledTasks: section(data, 'scheduledTasks', 'scheduled-tasks'),
    sessions: section(data, 'sessions'),
    sessionsMetadata: section(data, 'sessionsMetadata', 'sessions-metadata'),
  }

  // Backward compat: older backups stored MCP servers inside settings.mcpServers.
  if (
    sections.mcp === undefined &&
    sections.settings && typeof sections.settings === 'object' && !Array.isArray(sections.settings) &&
    Object.prototype.hasOwnProperty.call(sections.settings, 'mcpServers')
  ) {
    const { mcpServers, ...restSettings } = sections.settings
    sections.settings = restSettings
    sections.mcp = { mcpServers: Array.isArray(mcpServers) ? mcpServers : [] }
  }

  if (Object.values(sections).every((value) => value === undefined)) {
    const error = new Error('Backup does not contain any restorable sections')
    error.statusCode = 400
    throw error
  }

  return {
    app: typeof backup.app === 'string' ? backup.app : null,
    version: Number.isInteger(backup.version) ? backup.version : null,
    exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
    scope: typeof backup.scope === 'string' ? backup.scope : null,
    includeSecrets: backup.includeSecrets === true,
    sections,
  }
}

function validateSettingsImportBackup(payload) {
  const normalized = normalizeBackupPayload(payload)
  const validSections = {}
  const invalidSections = {}

  for (const id of settingsSectionIds) {
    const value = normalized.sections[id]
    if (value === undefined) continue
    try {
      validSections[id] = id === 'projects'
        ? assertProjectConfig(value)
        : assertObjectSection(value, id)
    } catch (error) {
      invalidSections[id] = error instanceof Error ? error.message : `Invalid backup section: ${id}`
    }
  }

  if (Object.keys(validSections).length === 0) {
    const error = new Error('Backup does not contain any valid settings sections')
    error.statusCode = 400
    throw error
  }

  return {
    backup: {
      app: normalized.app,
      version: normalized.version,
      exportedAt: normalized.exportedAt,
      scope: 'config',
      includeSecrets: normalized.includeSecrets,
      data: validSections,
    },
    invalidSections,
  }
}

function validateBackupPayload(payload) {
  const backup = normalizeBackupPayload(payload)
  const { sections } = backup

  const sessions = assertObjectSection(sections.sessions, 'sessions')
  const sessionsMetadata = sessions !== undefined
    ? normalizeSessionMetadata(sessions, sections.sessionsMetadata)
    : assertObjectSection(sections.sessionsMetadata, 'sessionsMetadata')

  return {
    ...backup,
    sections: {
      settings: assertObjectSection(sections.settings, 'settings'),
      mcp: assertObjectSection(sections.mcp, 'mcp'),
      providerKeys: assertObjectSection(sections.providerKeys, 'providerKeys'),
      customProviders: assertObjectSection(sections.customProviders, 'customProviders'),
      projects: assertProjectConfig(sections.projects),
      scheduledTasks: assertObjectSection(sections.scheduledTasks, 'scheduledTasks'),
      sessions,
      sessionsMetadata,
    },
  }
}

function normalizeRestoreSections(value, sections) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) {
    const error = new Error('Invalid restore sections')
    error.statusCode = 400
    throw error
  }

  const selected = new Set()
  for (const item of value) {
    const id = String(item)
    if (!restoreSectionIds.has(id)) {
      const error = new Error(`Invalid restore section: ${id}`)
      error.statusCode = 400
      throw error
    }
    selected.add(id)
  }

  if (selected.size === 0) {
    const error = new Error('No restore sections selected')
    error.statusCode = 400
    throw error
  }

  const unavailable = [...selected].filter((id) => {
    if (id === 'conversations') return sections.sessions === undefined && sections.sessionsMetadata === undefined
    return sections[id] === undefined
  })
  if (unavailable.length > 0) {
    const error = new Error(`Selected restore section is not available in backup: ${unavailable.join(', ')}`)
    error.statusCode = 400
    throw error
  }

  return selected
}

function filterRestoreSections(sections, selected) {
  if (!selected) return sections
  return {
    settings: selected.has('settings') ? sections.settings : undefined,
    mcp: selected.has('mcp') ? sections.mcp : undefined,
    providerKeys: selected.has('providerKeys') ? sections.providerKeys : undefined,
    customProviders: selected.has('customProviders') ? sections.customProviders : undefined,
    projects: selected.has('projects') ? sections.projects : undefined,
    scheduledTasks: selected.has('scheduledTasks') ? sections.scheduledTasks : undefined,
    sessions: selected.has('conversations') ? sections.sessions : undefined,
    sessionsMetadata: selected.has('conversations') ? sections.sessionsMetadata : undefined,
  }
}

function backupWithSelectedSections(backup, selected) {
  return selected ? { ...backup, sections: filterRestoreSections(backup.sections, selected) } : backup
}

function parseImportPayload(body) {
  const payload = body?.backup && typeof body.backup === 'object' ? body.backup : body
  const normalized = normalizeBackupPayload(payload)
  const requestedSections = body?.backup && typeof body === 'object' ? body.sections : undefined
  const selected = normalizeRestoreSections(requestedSections, normalized.sections)
  const filtered = selected ? backupWithSelectedSections(normalized, selected) : normalized
  const backup = validateBackupPayload({
    app: filtered.app,
    version: filtered.version,
    exportedAt: filtered.exportedAt,
    scope: filtered.scope,
    includeSecrets: filtered.includeSecrets,
    data: filtered.sections,
  })
  const mode = normalizeMode(body?.mode)
  return { backup, mode }
}

function countKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0
}

function buildSummary(sections) {
  const summary = {}
  if (sections.settings !== undefined) summary.settings = countKeys(sections.settings)
  if (sections.mcp !== undefined) summary.mcp = Array.isArray(sections.mcp?.mcpServers) ? sections.mcp.mcpServers.length : countKeys(sections.mcp)
  if (sections.providerKeys !== undefined) summary.providerKeys = countKeys(sections.providerKeys)
  if (sections.customProviders !== undefined) summary.customProviders = countKeys(sections.customProviders)
  if (sections.projects !== undefined) summary.projects = sections.projects.projects.length
  if (sections.scheduledTasks !== undefined) summary.scheduledTasks = countKeys(sections.scheduledTasks)
  if (sections.sessions !== undefined) summary.sessions = countKeys(filterSessionsByMetadata(sections.sessions, sections.sessionsMetadata))
  if (sections.sessionsMetadata !== undefined) summary.sessionsMetadata = countKeys(sections.sessionsMetadata)
  return summary
}

function inspectBackup(payload) {
  const backup = validateBackupPayload(payload)
  const summary = buildSummary(backup.sections)
  const warnings = []
  const containsSecrets = countKeys(backup.sections.providerKeys) > 0

  if (containsSecrets) warnings.push('Backup contains API keys.')
  if (backup.sections.sessions !== undefined || backup.sections.sessionsMetadata !== undefined) {
    warnings.push('Importing conversations will replace local conversation data.')
  }

  return {
    ok: true,
    app: backup.app,
    version: backup.version,
    exportedAt: backup.exportedAt,
    scope: backup.scope,
    includeSecrets: containsSecrets || backup.includeSecrets,
    sections: summary,
    warnings,
  }
}

async function writeSafetyBackup(scope = 'config') {
  const backup = await buildBackup(scope, { includeSecrets: true })
  const dir = path.join(storageDir, 'backups')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `quickforge-before-restore-${backupTimestamp()}.json`)
  await fs.writeFile(file, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  return file
}

// Merge two plain-object stores: backup entries override local on key collision,
// local-only keys are preserved.
function mergeRecordStore(localValue, backupValue) {
  return { ...(localValue && typeof localValue === 'object' ? localValue : {}), ...backupValue }
}

// Merge projects config: dedupe the projects array by id (backup wins on
// collision, local-only entries preserved), take activeProjectId / globalSkills
// from backup.
function mergeProjectConfig(localConfig, backupConfig) {
  const localProjects = Array.isArray(localConfig?.projects) ? localConfig.projects : []
  const backupProjects = Array.isArray(backupConfig.projects) ? backupConfig.projects : []
  const merged = new Map()
  for (const project of localProjects) {
    if (project && typeof project.id === 'string') merged.set(project.id, project)
  }
  for (const project of backupProjects) {
    if (project && typeof project.id === 'string') merged.set(project.id, project)
  }
  return {
    activeProjectId: typeof backupConfig.activeProjectId === 'string' ? backupConfig.activeProjectId : (localConfig?.activeProjectId ?? null),
    globalSkills: Array.isArray(backupConfig.globalSkills) ? backupConfig.globalSkills : (Array.isArray(localConfig?.globalSkills) ? localConfig.globalSkills : []),
    projects: [...merged.values()],
  }
}

async function restoreValidatedBackup(backup, mode = 'replace') {
  const merge = mode === 'merge'
  const { sections } = backup
  const summary = {}

  if (sections.settings !== undefined) {
    const value = merge ? mergeRecordStore(await readStore('settings'), sections.settings) : sections.settings
    await writeStore('settings', value)
    summary.settings = countKeys(value)
  }

  if (sections.mcp !== undefined) {
    const value = merge ? mergeRecordStore(await readStore('mcp'), sections.mcp) : sections.mcp
    await writeStore('mcp', value)
    summary.mcp = Array.isArray(value?.mcpServers) ? value.mcpServers.length : countKeys(value)
  }

  if (sections.providerKeys !== undefined) {
    const value = merge ? mergeRecordStore(await readStore('provider-keys'), sections.providerKeys) : sections.providerKeys
    await writeStore('provider-keys', value)
    summary.providerKeys = countKeys(value)
  }

  if (sections.customProviders !== undefined) {
    const value = merge ? mergeRecordStore(await readStore('custom-providers'), sections.customProviders) : sections.customProviders
    await writeStore('custom-providers', value)
    summary.customProviders = countKeys(value)
  }

  if (sections.projects !== undefined) {
    const value = merge ? mergeProjectConfig(await readProjectConfigData(), sections.projects) : sections.projects
    await writeProjectConfigData(value)
    await initializeActiveProject()
    setActiveWorkspaceRootForFilesystem(getWorkspaceRoot())
    summary.projects = value.projects.length
  }

  if (sections.scheduledTasks !== undefined) {
    const value = merge ? mergeRecordStore(await readStore('scheduled-tasks'), sections.scheduledTasks) : sections.scheduledTasks
    await writeStore('scheduled-tasks', value)
    summary.scheduledTasks = countKeys(value)
  }

  if (sections.sessions !== undefined) {
    const sessions = filterSessionsByMetadata(sections.sessions, sections.sessionsMetadata)
    const value = merge ? mergeRecordStore(await readStore('sessions'), sessions) : sessions
    await writeStore('sessions', value)
    summary.sessions = countKeys(value)
  }

  if (sections.sessionsMetadata !== undefined) {
    const value = merge ? mergeRecordStore(await readStore('sessions-metadata'), sections.sessionsMetadata) : sections.sessionsMetadata
    await writeStore('sessions-metadata', value)
    summary.sessionsMetadata = countKeys(value)
  }

  return summary
}

export async function handleBackupApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/backup/export') {
    await ensureStorage()
    sendJson(res, 200, await buildBackup(url.searchParams.get('scope'), {
      sections: url.searchParams.get('sections'),
      includeSecrets: parseBoolean(url.searchParams.get('includeSecrets')),
    }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/inspect') {
    await ensureStorage()
    const body = await readJsonBody(req)
    sendJson(res, 200, inspectBackup(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/inspect-file') {
    await ensureStorage()
    const text = await readTextBody(req)
    const { backup, ignoredConversations } = extractSettingsBackupFromText(text)
    const { backup: validBackup, invalidSections } = validateSettingsImportBackup(backup)
    const inspect = inspectBackup(validBackup)
    const token = await writePendingImportBackup(validBackup)
    sendJson(res, 200, { ...inspect, invalidSections, ignoredConversations, importToken: token })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/import') {
    await ensureStorage()
    const body = await readJsonBody(req)
    const importBody = body?.importToken ? { ...body, backup: await readPendingImportBackup(body.importToken) } : body
    const { backup, mode } = parseImportPayload(importBody)
    const safetyBackupPath = await writeSafetyBackup(backup.sections.sessions !== undefined || backup.sections.sessionsMetadata !== undefined ? 'all' : 'config')
    const summary = await restoreValidatedBackup(backup, mode)
    if (body?.importToken) await deletePendingImportBackup(body.importToken)
    sendJson(res, 200, { ok: true, safetyBackupPath, summary })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
