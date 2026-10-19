/**
 * Model-facing goal control tools for Goal v2.
 *
 * `get_goal`, `create_goal` and `update_goal` are mounted for every v2 session,
 * including before a goal exists. Authority is enforced by the host callback:
 * create/edit/pause/resume require a direct human turn; blocked/complete are
 * also allowed during an admitted execution round. `goal_report` remains an
 * optional evidence-bearing path; `update_goal complete` is the DSH-compatible
 * model-declared completion path.
 */

import { Type } from 'typebox'
import { GoalError, GOAL_ERROR_CODES } from './errors.mjs'

const UPDATE_ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked']

export const getGoalTool = {
  name: 'get_goal',
  label: 'Read current goal',
  description: 'Read the current session goal, including the id and revision that update_goal requires.',
  parameters: Type.Object({}, { additionalProperties: false }),
}

export const createGoalTool = {
  name: 'create_goal',
  label: 'Create goal',
  description: 'Create a persisted goal that keeps this session working across automatic continuation rounds. Use it when the direct human request is a long-running objective, even if the user did not say "goal"; not for single-turn work.',
  parameters: Type.Object({
    objective: Type.String({ minLength: 1, maxLength: 4000, description: 'The concrete completion objective inferred from the direct human request.' }),
    max_goal_rounds: Type.Optional(Type.Number({ description: 'Optional positive safe-integer limit on automatic continuation rounds.' })),
  }, { additionalProperties: false }),
}

export const updateGoalTool = {
  name: 'update_goal',
  label: 'Update current goal',
  description: 'Update the current goal. edit, pause and resume require a direct top-level human request; complete and blocked are also allowed during an automatic continuation of this goal. Always read get_goal first and pass the exact id and revision.',
  parameters: Type.Object({
    goal_id: Type.String({ minLength: 1, description: 'Exact id returned by get_goal.' }),
    revision: Type.Number({ description: 'Exact positive revision returned by get_goal.' }),
    action: Type.Union(UPDATE_ACTIONS.map((action) => Type.Literal(action)), { description: 'Lifecycle action.' }),
    objective: Type.Optional(Type.String({ maxLength: 4000, description: 'Replacement objective; valid only with action edit.' })),
    max_goal_rounds: Type.Optional(Type.Number({ description: 'Replacement cap; valid only with action edit.' })),
    blocked_reason: Type.Optional(Type.String({ maxLength: 1000, description: 'Required only with action blocked.' })),
  }, { additionalProperties: false }),
}

function compactGoal(goal, activation) {
  if (!goal) return { goal: null }
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxRounds,
      ...(goal.blocker ? { blockedReason: { code: goal.blocker.code, message: goal.blocker.message } } : {}),
    },
    activation,
  }
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/**
 * @param {{
 *   service: ReturnType<import('./service.mjs').createGoalService>,
 *   sessionId: string,
 *   canCreate?: () => boolean,
 *   canMutate?: (action: string) => boolean,
 *   onCreate?: (goal: object) => Promise<unknown> | unknown,
 *   onChanged?: (action: string, goal: object) => Promise<unknown> | unknown,
 *   blockedAfterRounds?: number,
 * }} deps
 */
export function createGoalTools({
  service,
  sessionId,
  canCreate = () => false,
  canMutate = () => false,
  onCreate = null,
  onChanged = null,
  blockedAfterRounds = 0,
}) {
  const read = () => {
    const goal = service.get(sessionId)
    return compactGoal(goal, service.getActivation(sessionId))
  }
  return [
    {
      ...getGoalTool,
      execute: async () => textResult(read()),
    },
    {
      ...createGoalTool,
      execute: async (_toolCallId, args = {}) => {
        if (!canCreate()) {
          throw new GoalError('create_goal requires a direct human request on a top-level agent.', GOAL_ERROR_CODES.INVALID_TRANSITION, 403)
        }
        const goal = await service.create(sessionId, {
          objective: args.objective,
          maxRounds: args.max_goal_rounds,
        })
        await onCreate?.(goal)
        return textResult(compactGoal(goal, service.getActivation(sessionId)))
      },
    },
    {
      ...updateGoalTool,
      execute: async (_toolCallId, args = {}) => {
        if (!canMutate(args.action)) {
          throw new GoalError(`update_goal action "${args.action}" is not authorized in this turn.`, GOAL_ERROR_CODES.INVALID_TRANSITION, 403)
        }
        const ref = { id: args.goal_id, revision: args.revision }
        if (args.action === 'edit') {
          if (args.blocked_reason !== undefined) {
            throw new GoalError('blocked_reason is valid only with action blocked.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
          }
          await service.edit(sessionId, ref, { objective: args.objective, maxRounds: args.max_goal_rounds })
        } else if (args.action === 'pause') {
          await service.pause(sessionId, ref)
        } else if (args.action === 'resume') {
          const goal = service.get(sessionId)
          if (goal?.phase === 'paused') {
            throw new GoalError('The model cannot resume a paused goal; the user must resume it.', 'GOAL_TOOL_RESUME_PAUSED', 409)
          }
          await service.resume(sessionId, ref)
        } else if (args.action === 'complete') {
          await service.complete(sessionId, ref, { by: 'user' })
        } else if (args.action === 'blocked') {
          const goal = service.get(sessionId)
          if (blockedAfterRounds > 0 && goal && goal.roundsStarted < blockedAfterRounds) {
            throw new GoalError(
              `blocked requires at least ${blockedAfterRounds} goal rounds; current round is ${goal.roundsStarted}.`,
              'GOAL_TOOL_BLOCK_THRESHOLD',
              409,
            )
          }
          if (!args.blocked_reason?.trim()) {
            throw new GoalError('blocked_reason is required with action blocked.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
          }
          await service.block(sessionId, ref, { code: 'model_reported', message: args.blocked_reason })
        }
        await onChanged?.(args.action, service.get(sessionId))
        return textResult(read())
      },
    },
  ]
}
