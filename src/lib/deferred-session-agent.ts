import type { AgentEvent, AgentMessage, AgentState, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai'
import type { ServerAgent, ServerAgentContextCompaction, ServerAgentContextUsage, PromptCapabilitySelection } from '@/lib/server-agent'
import type { AgentAccessMode, ChatScope, ProjectInfo } from '@/lib/types'
import { agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { randomId } from '@/lib/random-id'

type DeferredSessionAgentOptions = {
  scope: ChatScope
  project?: ProjectInfo
  model: Model<Api>
  thinkingLevel: ThinkingLevel
  accessMode?: AgentAccessMode
  yoloMode: boolean
  createAgent: (
    initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
    sessionId?: string,
    options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string; accessMode?: AgentAccessMode; yoloMode?: boolean },
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
  private planMode = false
  private onPlanModeConsumed?: () => void

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
    this.nextPromptCapabilities = Array.isArray(capabilities) ? capabilities.slice(0, 4) : []
  }

  setPlanMode(mode: boolean, onConsumed?: () => void): void {
    this.planMode = mode
    this.onPlanModeConsumed = mode ? onConsumed : undefined
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.disposed) return
    const realAgent = await this.ensureRealAgent()
    realAgent.setNextPromptCapabilities(this.nextPromptCapabilities)
    realAgent.setPlanMode(this.planMode, this.onPlanModeConsumed)
    this.nextPromptCapabilities = []
    this.planMode = false
    this.onPlanModeConsumed = undefined
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
