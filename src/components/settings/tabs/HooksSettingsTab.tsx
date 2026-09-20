import { useEffect, useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react'
import { getAppStorage } from '@/storage'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { showConfirm } from '@/components/ui/confirm-dialog'
import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  HOOK_EVENTS,
  HOOK_EVENT_LABEL_KEYS,
  HOOK_VARIABLES,
  MAX_HOOK_TIMEOUT_SECONDS,
  MIN_HOOK_TIMEOUT_SECONDS,
  clampHookTimeoutSeconds,
  isValidHttpUrl,
  loadHooksSettings,
  saveHooksSettings,
  type HookAction,
  type HookConfig,
  type HookEvent,
  type HookExecutionRecord,
  type HookWebhookHeader,
  type HooksSettings,
} from '@/lib/hooks-settings'
import { SettingsSwitch } from './shared'
import { SettingsNumberInput } from './SettingsNumberInput'

type HookDraft = {
  name: string
  events: HookEvent[]
  actionType: 'command' | 'webhook'
  command: string
  url: string
  method: 'POST' | 'GET'
  headers: HookWebhookHeader[]
  bodyTemplate: string
  timeoutInput: string
  silentOnFailure: boolean
}

type DraftErrors = { name?: boolean; events?: boolean; command?: boolean; url?: boolean }

const EMPTY_DRAFT: HookDraft = {
  name: '',
  events: [],
  actionType: 'command',
  command: '',
  url: '',
  method: 'POST',
  headers: [],
  bodyTemplate: '',
  timeoutInput: String(DEFAULT_HOOK_TIMEOUT_SECONDS),
  silentOnFailure: false,
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : undefined),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
  return payload as T
}

