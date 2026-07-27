import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, FileJson, Loader2, Plus, Server } from 'lucide-react'
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
import {
  emptyMcpDraft,
  draftToJson,
  jsonToDraft,
  serverToDraft,
  type McpServerFormData,
} from '@/lib/mcp-helpers'

type McpServersPanelProps = {
  active?: boolean
  className?: string
}

type EditorTab = 'form' | 'json'

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload as T
}

export function McpServersPanel({ active = true, className }: McpServersPanelProps) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
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
    if (!active) return undefined
    const timer = window.setTimeout(() => {
      void loadServers()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [active, loadServers])

  // When switching to the JSON tab, refresh jsonText from the current draft so
  // the two views always show the same data.
  if (!active) return null

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

  // ===== 编辑视图 =====
  if (editMode) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-background', className)}>
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={exitEditMode}>
              <ArrowLeft className="size-4" />
              {t('mcpConfiguredServers')}
            </button>
            <span className="text-sm font-medium text-foreground/90">{isEdit ? t('mcpEditServer') : t('mcpAddServer')}</span>
          </div>
        </div>
        {error ? <div className="m-6 mb-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-5xl space-y-5">
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
                <div className="space-y-2">
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

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" size="sm" onClick={exitEditMode} disabled={saving}>{t('cancel')}</Button>
              <Button type="button" size="sm" onClick={() => { void saveServer() }} disabled={saving || !canSave}>
                {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                {t('save')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== 服务器列表视图（默认） =====
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-background', className)}>
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground/90">{t('mcpConfiguredServers')}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={startAdd}>
            <Plus className="mr-1.5 size-3.5" />
            {t('mcpAddServer')}
          </Button>
        </div>
      </div>
      {error ? <div className="m-6 mb-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">

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
      </div>
    </div>
  )
}
