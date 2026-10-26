/**
 * 后台任务统一视图模型。
 *
 * 数据来源：running 任务来自 backgroundCommands 快照（客户端内存中正在运行的后台
 * 命令），finished 任务派生自会话 toolResult 消息（details.running === false 即终态，
 * 携带 code / aborted / timedOut / durationMs 等信息）。两者客户端都已持有，因此不需要
 * 服务端新增「后台任务列表」接口；同一 taskId 两边都存在时，以消息里的终态为准。
 */

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'aborted'

export type BackgroundTaskView = {
  taskId: string
  toolCallId: string
  sessionId?: string
  command: string
  description?: string
  outputFile?: string
  pid?: number | null
  startedAt?: number
  finishedAt?: number | null
  status: BackgroundTaskStatus
  exitCode?: number | null
  signal?: string | null
  durationMs?: number | null
}

export type BackgroundTaskFilter = 'all' | 'running' | 'finished'

export type ToolResultLikeMessage = {
  role?: string
  toolCallId?: string
  details?: unknown
}

type DetailsRecord = Record<string, unknown>

function isRecord(value: unknown): value is DetailsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: DetailsRecord, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readNumber(source: DetailsRecord, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readNullableNumber(source: DetailsRecord, key: string): number | null | undefined {
  const value = source[key]
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readNullableString(source: DetailsRecord, key: string): string | null | undefined {
  const value = source[key]
  if (value === null) return null
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function deriveFinishedStatus(details: DetailsRecord): BackgroundTaskStatus {
  if (details.aborted === true) return 'aborted'
  if (details.timedOut === true) return 'timed_out'
  if (details.code === 0) return 'completed'
  return 'failed'
}

/** 从 toolResult 消息派生终态任务；条件不满足时返回 null（不抛错）。 */
function finishedTaskFromMessage(
  message: ToolResultLikeMessage,
  fallbackSessionId: string | undefined,
): BackgroundTaskView | null {
  if (message.role !== 'toolResult') return null
  const details = message.details
  if (!isRecord(details)) return null

  const taskId = readString(details, 'taskId')
  if (!taskId) return null
  if (details.running !== false) return null

  const command =
    readString(details, 'command') ??
    readString(details, 'summary') ??
    readString(details, 'description') ??
    ''

  // toolCallId 优先取 details，其次回退到消息顶层字段（旧消息只带顶层）。
  const messageToolCallId = readString(message, 'toolCallId') ?? ''

  return {
    taskId,
    toolCallId: readString(details, 'toolCallId') ?? messageToolCallId,
    sessionId: readString(details, 'sessionId') ?? fallbackSessionId,
    command,
    description: readString(details, 'description'),
    outputFile: readString(details, 'outputFile'),
    pid: readNullableNumber(details, 'pid'),
    startedAt: readNumber(details, 'startedAt'),
    finishedAt: readNullableNumber(details, 'finishedAt') ?? null,
    status: deriveFinishedStatus(details),
    exitCode: readNullableNumber(details, 'code') ?? null,
    signal: readNullableString(details, 'signal') ?? null,
    durationMs: readNullableNumber(details, 'durationMs') ?? null,
  }
}

/** 时间戳降序比较；缺省/非有限值排到最后。 */
function compareTimeDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = typeof a === 'number' && Number.isFinite(a) ? a : undefined
  const bv = typeof b === 'number' && Number.isFinite(b) ? b : undefined
  if (av === undefined && bv === undefined) return 0
  if (av === undefined) return 1
  if (bv === undefined) return -1
  return bv - av
}

function finishedSortTime(task: BackgroundTaskView): number | undefined {
  return task.finishedAt ?? task.startedAt
}

/** running 在前；同组内按时间降序，末位用 taskId 兜底保证稳定排序。 */
function compareTasks(a: BackgroundTaskView, b: BackgroundTaskView): number {
  const aRunning = a.status === 'running'
  const bRunning = b.status === 'running'
  if (aRunning !== bRunning) return aRunning ? -1 : 1

  const primary = aRunning
    ? compareTimeDesc(a.startedAt, b.startedAt)
    : compareTimeDesc(finishedSortTime(a), finishedSortTime(b))
  if (primary !== 0) return primary

  const secondary = compareTimeDesc(a.startedAt, b.startedAt)
  if (secondary !== 0) return secondary

  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0
}

export function buildBackgroundTasks(input: {
  running: readonly {
    taskId: string
    toolCallId?: string | null
    sessionId?: string | null
    command: string
    description?: string
    outputFile?: string | null
    pid?: number | null
    startedAt?: number
  }[]
  messages: readonly ToolResultLikeMessage[]
  sessionId?: string
}): BackgroundTaskView[] {
  const byTaskId = new Map<string, BackgroundTaskView>()

  for (const task of input.running) {
    if (!task || typeof task.taskId !== 'string' || task.taskId.length === 0) continue
    byTaskId.set(task.taskId, {
      taskId: task.taskId,
      toolCallId: task.toolCallId ?? '',
      sessionId: task.sessionId ?? undefined,
      command: task.command,
      description: task.description,
      outputFile: task.outputFile ?? undefined,
      pid: task.pid ?? null,
      startedAt: task.startedAt,
      finishedAt: null,
      status: 'running',
      exitCode: null,
      signal: null,
      durationMs: null,
    })
  }

  // 消息里的终态是权威来源：后写入覆盖 running 快照。
  for (const message of input.messages) {
    const finished = finishedTaskFromMessage(message, input.sessionId)
    if (!finished) continue
    byTaskId.set(finished.taskId, finished)
  }

  return [...byTaskId.values()].sort(compareTasks)
}

export function filterBackgroundTasks(
  tasks: readonly BackgroundTaskView[],
  filter: BackgroundTaskFilter,
): BackgroundTaskView[] {
  if (filter === 'running') return tasks.filter((task) => task.status === 'running')
  if (filter === 'finished') return tasks.filter((task) => task.status !== 'running')
  return [...tasks]
}

export function matchesBackgroundTaskQuery(task: BackgroundTaskView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return [task.command, task.description, task.taskId].some(
    (field) => typeof field === 'string' && field.toLowerCase().includes(needle),
  )
}

export function formatBackgroundTaskDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  if (ms < 1000) return '0s'
  const totalSeconds = Math.floor(ms / 1000)
  if (ms < 60000) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}
