import { t } from '@/lib/i18n'

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

type TodoWriteSummaryEnv = {
  setTimeout: (handler: () => void, ms: number) => unknown
  clearTimeout: (token: unknown) => void
}

export type TodoWriteSummaryController = {
  update: () => void
  cleanup: () => void
}

const TODO_WRITE_STATUSES = new Set<TodoWriteStatus>(['pending', 'in_progress', 'completed'])
const UPDATED_MARKER_DURATION_MS = 1800

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

export function isTodoWriteAcpMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false
  return [value.kind, value.title].some((candidate) => (
    typeof candidate === 'string'
    && candidate.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '') === 'todowrite'
  ))
}

function assistantToolCallArgumentsForResult(messages: readonly TodoWriteMessage[], resultIndex: number, toolCallId: string) {
  for (let index = resultIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = message.content[blockIndex]
      if (isRecord(block) && block.type === 'toolCall' && block.id === toolCallId && isRecord(block.arguments)) {
        return block.arguments
      }
    }
  }
  return undefined
}

function openCodeTodosFromArguments(args: Record<string, unknown> | undefined) {
  if (!args) return undefined
  if ('todos' in args) return args.todos
  return isRecord(args.rawInput) ? args.rawInput.todos : undefined
}

function scanLatestTodoWriteSnapshot(messages: readonly TodoWriteMessage[]): { snapshot: TodoWriteSnapshot; key: string } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== 'toolResult' || message.isError === true) continue

    if (message.toolName === 'todo_write') {
      const details = isRecord(message.details) ? message.details : undefined
      const todos = details && 'todos' in details ? normalizeTodoWriteTodos(details.todos) : null
      if (todos) return { snapshot: { todos }, key: `quickforge:${message.toolCallId ?? index}` }
      continue
    }

    if (message.toolName !== 'opencode_tool' || typeof message.toolCallId !== 'string') continue
    const details = isRecord(message.details) ? message.details : undefined
    const detailsMetadata = details?.__quickforgeAcp
    let args: Record<string, unknown> | undefined
    if (!isTodoWriteAcpMetadata(detailsMetadata)) {
      args = assistantToolCallArgumentsForResult(messages, index, message.toolCallId)
      if (!isTodoWriteAcpMetadata(args?.__quickforgeAcp)) continue
    }
    args ??= assistantToolCallArgumentsForResult(messages, index, message.toolCallId)
    const todos = normalizeTodoWriteTodos(openCodeTodosFromArguments(args))
    if (todos) return { snapshot: { todos }, key: `opencode:${message.toolCallId}` }
  }

  return null
}

/**
 * Scan the current full message list and return the newest valid todo snapshot.
 * A malformed newer candidate is ignored so the previous valid snapshot stays
 * visible. A valid empty array is preserved as an explicit cleared snapshot.
 */
export function extractLatestTodoWriteSnapshot(messages: readonly TodoWriteMessage[]): TodoWriteSnapshot | null {
  return scanLatestTodoWriteSnapshot(messages)?.snapshot ?? null
}

export function todoWriteCounts(todos: readonly TodoWriteItem[]) {
  return {
    total: todos.length,
    pending: todos.filter((todo) => todo.status === 'pending').length,
    inProgress: todos.filter((todo) => todo.status === 'in_progress').length,
    completed: todos.filter((todo) => todo.status === 'completed').length,
  }
}

function statusIcon(status: TodoWriteStatus) {
  if (status === 'completed') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>'
  if (status === 'in_progress') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>'
}

function statusLabel(status: TodoWriteStatus) {
  if (status === 'completed') return t('todoWriteStatusCompleted')
  if (status === 'in_progress') return t('todoWriteStatusInProgress')
  return t('todoWriteStatusPending')
}

