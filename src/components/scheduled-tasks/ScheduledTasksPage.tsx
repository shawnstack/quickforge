import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, CheckCircle2, Edit3, Eye, MoreHorizontal, Search, Sparkles, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { modelDisplayLabel as modelLabel } from '@/lib/model-display-label'
import { includeCurrentModel, modelIdentityKey, sameModelIdentity } from '@/lib/model-identity'
import { defaultThinkingLevelForModel, getConfiguredModels, initializePiStorage, loadDefaultOptions } from '@/lib/pi-chat'
import { isModelSelectable } from '@/lib/model-visibility'
import { t } from '@/lib/i18n'
import { loadModelCatalog, modelReferenceFromModel } from '@/lib/model-reference'
import { InfoTip } from '@/components/ui/info-tip'
import { showConfirm } from '@/components/ui/confirm-dialog'

import { buildSchedulePayload, scheduleFormFromTask, scheduleValidationError, type ScheduleFields, type ScheduleForm, type ScheduleType, type IntervalUnit } from '@/lib/scheduled-task-form'
type TaskStatus = 'enabled' | 'paused' | 'running' | 'failed' | 'completed'
type RunStatus = 'running' | 'success' | 'failed'
type ExecutionMode = 'serial' | 'parallel'
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

type ScheduledTask = ScheduleFields & {
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
  currentRunIds?: string[]
  createdAt: string
  runs: ScheduledTaskRun[]
  projectName?: string
  projectId?: string | null
  agentId?: string | null
  executionMode?: ExecutionMode
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
type FormState = ScheduleForm & {
  scheduleText: string
  title: string
  instruction: string
  cronExpression: string
  scheduleRule: string
  nextRunAt: string
  enabled: boolean
  agentId: string
  executionMode: ExecutionMode
}

type AnyModel = Model<Api>
type ProjectOption = { id: string; name: string; path: string }

type TaskMenuPosition = { left: number; top: number }

const taskMenuWidth = 144
const taskMenuHeight = 160
const taskMenuGap = 4
const taskMenuMargin = 8

const THINKING_OPTIONS: { value: ThinkingLevel; label: () => string }[] = [
  { value: 'off', label: () => t('thinkingOff') },
  { value: 'low', label: () => t('thinkingLow') },
  { value: 'medium', label: () => t('thinkingMedium') },
  { value: 'high', label: () => t('thinkingHigh') },
  { value: 'xhigh', label: () => t('thinkingXHigh') },
]

function modelsEqual(left?: AnyModel, right?: AnyModel) {
  return sameModelIdentity(left, right)
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
    ...scheduleFormFromTask(),
    scheduleText: '',
    title: '',
    instruction: '',
    cronExpression: '',
    scheduleRule: '',
    nextRunAt: '',
    enabled: true,
    agentId: '',
    executionMode: 'serial',
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
    ...scheduleFormFromTask(task),
    scheduleText: [task.scheduleRule, task.instruction].filter(Boolean).join('\n'),
    title: task.title,
    instruction: task.instruction,
    cronExpression: task.cronExpression ?? '',
    scheduleRule: task.scheduleRule,
    nextRunAt: task.nextRunAt,
    enabled: task.status !== 'paused',
    agentId: task.agentId ?? '',
    executionMode: task.executionMode ?? 'serial',
  }
}

function parsedTaskToForm(task: ParsedTask, current: FormState): FormState {
  const parsedSchedule = scheduleFormFromTask(task)
  return {
    ...current,
    ...parsedSchedule,
    onceExecuteAt: current.scheduleType === 'once' ? current.executeAt : current.onceExecuteAt,
    intervalExecuteAt: current.scheduleType === 'interval' ? current.executeAt : current.intervalExecuteAt,
    intervalValue: task.scheduleType === 'interval' ? parsedSchedule.intervalValue : current.intervalValue,
    intervalUnit: task.scheduleType === 'interval' ? parsedSchedule.intervalUnit : current.intervalUnit,
    originalExecuteAt: task.scheduleType === 'interval' ? parsedSchedule.originalExecuteAt : current.originalExecuteAt,
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
    ...buildSchedulePayload(form),
    enabled: form.enabled,
    agentId: form.agentId || null,
    executionMode: form.executionMode,
  }
}

