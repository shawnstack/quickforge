import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ArrowLeft, CheckCircle2, Clock, Edit3, Loader2, MessageSquare, MoreHorizontal, Plus, Search, Sparkles, Trash2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { modelDisplayLabel as modelLabel } from '@/lib/model-display-label'
import { modelIdentityKey, sameModelIdentity } from '@/lib/model-identity'
import { defaultThinkingLevelForModel } from '@/lib/pi-chat'
import { scheduleValidationError, type IntervalUnit, type ScheduleType } from '@/lib/scheduled-task-form'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { formIsValid } from './scheduled-tasks-form'
import type {
  ActiveTab,
  AgentProfile,
  AnyModel,
  ExecutionMode,
  FormState,
  HistoryFilters,
  HistoryPayload,
  ParsedTask,
  ProjectOption,
  RunStatus,
  ScheduledTask,
  ScheduledTaskRun,
  TaskStatus,
} from './scheduled-tasks-types'

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

function statusLabel(status: TaskStatus | RunStatus) {
  if (status === 'enabled') return t('taskEnabled')
  if (status === 'running') return t('taskRunning')
  if (status === 'paused') return t('taskPaused')
  if (status === 'completed') return t('taskFinished')
  if (status === 'success') return t('executionSuccess')
  return t('taskFailed')
}

function statusBadgeClass(status: TaskStatus | RunStatus) {
  if (status === 'enabled' || status === 'success') return 'quickforge-settings-badge-success'
  if (status === 'running') return 'quickforge-settings-badge-info'
  if (status === 'paused') return 'quickforge-settings-badge-warning'
  if (status === 'failed') return 'quickforge-settings-badge-danger'
  return 'quickforge-settings-badge-muted'
}

function executionModeLabel(mode?: ExecutionMode) {
  return mode === 'parallel' ? t('taskExecutionModeParallel') : t('taskExecutionModeSerial')
}

export function taskHasRunningRuns(task: ScheduledTask) {
  return Boolean(task.currentRunId || task.currentRunIds?.length)
}

export function canRunTaskNow(task: ScheduledTask) {
  return (task.executionMode ?? 'serial') === 'parallel' || !taskHasRunningRuns(task)
}

function runConversationAction(run: ScheduledTaskRun, onOpenSession?: (sessionId: string) => void) {
  return (
    <button
      className="quickforge-settings-icon-action"
      type="button"
      disabled={!run.sessionId}
      title={run.sessionId ? t('viewConversation') : t('runNoSession')}
      aria-label={run.sessionId ? t('viewConversation') : t('runNoSession')}
      onClick={() => { if (run.sessionId) onOpenSession?.(run.sessionId) }}
    >
      <MessageSquare className="size-4" />
    </button>
  )
}

export type TaskEditorViewContext = {
  editingTask?: ScheduledTask
  form: FormState
  question: string
  parsedTask: ParsedTask | null
  loading: boolean
  error: string
  selectedModel?: AnyModel
  modelOptions: AnyModel[]
  thinkingLevel: ThinkingLevel
  projects: ProjectOption[]
  selectedProjectId: string
  agentProfiles: AgentProfile[]
  updateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  setSelectedModel: (model?: AnyModel) => void
  setThinkingLevel: (level: ThinkingLevel) => void
  setSelectedProjectId: (projectId: string) => void
  handleParse: () => Promise<void>
  handleSave: () => Promise<void>
  closeDialog: () => void
}

export type TaskDetailViewContext = {
  detailTask: ScheduledTask
  pendingTaskIds: Set<string>
  agentProfiles: AgentProfile[]
  setDetailTaskId: (taskId: string | null) => void
  taskAction: (taskId: string, action: 'run' | 'pause' | 'resume' | 'delete') => Promise<void>
  startEdit: (task: ScheduledTask) => void
  onOpenSession?: (sessionId: string) => void
}

