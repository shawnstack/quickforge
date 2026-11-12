import type { Api, Model } from '@earendil-works/pi-ai'
import { normalizeAgentAccessMode } from '@/lib/agent-access-mode'
import { normalizeGoalState } from '@/lib/goal'
import { leaseSnapshotFromWire } from '../session-lease-client'
import type { ServerAgentConfig, ServerAgentStateSnapshot } from '../server-agent-types'

export function initialStateFromSnapshot(snapshot: ServerAgentStateSnapshot): NonNullable<ServerAgentConfig['initialState']> {
  return {
    systemPrompt: snapshot.systemPrompt ?? '',
    model: snapshot.model ?? null as unknown as Model<Api>,
    thinkingLevel: snapshot.thinkingLevel ?? 'off',
    messages: snapshot.messages ?? [],
    tools: snapshot.tools ?? [],
    accessMode: normalizeAgentAccessMode(snapshot.accessMode, snapshot.yoloMode),
    yoloMode: Boolean(snapshot.yoloMode),
    isStreaming: Boolean(snapshot.isStreaming),
    pendingToolCalls: snapshot.pendingToolCalls ?? [],
    backgroundCommands: snapshot.backgroundCommands ?? [],
    errorMessage: snapshot.errorMessage,
    contextCompaction: snapshot.contextCompaction,
    contextUsage: snapshot.contextUsage,
    compactionNotice: snapshot.compactionNotice ?? null,
    pendingToolApproval: snapshot.pendingToolApproval,
    pendingAsk: snapshot.pendingAsk,
    persistDegraded: snapshot.persistDegraded === true ? true : undefined,
    sessionLease: snapshot.lease ? leaseSnapshotFromWire(snapshot.lease) : undefined,
    goal: normalizeGoalState(snapshot.goal),
    source: snapshot.source,
    stateVersion: snapshot.stateVersion,
  }
}
