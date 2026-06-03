/**
 * Tool approval store — shared state and permission helpers.
 *
 * Manages the pending approval queues and command-tool permission checks.
 * The Promise-based approval functions (createApprovalPromise,
 * createAutoCompactApprovalPromise) remain in agent-manager.mjs because
 * they depend on the agent event buses.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes for tool approval

// ---------------------------------------------------------------------------
// Tool categories
// ---------------------------------------------------------------------------

export const commandRestrictedTools = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'run_subagent',
])

export const safeReadTools = new Set([
  'read_file',
  'grep_files',
])

// ---------------------------------------------------------------------------
// Pending approval queues
// ---------------------------------------------------------------------------

/** toolCallId → { resolve, reject, sessionId, toolName, args, source, timeout } */
export const pendingApprovals = new Map()

/** approvalId → { resolve, reject, sessionId, timeout } */
export const pendingAutoCompactApprovals = new Map()

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

export function commandToolPermissionError(session, toolName) {
  const permissions = session?.activeCommandPermissions
  if (!permissions || !commandRestrictedTools.has(toolName)) return null
  if (toolName === 'run_command' && permissions.allowCommands === false) {
    return `Command /${session.activeCommandName} does not allow running shell commands.`
  }
  if (toolName === 'run_subagent' && (permissions.allowSubagents === false || permissions.allowCommands === false)) {
    return `Command /${session.activeCommandName} does not allow running subagents.`
  }
  if ((toolName === 'write_file' || toolName === 'edit_file') && permissions.allowEdit === false) {
    return `Command /${session.activeCommandName} does not allow editing files.`
  }
  return null
}

export function createCommandToolPermissions(session) {
  return (toolName) => commandToolPermissionError(session, toolName)
}
