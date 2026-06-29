import { useEffect, useMemo, useState } from 'react'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { Bot, MoreHorizontal, Edit3, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { defaultThinkingLevelForModel, getConfiguredModels, initializePiStorage, loadDefaultOptions, loadInitialConfiguredModel } from '@/lib/pi-chat'

type RiskLevel = 'safe' | 'dangerous'

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
}

type GeneratedAgentFields = Pick<AgentFormState, 'name' | 'label' | 'description' | 'systemPrompt'>
type AnyModel = Model<Api>

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
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const [error, setError] = useState('')
  const [openMenuProfileId, setOpenMenuProfileId] = useState<string | null>(null)

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
    const closeMenu = () => setOpenMenuProfileId(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [openMenuProfileId])

  const editingAgent = useMemo(() => agentProfiles.find((agent) => agent.id === editingAgentId) ?? null, [agentProfiles, editingAgentId])

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
      const payload = buildAgentPayload(agentForm)
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Bot className="size-5" />
            </div>
            <div>
              <h1 className="inline-flex items-center gap-1.5 text-lg font-semibold text-foreground">
                {t('agentsTab')}
                <InfoTip label={t('agentsDescription')} />
              </h1>
            </div>
          </div>
          <Button onClick={openCreateAgentDialog}>{t('createAgent')}</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {error && !agentDialogOpen ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          <div className="grid gap-4 md:grid-cols-2">
            {agentProfiles.map((agent) => (
              <div key={agent.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className={cn('truncate text-sm font-medium', agent.enabledAsSubagent ? 'text-foreground/90' : 'text-muted-foreground')}>{agent.label}</h3>
                      {agent.builtin ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t('builtinAgent')}</span> : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{agent.name}</p>
                    {agent.source && !agent.builtin ? <p className="mt-1 text-xs text-muted-foreground">{agent.source}{agent.relativePath ? ` · ${agent.relativePath}` : ''}</p> : null}
                    <p className="mt-2 text-sm text-muted-foreground">{agent.description || t('noDescription')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={agent.enabledAsSubagent}
                      disabled={agent.builtin || agent.readonly}
                      className={cn('relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', agent.enabledAsSubagent ? 'bg-emerald-500' : 'bg-muted-foreground/30')}
                      onClick={() => void toggleSubagentEnabled(agent)}
                      title={agent.enabledAsSubagent ? t('disableAsSubagent') : t('enableAsSubagent')}
                    >
                      <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', agent.enabledAsSubagent ? 'translate-x-5' : 'translate-x-0')} />
                    </button>
                    <div className="relative">
                      <Button variant="ghost" size="icon" onClick={() => setOpenMenuProfileId(openMenuProfileId === agent.id ? null : agent.id)} title={t('moreActions')}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                      {openMenuProfileId === agent.id ? (
                        <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-quickforge">
                          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={agent.builtin || agent.readonly} onClick={() => { setOpenMenuProfileId(null); openEditAgentDialog(agent) }}>
                            <Edit3 className="size-3.5" />{t('editTask')}
                          </button>
                          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={agent.builtin || agent.readonly} onClick={() => { setOpenMenuProfileId(null); void deleteAgent(agent) }}>
                            <Trash2 className="size-3.5" />{t('delete')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {agent.allowedTools.map((toolName) => (
                    <span key={toolName} className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{toolName}</span>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>{t('maxRuntimeMs')}{agent.maxRuntimeMs ?? '-'}</span>
                  <span>{t('maxToolCalls')}{agent.maxToolCalls ?? '-'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {agentDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAgentDialog() }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge" onMouseDown={(event) => event.stopPropagation()}>
            <div className="shrink-0 border-b border-border px-5 py-4">
              <h2 className="text-base font-medium text-foreground">{editingAgent ? t('editAgent') : t('createAgent')}</h2>
              {editingAgent?.readonly ? <p className="mt-1 text-sm text-muted-foreground">{t('builtinAgentReadonly')}</p> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                    disabled={Boolean(editingAgent?.readonly) || aiFillLoading}
                    onChange={(event) => setAiFillInstruction(event.target.value)}
                    placeholder={t('aiFillAgentPlaceholder')}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => void handleAiFillAgent()} disabled={Boolean(editingAgent?.readonly) || aiFillLoading || !aiFillInstruction.trim()}>
                      <Sparkles className="mr-1 size-3.5" />{aiFillLoading ? t('aiFillAgentLoading') : t('aiFillAgent')}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-foreground">
                    {t('agentName')}
                    <input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.name} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('name', event.target.value)} placeholder="reviewer" />
                  </label>
                  <label className="block text-sm font-medium text-foreground">
                    {t('agentLabel')}
                    <input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.label} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('label', event.target.value)} placeholder={t('agentLabelPlaceholder')} />
                  </label>
                </div>
                <label className="block text-sm font-medium text-foreground">
                  {t('agentDescription')}
                  <input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.description} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('description', event.target.value)} />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t('agentSystemPrompt')}
                  <textarea className="mt-1 min-h-36 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.systemPrompt} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('systemPrompt', event.target.value)} />
                </label>
                <div>
                  <div className="mb-2 text-sm font-medium text-foreground">{t('allowedTools')}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availableTools.map((tool) => (
                      <label key={tool.name} className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm disabled:opacity-60">
                        <input type="checkbox" className="mt-1" disabled={Boolean(editingAgent?.readonly)} checked={agentForm.allowedTools.includes(tool.name)} onChange={() => toggleAgentTool(tool.name)} />
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
                    <input type="number" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.maxRuntimeMs} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('maxRuntimeMs', event.target.value)} />
                  </label>
                  <label className="block text-sm font-medium text-foreground">
                    {t('maxToolCalls')}
                    <input type="number" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60" value={agentForm.maxToolCalls} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('maxToolCalls', event.target.value)} />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={agentForm.enabledAsSubagent} disabled={Boolean(editingAgent?.readonly)} onChange={(event) => updateAgentForm('enabledAsSubagent', event.target.checked)} />
                  {t('enabledAsSubagent')}
                </label>
                {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
              </div>
            </div>
            <div className="shrink-0 border-t border-border px-5 py-4">
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeAgentDialog} disabled={agentLoading || aiFillLoading}>{t('cancel')}</Button>
                <Button onClick={handleSaveAgent} disabled={agentLoading || aiFillLoading || Boolean(editingAgent?.readonly) || !agentFormIsValid(agentForm)}>{t('save')}</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
