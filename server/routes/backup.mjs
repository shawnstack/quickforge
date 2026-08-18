import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isAuthenticatedAppClient } from '../access-policy.mjs'
import { isScheduledRunsMaintenanceActive } from '../scheduled-runs-cutover.mjs'
import { readScheduledTasksForBackup, restoreScheduledTasks } from '../scheduled-runs-backup.mjs'
import { isSessionStateAuthoritative } from '../session-state-service.mjs'
import { isSessionStateMaintenanceActive } from '../session-state-cutover.mjs'
import { exportSessionStateForBackup, restoreSessionStateSnapshot } from '../session-state-backup.mjs'
import { isShareStorageAuthoritative } from '../share-service.mjs'
import { isShareMaintenanceActive } from '../share-cutover.mjs'
import { exportShareStateForBackup, restoreShareStateSnapshot } from '../share-backup.mjs'
import { readSharesJsonFile, writeSharesJsonFile } from '../share-json-file.mjs'
import { isLanAccessStorageAuthoritative } from '../lan-access-service.mjs'
import { isLanAccessMaintenanceActive } from '../lan-access-cutover.mjs'
import { exportLanAccessStateForBackup, restoreLanAccessStateSnapshot } from '../lan-access-backup.mjs'
import { readLanAccessJsonFile, writeLanAccessJsonFile } from '../lan-access-json-file.mjs'
import { refreshAllSessionModels } from '../agent-manager.mjs'
import { logger } from '../utils/logger.mjs'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import {
  ensureStorage,
  readStore,
  writeStore,
  readProjectConfigData,
  storageDir,
} from '../storage.mjs'

