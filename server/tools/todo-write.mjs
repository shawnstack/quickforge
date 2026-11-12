/**
 * todo_write tool: defensive validation of the complete latest todo snapshot.
 *
 * Records task state only. The result rides the normal toolResult message
 * chain with the session; there is no separate todo store or table.
 */
function todoWriteError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

export async function toolTodoWrite(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw todoWriteError('todo_write params must be an object with only a todos array.')
  }
  const paramKeys = Object.keys(params)
  if (paramKeys.length !== 1 || paramKeys[0] !== 'todos') {
    throw todoWriteError('todo_write params must contain only the todos field.')
  }
  if (!Array.isArray(params.todos)) {
    throw todoWriteError('todo_write todos must be an array.')
  }
  if (params.todos.length > 20) {
    throw todoWriteError('todo_write supports at most 20 todos.')
  }

  const allowedStatuses = new Set(['pending', 'in_progress', 'completed'])
  const todos = params.todos.map((todo, index) => {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) {
      throw todoWriteError(`todo_write todos[${index}] must be an object with only content and status.`)
    }
    const keys = Object.keys(todo).sort()
    if (keys.length !== 2 || keys[0] !== 'content' || keys[1] !== 'status') {
      throw todoWriteError(`todo_write todos[${index}] must contain only content and status.`)
    }
    if (typeof todo.content !== 'string') {
      throw todoWriteError(`todo_write todos[${index}].content must be a string.`)
    }
    const content = todo.content.trim()
    if (!content) {
      throw todoWriteError(`todo_write todos[${index}].content must not be empty.`)
    }
    if (content.length > 200) {
      throw todoWriteError(`todo_write todos[${index}].content must be at most 200 characters.`)
    }
    if (!allowedStatuses.has(todo.status)) {
      throw todoWriteError(`todo_write todos[${index}].status must be pending, in_progress, or completed.`)
    }
    return { content, status: todo.status }
  })

  const summary = {
    total: todos.length,
    pending: todos.filter((todo) => todo.status === 'pending').length,
    inProgress: todos.filter((todo) => todo.status === 'in_progress').length,
    completed: todos.filter((todo) => todo.status === 'completed').length,
  }

  return {
    content: todos.length === 0 ? 'Todo list cleared.' : `Updated ${todos.length} todos.`,
    details: { type: 'todo_write_result', todos, summary },
  }
}
