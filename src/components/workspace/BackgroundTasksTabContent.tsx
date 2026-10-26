/**
 * 后台任务右侧面板内容（Background tasks inspector）。
 *
 * 数据来源：running 任务来自 backgroundCommands 快照（会话内存里正在执行的后台命令），
 * finished 任务派生自会话 toolResult 消息（details.running === false 的终态）。
 * 两者由 `@/lib/background-tasks-model` 统一成 `BackgroundTaskView`；本组件只负责
 * 筛选 / 搜索 / 选中 / 计时与命令日志（`getCommandLog`）的展示，不产生新的数据源。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, ExternalLink, Search, Square, SquareTerminal } from 'lucide-react'
import { t, type AppTextKey } from '@/lib/i18n'
import {
  filterBackgroundTasks,
  formatBackgroundTaskDuration,
  matchesBackgroundTaskQuery,
  type BackgroundTaskFilter,
  type BackgroundTaskStatus,
  type BackgroundTaskView,
} from '@/lib/background-tasks-model'
import { getCommandLog } from './workspace-api'

export type BackgroundTasksTabContentProps = {
  tasks: BackgroundTaskView[]
  sessionId?: string
  onStopTask?: (task: BackgroundTaskView) => void
  onOpenLog?: (task: BackgroundTaskView) => void
}

const FILTERS: BackgroundTaskFilter[] = ['all', 'running', 'finished']

const FILTER_LABEL_KEY: Record<BackgroundTaskFilter, AppTextKey> = {
  all: 'backgroundTaskFilterAll',
  running: 'backgroundTaskFilterRunning',
  finished: 'backgroundTaskFilterFinished',
}

const STATUS_LABEL_KEY: Record<BackgroundTaskStatus, AppTextKey> = {
  running: 'backgroundTaskStatusRunning',
  completed: 'backgroundTaskStatusCompleted',
  failed: 'backgroundTaskStatusFailed',
  timed_out: 'backgroundTaskStatusTimedOut',
  aborted: 'backgroundTaskStatusAborted',
}

/** 每秒重渲染的时间戳来源；非 running 任务用 durationMs / finishedAt 计算。 */
function backgroundTaskElapsedMs(task: BackgroundTaskView, now: number): number | null {
  if (task.status === 'running') {
    if (typeof task.startedAt !== 'number') return null
    return Math.max(0, now - task.startedAt)
  }
  if (typeof task.durationMs === 'number') return task.durationMs
  if (typeof task.startedAt === 'number' && typeof task.finishedAt === 'number') {
    return Math.max(0, task.finishedAt - task.startedAt)
  }
  return null
}

/** 合并后的日志无法区分真实 stderr，只对显式标记行做弱化着色。 */
function isStderrLine(line: string): boolean {
  return line.startsWith('stderr:') || line.startsWith('Error')
}

function backgroundTaskDotClass(status: BackgroundTaskStatus): string {
  return `quickforge-background-tasks-dot is-${status.replaceAll('_', '-')}`
}

type LogSnapshot = {
  key: string
  content: string
  totalLines: number
  available: boolean
}

