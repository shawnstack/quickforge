import type { AgentEvent, AgentMessage, AgentState, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { ServerAgent, ServerAgentContextCompaction, ServerAgentContextUsage, PromptCapabilitySelection, FileContextReference } from '@/lib/server-agent'
import type { AgentAccessMode, AgentHarness, ChatScope, ProjectInfo } from '@/lib/types'
import { agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { isManagedQuickForgeCloudModel } from '@/lib/managed-cloud-model'
import { randomId } from '@/lib/random-id'
import { normalizeSelectedCapabilities, withSelectedCapabilitiesSnapshot } from '@/lib/selected-capabilities'

type DeferredSessionAgentOptions = {
  scope: ChatScope
  project?: ProjectInfo
  model: Model<Api>
  thinkingLevel: ThinkingLevel
  accessMode?: AgentAccessMode
  harness: AgentHarness
  yoloMode: boolean
  createAgent: (
    initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
    sessionId?: string,
    options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string; harness?: AgentHarness; accessMode?: AgentAccessMode; yoloMode?: boolean },
  ) => Promise<ServerAgent>
}

export class DeferredSessionAgent {
  sessionId: string
  streamFn = streamSimple
  getApiKey?: (provider: string) => Promise<string | undefined>
  readonly scope: ChatScope
  readonly project?: ProjectInfo
  readonly harness: AgentHarness
  private readonly createAgent: DeferredSessionAgentOptions['createAgent']
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private disposed = false
  private realAgentPromise: Promise<ServerAgent> | undefined

  private promotedAgent: ServerAgent | undefined
  private nextPromptCapabilities: PromptCapabilitySelection[] = []
  private nextPromptContextReferences: FileContextReference[] = []
  private onPromptContextReferencesConsumed?: () => void
  private promptMode: 'plan' | 'ask' | null = null
  private onPromptModeConsumed?: () => void

  state: {
    systemPrompt: string
    model: Model<Api>
    thinkingLevel: ThinkingLevel
    messages: AgentMessage[]
    tools: unknown[]
    accessMode: AgentAccessMode
    yoloMode: boolean
    isStreaming: boolean
    streamingMessage?: AgentMessage
    pendingToolCalls: Set<string>
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
  }

  constructor(options: DeferredSessionAgentOptions) {
    this.sessionId = `pending-${randomId()}`
    this.scope = options.scope
    this.project = options.project
    this.harness = options.harness
    this.createAgent = options.createAgent
    const accessMode = normalizeAgentAccessMode(options.accessMode, options.yoloMode ? 'full-access' : 'default')
    this.state = {
      systemPrompt: '',
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      messages: [],
      tools: [],
      accessMode,
      yoloMode: agentAccessModeToYoloMode(accessMode),
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
      contextCompaction: null,
      contextUsage: null,
    }
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setNextPromptCapabilities(capabilities: PromptCapabilitySelection[]): void {
    this.nextPromptCapabilities = normalizeSelectedCapabilities(capabilities)
  }

  setNextPromptContextReferences(references: FileContextReference[], onConsumed?: () => void): void {
    this.nextPromptContextReferences = Array.isArray(references) ? references.slice(0, 8) : []
    this.onPromptContextReferencesConsumed = this.nextPromptContextReferences.length > 0 ? onConsumed : undefined
  }

  setPromptMode(mode: 'plan' | 'ask' | null, onConsumed?: () => void): void {
    this.promptMode = mode
    this.onPromptModeConsumed = mode ? onConsumed : undefined
  }

  setPlanMode(mode: boolean, onConsumed?: () => void): void {
    this.setPromptMode(mode ? 'plan' : null, onConsumed)
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.disposed || this.state.isStreaming) return

    const normalizedMessage = this.normalizePromptInput(input)
    const selectedCapabilities = normalizeSelectedCapabilities(this.nextPromptCapabilities)
    const optimisticDetailsMessage = withSelectedCapabilitiesSnapshot(
      normalizedMessage as AgentMessage & Record<string, unknown>,
      selectedCapabilities,
    ) as AgentMessage
    const message = (this.nextPromptContextReferences.length > 0
      ? {
          ...optimisticDetailsMessage,
          details: {
            ...((optimisticDetailsMessage as AgentMessage & { details?: unknown }).details
              && typeof (optimisticDetailsMessage as AgentMessage & { details?: unknown }).details === 'object'
              && !Array.isArray((optimisticDetailsMessage as AgentMessage & { details?: unknown }).details)
              ? (optimisticDetailsMessage as AgentMessage & { details: Record<string, unknown> }).details
              : {}),
            contextReferences: this.nextPromptContextReferences,
          },
        }
      : optimisticDetailsMessage) as AgentMessage
    const messageCountBeforeOptimistic = this.state.messages.length

    // Show the first message immediately while the real server session is created.
    this.state.messages = [...this.state.messages, message]
    this.state.contextUsage = null
    this.emitToListeners({ type: 'message_start', message } as unknown as AgentEvent)
    this.state.isStreaming = true
    this.state.errorMessage = undefined
    this.emitToListeners({ type: 'agent_start' } as AgentEvent)

    let realAgent: ServerAgent
    try {
      realAgent = await this.ensureRealAgent()
    } catch (error) {
      if (
        this.state.messages.length === messageCountBeforeOptimistic + 1
        && this.state.messages[this.state.messages.length - 1] === message
      ) {
        this.state.messages = this.state.messages.slice(0, -1)
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.state.errorMessage = errorMessage
      this.state.isStreaming = false
      this.state.streamingMessage = undefined
      this.emitToListeners({ type: 'error', error: errorMessage } as unknown as AgentEvent)
      this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
      throw error
    }

    realAgent.setNextPromptCapabilities(selectedCapabilities)
    realAgent.setNextPromptContextReferences?.(this.nextPromptContextReferences, this.onPromptContextReferencesConsumed)
    realAgent.setPromptMode?.(this.promptMode, this.onPromptModeConsumed)
    this.nextPromptCapabilities = []
    this.nextPromptContextReferences = []
    this.onPromptContextReferencesConsumed = undefined
    this.promptMode = null
    this.onPromptModeConsumed = undefined
    await realAgent.prompt(message)
  }

  abort(): void {
    void this.realAgentPromise?.then((agent) => agent.abort())
  }

  reset(): void {
    this.state.messages = []
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set<string>()
    this.state.errorMessage = undefined
  }

  async rollback(): Promise<never> {
    throw new Error('Cannot roll back a pending chat')
  }

  async continue(): Promise<void> {
    const realAgent = await this.ensureRealAgent()
    await realAgent.continue()
  }

  async approveToolCall(): Promise<never> {
    throw new Error('No pending tool call')
  }

  async rejectToolCall(): Promise<never> {
    throw new Error('No pending tool call')
  }

  async approveAutoCompact(): Promise<never> {
    throw new Error('No pending auto compact request')
  }

  async rejectAutoCompact(): Promise<never> {
    throw new Error('No pending auto compact request')
  }

  async updateAccessMode(accessMode: AgentAccessMode): Promise<void> {
    const normalized = normalizeAgentAccessMode(accessMode)
    this.state.accessMode = normalized
    this.state.yoloMode = agentAccessModeToYoloMode(normalized)
    const realAgent = await this.realAgentPromise
    if (realAgent) await realAgent.updateAccessMode(normalized)
  }

  async updateYoloMode(yoloMode: boolean): Promise<void> {
    await this.updateAccessMode(yoloMode ? 'full-access' : 'default')
  }

  async updateModel(model: Model<Api>): Promise<void> {
    if (this.harness === 'opencode') return
    this.state.model = model
    const realAgent = await this.realAgentPromise
    if (realAgent) await realAgent.updateModel(model)
  }

  async updateThinkingLevel(level: ThinkingLevel): Promise<void> {
    if (this.harness === 'opencode') return
    this.state.thinkingLevel = level
    const realAgent = await this.realAgentPromise
    if (realAgent) await realAgent.updateThinkingLevel(level)
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    if (!this.promotedAgent) {
      void this.realAgentPromise?.then((agent) => {
        if (this.promotedAgent !== agent) agent.dispose()
      }).catch(() => {})
    }
  }

  promoteTo(agent: ServerAgent): void {
    this.promotedAgent = agent
    this.listeners.clear()
  }

  private normalizePromptInput(input: string | AgentMessage | AgentMessage[]): AgentMessage {
    let message: AgentMessage
    if (typeof input === 'string') {
      message = { role: 'user', content: input, timestamp: Date.now() } as AgentMessage
    } else if (Array.isArray(input)) {
      const lastUser = [...input].reverse().find(
        (candidate) => candidate.role === 'user' || candidate.role === 'user-with-attachments',
      )
      message = (lastUser ?? input[input.length - 1]) as AgentMessage
    } else {
      message = input
    }

    const metadata = (message as AgentMessage & { metadata?: Record<string, unknown> }).metadata
    if (!isManagedQuickForgeCloudModel(this.state.model)
      || (metadata && typeof metadata.quickforgeClientMessageId === 'string' && metadata.quickforgeClientMessageId)) return message
    return {
      ...message,
      metadata: {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        quickforgeClientMessageId: `qfcm_${randomId()}`,
      },
    } as unknown as AgentMessage
  }

  private emitToListeners(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* ignore */ }
    }
  }

  private async ensureRealAgent() {
    if (!this.realAgentPromise) {
      const sessionId = randomId()
      this.realAgentPromise = this.createAgent(
        {
          model: this.state.model,
          thinkingLevel: this.state.thinkingLevel,
          tools: [],
        },
        sessionId,
        {
          scope: this.scope,
          project: this.project,
          attachToView: true,
          harness: this.harness,
          accessMode: this.state.accessMode,
          yoloMode: this.state.yoloMode,
        },
      ).then((agent) => {
        if (this.disposed && this.promotedAgent !== agent) agent.dispose()
        return agent
      })
    }
    return this.realAgentPromise
  }
}
