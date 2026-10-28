// Contract for the L2 postMessage bridge.
//
// A sandboxed panel (`sandbox="allow-scripts"`, no `allow-same-origin`) has an
// opaque origin: it cannot read host storage and its fetches are blocked by
// CORS. Everything it wants must arrive through this closed method list, so the
// list and the tool-name guard live here as pure functions that can be unit
// tested without React or a DOM.

export type PluginUiBridgeMethod = 'kv.get' | 'kv.set' | 'notify' | 'callTool'

export const PLUGIN_UI_BRIDGE_METHODS: readonly PluginUiBridgeMethod[] = Object.freeze([
  'kv.get',
  'kv.set',
  'notify',
  'callTool',
])

/** Per-method budget. Tool calls reuse the server's 2-minute plugin tool budget. */
export const PLUGIN_UI_BRIDGE_TIMEOUT_MS = 5000
export const PLUGIN_UI_BRIDGE_TOOL_TIMEOUT_MS = 2 * 60 * 1000

export function isPluginUiBridgeMethod(value: unknown): value is PluginUiBridgeMethod {
  return typeof value === 'string' && (PLUGIN_UI_BRIDGE_METHODS as readonly string[]).includes(value)
}

export function bridgeTimeoutMs(method: PluginUiBridgeMethod): number {
  return method === 'callTool' ? PLUGIN_UI_BRIDGE_TOOL_TIMEOUT_MS : PLUGIN_UI_BRIDGE_TIMEOUT_MS
}

/**
 * A panel may only invoke tools its own plugin declares — `plugin__<plugin>__<tool>`.
 *
 * Anything else (workspace tools, MCP tools, other plugins) is rejected here, so
 * opening a panel can never turn into a generic tool launcher. The returned name
 * is then sent to `POST /api/tools/:name`, which still applies the host's own
 * gate: direct plugin-tool execution requires full-access mode. The panel
 * therefore never gets more privilege than the UI it lives in.
 */
export function resolvePanelToolName(plugin: string, requested: unknown): string | null {
  if (typeof plugin !== 'string' || !plugin) return null
  const raw = typeof requested === 'string' ? requested.trim() : ''
  const prefix = 'plugin__'
  if (!raw.startsWith(prefix)) return null

  const rest = raw.slice(prefix.length)
  const separator = rest.indexOf('__')
  if (separator <= 0 || separator >= rest.length - 2) return null

  const pluginName = rest.slice(0, separator)
  const toolName = rest.slice(separator + 2)
  if (pluginName !== plugin) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(toolName)) return null

  return `${prefix}${pluginName}__${toolName}`
}
