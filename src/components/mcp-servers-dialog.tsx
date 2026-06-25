import { useCallback, useEffect, useState } from 'react'
import { FileJson, Loader2, Plug, Plus, RefreshCw, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import type { McpServer, McpServersPayload } from '@/lib/types/mcp'
import { McpServerCard } from '@/components/mcp/mcp-server-card'
import {
  McpServerForm,
} from '@/components/mcp/mcp-server-form'
import { InfoTip } from '@/components/ui/info-tip'
import { McpImportPanel } from '@/components/mcp/mcp-import-panel'
import {
  emptyMcpDraft,
  draftToJson,
  jsonToDraft,
  serverToDraft,
  type McpServerFormData,
} from '@/lib/mcp-helpers'

type McpServersDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type EditorTab = 'form' | 'json'

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

export function McpServersDialog({ open, onOpenChange }: McpServersDialogProps) {
  const [servers, setServers] = useState<McpServer[]>([])
  // Bulk import text (idle mode)
  const [configText, setConfigText] = useState(exampleJson)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [togglingNames, setTogglingNames] = useState<Set<string>>(new Set())
  const [reconnectingName, setReconnectingName] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Editor state (edit mode)
  const [editMode, setEditMode] = useState(false)
  const [editTarget, setEditTarget] = useState<McpServer | null>(null)
  const [draft, setDraft] = useState<McpServerFormData>(emptyMcpDraft)
  const [activeTab, setActiveTab] = useState<EditorTab>('form')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  const busy = saving || importing

  const applyServers = useCallback((payload: McpServersPayload | null | undefined) => {
    setServers(payload?.servers ?? [])
  }, [])

  const loadServers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/mcp/servers')
      const payload = await readJsonResponse<McpServersPayload>(response)
      applyServers(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [applyServers])

  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(() => {
      void loadServers()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, loadServers])

  // When switching to the JSON tab, refresh jsonText from the current draft so
  // the two views always show the same data.
  if (!open) return null

  const switchTab = (tab: EditorTab) => {
    if (tab === 'json') {
      // Refresh jsonText from the current draft so both views share one data source.
      setJsonText(draftToJson(draft))
      setJsonError('')
    }
    setActiveTab(tab)
  }

  const startAdd = () => {
    setEditTarget(null)
    setDraft(emptyMcpDraft())
    setActiveTab('form')
    setEditMode(true)
    setError('')
  }

  const startEdit = (server: McpServer) => {
    const data = serverToDraft(server)
    setEditTarget(server)
    setDraft(data)
    setJsonText(draftToJson(data))
    setJsonError('')
    setActiveTab('form')
    setEditMode(true)
    setError('')
  }

  const exitEditMode = () => {
    setEditMode(false)
    setEditTarget(null)
    setJsonText('')
    setJsonError('')
    setError('')
  }

  const onDraftChange = (next: McpServerFormData) => {
    setDraft(next)
  }

  const onJsonTextChange = (text: string) => {
    setJsonText(text)
    // Try to sync back into draft so the form tab stays in sync.
    try {
      const parsed = jsonToDraft(text)
      // Preserve the name field if the JSON doesn't carry one (user editing name in form)
      setDraft((prev) => ({ ...parsed, name: parsed.name || prev.name }))
      setJsonError('')
    } catch (err) {
      // Invalid JSON — keep draft as-is, just flag the error visually.
      setJsonError(err instanceof Error ? err.message : t('mcpInvalidJson'))
    }
  }

  const importConfig = async (mode: 'merge' | 'replace') => {
    if (importing) return
    if (mode === 'replace') {
      const confirmed = await showConfirm({
        description: t('mcpReplaceConfirm'),
        confirmLabel: t('mcpReplaceAll'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }
    setImporting(true)
    setError('')
    try {
      const config = validateMcpJson(configText)
      const response = await fetch('/api/mcp/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, ...(config as Record<string, unknown>) }),
      })
      const payload = await readJsonResponse<McpServersPayload>(response)
      applyServers(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpSaveFailed'))
    } finally {
      setImporting(false)
    }
  }

  const saveServer = async () => {
    if (saving) return
    // If the user has an invalid JSON in the json tab, block saving.
    if (jsonError && activeTab === 'json') {
      setError(jsonError)
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/mcp/servers', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ server: { ...draft, enabled: editTarget?.enabled ?? true } }),
      })
      const payload = await readJsonResponse<McpServersPayload>(response)
      applyServers(payload)
      exitEditMode()
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
      applyServers(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpDeleteFailed'))
    }
  }

  const toggleServerEnabled = async (server: McpServer) => {
    if (togglingNames.has(server.name)) return
    setTogglingNames((prev) => new Set(prev).add(server.name))
    setError('')
    try {
      const response = await fetch(`/api/mcp/servers/${encodeURIComponent(server.name)}/enabled`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      })
      const payload = await readJsonResponse<McpServersPayload>(response)
      applyServers(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpSaveFailed'))
    } finally {
      setTogglingNames((prev) => {
        const next = new Set(prev)
        next.delete(server.name)
        return next
      })
    }
  }

  const reconnectAll = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/mcp/reconnect', { method: 'POST' })
      const payload = await readJsonResponse<McpServersPayload>(response)
      applyServers(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpReconnectFailed'))
    } finally {
      setLoading(false)
    }
  }

  const reconnectServer = async (name: string) => {
    if (reconnectingName) return
    setReconnectingName(name)
    setError('')
    try {
      const response = await fetch(`/api/mcp/reconnect/${encodeURIComponent(name)}`, { method: 'POST' })
      const payload = await readJsonResponse<McpServersPayload>(response)
      applyServers(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpReconnectFailed'))
    } finally {
      setReconnectingName(null)
    }
  }

  const isEdit = Boolean(editTarget)
  const canSave = Boolean(draft.name.trim()) && Boolean(draft.transport === 'stdio' ? draft.command.trim() : draft.url.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-servers-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false)
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
          <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full text-muted-foreground" onClick={() => onOpenChange(false)} disabled={busy} aria-label={t('close')}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          <div className="grid gap-4 lg:grid-cols-[1fr_28rem]">
            {/* Left: server list (always visible) */}
            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground/90">{t('mcpConfiguredServers')}</h3>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={startAdd} disabled={editMode && !isEdit}>
                    <Plus className="mr-1.5 size-3.5" />
                    {t('mcpAddServer')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={reconnectAll} disabled={loading}>
                    {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
                    {t('mcpReconnect')}
                  </Button>
                </div>
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
                  <McpServerCard
                    key={server.name}
                    server={server}
                    toggling={togglingNames.has(server.name)}
                    reconnecting={reconnectingName === server.name}
                    onToggle={(target) => { void toggleServerEnabled(target) }}
                    onEdit={startEdit}
                    onDelete={(name) => { void deleteServer(name) }}
                    onReconnect={(name) => { void reconnectServer(name) }}
                  />
                ))
              )}
            </div>

            {/* Right: editor — edit mode (form⇄json) or idle mode (bulk import) */}
            <div className="flex min-h-0 flex-col rounded-lg border border-border">
              {editMode ? (
                <>
                  <div className="flex border-b border-border">
                    <button
                      type="button"
                      onClick={() => switchTab('form')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
                        activeTab === 'form'
                          ? 'border-b-2 border-primary text-foreground/90 -mb-px'
                          : 'text-muted-foreground/60 hover:text-foreground/85',
                      )}
                    >
                      <Server className="size-3.5" />
                      {t('mcpTabServer')}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchTab('json')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
                        activeTab === 'json'
                          ? 'border-b-2 border-primary text-foreground/90 -mb-px'
                          : 'text-muted-foreground/60 hover:text-foreground/85',
                      )}
                    >
                      <FileJson className="size-3.5" />
                      {t('mcpTabJson')}
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {activeTab === 'form' ? (
                      <McpServerForm
                        value={draft}
                        onChange={onDraftChange}
                        isEdit={isEdit}
                        disabled={saving}
                      />
                    ) : (
                      <div className="space-y-2 p-3">
                        <textarea
                          className="min-h-96 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
                          value={jsonText}
                          onChange={(event) => onJsonTextChange(event.target.value)}
                          spellCheck={false}
                        />
                        {jsonError ? (
                          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{jsonError}</div>
                        ) : null}
                        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/90">
                          {t('mcpTabJson')}
                          <InfoTip label={t('mcpImportConfigDescription')} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 border-t border-border p-3">
                    <Button type="button" variant="outline" size="sm" onClick={exitEditMode} disabled={saving}>{t('cancel')}</Button>
                    <Button type="button" size="sm" onClick={() => { void saveServer() }} disabled={saving || !canSave}>
                      {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                      {t('save')}
                    </Button>
                  </div>
                </>
              ) : (
                <McpImportPanel
                  configText={configText}
                  onConfigTextChange={setConfigText}
                  onImport={(mode) => { void importConfig(mode) }}
                  onUseExample={() => { setConfigText(exampleJson); setError('') }}
                  saving={importing}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