const BACKUP_VERSION = 1
const BACKUP_APP = 'quickforge'
const IMPORT_UPLOAD_MAX_BYTES = Number(process.env.QUICKFORGE_IMPORT_UPLOAD_MAX_BYTES || 1024 * 1024 * 1024)
const backupScopes = new Set(['all', 'config', 'sessions', 'shares', 'lan-access'])
const settingsSectionIds = ['settings', 'mcp', 'providerKeys', 'customProviders', 'scheduledTasks']
const exportSectionIds = new Set(settingsSectionIds)
const restoreSectionIds = new Set([...settingsSectionIds, 'conversations', 'shares', 'lanAccess'])
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
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      nextMetadata[sessionId] = {
        ...existing,
        ...(!Number.isInteger(existing.stateVersion) && Number.isInteger(session.stateVersion) && session.stateVersion >= 0
          ? { stateVersion: session.stateVersion }
          : {}),
      }
      continue
    }
    nextMetadata[sessionId] = {
      id: sessionId,
      title: typeof session.title === 'string' ? session.title : 'New chat',
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : now,
      lastModified: typeof session.lastModified === 'string' ? session.lastModified : now,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      stateVersion: Number.isInteger(session.stateVersion) && session.stateVersion >= 0 ? session.stateVersion : undefined,
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
  const includeShares = selected ? false : normalizedScope === 'all' || normalizedScope === 'shares'
  const includeLanAccess = selected ? false : normalizedScope === 'all' || normalizedScope === 'lan-access'
  const includeSecrets = selected ? selected.has('providerKeys') : Boolean(options.includeSecrets && includeConfig)
  const data = {}
  let sessionState = null
  let shareState = null
  let lanAccessState = null

  if (includeConfig) {
    const shouldInclude = (id) => !selected || selected.has(id)
    const entries = await Promise.all([
      shouldInclude('settings') ? readStore('settings').then((value) => ['settings', value]) : null,
      shouldInclude('mcp') ? readStore('mcp').then((value) => ['mcp', value]) : null,
      shouldInclude('providerKeys') ? readStore('provider-keys').then((value) => ['providerKeys', value]) : null,
      shouldInclude('customProviders') ? readStore('custom-providers').then((value) => ['customProviders', value]) : null,
      shouldInclude('scheduledTasks') ? readScheduledTasksForBackup().then((value) => ['scheduledTasks', value]) : null,
      options.includeLocalProjects ? readProjectConfigData().then((value) => ['projects', value]) : null,
    ])
    for (const entry of entries) {
      if (entry) data[entry[0]] = entry[1]
    }
  }

  if (includeSessions) {
    if (isSessionStateAuthoritative()) {
      // Authoritative export: integrity verified under the session state
      // maintenance lock; the envelope carries phase + count + digest so the
      // restore path can verify the snapshot round-trips exactly.
      const snapshot = await exportSessionStateForBackup()
      Object.assign(data, {
        sessions: snapshot.sessions,
        sessionsMetadata: snapshot.sessionsMetadata,
      })
      sessionState = { phase: snapshot.phase, count: snapshot.count, digest: snapshot.digest }
    } else {
      const [sessions, sessionsMetadata] = await Promise.all([
        readStore('sessions'),
        readStore('sessions-metadata'),
      ])
      Object.assign(data, {
        sessions,
        sessionsMetadata,
      })
    }
  }

  if (includeShares) {
    if (isShareStorageAuthoritative()) {
      // Authoritative export: integrity verified under the share maintenance
      // lock; the envelope carries phase + count + digest so the restore path
      // can verify the snapshot round-trips exactly. Records include tokens
      // (hashes only — the raw secrets never leave the issuer).
      const snapshot = await exportShareStateForBackup()
      Object.assign(data, { shares: snapshot.shares })
      shareState = { phase: snapshot.phase, count: snapshot.count, digest: snapshot.digest }
    } else {
      data.shares = await readSharesJsonFile()
    }
  }

  if (includeLanAccess) {
    if (isLanAccessStorageAuthoritative()) {
      // Authoritative export: integrity verified under the lan-access
      // maintenance lock; the envelope carries phase + count + digest so the
      // restore path can verify the snapshot round-trips exactly. The config
      // keeps token hashes only and strips the repository-internal revision.
      const snapshot = await exportLanAccessStateForBackup()
      Object.assign(data, { lanAccess: snapshot.lanAccess })
      lanAccessState = { phase: snapshot.phase, count: snapshot.count, digest: snapshot.digest }
    } else {
      data.lanAccess = await readLanAccessJsonFile()
    }
  }

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    scope: selected ? 'config' : normalizedScope,
    exportedSections: selected ? settingsSectionIds.filter((id) => selected.has(id)) : undefined,
    includeSecrets,
    ...(sessionState ? { sessionState } : {}),
    ...(shareState ? { shareState } : {}),
    ...(lanAccessState ? { lanAccessState } : {}),
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

  const hasEnvelope = backup.data && typeof backup.data === 'object' && !Array.isArray(backup.data)
  if (hasEnvelope && Number.isInteger(backup.version) && backup.version > BACKUP_VERSION) {
    const error = new Error(`Unsupported backup version: ${backup.version}`)
    error.statusCode = 400
    throw error
  }

  const data = hasEnvelope
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
    shares: section(data, 'shares'),
    lanAccess: section(data, 'lanAccess'),
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
  const ignoredProjects = normalized.sections.projects !== undefined

  for (const id of settingsSectionIds) {
    const value = normalized.sections[id]
    if (value === undefined) continue
    try {
      validSections[id] = assertObjectSection(value, id)
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
    ignoredProjects,
  }
}

function validateBackupPayload(payload) {
  const backup = normalizeBackupPayload(payload)
  const { sections } = backup

  const sessions = assertObjectSection(sections.sessions, 'sessions')
  const sessionsMetadata = sessions !== undefined
    ? normalizeSessionMetadata(sessions, sections.sessionsMetadata)
    : assertObjectSection(sections.sessionsMetadata, 'sessionsMetadata')

  const validatedSections = {
    settings: assertObjectSection(sections.settings, 'settings'),
    mcp: assertObjectSection(sections.mcp, 'mcp'),
    providerKeys: assertObjectSection(sections.providerKeys, 'providerKeys'),
    customProviders: assertObjectSection(sections.customProviders, 'customProviders'),
    scheduledTasks: assertObjectSection(sections.scheduledTasks, 'scheduledTasks'),
    sessions,
    sessionsMetadata,
    shares: assertObjectSection(sections.shares, 'shares'),
    lanAccess: assertObjectSection(sections.lanAccess, 'lanAccess'),
  }

  if (Object.values(validatedSections).every((value) => value === undefined)) {
    const error = new Error('Backup does not contain any restorable sections')
    error.statusCode = 400
    throw error
  }

  return {
    ...backup,
    sections: validatedSections,
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
    if (id === 'shares') return sections.shares === undefined
    if (id === 'lanAccess') return sections.lanAccess === undefined
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
    scheduledTasks: selected.has('scheduledTasks') ? sections.scheduledTasks : undefined,
    sessions: selected.has('conversations') ? sections.sessions : undefined,
    sessionsMetadata: selected.has('conversations') ? sections.sessionsMetadata : undefined,
    shares: selected.has('shares') ? sections.shares : undefined,
    lanAccess: selected.has('lanAccess') ? sections.lanAccess : undefined,
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

async function localProjectIds() {
  const config = await readProjectConfigData()
  return new Set(
    (Array.isArray(config?.projects) ? config.projects : [])
      .map((project) => project?.id)
      .filter((id) => typeof id === 'string'),
  )
}

function scheduledTasksWithMissingProjects(tasks, projectIds) {
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return []
  return Object.values(tasks).filter((task) => (
    task && typeof task === 'object' && !Array.isArray(task) &&
    typeof task.projectId === 'string' && task.projectId && !projectIds.has(task.projectId)
  ))
}

function pauseScheduledTasksWithMissingProjects(tasks, projectIds) {
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return tasks
  return Object.fromEntries(Object.entries(tasks).map(([id, task]) => {
    if (
      task && typeof task === 'object' && !Array.isArray(task) &&
      typeof task.projectId === 'string' && task.projectId && !projectIds.has(task.projectId)
    ) {
      return [id, { ...task, status: 'paused' }]
    }
    return [id, task]
  }))
}

function buildSummary(sections) {
  const summary = {}
  if (sections.settings !== undefined) summary.settings = countKeys(sections.settings)
  if (sections.mcp !== undefined) summary.mcp = Array.isArray(sections.mcp?.mcpServers) ? sections.mcp.mcpServers.length : countKeys(sections.mcp)
  if (sections.providerKeys !== undefined) summary.providerKeys = countKeys(sections.providerKeys)
  if (sections.customProviders !== undefined) summary.customProviders = countKeys(sections.customProviders)
  if (sections.scheduledTasks !== undefined) summary.scheduledTasks = countKeys(sections.scheduledTasks)
  if (sections.sessions !== undefined) summary.sessions = countKeys(filterSessionsByMetadata(sections.sessions, sections.sessionsMetadata))
  if (sections.sessionsMetadata !== undefined) summary.sessionsMetadata = countKeys(sections.sessionsMetadata)
  if (sections.shares !== undefined) summary.shares = countKeys(sections.shares)
  if (sections.lanAccess !== undefined) {
    summary.lanAccess = sections.lanAccess && Array.isArray(sections.lanAccess.tokens) ? sections.lanAccess.tokens.length : 0
  }
  return summary
}

async function inspectBackup(payload) {
  const normalized = normalizeBackupPayload(payload)
  const ignoredProjects = normalized.sections.projects !== undefined
  const backup = validateBackupPayload(payload)
  const summary = buildSummary(backup.sections)
  const warnings = []
  const containsSecrets = countKeys(backup.sections.providerKeys) > 0
  const missingProjectTasks = backup.sections.scheduledTasks === undefined
    ? []
    : scheduledTasksWithMissingProjects(backup.sections.scheduledTasks, await localProjectIds())

  if (containsSecrets) warnings.push('Backup contains API keys.')
  if (ignoredProjects) warnings.push('Project lists and project-specific settings are local machine data and will not be imported.')
  if (backup.sections.sessions !== undefined || backup.sections.sessionsMetadata !== undefined) {
    warnings.push('Importing conversations will replace local conversation data.')
  }
  if (backup.sections.shares !== undefined) {
    warnings.push('Importing shares will replace local share links (only hashes are exported, raw passwords and tokens stay local).')
  }
  if (backup.sections.lanAccess !== undefined) {
    warnings.push('Importing LAN access configuration will replace the local LAN access config (将替换局域网访问配置，包括 enabled 开关). Only hashes are exported; raw passwords and tokens stay local.')
  }
  if (missingProjectTasks.length > 0) {
    warnings.push(`${missingProjectTasks.length} scheduled task(s) reference projects that are not registered locally and will be paused after import.`)
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
  const backup = await buildBackup(scope, { includeSecrets: true, includeLocalProjects: true })
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
    try {
      await refreshAllSessionModels()
    } catch (error) {
      logger.error('Failed to refresh session models after restoring custom providers:', error)
    }
    summary.customProviders = countKeys(value)
  }

  if (sections.scheduledTasks !== undefined) {
    const projectIds = await localProjectIds()
    const safeTasks = pauseScheduledTasksWithMissingProjects(sections.scheduledTasks, projectIds)
    const value = merge ? mergeRecordStore(await readScheduledTasksForBackup(), safeTasks) : safeTasks
    await restoreScheduledTasks(value, { mode: 'replace' })
    summary.scheduledTasks = countKeys(value)
  }

  if (sections.sessions !== undefined || sections.sessionsMetadata !== undefined) {
    if (isSessionStateAuthoritative()) {
      // Authoritative restore: a single maintenance-locked, compensated SQLite
      // transaction that replaces/merges bodies and metadata together. It never
      // touches scheduled_task_runs or JSON config stores.
      if (sections.sessions === undefined) {
        const error = new Error('Session metadata restore requires session bodies in authoritative mode')
        error.statusCode = 400
        throw error
      }
      try {
        const restored = await restoreSessionStateSnapshot(
          { sessions: sections.sessions, sessionsMetadata: sections.sessionsMetadata ?? {} },
          { mode },
        )
        summary.sessions = restored.sessions
        summary.sessionsMetadata = restored.sessionsMetadata
      } catch (error) {
        if (error instanceof TypeError) error.statusCode = 400
        throw error
      }
    } else {
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
    }
  }

  if (sections.shares !== undefined) {
    if (isShareStorageAuthoritative()) {
      // Authoritative restore: a single maintenance-locked, compensated SQLite
      // transaction via replaceAll. Merge keeps local-only records and lets the
      // backup override same-key entries; replace wipes local shares first. The
      // restore is scoped to the share tables only and never touches the
      // scheduled-runs, session-index or message-storage data.
      try {
        const restored = await restoreShareStateSnapshot({ shares: sections.shares }, { mode })
        summary.shares = restored.shares
      } catch (error) {
        if (error instanceof TypeError) error.statusCode = 400
        throw error
      }
    } else {
      const value = merge ? mergeRecordStore(await readSharesJsonFile(), sections.shares) : sections.shares
      await writeSharesJsonFile(value)
      summary.shares = countKeys(value)
    }
  }

  if (sections.lanAccess !== undefined) {
    if (isLanAccessStorageAuthoritative()) {
      // Authoritative restore: a single maintenance-locked, compensated SQLite
      // transaction via replaceAll. Merge keeps local config fields (including
      // local tokens) while the backup overrides same-key fields; replace wipes
      // the whole config first. The restore overwrites the `enabled` switch
      // when the backup carries one (inspect warns), and is scoped to the
      // lan-access tables only — never touching scheduled-runs, session-index,
      // message-storage or share data.
      try {
        const restored = await restoreLanAccessStateSnapshot({ lanAccess: sections.lanAccess }, { mode })
        summary.lanAccess = restored.lanAccess
      } catch (error) {
        if (error instanceof TypeError) error.statusCode = 400
        throw error
      }
    } else {
      const value = merge ? mergeRecordStore(await readLanAccessJsonFile(), sections.lanAccess) : sections.lanAccess
      await writeLanAccessJsonFile(value)
      summary.lanAccess = countKeys(value)
    }
  }

  return summary
}

export async function handleBackupApi(req, res, url, context = { isLocalRequest: true }) {
  if (!isAuthenticatedAppClient(context)) {
    const error = new Error('Backup import and export require a local or authenticated remote client.')
    error.statusCode = 403
    error.errorCode = 'backup_auth_required'
    throw error
  }
  if (req.method === 'GET' && url.pathname === '/api/backup/export') {
    if (isScheduledRunsMaintenanceActive()) {
      const error = new Error('Scheduled task maintenance is in progress')
      error.statusCode = 423
      error.errorCode = 'scheduled_runs_maintenance'
      throw error
    }
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
    sendJson(res, 200, await inspectBackup(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/inspect-file') {
    await ensureStorage()
    const text = await readTextBody(req)
    const { backup, ignoredConversations } = extractSettingsBackupFromText(text)
    const { backup: validBackup, invalidSections, ignoredProjects } = validateSettingsImportBackup(backup)
    const inspect = await inspectBackup(validBackup)
    if (ignoredProjects) inspect.warnings.push('Project lists and project-specific settings are local machine data and will not be imported.')
    const token = await writePendingImportBackup(validBackup)
    sendJson(res, 200, { ...inspect, invalidSections, ignoredConversations, ignoredProjects, importToken: token })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/import') {
    await ensureStorage()
    const body = await readJsonBody(req)
    const importBody = body?.importToken ? { ...body, backup: await readPendingImportBackup(body.importToken) } : body
    const { backup, mode } = parseImportPayload(importBody)
    const restoringSessions = backup.sections.sessions !== undefined || backup.sections.sessionsMetadata !== undefined
    const restoringShares = backup.sections.shares !== undefined
    const restoringLanAccess = backup.sections.lanAccess !== undefined
    if (restoringSessions && isSessionStateAuthoritative() && isSessionStateMaintenanceActive()) {
      const error = new Error('Session state maintenance is in progress')
      error.statusCode = 423
      error.errorCode = 'session_state_maintenance'
      throw error
    }
    if (restoringShares && isShareStorageAuthoritative() && isShareMaintenanceActive()) {
      const error = new Error('Share storage maintenance is in progress')
      error.statusCode = 423
      error.errorCode = 'share_maintenance'
      throw error
    }
    if (restoringLanAccess && isLanAccessStorageAuthoritative() && isLanAccessMaintenanceActive()) {
      const error = new Error('LAN access storage maintenance is in progress')
      error.statusCode = 423
      error.errorCode = 'lan_access_maintenance'
      throw error
    }
    const safetyBackupPath = await writeSafetyBackup(restoringSessions || restoringShares || restoringLanAccess ? 'all' : 'config')
    const summary = await restoreValidatedBackup(backup, mode)
    if (body?.importToken) await deletePendingImportBackup(body.importToken)
    sendJson(res, 200, { ok: true, safetyBackupPath, summary })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
