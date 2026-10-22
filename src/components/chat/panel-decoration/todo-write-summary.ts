import type { AppTextKey } from '@/lib/i18n'

export type TodoWriteStatus = 'pending' | 'in_progress' | 'completed'

export type TodoWriteItem = {
  content: string
  status: TodoWriteStatus
}

export type TodoWriteSnapshot = {
  todos: TodoWriteItem[]
}

export type TodoWriteMessage = {
  role?: string
  content?: unknown
  toolName?: string
  toolCallId?: string
  isError?: boolean
  details?: unknown
}

const TODO_WRITE_STATUSES = new Set<TodoWriteStatus>(['pending', 'in_progress', 'completed'])

/** Shared i18n key per status, so the renderer and any other caller agree. */
export const TODO_WRITE_STATUS_LABEL_KEY: Record<TodoWriteStatus, AppTextKey> = {
  completed: 'todoWriteStatusCompleted',
  in_progress: 'todoWriteStatusInProgress',
  pending: 'todoWriteStatusPending',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeTodoWriteTodos(value: unknown): TodoWriteItem[] | null {
  if (!Array.isArray(value) || value.length > 20) return null
  const todos: TodoWriteItem[] = []
  for (const candidate of value) {
    if (!isRecord(candidate)) return null
    const content = typeof candidate.content === 'string' ? candidate.content.trim() : ''
    const status = candidate.status
    if (!content || content.length > 200 || typeof status !== 'string' || !TODO_WRITE_STATUSES.has(status as TodoWriteStatus)) return null
    todos.push({ content, status: status as TodoWriteStatus })
  }
  return todos
}

/**
 * Scan the current full message list and return the newest valid todo snapshot
 * together with a stable key identifying that tool result. A malformed newer
 * candidate is ignored so the previous valid snapshot stays visible. A valid
 * empty array is preserved as an explicit cleared snapshot.
 *
 * The key is what lets the renderer tell "same content, newer round" (show the
 * updated marker) from "same snapshot, another decorate pass" (do nothing).
 */
export function readLatestTodoWriteSnapshot(messages: readonly TodoWriteMessage[]): { snapshot: TodoWriteSnapshot; key: string } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== 'toolResult' || message.isError === true) continue

    if (message.toolName === 'todo_write') {
      const details = isRecord(message.details) ? message.details : undefined
      const todos = details && 'todos' in details ? normalizeTodoWriteTodos(details.todos) : null
      if (todos) return { snapshot: { todos }, key: `quickforge:${message.toolCallId ?? index}` }
      continue
    }
  }

  return null
}

/** Newest valid todo snapshot, without the identity key. */
export function extractLatestTodoWriteSnapshot(messages: readonly TodoWriteMessage[]): TodoWriteSnapshot | null {
  return readLatestTodoWriteSnapshot(messages)?.snapshot ?? null
}

export function todoWriteCounts(todos: readonly TodoWriteItem[]) {
  return {
    total: todos.length,
    pending: todos.filter((todo) => todo.status === 'pending').length,
    inProgress: todos.filter((todo) => todo.status === 'in_progress').length,
    completed: todos.filter((todo) => todo.status === 'completed').length,
  }
}

/**
 * True when every todo is completed. The capsule auto-collapses on these
 * snapshots, so a finished round does not sit expanded above the composer.
 */
export function isFinalTodoSnapshot(todos: readonly TodoWriteItem[]): boolean {
  const counts = todoWriteCounts(todos)
  return counts.total > 0 && counts.completed === counts.total
}
