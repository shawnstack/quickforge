import type { AgentEvent, AgentMessage, AgentState, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Model, Usage } from '@earendil-works/pi-ai'
import type { AgentAccessMode, AgentHarness } from '@/lib/types'
import { modelReferenceFromModel, type ModelReference } from '@/lib/model-reference'
import { streamSideChat, type SideChatMessage, type SideChatStreamOptions } from './side-chat-client'

export const MAX_SIDE_CHAT_MESSAGES = 40
export const MAX_SIDE_CHAT_INPUT_CHARS = 12_000
export const MAX_SIDE_CHAT_REQUEST_CHARS = 200_000

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

type SideChatStream = (
  request: Parameters<typeof streamSideChat>[0],
  options: SideChatStreamOptions,
) => Promise<void>

type SideChatRun = {
  controller: AbortController
  userMessage: AgentMessage
  assistantMessage: AssistantMessage
  finished: boolean
  started: boolean
}

export type SideChatAgentState = Omit<AgentState, 'tools' | 'pendingToolCalls'> & {
  tools: []
  pendingToolCalls: Set<string>
  accessMode: AgentAccessMode
  harness: AgentHarness
  yoloMode: false
}

function assistantMessage(model: Model<Api>, text = ''): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function promptText(input: string | AgentMessage | AgentMessage[]): string {
  if (typeof input === 'string') return input
  const message = Array.isArray(input) ? input.at(-1) : input
  if (message?.role !== 'user' || typeof message.content !== 'string') return ''
  return message.content
}

function requestMessage(message: AgentMessage): SideChatMessage | undefined {
  if (message.role === 'user' && typeof message.content === 'string') {
    return { role: 'user', content: message.content, timestamp: message.timestamp }
  }
  if (message.role !== 'assistant') return undefined
  const content = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
  return content ? { role: 'assistant', content, timestamp: message.timestamp } : undefined
}

function requestMessagesWithinBudget(messages: AgentMessage[]): SideChatMessage[] {
  const serialized = messages.flatMap((message) => {
    const request = requestMessage(message)
    return request ? [request] : []
  }).slice(-MAX_SIDE_CHAT_MESSAGES)
  const finalUserIndex = serialized.findLastIndex((message) => message.role === 'user')
  if (finalUserIndex < 0) return []

  const finalUser = serialized[finalUserIndex]
  const kept: SideChatMessage[] = [finalUser]
  let remaining = MAX_SIDE_CHAT_REQUEST_CHARS - finalUser.content.length
  for (let index = finalUserIndex - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = serialized[index]
    if (message.content.length > remaining) break
    kept.unshift(message)
    remaining -= message.content.length
  }
  return kept
}

export class SideChatAgent {
  readonly harness: AgentHarness = 'quickforge'
  readonly streamFn = undefined
  readonly getApiKey = async () => undefined
  sessionId = ''

  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly stream: SideChatStream
  private activeRun: SideChatRun | undefined
  private modelRef: ModelReference
  private messages: AgentMessage[] = []
  private isStreaming = false
  private streamingMessage: AgentMessage | undefined
  private readonly pendingToolCalls = new Set<string>()
  private errorMessage: string | undefined

  readonly state: SideChatAgentState

