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
const backupScopes = new Set(['all', 'config', 'sessions'])

function normalizeScope(value) {
  const scope = String(value || 'all')
  return backupScopes.has(scope) ? scope : 'all'
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

async function buildBackup(scope = 'all') {
  const normalizedScope = normalizeScope(scope)
  const includeConfig = normalizedScope === 'all' || normalizedScope === 'config'
  const includeSessions = normalizedScope === 'all' || normalizedScope === 'sessions'
  const data = {}

  if (includeConfig) {
    const [settings, providerKeys, customProviders, projects, scheduledTasks] = await Promise.all([
      readStore('settings'),
      readStore('provider-keys'),
      readStore('custom-providers'),
      readProjectConfigData(),
      readStore('scheduled-tasks'),
    ])
    Object.assign(data, {
      settings,
      providerKeys,
      customProviders,
      projects,
      scheduledTasks,
    })
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
    scope: normalizedScope,
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

  const normalized = {
    settings: section(data, 'settings'),
    providerKeys: section(data, 'providerKeys', 'provider-keys'),
    customProviders: section(data, 'customProviders', 'custom-providers'),
    projects: section(data, 'projects'),
    scheduledTasks: section(data, 'scheduledTasks', 'scheduled-tasks'),
    sessions: section(data, 'sessions'),
    sessionsMetadata: section(data, 'sessionsMetadata', 'sessions-metadata'),
  }

  if (Object.values(normalized).every((value) => value === undefined)) {
    const error = new Error('Backup does not contain any restorable sections')
    error.statusCode = 400
    throw error
  }

  return normalized
}

async function writeSafetyBackup() {
  const backup = await buildBackup('all')
  const dir = path.join(storageDir, 'backups')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `quickforge-before-restore-${backupTimestamp()}.json`)
  await fs.writeFile(file, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  return file
}

async function restoreBackup(payload) {
  const backup = normalizeBackupPayload(payload)
  const summary = {}

  const settings = assertObjectSection(backup.settings, 'settings')
  if (settings !== undefined) {
    await writeStore('settings', settings)
    summary.settings = Object.keys(settings).length
  }

  const providerKeys = assertObjectSection(backup.providerKeys, 'providerKeys')
  if (providerKeys !== undefined) {
    await writeStore('provider-keys', providerKeys)
    summary.providerKeys = Object.keys(providerKeys).length
  }

  const customProviders = assertObjectSection(backup.customProviders, 'customProviders')
  if (customProviders !== undefined) {
    await writeStore('custom-providers', customProviders)
    summary.customProviders = Object.keys(customProviders).length
  }

  const projects = assertProjectConfig(backup.projects)
  if (projects !== undefined) {
    await writeProjectConfigData(projects)
    await initializeActiveProject()
    setActiveWorkspaceRootForFilesystem(getWorkspaceRoot())
    summary.projects = projects.projects.length
  }

  const scheduledTasks = assertObjectSection(backup.scheduledTasks, 'scheduledTasks')
  if (scheduledTasks !== undefined) {
    await writeStore('scheduled-tasks', scheduledTasks)
    summary.scheduledTasks = Object.keys(scheduledTasks).length
  }

  const sessions = assertObjectSection(backup.sessions, 'sessions')
  const sessionsMetadata = normalizeSessionMetadata(sessions, backup.sessionsMetadata)
  if (sessions !== undefined) {
    await writeStore('sessions', filterSessionsByMetadata(sessions, sessionsMetadata))
    summary.sessions = Object.keys(sessions).length
  }

  if (sessionsMetadata !== undefined) {
    await writeStore('sessions-metadata', sessionsMetadata)
    summary.sessionsMetadata = Object.keys(sessionsMetadata).length
  }

  return summary
}

export async function handleBackupApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/backup/export') {
    await ensureStorage()
    sendJson(res, 200, await buildBackup(url.searchParams.get('scope')))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/import') {
    await ensureStorage()
    const body = await readJsonBody(req)
    const safetyBackupPath = await writeSafetyBackup()
    const summary = await restoreBackup(body)
    sendJson(res, 200, { ok: true, safetyBackupPath, summary })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
