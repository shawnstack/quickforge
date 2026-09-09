import type { AgentMessage } from '@earendil-works/pi-agent-core'

export type AiTurnArtifactKind = 'html' | 'image' | 'markdown' | 'code' | 'pdf' | 'docx' | 'excel' | 'unknown'

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
  /** 轮标识（write_file/edit_file toolResult details.turnId；旧会话可能缺失）。 */
  turnId?: string
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
  const fileName = lower.replace(/\\/g, '/').split('/').pop() || lower
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (/\.(xls|xlsx)$/.test(lower)) return 'excel'
  if (/\.(svg|png|jpe?g|webp|gif|ico)$/i.test(lower)) return 'image'
  if (/\.(md|mdx|markdown)$/i.test(lower)) return 'markdown'
  if (fileName === 'dockerfile' || fileName.endsWith('.dockerfile') || fileName === 'makefile') return 'code'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|less|json|jsonc|txt|csv|tsv|log|sql|xml|yml|yaml|toml|ini|py|rb|go|rs|java|swift|kt|kts|c|h|cpp|hpp|cs|php|sh|bash|zsh|ps1)$/i.test(lower)) return 'code'
  return 'unknown'
}

function isPreviewableKind(kind: AiTurnArtifactKind) {
  return kind === 'html' || kind === 'image' || kind === 'markdown' || kind === 'code' || kind === 'pdf' || kind === 'docx' || kind === 'excel'
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
          turnId: details ? stringField(details, 'turnId') : undefined,
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

/** 按轮切片的产物提取结果（每轮产物卡的口径）。 */
export type AiTurnArtifacts = {
  /**
   * 该轮首条 user 消息（user / user-with-attachments）在完整消息数组中的下标；
   * 首条 user 之前的残余内容（如上下文压缩后的半轮片段）归入 userIndex = -1 的前置组。
   */
  userIndex: number
  artifacts: AiTurnArtifact[]
  /**
   * 该轮全部产物的 turnId 去重集合（来自 toolResult details.turnId，切片序保序）；
   * 一轮 = 原 run + 重试 run 的全部 turnId。无任何 turnId 时为空数组。
   */
  turnIds: string[]
}

/**
 * 轮级撤销的轮键：同一轮 turnIds 集合的稳定标识（App 的 rolledBackTurns
 * 与卡片按钮的已撤销判定共用同一口径）。重试在同轮追加新 turnId 后轮键变化，
 * 旧键残留无害（新产物出现本就该重新武装按钮）。
 */
export function turnRollbackKey(turnIds: string[]) {
  return turnIds.join('|')
}

/** 轮首口径与 process-folding 一致：user 与 user-with-attachments 都算轮首。 */
function isTurnBoundaryMessage(message: AgentMessage) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

/**
 * 按 user 消息边界切轮，返回「每轮新增」的产物列表：
 * - 轮产物 = 该轮切片内的全部产物（内部按切片复用 extractArtifactsFromMessages，
 *   其 seen/id 去重机制天然按切片生效，轮内不重复、跨轮各自独立）；
 * - 无产物的轮不返回（卡片层只给有产物的轮挂卡）；
 * - 首条 user 之前的内容归入 userIndex = -1 的前置组（无轮首，也无轮级撤销）。
 */
export function extractTurnArtifacts(messages: AgentMessage[] | undefined): AiTurnArtifacts[] {
  if (!messages?.length) return []
  const turns: AiTurnArtifacts[] = []
  const pushTurn = (userIndex: number, slice: AgentMessage[]) => {
    const artifacts = extractArtifactsFromMessages(slice)
    if (artifacts.length === 0) return
    // 一轮 = 原 run + 重试 run：该轮全部产物的 turnId 去重（切片序保序）。
    const turnIds = [...new Set(artifacts
      .map((artifact) => artifact.turnId)
      .filter((turnId): turnId is string => Boolean(turnId)))]
    turns.push({ userIndex, artifacts, turnIds })
  }

  let index = 0
  if (!isTurnBoundaryMessage(messages[0])) {
    // 前置组：首条 user 之前的全部内容（最多一个，无轮首边界）。
    let end = 0
    while (end < messages.length && !isTurnBoundaryMessage(messages[end])) end += 1
    pushTurn(-1, messages.slice(0, end))
    index = end
  }
  while (index < messages.length) {
    let end = index + 1
    while (end < messages.length && !isTurnBoundaryMessage(messages[end])) end += 1
    pushTurn(index, messages.slice(index, end))
    index = end
  }
  return turns
}
