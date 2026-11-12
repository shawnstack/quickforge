/**
 * Goal policy constants — planning permissions, tool whitelists, retry and
 * budget thresholds, timing knobs and the shared request-error factory.
 * Carved verbatim from agent-goal-runner.mjs (single-responsibility split,
 * zero behavior change). Dependency-free so every goal module shares the
 * exact same frozen whitelist instances.
 */




export const GOAL_PLANNING_PERMISSIONS = Object.freeze({ allowEdit: false, allowCommands: false, allowSubagents: true })
// Planning must stay read-only even for full-access sessions: no commands, no
// MCP/plugins, no writes, no writable subagents. todo_write is deliberately
// absent: the shared /plan whitelist (approval-store.planAllowedTools) gates it
// first, so allowing it here would only claim a capability that never worked.
export const GOAL_PLANNING_ALLOWED_TOOLS = new Set([
  'read_file',
  'grep_files',
  'activate_skill',
  'read_skill_resource',
  'ask_user',
  'goal_report',
  'run_subagent',
])
export const GOAL_READONLY_SUBAGENT_POLICIES = new Set(['readonly-research', 'safe-validation', 'review-only'])
// Named profiles are resolved synchronously; only the built-in read-only
// profile is accepted during planning. Anything else must be an inline spec
// with an explicit read-only capabilityPolicy.
export const GOAL_READONLY_SUBAGENT_NAMES = new Set(['explore'])

export const MAX_CONSECUTIVE_GOAL_FAILURES = 2
export const MAX_GOAL_NO_PROGRESS_RUNS = 2
export const MAX_GOAL_PLANNING_ATTEMPTS = 3
export const GOAL_CONTINUATION_IDLE_WAIT_MS = 15_000
export const GOAL_CONTINUATION_POLL_MS = 200
// Only tools that can produce verifiable output count as goal evidence. Control
// plane (goal_report/todo_write/ask_user), delegation (run_subagent), skills,
// memory and other tools are never evidence: a successful tool result is not a
// semantic verification of the goal.
export const GOAL_EVIDENCE_ALLOWED_TOOLS = new Set(['run_command', 'read_file', 'grep_files'])
// After goal_report(action="complete") is recorded, the rest of the turn is
// limited to read-only inspection so nothing can mutate the workspace or the
// report before the user is asked to review a quiescent goal.
export const GOAL_SETTLEMENT_ALLOWED_TOOLS = new Set(['read_file', 'grep_files'])
export const GOAL_BUDGET_HINT = 'Budget exhausted. Use extend_resume to add the default budget to exhausted limits and continue this goal; accumulated usage and progress are preserved.'

export function requestError(message, statusCode = 409, errorCode = 'GOAL_CONFLICT') {
  return Object.assign(new Error(message), { statusCode, errorCode })
}
