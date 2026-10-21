/**
 * Goal v2 prompts.
 *
 * Planning remains read-only; execution rounds restate the durable plan and
 * evidence so the model does not have to guess what was already accepted.
 */

const CHAT_OUTPUT_RULES = `The UI owns goal status and round announcements. Do not repeat the round number, announce continuing or replanning, or narrate submitting complete / waiting for settlement in chat.
Keep substantive analysis, necessary questions, concrete blockers, and a concise final summary of actual work and verification. Never claim the goal is completed before the server's normal-end and persistence barrier.`

export function goalRoundPromptV2(goal, round) {
  const maxRounds = goal.maxRounds
  return `<goal_round>
Objective: ${JSON.stringify(goal.objective)}
Round: ${round}/${maxRounds}

Continue working toward the objective in this same session. Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current. Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal, and mark it complete. If work remains, leave the goal active for the next round. Mark blocked only after the same blocking condition persists for at least 3 consecutive goal rounds, and report that concrete condition in the blocked reason; difficulty, uncertainty, or useful remaining work is not blocked.
${CHAT_OUTPUT_RULES}
</goal_round>`
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