function createHookId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `hook_${uuid ? uuid.slice(0, 8) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`}`
}

function draftFromHook(hook: HookConfig): HookDraft {
  const action = hook.action
  return {
    name: hook.name,
    events: [...hook.events],
    actionType: action.type,
    command: action.type === 'command' ? action.command : '',
    url: action.type === 'webhook' ? action.url : '',
    method: action.type === 'webhook' ? action.method : 'POST',
    headers: action.type === 'webhook' && action.headers ? action.headers.map((header) => ({ ...header })) : [],
    bodyTemplate: action.type === 'webhook' && action.bodyTemplate ? action.bodyTemplate : '',
    timeoutInput: String(hook.timeoutSeconds),
    silentOnFailure: hook.silentOnFailure,
  }
}

function draftToHook(draft: HookDraft, id: string, enabled: boolean): HookConfig {
  const action: HookAction = draft.actionType === 'command'
    ? { type: 'command', command: draft.command.trim() }
    : {
      type: 'webhook',
      url: draft.url.trim(),
      method: draft.method,
      ...(draft.headers.some((header) => header.name.trim())
        ? { headers: draft.headers.filter((header) => header.name.trim()).map((header) => ({ name: header.name.trim(), value: header.value })) }
        : {}),
      ...(draft.bodyTemplate.trim() ? { bodyTemplate: draft.bodyTemplate } : {}),
    }
  return {
    id,
    name: draft.name.trim(),
    enabled,
    events: [...draft.events],
    action,
    timeoutSeconds: clampHookTimeoutSeconds(draft.timeoutInput),
    silentOnFailure: draft.silentOnFailure,
  }
}

function validateDraft(draft: HookDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.name.trim()) errors.name = true
  if (draft.events.length === 0) errors.events = true
  if (draft.actionType === 'command' && !draft.command.trim()) errors.command = true
  if (draft.actionType === 'webhook' && !isValidHttpUrl(draft.url.trim())) errors.url = true
  return errors
}

function hookActionSummary(hook: HookConfig): string {
  return hook.action.type === 'command' ? hook.action.command : `${hook.action.method} ${hook.action.url}`
}

function formatClockTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  return `${(ms / 1000).toFixed(1)}s`
}

export function HooksSettingsTab() {
  const [loading, setLoading] = useState(true)
  const [hooks, setHooks] = useState<HookConfig[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [executions, setExecutions] = useState<HookExecutionRecord[]>([])
  const [executionsLoading, setExecutionsLoading] = useState(true)
  const [executionsError, setExecutionsError] = useState('')
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingHookId, setEditingHookId] = useState<string | null>(null)
  const [draft, setDraft] = useState<HookDraft>(EMPTY_DRAFT)
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [webhookExtraOpen, setWebhookExtraOpen] = useState(false)
  const [savingHook, setSavingHook] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<HookExecutionRecord | null>(null)
  const [testError, setTestError] = useState('')

  const loadExecutions = async () => {
    setExecutionsLoading(true)
    setExecutionsError('')
    try {
      const payload = await requestJson<{ executions?: unknown }>('/api/hooks/executions')
      const records = Array.isArray(payload?.executions)
        ? payload.executions.filter((item): item is HookExecutionRecord => Boolean(item && typeof item === 'object'))
        : []
      setExecutions(records)
    } catch (err) {
      setExecutionsError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setExecutionsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        // 执行记录加载自管理错误状态，失败不阻断设置加载。
        const [settings] = await Promise.all([
          loadHooksSettings(getAppStorage()),
          loadExecutions().catch(() => undefined),
        ])
        if (cancelled) return
        setHooks(settings.hooks)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 乐观更新 + 失败回滚；返回是否保存成功（失败时已恢复原状态并展示错误）。
   * 总开关已从 UI 移除，enabled 恒为 true：存量 enabled=false 在下次保存时一并重置，
   * server 引擎继续按该字段过滤。 */
  const persist = async (next: HooksSettings, successMessage: string): Promise<boolean> => {
    const previousHooks = hooks
    setHooks(next.hooks)
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await saveHooksSettings(getAppStorage(), next)
      setMessage(successMessage)
      return true
    } catch (err) {
      setHooks(previousHooks)
      setError(err instanceof Error ? err.message : t('requestFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const updateHookEnabled = (hookId: string, next: boolean) => {
    const nextHooks = hooks.map((hook) => (hook.id === hookId ? { ...hook, enabled: next } : hook))
    void persist({ enabled: true, hooks: nextHooks }, t('hooksSaved'))
  }

  const deleteHook = async (hook: HookConfig) => {
    const confirmed = await showConfirm({
      title: t('hooksDeleteTitle'),
      description: t('hooksDeleteDescription', { name: hook.name }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    await persist({ enabled: true, hooks: hooks.filter((item) => item.id !== hook.id) }, t('hooksSaved'))
  }

  const resetEditorTransientState = () => {
    setDraftErrors({})
    setAdvancedOpen(false)
    setWebhookExtraOpen(false)
    setTestResult(null)
    setTestError('')
  }

  const openAddEditor = () => {
    setEditingHookId(null)
    setDraft(EMPTY_DRAFT)
    resetEditorTransientState()
    setEditorOpen(true)
  }

  const openEditEditor = (hook: HookConfig) => {
    setEditingHookId(hook.id)
    setDraft(draftFromHook(hook))
    resetEditorTransientState()
    setEditorOpen(true)
  }

  const closeEditor = () => {
    setEditorOpen(false)
  }

  const patchDraft = (patch: Partial<HookDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const clearDraftError = (key: keyof DraftErrors) => {
    setDraftErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
  }

  const toggleDraftEvent = (event: HookEvent) => {
    setDraft((current) => ({
      ...current,
      events: current.events.includes(event)
        ? current.events.filter((item) => item !== event)
        : [...current.events, event],
    }))
    clearDraftError('events')
  }

  const insertVariable = (variable: string) => {
    setDraft((current) => ({ ...current, command: current.command + variable }))
    clearDraftError('command')
  }

  const updateDraftHeader = (index: number, field: 'name' | 'value', value: string) => {
    setDraft((current) => ({
      ...current,
      headers: current.headers.map((header, i) => (i === index ? { ...header, [field]: value } : header)),
    }))
  }

  const addDraftHeader = () => {
    setDraft((current) => ({ ...current, headers: [...current.headers, { name: '', value: '' }] }))
  }

  const removeDraftHeader = (index: number) => {
    setDraft((current) => ({ ...current, headers: current.headers.filter((_, i) => i !== index) }))
  }

  const submitDraft = async () => {
    if (savingHook || testing) return
    const errors = validateDraft(draft)
    setDraftErrors(errors)
    if (errors.name || errors.events || errors.command || errors.url) return
    const nextHook = draftToHook(draft, editingHookId ?? createHookId(), true)
    const nextHooks = editingHookId
      ? hooks.map((hook) => (hook.id === editingHookId ? { ...hook, ...nextHook, enabled: hook.enabled } : hook))
      : [...hooks, nextHook]
    setSavingHook(true)
    try {
      const saved = await persist({ enabled: true, hooks: nextHooks }, t('hooksSaved'))
      if (saved) closeEditor()
    } finally {
      setSavingHook(false)
    }
  }

  const runTest = async () => {
    if (testing || savingHook) return
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      const hook = draftToHook(draft, editingHookId ?? 'test', true)
      const payload = await requestJson<{ execution?: HookExecutionRecord }>('/api/hooks/test', {
        method: 'POST',
        body: JSON.stringify({ hook }),
      })
      // server 返回 `{ execution }` 信封；缺失或非对象按请求失败处理。
      if (!payload?.execution || typeof payload.execution !== 'object') {
        throw new Error(t('requestFailed'))
      }
      setTestResult(payload.execution)
    } catch (err) {
      setTestError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  const modalTitle = editingHookId ? t('hooksEdit') : t('hooksAdd')
  const modalDescription = editingHookId ? t('hooksEditDescription') : t('hooksAddDescription')

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('hooksTab')}>
        <div className="quickforge-settings-list-header">
          <div>
            <div className="quickforge-settings-row-title">
              {t('hooksTab')}
              <InfoTip label={t('hooksTabInfo')} />
            </div>
          </div>
          <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">{t('hooksCount', { count: hooks.length })}</span>
        </div>

        {hooks.length === 0 ? (
          <div className="quickforge-settings-empty-row">{t('hooksEmpty')}</div>
        ) : hooks.map((hook) => (
          <div className="quickforge-settings-row" key={hook.id}>
            <div className="shrink-0 flex items-center">
              <SettingsSwitch
                checked={hook.enabled}
                onChange={(checked) => updateHookEnabled(hook.id, checked)}
                disabled={saving}
                aria-label={t('hooksEnabled')}
              />
            </div>
            <div className="quickforge-settings-row-main">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`quickforge-settings-row-title${hook.enabled ? '' : ' opacity-60'}`}>{hook.name}</span>
                {hook.events.map((event) => (
                  <span className="quickforge-settings-badge quickforge-settings-badge-muted" key={event}>
                    {t(HOOK_EVENT_LABEL_KEYS[event])}
                  </span>
                ))}
              </div>
              <code
                className="mt-1 block truncate font-mono text-xs text-muted-foreground"
                title={hookActionSummary(hook)}
              >{hookActionSummary(hook)}</code>
            </div>
            <div className="quickforge-settings-row-control quickforge-settings-icon-actions">
              <button
                type="button"
                className="quickforge-settings-icon-action"
                aria-label={t('hooksEditHook', { name: hook.name })}
                title={t('hooksEdit')}
                disabled={saving}
                onClick={() => openEditEditor(hook)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
                aria-label={t('hooksDeleteHook', { name: hook.name })}
                title={t('delete')}
                disabled={saving}
                onClick={() => void deleteHook(hook)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-5 py-3">
          <button
            type="button"
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            onClick={openAddEditor}
            disabled={saving}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t('hooksAdd')}
          </button>
        </div>
      </section>

      <section className="quickforge-settings-section" aria-label={t('hooksExecutions')}>
        <div className="quickforge-settings-list-header">
          <div>
            <div className="quickforge-settings-row-title">
              {t('hooksExecutions')}
              <InfoTip label={t('hooksExecutionsInfo')} />
            </div>
          </div>
        </div>

        {executionsError ? (
          <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{t('hooksExecutionsLoadFailed')}</span>
            <button
              type="button"
              className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
              onClick={() => void loadExecutions()}
            >{t('retry')}</button>
          </div>
        ) : executionsLoading ? (
          <div className="quickforge-settings-empty-row">{t('loading')}</div>
        ) : executions.length === 0 ? (
          <div className="quickforge-settings-empty-row">{t('hooksExecutionsEmpty')}</div>
        ) : executions.map((record) => {
          const failed = record.status !== 'success'
          const statusBadgeClass = record.status === 'success'
            ? 'quickforge-settings-badge-success'
            : record.status === 'error'
              ? 'quickforge-settings-badge-danger'
              : 'quickforge-settings-badge-warning'
          const statusLabel = record.status === 'success'
            ? t('hooksStatusSuccess')
            : record.status === 'error'
              ? t('hooksStatusError')
              : t('hooksStatusTimeout')
          const eventLabelKey = record.event === 'test' ? undefined : HOOK_EVENT_LABEL_KEYS[record.event]
          const expanded = expandedExecutionId === record.id
          return (
            <div className="border-b border-[color-mix(in_oklab,var(--border)_78%,transparent)] last:border-b-0" key={record.id}>
              <div className="flex min-h-12 flex-wrap items-center gap-3 px-5 py-2 transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[color-mix(in_oklab,var(--muted)_26%,transparent)]">
                <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground">{formatClockTime(record.startedAt)}</span>
                <span className="shrink-0 text-[0.8125rem] font-medium">{record.hookName}</span>
                <span className="quickforge-settings-badge quickforge-settings-badge-muted">
                  {eventLabelKey ? t(eventLabelKey) : record.event}
                </span>
                {record.test ? (
                  <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('hooksTestExecution')}</span>
                ) : null}
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{formatDuration(record.durationMs)}</span>
                <span className={`quickforge-settings-badge ${statusBadgeClass}`}>
                  <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current"></span>
                  {statusLabel}
                </span>
                {failed && record.output ? (
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] hover:text-foreground"
                    aria-expanded={expanded ? 'true' : 'false'}
                    onClick={() => setExpandedExecutionId(expanded ? null : record.id)}
                  >{expanded ? t('hooksHideOutput') : t('hooksViewOutput')}</button>
                ) : null}
              </div>
              {expanded && record.output ? (
                <pre className="quickforge-list-item-in mx-5 mb-3 overflow-x-auto rounded-[0.625rem] bg-[color-mix(in_oklab,var(--muted)_40%,transparent)] px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{record.output}</pre>
              ) : null}
            </div>
          )
        })}
      </section>

      {message ? <div className="quickforge-settings-message" role="status">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}

      {editorOpen ? (
        <div
          className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeEditor()
          }}
        >
          <div
            className="quickforge-dialog-panel-in flex max-h-[calc(100dvh-2.5rem)] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hooks-editor-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-5 py-3.5">
              <div className="min-w-0">
                <h2 className="text-[0.9375rem] font-[520]" id="hooks-editor-title">{modalTitle}</h2>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{modalDescription}</p>
              </div>
              <button
                type="button"
                className="quickforge-settings-icon-action"
                aria-label={t('close')}
                onClick={closeEditor}
                disabled={savingHook}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <form
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void submitDraft()
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label className="quickforge-settings-form-label" htmlFor="hooks-editor-name">{t('hooksFieldName')}</label>
                <input
                  id="hooks-editor-name"
                  className="quickforge-settings-input"
                  type="text"
                  autoComplete="off"
                  autoFocus
                  placeholder={t('hooksNamePlaceholder')}
                  value={draft.name}
                  aria-invalid={draftErrors.name ? 'true' : undefined}
                  onChange={(event) => {
                    patchDraft({ name: event.currentTarget.value })
                    clearDraftError('name')
                  }}
                />
                {draftErrors.name ? <p className="text-xs text-destructive">{t('hooksValidationErrorName')}</p> : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="quickforge-settings-form-label" id="hooks-editor-events-label">{t('hooksFieldEvents')}</span>
                <div
                  aria-invalid={draftErrors.events ? 'true' : undefined}
                  aria-labelledby="hooks-editor-events-label"
                  className={`flex flex-wrap gap-2 rounded-[0.625rem] border p-1 transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]${draftErrors.events ? ' border-destructive/50' : ' border-transparent'}`}
                  role="group"
                >
                  {HOOK_EVENTS.map((event) => {
                    const selected = draft.events.includes(event)
                    return (
                      <button
                        aria-pressed={selected ? 'true' : 'false'}
                        className={`rounded-lg border px-2.5 py-1 text-[0.8125rem] transition-[background-color,border-color,color] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97]${selected
                          ? ' border-[color-mix(in_oklab,var(--foreground)_25%,transparent)] bg-[color-mix(in_oklab,var(--muted)_70%,transparent)] font-medium text-foreground'
                          : ' border-border text-muted-foreground hover:border-[color-mix(in_oklab,var(--foreground)_20%,transparent)] hover:text-foreground'}`}
                        key={event}
                        onClick={() => toggleDraftEvent(event)}
                        type="button"
                      >{t(HOOK_EVENT_LABEL_KEYS[event])}</button>
                    )
                  })}
                </div>
                {draftErrors.events ? <p className="text-xs text-destructive">{t('hooksValidationErrorEvents')}</p> : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="quickforge-settings-form-label">{t('hooksFieldActionType')}</span>
                <div aria-label={t('hooksFieldActionType')} className="quickforge-settings-segmented" role="group">
                  <button
                    aria-pressed={draft.actionType === 'command' ? 'true' : 'false'}
                    className={`quickforge-settings-segmented-option${draft.actionType === 'command' ? ' quickforge-settings-segmented-option-active' : ''}`}
                    onClick={() => patchDraft({ actionType: 'command' })}
                    type="button"
                  >{t('hooksActionRunCommand')}</button>
                  <button
                    aria-pressed={draft.actionType === 'webhook' ? 'true' : 'false'}
                    className={`quickforge-settings-segmented-option${draft.actionType === 'webhook' ? ' quickforge-settings-segmented-option-active' : ''}`}
                    onClick={() => patchDraft({ actionType: 'webhook' })}
                    type="button"
                  >{t('hooksActionSendWebhook')}</button>
                </div>
              </div>

              {draft.actionType === 'command' ? (
                <div className="flex flex-col gap-1.5">
                  <label className="quickforge-settings-form-label" htmlFor="hooks-editor-command">{t('hooksFieldCommand')}</label>
                  <input
                    aria-invalid={draftErrors.command ? 'true' : undefined}
                    autoComplete="off"
                    className="quickforge-settings-input quickforge-settings-mono"
                    id="hooks-editor-command"
                    placeholder={t('hooksCommandPlaceholder')}
                    spellCheck={false}
                    type="text"
                    value={draft.command}
                    onChange={(event) => {
                      patchDraft({ command: event.currentTarget.value })
                      clearDraftError('command')
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[0.6875rem] text-muted-foreground">{t('hooksInsertVariable')}</span>
                    {HOOK_VARIABLES.map((variable) => (
                      <button
                        className="rounded-lg border border-border px-2 py-px font-mono text-[0.6875rem] text-muted-foreground transition-[background-color,border-color,color] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:border-[color-mix(in_oklab,var(--foreground)_20%,transparent)] hover:bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] hover:text-foreground active:scale-[0.97]"
                        key={variable}
                        onClick={() => insertVariable(variable)}
                        type="button"
                      >{variable}</button>
                    ))}
                  </div>
                  {draftErrors.command ? <p className="text-xs text-destructive">{t('hooksValidationErrorCommand')}</p> : null}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="quickforge-settings-form-label" htmlFor="hooks-editor-url">{t('hooksFieldUrl')}</label>
                    <input
                      aria-invalid={draftErrors.url ? 'true' : undefined}
                      autoComplete="off"
                      className="quickforge-settings-input quickforge-settings-mono"
                      id="hooks-editor-url"
                      placeholder={t('hooksUrlPlaceholder')}
                      spellCheck={false}
                      type="text"
                      value={draft.url}
                      onChange={(event) => {
                        patchDraft({ url: event.currentTarget.value })
                        clearDraftError('url')
                      }}
                    />
                    {draftErrors.url ? <p className="text-xs text-destructive">{t('hooksValidationErrorUrl')}</p> : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="quickforge-settings-form-label">{t('hooksFieldMethod')}</span>
                    <div aria-label={t('hooksFieldMethod')} className="quickforge-settings-segmented" role="group">
                      <button
                        aria-pressed={draft.method === 'POST' ? 'true' : 'false'}
                        className={`quickforge-settings-segmented-option${draft.method === 'POST' ? ' quickforge-settings-segmented-option-active' : ''}`}
                        onClick={() => patchDraft({ method: 'POST' })}
                        type="button"
                      >POST</button>
                      <button
                        aria-pressed={draft.method === 'GET' ? 'true' : 'false'}
                        className={`quickforge-settings-segmented-option${draft.method === 'GET' ? ' quickforge-settings-segmented-option-active' : ''}`}
                        onClick={() => patchDraft({ method: 'GET' })}
                        type="button"
                      >GET</button>
                    </div>
                  </div>

                  <div>
                    <button
                      aria-expanded={webhookExtraOpen ? 'true' : 'false'}
                      className="-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[color-mix(in_oklab,var(--muted)_55%,transparent)] hover:text-foreground"
                      onClick={() => setWebhookExtraOpen(!webhookExtraOpen)}
                      type="button"
                    >
                      {t('hooksCustomHeaderBody')}
                      <ChevronDown className={`size-3.5 transition-transform duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]${webhookExtraOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    {webhookExtraOpen ? (
                      <div className="mt-3 flex flex-col gap-3.5 pl-1">
                        <div className="flex flex-col gap-1.5">
                          <span className="quickforge-settings-form-label">{t('hooksHeaders')}</span>
                          {draft.headers.length === 0 ? <p className="text-xs text-muted-foreground">{t('hooksHeadersEmpty')}</p> : null}
                          {draft.headers.map((header, index) => (
                            <div className="flex items-center gap-2" key={index}>
                              <input
                                aria-label={t('hooksHeaderName')}
                                autoComplete="off"
                                className="quickforge-settings-input min-w-0 flex-1"
                                placeholder={t('hooksHeaderName')}
                                type="text"
                                value={header.name}
                                onChange={(event) => updateDraftHeader(index, 'name', event.currentTarget.value)}
                              />
                              <input
                                aria-label={t('hooksHeaderValue')}
                                autoComplete="off"
                                className="quickforge-settings-input min-w-0 flex-1"
                                placeholder={t('hooksHeaderValue')}
                                type="text"
                                value={header.value}
                                onChange={(event) => updateDraftHeader(index, 'value', event.currentTarget.value)}
                              />
                              <button
                                aria-label={t('hooksRemoveHeader')}
                                className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
                                onClick={() => removeDraftHeader(index)}
                                type="button"
                              >
                                <X className="size-4" aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                          <button
                            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact self-start"
                            onClick={addDraftHeader}
                            type="button"
                          >{t('hooksAddHeader')}</button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="quickforge-settings-form-label" htmlFor="hooks-editor-body">{t('hooksFieldBody')}</label>
                          <textarea
                            className="quickforge-settings-textarea quickforge-settings-mono"
                            id="hooks-editor-body"
                            placeholder={t('hooksBodyPlaceholder')}
                            rows={3}
                            spellCheck={false}
                            value={draft.bodyTemplate}
                            onChange={(event) => patchDraft({ bodyTemplate: event.currentTarget.value })}
                          ></textarea>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <div>
                <button
                  aria-expanded={advancedOpen ? 'true' : 'false'}
                  className="-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[color-mix(in_oklab,var(--muted)_55%,transparent)] hover:text-foreground"
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  type="button"
                >
                  {t('hooksAdvanced')}
                  <ChevronDown className={`size-3.5 transition-transform duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]${advancedOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {advancedOpen ? (
                  <div className="mt-3 flex flex-col gap-3.5 pl-1">
                    <div className="flex items-center gap-3">
                      <label className="quickforge-settings-form-label" htmlFor="hooks-editor-timeout">{t('hooksTimeoutSeconds')}</label>
                      <SettingsNumberInput
                        className="quickforge-settings-input quickforge-settings-number-input w-20"
                        id="hooks-editor-timeout"
                        max={MAX_HOOK_TIMEOUT_SECONDS}
                        min={MIN_HOOK_TIMEOUT_SECONDS}
                        value={draft.timeoutInput}
                        onCommit={(value) => patchDraft({ timeoutInput: String(clampHookTimeoutSeconds(value)) })}
                        onInput={(value) => patchDraft({ timeoutInput: value })}
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem]">
                      <input
                        checked={draft.silentOnFailure}
                        className="size-4"
                        onChange={(event) => patchDraft({ silentOnFailure: event.currentTarget.checked })}
                        type="checkbox"
                      />
                      {t('hooksSilentOnFailure')}
                    </label>
                  </div>
                ) : null}
              </div>

              {testError ? (
                <div className="quickforge-list-item-in rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive" role="alert">{testError}</div>
              ) : null}
              {testResult ? (
                <div
                  className={`quickforge-list-item-in rounded-lg px-3 py-2 font-mono text-xs${testResult.status === 'success' ? ' bg-[color-mix(in_oklab,#10b981_12%,transparent)] text-[color-mix(in_oklab,#047857_86%,var(--foreground))]' : ' bg-destructive/10 text-destructive'}`}
                  role="status"
                >
                  {testResult.status === 'success' ? t('hooksTestSuccess') : testResult.status === 'error' ? t('hooksTestFailed') : t('hooksStatusTimeout')}
                  {formatDuration(testResult.durationMs) ? ` · ${formatDuration(testResult.durationMs)}` : ''}
                  {typeof testResult.exitCode === 'number' ? ` · exit ${testResult.exitCode}` : ''}
                  {typeof testResult.httpStatus === 'number' ? ` · HTTP ${testResult.httpStatus}` : ''}
                  {testResult.output ? <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap">{testResult.output}</pre> : null}
                </div>
              ) : null}
            </form>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-5 py-3">
              <button
                className="quickforge-settings-button quickforge-settings-button-secondary"
                disabled={testing || savingHook}
                onClick={() => void runTest()}
                type="button"
              >{testing ? t('hooksTesting') : t('hooksTestRun')}</button>
              <div className="flex items-center gap-2">
                <button
                  className="quickforge-settings-button quickforge-settings-button-secondary"
                  disabled={savingHook}
                  onClick={closeEditor}
                  type="button"
                >{t('cancel')}</button>
                <button
                  className="quickforge-settings-button quickforge-settings-button-primary"
                  disabled={savingHook || testing}
                  onClick={() => void submitDraft()}
                  type="button"
                >{savingHook ? t('saving') : t('save')}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
