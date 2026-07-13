import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ArrowLeft, Bot, MoreHorizontal, Edit3, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { defaultThinkingLevelForModel, getConfiguredModels, initializePiStorage, loadDefaultOptions, loadInitialConfiguredModel } from '@/lib/pi-chat'

type RiskLevel = 'safe' | 'dangerous'

type AgentModelRef =
  | { mode: 'inherit' }
  | { mode: 'fixed'; provider: string; modelId: string; api?: string; baseUrl?: string }

type AgentThinkingLevel = 'inherit' | ThinkingLevel

type AgentProfile = {
  id: string
  name: string
  label: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  maxRuntimeMs?: number
  maxToolCalls?: number
  enabledAsSubagent: boolean
  builtin?: boolean
  readonly?: boolean
  source?: string
  model?: AgentModelRef
  thinkingLevel?: AgentThinkingLevel
  capabilityPolicy?: string
  relativePath?: string
  updatedAt?: string
}

type AvailableTool = {
  name: string
  label: string
  description: string
  riskLevel: RiskLevel
}

type AgentFormState = {
  name: string
  label: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  maxRuntimeMs: string
  maxToolCalls: string
  enabledAsSubagent: boolean
  modelMode: 'inherit' | 'fixed'
  fixedModelValue: string
  thinkingLevel: AgentThinkingLevel
}

type GeneratedAgentFields = Pick<AgentFormState, 'name' | 'label' | 'description' | 'systemPrompt'>
type AnyModel = Model<Api>
type AgentMenuPosition = { left: number; top: number }

const agentMenuWidth = 144
const agentMenuHeight = 82
const agentMenuGap = 4
const agentMenuMargin = 8

function modelOptionValue(model: AnyModel) {
  return JSON.stringify({
    provider: model.provider,
    modelId: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
  })
}

function modelRefFromOption(value: string): AgentModelRef {
  if (!value) return { mode: 'inherit' }
  try {
    const parsed = JSON.parse(value)
    return {
      mode: 'fixed',
      provider: String(parsed.provider || ''),
      modelId: String(parsed.modelId || ''),
      api: parsed.api ? String(parsed.api) : undefined,
      baseUrl: parsed.baseUrl ? String(parsed.baseUrl) : undefined,
    }
  } catch {
    return { mode: 'inherit' }
  }
}

function modelRefToOption(model?: AgentModelRef) {
  if (!model || model.mode !== 'fixed') return ''
  return JSON.stringify({
    provider: model.provider,
    modelId: model.modelId,
    api: model.api,
    baseUrl: model.baseUrl,
  })
}

function modelLabel(model: AnyModel) {
  return model.name || `${model.provider}/${model.id}`
}

function defaultAgentForm(): AgentFormState {
  return {
    name: '',
    label: '',
    description: '',
    systemPrompt: '',
    allowedTools: ['read_file', 'grep_files'],
    maxRuntimeMs: '1800000',
    maxToolCalls: '300',
    enabledAsSubagent: true,
    modelMode: 'inherit',
    fixedModelValue: '',
    thinkingLevel: 'inherit',
  }
}

function agentFormFromProfile(agent: AgentProfile): AgentFormState {
  return {
    name: agent.name,
    label: agent.label,
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt ?? '',
    allowedTools: agent.allowedTools ?? [],
    maxRuntimeMs: String(agent.maxRuntimeMs ?? 1800000),
    maxToolCalls: String(agent.maxToolCalls ?? 300),
    enabledAsSubagent: agent.enabledAsSubagent,
    modelMode: agent.model?.mode === 'fixed' ? 'fixed' : 'inherit',
    fixedModelValue: modelRefToOption(agent.model),
    thinkingLevel: agent.thinkingLevel ?? 'inherit',
  }
}

function buildAgentPayload(form: AgentFormState) {
  return {
    name: form.name.trim().toLowerCase(),
    label: form.label.trim(),
    description: form.description.trim(),
    systemPrompt: form.systemPrompt.trim(),
    allowedTools: form.allowedTools,
    maxRuntimeMs: Number(form.maxRuntimeMs || 1800000),
    maxToolCalls: Number(form.maxToolCalls || 300),
    enabledAsSubagent: form.enabledAsSubagent,
    model: form.modelMode === 'fixed' ? modelRefFromOption(form.fixedModelValue) : { mode: 'inherit' },
    thinkingLevel: form.thinkingLevel,
  }
}

function agentFormIsValid(form: AgentFormState) {
  return Boolean(form.name.trim() && form.label.trim() && form.allowedTools.length > 0)
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || '请求失败')
  return payload as T
}

