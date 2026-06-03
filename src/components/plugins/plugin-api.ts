export type PluginToolSummary = {
  name: string
  quickForgeName: string
  label?: string
  description?: string
}

export type PluginPathContribution = {
  path: string
}

export type QuickForgePlugin = {
  name: string
  displayName: string
  version: string
  description?: string
  dir: string
  sourceRoot?: string
  enabled: boolean
  enabledByDefault?: boolean
  status: 'loaded' | 'disabled' | 'error' | string
  error?: string | null
  permissions: string[]
  tools: PluginToolSummary[]
  skills?: PluginPathContribution[]
  commands?: PluginPathContribution[]
  config?: Record<string, unknown>
}

export type PluginsResponse = {
  searchPaths: string[]
  errors: Array<{ dir?: string; sourceRoot?: string; error: string }>
  plugins: QuickForgePlugin[]
  refreshedSessions?: Array<{ sessionId: string; ok: boolean; toolCount?: number; error?: string }>
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`)
  return data as T
}

export function loadPlugins() {
  return fetchJson<PluginsResponse>('/api/plugins')
}

export function reloadPlugins() {
  return fetchJson<PluginsResponse>('/api/plugins/reload', { method: 'POST' })
}

export function setPluginEnabled(name: string, enabled: boolean) {
  return fetchJson<PluginsResponse>(`/api/plugins/${encodeURIComponent(name)}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}
