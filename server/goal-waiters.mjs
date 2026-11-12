/**
 * Goal completion waiter registry — the single owner of the three
 * process-local registries (durable terminal snapshots, stopped sessions,
 * per-session completion waiters) plus waitForGoalCompletion. Other modules
 * reach this mutable state only through the accessors exported here; it is
 * never duplicated. Carved verbatim from agent-goal-runner.mjs (zero
 * behavior change).
 */

import { agentEvents } from './agent-session-events.mjs'
import { agentSessions } from './agent-session-store.mjs'
import * as goalState from './agent-goal-state.mjs'
import { GOAL_CONTINUATION_POLL_MS } from './goal-policy.mjs'
import { waitForGoalIdle } from './goal-session-state.mjs'


// A goal_updated event is not itself a durability acknowledgement (failed
// commits emit it too). Retain only terminal snapshots behind the runner's
// existing commit barriers, independently of live goal object identity.
const durableTerminalGoals = new WeakMap()
const stoppedGoalSessions = new WeakSet()
const goalCompletionWaiters = new Map()

export function recordDurableGoal(session, goal) {
  if (goalState.isGoalTerminalStatus(goal?.status)) {
    durableTerminalGoals.set(session, { goal, messages: [...(session.agent.state.messages || [])] })
  }
}

export function hasGoalCompletionWaiter(sessionId) {
  return Boolean(goalCompletionWaiters.get(sessionId)?.size)
}


export function markGoalSessionStopped(session) {
  stoppedGoalSessions.add(session)
}

export function getGoalCompletionWaiterSet(sessionId) {
  return goalCompletionWaiters.get(sessionId)
}

export function deleteDurableTerminalGoal(session) {
  durableTerminalGoals.delete(session)
}

/**
 * Observe one admitted goal, not one agent turn. Nonterminal states deliberately
 * have no timeout/polling: paused goals can wait for user action indefinitely.
 * Terminal commits still wait for the real Agent to become idle, since cancel
 * publishes its durable state BEFORE calling abort. Only this runner owns those
 * lifecycle details; consumers must not interpret agent_end as goal completion.
 */
export function waitForGoalCompletion(sessionId, goalId) {
  if (!goalId) return Promise.reject(new Error('No goal was created for this run.'))
  const session = agentSessions.get(sessionId)
  if (!session) return Promise.reject(new Error('Goal session was removed before completion.'))
  let waiters = goalCompletionWaiters.get(sessionId)
  if (!waiters) { waiters = new Set(); goalCompletionWaiters.set(sessionId, waiters) }
  return new Promise((resolve, reject) => {
    let checking = false
    let finished = false
    const cleanup = () => {
      finished = true
      agentEvents.removeListener('agent_event', onEvent)
      waiters.delete(dispose)
      if (!waiters.size) goalCompletionWaiters.delete(sessionId)
    }
    const dispose = () => {
      if (finished) return
      cleanup()
      // Retain the original session even after removal/replacement. Never release
      // a caller's serial slot until its underlying Agent has actually stopped.
      void Promise.resolve().then(async () => {
        while (!await waitForGoalIdle(session)) { /* keep waiting for abort */ }
        reject(new Error('Goal session was removed before completion.'))
      })
    }
    waiters.add(dispose)
    const check = async () => {
      if (checking || finished) return
      if (agentSessions.get(sessionId) !== session || stoppedGoalSessions.has(session)) {
        dispose()
        return
      }
      const terminal = durableTerminalGoals.get(session)
      if (terminal?.goal.id !== goalId) {
        if (session.goal?.id !== goalId) dispose()
        return
      }
      checking = true
      try {
        // No wall-clock deadline: releasing a serial slot while an aborted tool
        // is still executing would allow overlapping workspace mutations.
        while (!finished) {
          const idle = await waitForGoalIdle(session)
          if (finished) return
          if (agentSessions.get(sessionId) !== session || stoppedGoalSessions.has(session)) {
            dispose()
            return
          }
          if (idle && !session.goalRun && !session.goalRunSettling && !session.activePromptPromise) {
            cleanup()
            resolve(terminal)
            return
          }
          await new Promise((done) => setTimeout(done, GOAL_CONTINUATION_POLL_MS).unref?.())
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    const onEvent = (event) => {
      if (event.sessionId === sessionId) void check()
    }
    if (stoppedGoalSessions.has(session)) dispose()
    else {
      agentEvents.on('agent_event', onEvent)
      void check()
    }
  })
}
