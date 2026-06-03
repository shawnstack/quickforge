import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { dataDir, readStore, atomicUpdate } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'
import { loadPlugin } from './loader.mjs'
import {
  isPluginToolName,
  normalizePluginManifest,
  parseQuickForgePluginToolName,
  quickForgePluginToolName,
} from './manifest.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bundledPluginDir = path.resolve(__dirname, '..', '..', 'plugins')
const globalPluginDir = path.join(dataDir, 'plugins')
const legacyGlobalPluginDir = path.join(os.homedir(), '.agents', 'plugins')
let cachedCatalog = null
let cachedCatalogKey = null
let refreshPromise = null

function catalogKey(projectContext = null) {
  return projectContext?.workspaceRoot ? path.resolve(projectContext.workspaceRoot) : ''
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  return JSON.parse(text.trimStart())
}

async function listPluginDirs(root) {
  let entries = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name))
}

function normalizePluginStore(store) {
  const source = isPlainObject(store) ? store : {}
  return {
    enabled: isPlainObject(source.enabled) ? source.enabled : {},
    config: isPlainObject(source.config) ? source.config : {},
  }
}

async function readPluginStore() {
  return normalizePluginStore(await readStore('plugins'))
}

function contributionSummary(contribution) {
  return {
    path: contribution.path,
    resolvedPath: contribution.resolvedPath,
  }
}

async function discoverManifests(projectContext) {
  const roots = [bundledPluginDir, globalPluginDir, legacyGlobalPluginDir]
  if (projectContext?.workspaceRoot) roots.push(path.join(projectContext.workspaceRoot, '.quickforge', 'plugins'))

  const manifests = new Map()
  const errors = []
  for (const root of roots) {
    const dirs = await listPluginDirs(root)
    for (const dir of dirs) {
      const manifestPath = path.join(dir, 'plugin.json')
      if (!(await exists(manifestPath))) continue
      try {
        const manifest = normalizePluginManifest(await readJsonFile(manifestPath), dir)
        if (!manifests.has(manifest.name) || root !== legacyGlobalPluginDir) {
          manifests.set(manifest.name, { manifest, sourceRoot: root })
        }
      } catch (error) {
        errors.push({ dir, sourceRoot: root, error: error?.message || 'Failed to read plugin manifest' })
      }
    }
  }
  return { manifests, errors, roots }
}

