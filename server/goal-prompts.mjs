/**
 * Goal prompt assembly — planning/continuation prompt text, visible turn
 * labels and XML-attribute escaping. Carved verbatim from
 * agent-goal-runner.mjs (zero behavior change).
 */

import { existsSync } from 'node:fs'


// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const GOAL_CHAT_OUTPUT_RULES = `The UI owns goal status and iteration announcements. Do not repeat the round number, announce continuing or replanning, or narrate submitting complete / waiting for settlement in chat.
Keep substantive analysis, necessary questions, concrete blockers, and a concise final summary of actual work and verification. Never claim the goal is completed before the server's normal-end and persistence barrier.`

function goalAttachmentPrompt(goal) {
  if (!Array.isArray(goal.attachments) || !goal.attachments.length) return ''
  const entries = goal.attachments.map((attachment) => {
    const fileName = attachment.fileName || '(unnamed attachment)'
    const path = typeof attachment.path === 'string' && attachment.path ? attachment.path : ''
    if (!path) return `- ${fileName}: (no readable path recorded)`
    if (!existsSync(path)) return `- ${fileName}: (attachment file no longer available: ${path})`
    return `- ${fileName}: ${path}`
  }).join('\n')
  return `\n\nAttached reference files (read these when needed):\n${entries}`
}

export function goalPlanningPrompt(goal) {
  return `<goal_planning objective="${escapeXmlAttribute(goal.objective)}">
Plan this goal before any execution. This planning turn is READ-ONLY: you may read files, search, load skills and delegate read-only research subagents, but you must not write files, run commands, use MCP/plugin tools, or start the work.

Then call goal_report exactly once with action="plan" providing:
- criteria: 2-8 acceptance criteria. Each criterion must be objectively verifiable (a command, test, file state, or observable output). Mark subjective or human-judgment criteria as required=false. Never invent criteria you cannot verify.
- scope: the files/areas the work will touch.
- summary: a concise plan (steps, order, validation commands).

Rules:
- Do not execute during this planning turn. Execution starts automatically only after this turn ends normally and is durably saved; no plan confirmation is required.
- Keep the objective exactly as given; scope changes require the user to revise the goal.${goalAttachmentPrompt(goal)}
${GOAL_CHAT_OUTPUT_RULES}
</goal_planning>`
}

export function goalContinuationPrompt(goal, round, maxRounds) {
  const criteria = goal.criteria.length
    ? goal.criteria.map((criterion) => {
      const evidence = criterion.evidenceIds.length ? criterion.evidenceIds.join(', ') : '-'
      return `- [${criterion.id}]${criterion.required ? ' (required)' : ''} ${criterion.status}: ${criterion.description} (evidence: ${evidence})`
    }).join('\n')
    : '- (no criteria recorded yet)'
  const evidence = goal.evidence.length
    ? goal.evidence.map((entry) => `- [${entry.id}] ${entry.description} (toolCallId: ${entry.toolCallId || 'none'})`).join('\n')
    : '- (none)'
  return `<goal_continuation round="${round}" max_rounds="${maxRounds}" status="${goal.status}">
Objective: ${goal.objective}
Scope: ${goal.scope.length ? goal.scope.join(', ') : '(not recorded)'}
Summary so far: ${goal.summary || '(none)'}

Acceptance criteria:
${criteria}

Evidence:
${evidence}${goalAttachmentPrompt(goal)}

Continue executing this goal now. Work in small verified steps and call goal_report(action="progress") whenever the plan or evidence changes:
- Evidence must reference the toolCallId of a real, successful tool result from this session (read_file, run_command, tests, build...). goal_report/todo_write/ask_user results are not evidence.
- A criterion may only be marked "passed" when it has evidence bound to such a tool result. Never mark a criterion passed on your own judgement.
- Never fabricate passes for unverifiable criteria. Report blocked with a concrete verification limitation, or ask a necessary question; do not request a final human sign-off.
- Completed todos are not acceptance evidence.
- If you are blocked (missing access, failing environment, ambiguous requirement), call goal_report(action="blocked") with a concrete blocker instead of looping.
- When every required criterion is verified, call goal_report(action="complete") and end this turn. The server completes the goal automatically after a normal run end and durable persistence; do not claim completion before that barrier.
${GOAL_CHAT_OUTPUT_RULES}
</goal_continuation>`
}

export function continuationVisibleText(round, maxRounds) {
  return `继续执行目标（第 ${round}/${maxRounds} 轮）`
}

export function planningVisibleText(attempt) {
  return `重新规划目标（第 ${attempt} 次）`
}

function escapeXmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
