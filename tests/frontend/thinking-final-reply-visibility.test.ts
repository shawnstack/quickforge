import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 「思考过程之后马上接最终的模型回复，对话界面看不到最新 AI 回复（刷新才出现）」
 * 的复现防线（OpenAI 系 reasoning + 普通对话）。
 *
 * 服务端数据完好、刷新可恢复 → 断点只能在 SSE 事件 → ServerAgent.handleEvent →
 * state.messages 合入链。本文件按真实事件序列走完整链路，钉住三种消息形态：
 * A. reasoning 与正文同一条消息（content blocks）
 * B. reasoning 与正文拆成两条连续 assistant 消息（命中 upsertMessage 同 role 兜底）
 * C. split 会话 agent_end 增量尾合入
 */
class MockEventSource {
  static instances: MockEventSource[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set<(event: MessageEvent) => void>()
      this.listeners.set(type, listeners)
    }
    listeners.add(listener)
  }

  emit(type: string, data: Record<string, unknown>): void {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  close(): void {}
}

vi.mock('@/lib/types', () => ({
  agentAccessModeFromYoloMode: (yoloMode?: boolean) => yoloMode ? 'full-access' : 'default',
  agentAccessModeToYoloMode: (accessMode: string) => accessMode === 'full-access',
  normalizeAgentAccessMode: (accessMode?: string, fallback = 'default') => accessMode ?? fallback,
}), { virtual: true })

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}), { virtual: true })

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}), { virtual: true })

vi.mock('@/lib/random-id', () => ({
  randomId: () => '22222222-2222-4222-8222-222222222222',
}), { virtual: true })

const sessionCacheMock = vi.hoisted(() => ({
  read: null as unknown,
  reset() {
    this.read = null
  },
}))

vi.mock('@/lib/session-message-cache', () => ({
  SESSION_MESSAGE_CACHE_TAIL_MESSAGES: 200,
  resolveServerCacheKey: (baseUrl = '') => baseUrl || 'unknown',
  readSessionMessageSnapshot: async () => sessionCacheMock.read ?? null,
  writeSessionMessageSnapshot: vi.fn(),
  flushPendingSessionMessageWrites: async () => {},
  cancelPendingSessionMessageWrites: () => {},
}), { virtual: true })

async function createServerAgent(config: ConstructorParameters<typeof import('../../src/lib/server-agent').ServerAgent>[0]) {
  const { ServerAgent } = await import('../../src/lib/server-agent')
  return new ServerAgent(config)
}

async function flushAllAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setImmediate(resolve))
}

function latestEventSource(): MockEventSource {
  const eventSource = MockEventSource.instances.at(-1)
  if (!eventSource) throw new Error('Expected an EventSource instance')
  return eventSource
}

