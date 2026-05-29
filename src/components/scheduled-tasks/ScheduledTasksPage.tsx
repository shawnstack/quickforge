import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { useEffect, useMemo, useState } from 'react'
import { Bot, Brain, CalendarClock, CheckCircle2, Clock3, Edit3, Eye, Folder, MoreHorizontal, Search, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { defaultThinkingLevelForModel, getConfiguredModels, initializePiStorage, loadDefaultOptions, loadInitialConfiguredModel } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'

type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
type TaskStatus = 'enabled' | 'paused' | 'running' | 'failed' | 'completed'
type RunStatus = 'running' | 'success' | 'failed'
type ActiveTab = 'tasks' | 'history'

type AgentProfile = {
  id: string
  name: string
  label: string
}

type ScheduledTaskRun = {
  id: string
  status: RunStatus
  trigger?: string
  result?: string
  aiResult?: string
  inputContent?: string
  errorMessage?: string
  warning?: string
  sessionId?: string
  scheduledAt?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  agentId?: string | null
  agentLabel?: string | null
}

type ScheduledTask = {
  id: string
  title: string
  instruction: string
  scheduleType: ScheduleType
  scheduleRule: string
  cronExpression?: string
  status: TaskStatus
  nextRunAt: string
  lastRunAt?: string
  lastSessionId?: string
  currentRunId?: string | null
  createdAt: string
  runs: ScheduledTaskRun[]
  projectName?: string
  projectId?: string | null
  agentId?: string | null
  model?: AnyModel
  thinkingLevel?: ThinkingLevel
}

type ScheduledTaskHistoryRun = ScheduledTaskRun & {
  taskId: string
  taskTitle: string
  scheduleRule?: string
  projectName?: string
}

type HistoryFilters = {
  taskId: string
  status: '' | RunStatus
  trigger: '' | 'manual' | 'schedule'
  keyword: string
  startedFrom: string
  startedTo: string
  page: number
  pageSize: number
}

type HistoryPayload = {
  runs: ScheduledTaskHistoryRun[]
  total: number
  page: number
  pageSize: number
}

type ParsedTask = Pick<ScheduledTask, 'title' | 'instruction' | 'scheduleType' | 'scheduleRule' | 'cronExpression' | 'nextRunAt'>
type FormState = {
  scheduleText: string
  title: string
  instruction: string
  cronExpression: string
  scheduleRule: string
  nextRunAt: string
  enabled: boolean
  agentId: string
}

type AnyModel = Model<Api>
type ProjectOption = { id: string; name: string; path: string }

const THINKING_OPTIONS: { value: ThinkingLevel; label: () => string }[] = [
  { value: 'off', label: () => t('thinkingOff') },
  { value: 'low', label: () => t('thinkingLow') },
  { value: 'medium', label: () => t('thinkingMedium') },
  { value: 'high', label: () => t('thinkingHigh') },
  { value: 'xhigh', label: () => t('thinkingXHigh') },
]

function modelLabel(model: AnyModel) {
  return `${model.provider} / ${model.id}`
}

function modelsEqual(left?: AnyModel, right?: AnyModel) {
  return Boolean(left && right && left.api === right.api && left.provider === right.provider && left.id === right.id)
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function truncateContent(value: string, max = 20) {
  const text = String(value || '').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function defaultForm(): FormState {
  return {
    scheduleText: '',
    title: '',
    instruction: '',
    cronExpression: '',
    scheduleRule: '',
    nextRunAt: '',
    enabled: true,
    agentId: '',
  }
}

function defaultHistoryFilters(): HistoryFilters {
  return {
    taskId: '',
    status: '',
    trigger: '',
    keyword: '',
    startedFrom: '',
    startedTo: '',
    page: 1,
    pageSize: 10,
  }
}

function formFromTask(task: ScheduledTask): FormState {
  return {
    scheduleText: [task.scheduleRule, task.instruction].filter(Boolean).join('\n'),
    title: task.title,
    instruction: task.instruction,
    cronExpression: task.cronExpression ?? '',
    scheduleRule: task.scheduleRule,
    nextRunAt: task.nextRunAt,
    enabled: task.status !== 'paused',
    agentId: task.agentId ?? '',
  }
}

function parsedTaskToForm(task: ParsedTask, current: FormState): FormState {
  return {
    ...current,
    title: task.title,
    instruction: task.instruction,
    cronExpression: task.cronExpression ?? '',
    scheduleRule: task.scheduleRule,
    nextRunAt: task.nextRunAt,
    enabled: current.enabled,
  }
}

function buildTaskPayload(form: FormState) {
  return {
    title: form.title.trim(),
    instruction: form.instruction.trim(),
    scheduleType: 'cron',
    scheduleRule: form.scheduleRule.trim() || form.cronExpression.trim(),
    cronExpression: form.cronExpression.trim(),
    nextRunAt: form.nextRunAt,
    enabled: form.enabled,
    agentId: form.agentId || null,
  }
}

type ScheduledTasksPageProps = {
  onOpenSession?: (sessionId: string) => void
}

function formIsValid(form: FormState) {
  return Boolean(form.title.trim() && form.instruction.trim() && form.cronExpression.trim())
}

function statusLabel(status: TaskStatus | RunStatus) {
  if (status === 'enabled') return t('taskEnabled')
  if (status === 'running') return t('taskRunning')
  if (status === 'paused') return t('taskPaused')
  if (status === 'completed') return t('taskFinished')
  if (status === 'success') return t('executionSuccess')
  return t('taskFailed')
}

function statusClass(status: TaskStatus | RunStatus) {
  if (status === 'enabled' || status === 'success') return 'bg-emerald-500/10 text-emerald-700'
  if (status === 'running') return 'bg-blue-500/10 text-blue-700'
  if (status === 'paused') return 'bg-amber-500/10 text-amber-700'
  return 'bg-muted text-muted-foreground'
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

export function ScheduledTasksPage({ onOpenSession }: ScheduledTasksPageProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [activeTab, setActiveTab] = useState<ActiveTab>('tasks')
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [parsedTask, setParsedTask] = useState<ParsedTask | null>(null)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [models, setModels] = useState<AnyModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AnyModel>()
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(() => defaultHistoryFilters())
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState<HistoryFilters>(() => defaultHistoryFilters())
  const [historyPayload, setHistoryPayload] = useState<HistoryPayload>({ runs: [], total: 0, page: 1, pageSize: 10 })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([])
  const defaultProjectId = projects[0]?.id ?? ''

  async function loadTasks() {
    const payload = await requestJson<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks')
    setTasks(payload.tasks)
  }

  async function loadHistory(filters = appliedHistoryFilters) {
    setHistoryLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(filters.page))
      params.set('pageSize', String(filters.pageSize))
      if (filters.taskId) params.set('taskId', filters.taskId)
      if (filters.status) params.set('status', filters.status)
      if (filters.trigger) params.set('trigger', filters.trigger)
      if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim())
      if (filters.startedFrom) params.set('startedFrom', filters.startedFrom)
      if (filters.startedTo) params.set('startedTo', filters.startedTo)
      const payload = await requestJson<HistoryPayload>(`/api/scheduled-tasks/runs?${params.toString()}`)
      setHistoryPayload(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadProjects() {
      try {
        const payload = await requestJson<{ project?: ProjectOption; projects: ProjectOption[] }>('/api/project')
        if (cancelled) return
        setProjects(payload.projects ?? [])
      } catch {
        // Project selection is optional.
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadModelSettings() {
      try {
        const storage = await initializePiStorage()
        const configuredModels = await getConfiguredModels(storage)
        const defaultOptions = await loadDefaultOptions(storage)
        const activeModel = defaultOptions.model ?? await loadInitialConfiguredModel(storage) ?? configuredModels[0]
        if (cancelled) return
        setModels(configuredModels)
        setSelectedModel(activeModel)
        setThinkingLevel(defaultOptions.thinkingLevel ?? defaultThinkingLevelForModel(activeModel))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    void loadModelSettings()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const payload = await requestJson<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks')
        if (!cancelled) setTasks(payload.tasks)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 10 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadInitialAgents() {
      try {
        const agentsPayload = await requestJson<{ agents: AgentProfile[] }>('/api/agent-profiles')
        if (cancelled) return
        setAgentProfiles(agentsPayload.agents)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    void loadInitialAgents()
    return () => {
      cancelled = true
    }
  }, [])

  const editingTask = useMemo(() => tasks.find((task) => task.id === editingTaskId), [editingTaskId, tasks])
  const detailTask = useMemo(() => tasks.find((task) => task.id === detailTaskId) ?? null, [detailTaskId, tasks])
  const enabledCount = useMemo(() => tasks.filter((task) => task.status === 'enabled').length, [tasks])
  const totalHistoryPages = Math.max(1, Math.ceil(historyPayload.total / historyPayload.pageSize))

  function agentLabel(agentId?: string | null) {
    if (!agentId) return t('defaultAgent')
    return agentProfiles.find((agent) => agent.id === agentId || agent.name === agentId)?.label ?? agentId
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateHistoryFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setHistoryFilters((current) => ({ ...current, [key]: value }))
  }

  function resetEditor() {
    setEditingTaskId(null)
    setSelectedProjectId(defaultProjectId)
    setForm(defaultForm())
    setParsedTask(null)
    setQuestion('')
    setError('')
  }

  function openCreateDialog() {
    resetEditor()
    setDialogOpen(true)
  }

  function closeDialog() {
    if (loading) return
    setDialogOpen(false)
    resetEditor()
  }

  function applyHistoryFilters() {
    const nextFilters = { ...historyFilters, page: 1 }
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  function resetHistoryFilters() {
    const nextFilters = defaultHistoryFilters()
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  function changeHistoryPage(page: number) {
    const nextPage = Math.min(Math.max(1, page), totalHistoryPages)
    const nextFilters = { ...appliedHistoryFilters, page: nextPage }
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  function changeHistoryPageSize(pageSize: number) {
    const nextFilters = { ...appliedHistoryFilters, page: 1, pageSize }
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  async function handleParse() {
    const scheduleText = form.scheduleText.trim()
    if (!scheduleText) return
    setLoading(true)
    setError('')
    try {
      const result = await requestJson<{ needMoreInfo: boolean; question?: string; task?: ParsedTask }>('/api/scheduled-tasks/parse', {
        method: 'POST',
        body: JSON.stringify({ instruction: scheduleText, model: selectedModel, thinkingLevel }),
      })
      if (result.needMoreInfo || !result.task) {
        setQuestion(result.question || '请补充任务信息。')
        setParsedTask(null)
        return
      }
      const task = result.task
      setQuestion('')
      setParsedTask(task)
      setForm((current) => parsedTaskToForm(task, current))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!formIsValid(form)) return
    setLoading(true)
    setError('')
    try {
      const selectedProject = projects.find((project) => project.id === selectedProjectId)
      const payload = {
        task: buildTaskPayload(form),
        model: selectedModel,
        thinkingLevel,
        projectId: selectedProject?.id,
        projectName: selectedProject?.name,
      }
      if (editingTaskId) {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(editingTaskId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await requestJson('/api/scheduled-tasks', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      closeDialog()
      await loadTasks()
      if (activeTab === 'history') await loadHistory(appliedHistoryFilters)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  function startEdit(task: ScheduledTask) {
    setEditingTaskId(task.id)
    setForm(formFromTask(task))
    setParsedTask(null)
    setQuestion('')
    setError('')
    setSelectedProjectId(task.projectId ?? '')
    if (task.model) setSelectedModel(task.model)
    if (task.thinkingLevel) setThinkingLevel(task.thinkingLevel)
    setDialogOpen(true)
  }

  async function taskAction(taskId: string, action: 'run' | 'pause' | 'resume' | 'delete') {
    setError('')
    setOpenMenuTaskId(null)
    if (action === 'delete') {
      const confirmed = await showConfirm({
        description: t('confirmDeleteTask'),
        confirmLabel: t('confirmDelete'),
        cancelLabel: t('cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    try {
      if (action === 'delete') {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
        if (editingTaskId === taskId) closeDialog()
        if (detailTaskId === taskId) setDetailTaskId(null)
      } else {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' })
      }
      await loadTasks()
      if (activeTab === 'history') await loadHistory(appliedHistoryFilters)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  function renderRunDetails(run: ScheduledTaskRun) {
    return (
      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
        {run.sessionId ? (
          <Button variant="outline" size="sm" onClick={() => onOpenSession?.(run.sessionId!)}>
            {t('viewConversation')}
          </Button>
        ) : null}
        <div>{t('executionAgent')}{run.agentLabel || agentLabel(run.agentId)}</div>
        {run.warning ? <div className="text-amber-600">{run.warning}</div> : null}
        {run.inputContent ? <div><div className="font-medium text-foreground">{t('runInputContent')}</div><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{run.inputContent}</pre></div> : null}
        {run.aiResult || run.result ? <div><div className="font-medium text-foreground">{t('runAiResult')}</div><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{run.aiResult || run.result}</pre></div> : null}
        {run.errorMessage ? <div className="text-destructive">{run.errorMessage}</div> : null}
        {run.durationMs ? <div>{t('runDuration')}{run.durationMs}ms</div> : null}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <CalendarClock className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{t('scheduledTasks')}</h1>
              <p className="text-sm text-muted-foreground">{t('scheduledTasksDescription')}</p>
            </div>
          </div>
          <Button onClick={openCreateDialog}>{t('createTask')}</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={cn('rounded-full px-4 py-2 text-sm font-medium transition-colors', activeTab === 'tasks' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
            onClick={() => setActiveTab('tasks')}
          >
            {t('taskListTab')} <span className="opacity-80">{tasks.length}</span>
          </button>
          <button
            type="button"
            className={cn('rounded-full px-4 py-2 text-sm font-medium transition-colors', activeTab === 'history' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
            onClick={() => { setActiveTab('history'); void loadHistory(appliedHistoryFilters) }}
          >
            {t('executionHistoryTab')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {error && !dialogOpen ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          {activeTab === 'tasks' ? (
            <>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{t('taskList')}</h2>
                    <p className="text-sm text-muted-foreground">{t('tasksCount', { total: tasks.length, enabled: enabledCount })}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {tasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground md:col-span-2">
                    {t('noScheduledTasks')}
                  </div>
                ) : tasks.map((task) => {
                  const taskEnabled = task.status === 'enabled'
                  const switchDisabled = task.status === 'completed'
                  return (
                    <div key={task.id} className="relative cursor-pointer rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40" onClick={() => setDetailTaskId(task.id)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-base font-semibold text-foreground">{task.title}</h3>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{truncateContent(task.instruction, 20)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={taskEnabled}
                            disabled={switchDisabled}
                            className={cn('relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', taskEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')}
                            onClick={() => void taskAction(task.id, task.status === 'paused' ? 'resume' : 'pause')}
                            title={task.status === 'paused' ? t('enable') : t('pauseTask')}
                          >
                            <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', taskEnabled ? 'translate-x-5' : 'translate-x-0')} />
                          </button>
                          <div className="relative">
                            <Button variant="ghost" size="icon" onClick={() => setOpenMenuTaskId(openMenuTaskId === task.id ? null : task.id)} title={t('moreActions')}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                            {openMenuTaskId === task.id ? (
                              <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-lg">
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(task.currentRunId)} onClick={() => void taskAction(task.id, 'run')}>
                                  <Zap className="size-3.5" />{t('executeNow')}
                                </button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(task.currentRunId)} onClick={() => startEdit(task)}>
                                  <Edit3 className="size-3.5" />{t('editTask')}
                                </button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => { setOpenMenuTaskId(null); setDetailTaskId(task.id) }}>
                                  <Eye className="size-3.5" />{t('viewDetails')}
                                </button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(task.currentRunId)} onClick={() => void taskAction(task.id, 'delete')}>
                                  <Trash2 className="size-3.5" />{t('deleteTask')}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{task.scheduleRule}</span>
                        <span className="inline-flex items-center gap-1"><Bot className="size-3" />{agentLabel(task.agentId)}</span>
                        {task.projectName ? <span>{t('taskProject')}{task.projectName}</span> : null}
                      </div>
                      <div className="mt-4 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
                        <span>{t('lastExecution')}{formatDateTime(task.lastRunAt)}</span>
                        <span>{t('nextExecution')}{formatDateTime(task.nextRunAt)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Search className="size-4" />{t('historyFilters')}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block text-xs font-medium text-muted-foreground">
                    {t('taskName')}
                    <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.taskId} onChange={(event) => updateHistoryFilter('taskId', event.target.value)}>
                      <option value="">{t('allTasks')}</option>
                      {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    {t('status')}
                    <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.status} onChange={(event) => updateHistoryFilter('status', event.target.value as HistoryFilters['status'])}>
                      <option value="">{t('allStatuses')}</option>
                      <option value="running">{t('executionRunning')}</option>
                      <option value="success">{t('executionSuccess')}</option>
                      <option value="failed">{t('taskFailed')}</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    {t('triggerType')}
                    <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.trigger} onChange={(event) => updateHistoryFilter('trigger', event.target.value as HistoryFilters['trigger'])}>
                      <option value="">{t('allTriggers')}</option>
                      <option value="schedule">{t('autoRun')}</option>
                      <option value="manual">{t('manualRun')}</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    {t('startTime')}
                    <input type="datetime-local" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.startedFrom} onChange={(event) => updateHistoryFilter('startedFrom', event.target.value)} />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    {t('endTime')}
                    <input type="datetime-local" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.startedTo} onChange={(event) => updateHistoryFilter('startedTo', event.target.value)} />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    {t('keyword')}
                    <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.keyword} onChange={(event) => updateHistoryFilter('keyword', event.target.value)} placeholder={t('keywordPlaceholder')} />
                  </label>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="outline" onClick={resetHistoryFilters}>{t('reset')}</Button>
                  <Button onClick={applyHistoryFilters}>{t('query')}</Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 border-b border-border px-4 py-3 text-xs font-medium text-muted-foreground">
                  <span>{t('taskName')}</span>
                  <span>{t('status')}</span>
                  <span>{t('triggerType')}</span>
                  <span>{t('startTime')}</span>
                  <span>{t('runDuration')}</span>
                </div>
                {historyLoading ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">{t('loading')}</div>
                ) : historyPayload.runs.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">{t('noExecutionHistory')}</div>
                ) : historyPayload.runs.map((run) => (
                  <div key={`${run.taskId}:${run.id}`} className="border-b border-border last:border-b-0">
                    <button type="button" className="grid w-full grid-cols-[1.3fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40" onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}>
                      <span className="min-w-0 truncate text-foreground">{run.taskTitle}</span>
                      <span><span className={cn('rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>{statusLabel(run.status)}</span></span>
                      <span className="text-muted-foreground">{run.trigger === 'manual' ? t('manualRun') : t('autoRun')}</span>
                      <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                      <span className="text-muted-foreground">{run.durationMs ? `${run.durationMs}ms` : '-'}</span>
                    </button>
                    {expandedRunId === run.id ? <div className="border-t border-border bg-muted/20 px-4 py-3">{renderRunDetails(run)}</div> : null}
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
                  <span>{t('paginationSummary', { page: historyPayload.page, pages: totalHistoryPages, total: historyPayload.total })}</span>
                  <div className="flex items-center gap-2">
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={historyPayload.pageSize} onChange={(event) => changeHistoryPageSize(Number(event.target.value))}>
                      {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{t('pageSize', { size })}</option>)}
                    </select>
                    <Button variant="outline" size="sm" disabled={historyPayload.page <= 1} onClick={() => changeHistoryPage(historyPayload.page - 1)}>{t('previousPage')}</Button>
                    <Button variant="outline" size="sm" disabled={historyPayload.page >= totalHistoryPages} onClick={() => changeHistoryPage(historyPayload.page + 1)}>{t('nextPage')}</Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {detailTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailTaskId(null) }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">{detailTask.title}</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{detailTask.scheduleRule}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setDetailTaskId(null)}><X className="size-4" /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4 text-sm">
                <div>
                  <div className="mb-1 font-medium text-foreground">{t('taskContent')}</div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/20 p-3 text-muted-foreground">{detailTask.instruction}</pre>
                </div>
                <div className="grid gap-3 text-muted-foreground sm:grid-cols-2">
                  <div>{t('executionRule')}<span className="text-foreground">{detailTask.scheduleRule}</span></div>
                  <div>cron：<span className="font-mono text-foreground">{detailTask.cronExpression ?? '-'}</span></div>
                  <div>{t('lastExecution')}<span className="text-foreground">{formatDateTime(detailTask.lastRunAt)}</span></div>
                  <div>{t('nextExecution')}<span className="text-foreground">{formatDateTime(detailTask.nextRunAt)}</span></div>
                  <div>{t('executionAgent')}<span className="text-foreground">{agentLabel(detailTask.agentId)}</span></div>
                  {detailTask.projectName ? <div>{t('taskProject')}<span className="text-foreground">{detailTask.projectName}</span></div> : null}
                  {detailTask.model ? <div>{t('taskModel')}：<span className="text-foreground">{modelLabel(detailTask.model)}</span></div> : null}
                  {detailTask.thinkingLevel ? <div>{t('taskThinkingLevel')}<span className="text-foreground">{THINKING_OPTIONS.find((option) => option.value === detailTask.thinkingLevel)?.label() ?? detailTask.thinkingLevel}</span></div> : null}
                  <div>{t('createdAt')}：<span className="text-foreground">{formatDateTime(detailTask.createdAt)}</span></div>
                </div>
                {detailTask.runs?.length > 0 ? (
                  <div>
                    <div className="mb-2 font-medium text-foreground">{t('recentExecutions')}</div>
                    <div className="space-y-2">
                      {detailTask.runs.slice(0, 5).map((run) => (
                        <details key={run.id} className="rounded-lg border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer text-foreground">
                            {formatDateTime(run.startedAt)} · {run.trigger === 'manual' ? t('manualRun') : t('autoRun')} · {statusLabel(run.status)}
                          </summary>
                          {renderRunDetails(run)}
                        </details>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 border-t border-border px-5 py-4">
              <div className="flex flex-wrap justify-end gap-2">
                {detailTask.lastSessionId ? <Button variant="outline" onClick={() => onOpenSession?.(detailTask.lastSessionId!)}>{t('viewConversation')}</Button> : null}
                <Button variant="outline" disabled={Boolean(detailTask.currentRunId)} onClick={() => void taskAction(detailTask.id, 'run')}><Zap className="mr-1 size-3.5" />{t('executeNow')}</Button>
                <Button variant="outline" disabled={Boolean(detailTask.currentRunId)} onClick={() => startEdit(detailTask)}><Edit3 className="mr-1 size-3.5" />{t('editTask')}</Button>
                <Button variant="destructive" disabled={Boolean(detailTask.currentRunId)} onClick={() => void taskAction(detailTask.id, 'delete')}><Trash2 className="mr-1 size-3.5" />{t('deleteTask')}</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="shrink-0 border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">{editingTask ? t('editTask') : t('createTask')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('quickAiParseTask')}</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                <label className="block text-sm font-medium text-foreground">
                  {t('taskScheduleDescriptionLabel')}
                  <textarea
                    className="mt-1 min-h-24 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
                    value={form.scheduleText}
                    onChange={(event) => updateForm('scheduleText', event.target.value)}
                    placeholder={t('taskScheduleDescriptionPlaceholder')}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleParse} disabled={loading || !selectedModel || !form.scheduleText.trim()}>
                    <Sparkles className="mr-1 size-3.5" />{t('aiParseTask')}
                  </Button>
                  {question ? <span className="text-sm text-amber-600">{question}</span> : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-foreground">
                    {t('taskTitleLabel')}
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                      value={form.title}
                      onChange={(event) => updateForm('title', event.target.value)}
                      placeholder={t('taskTitlePlaceholder')}
                    />
                  </label>

                  <div className="block text-sm font-medium text-foreground">
                    {t('executionRule')}
                    <div className="mt-1 flex h-10 items-center rounded-md border border-input bg-muted/20 px-3 text-sm text-muted-foreground">
                      {form.scheduleRule || '-'}
                    </div>
                  </div>

                  <div className="block text-sm font-medium text-foreground">
                    cron
                    <div className="mt-1 flex h-10 items-center rounded-md border border-input bg-muted/20 px-3 font-mono text-sm text-muted-foreground">
                      {form.cronExpression || '-'}
                    </div>
                  </div>

                  <div className="block text-sm font-medium text-foreground">
                    {t('nextExecutionTime')}
                    <div className="mt-1 flex h-10 items-center rounded-md border border-input bg-muted/20 px-3 text-sm text-muted-foreground">
                      {formatDateTime(form.nextRunAt)}
                    </div>
                  </div>

                  <label className="block text-sm font-medium text-foreground sm:col-span-2">
                    {t('promptContentLabel')}
                    <textarea
                      className="mt-1 min-h-28 w-full resize-y rounded-xl border border-input bg-muted/20 px-3 py-2 text-sm text-muted-foreground outline-none"
                      value={form.instruction}
                      readOnly
                      placeholder="-"
                    />
                  </label>
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} />
                  {t('taskEnabledSwitch')}
                </label>

                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/20 px-2 py-2">
                  <span className="relative inline-flex items-center">
                    <Sparkles className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70" />
                    <select
                      className="h-8 max-w-[240px] rounded-md border border-transparent bg-transparent pl-7 pr-2 text-xs text-muted-foreground outline-none hover:bg-background focus:border-ring"
                      value={selectedModel ? `${selectedModel.provider}\u0000${selectedModel.id}` : ''}
                      onChange={(event) => {
                        const nextModel = models.find((model) => `${model.provider}\u0000${model.id}` === event.target.value)
                        setSelectedModel(nextModel)
                        setThinkingLevel(defaultThinkingLevelForModel(nextModel))
                      }}
                      title={t('taskModel')}
                    >
                      {models.length === 0 ? <option value="">{t('noModelAvailable')}</option> : null}
                      {models.map((model) => (
                        <option key={`${model.provider}:${model.id}`} value={`${model.provider}\u0000${model.id}`}>
                          {modelLabel(model)}{modelsEqual(model, selectedModel) ? ' ✓' : ''}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="relative inline-flex items-center">
                    <Brain className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70" />
                    <select
                      className="h-8 rounded-md border border-transparent bg-transparent pl-7 pr-2 text-xs text-muted-foreground outline-none hover:bg-background focus:border-ring"
                      value={thinkingLevel}
                      onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
                      title={t('taskThinking')}
                    >
                      {THINKING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label()}</option>
                      ))}
                    </select>
                  </span>
                  <span className="relative inline-flex items-center">
                    <Folder className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70" />
                    <select
                      className="h-8 max-w-[220px] rounded-md border border-transparent bg-transparent pl-7 pr-2 text-xs text-muted-foreground outline-none hover:bg-background focus:border-ring"
                      value={selectedProjectId}
                      onChange={(event) => setSelectedProjectId(event.target.value)}
                      title={t('taskProjectLabel')}
                    >
                      <option value="">{t('noProjectBound')}</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </span>
                  <span className="relative inline-flex items-center">
                    <Bot className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70" />
                    <select
                      className="h-8 max-w-[220px] rounded-md border border-transparent bg-transparent pl-7 pr-2 text-xs text-muted-foreground outline-none hover:bg-background focus:border-ring"
                      value={form.agentId}
                      onChange={(event) => updateForm('agentId', event.target.value)}
                      title={t('executionAgent')}
                    >
                      <option value="">{t('defaultAgent')}</option>
                      {agentProfiles.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.label}</option>
                      ))}
                    </select>
                  </span>
                </div>

                {parsedTask ? (
                  <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                    <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      {t('aiParsed')}
                    </div>
                    <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                      <div>{t('taskName')}<span className="text-foreground">{parsedTask.title}</span></div>
                      <div>{t('executionRule')}<span className="text-foreground">{parsedTask.scheduleRule}</span></div>
                      <div>cron：<span className="font-mono text-foreground">{parsedTask.cronExpression ?? '-'}</span></div>
                      <div>{t('nextExecutionTime')}<span className="text-foreground">{formatDateTime(parsedTask.nextRunAt)}</span></div>
                      <div className="sm:col-span-2">{t('aiInstruction')}<span className="text-foreground">{parsedTask.instruction}</span></div>
                    </div>
                  </div>
                ) : null}

                {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-5 py-4">
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeDialog} disabled={loading}>{t('cancel')}</Button>
                <Button onClick={handleSave} disabled={loading || !selectedModel || !formIsValid(form)}>
                  {editingTask ? t('saveTask') : t('confirmCreate')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  )
}
