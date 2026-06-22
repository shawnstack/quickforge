import type { AgentMessage } from '@earendil-works/pi-agent-core'

export type AiTurnArtifactKind = 'html' | 'image' | 'markdown' | 'code' | 'unknown'

export type AiTurnArtifact = {
  id: string
  source: 'write_file' | 'edit_file' | 'run_command' | 'present_files'
  confidence: 'high' | 'low'
  path?: string
  command?: string
  outputFile?: string
  toolCallId?: string
  preview?: boolean
  defaultPreview?: boolean
  presentation?: 'explicit' | 'inferred'
  kind?: AiTurnArtifactKind
  title?: string
  description?: string
  addedLines?: number
  removedLines?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function booleanField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function diffLineCounts(details?: Record<string, unknown>) {
  const diff = details && isRecord(details.diff) ? details.diff : undefined
  return {
    addedLines: diff ? numberField(diff, 'addedLines') : undefined,
    removedLines: diff ? numberField(diff, 'removedLines') : undefined,
  }
}

function latestUserMessageIndex(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}

function inferArtifactKind(path = ''): AiTurnArtifactKind {
  const lower = path.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (/\.(svg|png|jpe?g|webp|gif|bmp|ico)$/i.test(lower)) return 'image'
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|less|json|jsonc|txt|xml|yml|yaml|toml|ini|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|sh|bash|zsh|ps1)$/i.test(lower)) return 'code'
  return 'unknown'
}

function isPreviewableKind(kind: AiTurnArtifactKind) {
  return kind === 'html' || kind === 'image' || kind === 'markdown' || kind === 'code'
}

function artifactKey(artifact: Omit<AiTurnArtifact, 'id'>) {
  return [artifact.source, artifact.path ?? '', artifact.command ?? '', artifact.outputFile ?? '', artifact.toolCallId ?? '', artifact.preview ? 'preview' : ''].join('\u0000')
}

function addArtifact(artifacts: AiTurnArtifact[], seen: Set<string>, artifact: Omit<AiTurnArtifact, 'id'>) {
  const key = artifactKey(artifact)
  if (seen.has(key)) return
  seen.add(key)
  artifacts.push({ id: `${artifacts.length}:${key}`, ...artifact })
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function presentFilesPayload(message: AgentMessage, details?: Record<string, unknown>) {
  if (details && (Array.isArray(details.files) || Array.isArray(details.previewed))) return details
  const data = (message as { data?: unknown }).data
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!isRecord(item) || item.type !== 'text') continue
      const parsed = parseJsonText(item.text)
      if (isRecord(parsed) && (Array.isArray(parsed.files) || Array.isArray(parsed.previewed))) return parsed
    }
  }
  const content = (message as { content?: unknown }).content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item) || item.type !== 'text') continue
      const parsed = parseJsonText(item.text)
      if (isRecord(parsed) && (Array.isArray(parsed.files) || Array.isArray(parsed.previewed))) return parsed
    }
  }
  return details
}

function normalizePresentedFile(value: unknown) {
  if (typeof value === 'string' && value.trim()) return { path: value }
  if (isRecord(value)) {
    const path = stringField(value, 'path')
    if (!path) return undefined
    return {
      path,
      title: stringField(value, 'title'),
      description: stringField(value, 'description'),
      kind: stringField(value, 'kind') as AiTurnArtifactKind | undefined,
      preview: booleanField(value, 'preview'),
    }
  }
  return undefined
}

function extractArtifactsFromMessages(messages: AgentMessage[]): AiTurnArtifact[] {
  const seen = new Set<string>()
  const artifacts: AiTurnArtifact[] = []

  for (const message of messages) {
    if (message.role !== 'toolResult') continue

    const toolName = typeof message.toolName === 'string' ? message.toolName : ''
    const details = isRecord((message as { details?: unknown }).details) ? (message as { details?: unknown }).details as Record<string, unknown> : undefined
    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined
    if (!details && toolName !== 'present_files') continue

    if (toolName === 'write_file' || toolName === 'edit_file') {
      const path = details ? stringField(details, 'path') : undefined
      if (path) {
        const kind = inferArtifactKind(path)
        const { addedLines, removedLines } = diffLineCounts(details)
        addArtifact(artifacts, seen, {
          source: toolName,
          confidence: 'high',
          path,
          toolCallId,
          kind,
          preview: isPreviewableKind(kind),
          presentation: 'inferred',
          addedLines,
          removedLines,
        })
      }
    } else if (toolName === 'present_files') {
      const payload = presentFilesPayload(message, details)
      const files = isRecord(payload) && Array.isArray(payload.files) ? payload.files : []
      const defaultPreview = isRecord(payload) ? stringField(payload, 'defaultPreview') : undefined
      const previewed = new Set(
        isRecord(payload) && Array.isArray(payload.previewed)
          ? payload.previewed.filter((item): item is string => typeof item === 'string')
          : [],
      )
      for (const item of files) {
        const file = normalizePresentedFile(item)
        if (!file?.path) continue
        const kind = file.kind ?? inferArtifactKind(file.path)
        addArtifact(artifacts, seen, {
          source: 'present_files',
          confidence: 'high',
          path: file.path,
          title: file.title,
          description: file.description,
          toolCallId,
          kind,
          preview: file.preview ?? (previewed.has(file.path) || defaultPreview === file.path || isPreviewableKind(kind)),
          defaultPreview: defaultPreview === file.path,
          presentation: 'explicit',
        })
      }
    } else if (toolName === 'run_command' && details) {
      const command = stringField(details, 'command')
      const outputFile = stringField(details, 'outputFile')
      if (command || outputFile) {
        addArtifact(artifacts, seen, {
          source: 'run_command',
          confidence: 'low',
          command,
          outputFile,
          toolCallId,
        })
      }
    }
  }

  return artifacts
}

export function extractCurrentTurnArtifacts(messages: AgentMessage[] | undefined): AiTurnArtifact[] {
  if (!messages?.length) return []
  const startIndex = latestUserMessageIndex(messages)
  return extractArtifactsFromMessages(messages.slice(Math.max(0, startIndex + 1)))
}

export function extractSessionArtifacts(messages: AgentMessage[] | undefined): AiTurnArtifact[] {
  if (!messages?.length) return []
  return extractArtifactsFromMessages(messages)
}