describe('thinking → final reply visibility (was: hidden until refresh)', () => {
  beforeEach(() => {
    vi.resetModules()
    MockEventSource.instances = []
    sessionCacheMock.reset()
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const userMessage: AgentMessage = { role: 'user', content: 'go', timestamp: 1 }

  it('A. reasoning + text in ONE message: final text lands in state.messages', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })
    const source = latestEventSource()

    const thinkingPartial = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'reasoning so far' }],
      timestamp: 100,
    } as unknown as AgentMessage
    const fullMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'reasoning done' },
        { type: 'text', text: 'the final answer' },
      ],
      timestamp: 100,
    } as unknown as AgentMessage

    source.emit('agent_start', { sessionId: 'session-1', stateVersion: 2 })
    source.emit('message_update', { sessionId: 'session-1', stateVersion: 2, message: thinkingPartial })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: fullMessage })
    source.emit('agent_end', { sessionId: 'session-1', stateVersion: 2, messages: [userMessage, fullMessage] })
    await flushAllAsync()

    const last = agent.state.messages.at(-1) as unknown as { content: Array<{ type: string; text?: string }> }
    expect(agent.state.messages).toHaveLength(2)
    expect(last?.content.some((block) => block.type === 'text' && block.text === 'the final answer')).toBe(true)
  })

  it('B. reasoning and text as TWO consecutive assistant messages: BOTH survive', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })
    const source = latestEventSource()

    const notified: string[] = []
    agent.subscribe((event) => {
      notified.push((event as { type: string }).type)
    })

    const thinkingMessage = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'reasoning done' }],
      timestamp: 100,
    } as unknown as AgentMessage
    const textMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'the final answer' }],
      timestamp: 101,
    } as unknown as AgentMessage

    source.emit('agent_start', { sessionId: 'session-1', stateVersion: 2 })
    // 思考流式 → 提交思考消息 → 紧接最终回复消息（「马上接」）
    source.emit('message_update', { sessionId: 'session-1', stateVersion: 2, message: thinkingMessage })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: thinkingMessage })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: textMessage })
    source.emit('agent_end', { sessionId: 'session-1', stateVersion: 2, messages: [userMessage, thinkingMessage, textMessage] })
    await flushAllAsync()

    expect(agent.state.messages).toHaveLength(3)
    const thinking = agent.state.messages.at(-2) as unknown as { content: Array<{ type: string }> }
    const text = agent.state.messages.at(-1) as unknown as { content: Array<{ type: string; text?: string }> }
    expect(thinking?.content?.[0]?.type).toBe('thinking')
    expect(text?.content?.some((block) => block.type === 'text' && block.text === 'the final answer')).toBe(true)
    // 数据合入后必须通知订阅者（ChatSurface 靠它刷新窗口），否则 UI 停留旧态
    expect(notified.filter((type) => type === 'message_end')).toHaveLength(2)
    expect(notified).toContain('agent_end')
  })

  it('C. split session: incremental agent_end tail merges the final reply', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })
    const source = latestEventSource()

    const thinkingMessage = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'reasoning done' }],
      timestamp: 100,
    } as unknown as AgentMessage
    const textMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'the final answer' }],
      timestamp: 101,
    } as unknown as AgentMessage

    source.emit('agent_start', { sessionId: 'session-1', stateVersion: 2 })
    // pi 的 message_end 只带 message 单体（直通）；agent_end 带 split 裁剪尾
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: thinkingMessage })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: textMessage })
    source.emit('agent_end', {
      sessionId: 'session-1',
      stateVersion: 2,
      messagesIncremental: true,
      messagesAfter: 1,
      messages: [thinkingMessage, textMessage],
      messagesSummary: { count: 3 },
    })
    await flushAllAsync()

    expect(agent.state.messages).toHaveLength(3)
    const incrementalText = agent.state.messages.at(-1) as unknown as { content: Array<{ type: string; text?: string }> }
    expect(incrementalText?.content?.some((block) => block.type === 'text' && block.text === 'the final answer')).toBe(true)
  })

  it('D. tool call → thinking → final reply (exact user repro): final text stays visible', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })
    const source = latestEventSource()

    const assistantToolCall = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'run_command', arguments: { command: 'ls' } }],
      timestamp: 100,
      stopReason: 'toolCall',
    } as unknown as AgentMessage
    const toolResult = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'run_command',
      content: [{ type: 'text', text: 'file-a\nfile-b' }],
      timestamp: 101,
    } as unknown as AgentMessage
    const thinkingMessage = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'checking the listing' }],
      timestamp: 102,
    } as unknown as AgentMessage
    const finalText = {
      role: 'assistant',
      content: [{ type: 'text', text: 'the final answer' }],
      timestamp: 103,
    } as unknown as AgentMessage

    const notified: string[] = []
    agent.subscribe((event) => {
      notified.push((event as { type: string }).type)
    })

    source.emit('agent_start', { sessionId: 'session-1', stateVersion: 2 })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: assistantToolCall })
    source.emit('tool_execution_end', {
      sessionId: 'session-1',
      stateVersion: 2,
      toolCallId: 'call-1',
      toolName: 'run_command',
      result: { content: [{ type: 'text', text: 'file-a\nfile-b' }] },
    })
    // 思考过程 → 紧接着最终消息（用户精确描述的复现序列）
    source.emit('message_update', { sessionId: 'session-1', stateVersion: 2, message: thinkingMessage })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: thinkingMessage })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2, message: finalText })
    source.emit('agent_end', {
      sessionId: 'session-1',
      stateVersion: 2,
      messages: [userMessage, assistantToolCall, toolResult, thinkingMessage, finalText],
    })
    await flushAllAsync()

    const text = agent.state.messages.at(-1) as unknown as { content: Array<{ type: string; text?: string }>; timestamp?: number }
    expect(agent.state.messages).toHaveLength(5)
    expect(text?.content?.some((block) => block.type === 'text' && block.text === 'the final answer')).toBe(true)
    expect(notified.filter((type) => type === 'message_end')).toHaveLength(3)
    expect(notified).toContain('agent_end')
  })

  it('E. exact server-log frame order (turn_end + streaming ticks + split agent_end): final reply stays visible', async () => {
    const agent = await createServerAgent({
      sessionId: 'session-1',
      initialState: { messages: [userMessage] as AgentMessage[], stateVersion: 1 },
    })
    const source = latestEventSource()

    const assistantToolCall = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'need a tool' }, { type: 'toolCall', id: 'call-1', name: 'run_command', arguments: { command: 'ls' } }],
      timestamp: 100,
      stopReason: 'toolCall',
    } as unknown as AgentMessage
    const toolResult = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'run_command',
      content: [{ type: 'text', text: 'file-a\nfile-b' }],
      timestamp: 101,
    } as unknown as AgentMessage
    const thinkingPartial = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'analyzing' }],
      timestamp: 102,
    } as unknown as AgentMessage
    const fullFinal = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'analyzing' }, { type: 'text', text: 'the final answer' }],
      timestamp: 102,
    } as unknown as AgentMessage

    const notified: string[] = []
    agent.subscribe((event) => notified.push((event as { type: string }).type))

    // —— 镜像 [sse-frame] 日志的精确帧序 ——
    source.emit('agent_start', { sessionId: 'session-1', stateVersion: 2500 })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2510, message: assistantToolCall })
    source.emit('tool_execution_end', { sessionId: 'session-1', stateVersion: 2520, toolCallId: 'call-1', toolName: 'run_command', result: { content: [{ type: 'text', text: 'file-a\nfile-b' }] } })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2526, message: toolResult })
    source.emit('turn_end', { sessionId: 'session-1', stateVersion: 2527 })          // 无 messages → 触发无 force refresh
    // 最终消息流式（v2527 → v2926 之间的 tick 们）
    source.emit('message_update', { sessionId: 'session-1', stateVersion: 2600, message: thinkingPartial })
    source.emit('message_update', { sessionId: 'session-1', stateVersion: 2925, message: fullFinal })
    source.emit('message_end', { sessionId: 'session-1', stateVersion: 2926, message: fullFinal })
    source.emit('turn_end', { sessionId: 'session-1', stateVersion: 2926 })          // 无 messages → 又一次 refresh
    source.emit('agent_end', { sessionId: 'session-1', stateVersion: 2926, messagesSummary: { count: 4 } })  // split 形态：无 messages 数组
    await flushAllAsync()

    const text = agent.state.messages.at(-1) as unknown as { content: Array<{ type: string; text?: string }> }
    expect(agent.state.messages).toHaveLength(4)
    expect(text?.content?.some((block) => block.type === 'text' && block.text === 'the final answer')).toBe(true)
    expect(notified.filter((type) => type === 'message_end')).toHaveLength(3)
  })
})
