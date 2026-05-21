import { useEffect, useState } from 'react'
import { Loader2, Plug, Plus, RefreshCw, Trash2, X, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

type McpServer = {
  name: string
  enabled: boolean
  transport: 'stdio' | 'sse' | 'http'
  url?: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  status?: string
  error?: string | null
  connectedAt?: string | null
  toolCount?: number
  tools?: Array<{ name: string; quickForgeName: string; description?: string }>
}

type McpServersDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type McpServersPayload = {
  servers: McpServer[]
}

const exampleJson = `{
  "mcpServers": {
    "zai-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@z_ai/mcp-server"
      ],
      "env": {
        "Z_AI_API_KEY": "${'${Z_AI_API_KEY}'}",
        "Z_AI_MODE": "ZHIPU"
      }
    }
  }
}`

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validateMcpJson(value: string) {
  let payload: unknown
  try {
    payload = JSON.parse(value)
  } catch {
    throw new Error(t('mcpInvalidJson'))
  }
  if (!isRecord(payload) || !isRecord(payload.mcpServers)) throw new Error(t('mcpInvalidConfigJson'))

  const entries = Object.entries(payload.mcpServers)
  if (entries.length === 0) throw new Error(t('mcpEmptyConfigJson'))
  for (const [name, config] of entries) {
    if (!/^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) throw new Error(t('mcpInvalidServerName', { name }))
    if (!isRecord(config)) throw new Error(t('mcpInvalidServerConfig', { name }))
    const transport = String(config.transport || config.type || 'stdio')
    if (!['stdio', 'http', 'sse'].includes(transport)) throw new Error(t('mcpInvalidTransport', { name }))
    if (transport === 'stdio' && typeof config.command !== 'string') throw new Error(t('mcpMissingCommand', { name }))
    if (transport !== 'stdio' && typeof config.url !== 'string') throw new Error(t('mcpMissingUrl', { name }))
    if (config.args !== undefined && !Array.isArray(config.args)) throw new Error(t('mcpArgsMustBeArray', { name }))
    if (config.env !== undefined && !isRecord(config.env)) throw new Error(t('mcpEnvMustBeObject', { name }))
    if (config.headers !== undefined && !isRecord(config.headers)) throw new Error(t('mcpHeadersMustBeObject', { name }))
  }

  return payload
}

function serverToJson(server: McpServer) {
  const config: Record<string, unknown> = {
    type: server.transport || 'stdio',
    enabled: server.enabled,
  }
  if (server.transport === 'stdio') {
    config.command = server.command
    config.args = server.args || []
    if (server.cwd) config.cwd = server.cwd
    if (server.env && Object.keys(server.env).length > 0) config.env = server.env
  } else {
    config.url = server.url || ''
    if (server.env && Object.keys(server.env).length > 0) config.headers = server.env
  }
  return JSON.stringify({ mcpServers: { [server.name]: config } }, null, 2)
}

function statusClass(status?: string) {
  if (status === 'connected') return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
  if (status === 'error') return 'bg-destructive/12 text-destructive'
  if (status === 'disabled') return 'bg-muted text-muted-foreground'
  return 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
}

export function McpServersDialog({ open, onOpenChange }: McpServersDialogProps) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [configText, setConfigText] = useState(exampleJson)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [togglingName, setTogglingName] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadServers = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/mcp/servers')
      const payload = await readJsonResponse<McpServersPayload>(response)
      setServers(Array.isArray(payload.servers) ? payload.servers : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpLoadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(() => {
      void loadServers()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const saveConfig = async (mode: 'merge' | 'replace') => {
    if (saving) return
    if (mode === 'replace') {
      const confirmed = await showConfirm({
        description: t('mcpReplaceConfirm'),
        confirmLabel: t('mcpReplaceAll'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }
    setSaving(true)
    setError('')
    try {
      const config = validateMcpJson(configText)
      const response = await fetch('/api/mcp/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, ...(config as Record<string, unknown>) }),
      })
      const payload = await readJsonResponse<McpServersPayload>(response)
      setServers(Array.isArray(payload.servers) ? payload.servers : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const deleteServer = async (name: string) => {
    const confirmed = await showConfirm({
      description: t('mcpDeleteConfirm', { name }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setError('')
    try {
      const response = await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const payload = await readJsonResponse<McpServersPayload>(response)
      setServers(Array.isArray(payload.servers) ? payload.servers : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpDeleteFailed'))
    }
  }

  const toggleServerEnabled = async (server: McpServer) => {
    if (togglingName) return
    setTogglingName(server.name)
    setError('')
    try {
      const response = await fetch(`/api/mcp/servers/${encodeURIComponent(server.name)}/enabled`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      })
      const payload = await readJsonResponse<McpServersPayload>(response)
      setServers(Array.isArray(payload.servers) ? payload.servers : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpSaveFailed'))
    } finally {
      setTogglingName(null)
    }
  }

  const reconnect = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/mcp/reconnect', { method: 'POST' })
      const payload = await readJsonResponse<McpServersPayload>(response)
      setServers(Array.isArray(payload.servers) ? payload.servers : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpReconnectFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-servers-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onOpenChange(false)
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-start gap-3 border-b border-border p-4">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
            <Plug className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="mcp-servers-title" className="text-base font-semibold text-foreground">{t('mcpServers')}</h2>
          </div>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full text-muted-foreground" onClick={() => onOpenChange(false)} disabled={saving} aria-label={t('close')}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          <div className="grid gap-4 lg:grid-cols-[1fr_28rem]">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground/90">{t('mcpConfiguredServers')}</h3>
                <Button type="button" variant="ghost" size="sm" onClick={reconnect} disabled={loading}>
                  {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
                  {t('mcpReconnect')}
                </Button>
              </div>

              {loading && servers.length === 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-border py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t('loading')}
                </div>
              ) : servers.length === 0 ? (
                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm text-muted-foreground/72">{t('mcpNoServersDescription')}</div>
              ) : (
                servers.map((server) => (
                  <div key={server.name} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-medium text-foreground/90">{server.name}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(server.status)}`}>{server.status || 'unknown'}</span>
                          <span className="text-[11px] text-muted-foreground/60">{t('mcpToolsCount', { count: server.toolCount ?? 0 })}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground/65">
                          {server.transport === 'stdio'
                            ? `${server.command} ${(server.args || []).join(' ')}`
                            : server.url}
                        </div>
                        {server.error ? <div className="mt-1 text-xs text-destructive">{server.error}</div> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={server.enabled}
                          disabled={togglingName === server.name}
                          className={cn('relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', server.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')}
                          onClick={() => { void toggleServerEnabled(server) }}
                          title={server.enabled ? t('pauseTask') : t('enable')}
                        >
                          <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', server.enabled ? 'translate-x-5' : 'translate-x-0')} />
                        </button>
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => { setConfigText(serverToJson(server)); setError('') }} aria-label={t('editTask')} title={t('editTask')}>
                          <Edit3 className="size-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => { void deleteServer(server.name) }} aria-label={t('delete')} title={t('delete')}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    {server.tools?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {server.tools.slice(0, 12).map((tool) => (
                          <span key={tool.quickForgeName} className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground/75" title={tool.quickForgeName}>{tool.name}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground/90">{t('mcpImportConfig')}</h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setConfigText(exampleJson); setError('') }}>{t('mcpUseExample')}</Button>
              </div>
              <div className="space-y-3">
                <p className="text-xs leading-5 text-muted-foreground/72">{t('mcpImportConfigDescription')}</p>
                <textarea
                  className="min-h-96 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
                  value={configText}
                  onChange={(event) => setConfigText(event.target.value)}
                  spellCheck={false}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" className="w-full" onClick={() => { void saveConfig('merge') }} disabled={saving || !configText.trim()}>
                    {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plus className="mr-1.5 size-4" />}
                    {t('mcpImportUpdate')}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => { void saveConfig('replace') }} disabled={saving || !configText.trim()}>
                    {t('mcpReplaceAll')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
