import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock3, Pause, Play, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getConfiguredModels, initializePiStorage, loadInitialConfiguredModel } from '@/lib/pi-chat'

type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval'
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
  status: TaskStatus
  nextRunAt: string
  lastRunAt?: string
  lastSessionId?: string
  createdAt: string
  runs: ScheduledTaskRun[]
}

type ParsedTask = Pick<ScheduledTask, 'title' | 'instruction' | 'scheduleType' | 'scheduleRule' | 'nextRunAt'>

type AnyModel = Model<Api>

const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
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

  async function loadTasks() {
    const payload = await requestJson<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks')
    setTasks(payload.tasks)
  }

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
        if (!cancelled) setError(err instanceof Error ? err.message : '加载模型失败')
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
        if (!cancelled) setError(err instanceof Error ? err.message : '加载任务失败')
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
        body: JSON.stringify({ instruction }),
      })
      if (result.needMoreInfo || !result.task) {
        setQuestion(result.question || '请补充任务信息。')
        setParsedTask(null)
        return
      }
      setQuestion('')
      setParsedTask(result.task)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!parsedTask) return
    setLoading(true)
    setError('')
    try {
      await requestJson('/api/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify({ task: parsedTask, model: selectedModel, thinkingLevel }),
      })
      setInstruction('')
      setParsedTask(null)
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setLoading(false)
    }
  }

  async function taskAction(taskId: string, action: 'run' | 'pause' | 'resume' | 'delete') {
    setError('')
    try {
      if (action === 'delete') {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
      } else {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' })
      }
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
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
            <h1 className="text-lg font-semibold text-foreground">定时任务</h1>
            <p className="text-sm text-muted-foreground">任务保存在本地后台服务中，关闭浏览器后仍会按时执行。</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <label className="text-sm font-medium text-foreground">创建任务</label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">
                模型
                <select
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
                  value={selectedModel ? `${selectedModel.provider}\u0000${selectedModel.id}` : ''}
                  onChange={(event) => {
                    const nextModel = models.find((model) => `${model.provider}\u0000${model.id}` === event.target.value)
                    setSelectedModel(nextModel)
                    setThinkingLevel(defaultThinkingLevel(nextModel))
                  }}
                >
                  {models.length === 0 ? <option value="">暂无可用模型</option> : null}
                  {models.map((model) => (
                    <option key={`${model.provider}:${model.id}`} value={`${model.provider}\u0000${model.id}`}>
                      {modelLabel(model)}{modelsEqual(model, selectedModel) ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                思考
                <select
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
                  value={thinkingLevel}
                  onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
                >
                  {THINKING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              className="mt-2 min-h-24 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：每天早上 9 点帮我生成销售日报"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={handleParse} disabled={loading}>AI 解析任务</Button>
              {parsedTask ? <Button variant="secondary" onClick={handleCreate} disabled={loading || !selectedModel}>确认创建</Button> : null}
              {question ? <span className="text-sm text-amber-600">{question}</span> : null}
              {error ? <span className="text-sm text-destructive">{error}</span> : null}
            </div>

            {parsedTask ? (
              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  AI 已解析，请确认
                </div>
                <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                  <div>任务名称：<span className="text-foreground">{parsedTask.title}</span></div>
                  <div>执行规则：<span className="text-foreground">{parsedTask.scheduleRule}</span></div>
                  <div className="sm:col-span-2">下一次执行：<span className="text-foreground">{formatDateTime(parsedTask.nextRunAt)}</span></div>
                  <div>模型：<span className="text-foreground">{selectedModel ? modelLabel(selectedModel) : '未选择'}</span></div>
                  <div>思考：<span className="text-foreground">{THINKING_OPTIONS.find((option) => option.value === thinkingLevel)?.label ?? thinkingLevel}</span></div>
                  <div className="sm:col-span-2">AI 指令：<span className="text-foreground">{parsedTask.instruction}</span></div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">任务列表</h2>
              <p className="text-sm text-muted-foreground">共 {tasks.length} 个任务，{enabledCount} 个启用中</p>
            </div>
          </div>

          <div className="space-y-3">
            {tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                还没有定时任务。先输入一句自然语言指令创建一个。
              </div>
            ) : tasks.map((task) => (
              <div key={task.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">{task.title}</h3>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs', task.status === 'enabled' ? 'bg-emerald-500/10 text-emerald-700' : task.status === 'running' ? 'bg-blue-500/10 text-blue-700' : task.status === 'paused' ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground')}>
                        {task.status === 'enabled' ? '启用中' : task.status === 'running' ? '执行中' : task.status === 'paused' ? '已暂停' : task.status === 'expired' ? '已过期' : '执行失败'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{task.scheduleRule}</span>
                      <span>下一次：{formatDateTime(task.nextRunAt)}</span>
                      <span>上次：{formatDateTime(task.lastRunAt)}</span>
                      {(task as ScheduledTask & { model?: AnyModel }).model ? <span>模型：{modelLabel((task as ScheduledTask & { model: AnyModel }).model)}</span> : null}
                      {(task as ScheduledTask & { thinkingLevel?: ThinkingLevel }).thinkingLevel ? <span>思考：{THINKING_OPTIONS.find((option) => option.value === (task as ScheduledTask & { thinkingLevel?: ThinkingLevel }).thinkingLevel)?.label ?? (task as ScheduledTask & { thinkingLevel?: ThinkingLevel }).thinkingLevel}</span> : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{task.instruction}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, 'run')} disabled={task.status === 'running'}>
                      <Zap className="mr-1 size-3.5" />立即执行
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, task.status === 'paused' ? 'resume' : 'pause')} disabled={task.status === 'running'}>
                      {task.status === 'paused' ? <Play className="mr-1 size-3.5" /> : <Pause className="mr-1 size-3.5" />}
                      {task.status === 'paused' ? '启用' : '暂停'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void taskAction(task.id, 'delete')}>
                      <Trash2 className="mr-1 size-3.5" />删除
                    </Button>
                  </div>
                </div>
                {task.runs?.length > 0 ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">最近执行记录</div>
                    <div className="space-y-1">
                      {task.runs.slice(0, 3).map((run) => (
                        <div key={run.id} className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                          <span>{formatDateTime(run.startedAt)} · {run.status === 'running' ? '执行中' : run.status === 'success' ? '成功' : '失败'}</span>
                          <span className="text-foreground">{run.result || run.errorMessage || '等待结果'}</span>
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
