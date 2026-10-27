/**
 * 后台任务右侧面板内容（Background tasks inspector）。
 *
 * 数据来源：running 任务来自 backgroundCommands 快照（会话内存里正在执行的后台命令），
 * finished 任务派生自会话 toolResult 消息（details.running === false 的终态）。
 * 两者由 `@/lib/background-tasks-model` 统一成 `BackgroundTaskView`；本组件只负责
 * 筛选 / 搜索 / 选中 / 计时与命令日志（`getCommandLog`）的展示，不产生新的数据源。
 *
 * 渲染约束：
 * - 1s 心跳下沉到 `BackgroundTaskElapsed` 叶子组件，面板顶层不持有 `now`，
 *   否则每次 tick 都会重新协调整棵日志树（`<pre>` 里有数千个行 `<span>`）。
 * - 列表项是 `div[role="button"]`，内部的「停止 / 打开日志」是真正的 `<button>`：
 *   HTML 规范禁止 interactive 后代嵌套在 `button` 内（nested-interactive），
 *   那会让屏幕阅读器拿不到内层按钮。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, ExternalLink, Search, Square, SquareTerminal } from 'lucide-react'
import { t, type AppTextKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
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

/** 终态任务的耗时是固定值，直接由 durationMs / finishedAt-startedAt 算出，不依赖当前时间。 */
function backgroundTaskStaticElapsedMs(task: BackgroundTaskView): number | null {
  if (task.status === 'running') return null
  if (typeof task.durationMs === 'number') return task.durationMs
  if (typeof task.startedAt === 'number' && typeof task.finishedAt === 'number') {
    return Math.max(0, task.finishedAt - task.startedAt)
  }
  return null
}

/**
 * running 任务的耗时显示：心跳与重渲染只发生在这个叶子组件内，
 * 不会牵动面板顶层（列表命中项 / 日志行都保持原来的 fiber）。
 */
function BackgroundTaskElapsed({ startedAt, running }: { startedAt?: number; running: boolean }) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  if (!running) return null
  return <>{formatBackgroundTaskDuration(startedAt ? Math.max(0, now - startedAt) : 0)}</>
}

/**
 * 合并后的日志无法区分真实 stderr，只对显式标记行做弱化着色。
 * 服务端 `writeCommandLog` 写入的分段头是 `[stderr <ISO 时间>]`（见 server/tools/index.mjs），
 * 因此同时兼容带时间戳 / 不带时间戳两种前缀；`error:` 与 `Error` 开头保留原有的启发式。
 */
