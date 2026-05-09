import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { useEffect, useMemo, useState } from 'react'
import { Brain, CalendarClock, CheckCircle2, Clock3, Edit3, Folder, Pause, Play, Sparkles, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { defaultThinkingLevelForModel, getConfiguredModels, initializePiStorage, loadDefaultOptions, loadInitialConfiguredModel } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'

type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
type TaskStatus = 'enabled' | 'paused' | 'running' | 'failed' | 'expired'
type RunStatus = 'running' | 'success' | 'failed'

type ScheduledTaskRun = {
  id: string
  status: RunStatus
  trigger?: string
  result?: string
  aiResult?: string
  inputContent?: string
  errorMessage?: string
  sessionId?: string
  scheduledAt?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
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
  createdAt: string
  runs: ScheduledTaskRun[]
  projectName?: string
  projectId?: string | null
  model?: AnyModel
  thinkingLevel?: ThinkingLevel
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

function defaultForm(): FormState {
  return {
    scheduleText: '',
    title: '',
    instruction: '',
    cronExpression: '',
    scheduleRule: '',
    nextRunAt: '',
    enabled: true,
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
  }
}

type ScheduledTasksPageProps = {
  onOpenSession?: (sessionId: string) => void
}

function formIsValid(form: FormState) {
  return Boolean(form.title.trim() && form.instruction.trim() && form.cronExpression.trim())
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
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
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

  async function loadTasks() {
    const payload = await requestJson<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks')
    setTasks(payload.tasks)
  }

  useEffect(() => {
    let cancelled = false
    async function loadProjects() {
      try {
        const payload = await requestJson<{ project?: ProjectOption; projects: ProjectOption[] }>('/api/project')
        if (cancelled) return
        setProjects(payload.projects ?? [])
        setSelectedProjectId(payload.project?.id ?? payload.projects?.[0]?.id ?? '')
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

  const editingTask = useMemo(() => tasks.find((task) => task.id === editingTaskId), [editingTaskId, tasks])
  const enabledCount = useMemo(() => tasks.filter((task) => task.status === 'enabled').length, [tasks])

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function resetEditor() {
    setEditingTaskId(null)
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
    if (action === 'delete' && !window.confirm(t('confirmDeleteTask'))) return
    try {
      if (action === 'delete') {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
        if (editingTaskId === taskId) closeDialog()
      } else {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' })
      }
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CalendarClock className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('scheduledTasks')}</h1>
            <p className="text-sm text-muted-foreground">{t('scheduledTasksDescription')}</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">{t('taskList')}</h2>
                <p className="text-sm text-muted-foreground">{t('tasksCount', { total: tasks.length, enabled: enabledCount })}</p>
              </div>
              <Button onClick={openCreateDialog}>{t('createTask')}</Button>
            </div>
            {error && !dialogOpen ? <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          </div>

          <div className="space-y-3">
            {tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                {t('noScheduledTasks')}
              </div>
            ) : tasks.map((task) => (
              <div key={task.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">{task.title}</h3>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs', task.status === 'enabled' ? 'bg-emerald-500/10 text-emerald-700' : task.status === 'running' ? 'bg-blue-500/10 text-blue-700' : task.status === 'paused' ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground')}>
                        {task.status === 'enabled' ? t('taskEnabled') : task.status === 'running' ? t('taskRunning') : task.status === 'paused' ? t('taskPaused') : task.status === 'expired' ? t('taskExpired') : t('taskFailed')}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{task.scheduleRule}</span>
                      {task.cronExpression ? <span className="font-mono">cron：{task.cronExpression}</span> : null}
                      <span>{t('nextExecution')}{formatDateTime(task.nextRunAt)}</span>
                      <span>{t('lastExecution')}{formatDateTime(task.lastRunAt)}</span>
                      {task.projectName ? <span>项目：{task.projectName}</span> : null}
                      {task.model ? <span>模型：{modelLabel(task.model)}</span> : null}
                      {task.thinkingLevel ? <span>{t('taskThinkingLevel')}{THINKING_OPTIONS.find((option) => option.value === task.thinkingLevel)?.label() ?? task.thinkingLevel}</span> : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{task.instruction}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, 'run')} disabled={task.status === 'running'}>
                      <Zap className="mr-1 size-3.5" />{t('executeNow')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(task)} disabled={task.status === 'running'}>
                      <Edit3 className="mr-1 size-3.5" />{t('editTask')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, task.status === 'paused' ? 'resume' : 'pause')}>
                      {task.status === 'paused' ? <Play className="mr-1 size-3.5" /> : <Pause className="mr-1 size-3.5" />}
                      {task.status === 'paused' ? t('enable') : t('pauseTask')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, 'delete')}>
                      <Trash2 className="mr-1 size-3.5" />{t('deleteTask')}
                    </Button>
                  </div>
                </div>
                {task.runs?.length > 0 ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">{t('recentExecutions')}</div>
                    <div className="space-y-2">
                      {task.runs.slice(0, 5).map((run) => (
                        <details key={run.id} className="rounded-lg border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer text-foreground">
                            {formatDateTime(run.startedAt)} · {run.trigger === 'manual' ? t('manualRun') : t('autoRun')} · {run.status === 'running' ? t('executionRunning') : run.status === 'success' ? t('executionSuccess') : t('taskFailed')}
                          </summary>
                          <div className="mt-2 space-y-2">
                            {run.sessionId ? (
                              <Button variant="outline" size="sm" onClick={() => onOpenSession?.(run.sessionId!)}>
                                查看对话
                              </Button>
                            ) : null}
                            {run.inputContent ? <div><div className="font-medium text-foreground">{t('runInputContent')}</div><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{run.inputContent}</pre></div> : null}
                            {run.aiResult || run.result ? <div><div className="font-medium text-foreground">{t('runAiResult')}</div><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{run.aiResult || run.result}</pre></div> : null}
                            {run.errorMessage ? <div className="text-destructive">{run.errorMessage}</div> : null}
                            {run.durationMs ? <div>{t('runDuration')}{run.durationMs}ms</div> : null}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

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