export function AgentProfilesPage() {
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([])
  const [availableTools, setAvailableTools] = useState<AvailableTool[]>([])
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [agentForm, setAgentForm] = useState<AgentFormState>(() => defaultAgentForm())
  const [agentLoading, setAgentLoading] = useState(false)
  const [aiFillInstruction, setAiFillInstruction] = useState('')
  const [aiFillLoading, setAiFillLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<AnyModel>()
  const [configuredModels, setConfiguredModels] = useState<AnyModel[]>([])
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const [error, setError] = useState('')
  const [openMenuProfileId, setOpenMenuProfileId] = useState<string | null>(null)
  const [agentMenuPosition, setAgentMenuPosition] = useState<AgentMenuPosition | null>(null)

  async function loadAgentProfiles() {
    const [agentsPayload, toolsPayload] = await Promise.all([
      requestJson<{ agents: AgentProfile[] }>('/api/agent-profiles'),
      requestJson<{ tools: AvailableTool[] }>('/api/agent-profiles/available-tools'),
    ])
    setAgentProfiles(agentsPayload.agents)
    setAvailableTools(toolsPayload.tools)
  }

  useEffect(() => {
    let cancelled = false
    async function loadInitialAgents() {
      try {
        const [agentsPayload, toolsPayload] = await Promise.all([
          requestJson<{ agents: AgentProfile[] }>('/api/agent-profiles'),
          requestJson<{ tools: AvailableTool[] }>('/api/agent-profiles/available-tools'),
        ])
        if (cancelled) return
        setAgentProfiles(agentsPayload.agents)
        setAvailableTools(toolsPayload.tools)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    void loadInitialAgents()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDefaultModel() {
      try {
        const storage = await initializePiStorage()
        const configuredModels = await getConfiguredModels(storage)
        setConfiguredModels(configuredModels)
        const defaultOptions = await loadDefaultOptions(storage)
        const activeModel = defaultOptions.model ?? await loadInitialConfiguredModel(storage) ?? configuredModels[0]
        if (cancelled) return
        setSelectedModel(activeModel)
        setThinkingLevel(defaultOptions.thinkingLevel ?? defaultThinkingLevelForModel(activeModel))
      } catch {
        // AI fill will show a clear error if no model is available.
      }
    }
    void loadDefaultModel()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!openMenuProfileId) return
    const closeMenu = () => {
      setOpenMenuProfileId(null)
      setAgentMenuPosition(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuProfileId])

  const editingAgent = useMemo(() => agentProfiles.find((agent) => agent.id === editingAgentId) ?? null, [agentProfiles, editingAgentId])
  const openMenuAgent = useMemo(() => agentProfiles.find((agent) => agent.id === openMenuProfileId) ?? null, [agentProfiles, openMenuProfileId])
  const definitionReadonly = Boolean(editingAgent?.readonly)
  const modelReadonly = Boolean(editingAgent?.readonly && !editingAgent?.builtin)
  const selectedFixedModel = useMemo(
    () => configuredModels.find((model) => modelOptionValue(model) === agentForm.fixedModelValue),
    [agentForm.fixedModelValue, configuredModels],
  )
  const fixedModelDisablesThinking = agentForm.modelMode === 'fixed'
    && Boolean(selectedFixedModel)
    && selectedFixedModel?.reasoning !== true

  function toggleAgentMenu(event: ReactMouseEvent<HTMLButtonElement>, agentId: string) {
    event.stopPropagation()
    if (openMenuProfileId === agentId) {
      setOpenMenuProfileId(null)
      setAgentMenuPosition(null)
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(
      agentMenuMargin,
      Math.min(rect.right - agentMenuWidth, window.innerWidth - agentMenuWidth - agentMenuMargin),
    )
    const below = rect.bottom + agentMenuGap
    const above = rect.top - agentMenuGap - agentMenuHeight
    const top = below + agentMenuHeight <= window.innerHeight - agentMenuMargin
      ? below
      : Math.max(agentMenuMargin, above)

    setAgentMenuPosition({ left, top })
    setOpenMenuProfileId(agentId)
  }

  function updateAgentForm<K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) {
    setAgentForm((current) => ({ ...current, [key]: value }))
  }

  function toggleAgentTool(toolName: string) {
    setAgentForm((current) => ({
      ...current,
      allowedTools: current.allowedTools.includes(toolName)
        ? current.allowedTools.filter((name) => name !== toolName)
        : [...current.allowedTools, toolName],
    }))
  }

  function openCreateAgentDialog() {
    setEditingAgentId(null)
    setAgentForm(defaultAgentForm())
    setAiFillInstruction('')
    setError('')
    setAgentDialogOpen(true)
  }

  function openEditAgentDialog(agent: AgentProfile) {
    setEditingAgentId(agent.id)
    setAgentForm(agentFormFromProfile(agent))
    setAiFillInstruction('')
    setError('')
    setAgentDialogOpen(true)
  }

  function closeAgentDialog() {
    if (agentLoading || aiFillLoading) return
    setAgentDialogOpen(false)
    setEditingAgentId(null)
    setAgentForm(defaultAgentForm())
    setAiFillInstruction('')
  }

  async function handleAiFillAgent() {
    const instruction = aiFillInstruction.trim()
    if (!instruction) {
      setError(t('aiFillAgentInputRequired'))
      return
    }
    if (!selectedModel) {
      setError(t('aiFillAgentNoModel'))
      return
    }
    setAiFillLoading(true)
    setError('')
    try {
      const payload = await requestJson<{ agent: GeneratedAgentFields }>('/api/agent-profiles/ai-fill', {
        method: 'POST',
        body: JSON.stringify({ instruction, model: selectedModel, thinkingLevel }),
      })
      setAgentForm((current) => ({
        ...current,
        name: payload.agent.name,
        label: payload.agent.label,
        description: payload.agent.description,
        systemPrompt: payload.agent.systemPrompt,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiFillAgentFailed'))
    } finally {
      setAiFillLoading(false)
    }
  }

  async function handleSaveAgent() {
    if (!agentFormIsValid(agentForm)) return
    setAgentLoading(true)
    setError('')
    try {
      const payload = editingAgent?.builtin
        ? { model: agentForm.modelMode === 'fixed' ? modelRefFromOption(agentForm.fixedModelValue) : { mode: 'inherit' } }
        : buildAgentPayload({ ...agentForm, thinkingLevel: fixedModelDisablesThinking ? 'off' : agentForm.thinkingLevel })
      if (editingAgentId) {
        await requestJson(`/api/agent-profiles/${encodeURIComponent(editingAgentId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      } else {
        await requestJson('/api/agent-profiles', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      closeAgentDialog()
      await loadAgentProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setAgentLoading(false)
    }
  }

  async function toggleSubagentEnabled(agent: AgentProfile) {
    if (agent.builtin || agent.readonly) return
    const next = !agent.enabledAsSubagent
    const previous = agent.enabledAsSubagent
    setAgentProfiles((current) => current.map((item) => (item.id === agent.id ? { ...item, enabledAsSubagent: next } : item)))
    setOpenMenuProfileId(null)
    try {
      await requestJson(`/api/agent-profiles/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabledAsSubagent: next }),
      })
    } catch (err) {
      setAgentProfiles((current) => current.map((item) => (item.id === agent.id ? { ...item, enabledAsSubagent: previous } : item)))
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  async function deleteAgent(agent: AgentProfile) {
    if (agent.builtin || agent.readonly) return
    const confirmed = await showConfirm({
      description: t('confirmDeleteAgent'),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setError('')
    try {
      await requestJson(`/api/agent-profiles/${encodeURIComponent(agent.id)}`, { method: 'DELETE' })
      await loadAgentProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  if (agentDialogOpen) {
    return (
      <div className="quickforge-settings-stack">
        <div className="quickforge-settings-heading">
          <h3 className="quickforge-settings-title">
            {editingAgent?.builtin ? t('builtinAgentModelSettings') : editingAgent ? t('editAgent') : t('createAgent')}
            <InfoTip label={editingAgent?.builtin ? t('builtinAgentModelOnly') : editingAgent?.readonly ? t('readonlyAgentDescription') : t('agentsDescription')} />
          </h3>
        </div>

        <section className="quickforge-settings-section" aria-label={editingAgent ? t('editAgent') : t('createAgent')}>
          <div className="quickforge-settings-toolbar">
            <button className="quickforge-settings-button quickforge-settings-button-secondary" type="button" onClick={closeAgentDialog} disabled={agentLoading || aiFillLoading}>
              <ArrowLeft className="mr-2 size-4" />
              {t('back')}
            </button>
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">
                {editingAgent?.builtin ? t('builtinAgentModelSettings') : editingAgent ? t('editAgent') : t('createAgent')}
              </div>
              {editingAgent?.builtin ? <div className="quickforge-settings-row-description">{t('builtinAgentModelOnly')}</div> : editingAgent?.readonly ? <div className="quickforge-settings-row-description">{t('readonlyAgentDescription')}</div> : null}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles className="size-4 text-primary" />
                  {t('aiFillAgent')}
                  <InfoTip label={t('aiFillAgentDescription')} />
                </div>
                <textarea
                  className="min-h-20 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring disabled:opacity-60"
                  value={aiFillInstruction}
                  disabled={definitionReadonly || aiFillLoading}
                  onChange={(event) => setAiFillInstruction(event.target.value)}
                  placeholder={t('aiFillAgentPlaceholder')}
                />
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => void handleAiFillAgent()} disabled={definitionReadonly || aiFillLoading || !aiFillInstruction.trim()}>
                    <Sparkles className="mr-1 size-3.5" />{aiFillLoading ? t('aiFillAgentLoading') : t('aiFillAgent')}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground">
                  {t('agentName')}
                  <input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.name} disabled={definitionReadonly} onChange={(event) => updateAgentForm('name', event.target.value)} placeholder="reviewer" />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t('agentLabel')}
                  <input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.label} disabled={definitionReadonly} onChange={(event) => updateAgentForm('label', event.target.value)} placeholder={t('agentLabelPlaceholder')} />
                </label>
              </div>
              {editingAgent ? (
                <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">{t('agentSourcePath')}</div>
                  <div className="mt-1 truncate font-mono text-xs text-foreground" title={editingAgent.source ? `${editingAgent.source}${editingAgent.relativePath ? ` · ${editingAgent.relativePath}` : ''}` : undefined}>
                    {editingAgent.source ? `${editingAgent.source}${editingAgent.relativePath ? ` · ${editingAgent.relativePath}` : ''}` : editingAgent.builtin ? t('builtinAgent') : '-'}
                  </div>
                </div>
              ) : null}
              <label className="block text-sm font-medium text-foreground">
                {t('agentDescription')}
                <input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.description} disabled={definitionReadonly} onChange={(event) => updateAgentForm('description', event.target.value)} />
              </label>
              <label className="block text-sm font-medium text-foreground">
                {t('agentSystemPrompt')}
                <textarea className="mt-1 min-h-36 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.systemPrompt} disabled={definitionReadonly} onChange={(event) => updateAgentForm('systemPrompt', event.target.value)} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground">
                  {t('agentModelMode')}
                  <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.modelMode} disabled={modelReadonly} onChange={(event) => updateAgentForm('modelMode', event.target.value as AgentFormState['modelMode'])}>
                    <option value="inherit">{t('agentModelInherit')}</option>
                    <option value="fixed">{t('agentModelFixed')}</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t('agentFixedModel')}
                  <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.fixedModelValue} disabled={modelReadonly || agentForm.modelMode !== 'fixed'} onChange={(event) => updateAgentForm('fixedModelValue', event.target.value)}>
                    <option value="">{t('agentModelInherit')}</option>
                    {configuredModels.map((model) => (
                      <option key={modelOptionValue(model)} value={modelOptionValue(model)}>{modelLabel(model)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-medium text-foreground">
                {t('agentThinkingLevel')}
                <select
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60"
                  value={fixedModelDisablesThinking && agentForm.thinkingLevel !== 'inherit' ? 'off' : agentForm.thinkingLevel}
                  disabled={definitionReadonly || fixedModelDisablesThinking}
                  onChange={(event) => updateAgentForm('thinkingLevel', event.target.value as AgentThinkingLevel)}
                >
                  <option value="inherit">{t('agentThinkingInherit')}</option>
                  <option value="off">{t('thinkingOff')}</option>
                  <option value="low">{t('thinkingLow')}</option>
                  <option value="medium">{t('thinkingMedium')}</option>
                  <option value="high">{t('thinkingHigh')}</option>
                  <option value="xhigh">{t('thinkingXHigh')}</option>
                </select>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {fixedModelDisablesThinking ? t('agentThinkingUnsupported') : t('agentThinkingDescription')}
                </span>
              </label>
              <div>
                <div className="mb-2 text-sm font-medium text-foreground">{t('allowedTools')}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableTools.map((tool) => (
                    <label key={tool.name} className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm disabled:opacity-60">
                      <input type="checkbox" className="mt-1" disabled={definitionReadonly} checked={agentForm.allowedTools.includes(tool.name)} onChange={() => toggleAgentTool(tool.name)} />
                      <span>
                        <span className="font-medium text-foreground">{tool.label}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{tool.name}</span>
                        {tool.riskLevel === 'dangerous' ? <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">{t('highRiskTool')}</span> : null}
                        <span className="mt-1 block text-xs text-muted-foreground">{tool.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground">
                  {t('maxRuntimeMs')}
                  <input type="number" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.maxRuntimeMs} disabled={definitionReadonly} onChange={(event) => updateAgentForm('maxRuntimeMs', event.target.value)} />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t('maxToolCalls')}
                  <input type="number" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.maxToolCalls} disabled={definitionReadonly} onChange={(event) => updateAgentForm('maxToolCalls', event.target.value)} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={agentForm.enabledAsSubagent} disabled={definitionReadonly} onChange={(event) => updateAgentForm('enabledAsSubagent', event.target.checked)} />
                {t('enabledAsSubagent')}
              </label>
              {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            </div>
          </div>

          <div className="quickforge-settings-divider flex justify-end gap-2 px-5 py-4">
            <Button variant="outline" onClick={closeAgentDialog} disabled={agentLoading || aiFillLoading}>{t('cancel')}</Button>
            <Button onClick={handleSaveAgent} disabled={agentLoading || aiFillLoading || modelReadonly || (!editingAgent?.builtin && !agentFormIsValid(agentForm)) || (agentForm.modelMode === 'fixed' && !agentForm.fixedModelValue)}>{t('save')}</Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('agentsTab')}>
        <div className="quickforge-settings-toolbar">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              <Bot className="size-4 text-primary" />
              {t('agentsTab')}
            </div>
            <div className="quickforge-settings-row-description">{t('agentsDescription')}</div>
          </div>
          <button className="quickforge-settings-button quickforge-settings-button-primary" type="button" onClick={openCreateAgentDialog}>{t('createAgent')}</button>
        </div>

        {error ? <div className="quickforge-settings-alert quickforge-settings-warning-attached">{error}</div> : null}

        {agentProfiles.length === 0 ? (
          <div className="quickforge-settings-empty-row">{t('loading')}</div>
        ) : agentProfiles.map((agent) => (
          <div
            key={agent.id}
            className="quickforge-settings-list-item quickforge-agent-profile-row"
            role="button"
            tabIndex={0}
            onClick={() => openEditAgentDialog(agent)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openEditAgentDialog(agent)
              }
            }}
          >
            <div className="quickforge-settings-list-item-main quickforge-agent-profile-row-main">
              <div className="quickforge-agent-profile-summary">
                <span className="quickforge-agent-profile-label" title={agent.label}>{agent.label}</span>
                {agent.description ? <span className="quickforge-agent-profile-description" title={agent.description}>{agent.description}</span> : null}
              </div>
            </div>
            <div className="quickforge-settings-list-item-actions" onClick={(event) => event.stopPropagation()}>
              <label className="quickforge-settings-switch" aria-disabled={agent.builtin || agent.readonly ? 'true' : 'false'} title={agent.enabledAsSubagent ? t('disableAsSubagent') : t('enableAsSubagent')}>
                <input
                  type="checkbox"
                  checked={agent.enabledAsSubagent}
                  disabled={agent.builtin || agent.readonly}
                  onChange={() => void toggleSubagentEnabled(agent)}
                />
                <span aria-hidden="true" />
              </label>
              <button
                className="quickforge-settings-icon-action"
                type="button"
                onClick={(event) => toggleAgentMenu(event, agent.id)}
                title={t('moreActions')}
                aria-label={t('moreActions')}
                aria-haspopup="menu"
                aria-expanded={openMenuProfileId === agent.id}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </section>

      {openMenuAgent && agentMenuPosition ? createPortal(
        <div
          className="fixed z-50 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-quickforge"
          style={{ left: agentMenuPosition.left, top: agentMenuPosition.top }}
          role="menu"
          aria-label={t('moreActions')}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            role="menuitem"
            disabled={openMenuAgent.readonly && !openMenuAgent.builtin}
            onClick={() => {
              setOpenMenuProfileId(null)
              setAgentMenuPosition(null)
              openEditAgentDialog(openMenuAgent)
            }}
          >
            <Edit3 className="size-3.5" />{openMenuAgent.builtin ? t('builtinAgentModelSettings') : t('editTask')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            role="menuitem"
            disabled={openMenuAgent.builtin || openMenuAgent.readonly}
            onClick={() => {
              setOpenMenuProfileId(null)
              setAgentMenuPosition(null)
              void deleteAgent(openMenuAgent)
            }}
          >
            <Trash2 className="size-3.5" />{t('delete')}
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
