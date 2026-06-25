import { randomUUID } from 'node:crypto'
import { readStore, atomicUpdate } from './storage.mjs'
import { subagentDefinitions } from './subagents.mjs'
import { workspaceTools } from './tools/definitions.mjs'
import { defaultGlobalWorkspaceContext, projectContextFromId } from './project-config.mjs'
import { loadFileAgentProfiles } from './agent-profile-files.mjs'

const STORE = 'custom-agents'
const RESERVED_NAMES = new Set(subagentDefinitions.map((definition) => definition.name))
export const AGENT_PROFILE_TOOL_NAMES = ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command']
const allowedToolNames = new Set(AGENT_PROFILE_TOOL_NAMES)
const nameRegex = /^[a-z][a-z0-9_-]{1,39}$/
const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000
const DEFAULT_MAX_TOOL_CALLS = 300

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

function builtinProfileFromSubagent(definition) {
  return {
    id: definition.name,
    name: definition.name,
    label: definition.label || definition.name,
    description: definition.description || '',
    systemPrompt: definition.systemPrompt || '',
    allowedTools: [...definition.allowedTools],
    maxRuntimeMs: definition.maxRuntimeMs || DEFAULT_MAX_RUNTIME_MS,
    maxToolCalls: definition.maxToolCalls || DEFAULT_MAX_TOOL_CALLS,
    enabledAsSubagent: true,
    builtin: true,
    source: 'builtin',
    readonly: true,
    allowFileMutations: definition.allowFileMutations === true,
    createdAt: 'builtin',
    updatedAt: 'builtin',
  }
}

export function listBuiltinAgentProfiles() {
  return subagentDefinitions.map(builtinProfileFromSubagent)
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

  return {
    id: existing?.id || `agent-${randomUUID()}`,
    name,
    label,
    description: String(input?.description ?? existing?.description ?? '').trim().slice(0, 500),
    systemPrompt: String(input?.systemPrompt ?? existing?.systemPrompt ?? '').trim(),
    allowedTools,
    maxRuntimeMs: normalizeOptionalRuntime(input?.maxRuntimeMs ?? existing?.maxRuntimeMs, DEFAULT_MAX_RUNTIME_MS),
    maxToolCalls: normalizeOptionalPositiveInteger(input?.maxToolCalls ?? existing?.maxToolCalls, DEFAULT_MAX_TOOL_CALLS, 300),
    enabledAsSubagent: input?.enabledAsSubagent === undefined ? Boolean(existing?.enabledAsSubagent ?? true) : input.enabledAsSubagent === true,
    builtin: false,
    source: 'store',
    readonly: false,
    allowFileMutations: allowedTools.some((toolName) => toolName === 'write_file' || toolName === 'edit_file'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
}

async function readCustomAgentMap() {
  const data = await readStore(STORE)
  return data && typeof data === 'object' ? data : {}
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
  const custom = Object.values(await readCustomAgentMap())
  const workspaceRoot = await resolveWorkspaceRoot(options)
  const file = await loadFileAgentProfiles(workspaceRoot, { reservedNames: RESERVED_NAMES })
  const profiles = mergeProfiles({ builtin: listBuiltinAgentProfiles(), file, custom })
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
  const custom = Object.values(await readCustomAgentMap())
  return custom.find((profile) => profile?.id === key) || profiles.find((profile) => profile.id === key) || null
}

export async function createCustomAgentProfile(input) {
  let created = null
  await atomicUpdate(STORE, (data) => {
    const map = data && typeof data === 'object' ? data : {}
    const profile = normalizeProfileInput(input, null, { creating: true })
    if (Object.values(map).some((item) => item?.name === profile.name)) throw requestError(`Agent name already exists: ${profile.name}`, 409)
    created = profile
    map[profile.id] = profile
    return map
  })
  return created
}

export async function updateCustomAgentProfile(id, patch) {
  let updated = null
  await atomicUpdate(STORE, (data) => {
    const map = data && typeof data === 'object' ? data : {}
    const current = map[id]
    if (!current) throw requestError('Agent not found', 404)
    const next = normalizeProfileInput(patch, current)
    if (RESERVED_NAMES.has(next.name)) throw requestError(`Agent name is reserved: ${next.name}`, 409)
    if (Object.values(map).some((item) => item?.id !== id && item?.name === next.name)) throw requestError(`Agent name already exists: ${next.name}`, 409)
    updated = next
    map[id] = next
    return map
  })
  return updated
}

export async function deleteCustomAgentProfile(id) {
  await atomicUpdate(STORE, (data) => {
    const map = data && typeof data === 'object' ? data : {}
    if (!map[id]) throw requestError('Agent not found', 404)
    delete map[id]
    return map
  })
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
    maxRuntimeMs: profile.maxRuntimeMs,
    maxToolCalls: profile.maxToolCalls,
    enabledAsSubagent: profile.enabledAsSubagent === true,
    builtin: profile.builtin === true,
    source: profile.source || (profile.builtin ? 'builtin' : 'store'),
    readonly: profile.readonly === true || profile.builtin === true,
    filePath: profile.filePath,
    relativePath: profile.relativePath,
  }
}

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
