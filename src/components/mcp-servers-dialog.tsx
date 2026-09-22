import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, FileJson, Loader2, Plus, Server } from 'lucide-react'
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

  const renderEditorTabs = () => (
    <div className="quickforge-settings-form-grid">
      <div className="quickforge-settings-segmented">
        <button
          className={`quickforge-settings-segmented-option${activeTab === 'form' ? ' quickforge-settings-segmented-option-active' : ''}`}
          type="button"
          aria-pressed={activeTab === 'form' ? 'true' : 'false'}
          onClick={() => switchTab('form')}
        >
          <Server className="size-4" />
          {t('mcpTabServer')}
        </button>
        <button
          className={`quickforge-settings-segmented-option${activeTab === 'json' ? ' quickforge-settings-segmented-option-active' : ''}`}
          type="button"
          aria-pressed={activeTab === 'json' ? 'true' : 'false'}
          onClick={() => switchTab('json')}
        >
          <FileJson className="size-4" />
          {t('mcpTabJson')}
        </button>
      </div>
    </div>
  )

  // ===== 编辑视图 =====
  if (editMode) {
    return (
      <section className={cn('quickforge-settings-section', className)} aria-label={isEdit ? t('mcpEditServer') : t('mcpAddServer')}>
        <div className="quickforge-settings-toolbar">
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary"
            type="button"
            onClick={exitEditMode}
            disabled={saving}
          >
            <ArrowLeft className="mr-2 size-4" />
            {t('back')}
          </button>
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {isEdit ? t('mcpEditServer') : t('mcpAddServer')}
              <InfoTip label={t('mcpServersDescription')} />
            </div>
          </div>
        </div>

        {error ? <div className="quickforge-settings-alert quickforge-settings-warning-attached">{error}</div> : null}

        {renderEditorTabs()}

        {activeTab === 'form' ? (
          <McpServerForm
            value={draft}
            onChange={onDraftChange}
            isEdit={isEdit}
            disabled={saving}
          />
        ) : (
          <div className="quickforge-settings-form-grid">
            <div className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">
                {t('mcpTabJson')}
                <InfoTip label={t('mcpImportConfigDescription')} />
              </span>
              <textarea
                className="quickforge-settings-textarea quickforge-settings-mono min-h-96"
                value={jsonText}
                onChange={(event) => onJsonTextChange(event.target.value)}
                spellCheck={false}
                disabled={saving}
              />
              {jsonError ? <div className="quickforge-settings-alert">{jsonError}</div> : null}
            </div>
          </div>
        )}

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main" />
          <div className="quickforge-settings-row-control">
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              onClick={exitEditMode}
              disabled={saving}
            >
              {t('cancel')}
            </button>
            <button
              className="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              onClick={() => { void saveServer() }}
              disabled={saving || !canSave}
            >
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t('save')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ===== 服务器列表视图（默认） =====
  return (
    <section className={cn('quickforge-settings-section', className)} aria-label={t('mcpConfiguredServers')}>
      <div className="quickforge-settings-toolbar">
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">
            <Server className="size-4 text-primary" />
            {t('mcpConfiguredServers')}
            <InfoTip label={t('mcpServersDescription')} />
          </div>
          <div className="quickforge-settings-meta">
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('mcpServersCount', { count: servers.length })}</span>
          </div>
        </div>
        <button
          className="quickforge-settings-button quickforge-settings-button-primary"
          type="button"
          onClick={startAdd}
        >
          <Plus className="mr-2 size-4" />
          {t('mcpAddServer')}
        </button>
      </div>

      {error ? <div className="quickforge-settings-alert quickforge-settings-warning-attached">{error}</div> : null}

      {loading && servers.length === 0 ? (
        <div className="quickforge-settings-empty-row inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : servers.length === 0 ? (
        <div className="quickforge-settings-empty-row">{t('mcpNoServersDescription')}</div>
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
    </section>
  )
}