  constructor(options: { model: Model<Api>; sessionId?: string; stream?: SideChatStream }) {
    this.sessionId = options.sessionId ?? ''
    this.modelRef = modelReferenceFromModel(options.model)
    this.stream = options.stream ?? streamSideChat
    const state = {
      systemPrompt: '',
      model: options.model,
      thinkingLevel: 'off' as ThinkingLevel,
      accessMode: 'default' as AgentAccessMode,
      harness: this.harness,
      yoloMode: false as const,
    } as unknown as SideChatAgentState
    Object.defineProperties(state, {
      messages: {
        get: () => this.messages,
        set: (value: AgentMessage[]) => {
          this.messages = Array.isArray(value)
            ? value.filter((message) => requestMessage(message)).slice(-MAX_SIDE_CHAT_MESSAGES)
            : []
        },
      },
      tools: {
        get: () => [],
        set: () => {},
      },
      isStreaming: { get: () => this.isStreaming },
      streamingMessage: { get: () => this.streamingMessage },
      pendingToolCalls: { get: () => this.pendingToolCalls },
      errorMessage: { get: () => this.errorMessage },
    })
    this.state = state
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setContext(options: { sessionId?: string; model: Model<Api> }): void {
    this.sessionId = options.sessionId ?? ''
    this.state.model = options.model
    this.modelRef = modelReferenceFromModel(options.model)
    this.state.thinkingLevel = 'off'
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.activeRun || this.isStreaming) return
    const content = promptText(input).slice(0, MAX_SIDE_CHAT_INPUT_CHARS)
    if (!content.trim()) return

    const userMessage: AgentMessage = { role: 'user', content, timestamp: Date.now() }
    const responseMessage = assistantMessage(this.state.model)
    const run: SideChatRun = {
      controller: new AbortController(),
      userMessage,
      assistantMessage: responseMessage,
      finished: false,
      started: false,
    }
    this.activeRun = run
    this.isStreaming = true
    this.errorMessage = undefined
    this.messages = [...this.messages, userMessage].slice(-MAX_SIDE_CHAT_MESSAGES)
    this.emit({ type: 'agent_start' })
    this.emit({ type: 'turn_start' })
    this.emit({ type: 'message_start', message: userMessage })
    this.emit({ type: 'message_end', message: userMessage })

    const messages = requestMessagesWithinBudget(this.messages)

    try {
      await this.stream({
        sessionId: this.sessionId || undefined,
        modelRef: this.modelRef,
        messages,
      }, {
        signal: run.controller.signal,
        onDelta: (delta) => this.handleDelta(run, delta),
      })
      if (this.activeRun === run && !run.finished) this.finish(run, 'stop')
    } catch (error) {
      if (this.activeRun !== run || run.finished) return
      this.finish(run, run.controller.signal.aborted ? 'aborted' : 'error', error)
    }
  }

  abort(): void {
    const run = this.activeRun
    if (!run || run.finished) return
    run.controller.abort()
    this.finish(run, 'aborted')
  }

  clear(): void {
    this.reset()
  }

  reset(): void {
    this.abort()
    this.messages = []
    this.isStreaming = false
    this.streamingMessage = undefined
    this.pendingToolCalls.clear()
    this.errorMessage = undefined
  }

  private handleDelta(run: SideChatRun, delta: string): void {
    if (!delta || this.activeRun !== run || run.finished) return
    if (!run.started) {
      run.started = true
      this.streamingMessage = run.assistantMessage
      this.emit({ type: 'message_start', message: run.assistantMessage })
    }
    const textPart = run.assistantMessage.content[0]
    if (!textPart || textPart.type !== 'text') return
    textPart.text += delta
    this.streamingMessage = run.assistantMessage
    this.emit({
      type: 'message_update',
      message: run.assistantMessage,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta, partial: run.assistantMessage },
    })
  }

  private finish(run: SideChatRun, reason: 'stop' | 'error' | 'aborted', error?: unknown): void {
    if (run.finished) return
    run.finished = true
    if (!run.started) {
      run.started = true
      this.emit({ type: 'message_start', message: run.assistantMessage })
    }
    const errorMessage = reason === 'error'
      ? error instanceof Error ? error.message : String(error ?? 'Side chat request failed')
      : reason === 'aborted' ? 'Request aborted' : undefined
    run.assistantMessage.stopReason = reason
    run.assistantMessage.errorMessage = errorMessage
    this.messages = [...this.messages, run.assistantMessage].slice(-MAX_SIDE_CHAT_MESSAGES)
    this.streamingMessage = undefined
    this.isStreaming = false
    this.errorMessage = errorMessage
    this.pendingToolCalls.clear()
    if (this.activeRun === run) this.activeRun = undefined
    this.emit({ type: 'message_end', message: run.assistantMessage })
    this.emit({ type: 'turn_end', message: run.assistantMessage, toolResults: [] })
    if (reason === 'error') this.emit({ type: 'error', error: errorMessage } as unknown as AgentEvent)
    this.emit({ type: 'agent_end', messages: this.messages })
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* ignore */ }
    }
  }
}