export type TaskListViewContext = {
  tasks: ScheduledTask[]
  activeTab: ActiveTab
  enabledCount: number
  error: string
  loading: boolean
  openMenuTaskId: string | null
  pendingTaskIds: Set<string>
  historyFilters: HistoryFilters
  historyPayload: HistoryPayload
  historyLoading: boolean
  totalHistoryPages: number
  appliedHistoryFilters: HistoryFilters
  setActiveTab: (tab: ActiveTab) => void
  setDetailTaskId: (taskId: string | null) => void
  openCreateDialog: () => void
  loadHistory: (filters?: HistoryFilters) => Promise<void>
  updateHistoryFilter: <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => void
  resetHistoryFilters: () => void
  applyHistoryFilters: () => void
  changeHistoryPage: (page: number) => void
  changeHistoryPageSize: (pageSize: number) => void
  toggleTaskMenu: (event: ReactMouseEvent<HTMLButtonElement>, taskId: string) => void
  taskAction: (taskId: string, action: 'run' | 'pause' | 'resume' | 'delete') => Promise<void>
  onOpenSession?: (sessionId: string) => void
}

// ===== 编辑/新建任务视图 =====
export function renderTaskEditorView(ctx: TaskEditorViewContext) {
  const {
    editingTask,
    form,
    question,
    parsedTask,
    loading,
    error,
    selectedModel,
    modelOptions,
    thinkingLevel,
    projects,
    selectedProjectId,
    agentProfiles,
    updateForm,
    setSelectedModel,
    setThinkingLevel,
    setSelectedProjectId,
    handleParse,
    handleSave,
    closeDialog,
  } = ctx
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
  const scheduleSummary = form.scheduleType === 'cron' ? form.cronExpression
    : form.scheduleType === 'once' ? `${t('taskFrequencyOnce')} · ${formatDateTime(form.executeAt)}`
    : form.scheduleType === 'interval' ? `${t('taskIntervalValue')} ${form.intervalValue} ${{ minute: t('taskUnitMinute'), hour: t('taskUnitHour'), day: t('taskUnitDay') }[form.intervalUnit]} · ${t('taskFirstExecution')} ${formatDateTime(form.executeAt)}`
    : form.scheduleType === 'weekly' ? `${[...form.weekDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => weekLabels[day]).join(' / ')} · ${form.executeTime}`
    : form.scheduleType === 'monthly' ? `${t('taskFrequencyMonthly')} · ${form.monthDay} · ${form.executeTime}`
    : `${t('taskFrequencyDaily')} · ${form.executeTime}`

  return (
    <section className="quickforge-settings-section" aria-label={editingTask ? t('editTask') : t('createTask')}>
      <div className="quickforge-settings-toolbar">
        <button
          className="quickforge-settings-button quickforge-settings-button-secondary"
          type="button"
          disabled={loading}
          onClick={closeDialog}
        >
          <ArrowLeft className="mr-2 size-4" />{t('back')}
        </button>
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">
            {editingTask ? t('editTask') : t('createTask')}
            <InfoTip label={t('scheduledTasksDescription')} />
          </div>
        </div>
      </div>

      <fieldset disabled={loading} aria-busy={loading} className="quickforge-settings-form-grid sm:grid-cols-2 disabled:opacity-60">
        <label className="quickforge-settings-form-row sm:col-span-2">
          <span className="quickforge-settings-form-label">
            <Sparkles className="size-4 text-primary" />
            {t('taskScheduleDescriptionLabel')}
            <InfoTip label={t('quickAiParseTask')} />
          </span>
          <textarea
            className="quickforge-settings-textarea"
            value={form.scheduleText}
            onChange={(event) => updateForm('scheduleText', event.target.value)}
            placeholder={t('taskScheduleDescriptionPlaceholder')}
          />
        </label>
        {question ? <div className="quickforge-settings-warning sm:col-span-2">{question}</div> : null}
        <div className="flex justify-end sm:col-span-2">
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            onClick={handleParse}
            disabled={loading || !selectedModel || !form.scheduleText.trim()}
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}{t('aiParseTask')}
          </button>
        </div>

        {parsedTask ? (
          <div className="quickforge-settings-message sm:col-span-2">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4" />
              {t('aiParsed')}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>{t('taskName')}<span className="text-foreground">{parsedTask.title}</span></div>
              <div>{t('executionRule')}<span className="text-foreground">{parsedTask.scheduleRule}</span></div>
              <div>{t('taskCronExpression')}<span className="quickforge-settings-mono text-foreground">{parsedTask.cronExpression ?? '-'}</span></div>
              <div>{t('nextExecutionTime')}<span className="text-foreground">{formatDateTime(parsedTask.nextRunAt)}</span></div>
              <div className="sm:col-span-2">{t('aiInstruction')}<span className="text-foreground">{parsedTask.instruction}</span></div>
            </div>
          </div>
        ) : null}

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('taskTitleLabel')}</span>
          <input
            className="quickforge-settings-input"
            value={form.title}
            onChange={(event) => updateForm('title', event.target.value)}
            placeholder={t('taskTitlePlaceholder')}
          />
        </label>

        <fieldset className="quickforge-settings-form-row sm:col-span-2" disabled={loading}>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('taskFrequency')}</span>
            <select
              className="quickforge-settings-select"
              value={form.scheduleType}
              onChange={(event) => updateForm('scheduleType', event.target.value as ScheduleType)}
              aria-label={t('taskFrequency')}
            >
              {frequencyOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {form.scheduleType === 'interval' ? <>
              <label className="quickforge-settings-form-row"><span className="quickforge-settings-form-label">{t('taskIntervalValue')}</span><input type="number" min="1" step="1" className="quickforge-settings-input" value={form.intervalValue} onChange={(event) => updateForm('intervalValue', event.target.value)} /></label>
              <label className="quickforge-settings-form-row"><span className="quickforge-settings-form-label">{t('taskIntervalUnit')}</span><select className="quickforge-settings-select" value={form.intervalUnit} onChange={(event) => updateForm('intervalUnit', event.target.value as IntervalUnit)}>
                <option value="minute">{t('taskUnitMinute')}</option><option value="hour">{t('taskUnitHour')}</option><option value="day">{t('taskUnitDay')}</option>
              </select></label>
            </> : null}
            {form.scheduleType === 'once' || form.scheduleType === 'interval' ? <label className="quickforge-settings-form-row sm:col-span-2"><span className="quickforge-settings-form-label">{form.scheduleType === 'interval' ? t('taskFirstExecution') : t('taskExecutionDate')}</span>
              <input type="datetime-local" className="quickforge-settings-input" value={form.executeAt} onChange={(event) => updateForm('executeAt', event.target.value)} />
            </label> : null}
            {['daily', 'weekly', 'monthly'].includes(form.scheduleType) ? <label className="quickforge-settings-form-row"><span className="quickforge-settings-form-label">{t('taskExecutionTime')}</span><input type="time" className="quickforge-settings-input" value={form.executeTime} onChange={(event) => updateForm('executeTime', event.target.value)} /></label> : null}
            {form.scheduleType === 'weekly' ? <fieldset className="sm:col-span-2">
              <legend className="quickforge-settings-form-label mb-2">{t('taskRepeatDays')}</legend>
              <div className="quickforge-settings-segmented flex-wrap">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button key={day} type="button" aria-pressed={form.weekDays.includes(day)} className={cn('quickforge-settings-segmented-option', form.weekDays.includes(day) && 'quickforge-settings-segmented-option-active')} onClick={() => updateForm('weekDays', form.weekDays.includes(day) ? form.weekDays.filter((value) => value !== day) : [...form.weekDays, day])}>{weekLabels[day]}</button>)}</div>
            </fieldset> : null}
            {form.scheduleType === 'monthly' ? <label className="quickforge-settings-form-row"><span className="quickforge-settings-form-label">{t('taskMonthDay')}</span><input type="number" min="1" max="31" step="1" className="quickforge-settings-input" value={form.monthDay} onChange={(event) => updateForm('monthDay', event.target.value)} /><span className="text-xs text-muted-foreground">{t('taskMonthDayHelp')}</span></label> : null}
            {form.scheduleType === 'cron' ? <label className="quickforge-settings-form-row sm:col-span-2"><span className="quickforge-settings-form-label">{t('taskCronExpression')}</span><input className="quickforge-settings-input quickforge-settings-mono" value={form.cronExpression} onChange={(event) => updateForm('cronExpression', event.target.value)} placeholder="0 9 * * 1-5" /><span className="text-xs text-muted-foreground">{t('taskCronHelp')}</span></label> : null}
          </div>
          <p className="text-xs text-muted-foreground">{t('taskScheduleTimezoneHelp')}</p>
          {form.scheduleType === 'interval' ? <p className="text-xs text-muted-foreground">{t('taskIntervalHelp')}</p> : null}
          {scheduleError ? <p role="alert" className="quickforge-settings-alert">{t(scheduleError)}</p> : <div aria-live="polite" className="quickforge-settings-note">
            <div className="text-xs text-muted-foreground">{t('executionRule')}</div>
            <p className="mt-1 text-sm text-foreground">{scheduleSummary}</p>
          </div>}
        </fieldset>

        <label className="quickforge-settings-form-row sm:col-span-2">
          <span className="quickforge-settings-form-label">
            {t('taskExecutionMode')}
            <InfoTip label={t('taskExecutionModeHelp')} />
          </span>
          <select
            className="quickforge-settings-select"
            value={form.executionMode}
            onChange={(event) => updateForm('executionMode', event.target.value as ExecutionMode)}
            aria-label={t('taskExecutionMode')}
          >
            <option value="serial">{t('taskExecutionModeSerial')}</option>
            <option value="parallel">{t('taskExecutionModeParallel')}</option>
          </select>
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('taskModel')}</span>
          <select
            className="quickforge-settings-select"
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

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('taskThinking')}</span>
          <select
            className="quickforge-settings-select"
            value={thinkingLevel}
            onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
          >
            {THINKING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label()}</option>
            ))}
          </select>
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('taskProjectLabel')}</span>
          <select
            className="quickforge-settings-select"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            <option value="">{t('noProjectBound')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('executionAgentLabel')}</span>
          <select
            className="quickforge-settings-select"
            value={form.agentId}
            onChange={(event) => updateForm('agentId', event.target.value)}
          >
            <option value="">{t('defaultAgent')}</option>
            {agentProfiles.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.label}</option>
            ))}
          </select>
        </label>

        <label className="quickforge-settings-form-row sm:col-span-2">
          <span className="quickforge-settings-form-label">{t('promptContentLabel')}</span>
          <textarea
            className="quickforge-settings-textarea"
            value={form.instruction}
            onChange={(event) => updateForm('instruction', event.target.value)}
            placeholder={t('promptContentPlaceholder')}
          />
        </label>

        <div className="flex items-center gap-3 sm:col-span-2">
          <label className="quickforge-settings-switch" aria-disabled={loading ? 'true' : 'false'}>
            <input
              type="checkbox"
              checked={form.enabled}
              aria-label={t('taskEnabledSwitch')}
              onChange={(event) => updateForm('enabled', event.currentTarget.checked)}
            />
            <span aria-hidden="true" />
          </label>
          <span className="quickforge-settings-form-label">{t('taskEnabledSwitch')}</span>
        </div>

        {error ? <div className="quickforge-settings-alert sm:col-span-2">{error}</div> : null}
      </fieldset>

      <div className="quickforge-settings-row">
        <div className="quickforge-settings-row-main" />
        <div className="quickforge-settings-row-control">
          <button className="quickforge-settings-button quickforge-settings-button-secondary" type="button" onClick={closeDialog}>{t('cancel')}</button>
          <button className="quickforge-settings-button quickforge-settings-button-primary" type="button" onClick={handleSave} disabled={loading || !selectedModel || !formIsValid(form)}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {editingTask ? t('saveTask') : t('confirmCreate')}
          </button>
        </div>
      </div>
    </section>
  )
}

