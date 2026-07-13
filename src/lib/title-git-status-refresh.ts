const TITLE_GIT_REFRESH_TOOLS = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'run_subagent',
])

type ToolEndEvent = {
  type?: unknown
  sessionId?: unknown
  toolName?: unknown
}

export function shouldRefreshTitleGitStatusOnToolEnd(
  event: ToolEndEvent,
  currentSessionId: string | undefined,
  currentProjectId: string | undefined,
) {
  if (event.type !== 'tool_execution_end') return false
  if (!currentSessionId || event.sessionId !== currentSessionId) return false
  if (!currentProjectId) return false
  return typeof event.toolName === 'string' && TITLE_GIT_REFRESH_TOOLS.has(event.toolName)
}