function isStderrLine(line: string): boolean {
  return /^\[stderr[\s\]]/i.test(line) || /^error[:\s]/i.test(line) || line.startsWith('Error')
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

/**
 * 日志行渲染单独成 memo 组件：面板因 filter / query / copied 等 state 变化时，
 * 只要日志内容不变就直接 bail out，不必重新协调数千个行 `<span>`
 * （非导出组件，符合 `react-refresh/only-export-components`）。
 */
const LogOutput = memo(function LogOutput({ lines }: { lines: readonly string[] }) {
  const lastIndex = lines.length - 1
  return (
    <>
      {lines.map((line, index) => (
        <span
          key={index}
          className={isStderrLine(line) ? 'quickforge-background-tasks-output-stderr' : undefined}
        >
          {line}
          {index === lastIndex ? '' : '\n'}
        </span>
      ))}
    </>
  )
})

export function BackgroundTasksTabContent({ tasks, sessionId, onStopTask, onOpenLog }: BackgroundTasksTabContentProps) {
  const [filter, setFilter] = useState<BackgroundTaskFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [followOverride, setFollowOverride] = useState<{ taskId: string; follow: boolean } | null>(null)
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  const [logState, setLogState] = useState<LogSnapshot | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)
  // 记录「自动兜底选中的 id」：未手动选择时兜底只发生一次，避免新任务抢占详情。
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null)

  const runningCount = tasks.reduce((count, task) => (task.status === 'running' ? count + 1 : count), 0)
  const finishedCount = tasks.length - runningCount

  const visibleTasks = useMemo(() => {
    const byFilter = filterBackgroundTasks(tasks, filter)
    if (query.trim().length === 0) return byFilter
    return byFilter.filter((task) => matchesBackgroundTaskQuery(task, query))
  }, [tasks, filter, query])

  // 选中项失效（任务被清理）时回落到「第一条 running，否则第一条」，不在 effect 里改 state。
  const preferredDefaultTaskId = tasks.find((task) => task.status === 'running')?.taskId ?? tasks[0]?.taskId ?? null
  const manualTaskId = selectedTaskId !== null && tasks.some((task) => task.taskId === selectedTaskId)
    ? selectedTaskId
    : null
  // 未手动选择时的兜底只钉住一次：新 running 任务排序最前，若每轮都重新取「第一条 running」，
  // 每来一个新后台任务详情就会自己跳走。因此把兜底结果「钉」下来，仅当该任务从 tasks 消失后才重挑。
  // 用 state 而不是 ref：react-hooks/refs 禁止渲染期读写 ref，而带守卫的渲染期 setState
  // 是 React 官方认可的同组件派生写法（同一次渲染内立即以新值继续，不会出现可见的中间态）。
  const pinnedStillExists = pinnedTaskId !== null && tasks.some((task) => task.taskId === pinnedTaskId)
  const autoSelectedTaskId = pinnedStillExists ? pinnedTaskId : preferredDefaultTaskId
  if (autoSelectedTaskId !== pinnedTaskId) setPinnedTaskId(autoSelectedTaskId)
  // 手动选中的任务被清理后 manualTaskId 为 null，自然落回兜底，不会留空详情。
  const resolvedTaskId = manualTaskId ?? autoSelectedTaskId
  // 筛选/搜索后选中项可能不在可见列表里：此时详情跟随可见列表首项，
  // 避免出现「详情有内容但列表没有任何高亮」的脱节状态。selectedTaskId 本身不变，
  // 切回「全部」时自动恢复用户原来的选择。
  const effectiveTaskId = visibleTasks.some((task) => task.taskId === resolvedTaskId)
    ? resolvedTaskId
    : visibleTasks[0]?.taskId ?? null
  const selected = tasks.find((task) => task.taskId === effectiveTaskId) ?? null
  const selectedIsRunning = selected?.status === 'running'
  // 跟随默认值：running 任务默认开启，终态任务恒为关闭；用户显式切换后按 taskId 记住。
  const follow = selectedIsRunning
    ? (followOverride !== null && followOverride.taskId === selected?.taskId ? followOverride.follow : true)
    : false

  useEffect(() => () => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
  }, [])

  // 与 App.tsx 的停止 / 打开日志保持一致：任务自身的 sessionId 优先，面板 sessionId 兜底。
  const logSessionId = selected?.sessionId ?? sessionId ?? null
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
    // `selectedIsRunning` / `follow` 在 deps 里：running → finished 时会补读一次日志，
    // 以便拿到服务端刚写入的尾部（`Command finished.` / `Exit code`）。代价是切换 follow 开关
    // 会额外产生一次请求，这是刻意接受的（拆成两个 effect 反而更难读）。
  }, [logSessionId, logPath, logKey, follow, selectedIsRunning])

  const log = logState !== null && logState.key === logKey ? logState : null
  // 派生 loading：logState 只在请求 settle 后写入 key，key 不匹配即「首屏加载中」。
  // 用派生值而不是 state，切换任务时不会先闪一帧「日志暂不可用」，也少一次渲染。
  const logLoading = logKey !== null && log === null
  const logContent = log !== null && log.available ? log.content : ''
  const logLines = useMemo(
    () => (logContent.length > 0 ? logContent.split('\n') : []),
    [logContent],
  )

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

  const selectedStaticElapsedMs = selected === null ? null : backgroundTaskStaticElapsedMs(selected)
  const selectedHasElapsed = selected !== null && (
    selectedStaticElapsedMs !== null
    || (selectedIsRunning && typeof selected.startedAt === 'number')
  )
  // `backgroundTaskExitCode` 带占位符，去掉参数即 `dt` 的短语标签；
  // 耗时标签用独立 key，避免英文去掉参数后得到小写的 `elapsed`。
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
              {`${t(FILTER_LABEL_KEY[value])} ${filterCount(value)}`}
            </button>
          ))}
        </div>
        <div className="quickforge-background-tasks-search-row">
          <span className="quickforge-background-tasks-search-icon" aria-hidden="true">
            <Search className="size-3.5 stroke-[1.85]" />
          </span>
          <input
            type="search"
            className="quickforge-background-tasks-search"
            value={query}
            placeholder={t('backgroundTaskSearchPlaceholder')}
            aria-label={t('backgroundTaskSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="quickforge-background-tasks-list">
        {visibleTasks.length === 0 && (
          <div className="quickforge-background-tasks-no-results">{t('backgroundTaskNoResults')}</div>
        )}
        {visibleTasks.map((task) => {
          const active = task.taskId === effectiveTaskId
          const taskIsRunning = task.status === 'running'
          const meta = taskIsRunning
            ? (
              typeof task.startedAt === 'number'
                ? <BackgroundTaskElapsed startedAt={task.startedAt} running />
                : t('backgroundTaskStatusRunning')
            )
            : task.exitCode !== null && task.exitCode !== undefined
              ? t('backgroundTaskExitCode', { code: task.exitCode })
              : t(STATUS_LABEL_KEY[task.status])
          return (
            // 外层不能再是 <button>：里面还有真按钮，button 里嵌 interactive 会被 AT 吞掉。
            <div
              key={task.taskId}
              role="button"
              tabIndex={0}
              className={cn('quickforge-background-tasks-item', active && 'is-active')}
              aria-current={active ? 'true' : undefined}
              onClick={() => setSelectedTaskId(task.taskId)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setSelectedTaskId(task.taskId)
              }}
            >
              <span className={backgroundTaskDotClass(task.status)} aria-hidden="true" />
              <span className="quickforge-background-tasks-item-body">
                <span className="quickforge-background-tasks-item-label">{task.description || task.command}</span>
                <span className="quickforge-background-tasks-item-command">{task.command}</span>
              </span>
              <span className="quickforge-background-tasks-item-meta">{meta}</span>
              {taskIsRunning || task.outputFile
                ? (
                  <span className="quickforge-background-tasks-item-actions">
                    {taskIsRunning && (
                      <button
                        type="button"
                        className="quickforge-background-tasks-icon-button"
                        aria-label={t('backgroundTaskStopAria', { command: task.command })}
                        title={t('backgroundTaskStopAria', { command: task.command })}
                        onClick={(event) => {
                          event.stopPropagation()
                          onStopTask?.(task)
                        }}
                        // 空格 / 回车交给原生 button，必须阻止冒泡，否则外层会再选中一次。
                        onKeyDown={(event) => {
                          event.stopPropagation()
                        }}
                      >
                        <Square className="size-3.5 stroke-[1.85]" aria-hidden="true" />
                      </button>
                    )}
                    {task.outputFile && (
                      <button
                        type="button"
                        className="quickforge-background-tasks-icon-button"
                        aria-label={t('backgroundTaskOpenFullLog')}
                        title={t('backgroundTaskOpenFullLog')}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenLog?.(task)
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                        }}
                      >
                        <ExternalLink className="size-3.5 stroke-[1.85]" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                )
                : null}
            </div>
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
              <div className="quickforge-background-tasks-detail-command" title={selected.command}>{selected.command}</div>
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
              {selectedHasElapsed && (
                <>
                  <dt>{t('backgroundTaskMetaElapsed')}</dt>
                  <dd>
                    {selectedIsRunning
                      ? <BackgroundTaskElapsed startedAt={selected.startedAt} running />
                      : formatBackgroundTaskDuration(selectedStaticElapsedMs ?? 0)}
                  </dd>
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
                {logLoading
                  ? <span className="quickforge-background-tasks-output-empty">…</span>
                  : logLines.length === 0
                    ? <span className="quickforge-background-tasks-output-empty">{t('backgroundTaskLogUnavailable')}</span>
                    : <LogOutput lines={logLines} />}
              </pre>
              {log !== null && log.available && (
                <div className="quickforge-background-tasks-output-footer">
                  {/* 文案是「仅显示最后 N 行」，因此传实际渲染行数，而不是文件总行数。 */}
                  <span className="quickforge-background-tasks-output-footer-hint">
                    {logLines.length > 0 ? t('backgroundTaskLogHint', { lines: logLines.length }) : ''}
                  </span>
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