// ===== 任务详情视图 =====
export function renderTaskDetailView(ctx: TaskDetailViewContext) {
  const {
    detailTask,
    pendingTaskIds,
    agentProfiles,
    setDetailTaskId,
    taskAction,
    startEdit,
    onOpenSession,
  } = ctx

  function agentLabel(agentId?: string | null) {
    if (!agentId) return t('defaultAgent')
    return agentProfiles.find((agent) => agent.id === agentId || agent.name === agentId)?.label ?? agentId
  }

  return (
    <section className="quickforge-settings-section" aria-label={detailTask.title}>
      <div className="quickforge-settings-toolbar">
        <button
          className="quickforge-settings-button quickforge-settings-button-secondary"
          type="button"
          onClick={() => setDetailTaskId(null)}
        >
          <ArrowLeft className="mr-2 size-4" />{t('back')}
        </button>
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">{detailTask.title}</div>
          <div className="quickforge-settings-row-description">{detailTask.scheduleRule}</div>
          <div className="quickforge-settings-meta">
            <span className={cn('quickforge-settings-badge', statusBadgeClass(detailTask.status))}>{statusLabel(detailTask.status)}</span>
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{executionModeLabel(detailTask.executionMode)}</span>
          </div>
        </div>
      </div>
      <div className="p-5">
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
              <span className="shrink-0 text-xs text-muted-foreground">{t('taskCronExpression')}</span>
              <span className="truncate quickforge-settings-mono text-sm text-foreground">{detailTask.cronExpression ?? '-'}</span>
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
                  <div key={`${detailTask.id}:${run.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                      <span className={cn('quickforge-settings-badge', statusBadgeClass(run.status))}>{statusLabel(run.status)}</span>
                    </span>
                    {runConversationAction(run, onOpenSession)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="quickforge-settings-row">
        <div className="quickforge-settings-row-main" />
        <div className="quickforge-settings-row-control flex-wrap">
          {detailTask.lastSessionId ? <button className="quickforge-settings-button quickforge-settings-button-secondary" type="button" onClick={() => onOpenSession?.(detailTask.lastSessionId!)}>{t('viewConversation')}</button> : null}
          <button className="quickforge-settings-button quickforge-settings-button-secondary" type="button" disabled={pendingTaskIds.has(detailTask.id) || !canRunTaskNow(detailTask)} onClick={() => taskAction(detailTask.id, 'run')}><Zap className="mr-2 size-4" />{t('executeNow')}</button>
          <button className="quickforge-settings-button quickforge-settings-button-secondary" type="button" disabled={pendingTaskIds.has(detailTask.id) || taskHasRunningRuns(detailTask)} onClick={() => startEdit(detailTask)}><Edit3 className="mr-2 size-4" />{t('editTask')}</button>
          <button className="quickforge-settings-button quickforge-settings-button-danger" type="button" disabled={pendingTaskIds.has(detailTask.id) || taskHasRunningRuns(detailTask)} onClick={() => taskAction(detailTask.id, 'delete')}><Trash2 className="mr-2 size-4" />{t('deleteTask')}</button>
        </div>
      </div>
    </section>
  )
}

// ===== 列表 / 历史视图 =====
export function renderTaskListView(ctx: TaskListViewContext) {
  const {
    tasks,
    activeTab,
    enabledCount,
    error,
    loading,
    openMenuTaskId,
    pendingTaskIds,
    historyFilters,
    historyPayload,
    historyLoading,
    totalHistoryPages,
    appliedHistoryFilters,
    setActiveTab,
    setDetailTaskId,
    openCreateDialog,
    loadHistory,
    updateHistoryFilter,
    resetHistoryFilters,
    applyHistoryFilters,
    changeHistoryPage,
    changeHistoryPageSize,
    toggleTaskMenu,
    taskAction,
    onOpenSession,
  } = ctx

  return (
    <section className="quickforge-settings-section" aria-label={t('scheduledTasks')}>
      <div className="quickforge-settings-toolbar">
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">
            <Clock className="size-4 text-primary" />
            {t('scheduledTasks')}
            <InfoTip label={t('scheduledTasksDescription')} />
          </div>
          <div className="quickforge-settings-meta">
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('tasksCount', { total: tasks.length, enabled: enabledCount })}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="quickforge-settings-segmented">
            <button
              className={cn('quickforge-settings-segmented-option', activeTab === 'tasks' && 'quickforge-settings-segmented-option-active')}
              type="button"
              aria-pressed={activeTab === 'tasks'}
              onClick={() => setActiveTab('tasks')}
            >
              {t('taskListTab')}
            </button>
            <button
              className={cn('quickforge-settings-segmented-option', activeTab === 'history' && 'quickforge-settings-segmented-option-active')}
              type="button"
              aria-pressed={activeTab === 'history'}
              onClick={() => { setActiveTab('history'); void loadHistory(appliedHistoryFilters) }}
            >
              {t('executionHistoryTab')}
            </button>
          </div>
          <button
            className="quickforge-settings-button quickforge-settings-button-primary"
            type="button"
            onClick={openCreateDialog}
            disabled={loading}
          >
            <Plus className="mr-2 size-4" />{t('createTask')}
          </button>
        </div>
      </div>

      {error ? <div className="quickforge-settings-alert quickforge-settings-warning-attached">{error}</div> : null}

      {activeTab === 'tasks' ? (
        tasks.length === 0 ? (
          <div className="quickforge-settings-empty-row">{t('noScheduledTasks')}</div>
        ) : tasks.map((task) => {
          const taskEnabled = task.status === 'enabled'
          const taskPending = pendingTaskIds.has(task.id)
          const switchDisabled = taskPending || task.status === 'completed'
          return (
            <div key={task.id} className="quickforge-settings-list-item cursor-pointer" onClick={() => setDetailTaskId(task.id)}>
              <div
                className="quickforge-settings-list-item-main"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  setDetailTaskId(task.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  setDetailTaskId(task.id)
                }}
              >
                <div className="quickforge-settings-row-title" title={task.title}>{task.title}</div>
                <div className="quickforge-settings-row-description" title={task.instruction}>{truncateContent(task.instruction, 20)}</div>
                <div className="quickforge-settings-meta">
                  <span className={cn('quickforge-settings-badge', statusBadgeClass(task.status))}>{statusLabel(task.status)}</span>
                  <span className="quickforge-settings-badge quickforge-settings-badge-muted quickforge-settings-mono">{task.scheduleRule}</span>
                  <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('lastExecution')}{formatDateTime(task.lastRunAt)}</span>
                  <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('nextExecution')}{formatDateTime(task.nextRunAt)}</span>
                </div>
              </div>
              <div className="quickforge-settings-list-item-actions quickforge-settings-icon-actions" onClick={(event) => event.stopPropagation()}>
                <label
                  className="quickforge-settings-switch"
                  aria-disabled={switchDisabled ? 'true' : 'false'}
                  title={task.status === 'paused' ? t('enable') : t('pauseTask')}
                >
                  <input
                    type="checkbox"
                    checked={taskEnabled}
                    aria-label={t('taskEnabledSwitch')}
                    disabled={switchDisabled}
                    onChange={() => taskAction(task.id, task.status === 'paused' ? 'resume' : 'pause')}
                  />
                  <span aria-hidden="true" />
                </label>
                <button
                  className="quickforge-settings-icon-action"
                  type="button"
                  disabled={taskPending}
                  onClick={(event) => toggleTaskMenu(event, task.id)}
                  title={t('moreActions')}
                  aria-label={t('moreActions')}
                  aria-haspopup="menu"
                  aria-expanded={openMenuTaskId === task.id}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
            </div>
          )
        })
      ) : (
        <>
          <div className="quickforge-settings-form-grid sm:grid-cols-2 md:grid-cols-3">
            <div className="quickforge-settings-form-label sm:col-span-2 md:col-span-3">
              <Search className="size-4" />
              {t('historyFilters')}
            </div>
            <label className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">{t('taskName')}</span>
              <select className="quickforge-settings-select" value={historyFilters.taskId} onChange={(event) => updateHistoryFilter('taskId', event.target.value)}>
                <option value="">{t('allTasks')}</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <label className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">{t('status')}</span>
              <select className="quickforge-settings-select" value={historyFilters.status} onChange={(event) => updateHistoryFilter('status', event.target.value as HistoryFilters['status'])}>
                <option value="">{t('allStatuses')}</option>
                <option value="running">{t('executionRunning')}</option>
                <option value="success">{t('executionSuccess')}</option>
                <option value="failed">{t('taskFailed')}</option>
              </select>
            </label>
            <label className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">{t('triggerType')}</span>
              <select className="quickforge-settings-select" value={historyFilters.trigger} onChange={(event) => updateHistoryFilter('trigger', event.target.value as HistoryFilters['trigger'])}>
                <option value="">{t('allTriggers')}</option>
                <option value="schedule">{t('autoRun')}</option>
                <option value="manual">{t('manualRun')}</option>
              </select>
            </label>
            <label className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">{t('startTime')}</span>
              <input type="datetime-local" className="quickforge-settings-input" value={historyFilters.startedFrom} onChange={(event) => updateHistoryFilter('startedFrom', event.target.value)} />
            </label>
            <label className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">{t('endTime')}</span>
              <input type="datetime-local" className="quickforge-settings-input" value={historyFilters.startedTo} onChange={(event) => updateHistoryFilter('startedTo', event.target.value)} />
            </label>
            <label className="quickforge-settings-form-row">
              <span className="quickforge-settings-form-label">{t('keyword')}</span>
              <input className="quickforge-settings-input" value={historyFilters.keyword} onChange={(event) => updateHistoryFilter('keyword', event.target.value)} placeholder={t('keywordPlaceholder')} />
            </label>
          </div>

          <div className="quickforge-settings-row">
            <div className="quickforge-settings-row-main" />
            <div className="quickforge-settings-row-control">
              <button className="quickforge-settings-button quickforge-settings-button-secondary" type="button" onClick={resetHistoryFilters}>{t('reset')}</button>
              <button className="quickforge-settings-button quickforge-settings-button-primary" type="button" onClick={applyHistoryFilters}>{t('query')}</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[600px] grid-cols-[1.3fr_0.7fr_0.7fr_1fr_0.7fr_auto] gap-3 border-b border-border px-5 py-2.5 text-xs font-medium text-muted-foreground">
              <span>{t('taskName')}</span>
              <span>{t('status')}</span>
              <span>{t('triggerType')}</span>
              <span>{t('startTime')}</span>
              <span>{t('runDuration')}</span>
              <span />
            </div>
            {historyLoading ? (
              <div className="quickforge-settings-empty-row inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {t('loading')}
              </div>
            ) : historyPayload.runs.length === 0 ? (
              <div className="quickforge-settings-empty-row">{t('noExecutionHistory')}</div>
            ) : historyPayload.runs.map((run) => (
              <div key={`${run.taskId}:${run.id}`} className="grid min-w-[600px] grid-cols-[1.3fr_0.7fr_0.7fr_1fr_0.7fr_auto] items-center gap-3 border-b border-border px-5 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted">
                <span className="min-w-0 truncate text-foreground">{run.taskTitle}</span>
                <span><span className={cn('quickforge-settings-badge', statusBadgeClass(run.status))}>{statusLabel(run.status)}</span></span>
                <span className="text-muted-foreground">{run.trigger === 'manual' ? t('manualRun') : t('autoRun')}</span>
                <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                <span className="text-muted-foreground">{run.durationMs ? `${run.durationMs}ms` : '-'}</span>
                <span className="flex justify-end">
                  {runConversationAction(run, onOpenSession)}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-muted-foreground">
              <span>{t('paginationSummary', { page: historyPayload.page, pages: totalHistoryPages, total: historyPayload.total })}</span>
              <div className="flex items-center gap-2">
                <div className="w-24">
                  <select className="quickforge-settings-select" value={historyPayload.pageSize} onChange={(event) => changeHistoryPageSize(Number(event.target.value))}>
                    {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{t('pageSize', { size })}</option>)}
                  </select>
                </div>
                <button className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact" type="button" disabled={historyPayload.page <= 1} onClick={() => changeHistoryPage(historyPayload.page - 1)}>{t('previousPage')}</button>
                <button className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact" type="button" disabled={historyPayload.page >= totalHistoryPages} onClick={() => changeHistoryPage(historyPayload.page + 1)}>{t('nextPage')}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
