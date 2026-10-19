import type { AppTextKey } from './i18n'

export type GoalToolName = 'get_goal' | 'create_goal' | 'update_goal'
export type GoalToolStatus = 'error' | 'running' | 'done' | 'called'
export type GoalToolPhase = 'active' | 'paused' | 'blocked' | 'complete'
export type GoalToolActivation = 'armed' | 'disarmed'

const PHASES = new Set<GoalToolPhase>(['active', 'paused', 'blocked', 'complete'])
const ACTIVATIONS = new Set<GoalToolActivation>(['armed', 'disarmed'])
const UPDATE_ACTIONS = new Set(['edit', 'pause', 'resume', 'complete', 'blocked'])

const ACTION_KEYS: Record<string, AppTextKey> = {
  edit: 'goalToolActionEdit',
  pause: 'goalToolActionPause',
  resume: 'goalToolActionResume',
  complete: 'goalToolActionComplete',
  blocked: 'goalToolActionBlocked',
}

const PHASE_KEYS: Record<GoalToolPhase, AppTextKey> = {
  active: 'goalToolPhaseActive',
  paused: 'goalToolPhasePaused',
  blocked: 'goalToolPhaseBlocked',
  complete: 'goalToolPhaseComplete',
}

const TITLE_KEYS: Record<GoalToolName, AppTextKey> = {
  get_goal: 'goalToolRead',
  create_goal: 'goalToolCreate',
  update_goal: 'goalToolUpdate',
}

const RUNNING_KEYS: Record<GoalToolName, AppTextKey> = {
  get_goal: 'goalToolReadRunning',
  create_goal: 'goalToolCreateRunning',
  update_goal: 'goalToolUpdateRunning',
}

const FAILED_KEYS: Record<GoalToolName, AppTextKey> = {
  get_goal: 'goalToolReadFailed',
  create_goal: 'goalToolCreateFailed',
  update_goal: 'goalToolUpdateFailed',
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function parseGoalPayload(result: unknown) {
  const output = record(result)
  const content = Array.isArray(output.content) ? output.content : []
  const raw = content.map((block) => {
    const item = record(block)
    return item.type === 'text' ? text(item.text) : ''
  }).filter(Boolean).join('\n')
  if (!raw) return { goal: null, activation: '', outputText: '' }
  try {
    const parsed = record(JSON.parse(raw))
    const goal = parsed.goal === null ? null : record(parsed.goal)
    const phase = text(goal?.phase)
    const activation = text(parsed.activation)
    const objective = text(goal?.objective)
    if (!goal || !PHASES.has(phase as GoalToolPhase) || !objective) {
      return { goal: null, activation: ACTIVATIONS.has(activation as GoalToolActivation) ? activation : '', outputText: '' }
    }
    const blocker = record(goal.blockedReason)
    return {
      goal: {
        objective,
        phase: phase as GoalToolPhase,
        roundsStarted: positiveInteger(goal.roundsStarted),
        maxGoalRounds: positiveInteger(goal.maxGoalRounds),
        blockedReason: text(blocker.message),
      },
      activation: ACTIVATIONS.has(activation as GoalToolActivation) ? activation : '',
      outputText: '',
    }
  } catch {
    return { goal: null, activation: '', outputText: raw }
  }
}

/** Read-only projection of a get/create/update goal tool result. */
export function buildGoalToolHistoryViewModel(
  toolName: string,
  params: unknown,
  result: unknown,
  isStreaming = false,
) {
  const name: GoalToolName = toolName === 'create_goal' || toolName === 'update_goal' ? toolName : 'get_goal'
  const input = record(params)
  const output = record(result)
  const details = record(output.details)
  const status: GoalToolStatus = output.isError === true || details.aborted === true || details.timedOut === true
    ? 'error' : isStreaming ? 'running' : result ? 'done' : 'called'
  const parsed = status === 'done' ? parseGoalPayload(result) : { goal: null, activation: '', outputText: '' }
  const requestedAction = text(input.action)
  const action = UPDATE_ACTIONS.has(requestedAction) ? requestedAction : ''
  const requestedObjective = text(input.objective)
  const objective = parsed.goal?.objective || (status !== 'done' ? requestedObjective : '')
  const phase = parsed.goal?.phase ?? null
  const summaryKey: AppTextKey = status === 'error'
    ? FAILED_KEYS[name]
    : status === 'running'
      ? RUNNING_KEYS[name]
      : parsed.goal ? TITLE_KEYS[name] : name === 'get_goal' && status === 'done' ? 'goalToolNone' : TITLE_KEYS[name]
  return {
    status,
    summaryKey,
    actionKey: action ? ACTION_KEYS[action] : 'goalToolAction' as AppTextKey,
    action,
    phase,
    phaseKey: phase ? PHASE_KEYS[phase] : null,
    activation: parsed.activation,
    objective,
    roundsStarted: parsed.goal?.roundsStarted ?? null,
    maxGoalRounds: parsed.goal?.maxGoalRounds ?? null,
    blockedReason: parsed.goal?.blockedReason || (status !== 'done' ? text(input.blocked_reason) : ''),
    outputText: status === 'error' || status === 'running' || status === 'called' || parsed.goal ? '' : parsed.outputText,
  }
}
