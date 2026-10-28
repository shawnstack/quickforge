import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// UI hook budgets live here because the loader is the only place that owns the
// plugin call boundary: registry decides *whether* a call is allowed, the loader
// decides how long it may take. A cold-load `getSlots` gets a tighter budget than
// a user-triggered action so one slow plugin cannot delay first paint.
export const DEFAULT_UI_ACTION_TIMEOUT_MS = 5 * 1000
export const DEFAULT_UI_SLOTS_TIMEOUT_MS = 2 * 1000

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function contentToText(result) {
  if (typeof result === 'string') return result
  if (Array.isArray(result?.content)) {
    return result.content.map((item) => {
      if (typeof item === 'string') return item
      if (item?.type === 'text') return item.text || ''
      return JSON.stringify(item)
    }).join('\n')
  }
  if (Object.prototype.hasOwnProperty.call(result || {}, 'content')) return String(result.content ?? '')
  return JSON.stringify(result ?? null, null, 2)
}

// Bounds one plugin hook. The message keeps the words "timed out" because the
// registry maps that to a 504 on the UI action route.
function withUiTimeout(promise, timeoutMs, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer))
}

export async function loadPlugin(manifest, context = {}, options = {}) {
  const mainPath = new URL(manifest.main, pathToFileURL(`${manifest.dir}/`))
  const source = await fs.readFile(mainPath)
  const reloadToken = createHash('sha256').update(source).digest('hex')
  const moduleUrl = `${mainPath.href}?quickforgePluginReload=${reloadToken}`
  const module = await import(moduleUrl)
  const factory = module.createPlugin || module.default
  if (typeof factory !== 'function') {
    throw new Error(`Plugin ${manifest.name} must export createPlugin(context) or a default factory function.`)
  }

  const plugin = await factory({
    ...context,
    plugin: {
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      dir: manifest.dir,
    },
  })

  if (!isPlainObject(plugin)) {
    throw new Error(`Plugin ${manifest.name} factory must return an object.`)
  }

  const uiActionTimeoutMs = Number.isFinite(options.uiActionTimeoutMs)
    ? options.uiActionTimeoutMs
    : DEFAULT_UI_ACTION_TIMEOUT_MS
  const uiSlotsTimeoutMs = Number.isFinite(options.uiSlotsTimeoutMs)
    ? options.uiSlotsTimeoutMs
    : DEFAULT_UI_SLOTS_TIMEOUT_MS

  const tools = isPlainObject(plugin.tools) ? plugin.tools : {}
  const dispose = typeof plugin.dispose === 'function' ? plugin.dispose.bind(plugin) : null
  const ui = isPlainObject(plugin.ui) ? plugin.ui : null
  return {
    async callTool(toolName, params = {}, toolContext = {}) {
      const handler = tools[toolName]
      if (typeof handler !== 'function') throw new Error(`Plugin ${manifest.name} did not provide handler for tool ${toolName}.`)
      const result = await handler(params || {}, toolContext)
      return {
        content: contentToText(result),
        details: isPlainObject(result?.details) ? result.details : undefined,
        isError: Boolean(result?.isError),
      }
    },
    // Optional UI hooks, each wrapped with its own budget. Validation of the
    // returned nodes stays in registry.mjs (single enforcement point for "what
    // is allowed to reach the UI").
    getSlots: ui && typeof ui.getSlots === 'function'
      ? (slotName, props) => withUiTimeout(
        ui.getSlots.call(ui, slotName, props),
        uiSlotsTimeoutMs,
        `Plugin ${manifest.name} getSlots(${slotName}) timed out after ${uiSlotsTimeoutMs}ms`,
      )
      : null,
    handleUiAction: ui && typeof ui.handle === 'function'
      ? (action, payload, info) => withUiTimeout(
        ui.handle.call(ui, action, payload, info),
        uiActionTimeoutMs,
        `Plugin ${manifest.name} UI action ${action} timed out after ${uiActionTimeoutMs}ms`,
      )
      : null,
    async dispose() {
      if (dispose) await dispose()
    },
  }
}
