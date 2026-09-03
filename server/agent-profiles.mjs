import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readStore, userAgentsDir, writeStore } from './storage.mjs'
import { builtinSubagentProfilePath, ensureBuiltinSubagentMarkdownFiles, subagentDefinitions } from './subagents.mjs'
import { workspaceTools } from './tools/definitions.mjs'
import { defaultGlobalWorkspaceContext, projectContextFromId } from './project-config.mjs'
import {
  deleteUserAgentProfileMarkdown,
  loadFileAgentProfiles,
  userAgentProfileFilePath,
  writeUserAgentProfileMarkdown,
} from './agent-profile-files.mjs'
import {
  AGENT_PROFILE_TOOL_NAMES,
  inferCapabilityPolicy,
  modelReferenceSnapshot,
  normalizeAgentProfileThinkingLevel,
  normalizeCapabilityPolicy,
  normalizeModelReference,
  validateAgentProfileTools,
  validateModelReference,
} from './agent-profile-schema.mjs'

const STORE = 'custom-agents'
const BUILTIN_OVERRIDES_STORE = 'agent-profile-overrides'
const RESERVED_NAMES = new Set(subagentDefinitions.map((definition) => definition.name))
const allowedToolNames = new Set(AGENT_PROFILE_TOOL_NAMES)
const nameRegex = /^[a-z][a-z0-9_-]{1,39}$/
const DEFAULT_MAX_RUNTIME_MS = 2 * 60 * 60 * 1000
const DEFAULT_MAX_TOOL_CALLS = 300
const MIGRATION_MARKER_FILE = path.join(userAgentsDir, '.custom-agents-migrated.json')
let customAgentMigrationPromise = null

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function normalizeOptionalPositiveInteger(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw requestError('maxToolCalls must be a positive integer')
  return Math.min(parsed, max)
}

function normalizeOptionalRuntime(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw requestError('maxRuntimeMs must be a positive number')
  return Math.min(Math.max(Math.round(parsed), 1000), DEFAULT_MAX_RUNTIME_MS)
}

function builtinProfileFromSubagent(definition, override = null) {
  return {
    id: definition.name,
    name: definition.name,
    label: definition.label || definition.name,
    description: definition.description || '',
    systemPrompt: definition.systemPrompt || '',
    allowedTools: [...definition.allowedTools],
    capabilityPolicy: definition.capabilityPolicy || inferCapabilityPolicy(definition.allowedTools),
    model: modelReferenceSnapshot(override?.model || definition.model),
    thinkingLevel: normalizeAgentProfileThinkingLevel(override?.thinkingLevel || 'inherit'),
    lifecycle: 'builtin',
    managed: true,
    maxRuntimeMs: definition.maxRuntimeMs || DEFAULT_MAX_RUNTIME_MS,
    maxToolCalls: definition.maxToolCalls || DEFAULT_MAX_TOOL_CALLS,
    enabledAsSubagent: true,
    builtin: true,
    source: 'builtin',
    readonly: true,
    filePath: builtinSubagentProfilePath(definition.name),
    relativePath: `~/.quickforge/agents/builtin/${definition.name}.md`,
    allowFileMutations: definition.allowFileMutations === true,
    createdAt: 'builtin',
    updatedAt: 'builtin',
  }
}

export async function listBuiltinAgentProfiles() {
  const overrides = await readStore(BUILTIN_OVERRIDES_STORE).catch(() => ({}))
  return subagentDefinitions.map((definition) => builtinProfileFromSubagent(definition, overrides?.[definition.name]))
}

