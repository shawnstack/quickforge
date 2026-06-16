import type { AgentEvent, AgentMessage, AgentState, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai'
import type { ServerAgent, ServerAgentContextCompaction, ServerAgentContextUsage, PromptCapabilitySelection, PromptCommandSelection } from '@/lib/server-agent'
import type { ChatScope, ProjectInfo } from '@/lib/types'
import { randomId } from '@/lib/random-id'

type DeferredSessionAgentOptions = {
  scope: ChatScope
  project?: ProjectInfo
  model: Model<Api>
  thinkingLevel: ThinkingLevel
  yoloMode: boolean
  createAgent: (
    initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
    sessionId?: string,
    options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string; yoloMode?: boolean },
  ) => Promise<ServerAgent>
}

export class DeferredSessionAgent {
  sessionId: string
  streamFn = streamSimple
  getApiKey?: (provider: string) => Promise<string | undefined>
  readonly scope: ChatScope
  readonly project?: ProjectInfo
  private readonly createAgent: DeferredSessionAgentOptions['createAgent']
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private disposed = false
  private realAgentPromise: Promise<ServerAgent> | undefined

  private promotedAgent: ServerAgent | undefined
  private nextPromptCapabilities: PromptCapabilitySelection[] = []
  private nextPromptCommand: PromptCommandSelection | undefined

  state: {
    systemPrompt: string
    model: Model<Api>
    thinkingLevel: ThinkingLevel
    messages: AgentMessage[]
    tools: unknown[]
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
    this.createAgent = options.createAgent
    this.state = {
      systemPrompt: '',
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      messages: [],
      tools: [],
      yoloMode: options.yoloMode,
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
    this.nextPromptCapabilities = Array.isArray(capabilities) ? capabilities.slice(0, 4) : []
  }

  setNextPromptCommand(command?: PromptCommandSelection): void {
    this.nextPromptCommand = command?.type === 'plan' ? { type: 'plan' } : undefined
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.disposed) return
    const realAgent = await this.ensureRealAgent()
    realAgent.setNextPromptCapabilities(this.nextPromptCapabilities)
    realAgent.setNextPromptCommand(this.nextPromptCommand)
    this.nextPromptCapabilities = []
    this.nextPromptCommand = undefined
    await realAgent.prompt(input as string | AgentMessage | AgentMessage[])
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

  async updateYoloMode(yoloMode: boolean): Promise<void> {
    this.state.yoloMode = yoloMode
    const realAgent = await this.realAgentPromise
    if (realAgent) await realAgent.updateYoloMode(yoloMode)
  }

  async updateModel(model: Model<Api>): Promise<void> {
    this.state.model = model
    const realAgent = await this.realAgentPromise
    if (realAgent) await realAgent.updateModel(model)
  }

  async updateThinkingLevel(level: ThinkingLevel): Promise<void> {
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