function taskHasRunningRuns(task: ScheduledTask) {
  return Boolean(task.currentRunId || task.currentRunIds?.length)
}

function canRunTaskNow(task: ScheduledTask) {
  return (task.executionMode ?? 'serial') === 'parallel' || !taskHasRunningRuns(task)
}

function executionModeLabel(mode?: ExecutionMode) {
  return mode === 'parallel' ? t('taskExecutionModeParallel') : t('taskExecutionModeSerial')
}

type ScheduledTasksPageProps = {
  onOpenSession?: (sessionId: string) => void
}

function formIsValid(form: FormState) {
  return Boolean(form.title.trim() && form.instruction.trim() && !scheduleValidationError(form))
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
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set())
  const editorBusyRef = useRef(false)
  const editorGenerationRef = useRef(0)
  const editorOpenRef = useRef(false)
  const pendingTaskIdsRef = useRef(new Set<string>())
  const taskMenuPositionRef = useRef<TaskMenuPosition | null>(null)
  const defaultProjectId = projects[0]?.id ?? ''

  useEffect(() => () => {
    editorGenerationRef.current += 1
    editorOpenRef.current = false
  }, [])

  useEffect(() => {
    if (!openMenuTaskId) return
    const closeMenu = () => setOpenMenuTaskId(null)
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
  }, [openMenuTaskId])

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
        const [configuredModels, catalogModels] = await Promise.all([
          getConfiguredModels(storage),
          loadModelCatalog().catch(() => []),
        ])
        const availableModels = catalogModels.length ? catalogModels : configuredModels
        const selectableModels = availableModels.filter(isModelSelectable)
        const defaultOptions = await loadDefaultOptions(storage)
        const savedDefault = defaultOptions.model && isModelSelectable(defaultOptions.model)
          ? selectableModels.find((model) => modelsEqual(model, defaultOptions.model))
          : undefined
        const activeModel = savedDefault ?? selectableModels[0]
        if (cancelled) return
        setModels(availableModels)
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
  const selectableModels = useMemo(() => models.filter(isModelSelectable), [models])
  const modelOptions = useMemo(
    () => includeCurrentModel(selectableModels, selectedModel),
    [selectableModels, selectedModel],
  )
  const detailTask = useMemo(() => tasks.find((task) => task.id === detailTaskId) ?? null, [detailTaskId, tasks])
  const openMenuTask = openMenuTaskId ? tasks.find((task) => task.id === openMenuTaskId) ?? null : null
  const enabledCount = useMemo(() => tasks.filter((task) => task.status === 'enabled').length, [tasks])
  const totalHistoryPages = Math.max(1, Math.ceil(historyPayload.total / historyPayload.pageSize))
  const scheduleError = scheduleValidationError(form)
  const frequencyOptions: { value: ScheduleType; label: string }[] = [
    { value: 'once', label: t('taskFrequencyOnce') },
    { value: 'interval', label: t('taskFrequencyInterval') },
    { value: 'daily', label: t('taskFrequencyDaily') },
    { value: 'weekly', label: t('taskFrequencyWeekly') },
    { value: 'monthly', label: t('taskFrequencyMonthly') },
    { value: 'cron', label: t('taskFrequencyCron') },
  ]
  const weekLabels = [t('taskSunday'), t('taskMonday'), t('taskTuesday'), t('taskWednesday'), t('taskThursday'), t('taskFriday'), t('taskSaturday')]
  const scheduleInputClass = 'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none'
  const scheduleSummary = form.scheduleType === 'cron' ? form.cronExpression
    : form.scheduleType === 'once' ? `${t('taskFrequencyOnce')} · ${formatDateTime(form.executeAt)}`
    : form.scheduleType === 'interval' ? `${t('taskIntervalValue')} ${form.intervalValue} ${{ minute: t('taskUnitMinute'), hour: t('taskUnitHour'), day: t('taskUnitDay') }[form.intervalUnit]} · ${t('taskFirstExecution')} ${formatDateTime(form.executeAt)}`
    : form.scheduleType === 'weekly' ? `${[...form.weekDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => weekLabels[day]).join(' / ')} · ${form.executeTime}`
    : form.scheduleType === 'monthly' ? `${t('taskFrequencyMonthly')} · ${form.monthDay} · ${form.executeTime}`
    : `${t('taskFrequencyDaily')} · ${form.executeTime}`

  function agentLabel(agentId?: string | null) {
    if (!agentId) return t('defaultAgent')
    return agentProfiles.find((agent) => agent.id === agentId || agent.name === agentId)?.label ?? agentId
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (editorBusyRef.current) return
    setForm((current) => {
      const next = { ...current, [key]: value, nextRunAt: '', scheduleRule: '' }
      if (key === 'scheduleType') {
        if (current.scheduleType === 'once') next.onceExecuteAt = current.executeAt
        if (current.scheduleType === 'interval') next.intervalExecuteAt = current.executeAt
        if (value === 'once') next.executeAt = next.onceExecuteAt
        if (value === 'interval') next.executeAt = next.intervalExecuteAt
      }
      return next
    })
    setParsedTask(null)
    setQuestion('')
  }

  function updateHistoryFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setHistoryFilters((current) => ({ ...current, [key]: value }))
  }

  function resetEditor() {
    const defaultModel = models.find(isModelSelectable)
    setEditingTaskId(null)
    setSelectedProjectId(defaultProjectId)
    setSelectedModel(defaultModel)
    setThinkingLevel(defaultThinkingLevelForModel(defaultModel))
    setForm(defaultForm())
    setParsedTask(null)
    setQuestion('')
    setError('')
  }

  function openCreateDialog() {
    if (editorBusyRef.current) return
    editorGenerationRef.current += 1
    editorOpenRef.current = true
    resetEditor()
    setDialogOpen(true)
  }

  function finishEditor() {
    editorGenerationRef.current += 1
    editorOpenRef.current = false
    setDialogOpen(false)
    resetEditor()
  }

  function closeDialog() {
    if (editorBusyRef.current) return
    finishEditor()
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
    if (editorBusyRef.current || !editorOpenRef.current || !selectedModel || !scheduleText) return
    editorBusyRef.current = true
    const generation = editorGenerationRef.current
    setLoading(true)
    setError('')
    try {
      const result = await requestJson<{ needMoreInfo: boolean; question?: string; task?: ParsedTask }>('/api/scheduled-tasks/parse', {
        method: 'POST',
        body: JSON.stringify({ instruction: scheduleText, modelRef: selectedModel ? modelReferenceFromModel(selectedModel) : undefined, model: selectedModel, thinkingLevel }),
      })
      if (!editorOpenRef.current || editorGenerationRef.current !== generation) return
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
      if (editorOpenRef.current && editorGenerationRef.current === generation) setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      editorBusyRef.current = false
      setLoading(false)
    }
  }

  async function handleSave() {
    if (editorBusyRef.current || !editorOpenRef.current || !selectedModel || !formIsValid(form)) return
    editorBusyRef.current = true
    const generation = editorGenerationRef.current
    setLoading(true)
    setError('')
    try {
      const selectedProject = projects.find((project) => project.id === selectedProjectId)
      const payload = {
        task: buildTaskPayload(form),
        modelRef: selectedModel ? modelReferenceFromModel(selectedModel) : undefined,
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
      if (editorOpenRef.current && editorGenerationRef.current === generation) finishEditor()
      await loadTasks()
      if (activeTab === 'history') await loadHistory(appliedHistoryFilters)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      editorBusyRef.current = false
      setLoading(false)
    }
  }

  function toggleTaskMenu(event: ReactMouseEvent<HTMLButtonElement>, taskId: string) {
    if (openMenuTaskId === taskId) {
      setOpenMenuTaskId(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(
      taskMenuMargin,
      Math.min(rect.right - taskMenuWidth, window.innerWidth - taskMenuWidth - taskMenuMargin),
    )
    const below = rect.bottom + taskMenuGap
    const above = rect.top - taskMenuGap - taskMenuHeight
    const top = below + taskMenuHeight <= window.innerHeight - taskMenuMargin
      ? below
      : Math.max(taskMenuMargin, above)
    taskMenuPositionRef.current = { left, top }
    setOpenMenuTaskId(taskId)
  }

  function startEdit(task: ScheduledTask) {
    if (editorBusyRef.current || pendingTaskIdsRef.current.has(task.id)) return
    editorGenerationRef.current += 1
    editorOpenRef.current = true
    setOpenMenuTaskId(null)
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
    if (pendingTaskIdsRef.current.has(taskId) || editorBusyRef.current) return
    pendingTaskIdsRef.current.add(taskId)
    setPendingTaskIds(new Set(pendingTaskIdsRef.current))
    setError('')
    setOpenMenuTaskId(null)
    try {
      if (action === 'delete') {
        const confirmed = await showConfirm({
          description: t('confirmDeleteTask'),
          confirmLabel: t('confirmDelete'),
          cancelLabel: t('cancel'),
          variant: 'destructive',
        })
        if (!confirmed) return
      }
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
    } finally {
      pendingTaskIdsRef.current.delete(taskId)
      setPendingTaskIds(new Set(pendingTaskIdsRef.current))
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
        <div className={cn('flex flex-wrap items-center gap-3', dialogOpen || detailTask ? 'justify-between' : 'justify-end')}>
          {dialogOpen || detailTask ? (
            <Button variant="outline" disabled={dialogOpen && loading} onClick={() => { if (dialogOpen) closeDialog(); else setDetailTaskId(null) }}>
              <ArrowLeft className="mr-1 size-4" />{t('back')}
            </Button>
          ) : (
            <Button onClick={openCreateDialog} disabled={loading}>{t('createTask')}</Button>
          )}
        </div>
        {!dialogOpen && !detailTask ? (
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
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">

          {/* ===== 编辑/新建任务视图 ===== */}
          {dialogOpen ? (
            <div className="min-w-0 rounded-xl border border-border bg-card">
              <fieldset disabled={loading} aria-busy={loading} className="space-y-4 p-4 disabled:opacity-60">
                <h2 className="text-base font-semibold text-foreground">
                  {editingTask ? t('editTask') : t('createTask')}
                </h2>

                <div className="rounded-2xl border border-border p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="size-4 text-primary" />
                    {t('aiParseTask')}
                    <InfoTip label={t('quickAiParseTask')} />
                  </div>
                  <label className="block text-sm font-medium text-foreground">
                    {t('taskScheduleDescriptionLabel')}
                    <textarea
                      className="mt-1 min-h-24 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground"
                      value={form.scheduleText}
                      onChange={(event) => updateForm('scheduleText', event.target.value)}
                      placeholder={t('taskScheduleDescriptionPlaceholder')}
                    />
                  </label>
                  {question ? <p className="mt-2 text-sm text-amber-600">{question}</p> : null}
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleParse} disabled={loading || !selectedModel || !form.scheduleText.trim()}>
                      <Sparkles className="mr-1 size-3.5" />{t('aiParseTask')}
                    </Button>
                  </div>
                </div>

                {parsedTask ? (
                  <div className="rounded-xl border border-border p-3 text-sm">
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-foreground">
                    {t('taskTitleLabel')}
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
                      value={form.title}
                      onChange={(event) => updateForm('title', event.target.value)}
                      placeholder={t('taskTitlePlaceholder')}
                    />
                  </label>

                  <fieldset className="min-w-0 sm:col-span-2" disabled={loading}>
                    <label className="block text-sm font-medium text-foreground">
                      {t('taskFrequency')}
                      <select
                        className={scheduleInputClass}
                        value={form.scheduleType}
                        onChange={(event) => updateForm('scheduleType', event.target.value as ScheduleType)}
                        aria-label={t('taskFrequency')}
                      >
                        {frequencyOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {form.scheduleType === 'interval' ? <>
                        <label className="block text-sm font-medium text-foreground">{t('taskIntervalValue')}<input type="number" min="1" step="1" className={scheduleInputClass} value={form.intervalValue} onChange={(event) => updateForm('intervalValue', event.target.value)} /></label>
                        <label className="block text-sm font-medium text-foreground">{t('taskIntervalUnit')}<select className={scheduleInputClass} value={form.intervalUnit} onChange={(event) => updateForm('intervalUnit', event.target.value as IntervalUnit)}>
                          <option value="minute">{t('taskUnitMinute')}</option><option value="hour">{t('taskUnitHour')}</option><option value="day">{t('taskUnitDay')}</option>
                        </select></label>
                      </> : null}
                      {form.scheduleType === 'once' || form.scheduleType === 'interval' ? <label className="block text-sm font-medium text-foreground sm:col-span-2">{form.scheduleType === 'interval' ? t('taskFirstExecution') : t('taskExecutionDate')}
                        <input type="datetime-local" className={scheduleInputClass} value={form.executeAt} onChange={(event) => updateForm('executeAt', event.target.value)} />
                      </label> : null}
                      {['daily', 'weekly', 'monthly'].includes(form.scheduleType) ? <label className="block text-sm font-medium text-foreground">{t('taskExecutionTime')}<input type="time" className={scheduleInputClass} value={form.executeTime} onChange={(event) => updateForm('executeTime', event.target.value)} /></label> : null}
                      {form.scheduleType === 'weekly' ? <fieldset className="sm:col-span-2">
                        <legend className="mb-2 text-sm font-medium text-foreground">{t('taskRepeatDays')}</legend>
                        <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button key={day} type="button" aria-pressed={form.weekDays.includes(day)} className={cn('rounded-md border px-3 py-2 text-sm', form.weekDays.includes(day) ? 'bg-muted text-foreground' : 'border-input text-muted-foreground')} onClick={() => updateForm('weekDays', form.weekDays.includes(day) ? form.weekDays.filter((value) => value !== day) : [...form.weekDays, day])}>{weekLabels[day]}</button>)}</div>
                      </fieldset> : null}
                      {form.scheduleType === 'monthly' ? <label className="block text-sm font-medium text-foreground">{t('taskMonthDay')}<input type="number" min="1" max="31" step="1" className={scheduleInputClass} value={form.monthDay} onChange={(event) => updateForm('monthDay', event.target.value)} /><span className="mt-1 block text-xs text-muted-foreground">{t('taskMonthDayHelp')}</span></label> : null}
                      {form.scheduleType === 'cron' ? <label className="block text-sm font-medium text-foreground sm:col-span-2">{t('taskCronExpression')}<input className={cn(scheduleInputClass, 'font-mono')} value={form.cronExpression} onChange={(event) => updateForm('cronExpression', event.target.value)} placeholder="0 9 * * 1-5" /><span className="mt-1 block text-xs text-muted-foreground">{t('taskCronHelp')}</span></label> : null}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{t('taskScheduleTimezoneHelp')}</p>
                    {form.scheduleType === 'interval' ? <p className="mt-1 text-xs text-muted-foreground">{t('taskIntervalHelp')}</p> : null}
                    {scheduleError ? <p role="alert" className="mt-2 text-sm text-destructive">{t(scheduleError)}</p> : <div aria-live="polite" className="mt-2 rounded-md bg-muted px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t('executionRule')}</div>
                      <p className="mt-1 text-sm text-foreground">{scheduleSummary}</p>
                    </div>}
                  </fieldset>

                  <label className="block text-sm font-medium text-foreground sm:col-span-2">
                    <span className="inline-flex items-center gap-1.5">
                      {t('taskExecutionMode')}
                      <InfoTip label={t('taskExecutionModeHelp')} />
                    </span>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none"
                      value={form.executionMode}
                      onChange={(event) => updateForm('executionMode', event.target.value as ExecutionMode)}
                      aria-label={t('taskExecutionMode')}
                    >
                      <option value="serial">{t('taskExecutionModeSerial')}</option>
                      <option value="parallel">{t('taskExecutionModeParallel')}</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-foreground">
                    {t('taskModel')}
                    <select
                      className={scheduleInputClass}
                      value={selectedModel ? modelIdentityKey(selectedModel) : ''}
                      onChange={(event) => {
                        const nextModel = modelOptions.find((model) => modelIdentityKey(model) === event.target.value)
                        setSelectedModel(nextModel)
                        setThinkingLevel(defaultThinkingLevelForModel(nextModel))
                      }}
                    >
                      {modelOptions.length === 0 ? <option value="">{t('noModelAvailable')}</option> : null}
                      {modelOptions.map((model) => (
                        <option key={modelIdentityKey(model)} value={modelIdentityKey(model)}>
                          {modelLabel(model)}{modelsEqual(model, selectedModel) ? ' ✓' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-foreground">
                    {t('taskThinking')}
                    <select
                      className={scheduleInputClass}
                      value={thinkingLevel}
                      onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
                    >
                      {THINKING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label()}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-foreground">
                    {t('taskProjectLabel')}
                    <select
                      className={scheduleInputClass}
                      value={selectedProjectId}
                      onChange={(event) => setSelectedProjectId(event.target.value)}
                    >
                      <option value="">{t('noProjectBound')}</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-foreground">
                    {t('executionAgentLabel')}
                    <select
                      className={scheduleInputClass}
                      value={form.agentId}
                      onChange={(event) => updateForm('agentId', event.target.value)}
                    >
                      <option value="">{t('defaultAgent')}</option>
                      {agentProfiles.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-foreground sm:col-span-2">
                    {t('promptContentLabel')}
                    <textarea
                      className="mt-1 min-h-28 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground"
                      value={form.instruction}
                      onChange={(event) => updateForm('instruction', event.target.value)}
                      placeholder={t('promptContentPlaceholder')}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} />
                  {t('taskEnabledSwitch')}
                </label>

                {error ? <div className="rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
              </fieldset>

              <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                <Button variant="outline" onClick={closeDialog}>{t('cancel')}</Button>
                <Button onClick={handleSave} disabled={loading || !selectedModel || !formIsValid(form)}>
                  {editingTask ? t('saveTask') : t('confirmCreate')}
                </Button>
              </div>
            </div>
          ) : detailTask ? (
            /* ===== 任务详情视图 ===== */
            <div className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{detailTask.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{detailTask.scheduleRule}</p>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="mb-1 font-medium text-foreground">{t('taskContent')}</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-muted-foreground">{detailTask.instruction}</pre>
                  </div>
                  <div className="grid gap-y-1.5 sm:grid-cols-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('executionRule')}</span>
                      <span className="truncate text-sm text-foreground">{detailTask.scheduleRule}</span>
                    </div>
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('taskExecutionMode')}</span>
                      <span className="truncate text-sm text-foreground">{executionModeLabel(detailTask.executionMode)}</span>
                    </div>
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">cron</span>
                      <span className="truncate font-mono text-sm text-foreground">{detailTask.cronExpression ?? '-'}</span>
                    </div>
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('lastExecution')}</span>
                      <span className="truncate text-sm text-foreground">{formatDateTime(detailTask.lastRunAt)}</span>
                    </div>
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('nextExecution')}</span>
                      <span className="truncate text-sm text-foreground">{formatDateTime(detailTask.nextRunAt)}</span>
                    </div>
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('executionAgent')}</span>
                      <span className="truncate text-sm text-foreground">{agentLabel(detailTask.agentId)}</span>
                    </div>
                    {detailTask.projectName ? <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('taskProject')}</span>
                      <span className="truncate text-sm text-foreground">{detailTask.projectName}</span>
                    </div> : null}
                    {detailTask.model ? <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('taskModel')}</span>
                      <span className="truncate text-sm text-foreground">{modelLabel(detailTask.model)}</span>
                    </div> : null}
                    {detailTask.thinkingLevel ? <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('taskThinkingLevel')}</span>
                      <span className="truncate text-sm text-foreground">{THINKING_OPTIONS.find((option) => option.value === detailTask.thinkingLevel)?.label() ?? detailTask.thinkingLevel}</span>
                    </div> : null}
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{t('createdAt')}</span>
                      <span className="truncate text-sm text-foreground">{formatDateTime(detailTask.createdAt)}</span>
                    </div>
                  </div>
                  {detailTask.runs?.length > 0 ? (
                    <div>
                      <div className="mb-2 font-medium text-foreground">{t('recentExecutions')}</div>
                      <div className="space-y-2">
                        {detailTask.runs.slice(0, 5).map((run) => (
                          <details key={`${detailTask.id}:${run.id}`} className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
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
              <div className="border-t border-border px-5 py-4">
                <div className="flex flex-wrap justify-end gap-2">
                  {detailTask.lastSessionId ? <Button variant="outline" onClick={() => onOpenSession?.(detailTask.lastSessionId!)}>{t('viewConversation')}</Button> : null}
                  <Button variant="outline" disabled={pendingTaskIds.has(detailTask.id) || !canRunTaskNow(detailTask)} onClick={() => taskAction(detailTask.id, 'run')}><Zap className="mr-1 size-3.5" />{t('executeNow')}</Button>
                  <Button variant="outline" disabled={pendingTaskIds.has(detailTask.id) || taskHasRunningRuns(detailTask)} onClick={() => startEdit(detailTask)}><Edit3 className="mr-1 size-3.5" />{t('editTask')}</Button>
                  <Button variant="destructive" disabled={pendingTaskIds.has(detailTask.id) || taskHasRunningRuns(detailTask)} onClick={() => taskAction(detailTask.id, 'delete')}><Trash2 className="mr-1 size-3.5" />{t('deleteTask')}</Button>
                </div>
              </div>
            </div>
          ) : (
            /* ===== 列表 / 历史视图 ===== */
            <>
              {error ? <div className="rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

              {activeTab === 'tasks' ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-medium text-foreground">{t('taskList')}</h2>
                    <p className="text-xs text-muted-foreground">{t('tasksCount', { total: tasks.length, enabled: enabledCount })}</p>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {tasks.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                        {t('noScheduledTasks')}
                      </div>
                    ) : tasks.map((task) => {
                      const taskEnabled = task.status === 'enabled'
                      const taskPending = pendingTaskIds.has(task.id)
                      const switchDisabled = taskPending || task.status === 'completed'
                      return (
                        <div key={task.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0" onClick={() => setDetailTaskId(task.id)}>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-sm font-medium text-foreground">{task.title}</h3>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{truncateContent(task.instruction, 20)}</p>
                          </div>
                          <div className="hidden shrink-0 truncate text-xs text-muted-foreground md:block">{task.scheduleRule}</div>
                          <div className="hidden shrink-0 space-y-0.5 text-xs text-muted-foreground lg:block">
                            <p className="truncate">{t('lastExecution')}{formatDateTime(task.lastRunAt)}</p>
                            <p className="truncate">{t('nextExecution')}{formatDateTime(task.nextRunAt)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={taskEnabled}
                              aria-label={t('taskEnabledSwitch')}
                              disabled={switchDisabled}
                              className={cn('relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', taskEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')}
                              onClick={() => taskAction(task.id, task.status === 'paused' ? 'resume' : 'pause')}
                              title={task.status === 'paused' ? t('enable') : t('pauseTask')}
                            >
                              <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', taskEnabled ? 'translate-x-5' : 'translate-x-0')} />
                            </button>
                            <Button variant="ghost" size="icon" disabled={taskPending} onClick={(event) => toggleTaskMenu(event, task.id)} title={t('moreActions')} aria-label={t('moreActions')} aria-haspopup="menu" aria-expanded={openMenuTaskId === task.id}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Search className="size-4" />{t('historyFilters')}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                      <label className="block text-xs font-medium text-muted-foreground">
                        {t('taskName')}
                        <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.taskId} onChange={(event) => updateHistoryFilter('taskId', event.target.value)}>
                          <option value="">{t('allTasks')}</option>
                          {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        {t('status')}
                        <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.status} onChange={(event) => updateHistoryFilter('status', event.target.value as HistoryFilters['status'])}>
                          <option value="">{t('allStatuses')}</option>
                          <option value="running">{t('executionRunning')}</option>
                          <option value="success">{t('executionSuccess')}</option>
                          <option value="failed">{t('taskFailed')}</option>
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        {t('triggerType')}
                        <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.trigger} onChange={(event) => updateHistoryFilter('trigger', event.target.value as HistoryFilters['trigger'])}>
                          <option value="">{t('allTriggers')}</option>
                          <option value="schedule">{t('autoRun')}</option>
                          <option value="manual">{t('manualRun')}</option>
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        {t('startTime')}
                        <input type="datetime-local" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.startedFrom} onChange={(event) => updateHistoryFilter('startedFrom', event.target.value)} />
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        {t('endTime')}
                        <input type="datetime-local" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.startedTo} onChange={(event) => updateHistoryFilter('startedTo', event.target.value)} />
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        {t('keyword')}
                        <input className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={historyFilters.keyword} onChange={(event) => updateHistoryFilter('keyword', event.target.value)} placeholder={t('keywordPlaceholder')} />
                      </label>
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="outline" onClick={resetHistoryFilters}>{t('reset')}</Button>
                      <Button onClick={applyHistoryFilters}>{t('query')}</Button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <div className="grid min-w-[600px] grid-cols-[1.3fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
                      <span>{t('taskName')}</span>
                      <span>{t('status')}</span>
                      <span>{t('triggerType')}</span>
                      <span>{t('startTime')}</span>
                      <span>{t('runDuration')}</span>
                    </div>
                    {historyLoading ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">{t('loading')}</div>
                    ) : historyPayload.runs.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">{t('noExecutionHistory')}</div>
                    ) : historyPayload.runs.map((run) => (
                      <div key={`${run.taskId}:${run.id}`} className="border-b border-border last:border-b-0">
                        <button type="button" className="grid w-full min-w-[600px] grid-cols-[1.3fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 px-4 py-2.5 text-left text-sm transition-colors" onClick={() => { const key = `${run.taskId}:${run.id}`; setExpandedRunId(expandedRunId === key ? null : key) }}>
                          <span className="min-w-0 truncate text-foreground">{run.taskTitle}</span>
                          <span><span className={cn('rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>{statusLabel(run.status)}</span></span>
                          <span className="text-muted-foreground">{run.trigger === 'manual' ? t('manualRun') : t('autoRun')}</span>
                          <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                          <span className="text-muted-foreground">{run.durationMs ? `${run.durationMs}ms` : '-'}</span>
                        </button>
                        {expandedRunId === `${run.taskId}:${run.id}` ? <div className="border-t border-border bg-muted px-4 py-2.5">{renderRunDetails(run)}</div> : null}
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm text-muted-foreground">
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
            </>
          )}
        </div>
      </div>

      {openMenuTask ? createPortal(
        <div
          ref={(node) => {
            const position = taskMenuPositionRef.current
            if (node && position) {
              node.style.left = `${position.left}px`
              node.style.top = `${position.top}px`
            }
          }}
          className="fixed z-50 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-quickforge"
          role="menu"
          aria-label={t('moreActions')}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={pendingTaskIds.has(openMenuTask.id) || !canRunTaskNow(openMenuTask)} onClick={() => taskAction(openMenuTask.id, 'run')}>
            <Zap className="size-3.5" />{t('executeNow')}
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={pendingTaskIds.has(openMenuTask.id) || taskHasRunningRuns(openMenuTask)} onClick={() => startEdit(openMenuTask)}>
            <Edit3 className="size-3.5" />{t('editTask')}
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => { setOpenMenuTaskId(null); setDetailTaskId(openMenuTask.id) }}>
            <Eye className="size-3.5" />{t('viewDetails')}
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={pendingTaskIds.has(openMenuTask.id) || taskHasRunningRuns(openMenuTask)} onClick={() => taskAction(openMenuTask.id, 'delete')}>
            <Trash2 className="size-3.5" />{t('deleteTask')}
          </button>
        </div>,
        document.body,
      ) : null}

    </div>
  )
}