function normalizeProfileInput(input, existing = null, { creating = false } = {}) {
  const now = new Date().toISOString()
  const name = String(input?.name ?? existing?.name ?? '').trim().toLowerCase()
  if (!nameRegex.test(name)) throw requestError('name must start with a letter and contain only lowercase letters, numbers, underscores, or hyphens')
  if (creating && RESERVED_NAMES.has(name)) throw requestError(`Agent name is reserved: ${name}`, 409)
  if (!creating && existing?.builtin) throw requestError('Built-in agents cannot be modified', 403)

  const label = String(input?.label ?? existing?.label ?? name).trim().slice(0, 80)
  if (!label) throw requestError('label is required')

  const allowedTools = uniqueStrings(input?.allowedTools ?? existing?.allowedTools ?? ['read_file', 'grep_files'])
  if (allowedTools.length === 0) throw requestError('allowedTools must contain at least one tool')
  for (const toolName of allowedTools) {
    if (!allowedToolNames.has(toolName)) throw requestError(`Unsupported tool for custom agent: ${toolName}`)
  }
  const capabilityPolicy = normalizeCapabilityPolicy(
    input?.capabilityPolicy ?? existing?.capabilityPolicy,
    allowedTools,
  )
  validateAgentProfileTools(allowedTools, capabilityPolicy)
  const model = validateModelReference(normalizeModelReference(input?.model ?? existing?.model))
  const thinkingLevel = normalizeAgentProfileThinkingLevel(input?.thinkingLevel ?? existing?.thinkingLevel)

  return {
    id: existing?.id || `agent-${randomUUID()}`,
    name,
    label,
    description: String(input?.description ?? existing?.description ?? '').trim().slice(0, 500),
    systemPrompt: String(input?.systemPrompt ?? existing?.systemPrompt ?? '').trim(),
    allowedTools,
    capabilityPolicy,
    model,
    thinkingLevel,
    lifecycle: existing?.lifecycle || 'persistent',
    maxRuntimeMs: normalizeOptionalRuntime(input?.maxRuntimeMs ?? existing?.maxRuntimeMs, DEFAULT_MAX_RUNTIME_MS),
    maxToolCalls: normalizeOptionalPositiveInteger(input?.maxToolCalls ?? existing?.maxToolCalls, DEFAULT_MAX_TOOL_CALLS, 300),
    enabledAsSubagent: input?.enabledAsSubagent === undefined ? Boolean(existing?.enabledAsSubagent ?? true) : input.enabledAsSubagent === true,
    builtin: false,
    source: 'user',
    readonly: false,
    managed: true,
    managedBy: 'quickforge',
    allowFileMutations: allowedTools.some((toolName) => toolName === 'write_file' || toolName === 'edit_file'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
}

async function readCustomAgentMap() {
  const data = await readStore(STORE)
  return data && typeof data === 'object' ? data : {}
}

function migrationReportEntry(profile, file, extra = {}) {
  return {
    id: profile.id,
    fromName: profile.name,
    toName: path.basename(file, '.md'),
    file,
    ...extra,
  }
}

function uniqueMigratedName(name, usedNames) {
  const base = String(name || '').trim().toLowerCase()
  const candidates = [base, `${base}-store`, `${base}-custom`]
  for (const candidate of candidates) {
    if (nameRegex.test(candidate) && !usedNames.has(candidate) && !RESERVED_NAMES.has(candidate) && !existsSync(userAgentProfileFilePath(candidate))) return candidate
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base.slice(0, 34)}-${index}`
    if (nameRegex.test(candidate) && !usedNames.has(candidate) && !RESERVED_NAMES.has(candidate) && !existsSync(userAgentProfileFilePath(candidate))) return candidate
  }
  return null
}

async function migrateCustomAgentStoreToFiles() {
  if (existsSync(MIGRATION_MARKER_FILE)) return
  await fs.mkdir(userAgentsDir, { recursive: true })
  const custom = Object.values(await readCustomAgentMap())
  const report = { migratedAt: new Date().toISOString(), sourceStore: STORE, migrated: [], conflicts: [], skipped: [] }
  if (custom.length === 0) {
    await fs.writeFile(MIGRATION_MARKER_FILE, JSON.stringify(report, null, 2), 'utf8')
    return
  }

  const usedNames = new Set()
  for (const item of custom) {
    try {
      const profile = normalizeProfileInput({ ...item, id: item.id }, item)
      let targetName = profile.name
      let conflictReason = ''
      if (RESERVED_NAMES.has(targetName) || existsSync(userAgentProfileFilePath(targetName)) || usedNames.has(targetName)) {
        conflictReason = RESERVED_NAMES.has(targetName) ? 'reserved builtin name or duplicate' : 'target file already exists or duplicate'
        targetName = uniqueMigratedName(targetName, usedNames)
      }
      if (!targetName) {
        report.skipped.push({ id: item?.id, fromName: item?.name, reason: 'unable to allocate unique markdown file name' })
        continue
      }
      const migrated = { ...profile, name: targetName, source: 'user', readonly: false, managed: true, managedBy: 'quickforge' }
      const file = await writeUserAgentProfileMarkdown(migrated)
      usedNames.add(targetName)
      const entry = migrationReportEntry(item, file, conflictReason ? { reason: conflictReason } : {})
      if (conflictReason) report.conflicts.push(entry)
      else report.migrated.push(entry)
    } catch (error) {
      report.skipped.push({ id: item?.id, fromName: item?.name, reason: error?.message || String(error) })
    }
  }
  await fs.writeFile(MIGRATION_MARKER_FILE, JSON.stringify(report, null, 2), 'utf8')
}

async function ensureCustomAgentStoreMigrated() {
  if (existsSync(MIGRATION_MARKER_FILE)) return
  customAgentMigrationPromise ||= migrateCustomAgentStoreToFiles().finally(() => {
    customAgentMigrationPromise = null
  })
  await customAgentMigrationPromise
}

async function resolveWorkspaceRoot(options = {}) {
  if (options.workspaceRoot) return options.workspaceRoot
  if (options.projectId) {
    try {
      return (await projectContextFromId(options.projectId))?.workspaceRoot || null
    } catch {
      return null
    }
  }
  return defaultGlobalWorkspaceContext()?.workspaceRoot || null
}

function mergeProfiles({ builtin = [], file = [], custom = [] }) {
  const reservedNames = new Set(builtin.map((profile) => profile.name))
  const byName = new Map()

  for (const profile of builtin) {
    byName.set(profile.name, profile)
  }
  for (const profile of file) {
    if (!profile?.name || reservedNames.has(profile.name)) continue
    byName.set(profile.name, profile)
  }
  for (const profile of custom) {
    if (!profile?.id) continue
    if (!reservedNames.has(profile.name) && !byName.has(profile.name)) byName.set(profile.name, profile)
  }

  return [...byName.values()].sort((a, b) => {
    if (a.builtin && !b.builtin) return -1
    if (!a.builtin && b.builtin) return 1
    return a.name.localeCompare(b.name)
  })
}

export async function listAgentProfiles(options = {}) {
  await ensureBuiltinSubagentMarkdownFiles()
  await ensureCustomAgentStoreMigrated()
  const workspaceRoot = await resolveWorkspaceRoot(options)
  const file = await loadFileAgentProfiles(workspaceRoot, { reservedNames: RESERVED_NAMES })
  const profiles = mergeProfiles({ builtin: await listBuiltinAgentProfiles(), file, custom: [] })
  return options.includeDisabled ? profiles : profiles.filter((profile) => profile.enabledAsSubagent || profile.builtin || profile.enabledAsSubagent === false)
}

export async function listSubagentProfiles(options = {}) {
  return (await listAgentProfiles({ ...options, includeDisabled: true })).filter((profile) => profile.enabledAsSubagent)
}

export async function getAgentProfile(idOrName, options = {}) {
  const key = String(idOrName || '').trim().toLowerCase()
  if (!key) return null
  const profiles = await listAgentProfiles({ ...options, includeDisabled: true })
  const byName = profiles.find((profile) => profile.name === key)
  if (byName) return byName
  return profiles.find((profile) => String(profile.id || '').toLowerCase() === key) || null
}

function assertEditableUserProfile(profile) {
  if (!profile) throw requestError('Agent not found', 404)
  if (profile.builtin) throw requestError('Built-in agents cannot be modified', 403)
  if (profile.readonly) throw requestError('Read-only agents cannot be modified from the API', 403)
  if (profile.source !== 'user' || profile.managedBy !== 'quickforge') throw requestError('Only QuickForge-managed user agents can be modified from the API', 403)
}

async function assertNameAvailable(name, currentId = null) {
  if (RESERVED_NAMES.has(name)) throw requestError(`Agent name is reserved: ${name}`, 409)
  const existing = await listAgentProfiles({ includeDisabled: true })
  const conflict = existing.find((profile) => profile.name === name && profile.id !== currentId)
  if (conflict) throw requestError(`Agent name already exists: ${name}`, 409)
}

export async function createCustomAgentProfile(input) {
  await ensureCustomAgentStoreMigrated()
  const profile = normalizeProfileInput(input, null, { creating: true })
  await assertNameAvailable(profile.name)
  const file = await writeUserAgentProfileMarkdown(profile)
  return { ...profile, filePath: file, relativePath: `~/.quickforge/agents/${profile.name}.md` }
}

export async function updateCustomAgentProfile(id, patch) {
  await ensureCustomAgentStoreMigrated()
  const current = await getAgentProfile(id)
  assertEditableUserProfile(current)
  const next = normalizeProfileInput(patch, current)
  await assertNameAvailable(next.name, current.id)
  const file = await writeUserAgentProfileMarkdown(next)
  if (next.name !== current.name) await deleteUserAgentProfileMarkdown(current)
  return { ...next, filePath: file, relativePath: `~/.quickforge/agents/${next.name}.md` }
}

export async function updateBuiltinAgentOverrides(id, patch = {}) {
  const current = await getAgentProfile(id)
  if (!current) throw requestError('Agent not found', 404)
  if (!current.builtin) throw requestError('Only built-in agents support overrides', 400)
  const overrides = await readStore(BUILTIN_OVERRIDES_STORE).catch(() => ({}))
  const base = overrides && typeof overrides === 'object' ? overrides : {}
  const next = { ...base }
  const entry = { ...(base[current.name] && typeof base[current.name] === 'object' ? base[current.name] : {}) }

  if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
    const model = validateModelReference(normalizeModelReference(patch.model))
    if (model.mode === 'fixed') entry.model = model
    else delete entry.model
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'thinkingLevel')) {
    const thinkingLevel = normalizeAgentProfileThinkingLevel(patch.thinkingLevel)
    if (thinkingLevel === 'inherit') delete entry.thinkingLevel
    else entry.thinkingLevel = thinkingLevel
  }

  if (Object.keys(entry).length === 0) delete next[current.name]
  else next[current.name] = entry
  await writeStore(BUILTIN_OVERRIDES_STORE, next)

  const definition = subagentDefinitions.find((item) => item.name === current.name)
  return builtinProfileFromSubagent(definition, next[current.name] || null)
}

export async function updateBuiltinAgentModelOverride(id, modelInput) {
  return updateBuiltinAgentOverrides(id, { model: modelInput })
}

export async function deleteCustomAgentProfile(id) {
  await ensureCustomAgentStoreMigrated()
  const current = await getAgentProfile(id)
  assertEditableUserProfile(current)
  await deleteUserAgentProfileMarkdown(current)
}

export function agentProfileSnapshot(profile) {
  if (!profile) return null
  return {
    id: profile.id,
    name: profile.name,
    label: profile.label,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    allowedTools: [...profile.allowedTools],
    capabilityPolicy: profile.capabilityPolicy || inferCapabilityPolicy(profile.allowedTools || []),
    model: modelReferenceSnapshot(profile.model),
    thinkingLevel: normalizeAgentProfileThinkingLevel(profile.thinkingLevel),
    lifecycle: profile.lifecycle || (profile.builtin ? 'builtin' : 'persistent'),
    managed: profile.managed === true,
    maxRuntimeMs: profile.maxRuntimeMs,
    maxToolCalls: profile.maxToolCalls,
    enabledAsSubagent: profile.enabledAsSubagent === true,
    builtin: profile.builtin === true,
    source: profile.source || (profile.builtin ? 'builtin' : 'store'),
    readonly: profile.readonly === true || profile.builtin === true,
    filePath: profile.filePath,
    relativePath: profile.relativePath,
    warnings: Array.isArray(profile.warnings) ? [...profile.warnings] : undefined,
  }
}

export { AGENT_PROFILE_TOOL_NAMES } from './agent-profile-schema.mjs'

export function listAvailableAgentTools() {
  const labels = {
    read_file: 'Read file',
    grep_files: 'Search files',
    write_file: 'Write file',
    edit_file: 'Edit file',
    run_command: 'Run command',
  }
  const risks = new Set(['write_file', 'edit_file', 'run_command'])
  return workspaceTools
    .filter((tool) => allowedToolNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      label: tool.label || labels[tool.name] || tool.name,
      description: tool.description || '',
      riskLevel: risks.has(tool.name) ? 'dangerous' : 'safe',
    }))
}
