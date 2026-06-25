import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from './storage.mjs'
import { firstOptionalBoolean, firstString, parseFrontmatter, splitDelimitedList } from './frontmatter.mjs'

const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000
const DEFAULT_MAX_TOOL_CALLS = 300
const nameRegex = /^[a-z][a-z0-9_-]{1,39}$/
const allowedToolNames = new Set(['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command'])

const toolAliases = new Map([
  ['Read', 'read_file'],
  ['Grep', 'grep_files'],
  ['Bash', 'run_command'],
  ['Write', 'write_file'],
  ['Edit', 'edit_file'],
])

const claudeUserAgentsDir = path.join(os.homedir(), '.claude', 'agents')
const userAgentsDir = path.join(dataDir, 'agents')

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeName(value) {
  const name = normalizeString(value)?.toLowerCase()
  return name && nameRegex.test(name) ? name : null
}

function normalizeRuntime(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_RUNTIME_MS
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_RUNTIME_MS
  return Math.min(Math.max(Math.round(parsed), 1000), DEFAULT_MAX_RUNTIME_MS)
}

function normalizeToolCalls(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_TOOL_CALLS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_TOOL_CALLS
  return Math.min(parsed, DEFAULT_MAX_TOOL_CALLS)
}

function normalizeTools(value) {
  const tools = []
  const seen = new Set()
  for (const item of splitDelimitedList(value)) {
    const mapped = toolAliases.get(item) || item
    if (!allowedToolNames.has(mapped) || seen.has(mapped)) continue
    seen.add(mapped)
    tools.push(mapped)
  }
  return tools.length ? tools : ['read_file', 'grep_files']
}

function hasMutationTool(allowedTools) {
  return allowedTools.some((toolName) => toolName === 'write_file' || toolName === 'edit_file')
}

export function agentProfileFromMarkdown(file, text, options = {}) {
  const parsed = parseFrontmatter(text)
  if (!parsed.body) return null

  const metadata = parsed.metadata || {}
  const name = normalizeName(metadata.name) || normalizeName(path.basename(file, '.md'))
  if (!name) return null
  if (options.reservedNames?.has(name)) return null

  const allowedTools = normalizeTools(
    metadata.tools ?? metadata['allowed-tools'] ?? metadata.allowedTools,
  )
  const label = firstString(metadata.label, metadata.displayName, metadata.title) || name
  const enabledAsSubagent = firstOptionalBoolean(
    metadata['enabled-as-subagent'],
    metadata.enabled_as_subagent,
    metadata.enabledAsSubagent,
  )

  return {
    id: `${options.idPrefix || 'file'}:${name}`,
    name,
    label: label.slice(0, 80),
    description: String(firstString(metadata.description) || '').slice(0, 500),
    systemPrompt: parsed.body,
    allowedTools,
    maxRuntimeMs: normalizeRuntime(metadata['max-runtime-ms'] ?? metadata.max_runtime_ms ?? metadata.maxRuntimeMs),
    maxToolCalls: normalizeToolCalls(metadata['max-tool-calls'] ?? metadata.max_tool_calls ?? metadata.maxToolCalls),
    enabledAsSubagent: enabledAsSubagent === undefined ? true : enabledAsSubagent,
    builtin: false,
    source: options.source || 'file',
    readonly: true,
    filePath: file,
    relativePath: options.relativePath || path.basename(file),
    allowFileMutations: hasMutationTool(allowedTools),
    createdAt: 'file',
    updatedAt: 'file',
  }
}

async function listAgentFilesFromDirectory(dir, options = {}) {
  if (!dir || !existsSync(dir)) return []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EACCES' || error?.code === 'EPERM') return []
    throw error
  }

  const profiles = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const file = path.join(dir, entry.name)
    try {
      const relativePath = options.relativeRoot
        ? `${options.relativeRoot}/${entry.name}`.replace(/\\/g, '/')
        : entry.name
      const profile = agentProfileFromMarkdown(file, await fs.readFile(file, 'utf8'), {
        ...options,
        relativePath,
      })
      if (profile) profiles.push(profile)
    } catch (error) {
      console.warn(`Failed to load agent profile ${file}:`, error.message || error)
    }
  }
  return profiles
}

function projectClaudeAgentsDir(workspaceRoot) {
  return workspaceRoot ? path.join(path.resolve(workspaceRoot), '.claude', 'agents') : ''
}

function projectQuickForgeAgentsDir(workspaceRoot) {
  return workspaceRoot ? path.join(path.resolve(workspaceRoot), '.quickforge', 'agents') : ''
}

export async function loadUserAgentProfiles(options = {}) {
  const byName = new Map()
  const sources = [
    { dir: claudeUserAgentsDir, source: 'user-claude', relativeRoot: '~/.claude/agents', idPrefix: 'user-claude' },
    { dir: userAgentsDir, source: 'user', relativeRoot: '~/.quickforge/agents', idPrefix: 'user' },
  ]
  for (const source of sources) {
    for (const profile of await listAgentFilesFromDirectory(source.dir, { ...options, ...source })) {
      byName.set(profile.name, profile)
    }
  }
  return [...byName.values()]
}

export async function loadProjectAgentProfiles(workspaceRoot, options = {}) {
  if (!workspaceRoot) return []
  const byName = new Map()
  const sources = [
    { dir: projectClaudeAgentsDir(workspaceRoot), source: 'project-claude', relativeRoot: '.claude/agents', idPrefix: 'project-claude' },
    { dir: projectQuickForgeAgentsDir(workspaceRoot), source: 'project', relativeRoot: '.quickforge/agents', idPrefix: 'project' },
  ]
  for (const source of sources) {
    for (const profile of await listAgentFilesFromDirectory(source.dir, { ...options, ...source })) {
      byName.set(profile.name, profile)
    }
  }
  return [...byName.values()]
}

export async function loadFileAgentProfiles(workspaceRoot, options = {}) {
  const byName = new Map()
  for (const profile of await loadUserAgentProfiles(options)) byName.set(profile.name, profile)
  for (const profile of await loadProjectAgentProfiles(workspaceRoot, options)) byName.set(profile.name, profile)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const agentProfileSearchPaths = {
  global: ['~/.claude/agents', '~/.quickforge/agents'],
  project: ['<project>/.claude/agents', '<project>/.quickforge/agents'],
}
