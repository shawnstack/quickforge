import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { GoalIterationMarkerSnapshot } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/** Apply only to a verifiable identity at its original position, never clamp or append. */
export function mergeGoalIterationMarkers(messages: AgentMessage[], markers: GoalIterationMarkerSnapshot[] | undefined, replay = false): AgentMessage[] {
  if (!Array.isArray(markers)) return messages
  let result = messages
  for (const entry of markers) {
    if (!entry || !Number.isInteger(entry.index) || entry.index < 0) continue
    const message = result[entry.index] as (AgentMessage & { id?: string; timestamp?: number; details?: Record<string, unknown> }) | undefined
    if (!message || message.role !== entry.role) continue
    const hasId = typeof entry.id === 'string' && entry.id.length > 0
    const hasTimestamp = typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
    if ((!hasId && !hasTimestamp) || (hasId && message.id !== entry.id)
      || (hasTimestamp && message.timestamp !== entry.timestamp)) continue
    const marker = entry.quickforgeGoalIteration
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
      || (marker.kind !== undefined && marker.kind !== 'planning' && marker.kind !== 'execution')) continue
    const currentMarker = message.details?.quickforgeGoalIteration as Record<string, unknown> | undefined
    // A later message may already carry newer metadata. During replay only
    // replace an existing marker when the snapshot proves it finished later.
    if (currentMarker && replay && !(typeof currentMarker.finishedAt === 'number' && typeof marker.finishedAt === 'number'
      && marker.finishedAt > currentMarker.finishedAt)) continue
    if (currentMarker && typeof currentMarker.finishedAt === 'number' && typeof marker.finishedAt === 'number'
      && currentMarker.finishedAt > marker.finishedAt) continue
    if (JSON.stringify(currentMarker) === JSON.stringify(marker)) continue
    if (result === messages) result = messages.slice()
    result[entry.index] = { ...message, details: { ...message.details, quickforgeGoalIteration: marker } } as AgentMessage
  }
  return result
}

/** 从一份全量消息里收集 marker 快照（acceptFullGoalIterationMarkerSnapshot 的收集半步）。 */
export function collectGoalIterationMarkers(messages: AgentMessage[]): GoalIterationMarkerSnapshot[] {
  const markers: GoalIterationMarkerSnapshot[] = []
  messages.forEach((value, index) => {
    const message = value as AgentMessage & { id?: string; timestamp?: number; details?: Record<string, unknown> }
    const marker = message.details?.quickforgeGoalIteration
    if (marker && typeof marker === 'object' && !Array.isArray(marker)) {
      markers.push({ index, role: message.role, id: message.id, timestamp: message.timestamp, quickforgeGoalIteration: marker as Record<string, unknown> })
    }
  })
  return markers
}

export function acceptGoalIterationMarkerSnapshot(core: ServerAgentCore, markers?: GoalIterationMarkerSnapshot[]): void {
  if (Array.isArray(markers)) core.latestGoalIterationMarkers = markers
  applyGoalIterationMarkers(core, markers)
}

export function acceptFullGoalIterationMarkerSnapshot(core: ServerAgentCore, messages: AgentMessage[]): void {
  acceptGoalIterationMarkerSnapshot(core, collectGoalIterationMarkers(messages))
}

export function replayGoalIterationMarkers(core: ServerAgentCore): void {
  applyGoalIterationMarkers(core, core.latestGoalIterationMarkers, true)
}

function applyGoalIterationMarkers(core: ServerAgentCore, markers?: GoalIterationMarkerSnapshot[], replay = false): void {
  // marker 的 `index`/`seq` 是**会话绝对位置**；本地数组是窗口，必须减去
  // baseSeq 才是可达下标。窗口外的 marker 直接丢弃——滚动到更早历史时会随
  // 新快照重新下发。旧实现直接把绝对下标写进窗口数组，窗口态下标记会落到
  // 无关消息上（或静默越界）。
  const relative = Array.isArray(markers)
    ? markers
        .map((marker) => {
          const absolute = typeof marker.seq === 'number' ? marker.seq : marker.index
          return { ...marker, index: absolute - core.messageBaseSeq }
        })
        .filter((marker) => marker.index >= 0 && marker.index < core.state.messages.length)
    : markers
  const messages = mergeGoalIterationMarkers(core.state.messages, relative, replay)
  if (messages === core.state.messages) return
  core.state.messages = messages
  core.stateVersion++
  core.notifyMessageMetadataChanged()
}
