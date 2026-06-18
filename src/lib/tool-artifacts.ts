import type { AgentMessage } from '@earendil-works/pi-agent-core'

export type AiTurnArtifact = {
  id: string
  source: 'write_file' | 'edit_file' | 'run_command'
  confidence: 'high' | 'low'
  path?: string
  command?: string
  outputFile?: string
  toolCallId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function latestUserMessageIndex(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}

function artifactKey(artifact: Omit<AiTurnArtifact, 'id'>) {
  return [artifact.source, artifact.path ?? '', artifact.command ?? '', artifact.outputFile ?? '', artifact.toolCallId ?? ''].join('\u0000')
}

export function extractCurrentTurnArtifacts(messages: AgentMessage[] | undefined): AiTurnArtifact[] {
  if (!messages?.length) return []

  const startIndex = latestUserMessageIndex(messages)
  const currentTurnMessages = messages.slice(Math.max(0, startIndex + 1))
  const seen = new Set<string>()
  const artifacts: AiTurnArtifact[] = []

  for (const message of currentTurnMessages) {
    if (message.role !== 'toolResult') continue

    const toolName = typeof message.toolName === 'string' ? message.toolName : ''
    const details = isRecord((message as { details?: unknown }).details) ? (message as { details?: unknown }).details as Record<string, unknown> : undefined
    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined
    if (!details) continue

    let next: Omit<AiTurnArtifact, 'id'> | undefined
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const path = stringField(details, 'path')
      if (path) {
        next = {
          source: toolName,
          confidence: 'high',
          path,
          toolCallId,
        }
      }
    } else if (toolName === 'run_command') {
      const command = stringField(details, 'command')
      const outputFile = stringField(details, 'outputFile')
      if (command || outputFile) {
        next = {
          source: 'run_command',
          confidence: 'low',
          command,
          outputFile,
          toolCallId,
        }
      }
    }

    if (!next) continue
    const key = artifactKey(next)
    if (seen.has(key)) continue
    seen.add(key)
    artifacts.push({ id: `${artifacts.length}:${key}`, ...next })
  }

  return artifacts
}