async function loadEnabledPlugins(projectContext) {
  const store = await readPluginStore()
  const { manifests, errors, roots } = await discoverManifests(projectContext)
  const plugins = []
  const handlers = new Map()

  for (const { manifest, sourceRoot } of manifests.values()) {
    const enabled = store.enabled[manifest.name] === true || (manifest.enabledByDefault && store.enabled[manifest.name] !== false)
    const config = isPlainObject(store.config[manifest.name]) ? store.config[manifest.name] : {}
    const entry = {
      ...manifest,
      enabled,
      config,
      sourceRoot,
      status: enabled ? 'loaded' : 'disabled',
      error: null,
      tools: manifest.contributes.tools.map((tool) => ({
        ...tool,
        quickForgeName: quickForgePluginToolName(manifest.name, tool.name),
      })),
      skills: manifest.contributes.skills.map(contributionSummary),
      commands: manifest.contributes.commands.map(contributionSummary),
    }

    if (enabled && entry.tools.length > 0) {
      try {
        const loaded = await loadPlugin(manifest, { config, projectContext })
        handlers.set(manifest.name, loaded)
      } catch (error) {
        logger.error(`Failed to load plugin ${manifest.name}:`, error)
        entry.status = 'error'
        entry.error = error?.message || 'Failed to load plugin'
      }
    }

    plugins.push(entry)
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { plugins, handlers, errors, roots }
}

export async function refreshPlugins(projectContext = null) {
  const key = catalogKey(projectContext)
  if (!refreshPromise) {
    refreshPromise = loadEnabledPlugins(projectContext).then((catalog) => {
      cachedCatalog = catalog
      cachedCatalogKey = key
      return catalog
    }).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

async function getCatalog(projectContext = null) {
  const key = catalogKey(projectContext)
  if (!cachedCatalog || cachedCatalogKey !== key) return refreshPlugins(projectContext)
  return cachedCatalog
}

function enabledLoadedPlugins(catalog) {
  return catalog.plugins.filter((plugin) => plugin.enabled && plugin.status === 'loaded')
}

export async function getEnabledPluginSkillSources(projectContext = null) {
  const catalog = await getCatalog(projectContext)
  return enabledLoadedPlugins(catalog).flatMap((plugin) => plugin.skills.map((skill) => ({
    pluginName: plugin.name,
    source: `plugin:${plugin.name}`,
    dir: skill.resolvedPath,
    path: skill.path,
  })))
}

export async function getEnabledPluginCommandSources(projectContext = null) {
  const catalog = await getCatalog(projectContext)
  return enabledLoadedPlugins(catalog).flatMap((plugin) => plugin.commands.map((command) => ({
    pluginName: plugin.name,
    source: `plugin:${plugin.name}`,
    path: command.resolvedPath,
    relativePath: command.path,
  })))
}

export async function getPluginStatus(projectContext = null) {
  const catalog = await refreshPlugins(projectContext)
  return {
    searchPaths: catalog.roots,
    errors: catalog.errors,
    plugins: catalog.plugins.map((plugin) => ({
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      description: plugin.description,
      apiVersion: plugin.apiVersion,
      quickforgeVersion: plugin.quickforgeVersion,
      enabledByDefault: plugin.enabledByDefault,
      dir: plugin.dir,
      sourceRoot: plugin.sourceRoot,
      enabled: plugin.enabled,
      status: plugin.status,
      error: plugin.error,
      permissions: plugin.permissions,
      tools: plugin.tools.map((tool) => ({
        name: tool.name,
        quickForgeName: tool.quickForgeName,
        label: tool.label,
        description: tool.description,
      })),
      skills: plugin.skills.map((skill) => ({ path: skill.path })),
      commands: plugin.commands.map((command) => ({ path: command.path })),
      settings: plugin.contributes.settings,
      config: plugin.config,
    })),
  }
}

export async function setPluginEnabled(name, enabled) {
  await atomicUpdate('plugins', (store) => {
    const next = normalizePluginStore(store)
    next.enabled[name] = enabled === true
    return next
  })
  cachedCatalog = null
  cachedCatalogKey = null
}

export async function setPluginConfig(name, config) {
  await atomicUpdate('plugins', (store) => {
    const next = normalizePluginStore(store)
    next.config[name] = isPlainObject(config) ? config : {}
    return next
  })
  cachedCatalog = null
  cachedCatalogKey = null
}

export async function createPluginToolDefinitions(projectContext = null) {
  const catalog = await getCatalog(projectContext)
  const definitions = []
  for (const plugin of catalog.plugins) {
    if (!plugin.enabled || plugin.status !== 'loaded') continue
    for (const tool of plugin.tools) {
      definitions.push({
        name: tool.quickForgeName,
        label: tool.label,
        description: `[Plugin:${plugin.name}] ${tool.description || tool.name}`,
        parameters: tool.parameters,
        executionMode: tool.executionMode,
        plugin: { name: plugin.name, toolName: tool.name },
      })
    }
  }
  return definitions
}

export { isPluginToolName }

export async function callPluginTool(toolName, params = {}, toolContext = {}) {
  const parsed = parseQuickForgePluginToolName(toolName)
  if (!parsed) {
    const error = new Error(`Invalid plugin tool name: ${toolName}`)
    error.statusCode = 400
    throw error
  }

  const catalog = await getCatalog(toolContext)
  const plugin = catalog.plugins.find((item) => item.name === parsed.pluginName)
  if (!plugin || !plugin.enabled || plugin.status !== 'loaded') {
    const error = new Error(`Plugin is not loaded: ${parsed.pluginName}`)
    error.statusCode = 503
    throw error
  }

  const tool = plugin.tools.find((item) => item.name === parsed.toolName || item.quickForgeName === toolName)
  if (!tool) {
    const error = new Error(`Unknown plugin tool: ${toolName}`)
    error.statusCode = 404
    throw error
  }

  const handler = catalog.handlers.get(parsed.pluginName)
  if (!handler) {
    const error = new Error(`Missing plugin handler: ${parsed.pluginName}`)
    error.statusCode = 503
    throw error
  }

  const result = await handler.callTool(tool.name, params, {
    ...toolContext,
    plugin: { name: plugin.name, dir: plugin.dir, config: plugin.config },
  })

  return {
    isError: Boolean(result.isError),
    content: result.content,
    details: {
      ...(isPlainObject(result.details) ? result.details : {}),
      plugin: true,
      pluginName: plugin.name,
      tool: tool.name,
    },
  }
}
