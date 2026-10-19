/**
 * Goal v2 prompts.
 *
 * Planning remains read-only; execution rounds restate the durable plan and
 * evidence so the model does not have to guess what was already accepted.
 */

import { GOAL_MAX_SCOPE_ENTRY_CHARS } from '../agent-goal-state.mjs'

const CHAT_OUTPUT_RULES = `The UI owns goal status and round announcements. Do not repeat the round number, announce continuing or replanning, or narrate submitting complete / waiting for settlement in chat.
Keep substantive analysis, necessary questions, concrete blockers, and a concise final summary of actual work and verification. Never claim the goal is completed before the server's normal-end and persistence barrier.`

function attachmentBlock(goal) {
  if (!Array.isArray(goal.attachments) || !goal.attachments.length) return ''
  const entries = goal.attachments.map((attachment) => {
    const fileName = attachment.fileName || '(unnamed attachment)'
    const path = typeof attachment.path === 'string' && attachment.path ? attachment.path : ''
    return `- ${fileName}: ${path || '(no readable path recorded)'}`
  }).join('\n')
  return `\n\nAttached reference files (read these when needed):\n${entries}`
}

function criteriaBlock(goal) {
  const criteria = goal.plan?.criteria ?? []
  if (!criteria.length) return '- (no criteria recorded yet)'
  return criteria.map((criterion) => {
    const evidence = criterion.evidenceIds?.length ? criterion.evidenceIds.join(', ') : '-'
    return `- [${criterion.id}]${criterion.required ? ' (required)' : ''} ${criterion.status}: ${criterion.description} (evidence: ${evidence})`
  }).join('\n')
}

function evidenceBlock(goal) {
  if (!goal.evidence?.length) return '- (none)'
  return goal.evidence.map((entry) => `- [${entry.id}] ${entry.description} (toolCallId: ${entry.toolCallId || 'none'})`).join('\n')
}

export function goalPlanningPromptV2(goal) {
  return `<goal_planning objective="${escapeXmlAttribute(goal.objective)}">
Plan this goal before any execution. This planning turn is READ-ONLY: you may read files, search, load skills and delegate read-only research subagents, but you must not write files, run commands, use MCP/plugin tools, or start the work.

Then call goal_report exactly once with action="plan" providing:
- criteria: 2-8 acceptance criteria. Each criterion must be objectively verifiable (a command, test, file state, or observable output). Mark subjective or human-judgment criteria as required=false. Never invent criteria you cannot verify.
- scope: the files/areas the work will touch.
- summary: a concise plan (steps, order, validation commands).

Rules:
- Do not execute during this planning turn. Execution starts automatically only after this turn ends normally and is durably saved.
- Keep the objective exactly as given; scope changes require the user to revise the goal.${attachmentBlock(goal)}
${CHAT_OUTPUT_RULES}
</goal_planning>`
}

export function goalRoundPromptV2(goal, round) {
  const maxRounds = goal.maxRounds
  return `<goal_round>
Objective: ${JSON.stringify(goal.objective)}
Round: ${round}/${maxRounds}
Scope: ${goal.plan?.scope?.length ? goal.plan.scope.join(', ') : '(not recorded)'}
Summary so far: ${goal.plan?.summary || '(none)'}

Acceptance criteria:
${criteriaBlock(goal)}

Evidence:
${evidenceBlock(goal)}${attachmentBlock(goal)}

Continue working toward the objective in this same session. Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current. Make concrete progress and verify the result.
- Evidence must reference the toolCallId of a real, successful tool result from this session (read_file, run_command, tests, build...). goal_report/todo_write/ask_user results are not evidence.
- A criterion may only be marked "passed" when it has evidence bound to such a tool result. Never mark a criterion passed on your own judgement.
- Never fabricate passes for unverifiable criteria. Report blocked with a concrete verification limitation, or ask a necessary question; do not request a final human sign-off.
- Completed todos are not acceptance evidence.
- If you are blocked (missing access, failing environment, ambiguous requirement), call goal_report(action="blocked") with a concrete blocker instead of looping.
- When every required criterion is verified, call goal_report(action="complete") and end this turn. The server completes the goal automatically after a normal run end and durable persistence; do not claim completion before that barrier.
${CHAT_OUTPUT_RULES}
</goal_round>`
}

export function goalWrapupPromptV2(goal, outcome) {
  if (outcome === 'complete') {
    return `<goal_complete>
Objective: ${JSON.stringify(goal.objective)}
The goal is marked complete and this autonomous run is ending. Write the closing message to the user now: state the outcome, summarize what was done and how it was verified, and point to the concrete results. Report only what earlier rounds and tool results actually establish; when a detail is not in the session, say so instead of inventing it. Do not call any more tools in this run.
</goal_complete>`
  }
  return `<goal_blocked>
Objective: ${JSON.stringify(goal.objective)}
Blocked: ${JSON.stringify(goal.blocker?.message || '')}
The goal is marked blocked and this autonomous run is ending. Write the closing message to the user now: state what has been completed so far, describe the concrete blocking condition and what you tried, and say exactly what you need from the user to continue. Report only what earlier rounds and tool results actually establish; when a detail is not in the session, say so instead of inventing it. Do not call any more tools in this run.
</goal_blocked>`
}

export function goalCommandStatusText(goal) {
  if (!goal) return 'No goal in this session.'
  const phase = goal.phase === 'active' && goal.activation === 'disarmed' ? 'active (interrupted; resume to continue)' : goal.phase
  const plan = goal.plan?.criteria?.length
    ? `${goal.plan.criteria.length} criteria (${goal.plan.criteria.filter((entry) => entry.status === 'passed').length} passed)`
    : 'not submitted'
  return [
    `Objective: ${goal.objective}`,
    `Phase: ${phase}`,
    `Rounds: ${goal.roundsStarted}/${goal.maxRounds}`,
    `Plan: ${plan}`,
    ...(goal.blocker ? [`Blocker: [${goal.blocker.code}] ${goal.blocker.message}`] : []),
  ].join('\n')
}

function escapeXmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function scopeEntry(value) {
  return typeof value === 'string' ? value.trim().slice(0, GOAL_MAX_SCOPE_ENTRY_CHARS) : ''
}
