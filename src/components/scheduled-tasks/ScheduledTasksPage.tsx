import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { useEffect, useMemo, useState } from 'react'
import { Brain, CalendarClock, CheckCircle2, Clock3, Folder, Pause, Play, Sparkles, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getConfiguredModels, initializePiStorage, loadInitialConfiguredModel } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'

type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
type TaskStatus = 'enabled' | 'paused' | 'running' | 'failed' | 'expired'
type RunStatus = 'running' | 'success' | 'failed'

type ScheduledTaskRun = {
  id: string
  status: RunStatus
  trigger?: string
  result?: string
  errorMessage?: string
  sessionId?: string
  startedAt: string
  finishedAt?: string
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
  model?: AnyModel
  thinkingLevel?: ThinkingLevel
}

type ParsedTask = Pick<ScheduledTask, 'title' | 'instruction' | 'scheduleType' | 'scheduleRule' | 'cronExpression' | 'nextRunAt'>

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

function defaultThinkingLevel(model?: AnyModel): ThinkingLevel {
  return model?.reasoning ? 'medium' : 'off'
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

export function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [instruction, setInstruction] = useState('')
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
        const activeModel = await loadInitialConfiguredModel(storage) ?? configuredModels[0]
        if (cancelled) return
        setModels(configuredModels)
        setSelectedModel(activeModel)
        setThinkingLevel(defaultThinkingLevel(activeModel))
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

  const enabledCount = useMemo(() => tasks.filter((task) => task.status === 'enabled').length, [tasks])

  async function handleParse() {
    setLoading(true)
    setError('')
    try {
      const result = await requestJson<{ needMoreInfo: boolean; question?: string; task?: ParsedTask }>('/api/scheduled-tasks/parse', {
        method: 'POST',
        body: JSON.stringify({ instruction, model: selectedModel, thinkingLevel }),
      })
      if (result.needMoreInfo || !result.task) {
        setQuestion(result.question || '请补充任务信息。')
        setParsedTask(null)
        return
      }
      setQuestion('')
      setParsedTask(result.task)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!parsedTask) return
    setLoading(true)
    setError('')
    try {
      const selectedProject = projects.find((project) => project.id === selectedProjectId)
      await requestJson('/api/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify({
          task: parsedTask,
          model: selectedModel,
          thinkingLevel,
          projectId: selectedProject?.id,
          projectName: selectedProject?.name,
        }),
      })
      setInstruction('')
      setParsedTask(null)
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function taskAction(taskId: string, action: 'run' | 'pause' | 'resume' | 'delete') {
    setError('')
    if (action === 'delete' && !window.confirm(t('confirmDeleteTask'))) return
    try {
      if (action === 'delete') {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
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
            <label className="text-sm font-medium text-foreground">{t('createTask')}</label>
            <textarea
              className="mt-2 min-h-24 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t('taskInstructionPlaceholder')}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/20 px-2 py-2">
              <span className="relative inline-flex items-center">
                <Sparkles className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70" />
                <select
                className="h-8 max-w-[240px] rounded-md border border-transparent bg-transparent pl-7 pr-2 text-xs text-muted-foreground outline-none hover:bg-background focus:border-ring"
                value={selectedModel ? `${selectedModel.provider}\u0000${selectedModel.id}` : ''}
                onChange={(event) => {
                  const nextModel = models.find((model) => `${model.provider}\u0000${model.id}` === event.target.value)
                  setSelectedModel(nextModel)
                  setThinkingLevel(defaultThinkingLevel(nextModel))
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={handleParse} disabled={loading}>{t('aiParseTask')}</Button>
              {parsedTask ? <Button variant="secondary" onClick={handleCreate} disabled={loading || !selectedModel}>{t('confirmCreate')}</Button> : null}
              {question ? <span className="text-sm text-amber-600">{question}</span> : null}
              {error ? <span className="text-sm text-destructive">{error}</span> : null}
            </div>

            {parsedTask ? (
              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  {t('aiParsed')}
                </div>
                <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                  <div>{t('taskName')}<span className="text-foreground">{parsedTask.title}</span></div>
                  <div>{t('executionRule')}<span className="text-foreground">{parsedTask.scheduleRule}</span></div>
                  <div className="sm:col-span-2">{t('nextExecutionTime')}<span className="text-foreground">{formatDateTime(parsedTask.nextRunAt)}</span></div>
                  <div>cron：<span className="text-foreground">{parsedTask.cronExpression ?? '-'}</span></div>
                  <div>{t('taskProject')}<span className="text-foreground">{projects.find((project) => project.id === selectedProjectId)?.name ?? t('noProjectBound')}</span></div>
                  <div>{t('taskModel')}：<span className="text-foreground">{selectedModel ? modelLabel(selectedModel) : t('noModelAvailable')}</span></div>
                  <div>{t('taskThinkingLevel')}<span className="text-foreground">{THINKING_OPTIONS.find((option) => option.value === thinkingLevel)?.label() ?? thinkingLevel}</span></div>
                  <div className="sm:col-span-2">{t('aiInstruction')}<span className="text-foreground">{parsedTask.instruction}</span></div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('taskList')}</h2>
              <p className="text-sm text-muted-foreground">{t('tasksCount', { total: tasks.length, enabled: enabledCount })}</p>
            </div>
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
                      <span>{t('nextExecution')}{formatDateTime(task.nextRunAt)}</span>
                      <span>{t('lastExecution')}{formatDateTime(task.lastRunAt)}</span>
                      {task.cronExpression ? <span>cron：{task.cronExpression}</span> : null}
                      {task.projectName ? <span>项目：{task.projectName}</span> : null}
                      {task.model ? <span>模型：{modelLabel(task.model)}</span> : null}
                      {task.thinkingLevel ? <span>{t('taskThinkingLevel')}{THINKING_OPTIONS.find((option) => option.value === task.thinkingLevel)?.label() ?? task.thinkingLevel}</span> : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{task.instruction}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, 'run')} disabled={task.status === 'running'}>
                      <Zap className="mr-1 size-3.5" />{t('executeNow')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, task.status === 'paused' ? 'resume' : 'pause')} disabled={task.status === 'running'}>
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
                    <div className="space-y-1">
                      {task.runs.slice(0, 3).map((run) => (
                        <div key={run.id} className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                          <span>{formatDateTime(run.startedAt)} · {run.status === 'running' ? t('executionRunning') : run.status === 'success' ? t('executionSuccess') : t('taskFailed')}</span>
                          <span className="text-foreground">{run.result || run.errorMessage || t('waitingForResult')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
