import type { AgentEvent, AgentMessage, AgentState, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ServerAgent, ServerAgentContextCompaction, ServerAgentContextUsage, PromptCapabilitySelection, FileContextReference } from '@/lib/server-agent'
import type { AgentAccessMode, ChatScope, ProjectInfo } from '@/lib/types'
import { agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import type { GoalAction, GoalActionOptions, GoalState } from '@/lib/goal'
import { randomId } from '@/lib/random-id'
import { normalizeSelectedCapabilities, withSelectedCapabilitiesSnapshot } from '@/lib/selected-capabilities'

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
    options?: {
      scope?: ChatScope
      project?: ProjectInfo
      attachToView?: boolean
      createdAt?: string
      title?: string
      accessMode?: AgentAccessMode
      yoloMode?: boolean
      /**
       * 交接给真实 agent 的消息：用户在这个 Deferred 会话里已经看到的乐观消息。
       * 真实 agent 必须带着它们上屏，否则它会以「0 条消息」的空会话形态 attach，
       * 被当成全新的空对话（自动落项目、回到欢迎页）。
       */
      handoffMessages?: AgentMessage[]
    },
  ) => Promise<ServerAgent>
}

export class DeferredSessionAgent {
  sessionId: string
  getApiKey?: (provider: string) => Promise<string | undefined>
  readonly scope: ChatScope
  readonly project?: ProjectInfo
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
    goal: GoalState | null
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
      goal: null,
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

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<boolean> {
    // 与 ServerAgent.prompt 同一契约：false = 没有交给服务端，调用方必须保留消息。
    if (this.disposed || this.state.isStreaming) return false

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
    // 这条消息已随 `handoffMessages` 进了真实 agent 的 state，别再追加一次。
    // 转发真实 agent 的「发出去没有」结果，交接链路也不许把失败当成成功。
    return (await realAgent.prompt(message, { messageAlreadyInState: true })) !== false
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
    this.state.goal = null
  }

  async rollback(): Promise<never> {
    throw new Error('Cannot roll back a pending chat')
  }

  /**
   * 本地乐观截断尾部（与 `ServerAgent.trimTrailingMessages` 同义）。
   *
   * 未提案的会话只有内存里的草稿消息，直接截断即可；提出后由真实 agent 接手。
   */
  trimTrailingMessages(keepCount: number): void {
    const limit = Number.isFinite(keepCount) ? Math.max(0, Math.trunc(keepCount)) : this.state.messages.length
    this.state.messages = this.state.messages.slice(0, Math.min(limit, this.state.messages.length))
  }

  async continue(appendMessage?: AgentMessage): Promise<void> {
    const realAgent = await this.ensureRealAgent()
    await realAgent.continue(appendMessage)
  }

  async approveToolCall(): Promise<never> {
    throw new Error('No pending tool call')
  }

  async rejectToolCall(): Promise<never> {
    throw new Error('No pending tool call')
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

  async updateGoal(action: GoalAction, objective?: string, options?: GoalActionOptions): Promise<GoalState | null> {
    const realAgent = await this.ensureRealAgent()
    const goal = await realAgent.updateGoal(action, objective, options)
    this.state.goal = goal
    return goal
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
    if (typeof input === 'string') {
      return { role: 'user', content: input, timestamp: Date.now() } as AgentMessage
    }
    if (Array.isArray(input)) {
      const lastUser = [...input].reverse().find(
        (candidate) => candidate.role === 'user' || candidate.role === 'user-with-attachments',
      )
      return (lastUser ?? input[input.length - 1]) as AgentMessage
    }
    return input
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
          accessMode: this.state.accessMode,
          yoloMode: this.state.yoloMode,
          // 交接乐观消息：真实 agent 一定会以当前已有的消息上屏，不会出现
          // 「会话刚建好、消息还没发」的空窗（那会被判成全新空对话）。
          handoffMessages: this.state.messages,
        },
      ).then((agent) => {
        if (this.disposed && this.promotedAgent !== agent) agent.dispose()
        return agent
      })
    }
    return this.realAgentPromise
  }
}