export function BackgroundTasksTabContent({ tasks, sessionId, onStopTask, onOpenLog }: BackgroundTasksTabContentProps) {
  const [filter, setFilter] = useState<BackgroundTaskFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [followOverride, setFollowOverride] = useState<{ taskId: string; follow: boolean } | null>(null)
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  const [logState, setLogState] = useState<LogSnapshot | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)

  const runningCount = tasks.reduce((count, task) => (task.status === 'running' ? count + 1 : count), 0)
  const finishedCount = tasks.length - runningCount

  const visibleTasks = useMemo(() => {
    const byFilter = filterBackgroundTasks(tasks, filter)
    if (query.trim().length === 0) return byFilter
    return byFilter.filter((task) => matchesBackgroundTaskQuery(task, query))
  }, [tasks, filter, query])

  // 选中项失效（任务被清理）时回落到「第一条 running，否则第一条」，不在 effect 里改 state。
  const defaultTaskId = tasks.find((task) => task.status === 'running')?.taskId ?? tasks[0]?.taskId ?? null
  const resolvedTaskId = selectedTaskId !== null && tasks.some((task) => task.taskId === selectedTaskId)
    ? selectedTaskId
    : defaultTaskId
  const selected = tasks.find((task) => task.taskId === resolvedTaskId) ?? null
  const selectedIsRunning = selected?.status === 'running'
  // 跟随默认值：running 任务默认开启，终态任务恒为关闭；用户显式切换后按 taskId 记住。
  const follow = selectedIsRunning
    ? (followOverride !== null && followOverride.taskId === selected?.taskId ? followOverride.follow : true)
    : false

  // 仅存在 running 任务时按 1s 心跳刷新已运行时长。
  useEffect(() => {
    if (runningCount === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runningCount])

  useEffect(() => () => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
  }, [])

  const logSessionId = sessionId ?? selected?.sessionId ?? null
  const logPath = selected?.outputFile ?? null
  const logKey = logSessionId !== null && logPath !== null ? `${logSessionId}\u0000${logPath}` : null

  useEffect(() => {
    if (logSessionId === null || logPath === null || logKey === null) return
    const controller = new AbortController()
    let disposed = false
    const load = async () => {
      try {
        const response = await getCommandLog(logSessionId, logPath, controller.signal)
        if (disposed) return
        setLogState({ key: logKey, content: response.content, totalLines: response.totalLines, available: true })
      } catch {
        if (disposed) return
        setLogState({ key: logKey, content: '', totalLines: 0, available: false })
      }
    }
    void load()
    const polling = follow && selectedIsRunning
      ? setInterval(() => { void load() }, 2000)
      : null
    return () => {
      disposed = true
      controller.abort()
      if (polling !== null) clearInterval(polling)
    }
  }, [logSessionId, logPath, logKey, follow, selectedIsRunning])

  const log = logState !== null && logState.key === logKey ? logState : null
  const logLines = log !== null && log.available && log.content.length > 0 ? log.content.split('\n') : []

  // 跟随输出时贴底，避免轮询把滚动位置留在旧内容处。
  useEffect(() => {
    if (!follow) return
    const node = outputRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [log, follow])

  const copyCommand = async (taskId: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    setCopiedTaskId(taskId)
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null
      setCopiedTaskId(null)
    }, 1500)
  }

  const stopAll = () => {
    for (const task of tasks) {
      if (task.status === 'running') onStopTask?.(task)
    }
  }

  const filterCount = (value: BackgroundTaskFilter) => {
    if (value === 'running') return runningCount
    if (value === 'finished') return finishedCount
    return tasks.length
  }

  const elapsedLabel = (task: BackgroundTaskView) => {
    const elapsed = backgroundTaskElapsedMs(task, now)
    return elapsed === null ? null : formatBackgroundTaskDuration(elapsed)
  }

  const selectedElapsed = selected === null ? null : elapsedLabel(selected)
  // `backgroundTaskElapsed` / `backgroundTaskExitCode` 都带占位符，去掉参数即 `dt` 的短语标签。
  const elapsedLabelText = t('backgroundTaskElapsed', { duration: '' }).trim()
  const exitCodeLabelText = t('backgroundTaskExitCode', { code: '' }).trim()

  if (tasks.length === 0) {
    return (
      <div className="quickforge-background-tasks">
        <div className="quickforge-background-tasks-empty">
          <SquareTerminal className="size-4 stroke-[1.85]" aria-hidden="true" />
          <div className="quickforge-background-tasks-empty-title">{t('backgroundTaskEmpty')}</div>
          <div className="quickforge-background-tasks-empty-desc">{t('backgroundTaskEmptyDesc')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="quickforge-background-tasks">
      <div className="quickforge-background-tasks-header">
        <span className="quickforge-background-tasks-title">{t('backgroundTaskPanelTitle')}</span>
        {runningCount > 0 && (
          <span
            className="quickforge-background-tasks-count"
            title={t('backgroundTaskRunningCount', { count: runningCount })}
            aria-label={t('backgroundTaskRunningCount', { count: runningCount })}
          >
            {runningCount}
          </span>
        )}
        <div className="quickforge-background-tasks-header-actions">
          <button
            type="button"
            className="quickforge-background-tasks-icon-button"
            aria-label={t('backgroundTaskStopAll')}
            title={t('backgroundTaskStopAll')}
            disabled={runningCount === 0}
            onClick={stopAll}
          >
            <Square className="size-3.5 stroke-[1.85]" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="quickforge-background-tasks-toolbar">
        <div className="quickforge-background-tasks-filters">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'quickforge-background-tasks-filter is-active' : 'quickforge-background-tasks-filter'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(FILTER_LABEL_KEY[value])}
              <span> {filterCount(value)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Search className="size-3.5 shrink-0 stroke-[1.85]" aria-hidden="true" />
          <input
            type="search"
            className="quickforge-background-tasks-search min-w-0 flex-1"
            value={query}
            placeholder={t('backgroundTaskSearchPlaceholder')}
            aria-label={t('backgroundTaskSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="quickforge-background-tasks-list">
        {visibleTasks.map((task) => {
          const active = task.taskId === resolvedTaskId
          const elapsed = elapsedLabel(task)
          const meta = task.status === 'running'
            ? (elapsed ?? t('backgroundTaskStatusRunning'))
            : task.exitCode !== null && task.exitCode !== undefined
              ? t('backgroundTaskExitCode', { code: task.exitCode })
              : t(STATUS_LABEL_KEY[task.status])
          return (
            <button
              key={task.taskId}
              type="button"
              className={active ? 'quickforge-background-tasks-item is-active' : 'quickforge-background-tasks-item'}
              onClick={() => setSelectedTaskId(task.taskId)}
            >
              <span className={backgroundTaskDotClass(task.status)} aria-hidden="true" />
              <span className="quickforge-background-tasks-item-body">
                <span className="quickforge-background-tasks-item-label">{task.description || task.command}</span>
                <span className="quickforge-background-tasks-item-command">{task.command}</span>
              </span>
              <span className="quickforge-background-tasks-item-meta">{meta}</span>
              {task.status === 'running' || task.outputFile
                ? (
                  <span className="quickforge-background-tasks-item-actions">
                    {task.status === 'running' && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="quickforge-background-tasks-icon-button"
                        aria-label={t('backgroundTaskStopAria', { command: task.command })}
                        title={t('backgroundTaskStopAria', { command: task.command })}
                        onClick={(event) => {
                          event.stopPropagation()
                          onStopTask?.(task)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          onStopTask?.(task)
                        }}
                      >
                        <Square className="size-3.5 stroke-[1.85]" aria-hidden="true" />
                      </span>
                    )}
                    {task.outputFile && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="quickforge-background-tasks-icon-button"
                        aria-label={t('backgroundTaskOpenFullLog')}
                        title={t('backgroundTaskOpenFullLog')}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenLog?.(task)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          onOpenLog?.(task)
                        }}
                      >
                        <ExternalLink className="size-3.5 stroke-[1.85]" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                )
                : null}
            </button>
          )
        })}
      </div>

      {selected === null
        ? (
          <div className="quickforge-background-tasks-empty">
            <div className="quickforge-background-tasks-empty-desc">{t('backgroundTaskSelectHint')}</div>
          </div>
        )
        : (
          <div className="quickforge-background-tasks-detail">
            <div className="quickforge-background-tasks-detail-header">
              <div className="quickforge-background-tasks-detail-command">{selected.command}</div>
              <button
                type="button"
                className="quickforge-background-tasks-icon-button"
                aria-label={copiedTaskId === selected.taskId ? t('backgroundTaskCopied') : t('backgroundTaskCopyCommand')}
                title={copiedTaskId === selected.taskId ? t('backgroundTaskCopied') : t('backgroundTaskCopyCommand')}
                onClick={() => { void copyCommand(selected.taskId, selected.command) }}
              >
                <Copy className="size-3.5 stroke-[1.85]" aria-hidden="true" />
              </button>
              {selectedIsRunning && (
                <button
                  type="button"
                  className="quickforge-background-tasks-stop"
                  onClick={() => onStopTask?.(selected)}
                >
                  {t('backgroundTaskStop')}
                </button>
              )}
            </div>

            <dl className="quickforge-background-tasks-meta">
              <dt>{t('backgroundTaskMetaTaskId')}</dt>
              <dd>{selected.taskId}</dd>
              <dt>{t('status')}</dt>
              <dd>{t(STATUS_LABEL_KEY[selected.status])}</dd>
              {typeof selected.startedAt === 'number' && (
                <>
                  <dt>{t('backgroundTaskMetaStartedAt')}</dt>
                  <dd>{new Date(selected.startedAt).toLocaleTimeString()}</dd>
                </>
              )}
              {selectedElapsed !== null && (
                <>
                  <dt>{elapsedLabelText}</dt>
                  <dd>{selectedElapsed}</dd>
                </>
              )}
              {!selectedIsRunning && selected.exitCode !== null && selected.exitCode !== undefined && (
                <>
                  <dt>{exitCodeLabelText}</dt>
                  <dd>{selected.exitCode}</dd>
                </>
              )}
              {selected.pid !== null && selected.pid !== undefined && (
                <>
                  <dt>{t('backgroundTaskMetaPid')}</dt>
                  <dd>{selected.pid}</dd>
                </>
              )}
              {selected.outputFile && (
                <>
                  <dt>{t('backgroundTaskMetaLogPath')}</dt>
                  <dd title={selected.outputFile}>{selected.outputFile}</dd>
                </>
              )}
            </dl>

            <div className="quickforge-background-tasks-output">
              <div className="quickforge-background-tasks-output-bar">
                <span>{t('backgroundTaskOutput')}</span>
                {selectedIsRunning && (
                  <button
                    type="button"
                    className={follow ? 'quickforge-background-tasks-follow is-on' : 'quickforge-background-tasks-follow'}
                    aria-pressed={follow}
                    onClick={() => setFollowOverride({ taskId: selected.taskId, follow: !follow })}
                  >
                    <span className="quickforge-background-tasks-follow-dot" aria-hidden="true" />
                    {t('backgroundTaskFollow')}
                  </button>
                )}
              </div>
              <pre className="quickforge-background-tasks-output-scroll" ref={outputRef}>
                {logLines.length === 0
                  ? <span className="quickforge-background-tasks-output-empty">{t('backgroundTaskLogUnavailable')}</span>
                  : logLines.map((line, index) => (
                    <span
                      key={`${index}-${line.length}`}
                      className={isStderrLine(line) ? 'quickforge-background-tasks-output-stderr' : undefined}
                    >
                      {line}
                      {index === logLines.length - 1 ? '' : '\n'}
                    </span>
                  ))}
              </pre>
              {log !== null && log.available && (
                <div className="quickforge-background-tasks-output-footer">
                  <span>{t('backgroundTaskLogHint', { lines: log.totalLines })}</span>
                  {selected.outputFile && (
                    <button
                      type="button"
                      className="quickforge-background-tasks-link"
                      onClick={() => onOpenLog?.(selected)}
                    >
                      {t('backgroundTaskOpenFullLog')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  )
}
