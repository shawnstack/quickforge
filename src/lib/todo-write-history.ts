export type TodoWriteHistorySource = 'quickforge' | 'opencode'
export type TodoWriteHistoryStatus = 'running' | 'done' | 'error' | 'called'
export type TodoWriteHistorySummaryKey =
  | 'todoWriteHistoryRunning'
  | 'todoWriteHistoryFailed'
  | 'todoWriteHistorySummary'
  | 'todoWriteHistoryCleared'
  | 'todoWriteHistoryNeutral'

export type TodoWriteHistoryItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

type TodoWriteHistoryResult = {
  isError?: boolean
  details?: unknown
}

export type TodoWriteHistoryViewModel = {
  status: TodoWriteHistoryStatus
  summaryKey: TodoWriteHistorySummaryKey
  summaryParams?: { completed: number; total: number }
  snapshot: TodoWriteHistoryItem[] | null
}

const TODO_WRITE_STATUSES = new Set<TodoWriteHistoryItem['status']>(['pending', 'in_progress', 'completed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeTodoWriteHistoryTodos(value: unknown): TodoWriteHistoryItem[] | null {
  if (!Array.isArray(value) || value.length > 20) return null
  const todos: TodoWriteHistoryItem[] = []
  for (const candidate of value) {
    if (!isRecord(candidate)) return null
    const content = typeof candidate.content === 'string' ? candidate.content.trim() : ''
    const status = candidate.status
    if (!content || content.length > 200 || typeof status !== 'string' || !TODO_WRITE_STATUSES.has(status as TodoWriteHistoryItem['status'])) return null
    todos.push({ content, status: status as TodoWriteHistoryItem['status'] })
  }
  return todos
}

function todoWriteHistoryStatus(result: TodoWriteHistoryResult | undefined, isStreaming?: boolean): TodoWriteHistoryStatus {
  const details = isRecord(result?.details) ? result.details : undefined
  if (result?.isError || details?.aborted === true || details?.timedOut === true) return 'error'
  if (isStreaming) return 'running'
  return result ? 'done' : 'called'
}

function openCodeTodosFromParams(params: Record<string, unknown> | undefined) {
  if (!params) return undefined
  if ('todos' in params) return params.todos
  return isRecord(params.rawInput) ? params.rawInput.todos : undefined
}

export function buildTodoWriteHistoryViewModel({
  source,
  params,
  result,
  isStreaming,
}: {
  source: TodoWriteHistorySource
  params?: Record<string, unknown>
  result?: TodoWriteHistoryResult
  isStreaming?: boolean
}): TodoWriteHistoryViewModel {
  const status = todoWriteHistoryStatus(result, isStreaming)
  if (status === 'running') return { status, summaryKey: 'todoWriteHistoryRunning', snapshot: null }
  if (status === 'error') return { status, summaryKey: 'todoWriteHistoryFailed', snapshot: null }
  if (status !== 'done') return { status, summaryKey: 'todoWriteHistoryNeutral', snapshot: null }

  const details = isRecord(result?.details) ? result.details : undefined
  const snapshot = source === 'quickforge'
    ? normalizeTodoWriteHistoryTodos(details?.todos)
    : normalizeTodoWriteHistoryTodos(openCodeTodosFromParams(params))

  if (!snapshot) return { status, summaryKey: 'todoWriteHistoryNeutral', snapshot: null }
  if (snapshot.length === 0) return { status, summaryKey: 'todoWriteHistoryCleared', snapshot }

  const completed = snapshot.filter((todo) => todo.status === 'completed').length
  return {
    status,
    summaryKey: 'todoWriteHistorySummary',
    summaryParams: { completed, total: snapshot.length },
    snapshot,
  }
}
