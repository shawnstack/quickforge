import type { ModelReference } from '@/lib/model-reference'

export type SideChatRole = 'user' | 'assistant'

export type SideChatMessage = {
  role: SideChatRole
  content: string
  timestamp?: number
}

export type SideChatStreamRequest = {
  sessionId?: string
  modelRef?: ModelReference
  messages: SideChatMessage[]
}

type SideChatStreamEvent =
  | { type: 'meta'; model?: { id?: string; provider?: string }; tools?: unknown[] }
  | { type: 'delta'; delta: string }
  | { type: 'done' }
  | { type: 'error'; error?: string; code?: string }

export type SideChatStreamOptions = {
  signal?: AbortSignal
  onDelta?: (delta: string) => void
}

function serializeModelReference(modelRef: ModelReference): ModelReference {
  if (modelRef.source === 'cloud') {
    return { version: 1, source: 'cloud', catalogId: String(modelRef.catalogId) }
  }
  if (modelRef.source === 'custom') {
    return {
      version: 1,
      source: 'custom',
      providerId: String(modelRef.providerId),
      modelId: String(modelRef.modelId),
    }
  }
  return {
    version: 1,
    source: 'legacy-custom',
    provider: String(modelRef.provider),
    modelId: String(modelRef.modelId),
    ...(typeof modelRef.api === 'string' ? { api: modelRef.api } : {}),
    ...(typeof modelRef.baseUrl === 'string' ? { baseUrl: modelRef.baseUrl } : {}),
  }
}

export function serializeSideChatRequest(request: SideChatStreamRequest): SideChatStreamRequest {
  return {
    ...(typeof request.sessionId === 'string' && request.sessionId.trim() ? { sessionId: request.sessionId.trim() } : {}),
    ...(request.modelRef ? { modelRef: serializeModelReference(request.modelRef) } : {}),
    messages: Array.isArray(request.messages)
      ? request.messages.map((message) => ({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : '',
          ...(typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
            ? { timestamp: message.timestamp }
            : {}),
        }))
      : [],
  }
}

function streamError(event: Extract<SideChatStreamEvent, { type: 'error' }>) {
  const error = new Error(event.error || 'Side chat request failed')
  if (event.code) Object.assign(error, { code: event.code })
  return error
}

export async function streamSideChat(
  request: SideChatStreamRequest,
  options: SideChatStreamOptions = {},
): Promise<void> {
  const response = await fetch('/api/side-chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(serializeSideChatRequest(request)),
    signal: options.signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null
    const error = new Error(payload?.error || `Side chat request failed: HTTP ${response.status}`)
    if (payload?.code) Object.assign(error, { code: payload.code })
    throw error
  }
  if (!response.body) throw new Error('Side chat response body is unavailable')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  const consumeLine = (line: string) => {
    if (!line.trim()) return
    let event: SideChatStreamEvent
    try {
      event = JSON.parse(line) as SideChatStreamEvent
    } catch {
      throw new Error('Side chat returned invalid stream data')
    }
    if (event.type === 'meta') {
      if (Array.isArray(event.tools) && event.tools.length > 0) {
        throw new Error('Side chat returned unsupported tools')
      }
      return
    }
    if (event.type === 'delta') {
      if (typeof event.delta !== 'string') throw new Error('Side chat returned invalid delta data')
      options.onDelta?.(event.delta)
      return
    }
    if (event.type === 'done') {
      completed = true
      return
    }
    if (event.type === 'error') throw streamError(event)
    throw new Error('Side chat returned unsupported stream data')
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (buffer.trim()) consumeLine(buffer)
  if (!completed) throw new Error('Side chat stream ended unexpectedly')
}
