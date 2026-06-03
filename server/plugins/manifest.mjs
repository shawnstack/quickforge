import path from 'node:path'

export const PLUGIN_API_VERSION = 1

const pluginNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const toolNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const text = asString(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function addPermission(result, seen, value) {
  const text = asString(value)
  if (!text || seen.has(text)) return
  seen.add(text)
  result.push(text)
}

function normalizePermissions(value) {
  if (Array.isArray(value)) return normalizeStringArray(value)
  if (!isPlainObject(value)) return []

  const result = []
  const seen = new Set()
  for (const [key, item] of Object.entries(value)) {
    if (!key) continue
    if (Array.isArray(item)) {
      for (const permission of item) addPermission(result, seen, `${key}:${permission}`)
    } else if (isPlainObject(item)) {
      addPermission(result, seen, `${key}:${JSON.stringify(item)}`)
    } else {
      addPermission(result, seen, `${key}:${item}`)
    }
  }
  return result
}

function normalizeSchema(value) {
  return isPlainObject(value) ? value : { type: 'object', properties: {} }
}

function isPathInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeRelativePath(value, fieldName, pluginName, pluginDir) {
  const rawPath = asString(value).replace(/\\/g, '/')
  if (!rawPath) throw new Error(`Plugin ${pluginName} ${fieldName} contribution path is required.`)
  if (rawPath.includes('\0')) throw new Error(`Plugin ${pluginName} ${fieldName} contribution path contains invalid characters.`)
  if (path.isAbsolute(rawPath)) throw new Error(`Plugin ${pluginName} ${fieldName} contribution path must be relative: ${rawPath}`)

  const resolvedPath = path.resolve(pluginDir, rawPath)
  if (!isPathInside(pluginDir, resolvedPath)) {
    throw new Error(`Plugin ${pluginName} ${fieldName} contribution path is outside the plugin directory: ${rawPath}`)
  }

  return {
    path: rawPath.replace(/^\.\//, ''),
    resolvedPath,
  }
}

function normalizePathContributions(value, fieldName, pluginName, pluginDir) {
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : isPlainObject(value) ? [value] : []
  const result = []
  const seen = new Set()

  for (const entry of entries) {
    const rawPath = typeof entry === 'string'
      ? entry
      : isPlainObject(entry)
        ? entry.path || entry.dir || entry.file
        : ''
    const normalized = normalizeRelativePath(rawPath, fieldName, pluginName, pluginDir)
    const key = normalized.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }

  return result
}

function normalizeTool(tool, pluginName) {
  if (!isPlainObject(tool)) throw new Error(`Plugin ${pluginName} tool entry must be an object.`)
  const name = asString(tool.name)
  if (!toolNamePattern.test(name)) {
    throw new Error(`Plugin ${pluginName} has invalid tool name: ${name || '(empty)'}. Use letters, numbers, underscore, or hyphen.`)
  }
  return {
    name,
    label: asString(tool.label || tool.title, name),
    description: asString(tool.description, name),
    parameters: normalizeSchema(tool.parameters || tool.inputSchema),
    executionMode: asString(tool.executionMode) || undefined,
  }
}

export function quickForgePluginToolName(pluginName, toolName) {
  return `plugin__${pluginName}__${toolName.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

export function parseQuickForgePluginToolName(value) {
  const name = String(value || '')
  if (!name.startsWith('plugin__')) return null
  const rest = name.slice('plugin__'.length)
  const index = rest.indexOf('__')
  if (index <= 0 || index >= rest.length - 2) return null
  return {
    pluginName: rest.slice(0, index),
    toolName: rest.slice(index + 2),
  }
}

export function isPluginToolName(name) {
  return Boolean(parseQuickForgePluginToolName(name))
}

export function normalizePluginManifest(raw, pluginDir) {
  if (!isPlainObject(raw)) throw new Error('plugin.json must contain an object.')

  const name = asString(raw.name)
  if (!pluginNamePattern.test(name)) {
    throw new Error(`Invalid plugin name: ${name || '(empty)'}. Use lowercase letters, numbers, underscore, or hyphen.`)
  }

  const apiVersion = Number(raw.apiVersion || PLUGIN_API_VERSION)
  if (apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`Unsupported plugin apiVersion ${apiVersion}. Current QuickForge plugin API is ${PLUGIN_API_VERSION}.`)
  }

  const contributes = isPlainObject(raw.contributes) ? raw.contributes : {}
  const tools = Array.isArray(contributes.tools)
    ? contributes.tools.map((tool) => normalizeTool(tool, name))
    : []

  return {
    name,
    displayName: asString(raw.displayName || raw.title, name),
    version: asString(raw.version, '0.0.0'),
    description: asString(raw.description),
    apiVersion,
    quickforgeVersion: asString(raw.quickforgeVersion),
    enabledByDefault: raw.enabledByDefault === true,
    main: asString(raw.main, 'index.mjs'),
    permissions: normalizePermissions(raw.permissions),
    contributes: {
      tools,
      skills: normalizePathContributions(contributes.skills, 'skills', name, pluginDir),
      commands: normalizePathContributions(contributes.commands, 'commands', name, pluginDir),
      settings: isPlainObject(contributes.settings) ? contributes.settings : null,
    },
    dir: pluginDir,
    manifestPath: path.join(pluginDir, 'plugin.json'),
  }
}