export function createTodoWriteSummaryController({
  panel,
  getMessages,
  env = {
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (token) => window.clearTimeout(token as number),
  },
}: {
  panel: HTMLElement
  getMessages: () => readonly TodoWriteMessage[]
  env?: TodoWriteSummaryEnv
}): TodoWriteSummaryController {
  let root: HTMLElement | null = null
  let toggle: HTMLButtonElement | null = null
  let body: HTMLElement | null = null
  let updatedMarker: HTMLElement | null = null
  let updatedTimer: unknown
  let snapshotSignature = ''
  let snapshotKey = ''
  let expanded = false

  const clearUpdatedTimer = () => {
    if (updatedTimer === undefined) return
    env.clearTimeout(updatedTimer)
    updatedTimer = undefined
  }

  const removeRoot = () => {
    clearUpdatedTimer()
    toggle?.removeEventListener('click', handleToggle)
    root?.remove()
    root = null
    toggle = null
    body = null
    updatedMarker = null
  }

  const reset = () => {
    removeRoot()
    snapshotSignature = ''
    snapshotKey = ''
    expanded = false
  }

  const syncExpanded = () => {
    if (!toggle || !body || !root) return
    toggle.setAttribute('aria-expanded', String(expanded))
    body.hidden = !expanded
    root.dataset.expanded = String(expanded)
  }

  const handleToggle = () => {
    expanded = !expanded
    syncExpanded()
  }

  const ensureRoot = (editor: HTMLElement) => {
    if (!root) {
      root = document.createElement('section')
      root.className = 'quickforge-todo-summary'
      root.setAttribute('aria-label', t('todoWriteTitle'))

      toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'quickforge-todo-summary-toggle'
      toggle.addEventListener('click', handleToggle)
      root.append(toggle)

      body = document.createElement('div')
      body.className = 'quickforge-todo-summary-body'
      root.append(body)
    }
    const composerShell = editor.parentElement
    if (!composerShell) return
    const suggestionMenu = Array.from(composerShell.children).find((element) => (
      element.classList.contains('quickforge-command-suggestions')
      || element.classList.contains('quickforge-file-reference-suggestions')
    ))
    const insertionTarget = suggestionMenu ?? editor
    if (root.parentElement !== composerShell || root.nextElementSibling !== insertionTarget) {
      composerShell.insertBefore(root, insertionTarget)
    }
  }

  const render = (todos: readonly TodoWriteItem[]) => {
    if (!root || !toggle || !body) return
    const counts = todoWriteCounts(todos)
    toggle.replaceChildren()

    const heading = document.createElement('span')
    heading.className = 'quickforge-todo-summary-heading'
    heading.textContent = t('todoWriteTitle')
    toggle.append(heading)

    const stats = document.createElement('span')
    stats.className = 'quickforge-todo-summary-stats'
    stats.textContent = t('todoWriteStats', counts)
    toggle.append(stats)

    updatedMarker = document.createElement('span')
    updatedMarker.className = 'quickforge-todo-summary-updated'
    updatedMarker.textContent = t('todoWriteUpdated')
    updatedMarker.hidden = true
    updatedMarker.setAttribute('aria-live', 'polite')
    toggle.append(updatedMarker)

    const chevron = document.createElement('span')
    chevron.className = 'quickforge-todo-summary-chevron'
    chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
    toggle.append(chevron)

    const list = document.createElement('ul')
    list.className = 'quickforge-todo-summary-list'
    for (const todo of todos) {
      const item = document.createElement('li')
      item.className = `quickforge-todo-summary-item quickforge-todo-summary-item--${todo.status}`

      const icon = document.createElement('span')
      icon.className = 'quickforge-todo-summary-status-icon'
      icon.innerHTML = statusIcon(todo.status)
      item.append(icon)

      const content = document.createElement('span')
      content.className = 'quickforge-todo-summary-content'
      content.textContent = todo.content
      item.append(content)

      const label = document.createElement('span')
      label.className = 'quickforge-todo-summary-status-label'
      label.textContent = statusLabel(todo.status)
      item.append(label)
      list.append(item)
    }
    body.replaceChildren(list)
    syncExpanded()
  }

  const showUpdatedMarker = () => {
    clearUpdatedTimer()
    if (!updatedMarker) return
    updatedMarker.hidden = false
    updatedTimer = env.setTimeout(() => {
      updatedTimer = undefined
      if (updatedMarker) updatedMarker.hidden = true
    }, UPDATED_MARKER_DURATION_MS)
  }

  return {
    update() {
      const latest = scanLatestTodoWriteSnapshot(getMessages())
      if (!latest || latest.snapshot.todos.length === 0) {
        reset()
        return
      }
      const { snapshot, key: nextSnapshotKey } = latest
      const editor = panel.querySelector<HTMLElement>('message-editor')
      if (!editor?.parentElement) {
        removeRoot()
        return
      }

      const nextSignature = JSON.stringify(snapshot.todos)
      const isNewSnapshot = nextSnapshotKey !== snapshotKey
      const contentChanged = nextSignature !== snapshotSignature
      const isFirstSnapshot = snapshotKey === ''
      if (isNewSnapshot) {
        const counts = todoWriteCounts(snapshot.todos)
        if (isFirstSnapshot) expanded = counts.completed !== counts.total
        else if (counts.completed === counts.total) expanded = false
        snapshotKey = nextSnapshotKey
      }
      if (contentChanged) snapshotSignature = nextSignature

      ensureRoot(editor)
      if (isNewSnapshot || contentChanged || !body?.firstElementChild) render(snapshot.todos)
      else syncExpanded()
      if (isNewSnapshot && !isFirstSnapshot) showUpdatedMarker()
    },
    cleanup() {
      reset()
    },
  }
}
