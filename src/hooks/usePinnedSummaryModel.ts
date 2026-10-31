import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { GoalState } from '@/lib/goal'
import { syncGoalUiState } from '@/lib/goal-ui'
import { shouldInvalidatePinnedSummary } from '@/lib/pinned-summary-events'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import {
  MAX_TERMINAL_SUBAGENT_RUNS,
  extractLatestTerminalSubagentRuns,
  extractRunningSubagentRuns,
} from '@/lib/subagent-run-detail'
import { extractLatestTodoWriteSnapshot, type BackgroundCommandSummary } from '@/components/chat/panel-decoration'
import { t } from '@/lib/i18n'

const EMPTY_MESSAGES: AgentMessage[] = []

type PinnedSummaryAgent = {
  state: {
    messages: AgentMessage[]
    pendingToolCalls: Set<string>
    backgroundCommands?: BackgroundCommandSummary[]
    goal?: GoalState | null
  }
  sessionId?: string
  sessionSource?: string
  subscribe: (listener: (event: { type?: string }) => void) => () => void
}

/**
 * Derives the pinned-summary view model from the current agent snapshot.
 *
 * `revision` is bumped by App on the agent events that can change these
 * projections; in-place agent state updates do not change the agent identity.
 */
export function usePinnedSummaryModel({
  agent,
  currentSessionId,
}: {
  agent: PinnedSummaryAgent | null
  currentSessionId?: string
}) {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!agent) return undefined
    return agent.subscribe((event) => {
      if (shouldInvalidatePinnedSummary(String(event.type ?? ''))) {
        setRevision((value) => value + 1)
      }
    })
  }, [agent])

  const invalidate = useCallback(() => setRevision((value) => value + 1), [])

  const messages = agent?.state.messages ?? EMPTY_MESSAGES
  const pendingToolCalls = agent?.state.pendingToolCalls

  const todos = useMemo(() => (
    extractLatestTodoWriteSnapshot(messages)?.todos ?? []
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision tracks in-place agent state updates.
  ), [agent, revision])

  const subagentRuns = useMemo(() => extractLatestTerminalSubagentRuns(
    messages,
    pendingToolCalls,
    getCachedToolDisplaySettings().toolDisplayMode,
    t,
    // The pinned summary shows all finished runs; cap only as a defensive bound.
    MAX_TERMINAL_SUBAGENT_RUNS,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision tracks in-place agent state updates.
  ), [agent, revision])

  const backgroundCommands = useMemo(() => (
    agent?.state.backgroundCommands ?? []
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision tracks in-place agent state updates.
  ), [agent, revision])

  const runningSubagentRuns = useMemo(() => extractRunningSubagentRuns(
    messages,
    pendingToolCalls,
    getCachedToolDisplaySettings().toolDisplayMode,
    t,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision tracks in-place agent state updates.
  ), [agent, revision])

  // Goal mode is disabled server-side for ACP sessions; the card gate must not
  // rely on readOnly/capabilities alone.
  const goalSource = agent?.sessionSource
  const goalEnabled = goalSource !== 'acp'
  const goal = useMemo(() => (
    goalEnabled ? agent?.state.goal ?? null : null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision tracks in-place agent state updates.
  ), [agent, goalEnabled, revision])

  const goalSessionId = agent?.sessionId ?? currentSessionId ?? goal?.sessionId ?? ''

  // The server goal is authoritative: clear stale shared-store drafts/locks when
  // the goal leaves an editable state or is replaced.
  useEffect(() => {
    syncGoalUiState(goalSessionId, goal)
  }, [goal, goalSessionId])

  return {
    messages,
    todos,
    subagentRuns,
    backgroundCommands,
    runningSubagentRuns,
    goal,
    goalEnabled,
    goalSessionId,
    invalidate,
  }
}
